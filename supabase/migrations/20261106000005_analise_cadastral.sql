-- =============================================================================
-- Análise cadastral e garantias locatícias (nos dois modos; no pessoal o dono
-- analisa o próprio candidato, sem corretor).
--   * candidatos a locatário (pessoa + imóvel pretendido + aluguel/encargos);
--   * checklist de documentos (candidato PF/PJ, fiador, cônjuge, garantia) com
--     arquivos e "validado por / em";
--   * comprovação de renda (várias fontes) e comprometimento x regra;
--   * consultas de crédito com base legal (LGPD art. 7º I consentimento ou
--     art. 7º X proteção do crédito) — estrutura pronta para integração;
--   * fiadores (renda, imóvel em garantia, cônjuge) com análise própria;
--   * garantias propostas e acompanhamento na garantidora;
--   * decisão com justificativa obrigatória; exceção (fora da regra) só por
--     admin/gestor — regra garantida no banco;
--   * auditoria (eventos e decisões: só leitura, não se apaga);
--   * vencimento e renovação das garantias e do seguro incêndio dos contratos;
--   * ficha online por link (/ficha/[token]) para o candidato mandar dados,
--     autorização (LGPD) e documentos.
-- Arquivos no Storage, bucket privado "analises":
--   <organizacao_id>/<analise_id>/<arquivo>  (enviados pela equipe)
--   ficha/<token>/<arquivo>                  (enviados pelo candidato)
-- Sem DROP: funções/gatilhos com "create or replace", policies só se não existem.
-- =============================================================================

-- Regras da organização -------------------------------------------------------
create table if not exists public.analise_config (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null unique default privado.org_atual() references public.organizacoes(id) on delete cascade,
  limite_comprometimento_pct numeric(5,2) not null default 30 check (limite_comprometimento_pct between 1 and 100),
  alerta_comprometimento_pct numeric(5,2) not null default 25 check (alerta_comprometimento_pct between 1 and 100),
  renda_fiador_multiplo numeric(5,2) not null default 3 check (renda_fiador_multiplo between 0 and 20),
  score_minimo int check (score_minimo is null or score_minimo between 0 and 1000),
  aceitar_restricoes boolean not null default false,
  exigir_consulta boolean not null default true,
  exigir_garantia boolean not null default true,
  validade_dias int not null default 30 check (validade_dias between 1 and 365),
  ficha_dias int not null default 15 check (ficha_dias between 1 and 90),
  bureau_padrao text,
  texto_consentimento text,
  atualizado_em timestamptz not null default now(),
  atualizado_por uuid,
  check (alerta_comprometimento_pct <= limite_comprometimento_pct)
);

-- Candidato / análise ----------------------------------------------------------
create table if not exists public.analises (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  numero bigint generated always as identity,
  candidato_id uuid not null references public.pessoas(id),
  imovel_id uuid references public.imoveis(id) on delete set null,
  corretor_id uuid references public.pessoas(id) on delete set null,
  responsavel_id uuid default auth.uid(),
  finalidade text not null default 'residencial' check (finalidade in ('residencial','comercial')),
  valor_aluguel numeric(14,2) not null default 0 check (valor_aluguel >= 0),
  valor_encargos numeric(14,2) not null default 0 check (valor_encargos >= 0),
  moradores int check (moradores is null or moradores between 0 and 50),
  moradores_obs text,
  renda_declarada numeric(14,2) check (renda_declarada is null or renda_declarada >= 0),
  status text not null default 'em_analise'
    check (status in ('em_analise','aprovada','aprovada_condicoes','reprovada','desistencia','contratada')),
  desistencia_motivo text,
  decisao text check (decisao is null or decisao in ('aprovado','aprovado_condicoes','reprovado')),
  decisao_justificativa text,
  decisao_condicoes text,
  fora_da_regra text[] not null default '{}',
  excecao boolean not null default false,
  excecao_justificativa text,
  decidido_em timestamptz,
  decidido_por uuid,
  validade_ate date,
  reaberta_motivo text,
  proprietario_ciente_em date,
  contrato_id uuid references public.contratos(id) on delete set null,
  identidade_conferida_em timestamptz,
  identidade_conferida_por uuid,
  consentimento_em timestamptz,
  consentimento_origem text,
  consentimento_ip text,
  consentimento_texto text,
  token uuid not null default gen_random_uuid(),
  ficha_ativa boolean not null default false,
  ficha_expira_em date,
  ficha_enviada_em timestamptz,
  ficha_dados jsonb,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists analises_token_idx on public.analises (token);
create index if not exists analises_status_idx on public.analises (organizacao_id, status, created_at desc);
create index if not exists analises_candidato_idx on public.analises (candidato_id);
create index if not exists analises_imovel_idx on public.analises (imovel_id);

-- Fiadores do candidato (análise própria)
create table if not exists public.analise_fiadores (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  analise_id uuid not null references public.analises(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id),
  parentesco text,
  conjuge_nome text,
  conjuge_documento text,
  outorga_conjuge boolean not null default false,
  imovel_descricao text,
  imovel_matricula text,
  imovel_cartorio text,
  imovel_valor numeric(14,2) check (imovel_valor is null or imovel_valor >= 0),
  imovel_onus boolean not null default false,
  status text not null default 'pendente' check (status in ('pendente','aprovado','reprovado')),
  parecer text,
  analisado_em timestamptz,
  analisado_por uuid,
  consentimento_em timestamptz,
  consentimento_origem text,
  identidade_conferida_em timestamptz,
  identidade_conferida_por uuid,
  created_at timestamptz not null default now(),
  unique (analise_id, pessoa_id)
);
create index if not exists analise_fiadores_analise_idx on public.analise_fiadores (analise_id);

-- Fontes de renda (do candidato, de quem compõe renda e dos fiadores)
create table if not exists public.analise_rendas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  analise_id uuid not null references public.analises(id) on delete cascade,
  fiador_id uuid references public.analise_fiadores(id) on delete cascade,
  titular text,
  tipo text not null default 'clt'
    check (tipo in ('clt','servidor','pro_labore','autonomo','empresario','aposentadoria','pensao','aluguel','investimentos','beneficio','outro')),
  fonte text,
  valor_declarado numeric(14,2) not null default 0 check (valor_declarado >= 0),
  valor_comprovado numeric(14,2) check (valor_comprovado is null or valor_comprovado >= 0),
  comprovante text,
  comprovado_em timestamptz,
  comprovado_por uuid,
  origem text not null default 'interno' check (origem in ('interno','ficha')),
  created_at timestamptz not null default now()
);
create index if not exists analise_rendas_analise_idx on public.analise_rendas (analise_id);

-- Checklist de documentos
create table if not exists public.analise_documentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  analise_id uuid not null references public.analises(id) on delete cascade,
  fiador_id uuid references public.analise_fiadores(id) on delete cascade,
  parte text not null default 'candidato' check (parte in ('candidato','fiador','conjuge','garantia','outro')),
  item text,
  rotulo text not null,
  obrigatorio boolean not null default true,
  ordem int not null default 0,
  status text not null default 'pendente' check (status in ('pendente','recebido','validado','recusado','dispensado')),
  motivo_recusa text,
  validado_em timestamptz,
  validado_por uuid,
  created_at timestamptz not null default now()
);
create index if not exists analise_documentos_analise_idx on public.analise_documentos (analise_id, ordem);

-- Arquivos enviados (equipe ou ficha online)
create table if not exists public.analise_arquivos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  analise_id uuid not null references public.analises(id) on delete cascade,
  documento_id uuid references public.analise_documentos(id) on delete set null,
  path text not null,
  nome text,
  enviado_pela_ficha boolean not null default false,
  enviado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists analise_arquivos_analise_idx on public.analise_arquivos (analise_id);

-- Consultas de crédito (registro manual hoje; integração com birô depois)
create table if not exists public.analise_consultas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  analise_id uuid not null references public.analises(id) on delete cascade,
  fiador_id uuid references public.analise_fiadores(id) on delete cascade,
  documento_consultado text,
  bureau text not null check (bureau in ('serasa','spc','boa_vista','quod','outro')),
  bureau_nome text,
  consultado_em date not null default current_date,
  score int check (score is null or score between 0 and 1000),
  faixa_risco text,
  restricoes boolean not null default false,
  restricoes_qtd int check (restricoes_qtd is null or restricoes_qtd >= 0),
  restricoes_valor numeric(14,2) check (restricoes_valor is null or restricoes_valor >= 0),
  restricoes_descricao text,
  protocolo text,
  base_legal text not null check (base_legal in ('consentimento','protecao_credito')),
  consentimento_em timestamptz,
  origem text not null default 'manual' check (origem in ('manual','integracao')),
  resposta jsonb,
  observacoes text,
  consultado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (base_legal <> 'consentimento' or consentimento_em is not null)
);
create index if not exists analise_consultas_analise_idx on public.analise_consultas (analise_id, consultado_em desc);

