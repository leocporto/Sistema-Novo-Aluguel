-- =============================================================================
-- Site imobiliário e portais (só no modo imobiliária).
-- - site_config: endereço (slug), marca, cores, textos, contatos, GA4, domínio
--   próprio e o token dos portais;
-- - site público anônimo lê SÓ por funções security definer (site_*), que
--   devolvem apenas imóveis marcados para o site e disponíveis;
-- - contato, agendamento de visita e "Anuncie seu imóvel" gravam pela
--   receber_lead (mesma entrada do formulário /l/[token]) + site_solicitacoes;
-- - portais (ZAP, Viva Real, OLX): configuração, controle imóvel × portal,
--   registro de cada geração do feed e leads recebidos por webhook;
-- - fotos: o bucket "imoveis" continua privado; o papel anon só lê arquivos
--   de imóveis publicados (função site_arquivo_publico na policy do Storage).
-- Sem DROP: tudo é create if not exists / create or replace.
-- =============================================================================

-- 1) Configuração do site -----------------------------------------------------
create table if not exists public.site_config (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  slug text not null,
  ativo boolean not null default false,
  nome text,
  slogan text,
  logo_path text,
  cor_primaria text not null default '#2563eb',
  cor_secundaria text not null default '#0f172a',
  titulo_home text,
  subtitulo_home text,
  sobre text,
  telefone text,
  whatsapp text,
  email text,
  endereco text,
  creci text,
  instagram text,
  facebook text,
  youtube text,
  ga4_id text,
  dominio text,
  dominio_verificado_em timestamptz,
  seo_titulo text,
  seo_descricao text,
  mostrar_endereco boolean not null default false,
  captacao_ativa boolean not null default true,
  agendamento_ativo boolean not null default true,
  portais_token uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now(),
  atualizado_em timestamptz not null default now(),
  constraint site_config_org_unica unique (organizacao_id),
  constraint site_config_slug_unico unique (slug),
  constraint site_config_slug_check check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  constraint site_config_cores_check check (cor_primaria ~ '^#[0-9a-fA-F]{6}$' and cor_secundaria ~ '^#[0-9a-fA-F]{6}$'),
  constraint site_config_ga4_check check (ga4_id is null or ga4_id ~ '^G-[A-Z0-9]{4,15}$'),
  constraint site_config_dominio_check check (dominio is null or dominio ~ '^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,24}$')
);
-- Domínio próprio: NÃO é único no banco. Quem prova a posse é o registro TXT
-- "_novoaluguel.<domínio>" com o código do site (id do site_config), conferido
-- na verificação e de novo pelo proxy antes de abrir o site no domínio. Assim
-- ninguém "reserva" o domínio de outra imobiliária só por cadastrá-lo antes.
create index if not exists site_config_dominio_busca_idx on public.site_config (lower(dominio)) where dominio is not null;
create unique index if not exists site_config_portais_token_idx on public.site_config (portais_token);

create or replace function privado.site_config_tocar()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.atualizado_em := now();
  -- Trocou o domínio sem verificar de novo: a verificação anterior deixa de valer.
  if new.dominio is distinct from old.dominio and new.dominio_verificado_em is not distinct from old.dominio_verificado_em then
    new.dominio_verificado_em := null;
  end if;
  return new;
end;
$$;
create or replace trigger site_config_tocar_trg before update on public.site_config
  for each row execute function privado.site_config_tocar();

-- 2) Portais: configuração por portal, controle imóvel × portal e envios ------
create table if not exists public.site_portais (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  portal text not null check (portal in ('zap','vivareal','olx')),
  ativo boolean not null default false,
  -- true: todo imóvel publicado no site vai para o portal (salvo exceção por imóvel)
  publicar_todos boolean not null default true,
  codigo_anunciante text,
  limite_anuncios int check (limite_anuncios is null or limite_anuncios >= 0),
  limite_destaques int check (limite_destaques is null or limite_destaques >= 0),
  observacoes text,
  created_at timestamptz not null default now(),
  constraint site_portais_unico unique (organizacao_id, portal)
);

create table if not exists public.portal_imoveis (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  portal text not null check (portal in ('zap','vivareal','olx')),
  -- null = automático (segue o site e a configuração do portal); true/false = escolha manual
  publicado boolean,
  destaque text not null default 'normal' check (destaque in ('normal','destaque','super_destaque')),
  codigo_portal text,
  url text,
  ultima_sincronizacao timestamptz,
  verificado_em timestamptz,
  ultimo_status text check (ultimo_status in ('enviado','falha','fora_do_limite','fora')),
  ultimas_falhas text[] not null default '{}',
  created_at timestamptz not null default now(),
  constraint portal_imoveis_unico unique (imovel_id, portal)
);
create index if not exists portal_imoveis_status_idx on public.portal_imoveis (organizacao_id, portal, ultimo_status);

-- O controle imóvel × portal é sempre da organização DONA do imóvel: sem isso uma
-- imobiliária poderia gravar uma linha para o imóvel de outra (os ids aparecem no
-- site público) e tirar ou forçar o imóvel no feed alheio.
create or replace function privado.portal_imoveis_conferir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizacao_id into v_org from public.imoveis where id = new.imovel_id;
  if v_org is null or v_org is distinct from new.organizacao_id then
    raise exception 'Imóvel não encontrado.';
  end if;
  return new;
end;
$$;
create or replace trigger portal_imoveis_conferir_trg before insert or update of organizacao_id, imovel_id on public.portal_imoveis
  for each row execute function privado.portal_imoveis_conferir();

