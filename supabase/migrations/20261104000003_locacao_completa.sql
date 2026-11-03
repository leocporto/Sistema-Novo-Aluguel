-- =============================================================================
-- Gestão de locações completa (nos dois modos): carência de aluguel, descontos
-- temporários e de pontualidade, ativação, renovação e aditivos, garantias
-- locatícias, desocupação com acerto de saída e devolução de caução.
-- =============================================================================

alter table public.contratos
  add column if not exists carencia_meses int not null default 0,
  add column if not exists carencia_desconto_pct numeric(6,3) not null default 100,
  add column if not exists desconto_pontualidade_pct numeric(6,3) not null default 0,
  add column if not exists renovacao_automatica boolean not null default false,
  add column if not exists aviso_fim_dias int not null default 60,
  add column if not exists ativado_em timestamptz;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'contratos_carencia_check') then
    alter table public.contratos add constraint contratos_carencia_check check (
      carencia_meses between 0 and 60 and carencia_desconto_pct between 0 and 100
      and desconto_pontualidade_pct between 0 and 100 and aviso_fim_dias between 0 and 365);
  end if;
end $$;
update public.contratos set ativado_em = created_at where ativado_em is null and status <> 'rascunho';

-- Motivo dos descontos lançados no repasse (despesa do imóvel paga pela imobiliária)
alter table public.repasses add column if not exists observacoes text;

-- Descontos temporários (negociação, obra no imóvel…) por competência
create table if not exists public.contrato_descontos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  inicio date not null check (extract(day from inicio) = 1),
  fim date check (fim is null or extract(day from fim) = 1),
  tipo text not null default 'valor' check (tipo in ('valor','pct')),
  valor numeric(14,2) not null check (valor > 0),
  motivo text,
  created_at timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);

-- Aditivos (renovação, valor, prazo, partes, garantia…)
create table if not exists public.contrato_aditivos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  numero int not null default 1,
  tipo text not null default 'outro' check (tipo in ('renovacao','valor','prazo','partes','garantia','outro')),
  descricao text not null,
  data date not null default current_date,
  valor_anterior numeric(14,2),
  valor_novo numeric(14,2) check (valor_novo is null or valor_novo >= 0),
  data_fim_anterior date,
  data_fim_nova date,
  aplicado_em timestamptz,
  created_at timestamptz not null default now()
);

-- Garantias locatícias
create table if not exists public.contrato_garantias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid not null references public.contratos(id) on delete cascade,
  tipo text not null check (tipo in ('fiador','caucao','seguro_fianca','titulo_capitalizacao','carta_fianca','outro')),
  pessoa_id uuid references public.pessoas(id) on delete set null,
  instituicao text,
  numero text,
  valor numeric(14,2),
  inicio date,
  fim date,
  conta text,
  status text not null default 'ativa' check (status in ('ativa','vencida','devolvida','executada','encerrada')),
  devolvida_em date,
  valor_devolvido numeric(14,2),
  observacoes text,
  created_at timestamptz not null default now()
);

-- Garantias que estavam só no contrato viram registros (uma vez).
insert into public.contrato_garantias (organizacao_id, contrato_id, tipo, valor, observacoes, status)
select c.organizacao_id, c.id, c.garantia_tipo, c.garantia_valor, c.garantia_detalhes,
       case when c.status in ('encerrado','rescindido') then 'encerrada' else 'ativa' end
  from public.contratos c
 where c.garantia_tipo not in ('sem_garantia','fiador')
   and not exists (select 1 from public.contrato_garantias g where g.contrato_id = c.id);
insert into public.contrato_garantias (organizacao_id, contrato_id, tipo, pessoa_id, status)
select p.organizacao_id, p.contrato_id, 'fiador', p.pessoa_id,
       case when c.status in ('encerrado','rescindido') then 'encerrada' else 'ativa' end
  from public.contrato_partes p join public.contratos c on c.id = p.contrato_id
 where p.papel = 'fiador'
   and not exists (select 1 from public.contrato_garantias g where g.contrato_id = p.contrato_id and g.pessoa_id = p.pessoa_id);

