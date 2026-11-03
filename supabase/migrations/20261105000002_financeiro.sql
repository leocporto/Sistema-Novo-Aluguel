-- =============================================================================
-- Gestão financeira (nos dois modos; valores de terceiros e saldo por
-- proprietário só fazem sentido na imobiliária): contas bancárias e caixa,
-- plano de contas, centros de custo, transferências, extrato e conciliação,
-- baixas com juros/desconto, estornos e cancelamentos, aprovação de pagamentos,
-- adiantamentos, orçamento, notas fiscais de serviço e histórico de alterações.
-- =============================================================================

create table if not exists public.contas_financeiras (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  tipo text not null default 'corrente' check (tipo in ('corrente','poupanca','caixa','carteira','investimento','pagamento')),
  banco text,
  agencia text,
  conta text,
  pix_chave text,
  saldo_inicial numeric(14,2) not null default 0,
  saldo_inicial_em date not null default current_date,
  terceiros boolean not null default false,
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.plano_contas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  codigo text not null,
  nome text not null,
  tipo text not null check (tipo in ('receita','despesa')),
  grupo_dre text not null default 'outros'
    check (grupo_dre in ('receita_operacional','deducoes','custos','despesas_operacionais','receita_financeira','despesa_financeira','impostos','outros','nao_dre')),
  ativo boolean not null default true,
  unique (organizacao_id, codigo)
);

create table if not exists public.centros_custo (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  ativo boolean not null default true
);

alter table public.lancamentos
  add column if not exists conta_id uuid references public.contas_financeiras(id) on delete set null,
  add column if not exists plano_id uuid references public.plano_contas(id) on delete set null,
  add column if not exists centro_custo_id uuid references public.centros_custo(id) on delete set null,
  add column if not exists forma text,
  add column if not exists documento_numero text,
  add column if not exists parcela int,
  add column if not exists parcelas int,
  add column if not exists valor_pago numeric(14,2),
  add column if not exists juros numeric(14,2) not null default 0,
  add column if not exists desconto numeric(14,2) not null default 0,
  add column if not exists conciliado_em timestamptz,
  add column if not exists terceiros boolean not null default false,
  add column if not exists adiantamento boolean not null default false,
  add column if not exists compensado_em date,
  add column if not exists requer_aprovacao boolean not null default false,
  add column if not exists aprovado_em timestamptz,
  add column if not exists aprovado_por uuid,
  add column if not exists cancelado_motivo text,
  add column if not exists observacoes text;
create index if not exists lancamentos_conta_idx on public.lancamentos (conta_id, liquidado_em);
create index if not exists lancamentos_plano_idx on public.lancamentos (plano_id);

alter table public.organizacoes add column if not exists aprovacao_pagamento_acima numeric(14,2);

create table if not exists public.transferencias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  origem_id uuid not null references public.contas_financeiras(id) on delete cascade,
  destino_id uuid not null references public.contas_financeiras(id) on delete cascade,
  valor numeric(14,2) not null check (valor > 0),
  data date not null default current_date,
  descricao text,
  created_at timestamptz not null default now(),
  check (origem_id <> destino_id)
);

-- Extrato bancário importado (OFX/CSV) para conciliação
create table if not exists public.extrato_itens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  conta_id uuid not null references public.contas_financeiras(id) on delete cascade,
  data date not null,
  descricao text not null,
  valor numeric(14,2) not null,
  documento text,
  fitid text not null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  transferencia_id uuid references public.transferencias(id) on delete set null,
  ignorado boolean not null default false,
  importado_em timestamptz not null default now(),
  unique (conta_id, fitid)
);
create index if not exists extrato_itens_conta_idx on public.extrato_itens (conta_id, data);

create table if not exists public.orcamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  competencia date not null check (extract(day from competencia) = 1),
  plano_id uuid not null references public.plano_contas(id) on delete cascade,
  valor numeric(14,2) not null check (valor >= 0),
  unique (organizacao_id, competencia, plano_id)
);

create table if not exists public.notas_fiscais (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  numero text,
  serie text,
  competencia date not null default date_trunc('month', current_date)::date,
  emitida_em date,
  tomador_id uuid references public.pessoas(id) on delete set null,
  tomador_nome text not null,
  tomador_documento text,
  descricao text not null,
  valor_servicos numeric(14,2) not null check (valor_servicos >= 0),
  aliquota_iss numeric(6,3) not null default 0,
  valor_iss numeric(14,2) not null default 0,
  retencoes numeric(14,2) not null default 0,
  status text not null default 'a_emitir' check (status in ('a_emitir','emitida','cancelada')),
  codigo_verificacao text,
  link text,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  contrato_id uuid references public.contratos(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Histórico de alterações financeiras (gravado só pelo banco).
create table if not exists public.lancamento_historico (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes(id) on delete cascade,
  lancamento_id uuid not null,
  acao text not null,
  antes jsonb,
  depois jsonb,
  usuario_id uuid,
  data timestamptz not null default now()
);
create index if not exists lancamento_historico_idx on public.lancamento_historico (organizacao_id, data desc);
create index if not exists lancamento_historico_lanc_idx on public.lancamento_historico (lancamento_id);

create or replace function privado.registrar_historico_lancamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acao text;
  campos text[] := array['descricao','categoria','valor','vencimento','status','liquidado_em','valor_pago','juros','desconto','conta_id','plano_id','aprovado_em','cancelado_motivo','pessoa_id'];
  a jsonb;
  b jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.lancamento_historico (organizacao_id, lancamento_id, acao, depois, usuario_id)
    values (new.organizacao_id, new.id, 'criado', jsonb_build_object('descricao', new.descricao, 'valor', new.valor, 'vencimento', new.vencimento, 'status', new.status), auth.uid());
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.lancamento_historico (organizacao_id, lancamento_id, acao, antes, usuario_id)
    values (old.organizacao_id, old.id, 'excluido', jsonb_build_object('descricao', old.descricao, 'valor', old.valor, 'vencimento', old.vencimento, 'status', old.status), auth.uid());
    return old;
  end if;
  select jsonb_object_agg(k, to_jsonb(old) -> k), jsonb_object_agg(k, to_jsonb(new) -> k) into a, b
    from unnest(campos) k where (to_jsonb(old) -> k) is distinct from (to_jsonb(new) -> k);
  if a is null then return new; end if;
  v_acao := case
    when old.status <> 'liquidado' and new.status = 'liquidado' then 'liquidado'
    when old.status = 'liquidado' and new.status = 'aberto' then 'estornado'
    when new.status = 'cancelado' and old.status <> 'cancelado' then 'cancelado'
    when old.aprovado_em is null and new.aprovado_em is not null then 'aprovado'
    else 'alterado' end;
  insert into public.lancamento_historico (organizacao_id, lancamento_id, acao, antes, depois, usuario_id)
  values (new.organizacao_id, new.id, v_acao, a, b, auth.uid());
  return new;
end;
$$;
drop trigger if exists lancamentos_historico_trg on public.lancamentos;
create trigger lancamentos_historico_trg after insert or update or delete on public.lancamentos
  for each row execute function privado.registrar_historico_lancamento();

do $$
declare t text;
begin
  foreach t in array array['contas_financeiras','plano_contas','centros_custo','transferencias','extrato_itens','orcamentos','notas_fiscais'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (organizacao_id in (select privado.org_ids()))
      with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
  end loop;
end $$;
alter table public.lancamento_historico enable row level security;
drop policy if exists lancamento_historico_ler on public.lancamento_historico;
create policy lancamento_historico_ler on public.lancamento_historico for select to authenticated
  using (organizacao_id in (select privado.org_ids()));
