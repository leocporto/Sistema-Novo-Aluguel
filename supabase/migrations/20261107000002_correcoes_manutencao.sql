-- =============================================================================
-- Manutenção (etapa 14): correções da revisão.
-- - Nada de referência de outra organização no chamado, nos orçamentos, nas
--   fotos, no histórico e nos lançamentos (gatilhos "mesma organização") e as
--   funções security definer filtram pela organização do chamado.
-- - Papel conferido no banco: o corretor não decide (quem paga, valor,
--   prestador, aprovação, recusa/cancelamento, conclusão, exclusão) nem pela API
--   REST; as RPCs de decisão exigem administrador, gestor ou financeiro.
-- - Resposta "pelo link" só pela página do proprietário (a equipe registra só
--   como "registro manual"); link novo a cada pedido de aprovação; a resposta
--   confere a "versão" do que o proprietário viu.
-- - Histórico do chamado preso ao usuário real e ao horário do banco.
-- - Fatura cancelada solta a cobrança do locatário; desfazer/excluir recusam
--   fatura com recebimento (parcial) e travam os lançamentos antes de conferir
--   o repasse; conta a receber do locatário por RPC (sem duplicar).
-- - Agenda ↔ chamado: remarcar/cancelar o compromisso atualiza o chamado.
-- - Locatário só confirma o serviço depois do horário marcado.
-- - Envio anônimo de fotos: só logo depois de abrir, até 20 por chamado e só
--   extensões de foto/vídeo; limites por organização e por telefone na abertura.
-- - Datas "do dia" no fuso de São Paulo.
-- Sem DROP: create or replace, alter policy e checagens em blocos DO.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Ajudantes
-- -----------------------------------------------------------------------------

/** Administrador, gestor ou financeiro da organização (quem decide na manutenção). */
create or replace function privado.manutencao_decide(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(privado.papel_atual(p_org), '') in ('admin', 'gestor', 'financeiro')
$$;
revoke execute on function privado.manutencao_decide(uuid) from public, anon;
grant execute on function privado.manutencao_decide(uuid) to authenticated;

/** Organização do chamado (lida como dona: serve para herdar e conferir). */
create or replace function privado.chamado_org(p_chamado uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select organizacao_id from public.chamados where id = p_chamado
$$;
revoke execute on function privado.chamado_org(uuid) from public, anon;
grant execute on function privado.chamado_org(uuid) to authenticated;

/** O registro apontado pelo chamado é da mesma organização? (vazio = ok). */
create or replace function privado.chamado_ref_ok(p_org uuid, p_tabela text, p_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v uuid;
begin
  if p_id is null then return true; end if;
  case p_tabela
    when 'imoveis' then select organizacao_id into v from public.imoveis where id = p_id;
    when 'contratos' then select organizacao_id into v from public.contratos where id = p_id;
    when 'pessoas' then select organizacao_id into v from public.pessoas where id = p_id;
    when 'visitas' then select organizacao_id into v from public.visitas where id = p_id;
    when 'chamados' then select organizacao_id into v from public.chamados where id = p_id;
    when 'fatura_itens' then select organizacao_id into v from public.fatura_itens where id = p_id;
    else raise exception 'Tabela não prevista: %', p_tabela;
  end case;
  return v is not null and v = p_org;
end;
$$;
revoke execute on function privado.chamado_ref_ok(uuid, text, uuid) from public, anon;
grant execute on function privado.chamado_ref_ok(uuid, text, uuid) to authenticated;

/** "Versão" do pedido de aprovação: muda quando muda o que o proprietário vê (orçamento, valor, parte, quem paga). */
create or replace function privado.versao_aprovacao(p_chamado uuid)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(concat_ws('|', c.orcamento_id, c.valor_aprovado, c.pct_proprietario, c.pago_direto, c.responsabilidade, c.aprovacao_token))
    from public.chamados c where c.id = p_chamado
$$;
revoke execute on function privado.versao_aprovacao(uuid) from public, anon;
grant execute on function privado.versao_aprovacao(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Chamados: mesma organização, papel do corretor, resposta do proprietário,
-- "A definir" depois do orçamento e link novo a cada pedido de aprovação.
-- "Direto" = o próprio usuário pela API (papel authenticated); dentro das
-- funções security definer (link público, sincronização com a agenda…) o
-- usuário corrente é o dono das funções e estas travas não se aplicam.
-- -----------------------------------------------------------------------------
create or replace function privado.chamados_conferir()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_ins boolean := tg_op = 'INSERT';
  v_direto boolean := current_user in ('authenticated', 'anon');
  v_papel text;
  v_resposta boolean;
  v_msg_papel constant text := 'Só administradores, gestores e o financeiro fazem isto.';
begin
  if not v_ins and new.organizacao_id is distinct from old.organizacao_id then
    raise exception 'Não dá para passar o chamado para outra organização.';
  end if;

  -- 1) Tudo o que o chamado aponta é da mesma organização.
  if (v_ins or new.imovel_id is distinct from old.imovel_id) and not privado.chamado_ref_ok(new.organizacao_id, 'imoveis', new.imovel_id) then
    raise exception 'Imóvel não encontrado.';
  end if;
  if (v_ins or new.contrato_id is distinct from old.contrato_id) and not privado.chamado_ref_ok(new.organizacao_id, 'contratos', new.contrato_id) then
    raise exception 'Contrato não encontrado.';
  end if;
  if (v_ins or new.prestador_id is distinct from old.prestador_id) and not privado.chamado_ref_ok(new.organizacao_id, 'pessoas', new.prestador_id) then
    raise exception 'Prestador não encontrado.';
  end if;
  if (v_ins or new.solicitante_pessoa_id is distinct from old.solicitante_pessoa_id) and not privado.chamado_ref_ok(new.organizacao_id, 'pessoas', new.solicitante_pessoa_id) then
    raise exception 'Cadastro de quem pediu não encontrado.';
  end if;
  if (v_ins or new.visita_id is distinct from old.visita_id) and not privado.chamado_ref_ok(new.organizacao_id, 'visitas', new.visita_id) then
    raise exception 'Compromisso da agenda não encontrado.';
  end if;
  if (v_ins or new.chamado_origem_id is distinct from old.chamado_origem_id) and not privado.chamado_ref_ok(new.organizacao_id, 'chamados', new.chamado_origem_id) then
    raise exception 'Chamado de origem (garantia) não encontrado.';
  end if;
  if (v_ins or new.fatura_item_id is distinct from old.fatura_item_id) and not privado.chamado_ref_ok(new.organizacao_id, 'fatura_itens', new.fatura_item_id) then
    raise exception 'Item de fatura não encontrado.';
  end if;
  if new.orcamento_id is not null and (v_ins or new.orcamento_id is distinct from old.orcamento_id)
     and not exists (select 1 from public.chamado_orcamentos o where o.id = new.orcamento_id and o.chamado_id = new.id and o.organizacao_id = new.organizacao_id) then
    raise exception 'Orçamento não encontrado neste chamado.';
  end if;

  if v_direto then
    v_papel := coalesce(privado.papel_atual(new.organizacao_id), '');

    -- 2) A resposta do proprietário: pelo link só a página dele grava; a equipe
    --    (administrador, gestor ou financeiro) registra como "registro manual".
    v_resposta := case when v_ins then
        new.aprovacao_status in ('aprovado', 'recusado')
        or coalesce(new.aprovacao_em::text, new.aprovacao_nome, new.aprovacao_canal, new.aprovacao_ip, new.aprovacao_obs) is not null
      else
        (new.aprovacao_status in ('aprovado', 'recusado') and new.aprovacao_status is distinct from old.aprovacao_status)
        or (new.aprovacao_em is not null and new.aprovacao_em is distinct from old.aprovacao_em)
        or (new.aprovacao_nome is not null and new.aprovacao_nome is distinct from old.aprovacao_nome)
        or (new.aprovacao_canal is not null and new.aprovacao_canal is distinct from old.aprovacao_canal)
        or (new.aprovacao_ip is not null and new.aprovacao_ip is distinct from old.aprovacao_ip)
        or (new.aprovacao_obs is not null and new.aprovacao_obs is distinct from old.aprovacao_obs)
      end;
    if v_resposta then
      if v_papel not in ('admin', 'gestor', 'financeiro') then
        raise exception '%', v_msg_papel;
      end if;
      if new.aprovacao_canal is distinct from 'manual' or new.aprovacao_ip is not null then
        raise exception 'A resposta pelo link é gravada só pela página do proprietário. Para registrar o que ele disse, use “Registrar resposta”.';
      end if;
    end if;

    -- 3) Corretor abre chamados, pede orçamentos, agenda e avalia; não decide.
    if v_papel = 'corretor' then
      if v_ins then
        if new.status <> 'aberto' or new.responsabilidade is not null or new.pct_locatario <> 0 or new.pct_proprietario <> 0
           or new.pct_imobiliaria <> 0 or new.pago_direto or new.valor_aprovado is not null or new.orcamento_id is not null
           or new.aprovacao_status <> 'nao_precisa' or new.status_antes_aprovacao is not null or new.valor_final is not null
           or new.concluido_em is not null or new.conclusao_aprovada_em is not null or new.garantia_ate is not null
           or new.cobranca_locatario is not null or new.fatura_item_id is not null then
          raise exception '%', v_msg_papel;
        end if;
      else
        if (new.responsabilidade, new.pct_locatario, new.pct_proprietario, new.pct_imobiliaria, new.pago_direto, new.valor_aprovado,
            new.prestador_id, new.orcamento_id, new.aprovacao_status, new.aprovacao_token, new.status_antes_aprovacao, new.valor_final,
            new.concluido_em, new.conclusao_aprovada_em, new.conclusao_aprovada_por, new.conclusao_obs, new.garantia_dias, new.garantia_ate,
            new.cobranca_locatario, new.fatura_item_id, new.upload_token)
           is distinct from
           (old.responsabilidade, old.pct_locatario, old.pct_proprietario, old.pct_imobiliaria, old.pago_direto, old.valor_aprovado,
            old.prestador_id, old.orcamento_id, old.aprovacao_status, old.aprovacao_token, old.status_antes_aprovacao, old.valor_final,
            old.concluido_em, old.conclusao_aprovada_em, old.conclusao_aprovada_por, old.conclusao_obs, old.garantia_dias, old.garantia_ate,
            old.cobranca_locatario, old.fatura_item_id, old.upload_token) then
          raise exception '%', v_msg_papel;
        end if;
        if new.status is distinct from old.status
           and old.status || '>' || new.status not in ('aberto>em_analise', 'aprovado>agendado', 'aprovado>em_execucao', 'agendado>em_execucao',
                                                       'concluido>avaliado', 'avaliado>concluido') then
          raise exception '%', v_msg_papel;
        end if;
      end if;
    end if;
  end if;

  -- 4) Depois de escolhido o orçamento, quem paga não volta para "A definir"
  --    (a aprovação e o financeiro precisam olhar a mesma regra).
  if not v_ins and new.responsabilidade is null and old.responsabilidade is not null and new.orcamento_id is not null then
    raise exception 'Depois de escolher o orçamento, defina quem paga o conserto (não dá para voltar para “A definir”).';
  end if;

  -- 5) Cada novo pedido de aprovação tem um link novo (o antigo para de valer).
  if not v_ins and new.aprovacao_status = 'pendente' and old.aprovacao_status is distinct from 'pendente' then
    new.aprovacao_token := gen_random_uuid();
  end if;
  return new;
