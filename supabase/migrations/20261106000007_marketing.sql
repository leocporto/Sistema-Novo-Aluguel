-- =============================================================================
-- Marketing e comunicação (só modo imobiliária):
-- - modelos de mensagem (WhatsApp/e-mail/SMS) com variáveis {{...}};
-- - campanhas segmentadas com agendamento e FILA DE ENVIO assistida (wa.me,
--   mailto, CSV) — pronta para envio automático quando houver credencial;
-- - caixa de entrada compartilhada (conversas e mensagens do WhatsApp Business,
--   com responsável e status) + webhook no formato da WhatsApp Cloud API;
-- - automações: novo imóvel, redução de preço, pós-venda e pós-locação;
-- - landing pages públicas (/lp/[slug]) com UTM, gclid e fbclid no lead;
-- - Lead Ads (Google: formulário com chave; Meta: aviso guardado até haver token);
-- - pesquisa de satisfação (NPS) por link público com token;
-- - descadastro e preferências de comunicação (link público por pessoa/lead),
--   respeitados SEMPRE pela fila (gatilho no banco).
-- Sem DROP de nada: create if not exists / create or replace / policies em DO.
-- =============================================================================

-- Configuração por imobiliária -------------------------------------------------
create table if not exists public.mkt_config (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  webhook_token uuid not null default gen_random_uuid(),
  whatsapp_numero text,
  whatsapp_phone_number_id text,
  whatsapp_waba_id text,
  whatsapp_verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  whatsapp_cria_lead boolean not null default true,
  meta_pixel_id text,
  meta_verify_token text not null default replace(gen_random_uuid()::text, '-', ''),
  google_tag_id text,
  google_conversao_label text,
  google_lead_key text not null default replace(gen_random_uuid()::text, '-', ''),
  email_remetente text,
  assinatura text,
  pesquisa_pergunta text,
  automacoes_em timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists mkt_config_unica_idx on public.mkt_config (organizacao_id);
create unique index if not exists mkt_config_token_idx on public.mkt_config (webhook_token);

-- Modelos de mensagem ----------------------------------------------------------
create table if not exists public.mkt_modelos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  canal text not null default 'whatsapp' check (canal in ('whatsapp','email','sms')),
  uso text not null default 'geral'
    check (uso in ('geral','novo_imovel','reducao_preco','reativacao','recomendacao','pos_venda','pos_locacao','pesquisa')),
  assunto text,
  corpo text not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);

-- Campanhas (público por filtros, canal, agendamento) -------------------------
-- status guardado: rascunho → fila (fila montada) | cancelada. "Agendada",
-- "enviando" e "concluída" são calculadas pela fila (src/lib/dominio/marketing.ts).
create table if not exists public.mkt_campanhas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  tipo text not null default 'manual'
    check (tipo in ('manual','reativacao','novo_imovel','reducao_preco','recomendacao','pos_venda','pos_locacao','pesquisa')),
  canal text not null default 'whatsapp' check (canal in ('whatsapp','email','sms')),
  modelo_id uuid references public.mkt_modelos(id) on delete set null,
  assunto text,
  mensagem text not null default '',
  filtros jsonb not null default '{}'::jsonb,
  imovel_id uuid references public.imoveis(id) on delete set null,
  so_autorizados boolean not null default false,
  agendada_para timestamptz,
  status text not null default 'rascunho' check (status in ('rascunho','fila','cancelada')),
  utm_campaign text,
  link text,
  fila_em timestamptz,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);

-- Automações (regras) ----------------------------------------------------------
create table if not exists public.mkt_automacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  gatilho text not null check (gatilho in ('novo_imovel','reducao_preco','pos_venda','pos_locacao')),
  acao text not null default 'mensagem' check (acao in ('mensagem','tarefa')),
  canal text not null default 'whatsapp' check (canal in ('whatsapp','email','sms')),
  modelo_id uuid references public.mkt_modelos(id) on delete set null,
  mensagem text,
  dias int not null default 0 check (dias between 0 and 3650),
  reducao_min_pct numeric(6,2) not null default 0 check (reducao_min_pct between 0 and 100),
  publico text not null default 'ambos' check (publico in ('leads','pessoas','ambos')),
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

-- Pesquisa de satisfação (NPS 0 a 10) -----------------------------------------
create table if not exists public.mkt_pesquisas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  token uuid not null default gen_random_uuid(),
  contexto text not null default 'geral' check (contexto in ('pos_venda','pos_locacao','atendimento','geral')),
  pessoa_id uuid references public.pessoas(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  venda_id uuid references public.vendas(id) on delete set null,
  contrato_id uuid references public.contratos(id) on delete set null,
  imovel_id uuid references public.imoveis(id) on delete set null,
  nome text,
  telefone text,
  email text,
  pergunta text,
  enviada_em timestamptz,
  respondida_em timestamptz,
  nota int check (nota is null or nota between 0 and 10),
  comentario text,
  created_at timestamptz not null default now()
);
create unique index if not exists mkt_pesquisas_token_idx on public.mkt_pesquisas (token);

