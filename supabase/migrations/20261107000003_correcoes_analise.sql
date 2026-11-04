-- =============================================================================
-- Análise cadastral — correções da revisão (etapa 15, já publicada).
--   * fiança só conta (e só vai ao contrato) com o fiador aprovado;
--   * trocar a pessoa de um fiador exige excluir e incluir de novo;
--   * contrato: só pelo "Vincular" (RPC), só do candidato como locatário, do
--     mesmo imóvel, ativo/rascunho, aprovação no prazo e sem desistência;
--   * desvincular por RPC (admin/gestor no banco): garantias voltam a
--     "aprovada" e as levadas são encerradas (com aviso) no contrato antigo;
--   * juntar repetidos: fiador que sai leva rendas, documentos, consultas e
--     garantias para o que fica (vale a análise mais forte);
--   * autorização (LGPD): data, origem, IP e texto sempre juntos; IP e texto
--     só pela ficha online; IP da conexão guardado à parte do IP informado;
--   * datas "do dia" no horário de Brasília;
--   * anotação da auditoria com data/usuário do banco;
--   * token da ficha gerado pelo banco; caminho do arquivo conferido; arquivo
--     pelo token só se foi enviado depois que a análise ganhou o token;
--   * limite de arquivos no Storage por link e de envios da ficha;
--   * candidato, corretor e fiador da mesma organização da análise.
-- Sem DROP: create or replace, add column if not exists, alter policy.
-- =============================================================================

-- Colunas novas -----------------------------------------------------------------
-- Quando a análise ganhou o token atual (arquivo da ficha só vale se veio depois).
alter table public.analises add column if not exists token_desde timestamptz;
-- IP da conexão que chegou ao banco (cabeçalhos do Supabase), à parte do IP informado pelo site.
alter table public.analises add column if not exists consentimento_ip_rede text;

-- Hoje no horário de Brasília (o banco roda em UTC) ------------------------------
create or replace function privado.analise_hoje()
returns date
language sql
stable
as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;
grant execute on function privado.analise_hoje() to anon, authenticated;

alter table public.analise_consultas alter column consultado_em set default ((now() at time zone 'America/Sao_Paulo')::date);
alter table public.garantia_renovacoes alter column solicitada_em set default ((now() at time zone 'America/Sao_Paulo')::date);

-- =============================================================================
-- Regra de aprovação: fiança conta só pelo fiador aprovado
-- (mesma conta de foraDaRegra() em src/lib/dominio/analise.ts)
-- =============================================================================
create or replace function privado.analise_fora_da_regra(p_id uuid, p_org uuid, p_custo numeric, p_candidato uuid)
returns text[]
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c public.analise_config%rowtype;
  v_limite numeric := 30;
  v_multiplo numeric := 3;
  v_score_min int;
  v_aceita_restr boolean := false;
  v_exigir_consulta boolean := true;
  v_exigir_garantia boolean := true;
  v_renda numeric;
  v_pct numeric;
  v_doc text;
  v_n int;
  v_score int;
  v_restr boolean;
  v_out text[] := '{}';
  r record;
begin
  select * into c from public.analise_config where organizacao_id = p_org;
  if found then
    v_limite := c.limite_comprometimento_pct;
    v_multiplo := c.renda_fiador_multiplo;
    v_score_min := c.score_minimo;
    v_aceita_restr := c.aceitar_restricoes;
    v_exigir_consulta := c.exigir_consulta;
    v_exigir_garantia := c.exigir_garantia;
  end if;

  -- Renda comprovada (candidato e quem compõe renda; fiadores à parte)
  select coalesce(sum(valor_comprovado), 0) into v_renda
    from public.analise_rendas where analise_id = p_id and fiador_id is null and valor_comprovado is not null;
  if v_renda <= 0 then
    v_out := v_out || 'Renda não comprovada'::text;
  else
    v_pct := round(coalesce(p_custo, 0) / v_renda * 100, 1);
    if v_pct > v_limite then
      v_out := v_out || format('Comprometimento de %s%% da renda (limite %s%%)', replace(v_pct::text, '.', ','), replace(trim_scale(v_limite)::text, '.', ','));
    end if;
  end if;

  -- Documento do candidato
  select documento into v_doc from public.pessoas where id = p_candidato;
  if not privado.analise_documento_valido(v_doc) then
    v_out := v_out || 'CPF/CNPJ do candidato ausente ou inválido'::text;
  end if;

  -- Crédito: vale a consulta mais recente do candidato
  select count(*) into v_n from public.analise_consultas where analise_id = p_id and fiador_id is null;
  if v_n = 0 then
    if v_exigir_consulta then
      v_out := v_out || 'Sem consulta de crédito registrada'::text;
    end if;
  else
    select score, restricoes into v_score, v_restr from public.analise_consultas
     where analise_id = p_id and fiador_id is null order by consultado_em desc, created_at desc limit 1;
    if v_score_min is not null and v_score is not null and v_score < v_score_min then
      v_out := v_out || format('Score %s abaixo do mínimo %s', v_score, v_score_min);
    end if;
    if v_restr and not v_aceita_restr then
      v_out := v_out || 'Restrições de crédito no nome do candidato'::text;
    end if;
  end if;

  -- Documentos obrigatórios sem validação
  select count(*) into v_n from public.analise_documentos
   where analise_id = p_id and obrigatorio and status not in ('validado','dispensado');
  if v_n > 0 then
    v_out := v_out || format('%s documento(s) obrigatório(s) sem validação', v_n);
  end if;

  -- Garantia aprovada: seguro/caução/título/carta aprovados ou fiador aprovado.
  -- A garantia do tipo "fiança" não conta sozinha: vale o fiador aprovado (que tem a renda conferida abaixo).
  if v_exigir_garantia
     and not exists (select 1 from public.analise_garantias
                      where analise_id = p_id and tipo <> 'fiador' and status in ('aprovada','aprovada_restricao','contratada'))
     and not exists (select 1 from public.analise_fiadores where analise_id = p_id and status = 'aprovado') then
    v_out := v_out || 'Nenhuma garantia aprovada'::text;
  end if;

  -- Fiadores aprovados com renda abaixo do mínimo
  for r in
    select p.nome, coalesce(sum(rd.valor_comprovado), 0) as renda
      from public.analise_fiadores f
      join public.pessoas p on p.id = f.pessoa_id
      left join public.analise_rendas rd on rd.fiador_id = f.id and rd.valor_comprovado is not null
     where f.analise_id = p_id and f.status = 'aprovado'
     group by f.id, p.nome
  loop
    if v_multiplo > 0 and r.renda < coalesce(p_custo, 0) * v_multiplo then
      v_out := v_out || format('Fiador %s com renda abaixo de %s× o aluguel e encargos', r.nome, replace(trim_scale(v_multiplo)::text, '.', ','));
    end if;
  end loop;

  return v_out;
end;
$$;
revoke execute on function privado.analise_fora_da_regra(uuid, uuid, numeric, uuid) from public, anon;
grant execute on function privado.analise_fora_da_regra(uuid, uuid, numeric, uuid) to authenticated;

-- =============================================================================
-- Análise: decisão, contrato (só pela RPC), desvínculo (admin/gestor), token da
-- ficha (gerado pelo banco), pessoas da mesma organização, autorização (LGPD).
-- =============================================================================
create or replace function privado.analises_regras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sistema boolean := auth.uid() is null;
  v_juntando boolean := coalesce(current_setting('analise.juntando', true), '') = 'on';
  v_levando boolean := coalesce(current_setting('analise.levando', true), '') = 'on';
  v_ficha boolean := coalesce(current_setting('analise.ficha', true), '') = 'on';
  v_papel text;
  v_validade int;
  v_renda numeric;
  v_custo numeric;
  v_nome text;