end;
$$;
create or replace trigger chamados_conferir_trg before insert or update on public.chamados
  for each row execute function privado.chamados_conferir();

/** Excluir chamado (pela API também) é de administrador, gestor ou financeiro. */
create or replace function privado.chamados_excluir_conferir()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if current_user in ('authenticated', 'anon') and not privado.manutencao_decide(old.organizacao_id) then
    raise exception 'Só administradores, gestores e o financeiro fazem isto.';
  end if;
  return old;
end;
$$;
create or replace trigger chamados_excluir_trg before delete on public.chamados
  for each row execute function privado.chamados_excluir_conferir();

-- Orçamentos: organização herdada do chamado, prestador da mesma organização e
-- corretor sem escolher, sem trocar valor já informado e sem excluir.
create or replace function privado.chamado_orcamentos_conferir()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
  v_corretor boolean;
begin
  if tg_op = 'DELETE' then
    if current_user in ('authenticated', 'anon') and coalesce(privado.papel_atual(old.organizacao_id), '') not in ('admin', 'gestor', 'financeiro') then
      raise exception 'Só administradores, gestores e o financeiro excluem orçamentos.';
    end if;
    return old;
  end if;
  if tg_op = 'UPDATE' and new.chamado_id is distinct from old.chamado_id then
    raise exception 'Não dá para passar o orçamento para outro chamado.';
  end if;
  v_org := privado.chamado_org(new.chamado_id);
  if v_org is null then raise exception 'Chamado não encontrado.'; end if;
  new.organizacao_id := v_org;
  if (tg_op = 'INSERT' or new.prestador_id is distinct from old.prestador_id) and not privado.chamado_ref_ok(v_org, 'pessoas', new.prestador_id) then
    raise exception 'Prestador não encontrado.';
  end if;
  v_corretor := current_user in ('authenticated', 'anon') and coalesce(privado.papel_atual(v_org), '') not in ('admin', 'gestor', 'financeiro');
  if v_corretor then
    if new.status = 'escolhido' and (tg_op = 'INSERT' or old.status is distinct from 'escolhido') then
      raise exception 'Só administradores, gestores e o financeiro escolhem o orçamento.';
    end if;
    if tg_op = 'UPDATE' and ((old.status = 'escolhido' and new.status is distinct from old.status)
                             or (old.valor is not null and new.valor is distinct from old.valor)) then
      raise exception 'Só administradores, gestores e o financeiro mudam um valor já informado.';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger chamado_orcamentos_conferir_trg before insert or update or delete on public.chamado_orcamentos
  for each row execute function privado.chamado_orcamentos_conferir();

/** Fotos/vídeos: organização herdada do chamado. */
create or replace function privado.chamado_midias_conferir()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
begin
  if tg_op = 'UPDATE' and new.chamado_id is distinct from old.chamado_id then
    raise exception 'Não dá para passar o arquivo para outro chamado.';
  end if;
  v_org := privado.chamado_org(new.chamado_id);
  if v_org is null then raise exception 'Chamado não encontrado.'; end if;
  new.organizacao_id := v_org;
  return new;
end;
$$;
create or replace trigger chamado_midias_conferir_trg before insert or update on public.chamado_midias
  for each row execute function privado.chamado_midias_conferir();

/**
 * Histórico: organização herdada do chamado; quem está logado fica como autor
 * e a data é a do banco. Gravação direta (pelo app) só dos tipos de anotação;
 * os demais (status, aprovação pelo link…) vêm dos gatilhos e RPCs.
 */
