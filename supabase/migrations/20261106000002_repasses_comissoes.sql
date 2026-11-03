-- =============================================================================
-- Repasses e comissões (só no modo imobiliária).
--
-- Repasses: aprovação (quem e quando), agendamento (data programada), pagamento
-- por Pix/transferência com comprovante, desconto automático das despesas
-- autorizadas (lancamentos.descontar_repasse) com rateio entre proprietários,
-- histórico de eventos (só leitura) e exigência opcional de aprovação.
--
-- Comissões: equipes, regras por tipo de negócio (venda, locação, angariação,
-- administração) por corretor/equipe/geral, comissões condicionadas ao
-- recebimento (ficam "previstas" até a imobiliária receber e voltam a prevista
-- se o recebimento for desfeito), divisão entre corretores, estornos e ajustes
-- com motivo (ajuste depois de paga conta sobre o valor efetivo: pago +
-- complementos − devoluções) e histórico (só leitura; quem grava é o banco).
--
-- Também: repasses.pagar_em (data agendada ou prevista, para Painel e
-- Financeiro), repasse cancelado/excluído cancela a comissão de administração
-- não paga, e public.juntar_pessoas é recriada levando comissões, regras,
-- equipes e históricos para o cadastro que fica.
--
-- O repasse continua nascendo na baixa da fatura (liquidar_fatura não muda).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Papel do usuário na organização (para as ações sensíveis)
-- -----------------------------------------------------------------------------
create or replace function privado.papel_atual(p_org uuid)
returns text
language sql stable security definer set search_path = ''
as $$
  select papel from public.membros where organizacao_id = p_org and user_id = auth.uid()
$$;
revoke execute on function privado.papel_atual(uuid) from public, anon;
grant execute on function privado.papel_atual(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Repasses: aprovação, agendamento e pagamento
-- -----------------------------------------------------------------------------
alter table public.repasses
  add column if not exists aprovado_em timestamptz,
  add column if not exists aprovado_por uuid,
  add column if not exists programado_para date,
  add column if not exists forma_pagamento text,
  add column if not exists comprovante_path text,
  add column if not exists pago_por uuid,
  add column if not exists cancelado_motivo text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'repasses_forma_pagamento_check') then
    alter table public.repasses add constraint repasses_forma_pagamento_check
      check (forma_pagamento is null or forma_pagamento in ('pix','transferencia','dinheiro','cheque','boleto','outro'));
  end if;
end $$;
create index if not exists repasses_programado_idx on public.repasses (organizacao_id, status, programado_para);
-- Data em que o repasse deve ser pago: a agendada (programado_para) ou, sem
-- agendamento, a prevista na baixa. É a coluna que Painel, Financeiro (contas a
-- pagar, fluxo de caixa) e Proprietários devem usar.
alter table public.repasses
  add column if not exists pagar_em date generated always as (coalesce(programado_para, previsto_para)) stored;
create index if not exists repasses_pagar_em_idx on public.repasses (organizacao_id, status, pagar_em);

-- Se ligado, repasse só pode ser pago depois de aprovado (admin, gestor ou financeiro).
alter table public.organizacoes add column if not exists repasse_exige_aprovacao boolean not null default false;

-- Despesa autorizada: de qual proprietário descontar (vazio = todos do imóvel, pela participação).
alter table public.lancamentos add column if not exists descontar_de_id uuid references public.pessoas(id) on delete set null;

-- Descontos aplicados em cada repasse (despesas autorizadas e ajustes).
create table if not exists public.repasse_descontos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  repasse_id uuid not null references public.repasses(id) on delete cascade,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  tipo text not null default 'despesa' check (tipo in ('despesa','ajuste')),
  descricao text not null,
  valor numeric(14,2) not null check (valor > 0),
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists repasse_descontos_repasse_idx on public.repasse_descontos (repasse_id);
create index if not exists repasse_descontos_lanc_idx on public.repasse_descontos (lancamento_id);

-- Histórico do repasse (gravado pelo banco; não se altera nem se apaga).
create table if not exists public.repasse_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  repasse_id uuid not null,
  contrato_id uuid,
  pessoa_id uuid,
  tipo text not null,
  descricao text,
  valor numeric(14,2),
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index if not exists repasse_eventos_repasse_idx on public.repasse_eventos (repasse_id, data desc);
create index if not exists repasse_eventos_data_idx on public.repasse_eventos (organizacao_id, data desc);

/**
 * O repasse tem despesa autorizada do imóvel ainda por descontar deste
 * proprietário? (despesa só dele, ou rateada e ainda sem nenhum desconto dele).
 * Repasse zerado não tem de onde descontar.
 */
create or replace function privado.repasse_tem_despesa_a_descontar(p_id uuid)
returns boolean
language sql stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.repasses r
      join public.contratos ct on ct.id = r.contrato_id
      join public.lancamentos l on l.organizacao_id = r.organizacao_id and l.imovel_id = ct.imovel_id
     where r.id = p_id
       and r.valor_liquido > 0
       and l.descontar_repasse and l.repasse_id is null and l.status <> 'cancelado'
       and (
         l.descontar_de_id = r.pessoa_id
         or (l.descontar_de_id is null
             and exists (select 1 from public.contrato_partes cp
                          where cp.contrato_id = r.contrato_id and cp.pessoa_id = r.pessoa_id
                            and cp.papel = 'proprietario' and coalesce(cp.percentual, 0) > 0)
             and not exists (select 1 from public.repasse_descontos d join public.repasses x on x.id = d.repasse_id
                              where d.lancamento_id = l.id and x.pessoa_id = r.pessoa_id))
       )
  )
$$;
revoke execute on function privado.repasse_tem_despesa_a_descontar(uuid) from public, anon;
grant execute on function privado.repasse_tem_despesa_a_descontar(uuid) to authenticated;

-- Antes de gravar: pagamento exige aprovação (se a imobiliária ligou) ou aprova junto.
-- Sem aprovação, só paga direto se não houver despesa autorizada a descontar
-- (senão o desconto nunca aconteceria): a tela de Repasses aprova sozinha
-- (com o desconto) antes de pagar; a conciliação do extrato recebe o aviso.
create or replace function privado.validar_repasse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'pago' and old.status is distinct from 'pago' then
    if new.aprovado_em is null then
      if coalesce((select repasse_exige_aprovacao from public.organizacoes where id = new.organizacao_id), false) then
        raise exception 'Este repasse precisa ser aprovado (administrador, gestor ou financeiro) antes do pagamento.';
      end if;
      if privado.repasse_tem_despesa_a_descontar(new.id) then
        raise exception 'Este repasse tem despesa autorizada do imóvel a descontar: aprove o repasse em Repasses (o desconto entra na aprovação) e depois registre o pagamento.';
      end if;
      new.aprovado_em := now();
      new.aprovado_por := auth.uid();
    end if;
    new.pago_em := coalesce(new.pago_em, current_date);
    new.pago_por := coalesce(new.pago_por, auth.uid());
  end if;
  return new;
end;
$$;
drop trigger if exists repasses_validar_trg on public.repasses;
create trigger repasses_validar_trg before update on public.repasses
  for each row execute function privado.validar_repasse();