-- Fila de envio (um registro por destinatário) --------------------------------
create table if not exists public.mkt_envios (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  chave text not null default gen_random_uuid()::text,
  campanha_id uuid references public.mkt_campanhas(id) on delete cascade,
  automacao_id uuid references public.mkt_automacoes(id) on delete set null,
  pesquisa_id uuid references public.mkt_pesquisas(id) on delete set null,
  origem text not null default 'manual' check (origem in ('campanha','automacao','recomendacao','pesquisa','manual')),
  finalidade text not null default 'ofertas' check (finalidade in ('ofertas','relacionamento')),
  canal text not null default 'whatsapp' check (canal in ('whatsapp','email','sms')),
  pessoa_id uuid references public.pessoas(id) on delete cascade,
  lead_id uuid references public.leads(id) on delete cascade,
  imovel_id uuid references public.imoveis(id) on delete set null,
  nome text,
  telefone text,
  email text,
  assunto text,
  mensagem text not null,
  status text not null default 'pendente' check (status in ('pendente','enviado','falhou','cancelado','bloqueado')),
  motivo text,
  agendado_para timestamptz not null default now(),
  enviado_em timestamptz,
  enviado_por uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists mkt_envios_chave_idx on public.mkt_envios (organizacao_id, chave);
create index if not exists mkt_envios_fila_idx on public.mkt_envios (organizacao_id, status, agendado_para);
create index if not exists mkt_envios_campanha_idx on public.mkt_envios (campanha_id);

-- Descadastros (bloqueios ativos) e registro de preferências (não se apaga) ----
create table if not exists public.mkt_descadastros (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  email text,
  telefone text,
  canal text not null default 'todos' check (canal in ('todos','whatsapp','email','sms','ofertas')),
  origem text not null default 'manual' check (origem in ('manual','link','whatsapp','importacao')),
  motivo text,
  em timestamptz not null default now(),
  usuario_id uuid default auth.uid()
);
create index if not exists mkt_descadastros_pessoa_idx on public.mkt_descadastros (pessoa_id);
create index if not exists mkt_descadastros_lead_idx on public.mkt_descadastros (lead_id);

create table if not exists public.mkt_preferencias_log (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  email text,
  telefone text,
  canal text not null,
  concedido boolean not null,
  origem text not null default 'manual',
  detalhe text,
  em timestamptz not null default now(),
  usuario_id uuid default auth.uid()
);
create index if not exists mkt_preferencias_log_idx on public.mkt_preferencias_log (organizacao_id, em desc);

-- Caixa de entrada compartilhada ----------------------------------------------
create table if not exists public.mkt_conversas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  canal text not null default 'whatsapp' check (canal in ('whatsapp','email','sms','outro')),
  contato text not null,
  nome text,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  responsavel_id uuid,
  status text not null default 'aberta' check (status in ('aberta','aguardando','resolvida')),
  nao_lidas int not null default 0,
  ultima_mensagem text,
  ultima_em timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create unique index if not exists mkt_conversas_contato_idx on public.mkt_conversas (organizacao_id, canal, contato);
create index if not exists mkt_conversas_lista_idx on public.mkt_conversas (organizacao_id, status, ultima_em desc);

create table if not exists public.mkt_mensagens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  conversa_id uuid not null references public.mkt_conversas(id) on delete cascade,
  direcao text not null check (direcao in ('entrada','saida')),
  texto text,
  tipo text not null default 'texto',
  externo_id text,
  status text not null default 'registrada' check (status in ('recebida','registrada','enviada','entregue','lida','falhou')),
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index if not exists mkt_mensagens_conversa_idx on public.mkt_mensagens (conversa_id, data);
create unique index if not exists mkt_mensagens_externo_idx on public.mkt_mensagens (organizacao_id, externo_id) where externo_id is not null;

-- Landing pages ----------------------------------------------------------------
create table if not exists public.mkt_landing_pages (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  slug text not null check (slug ~ '^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$'),
  titulo text not null,
  subtitulo text,
  texto text,
  chamada text not null default 'Quero ser atendido',
  funil text not null default 'locacao' check (funil in ('locacao','venda','captacao')),
  imovel_id uuid references public.imoveis(id) on delete set null,
  imagem_url text check (imagem_url is null or imagem_url ~ '^https://'),
  utm_campaign text,
  publicada boolean not null default true,
  visitas int not null default 0,
  leads int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists mkt_landing_slug_idx on public.mkt_landing_pages (slug);

-- Eventos para as automações (gravados por gatilho) e execuções ---------------
create table if not exists public.mkt_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  tipo text not null check (tipo in ('novo_imovel','reducao_preco')),
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  campo text,
  valor_anterior numeric(14,2),
  valor_novo numeric(14,2),
  criado_em timestamptz not null default now(),
  processado_em timestamptz,
  resultado text
);
create index if not exists mkt_eventos_pendentes_idx on public.mkt_eventos (organizacao_id, processado_em, criado_em);

create table if not exists public.mkt_execucoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  automacao_id uuid not null references public.mkt_automacoes(id) on delete cascade,
  chave text not null,
  envio_id uuid references public.mkt_envios(id) on delete set null,
  tarefa_id uuid references public.tarefas(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists mkt_execucoes_chave_idx on public.mkt_execucoes (automacao_id, chave);

-- Leads vindos de anúncios (Google Lead Form / Meta Lead Ads) -----------------
create table if not exists public.mkt_lead_ads (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  plataforma text not null default 'outro' check (plataforma in ('google','meta','outro')),
  externo_id text,
  formulario_id text,
  campanha_externa text,
  payload jsonb,
  lead_id uuid references public.leads(id) on delete set null,
  status text not null default 'recebido' check (status in ('recebido','sem_dados','teste','erro')),
  recebido_em timestamptz not null default now()
);
create index if not exists mkt_lead_ads_idx on public.mkt_lead_ads (organizacao_id, recebido_em desc);

-- Origem das conversões no lead e link de preferências ------------------------
alter table public.leads
  add column if not exists utm_source text,
  add column if not exists utm_medium text,
  add column if not exists utm_campaign text,
  add column if not exists utm_content text,
  add column if not exists utm_term text,
  add column if not exists gclid text,
  add column if not exists fbclid text,
  add column if not exists landing_id uuid references public.mkt_landing_pages(id) on delete set null,
  add column if not exists campanha_id uuid references public.mkt_campanhas(id) on delete set null,
  add column if not exists preferencias_token uuid not null default gen_random_uuid();
alter table public.pessoas add column if not exists preferencias_token uuid not null default gen_random_uuid();
create unique index if not exists leads_preferencias_token_idx on public.leads (preferencias_token);
create unique index if not exists pessoas_preferencias_token_idx on public.pessoas (preferencias_token);
create index if not exists leads_utm_idx on public.leads (organizacao_id, utm_source, utm_campaign);

-- RLS por organização ----------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['mkt_config','mkt_modelos','mkt_campanhas','mkt_automacoes','mkt_pesquisas','mkt_envios',
                           'mkt_descadastros','mkt_conversas','mkt_mensagens','mkt_landing_pages','mkt_eventos',
                           'mkt_execucoes','mkt_lead_ads'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_org') then
      execute format($p$create policy %I on public.%I for all to authenticated
        using (organizacao_id in (select privado.org_ids()))
        with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
    end if;
  end loop;
end $$;

-- Registro de preferências: só leitura e inclusão (prova para a LGPD).
alter table public.mkt_preferencias_log enable row level security;
create index if not exists mkt_preferencias_log_org_idx on public.mkt_preferencias_log (organizacao_id);
do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mkt_preferencias_log' and policyname = 'mkt_preferencias_log_ler') then
    create policy mkt_preferencias_log_ler on public.mkt_preferencias_log for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'mkt_preferencias_log' and policyname = 'mkt_preferencias_log_gravar') then
    create policy mkt_preferencias_log_gravar on public.mkt_preferencias_log for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()));
  end if;
end $$;

-- =============================================================================
-- Regras no banco
-- =============================================================================

/**
 * O contato pediu para não receber por este canal? Vale descadastro por
 * pessoa, lead, e-mail ou telefone (últimos 9 dígitos) e a última autorização
 * da pessoa na aba Comunicação (pessoa_consentimentos) negada.
 * canal 'ofertas' bloqueia só o que é oferta (campanhas, novidades), não o
 * relacionamento (pesquisa, pós-venda, pós-locação).
 */
create or replace function privado.mkt_bloqueado(
  p_org uuid, p_pessoa uuid, p_lead uuid, p_email text, p_tel text, p_canal text, p_finalidade text
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
  ) or (p_pessoa is not null and exists (
    select 1
      from (select distinct on (c.canal) c.concedido
              from public.pessoa_consentimentos c
             where c.pessoa_id = p_pessoa
               and c.canal in (p_canal, case when p_finalidade = 'ofertas' then 'marketing' end)
             order by c.canal, c.em desc) u
     where not u.concedido))
$$;
revoke execute on function privado.mkt_bloqueado(uuid, uuid, uuid, text, text, text, text) from public, anon;
grant execute on function privado.mkt_bloqueado(uuid, uuid, uuid, text, text, text, text) to authenticated;

/** Fila: sem destino vira "falhou", descadastrado vira "bloqueado" e nunca é marcado como enviado. */
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
create or replace trigger mkt_envios_antes_trg before insert or update on public.mkt_envios
  for each row execute function privado.mkt_envio_antes();

/** Mensagem marcada como enviada entra no histórico do lead/da pessoa (CRM). */
create or replace function privado.mkt_envio_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_campanha text;
  v_desc text;
begin
  if new.status = 'enviado' and old.status is distinct from 'enviado' then
    select nome into v_campanha from public.mkt_campanhas where id = new.campanha_id;
    v_desc := case new.canal when 'email' then 'E-mail enviado' when 'sms' then 'SMS enviado' else 'WhatsApp enviado' end
      || coalesce(' (campanha "' || v_campanha || '")',
           case new.origem when 'automacao' then ' (automação)' when 'pesquisa' then ' (pesquisa de satisfação)'
                           when 'recomendacao' then ' (sugestão de imóveis)' else '' end)
      || ': ' || left(new.mensagem, 300);
    if new.lead_id is not null then
      insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao)
      values (new.organizacao_id, new.lead_id, case new.canal when 'email' then 'email' when 'sms' then 'mensagem' else 'whatsapp' end, v_desc);
      update public.leads set ultimo_contato = now() where id = new.lead_id;
    end if;
    if new.pessoa_id is not null then
      insert into public.pessoa_interacoes (organizacao_id, pessoa_id, tipo, descricao)
      values (new.organizacao_id, new.pessoa_id, case new.canal when 'email' then 'email' when 'sms' then 'nota' else 'whatsapp' end, v_desc);
    end if;
    if new.pesquisa_id is not null then
      update public.mkt_pesquisas set enviada_em = coalesce(enviada_em, now()) where id = new.pesquisa_id;
    end if;
  end if;
  return null;
