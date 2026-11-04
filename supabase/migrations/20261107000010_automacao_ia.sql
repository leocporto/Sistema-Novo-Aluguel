-- =============================================================================
-- Etapa 22 — Automação e inteligência artificial (nos dois modos)
--
-- O que é de leads/CRM (classificação, intenção, próximo contato, chatbot de
-- qualificação e resposta fora do horário) só vale no modo imobiliária; o resto
-- (descrições, resumos, leitura de documentos, documentos pendentes, preço por
-- comparáveis, contratos em risco, vacância, inconsistências, assistente,
-- automações por regras, aprovação humana e histórico) vale nos dois.
--
-- - ia_config: uma linha por organização (IA ligada/desligada, recursos ligados,
--   limites diários, horário comercial, mensagem fora do horário, exigir
--   aprovação humana — padrão sim —, perguntas de qualificação, preço por token
--   para o custo estimado). Todos leem; só administrador/gestor com
--   Configurações → editar mudam. A resposta fora do horário sem aprovação
--   de cada uma (pré-aprovada) só o ADMINISTRADOR liga, e só com o texto fixo
--   aprovado aqui. O envio continua pelo botão: o sistema ainda não tem a
--   integração de envio pela API do WhatsApp (ponto para ligar depois).
-- - ia_execucoes: histórico de cada chamada à IA (só acréscimo: a escrita é só
--   pelas funções ia_reservar/ia_concluir). A cota diária (por organização e por
--   usuário) é RESERVADA no banco antes da chamada, com a linha da configuração
--   travada (duas abas ao mesmo tempo não furam o limite). Entrada e saída são
--   gravadas já mascaradas (RG/CNH, CPF, CNPJ, e-mail, telefone e dados
--   bancários); da leitura de documentos só ficam os nomes dos campos achados.
-- - ia_acoes: ações críticas sugeridas pela IA ou pelas automações (mensagem a
--   cliente, etapa/responsável do lead, desconto, preço, cancelar/renegociar
--   cobrança, lançamento, tarefa). Nunca rodam direto: nascem PENDENTES e só
--   viram aprovada/recusada por quem pode decidir (gatilho ia_acoes_antes +
--   privado.ia_pode_decidir: módulo da ação + papel; com "exigir aprovação",
--   só administrador/gestor ou quem tem "aprovar" no módulo, e quem pediu não
--   aprova a própria — a não ser o administrador). Depois de aprovada, o
--   servidor TRAVA a ação (aprovada/erro → executando, uma tela só consegue),
--   executa pela via normal (actions/RPC existentes, com a sessão do usuário)
--   e marca executada/erro. Repetir a mesma situação pela API é recusado.
--   "Criar tarefa" só existe na imobiliária (tarefas só aparecem no Comercial).
--   O que foi sugerido não muda depois.
-- - automacoes_regras: regras configuráveis (gatilho e ação de listas
--   FECHADAS, condições simples validadas). automacoes_execucoes: histórico só
--   acréscimo, com trava única (regra, objeto, dia). A rodada é feita por
--   public.automacoes_rodar() (no máximo a cada 10 min por organização),
--   chamada em segundo plano (after()) pelo servidor.
-- - ia_avisos: notificação interna (ação "avisar responsável").
-- - ia_inconsistencias_conferidas: o que a equipe já conferiu na lista de
--   inconsistências financeiras (public.ia_inconsistencias, regras no banco).
-- - public.ia_consulta: assistente interno — UMA consulta de uma lista fechada,
--   parâmetros validados, rodando com a sessão do usuário (RLS). Nada de SQL livre.
-- - public.ia_preco_comparaveis: sugestão de preço pela mediana do R$/m² dos
--   imóveis parecidos da própria carteira.
-- - public.ia_contratos_risco: contratos em risco com nota e previsão de dias vagos.
-- Sem DROP; tudo idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Listas fixas (espelho de src/lib/dominio/ia.ts — o teste confere)
-- -----------------------------------------------------------------------------
create or replace function privado.ia_recursos()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['assistente','busca_imoveis','descricao_anuncio','resumo','extracao_documento','preco','leads','atendimento']::text[] $$;

create or replace function privado.ia_recursos_imob()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['leads','atendimento']::text[] $$;

create or replace function privado.ia_gatilhos()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['lead_novo','lead_parado','visita_sem_retorno','fatura_vencida','contrato_vencendo','garantia_vencendo','chamado_parado','documento_pendente']::text[] $$;

create or replace function privado.ia_gatilhos_imob()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['lead_novo','lead_parado','visita_sem_retorno']::text[] $$;

create or replace function privado.ia_acoes_regra()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['criar_tarefa','avisar_responsavel','sugerir_mensagem','marcar_prioridade']::text[] $$;

-- Tarefas (tabela tarefas) só aparecem no Comercial/Painel da imobiliária: no
-- pessoal a ação "criar tarefa" não existe (use "avisar o responsável").
create or replace function privado.ia_acoes_regra_imob()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['criar_tarefa','marcar_prioridade']::text[] $$;

create or replace function privado.ia_tipos_acao()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['mensagem_cliente','mudar_etapa_lead','mudar_responsavel_lead','desconto','alterar_preco','cancelar_cobranca','renegociar_cobranca','criar_lancamento','criar_tarefa']::text[] $$;

create or replace function privado.ia_tipos_acao_imob()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['mudar_etapa_lead','mudar_responsavel_lead','criar_tarefa']::text[] $$;

create or replace function privado.ia_consultas()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['aluguel_recebido','resumo_financeiro','inadimplencia','contratos_vencendo','imoveis_vagos','despesas','receitas','repasses_pendentes','leads_periodo','chamados_abertos']::text[] $$;

create or replace function privado.ia_consultas_imob()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['repasses_pendentes','leads_periodo']::text[] $$;

create or replace function privado.ia_inconsistencia_tipos()
returns text[] language sql immutable set search_path = pg_catalog
as $$ select array['lancamento_duplicado','pagamento_maior','repasse_sem_fatura_paga','fatura_paga_sem_repasse','taxa_fora_contrato','lancamento_sem_categoria','saldo_negativo']::text[] $$;

/** Módulo e operação para usar cada recurso de IA (espelho de PERMISSAO_RECURSO). */
create or replace function privado.ia_recurso_permissao(p_recurso text)
returns text[] language sql immutable set search_path = pg_catalog
as $$
  select case p_recurso
    when 'assistente' then array['relatorios','ver']
    when 'busca_imoveis' then array['imoveis','ver']
    when 'descricao_anuncio' then array['imoveis','editar']
    when 'resumo' then array['pessoas','ver']
    when 'extracao_documento' then array['pessoas','editar']
    when 'preco' then array['imoveis','ver']
    when 'leads' then array['comercial','ver']
    when 'atendimento' then array['comercial','ver']
  end
$$;

/** Módulo e operação para decidir/executar cada tipo de ação (espelho de permissaoAcao). */
create or replace function privado.ia_acao_permissao(p_tipo text, p_imob boolean)
returns text[] language sql immutable set search_path = pg_catalog
as $$
  select case p_tipo
    when 'mensagem_cliente' then case when p_imob then array['comercial','editar'] else array['pessoas','editar'] end
    when 'mudar_etapa_lead' then array['comercial','editar']
    when 'mudar_responsavel_lead' then array['comercial','editar']
    when 'desconto' then array['contratos','editar']
    when 'alterar_preco' then array['imoveis','editar']
    when 'cancelar_cobranca' then array['cobrancas','aprovar']
    when 'renegociar_cobranca' then array['cobrancas','aprovar']
    when 'criar_lancamento' then array['financeiro','criar']
    when 'criar_tarefa' then array['comercial','criar']
  end
$$;

/** Módulo e operação de cada consulta do assistente (espelho de CONSULTAS_IA). */
create or replace function privado.ia_consulta_permissao(p_chave text)
returns text[] language sql immutable set search_path = pg_catalog
as $$
  select case p_chave
    when 'aluguel_recebido' then array['relatorios','ver']
    when 'resumo_financeiro' then array['relatorios','ver']
    when 'inadimplencia' then array['cobrancas','ver']
    when 'contratos_vencendo' then array['contratos','ver']
    when 'imoveis_vagos' then array['imoveis','ver']
    when 'despesas' then array['financeiro','ver']
    when 'receitas' then array['financeiro','ver']
    when 'repasses_pendentes' then array['repasses','ver']
    when 'leads_periodo' then array['comercial','ver']
    when 'chamados_abertos' then array['manutencao','ver']
  end
$$;

do $$
declare
  f text;
begin
  foreach f in array array['privado.ia_recursos()','privado.ia_recursos_imob()','privado.ia_gatilhos()','privado.ia_gatilhos_imob()',
                           'privado.ia_acoes_regra()','privado.ia_acoes_regra_imob()','privado.ia_tipos_acao()','privado.ia_tipos_acao_imob()','privado.ia_consultas()',
                           'privado.ia_consultas_imob()','privado.ia_inconsistencia_tipos()','privado.ia_recurso_permissao(text)',
                           'privado.ia_acao_permissao(text, boolean)','privado.ia_consulta_permissao(text)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 2. Utilitários (validação, máscara de dados pessoais, horário, modelo de texto)
-- -----------------------------------------------------------------------------
create or replace function privado.ia_uuid_ok(p text)
returns boolean language sql immutable set search_path = pg_catalog
as $$ select coalesce(p ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$', false) $$;

create or replace function privado.ia_data_ok(p text)
returns boolean language plpgsql immutable set search_path = pg_catalog
as $$
begin
  if p is null or p !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  perform p::date;
  return true;
exception when others then
  return false;
end;
$$;

/** Número de um campo do JSON (número ou texto "1234.56"); null se não for número. */
create or replace function privado.ia_num(p jsonb, k text)
returns numeric language sql immutable set search_path = pg_catalog
as $$
  select case
    when jsonb_typeof(p -> k) = 'number' then (p ->> k)::numeric
    when jsonb_typeof(p -> k) = 'string' and (p ->> k) ~ '^-?\d{1,12}(\.\d{1,6})?$' then (p ->> k)::numeric
    else null end
$$;

/**
 * Mascara RG/CNH (número logo depois de "RG", "CNH", "identidade" ou "registro
 * geral"), CPF, CNPJ, e-mail, telefone e dados bancários (número logo depois de
 * agência/ag, conta, c/c, cc, pix ou banco) num texto (o histórico nunca guarda
 * esses dados). Espelho de mascararDadosPessoais (o teste confere).
 */
create or replace function privado.ia_mascarar(p text)
returns text language sql immutable set search_path = pg_catalog
as $$
  select regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(regexp_replace(coalesce(p, ''),
    '\y(rg|cnh|identidade|registro geral)([\s:#.-]*(?:(?:n[ºo°]|n[uú]mero|[ée])[\s:#.-]*)?)\d[\d./xX-]{3,14}', '\1\2[oculto]', 'gi'),
    '\d{2}\.?\d{3}\.?\d{3}/?\d{4}-?\d{2}', '[CNPJ]', 'g'),
    '\d{3}\.?\d{3}\.?\d{3}-?\d{2}', '[CPF]', 'g'),
    '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}', '[e-mail]', 'g'),
    '(\+?55[ ]?)?\(?\d{2}\)?[ ]?9?\d{4}[- ]?\d{4}', '[telefone]', 'g'),
    '\y(ag[eê]ncia|ag|conta(?:\s+corrente|\s+poupan[cç]a)?|c/c|cc|pix|banco(?:\s+[^\s\d]{1,15}){0,2})([\s:nº°#.-]*)\d[A-Za-z0-9_.@/+-]*', '\1\2[oculto]', 'gi')
$$;

/**
 * O que o histórico guarda da leitura de um documento: só os NOMES dos campos
 * encontrados e se estava legível — nunca os dados lidos (LGPD: o histórico é
 * só acréscimo e não dá para apagar uma linha).
 */
create or replace function privado.ia_saida_extracao(p_saida text)
returns text language plpgsql immutable set search_path = pg_catalog
as $$
declare
  j jsonb;