-- Garantias propostas e acompanhamento na garantidora
create table if not exists public.analise_garantias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  analise_id uuid not null references public.analises(id) on delete cascade,
  fiador_id uuid references public.analise_fiadores(id) on delete set null,
  tipo text not null check (tipo in ('fiador','caucao','seguro_fianca','titulo_capitalizacao','carta_fianca','outro')),
  garantidora text,
  proposta_numero text,
  apolice_numero text,
  valor numeric(14,2) check (valor is null or valor >= 0),
  premio numeric(14,2) check (premio is null or premio >= 0),
  parcelas int check (parcelas is null or parcelas between 1 and 120),
  vigencia_inicio date,
  vigencia_fim date,
  conta text,
  status text not null default 'proposta'
    check (status in ('proposta','solicitada','em_analise','aprovada','aprovada_restricao','recusada','cancelada','contratada')),
  solicitada_em date,
  respondida_em date,
  resposta text,
  contrato_garantia_id uuid references public.contrato_garantias(id) on delete set null,
  observacoes text,
  created_at timestamptz not null default now(),
  check (vigencia_fim is null or vigencia_inicio is null or vigencia_fim > vigencia_inicio)
);
create index if not exists analise_garantias_analise_idx on public.analise_garantias (analise_id);
create index if not exists analise_garantias_status_idx on public.analise_garantias (organizacao_id, status);

-- Decisões (só leitura: gravadas pelo banco; sobrevivem à exclusão da análise)
create table if not exists public.analise_decisoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes(id) on delete cascade,
  analise_id uuid not null,
  analise_numero bigint,
  candidato_nome text,
  decisao text not null,
  justificativa text not null,
  condicoes text,
  excecao boolean not null default false,
  fora_da_regra text[] not null default '{}',
  excecao_justificativa text,
  renda_comprovada numeric(14,2),
  custo_mensal numeric(14,2),
  comprometimento_pct numeric(7,1),
  usuario_id uuid,
  papel text,
  data timestamptz not null default now()
);
create index if not exists analise_decisoes_idx on public.analise_decisoes (organizacao_id, data desc);
create index if not exists analise_decisoes_analise_idx on public.analise_decisoes (analise_id, data desc);

-- Trilha de auditoria (só acrescenta; ninguém altera nem apaga pelo app)
create table if not exists public.analise_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  analise_id uuid,
  contrato_id uuid,
  tipo text not null,
  descricao text not null,
  dados jsonb,
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index if not exists analise_eventos_idx on public.analise_eventos (organizacao_id, data desc);
create index if not exists analise_eventos_analise_idx on public.analise_eventos (analise_id, data desc);

-- Renovação das garantias e do seguro incêndio dos contratos ativos
create table if not exists public.garantia_renovacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  objeto text not null default 'garantia' check (objeto in ('garantia','seguro_incendio')),
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  contrato_garantia_id uuid references public.contrato_garantias(id) on delete cascade,
  solicitada_em date not null default current_date,
  canal text not null default 'whatsapp' check (canal in ('whatsapp','email','telefone','portal','presencial','outro')),
  destinatario text not null default 'seguradora' check (destinatario in ('seguradora','locatario','fiador','banco','outro')),
  destinatario_nome text,
  status text not null default 'solicitada' check (status in ('solicitada','renovada','recusada','cancelada')),
  fim_anterior date,
  nova_fim date,
  novo_numero text,
  novo_valor numeric(14,2) check (novo_valor is null or novo_valor >= 0),
  novo_premio numeric(14,2) check (novo_premio is null or novo_premio >= 0),
  concluida_em date,
  observacoes text,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (objeto = 'seguro_incendio' or contrato_garantia_id is not null)
);
create index if not exists garantia_renovacoes_contrato_idx on public.garantia_renovacoes (contrato_id);
create index if not exists garantia_renovacoes_garantia_idx on public.garantia_renovacoes (contrato_garantia_id);

-- =============================================================================
-- Funções de apoio
-- =============================================================================