-- Registro de cada geração do feed (só leitura no sistema; grava pela função).
create table if not exists public.portal_sincronizacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  portal text not null check (portal in ('zap','vivareal','olx')),
  origem text not null default 'portal' check (origem in ('portal','manual')),
  gerado_em timestamptz not null default now(),
  total_elegiveis int not null default 0,
  total_enviados int not null default 0,
  total_falhas int not null default 0,
  total_fora_limite int not null default 0,
  falhas jsonb not null default '[]'::jsonb,
  agente text
);
create index if not exists portal_sincronizacoes_idx on public.portal_sincronizacoes (organizacao_id, portal, gerado_em desc);

-- Tudo que chega pelo site (contato, visita, anúncio, empreendimento) e pelos portais.
create table if not exists public.site_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  tipo text not null check (tipo in ('contato','visita','captacao','empreendimento','portal')),
  origem text not null default 'site',
  nome text,
  telefone text,
  email text,
  mensagem text,
  imovel_id uuid references public.imoveis(id) on delete set null,
  empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  captacao_id uuid references public.captacoes(id) on delete set null,
  visita_id uuid references public.visitas(id) on delete set null,
  visita_em timestamptz,
  duplicado boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists site_solicitacoes_data_idx on public.site_solicitacoes (organizacao_id, created_at desc);

-- 3) Empreendimentos e lançamentos no site -----------------------------------
alter table public.empreendimentos
  add column if not exists publicar_site boolean not null default false,
  add column if not exists fase text,
  add column if not exists previsao_entrega date,
  add column if not exists descricao_site text,
  add column if not exists video_url text,
  add column if not exists tour_url text;
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'empreendimentos_fase_check') then
    alter table public.empreendimentos add constraint empreendimentos_fase_check
      check (fase is null or fase in ('lancamento','em_obras','pronto'));
  end if;
end $$;

-- Foto pública é procurada pelo caminho (policy do Storage).
create index if not exists imovel_midias_path_idx on public.imovel_midias (path);

-- Anúncios do imóvel (aba Histórico): o feed dos portais abre e encerra sozinho
-- o anúncio de cada portal (origem 'feed'); os registrados à mão são 'manual'.
alter table public.imovel_anuncios add column if not exists origem text not null default 'manual';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'imovel_anuncios_origem_check') then
    alter table public.imovel_anuncios add constraint imovel_anuncios_origem_check check (origem in ('manual','feed'));
  end if;
end $$;
create index if not exists imovel_anuncios_feed_idx on public.imovel_anuncios (organizacao_id, portal, imovel_id) where origem = 'feed';

/**
 * O arquivo é mesmo do imóvel? O caminho no bucket "imoveis" é sempre
 * <organizacao_id>/<imovel_id>/<arquivo>. Sem esta conferência, uma mídia
 * cadastrada com o caminho de um arquivo de outra pasta (ex.: documento
 * privado) viraria "foto pública".
 */
create or replace function privado.caminho_do_imovel(p_path text, p_org uuid, p_imovel uuid)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_path is not null
     and starts_with(p_path, p_org::text || '/' || p_imovel::text || '/')
     and position('..' in p_path) = 0
     and position('//' in p_path) = 0
$$;

-- 4) RLS ------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['site_config','site_portais','portal_imoveis','portal_sincronizacoes','site_solicitacoes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
  end loop;
  foreach t in array array['site_config','site_portais','portal_imoveis'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_org') then
      execute format($p$create policy %I on public.%I for all to authenticated
        using (organizacao_id in (select privado.org_ids()))
        with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
    end if;
  end loop;
  -- Histórico de envios: só leitura (grava pela função portal_registrar).
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'portal_sincronizacoes' and policyname = 'portal_sincronizacoes_ler') then
    create policy portal_sincronizacoes_ler on public.portal_sincronizacoes for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
  -- Solicitações: leitura e exclusão (LGPD); entram só pela função site_contato.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_solicitacoes' and policyname = 'site_solicitacoes_ler') then
    create policy site_solicitacoes_ler on public.site_solicitacoes for select to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'site_solicitacoes' and policyname = 'site_solicitacoes_apagar') then
    create policy site_solicitacoes_apagar on public.site_solicitacoes for delete to authenticated
      using (organizacao_id in (select privado.org_ids()));
  end if;
end $$;

-- 5) Leitura pública (anônima) do site ------------------------------------------

/**
 * O arquivo do bucket "imoveis" pode ser visto por qualquer pessoa? Só foto/planta
 * de imóvel publicado, cadastrada pela própria dona do imóvel e guardada na pasta
 * desse imóvel (<organizacao_id>/<imovel_id>/...).
 */
create or replace function public.site_arquivo_publico(p_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.imovel_midias m
      join public.imoveis i on i.id = m.imovel_id and i.organizacao_id = m.organizacao_id
      join public.organizacoes o on o.id = i.organizacao_id and o.modo = 'imobiliaria'
     where m.path = p_path
       and privado.caminho_do_imovel(m.path, i.organizacao_id, i.id)
       and m.tipo in ('foto','planta')
       and i.status in ('disponivel','reservado')
       and (
         (i.publicar_site and exists (select 1 from public.site_config s where s.organizacao_id = i.organizacao_id and s.ativo))
         or (i.status = 'disponivel' and exists (
           select 1
             from public.site_portais sp
             left join public.portal_imoveis pi on pi.imovel_id = i.id and pi.portal = sp.portal and pi.organizacao_id = i.organizacao_id
            where sp.organizacao_id = i.organizacao_id and sp.ativo
              and coalesce(pi.publicado, sp.publicar_todos and i.publicar_site)))
       )
  )
$$;

