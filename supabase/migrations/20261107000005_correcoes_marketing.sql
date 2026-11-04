-- =============================================================================
-- Correções da revisão do Marketing (etapa 17), aplicadas depois de publicada.
-- Sem DROP de nada: create or replace, add column if not exists, policies
-- neutralizadas/ajustadas com ALTER POLICY dentro de DO com checagem.
--
-- 1. Configuração: tokens e integrações só para administrador/gestor (RLS);
--    o resto da equipe lê pelo mkt_config_ler() (sem tokens) e marca o relógio
--    das automações pelo mkt_automacoes_vez().
-- 2. Webhook do WhatsApp: assinatura da Meta conferida no banco (segredo do app
--    por imobiliária), corpo lido no banco, lote e ritmo limitados.
-- 3. Preferências pelo link: só para o anônimo (a página), só mexe no que veio,
--    só retira bloqueio que o próprio link criou, não grava autorização de canal
--    sem destino nem de canal que continua bloqueado, limite de alterações.
-- 4. Registro LGPD (mkt_preferencias_log / mkt_descadastros): quem está logado
--    não grava origem "link"/"whatsapp", data retroativa nem outro usuário.
-- 5. Autorização retirada na aba Comunicação bloqueia na hora a fila pendente.
-- 6. "Voltar para a fila": desfazer envio só nos primeiros 10 minutos (e tira
--    do histórico do CRM); campanha cancelada não volta para a fila.
-- 7. APIs públicas de lead não dizem se o contato já existe (nem o id).
-- 8. Juntar repetidos mantém o link de preferências do cadastro removido.
-- 9. Ids de outra organização são recusados nas tabelas do marketing.
-- 10. Preço que baixou de imóvel indisponível não vira evento; pesquisa com nota
--     baixa vence no dia de Brasília; data de mensagem no futuro não "congela" o CRM.
-- 11. Exportar CSV de e-mail confere o descadastro na hora (mkt_conferir_envios).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Configuração: tokens só para administrador/gestor
-- -----------------------------------------------------------------------------
alter table public.mkt_config add column if not exists whatsapp_app_secret text;
alter table public.mkt_mensagens add column if not exists criado_em timestamptz not null default now();
create index if not exists mkt_mensagens_criado_idx on public.mkt_mensagens (organizacao_id, direcao, criado_em);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'mkt_config_app_secret_tam' and conrelid = 'public.mkt_config'::regclass) then
    alter table public.mkt_config add constraint mkt_config_app_secret_tam
      check (whatsapp_app_secret is null or length(whatsapp_app_secret) between 16 and 200) not valid;
  end if;
  -- A tabela inteira (tokens dos webhooks, chave do Google, segredo do app) só para admin/gestor.
  if exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mkt_config' and policyname = 'mkt_config_org') then
    execute $p$alter policy mkt_config_org on public.mkt_config
      using (organizacao_id in (select privado.org_ids()) and privado.pode_ver_restrito(organizacao_id))
      with check (organizacao_id in (select privado.org_ids()) and privado.pode_ver_restrito(organizacao_id))$p$;
  end if;
end $$;

/**
 * Configuração de marketing da imobiliária de quem está logado (cria na primeira
 * vez, com os valores padrão). Tokens e chaves só para administrador/gestor; o
 * segredo do app do WhatsApp nunca sai (só se está configurado).
 */
create or replace function public.mkt_config_ler()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  cfg public.mkt_config%rowtype;
  j jsonb;
begin
  if v_org is null then raise exception 'Sem organização.'; end if;
  select * into cfg from public.mkt_config where organizacao_id = v_org;
  if not found then
    insert into public.mkt_config (organizacao_id) values (v_org) on conflict (organizacao_id) do nothing;
    select * into cfg from public.mkt_config where organizacao_id = v_org;
  end if;
  j := (to_jsonb(cfg) - 'whatsapp_app_secret') || jsonb_build_object('whatsapp_assinatura', cfg.whatsapp_app_secret is not null);
  if not privado.pode_ver_restrito(v_org) then
    j := j - 'webhook_token' - 'whatsapp_verify_token' - 'meta_verify_token' - 'google_lead_key';
  end if;
  return j;
end;
$$;
revoke execute on function public.mkt_config_ler() from public, anon;
grant execute on function public.mkt_config_ler() to authenticated;

/**
 * "Relógio" das automações: devolve true (e marca a hora) se já passou o
 * intervalo desde a última rodada — atômico, então duas abas não rodam juntas.
 */
create or replace function public.mkt_automacoes_vez(p_intervalo_min int default 10)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_ok boolean;
begin
  if v_org is null then return false; end if;
  insert into public.mkt_config (organizacao_id) values (v_org) on conflict (organizacao_id) do nothing;
  update public.mkt_config set automacoes_em = now()
   where organizacao_id = v_org
     and (automacoes_em is null
       or automacoes_em < now() - make_interval(mins => greatest(least(coalesce(p_intervalo_min, 10), 1440), 0)))
  returning true into v_ok;
  return coalesce(v_ok, false);
end;
$$;
revoke execute on function public.mkt_automacoes_vez(int) from public, anon;
grant execute on function public.mkt_automacoes_vez(int) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Webhook do WhatsApp: assinatura no banco, corpo lido no banco, limites
-- -----------------------------------------------------------------------------

/** Elementos de um array JSON (vazio se não for array). */
create or replace function privado.mkt_arr(p jsonb)
returns setof jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select e from jsonb_array_elements(case when jsonb_typeof(p) = 'array' then p else '[]'::jsonb end) e
$$;