begin
  if tg_op = 'DELETE' then
    -- Organização inteira sendo apagada: sem regra.
    if not exists (select 1 from public.organizacoes where id = old.organizacao_id) then
      return old;
    end if;
    v_papel := privado.analise_papel(old.organizacao_id);
    if old.decisao is not null and not v_sistema and coalesce(v_papel, '') not in ('admin','gestor') then
      raise exception 'Só administradores e gestores excluem uma análise já decidida (a decisão continua na auditoria).';
    end if;
    return old;
  end if;

  if tg_op = 'INSERT' then
    if new.decisao is not null or new.contrato_id is not null then
      raise exception 'A análise começa sem decisão: decida depois de analisar.';
    end if;
    -- A chave estrangeira não respeita a RLS: a pessoa precisa ser desta organização.
    if not exists (select 1 from public.pessoas where id = new.candidato_id and organizacao_id = new.organizacao_id)
       or (new.corretor_id is not null and not exists (select 1 from public.pessoas where id = new.corretor_id and organizacao_id = new.organizacao_id)) then
      raise exception 'Pessoa não encontrada.';
    end if;
    -- O link da ficha é sempre gerado pelo banco (ninguém escolhe um token já usado).
    new.token := gen_random_uuid();
    new.token_desde := now();
    new.status := case when new.status = 'desistencia' then 'desistencia' else 'em_analise' end;
    new.decisao_justificativa := null;
    new.decisao_condicoes := null;
    new.fora_da_regra := '{}';
    new.excecao := false;
    new.excecao_justificativa := null;
    new.decidido_em := null;
    new.decidido_por := null;
    new.validade_ate := null;
    new.identidade_conferida_por := case when new.identidade_conferida_em is null then null else auth.uid() end;
    -- Autorização (LGPD): IP e texto só vêm da ficha online.
    if new.consentimento_em is null then new.consentimento_origem := null; end if;
    new.consentimento_ip := null;
    new.consentimento_ip_rede := null;
    new.consentimento_texto := null;
    return new;
  end if;

  new.organizacao_id := old.organizacao_id;
  new.updated_at := now();
  v_papel := privado.analise_papel(new.organizacao_id);

  -- Candidato e corretor da mesma organização (também ao juntar cadastros repetidos).
  if (new.candidato_id is distinct from old.candidato_id
      and not exists (select 1 from public.pessoas where id = new.candidato_id and organizacao_id = new.organizacao_id))
     or (new.corretor_id is distinct from old.corretor_id and new.corretor_id is not null
      and not exists (select 1 from public.pessoas where id = new.corretor_id and organizacao_id = new.organizacao_id)) then
    raise exception 'Pessoa não encontrada.';
  end if;

  -- Link da ficha: trocar gera um token novo no banco (o valor mandado é só o sinal da troca).
  if new.token is distinct from old.token then
    new.token := gen_random_uuid();
    new.token_desde := now();
    perform privado.analise_evento(new.organizacao_id, new.id, 'ficha_link', 'Link da ficha online trocado (o anterior parou de funcionar)');
  else
    new.token_desde := old.token_desde;
  end if;

  if new.decisao is distinct from old.decisao then
    if new.decisao is null then
      -- Reabrir
      if not v_sistema and coalesce(v_papel, '') not in ('admin','gestor') then
        raise exception 'Só administradores e gestores reabrem uma análise já decidida.';
      end if;
      if new.contrato_id is not null then
        raise exception 'Esta análise já virou contrato. Desvincule o contrato antes de reabrir.';
      end if;
      if length(btrim(coalesce(new.reaberta_motivo, ''))) < 5 then
        raise exception 'Informe o motivo para reabrir a análise.';
      end if;
      perform privado.analise_evento(new.organizacao_id, new.id, 'reaberta', 'Análise reaberta: ' || btrim(new.reaberta_motivo),
        jsonb_build_object('decisao_anterior', old.decisao, 'justificativa_anterior', old.decisao_justificativa));
      new.decisao_justificativa := null;
      new.decisao_condicoes := null;
      new.fora_da_regra := '{}';
      new.excecao := false;
      new.excecao_justificativa := null;
      new.decidido_em := null;
      new.decidido_por := null;
      new.validade_ate := null;
      if new.status <> 'desistencia' then new.status := 'em_analise'; end if;
    else
      if old.decisao is not null then
        raise exception 'Reabra a análise antes de mudar a decisão.';
      end if;
      if not v_sistema and coalesce(v_papel, '') not in ('admin','gestor','financeiro') then
        raise exception 'Seu usuário não pode decidir análises cadastrais. Peça a um administrador, gestor ou ao financeiro.';
      end if;
      if length(btrim(coalesce(new.decisao_justificativa, ''))) < 10 then
        raise exception 'Escreva a justificativa da decisão (pelo menos 10 letras).';
      end if;
      if new.decisao = 'aprovado_condicoes' and length(btrim(coalesce(new.decisao_condicoes, ''))) < 3 then
        raise exception 'Descreva as condições da aprovação.';
      end if;
      v_custo := new.valor_aluguel + new.valor_encargos;
      new.fora_da_regra := coalesce(privado.analise_fora_da_regra(new.id, new.organizacao_id, v_custo, new.candidato_id), '{}');
      if new.decisao in ('aprovado','aprovado_condicoes') and cardinality(new.fora_da_regra) > 0 then
        if not v_sistema and coalesce(v_papel, '') not in ('admin','gestor') then
          raise exception 'Aprovação fora da regra (%). Só administrador ou gestor aprova como exceção.', array_to_string(new.fora_da_regra, '; ');
        end if;
        if length(btrim(coalesce(new.excecao_justificativa, ''))) < 10 then
          raise exception 'Explique por que aprovar fora da regra (justificativa da exceção, pelo menos 10 letras).';
        end if;
        new.excecao := true;
      else
        new.excecao := false;
        new.excecao_justificativa := null;
      end if;
      if new.decisao <> 'aprovado_condicoes' then new.decisao_condicoes := null; end if;
      select validade_dias into v_validade from public.analise_config where organizacao_id = new.organizacao_id;
      -- Validade contada a partir de hoje no horário de Brasília.
      new.validade_ate := case when new.decisao = 'reprovado' then null else privado.analise_hoje() + coalesce(v_validade, 30) end;
      new.decidido_em := now();
      new.decidido_por := auth.uid();
      new.reaberta_motivo := null;
      new.status := 'em_analise';

      select coalesce(sum(valor_comprovado), 0) into v_renda
        from public.analise_rendas where analise_id = new.id and fiador_id is null and valor_comprovado is not null;
      select nome into v_nome from public.pessoas where id = new.candidato_id;
      insert into public.analise_decisoes (organizacao_id, analise_id, analise_numero, candidato_nome, decisao, justificativa, condicoes,
        excecao, fora_da_regra, excecao_justificativa, renda_comprovada, custo_mensal, comprometimento_pct, usuario_id, papel)
      values (new.organizacao_id, new.id, new.numero, v_nome, new.decisao, btrim(new.decisao_justificativa), new.decisao_condicoes,
        new.excecao, new.fora_da_regra, new.excecao_justificativa, v_renda, v_custo,
        case when v_renda > 0 then round(v_custo / v_renda * 100, 1) end, auth.uid(), v_papel);
      perform privado.analise_evento(new.organizacao_id, new.id, case when new.excecao then 'excecao' else 'decisao' end,
        case new.decisao when 'aprovado' then 'Aprovado' when 'aprovado_condicoes' then 'Aprovado com condições' else 'Reprovado' end
          || case when new.excecao then ' como exceção (fora da regra)' else '' end || ': ' || btrim(new.decisao_justificativa),
        jsonb_build_object('fora_da_regra', new.fora_da_regra, 'excecao_justificativa', new.excecao_justificativa, 'condicoes', new.decisao_condicoes));
    end if;
  elsif old.decisao is not null and (
        new.decisao_justificativa is distinct from old.decisao_justificativa
     or new.decisao_condicoes is distinct from old.decisao_condicoes
     or new.excecao is distinct from old.excecao
     or new.excecao_justificativa is distinct from old.excecao_justificativa
     or new.fora_da_regra is distinct from old.fora_da_regra
     or new.decidido_em is distinct from old.decidido_em
     or new.decidido_por is distinct from old.decidido_por
     or new.validade_ate is distinct from old.validade_ate
     or new.valor_aluguel is distinct from old.valor_aluguel
     or new.valor_encargos is distinct from old.valor_encargos
     -- Imóvel travado (a aprovação vale para este imóvel); só sai se o próprio imóvel for excluído (on delete set null).
     or (new.imovel_id is distinct from old.imovel_id
         and not (new.imovel_id is null and not exists (select 1 from public.imoveis where id = old.imovel_id)))
     or (new.candidato_id is distinct from old.candidato_id and not v_juntando)) then
    raise exception 'A análise já foi decidida: reabra para mudar imóvel, valores, candidato ou a decisão.';
  elsif new.decisao is null then
    -- Sem decisão, os campos de decisão ficam vazios (não dá para "decidir" por fora).
    new.decisao_justificativa := null;
    new.decisao_condicoes := null;
    new.fora_da_regra := '{}';
    new.excecao := false;
    new.excecao_justificativa := null;
    new.decidido_em := null;
    new.decidido_por := null;
    new.validade_ate := null;
  end if;

  if new.candidato_id is distinct from old.candidato_id then
    perform privado.analise_evento(new.organizacao_id, new.id, 'candidato',
      case when v_juntando then 'Cadastro do candidato juntado com um cadastro repetido' else 'Candidato trocado' end,
      jsonb_build_object('antes', old.candidato_id, 'depois', new.candidato_id));
  end if;

  -- Contrato
  if new.contrato_id is distinct from old.contrato_id then
    if new.contrato_id is not null then
      -- Só pelo "Vincular contrato" (public.levar_garantias_contrato), que confere locatário,
      -- imóvel, situação do contrato e prazo da aprovação e leva as garantias.
      if not v_levando then
        raise exception 'Use "Vincular contrato" na aba Decisão: é ele que confere o locatário e o imóvel e leva as garantias.';
      end if;
      if coalesce(new.decisao, '') not in ('aprovado','aprovado_condicoes') then
        raise exception 'Só um candidato aprovado pode virar contrato.';
      end if;
    elsif not v_sistema and exists (select 1 from public.contratos where id = old.contrato_id)
          and coalesce(v_papel, '') not in ('admin','gestor') then
      -- Excluir o contrato solta sozinho (on delete set null); desvincular é de admin/gestor.
      raise exception 'Só administradores e gestores desvinculam o contrato.';
    end if;
    perform privado.analise_evento(new.organizacao_id, new.id,
      case when new.contrato_id is null then 'contrato_desvinculado' else 'convertida' end,
      case when new.contrato_id is null then 'Contrato desvinculado da análise' else 'Candidato virou contrato' end,
      null, coalesce(new.contrato_id, old.contrato_id));
  end if;

  -- Desistência e situação final
  if new.status = 'desistencia' and old.status <> 'desistencia' then
    perform privado.analise_evento(new.organizacao_id, new.id, 'desistencia', 'Candidato desistiu' || coalesce(': ' || nullif(btrim(new.desistencia_motivo), ''), ''));
  elsif old.status = 'desistencia' and new.status <> 'desistencia' then
    perform privado.analise_evento(new.organizacao_id, new.id, 'retomada', 'Análise retomada');
  end if;
  new.status := case
    when new.contrato_id is not null then 'contratada'
    when new.status = 'desistencia' and new.decisao is distinct from 'reprovado' then 'desistencia'
    when new.decisao = 'aprovado' then 'aprovada'
    when new.decisao = 'aprovado_condicoes' then 'aprovada_condicoes'
    when new.decisao = 'reprovado' then 'reprovada'
    else 'em_analise' end;

  -- Conferência da identidade (quem e quando)
  if new.identidade_conferida_em is distinct from old.identidade_conferida_em then
    new.identidade_conferida_por := case when new.identidade_conferida_em is null then null else auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.id, 'identidade',
      case when new.identidade_conferida_em is null then 'Conferência do documento desfeita' else 'Documento de identidade do candidato conferido' end);
  else
    new.identidade_conferida_por := old.identidade_conferida_por;
  end if;

  -- Consentimento (LGPD): data, origem, IP e texto andam juntos. IP e texto só
  -- vêm da ficha online (public.ficha_enviar); registro manual fica sem eles.
  if new.consentimento_em is distinct from old.consentimento_em then
    if new.consentimento_em is null then
      new.consentimento_origem := null;
      new.consentimento_ip := null;
      new.consentimento_ip_rede := null;
      new.consentimento_texto := null;
    elsif not v_ficha then
      new.consentimento_ip := null;
      new.consentimento_ip_rede := null;
      new.consentimento_texto := null;
    end if;
    perform privado.analise_evento(new.organizacao_id, new.id, 'consentimento',
      case when new.consentimento_em is null then 'Autorização de consulta retirada'
           else 'Autorização de consulta registrada (' || coalesce(new.consentimento_origem, 'sem origem') || ')' end);
  elsif not v_ficha then
    new.consentimento_ip := old.consentimento_ip;
    new.consentimento_ip_rede := old.consentimento_ip_rede;
    new.consentimento_texto := old.consentimento_texto;
  end if;
  return new;