/** Dados públicos do site (marca, textos, contatos). Nulo se o site não estiver no ar. */
create or replace function public.site_info(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'slug', s.slug,
    'nome', coalesce(nullif(btrim(s.nome), ''), o.nome),
    'slogan', s.slogan,
    'logo_path', s.logo_path,
    'cor_primaria', s.cor_primaria,
    'cor_secundaria', s.cor_secundaria,
    'titulo_home', s.titulo_home,
    'subtitulo_home', s.subtitulo_home,
    'sobre', s.sobre,
    'telefone', coalesce(s.telefone, o.telefone),
    'whatsapp', s.whatsapp,
    'email', coalesce(s.email, o.email),
    'endereco', s.endereco,
    'creci', coalesce(s.creci, o.creci),
    'instagram', s.instagram,
    'facebook', s.facebook,
    'youtube', s.youtube,
    'ga4_id', s.ga4_id,
    'dominio', case when s.dominio_verificado_em is not null then s.dominio end,
    'seo_titulo', s.seo_titulo,
    'seo_descricao', s.seo_descricao,
    'mostrar_endereco', s.mostrar_endereco,
    'captacao_ativa', s.captacao_ativa,
    'agendamento_ativo', s.agendamento_ativo,
    'tem_empreendimentos', exists (select 1 from public.empreendimentos e where e.organizacao_id = s.organizacao_id and e.publicar_site),
    'atualizado_em', s.atualizado_em
  )
    from public.site_config s
    join public.organizacoes o on o.id = s.organizacao_id
   where s.slug = lower(btrim(p_slug)) and s.ativo and o.modo = 'imobiliaria'
$$;

/** Catálogo: imóveis marcados para o site e disponíveis (endereço exato só se a imobiliária permitir). */
create or replace function public.site_imoveis(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(x.j order by x.criado desc), '[]'::jsonb)
    from (
      select i.created_at as criado,
             jsonb_build_object(
               'id', i.id, 'codigo', i.codigo, 'titulo', i.titulo, 'tipo', i.tipo, 'finalidades', i.finalidades, 'status', i.status,
               'bairro', i.bairro, 'cidade', i.cidade, 'uf', i.uf,
               'logradouro', case when s.mostrar_endereco then i.logradouro end,
               'numero', case when s.mostrar_endereco then i.numero end,
               'cep', case when s.mostrar_endereco then i.cep end,
               'latitude', case when s.mostrar_endereco then i.latitude else round(i.latitude, 3) end,
               'longitude', case when s.mostrar_endereco then i.longitude else round(i.longitude, 3) end,
               'area_util', i.area_util, 'area_total', i.area_total, 'area_construida', i.area_construida, 'area_privativa', i.area_privativa,
               'quartos', i.quartos, 'suites', i.suites, 'banheiros', i.banheiros, 'vagas', i.vagas,
               'valor_venda', i.valor_venda, 'valor_aluguel', i.valor_aluguel, 'valor_condominio', i.valor_condominio, 'valor_iptu', i.valor_iptu,
               'comodidades', i.comodidades, 'caracteristicas', i.caracteristicas,
               'descricao', left(i.descricao, 600),
               'empreendimento_id', case when e.publicar_site then e.id end,
               'empreendimento', case when e.publicar_site then e.nome end,
               'capa', (select jsonb_build_object('id', m.id, 'path', m.path) from public.imovel_midias m
                         where m.imovel_id = i.id and m.tipo = 'foto' and m.organizacao_id = i.organizacao_id
                           and privado.caminho_do_imovel(m.path, i.organizacao_id, i.id)
                         order by m.capa desc, m.ordem, m.created_at limit 1),
               'fotos', (select count(*) from public.imovel_midias m where m.imovel_id = i.id and m.tipo = 'foto' and m.organizacao_id = i.organizacao_id
                           and privado.caminho_do_imovel(m.path, i.organizacao_id, i.id)),
               'criado_em', i.created_at
             ) as j
        from public.site_config s
        join public.organizacoes o on o.id = s.organizacao_id
        join public.imoveis i on i.organizacao_id = s.organizacao_id
        left join public.empreendimentos e on e.id = i.empreendimento_id and e.organizacao_id = i.organizacao_id
       where s.slug = lower(btrim(p_slug)) and s.ativo and o.modo = 'imobiliaria'
         and i.publicar_site and i.status in ('disponivel','reservado')
       order by i.created_at desc
       limit 3000
    ) x
$$;

/** Página do imóvel: tudo do catálogo + descrição completa, vídeo, tour e as fotos/plantas. */
create or replace function public.site_imovel(p_slug text, p_codigo text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
           'id', i.id, 'codigo', i.codigo, 'titulo', i.titulo, 'tipo', i.tipo, 'finalidades', i.finalidades, 'status', i.status,
           'bairro', i.bairro, 'cidade', i.cidade, 'uf', i.uf,
           'logradouro', case when s.mostrar_endereco then i.logradouro end,
           'numero', case when s.mostrar_endereco then i.numero end,
           'cep', case when s.mostrar_endereco then i.cep end,
           'latitude', case when s.mostrar_endereco then i.latitude else round(i.latitude, 3) end,
           'longitude', case when s.mostrar_endereco then i.longitude else round(i.longitude, 3) end,
           'area_util', i.area_util, 'area_total', i.area_total, 'area_construida', i.area_construida, 'area_privativa', i.area_privativa,
           'quartos', i.quartos, 'suites', i.suites, 'banheiros', i.banheiros, 'vagas', i.vagas,
           'valor_venda', i.valor_venda, 'valor_aluguel', i.valor_aluguel, 'valor_condominio', i.valor_condominio, 'valor_iptu', i.valor_iptu,
           'comodidades', i.comodidades, 'caracteristicas', i.caracteristicas,
           'descricao', i.descricao, 'video_url', i.video_url, 'tour_url', i.tour_url, 'horario_visitas', i.horario_visitas,
           'empreendimento_id', case when e.publicar_site then e.id end,
           'empreendimento', case when e.publicar_site then e.nome end,
           'midias', coalesce((select jsonb_agg(jsonb_build_object('id', m.id, 'path', m.path, 'tipo', m.tipo, 'nome', m.nome)
                                                order by m.tipo, m.capa desc, m.ordem, m.created_at)
                                 from public.imovel_midias m where m.imovel_id = i.id and m.tipo in ('foto','planta')
                                  and m.organizacao_id = i.organizacao_id and privado.caminho_do_imovel(m.path, i.organizacao_id, i.id)), '[]'::jsonb),
           'criado_em', i.created_at
         )
    from public.site_config s
    join public.organizacoes o on o.id = s.organizacao_id
    join public.imoveis i on i.organizacao_id = s.organizacao_id
    left join public.empreendimentos e on e.id = i.empreendimento_id and e.organizacao_id = i.organizacao_id
   where s.slug = lower(btrim(p_slug)) and s.ativo and o.modo = 'imobiliaria'
     and lower(i.codigo) = lower(btrim(p_codigo))
     and i.publicar_site and i.status in ('disponivel','reservado')
   limit 1
