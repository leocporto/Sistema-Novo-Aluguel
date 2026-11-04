-- =============================================================================
-- Portal de clientes (etapa 18): uma tela diferente para cada perfil.
--
-- Proprietário (só imobiliária), locatário (nos dois modos) e prestador de
-- serviço (nos dois modos) são pessoas DE FORA: entram por um LINK PESSOAL
-- (portal_acessos.token) e confirmam quem são com os 4 primeiros números do
-- CPF/CNPJ (ou os 4 últimos do telefone, se não houver documento). Errou 5
-- vezes: a entrada fica bloqueada 30 minutos. Cada entrada abre uma sessão
-- (portal_sessoes) de 12 horas: o navegador guarda o segredo num cookie
-- httpOnly e o banco guarda só o hash (sha256 do segredo + token). Trocar o
-- link (token novo) ou desativá-lo derruba as sessões.
--
-- Leitura SÓ por funções security definer que devolvem os dados daquela
-- pessoa (vínculo: imovel_proprietarios / contrato_partes / chamados.prestador_id);
-- escrita SÓ por funções (solicitações, chamado, orçamento, execução, fotos e
-- aprovação de orçamento). Nada de leitura anônima no Storage: contrato,
-- recibos, extratos, demonstrativo e informe de rendimentos saem como HTML do
-- banco; arquivo (PDF/foto) só quando a equipe compartilha um link assinado
-- com validade (portal_arquivos). Fotos de conclusão do prestador: o anônimo
-- só GRAVA numa pasta liberada por função (portal_envios), nunca lê.
--
-- Portal do corretor (só imobiliária): área interna /corretor para o usuário
-- logado. membros.pessoa_id liga o usuário ao cadastro do corretor; as funções
-- corretor_* devolvem só o que é dele quando o papel é "corretor".
--
-- Sem DROP: tabelas/índices "if not exists", funções e gatilhos "create or
-- replace", policies criadas só se ainda não existirem.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Usuário do sistema ↔ cadastro de corretor (Pessoas)
-- -----------------------------------------------------------------------------
alter table public.membros add column if not exists pessoa_id uuid references public.pessoas(id) on delete set null;
create unique index if not exists membros_pessoa_idx on public.membros (organizacao_id, pessoa_id) where pessoa_id is not null;

/** Cadastro (Pessoas) ligado ao usuário logado nesta organização. */
create or replace function privado.minha_pessoa(p_org uuid)
returns uuid
language sql
stable
security definer
set search_path = ''
as $$
  select pessoa_id from public.membros where organizacao_id = p_org and user_id = auth.uid()
$$;
revoke execute on function privado.minha_pessoa(uuid) from public, anon;
grant execute on function privado.minha_pessoa(uuid) to authenticated;

/** Equipe que cuida do portal: administrador, gestor e financeiro (o corretor não). */
create or replace function privado.portal_equipe(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.membros m where m.organizacao_id = p_org and m.user_id = auth.uid() and m.papel in ('admin','gestor','financeiro'))
$$;
revoke execute on function privado.portal_equipe(uuid) from public, anon;
grant execute on function privado.portal_equipe(uuid) to authenticated;

/** Liga (ou desliga, com p_pessoa nulo) um usuário ao cadastro de corretor. Só administrador e gestor. */
create or replace function public.ligar_membro_pessoa(p_user uuid, p_pessoa uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
begin
  if v_org is null or not privado.pode_ver_restrito(v_org) then
    raise exception 'Só administradores e gestores ligam usuários a cadastros de corretor.';
  end if;
  if not exists (select 1 from public.membros where organizacao_id = v_org and user_id = p_user) then
    raise exception 'Usuário não encontrado nesta conta.';
  end if;
  if p_pessoa is not null and not exists (select 1 from public.pessoas where id = p_pessoa and organizacao_id = v_org) then
    raise exception 'Cadastro não encontrado.';
  end if;
  if p_pessoa is not null and exists (select 1 from public.membros where organizacao_id = v_org and pessoa_id = p_pessoa and user_id <> p_user) then
    raise exception 'Este cadastro já está ligado a outro usuário.';
  end if;
  update public.membros set pessoa_id = p_pessoa where organizacao_id = v_org and user_id = p_user;
end;
$$;
revoke execute on function public.ligar_membro_pessoa(uuid, uuid) from public, anon;
grant execute on function public.ligar_membro_pessoa(uuid, uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Tabelas do portal
-- -----------------------------------------------------------------------------
create table if not exists public.portal_acessos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  perfil text not null check (perfil in ('proprietario','locatario','prestador')),
  token uuid not null default gen_random_uuid(),
  ativo boolean not null default true,
  expira_em timestamptz,
  ultimo_acesso timestamptz,
  acessos int not null default 0,
  falhas int not null default 0,
  bloqueado_ate timestamptz,
  revogado_em timestamptz,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists portal_acessos_token_idx on public.portal_acessos (token);
-- Um link ativo por pessoa e perfil.
create unique index if not exists portal_acessos_pessoa_idx on public.portal_acessos (pessoa_id, perfil) where ativo;

-- Sessões abertas depois da confirmação de identidade (só o hash do segredo).
create table if not exists public.portal_sessoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  acesso_id uuid not null references public.portal_acessos(id) on delete cascade,
  hash text not null,
  expira_em timestamptz not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create unique index if not exists portal_sessoes_hash_idx on public.portal_sessoes (hash);
create index if not exists portal_sessoes_acesso_idx on public.portal_sessoes (acesso_id, expira_em);

-- Registro de acessos e ações pelo portal (só leitura para a equipe). NÃO some
-- quando o link ou a pessoa são excluídos (como analise_eventos): o link vira
-- nulo e a pessoa, o perfil e o nome ficam copiados no próprio registro.
create table if not exists public.portal_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  acesso_id uuid references public.portal_acessos(id) on delete set null,
  pessoa_id uuid,
  pessoa_nome text,
  perfil text,
  tipo text not null,
  descricao text,
  ip text,
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index if not exists portal_eventos_acesso_idx on public.portal_eventos (acesso_id, data desc);
create index if not exists portal_eventos_data_idx on public.portal_eventos (organizacao_id, data desc);
create index if not exists portal_eventos_tipo_idx on public.portal_eventos (organizacao_id, tipo, data);
create index if not exists portal_eventos_pessoa_idx on public.portal_eventos (pessoa_id, data desc);

-- Pedidos que chegam pelo portal (renovação, desocupação, contato).
-- A desocupação NÃO é criada sozinha: a equipe decide.
create table if not exists public.portal_solicitacoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  numero bigint generated by default as identity,
  acesso_id uuid references public.portal_acessos(id) on delete set null,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  perfil text not null check (perfil in ('proprietario','locatario','prestador')),
  contrato_id uuid references public.contratos(id) on delete set null,
  imovel_id uuid references public.imoveis(id) on delete set null,
  tipo text not null default 'contato' check (tipo in ('renovacao','desocupacao','contato')),
  mensagem text not null,
  data_desejada date,
  status text not null default 'nova' check (status in ('nova','em_andamento','concluida','recusada')),
  resposta text,
  tratado_por uuid,
  tratado_em timestamptz,
  tarefa_id uuid references public.tarefas(id) on delete set null,
  interacao_id uuid references public.pessoa_interacoes(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists portal_solicitacoes_status_idx on public.portal_solicitacoes (organizacao_id, status, created_at desc);
create index if not exists portal_solicitacoes_acesso_idx on public.portal_solicitacoes (acesso_id, created_at desc);
create index if not exists portal_solicitacoes_pessoa_idx on public.portal_solicitacoes (pessoa_id);

-- Arquivos compartilhados pela equipe: link assinado do Storage com validade.
create table if not exists public.portal_arquivos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  acesso_id uuid not null references public.portal_acessos(id) on delete cascade,
  titulo text not null,
  bucket text not null,
  path text not null,
  url text not null,
  expira_em timestamptz not null,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists portal_arquivos_acesso_idx on public.portal_arquivos (acesso_id, expira_em);

-- Pasta liberada (por 2 horas) para enviar fotos/vídeos de um chamado pelo portal.
create table if not exists public.portal_envios (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  acesso_id uuid not null references public.portal_acessos(id) on delete cascade,
  chamado_id uuid not null references public.chamados(id) on delete cascade,
  momento text not null check (momento in ('antes','depois')),
  expira_em timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now()
);
create index if not exists portal_envios_acesso_idx on public.portal_envios (acesso_id, created_at desc);

-- Quem mandou a foto pelo portal (prestador ou locatário).
alter table public.chamado_midias add column if not exists portal_pessoa_id uuid references public.pessoas(id) on delete set null;
-- O prestador avisa pelo portal que terminou (a conclusão continua sendo aprovada pela equipe).
alter table public.chamados
  add column if not exists prestador_concluiu_em timestamptz,
  add column if not exists prestador_comentario text;

-- Documentação enviada pelo corretor (dele e dos clientes). Bucket privado "corretores":
-- <organizacao>/<corretor>/<arquivo>.
create table if not exists public.corretor_documentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  corretor_id uuid not null references public.pessoas(id) on delete cascade,
  cliente_id uuid references public.pessoas(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  imovel_id uuid references public.imoveis(id) on delete set null,
  titulo text not null,
  categoria text not null default 'outro' check (categoria in ('pessoal','cliente','imovel','proposta','outro')),
  path text not null,
  nome text,
  enviado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists corretor_documentos_corretor_idx on public.corretor_documentos (corretor_id, created_at desc);

-- -----------------------------------------------------------------------------
-- 3. RLS
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['portal_acessos','portal_sessoes','portal_eventos','portal_solicitacoes','portal_arquivos','portal_envios','corretor_documentos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
  end loop;
  -- Links e arquivos compartilhados: só a equipe (admin, gestor, financeiro).
  foreach t in array array['portal_acessos','portal_arquivos'] loop
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_equipe') then
      execute format($p$create policy %I on public.%I for all to authenticated
        using (organizacao_id in (select privado.org_ids()) and privado.portal_equipe(organizacao_id))
        with check (organizacao_id in (select privado.org_ids()) and privado.portal_equipe(organizacao_id))$p$, t || '_equipe', t);
    end if;
  end loop;
  -- Registro de acessos: só leitura.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'portal_eventos' and policyname = 'portal_eventos_ler') then
    create policy portal_eventos_ler on public.portal_eventos for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.portal_equipe(organizacao_id));
  end if;
  -- Solicitações: quem cria é o portal (pelo banco); a equipe lê, trata e exclui.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'portal_solicitacoes' and policyname = 'portal_solicitacoes_ler') then
    create policy portal_solicitacoes_ler on public.portal_solicitacoes for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.portal_equipe(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'portal_solicitacoes' and policyname = 'portal_solicitacoes_tratar') then
    create policy portal_solicitacoes_tratar on public.portal_solicitacoes for update to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.portal_equipe(organizacao_id))
      with check (organizacao_id in (select privado.org_ids()) and privado.portal_equipe(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'portal_solicitacoes' and policyname = 'portal_solicitacoes_excluir') then
    create policy portal_solicitacoes_excluir on public.portal_solicitacoes for delete to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.portal_equipe(organizacao_id));
  end if;
  -- Documentos do corretor: o corretor só vê e mexe nos dele; o resto da equipe vê todos.
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'corretor_documentos' and policyname = 'corretor_documentos_org') then
    create policy corretor_documentos_org on public.corretor_documentos for all to authenticated
      using (organizacao_id in (select privado.org_ids())
             and (privado.papel_atual(organizacao_id) is distinct from 'corretor' or corretor_id = privado.minha_pessoa(organizacao_id)))
      with check (organizacao_id in (select privado.org_ids())
             and (privado.papel_atual(organizacao_id) is distinct from 'corretor' or corretor_id = privado.minha_pessoa(organizacao_id)));
  end if;
  -- portal_sessoes e portal_envios: nenhuma policy (só as funções do banco usam).
end $$;

-- -----------------------------------------------------------------------------
-- 4. Gatilhos de consistência
-- -----------------------------------------------------------------------------

/** Confirmação de identidade: 4 primeiros números do CPF/CNPJ ou, sem documento, 4 últimos do telefone (mesma regra de src/lib/dominio/portal.ts). */
create or replace function privado.portal_codigo(p_pessoa uuid, out codigo text, out tipo text)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_doc text;
  v_tel text;
begin
  select regexp_replace(coalesce(documento, ''), '\D', '', 'g'), regexp_replace(coalesce(telefone, ''), '\D', '', 'g')
    into v_doc, v_tel
    from public.pessoas where id = p_pessoa;
  if length(coalesce(v_doc, '')) >= 4 then
    codigo := left(v_doc, 4);
    tipo := case length(v_doc) when 11 then 'cpf' when 14 then 'cnpj' else 'documento' end;
  elsif length(coalesce(v_tel, '')) >= 4 then
    codigo := right(v_tel, 4);
    tipo := 'telefone';
  end if;
end;
$$;
revoke execute on function privado.portal_codigo(uuid) from public, anon, authenticated;

create or replace function privado.portal_acessos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_modo text;
  v_mudou boolean;
  v_juntando boolean := coalesce(current_setting('portal.juntando', true), '') = 'sim';
begin
  if not exists (select 1 from public.pessoas where id = new.pessoa_id and organizacao_id = new.organizacao_id) then
    raise exception 'Pessoa não encontrada.';
  end if;
  -- "Juntar repetidos" só troca a pessoa do link: não é gerar/trocar link.
  v_mudou := not v_juntando and (tg_op = 'INSERT' or new.token is distinct from old.token or new.ativo is distinct from old.ativo
             or new.expira_em is distinct from old.expira_em or new.pessoa_id is distinct from old.pessoa_id);
  -- Quem gera, troca e desativa links: só a equipe (o corretor não). Contadores de entrada (portal) passam.
  if v_mudou and auth.uid() is not null and not privado.portal_equipe(new.organizacao_id) then
    raise exception 'Só administradores, gestores e o financeiro mexem nos links do portal.';
  end if;
  select modo into v_modo from public.organizacoes where id = new.organizacao_id;
  if new.perfil = 'proprietario' and v_modo = 'pessoal' and new.ativo and v_mudou then
    raise exception 'No modo imóveis pessoais não existe portal do proprietário (o dono é você).';
  end if;
  if tg_op = 'INSERT' then
    if (select c.codigo from privado.portal_codigo(new.pessoa_id) c) is null then
      raise exception 'Cadastre o CPF/CNPJ ou o telefone da pessoa antes de gerar o link: é com ele que ela confirma quem é.';
    end if;
    if new.expira_em is not null and (new.expira_em <= now() or new.expira_em > now() + interval '2 years') then
      raise exception 'Validade do link inválida.';
    end if;
  else
    if new.perfil is distinct from old.perfil or new.organizacao_id is distinct from old.organizacao_id then
      raise exception 'Para outro perfil, gere um link novo.';
    end if;
    if new.token is distinct from old.token or (new.ativo and not old.ativo) then
      new.falhas := 0;
      new.bloqueado_ate := null;
      new.revogado_em := null;
    end if;
    if old.ativo and not new.ativo then
      new.revogado_em := now();
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger portal_acessos_antes_trg before insert or update on public.portal_acessos
  for each row execute function privado.portal_acessos_antes();