/** Papel do usuário logado na organização (admin, gestor, financeiro, corretor). */
create or replace function privado.analise_papel(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select papel from public.membros where organizacao_id = p_org and user_id = auth.uid()
$$;
revoke execute on function privado.analise_papel(uuid) from public, anon;
grant execute on function privado.analise_papel(uuid) to authenticated;

/** CPF (11) ou CNPJ (14) com dígitos verificadores corretos. */
create or replace function privado.analise_documento_valido(p_doc text)
returns boolean
language plpgsql
immutable
set search_path = public
as $$
declare
  d text := regexp_replace(coalesce(p_doc, ''), '\D', '', 'g');
  s int;
  r int;
  i int;
  p1 int[] := array[5,4,3,2,9,8,7,6,5,4,3,2];
  p2 int[] := array[6,5,4,3,2,9,8,7,6,5,4,3,2];
begin
  if length(d) = 11 then
    if d ~ '^(\d)\1{10}$' then return false; end if;
    s := 0;
    for i in 1..9 loop s := s + substr(d, i, 1)::int * (11 - i); end loop;
    r := (s * 10) % 11;
    if r = 10 then r := 0; end if;
    if r <> substr(d, 10, 1)::int then return false; end if;
    s := 0;
    for i in 1..10 loop s := s + substr(d, i, 1)::int * (12 - i); end loop;
    r := (s * 10) % 11;
    if r = 10 then r := 0; end if;
    return r = substr(d, 11, 1)::int;
  elsif length(d) = 14 then
    if d ~ '^(\d)\1{13}$' then return false; end if;
    s := 0;
    for i in 1..12 loop s := s + substr(d, i, 1)::int * p1[i]; end loop;
    r := s % 11;
    r := case when r < 2 then 0 else 11 - r end;
    if r <> substr(d, 13, 1)::int then return false; end if;
    s := 0;
    for i in 1..13 loop s := s + substr(d, i, 1)::int * p2[i]; end loop;
    r := s % 11;
    r := case when r < 2 then 0 else 11 - r end;
    return r = substr(d, 14, 1)::int;
  end if;
  return false;
end;
$$;

/**
 * Número digitado ("R$ 1.234,56", "1234,56", "3.500", "1.234.567" ou "1234.56"):
 * vírgula é decimal; sem vírgula, ponto seguido de exatamente 3 dígitos é milhar
 * (jeito brasileiro: "3.500" = três mil e quinhentos). Inválido vira null (não derruba o envio).
 */
create or replace function privado.analise_num(p text)
returns numeric
language plpgsql
immutable
as $$
declare
  s text := regexp_replace(btrim(coalesce(p, '')), '^R\$\s*', '', 'i');
begin
  s := replace(s, ' ', '');
  if s = '' then return null; end if;
  if s like '%,%' then
    s := replace(replace(s, '.', ''), ',', '.');
  elsif s ~ '^-?\d{1,3}(\.\d{3})+$' then
    s := replace(s, '.', '');
  end if;
  return round(s::numeric, 2);
exception when others then
  return null;
end;
$$;

/** Grava um evento na trilha de auditoria (sem travar a exclusão da organização). */
create or replace function privado.analise_evento(p_org uuid, p_analise uuid, p_tipo text, p_descricao text, p_dados jsonb default null, p_contrato uuid default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.organizacoes where id = p_org) then
    return;
  end if;
  insert into public.analise_eventos (organizacao_id, analise_id, contrato_id, tipo, descricao, dados, usuario_id)
  values (p_org, p_analise, p_contrato, p_tipo, p_descricao, p_dados, auth.uid());
end;
$$;
revoke execute on function privado.analise_evento(uuid, uuid, text, text, jsonb, uuid) from public, anon;

/** Organização da análise (e confere se o fiador é da mesma análise). */
create or replace function privado.analise_org_de(p_analise uuid, p_fiador uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizacao_id into v_org from public.analises where id = p_analise;
  if v_org is null then
    raise exception 'Análise não encontrada.';
  end if;
  if p_fiador is not null and not exists (select 1 from public.analise_fiadores where id = p_fiador and analise_id = p_analise) then
    raise exception 'Este fiador é de outra análise.';
  end if;
  return v_org;
end;
$$;
revoke execute on function privado.analise_org_de(uuid, uuid) from public, anon;

/**
 * O que está fora da regra para aprovar (mesma conta de foraDaRegra() em
 * src/lib/dominio/analise.ts). Lista vazia = dentro da regra.
 */
create or replace function privado.analise_fora_da_regra(p_id uuid, p_org uuid, p_custo numeric, p_candidato uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.analise_config%rowtype;
  v_limite numeric := 30;
  v_multiplo numeric := 3;
  v_score_min int;
  v_aceita_restr boolean := false;
  v_exigir_consulta boolean := true;
  v_exigir_garantia boolean := true;
  v_renda numeric;
  v_pct numeric;
  v_doc text;
  v_n int;
  v_score int;
  v_restr boolean;
  v_out text[] := '{}';
  r record;
begin
  select * into c from public.analise_config where organizacao_id = p_org;
  if found then
    v_limite := c.limite_comprometimento_pct;
    v_multiplo := c.renda_fiador_multiplo;
    v_score_min := c.score_minimo;
    v_aceita_restr := c.aceitar_restricoes;
    v_exigir_consulta := c.exigir_consulta;
    v_exigir_garantia := c.exigir_garantia;
  end if;

  -- Renda comprovada (candidato e quem compõe renda; fiadores à parte)
  select coalesce(sum(valor_comprovado), 0) into v_renda
    from public.analise_rendas where analise_id = p_id and fiador_id is null and valor_comprovado is not null;
  if v_renda <= 0 then
    v_out := v_out || 'Renda não comprovada'::text;
  else
    v_pct := round(coalesce(p_custo, 0) / v_renda * 100, 1);
    if v_pct > v_limite then
      v_out := v_out || format('Comprometimento de %s%% da renda (limite %s%%)', replace(v_pct::text, '.', ','), replace(trim_scale(v_limite)::text, '.', ','));
    end if;
  end if;

  -- Documento do candidato
  select documento into v_doc from public.pessoas where id = p_candidato;
  if not privado.analise_documento_valido(v_doc) then
    v_out := v_out || 'CPF/CNPJ do candidato ausente ou inválido'::text;
  end if;

  -- Crédito: vale a consulta mais recente do candidato
  select count(*) into v_n from public.analise_consultas where analise_id = p_id and fiador_id is null;
  if v_n = 0 then
    if v_exigir_consulta then
      v_out := v_out || 'Sem consulta de crédito registrada'::text;
    end if;
  else
    select score, restricoes into v_score, v_restr from public.analise_consultas
     where analise_id = p_id and fiador_id is null order by consultado_em desc, created_at desc limit 1;
    if v_score_min is not null and v_score is not null and v_score < v_score_min then
      v_out := v_out || format('Score %s abaixo do mínimo %s', v_score, v_score_min);
    end if;
    if v_restr and not v_aceita_restr then
      v_out := v_out || 'Restrições de crédito no nome do candidato'::text;
    end if;
  end if;

  -- Documentos obrigatórios sem validação
  select count(*) into v_n from public.analise_documentos
   where analise_id = p_id and obrigatorio and status not in ('validado','dispensado');
  if v_n > 0 then
    v_out := v_out || format('%s documento(s) obrigatório(s) sem validação', v_n);
  end if;

  -- Garantia aprovada (seguro/caução/título/carta aprovados ou fiador aprovado)
  if v_exigir_garantia
     and not exists (select 1 from public.analise_garantias where analise_id = p_id and status in ('aprovada','aprovada_restricao','contratada'))
     and not exists (select 1 from public.analise_fiadores where analise_id = p_id and status = 'aprovado') then
    v_out := v_out || 'Nenhuma garantia aprovada'::text;
  end if;

  -- Fiadores aprovados com renda abaixo do mínimo
  for r in
    select p.nome, coalesce(sum(rd.valor_comprovado), 0) as renda
      from public.analise_fiadores f
      join public.pessoas p on p.id = f.pessoa_id
      left join public.analise_rendas rd on rd.fiador_id = f.id and rd.valor_comprovado is not null
     where f.analise_id = p_id and f.status = 'aprovado'
     group by f.id, p.nome
  loop
    if v_multiplo > 0 and r.renda < coalesce(p_custo, 0) * v_multiplo then
      v_out := v_out || format('Fiador %s com renda abaixo de %s× o aluguel e encargos', r.nome, replace(trim_scale(v_multiplo)::text, '.', ','));
    end if;
  end loop;

  return v_out;
end;
$$;
revoke execute on function privado.analise_fora_da_regra(uuid, uuid, numeric, uuid) from public, anon;
grant execute on function privado.analise_fora_da_regra(uuid, uuid, numeric, uuid) to authenticated;

/** Para a tela: o que o banco vai considerar fora da regra se aprovar agora (só da própria organização). */
create or replace function public.analise_checar_regras(p_id uuid)
returns text[]
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  a public.analises%rowtype;
begin
  select * into a from public.analises where id = p_id;
  if not found then raise exception 'Análise não encontrada.'; end if;
  return privado.analise_fora_da_regra(a.id, a.organizacao_id, a.valor_aluguel + a.valor_encargos, a.candidato_id);
end;
$$;
revoke execute on function public.analise_checar_regras(uuid) from public, anon;
grant execute on function public.analise_checar_regras(uuid) to authenticated;

-- =============================================================================
-- Gatilhos
-- =============================================================================

/** Regras da análise: decisão, exceção, reabertura, contrato, conferências. */
create or replace function privado.analises_regras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sistema boolean := auth.uid() is null;
  v_papel text;
  v_validade int;
  v_renda numeric;
  v_custo numeric;
  v_nome text;
begin
  if tg_op = 'DELETE' then
    -- Organização inteira sendo apagada: sem regra.
    if not exists (select 1 from public.organizacoes where id = old.organizacao_id) then
      return old;
    end if;
    v_papel := privado.analise_papel(old.organizacao_id);
    if old.decisao is not null and not v_sistema and coalesce(v_papel, '') not in ('admin','gestor') then
      raise exception 'Só administradores e gestores excluem uma análise já decidida (a decisão continua na auditoria).';
    end if;
    return old;
  end if;

  v_papel := privado.analise_papel(new.organizacao_id);

  if tg_op = 'INSERT' then
    if new.decisao is not null or new.contrato_id is not null then
      raise exception 'A análise começa sem decisão: decida depois de analisar.';
    end if;
    new.status := case when new.status = 'desistencia' then 'desistencia' else 'em_analise' end;
    new.decisao_justificativa := null;
    new.decisao_condicoes := null;
    new.fora_da_regra := '{}';
    new.excecao := false;
    new.excecao_justificativa := null;
    new.decidido_em := null;
    new.decidido_por := null;
    new.validade_ate := null;
    new.identidade_conferida_por := case when new.identidade_conferida_em is null then null else auth.uid() end;
    return new;
  end if;

  new.updated_at := now();

  if new.decisao is distinct from old.decisao then
    if new.decisao is null then
      -- Reabrir
      if not v_sistema and coalesce(v_papel, '') not in ('admin','gestor') then
        raise exception 'Só administradores e gestores reabrem uma análise já decidida.';
      end if;
      if new.contrato_id is not null then
        raise exception 'Esta análise já virou contrato. Desvincule o contrato antes de reabrir.';
      end if;
      if length(btrim(coalesce(new.reaberta_motivo, ''))) < 5 then
        raise exception 'Informe o motivo para reabrir a análise.';
      end if;
      perform privado.analise_evento(new.organizacao_id, new.id, 'reaberta', 'Análise reaberta: ' || btrim(new.reaberta_motivo),
        jsonb_build_object('decisao_anterior', old.decisao, 'justificativa_anterior', old.decisao_justificativa));
      new.decisao_justificativa := null;
      new.decisao_condicoes := null;
      new.fora_da_regra := '{}';
      new.excecao := false;
      new.excecao_justificativa := null;
      new.decidido_em := null;
      new.decidido_por := null;
      new.validade_ate := null;
      if new.status <> 'desistencia' then new.status := 'em_analise'; end if;
    else
      if old.decisao is not null then
        raise exception 'Reabra a análise antes de mudar a decisão.';
      end if;
      if not v_sistema and coalesce(v_papel, '') not in ('admin','gestor','financeiro') then
        raise exception 'Seu usuário não pode decidir análises cadastrais. Peça a um administrador, gestor ou ao financeiro.';
      end if;
      if length(btrim(coalesce(new.decisao_justificativa, ''))) < 10 then
        raise exception 'Escreva a justificativa da decisão (pelo menos 10 letras).';
      end if;
      if new.decisao = 'aprovado_condicoes' and length(btrim(coalesce(new.decisao_condicoes, ''))) < 3 then
        raise exception 'Descreva as condições da aprovação.';
      end if;
      v_custo := new.valor_aluguel + new.valor_encargos;
      new.fora_da_regra := coalesce(privado.analise_fora_da_regra(new.id, new.organizacao_id, v_custo, new.candidato_id), '{}');
      if new.decisao in ('aprovado','aprovado_condicoes') and cardinality(new.fora_da_regra) > 0 then
        if not v_sistema and coalesce(v_papel, '') not in ('admin','gestor') then
          raise exception 'Aprovação fora da regra (%). Só administrador ou gestor aprova como exceção.', array_to_string(new.fora_da_regra, '; ');
        end if;
        if length(btrim(coalesce(new.excecao_justificativa, ''))) < 10 then
          raise exception 'Explique por que aprovar fora da regra (justificativa da exceção, pelo menos 10 letras).';
        end if;
        new.excecao := true;
      else
        new.excecao := false;
        new.excecao_justificativa := null;
      end if;
      if new.decisao <> 'aprovado_condicoes' then new.decisao_condicoes := null; end if;
      select validade_dias into v_validade from public.analise_config where organizacao_id = new.organizacao_id;
      new.validade_ate := case when new.decisao = 'reprovado' then null else current_date + coalesce(v_validade, 30) end;
      new.decidido_em := now();
      new.decidido_por := auth.uid();
      new.reaberta_motivo := null;
      new.status := 'em_analise';

      select coalesce(sum(valor_comprovado), 0) into v_renda
        from public.analise_rendas where analise_id = new.id and fiador_id is null and valor_comprovado is not null;
      select nome into v_nome from public.pessoas where id = new.candidato_id;
      insert into public.analise_decisoes (organizacao_id, analise_id, analise_numero, candidato_nome, decisao, justificativa, condicoes,
        excecao, fora_da_regra, excecao_justificativa, renda_comprovada, custo_mensal, comprometimento_pct, usuario_id, papel)
      values (new.organizacao_id, new.id, new.numero, v_nome, new.decisao, btrim(new.decisao_justificativa), new.decisao_condicoes,
        new.excecao, new.fora_da_regra, new.excecao_justificativa, v_renda, v_custo,
        case when v_renda > 0 then round(v_custo / v_renda * 100, 1) end, auth.uid(), v_papel);
      perform privado.analise_evento(new.organizacao_id, new.id, case when new.excecao then 'excecao' else 'decisao' end,
        case new.decisao when 'aprovado' then 'Aprovado' when 'aprovado_condicoes' then 'Aprovado com condições' else 'Reprovado' end
          || case when new.excecao then ' como exceção (fora da regra)' else '' end || ': ' || btrim(new.decisao_justificativa),
        jsonb_build_object('fora_da_regra', new.fora_da_regra, 'excecao_justificativa', new.excecao_justificativa, 'condicoes', new.decisao_condicoes));
    end if;
  elsif old.decisao is not null and (
        new.decisao_justificativa is distinct from old.decisao_justificativa
     or new.decisao_condicoes is distinct from old.decisao_condicoes
     or new.excecao is distinct from old.excecao
     or new.excecao_justificativa is distinct from old.excecao_justificativa
     or new.fora_da_regra is distinct from old.fora_da_regra
     or new.decidido_em is distinct from old.decidido_em
     or new.decidido_por is distinct from old.decidido_por
     or new.validade_ate is distinct from old.validade_ate
     or new.valor_aluguel is distinct from old.valor_aluguel
     or new.valor_encargos is distinct from old.valor_encargos
     -- Imóvel travado (a aprovação vale para este imóvel); só sai se o próprio imóvel for excluído (on delete set null).
     or (new.imovel_id is distinct from old.imovel_id
         and not (new.imovel_id is null and not exists (select 1 from public.imoveis where id = old.imovel_id)))
     or (new.candidato_id is distinct from old.candidato_id and coalesce(current_setting('analise.juntando', true), '') <> 'on')) then
    raise exception 'A análise já foi decidida: reabra para mudar imóvel, valores, candidato ou a decisão.';
  elsif new.decisao is null then
    -- Sem decisão, os campos de decisão ficam vazios (não dá para "decidir" por fora).
    new.decisao_justificativa := null;
    new.decisao_condicoes := null;
    new.fora_da_regra := '{}';
    new.excecao := false;
    new.excecao_justificativa := null;
    new.decidido_em := null;
    new.decidido_por := null;
    new.validade_ate := null;
  end if;

  if new.candidato_id is distinct from old.candidato_id then
    perform privado.analise_evento(new.organizacao_id, new.id, 'candidato',
      case when coalesce(current_setting('analise.juntando', true), '') = 'on' then 'Cadastro do candidato juntado com um cadastro repetido'
           else 'Candidato trocado' end,
      jsonb_build_object('antes', old.candidato_id, 'depois', new.candidato_id));
  end if;

  -- Contrato
  if new.contrato_id is distinct from old.contrato_id then
    if new.contrato_id is not null and coalesce(new.decisao, '') not in ('aprovado','aprovado_condicoes') then
      raise exception 'Só um candidato aprovado pode virar contrato.';
    end if;
    perform privado.analise_evento(new.organizacao_id, new.id,
      case when new.contrato_id is null then 'contrato_desvinculado' else 'convertida' end,
      case when new.contrato_id is null then 'Contrato desvinculado da análise' else 'Candidato virou contrato' end,
      null, coalesce(new.contrato_id, old.contrato_id));
  end if;

  -- Desistência e situação final
  if new.status = 'desistencia' and old.status <> 'desistencia' then
    perform privado.analise_evento(new.organizacao_id, new.id, 'desistencia', 'Candidato desistiu' || coalesce(': ' || nullif(btrim(new.desistencia_motivo), ''), ''));
  elsif old.status = 'desistencia' and new.status <> 'desistencia' then
    perform privado.analise_evento(new.organizacao_id, new.id, 'retomada', 'Análise retomada');
  end if;
  new.status := case
    when new.contrato_id is not null then 'contratada'
    when new.status = 'desistencia' and new.decisao is distinct from 'reprovado' then 'desistencia'
    when new.decisao = 'aprovado' then 'aprovada'
    when new.decisao = 'aprovado_condicoes' then 'aprovada_condicoes'
    when new.decisao = 'reprovado' then 'reprovada'
    else 'em_analise' end;

  -- Conferência da identidade (quem e quando)
  if new.identidade_conferida_em is distinct from old.identidade_conferida_em then
    new.identidade_conferida_por := case when new.identidade_conferida_em is null then null else auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.id, 'identidade',
      case when new.identidade_conferida_em is null then 'Conferência do documento desfeita' else 'Documento de identidade do candidato conferido' end);
  else
    new.identidade_conferida_por := old.identidade_conferida_por;
  end if;

  -- Consentimento (LGPD)
  if new.consentimento_em is distinct from old.consentimento_em then
    perform privado.analise_evento(new.organizacao_id, new.id, 'consentimento',
      case when new.consentimento_em is null then 'Autorização de consulta retirada'
           else 'Autorização de consulta registrada (' || coalesce(new.consentimento_origem, 'sem origem') || ')' end);
  end if;
  return new;
end;
$$;
create or replace trigger analises_regras_trg before insert or update or delete on public.analises
  for each row execute function privado.analises_regras();

/** Criação e exclusão da análise vão para a auditoria. */
create or replace function privado.analises_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  if tg_op = 'INSERT' then
    select nome into v_nome from public.pessoas where id = new.candidato_id;
    perform privado.analise_evento(new.organizacao_id, new.id, 'criada', 'Análise #' || new.numero || ' aberta para ' || coalesce(v_nome, 'candidato'));
    return new;
  end if;
  select nome into v_nome from public.pessoas where id = old.candidato_id;
  perform privado.analise_evento(old.organizacao_id, old.id, 'excluida', 'Análise #' || old.numero || ' de ' || coalesce(v_nome, 'candidato') || ' excluída',
    jsonb_build_object('status', old.status, 'decisao', old.decisao, 'justificativa', old.decisao_justificativa,
                       'excecao', old.excecao, 'aluguel', old.valor_aluguel, 'encargos', old.valor_encargos));
  return old;
end;
$$;
create or replace trigger analises_auditoria_trg after insert or delete on public.analises
  for each row execute function privado.analises_auditoria();

/** Fiadores: organização da análise, quem analisou, eventos. */
create or replace function privado.analise_fiadores_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    select nome into v_nome from public.pessoas where id = old.pessoa_id;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'fiador', 'Fiador removido: ' || coalesce(v_nome, '—'));
    return old;
  end if;
  select nome into v_nome from public.pessoas where id = new.pessoa_id;
  if tg_op = 'INSERT' then
    new.organizacao_id := privado.analise_org_de(new.analise_id, null);
    -- Aprovar/reprovar fiador conta para a regra ("garantia aprovada"): só quem decide análises.
    if new.status <> 'pendente' and auth.uid() is not null
       and coalesce(privado.analise_papel(new.organizacao_id), '') not in ('admin','gestor','financeiro') then
      raise exception 'Só administrador, gestor ou financeiro aprovam ou reprovam fiador.';
    end if;
    new.analisado_em := case when new.status = 'pendente' then null else now() end;
    new.analisado_por := case when new.status = 'pendente' then null else auth.uid() end;
    new.identidade_conferida_por := case when new.identidade_conferida_em is null then null else auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'fiador', 'Fiador incluído: ' || coalesce(v_nome, '—'));
    return new;
  end if;
  new.organizacao_id := old.organizacao_id;
  new.analise_id := old.analise_id;
  if new.status is distinct from old.status then
    if auth.uid() is not null and coalesce(privado.analise_papel(new.organizacao_id), '') not in ('admin','gestor','financeiro') then
      raise exception 'Só administrador, gestor ou financeiro aprovam ou reprovam fiador.';
    end if;
    new.analisado_em := case when new.status = 'pendente' then null else now() end;
    new.analisado_por := case when new.status = 'pendente' then null else auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'fiador',
      'Fiador ' || coalesce(v_nome, '—') || ': ' || case new.status when 'aprovado' then 'aprovado' when 'reprovado' then 'reprovado' else 'volta a pendente' end
        || coalesce(' — ' || nullif(btrim(new.parecer), ''), ''));
  else
    new.analisado_em := old.analisado_em;
    new.analisado_por := old.analisado_por;
  end if;
  if new.identidade_conferida_em is distinct from old.identidade_conferida_em then
    new.identidade_conferida_por := case when new.identidade_conferida_em is null then null else auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'identidade',
      case when new.identidade_conferida_em is null then 'Conferência do documento do fiador desfeita' else 'Documento do fiador ' || coalesce(v_nome, '') || ' conferido' end);
  else
    new.identidade_conferida_por := old.identidade_conferida_por;
  end if;
  if new.consentimento_em is distinct from old.consentimento_em and new.consentimento_em is not null then
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'consentimento',
      'Autorização de consulta do fiador ' || coalesce(v_nome, '') || ' registrada (' || coalesce(new.consentimento_origem, 'sem origem') || ')');
  end if;
  return new;
