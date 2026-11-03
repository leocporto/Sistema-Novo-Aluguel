-- =============================================================================
-- Cadastro completo de pessoas: comunicação/LGPD, perfil de interesse,
-- contatos vinculados, histórico de relacionamento, documentos e juntar
-- cadastros repetidos.
-- Arquivos no Storage, bucket privado "pessoas": <organizacao_id>/<pessoa_id>/<arquivo>
-- =============================================================================

alter table public.pessoas
  add column if not exists aceita_whatsapp boolean not null default false,
  add column if not exists aceita_email boolean not null default false,
  add column if not exists aceita_sms boolean not null default false,
  add column if not exists aceita_marketing boolean not null default false,
  add column if not exists canal_preferido text,
  add column if not exists consentimento_em timestamptz,
  add column if not exists consentimento_origem text,
  add column if not exists interesse text[] not null default '{}',
  add column if not exists pref_tipos text[] not null default '{}',
  add column if not exists pref_regioes text,
  add column if not exists pref_valor_min numeric(14,2),
  add column if not exists pref_valor_max numeric(14,2),
  add column if not exists pref_quartos_min int,
  add column if not exists especialidade text;

create table if not exists public.pessoa_vinculos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  vinculado_id uuid not null references public.pessoas(id) on delete cascade,
  tipo text not null default 'contato',
  observacao text,
  created_at timestamptz not null default now(),
  unique (pessoa_id, vinculado_id, tipo),
  check (pessoa_id <> vinculado_id)
);

create table if not exists public.pessoa_interacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  tipo text not null default 'nota' check (tipo in ('ligacao','whatsapp','email','reuniao','visita','nota')),
  descricao text not null,
  data timestamptz not null default now(),
  usuario_id uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists pessoa_interacoes_pessoa_idx on public.pessoa_interacoes (pessoa_id, data desc);

create table if not exists public.pessoa_arquivos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  categoria text not null default 'Outro',
  path text not null,
  nome text,
  created_at timestamptz not null default now()
);
create index if not exists pessoa_arquivos_pessoa_idx on public.pessoa_arquivos (pessoa_id);

create table if not exists public.pessoa_consentimentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  canal text not null,
  concedido boolean not null,
  origem text,
  em timestamptz not null default now(),
  usuario_id uuid default auth.uid()
);
create index if not exists pessoa_consentimentos_pessoa_idx on public.pessoa_consentimentos (pessoa_id, em desc);