end;
$$;
create or replace trigger mkt_envios_depois_trg after update of status on public.mkt_envios
  for each row execute function privado.mkt_envio_depois();

/** Mensagem nova atualiza a conversa (última mensagem, não lidas, status) e o histórico do CRM. */
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
begin
  update public.mkt_conversas set
    ultima_mensagem = left(coalesce(new.texto, '[' || new.tipo || ']'), 300),
    ultima_em = greatest(ultima_em, new.data),
    nao_lidas = case when new.direcao = 'entrada' then nao_lidas + 1 else 0 end,
    status = case when new.direcao = 'entrada' then 'aberta' when status = 'resolvida' then status else 'aguardando' end
  where id = new.conversa_id
  returning * into c;
  v_rotulo := case c.canal when 'email' then 'E-mail' when 'sms' then 'SMS' when 'whatsapp' then 'WhatsApp' else 'Mensagem' end;
  v_desc := v_rotulo || case when new.direcao = 'entrada' then ' recebido: ' else ' enviado: ' end
    || left(coalesce(new.texto, '[' || new.tipo || ']'), 300);
  if c.lead_id is not null then
    insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao, data, usuario_id)
    values (new.organizacao_id, c.lead_id, case c.canal when 'email' then 'email' when 'whatsapp' then 'whatsapp' else 'mensagem' end,
            v_desc, new.data, new.usuario_id);
    update public.leads set ultimo_contato = greatest(coalesce(ultimo_contato, new.data), new.data) where id = c.lead_id;
  end if;
  if c.pessoa_id is not null then
    insert into public.pessoa_interacoes (organizacao_id, pessoa_id, tipo, descricao, data, usuario_id)
    values (new.organizacao_id, c.pessoa_id, case c.canal when 'email' then 'email' when 'whatsapp' then 'whatsapp' else 'nota' end,
            v_desc, new.data, new.usuario_id);
  end if;
  return null;