$$;

/** Empreendimentos e lançamentos publicados (com a foto de capa de uma unidade e o menor preço). */
create or replace function public.site_empreendimentos(p_slug text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', e.id, 'nome', e.nome, 'construtora', e.construtora, 'bairro', e.bairro, 'cidade', e.cidade, 'uf', e.uf,
           'logradouro', case when s.mostrar_endereco then e.logradouro end,
           'numero', case when s.mostrar_endereco then e.numero end,
           'fase', e.fase, 'previsao_entrega', e.previsao_entrega, 'descricao', e.descricao_site,
           'video_url', e.video_url, 'tour_url', e.tour_url,
           'unidades', (select count(*) from public.imoveis i where i.empreendimento_id = e.id and i.organizacao_id = e.organizacao_id and i.publicar_site and i.status in ('disponivel','reservado')),
           'venda_desde', (select min(i.valor_venda) from public.imoveis i where i.empreendimento_id = e.id and i.organizacao_id = e.organizacao_id and i.publicar_site and i.status in ('disponivel','reservado') and i.valor_venda > 0),
           'aluguel_desde', (select min(i.valor_aluguel) from public.imoveis i where i.empreendimento_id = e.id and i.organizacao_id = e.organizacao_id and i.publicar_site and i.status in ('disponivel','reservado') and i.valor_aluguel > 0),
           'capa', (select jsonb_build_object('id', m.id, 'path', m.path)
                      from public.imovel_midias m join public.imoveis i on i.id = m.imovel_id and i.organizacao_id = m.organizacao_id
                     where i.empreendimento_id = e.id and i.organizacao_id = e.organizacao_id and i.publicar_site
                       and i.status in ('disponivel','reservado') and m.tipo = 'foto'
                       and privado.caminho_do_imovel(m.path, i.organizacao_id, i.id)
                     order by m.capa desc, m.ordem, m.created_at limit 1)
         ) order by coalesce(e.fase = 'lancamento', false) desc, e.nome), '[]'::jsonb)
    from public.site_config s
    join public.organizacoes o on o.id = s.organizacao_id
    join public.empreendimentos e on e.organizacao_id = s.organizacao_id
   where s.slug = lower(btrim(p_slug)) and s.ativo and o.modo = 'imobiliaria' and e.publicar_site
$$;

/** Caminho da foto pública (para o link fixo /s/<slug>/foto/<id> usado no Open Graph e nos portais). */
create or replace function public.site_foto(p_slug text, p_midia uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select m.path
    from public.imovel_midias m
    join public.imoveis i on i.id = m.imovel_id and i.organizacao_id = m.organizacao_id
    join public.site_config s on s.organizacao_id = i.organizacao_id
   where s.slug = lower(btrim(p_slug)) and m.id = p_midia and m.tipo in ('foto','planta')
     and privado.caminho_do_imovel(m.path, i.organizacao_id, i.id)
     and public.site_arquivo_publico(m.path)
$$;

/**
 * Sites que dizem ser donos de um domínio próprio (já verificado pela imobiliária).
 * Devolve [{slug, id}] para o proxy conferir no DNS qual deles tem o registro TXT
 * "_novoaluguel.<domínio>" = "novoaluguel-site=<id>" — só esse abre no domínio.
 */
create or replace function public.site_dominio_candidatos(p_dominio text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('slug', s.slug, 'id', s.id) order by s.dominio_verificado_em), '[]'::jsonb)
    from public.site_config s
    join public.organizacoes o on o.id = s.organizacao_id
   where s.dominio is not null and lower(s.dominio) = lower(regexp_replace(btrim(p_dominio), '^www\.', ''))
     and s.dominio_verificado_em is not null
     and s.ativo and o.modo = 'imobiliaria'
$$;

-- 6) Escrita pública: contato, visita, anúncio de imóvel, empreendimento ------
/**
 * Formulários do site. p: { tipo: contato|visita|captacao|empreendimento, nome, telefone, email,
 * mensagem, imovel (código), empreendimento (id), funil, quando (visita, com fuso), e para
 * captação: tipo_imovel, finalidade, cidade, bairro, uf, quartos, area, valor }.
 * Usa a receber_lead (sem repetir lead aberto) e registra em site_solicitacoes.
 */
