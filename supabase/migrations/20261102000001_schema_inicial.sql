-- =============================================================================
-- Sistema Novo Aluguel — esquema inicial
-- Multi-imobiliária: cada registro pertence a uma organização e o acesso é
-- isolado por Row Level Security (RLS) com base nos membros da organização.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Organizações (imobiliárias) e membros
-- -----------------------------------------------------------------------------
create table public.organizacoes (
  id uuid primary key default gen_random_uuid(),
  nome text not null,
  documento text,
  creci text,
  email text,
  telefone text,
  -- Padrões usados em novos contratos
  multa_atraso_pct numeric(6,3) not null default 10,
  juros_mes_pct numeric(6,3) not null default 1,
  taxa_administracao_pct numeric(6,3) not null default 10,
  taxa_intermediacao_pct numeric(6,3) not null default 100,
  carencia_dias int not null default 0,
  created_at timestamptz not null default now()
);

create table public.membros (
  organizacao_id uuid not null references public.organizacoes(id) on delete cascade,
  user_id uuid not null,
  papel text not null default 'admin' check (papel in ('admin','gestor','financeiro','corretor')),
  nome text,
  created_at timestamptz not null default now(),
  primary key (organizacao_id, user_id)
);
create index on public.membros (user_id);

-- Organizações do usuário logado (SECURITY DEFINER evita recursão de RLS).
create or replace function public.org_ids()
returns setof uuid
language sql stable security definer set search_path = ''
as $$
  select organizacao_id from public.membros where user_id = auth.uid()
$$;

-- Organização padrão do usuário (usada como default nas inserções).
create or replace function public.org_atual()
returns uuid
language sql stable security definer set search_path = ''
as $$
  select organizacao_id from public.membros
  where user_id = auth.uid()
  order by created_at
  limit 1
$$;

alter table public.organizacoes enable row level security;
alter table public.membros enable row level security;

create policy org_select on public.organizacoes for select to authenticated
  using (id in (select public.org_ids()));
create policy org_update on public.organizacoes for update to authenticated
  using (id in (select public.org_ids())) with check (id in (select public.org_ids()));

create policy membros_select on public.membros for select to authenticated
  using (organizacao_id in (select public.org_ids()));

-- Cria a imobiliária e torna o usuário atual administrador.
create or replace function public.criar_organizacao(p_nome text, p_documento text default null)
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Usuário não autenticado';
  end if;
  insert into public.organizacoes (nome, documento) values (p_nome, p_documento) returning id into v_id;
  insert into public.membros (organizacao_id, user_id, papel) values (v_id, auth.uid(), 'admin');

  -- Régua de cobrança padrão
  insert into public.regua_regras (organizacao_id, nome, dias_relativos, canal, assunto, mensagem) values
    (v_id, 'Lembrete 3 dias antes', -3, 'email', 'Seu aluguel vence em {{vencimento}}',
     'Olá {{nome}}, lembramos que o aluguel de {{competencia}} do imóvel {{imovel}}, no valor de {{valor}}, vence em {{vencimento}}.'),
    (v_id, 'Aviso no vencimento', 0, 'email', 'Seu aluguel vence hoje',
     'Olá {{nome}}, o aluguel de {{competencia}} ({{valor}}) vence hoje, {{vencimento}}.'),
    (v_id, 'Cobrança 3 dias após', 3, 'email', 'Aluguel em atraso',
     'Olá {{nome}}, não identificamos o pagamento do aluguel de {{competencia}} ({{valor}}), vencido em {{vencimento}}. Se já pagou, desconsidere.');
  return v_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- Macro para tabelas multi-organização: coluna, índice e políticas RLS
-- -----------------------------------------------------------------------------
create or replace function public._habilitar_rls_org(p_tabela text)
returns void
language plpgsql
as $$
begin
  execute format('alter table public.%I enable row level security', p_tabela);
  execute format('create index on public.%I (organizacao_id)', p_tabela);
  execute format($p$create policy %I on public.%I for all to authenticated
    using (organizacao_id in (select public.org_ids()))
    with check (organizacao_id in (select public.org_ids()))$p$, p_tabela || '_org', p_tabela);
end;
$$;

