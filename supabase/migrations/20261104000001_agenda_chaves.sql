-- =============================================================================
-- Agenda, visitas e chaves (nos dois modos).
-- - visitas vira o compromisso da agenda: tipo, duração, presencial/virtual,
--   interessado (lead, pessoa ou contato livre), responsável, confirmação,
--   check-in/out, feedback, lembrete e histórico;
-- - disponibilidade do imóvel para visitas;
-- - chaves com código, quantidade, quem guarda e retirada por pessoa/visita;
-- - feed de calendário (.ics) por token para Google/Apple/Outlook.
-- =============================================================================

alter table public.visitas
  add column if not exists titulo text,
  add column if not exists duracao_min int not null default 60,
  add column if not exists modalidade text not null default 'presencial',
  add column if not exists link_virtual text,
  add column if not exists pessoa_id uuid references public.pessoas(id) on delete set null,
  add column if not exists contato_nome text,
  add column if not exists contato_telefone text,
  add column if not exists responsavel_id uuid default auth.uid(),
  add column if not exists compartilhada boolean not null default true,
  add column if not exists cliente_confirmado_em timestamptz,
  add column if not exists proprietario_confirmado_em timestamptz,
  add column if not exists checkin_em timestamptz,
  add column if not exists checkout_em timestamptz,
  add column if not exists feedback_nota int,
  add column if not exists feedback_interesse text,
  add column if not exists feedback_texto text,
  add column if not exists feedback_proprietario text,
  add column if not exists motivo_cancelamento text,
  add column if not exists lembrete_min int not null default 60;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'visitas_tipo_check') then
    alter table public.visitas add constraint visitas_tipo_check
      check (tipo in ('visita','avaliacao','vistoria','reuniao','entrega_chaves','lembrete','outro'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'visitas_modalidade_check') then
    alter table public.visitas add constraint visitas_modalidade_check check (modalidade in ('presencial','virtual'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'visitas_feedback_check') then
    alter table public.visitas add constraint visitas_feedback_check check (
      (feedback_nota is null or feedback_nota between 1 and 5)
      and (feedback_interesse is null or feedback_interesse in ('alto','medio','baixo','nenhum')));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'visitas_duracao_check') then
    alter table public.visitas add constraint visitas_duracao_check check (duracao_min between 5 and 1440);
  end if;
end $$;

create index if not exists visitas_imovel_idx on public.visitas (imovel_id, data_hora);
create index if not exists visitas_pessoa_idx on public.visitas (pessoa_id);

create table if not exists public.visita_participantes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  visita_id uuid not null references public.visitas(id) on delete cascade,
  pessoa_id uuid references public.pessoas(id) on delete cascade,
  nome text,
  papel text,
  check (pessoa_id is not null or coalesce(btrim(nome), '') <> '')
);

create table if not exists public.visita_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  visita_id uuid not null references public.visitas(id) on delete cascade,
  tipo text not null default 'nota'
    check (tipo in ('criada','reagendada','cancelada','confirmada','checkin','checkout','feedback','chave','nota','realizada')),
  descricao text,
  data timestamptz not null default now(),
  usuario_id uuid default auth.uid()
);
create index if not exists visita_eventos_idx on public.visita_eventos (visita_id, data desc);

-- Disponibilidade do imóvel para visitas
alter table public.imoveis add column if not exists horario_visitas text;
create table if not exists public.imovel_indisponibilidades (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  inicio timestamptz not null,
  fim timestamptz not null,
  motivo text,
  check (fim > inicio)
);
create index if not exists imovel_indisp_idx on public.imovel_indisponibilidades (imovel_id, inicio);

-- Chaves
alter table public.chaves
  add column if not exists codigo text,
  add column if not exists quantidade int not null default 1,
  add column if not exists responsavel_id uuid references public.pessoas(id) on delete set null,
  add column if not exists observacoes text;
create unique index if not exists chaves_codigo_unico on public.chaves (organizacao_id, upper(codigo)) where codigo is not null;

alter table public.chave_movimentacoes
  add column if not exists pessoa_id uuid references public.pessoas(id) on delete set null,
  add column if not exists usuario_id uuid default auth.uid(),
  add column if not exists visita_id uuid references public.visitas(id) on delete set null,
  add column if not exists observacao_devolucao text;

-- Chaves antigas ganham código (CH-001, CH-002…) na ordem de cadastro.
with numeradas as (
  select id, organizacao_id, row_number() over (partition by organizacao_id order by created_at, id) as n
    from public.chaves where codigo is null
)
update public.chaves c
   set codigo = 'CH-' || lpad((n + coalesce((select count(*) from public.chaves x where x.organizacao_id = c.organizacao_id and x.codigo is not null), 0))::text, 3, '0')
  from numeradas
 where numeradas.id = c.id;

do $$
declare t text;
begin
  foreach t in array array['visita_participantes','visita_eventos','imovel_indisponibilidades'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (organizacao_id in (select privado.org_ids()))
      with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
  end loop;
end $$;

-- Só uma retirada aberta por chave.
create unique index if not exists chave_mov_aberta_unica on public.chave_movimentacoes (chave_id) where devolvida_em is null;

-- Calendário externo (.ics) ------------------------------------------------
alter table public.organizacoes add column if not exists agenda_token uuid not null default gen_random_uuid();
create unique index if not exists organizacoes_agenda_token_idx on public.organizacoes (agenda_token);

/**
 * Compromissos para o calendário externo (só com o token certo).
 * p_usuario: só os do usuário + os compartilhados; nulo = todos.
 */
create or replace function public.agenda_feed(p_token uuid, p_usuario uuid default null)
returns table (
  id uuid, tipo text, titulo text, data_hora timestamptz, duracao_min int, status text, modalidade text,
  link_virtual text, observacoes text, lembrete_min int, imovel text, endereco text, cliente text, telefone text, organizacao text
)
language sql
stable
security definer
set search_path = public
as $$
  select v.id, v.tipo, v.titulo, v.data_hora, v.duracao_min, v.status, v.modalidade, v.link_virtual, v.observacoes, v.lembrete_min,
         i.codigo,
         nullif(concat_ws(', ', nullif(concat_ws(', ', i.logradouro, i.numero), ''), i.bairro, i.cidade), ''),
         coalesce(l.nome, p.nome, v.contato_nome, c.proprietario_nome),
         coalesce(l.telefone, p.telefone, v.contato_telefone, c.proprietario_telefone),
         o.nome
    from public.organizacoes o
    join public.visitas v on v.organizacao_id = o.id
    left join public.imoveis i on i.id = v.imovel_id
    left join public.leads l on l.id = v.lead_id
    left join public.pessoas p on p.id = v.pessoa_id
    left join public.captacoes c on c.id = v.captacao_id
   where o.agenda_token = p_token
     and v.status <> 'cancelada'
     and v.data_hora > now() - interval '60 days'
     and v.data_hora < now() + interval '365 days'
     and (p_usuario is null or v.responsavel_id = p_usuario or v.compartilhada)
   order by v.data_hora
   limit 2000
$$;
revoke execute on function public.agenda_feed(uuid, uuid) from public;
grant execute on function public.agenda_feed(uuid, uuid) to anon, authenticated;