create or replace function privado.chamado_eventos_conferir()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_org uuid;
begin
  v_org := privado.chamado_org(new.chamado_id);
  if v_org is null then raise exception 'Chamado não encontrado.'; end if;
  new.organizacao_id := v_org;
  if auth.uid() is not null then
    new.usuario_id := auth.uid();
    new.data := now();
  end if;
  if current_user in ('authenticated', 'anon') and new.tipo not in ('nota', 'orcamento', 'garantia', 'financeiro', 'aprovacao') then
    raise exception 'Este tipo de registro é gravado só pelo sistema.';
  end if;
  return new;
end;
$$;
create or replace trigger chamado_eventos_conferir_trg before insert on public.chamado_eventos
  for each row execute function privado.chamado_eventos_conferir();

/** Lançamento só aponta chamado da mesma organização. */
create or replace function privado.lancamentos_chamado_conferir()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.chamado_id is not null and privado.chamado_org(new.chamado_id) is distinct from new.organizacao_id then
    raise exception 'Chamado não encontrado.';
  end if;
  return new;
end;
$$;
create or replace trigger lancamentos_chamado_trg before insert or update of chamado_id on public.lancamentos
  for each row execute function privado.lancamentos_chamado_conferir();

-- -----------------------------------------------------------------------------
-- Histórico automático: nome do prestador só da mesma organização; horário de
-- São Paulo.
-- -----------------------------------------------------------------------------
create or replace function privado.chamados_historico()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  if tg_op = 'INSERT' then
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (new.organizacao_id, new.id, 'aberto',
      case when new.origem = 'link' then 'Chamado aberto pelo locatário pelo link' || coalesce(' (' || new.solicitante_nome || ')', '')
           else 'Chamado aberto' end || ' · urgência ' || privado.rotulo_chamado(new.urgencia),
      auth.uid());
    return new;
  end if;
  if new.status is distinct from old.status then
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (new.organizacao_id, new.id, 'status',
      privado.rotulo_chamado(old.status) || ' → ' || privado.rotulo_chamado(new.status)
        || case when new.status in ('recusado','cancelado') and coalesce(btrim(new.motivo), '') <> '' then ' · motivo: ' || new.motivo else '' end,
      auth.uid());
  end if;
  if new.urgencia is distinct from old.urgencia then
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (new.organizacao_id, new.id, 'urgencia', 'Urgência: ' || privado.rotulo_chamado(old.urgencia) || ' → ' || privado.rotulo_chamado(new.urgencia), auth.uid());
  end if;
  if new.responsabilidade is distinct from old.responsabilidade and new.responsabilidade is not null then
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (new.organizacao_id, new.id, 'responsabilidade', 'Responsabilidade: ' || privado.rotulo_chamado(new.responsabilidade), auth.uid());
  end if;
  if new.prestador_id is distinct from old.prestador_id and new.prestador_id is not null then
    select nome into v_nome from public.pessoas where id = new.prestador_id and organizacao_id = new.organizacao_id;
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (new.organizacao_id, new.id, 'prestador', 'Prestador: ' || coalesce(v_nome, '—'), auth.uid());
  end if;
  if new.agendado_para is distinct from old.agendado_para and new.agendado_para is not null then
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (new.organizacao_id, new.id, 'agenda',
      'Serviço marcado para ' || to_char(new.agendado_para at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI'), auth.uid());
  end if;
  if new.aprovacao_status is distinct from old.aprovacao_status and new.aprovacao_status <> 'nao_precisa' then
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (new.organizacao_id, new.id, 'aprovacao',
      case new.aprovacao_status
        when 'pendente' then 'Aprovação do proprietário solicitada'
        when 'aprovado' then 'Proprietário aprovou o orçamento'
        else 'Proprietário recusou o orçamento' end
      || coalesce(' · ' || new.aprovacao_nome, '')
      || case when new.aprovacao_status <> 'pendente' and new.aprovacao_canal = 'link' then ' (pelo link)' when new.aprovacao_status <> 'pendente' and new.aprovacao_canal = 'manual' then ' (registro manual)' else '' end
      || case when new.aprovacao_status <> 'pendente' and coalesce(btrim(new.aprovacao_obs), '') <> '' then ' · ' || new.aprovacao_obs else '' end,
      auth.uid());
  end if;
  if new.locatario_confirmou_em is distinct from old.locatario_confirmou_em and new.locatario_confirmou_em is not null then
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (new.organizacao_id, new.id, 'confirmacao',
      'Locatário confirmou que o serviço foi feito' || coalesce(' · ' || nullif(btrim(new.locatario_comentario), ''), ''), auth.uid());
  end if;
  if new.avaliacao_nota is distinct from old.avaliacao_nota and new.avaliacao_nota is not null then
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (new.organizacao_id, new.id, 'avaliacao', 'Prestador avaliado: ' || new.avaliacao_nota || ' de 5', auth.uid());
  end if;
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Financeiro do chamado
-- -----------------------------------------------------------------------------
create or replace function public.cobrar_chamado_na_fatura(p_chamado uuid, p_fatura uuid, p_valor numeric, p_descricao text, p_destino text)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  ch public.chamados%rowtype;
  f public.faturas%rowtype;
  v_item uuid;
begin
  select * into ch from public.chamados where id = p_chamado for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if not privado.manutencao_decide(ch.organizacao_id) then
    raise exception 'Só administradores, gestores e o financeiro fazem isto.';
  end if;
  if ch.fatura_item_id is not null then raise exception 'A cobrança deste chamado já está numa fatura.'; end if;
  if exists (select 1 from public.lancamentos where chamado_id = ch.id and tipo = 'receber' and status <> 'cancelado') then
    raise exception 'A cobrança do locatário já está no Financeiro (conta a receber).';
  end if;
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor a cobrar do locatário.'; end if;
  select * into f from public.faturas where id = p_fatura for update;
  if not found or f.contrato_id is distinct from ch.contrato_id or f.organizacao_id is distinct from ch.organizacao_id then
    raise exception 'Fatura não encontrada para o contrato deste chamado.';
  end if;
  if f.status <> 'aberta' then raise exception 'Só dá para lançar em fatura em aberto.'; end if;
  insert into public.fatura_itens (organizacao_id, fatura_id, descricao, tipo, valor, destino)
  values (f.organizacao_id, f.id, left(coalesce(nullif(btrim(p_descricao), ''), 'Manutenção #' || ch.numero), 200), 'outro', round(p_valor, 2),
          case when p_destino in ('proprietario','imobiliaria','terceiro') then p_destino else 'imobiliaria' end)
  returning id into v_item;
  update public.faturas set valor_total = valor_total + round(p_valor, 2) where id = f.id;
  update public.chamados set fatura_item_id = v_item, cobranca_locatario = 'fatura' where id = ch.id;
  insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao)
  values (ch.organizacao_id, ch.id, 'financeiro', 'Cobrança do locatário lançada na fatura #' || f.numero || ': R$ ' || replace(to_char(round(p_valor, 2), 'FM999999990.00'), '.', ','));
  return v_item;
end;
$$;
revoke execute on function public.cobrar_chamado_na_fatura(uuid, uuid, numeric, text, text) from public, anon;
grant execute on function public.cobrar_chamado_na_fatura(uuid, uuid, numeric, text, text) to authenticated;

/**
 * Parte do locatário → conta a receber no Financeiro (com o chamado travado:
 * dois cliques, ou "Lançar na fatura" ao mesmo tempo, não duplicam).
 * p: { valor, vencimento, pessoa_id, descricao }
 */
create or replace function public.chamado_conta_receber(p_chamado uuid, p jsonb)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  ch public.chamados%rowtype;
  v_valor numeric := round(coalesce(nullif(p->>'valor', '')::numeric, 0), 2);
  v_id uuid;
begin
  select * into ch from public.chamados where id = p_chamado for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if not privado.manutencao_decide(ch.organizacao_id) then
    raise exception 'Só administradores, gestores e o financeiro fazem isto.';
  end if;
  if ch.status not in ('concluido', 'avaliado') then raise exception 'O chamado ainda não foi concluído.'; end if;
  if ch.fatura_item_id is not null then raise exception 'A cobrança já está numa fatura.'; end if;
  if exists (select 1 from public.lancamentos where chamado_id = ch.id and tipo = 'receber' and status <> 'cancelado') then
    raise exception 'A cobrança do locatário já está no Financeiro (conta a receber).';
  end if;
  if v_valor <= 0 then raise exception 'Informe o valor a cobrar do locatário.'; end if;
  insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status, pessoa_id, contrato_id, imovel_id, chamado_id)
  values (ch.organizacao_id, 'receber',
          left(coalesce(nullif(btrim(p->>'descricao'), ''), 'Reembolso de manutenção — chamado #' || ch.numero), 300),
          'Manutenção', v_valor,
          coalesce(nullif(p->>'vencimento', '')::date, (now() at time zone 'America/Sao_Paulo')::date),
          'aberto', nullif(p->>'pessoa_id', '')::uuid, ch.contrato_id, ch.imovel_id, ch.id)
  returning id into v_id;
  update public.chamados set cobranca_locatario = 'receber' where id = ch.id;
  insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao)
  values (ch.organizacao_id, ch.id, 'financeiro', 'Conta a receber do locatário criada: R$ ' || replace(to_char(v_valor, 'FM999999990.00'), '.', ','));
  return v_id;
