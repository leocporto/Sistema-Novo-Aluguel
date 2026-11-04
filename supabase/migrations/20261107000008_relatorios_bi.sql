-- =============================================================================
-- Relatórios e Business Intelligence (nos dois modos).
--
-- - Indicadores agregados NO BANCO por funções public.bi_* (security invoker:
--   o RLS da organização vale; exigem Relatórios → ver). As regras de taxa,
--   média, variação e previsão que dependem só dos números ficam em
--   src/lib/dominio/bi.ts.
--   Indicadores da imobiliária (receita de administração e intermediação,
--   repasses, leads/canais/funil, corretores, filiais, maior procura) só no
--   modo imobiliária; no papel "corretor", leads/visitas/propostas e o
--   desempenho mostram só o que é dele (privado.bi_escopo_corretor).
-- - Relatórios personalizados (relatorios_salvos): fonte, colunas, filtros,
--   agrupamento, totais e ordenação escolhidos de listas FECHADAS
--   (privado.bi_fontes ≡ FONTES_BI em src/lib/dominio/bi.ts — mude os dois
--   juntos); public.bi_executar monta a consulta só com nomes da lista
--   (format %I/%L), nunca com SQL vindo do usuário. Cada fonte é de um módulo
--   (lançamentos → Financeiro, leads → Comercial…): sem "ver" nesse módulo no
--   perfil de acesso, o relatório não roda, não é salvo nem aparece.
-- - Despesas da imobiliária = só as do escritório (sem as de terceiros e sem
--   as descontadas no repasse, que são do proprietário e entram na
--   rentabilidade do imóvel).
-- - Envio programado: relatorio_agendamentos (frequência, dia, hora de SP,
--   formato, destinatários) + relatorio_execucoes (só leitura/acréscimo,
--   gravadas só pela RPC relatorio_registrar_execucao, logo depois da "vez").
--   Os vencidos são "pegos" por public.relatorio_agendamentos_vez (atômico) e
--   gerados pelo app em segundo plano (after()), com o arquivo no bucket
--   privado "relatorios" (<org>/<agendamento>/...), guardado por 90 dias
--   (privado.bi_dias_guarda) e depois apagado; quem programa envios pode
--   apagar antes.
-- - Quem cria/edita personalizados: admin/gestor ou quem tem Configurações →
--   editar. Agendamentos: os mesmos, menos o papel corretor (o arquivo sai com
--   os dados da imobiliária inteira).
--
-- Sem DROP: create ... if not exists, create or replace, policies em DO.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Quem pode o quê
-- -----------------------------------------------------------------------------

/** Organização do usuário logado, exigindo Relatórios → ver. */
create or replace function privado.bi_org()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
begin
  if v_org is null or auth.uid() is null then
    raise exception 'Sem acesso.';
  end if;
  if not privado.tem_permissao(v_org, 'relatorios', 'ver') then
    raise exception 'Seu perfil de acesso não permite ver Relatórios. Fale com o administrador.';
  end if;
  return v_org;
end;
$$;
revoke execute on function privado.bi_org() from public, anon;
grant execute on function privado.bi_org() to authenticated;

/** Mesma coisa, só no modo imobiliária. */
create or replace function privado.bi_org_imobiliaria()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.bi_org();
begin
  if not privado.org_imobiliaria(v_org) then
    raise exception 'Este relatório só existe no modo imobiliária.';
  end if;
  return v_org;
end;
$$;
revoke execute on function privado.bi_org_imobiliaria() from public, anon;
grant execute on function privado.bi_org_imobiliaria() to authenticated;

/**
 * Corretor vê só o que é dele: devolve o cadastro (Pessoas) ligado ao usuário
 * (ou um id que não casa com nada, se não houver vínculo). null = sem filtro.
 */
