-- =============================================================================
-- Imposto do proprietário descontado no repasse
-- - pessoas.imposto_pct: % do cadastro (em branco = padrão da imobiliária)
-- - organizacoes.imposto_pf_pct / imposto_pj_pct: padrões por tipo de pessoa
-- - repasses.imposto / imposto_pct: valor descontado e % usado
-- =============================================================================

alter table public.pessoas
  add column if not exists imposto_pct numeric(6,3) check (imposto_pct is null or (imposto_pct >= 0 and imposto_pct <= 100));

alter table public.organizacoes
  add column if not exists imposto_pf_pct numeric(6,3) not null default 0 check (imposto_pf_pct >= 0 and imposto_pf_pct <= 100),
  add column if not exists imposto_pj_pct numeric(6,3) not null default 0 check (imposto_pj_pct >= 0 and imposto_pj_pct <= 100);

alter table public.repasses
  add column if not exists imposto numeric(14,2) not null default 0,
  add column if not exists imposto_pct numeric(6,3) not null default 0;

-- Funções de gravação passam a receber imposto/imposto_pct de cada repasse.
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

  insert into public.repasses (organizacao_id, contrato_id, fatura_id, pessoa_id, competencia, percentual,
    aluguel, encargos, multa_juros, valor_bruto, taxa_administracao, taxa_intermediacao, irrf,
    imposto, imposto_pct, valor_liquido, previsto_para)
  select v_org, (p->>'contrato_id')::uuid, v_id, (r->>'pessoa_id')::uuid, (p->>'competencia')::date,
    (r->>'percentual')::numeric, (r->>'aluguel')::numeric, (r->>'encargos')::numeric,
    (r->>'multa_juros')::numeric, (r->>'valor_bruto')::numeric, (r->>'taxa_administracao')::numeric,
    (r->>'taxa_intermediacao')::numeric, (r->>'irrf')::numeric,
    coalesce((r->>'imposto')::numeric, 0), coalesce((r->>'imposto_pct')::numeric, 0),
    (r->>'valor_liquido')::numeric, (r->>'previsto_para')::date
  from jsonb_array_elements(coalesce(p->'repasses', '[]'::jsonb)) as r;

  return v_id;
end;
$$;

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

  if not exists (select 1 from public.repasses where fatura_id = f.id and status <> 'cancelado') then
    insert into public.repasses (organizacao_id, contrato_id, fatura_id, pessoa_id, competencia, percentual,
      aluguel, encargos, multa_juros, valor_bruto, taxa_administracao, taxa_intermediacao, irrf,
      imposto, imposto_pct, valor_liquido, previsto_para)
    select f.organizacao_id, f.contrato_id, f.id, (r->>'pessoa_id')::uuid, f.competencia,
      (r->>'percentual')::numeric, (r->>'aluguel')::numeric, (r->>'encargos')::numeric,
      (r->>'multa_juros')::numeric, (r->>'valor_bruto')::numeric, (r->>'taxa_administracao')::numeric,
      (r->>'taxa_intermediacao')::numeric, (r->>'irrf')::numeric,
      coalesce((r->>'imposto')::numeric, 0), coalesce((r->>'imposto_pct')::numeric, 0),
      (r->>'valor_liquido')::numeric, (r->>'previsto_para')::date
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