end;
$$;
revoke execute on function public.chamado_conta_receber(uuid, jsonb) from public, anon;
grant execute on function public.chamado_conta_receber(uuid, jsonb) to authenticated;

create or replace function public.concluir_chamado(p_chamado uuid, p jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ch public.chamados%rowtype;
begin
  select * into ch from public.chamados where id = p_chamado for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if not privado.manutencao_decide(ch.organizacao_id) then
    raise exception 'Só administradores, gestores e o financeiro aprovam a conclusão.';
  end if;
  if ch.status not in ('aprovado','agendado','em_execucao') then
    raise exception 'Só dá para concluir um chamado aprovado, agendado ou em execução (agora: %).', privado.rotulo_chamado(ch.status);
  end if;
  if exists (select 1 from public.lancamentos where chamado_id = ch.id and status <> 'cancelado') then
    raise exception 'Este chamado já tem lançamentos no financeiro.';
  end if;
  insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status, pessoa_id,
                                  contrato_id, imovel_id, chamado_id, descontar_repasse, terceiros, plano_id)
  select ch.organizacao_id, l->>'tipo', left(l->>'descricao', 300), 'Manutenção', round((l->>'valor')::numeric, 2), (l->>'vencimento')::date, 'aberto',
         nullif(l->>'pessoa_id', '')::uuid, ch.contrato_id, ch.imovel_id, ch.id, coalesce((l->>'descontar_repasse')::boolean, false),
         coalesce((l->>'terceiros')::boolean, false), nullif(l->>'plano_id', '')::uuid
    from jsonb_array_elements(coalesce(p->'lancamentos', '[]'::jsonb)) l
   where (l->>'valor')::numeric > 0;
  update public.chamados set
    status = 'concluido',
    concluido_em = coalesce((p->>'concluido_em')::date, (now() at time zone 'America/Sao_Paulo')::date),
    valor_final = nullif(p->>'valor_final', '')::numeric,
    conclusao_aprovada_em = now(),
    conclusao_aprovada_por = left(nullif(btrim(p->>'aprovado_por'), ''), 160),
    conclusao_obs = nullif(btrim(p->>'obs'), ''),
    garantia_dias = nullif(p->>'garantia_dias', '')::int,
    garantia_ate = nullif(p->>'garantia_ate', '')::date,
    cobranca_locatario = nullif(p->>'cobranca_locatario', '')
  where id = ch.id;
  if jsonb_typeof(p->'fatura') = 'object' then
    perform public.cobrar_chamado_na_fatura(ch.id, (p->'fatura'->>'fatura_id')::uuid, (p->'fatura'->>'valor')::numeric,
                                            p->'fatura'->>'descricao', p->'fatura'->>'destino');
  end if;
  -- O compromisso da agenda deixa de ficar pendente.
  if ch.visita_id is not null then
    update public.visitas set status = 'realizada' where id = ch.visita_id and organizacao_id = ch.organizacao_id and status = 'agendada';
    if found then
      insert into public.visita_eventos (organizacao_id, visita_id, tipo, descricao)
      values (ch.organizacao_id, ch.visita_id, 'realizada', 'Serviço do chamado de manutenção #' || ch.numero || ' concluído');
    end if;
  end if;
end;
$$;
revoke execute on function public.concluir_chamado(uuid, jsonb) from public, anon;
grant execute on function public.concluir_chamado(uuid, jsonb) to authenticated;