/** Histórico do link: gerado, trocado, desativado, reativado, validade. Trocar ou desativar derruba as sessões. */
create or replace function privado.portal_acessos_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.portal_eventos (organizacao_id, acesso_id, tipo, descricao)
    values (new.organizacao_id, new.id, 'gerado', 'Link do portal gerado');
    return new;
  end if;
  if new.token is distinct from old.token then
    delete from public.portal_sessoes where acesso_id = new.id;
    insert into public.portal_eventos (organizacao_id, acesso_id, tipo, descricao)
    values (new.organizacao_id, new.id, 'trocado', 'Link trocado: o endereço antigo parou de funcionar');
  end if;
  if old.ativo and not new.ativo then
    delete from public.portal_sessoes where acesso_id = new.id;
    insert into public.portal_eventos (organizacao_id, acesso_id, tipo, descricao)
    values (new.organizacao_id, new.id, 'revogado', 'Link desativado');
  elsif new.ativo and not old.ativo then
    insert into public.portal_eventos (organizacao_id, acesso_id, tipo, descricao)
    values (new.organizacao_id, new.id, 'reativado', 'Link reativado');
  end if;
  if new.expira_em is distinct from old.expira_em then
    insert into public.portal_eventos (organizacao_id, acesso_id, tipo, descricao)
    values (new.organizacao_id, new.id, 'validade',
            case when new.expira_em is null then 'Link sem data para expirar'
                 else 'Link vale até ' || to_char(new.expira_em at time zone 'America/Sao_Paulo', 'DD/MM/YYYY') end);
  end if;
  return new;
end;
$$;
create or replace trigger portal_acessos_depois_trg after insert or update on public.portal_acessos
  for each row execute function privado.portal_acessos_depois();

/** Registro de acessos: guarda quem era a pessoa e o perfil (continuam valendo se o link ou a pessoa forem excluídos). */
create or replace function privado.portal_eventos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
begin
  if new.acesso_id is not null and (new.pessoa_id is null or new.perfil is null) then
    select * into a from public.portal_acessos where id = new.acesso_id;
    if found then
      new.pessoa_id := coalesce(new.pessoa_id, a.pessoa_id);
      new.perfil := coalesce(new.perfil, a.perfil);
    end if;
  end if;
  if new.pessoa_nome is null and new.pessoa_id is not null then
    new.pessoa_nome := (select nome from public.pessoas where id = new.pessoa_id);
  end if;
  return new;
end;
$$;
create or replace trigger portal_eventos_antes_trg before insert on public.portal_eventos
  for each row execute function privado.portal_eventos_antes();

/** Excluir o link (ou a pessoa) não apaga o registro: fica anotado "Link excluído". */
create or replace function privado.portal_acessos_excluido()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
begin
  -- Organização sendo excluída: não há o que registrar.
  if not exists (select 1 from public.organizacoes where id = old.organizacao_id) then
    return old;
  end if;
  v_nome := coalesce((select nome from public.pessoas where id = old.pessoa_id),
                     (select e.pessoa_nome from public.portal_eventos e where e.pessoa_id = old.pessoa_id and e.pessoa_nome is not null order by e.data desc limit 1));
  insert into public.portal_eventos (organizacao_id, acesso_id, pessoa_id, pessoa_nome, perfil, tipo, descricao)
  values (old.organizacao_id, null, old.pessoa_id, v_nome, old.perfil, 'excluido',
          case when exists (select 1 from public.pessoas where id = old.pessoa_id) then 'Link do portal excluído'
               else 'Link do portal excluído junto com o cadastro da pessoa' end
          || ' (' || old.acessos || ' entrada(s) registradas)');
  return old;
end;
$$;
create or replace trigger portal_acessos_excluido_trg after delete on public.portal_acessos
  for each row execute function privado.portal_acessos_excluido();

create or replace function privado.portal_arquivos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.portal_acessos where id = new.acesso_id and organizacao_id = new.organizacao_id) then
    raise exception 'Link do portal não encontrado.';
  end if;
  if coalesce(btrim(new.titulo), '') = '' then raise exception 'Dê um nome ao arquivo.'; end if;
  if new.url !~ '^https?://' then raise exception 'Link do arquivo inválido.'; end if;
  if tg_op = 'INSERT' and (new.expira_em <= now() or new.expira_em > now() + interval '90 days') then
    raise exception 'O arquivo pode ficar no portal por no máximo 90 dias.';
  end if;
  if tg_op = 'UPDATE' and new.expira_em > greatest(old.expira_em, now() + interval '90 days') then
    raise exception 'O arquivo pode ficar no portal por no máximo 90 dias.';
  end if;
  new.titulo := left(btrim(new.titulo), 160);
  return new;
end;
$$;
create or replace trigger portal_arquivos_antes_trg before insert or update on public.portal_arquivos
  for each row execute function privado.portal_arquivos_antes();

/** A equipe trata o pedido (status, resposta, tarefa/registro), mas não reescreve o que a pessoa mandou. */
create or replace function privado.portal_solicitacoes_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and (
       new.mensagem is distinct from old.mensagem or new.tipo is distinct from old.tipo or new.perfil is distinct from old.perfil
       or new.acesso_id is distinct from old.acesso_id or new.contrato_id is distinct from old.contrato_id
       or new.data_desejada is distinct from old.data_desejada or new.created_at is distinct from old.created_at
       or (new.pessoa_id is distinct from old.pessoa_id and current_setting('portal.juntando', true) is distinct from 'sim')) then
    raise exception 'O pedido que veio pelo portal não pode ser alterado; responda ou exclua.';
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status then
    if new.status in ('concluida','recusada') then
      new.tratado_em := coalesce(new.tratado_em, now());
      new.tratado_por := coalesce(auth.uid(), new.tratado_por);
    elsif new.status = 'nova' then
      new.tratado_em := null;
      new.tratado_por := null;
    end if;
  end if;
  if new.tarefa_id is not null and not exists (select 1 from public.tarefas where id = new.tarefa_id and organizacao_id = new.organizacao_id) then
    raise exception 'Tarefa não encontrada.';
  end if;
  if new.interacao_id is not null and not exists (select 1 from public.pessoa_interacoes where id = new.interacao_id and organizacao_id = new.organizacao_id) then
    raise exception 'Registro não encontrado.';
  end if;
  new.resposta := left(nullif(btrim(new.resposta), ''), 2000);
  return new;
end;
$$;
create or replace trigger portal_solicitacoes_antes_trg before insert or update on public.portal_solicitacoes
  for each row execute function privado.portal_solicitacoes_antes();

/** Documento do corretor: tudo da mesma organização e o arquivo na pasta <org>/<corretor>/. */
create or replace function privado.corretor_documentos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.pessoas where id = new.corretor_id and organizacao_id = new.organizacao_id) then
    raise exception 'Corretor não encontrado.';
  end if;
  if new.cliente_id is not null and not exists (select 1 from public.pessoas where id = new.cliente_id and organizacao_id = new.organizacao_id) then
    raise exception 'Cliente não encontrado.';
  end if;
  if new.lead_id is not null and not exists (select 1 from public.leads where id = new.lead_id and organizacao_id = new.organizacao_id) then
    raise exception 'Lead não encontrado.';
  end if;
  if new.imovel_id is not null and not exists (select 1 from public.imoveis where id = new.imovel_id and organizacao_id = new.organizacao_id) then
    raise exception 'Imóvel não encontrado.';
  end if;
  if left(new.path, 74) <> new.organizacao_id::text || '/' || new.corretor_id::text || '/' or new.path like '%..%' then
    raise exception 'Arquivo fora da pasta do corretor.';
  end if;
  if coalesce(btrim(new.titulo), '') = '' then raise exception 'Dê um nome ao documento.'; end if;
  new.titulo := left(btrim(new.titulo), 160);
  return new;
end;
$$;
create or replace trigger corretor_documentos_antes_trg before insert or update on public.corretor_documentos
  for each row execute function privado.corretor_documentos_antes();

-- -----------------------------------------------------------------------------
-- 5. Funções de apoio do portal (só o dono das funções executa)
-- -----------------------------------------------------------------------------
create or replace function privado.portal_hash(p_sessao text, p_token uuid)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(p_sessao, '') || ':' || p_token::text, 'UTF8')), 'hex')
$$;
revoke execute on function privado.portal_hash(text, uuid) from public, anon, authenticated;

/** Link válido (ativo, dentro da validade; proprietário só na imobiliária) ou nulo. */
create or replace function privado.portal_link(p_token uuid)
returns public.portal_acessos
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
begin
  select * into a from public.portal_acessos where token = p_token;
  if not found or not a.ativo or (a.expira_em is not null and a.expira_em <= now()) then
    return null;
  end if;
  if a.perfil = 'proprietario' and (select modo from public.organizacoes where id = a.organizacao_id) = 'pessoal' then
    return null;
  end if;
  return a;
end;
$$;
revoke execute on function privado.portal_link(uuid) from public, anon, authenticated;

/** Link válido E sessão aberta (cookie) ou nulo. */
create or replace function privado.portal_sessao(p_token uuid, p_sessao text)
returns public.portal_acessos
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
begin
  a := privado.portal_link(p_token);
  if a.id is null or coalesce(length(p_sessao), 0) < 32 then
    return null;
  end if;
  if not exists (select 1 from public.portal_sessoes s
                  where s.acesso_id = a.id and s.hash = privado.portal_hash(p_sessao, a.token) and s.expira_em > now()) then
    return null;
  end if;
  return a;
end;
$$;
revoke execute on function privado.portal_sessao(uuid, text) from public, anon, authenticated;

/** Para as funções que gravam: devolve o acesso ou recusa. */
create or replace function privado.portal_validar(p_token uuid, p_sessao text)
returns public.portal_acessos
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
begin
  a := privado.portal_link(p_token);
  if a.id is null then
    raise exception 'Link inválido ou desativado. Peça um novo link a quem enviou.';
  end if;
  a := privado.portal_sessao(p_token, p_sessao);
  if a.id is null then
    raise exception 'Sessão expirada: confirme seus dados de novo.';
  end if;
  return a;
end;
$$;
revoke execute on function privado.portal_validar(uuid, text) from public, anon, authenticated;