end;
$$;
create or replace trigger mkt_mensagens_depois_trg after insert on public.mkt_mensagens
  for each row execute function privado.mkt_mensagem_depois();

/** Imóvel novo / de volta ao mercado e preço que baixou viram eventos para as automações. */
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
        and coalesce(new.valor_novo, 0) > 0 and new.valor_novo < new.valor_anterior then
    insert into public.mkt_eventos (organizacao_id, tipo, imovel_id, campo, valor_anterior, valor_novo)
    values (new.organizacao_id, 'reducao_preco', new.imovel_id, new.campo, new.valor_anterior, new.valor_novo);
  end if;
  return null;
end;
$$;
create or replace trigger imoveis_mkt_evento_trg after insert or update of status on public.imoveis
  for each row execute function privado.mkt_evento_imovel();
create or replace trigger imovel_precos_mkt_evento_trg after insert on public.imovel_precos
  for each row execute function privado.mkt_evento_imovel();

/**
 * Tokens e integrações só por administrador ou gestor:
 * - UPDATE: os outros só gravam o horário das automações;
 * - INSERT (a configuração nasce na primeira visita ao Marketing): os outros só
 *   criam com os valores padrão — tokens sorteados aqui, sem integrações;
 * - DELETE: só admin/gestor (apagar e recriar trocaria os tokens dos webhooks já
 *   cadastrados na Meta/Google). Apagar a imobiliária inteira continua valendo.
 */
create or replace function privado.mkt_config_regras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'DELETE' then
    if pg_trigger_depth() > 1 or privado.pode_ver_restrito(old.organizacao_id)
       or not exists (select 1 from public.organizacoes o where o.id = old.organizacao_id) then
      return old;
    end if;
    raise exception 'Só administradores e gestores mudam as configurações de marketing.';
  end if;
  if tg_op = 'INSERT' then
    if not privado.pode_ver_restrito(new.organizacao_id) then
      new.webhook_token := gen_random_uuid();
      new.whatsapp_verify_token := replace(gen_random_uuid()::text, '-', '');
      new.meta_verify_token := replace(gen_random_uuid()::text, '-', '');
      new.google_lead_key := replace(gen_random_uuid()::text, '-', '');
      new.whatsapp_numero := null;
      new.whatsapp_phone_number_id := null;
      new.whatsapp_waba_id := null;
      new.whatsapp_cria_lead := true;
      new.meta_pixel_id := null;
      new.google_tag_id := null;
      new.google_conversao_label := null;
      new.email_remetente := null;
      new.assinatura := null;
      new.pesquisa_pergunta := null;
    end if;
    return new;
  end if;
  if not privado.pode_ver_restrito(old.organizacao_id)
     and (to_jsonb(new) - 'automacoes_em') is distinct from (to_jsonb(old) - 'automacoes_em') then
    raise exception 'Só administradores e gestores mudam as configurações de marketing.';
  end if;
  return new;
end;
$$;
create or replace trigger mkt_config_regras_trg before insert or update or delete on public.mkt_config
  for each row execute function privado.mkt_config_regras();

/**
 * Bloqueio de comunicação (LGPD): qualquer um da equipe bloqueia, mas só admin/
 * gestor retira ou muda. A própria pessoa muda pelo link (salvar_preferencias) e
 * "juntar repetidos" leva o bloqueio para o cadastro que fica (marca mkt.interno).
 */