-- Depois de gravar: registra o que aconteceu no histórico.
create or replace function privado.registrar_evento_repasse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_txt text;
  r public.repasses%rowtype;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  if tg_op = 'INSERT' then
    insert into public.repasse_eventos (organizacao_id, repasse_id, contrato_id, pessoa_id, tipo, descricao, valor)
    values (r.organizacao_id, r.id, r.contrato_id, r.pessoa_id, 'criado', 'Repasse gerado', r.valor_liquido);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.repasse_eventos (organizacao_id, repasse_id, contrato_id, pessoa_id, tipo, descricao, valor)
    values (r.organizacao_id, r.id, r.contrato_id, r.pessoa_id, 'excluido', 'Repasse excluído', r.valor_liquido);
    return old;
  end if;

  if new.outros_descontos is distinct from old.outros_descontos then
    v_txt := case
      when new.observacoes is distinct from old.observacoes and old.observacoes is not null and left(new.observacoes, length(old.observacoes)) = old.observacoes
        then nullif(btrim(substr(new.observacoes, length(old.observacoes) + 1), ' ·'), '')
      when new.observacoes is distinct from old.observacoes then new.observacoes
    end;
    insert into public.repasse_eventos (organizacao_id, repasse_id, contrato_id, pessoa_id, tipo, descricao, valor)
    values (r.organizacao_id, r.id, r.contrato_id, r.pessoa_id,
            case when new.outros_descontos > old.outros_descontos then 'desconto' else 'desconto_devolvido' end,
            coalesce(v_txt, 'Desconto no repasse'), abs(new.outros_descontos - old.outros_descontos));
  elsif new.valor_liquido is distinct from old.valor_liquido then
    insert into public.repasse_eventos (organizacao_id, repasse_id, contrato_id, pessoa_id, tipo, descricao, valor)
    values (r.organizacao_id, r.id, r.contrato_id, r.pessoa_id, 'valor_alterado', 'Valor líquido alterado', new.valor_liquido);
  end if;

  if old.aprovado_em is null and new.aprovado_em is not null and new.status = 'pendente' then
    insert into public.repasse_eventos (organizacao_id, repasse_id, contrato_id, pessoa_id, tipo, descricao, valor)
    values (r.organizacao_id, r.id, r.contrato_id, r.pessoa_id, 'aprovado',
            'Aprovado para pagar em ' || to_char(coalesce(new.programado_para, new.previsto_para), 'DD/MM/YYYY'), new.valor_liquido);
  elsif old.aprovado_em is not null and new.aprovado_em is null then
    insert into public.repasse_eventos (organizacao_id, repasse_id, contrato_id, pessoa_id, tipo, descricao)
    values (r.organizacao_id, r.id, r.contrato_id, r.pessoa_id, 'aprovacao_desfeita', 'Aprovação desfeita');
  elsif new.aprovado_em is not null and old.aprovado_em is not null and new.programado_para is distinct from old.programado_para then
    insert into public.repasse_eventos (organizacao_id, repasse_id, contrato_id, pessoa_id, tipo, descricao)
    values (r.organizacao_id, r.id, r.contrato_id, r.pessoa_id, 'agendado', 'Pagamento agendado para ' || to_char(new.programado_para, 'DD/MM/YYYY'));
  end if;

  if new.status is distinct from old.status then
    insert into public.repasse_eventos (organizacao_id, repasse_id, contrato_id, pessoa_id, tipo, descricao, valor)
    values (r.organizacao_id, r.id, r.contrato_id, r.pessoa_id,
            case
              when new.status = 'pago' then 'pago'
              when new.status = 'cancelado' then 'cancelado'
              when old.status = 'pago' then 'pagamento_desfeito'
              else 'reaberto'
            end,
            case
              when new.status = 'pago' then concat_ws(' · ', 'Pago em ' || to_char(new.pago_em, 'DD/MM/YYYY'),
                   case new.forma_pagamento when 'pix' then 'Pix' when 'transferencia' then 'transferência' else new.forma_pagamento end,
                   nullif(new.comprovante, ''))
              when new.status = 'cancelado' then coalesce('Cancelado: ' || new.cancelado_motivo, 'Cancelado')
              when old.status = 'pago' then 'Pagamento desfeito'
              else 'Reaberto'
            end,
            new.valor_liquido);
  end if;

  if old.conciliado_em is null and new.conciliado_em is not null then
    insert into public.repasse_eventos (organizacao_id, repasse_id, contrato_id, pessoa_id, tipo, descricao)
    values (r.organizacao_id, r.id, r.contrato_id, r.pessoa_id, 'conciliado', 'Conciliado com o extrato do banco');
  end if;
  return new;
end;
$$;
drop trigger if exists repasses_eventos_trg on public.repasses;
create trigger repasses_eventos_trg after insert or update or delete on public.repasses
  for each row execute function privado.registrar_evento_repasse();

/**
 * Aprova o repasse (admin, gestor ou financeiro), agenda a data de pagamento e
 * desconta as despesas autorizadas. O cálculo do quanto descontar de cada
 * despesa (rateio entre proprietários) vem da aplicação (src/lib/dominio/repasses.ts);
 * aqui o banco confere e grava tudo de uma vez.
 * p: { programado_para?, descontos: [{lancamento_id, valor, descricao?}] }
 */