/** Texto de um valor JSON: string não vazia (como veio) ou número; senão null. */
create or replace function privado.mkt_str(p jsonb)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select case jsonb_typeof(p)
           when 'string' then case when btrim(p #>> '{}') <> '' then p #>> '{}' end
           when 'number' then p #>> '{}'
         end
$$;

/** HMAC-SHA256 (RFC 2104) só com o sha256() do Postgres — sem extensão. */
create or replace function privado.mkt_hmac_sha256(p_msg bytea, p_chave bytea)
returns bytea
language plpgsql
immutable
strict
set search_path = pg_catalog
as $$
declare
  k bytea := p_chave;
  ipad bytea;
  opad bytea;
  i int;
begin
  if length(k) > 64 then k := sha256(k); end if;
  k := k || decode(repeat('00', 64 - length(k)), 'hex');
  ipad := k;
  opad := k;
  for i in 0..63 loop
    ipad := set_byte(ipad, i, get_byte(k, i) # 54);
    opad := set_byte(opad, i, get_byte(k, i) # 92);
  end loop;
  return sha256(opad || sha256(ipad || p_msg));
end;
$$;

/**
 * Lê o corpo do webhook da WhatsApp Cloud API (mesma regra de lerWebhookWhatsapp
 * em src/lib/dominio/marketing.ts — mude os dois juntos):
 * { mensagens: [{telefone, nome, texto, tipo, externo_id, data}], status: [{externo_id, status}] }.
 */
create or replace function privado.mkt_whatsapp_ler(p jsonb)
returns jsonb
language sql
stable
set search_path = public
as $$
  with valores as (
    select ch -> 'value' as v, eo, co
      from privado.mkt_arr(p -> 'entry') with ordinality as ent(e, eo)
     cross join lateral privado.mkt_arr(e -> 'changes') with ordinality as chg(ch, co)
     where jsonb_typeof(ch -> 'value') = 'object'
  ),
  msgs as (
    select v, m, eo, co, mo,
           regexp_replace(coalesce(privado.mkt_str(m -> 'from'), ''), '\D', '', 'g') as tel,
           coalesce(privado.mkt_str(m -> 'type'), 'texto') as tipo,
           case when privado.mkt_str(m -> 'timestamp') ~ '^\d{1,12}$' then (m ->> 'timestamp')::bigint end as ts
      from valores
     cross join lateral privado.mkt_arr(v -> 'messages') with ordinality as x(m, mo)
     where jsonb_typeof(m) = 'object'
  ),
  lidas as (
    select eo, co, mo, jsonb_build_object(
             'telefone', tel,
             'nome', (select privado.mkt_str(ct -> 'profile' -> 'name') from privado.mkt_arr(v -> 'contacts') ct
                       where privado.mkt_str(ct -> 'wa_id') = tel and privado.mkt_str(ct -> 'profile' -> 'name') is not null limit 1),
             'texto', left(t.texto, 4000),
             'tipo', t.tipo,
             'externo_id', privado.mkt_str(m -> 'id'),
             'data', case when ts > 0 then to_jsonb(to_timestamp(ts)) else to_jsonb(now()) end) as j
      from msgs
     cross join lateral (
       select case tipo
                when 'text' then 'texto'
                when 'button' then 'botao'
                when 'interactive' then 'botao'
                when 'image' then 'imagem'
                when 'video' then 'video'
                when 'document' then 'documento'
                when 'audio' then 'audio'
                when 'sticker' then 'figurinha'
                when 'location' then 'localizacao'
                when 'reaction' then 'reacao'
                else left(tipo, 30)
              end as tipo,
              case tipo
                when 'text' then privado.mkt_str(m -> 'text' -> 'body')
                when 'button' then privado.mkt_str(m -> 'button' -> 'text')
                when 'interactive' then coalesce(privado.mkt_str(m -> 'interactive' -> 'button_reply' -> 'title'),
                                                 privado.mkt_str(m -> 'interactive' -> 'list_reply' -> 'title'))
                when 'image' then coalesce(privado.mkt_str(m -> 'image' -> 'caption'), privado.mkt_str(m -> 'image' -> 'filename'))
                when 'video' then coalesce(privado.mkt_str(m -> 'video' -> 'caption'), privado.mkt_str(m -> 'video' -> 'filename'))
                when 'document' then coalesce(privado.mkt_str(m -> 'document' -> 'caption'), privado.mkt_str(m -> 'document' -> 'filename'))
                when 'audio' then coalesce(privado.mkt_str(m -> 'audio' -> 'caption'), privado.mkt_str(m -> 'audio' -> 'filename'))
                when 'sticker' then coalesce(privado.mkt_str(m -> 'sticker' -> 'caption'), privado.mkt_str(m -> 'sticker' -> 'filename'))
                when 'location' then nullif(concat_ws(' · ',
                                        privado.mkt_str(m -> 'location' -> 'name'),
                                        privado.mkt_str(m -> 'location' -> 'address'),
                                        case when coalesce(jsonb_typeof(m -> 'location' -> 'latitude'), 'null') <> 'null'
                                             then (m -> 'location' ->> 'latitude') || ',' || coalesce(m -> 'location' ->> 'longitude', 'undefined') end), '')
                when 'reaction' then privado.mkt_str(m -> 'reaction' -> 'emoji')
              end as texto
     ) t
     where length(tel) >= 8
  ),
  sts as (
    select eo, co, so, jsonb_build_object('externo_id', privado.mkt_str(s -> 'id'),
             'status', case privado.mkt_str(s -> 'status') when 'sent' then 'enviada' when 'delivered' then 'entregue'
                                                           when 'read' then 'lida' when 'failed' then 'falhou' end) as j
      from valores
     cross join lateral privado.mkt_arr(v -> 'statuses') with ordinality as y(s, so)
     where privado.mkt_str(s -> 'id') is not null
       and privado.mkt_str(s -> 'status') in ('sent','delivered','read','failed')
  )
  select jsonb_build_object(
    'mensagens', coalesce((select jsonb_agg(j order by eo, co, mo) from lidas), '[]'::jsonb),
    'status', coalesce((select jsonb_agg(j order by eo, co, so) from sts), '[]'::jsonb))
$$;

/**
 * Grava o que chegou do WhatsApp (já lido). Limites contra abuso: até 100
 * mensagens e 500 status por chamada; 3000 mensagens por hora na imobiliária
 * (contadas uma a uma); 120 por hora do mesmo telefone (o resto é ignorado);
 * até 200 leads novos por hora vindos do WhatsApp; "SAIR" repetido não duplica
 * o descadastro. Data da mensagem: entre 7 dias atrás e agora.
 */
create or replace function privado.mkt_whatsapp_processar(p_org uuid, p_cria_lead boolean, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  m jsonb;
  s jsonb;
  v_tel text;
  v_conv uuid;
  v_lead uuid;
  v_pessoa uuid;
  v_nome text;
  v_texto text;
  v_data timestamptz;
  v_sair text;
  n_msg int := 0;
  n_st int := 0;
  k int;
  v_hora int;
  v_leads_hora int;
begin
  if coalesce(jsonb_typeof(p -> 'mensagens'), 'array') <> 'array' or coalesce(jsonb_typeof(p -> 'status'), 'array') <> 'array' then
    raise exception 'Corpo inválido.';
  end if;
  if jsonb_array_length(coalesce(p -> 'mensagens', '[]'::jsonb)) > 100 or jsonb_array_length(coalesce(p -> 'status', '[]'::jsonb)) > 500 then
    raise exception 'Lote grande demais: no máximo 100 mensagens e 500 status por chamada.';
  end if;
  select count(*) into v_hora from public.mkt_mensagens
   where organizacao_id = p_org and direcao = 'entrada' and criado_em > now() - interval '1 hour';
  select count(*) into v_leads_hora from public.leads
   where organizacao_id = p_org and origem = 'whatsapp' and created_at > now() - interval '1 hour';

  for m in select * from jsonb_array_elements(coalesce(p -> 'mensagens', '[]'::jsonb)) loop
    continue when jsonb_typeof(m) <> 'object';
    v_tel := regexp_replace(coalesce(m ->> 'telefone', ''), '\D', '', 'g');
    continue when length(v_tel) < 8 or length(v_tel) > 20;
    continue when m ->> 'externo_id' is not null
      and exists (select 1 from public.mkt_mensagens x where x.organizacao_id = p_org and x.externo_id = m ->> 'externo_id');
    if v_hora + n_msg >= 3000 then
      raise exception 'Muitas mensagens agora. Tente de novo mais tarde.';
    end if;
    v_nome := nullif(left(btrim(coalesce(m ->> 'nome', '')), 120), '');
    v_texto := left(coalesce(m ->> 'texto', ''), 4000);
    begin
      v_data := (m ->> 'data')::timestamptz;
    exception when others then
      v_data := null;
    end;
    v_data := greatest(least(coalesce(v_data, now()), now()), now() - interval '7 days');
    v_conv := null;
    v_lead := null;
    v_pessoa := null;
    -- Mesma conversa mesmo se foi registrada à mão sem o 55 (compara os últimos 9 dígitos).
    select id into v_conv from public.mkt_conversas
     where organizacao_id = p_org and canal = 'whatsapp'
       and (contato = v_tel or right(regexp_replace(contato, '\D', '', 'g'), 9) = right(v_tel, 9))
     order by (contato = v_tel) desc, ultima_em desc
     limit 1;
    if v_conv is null then
      select id into v_pessoa from public.pessoas
       where organizacao_id = p_org and right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)
       limit 1;
      select id into v_lead from public.leads
       where organizacao_id = p_org and status not in ('ganho','perdido')
         and right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)
       order by created_at desc limit 1;
      if v_lead is null and v_pessoa is null and p_cria_lead and v_leads_hora < 200 then
        insert into public.leads (organizacao_id, nome, telefone, origem, funil, interesse, observacoes, ultimo_contato)
        values (p_org, coalesce(v_nome, '+' || v_tel), v_tel, 'whatsapp', 'locacao', 'locacao', nullif(v_texto, ''), now())
        returning id into v_lead;
        insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao, usuario_id)
        values (p_org, v_lead, 'entrada', 'Chegou pelo WhatsApp Business', null);
        v_leads_hora := v_leads_hora + 1;
      end if;
      insert into public.mkt_conversas (organizacao_id, canal, contato, nome, lead_id, pessoa_id)
      values (p_org, 'whatsapp', v_tel, v_nome, v_lead, v_pessoa)
      returning id into v_conv;
    else
      -- O mesmo telefone mandando sem parar: o excesso é ignorado (não trava os outros).
      continue when (select count(*) from public.mkt_mensagens x
                      where x.conversa_id = v_conv and x.direcao = 'entrada' and x.criado_em > now() - interval '1 hour') >= 120;
      update public.mkt_conversas set nome = coalesce(nome, v_nome) where id = v_conv
      returning lead_id, pessoa_id into v_lead, v_pessoa;
    end if;

    insert into public.mkt_mensagens (organizacao_id, conversa_id, direcao, texto, tipo, externo_id, status, usuario_id, data)
    values (p_org, v_conv, 'entrada', nullif(v_texto, ''), left(coalesce(m ->> 'tipo', 'texto'), 30),
            nullif(m ->> 'externo_id', ''), 'recebida', null, v_data);
    n_msg := n_msg + 1;

    -- "SAIR": não quer mais receber pelo WhatsApp (uma vez só por telefone).
    v_sair := upper(btrim(v_texto));
    if v_sair in ('SAIR','PARAR','STOP','DESCADASTRAR','DESCADASTRO') then
      if not exists (select 1 from public.mkt_descadastros d
                      where d.organizacao_id = p_org and d.canal in ('whatsapp','todos')
                        and right(regexp_replace(coalesce(d.telefone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)) then
        insert into public.mkt_descadastros (organizacao_id, pessoa_id, lead_id, telefone, canal, origem, motivo, usuario_id)
        values (p_org, v_pessoa, v_lead, v_tel, 'whatsapp', 'whatsapp', 'Respondeu "' || v_sair || '" no WhatsApp', null);
        insert into public.mkt_preferencias_log (organizacao_id, pessoa_id, lead_id, telefone, canal, concedido, origem, detalhe, usuario_id)
        values (p_org, v_pessoa, v_lead, v_tel, 'whatsapp', false, 'whatsapp', 'Respondeu "' || v_sair || '"', null);
      end if;
      update public.mkt_envios set status = 'bloqueado', motivo = 'Pediu para não receber por este canal'
       where organizacao_id = p_org and status = 'pendente' and canal = 'whatsapp'
         and right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 9) = right(v_tel, 9);
    end if;
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p -> 'status', '[]'::jsonb)) loop
    continue when jsonb_typeof(s) <> 'object' or coalesce(s ->> 'status', '') not in ('enviada','entregue','lida','falhou');
    update public.mkt_mensagens set status = s ->> 'status'
     where organizacao_id = p_org and externo_id = s ->> 'externo_id';
    get diagnostics k = row_count;
    n_st := n_st + k;
  end loop;
  return jsonb_build_object('mensagens', n_msg, 'status', n_st);