create or replace function public.site_contato(p_slug text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.site_config%rowtype;
  o public.organizacoes%rowtype;
  v_tipo text := lower(coalesce(p->>'tipo', 'contato'));
  v_imovel public.imoveis%rowtype;
  v_emp public.empreendimentos%rowtype;
  v_quando timestamptz;
  v_funil text;
  v_msg text := left(btrim(coalesce(p->>'mensagem', '')), 1500);
  v_extra text;
  v_res jsonb;
  v_lead uuid;
  v_capt uuid;
  v_visita uuid;
  v_corretor uuid;
begin
  select * into s from public.site_config where slug = lower(btrim(p_slug)) and ativo;
  if not found then raise exception 'Site não encontrado.'; end if;
  select * into o from public.organizacoes where id = s.organizacao_id and modo = 'imobiliaria';
  if not found then raise exception 'Site não encontrado.'; end if;
  if v_tipo not in ('contato','visita','captacao','empreendimento') then v_tipo := 'contato'; end if;
  if v_tipo = 'captacao' and not s.captacao_ativa then raise exception 'Este site não recebe anúncios de imóveis no momento.'; end if;

  if nullif(btrim(p->>'imovel'), '') is not null then
    select * into v_imovel from public.imoveis
     where organizacao_id = s.organizacao_id and lower(codigo) = lower(btrim(p->>'imovel'))
       and publicar_site and status in ('disponivel','reservado')
     limit 1;
  end if;
  if v_tipo = 'empreendimento' then
    begin
      select * into v_emp from public.empreendimentos
       where organizacao_id = s.organizacao_id and id = (p->>'empreendimento')::uuid and publicar_site;
    exception when others then
      v_emp := null;
    end;
    if v_emp.id is null then raise exception 'Empreendimento não encontrado.'; end if;
  end if;

  v_funil := case
    when v_tipo = 'captacao' then 'captacao'
    when p->>'funil' in ('locacao','venda') then p->>'funil'
    when v_tipo = 'empreendimento' then 'venda'
    when v_imovel.id is not null and not ('locacao' = any (v_imovel.finalidades)) then 'venda'
    else 'locacao' end;

  if v_tipo = 'visita' then
    if not s.agendamento_ativo then raise exception 'O agendamento pelo site está desligado. Envie uma mensagem.'; end if;
    if v_imovel.id is null then raise exception 'Escolha o imóvel da visita.'; end if;
    begin
      v_quando := (p->>'quando')::timestamptz;
    exception when others then
      raise exception 'Escolha o dia e o horário da visita.';
    end;
    if v_quando is null then raise exception 'Escolha o dia e o horário da visita.'; end if;
    if v_quando < now() + interval '1 hour' or v_quando > now() + interval '120 days' then
      raise exception 'Escolha um horário a partir de daqui a 1 hora e em até 120 dias.';
    end if;
    if exists (select 1 from public.imovel_indisponibilidades d
                where d.imovel_id = v_imovel.id and v_quando >= d.inicio and v_quando < d.fim) then
      raise exception 'O imóvel não recebe visitas nesse horário. Escolha outro.';
    end if;
    if exists (select 1 from public.visitas v
                where v.imovel_id = v_imovel.id and v.status <> 'cancelada'
                  and v.data_hora > v_quando - interval '45 minutes' and v.data_hora < v_quando + interval '45 minutes') then
      raise exception 'Esse horário já está reservado. Escolha outro.';
    end if;
    v_extra := 'Quer visitar em ' || to_char(v_quando at time zone 'America/Sao_Paulo', 'DD/MM/YYYY "às" HH24:MI') || '.';
  elsif v_tipo = 'empreendimento' then
    v_extra := 'Interesse no empreendimento ' || v_emp.nome || '.';
  elsif v_tipo = 'captacao' then
    v_extra := concat_ws(' · ',
      'Quer anunciar: ' || coalesce(nullif(left(btrim(p->>'tipo_imovel'), 40), ''), 'imóvel'),
      nullif(concat_ws(', ', nullif(left(btrim(p->>'bairro'), 80), ''), nullif(left(btrim(p->>'cidade'), 80), '')), ''),
      case when p->>'finalidade' = 'venda' then 'para vender' when p->>'finalidade' = 'ambos' then 'para vender ou alugar' else 'para alugar' end);
  end if;
  v_msg := concat_ws(E'\n', nullif(v_extra, ''), nullif(v_msg, ''));

  v_res := public.receber_lead(o.leads_token, jsonb_build_object(
    'nome', p->>'nome', 'telefone', p->>'telefone', 'email', p->>'email',
    'mensagem', v_msg, 'origem', 'site', 'funil', v_funil, 'imovel', v_imovel.codigo));

  if coalesce((v_res->>'captacao')::boolean, false) then
    v_capt := (v_res->>'id')::uuid;
    if not coalesce((v_res->>'duplicado')::boolean, false) then
      update public.captacoes set
        tipo = coalesce(nullif(left(btrim(p->>'tipo_imovel'), 40), ''), tipo),
        finalidades = case when p->>'finalidade' = 'venda' then '{venda}'::text[]
                           when p->>'finalidade' = 'ambos' then '{locacao,venda}'::text[]
                           else '{locacao}'::text[] end,
        cidade = nullif(left(btrim(p->>'cidade'), 80), ''),
        bairro = nullif(left(btrim(p->>'bairro'), 80), ''),
        uf = nullif(upper(left(btrim(p->>'uf'), 2)), ''),
        quartos = case when p->>'quartos' ~ '^\d{1,2}$' then (p->>'quartos')::int end,
        area = case when p->>'area' ~ '^\d{1,6}(\.\d{1,2})?$' then (p->>'area')::numeric end,
        valor_pretendido = case when p->>'valor' ~ '^\d{1,12}(\.\d{1,2})?$' then (p->>'valor')::numeric end,
        origem = 'site'
      where id = v_capt;
    end if;
  else
    v_lead := (v_res->>'id')::uuid;
  end if;

  if v_tipo = 'visita' then
    select corretor_id into v_corretor from public.leads where id = v_lead;
    insert into public.visitas (organizacao_id, lead_id, imovel_id, corretor_id, data_hora, status, tipo, titulo,
                                contato_nome, contato_telefone, observacoes, responsavel_id, compartilhada)
    values (s.organizacao_id, v_lead, v_imovel.id, v_corretor, v_quando, 'agendada', 'visita', 'Visita pedida pelo site',
            left(btrim(p->>'nome'), 120), nullif(left(btrim(p->>'telefone'), 40), ''),
            concat_ws(E'\n', 'Pedido pelo site — confirme com o cliente.', nullif(left(btrim(coalesce(p->>'mensagem', '')), 1500), '')),
            null, true)
    returning id into v_visita;
    insert into public.visita_eventos (organizacao_id, visita_id, tipo, descricao, usuario_id)
    values (s.organizacao_id, v_visita, 'criada', 'Pedido pelo site', null);
  end if;

  insert into public.site_solicitacoes (organizacao_id, tipo, origem, nome, telefone, email, mensagem, imovel_id, empreendimento_id,
                                        lead_id, captacao_id, visita_id, visita_em, duplicado)
  values (s.organizacao_id, v_tipo, 'site', left(btrim(p->>'nome'), 120), nullif(left(btrim(p->>'telefone'), 40), ''),
          nullif(lower(left(btrim(p->>'email'), 160)), ''), nullif(v_msg, ''), v_imovel.id, v_emp.id,
          v_lead, v_capt, v_visita, v_quando, coalesce((v_res->>'duplicado')::boolean, false));

  return jsonb_build_object('ok', true, 'tipo', v_tipo, 'duplicado', coalesce((v_res->>'duplicado')::boolean, false));
end;
$$;

-- 7) Portais: feed, registro de envio e leads ---------------------------------

