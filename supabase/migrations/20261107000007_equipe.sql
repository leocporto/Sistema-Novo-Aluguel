-- =============================================================================
-- Gestão de equipe e administração (só no modo imobiliária).
--
-- - Colaboradores: usuários (membros) ligados a um cadastro de Pessoas
--   (membros.pessoa_id) + corretores; dados profissionais no cadastro (CRECI
--   número/UF/validade/tipo, cargo, admissão, desligamento, filial) e
--   documentos profissionais com validade (bucket privado "equipe").
--   Documentos (tabela e arquivos): só o próprio colaborador e quem tem
--   Equipe → editar (LGPD). Ficha (cargo, filial, desligamento, carteira),
--   equipes e membros de equipe: travas de permissão no banco.
-- - Convites de usuário por link (o convidado cria a conta com o e-mail do
--   convite, CONFIRMA o e-mail e aceita); papel/perfil/ficha só por RPC.
--   Exige "Confirm email" ligado no Supabase (Authentication → Providers).
-- - Filiais; equipes ganham filial e descrição (o líder vira o gestor).
--   Leads e imóveis ganham a filial do corretor; contratos, a do imóvel.
-- - Carteira de clientes (pessoas.corretor_id): o gestor monta na ficha do
--   corretor; comprador de venda entra sozinho na carteira do corretor.
-- - Perfis de acesso: papel continua sendo a base; perfis padrão por papel
--   (editáveis) e perfis próprios; permissões por módulo × operação;
--   privado.tem_permissao(org, módulo, operação) (admin sempre pode) e
--   public.minhas_permissoes() para o servidor.
-- - Metas individuais e coletivas (equipe_metas: a tabela metas tem unique
--   (organização, mês, tipo) que não dá para trocar sem DROP).
-- - Distribuição: regras de fila/rodízio por equipe/filial (aplicadas pela
--   receber_lead e por proximo_corretor_lead) e redistribuição em massa com
--   histórico e motivo.
-- - Produtividade agregada no banco (public.equipe_produtividade).
-- - Tarefas internas com comentários; aprovações genéricas com regras de quem
--   aprova o quê (garantidas por gatilho); mural de avisos com confirmação de
--   leitura e mensagens entre colaboradores; onboarding com modelos.
-- - Trilha de auditoria genérica (public.auditoria, só leitura) gravada pelo
--   gatilho privado.auditar() nas tabelas principais.
--
-- Sem DROP: create/alter ... if not exists, create or replace, policies em DO.
-- Gatilhos de guarda são SECURITY INVOKER e só conferem chamadas feitas pela
-- API (current_user authenticated/anon); funções do próprio banco passam.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Colaboradores, filiais, perfis e ligação usuário ↔ pessoa
-- -----------------------------------------------------------------------------
alter table public.pessoas
  add column if not exists colaborador boolean not null default false,
  add column if not exists cargo text,
  add column if not exists admissao date,
  add column if not exists desligamento date,
  add column if not exists creci_numero text,
  add column if not exists creci_uf text,
  add column if not exists creci_validade date,
  add column if not exists creci_tipo text,
  add column if not exists corretor_id uuid references public.pessoas(id) on delete set null;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'pessoas_creci_tipo_check') then
    alter table public.pessoas add constraint pessoas_creci_tipo_check
      check (creci_tipo is null or creci_tipo in ('definitivo','estagiario','juridica'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'pessoas_creci_uf_check') then
    alter table public.pessoas add constraint pessoas_creci_uf_check
      check (creci_uf is null or creci_uf ~ '^[A-Z]{2}$');
  end if;
end $$;
create index if not exists pessoas_creci_validade_idx on public.pessoas (organizacao_id, creci_validade) where creci_validade is not null;
create index if not exists pessoas_corretor_resp_idx on public.pessoas (corretor_id) where corretor_id is not null;
create index if not exists pessoas_colaborador_idx on public.pessoas (organizacao_id) where colaborador;

create table if not exists public.filiais (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  codigo text,
  cidade text,
  uf text,
  endereco text,
  telefone text,
  email text,
  gestor_id uuid references public.pessoas(id) on delete set null,
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.pessoas add column if not exists filial_id uuid references public.filiais(id) on delete set null;
alter table public.equipes
  add column if not exists filial_id uuid references public.filiais(id) on delete set null,
  add column if not exists descricao text;
-- Filial em imóveis, contratos e leads (filtros nas outras telas: ponto de integração).
alter table public.imoveis add column if not exists filial_id uuid references public.filiais(id) on delete set null;
alter table public.contratos add column if not exists filial_id uuid references public.filiais(id) on delete set null;
alter table public.leads add column if not exists filial_id uuid references public.filiais(id) on delete set null;
create index if not exists pessoas_filial_idx on public.pessoas (filial_id) where filial_id is not null;
create index if not exists equipes_filial_idx on public.equipes (filial_id) where filial_id is not null;
create index if not exists imoveis_filial_idx on public.imoveis (filial_id) where filial_id is not null;
create index if not exists contratos_filial_idx on public.contratos (filial_id) where filial_id is not null;
create index if not exists leads_filial_idx on public.leads (filial_id) where filial_id is not null;

create table if not exists public.perfis_acesso (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  descricao text,
  papel_base text not null default 'corretor' check (papel_base in ('admin','gestor','financeiro','corretor')),
  padrao boolean not null default false,
  permissoes jsonb not null default '{}'::jsonb check (jsonb_typeof(permissoes) = 'object'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists perfis_acesso_padrao_idx on public.perfis_acesso (organizacao_id, papel_base) where padrao;

alter table public.membros
  add column if not exists pessoa_id uuid references public.pessoas(id) on delete set null,
  add column if not exists perfil_id uuid references public.perfis_acesso(id) on delete set null,
  add column if not exists cargo text,
  add column if not exists email text;
create unique index if not exists membros_pessoa_idx on public.membros (organizacao_id, pessoa_id) where pessoa_id is not null;
create index if not exists membros_perfil_idx on public.membros (perfil_id) where perfil_id is not null;

-- -----------------------------------------------------------------------------
-- 2. Permissões: módulos × operações
-- -----------------------------------------------------------------------------
/** Módulos e operações possíveis (espelho de MODULOS em src/lib/dominio/equipe.ts). */
create or replace function privado.modulos_equipe()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{
    "painel":["ver"],
    "imoveis":["ver","criar","editar","excluir"],
    "pessoas":["ver","criar","editar","excluir"],
    "documentos":["ver","criar","editar","excluir","aprovar"],
    "contratos":["ver","criar","editar","excluir","aprovar"],
    "faturas":["ver","criar","editar","excluir"],
    "cobrancas":["ver","criar","editar","excluir","aprovar"],
    "analise":["ver","criar","editar","excluir","aprovar"],
    "vistorias":["ver","criar","editar","excluir","aprovar"],
    "manutencao":["ver","criar","editar","excluir","aprovar"],
    "agenda":["ver","criar","editar","excluir"],
    "comercial":["ver","criar","editar","excluir"],
    "captacao":["ver","criar","editar","excluir"],
    "vendas":["ver","criar","editar","excluir","aprovar"],
    "comissoes":["ver","criar","editar","excluir","aprovar"],
    "site":["ver","criar","editar","excluir"],
    "marketing":["ver","criar","editar","excluir"],
    "repasses":["ver","criar","editar","excluir","aprovar"],
    "financeiro":["ver","criar","editar","excluir","aprovar"],
    "relatorios":["ver"],
    "equipe":["ver","criar","editar","excluir"],
    "aprovacoes":["ver","criar","editar","aprovar"],
    "auditoria":["ver"],
    "configuracoes":["ver","editar"]
  }'::jsonb
$$;

/**
 * Só módulos/operações conhecidos, na ordem da lista; "ver" entra sozinho quando
 * há outra operação no módulo. Mesma conta de normalizarPermissoes() no app.
 */
create or replace function privado.normalizar_permissoes(p jsonb)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select coalesce(jsonb_object_agg(m.key, (
    select coalesce(jsonb_agg(o.value order by o.ord), '[]'::jsonb)
      from jsonb_array_elements_text(m.value) with ordinality as o(value, ord)
     where case when jsonb_typeof(p -> m.key) = 'array' then
             (p -> m.key) ? o.value
             or (o.value = 'ver' and exists (
                   select 1 from jsonb_array_elements_text(p -> m.key) as x(v) where m.value ? x.v))
           else false end
  )), '{}'::jsonb)
  from jsonb_each(privado.modulos_equipe()) m
$$;

/** Permissões padrão de cada papel (espelho de permissoesPadrao() no app). */
create or replace function privado.permissoes_padrao(p_papel text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  with base as (
    select jsonb_object_agg(k, case when k = 'auditoria' then '[]'::jsonb else '["ver"]'::jsonb end) as b
      from jsonb_object_keys(privado.modulos_equipe()) k
  )
  select privado.normalizar_permissoes(case
    when p_papel in ('admin','gestor') then privado.modulos_equipe()
    when p_papel = 'financeiro' then (select b from base) || '{
      "pessoas":["ver","criar","editar"],
      "contratos":["ver","criar","editar"],
      "documentos":["ver","criar","editar"],
      "faturas":["ver","criar","editar","excluir"],
      "cobrancas":["ver","criar","editar","excluir","aprovar"],
      "repasses":["ver","criar","editar","excluir","aprovar"],
      "financeiro":["ver","criar","editar","excluir","aprovar"],
      "comissoes":["ver","criar","editar","excluir","aprovar"],
      "agenda":["ver","criar","editar","excluir"],
      "manutencao":["ver","criar","editar","aprovar"],
      "vistorias":["ver","criar","editar","aprovar"],
      "analise":["ver","criar","editar"],
      "aprovacoes":["ver","criar","aprovar"],
      "configuracoes":["ver","editar"]
    }'::jsonb
    when p_papel = 'corretor' then (select b from base) || '{
      "imoveis":["ver","criar","editar"],
      "pessoas":["ver","criar","editar"],
      "documentos":["ver","criar","editar"],
      "contratos":["ver","criar"],
      "cobrancas":["ver","criar"],
      "comercial":["ver","criar","editar","excluir"],
      "captacao":["ver","criar","editar","excluir"],
      "vendas":["ver","criar","editar"],
      "agenda":["ver","criar","editar","excluir"],
      "vistorias":["ver","criar","editar"],
      "manutencao":["ver","criar","editar"],
      "analise":["ver","criar","editar"],
      "marketing":["ver","criar","editar"],
      "aprovacoes":["ver","criar"],
      "configuracoes":["ver","editar"]
    }'::jsonb
    else '{}'::jsonb end)
$$;

/** Rótulos para as mensagens de "sem permissão". */
create or replace function privado.rotulo_permissao(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p
    when 'ver' then 'ver' when 'criar' then 'criar' when 'editar' then 'editar' when 'excluir' then 'excluir' when 'aprovar' then 'aprovar'
    when 'painel' then 'Painel' when 'imoveis' then 'Imóveis' when 'pessoas' then 'Pessoas' when 'documentos' then 'Documentos'
    when 'contratos' then 'Contratos' when 'faturas' then 'Aluguéis do mês' when 'cobrancas' then 'Cobranças'
    when 'analise' then 'Análise cadastral' when 'vistorias' then 'Vistorias' when 'manutencao' then 'Manutenção'
    when 'agenda' then 'Agenda' when 'comercial' then 'Comercial' when 'captacao' then 'Captação' when 'vendas' then 'Vendas'
    when 'comissoes' then 'Comissões' when 'site' then 'Site e portais' when 'marketing' then 'Marketing'
    when 'repasses' then 'Repasses' when 'financeiro' then 'Financeiro' when 'relatorios' then 'Relatórios'
    when 'equipe' then 'Equipe' when 'aprovacoes' then 'Aprovações' when 'auditoria' then 'Histórico de ações'
    when 'configuracoes' then 'Configurações'
    else coalesce(p, '—') end
$$;

/** Permissões que valem para um usuário na organização (admin: tudo). */
create or replace function privado.permissoes_de(p_org uuid, p_user uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.membros%rowtype;
  v jsonb;
begin
  select * into m from public.membros where organizacao_id = p_org and user_id = p_user;
  if not found then return '{}'::jsonb; end if;
  if m.papel = 'admin' then return privado.modulos_equipe(); end if;
  select pa.permissoes into v
    from public.perfis_acesso pa
   where pa.organizacao_id = p_org
     and (pa.id = m.perfil_id or (pa.padrao and pa.papel_base = m.papel))
   order by (pa.id = m.perfil_id) is true desc
   limit 1;
  return privado.normalizar_permissoes(coalesce(v, privado.permissoes_padrao(m.papel)));
end;
$$;
revoke execute on function privado.permissoes_de(uuid, uuid) from public, anon, authenticated;

/** O usuário logado pode fazer esta operação neste módulo? (admin sempre pode) */
create or replace function privado.tem_permissao(p_org uuid, p_modulo text, p_operacao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((privado.permissoes_de(p_org, auth.uid()) -> p_modulo) ? p_operacao, false)
$$;
revoke execute on function privado.tem_permissao(uuid, text, text) from public, anon;
grant execute on function privado.tem_permissao(uuid, text, text) to authenticated;

/** Lança erro amigável quando falta a permissão (chamadas sem usuário passam: são do sistema). */
create or replace function privado.exigir_permissao(p_org uuid, p_modulo text, p_operacao text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then return; end if;
  if not privado.tem_permissao(p_org, p_modulo, p_operacao) then
    raise exception 'Seu perfil de acesso não permite % em %. Fale com o administrador.',
      privado.rotulo_permissao(p_operacao), privado.rotulo_permissao(p_modulo);
  end if;
end;
$$;
revoke execute on function privado.exigir_permissao(uuid, text, text) from public, anon;
grant execute on function privado.exigir_permissao(uuid, text, text) to authenticated;

/** Permissões do usuário logado na organização dele (usado pelo servidor: src/lib/permissoes.ts). */
create or replace function public.minhas_permissoes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when auth.uid() is null or privado.org_atual() is null then '{}'::jsonb
              else privado.permissoes_de(privado.org_atual(), auth.uid()) end
$$;
revoke execute on function public.minhas_permissoes() from public, anon;
grant execute on function public.minhas_permissoes() to authenticated;

/** A organização está no modo imobiliária? */
create or replace function privado.org_imobiliaria(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select modo from public.organizacoes where id = p_org), 'imobiliaria') <> 'pessoal'
$$;
revoke execute on function privado.org_imobiliaria(uuid) from public, anon;
grant execute on function privado.org_imobiliaria(uuid) to authenticated;

/** Chamada feita pela API (usuário) e não por uma função do próprio banco? */
create or replace function privado.chamada_da_api()
returns boolean
language sql
stable
set search_path = ''
as $$
  select current_user in ('authenticated', 'anon')
$$;
grant execute on function privado.chamada_da_api() to authenticated, anon;

/**
 * Gatilho genérico de guarda: exige a permissão (TG_ARGV[0] = módulo,
 * TG_ARGV[1] = operação) para gravar pela API, e o modo imobiliária.
 */
create or replace function privado.equipe_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; else v_org := new.organizacao_id; end if;
  if privado.chamada_da_api() then
    if tg_op <> 'DELETE' and not privado.org_imobiliaria(v_org) then
      raise exception 'A gestão de equipe só existe no modo imobiliária.';
    end if;
    perform privado.exigir_permissao(v_org, tg_argv[0], tg_argv[1]);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

-- Perfis padrão de cada papel (Gestor, Financeiro e Corretor) ---------------------
create or replace function privado.criar_perfis_padrao(p_org uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.perfis_acesso (organizacao_id, nome, descricao, papel_base, padrao, permissoes)
  select p_org, x.nome, x.descricao, x.papel, true, privado.permissoes_padrao(x.papel)
    from (values
      ('Gestor', 'Padrão de quem tem o papel Gestor.', 'gestor'),
      ('Financeiro', 'Padrão de quem tem o papel Financeiro.', 'financeiro'),
      ('Corretor', 'Padrão de quem tem o papel Corretor.', 'corretor')) as x(nome, descricao, papel)
   where not exists (select 1 from public.perfis_acesso pa where pa.organizacao_id = p_org and pa.padrao and pa.papel_base = x.papel);
end;
$$;
revoke execute on function privado.criar_perfis_padrao(uuid) from public, anon, authenticated;

create or replace function privado.organizacao_perfis_padrao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform privado.criar_perfis_padrao(new.id);
  return new;
end;
$$;
create or replace trigger organizacoes_perfis_padrao_trg after insert on public.organizacoes
  for each row execute function privado.organizacao_perfis_padrao();

/** Só o administrador mexe nos perfis; perfil padrão não se apaga nem troca de papel. */
create or replace function privado.perfis_acesso_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_regras int;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; else v_org := new.organizacao_id; end if;
  if privado.chamada_da_api() and coalesce(privado.papel_atual(v_org), '') <> 'admin' then
    raise exception 'Só o administrador muda os perfis de acesso.';
  end if;
  if tg_op = 'DELETE' then
    if old.padrao and privado.chamada_da_api() then
      raise exception 'O perfil padrão de um papel não se apaga (dá para mudar as permissões dele).';
    end if;
    -- Regra de aprovação que tem este perfil como aprovador perderia o sentido
    -- (a FK apaga a regra junto): pela API, avisa antes, em português.
    if privado.chamada_da_api() and to_regclass('public.aprovacao_regras') is not null then
      select count(*) into v_regras from public.aprovacao_regras where aprovador_perfil_id = old.id;
      if v_regras > 0 then
        raise exception 'Este perfil é o aprovador de % regra(s) de aprovação. Exclua essas regras em Equipe → Aprovações → Regras (e crie de novo com outro aprovador) antes de excluir o perfil.', v_regras;
      end if;
    end if;
    return old;
  end if;
  new.permissoes := privado.normalizar_permissoes(new.permissoes);
  new.nome := btrim(new.nome);
  if new.nome = '' then raise exception 'Dê um nome ao perfil.'; end if;
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    if old.padrao then
      new.padrao := true;
      new.papel_base := old.papel_base;
    else
      new.padrao := false;
    end if;
  elsif privado.chamada_da_api() then
    new.padrao := false;
  end if;
  return new;
end;
$$;
create or replace trigger perfis_acesso_guarda_trg before insert or update or delete on public.perfis_acesso
  for each row execute function privado.perfis_acesso_guarda();

-- Organizações que já existem ganham os perfis padrão.
select privado.criar_perfis_padrao(id) from public.organizacoes;

-- -----------------------------------------------------------------------------
-- 3. Convites e usuários (papel, perfil e ficha só por RPC)
-- -----------------------------------------------------------------------------
create table if not exists public.equipe_convites (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  email text not null,
  nome text,
  papel text not null default 'corretor' check (papel in ('admin','gestor','financeiro','corretor')),
  perfil_id uuid references public.perfis_acesso(id) on delete set null,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  token uuid not null default gen_random_uuid(),
  expira_em timestamptz not null default now() + interval '7 days',
  criado_por uuid default auth.uid(),
  aceito_em timestamptz,
  aceito_por uuid,
  revogado_em timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists equipe_convites_token_idx on public.equipe_convites (token);
create unique index if not exists equipe_convites_pendente_idx on public.equipe_convites (organizacao_id, lower(email))
  where aceito_em is null and revogado_em is null;

/** Esconde parte do e-mail (mensagens para quem não é o dono do convite). */
create or replace function privado.mascarar_email(p text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case when p is null or position('@' in p) = 0 then p
    else left(split_part(p, '@', 1), case when length(split_part(p, '@', 1)) <= 2 then 1 else 2 end)
         || repeat('*', greatest(1, least(6, length(split_part(p, '@', 1)) - case when length(split_part(p, '@', 1)) <= 2 then 1 else 2 end)))
         || '@' || split_part(p, '@', 2) end
$$;

create or replace function privado.equipe_convites_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; else v_org := new.organizacao_id; end if;
  if not privado.chamada_da_api() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  perform privado.exigir_permissao(v_org, 'equipe', 'criar');
  if tg_op = 'DELETE' then return old; end if;
  if not privado.org_imobiliaria(v_org) then raise exception 'Convites de equipe só existem no modo imobiliária.'; end if;

  if tg_op = 'INSERT' then
    new.email := lower(btrim(new.email));
    if new.email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'E-mail inválido.'; end if;
    if (new.papel in ('admin','gestor') or new.perfil_id is not null) and coalesce(privado.papel_atual(v_org), '') <> 'admin' then
      raise exception 'Só o administrador convida gestores e administradores ou escolhe o perfil de acesso.';
    end if;
    if exists (select 1 from public.membros where organizacao_id = v_org and lower(email) = new.email) then
      raise exception 'Este e-mail já tem acesso ao sistema.';
    end if;
    if (select count(*) from public.equipe_convites c where c.organizacao_id = v_org and c.created_at > now() - interval '24 hours') >= 30 then
      raise exception 'Muitos convites hoje. Tente de novo amanhã.';
    end if;
    -- Convidar de novo o mesmo e-mail cancela o link anterior.
    update public.equipe_convites set revogado_em = now()
     where organizacao_id = v_org and lower(email) = new.email and aceito_em is null and revogado_em is null;
    if (select count(*) from public.equipe_convites c
         where c.organizacao_id = v_org and c.aceito_em is null and c.revogado_em is null and c.expira_em > now()) >= 50 then
      raise exception 'Há convites demais esperando resposta. Cancele os que não vão ser usados.';
    end if;
    new.token := gen_random_uuid();
    new.criado_por := auth.uid();
    new.aceito_em := null;
    new.aceito_por := null;
    new.revogado_em := null;
    new.expira_em := least(greatest(coalesce(new.expira_em, now() + interval '7 days'), now() + interval '1 day'), now() + interval '30 days');
    return new;
  end if;

  -- Pela API, convite só pode ser cancelado (o aceite é pela RPC aceitar_convite).
  if new.revogado_em is null or old.revogado_em is not null or old.aceito_em is not null
     or new.email is distinct from old.email or new.papel is distinct from old.papel or new.perfil_id is distinct from old.perfil_id
     or new.token is distinct from old.token or new.aceito_em is distinct from old.aceito_em or new.aceito_por is distinct from old.aceito_por
     or new.pessoa_id is distinct from old.pessoa_id or new.expira_em is distinct from old.expira_em then
    raise exception 'O convite não pode ser alterado; cancele e convide de novo.';
  end if;
  return new;
end;
$$;
create or replace trigger equipe_convites_guarda_trg before insert or update or delete on public.equipe_convites
  for each row execute function privado.equipe_convites_guarda();

/** E-mail da sessão (claim do JWT, nos dois formatos que o Supabase usa). */
create or replace function privado.email_sessao()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(nullif(coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email'), ''))
$$;
grant execute on function privado.email_sessao() to authenticated;

/**
 * O e-mail da conta logada foi confirmado? (auth.users.email_confirmed_at)
 * Sem isso, quem criasse antes uma conta com o e-mail do convidado entraria na
 * imobiliária. Por isso "Confirm email" precisa estar ligado no Supabase
 * (Authentication → Providers → Email). Sem a tabela auth.users: não confirmado.
 */
create or replace function privado.email_confirmado()
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v boolean;
begin
  if auth.uid() is null or to_regclass('auth.users') is null then return false; end if;
  execute 'select email_confirmed_at is not null from auth.users where id = $1' into v using auth.uid();
  return coalesce(v, false);
end;
$$;
revoke execute on function privado.email_confirmado() from public, anon, authenticated;

/** Dados do convite para a tela /convite/[token] (só logado). */
create or replace function public.info_convite(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.equipe_convites%rowtype;
  v_org text;
begin
  if auth.uid() is null then raise exception 'Entre na sua conta para ver o convite.'; end if;
  select * into c from public.equipe_convites where token = p_token;
  if not found then return jsonb_build_object('situacao', 'invalido'); end if;
  select nome into v_org from public.organizacoes where id = c.organizacao_id;
  return jsonb_build_object(
    'organizacao', v_org,
    'papel', c.papel,
    'email', case when lower(c.email) = privado.email_sessao() then c.email else privado.mascarar_email(c.email) end,
    'meu_email', lower(c.email) = privado.email_sessao(),
    'email_confirmado', privado.email_confirmado(),
    'situacao', case when c.revogado_em is not null then 'cancelado' when c.aceito_em is not null then 'usado'
                     when c.expira_em < now() then 'vencido' else 'valido' end);
end;
$$;
revoke execute on function public.info_convite(uuid) from public, anon;
grant execute on function public.info_convite(uuid) to authenticated;

/**
 * Convites esperando o e-mail de quem está logado (tela de boas-vindas).
 * Só o aviso (imobiliária e papel), nunca o token: para entrar é preciso o
 * link recebido. E só com o e-mail confirmado.
 */
create or replace function public.meus_convites()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('organizacao', o.nome, 'papel', c.papel) order by c.created_at desc), '[]'::jsonb)
    from public.equipe_convites c
    join public.organizacoes o on o.id = c.organizacao_id
   where privado.email_sessao() is not null
     and privado.email_confirmado()
     and lower(c.email) = privado.email_sessao()
     and c.aceito_em is null and c.revogado_em is null and c.expira_em > now()
     and o.modo <> 'pessoal'
$$;
revoke execute on function public.meus_convites() from public, anon;
grant execute on function public.meus_convites() to authenticated;

/**
 * Aceita o convite: a conta logada (com o mesmo e-mail do convite) entra na
 * imobiliária com o papel/perfil do convite e ganha a ficha de colaborador.
 */
create or replace function public.aceitar_convite(p_token uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.equipe_convites%rowtype;
  v_uid uuid := auth.uid();
  v_email text := privado.email_sessao();
  v_pessoa uuid;
  v_nome text;
begin
  if v_uid is null then raise exception 'Entre na sua conta para aceitar o convite.'; end if;
  select * into c from public.equipe_convites where token = p_token for update;
  if not found or c.revogado_em is not null then raise exception 'Convite inválido ou cancelado.'; end if;
  if c.aceito_em is not null then raise exception 'Este convite já foi usado.'; end if;
  if c.expira_em < now() then raise exception 'Este convite venceu. Peça um novo ao administrador.'; end if;
  if not privado.org_imobiliaria(c.organizacao_id) then raise exception 'Convites de equipe só existem no modo imobiliária.'; end if;
  if v_email is null or v_email <> lower(c.email) then
    raise exception 'Este convite é para o e-mail %. Entre com ele.', privado.mascarar_email(c.email);
  end if;
  if not privado.email_confirmado() then
    raise exception 'Confirme o seu e-mail (pelo link que chegou na sua caixa de entrada) e abra o convite de novo.';
  end if;
  if exists (select 1 from public.membros where user_id = v_uid and organizacao_id = c.organizacao_id) then
    raise exception 'Você já faz parte desta imobiliária.';
  end if;
  if exists (select 1 from public.membros where user_id = v_uid) then
    raise exception 'Esta conta já faz parte de outra imobiliária. Use outro e-mail.';
  end if;

  v_pessoa := c.pessoa_id;
  if v_pessoa is not null and (exists (select 1 from public.membros where organizacao_id = c.organizacao_id and pessoa_id = v_pessoa)
                               or not exists (select 1 from public.pessoas where id = v_pessoa and organizacao_id = c.organizacao_id)) then
    v_pessoa := null;
  end if;
  if v_pessoa is null then
    insert into public.pessoas (organizacao_id, nome, email, papeis, colaborador)
    values (c.organizacao_id, coalesce(nullif(btrim(c.nome), ''), split_part(c.email, '@', 1)), c.email,
            case when c.papel = 'corretor' then '{corretor}'::text[] else '{}'::text[] end, true)
    returning id into v_pessoa;
  else
    update public.pessoas set colaborador = true, email = coalesce(email, c.email),
      papeis = case when c.papel = 'corretor' and not ('corretor' = any (papeis)) then papeis || '{corretor}'::text[] else papeis end
     where id = v_pessoa;
  end if;
  select nome into v_nome from public.pessoas where id = v_pessoa;

  insert into public.membros (organizacao_id, user_id, papel, nome, perfil_id, pessoa_id, email)
  values (c.organizacao_id, v_uid, c.papel, coalesce(nullif(btrim(c.nome), ''), v_nome), c.perfil_id, v_pessoa, v_email);
  update public.equipe_convites set aceito_em = now(), aceito_por = v_uid where id = c.id;
  return c.organizacao_id;
end;
$$;
revoke execute on function public.aceitar_convite(uuid) from public, anon;
grant execute on function public.aceitar_convite(uuid) to authenticated;

/**
 * Muda os dados de acesso de um usuário. p: {nome?, cargo?, pessoa_id?, papel?, perfil_id?}
 * Papel e perfil: só o administrador. Sempre fica pelo menos um administrador.
 */
create or replace function public.equipe_salvar_membro(p_user uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  m public.membros%rowtype;
  v_admin boolean;
  v_papel text;
  v_perfil uuid;
  v_pessoa uuid;
begin
  if auth.uid() is null or v_org is null then raise exception 'Entre na sua conta.'; end if;
  if not privado.org_imobiliaria(v_org) then raise exception 'A gestão de equipe só existe no modo imobiliária.'; end if;
  v_admin := coalesce(privado.papel_atual(v_org), '') = 'admin';
  if not v_admin and not privado.tem_permissao(v_org, 'equipe', 'editar') then
    raise exception 'Seu perfil de acesso não permite mudar usuários.';
  end if;
  select * into m from public.membros where organizacao_id = v_org and user_id = p_user for update;
  if not found then raise exception 'Usuário não encontrado nesta imobiliária.'; end if;
  if not v_admin and m.papel = 'admin' then raise exception 'Só o administrador muda outro administrador.'; end if;

  v_papel := coalesce(nullif(p->>'papel', ''), m.papel);
  if v_papel not in ('admin','gestor','financeiro','corretor') then raise exception 'Papel inválido.'; end if;
  if v_papel <> m.papel and not v_admin then raise exception 'Só o administrador muda o papel.'; end if;
  if m.papel = 'admin' and v_papel <> 'admin'
     and (select count(*) from public.membros where organizacao_id = v_org and papel = 'admin') <= 1 then
    raise exception 'A imobiliária precisa de pelo menos um administrador.';
  end if;

  if p ? 'perfil_id' then
    v_perfil := nullif(p->>'perfil_id', '')::uuid;
    if v_perfil is distinct from m.perfil_id and not v_admin then raise exception 'Só o administrador muda o perfil de acesso.'; end if;
    if v_perfil is not null and not exists (select 1 from public.perfis_acesso where id = v_perfil and organizacao_id = v_org) then
      raise exception 'Perfil de acesso não encontrado.';
    end if;
  else
    v_perfil := m.perfil_id;
  end if;

  if p ? 'pessoa_id' then
    v_pessoa := nullif(p->>'pessoa_id', '')::uuid;
    if v_pessoa is not null and not exists (select 1 from public.pessoas where id = v_pessoa and organizacao_id = v_org) then
      raise exception 'Cadastro não encontrado.';
    end if;
    if v_pessoa is not null and exists (select 1 from public.membros where organizacao_id = v_org and pessoa_id = v_pessoa and user_id <> p_user) then
      raise exception 'Este cadastro já está ligado a outro usuário.';
    end if;
  else
    v_pessoa := m.pessoa_id;
  end if;

  update public.membros set
    papel = v_papel,
    perfil_id = v_perfil,
    pessoa_id = v_pessoa,
    nome = case when p ? 'nome' then coalesce(nullif(btrim(p->>'nome'), ''), nome) else nome end,
    cargo = case when p ? 'cargo' then nullif(btrim(p->>'cargo'), '') else cargo end
  where organizacao_id = v_org and user_id = p_user;
  if v_pessoa is not null then
    update public.pessoas set colaborador = true where id = v_pessoa and not colaborador;
  end if;
end;
$$;
revoke execute on function public.equipe_salvar_membro(uuid, jsonb) from public, anon;
grant execute on function public.equipe_salvar_membro(uuid, jsonb) to authenticated;

/** Tira o acesso de um usuário (só administrador; sempre fica um administrador). */
create or replace function public.equipe_remover_membro(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  m public.membros%rowtype;
begin
  if auth.uid() is null or v_org is null then raise exception 'Entre na sua conta.'; end if;
  if coalesce(privado.papel_atual(v_org), '') <> 'admin' then raise exception 'Só o administrador tira o acesso de um usuário.'; end if;
  select * into m from public.membros where organizacao_id = v_org and user_id = p_user for update;
  if not found then raise exception 'Usuário não encontrado nesta imobiliária.'; end if;
  if m.papel = 'admin' and (select count(*) from public.membros where organizacao_id = v_org and papel = 'admin') <= 1 then
    raise exception 'A imobiliária precisa de pelo menos um administrador.';
  end if;
  delete from public.membros where organizacao_id = v_org and user_id = p_user;
end;
$$;
revoke execute on function public.equipe_remover_membro(uuid) from public, anon;
grant execute on function public.equipe_remover_membro(uuid) to authenticated;

/** Cria a ficha de colaborador (Pessoas) de um usuário que ainda não tem. */
create or replace function public.equipe_criar_ficha(p_user uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  m public.membros%rowtype;
  v_id uuid;
begin
  if auth.uid() is null or v_org is null then raise exception 'Entre na sua conta.'; end if;
  if not privado.org_imobiliaria(v_org) then raise exception 'A gestão de equipe só existe no modo imobiliária.'; end if;
  if p_user <> auth.uid() and not privado.tem_permissao(v_org, 'equipe', 'editar') then
    raise exception 'Seu perfil de acesso não permite mudar usuários.';
  end if;
  select * into m from public.membros where organizacao_id = v_org and user_id = p_user for update;
  if not found then raise exception 'Usuário não encontrado nesta imobiliária.'; end if;
  if m.pessoa_id is not null then return m.pessoa_id; end if;
  insert into public.pessoas (organizacao_id, nome, email, papeis, colaborador, cargo)
  values (v_org, coalesce(nullif(btrim(m.nome), ''), split_part(coalesce(m.email, 'colaborador'), '@', 1)), m.email,
          case when m.papel = 'corretor' then '{corretor}'::text[] else '{}'::text[] end, true, m.cargo)
  returning id into v_id;
  update public.membros set pessoa_id = v_id where organizacao_id = v_org and user_id = p_user;
  return v_id;
end;
$$;
revoke execute on function public.equipe_criar_ficha(uuid) from public, anon;
grant execute on function public.equipe_criar_ficha(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Documentos profissionais (com validade)
-- -----------------------------------------------------------------------------
create table if not exists public.equipe_documentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  tipo text not null,
  descricao text,
  numero text,
  emissao date,
  validade date,
  path text,
  nome_arquivo text,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists equipe_documentos_pessoa_idx on public.equipe_documentos (pessoa_id);
create index if not exists equipe_documentos_validade_idx on public.equipe_documentos (organizacao_id, validade) where validade is not null;

/** Documentos: quem tem Equipe → editar, ou o próprio colaborador (os dele). */
create or replace function privado.equipe_documentos_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_pessoa uuid;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; v_pessoa := old.pessoa_id; else v_org := new.organizacao_id; v_pessoa := new.pessoa_id; end if;
  if privado.chamada_da_api()
     and not exists (select 1 from public.membros where organizacao_id = v_org and user_id = auth.uid() and pessoa_id = v_pessoa) then
    perform privado.exigir_permissao(v_org, 'equipe', 'editar');
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_op = 'UPDATE' and new.pessoa_id <> old.pessoa_id and privado.chamada_da_api() then
    raise exception 'O documento não muda de colaborador.';
  end if;
  if tg_op = 'INSERT' and privado.chamada_da_api()
     and not exists (select 1 from public.pessoas p where p.id = new.pessoa_id and p.organizacao_id = new.organizacao_id) then
    raise exception 'Colaborador não encontrado.';
  end if;
  return new;
end;
$$;
create or replace trigger equipe_documentos_guarda_trg before insert or update or delete on public.equipe_documentos
  for each row execute function privado.equipe_documentos_guarda();

/**
 * Documentos profissionais são dados pessoais (RG, CPF, comprovante de
 * residência…): só o próprio colaborador e quem tem Equipe → editar leem,
 * gravam e apagam (LGPD). Vale para a tabela e para os arquivos.
 */
create or replace function privado.equipe_doc_permitido(p_org uuid, p_pessoa uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org in (select privado.org_ids())
     and (exists (select 1 from public.membros m where m.organizacao_id = p_org and m.user_id = auth.uid() and m.pessoa_id = p_pessoa)
          or privado.tem_permissao(p_org, 'equipe', 'editar'))
$$;
revoke execute on function privado.equipe_doc_permitido(uuid, uuid) from public, anon;
grant execute on function privado.equipe_doc_permitido(uuid, uuid) to authenticated;

/** Mesmo critério para o arquivo, pela pasta "<organização>/<pessoa>/<arquivo>". */
create or replace function privado.equipe_arquivo_permitido(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v text[] := string_to_array(coalesce(p_nome, ''), '/');
  v_uuid text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if coalesce(array_length(v, 1), 0) < 3 or v[1] !~ v_uuid or v[2] !~ v_uuid or v[3] = '' then return false; end if;
  return privado.equipe_doc_permitido(v[1]::uuid, v[2]::uuid);
end;
$$;
revoke execute on function privado.equipe_arquivo_permitido(text) from public, anon;
grant execute on function privado.equipe_arquivo_permitido(text) to authenticated;

-- Storage: bucket privado "equipe" (pasta <org>/<pessoa>/...) --------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('equipe', 'equipe', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'equipe_ler') then
      execute $p$create policy equipe_ler on storage.objects for select to authenticated
        using (bucket_id = 'equipe' and privado.equipe_arquivo_permitido(name))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'equipe_gravar') then
      execute $p$create policy equipe_gravar on storage.objects for insert to authenticated
        with check (bucket_id = 'equipe' and privado.equipe_arquivo_permitido(name))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'equipe_apagar') then
      execute $p$create policy equipe_apagar on storage.objects for delete to authenticated
        using (bucket_id = 'equipe' and privado.equipe_arquivo_permitido(name))$p$;
    end if;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 4b. Ficha do colaborador, equipes, filial e carteira garantidas no banco
-- -----------------------------------------------------------------------------
/**
 * Ficha do colaborador (Pessoas): cargo, admissão, desligamento, filial,
 * "é colaborador" e o corretor da carteira só com Equipe → editar (criar, no
 * cadastro novo). O CRECI também pode ser mudado pelo próprio colaborador.
 * Chamadas feitas pelo próprio banco (funções, FKs) passam.
 */
create or replace function privado.pessoas_equipe_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not privado.chamada_da_api() then return new; end if;
  if tg_op = 'INSERT' then
    if new.colaborador or new.cargo is not null or new.admissao is not null or new.desligamento is not null
       or new.filial_id is not null or new.corretor_id is not null
       or new.creci_numero is not null or new.creci_uf is not null or new.creci_validade is not null or new.creci_tipo is not null then
      perform privado.exigir_permissao(new.organizacao_id, 'equipe', 'criar');
    end if;
  else
    if new.colaborador is distinct from old.colaborador or new.cargo is distinct from old.cargo
       or new.admissao is distinct from old.admissao or new.desligamento is distinct from old.desligamento
       or new.filial_id is distinct from old.filial_id or new.corretor_id is distinct from old.corretor_id then
      perform privado.exigir_permissao(new.organizacao_id, 'equipe', 'editar');
    end if;
    if (new.creci_numero is distinct from old.creci_numero or new.creci_uf is distinct from old.creci_uf
        or new.creci_validade is distinct from old.creci_validade or new.creci_tipo is distinct from old.creci_tipo)
       and not exists (select 1 from public.membros m where m.organizacao_id = new.organizacao_id and m.user_id = auth.uid() and m.pessoa_id = new.id) then
      perform privado.exigir_permissao(new.organizacao_id, 'equipe', 'editar');
    end if;
  end if;
  if new.filial_id is not null and (tg_op = 'INSERT' or new.filial_id is distinct from old.filial_id)
     and not exists (select 1 from public.filiais f where f.id = new.filial_id and f.organizacao_id = new.organizacao_id) then
    raise exception 'Filial não encontrada.';
  end if;
  if new.corretor_id is not null and (tg_op = 'INSERT' or new.corretor_id is distinct from old.corretor_id) then
    if new.corretor_id = new.id then raise exception 'A pessoa não pode ser corretora da própria carteira.'; end if;
    if not exists (select 1 from public.pessoas p where p.id = new.corretor_id and p.organizacao_id = new.organizacao_id) then
      raise exception 'Corretor não encontrado.';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger pessoas_equipe_guarda_trg before insert or update on public.pessoas
  for each row execute function privado.pessoas_equipe_guarda();

/**
 * Equipes e quem está em cada uma (tabelas da etapa de comissões): pela API,
 * só quem tem Equipe → editar ou Comissões → editar; tudo da mesma imobiliária.
 */
create or replace function privado.equipes_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_pilha text;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; else v_org := new.organizacao_id; end if;
  if not privado.chamada_da_api() then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  -- "Juntar repetidos" (public.juntar_pessoas, que roda como o usuário) passa a
  -- equipe e a liderança do cadastro que sai para o que fica: deixa passar.
  get diagnostics v_pilha = pg_context;
  if tg_op <> 'INSERT' and v_pilha like '%juntar_pessoas(uuid,uuid)%' then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  if auth.uid() is not null and not privado.tem_permissao(v_org, 'equipe', 'editar') and not privado.tem_permissao(v_org, 'comissoes', 'editar') then
    raise exception 'Seu perfil de acesso não permite mudar as equipes. Fale com o administrador.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if tg_table_name = 'equipe_membros' then
    if not exists (select 1 from public.equipes e where e.id = new.equipe_id and e.organizacao_id = v_org) then
      raise exception 'Equipe não encontrada.';
    end if;
    if not exists (select 1 from public.pessoas p where p.id = new.pessoa_id and p.organizacao_id = v_org) then
      raise exception 'Colaborador não encontrado.';
    end if;
  else
    if new.filial_id is not null and (tg_op = 'INSERT' or new.filial_id is distinct from old.filial_id)
       and not exists (select 1 from public.filiais f where f.id = new.filial_id and f.organizacao_id = v_org) then
      raise exception 'Filial não encontrada.';
    end if;
    if new.lider_id is not null and (tg_op = 'INSERT' or new.lider_id is distinct from old.lider_id)
       and not exists (select 1 from public.pessoas p where p.id = new.lider_id and p.organizacao_id = v_org) then
      raise exception 'Gestor da equipe não encontrado.';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger equipes_guarda_trg before insert or update or delete on public.equipes
  for each row execute function privado.equipes_guarda();
create or replace trigger equipe_membros_guarda_trg before insert or update or delete on public.equipe_membros
  for each row execute function privado.equipes_guarda();

/**
 * Coloca (ou tira, com p_equipe nulo) o colaborador numa equipe. Cada pessoa
 * fica numa equipe só; sem mudança, não grava nada (nem no histórico). Uma
 * instrução só: não fica "sem equipe" no meio do caminho. As travas de
 * permissão são as das tabelas (SECURITY INVOKER).
 */
create or replace function public.equipe_definir_equipe(p_pessoa uuid, p_equipe uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_atual uuid;
begin
  if auth.uid() is null or v_org is null then raise exception 'Entre na sua conta.'; end if;
  if not exists (select 1 from public.pessoas where id = p_pessoa and organizacao_id = v_org) then
    raise exception 'Colaborador não encontrado.';
  end if;
  select equipe_id into v_atual from public.equipe_membros where pessoa_id = p_pessoa;
  if v_atual is not distinct from p_equipe then return; end if;
  if p_equipe is null then
    delete from public.equipe_membros where pessoa_id = p_pessoa;
  else
    insert into public.equipe_membros (organizacao_id, equipe_id, pessoa_id) values (v_org, p_equipe, p_pessoa)
    on conflict (pessoa_id) do update set equipe_id = excluded.equipe_id;
  end if;
end;
$$;
revoke execute on function public.equipe_definir_equipe(uuid, uuid) from public, anon;
grant execute on function public.equipe_definir_equipe(uuid, uuid) to authenticated;

/** Filial de um corretor: a da ficha dele ou, sem ela, a da equipe dele. */
create or replace function privado.filial_do_corretor(p_org uuid, p_corretor uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(p.filial_id,
                  (select e.filial_id from public.equipe_membros em join public.equipes e on e.id = em.equipe_id
                    where em.pessoa_id = p.id and e.organizacao_id = p_org limit 1))
    from public.pessoas p
   where p.id = p_corretor and p.organizacao_id = p_org
$$;
revoke execute on function privado.filial_do_corretor(uuid, uuid) from public, anon;
grant execute on function privado.filial_do_corretor(uuid, uuid) to authenticated;

/**
 * Leads e imóveis ganham a filial do corretor responsável (ao nascer sem
 * filial ou quando o corretor muda e a filial não foi escolhida na mesma hora).
 */
create or replace function privado.filial_pelo_corretor()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.corretor_id is null then return new; end if;
  if tg_op = 'INSERT' then
    if new.filial_id is null then new.filial_id := privado.filial_do_corretor(new.organizacao_id, new.corretor_id); end if;
  elsif new.corretor_id is distinct from old.corretor_id and new.filial_id is not distinct from old.filial_id then
    new.filial_id := coalesce(privado.filial_do_corretor(new.organizacao_id, new.corretor_id), old.filial_id);
  end if;
  return new;
end;
$$;
create or replace trigger leads_filial_trg before insert or update of corretor_id on public.leads
  for each row execute function privado.filial_pelo_corretor();
create or replace trigger imoveis_filial_trg before insert or update of corretor_id on public.imoveis
  for each row execute function privado.filial_pelo_corretor();

/** Contrato nasce com a filial do imóvel. */
create or replace function privado.contratos_filial()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.filial_id is null and new.imovel_id is not null and (tg_op = 'INSERT' or new.imovel_id is distinct from old.imovel_id) then
    new.filial_id := (select i.filial_id from public.imoveis i where i.id = new.imovel_id and i.organizacao_id = new.organizacao_id);
  end if;
  return new;
end;
$$;
create or replace trigger contratos_filial_trg before insert or update of imovel_id on public.contratos
  for each row execute function privado.contratos_filial();

/** Mudou a filial do corretor: os leads abertos e imóveis dele que estavam na filial antiga vão junto. */
create or replace function privado.pessoas_filial_propagar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.leads set filial_id = new.filial_id
   where organizacao_id = new.organizacao_id and corretor_id = new.id and status not in ('ganho', 'perdido')
     and filial_id is not distinct from old.filial_id;
  update public.imoveis set filial_id = new.filial_id
   where organizacao_id = new.organizacao_id and corretor_id = new.id and filial_id is not distinct from old.filial_id;
  return null;
end;
$$;
create or replace trigger pessoas_filial_propagar_trg after update of filial_id on public.pessoas
  for each row when (old.filial_id is distinct from new.filial_id) execute function privado.pessoas_filial_propagar();

/** Mudou a filial do imóvel: os contratos em vigor (ou rascunho) dele vão junto. */
create or replace function privado.imoveis_filial_propagar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.contratos set filial_id = new.filial_id
   where organizacao_id = new.organizacao_id and imovel_id = new.id and status in ('rascunho', 'ativo')
     and filial_id is not distinct from old.filial_id;
  return null;
end;
$$;
create or replace trigger imoveis_filial_propagar_trg after update of filial_id on public.imoveis
  for each row when (old.filial_id is distinct from new.filial_id) execute function privado.imoveis_filial_propagar();

/** Venda com comprador e corretor: o comprador entra na carteira do corretor (se ainda não tem corretor). */
create or replace function privado.carteira_da_venda()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.comprador_id is not null and new.corretor_id is not null and new.comprador_id <> new.corretor_id then
    update public.pessoas set corretor_id = new.corretor_id
     where id = new.comprador_id and organizacao_id = new.organizacao_id and corretor_id is null
       and exists (select 1 from public.pessoas c where c.id = new.corretor_id and c.organizacao_id = new.organizacao_id);
  end if;
  return null;
end;
$$;
create or replace trigger vendas_carteira_trg after insert or update of comprador_id, corretor_id on public.vendas
  for each row execute function privado.carteira_da_venda();

-- -----------------------------------------------------------------------------
-- 5. Metas individuais e coletivas
-- -----------------------------------------------------------------------------
create table if not exists public.equipe_metas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  tipo text not null check (tipo in ('leads','atendimentos','visitas','propostas','locacoes','vendas','valor_vendas','captacoes','tarefas','chamados')),
  alvo text not null check (alvo in ('pessoa','equipe','filial')),
  pessoa_id uuid references public.pessoas(id) on delete cascade,
  equipe_id uuid references public.equipes(id) on delete cascade,
  filial_id uuid references public.filiais(id) on delete cascade,
  valor numeric(14,2) not null check (valor > 0),
  created_at timestamptz not null default now(),
  constraint equipe_metas_destino_check check (
    (alvo = 'pessoa' and pessoa_id is not null and equipe_id is null and filial_id is null)
    or (alvo = 'equipe' and equipe_id is not null and pessoa_id is null and filial_id is null)
    or (alvo = 'filial' and filial_id is not null and pessoa_id is null and equipe_id is null))
);
create unique index if not exists equipe_metas_unica_idx
  on public.equipe_metas (organizacao_id, competencia, tipo, alvo, coalesce(pessoa_id, equipe_id, filial_id));
create index if not exists equipe_metas_comp_idx on public.equipe_metas (organizacao_id, competencia);

-- -----------------------------------------------------------------------------
-- 6. Distribuição: regras de fila/rodízio e redistribuição em massa
-- -----------------------------------------------------------------------------
create table if not exists public.equipe_distribuicao_regras (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  funil text check (funil is null or funil in ('locacao','venda','captacao')),
  origem text,
  equipe_id uuid references public.equipes(id) on delete cascade,
  filial_id uuid references public.filiais(id) on delete cascade,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  constraint equipe_distribuicao_regras_grupo_check check (equipe_id is not null or filial_id is not null)
);

create table if not exists public.equipe_distribuicoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  tipo text not null,
  de_pessoa_id uuid references public.pessoas(id) on delete set null,
  de_nome text,
  para_pessoa_id uuid references public.pessoas(id) on delete set null,
  para_nome text,
  equipe_id uuid references public.equipes(id) on delete set null,
  filial_id uuid references public.filiais(id) on delete set null,
  quantidade int not null default 0,
  ids uuid[] not null default '{}',
  destinos jsonb not null default '{}'::jsonb,
  motivo text,
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index if not exists equipe_distribuicoes_data_idx on public.equipe_distribuicoes (organizacao_id, data desc);

/**
 * Próximo corretor da fila: se houver regra ativa para o funil/origem, só os
 * corretores da equipe/filial da regra; quem recebeu lead ou captação há mais
 * tempo (ou nunca) vem primeiro. Sem ninguém no grupo, vale a fila geral.
 */
create or replace function privado.proximo_corretor(p_org uuid, p_funil text, p_origem text)
returns uuid
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  r public.equipe_distribuicao_regras%rowtype;
  v_id uuid;
  v_tem_regra boolean;
begin
  select * into r from public.equipe_distribuicao_regras x
   where x.organizacao_id = p_org and x.ativa
     and (x.funil is null or x.funil = p_funil)
     and (x.origem is null or x.origem = p_origem)
   order by (x.origem is not null) desc, (x.funil is not null) desc, x.created_at
   limit 1;
  v_tem_regra := found;
  for i in 1..2 loop
    select pe.id into v_id
      from public.pessoas pe
     where pe.organizacao_id = p_org
       and 'corretor' = any (pe.papeis)
       and pe.recebe_leads
       and (pe.desligamento is null or pe.desligamento > current_date)
       and (i = 2 or not v_tem_regra
            or (r.equipe_id is not null and exists (select 1 from public.equipe_membros em where em.pessoa_id = pe.id and em.equipe_id = r.equipe_id))
            or (r.equipe_id is null and r.filial_id is not null and (pe.filial_id = r.filial_id
                 or exists (select 1 from public.equipe_membros em join public.equipes e on e.id = em.equipe_id
                             where em.pessoa_id = pe.id and e.filial_id = r.filial_id))))
     order by greatest(
       (select max(l.atribuido_em) from public.leads l where l.corretor_id = pe.id),
       (select max(c.created_at) from public.captacoes c where c.corretor_id = pe.id)) nulls first, pe.nome
     limit 1;
    exit when v_id is not null or not v_tem_regra;
  end loop;
  return v_id;
end;
$$;
revoke execute on function privado.proximo_corretor(uuid, text, text) from public, anon;
grant execute on function privado.proximo_corretor(uuid, text, text) to authenticated;

/** Rodízio usado nas telas (lead/captação criados à mão): respeita as regras por equipe/filial. */
create or replace function public.proximo_corretor_lead()
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select privado.proximo_corretor(privado.org_atual(), null, null)
$$;
revoke execute on function public.proximo_corretor_lead() from public, anon;
grant execute on function public.proximo_corretor_lead() to authenticated;

/** Mesmo rodízio, sabendo o funil e a origem (para as telas usarem as regras específicas). */
create or replace function public.proximo_corretor_fila(p_funil text, p_origem text)
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select privado.proximo_corretor(privado.org_atual(), p_funil, p_origem)
$$;
revoke execute on function public.proximo_corretor_fila(text, text) from public, anon;
grant execute on function public.proximo_corretor_fila(text, text) to authenticated;

-- A entrada automática de leads (formulário, site, portais, marketing) passa a
-- usar a fila por equipe/filial. A função é recriada A PARTIR DO CORPO QUE ESTÁ
-- NO BANCO, trocando só o bloco do rodízio (idempotente, sem DROP).
do $$
declare
  v_def text;
  v_novo text;
begin
  if to_regprocedure('public.receber_lead(uuid, jsonb)') is null then
    raise warning 'public.receber_lead não existe: a fila por equipe/filial não vale para leads automáticos.';
    return;
  end if;
  v_def := pg_get_functiondef('public.receber_lead(uuid, jsonb)'::regprocedure);
  if v_def ilike '%privado.proximo_corretor(%' then
    return;
  end if;
  v_novo := regexp_replace(v_def,
    'if org\.distribuicao_leads = ''rodizio'' then.*?end if;',
    'if org.distribuicao_leads = ''rodizio'' then
    v_corretor := privado.proximo_corretor(org.id, v_funil, v_origem);
  end if;');
  if v_novo = v_def then
    raise warning 'Não achei o bloco do rodízio em public.receber_lead: a fila por equipe/filial não vale para leads automáticos.';
    return;
  end if;
  execute v_novo;
end $$;

/**
 * Redistribui a carteira de um corretor (em massa ou só os escolhidos) para
 * outro corretor ou pelo rodízio de uma equipe/filial (quem tem menos carga
 * recebe primeiro), com motivo e histórico. Exige Equipe → editar.
 * p: {tipo: leads|captacoes|imoveis|clientes|visitas, de, para?, equipe_id?, filial_id?, ids?: [], motivo, abertos?: bool}
 */
create or replace function public.equipe_redistribuir(p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_tipo text := coalesce(p->>'tipo', '');
  v_de uuid := nullif(p->>'de', '')::uuid;
  v_para uuid := nullif(p->>'para', '')::uuid;
  v_equipe uuid := nullif(p->>'equipe_id', '')::uuid;
  v_filial uuid := nullif(p->>'filial_id', '')::uuid;
  v_motivo text := left(btrim(coalesce(p->>'motivo', '')), 500);
  v_abertos boolean := coalesce((p->>'abertos')::boolean, true);
  v_sel text[];
  v_ids uuid[];
  v_destinos uuid[];
  v_carga int[] := '{}';
  v_alvo uuid;
  v_alvo_nome text;
  v_alvo_user uuid;
  v_id uuid;
  v_i int;
  v_mapa jsonb := '{}'::jsonb;
  v_de_nome text;
  v_para_nome text;
  v_total int := 0;
begin
  if auth.uid() is null or v_org is null then raise exception 'Entre na sua conta.'; end if;
  if not privado.org_imobiliaria(v_org) then raise exception 'A gestão de equipe só existe no modo imobiliária.'; end if;
  if not privado.tem_permissao(v_org, 'equipe', 'editar') then
    raise exception 'Seu perfil de acesso não permite redistribuir atendimentos.';
  end if;
  if v_tipo not in ('leads','captacoes','imoveis','clientes','visitas') then raise exception 'Escolha o que redistribuir.'; end if;
  if length(v_motivo) < 3 then raise exception 'Informe o motivo da redistribuição.'; end if;
  select nome into v_de_nome from public.pessoas where id = v_de and organizacao_id = v_org;
  if v_de_nome is null then raise exception 'Escolha de quem sai a carteira.'; end if;
  if jsonb_typeof(p->'ids') = 'array' then
    select array_agg(x) into v_sel from jsonb_array_elements_text(p->'ids') x;
    if v_sel is null then raise exception 'Marque o que vai ser redistribuído.'; end if;
  end if;

  -- Para quem vai
  if v_para is not null then
    if v_para = v_de then raise exception 'Escolha outro colaborador para receber.'; end if;
    select nome into v_para_nome from public.pessoas where id = v_para and organizacao_id = v_org;
    if v_para_nome is null then raise exception 'Colaborador de destino não encontrado.'; end if;
    v_destinos := array[v_para];
  elsif v_equipe is not null or v_filial is not null then
    select array_agg(pe.id order by pe.nome) into v_destinos
      from public.pessoas pe
     where pe.organizacao_id = v_org and pe.id <> v_de and 'corretor' = any (pe.papeis)
       and (pe.desligamento is null or pe.desligamento > current_date)
       and (v_equipe is null or exists (select 1 from public.equipe_membros em where em.pessoa_id = pe.id and em.equipe_id = v_equipe))
       and (v_filial is null or pe.filial_id = v_filial
            or exists (select 1 from public.equipe_membros em join public.equipes e on e.id = em.equipe_id
                        where em.pessoa_id = pe.id and e.filial_id = v_filial));
    if v_destinos is null then raise exception 'Não há corretores ativos nesse grupo para receber.'; end if;
  else
    raise exception 'Escolha para quem vai: um colaborador ou o rodízio de uma equipe/filial.';
  end if;

  -- O que sai
  if v_tipo = 'leads' then
    select array_agg(id order by created_at) into v_ids from public.leads
     where organizacao_id = v_org and corretor_id = v_de and (not v_abertos or status not in ('ganho','perdido'))
       and (v_sel is null or id::text = any (v_sel));
  elsif v_tipo = 'captacoes' then
    select array_agg(id order by created_at) into v_ids from public.captacoes
     where organizacao_id = v_org and corretor_id = v_de and (not v_abertos or status not in ('captado','nao_captado'))
       and (v_sel is null or id::text = any (v_sel));
  elsif v_tipo = 'imoveis' then
    select array_agg(id order by codigo) into v_ids from public.imoveis
     where organizacao_id = v_org and corretor_id = v_de and (not v_abertos or status not in ('inativo','vendido'))
       and (v_sel is null or id::text = any (v_sel));
  elsif v_tipo = 'clientes' then
    select array_agg(id order by nome) into v_ids from public.pessoas
     where organizacao_id = v_org and corretor_id = v_de
       and (v_sel is null or id::text = any (v_sel));
  else
    select array_agg(id order by data_hora) into v_ids from public.visitas
     where organizacao_id = v_org and corretor_id = v_de and status = 'agendada' and data_hora >= now()
       and (v_sel is null or id::text = any (v_sel));
  end if;
  if v_ids is null then raise exception 'Não há nada para redistribuir com essas escolhas.'; end if;
  if array_length(v_ids, 1) > 5000 then raise exception 'São mais de 5.000 itens de uma vez; escolha menos.'; end if;

  -- Carga atual de cada destino (quem tem menos recebe primeiro)
  foreach v_alvo in array v_destinos loop
    v_carga := v_carga || (case v_tipo
      when 'leads' then (select count(*) from public.leads where corretor_id = v_alvo and status not in ('ganho','perdido'))
      when 'captacoes' then (select count(*) from public.captacoes where corretor_id = v_alvo and status not in ('captado','nao_captado'))
      when 'imoveis' then (select count(*) from public.imoveis where corretor_id = v_alvo and status not in ('inativo','vendido'))
      when 'clientes' then (select count(*) from public.pessoas where corretor_id = v_alvo)
      else (select count(*) from public.visitas where corretor_id = v_alvo and status = 'agendada' and data_hora >= now()) end)::int;
  end loop;

  foreach v_id in array v_ids loop
    v_i := 1;
    for k in 2..coalesce(array_length(v_destinos, 1), 1) loop
      if v_carga[k] < v_carga[v_i] then v_i := k; end if;
    end loop;
    v_alvo := v_destinos[v_i];
    v_carga[v_i] := v_carga[v_i] + 1;
    select nome into v_alvo_nome from public.pessoas where id = v_alvo;
    if v_tipo = 'leads' then
      update public.leads set corretor_id = v_alvo, atribuido_em = now() where id = v_id;
      insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao)
      values (v_org, v_id, 'transferencia', 'Transferido de ' || v_de_nome || ' para ' || v_alvo_nome || ' · ' || v_motivo);
    elsif v_tipo = 'captacoes' then
      update public.captacoes set corretor_id = v_alvo where id = v_id;
      insert into public.captacao_eventos (organizacao_id, captacao_id, tipo, descricao)
      values (v_org, v_id, 'nota', 'Transferida de ' || v_de_nome || ' para ' || v_alvo_nome || ' · ' || v_motivo);
    elsif v_tipo = 'imoveis' then
      update public.imoveis set corretor_id = v_alvo where id = v_id;
    elsif v_tipo = 'clientes' then
      update public.pessoas set corretor_id = v_alvo where id = v_id;
    else
      select user_id into v_alvo_user from public.membros where organizacao_id = v_org and pessoa_id = v_alvo;
      update public.visitas set corretor_id = v_alvo, responsavel_id = coalesce(v_alvo_user, responsavel_id) where id = v_id;
    end if;
    v_mapa := jsonb_set(v_mapa, array[v_alvo::text], to_jsonb(coalesce((v_mapa ->> v_alvo::text)::int, 0) + 1));
    v_total := v_total + 1;
  end loop;

  insert into public.equipe_distribuicoes (organizacao_id, tipo, de_pessoa_id, de_nome, para_pessoa_id, para_nome, equipe_id, filial_id,
                                           quantidade, ids, destinos, motivo, usuario_id)
  values (v_org, v_tipo, v_de, v_de_nome, v_para, v_para_nome, v_equipe, v_filial, v_total, v_ids, v_mapa, v_motivo, auth.uid());
  return jsonb_build_object('quantidade', v_total, 'destinos', v_mapa);
end;
$$;
revoke execute on function public.equipe_redistribuir(jsonb) from public, anon;
grant execute on function public.equipe_redistribuir(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Tarefas internas
-- -----------------------------------------------------------------------------
create table if not exists public.equipe_tarefas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  numero bigint generated by default as identity,
  titulo text not null,
  descricao text,
  categoria text not null default 'geral'
    check (categoria in ('geral','administrativo','financeiro','juridico','documentacao','manutencao','atendimento','ti','rh')),
  prioridade text not null default 'normal' check (prioridade in ('baixa','normal','alta','urgente')),
  status text not null default 'a_fazer' check (status in ('a_fazer','em_andamento','aguardando','concluida','cancelada')),
  responsavel_id uuid,
  criado_por uuid default auth.uid(),
  prazo date,
  concluida_em timestamptz,
  imovel_id uuid references public.imoveis(id) on delete set null,
  contrato_id uuid references public.contratos(id) on delete set null,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  equipe_id uuid references public.equipes(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists equipe_tarefas_resp_idx on public.equipe_tarefas (organizacao_id, responsavel_id, status);
create index if not exists equipe_tarefas_status_idx on public.equipe_tarefas (organizacao_id, status, prazo);

create table if not exists public.equipe_tarefa_comentarios (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  tarefa_id uuid not null references public.equipe_tarefas(id) on delete cascade,
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index if not exists equipe_tarefa_comentarios_idx on public.equipe_tarefa_comentarios (tarefa_id, data);

/** Tarefa: todos criam; mudam o responsável, quem criou e quem tem Equipe → editar; apagam quem criou e Equipe → excluir. */
create or replace function privado.equipe_tarefas_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; else v_org := new.organizacao_id; end if;
  if privado.chamada_da_api() then
    if tg_op <> 'DELETE' and not privado.org_imobiliaria(v_org) then
      raise exception 'A gestão de equipe só existe no modo imobiliária.';
    end if;
    if tg_op = 'DELETE' then
      if auth.uid() is distinct from old.criado_por then perform privado.exigir_permissao(v_org, 'equipe', 'excluir'); end if;
      return old;
    elsif tg_op = 'UPDATE' then
      if auth.uid() is distinct from old.criado_por and auth.uid() is distinct from old.responsavel_id then
        perform privado.exigir_permissao(v_org, 'equipe', 'editar');
      end if;
      if new.criado_por is distinct from old.criado_por then raise exception 'Não é possível mudar quem criou a tarefa.'; end if;
    else
      new.criado_por := auth.uid();
    end if;
    -- Só confere quando muda: o responsável que perdeu o acesso não trava a tarefa.
    if new.responsavel_id is not null and (tg_op = 'INSERT' or new.responsavel_id is distinct from old.responsavel_id)
       and not exists (select 1 from public.membros where organizacao_id = v_org and user_id = new.responsavel_id) then
      raise exception 'O responsável precisa ser um usuário desta imobiliária.';
    end if;
    -- Vínculos só desta imobiliária (conferidos quando mudam).
    if new.imovel_id is not null and (tg_op = 'INSERT' or new.imovel_id is distinct from old.imovel_id)
       and not exists (select 1 from public.imoveis x where x.id = new.imovel_id and x.organizacao_id = v_org) then
      raise exception 'Imóvel não encontrado.';
    end if;
    if new.contrato_id is not null and (tg_op = 'INSERT' or new.contrato_id is distinct from old.contrato_id)
       and not exists (select 1 from public.contratos x where x.id = new.contrato_id and x.organizacao_id = v_org) then
      raise exception 'Contrato não encontrado.';
    end if;
    if new.pessoa_id is not null and (tg_op = 'INSERT' or new.pessoa_id is distinct from old.pessoa_id)
       and not exists (select 1 from public.pessoas x where x.id = new.pessoa_id and x.organizacao_id = v_org) then
      raise exception 'Pessoa não encontrada.';
    end if;
    if new.equipe_id is not null and (tg_op = 'INSERT' or new.equipe_id is distinct from old.equipe_id)
       and not exists (select 1 from public.equipes x where x.id = new.equipe_id and x.organizacao_id = v_org) then
      raise exception 'Equipe não encontrada.';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.titulo := btrim(new.titulo);
  if new.titulo = '' then raise exception 'Diga o que precisa ser feito.'; end if;
  new.updated_at := now();
  if new.status = 'concluida' then
    new.concluida_em := coalesce(case when tg_op = 'UPDATE' and old.status = 'concluida' then old.concluida_em end, now());
  else
    new.concluida_em := null;
  end if;
  return new;
end;
$$;
create or replace trigger equipe_tarefas_antes_trg before insert or update or delete on public.equipe_tarefas
  for each row execute function privado.equipe_tarefas_antes();

-- -----------------------------------------------------------------------------
-- 8. Aprovações (caixa central) e regras de quem aprova o quê
-- -----------------------------------------------------------------------------
create table if not exists public.aprovacao_regras (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  tipo text not null default 'qualquer',
  descricao text,
  valor_minimo numeric(14,2) not null default 0 check (valor_minimo >= 0),
  aprovador_papel text check (aprovador_papel is null or aprovador_papel in ('admin','gestor','financeiro')),
  -- Regra sem aprovador não faz sentido: some junto com o perfil (pela API o
  -- perfil só se apaga depois de trocar o aprovador das regras dele).
  aprovador_perfil_id uuid references public.perfis_acesso(id) on delete cascade,
  aprovador_id uuid,
  ativa boolean not null default true,
  created_at timestamptz not null default now(),
  constraint aprovacao_regras_aprovador_check check (aprovador_papel is not null or aprovador_perfil_id is not null or aprovador_id is not null)
);

create table if not exists public.aprovacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  numero bigint generated by default as identity,
  tipo text not null default 'outro',
  titulo text not null,
  descricao text,
  valor numeric(14,2) check (valor is null or valor >= 0),
  referencia_tabela text,
  referencia_id uuid,
  link text,
  solicitante_id uuid default auth.uid(),
  aprovador_id uuid,
  aprovador_papel text check (aprovador_papel is null or aprovador_papel in ('admin','gestor','financeiro')),
  aprovador_perfil_id uuid references public.perfis_acesso(id) on delete set null,
  regra_id uuid references public.aprovacao_regras(id) on delete set null,
  prazo date,
  status text not null default 'pendente' check (status in ('pendente','aprovada','recusada','cancelada')),
  comentario text,
  decidida_em timestamptz,
  decidida_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists aprovacoes_status_idx on public.aprovacoes (organizacao_id, status, created_at desc);
create index if not exists aprovacoes_solicitante_idx on public.aprovacoes (solicitante_id, status);

/** Quem está logado pode decidir esta solicitação? (espelho de podeDecidirAprovacao no app) */
create or replace function privado.pode_aprovar(p_org uuid, p_solicitante uuid, p_aprovador uuid, p_papel text, p_perfil uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  m public.membros%rowtype;
  v_perfil uuid;
begin
  select * into m from public.membros where organizacao_id = p_org and user_id = auth.uid();
  if not found then return false; end if;
  if m.papel = 'admin' then return true; end if;
  if auth.uid() = p_solicitante then return false; end if;
  if not privado.tem_permissao(p_org, 'aprovacoes', 'aprovar') then return false; end if;
  if p_aprovador is not null then return p_aprovador = auth.uid(); end if;
  if p_perfil is not null then
    v_perfil := coalesce(m.perfil_id, (select id from public.perfis_acesso where organizacao_id = p_org and padrao and papel_base = m.papel));
    return v_perfil = p_perfil;
  end if;
  if p_papel is not null then return m.papel = p_papel or (m.papel = 'gestor' and p_papel = 'financeiro'); end if;
  return m.papel = 'gestor';
end;
$$;
revoke execute on function privado.pode_aprovar(uuid, uuid, uuid, text, uuid) from public, anon;
grant execute on function privado.pode_aprovar(uuid, uuid, uuid, text, uuid) to authenticated;

/**
 * Regras da solicitação (valem para a tela, a API e qualquer RPC):
 * nasce pendente e com o aprovador da regra (tipo + valor mínimo); decidir só
 * quem pode (nunca quem pediu, a não ser o administrador); recusar exige motivo;
 * decidida não muda nem se apaga; cancelar só quem pediu ou o administrador.
 */
create or replace function privado.aprovacoes_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_api boolean := privado.chamada_da_api();
  v_admin boolean;
  r public.aprovacao_regras%rowtype;
begin
  if tg_op = 'DELETE' then
    if v_api then
      if old.status not in ('pendente','cancelada') then
        raise exception 'Solicitação decidida não se apaga: ela fica no histórico.';
      end if;
      if auth.uid() is distinct from old.solicitante_id and coalesce(privado.papel_atual(old.organizacao_id), '') <> 'admin' then
        raise exception 'Só quem pediu (ou o administrador) apaga a solicitação.';
      end if;
    end if;
    return old;
  end if;

  -- Quando a regra ou o perfil aprovador é excluído, o próprio banco zera
  -- regra_id/aprovador_perfil_id (FK "set null"), inclusive nas solicitações
  -- já decididas: só isso passa (o resto da solicitação continua intocado).
  if tg_op = 'UPDATE' and not v_api
     and (to_jsonb(new) - array['regra_id', 'aprovador_perfil_id']) = (to_jsonb(old) - array['regra_id', 'aprovador_perfil_id'])
     and (new.regra_id is null or new.regra_id = old.regra_id)
     and (new.aprovador_perfil_id is null or new.aprovador_perfil_id = old.aprovador_perfil_id) then
    return new;
  end if;

  v_admin := coalesce(privado.papel_atual(new.organizacao_id), '') = 'admin';
  new.updated_at := now();
  new.titulo := btrim(coalesce(new.titulo, ''));
  if new.titulo = '' then raise exception 'Diga o que precisa ser aprovado.'; end if;
  -- O link só pode abrir uma tela do próprio sistema (nada de site de fora).
  new.link := nullif(btrim(coalesce(new.link, '')), '');
  if new.link is not null and (left(new.link, 1) <> '/' or new.link ~ '^/[/\\]' or new.link ~ '[[:space:]]' or length(new.link) > 500) then
    if v_api then raise exception 'O link precisa ser uma tela do sistema (começando com /).'; end if;
    new.link := null;
  end if;

  if tg_op = 'INSERT' then
    if v_api then
      if not privado.org_imobiliaria(new.organizacao_id) then raise exception 'A gestão de equipe só existe no modo imobiliária.'; end if;
      perform privado.exigir_permissao(new.organizacao_id, 'aprovacoes', 'criar');
      if (select count(*) from public.aprovacoes where organizacao_id = new.organizacao_id and solicitante_id = auth.uid() and status = 'pendente') >= 200 then
        raise exception 'Você já tem solicitações demais esperando decisão.';
      end if;
    end if;
    new.status := 'pendente';
    new.decidida_em := null;
    new.decidida_por := null;
    new.comentario := null;
    new.solicitante_id := coalesce(auth.uid(), new.solicitante_id);
    if not v_admin or (new.aprovador_id is null and new.aprovador_papel is null and new.aprovador_perfil_id is null) then
      select * into r from public.aprovacao_regras x
       where x.organizacao_id = new.organizacao_id and x.ativa and (x.tipo = new.tipo or x.tipo = 'qualquer')
         and coalesce(new.valor, 0) >= x.valor_minimo
       order by (x.tipo = new.tipo) desc, x.valor_minimo desc, x.created_at
       limit 1;
      if found then
        new.regra_id := r.id;
        new.aprovador_id := r.aprovador_id;
        new.aprovador_papel := r.aprovador_papel;
        new.aprovador_perfil_id := r.aprovador_perfil_id;
      elsif new.aprovador_id is null and new.aprovador_perfil_id is null then
        new.regra_id := null;
        new.aprovador_papel := coalesce(new.aprovador_papel, 'gestor');
      end if;
    end if;
    if new.aprovador_id is not null and not exists (select 1 from public.membros where organizacao_id = new.organizacao_id and user_id = new.aprovador_id) then
      raise exception 'O aprovador precisa ser um usuário desta imobiliária.';
    end if;
    return new;
  end if;

  -- UPDATE
  if old.status <> 'pendente' then
    raise exception 'Esta solicitação já foi decidida e não muda mais.';
  end if;
  if new.organizacao_id <> old.organizacao_id or new.solicitante_id is distinct from old.solicitante_id or new.numero <> old.numero then
    raise exception 'Não é possível mudar quem pediu.';
  end if;

  if new.status = 'pendente' then
    if v_api and auth.uid() is distinct from old.solicitante_id and not v_admin then
      raise exception 'Só quem pediu muda a solicitação.';
    end if;
    if v_api and not v_admin then
      new.aprovador_id := old.aprovador_id;
      new.aprovador_papel := old.aprovador_papel;
      new.aprovador_perfil_id := old.aprovador_perfil_id;
      new.regra_id := old.regra_id;
      if new.tipo is distinct from old.tipo or new.valor is distinct from old.valor then
        select * into r from public.aprovacao_regras x
         where x.organizacao_id = new.organizacao_id and x.ativa and (x.tipo = new.tipo or x.tipo = 'qualquer')
           and coalesce(new.valor, 0) >= x.valor_minimo
         order by (x.tipo = new.tipo) desc, x.valor_minimo desc, x.created_at
         limit 1;
        if found then
          new.regra_id := r.id;
          new.aprovador_id := r.aprovador_id;
          new.aprovador_papel := r.aprovador_papel;
          new.aprovador_perfil_id := r.aprovador_perfil_id;
        elsif old.regra_id is not null then
          new.regra_id := null;
          new.aprovador_id := null;
          new.aprovador_perfil_id := null;
          new.aprovador_papel := 'gestor';
        end if;
      end if;
    end if;
    new.decidida_em := null;
    new.decidida_por := null;
    return new;
  end if;

  if new.status in ('aprovada','recusada') then
    if v_api and not privado.pode_aprovar(old.organizacao_id, old.solicitante_id, old.aprovador_id, old.aprovador_papel, old.aprovador_perfil_id) then
      raise exception 'Você não pode decidir esta solicitação.';
    end if;
    if new.status = 'recusada' and coalesce(btrim(new.comentario), '') = '' then
      raise exception 'Diga o motivo da recusa.';
    end if;
    -- O que foi pedido não muda na decisão.
    new.tipo := old.tipo;
    new.titulo := old.titulo;
    new.descricao := old.descricao;
    new.valor := old.valor;
    new.link := old.link;
    new.aprovador_id := old.aprovador_id;
    new.aprovador_papel := old.aprovador_papel;
    new.aprovador_perfil_id := old.aprovador_perfil_id;
    new.regra_id := old.regra_id;
    new.decidida_em := now();
    new.decidida_por := auth.uid();
    return new;
  end if;

  -- cancelada
  if v_api and auth.uid() is distinct from old.solicitante_id and not v_admin then
    raise exception 'Só quem pediu (ou o administrador) cancela a solicitação.';
  end if;
  new.decidida_em := now();
  new.decidida_por := auth.uid();
  return new;
end;
$$;
create or replace trigger aprovacoes_antes_trg before insert or update or delete on public.aprovacoes
  for each row execute function privado.aprovacoes_antes();

-- -----------------------------------------------------------------------------
-- 9. Comunicação interna: mural de avisos (com leitura) e mensagens
-- -----------------------------------------------------------------------------
create table if not exists public.equipe_avisos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  titulo text not null,
  texto text not null,
  importante boolean not null default false,
  fixado boolean not null default false,
  exige_leitura boolean not null default true,
  para text not null default 'todos' check (para in ('todos','equipe','filial','papel')),
  equipe_id uuid references public.equipes(id) on delete set null,
  filial_id uuid references public.filiais(id) on delete set null,
  papel text check (papel is null or papel in ('admin','gestor','financeiro','corretor')),
  autor_id uuid default auth.uid(),
  expira_em date,
  created_at timestamptz not null default now()
);
create index if not exists equipe_avisos_data_idx on public.equipe_avisos (organizacao_id, created_at desc);

create table if not exists public.equipe_aviso_leituras (
  aviso_id uuid not null references public.equipe_avisos(id) on delete cascade,
  user_id uuid not null default auth.uid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  lido_em timestamptz not null default now(),
  primary key (aviso_id, user_id)
);

create table if not exists public.equipe_mensagens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  de_id uuid not null default auth.uid(),
  para_id uuid not null,
  texto text not null check (length(btrim(texto)) between 1 and 4000),
  lida_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists equipe_mensagens_para_idx on public.equipe_mensagens (para_id, lida_em, created_at desc);
create index if not exists equipe_mensagens_de_idx on public.equipe_mensagens (de_id, created_at desc);

/** Avisos: publicar exige Equipe → criar; mudar/apagar, o autor ou Equipe → editar. */
create or replace function privado.equipe_avisos_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; else v_org := new.organizacao_id; end if;
  if privado.chamada_da_api() then
    if tg_op = 'INSERT' then
      if not privado.org_imobiliaria(v_org) then raise exception 'A gestão de equipe só existe no modo imobiliária.'; end if;
      perform privado.exigir_permissao(v_org, 'equipe', 'criar');
      new.autor_id := auth.uid();
    elsif auth.uid() is distinct from old.autor_id then
      perform privado.exigir_permissao(v_org, 'equipe', 'editar');
    end if;
    if tg_op = 'UPDATE' and new.autor_id is distinct from old.autor_id then raise exception 'Não é possível mudar o autor do aviso.'; end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  -- Só confere o público em quem grava pela API: quando a equipe/filial é
  -- excluída, o banco zera equipe_id/filial_id (FK "set null") e o aviso fica
  -- sem público (ninguém mais o recebe), sem travar a exclusão.
  if privado.chamada_da_api()
     and (tg_op = 'INSERT' or new.para is distinct from old.para or new.equipe_id is distinct from old.equipe_id
          or new.filial_id is distinct from old.filial_id or new.papel is distinct from old.papel) then
    if new.para = 'equipe' and (new.equipe_id is null or not exists (select 1 from public.equipes e where e.id = new.equipe_id and e.organizacao_id = new.organizacao_id)) then
      raise exception 'Escolha a equipe do aviso.';
    end if;
    if new.para = 'filial' and (new.filial_id is null or not exists (select 1 from public.filiais f where f.id = new.filial_id and f.organizacao_id = new.organizacao_id)) then
      raise exception 'Escolha a filial do aviso.';
    end if;
    if new.para = 'papel' and new.papel is null then raise exception 'Escolha o papel do aviso.'; end if;
  end if;
  return new;
end;
$$;
create or replace trigger equipe_avisos_guarda_trg before insert or update or delete on public.equipe_avisos
  for each row execute function privado.equipe_avisos_guarda();

/** Mensagens: só para colega da mesma imobiliária, limite contra abuso e só "lida" muda (por quem recebeu). */
create or replace function privado.equipe_mensagens_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not privado.chamada_da_api() then return new; end if;
  if tg_op = 'INSERT' then
    if not privado.org_imobiliaria(new.organizacao_id) then raise exception 'A gestão de equipe só existe no modo imobiliária.'; end if;
    new.de_id := auth.uid();
    new.lida_em := null;
    new.texto := btrim(new.texto);
    if new.para_id = new.de_id then raise exception 'Escolha um colega para mandar a mensagem.'; end if;
    if not exists (select 1 from public.membros where organizacao_id = new.organizacao_id and user_id = new.para_id) then
      raise exception 'Este colega não faz parte da imobiliária.';
    end if;
    if (select count(*) from public.equipe_mensagens where de_id = auth.uid() and created_at > now() - interval '1 hour') >= 300 then
      raise exception 'Muitas mensagens em pouco tempo. Espere um pouco.';
    end if;
    return new;
  end if;
  if new.texto is distinct from old.texto or new.de_id is distinct from old.de_id or new.para_id is distinct from old.para_id
     or new.organizacao_id is distinct from old.organizacao_id or new.created_at is distinct from old.created_at then
    raise exception 'A mensagem enviada não muda.';
  end if;
  return new;
end;
$$;
create or replace trigger equipe_mensagens_guarda_trg before insert or update on public.equipe_mensagens
  for each row execute function privado.equipe_mensagens_guarda();

-- -----------------------------------------------------------------------------
-- 10. Onboarding
-- -----------------------------------------------------------------------------
create table if not exists public.equipe_onboarding_modelos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  descricao text,
  papel text check (papel is null or papel in ('admin','gestor','financeiro','corretor')),
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.equipe_onboarding_modelo_itens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  modelo_id uuid not null references public.equipe_onboarding_modelos(id) on delete cascade,
  ordem int not null default 0,
  titulo text not null,
  descricao text,
  responsavel text not null default 'gestor' check (responsavel in ('colaborador','gestor','rh','ti')),
  prazo_dias int not null default 7 check (prazo_dias between 0 and 365)
);
create index if not exists equipe_onb_modelo_itens_idx on public.equipe_onboarding_modelo_itens (modelo_id, ordem);

create table if not exists public.equipe_onboardings (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  modelo_id uuid references public.equipe_onboarding_modelos(id) on delete set null,
  titulo text not null,
  inicio date not null default current_date,
  status text not null default 'em_andamento' check (status in ('em_andamento','concluido','cancelado')),
  responsavel_id uuid,
  concluido_em timestamptz,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists equipe_onboardings_pessoa_idx on public.equipe_onboardings (pessoa_id);

create table if not exists public.equipe_onboarding_itens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  onboarding_id uuid not null references public.equipe_onboardings(id) on delete cascade,
  ordem int not null default 0,
  titulo text not null,
  descricao text,
  responsavel text not null default 'gestor' check (responsavel in ('colaborador','gestor','rh','ti')),
  prazo date,
  concluido_em timestamptz,
  concluido_por uuid,
  observacao text
);
create index if not exists equipe_onboarding_itens_idx on public.equipe_onboarding_itens (onboarding_id, ordem);

/** Itens: quem tem Equipe → editar, ou o próprio colaborador marca os dele. */
create or replace function privado.equipe_onboarding_itens_guarda()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_onb uuid;
  v_dono boolean;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; v_onb := old.onboarding_id; else v_org := new.organizacao_id; v_onb := new.onboarding_id; end if;
  if privado.chamada_da_api() then
    v_dono := exists (select 1 from public.equipe_onboardings o join public.membros m on m.organizacao_id = o.organizacao_id and m.pessoa_id = o.pessoa_id
                       where o.id = v_onb and m.user_id = auth.uid());
    if tg_op = 'UPDATE' and v_dono
       and new.titulo is not distinct from old.titulo and new.descricao is not distinct from old.descricao
       and new.responsavel is not distinct from old.responsavel and new.prazo is not distinct from old.prazo
       and new.ordem is not distinct from old.ordem and new.onboarding_id = old.onboarding_id then
      null; -- o colaborador marca/desmarca e anota os itens dele
    else
      perform privado.exigir_permissao(v_org, 'equipe', 'editar');
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if new.concluido_em is not null and (tg_op = 'INSERT' or old.concluido_em is null) then
    new.concluido_por := coalesce(auth.uid(), new.concluido_por);
  elsif new.concluido_em is null then
    new.concluido_por := null;
  end if;
  return new;
end;
$$;
create or replace trigger equipe_onboarding_itens_guarda_trg before insert or update or delete on public.equipe_onboarding_itens
  for each row execute function privado.equipe_onboarding_itens_guarda();

/** Todos os itens feitos → onboarding concluído (e volta a "em andamento" se reabrir um item). */
create or replace function privado.equipe_onboarding_situacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_onb uuid;
  v_total int;
  v_feitos int;
begin
  if tg_op = 'DELETE' then v_onb := old.onboarding_id; else v_onb := new.onboarding_id; end if;
  select count(*), count(concluido_em) into v_total, v_feitos from public.equipe_onboarding_itens where onboarding_id = v_onb;
  update public.equipe_onboardings set
    status = case when v_total > 0 and v_feitos = v_total then 'concluido' else 'em_andamento' end,
    concluido_em = case when v_total > 0 and v_feitos = v_total then coalesce(concluido_em, now()) else null end
   where id = v_onb and status <> 'cancelado'
     and status is distinct from (case when v_total > 0 and v_feitos = v_total then 'concluido' else 'em_andamento' end);
  return null;
end;
$$;
create or replace trigger equipe_onboarding_situacao_trg after insert or update of concluido_em or delete on public.equipe_onboarding_itens
  for each row execute function privado.equipe_onboarding_situacao();

/** Começa o onboarding de um colaborador a partir de um modelo (copia os itens com os prazos). */
create or replace function public.iniciar_onboarding(p_pessoa uuid, p_modelo uuid, p_inicio date, p_responsavel uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_id uuid;
  v_titulo text;
  v_inicio date := coalesce(p_inicio, (now() at time zone 'America/Sao_Paulo')::date);
begin
  if not exists (select 1 from public.pessoas where id = p_pessoa and organizacao_id = v_org) then
    raise exception 'Colaborador não encontrado.';
  end if;
  if p_modelo is not null then
    select nome into v_titulo from public.equipe_onboarding_modelos where id = p_modelo and organizacao_id = v_org;
    if v_titulo is null then raise exception 'Modelo não encontrado.'; end if;
  end if;
  insert into public.equipe_onboardings (organizacao_id, pessoa_id, modelo_id, titulo, inicio, responsavel_id)
  values (v_org, p_pessoa, p_modelo, coalesce(v_titulo, 'Integração'), v_inicio, p_responsavel)
  returning id into v_id;
  if p_modelo is not null then
    insert into public.equipe_onboarding_itens (organizacao_id, onboarding_id, ordem, titulo, descricao, responsavel, prazo)
    select v_org, v_id, i.ordem, i.titulo, i.descricao, i.responsavel, v_inicio + i.prazo_dias
      from public.equipe_onboarding_modelo_itens i
     where i.modelo_id = p_modelo
     order by i.ordem;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.iniciar_onboarding(uuid, uuid, date, uuid) from public, anon;
grant execute on function public.iniciar_onboarding(uuid, uuid, date, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Produtividade e desempenho (agregado no banco)
-- -----------------------------------------------------------------------------
/**
 * Números de cada colaborador (corretores, colaboradores e usuários com ficha)
 * no período [p_inicio, p_fim] (datas de Brasília). O agrupamento por equipe ou
 * filial é a soma das linhas (src/lib/dominio/equipe.ts).
 */
create or replace function public.equipe_produtividade(p_inicio date, p_fim date)
returns table (
  pessoa_id uuid, nome text, user_id uuid, equipe_id uuid, filial_id uuid,
  leads_recebidos int, leads_atendidos int, resposta_soma_min numeric, resposta_qtd int,
  visitas int, propostas int, propostas_aceitas int, locacoes int, vendas int, valor_vendas numeric,
  captacoes int, tarefas int, chamados int)
language sql
stable
security invoker
set search_path = public
as $$
  with org as (select privado.org_atual() as id),
  janela as (
    select (p_inicio::timestamp at time zone 'America/Sao_Paulo') as t0,
           ((p_fim + 1)::timestamp at time zone 'America/Sao_Paulo') as t1
  ),
  colab as (
    select p.id, p.nome, m.user_id, em.equipe_id, coalesce(p.filial_id, e.filial_id) as filial_id
      from public.pessoas p
      left join public.membros m on m.organizacao_id = p.organizacao_id and m.pessoa_id = p.id
      left join public.equipe_membros em on em.pessoa_id = p.id
      left join public.equipes e on e.id = em.equipe_id
     where p.organizacao_id = (select id from org)
       and ('corretor' = any (p.papeis) or p.colaborador or m.user_id is not null)
  )
  select c.id, c.nome, c.user_id, c.equipe_id, c.filial_id,
    (select count(*) from public.leads l, janela j
      where l.corretor_id = c.id and coalesce(l.atribuido_em, l.created_at) >= j.t0 and coalesce(l.atribuido_em, l.created_at) < j.t1)::int,
    (select count(*) from public.leads l, janela j
      where l.corretor_id = c.id and l.atendido_em >= j.t0 and l.atendido_em < j.t1)::int,
    (select coalesce(sum(greatest(0, extract(epoch from (l.atendido_em - coalesce(l.atribuido_em, l.created_at))) / 60)), 0)
       from public.leads l, janela j
      where l.corretor_id = c.id and l.atendido_em >= j.t0 and l.atendido_em < j.t1)::numeric(14,1),
    (select count(*) from public.leads l, janela j
      where l.corretor_id = c.id and l.atendido_em >= j.t0 and l.atendido_em < j.t1)::int,
    (select count(*) from public.visitas v, janela j
      where v.corretor_id = c.id and v.status = 'realizada' and coalesce(v.tipo, 'visita') = 'visita'
        and v.data_hora >= j.t0 and v.data_hora < j.t1)::int,
    (select count(*) from public.propostas pr, janela j
      where pr.corretor_id = c.id and pr.created_at >= j.t0 and pr.created_at < j.t1)::int,
    (select count(*) from public.propostas pr
      where pr.corretor_id = c.id and pr.status = 'aceita' and pr.fechada_em between p_inicio and p_fim)::int,
    (select count(*) from public.propostas pr
      where pr.corretor_id = c.id and pr.status = 'aceita' and pr.tipo = 'locacao' and pr.fechada_em between p_inicio and p_fim)::int,
    (select count(*) from public.vendas vd
      where vd.corretor_id = c.id and vd.status = 'concluida' and vd.concluida_em between p_inicio and p_fim)::int,
    (select coalesce(sum(vd.valor), 0) from public.vendas vd
      where vd.corretor_id = c.id and vd.status = 'concluida' and vd.concluida_em between p_inicio and p_fim)::numeric(14,2),
    (select count(*) from public.captacoes cp
      where cp.corretor_id = c.id and cp.status = 'captado' and cp.captado_em between p_inicio and p_fim)::int,
    (case when c.user_id is null then 0 else
      (select count(*) from public.tarefas t, janela j
        where t.responsavel_id = c.user_id and t.concluida and t.concluida_em >= j.t0 and t.concluida_em < j.t1)
      + (select count(*) from public.equipe_tarefas t, janela j
        where t.responsavel_id = c.user_id and t.status = 'concluida' and t.concluida_em >= j.t0 and t.concluida_em < j.t1) end)::int,
    (case when c.user_id is null then 0 else
      (select count(distinct ce.chamado_id) from public.chamado_eventos ce, janela j
        where ce.usuario_id = c.user_id and ce.tipo = 'status' and ce.descricao like '%→ Concluído%'
          and ce.data >= j.t0 and ce.data < j.t1) end)::int
  from colab c
  order by c.nome
$$;
revoke execute on function public.equipe_produtividade(date, date) from public, anon;
grant execute on function public.equipe_produtividade(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 12. Trilha de auditoria (histórico de ações dos usuários)
-- -----------------------------------------------------------------------------
-- Sem FK para a organização de propósito: o registro sobrevive à exclusão (a
-- etapa de compliance reaproveita esta trilha). Só leitura pela API; quem grava
-- é o gatilho privado.auditar().
create table if not exists public.auditoria (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null,
  usuario_id uuid,
  tabela text not null,
  registro_id text,
  acao text not null check (acao in ('insert','update','delete')),
  campos text[] not null default '{}',
  antes jsonb,
  depois jsonb,
  data timestamptz not null default now()
);
create index if not exists auditoria_data_idx on public.auditoria (organizacao_id, data desc);
create index if not exists auditoria_registro_idx on public.auditoria (organizacao_id, tabela, registro_id);
create index if not exists auditoria_usuario_idx on public.auditoria (organizacao_id, usuario_id, data desc);

/**
 * Gatilho genérico: grava quem fez o quê (insert/update/delete) e, na
 * alteração, só os campos que mudaram (antes → depois). Não guarda tokens nem
 * campos de controle; organização apagada (exclusão em cascata) não gera linha.
 */
create or replace function privado.auditar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old jsonb;
  v_new jsonb;
  v_org uuid;
  v_id text;
  v_campos text[];
  v_antes jsonb;
  v_depois jsonb;
  v_ignorar text[] := array['updated_at', 'atualizado_em'];
begin
  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_org := coalesce(v_new ->> 'organizacao_id', v_old ->> 'organizacao_id',
                    case when tg_table_name = 'organizacoes' then coalesce(v_new ->> 'id', v_old ->> 'id') end)::uuid;
  if v_org is null then return null; end if;
  if tg_op = 'DELETE' and not exists (select 1 from public.organizacoes where id = v_org) then return null; end if;
  v_id := coalesce(v_new ->> 'id', v_old ->> 'id', v_new ->> 'user_id', v_old ->> 'user_id', v_new ->> 'aviso_id');

  if tg_op = 'UPDATE' then
    select array_agg(k order by k), jsonb_object_agg(k, v_old -> k), jsonb_object_agg(k, v_new -> k)
      into v_campos, v_antes, v_depois
      from jsonb_object_keys(v_new) k
     where k <> all (v_ignorar) and k !~* '(token|senha|segredo|secret)'
       and (v_old -> k) is distinct from (v_new -> k);
    if v_campos is null then return null; end if;
  elsif tg_op = 'INSERT' then
    select jsonb_object_agg(k, v_new -> k) into v_depois
      from jsonb_object_keys(v_new) k where k <> all (v_ignorar) and k !~* '(token|senha|segredo|secret)';
  else
    select jsonb_object_agg(k, v_old -> k) into v_antes
      from jsonb_object_keys(v_old) k where k <> all (v_ignorar) and k !~* '(token|senha|segredo|secret)';
  end if;

  insert into public.auditoria (organizacao_id, usuario_id, tabela, registro_id, acao, campos, antes, depois)
  values (v_org, auth.uid(), tg_table_name, v_id, lower(tg_op), coalesce(v_campos, '{}'), v_antes, v_depois);
  return null;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['imoveis','contratos','pessoas','faturas','lancamentos','repasses','membros','organizacoes',
                           'perfis_acesso','filiais','equipes','equipe_membros','equipe_convites','equipe_documentos',
                           'equipe_metas','equipe_distribuicao_regras','equipe_tarefas','equipe_avisos',
                           'equipe_onboardings','equipe_onboarding_modelos','aprovacoes','aprovacao_regras'] loop
    if to_regclass('public.' || t) is not null then
      execute format('create or replace trigger %I after insert or update or delete on public.%I
        for each row execute function privado.auditar()', t || '_auditoria_trg', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 13. RLS
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['filiais','perfis_acesso','equipe_metas','equipe_distribuicao_regras',
                           'equipe_tarefas','aprovacao_regras','aprovacoes','equipe_avisos','equipe_onboarding_modelos',
                           'equipe_onboarding_modelo_itens','equipe_onboardings','equipe_onboarding_itens'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_org') then
      execute format($p$create policy %I on public.%I for all to authenticated
        using (organizacao_id in (select privado.org_ids()))
        with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
    end if;
  end loop;
end $$;

-- Guardas por permissão nas tabelas de configuração da equipe.
create or replace trigger filiais_guarda_trg before insert or update or delete on public.filiais
  for each row execute function privado.equipe_guarda('equipe', 'editar');
create or replace trigger equipe_metas_guarda_trg before insert or update or delete on public.equipe_metas
  for each row execute function privado.equipe_guarda('equipe', 'editar');
create or replace trigger equipe_distribuicao_regras_guarda_trg before insert or update or delete on public.equipe_distribuicao_regras
  for each row execute function privado.equipe_guarda('equipe', 'editar');
create or replace trigger aprovacao_regras_guarda_trg before insert or update or delete on public.aprovacao_regras
  for each row execute function privado.equipe_guarda('aprovacoes', 'editar');
create or replace trigger equipe_onboarding_modelos_guarda_trg before insert or update or delete on public.equipe_onboarding_modelos
  for each row execute function privado.equipe_guarda('equipe', 'editar');
create or replace trigger equipe_onboarding_modelo_itens_guarda_trg before insert or update or delete on public.equipe_onboarding_modelo_itens
  for each row execute function privado.equipe_guarda('equipe', 'editar');
create or replace trigger equipe_onboardings_guarda_trg before insert or update or delete on public.equipe_onboardings
  for each row execute function privado.equipe_guarda('equipe', 'editar');

-- Documentos profissionais (dados pessoais): o próprio colaborador ou quem
-- tem Equipe → editar (privado.equipe_doc_permitido); gravar também passa
-- pelo gatilho privado.equipe_documentos_guarda.
alter table public.equipe_documentos enable row level security;
create index if not exists equipe_documentos_org_idx on public.equipe_documentos (organizacao_id);
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_documentos' and policyname = 'equipe_documentos_ler') then
    create policy equipe_documentos_ler on public.equipe_documentos for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.equipe_doc_permitido(organizacao_id, pessoa_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_documentos' and policyname = 'equipe_documentos_gravar') then
    create policy equipe_documentos_gravar on public.equipe_documentos for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and privado.equipe_doc_permitido(organizacao_id, pessoa_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_documentos' and policyname = 'equipe_documentos_mudar') then
    create policy equipe_documentos_mudar on public.equipe_documentos for update to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.equipe_doc_permitido(organizacao_id, pessoa_id))
      with check (organizacao_id in (select privado.org_ids()) and privado.equipe_doc_permitido(organizacao_id, pessoa_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_documentos' and policyname = 'equipe_documentos_apagar') then
    create policy equipe_documentos_apagar on public.equipe_documentos for delete to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.equipe_doc_permitido(organizacao_id, pessoa_id));
  end if;
end $$;

-- Convites: só quem convida vê (o token dá acesso).
alter table public.equipe_convites enable row level security;
create index if not exists equipe_convites_org_idx on public.equipe_convites (organizacao_id);
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_convites' and policyname = 'equipe_convites_org') then
    create policy equipe_convites_org on public.equipe_convites for all to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.tem_permissao(organizacao_id, 'equipe', 'criar'))
      with check (organizacao_id in (select privado.org_ids()) and privado.tem_permissao(organizacao_id, 'equipe', 'criar'));
  end if;
end $$;

-- Históricos só leitura (quem grava é o banco).
alter table public.equipe_distribuicoes enable row level security;
create index if not exists equipe_distribuicoes_org_idx on public.equipe_distribuicoes (organizacao_id);
alter table public.auditoria enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_distribuicoes' and policyname = 'equipe_distribuicoes_ler') then
    create policy equipe_distribuicoes_ler on public.equipe_distribuicoes for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'auditoria' and policyname = 'auditoria_ler') then
    create policy auditoria_ler on public.auditoria for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.tem_permissao(organizacao_id, 'auditoria', 'ver'));
  end if;
end $$;

-- Comentários de tarefa: todos leem; cada um escreve e apaga os seus.
alter table public.equipe_tarefa_comentarios enable row level security;
create index if not exists equipe_tarefa_comentarios_org_idx on public.equipe_tarefa_comentarios (organizacao_id);
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_tarefa_comentarios' and policyname = 'equipe_tarefa_comentarios_ler') then
    create policy equipe_tarefa_comentarios_ler on public.equipe_tarefa_comentarios for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_tarefa_comentarios' and policyname = 'equipe_tarefa_comentarios_gravar') then
    create policy equipe_tarefa_comentarios_gravar on public.equipe_tarefa_comentarios for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and usuario_id = (select auth.uid())
                  and exists (select 1 from public.equipe_tarefas t where t.id = tarefa_id and t.organizacao_id = equipe_tarefa_comentarios.organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_tarefa_comentarios' and policyname = 'equipe_tarefa_comentarios_apagar') then
    create policy equipe_tarefa_comentarios_apagar on public.equipe_tarefa_comentarios for delete to authenticated
      using (organizacao_id in (select privado.org_ids()) and usuario_id = (select auth.uid()));
  end if;
end $$;

-- Leitura de aviso: cada um marca a sua; todos veem quem já leu.
alter table public.equipe_aviso_leituras enable row level security;
create index if not exists equipe_aviso_leituras_org_idx on public.equipe_aviso_leituras (organizacao_id);
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_aviso_leituras' and policyname = 'equipe_aviso_leituras_ler') then
    create policy equipe_aviso_leituras_ler on public.equipe_aviso_leituras for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_aviso_leituras' and policyname = 'equipe_aviso_leituras_gravar') then
    create policy equipe_aviso_leituras_gravar on public.equipe_aviso_leituras for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and user_id = (select auth.uid())
                  and exists (select 1 from public.equipe_avisos a where a.id = aviso_id and a.organizacao_id = equipe_aviso_leituras.organizacao_id));
  end if;
end $$;

-- Mensagens: só quem mandou e quem recebeu enxergam.
alter table public.equipe_mensagens enable row level security;
create index if not exists equipe_mensagens_org_idx on public.equipe_mensagens (organizacao_id);
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_mensagens' and policyname = 'equipe_mensagens_ler') then
    create policy equipe_mensagens_ler on public.equipe_mensagens for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and (de_id = (select auth.uid()) or para_id = (select auth.uid())));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_mensagens' and policyname = 'equipe_mensagens_enviar') then
    create policy equipe_mensagens_enviar on public.equipe_mensagens for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and de_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_mensagens' and policyname = 'equipe_mensagens_ler_marcar') then
    create policy equipe_mensagens_ler_marcar on public.equipe_mensagens for update to authenticated
      using (organizacao_id in (select privado.org_ids()) and para_id = (select auth.uid()))
      with check (organizacao_id in (select privado.org_ids()) and para_id = (select auth.uid()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'equipe_mensagens' and policyname = 'equipe_mensagens_apagar') then
    create policy equipe_mensagens_apagar on public.equipe_mensagens for delete to authenticated
      using (organizacao_id in (select privado.org_ids()) and de_id = (select auth.uid()));
  end if;
end $$;

-- =============================================================================
-- 14. Juntar cadastros repetidos (Pessoas): ficha do usuário, CRECI, filial,
-- documentos, metas, onboarding, carteira de clientes e histórico de
-- redistribuição vão para o cadastro que fica. public.juntar_pessoas é recriada
-- A PARTIR DO CORPO QUE ESTÁ NO BANCO (mesmo padrão da manutenção).
-- =============================================================================
create or replace function privado.equipe_juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizacao_id into v_org from public.pessoas where id = p_manter;
  if v_org is null or (auth.uid() is not null and v_org not in (select privado.org_ids()))
     or not exists (select 1 from public.pessoas where id = p_remover and organizacao_id = v_org) then
    raise exception 'Cadastro não encontrado.';
  end if;

  if exists (select 1 from public.membros where organizacao_id = v_org and pessoa_id = p_manter) then
    update public.membros set pessoa_id = null where organizacao_id = v_org and pessoa_id = p_remover;
  else
    update public.membros set pessoa_id = p_manter where organizacao_id = v_org and pessoa_id = p_remover;
  end if;

  update public.pessoas a set
    colaborador = a.colaborador or b.colaborador,
    cargo = coalesce(a.cargo, b.cargo),
    admissao = coalesce(a.admissao, b.admissao),
    desligamento = case when a.desligamento is null or b.desligamento is null then null else greatest(a.desligamento, b.desligamento) end,
    creci_numero = coalesce(a.creci_numero, b.creci_numero),
    creci_uf = case when a.creci_numero is null then b.creci_uf else a.creci_uf end,
    creci_validade = case when a.creci_numero is null then b.creci_validade else a.creci_validade end,
    creci_tipo = coalesce(a.creci_tipo, b.creci_tipo),
    filial_id = coalesce(a.filial_id, b.filial_id),
    corretor_id = coalesce(a.corretor_id, nullif(b.corretor_id, p_manter))
  from public.pessoas b
  where a.id = p_manter and b.id = p_remover;
  update public.pessoas set corretor_id = p_manter where organizacao_id = v_org and corretor_id = p_remover;
  update public.pessoas set corretor_id = null where id = p_manter and corretor_id = p_manter;

  update public.leads set corretor_id = p_manter where organizacao_id = v_org and corretor_id = p_remover;
  update public.captacoes set corretor_id = p_manter where organizacao_id = v_org and corretor_id = p_remover;
  update public.filiais set gestor_id = p_manter where organizacao_id = v_org and gestor_id = p_remover;
  update public.equipe_documentos set pessoa_id = p_manter where organizacao_id = v_org and pessoa_id = p_remover;
  delete from public.equipe_metas m
   where m.organizacao_id = v_org and m.pessoa_id = p_remover
     and exists (select 1 from public.equipe_metas x where x.pessoa_id = p_manter and x.competencia = m.competencia and x.tipo = m.tipo);
  update public.equipe_metas set pessoa_id = p_manter where organizacao_id = v_org and pessoa_id = p_remover;
  update public.equipe_convites set pessoa_id = p_manter where organizacao_id = v_org and pessoa_id = p_remover;
  update public.equipe_tarefas set pessoa_id = p_manter where organizacao_id = v_org and pessoa_id = p_remover;
  update public.equipe_onboardings set pessoa_id = p_manter where organizacao_id = v_org and pessoa_id = p_remover;
  update public.equipe_distribuicoes set de_pessoa_id = p_manter where organizacao_id = v_org and de_pessoa_id = p_remover;
  update public.equipe_distribuicoes set para_pessoa_id = p_manter where organizacao_id = v_org and para_pessoa_id = p_remover;
end;
$$;
revoke execute on function privado.equipe_juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function privado.equipe_juntar_pessoas(uuid, uuid) to authenticated;

do $$
declare
  v_def text;
  v_novo text;
begin
  if to_regprocedure('public.juntar_pessoas(uuid, uuid)') is null then
    raise warning 'public.juntar_pessoas não existe: a equipe não entra no "juntar repetidos".';
    return;
  end if;
  v_def := pg_get_functiondef('public.juntar_pessoas(uuid, uuid)'::regprocedure);
  if v_def ilike '%privado.equipe_juntar_pessoas%' then
    return;
  end if;
  v_novo := regexp_replace(v_def,
    '(\n[ \t]*)(delete[ \t]+from[ \t]+public\.pessoas[ \t]+where[ \t]+id[ \t]*=[ \t]*b\.id[ \t]*;)',
    '\1perform privado.equipe_juntar_pessoas(a.id, b.id);\1\2', 'i');
  if v_novo = v_def then
    raise warning 'Não achei o "delete from public.pessoas where id = b.id;" em public.juntar_pessoas: inclua à mão a chamada a privado.equipe_juntar_pessoas(a.id, b.id).';
    return;
  end if;
  execute v_novo;
end $$;