create or replace function privado.portal_endereco(p_imovel uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nullif(concat_ws(', ', nullif(concat_ws(', ', i.logradouro, i.numero), ''), i.complemento, i.bairro, nullif(concat_ws(' / ', i.cidade, i.uf), '')), '')
    from public.imoveis i where i.id = p_imovel
$$;
revoke execute on function privado.portal_endereco(uuid) from public, anon, authenticated;

create or replace function privado.portal_locatario(p_contrato uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select p.nome from public.contrato_partes cp join public.pessoas p on p.id = cp.pessoa_id
   where cp.contrato_id = p_contrato and cp.papel = 'locatario' order by cp.percentual desc nulls last, p.nome limit 1
$$;
revoke execute on function privado.portal_locatario(uuid) from public, anon, authenticated;

/** Imóveis em que a pessoa é proprietária. */
create or replace function privado.portal_imoveis_prop(p_org uuid, p_pessoa uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select imovel_id from public.imovel_proprietarios where organizacao_id = p_org and pessoa_id = p_pessoa
$$;
revoke execute on function privado.portal_imoveis_prop(uuid, uuid) from public, anon, authenticated;

/** Contratos do proprietário: parte do contrato ou dono do imóvel (sem rascunhos). */
create or replace function privado.portal_contratos_prop(p_org uuid, p_pessoa uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.contratos c
   where c.organizacao_id = p_org and c.status <> 'rascunho'
     and (exists (select 1 from public.contrato_partes cp where cp.contrato_id = c.id and cp.pessoa_id = p_pessoa and cp.papel = 'proprietario')
          or c.imovel_id in (select privado.portal_imoveis_prop(p_org, p_pessoa)))
$$;
revoke execute on function privado.portal_contratos_prop(uuid, uuid) from public, anon, authenticated;

/** Contratos do locatário (sem rascunhos). */
create or replace function privado.portal_contratos_loc(p_org uuid, p_pessoa uuid)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.id from public.contratos c
   where c.organizacao_id = p_org and c.status <> 'rascunho'
     and exists (select 1 from public.contrato_partes cp where cp.contrato_id = c.id and cp.pessoa_id = p_pessoa and cp.papel = 'locatario')
$$;
revoke execute on function privado.portal_contratos_loc(uuid, uuid) from public, anon, authenticated;

/** Documentos (texto do sistema) que a pessoa do portal pode ler. Restritos nunca. */
create or replace function privado.portal_documentos(p_org uuid, p_pessoa uuid, p_perfil text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select d.id from public.documentos d
   where d.organizacao_id = p_org and not d.restrito
     and d.status in ('aprovado','aguardando_assinatura','assinado','arquivo')
     and (
       (p_perfil = 'proprietario'
        and (d.pessoa_id = p_pessoa
             or d.contrato_id in (select privado.portal_contratos_prop(p_org, p_pessoa))
             or d.imovel_id in (select privado.portal_imoveis_prop(p_org, p_pessoa))))
       or (p_perfil = 'locatario'
           and d.tipo not in ('venda','administracao','intermediacao','exclusividade','autorizacao','proposta')
           and (d.pessoa_id = p_pessoa or d.contrato_id in (select privado.portal_contratos_loc(p_org, p_pessoa))))
     )
$$;
revoke execute on function privado.portal_documentos(uuid, uuid, text) from public, anon, authenticated;

create or replace function privado.portal_evento(p_acesso public.portal_acessos, p_tipo text, p_descricao text, p_ip text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.portal_eventos (organizacao_id, acesso_id, tipo, descricao, ip, usuario_id)
  values (p_acesso.organizacao_id, p_acesso.id, p_tipo, left(p_descricao, 500), left(p_ip, 64), null)
$$;
revoke execute on function privado.portal_evento(public.portal_acessos, text, text, text) from public, anon, authenticated;

/** Limite de ações por link (por dia), contado no registro de eventos. */
create or replace function privado.portal_limite(p_acesso public.portal_acessos, p_tipo text, p_max int, p_janela interval default interval '1 day')
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.portal_eventos where acesso_id = p_acesso.id and tipo = p_tipo and data > now() - p_janela) >= p_max then
    raise exception 'Limite de envios atingido por hoje. Tente amanhã ou fale com quem enviou o link.';
  end if;
  -- Proteção da organização inteira (muitos links ao mesmo tempo).
  if (select count(*) from public.portal_eventos where organizacao_id = p_acesso.organizacao_id and tipo = p_tipo and data > now() - interval '1 hour') >= 500 then
    raise exception 'Muitos envios agora. Tente de novo mais tarde.';
  end if;
end;
$$;
revoke execute on function privado.portal_limite(public.portal_acessos, text, int, interval) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Entrada no portal (anônimo, por token)
-- -----------------------------------------------------------------------------

/** Para montar a página: o link vale? a sessão está aberta? (sem dados pessoais antes de entrar) */
create or replace function public.portal_inicio(p_token uuid, p_sessao text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
  s public.portal_acessos%rowtype;
  o public.organizacoes%rowtype;
  c record;
  v_nome text;
begin
  a := privado.portal_link(p_token);
  if a.id is null then return null; end if;
  select * into o from public.organizacoes where id = a.organizacao_id;
  select nome into v_nome from public.pessoas where id = a.pessoa_id;
  select * into c from privado.portal_codigo(a.pessoa_id);
  s := privado.portal_sessao(p_token, p_sessao);
  return jsonb_build_object(
    'perfil', a.perfil,
    'modo', o.modo,
    'organizacao', jsonb_build_object('nome', o.nome, 'telefone', o.telefone, 'email', o.email),
    'primeiro_nome', split_part(btrim(coalesce(v_nome, '')), ' ', 1),
    'tipo_codigo', c.tipo,
    'bloqueado_ate', case when a.bloqueado_ate > now() then a.bloqueado_ate end,
    'entrou', s.id is not null,
    'nome', case when s.id is not null then v_nome end,
    'expira_em', a.expira_em
  );
end;
$$;
revoke execute on function public.portal_inicio(uuid, text) from public;
grant execute on function public.portal_inicio(uuid, text) to anon, authenticated;

/**
 * Confirma a identidade e abre uma sessão de 12 horas. Erro de número NÃO usa
 * exception (senão o contador de tentativas seria desfeito): devolve {ok:false}.
 */
create or replace function public.portal_entrar(p_token uuid, p_codigo text, p_ip text default null, p_ua text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
  c record;
  v_digitos text := left(regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g'), 8);
  v_falhas int;
  v_sessao text;
  v_expira timestamptz := now() + interval '12 hours';
begin
  a := privado.portal_link(p_token);
  if a.id is null then
    return jsonb_build_object('ok', false, 'erro', 'Link inválido ou desativado. Peça um novo link a quem enviou.');
  end if;
  select * into a from public.portal_acessos where id = a.id for update;
  if a.bloqueado_ate is not null and a.bloqueado_ate > now() then
    return jsonb_build_object('ok', false, 'bloqueado_ate', a.bloqueado_ate,
      'erro', 'Muitas tentativas erradas. Tente de novo depois das ' || to_char(a.bloqueado_ate at time zone 'America/Sao_Paulo', 'HH24:MI') || '.');
  end if;
  if (select count(*) from public.portal_eventos where organizacao_id = a.organizacao_id and tipo in ('falha','bloqueio') and data > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'erro', 'Muitas tentativas agora. Tente de novo mais tarde.');
  end if;
  if (select count(*) from public.portal_eventos where acesso_id = a.id and tipo = 'entrada' and data > now() - interval '1 day') >= 30 then
    return jsonb_build_object('ok', false, 'erro', 'Limite de acessos de hoje atingido. Tente amanhã ou fale com quem enviou o link.');
  end if;

  select * into c from privado.portal_codigo(a.pessoa_id);
  if c.codigo is null or v_digitos <> c.codigo then
    v_falhas := a.falhas + 1;
    if v_falhas >= 5 then
      update public.portal_acessos set falhas = 0, bloqueado_ate = now() + interval '30 minutes' where id = a.id;
      perform privado.portal_evento(a, 'bloqueio', '5 tentativas erradas: entrada bloqueada por 30 minutos', p_ip);
      return jsonb_build_object('ok', false, 'restantes', 0,
        'erro', 'Números errados 5 vezes. Por segurança, a entrada ficou bloqueada por 30 minutos.');
    end if;
    update public.portal_acessos set falhas = v_falhas where id = a.id;
    perform privado.portal_evento(a, 'falha', 'Tentativa de entrada com números errados', p_ip);
    return jsonb_build_object('ok', false, 'restantes', 5 - v_falhas, 'erro', 'Os números não conferem. Confira e tente de novo.');
  end if;

  v_sessao := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  -- Limpa sessões vencidas e guarda no máximo 10 abertas por link.
  delete from public.portal_sessoes where acesso_id = a.id and expira_em <= now();
  delete from public.portal_sessoes where id in (select id from public.portal_sessoes where acesso_id = a.id order by created_at desc offset 9);
  insert into public.portal_sessoes (organizacao_id, acesso_id, hash, expira_em, ip, user_agent)
  values (a.organizacao_id, a.id, privado.portal_hash(v_sessao, a.token), v_expira, left(p_ip, 64), left(p_ua, 200));
  update public.portal_acessos set falhas = 0, bloqueado_ate = null, ultimo_acesso = now(), acessos = acessos + 1 where id = a.id;
  perform privado.portal_evento(a, 'entrada', 'Entrou no portal', p_ip);
  return jsonb_build_object('ok', true, 'sessao', v_sessao, 'expira_em', v_expira);
end;
$$;
revoke execute on function public.portal_entrar(uuid, text, text, text) from public;
grant execute on function public.portal_entrar(uuid, text, text, text) to anon, authenticated;

create or replace function public.portal_sair(p_token uuid, p_sessao text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
begin
  a := privado.portal_sessao(p_token, p_sessao);
  if a.id is null then return; end if;
  delete from public.portal_sessoes where acesso_id = a.id and hash = privado.portal_hash(p_sessao, a.token);
  perform privado.portal_evento(a, 'saida', 'Saiu do portal');
end;
$$;
revoke execute on function public.portal_sair(uuid, text) from public;
grant execute on function public.portal_sair(uuid, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 7. Leitura por perfil (só os dados daquela pessoa)
-- -----------------------------------------------------------------------------

/** Proprietário (só imobiliária): imóveis, contratos e documentos, aluguéis, repasses, despesas, aprovações e informe. */
create or replace function privado.portal_prop_dados(a public.portal_acessos, p_secao text, p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := a.organizacao_id;
  v_pes uuid := a.pessoa_id;
  v_ano int;
  v_mes date;
  v_id uuid;
begin
  if p_secao = 'inicio' then
    return jsonb_build_object(
      'imoveis', (select count(*) from privado.portal_imoveis_prop(v_org, v_pes)),
      'contratos_ativos', (select count(*) from public.contratos where id in (select privado.portal_contratos_prop(v_org, v_pes)) and status = 'ativo'),
      'a_receber', (select coalesce(sum(valor_liquido), 0) from public.repasses where organizacao_id = v_org and pessoa_id = v_pes and status = 'pendente'),
      'ultimo_repasse', (select jsonb_build_object('valor', valor_liquido, 'pago_em', pago_em, 'competencia', competencia)
                           from public.repasses where organizacao_id = v_org and pessoa_id = v_pes and status = 'pago'
                          order by pago_em desc nulls last limit 1),
      'aprovacoes', (select count(*) from public.chamados ch
                      where ch.organizacao_id = v_org and ch.imovel_id in (select privado.portal_imoveis_prop(v_org, v_pes))
                        and ch.aprovacao_status = 'pendente' and ch.status = 'aguardando_aprovacao'),
      'chamados_abertos', (select count(*) from public.chamados ch
                            where ch.organizacao_id = v_org and ch.imovel_id in (select privado.portal_imoveis_prop(v_org, v_pes))
                              and ch.status in ('aberto','em_analise','aguardando_aprovacao','aprovado','agendado','em_execucao'))
    );
  end if;

  if p_secao = 'imoveis' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'codigo', i.codigo, 'titulo', i.titulo, 'tipo', i.tipo, 'status', i.status, 'endereco', privado.portal_endereco(i.id),
        'percentual', ip.percentual, 'valor_aluguel', i.valor_aluguel, 'valor_venda', i.valor_venda, 'valor_condominio', i.valor_condominio,
        'valor_iptu', i.valor_iptu, 'area_util', i.area_util, 'quartos', i.quartos, 'vagas', i.vagas,
        'contrato', (select jsonb_build_object('numero', c.numero, 'inicio', c.data_inicio, 'fim', c.data_fim, 'valor', c.valor_aluguel,
                                               'locatario', privado.portal_locatario(c.id))
                       from public.contratos c where c.imovel_id = i.id and c.organizacao_id = v_org and c.status = 'ativo'
                      order by c.data_inicio desc limit 1),
        'chamados_abertos', (select count(*) from public.chamados ch where ch.imovel_id = i.id
                              and ch.status in ('aberto','em_analise','aguardando_aprovacao','aprovado','agendado','em_execucao'))
      ) order by i.codigo), '[]'::jsonb)
      from public.imovel_proprietarios ip join public.imoveis i on i.id = ip.imovel_id
     where ip.organizacao_id = v_org and ip.pessoa_id = v_pes);
  end if;

  if p_secao = 'contratos' then
    return jsonb_build_object(
      'contratos', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', c.id, 'numero', c.numero, 'codigo', c.codigo, 'status', c.status, 'inicio', c.data_inicio, 'fim', c.data_fim,
          'valor_aluguel', c.valor_aluguel, 'dia_vencimento', c.dia_vencimento, 'indice', c.indice_reajuste,
          'taxa_administracao_pct', c.taxa_administracao_pct, 'imovel', i.codigo, 'endereco', privado.portal_endereco(i.id),
          'locatario', privado.portal_locatario(c.id),
          'percentual', (select cp.percentual from public.contrato_partes cp where cp.contrato_id = c.id and cp.pessoa_id = v_pes and cp.papel = 'proprietario' limit 1)
        ) order by (c.status = 'ativo') desc, c.data_inicio desc), '[]'::jsonb)
        from public.contratos c join public.imoveis i on i.id = c.imovel_id
       where c.id in (select privado.portal_contratos_prop(v_org, v_pes))),
      'documentos', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', d.id, 'numero', d.numero, 'titulo', d.titulo, 'tipo', d.tipo, 'status', d.status, 'criado_em', d.created_at,
          'assinado_em', d.assinado_em, 'tem_texto', coalesce(btrim(d.conteudo), '') <> '') order by d.created_at desc), '[]'::jsonb)
        from public.documentos d where d.id in (select privado.portal_documentos(v_org, v_pes, 'proprietario')))
    );
  end if;

  if p_secao = 'alugueis' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', f.id, 'numero', f.numero, 'competencia', f.competencia, 'vencimento', f.vencimento, 'valor_total', f.valor_total,
        'valor_abatido', f.valor_abatido, 'status', f.status, 'pago_em', f.pago_em, 'imovel', i.codigo, 'contrato', c.numero,
        'locatario', privado.portal_locatario(c.id)
      ) order by f.competencia desc, i.codigo), '[]'::jsonb)
      from public.faturas f join public.contratos c on c.id = f.contrato_id join public.imoveis i on i.id = c.imovel_id
     where f.contrato_id in (select privado.portal_contratos_prop(v_org, v_pes))
       and f.status <> 'cancelada'
       and f.competencia >= (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '24 months')::date);
  end if;

  if p_secao = 'repasses' then
    v_mes := case when coalesce(p->>'mes', '') ~ '^\d{4}-\d{2}$' then ((p->>'mes') || '-01')::date end;
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id, 'competencia', r.competencia, 'status', r.status, 'aluguel', r.aluguel, 'encargos', r.encargos,
        'multa_juros', r.multa_juros, 'valor_bruto', r.valor_bruto, 'taxa_administracao', r.taxa_administracao,
        'taxa_intermediacao', r.taxa_intermediacao, 'irrf', r.irrf, 'imposto', r.imposto, 'outros_descontos', r.outros_descontos,
        'valor_liquido', r.valor_liquido, 'previsto_para', r.previsto_para, 'programado_para', r.programado_para, 'aprovado_em', r.aprovado_em,
        'pago_em', r.pago_em, 'forma_pagamento', r.forma_pagamento, 'imovel', i.codigo, 'endereco', privado.portal_endereco(i.id),
        'contrato', c.numero,
        'descontos', (select coalesce(jsonb_agg(jsonb_build_object('descricao', d.descricao, 'valor', d.valor, 'tipo', d.tipo) order by d.created_at), '[]'::jsonb)
                        from public.repasse_descontos d where d.repasse_id = r.id)
      ) order by r.competencia desc, i.codigo), '[]'::jsonb)
      from public.repasses r join public.contratos c on c.id = r.contrato_id join public.imoveis i on i.id = c.imovel_id
     where r.organizacao_id = v_org and r.pessoa_id = v_pes and r.status <> 'cancelado'
       and (case when v_mes is not null then r.competencia = v_mes
                 else r.competencia >= (date_trunc('month', (now() at time zone 'America/Sao_Paulo')::date) - interval '24 months')::date end));
  end if;

  if p_secao = 'despesas' then
    return jsonb_build_object(
      'despesas', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', l.id, 'descricao', l.descricao, 'categoria', l.categoria, 'valor', l.valor, 'vencimento', l.vencimento, 'status', l.status,
          'imovel', i.codigo, 'rateada', l.descontar_de_id is null,
          'descontado', case when l.repasse_id is not null then l.valor
                             else (select coalesce(sum(d.valor), 0) from public.repasse_descontos d where d.lancamento_id = l.id) end
        ) order by l.vencimento desc), '[]'::jsonb)
        from public.lancamentos l left join public.imoveis i on i.id = l.imovel_id
       where l.organizacao_id = v_org and l.descontar_repasse and l.status <> 'cancelado'
         and l.imovel_id in (select privado.portal_imoveis_prop(v_org, v_pes))
         and (l.descontar_de_id is null or l.descontar_de_id = v_pes)
         and l.vencimento >= (now() at time zone 'America/Sao_Paulo')::date - 730),
      'chamados', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id, 'numero', x.numero, 'titulo', x.titulo, 'categoria', x.categoria, 'status', x.status, 'criado_em', x.created_at,
          'concluido_em', x.concluido_em, 'valor_aprovado', x.valor_aprovado, 'valor_final', x.valor_final,
          'responsabilidade', x.responsabilidade, 'pct_proprietario', x.pct_proprietario, 'aprovacao_status', x.aprovacao_status,
          'garantia_ate', x.garantia_ate, 'imovel', (select codigo from public.imoveis where id = x.imovel_id)
        ) order by x.created_at desc), '[]'::jsonb)
        from (select * from public.chamados ch where ch.organizacao_id = v_org and ch.imovel_id in (select privado.portal_imoveis_prop(v_org, v_pes))
               order by ch.created_at desc limit 60) x)
    );
  end if;

  if p_secao = 'aprovacoes' then
    return jsonb_build_object(
      'pendentes', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', ch.id, 'numero', ch.numero, 'titulo', ch.titulo, 'descricao', ch.descricao, 'categoria', ch.categoria, 'urgencia', ch.urgencia,
          'local', ch.local, 'criado_em', ch.created_at, 'imovel', i.codigo, 'endereco', privado.portal_endereco(i.id),
          'responsabilidade', ch.responsabilidade, 'pct_proprietario', ch.pct_proprietario, 'pago_direto', ch.pago_direto,
          'valor', ch.valor_aprovado, 'parte_proprietario', round(coalesce(ch.valor_aprovado, 0) * ch.pct_proprietario / 100, 2),
          'orcamento_id', ch.orcamento_id,
          'orcamentos', (select coalesce(jsonb_agg(jsonb_build_object(
              'id', o.id, 'prestador', coalesce(pp.nome, o.prestador_nome), 'especialidade', pp.especialidade, 'valor', o.valor,
              'prazo_dias', o.prazo_dias, 'garantia_dias', o.garantia_dias, 'validade', o.validade, 'descricao', o.descricao,
              'escolhido', o.id = ch.orcamento_id) order by (o.id = ch.orcamento_id) desc, o.valor nulls last), '[]'::jsonb)
            from public.chamado_orcamentos o left join public.pessoas pp on pp.id = o.prestador_id
           where o.chamado_id = ch.id and o.valor is not null)
        ) order by ch.created_at), '[]'::jsonb)
        from public.chamados ch join public.imoveis i on i.id = ch.imovel_id
       where ch.organizacao_id = v_org and ch.imovel_id in (select privado.portal_imoveis_prop(v_org, v_pes))
         and ch.aprovacao_status = 'pendente' and ch.status = 'aguardando_aprovacao'),
      'respondidas', (select coalesce(jsonb_agg(jsonb_build_object(
          'numero', x.numero, 'titulo', x.titulo, 'aprovacao_status', x.aprovacao_status, 'aprovacao_em', x.aprovacao_em,
          'aprovacao_nome', x.aprovacao_nome, 'valor', x.valor_aprovado) order by x.aprovacao_em desc), '[]'::jsonb)
        from (select * from public.chamados ch where ch.organizacao_id = v_org and ch.imovel_id in (select privado.portal_imoveis_prop(v_org, v_pes))
                 and ch.aprovacao_status in ('aprovado','recusado') and ch.aprovacao_em is not null
               order by ch.aprovacao_em desc limit 15) x)
    );
  end if;

  if p_secao = 'informe' then
    v_ano := case when coalesce(p->>'ano', '') ~ '^\d{4}$' then (p->>'ano')::int
                  else extract(year from (now() at time zone 'America/Sao_Paulo'))::int end;
    return jsonb_build_object(
      'ano', v_ano,
      'organizacao', (select jsonb_build_object('nome', nome, 'documento', documento) from public.organizacoes where id = v_org),
      'beneficiario', (select jsonb_build_object('nome', nome, 'documento', documento) from public.pessoas where id = v_pes),
      'linhas', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', r.id, 'competencia', r.competencia, 'fatura_pago_em', f.pago_em, 'fatura_paga', f.status = 'paga',
          'repasse_pago_em', r.pago_em, 'status', r.status, 'contrato', c.numero, 'imovel', i.codigo, 'endereco', privado.portal_endereco(i.id),
          'locatario', (select jsonb_build_object('nome', ps.nome, 'documento', ps.documento)
                          from public.contrato_partes cp join public.pessoas ps on ps.id = cp.pessoa_id
                         where cp.contrato_id = c.id and cp.papel = 'locatario' order by cp.percentual desc nulls last, ps.nome limit 1),
          'aluguel', r.aluguel, 'encargos', r.encargos, 'multa_juros', r.multa_juros, 'taxa_administracao', r.taxa_administracao,
          'taxa_intermediacao', r.taxa_intermediacao, 'irrf', r.irrf, 'imposto', r.imposto, 'outros_descontos', r.outros_descontos,
          'valor_liquido', r.valor_liquido
        ) order by r.competencia, i.codigo), '[]'::jsonb)
        from public.repasses r join public.contratos c on c.id = r.contrato_id join public.imoveis i on i.id = c.imovel_id
        left join public.faturas f on f.id = r.fatura_id
       where r.organizacao_id = v_org and r.pessoa_id = v_pes and r.status <> 'cancelado'
         and extract(year from coalesce(f.pago_em, r.pago_em, r.competencia))::int = v_ano)
    );
  end if;

  if p_secao = 'documento' then
    v_id := case when coalesce(p->>'id', '') ~* '^[0-9a-f-]{36}$' then (p->>'id')::uuid end;
    return (select jsonb_build_object('id', d.id, 'numero', d.numero, 'titulo', d.titulo, 'tipo', d.tipo, 'status', d.status,
                                      'conteudo', d.conteudo, 'assinado_em', d.assinado_em, 'hash', d.hash_final,
                                      'assinar_token', (select s.token from public.documento_signatarios s
                                                         where s.documento_id = d.id and s.pessoa_id = v_pes and s.assinado_em is null
                                                           and s.recusado_em is null and d.status = 'aguardando_assinatura' limit 1))
              from public.documentos d
             where d.id = v_id and d.id in (select privado.portal_documentos(v_org, v_pes, 'proprietario')));
  end if;

  return null;