create or replace function privado.chamado_descontado_em_repasse(p_chamado uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v boolean := false;
  v_org uuid := privado.chamado_org(p_chamado);
begin
  if exists (select 1 from public.lancamentos where chamado_id = p_chamado and organizacao_id = v_org and repasse_id is not null) then
    return true;
  end if;
  if to_regclass('public.repasse_descontos') is not null then
    execute 'select exists (select 1 from public.repasse_descontos d join public.lancamentos l on l.id = d.lancamento_id where l.chamado_id = $1 and l.organizacao_id = $2)'
      into v using p_chamado, v_org;
  end if;
  return coalesce(v, false);
end;
$$;
revoke execute on function privado.chamado_descontado_em_repasse(uuid) from public, anon;
grant execute on function privado.chamado_descontado_em_repasse(uuid) to authenticated;

/**
 * Volta o chamado para "em execução" e tira do Financeiro o que ainda não foi
 * pago. Trava os lançamentos antes de conferir o repasse (o repasse aprovado ao
 * mesmo tempo espera ou é visto). Fatura com recebimento (mesmo parcial) não
 * perde o item; fatura cancelada só solta o vínculo.
 */
create or replace function public.desfazer_conclusao_chamado(p_chamado uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ch public.chamados%rowtype;
  it public.fatura_itens%rowtype;
  f public.faturas%rowtype;
begin
  select * into ch from public.chamados where id = p_chamado for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if not privado.manutencao_decide(ch.organizacao_id) then
    raise exception 'Só administradores, gestores e o financeiro fazem isto.';
  end if;
  if ch.status not in ('concluido','avaliado') then raise exception 'Este chamado não está concluído.'; end if;
  perform 1 from public.lancamentos where chamado_id = ch.id for update;
  if exists (select 1 from public.lancamentos where chamado_id = ch.id and status = 'liquidado') then
    raise exception 'Já houve pagamento ou recebimento ligado a este chamado. Estorne no Financeiro antes de desfazer.';
  end if;
  if privado.chamado_descontado_em_repasse(ch.id) then
    raise exception 'A despesa já foi descontada (toda ou em parte) num repasse. Desfaça o desconto no repasse antes.';
  end if;
  if ch.fatura_item_id is not null then
    select * into it from public.fatura_itens where id = ch.fatura_item_id;
    select * into f from public.faturas where id = it.fatura_id for update;
    if f.status = 'aberta' then
      if coalesce(f.valor_abatido, 0) > 0 or exists (select 1 from public.fatura_pagamentos where fatura_id = f.id) then
        raise exception 'A fatura #% já recebeu pagamento (mesmo que parcial). Desfaça o recebimento em Cobranças antes de desfazer a conclusão.', f.numero;
      end if;
      update public.chamados set fatura_item_id = null where id = ch.id;
      delete from public.fatura_itens where id = it.id;
      update public.faturas set valor_total = valor_total - it.valor where id = f.id;
    elsif f.status = 'cancelada' then
      update public.chamados set fatura_item_id = null where id = ch.id;
    else
      raise exception 'A cobrança do locatário já está numa fatura paga ou em acordo (#%); não dá para desfazer.', f.numero;
    end if;
  end if;
  delete from public.lancamentos where chamado_id = ch.id;
  update public.chamados set
    status = 'em_execucao', concluido_em = null, valor_final = null, conclusao_aprovada_em = null, conclusao_aprovada_por = null,
    conclusao_obs = null, garantia_ate = null, cobranca_locatario = null, avaliacao_nota = null, avaliacao_comentario = null, avaliado_em = null
  where id = ch.id;
  insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao)
  values (ch.organizacao_id, ch.id, 'financeiro', 'Conclusão desfeita: lançamentos em aberto retirados do financeiro');
end;
$$;
revoke execute on function public.desfazer_conclusao_chamado(uuid) from public, anon;
grant execute on function public.desfazer_conclusao_chamado(uuid) to authenticated;

/** Exclui o chamado com o que ele gerou e ainda não foi pago (lançamentos, item de fatura aberta sem recebimento, compromisso agendado). */
create or replace function public.excluir_chamado(p_chamado uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ch public.chamados%rowtype;
  it public.fatura_itens%rowtype;
  f public.faturas%rowtype;
begin
  select * into ch from public.chamados where id = p_chamado for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if not privado.manutencao_decide(ch.organizacao_id) then
    raise exception 'Só administradores, gestores e o financeiro fazem isto.';
  end if;
  perform 1 from public.lancamentos where chamado_id = ch.id for update;
  if exists (select 1 from public.lancamentos where chamado_id = ch.id and status = 'liquidado') then
    raise exception 'Este chamado tem pagamento ou recebimento já baixado no Financeiro. Estorne a baixa antes de excluir.';
  end if;
  if privado.chamado_descontado_em_repasse(ch.id) then
    raise exception 'A despesa deste chamado já foi descontada (toda ou em parte) num repasse. Desfaça o desconto antes de excluir.';
  end if;
  if ch.fatura_item_id is not null then
    select * into it from public.fatura_itens where id = ch.fatura_item_id;
    select * into f from public.faturas where id = it.fatura_id for update;
    if f.status = 'aberta' then
      if coalesce(f.valor_abatido, 0) > 0 or exists (select 1 from public.fatura_pagamentos where fatura_id = f.id) then
        raise exception 'A fatura #% já recebeu pagamento (mesmo que parcial) com a cobrança deste chamado. Desfaça o recebimento em Cobranças antes de excluir.', f.numero;
      end if;
      update public.chamados set fatura_item_id = null where id = ch.id;
      delete from public.fatura_itens where id = it.id;
      update public.faturas set valor_total = valor_total - it.valor where id = f.id;
    elsif f.status = 'cancelada' then
      update public.chamados set fatura_item_id = null where id = ch.id;
    else
      raise exception 'A cobrança do locatário deste chamado já está numa fatura paga ou em acordo (#%). Não dá para excluir o chamado.', f.numero;
    end if;
  end if;
  delete from public.lancamentos where chamado_id = ch.id;
  if ch.visita_id is not null then
    delete from public.visitas where id = ch.visita_id and organizacao_id = ch.organizacao_id and status = 'agendada';
  end if;
  delete from public.chamados where id = ch.id;
end;
$$;
revoke execute on function public.excluir_chamado(uuid) from public, anon;
grant execute on function public.excluir_chamado(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Página pública do locatário
-- -----------------------------------------------------------------------------
create or replace function public.info_chamado_link(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  k public.chamado_links%rowtype;
  c public.contratos%rowtype;
  i public.imoveis%rowtype;
  v_org text;
  v_tel text;
  v_loc text;
begin
  select * into k from public.chamado_links where token = p_token and ativo;
  if not found then return null; end if;
  -- O contrato precisa ser da mesma organização do link.
  select * into c from public.contratos where id = k.contrato_id and organizacao_id = k.organizacao_id;
  if not found then return null; end if;
  select * into i from public.imoveis where id = c.imovel_id and organizacao_id = k.organizacao_id;
  select nome, telefone into v_org, v_tel from public.organizacoes where id = k.organizacao_id;
  select p.nome into v_loc from public.contrato_partes cp join public.pessoas p on p.id = cp.pessoa_id and p.organizacao_id = k.organizacao_id
   where cp.contrato_id = c.id and cp.papel = 'locatario' order by cp.percentual desc nulls last limit 1;
  return jsonb_build_object(
    'organizacao', v_org,
    'telefone', v_tel,
    'imovel', i.codigo,
    'endereco', nullif(concat_ws(', ', nullif(concat_ws(', ', i.logradouro, i.numero), ''), i.complemento, i.bairro, i.cidade), ''),
    'locatario', split_part(coalesce(v_loc, ''), ' ', 1),
    'ativo', c.status = 'ativo',
    'chamados', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', x.id, 'numero', x.numero, 'titulo', x.titulo, 'categoria', x.categoria, 'urgencia', x.urgencia, 'status', x.status,
        'criado_em', x.created_at, 'agendado_para', x.agendado_para, 'concluido_em', x.concluido_em, 'garantia_ate', x.garantia_ate,
        'confirmado', x.locatario_confirmou_em is not null) order by x.created_at desc), '[]'::jsonb)
      from (select * from public.chamados where contrato_id = c.id and organizacao_id = k.organizacao_id order by created_at desc limit 20) x)
  );
end;
$$;
revoke execute on function public.info_chamado_link(uuid) from public;
grant execute on function public.info_chamado_link(uuid) to anon, authenticated;

/**
 * Abertura pelo locatário. Limites contra abuso: 10 por dia por link
 * (contrato), 5 por dia por telefone e 200 por dia por organização.
 */