create or replace function privado.bi_escopo_corretor(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select case when privado.papel_atual(p_org) = 'corretor'
              then coalesce(privado.minha_pessoa(p_org), '00000000-0000-0000-0000-000000000000'::uuid) end
$$;
revoke execute on function privado.bi_escopo_corretor(uuid) from public, anon;
grant execute on function privado.bi_escopo_corretor(uuid) to authenticated;

/** Cria/edita relatórios personalizados: admin, gestor ou Configurações → editar (e Relatórios → ver). */
create or replace function privado.bi_pode_editar(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org in (select privado.org_ids())
     and privado.tem_permissao(p_org, 'relatorios', 'ver')
     and (coalesce(privado.papel_atual(p_org), '') in ('admin', 'gestor')
          or privado.tem_permissao(p_org, 'configuracoes', 'editar'))
$$;
revoke execute on function privado.bi_pode_editar(uuid) from public, anon;
grant execute on function privado.bi_pode_editar(uuid) to authenticated;

/** Programa envios: quem edita personalizados, menos o papel corretor. */
create or replace function privado.bi_pode_agendar(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.bi_pode_editar(p_org) and coalesce(privado.papel_atual(p_org), 'corretor') <> 'corretor'
$$;
revoke execute on function privado.bi_pode_agendar(uuid) from public, anon;
grant execute on function privado.bi_pode_agendar(uuid) to authenticated;

/** Vê os envios e arquivos gerados e roda os agendamentos: Relatórios → ver, menos o papel corretor. */
create or replace function privado.bi_pode_rodar(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_org in (select privado.org_ids())
     and privado.tem_permissao(p_org, 'relatorios', 'ver')
     and coalesce(privado.papel_atual(p_org), 'corretor') <> 'corretor'
$$;
revoke execute on function privado.bi_pode_rodar(uuid) from public, anon;
grant execute on function privado.bi_pode_rodar(uuid) to authenticated;

/** O que o usuário logado pode fazer nos relatórios (para a tela). */
create or replace function public.bi_minhas_permissoes()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select case when privado.org_atual() is null then '{}'::jsonb else jsonb_build_object(
    'ver', privado.tem_permissao(privado.org_atual(), 'relatorios', 'ver'),
    'editar', privado.bi_pode_editar(privado.org_atual()),
    'agendar', privado.bi_pode_agendar(privado.org_atual()),
    'rodar', privado.bi_pode_rodar(privado.org_atual()),
    'corretor', privado.bi_escopo_corretor(privado.org_atual()) is not null) end
$$;
revoke execute on function public.bi_minhas_permissoes() from public, anon;
grant execute on function public.bi_minhas_permissoes() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Financeiro por mês: faturamento, receitas da imobiliária e inadimplência
-- -----------------------------------------------------------------------------
/**
 * Uma linha por mês do período [p_inicio, p_fim] (meses das pontas cortados no
 * período):
 * - aluguel_recebido: cada recebimento de fatura na data dele (inclui parciais)
 *   + faturas pagas antes dos recebimentos separados existirem;
 * - faturado: faturas por competência (menos as canceladas);
 * - outras_receitas / despesas: lançamentos liquidados no período (sem os de
 *   aluguel e de comissão de venda, que têm coluna própria; na imobiliária, só
 *   os do escritório: sem os "de terceiros" e sem os descontados no repasse,
 *   que o proprietário paga e entram na rentabilidade do imóvel);
 * - taxa_administracao / taxa_intermediacao (imobiliária): retidas nos repasses
 *   (data do pagamento da fatura; sem fatura, a competência);
 * - comissao_vendas (imobiliária): comissão da imobiliária nas vendas concluídas;
 * - repasses_pagos (imobiliária): líquido pago aos proprietários;
 * - venc_*: faturas que venceram no período (até ontem): valor, saldo em aberto
 *   e saldo em acordo hoje; comp_*: o mesmo pela competência.
 */
create or replace function public.bi_financeiro_mensal(p_inicio date, p_fim date)
returns table (
  mes date, aluguel_recebido numeric, faturado numeric, outras_receitas numeric, despesas numeric,
  taxa_administracao numeric, taxa_intermediacao numeric, comissao_vendas numeric, repasses_pagos numeric,
  venc_valor numeric, venc_aberto numeric, venc_acordo numeric,
  comp_valor numeric, comp_aberto numeric, comp_acordo numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org();
  v_imob boolean := privado.org_imobiliaria(v_org);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'Período inválido.';
  end if;
  if p_fim - p_inicio > 3700 then
    raise exception 'Período longo demais (no máximo 10 anos).';
  end if;
  return query
  with meses as (
    select gs::date as m from generate_series(date_trunc('month', p_inicio), date_trunc('month', p_fim), interval '1 month') gs
  ),
  rec as (
    select date_trunc('month', x.d)::date as m, sum(x.v) as v
      from (
        select fp.pago_em as d, fp.valor as v
          from public.fatura_pagamentos fp
         where fp.organizacao_id = v_org and fp.pago_em between p_inicio and p_fim
        union all
        select f.pago_em, coalesce(f.valor_pago, f.valor_total)
          from public.faturas f
         where f.organizacao_id = v_org and f.status = 'paga' and f.pago_em between p_inicio and p_fim
           and not exists (select 1 from public.fatura_pagamentos fp where fp.fatura_id = f.id)
      ) x
     group by 1
  ),
  fat as (
    select date_trunc('month', f.competencia)::date as m, sum(f.valor_total) as v
      from public.faturas f
     where f.organizacao_id = v_org and f.status <> 'cancelada'
       and f.competencia between date_trunc('month', p_inicio)::date and p_fim
     group by 1
  ),
  lanc as (
    select date_trunc('month', l.liquidado_em)::date as m,
           sum(coalesce(l.valor_pago, l.valor)) filter (
             where l.tipo = 'receber' and l.fatura_id is null and l.fatura_pagamento_id is null and l.venda_id is null) as rec,
           sum(coalesce(l.valor_pago, l.valor)) filter (where l.tipo = 'pagar') as pag
      from public.lancamentos l
     where l.organizacao_id = v_org and l.status = 'liquidado' and l.liquidado_em between p_inicio and p_fim
       -- Na imobiliária, só o que é do escritório: os de terceiros e os descontados
       -- no repasse são do proprietário (entram na rentabilidade do imóvel).
       and (not v_imob or (not l.terceiros and not l.descontar_repasse))
     group by 1
  ),
  taxas as (
    select date_trunc('month', coalesce(f.pago_em, r.competencia))::date as m,
           sum(r.taxa_administracao) as adm, sum(r.taxa_intermediacao) as intm
      from public.repasses r
      left join public.faturas f on f.id = r.fatura_id
     where v_imob and r.organizacao_id = v_org and r.status <> 'cancelado'
       and coalesce(f.pago_em, r.competencia) between p_inicio and p_fim
     group by 1
  ),
  vend as (
    select date_trunc('month', v.concluida_em)::date as m,
           sum(coalesce(v.comissao_valor, round(v.valor * v.comissao_pct / 100, 2))) as com
      from public.vendas v
     where v_imob and v.organizacao_id = v_org and v.status = 'concluida' and v.concluida_em between p_inicio and p_fim
     group by 1
  ),
  rep as (
    select date_trunc('month', r.pago_em)::date as m, sum(r.valor_liquido) as v
      from public.repasses r
     where v_imob and r.organizacao_id = v_org and r.status = 'pago' and r.pago_em between p_inicio and p_fim
     group by 1
  ),
  venc as (
    select date_trunc('month', f.vencimento)::date as m,
           sum(f.valor_total) as v,
           sum(greatest(f.valor_total - f.valor_abatido, 0)) filter (where f.status = 'aberta') as ab,
           sum(greatest(f.valor_total - f.valor_abatido, 0)) filter (where f.status = 'renegociada') as ac
      from public.faturas f
     where f.organizacao_id = v_org and f.status <> 'cancelada'
       and f.vencimento between p_inicio and least(p_fim, v_hoje - 1)
     group by 1
  ),
  comp as (
    select date_trunc('month', f.competencia)::date as m,
           sum(f.valor_total) as v,
           sum(greatest(f.valor_total - f.valor_abatido, 0)) filter (where f.status = 'aberta') as ab,
           sum(greatest(f.valor_total - f.valor_abatido, 0)) filter (where f.status = 'renegociada') as ac
      from public.faturas f
     where f.organizacao_id = v_org and f.status <> 'cancelada' and f.vencimento < v_hoje
       and f.competencia between date_trunc('month', p_inicio)::date and p_fim
     group by 1
  )
  select ms.m,
         coalesce(rec.v, 0)::numeric(14,2), coalesce(fat.v, 0)::numeric(14,2),
         coalesce(lanc.rec, 0)::numeric(14,2), coalesce(lanc.pag, 0)::numeric(14,2),
         coalesce(taxas.adm, 0)::numeric(14,2), coalesce(taxas.intm, 0)::numeric(14,2),
         coalesce(vend.com, 0)::numeric(14,2), coalesce(rep.v, 0)::numeric(14,2),
         coalesce(venc.v, 0)::numeric(14,2), coalesce(venc.ab, 0)::numeric(14,2), coalesce(venc.ac, 0)::numeric(14,2),
         coalesce(comp.v, 0)::numeric(14,2), coalesce(comp.ab, 0)::numeric(14,2), coalesce(comp.ac, 0)::numeric(14,2)
    from meses ms
    left join rec on rec.m = ms.m
    left join fat on fat.m = ms.m
    left join lanc on lanc.m = ms.m
    left join taxas on taxas.m = ms.m
    left join vend on vend.m = ms.m
    left join rep on rep.m = ms.m
    left join venc on venc.m = ms.m
    left join comp on comp.m = ms.m
   order by ms.m;
end;
$$;
revoke execute on function public.bi_financeiro_mensal(date, date) from public, anon;
grant execute on function public.bi_financeiro_mensal(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Imóveis: ocupação, vacância, tempo para alugar e para vender
-- -----------------------------------------------------------------------------
/**
 * Números dos imóveis de locação (finalidade locação, nem inativos nem
 * vendidos) no período:
 * - ocupação = dias cobertos por contrato (ativo, encerrado ou rescindido) ÷
 *   dias disponíveis (da entrada do imóvel — captação ou 1º contrato — até o
 *   fim do período, nunca depois de hoje);
 * - vacância = dias entre o fim de um contrato e o início do próximo (contratos
 *   emendados não contam), pelos próximos contratos que começaram no período;
 *   imóvel vago hoje conta até hoje (só se o período inclui hoje);
 * - tempo para alugar = da entrada como disponível (fim do contrato anterior ou
 *   captação) até o início do contrato, pelos contratos que começaram no período;
 * - tempo para vender = da captação ou do 1º anúncio até a venda concluída no período.
 */
create or replace function public.bi_ocupacao(p_inicio date, p_fim date)
returns table (
  imoveis int, dias_disponiveis bigint, dias_ocupados bigint, vagos_hoje int, alugados_hoje int,
  vacancia_soma bigint, vacancia_qtd int, vacancia_abertas int,
  alugar_soma bigint, alugar_qtd int, vender_soma bigint, vender_qtd int,
  contratos_ativos int, contratos_novos int, contratos_encerrados int)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'Período inválido.';
  end if;
  return query
  with base as (
    select i.id, i.captado_em
      from public.imoveis i
     where i.organizacao_id = v_org and 'locacao' = any (i.finalidades) and i.status not in ('inativo', 'vendido')
  ),
  ctr as (
    select c.id, c.imovel_id, c.data_inicio,
           case when c.status = 'ativo' then null::date else coalesce(c.data_rescisao, c.data_fim) end as fim
      from public.contratos c
      join base b on b.id = c.imovel_id
     where c.organizacao_id = v_org and c.status in ('ativo', 'encerrado', 'rescindido')
       and (c.status = 'ativo' or coalesce(c.data_rescisao, c.data_fim) >= c.data_inicio)
  ),
  jan as (
    select b.id,
           greatest(p_inicio, least(b.captado_em, coalesce((select min(c.data_inicio) from ctr c where c.imovel_id = b.id), b.captado_em))) as ini,
           least(p_fim, v_hoje) as fim
      from base b
  ),
  faixas as (
    select c.imovel_id, range_agg(daterange(c.data_inicio, coalesce(c.fim, 'infinity'::date), '[]')) as r
      from ctr c
     group by c.imovel_id
  ),
  occ as (
    select j.id,
           (j.fim - j.ini + 1)::bigint as disp,
           coalesce((select sum(upper(x) - lower(x)) from unnest(f.r * datemultirange(daterange(j.ini, j.fim, '[]'))) x), 0)::bigint as ocup
      from jan j
      left join faixas f on f.imovel_id = j.id
     where j.fim >= j.ini
  ),
  hoje as (
    select b.id, exists (select 1 from ctr c where c.imovel_id = b.id and c.data_inicio <= v_hoje and (c.fim is null or c.fim >= v_hoje)) as ocupado
      from base b
  ),
  seq as (
    select c.imovel_id, c.data_inicio, c.fim, b.captado_em,
           lag(c.fim) over w as fim_ant,
           lag(c.data_inicio) over w as ini_ant,
           lead(c.data_inicio) over w as ini_prox
      from ctr c
      join base b on b.id = c.imovel_id
    window w as (partition by c.imovel_id order by c.data_inicio, c.id)
  ),
  vac as (
    -- intervalos fechados: o próximo contrato começou no período
    select (s.data_inicio - s.fim_ant - 1)::bigint as d, false as aberta
      from seq s
     where s.fim_ant is not null and s.data_inicio - s.fim_ant - 1 >= 1 and s.data_inicio between p_inicio and p_fim
    union all
    -- vago hoje depois de um contrato (só se o período inclui hoje)
    select (v_hoje - s.fim)::bigint, true
      from seq s
      join hoje h on h.id = s.imovel_id
     where s.ini_prox is null and s.fim is not null and s.fim < v_hoje and not h.ocupado
       and v_hoje between p_inicio and p_fim
  ),
  alug as (
    select (s.data_inicio - coalesce(s.fim_ant + 1, s.captado_em))::bigint as d
      from seq s
     where s.data_inicio between p_inicio and p_fim
       and ((s.ini_ant is null and s.data_inicio >= s.captado_em)
            or (s.fim_ant is not null and s.data_inicio - s.fim_ant - 1 >= 1))
  ),
  vend as (
    select (v.concluida_em - least(i.captado_em, coalesce((select min(a.inicio) from public.imovel_anuncios a where a.imovel_id = i.id), i.captado_em)))::bigint as d
      from public.vendas v
      join public.imoveis i on i.id = v.imovel_id
     where v.organizacao_id = v_org and v.status = 'concluida' and v.concluida_em between p_inicio and p_fim
    union all
    select (i.vendido_em - least(i.captado_em, coalesce((select min(a.inicio) from public.imovel_anuncios a where a.imovel_id = i.id), i.captado_em)))::bigint
      from public.imoveis i
     where i.organizacao_id = v_org and i.vendido_em between p_inicio and p_fim
       and not exists (select 1 from public.vendas v where v.imovel_id = i.id and v.status = 'concluida')
  ),
  ct as (
    select
      count(*) filter (where c.status = 'ativo' and c.data_inicio <= least(p_fim, v_hoje))::int as ativos,
      count(*) filter (where c.status <> 'rascunho' and c.data_inicio between p_inicio and p_fim)::int as novos,
      count(*) filter (where c.status in ('encerrado', 'rescindido') and coalesce(c.data_rescisao, c.data_fim) between p_inicio and p_fim)::int as encerrados
      from public.contratos c
     where c.organizacao_id = v_org
  )
  select (select count(*) from base)::int,
         coalesce((select sum(o.disp) from occ o), 0)::bigint,
         coalesce((select sum(o.ocup) from occ o), 0)::bigint,
         (select count(*) from hoje h where not h.ocupado)::int,
         (select count(*) from hoje h where h.ocupado)::int,
         coalesce((select sum(v.d) from vac v), 0)::bigint,
         (select count(*) from vac v)::int,
         (select count(*) from vac v where v.aberta)::int,
         coalesce((select sum(a.d) from alug a where a.d >= 0), 0)::bigint,
         (select count(*) from alug a where a.d >= 0)::int,
         coalesce((select sum(v.d) from vend v where v.d >= 0), 0)::bigint,
         (select count(*) from vend v where v.d >= 0)::int,
         ct.ativos, ct.novos, ct.encerrados
    from ct;
end;
$$;
revoke execute on function public.bi_ocupacao(date, date) from public, anon;
grant execute on function public.bi_ocupacao(date, date) to authenticated;

/** Imóveis de locação vagos hoje, do vago há mais tempo para o mais recente. */
create or replace function public.bi_imoveis_vagos(p_limite int default 50)
returns table (
  imovel_id uuid, codigo text, titulo text, bairro text, valor_aluguel numeric,
  vago_desde date, dias int, ja_alugado boolean, proximo_inicio date, total bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  return query
  with base as (
    select i.id, i.codigo, i.titulo, i.bairro, i.valor_aluguel, i.captado_em
      from public.imoveis i
     where i.organizacao_id = v_org and 'locacao' = any (i.finalidades) and i.status not in ('inativo', 'vendido')
  ),
  ctr as (
    select c.imovel_id, c.data_inicio,
           case when c.status = 'ativo' then null::date else coalesce(c.data_rescisao, c.data_fim) end as fim
      from public.contratos c
     where c.organizacao_id = v_org and c.status in ('ativo', 'encerrado', 'rescindido')
  ),
  vagos as (
    select b.*,
           (select max(c.fim) from ctr c where c.imovel_id = b.id and c.fim is not null and c.fim < v_hoje) as ultimo_fim,
           (select min(c.data_inicio) from ctr c where c.imovel_id = b.id and c.data_inicio > v_hoje) as prox
      from base b
     where not exists (select 1 from ctr c where c.imovel_id = b.id and c.data_inicio <= v_hoje and (c.fim is null or c.fim >= v_hoje))
  )
  select v.id, v.codigo, v.titulo, v.bairro, v.valor_aluguel,
         coalesce(v.ultimo_fim + 1, v.captado_em),
         greatest(0, v_hoje - coalesce(v.ultimo_fim + 1, v.captado_em))::int,
         v.ultimo_fim is not null,
         v.prox,
         count(*) over ()
    from vagos v
   order by coalesce(v.ultimo_fim + 1, v.captado_em), v.codigo
   limit least(greatest(coalesce(p_limite, 50), 1), 500);
end;
$$;
revoke execute on function public.bi_imoveis_vagos(int) from public, anon;
grant execute on function public.bi_imoveis_vagos(int) to authenticated;

/**
 * Imóveis com maior procura no período (só imobiliária): leads ligados ao
 * imóvel (lead_imoveis ou imóvel do lead) + visitas (não canceladas) +
 * propostas + contatos pelo site.
 */
create or replace function public.bi_imoveis_procura(p_inicio date, p_fim date, p_limite int default 20)
returns table (
  imovel_id uuid, codigo text, titulo text, status text, leads int, visitas int, propostas int, contatos_site int,
  pontos int, total bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org_imobiliaria();
  t0 timestamptz := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  t1 timestamptz := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  return query
  with ld as (
    select x.imovel_id, count(distinct x.lead_id) as n
      from (
        select li.imovel_id, li.lead_id
          from public.lead_imoveis li
          join public.leads l on l.id = li.lead_id
         where l.organizacao_id = v_org and l.created_at >= t0 and l.created_at < t1
        union
        select l.imovel_id, l.id
          from public.leads l
         where l.organizacao_id = v_org and l.imovel_id is not null and l.created_at >= t0 and l.created_at < t1
      ) x
     group by 1
  ),
  vs as (
    select v.imovel_id, count(*) as n
      from public.visitas v
     where v.organizacao_id = v_org and v.imovel_id is not null and coalesce(v.tipo, 'visita') = 'visita'
       and v.status <> 'cancelada' and v.data_hora >= t0 and v.data_hora < t1
     group by 1
  ),
  pr as (
    select p.imovel_id, count(*) as n
      from public.propostas p
     where p.organizacao_id = v_org and p.imovel_id is not null and p.created_at >= t0 and p.created_at < t1
     group by 1
  ),
  st as (
    select s.imovel_id, count(*) as n
      from public.site_solicitacoes s
     where s.organizacao_id = v_org and s.imovel_id is not null and s.created_at >= t0 and s.created_at < t1
     group by 1
  ),
  tot as (
    select i.id, i.codigo, i.titulo, i.status,
           coalesce(ld.n, 0)::int as l, coalesce(vs.n, 0)::int as v, coalesce(pr.n, 0)::int as p, coalesce(st.n, 0)::int as s
      from public.imoveis i
      left join ld on ld.imovel_id = i.id
      left join vs on vs.imovel_id = i.id
      left join pr on pr.imovel_id = i.id
      left join st on st.imovel_id = i.id
     where i.organizacao_id = v_org
  )
  select t.id, t.codigo, t.titulo, t.status, t.l, t.v, t.p, t.s, (t.l + t.v + t.p + t.s)::int, count(*) over ()
    from tot t
   where t.l + t.v + t.p + t.s > 0
   order by (t.l + t.v + t.p + t.s) desc, t.v desc, t.codigo
   limit least(greatest(coalesce(p_limite, 20), 1), 500);
end;
$$;
revoke execute on function public.bi_imoveis_procura(date, date, int) from public, anon;
grant execute on function public.bi_imoveis_procura(date, date, int) to authenticated;

/** Imóveis disponíveis que não tiveram visita (não cancelada) no período. */
create or replace function public.bi_imoveis_sem_visitas(p_inicio date, p_fim date, p_limite int default 50)
returns table (
  imovel_id uuid, codigo text, titulo text, finalidades text, bairro text, captado_em date, ultima_visita date, total bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org();
  t0 timestamptz := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  t1 timestamptz := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  return query
  select i.id, i.codigo, i.titulo, array_to_string(i.finalidades, ', '), i.bairro, i.captado_em,
         (select (max(v.data_hora) at time zone 'America/Sao_Paulo')::date
            from public.visitas v
           where v.imovel_id = i.id and coalesce(v.tipo, 'visita') = 'visita' and v.status <> 'cancelada'),
         count(*) over ()
    from public.imoveis i
   where i.organizacao_id = v_org and i.status = 'disponivel'
     and not exists (
       select 1 from public.visitas v
        where v.imovel_id = i.id and coalesce(v.tipo, 'visita') = 'visita' and v.status <> 'cancelada'
          and v.data_hora >= t0 and v.data_hora < t1)
   order by i.captado_em, i.codigo
   limit least(greatest(coalesce(p_limite, 50), 1), 500);
end;
$$;
revoke execute on function public.bi_imoveis_sem_visitas(date, date, int) from public, anon;
grant execute on function public.bi_imoveis_sem_visitas(date, date, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Comercial: leads por canal e funil (só imobiliária; corretor vê os dele)
-- -----------------------------------------------------------------------------
/**
 * Leads que chegaram no período, por canal de origem, e até onde foram (o
 * funil é acumulado: quem fechou também conta como proposta e visita):
 * visita = visita realizada ou etapa "visita"; proposta = proposta feita ou
 * etapa "proposta"; fechado = lead ganho, proposta aceita ou venda concluída.
 */
create or replace function public.bi_leads_canais(p_inicio date, p_fim date)
returns table (origem text, leads int, atendidos int, com_visita int, com_proposta int, fechados int, perdidos int)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org_imobiliaria();
  v_esc uuid := privado.bi_escopo_corretor(v_org);
  t0 timestamptz := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  t1 timestamptz := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  return query
  with l as (
    select x.*, (x.fech or x.prop0) as prop, (x.fech or x.prop0 or x.vis0) as vis
      from (
        select ld.id, ld.origem, ld.status, ld.etapa_max, ld.atendido_em,
               (ld.etapa_max >= 2 or exists (select 1 from public.visitas v where v.lead_id = ld.id and v.status = 'realizada')) as vis0,
               (ld.etapa_max >= 3 or exists (select 1 from public.propostas p where p.lead_id = ld.id)) as prop0,
               (ld.status = 'ganho'
                or exists (select 1 from public.propostas p where p.lead_id = ld.id and p.status = 'aceita')
                or exists (select 1 from public.vendas vd where vd.lead_id = ld.id and vd.status = 'concluida')) as fech
          from public.leads ld
         where ld.organizacao_id = v_org and ld.created_at >= t0 and ld.created_at < t1
           and (v_esc is null or ld.corretor_id = v_esc)
      ) x
  )
  select l.origem,
         count(*)::int,
         count(*) filter (where l.atendido_em is not null or l.etapa_max >= 1 or l.vis)::int,
         count(*) filter (where l.vis)::int,
         count(*) filter (where l.prop)::int,
         count(*) filter (where l.fech)::int,
         count(*) filter (where l.status = 'perdido')::int
    from l
   group by l.origem
   order by count(*) desc, l.origem;
end;
$$;
revoke execute on function public.bi_leads_canais(date, date) from public, anon;
grant execute on function public.bi_leads_canais(date, date) to authenticated;

/**
 * Funil do período (só imobiliária): a coorte de leads que chegou (mesmas
 * regras de bi_leads_canais) e a atividade no período (visitas realizadas,
 * propostas feitas e aceitas, contratos de locação que começaram, vendas
 * concluídas). Corretor: só os dele (contratos = propostas de locação aceitas).
 */
create or replace function public.bi_funil(p_inicio date, p_fim date)
returns table (
  leads int, atendidos int, com_visita int, com_proposta int, fechados int, perdidos int,
  visitas_realizadas int, propostas_feitas int, propostas_aceitas int, contratos_locacao int,
  vendas_concluidas int, valor_vendas numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org_imobiliaria();
  v_esc uuid := privado.bi_escopo_corretor(v_org);
  t0 timestamptz := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  t1 timestamptz := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  return query
  with c as (
    select coalesce(sum(x.leads), 0)::int as leads, coalesce(sum(x.atendidos), 0)::int as atendidos,
           coalesce(sum(x.com_visita), 0)::int as com_visita, coalesce(sum(x.com_proposta), 0)::int as com_proposta,
           coalesce(sum(x.fechados), 0)::int as fechados, coalesce(sum(x.perdidos), 0)::int as perdidos
      from public.bi_leads_canais(p_inicio, p_fim) x
  )
  select c.leads, c.atendidos, c.com_visita, c.com_proposta, c.fechados, c.perdidos,
         (select count(*) from public.visitas v
           where v.organizacao_id = v_org and coalesce(v.tipo, 'visita') = 'visita' and v.status = 'realizada'
             and v.data_hora >= t0 and v.data_hora < t1 and (v_esc is null or v.corretor_id = v_esc))::int,
         (select count(*) from public.propostas p
           where p.organizacao_id = v_org and p.created_at >= t0 and p.created_at < t1 and (v_esc is null or p.corretor_id = v_esc))::int,
         (select count(*) from public.propostas p
           where p.organizacao_id = v_org and p.status = 'aceita' and p.fechada_em between p_inicio and p_fim
             and (v_esc is null or p.corretor_id = v_esc))::int,
         (case when v_esc is null then
            (select count(*) from public.contratos ct
              where ct.organizacao_id = v_org and ct.status <> 'rascunho' and ct.data_inicio between p_inicio and p_fim)
          else
            (select count(*) from public.propostas p
              where p.organizacao_id = v_org and p.status = 'aceita' and p.tipo = 'locacao'
                and p.fechada_em between p_inicio and p_fim and p.corretor_id = v_esc) end)::int,
         (select count(*) from public.vendas vd
           where vd.organizacao_id = v_org and vd.status = 'concluida' and vd.concluida_em between p_inicio and p_fim
             and (v_esc is null or vd.corretor_id = v_esc))::int,
         (select coalesce(sum(vd.valor), 0) from public.vendas vd
           where vd.organizacao_id = v_org and vd.status = 'concluida' and vd.concluida_em between p_inicio and p_fim
             and (v_esc is null or vd.corretor_id = v_esc))::numeric(14,2)
    from c;
end;
$$;
revoke execute on function public.bi_funil(date, date) from public, anon;
grant execute on function public.bi_funil(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Equipe: corretores e filiais (só imobiliária)
-- -----------------------------------------------------------------------------
/**
 * Desempenho individual (public.equipe_produtividade da gestão de equipe) +
 * comissões geradas no período. Papel corretor: só a linha dele.
 */
create or replace function public.bi_equipe(p_inicio date, p_fim date)
returns table (
  pessoa_id uuid, nome text, user_id uuid, equipe_id uuid, filial_id uuid,
  leads_recebidos int, leads_atendidos int, resposta_soma_min numeric, resposta_qtd int,
  visitas int, propostas int, propostas_aceitas int, locacoes int, vendas int, valor_vendas numeric,
  captacoes int, tarefas int, chamados int, comissoes numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org_imobiliaria();
  v_esc uuid := privado.bi_escopo_corretor(v_org);
  t0 timestamptz := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  t1 timestamptz := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  return query
  select e.pessoa_id, e.nome, e.user_id, e.equipe_id, e.filial_id,
         e.leads_recebidos, e.leads_atendidos, e.resposta_soma_min, e.resposta_qtd,
         e.visitas, e.propostas, e.propostas_aceitas, e.locacoes, e.vendas, e.valor_vendas,
         e.captacoes, e.tarefas, e.chamados,
         coalesce((select sum(cm.valor) from public.comissoes cm
                    where cm.organizacao_id = v_org and cm.pessoa_id = e.pessoa_id
                      and cm.status not in ('cancelada', 'estornada')
                      and cm.created_at >= t0 and cm.created_at < t1), 0)::numeric(14,2)
    from public.equipe_produtividade(p_inicio, p_fim) e
   where v_esc is null or e.pessoa_id = v_esc;
end;
$$;
revoke execute on function public.bi_equipe(date, date) from public, anon;
grant execute on function public.bi_equipe(date, date) to authenticated;

/**
 * Desempenho por filial (só imobiliária; o corretor não vê): imóveis e
 * contratos ativos hoje, aluguel da carteira, taxas retidas no período (pela
 * filial do contrato), leads, vendas (filial do imóvel ou do corretor).
 */
create or replace function public.bi_filiais(p_inicio date, p_fim date)
returns table (
  filial_id uuid, nome text, imoveis int, contratos_ativos int, carteira_aluguel numeric,
  receita_administracao numeric, receita_intermediacao numeric, leads int, vendas int, valor_vendas numeric, comissao_vendas numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org_imobiliaria();
  t0 timestamptz := p_inicio::timestamp at time zone 'America/Sao_Paulo';
  t1 timestamptz := (p_fim + 1)::timestamp at time zone 'America/Sao_Paulo';
begin
  if privado.bi_escopo_corretor(v_org) is not null then
    return;
  end if;
  return query
  with fil as (
    select f.id, f.nome from public.filiais f where f.organizacao_id = v_org
    union all
    select null::uuid, 'Sem filial'
  ),
  im as (
    select i.filial_id, count(*) as n from public.imoveis i
     where i.organizacao_id = v_org and i.status <> 'inativo' group by 1
  ),
  ct as (
    select c.filial_id, count(*) as n, sum(c.valor_aluguel) as s from public.contratos c
     where c.organizacao_id = v_org and c.status = 'ativo' group by 1
  ),
  tx as (
    select c.filial_id, sum(r.taxa_administracao) as adm, sum(r.taxa_intermediacao) as intm
      from public.repasses r
      join public.contratos c on c.id = r.contrato_id
      left join public.faturas f on f.id = r.fatura_id
     where r.organizacao_id = v_org and r.status <> 'cancelado'
       and coalesce(f.pago_em, r.competencia) between p_inicio and p_fim
     group by 1
  ),
  ld as (
    select l.filial_id, count(*) as n from public.leads l
     where l.organizacao_id = v_org and l.created_at >= t0 and l.created_at < t1 group by 1
  ),
  vd as (
    select coalesce(i.filial_id, p.filial_id) as filial_id, count(*) as n, sum(v.valor) as s,
           sum(coalesce(v.comissao_valor, round(v.valor * v.comissao_pct / 100, 2))) as com
      from public.vendas v
      left join public.imoveis i on i.id = v.imovel_id
      left join public.pessoas p on p.id = v.corretor_id
     where v.organizacao_id = v_org and v.status = 'concluida' and v.concluida_em between p_inicio and p_fim
     group by 1
  )
  select fil.id, fil.nome,
         coalesce(im.n, 0)::int, coalesce(ct.n, 0)::int, coalesce(ct.s, 0)::numeric(14,2),
         coalesce(tx.adm, 0)::numeric(14,2), coalesce(tx.intm, 0)::numeric(14,2),
         coalesce(ld.n, 0)::int, coalesce(vd.n, 0)::int, coalesce(vd.s, 0)::numeric(14,2), coalesce(vd.com, 0)::numeric(14,2)
    from fil
    left join im on im.filial_id is not distinct from fil.id
    left join ct on ct.filial_id is not distinct from fil.id
    left join tx on tx.filial_id is not distinct from fil.id
    left join ld on ld.filial_id is not distinct from fil.id
    left join vd on vd.filial_id is not distinct from fil.id
   where fil.id is not null
      or coalesce(im.n, 0) + coalesce(ct.n, 0) + coalesce(ld.n, 0) + coalesce(vd.n, 0) > 0
      or coalesce(tx.adm, 0) + coalesce(tx.intm, 0) <> 0
   order by fil.id is null, fil.nome;
end;
$$;
revoke execute on function public.bi_filiais(date, date) from public, anon;
grant execute on function public.bi_filiais(date, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Rentabilidade por imóvel ou contrato
-- -----------------------------------------------------------------------------
/**
 * Receitas − taxas − despesas no período, por imóvel (p_por = 'imovel') ou
 * contrato ('contrato'):
 * - receitas: aluguel recebido (cada recebimento na data dele) + outros
 *   lançamentos a receber liquidados ligados ao imóvel/contrato;
 * - taxas (imobiliária): administração + intermediação retidas nos repasses;
 * - despesas: lançamentos a pagar liquidados ligados ao imóvel/contrato
 *   (manutenção, IPTU, condomínio…); na imobiliária só os do proprietário
 *   (descontados do repasse ou de terceiros). Comissões ficam fora.
 * - valor_referencia: valor de venda do imóvel ou a avaliação da captação
 *   (para o rendimento sobre o valor do imóvel).
 * - total: quantas linhas há ao todo (o app pede de 1.000 em 1.000 e avisa
 *   "mostrando X de N" quando o limite corta).
 */
create or replace function public.bi_rentabilidade(p_inicio date, p_fim date, p_por text default 'imovel', p_limite int default 100)
returns table (
  chave uuid, codigo text, descricao text, receitas numeric, taxas numeric, despesas numeric, resultado numeric,
  valor_referencia numeric, total bigint)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org();
  v_imob boolean := privado.org_imobiliaria(v_org);
  v_lim int := least(greatest(coalesce(p_limite, 100), 1), 5000);
begin
  if p_inicio is null or p_fim is null or p_fim < p_inicio then
    raise exception 'Período inválido.';
  end if;
  if coalesce(p_por, '') not in ('imovel', 'contrato') then
    raise exception 'Agrupe por imóvel ou por contrato.';
  end if;
  return query
  with ctr as (
    select c.id, c.imovel_id, c.numero from public.contratos c where c.organizacao_id = v_org
  ),
  rec as (
    select f.contrato_id, sum(x.v) as v
      from (
        select fp.fatura_id, fp.valor as v
          from public.fatura_pagamentos fp
         where fp.organizacao_id = v_org and fp.pago_em between p_inicio and p_fim
        union all
        select f2.id, coalesce(f2.valor_pago, f2.valor_total)
          from public.faturas f2
         where f2.organizacao_id = v_org and f2.status = 'paga' and f2.pago_em between p_inicio and p_fim
           and not exists (select 1 from public.fatura_pagamentos fp where fp.fatura_id = f2.id)
      ) x
      join public.faturas f on f.id = x.fatura_id
     group by f.contrato_id
  ),
  tx as (
    select r.contrato_id, sum(r.taxa_administracao + r.taxa_intermediacao) as v
      from public.repasses r
      left join public.faturas f on f.id = r.fatura_id
     where v_imob and r.organizacao_id = v_org and r.status <> 'cancelado'
       and coalesce(f.pago_em, r.competencia) between p_inicio and p_fim
     group by r.contrato_id
  ),
  lc as (
    select l.tipo, coalesce(l.imovel_id, c.imovel_id) as imovel_id, l.contrato_id, coalesce(l.valor_pago, l.valor) as v
      from public.lancamentos l
      left join ctr c on c.id = l.contrato_id
     where l.organizacao_id = v_org and l.status = 'liquidado' and l.liquidado_em between p_inicio and p_fim
       and l.fatura_id is null and l.fatura_pagamento_id is null and l.venda_id is null and l.proposta_id is null
       and l.comissao_devolucao_id is null
       and not exists (select 1 from public.comissoes cm where cm.lancamento_id = l.id)
       and (not v_imob or l.descontar_repasse or l.terceiros)
       and coalesce(l.imovel_id, c.imovel_id) is not null
  ),
  por_imovel as (
    select i.id as k, i.codigo as cod, coalesce(nullif(i.titulo, ''), concat_ws(', ', i.logradouro, i.numero, i.bairro)) as dsc,
           coalesce(ri.v, 0) + coalesce(li.r, 0) as receitas, coalesce(ti.v, 0) as taxas, coalesce(li.p, 0) as despesas,
           coalesce(i.valor_venda, (select max(cp.valor_avaliado_venda) from public.captacoes cp where cp.imovel_id = i.id)) as vref
      from public.imoveis i
      left join (select c.imovel_id, sum(rec.v) as v from rec join ctr c on c.id = rec.contrato_id group by 1) ri on ri.imovel_id = i.id
      left join (select c.imovel_id, sum(tx.v) as v from tx join ctr c on c.id = tx.contrato_id group by 1) ti on ti.imovel_id = i.id
      left join (select lc.imovel_id, sum(lc.v) filter (where lc.tipo = 'receber') as r, sum(lc.v) filter (where lc.tipo = 'pagar') as p
                   from lc group by 1) li on li.imovel_id = i.id
     where i.organizacao_id = v_org and p_por = 'imovel'
  ),
  por_contrato as (
    select c.id as k, ('#' || c.numero::text || ' · ' || i.codigo) as cod,
           (select string_agg(pe.nome, ', ' order by pe.nome) from public.contrato_partes cp join public.pessoas pe on pe.id = cp.pessoa_id
             where cp.contrato_id = c.id and cp.papel = 'locatario') as dsc,
           coalesce(rec.v, 0) + coalesce(lr.r, 0) as receitas, coalesce(tx.v, 0) as taxas, coalesce(lr.p, 0) as despesas,
           coalesce(i.valor_venda, (select max(cp.valor_avaliado_venda) from public.captacoes cp where cp.imovel_id = i.id)) as vref
      from public.contratos c
      join public.imoveis i on i.id = c.imovel_id
      left join rec on rec.contrato_id = c.id
      left join tx on tx.contrato_id = c.id
      left join (select lc.contrato_id, sum(lc.v) filter (where lc.tipo = 'receber') as r, sum(lc.v) filter (where lc.tipo = 'pagar') as p
                   from lc where lc.contrato_id is not null group by 1) lr on lr.contrato_id = c.id
     where c.organizacao_id = v_org and p_por = 'contrato'
  ),
  tudo as (
    select * from por_imovel
    union all
    select * from por_contrato
  )
  select t.k, t.cod, t.dsc, t.receitas::numeric(14,2), t.taxas::numeric(14,2), t.despesas::numeric(14,2),
         (t.receitas - t.taxas - t.despesas)::numeric(14,2), t.vref::numeric(14,2), count(*) over ()
    from tudo t
   where t.receitas <> 0 or t.taxas <> 0 or t.despesas <> 0
   order by (t.receitas - t.taxas - t.despesas) desc, t.cod, t.k
   limit v_lim;
end;
$$;
revoke execute on function public.bi_rentabilidade(date, date, text, int) from public, anon;
grant execute on function public.bi_rentabilidade(date, date, text, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Previsão de receitas e repasses
-- -----------------------------------------------------------------------------
/**
 * Reajustes pendentes até a competência: aniversários da data-base
 * (data-base + n × periodicidade) que caem até o mês da competência. Mesma
 * conta de reajustesAte() em src/lib/dominio/bi.ts.
 */
create or replace function privado.bi_reajustes_ate(p_data_base date, p_periodicidade int, p_competencia date)
returns int
language sql
immutable
set search_path = ''
as $$
  select case when coalesce(p_periodicidade, 0) <= 0 or p_data_base is null
                   or date_trunc('month', p_competencia) <= date_trunc('month', p_data_base) then 0
              else floor(((extract(year from p_competencia) - extract(year from p_data_base)) * 12
                          + extract(month from p_competencia) - extract(month from p_data_base)) / p_periodicidade)::int end
$$;
grant execute on function privado.bi_reajustes_ate(date, int, date) to authenticated;

/**
 * Próximos p_meses (a partir do mês atual), uma linha por mês, mais a linha
 * "atrasado" (o que já venceu e não foi pago):
 * - faturas_em_aberto: saldo das faturas abertas/em acordo que vencem no mês;
 * - alugueis_previstos: contratos ativos cuja fatura do mês ainda não foi
 *   gerada (até o fim do contrato, ou sem fim com renovação automática), com o
 *   reajuste previsto pelo índice do contrato nos últimos 12 meses
 *   (reajuste_previsto = parte do reajuste);
 * - outras_receitas / despesas: lançamentos em aberto pelo vencimento (na
 *   imobiliária, só os do escritório: sem os de terceiros e sem os descontados
 *   no repasse; aluguéis ficam nas colunas próprias);
 * - repasses_agendados (imobiliária): repasses pendentes pela data de pagar;
 * - repasses_estimados / taxa_adm_prevista (imobiliária): o que ainda vai
 *   gerar repasse (faturas em aberto + aluguéis previstos), menos a taxa de
 *   administração do contrato (estimativa: não desconta IRRF nem despesas).
 */
create or replace function public.bi_previsao(p_meses int default 6)
returns table (
  mes date, atrasado boolean, faturas_em_aberto numeric, alugueis_previstos numeric, reajuste_previsto numeric,
  outras_receitas numeric, despesas numeric, repasses_agendados numeric, repasses_estimados numeric,
  taxa_adm_prevista numeric, contratos int)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.bi_org();
  v_imob boolean := privado.org_imobiliaria(v_org);
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_n int := least(greatest(coalesce(p_meses, 6), 1), 24);
  v_ini date := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
  v_ult date;
  v_fim date;
begin
  v_ult := (v_ini + make_interval(months => v_n - 1))::date;
  v_fim := (v_ini + make_interval(months => v_n) - interval '1 day')::date;
  return query
  with meses as (
    select gs::date as m from generate_series(v_ini, v_ult, interval '1 month') gs
  ),
  idx as (
    select x.indice, exp(sum(ln(1 + x.variacao_pct / 100))) - 1 as acum
      from (
        select ie.indice, ie.variacao_pct, row_number() over (partition by ie.indice order by ie.competencia desc) as rn
          from public.indices_economicos ie
         where ie.organizacao_id = v_org and ie.variacao_pct > -100
      ) x
     where x.rn <= 12
     group by x.indice
  ),
  fab as (
    select f.vencimento, greatest(f.valor_total - f.valor_abatido, 0) as saldo, c.taxa_administracao_pct as tx
      from public.faturas f
      join public.contratos c on c.id = f.contrato_id
     where f.organizacao_id = v_org and f.status in ('aberta', 'renegociada') and f.vencimento <= v_fim
       and f.valor_total > f.valor_abatido
  ),
  proj as (
    select c.id, c.valor_aluguel, c.taxa_administracao_pct as tx,
           (comp.c + case when c.modalidade = 'vencido' then interval '1 month' else interval '0 month' end)::date as mv,
           privado.bi_reajustes_ate(c.data_base_reajuste, c.periodicidade_reajuste_meses, comp.c) as k,
           coalesce(idx.acum, 0) as acum
      from public.contratos c
      cross join lateral (
        select gs::date as c
          from generate_series(greatest(date_trunc('month', c.data_inicio), v_ini - interval '1 month'), v_ult, interval '1 month') gs
      ) comp
      left join idx on idx.indice = c.indice_reajuste
     where c.organizacao_id = v_org and c.status = 'ativo'
       and (c.renovacao_automatica or comp.c <= date_trunc('month', c.data_fim))
       and not exists (
         select 1 from public.faturas f
          where f.contrato_id = c.id and date_trunc('month', f.competencia) = comp.c and f.status <> 'cancelada')
  ),
  proj2 as (
    select p.*, round(p.valor_aluguel * power(1 + p.acum, p.k), 2) as valor
      from proj p
     where p.mv between v_ini and v_ult
  ),
  linhas as (
    select ms.m, false as atr,
           (select coalesce(sum(f.saldo), 0) from fab f where f.vencimento >= greatest(ms.m, v_hoje) and f.vencimento < (ms.m + interval '1 month')::date) as fat,
           (select coalesce(sum(p.valor), 0) from proj2 p where p.mv = ms.m) as prev,
           (select coalesce(sum(p.valor - p.valor_aluguel), 0) from proj2 p where p.mv = ms.m) as reaj,
           (select coalesce(sum(l.valor), 0) from public.lancamentos l
             where l.organizacao_id = v_org and l.status = 'aberto' and l.tipo = 'receber' and l.fatura_id is null
               and (not v_imob or (not l.terceiros and not l.descontar_repasse))
               and l.vencimento >= greatest(ms.m, v_hoje) and l.vencimento < (ms.m + interval '1 month')::date) as orec,
           (select coalesce(sum(l.valor), 0) from public.lancamentos l
             where l.organizacao_id = v_org and l.status = 'aberto' and l.tipo = 'pagar'
               and (not v_imob or (not l.terceiros and not l.descontar_repasse))
               and l.vencimento >= greatest(ms.m, v_hoje) and l.vencimento < (ms.m + interval '1 month')::date) as desp,
           (select coalesce(sum(r.valor_liquido), 0) from public.repasses r
             where v_imob and r.organizacao_id = v_org and r.status = 'pendente'
               and r.pagar_em >= greatest(ms.m, v_hoje) and r.pagar_em < (ms.m + interval '1 month')::date) as ragend,
           case when v_imob then
             (select coalesce(sum(f.saldo * (1 - f.tx / 100)), 0) from fab f where f.vencimento >= greatest(ms.m, v_hoje) and f.vencimento < (ms.m + interval '1 month')::date)
             + (select coalesce(sum(p.valor * (1 - p.tx / 100)), 0) from proj2 p where p.mv = ms.m)
           else 0 end as rest,
           case when v_imob then
             (select coalesce(sum(f.saldo * f.tx / 100), 0) from fab f where f.vencimento >= greatest(ms.m, v_hoje) and f.vencimento < (ms.m + interval '1 month')::date)
             + (select coalesce(sum(p.valor * p.tx / 100), 0) from proj2 p where p.mv = ms.m)
           else 0 end as tadm,
           (select count(distinct p.id) from proj2 p where p.mv = ms.m) as nctr
      from meses ms
    union all
    select v_ini, true,
           (select coalesce(sum(f.saldo), 0) from fab f where f.vencimento < v_hoje),
           0, 0,
           (select coalesce(sum(l.valor), 0) from public.lancamentos l
             where l.organizacao_id = v_org and l.status = 'aberto' and l.tipo = 'receber' and l.fatura_id is null
               and (not v_imob or (not l.terceiros and not l.descontar_repasse)) and l.vencimento < v_hoje),
           (select coalesce(sum(l.valor), 0) from public.lancamentos l
             where l.organizacao_id = v_org and l.status = 'aberto' and l.tipo = 'pagar'
               and (not v_imob or (not l.terceiros and not l.descontar_repasse)) and l.vencimento < v_hoje),
           (select coalesce(sum(r.valor_liquido), 0) from public.repasses r
             where v_imob and r.organizacao_id = v_org and r.status = 'pendente' and r.pagar_em < v_hoje),
           case when v_imob then (select coalesce(sum(f.saldo * (1 - f.tx / 100)), 0) from fab f where f.vencimento < v_hoje) else 0 end,
           case when v_imob then (select coalesce(sum(f.saldo * f.tx / 100), 0) from fab f where f.vencimento < v_hoje) else 0 end,
           0
  )
  select l.m, l.atr, l.fat::numeric(14,2), l.prev::numeric(14,2), l.reaj::numeric(14,2), l.orec::numeric(14,2),
         l.desp::numeric(14,2), l.ragend::numeric(14,2), l.rest::numeric(14,2), l.tadm::numeric(14,2), l.nctr::int
    from linhas l
   order by l.atr desc, l.m;
end;
$$;
revoke execute on function public.bi_previsao(int) from public, anon;
grant execute on function public.bi_previsao(int) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Relatórios personalizados: lista fechada de fontes, colunas e filtros
-- -----------------------------------------------------------------------------
/**
 * Fontes seguras e as colunas permitidas de cada uma, com o tipo (texto,
 * inteiro, numero, dinheiro, data). "modulo": o módulo de onde vêm os dados
 * (o perfil de acesso precisa "ver" esse módulo — Relatórios não abre o que o
 * perfil esconde); "imob": a fonte só existe no modo imobiliária;
 * "imob_campos": colunas que só aparecem na imobiliária.
 * ESPELHO de FONTES_BI em src/lib/dominio/bi.ts (o teste confere).
 */
create or replace function privado.bi_fontes()
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select '{
    "imoveis": {"modulo": "imoveis", "imob": false, "imob_campos": ["corretor", "filial"], "campos": {
      "codigo": "texto", "titulo": "texto", "tipo": "texto", "status": "texto", "finalidades": "texto",
      "bairro": "texto", "cidade": "texto", "uf": "texto", "valor_aluguel": "dinheiro", "valor_venda": "dinheiro",
      "valor_condominio": "dinheiro", "valor_iptu": "dinheiro", "area_util": "numero", "quartos": "inteiro",
      "vagas": "inteiro", "captado_em": "data", "corretor": "texto", "filial": "texto"}},
    "contratos": {"modulo": "contratos", "imob": false, "imob_campos": ["proprietario", "taxa_administracao_pct", "filial"], "campos": {
      "numero": "inteiro", "codigo": "texto", "imovel": "texto", "locatario": "texto", "proprietario": "texto",
      "status": "texto", "finalidade": "texto", "data_inicio": "data", "data_fim": "data", "valor_aluguel": "dinheiro",
      "dia_vencimento": "inteiro", "indice_reajuste": "texto", "garantia": "texto", "taxa_administracao_pct": "numero",
      "filial": "texto"}},
    "faturas": {"modulo": "faturas", "imob": false, "imob_campos": [], "campos": {
      "numero": "inteiro", "contrato": "inteiro", "imovel": "texto", "locatario": "texto", "competencia": "data",
      "vencimento": "data", "valor_total": "dinheiro", "saldo": "dinheiro", "status": "texto", "pago_em": "data",
      "dias_atraso": "inteiro"}},
    "lancamentos": {"modulo": "financeiro", "imob": false, "imob_campos": ["terceiros"], "campos": {
      "tipo": "texto", "descricao": "texto", "categoria": "texto", "valor": "dinheiro", "valor_pago": "dinheiro",
      "vencimento": "data", "liquidado_em": "data", "status": "texto", "pessoa": "texto", "imovel": "texto",
      "plano": "texto", "centro_custo": "texto", "conta": "texto", "terceiros": "texto"}},
    "leads": {"modulo": "comercial", "imob": true, "imob_campos": [], "campos": {
      "nome": "texto", "telefone": "texto", "email": "texto", "origem": "texto", "funil": "texto", "status": "texto",
      "prioridade": "texto", "corretor": "texto", "imovel": "texto", "entrada": "data", "atendido_em": "data",
      "perdido_em": "data", "motivo_perda": "texto", "utm_source": "texto", "utm_campaign": "texto", "filial": "texto"}},
    "visitas": {"modulo": "agenda", "imob": false, "imob_campos": ["corretor"], "campos": {
      "data": "data", "hora": "texto", "tipo": "texto", "status": "texto", "imovel": "texto", "contato": "texto",
      "feedback_nota": "inteiro", "feedback_interesse": "texto", "corretor": "texto"}},
    "propostas": {"modulo": "comercial", "imob": true, "imob_campos": [], "campos": {
      "tipo": "texto", "status": "texto", "valor": "dinheiro", "imovel": "texto", "corretor": "texto",
      "cliente": "texto", "criada_em": "data", "fechada_em": "data"}},
    "repasses": {"modulo": "repasses", "imob": true, "imob_campos": [], "campos": {
      "competencia": "data", "contrato": "inteiro", "imovel": "texto", "proprietario": "texto", "aluguel": "dinheiro",
      "valor_bruto": "dinheiro", "taxa_administracao": "dinheiro", "taxa_intermediacao": "dinheiro", "irrf": "dinheiro",
      "valor_liquido": "dinheiro", "status": "texto", "pagar_em": "data", "pago_em": "data"}},
    "chamados": {"modulo": "manutencao", "imob": false, "imob_campos": [], "campos": {
      "numero": "inteiro", "titulo": "texto", "imovel": "texto", "categoria": "texto", "urgencia": "texto",
      "status": "texto", "aberto_em": "data", "concluido_em": "data", "valor_aprovado": "dinheiro",
      "valor_final": "dinheiro", "prestador": "texto", "responsabilidade": "texto"}}
  }'::jsonb
$$;
grant execute on function privado.bi_fontes() to authenticated;

/** Operadores de filtro de cada tipo de coluna (espelho de OPERADORES_POR_TIPO). */
create or replace function privado.bi_operadores(p_tipo text)
returns jsonb
language sql
immutable
set search_path = ''
as $$
  select case p_tipo
    when 'texto' then '["igual","diferente","contem","vazio","preenchido"]'::jsonb
    when 'data' then '["igual","maior_igual","menor_igual","ultimos_dias","este_mes","mes_passado","este_ano","vazio","preenchido"]'::jsonb
    when 'dinheiro' then '["igual","diferente","maior_igual","menor_igual","vazio","preenchido"]'::jsonb
    when 'numero' then '["igual","diferente","maior_igual","menor_igual","vazio","preenchido"]'::jsonb
    when 'inteiro' then '["igual","diferente","maior_igual","menor_igual","vazio","preenchido"]'::jsonb
    else '[]'::jsonb end
$$;
grant execute on function privado.bi_operadores(text) to authenticated;

/**
 * O usuário logado pode usar esta fonte? Exige "ver" no módulo de onde vêm os
 * dados (lançamentos → Financeiro, leads/propostas → Comercial, repasses →
 * Repasses…): um perfil com Relatórios mas sem Financeiro não lê lançamentos
 * por um relatório personalizado.
 */
create or replace function privado.bi_pode_fonte(p_org uuid, p_fonte text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(privado.tem_permissao(p_org, privado.bi_fontes() -> p_fonte ->> 'modulo', 'ver'), false)
$$;
revoke execute on function privado.bi_pode_fonte(uuid, text) from public, anon;
grant execute on function privado.bi_pode_fonte(uuid, text) to authenticated;

/**
 * Confere a definição de um relatório personalizado (mesmas regras de
 * validarDefinicao em src/lib/dominio/bi.ts). Devolve a mensagem de erro ou null.
 */
create or replace function privado.bi_validar(p jsonb, p_imob boolean)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_def jsonb;
  v_campos jsonb;
  v_imob_campos jsonb;
  v_cols text[];
  v_tot text[] := '{}';
  v_col text;
  v_tipo text;
  f jsonb;
  v_op text;
  v_val text;
  v_grupo text;
  v_ord text;
  v_ok text[];
begin
  if p is null or jsonb_typeof(p) <> 'object' then
    return 'Relatório inválido.';
  end if;
  v_def := privado.bi_fontes() -> (p ->> 'fonte');
  if v_def is null then
    return 'Escolha a fonte dos dados.';
  end if;
  if (v_def ->> 'imob')::boolean and not p_imob then
    return 'Esta fonte só existe no modo imobiliária.';
  end if;
  v_campos := v_def -> 'campos';
  v_imob_campos := coalesce(v_def -> 'imob_campos', '[]'::jsonb);

  if jsonb_typeof(p -> 'colunas') is distinct from 'array' then
    return 'Escolha as colunas.';
  end if;
  select coalesce(array_agg(x), '{}') into v_cols from jsonb_array_elements_text(p -> 'colunas') x;
  if coalesce(array_length(v_cols, 1), 0) = 0 then
    return 'Escolha ao menos uma coluna.';
  end if;
  if array_length(v_cols, 1) > 30 then
    return 'No máximo 30 colunas.';
  end if;
  if (select count(distinct x) from unnest(v_cols) x) <> array_length(v_cols, 1) then
    return 'Há coluna repetida.';
  end if;
  foreach v_col in array v_cols loop
    if not (v_campos ? v_col) then
      return format('Coluna desconhecida: %s.', v_col);
    end if;
    if not p_imob and v_imob_campos ? v_col then
      return format('A coluna %s só existe no modo imobiliária.', v_col);
    end if;
  end loop;

  if jsonb_typeof(p -> 'filtros') = 'array' then
    if jsonb_array_length(p -> 'filtros') > 10 then
      return 'No máximo 10 filtros.';
    end if;
    for f in select * from jsonb_array_elements(p -> 'filtros') loop
      if jsonb_typeof(f) <> 'object' then
        return 'Filtro inválido.';
      end if;
      v_col := f ->> 'campo';
      v_op := f ->> 'op';
      v_val := f ->> 'valor';
      if v_col is null or not (v_campos ? v_col) then
        return 'Há filtro com coluna desconhecida.';
      end if;
      if not p_imob and v_imob_campos ? v_col then
        return format('A coluna %s só existe no modo imobiliária.', v_col);
      end if;
      v_tipo := v_campos ->> v_col;
      if v_op is null or not (privado.bi_operadores(v_tipo) ? v_op) then
        return format('Esse filtro não vale para a coluna %s.', v_col);
      end if;
      if v_op in ('vazio', 'preenchido', 'este_mes', 'mes_passado', 'este_ano') then
        continue;
      end if;
      if v_val is null or btrim(v_val) = '' then
        return format('Informe o valor do filtro de %s.', v_col);
      end if;
      if length(v_val) > 200 then
        return 'Valor de filtro muito longo.';
      end if;
      if v_op = 'ultimos_dias' then
        if v_val !~ '^\d{1,4}$' or v_val::int < 1 or v_val::int > 3650 then
          return 'Informe de 1 a 3650 dias.';
        end if;
      elsif v_tipo = 'data' then
        if v_val !~ '^\d{4}-\d{2}-\d{2}$' then
          return format('Data inválida no filtro de %s.', v_col);
        end if;
        begin
          perform v_val::date;
        exception when others then
          return format('Data inválida no filtro de %s.', v_col);
        end;
      elsif v_tipo in ('dinheiro', 'numero', 'inteiro') then
        if v_val !~ '^-?\d{1,12}(\.\d{1,4})?$' then
          return format('Número inválido no filtro de %s.', v_col);
        end if;
      end if;
    end loop;
  elsif p ? 'filtros' and jsonb_typeof(p -> 'filtros') <> 'null' then
    return 'Filtros inválidos.';
  end if;

  v_grupo := nullif(p ->> 'agrupar_por', '');
  if v_grupo is not null then
    if not (v_campos ? v_grupo) or v_campos ->> v_grupo in ('dinheiro', 'numero') then
      return 'Escolha agrupar por uma coluna de texto, número inteiro ou data.';
    end if;
    if not p_imob and v_imob_campos ? v_grupo then
      return format('A coluna %s só existe no modo imobiliária.', v_grupo);
    end if;
  end if;

  if jsonb_typeof(p -> 'totais') = 'array' then
    select coalesce(array_agg(x), '{}') into v_tot from jsonb_array_elements_text(p -> 'totais') x;
    if coalesce(array_length(v_tot, 1), 0) > 10 then
      return 'No máximo 10 totais.';
    end if;
    foreach v_col in array v_tot loop
      if not (v_campos ? v_col) or v_campos ->> v_col not in ('dinheiro', 'numero', 'inteiro') then
        return 'Só dá para somar colunas de número ou valor.';
      end if;
      if not p_imob and v_imob_campos ? v_col then
        return format('A coluna %s só existe no modo imobiliária.', v_col);
      end if;
    end loop;
  elsif p ? 'totais' and jsonb_typeof(p -> 'totais') <> 'null' then
    return 'Totais inválidos.';
  end if;

  v_ord := nullif(p ->> 'ordenar_por', '');
  if v_ord is not null then
    v_ok := case when v_grupo is not null then array[v_grupo, 'quantidade'] || v_tot else v_cols end;
    if not (v_ord = any (v_ok)) then
      return 'Escolha ordenar por uma das colunas do relatório.';
    end if;
  end if;
  if coalesce(nullif(p ->> 'ordem', ''), 'asc') not in ('asc', 'desc') then
    return 'Ordem inválida.';
  end if;
  return null;
end;
$$;
grant execute on function privado.bi_validar(jsonb, boolean) to authenticated;

/** Condição SQL de um filtro: coluna da lista (%I) e valor sempre como literal (%L). */
create or replace function privado.bi_condicao(p_campo text, p_tipo text, p_op text, p_valor text)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  h text := '(now() at time zone ''America/Sao_Paulo'')::date';
  c text := format('%I', p_campo);
  sinal text := case p_op when 'igual' then '=' when 'diferente' then '<>' when 'maior_igual' then '>=' when 'menor_igual' then '<=' end;
begin
  if p_op = 'vazio' then
    return case when p_tipo = 'texto' then format('(%s is null or %s = '''')', c, c) else format('%s is null', c) end;
  elsif p_op = 'preenchido' then
    return case when p_tipo = 'texto' then format('(%s is not null and %s <> '''')', c, c) else format('%s is not null', c) end;
  end if;
  if p_tipo = 'texto' then
    if p_op = 'igual' then
      return format('lower(%s) = lower(%L)', c, p_valor);
    elsif p_op = 'diferente' then
      return format('(%s is null or lower(%s) <> lower(%L))', c, c, p_valor);
    elsif p_op = 'contem' then
      return format('%s ilike %L', c, '%' || replace(replace(replace(p_valor, '\', '\\'), '%', '\%'), '_', '\_') || '%');
    end if;
  elsif p_tipo in ('dinheiro', 'numero', 'inteiro') and sinal is not null then
    if p_op = 'diferente' then
      return format('(%s is null or %s <> %L::numeric)', c, c, p_valor);
    end if;
    return format('%s %s %L::numeric', c, sinal, p_valor);
  elsif p_tipo = 'data' then
    if sinal is not null then
      return format('%s %s %L::date', c, sinal, p_valor);
    elsif p_op = 'ultimos_dias' then
      return format('%s between %s - %s and %s', c, h, p_valor::int, h);
    elsif p_op = 'este_mes' then
      return format('date_trunc(''month'', %s) = date_trunc(''month'', %s)', c, h);
    elsif p_op = 'mes_passado' then
      return format('date_trunc(''month'', %s) = date_trunc(''month'', %s) - interval ''1 month''', c, h);
    elsif p_op = 'este_ano' then
      return format('extract(year from %s) = extract(year from %s)', c, h);
    end if;
  end if;
  raise exception 'Filtro inválido.';
end;
$$;
grant execute on function privado.bi_condicao(text, text, text, text) to authenticated;

/**
 * Consulta-base de cada fonte (colunas com os nomes da lista), já presa à
 * organização e, nas fontes comerciais, ao corretor (p_corretor).
 */
create or replace function privado.bi_base(p_fonte text, p_org uuid, p_corretor uuid)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  hoje text := '(now() at time zone ''America/Sao_Paulo'')::date';
begin
  case p_fonte
  when 'imoveis' then
    return format($q$select i.codigo, i.titulo, i.tipo, i.status, array_to_string(i.finalidades, ', ') as finalidades,
        i.bairro, i.cidade, i.uf, i.valor_aluguel, i.valor_venda, i.valor_condominio, i.valor_iptu, i.area_util,
        i.quartos, i.vagas, i.captado_em, cor.nome as corretor, fl.nome as filial
      from public.imoveis i
      left join public.pessoas cor on cor.id = i.corretor_id
      left join public.filiais fl on fl.id = i.filial_id
     where i.organizacao_id = %L$q$, p_org);
  when 'contratos' then
    return format($q$select c.numero, c.codigo, im.codigo as imovel,
        (select string_agg(p.nome, ', ' order by p.nome) from public.contrato_partes cp join public.pessoas p on p.id = cp.pessoa_id
          where cp.contrato_id = c.id and cp.papel = 'locatario') as locatario,
        (select string_agg(p.nome, ', ' order by p.nome) from public.imovel_proprietarios ip join public.pessoas p on p.id = ip.pessoa_id
          where ip.imovel_id = c.imovel_id) as proprietario,
        c.status, c.finalidade, c.data_inicio, c.data_fim, c.valor_aluguel, c.dia_vencimento, c.indice_reajuste,
        c.garantia_tipo as garantia, c.taxa_administracao_pct, fl.nome as filial
      from public.contratos c
      join public.imoveis im on im.id = c.imovel_id
      left join public.filiais fl on fl.id = c.filial_id
     where c.organizacao_id = %L$q$, p_org);
  when 'faturas' then
    return format($q$select f.numero, c.numero as contrato, im.codigo as imovel,
        (select string_agg(p.nome, ', ' order by p.nome) from public.contrato_partes cp join public.pessoas p on p.id = cp.pessoa_id
          where cp.contrato_id = c.id and cp.papel = 'locatario') as locatario,
        f.competencia, f.vencimento, f.valor_total,
        case when f.status in ('aberta', 'renegociada') then greatest(f.valor_total - f.valor_abatido, 0) else 0 end as saldo,
        f.status, f.pago_em,
        case when f.status in ('aberta', 'renegociada') and f.vencimento < %1$s then %1$s - f.vencimento else 0 end as dias_atraso
      from public.faturas f
      join public.contratos c on c.id = f.contrato_id
      join public.imoveis im on im.id = c.imovel_id
     where f.organizacao_id = %2$L$q$, hoje, p_org);
  when 'lancamentos' then
    return format($q$select case l.tipo when 'receber' then 'A receber' else 'A pagar' end as tipo, l.descricao, l.categoria, l.valor,
        case when l.status = 'liquidado' then coalesce(l.valor_pago, l.valor) end as valor_pago,
        l.vencimento, l.liquidado_em, l.status, p.nome as pessoa, im.codigo as imovel,
        pc.nome as plano, cc.nome as centro_custo, cf.nome as conta,
        case when l.terceiros then 'sim' else 'não' end as terceiros
      from public.lancamentos l
      left join public.pessoas p on p.id = l.pessoa_id
      left join public.imoveis im on im.id = l.imovel_id
      left join public.plano_contas pc on pc.id = l.plano_id
      left join public.centros_custo cc on cc.id = l.centro_custo_id
      left join public.contas_financeiras cf on cf.id = l.conta_id
     where l.organizacao_id = %L$q$, p_org);
  when 'leads' then
    return format($q$select l.nome, l.telefone, l.email, l.origem, l.funil, l.status, l.prioridade, cor.nome as corretor,
        im.codigo as imovel, (l.created_at at time zone 'America/Sao_Paulo')::date as entrada,
        (l.atendido_em at time zone 'America/Sao_Paulo')::date as atendido_em,
        (l.perdido_em at time zone 'America/Sao_Paulo')::date as perdido_em,
        l.motivo_perda, l.utm_source, l.utm_campaign, fl.nome as filial
      from public.leads l
      left join public.pessoas cor on cor.id = l.corretor_id
      left join public.imoveis im on im.id = l.imovel_id
      left join public.filiais fl on fl.id = l.filial_id
     where l.organizacao_id = %L and (%L::uuid is null or l.corretor_id = %L::uuid)$q$, p_org, p_corretor, p_corretor);
  when 'visitas' then
    return format($q$select (v.data_hora at time zone 'America/Sao_Paulo')::date as data,
        to_char(v.data_hora at time zone 'America/Sao_Paulo', 'HH24:MI') as hora,
        coalesce(v.tipo, 'visita') as tipo, v.status, im.codigo as imovel,
        coalesce(v.contato_nome, pe.nome, ld.nome) as contato, v.feedback_nota, v.feedback_interesse, cor.nome as corretor
      from public.visitas v
      left join public.imoveis im on im.id = v.imovel_id
      left join public.pessoas pe on pe.id = v.pessoa_id
      left join public.leads ld on ld.id = v.lead_id
      left join public.pessoas cor on cor.id = v.corretor_id
     where v.organizacao_id = %L and (%L::uuid is null or v.corretor_id = %L::uuid)$q$, p_org, p_corretor, p_corretor);
  when 'propostas' then
    return format($q$select pr.tipo, pr.status, pr.valor, im.codigo as imovel, cor.nome as corretor, ld.nome as cliente,
        (pr.created_at at time zone 'America/Sao_Paulo')::date as criada_em, pr.fechada_em
      from public.propostas pr
      left join public.imoveis im on im.id = pr.imovel_id
      left join public.pessoas cor on cor.id = pr.corretor_id
      left join public.leads ld on ld.id = pr.lead_id
     where pr.organizacao_id = %L and (%L::uuid is null or pr.corretor_id = %L::uuid)$q$, p_org, p_corretor, p_corretor);
  when 'repasses' then
    return format($q$select r.competencia, c.numero as contrato, im.codigo as imovel, p.nome as proprietario, r.aluguel,
        r.valor_bruto, r.taxa_administracao, r.taxa_intermediacao, r.irrf, r.valor_liquido, r.status, r.pagar_em, r.pago_em
      from public.repasses r
      join public.contratos c on c.id = r.contrato_id
      join public.imoveis im on im.id = c.imovel_id
      join public.pessoas p on p.id = r.pessoa_id
     where r.organizacao_id = %L$q$, p_org);
  when 'chamados' then
    return format($q$select ch.numero, ch.titulo, im.codigo as imovel, ch.categoria, ch.urgencia, ch.status,
        (ch.created_at at time zone 'America/Sao_Paulo')::date as aberto_em, ch.concluido_em, ch.valor_aprovado,
        ch.valor_final, pr.nome as prestador, ch.responsabilidade
      from public.chamados ch
      join public.imoveis im on im.id = ch.imovel_id
      left join public.pessoas pr on pr.id = ch.prestador_id
     where ch.organizacao_id = %L$q$, p_org);
  else
    raise exception 'Fonte desconhecida.';
  end case;
end;
$$;
grant execute on function privado.bi_base(text, uuid, uuid) to authenticated;

/**
 * Roda um relatório personalizado (definição validada por privado.bi_validar
 * e fonte liberada no perfil de acesso: privado.bi_pode_fonte).
 * Security invoker: o RLS da organização vale. Devolve
 * {colunas: [...], linhas: [[...]], total, totais: {coluna: soma}}.
 * Agrupado: colunas = [grupo, "quantidade", totais…]; datas agrupam por mês (AAAA-MM).
 */
create or replace function public.bi_executar(p jsonb, p_limite int default 500)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := privado.bi_org();
  v_imob boolean := privado.org_imobiliaria(v_org);
  v_erro text;
  v_campos jsonb;
  v_base text;
  v_where text := 'true';
  f jsonb;
  v_cols text[];
  v_tot text[] := '{}';
  v_grupo text := nullif(p ->> 'agrupar_por', '');
  v_ord text := nullif(p ->> 'ordenar_por', '');
  v_dir text := case when p ->> 'ordem' = 'desc' then 'desc' else 'asc' end;
  v_lim int := least(greatest(coalesce(p_limite, 500), 1), 10000);
  v_sel text;
  v_agg text;
  v_order text;
  v_gexpr text;
  v_linhas jsonb;
  v_total bigint;
  v_totais jsonb := '{}'::jsonb;
  v_saida text[];
begin
  v_erro := privado.bi_validar(p, v_imob);
  if v_erro is not null then
    raise exception '%', v_erro;
  end if;
  if not privado.bi_pode_fonte(v_org, p ->> 'fonte') then
    raise exception 'Seu perfil de acesso não permite ver %. Fale com o administrador.',
      privado.rotulo_permissao(privado.bi_fontes() -> (p ->> 'fonte') ->> 'modulo');
  end if;
  v_campos := privado.bi_fontes() -> (p ->> 'fonte') -> 'campos';
  v_base := privado.bi_base(p ->> 'fonte', v_org, privado.bi_escopo_corretor(v_org));
  select array_agg(x) into v_cols from jsonb_array_elements_text(p -> 'colunas') x;
  if jsonb_typeof(p -> 'totais') = 'array' then
    select coalesce(array_agg(x), '{}') into v_tot from jsonb_array_elements_text(p -> 'totais') x;
  end if;
  for f in select * from jsonb_array_elements(case when jsonb_typeof(p -> 'filtros') = 'array' then p -> 'filtros' else '[]'::jsonb end) loop
    v_where := v_where || ' and ' || privado.bi_condicao(f ->> 'campo', v_campos ->> (f ->> 'campo'), f ->> 'op', f ->> 'valor');
  end loop;

  if v_grupo is null then
    v_saida := v_cols;
    select string_agg(format('%I', c), ', ' order by o) into v_sel from unnest(v_cols) with ordinality u(c, o);
    v_order := format('%I %s nulls last', coalesce(v_ord, v_cols[1]), v_dir);
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_array(%s) order by _n), ''[]''::jsonb)
         from (select b.*, row_number() over (order by %s) as _n from (%s) b where %s order by %s limit %s) x',
      v_sel, v_order, v_base, v_where, v_order, v_lim) into v_linhas;
    execute format('select count(*) from (%s) b where %s', v_base, v_where) into v_total;
    if coalesce(array_length(v_tot, 1), 0) > 0 then
      select string_agg(format('%L, sum(%I)', t, t), ', ' order by o) into v_agg from unnest(v_tot) with ordinality u(t, o);
      execute format('select jsonb_build_object(%s) from (%s) b where %s', v_agg, v_base, v_where) into v_totais;
    end if;
  else
    v_gexpr := case when v_campos ->> v_grupo = 'data' then format('to_char(%I, ''YYYY-MM'')', v_grupo) else format('%I', v_grupo) end;
    v_saida := array[v_grupo, 'quantidade'] || v_tot;
    v_sel := 'g, quantidade' || coalesce((select string_agg(format(', %I', t), '' order by o) from unnest(v_tot) with ordinality u(t, o)), '');
    v_agg := v_gexpr || ' as g, count(*) as quantidade'
             || coalesce((select string_agg(format(', sum(%I) as %I', t, t), '' order by o) from unnest(v_tot) with ordinality u(t, o)), '');
    v_order := case when v_ord is null then 'quantidade desc, g'
                    when v_ord = v_grupo then format('g %s nulls last', v_dir)
                    else format('%I %s nulls last, g', v_ord, v_dir) end;
    execute format(
      'select coalesce(jsonb_agg(jsonb_build_array(%s) order by _n), ''[]''::jsonb)
         from (select y.*, row_number() over (order by %s) as _n
                 from (select %s from (%s) b where %s group by 1) y order by %s limit %s) x',
      v_sel, v_order, v_agg, v_base, v_where, v_order, v_lim) into v_linhas;
    execute format('select count(*) from (select %s from (%s) b where %s group by 1) z', v_gexpr, v_base, v_where) into v_total;
    execute format('select jsonb_build_object(''quantidade'', count(*)%s) from (%s) b where %s',
                   coalesce((select string_agg(format(', %L, sum(%I)', t, t), '' order by o) from unnest(v_tot) with ordinality u(t, o)), ''),
                   v_base, v_where) into v_totais;
  end if;
  return jsonb_build_object('colunas', to_jsonb(v_saida), 'linhas', v_linhas, 'total', v_total, 'totais', coalesce(v_totais, '{}'::jsonb));
end;
$$;
revoke execute on function public.bi_executar(jsonb, int) from public, anon;
grant execute on function public.bi_executar(jsonb, int) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Tabelas: relatórios salvos, agendamentos e execuções
-- -----------------------------------------------------------------------------
create table if not exists public.relatorios_salvos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 120),
  descricao text check (descricao is null or length(descricao) <= 1000),
  fonte text not null,
  colunas text[] not null default '{}',
  filtros jsonb not null default '[]'::jsonb check (jsonb_typeof(filtros) = 'array'),
  agrupar_por text,
  totais text[] not null default '{}',
  ordenar_por text,
  ordem text not null default 'asc' check (ordem in ('asc', 'desc')),
  limite int not null default 500 check (limite between 1 and 10000),
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists relatorios_salvos_org_idx on public.relatorios_salvos (organizacao_id);

create table if not exists public.relatorio_agendamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 120),
  relatorio_id uuid references public.relatorios_salvos(id) on delete cascade,
  padrao text check (padrao is null or padrao in (
    'financeiro_mensal', 'inadimplencia', 'rentabilidade', 'imoveis_vagos', 'imoveis_sem_visitas',
    'imoveis_procura', 'leads_canais', 'equipe', 'filiais', 'previsao')),
  periodo text not null default 'mes_anterior' check (periodo in ('mes_atual', 'mes_anterior', 'ultimos_30', 'ano_atual')),
  frequencia text not null default 'mensal' check (frequencia in ('diaria', 'semanal', 'mensal')),
  dia_semana int check (dia_semana is null or dia_semana between 0 and 6),
  dia_mes int check (dia_mes is null or dia_mes between 1 and 28),
  hora int not null default 8 check (hora between 0 and 23),
  formato text not null default 'csv' check (formato in ('csv', 'xls')),
  emails text[] not null default '{}',
  whatsapps text[] not null default '{}',
  ativo boolean not null default true,
  proxima_em timestamptz,
  ultima_em timestamptz,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint relatorio_agendamentos_origem_check check ((relatorio_id is null) <> (padrao is null))
);
create index if not exists relatorio_agendamentos_org_idx on public.relatorio_agendamentos (organizacao_id);
create index if not exists relatorio_agendamentos_vez_idx on public.relatorio_agendamentos (organizacao_id, proxima_em) where ativo;
create index if not exists relatorio_agendamentos_relatorio_idx on public.relatorio_agendamentos (relatorio_id) where relatorio_id is not null;

-- Execuções (só leitura e acréscimo): gravadas só pela RPC
-- relatorio_registrar_execucao (sem insert/update/delete direto pela API). O
-- arquivo gerado fica guardado por privado.bi_dias_guarda() dias e depois é
-- apagado; arquivo_apagado_em/por é a única marca que muda depois (pela RPC
-- relatorio_marcar_arquivos_apagados).
create table if not exists public.relatorio_execucoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  agendamento_id uuid references public.relatorio_agendamentos(id) on delete set null,
  nome text not null,
  origem text not null default 'agendada' check (origem in ('agendada', 'manual')),
  status text not null check (status in ('enviado', 'pronto_para_enviar', 'erro')),
  formato text check (formato is null or formato in ('csv', 'xls')),
  linhas int,
  resumo text,
  arquivo_path text,
  destinatarios jsonb not null default '{}'::jsonb,
  erro text,
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now(),
  arquivo_apagado_em timestamptz,
  arquivo_apagado_por uuid
);
create index if not exists relatorio_execucoes_org_idx on public.relatorio_execucoes (organizacao_id, data desc);
create index if not exists relatorio_execucoes_agendamento_idx on public.relatorio_execucoes (agendamento_id, data desc);
create index if not exists relatorio_execucoes_arquivo_idx on public.relatorio_execucoes (organizacao_id, arquivo_path) where arquivo_path is not null;

/**
 * Por quantos dias os arquivos gerados ficam guardados (LGPD: a inadimplência,
 * por exemplo, leva nome e telefone de locatários). Mesmo número de
 * DIAS_GUARDA_ARQUIVOS em src/lib/dominio/bi.ts.
 */
create or replace function privado.bi_dias_guarda()
returns int
language sql
immutable
set search_path = ''
as $$
  select 90
$$;
grant execute on function privado.bi_dias_guarda() to authenticated;

/**
 * Próxima execução de um agendamento depois de p_depois, no horário de
 * Brasília: diária (todo dia na hora), semanal (dia da semana 0 = domingo) ou
 * mensal (dia 1–28). Mesma conta de proximaExecucao() em src/lib/dominio/bi.ts.
 */
create or replace function privado.bi_proxima_execucao(p_frequencia text, p_dia_semana int, p_dia_mes int, p_hora int, p_depois timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
declare
  v_local timestamp := p_depois at time zone 'America/Sao_Paulo';
  v_cand timestamp;
  i int;
begin
  for i in 0..62 loop
    v_cand := (v_local::date + i) + make_time(least(greatest(coalesce(p_hora, 8), 0), 23), 0, 0);
    if v_cand > v_local and (
         p_frequencia = 'diaria'
      or (p_frequencia = 'semanal' and extract(dow from v_cand)::int = coalesce(p_dia_semana, 1))
      or (p_frequencia = 'mensal' and extract(day from v_cand)::int = coalesce(p_dia_mes, 1))) then
      return v_cand at time zone 'America/Sao_Paulo';
    end if;
  end loop;
  return null;
end;
$$;
grant execute on function privado.bi_proxima_execucao(text, int, int, int, timestamptz) to authenticated;

/**
 * Relatório salvo: permissão (editar relatórios e ver o módulo da fonte) e
 * definição conferidas no banco.
 */
create or replace function privado.relatorios_salvos_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_erro text;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; else v_org := new.organizacao_id; end if;
  if privado.chamada_da_api() and not privado.bi_pode_editar(v_org) then
    raise exception 'Seu perfil de acesso não permite criar ou editar relatórios personalizados. Fale com o administrador.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  new.nome := btrim(new.nome);
  new.agrupar_por := nullif(new.agrupar_por, '');
  new.ordenar_por := nullif(new.ordenar_por, '');
  if privado.chamada_da_api() and not privado.bi_pode_fonte(v_org, new.fonte) and privado.bi_fontes() ? new.fonte then
    raise exception 'Seu perfil de acesso não permite ver %. Fale com o administrador.',
      privado.rotulo_permissao(privado.bi_fontes() -> new.fonte ->> 'modulo');
  end if;
  v_erro := privado.bi_validar(
    jsonb_build_object('fonte', new.fonte, 'colunas', to_jsonb(new.colunas), 'filtros', new.filtros,
                       'agrupar_por', new.agrupar_por, 'totais', to_jsonb(new.totais),
                       'ordenar_por', new.ordenar_por, 'ordem', new.ordem),
    privado.org_imobiliaria(v_org));
  if v_erro is not null then
    raise exception '%', v_erro;
  end if;
  if tg_op = 'INSERT' then
    if privado.chamada_da_api() then
      new.criado_por := auth.uid();
    end if;
  else
    new.criado_por := old.criado_por;
    new.organizacao_id := old.organizacao_id;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger relatorios_salvos_antes_trg before insert or update or delete on public.relatorios_salvos
  for each row execute function privado.relatorios_salvos_antes();

/**
 * Agendamento: permissão (sem o papel corretor), relatório da mesma
 * organização, relatório padrão permitido no modo, destinatários válidos e a
 * próxima execução sempre calculada pelo banco.
 */
create or replace function privado.relatorio_agendamentos_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_api boolean := privado.chamada_da_api();
  v_mudou boolean;
  x text;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; else v_org := new.organizacao_id; end if;
  if v_api and not privado.bi_pode_agendar(v_org) then
    raise exception 'Seu perfil de acesso não permite programar envios de relatórios. Fale com o administrador.';
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  if tg_op = 'UPDATE' then
    new.organizacao_id := old.organizacao_id;
    new.criado_por := old.criado_por;
    new.created_at := old.created_at;
  elsif v_api then
    new.criado_por := auth.uid();
  end if;
  new.nome := btrim(new.nome);
  if new.relatorio_id is not null
     and not exists (select 1 from public.relatorios_salvos r where r.id = new.relatorio_id and r.organizacao_id = v_org) then
    raise exception 'Relatório não encontrado.';
  end if;
  if new.padrao in ('rentabilidade', 'imoveis_vagos', 'imoveis_sem_visitas', 'financeiro_mensal', 'inadimplencia', 'previsao') then
    null;
  elsif new.padrao is not null and not privado.org_imobiliaria(v_org) then
    raise exception 'Este relatório só existe no modo imobiliária.';
  end if;
  if new.frequencia = 'semanal' then
    new.dia_semana := coalesce(new.dia_semana, 1);
    new.dia_mes := null;
  elsif new.frequencia = 'mensal' then
    new.dia_mes := coalesce(new.dia_mes, 1);
    new.dia_semana := null;
  else
    new.dia_semana := null;
    new.dia_mes := null;
  end if;
  new.emails := coalesce((select array_agg(distinct lower(btrim(e))) from unnest(new.emails) e where btrim(e) <> ''), '{}');
  new.whatsapps := coalesce((select array_agg(distinct regexp_replace(w, '\D', '', 'g')) from unnest(new.whatsapps) w
                              where regexp_replace(w, '\D', '', 'g') <> ''), '{}');
  if coalesce(array_length(new.emails, 1), 0) > 20 or coalesce(array_length(new.whatsapps, 1), 0) > 20 then
    raise exception 'No máximo 20 e-mails e 20 WhatsApps por envio.';
  end if;
  foreach x in array new.emails loop
    if x !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(x) > 200 then
      raise exception 'E-mail inválido: %', x;
    end if;
  end loop;
  foreach x in array new.whatsapps loop
    if length(x) < 10 or length(x) > 13 then
      raise exception 'WhatsApp inválido: % (use DDD + número).', x;
    end if;
  end loop;

  if v_api then
    -- A próxima execução e a última são do banco: a API não escolhe.
    if tg_op = 'INSERT' then
      new.ultima_em := null;
      v_mudou := true;
    else
      new.ultima_em := old.ultima_em;
      v_mudou := new.frequencia is distinct from old.frequencia or new.dia_semana is distinct from old.dia_semana
              or new.dia_mes is distinct from old.dia_mes or new.hora is distinct from old.hora
              or new.ativo is distinct from old.ativo or old.proxima_em is null;
      if not v_mudou then
        new.proxima_em := old.proxima_em;
      end if;
    end if;
    if v_mudou then
      new.proxima_em := case when new.ativo then privado.bi_proxima_execucao(new.frequencia, new.dia_semana, new.dia_mes, new.hora, now()) end;
    end if;
  elsif new.proxima_em is null and new.ativo then
    new.proxima_em := privado.bi_proxima_execucao(new.frequencia, new.dia_semana, new.dia_mes, new.hora, now());
  end if;
  if not new.ativo then
    new.proxima_em := null;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger relatorio_agendamentos_antes_trg before insert or update or delete on public.relatorio_agendamentos
  for each row execute function privado.relatorio_agendamentos_antes();

/** Execução: quem e quando são do banco; arquivo só dentro da pasta da organização. */
create or replace function privado.relatorio_execucoes_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if privado.chamada_da_api() then
    new.usuario_id := auth.uid();
    new.data := now();
  end if;
  new.arquivo_apagado_em := null;
  new.arquivo_apagado_por := null;
  if new.arquivo_path is not null and new.arquivo_path not like new.organizacao_id::text || '/%' then
    raise exception 'Arquivo fora da pasta da organização.';
  end if;
  if new.arquivo_path is not null and (new.arquivo_path like '%..%' or length(new.arquivo_path) > 300) then
    raise exception 'Caminho de arquivo inválido.';
  end if;
  if new.agendamento_id is not null
     and not exists (select 1 from public.relatorio_agendamentos a where a.id = new.agendamento_id and a.organizacao_id = new.organizacao_id) then
    raise exception 'Agendamento não encontrado.';
  end if;
  new.nome := left(btrim(new.nome), 200);
  new.resumo := left(new.resumo, 1000);
  new.erro := left(new.erro, 1000);
  return new;
end;
$$;
create or replace trigger relatorio_execucoes_antes_trg before insert on public.relatorio_execucoes
  for each row execute function privado.relatorio_execucoes_antes();

-- Auditoria: configuração dos relatórios (não nas execuções, que são o histórico).
create or replace trigger relatorios_salvos_auditoria_trg after insert or update or delete on public.relatorios_salvos
  for each row execute function privado.auditar();
create or replace trigger relatorio_agendamentos_auditoria_trg after insert or update or delete on public.relatorio_agendamentos
  for each row execute function privado.auditar();

-- -----------------------------------------------------------------------------
-- 10. RLS
-- -----------------------------------------------------------------------------
alter table public.relatorios_salvos enable row level security;
alter table public.relatorio_agendamentos enable row level security;
alter table public.relatorio_execucoes enable row level security;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relatorios_salvos' and policyname = 'relatorios_salvos_ler') then
    create policy relatorios_salvos_ler on public.relatorios_salvos for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.tem_permissao(organizacao_id, 'relatorios', 'ver')
             and privado.bi_pode_fonte(organizacao_id, fonte));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relatorios_salvos' and policyname = 'relatorios_salvos_gravar') then
    create policy relatorios_salvos_gravar on public.relatorios_salvos for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and privado.bi_pode_editar(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relatorios_salvos' and policyname = 'relatorios_salvos_alterar') then
    create policy relatorios_salvos_alterar on public.relatorios_salvos for update to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.bi_pode_editar(organizacao_id))
      with check (organizacao_id in (select privado.org_ids()) and privado.bi_pode_editar(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relatorios_salvos' and policyname = 'relatorios_salvos_apagar') then
    create policy relatorios_salvos_apagar on public.relatorios_salvos for delete to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.bi_pode_editar(organizacao_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relatorio_agendamentos' and policyname = 'relatorio_agendamentos_ler') then
    create policy relatorio_agendamentos_ler on public.relatorio_agendamentos for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.bi_pode_rodar(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relatorio_agendamentos' and policyname = 'relatorio_agendamentos_gravar') then
    create policy relatorio_agendamentos_gravar on public.relatorio_agendamentos for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and privado.bi_pode_agendar(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relatorio_agendamentos' and policyname = 'relatorio_agendamentos_alterar') then
    create policy relatorio_agendamentos_alterar on public.relatorio_agendamentos for update to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.bi_pode_agendar(organizacao_id))
      with check (organizacao_id in (select privado.org_ids()) and privado.bi_pode_agendar(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relatorio_agendamentos' and policyname = 'relatorio_agendamentos_apagar') then
    create policy relatorio_agendamentos_apagar on public.relatorio_agendamentos for delete to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.bi_pode_agendar(organizacao_id));
  end if;

  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'relatorio_execucoes' and policyname = 'relatorio_execucoes_ler') then
    create policy relatorio_execucoes_ler on public.relatorio_execucoes for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.bi_pode_rodar(organizacao_id));
  end if;
  -- relatorio_execucoes: sem policy de gravação (só a RPC relatorio_registrar_execucao grava).
end $$;

-- -----------------------------------------------------------------------------
-- 11. Agendamentos vencidos: o app "pega" (atômico) e gera em segundo plano
-- -----------------------------------------------------------------------------
/**
 * Devolve os agendamentos da organização que já venceram (até p_limite) e
 * avança a próxima execução de cada um ao mesmo tempo (duas abas não rodam o
 * mesmo envio). Com p_id: "rodar agora" um agendamento (exige poder programar
 * envios), sem mexer na próxima execução. Só quem vê relatórios e não é
 * corretor (o arquivo sai com os dados da imobiliária inteira); relatório
 * personalizado só é pego por quem vê o módulo da fonte dele (os outros
 * esperam alguém que possa). Marca ultima_em = agora: é a "vez" que libera
 * gravar o arquivo e registrar UMA execução (relatorio_registrar_execucao).
 */
create or replace function public.relatorio_agendamentos_vez(p_limite int default 3, p_id uuid default null)
returns setof public.relatorio_agendamentos
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
begin
  if v_org is null or auth.uid() is null or not privado.bi_pode_rodar(v_org) then
    return;
  end if;
  if p_id is not null then
    if not privado.bi_pode_agendar(v_org) then
      raise exception 'Seu perfil de acesso não permite rodar envios de relatórios.';
    end if;
    if exists (select 1 from public.relatorio_agendamentos x join public.relatorios_salvos r on r.id = x.relatorio_id
                where x.id = p_id and x.organizacao_id = v_org and not privado.bi_pode_fonte(v_org, r.fonte)) then
      raise exception 'Seu perfil de acesso não permite ver os dados deste relatório.';
    end if;
    return query
      update public.relatorio_agendamentos a set ultima_em = now()
       where a.id = p_id and a.organizacao_id = v_org
      returning a.*;
    return;
  end if;
  return query
    update public.relatorio_agendamentos a
       set ultima_em = now(),
           proxima_em = privado.bi_proxima_execucao(a.frequencia, a.dia_semana, a.dia_mes, a.hora, now())
     where a.id in (
       select x.id from public.relatorio_agendamentos x
        where x.organizacao_id = v_org and x.ativo and x.proxima_em is not null and x.proxima_em <= now()
          and (x.relatorio_id is null
               or exists (select 1 from public.relatorios_salvos r where r.id = x.relatorio_id and privado.bi_pode_fonte(v_org, r.fonte)))
        order by x.proxima_em
        limit least(greatest(coalesce(p_limite, 3), 1), 20)
        for update skip locked)
    returning a.*;
end;
$$;
revoke execute on function public.relatorio_agendamentos_vez(int, uuid) from public, anon;
grant execute on function public.relatorio_agendamentos_vez(int, uuid) to authenticated;

/**
 * Registra o resultado de um envio (a única forma de gravar em
 * relatorio_execucoes). Só vale logo depois da "vez" do agendamento
 * (relatorio_agendamentos_vez marcou ultima_em há menos de 30 minutos) e uma
 * vez só por vez; o arquivo precisa estar na pasta <org>/<agendamento>/;
 * nome, destinatários, quem e quando vêm do banco. p: {origem, status,
 * formato, linhas, resumo, arquivo_path, periodo, erro}.
 */
create or replace function public.relatorio_registrar_execucao(p_agendamento uuid, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  a public.relatorio_agendamentos%rowtype;
  v_origem text := coalesce(nullif(p ->> 'origem', ''), 'agendada');
  v_status text := p ->> 'status';
  v_formato text := nullif(p ->> 'formato', '');
  v_path text := nullif(p ->> 'arquivo_path', '');
  v_linhas int;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null or not privado.bi_pode_rodar(v_org) then
    raise exception 'Sem acesso aos envios de relatórios.';
  end if;
  select * into a from public.relatorio_agendamentos x where x.id = p_agendamento and x.organizacao_id = v_org for update;
  if not found then
    raise exception 'Envio não encontrado.';
  end if;
  if a.ultima_em is null or a.ultima_em < now() - interval '30 minutes' then
    raise exception 'Este envio não está sendo gerado agora.';
  end if;
  if exists (select 1 from public.relatorio_execucoes e where e.agendamento_id = a.id and e.data >= a.ultima_em) then
    raise exception 'Este envio já foi registrado.';
  end if;
  if v_origem not in ('agendada', 'manual') then
    raise exception 'Origem inválida.';
  end if;
  if v_origem = 'manual' and not privado.bi_pode_agendar(v_org) then
    raise exception 'Seu perfil de acesso não permite rodar envios de relatórios.';
  end if;
  if v_status is null or v_status not in ('enviado', 'pronto_para_enviar', 'erro') then
    raise exception 'Situação inválida.';
  end if;
  if v_status = 'enviado' and coalesce(array_length(a.emails, 1), 0) = 0 then
    raise exception 'Este envio não tem e-mail para onde ir.';
  end if;
  if v_formato is not null and v_formato not in ('csv', 'xls') then
    raise exception 'Formato inválido.';
  end if;
  if v_status <> 'erro' and v_path is null then
    raise exception 'Falta o arquivo gerado.';
  end if;
  if v_path is not null and (v_path not like v_org::text || '/' || a.id::text || '/%' or v_path like '%..%' or length(v_path) > 300) then
    raise exception 'Arquivo fora da pasta do envio.';
  end if;
  if coalesce(p ->> 'linhas', '') ~ '^\d{1,9}$' then
    v_linhas := (p ->> 'linhas')::int;
  end if;
  insert into public.relatorio_execucoes
    (organizacao_id, agendamento_id, nome, origem, status, formato, linhas, resumo, arquivo_path, destinatarios, erro, usuario_id, data)
  values
    (v_org, a.id, a.nome, v_origem, v_status, v_formato, v_linhas, left(p ->> 'resumo', 1000), v_path,
     jsonb_build_object('emails', to_jsonb(a.emails), 'whatsapps', to_jsonb(a.whatsapps), 'periodo', left(coalesce(p ->> 'periodo', ''), 120)),
     left(nullif(p ->> 'erro', ''), 1000), auth.uid(), now())
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.relatorio_registrar_execucao(uuid, jsonb) from public, anon;
grant execute on function public.relatorio_registrar_execucao(uuid, jsonb) to authenticated;

/**
 * Marca como apagados os arquivos de execuções (o app já tirou do Storage).
 * Quem programa envios marca qualquer um; quem só vê os envios, só os que
 * passaram do prazo de guarda (limpeza automática). Só marca o que de fato
 * saiu do Storage (quando ele existe neste banco). Devolve quantos marcou.
 */
create or replace function public.relatorio_marcar_arquivos_apagados(p_ids uuid[])
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_agendar boolean;
  v_ainda text[] := '{}';
  v_n int;
begin
  if v_org is null or auth.uid() is null or not privado.bi_pode_rodar(v_org) then
    raise exception 'Sem acesso aos envios de relatórios.';
  end if;
  if coalesce(array_length(p_ids, 1), 0) = 0 then
    return 0;
  end if;
  if array_length(p_ids, 1) > 500 then
    raise exception 'No máximo 500 arquivos de cada vez.';
  end if;
  v_agendar := privado.bi_pode_agendar(v_org);
  if to_regclass('storage.objects') is not null then
    execute $q$select coalesce(array_agg(o.name), '{}') from storage.objects o
                 join public.relatorio_execucoes e on e.arquivo_path = o.name
                where o.bucket_id = 'relatorios' and e.id = any($1) and e.organizacao_id = $2$q$
      into v_ainda using p_ids, v_org;
  end if;
  update public.relatorio_execucoes e
     set arquivo_apagado_em = now(), arquivo_apagado_por = auth.uid()
   where e.id = any (p_ids) and e.organizacao_id = v_org
     and e.arquivo_path is not null and e.arquivo_apagado_em is null
     and (v_agendar or e.data < now() - make_interval(days => privado.bi_dias_guarda()))
     and not (e.arquivo_path = any (v_ainda));
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;
revoke execute on function public.relatorio_marcar_arquivos_apagados(uuid[]) from public, anon;
grant execute on function public.relatorio_marcar_arquivos_apagados(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 12. Storage: bucket privado "relatorios" (<org>/<agendamento>/<arquivo>)
-- -----------------------------------------------------------------------------
/** Arquivo de relatório: pasta da própria organização e quem pode ver os envios. */
create or replace function privado.relatorios_arquivo_permitido(p_nome text)
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
  if coalesce(array_length(v, 1), 0) < 3 or v[1] !~ v_uuid or v[array_length(v, 1)] = '' or p_nome like '%..%' then
    return false;
  end if;
  return privado.bi_pode_rodar(v[1]::uuid);
end;
$$;
revoke execute on function privado.relatorios_arquivo_permitido(text) from public, anon;
grant execute on function privado.relatorios_arquivo_permitido(text) to authenticated;

/**
 * Gravar arquivo: só <org>/<agendamento>/<arquivo>, de um agendamento da
 * organização que está na "vez" (pego há menos de 30 minutos), por quem roda
 * os envios. Ninguém sobe arquivo solto na pasta.
 */
create or replace function privado.relatorios_arquivo_gravavel(p_nome text)
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
  if coalesce(array_length(v, 1), 0) <> 3 or v[1] !~ v_uuid or v[2] !~ v_uuid or v[3] = ''
     or p_nome like '%..%' or length(p_nome) > 300 then
    return false;
  end if;
  return privado.bi_pode_rodar(v[1]::uuid)
     and exists (select 1 from public.relatorio_agendamentos a
                  where a.id = v[2]::uuid and a.organizacao_id = v[1]::uuid
                    and a.ultima_em > now() - interval '30 minutes');
end;
$$;
revoke execute on function privado.relatorios_arquivo_gravavel(text) from public, anon;
grant execute on function privado.relatorios_arquivo_gravavel(text) to authenticated;

/**
 * Apagar arquivo: quem programa envios apaga qualquer um da organização; quem
 * só vê os envios apaga os que passaram do prazo de guarda (pela data da
 * execução que gerou o arquivo — limpeza automática).
 */
create or replace function privado.relatorios_arquivo_apagavel(p_nome text)
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
  if coalesce(array_length(v, 1), 0) < 3 or v[1] !~ v_uuid or v[array_length(v, 1)] = '' or p_nome like '%..%' then
    return false;
  end if;
  return privado.bi_pode_agendar(v[1]::uuid)
      or (privado.bi_pode_rodar(v[1]::uuid)
          and exists (select 1 from public.relatorio_execucoes e
                       where e.organizacao_id = v[1]::uuid and e.arquivo_path = p_nome
                         and e.data < now() - make_interval(days => privado.bi_dias_guarda())));
end;
$$;
revoke execute on function privado.relatorios_arquivo_apagavel(text) from public, anon;
grant execute on function privado.relatorios_arquivo_apagavel(text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('relatorios', 'relatorios', false, 20971520, array['text/csv', 'application/vnd.ms-excel', 'text/plain'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'relatorios_ler') then
      execute $p$create policy relatorios_ler on storage.objects for select to authenticated
        using (bucket_id = 'relatorios' and privado.relatorios_arquivo_permitido(name))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'relatorios_gravar') then
      execute $p$create policy relatorios_gravar on storage.objects for insert to authenticated
        with check (bucket_id = 'relatorios' and privado.relatorios_arquivo_gravavel(name))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'relatorios_apagar') then
      execute $p$create policy relatorios_apagar on storage.objects for delete to authenticated
        using (bucket_id = 'relatorios' and privado.relatorios_arquivo_apagavel(name))$p$;
    end if;
  end if;
end $$;
