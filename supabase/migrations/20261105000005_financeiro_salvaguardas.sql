-- =============================================================================
-- Salvaguardas do financeiro (achados da revisão da etapa 10):
-- 1) aprovação de pagamentos garantida no banco (vale para qualquer tela,
--    RPC ou chamada direta à API);
-- 2) só admin/gestor mudam o limite de aprovação e a alíquota de ISS;
-- 3) desconto de adiantamento volta a ficar pendente se o repasse for
--    apagado ou cancelado;
-- 4) desfazer/cancelar o pagamento de um aluguel solta a conciliação;
-- 5) apagar linha do extrato solta a conciliação do que estava ligado;
-- 6) excluir conta com transferências é recusado (não muda o saldo da outra);
-- 7) histórico com mais campos e sem travar a exclusão da organização.
-- =============================================================================

-- 1) Aprovação de pagamentos -------------------------------------------------
create or replace function privado.lancamentos_aprovacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_limite numeric;
  v_gestor boolean;
begin
  select aprovacao_pagamento_acima into v_limite from public.organizacoes where id = new.organizacao_id;
  -- Sem usuário (gatilhos internos, manutenção) conta como sistema.
  v_gestor := auth.uid() is null or privado.pode_ver_restrito(new.organizacao_id);

  -- "Precisa de aprovação" é sempre derivado do valor e do limite atual.
  new.requer_aprovacao := new.tipo = 'pagar' and coalesce(v_limite, 0) > 0 and new.valor > v_limite;

  if tg_op = 'UPDATE' then
    -- Mudou valor, tipo ou quem recebe: a aprovação anterior deixa de valer.
    if old.aprovado_em is not null
       and (new.valor is distinct from old.valor or new.tipo is distinct from old.tipo or new.pessoa_id is distinct from old.pessoa_id) then
      new.aprovado_em := null;
    end if;
    if new.aprovado_em is not null and old.aprovado_em is null then
      if not v_gestor then
        raise exception 'Só administradores e gestores aprovam pagamentos.';
      end if;
      new.aprovado_por := coalesce(auth.uid(), new.aprovado_por);
    end if;
  elsif new.aprovado_em is not null then
    if not v_gestor then
      raise exception 'Só administradores e gestores aprovam pagamentos.';
    end if;
    new.aprovado_por := coalesce(auth.uid(), new.aprovado_por);
  end if;
  if new.aprovado_em is null then
    new.aprovado_por := null;
  end if;

  -- Baixa de pagamento acima do limite só com aprovação.
  if new.status = 'liquidado' and (tg_op = 'INSERT' or old.status is distinct from 'liquidado')
     and new.tipo = 'pagar' and new.aprovado_em is null
     and coalesce(v_limite, 0) > 0 and greatest(new.valor, coalesce(new.valor_pago, 0)) > v_limite then
    raise exception 'Este pagamento passa do limite de aprovação (R$ %). Um administrador ou gestor precisa aprovar antes da baixa.',
      replace(to_char(v_limite, 'FM999999990.00'), '.', ',');
  end if;
  return new;
end;
$$;
create or replace trigger lancamentos_aprovacao_trg before insert or update on public.lancamentos
  for each row execute function privado.lancamentos_aprovacao();

-- 2) Limite de aprovação e ISS só por admin/gestor -----------------------------
create or replace function privado.organizacao_regras_financeiras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.aprovacao_pagamento_acima is distinct from old.aprovacao_pagamento_acima
      or new.aliquota_iss is distinct from old.aliquota_iss)
     and auth.uid() is not null and not privado.pode_ver_restrito(old.id) then
    raise exception 'Só administradores e gestores mudam as regras do financeiro.';
  end if;
  return new;
end;
$$;
create or replace trigger organizacoes_regras_financeiras_trg before update on public.organizacoes
  for each row execute function privado.organizacao_regras_financeiras();

-- 3) Repasse apagado/cancelado devolve adiantamentos e despesas a descontar ---
create or replace function privado.repasse_solta_descontos()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' or (new.status = 'cancelado' and old.status is distinct from 'cancelado') then
    update public.lancamentos set compensado_em = null, repasse_id = null where repasse_id = old.id and adiantamento;
    update public.lancamentos set repasse_id = null where repasse_id = old.id and descontar_repasse;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;
create or replace trigger repasses_solta_descontos_trg before delete or update of status on public.repasses
  for each row execute function privado.repasse_solta_descontos();

-- 4) Aluguel que deixa de estar pago solta a conciliação ---------------------
create or replace function privado.fatura_solta_conciliacao()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'paga' and new.status is distinct from 'paga' then
    new.conta_id := null;
    new.conciliado_em := null;
    update public.extrato_itens set fatura_id = null where fatura_id = old.id;
  end if;
  return new;
end;
$$;
create or replace trigger faturas_solta_conciliacao_trg before update of status on public.faturas
  for each row execute function privado.fatura_solta_conciliacao();