end;
$$;
create or replace trigger analises_regras_trg before insert or update or delete on public.analises
  for each row execute function privado.analises_regras();

-- =============================================================================
-- Fiadores: pessoa da organização; trocar a pessoa = excluir e incluir de novo;
-- ao juntar cadastros repetidos, o banco leva a análise do fiador como está.
-- =============================================================================
create or replace function privado.analise_fiadores_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_juntando boolean := coalesce(current_setting('analise.juntando', true), '') = 'on';
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    select nome into v_nome from public.pessoas where id = old.pessoa_id;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'fiador',
      case when v_juntando then 'Fiador repetido juntado no outro cadastro: ' else 'Fiador removido: ' end || coalesce(v_nome, '—'));
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.organizacao_id := privado.analise_org_de(new.analise_id, null);
    if not exists (select 1 from public.pessoas where id = new.pessoa_id and organizacao_id = new.organizacao_id) then
      raise exception 'Pessoa não encontrada.';
    end if;
    if exists (select 1 from public.analises where id = new.analise_id and candidato_id = new.pessoa_id) then
      raise exception 'O candidato não pode ser fiador dele mesmo.';
    end if;
    select nome into v_nome from public.pessoas where id = new.pessoa_id;
    -- Aprovar/reprovar fiador conta para a regra ("garantia aprovada"): só quem decide análises.
    if new.status <> 'pendente' and auth.uid() is not null
       and coalesce(privado.analise_papel(new.organizacao_id), '') not in ('admin','gestor','financeiro') then
      raise exception 'Só administrador, gestor ou financeiro aprovam ou reprovam fiador.';
    end if;
    new.analisado_em := case when new.status = 'pendente' then null else now() end;
    new.analisado_por := case when new.status = 'pendente' then null else auth.uid() end;
    new.identidade_conferida_por := case when new.identidade_conferida_em is null then null else auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'fiador', 'Fiador incluído: ' || coalesce(v_nome, '—'));
    return new;
  end if;

  new.organizacao_id := old.organizacao_id;
  new.analise_id := old.analise_id;
  if new.pessoa_id is distinct from old.pessoa_id
     and not exists (select 1 from public.pessoas where id = new.pessoa_id and organizacao_id = new.organizacao_id) then
    raise exception 'Pessoa não encontrada.';
  end if;
  select nome into v_nome from public.pessoas where id = new.pessoa_id;

  if v_juntando then
    -- Juntar cadastros repetidos (privado.analise_juntar_pessoas): a análise do fiador vai como está.
    if new.pessoa_id is distinct from old.pessoa_id or new.status is distinct from old.status then
      perform privado.analise_evento(new.organizacao_id, new.analise_id, 'fiador',
        'Fiador ' || coalesce(v_nome, '—') || ': cadastro juntado com um cadastro repetido'
          || case when new.status is distinct from old.status then ' (fica ' || new.status || ')' else '' end);
    end if;
    return new;
  end if;

  -- A análise (aprovação, parecer, autorização, rendas) é desta pessoa: trocar a pessoa = excluir e incluir.
  if new.pessoa_id is distinct from old.pessoa_id then
    raise exception 'Para trocar o fiador, exclua este e inclua o novo (a análise do fiador vale só para a pessoa analisada).';
  end if;

  if new.status is distinct from old.status then
    if auth.uid() is not null and coalesce(privado.analise_papel(new.organizacao_id), '') not in ('admin','gestor','financeiro') then
      raise exception 'Só administrador, gestor ou financeiro aprovam ou reprovam fiador.';
    end if;
    new.analisado_em := case when new.status = 'pendente' then null else now() end;
    new.analisado_por := case when new.status = 'pendente' then null else auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'fiador',
      'Fiador ' || coalesce(v_nome, '—') || ': ' || case new.status when 'aprovado' then 'aprovado' when 'reprovado' then 'reprovado' else 'volta a pendente' end
        || coalesce(' — ' || nullif(btrim(new.parecer), ''), ''));
  else
    new.analisado_em := old.analisado_em;
    new.analisado_por := old.analisado_por;
  end if;
  if new.identidade_conferida_em is distinct from old.identidade_conferida_em then
    new.identidade_conferida_por := case when new.identidade_conferida_em is null then null else auth.uid() end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'identidade',
      case when new.identidade_conferida_em is null then 'Conferência do documento do fiador desfeita' else 'Documento do fiador ' || coalesce(v_nome, '') || ' conferido' end);
  else
    new.identidade_conferida_por := old.identidade_conferida_por;
  end if;
  if new.consentimento_em is distinct from old.consentimento_em and new.consentimento_em is not null then
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'consentimento',
      'Autorização de consulta do fiador ' || coalesce(v_nome, '') || ' registrada (' || coalesce(new.consentimento_origem, 'sem origem') || ')');
  end if;
  return new;