create or replace function public.aprovar_repasse(p_id uuid, p jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.repasses%rowtype;
  l public.lancamentos%rowtype;
  d jsonb;
  v_val numeric(14,2);
  v_ja numeric(14,2);
  v_total numeric(14,2) := 0;
  v_imovel uuid;
  v_obs text[] := '{}';
begin
  select * into r from public.repasses where id = p_id for update;
  if not found then raise exception 'Repasse não encontrado.'; end if;
  if coalesce(privado.papel_atual(r.organizacao_id), '') not in ('admin','gestor','financeiro') then
    raise exception 'Só administrador, gestor ou financeiro aprovam repasses.';
  end if;
  if r.status <> 'pendente' then raise exception 'Só repasses pendentes podem ser aprovados.'; end if;
  if r.aprovado_em is not null then raise exception 'Este repasse já foi aprovado.'; end if;
  select imovel_id into v_imovel from public.contratos where id = r.contrato_id;

  for d in select * from jsonb_array_elements(coalesce(p->'descontos', '[]'::jsonb)) loop
    v_val := round((d->>'valor')::numeric, 2);
    if v_val is null or v_val <= 0 then raise exception 'Valor de desconto inválido.'; end if;
    select * into l from public.lancamentos where id = (d->>'lancamento_id')::uuid for update;
    if not found or not l.descontar_repasse or l.organizacao_id <> r.organizacao_id then
      raise exception 'Despesa a descontar não encontrada.';
    end if;
    if l.status = 'cancelado' then raise exception 'A despesa "%" foi cancelada.', l.descricao; end if;
    if l.repasse_id is not null then raise exception 'A despesa "%" já foi descontada.', l.descricao; end if;
    if l.imovel_id is distinct from v_imovel then raise exception 'A despesa "%" é de outro imóvel.', l.descricao; end if;
    if l.descontar_de_id is not null and l.descontar_de_id <> r.pessoa_id then
      raise exception 'A despesa "%" é de outro proprietário.', l.descricao;
    end if;
    select coalesce(sum(valor), 0) into v_ja from public.repasse_descontos where lancamento_id = l.id;
    if v_ja + v_val > l.valor then raise exception 'O desconto passa do valor da despesa "%".', l.descricao; end if;
    insert into public.repasse_descontos (organizacao_id, repasse_id, lancamento_id, tipo, descricao, valor)
    values (r.organizacao_id, r.id, l.id, 'despesa', coalesce(nullif(d->>'descricao', ''), l.descricao), v_val);
    if v_ja + v_val >= l.valor then
      update public.lancamentos set repasse_id = r.id where id = l.id;
    end if;
    v_total := v_total + v_val;
    v_obs := v_obs || ('Despesa descontada: ' || l.descricao);
  end loop;
  if v_total > r.valor_liquido then raise exception 'Os descontos passam do valor do repasse.'; end if;

  update public.repasses set
    outros_descontos = outros_descontos + v_total,
    valor_liquido = valor_liquido - v_total,
    observacoes = case when v_total > 0 then concat_ws(' · ', nullif(observacoes, ''), array_to_string(v_obs, ' · ')) else observacoes end,
    aprovado_em = now(),
    aprovado_por = auth.uid(),
    programado_para = coalesce((p->>'programado_para')::date, programado_para, previsto_para)
  where id = r.id;
end;
$$;
revoke execute on function public.aprovar_repasse(uuid, jsonb) from public, anon;
grant execute on function public.aprovar_repasse(uuid, jsonb) to authenticated;

-- Devolve ao repasse as despesas descontadas na aprovação (elas voltam a ficar "a descontar").
create or replace function privado.devolver_descontos_repasse(p_id uuid)
returns numeric
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_total numeric(14,2);
begin
  select coalesce(sum(valor), 0) into v_total from public.repasse_descontos where repasse_id = p_id and tipo = 'despesa';
  if v_total = 0 then return 0; end if;
  update public.lancamentos set repasse_id = null
   where id in (select lancamento_id from public.repasse_descontos where repasse_id = p_id and tipo = 'despesa' and lancamento_id is not null);
  delete from public.repasse_descontos where repasse_id = p_id and tipo = 'despesa';
  update public.repasses set
    outros_descontos = outros_descontos - v_total,
    valor_liquido = valor_liquido + v_total,
    observacoes = concat_ws(' · ', nullif(observacoes, ''), 'Despesas devolvidas (voltam a ficar a descontar)')
  where id = p_id;
  return v_total;
end;
$$;
revoke execute on function privado.devolver_descontos_repasse(uuid) from public, anon;
grant execute on function privado.devolver_descontos_repasse(uuid) to authenticated;

create or replace function public.desfazer_aprovacao_repasse(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.repasses%rowtype;
begin
  select * into r from public.repasses where id = p_id for update;
  if not found then raise exception 'Repasse não encontrado.'; end if;
  if coalesce(privado.papel_atual(r.organizacao_id), '') not in ('admin','gestor','financeiro') then
    raise exception 'Só administrador, gestor ou financeiro mexem na aprovação.';
  end if;
  if r.status <> 'pendente' or r.aprovado_em is null then raise exception 'Só repasses aprovados e ainda não pagos.'; end if;
  perform privado.devolver_descontos_repasse(r.id);
  update public.repasses set aprovado_em = null, aprovado_por = null where id = r.id;
end;
$$;
revoke execute on function public.desfazer_aprovacao_repasse(uuid) from public, anon;
grant execute on function public.desfazer_aprovacao_repasse(uuid) to authenticated;

create or replace function public.cancelar_repasse(p_id uuid, p_motivo text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.repasses%rowtype;
begin
  select * into r from public.repasses where id = p_id for update;
  if not found then raise exception 'Repasse não encontrado.'; end if;
  if coalesce(privado.papel_atual(r.organizacao_id), '') not in ('admin','gestor','financeiro') then
    raise exception 'Só administrador, gestor ou financeiro cancelam repasses.';
  end if;
  if r.status <> 'pendente' then raise exception 'Só repasses pendentes podem ser cancelados.'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo do cancelamento.'; end if;
  perform privado.devolver_descontos_repasse(r.id);
  update public.repasses set status = 'cancelado', cancelado_motivo = btrim(p_motivo), aprovado_em = null, aprovado_por = null where id = r.id;
end;
$$;
revoke execute on function public.cancelar_repasse(uuid, text) from public, anon;
grant execute on function public.cancelar_repasse(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Comissões: equipes, regras, comissões e histórico
-- -----------------------------------------------------------------------------
create table if not exists public.equipes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  lider_id uuid references public.pessoas(id) on delete set null,
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.equipe_membros (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  equipe_id uuid not null references public.equipes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  unique (pessoa_id)
);
create index if not exists equipe_membros_equipe_idx on public.equipe_membros (equipe_id);

create table if not exists public.comissao_regras (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text,
  tipo text not null check (tipo in ('venda','locacao','angariacao','administracao')),
  equipe_id uuid references public.equipes(id) on delete cascade,
  pessoa_id uuid references public.pessoas(id) on delete cascade,
  percentual numeric(7,3) not null check (percentual >= 0 and percentual <= 100),
  condicionada boolean not null default false,
  dias_pagamento int not null default 30 check (dias_pagamento between 0 and 365),
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists comissao_regras_tipo_idx on public.comissao_regras (organizacao_id, tipo);

create table if not exists public.comissoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete restrict,
  tipo text not null check (tipo in ('venda','locacao','angariacao','administracao','outro')),
  papel text,
  descricao text not null,
  base numeric(14,2),
  percentual numeric(7,3),
  valor numeric(14,2) not null check (valor >= 0),
  valor_original numeric(14,2) not null default 0,
  status text not null default 'prevista' check (status in ('prevista','a_pagar','paga','estornada','cancelada')),
  condicionada boolean not null default false,
  dias_pagamento int not null default 30 check (dias_pagamento between 0 and 365),
  previsao date,
  liberada_em date,
  vencimento date,
  motivo text,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  devolucao_lancamento_id uuid references public.lancamentos(id) on delete set null,
  regra_id uuid references public.comissao_regras(id) on delete set null,
  equipe_id uuid references public.equipes(id) on delete set null,
  venda_id uuid references public.vendas(id) on delete set null,
  venda_comissao_id uuid references public.venda_comissoes(id) on delete set null,
  proposta_id uuid references public.propostas(id) on delete set null,
  contrato_id uuid references public.contratos(id) on delete set null,
  repasse_id uuid references public.repasses(id) on delete set null,
  imovel_id uuid references public.imoveis(id) on delete set null,
  origem_id uuid references public.comissoes(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists comissoes_pessoa_idx on public.comissoes (organizacao_id, pessoa_id, status);
create index if not exists comissoes_status_idx on public.comissoes (organizacao_id, status);
create index if not exists comissoes_venda_idx on public.comissoes (venda_id);
create index if not exists comissoes_imovel_idx on public.comissoes (imovel_id) where status = 'prevista';
create index if not exists comissoes_lancamento_idx on public.comissoes (lancamento_id);
-- Complemento de um ajuste feito depois de paga (aponta para a comissão ajustada).
alter table public.comissoes add column if not exists ajuste_de uuid references public.comissoes(id) on delete set null;
-- Fatura de aluguel cujo pagamento liberou a comissão condicionada (desfazer a baixa devolve para "prevista").
alter table public.comissoes add column if not exists fatura_id uuid references public.faturas(id) on delete set null;
-- O que gerou a comissão automaticamente (ex.: 'adm:<contrato>:<AAAA-MM>:<proprietário>'), para não gerar duas vezes.
alter table public.comissoes add column if not exists origem_chave text;
create index if not exists comissoes_ajuste_de_idx on public.comissoes (ajuste_de) where ajuste_de is not null;
create index if not exists comissoes_fatura_idx on public.comissoes (fatura_id) where fatura_id is not null;
create index if not exists comissoes_repasse_idx on public.comissoes (repasse_id) where repasse_id is not null;
-- Uma comissão por origem (cancelada ou estornada libera gerar de novo). Complementos e
-- divisões não têm origem_chave, então não batem aqui.
drop index if exists public.comissoes_adm_unica;
create unique index if not exists comissoes_origem_unica on public.comissoes (organizacao_id, origem_chave)
  where origem_chave is not null and status not in ('cancelada','estornada');
-- Devolução do corretor (conta a receber) criada por estorno ou ajuste para menos.
alter table public.lancamentos add column if not exists comissao_devolucao_id uuid references public.comissoes(id) on delete set null;
create index if not exists lancamentos_comissao_devolucao_idx on public.lancamentos (comissao_devolucao_id) where comissao_devolucao_id is not null;

create table if not exists public.comissao_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  comissao_id uuid not null,
  pessoa_id uuid,
  tipo text not null,
  descricao text,
  valor numeric(14,2),
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index if not exists comissao_eventos_idx on public.comissao_eventos (comissao_id, data desc);
create index if not exists comissao_eventos_data_idx on public.comissao_eventos (organizacao_id, data desc);

-- RLS por organização --------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['repasse_descontos','equipes','equipe_membros','comissao_regras','comissoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (organizacao_id in (select privado.org_ids()))
      with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
  end loop;
  -- Históricos: só leitura pela API. Quem grava é o banco (gatilhos e funções
  -- SECURITY DEFINER), então ninguém acrescenta, altera ou apaga evento à mão.
  foreach t in array array['repasse_eventos','comissao_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format('drop policy if exists %I on public.%I', t || '_ler', t);
    execute format('drop policy if exists %I on public.%I', t || '_inserir', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (organizacao_id in (select privado.org_ids()))$p$, t || '_ler', t);
  end loop;
end $$;

-- Regra de administração não espera recebimento: a taxa já foi recebida na baixa do aluguel.
update public.comissao_regras set condicionada = false where tipo = 'administracao' and condicionada;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'comissao_regras_adm_sem_condicao') then
    alter table public.comissao_regras add constraint comissao_regras_adm_sem_condicao
      check (tipo <> 'administracao' or not condicionada);
  end if;
end $$;

-- Regra que vale para a pessoa: a do corretor > a da equipe dele > a geral (a mais nova).
create or replace function privado.regra_comissao(p_org uuid, p_tipo text, p_pessoa uuid)
returns public.comissao_regras
language sql stable
set search_path = public
as $$
  select r.* from public.comissao_regras r
   where r.organizacao_id = p_org and r.tipo = p_tipo and r.ativa
     and (r.pessoa_id = p_pessoa
          or (r.pessoa_id is null and r.equipe_id is not null
              and r.equipe_id = (select m.equipe_id from public.equipe_membros m where m.pessoa_id = p_pessoa))
          or (r.pessoa_id is null and r.equipe_id is null))
   order by (r.pessoa_id is not null) desc, (r.equipe_id is not null) desc, r.created_at desc, r.id
   limit 1
$$;
revoke execute on function privado.regra_comissao(uuid, text, uuid) from public, anon;
grant execute on function privado.regra_comissao(uuid, text, uuid) to authenticated;

-- Libera a comissão: vira conta a pagar no financeiro (categoria "Comissões").
create or replace function privado.lancar_comissao(p_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.comissoes%rowtype;
  v_lanc uuid;
begin
  select * into c from public.comissoes where id = p_id for update;
  if not found then raise exception 'Comissão não encontrada.'; end if;
  if c.status <> 'prevista' then raise exception 'Esta comissão não está prevista.'; end if;
  if c.valor <= 0 then
    update public.comissoes set status = 'cancelada', motivo = coalesce(motivo, 'Valor zerado') where id = c.id;
    return null;
  end if;
  insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status,
                                  pessoa_id, imovel_id, proposta_id, venda_id, contrato_id)
  values (c.organizacao_id, 'pagar', c.descricao, 'Comissões', c.valor, current_date + c.dias_pagamento, 'aberto',
          c.pessoa_id, c.imovel_id, c.proposta_id, c.venda_id, c.contrato_id)
  returning id into v_lanc;
  update public.comissoes
     set status = 'a_pagar', lancamento_id = v_lanc, liberada_em = current_date, vencimento = current_date + c.dias_pagamento
   where id = c.id;
  if c.venda_comissao_id is not null then
    update public.venda_comissoes set lancamento_id = v_lanc where id = c.venda_comissao_id;
  end if;
  return v_lanc;
end;
$$;
revoke execute on function privado.lancar_comissao(uuid) from public, anon;
grant execute on function privado.lancar_comissao(uuid) to authenticated;

-- Cria uma comissão pela regra; sem condição, já vira conta a pagar.
create or replace function privado.criar_comissao(
  p_org uuid, p_pessoa uuid, p_tipo text, p_papel text, p_descricao text, p_base numeric, p_pct numeric,
  p_valor numeric, p_regra public.comissao_regras, p_venda uuid, p_venda_comissao uuid, p_proposta uuid,
  p_contrato uuid, p_repasse uuid, p_imovel uuid
) returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_id uuid;
  v_cond boolean := coalesce(p_regra.condicionada, false);
  v_dias int := coalesce(p_regra.dias_pagamento, 30);
begin
  insert into public.comissoes (organizacao_id, pessoa_id, tipo, papel, descricao, base, percentual, valor, valor_original,
                                status, condicionada, dias_pagamento, previsao, regra_id, equipe_id,
                                venda_id, venda_comissao_id, proposta_id, contrato_id, repasse_id, imovel_id)
  values (p_org, p_pessoa, p_tipo, p_papel, p_descricao, p_base, p_pct, p_valor, p_valor,
          'prevista', v_cond, v_dias, current_date + v_dias, p_regra.id,
          (select m.equipe_id from public.equipe_membros m where m.pessoa_id = p_pessoa),
          p_venda, p_venda_comissao, p_proposta, p_contrato, p_repasse, p_imovel)
  returning id into v_id;
  if not v_cond then perform privado.lancar_comissao(v_id); end if;
  return v_id;
end;
$$;
revoke execute on function privado.criar_comissao(uuid, uuid, text, text, text, numeric, numeric, numeric, public.comissao_regras, uuid, uuid, uuid, uuid, uuid, uuid) from public, anon;
grant execute on function privado.criar_comissao(uuid, uuid, text, text, text, numeric, numeric, numeric, public.comissao_regras, uuid, uuid, uuid, uuid, uuid, uuid) to authenticated;

-- Histórico da comissão (gravado pelo banco).
create or replace function privado.registrar_evento_comissao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.comissoes%rowtype;
begin
  if tg_op = 'DELETE' then c := old; else c := new; end if;
  if tg_op = 'INSERT' then
    insert into public.comissao_eventos (organizacao_id, comissao_id, pessoa_id, tipo, descricao, valor)
    values (c.organizacao_id, c.id, c.pessoa_id, 'criada',
            case when c.condicionada then 'Comissão prevista (paga só depois que a imobiliária receber)' else 'Comissão criada' end, c.valor);
    return new;
  elsif tg_op = 'DELETE' then
    insert into public.comissao_eventos (organizacao_id, comissao_id, pessoa_id, tipo, descricao, valor)
    values (c.organizacao_id, c.id, c.pessoa_id, 'excluida', 'Comissão excluída: ' || c.descricao, c.valor);
    return old;
  end if;
  if new.valor is distinct from old.valor then
    insert into public.comissao_eventos (organizacao_id, comissao_id, pessoa_id, tipo, descricao, valor)
    values (c.organizacao_id, c.id, c.pessoa_id, 'ajuste',
            'Valor ajustado (antes R$ ' || replace(to_char(old.valor, 'FM999999990.00'), '.', ',') || ')' || coalesce(': ' || new.motivo, ''), new.valor);
  end if;
  if new.pessoa_id is distinct from old.pessoa_id then
    insert into public.comissao_eventos (organizacao_id, comissao_id, pessoa_id, tipo, descricao, valor)
    values (c.organizacao_id, c.id, c.pessoa_id, 'transferida', 'Comissão passada para outra pessoa', new.valor);
  end if;
  if new.status is distinct from old.status then
    insert into public.comissao_eventos (organizacao_id, comissao_id, pessoa_id, tipo, descricao, valor)
    values (c.organizacao_id, c.id, c.pessoa_id,
            case
              when new.status = 'a_pagar' and old.status = 'prevista' then 'liberada'
              when new.status = 'a_pagar' then 'pagamento_desfeito'
              when new.status = 'prevista' then 'voltou_prevista'
              else new.status
            end,
            case
              when new.status = 'a_pagar' and old.status = 'prevista' then 'Liberada: virou conta a pagar'
              when new.status = 'a_pagar' then 'Pagamento desfeito no financeiro'
              when new.status = 'prevista' then 'Voltou a prevista' || coalesce(': ' || new.motivo, '')
              when new.status = 'paga' then 'Paga'
              when new.status = 'estornada' then 'Estornada' || coalesce(': ' || new.motivo, '')
              when new.status = 'cancelada' then 'Cancelada' || coalesce(': ' || new.motivo, '')
              else new.status
            end,
            new.valor);
  end if;
  return new;
end;
$$;
drop trigger if exists comissoes_eventos_trg on public.comissoes;
create trigger comissoes_eventos_trg after insert or update or delete on public.comissoes
  for each row execute function privado.registrar_evento_comissao();

/**
 * Anota um evento no histórico da comissão (o histórico não aceita gravação
 * direta pela API). Só para comissões da organização de quem chama, e só por
 * administrador, gestor ou financeiro.
 */
create or replace function privado.anotar_evento_comissao(p_comissao uuid, p_tipo text, p_descricao text, p_valor numeric)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.comissoes%rowtype;
begin
  select * into c from public.comissoes where id = p_comissao;
  if not found or c.organizacao_id not in (select privado.org_ids()) then raise exception 'Comissão não encontrada.'; end if;
  if coalesce(privado.papel_atual(c.organizacao_id), '') not in ('admin','gestor','financeiro') then
    raise exception 'Só administrador, gestor ou financeiro podem fazer isso.';
  end if;
  insert into public.comissao_eventos (organizacao_id, comissao_id, pessoa_id, tipo, descricao, valor)
  values (c.organizacao_id, c.id, c.pessoa_id, p_tipo, p_descricao, p_valor);
end;
$$;
revoke execute on function privado.anotar_evento_comissao(uuid, text, text, numeric) from public, anon;
grant execute on function privado.anotar_evento_comissao(uuid, text, text, numeric) to authenticated;

/**
 * Comissão liberada pelo recebimento volta a "prevista" (o recebimento foi
 * desfeito): a conta a pagar em aberto é cancelada no financeiro. Paga não volta.
 */
create or replace function privado.voltar_comissao_prevista(p_id uuid, p_motivo text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.comissoes%rowtype;
begin
  select * into c from public.comissoes where id = p_id for update;
  if not found or c.status <> 'a_pagar' then return; end if;
  update public.comissoes
     set status = 'prevista', lancamento_id = null, liberada_em = null, vencimento = null, fatura_id = null, motivo = p_motivo
   where id = c.id;
  if c.lancamento_id is not null then
    update public.lancamentos set status = 'cancelado', cancelado_motivo = 'Comissão voltou a prevista: ' || p_motivo
     where id = c.lancamento_id and status = 'aberto';
  end if;
  if c.venda_comissao_id is not null then
    update public.venda_comissoes set lancamento_id = null where id = c.venda_comissao_id and lancamento_id = c.lancamento_id;
  end if;
end;
$$;
revoke execute on function privado.voltar_comissao_prevista(uuid, text) from public, anon;
grant execute on function privado.voltar_comissao_prevista(uuid, text) to authenticated;

-- Financeiro → comissão: pago/estornado/cancelado no lançamento muda a comissão;
-- receber a comissão da venda libera as comissões condicionadas dela, e desfazer
-- esse recebimento devolve para "prevista" as que ainda não foram pagas.
create or replace function privado.sincronizar_comissoes_lancamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_venda uuid;
begin
  if new.status is not distinct from old.status then return new; end if;
  if new.tipo = 'pagar' then
    if new.status = 'liquidado' then
      update public.comissoes set status = 'paga' where lancamento_id = new.id and status = 'a_pagar';
    elsif new.status = 'aberto' and old.status = 'liquidado' then
      update public.comissoes set status = 'a_pagar' where lancamento_id = new.id and status = 'paga';
    elsif new.status = 'cancelado' then
      update public.comissoes set status = 'cancelada', motivo = coalesce(new.cancelado_motivo, 'Cancelada no financeiro')
       where lancamento_id = new.id and status = 'a_pagar';
    end if;
  elsif new.tipo = 'receber' then
    select v.id into v_venda from public.vendas v where v.lancamento_receber_id = new.id limit 1;
    if v_venda is null then return new; end if;
    if new.status = 'liquidado' then
      for v_id in select c.id from public.comissoes c
                   where c.venda_id = v_venda and c.status = 'prevista' and c.condicionada
                   order by c.created_at loop
        perform privado.lancar_comissao(v_id);
      end loop;
    elsif old.status = 'liquidado' then
      for v_id in select c.id from public.comissoes c
                   where c.venda_id = v_venda and c.status = 'a_pagar' and c.condicionada
                   order by c.created_at loop
        perform privado.voltar_comissao_prevista(v_id, 'recebimento da comissão da venda desfeito');
      end loop;
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists lancamentos_comissoes_trg on public.lancamentos;
create trigger lancamentos_comissoes_trg after update of status on public.lancamentos
  for each row execute function privado.sincronizar_comissoes_lancamento();

-- Lançamento de comissão excluído no financeiro: a comissão fica cancelada.
create or replace function privado.comissao_lancamento_excluido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.comissoes set status = 'cancelada', motivo = 'Lançamento excluído no financeiro'
   where lancamento_id = old.id and status = 'a_pagar';
  return old;
end;
$$;
drop trigger if exists lancamentos_comissoes_del_trg on public.lancamentos;
create trigger lancamentos_comissoes_del_trg before delete on public.lancamentos
  for each row execute function privado.comissao_lancamento_excluido();

/**
 * Aluguel recebido: libera as comissões de locação/angariação condicionadas do
 * imóvel que vieram de uma proposta aceita (comissão avulsa "prevista" só sai
 * quando alguém libera). Baixa desfeita: as liberadas por esta fatura e ainda
 * não pagas voltam a "prevista".
 */
create or replace function privado.liberar_comissoes_aluguel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_imovel uuid;
  v_id uuid;
begin
  if old.status = 'paga' and new.status is distinct from 'paga' then
    for v_id in select c.id from public.comissoes c
                 where c.fatura_id = new.id and c.status = 'a_pagar' and c.condicionada
                 order by c.created_at loop
      perform privado.voltar_comissao_prevista(v_id, 'pagamento do aluguel desfeito');
    end loop;
    return new;
  end if;
  if new.status <> 'paga' or old.status = 'paga' then return new; end if;
  select imovel_id into v_imovel from public.contratos where id = new.contrato_id;
  if v_imovel is null then return new; end if;
  for v_id in select c.id from public.comissoes c
               where c.organizacao_id = new.organizacao_id and c.imovel_id = v_imovel and c.status = 'prevista'
                 and c.condicionada and c.tipo in ('locacao','angariacao') and c.venda_id is null
                 and c.proposta_id is not null
               order by c.created_at loop
    update public.comissoes set contrato_id = coalesce(contrato_id, new.contrato_id), fatura_id = new.id where id = v_id;
    perform privado.lancar_comissao(v_id);
  end loop;
  return new;
end;
$$;
drop trigger if exists faturas_comissoes_trg on public.faturas;
create trigger faturas_comissoes_trg after update of status on public.faturas
  for each row execute function privado.liberar_comissoes_aluguel();

-- Venda, proposta ou divisão excluída: comissões ainda não pagas saem junto
-- (as pagas ficam, para o histórico do corretor).
create or replace function privado.apagar_comissoes_pendentes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_table_name = 'vendas' then
    delete from public.comissoes where venda_id = old.id and status in ('prevista','a_pagar','cancelada');
  elsif tg_table_name = 'propostas' then
    delete from public.comissoes where proposta_id = old.id and status in ('prevista','a_pagar','cancelada');
  elsif tg_table_name = 'venda_comissoes' then
    delete from public.comissoes where venda_comissao_id = old.id and status in ('prevista','cancelada');
  end if;
  return old;
end;
$$;
drop trigger if exists vendas_comissoes_del_trg on public.vendas;
create trigger vendas_comissoes_del_trg before delete on public.vendas
  for each row execute function privado.apagar_comissoes_pendentes();
drop trigger if exists propostas_comissoes_del_trg on public.propostas;
create trigger propostas_comissoes_del_trg before delete on public.propostas
  for each row execute function privado.apagar_comissoes_pendentes();
drop trigger if exists venda_comissoes_del_trg on public.venda_comissoes;
create trigger venda_comissoes_del_trg before delete on public.venda_comissoes
  for each row execute function privado.apagar_comissoes_pendentes();

-- Repasse cancelado ou excluído (ex.: baixa do aluguel desfeita): a comissão de
-- administração dele que ainda não foi paga é cancelada (e a conta a pagar também).
-- A paga fica (o corretor já recebeu); a origem_chave dela impede gerar outra igual.
create or replace function privado.cancelar_comissoes_do_repasse()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  x record;
  v_motivo text;
begin
  if tg_op = 'UPDATE' and not (new.status = 'cancelado' and old.status is distinct from 'cancelado') then return new; end if;
  v_motivo := case when tg_op = 'DELETE' then 'Repasse excluído (baixa do aluguel desfeita)' else 'Repasse cancelado' end;
  for x in select c.id, c.lancamento_id from public.comissoes c
            where c.repasse_id = old.id and c.tipo = 'administracao' and c.status in ('prevista','a_pagar') loop
    update public.comissoes set status = 'cancelada', motivo = v_motivo where id = x.id;
    if x.lancamento_id is not null then
      update public.lancamentos set status = 'cancelado', cancelado_motivo = 'Comissão cancelada: ' || v_motivo
       where id = x.lancamento_id and status = 'aberto';
    end if;
  end loop;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
drop trigger if exists repasses_comissoes_del_trg on public.repasses;
create trigger repasses_comissoes_del_trg before delete on public.repasses
  for each row execute function privado.cancelar_comissoes_do_repasse();
drop trigger if exists repasses_comissoes_cancel_trg on public.repasses;
create trigger repasses_comissoes_cancel_trg after update of status on public.repasses
  for each row execute function privado.cancelar_comissoes_do_repasse();

-- -----------------------------------------------------------------------------
-- Ações sobre comissões (admin, gestor ou financeiro)
-- -----------------------------------------------------------------------------
create or replace function privado.exigir_papel_financeiro(p_org uuid)
returns void
language plpgsql stable
set search_path = public
as $$
begin
  if coalesce(privado.papel_atual(p_org), '') not in ('admin','gestor','financeiro') then
    raise exception 'Só administrador, gestor ou financeiro podem fazer isso.';
  end if;
end;
$$;
revoke execute on function privado.exigir_papel_financeiro(uuid) from public, anon;
grant execute on function privado.exigir_papel_financeiro(uuid) to authenticated;

-- Libera agora uma comissão prevista (ex.: a imobiliária recebeu por fora do sistema).
create or replace function public.liberar_comissao(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.comissoes%rowtype;
begin
  select * into c from public.comissoes where id = p_id;
  if not found then raise exception 'Comissão não encontrada.'; end if;
  perform privado.exigir_papel_financeiro(c.organizacao_id);
  perform privado.lancar_comissao(p_id);
end;
$$;
revoke execute on function public.liberar_comissao(uuid) from public, anon;
grant execute on function public.liberar_comissao(uuid) to authenticated;

/**
 * Ajustes de uma comissão já paga: complementos ativos (a pagar ou pagos) e
 * devoluções do corretor (abertas ou recebidas). Valor efetivo = valor +
 * complementos − devoluções.
 */
create or replace function privado.ajustes_comissao(p_id uuid, out complementos numeric, out devolucoes numeric)
language sql stable
set search_path = public
as $$
  select
    coalesce((select sum(x.valor) from public.comissoes x where x.ajuste_de = p_id and x.status not in ('cancelada','estornada')), 0)::numeric(14,2),
    coalesce((select sum(l.valor) from public.lancamentos l where l.comissao_devolucao_id = p_id and l.status <> 'cancelado'), 0)::numeric(14,2)
$$;
revoke execute on function privado.ajustes_comissao(uuid) from public, anon;
grant execute on function privado.ajustes_comissao(uuid) to authenticated;

-- Devolução do corretor (conta a receber no financeiro), ligada à comissão.
create or replace function privado.criar_devolucao_comissao(p_id uuid, p_valor numeric, p_rotulo text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.comissoes%rowtype;
  v_lanc uuid;
begin
  select * into c from public.comissoes where id = p_id;
  insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status,
                                  pessoa_id, imovel_id, venda_id, contrato_id, comissao_devolucao_id)
  values (c.organizacao_id, 'receber', p_rotulo || ' — ' || c.descricao, 'Comissões', p_valor,
          current_date + 30, 'aberto', c.pessoa_id, c.imovel_id, c.venda_id, c.contrato_id, c.id)
  returning id into v_lanc;
  update public.comissoes set devolucao_lancamento_id = v_lanc where id = c.id;
  return v_lanc;
end;
$$;
revoke execute on function privado.criar_devolucao_comissao(uuid, numeric, text) from public, anon;
grant execute on function privado.criar_devolucao_comissao(uuid, numeric, text) to authenticated;

/**
 * Estorna a comissão (com motivo):
 * - prevista → cancelada;
 * - a pagar → o lançamento é cancelado no financeiro;
 * - paga → conta a receber do corretor (devolução) do que ele recebeu de fato:
 *   valor pago + complementos pagos − o que ele já devolve por ajustes.
 * Complementos de ajuste em aberto saem junto.
 */
create or replace function public.estornar_comissao(p_id uuid, p_motivo text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.comissoes%rowtype;
  x record;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_pago numeric(14,2) := 0;
  v_dev numeric(14,2);
begin
  select * into c from public.comissoes where id = p_id for update;
  if not found then raise exception 'Comissão não encontrada.'; end if;
  perform privado.exigir_papel_financeiro(c.organizacao_id);
  if v_motivo = '' then raise exception 'Informe o motivo do estorno.'; end if;
  if c.status in ('estornada','cancelada') then raise exception 'Esta comissão já foi estornada ou cancelada.'; end if;

  -- Complementos de ajuste: os em aberto saem; os pagos entram na devolução.
  for x in select * from public.comissoes where ajuste_de = c.id and status in ('prevista','a_pagar','paga') order by created_at loop
    if x.status = 'paga' then v_pago := v_pago + x.valor; end if;
    update public.comissoes
       set status = case when x.status = 'prevista' then 'cancelada' else 'estornada' end,
           motivo = 'Estorno da comissão de origem: ' || v_motivo
     where id = x.id;
    if x.status = 'a_pagar' and x.lancamento_id is not null then
      update public.lancamentos set status = 'cancelado', cancelado_motivo = 'Comissão estornada: ' || v_motivo
       where id = x.lancamento_id and status = 'aberto';
    end if;
  end loop;

  -- Marca primeiro a comissão, para o cancelamento do lançamento não sobrescrever o motivo.
  update public.comissoes set status = case when c.status = 'prevista' then 'cancelada' else 'estornada' end, motivo = v_motivo where id = c.id;
  if c.status = 'a_pagar' and c.lancamento_id is not null then
    update public.lancamentos set status = 'cancelado', cancelado_motivo = 'Comissão estornada: ' || v_motivo
     where id = c.lancamento_id and status = 'aberto';
  elsif c.status = 'paga' then
    v_pago := v_pago + c.valor;
  end if;

  select coalesce(sum(valor), 0) into v_dev from public.lancamentos where comissao_devolucao_id = c.id and status <> 'cancelado';
  if v_pago - v_dev > 0 then
    perform privado.criar_devolucao_comissao(c.id, v_pago - v_dev, 'Devolução de comissão estornada');
  end if;
end;
$$;
revoke execute on function public.estornar_comissao(uuid, text) from public, anon;
grant execute on function public.estornar_comissao(uuid, text) to authenticated;

/**
 * Ajusta o valor (com motivo) — o novo valor é o total que o corretor deve
 * receber por esta comissão.
 * - Prevista/a pagar: muda o valor (e a conta a pagar em aberto).
 * - Paga: o valor pago não muda (é o que saiu do caixa); a conta é feita sobre o
 *   valor efetivo (pago + complementos − devoluções). Para mais: primeiro abate
 *   devolução em aberto, o resto vira complemento a pagar. Para menos: primeiro
 *   reduz complemento ainda não pago, o resto vira devolução a receber do corretor.
 */
create or replace function public.ajustar_comissao(p_id uuid, p_valor numeric, p_motivo text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.comissoes%rowtype;
  a record;
  x record;
  l record;
  v_motivo text := btrim(coalesce(p_motivo, ''));
  v_novo numeric(14,2) := round(p_valor, 2);
  v_extra numeric(14,2);
  v_efetivo numeric(14,2);
  v_dif numeric(14,2);
  v_parte numeric(14,2);
  v_proprio numeric(14,2);
  v_id uuid;
begin
  select * into c from public.comissoes where id = p_id for update;
  if not found then raise exception 'Comissão não encontrada.'; end if;
  perform privado.exigir_papel_financeiro(c.organizacao_id);
  if v_motivo = '' then raise exception 'Informe o motivo do ajuste.'; end if;
  if v_novo is null or v_novo < 0 then raise exception 'Valor inválido.'; end if;
  if c.status in ('estornada','cancelada') then raise exception 'Comissão estornada ou cancelada não pode ser ajustada.'; end if;
  if c.ajuste_de is not null then raise exception 'Este valor é um complemento de outra comissão: faça o ajuste na comissão de origem.'; end if;

  select * into a from privado.ajustes_comissao(c.id);
  v_extra := a.complementos - a.devolucoes;
  v_efetivo := c.valor + v_extra;
  v_dif := v_novo - v_efetivo;
  if v_dif = 0 then return; end if;

  if c.status in ('prevista','a_pagar') then
    v_proprio := v_novo - v_extra;
    if v_proprio < 0 then raise exception 'O novo valor fica abaixo do que já saiu em complementos. Estorne o complemento antes.'; end if;
    if v_proprio = 0 then
      update public.comissoes set valor = 0, motivo = v_motivo, status = 'cancelada' where id = c.id;
      if c.lancamento_id is not null then
        update public.lancamentos set status = 'cancelado', cancelado_motivo = 'Comissão zerada: ' || v_motivo
         where id = c.lancamento_id and status = 'aberto';
      end if;
      return;
    end if;
    if c.status = 'a_pagar' and c.lancamento_id is not null then
      update public.lancamentos set valor = v_proprio where id = c.lancamento_id and status = 'aberto';
    end if;
    update public.comissoes set valor = v_proprio, motivo = v_motivo where id = c.id;
    return;
  end if;

  -- Já paga.
  update public.comissoes set motivo = v_motivo where id = c.id;
  perform privado.anotar_evento_comissao(c.id, 'ajuste',
    'Ajuste depois de paga: de R$ ' || replace(to_char(v_efetivo, 'FM999999990.00'), '.', ',') || ' para R$ '
      || replace(to_char(v_novo, 'FM999999990.00'), '.', ',') || ': ' || v_motivo,
    v_dif);

  if v_dif > 0 then
    -- 1) devolução ainda em aberto diminui (ou some).
    for l in select id, valor from public.lancamentos
              where comissao_devolucao_id = c.id and status = 'aberto' order by created_at desc loop
      exit when v_dif <= 0;
      v_parte := least(l.valor, v_dif);
      if v_parte >= l.valor then
        update public.lancamentos set status = 'cancelado', cancelado_motivo = 'Devolução desfeita no ajuste da comissão: ' || v_motivo where id = l.id;
      else
        update public.lancamentos set valor = valor - v_parte where id = l.id;
      end if;
      v_dif := v_dif - v_parte;
    end loop;
    -- 2) o resto vira complemento a pagar.
    if v_dif > 0 then
      v_id := privado.criar_comissao(c.organizacao_id, c.pessoa_id, c.tipo, c.papel, 'Complemento: ' || c.descricao, null, null, v_dif,
                                     null::public.comissao_regras, c.venda_id, null, c.proposta_id, c.contrato_id, c.repasse_id, c.imovel_id);
      update public.comissoes set origem_id = c.id, ajuste_de = c.id, motivo = v_motivo where id = v_id;
    end if;
  else
    v_dif := -v_dif;
    -- 1) complemento ainda não pago diminui (ou é cancelado).
    for x in select id, valor, lancamento_id from public.comissoes
              where ajuste_de = c.id and status in ('prevista','a_pagar') order by created_at desc loop
      exit when v_dif <= 0;
      v_parte := least(x.valor, v_dif);
      if v_parte >= x.valor then
        update public.comissoes set status = 'cancelada', motivo = 'Desfeito no ajuste da comissão de origem: ' || v_motivo where id = x.id;
        if x.lancamento_id is not null then
          update public.lancamentos set status = 'cancelado', cancelado_motivo = 'Complemento desfeito no ajuste: ' || v_motivo
           where id = x.lancamento_id and status = 'aberto';
        end if;
      else
        update public.comissoes set valor = valor - v_parte, motivo = 'Reduzido no ajuste da comissão de origem: ' || v_motivo where id = x.id;
        if x.lancamento_id is not null then
          update public.lancamentos set valor = valor - v_parte where id = x.lancamento_id and status = 'aberto';
        end if;
      end if;
      v_dif := v_dif - v_parte;
    end loop;
    -- 2) o resto vira devolução a receber do corretor.
    if v_dif > 0 then
      perform privado.criar_devolucao_comissao(c.id, v_dif, 'Devolução de comissão (ajuste)');
    end if;
  end if;
end;
$$;
revoke execute on function public.ajustar_comissao(uuid, numeric, text) from public, anon;
grant execute on function public.ajustar_comissao(uuid, numeric, text) to authenticated;

/** Divide uma comissão (prevista ou a pagar) com outro corretor: p_pct % do valor vai para ele. */
create or replace function public.dividir_comissao(p_id uuid, p_pessoa uuid, p_pct numeric)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.comissoes%rowtype;
  v_parte numeric(14,2);
  v_id uuid;
begin
  select * into c from public.comissoes where id = p_id for update;
  if not found then raise exception 'Comissão não encontrada.'; end if;
  perform privado.exigir_papel_financeiro(c.organizacao_id);
  if c.status not in ('prevista','a_pagar') then raise exception 'Só dá para dividir comissão prevista ou a pagar.'; end if;
  if p_pessoa is null or p_pessoa = c.pessoa_id then raise exception 'Escolha outro corretor para dividir.'; end if;
  if p_pct is null or p_pct <= 0 or p_pct >= 100 then raise exception 'A parte do outro corretor deve ficar entre 0%% e 100%%.'; end if;
  v_parte := round(c.valor * p_pct / 100, 2);
  if v_parte <= 0 then raise exception 'Valor pequeno demais para dividir.'; end if;
  update public.comissoes set valor = valor - v_parte, motivo = 'Dividida com outro corretor (' || p_pct || '%)' where id = c.id;
  if c.status = 'a_pagar' and c.lancamento_id is not null then
    update public.lancamentos set valor = valor - v_parte where id = c.lancamento_id and status = 'aberto';
  end if;
  insert into public.comissoes (organizacao_id, pessoa_id, tipo, papel, descricao, base, percentual, valor, valor_original,
                                status, condicionada, dias_pagamento, previsao, regra_id, equipe_id,
                                venda_id, proposta_id, contrato_id, repasse_id, imovel_id, origem_id)
  values (c.organizacao_id, p_pessoa, c.tipo, 'parceiro', c.descricao || ' (dividida)', c.base, null, v_parte, v_parte,
          'prevista', c.condicionada, c.dias_pagamento, c.previsao, null,
          (select m.equipe_id from public.equipe_membros m where m.pessoa_id = p_pessoa),
          c.venda_id, c.proposta_id, c.contrato_id, c.repasse_id, c.imovel_id, c.id)
  returning id into v_id;
  if c.status = 'a_pagar' then perform privado.lancar_comissao(v_id); end if;
  return v_id;
end;
$$;
revoke execute on function public.dividir_comissao(uuid, uuid, numeric) from public, anon;
grant execute on function public.dividir_comissao(uuid, uuid, numeric) to authenticated;

/**
 * Comissões de administração da competência: % da taxa de administração retida
 * em cada repasse, para o corretor responsável pelo imóvel (regra "administração").
 * Não repete o que já foi gerado. Devolve quantas comissões criou.
 */
create or replace function public.gerar_comissoes_administracao(p_competencia date)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_ini date := make_date(extract(year from p_competencia)::int, extract(month from p_competencia)::int, 1);
  v_fim date := (make_date(extract(year from p_competencia)::int, extract(month from p_competencia)::int, 1) + interval '1 month')::date;
  r record;
  g public.comissao_regras;
  v_valor numeric(14,2);
  v_chave text;
  v_id uuid;
  v_n int := 0;
begin
  perform privado.exigir_papel_financeiro(v_org);
  for r in
    select rp.id, rp.contrato_id, rp.pessoa_id, rp.taxa_administracao, rp.competencia, i.id as imovel_id, i.codigo, i.corretor_id
      from public.repasses rp
      join public.contratos ct on ct.id = rp.contrato_id
      join public.imoveis i on i.id = ct.imovel_id
     where rp.organizacao_id = v_org
       and rp.competencia >= v_ini and rp.competencia < v_fim
       and rp.status <> 'cancelado' and rp.taxa_administracao > 0 and i.corretor_id is not null
  loop
    -- Uma por contrato + mês + proprietário: se a baixa do aluguel for desfeita e
    -- refeita, o repasse muda de id mas a comissão não se repete.
    v_chave := 'adm:' || r.contrato_id || ':' || to_char(r.competencia, 'YYYY-MM') || ':' || r.pessoa_id;
    if exists (select 1 from public.comissoes c where c.organizacao_id = v_org
                 and (c.origem_chave = v_chave or (c.repasse_id = r.id and c.tipo = 'administracao' and c.origem_id is null))
                 and c.status not in ('cancelada','estornada')) then
      continue;
    end if;
    g := privado.regra_comissao(v_org, 'administracao', r.corretor_id);
    if g.id is null or g.percentual <= 0 then continue; end if;
    v_valor := round(r.taxa_administracao * g.percentual / 100, 2);
    if v_valor <= 0 then continue; end if;
    -- A taxa já foi recebida na baixa do aluguel: não fica condicionada.
    g.condicionada := false;
    v_id := privado.criar_comissao(v_org, r.corretor_id, 'administracao', 'corretor',
      'Comissão de administração ' || to_char(r.competencia, 'MM/YYYY') || ' — ' || r.codigo,
      r.taxa_administracao, g.percentual, v_valor, g, null, null, null, r.contrato_id, r.id, r.imovel_id);
    update public.comissoes set origem_chave = v_chave where id = v_id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.gerar_comissoes_administracao(date) from public, anon;
grant execute on function public.gerar_comissoes_administracao(date) to authenticated;

-- -----------------------------------------------------------------------------
-- Propostas e vendas passam a gerar comissões pelas regras
-- -----------------------------------------------------------------------------

/**
 * Aceitar proposta.
 * - Venda: abre/atualiza o processo da venda (vendido só ao concluir). A comissão
 *   da venda é o % da proposta (padrão 6%) sobre o valor; na divisão, o captador
 *   do imóvel (se for outro corretor e houver regra de angariação) recebe a parte
 *   dela, e o corretor que vendeu a parte da regra "venda" — sem regra, 100% menos
 *   a parte do captador (nunca passa de 100% somando os dois).
 * - Locação: reserva o imóvel; o corretor recebe o % da proposta (em branco: o da
 *   regra "locação") sobre o aluguel proposto, e o captador o da regra de
 *   angariação. Vira conta a pagar na hora (vencimento pelo prazo da regra,
 *   padrão 30 dias) ou fica prevista até o 1º aluguel ser recebido, se a regra
 *   for condicionada.
 */
create or replace function public.aceitar_proposta(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  p public.propostas%rowtype;
  v_codigo text;
  v_captador uuid;
  v_venda uuid;
  v_lead public.leads%rowtype;
  g public.comissao_regras;
  ga public.comissao_regras;
  v_pct numeric;
  v_pct_cap numeric := 0;
begin
  select * into p from public.propostas where id = p_id for update;
  if not found then raise exception 'Proposta não encontrada.'; end if;
  if p.status not in ('em_negociacao','contraproposta') then raise exception 'Esta proposta não está mais em negociação.'; end if;

  update public.propostas set status = 'aceita', fechada_em = current_date where id = p.id;
  if p.imovel_id is not null then
    select codigo, corretor_id into v_codigo, v_captador from public.imoveis where id = p.imovel_id;
  end if;

  if p.tipo = 'venda' then
    v_venda := p.venda_id;
    if v_venda is null then
      if p.lead_id is not null then select * into v_lead from public.leads where id = p.lead_id; end if;
      insert into public.vendas (organizacao_id, imovel_id, lead_id, corretor_id, comprador_nome, comprador_telefone, valor, status, comissao_pct)
      values (p.organizacao_id, p.imovel_id, p.lead_id, p.corretor_id, v_lead.nome, v_lead.telefone, p.valor, 'aprovado', coalesce(p.comissao_pct, 6))
      returning id into v_venda;
      update public.propostas set venda_id = v_venda where id = p.id;
      -- Captador do imóvel (regra de angariação) e corretor que vendeu (regra de venda).
      if v_captador is not null and v_captador is distinct from p.corretor_id then
        ga := privado.regra_comissao(p.organizacao_id, 'angariacao', v_captador);
        if ga.id is not null and ga.percentual > 0 then
          v_pct_cap := ga.percentual;
          insert into public.venda_comissoes (organizacao_id, venda_id, pessoa_id, papel, percentual)
          values (p.organizacao_id, v_venda, v_captador, 'captador', v_pct_cap);
        end if;
      end if;
      if p.corretor_id is not null then
        g := privado.regra_comissao(p.organizacao_id, 'venda', p.corretor_id);
        v_pct := least(coalesce(g.percentual, 100), 100 - v_pct_cap);
        if v_pct > 0 then
          insert into public.venda_comissoes (organizacao_id, venda_id, pessoa_id, papel, percentual)
          values (p.organizacao_id, v_venda, p.corretor_id, 'vendedor', v_pct);
        end if;
      end if;
    else
      update public.vendas set valor = p.valor, status = case when status in ('proposta','negociacao') then 'aprovado' else status end
       where id = v_venda;
    end if;
    update public.vendas set aprovado_proprietario_em = coalesce(p.aprovada_proprietario_em, current_date),
                             forma_pagamento = coalesce(p.forma_pagamento, forma_pagamento)
     where id = v_venda;
    update public.propostas set status = 'recusada', fechada_em = current_date
     where venda_id = v_venda and id <> p.id and status in ('em_negociacao','contraproposta');
    insert into public.venda_eventos (organizacao_id, venda_id, tipo, descricao)
    values (p.organizacao_id, v_venda, 'proposta', 'Proposta de ' || to_char(p.valor, 'FM999G999G999D00') || ' aceita');
    if p.lead_id is not null then
      update public.leads set status = 'proposta' where id = p.lead_id and status in ('novo','em_atendimento','visita');
    end if;
    return;
  end if;

  -- Locação
  if p.lead_id is not null then
    update public.leads set status = 'ganho' where id = p.lead_id;
  end if;
  if p.imovel_id is not null then
    update public.imoveis set status = 'reservado' where id = p.imovel_id and status = 'disponivel';
  end if;
  if p.corretor_id is not null then
    g := privado.regra_comissao(p.organizacao_id, 'locacao', p.corretor_id);
    v_pct := coalesce(p.comissao_pct, g.percentual, 0);
    if v_pct > 0 then
      perform privado.criar_comissao(p.organizacao_id, p.corretor_id, 'locacao', 'corretor',
        'Comissão de locação' || coalesce(' — ' || v_codigo, ''), p.valor, v_pct, round(p.valor * v_pct / 100, 2),
        g, null, null, p.id, null, null, p.imovel_id);
    end if;
  end if;
  if v_captador is not null and v_captador is distinct from p.corretor_id then
    ga := privado.regra_comissao(p.organizacao_id, 'angariacao', v_captador);
    if ga.id is not null and ga.percentual > 0 then
      perform privado.criar_comissao(p.organizacao_id, v_captador, 'angariacao', 'captador',
        'Comissão de angariação (locação)' || coalesce(' — ' || v_codigo, ''), p.valor, ga.percentual,
        round(p.valor * ga.percentual / 100, 2), ga, null, null, p.id, null, null, p.imovel_id);
    end if;
  end if;
end;
$$;
revoke execute on function public.aceitar_proposta(uuid) from public, anon;
grant execute on function public.aceitar_proposta(uuid) to authenticated;

/**
 * Conclui a venda: imóvel vendido, lead ganho, comissão total a receber e a
 * parte de cada pessoa da divisão (arredondada no centavo; nunca passa do total).
 * Sem condição na regra, a parte vira conta a pagar na hora (vencimento pelo
 * prazo da regra, padrão 30 dias); com condição, fica prevista até a imobiliária
 * receber a comissão (baixa do "a receber" no financeiro). Não lança duas vezes.
 */
create or replace function public.concluir_venda(p_id uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  v public.vendas%rowtype;
  v_total numeric(14,2);
  v_dist numeric(14,2) := 0;
  v_parte numeric(14,2);
  v_codigo text;
  v_prop uuid;
  r record;
  v_lanc uuid;
  v_tipo text;
  g public.comissao_regras;
begin
  select * into v from public.vendas where id = p_id for update;
  if not found then raise exception 'Venda não encontrada.'; end if;
  if v.status = 'concluida' then raise exception 'Esta venda já foi concluída.'; end if;
  if v.status = 'cancelada' then raise exception 'Esta venda foi cancelada.'; end if;
  if v.valor <= 0 then raise exception 'Informe o valor da venda.'; end if;

  v_total := coalesce(v.comissao_valor, round(v.valor * v.comissao_pct / 100, 2));
  select codigo into v_codigo from public.imoveis where id = v.imovel_id;
  select pessoa_id into v_prop from public.imovel_proprietarios where imovel_id = v.imovel_id order by percentual desc limit 1;

  if v_total > 0 and v.lancamento_receber_id is null then
    insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status, pessoa_id, imovel_id, venda_id)
    values (v.organizacao_id, 'receber', 'Comissão de venda' || coalesce(' — ' || v_codigo, ''), 'Comissões de venda',
            v_total, current_date, 'aberto', v_prop, v.imovel_id, v.id)
    returning id into v_lanc;
    update public.vendas set lancamento_receber_id = v_lanc where id = v.id;
  end if;

  for r in select c.* from public.venda_comissoes c
            where c.venda_id = v.id and c.papel <> 'imobiliaria' and c.pessoa_id is not null
            order by c.id loop
    v_parte := least(round(v_total * r.percentual / 100, 2), greatest(v_total - v_dist, 0));
    v_dist := v_dist + v_parte;
    if r.lancamento_id is not null or v_parte <= 0
       or exists (select 1 from public.comissoes x where x.venda_comissao_id = r.id and x.status <> 'cancelada') then
      continue;
    end if;
    v_tipo := case when r.papel = 'captador' then 'angariacao' else 'venda' end;
    g := privado.regra_comissao(v.organizacao_id, v_tipo, r.pessoa_id);
    perform privado.criar_comissao(v.organizacao_id, r.pessoa_id, v_tipo, r.papel,
      'Comissão de venda (' || r.papel || ')' || coalesce(' — ' || v_codigo, ''), v_total, r.percentual, v_parte,
      g, v.id, r.id, null, null, null, v.imovel_id);
  end loop;

  update public.vendas set status = 'concluida', concluida_em = current_date where id = v.id;
  if v.imovel_id is not null then
    update public.imoveis set status = 'vendido', vendido_em = current_date where id = v.imovel_id;
  end if;
  if v.lead_id is not null then
    update public.leads set status = 'ganho' where id = v.lead_id;
  end if;
  insert into public.venda_eventos (organizacao_id, venda_id, tipo, descricao)
  values (v.organizacao_id, v.id, 'conclusao', 'Venda concluída' || coalesce(' — ' || v_codigo, ''));
end;
$$;
revoke execute on function public.concluir_venda(uuid) from public, anon;
grant execute on function public.concluir_venda(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Juntar cadastros repetidos (Pessoas, nos dois modos) sem perder comissões,
-- regras, equipes e históricos de repasse/comissão. Recria public.juntar_pessoas
-- (20261103000004) com o mesmo conteúdo e os trechos de repasses e comissões.
-- -----------------------------------------------------------------------------

-- Os históricos são só leitura pela API: o reapontamento passa por aqui.
create or replace function privado.juntar_pessoas_historicos(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizacao_id into v_org from public.pessoas where id = p_manter;
  if v_org is null or v_org not in (select privado.org_ids())
     or not exists (select 1 from public.pessoas where id = p_remover and organizacao_id = v_org) then
    raise exception 'Cadastro não encontrado.';
  end if;
  update public.repasse_eventos set pessoa_id = p_manter where pessoa_id = p_remover and organizacao_id = v_org;
  update public.comissao_eventos set pessoa_id = p_manter where pessoa_id = p_remover and organizacao_id = v_org;
end;
$$;
revoke execute on function privado.juntar_pessoas_historicos(uuid, uuid) from public, anon;
grant execute on function privado.juntar_pessoas_historicos(uuid, uuid) to authenticated;

create or replace function public.juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  a public.pessoas%rowtype;
  b public.pessoas%rowtype;
  r record;
begin
  if p_manter = p_remover then raise exception 'Escolha dois cadastros diferentes.'; end if;
  select * into a from public.pessoas where id = p_manter for update;
  select * into b from public.pessoas where id = p_remover for update;
  if a.id is null or b.id is null then raise exception 'Cadastro não encontrado.'; end if;

  -- Imóveis: se os dois eram donos do mesmo imóvel, soma a participação.
  for r in select * from public.imovel_proprietarios where pessoa_id = b.id loop
    if exists (select 1 from public.imovel_proprietarios where imovel_id = r.imovel_id and pessoa_id = a.id) then
      update public.imovel_proprietarios
         set percentual = least(100, percentual + r.percentual)
       where imovel_id = r.imovel_id and pessoa_id = a.id;
      delete from public.imovel_proprietarios where imovel_id = r.imovel_id and pessoa_id = b.id;
    else
      update public.imovel_proprietarios set pessoa_id = a.id where imovel_id = r.imovel_id and pessoa_id = b.id;
    end if;
  end loop;

  -- Contratos: sem repetir a mesma pessoa no mesmo papel.
  delete from public.contrato_partes cp
   where cp.pessoa_id = b.id
     and exists (select 1 from public.contrato_partes x where x.contrato_id = cp.contrato_id and x.pessoa_id = a.id and x.papel = cp.papel);
  update public.contrato_partes set pessoa_id = a.id where pessoa_id = b.id;

  update public.repasses set pessoa_id = a.id where pessoa_id = b.id;
  update public.lancamentos set pessoa_id = a.id where pessoa_id = b.id;
  update public.visitas set corretor_id = a.id where corretor_id = b.id;
  update public.propostas set corretor_id = a.id where corretor_id = b.id;
  update public.imoveis set corretor_id = a.id where corretor_id = b.id;

  delete from public.pessoa_vinculos v
   where (v.pessoa_id = b.id and (v.vinculado_id = a.id or exists (
            select 1 from public.pessoa_vinculos x where x.pessoa_id = a.id and x.vinculado_id = v.vinculado_id and x.tipo = v.tipo)))
      or (v.vinculado_id = b.id and (v.pessoa_id = a.id or exists (
            select 1 from public.pessoa_vinculos x where x.vinculado_id = a.id and x.pessoa_id = v.pessoa_id and x.tipo = v.tipo)));
  update public.pessoa_vinculos set pessoa_id = a.id where pessoa_id = b.id;
  update public.pessoa_vinculos set vinculado_id = a.id where vinculado_id = b.id;
  update public.pessoa_interacoes set pessoa_id = a.id where pessoa_id = b.id;
  update public.pessoa_arquivos set pessoa_id = a.id where pessoa_id = b.id;
  update public.pessoa_consentimentos set pessoa_id = a.id where pessoa_id = b.id;

  -- Completa o que estava vazio em quem fica.
  update public.pessoas set
    documento = coalesce(a.documento, b.documento),
    rg_ie = coalesce(a.rg_ie, b.rg_ie),
    data_nascimento = coalesce(a.data_nascimento, b.data_nascimento),
    estado_civil = coalesce(a.estado_civil, b.estado_civil),
    profissao = coalesce(a.profissao, b.profissao),
    email = coalesce(a.email, b.email),
    telefone = coalesce(a.telefone, b.telefone),
    cep = coalesce(a.cep, b.cep),
    logradouro = coalesce(a.logradouro, b.logradouro),
    numero = coalesce(a.numero, b.numero),
    complemento = coalesce(a.complemento, b.complemento),
    bairro = coalesce(a.bairro, b.bairro),
    cidade = coalesce(a.cidade, b.cidade),
    uf = coalesce(a.uf, b.uf),
    banco = coalesce(a.banco, b.banco),
    agencia = coalesce(a.agencia, b.agencia),
    conta = coalesce(a.conta, b.conta),
    tipo_conta = coalesce(a.tipo_conta, b.tipo_conta),
    pix_chave = coalesce(a.pix_chave, b.pix_chave),
    especialidade = coalesce(a.especialidade, b.especialidade),
    papeis = (select array(select distinct unnest(a.papeis || b.papeis))),
    observacoes = nullif(concat_ws(E'\n', a.observacoes, b.observacoes), '')
  where id = a.id;

  -- Repasses e comissões: o cadastro que fica herda tudo (comissões, regras,
  -- equipe, despesas a descontar, divisão de vendas e o histórico).
  update public.lancamentos set descontar_de_id = a.id where descontar_de_id = b.id;
  update public.comissoes set pessoa_id = a.id where pessoa_id = b.id;
  update public.comissao_regras set pessoa_id = a.id where pessoa_id = b.id;
  update public.equipes set lider_id = a.id where lider_id = b.id;
  if exists (select 1 from public.equipe_membros where pessoa_id = a.id) then
    delete from public.equipe_membros where pessoa_id = b.id;
  else
    update public.equipe_membros set pessoa_id = a.id where pessoa_id = b.id;
  end if;
  update public.venda_comissoes set pessoa_id = a.id where pessoa_id = b.id;
  update public.vendas set corretor_id = a.id where corretor_id = b.id;
  update public.vendas set comprador_id = a.id where comprador_id = b.id;
  perform privado.juntar_pessoas_historicos(a.id, b.id);

  delete from public.pessoas where id = b.id;
end;
$$;

revoke execute on function public.juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function public.juntar_pessoas(uuid, uuid) to authenticated;