end;
$$;
create or replace trigger analise_fiadores_trg before insert or update or delete on public.analise_fiadores
  for each row execute function privado.analise_fiadores_trg();

/** Rendas: quem comprovou e quando; exclusão vai para a auditoria. */
create or replace function privado.analise_rendas_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    -- Saindo junto com a análise ou com o fiador (cascata): o evento da exclusão principal já conta.
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    if old.fiador_id is not null and not exists (select 1 from public.analise_fiadores where id = old.fiador_id) then return old; end if;
    -- Ficha reenviada pelo candidato troca as rendas ainda não comprovadas (o envio já vira evento).
    if auth.uid() is null and old.origem = 'ficha' and old.valor_comprovado is null then return old; end if;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'renda',
      'Renda excluída: ' || coalesce(nullif(btrim(old.fonte), ''), old.tipo)
        || ' — declarada R$ ' || replace(old.valor_declarado::text, '.', ',')
        || coalesce(', comprovada R$ ' || replace(old.valor_comprovado::text, '.', ','), ''),
      jsonb_build_object('tipo', old.tipo, 'fonte', old.fonte, 'titular', old.titular, 'fiador_id', old.fiador_id,
                         'valor_declarado', old.valor_declarado, 'valor_comprovado', old.valor_comprovado));
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.organizacao_id := privado.analise_org_de(new.analise_id, new.fiador_id);
    if new.valor_comprovado is not null then
      new.comprovado_em := now();
      new.comprovado_por := auth.uid();
      perform privado.analise_evento(new.organizacao_id, new.analise_id, 'renda',
        'Renda comprovada: ' || coalesce(nullif(btrim(new.fonte), ''), new.tipo) || ' — R$ ' || replace(new.valor_comprovado::text, '.', ','));
    else
      new.comprovado_em := null;
      new.comprovado_por := null;
    end if;
    return new;
  end if;
  new.organizacao_id := old.organizacao_id;
  new.analise_id := old.analise_id;
  if new.fiador_id is distinct from old.fiador_id then
    perform privado.analise_org_de(new.analise_id, new.fiador_id);
  end if;
  if new.valor_comprovado is distinct from old.valor_comprovado then
    new.comprovado_em := case when new.valor_comprovado is null then null else now() end;
    new.comprovado_por := case when new.valor_comprovado is null then null else auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'renda',
      case when new.valor_comprovado is null then 'Comprovação de renda desfeita: ' || coalesce(nullif(btrim(new.fonte), ''), new.tipo)
           else 'Renda comprovada: ' || coalesce(nullif(btrim(new.fonte), ''), new.tipo) || ' — R$ ' || replace(new.valor_comprovado::text, '.', ',') end);
  else
    new.comprovado_em := old.comprovado_em;
    new.comprovado_por := old.comprovado_por;
  end if;
  return new;