end;
$$;
revoke execute on function privado.portal_prop_dados(public.portal_acessos, text, jsonb) from public, anon, authenticated;

/** Locatário (nos dois modos): contrato, cobranças e 2ª via, pagamentos, recibos, manutenção e vistorias. */
create or replace function privado.portal_loc_dados(a public.portal_acessos, p_secao text, p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := a.organizacao_id;
  v_pes uuid := a.pessoa_id;
  v_id uuid;
  o public.organizacoes%rowtype;
begin
  v_id := case when coalesce(p->>'id', '') ~* '^[0-9a-f-]{36}$' then (p->>'id')::uuid end;

  if p_secao = 'inicio' then
    return jsonb_build_object(
      'contrato', (select jsonb_build_object('id', c.id, 'numero', c.numero, 'imovel', i.codigo, 'endereco', privado.portal_endereco(i.id),
                                             'valor_aluguel', c.valor_aluguel, 'dia_vencimento', c.dia_vencimento, 'fim', c.data_fim, 'status', c.status)
                     from public.contratos c join public.imoveis i on i.id = c.imovel_id
                    where c.id in (select privado.portal_contratos_loc(v_org, v_pes))
                    order by (c.status = 'ativo') desc, c.data_inicio desc limit 1),
      'proxima', (select jsonb_build_object('id', f.id, 'numero', f.numero, 'competencia', f.competencia, 'vencimento', f.vencimento,
                                            'valor_total', f.valor_total, 'valor_abatido', f.valor_abatido, 'token', f.token_publico)
                    from public.faturas f where f.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes)) and f.status = 'aberta'
                   order by f.vencimento limit 1),
      'em_atraso', (select count(*) from public.faturas f where f.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes))
                      and f.status = 'aberta' and f.vencimento < (now() at time zone 'America/Sao_Paulo')::date),
      'chamados_abertos', (select count(*) from public.chamados ch where ch.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes))
                             and ch.status in ('aberto','em_analise','aguardando_aprovacao','aprovado','agendado','em_execucao')),
      'vistorias', (select count(*) from public.vistorias v where v.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes))
                      and v.status in ('concluida','assinada','contestada'))
    );
  end if;

  if p_secao = 'contrato' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'numero', c.numero, 'codigo', c.codigo, 'status', c.status, 'finalidade', c.finalidade, 'inicio', c.data_inicio,
        'fim', c.data_fim, 'prazo_meses', c.prazo_meses, 'valor_aluguel', c.valor_aluguel, 'dia_vencimento', c.dia_vencimento,
        'indice', c.indice_reajuste, 'data_base_reajuste', c.data_base_reajuste, 'multa_pct', c.multa_atraso_pct, 'juros_mes_pct', c.juros_mes_pct,
        'pontualidade_pct', c.desconto_pontualidade_pct, 'multa_rescisoria_alugueis', c.multa_rescisoria_alugueis,
        'imovel', i.codigo, 'endereco', privado.portal_endereco(i.id),
        'encargos', (select coalesce(jsonb_agg(jsonb_build_object('descricao', e.descricao, 'tipo', e.tipo, 'valor', e.valor) order by e.descricao), '[]'::jsonb)
                       from public.contrato_encargos e where e.contrato_id = c.id and (e.fim is null or e.fim >= (now() at time zone 'America/Sao_Paulo')::date)),
        'garantias', (select coalesce(jsonb_agg(jsonb_build_object('tipo', g.tipo, 'instituicao', g.instituicao, 'valor', g.valor, 'fim', g.fim,
                                                                    'status', g.status, 'fiador', (select nome from public.pessoas where id = g.pessoa_id))
                                                  order by g.created_at), '[]'::jsonb)
                        from public.contrato_garantias g where g.contrato_id = c.id),
        'aditivos', (select coalesce(jsonb_agg(jsonb_build_object('numero', ad.numero, 'tipo', ad.tipo, 'descricao', ad.descricao, 'data', ad.data)
                                                 order by ad.data), '[]'::jsonb)
                       from public.contrato_aditivos ad where ad.contrato_id = c.id),
        'desocupacao', (select jsonb_build_object('status', dz.status, 'entrega_prevista', dz.entrega_prevista, 'aviso_em', dz.aviso_em)
                          from public.contrato_desocupacoes dz where dz.contrato_id = c.id),
        'documentos', (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'titulo', d.titulo, 'tipo', d.tipo, 'status', d.status,
                                                                     'assinado_em', d.assinado_em, 'tem_texto', coalesce(btrim(d.conteudo), '') <> '')
                                                   order by d.created_at desc), '[]'::jsonb)
                         from public.documentos d where d.id in (select privado.portal_documentos(v_org, v_pes, 'locatario'))
                          and (d.contrato_id = c.id or d.contrato_id is null))
      ) order by (c.status = 'ativo') desc, c.data_inicio desc), '[]'::jsonb)
      from public.contratos c join public.imoveis i on i.id = c.imovel_id
     where c.id in (select privado.portal_contratos_loc(v_org, v_pes)));
  end if;

  if p_secao = 'documento' then
    return (select jsonb_build_object('id', d.id, 'numero', d.numero, 'titulo', d.titulo, 'tipo', d.tipo, 'status', d.status,
                                      'conteudo', d.conteudo, 'assinado_em', d.assinado_em, 'hash', d.hash_final,
                                      'assinar_token', (select s.token from public.documento_signatarios s
                                                         where s.documento_id = d.id and s.pessoa_id = v_pes and s.assinado_em is null
                                                           and s.recusado_em is null and d.status = 'aguardando_assinatura' limit 1))
              from public.documentos d
             where d.id = v_id and d.id in (select privado.portal_documentos(v_org, v_pes, 'locatario')));
  end if;

  if p_secao = 'cobrancas' then
    select * into o from public.organizacoes where id = v_org;
    return jsonb_build_object(
      'link_publico', coalesce(o.cobranca_link_publico, true),
      'meios', to_jsonb(o.cobranca_meios),
      'instrucoes', o.cobranca_instrucoes,
      'faturas', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', f.id, 'numero', f.numero, 'competencia', f.competencia, 'vencimento', f.vencimento, 'valor_total', f.valor_total,
          'valor_abatido', f.valor_abatido, 'status', f.status, 'pago_em', f.pago_em, 'valor_pago', f.valor_pago,
          'token', case when f.status = 'aberta' then f.token_publico end,
          'linha_digitavel', f.linha_digitavel, 'url_pagamento', f.url_pagamento, 'imovel', i.codigo
        ) order by (f.status = 'aberta') desc, f.vencimento desc), '[]'::jsonb)
        from public.faturas f join public.contratos c on c.id = f.contrato_id join public.imoveis i on i.id = c.imovel_id
       where f.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes))
         and (f.status in ('aberta','renegociada') or (f.status = 'paga' and f.pago_em >= (now() at time zone 'America/Sao_Paulo')::date - 190))),
      'parcelas', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', pc.id, 'numero', pc.numero, 'vencimento', pc.vencimento, 'valor', pc.valor, 'token', pc.token_publico, 'acordo', ac.numero, 'parcelas', ac.parcelas
        ) order by pc.vencimento), '[]'::jsonb)
        from public.acordo_parcelas pc join public.acordos ac on ac.id = pc.acordo_id
       where ac.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes)) and ac.organizacao_id = v_org and pc.status = 'aberta')
    );
  end if;

  -- 2ª via dentro do portal (aluguel ou parcela de acordo DELE), com os dados do
  -- Pix: a sessão já foi confirmada, então NÃO depende do "link público da 2ª
  -- via" das Cobranças. Mesmo formato de public.segunda_via.
  if p_secao = 'pagar' then
    declare
      f public.faturas%rowtype;
      pc public.acordo_parcelas%rowtype;
      ac public.acordos%rowtype;
      c public.contratos%rowtype;
      im public.imoveis%rowtype;
      cf public.contas_financeiras%rowtype;
      v_contrato uuid;
      v_tipo text;
    begin
      if v_id is null then return null; end if;
      select * into f from public.faturas
       where id = v_id and organizacao_id = v_org and status <> 'cancelada'
         and contrato_id in (select privado.portal_contratos_loc(v_org, v_pes));
      if found then
        v_tipo := 'fatura';
        v_contrato := f.contrato_id;
      else
        select pc2.* into pc from public.acordo_parcelas pc2 join public.acordos a2 on a2.id = pc2.acordo_id
         where pc2.id = v_id and pc2.organizacao_id = v_org and pc2.status <> 'cancelada'
           and a2.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes));
        if not found then return null; end if;
        select * into ac from public.acordos where id = pc.acordo_id;
        v_tipo := 'parcela';
        v_contrato := ac.contrato_id;
      end if;
      select * into o from public.organizacoes where id = v_org;
      select * into c from public.contratos where id = v_contrato;
      select * into im from public.imoveis where id = c.imovel_id;
      select * into cf from public.contas_financeiras where id = o.cobranca_conta_id;
      return jsonb_build_object(
        'tipo', v_tipo,
        'token', coalesce(f.token_publico, pc.token_publico),
        'link_publico', coalesce(o.cobranca_link_publico, true),
        'organizacao', jsonb_build_object('nome', o.nome, 'documento', o.documento, 'telefone', o.telefone, 'email', o.email,
          'pix_chave', coalesce(nullif(o.cobranca_pix_chave, ''), cf.pix_chave), 'pix_nome', coalesce(nullif(o.cobranca_pix_nome, ''), o.nome),
          'pix_cidade', o.cobranca_pix_cidade, 'meios', to_jsonb(o.cobranca_meios), 'instrucoes', o.cobranca_instrucoes,
          'banco', cf.banco, 'agencia', cf.agencia, 'conta', cf.conta, 'modo', o.modo),
        'imovel', jsonb_build_object('codigo', im.codigo, 'logradouro', im.logradouro, 'numero', im.numero, 'complemento', im.complemento,
          'bairro', im.bairro, 'cidade', im.cidade, 'uf', im.uf),
        'locatario', privado.portal_locatario(v_contrato),
        'contrato', jsonb_build_object('numero', c.numero, 'multa_pct', c.multa_atraso_pct, 'juros_mes_pct', c.juros_mes_pct,
          'carencia_dias', c.carencia_dias, 'pontualidade_pct', c.desconto_pontualidade_pct, 'valor_aluguel', c.valor_aluguel),
        'fatura', case when v_tipo = 'fatura' then jsonb_build_object(
          'numero', f.numero, 'competencia', f.competencia, 'vencimento', f.vencimento, 'valor_total', f.valor_total,
          'valor_abatido', f.valor_abatido, 'valor_recebido', f.valor_recebido, 'status', f.status, 'pago_em', f.pago_em,
          'valor_pago', f.valor_pago, 'linha_digitavel', f.linha_digitavel, 'url_pagamento', f.url_pagamento,
          'periodo_inicio', f.periodo_inicio, 'periodo_fim', f.periodo_fim,
          'itens', (select coalesce(jsonb_agg(jsonb_build_object('descricao', it.descricao, 'valor', it.valor, 'tipo', it.tipo) order by it.valor desc), '[]'::jsonb)
                      from public.fatura_itens it where it.fatura_id = f.id),
          'multa_cobrada', (select coalesce(sum(pg.multa), 0) from public.fatura_pagamentos pg where pg.fatura_id = f.id),
          'ultimo_pagamento', (select max(pg.pago_em) from public.fatura_pagamentos pg where pg.fatura_id = f.id and pg.pago_em > f.vencimento)
        ) end,
        'parcela', case when v_tipo = 'parcela' then jsonb_build_object(
          'numero', pc.numero, 'vencimento', pc.vencimento, 'valor', pc.valor, 'status', pc.status, 'pago_em', pc.pago_em,
          'acordo', ac.numero, 'parcelas', ac.parcelas, 'tem_entrada', ac.entrada > 0
        ) end
      );
    end;
  end if;

  if p_secao = 'pagamentos' then
    return jsonb_build_object(
      'recebimentos', (select coalesce(jsonb_agg(jsonb_build_object(
          'fatura_id', f.id, 'fatura', f.numero, 'competencia', f.competencia, 'pago_em', pg.pago_em, 'valor', pg.valor,
          'principal', pg.principal, 'multa', pg.multa, 'juros', pg.juros, 'desconto', pg.desconto, 'forma', pg.forma, 'status_fatura', f.status
        ) order by pg.pago_em desc, f.numero desc), '[]'::jsonb)
        from public.fatura_pagamentos pg join public.faturas f on f.id = pg.fatura_id
       where f.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes)) and pg.pago_em >= (now() at time zone 'America/Sao_Paulo')::date - 1100),
      'antigos', (select coalesce(jsonb_agg(jsonb_build_object(
          'fatura_id', f.id, 'fatura', f.numero, 'competencia', f.competencia, 'pago_em', f.pago_em, 'valor', coalesce(f.valor_pago, f.valor_total),
          'forma', f.forma_pagamento) order by f.pago_em desc), '[]'::jsonb)
        from public.faturas f
       where f.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes)) and f.status = 'paga' and f.pago_em is not null
         and f.pago_em >= (now() at time zone 'America/Sao_Paulo')::date - 1100
         and not exists (select 1 from public.fatura_pagamentos x where x.fatura_id = f.id))
    );
  end if;

  if p_secao = 'recibo' then
    return (select jsonb_build_object(
        'organizacao', (select jsonb_build_object('nome', og.nome, 'documento', og.documento, 'telefone', og.telefone, 'email', og.email, 'modo', og.modo)
                          from public.organizacoes og where og.id = v_org),
        'locatario', (select jsonb_build_object('nome', ps.nome, 'documento', ps.documento) from public.pessoas ps where ps.id = v_pes),
        'imovel', i.codigo, 'endereco', privado.portal_endereco(i.id), 'contrato', c.numero,
        'fatura', jsonb_build_object('numero', f.numero, 'competencia', f.competencia, 'vencimento', f.vencimento, 'valor_total', f.valor_total,
                                     'valor_abatido', f.valor_abatido, 'status', f.status, 'pago_em', f.pago_em, 'valor_pago', f.valor_pago,
                                     'periodo_inicio', f.periodo_inicio, 'periodo_fim', f.periodo_fim, 'forma', f.forma_pagamento),
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('descricao', it.descricao, 'valor', it.valor, 'tipo', it.tipo) order by it.valor desc), '[]'::jsonb)
                    from public.fatura_itens it where it.fatura_id = f.id),
        'pagamentos', (select coalesce(jsonb_agg(jsonb_build_object('pago_em', pg.pago_em, 'valor', pg.valor, 'forma', pg.forma,
                                                                     'multa', pg.multa, 'juros', pg.juros, 'desconto', pg.desconto) order by pg.pago_em), '[]'::jsonb)
                         from public.fatura_pagamentos pg where pg.fatura_id = f.id)
      )
      from public.faturas f join public.contratos c on c.id = f.contrato_id join public.imoveis i on i.id = c.imovel_id
     where f.id = v_id and f.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes))
       and (f.status = 'paga' or f.valor_abatido > 0));
  end if;

  if p_secao = 'manutencao' then
    return jsonb_build_object(
      'contratos', (select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'numero', c.numero, 'imovel', i.codigo) order by c.data_inicio desc), '[]'::jsonb)
                      from public.contratos c join public.imoveis i on i.id = c.imovel_id
                     where c.id in (select privado.portal_contratos_loc(v_org, v_pes)) and c.status = 'ativo'),
      'chamados', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id, 'numero', x.numero, 'titulo', x.titulo, 'categoria', x.categoria, 'urgencia', x.urgencia, 'status', x.status,
          'criado_em', x.created_at, 'agendado_para', x.agendado_para, 'concluido_em', x.concluido_em, 'garantia_ate', x.garantia_ate,
          'confirmado', x.locatario_confirmou_em is not null, 'imovel', (select codigo from public.imoveis where id = x.imovel_id)
        ) order by x.created_at desc), '[]'::jsonb)
        from (select * from public.chamados ch where ch.organizacao_id = v_org and ch.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes))
               order by ch.created_at desc limit 30) x)
    );
  end if;

  if p_secao = 'vistorias' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'numero', v.numero, 'tipo', v.tipo, 'status', v.status, 'data', v.data, 'imovel', i.codigo,
        'contestacao_ate', v.contestacao_ate,
        'contestar_token', case when v.status in ('concluida','assinada') and (v.contestacao_ate is null or v.contestacao_ate >= (now() at time zone 'America/Sao_Paulo')::date)
                                then v.contestacao_token end
      ) order by v.data desc), '[]'::jsonb)
      from public.vistorias v join public.imoveis i on i.id = v.imovel_id
     where v.organizacao_id = v_org and v.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes))
       and v.status in ('concluida','assinada','contestada'));
  end if;

  if p_secao = 'vistoria' then
    return (select jsonb_build_object(
        'id', v.id, 'numero', v.numero, 'tipo', v.tipo, 'status', v.status, 'data', v.data, 'imovel', i.codigo,
        'endereco', privado.portal_endereco(i.id), 'responsavel', v.responsavel_nome, 'acompanhante', v.acompanhante,
        'observacoes', v.observacoes, 'conclusao', v.conclusao, 'contestacao_ate', v.contestacao_ate,
        'contestar_token', case when v.status in ('concluida','assinada') and (v.contestacao_ate is null or v.contestacao_ate >= (now() at time zone 'America/Sao_Paulo')::date)
                                then v.contestacao_token end,
        'ambientes', (select coalesce(jsonb_agg(jsonb_build_object(
            'nome', am.nome, 'observacoes', am.observacoes,
            'itens', (select coalesce(jsonb_agg(jsonb_build_object('nome', it.nome, 'estado', it.estado, 'observacao', it.observacao) order by it.ordem, it.nome), '[]'::jsonb)
                        from public.vistoria_itens it where it.ambiente_id = am.id)
          ) order by am.ordem, am.nome), '[]'::jsonb)
          from public.vistoria_ambientes am where am.vistoria_id = v.id),
        'medidores', (select coalesce(jsonb_agg(jsonb_build_object('tipo', m.tipo, 'numero', m.numero, 'leitura', m.leitura, 'observacao', m.observacao)), '[]'::jsonb)
                        from public.vistoria_medidores m where m.vistoria_id = v.id),
        'pendencias', (select coalesce(jsonb_agg(jsonb_build_object('descricao', pd.descricao, 'tipo', pd.tipo, 'responsavel', pd.responsavel,
                                                                     'status', pd.status, 'prazo', pd.prazo) order by pd.created_at), '[]'::jsonb)
                         from public.vistoria_pendencias pd where pd.vistoria_id = v.id and pd.status <> 'cancelada')
      )
      from public.vistorias v join public.imoveis i on i.id = v.imovel_id
     where v.id = v_id and v.organizacao_id = v_org and v.contrato_id in (select privado.portal_contratos_loc(v_org, v_pes))
       and v.status in ('concluida','assinada','contestada'));
  end if;

  return null;
