-- =============================================================================
-- CRM de leads (modo imobiliária): funis de locação/venda/captação, corretor
-- responsável e rodízio, prioridade, etiquetas, perfil de busca, vários imóveis
-- por lead, histórico de contatos, motivo de perda, follow-up e entrada
-- automática pelo formulário público / API (token da imobiliária).
-- =============================================================================

alter table public.leads drop constraint if exists leads_origem_check;
alter table public.leads add constraint leads_origem_check check (origem in (
  'site','whatsapp','instagram','facebook','tiktok','portal','zap','vivareal','olx','imovelweb',
  'indicacao','placa','telefone','email','visita','outro'));

alter table public.leads
  add column if not exists funil text not null default 'locacao',
  add column if not exists corretor_id uuid references public.pessoas(id) on delete set null,
  add column if not exists atribuido_em timestamptz,
  add column if not exists prioridade text not null default 'morno',
  add column if not exists etiquetas text[] not null default '{}',
  add column if not exists orcamento_min numeric(14,2),
  add column if not exists orcamento_max numeric(14,2),
  add column if not exists regioes text,
  add column if not exists tipos text[] not null default '{}',
  add column if not exists quartos_min int,
  add column if not exists motivo_perda text,
  add column if not exists perdido_em timestamptz,
  add column if not exists proximo_contato date,
  add column if not exists ultimo_contato timestamptz,
  add column if not exists etapa_max int not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leads_funil_check') then
    alter table public.leads add constraint leads_funil_check check (funil in ('locacao','venda','captacao'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'leads_prioridade_check') then
    alter table public.leads add constraint leads_prioridade_check check (prioridade in ('quente','morno','frio'));
  end if;
end $$;

-- Leads antigos: funil pelo interesse; etapa máxima pela etapa atual.
update public.leads set funil = 'venda' where interesse = 'compra' and funil = 'locacao';
update public.leads set etapa_max = case status
  when 'novo' then 0 when 'em_atendimento' then 1 when 'visita' then 2 when 'proposta' then 3 when 'ganho' then 4 else etapa_max end
 where etapa_max = 0;

create index if not exists leads_funil_idx on public.leads (organizacao_id, funil, status);
create index if not exists leads_corretor_idx on public.leads (corretor_id);

-- Vários imóveis por lead ----------------------------------------------------
create table if not exists public.lead_imoveis (
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  imovel_id uuid not null references public.imoveis(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (lead_id, imovel_id)
);
insert into public.lead_imoveis (organizacao_id, lead_id, imovel_id)
select organizacao_id, id, imovel_id from public.leads where imovel_id is not null
on conflict do nothing;

-- Histórico do lead: contatos, mudanças de etapa, transferências ------------
create table if not exists public.lead_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  lead_id uuid not null references public.leads(id) on delete cascade,
  tipo text not null default 'nota'
    check (tipo in ('entrada','ligacao','whatsapp','email','reuniao','nota','etapa','transferencia','perda','reativacao','mensagem')),
  descricao text,
  data timestamptz not null default now(),
  usuario_id uuid default auth.uid()
);
create index if not exists lead_eventos_lead_idx on public.lead_eventos (lead_id, data desc);

do $$
declare t text;
begin
  foreach t in array array['lead_imoveis','lead_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (organizacao_id in (select privado.org_ids()))
      with check (organizacao_id in (select privado.org_ids()))$p$, t || '_org', t);
  end loop;
end $$;

-- Configuração de captação e rodízio ------------------------------------------
alter table public.organizacoes
  add column if not exists leads_token uuid not null default gen_random_uuid(),
  add column if not exists distribuicao_leads text not null default 'manual';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizacoes_distribuicao_leads_check') then
    alter table public.organizacoes add constraint organizacoes_distribuicao_leads_check check (distribuicao_leads in ('manual','rodizio'));
  end if;
end $$;
create unique index if not exists organizacoes_leads_token_idx on public.organizacoes (leads_token);

alter table public.pessoas add column if not exists recebe_leads boolean not null default true;

/** Próximo corretor do rodízio: quem recebeu lead há mais tempo (ou nunca). */
create or replace function public.proximo_corretor_lead()
returns uuid
language sql
stable
security invoker
set search_path = public
as $$
  select p.id
    from public.pessoas p
   where p.organizacao_id = privado.org_atual()
     and 'corretor' = any (p.papeis)
     and p.recebe_leads
   order by (select max(l.atribuido_em) from public.leads l where l.corretor_id = p.id) nulls first, p.nome
   limit 1
$$;
revoke execute on function public.proximo_corretor_lead() from public, anon;
grant execute on function public.proximo_corretor_lead() to authenticated;

/** Nome da imobiliária para o formulário público (só se o token existir). */
create or replace function public.info_captacao(p_token uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select nome from public.organizacoes where leads_token = p_token and modo = 'imobiliaria'
$$;
revoke execute on function public.info_captacao(uuid) from public;
grant execute on function public.info_captacao(uuid) to anon, authenticated;

/**
 * Entrada automática de lead (formulário público, site, portais).
 * Não cria repetido: se já existe lead aberto com o mesmo e-mail ou telefone,
 * registra a nova mensagem nele.
 */
create or replace function public.receber_lead(p_token uuid, p jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  org public.organizacoes%rowtype;
  v_nome text := left(btrim(coalesce(p->>'nome', '')), 120);
  v_tel text := left(btrim(coalesce(p->>'telefone', '')), 40);
  v_email text := lower(left(btrim(coalesce(p->>'email', '')), 160));
  v_msg text := left(btrim(coalesce(p->>'mensagem', '')), 2000);
  v_origem text := lower(coalesce(p->>'origem', 'site'));
  v_funil text := lower(coalesce(p->>'funil', 'locacao'));
  v_dig text := right(regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g'), 9);
  v_existente uuid;
  v_id uuid;
  v_corretor uuid;
  v_imovel uuid;
begin
  select * into org from public.organizacoes where leads_token = p_token and modo = 'imobiliaria';
  if not found then raise exception 'Link de captação inválido.'; end if;
  if v_nome = '' then raise exception 'Informe o nome.'; end if;
  if v_tel = '' and v_email = '' then raise exception 'Informe telefone ou e-mail.'; end if;
  if v_origem not in ('site','whatsapp','instagram','facebook','tiktok','portal','zap','vivareal','olx','imovelweb','indicacao','placa','telefone','email','visita','outro') then
    v_origem := 'site';
  end if;
  if v_funil not in ('locacao','venda','captacao') then v_funil := 'locacao'; end if;
  -- Limite simples contra robôs: no máximo 300 entradas por hora por imobiliária.
  if (select count(*) from public.lead_eventos where organizacao_id = org.id and tipo in ('entrada','mensagem') and data > now() - interval '1 hour') > 300 then
    raise exception 'Muitas mensagens agora. Tente de novo mais tarde.';
  end if;

  select l.id into v_existente
    from public.leads l
   where l.organizacao_id = org.id
     and l.status not in ('ganho','perdido')
     and ((v_email <> '' and lower(l.email) = v_email)
       or (length(v_dig) >= 8 and right(regexp_replace(coalesce(l.telefone, ''), '\D', '', 'g'), 9) = v_dig))
   limit 1;

  if p->>'imovel' is not null then
    select id into v_imovel from public.imoveis where organizacao_id = org.id and lower(codigo) = lower(p->>'imovel') limit 1;
  end if;

  if v_existente is not null then
    insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao, usuario_id)
    values (org.id, v_existente, 'mensagem', 'Novo contato (' || v_origem || ')' || coalesce(': ' || nullif(v_msg, ''), ''), null);
    update public.leads set ultimo_contato = now() where id = v_existente;
    if v_imovel is not null then
      insert into public.lead_imoveis (organizacao_id, lead_id, imovel_id) values (org.id, v_existente, v_imovel) on conflict do nothing;
    end if;
    return jsonb_build_object('id', v_existente, 'duplicado', true);
  end if;

  if org.distribuicao_leads = 'rodizio' then
    select pe.id into v_corretor
      from public.pessoas pe
     where pe.organizacao_id = org.id and 'corretor' = any (pe.papeis) and pe.recebe_leads
     order by (select max(l.atribuido_em) from public.leads l where l.corretor_id = pe.id) nulls first, pe.nome
     limit 1;
  end if;

  insert into public.leads (organizacao_id, nome, telefone, email, origem, funil, interesse, observacoes, corretor_id, atribuido_em, ultimo_contato)
  values (org.id, v_nome, nullif(v_tel, ''), nullif(v_email, ''), v_origem, v_funil,
          case when v_funil = 'venda' then 'compra' else 'locacao' end, nullif(v_msg, ''),
          v_corretor, case when v_corretor is not null then now() end, now())
  returning id into v_id;
  insert into public.lead_eventos (organizacao_id, lead_id, tipo, descricao, usuario_id)
  values (org.id, v_id, 'entrada', 'Chegou pelo formulário (' || v_origem || ')', null);
  if v_imovel is not null then
    insert into public.lead_imoveis (organizacao_id, lead_id, imovel_id) values (org.id, v_id, v_imovel);
  end if;
  return jsonb_build_object('id', v_id, 'duplicado', false);
end;
$$;
revoke execute on function public.receber_lead(uuid, jsonb) from public;
grant execute on function public.receber_lead(uuid, jsonb) to anon, authenticated;