-- -----------------------------------------------------------------------------
-- Pessoas (proprietários, locatários, fiadores, clientes)
-- -----------------------------------------------------------------------------
create table public.pessoas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  tipo_pessoa text not null default 'PF' check (tipo_pessoa in ('PF','PJ')),
  nome text not null,
  documento text,
  rg_ie text,
  data_nascimento date,
  estado_civil text,
  profissao text,
  email text,
  telefone text,
  cep text, logradouro text, numero text, complemento text, bairro text, cidade text, uf text,
  banco text, agencia text, conta text, tipo_conta text, pix_chave text,
  papeis text[] not null default '{}',
  observacoes text,
  created_at timestamptz not null default now()
);
select public._habilitar_rls_org('pessoas');
create index on public.pessoas using gin (papeis);

-- -----------------------------------------------------------------------------
-- Imóveis
-- -----------------------------------------------------------------------------
create table public.imoveis (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  codigo text not null,
  finalidades text[] not null default '{locacao}',
  tipo text not null default 'apartamento',
  status text not null default 'disponivel' check (status in ('disponivel','alugado','vendido','reservado','inativo')),
  cep text, logradouro text, numero text, complemento text, bairro text, cidade text, uf text,
  area_util numeric(10,2), area_total numeric(10,2),
  quartos int, suites int, banheiros int, vagas int,
  valor_venda numeric(14,2), valor_aluguel numeric(14,2),
  valor_condominio numeric(14,2), valor_iptu numeric(14,2),
  titulo text,
  descricao text,
  caracteristicas text[] not null default '{}',
  matricula text,
  inscricao_iptu text,
  publicar_site boolean not null default false,
  created_at timestamptz not null default now(),
  unique (organizacao_id, codigo)
);
select public._habilitar_rls_org('imoveis');

create table public.imovel_proprietarios (
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete restrict,
  percentual numeric(6,3) not null default 100 check (percentual > 0 and percentual <= 100),
  primary key (imovel_id, pessoa_id)
);
select public._habilitar_rls_org('imovel_proprietarios');

-- Gestão de chaves
create table public.chaves (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  identificacao text not null,
  local text,
  created_at timestamptz not null default now()
);
select public._habilitar_rls_org('chaves');

create table public.chave_movimentacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  chave_id uuid not null references public.chaves(id) on delete cascade,
  retirada_por text not null,
  motivo text,
  retirada_em timestamptz not null default now(),
  previsao_devolucao timestamptz,
  devolvida_em timestamptz
);
select public._habilitar_rls_org('chave_movimentacoes');

-- -----------------------------------------------------------------------------
-- Índices econômicos (variação mensal %)
-- -----------------------------------------------------------------------------
create table public.indices_economicos (
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  indice text not null check (indice in ('IGPM','IPCA','INPC','IVAR','IGPDI')),
  competencia date not null check (extract(day from competencia) = 1),
  variacao_pct numeric(9,4) not null,
  primary key (organizacao_id, indice, competencia)
);
select public._habilitar_rls_org('indices_economicos');

-- -----------------------------------------------------------------------------
-- Contratos de locação
-- -----------------------------------------------------------------------------
create table public.contratos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  numero bigint generated always as identity,
  codigo text,
  imovel_id uuid not null references public.imoveis(id) on delete restrict,
  status text not null default 'ativo' check (status in ('rascunho','ativo','encerrado','rescindido')),
  finalidade text not null default 'residencial' check (finalidade in ('residencial','comercial','temporada')),
  data_inicio date not null,
  prazo_meses int not null check (prazo_meses > 0),
  data_fim date not null,
  valor_aluguel numeric(14,2) not null check (valor_aluguel >= 0),
  dia_vencimento int not null check (dia_vencimento between 1 and 31),
  modalidade text not null default 'vencido' check (modalidade in ('antecipado','vencido')),
  indice_reajuste text not null default 'IGPM' check (indice_reajuste in ('IGPM','IPCA','INPC','IVAR','IGPDI')),
  periodicidade_reajuste_meses int not null default 12,
  data_base_reajuste date not null,
  taxa_administracao_pct numeric(6,3) not null default 10,
  taxa_intermediacao_pct numeric(6,3) not null default 100,
  tipo_repasse text not null default 'automatico' check (tipo_repasse in ('automatico','garantido','manual')),
  dias_repasse int not null default 2,
  repassar_multa_juros boolean not null default true,
  multa_atraso_pct numeric(6,3) not null default 10,
  juros_mes_pct numeric(6,3) not null default 1,
  carencia_dias int not null default 0,
  multa_rescisoria_alugueis numeric(5,2) not null default 3,
  garantia_tipo text not null default 'sem_garantia'
    check (garantia_tipo in ('sem_garantia','fiador','caucao','seguro_fianca','titulo_capitalizacao')),
  garantia_valor numeric(14,2),
  garantia_detalhes text,
  seguro_incendio_apolice text,
  seguro_incendio_vencimento date,
  data_rescisao date,
  observacoes text,
  created_at timestamptz not null default now()
);
select public._habilitar_rls_org('contratos');
create index on public.contratos (imovel_id);