end;
$$;
create or replace trigger analise_rendas_trg before insert or update or delete on public.analise_rendas
  for each row execute function privado.analise_rendas_trg();

/** Documentos: validado/recusado por quem e quando (motivo obrigatório na recusa); exclusão vai para a auditoria. */
create or replace function privado.analise_documentos_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    if old.fiador_id is not null and not exists (select 1 from public.analise_fiadores where id = old.fiador_id) then return old; end if;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'documento',
      'Documento tirado do checklist: ' || old.rotulo || ' (estava ' || case old.status when 'validado' then 'validado'
        when 'recusado' then 'recusado' when 'dispensado' then 'dispensado' when 'recebido' then 'recebido' else 'pendente' end || ')',
      jsonb_build_object('status', old.status, 'obrigatorio', old.obrigatorio, 'validado_por', old.validado_por, 'validado_em', old.validado_em));
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.organizacao_id := privado.analise_org_de(new.analise_id, new.fiador_id);
    new.validado_em := case when new.status in ('validado','recusado','dispensado') then now() end;
    new.validado_por := case when new.status in ('validado','recusado','dispensado') then auth.uid() end;
    return new;
  end if;
  new.organizacao_id := old.organizacao_id;
  new.analise_id := old.analise_id;
  if new.status is distinct from old.status then
    if new.status = 'recusado' and length(btrim(coalesce(new.motivo_recusa, ''))) < 3 then
      raise exception 'Informe o motivo da recusa do documento.';
    end if;
    if new.status <> 'recusado' then new.motivo_recusa := null; end if;
    new.validado_em := case when new.status in ('validado','recusado','dispensado') then now() end;
    new.validado_por := case when new.status in ('validado','recusado','dispensado') then auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'documento',
      new.rotulo || ': ' || case new.status when 'validado' then 'validado' when 'recusado' then 'recusado — ' || btrim(new.motivo_recusa)
        when 'dispensado' then 'dispensado' when 'recebido' then 'recebido' else 'volta a pendente' end);
  else
    new.validado_em := old.validado_em;
    new.validado_por := old.validado_por;
  end if;
  return new;
end;
$$;
create or replace trigger analise_documentos_trg before insert or update or delete on public.analise_documentos
  for each row execute function privado.analise_documentos_trg();

/** Arquivos: organização da análise e documento da mesma análise. */
create or replace function privado.analise_arquivos_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'arquivo', 'Arquivo excluído: ' || coalesce(old.nome, 'arquivo'));
    return old;
  end if;
  new.organizacao_id := privado.analise_org_de(new.analise_id, null);
  if new.documento_id is not null and not exists (select 1 from public.analise_documentos where id = new.documento_id and analise_id = new.analise_id) then
    raise exception 'Este documento é de outra análise.';
  end if;
  perform privado.analise_evento(new.organizacao_id, new.analise_id, 'arquivo',
    case when new.enviado_pela_ficha then 'Candidato enviou pela ficha online: ' else 'Arquivo enviado: ' end || coalesce(new.nome, 'arquivo'));
  return new;
end;
$$;
create or replace trigger analise_arquivos_trg before insert or delete on public.analise_arquivos
  for each row execute function privado.analise_arquivos_trg();

/** Consultas de crédito: quem consultou e base legal (LGPD). */
create or replace function privado.analise_consultas_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rotulo text;
  v_consent timestamptz;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'consulta_excluida',
      'Consulta de crédito excluída (' || old.bureau || ', ' || to_char(old.consultado_em, 'DD/MM/YYYY') || ')',
      jsonb_build_object('score', old.score, 'restricoes', old.restricoes, 'base_legal', old.base_legal));
    return old;
  end if;
  if tg_op = 'UPDATE' then
    raise exception 'Consulta de crédito registrada não se altera. Exclua e registre de novo.';
  end if;
  new.organizacao_id := privado.analise_org_de(new.analise_id, new.fiador_id);
  if auth.uid() is not null then new.consultado_por := auth.uid(); end if;
  if new.consultado_em > current_date then
    raise exception 'A data da consulta não pode ser no futuro.';
  end if;
  if new.base_legal = 'consentimento' and new.consentimento_em is null then
    if new.fiador_id is null then
      select consentimento_em into v_consent from public.analises where id = new.analise_id;
    else
      select consentimento_em into v_consent from public.analise_fiadores where id = new.fiador_id;
    end if;
    new.consentimento_em := v_consent;
    if new.consentimento_em is null then
      raise exception 'Registre a autorização (consentimento) antes da consulta, ou use a base legal "proteção do crédito" (LGPD art. 7º, X).';
    end if;
  end if;
  v_rotulo := case new.bureau when 'serasa' then 'Serasa' when 'spc' then 'SPC' when 'boa_vista' then 'Boa Vista' when 'quod' then 'Quod' else coalesce(new.bureau_nome, 'outro birô') end;
  perform privado.analise_evento(new.organizacao_id, new.analise_id, 'consulta',
    'Consulta de crédito (' || v_rotulo || ')' || coalesce(' — score ' || new.score, '') || case when new.restricoes then ' — com restrições' else ' — sem restrições' end
      || ' · base legal: ' || case new.base_legal when 'consentimento' then 'consentimento (art. 7º, I)' else 'proteção do crédito (art. 7º, X)' end,
    jsonb_build_object('bureau', new.bureau, 'score', new.score, 'restricoes', new.restricoes, 'base_legal', new.base_legal, 'fiador_id', new.fiador_id));
  return new;
end;
$$;
create or replace trigger analise_consultas_trg before insert or update or delete on public.analise_consultas
  for each row execute function privado.analise_consultas_trg();

/** Garantias propostas: datas de solicitação/resposta e eventos. */
create or replace function privado.analise_garantias_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rot text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'garantia', 'Garantia proposta excluída (' || old.tipo || ')');
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.organizacao_id := privado.analise_org_de(new.analise_id, new.fiador_id);
  else
    new.organizacao_id := old.organizacao_id;
    new.analise_id := old.analise_id;
    if new.fiador_id is distinct from old.fiador_id then
      perform privado.analise_org_de(new.analise_id, new.fiador_id);
    end if;
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status in ('solicitada','em_analise') then
      new.solicitada_em := coalesce(new.solicitada_em, current_date);
    end if;
    if new.status in ('aprovada','aprovada_restricao','recusada') then
      new.respondida_em := coalesce(new.respondida_em, current_date);
    end if;
    v_rot := case new.tipo when 'fiador' then 'Fiança' when 'caucao' then 'Caução' when 'seguro_fianca' then 'Seguro-fiança'
      when 'titulo_capitalizacao' then 'Título de capitalização' when 'carta_fianca' then 'Carta-fiança' else 'Garantia' end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'garantia',
      v_rot || coalesce(' (' || nullif(btrim(new.garantidora), '') || ')', '') || ': '
        || case new.status when 'proposta' then 'proposta' when 'solicitada' then 'solicitada à garantidora' when 'em_analise' then 'em análise na garantidora'
             when 'aprovada' then 'aprovada' when 'aprovada_restricao' then 'aprovada com restrição' when 'recusada' then 'recusada'
             when 'cancelada' then 'cancelada' else 'levada ao contrato' end
        || coalesce(' — ' || nullif(btrim(new.resposta), ''), ''),
      jsonb_build_object('status', new.status, 'tipo', new.tipo));
  end if;
  return new;
end;
$$;
create or replace trigger analise_garantias_trg before insert or update or delete on public.analise_garantias
  for each row execute function privado.analise_garantias_trg();