create or replace function privado.mkt_descadastros_regras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null or pg_trigger_depth() > 1
     or coalesce(current_setting('mkt.interno', true), '') = 'on'
     or privado.pode_ver_restrito(old.organizacao_id)
     or not exists (select 1 from public.organizacoes o where o.id = old.organizacao_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception 'Só administradores e gestores retiram ou mudam um bloqueio de comunicação.';
end;
$$;
create or replace trigger mkt_descadastros_regras_trg before update or delete on public.mkt_descadastros
  for each row execute function privado.mkt_descadastros_regras();

revoke execute on function privado.mkt_envio_antes() from public, anon;
revoke execute on function privado.mkt_envio_depois() from public, anon;
revoke execute on function privado.mkt_mensagem_depois() from public, anon;
revoke execute on function privado.mkt_evento_imovel() from public, anon;
revoke execute on function privado.mkt_config_regras() from public, anon;
revoke execute on function privado.mkt_descadastros_regras() from public, anon;

/**
 * E-mail em quantidade (CSV para Mailchimp/Brevo/RD): marca vários envios como
 * enviados de uma vez. Quem pediu para não receber nesse meio-tempo vira
 * "bloqueado" (nunca "enviado"); o resto entra no histórico do CRM pelo gatilho.
 * security invoker: o RLS limita à própria imobiliária.
 */
create or replace function public.mkt_marcar_enviados(p_ids uuid[])
returns jsonb
language plpgsql
security invoker
set search_path = public
as $$
declare
  e record;
  n_env int := 0;
  n_bloq int := 0;
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
      n_bloq := n_bloq + 1;
    else
      update public.mkt_envios set status = 'enviado' where id = e.id;
      n_env := n_env + 1;
    end if;
  end loop;
  return jsonb_build_object('enviados', n_env, 'bloqueados', n_bloq);
end;
$$;
revoke execute on function public.mkt_marcar_enviados(uuid[]) from public, anon;
grant execute on function public.mkt_marcar_enviados(uuid[]) to authenticated;

/**
 * Juntar cadastros repetidos de pessoas (Pessoas › juntar repetidos): leva a fila,
 * os bloqueios de comunicação, as pesquisas, as conversas e o registro de
 * preferências do cadastro que sai para o que fica — sem isso o envio sumiria
 * (cascade) e o bloqueio de quem pediu para sair deixaria de valer.
 * security definer porque o registro de preferências não aceita UPDATE pela equipe;
 * confere que os dois cadastros são da imobiliária de quem está juntando.
 */
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
  perform set_config('mkt.interno', '', true);
end;
$$;
revoke execute on function privado.mkt_juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function privado.mkt_juntar_pessoas(uuid, uuid) to authenticated;

/*
 * Encaixa a chamada em public.juntar_pessoas, A PARTIR DO CORPO QUE ESTIVER NO
 * BANCO (pg_get_functiondef), logo antes de "delete from public.pessoas where
 * id = b.id;" — mesmo padrão das migrações de manutenção e análise cadastral,
 * então não se perde o que outras migrações já puseram nela. Idempotente; sem DROP.
 */
do $$
declare
  v_def text;
  v_novo text;
begin
  if to_regprocedure('public.juntar_pessoas(uuid, uuid)') is null then
    raise warning 'public.juntar_pessoas não existe: o marketing não entra no "juntar repetidos".';
    return;
  end if;
  v_def := pg_get_functiondef('public.juntar_pessoas(uuid, uuid)'::regprocedure);
  if v_def ilike '%privado.mkt_juntar_pessoas%' then
    return;
  end if;
  v_novo := regexp_replace(v_def,
    '(\n[ \t]*)(delete[ \t]+from[ \t]+public\.pessoas[ \t]+where[ \t]+id[ \t]*=[ \t]*b\.id[ \t]*;)',
    '\1perform privado.mkt_juntar_pessoas(a.id, b.id);\1\2', 'i');
  if v_novo = v_def then
    raise warning 'Não achei o "delete from public.pessoas where id = b.id;" em public.juntar_pessoas: inclua à mão a chamada a privado.mkt_juntar_pessoas(a.id, b.id).';
    return;
  end if;
  execute v_novo;
end $$;

-- =============================================================================
-- Rotas públicas (escrita só por estas funções, validando o token)
-- =============================================================================

/**
 * Lead com origem da conversão: o mesmo receber_lead (sem repetir quem já está
 * em atendimento) + UTM, gclid e fbclid gravados no lead (primeiro toque fica).
 */
create or replace function public.receber_lead_marketing(p_token uuid, p jsonb)
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
  if coalesce((r->>'captacao')::boolean, false) then
    return r;
  end if;
  v_lead := (r->>'id')::uuid;
  update public.leads set
    utm_source = coalesce(utm_source, nullif(left(btrim(coalesce(p->>'utm_source', '')), 120), '')),
    utm_medium = coalesce(utm_medium, nullif(left(btrim(coalesce(p->>'utm_medium', '')), 120), '')),
    utm_campaign = coalesce(utm_campaign, nullif(left(btrim(coalesce(p->>'utm_campaign', '')), 200), '')),
    utm_content = coalesce(utm_content, nullif(left(btrim(coalesce(p->>'utm_content', '')), 200), '')),
    utm_term = coalesce(utm_term, nullif(left(btrim(coalesce(p->>'utm_term', '')), 200), '')),
    gclid = coalesce(gclid, nullif(left(btrim(coalesce(p->>'gclid', '')), 300), '')),
    fbclid = coalesce(fbclid, nullif(left(btrim(coalesce(p->>'fbclid', '')), 300), '')),
    -- Campanha do sistema com o mesmo utm_campaign (ex.: link mandado na campanha).
    campanha_id = coalesce(campanha_id, (
      select c.id from public.mkt_campanhas c
       where c.organizacao_id = leads.organizacao_id and c.utm_campaign is not null
         and lower(c.utm_campaign) = lower(btrim(coalesce(p->>'utm_campaign', '')))
       order by c.created_at desc limit 1))
  where id = v_lead;
  return r;
end;
$$;
revoke execute on function public.receber_lead_marketing(uuid, jsonb) from public;
grant execute on function public.receber_lead_marketing(uuid, jsonb) to anon, authenticated;

/** Dados públicos da landing page (só publicada e de imobiliária). p_contar soma uma visita. */
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
      from public.imoveis i where i.id = lp.imovel_id;
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
  select codigo into v_cod from public.imoveis where id = lp.imovel_id;
  r := public.receber_lead_marketing(o.leads_token, p || jsonb_strip_nulls(jsonb_build_object(
         'funil', lp.funil,
         'imovel', v_cod,
         'utm_campaign', coalesce(nullif(p->>'utm_campaign', ''), lp.utm_campaign))));
  if not coalesce((r->>'captacao')::boolean, false) then
    update public.leads set landing_id = coalesce(landing_id, lp.id) where id = (r->>'id')::uuid;
  end if;
  update public.mkt_landing_pages set leads = leads + 1 where id = lp.id;
  return r;
end;
$$;
revoke execute on function public.receber_lead_landing(text, jsonb) from public;
grant execute on function public.receber_lead_landing(text, jsonb) to anon, authenticated;

/** Quem é o dono do link de preferências (pessoa ou lead). */
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
end;
$$;
revoke execute on function privado.mkt_contato_do_token(uuid) from public, anon;

/** Página pública de preferências: o que a pessoa recebe hoje. */
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
    'tem_email', c.email is not null,
    'tem_telefone', c.telefone is not null,
    'whatsapp', not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone, 'whatsapp', 'relacionamento'),
    'email', not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone, 'email', 'relacionamento'),
    'sms', not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone, 'sms', 'relacionamento'),
    'ofertas', not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone, '-', 'ofertas'));