create table public.contrato_partes (
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete restrict,
  papel text not null check (papel in ('locatario','fiador','proprietario')),
  percentual numeric(6,3),
  primary key (contrato_id, pessoa_id, papel)
);
select public._habilitar_rls_org('contrato_partes');

create table public.contrato_encargos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  descricao text not null,
  tipo text not null default 'outro' check (tipo in ('iptu','condominio','seguro','agua','gas','outro')),
  valor numeric(14,2) not null,
  destino text not null default 'proprietario' check (destino in ('proprietario','imobiliaria','terceiro')),
  inicio date,
  fim date
);
select public._habilitar_rls_org('contrato_encargos');

create table public.contrato_reajustes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  data_reajuste date not null,
  indice text not null,
  percentual numeric(9,4) not null,
  valor_anterior numeric(14,2) not null,
  valor_novo numeric(14,2) not null,
  created_at timestamptz not null default now()
);
select public._habilitar_rls_org('contrato_reajustes');

-- -----------------------------------------------------------------------------
-- Faturas (cobranças ao locatário)
-- -----------------------------------------------------------------------------
create table public.faturas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  numero bigint generated always as identity,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  competencia date not null,
  periodo_inicio date,
  periodo_fim date,
  vencimento date not null,
  valor_total numeric(14,2) not null,
  status text not null default 'aberta' check (status in ('aberta','paga','cancelada')),
  pago_em date,
  valor_pago numeric(14,2),
  forma_pagamento text check (forma_pagamento in ('boleto','pix','transferencia','dinheiro','cartao','outro')),
  irrf_por_proprietario jsonb not null default '{}',
  -- Preenchidos quando houver integração bancária (boleto/Pix)
  linha_digitavel text,
  pix_copia_cola text,
  url_pagamento text,
  observacoes text,
  created_at timestamptz not null default now()
);
select public._habilitar_rls_org('faturas');
create unique index faturas_unica_competencia on public.faturas (contrato_id, competencia) where status <> 'cancelada';
create index on public.faturas (status, vencimento);

create table public.fatura_itens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  descricao text not null,
  tipo text not null check (tipo in ('aluguel','encargo','multa','juros','desconto','irrf','outro')),
  valor numeric(14,2) not null,
  destino text not null check (destino in ('proprietario','imobiliaria','terceiro'))
);
select public._habilitar_rls_org('fatura_itens');
create index on public.fatura_itens (fatura_id);

-- -----------------------------------------------------------------------------
-- Repasses (pagamentos aos proprietários)
-- -----------------------------------------------------------------------------
create table public.repasses (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  fatura_id uuid references public.faturas(id) on delete set null,
  pessoa_id uuid not null references public.pessoas(id) on delete restrict,
  competencia date not null,
  percentual numeric(6,3) not null,
  aluguel numeric(14,2) not null default 0,
  encargos numeric(14,2) not null default 0,
  multa_juros numeric(14,2) not null default 0,
  valor_bruto numeric(14,2) not null,
  taxa_administracao numeric(14,2) not null default 0,
  taxa_intermediacao numeric(14,2) not null default 0,
  irrf numeric(14,2) not null default 0,
  outros_descontos numeric(14,2) not null default 0,
  valor_liquido numeric(14,2) not null,
  previsto_para date not null,
  status text not null default 'pendente' check (status in ('pendente','pago','cancelado')),
  pago_em date,
  comprovante text,
  created_at timestamptz not null default now()
);
select public._habilitar_rls_org('repasses');
create index on public.repasses (status, previsto_para);
create index on public.repasses (pessoa_id);