end;
$$;
revoke execute on function privado.portal_loc_dados(public.portal_acessos, text, jsonb) from public, anon, authenticated;

/** Prestador (nos dois modos): ordens de serviço, pedidos de orçamento e pagamentos. */
create or replace function privado.portal_prest_dados(a public.portal_acessos, p_secao text, p jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := a.organizacao_id;
  v_pes uuid := a.pessoa_id;
  v_id uuid;
  ch public.chamados%rowtype;
  v_designado boolean;
begin
  v_id := case when coalesce(p->>'id', '') ~* '^[0-9a-f-]{36}$' then (p->>'id')::uuid end;

  if p_secao = 'inicio' then
    return jsonb_build_object(
      'pedidos', (select count(*) from public.chamado_orcamentos o join public.chamados x on x.id = o.chamado_id
                   where o.organizacao_id = v_org and o.prestador_id = v_pes and o.status = 'solicitado' and x.status in ('aberto','em_analise')),
      'em_andamento', (select count(*) from public.chamados x where x.organizacao_id = v_org and x.prestador_id = v_pes
                         and x.status in ('aprovado','agendado','em_execucao')),
      'a_receber', (select coalesce(sum(valor), 0) from public.lancamentos where organizacao_id = v_org and pessoa_id = v_pes
                      and tipo = 'pagar' and status = 'aberto'),
      'proximo', (select jsonb_build_object('id', x.id, 'numero', x.numero, 'titulo', x.titulo, 'agendado_para', x.agendado_para)
                    from public.chamados x where x.organizacao_id = v_org and x.prestador_id = v_pes and x.status = 'agendado'
                     and x.agendado_para >= now() - interval '12 hours' order by x.agendado_para limit 1)
    );
  end if;

  if p_secao = 'ordens' then
    return jsonb_build_object(
      'servicos', (select coalesce(jsonb_agg(jsonb_build_object(
          'id', x.id, 'numero', x.numero, 'titulo', x.titulo, 'categoria', x.categoria, 'urgencia', x.urgencia, 'status', x.status,
          'agendado_para', x.agendado_para, 'valor_aprovado', x.valor_aprovado, 'concluido_em', x.concluido_em,
          'prestador_concluiu_em', x.prestador_concluiu_em, 'aprovacao_status', x.aprovacao_status,
          'bairro', (select concat_ws(' · ', bairro, cidade) from public.imoveis where id = x.imovel_id)
        ) order by x.created_at desc), '[]'::jsonb)
        from (select * from public.chamados c where c.organizacao_id = v_org and c.prestador_id = v_pes and c.status not in ('recusado')
               order by c.created_at desc limit 60) x),
      'pedidos', (select coalesce(jsonb_agg(jsonb_build_object(
          'orcamento_id', o.id, 'id', x.id, 'numero', x.numero, 'titulo', x.titulo, 'categoria', x.categoria, 'urgencia', x.urgencia,
          'solicitado_em', o.solicitado_em, 'status', o.status, 'valor', o.valor, 'prazo_dias', o.prazo_dias, 'garantia_dias', o.garantia_dias,
          'validade', o.validade, 'descricao', o.descricao,
          'bairro', (select concat_ws(' · ', bairro, cidade) from public.imoveis where id = x.imovel_id)
        ) order by o.solicitado_em desc), '[]'::jsonb)
        from public.chamado_orcamentos o join public.chamados x on x.id = o.chamado_id
       where o.organizacao_id = v_org and o.prestador_id = v_pes and o.status in ('solicitado','recebido') and x.status in ('aberto','em_analise'))
    );
  end if;

  if p_secao = 'ordem' then
    select * into ch from public.chamados where id = v_id and organizacao_id = v_org;
    if not found then return null; end if;
    v_designado := ch.prestador_id = v_pes;
    if not v_designado and not exists (select 1 from public.chamado_orcamentos o where o.chamado_id = ch.id and o.prestador_id = v_pes) then
      return null;
    end if;
    return jsonb_build_object(
      'id', ch.id, 'numero', ch.numero, 'titulo', ch.titulo, 'descricao', ch.descricao, 'local', ch.local, 'categoria', ch.categoria,
      'urgencia', ch.urgencia, 'status', ch.status, 'aprovacao_status', ch.aprovacao_status, 'designado', v_designado,
      'criado_em', ch.created_at, 'agendado_para', case when v_designado then ch.agendado_para end,
      'iniciado_em', case when v_designado then ch.iniciado_em end,
      'prestador_concluiu_em', case when v_designado then ch.prestador_concluiu_em end,
      'prestador_comentario', case when v_designado then ch.prestador_comentario end,
      'concluido_em', ch.concluido_em, 'garantia_ate', case when v_designado then ch.garantia_ate end,
      'valor_aprovado', case when v_designado then ch.valor_aprovado end,
      'imovel', (select codigo from public.imoveis where id = ch.imovel_id),
      'endereco', privado.portal_endereco(ch.imovel_id),
      'contato', case when v_designado and ch.status in ('aprovado','agendado','em_execucao') then
                   coalesce(
                     (select jsonb_build_object('nome', ch.solicitante_nome, 'telefone', ch.solicitante_telefone) where coalesce(ch.solicitante_telefone, '') <> ''),
                     (select jsonb_build_object('nome', ps.nome, 'telefone', ps.telefone)
                        from public.contrato_partes cp join public.pessoas ps on ps.id = cp.pessoa_id
                       where cp.contrato_id = ch.contrato_id and cp.papel = 'locatario' and coalesce(ps.telefone, '') <> ''
                       order by cp.percentual desc nulls last limit 1)) end,
      'organizacao', (select jsonb_build_object('nome', og.nome, 'documento', og.documento, 'telefone', og.telefone, 'email', og.email, 'modo', og.modo)
                        from public.organizacoes og where og.id = v_org),
      'prestador', (select jsonb_build_object('nome', ps.nome, 'documento', ps.documento, 'telefone', ps.telefone, 'especialidade', ps.especialidade)
                      from public.pessoas ps where ps.id = v_pes),
      'escolhido', case when v_designado then (select jsonb_build_object('valor', o.valor, 'prazo_dias', o.prazo_dias, 'garantia_dias', o.garantia_dias,
                                                                         'descricao', o.descricao)
                                                  from public.chamado_orcamentos o where o.id = ch.orcamento_id) end,
      'meus_orcamentos', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'status', o.status, 'valor', o.valor, 'prazo_dias', o.prazo_dias,
                                                                         'garantia_dias', o.garantia_dias, 'validade', o.validade, 'descricao', o.descricao,
                                                                         'solicitado_em', o.solicitado_em, 'recebido_em', o.recebido_em)
                                                       order by o.solicitado_em), '[]'::jsonb)
                            from public.chamado_orcamentos o where o.chamado_id = ch.id and o.prestador_id = v_pes),
      'fotos', (select count(*) from public.chamado_midias m where m.chamado_id = ch.id and m.portal_pessoa_id = v_pes),
      'pode_orcar', ch.status in ('aberto','em_analise'),
      'pode_iniciar', v_designado and ch.status in ('aprovado','agendado') and ch.aprovacao_status <> 'pendente',
      'pode_concluir', v_designado and ch.status in ('aprovado','agendado','em_execucao') and ch.aprovacao_status <> 'pendente',
      'pode_fotos', v_designado and ch.status in ('aprovado','agendado','em_execucao','concluido')
    );
  end if;

  if p_secao = 'pagamentos' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'descricao', l.descricao, 'valor', l.valor, 'vencimento', l.vencimento, 'status', l.status, 'liquidado_em', l.liquidado_em,
        'chamado', (select numero from public.chamados where id = l.chamado_id)
      ) order by l.vencimento desc), '[]'::jsonb)
      from public.lancamentos l
     where l.organizacao_id = v_org and l.pessoa_id = v_pes and l.tipo = 'pagar' and l.status <> 'cancelado'
       and l.vencimento >= (now() at time zone 'America/Sao_Paulo')::date - 730);
  end if;

  return null;
