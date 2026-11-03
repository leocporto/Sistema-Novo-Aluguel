-- =============================================================================
-- Cobranças e inadimplência (nos dois modos: imobiliária e imóveis pessoais)
--   - pagamentos parciais da fatura (cada recebimento é uma linha; a fatura só
--     fica "paga" — e só então gera repasse e taxas — quando o saldo zera);
--   - baixa manual e automática (extrato importado ou arquivo de retorno);
--   - 2ª via pública por link com token (/pagar/[token]) e "já paguei";
--   - Pix copia-e-cola estático (chave da organização / conta de recebimento);
--   - régua com avisos antes e depois do vencimento, fila do dia e registro
--     do envio (canal, quem enviou); estrutura pronta para envio automático;
--   - histórico de contatos de cobrança (promessa de pagamento, próximo contato);
--   - acordos e parcelamento de débitos (faturas "renegociadas"), quebra e
--     cumprimento;
--   - encaminhamento para cobrança jurídica;
--   - trilha de auditoria das cobranças (só leitura, gravada pelo banco).
-- Tudo idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configuração de cobrança da organização
-- -----------------------------------------------------------------------------
alter table public.organizacoes
  add column if not exists cobranca_pix_chave text,
  add column if not exists cobranca_pix_nome text,
  add column if not exists cobranca_pix_cidade text,
  -- Sem chave estrangeira de propósito: evita duas ligações entre organizacoes e
  -- contas_financeiras (o que confundiria os "embeds" da API). Conta apagada = ignorada.
  add column if not exists cobranca_conta_id uuid,
  add column if not exists cobranca_meios text[] not null default '{pix,transferencia,dinheiro}',
  add column if not exists cobranca_instrucoes text,
  add column if not exists cobranca_link_publico boolean not null default true,
  add column if not exists cobranca_envio_automatico boolean not null default false,
  add column if not exists cobranca_canal_padrao text not null default 'whatsapp',
  add column if not exists cobranca_hora_envio int not null default 9,
  add column if not exists cobranca_juridico_dias int not null default 90,
  add column if not exists cobranca_quebra_dias int not null default 30;

alter table public.organizacoes drop constraint if exists organizacoes_cobranca_canal_check;
alter table public.organizacoes add constraint organizacoes_cobranca_canal_check
  check (cobranca_canal_padrao in ('whatsapp','email','sms'));
alter table public.organizacoes drop constraint if exists organizacoes_cobranca_hora_check;
alter table public.organizacoes add constraint organizacoes_cobranca_hora_check
  check (cobranca_hora_envio between 0 and 23);

-- -----------------------------------------------------------------------------
-- Faturas: status "renegociada" (entrou num acordo), saldo, link público
-- -----------------------------------------------------------------------------
alter table public.faturas drop constraint if exists faturas_status_check;
alter table public.faturas add constraint faturas_status_check
  check (status in ('aberta','paga','cancelada','renegociada'));

alter table public.faturas
  add column if not exists valor_recebido numeric(14,2) not null default 0,
  add column if not exists valor_abatido numeric(14,2) not null default 0,
  add column if not exists token_publico uuid not null default gen_random_uuid(),
  add column if not exists segunda_via_vista_em timestamptz;
create unique index if not exists faturas_token_publico_idx on public.faturas (token_publico);

-- Itens lançados na baixa (multa, juros, descontos da baixa) — saem no estorno.
alter table public.fatura_itens add column if not exists da_baixa boolean not null default false;

-- Régua: canal usado, quem enviou e "pulado". Com o envio automático ligado,
-- o aviso do dia fica gravado como "agendado" (mensagem pronta, canal e
-- destinatário) — é a fila de saída que o provedor de WhatsApp/SMS/e-mail
-- consome quando for contratado.
alter table public.regua_envios
  add column if not exists canal text,
  add column if not exists usuario_id uuid default auth.uid(),
  add column if not exists mensagem text,
  add column if not exists assunto text,
  add column if not exists agendado_para timestamptz,
  add column if not exists erro text,
  add column if not exists automatico boolean not null default false;
alter table public.regua_envios drop constraint if exists regua_envios_status_check;
alter table public.regua_envios add constraint regua_envios_status_check
  check (status in ('registrado','enviado','falhou','pulado','agendado'));

-- -----------------------------------------------------------------------------
-- Acordos e parcelamento de débitos
-- -----------------------------------------------------------------------------
create table if not exists public.acordos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  numero bigint generated always as identity,
  contrato_id uuid references public.contratos(id) on delete set null,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  status text not null default 'ativo' check (status in ('ativo','cumprido','quebrado','cancelado')),
  data date not null default current_date,
  principal numeric(14,2) not null default 0,
  multa numeric(14,2) not null default 0,
  juros numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  total numeric(14,2) not null check (total > 0),
  entrada numeric(14,2) not null default 0,
  parcelas int not null default 1 check (parcelas between 1 and 120),
  condicoes text,
  observacoes text,
  cumprido_em date,
  quebrado_em date,
  quebra_motivo text,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists acordos_contrato_idx on public.acordos (contrato_id);

alter table public.faturas
  add column if not exists acordo_id uuid references public.acordos(id) on delete set null;
create index if not exists faturas_acordo_idx on public.faturas (acordo_id) where acordo_id is not null;

create table if not exists public.acordo_faturas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  acordo_id uuid not null references public.acordos(id) on delete cascade,
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  principal numeric(14,2) not null default 0,
  multa numeric(14,2) not null default 0,
  juros numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  total numeric(14,2) not null,
  unique (acordo_id, fatura_id)
);
create index if not exists acordo_faturas_fatura_idx on public.acordo_faturas (fatura_id);

create table if not exists public.acordo_parcelas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  acordo_id uuid not null references public.acordos(id) on delete cascade,
  numero int not null,
  vencimento date not null,
  valor numeric(14,2) not null check (valor > 0),
  status text not null default 'aberta' check (status in ('aberta','paga','cancelada')),
  pago_em date,
  forma text,
  conta_id uuid references public.contas_financeiras(id) on delete set null,
  token_publico uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  unique (acordo_id, numero)
);
create unique index if not exists acordo_parcelas_token_idx on public.acordo_parcelas (token_publico);
create index if not exists acordo_parcelas_venc_idx on public.acordo_parcelas (status, vencimento);

-- -----------------------------------------------------------------------------
-- Cobrança jurídica
-- -----------------------------------------------------------------------------
create table if not exists public.cobrancas_juridicas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid references public.contratos(id) on delete set null,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  encaminhado_em date not null default current_date,
  escritorio text,
  responsavel text,
  contato text,
  numero_processo text,
  situacao text not null default 'encaminhado'
    check (situacao in ('encaminhado','notificacao','negociacao','acao_ajuizada','acordo','pago','encerrado')),
  valor_encaminhado numeric(14,2) not null default 0,
  honorarios_pct numeric(6,3),
  proxima_acao date,
  observacoes text,
  encerrado_em date,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cobrancas_juridicas_contrato_idx on public.cobrancas_juridicas (contrato_id);