-- Desocupação (aviso → vistoria → acerto → concluída)
create table if not exists public.contrato_desocupacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid not null unique references public.contratos(id) on delete cascade,
  status text not null default 'aviso' check (status in ('aviso','vistoria','acerto','concluida')),
  motivo text not null default 'rescisao_locatario'
    check (motivo in ('fim_prazo','rescisao_locatario','rescisao_locador','acordo','despejo')),
  aviso_em date not null default current_date,
  entrega_prevista date,
  entrega_em date,
  pago_ate date,
  vistoria_data date,
  vistoria_resultado text check (vistoria_resultado is null or vistoria_resultado in ('ok','com_reparos')),
  vistoria_obs text,
  chaves_devolvidas_em date,
  isentar_multa boolean not null default false,
  aviso_previo_cumprido boolean not null default true,
  reparos numeric(14,2) not null default 0 check (reparos >= 0),
  outros_debitos numeric(14,2) not null default 0 check (outros_debitos >= 0),
  caucao_devolver numeric(14,2) not null default 0 check (caucao_devolver >= 0),
  acerto jsonb,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  concluida_em timestamptz,
  created_at timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['contrato_descontos','contrato_aditivos','contrato_garantias','contrato_desocupacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('create index if not exists %I on public.%I (contrato_id)', t || '_contrato_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (organizacao_id in (select privado.org_ids()))
      with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
  end loop;
end $$;

/** Aplica o aditivo: novo valor e/ou nova data de fim (recalcula o prazo). */
create or replace function public.aplicar_aditivo(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  a public.contrato_aditivos%rowtype;
  c public.contratos%rowtype;
begin
  select * into a from public.contrato_aditivos where id = p_id for update;
  if not found then raise exception 'Aditivo não encontrado.'; end if;
  if a.aplicado_em is not null then raise exception 'Este aditivo já foi aplicado.'; end if;
  select * into c from public.contratos where id = a.contrato_id for update;
  if a.data_fim_nova is not null and a.data_fim_nova <= c.data_inicio then
    raise exception 'A nova data de fim precisa ser depois do início do contrato.';
  end if;

  update public.contrato_aditivos
     set aplicado_em = now(),
         valor_anterior = coalesce(valor_anterior, case when a.valor_novo is not null then c.valor_aluguel end),
         data_fim_anterior = coalesce(data_fim_anterior, case when a.data_fim_nova is not null then c.data_fim end)
   where id = a.id;

  update public.contratos
     set valor_aluguel = coalesce(a.valor_novo, valor_aluguel),
         data_fim = coalesce(a.data_fim_nova, data_fim),
         prazo_meses = case when a.data_fim_nova is null then prazo_meses
                            else greatest(1, (extract(year from age(a.data_fim_nova + 1, data_inicio)) * 12
                                              + extract(month from age(a.data_fim_nova + 1, data_inicio)))::int) end,
         status = case when a.tipo = 'renovacao' and status = 'encerrado' and data_rescisao is null then 'ativo' else status end
   where id = c.id;

  if a.valor_novo is not null and a.valor_novo <> c.valor_aluguel then
    insert into public.contrato_reajustes (organizacao_id, contrato_id, data_reajuste, indice, percentual, valor_anterior, valor_novo)
    values (c.organizacao_id, c.id, a.data, 'ADITIVO',
            case when c.valor_aluguel > 0 then round((a.valor_novo / c.valor_aluguel - 1) * 100, 4) else 0 end,
            c.valor_aluguel, a.valor_novo);
  end if;
end;
$$;
revoke execute on function public.aplicar_aditivo(uuid) from public, anon;
grant execute on function public.aplicar_aditivo(uuid) to authenticated;

/**
 * Conclui a desocupação: encerra o contrato, cancela as faturas abertas de
 * períodos depois do "pago até" (o saldo vai no acerto), lança o acerto
 * (a receber do locatário ou a devolver), encerra/devolve as garantias e
 * libera o imóvel se não houver outro contrato ativo.
 * p: { total, descricao, pago_ate, entrega, encerrar_como, itens[] }
 */
create or replace function public.concluir_desocupacao(p_id uuid, p jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  d public.contrato_desocupacoes%rowtype;
  c public.contratos%rowtype;
  v_total numeric(14,2) := coalesce((p->>'total')::numeric, 0);
  v_entrega date := (p->>'entrega')::date;
  v_pago_ate date := coalesce((p->>'pago_ate')::date, v_entrega);
  v_como text := coalesce(p->>'encerrar_como', 'rescindido');
  v_loc uuid;
  v_lanc uuid;
begin
  select * into d from public.contrato_desocupacoes where id = p_id for update;
  if not found then raise exception 'Desocupação não encontrada.'; end if;
  if d.status = 'concluida' then raise exception 'Esta desocupação já foi concluída.'; end if;
  if v_entrega is null then raise exception 'Informe a data de entrega das chaves.'; end if;
  if v_como not in ('encerrado','rescindido') then v_como := 'rescindido'; end if;
  select * into c from public.contratos where id = d.contrato_id for update;

  update public.contratos set status = v_como, data_rescisao = v_entrega where id = c.id;

  update public.faturas set status = 'cancelada',
         observacoes = coalesce(observacoes || ' · ', '') || 'Cancelada na desocupação (cobrada no acerto)'
   where contrato_id = c.id and status = 'aberta' and coalesce(periodo_inicio, competencia) > v_pago_ate;

  select pessoa_id into v_loc from public.contrato_partes where contrato_id = c.id and papel = 'locatario' limit 1;
  if v_total > 0 then
    insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status, pessoa_id, contrato_id, imovel_id)
    values (c.organizacao_id, 'receber', coalesce(p->>'descricao', 'Acerto de saída — contrato #' || c.numero), 'Acerto de saída',
            v_total, v_entrega + 5, 'aberto', v_loc, c.id, c.imovel_id)
    returning id into v_lanc;
  elsif v_total < 0 then
    insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status, pessoa_id, contrato_id, imovel_id)
    values (c.organizacao_id, 'pagar', 'Devolução ao locatário (caução/saldo) — contrato #' || c.numero, 'Devolução de caução',
            -v_total, v_entrega + 5, 'aberto', v_loc, c.id, c.imovel_id)
    returning id into v_lanc;
  end if;

  update public.contrato_garantias
     set status = case when tipo = 'caucao' then 'devolvida' else 'encerrada' end,
         devolvida_em = case when tipo = 'caucao' then v_entrega else devolvida_em end,
         valor_devolvido = case when tipo = 'caucao' then d.caucao_devolver else valor_devolvido end
   where contrato_id = c.id and status in ('ativa','vencida');

  update public.imoveis set status = 'disponivel'
   where id = c.imovel_id and status in ('alugado','reservado')
     and not exists (select 1 from public.contratos o where o.imovel_id = c.imovel_id and o.status = 'ativo' and o.id <> c.id);

  update public.contrato_desocupacoes
     set status = 'concluida', concluida_em = now(), entrega_em = v_entrega, pago_ate = v_pago_ate,
         acerto = p, lancamento_id = v_lanc
   where id = d.id;
end;
$$;
revoke execute on function public.concluir_desocupacao(uuid, jsonb) from public, anon;
grant execute on function public.concluir_desocupacao(uuid, jsonb) to authenticated;