/** Dados do feed de um portal (token secreto da imobiliária). Nulo se o token ou o portal não existirem. */
create or replace function public.portal_feed(p_token uuid, p_portal text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'portal', sp.portal,
    'ativo', sp.ativo,
    'publicar_todos', sp.publicar_todos,
    'codigo_anunciante', sp.codigo_anunciante,
    'limite_anuncios', sp.limite_anuncios,
    'limite_destaques', sp.limite_destaques,
    'site', jsonb_build_object(
      'slug', s.slug, 'ativo', s.ativo, 'nome', coalesce(nullif(btrim(s.nome), ''), o.nome),
      'email', coalesce(s.email, o.email), 'telefone', coalesce(s.whatsapp, s.telefone, o.telefone),
      'mostrar_endereco', s.mostrar_endereco,
      'dominio', case when s.dominio_verificado_em is not null then s.dominio end),
    'imoveis', case when not sp.ativo then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', i.id, 'codigo', i.codigo, 'titulo', i.titulo, 'tipo', i.tipo, 'finalidades', i.finalidades,
               'logradouro', i.logradouro, 'numero', i.numero, 'complemento', i.complemento, 'bairro', i.bairro,
               'cidade', i.cidade, 'uf', i.uf, 'cep', i.cep, 'latitude', i.latitude, 'longitude', i.longitude,
               'area_util', i.area_util, 'area_total', i.area_total, 'area_construida', i.area_construida, 'area_privativa', i.area_privativa,
               'quartos', i.quartos, 'suites', i.suites, 'banheiros', i.banheiros, 'vagas', i.vagas,
               'valor_venda', i.valor_venda, 'valor_aluguel', i.valor_aluguel, 'valor_condominio', i.valor_condominio, 'valor_iptu', i.valor_iptu,
               'comodidades', i.comodidades, 'caracteristicas', i.caracteristicas, 'descricao', i.descricao,
               'video_url', i.video_url, 'tour_url', i.tour_url, 'publicar_site', i.publicar_site,
               'destaque', coalesce(pi.destaque, 'normal'), 'codigo_portal', pi.codigo_portal,
               'fotos', coalesce((select jsonb_agg(m.id order by m.capa desc, m.ordem, m.created_at)
                                    from public.imovel_midias m where m.imovel_id = i.id and m.tipo = 'foto'
                                     and m.organizacao_id = i.organizacao_id and privado.caminho_do_imovel(m.path, i.organizacao_id, i.id)), '[]'::jsonb),
               'plantas', coalesce((select jsonb_agg(m.id order by m.ordem, m.created_at)
                                      from public.imovel_midias m where m.imovel_id = i.id and m.tipo = 'planta'
                                       and m.organizacao_id = i.organizacao_id and privado.caminho_do_imovel(m.path, i.organizacao_id, i.id)), '[]'::jsonb),
               'criado_em', i.created_at,
               'atualizado_em', greatest(i.created_at, (select max(pr.alterado_em) from public.imovel_precos pr where pr.imovel_id = i.id))
             ) order by i.created_at desc)
        from public.imoveis i
        left join public.portal_imoveis pi on pi.imovel_id = i.id and pi.portal = sp.portal and pi.organizacao_id = i.organizacao_id
       where i.organizacao_id = s.organizacao_id and i.status = 'disponivel'
         and coalesce(pi.publicado, sp.publicar_todos and i.publicar_site)), '[]'::jsonb) end
  )
    from public.site_config s
    join public.organizacoes o on o.id = s.organizacao_id
    join public.site_portais sp on sp.organizacao_id = s.organizacao_id and sp.portal = p_portal
   where s.portais_token = p_token and o.modo = 'imobiliaria'
$$;

/**
 * Registra uma geração do feed: o que foi enviado, o que falhou (com os motivos) e o que
 * ficou fora do limite do plano. p: { origem, elegiveis, enviados: [ids], falhas: [{imovel_id,
 * codigo, problemas: []}], fora_limite: [ids], agente }.
 * Também mantém a aba Histórico do imóvel (imovel_anuncios): quem entrou no feed ganha
 * o anúncio do portal "no ar" (origem 'feed', com o preço atual) e quem saiu tem o
 * anúncio do feed encerrado. Anúncios registrados à mão não são mexidos.
 */