begin
  if p_saida is null or btrim(p_saida) = '' then return null; end if;
  j := p_saida::jsonb;
  if jsonb_typeof(j) <> 'object' then return null; end if;
  return jsonb_build_object(
    'campos_encontrados', coalesce((select jsonb_agg(k order by k) from jsonb_each(case when jsonb_typeof(j -> 'campos') = 'object' then j -> 'campos' else '{}'::jsonb end) e(k, v)
                                     where jsonb_typeof(v) not in ('null') and btrim(v #>> '{}') <> ''), '[]'::jsonb),
    'legivel', case when jsonb_typeof(j -> 'legivel') = 'boolean' then j -> 'legivel' else 'null'::jsonb end)::text;
exception when others then
  return null;
end;
$$;

/** O instante está dentro do horário comercial (Brasília)? dias: 1 = segunda … 7 = domingo. Espelho de dentroDoHorario. */
create or replace function privado.ia_no_horario(p_ts timestamptz, p_inicio time, p_fim time, p_dias smallint[])
returns boolean language sql stable set search_path = pg_catalog
as $$
  select extract(isodow from (p_ts at time zone 'America/Sao_Paulo'))::smallint = any (p_dias)
     and (p_ts at time zone 'America/Sao_Paulo')::time >= p_inicio
     and (p_ts at time zone 'America/Sao_Paulo')::time < p_fim
$$;

/** R$ 1.234,56 */
create or replace function privado.ia_moeda(v numeric)
returns text language sql immutable set search_path = pg_catalog
as $$
  select case when v is null then '' else
    'R$ ' || translate(to_char(round(v, 2), 'FM999G999G999G990D00'), ',.', '.,') end
$$;

/** Preenche {{nome}} (primeiro nome), {{imovel}}, {{valor}}, {{data}} e {{horario}}. Espelho de preencherModeloIA. */
create or replace function privado.ia_preencher(p_texto text, p_nome text, p_imovel text, p_valor numeric, p_data date, p_horario text default null)
returns text language sql immutable set search_path = pg_catalog
as $$
  select replace(replace(replace(replace(replace(coalesce(p_texto, ''),
    '{{nome}}', coalesce(nullif(split_part(btrim(coalesce(p_nome, '')), ' ', 1), ''), 'cliente')),
    '{{imovel}}', coalesce(p_imovel, '')),
    '{{valor}}', coalesce(privado.ia_moeda(p_valor), '')),
    '{{data}}', coalesce(to_char(p_data, 'DD/MM/YYYY'), '')),
    '{{horario}}', coalesce(p_horario, ''))
$$;

/** Erro de validação dos dados de uma ação (null = ok). Espelho de validarPayloadAcao. */
create or replace function privado.ia_payload_erro(p_tipo text, p jsonb)
returns text language plpgsql immutable set search_path = pg_catalog
as $$
declare
  k text;
  v numeric;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'Dados da ação inválidos.'; end if;
  if p_tipo = 'mensagem_cliente' then
    if coalesce(btrim(p ->> 'texto'), '') = '' or length(p ->> 'texto') > 4000 then return 'A mensagem está vazia ou longa demais (até 4.000 letras).'; end if;
    if coalesce(p ->> 'canal', '') not in ('whatsapp','email','sms') then return 'Canal da mensagem inválido.'; end if;
    if length(coalesce(p ->> 'destino', '')) > 200 or length(coalesce(p ->> 'nome', '')) > 120 then return 'Destino ou nome longo demais.'; end if;
    foreach k in array array['conversa_id','lead_id','pessoa_id'] loop
      if p ? k and jsonb_typeof(p -> k) <> 'null' and not privado.ia_uuid_ok(p ->> k) then return 'Referência inválida na mensagem.'; end if;
    end loop;
  elsif p_tipo = 'mudar_etapa_lead' then
    if not privado.ia_uuid_ok(p ->> 'lead_id') then return 'Lead inválido.'; end if;
    if coalesce(p ->> 'status', '') not in ('novo','em_atendimento','visita','proposta','ganho','perdido') then return 'Etapa inválida.'; end if;
    if p ->> 'status' = 'perdido' and coalesce(btrim(p ->> 'motivo'), '') = '' then return 'Diga o motivo da perda.'; end if;
    if length(coalesce(p ->> 'motivo', '')) > 300 then return 'Motivo longo demais.'; end if;
  elsif p_tipo = 'mudar_responsavel_lead' then
    if not privado.ia_uuid_ok(p ->> 'lead_id') then return 'Lead inválido.'; end if;
    if p ? 'corretor_id' and jsonb_typeof(p -> 'corretor_id') <> 'null' and not privado.ia_uuid_ok(p ->> 'corretor_id') then return 'Corretor inválido.'; end if;
    if length(coalesce(p ->> 'motivo', '')) > 300 then return 'Motivo longo demais.'; end if;
  elsif p_tipo = 'desconto' then
    if not privado.ia_uuid_ok(p ->> 'contrato_id') then return 'Contrato inválido.'; end if;
    if coalesce(p ->> 'tipo', '') not in ('valor','pct') then return 'Tipo de desconto inválido.'; end if;
    v := privado.ia_num(p, 'valor');
    if v is null or v <= 0 or (p ->> 'tipo' = 'pct' and v > 100) or v > 1000000 then return 'Valor do desconto inválido.'; end if;
    if coalesce(p ->> 'inicio', '') !~ '^\d{4}-(0[1-9]|1[0-2])$' then return 'Mês inicial do desconto inválido.'; end if;
    if p ? 'fim' and jsonb_typeof(p -> 'fim') <> 'null' and ((p ->> 'fim') !~ '^\d{4}-(0[1-9]|1[0-2])$' or (p ->> 'fim') < (p ->> 'inicio')) then
      return 'Mês final do desconto inválido.';
    end if;
  elsif p_tipo = 'alterar_preco' then
    if not privado.ia_uuid_ok(p ->> 'imovel_id') then return 'Imóvel inválido.'; end if;
    if coalesce(p ->> 'campo', '') not in ('valor_aluguel','valor_venda') then return 'Campo de preço inválido.'; end if;
    v := privado.ia_num(p, 'valor');
    if v is null or v < 0 or v > 999999999 then return 'Preço inválido.'; end if;
  elsif p_tipo = 'cancelar_cobranca' then
    if not privado.ia_uuid_ok(p ->> 'fatura_id') then return 'Cobrança inválida.'; end if;
    if coalesce(btrim(p ->> 'motivo'), '') = '' or length(p ->> 'motivo') > 300 then return 'Diga o motivo do cancelamento (até 300 letras).'; end if;
  elsif p_tipo = 'renegociar_cobranca' then
    if not privado.ia_uuid_ok(p ->> 'fatura_id') then return 'Cobrança inválida.'; end if;
    if length(coalesce(p ->> 'observacao', '')) > 500 then return 'Observação longa demais.'; end if;
  elsif p_tipo = 'criar_lancamento' then
    if coalesce(p ->> 'tipo', '') not in ('receber','pagar') then return 'Tipo de lançamento inválido.'; end if;
    if coalesce(btrim(p ->> 'descricao'), '') = '' or length(p ->> 'descricao') > 200 then return 'Descrição do lançamento inválida.'; end if;
    v := privado.ia_num(p, 'valor');
    if v is null or v <= 0 or v > 999999999 then return 'Valor do lançamento inválido.'; end if;
    if not privado.ia_data_ok(p ->> 'vencimento') then return 'Vencimento inválido.'; end if;
    if length(coalesce(p ->> 'categoria', '')) > 80 then return 'Categoria longa demais.'; end if;
    foreach k in array array['pessoa_id','contrato_id','imovel_id'] loop
      if p ? k and jsonb_typeof(p -> k) <> 'null' and not privado.ia_uuid_ok(p ->> k) then return 'Referência inválida no lançamento.'; end if;
    end loop;
  elsif p_tipo = 'criar_tarefa' then
    if coalesce(btrim(p ->> 'titulo'), '') = '' or length(p ->> 'titulo') > 200 then return 'Título da tarefa inválido.'; end if;
    if p ? 'vencimento' and jsonb_typeof(p -> 'vencimento') <> 'null' and not privado.ia_data_ok(p ->> 'vencimento') then return 'Data da tarefa inválida.'; end if;
    if coalesce(p ->> 'prioridade', 'normal') not in ('alta','normal') then return 'Prioridade inválida.'; end if;
    foreach k in array array['lead_id','imovel_id','contrato_id'] loop
      if p ? k and jsonb_typeof(p -> k) <> 'null' and not privado.ia_uuid_ok(p ->> k) then return 'Referência inválida na tarefa.'; end if;
    end loop;
  else
    return 'Tipo de ação desconhecido.';
  end if;
  return null;
end;
$$;

/** Erro nas condições de uma regra (lista fechada de chaves por gatilho). Espelho de validarCondicoes. */
create or replace function privado.ia_condicoes_erro(p_gatilho text, p jsonb)
returns text language plpgsql immutable set search_path = pg_catalog
as $$
declare
  k text;
  v_ok text[];
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'Condições inválidas.'; end if;
  v_ok := case
    when p_gatilho in ('lead_novo','lead_parado','visita_sem_retorno') then array['funil','origem','prioridade','sem_corretor']
    when p_gatilho in ('fatura_vencida','contrato_vencendo') then array['valor_min']
    when p_gatilho = 'chamado_parado' then array['urgencia']
    else array[]::text[] end;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (v_ok)) then return format('Condição "%s" não vale para este gatilho.', k); end if;
  end loop;
  if p ? 'funil' and (p ->> 'funil') not in ('locacao','venda','captacao') then return 'Funil inválido.'; end if;
  if p ? 'origem' and (p ->> 'origem') not in ('site','whatsapp','instagram','facebook','tiktok','portal','zap','vivareal','olx','imovelweb','indicacao','placa','telefone','email','visita','outro') then
    return 'Origem inválida.';
  end if;
  if p ? 'prioridade' and (p ->> 'prioridade') not in ('quente','morno','frio') then return 'Prioridade inválida.'; end if;
  if p ? 'sem_corretor' and jsonb_typeof(p -> 'sem_corretor') <> 'boolean' then return 'Condição "sem corretor" inválida.'; end if;
  if p ? 'valor_min' and (privado.ia_num(p, 'valor_min') is null or privado.ia_num(p, 'valor_min') < 0) then return 'Valor mínimo inválido.'; end if;
  if p ? 'urgencia' and (p ->> 'urgencia') not in ('baixa','media','alta','emergencia') then return 'Urgência inválida.'; end if;
  return null;
end;
$$;

/** Erro na configuração da ação de uma regra. Espelho de validarConfigAcao. */
create or replace function privado.ia_acao_config_erro(p_acao text, p_gatilho text, p jsonb)
returns text language plpgsql immutable set search_path = pg_catalog
as $$
declare
  k text;
begin
  if p is null or jsonb_typeof(p) <> 'object' then return 'Configuração da ação inválida.'; end if;
  for k in select jsonb_object_keys(p) loop
    if not (k = any (array['titulo','prioridade','mensagem','canal','etiqueta'])) then return format('Campo "%s" desconhecido na ação.', k); end if;
  end loop;
  if length(coalesce(p ->> 'titulo', '')) > 120 then return 'Título longo demais (até 120 letras).'; end if;
  if length(coalesce(p ->> 'mensagem', '')) > 1000 then return 'Mensagem longa demais (até 1.000 letras).'; end if;
  if length(coalesce(p ->> 'etiqueta', '')) > 40 then return 'Etiqueta longa demais (até 40 letras).'; end if;
  if p_acao = 'criar_tarefa' and coalesce(p ->> 'prioridade', 'normal') not in ('alta','normal') then return 'Prioridade da tarefa inválida.'; end if;
  if p_acao = 'sugerir_mensagem' then
    if coalesce(btrim(p ->> 'mensagem'), '') = '' then return 'Escreva a mensagem que será sugerida.'; end if;
    if coalesce(p ->> 'canal', 'whatsapp') not in ('whatsapp','email','sms') then return 'Canal inválido.'; end if;
  end if;
  if p_acao = 'marcar_prioridade' then
    if not (p_gatilho = any (privado.ia_gatilhos_imob())) then return 'Marcar prioridade/etiqueta só vale para leads e visitas.'; end if;
    if coalesce(p ->> 'prioridade', '') = '' and coalesce(btrim(p ->> 'etiqueta'), '') = '' then return 'Escolha a prioridade ou a etiqueta.'; end if;
    if coalesce(p ->> 'prioridade', '') <> '' and (p ->> 'prioridade') not in ('quente','morno','frio') then return 'Prioridade do lead inválida.'; end if;
  end if;
  return null;
end;
$$;

/** Título padrão da tarefa/aviso de cada gatilho. Espelho de TITULO_PADRAO_GATILHO. */
create or replace function privado.ia_titulo_padrao(p_gatilho text)
returns text language sql immutable set search_path = pg_catalog
as $$
  select case p_gatilho
    when 'lead_novo' then 'Atender lead novo: {{nome}}'
    when 'lead_parado' then 'Retomar contato com {{nome}} (lead parado)'
    when 'visita_sem_retorno' then 'Pedir retorno da visita a {{nome}} ({{imovel}})'
    when 'fatura_vencida' then 'Cobrar {{nome}}: aluguel vencido em {{data}} ({{valor}})'
    when 'contrato_vencendo' then 'Contrato do imóvel {{imovel}} vence em {{data}}: falar com {{nome}}'
    when 'garantia_vencendo' then 'Garantia do imóvel {{imovel}} vence em {{data}}'
    when 'chamado_parado' then 'Chamado parado no imóvel {{imovel}}: dar andamento'
    when 'documento_pendente' then 'Cobrar documentos da análise de {{nome}}'
    else 'Automação' end
$$;

do $$
declare
  f text;
begin
  foreach f in array array['privado.ia_uuid_ok(text)','privado.ia_data_ok(text)','privado.ia_num(jsonb, text)','privado.ia_mascarar(text)','privado.ia_saida_extracao(text)',
                           'privado.ia_no_horario(timestamptz, time, time, smallint[])','privado.ia_moeda(numeric)',
                           'privado.ia_preencher(text, text, text, numeric, date, text)','privado.ia_payload_erro(text, jsonb)',
                           'privado.ia_condicoes_erro(text, jsonb)','privado.ia_acao_config_erro(text, text, jsonb)','privado.ia_titulo_padrao(text)'] loop
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 3. Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.ia_config (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null unique default privado.org_atual() references public.organizacoes(id) on delete cascade,
  ativa boolean not null default false,
  recursos text[] not null default privado.ia_recursos() check (recursos <@ privado.ia_recursos()),
  limite_dia_org integer not null default 300 check (limite_dia_org between 1 and 10000),
  limite_dia_usuario integer not null default 60 check (limite_dia_usuario between 1 and 5000),
  horario_inicio time not null default '08:00',
  horario_fim time not null default '18:00',
  dias_uteis smallint[] not null default '{1,2,3,4,5}' check (dias_uteis <@ '{1,2,3,4,5,6,7}'::smallint[]),
  fora_horario_ativo boolean not null default false,
  mensagem_fora_horario text not null default 'Olá, {{nome}}! Recebemos sua mensagem fora do nosso horário de atendimento ({{horario}}). Assim que voltarmos, alguém da nossa equipe fala com você. Obrigado!'
    check (length(mensagem_fora_horario) <= 1000),
  fora_horario_envio_auto boolean not null default false,
  exigir_aprovacao boolean not null default true,
  perguntas jsonb not null default '[
    {"campo":"finalidade","ativa":true,"texto":"Você procura imóvel para alugar ou para comprar?"},
    {"campo":"regiao","ativa":true,"texto":"Em qual bairro ou região você prefere?"},
    {"campo":"faixa_valor","ativa":true,"texto":"Até quanto pretende pagar?"},
    {"campo":"quartos","ativa":true,"texto":"Quantos quartos você precisa?"},
    {"campo":"prazo","ativa":true,"texto":"Para quando você precisa do imóvel?"}
  ]'::jsonb check (jsonb_typeof(perguntas) = 'array'),
  preco_entrada_mtok numeric(10,4) not null default 3 check (preco_entrada_mtok between 0 and 1000),
  preco_saida_mtok numeric(10,4) not null default 15 check (preco_saida_mtok between 0 and 1000),
  automacoes_em timestamptz,
  atualizado_por uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.ia_execucoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  usuario_id uuid default auth.uid(),
  recurso text not null check (recurso = any (privado.ia_recursos())),
  referencia_tipo text check (referencia_tipo is null or referencia_tipo ~ '^[a-z_]{2,30}$'),
  referencia_id uuid,
  entrada_resumo text check (entrada_resumo is null or length(entrada_resumo) <= 2000),
  saida text check (saida is null or length(saida) <= 20000),
  tokens_entrada integer not null default 0 check (tokens_entrada >= 0),
  tokens_saida integer not null default 0 check (tokens_saida >= 0),
  tokens_cache integer not null default 0 check (tokens_cache >= 0),
  custo_estimado numeric(12,6) not null default 0 check (custo_estimado >= 0),
  duracao_ms integer check (duracao_ms is null or duracao_ms >= 0),
  status text not null default 'reservada' check (status in ('reservada','ok','erro')),
  erro text check (erro is null or length(erro) <= 1000),
  dia date not null default (now() at time zone 'America/Sao_Paulo')::date,
  criado_em timestamptz not null default now(),
  concluido_em timestamptz
);
create index if not exists ia_execucoes_org_dia_idx on public.ia_execucoes (organizacao_id, dia);
create index if not exists ia_execucoes_usuario_dia_idx on public.ia_execucoes (organizacao_id, usuario_id, dia);
create index if not exists ia_execucoes_org_data_idx on public.ia_execucoes (organizacao_id, criado_em desc);

create table if not exists public.ia_acoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  numero bigint generated by default as identity,
  tipo text not null check (tipo = any (privado.ia_tipos_acao())),
  origem text not null default 'ia' check (origem in ('ia','automacao','usuario')),
  titulo text not null check (length(titulo) between 1 and 200),
  descricao text check (descricao is null or length(descricao) <= 2000),
  valor numeric(14,2),
  payload jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object'),
  referencia_tipo text check (referencia_tipo is null or referencia_tipo ~ '^[a-z_]{2,30}$'),
  referencia_id uuid,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  execucao_id uuid,
  regra_id uuid,
  chave text check (chave is null or length(chave) <= 200),
  -- executando = a via normal está rodando agora (trava contra rodar duas vezes).
  status text not null default 'pendente' check (status in ('pendente','aprovada','recusada','executando','executada','erro','cancelada')),
  aprovacao_automatica boolean not null default false,
  criada_por uuid default auth.uid(),
  decidida_por uuid,
  decidida_em timestamptz,
  motivo text check (motivo is null or length(motivo) <= 500),
  executada_por uuid,
  executada_em timestamptz,
  resultado text check (resultado is null or length(resultado) <= 1000),
  erro text check (erro is null or length(erro) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists ia_acoes_status_idx on public.ia_acoes (organizacao_id, status, created_at desc);
create index if not exists ia_acoes_pessoa_idx on public.ia_acoes (pessoa_id) where pessoa_id is not null;
create unique index if not exists ia_acoes_chave_idx on public.ia_acoes (organizacao_id, chave) where chave is not null;

create table if not exists public.automacoes_regras (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  gatilho text not null check (gatilho = any (privado.ia_gatilhos())),
  dias integer not null default 1 check (dias between 0 and 365),
  condicoes jsonb not null default '{}'::jsonb check (jsonb_typeof(condicoes) = 'object'),
  acao text not null check (acao = any (privado.ia_acoes_regra())),
  acao_config jsonb not null default '{}'::jsonb check (jsonb_typeof(acao_config) = 'object'),
  repetir_dias integer not null default 0 check (repetir_dias between 0 and 365),
  ativa boolean not null default true,
  criada_por uuid default auth.uid(),
  ultima_execucao_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Histórico das automações: só acréscimo e sem FK para a regra (sobrevive à exclusão dela).
create table if not exists public.automacoes_execucoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  regra_id uuid not null,
  regra_nome text,
  gatilho text not null,
  acao text not null,
  objeto_tipo text not null,
  objeto_id uuid not null,
  objeto_nome text,
  dia date not null,
  status text not null default 'ok' check (status in ('ok','erro','ignorado')),
  resultado text check (resultado is null or length(resultado) <= 500),
  acao_id uuid,
  criado_em timestamptz not null default now()
);
create unique index if not exists automacoes_execucoes_trava_idx on public.automacoes_execucoes (regra_id, objeto_id, dia);
create index if not exists automacoes_execucoes_org_data_idx on public.automacoes_execucoes (organizacao_id, criado_em desc);

create table if not exists public.ia_avisos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  usuario_id uuid not null,
  titulo text not null check (length(titulo) between 1 and 200),
  texto text check (texto is null or length(texto) <= 1000),
  link text check (link is null or (link ~ '^/[^/\\]' and length(link) <= 300)),
  regra_id uuid,
  lido_em timestamptz,
  criado_em timestamptz not null default now()
);
create index if not exists ia_avisos_usuario_idx on public.ia_avisos (organizacao_id, usuario_id, lido_em, criado_em desc);

create table if not exists public.ia_inconsistencias_conferidas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  tipo text not null check (tipo = any (privado.ia_inconsistencia_tipos())),
  chave text not null check (length(chave) between 1 and 300),
  observacao text check (observacao is null or length(observacao) <= 500),
  conferido_por uuid default auth.uid(),
  conferido_em timestamptz not null default now(),
  unique (organizacao_id, tipo, chave)
);