end;
$$;
revoke execute on function privado.portal_prest_dados(public.portal_acessos, text, jsonb) from public, anon, authenticated;

/**
 * Leitura do portal. Devolve {erro:'link'} (link inválido), {erro:'sessao'}
 * (precisa confirmar a identidade de novo) ou os dados da seção. Seções comuns:
 * 'arquivos' (compartilhados pela equipe, dentro da validade) e 'solicitacoes'.
 */
create or replace function public.portal_dados(p_token uuid, p_sessao text, p_secao text, p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
begin
  a := privado.portal_link(p_token);
  if a.id is null then return jsonb_build_object('erro', 'link'); end if;
  a := privado.portal_sessao(p_token, p_sessao);
  if a.id is null then return jsonb_build_object('erro', 'sessao'); end if;

  if p_secao = 'arquivos' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', f.id, 'titulo', f.titulo, 'url', f.url, 'expira_em', f.expira_em, 'criado_em', f.created_at)
                                      order by f.created_at desc), '[]'::jsonb)
              from public.portal_arquivos f where f.acesso_id = a.id and f.expira_em > now());
  end if;
  if p_secao = 'solicitacoes' then
    return (select coalesce(jsonb_agg(jsonb_build_object('numero', s.numero, 'tipo', s.tipo, 'mensagem', s.mensagem, 'status', s.status,
                                                         'resposta', s.resposta, 'criado_em', s.created_at, 'data_desejada', s.data_desejada,
                                                         'tratado_em', s.tratado_em) order by s.created_at desc), '[]'::jsonb)
              from (select * from public.portal_solicitacoes x where x.organizacao_id = a.organizacao_id
                       and (x.acesso_id = a.id or (x.pessoa_id = a.pessoa_id and x.perfil = a.perfil))
                     order by x.created_at desc limit 30) s);
  end if;
  if a.perfil = 'proprietario' then return privado.portal_prop_dados(a, p_secao, coalesce(p, '{}'::jsonb)); end if;
  if a.perfil = 'locatario' then return privado.portal_loc_dados(a, p_secao, coalesce(p, '{}'::jsonb)); end if;
  return privado.portal_prest_dados(a, p_secao, coalesce(p, '{}'::jsonb));