do $$
declare t text;
begin
  foreach t in array array['pessoa_vinculos','pessoa_interacoes','pessoa_arquivos','pessoa_consentimentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (organizacao_id in (select privado.org_ids()))
      with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
  end loop;
end $$;

-- Juntar dois cadastros da mesma pessoa -----------------------------------
create or replace function public.juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  a public.pessoas%rowtype;
  b public.pessoas%rowtype;
  r record;
begin
  if p_manter = p_remover then raise exception 'Escolha dois cadastros diferentes.'; end if;
  select * into a from public.pessoas where id = p_manter for update;
  select * into b from public.pessoas where id = p_remover for update;
  if a.id is null or b.id is null then raise exception 'Cadastro não encontrado.'; end if;

  -- Imóveis: se os dois eram donos do mesmo imóvel, soma a participação.
  for r in select * from public.imovel_proprietarios where pessoa_id = b.id loop
    if exists (select 1 from public.imovel_proprietarios where imovel_id = r.imovel_id and pessoa_id = a.id) then
      update public.imovel_proprietarios
         set percentual = least(100, percentual + r.percentual)
       where imovel_id = r.imovel_id and pessoa_id = a.id;
      delete from public.imovel_proprietarios where imovel_id = r.imovel_id and pessoa_id = b.id;
    else
      update public.imovel_proprietarios set pessoa_id = a.id where imovel_id = r.imovel_id and pessoa_id = b.id;
    end if;
  end loop;

  -- Contratos: sem repetir a mesma pessoa no mesmo papel.
  delete from public.contrato_partes cp
   where cp.pessoa_id = b.id
     and exists (select 1 from public.contrato_partes x where x.contrato_id = cp.contrato_id and x.pessoa_id = a.id and x.papel = cp.papel);
  update public.contrato_partes set pessoa_id = a.id where pessoa_id = b.id;

  update public.repasses set pessoa_id = a.id where pessoa_id = b.id;
  update public.lancamentos set pessoa_id = a.id where pessoa_id = b.id;
  update public.visitas set corretor_id = a.id where corretor_id = b.id;
  update public.propostas set corretor_id = a.id where corretor_id = b.id;
  update public.imoveis set corretor_id = a.id where corretor_id = b.id;

  delete from public.pessoa_vinculos v
   where (v.pessoa_id = b.id and (v.vinculado_id = a.id or exists (
            select 1 from public.pessoa_vinculos x where x.pessoa_id = a.id and x.vinculado_id = v.vinculado_id and x.tipo = v.tipo)))
      or (v.vinculado_id = b.id and (v.pessoa_id = a.id or exists (
            select 1 from public.pessoa_vinculos x where x.vinculado_id = a.id and x.pessoa_id = v.pessoa_id and x.tipo = v.tipo)));
  update public.pessoa_vinculos set pessoa_id = a.id where pessoa_id = b.id;
  update public.pessoa_vinculos set vinculado_id = a.id where vinculado_id = b.id;
  update public.pessoa_interacoes set pessoa_id = a.id where pessoa_id = b.id;
  update public.pessoa_arquivos set pessoa_id = a.id where pessoa_id = b.id;
  update public.pessoa_consentimentos set pessoa_id = a.id where pessoa_id = b.id;

  -- Completa o que estava vazio em quem fica.
  update public.pessoas set
    documento = coalesce(a.documento, b.documento),
    rg_ie = coalesce(a.rg_ie, b.rg_ie),
    data_nascimento = coalesce(a.data_nascimento, b.data_nascimento),
    estado_civil = coalesce(a.estado_civil, b.estado_civil),
    profissao = coalesce(a.profissao, b.profissao),
    email = coalesce(a.email, b.email),
    telefone = coalesce(a.telefone, b.telefone),
    cep = coalesce(a.cep, b.cep),
    logradouro = coalesce(a.logradouro, b.logradouro),
    numero = coalesce(a.numero, b.numero),
    complemento = coalesce(a.complemento, b.complemento),
    bairro = coalesce(a.bairro, b.bairro),
    cidade = coalesce(a.cidade, b.cidade),
    uf = coalesce(a.uf, b.uf),
    banco = coalesce(a.banco, b.banco),
    agencia = coalesce(a.agencia, b.agencia),
    conta = coalesce(a.conta, b.conta),
    tipo_conta = coalesce(a.tipo_conta, b.tipo_conta),
    pix_chave = coalesce(a.pix_chave, b.pix_chave),
    especialidade = coalesce(a.especialidade, b.especialidade),
    papeis = (select array(select distinct unnest(a.papeis || b.papeis))),
    observacoes = nullif(concat_ws(E'\n', a.observacoes, b.observacoes), '')
  where id = a.id;

  delete from public.pessoas where id = b.id;
end;
$$;

revoke execute on function public.juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function public.juntar_pessoas(uuid, uuid) to authenticated;

-- Storage: bucket privado "pessoas" (só no Supabase) ------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('pessoas', 'pessoas', false, 10485760,
            array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists pessoas_ler on storage.objects';
    execute 'drop policy if exists pessoas_gravar on storage.objects';
    execute 'drop policy if exists pessoas_apagar on storage.objects';
    execute $p$create policy pessoas_ler on storage.objects for select to authenticated
      using (bucket_id = 'pessoas' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
    execute $p$create policy pessoas_gravar on storage.objects for insert to authenticated
      with check (bucket_id = 'pessoas' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
    execute $p$create policy pessoas_apagar on storage.objects for delete to authenticated
      using (bucket_id = 'pessoas' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
  end if;
end $$;