end;
$$;
revoke execute on function privado.mkt_whatsapp_processar(uuid, boolean, jsonb) from public, anon, authenticated;
revoke execute on function privado.mkt_whatsapp_ler(jsonb) from public, anon;
revoke execute on function privado.mkt_hmac_sha256(bytea, bytea) from public, anon;
revoke execute on function privado.mkt_arr(jsonb) from public, anon;
revoke execute on function privado.mkt_str(jsonb) from public, anon;

/**
 * Webhook do WhatsApp com o corpo como chegou: se a imobiliária cadastrou o
 * segredo do app (Integrações), a assinatura X-Hub-Signature-256 é conferida
 * aqui — chamar direto pela API com a chave anon e o token não pula a conferência.
 */
create or replace function public.whatsapp_receber_assinado(p_token uuid, p_corpo text, p_assinatura text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.mkt_config%rowtype;
  v_corpo jsonb;
begin
  select c.* into cfg
    from public.mkt_config c
    join public.organizacoes o on o.id = c.organizacao_id and o.modo = 'imobiliaria'
   where c.webhook_token = p_token;
  if not found then raise exception 'Webhook inválido.'; end if;
  if length(coalesce(p_corpo, '')) > 1000000 then raise exception 'Corpo grande demais.'; end if;
  if cfg.whatsapp_app_secret is not null
     and lower(btrim(coalesce(p_assinatura, ''))) is distinct from
         ('sha256=' || encode(privado.mkt_hmac_sha256(convert_to(coalesce(p_corpo, ''), 'UTF8'), convert_to(cfg.whatsapp_app_secret, 'UTF8')), 'hex')) then
    raise exception 'Assinatura inválida.';
  end if;
  begin
    v_corpo := p_corpo::jsonb;
  exception when others then
    raise exception 'Corpo inválido.';
  end;
  return privado.mkt_whatsapp_processar(cfg.organizacao_id, cfg.whatsapp_cria_lead, privado.mkt_whatsapp_ler(v_corpo));
end;
$$;
revoke execute on function public.whatsapp_receber_assinado(uuid, text, text) from public, authenticated;
grant execute on function public.whatsapp_receber_assinado(uuid, text, text) to anon;

/**
 * Versão antiga (corpo já lido pelo servidor): continua para quem ainda não
 * cadastrou o segredo do app; com o segredo cadastrado, é recusada.
 */
create or replace function public.whatsapp_receber(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.mkt_config%rowtype;
begin
  select c.* into cfg
    from public.mkt_config c
    join public.organizacoes o on o.id = c.organizacao_id and o.modo = 'imobiliaria'
   where c.webhook_token = p_token;
  if not found then raise exception 'Webhook inválido.'; end if;
  if cfg.whatsapp_app_secret is not null then
    raise exception 'Assinatura inválida: esta imobiliária confere a assinatura da Meta.';
  end if;
  return privado.mkt_whatsapp_processar(cfg.organizacao_id, cfg.whatsapp_cria_lead, p);
end;
$$;
revoke execute on function public.whatsapp_receber(uuid, jsonb) from public, authenticated;
grant execute on function public.whatsapp_receber(uuid, jsonb) to anon;

-- -----------------------------------------------------------------------------
-- 3. Preferências pelo link
-- -----------------------------------------------------------------------------

/**
 * Parte "descadastro" do bloqueio (mkt_descadastros), por pessoa, lead, e-mail
 * ou telefone (últimos 9 dígitos). p_so_externos: ignora os bloqueios que o
 * próprio link desta pessoa/lead criou (o que o link pode desfazer).
 */
create or replace function privado.mkt_descadastrado(
  p_org uuid, p_pessoa uuid, p_lead uuid, p_email text, p_tel text, p_canal text, p_finalidade text, p_so_externos boolean default false
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  with alvo as (
    select nullif(lower(btrim(coalesce(p_email, ''))), '') as email,
           right(regexp_replace(coalesce(p_tel, ''), '\D', '', 'g'), 9) as tel
  )
  select exists (
    select 1
      from public.mkt_descadastros d, alvo a
     where d.organizacao_id = p_org
       and (d.canal = 'todos' or d.canal = p_canal or (d.canal = 'ofertas' and p_finalidade = 'ofertas'))
       and ((p_pessoa is not null and d.pessoa_id = p_pessoa)
         or (p_lead is not null and d.lead_id = p_lead)
         or (a.email is not null and lower(d.email) = a.email)
         or (length(a.tel) >= 8 and right(regexp_replace(coalesce(d.telefone, ''), '\D', '', 'g'), 9) = a.tel))
       and not (p_so_externos and d.origem = 'link'
                and ((p_pessoa is not null and d.pessoa_id = p_pessoa) or (p_lead is not null and d.lead_id = p_lead)))
  )
$$;
revoke execute on function privado.mkt_descadastrado(uuid, uuid, uuid, text, text, text, text, boolean) from public, anon;
grant execute on function privado.mkt_descadastrado(uuid, uuid, uuid, text, text, text, text, boolean) to authenticated;

/** Mesmo bloqueio de antes (descadastro ou última autorização negada), agora montado com mkt_descadastrado. */
create or replace function privado.mkt_bloqueado(
  p_org uuid, p_pessoa uuid, p_lead uuid, p_email text, p_tel text, p_canal text, p_finalidade text
) returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select privado.mkt_descadastrado(p_org, p_pessoa, p_lead, p_email, p_tel, p_canal, p_finalidade, false)
      or (p_pessoa is not null and exists (
        select 1
          from (select distinct on (c.canal) c.concedido
                  from public.pessoa_consentimentos c
                 where c.pessoa_id = p_pessoa
                   and c.canal in (p_canal, case when p_finalidade = 'ofertas' then 'marketing' end)
                 order by c.canal, c.em desc) u
         where not u.concedido))
$$;

-- Link de preferências de cadastro juntado ("juntar repetidos") continua valendo.
create table if not exists public.mkt_tokens_antigos (
  token uuid primary key,
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  em timestamptz not null default now()
);
create index if not exists mkt_tokens_antigos_pessoa_idx on public.mkt_tokens_antigos (pessoa_id);
create index if not exists mkt_tokens_antigos_org_idx on public.mkt_tokens_antigos (organizacao_id);
alter table public.mkt_tokens_antigos enable row level security;
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mkt_tokens_antigos' and policyname = 'mkt_tokens_antigos_ler') then
    create policy mkt_tokens_antigos_ler on public.mkt_tokens_antigos for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
end $$;

/** Quem é o dono do link de preferências (pessoa, lead ou cadastro que foi juntado a outro). */
create or replace function privado.mkt_contato_do_token(p_token uuid,
  out org uuid, out pessoa uuid, out lead uuid, out nome text, out email text, out telefone text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  select p.organizacao_id, p.id, p.nome, p.email, p.telefone into org, pessoa, nome, email, telefone
    from public.pessoas p where p.preferencias_token = p_token;
  if org is null then
    select l.organizacao_id, l.id, l.nome, l.email, l.telefone into org, lead, nome, email, telefone
      from public.leads l where l.preferencias_token = p_token;
  end if;
  if org is null then
    select p.organizacao_id, p.id, p.nome, p.email, p.telefone into org, pessoa, nome, email, telefone
      from public.mkt_tokens_antigos t
      join public.pessoas p on p.id = t.pessoa_id and p.organizacao_id = t.organizacao_id
     where t.token = p_token;
  end if;
end;
$$;

/** Página pública de preferências: o que a pessoa recebe hoje e o que só a imobiliária libera. */
create or replace function public.info_preferencias(p_token uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  c record;
begin
  select * into c from privado.mkt_contato_do_token(p_token);
  if c.org is null then return null; end if;
  return jsonb_build_object(
    'imobiliaria', (select nome from public.organizacoes where id = c.org),
    'nome', c.nome,
    'tem_email', nullif(btrim(coalesce(c.email, '')), '') is not null,
    'tem_telefone', length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 8,
    'whatsapp', not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone, 'whatsapp', 'relacionamento'),
    'email', not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone, 'email', 'relacionamento'),
    'sms', not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone, 'sms', 'relacionamento'),
    'ofertas', not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone, '-', 'ofertas'),
    -- Bloqueado pela equipe, por "SAIR" ou por outro cadastro com o mesmo telefone/e-mail: o link não libera.
    'travado', jsonb_build_object(
      'whatsapp', privado.mkt_descadastrado(c.org, c.pessoa, c.lead, c.email, c.telefone, 'whatsapp', 'relacionamento', true),
      'email', privado.mkt_descadastrado(c.org, c.pessoa, c.lead, c.email, c.telefone, 'email', 'relacionamento', true),
      'sms', privado.mkt_descadastrado(c.org, c.pessoa, c.lead, c.email, c.telefone, 'sms', 'relacionamento', true),
      'ofertas', privado.mkt_descadastrado(c.org, c.pessoa, c.lead, c.email, c.telefone, '-', 'ofertas', true)));
end;
$$;
revoke execute on function public.info_preferencias(uuid) from public;
grant execute on function public.info_preferencias(uuid) to anon, authenticated;

/**
 * Salva as preferências pelo link (p: {whatsapp?, email?, sms?, ofertas?: boolean, nada?: boolean}).
 * - só o anônimo (a página pública) — quem está logado muda pela equipe (Marketing/aba Comunicação);
 * - só as chaves que vieram mudam ("nada" = todas desmarcadas);
 * - só retira bloqueio que o próprio link criou; bloqueio da equipe, "SAIR" ou de
 *   outro cadastro com o mesmo telefone/e-mail continua (só admin/gestor tira);
 * - autorização (aba Comunicação) e registro só do que mudou em relação ao que a
 *   pessoa viu; nunca autoriza canal sem destino nem canal que segue bloqueado;
 * - até 10 alterações por link por hora e 2000 por imobiliária por hora.
 * Devolve o que vale depois de salvar.
 */
create or replace function public.salvar_preferencias(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  canais text[] := array['whatsapp','email','sms','ofertas'];
  k text;
  v_nada boolean := coalesce(p ->> 'nada', '') in ('true','1','on');
  antes jsonb := '{}'::jsonb;
  quer jsonb := '{}'::jsonb;
  depois jsonb := '{}'::jsonb;
  novo jsonb := '{}'::jsonb;
  v_email text;
  v_tel text;
  v_destino boolean;
begin
  select * into c from privado.mkt_contato_do_token(p_token);
  if c.org is null then raise exception 'Link inválido.'; end if;
  if auth.uid() is not null and not privado.pode_ver_restrito(c.org) then
    raise exception 'O link de preferências é da própria pessoa. A equipe registra o pedido no Marketing › Preferências ou na aba Comunicação.';
  end if;
  if (select count(distinct l.em) from public.mkt_preferencias_log l
       where l.organizacao_id = c.org and l.origem = 'link' and l.em > now() - interval '1 hour'
         and ((c.pessoa is not null and l.pessoa_id = c.pessoa) or (c.lead is not null and l.lead_id = c.lead))) >= 10
     or (select count(*) from public.mkt_preferencias_log l
          where l.organizacao_id = c.org and l.origem = 'link' and l.em > now() - interval '1 hour') >= 2000 then
    raise exception 'Muitas alterações agora. Tente de novo mais tarde.';
  end if;
  v_email := nullif(lower(btrim(coalesce(c.email, ''))), '');
  v_tel := right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 9);

  foreach k in array canais loop
    antes := antes || jsonb_build_object(k, not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone,
               case when k = 'ofertas' then '-' else k end, case when k = 'ofertas' then 'ofertas' else 'relacionamento' end));
    if v_nada then
      quer := quer || jsonb_build_object(k, false);
    elsif jsonb_typeof(p -> k) = 'boolean' then
      quer := quer || jsonb_build_object(k, (p ->> k)::boolean);
    end if;
  end loop;

  -- Bloqueios que o link desta pessoa/lead criou (os outros não são tocados).
  perform set_config('mkt.interno', 'on', true);
  if v_nada then
    delete from public.mkt_descadastros d
     where d.organizacao_id = c.org and d.origem = 'link'
       and ((c.pessoa is not null and d.pessoa_id = c.pessoa) or (c.lead is not null and d.lead_id = c.lead));
    insert into public.mkt_descadastros (organizacao_id, pessoa_id, lead_id, email, telefone, canal, origem, motivo, usuario_id)
    values (c.org, c.pessoa, c.lead, c.email, c.telefone, 'todos', 'link', 'Pediu para não receber mais nada', null);
  else
    -- "Não quero nada" de antes vira um bloqueio por canal, para poder liberar só um.
    if exists (select 1 from jsonb_each(quer) where value = 'true'::jsonb)
       and exists (select 1 from public.mkt_descadastros d
                    where d.organizacao_id = c.org and d.origem = 'link' and d.canal = 'todos'
                      and ((c.pessoa is not null and d.pessoa_id = c.pessoa) or (c.lead is not null and d.lead_id = c.lead))) then
      delete from public.mkt_descadastros d
       where d.organizacao_id = c.org and d.origem = 'link' and d.canal = 'todos'
         and ((c.pessoa is not null and d.pessoa_id = c.pessoa) or (c.lead is not null and d.lead_id = c.lead));
      insert into public.mkt_descadastros (organizacao_id, pessoa_id, lead_id, email, telefone, canal, origem, motivo, usuario_id)
      select c.org, c.pessoa, c.lead, c.email, c.telefone, x, 'link', 'Pediu para não receber mais nada', null
        from unnest(canais) x
       where (quer ->> x) is distinct from 'true';
    end if;
    foreach k in array canais loop
      continue when not quer ? k;
      if (quer ->> k)::boolean then
        delete from public.mkt_descadastros d
         where d.organizacao_id = c.org and d.origem = 'link' and d.canal = k
           and ((c.pessoa is not null and d.pessoa_id = c.pessoa) or (c.lead is not null and d.lead_id = c.lead));
      elsif not exists (select 1 from public.mkt_descadastros d
                         where d.organizacao_id = c.org and d.origem = 'link' and d.canal in (k, 'todos')
                           and ((c.pessoa is not null and d.pessoa_id = c.pessoa) or (c.lead is not null and d.lead_id = c.lead))) then
        insert into public.mkt_descadastros (organizacao_id, pessoa_id, lead_id, email, telefone, canal, origem, motivo, usuario_id)
        values (c.org, c.pessoa, c.lead, c.email, c.telefone, k, 'link', 'Desmarcou na página de preferências', null);
      end if;
    end loop;
  end if;
  perform set_config('mkt.interno', '', true);

  -- Pessoa: autorização na aba Comunicação (LGPD) só do que mudou em relação ao que ela viu.
  if c.pessoa is not null then
    foreach k in array canais loop
      continue when not quer ? k or (quer ->> k)::boolean = (antes ->> k)::boolean;
      v_destino := case k
                     when 'email' then v_email is not null
                     when 'ofertas' then true
                     else length(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g')) >= 8
                   end;
      if not (quer ->> k)::boolean then
        novo := novo || jsonb_build_object(k, false);
      elsif v_destino and not privado.mkt_descadastrado(c.org, c.pessoa, c.lead, c.email, c.telefone,
                                case when k = 'ofertas' then '-' else k end,
                                case when k = 'ofertas' then 'ofertas' else 'relacionamento' end, true) then
        novo := novo || jsonb_build_object(k, true);
      end if;
    end loop;
    if novo <> '{}'::jsonb then
      update public.pessoas set
        aceita_whatsapp = coalesce((novo ->> 'whatsapp')::boolean, aceita_whatsapp),
        aceita_email = coalesce((novo ->> 'email')::boolean, aceita_email),
        aceita_sms = coalesce((novo ->> 'sms')::boolean, aceita_sms),
        aceita_marketing = coalesce((novo ->> 'ofertas')::boolean, aceita_marketing),
        consentimento_em = now(),
        consentimento_origem = 'Página de preferências (pela própria pessoa)'
      where id = c.pessoa;
      insert into public.pessoa_consentimentos (organizacao_id, pessoa_id, canal, concedido, origem, usuario_id)
      select c.org, c.pessoa, case when key = 'ofertas' then 'marketing' else key end, value::boolean,
             'Página de preferências (pela própria pessoa)', null
        from jsonb_each_text(novo);
    end if;
  end if;

  foreach k in array canais loop
    depois := depois || jsonb_build_object(k, not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone,
               case when k = 'ofertas' then '-' else k end, case when k = 'ofertas' then 'ofertas' else 'relacionamento' end));
  end loop;

  insert into public.mkt_preferencias_log (organizacao_id, pessoa_id, lead_id, email, telefone, canal, concedido, origem, detalhe, usuario_id)
  select c.org, c.pessoa, c.lead, c.email, c.telefone, x, (depois ->> x)::boolean, 'link',
         case when v_nada then 'Não quer receber mais nada' end, null
    from unnest(canais) x
   where (antes ->> x)::boolean is distinct from (depois ->> x)::boolean;

  update public.mkt_envios e set status = 'bloqueado', motivo = 'Pediu para não receber por este canal'
   where e.organizacao_id = c.org and e.status = 'pendente'
     and ((c.pessoa is not null and e.pessoa_id = c.pessoa) or (c.lead is not null and e.lead_id = c.lead)
       or (v_email is not null and lower(e.email) = v_email)
       or (length(v_tel) >= 8 and right(regexp_replace(coalesce(e.telefone, ''), '\D', '', 'g'), 9) = v_tel))
     and privado.mkt_bloqueado(e.organizacao_id, e.pessoa_id, e.lead_id, e.email, e.telefone, e.canal, e.finalidade);
  return depois;