end;
$$;
create or replace trigger analise_fiadores_trg before insert or update or delete on public.analise_fiadores
  for each row execute function privado.analise_fiadores_trg();

-- =============================================================================
-- Arquivos: o caminho precisa ser da pasta da própria análise e não muda depois
-- (a permissão de ler/apagar no Storage confia neste registro).
-- =============================================================================
create or replace function privado.analise_arquivos_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_equipe text;
  v_ficha text;
  v_path text;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'arquivo', 'Arquivo excluído: ' || coalesce(old.nome, 'arquivo'));
    return old;
  end if;
  if tg_op = 'UPDATE' then
    -- Só o documento do checklist (da mesma análise) e o nome mudam.
    new.organizacao_id := old.organizacao_id;
    new.analise_id := old.analise_id;
    new.path := old.path;
    new.enviado_pela_ficha := old.enviado_pela_ficha;
    new.enviado_por := old.enviado_por;
    new.created_at := old.created_at;
    if new.documento_id is not null and new.documento_id is distinct from old.documento_id
       and not exists (select 1 from public.analise_documentos where id = new.documento_id and analise_id = new.analise_id) then
      raise exception 'Este documento é de outra análise.';
    end if;
    return new;
  end if;
  new.organizacao_id := privado.analise_org_de(new.analise_id, null);
  if new.documento_id is not null and not exists (select 1 from public.analise_documentos where id = new.documento_id and analise_id = new.analise_id) then
    raise exception 'Este documento é de outra análise.';
  end if;
  -- Pasta da equipe (<organização>/<análise>/) ou da ficha atual desta análise (ficha/<token>/).
  v_path := coalesce(new.path, '');
  v_equipe := new.organizacao_id::text || '/' || new.analise_id::text || '/';
  select 'ficha/' || token::text || '/' into v_ficha from public.analises where id = new.analise_id;
  if v_path like '%..%' or length(v_path) > 300
     or not ((left(v_path, length(v_equipe)) = v_equipe and length(v_path) > length(v_equipe))
          or (left(v_path, length(v_ficha)) = v_ficha and length(v_path) > length(v_ficha))) then
    raise exception 'Arquivo inválido.';
  end if;
  new.enviado_pela_ficha := left(v_path, length(v_ficha)) = v_ficha;
  new.enviado_por := auth.uid();
  perform privado.analise_evento(new.organizacao_id, new.analise_id, 'arquivo',
    case when new.enviado_pela_ficha then 'Candidato enviou pela ficha online: ' else 'Arquivo enviado: ' end || coalesce(new.nome, 'arquivo'));
  return new;
end;
$$;
create or replace trigger analise_arquivos_trg before insert or update or delete on public.analise_arquivos
  for each row execute function privado.analise_arquivos_trg();

-- =============================================================================
-- Consultas de crédito: data no horário de Brasília; ao juntar cadastros
-- repetidos, a consulta só troca de fiador (o resto continua intocável).
-- =============================================================================
create or replace function privado.analise_consultas_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rotulo text;
  v_consent timestamptz;
  v_fiador uuid;
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'consulta_excluida',
      'Consulta de crédito excluída (' || old.bureau || ', ' || to_char(old.consultado_em, 'DD/MM/YYYY') || ')',
      jsonb_build_object('score', old.score, 'restricoes', old.restricoes, 'base_legal', old.base_legal));
    return old;
  end if;
  if tg_op = 'UPDATE' then
    if coalesce(current_setting('analise.juntando', true), '') = 'on' then
      v_fiador := new.fiador_id;
      new := old;
      new.fiador_id := v_fiador;
      perform privado.analise_org_de(new.analise_id, new.fiador_id);
      return new;
    end if;
    raise exception 'Consulta de crédito registrada não se altera. Exclua e registre de novo.';
  end if;
  new.organizacao_id := privado.analise_org_de(new.analise_id, new.fiador_id);
  if auth.uid() is not null then new.consultado_por := auth.uid(); end if;
  if new.consultado_em > privado.analise_hoje() then
    raise exception 'A data da consulta não pode ser no futuro.';
  end if;
  if new.base_legal = 'consentimento' and new.consentimento_em is null then
    if new.fiador_id is null then
      select consentimento_em into v_consent from public.analises where id = new.analise_id;
    else
      select consentimento_em into v_consent from public.analise_fiadores where id = new.fiador_id;
    end if;
    new.consentimento_em := v_consent;
    if new.consentimento_em is null then
      raise exception 'Registre a autorização (consentimento) antes da consulta, ou use a base legal "proteção do crédito" (LGPD art. 7º, X).';
    end if;
  end if;
  v_rotulo := case new.bureau when 'serasa' then 'Serasa' when 'spc' then 'SPC' when 'boa_vista' then 'Boa Vista' when 'quod' then 'Quod' else coalesce(new.bureau_nome, 'outro birô') end;
  perform privado.analise_evento(new.organizacao_id, new.analise_id, 'consulta',
    'Consulta de crédito (' || v_rotulo || ')' || coalesce(' — score ' || new.score, '') || case when new.restricoes then ' — com restrições' else ' — sem restrições' end
      || ' · base legal: ' || case new.base_legal when 'consentimento' then 'consentimento (art. 7º, I)' else 'proteção do crédito (art. 7º, X)' end,
    jsonb_build_object('bureau', new.bureau, 'score', new.score, 'restricoes', new.restricoes, 'base_legal', new.base_legal, 'fiador_id', new.fiador_id));
  return new;
end;
$$;
create or replace trigger analise_consultas_trg before insert or update or delete on public.analise_consultas
  for each row execute function privado.analise_consultas_trg();

-- =============================================================================
-- Garantias propostas: "levada ao contrato" só pela RPC; fiança aprovada só com
-- o fiador aprovado; datas no horário de Brasília.
-- =============================================================================
create or replace function privado.analise_garantias_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rot text;
  v_pelo_banco boolean := coalesce(current_setting('analise.levando', true), '') = 'on'
                          or coalesce(current_setting('analise.juntando', true), '') = 'on';
  v_hoje date := privado.analise_hoje();