/** Regras só por admin/gestor. */
create or replace function privado.analise_config_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is not null and coalesce(privado.analise_papel(new.organizacao_id), '') not in ('admin','gestor') then
    raise exception 'Só administradores e gestores mudam as regras da análise cadastral.';
  end if;
  if tg_op = 'INSERT' then
    -- Salvar a tela usa "insert ... on conflict do update": se a linha já existe, este insert
    -- vira update e o evento sai lá (sem gravar dois "Regras alteradas" iguais).
    if exists (select 1 from public.analise_config where organizacao_id = new.organizacao_id) then
      return new;
    end if;
  else
    new.organizacao_id := old.organizacao_id;
    new.atualizado_em := old.atualizado_em;
    new.atualizado_por := old.atualizado_por;
    -- Salvamento automático sem mudança de verdade: não grava evento nem data.
    if row(new.*) is not distinct from row(old.*) then
      return new;
    end if;
  end if;
  new.atualizado_em := now();
  new.atualizado_por := auth.uid();
  perform privado.analise_evento(new.organizacao_id, null, 'regras',
    'Regras da análise: comprometimento até ' || replace(trim_scale(new.limite_comprometimento_pct)::text, '.', ',') || '%'
      || ', fiador com ' || replace(trim_scale(new.renda_fiador_multiplo)::text, '.', ',') || '× o aluguel'
      || coalesce(', score mínimo ' || new.score_minimo, '')
      || case when new.aceitar_restricoes then ', aceita restrições' else '' end
      || case when new.exigir_consulta then '' else ', consulta não obrigatória' end
      || case when new.exigir_garantia then '' else ', garantia não obrigatória' end);
  return new;
end;
$$;
create or replace trigger analise_config_trg before insert or update on public.analise_config
  for each row execute function privado.analise_config_trg();

/** Solicitações de renovação: organização do contrato, vencimento atual, eventos. */
create or replace function privado.garantia_renovacoes_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.contrato_garantias%rowtype;
  c public.contratos%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Saindo junto com o contrato ou a garantia (cascata): sem evento.
    if not exists (select 1 from public.contratos where id = old.contrato_id) then return old; end if;
    if old.contrato_garantia_id is not null and not exists (select 1 from public.contrato_garantias where id = old.contrato_garantia_id) then return old; end if;
    perform privado.analise_evento(old.organizacao_id, null, 'renovacao_excluida',
      'Registro de renovação excluído (' || case old.objeto when 'garantia' then 'garantia' else 'seguro incêndio' end || ', '
        || case old.status when 'solicitada' then 'solicitada' when 'renovada' then 'renovada' when 'recusada' then 'recusada' else 'cancelada' end
        || ' em ' || to_char(old.solicitada_em, 'DD/MM/YYYY') || ')',
      jsonb_build_object('status', old.status, 'canal', old.canal, 'destinatario', old.destinatario, 'fim_anterior', old.fim_anterior,
                         'nova_fim', old.nova_fim, 'novo_numero', old.novo_numero, 'novo_valor', old.novo_valor),
      old.contrato_id);
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.objeto = 'garantia' then
      select * into g from public.contrato_garantias where id = new.contrato_garantia_id;
      if not found then raise exception 'Garantia não encontrada.'; end if;
      new.contrato_id := g.contrato_id;
      new.organizacao_id := g.organizacao_id;
      new.fim_anterior := g.fim;
    else
      new.contrato_garantia_id := null;
      select * into c from public.contratos where id = new.contrato_id;
      if not found then raise exception 'Contrato não encontrado.'; end if;
      new.organizacao_id := c.organizacao_id;
      new.fim_anterior := c.seguro_incendio_vencimento;
    end if;
    new.status := 'solicitada';
    perform privado.analise_evento(new.organizacao_id, null, 'renovacao_solicitada',
      'Renovação solicitada (' || case new.objeto when 'garantia' then 'garantia' else 'seguro incêndio' end || ') — '
        || new.destinatario || ' por ' || new.canal, null, new.contrato_id);
    return new;
  end if;
  new.organizacao_id := old.organizacao_id;
  new.contrato_id := old.contrato_id;
  new.contrato_garantia_id := old.contrato_garantia_id;
  new.objeto := old.objeto;
  if new.status is distinct from old.status then
    if old.status <> 'solicitada' then
      raise exception 'Esta solicitação já foi concluída.';
    end if;
    new.concluida_em := coalesce(new.concluida_em, current_date);
    perform privado.analise_evento(new.organizacao_id, null, 'renovacao_' || new.status,
      'Renovação ' || case new.status when 'renovada' then 'concluída' || coalesce(' até ' || to_char(new.nova_fim, 'DD/MM/YYYY'), '')
        when 'recusada' then 'recusada' else 'cancelada' end, null, new.contrato_id);
  end if;
  return new;
end;
$$;
create or replace trigger garantia_renovacoes_trg before insert or update or delete on public.garantia_renovacoes
  for each row execute function privado.garantia_renovacoes_trg();

/**
 * Juntar cadastros repetidos de pessoas: leva análises (candidato/corretor) e
 * fiadores do cadastro que sai para o que fica. Chamada por public.juntar_pessoas
 * (o bloco logo abaixo encaixa a chamada antes de apagar o repetido).
 */
create or replace function privado.analise_juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform set_config('analise.juntando', 'on', true);
  update public.analises set candidato_id = p_manter where candidato_id = p_remover;
  update public.analises set corretor_id = p_manter where corretor_id = p_remover;
  delete from public.analise_fiadores f
   where f.pessoa_id = p_remover
     and exists (select 1 from public.analise_fiadores x where x.analise_id = f.analise_id and x.pessoa_id = p_manter);
  update public.analise_fiadores set pessoa_id = p_manter where pessoa_id = p_remover;
  perform set_config('analise.juntando', '', true);
end;
$$;
revoke execute on function privado.analise_juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function privado.analise_juntar_pessoas(uuid, uuid) to authenticated;

/*
 * public.juntar_pessoas passa a levar as análises e os fiadores (sem isso, juntar
 * um candidato com o cadastro repetido falha na chave estrangeira).
 * A função é recriada A PARTIR DO CORPO QUE ESTIVER NO BANCO (pg_get_functiondef),
 * só acrescentando "perform privado.analise_juntar_pessoas(a.id, b.id);" antes de
 * "delete from public.pessoas where id = b.id;". Assim não se perde o que outras
 * migrações já puseram nela (ex.: repasses e comissões). Idempotente: se a chamada
 * já está lá, não faz nada. Sem DROP (create or replace; as permissões continuam).
 */
do $$
declare
  v_def text;
  v_novo text;
begin
  if to_regprocedure('public.juntar_pessoas(uuid, uuid)') is null then
    raise warning 'public.juntar_pessoas não existe: análises não entram no "juntar repetidos".';
    return;
  end if;
  v_def := pg_get_functiondef('public.juntar_pessoas(uuid, uuid)'::regprocedure);
  if v_def ilike '%privado.analise_juntar_pessoas%' then
    return;
  end if;
  v_novo := regexp_replace(v_def,
    '(\n[ \t]*)(delete[ \t]+from[ \t]+public\.pessoas[ \t]+where[ \t]+id[ \t]*=[ \t]*b\.id[ \t]*;)',
    '\1perform privado.analise_juntar_pessoas(a.id, b.id);\1\2', 'i');
  if v_novo = v_def then
    raise warning 'Não achei o "delete from public.pessoas where id = b.id;" em public.juntar_pessoas: inclua à mão a chamada a privado.analise_juntar_pessoas(a.id, b.id).';
    return;
  end if;
  execute v_novo;
end $$;

-- =============================================================================
-- RLS
-- =============================================================================
do $$
declare t text;
begin
  foreach t in array array['analise_config','analises','analise_fiadores','analise_rendas','analise_documentos','analise_arquivos',
                           'analise_consultas','analise_garantias','garantia_renovacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_org') then
      execute format($p$create policy %I on public.%I for all to authenticated
        using (organizacao_id in (select privado.org_ids()))
        with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
    end if;
  end loop;
end $$;

-- Auditoria: decisões só leitura; eventos leitura + anotação manual (tipo "nota").
alter table public.analise_decisoes enable row level security;
alter table public.analise_eventos enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'analise_decisoes' and policyname = 'analise_decisoes_ler') then
    create policy analise_decisoes_ler on public.analise_decisoes for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'analise_eventos' and policyname = 'analise_eventos_ler') then
    create policy analise_eventos_ler on public.analise_eventos for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'analise_eventos' and policyname = 'analise_eventos_nota') then
    create policy analise_eventos_nota on public.analise_eventos for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and tipo = 'nota' and usuario_id is not distinct from auth.uid());
  end if;
end $$;

-- =============================================================================
-- RPCs da equipe
-- =============================================================================

/**
 * Liga a análise aprovada ao contrato criado e leva as garantias aprovadas
 * (seguro, caução, título, carta-fiança e fiadores) para contrato_garantias.
 * Devolve quantas garantias foram criadas no contrato.
 */
create or replace function public.levar_garantias_contrato(p_analise uuid, p_contrato uuid)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  a public.analises%rowtype;
  c public.contratos%rowtype;
  g record;
  v_gid uuid;
  v_n int := 0;
  v_principal text;
  v_valor numeric;