alter table public.faturas
  add column if not exists juridico_id uuid references public.cobrancas_juridicas(id) on delete set null;
create index if not exists faturas_juridico_idx on public.faturas (juridico_id) where juridico_id is not null;

-- -----------------------------------------------------------------------------
-- Pagamentos da fatura (parciais ou não)
--   valor     = dinheiro recebido
--   principal = parte que abate o saldo da fatura
--   multa/juros = encargos cobrados neste recebimento
--   desconto  = abatimento concedido (pontualidade, acordo…), sem dinheiro
-- -----------------------------------------------------------------------------
create table if not exists public.fatura_pagamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  fatura_id uuid not null references public.faturas(id) on delete cascade,
  pago_em date not null,
  valor numeric(14,2) not null check (valor >= 0),
  principal numeric(14,2) not null default 0 check (principal >= 0),
  multa numeric(14,2) not null default 0 check (multa >= 0),
  juros numeric(14,2) not null default 0 check (juros >= 0),
  desconto numeric(14,2) not null default 0 check (desconto >= 0),
  forma text check (forma in ('boleto','pix','transferencia','dinheiro','cartao','outro')),
  conta_id uuid references public.contas_financeiras(id) on delete set null,
  origem text not null default 'manual' check (origem in ('manual','acordo','extrato','arquivo','automatica')),
  acordo_parcela_id uuid references public.acordo_parcelas(id) on delete restrict,
  extrato_item_id uuid references public.extrato_itens(id) on delete set null,
  observacao text,
  comprovante_path text,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check (valor = principal + multa + juros)
);
create index if not exists fatura_pagamentos_fatura_idx on public.fatura_pagamentos (fatura_id, pago_em);
create index if not exists fatura_pagamentos_data_idx on public.fatura_pagamentos (organizacao_id, pago_em);
create index if not exists fatura_pagamentos_parcela_idx on public.fatura_pagamentos (acordo_parcela_id) where acordo_parcela_id is not null;

-- Chave da linha do extrato/arquivo que gerou a baixa automática (data + valor +
-- descrição + conta): a mesma linha não dá baixa duas vezes.
alter table public.fatura_pagamentos add column if not exists chave_baixa text;
create unique index if not exists fatura_pagamentos_chave_idx on public.fatura_pagamentos (organizacao_id, chave_baixa, fatura_id) where chave_baixa is not null;

-- Imóveis pessoais: cada recebimento vira um lançamento no Financeiro (com a
-- conta e a data dele). Sai junto quando o recebimento é desfeito.
alter table public.lancamentos
  add column if not exists fatura_pagamento_id uuid references public.fatura_pagamentos(id) on delete cascade;
create index if not exists lancamentos_fatura_pagamento_idx on public.lancamentos (fatura_pagamento_id) where fatura_pagamento_id is not null;

-- -----------------------------------------------------------------------------
-- Histórico de contatos de cobrança
-- -----------------------------------------------------------------------------
create table if not exists public.cobranca_contatos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  contrato_id uuid references public.contratos(id) on delete cascade,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  fatura_id uuid references public.faturas(id) on delete set null,
  acordo_id uuid references public.acordos(id) on delete set null,
  juridico_id uuid references public.cobrancas_juridicas(id) on delete set null,
  regra_id uuid references public.regua_regras(id) on delete set null,
  data timestamptz not null default now(),
  canal text not null default 'whatsapp'
    check (canal in ('whatsapp','email','sms','telefone','presencial','carta','link','outro')),
  direcao text not null default 'saida' check (direcao in ('saida','entrada')),
  resultado text not null default 'enviado'
    check (resultado in ('enviado','sem_resposta','falou','promessa','recusou','contato_errado','pagou','informou_pagamento','outro')),
  descricao text,
  promessa_data date,
  promessa_valor numeric(14,2),
  promessa_status text check (promessa_status in ('pendente','cumprida','quebrada')),
  proximo_contato date,
  automatico boolean not null default false,
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cobranca_contatos_contrato_idx on public.cobranca_contatos (contrato_id, data desc);
create index if not exists cobranca_contatos_fatura_idx on public.cobranca_contatos (fatura_id);
create index if not exists cobranca_contatos_proximo_idx on public.cobranca_contatos (organizacao_id, proximo_contato) where proximo_contato is not null;

-- -----------------------------------------------------------------------------
-- Trilha de auditoria das cobranças (gravada só pelo banco; ninguém apaga)
-- -----------------------------------------------------------------------------
create table if not exists public.cobranca_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes(id) on delete cascade,
  fatura_id uuid,
  contrato_id uuid,
  acordo_id uuid,
  juridico_id uuid,
  tipo text not null,
  descricao text,
  valor numeric(14,2),
  usuario_id uuid,
  data timestamptz not null default now()
);
create index if not exists cobranca_eventos_fatura_idx on public.cobranca_eventos (fatura_id, data desc);
create index if not exists cobranca_eventos_org_idx on public.cobranca_eventos (organizacao_id, data desc);
create index if not exists cobranca_eventos_acordo_idx on public.cobranca_eventos (acordo_id) where acordo_id is not null;