begin
  if tg_op = 'DELETE' then
    if not exists (select 1 from public.analises where id = old.analise_id) then return old; end if;
    perform privado.analise_evento(old.organizacao_id, old.analise_id, 'garantia', 'Garantia proposta excluída (' || old.tipo || ')');
    return old;
  end if;
  if tg_op = 'INSERT' then
    new.organizacao_id := privado.analise_org_de(new.analise_id, new.fiador_id);
    if new.contrato_garantia_id is not null and not v_pelo_banco then
      raise exception '"Levada ao contrato" é marcada sozinha ao vincular o contrato.';
    end if;
  else
    new.organizacao_id := old.organizacao_id;
    new.analise_id := old.analise_id;
    if new.fiador_id is distinct from old.fiador_id then
      perform privado.analise_org_de(new.analise_id, new.fiador_id);
    end if;
    -- O vínculo com a garantia do contrato só nasce pelo "Vincular contrato" (e some sozinho se ela for excluída).
    if new.contrato_garantia_id is distinct from old.contrato_garantia_id and new.contrato_garantia_id is not null and not v_pelo_banco then
      raise exception '"Levada ao contrato" é marcada sozinha ao vincular o contrato.';
    end if;
  end if;
  if new.status = 'contratada' and (tg_op = 'INSERT' or old.status is distinct from 'contratada') and not v_pelo_banco then
    raise exception '"Levada ao contrato" é marcada sozinha ao vincular o contrato.';
  end if;
  -- Fiança só fica aprovada com o fiador aprovado (aprovar fiador é de admin, gestor ou financeiro).
  if new.tipo = 'fiador' and new.status in ('aprovada','aprovada_restricao') and not v_pelo_banco
     and (tg_op = 'INSERT' or new.status is distinct from old.status or new.fiador_id is distinct from old.fiador_id or new.tipo is distinct from old.tipo)
     and not exists (select 1 from public.analise_fiadores f where f.id = new.fiador_id and f.status = 'aprovado') then
    raise exception 'A fiança só fica aprovada com o fiador aprovado: aprove o fiador na aba Fiadores.';
  end if;
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    if new.status in ('solicitada','em_analise') then
      new.solicitada_em := coalesce(new.solicitada_em, v_hoje);
    end if;
    if new.status in ('aprovada','aprovada_restricao','recusada') then
      new.respondida_em := coalesce(new.respondida_em, v_hoje);
    end if;
    v_rot := case new.tipo when 'fiador' then 'Fiança' when 'caucao' then 'Caução' when 'seguro_fianca' then 'Seguro-fiança'
      when 'titulo_capitalizacao' then 'Título de capitalização' when 'carta_fianca' then 'Carta-fiança' else 'Garantia' end;
    perform privado.analise_evento(new.organizacao_id, new.analise_id, 'garantia',
      v_rot || coalesce(' (' || nullif(btrim(new.garantidora), '') || ')', '') || ': '
        || case new.status when 'proposta' then 'proposta' when 'solicitada' then 'solicitada à garantidora' when 'em_analise' then 'em análise na garantidora'
             when 'aprovada' then 'aprovada' when 'aprovada_restricao' then 'aprovada com restrição' when 'recusada' then 'recusada'
             when 'cancelada' then 'cancelada' else 'levada ao contrato' end
        || coalesce(' — ' || nullif(btrim(new.resposta), ''), ''),
      jsonb_build_object('status', new.status, 'tipo', new.tipo));
  end if;
  return new;
end;
$$;
create or replace trigger analise_garantias_trg before insert or update or delete on public.analise_garantias
  for each row execute function privado.analise_garantias_trg();

-- =============================================================================
-- Renovação de garantias: datas no horário de Brasília.
-- =============================================================================
create or replace function privado.garantia_renovacoes_trg()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  g public.contrato_garantias%rowtype;
  c public.contratos%rowtype;
begin
  if tg_op = 'DELETE' then
    -- Saindo junto com o contrato ou a garantia (cascata): sem evento.
    if not exists (select 1 from public.contratos where id = old.contrato_id) then return old; end if;
    if old.contrato_garantia_id is not null and not exists (select 1 from public.contrato_garantias where id = old.contrato_garantia_id) then return old; end if;
    perform privado.analise_evento(old.organizacao_id, null, 'renovacao_excluida',
      'Registro de renovação excluído (' || case old.objeto when 'garantia' then 'garantia' else 'seguro incêndio' end || ', '
        || case old.status when 'solicitada' then 'solicitada' when 'renovada' then 'renovada' when 'recusada' then 'recusada' else 'cancelada' end
        || ' em ' || to_char(old.solicitada_em, 'DD/MM/YYYY') || ')',
      jsonb_build_object('status', old.status, 'canal', old.canal, 'destinatario', old.destinatario, 'fim_anterior', old.fim_anterior,
                         'nova_fim', old.nova_fim, 'novo_numero', old.novo_numero, 'novo_valor', old.novo_valor),
      old.contrato_id);
    return old;
  end if;
  if tg_op = 'INSERT' then
    if new.objeto = 'garantia' then
      select * into g from public.contrato_garantias where id = new.contrato_garantia_id;
      if not found then raise exception 'Garantia não encontrada.'; end if;
      new.contrato_id := g.contrato_id;
      new.organizacao_id := g.organizacao_id;
      new.fim_anterior := g.fim;
    else
      new.contrato_garantia_id := null;
      select * into c from public.contratos where id = new.contrato_id;
      if not found then raise exception 'Contrato não encontrado.'; end if;
      new.organizacao_id := c.organizacao_id;
      new.fim_anterior := c.seguro_incendio_vencimento;
    end if;
    new.status := 'solicitada';
    perform privado.analise_evento(new.organizacao_id, null, 'renovacao_solicitada',
      'Renovação solicitada (' || case new.objeto when 'garantia' then 'garantia' else 'seguro incêndio' end || ') — '
        || new.destinatario || ' por ' || new.canal, null, new.contrato_id);
    return new;
  end if;
  new.organizacao_id := old.organizacao_id;
  new.contrato_id := old.contrato_id;
  new.contrato_garantia_id := old.contrato_garantia_id;
  new.objeto := old.objeto;
  if new.status is distinct from old.status then
    if old.status <> 'solicitada' then
      raise exception 'Esta solicitação já foi concluída.';
    end if;
    new.concluida_em := coalesce(new.concluida_em, privado.analise_hoje());
    perform privado.analise_evento(new.organizacao_id, null, 'renovacao_' || new.status,
      'Renovação ' || case new.status when 'renovada' then 'concluída' || coalesce(' até ' || to_char(new.nova_fim, 'DD/MM/YYYY'), '')
        when 'recusada' then 'recusada' else 'cancelada' end, null, new.contrato_id);
  end if;
  return new;
end;
$$;
create or replace trigger garantia_renovacoes_trg before insert or update or delete on public.garantia_renovacoes
  for each row execute function privado.garantia_renovacoes_trg();

create or replace function public.concluir_renovacao_garantia(p_id uuid, p jsonb)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.garantia_renovacoes%rowtype;
  g public.contrato_garantias%rowtype;
  c public.contratos%rowtype;
  v_fim date := nullif(p->>'nova_fim', '')::date;
  v_numero text := nullif(btrim(coalesce(p->>'numero', '')), '');
  v_valor numeric := privado.analise_num(p->>'valor');
  v_premio numeric := privado.analise_num(p->>'premio');
begin
  select * into r from public.garantia_renovacoes where id = p_id for update;
  if not found then raise exception 'Solicitação de renovação não encontrada.'; end if;
  if r.status <> 'solicitada' then raise exception 'Esta solicitação já foi concluída.'; end if;
  if v_fim is null then raise exception 'Informe o novo vencimento.'; end if;
  if r.objeto = 'garantia' then
    select * into g from public.contrato_garantias where id = r.contrato_garantia_id for update;
    if not found then raise exception 'Garantia não encontrada.'; end if;
    if g.status not in ('ativa','vencida') then raise exception 'Esta garantia já foi encerrada, devolvida ou executada.'; end if;
    if g.fim is not null and v_fim <= g.fim then
      raise exception 'O novo vencimento precisa ser depois do atual (%).', to_char(g.fim, 'DD/MM/YYYY');
    end if;
    update public.contrato_garantias
       set fim = v_fim, numero = coalesce(v_numero, numero), valor = coalesce(v_valor, valor), status = 'ativa'
     where id = g.id;
  else
    select * into c from public.contratos where id = r.contrato_id for update;
    if not found then raise exception 'Contrato não encontrado.'; end if;
    if c.seguro_incendio_vencimento is not null and v_fim <= c.seguro_incendio_vencimento then
      raise exception 'O novo vencimento precisa ser depois do atual (%).', to_char(c.seguro_incendio_vencimento, 'DD/MM/YYYY');
    end if;
    update public.contratos
       set seguro_incendio_vencimento = v_fim, seguro_incendio_apolice = coalesce(v_numero, seguro_incendio_apolice)
     where id = c.id;
  end if;
  update public.garantia_renovacoes
     set status = 'renovada', nova_fim = v_fim, novo_numero = v_numero, novo_valor = v_valor, novo_premio = v_premio,
         concluida_em = privado.analise_hoje(), observacoes = coalesce(nullif(btrim(coalesce(p->>'observacoes', '')), ''), observacoes)
   where id = r.id;
end;
$$;
revoke execute on function public.concluir_renovacao_garantia(uuid, jsonb) from public, anon;
grant execute on function public.concluir_renovacao_garantia(uuid, jsonb) to authenticated;