-- -----------------------------------------------------------------------------
-- 4. Quem pode o quê
-- -----------------------------------------------------------------------------
/** Configurar a IA e as automações: administrador ou gestor com Configurações → editar. */
create or replace function privado.ia_pode_configurar(p_org uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select coalesce(privado.papel_atual(p_org), '') in ('admin','gestor')
     and privado.tem_permissao(p_org, 'configuracoes', 'editar')
$$;

/** Executar (rodar a via normal) um tipo de ação: só a permissão do módulo. */
create or replace function privado.ia_pode_executar(p_org uuid, p_tipo text)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare
  v_perm text[];
begin
  if privado.papel_atual(p_org) is null then return false; end if;
  v_perm := privado.ia_acao_permissao(p_tipo, privado.org_imobiliaria(p_org));
  return v_perm is not null and privado.tem_permissao(p_org, v_perm[1], v_perm[2]);
end;
$$;

/**
 * Decidir (aprovar/recusar) uma ação. Sempre precisa da permissão do módulo.
 * Com "exigir aprovação" (padrão): só administrador, gestor ou quem tem
 * "aprovar" no módulo; e quem pediu não aprova a própria (só o administrador).
 * Sem "exigir aprovação": quem tem a permissão do módulo confirma.
 */
create or replace function privado.ia_pode_decidir(p_org uuid, p_tipo text, p_criada_por uuid)
returns boolean language plpgsql stable security definer set search_path = public
as $$
declare
  v_papel text := privado.papel_atual(p_org);
  v_perm text[];
  v_exigir boolean;
begin
  if v_papel is null or not privado.ia_pode_executar(p_org, p_tipo) then return false; end if;
  select exigir_aprovacao into v_exigir from public.ia_config where organizacao_id = p_org;
  if not coalesce(v_exigir, true) then return true; end if;
  if v_papel = 'admin' then return true; end if;
  v_perm := privado.ia_acao_permissao(p_tipo, privado.org_imobiliaria(p_org));
  if v_papel <> 'gestor' and not privado.tem_permissao(p_org, v_perm[1], 'aprovar') then return false; end if;
  if p_criada_por is not null and p_criada_por = auth.uid() then return false; end if;
  return true;
end;
$$;

create or replace function privado.ia_pode_ver_acao(p_org uuid, p_tipo text, p_criada_por uuid)
returns boolean language sql stable security definer set search_path = ''
as $$
  select p_criada_por = auth.uid()
      or coalesce(privado.papel_atual(p_org), '') in ('admin','gestor')
      or privado.ia_pode_executar(p_org, p_tipo)
$$;

do $$
declare
  f text;
begin
  foreach f in array array['privado.ia_pode_configurar(uuid)','privado.ia_pode_executar(uuid, text)',
                           'privado.ia_pode_decidir(uuid, text, uuid)','privado.ia_pode_ver_acao(uuid, text, uuid)'] loop
    execute format('revoke execute on function %s from public, anon', f);
    execute format('grant execute on function %s to authenticated', f);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Guardas (gatilhos BEFORE). security invoker: privado.chamada_da_api()
--    precisa enxergar quem chama (usuário pela API × função do próprio banco).
-- -----------------------------------------------------------------------------
create or replace function privado.ia_config_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_api boolean := privado.chamada_da_api();
  v_admin boolean;
  p jsonb;
begin
  if tg_op = 'UPDATE' then
    new.organizacao_id := old.organizacao_id;
    new.created_at := old.created_at;
  end if;
  new.recursos := array(select distinct r from unnest(coalesce(new.recursos, '{}')) r where r = any (privado.ia_recursos()) order by 1);
  new.dias_uteis := array(select distinct d from unnest(coalesce(new.dias_uteis, '{}')) d where d between 1 and 7 order by 1);
  if new.horario_fim <= new.horario_inicio then
    raise exception 'O fim do horário comercial precisa ser depois do início.';
  end if;
  new.mensagem_fora_horario := btrim(coalesce(new.mensagem_fora_horario, ''));
  if jsonb_array_length(new.perguntas) > 10 then
    raise exception 'No máximo 10 perguntas de qualificação.';
  end if;
  for p in select value from jsonb_array_elements(new.perguntas) loop
    if jsonb_typeof(p) <> 'object' or coalesce(p ->> 'campo', '') not in ('finalidade','regiao','faixa_valor','quartos','prazo')
       or length(coalesce(p ->> 'texto', '')) > 300 or (p ? 'ativa' and jsonb_typeof(p -> 'ativa') <> 'boolean') then
      raise exception 'Pergunta de qualificação inválida.';
    end if;
  end loop;
  if new.fora_horario_envio_auto and new.mensagem_fora_horario = '' then
    raise exception 'Escreva a mensagem fora do horário antes de ligar o envio automático.';
  end if;
  if v_api then
    v_admin := coalesce(privado.papel_atual(new.organizacao_id), '') = 'admin';
    -- O envio sem aprovação da resposta fora do horário só o ADMINISTRADOR liga, e
    -- vale só para o texto que ele aprovou: se outro papel muda o texto, desliga.
    if not v_admin then
      if new.fora_horario_envio_auto and (tg_op = 'INSERT' or not old.fora_horario_envio_auto) then
        raise exception 'Só o administrador liga o envio automático da resposta fora do horário.';
      end if;
      if tg_op = 'UPDATE' and new.mensagem_fora_horario is distinct from old.mensagem_fora_horario then
        new.fora_horario_envio_auto := false;
      end if;
    end if;
    new.atualizado_por := auth.uid();
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger ia_config_antes_trg before insert or update on public.ia_config
  for each row execute function privado.ia_config_antes();

/** Histórico de IA: só pelas funções do banco (nunca muda nem se apaga pela API). */
create or replace function privado.ia_execucoes_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if privado.chamada_da_api() then
    raise exception 'O histórico da IA não pode ser alterado.';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create or replace trigger ia_execucoes_antes_trg before insert or update or delete on public.ia_execucoes
  for each row execute function privado.ia_execucoes_antes();
create or replace trigger automacoes_execucoes_antes_trg before insert or update or delete on public.automacoes_execucoes
  for each row execute function privado.ia_execucoes_antes();

/**
 * Ações sugeridas: nascem pendentes (pela API), não mudam depois de sugeridas e
 * só andam pelos caminhos permitidos, por quem pode (privado.ia_pode_decidir /
 * ia_pode_executar). Ações de automação e pré-aprovadas (resposta fora do
 * horário com o texto do administrador) só nascem pelas funções do banco.
 */
create or replace function privado.ia_acoes_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_api boolean := privado.chamada_da_api();
  v_erro text;
  v_perm text[];
begin
  if tg_op = 'INSERT' then
    new.titulo := left(btrim(coalesce(new.titulo, '')), 200);
    if new.titulo = '' then raise exception 'Dê um título à ação.'; end if;
    v_erro := privado.ia_payload_erro(new.tipo, new.payload);
    if v_erro is not null then raise exception '%', v_erro; end if;
    if new.tipo = any (privado.ia_tipos_acao_imob()) and not privado.org_imobiliaria(new.organizacao_id) then
      raise exception 'Esta ação só existe no modo imobiliária.';
    end if;
    new.created_at := now();
    new.updated_at := now();
    if v_api then
      if new.origem = 'automacao' then raise exception 'Ações de automação só são criadas pelo próprio sistema.'; end if;
      v_perm := privado.ia_acao_permissao(new.tipo, privado.org_imobiliaria(new.organizacao_id));
      if not privado.tem_permissao(new.organizacao_id, v_perm[1], 'ver') then
        raise exception 'Seu perfil de acesso não permite sugerir esta ação.';
      end if;
      if (select count(*) from public.ia_acoes where organizacao_id = new.organizacao_id and criada_por = auth.uid() and status = 'pendente') >= 200 then
        raise exception 'Você já tem ações demais esperando aprovação.';
      end if;
      new.status := 'pendente';
      new.aprovacao_automatica := false;
      new.criada_por := auth.uid();
      new.chave := null;
      new.decidida_por := null;
      new.decidida_em := null;
      new.motivo := null;
      new.executada_por := null;
      new.executada_em := null;
      new.resultado := null;
      new.erro := null;
    else
      if new.status not in ('pendente','aprovada') then new.status := 'pendente'; end if;
      new.aprovacao_automatica := new.status = 'aprovada';
      if new.status = 'aprovada' then
        new.decidida_em := now();
        new.decidida_por := null;
      end if;
    end if;
    return new;
  end if;

  -- UPDATE: o que foi sugerido não muda (nem pelas funções do banco).
  new.organizacao_id := old.organizacao_id;
  new.numero := old.numero;
  new.tipo := old.tipo;
  new.origem := old.origem;
  new.titulo := old.titulo;
  new.descricao := old.descricao;
  new.valor := old.valor;
  new.referencia_tipo := old.referencia_tipo;
  new.referencia_id := old.referencia_id;
  new.execucao_id := old.execucao_id;
  new.regra_id := old.regra_id;
  new.chave := old.chave;
  new.criada_por := old.criada_por;
  new.created_at := old.created_at;
  new.aprovacao_automatica := old.aprovacao_automatica;
  new.updated_at := now();
  if not v_api then
    -- Funções do banco (juntar cadastros, FK "set null"): só a pessoa e o pessoa_id dos dados.
    return new;
  end if;
  new.payload := old.payload;
  new.pessoa_id := old.pessoa_id;

  -- Mesma situação de novo (duas abas, dois gestores ao mesmo tempo): recusa, em
  -- vez de aceitar calado — senão as duas telas executariam a mesma ação.
  if new.status = old.status then
    raise exception 'Esta ação já está nesta situação (%): outra pessoa (ou outra aba) acabou de mexer nela.', old.status;
  end if;

  if old.status = 'pendente' and new.status in ('aprovada','recusada') then
    if not privado.ia_pode_decidir(old.organizacao_id, old.tipo, old.criada_por) then
      raise exception 'Você não pode decidir esta ação (precisa de outra pessoa com permissão para aprovar).';
    end if;
    new.motivo := nullif(left(btrim(coalesce(new.motivo, '')), 500), '');
    if new.status = 'recusada' and new.motivo is null then raise exception 'Diga o motivo da recusa.'; end if;
    new.decidida_por := auth.uid();
    new.decidida_em := now();
    new.executada_por := null;
    new.executada_em := null;
    new.resultado := null;
    new.erro := null;
    return new;
  end if;

  if old.status = 'pendente' and new.status = 'cancelada' then
    if auth.uid() is distinct from old.criada_por and coalesce(privado.papel_atual(old.organizacao_id), '') not in ('admin','gestor') then
      raise exception 'Só quem pediu (ou o administrador/gestor) cancela a ação.';
    end if;
    new.motivo := nullif(left(btrim(coalesce(new.motivo, '')), 500), '');
    new.decidida_por := auth.uid();
    new.decidida_em := now();
    return new;
  end if;

  new.decidida_por := old.decidida_por;
  new.decidida_em := old.decidida_em;
  new.motivo := old.motivo;

  -- Começar a executar (trava): só uma tela consegue passar de aprovada/erro para
  -- "executando"; a outra recebe "já está nesta situação" e não roda nada.
  if old.status in ('aprovada','erro') and new.status = 'executando' then
    if not privado.ia_pode_executar(old.organizacao_id, old.tipo) then
      raise exception 'Você não pode executar esta ação.';
    end if;
    new.executada_por := auth.uid();
    new.executada_em := now();
    new.resultado := null;
    new.erro := null;
    return new;
  end if;

  -- Terminar: quem começou registra o resultado. Execução travada (caiu no meio)
  -- há mais de 10 minutos: quem pode executar marca como erro para tentar de novo.
  if old.status = 'executando' and new.status in ('executada','erro') then
    if not privado.ia_pode_executar(old.organizacao_id, old.tipo) then
      raise exception 'Você não pode executar esta ação.';
    end if;
    if old.executada_por is distinct from auth.uid() then
      if new.status <> 'erro' or old.executada_em > now() - interval '10 minutes' then
        raise exception 'Esta ação está sendo feita por outra pessoa agora.';
      end if;
      new.erro := 'A execução não terminou (tempo esgotado). Confira se a ação foi feita antes de tentar de novo.';
      new.resultado := null;
      new.executada_por := auth.uid();
      new.executada_em := now();
      return new;
    end if;
    new.executada_por := old.executada_por;
    new.executada_em := now();
    new.resultado := left(new.resultado, 1000);
    new.erro := case when new.status = 'erro' then left(coalesce(nullif(btrim(new.erro), ''), 'Não foi possível executar.'), 1000) end;
    return new;
  end if;

  -- Feita à mão (mensagem enviada pelo WhatsApp/e-mail, acordo montado): só nos
  -- tipos que pedem passo humano (espelho de ACAO_AUTOMATICA = false). Os que o
  -- sistema faz sozinho passam sempre por "executando".
  if old.status in ('aprovada','erro') and new.status = 'executada' and old.tipo in ('mensagem_cliente','renegociar_cobranca') then
    if not privado.ia_pode_executar(old.organizacao_id, old.tipo) then
      raise exception 'Você não pode executar esta ação.';
    end if;
    new.executada_por := auth.uid();
    new.executada_em := now();
    new.resultado := left(new.resultado, 1000);
    new.erro := null;
    return new;
  end if;

  raise exception 'Mudança de situação não permitida (% → %).', old.status, new.status;
end;
$$;
create or replace trigger ia_acoes_antes_trg before insert or update on public.ia_acoes
  for each row execute function privado.ia_acoes_antes();

create or replace function privado.automacoes_regras_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_erro text;
begin
  if tg_op = 'UPDATE' then
    new.organizacao_id := old.organizacao_id;
    new.criada_por := old.criada_por;
    new.created_at := old.created_at;
  end if;
  new.nome := left(btrim(coalesce(new.nome, '')), 80);
  if new.nome = '' then raise exception 'Dê um nome à automação.'; end if;
  if new.gatilho = any (privado.ia_gatilhos_imob()) and not privado.org_imobiliaria(new.organizacao_id) then
    raise exception 'Gatilhos de leads e visitas só existem no modo imobiliária.';
  end if;
  -- Tarefas só aparecem no Comercial (imobiliária): no pessoal ninguém as veria.
  if new.acao = any (privado.ia_acoes_regra_imob()) and not privado.org_imobiliaria(new.organizacao_id) then
    if new.acao = 'criar_tarefa' then
      raise exception 'No modo imóveis pessoais a automação não cria tarefa: use "Avisar o responsável" (aparece em Assistente e automações).';
    end if;
    raise exception 'Esta ação só existe no modo imobiliária.';
  end if;
  v_erro := coalesce(privado.ia_condicoes_erro(new.gatilho, new.condicoes), privado.ia_acao_config_erro(new.acao, new.gatilho, new.acao_config));
  if v_erro is not null then raise exception '%', v_erro; end if;
  if tg_op = 'INSERT' and privado.chamada_da_api()
     and (select count(*) from public.automacoes_regras where organizacao_id = new.organizacao_id) >= 50 then
    raise exception 'No máximo 50 automações por conta.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger automacoes_regras_antes_trg before insert or update on public.automacoes_regras
  for each row execute function privado.automacoes_regras_antes();

/** Aviso interno: pela API só se marca como lido. */
create or replace function privado.ia_avisos_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not privado.chamada_da_api() then return new; end if;
  if new.lido_em is not null and old.lido_em is null then new.lido_em := now(); else new.lido_em := old.lido_em; end if;
  new.organizacao_id := old.organizacao_id;
  new.usuario_id := old.usuario_id;
  new.titulo := old.titulo;
  new.texto := old.texto;
  new.link := old.link;
  new.regra_id := old.regra_id;
  new.criado_em := old.criado_em;
  return new;
end;
$$;
create or replace trigger ia_avisos_antes_trg before update on public.ia_avisos
  for each row execute function privado.ia_avisos_antes();

create or replace function privado.ia_conferidas_antes()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  new.chave := btrim(new.chave);
  new.observacao := nullif(btrim(coalesce(new.observacao, '')), '');
  if privado.chamada_da_api() then
    new.conferido_por := auth.uid();
    new.conferido_em := now();
  end if;
  return new;
end;
$$;
create or replace trigger ia_conferidas_antes_trg before insert on public.ia_inconsistencias_conferidas
  for each row execute function privado.ia_conferidas_antes();

-- -----------------------------------------------------------------------------
-- 6. RLS
-- -----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array['ia_config','ia_execucoes','ia_acoes','automacoes_regras','automacoes_execucoes','ia_avisos','ia_inconsistencias_conferidas'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
  end loop;

  -- Configuração: todos da conta leem (não há segredo); mudar = administrador/gestor com Configurações → editar.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_config' and policyname = 'ia_config_ver') then
    create policy ia_config_ver on public.ia_config for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_config' and policyname = 'ia_config_criar') then
    create policy ia_config_criar on public.ia_config for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and privado.ia_pode_configurar(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_config' and policyname = 'ia_config_alterar') then
    create policy ia_config_alterar on public.ia_config for update to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.ia_pode_configurar(organizacao_id))
      with check (organizacao_id in (select privado.org_ids()) and privado.ia_pode_configurar(organizacao_id));
  end if;

  -- Histórico da IA: cada um vê o seu; administrador e gestor veem tudo. Escrita só pelas funções.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_execucoes' and policyname = 'ia_execucoes_ver') then
    create policy ia_execucoes_ver on public.ia_execucoes for select to authenticated
      using (organizacao_id in (select privado.org_ids())
             and (usuario_id = auth.uid() or coalesce(privado.papel_atual(organizacao_id), '') in ('admin','gestor')));
  end if;

  -- Ações sugeridas: vê quem pediu, quem pode executar o tipo e administrador/gestor.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_acoes' and policyname = 'ia_acoes_ver') then
    create policy ia_acoes_ver on public.ia_acoes for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.ia_pode_ver_acao(organizacao_id, tipo, criada_por));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_acoes' and policyname = 'ia_acoes_criar') then
    create policy ia_acoes_criar on public.ia_acoes for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_acoes' and policyname = 'ia_acoes_alterar') then
    create policy ia_acoes_alterar on public.ia_acoes for update to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.ia_pode_ver_acao(organizacao_id, tipo, criada_por))
      with check (organizacao_id in (select privado.org_ids()));
  end if;

  -- Automações: ver = Configurações → ver; mudar = administrador/gestor com Configurações → editar.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'automacoes_regras' and policyname = 'automacoes_regras_ver') then
    create policy automacoes_regras_ver on public.automacoes_regras for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.tem_permissao(organizacao_id, 'configuracoes', 'ver'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'automacoes_regras' and policyname = 'automacoes_regras_mudar') then
    create policy automacoes_regras_mudar on public.automacoes_regras for all to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.ia_pode_configurar(organizacao_id))
      with check (organizacao_id in (select privado.org_ids()) and privado.ia_pode_configurar(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'automacoes_execucoes' and policyname = 'automacoes_execucoes_ver') then
    create policy automacoes_execucoes_ver on public.automacoes_execucoes for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.tem_permissao(organizacao_id, 'configuracoes', 'ver'));
  end if;

  -- Avisos internos: cada um vê e marca os seus.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_avisos' and policyname = 'ia_avisos_ver') then
    create policy ia_avisos_ver on public.ia_avisos for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and usuario_id = auth.uid());
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_avisos' and policyname = 'ia_avisos_ler') then
    create policy ia_avisos_ler on public.ia_avisos for update to authenticated
      using (organizacao_id in (select privado.org_ids()) and usuario_id = auth.uid())
      with check (organizacao_id in (select privado.org_ids()) and usuario_id = auth.uid());
  end if;

  -- Inconsistências conferidas: Financeiro → ver lê; Financeiro → editar marca e desmarca.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_inconsistencias_conferidas' and policyname = 'ia_conferidas_ver') then
    create policy ia_conferidas_ver on public.ia_inconsistencias_conferidas for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.tem_permissao(organizacao_id, 'financeiro', 'ver'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_inconsistencias_conferidas' and policyname = 'ia_conferidas_marcar') then
    create policy ia_conferidas_marcar on public.ia_inconsistencias_conferidas for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and privado.tem_permissao(organizacao_id, 'financeiro', 'editar'));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'ia_inconsistencias_conferidas' and policyname = 'ia_conferidas_desmarcar') then
    create policy ia_conferidas_desmarcar on public.ia_inconsistencias_conferidas for delete to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.tem_permissao(organizacao_id, 'financeiro', 'editar'));
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Auditoria (histórico de ações): configuração, regras e conferências. As
--    marcas de rodada (automacoes_em, ultima_execucao_em) não entram.
-- -----------------------------------------------------------------------------
create or replace trigger ia_config_auditoria_trg after insert or delete on public.ia_config
  for each row execute function privado.auditar();
