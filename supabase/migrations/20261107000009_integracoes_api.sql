-- =============================================================================
-- Etapa 21 — Integrações externas e API (nos dois modos)
--
-- - integracoes_config: configuração NÃO secreta de cada provedor (ambiente,
--   ligado/desligado, campos comuns, dica "••••1234" dos segredos, último teste).
--   Ver: admin e gestor. Mudar: só admin (RLS).
-- - integracoes_segredos: as chaves/senhas dos provedores. ESCOLHA: sem service
--   role, o servidor só fala com o banco com a sessão de quem está logado; então
--   o segredo fica numa tabela separada que SÓ o administrador lê e grava (RLS
--   por papel). O servidor ainda cifra o valor (AES-256-GCM) antes de gravar
--   quando a variável INTEGRACOES_CHAVE existe na Vercel — aí nem quem abre o
--   banco vê a chave. A tela nunca mostra o valor de volta (só a dica).
-- - api_chaves / api_uso: chaves da API REST. O banco guarda só o HASH sha256 da
--   chave (mostrada uma única vez, na criação). As rotas /api/v1 entram como
--   anônimo e chamam as funções api_v1_* (security definer), que conferem o
--   hash, a validade/revogação, o escopo e o modo, aplicam o limite por chave e
--   por organização, registram o uso (sem guardar a chave) e só devolvem dados
--   da organização da chave.
-- - webhook_assinaturas / webhook_entregas: avisos para fora. ESCOLHA do
--   segredo: para assinar (HMAC-SHA256) é preciso o segredo em si (com só o hash
--   não dá). Ele fica em privado.webhook_segredos — fora da API do Supabase,
--   ninguém lê nem o administrador — e a assinatura é calculada DENTRO do banco
--   (webhook_lote), então nem o servidor nem o navegador precisam ver o segredo.
--   O administrador vê o segredo uma vez (ao criar ou trocar).
--   Gatilhos AFTER nas tabelas de origem põem o evento na fila só quando a
--   organização tem webhook ativo para ele, sem nunca quebrar a gravação de
--   origem. A entrega é feita pelo servidor em segundo plano (after()).
-- - contabil_contas_mapa: de-para do plano de contas para o contador.
-- - importacao_modelos: mapeamentos de colunas salvos (importar contratos).
-- Sem DROP; tudo idempotente.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Listas fixas (espelho de src/lib/dominio/integracoes.ts)
-- -----------------------------------------------------------------------------
create or replace function privado.webhook_eventos()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array['lead.criado','proposta.criada','visita.agendada','imovel.criado','imovel.atualizado',
               'contrato.criado','contrato.encerrado','fatura.criada','fatura.paga','pagamento.recebido',
               'chamado.aberto','chamado.concluido','documento.assinado']::text[]
$$;
grant execute on function privado.webhook_eventos() to authenticated;

create or replace function privado.api_escopos()
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array['imoveis:leitura','pessoas:leitura','contratos:leitura','faturas:leitura',
               'leads:leitura','leads:escrita','webhooks:escrita']::text[]
$$;
grant execute on function privado.api_escopos() to authenticated;

/** Minutos de espera depois da tentativa n que falhou (5, 15, 45… até 1 dia). Mesma conta de atrasoMinutos(). */
create or replace function privado.webhook_atraso_min(p_tentativa integer)
returns integer
language sql
immutable
set search_path = pg_catalog
as $$
  select least(5 * power(3, greatest(coalesce(p_tentativa, 1), 1) - 1), 1440)::integer
$$;

create or replace function privado.api_hash(p text)
returns text
language sql
immutable
strict
set search_path = pg_catalog
as $$
  select encode(sha256(convert_to(p, 'UTF8')), 'hex')
$$;
revoke execute on function privado.api_hash(text) from public, anon, authenticated;

/** Texto aleatório em hexadecimal (até 64), a partir de dois uuid v4 (gerador forte do Postgres). */
create or replace function privado.hex_aleatorio(p_tam integer)
returns text
language sql
volatile
set search_path = pg_catalog
as $$
  select left(encode(sha256(convert_to(gen_random_uuid()::text || gen_random_uuid()::text, 'UTF8')), 'hex'), least(greatest(p_tam, 1), 64))
$$;
revoke execute on function privado.hex_aleatorio(integer) from public, anon, authenticated;

/** URL de webhook aceitável: https e host público (o servidor confere de novo o IP resolvido). */
create or replace function privado.webhook_url_ok(p_url text)
returns boolean
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_host text;
  v_ip inet;
begin
  if p_url is null or p_url !~* '^https://[^/?#\s]+' or length(p_url) > 2000 or p_url ~ '\s' then
    return false;
  end if;
  v_host := lower(substring(p_url from '^[hH][tT][tT][pP][sS]://([^/?#]+)'));
  if v_host is null or position('@' in v_host) > 0 then
    return false;
  end if;
  if left(v_host, 1) = '[' then
    v_host := substring(v_host from '^\[([^\]]+)\]');
  else
    v_host := regexp_replace(v_host, ':\d+$', '');
  end if;
  v_host := regexp_replace(coalesce(v_host, ''), '\.$', '');
  if v_host = '' then
    return false;
  end if;
  if v_host ~ '^\d{1,3}(\.\d{1,3}){3}$' or position(':' in v_host) > 0 then
    begin
      v_ip := v_host::inet;
    exception when others then
      return false;
    end;
    return not (v_ip <<= any (array['0.0.0.0/8','10.0.0.0/8','100.64.0.0/10','127.0.0.0/8','169.254.0.0/16',
                                     '172.16.0.0/12','192.0.0.0/24','192.0.2.0/24','192.168.0.0/16','198.18.0.0/15',
                                     '198.51.100.0/24','203.0.113.0/24','224.0.0.0/3',
                                     '::/128','::1/128','::ffff:0:0/96','64:ff9b::/96','fc00::/7','fe80::/10',
                                     'ff00::/8','2001:db8::/32']::inet[]));
  end if;
  if position('.' in v_host) = 0 then
    return false;
  end if;
  if v_host ~ '(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain)$' then
    return false;
  end if;
  return true;
end;
$$;
grant execute on function privado.webhook_url_ok(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.integracoes_config (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  provedor text not null check (provedor ~ '^[a-z0-9_]{2,40}$'),
  categoria text not null check (categoria ~ '^[a-z_]{2,30}$'),
  ambiente text not null default 'sandbox' check (ambiente in ('sandbox','producao')),
  ativo boolean not null default false,
  config jsonb not null default '{}'::jsonb check (jsonb_typeof(config) = 'object'),
  chaves_dica jsonb not null default '{}'::jsonb check (jsonb_typeof(chaves_dica) = 'object'),
  ultimo_teste_em timestamptz,
  ultimo_teste_ok boolean,
  ultimo_teste_msg text check (ultimo_teste_msg is null or length(ultimo_teste_msg) <= 500),
  atualizado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organizacao_id, provedor)
);

create table if not exists public.integracoes_segredos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  provedor text not null check (provedor ~ '^[a-z0-9_]{2,40}$'),
  segredos jsonb not null default '{}'::jsonb check (jsonb_typeof(segredos) = 'object'),
  updated_at timestamptz not null default now(),
  unique (organizacao_id, provedor)
);

create table if not exists public.api_chaves (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  prefixo text not null unique check (prefixo ~ '^na_[0-9a-f]{10}$'),
  segredo_hash text not null check (segredo_hash ~ '^[0-9a-f]{64}$'),
  escopos text[] not null default '{}' check (escopos <@ privado.api_escopos()),
  limite_hora integer not null default 600 check (limite_hora between 1 and 5000),
  criada_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  expira_em timestamptz,
  revogada_em timestamptz,
  revogada_por uuid,
  ultimo_uso timestamptz
);

-- Uso da API: só acréscimo, sem FK (fica mesmo se a chave for excluída) e sem a chave.
create table if not exists public.api_uso (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  chave_id uuid,
  prefixo text,
  metodo text not null,
  recurso text not null,
  status integer not null,
  ip text,
  criado_em timestamptz not null default now()
);
create index if not exists api_uso_chave_idx on public.api_uso (chave_id, criado_em desc);
create index if not exists api_uso_org_data_idx on public.api_uso (organizacao_id, criado_em desc);

create table if not exists public.webhook_assinaturas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null check (length(btrim(nome)) between 1 and 80),
  url text not null check (url ~* '^https://' and length(url) <= 2000),
  eventos text[] not null check (cardinality(eventos) > 0 and eventos <@ privado.webhook_eventos()),
  ativo boolean not null default true,
  pausada_em timestamptz,
  pausada_motivo text,
  falhas_seguidas integer not null default 0,
  ultima_entrega_em timestamptz,
  ultimo_status integer,
  criada_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Segredo de assinatura: fora do schema exposto pela API; só as funções do banco leem.
create table if not exists privado.webhook_segredos (
  assinatura_id uuid primary key references public.webhook_assinaturas(id) on delete cascade,
  segredo text not null,
  created_at timestamptz not null default now()
);
alter table privado.webhook_segredos enable row level security;
revoke all on table privado.webhook_segredos from public, anon, authenticated;