end;
$$;
-- Só a página pública (anônimo). Logado não usa o link de outra pessoa.
revoke execute on function public.salvar_preferencias(uuid, jsonb) from public, authenticated;
grant execute on function public.salvar_preferencias(uuid, jsonb) to anon;

-- -----------------------------------------------------------------------------
-- 4. Registro LGPD: quem está logado grava como "equipe", agora, em seu nome
-- -----------------------------------------------------------------------------
create or replace function privado.mkt_registro_equipe()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Sem sessão = funções públicas (link, WhatsApp), que já gravam a origem certa.
  if auth.uid() is null or coalesce(current_setting('mkt.interno', true), '') = 'on' then
    return new;
  end if;
  new.usuario_id := auth.uid();
  new.em := now();
  new.origem := 'manual';
  return new;
end;
$$;
revoke execute on function privado.mkt_registro_equipe() from public, anon;
create or replace trigger mkt_preferencias_log_equipe_trg before insert on public.mkt_preferencias_log
  for each row execute function privado.mkt_registro_equipe();
create or replace trigger mkt_descadastros_equipe_trg before insert on public.mkt_descadastros
  for each row execute function privado.mkt_registro_equipe();

-- -----------------------------------------------------------------------------
-- 5. Autorização retirada na aba Comunicação: a fila pendente para na hora
-- -----------------------------------------------------------------------------
create or replace function privado.mkt_consentimento_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not new.concedido then
    update public.mkt_envios e set status = 'bloqueado', motivo = 'Autorização retirada (aba Comunicação)'
     where e.organizacao_id = new.organizacao_id and e.pessoa_id = new.pessoa_id and e.status = 'pendente'
       and privado.mkt_bloqueado(e.organizacao_id, e.pessoa_id, e.lead_id, e.email, e.telefone, e.canal, e.finalidade);
  end if;
  return null;