create or replace trigger ia_config_auditoria_upd_trg after update on public.ia_config
  for each row when ((to_jsonb(old) - array['automacoes_em','updated_at']) is distinct from (to_jsonb(new) - array['automacoes_em','updated_at']))
  execute function privado.auditar();
create or replace trigger automacoes_regras_auditoria_trg after insert or delete on public.automacoes_regras
  for each row execute function privado.auditar();
create or replace trigger automacoes_regras_auditoria_upd_trg after update on public.automacoes_regras
  for each row when ((to_jsonb(old) - array['ultima_execucao_em','updated_at']) is distinct from (to_jsonb(new) - array['ultima_execucao_em','updated_at']))
  execute function privado.auditar();
create or replace trigger ia_inconsistencias_conferidas_auditoria_trg after insert or update or delete on public.ia_inconsistencias_conferidas
  for each row execute function privado.auditar();

-- -----------------------------------------------------------------------------
-- 8. Cota da IA: reservar antes de chamar, concluir depois
-- -----------------------------------------------------------------------------
create or replace function public.ia_reservar(p_recurso text, p_entrada text default null, p_ref_tipo text default null, p_ref_id uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  c ia_config%rowtype;
  v_perm text[];
  v_dia date := (now() at time zone 'America/Sao_Paulo')::date;
  v_n_org integer;
  v_n_user integer;
  v_id uuid;
begin
  if v_org is null or auth.uid() is null or privado.papel_atual(v_org) is null then
    raise exception 'Sem acesso.';
  end if;
  if p_recurso is null or not (p_recurso = any (privado.ia_recursos())) then
    raise exception 'Recurso de IA desconhecido.';
  end if;
  if p_recurso = any (privado.ia_recursos_imob()) and not privado.org_imobiliaria(v_org) then
    return jsonb_build_object('ok', false, 'motivo', 'modo', 'mensagem', 'Este recurso só existe no modo imobiliária.');
  end if;
  v_perm := privado.ia_recurso_permissao(p_recurso);
  if not privado.tem_permissao(v_org, v_perm[1], v_perm[2]) then
    return jsonb_build_object('ok', false, 'motivo', 'permissao', 'mensagem',
      format('Seu perfil de acesso não permite %s em %s.', privado.rotulo_permissao(v_perm[2]), privado.rotulo_permissao(v_perm[1])));
  end if;
  -- A linha da configuração fica travada até o fim: duas chamadas ao mesmo tempo não furam o limite.
  select * into c from ia_config where organizacao_id = v_org for update;
  if not found or not c.ativa then
    return jsonb_build_object('ok', false, 'motivo', 'desligada', 'mensagem', 'A IA está desligada nesta conta. O administrador liga em Assistente e automações → Configurações da IA.');
  end if;
  if not (p_recurso = any (c.recursos)) then
    return jsonb_build_object('ok', false, 'motivo', 'recurso_desligado', 'mensagem', 'Este recurso de IA está desligado nas configurações.');
  end if;
  -- Reservas esquecidas (a chamada caiu no meio) viram erro depois de 10 minutos; continuam contando no limite.
  update ia_execucoes set status = 'erro', erro = 'A chamada não terminou (tempo esgotado).', concluido_em = now()
   where organizacao_id = v_org and status = 'reservada' and criado_em < now() - interval '10 minutes';
  select count(*) into v_n_org from ia_execucoes where organizacao_id = v_org and dia = v_dia;
  if v_n_org >= c.limite_dia_org then
    return jsonb_build_object('ok', false, 'motivo', 'limite_org', 'mensagem',
      format('A conta chegou ao limite de %s usos da IA hoje. Amanhã libera de novo (ou o administrador aumenta o limite).', c.limite_dia_org));
  end if;
  select count(*) into v_n_user from ia_execucoes where organizacao_id = v_org and dia = v_dia and usuario_id = auth.uid();
  if v_n_user >= c.limite_dia_usuario then
    return jsonb_build_object('ok', false, 'motivo', 'limite_usuario', 'mensagem',
      format('Você chegou ao seu limite de %s usos da IA hoje. Amanhã libera de novo.', c.limite_dia_usuario));
  end if;
  insert into ia_execucoes (organizacao_id, usuario_id, recurso, entrada_resumo, referencia_tipo, referencia_id, dia)
  values (v_org, auth.uid(), p_recurso, nullif(left(privado.ia_mascarar(p_entrada), 2000), ''),
          case when p_ref_tipo ~ '^[a-z_]{2,30}$' then p_ref_tipo end, p_ref_id, v_dia)
  returning id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id,
    'restante_org', c.limite_dia_org - v_n_org - 1, 'restante_usuario', c.limite_dia_usuario - v_n_user - 1);