end;
$$;
revoke execute on function public.info_preferencias(uuid) from public;
grant execute on function public.info_preferencias(uuid) to anon, authenticated;

/**
 * Salva as preferências pelo link (p: {whatsapp, email, sms, ofertas: boolean, nada: boolean}).
 * Grava o descadastro, a autorização da pessoa (aba Comunicação/LGPD), o registro
 * de preferências e bloqueia o que estava na fila para ela.
 */
create or replace function public.salvar_preferencias(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c record;
  v_nada boolean := coalesce((p->>'nada')::boolean, false);
  v_canal text;
  antes jsonb := '{}'::jsonb;
  depois jsonb := '{}'::jsonb;
  marcado jsonb := '{}'::jsonb;
  v_email text;
  v_tel text;
begin
  select * into c from privado.mkt_contato_do_token(p_token);
  if c.org is null then raise exception 'Link inválido.'; end if;
  v_email := nullif(lower(btrim(coalesce(c.email, ''))), '');
  v_tel := right(regexp_replace(coalesce(c.telefone, ''), '\D', '', 'g'), 9);

  foreach v_canal in array array['whatsapp','email','sms','ofertas'] loop
    antes := antes || jsonb_build_object(v_canal, not privado.mkt_bloqueado(c.org, c.pessoa, c.lead, c.email, c.telefone,
               case when v_canal = 'ofertas' then '-' else v_canal end, case when v_canal = 'ofertas' then 'ofertas' else 'relacionamento' end));
    depois := depois || jsonb_build_object(v_canal, not v_nada and coalesce((p->>v_canal)::boolean, false));
  end loop;

  -- Bloqueios deste contato são refeitos do zero (é a própria pessoa, pelo link dela).
  perform set_config('mkt.interno', 'on', true);
  delete from public.mkt_descadastros d
   where d.organizacao_id = c.org
     and ((c.pessoa is not null and d.pessoa_id = c.pessoa)
       or (c.lead is not null and d.lead_id = c.lead)
       or (v_email is not null and lower(d.email) = v_email)
       or (length(v_tel) >= 8 and right(regexp_replace(coalesce(d.telefone, ''), '\D', '', 'g'), 9) = v_tel));
  if v_nada then
    insert into public.mkt_descadastros (organizacao_id, pessoa_id, lead_id, email, telefone, canal, origem, motivo, usuario_id)
    values (c.org, c.pessoa, c.lead, c.email, c.telefone, 'todos', 'link', 'Pediu para não receber mais nada', null);
  else
    insert into public.mkt_descadastros (organizacao_id, pessoa_id, lead_id, email, telefone, canal, origem, motivo, usuario_id)
    select c.org, c.pessoa, c.lead, c.email, c.telefone, k, 'link', 'Desmarcou na página de preferências', null
      from unnest(array['whatsapp','email','sms','ofertas']) k
     where not (depois->>k)::boolean;
  end if;
  perform set_config('mkt.interno', '', true);

  -- Pessoa: autorização na aba Comunicação (LGPD), com registro de cada caixa que mudou.
  if c.pessoa is not null then
    select jsonb_build_object('whatsapp', aceita_whatsapp, 'email', aceita_email, 'sms', aceita_sms, 'ofertas', aceita_marketing)
      into marcado from public.pessoas where id = c.pessoa;
    update public.pessoas set
      aceita_whatsapp = (depois->>'whatsapp')::boolean,
      aceita_email = (depois->>'email')::boolean,
      aceita_sms = (depois->>'sms')::boolean,
      aceita_marketing = (depois->>'ofertas')::boolean,
      consentimento_em = now(),
      consentimento_origem = 'Página de preferências (pela própria pessoa)'
    where id = c.pessoa;
    insert into public.pessoa_consentimentos (organizacao_id, pessoa_id, canal, concedido, origem, usuario_id)
    select c.org, c.pessoa, case when k = 'ofertas' then 'marketing' else k end, (depois->>k)::boolean,
           'Página de preferências (pela própria pessoa)', null
      from unnest(array['whatsapp','email','sms','ofertas']) k
     where (marcado->>k)::boolean is distinct from (depois->>k)::boolean;
  end if;

  insert into public.mkt_preferencias_log (organizacao_id, pessoa_id, lead_id, email, telefone, canal, concedido, origem, detalhe, usuario_id)
  select c.org, c.pessoa, c.lead, c.email, c.telefone, k, (depois->>k)::boolean, 'link',
         case when v_nada then 'Não quer receber mais nada' end, null
    from unnest(array['whatsapp','email','sms','ofertas']) k
   where (antes->>k)::boolean is distinct from (depois->>k)::boolean
      or (c.pessoa is not null and (marcado->>k)::boolean is distinct from (depois->>k)::boolean);

  update public.mkt_envios e set status = 'bloqueado', motivo = 'Pediu para não receber por este canal'
   where e.organizacao_id = c.org and e.status = 'pendente'
     and ((c.pessoa is not null and e.pessoa_id = c.pessoa) or (c.lead is not null and e.lead_id = c.lead)
       or (v_email is not null and lower(e.email) = v_email)
       or (length(v_tel) >= 8 and right(regexp_replace(coalesce(e.telefone, ''), '\D', '', 'g'), 9) = v_tel))
     and privado.mkt_bloqueado(e.organizacao_id, e.pessoa_id, e.lead_id, e.email, e.telefone, e.canal, e.finalidade);
  return depois;
end;
$$;
revoke execute on function public.salvar_preferencias(uuid, jsonb) from public;
grant execute on function public.salvar_preferencias(uuid, jsonb) to anon, authenticated;

/** Pesquisa pública: nome, pergunta e se já respondeu. */
create or replace function public.info_pesquisa(p_token uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'imobiliaria', o.nome,
    'nome', q.nome,
    'pergunta', coalesce(nullif(q.pergunta, ''), 'De 0 a 10, quanto você recomendaria a ' || o.nome || ' para um amigo ou familiar?'),
    'respondida', q.respondida_em is not null,
    'nota', q.nota)
  from public.mkt_pesquisas q
  join public.organizacoes o on o.id = q.organizacao_id
  where q.token = p_token
$$;
revoke execute on function public.info_pesquisa(uuid) from public;
grant execute on function public.info_pesquisa(uuid) to anon, authenticated;

/** Resposta da pesquisa (uma vez só). Nota até 6 vira tarefa de retorno; tudo entra no histórico do CRM. */
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
            current_date, 'alta', q.lead_id, q.imovel_id, q.contrato_id, null);
  end if;