end;
$$;
revoke execute on function public.portal_dados(uuid, text, text, jsonb) from public;
grant execute on function public.portal_dados(uuid, text, text, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 8. Escrita pelo portal
-- -----------------------------------------------------------------------------

/**
 * Pedido para a equipe. Locatário: renovação, desocupação ou contato (com o
 * contrato). Proprietário e prestador: contato. Vira item em /portais/solicitacoes.
 * p: { tipo, contrato_id, mensagem, data_desejada }
 */
create or replace function public.portal_solicitar(p_token uuid, p_sessao text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
  v_tipo text := coalesce(p->>'tipo', 'contato');
  v_msg text := left(btrim(coalesce(p->>'mensagem', '')), 2000);
  v_contrato uuid;
  v_imovel uuid;
  v_data date;
  v_num bigint;
begin
  a := privado.portal_validar(p_token, p_sessao);
  perform privado.portal_limite(a, 'solicitacao', 5);
  if v_tipo not in ('renovacao','desocupacao','contato') or (a.perfil <> 'locatario' and v_tipo <> 'contato') then
    raise exception 'Tipo de pedido inválido.';
  end if;
  if coalesce(p->>'contrato_id', '') ~* '^[0-9a-f-]{36}$' then
    select c.id, c.imovel_id into v_contrato, v_imovel from public.contratos c
     where c.id = (p->>'contrato_id')::uuid
       and ((a.perfil = 'locatario' and c.id in (select privado.portal_contratos_loc(a.organizacao_id, a.pessoa_id)))
            or (a.perfil = 'proprietario' and c.id in (select privado.portal_contratos_prop(a.organizacao_id, a.pessoa_id))));
  end if;
  if v_tipo in ('renovacao','desocupacao') then
    if v_contrato is null then raise exception 'Escolha o contrato.'; end if;
    if (select status from public.contratos where id = v_contrato) <> 'ativo' then
      raise exception 'Este contrato não está ativo.';
    end if;
    if exists (select 1 from public.portal_solicitacoes where contrato_id = v_contrato and tipo = v_tipo and status in ('nova','em_andamento')) then
      raise exception 'Já existe um pedido igual em andamento para este contrato. Aguarde o retorno.';
    end if;
  end if;
  if coalesce(p->>'data_desejada', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_data := (p->>'data_desejada')::date;
    if v_data < (now() at time zone 'America/Sao_Paulo')::date or v_data > (now() at time zone 'America/Sao_Paulo')::date + 730 then raise exception 'Data inválida.'; end if;
  end if;
  if v_tipo = 'contato' and length(v_msg) < 3 then raise exception 'Escreva a sua mensagem.'; end if;
  if v_msg = '' then
    v_msg := case v_tipo when 'renovacao' then 'Quero renovar o contrato.' else 'Quero entregar o imóvel (desocupação).' end;
  end if;
  insert into public.portal_solicitacoes (organizacao_id, acesso_id, pessoa_id, perfil, contrato_id, imovel_id, tipo, mensagem, data_desejada)
  values (a.organizacao_id, a.id, a.pessoa_id, a.perfil, v_contrato, v_imovel, v_tipo, v_msg, v_data)
  returning numero into v_num;
  perform privado.portal_evento(a, 'solicitacao', 'Pedido nº ' || v_num || ' (' || v_tipo || ') enviado pelo portal');
  return jsonb_build_object('ok', true, 'numero', v_num);
end;
$$;
revoke execute on function public.portal_solicitar(uuid, text, jsonb) from public;
grant execute on function public.portal_solicitar(uuid, text, jsonb) to anon, authenticated;

/** Pasta liberada por 2 horas para enviar fotos de um chamado. */
create or replace function privado.portal_nova_pasta(a public.portal_acessos, p_chamado uuid, p_momento text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  perform privado.portal_limite(a, 'pasta', 20);
  insert into public.portal_envios (organizacao_id, acesso_id, chamado_id, momento)
  values (a.organizacao_id, a.id, p_chamado, p_momento) returning id into v_id;
  perform privado.portal_evento(a, 'pasta', 'Envio de fotos liberado');
  return jsonb_build_object('envio', v_id, 'pasta', a.organizacao_id::text || '/' || p_chamado::text || '/' || v_id::text);
end;
$$;
revoke execute on function privado.portal_nova_pasta(public.portal_acessos, uuid, text) from public, anon, authenticated;

/**
 * Locatário pede conserto pelo portal (mesmo fluxo do link do contrato).
 * p: { contrato_id, titulo, categoria, urgencia, local, descricao, telefone }
 */
create or replace function public.portal_abrir_chamado(p_token uuid, p_sessao text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
  c public.contratos%rowtype;
  v_titulo text := left(btrim(coalesce(p->>'titulo', '')), 160);
  v_cat text := coalesce(p->>'categoria', 'outros');
  v_urg text := coalesce(p->>'urgencia', 'media');
  v_nome text;
  v_tel text;
  v_origem uuid;
  v_id uuid;
  v_numero bigint;
  v_pasta jsonb;
begin
  a := privado.portal_validar(p_token, p_sessao);
  if a.perfil <> 'locatario' then raise exception 'Só o locatário abre chamados pelo portal.'; end if;
  if coalesce(p->>'contrato_id', '') !~* '^[0-9a-f-]{36}$' then raise exception 'Escolha o contrato.'; end if;
  select * into c from public.contratos
   where id = (p->>'contrato_id')::uuid and id in (select privado.portal_contratos_loc(a.organizacao_id, a.pessoa_id));
  if not found then raise exception 'Contrato não encontrado.'; end if;
  if c.status <> 'ativo' then raise exception 'Este contrato não está ativo. Fale com a administração do imóvel.'; end if;
  if length(v_titulo) < 3 then raise exception 'Diga em poucas palavras qual é o problema.'; end if;
  if v_cat not in ('hidraulica','eletrica','telhado','eletrodomestico','pintura','chaveiro','outros') then v_cat := 'outros'; end if;
  if v_urg not in ('baixa','media','alta','emergencia') then v_urg := 'media'; end if;
  if (select count(*) from public.chamados where contrato_id = c.id and organizacao_id = a.organizacao_id and origem = 'link'
        and created_at > now() - interval '1 day') >= 10 then
    raise exception 'Muitos chamados abertos hoje para este contrato. Fale com a administração do imóvel.';
  end if;
  perform privado.portal_limite(a, 'chamado', 10);
  select nome, telefone into v_nome, v_tel from public.pessoas where id = a.pessoa_id;
  select id into v_origem from public.chamados
   where organizacao_id = a.organizacao_id and imovel_id = c.imovel_id and categoria = v_cat
     and status in ('concluido','avaliado') and garantia_ate >= (now() at time zone 'America/Sao_Paulo')::date
   order by garantia_ate desc limit 1;
  insert into public.chamados (organizacao_id, imovel_id, contrato_id, origem, aberto_por, solicitante_pessoa_id, solicitante_nome,
                               solicitante_telefone, categoria, urgencia, titulo, descricao, local, chamado_origem_id, criado_por)
  values (a.organizacao_id, c.imovel_id, c.id, 'link', 'locatario', a.pessoa_id, left(v_nome, 160),
          left(coalesce(nullif(btrim(p->>'telefone'), ''), v_tel), 40), v_cat, v_urg, v_titulo,
          left(nullif(btrim(p->>'descricao'), ''), 4000), left(nullif(btrim(p->>'local'), ''), 120), v_origem, null)
  returning id, numero into v_id, v_numero;
  insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
  values (a.organizacao_id, v_id, 'portal', 'Aberto pelo portal do locatário', null);
  perform privado.portal_evento(a, 'chamado', 'Chamado de manutenção nº ' || v_numero || ' aberto pelo portal');
  v_pasta := privado.portal_nova_pasta(a, v_id, 'antes');
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'garantia', v_origem is not null) || v_pasta;
end;
$$;
revoke execute on function public.portal_abrir_chamado(uuid, text, jsonb) from public;
grant execute on function public.portal_abrir_chamado(uuid, text, jsonb) to anon, authenticated;

/** Libera uma pasta para fotos: locatário (antes, chamado do contrato dele) ou prestador (depois, serviço dele). */
create or replace function public.portal_preparar_envio(p_token uuid, p_sessao text, p_chamado uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
  ch public.chamados%rowtype;
begin
  a := privado.portal_validar(p_token, p_sessao);
  select * into ch from public.chamados where id = p_chamado and organizacao_id = a.organizacao_id;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if a.perfil = 'locatario' then
    if ch.contrato_id is null or ch.contrato_id not in (select privado.portal_contratos_loc(a.organizacao_id, a.pessoa_id)) then
      raise exception 'Chamado não encontrado.';
    end if;
    if ch.status not in ('aberto','em_analise','aguardando_aprovacao','aprovado','agendado') then
      raise exception 'Este chamado não recebe mais fotos.';
    end if;
    return privado.portal_nova_pasta(a, ch.id, 'antes');
  elsif a.perfil = 'prestador' then
    if ch.prestador_id is distinct from a.pessoa_id then raise exception 'Chamado não encontrado.'; end if;
    if ch.status not in ('aprovado','agendado','em_execucao','concluido') then
      raise exception 'Este serviço não recebe fotos agora.';
    end if;
    return privado.portal_nova_pasta(a, ch.id, 'depois');
  end if;
  raise exception 'Envio de fotos não disponível.';
end;
$$;
revoke execute on function public.portal_preparar_envio(uuid, text, uuid) from public;
grant execute on function public.portal_preparar_envio(uuid, text, uuid) to anon, authenticated;

/**
 * Storage (bucket "manutencao"): o visitante só GRAVA em <org>/<chamado>/<envio>/<arquivo>
 * de uma pasta liberada há menos de 2 horas, com no máximo 20 arquivos. Nunca lê.
 */
create or replace function public.portal_pode_enviar(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partes text[] := string_to_array(coalesce(p_nome, ''), '/');
  v_uuid text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_n int := 0;
begin
  if coalesce(array_length(v_partes, 1), 0) <> 4 or p_nome like '%..%' or coalesce(v_partes[4], '') = '' or length(p_nome) > 300 then
    return false;
  end if;
  if v_partes[1] !~ v_uuid or v_partes[2] !~ v_uuid or v_partes[3] !~ v_uuid then return false; end if;
  if not exists (select 1 from public.portal_envios e join public.portal_acessos a on a.id = e.acesso_id
                  where e.id = v_partes[3]::uuid and e.organizacao_id = v_partes[1]::uuid and e.chamado_id = v_partes[2]::uuid
                    and e.expira_em > now() and a.ativo) then
    return false;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects where bucket_id = ''manutencao'' and name like $1'
      into v_n using v_partes[1] || '/' || v_partes[2] || '/' || v_partes[3] || '/%';
  end if;
  return v_n < 20;
end;
$$;
revoke execute on function public.portal_pode_enviar(text) from public;
grant execute on function public.portal_pode_enviar(text) to anon, authenticated;

/** Registra a foto/vídeo que o navegador acabou de enviar para a pasta liberada. */
create or replace function public.portal_registrar_midia(p_token uuid, p_sessao text, p_envio uuid, p_path text, p_nome text, p_tipo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
  e public.portal_envios%rowtype;
  v_pasta text;
begin
  a := privado.portal_validar(p_token, p_sessao);
  select * into e from public.portal_envios where id = p_envio and acesso_id = a.id;
  if not found or e.expira_em <= now() then raise exception 'O envio expirou. Tente de novo.'; end if;
  v_pasta := e.organizacao_id::text || '/' || e.chamado_id::text || '/' || e.id::text || '/';
  if left(coalesce(p_path, ''), length(v_pasta)) <> v_pasta or p_path like '%..%' or array_length(string_to_array(p_path, '/'), 1) <> 4 then
    raise exception 'Não foi possível registrar o arquivo.';
  end if;
  if exists (select 1 from public.chamado_midias where chamado_id = e.chamado_id and path = p_path) then
    return;
  end if;
  if (select count(*) from public.chamado_midias where chamado_id = e.chamado_id and portal_pessoa_id = a.pessoa_id) >= 30 then
    raise exception 'Limite de 30 arquivos por chamado.';
  end if;
  insert into public.chamado_midias (organizacao_id, chamado_id, path, nome, tipo, momento, enviado_por, portal_pessoa_id)
  values (e.organizacao_id, e.chamado_id, p_path, left(coalesce(p_nome, ''), 160), case when p_tipo in ('foto','video') then p_tipo else 'foto' end,
          e.momento, case when a.perfil = 'locatario' then 'locatario' else 'equipe' end, a.pessoa_id);
end;
$$;
revoke execute on function public.portal_registrar_midia(uuid, text, uuid, text, text, text) from public;
grant execute on function public.portal_registrar_midia(uuid, text, uuid, text, text, text) to anon, authenticated;

/**
 * Proprietário aprova ou recusa o orçamento pelo portal. Recebe o orçamento e
 * os valores que ele VIU: se a equipe trocou o orçamento, o valor ou a parte
 * dele depois que a página abriu, recusa (ele precisa conferir de novo).
 * p: { chamado, orcamento, valor, parte, aprovar, nome, obs, ip }
 * A resposta é gravada pela mesma regra da manutenção (privado.aplicar_resposta_aprovacao).
 */
create or replace function public.portal_responder_orcamento(p_token uuid, p_sessao text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
  ch public.chamados%rowtype;
  v_nome text := left(btrim(coalesce(p->>'nome', '')), 160);
  v_aprovar boolean := coalesce((p->>'aprovar')::boolean, false);
  v_valor numeric;
  v_parte numeric;
  v_obs text := left(nullif(btrim(coalesce(p->>'obs', '')), ''), 1000);
begin
  a := privado.portal_validar(p_token, p_sessao);
  if a.perfil <> 'proprietario' then raise exception 'Só o proprietário aprova orçamentos.'; end if;
  perform privado.portal_limite(a, 'aprovacao', 30);
  if coalesce(p->>'chamado', '') !~* '^[0-9a-f-]{36}$' then raise exception 'Chamado não encontrado.'; end if;
  select * into ch from public.chamados
   where id = (p->>'chamado')::uuid and organizacao_id = a.organizacao_id
     and imovel_id in (select privado.portal_imoveis_prop(a.organizacao_id, a.pessoa_id))
   for update;
  if not found then raise exception 'Chamado não encontrado.'; end if;
  if ch.aprovacao_status <> 'pendente' or ch.status <> 'aguardando_aprovacao' then
    raise exception 'Este orçamento não está mais aguardando a sua resposta.';
  end if;
  v_valor := case when coalesce(p->>'valor', '') ~ '^-?\d+(\.\d+)?$' then round((p->>'valor')::numeric, 2) end;
  v_parte := case when coalesce(p->>'parte', '') ~ '^-?\d+(\.\d+)?$' then round((p->>'parte')::numeric, 2) end;
  if (p->>'orcamento') is distinct from ch.orcamento_id::text
     or v_valor is distinct from round(ch.valor_aprovado, 2)
     or v_parte is distinct from round(coalesce(ch.valor_aprovado, 0) * ch.pct_proprietario / 100, 2) then
    raise exception 'O orçamento mudou depois que você abriu a página. Atualize a página e confira de novo antes de responder.';
  end if;
  if length(v_nome) < 3 then raise exception 'Digite seu nome completo.'; end if;
  perform privado.aplicar_resposta_aprovacao(ch.id, v_aprovar, v_nome, coalesce(v_obs, 'Resposta pelo portal do proprietário'), 'link', left(p->>'ip', 64));
  insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
  values (ch.organizacao_id, ch.id, 'portal', 'Resposta do proprietário dada pelo portal (valor conferido: R$ '
          || replace(to_char(v_valor, 'FM999999990.00'), '.', ',') || ')', null);
  perform privado.portal_evento(a, 'aprovacao', (case when v_aprovar then 'Aprovou' else 'Recusou' end) || ' o orçamento do chamado nº ' || ch.numero, p->>'ip');
  return jsonb_build_object('ok', true, 'aprovado', v_aprovar);
end;
$$;
revoke execute on function public.portal_responder_orcamento(uuid, text, jsonb) from public;
grant execute on function public.portal_responder_orcamento(uuid, text, jsonb) to anon, authenticated;

/**
 * Prestador manda o orçamento que foi pedido a ele (fica "recebido" para a
 * equipe comparar e escolher). p: { orcamento, valor, prazo_dias, garantia_dias, validade, descricao }
 */
create or replace function public.portal_enviar_orcamento(p_token uuid, p_sessao text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
  o public.chamado_orcamentos%rowtype;
  ch public.chamados%rowtype;
  v_valor numeric;
  v_prazo int;
  v_garantia int;
  v_validade date;
begin
  a := privado.portal_validar(p_token, p_sessao);
  if a.perfil <> 'prestador' then raise exception 'Só o prestador envia orçamentos.'; end if;
  perform privado.portal_limite(a, 'orcamento', 20);
  if coalesce(p->>'orcamento', '') !~* '^[0-9a-f-]{36}$' then raise exception 'Pedido de orçamento não encontrado.'; end if;
  select * into o from public.chamado_orcamentos
   where id = (p->>'orcamento')::uuid and organizacao_id = a.organizacao_id and prestador_id = a.pessoa_id for update;
  if not found then raise exception 'Pedido de orçamento não encontrado.'; end if;
  select * into ch from public.chamados where id = o.chamado_id;
  if o.status not in ('solicitado','recebido') or ch.status not in ('aberto','em_analise') then
    raise exception 'Este orçamento já foi decidido. Fale com a administração.';
  end if;
  v_valor := case when coalesce(p->>'valor', '') ~ '^\d+(\.\d+)?$' then round((p->>'valor')::numeric, 2) end;
  if v_valor is null or v_valor <= 0 or v_valor >= 10000000 then raise exception 'Informe o valor do orçamento.'; end if;
  v_prazo := case when coalesce(p->>'prazo_dias', '') ~ '^\d{1,4}$' then (p->>'prazo_dias')::int end;
  v_garantia := case when coalesce(p->>'garantia_dias', '') ~ '^\d{1,4}$' then (p->>'garantia_dias')::int end;
  if v_prazo > 3650 or v_garantia > 3650 then raise exception 'Prazo ou garantia muito longos.'; end if;
  if coalesce(p->>'validade', '') ~ '^\d{4}-\d{2}-\d{2}$' then
    v_validade := (p->>'validade')::date;
    if v_validade < (now() at time zone 'America/Sao_Paulo')::date or v_validade > (now() at time zone 'America/Sao_Paulo')::date + 365 then raise exception 'Validade inválida.'; end if;
  end if;
  update public.chamado_orcamentos set
    status = 'recebido', valor = v_valor, prazo_dias = v_prazo, garantia_dias = v_garantia, validade = v_validade,
    descricao = left(nullif(btrim(coalesce(p->>'descricao', '')), ''), 4000), recebido_em = now()
  where id = o.id;
  insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
  values (o.organizacao_id, o.chamado_id, 'orcamento',
          'Orçamento ' || case when o.status = 'recebido' then 'atualizado' else 'recebido' end || ' pelo portal do prestador ('
          || (select nome from public.pessoas where id = a.pessoa_id) || '): R$ ' || replace(to_char(v_valor, 'FM999999990.00'), '.', ','), null);
  perform privado.portal_evento(a, 'orcamento', 'Enviou orçamento para o chamado nº ' || ch.numero);
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.portal_enviar_orcamento(uuid, text, jsonb) from public;
grant execute on function public.portal_enviar_orcamento(uuid, text, jsonb) to anon, authenticated;

/**
 * Prestador atualiza a execução: 'iniciar' (chegou e começou), 'concluir'
 * (terminou — a equipe é que aprova a conclusão e lança no financeiro) ou
 * 'comentario'. p: { chamado, acao, comentario }
 */
create or replace function public.portal_execucao(p_token uuid, p_sessao text, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.portal_acessos%rowtype;
  ch public.chamados%rowtype;
  v_acao text := coalesce(p->>'acao', '');
  v_coment text := left(nullif(btrim(coalesce(p->>'comentario', '')), ''), 2000);
  v_nome text;
begin
  a := privado.portal_validar(p_token, p_sessao);
  if a.perfil <> 'prestador' then raise exception 'Só o prestador atualiza a execução.'; end if;
  perform privado.portal_limite(a, 'execucao', 30);
  if coalesce(p->>'chamado', '') !~* '^[0-9a-f-]{36}$' then raise exception 'Serviço não encontrado.'; end if;
  select * into ch from public.chamados
   where id = (p->>'chamado')::uuid and organizacao_id = a.organizacao_id and prestador_id = a.pessoa_id for update;
  if not found then raise exception 'Serviço não encontrado.'; end if;
  if ch.aprovacao_status = 'pendente' then raise exception 'O orçamento ainda espera a aprovação do proprietário.'; end if;
  select nome into v_nome from public.pessoas where id = a.pessoa_id;

  if v_acao = 'iniciar' then
    if ch.status not in ('aprovado','agendado') then raise exception 'Este serviço não pode ser iniciado agora.'; end if;
    update public.chamados set status = 'em_execucao', iniciado_em = coalesce(iniciado_em, now()) where id = ch.id;
    if ch.visita_id is not null then
      update public.visitas set status = 'realizada' where id = ch.visita_id and status = 'agendada';
      if found then
        insert into public.visita_eventos (organizacao_id, visita_id, tipo, descricao)
        values (ch.organizacao_id, ch.visita_id, 'realizada', 'Prestador começou o serviço do chamado #' || ch.numero || ' (pelo portal)');
      end if;
    end if;
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (ch.organizacao_id, ch.id, 'portal', 'Prestador (' || coalesce(v_nome, '—') || ') começou o serviço pelo portal' || coalesce(' · ' || v_coment, ''), null);
  elsif v_acao = 'concluir' then
    if ch.status not in ('aprovado','agendado','em_execucao') then raise exception 'Este serviço não está em andamento.'; end if;
    update public.chamados set
      status = 'em_execucao', iniciado_em = coalesce(iniciado_em, now()),
      prestador_concluiu_em = now(), prestador_comentario = v_coment
    where id = ch.id;
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (ch.organizacao_id, ch.id, 'portal', 'Prestador (' || coalesce(v_nome, '—') || ') informou pelo portal que terminou o serviço'
            || coalesce(' · ' || v_coment, '') || ' — falta a equipe aprovar a conclusão', null);
  elsif v_acao = 'comentario' then
    if v_coment is null then raise exception 'Escreva o comentário.'; end if;
    insert into public.chamado_eventos (organizacao_id, chamado_id, tipo, descricao, usuario_id)
    values (ch.organizacao_id, ch.id, 'portal', 'Prestador (' || coalesce(v_nome, '—') || ') pelo portal: ' || v_coment, null);
  else
    raise exception 'Ação inválida.';
  end if;
  perform privado.portal_evento(a, 'execucao', 'Atualizou o serviço do chamado nº ' || ch.numero || ' (' || v_acao || ')');
  return jsonb_build_object('ok', true);
end;
$$;
revoke execute on function public.portal_execucao(uuid, text, jsonb) from public;
grant execute on function public.portal_execucao(uuid, text, jsonb) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 9. Portal do corretor (só imobiliária) — área interna, usuário logado
-- -----------------------------------------------------------------------------

/**
 * O contrato é um negócio do corretor? Imóvel da carteira dele, proposta de
 * locação aceita dele no mesmo imóvel ou comissão dele ligada ao contrato.
 */
create or replace function privado.corretor_contrato_dele(p_contrato uuid, p_pessoa uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.contratos c
     where c.id = p_contrato
       and (exists (select 1 from public.imoveis i where i.id = c.imovel_id and i.corretor_id = p_pessoa)
            or exists (select 1 from public.propostas pr where pr.imovel_id = c.imovel_id and pr.corretor_id = p_pessoa
                         and pr.tipo = 'locacao' and pr.status = 'aceita' and pr.organizacao_id = c.organizacao_id)
            or exists (select 1 from public.comissoes cm where cm.contrato_id = c.id and cm.pessoa_id = p_pessoa
                         and cm.status not in ('cancelada','estornada')))
  )
$$;
revoke execute on function privado.corretor_contrato_dele(uuid, uuid) from public, anon, authenticated;

/**
 * Dados do portal do corretor. Papel "corretor": SEMPRE o cadastro ligado ao
 * usuário (p_pessoa é ignorado). Administrador/gestor/financeiro podem abrir o
 * portal de qualquer corretor (p_pessoa). Seções: resumo, imoveis, leads,
 * visitas, propostas, metas ({mes}), comissoes.
 */
create or replace function public.corretor_portal(p_secao text, p_pessoa uuid default null, p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
  v_papel text;
  v_pes uuid;
  v_ini date;
  v_fim date;
begin
  if v_org is null then raise exception 'Sem acesso.'; end if;
  if (select modo from public.organizacoes where id = v_org) = 'pessoal' then
    raise exception 'O portal do corretor só existe no modo imobiliária.';
  end if;
  v_papel := privado.papel_atual(v_org);
  if v_papel = 'corretor' then
    v_pes := privado.minha_pessoa(v_org);
  else
    v_pes := coalesce(p_pessoa, privado.minha_pessoa(v_org));
  end if;
  if v_pes is null then
    return jsonb_build_object('sem_vinculo', true, 'papel', v_papel);
  end if;
  if not exists (select 1 from public.pessoas where id = v_pes and organizacao_id = v_org) then
    raise exception 'Corretor não encontrado.';
  end if;

  if p_secao = 'resumo' then
    v_ini := date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date;
    return jsonb_build_object(
      'pessoa', (select jsonb_build_object('id', id, 'nome', nome, 'telefone', telefone, 'email', email) from public.pessoas where id = v_pes),
      'papel', v_papel,
      'imoveis', (select count(*) from public.imoveis where organizacao_id = v_org and corretor_id = v_pes and status <> 'inativo'),
      'leads_abertos', (select count(*) from public.leads where organizacao_id = v_org and corretor_id = v_pes and status not in ('ganho','perdido')),
      'leads_sem_contato', (select count(*) from public.leads where organizacao_id = v_org and corretor_id = v_pes and status = 'novo'),
      'retornos_hoje', (select count(*) from public.leads where organizacao_id = v_org and corretor_id = v_pes and status not in ('ganho','perdido')
                          and proximo_contato <= (now() at time zone 'America/Sao_Paulo')::date),
      'visitas_proximas', (select count(*) from public.visitas where organizacao_id = v_org and corretor_id = v_pes and status = 'agendada' and data_hora >= now()),
      'propostas_abertas', (select count(*) from public.propostas where organizacao_id = v_org and corretor_id = v_pes and status in ('em_negociacao','contraproposta')),
      'comissoes_a_receber', (select coalesce(sum(valor), 0) from public.comissoes where organizacao_id = v_org and pessoa_id = v_pes and status in ('prevista','a_pagar')),
      'comissoes_mes', (select coalesce(sum(valor), 0) from public.comissoes where organizacao_id = v_org and pessoa_id = v_pes and status = 'paga'
                          and coalesce(liberada_em, vencimento, created_at::date) >= v_ini)
    );
  end if;

  if p_secao = 'imoveis' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', i.id, 'codigo', i.codigo, 'titulo', i.titulo, 'tipo', i.tipo, 'status', i.status, 'finalidades', i.finalidades,
        'valor_aluguel', i.valor_aluguel, 'valor_venda', i.valor_venda, 'bairro', i.bairro, 'cidade', i.cidade, 'captado_em', i.captado_em,
        'leads', (select count(*) from public.lead_imoveis li join public.leads l on l.id = li.lead_id where li.imovel_id = i.id and l.status not in ('ganho','perdido')),
        'visitas', (select count(*) from public.visitas vv where vv.imovel_id = i.id and vv.status = 'agendada' and vv.data_hora >= now())
      ) order by i.codigo), '[]'::jsonb)
      from public.imoveis i where i.organizacao_id = v_org and i.corretor_id = v_pes);
  end if;

  if p_secao = 'leads' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', l.id, 'nome', l.nome, 'telefone', l.telefone, 'email', l.email, 'status', l.status, 'funil', l.funil, 'prioridade', l.prioridade,
        'origem', l.origem, 'proximo_contato', l.proximo_contato, 'ultimo_contato', l.ultimo_contato, 'criado_em', l.created_at,
        'imovel', (select codigo from public.imoveis where id = l.imovel_id)
      ) order by (l.status in ('ganho','perdido')), l.proximo_contato nulls last, l.created_at desc), '[]'::jsonb)
      from (select * from public.leads x where x.organizacao_id = v_org and x.corretor_id = v_pes
              and (x.status not in ('ganho','perdido') or x.created_at > now() - interval '180 days')
             order by x.created_at desc limit 300) l);
  end if;

  if p_secao = 'visitas' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', v.id, 'data_hora', v.data_hora, 'status', v.status, 'tipo', v.tipo, 'titulo', v.titulo,
        'imovel', (select codigo from public.imoveis where id = v.imovel_id),
        'cliente', coalesce((select nome from public.leads where id = v.lead_id), (select nome from public.pessoas where id = v.pessoa_id), v.contato_nome),
        'feedback_interesse', v.feedback_interesse
      ) order by v.data_hora desc), '[]'::jsonb)
      from (select * from public.visitas x where x.organizacao_id = v_org and x.corretor_id = v_pes and x.data_hora >= now() - interval '60 days'
             order by x.data_hora desc limit 200) v);
  end if;

  if p_secao = 'propostas' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', pr.id, 'tipo', pr.tipo, 'valor', pr.valor, 'status', pr.status, 'criado_em', pr.created_at, 'fechada_em', pr.fechada_em,
        'imovel', (select codigo from public.imoveis where id = pr.imovel_id),
        'cliente', (select nome from public.leads where id = pr.lead_id), 'validade', pr.validade
      ) order by pr.created_at desc), '[]'::jsonb)
      from (select * from public.propostas x where x.organizacao_id = v_org and x.corretor_id = v_pes and x.created_at >= now() - interval '365 days'
             order by x.created_at desc limit 200) pr);
  end if;

  if p_secao = 'metas' then
    v_ini := case when coalesce(p->>'mes', '') ~ '^\d{4}-\d{2}$' then ((p->>'mes') || '-01')::date
                  else date_trunc('month', (now() at time zone 'America/Sao_Paulo'))::date end;
    v_fim := (v_ini + interval '1 month' - interval '1 day')::date;
    -- Mesma conta de realizadoDoMes (src/lib/servicos/indicadores.ts, Comercial → Metas),
    -- e a parte do corretor é a MESMA conta filtrada pelos negócios dele
    -- (nunca passa do total da equipe). Mude as duas juntas.
    return jsonb_build_object(
      'mes', to_char(v_ini, 'YYYY-MM'),
      'metas', (select coalesce(jsonb_object_agg(tipo, valor), '{}'::jsonb) from public.metas where organizacao_id = v_org and competencia = v_ini),
      'equipe', jsonb_build_object(
        'locacoes', (select count(*) from public.contratos c where c.organizacao_id = v_org and c.status <> 'rascunho' and c.data_inicio between v_ini and v_fim),
        'vendas', (select count(*) from public.imoveis i where i.organizacao_id = v_org and i.vendido_em between v_ini and v_fim),
        'captacoes', (select count(*) from public.imoveis i where i.organizacao_id = v_org and i.captado_em between v_ini and v_fim),
        'leads', (select count(*) from public.leads l where l.organizacao_id = v_org
                    and l.created_at >= (v_ini::timestamp at time zone 'America/Sao_Paulo')
                    and l.created_at < ((v_fim + 1)::timestamp at time zone 'America/Sao_Paulo')),
        'faturamento', (select coalesce(sum(lc.valor), 0) from public.lancamentos lc where lc.organizacao_id = v_org and lc.tipo = 'receber'
                          and lc.status = 'liquidado' and lc.liquidado_em between v_ini and v_fim)
      ),
      'meu', jsonb_build_object(
        -- Contrato iniciado no mês de imóvel da carteira dele, com proposta de locação aceita dele no imóvel ou com comissão dele.
        'locacoes', (select count(*) from public.contratos c where c.organizacao_id = v_org and c.status <> 'rascunho' and c.data_inicio between v_ini and v_fim
                       and privado.corretor_contrato_dele(c.id, v_pes)),
        -- Imóvel vendido no mês: da carteira dele, venda com ele ou proposta de venda aceita dele.
        'vendas', (select count(*) from public.imoveis i where i.organizacao_id = v_org and i.vendido_em between v_ini and v_fim
                     and (i.corretor_id = v_pes
                          or exists (select 1 from public.vendas vd where vd.imovel_id = i.id and vd.corretor_id = v_pes and vd.status <> 'cancelada')
                          or exists (select 1 from public.propostas pr where pr.imovel_id = i.id and pr.corretor_id = v_pes and pr.tipo = 'venda' and pr.status = 'aceita'))),
        'captacoes', (select count(*) from public.imoveis i where i.organizacao_id = v_org and i.corretor_id = v_pes and i.captado_em between v_ini and v_fim),
        'leads', (select count(*) from public.leads l where l.organizacao_id = v_org and l.corretor_id = v_pes
                    and l.created_at >= (v_ini::timestamp at time zone 'America/Sao_Paulo')
                    and l.created_at < ((v_fim + 1)::timestamp at time zone 'America/Sao_Paulo')),
        -- Receitas liquidadas no mês ligadas aos negócios dele (contrato, venda, proposta ou imóvel da carteira).
        'faturamento', (select coalesce(sum(lc.valor), 0) from public.lancamentos lc where lc.organizacao_id = v_org and lc.tipo = 'receber'
                          and lc.status = 'liquidado' and lc.liquidado_em between v_ini and v_fim
                          and ((lc.contrato_id is not null and privado.corretor_contrato_dele(lc.contrato_id, v_pes))
                               or lc.venda_id in (select vd.id from public.vendas vd where vd.organizacao_id = v_org and vd.corretor_id = v_pes)
                               or lc.proposta_id in (select pr.id from public.propostas pr where pr.organizacao_id = v_org and pr.corretor_id = v_pes)
                               or lc.imovel_id in (select i.id from public.imoveis i where i.organizacao_id = v_org and i.corretor_id = v_pes)))
      ),
      -- Comissões dele no mês: número à parte (não entra na barra da meta de faturamento).
      'comissoes', (select coalesce(sum(valor), 0) from public.comissoes where organizacao_id = v_org and pessoa_id = v_pes and status in ('a_pagar','paga')
                      and coalesce(liberada_em, vencimento, created_at::date) between v_ini and v_fim),
      'corretores', (select count(*) from public.pessoas where organizacao_id = v_org and 'corretor' = any(papeis))
    );
  end if;

  if p_secao = 'comissoes' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', c.id, 'tipo', c.tipo, 'descricao', c.descricao, 'base', c.base, 'percentual', c.percentual, 'valor', c.valor, 'status', c.status,
        'previsao', c.previsao, 'vencimento', c.vencimento, 'liberada_em', c.liberada_em, 'motivo', c.motivo, 'criado_em', c.created_at,
        'imovel', (select codigo from public.imoveis where id = c.imovel_id)
      ) order by c.created_at desc), '[]'::jsonb)
      from (select * from public.comissoes x where x.organizacao_id = v_org and x.pessoa_id = v_pes
              and (x.status in ('prevista','a_pagar') or x.created_at >= now() - interval '400 days')
             order by x.created_at desc limit 300) c);
  end if;

  return null;