end;
$$;
revoke execute on function public.ia_reservar(text, text, text, uuid) from public, anon;
grant execute on function public.ia_reservar(text, text, text, uuid) to authenticated;

/**
 * Fecha a execução reservada (só quem reservou, só uma vez). O custo estimado
 * é calculado aqui com o preço por milhão de tokens da configuração (cache:
 * escrita 1,25×, leitura 0,1× do preço de entrada). Saída gravada mascarada; da
 * leitura de documentos fica só a lista dos campos encontrados.
 */
create or replace function public.ia_concluir(p_id uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e ia_execucoes%rowtype;
  c ia_config%rowtype;
  v_ent integer := least(greatest(coalesce(privado.ia_num(p, 'tokens_entrada'), 0), 0), 10000000)::integer;
  v_sai integer := least(greatest(coalesce(privado.ia_num(p, 'tokens_saida'), 0), 0), 10000000)::integer;
  v_cl integer := least(greatest(coalesce(privado.ia_num(p, 'tokens_cache_leitura'), 0), 0), 10000000)::integer;
  v_ce integer := least(greatest(coalesce(privado.ia_num(p, 'tokens_cache_escrita'), 0), 0), 10000000)::integer;
begin
  select * into e from ia_execucoes where id = p_id and organizacao_id = privado.org_atual() and usuario_id = auth.uid() for update;
  if not found then raise exception 'Execução da IA não encontrada.'; end if;
  if e.status <> 'reservada' then raise exception 'Esta execução da IA já foi encerrada.'; end if;
  select * into c from ia_config where organizacao_id = e.organizacao_id;
  update ia_execucoes set
    status = case when p ->> 'status' = 'ok' then 'ok' else 'erro' end,
    -- Leitura de documento: só os nomes dos campos encontrados (nunca os dados lidos).
    saida = case when e.recurso = 'extracao_documento' then privado.ia_saida_extracao(p ->> 'saida')
                 else nullif(left(privado.ia_mascarar(p ->> 'saida'), 20000), '') end,
    erro = case when p ->> 'status' = 'ok' then null else left(coalesce(nullif(p ->> 'erro', ''), 'Erro na chamada à IA.'), 1000) end,
    tokens_entrada = v_ent + v_cl + v_ce,
    tokens_saida = v_sai,
    tokens_cache = v_cl,
    custo_estimado = round(((v_ent + v_ce * 1.25 + v_cl * 0.1) * coalesce(c.preco_entrada_mtok, 0) + v_sai * coalesce(c.preco_saida_mtok, 0)) / 1000000.0, 6),
    duracao_ms = least(greatest(coalesce(privado.ia_num(p, 'duracao_ms'), 0), 0), 3600000)::integer,
    concluido_em = now()
  where id = e.id;
end;
$$;
revoke execute on function public.ia_concluir(uuid, jsonb) from public, anon;
grant execute on function public.ia_concluir(uuid, jsonb) to authenticated;

/** Item do resumo de uma consulta: {rotulo, valor, tipo} (tipo: moeda | inteiro). */
create or replace function privado.ia_item(p_rotulo text, p_valor numeric, p_tipo text)
returns jsonb language sql immutable set search_path = pg_catalog
as $$ select jsonb_build_object('rotulo', p_rotulo, 'valor', coalesce(p_valor, 0), 'tipo', p_tipo) $$;
grant execute on function privado.ia_item(text, numeric, text) to authenticated;

/** Totais de uso da IA num período (agregado no banco; RLS vale: cada um vê o seu, administrador/gestor tudo). */
create or replace function public.ia_uso_resumo(p_de date, p_ate date, p_usuario uuid default null, p_recurso text default null)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select jsonb_build_object(
    'chamadas', count(*),
    'ok', count(*) filter (where e.status = 'ok'),
    'erros', count(*) filter (where e.status = 'erro'),
    'tokens_entrada', coalesce(sum(e.tokens_entrada), 0),
    'tokens_saida', coalesce(sum(e.tokens_saida), 0),
    'custo', coalesce(sum(e.custo_estimado), 0),
    'duracao_media_ms', coalesce(round(avg(e.duracao_ms) filter (where e.status = 'ok')), 0))
  from ia_execucoes e
  where e.organizacao_id = privado.org_atual()
    and e.dia between coalesce(p_de, '2000-01-01') and coalesce(p_ate, '2999-12-31')
    and (p_usuario is null or e.usuario_id = p_usuario)
    and (p_recurso is null or e.recurso = p_recurso)
$$;
revoke execute on function public.ia_uso_resumo(date, date, uuid, text) from public, anon;
grant execute on function public.ia_uso_resumo(date, date, uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Assistente interno: UMA consulta de uma lista fechada (sessão do usuário)
-- -----------------------------------------------------------------------------
create or replace function public.ia_consulta(p_chave text, p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_imob boolean;
  v_perm text[];
  v_de date;
  v_ate date;
  v_dias integer;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  r jsonb;
begin
  if v_org is null or auth.uid() is null then raise exception 'Sem acesso.'; end if;
  if p_chave is null or not (p_chave = any (privado.ia_consultas())) then raise exception 'Consulta desconhecida.'; end if;
  v_imob := privado.org_imobiliaria(v_org);
  if p_chave = any (privado.ia_consultas_imob()) and not v_imob then raise exception 'Esta consulta só existe no modo imobiliária.'; end if;
  v_perm := privado.ia_consulta_permissao(p_chave);
  perform privado.exigir_permissao(v_org, v_perm[1], v_perm[2]);
  p := coalesce(p, '{}'::jsonb);
  if p_chave in ('aluguel_recebido','resumo_financeiro','despesas','receitas','leads_periodo') then
    if not privado.ia_data_ok(p ->> 'de') or not privado.ia_data_ok(p ->> 'ate') then raise exception 'Período inválido.'; end if;
    v_de := (p ->> 'de')::date;
    v_ate := (p ->> 'ate')::date;
    if v_ate < v_de or v_ate - v_de > 3700 then raise exception 'Período inválido (no máximo 10 anos).'; end if;
  end if;
  if p_chave = 'contratos_vencendo' then
    if p ? 'dias' and coalesce(p ->> 'dias', '') !~ '^\d{1,3}$' then raise exception 'Número de dias inválido.'; end if;
    v_dias := least(greatest(coalesce((p ->> 'dias')::integer, 60), 1), 730);
  end if;

  if p_chave = 'aluguel_recebido' then
    select jsonb_build_object(
      'titulo', 'Aluguel recebido',
      'fonte', 'Relatórios e BI → Financeiro (cada recebimento na data em que entrou, inclusive parciais)',
      'resumo', jsonb_build_array(privado.ia_item('Total recebido', sum(b.aluguel_recebido), 'moeda')),
      'tipos', jsonb_build_array('texto','moeda'),
      'colunas', jsonb_build_array('Mês','Aluguel recebido'),
      'linhas', coalesce(jsonb_agg(jsonb_build_array(to_char(b.mes, 'MM/YYYY'), b.aluguel_recebido) order by b.mes), '[]'::jsonb))
      into r from public.bi_financeiro_mensal(v_de, v_ate) b;
  elsif p_chave = 'resumo_financeiro' then
    select jsonb_build_object(
      'titulo', 'Resumo financeiro por mês',
      'fonte', 'Relatórios e BI → Financeiro (mesma conta da tela)',
      'resumo', jsonb_build_array(privado.ia_item('Aluguel recebido', sum(b.aluguel_recebido), 'moeda'),
                                  privado.ia_item('Outras receitas', sum(b.outras_receitas), 'moeda'),
                                  privado.ia_item('Despesas', sum(b.despesas), 'moeda')),
      'tipos', case when v_imob then jsonb_build_array('texto','moeda','moeda','moeda','moeda','moeda') else jsonb_build_array('texto','moeda','moeda','moeda') end,
      'colunas', case when v_imob then jsonb_build_array('Mês','Aluguel recebido','Outras receitas','Despesas','Repasses pagos','Taxa de administração')
                      else jsonb_build_array('Mês','Aluguel recebido','Outras receitas','Despesas') end,
      'linhas', coalesce(jsonb_agg(case when v_imob
                   then jsonb_build_array(to_char(b.mes, 'MM/YYYY'), b.aluguel_recebido, b.outras_receitas, b.despesas, b.repasses_pagos, b.taxa_administracao)
                   else jsonb_build_array(to_char(b.mes, 'MM/YYYY'), b.aluguel_recebido, b.outras_receitas, b.despesas) end order by b.mes), '[]'::jsonb))
      into r from public.bi_financeiro_mensal(v_de, v_ate) b;
  elsif p_chave = 'inadimplencia' then
    with abertas as (
      select f.id, f.vencimento, greatest(f.valor_total - f.valor_abatido, 0) as saldo, c.codigo as contrato, i.codigo as imovel
        from faturas f join contratos c on c.id = f.contrato_id left join imoveis i on i.id = c.imovel_id
       where f.organizacao_id = v_org and f.status = 'aberta' and f.vencimento < v_hoje and f.valor_total - f.valor_abatido > 0
    )
    select jsonb_build_object(
      'titulo', 'Aluguéis em atraso',
      'fonte', 'Cobranças → Quem deve (faturas em aberto vencidas, descontando o que já foi pago em parte)',
      'resumo', jsonb_build_array(privado.ia_item('Cobranças em atraso', (select count(*) from abertas), 'inteiro'), privado.ia_item('Total em atraso', (select sum(saldo) from abertas), 'moeda')),
      'tipos', jsonb_build_array('texto','texto','data','inteiro','moeda'),
      'colunas', jsonb_build_array('Contrato','Imóvel','Vencimento','Dias de atraso','Em aberto'),
      'linhas', coalesce((select jsonb_agg(jsonb_build_array(x.contrato, x.imovel, x.vencimento, v_hoje - x.vencimento, x.saldo) order by x.vencimento)
                            from (select * from abertas order by vencimento limit 50) x), '[]'::jsonb))
      into r;
  elsif p_chave = 'contratos_vencendo' then
    with vencendo as (
      select c.codigo, c.numero, i.codigo as imovel, c.data_fim, c.valor_aluguel, c.renovacao_automatica
        from contratos c left join imoveis i on i.id = c.imovel_id
       where c.organizacao_id = v_org and c.status = 'ativo' and c.data_fim between v_hoje and v_hoje + v_dias
    )
    select jsonb_build_object(
      'titulo', format('Contratos que vencem em até %s dias', v_dias),
      'fonte', 'Contratos ativos (data de fim do contrato)',
      'resumo', jsonb_build_array(privado.ia_item('Contratos', (select count(*) from vencendo), 'inteiro')),
      'tipos', jsonb_build_array('texto','texto','data','inteiro','moeda','texto'),
      'colunas', jsonb_build_array('Contrato','Imóvel','Fim','Dias','Aluguel','Renovação automática'),
      'linhas', coalesce((select jsonb_agg(jsonb_build_array(coalesce(x.codigo, '#' || x.numero), x.imovel, x.data_fim, x.data_fim - v_hoje, x.valor_aluguel,
                                                             case when x.renovacao_automatica then 'Sim' else 'Não' end) order by x.data_fim)
                            from (select * from vencendo order by data_fim limit 100) x), '[]'::jsonb))
      into r;
  elsif p_chave = 'imoveis_vagos' then
    with vagos as (
      select i.codigo, i.bairro, i.quartos, i.valor_aluguel
        from imoveis i
       where i.organizacao_id = v_org and i.status = 'disponivel' and 'locacao' = any (coalesce(i.finalidades, '{}'))
    )
    select jsonb_build_object(
      'titulo', 'Imóveis vagos para alugar',
      'fonte', 'Imóveis com situação "disponível" e finalidade locação',
      'resumo', jsonb_build_array(privado.ia_item('Imóveis vagos', (select count(*) from vagos), 'inteiro'), privado.ia_item('Aluguel pedido somado', (select sum(valor_aluguel) from vagos), 'moeda')),
      'tipos', jsonb_build_array('texto','texto','inteiro','moeda'),
      'colunas', jsonb_build_array('Imóvel','Bairro','Quartos','Aluguel pedido'),
      'linhas', coalesce((select jsonb_agg(jsonb_build_array(x.codigo, x.bairro, x.quartos, x.valor_aluguel) order by x.codigo)
                            from (select * from vagos order by codigo limit 100) x), '[]'::jsonb))
      into r;
  elsif p_chave in ('despesas','receitas') then
    -- Mesmos filtros de public.bi_financeiro_mensal (as "Outras receitas" e
    -- "Despesas" do Resumo financeiro): receitas sem o aluguel das faturas (nem
    -- os recebimentos parciais) e sem as vendas; na imobiliária, só o que é do
    -- escritório (fora valores de terceiros e despesas descontadas no repasse).
    with g as (
      select coalesce(nullif(btrim(l.categoria), ''), pc.nome, 'Sem categoria') as categoria, sum(coalesce(l.valor_pago, l.valor)) as total, count(*) as qtd
        from lancamentos l left join plano_contas pc on pc.id = l.plano_id
       where l.organizacao_id = v_org and l.status = 'liquidado'
         and l.tipo = case when p_chave = 'despesas' then 'pagar' else 'receber' end
         and l.liquidado_em between v_de and v_ate
         and (p_chave = 'despesas' or (l.fatura_id is null and l.fatura_pagamento_id is null and l.venda_id is null))
         and (not v_imob or (not l.terceiros and not l.descontar_repasse))
       group by 1
    )
    select jsonb_build_object(
      'titulo', case when p_chave = 'despesas' then 'Despesas pagas por categoria' else 'Receitas recebidas por categoria' end,
      'fonte', 'Financeiro → lançamentos baixados no período (mesma conta do Resumo financeiro'
               || case when v_imob then '; sem valores de terceiros nem despesas descontadas no repasse' else '' end || ')'
               || case when p_chave = 'receitas' then '. O aluguel recebido das faturas está na consulta "Aluguel recebido"; as vendas, em Vendas.' else '' end,
      'resumo', jsonb_build_array(privado.ia_item('Total', (select sum(total) from g), 'moeda'), privado.ia_item('Lançamentos', (select sum(qtd) from g), 'inteiro')),
      'tipos', jsonb_build_array('texto','moeda','inteiro'),
      'colunas', jsonb_build_array('Categoria','Total','Lançamentos'),
      'linhas', coalesce((select jsonb_agg(jsonb_build_array(categoria, total, qtd) order by total desc) from g), '[]'::jsonb))
      into r;
  elsif p_chave = 'repasses_pendentes' then
    with pend as (
      select rp.competencia, coalesce(rp.pagar_em, rp.previsto_para) as data, rp.valor_liquido, c.codigo as contrato
        from repasses rp join contratos c on c.id = rp.contrato_id
       where rp.organizacao_id = v_org and rp.status = 'pendente'
    )
    select jsonb_build_object(
      'titulo', 'Repasses a fazer',
      'fonte', 'Repasses pendentes (data programada ou prevista)',
      'resumo', jsonb_build_array(privado.ia_item('Repasses', (select count(*) from pend), 'inteiro'), privado.ia_item('Total a repassar', (select sum(valor_liquido) from pend), 'moeda')),
      'tipos', jsonb_build_array('texto','texto','data','moeda'),
      'colunas', jsonb_build_array('Contrato','Competência','Pagar em','Valor'),
      'linhas', coalesce((select jsonb_agg(jsonb_build_array(x.contrato, to_char(x.competencia, 'MM/YYYY'), x.data, x.valor_liquido) order by x.data nulls last)
                            from (select * from pend order by data nulls last limit 100) x), '[]'::jsonb))
      into r;
  elsif p_chave = 'leads_periodo' then
    with g as (
      select l.origem, count(*) as qtd, count(*) filter (where l.status = 'ganho') as ganhos, count(*) filter (where l.status = 'perdido') as perdidos
        from leads l
       where l.organizacao_id = v_org and (l.created_at at time zone 'America/Sao_Paulo')::date between v_de and v_ate
       group by 1
    )
    select jsonb_build_object(
      'titulo', 'Leads recebidos por origem',
      'fonte', 'Comercial → Leads (data de chegada)',
      'resumo', jsonb_build_array(privado.ia_item('Leads', (select sum(qtd) from g), 'inteiro'), privado.ia_item('Fechados', (select sum(ganhos) from g), 'inteiro')),
      'tipos', jsonb_build_array('texto','inteiro','inteiro','inteiro'),
      'colunas', jsonb_build_array('Origem','Leads','Fechados','Perdidos'),
      'linhas', coalesce((select jsonb_agg(jsonb_build_array(origem, qtd, ganhos, perdidos) order by qtd desc) from g), '[]'::jsonb))
      into r;
  elsif p_chave = 'chamados_abertos' then
    with g as (
      select ch.status, ch.urgencia, count(*) as qtd
        from chamados ch
       where ch.organizacao_id = v_org and ch.status not in ('concluido','avaliado','recusado','cancelado')
       group by 1, 2
    )
    select jsonb_build_object(
      'titulo', 'Chamados de manutenção em andamento',
      'fonte', 'Manutenção → chamados que ainda não foram concluídos nem cancelados',
      'resumo', jsonb_build_array(privado.ia_item('Chamados', (select sum(qtd) from g), 'inteiro')),
      'tipos', jsonb_build_array('texto','texto','inteiro'),
      'colunas', jsonb_build_array('Situação','Urgência','Chamados'),
      'linhas', coalesce((select jsonb_agg(jsonb_build_array(status, urgencia, qtd) order by qtd desc) from g), '[]'::jsonb))
      into r;
  end if;
  return r || jsonb_build_object('consulta', p_chave, 'parametros', p);
end;
$$;
revoke execute on function public.ia_consulta(text, jsonb) from public, anon;
grant execute on function public.ia_consulta(text, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Sugestão de preço por comparáveis da própria carteira (RLS vale)
-- -----------------------------------------------------------------------------
create or replace function public.ia_preco_comparaveis(p_imovel uuid, p_finalidade text)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  a imoveis%rowtype;
  v_area numeric;
  v_nivel text := 'bairro';
  v_n integer;
  v_med numeric;
  v_p25 numeric;
  v_p75 numeric;
  v_lista jsonb;
  v_cand jsonb;
begin
  if v_org is null then raise exception 'Sem acesso.'; end if;
  perform privado.exigir_permissao(v_org, 'imoveis', 'ver');
  if p_finalidade not in ('locacao','venda') then raise exception 'Escolha aluguel ou venda.'; end if;
  select * into a from imoveis where id = p_imovel;
  if not found then raise exception 'Imóvel não encontrado.'; end if;
  v_area := coalesce(nullif(a.area_util, 0), nullif(a.area_privativa, 0), nullif(a.area_construida, 0), nullif(a.area_total, 0));
  if v_area is null then
    return jsonb_build_object('amostra', 0, 'erro', 'Cadastre a área do imóvel para comparar o preço por m².');
  end if;

  -- Candidatos: mesmo tipo e cidade, área de 70% a 130%, quartos parecidos, com preço.
  select coalesce(jsonb_agg(to_jsonb(q)), '[]'::jsonb) into v_cand
    from (
      select i.id, i.codigo, i.bairro, x.area, i.quartos, x.valor, round(x.valor / x.area, 2) as m2,
             (lower(btrim(coalesce(i.bairro, ''))) = lower(btrim(coalesce(a.bairro, ''))) and coalesce(a.bairro, '') <> '') as mesmo_bairro
        from imoveis i
        cross join lateral (
          select coalesce(nullif(i.area_util, 0), nullif(i.area_privativa, 0), nullif(i.area_construida, 0), nullif(i.area_total, 0)) as area,
                 case when p_finalidade = 'locacao'
                      then coalesce((select c.valor_aluguel from contratos c where c.imovel_id = i.id and c.status = 'ativo' order by c.data_inicio desc limit 1), i.valor_aluguel)
                      else i.valor_venda end as valor
        ) x
       where i.id <> a.id
         and i.organizacao_id = a.organizacao_id
         and (a.tipo is null or i.tipo = a.tipo)
         and lower(btrim(coalesce(i.cidade, ''))) = lower(btrim(coalesce(a.cidade, '')))
         and x.area between v_area * 0.7 and v_area * 1.3
         and coalesce(x.valor, 0) > 0
         and (a.quartos is null or i.quartos is null or abs(i.quartos - a.quartos) <= 1)
         and (p_finalidade = any (coalesce(i.finalidades, '{}'))
              or (p_finalidade = 'locacao' and exists (select 1 from contratos c where c.imovel_id = i.id and c.status = 'ativo')))
    ) q;

  -- Primeiro o mesmo bairro; com menos de 3, a cidade toda.
  select count(*) into v_n from jsonb_to_recordset(v_cand) as t(mesmo_bairro boolean) where t.mesmo_bairro;
  if v_n < 3 then
    v_nivel := 'cidade';
    v_n := jsonb_array_length(v_cand);
  end if;
  if v_n < 3 then
    return jsonb_build_object('amostra', v_n, 'nivel', v_nivel, 'area', v_area,
      'erro', 'Há menos de 3 imóveis parecidos na carteira (mesmo tipo, cidade, área de 70% a 130% e quartos parecidos) para comparar.');
  end if;
  select percentile_cont(0.5) within group (order by t.m2), percentile_cont(0.25) within group (order by t.m2), percentile_cont(0.75) within group (order by t.m2)
    into v_med, v_p25, v_p75
    from jsonb_to_recordset(v_cand) as t(m2 numeric, mesmo_bairro boolean)
   where v_nivel = 'cidade' or t.mesmo_bairro;
  select jsonb_agg(jsonb_build_object('id', s.id, 'codigo', s.codigo, 'bairro', s.bairro, 'area', s.area, 'quartos', s.quartos, 'valor', s.valor, 'm2', s.m2)
                   order by abs(s.m2 - v_med), s.codigo)
    into v_lista
    from (select t.* from jsonb_to_recordset(v_cand) as t(id uuid, codigo text, bairro text, area numeric, quartos integer, valor numeric, m2 numeric, mesmo_bairro boolean)
           where v_nivel = 'cidade' or t.mesmo_bairro
           order by abs(t.m2 - v_med), t.codigo limit 12) s;
  return jsonb_build_object(
    'amostra', v_n,
    'nivel', v_nivel,
    'area', v_area,
    'finalidade', p_finalidade,
    'valor_atual', case when p_finalidade = 'locacao' then a.valor_aluguel else a.valor_venda end,
    'mediana_m2', round(v_med::numeric, 2),
    'p25_m2', round(v_p25::numeric, 2),
    'p75_m2', round(v_p75::numeric, 2),
    'sugerido', round((v_med * v_area)::numeric, 2),
    'faixa_min', round((v_p25 * v_area)::numeric, 2),
    'faixa_max', round((v_p75 * v_area)::numeric, 2),
    'comparaveis', coalesce(v_lista, '[]'::jsonb));
end;
$$;
revoke execute on function public.ia_preco_comparaveis(uuid, text) from public, anon;
grant execute on function public.ia_preco_comparaveis(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 11. Contratos em risco e previsão de vacância (regras; RLS vale)
-- -----------------------------------------------------------------------------
create or replace function public.ia_contratos_risco(p_dias integer default 120)
returns table (
  contrato_id uuid, codigo text, imovel_id uuid, imovel_codigo text, bairro text, data_fim date, dias_para_fim integer,
  valor_aluguel numeric, nota integer, motivos text[], vago_previsto_dias integer, vago_base text, perda_prevista numeric)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.org_atual();
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias integer := least(greatest(coalesce(p_dias, 120), 1), 730);
begin
  if v_org is null then raise exception 'Sem acesso.'; end if;
  perform privado.exigir_permissao(v_org, 'contratos', 'ver');
  return query
  with hist as (
    select c.imovel_id, lower(btrim(coalesce(i.bairro, ''))) as b,
           lead(c.data_inicio) over (partition by c.imovel_id order by c.data_inicio) - coalesce(c.data_rescisao, c.data_fim) as gap
      from contratos c join imoveis i on i.id = c.imovel_id
     where c.organizacao_id = v_org and c.status <> 'rascunho'
  ),
  gi as (select h.imovel_id, avg(h.gap) as m, count(*) as n from hist h where h.gap between 0 and 365 group by 1),
  gb as (select h.b, avg(h.gap) as m, count(*) as n from hist h where h.gap between 0 and 365 and h.b <> '' group by 1),
  gc as (select avg(h.gap) as m, count(*) as n from hist h where h.gap between 0 and 365),
  base as (
    select c.id, coalesce(c.codigo, '#' || c.numero) as codigo, c.imovel_id, i.codigo as icod, i.bairro, c.data_fim, c.data_fim - v_hoje as dias,
           c.valor_aluguel, c.renovacao_automatica,
           exists (select 1 from contrato_desocupacoes d where d.contrato_id = c.id and d.status <> 'concluida') as desocupa,
           (select count(*) from faturas f where f.contrato_id = c.id and f.status = 'aberta' and f.vencimento < v_hoje and f.valor_total - f.valor_abatido > 0) as atrasos,
           (select r.percentual from contrato_reajustes r where r.contrato_id = c.id and r.data_reajuste >= v_hoje - 365 order by r.data_reajuste desc limit 1) as reajuste
      from contratos c left join imoveis i on i.id = c.imovel_id
     where c.organizacao_id = v_org and c.status = 'ativo'
  ),
  pontos as (
    select b.*,
           (case when b.dias <= 30 then 40 when b.dias <= 60 then 30 when b.dias <= 120 then 15 else 0 end)
           + (case when b.desocupa then 40 else 0 end)
           + least(b.atrasos * 10, 30)
           + (case when coalesce(b.reajuste, 0) >= 10 then 10 else 0 end)
           - (case when b.renovacao_automatica and not b.desocupa then 10 else 0 end) as pts,
           array_remove(array[
             case when b.dias < 0 then 'Prazo já terminou e o contrato segue ativo'
                  when b.dias <= v_dias then format('Termina em %s dia(s)', b.dias) end,
             case when b.desocupa then 'Aviso de desocupação aberto' end,
             case when b.atrasos > 0 then format('%s aluguel(éis) em atraso', b.atrasos) end,
             case when coalesce(b.reajuste, 0) >= 10 then format('Reajuste alto no último ano (%s%%)', round(b.reajuste, 1)) end,
             case when b.renovacao_automatica then 'Renovação automática ligada' end
           ], null) as mot
      from base b
  )
  select p.id, p.codigo, p.imovel_id, p.icod, p.bairro, p.data_fim, p.dias, p.valor_aluguel,
         least(greatest(p.pts, 0), 100)::integer,
         p.mot,
         round(coalesce(case when gi.n > 0 then gi.m end, case when gb.n > 0 then gb.m end, case when gc.n > 0 then gc.m end, 60))::integer,
         case when gi.n > 0 then 'histórico do imóvel' when gb.n > 0 then 'média do bairro' when gc.n > 0 then 'média da carteira' else 'estimativa padrão (60 dias)' end,
         round(p.valor_aluguel / 30.0 * coalesce(case when gi.n > 0 then gi.m end, case when gb.n > 0 then gb.m end, case when gc.n > 0 then gc.m end, 60), 2)
    from pontos p
    left join gi on gi.imovel_id = p.imovel_id
    left join gb on gb.b = lower(btrim(coalesce(p.bairro, '')))
    cross join gc
   where p.dias <= v_dias or p.desocupa or p.atrasos > 0
   order by least(greatest(p.pts, 0), 100) desc, p.data_fim;
end;
$$;
revoke execute on function public.ia_contratos_risco(integer) from public, anon;
grant execute on function public.ia_contratos_risco(integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 12. Inconsistências financeiras (regras; RLS vale; repasses só na imobiliária)
-- -----------------------------------------------------------------------------
create or replace function public.ia_inconsistencias(p_dias_repasse integer default 5)
returns table (tipo text, chave text, descricao text, valor numeric, referencia_tipo text, referencia_id uuid, data date,
               conferido_em timestamptz, conferido_por uuid, observacao text)
language plpgsql
stable
security invoker
set search_path = public
as $$
#variable_conflict use_column
declare
  v_org uuid := privado.org_atual();
  v_imob boolean;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_dias integer := least(greatest(coalesce(p_dias_repasse, 5), 0), 90);
begin
  if v_org is null then raise exception 'Sem acesso.'; end if;
  perform privado.exigir_permissao(v_org, 'financeiro', 'ver');
  v_imob := privado.org_imobiliaria(v_org);
  return query
  with achados as (
    -- Lançamento duplicado: mesmo tipo, valor, vencimento, pessoa e descrição.
    select 'lancamento_duplicado'::text as tipo,
           'l:' || array_to_string((array_agg(l.id order by l.id))[1:5], ',') as chave,
           format('%s lançamentos iguais: "%s" (%s, vencimento %s)', count(*), min(l.descricao), privado.ia_moeda(l.valor), to_char(l.vencimento, 'DD/MM/YYYY')) as descricao,
           l.valor as valor, 'lancamento'::text as rt, (array_agg(l.id order by l.id))[1] as rid, l.vencimento as data
      from lancamentos l
     where l.organizacao_id = v_org and l.status <> 'cancelado' and l.fatura_id is null and l.repasse_id is null
     group by l.tipo, l.valor, l.vencimento, coalesce(l.pessoa_id::text, ''), lower(btrim(l.descricao))
    having count(*) > 1
    union all
    -- Pagamento maior que o devido (lançamento).
    select 'pagamento_maior', 'l:' || l.id,
           format('"%s": pago %s, devido %s', l.descricao, privado.ia_moeda(l.valor_pago), privado.ia_moeda(l.valor + coalesce(l.juros, 0) - coalesce(l.desconto, 0))),
           l.valor_pago - (l.valor + coalesce(l.juros, 0) - coalesce(l.desconto, 0)), 'lancamento', l.id, l.liquidado_em
      from lancamentos l
     where l.organizacao_id = v_org and l.status = 'liquidado' and l.valor_pago is not null
       and l.valor_pago > l.valor + coalesce(l.juros, 0) - coalesce(l.desconto, 0) + 0.01
    union all
    -- Pagamento maior que o devido (aluguel: principal recebido acima do valor da fatura).
    select 'pagamento_maior', 'f:' || f.id,
           format('Fatura #%s: recebido %s de principal para uma cobrança de %s', f.numero, privado.ia_moeda(sum(fp.principal)), privado.ia_moeda(f.valor_total)),
           sum(fp.principal) - f.valor_total, 'fatura', f.id, max(fp.pago_em)
      from faturas f join fatura_pagamentos fp on fp.fatura_id = f.id
     where f.organizacao_id = v_org and f.status <> 'cancelada'
     group by f.id, f.numero, f.valor_total
    having sum(fp.principal) > f.valor_total + 0.01
    union all
    -- Repasse sem a fatura paga (imobiliária).
    select 'repasse_sem_fatura_paga', 'r:' || rp.id,
           format('Repasse de %s (%s) com a fatura #%s %s', to_char(rp.competencia, 'MM/YYYY'), privado.ia_moeda(rp.valor_liquido), f.numero,
                  case f.status when 'aberta' then 'ainda em aberto' when 'cancelada' then 'cancelada' when 'renegociada' then 'em acordo' else f.status end),
           rp.valor_liquido, 'repasse', rp.id, coalesce(rp.pago_em, rp.previsto_para)
      from repasses rp join faturas f on f.id = rp.fatura_id
     where v_imob and rp.organizacao_id = v_org and rp.status in ('pendente','pago') and f.status <> 'paga'
       and not exists (select 1 from contratos c where c.id = rp.contrato_id and c.tipo_repasse = 'garantido')
    union all
    -- Fatura paga sem repasse depois de N dias (imobiliária; contrato com proprietário).
    select 'fatura_paga_sem_repasse', 'f:' || f.id,
           format('Fatura #%s paga em %s (%s) e sem repasse ao proprietário', f.numero, to_char(f.pago_em, 'DD/MM/YYYY'), privado.ia_moeda(f.valor_pago)),
           f.valor_pago, 'fatura', f.id, f.pago_em
      from faturas f
     where v_imob and f.organizacao_id = v_org and f.status = 'paga' and f.pago_em < v_hoje - v_dias and f.pago_em >= v_hoje - 180
       and exists (select 1 from contrato_partes cp where cp.contrato_id = f.contrato_id and cp.papel = 'proprietario')
       and not exists (select 1 from repasses rp where rp.fatura_id = f.id and rp.status <> 'cancelado')
    union all
    -- Taxa de administração diferente da contratada (tolerância de R$ 1,00).
    select 'taxa_fora_contrato', 'r:' || rp.id,
           format('Repasse de %s: taxa de %s, o contrato (%s%%) daria %s', to_char(rp.competencia, 'MM/YYYY'), privado.ia_moeda(rp.taxa_administracao),
                  c.taxa_administracao_pct, privado.ia_moeda(round(rp.aluguel * c.taxa_administracao_pct / 100, 2))),
           rp.taxa_administracao - round(rp.aluguel * c.taxa_administracao_pct / 100, 2), 'repasse', rp.id, rp.competencia
      from repasses rp join contratos c on c.id = rp.contrato_id
     where v_imob and rp.organizacao_id = v_org and rp.status <> 'cancelado' and rp.created_at >= now() - interval '365 days'
       and c.taxa_administracao_pct is not null
       and abs(rp.taxa_administracao - round(rp.aluguel * c.taxa_administracao_pct / 100, 2)) > 1.00
    union all
    -- Lançamento sem categoria (nem plano de contas).
    select 'lancamento_sem_categoria', 'l:' || l.id,
           format('"%s" (%s, vencimento %s) sem categoria nem conta do plano', l.descricao, privado.ia_moeda(l.valor), to_char(l.vencimento, 'DD/MM/YYYY')),
           l.valor, 'lancamento', l.id, l.vencimento
      from lancamentos l
     where l.organizacao_id = v_org and l.status <> 'cancelado' and l.plano_id is null and nullif(btrim(coalesce(l.categoria, '')), '') is null
    union all
    -- Conta com saldo negativo (mesma conta da tela de contas do Financeiro).
    select 'saldo_negativo', 'c:' || s.id || ':' || round(s.saldo),
           format('Conta "%s" com saldo de %s', s.nome, privado.ia_moeda(s.saldo)), s.saldo, 'conta', s.id, v_hoje
      from (
        select cf.id, cf.nome,
               cf.saldo_inicial
               + coalesce((select sum(case when l.tipo = 'receber' then 1 else -1 end * coalesce(l.valor_pago, l.valor))
                             from lancamentos l
                            where l.conta_id = cf.id and l.status = 'liquidado' and l.liquidado_em >= cf.saldo_inicial_em and l.liquidado_em <= v_hoje
                              and (l.fatura_id is null or l.categoria = 'Aluguel')), 0)
               + coalesce((select sum(a.valor) from alugueis_recebidos a where a.conta_id = cf.id and a.data >= cf.saldo_inicial_em and a.data <= v_hoje), 0)
               - coalesce((select sum(rp.valor_liquido) from repasses rp where rp.conta_id = cf.id and rp.status = 'pago'
                                                                       and rp.pago_em >= cf.saldo_inicial_em and rp.pago_em <= v_hoje), 0)
               + coalesce((select sum(t.valor) from transferencias t where t.destino_id = cf.id and t.data >= cf.saldo_inicial_em and t.data <= v_hoje), 0)
               - coalesce((select sum(t.valor) from transferencias t where t.origem_id = cf.id and t.data >= cf.saldo_inicial_em and t.data <= v_hoje), 0) as saldo
          from contas_financeiras cf
         where cf.organizacao_id = v_org and cf.ativa
      ) s
     where s.saldo < -0.004
  )
  select a.tipo, a.chave, a.descricao, round(a.valor, 2), a.rt, a.rid, a.data, k.conferido_em, k.conferido_por, k.observacao
    from achados a
    left join ia_inconsistencias_conferidas k on k.organizacao_id = v_org and k.tipo = a.tipo and k.chave = a.chave
   order by (k.conferido_em is not null), a.data desc nulls last, a.tipo
   limit 500;
end;
$$;
revoke execute on function public.ia_inconsistencias(integer) from public, anon;
grant execute on function public.ia_inconsistencias(integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 13. Automações por regras: objetos de cada gatilho e a rodada
-- -----------------------------------------------------------------------------
/** Condições de lead (funil, origem, prioridade, sem corretor). */
create or replace function privado.ia_cond_lead(p jsonb, p_funil text, p_origem text, p_prioridade text, p_corretor uuid)
returns boolean language sql immutable set search_path = pg_catalog
as $$
  select (not (p ? 'funil') or p ->> 'funil' = p_funil)
     and (not (p ? 'origem') or p ->> 'origem' = p_origem)
     and (not (p ? 'prioridade') or p ->> 'prioridade' = p_prioridade)
     and (not coalesce((p ->> 'sem_corretor')::boolean, false) or p_corretor is null)
$$;

/** Objetos que disparam um gatilho hoje (no máximo 200). Só para as funções do banco. */
create or replace function privado.automacoes_objetos(p_org uuid, p_gatilho text, p_dias integer, p_cond jsonb, p_hoje date)
returns table (tipo text, id uuid, nome text, telefone text, email text, pessoa_id uuid, lead_id uuid, imovel_id uuid,
               contrato_id uuid, imovel text, valor numeric, data date, responsavel uuid)
language plpgsql
stable
security definer
set search_path = public
as $$
#variable_conflict use_column
declare
  v_d integer := greatest(coalesce(p_dias, 1), 0);
  v_min numeric := coalesce(privado.ia_num(p_cond, 'valor_min'), 0);
begin
  if p_gatilho = 'lead_novo' then
    return query
    select 'lead'::text, l.id, l.nome, l.telefone, l.email, null::uuid, l.id, l.imovel_id, null::uuid, i.codigo, l.orcamento_max,
           (l.created_at at time zone 'America/Sao_Paulo')::date,
           (select m.user_id from membros m where m.organizacao_id = p_org and m.pessoa_id = l.corretor_id limit 1)
      from leads l left join imoveis i on i.id = l.imovel_id
     where l.organizacao_id = p_org and l.status = 'novo' and l.created_at >= now() - make_interval(days => greatest(v_d, 1))
       and privado.ia_cond_lead(p_cond, l.funil, l.origem, l.prioridade, l.corretor_id)
     order by l.created_at limit 200;
  elsif p_gatilho = 'lead_parado' then
    return query
    select 'lead'::text, l.id, l.nome, l.telefone, l.email, null::uuid, l.id, l.imovel_id, null::uuid, i.codigo, l.orcamento_max,
           (coalesce(l.ultimo_contato, l.atendido_em, l.created_at) at time zone 'America/Sao_Paulo')::date,
           (select m.user_id from membros m where m.organizacao_id = p_org and m.pessoa_id = l.corretor_id limit 1)
      from leads l left join imoveis i on i.id = l.imovel_id
     where l.organizacao_id = p_org and l.status in ('novo','em_atendimento','visita','proposta')
       and coalesce(l.ultimo_contato, l.atendido_em, l.created_at) < now() - make_interval(days => greatest(v_d, 1))
       and privado.ia_cond_lead(p_cond, l.funil, l.origem, l.prioridade, l.corretor_id)
     order by coalesce(l.ultimo_contato, l.atendido_em, l.created_at) limit 200;
  elsif p_gatilho = 'visita_sem_retorno' then
    return query
    select 'visita'::text, v.id, coalesce(l.nome, v.contato_nome), coalesce(l.telefone, v.contato_telefone), l.email, v.pessoa_id, v.lead_id,
           v.imovel_id, null::uuid, i.codigo, null::numeric, (v.data_hora at time zone 'America/Sao_Paulo')::date,
           coalesce(v.responsavel_id, (select m.user_id from membros m where m.organizacao_id = p_org and m.pessoa_id = l.corretor_id limit 1))
      from visitas v join leads l on l.id = v.lead_id left join imoveis i on i.id = v.imovel_id
     where v.organizacao_id = p_org and v.tipo = 'visita' and v.status in ('agendada','realizada')
       and v.data_hora < now() - make_interval(days => greatest(v_d, 1)) and v.data_hora > now() - interval '60 days'
       and v.feedback_interesse is null and v.feedback_nota is null and v.feedback_texto is null
       and l.status not in ('ganho','perdido')
       and not exists (select 1 from lead_eventos e where e.lead_id = v.lead_id and e.data > v.data_hora
                                                    and e.tipo in ('ligacao','whatsapp','email','reuniao','mensagem'))
       and privado.ia_cond_lead(p_cond, l.funil, l.origem, l.prioridade, l.corretor_id)
     order by v.data_hora limit 200;
  elsif p_gatilho = 'fatura_vencida' then
    return query
    select 'fatura'::text, f.id, pe.nome, pe.telefone, pe.email, pe.id, null::uuid, c.imovel_id, c.id, i.codigo,
           f.valor_total - f.valor_abatido, f.vencimento, null::uuid
      from faturas f join contratos c on c.id = f.contrato_id left join imoveis i on i.id = c.imovel_id
      left join lateral (select x.* from contrato_partes cp join pessoas x on x.id = cp.pessoa_id
                          where cp.contrato_id = c.id and cp.papel = 'locatario' order by x.nome limit 1) pe on true
     where f.organizacao_id = p_org and f.status = 'aberta' and f.vencimento < p_hoje and f.vencimento <= p_hoje - v_d
       and f.valor_total - f.valor_abatido > 0 and f.valor_total - f.valor_abatido >= v_min
     order by f.vencimento limit 200;
  elsif p_gatilho = 'contrato_vencendo' then
    return query
    select 'contrato'::text, c.id, pe.nome, pe.telefone, pe.email, pe.id, null::uuid, c.imovel_id, c.id, i.codigo, c.valor_aluguel, c.data_fim, null::uuid
      from contratos c left join imoveis i on i.id = c.imovel_id
      left join lateral (select x.* from contrato_partes cp join pessoas x on x.id = cp.pessoa_id
                          where cp.contrato_id = c.id and cp.papel = 'locatario' order by x.nome limit 1) pe on true
     where c.organizacao_id = p_org and c.status = 'ativo' and c.data_fim between p_hoje and p_hoje + greatest(v_d, 1)
       and c.valor_aluguel >= v_min
     order by c.data_fim limit 200;
  elsif p_gatilho = 'garantia_vencendo' then
    return query
    select 'garantia'::text, g.id, pe.nome, pe.telefone, pe.email, pe.id, null::uuid, c.imovel_id, c.id, i.codigo, g.valor, g.fim, null::uuid
      from contrato_garantias g join contratos c on c.id = g.contrato_id and c.status = 'ativo'
      left join imoveis i on i.id = c.imovel_id
      left join lateral (select x.* from contrato_partes cp join pessoas x on x.id = cp.pessoa_id
                          where cp.contrato_id = c.id and cp.papel = 'locatario' order by x.nome limit 1) pe on true
     where g.organizacao_id = p_org and g.status = 'ativa' and g.fim between p_hoje and p_hoje + greatest(v_d, 1)
     order by g.fim limit 200;
  elsif p_gatilho = 'chamado_parado' then
    return query
    select 'chamado'::text, ch.id, coalesce(sp.nome, ch.solicitante_nome), coalesce(sp.telefone, ch.solicitante_telefone), sp.email,
           ch.solicitante_pessoa_id, null::uuid, ch.imovel_id, ch.contrato_id, i.codigo, null::numeric,
           (ch.updated_at at time zone 'America/Sao_Paulo')::date, ch.criado_por
      from chamados ch left join pessoas sp on sp.id = ch.solicitante_pessoa_id left join imoveis i on i.id = ch.imovel_id
     where ch.organizacao_id = p_org and ch.status in ('aberto','em_analise','aguardando_aprovacao','aprovado','agendado','em_execucao')
       and ch.updated_at < now() - make_interval(days => greatest(v_d, 1))
       and (not (p_cond ? 'urgencia') or ch.urgencia = p_cond ->> 'urgencia')
     order by ch.updated_at limit 200;
  elsif p_gatilho = 'documento_pendente' then
    return query
    select 'analise'::text, a.id, pe.nome, pe.telefone, pe.email, pe.id, null::uuid, a.imovel_id, null::uuid, i.codigo, a.valor_aluguel,
           (a.created_at at time zone 'America/Sao_Paulo')::date, a.responsavel_id
      from analises a join pessoas pe on pe.id = a.candidato_id left join imoveis i on i.id = a.imovel_id
     where a.organizacao_id = p_org and a.status = 'em_analise' and a.created_at < now() - make_interval(days => v_d)
       and exists (select 1 from analise_documentos d where d.analise_id = a.id and d.obrigatorio and d.status in ('pendente','recusado'))
     order by a.created_at limit 200;
  end if;
end;
$$;
revoke execute on function privado.automacoes_objetos(uuid, text, integer, jsonb, date) from public, anon, authenticated;

/** Link interno de cada objeto (para o aviso). */
create or replace function privado.ia_link_objeto(p_tipo text, p_id uuid, p_lead uuid, p_contrato uuid)
returns text language sql immutable set search_path = pg_catalog
as $$
  select case p_tipo
    when 'lead' then '/comercial/leads/' || p_id
    when 'visita' then coalesce('/comercial/leads/' || p_lead, '/agenda')
    when 'fatura' then '/faturas/' || p_id
    when 'contrato' then '/contratos/' || p_id
    when 'garantia' then coalesce('/contratos/' || p_contrato, '/analise/garantias')
    when 'chamado' then '/manutencao/' || p_id
    when 'analise' then '/analise/' || p_id
    else '/inteligencia' end
$$;

/**
 * Rodada das automações da organização de quem está logado (no máximo a cada
 * 10 min; "forçar" só administrador/gestor). Para cada regra ativa, cada objeto
 * do gatilho dispara a ação UMA vez por dia (trava única regra+objeto+dia) e,
 * com "repetir a cada N dias" = 0, uma vez só. Depois, a resposta fora do
 * horário (imobiliária) vira ação sugerida — ou pré-aprovada, se o
 * administrador ligou o envio sem aprovação (texto fixo dele, nunca da IA);
 * o envio em si continua pelo botão. Regras de tarefa e de leads só rodam na
 * imobiliária.
 */
create or replace function public.automacoes_rodar(p_forcar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_imob boolean;
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  c ia_config%rowtype;
  r automacoes_regras%rowtype;
  o record;
  m record;
  v_n integer := 0;
  v_regras integer := 0;
  v_fora integer := 0;
  v_res text;
  v_status text;
  v_acao uuid;
  v_dest uuid[];
  v_titulo text;
  v_texto text;
  v_destino text;
  v_canal text;
  v_horario text;
begin
  if v_org is null or auth.uid() is null or privado.papel_atual(v_org) is null then raise exception 'Sem acesso.'; end if;
  if p_forcar and not privado.ia_pode_configurar(v_org) then
    raise exception 'Só o administrador ou o gestor rodam as automações na hora.';
  end if;
  v_imob := privado.org_imobiliaria(v_org);
  insert into ia_config (organizacao_id) values (v_org) on conflict (organizacao_id) do nothing;
  update ia_config set automacoes_em = now()
   where organizacao_id = v_org and (p_forcar or automacoes_em is null or automacoes_em < now() - interval '10 minutes')
  returning * into c;
  if not found then return jsonb_build_object('rodou', false); end if;

  for r in select * from automacoes_regras where organizacao_id = v_org and ativa order by created_at loop
    -- Conta que mudou para o modo pessoal: regras de lead/visita e de tarefa ficam paradas.
    if (r.gatilho = any (privado.ia_gatilhos_imob()) or r.acao = any (privado.ia_acoes_regra_imob())) and not v_imob then continue; end if;
    v_regras := v_regras + 1;
    for o in select * from privado.automacoes_objetos(v_org, r.gatilho, r.dias, r.condicoes, v_hoje) loop
      -- Trava: uma vez por dia por objeto; com repetir = 0, uma vez só.
      if exists (select 1 from automacoes_execucoes x where x.regra_id = r.id and x.objeto_id = o.id
                    and (x.dia = v_hoje or (x.status = 'ok' and (r.repetir_dias = 0 or x.dia > v_hoje - r.repetir_dias)))) then
        continue;
      end if;
      v_acao := null;
      v_status := 'ok';
      -- Quem recebe: o responsável (se ainda for da equipe) ou administradores e gestores.
      if o.responsavel is not null and exists (select 1 from membros mb where mb.organizacao_id = v_org and mb.user_id = o.responsavel) then
        v_dest := array[o.responsavel];
      else
        v_dest := array(select mb.user_id from membros mb where mb.organizacao_id = v_org and mb.papel in ('admin','gestor') order by mb.created_at);
      end if;
      v_titulo := left(privado.ia_preencher(coalesce(nullif(btrim(r.acao_config ->> 'titulo'), ''), privado.ia_titulo_padrao(r.gatilho)),
                                            o.nome, o.imovel, o.valor, o.data), 200);
      begin
        if r.acao = 'criar_tarefa' then
          insert into tarefas (organizacao_id, titulo, vencimento, prioridade, responsavel_id, lead_id, imovel_id, contrato_id)
          values (v_org, v_titulo, v_hoje, coalesce(r.acao_config ->> 'prioridade', 'normal'), v_dest[1], o.lead_id, o.imovel_id, o.contrato_id)
          returning id into v_acao;
          v_res := 'Tarefa criada: ' || v_titulo;
        elsif r.acao = 'avisar_responsavel' then
          insert into ia_avisos (organizacao_id, usuario_id, titulo, texto, link, regra_id)
          select v_org, u, v_titulo, 'Automação "' || r.nome || '"', privado.ia_link_objeto(o.tipo, o.id, o.lead_id, o.contrato_id), r.id
            from unnest(v_dest) u;
          v_res := format('Aviso para %s pessoa(s)', coalesce(cardinality(v_dest), 0));
        elsif r.acao = 'sugerir_mensagem' then
          v_canal := coalesce(r.acao_config ->> 'canal', 'whatsapp');
          v_destino := case when v_canal = 'email' then o.email else o.telefone end;
          if coalesce(btrim(v_destino), '') = '' then
            v_status := 'ignorado';
            v_res := 'Sem contato para este canal: nada a sugerir.';
          else
            v_texto := left(privado.ia_preencher(r.acao_config ->> 'mensagem', o.nome, o.imovel, o.valor, o.data), 4000);
            insert into ia_acoes (organizacao_id, tipo, origem, titulo, descricao, payload, referencia_tipo, referencia_id, pessoa_id, regra_id, chave, status, criada_por)
            values (v_org, 'mensagem_cliente', 'automacao', left('Mensagem para ' || coalesce(o.nome, 'cliente'), 200),
                    'Sugerida pela automação "' || r.nome || '"',
                    jsonb_strip_nulls(jsonb_build_object('canal', v_canal, 'destino', v_destino, 'nome', o.nome, 'texto', v_texto,
                                                         'lead_id', o.lead_id, 'pessoa_id', o.pessoa_id)),
                    o.tipo, o.id, o.pessoa_id, r.id, left('regra:' || r.id || ':' || o.id || ':' || v_hoje, 200), 'pendente', null)
            on conflict do nothing
            returning id into v_acao;
            v_res := 'Mensagem sugerida (aguarda aprovação)';
          end if;
        elsif r.acao = 'marcar_prioridade' then
          if o.lead_id is null then
            v_status := 'ignorado';
            v_res := 'Sem lead para marcar.';
          else
            update leads set
              prioridade = coalesce(nullif(r.acao_config ->> 'prioridade', ''), prioridade),
              etiquetas = case when nullif(btrim(r.acao_config ->> 'etiqueta'), '') is null
                                 or btrim(r.acao_config ->> 'etiqueta') = any (coalesce(etiquetas, '{}')) then etiquetas
                               else coalesce(etiquetas, '{}') || btrim(r.acao_config ->> 'etiqueta') end
             where id = o.lead_id and organizacao_id = v_org;
            v_res := 'Lead marcado';
          end if;
        end if;
      exception when others then
        v_status := 'erro';
        v_res := left(sqlerrm, 500);
        v_acao := null;
      end;
      insert into automacoes_execucoes (organizacao_id, regra_id, regra_nome, gatilho, acao, objeto_tipo, objeto_id, objeto_nome, dia, status, resultado, acao_id)
      values (v_org, r.id, r.nome, r.gatilho, r.acao, o.tipo, o.id, left(o.nome, 200), v_hoje, v_status, left(v_res, 500), v_acao)
      on conflict (regra_id, objeto_id, dia) do nothing;
      v_n := v_n + 1;
    end loop;
    update automacoes_regras set ultima_execucao_em = now() where id = r.id;
  end loop;

  -- Resposta fora do horário (imobiliária): mensagem que chegou fora do horário,
  -- ainda sem resposta, e a conta continua fora do horário agora. UMA resposta
  -- por conversa e por período fechado (chave conversa + dia de Brasília, e
  -- nenhuma outra nas últimas 12 horas): três mensagens na mesma noite não
  -- geram três "estamos fechados".
  if v_imob and c.fora_horario_ativo and c.mensagem_fora_horario <> ''
     and not privado.ia_no_horario(now(), c.horario_inicio, c.horario_fim, c.dias_uteis) then
    v_horario := to_char(c.horario_inicio, 'HH24:MI') || ' às ' || to_char(c.horario_fim, 'HH24:MI');
    for m in
      select cv.id as conversa_id, cv.canal, cv.contato, cv.nome, cv.pessoa_id, cv.lead_id
        from mkt_conversas cv
        join lateral (select mm.id, mm.direcao, mm.data from mkt_mensagens mm where mm.conversa_id = cv.id
                       order by mm.data desc, mm.criado_em desc limit 1) ult on true
       where cv.organizacao_id = v_org and cv.status <> 'resolvida' and cv.canal in ('whatsapp','sms','email')
         and ult.direcao = 'entrada' and ult.data > now() - interval '24 hours'
         and not privado.ia_no_horario(ult.data, c.horario_inicio, c.horario_fim, c.dias_uteis)
         and not exists (select 1 from ia_acoes a where a.organizacao_id = v_org and a.referencia_tipo = 'conversa' and a.referencia_id = cv.id
                            and a.chave like 'fora_horario:%' and a.created_at > now() - interval '12 hours')
       limit 100
    loop
      insert into ia_acoes (organizacao_id, tipo, origem, titulo, descricao, payload, referencia_tipo, referencia_id, pessoa_id, chave, status, resultado, criada_por)
      values (v_org, 'mensagem_cliente', 'automacao', left('Resposta fora do horário para ' || coalesce(m.nome, m.contato), 200),
              'Texto fixo aprovado pelo administrador em Configurações da IA',
              jsonb_strip_nulls(jsonb_build_object('canal', m.canal, 'destino', m.contato, 'nome', m.nome, 'conversa_id', m.conversa_id,
                                                   'lead_id', m.lead_id, 'pessoa_id', m.pessoa_id, 'fora_horario', true,
                                                   'texto', left(privado.ia_preencher(c.mensagem_fora_horario, m.nome, null, null, null, v_horario), 4000))),
              'conversa', m.conversa_id, m.pessoa_id, 'fora_horario:' || m.conversa_id || ':' || v_hoje,
              case when c.fora_horario_envio_auto then 'aprovada' else 'pendente' end,
              case when c.fora_horario_envio_auto then 'Aprovada pela regra do administrador (texto fixo): não precisa de outra aprovação. O envio é pelo botão "Abrir WhatsApp" — o sistema ainda não envia sozinho.' end,
              null)
      on conflict do nothing;
      v_fora := v_fora + 1;
    end loop;
  end if;

  return jsonb_build_object('rodou', true, 'regras', v_regras, 'disparos', v_n, 'fora_horario', v_fora);
end;
$$;
revoke execute on function public.automacoes_rodar(boolean) from public, anon;
grant execute on function public.automacoes_rodar(boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 14. Juntar cadastros repetidos (Pessoas): as ações sugeridas vão para o
--     cadastro que fica. public.juntar_pessoas é recriada A PARTIR DO CORPO
--     QUE ESTÁ NO BANCO, só acrescentando a chamada antes do
--     "delete from public.pessoas where id = b.id;" (padrão da manutenção).
-- -----------------------------------------------------------------------------
create or replace function privado.ia_juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  -- Definer (o gatilho da ação só deixa as funções do banco mexerem na pessoa),
  -- mas só dentro da organização de quem chama e com as duas pessoas nela.
  select organizacao_id into v_org from public.pessoas where id = p_manter;
  if v_org is null or privado.papel_atual(v_org) is null
     or not exists (select 1 from public.pessoas where id = p_remover and organizacao_id = v_org) then
    return;
  end if;
  update public.ia_acoes set pessoa_id = p_manter where organizacao_id = v_org and pessoa_id = p_remover;
  update public.ia_acoes set payload = jsonb_set(payload, '{pessoa_id}', to_jsonb(p_manter::text))
   where organizacao_id = v_org and payload ->> 'pessoa_id' = p_remover::text;
end;
$$;
revoke execute on function privado.ia_juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function privado.ia_juntar_pessoas(uuid, uuid) to authenticated;

do $$
declare
  v_def text;
  v_novo text;
begin
  if to_regprocedure('public.juntar_pessoas(uuid, uuid)') is null then
    raise warning 'public.juntar_pessoas não existe: as ações da IA não entram no "juntar repetidos".';
    return;
  end if;
  v_def := pg_get_functiondef('public.juntar_pessoas(uuid, uuid)'::regprocedure);
  if v_def ilike '%privado.ia_juntar_pessoas%' then
    return;
  end if;
  v_novo := regexp_replace(v_def,
    '(\n[ \t]*)(delete[ \t]+from[ \t]+public\.pessoas[ \t]+where[ \t]+id[ \t]*=[ \t]*b\.id[ \t]*;)',
    '\1perform privado.ia_juntar_pessoas(a.id, b.id);\1\2', 'i');
  if v_novo = v_def then
    raise warning 'Não achei o "delete from public.pessoas where id = b.id;" em public.juntar_pessoas: inclua à mão a chamada a privado.ia_juntar_pessoas(a.id, b.id).';
    return;
  end if;
  execute v_novo;
end $$;