end;
$$;
revoke execute on function public.responder_pesquisa(uuid, int, text) from public;
grant execute on function public.responder_pesquisa(uuid, int, text) to anon, authenticated;

/** Verificação do webhook (GET da Meta): o verify token confere com o da imobiliária? */
create or replace function public.mkt_verificar_webhook(p_token uuid, p_tipo text, p_verify text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.mkt_config c
      join public.organizacoes o on o.id = c.organizacao_id and o.modo = 'imobiliaria'
     where c.webhook_token = p_token
       and coalesce(p_verify, '') <> ''
       and p_verify = case when p_tipo = 'whatsapp' then c.whatsapp_verify_token else c.meta_verify_token end)
$$;
revoke execute on function public.mkt_verificar_webhook(uuid, text, text) from public;
grant execute on function public.mkt_verificar_webhook(uuid, text, text) to anon, authenticated;

/**
 * Webhook do WhatsApp Business (Cloud API), já normalizado pelo servidor:
 * p: { mensagens: [{telefone, nome, texto, tipo, externo_id, data}], status: [{externo_id, status}] }.
 * Cria/atualiza a conversa, liga ao lead/pessoa de mesmo telefone (ou cria lead),
 * não repete mensagem e trata "SAIR" como descadastro do WhatsApp.
 */
create or replace function public.whatsapp_receber(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  cfg public.mkt_config%rowtype;
  m jsonb;
  s jsonb;
  v_tel text;
  v_conv uuid;
  v_lead uuid;
  v_pessoa uuid;
  v_nome text;
  v_texto text;
  v_data timestamptz;
  n_msg int := 0;
  n_st int := 0;
  k int;
begin
  select c.* into cfg
    from public.mkt_config c
    join public.organizacoes o on o.id = c.organizacao_id and o.modo = 'imobiliaria'
   where c.webhook_token = p_token;
  if not found then raise exception 'Webhook inválido.'; end if;
  if (select count(*) from public.mkt_mensagens where organizacao_id = cfg.organizacao_id and direcao = 'entrada' and data > now() - interval '1 hour') > 3000 then
    raise exception 'Muitas mensagens agora. Tente de novo mais tarde.';
  end if;

  for m in select * from jsonb_array_elements(coalesce(p->'mensagens', '[]'::jsonb)) loop
    v_tel := regexp_replace(coalesce(m->>'telefone', ''), '\D', '', 'g');
    continue when length(v_tel) < 8;
    continue when m->>'externo_id' is not null
      and exists (select 1 from public.mkt_mensagens x where x.organizacao_id = cfg.organizacao_id and x.externo_id = m->>'externo_id');
    v_nome := nullif(left(btrim(coalesce(m->>'nome', '')), 120), '');
    v_texto := left(coalesce(m->>'texto', ''), 4000);
    v_data := coalesce((m->>'data')::timestamptz, now());
    v_conv := null;
    v_lead := null;
    v_pessoa := null;
    -- Mesma conversa mesmo se foi registrada à mão sem o 55 (compara os últimos 9 dígitos).
    select id into v_conv from public.mkt_conversas
     where organizacao_id = cfg.organizacao_id and canal = 'whatsapp'
       and (contato = v_tel or right(regexp_replace(contato, '\D', '', 'g'), 9) = right(v_tel, 9))
     order by (contato = v_tel) desc, ultima_em desc
     limit 1;
    if v_conv is null then
      select id into v_pessoa from public.pessoas
       where organizacao_id = cfg.organizacao_id and right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)
       limit 1;
      select id into v_lead from public.leads
       where organizacao_id = cfg.organizacao_id and status not in ('ganho','perdido')
         and right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 9) = right(v_tel, 9)
       order by created_at desc limit 1;
      if v_lead is null and v_pessoa is null and cfg.whatsapp_cria_lead then
        insert into public.leads (organizacao_id, nome, telefone, origem, funil, interesse, observacoes, ultimo_contato)
        values (cfg.organizacao_id, coalesce(v_nome, '+' || v_tel), v_tel, 'whatsapp', 'locacao', 'locacao', nullif(v_texto, ''), now())
        returning id into v_lead;
        insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao, usuario_id)
        values (cfg.organizacao_id, v_lead, 'entrada', 'Chegou pelo WhatsApp Business', null);
      end if;
      insert into public.mkt_conversas (organizacao_id, canal, contato, nome, lead_id, pessoa_id)
      values (cfg.organizacao_id, 'whatsapp', v_tel, v_nome, v_lead, v_pessoa)
      returning id into v_conv;
    else
      update public.mkt_conversas set nome = coalesce(nome, v_nome) where id = v_conv
      returning lead_id, pessoa_id into v_lead, v_pessoa;
    end if;

    insert into public.mkt_mensagens (organizacao_id, conversa_id, direcao, texto, tipo, externo_id, status, usuario_id, data)
    values (cfg.organizacao_id, v_conv, 'entrada', nullif(v_texto, ''), left(coalesce(m->>'tipo', 'texto'), 30),
            nullif(m->>'externo_id', ''), 'recebida', null, v_data);
    n_msg := n_msg + 1;

    -- "SAIR": não quer mais receber pelo WhatsApp.
    if upper(btrim(v_texto)) in ('SAIR','PARAR','STOP','DESCADASTRAR','DESCADASTRO') then
      insert into public.mkt_descadastros (organizacao_id, pessoa_id, lead_id, telefone, canal, origem, motivo, usuario_id)
      values (cfg.organizacao_id, v_pessoa, v_lead, v_tel, 'whatsapp', 'whatsapp', 'Respondeu "' || upper(btrim(v_texto)) || '" no WhatsApp', null);
      insert into public.mkt_preferencias_log (organizacao_id, pessoa_id, lead_id, telefone, canal, concedido, origem, detalhe, usuario_id)
      values (cfg.organizacao_id, v_pessoa, v_lead, v_tel, 'whatsapp', false, 'whatsapp', 'Respondeu "' || upper(btrim(v_texto)) || '"', null);
      update public.mkt_envios set status = 'bloqueado', motivo = 'Pediu para não receber por este canal'
       where organizacao_id = cfg.organizacao_id and status = 'pendente' and canal = 'whatsapp'
         and right(regexp_replace(coalesce(telefone, ''), '\D', '', 'g'), 9) = right(v_tel, 9);
    end if;
  end loop;

  for s in select * from jsonb_array_elements(coalesce(p->'status', '[]'::jsonb)) loop
    continue when coalesce(s->>'status', '') not in ('enviada','entregue','lida','falhou');
    update public.mkt_mensagens set status = s->>'status'
     where organizacao_id = cfg.organizacao_id and externo_id = s->>'externo_id';
    get diagnostics k = row_count;
    n_st := n_st + k;
  end loop;
  return jsonb_build_object('mensagens', n_msg, 'status', n_st);