create or replace function public.portal_registrar(p_token uuid, p_portal text, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_id uuid;
  v_enviados uuid[];
  v_fora uuid[];
  v_falhas jsonb;
  v_ids_falha uuid[];
  v_nome text := case p_portal when 'zap' then 'ZAP Imóveis' when 'vivareal' then 'VivaReal' when 'olx' then 'OLX' end;
begin
  select s.organizacao_id into v_org
    from public.site_config s join public.organizacoes o on o.id = s.organizacao_id
   where s.portais_token = p_token and o.modo = 'imobiliaria';
  if v_org is null then raise exception 'Link de integração inválido.'; end if;
  if not exists (select 1 from public.site_portais where organizacao_id = v_org and portal = p_portal) then
    raise exception 'Portal não configurado.';
  end if;
  -- Proteção contra excesso de chamadas: no máximo 120 registros por hora por portal.
  if (select count(*) from public.portal_sincronizacoes
       where organizacao_id = v_org and portal = p_portal and gerado_em > now() - interval '1 hour') >= 120 then
    return null;
  end if;

  select coalesce(array_agg(distinct i.id), '{}') into v_enviados
    from public.imoveis i
   where i.organizacao_id = v_org
     and i.id::text in (select jsonb_array_elements_text(coalesce(p->'enviados', '[]'::jsonb)));
  select coalesce(array_agg(distinct i.id), '{}') into v_fora
    from public.imoveis i
   where i.organizacao_id = v_org
     and i.id::text in (select jsonb_array_elements_text(coalesce(p->'fora_limite', '[]'::jsonb)));
  select coalesce(jsonb_agg(f), '[]'::jsonb), coalesce(array_agg(distinct i.id), '{}') into v_falhas, v_ids_falha
    from jsonb_array_elements(coalesce(p->'falhas', '[]'::jsonb)) f
    join public.imoveis i on i.id::text = f->>'imovel_id' and i.organizacao_id = v_org;

  insert into public.portal_sincronizacoes (organizacao_id, portal, origem, total_elegiveis, total_enviados, total_falhas,
                                            total_fora_limite, falhas, agente)
  values (v_org, p_portal, case when p->>'origem' = 'manual' then 'manual' else 'portal' end,
          case when p->>'elegiveis' ~ '^\d{1,6}$' then (p->>'elegiveis')::int else 0 end,
          cardinality(v_enviados), cardinality(v_ids_falha), cardinality(v_fora), v_falhas, left(p->>'agente', 200))
  returning id into v_id;

  insert into public.portal_imoveis (organizacao_id, imovel_id, portal, ultima_sincronizacao, verificado_em, ultimo_status, ultimas_falhas)
  select v_org, x, p_portal, now(), now(), 'enviado', '{}' from unnest(v_enviados) x
  on conflict (imovel_id, portal) do update
    set ultima_sincronizacao = now(), verificado_em = now(), ultimo_status = 'enviado', ultimas_falhas = '{}'
    where public.portal_imoveis.organizacao_id = v_org;

  insert into public.portal_imoveis (organizacao_id, imovel_id, portal, verificado_em, ultimo_status, ultimas_falhas)
  select distinct on (i.id) v_org, i.id, p_portal, now(), 'falha',
         array(select left(t, 200) from jsonb_array_elements_text(coalesce(f->'problemas', '[]'::jsonb)) t limit 20)
    from jsonb_array_elements(v_falhas) f
    join public.imoveis i on i.id::text = f->>'imovel_id' and i.organizacao_id = v_org
  on conflict (imovel_id, portal) do update
    set verificado_em = now(), ultimo_status = 'falha', ultimas_falhas = excluded.ultimas_falhas
    where public.portal_imoveis.organizacao_id = v_org;

  insert into public.portal_imoveis (organizacao_id, imovel_id, portal, verificado_em, ultimo_status, ultimas_falhas)
  select v_org, x, p_portal, now(), 'fora_do_limite', '{}' from unnest(v_fora) x
  on conflict (imovel_id, portal) do update
    set verificado_em = now(), ultimo_status = 'fora_do_limite', ultimas_falhas = '{}'
    where public.portal_imoveis.organizacao_id = v_org;

  -- Quem saiu do feed (alugado, vendido, tirado do site ou do portal).
  update public.portal_imoveis
     set ultimo_status = 'fora', ultimas_falhas = '{}', verificado_em = now()
   where organizacao_id = v_org and portal = p_portal
     and ultimo_status is distinct from 'fora'
     and not (imovel_id = any (v_enviados || v_ids_falha || v_fora));

  -- Histórico do imóvel (imovel_anuncios) -------------------------------------
  -- 1) Saiu do feed: encerra hoje o anúncio aberto pelo feed.
  update public.imovel_anuncios a
     set fim = current_date
   where a.organizacao_id = v_org and a.origem = 'feed' and a.portal = v_nome and a.fim is null
     and not (a.imovel_id = any (v_enviados));
  -- 2) Voltou no mesmo dia em que saiu: reabre o mesmo anúncio.
  update public.imovel_anuncios a
     set fim = null
   where a.organizacao_id = v_org and a.origem = 'feed' and a.portal = v_nome and a.fim = current_date
     and a.imovel_id = any (v_enviados)
     and not exists (select 1 from public.imovel_anuncios b
                      where b.imovel_id = a.imovel_id and b.portal = v_nome and b.id <> a.id
                        and (b.fim is null or b.fim > current_date));
  -- 3) Entrou agora e não há anúncio desse portal no ar: abre um.
  insert into public.imovel_anuncios (organizacao_id, imovel_id, portal, url, inicio, valor, observacoes, origem)
  select v_org, i.id, v_nome, pi.url, current_date,
         coalesce(nullif(case when 'locacao' = any (i.finalidades) or not ('venda' = any (i.finalidades)) then i.valor_aluguel end, 0),
                  nullif(i.valor_venda, 0)),
         'Publicado pelo feed automático (Site e portais).', 'feed'
    from public.imoveis i
    left join public.portal_imoveis pi on pi.imovel_id = i.id and pi.portal = p_portal and pi.organizacao_id = i.organizacao_id
   where i.organizacao_id = v_org and i.id = any (v_enviados)
     and not exists (select 1 from public.imovel_anuncios a
                      where a.imovel_id = i.id and a.portal = v_nome and (a.fim is null or a.fim > current_date));
  -- 4) Continua no ar: o anúncio do feed acompanha o preço e o link do cadastro.
  update public.imovel_anuncios a
     set valor = coalesce(nullif(case when 'locacao' = any (i.finalidades) or not ('venda' = any (i.finalidades)) then i.valor_aluguel end, 0),
                          nullif(i.valor_venda, 0)),
         url = coalesce(pi.url, a.url)
    from public.imoveis i
    left join public.portal_imoveis pi on pi.imovel_id = i.id and pi.portal = p_portal and pi.organizacao_id = i.organizacao_id
   where a.imovel_id = i.id and i.organizacao_id = v_org and a.organizacao_id = v_org
     and a.origem = 'feed' and a.portal = v_nome and a.fim is null
     and i.id = any (v_enviados);
  return v_id;