end;
$$;
revoke execute on function public.corretor_portal(text, uuid, jsonb) from public, anon;
grant execute on function public.corretor_portal(text, uuid, jsonb) to authenticated;

/**
 * Corretor registra um contato com o lead DELE (ligação, WhatsApp, e-mail,
 * reunião ou anotação) e marca o próximo contato. Lead "novo" passa para "em atendimento".
 * p: { tipo, descricao, proximo_contato }
 */
create or replace function public.corretor_registrar_contato(p_lead uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  l public.leads%rowtype;
  v_papel text;
  v_tipo text := coalesce(p->>'tipo', 'nota');
  v_desc text := left(btrim(coalesce(p->>'descricao', '')), 2000);
  v_prox date;
begin
  select * into l from public.leads where id = p_lead and organizacao_id in (select privado.org_ids()) for update;
  if not found then raise exception 'Lead não encontrado.'; end if;
  if (select modo from public.organizacoes where id = l.organizacao_id) = 'pessoal' then
    raise exception 'Leads só existem no modo imobiliária.';
  end if;
  v_papel := privado.papel_atual(l.organizacao_id);
  if v_papel = 'corretor' and l.corretor_id is distinct from privado.minha_pessoa(l.organizacao_id) then
    raise exception 'Este lead não é seu.';
  end if;
  if v_tipo not in ('ligacao','whatsapp','email','reuniao','nota') then v_tipo := 'nota'; end if;
  if length(v_desc) < 2 then raise exception 'Conte o que foi conversado.'; end if;
  if coalesce(p->>'proximo_contato', '') ~ '^\d{4}-\d{2}-\d{2}$' then v_prox := (p->>'proximo_contato')::date; end if;
  insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao) values (l.organizacao_id, l.id, v_tipo, v_desc);
  update public.leads set
    ultimo_contato = case when v_tipo <> 'nota' then now() else ultimo_contato end,
    atendido_em = case when v_tipo <> 'nota' then coalesce(atendido_em, now()) else atendido_em end,
    proximo_contato = coalesce(v_prox, proximo_contato),
    status = case when v_tipo <> 'nota' and status = 'novo' then 'em_atendimento' else status end,
    etapa_max = case when v_tipo <> 'nota' and status = 'novo' then greatest(etapa_max, 1) else etapa_max end
  where id = l.id;
  if v_tipo <> 'nota' and l.status = 'novo' then
    insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao) values (l.organizacao_id, l.id, 'etapa', 'Novo → Em atendimento');
  end if;
end;
$$;
revoke execute on function public.corretor_registrar_contato(uuid, jsonb) from public, anon;
grant execute on function public.corretor_registrar_contato(uuid, jsonb) to authenticated;

/** Storage "corretores": <org>/<corretor>/<arquivo>; o corretor só a pasta dele. */
create or replace function privado.corretor_arquivo_ok(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partes text[] := string_to_array(coalesce(p_nome, ''), '/');
  v_uuid text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  v_org uuid;
  v_papel text;
begin
  if coalesce(array_length(v_partes, 1), 0) <> 3 or p_nome like '%..%' or coalesce(v_partes[3], '') = '' then return false; end if;
  if v_partes[1] !~ v_uuid or v_partes[2] !~ v_uuid then return false; end if;
  v_org := v_partes[1]::uuid;
  v_papel := privado.papel_atual(v_org);
  if v_papel is null then return false; end if;
  if (select modo from public.organizacoes where id = v_org) = 'pessoal' then return false; end if;
  if v_papel = 'corretor' then
    return v_partes[2]::uuid = privado.minha_pessoa(v_org);
  end if;
  return exists (select 1 from public.pessoas where id = v_partes[2]::uuid and organizacao_id = v_org);
end;
$$;
revoke execute on function privado.corretor_arquivo_ok(text) from public, anon;
grant execute on function privado.corretor_arquivo_ok(text) to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Storage
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    -- Fotos do portal (locatário/prestador) no bucket "manutencao": só gravar, na pasta liberada.
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'manutencao_enviar_portal') then
      execute $p$create policy manutencao_enviar_portal on storage.objects for insert to anon, authenticated
        with check (bucket_id = 'manutencao' and public.portal_pode_enviar(name))$p$;
    end if;
    -- Documentação do corretor: bucket privado "corretores".
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('corretores', 'corretores', false, 10485760, array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'corretores_ler') then
      execute $p$create policy corretores_ler on storage.objects for select to authenticated
        using (bucket_id = 'corretores' and privado.corretor_arquivo_ok(name))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'corretores_gravar') then
      execute $p$create policy corretores_gravar on storage.objects for insert to authenticated
        with check (bucket_id = 'corretores' and privado.corretor_arquivo_ok(name))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'corretores_apagar') then
      execute $p$create policy corretores_apagar on storage.objects for delete to authenticated
        using (bucket_id = 'corretores' and privado.corretor_arquivo_ok(name))$p$;
    end if;
  end if;
end $$;

-- =============================================================================
-- 11. Juntar cadastros repetidos (Pessoas): links do portal, pedidos, fotos,
-- usuário ligado ao corretor e documentos do corretor vão para o cadastro que
-- fica. public.juntar_pessoas é recriada a partir do corpo que está no banco,
-- só acrescentando a chamada antes do "delete from public.pessoas where id = b.id;".
-- =============================================================================
create or replace function privado.portal_juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  -- Roda com direitos do dono (membros não tem update pela API): confere a organização de quem chamou.
  select organizacao_id into v_org from public.pessoas where id = p_manter;
  if v_org is null or v_org not in (select privado.org_ids())
     or not exists (select 1 from public.pessoas where id = p_remover and organizacao_id = v_org) then
    if auth.uid() is not null then raise exception 'Cadastro não encontrado.'; end if;
  end if;
  perform set_config('portal.juntando', 'sim', true);
  -- Link ativo repetido do mesmo perfil: fica o do cadastro mantido.
  update public.portal_acessos b set ativo = false
   where b.pessoa_id = p_remover and b.ativo
     and exists (select 1 from public.portal_acessos x where x.pessoa_id = p_manter and x.perfil = b.perfil and x.ativo);
  update public.portal_acessos set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.portal_solicitacoes set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.portal_eventos set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.chamado_midias set portal_pessoa_id = p_manter where portal_pessoa_id = p_remover;
  update public.corretor_documentos set corretor_id = p_manter where corretor_id = p_remover;
  update public.corretor_documentos set cliente_id = p_manter where cliente_id = p_remover;
  if not exists (select 1 from public.membros where pessoa_id = p_manter and organizacao_id = v_org) then
    update public.membros set pessoa_id = p_manter where pessoa_id = p_remover and organizacao_id = v_org;
  end if;
  perform set_config('portal.juntando', '', true);
end;
$$;
revoke execute on function privado.portal_juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function privado.portal_juntar_pessoas(uuid, uuid) to authenticated;

do $$
declare
  v_def text;
  v_novo text;
begin
  if to_regprocedure('public.juntar_pessoas(uuid, uuid)') is null then
    raise warning 'public.juntar_pessoas não existe: o portal não entra no "juntar repetidos".';
    return;
  end if;
  v_def := pg_get_functiondef('public.juntar_pessoas(uuid, uuid)'::regprocedure);
  if v_def ilike '%privado.portal_juntar_pessoas%' then
    return;
  end if;
  v_novo := regexp_replace(v_def,
    '(\n[ \t]*)(delete[ \t]+from[ \t]+public\.pessoas[ \t]+where[ \t]+id[ \t]*=[ \t]*b\.id[ \t]*;)',
    '\1perform privado.portal_juntar_pessoas(a.id, b.id);\1\2', 'i');
  if v_novo = v_def then
    raise warning 'Não achei o "delete from public.pessoas where id = b.id;" em public.juntar_pessoas: inclua à mão a chamada a privado.portal_juntar_pessoas(a.id, b.id).';
    return;
  end if;
  execute v_novo;
end $$;