create table if not exists public.webhook_entregas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  assinatura_id uuid not null references public.webhook_assinaturas(id) on delete cascade,
  evento text not null,
  recurso_id uuid,
  payload jsonb not null default '{}'::jsonb,
  teste boolean not null default false,
  status text not null default 'pendente' check (status in ('pendente','entregue','falhou','desistiu')),
  tentativas integer not null default 0,
  proxima_tentativa timestamptz not null default now(),
  travada_ate timestamptz,
  ultima_tentativa_em timestamptz,
  resposta_status integer,
  resposta_trecho text,
  erro text,
  entregue_em timestamptz,
  reprocessada_em timestamptz,
  reprocessada_por uuid,
  criado_em timestamptz not null default now()
);
create index if not exists webhook_entregas_fila_idx on public.webhook_entregas (proxima_tentativa) where status in ('pendente','falhou');
create index if not exists webhook_entregas_assinatura_idx on public.webhook_entregas (assinatura_id, criado_em desc);
create index if not exists webhook_entregas_org_data_idx on public.webhook_entregas (organizacao_id, criado_em desc);
create index if not exists webhook_entregas_recurso_idx on public.webhook_entregas (assinatura_id, evento, recurso_id) where status = 'pendente';

create table if not exists public.contabil_contas_mapa (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  origem_tipo text not null check (origem_tipo in ('plano','categoria','conta_financeira','padrao')),
  origem_id uuid,
  origem_texto text,
  conta_contabil text not null check (length(btrim(conta_contabil)) between 1 and 60),
  historico_padrao text check (historico_padrao is null or length(historico_padrao) <= 200),
  created_at timestamptz not null default now(),
  constraint contabil_contas_mapa_origem_check check (
    (origem_tipo in ('plano','conta_financeira') and origem_id is not null)
    or (origem_tipo = 'categoria' and nullif(btrim(origem_texto), '') is not null)
    or (origem_tipo = 'padrao' and origem_texto in ('receita','despesa','banco')))
);
create unique index if not exists contabil_contas_mapa_unico_idx
  on public.contabil_contas_mapa (organizacao_id, origem_tipo, coalesce(origem_id::text, lower(btrim(origem_texto))));

create table if not exists public.importacao_modelos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  tipo text not null default 'contratos' check (tipo in ('contratos')),
  nome text not null check (length(btrim(nome)) between 1 and 80),
  mapa jsonb not null default '{}'::jsonb check (jsonb_typeof(mapa) = 'object'),
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (organizacao_id, tipo, nome)
);

-- -----------------------------------------------------------------------------
-- 3. Guardas (gatilhos BEFORE)
-- -----------------------------------------------------------------------------
create or replace function privado.integracoes_config_antes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.organizacao_id := old.organizacao_id;
    new.provedor := old.provedor;
    new.created_at := old.created_at;
  end if;
  new.updated_at := now();
  new.atualizado_por := coalesce(auth.uid(), new.atualizado_por);
  return new;
end;
$$;
create or replace trigger integracoes_config_antes_trg before insert or update on public.integracoes_config
  for each row execute function privado.integracoes_config_antes();

create or replace function privado.integracoes_segredos_antes()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.organizacao_id := old.organizacao_id;
    new.provedor := old.provedor;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger integracoes_segredos_antes_trg before insert or update on public.integracoes_segredos
  for each row execute function privado.integracoes_segredos_antes();

create or replace function privado.api_chaves_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modo text;
begin
  if tg_op = 'UPDATE' then
    new.organizacao_id := old.organizacao_id;
    new.prefixo := old.prefixo;
    new.segredo_hash := old.segredo_hash;
    new.criada_por := old.criada_por;
    new.created_at := old.created_at;
    if old.revogada_em is not null then
      -- Revogada não volta a valer.
      new.revogada_em := old.revogada_em;
      new.revogada_por := old.revogada_por;
    elsif new.revogada_em is not null then
      new.revogada_em := least(new.revogada_em, now());
      new.revogada_por := auth.uid();
    end if;
  end if;
  new.nome := left(btrim(coalesce(new.nome, '')), 80);
  if new.nome = '' then
    raise exception 'Dê um nome à chave (ex.: "n8n", "site").';
  end if;
  new.escopos := array(select distinct e from unnest(coalesce(new.escopos, '{}')) e order by 1);
  if cardinality(new.escopos) = 0 then
    raise exception 'A chave precisa de pelo menos uma permissão.';
  end if;
  -- Modo: só barra permissão de leads ACRESCENTADA agora. Uma chave antiga com
  -- leads (a conta mudou para o modo pessoal depois) continua podendo ser
  -- revogada, renomeada e marcar o último uso; a API já nega leads no pessoal.
  if exists (select 1 from unnest(new.escopos) e
              where e like 'leads:%' and (tg_op = 'INSERT' or not (e = any (coalesce(old.escopos, '{}'::text[]))))) then
    select modo into v_modo from public.organizacoes where id = new.organizacao_id;
    if v_modo = 'pessoal' then
      raise exception 'Leads só existem no modo imobiliária.';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger api_chaves_antes_trg before insert or update on public.api_chaves
  for each row execute function privado.api_chaves_antes();

create or replace function privado.webhook_assinaturas_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modo text;
begin
  if tg_op = 'UPDATE' then
    new.organizacao_id := old.organizacao_id;
    new.criada_por := old.criada_por;
    new.created_at := old.created_at;
  end if;
  new.nome := left(btrim(coalesce(new.nome, '')), 80);
  if new.nome = '' then
    raise exception 'Dê um nome ao webhook.';
  end if;
  new.url := btrim(coalesce(new.url, ''));
  if not privado.webhook_url_ok(new.url) then
    raise exception 'Endereço do webhook inválido: use https:// e um endereço público (nada de localhost, rede interna ou IP reservado).';
  end if;
  new.eventos := array(select distinct e from unnest(coalesce(new.eventos, '{}')) e order by 1);
  -- Modo: só barra evento de leads/propostas ACRESCENTADO agora. Um webhook
  -- antigo (a conta mudou para o modo pessoal depois) continua podendo ser
  -- pausado, reativado e registrar as entregas dos outros eventos.
  if exists (select 1 from unnest(new.eventos) e
              where e in ('lead.criado','proposta.criada') and (tg_op = 'INSERT' or not (e = any (coalesce(old.eventos, '{}'::text[]))))) then
    select modo into v_modo from public.organizacoes where id = new.organizacao_id;
    if v_modo = 'pessoal' then
      raise exception 'Eventos de leads e propostas só existem no modo imobiliária.';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    if new.ativo and not old.ativo then
      new.falhas_seguidas := 0;
      new.pausada_em := null;
      new.pausada_motivo := null;
    elsif not new.ativo and old.ativo then
      new.pausada_em := coalesce(new.pausada_em, now());
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger webhook_assinaturas_antes_trg before insert or update on public.webhook_assinaturas
  for each row execute function privado.webhook_assinaturas_antes();

create or replace function privado.contabil_contas_mapa_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' then
    new.organizacao_id := old.organizacao_id;
  end if;
  new.conta_contabil := btrim(new.conta_contabil);
  new.origem_texto := nullif(btrim(coalesce(new.origem_texto, '')), '');
  if new.origem_tipo = 'padrao' then
    new.origem_texto := lower(new.origem_texto);
  end if;
  if new.origem_tipo = 'plano' and not exists (select 1 from public.plano_contas where id = new.origem_id and organizacao_id = new.organizacao_id) then
    raise exception 'Conta do plano de contas não encontrada.';
  end if;
  if new.origem_tipo = 'conta_financeira' and not exists (select 1 from public.contas_financeiras where id = new.origem_id and organizacao_id = new.organizacao_id) then
    raise exception 'Conta bancária não encontrada.';
  end if;
  if new.origem_tipo in ('categoria','padrao') then
    new.origem_id := null;
  else
    new.origem_texto := null;
  end if;
  return new;
end;
$$;
create or replace trigger contabil_contas_mapa_antes_trg before insert or update on public.contabil_contas_mapa
  for each row execute function privado.contabil_contas_mapa_antes();

-- -----------------------------------------------------------------------------
-- 4. RLS: ver = admin e gestor; mudar = só admin. O perfil de acesso também
--    conta: enquanto as Integrações não têm módulo próprio na lista de
--    permissões, seguem o módulo "configuracoes" (gestor cujo perfil não vê
--    Configurações não vê as integrações). Ponto de integração: módulo próprio.
-- -----------------------------------------------------------------------------
create or replace function privado.integracoes_pode(p_org uuid, p_admin boolean)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select case when p_admin then coalesce(privado.papel_atual(p_org), '') = 'admin'
              else coalesce(privado.papel_atual(p_org), '') = 'admin'
                   or (coalesce(privado.papel_atual(p_org), '') = 'gestor'
                       and privado.tem_permissao(p_org, 'configuracoes', 'ver')) end
$$;
revoke execute on function privado.integracoes_pode(uuid, boolean) from public, anon;
grant execute on function privado.integracoes_pode(uuid, boolean) to authenticated;

do $$
declare
  t text;