-- -----------------------------------------------------------------------------
-- Régua de cobrança
-- -----------------------------------------------------------------------------
create table public.regua_regras (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  dias_relativos int not null,
  canal text not null default 'email' check (canal in ('email','whatsapp','sms')),
  assunto text,
  mensagem text not null,
  ativo boolean not null default true
);
select public._habilitar_rls_org('regua_regras');

create table public.regua_envios (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  regra_id uuid not null references public.regua_regras(id) on delete cascade,
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  destinatario text,
  status text not null default 'registrado' check (status in ('registrado','enviado','falhou')),
  enviado_em timestamptz not null default now(),
  unique (regra_id, fatura_id)
);
select public._habilitar_rls_org('regua_envios');

-- -----------------------------------------------------------------------------
-- Financeiro da imobiliária (contas a pagar e a receber)
-- -----------------------------------------------------------------------------
create table public.lancamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default public.org_atual() references public.organizacoes(id) on delete cascade,
  tipo text not null check (tipo in ('receber','pagar')),
  descricao text not null,
  categoria text,
  valor numeric(14,2) not null,
  vencimento date not null,
  status text not null default 'aberto' check (status in ('aberto','liquidado','cancelado')),
  liquidado_em date,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  contrato_id uuid references public.contratos(id) on delete set null,
  fatura_id uuid references public.faturas(id) on delete set null,
  created_at timestamptz not null default now()
);
select public._habilitar_rls_org('lancamentos');

-- -----------------------------------------------------------------------------
-- Operações atômicas (SECURITY INVOKER: RLS continua valendo)
-- Os cálculos são feitos na aplicação (src/lib/dominio) e testados; aqui
-- apenas gravamos tudo numa única transação.
-- -----------------------------------------------------------------------------

