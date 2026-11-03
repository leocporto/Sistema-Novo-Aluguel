-- =============================================================================
-- Cadastro completo de imóveis: áreas, mapa, comodidades, encargos, mídia,
-- documentos, histórico de preços, comercialização (exclusividade, autorização,
-- corretor), anúncios e empreendimentos/blocos/unidades.
-- Arquivos no Storage, bucket privado "imoveis": <organizacao_id>/<imovel_id>/<arquivo>
-- =============================================================================

-- Empreendimentos (antes das colunas de imóveis que apontam para eles) --------
create table if not exists public.empreendimentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  construtora text,
  cep text, logradouro text, numero text, bairro text, cidade text, uf text,
  observacoes text,
  created_at timestamptz not null default now()
);

-- Imóveis: campos novos ------------------------------------------------------
alter table public.imoveis
  add column if not exists area_construida numeric(10,2),
  add column if not exists area_privativa numeric(10,2),
  add column if not exists latitude numeric(10,7),
  add column if not exists longitude numeric(10,7),
  add column if not exists comodidades text[] not null default '{}',
  add column if not exists outros_encargos numeric(14,2),
  add column if not exists outros_encargos_descricao text,
  add column if not exists video_url text,
  add column if not exists tour_url text,
  add column if not exists exclusivo boolean not null default false,
  add column if not exists exclusividade_inicio date,
  add column if not exists exclusividade_fim date,
  add column if not exists autorizacao_numero text,
  add column if not exists autorizacao_data date,
  add column if not exists autorizacao_validade date,
  add column if not exists corretor_id uuid references public.pessoas(id) on delete set null,
  add column if not exists empreendimento_id uuid references public.empreendimentos(id) on delete set null,
  add column if not exists bloco text,
  add column if not exists unidade text;

create index if not exists imoveis_empreendimento_idx on public.imoveis (empreendimento_id);

-- Mídia e documentos ---------------------------------------------------------
create table if not exists public.imovel_midias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  tipo text not null check (tipo in ('foto','planta','documento','autorizacao')),
  categoria text,
  path text not null,
  nome text,
  ordem int not null default 0,
  capa boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists imovel_midias_imovel_idx on public.imovel_midias (imovel_id, tipo, ordem);

-- Histórico de preços --------------------------------------------------------
create table if not exists public.imovel_precos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes(id) on delete cascade,
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  campo text not null check (campo in ('aluguel','venda','condominio','iptu')),
  valor_anterior numeric(14,2),
  valor_novo numeric(14,2),
  alterado_em timestamptz not null default now(),
  usuario_id uuid default auth.uid()
);
create index if not exists imovel_precos_imovel_idx on public.imovel_precos (imovel_id, alterado_em desc);

create or replace function public.registrar_preco_imovel()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  campos text[] := array['aluguel','venda','condominio','iptu'];
  antigos numeric[];
  novos numeric[];
  i int;
begin
  novos := array[new.valor_aluguel, new.valor_venda, new.valor_condominio, new.valor_iptu];
  if tg_op = 'UPDATE' then
    antigos := array[old.valor_aluguel, old.valor_venda, old.valor_condominio, old.valor_iptu];
  else
    antigos := array[null, null, null, null]::numeric[];
  end if;
  for i in 1..4 loop
    if novos[i] is distinct from antigos[i] and not (tg_op = 'INSERT' and novos[i] is null) then
      insert into public.imovel_precos (organizacao_id, imovel_id, campo, valor_anterior, valor_novo)
      values (new.organizacao_id, new.id, campos[i], antigos[i], novos[i]);
    end if;
  end loop;
  return null;
end;
$$;

drop trigger if exists imoveis_precos_trg on public.imoveis;
create trigger imoveis_precos_trg
  after insert or update of valor_aluguel, valor_venda, valor_condominio, valor_iptu on public.imoveis
  for each row execute function public.registrar_preco_imovel();

-- Anúncios em portais (modo imobiliária) ------------------------------------
create table if not exists public.imovel_anuncios (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  portal text not null,
  url text,
  inicio date not null default current_date,
  fim date,
  valor numeric(14,2),
  observacoes text,
  created_at timestamptz not null default now()
);
create index if not exists imovel_anuncios_imovel_idx on public.imovel_anuncios (imovel_id);

-- RLS por organização --------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['empreendimentos','imovel_midias','imovel_precos','imovel_anuncios'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (organizacao_id in (select privado.org_ids()))
      with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
  end loop;
end $$;

-- Storage: bucket privado "imoveis" (só existe no Supabase, não no teste local)
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('imoveis', 'imoveis', false, 26214400,
            array['image/jpeg','image/png','image/webp','image/heic','application/pdf','video/mp4'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists imoveis_ler on storage.objects';
    execute 'drop policy if exists imoveis_gravar on storage.objects';
    execute 'drop policy if exists imoveis_apagar on storage.objects';
    execute $p$create policy imoveis_ler on storage.objects for select to authenticated
      using (bucket_id = 'imoveis' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
    execute $p$create policy imoveis_gravar on storage.objects for insert to authenticated
      with check (bucket_id = 'imoveis' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
    execute $p$create policy imoveis_apagar on storage.objects for delete to authenticated
      using (bucket_id = 'imoveis' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
  end if;
end $$;