begin
  select * into a from public.analises where id = p_analise for update;
  if not found then raise exception 'Análise não encontrada.'; end if;
  select * into c from public.contratos where id = p_contrato;
  if not found or c.organizacao_id <> a.organizacao_id then raise exception 'Contrato não encontrado.'; end if;
  if coalesce(a.decisao, '') not in ('aprovado','aprovado_condicoes') then
    raise exception 'Só um candidato aprovado pode virar contrato.';
  end if;
  if a.contrato_id is not null and a.contrato_id <> p_contrato then
    raise exception 'Esta análise já está ligada a outro contrato.';
  end if;
  if a.contrato_id is null then
    update public.analises set contrato_id = p_contrato where id = a.id;
  end if;

  for g in
    select ag.*, f.pessoa_id as fiador_pessoa
      from public.analise_garantias ag
      left join public.analise_fiadores f on f.id = ag.fiador_id
     where ag.analise_id = a.id and ag.status in ('aprovada','aprovada_restricao','contratada') and ag.contrato_garantia_id is null
     order by ag.created_at
  loop
    insert into public.contrato_garantias (organizacao_id, contrato_id, tipo, pessoa_id, instituicao, numero, valor, inicio, fim, conta, observacoes)
    values (a.organizacao_id, p_contrato, g.tipo, g.fiador_pessoa, g.garantidora, coalesce(g.apolice_numero, g.proposta_numero),
            g.valor, g.vigencia_inicio, g.vigencia_fim, g.conta, concat_ws(' · ', 'Da análise cadastral #' || a.numero, g.observacoes))
    returning id into v_gid;
    update public.analise_garantias set contrato_garantia_id = v_gid, status = 'contratada' where id = g.id;
    v_principal := coalesce(v_principal, g.tipo);
    v_valor := coalesce(v_valor, g.valor);
    v_n := v_n + 1;
  end loop;

  for g in
    select f.pessoa_id from public.analise_fiadores f
     where f.analise_id = a.id and f.status = 'aprovado'
       and not exists (select 1 from public.contrato_garantias cg where cg.contrato_id = p_contrato and cg.tipo = 'fiador' and cg.pessoa_id = f.pessoa_id)
  loop
    insert into public.contrato_garantias (organizacao_id, contrato_id, tipo, pessoa_id, observacoes)
    values (a.organizacao_id, p_contrato, 'fiador', g.pessoa_id, 'Da análise cadastral #' || a.numero);
    v_principal := coalesce(v_principal, 'fiador');
    v_n := v_n + 1;
  end loop;

  insert into public.contrato_partes (organizacao_id, contrato_id, pessoa_id, papel)
  select a.organizacao_id, p_contrato, f.pessoa_id, 'fiador' from public.analise_fiadores f
   where f.analise_id = a.id and f.status = 'aprovado'
  on conflict do nothing;

  -- Resumo do contrato (documento) acompanha a garantia principal.
  if v_principal in ('fiador','caucao','seguro_fianca','titulo_capitalizacao') then
    update public.contratos set garantia_tipo = v_principal, garantia_valor = coalesce(garantia_valor, v_valor)
     where id = p_contrato and garantia_tipo = 'sem_garantia';
  end if;
  return v_n;
end;
$$;
revoke execute on function public.levar_garantias_contrato(uuid, uuid) from public, anon;
grant execute on function public.levar_garantias_contrato(uuid, uuid) to authenticated;

/**
 * Conclui a renovação: grava o novo vencimento (e nº/valor) na garantia do
 * contrato ou no seguro incêndio, e marca a solicitação como renovada.
 * p: { nova_fim, numero, valor, premio, observacoes }
 */
create or replace function public.concluir_renovacao_garantia(p_id uuid, p jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.garantia_renovacoes%rowtype;
  g public.contrato_garantias%rowtype;
  c public.contratos%rowtype;
  v_fim date := nullif(p->>'nova_fim', '')::date;
  v_numero text := nullif(btrim(coalesce(p->>'numero', '')), '');
  v_valor numeric := privado.analise_num(p->>'valor');
  v_premio numeric := privado.analise_num(p->>'premio');
begin
  select * into r from public.garantia_renovacoes where id = p_id for update;
  if not found then raise exception 'Solicitação de renovação não encontrada.'; end if;
  if r.status <> 'solicitada' then raise exception 'Esta solicitação já foi concluída.'; end if;
  if v_fim is null then raise exception 'Informe o novo vencimento.'; end if;
  if r.objeto = 'garantia' then
    select * into g from public.contrato_garantias where id = r.contrato_garantia_id for update;
    if not found then raise exception 'Garantia não encontrada.'; end if;
    if g.status not in ('ativa','vencida') then raise exception 'Esta garantia já foi encerrada, devolvida ou executada.'; end if;
    if g.fim is not null and v_fim <= g.fim then
      raise exception 'O novo vencimento precisa ser depois do atual (%).', to_char(g.fim, 'DD/MM/YYYY');
    end if;
    update public.contrato_garantias
       set fim = v_fim, numero = coalesce(v_numero, numero), valor = coalesce(v_valor, valor), status = 'ativa'
     where id = g.id;
  else
    select * into c from public.contratos where id = r.contrato_id for update;
    if not found then raise exception 'Contrato não encontrado.'; end if;
    if c.seguro_incendio_vencimento is not null and v_fim <= c.seguro_incendio_vencimento then
      raise exception 'O novo vencimento precisa ser depois do atual (%).', to_char(c.seguro_incendio_vencimento, 'DD/MM/YYYY');
    end if;
    update public.contratos
       set seguro_incendio_vencimento = v_fim, seguro_incendio_apolice = coalesce(v_numero, seguro_incendio_apolice)
     where id = c.id;
  end if;
  update public.garantia_renovacoes
     set status = 'renovada', nova_fim = v_fim, novo_numero = v_numero, novo_valor = v_valor, novo_premio = v_premio,
         concluida_em = current_date, observacoes = coalesce(nullif(btrim(coalesce(p->>'observacoes', '')), ''), observacoes)
   where id = r.id;
end;
$$;
revoke execute on function public.concluir_renovacao_garantia(uuid, jsonb) from public, anon;
grant execute on function public.concluir_renovacao_garantia(uuid, jsonb) to authenticated;

/**
 * Renovação registrada sem pedido antes: cria a solicitação e conclui na mesma
 * transação (se a conclusão falhar, nada fica gravado — nem o evento).
 * p: { objeto, contrato_id, contrato_garantia_id, nova_fim, numero, valor, premio, observacoes }
 */
create or replace function public.registrar_renovacao_garantia(p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_objeto text := case when p->>'objeto' = 'seguro_incendio' then 'seguro_incendio' else 'garantia' end;
  v_id uuid;
begin
  if coalesce(p->>'contrato_id', '') !~* '^[0-9a-f-]{36}$' then raise exception 'Contrato não encontrado.'; end if;
  if v_objeto = 'garantia' and coalesce(p->>'contrato_garantia_id', '') !~* '^[0-9a-f-]{36}$' then raise exception 'Garantia não encontrada.'; end if;
  insert into public.garantia_renovacoes (objeto, contrato_id, contrato_garantia_id, canal, destinatario)
  values (v_objeto, (p->>'contrato_id')::uuid,
          case when v_objeto = 'garantia' then (p->>'contrato_garantia_id')::uuid end, 'outro', 'outro')
  returning id into v_id;
  perform public.concluir_renovacao_garantia(v_id, p);
  return v_id;
end;
$$;
revoke execute on function public.registrar_renovacao_garantia(jsonb) from public, anon;
grant execute on function public.registrar_renovacao_garantia(jsonb) to authenticated;

-- =============================================================================
-- Ficha online (/ficha/[token]) — escrita pública só por estas RPCs
-- =============================================================================

create or replace function privado.analise_texto_consentimento(p_org uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select nullif(btrim(texto_consentimento), '') from public.analise_config where organizacao_id = p_org),
    'Autorizo ' || coalesce((select nome from public.organizacoes where id = p_org), 'a administradora')
      || ' a consultar meu CPF/CNPJ em birôs de crédito (Serasa, SPC, Boa Vista e similares) e a tratar os dados e documentos'
      || ' que envio aqui somente para analisar esta locação, conforme a Lei Geral de Proteção de Dados (Lei 13.709/2018).'
      || ' Posso pedir a exclusão dos meus dados quando a análise terminar, salvo o que a lei obriga a guardar.');
$$;
revoke execute on function privado.analise_texto_consentimento(uuid) from public, anon;

/** A ficha deste token está aberta para o candidato? */
create or replace function privado.analise_ficha(p_token uuid)
returns public.analises
language sql
stable
security definer
set search_path = public
as $$
  select a.* from public.analises a
   where a.token = p_token and a.ficha_ativa and a.decisao is null and a.status = 'em_analise'
     and (a.ficha_expira_em is null or a.ficha_expira_em >= current_date)
$$;
revoke execute on function privado.analise_ficha(uuid) from public, anon;

/** Usado pela policy do Storage: o candidato pode enviar arquivo para ficha/<token>/? */
create or replace function public.analise_ficha_aceita_upload(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_token !~* '^[0-9a-f-]{36}$' then return false; end if;
  return (select a.id from privado.analise_ficha(p_token::uuid) a) is not null;
end;
$$;
revoke execute on function public.analise_ficha_aceita_upload(text) from public;
grant execute on function public.analise_ficha_aceita_upload(text) to anon, authenticated;

/**
 * Arquivo enviado pela ficha (ficha/<token>/...) é de uma análise da minha organização?
 * Vale pelo registro do arquivo (continua valendo se o link da ficha for trocado) ou pelo token atual.
 */
create or replace function privado.analise_arquivo_da_org(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := split_part(coalesce(p_path, ''), '/', 2);
begin
  if exists (select 1 from public.analise_arquivos f where f.path = p_path and f.organizacao_id in (select privado.org_ids())) then
    return true;
  end if;
  if v_token !~* '^[0-9a-f-]{36}$' then return false; end if;
  return exists (select 1 from public.analises a where a.token = v_token::uuid and a.organizacao_id in (select privado.org_ids()));
end;
$$;
revoke execute on function privado.analise_arquivo_da_org(text) from public, anon;
grant execute on function privado.analise_arquivo_da_org(text) to authenticated;

create or replace function public.ficha_info(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.analises%rowtype;
  v_nome text;
  v_tipo text;
begin
  select * into a from privado.analise_ficha(p_token);
  if a.id is null then return null; end if;
  select nome, tipo_pessoa into v_nome, v_tipo from public.pessoas where id = a.candidato_id;
  return jsonb_build_object(
    'organizacao', (select nome from public.organizacoes where id = a.organizacao_id),
    'nome', v_nome,
    'tipo_pessoa', v_tipo,
    'imovel', (select jsonb_build_object('codigo', i.codigo, 'endereco', concat_ws(', ', i.logradouro, i.numero, i.bairro, i.cidade))
                 from public.imoveis i where i.id = a.imovel_id),
    'aluguel', a.valor_aluguel,
    'encargos', a.valor_encargos,
    'enviada_em', a.ficha_enviada_em,
    'consentimento_em', a.consentimento_em,
    'texto_consentimento', privado.analise_texto_consentimento(a.organizacao_id),
    'documentos', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'rotulo', d.rotulo, 'status', d.status, 'obrigatorio', d.obrigatorio,
                                                                  'parte', d.parte, 'motivo', d.motivo_recusa) order by d.ordem, d.created_at), '[]'::jsonb)
                     from public.analise_documentos d where d.analise_id = a.id and d.status in ('pendente','recusado','recebido')),
    'arquivos', (select count(*) from public.analise_arquivos f where f.analise_id = a.id and f.enviado_pela_ficha)
  );