-- p: { contrato_id, competencia, periodo_inicio, periodo_fim, vencimento,
--      valor_total, irrf_por_proprietario, itens: [{descricao,tipo,valor,destino}],
--      repasses?: [...] (somente para repasse garantido) }
create or replace function public.registrar_fatura(p jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
begin
  select organizacao_id into v_org from public.contratos where id = (p->>'contrato_id')::uuid;
  if v_org is null then
    raise exception 'Contrato não encontrado';
  end if;

  insert into public.faturas (organizacao_id, contrato_id, competencia, periodo_inicio, periodo_fim,
                              vencimento, valor_total, irrf_por_proprietario)
  values (v_org, (p->>'contrato_id')::uuid, (p->>'competencia')::date, (p->>'periodo_inicio')::date,
          (p->>'periodo_fim')::date, (p->>'vencimento')::date, (p->>'valor_total')::numeric,
          coalesce(p->'irrf_por_proprietario', '{}'::jsonb))
  returning id into v_id;

  insert into public.fatura_itens (organizacao_id, fatura_id, descricao, tipo, valor, destino)
  select v_org, v_id, i->>'descricao', i->>'tipo', (i->>'valor')::numeric, i->>'destino'
  from jsonb_array_elements(p->'itens') as i;

  -- Repasse garantido: já nasce agendado, independente do pagamento.
  insert into public.repasses (organizacao_id, contrato_id, fatura_id, pessoa_id, competencia, percentual,
    aluguel, encargos, multa_juros, valor_bruto, taxa_administracao, taxa_intermediacao, irrf,
    valor_liquido, previsto_para)
  select v_org, (p->>'contrato_id')::uuid, v_id, (r->>'pessoa_id')::uuid, (p->>'competencia')::date,
    (r->>'percentual')::numeric, (r->>'aluguel')::numeric, (r->>'encargos')::numeric,
    (r->>'multa_juros')::numeric, (r->>'valor_bruto')::numeric, (r->>'taxa_administracao')::numeric,
    (r->>'taxa_intermediacao')::numeric, (r->>'irrf')::numeric, (r->>'valor_liquido')::numeric,
    (r->>'previsto_para')::date
  from jsonb_array_elements(coalesce(p->'repasses', '[]'::jsonb)) as r;

  return v_id;
end;
$$;

-- p: { pago_em, valor_pago, forma_pagamento,
--      itens_extras: [{descricao,tipo,valor,destino}],   -- multa/juros/desconto
--      repasses: [{pessoa_id, percentual, aluguel, encargos, multa_juros, valor_bruto,
--                  taxa_administracao, taxa_intermediacao, irrf, valor_liquido, previsto_para}],
--      receita_imobiliaria }
create or replace function public.liquidar_fatura(p_fatura_id uuid, p jsonb)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  f public.faturas%rowtype;
begin
  select * into f from public.faturas where id = p_fatura_id for update;
  if not found then
    raise exception 'Fatura não encontrada';
  end if;
  if f.status <> 'aberta' then
    raise exception 'Fatura não está em aberto (status: %)', f.status;
  end if;

  insert into public.fatura_itens (organizacao_id, fatura_id, descricao, tipo, valor, destino)
  select f.organizacao_id, f.id, i->>'descricao', i->>'tipo', (i->>'valor')::numeric, i->>'destino'
  from jsonb_array_elements(coalesce(p->'itens_extras', '[]'::jsonb)) as i;

  update public.faturas set
    status = 'paga',
    pago_em = (p->>'pago_em')::date,
    valor_pago = (p->>'valor_pago')::numeric,
    forma_pagamento = p->>'forma_pagamento'
  where id = f.id;

  -- Repasses que já existem (ex.: garantidos gerados antes) não são duplicados.
  if not exists (select 1 from public.repasses where fatura_id = f.id and status <> 'cancelado') then
    insert into public.repasses (organizacao_id, contrato_id, fatura_id, pessoa_id, competencia, percentual,
      aluguel, encargos, multa_juros, valor_bruto, taxa_administracao, taxa_intermediacao, irrf,
      valor_liquido, previsto_para)
    select f.organizacao_id, f.contrato_id, f.id, (r->>'pessoa_id')::uuid, f.competencia,
      (r->>'percentual')::numeric, (r->>'aluguel')::numeric, (r->>'encargos')::numeric,
      (r->>'multa_juros')::numeric, (r->>'valor_bruto')::numeric, (r->>'taxa_administracao')::numeric,
      (r->>'taxa_intermediacao')::numeric, (r->>'irrf')::numeric, (r->>'valor_liquido')::numeric,
      (r->>'previsto_para')::date
    from jsonb_array_elements(coalesce(p->'repasses', '[]'::jsonb)) as r;
  end if;

  if coalesce((p->>'receita_imobiliaria')::numeric, 0) > 0 then
    insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status,
                                    liquidado_em, contrato_id, fatura_id)
    values (f.organizacao_id, 'receber', 'Taxas de administração/intermediação — fatura #' || f.numero,
            'Taxa de administração', (p->>'receita_imobiliaria')::numeric, (p->>'pago_em')::date,
            'liquidado', (p->>'pago_em')::date, f.contrato_id, f.id);
  end if;
end;
$$;

create or replace function public.aplicar_reajuste(
  p_contrato_id uuid, p_data date, p_indice text, p_percentual numeric, p_valor_novo numeric
) returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  c public.contratos%rowtype;
begin
  select * into c from public.contratos where id = p_contrato_id for update;
  if not found then
    raise exception 'Contrato não encontrado';
  end if;
  insert into public.contrato_reajustes (organizacao_id, contrato_id, data_reajuste, indice, percentual,
                                         valor_anterior, valor_novo)
  values (c.organizacao_id, c.id, p_data, p_indice, p_percentual, c.valor_aluguel, p_valor_novo);
  update public.contratos set valor_aluguel = p_valor_novo, data_base_reajuste = p_data where id = c.id;
end;
$$;

revoke all on function public._habilitar_rls_org(text) from public, anon, authenticated;
revoke execute on function public.criar_organizacao(text, text) from public, anon;
grant execute on function public.criar_organizacao(text, text) to authenticated;
revoke execute on function public.registrar_fatura(jsonb) from public, anon;
grant execute on function public.registrar_fatura(jsonb) to authenticated;
revoke execute on function public.liquidar_fatura(uuid, jsonb) from public, anon;
grant execute on function public.liquidar_fatura(uuid, jsonb) to authenticated;
revoke execute on function public.aplicar_reajuste(uuid, date, text, numeric, numeric) from public, anon;
grant execute on function public.aplicar_reajuste(uuid, date, text, numeric, numeric) to authenticated;