begin
  foreach t in array array['integracoes_config','integracoes_segredos','api_chaves','api_uso','webhook_assinaturas',
                           'webhook_entregas','contabil_contas_mapa','importacao_modelos'] loop
    execute format('alter table public.%I enable row level security', t);
    if t not in ('api_uso','webhook_entregas') then
      execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    end if;
  end loop;

  -- Leitura (admin/gestor); o cofre de segredos só o admin.
  foreach t in array array['integracoes_config','api_chaves','api_uso','webhook_assinaturas','webhook_entregas',
                           'contabil_contas_mapa','importacao_modelos'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_ver') then
      execute format($p$create policy %I on public.%I for select to authenticated
        using (organizacao_id in (select privado.org_ids()) and privado.integracoes_pode(organizacao_id, false))$p$, t || '_ver', t);
    end if;
  end loop;

  -- Tudo (admin): configuração, cofre, de-para e modelos.
  foreach t in array array['integracoes_config','integracoes_segredos','contabil_contas_mapa','importacao_modelos'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_admin') then
      execute format($p$create policy %I on public.%I for all to authenticated
        using (organizacao_id in (select privado.org_ids()) and privado.integracoes_pode(organizacao_id, true))
        with check (organizacao_id in (select privado.org_ids()) and privado.integracoes_pode(organizacao_id, true))$p$, t || '_admin', t);
    end if;
  end loop;

  -- Chaves e webhooks: criar só pelas funções (segredo gerado no banco); alterar e excluir, admin.
  foreach t in array array['api_chaves','webhook_assinaturas'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_alterar') then
      execute format($p$create policy %I on public.%I for update to authenticated
        using (organizacao_id in (select privado.org_ids()) and privado.integracoes_pode(organizacao_id, true))
        with check (organizacao_id in (select privado.org_ids()) and privado.integracoes_pode(organizacao_id, true))$p$, t || '_alterar', t);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_excluir') then
      execute format($p$create policy %I on public.%I for delete to authenticated
        using (organizacao_id in (select privado.org_ids()) and privado.integracoes_pode(organizacao_id, true))$p$, t || '_excluir', t);
    end if;
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 5. Auditoria (histórico de ações). Nas chaves e nos webhooks a marca de uso
--    (ultimo_uso, falhas, última entrega) não entra: só mudanças de verdade.
-- -----------------------------------------------------------------------------
create or replace trigger integracoes_config_auditoria_trg after insert or update or delete on public.integracoes_config
  for each row execute function privado.auditar();
create or replace trigger contabil_contas_mapa_auditoria_trg after insert or update or delete on public.contabil_contas_mapa
  for each row execute function privado.auditar();
create or replace trigger importacao_modelos_auditoria_trg after insert or update or delete on public.importacao_modelos
  for each row execute function privado.auditar();
create or replace trigger api_chaves_auditoria_trg after insert or delete on public.api_chaves
  for each row execute function privado.auditar();
create or replace trigger api_chaves_auditoria_upd_trg after update on public.api_chaves
  for each row when ((to_jsonb(old) - 'ultimo_uso') is distinct from (to_jsonb(new) - 'ultimo_uso'))
  execute function privado.auditar();
create or replace trigger webhook_assinaturas_auditoria_trg after insert or delete on public.webhook_assinaturas
  for each row execute function privado.auditar();
create or replace trigger webhook_assinaturas_auditoria_upd_trg after update on public.webhook_assinaturas
  for each row when ((to_jsonb(old) - array['falhas_seguidas','ultima_entrega_em','ultimo_status','updated_at'])
                     is distinct from (to_jsonb(new) - array['falhas_seguidas','ultima_entrega_em','ultimo_status','updated_at']))
  execute function privado.auditar();

-- -----------------------------------------------------------------------------
-- 6. Chaves de API (criação pelo administrador; a chave aparece uma vez)
-- -----------------------------------------------------------------------------
create or replace function public.api_chave_criar(p_nome text, p_escopos text[], p_expira_em timestamptz default null, p_limite_hora integer default 600)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_modo text;
  v_esc text[];
  v_pre text;
  v_chave text;
  v_id uuid;
  i integer := 0;
begin
  if v_org is null or not privado.integracoes_pode(v_org, true) then
    raise exception 'Só o administrador cria chaves de API.';
  end if;
  select modo into v_modo from organizacoes where id = v_org;
  v_esc := array(select distinct e from unnest(coalesce(p_escopos, '{}')) e where e = any (privado.api_escopos()) order by 1);
  if v_modo = 'pessoal' and exists (select 1 from unnest(v_esc) e where e like 'leads:%') then
    raise exception 'Leads só existem no modo imobiliária.';
  end if;
  if cardinality(v_esc) = 0 then
    raise exception 'Escolha pelo menos uma permissão para a chave.';
  end if;
  if p_expira_em is not null and p_expira_em <= now() then
    raise exception 'A validade precisa ser uma data no futuro.';
  end if;
  if (select count(*) from api_chaves where organizacao_id = v_org and revogada_em is null and (expira_em is null or expira_em > now())) >= 20 then
    raise exception 'Já existem 20 chaves ativas. Revogue as que não usa mais.';
  end if;
  loop
    i := i + 1;
    v_pre := 'na_' || privado.hex_aleatorio(10);
    exit when not exists (select 1 from api_chaves where prefixo = v_pre) or i > 5;
  end loop;
  v_chave := v_pre || '_' || privado.hex_aleatorio(48);
  insert into api_chaves (organizacao_id, nome, prefixo, segredo_hash, escopos, limite_hora, expira_em)
  values (v_org, p_nome, v_pre, privado.api_hash(v_chave), v_esc, least(greatest(coalesce(p_limite_hora, 600), 1), 5000), p_expira_em)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'prefixo', v_pre, 'chave', v_chave);
end;
$$;
revoke execute on function public.api_chave_criar(text, text[], timestamptz, integer) from public;
grant execute on function public.api_chave_criar(text, text[], timestamptz, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. API REST v1: autenticação, limites, registro de uso e recursos
-- -----------------------------------------------------------------------------
create or replace function privado.api_erro(p_status integer, p_codigo text, p_mensagem text, p_extra jsonb default '{}'::jsonb)
returns jsonb
language sql
immutable
set search_path = pg_catalog
as $$
  select jsonb_build_object('status', p_status, 'erro', jsonb_build_object('codigo', p_codigo, 'mensagem', p_mensagem)) || coalesce(p_extra, '{}'::jsonb)
$$;
revoke execute on function privado.api_erro(integer, text, text, jsonb) from public, anon, authenticated;

create or replace function privado.api_registrar(a jsonb, p_metodo text, p_recurso text, p_status integer, p_ip text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into api_uso (organizacao_id, chave_id, prefixo, metodo, recurso, status, ip)
  values ((a ->> 'org')::uuid, (a ->> 'chave_id')::uuid, a ->> 'prefixo', left(p_metodo, 10), left(p_recurso, 40), p_status, left(p_ip, 64))
$$;
revoke execute on function privado.api_registrar(jsonb, text, text, integer, text) from public, anon, authenticated;

/**
 * Confere a chave: formato, hash, revogação, validade, limites (por chave e por
 * organização), escopo e modo. Devolve {ok, org, chave_id, prefixo, modo,
 * escopos} ou {status, erro}. A mesma mensagem para chave inexistente ou errada.
 */
create or replace function privado.api_autenticar(p_chave text, p_escopo text, p_metodo text, p_recurso text, p_ip text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c api_chaves%rowtype;
  v_modo text;
  v_n integer;
  v_desde timestamptz;
  v_a jsonb;
begin
  if p_chave is null or p_chave !~ '^na_[0-9a-f]{10}_[0-9a-f]{48}$' then
    return privado.api_erro(401, 'nao_autorizado', 'Chave de API ausente ou em formato errado. Envie o cabeçalho Authorization: Bearer <chave>.');
  end if;
  select * into c from api_chaves where prefixo = left(p_chave, 13);
  if not found or c.segredo_hash <> privado.api_hash(p_chave) then
    return privado.api_erro(401, 'nao_autorizado', 'Chave de API inválida.');
  end if;
  if c.revogada_em is not null then
    return privado.api_erro(401, 'nao_autorizado', 'Esta chave de API foi revogada.');
  end if;
  if c.expira_em is not null and c.expira_em <= now() then
    return privado.api_erro(401, 'nao_autorizado', 'Esta chave de API expirou.');
  end if;

  select count(*), min(criado_em) into v_n, v_desde from api_uso where chave_id = c.id and criado_em > now() - interval '1 hour';
  if v_n >= c.limite_hora then
    return privado.api_erro(429, 'limite_excedido', format('Limite de %s chamadas por hora desta chave atingido.', c.limite_hora),
      jsonb_build_object('tentar_em', greatest(1, ceil(extract(epoch from (v_desde + interval '1 hour' - now())))::integer)));
  end if;
  select count(*) into v_n from api_uso where organizacao_id = c.organizacao_id and criado_em > now() - interval '1 hour';
  if v_n >= 5000 then
    return privado.api_erro(429, 'limite_excedido', 'Limite de chamadas por hora da conta atingido.', jsonb_build_object('tentar_em', 600));
  end if;

  select modo into v_modo from organizacoes where id = c.organizacao_id;
  v_a := jsonb_build_object('ok', true, 'org', c.organizacao_id, 'chave_id', c.id, 'prefixo', c.prefixo, 'modo', v_modo, 'escopos', to_jsonb(c.escopos));
  if not (p_escopo = any (c.escopos)) then
    perform privado.api_registrar(v_a, p_metodo, p_recurso, 403, p_ip);
    return privado.api_erro(403, 'sem_permissao', format('A chave não tem a permissão "%s".', p_escopo));
  end if;
  if p_escopo like 'leads:%' and v_modo = 'pessoal' then
    perform privado.api_registrar(v_a, p_metodo, p_recurso, 403, p_ip);
    return privado.api_erro(403, 'sem_permissao', 'Leads só existem no modo imobiliária.');
  end if;
  if c.ultimo_uso is null or c.ultimo_uso < now() - interval '1 minute' then
    begin
      update api_chaves set ultimo_uso = now() where id = c.id;
    exception when others then
      null; -- a marca de "último uso" nunca derruba a chamada
    end;
  end if;
  return v_a;
end;
$$;
revoke execute on function privado.api_autenticar(text, text, text, text, text) from public, anon, authenticated;

-- Representação de cada recurso (sem dados sensíveis desnecessários).
create or replace function privado.api_json_imovel(i public.imoveis)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', i.id, 'codigo', i.codigo, 'tipo', i.tipo, 'status', i.status, 'finalidades', to_jsonb(i.finalidades),
    'titulo', i.titulo, 'descricao', i.descricao, 'cep', i.cep, 'logradouro', i.logradouro, 'numero', i.numero,
    'complemento', i.complemento, 'bairro', i.bairro, 'cidade', i.cidade, 'uf', i.uf,
    'latitude', i.latitude, 'longitude', i.longitude, 'area_util', i.area_util, 'area_total', i.area_total,
    'quartos', i.quartos, 'suites', i.suites, 'banheiros', i.banheiros, 'vagas', i.vagas,
    'valor_aluguel', i.valor_aluguel, 'valor_venda', i.valor_venda, 'valor_condominio', i.valor_condominio,
    'valor_iptu', i.valor_iptu, 'caracteristicas', to_jsonb(i.caracteristicas), 'comodidades', to_jsonb(i.comodidades),
    'publicar_site', i.publicar_site, 'criado_em', i.created_at)
$$;

create or replace function privado.api_json_pessoa(p public.pessoas)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', p.id, 'tipo_pessoa', p.tipo_pessoa, 'nome', p.nome, 'email', p.email, 'telefone', p.telefone,
    'papeis', to_jsonb(p.papeis), 'cidade', p.cidade, 'uf', p.uf, 'criado_em', p.created_at)
$$;

create or replace function privado.api_json_contrato(c public.contratos)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id, 'numero', c.numero, 'codigo', c.codigo, 'imovel_id', c.imovel_id, 'status', c.status,
    'finalidade', c.finalidade, 'data_inicio', c.data_inicio, 'data_fim', c.data_fim, 'prazo_meses', c.prazo_meses,
    'valor_aluguel', c.valor_aluguel, 'dia_vencimento', c.dia_vencimento, 'indice_reajuste', c.indice_reajuste,
    'garantia_tipo', c.garantia_tipo, 'data_rescisao', c.data_rescisao,
    'partes', coalesce((select jsonb_agg(jsonb_build_object('pessoa_id', cp.pessoa_id, 'papel', cp.papel, 'percentual', cp.percentual)
                                         order by cp.papel, cp.pessoa_id)
                          from contrato_partes cp where cp.contrato_id = c.id), '[]'::jsonb),
    'criado_em', c.created_at)
$$;

create or replace function privado.api_json_fatura(f public.faturas, p_itens boolean default false)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', f.id, 'numero', f.numero, 'contrato_id', f.contrato_id, 'competencia', f.competencia,
    'vencimento', f.vencimento, 'valor_total', f.valor_total, 'valor_abatido', f.valor_abatido, 'status', f.status,
    'pago_em', f.pago_em, 'valor_pago', f.valor_pago, 'pix_copia_cola', f.pix_copia_cola,
    'linha_digitavel', f.linha_digitavel, 'criado_em', f.created_at)
  || case when p_itens then jsonb_build_object('itens', coalesce((
       select jsonb_agg(jsonb_build_object('descricao', it.descricao, 'tipo', it.tipo, 'valor', it.valor) order by it.id)
         from fatura_itens it where it.fatura_id = f.id), '[]'::jsonb)) else '{}'::jsonb end
$$;

create or replace function privado.api_json_lead(l public.leads)
returns jsonb
language sql
stable
set search_path = public
as $$
  select jsonb_build_object(
    'id', l.id, 'nome', l.nome, 'telefone', l.telefone, 'email', l.email, 'origem', l.origem, 'funil', l.funil,
    'interesse', l.interesse, 'status', l.status, 'prioridade', l.prioridade, 'imovel_id', l.imovel_id,
    'corretor_id', l.corretor_id, 'utm_source', l.utm_source, 'utm_medium', l.utm_medium,
    'utm_campaign', l.utm_campaign, 'criado_em', l.created_at)
$$;

do $$
declare
  f text;
begin
  foreach f in array array['privado.api_json_imovel(public.imoveis)','privado.api_json_pessoa(public.pessoas)',
                           'privado.api_json_contrato(public.contratos)','privado.api_json_fatura(public.faturas, boolean)',
                           'privado.api_json_lead(public.leads)'] loop
    execute format('revoke execute on function %s from public, anon, authenticated', f);
  end loop;
end $$;

/** Valida os filtros da lista. Devolve a mensagem do erro (ou null). */
create or replace function privado.api_filtros_erro(p_recurso text, p jsonb)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  k text;
  v_uuid text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
begin
  if p ? 'limite' and ((p ->> 'limite') !~ '^\d{1,3}$' or (p ->> 'limite')::integer not between 1 and 100) then
    return 'limite deve ser um número de 1 a 100.';
  end if;
  if p ? 'cursor' and (p ->> 'cursor') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return 'cursor inválido.';
  end if;
  if p_recurso = 'imoveis' then
    if p ? 'status' and (p ->> 'status') not in ('disponivel','alugado','vendido','reservado','inativo') then return 'status inválido.'; end if;
    if p ? 'finalidade' and (p ->> 'finalidade') not in ('locacao','venda') then return 'finalidade deve ser locacao ou venda.'; end if;
    if p ? 'publicado' and (p ->> 'publicado') not in ('true','false') then return 'publicado deve ser true ou false.'; end if;
  elsif p_recurso = 'contratos' then
    if p ? 'status' and (p ->> 'status') not in ('rascunho','ativo','encerrado','rescindido') then return 'status inválido.'; end if;
    if p ? 'imovel_id' and (p ->> 'imovel_id') !~ v_uuid then return 'imovel_id inválido.'; end if;
  elsif p_recurso = 'faturas' then
    if p ? 'status' and (p ->> 'status') not in ('aberta','paga','cancelada','renegociada') then return 'status inválido.'; end if;
    if p ? 'contrato_id' and (p ->> 'contrato_id') !~ v_uuid then return 'contrato_id inválido.'; end if;
  elsif p_recurso = 'leads' then
    if p ? 'status' and (p ->> 'status') not in ('novo','em_atendimento','visita','proposta','ganho','perdido') then return 'status inválido.'; end if;
    if p ? 'funil' and (p ->> 'funil') not in ('locacao','venda','captacao') then return 'funil inválido.'; end if;
  end if;
  foreach k in array array['vencimento_de','vencimento_ate','desde'] loop
    if p ? k then
      if (p ->> k) !~ '^\d{4}-\d{2}-\d{2}$' then return k || ' deve ser uma data AAAA-MM-DD.'; end if;
      begin
        perform (p ->> k)::date;
      exception when others then
        return k || ' deve ser uma data válida.';
      end;
    end if;
  end loop;
  return null;
end;
$$;
revoke execute on function privado.api_filtros_erro(text, jsonb) from public, anon, authenticated;

create or replace function public.api_v1_listar(p_chave text, p_recurso text, p_params jsonb default '{}'::jsonb, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a jsonb;
  p jsonb := case when jsonb_typeof(p_params) = 'object' then p_params else '{}'::jsonb end;
  v_org uuid;
  v_lim integer;
  v_ts timestamptz;
  v_id uuid;
  v_erro text;
  v_dados jsonb;
  v_n integer;
  v_prox text;
  v_fmt text := 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"';
begin
  if p_recurso is null or p_recurso not in ('imoveis','pessoas','contratos','faturas','leads') then
    return privado.api_erro(404, 'nao_encontrado', 'Recurso desconhecido.');
  end if;
  a := privado.api_autenticar(p_chave, p_recurso || ':leitura', 'GET', p_recurso, p_ip);
  if not coalesce((a ->> 'ok')::boolean, false) then
    return a;
  end if;
  v_org := (a ->> 'org')::uuid;
  v_erro := privado.api_filtros_erro(p_recurso, p);
  if v_erro is not null then
    perform privado.api_registrar(a, 'GET', p_recurso, 422, p_ip);
    return privado.api_erro(422, 'dados_invalidos', v_erro);
  end if;
  v_lim := coalesce((p ->> 'limite')::integer, 50);
  if p ? 'cursor' then
    v_ts := split_part(p ->> 'cursor', '|', 1)::timestamptz;
    v_id := split_part(p ->> 'cursor', '|', 2)::uuid;
  end if;

  if p_recurso = 'imoveis' then
    select coalesce(jsonb_agg(x.obj order by x.created_at desc, x.id desc) filter (where x.rn <= v_lim), '[]'::jsonb), count(*),
           max(case when x.rn = v_lim then to_char(x.created_at at time zone 'UTC', v_fmt) || '|' || x.id end)
      into v_dados, v_n, v_prox
      from (select i.id, i.created_at, row_number() over (order by i.created_at desc, i.id desc) as rn, privado.api_json_imovel(i) as obj
              from imoveis i
             where i.organizacao_id = v_org
               and (v_ts is null or (i.created_at, i.id) < (v_ts, v_id))
               and (not p ? 'status' or i.status = p ->> 'status')
               and (not p ? 'finalidade' or (p ->> 'finalidade') = any (i.finalidades))
               and (not p ? 'codigo' or lower(i.codigo) = lower(p ->> 'codigo'))
               and (not p ? 'cidade' or lower(i.cidade) = lower(p ->> 'cidade'))
               and (not p ? 'bairro' or lower(i.bairro) = lower(p ->> 'bairro'))
               and (not p ? 'publicado' or i.publicar_site = ((p ->> 'publicado') = 'true'))
             order by i.created_at desc, i.id desc
             limit v_lim + 1) x;
  elsif p_recurso = 'pessoas' then
    select coalesce(jsonb_agg(x.obj order by x.created_at desc, x.id desc) filter (where x.rn <= v_lim), '[]'::jsonb), count(*),
           max(case when x.rn = v_lim then to_char(x.created_at at time zone 'UTC', v_fmt) || '|' || x.id end)
      into v_dados, v_n, v_prox
      from (select pe.id, pe.created_at, row_number() over (order by pe.created_at desc, pe.id desc) as rn, privado.api_json_pessoa(pe) as obj
              from pessoas pe
             where pe.organizacao_id = v_org
               and (v_ts is null or (pe.created_at, pe.id) < (v_ts, v_id))
               and (not p ? 'papel' or (p ->> 'papel') = any (pe.papeis))
               and (not p ? 'documento' or (regexp_replace(coalesce(pe.documento, ''), '\D', '', 'g') = regexp_replace(p ->> 'documento', '\D', '', 'g')
                                            and regexp_replace(p ->> 'documento', '\D', '', 'g') <> ''))
               and (not p ? 'busca' or strpos(lower(pe.nome), lower(p ->> 'busca')) > 0)
             order by pe.created_at desc, pe.id desc
             limit v_lim + 1) x;
  elsif p_recurso = 'contratos' then
    select coalesce(jsonb_agg(x.obj order by x.created_at desc, x.id desc) filter (where x.rn <= v_lim), '[]'::jsonb), count(*),
           max(case when x.rn = v_lim then to_char(x.created_at at time zone 'UTC', v_fmt) || '|' || x.id end)
      into v_dados, v_n, v_prox
      from (select c.id, c.created_at, row_number() over (order by c.created_at desc, c.id desc) as rn, privado.api_json_contrato(c) as obj
              from contratos c
             where c.organizacao_id = v_org
               and (v_ts is null or (c.created_at, c.id) < (v_ts, v_id))
               and (not p ? 'status' or c.status = p ->> 'status')
               and (not p ? 'imovel_id' or c.imovel_id = (p ->> 'imovel_id')::uuid)
             order by c.created_at desc, c.id desc
             limit v_lim + 1) x;
  elsif p_recurso = 'faturas' then
    select coalesce(jsonb_agg(x.obj order by x.created_at desc, x.id desc) filter (where x.rn <= v_lim), '[]'::jsonb), count(*),
           max(case when x.rn = v_lim then to_char(x.created_at at time zone 'UTC', v_fmt) || '|' || x.id end)
      into v_dados, v_n, v_prox
      from (select f.id, f.created_at, row_number() over (order by f.created_at desc, f.id desc) as rn, privado.api_json_fatura(f) as obj
              from faturas f
             where f.organizacao_id = v_org
               and (v_ts is null or (f.created_at, f.id) < (v_ts, v_id))
               and (not p ? 'status' or f.status = p ->> 'status')
               and (not p ? 'contrato_id' or f.contrato_id = (p ->> 'contrato_id')::uuid)
               and (not p ? 'vencimento_de' or f.vencimento >= (p ->> 'vencimento_de')::date)
               and (not p ? 'vencimento_ate' or f.vencimento <= (p ->> 'vencimento_ate')::date)
             order by f.created_at desc, f.id desc
             limit v_lim + 1) x;
  else
    select coalesce(jsonb_agg(x.obj order by x.created_at desc, x.id desc) filter (where x.rn <= v_lim), '[]'::jsonb), count(*),
           max(case when x.rn = v_lim then to_char(x.created_at at time zone 'UTC', v_fmt) || '|' || x.id end)
      into v_dados, v_n, v_prox
      from (select l.id, l.created_at, row_number() over (order by l.created_at desc, l.id desc) as rn, privado.api_json_lead(l) as obj
              from leads l
             where l.organizacao_id = v_org
               and (v_ts is null or (l.created_at, l.id) < (v_ts, v_id))
               and (not p ? 'status' or l.status = p ->> 'status')
               and (not p ? 'funil' or l.funil = p ->> 'funil')
               and (not p ? 'origem' or l.origem = p ->> 'origem')
               and (not p ? 'desde' or l.created_at >= ((p ->> 'desde')::date::timestamp at time zone 'America/Sao_Paulo'))
             order by l.created_at desc, l.id desc
             limit v_lim + 1) x;
  end if;

  perform privado.api_registrar(a, 'GET', p_recurso, 200, p_ip);
  return jsonb_build_object('status', 200, 'dados', v_dados, 'proximo_cursor', case when v_n > v_lim then v_prox end);
end;
$$;
revoke execute on function public.api_v1_listar(text, text, jsonb, text) from public;
grant execute on function public.api_v1_listar(text, text, jsonb, text) to anon, authenticated;

create or replace function public.api_v1_obter(p_chave text, p_recurso text, p_id text, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a jsonb;
  v_org uuid;
  v_id uuid;
  v_obj jsonb;
begin
  if p_recurso is null or p_recurso not in ('imoveis','pessoas','contratos','faturas','leads') then
    return privado.api_erro(404, 'nao_encontrado', 'Recurso desconhecido.');
  end if;
  a := privado.api_autenticar(p_chave, p_recurso || ':leitura', 'GET', p_recurso, p_ip);
  if not coalesce((a ->> 'ok')::boolean, false) then
    return a;
  end if;
  v_org := (a ->> 'org')::uuid;
  if p_id ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
    v_id := p_id::uuid;
    if p_recurso = 'imoveis' then
      select privado.api_json_imovel(i) into v_obj from imoveis i where i.id = v_id and i.organizacao_id = v_org;
    elsif p_recurso = 'pessoas' then
      select privado.api_json_pessoa(pe) into v_obj from pessoas pe where pe.id = v_id and pe.organizacao_id = v_org;
    elsif p_recurso = 'contratos' then
      select privado.api_json_contrato(c) into v_obj from contratos c where c.id = v_id and c.organizacao_id = v_org;
    elsif p_recurso = 'faturas' then
      select privado.api_json_fatura(f, true) into v_obj from faturas f where f.id = v_id and f.organizacao_id = v_org;
    else
      select privado.api_json_lead(l) into v_obj from leads l where l.id = v_id and l.organizacao_id = v_org;
    end if;
  end if;
  if v_obj is null then
    perform privado.api_registrar(a, 'GET', p_recurso, 404, p_ip);
    return privado.api_erro(404, 'nao_encontrado', 'Registro não encontrado.');
  end if;
  perform privado.api_registrar(a, 'GET', p_recurso, 200, p_ip);
  return jsonb_build_object('status', 200, 'dados', v_obj);
end;
$$;
revoke execute on function public.api_v1_obter(text, text, text, text) from public;
grant execute on function public.api_v1_obter(text, text, text, text) to anon, authenticated;

/**
 * Lead pela API: a mesma regra do formulário de captação da conta
 * (privado.mkt_receber_lead → receber_lead: repetido vira mensagem, rodízio,
 * fila, UTM e limite por hora). Só imobiliária.
 */
create or replace function public.api_v1_criar_lead(p_chave text, p jsonb, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a jsonb;
  v_org uuid;
  v_token uuid;
  v_dados jsonb := '{}'::jsonb;
  k text;
  r jsonb;
begin
  a := privado.api_autenticar(p_chave, 'leads:escrita', 'POST', 'leads', p_ip);
  if not coalesce((a ->> 'ok')::boolean, false) then
    return a;
  end if;
  v_org := (a ->> 'org')::uuid;
  if p is null or jsonb_typeof(p) <> 'object' then
    perform privado.api_registrar(a, 'POST', 'leads', 400, p_ip);
    return privado.api_erro(400, 'requisicao_invalida', 'Envie um objeto JSON.');
  end if;
  foreach k in array array['nome','telefone','email','mensagem','origem','funil','imovel','utm_source','utm_medium',
                           'utm_campaign','utm_content','utm_term','gclid','fbclid'] loop
    if jsonb_typeof(p -> k) in ('string','number') and btrim(p ->> k) <> '' then
      v_dados := v_dados || jsonb_build_object(k, left(btrim(p ->> k), case when k = 'mensagem' then 2000 else 300 end));
    end if;
  end loop;
  if not v_dados ? 'nome' then
    perform privado.api_registrar(a, 'POST', 'leads', 422, p_ip);
    return privado.api_erro(422, 'dados_invalidos', 'Informe o nome.');
  end if;
  if not (v_dados ? 'telefone' or v_dados ? 'email') then
    perform privado.api_registrar(a, 'POST', 'leads', 422, p_ip);
    return privado.api_erro(422, 'dados_invalidos', 'Informe telefone ou e-mail.');
  end if;
  if v_dados ? 'email' and (v_dados ->> 'email') !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    perform privado.api_registrar(a, 'POST', 'leads', 422, p_ip);
    return privado.api_erro(422, 'dados_invalidos', 'E-mail inválido.');
  end if;
  if not v_dados ? 'origem' then
    v_dados := v_dados || jsonb_build_object('origem', 'outro');
  end if;
  select leads_token into v_token from organizacoes where id = v_org;
  if v_token is null then
    perform privado.api_registrar(a, 'POST', 'leads', 422, p_ip);
    return privado.api_erro(422, 'nao_processado', 'Não foi possível registrar o lead.');
  end if;
  begin
    r := privado.mkt_receber_lead(v_token, v_dados);
  exception when others then
    -- Só mensagens conhecidas vão para fora; erro interno do banco (nome de
    -- coluna, restrição…) vira uma mensagem genérica.
    if sqlerrm ilike 'Muitas mensagens%' then
      perform privado.api_registrar(a, 'POST', 'leads', 429, p_ip);
      return privado.api_erro(429, 'limite_excedido', 'Muitos leads nesta hora. Tente de novo mais tarde.', jsonb_build_object('tentar_em', 600));
    end if;
    perform privado.api_registrar(a, 'POST', 'leads', 422, p_ip);
    if sqlerrm in ('Informe o nome.', 'Informe telefone ou e-mail.') then
      return privado.api_erro(422, 'dados_invalidos', sqlerrm);
    end if;
    return privado.api_erro(422, 'nao_processado', 'Não foi possível registrar o lead.');
  end;
  perform privado.api_registrar(a, 'POST', 'leads', 201, p_ip);
  return jsonb_build_object('status', 201, 'dados',
    case when (a -> 'escopos') ? 'leads:leitura' then jsonb_build_object('ok', true, 'id', r ->> 'id') else jsonb_build_object('ok', true) end);
end;
$$;
revoke execute on function public.api_v1_criar_lead(text, jsonb, text) from public;
grant execute on function public.api_v1_criar_lead(text, jsonb, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Webhooks: fila, gatilhos de origem, entrega e reprocessamento
-- -----------------------------------------------------------------------------

/** Põe o evento na fila de cada webhook ativo que o assina. "imovel.atualizado" junta com o que ainda está na fila. */
create or replace function privado.webhook_enfileirar(p_org uuid, p_evento text, p_recurso uuid, p_payload jsonb, p_assinatura uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  s record;
  v_n integer := 0;
begin
  for s in
    select w.id from webhook_assinaturas w
     where w.organizacao_id = p_org and w.ativo
       and (p_assinatura is null or w.id = p_assinatura)
       and (p_evento = 'webhook.teste' or p_evento = any (w.eventos))
  loop
    if p_evento = 'imovel.atualizado' and p_recurso is not null then
      update webhook_entregas e
         set payload = coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('campos', to_jsonb(array(
               select distinct x from (
                 select jsonb_array_elements_text(case when jsonb_typeof(e.payload -> 'campos') = 'array' then e.payload -> 'campos' else '[]'::jsonb end) as x
                 union
                 select jsonb_array_elements_text(case when jsonb_typeof(p_payload -> 'campos') = 'array' then p_payload -> 'campos' else '[]'::jsonb end)) u
               order by 1)))
       where e.assinatura_id = s.id and e.evento = p_evento and e.recurso_id = p_recurso
         and e.status = 'pendente' and e.tentativas = 0 and e.travada_ate is null;
      if found then
        v_n := v_n + 1;
        continue;
      end if;
    end if;
    insert into webhook_entregas (organizacao_id, assinatura_id, evento, recurso_id, payload, teste)
    values (p_org, s.id, p_evento, p_recurso, coalesce(p_payload, '{}'::jsonb), p_evento = 'webhook.teste');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function privado.webhook_enfileirar(uuid, text, uuid, jsonb, uuid) from public, anon, authenticated;

/** Gatilho AFTER das tabelas de origem: monta o payload mínimo e põe na fila. Nunca quebra a gravação. */
create or replace function privado.webhook_evento()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb;
  o jsonb;
  v_org uuid := new.organizacao_id;
  v_evento text;
  v_payload jsonb;
  v_campos text[];
begin
  -- Caminho rápido: sem webhook ligado na organização, nada a fazer.
  if v_org is null or not exists (select 1 from webhook_assinaturas where organizacao_id = v_org and ativo) then
    return null;
  end if;
  j := to_jsonb(new);
  o := case when tg_op = 'UPDATE' then to_jsonb(old) end;
  begin
    if tg_table_name = 'leads' and tg_op = 'INSERT' then
      v_evento := 'lead.criado';
      v_payload := jsonb_build_object('id', j -> 'id', 'nome', j -> 'nome', 'origem', j -> 'origem', 'funil', j -> 'funil',
                                      'status', j -> 'status', 'imovel_id', j -> 'imovel_id', 'corretor_id', j -> 'corretor_id', 'criado_em', j -> 'created_at');
    elsif tg_table_name = 'propostas' and tg_op = 'INSERT' then
      v_evento := 'proposta.criada';
      v_payload := jsonb_build_object('id', j -> 'id', 'tipo', j -> 'tipo', 'imovel_id', j -> 'imovel_id', 'lead_id', j -> 'lead_id',
                                      'valor', j -> 'valor', 'status', j -> 'status', 'criado_em', j -> 'created_at');
    elsif tg_table_name = 'visitas' and tg_op = 'INSERT' and j ->> 'tipo' = 'visita' and j ->> 'status' = 'agendada' then
      v_evento := 'visita.agendada';
      v_payload := jsonb_build_object('id', j -> 'id', 'imovel_id', j -> 'imovel_id', 'lead_id', j -> 'lead_id', 'pessoa_id', j -> 'pessoa_id',
                                      'data_hora', j -> 'data_hora', 'duracao_min', j -> 'duracao_min', 'modalidade', j -> 'modalidade');
    elsif tg_table_name = 'imoveis' then
      v_payload := jsonb_build_object('id', j -> 'id', 'codigo', j -> 'codigo', 'tipo', j -> 'tipo', 'status', j -> 'status',
                                      'finalidades', j -> 'finalidades', 'cidade', j -> 'cidade', 'bairro', j -> 'bairro', 'uf', j -> 'uf',
                                      'valor_aluguel', j -> 'valor_aluguel', 'valor_venda', j -> 'valor_venda', 'publicar_site', j -> 'publicar_site');
      if tg_op = 'INSERT' then
        v_evento := 'imovel.criado';
      else
        v_campos := array(select k from jsonb_object_keys(j) k where (o -> k) is distinct from (j -> k) order by 1);
        if cardinality(v_campos) > 0 then
          v_evento := 'imovel.atualizado';
          v_payload := v_payload || jsonb_build_object('campos', to_jsonb(v_campos));
        end if;
      end if;
    elsif tg_table_name = 'contratos' then
      if tg_op = 'INSERT' then
        v_evento := 'contrato.criado';
      elsif j ->> 'status' in ('encerrado','rescindido') and (o ->> 'status') is distinct from (j ->> 'status')
            and coalesce(o ->> 'status', '') not in ('encerrado','rescindido') then
        v_evento := 'contrato.encerrado';
      end if;
      v_payload := jsonb_build_object('id', j -> 'id', 'numero', j -> 'numero', 'codigo', j -> 'codigo', 'imovel_id', j -> 'imovel_id',
                                      'status', j -> 'status', 'data_inicio', j -> 'data_inicio', 'data_fim', j -> 'data_fim',
                                      'data_rescisao', j -> 'data_rescisao', 'valor_aluguel', j -> 'valor_aluguel', 'dia_vencimento', j -> 'dia_vencimento');
    elsif tg_table_name = 'faturas' then
      if tg_op = 'INSERT' then
        v_evento := 'fatura.criada';
      elsif j ->> 'status' = 'paga' and (o ->> 'status') is distinct from 'paga' then
        v_evento := 'fatura.paga';
      end if;
      v_payload := jsonb_build_object('id', j -> 'id', 'numero', j -> 'numero', 'contrato_id', j -> 'contrato_id', 'competencia', j -> 'competencia',
                                      'vencimento', j -> 'vencimento', 'valor_total', j -> 'valor_total', 'status', j -> 'status',
                                      'pago_em', j -> 'pago_em', 'valor_pago', j -> 'valor_pago', 'forma_pagamento', j -> 'forma_pagamento');
    elsif tg_table_name = 'fatura_pagamentos' and tg_op = 'INSERT' then
      v_evento := 'pagamento.recebido';
      v_payload := jsonb_build_object('id', j -> 'id', 'fatura_id', j -> 'fatura_id', 'pago_em', j -> 'pago_em', 'valor', j -> 'valor',
                                      'principal', j -> 'principal', 'multa', j -> 'multa', 'juros', j -> 'juros', 'desconto', j -> 'desconto',
                                      'forma', j -> 'forma', 'origem', j -> 'origem');
    elsif tg_table_name = 'chamados' then
      if tg_op = 'INSERT' then
        v_evento := 'chamado.aberto';
      elsif j ->> 'status' = 'concluido' and (o ->> 'status') is distinct from 'concluido' then
        v_evento := 'chamado.concluido';
      end if;
      v_payload := jsonb_build_object('id', j -> 'id', 'numero', j -> 'numero', 'imovel_id', j -> 'imovel_id', 'contrato_id', j -> 'contrato_id',
                                      'titulo', j -> 'titulo', 'categoria', j -> 'categoria', 'urgencia', j -> 'urgencia', 'status', j -> 'status',
                                      'origem', j -> 'origem', 'concluido_em', j -> 'concluido_em', 'valor_final', j -> 'valor_final');
    elsif tg_table_name = 'documentos' and tg_op = 'UPDATE' and j ->> 'status' = 'assinado' and (o ->> 'status') is distinct from 'assinado' then
      v_evento := 'documento.assinado';
      v_payload := jsonb_build_object('id', j -> 'id', 'numero', j -> 'numero', 'titulo', j -> 'titulo', 'tipo', j -> 'tipo',
                                      'contrato_id', j -> 'contrato_id', 'imovel_id', j -> 'imovel_id', 'assinado_em', j -> 'assinado_em');
    end if;
    if v_evento is not null then
      perform privado.webhook_enfileirar(v_org, v_evento, (j ->> 'id')::uuid, jsonb_strip_nulls(v_payload));
    end if;
  exception when others then
    raise warning 'webhook (%): %', tg_table_name, sqlerrm;
  end;
  return null;
end;
$$;
revoke execute on function privado.webhook_evento() from public, anon, authenticated;

create or replace trigger leads_webhook_trg after insert on public.leads
  for each row execute function privado.webhook_evento();
create or replace trigger propostas_webhook_trg after insert on public.propostas
  for each row execute function privado.webhook_evento();
create or replace trigger visitas_webhook_trg after insert on public.visitas
  for each row execute function privado.webhook_evento();
create or replace trigger imoveis_webhook_trg after insert or update on public.imoveis
  for each row execute function privado.webhook_evento();
create or replace trigger contratos_webhook_trg after insert or update of status on public.contratos
  for each row execute function privado.webhook_evento();
create or replace trigger faturas_webhook_trg after insert or update of status on public.faturas
  for each row execute function privado.webhook_evento();
create or replace trigger fatura_pagamentos_webhook_trg after insert on public.fatura_pagamentos
  for each row execute function privado.webhook_evento();
create or replace trigger chamados_webhook_trg after insert or update of status on public.chamados
  for each row execute function privado.webhook_evento();
create or replace trigger documentos_webhook_trg after update of status on public.documentos
  for each row execute function privado.webhook_evento();

/** Novo webhook (só admin). O segredo de assinatura volta uma única vez. */
create or replace function public.webhook_criar(p_nome text, p_url text, p_eventos text[])
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_id uuid;
  v_seg text;
begin
  if v_org is null or not privado.integracoes_pode(v_org, true) then
    raise exception 'Só o administrador cria webhooks.';
  end if;
  if (select count(*) from webhook_assinaturas where organizacao_id = v_org) >= 20 then
    raise exception 'Limite de 20 webhooks por conta.';
  end if;
  if p_eventos is null or not (p_eventos <@ privado.webhook_eventos()) or cardinality(p_eventos) = 0 then
    raise exception 'Escolha pelo menos um evento da lista.';
  end if;
  insert into webhook_assinaturas (organizacao_id, nome, url, eventos)
  values (v_org, p_nome, p_url, p_eventos)
  returning id into v_id;
  v_seg := 'whsec_' || privado.hex_aleatorio(48);
  insert into privado.webhook_segredos (assinatura_id, segredo) values (v_id, v_seg);
  return jsonb_build_object('id', v_id, 'segredo', v_seg);
end;
$$;
revoke execute on function public.webhook_criar(text, text, text[]) from public;
grant execute on function public.webhook_criar(text, text, text[]) to authenticated;

create or replace function public.webhook_trocar_segredo(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_seg text := 'whsec_' || privado.hex_aleatorio(48);
begin
  select organizacao_id into v_org from webhook_assinaturas where id = p_id;
  if v_org is null or v_org not in (select privado.org_ids()) or not privado.integracoes_pode(v_org, true) then
    raise exception 'Webhook não encontrado ou sem permissão.';
  end if;
  insert into privado.webhook_segredos (assinatura_id, segredo) values (p_id, v_seg)
  on conflict (assinatura_id) do update set segredo = excluded.segredo, created_at = now();
  insert into auditoria (organizacao_id, usuario_id, tabela, registro_id, acao, campos)
  values (v_org, auth.uid(), 'webhook_assinaturas', p_id::text, 'update', array['segredo']);
  return jsonb_build_object('segredo', v_seg);
end;
$$;
revoke execute on function public.webhook_trocar_segredo(uuid) from public;
grant execute on function public.webhook_trocar_segredo(uuid) to authenticated;

/** Põe um evento de teste na fila deste webhook e devolve o id da entrega (o servidor entrega essa na hora). */
create or replace function public.webhook_enviar_teste(p_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  w webhook_assinaturas%rowtype;
  v_id uuid;
begin
  select * into w from webhook_assinaturas where id = p_id;
  if not found or w.organizacao_id not in (select privado.org_ids()) or not privado.integracoes_pode(w.organizacao_id, true) then
    raise exception 'Webhook não encontrado ou sem permissão.';
  end if;
  if not w.ativo then
    raise exception 'O webhook está pausado. Reative antes de testar.';
  end if;
  insert into webhook_entregas (organizacao_id, assinatura_id, evento, recurso_id, payload, teste)
  values (w.organizacao_id, w.id, 'webhook.teste', null,
          jsonb_build_object('mensagem', 'Teste do Novo Aluguel: se você recebeu, está tudo certo.', 'webhook_id', w.id), true)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.webhook_enviar_teste(uuid) from public;
grant execute on function public.webhook_enviar_teste(uuid) to authenticated;

create or replace function public.webhook_reprocessar(p_entrega uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  e webhook_entregas%rowtype;
begin
  select * into e from webhook_entregas where id = p_entrega;
  if not found or e.organizacao_id not in (select privado.org_ids()) or not privado.integracoes_pode(e.organizacao_id, true) then
    raise exception 'Entrega não encontrada ou sem permissão.';
  end if;
  if e.status = 'pendente' then
    raise exception 'Esta entrega ainda está na fila.';
  end if;
  update webhook_entregas
     set status = 'pendente', tentativas = 0, proxima_tentativa = now(), travada_ate = null, erro = null,
         reprocessada_em = now(), reprocessada_por = auth.uid()
   where id = e.id;
end;
$$;
revoke execute on function public.webhook_reprocessar(uuid) from public;
grant execute on function public.webhook_reprocessar(uuid) to authenticated;

/**
 * Lote de entregas vencidas da organização de quem chama (administrador ou
 * gestor: as mesmas pessoas que podem ler a fila; o servidor dispara em segundo
 * plano quando eles usam o sistema). Marca a tentativa, "segura" a linha por 2
 * minutos e devolve o corpo pronto e a assinatura HMAC-SHA256 calculada aqui
 * dentro (o segredo não sai do banco). Para os demais papéis devolve vazio.
 * p_entrega: só aquela entrega (o "Enviar teste" e o "Reprocessar" entregam a
 * que acabaram de pôr na fila, sem esperar as mais antigas).
 * Entrega que já gastou as 6 tentativas sem resultado gravado (erro ao gravar,
 * função cortada no meio) vira "desistiu" aqui, em vez de sair de novo para sempre.
 */
create or replace function public.webhook_lote(p_limite integer default 5, p_entrega uuid default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_lim integer := least(greatest(coalesce(p_limite, 5), 1), 20);
  v_out jsonb := '[]'::jsonb;
  v_corpo text;
  v_seg text;
  v_n integer;
begin
  if auth.uid() is null then
    return v_out;
  end if;
  for r in
    select e.id, e.organizacao_id, e.assinatura_id, e.evento, e.payload, e.criado_em, e.tentativas, s.url
      from webhook_entregas e
      join webhook_assinaturas s on s.id = e.assinatura_id
     where e.organizacao_id in (select o from privado.org_ids() o where privado.integracoes_pode(o, false))
       and (p_entrega is null or e.id = p_entrega)
       and e.status in ('pendente','falhou')
       and e.proxima_tentativa <= now()
       and (e.travada_ate is null or e.travada_ate < now())
       and s.ativo
     order by e.proxima_tentativa, e.criado_em
     limit v_lim
     for update of e skip locked
  loop
    if r.tentativas >= 6 then
      update webhook_entregas
         set status = 'desistiu', travada_ate = null,
             erro = coalesce(erro, 'Sem resposta registrada depois de 6 tentativas.')
       where id = r.id;
      continue;
    end if;
    select segredo into v_seg from privado.webhook_segredos where assinatura_id = r.assinatura_id;
    if v_seg is null then
      update webhook_entregas set status = 'desistiu', erro = 'Webhook sem segredo de assinatura: troque o segredo.' where id = r.id;
      continue;
    end if;
    v_n := r.tentativas + 1;
    update webhook_entregas set tentativas = v_n, travada_ate = now() + interval '2 minutes', ultima_tentativa_em = now() where id = r.id;
    v_corpo := jsonb_build_object('id', r.id, 'evento', r.evento, 'criado_em', r.criado_em, 'enviado_em', now(),
                                  'tentativa', v_n, 'organizacao_id', r.organizacao_id, 'dados', r.payload)::text;
    v_out := v_out || jsonb_build_array(jsonb_build_object(
      'id', r.id, 'url', r.url, 'evento', r.evento, 'tentativa', v_n, 'corpo', v_corpo,
      'assinatura', 'sha256=' || encode(privado.mkt_hmac_sha256(convert_to(v_corpo, 'UTF8'), convert_to(v_seg, 'UTF8')), 'hex')));
  end loop;
  return v_out;
end;
$$;
revoke execute on function public.webhook_lote(integer, uuid) from public;
grant execute on function public.webhook_lote(integer, uuid) to authenticated;

/** Resultado de uma tentativa: 2xx = entregue; senão nova tentativa com espera crescente (6 no total). */
create or replace function public.webhook_resultado(p_entrega uuid, p_status integer, p_trecho text default null, p_erro text default null)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  e webhook_entregas%rowtype;
  v_novo text;
begin
  select * into e from webhook_entregas
   where id = p_entrega and organizacao_id in (select o from privado.org_ids() o where privado.integracoes_pode(o, false))
   for update;
  if not found or e.travada_ate is null or e.status not in ('pendente','falhou') then
    return null;
  end if;
  if p_status between 200 and 299 then
    update webhook_entregas
       set status = 'entregue', entregue_em = now(), travada_ate = null, resposta_status = p_status,
           resposta_trecho = left(p_trecho, 500), erro = null
     where id = e.id;
    begin
      update webhook_assinaturas set falhas_seguidas = 0, ultima_entrega_em = now(), ultimo_status = p_status where id = e.assinatura_id;
    exception when others then
      null; -- o placar do webhook nunca desfaz o registro da entrega
    end;
    return 'entregue';
  end if;
  v_novo := case when e.tentativas >= 6 then 'desistiu' else 'falhou' end;
  update webhook_entregas
     set status = v_novo, travada_ate = null, resposta_status = p_status, resposta_trecho = left(p_trecho, 500),
         erro = left(coalesce(p_erro, case when p_status is not null then 'Resposta HTTP ' || p_status end), 500),
         proxima_tentativa = now() + make_interval(mins => privado.webhook_atraso_min(e.tentativas))
   where id = e.id;
  begin
    update webhook_assinaturas
       set falhas_seguidas = falhas_seguidas + 1,
           ultimo_status = p_status,
           pausada_motivo = case when ativo and falhas_seguidas + 1 >= 50
                                 then 'Pausado sozinho depois de 50 falhas seguidas. Confira o endereço e reative.' else pausada_motivo end,
           ativo = case when falhas_seguidas + 1 >= 50 then false else ativo end
     where id = e.assinatura_id;
  exception when others then
    null; -- o placar do webhook nunca desfaz o registro da entrega
  end;
  return v_novo;
end;
$$;
revoke execute on function public.webhook_resultado(uuid, integer, text, text) from public;
grant execute on function public.webhook_resultado(uuid, integer, text, text) to authenticated;

/** "Disparar teste" pela API (escopo webhooks:escrita). */
create or replace function public.api_v1_webhook_teste(p_chave text, p_params jsonb default '{}'::jsonb, p_ip text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a jsonb;
  v_org uuid;
  v_id uuid;
  v_n integer;
begin
  a := privado.api_autenticar(p_chave, 'webhooks:escrita', 'POST', 'webhooks', p_ip);
  if not coalesce((a ->> 'ok')::boolean, false) then
    return a;
  end if;
  v_org := (a ->> 'org')::uuid;
  if jsonb_typeof(p_params) = 'object' and p_params ? 'assinatura_id' then
    if (p_params ->> 'assinatura_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
       or not exists (select 1 from webhook_assinaturas where id = (p_params ->> 'assinatura_id')::uuid and organizacao_id = v_org and ativo) then
      perform privado.api_registrar(a, 'POST', 'webhooks', 404, p_ip);
      return privado.api_erro(404, 'nao_encontrado', 'Webhook ativo não encontrado.');
    end if;
    v_id := (p_params ->> 'assinatura_id')::uuid;
  end if;
  v_n := privado.webhook_enfileirar(v_org, 'webhook.teste', null,
           jsonb_build_object('mensagem', 'Teste pedido pela API do Novo Aluguel.', 'chave', a ->> 'prefixo'), v_id);
  perform privado.api_registrar(a, 'POST', 'webhooks', 202, p_ip);
  return jsonb_build_object('status', 202, 'dados', jsonb_build_object('enfileiradas', v_n));
end;
$$;
revoke execute on function public.api_v1_webhook_teste(text, jsonb, text) from public;
grant execute on function public.api_v1_webhook_teste(text, jsonb, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Monitoramento (somas no banco: nada de cortar em 1.000 linhas)
-- -----------------------------------------------------------------------------
create or replace function public.integracoes_resumo(p_desde timestamptz default now() - interval '7 days')
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
begin
  if v_org is null or not privado.integracoes_pode(v_org, false) then
    raise exception 'Só administrador e gestor veem o monitoramento das integrações.';
  end if;
  return jsonb_build_object(
    'entregas', coalesce((select jsonb_object_agg(status, n) from (
        select status, count(*) n from webhook_entregas where organizacao_id = v_org and criado_em >= p_desde group by status) x), '{}'::jsonb),
    'fila', (select count(*) from webhook_entregas where organizacao_id = v_org and status in ('pendente','falhou')),
    'por_webhook', coalesce((select jsonb_agg(jsonb_build_object('assinatura_id', assinatura_id, 'entregues', entregues, 'falhas', falhas, 'desistiu', desistiu, 'fila', fila))
        from (select assinatura_id,
                     count(*) filter (where status = 'entregue') entregues,
                     count(*) filter (where status = 'falhou') falhas,
                     count(*) filter (where status = 'desistiu') desistiu,
                     count(*) filter (where status = 'pendente') fila
                from webhook_entregas where organizacao_id = v_org and criado_em >= p_desde group by assinatura_id) x), '[]'::jsonb),
    'api_total', (select count(*) from api_uso where organizacao_id = v_org and criado_em >= p_desde),
    'api_erros', (select count(*) from api_uso where organizacao_id = v_org and criado_em >= p_desde and status >= 400),
    'api_por_status', coalesce((select jsonb_object_agg(status::text, n) from (
        select status, count(*) n from api_uso where organizacao_id = v_org and criado_em >= p_desde group by status) x), '{}'::jsonb),
    'api_por_chave', coalesce((select jsonb_agg(jsonb_build_object('chave_id', chave_id, 'prefixo', prefixo, 'total', total, 'erros', erros, 'ultimo', ultimo) order by total desc)
        from (select chave_id, max(prefixo) prefixo, count(*) total, count(*) filter (where status >= 400) erros, max(criado_em) ultimo
                from api_uso where organizacao_id = v_org and criado_em >= p_desde group by chave_id) x), '[]'::jsonb),
    'api_por_recurso', coalesce((select jsonb_object_agg(recurso, n) from (
        select recurso, count(*) n from api_uso where organizacao_id = v_org and criado_em >= p_desde group by recurso) x), '{}'::jsonb)
  );
end;
$$;
revoke execute on function public.integracoes_resumo(timestamptz) from public;
grant execute on function public.integracoes_resumo(timestamptz) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Armazenamento: uso por área e lista para a exportação. Entram a pasta da
--     conta (<organização>/...) e os documentos que o candidato mandou pela
--     ficha online (analises: ficha/<token>/...), que não têm o id da conta no
--     caminho — mesma regra de privado.analise_arquivo_da_org, só que presa à
--     organização atual.
-- -----------------------------------------------------------------------------
create or replace function privado.integracoes_ficha_da_org(p_org uuid, p_path text, p_criado timestamptz)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_token text := split_part(coalesce(p_path, ''), '/', 2);
  v_uuid boolean := split_part(coalesce(p_path, ''), '/', 2) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if split_part(coalesce(p_path, ''), '/', 1) <> 'ficha' then
    return false;
  end if;
  -- Registrado na análise desta conta (e a pasta não é do link atual de outra conta).
  if exists (select 1 from analise_arquivos f where f.path = p_path and f.organizacao_id = p_org)
     and not (v_uuid and exists (select 1 from analises x where x.token = v_token::uuid and x.organizacao_id <> p_org)) then
    return true;
  end if;
  if not v_uuid then
    return false;
  end if;
  -- Pelo link atual desta conta, só o que subiu depois que a análise ganhou esse link.
  return exists (select 1 from analises a
                  where a.token = v_token::uuid and a.organizacao_id = p_org
                    and (p_criado is null or p_criado >= coalesce(a.token_desde, a.created_at)));
end;
$$;
revoke execute on function privado.integracoes_ficha_da_org(uuid, text, timestamptz) from public, anon, authenticated;

create or replace function public.integracoes_uso_armazenamento()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v jsonb;
begin
  if v_org is null or not privado.integracoes_pode(v_org, false) then
    raise exception 'Só administrador e gestor veem o uso do armazenamento.';
  end if;
  if to_regclass('storage.objects') is null then
    return '[]'::jsonb;
  end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object('bucket', bucket_id, 'arquivos', n, 'bytes', b) order by b desc), '[]'::jsonb)
      from (select bucket_id, count(*) as n, coalesce(sum(case when metadata ->> 'size' ~ '^\d+$' then (metadata ->> 'size')::bigint end), 0) as b
              from storage.objects
             where split_part(name, '/', 1) = $1
                or (bucket_id = 'analises' and split_part(name, '/', 1) = 'ficha'
                    and privado.integracoes_ficha_da_org($1::uuid, name, created_at))
             group by bucket_id) x
  $q$ into v using v_org::text;
  return v;
end;
$$;
revoke execute on function public.integracoes_uso_armazenamento() from public;
grant execute on function public.integracoes_uso_armazenamento() to authenticated;

/** Arquivos da conta num bucket (pasta da conta e, em análises, os da ficha online), em ordem de nome, em partes (para a exportação .zip). Só admin. */
create or replace function public.integracoes_arquivos(p_bucket text, p_pular integer default 0, p_limite integer default 150)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v jsonb;
begin
  if v_org is null or not privado.integracoes_pode(v_org, true) then
    raise exception 'Só o administrador exporta os arquivos.';
  end if;
  if to_regclass('storage.objects') is null then
    return '[]'::jsonb;
  end if;
  execute $q$
    select coalesce(jsonb_agg(jsonb_build_object('nome', name, 'bytes', coalesce(case when metadata ->> 'size' ~ '^\d+$' then (metadata ->> 'size')::bigint end, 0)) order by name), '[]'::jsonb)
      from (select name, metadata from storage.objects
             where bucket_id = $1
               and (split_part(name, '/', 1) = $2
                    or ($1 = 'analises' and split_part(name, '/', 1) = 'ficha'
                        and privado.integracoes_ficha_da_org($2::uuid, name, created_at)))
             order by name offset $3 limit $4) x
  $q$ into v using p_bucket, v_org::text, greatest(coalesce(p_pular, 0), 0), least(greatest(coalesce(p_limite, 150), 1), 500);
  return v;
end;
$$;
revoke execute on function public.integracoes_arquivos(text, integer, integer) from public;
grant execute on function public.integracoes_arquivos(text, integer, integer) to authenticated;