end;
$$;
revoke execute on function privado.mkt_consentimento_depois() from public, anon;
create or replace trigger pessoa_consentimentos_mkt_trg after insert on public.pessoa_consentimentos
  for each row execute function privado.mkt_consentimento_depois();

/**
 * CSV de e-mail: confere o descadastro na hora de exportar. Quem passou a
 * barrar vira "bloqueado"; devolve só os ids que podem sair no CSV.
 * security invoker: o RLS limita à própria imobiliária.
 */
create or replace function public.mkt_conferir_envios(p_ids uuid[])
returns uuid[]
language plpgsql
security invoker
set search_path = public
as $$
declare
  e record;
  v_ok uuid[] := '{}'::uuid[];
begin
  for e in
    select id, organizacao_id, pessoa_id, lead_id, email, telefone, canal, finalidade
      from public.mkt_envios
     where id = any(coalesce(p_ids, '{}'::uuid[])) and status = 'pendente'
     order by id
       for update
  loop
    if privado.mkt_bloqueado(e.organizacao_id, e.pessoa_id, e.lead_id, e.email, e.telefone, e.canal, e.finalidade) then
      update public.mkt_envios set status = 'bloqueado', motivo = 'Pediu para não receber por este canal' where id = e.id;
    else
      v_ok := v_ok || e.id;
    end if;
  end loop;
  return v_ok;