end;
$$;
revoke execute on function public.whatsapp_receber(uuid, jsonb) from public;
grant execute on function public.whatsapp_receber(uuid, jsonb) to anon, authenticated;

/**
 * Leads de anúncios, já normalizados pelo servidor:
 * p: { plataforma, chave, teste, externo_id, formulario_id, campanha, bruto, lead: {nome, telefone, email, ...utm} }.
 * Google: a chave tem de conferir. Meta manda só o id do lead (os dados vêm
 * da Graph API com o token da página): fica guardado como "sem_dados".
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
  v_plat text := case when p->>'plataforma' in ('google','meta') then p->>'plataforma' else 'outro' end;
  r jsonb;
begin
  select * into cfg from public.mkt_config where webhook_token = p_token;
  if not found then raise exception 'Webhook inválido.'; end if;
  select * into o from public.organizacoes where id = cfg.organizacao_id and modo = 'imobiliaria';
  if not found then raise exception 'Webhook inválido.'; end if;
  if v_plat = 'google' and coalesce(p->>'chave', '') <> cfg.google_lead_key then
    raise exception 'Chave do Google Ads não confere.';
  end if;
  if (select count(*) from public.mkt_lead_ads where organizacao_id = o.id and recebido_em > now() - interval '1 hour') > 500 then
    raise exception 'Muitos leads agora. Tente de novo mais tarde.';
  end if;
  if coalesce((p->>'teste')::boolean, false) then
    insert into public.mkt_lead_ads (organizacao_id, plataforma, externo_id, formulario_id, campanha_externa, payload, status)
    values (o.id, v_plat, p->>'externo_id', p->>'formulario_id', p->>'campanha', p->'bruto', 'teste');
    return jsonb_build_object('teste', true);
  end if;
  if coalesce(btrim(p->'lead'->>'nome'), '') <> ''
     and (coalesce(btrim(p->'lead'->>'telefone'), '') <> '' or coalesce(btrim(p->'lead'->>'email'), '') <> '') then
    r := public.receber_lead_marketing(o.leads_token, p->'lead');
    insert into public.mkt_lead_ads (organizacao_id, plataforma, externo_id, formulario_id, campanha_externa, payload, lead_id, status)
    values (o.id, v_plat, p->>'externo_id', p->>'formulario_id', p->>'campanha', p->'bruto',
            case when coalesce((r->>'captacao')::boolean, false) then null else (r->>'id')::uuid end, 'recebido');
    return r;
  end if;
  insert into public.mkt_lead_ads (organizacao_id, plataforma, externo_id, formulario_id, campanha_externa, payload, status)
  values (o.id, v_plat, p->>'externo_id', p->>'formulario_id', p->>'campanha', p->'bruto', 'sem_dados');
  return jsonb_build_object('pendente', true);
end;
$$;
revoke execute on function public.lead_ads_receber(uuid, jsonb) from public;
grant execute on function public.lead_ads_receber(uuid, jsonb) to anon, authenticated;