end;
$$;

/** Lead enviado pelo portal (webhook). Entra pela receber_lead com a origem do portal. */
create or replace function public.portal_receber_lead(p_token uuid, p_portal text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  s public.site_config%rowtype;
  o public.organizacoes%rowtype;
  v_res jsonb;
  v_imovel uuid;
  v_finalidades text[];
  v_dados jsonb;
begin
  if p_portal not in ('zap','vivareal','olx') then raise exception 'Portal desconhecido.'; end if;
  select * into s from public.site_config where portais_token = p_token;
  if not found then raise exception 'Link de integração inválido.'; end if;
  select * into o from public.organizacoes where id = s.organizacao_id and modo = 'imobiliaria';
  if not found then raise exception 'Link de integração inválido.'; end if;
  if nullif(btrim(p->>'imovel'), '') is not null then
    select id, finalidades into v_imovel, v_finalidades
      from public.imoveis where organizacao_id = o.id and lower(codigo) = lower(btrim(p->>'imovel')) limit 1;
  end if;
  -- Sem o tipo de negócio no lead, o funil sai do imóvel (só venda → funil de venda), como no site.
  v_dados := jsonb_build_object('nome', p->>'nome', 'telefone', p->>'telefone', 'email', p->>'email',
                                'mensagem', p->>'mensagem', 'imovel', nullif(btrim(p->>'imovel'), ''), 'origem', p_portal,
                                'funil', case when p->>'funil' in ('locacao','venda') then p->>'funil'
                                              when v_imovel is not null and not ('locacao' = any (coalesce(v_finalidades, '{}'))) then 'venda'
                                              else 'locacao' end);
  v_res := public.receber_lead(o.leads_token, v_dados);
  insert into public.site_solicitacoes (organizacao_id, tipo, origem, nome, telefone, email, mensagem, imovel_id, lead_id, duplicado)
  values (o.id, 'portal', p_portal, left(btrim(p->>'nome'), 120), nullif(left(btrim(p->>'telefone'), 40), ''),
          nullif(lower(left(btrim(p->>'email'), 160)), ''), nullif(left(btrim(p->>'mensagem'), 2000), ''), v_imovel,
          (v_res->>'id')::uuid, coalesce((v_res->>'duplicado')::boolean, false));
  return v_res;
end;
$$;

-- Permissões: só as funções públicas abaixo podem ser chamadas sem login.
do $$
declare f text;
begin
  foreach f in array array[
    'public.site_arquivo_publico(text)', 'public.site_info(text)', 'public.site_imoveis(text)', 'public.site_imovel(text, text)',
    'public.site_empreendimentos(text)', 'public.site_foto(text, uuid)', 'public.site_dominio_candidatos(text)',
    'public.site_contato(text, jsonb)', 'public.portal_feed(uuid, text)', 'public.portal_registrar(uuid, text, jsonb)',
    'public.portal_receber_lead(uuid, text, jsonb)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
revoke execute on function privado.site_config_tocar() from public, anon;
revoke execute on function privado.portal_imoveis_conferir() from public, anon;
revoke execute on function privado.caminho_do_imovel(text, uuid, uuid) from public, anon;

-- 8) Storage ------------------------------------------------------------------
-- Bucket PÚBLICO "site" (logo e imagens da marca): <organizacao_id>/<arquivo>.
-- Fotos de imóveis continuam no bucket privado "imoveis"; o anônimo só lê as
-- fotos/plantas de imóveis publicados (site no ar ou portal ativo).
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('site', 'site', true, 5242880, array['image/jpeg','image/png','image/webp'])
    on conflict (id) do update
      set public = true, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'site_ler') then
      execute $p$create policy site_ler on storage.objects for select to authenticated
        using (bucket_id = 'site' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'site_gravar') then
      execute $p$create policy site_gravar on storage.objects for insert to authenticated
        with check (bucket_id = 'site' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'site_apagar') then
      execute $p$create policy site_apagar on storage.objects for delete to authenticated
        using (bucket_id = 'site' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'imoveis_site_publico') then
      execute $p$create policy imoveis_site_publico on storage.objects for select to anon
        using (bucket_id = 'imoveis' and public.site_arquivo_publico(name))$p$;
    end if;
  end if;
end $$;