end;
$$;
revoke execute on function public.mkt_conferir_envios(uuid[]) from public, anon;
grant execute on function public.mkt_conferir_envios(uuid[]) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. Fila: desfazer envio só por 10 minutos; campanha cancelada não volta
-- -----------------------------------------------------------------------------
create or replace function privado.mkt_envio_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_bloq boolean;
begin
  if tg_op = 'INSERT' then
    if new.status = 'pendente' then
      if new.canal in ('whatsapp','sms') and length(regexp_replace(coalesce(new.telefone, ''), '\D', '', 'g')) < 8 then
        new.status := 'falhou';
        new.motivo := 'Sem telefone';
      elsif new.canal = 'email' and coalesce(new.email, '') !~ '^[^@\s]+@[^@\s]+$' then
        new.status := 'falhou';
        new.motivo := 'Sem e-mail';
      elsif privado.mkt_bloqueado(new.organizacao_id, new.pessoa_id, new.lead_id, new.email, new.telefone, new.canal, new.finalidade) then
        new.status := 'bloqueado';
        new.motivo := 'Pediu para não receber por este canal';
      end if;
    end if;
    return new;
  end if;

  -- Data e autor do envio não mudam depois de registrados.
  if old.status = 'enviado' and new.status = 'enviado' then
    new.enviado_em := old.enviado_em;
    new.enviado_por := old.enviado_por;
  end if;

  if new.status = 'pendente' and old.status is distinct from 'pendente' then
    if new.campanha_id is not null
       and exists (select 1 from public.mkt_campanhas c where c.id = new.campanha_id and c.status = 'cancelada') then
      raise exception 'Campanha cancelada: nada mais é enviado.';
    end if;
    if old.status = 'enviado' and coalesce(old.enviado_em, now()) < now() - interval '10 minutes' then
      raise exception 'Só dá para desfazer um envio nos primeiros 10 minutos: a mensagem já foi mandada e está no histórico do contato.';
    end if;
  end if;

  if new.status in ('enviado','pendente') and old.status is distinct from new.status then
    v_bloq := privado.mkt_bloqueado(new.organizacao_id, new.pessoa_id, new.lead_id, new.email, new.telefone, new.canal, new.finalidade);
    if v_bloq then
      raise exception 'Esta pessoa pediu para não receber mensagens por este canal (descadastro). Nada foi enviado.';
    end if;
  end if;
  if new.status = 'enviado' and old.status is distinct from 'enviado' then
    new.enviado_em := coalesce(new.enviado_em, now());
    new.enviado_por := coalesce(auth.uid(), new.enviado_por);
  elsif new.status = 'pendente' then
    new.enviado_em := null;
    new.enviado_por := null;
  end if;
  return new;
end;
$$;

/** Enviado entra no histórico do CRM; envio desfeito sai de lá (não duplica ao reenviar). */
create or replace function privado.mkt_envio_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campanha text;
  v_rotulo text;
  v_fim text;
  v_desc text;
begin
  v_rotulo := case new.canal when 'email' then 'E-mail enviado' when 'sms' then 'SMS enviado' else 'WhatsApp enviado' end;
  v_fim := ': ' || left(new.mensagem, 300);
  if new.status = 'enviado' and old.status is distinct from 'enviado' then
    select nome into v_campanha from public.mkt_campanhas where id = new.campanha_id and organizacao_id = new.organizacao_id;
    v_desc := v_rotulo
      || coalesce(' (campanha "' || v_campanha || '")',
           case new.origem when 'automacao' then ' (automação)' when 'pesquisa' then ' (pesquisa de satisfação)'
                           when 'recomendacao' then ' (sugestão de imóveis)' else '' end)
      || v_fim;
    if new.lead_id is not null then
      insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao)
      values (new.organizacao_id, new.lead_id, case new.canal when 'email' then 'email' when 'sms' then 'mensagem' else 'whatsapp' end, v_desc);
      update public.leads set ultimo_contato = now() where id = new.lead_id and organizacao_id = new.organizacao_id;
    end if;
    if new.pessoa_id is not null then
      insert into public.pessoa_interacoes (organizacao_id, pessoa_id, tipo, descricao)
      values (new.organizacao_id, new.pessoa_id, case new.canal when 'email' then 'email' when 'sms' then 'nota' else 'whatsapp' end, v_desc);
    end if;
    if new.pesquisa_id is not null then
      update public.mkt_pesquisas set enviada_em = coalesce(enviada_em, now())
       where id = new.pesquisa_id and organizacao_id = new.organizacao_id;
    end if;
  elsif old.status = 'enviado' and new.status is distinct from 'enviado' then
    -- Desfeito (nos primeiros minutos): o registro deste envio sai do histórico.
    if new.lead_id is not null then
      delete from public.lead_eventos where id = (
        select e.id from public.lead_eventos e
         where e.organizacao_id = new.organizacao_id and e.lead_id = new.lead_id
           and e.data >= coalesce(old.enviado_em, now()) - interval '1 minute'
           and left(e.descricao, length(v_rotulo)) = v_rotulo and right(e.descricao, length(v_fim)) = v_fim
         order by e.data desc limit 1);
    end if;
    if new.pessoa_id is not null then
      delete from public.pessoa_interacoes where id = (
        select i.id from public.pessoa_interacoes i
         where i.organizacao_id = new.organizacao_id and i.pessoa_id = new.pessoa_id
           and i.data >= coalesce(old.enviado_em, now()) - interval '1 minute'
           and left(i.descricao, length(v_rotulo)) = v_rotulo and right(i.descricao, length(v_fim)) = v_fim
         order by i.data desc limit 1);
    end if;
    if new.pesquisa_id is not null then
      update public.mkt_pesquisas q set enviada_em = null
       where q.id = new.pesquisa_id and q.organizacao_id = new.organizacao_id and q.respondida_em is null
         and not exists (select 1 from public.mkt_envios x where x.pesquisa_id = q.id and x.status = 'enviado' and x.id <> new.id);
    end if;
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 7. APIs públicas de lead: não dizem se o contato já existe
-- -----------------------------------------------------------------------------