-- =============================================================================
-- Juntar cadastros repetidos: quando os dois são fiadores da mesma análise, o
-- que sai leva rendas, documentos, consultas e garantias para o que fica, e
-- vale a análise mais forte (aprovado > reprovado > pendente).
-- =============================================================================
create or replace function privado.analise_juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  r public.analise_fiadores%rowtype;
  m public.analise_fiadores%rowtype;
  d record;
  v_r int;
  v_m int;
begin
  perform set_config('analise.juntando', 'on', true);
  update public.analises set candidato_id = p_manter where candidato_id = p_remover;
  update public.analises set corretor_id = p_manter where corretor_id = p_remover;

  for r in
    select f.* from public.analise_fiadores f
     where f.pessoa_id = p_remover
       and exists (select 1 from public.analise_fiadores x where x.analise_id = f.analise_id and x.pessoa_id = p_manter)
  loop
    select * into m from public.analise_fiadores where analise_id = r.analise_id and pessoa_id = p_manter;
    v_r := case r.status when 'aprovado' then 2 when 'reprovado' then 1 else 0 end;
    v_m := case m.status when 'aprovado' then 2 when 'reprovado' then 1 else 0 end;
    update public.analise_fiadores set
      status = case when v_r > v_m then r.status else m.status end,
      parecer = case when v_r > v_m then coalesce(r.parecer, m.parecer) else coalesce(m.parecer, r.parecer) end,
      analisado_em = case when v_r > v_m then r.analisado_em else m.analisado_em end,
      analisado_por = case when v_r > v_m then r.analisado_por else m.analisado_por end,
      consentimento_em = coalesce(m.consentimento_em, r.consentimento_em),
      consentimento_origem = case when m.consentimento_em is not null then m.consentimento_origem else r.consentimento_origem end,
      identidade_conferida_em = coalesce(m.identidade_conferida_em, r.identidade_conferida_em),
      identidade_conferida_por = case when m.identidade_conferida_em is not null then m.identidade_conferida_por else r.identidade_conferida_por end,
      parentesco = coalesce(m.parentesco, r.parentesco),
      conjuge_nome = coalesce(m.conjuge_nome, r.conjuge_nome),
      conjuge_documento = coalesce(m.conjuge_documento, r.conjuge_documento),
      outorga_conjuge = m.outorga_conjuge or r.outorga_conjuge,
      imovel_descricao = coalesce(m.imovel_descricao, r.imovel_descricao),
      imovel_matricula = coalesce(m.imovel_matricula, r.imovel_matricula),
      imovel_cartorio = coalesce(m.imovel_cartorio, r.imovel_cartorio),
      imovel_valor = coalesce(m.imovel_valor, r.imovel_valor),
      imovel_onus = m.imovel_onus or r.imovel_onus
     where id = m.id;
    update public.analise_rendas set fiador_id = m.id where fiador_id = r.id;
    update public.analise_consultas set fiador_id = m.id where fiador_id = r.id;
    update public.analise_garantias set fiador_id = m.id where fiador_id = r.id;
    update public.analise_documentos set fiador_id = m.id where fiador_id = r.id;
    -- Checklist repetido (mesmo item): fica o de melhor situação, e os arquivos passam para ele.
    for d in
      select s.id, s.fica from (
        select id, first_value(id) over (
                 partition by item
                 order by case status when 'validado' then 4 when 'dispensado' then 3 when 'recebido' then 2 when 'recusado' then 1 else 0 end desc,
                          created_at, id) as fica
          from public.analise_documentos
         where fiador_id = m.id and item is not null) s
       where s.id <> s.fica
    loop
      update public.analise_arquivos set documento_id = d.fica where documento_id = d.id;
      delete from public.analise_documentos where id = d.id;
    end loop;
    delete from public.analise_fiadores where id = r.id;
  end loop;
  update public.analise_fiadores set pessoa_id = p_manter where pessoa_id = p_remover;
  perform set_config('analise.juntando', '', true);
end;
$$;
revoke execute on function privado.analise_juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function privado.analise_juntar_pessoas(uuid, uuid) to authenticated;

-- =============================================================================
-- Auditoria: quem escreve não escolhe a data nem o autor; anotação só na
-- análise da própria organização.
-- =============================================================================
create or replace function privado.analise_eventos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.data := now();
  new.usuario_id := auth.uid();
  if new.tipo = 'nota' then
    new.dados := null;
    new.contrato_id := null;
    if new.analise_id is null
       or not exists (select 1 from public.analises where id = new.analise_id and organizacao_id = new.organizacao_id) then
      raise exception 'Análise não encontrada.';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger analise_eventos_antes_trg before insert on public.analise_eventos
  for each row execute function privado.analise_eventos_antes();

-- =============================================================================
-- Contrato: ligar (com as conferências) e desligar
-- =============================================================================

/**
 * Liga a análise aprovada ao contrato e leva as garantias aprovadas (seguro,
 * caução, título, carta-fiança e fianças de fiador aprovado) e os fiadores
 * aprovados. Confere: contrato ativo/rascunho, do imóvel da análise, com o
 * candidato como locatário, aprovação no prazo e sem desistência.
 * Devolve quantas garantias foram criadas no contrato.
 */
create or replace function public.levar_garantias_contrato(p_analise uuid, p_contrato uuid)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  a public.analises%rowtype;
  c public.contratos%rowtype;
  g record;
  v_gid uuid;
  v_n int := 0;
  v_principal text;
  v_valor numeric;
begin
  select * into a from public.analises where id = p_analise for update;
  if not found then raise exception 'Análise não encontrada.'; end if;
  select * into c from public.contratos where id = p_contrato;
  if not found or c.organizacao_id <> a.organizacao_id then raise exception 'Contrato não encontrado.'; end if;
  if coalesce(a.decisao, '') not in ('aprovado','aprovado_condicoes') then
    raise exception 'Só um candidato aprovado pode virar contrato.';
  end if;
  if a.contrato_id is not null and a.contrato_id <> p_contrato then
    raise exception 'Esta análise já está ligada a outro contrato.';
  end if;
  if c.status not in ('rascunho','ativo') then
    raise exception 'Só um contrato ativo ou em rascunho pode receber a análise.';
  end if;
  if a.imovel_id is not null and c.imovel_id is distinct from a.imovel_id then
    raise exception 'Este contrato é de outro imóvel: a aprovação vale só para o imóvel da análise.';
  end if;
  if not exists (select 1 from public.contrato_partes where contrato_id = p_contrato and pessoa_id = a.candidato_id and papel = 'locatario') then
    raise exception 'O candidato aprovado não é locatário deste contrato.';
  end if;
  if a.contrato_id is null then
    if a.status = 'desistencia' then
      raise exception 'O candidato desistiu. Retome a análise antes de criar o contrato.';
    end if;
    if a.validade_ate is not null and a.validade_ate < privado.analise_hoje() then
      raise exception 'A aprovação venceu em %. Reabra a análise e decida de novo antes de criar o contrato.', to_char(a.validade_ate, 'DD/MM/YYYY');
    end if;
  end if;

  perform set_config('analise.levando', 'on', true);
  if a.contrato_id is null then
    update public.analises set contrato_id = p_contrato where id = a.id;
  end if;

  for g in
    select ag.*, f.pessoa_id as fiador_pessoa
      from public.analise_garantias ag
      left join public.analise_fiadores f on f.id = ag.fiador_id
     where ag.analise_id = a.id and ag.status in ('aprovada','aprovada_restricao','contratada') and ag.contrato_garantia_id is null
       -- Fiança só vai com o fiador aprovado.
       and (ag.tipo <> 'fiador' or f.status = 'aprovado')
     order by ag.created_at
  loop
    insert into public.contrato_garantias (organizacao_id, contrato_id, tipo, pessoa_id, instituicao, numero, valor, inicio, fim, conta, observacoes)
    values (a.organizacao_id, p_contrato, g.tipo, g.fiador_pessoa, g.garantidora, coalesce(g.apolice_numero, g.proposta_numero),
            g.valor, g.vigencia_inicio, g.vigencia_fim, g.conta, concat_ws(' · ', 'Da análise cadastral #' || a.numero, g.observacoes))
    returning id into v_gid;
    update public.analise_garantias set contrato_garantia_id = v_gid, status = 'contratada' where id = g.id;
    v_principal := coalesce(v_principal, g.tipo);
    v_valor := coalesce(v_valor, g.valor);
    v_n := v_n + 1;
  end loop;

  for g in
    select f.pessoa_id from public.analise_fiadores f
     where f.analise_id = a.id and f.status = 'aprovado'
       and not exists (select 1 from public.contrato_garantias cg
                        where cg.contrato_id = p_contrato and cg.tipo = 'fiador' and cg.pessoa_id = f.pessoa_id and cg.status in ('ativa','vencida'))
  loop
    insert into public.contrato_garantias (organizacao_id, contrato_id, tipo, pessoa_id, observacoes)
    values (a.organizacao_id, p_contrato, 'fiador', g.pessoa_id, 'Da análise cadastral #' || a.numero);
    v_principal := coalesce(v_principal, 'fiador');
    v_n := v_n + 1;
  end loop;

  insert into public.contrato_partes (organizacao_id, contrato_id, pessoa_id, papel)
  select a.organizacao_id, p_contrato, f.pessoa_id, 'fiador' from public.analise_fiadores f
   where f.analise_id = a.id and f.status = 'aprovado'
  on conflict do nothing;

  -- Resumo do contrato (documento) acompanha a garantia principal.
  if v_principal in ('fiador','caucao','seguro_fianca','titulo_capitalizacao') then
    update public.contratos set garantia_tipo = v_principal, garantia_valor = coalesce(garantia_valor, v_valor)
     where id = p_contrato and garantia_tipo = 'sem_garantia';
  end if;
  perform set_config('analise.levando', '', true);
  return v_n;
