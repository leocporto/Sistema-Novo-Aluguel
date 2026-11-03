-- =============================================================================
-- Comercial (leads → visitas → propostas, tarefas, metas), comissões,
-- despesas (escritório / imóveis) e preferências do Painel por usuário.
-- =============================================================================

-- Imóveis: data de captação e de venda --------------------------------------
alter table public.imoveis add column if not exists captado_em date;
update public.imoveis set captado_em = created_at::date where captado_em is null;
alter table public.imoveis alter column captado_em set default current_date;
alter table public.imoveis alter column captado_em set not null;
alter table public.imoveis add column if not exists vendido_em date;

-- Leads ----------------------------------------------------------------------
create table if not exists public.leads (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  telefone text,
  email text,
  origem text not null default 'outro'
    check (origem in ('site','whatsapp','indicacao','portal','placa','telefone','instagram','outro')),
  interesse text not null default 'locacao' check (interesse in ('locacao','compra')),
  imovel_id uuid references public.imoveis(id) on delete set null,
  status text not null default 'novo'
    check (status in ('novo','em_atendimento','visita','proposta','ganho','perdido')),
  observacoes text,
  atendido_em timestamptz,
  created_at timestamptz not null default now()
);

-- Visitas --------------------------------------------------------------------
create table if not exists public.visitas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  imovel_id uuid references public.imoveis(id) on delete set null,
  corretor_id uuid references public.pessoas(id) on delete set null,
  data_hora timestamptz not null,
  status text not null default 'agendada' check (status in ('agendada','realizada','cancelada')),
  observacoes text,
  created_at timestamptz not null default now()
);

-- Propostas ------------------------------------------------------------------
create table if not exists public.propostas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete set null,
  imovel_id uuid references public.imoveis(id) on delete set null,
  tipo text not null default 'locacao' check (tipo in ('venda','locacao')),
  valor numeric(14,2) not null check (valor > 0),
  corretor_id uuid references public.pessoas(id) on delete set null,
  comissao_pct numeric(6,3),
  status text not null default 'em_negociacao'
    check (status in ('em_negociacao','aceita','recusada','cancelada')),
  fechada_em date,
  observacoes text,
  created_at timestamptz not null default now()
);

-- Tarefas --------------------------------------------------------------------
create table if not exists public.tarefas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  titulo text not null,
  vencimento date,
  prioridade text not null default 'normal' check (prioridade in ('alta','normal')),
  concluida boolean not null default false,
  concluida_em timestamptz,
  responsavel_id uuid default auth.uid(),
  lead_id uuid references public.leads(id) on delete set null,
  imovel_id uuid references public.imoveis(id) on delete set null,
  contrato_id uuid references public.contratos(id) on delete set null,
  created_at timestamptz not null default now()
);

-- Metas ----------------------------------------------------------------------
create table if not exists public.metas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  competencia date not null,
  tipo text not null check (tipo in ('locacoes','vendas','captacoes','leads','faturamento')),
  valor numeric(14,2) not null check (valor >= 0),
  unique (organizacao_id, competencia, tipo)
);

-- RLS por organização nas tabelas novas ------------------------------------
do $$
declare t text;
begin
  foreach t in array array['leads','visitas','propostas','tarefas','metas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (organizacao_id in (select privado.org_ids()))
      with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
  end loop;
end $$;

create index if not exists leads_status_idx on public.leads (organizacao_id, status);
create index if not exists visitas_data_idx on public.visitas (organizacao_id, data_hora);
create index if not exists propostas_status_idx on public.propostas (organizacao_id, status);

-- Preferências do Painel (por usuário e organização) -----------------------
create table if not exists public.painel_preferencias (
  user_id uuid not null default auth.uid(),
  organizacao_id uuid not null references public.organizacoes(id) on delete cascade,
  widgets jsonb not null default '{}'::jsonb,
  atualizado_em timestamptz not null default now(),
  primary key (user_id, organizacao_id)
);
alter table public.painel_preferencias enable row level security;
drop policy if exists painel_preferencias_dono on public.painel_preferencias;
create policy painel_preferencias_dono on public.painel_preferencias for all to authenticated
  using (user_id = (select auth.uid()) and organizacao_id in (select privado.org_ids()))
  with check (user_id = (select auth.uid()) and organizacao_id in (select privado.org_ids()));

-- Despesas e comissões usam a tabela de lançamentos -------------------------
alter table public.lancamentos add column if not exists imovel_id uuid references public.imoveis(id) on delete set null;
alter table public.lancamentos add column if not exists proposta_id uuid references public.propostas(id) on delete set null;
alter table public.lancamentos add column if not exists comprovante_path text;
alter table public.lancamentos add column if not exists serie_id uuid;
create index if not exists lancamentos_serie_idx on public.lancamentos (serie_id);
create index if not exists lancamentos_imovel_idx on public.lancamentos (imovel_id);

-- Aceitar proposta: fecha o negócio, marca o imóvel e gera a comissão ------
create or replace function public.aceitar_proposta(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  p public.propostas%rowtype;
  v_codigo text;
  v_comissao numeric(14,2);
begin
  select * into p from public.propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada.'; end if;
  if p.status <> 'em_negociacao' then raise exception 'Esta proposta não está mais em negociação.'; end if;

  update public.propostas set status = 'aceita', fechada_em = current_date where id = p.id;

  if p.lead_id is not null then
    update public.leads set status = 'ganho' where id = p.lead_id;
  end if;

  if p.imovel_id is not null then
    if p.tipo = 'venda' then
      update public.imoveis set status = 'vendido', vendido_em = current_date where id = p.imovel_id;
    else
      update public.imoveis set status = 'reservado' where id = p.imovel_id and status = 'disponivel';
    end if;
    select codigo into v_codigo from public.imoveis where id = p.imovel_id;
  end if;

  if p.corretor_id is not null and coalesce(p.comissao_pct, 0) > 0 then
    v_comissao := round(p.valor * p.comissao_pct / 100, 2);
    insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status, pessoa_id, imovel_id, proposta_id)
    values (
      p.organizacao_id, 'pagar',
      'Comissão ' || case when p.tipo = 'venda' then 'de venda' else 'de locação' end
        || coalesce(' — ' || v_codigo, ''),
      'Comissões', v_comissao, current_date + 30, 'aberto', p.corretor_id, p.imovel_id, p.id
    );
  end if;
end;
$$;

revoke execute on function public.aceitar_proposta(uuid) from public, anon;
grant execute on function public.aceitar_proposta(uuid) to authenticated;