create or replace function public.abrir_chamado_link(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.chamado_links%rowtype;
  c public.contratos%rowtype;
  v_nome text := left(btrim(coalesce(p->>'nome', '')), 160);
  v_titulo text := left(btrim(coalesce(p->>'titulo', '')), 160);
  v_cat text := coalesce(p->>'categoria', 'outros');
  v_urg text := coalesce(p->>'urgencia', 'media');
  v_tel text := left(nullif(btrim(p->>'telefone'), ''), 40);
  v_digitos text := regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g');
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_loc uuid;
  v_origem uuid;
  v_id uuid;
  v_numero bigint;
  v_upload uuid;
begin
  select * into k from public.chamado_links where token = p_token and ativo;
  if not found then raise exception 'Link inválido ou desativado. Peça um novo link à administração do imóvel.'; end if;
  select * into c from public.contratos where id = k.contrato_id and organizacao_id = k.organizacao_id;
  if not found then raise exception 'Link inválido ou desativado. Peça um novo link à administração do imóvel.'; end if;
  if c.status <> 'ativo' then raise exception 'Este contrato não está ativo. Fale com a administração do imóvel.'; end if;
  if length(v_nome) < 2 then raise exception 'Digite seu nome.'; end if;
  if length(v_titulo) < 3 then raise exception 'Diga em poucas palavras qual é o problema.'; end if;
  if v_cat not in ('hidraulica','eletrica','telhado','eletrodomestico','pintura','chaveiro','outros') then v_cat := 'outros'; end if;
  if v_urg not in ('baixa','media','alta','emergencia') then v_urg := 'media'; end if;
  if (select count(*) from public.chamados where contrato_id = c.id and organizacao_id = k.organizacao_id and origem = 'link' and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Muitos chamados abertos hoje por este link. Fale com a administração do imóvel.';
  end if;
  if length(v_digitos) >= 8 and (
       select count(*) from public.chamados
        where organizacao_id = k.organizacao_id and origem = 'link' and created_at > now() - interval '1 day'
          and regexp_replace(coalesce(solicitante_telefone, ''), '\D', '', 'g') = v_digitos) >= 5 then
    raise exception 'Muitos chamados abertos hoje com este telefone. Fale com a administração do imóvel.';
  end if;
  if (select count(*) from public.chamados where organizacao_id = k.organizacao_id and origem = 'link' and created_at > now() - interval '1 day') >= 200 then
    raise exception 'Não foi possível abrir o chamado agora. Tente mais tarde ou fale com a administração do imóvel.';
  end if;
  select cp.pessoa_id into v_loc from public.contrato_partes cp join public.pessoas pe on pe.id = cp.pessoa_id and pe.organizacao_id = k.organizacao_id
   where cp.contrato_id = c.id and cp.papel = 'locatario' order by cp.percentual desc nulls last limit 1;
  -- Mesmo problema com serviço ainda na garantia: aponta o chamado anterior.
  select id into v_origem from public.chamados
   where organizacao_id = k.organizacao_id and imovel_id = c.imovel_id and categoria = v_cat
     and status in ('concluido','avaliado') and garantia_ate >= v_hoje
   order by garantia_ate desc limit 1;
  insert into public.chamados (organizacao_id, imovel_id, contrato_id, origem, aberto_por, solicitante_pessoa_id, solicitante_nome,
                               solicitante_telefone, categoria, urgencia, titulo, descricao, local, chamado_origem_id, criado_por)
  values (c.organizacao_id, c.imovel_id, c.id, 'link', 'locatario', v_loc, v_nome,
          v_tel, v_cat, v_urg, v_titulo, left(nullif(btrim(p->>'descricao'), ''), 4000),
          left(nullif(btrim(p->>'local'), ''), 120), v_origem, null)
  returning id, numero, upload_token into v_id, v_numero, v_upload;
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'upload_token', v_upload,
                            'pasta', c.organizacao_id::text || '/' || v_id::text || '/' || v_upload::text,
                            'garantia', v_origem is not null);
end;
$$;
revoke execute on function public.abrir_chamado_link(uuid, jsonb) from public;
grant execute on function public.abrir_chamado_link(uuid, jsonb) to anon, authenticated;

/**
 * Envio anônimo ao Storage (policy de INSERT do bucket): além da pasta certa
 * (chamado_pode_enviar), só nas 2 primeiras horas depois de abrir, até 20
 * arquivos por chamado e só extensões de foto/vídeo.
 */
create or replace function public.chamado_pode_enviar_novo(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partes text[] := string_to_array(coalesce(p_nome, ''), '/');
  v_ext text := lower(substring(coalesce(p_nome, '') from '\.([A-Za-z0-9]+)$'));
  v_qtd int;
begin
  if not public.chamado_pode_enviar(p_nome) then return false; end if;
  if v_ext is null or v_ext not in ('jpg', 'jpeg', 'png', 'webp', 'heic', 'mp4', 'mov', 'webm') then return false; end if;
  if not exists (select 1 from public.chamados where id = v_partes[2]::uuid and created_at > now() - interval '2 hours') then return false; end if;
  begin
    select count(*) into v_qtd from storage.objects o
     where o.bucket_id = 'manutencao' and o.name like v_partes[1] || '/' || v_partes[2] || '/' || v_partes[3] || '/%';
  exception when insufficient_privilege or undefined_table then
    -- Sem acesso à contagem: valem a janela de 2 horas e o limite de chamados por dia.
    v_qtd := 0;
  end;
  return v_qtd < 20;
end;
$$;
revoke execute on function public.chamado_pode_enviar_novo(text) from public;
grant execute on function public.chamado_pode_enviar_novo(text) to anon, authenticated;

do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'manutencao_enviar_link') then
    execute $p$alter policy manutencao_enviar_link on storage.objects
      with check (bucket_id = 'manutencao' and public.chamado_pode_enviar_novo(name))$p$;
  end if;
  -- Ninguém envia PDF neste bucket (o app só aceita foto e vídeo).
  if to_regclass('storage.buckets') is not null then
    update storage.buckets
       set allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','video/mp4','video/quicktime','video/webm']
     where id = 'manutencao';
  end if;
end $$;

/** Locatário confirma, pelo link, que o serviço foi feito (só depois do horário marcado). */
create or replace function public.confirmar_servico_chamado(p_token uuid, p_chamado uuid, p_comentario text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  k public.chamado_links%rowtype;
  ch public.chamados%rowtype;
begin
  select * into k from public.chamado_links where token = p_token and ativo;
  if not found then raise exception 'Link inválido ou desativado.'; end if;
  select * into ch from public.chamados where id = p_chamado and contrato_id = k.contrato_id and organizacao_id = k.organizacao_id for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if not (ch.status in ('em_execucao','concluido','avaliado') or (ch.status = 'agendado' and ch.agendado_para <= now())) then
    raise exception 'Este chamado ainda não teve o serviço feito.';
  end if;
  if ch.locatario_confirmou_em is not null then raise exception 'Você já confirmou este serviço. Obrigado!'; end if;
  update public.chamados set locatario_confirmou_em = now(), locatario_comentario = left(nullif(btrim(p_comentario), ''), 1000) where id = ch.id;
end;
$$;
revoke execute on function public.confirmar_servico_chamado(uuid, uuid, text) from public;
grant execute on function public.confirmar_servico_chamado(uuid, uuid, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Aprovação do proprietário
-- -----------------------------------------------------------------------------
create or replace function public.info_aprovacao_chamado(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  ch public.chamados%rowtype;
  i public.imoveis%rowtype;
  o public.organizacoes%rowtype;
begin
  select * into ch from public.chamados where aprovacao_token = p_token;
  if not found or ch.aprovacao_status not in ('pendente','aprovado','recusado') then return null; end if;
  select * into o from public.organizacoes where id = ch.organizacao_id;
  if o.modo = 'pessoal' then return null; end if;
  select * into i from public.imoveis where id = ch.imovel_id and organizacao_id = ch.organizacao_id;
  return jsonb_build_object(
    'organizacao', o.nome,
    'numero', ch.numero, 'titulo', ch.titulo, 'descricao', ch.descricao, 'categoria', ch.categoria, 'urgencia', ch.urgencia,
    'status', ch.status, 'aprovacao_status', ch.aprovacao_status, 'aprovacao_nome', ch.aprovacao_nome, 'aprovacao_em', ch.aprovacao_em,
    'imovel', i.codigo,
    'endereco', nullif(concat_ws(', ', nullif(concat_ws(', ', i.logradouro, i.numero), ''), i.complemento, i.bairro, i.cidade), ''),
    'responsabilidade', ch.responsabilidade, 'pct_proprietario', ch.pct_proprietario, 'pago_direto', ch.pago_direto,
    'valor', ch.valor_aprovado,
    'parte_proprietario', round(coalesce(ch.valor_aprovado, 0) * ch.pct_proprietario / 100, 2),
    'versao', privado.versao_aprovacao(ch.id),
    'orcamentos', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'prestador', coalesce(p.nome, x.prestador_nome), 'especialidade', p.especialidade, 'valor', x.valor, 'prazo_dias', x.prazo_dias,
        'garantia_dias', x.garantia_dias, 'descricao', x.descricao, 'escolhido', x.id = ch.orcamento_id) order by x.valor nulls last), '[]'::jsonb)
      from public.chamado_orcamentos x left join public.pessoas p on p.id = x.prestador_id and p.organizacao_id = ch.organizacao_id
      where x.chamado_id = ch.id and x.organizacao_id = ch.organizacao_id and x.valor is not null)
  );