end;
$$;
revoke execute on function public.levar_garantias_contrato(uuid, uuid) from public, anon;
grant execute on function public.levar_garantias_contrato(uuid, uuid) to authenticated;

/**
 * Desvincula o contrato da análise (só admin/gestor). As garantias que a análise
 * levou ficam ENCERRADAS no contrato antigo, com aviso nas observações (sem
 * apagar histórico), e voltam a "aprovada" aqui para irem ao contrato certo.
 * Os fiadores continuam como partes do contrato antigo (confira por lá).
 * Devolve quantas garantias foram encerradas no contrato antigo.
 */
create or replace function public.desvincular_contrato_analise(p_analise uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.analises%rowtype;
  v_contrato uuid;
  v_numero bigint;
  v_marca text;
  v_n int := 0;
begin
  select * into a from public.analises where id = p_analise and organizacao_id in (select privado.org_ids()) for update;
  if not found then raise exception 'Análise não encontrada.'; end if;
  if coalesce(privado.analise_papel(a.organizacao_id), '') not in ('admin','gestor') then
    raise exception 'Só administradores e gestores desvinculam o contrato.';
  end if;
  if a.contrato_id is null then raise exception 'Esta análise não está ligada a nenhum contrato.'; end if;
  v_contrato := a.contrato_id;
  select numero into v_numero from public.contratos where id = v_contrato;
  v_marca := 'Análise cadastral #' || a.numero || ' desvinculada deste contrato em ' || to_char(privado.analise_hoje(), 'DD/MM/YYYY');

  perform set_config('analise.levando', 'on', true);
  update public.contrato_garantias cg
     set status = 'encerrada', observacoes = concat_ws(' · ', cg.observacoes, v_marca)
   where cg.contrato_id = v_contrato and cg.organizacao_id = a.organizacao_id and cg.status in ('ativa','vencida')
     and (cg.id in (select ag.contrato_garantia_id from public.analise_garantias ag where ag.analise_id = a.id and ag.contrato_garantia_id is not null)
          or (cg.tipo = 'fiador' and coalesce(cg.observacoes, '') ~ ('^Da análise cadastral #' || a.numero || '( ·|$)')));
  get diagnostics v_n = row_count;
  update public.analise_garantias set status = 'aprovada', contrato_garantia_id = null
   where analise_id = a.id and (status = 'contratada' or contrato_garantia_id is not null);
  update public.analises set contrato_id = null where id = a.id;
  perform privado.analise_evento(a.organizacao_id, a.id, 'contrato_desvinculado',
    'Garantias levadas voltaram para "aprovada"'
      || case when v_n > 0 then '; ' || v_n || ' garantia(s) encerrada(s) no contrato #' || coalesce(v_numero::text, '?')
           || ' (os fiadores continuam como partes: confira o contrato)' else '' end,
    jsonb_build_object('contrato_id', v_contrato, 'garantias_encerradas', v_n), v_contrato);
  perform set_config('analise.levando', '', true);
  return v_n;
end;
$$;
revoke execute on function public.desvincular_contrato_analise(uuid) from public, anon;
grant execute on function public.desvincular_contrato_analise(uuid) to authenticated;

-- =============================================================================
-- Ficha online (pública, por token)
-- =============================================================================

/** A ficha deste token está aberta? (validade pelo dia de Brasília) */
create or replace function privado.analise_ficha(p_token uuid)
returns public.analises
language sql
stable
security definer
set search_path = public
as $$
  select a.* from public.analises a
   where a.token = p_token and a.ficha_ativa and a.decisao is null and a.status = 'em_analise'
     and (a.ficha_expira_em is null or a.ficha_expira_em >= privado.analise_hoje())
$$;
revoke execute on function privado.analise_ficha(uuid) from public, anon;

/**
 * Arquivo da ficha (ficha/<token>/...) é de uma análise da minha organização?
 *   1) pelo registro em analise_arquivos (caminho conferido pelo gatilho; vale
 *      mesmo depois de o link ser trocado);
 *   2) pelo token atual, só se o arquivo subiu depois que a análise ganhou esse
 *      token (um token antigo nunca dá acesso ao que foi enviado antes).
 */
create or replace function privado.analise_arquivo_da_org(p_path text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := split_part(coalesce(p_path, ''), '/', 2);
  v_uuid boolean := split_part(coalesce(p_path, ''), '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_desde timestamptz;
  v_criado timestamptz;
begin
  -- Registro de antes desta correção com a pasta do token ATUAL de outra organização não vale.
  if exists (select 1 from public.analise_arquivos f where f.path = p_path and f.organizacao_id in (select privado.org_ids()))
     and not (v_uuid and exists (select 1 from public.analises x where x.token = v_token::uuid and x.organizacao_id not in (select privado.org_ids()))) then
    return true;
  end if;
  if not v_uuid then return false; end if;
  select coalesce(a.token_desde, a.created_at) into v_desde
    from public.analises a where a.token = v_token::uuid and a.organizacao_id in (select privado.org_ids());
  if not found then return false; end if;
  if to_regclass('storage.objects') is null then return true; end if;
  execute 'select created_at from storage.objects where bucket_id = $1 and name = $2' into v_criado using 'analises', p_path;
  return v_criado is null or v_criado >= v_desde;
end;
$$;
revoke execute on function privado.analise_arquivo_da_org(text) from public, anon;
grant execute on function privado.analise_arquivo_da_org(text) to authenticated;

/**
 * Policy do Storage para enviar à ficha: caminho exatamente ficha/<token>/<arquivo>,
 * link aberto e no máximo 40 arquivos por link (o envio não depende do registro).
 */
create or replace function public.analise_ficha_aceita_upload_v2(p_name text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partes text[] := string_to_array(coalesce(p_name, ''), '/');
  v_token text;
  v_n int := 0;
begin
  if coalesce(array_length(v_partes, 1), 0) <> 3 or v_partes[1] <> 'ficha' or coalesce(v_partes[3], '') = ''
     or p_name like '%..%' or length(p_name) > 300 then
    return false;
  end if;
  v_token := v_partes[2];
  -- Só a forma canônica (minúsculas): com maiúsculas a contagem abaixo não acharia os arquivos.
  if v_token !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  if (select a.id from privado.analise_ficha(v_token::uuid) a) is null then return false; end if;
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects where bucket_id = $1 and name like $2'
      into v_n using 'analises', 'ficha/' || v_token || '/%';
    if v_n >= 40 then return false; end if;
  end if;
  return true;
end;
$$;
revoke execute on function public.analise_ficha_aceita_upload_v2(text) from public;
grant execute on function public.analise_ficha_aceita_upload_v2(text) to anon, authenticated;

create or replace function public.ficha_info(p_token uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.analises%rowtype;
  v_nome text;
  v_tipo text;
begin
  select * into a from privado.analise_ficha(p_token);
  if a.id is null then return null; end if;
  select nome, tipo_pessoa into v_nome, v_tipo from public.pessoas where id = a.candidato_id and organizacao_id = a.organizacao_id;
  return jsonb_build_object(
    'organizacao', (select nome from public.organizacoes where id = a.organizacao_id),
    'nome', coalesce(v_nome, 'candidato'),
    'tipo_pessoa', v_tipo,
    'imovel', (select jsonb_build_object('codigo', i.codigo, 'endereco', concat_ws(', ', i.logradouro, i.numero, i.bairro, i.cidade))
                 from public.imoveis i where i.id = a.imovel_id and i.organizacao_id = a.organizacao_id),
    'aluguel', a.valor_aluguel,
    'encargos', a.valor_encargos,
    'enviada_em', a.ficha_enviada_em,
    'consentimento_em', a.consentimento_em,
    'texto_consentimento', privado.analise_texto_consentimento(a.organizacao_id),
    'documentos', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'rotulo', d.rotulo, 'status', d.status, 'obrigatorio', d.obrigatorio,
                                                                  'parte', d.parte, 'motivo', d.motivo_recusa) order by d.ordem, d.created_at), '[]'::jsonb)
                     from public.analise_documentos d where d.analise_id = a.id and d.status in ('pendente','recusado','recebido')),
    'arquivos', (select count(*) from public.analise_arquivos f where f.analise_id = a.id and f.enviado_pela_ficha)
  );
end;
$$;
revoke execute on function public.ficha_info(uuid) from public;
grant execute on function public.ficha_info(uuid) to anon, authenticated;

/**
 * O candidato envia dados, fontes de renda e a autorização (LGPD).
 * p: { telefone, email, profissao, estado_civil, empregador, moradores, moradores_obs, observacoes,
 *      rendas: [{tipo, fonte, valor}], consentimento: true, ip, ua }
 * Limites: 3 envios por minuto e 10 por dia em cada ficha; 300 por hora na organização.
 * IP: "ip" é o informado por quem chama (o site); o da conexão vem dos cabeçalhos do Supabase.
 */
create or replace function public.ficha_enviar(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.analises%rowtype;
  r jsonb;
  v_valor numeric;
  v_total numeric := 0;
  v_n int := 0;
  v_mor int;
  v_headers jsonb;
  v_ip text := nullif(left(btrim(coalesce(p->>'ip', '')), 64), '');
  v_ip_rede text;
begin
  select * into a from privado.analise_ficha(p_token);
  if a.id is null then raise exception 'Link inválido ou expirado.'; end if;
  if coalesce((p->>'consentimento')::boolean, false) is not true then
    raise exception 'Para enviar, marque a autorização de consulta e uso dos dados (LGPD).';
  end if;
  perform 1 from public.analises where id = a.id for update;

  -- Limites contra abuso (o link é público).
  if (select count(*) from public.analise_eventos where analise_id = a.id and tipo = 'ficha_enviada' and data > now() - interval '1 minute') >= 3
     or (select count(*) from public.analise_eventos where analise_id = a.id and tipo = 'ficha_enviada' and data > now() - interval '1 day') >= 10 then
    raise exception 'Limite de envios desta ficha atingido. Tente de novo mais tarde ou fale com quem enviou o link.';
  end if;
  if (select count(*) from public.analise_eventos where organizacao_id = a.organizacao_id and tipo = 'ficha_enviada' and data > now() - interval '1 hour') >= 300 then
    raise exception 'Limite de envios de fichas por hora atingido. Tente de novo em alguns minutos.';
  end if;

  -- IP da conexão que chegou ao banco (não vem do corpo da chamada).
  begin
    v_headers := nullif(current_setting('request.headers', true), '')::jsonb;
  exception when others then
    v_headers := null;
  end;
  v_ip_rede := left(coalesce(nullif(btrim(v_headers->>'cf-connecting-ip'), ''), nullif(btrim(v_headers->>'x-forwarded-for'), ''),
                             nullif(btrim(v_headers->>'x-real-ip'), '')), 200);

  -- Contato: só completa o que está vazio no cadastro (da mesma organização).
  update public.pessoas
     set telefone = coalesce(nullif(btrim(telefone), ''), left(nullif(btrim(coalesce(p->>'telefone', '')), ''), 30)),
         email = coalesce(nullif(btrim(email), ''), left(nullif(btrim(coalesce(p->>'email', '')), ''), 160)),
         profissao = coalesce(nullif(btrim(profissao), ''), left(nullif(btrim(coalesce(p->>'profissao', '')), ''), 120)),
         estado_civil = coalesce(nullif(btrim(estado_civil), ''), left(nullif(btrim(coalesce(p->>'estado_civil', '')), ''), 40))
   where id = a.candidato_id and organizacao_id = a.organizacao_id;

  -- Rendas da ficha: substitui as anteriores que a equipe ainda não comprovou.
  delete from public.analise_rendas where analise_id = a.id and origem = 'ficha' and valor_comprovado is null;
  for r in select value from jsonb_array_elements(case when jsonb_typeof(p->'rendas') = 'array' then p->'rendas' else '[]'::jsonb end)
  loop
    exit when v_n >= 5;
    v_valor := privado.analise_num(r->>'valor');
    if v_valor is not null and v_valor > 0 and v_valor < 10000000 then
      insert into public.analise_rendas (organizacao_id, analise_id, tipo, fonte, valor_declarado, origem)
      values (a.organizacao_id, a.id,
              case when r->>'tipo' in ('clt','servidor','pro_labore','autonomo','empresario','aposentadoria','pensao','aluguel','investimentos','beneficio','outro')
                   then r->>'tipo' else 'outro' end,
              left(nullif(btrim(coalesce(r->>'fonte', '')), ''), 160), v_valor, 'ficha');
      v_total := v_total + v_valor;
      v_n := v_n + 1;
    end if;
  end loop;

  v_mor := privado.analise_num(p->>'moradores')::int;
  -- Autorização: data, origem, IP e texto desta mesma submissão, todos juntos (só se ainda não havia).
  perform set_config('analise.ficha', 'on', true);
  update public.analises
     set ficha_enviada_em = now(),
         ficha_dados = jsonb_strip_nulls(jsonb_build_object(
           'telefone', left(p->>'telefone', 30), 'email', left(p->>'email', 160), 'profissao', left(p->>'profissao', 120),
           'estado_civil', left(p->>'estado_civil', 40), 'empregador', left(p->>'empregador', 160),
           'observacoes', left(p->>'observacoes', 2000), 'enviado_em', now())),
         moradores = case when v_mor between 0 and 50 then v_mor else moradores end,
         moradores_obs = coalesce(left(nullif(btrim(coalesce(p->>'moradores_obs', '')), ''), 500), moradores_obs),
         renda_declarada = case when v_total > 0 then v_total else renda_declarada end,
         consentimento_em = case when consentimento_em is null then now() else consentimento_em end,
         consentimento_origem = case when consentimento_em is null then 'ficha online' else consentimento_origem end,
         consentimento_ip = case when consentimento_em is null then v_ip else consentimento_ip end,
         consentimento_ip_rede = case when consentimento_em is null then v_ip_rede else consentimento_ip_rede end,
         consentimento_texto = case when consentimento_em is null then privado.analise_texto_consentimento(a.organizacao_id) else consentimento_texto end
   where id = a.id;
  perform set_config('analise.ficha', '', true);
  perform privado.analise_evento(a.organizacao_id, a.id, 'ficha_enviada',
    'Candidato enviou a ficha online' || case when v_n > 0 then ' com ' || v_n || ' fonte(s) de renda' else '' end,
    jsonb_build_object('ip_informado', v_ip, 'ip_rede', v_ip_rede, 'navegador', left(p->>'ua', 200)));
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.ficha_enviar(uuid, jsonb) from public;
grant execute on function public.ficha_enviar(uuid, jsonb) to anon, authenticated;

-- =============================================================================
-- Storage: envio para ficha/<token>/ com limite por link (sem DROP: alter policy)
-- =============================================================================
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'analises_ficha_enviar') then
      execute $p$alter policy analises_ficha_enviar on storage.objects
        with check (bucket_id = 'analises' and public.analise_ficha_aceita_upload_v2(name))$p$;
    end if;
    if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'analises_gravar') then
      execute $p$alter policy analises_gravar on storage.objects
        with check (bucket_id = 'analises' and (
          (storage.foldername(name))[1] in (select privado.org_ids()::text)
          or public.analise_ficha_aceita_upload_v2(name)))$p$;
    end if;
  end if;
end $$;