/** Corpo de antes do receber_lead_marketing (uso interno: landing e Lead Ads). */
create or replace function privado.mkt_receber_lead(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
  v_lead uuid;
begin
  r := public.receber_lead(p_token, p);
  if coalesce((r ->> 'captacao')::boolean, false) then
    return r;
  end if;
  v_lead := (r ->> 'id')::uuid;
  update public.leads set
    utm_source = coalesce(utm_source, nullif(left(btrim(coalesce(p ->> 'utm_source', '')), 120), '')),
    utm_medium = coalesce(utm_medium, nullif(left(btrim(coalesce(p ->> 'utm_medium', '')), 120), '')),
    utm_campaign = coalesce(utm_campaign, nullif(left(btrim(coalesce(p ->> 'utm_campaign', '')), 200), '')),
    utm_content = coalesce(utm_content, nullif(left(btrim(coalesce(p ->> 'utm_content', '')), 200), '')),
    utm_term = coalesce(utm_term, nullif(left(btrim(coalesce(p ->> 'utm_term', '')), 200), '')),
    gclid = coalesce(gclid, nullif(left(btrim(coalesce(p ->> 'gclid', '')), 300), '')),
    fbclid = coalesce(fbclid, nullif(left(btrim(coalesce(p ->> 'fbclid', '')), 300), '')),
    campanha_id = coalesce(campanha_id, (
      select c.id from public.mkt_campanhas c
       where c.organizacao_id = leads.organizacao_id and c.utm_campaign is not null
         and lower(c.utm_campaign) = lower(btrim(coalesce(p ->> 'utm_campaign', '')))
       order by c.created_at desc limit 1))
  where id = v_lead;
  return r;
end;
$$;
revoke execute on function privado.mkt_receber_lead(uuid, jsonb) from public, anon, authenticated;

/** Lead com origem da conversão (formulário /l, API de leads). Resposta igual para contato novo ou repetido. */
create or replace function public.receber_lead_marketing(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  perform privado.mkt_receber_lead(p_token, p);
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.receber_lead_marketing(uuid, jsonb) from public;
grant execute on function public.receber_lead_marketing(uuid, jsonb) to anon, authenticated;

/** Formulário da landing page: vira lead (ou captação) com UTM e a página de origem. */
create or replace function public.receber_lead_landing(p_slug text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lp public.mkt_landing_pages%rowtype;
  o public.organizacoes%rowtype;
  v_cod text;
  r jsonb;
begin
  select * into lp from public.mkt_landing_pages where slug = lower(btrim(coalesce(p_slug, ''))) and publicada;
  if not found then raise exception 'Página não encontrada.'; end if;
  select * into o from public.organizacoes where id = lp.organizacao_id and modo = 'imobiliaria';
  if not found then raise exception 'Página não encontrada.'; end if;
  select codigo into v_cod from public.imoveis where id = lp.imovel_id and organizacao_id = o.id;
  r := privado.mkt_receber_lead(o.leads_token, p || jsonb_strip_nulls(jsonb_build_object(
         'funil', lp.funil,
         'imovel', v_cod,
         'utm_campaign', coalesce(nullif(p ->> 'utm_campaign', ''), lp.utm_campaign))));
  if not coalesce((r ->> 'captacao')::boolean, false) then
    update public.leads set landing_id = coalesce(landing_id, lp.id) where id = (r ->> 'id')::uuid;
  end if;
  update public.mkt_landing_pages set leads = leads + 1 where id = lp.id;
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.receber_lead_landing(text, jsonb) from public;
grant execute on function public.receber_lead_landing(text, jsonb) to anon, authenticated;

/** Dados públicos da landing page (só publicada e de imobiliária). O imóvel tem de ser da mesma imobiliária. */
create or replace function public.info_landing(p_slug text, p_contar boolean default false)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  lp public.mkt_landing_pages%rowtype;
  o public.organizacoes%rowtype;
  cfg public.mkt_config%rowtype;
  im jsonb;
begin
  select * into lp from public.mkt_landing_pages where slug = lower(btrim(coalesce(p_slug, ''))) and publicada;
  if not found then return null; end if;
  select * into o from public.organizacoes where id = lp.organizacao_id and modo = 'imobiliaria';
  if not found then return null; end if;
  select * into cfg from public.mkt_config where organizacao_id = o.id;
  if p_contar then
    update public.mkt_landing_pages set visitas = visitas + 1 where id = lp.id;
  end if;
  if lp.imovel_id is not null then
    select jsonb_build_object('codigo', i.codigo, 'tipo', i.tipo, 'titulo', i.titulo, 'descricao', i.descricao,
             'bairro', i.bairro, 'cidade', i.cidade, 'uf', i.uf, 'quartos', i.quartos, 'suites', i.suites,
             'banheiros', i.banheiros, 'vagas', i.vagas, 'area_util', i.area_util, 'finalidades', i.finalidades,
             'valor_aluguel', i.valor_aluguel, 'valor_venda', i.valor_venda, 'valor_condominio', i.valor_condominio,
             'valor_iptu', i.valor_iptu, 'comodidades', i.comodidades, 'status', i.status)
      into im
      from public.imoveis i where i.id = lp.imovel_id and i.organizacao_id = lp.organizacao_id;
  end if;
  return jsonb_build_object(
    'titulo', lp.titulo, 'subtitulo', lp.subtitulo, 'texto', lp.texto, 'chamada', lp.chamada, 'funil', lp.funil,
    'imagem_url', lp.imagem_url, 'imobiliaria', o.nome, 'telefone', o.telefone, 'creci', o.creci,
    'whatsapp', cfg.whatsapp_numero, 'meta_pixel_id', cfg.meta_pixel_id, 'google_tag_id', cfg.google_tag_id,
    'google_conversao_label', cfg.google_conversao_label, 'imovel', im);
end;
$$;
revoke execute on function public.info_landing(text, boolean) from public;
grant execute on function public.info_landing(text, boolean) to anon, authenticated;

/**
 * Leads de anúncios, já normalizados pelo servidor (mesma entrada de antes).
 * Resposta não diz se o contato já existia.
 */
create or replace function public.lead_ads_receber(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.mkt_config%rowtype;
  o public.organizacoes%rowtype;
  v_plat text := case when p ->> 'plataforma' in ('google','meta') then p ->> 'plataforma' else 'outro' end;
  r jsonb;
begin
  select * into cfg from public.mkt_config where webhook_token = p_token;
  if not found then raise exception 'Webhook inválido.'; end if;
  select * into o from public.organizacoes where id = cfg.organizacao_id and modo = 'imobiliaria';
  if not found then raise exception 'Webhook inválido.'; end if;
  if v_plat = 'google' and coalesce(p ->> 'chave', '') <> cfg.google_lead_key then
    raise exception 'Chave do Google Ads não confere.';
  end if;
  if (select count(*) from public.mkt_lead_ads where organizacao_id = o.id and recebido_em > now() - interval '1 hour') > 500 then
    raise exception 'Muitos leads agora. Tente de novo mais tarde.';
  end if;
  if coalesce((p ->> 'teste')::boolean, false) then
    insert into public.mkt_lead_ads (organizacao_id, plataforma, externo_id, formulario_id, campanha_externa, payload, status)
    values (o.id, v_plat, p ->> 'externo_id', p ->> 'formulario_id', p ->> 'campanha', p -> 'bruto', 'teste');
    return jsonb_build_object('teste', true);
  end if;
  if coalesce(btrim(p -> 'lead' ->> 'nome'), '') <> ''
     and (coalesce(btrim(p -> 'lead' ->> 'telefone'), '') <> '' or coalesce(btrim(p -> 'lead' ->> 'email'), '') <> '') then
    r := privado.mkt_receber_lead(o.leads_token, p -> 'lead');
    insert into public.mkt_lead_ads (organizacao_id, plataforma, externo_id, formulario_id, campanha_externa, payload, lead_id, status)
    values (o.id, v_plat, p ->> 'externo_id', p ->> 'formulario_id', p ->> 'campanha', p -> 'bruto',
            case when coalesce((r ->> 'captacao')::boolean, false) then null else (r ->> 'id')::uuid end, 'recebido');
    return jsonb_build_object('ok', true);
  end if;
  insert into public.mkt_lead_ads (organizacao_id, plataforma, externo_id, formulario_id, campanha_externa, payload, status)
  values (o.id, v_plat, p ->> 'externo_id', p ->> 'formulario_id', p ->> 'campanha', p -> 'bruto', 'sem_dados');
  return jsonb_build_object('pendente', true);
end;
$$;
revoke execute on function public.lead_ads_receber(uuid, jsonb) from public;
grant execute on function public.lead_ads_receber(uuid, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Juntar repetidos: o link de preferências do cadastro que sai continua valendo
-- -----------------------------------------------------------------------------
create or replace function privado.mkt_juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizacao_id into v_org from public.pessoas where id = p_manter;
  if v_org is null
     or (auth.uid() is not null and v_org not in (select privado.org_ids()))
     or not exists (select 1 from public.pessoas where id = p_remover and organizacao_id = v_org) then
    raise exception 'Cadastro não encontrado.';
  end if;
  perform set_config('mkt.interno', 'on', true);
  update public.mkt_envios set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.mkt_descadastros set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.mkt_pesquisas set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.mkt_conversas set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.mkt_preferencias_log set pessoa_id = p_manter where pessoa_id = p_remover;
  -- Mensagens já enviadas levam /preferencias/<token do que sai>: o link passa a ser do que fica.
  update public.mkt_tokens_antigos set pessoa_id = p_manter where pessoa_id = p_remover;
  insert into public.mkt_tokens_antigos (token, organizacao_id, pessoa_id)
  select preferencias_token, v_org, p_manter from public.pessoas where id = p_remover
  on conflict (token) do update set pessoa_id = excluded.pessoa_id;
  perform set_config('mkt.interno', '', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 9. Ids de outra organização são recusados nas tabelas do marketing
-- -----------------------------------------------------------------------------
create or replace function privado.mkt_mesma_org()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  n jsonb := to_jsonb(new);
  o jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) else '{}'::jsonb end;
  par text[];
  v text;
  ok boolean;
begin
  foreach par slice 1 in array array[
    ['pessoa_id', 'pessoas', 'id'],
    ['lead_id', 'leads', 'id'],
    ['imovel_id', 'imoveis', 'id'],
    ['campanha_id', 'mkt_campanhas', 'id'],
    ['pesquisa_id', 'mkt_pesquisas', 'id'],
    ['conversa_id', 'mkt_conversas', 'id'],
    ['modelo_id', 'mkt_modelos', 'id'],
    ['automacao_id', 'mkt_automacoes', 'id'],
    ['envio_id', 'mkt_envios', 'id'],
    ['venda_id', 'vendas', 'id'],
    ['contrato_id', 'contratos', 'id'],
    ['tarefa_id', 'tarefas', 'id'],
    ['responsavel_id', 'membros', 'user_id']]
  loop
    continue when not (n ? par[1]);
    v := n ->> par[1];
    continue when v is null;
    continue when (o ->> par[1]) is not distinct from v and (o ->> 'organizacao_id') is not distinct from (n ->> 'organizacao_id');
    execute format('select exists (select 1 from public.%I where %I = $1::uuid and organizacao_id = $2)', par[2], par[3])
      into ok using v, new.organizacao_id;
    if not ok then
      raise exception 'Registro de outra organização (%).', par[1];
    end if;
  end loop;
  return new;
end;
$$;
revoke execute on function privado.mkt_mesma_org() from public, anon;

do $$
declare t text;
begin
  foreach t in array array['mkt_envios','mkt_conversas','mkt_mensagens','mkt_pesquisas','mkt_campanhas','mkt_landing_pages',
                           'mkt_descadastros','mkt_preferencias_log','mkt_automacoes','mkt_execucoes','mkt_lead_ads','mkt_eventos'] loop
    execute format('create or replace trigger %I before insert or update on public.%I for each row execute function privado.mkt_mesma_org()',
                   t || '_mesma_org_trg', t);
  end loop;
end $$;

/** Mensagem nova atualiza a conversa e o histórico do CRM (data no futuro conta como agora). */
create or replace function privado.mkt_mensagem_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.mkt_conversas%rowtype;
  v_rotulo text;
  v_desc text;
  v_data timestamptz := least(new.data, now());
begin
  update public.mkt_conversas set
    ultima_mensagem = left(coalesce(new.texto, '[' || new.tipo || ']'), 300),
    ultima_em = greatest(ultima_em, v_data),
    nao_lidas = case when new.direcao = 'entrada' then nao_lidas + 1 else 0 end,
    status = case when new.direcao = 'entrada' then 'aberta' when status = 'resolvida' then status else 'aguardando' end
  where id = new.conversa_id and organizacao_id = new.organizacao_id
  returning * into c;
  if c.id is null then
    return null;
  end if;
  v_rotulo := case c.canal when 'email' then 'E-mail' when 'sms' then 'SMS' when 'whatsapp' then 'WhatsApp' else 'Mensagem' end;
  v_desc := v_rotulo || case when new.direcao = 'entrada' then ' recebido: ' else ' enviado: ' end
    || left(coalesce(new.texto, '[' || new.tipo || ']'), 300);
  if c.lead_id is not null then
    insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao, data, usuario_id)
    values (new.organizacao_id, c.lead_id, case c.canal when 'email' then 'email' when 'whatsapp' then 'whatsapp' else 'mensagem' end,
            v_desc, v_data, new.usuario_id);
    update public.leads set ultimo_contato = greatest(coalesce(ultimo_contato, v_data), v_data)
     where id = c.lead_id and organizacao_id = new.organizacao_id;
  end if;
  if c.pessoa_id is not null then
    insert into public.pessoa_interacoes (organizacao_id, pessoa_id, tipo, descricao, data, usuario_id)
    values (new.organizacao_id, c.pessoa_id, case c.canal when 'email' then 'email' when 'whatsapp' then 'whatsapp' else 'nota' end,
            v_desc, v_data, new.usuario_id);
  end if;
  return null;
end;
$$;

-- -----------------------------------------------------------------------------
-- 10. Eventos de imóvel e pesquisa
-- -----------------------------------------------------------------------------

/** Preço que baixou só vira evento se o imóvel está disponível (alugado não avisa ninguém). */
create or replace function privado.mkt_evento_imovel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.organizacoes o where o.id = new.organizacao_id and o.modo = 'imobiliaria') then
    return null;
  end if;
  if tg_table_name = 'imoveis' then
    if new.status = 'disponivel' and (tg_op = 'INSERT' or old.status is distinct from 'disponivel')
       and not exists (select 1 from public.mkt_eventos e where e.imovel_id = new.id and e.tipo = 'novo_imovel' and e.processado_em is null) then
      insert into public.mkt_eventos (organizacao_id, tipo, imovel_id) values (new.organizacao_id, 'novo_imovel', new.id);
    end if;
  elsif new.campo in ('aluguel','venda') and coalesce(new.valor_anterior, 0) > 0
        and coalesce(new.valor_novo, 0) > 0 and new.valor_novo < new.valor_anterior
        and exists (select 1 from public.imoveis i where i.id = new.imovel_id and i.status = 'disponivel') then
    insert into public.mkt_eventos (organizacao_id, tipo, imovel_id, campo, valor_anterior, valor_novo)
    values (new.organizacao_id, 'reducao_preco', new.imovel_id, new.campo, new.valor_anterior, new.valor_novo);
  end if;
  return null;
end;
$$;

/** Resposta da pesquisa (uma vez só). Nota até 6 vira tarefa de retorno para HOJE no horário de Brasília. */
create or replace function public.responder_pesquisa(p_token uuid, p_nota int, p_comentario text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.mkt_pesquisas%rowtype;
  v_coment text := nullif(left(btrim(coalesce(p_comentario, '')), 2000), '');
  v_desc text;
begin
  select * into q from public.mkt_pesquisas where token = p_token for update;
  if not found then raise exception 'Pesquisa não encontrada.'; end if;
  if q.respondida_em is not null then raise exception 'Esta pesquisa já foi respondida. Obrigado!'; end if;
  if p_nota is null or p_nota < 0 or p_nota > 10 then raise exception 'Escolha uma nota de 0 a 10.'; end if;
  update public.mkt_pesquisas set nota = p_nota, comentario = v_coment, respondida_em = now() where id = q.id;
  v_desc := 'Pesquisa de satisfação: nota ' || p_nota || coalesce(' — "' || left(v_coment, 300) || '"', '');
  if q.pessoa_id is not null then
    insert into public.pessoa_interacoes (organizacao_id, pessoa_id, tipo, descricao, usuario_id)
    values (q.organizacao_id, q.pessoa_id, 'nota', v_desc, null);
  end if;
  if q.lead_id is not null then
    insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao, usuario_id)
    values (q.organizacao_id, q.lead_id, 'nota', v_desc, null);
  end if;
  if p_nota <= 6 then
    insert into public.tarefas (organizacao_id, titulo, vencimento, prioridade, lead_id, imovel_id, contrato_id, responsavel_id)
    values (q.organizacao_id, left('Retornar para ' || coalesce(q.nome, 'cliente') || ' — nota ' || p_nota || ' na pesquisa de satisfação', 200),
            (now() at time zone 'America/Sao_Paulo')::date, 'alta', q.lead_id, q.imovel_id, q.contrato_id, null);
  end if;
end;
$$;
revoke execute on function public.responder_pesquisa(uuid, int, text) from public;
grant execute on function public.responder_pesquisa(uuid, int, text) to anon, authenticated;