end;
$$;
revoke execute on function public.info_aprovacao_chamado(uuid) from public;
grant execute on function public.info_aprovacao_chamado(uuid) to anon, authenticated;

create or replace function privado.aplicar_resposta_aprovacao(p_chamado uuid, p_aprovar boolean, p_nome text, p_obs text, p_canal text, p_ip text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ch public.chamados%rowtype;
  v_motivo text;
begin
  select * into ch from public.chamados where id = p_chamado for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if ch.aprovacao_status <> 'pendente' or ch.status <> 'aguardando_aprovacao' then
    raise exception 'Este orçamento não está mais aguardando a resposta do proprietário.';
  end if;
  if p_aprovar then
    update public.chamados set
      aprovacao_status = 'aprovado', status = coalesce(ch.status_antes_aprovacao, 'aprovado'), status_antes_aprovacao = null,
      aprovacao_em = now(), aprovacao_nome = p_nome, aprovacao_canal = p_canal, aprovacao_obs = p_obs, aprovacao_ip = p_ip
    where id = ch.id;
    return;
  end if;
  update public.chamados set
    aprovacao_status = 'recusado', status = 'em_analise', status_antes_aprovacao = null, agendado_para = null, iniciado_em = null,
    aprovacao_em = now(), aprovacao_nome = p_nome, aprovacao_canal = p_canal, aprovacao_obs = p_obs, aprovacao_ip = p_ip
  where id = ch.id;
  if ch.orcamento_id is not null then
    update public.chamado_orcamentos set status = 'recebido'
     where id = ch.orcamento_id and chamado_id = ch.id and organizacao_id = ch.organizacao_id and status = 'escolhido';
  end if;
  if ch.visita_id is not null then
    v_motivo := 'Proprietário recusou o orçamento do chamado de manutenção #' || ch.numero;
    update public.visitas set status = 'cancelada', motivo_cancelamento = v_motivo
     where id = ch.visita_id and organizacao_id = ch.organizacao_id and status = 'agendada';
    if found then
      insert into public.visita_eventos (organizacao_id, visita_id, tipo, descricao) values (ch.organizacao_id, ch.visita_id, 'cancelada', v_motivo);
    end if;
  end if;
end;
$$;
revoke execute on function privado.aplicar_resposta_aprovacao(uuid, boolean, text, text, text, text) from public, anon;
grant execute on function privado.aplicar_resposta_aprovacao(uuid, boolean, text, text, text, text) to authenticated;

/**
 * Resposta pelo link. p: { aprovar, nome, obs, ip, versao }.
 * "versao" vem da página (info_aprovacao_chamado): se o orçamento, o valor, a
 * parte do proprietário ou quem paga mudaram depois que ele abriu a página, a
 * resposta é recusada e ele precisa recarregar. O IP é só informativo (vem de
 * quem chama).
 */
create or replace function public.responder_aprovacao_chamado(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ch public.chamados%rowtype;
  v_modo text;
  v_nome text := left(btrim(coalesce(p->>'nome', '')), 160);
  v_aprovar boolean := coalesce((p->>'aprovar')::boolean, false);
begin
  select * into ch from public.chamados where aprovacao_token = p_token for update;
  if not found then raise exception 'Link de aprovação inválido.'; end if;
  select modo into v_modo from public.organizacoes where id = ch.organizacao_id;
  if v_modo = 'pessoal' then raise exception 'Link de aprovação inválido.'; end if;
  if ch.aprovacao_status <> 'pendente' or ch.status <> 'aguardando_aprovacao' then
    raise exception 'Este orçamento não está mais aguardando a sua resposta.';
  end if;
  if coalesce(p->>'versao', '') is distinct from privado.versao_aprovacao(ch.id) then
    raise exception 'Os valores deste orçamento mudaram depois que você abriu a página. Recarregue a página e confira antes de responder.';
  end if;
  if length(v_nome) < 3 then raise exception 'Digite seu nome completo.'; end if;
  perform privado.aplicar_resposta_aprovacao(ch.id, v_aprovar, v_nome, left(nullif(btrim(p->>'obs'), ''), 1000), 'link', left(nullif(btrim(p->>'ip'), ''), 64));
  return jsonb_build_object('ok', true, 'aprovado', v_aprovar);
end;
$$;
revoke execute on function public.responder_aprovacao_chamado(uuid, jsonb) from public;
grant execute on function public.responder_aprovacao_chamado(uuid, jsonb) to anon, authenticated;

/** Resposta do proprietário registrada pela equipe (administrador, gestor ou financeiro). Só imobiliária. */
create or replace function public.registrar_aprovacao_chamado(p_chamado uuid, p jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  ch public.chamados%rowtype;
  v_nome text := left(btrim(coalesce(p->>'nome', '')), 160);
begin
  select * into ch from public.chamados where id = p_chamado;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if (select modo from public.organizacoes where id = ch.organizacao_id) = 'pessoal' then
    raise exception 'No modo pessoal não há aprovação de proprietário.';
  end if;
  if not privado.manutencao_decide(ch.organizacao_id) then
    raise exception 'Só administradores, gestores e o financeiro registram a resposta do proprietário.';
  end if;
  if length(v_nome) < 2 then raise exception 'Informe quem respondeu.'; end if;
  perform privado.aplicar_resposta_aprovacao(ch.id, coalesce((p->>'aprovar')::boolean, false), v_nome,
                                             left(nullif(btrim(p->>'obs'), ''), 1000), 'manual', null);
end;
$$;
revoke execute on function public.registrar_aprovacao_chamado(uuid, jsonb) from public, anon;
grant execute on function public.registrar_aprovacao_chamado(uuid, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- Juntar cadastros repetidos: roda como dona (o corretor também junta
-- cadastros e as travas do chamado não devem barrar a troca do prestador),
-- conferindo que os dois cadastros são da organização de quem chama.
-- -----------------------------------------------------------------------------
create or replace function privado.manutencao_juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizacao_id into v_org from public.pessoas where id = p_remover;
  if v_org is null or not exists (select 1 from privado.org_ids() o where o = v_org)
     or not exists (select 1 from public.pessoas where id = p_manter and organizacao_id = v_org) then
    raise exception 'Cadastro não encontrado.';
  end if;
  update public.chamados set prestador_id = p_manter where prestador_id = p_remover and organizacao_id = v_org;
  update public.chamados set solicitante_pessoa_id = p_manter where solicitante_pessoa_id = p_remover and organizacao_id = v_org;
  update public.chamado_orcamentos set prestador_id = p_manter where prestador_id = p_remover and organizacao_id = v_org;
end;
$$;
revoke execute on function privado.manutencao_juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function privado.manutencao_juntar_pessoas(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- Agenda → chamado: remarcar ou cancelar o compromisso na Agenda atualiza o
-- chamado (data marcada; cancelado → volta para "Aprovado" e pede agendar de novo).
-- -----------------------------------------------------------------------------
create or replace function privado.visitas_chamados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ch record;
begin
  if new.status is not distinct from old.status and new.data_hora is not distinct from old.data_hora then
    return null;
  end if;
  for ch in select id, numero, status, status_antes_aprovacao, agendado_para from public.chamados
             where visita_id = new.id and organizacao_id = new.organizacao_id for update loop
    if new.status = 'cancelada' and old.status is distinct from 'cancelada' then
      if ch.status = 'agendado' or (ch.status = 'aguardando_aprovacao' and ch.status_antes_aprovacao = 'agendado') then
        update public.chamados set
          status = case when ch.status = 'agendado' then 'aprovado' else status end,
          status_antes_aprovacao = case when ch.status = 'aguardando_aprovacao' then 'aprovado' else status_antes_aprovacao end,
          agendado_para = null
        where id = ch.id;
        insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao)
        values (new.organizacao_id, ch.id, 'agenda',
                'Compromisso cancelado na Agenda' || coalesce(': ' || nullif(btrim(new.motivo_cancelamento), ''), '') || '. Marque o serviço de novo.');
      end if;
    elsif new.status = 'agendada' and new.data_hora is distinct from ch.agendado_para
          and ch.status in ('aprovado', 'agendado', 'em_execucao', 'aguardando_aprovacao') then
      update public.chamados set
        agendado_para = new.data_hora,
        status = case when ch.status = 'aprovado' then 'agendado' else status end,
        status_antes_aprovacao = case when ch.status = 'aguardando_aprovacao' and ch.status_antes_aprovacao = 'aprovado' then 'agendado' else status_antes_aprovacao end
      where id = ch.id;
    end if;
  end loop;
  return null;
end;
$$;
create or replace trigger visitas_chamados_trg after update of status, data_hora on public.visitas
  for each row execute function privado.visitas_chamados();

-- -----------------------------------------------------------------------------
-- Fatura cancelada (manual ou na desocupação): a cobrança do locatário que
-- estava nela volta a ficar pendente no chamado (lançar de novo).
-- -----------------------------------------------------------------------------
create or replace function privado.faturas_chamados()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
begin
  if new.status = 'cancelada' and old.status is distinct from 'cancelada' then
    for r in select ch.id, i.valor from public.chamados ch join public.fatura_itens i on i.id = ch.fatura_item_id
              where i.fatura_id = new.id and ch.organizacao_id = new.organizacao_id loop
      update public.chamados set fatura_item_id = null, cobranca_locatario = null where id = r.id;
      insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao)
      values (new.organizacao_id, r.id, 'financeiro',
              'A fatura #' || new.numero || ' foi cancelada: a cobrança do locatário (R$ ' || replace(to_char(r.valor, 'FM999999990.00'), '.', ',')
              || ') voltou a ficar pendente. Lance de novo (outra fatura ou conta a receber).');
    end loop;
  end if;
  return null;
end;
$$;
create or replace trigger faturas_chamados_trg after update of status on public.faturas
  for each row execute function privado.faturas_chamados();

-- -----------------------------------------------------------------------------
-- Dados que já existam:
-- - cobranças presas em fatura cancelada voltam a ficar pendentes;
-- - orçamentos gravados por quem é membro das duas organizações (o padrão era
--   a 1ª organização do usuário) passam para a organização do chamado;
-- - vínculos com registro de outra organização SEM membro em comum (só
--   acontece por manipulação da API) são removidos, com aviso.
-- -----------------------------------------------------------------------------
create or replace function privado.orgs_com_membro_comum(p_a uuid, p_b uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.membros m1 join public.membros m2 on m2.user_id = m1.user_id
                  where m1.organizacao_id = p_a and m2.organizacao_id = p_b)
$$;
revoke execute on function privado.orgs_com_membro_comum(uuid, uuid) from public, anon, authenticated;

do $$
declare
  r record;
  v int;
begin
  for r in select ch.id, ch.organizacao_id, f.numero, i.valor
             from public.chamados ch
             join public.fatura_itens i on i.id = ch.fatura_item_id
             join public.faturas f on f.id = i.fatura_id
            where f.status = 'cancelada' loop
    update public.chamados set fatura_item_id = null, cobranca_locatario = null where id = r.id;
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao)
    values (r.organizacao_id, r.id, 'financeiro',
            'A fatura #' || r.numero || ' estava cancelada: a cobrança do locatário (R$ ' || replace(to_char(r.valor, 'FM999999990.00'), '.', ',')
            || ') voltou a ficar pendente. Lance de novo (outra fatura ou conta a receber).');
  end loop;

  update public.chamado_orcamentos o set organizacao_id = c.organizacao_id
    from public.chamados c
   where c.id = o.chamado_id and o.organizacao_id <> c.organizacao_id and privado.orgs_com_membro_comum(o.organizacao_id, c.organizacao_id);

  update public.chamados c set visita_id = null from public.visitas x
   where x.id = c.visita_id and x.organizacao_id <> c.organizacao_id and not privado.orgs_com_membro_comum(c.organizacao_id, x.organizacao_id);
  get diagnostics v = row_count;
  if v > 0 then raise warning 'Manutenção: % chamado(s) apontavam para compromisso de outra organização (vínculo removido).', v; end if;
  update public.chamados c set orcamento_id = null
   where orcamento_id is not null and not exists (select 1 from public.chamado_orcamentos x where x.id = c.orcamento_id and x.chamado_id = c.id);
  get diagnostics v = row_count;
  if v > 0 then raise warning 'Manutenção: % chamado(s) apontavam para orçamento de outro chamado (vínculo removido).', v; end if;
  update public.chamados c set prestador_id = null from public.pessoas x
   where x.id = c.prestador_id and x.organizacao_id <> c.organizacao_id and not privado.orgs_com_membro_comum(c.organizacao_id, x.organizacao_id);
  get diagnostics v = row_count;
  if v > 0 then raise warning 'Manutenção: % chamado(s) com prestador de outra organização (vínculo removido).', v; end if;
  update public.chamados c set solicitante_pessoa_id = null from public.pessoas x
   where x.id = c.solicitante_pessoa_id and x.organizacao_id <> c.organizacao_id and not privado.orgs_com_membro_comum(c.organizacao_id, x.organizacao_id);
  get diagnostics v = row_count;
  if v > 0 then raise warning 'Manutenção: % chamado(s) com solicitante de outra organização (vínculo removido).', v; end if;
  update public.chamados c set contrato_id = null from public.contratos x
   where x.id = c.contrato_id and x.organizacao_id <> c.organizacao_id and not privado.orgs_com_membro_comum(c.organizacao_id, x.organizacao_id);
  get diagnostics v = row_count;
  if v > 0 then raise warning 'Manutenção: % chamado(s) com contrato de outra organização (vínculo removido).', v; end if;
  update public.chamados c set chamado_origem_id = null from public.chamados x
   where x.id = c.chamado_origem_id and x.organizacao_id <> c.organizacao_id and not privado.orgs_com_membro_comum(c.organizacao_id, x.organizacao_id);
  get diagnostics v = row_count;
  if v > 0 then raise warning 'Manutenção: % chamado(s) ligados a chamado de outra organização (vínculo removido).', v; end if;
  update public.chamados c set fatura_item_id = null from public.fatura_itens x
   where x.id = c.fatura_item_id and x.organizacao_id <> c.organizacao_id and not privado.orgs_com_membro_comum(c.organizacao_id, x.organizacao_id);
  get diagnostics v = row_count;
  if v > 0 then raise warning 'Manutenção: % chamado(s) ligados a item de fatura de outra organização (vínculo removido).', v; end if;
  select count(*) into v from public.chamados c join public.imoveis x on x.id = c.imovel_id where x.organizacao_id <> c.organizacao_id;
  if v > 0 then
    raise warning 'Manutenção: % chamado(s) com imóvel de outra organização — confira à mão: select c.id, c.organizacao_id, i.organizacao_id from chamados c join imoveis i on i.id = c.imovel_id where i.organizacao_id <> c.organizacao_id;', v;
  end if;
end $$;