-- 5) Linha do extrato apagada solta o que estava conciliado com ela ----------
create or replace function privado.extrato_item_solta()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.lancamento_id is not null then
    update public.lancamentos set conciliado_em = null where id = old.lancamento_id;
  end if;
  if old.fatura_id is not null then
    update public.faturas set conciliado_em = null where id = old.fatura_id;
  end if;
  if old.repasse_id is not null then
    update public.repasses set conciliado_em = null where id = old.repasse_id;
  end if;
  return old;
end;
$$;
create or replace trigger extrato_itens_solta_trg before delete on public.extrato_itens
  for each row execute function privado.extrato_item_solta();

-- 6) Transferências impedem excluir a conta (senão o saldo da outra conta muda) --
create or replace function privado.conta_com_transferencias()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (select 1 from public.transferencias where origem_id = old.id or destino_id = old.id) then
    raise exception 'Esta conta tem transferências registradas; excluir mudaria o saldo da outra conta. Desative a conta em vez de excluir (ou exclua as transferências antes).';
  end if;
  return old;
end;
$$;
create or replace trigger contas_financeiras_transferencias_trg before delete on public.contas_financeiras
  for each row execute function privado.conta_com_transferencias();

-- 7) Histórico: mais campos; não trava a exclusão da organização -------------
create or replace function privado.registrar_historico_lancamento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_acao text;
  campos text[] := array[
    'tipo','descricao','categoria','valor','vencimento','status','liquidado_em','valor_pago','juros','desconto',
    'conta_id','plano_id','centro_custo_id','pessoa_id','imovel_id','forma','documento_numero','observacoes',
    'requer_aprovacao','aprovado_em','aprovado_por','cancelado_motivo','terceiros','adiantamento','compensado_em',
    'conciliado_em','descontar_repasse','repasse_id','parcela','parcelas'];
  a jsonb;
  b jsonb;
begin
  if tg_op = 'INSERT' then
    insert into public.lancamento_historico (organizacao_id, lancamento_id, acao, depois, usuario_id)
    values (new.organizacao_id, new.id, 'criado', jsonb_build_object('descricao', new.descricao, 'valor', new.valor, 'vencimento', new.vencimento, 'status', new.status), auth.uid());
    return new;
  elsif tg_op = 'DELETE' then
    -- A organização inteira está sendo apagada: não há onde registrar.
    if not exists (select 1 from public.organizacoes where id = old.organizacao_id) then
      return old;
    end if;
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

-- 8) Desconto de adiantamento no repasse: tudo numa operação só ---------------
create or replace function public.compensar_adiantamento(p_lancamento uuid)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  l public.lancamentos%rowtype;
  r public.repasses%rowtype;
begin
  select * into l from public.lancamentos where id = p_lancamento for update;
  if not found or not l.adiantamento then
    raise exception 'Adiantamento não encontrado.';
  end if;
  if l.status <> 'liquidado' then
    raise exception 'Só dá para descontar um adiantamento que já foi pago.';
  end if;
  if l.compensado_em is not null then
    raise exception 'Este adiantamento já foi descontado.';
  end if;
  select * into r from public.repasses
   where pessoa_id = l.pessoa_id and status = 'pendente'
   order by previsto_para limit 1 for update;
  if not found then
    raise exception 'Não há repasse pendente deste proprietário para descontar.';
  end if;
  if r.valor_liquido < l.valor then
    raise exception 'O próximo repasse é menor que o adiantamento. Desconte em partes manualmente em Repasses.';
  end if;
  update public.repasses
     set outros_descontos = outros_descontos + l.valor,
         valor_liquido = valor_liquido - l.valor,
         observacoes = concat_ws(' · ', nullif(observacoes, ''), 'Adiantamento descontado: R$ ' || replace(to_char(l.valor, 'FM999999990.00'), '.', ','))
   where id = r.id;
  update public.lancamentos set compensado_em = current_date, repasse_id = r.id where id = l.id;
  return r.id;
end;
$$;
revoke execute on function public.compensar_adiantamento(uuid) from public, anon;
grant execute on function public.compensar_adiantamento(uuid) to authenticated;

create or replace function public.descompensar_adiantamento(p_lancamento uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  l public.lancamentos%rowtype;
  r public.repasses%rowtype;
begin
  select * into l from public.lancamentos where id = p_lancamento for update;
  if not found or not l.adiantamento or l.compensado_em is null then
    raise exception 'Este adiantamento não está descontado.';
  end if;
  if l.repasse_id is not null then
    select * into r from public.repasses where id = l.repasse_id for update;
    if found and r.status = 'pago' then
      raise exception 'O repasse com o desconto já foi pago; não dá para desfazer.';
    end if;
    if found and r.status = 'pendente' then
      update public.repasses
         set outros_descontos = greatest(outros_descontos - l.valor, 0),
             valor_liquido = valor_liquido + l.valor,
             observacoes = concat_ws(' · ', nullif(observacoes, ''), 'Desconto de adiantamento desfeito: R$ ' || replace(to_char(l.valor, 'FM999999990.00'), '.', ','))
       where id = r.id;
    end if;
  end if;
  update public.lancamentos set compensado_em = null, repasse_id = null where id = l.id;
end;
$$;
revoke execute on function public.descompensar_adiantamento(uuid) from public, anon;
grant execute on function public.descompensar_adiantamento(uuid) to authenticated;