end;
$$;
revoke execute on function public.ficha_info(uuid) from public;
grant execute on function public.ficha_info(uuid) to anon, authenticated;

/**
 * O candidato envia dados, fontes de renda e a autorização (LGPD).
 * p: { telefone, email, profissao, estado_civil, empregador, moradores, moradores_obs, observacoes,
 *      rendas: [{tipo, fonte, valor}], consentimento: true, ip, ua }
 */
create or replace function public.ficha_enviar(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.analises%rowtype;
  r jsonb;
  v_valor numeric;
  v_total numeric := 0;
  v_n int := 0;
  v_mor int;
begin
  select * into a from privado.analise_ficha(p_token);
  if a.id is null then raise exception 'Link inválido ou expirado.'; end if;
  if coalesce((p->>'consentimento')::boolean, false) is not true then
    raise exception 'Para enviar, marque a autorização de consulta e uso dos dados (LGPD).';
  end if;
  perform 1 from public.analises where id = a.id for update;

  -- Contato: só completa o que está vazio no cadastro.
  update public.pessoas
     set telefone = coalesce(nullif(btrim(telefone), ''), left(nullif(btrim(coalesce(p->>'telefone', '')), ''), 30)),
         email = coalesce(nullif(btrim(email), ''), left(nullif(btrim(coalesce(p->>'email', '')), ''), 160)),
         profissao = coalesce(nullif(btrim(profissao), ''), left(nullif(btrim(coalesce(p->>'profissao', '')), ''), 120)),
         estado_civil = coalesce(nullif(btrim(estado_civil), ''), left(nullif(btrim(coalesce(p->>'estado_civil', '')), ''), 40))
   where id = a.candidato_id;

  -- Rendas da ficha: substitui as anteriores que a equipe ainda não comprovou.
  delete from public.analise_rendas where analise_id = a.id and origem = 'ficha' and valor_comprovado is null;
  for r in select value from jsonb_array_elements(case when jsonb_typeof(p->'rendas') = 'array' then p->'rendas' else '[]'::jsonb end)
  loop
    exit when v_n >= 5;
    v_valor := privado.analise_num(r->>'valor');
    if v_valor is not null and v_valor > 0 and v_valor < 10000000 then
      insert into public.analise_rendas (organizacao_id, analise_id, tipo, fonte, valor_declarado, origem)
      values (a.organizacao_id, a.id,
              case when r->>'tipo' in ('clt','servidor','pro_labore','autonomo','empresario','aposentadoria','pensao','aluguel','investimentos','beneficio','outro')
                   then r->>'tipo' else 'outro' end,
              left(nullif(btrim(coalesce(r->>'fonte', '')), ''), 160), v_valor, 'ficha');
      v_total := v_total + v_valor;
      v_n := v_n + 1;
    end if;
  end loop;

  v_mor := privado.analise_num(p->>'moradores')::int;
  update public.analises
     set ficha_enviada_em = now(),
         ficha_dados = jsonb_strip_nulls(jsonb_build_object(
           'telefone', left(p->>'telefone', 30), 'email', left(p->>'email', 160), 'profissao', left(p->>'profissao', 120),
           'estado_civil', left(p->>'estado_civil', 40), 'empregador', left(p->>'empregador', 160),
           'observacoes', left(p->>'observacoes', 2000), 'enviado_em', now())),
         moradores = case when v_mor between 0 and 50 then v_mor else moradores end,
         moradores_obs = coalesce(left(nullif(btrim(coalesce(p->>'moradores_obs', '')), ''), 500), moradores_obs),
         renda_declarada = case when v_total > 0 then v_total else renda_declarada end,
         consentimento_em = coalesce(consentimento_em, now()),
         consentimento_origem = coalesce(consentimento_origem, 'ficha online'),
         consentimento_ip = coalesce(consentimento_ip, left(p->>'ip', 64)),
         consentimento_texto = coalesce(consentimento_texto, privado.analise_texto_consentimento(a.organizacao_id))
   where id = a.id;
  perform privado.analise_evento(a.organizacao_id, a.id, 'ficha_enviada',
    'Candidato enviou a ficha online' || case when v_n > 0 then ' com ' || v_n || ' fonte(s) de renda' else '' end,
    jsonb_build_object('ip', left(p->>'ip', 64), 'navegador', left(p->>'ua', 200)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.ficha_enviar(uuid, jsonb) from public;
grant execute on function public.ficha_enviar(uuid, jsonb) to anon, authenticated;

/** O candidato registra um arquivo que acabou de subir para ficha/<token>/. p: { path, nome, documento_id } */
create or replace function public.ficha_registrar_arquivo(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.analises%rowtype;
  v_path text := coalesce(p->>'path', '');
  v_prefixo text := 'ficha/' || p_token::text || '/';
  v_doc uuid;
begin
  select * into a from privado.analise_ficha(p_token);
  if a.id is null then raise exception 'Link inválido ou expirado.'; end if;
  if left(v_path, length(v_prefixo)) <> v_prefixo or length(v_path) > 300 or v_path like '%..%' then
    raise exception 'Arquivo inválido.';
  end if;
  if (select count(*) from public.analise_arquivos where analise_id = a.id and enviado_pela_ficha) >= 40 then
    raise exception 'Limite de arquivos desta ficha atingido. Fale com quem enviou o link.';
  end if;
  if coalesce(p->>'documento_id', '') ~* '^[0-9a-f-]{36}$' then
    select id into v_doc from public.analise_documentos where id = (p->>'documento_id')::uuid and analise_id = a.id;
  end if;
  insert into public.analise_arquivos (organizacao_id, analise_id, documento_id, path, nome, enviado_pela_ficha, enviado_por)
  values (a.organizacao_id, a.id, v_doc, v_path, left(coalesce(p->>'nome', 'arquivo'), 160), true, null);
  if v_doc is not null then
    update public.analise_documentos set status = 'recebido' where id = v_doc and status in ('pendente','recusado');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.ficha_registrar_arquivo(uuid, jsonb) from public;
grant execute on function public.ficha_registrar_arquivo(uuid, jsonb) to anon, authenticated;

-- =============================================================================
-- Storage: bucket privado "analises"
--   equipe: <organizacao_id>/<analise_id>/...   candidato: ficha/<token>/...
-- =============================================================================
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('analises', 'analises', false, 10485760,
            array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'analises_ler') then
      execute $p$create policy analises_ler on storage.objects for select to authenticated
        using (bucket_id = 'analises' and (
          (storage.foldername(name))[1] in (select privado.org_ids()::text)
          or ((storage.foldername(name))[1] = 'ficha' and privado.analise_arquivo_da_org(name))))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'analises_gravar') then
      execute $p$create policy analises_gravar on storage.objects for insert to authenticated
        with check (bucket_id = 'analises' and (
          (storage.foldername(name))[1] in (select privado.org_ids()::text)
          or ((storage.foldername(name))[1] = 'ficha' and public.analise_ficha_aceita_upload((storage.foldername(name))[2]))))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'analises_apagar') then
      execute $p$create policy analises_apagar on storage.objects for delete to authenticated
        using (bucket_id = 'analises' and (
          (storage.foldername(name))[1] in (select privado.org_ids()::text)
          or ((storage.foldername(name))[1] = 'ficha' and privado.analise_arquivo_da_org(name))))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'analises_ficha_enviar') then
      execute $p$create policy analises_ficha_enviar on storage.objects for insert to anon
        with check (bucket_id = 'analises' and (storage.foldername(name))[1] = 'ficha'
                    and public.analise_ficha_aceita_upload((storage.foldername(name))[2]))$p$;
    end if;
  end if;
end $$;