-- -----------------------------------------------------------------------------
-- RLS por organização
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['acordos','acordo_faturas','acordo_parcelas','cobrancas_juridicas','fatura_pagamentos','cobranca_contatos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (organizacao_id in (select privado.org_ids()))
      with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
  end loop;
end $$;
alter table public.cobranca_eventos enable row level security;
drop policy if exists cobranca_eventos_ler on public.cobranca_eventos;
create policy cobranca_eventos_ler on public.cobranca_eventos for select to authenticated
  using (organizacao_id in (select privado.org_ids()));

-- No Supabase o papel authenticated já tem estes privilégios; aqui fica explícito.
grant select, insert, update, delete on public.acordos, public.acordo_faturas, public.acordo_parcelas,
  public.cobrancas_juridicas, public.fatura_pagamentos, public.cobranca_contatos to authenticated;
grant select on public.cobranca_eventos to authenticated;

-- -----------------------------------------------------------------------------
-- Saldo da fatura: soma dos pagamentos (mantida pelo banco)
-- -----------------------------------------------------------------------------
create or replace function privado.recalcular_recebido(p_fatura_id uuid)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.faturas f
     set valor_recebido = coalesce((select sum(p.valor) from public.fatura_pagamentos p where p.fatura_id = f.id), 0),
         valor_abatido = coalesce((select sum(p.principal + p.desconto) from public.fatura_pagamentos p where p.fatura_id = f.id), 0)
   where f.id = p_fatura_id
$$;

create or replace function privado.pagamentos_fatura_trg()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if tg_op in ('INSERT', 'UPDATE') then
    perform privado.recalcular_recebido(new.fatura_id);
  end if;
  if tg_op in ('DELETE', 'UPDATE') then
    perform privado.recalcular_recebido(old.fatura_id);
  end if;
  return null;
end;
$$;
drop trigger if exists fatura_pagamentos_soma_trg on public.fatura_pagamentos;
create trigger fatura_pagamentos_soma_trg after insert or update or delete on public.fatura_pagamentos
  for each row execute function privado.pagamentos_fatura_trg();

-- Dinheiro já recebido não some: fatura com recebimento não pode ser cancelada
-- (nem pela desocupação) nem apagada (nem junto com o contrato). Desfaça os
-- recebimentos antes — ou quite a fatura.
create or replace function privado.proteger_fatura_recebida()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_valor numeric;
  v_id uuid;
  v_numero bigint;
begin
  if tg_op = 'DELETE' then
    -- Organização sendo apagada (cascata): tudo sai junto.
    if not exists (select 1 from public.organizacoes where id = old.organizacao_id) then
      return old;
    end if;
    v_id := old.id;
    v_numero := old.numero;
  else
    if not (new.status = 'cancelada' and old.status is distinct from 'cancelada') then
      return new;
    end if;
    v_id := new.id;
    v_numero := new.numero;
  end if;
  if exists (select 1 from public.fatura_pagamentos where fatura_id = v_id) then
    select coalesce(sum(valor), 0) into v_valor from public.fatura_pagamentos where fatura_id = v_id;
    raise exception 'A fatura #% já tem recebimento registrado (R$ %). Desfaça os recebimentos (ou quite a fatura) antes de % — o dinheiro recebido não pode sumir.',
      v_numero, replace(to_char(v_valor, 'FM999999990.00'), '.', ','), case when tg_op = 'DELETE' then 'excluir' else 'cancelar' end;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
drop trigger if exists faturas_proteger_recebida_trg on public.faturas;
create trigger faturas_proteger_recebida_trg before update of status or delete on public.faturas
  for each row execute function privado.proteger_fatura_recebida();

-- Conciliação no Financeiro (extrato → fatura) define a conta da fatura: os
-- recebimentos sem conta (e o lançamento de cada um, no modo pessoal) passam a
-- ser dessa conta, para o saldo bater.
create or replace function privado.conta_da_fatura_trg()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.conta_id is not null and new.conciliado_em is not null
     and (new.conciliado_em is distinct from old.conciliado_em or new.conta_id is distinct from old.conta_id) then
    update public.lancamentos l set conta_id = new.conta_id
      from public.fatura_pagamentos p
     where p.fatura_id = new.id and p.conta_id is null and l.fatura_pagamento_id = p.id and l.conta_id is null;
    update public.fatura_pagamentos set conta_id = new.conta_id where fatura_id = new.id and conta_id is null;
  end if;
  return null;
end;
$$;
drop trigger if exists faturas_conta_trg on public.faturas;
create trigger faturas_conta_trg after update of conta_id, conciliado_em on public.faturas
  for each row execute function privado.conta_da_fatura_trg();

-- Modo pessoal: trocar a conta no lançamento do recebimento (Financeiro) troca
-- também no recebimento, para a ficha da cobrança mostrar a mesma conta.
create or replace function privado.conta_do_lancamento_trg()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.fatura_pagamento_id is not null and new.conta_id is distinct from old.conta_id then
    update public.fatura_pagamentos set conta_id = new.conta_id
     where id = new.fatura_pagamento_id and conta_id is distinct from new.conta_id;
  end if;
  return null;
end;
$$;

-- Fila de saída do envio automático: cobrança que saiu da régua (paga, em
-- acordo, cancelada ou na cobrança jurídica) não pode mais ser enviada.
create or replace function privado.tirar_da_fila_de_saida_trg()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if new.status <> 'aberta' or new.juridico_id is not null then
    update public.regua_envios
       set status = 'pulado', erro = 'A cobrança saiu da régua (paga, em acordo, cancelada ou na cobrança jurídica).'
     where fatura_id = new.id and status = 'agendado';
  end if;
  return null;
end;
$$;
drop trigger if exists faturas_fila_saida_trg on public.faturas;
create trigger faturas_fila_saida_trg after update of status, juridico_id on public.faturas
  for each row execute function privado.tirar_da_fila_de_saida_trg();

drop trigger if exists lancamentos_conta_recebimento_trg on public.lancamentos;
create trigger lancamentos_conta_recebimento_trg after update of conta_id on public.lancamentos
  for each row execute function privado.conta_do_lancamento_trg();

-- -----------------------------------------------------------------------------
-- Auditoria (security definer: grava mesmo sem permissão de escrita na tabela)
-- -----------------------------------------------------------------------------
create or replace function privado.evento_cobranca_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_contrato uuid;
begin
  if tg_op = 'DELETE' then v_org := old.organizacao_id; else v_org := new.organizacao_id; end if;
  -- Organização sendo apagada (cascata): não há o que registrar.
  if not exists (select 1 from organizacoes where id = v_org) then
    return null;
  end if;

  if tg_table_name = 'fatura_pagamentos' then
    if tg_op = 'INSERT' then
      select contrato_id into v_contrato from faturas where id = new.fatura_id;
      insert into cobranca_eventos (organizacao_id, fatura_id, contrato_id, acordo_id, tipo, descricao, valor, usuario_id)
      values (new.organizacao_id, new.fatura_id, v_contrato,
              (select acordo_id from acordo_parcelas where id = new.acordo_parcela_id),
              'pagamento',
              'Recebimento registrado' || case new.origem when 'acordo' then ' (parcela de acordo)' when 'extrato' then ' (baixa automática pelo extrato)'
                when 'arquivo' then ' (baixa automática por arquivo)' when 'automatica' then ' (baixa automática)' else '' end
                || case when new.multa > 0 then ' · multa ' || new.multa::text else '' end
                || case when new.juros > 0 then ' · juros ' || new.juros::text else '' end
                || case when new.desconto > 0 then ' · desconto ' || new.desconto::text else '' end,
              new.valor, auth.uid());
    elsif tg_op = 'DELETE' then
      select contrato_id into v_contrato from faturas where id = old.fatura_id;
      insert into cobranca_eventos (organizacao_id, fatura_id, contrato_id, tipo, descricao, valor, usuario_id)
      values (old.organizacao_id, old.fatura_id, v_contrato, 'pagamento_estornado',
              'Recebimento de ' || to_char(old.pago_em, 'DD/MM/YYYY') || ' desfeito', old.valor, auth.uid());
    end if;
  elsif tg_table_name = 'faturas' then
    if new.status is distinct from old.status then
      insert into cobranca_eventos (organizacao_id, fatura_id, contrato_id, acordo_id, tipo, descricao, valor, usuario_id)
      values (new.organizacao_id, new.id, new.contrato_id, new.acordo_id,
              case new.status when 'paga' then 'quitada' when 'cancelada' then 'cancelada' when 'renegociada' then 'renegociada'
                else case when old.status = 'paga' then 'baixa_desfeita' else 'reaberta' end end,
              case new.status when 'paga' then 'Fatura quitada'
                when 'cancelada' then 'Fatura cancelada' || coalesce(' — ' || new.observacoes, '')
                when 'renegociada' then 'Fatura entrou em acordo'
                else case when old.status = 'paga' then 'Baixa desfeita: a fatura voltou para em aberto' else 'Fatura voltou para cobrança normal' end end,
              case new.status when 'paga' then new.valor_pago else null end, auth.uid());
    end if;
    if new.juridico_id is distinct from old.juridico_id then
      insert into cobranca_eventos (organizacao_id, fatura_id, contrato_id, juridico_id, tipo, descricao, usuario_id)
      values (new.organizacao_id, new.id, new.contrato_id, coalesce(new.juridico_id, old.juridico_id),
              case when new.juridico_id is null then 'juridico_retirado' else 'juridico' end,
              case when new.juridico_id is null then 'Saiu da cobrança jurídica' else 'Encaminhada para cobrança jurídica' end, auth.uid());
    end if;
  elsif tg_table_name = 'acordos' then
    if tg_op = 'INSERT' then
      insert into cobranca_eventos (organizacao_id, contrato_id, acordo_id, tipo, descricao, valor, usuario_id)
      values (new.organizacao_id, new.contrato_id, new.id, 'acordo_criado',
              'Acordo nº ' || new.numero || ' em ' || new.parcelas || ' parcela(s)', new.total, auth.uid());
    elsif tg_op = 'UPDATE' and new.status is distinct from old.status then
      insert into cobranca_eventos (organizacao_id, contrato_id, acordo_id, tipo, descricao, valor, usuario_id)
      values (new.organizacao_id, new.contrato_id, new.id, 'acordo_' || new.status,
              'Acordo nº ' || new.numero || ': ' || case new.status when 'cumprido' then 'cumprido (todas as parcelas pagas)'
                when 'quebrado' then 'quebrado' || coalesce(' — ' || new.quebra_motivo, '') when 'ativo' then 'reativado' else new.status end,
              new.total, auth.uid());
    elsif tg_op = 'DELETE' then
      insert into cobranca_eventos (organizacao_id, contrato_id, acordo_id, tipo, descricao, valor, usuario_id)
      values (old.organizacao_id, old.contrato_id, old.id, 'acordo_excluido', 'Acordo nº ' || old.numero || ' excluído', old.total, auth.uid());
    end if;
  elsif tg_table_name = 'cobrancas_juridicas' then
    if tg_op = 'INSERT' then
      insert into cobranca_eventos (organizacao_id, contrato_id, juridico_id, tipo, descricao, valor, usuario_id)
      values (new.organizacao_id, new.contrato_id, new.id, 'juridico_aberto',
              'Encaminhado para cobrança jurídica' || coalesce(' — ' || new.escritorio, ''), new.valor_encaminhado, auth.uid());
    elsif tg_op = 'UPDATE' and new.situacao is distinct from old.situacao then
      insert into cobranca_eventos (organizacao_id, contrato_id, juridico_id, tipo, descricao, usuario_id)
      values (new.organizacao_id, new.contrato_id, new.id, 'juridico_situacao', 'Cobrança jurídica: ' || new.situacao, auth.uid());
    elsif tg_op = 'DELETE' then
      insert into cobranca_eventos (organizacao_id, contrato_id, juridico_id, tipo, descricao, usuario_id)
      values (old.organizacao_id, old.contrato_id, old.id, 'juridico_excluido', 'Cobrança jurídica excluída', auth.uid());
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists fatura_pagamentos_evento_trg on public.fatura_pagamentos;
create trigger fatura_pagamentos_evento_trg after insert or delete on public.fatura_pagamentos
  for each row execute function privado.evento_cobranca_trg();
drop trigger if exists faturas_evento_trg on public.faturas;
create trigger faturas_evento_trg after update of status, juridico_id on public.faturas
  for each row execute function privado.evento_cobranca_trg();
drop trigger if exists acordos_evento_trg on public.acordos;
create trigger acordos_evento_trg after insert or update or delete on public.acordos
  for each row execute function privado.evento_cobranca_trg();
drop trigger if exists cobrancas_juridicas_evento_trg on public.cobrancas_juridicas;
create trigger cobrancas_juridicas_evento_trg after insert or update or delete on public.cobrancas_juridicas
  for each row execute function privado.evento_cobranca_trg();

-- -----------------------------------------------------------------------------
-- Baixa da fatura: aceita também fatura em acordo e marca os itens da baixa
-- (o restante é igual à versão de 20261102000003)
-- -----------------------------------------------------------------------------
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
  if f.status not in ('aberta', 'renegociada') then
    raise exception 'Fatura não está em aberto (status: %)', f.status;
  end if;

  insert into public.fatura_itens (organizacao_id, fatura_id, descricao, tipo, valor, destino, da_baixa)
  select f.organizacao_id, f.id, i->>'descricao', i->>'tipo', (i->>'valor')::numeric, i->>'destino', true
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
revoke execute on function public.liquidar_fatura(uuid, jsonb) from public, anon;
grant execute on function public.liquidar_fatura(uuid, jsonb) to authenticated;

-- Desfaz a quitação (sem mexer nos pagamentos): repasse pendente, itens da
-- baixa e receita saem; a fatura volta para "aberta" (ou "renegociada", se o
-- acordo dela ainda está ativo).
create or replace function privado.reabrir_fatura(p_fatura_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  f public.faturas%rowtype;
  v_garantido boolean;
  v_em_acordo boolean;
begin
  select * into f from public.faturas where id = p_fatura_id for update;
  if not found or f.status <> 'paga' then
    return;
  end if;
  if exists (select 1 from public.repasses where fatura_id = f.id and status = 'pago') then
    raise exception 'O repasse ao proprietário já foi pago. Desfaça o repasse antes de desfazer o pagamento.';
  end if;
  select (tipo_repasse = 'garantido') into v_garantido from public.contratos where id = f.contrato_id;
  if not coalesce(v_garantido, false) then
    delete from public.repasses where fatura_id = f.id and status = 'pendente';
  end if;
  delete from public.fatura_itens
   where fatura_id = f.id
     and (da_baixa or tipo in ('multa', 'juros') or (tipo = 'desconto' and descricao like 'Desconto de pontualidade%'));
  -- Taxa da imobiliária (e o lançamento antigo, de antes dos recebimentos
  -- separados). O lançamento de cada recebimento (modo pessoal) só sai junto
  -- com o próprio recebimento.
  delete from public.lancamentos where fatura_id = f.id and tipo = 'receber' and fatura_pagamento_id is null;
  select exists (select 1 from public.acordos a where a.id = f.acordo_id and a.status = 'ativo') into v_em_acordo;
  update public.faturas
     set status = case when v_em_acordo then 'renegociada' else 'aberta' end,
         pago_em = null, valor_pago = null, forma_pagamento = null, comprovante_path = null
   where id = f.id;
end;
$$;
revoke execute on function privado.reabrir_fatura(uuid) from public, anon;
grant execute on function privado.reabrir_fatura(uuid) to authenticated;

-- Recebimento de antes do acordo numa fatura que está (ou esteve, se cumprido)
-- num acordo: desfazer mudaria o saldo que o acordo renegociou e o acordo
-- nunca mais fecharia. Primeiro desfaça as parcelas e quebre/exclua o acordo.
create or replace function privado.conferir_estorno_fora_do_acordo(p_fatura public.faturas, p_pg public.fatura_pagamentos)
returns void
language plpgsql security invoker set search_path = ''
as $$
begin
  if p_pg.acordo_parcela_id is null and p_fatura.acordo_id is not null
     and exists (select 1 from public.acordos a where a.id = p_fatura.acordo_id and a.status in ('ativo', 'cumprido')) then
    raise exception 'Esta cobrança está no acordo nº %. Para desfazer um recebimento de antes do acordo, desfaça as parcelas pagas e quebre ou exclua o acordo primeiro.',
      (select numero from public.acordos where id = p_fatura.acordo_id);
  end if;
end;
$$;
revoke execute on function privado.conferir_estorno_fora_do_acordo(public.faturas, public.fatura_pagamentos) from public, anon;
grant execute on function privado.conferir_estorno_fora_do_acordo(public.faturas, public.fatura_pagamentos) to authenticated;

-- Desfazer a baixa ("Aluguéis do mês"): reabre e tira o último recebimento.
create or replace function public.estornar_baixa(p_fatura_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  f public.faturas%rowtype;
  v_pg public.fatura_pagamentos%rowtype;
  v_tem boolean;
begin
  select * into f from public.faturas where id = p_fatura_id for update;
  if not found then
    raise exception 'Fatura não encontrada';
  end if;
  if f.status <> 'paga' then
    raise exception 'Esta fatura não está paga';
  end if;
  select * into v_pg from public.fatura_pagamentos where fatura_id = f.id order by pago_em desc, created_at desc limit 1;
  v_tem := found;
  if v_tem and v_pg.acordo_parcela_id is not null then
    raise exception 'Esta fatura foi paga por uma parcela de acordo. Desfaça o recebimento da parcela no acordo.';
  end if;
  if v_tem then
    perform privado.conferir_estorno_fora_do_acordo(f, v_pg);
  end if;
  perform privado.reabrir_fatura(f.id);
  if v_tem then
    delete from public.fatura_pagamentos where id = v_pg.id;
  end if;
end;
$$;
revoke execute on function public.estornar_baixa(uuid) from public, anon;
grant execute on function public.estornar_baixa(uuid) to authenticated;

-- Desfaz um recebimento (parcial ou o que quitou).
create or replace function public.estornar_pagamento(p_pagamento_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_pg public.fatura_pagamentos%rowtype;
  f public.faturas%rowtype;
begin
  select * into v_pg from public.fatura_pagamentos where id = p_pagamento_id for update;
  if not found then
    raise exception 'Recebimento não encontrado';
  end if;
  if v_pg.acordo_parcela_id is not null then
    raise exception 'Este recebimento veio de uma parcela de acordo. Desfaça pela parcela, na ficha do acordo.';
  end if;
  select * into f from public.faturas where id = v_pg.fatura_id for update;
  perform privado.conferir_estorno_fora_do_acordo(f, v_pg);
  perform privado.reabrir_fatura(v_pg.fatura_id);
  delete from public.fatura_pagamentos where id = v_pg.id;
end;
$$;
revoke execute on function public.estornar_pagamento(uuid) from public, anon;
grant execute on function public.estornar_pagamento(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Registrar recebimento(s) numa transação só. Os cálculos (saldo, multa, juros,
-- repasse, taxas) são feitos na aplicação (src/lib/dominio) e testados.
-- p: {
--   pagamentos: [{fatura_id, pago_em, valor, principal, multa, juros, desconto, forma,
--                 conta_id, origem, acordo_parcela_id, extrato_item_id, observacao, comprovante_path}],
--   liquidacoes: [{fatura_id, p: <payload de liquidar_fatura>, conciliado}],
--   parcela: {id, pago_em, forma, conta_id} | null,
--   chave_baixa: texto | null   (linha do extrato/arquivo: não dá baixa duas vezes)
-- }
-- Imóveis pessoais: cada recebimento com dinheiro vira um lançamento liquidado
-- no Financeiro (na data e na conta dele) — é ele que conta no saldo, no fluxo e
-- na DRE. Na imobiliária o dinheiro é de terceiros e é lido dos recebimentos.
-- -----------------------------------------------------------------------------
create or replace function public.registrar_recebimento(p jsonb)
returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  pg jsonb;
  lq jsonb;
  f public.faturas%rowtype;
  v_id uuid;
  v_ids uuid[] := '{}';
  v_parc public.acordo_parcelas%rowtype;
  v_chave text := nullif(btrim(coalesce(p->>'chave_baixa', '')), '');
  v_pessoal boolean;
  v_codigo text;
  v_imovel uuid;
  v_plano uuid;
begin
  if p ? 'parcela' and jsonb_typeof(p->'parcela') = 'object' then
    select * into v_parc from public.acordo_parcelas where id = (p->'parcela'->>'id')::uuid for update;
    if not found then
      raise exception 'Parcela não encontrada';
    end if;
    if v_parc.status <> 'aberta' then
      raise exception 'Esta parcela não está em aberto.';
    end if;
    if not exists (select 1 from public.acordos where id = v_parc.acordo_id and status = 'ativo') then
      raise exception 'O acordo desta parcela não está ativo.';
    end if;
  end if;

  if v_chave is not null and exists (select 1 from public.fatura_pagamentos where chave_baixa = v_chave) then
    raise exception 'Esta entrada do extrato/arquivo já foi usada numa baixa. Para registrar de novo, desfaça a baixa anterior.';
  end if;

  for pg in select * from jsonb_array_elements(coalesce(p->'pagamentos', '[]'::jsonb)) loop
    select * into f from public.faturas where id = (pg->>'fatura_id')::uuid for update;
    if not found then
      raise exception 'Fatura não encontrada';
    end if;
    if f.status not in ('aberta', 'renegociada') then
      raise exception 'A fatura #% não está em aberto.', f.numero;
    end if;
    if f.valor_abatido + (pg->>'principal')::numeric + coalesce((pg->>'desconto')::numeric, 0) > f.valor_total then
      raise exception 'O valor passa do saldo da fatura #%.', f.numero;
    end if;
    insert into public.fatura_pagamentos (organizacao_id, fatura_id, pago_em, valor, principal, multa, juros, desconto,
      forma, conta_id, origem, acordo_parcela_id, extrato_item_id, observacao, comprovante_path, chave_baixa)
    values (f.organizacao_id, f.id, (pg->>'pago_em')::date, (pg->>'valor')::numeric, (pg->>'principal')::numeric,
      coalesce((pg->>'multa')::numeric, 0), coalesce((pg->>'juros')::numeric, 0), coalesce((pg->>'desconto')::numeric, 0),
      nullif(pg->>'forma', ''), nullif(pg->>'conta_id', '')::uuid, coalesce(nullif(pg->>'origem', ''), 'manual'),
      nullif(pg->>'acordo_parcela_id', '')::uuid, nullif(pg->>'extrato_item_id', '')::uuid,
      nullif(pg->>'observacao', ''), nullif(pg->>'comprovante_path', ''), v_chave)
    returning id into v_id;
    v_ids := v_ids || v_id;
    if nullif(pg->>'extrato_item_id', '') is not null then
      update public.extrato_itens set fatura_id = f.id, ignorado = false where id = (pg->>'extrato_item_id')::uuid;
    end if;

    select (o.modo = 'pessoal') into v_pessoal from public.organizacoes o where o.id = f.organizacao_id;
    if coalesce(v_pessoal, false) and (pg->>'valor')::numeric > 0 then
      select i.codigo, i.id into v_codigo, v_imovel
        from public.contratos c join public.imoveis i on i.id = c.imovel_id where c.id = f.contrato_id;
      select pc.id into v_plano from public.plano_contas pc
       where pc.organizacao_id = f.organizacao_id and pc.tipo = 'receita' and pc.ativo and pc.nome = 'Aluguéis recebidos'
       order by pc.codigo limit 1;
      insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, valor_pago, vencimento, status,
                                      liquidado_em, contrato_id, fatura_id, fatura_pagamento_id, conta_id, imovel_id, forma, plano_id)
      values (f.organizacao_id, 'receber',
              'Aluguel ' || to_char(f.competencia, 'MM/YYYY') || coalesce(' — ' || v_codigo, '')
                || case when coalesce(pg->>'origem', '') = 'acordo' then coalesce(' · ' || nullif(pg->>'observacao', ''), ' · acordo')
                        when f.valor_abatido + (pg->>'principal')::numeric + coalesce((pg->>'desconto')::numeric, 0) < f.valor_total
                          or f.valor_abatido > 0 then ' (pagamento parcial)'
                        else '' end,
              'Aluguel', (pg->>'valor')::numeric, (pg->>'valor')::numeric, (pg->>'pago_em')::date, 'liquidado',
              (pg->>'pago_em')::date, f.contrato_id, f.id, v_id, nullif(pg->>'conta_id', '')::uuid, v_imovel, nullif(pg->>'forma', ''), v_plano);
    end if;
  end loop;

  for lq in select * from jsonb_array_elements(coalesce(p->'liquidacoes', '[]'::jsonb)) loop
    select * into f from public.faturas where id = (lq->>'fatura_id')::uuid;
    if f.valor_abatido < f.valor_total then
      raise exception 'A fatura #% ainda tem saldo; não dá para quitar.', f.numero;
    end if;
    perform public.liquidar_fatura(f.id, lq->'p');
    if coalesce((lq->>'conciliado')::boolean, false) then
      update public.faturas set conciliado_em = now() where id = f.id;
    end if;
  end loop;

  if v_parc.id is not null then
    update public.acordo_parcelas
       set status = 'paga', pago_em = (p->'parcela'->>'pago_em')::date,
           forma = nullif(p->'parcela'->>'forma', ''), conta_id = nullif(p->'parcela'->>'conta_id', '')::uuid
     where id = v_parc.id;
    if not exists (select 1 from public.acordo_parcelas where acordo_id = v_parc.acordo_id and status = 'aberta') then
      update public.acordos set status = 'cumprido', cumprido_em = (p->'parcela'->>'pago_em')::date where id = v_parc.acordo_id;
    end if;
  end if;

  return jsonb_build_object('pagamentos', to_jsonb(v_ids));
end;
$$;
revoke execute on function public.registrar_recebimento(jsonb) from public, anon;
grant execute on function public.registrar_recebimento(jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Acordos: criar, desfazer parcela, quebrar e excluir
-- p: {contrato_id, pessoa_id, data, principal, multa, juros, desconto, total, entrada,
--     parcelas, condicoes, observacoes,
--     faturas: [{fatura_id, principal, multa, juros, desconto, total}],
--     parcelas_lista: [{numero, vencimento, valor}]}
-- -----------------------------------------------------------------------------
create or replace function public.criar_acordo(p jsonb)
returns uuid
language plpgsql security invoker set search_path = ''
as $$
declare
  v_id uuid;
  v_org uuid;
  fx jsonb;
  f public.faturas%rowtype;
  v_soma numeric;
begin
  select organizacao_id into v_org from public.contratos where id = (p->>'contrato_id')::uuid;
  if v_org is null then
    raise exception 'Contrato não encontrado';
  end if;
  if jsonb_array_length(coalesce(p->'faturas', '[]'::jsonb)) = 0 then
    raise exception 'Escolha ao menos uma cobrança para o acordo.';
  end if;
  if jsonb_array_length(coalesce(p->'parcelas_lista', '[]'::jsonb)) = 0 then
    raise exception 'O acordo precisa de ao menos uma parcela.';
  end if;

  insert into public.acordos (organizacao_id, contrato_id, pessoa_id, data, principal, multa, juros, desconto, total,
                              entrada, parcelas, condicoes, observacoes)
  values (v_org, (p->>'contrato_id')::uuid, nullif(p->>'pessoa_id', '')::uuid, coalesce((p->>'data')::date, current_date),
          coalesce((p->>'principal')::numeric, 0), coalesce((p->>'multa')::numeric, 0), coalesce((p->>'juros')::numeric, 0),
          coalesce((p->>'desconto')::numeric, 0), (p->>'total')::numeric, coalesce((p->>'entrada')::numeric, 0),
          coalesce((p->>'parcelas')::int, 1), nullif(p->>'condicoes', ''), nullif(p->>'observacoes', ''))
  returning id into v_id;

  for fx in select * from jsonb_array_elements(p->'faturas') loop
    select * into f from public.faturas where id = (fx->>'fatura_id')::uuid for update;
    if not found or f.contrato_id <> (p->>'contrato_id')::uuid then
      raise exception 'Cobrança não pertence a este contrato.';
    end if;
    if f.status <> 'aberta' then
      raise exception 'A fatura #% não está em aberto.', f.numero;
    end if;
    insert into public.acordo_faturas (organizacao_id, acordo_id, fatura_id, principal, multa, juros, desconto, total)
    values (v_org, v_id, f.id, (fx->>'principal')::numeric, coalesce((fx->>'multa')::numeric, 0),
            coalesce((fx->>'juros')::numeric, 0), coalesce((fx->>'desconto')::numeric, 0), (fx->>'total')::numeric);
    update public.faturas set status = 'renegociada', acordo_id = v_id where id = f.id;
  end loop;

  insert into public.acordo_parcelas (organizacao_id, acordo_id, numero, vencimento, valor)
  select v_org, v_id, (x->>'numero')::int, (x->>'vencimento')::date, (x->>'valor')::numeric
  from jsonb_array_elements(p->'parcelas_lista') as x;

  select coalesce(sum(valor), 0) into v_soma from public.acordo_parcelas where acordo_id = v_id;
  if v_soma <> (p->>'total')::numeric then
    raise exception 'A soma das parcelas (%) não bate com o total do acordo (%).', v_soma, p->>'total';
  end if;
  select coalesce(sum(total), 0) into v_soma from public.acordo_faturas where acordo_id = v_id;
  if v_soma <> (p->>'total')::numeric then
    raise exception 'A soma das cobranças do acordo não bate com o total.';
  end if;
  return v_id;
end;
$$;
revoke execute on function public.criar_acordo(jsonb) from public, anon;
grant execute on function public.criar_acordo(jsonb) to authenticated;

-- Desfaz o recebimento de uma parcela: tira os pagamentos dela das faturas
-- (reabrindo as que tinham sido quitadas) e a parcela volta para "aberta".
create or replace function public.estornar_parcela(p_parcela_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  v_parc public.acordo_parcelas%rowtype;
  v_fat uuid;
begin
  select * into v_parc from public.acordo_parcelas where id = p_parcela_id for update;
  if not found then
    raise exception 'Parcela não encontrada';
  end if;
  if v_parc.status <> 'paga' then
    raise exception 'Esta parcela não está paga.';
  end if;
  if exists (select 1 from public.acordos where id = v_parc.acordo_id and status = 'quebrado') then
    raise exception 'O acordo foi quebrado; o recebimento desta parcela fica no histórico.';
  end if;
  -- Volta o acordo para ativo antes de reabrir (as faturas voltam como "renegociada").
  update public.acordos set status = 'ativo', cumprido_em = null where id = v_parc.acordo_id and status = 'cumprido';
  for v_fat in select distinct fatura_id from public.fatura_pagamentos where acordo_parcela_id = v_parc.id loop
    perform privado.reabrir_fatura(v_fat);
  end loop;
  delete from public.fatura_pagamentos where acordo_parcela_id = v_parc.id;
  update public.acordo_parcelas set status = 'aberta', pago_em = null, forma = null, conta_id = null where id = v_parc.id;
end;
$$;
revoke execute on function public.estornar_parcela(uuid) from public, anon;
grant execute on function public.estornar_parcela(uuid) to authenticated;

-- Quebra do acordo: parcelas em aberto são canceladas e as faturas que ainda
-- não foram quitadas voltam para a cobrança normal (com o saldo que restou).
create or replace function public.quebrar_acordo(p_acordo_id uuid, p_motivo text)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  a public.acordos%rowtype;
begin
  select * into a from public.acordos where id = p_acordo_id for update;
  if not found then
    raise exception 'Acordo não encontrado';
  end if;
  if a.status <> 'ativo' then
    raise exception 'Só um acordo ativo pode ser quebrado.';
  end if;
  update public.acordo_parcelas set status = 'cancelada' where acordo_id = a.id and status = 'aberta';
  update public.acordos set status = 'quebrado', quebrado_em = current_date, quebra_motivo = nullif(btrim(p_motivo), '') where id = a.id;
  update public.faturas set status = 'aberta' where acordo_id = a.id and status = 'renegociada';
end;
$$;
revoke execute on function public.quebrar_acordo(uuid, text) from public, anon;
grant execute on function public.quebrar_acordo(uuid, text) to authenticated;

-- Excluir acordo lançado por engano (só sem nenhuma parcela paga).
create or replace function public.excluir_acordo(p_acordo_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  a public.acordos%rowtype;
begin
  select * into a from public.acordos where id = p_acordo_id for update;
  if not found then
    raise exception 'Acordo não encontrado';
  end if;
  if exists (select 1 from public.acordo_parcelas where acordo_id = a.id and status = 'paga') then
    raise exception 'Este acordo já tem parcela paga. Em vez de excluir, quebre o acordo (o que foi pago fica registrado).';
  end if;
  update public.faturas set status = 'aberta' where acordo_id = a.id and status = 'renegociada';
  update public.faturas set acordo_id = null where acordo_id = a.id;
  delete from public.acordos where id = a.id;
end;
$$;
revoke execute on function public.excluir_acordo(uuid) from public, anon;
grant execute on function public.excluir_acordo(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Rotas públicas (sem login), por token: 2ª via e "já paguei"
-- -----------------------------------------------------------------------------
create or replace function public.segunda_via(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f faturas%rowtype;
  pc acordo_parcelas%rowtype;
  a acordos%rowtype;
  o organizacoes%rowtype;
  c contratos%rowtype;
  im imoveis%rowtype;
  cf contas_financeiras%rowtype;
  v_contrato uuid;
  v_loc text;
  v_tipo text;
begin
  select * into f from faturas where token_publico = p_token;
  if found then
    v_tipo := 'fatura';
    if f.status = 'cancelada' then return null; end if;
    v_contrato := f.contrato_id;
  else
    select * into pc from acordo_parcelas where token_publico = p_token;
    if not found then return null; end if;
    if pc.status = 'cancelada' then return null; end if;
    v_tipo := 'parcela';
    select * into a from acordos where id = pc.acordo_id;
    v_contrato := a.contrato_id;
  end if;

  select * into o from organizacoes where id = coalesce(f.organizacao_id, pc.organizacao_id);
  if not coalesce(o.cobranca_link_publico, true) then return null; end if;
  select * into c from contratos where id = v_contrato;
  select * into im from imoveis where id = c.imovel_id;
  select * into cf from contas_financeiras where id = o.cobranca_conta_id;
  select ps.nome into v_loc from contrato_partes cp join pessoas ps on ps.id = cp.pessoa_id
   where cp.contrato_id = v_contrato and cp.papel = 'locatario' order by ps.nome limit 1;

  return jsonb_build_object(
    'tipo', v_tipo,
    'organizacao', jsonb_build_object('nome', o.nome, 'documento', o.documento, 'telefone', o.telefone, 'email', o.email,
      'pix_chave', coalesce(nullif(o.cobranca_pix_chave, ''), cf.pix_chave), 'pix_nome', coalesce(nullif(o.cobranca_pix_nome, ''), o.nome),
      'pix_cidade', o.cobranca_pix_cidade, 'meios', to_jsonb(o.cobranca_meios), 'instrucoes', o.cobranca_instrucoes,
      'banco', cf.banco, 'agencia', cf.agencia, 'conta', cf.conta, 'modo', o.modo),
    'imovel', jsonb_build_object('codigo', im.codigo, 'logradouro', im.logradouro, 'numero', im.numero, 'complemento', im.complemento,
      'bairro', im.bairro, 'cidade', im.cidade, 'uf', im.uf),
    'locatario', v_loc,
    'contrato', jsonb_build_object('numero', c.numero, 'multa_pct', c.multa_atraso_pct, 'juros_mes_pct', c.juros_mes_pct,
      'carencia_dias', c.carencia_dias, 'pontualidade_pct', c.desconto_pontualidade_pct, 'valor_aluguel', c.valor_aluguel),
    'fatura', case when v_tipo = 'fatura' then jsonb_build_object(
      'numero', f.numero, 'competencia', f.competencia, 'vencimento', f.vencimento, 'valor_total', f.valor_total,
      'valor_abatido', f.valor_abatido, 'valor_recebido', f.valor_recebido, 'status', f.status, 'pago_em', f.pago_em,
      'valor_pago', f.valor_pago, 'linha_digitavel', f.linha_digitavel, 'url_pagamento', f.url_pagamento,
      'periodo_inicio', f.periodo_inicio, 'periodo_fim', f.periodo_fim,
      'itens', (select coalesce(jsonb_agg(jsonb_build_object('descricao', i.descricao, 'valor', i.valor, 'tipo', i.tipo) order by i.valor desc), '[]'::jsonb)
                  from fatura_itens i where i.fatura_id = f.id),
      'multa_cobrada', (select coalesce(sum(multa), 0) from fatura_pagamentos where fatura_id = f.id),
      'ultimo_pagamento', (select max(pago_em) from fatura_pagamentos where fatura_id = f.id and pago_em > f.vencimento)
    ) else null end,
    'parcela', case when v_tipo = 'parcela' then jsonb_build_object(
      'numero', pc.numero, 'vencimento', pc.vencimento, 'valor', pc.valor, 'status', pc.status, 'pago_em', pc.pago_em,
      'acordo', a.numero, 'parcelas', a.parcelas, 'tem_entrada', a.entrada > 0
    ) else null end
  );
end;
$$;
revoke execute on function public.segunda_via(uuid) from public;
grant execute on function public.segunda_via(uuid) to anon, authenticated;

-- "Link aberto": só leitura não marca nada (prévia de link do WhatsApp e a
-- equipe abrindo para conferir não contam). A página pública chama isto pelo
-- navegador de quem abriu, sem login, no máximo um registro a cada 6 horas.
create or replace function public.registrar_visita_segunda_via(p_token uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  f faturas%rowtype;
begin
  select * into f from faturas where token_publico = p_token;
  if not found or f.status not in ('aberta', 'renegociada') then
    return false;
  end if;
  if f.segunda_via_vista_em is not null and f.segunda_via_vista_em > now() - interval '6 hours' then
    return false;
  end if;
  update faturas set segunda_via_vista_em = now() where id = f.id;
  insert into cobranca_eventos (organizacao_id, fatura_id, contrato_id, tipo, descricao)
  values (f.organizacao_id, f.id, f.contrato_id, 'segunda_via_vista', 'Link da 2ª via aberto fora do sistema (provavelmente pelo locatário)');
  return true;
end;
$$;
revoke execute on function public.registrar_visita_segunda_via(uuid) from public;
grant execute on function public.registrar_visita_segunda_via(uuid) to anon, authenticated;

-- "Já paguei" na 2ª via: vira um contato de cobrança para a equipe conferir.
create or replace function public.informar_pagamento(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  f faturas%rowtype;
  pc acordo_parcelas%rowtype;
  a acordos%rowtype;
  v_org uuid;
  v_contrato uuid;
  v_fatura uuid;
  v_acordo uuid;
  v_data date := coalesce(nullif(p->>'data', '')::date, current_date);
  v_msg text := left(btrim(coalesce(p->>'mensagem', '')), 500);
begin
  select * into f from faturas where token_publico = p_token;
  if found then
    if f.status <> 'aberta' then raise exception 'Esta cobrança não está em aberto.'; end if;
    v_org := f.organizacao_id; v_contrato := f.contrato_id; v_fatura := f.id;
  else
    select * into pc from acordo_parcelas where token_publico = p_token;
    if not found then raise exception 'Link inválido.'; end if;
    if pc.status <> 'aberta' then raise exception 'Esta parcela não está em aberto.'; end if;
    select * into a from acordos where id = pc.acordo_id;
    v_org := pc.organizacao_id; v_contrato := a.contrato_id; v_acordo := a.id;
  end if;
  if v_data > current_date + 1 or v_data < current_date - 60 then
    raise exception 'Informe a data em que pagou.';
  end if;
  if (select count(*) from cobranca_contatos
       where organizacao_id = v_org and resultado = 'informou_pagamento'
         and coalesce(fatura_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_fatura, '00000000-0000-0000-0000-000000000000'::uuid)
         and coalesce(acordo_id, '00000000-0000-0000-0000-000000000000'::uuid) = coalesce(v_acordo, '00000000-0000-0000-0000-000000000000'::uuid)
         and created_at > now() - interval '1 day') >= 3 then
    raise exception 'Já recebemos seu aviso. Aguarde a confirmação.';
  end if;
  insert into cobranca_contatos (organizacao_id, contrato_id, fatura_id, acordo_id, canal, direcao, resultado, descricao,
                                 promessa_data, promessa_status, usuario_id)
  values (v_org, v_contrato, v_fatura, v_acordo, 'link', 'entrada', 'informou_pagamento',
          'Locatário informou pelo link que pagou em ' || to_char(v_data, 'DD/MM/YYYY') || coalesce(nullif(' — ' || v_msg, ' — '), ''),
          v_data, 'pendente', null);
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.informar_pagamento(uuid, jsonb) from public;
grant execute on function public.informar_pagamento(uuid, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Dinheiro dos aluguéis para o Financeiro (saldo das contas, fluxo e DRE),
-- sem contar duas vezes:
--   - cada recebimento, na data e na conta dele (inclui os parciais), menos os
--     que já viraram lançamento (modo pessoal: o lançamento é que conta);
--   - faturas pagas antes dos recebimentos separados existirem: a baixa
--     antiga, na data do pagamento. Se a baixa antiga já tinha o lançamento de
--     aluguel do modo pessoal, ela não entra no resultado (o lançamento entra)
--     e só leva a conta quando o lançamento não tem conta.
-- RLS das tabelas vale (security_invoker).
-- -----------------------------------------------------------------------------
create or replace view public.alugueis_recebidos with (security_invoker = true) as
select p.id,
       p.organizacao_id,
       p.fatura_id,
       f.numero as fatura_numero,
       p.pago_em as data,
       p.valor,
       p.conta_id,
       true as entra_no_resultado
  from public.fatura_pagamentos p
  join public.faturas f on f.id = p.fatura_id
 where p.valor > 0
   and not exists (select 1 from public.lancamentos l where l.fatura_pagamento_id = p.id)
union all
select f.id,
       f.organizacao_id,
       f.id,
       f.numero,
       f.pago_em,
       coalesce(f.valor_pago, f.valor_total),
       case when exists (select 1 from public.lancamentos l
                          where l.fatura_id = f.id and l.tipo = 'receber' and l.categoria = 'Aluguel' and l.conta_id is not null)
            then null else f.conta_id end,
       not exists (select 1 from public.lancamentos l where l.fatura_id = f.id and l.tipo = 'receber' and l.categoria = 'Aluguel')
  from public.faturas f
 where f.status = 'paga' and f.pago_em is not null
   and not exists (select 1 from public.fatura_pagamentos p where p.fatura_id = f.id);
grant select on public.alugueis_recebidos to authenticated;
