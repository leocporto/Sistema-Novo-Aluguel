-- =============================================================================
-- Correções da revisão do site imobiliário e dos portais (etapa 16).
-- Sem DROP: funções e gatilhos com create or replace, colunas com
-- add column if not exists, permissões com revoke/grant.
--
-- 1) Formulários do site (site_contato, pública): limite por organização, por
--    telefone/e-mail e de visitas em aberto; visita só das 8h às 18h; texto sem
--    caracteres de controle; repetição idêntica não grava de novo; a resposta não
--    conta mais se o contato já era lead nem o motivo do horário recusado.
-- 2) Site: endereço (slug), domínio, códigos dos portais e exclusão só por
--    administrador/gestor, garantido no banco (a API REST é acessível com a sessão).
-- 3) Slug antigo fica reservado à mesma imobiliária por 12 meses (ninguém "pega"
--    os links antigos) e redireciona para o novo; o feed de um site excluído
--    responde vazio por 180 dias (o portal tira os anúncios).
-- 4) Feed dos portais: portal desligado ou pausado responde feed VAZIO (antes,
--    404 — o portal mantinha os anúncios). O registro do envio é calculado pelo
--    próprio banco (portal_sincronizar): ninguém com o link marca falhas ou
--    encerra anúncios com dados inventados. "Conferir agora" (manual) não marca
--    "enviado" nem abre anúncios no Histórico. Datas no fuso de Brasília.
-- 5) Leads dos portais: endereço próprio (código diferente do feed), limite por
--    portal e por contato, e o mesmo lead reenviado (id do portal) não repete.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Colunas novas
-- -----------------------------------------------------------------------------
-- Código do webhook de leads, separado do código do feed (o feed é só leitura e
-- circula mais: robôs do portal, registros de proxy, prints do painel).
alter table public.site_config add column if not exists leads_portais_token uuid not null default gen_random_uuid();
create unique index if not exists site_config_leads_portais_token_idx on public.site_config (leads_portais_token);

-- Identificador do lead no portal (originLeadId), para não repetir o reenvio.
alter table public.site_solicitacoes add column if not exists id_externo text;
create index if not exists site_solicitacoes_externo_idx on public.site_solicitacoes (organizacao_id, origem, id_externo) where id_externo is not null;
create index if not exists site_solicitacoes_origem_idx on public.site_solicitacoes (organizacao_id, origem, created_at desc);

-- Endereços antigos: slug trocado/excluído (reservado à mesma imobiliária) e o
-- código do feed de um site excluído (continua respondendo feed vazio).
create table if not exists privado.site_enderecos_antigos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null references public.organizacoes(id) on delete cascade,
  tipo text not null check (tipo in ('slug','token')),
  valor text not null,
  ate timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists site_enderecos_antigos_idx on privado.site_enderecos_antigos (tipo, valor);
alter table privado.site_enderecos_antigos enable row level security;
revoke all on table privado.site_enderecos_antigos from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Auxiliares
-- -----------------------------------------------------------------------------
/**
 * Texto vindo de formulário público: tira caracteres de controle (o \r sozinho
 * quebrava o calendário .ics), junta as linhas quando o campo é de uma linha só,
 * corta no tamanho e devolve null se ficar vazio.
 */
create or replace function privado.site_texto_limpo(p_texto text, p_max int, p_varias_linhas boolean default false)
returns text
language sql
immutable
set search_path = public
as $$
  select nullif(btrim(left(
           regexp_replace(
             case when p_varias_linhas then regexp_replace(coalesce(p_texto, ''), E'\r\n?', E'\n', 'g')
                  else regexp_replace(coalesce(p_texto, ''), E'[\r\n\t]+', ' ', 'g') end,
             E'[\\x01-\\x08\\x0b-\\x1f\\x7f]', '', 'g'),
           p_max)), '')
$$;
revoke execute on function privado.site_texto_limpo(text, int, boolean) from public, anon;

/** Nome do portal na aba Histórico do imóvel (imovel_anuncios.portal). */
create or replace function privado.portal_nome_anuncio(p_portal text)
returns text
language sql
immutable
set search_path = public
as $$
  select case p_portal when 'zap' then 'ZAP Imóveis' when 'vivareal' then 'VivaReal' when 'olx' then 'OLX' end
$$;
revoke execute on function privado.portal_nome_anuncio(text) from public, anon;

/**
 * O que impede o imóvel de ir para o portal. MESMA conta (e mesmos textos) de
 * validarParaPortal() em src/lib/dominio/site-portais.ts — mude as duas juntas
 * (tests/site.sql.test.ts compara as duas).
 */
create or replace function privado.portal_problemas(i public.imoveis, p_portal text, p_fotos int)
returns text[]
language plpgsql
stable
set search_path = public
as $$
declare
  v text[] := '{}';
  v_nome text := case p_portal when 'olx' then 'OLX' when 'vivareal' then 'Viva Real' else 'ZAP Imóveis' end;
  v_tipo text := btrim(regexp_replace(lower(translate(coalesce(i.tipo, ''),
                   'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ',
                   'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn')), '[^a-z0-9]+', ' ', 'g'));
  v_fins text[] := coalesce(i.finalidades, '{}');
  v_terreno boolean;
  v_comercial boolean;
begin
  v_terreno := v_tipo = 'terreno';
  v_comercial := v_tipo in ('sala comercial', 'loja', 'galpao');
  if v_tipo not in ('apartamento','casa','casa de condominio','cobertura','kitnet studio','sala comercial','loja','galpao','terreno','sitio chacara') then
    v := v || ('O tipo "' || coalesce(nullif(i.tipo, ''), '—') || '" não existe no ' || v_nome || '. Escolha outro tipo no cadastro.');
  end if;
  if not ((coalesce(i.valor_venda, 0) > 0 and ('venda' = any (v_fins) or not ('locacao' = any (v_fins))))
       or (coalesce(i.valor_aluguel, 0) > 0 and ('locacao' = any (v_fins) or not ('venda' = any (v_fins))))) then
    v := v || 'Informe o valor do aluguel ou da venda.'::text;
  end if;
  if coalesce(p_fotos, 0) < 1 then v := v || 'Envie pelo menos 1 foto.'::text; end if;
  if char_length(btrim(regexp_replace(coalesce(i.descricao, ''), '\s+', ' ', 'g'))) < 50 then
    v := v || 'Escreva uma descrição com pelo menos 50 letras.'::text;
  end if;
  if coalesce(i.cidade, '') !~ '\S' or coalesce(i.bairro, '') !~ '\S' then v := v || 'Preencha a cidade e o bairro.'::text; end if;
  if coalesce(i.uf, '') !~ '^[A-Za-z]{2}$' then v := v || 'Preencha a UF (ex.: SP).'::text; end if;
  if length(regexp_replace(coalesce(i.cep, ''), '[^0-9]', '', 'g')) <> 8 then v := v || 'Preencha o CEP (8 números).'::text; end if;
  if (v_terreno and coalesce(i.area_total, 0) = 0)
     or (not v_terreno and coalesce(coalesce(i.area_privativa, i.area_util, i.area_construida, i.area_total), 0) = 0) then
    v := v || 'Informe a área em m².'::text;
  end if;
  if not v_terreno and not v_comercial and i.quartos is null then v := v || 'Informe o número de quartos.'::text; end if;
  return v;
end;
$$;
revoke execute on function privado.portal_problemas(public.imoveis, text, int) from public, anon;

-- -----------------------------------------------------------------------------
-- 2/3) Regras do site_config: papel, slug reservado, endereços antigos
-- -----------------------------------------------------------------------------
create or replace function privado.site_config_regras()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
begin
  if tg_op = 'DELETE' then
    -- Exclusão em cascata da organização: nada a guardar.
    if not exists (select 1 from public.organizacoes where id = old.organizacao_id) then
      return old;
    end if;
    if auth.uid() is not null and not privado.pode_ver_restrito(old.organizacao_id) then
      raise exception 'Só administradores e gestores excluem o site.';
    end if;
    insert into privado.site_enderecos_antigos (organizacao_id, tipo, valor, ate)
    values (old.organizacao_id, 'slug', old.slug, now() + interval '12 months'),
           (old.organizacao_id, 'token', old.portais_token::text, now() + interval '180 days');
    -- O feed passa a responder vazio: os anúncios abertos pelo feed acabam hoje.
    update public.imovel_anuncios
       set fim = v_hoje
     where organizacao_id = old.organizacao_id and origem = 'feed' and fim is null;
    delete from public.portal_imoveis where organizacao_id = old.organizacao_id;
    return old;
  end if;

  if tg_op = 'UPDATE' and auth.uid() is not null and not privado.pode_ver_restrito(old.organizacao_id)
     and (new.slug is distinct from old.slug
       or new.dominio is distinct from old.dominio
       or new.dominio_verificado_em is distinct from old.dominio_verificado_em
       or new.portais_token is distinct from old.portais_token
       or new.leads_portais_token is distinct from old.leads_portais_token
       or new.organizacao_id is distinct from old.organizacao_id) then
    raise exception 'Só administradores e gestores mudam o endereço, o domínio e os códigos dos portais do site.';
  end if;

  if (tg_op = 'INSERT' or new.slug is distinct from old.slug)
     and exists (select 1 from privado.site_enderecos_antigos a
                  where a.tipo = 'slug' and a.valor = new.slug and a.ate > now()
                    and a.organizacao_id <> new.organizacao_id) then
    raise exception 'Esse endereço já está em uso por outra imobiliária. Escolha outro.';
  end if;

  if tg_op = 'UPDATE' and new.slug is distinct from old.slug then
    insert into privado.site_enderecos_antigos (organizacao_id, tipo, valor, ate)
    values (old.organizacao_id, 'slug', old.slug, now() + interval '12 months');
  end if;
  return new;
end;
$$;
revoke execute on function privado.site_config_regras() from public, anon;
create or replace trigger site_config_regras_trg before insert or update or delete on public.site_config
  for each row execute function privado.site_config_regras();

/** Endereço novo de um site que trocou de slug (para redirecionar os links antigos). */
create or replace function public.site_slug_atual(p_slug text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select s.slug
    from privado.site_enderecos_antigos a
    join public.site_config s on s.organizacao_id = a.organizacao_id
    join public.organizacoes o on o.id = s.organizacao_id and o.modo = 'imobiliaria'
   where a.tipo = 'slug' and a.valor = lower(btrim(p_slug)) and a.ate > now()
     and s.ativo and s.slug <> a.valor
   order by a.created_at desc
   limit 1
$$;

-- Portal desligado (linha apagada): as escolhas por imóvel saem e os anúncios
-- abertos pelo feed acabam hoje (antes isso só acontecia pela tela).
create or replace function privado.site_portais_desligar()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.organizacoes where id = old.organizacao_id) then
    return old;
  end if;
  delete from public.portal_imoveis where organizacao_id = old.organizacao_id and portal = old.portal;
  update public.imovel_anuncios
     set fim = (now() at time zone 'America/Sao_Paulo')::date
   where organizacao_id = old.organizacao_id and origem = 'feed' and portal = privado.portal_nome_anuncio(old.portal) and fim is null;
  return old;
end;
$$;
revoke execute on function privado.site_portais_desligar() from public, anon;
create or replace trigger site_portais_desligar_trg after delete on public.site_portais
  for each row execute function privado.site_portais_desligar();

-- -----------------------------------------------------------------------------
-- 1) Formulários do site
-- -----------------------------------------------------------------------------
/**
 * Formulários do site. p: { tipo: contato|visita|captacao|empreendimento, nome, telefone, email,
 * mensagem, imovel (código), empreendimento (id), funil, quando (visita, com fuso), e para
 * captação: tipo_imovel, finalidade, cidade, bairro, uf, quartos, area, valor }.
 * Usa a receber_lead (sem repetir lead aberto) e registra em site_solicitacoes.
 * Pública (anon): por isso tem limites próprios — por organização (60 por hora, 20
 * visitas por hora), por telefone/e-mail (3 por hora; 2 visitas em aberto) — e
 * devolve só {ok}: não conta se o contato já existia.
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
  v_local timestamp;
  v_funil text;
  v_nome text := privado.site_texto_limpo(p->>'nome', 120);
  v_tel text := privado.site_texto_limpo(p->>'telefone', 40);
  v_email text := lower(privado.site_texto_limpo(p->>'email', 160));
  v_texto text := privado.site_texto_limpo(p->>'mensagem', 1500, true);
  v_tipo_imovel text := privado.site_texto_limpo(p->>'tipo_imovel', 40);
  v_cidade text := privado.site_texto_limpo(p->>'cidade', 80);
  v_bairro text := privado.site_texto_limpo(p->>'bairro', 80);
  v_uf text := upper(privado.site_texto_limpo(p->>'uf', 2));
  v_dig text;
  v_msg text;
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

  v_dig := right(regexp_replace(coalesce(v_tel, ''), '\D', '', 'g'), 9);
  if v_nome is null then raise exception 'Informe o nome.'; end if;
  if (v_email is null or position('@' in v_email) = 0) and length(v_dig) < 8 then
    raise exception 'Informe telefone ou e-mail.';
  end if;
  if v_email is not null and position('@' in v_email) = 0 then v_email := null; end if;

  -- Limites contra abuso (a função é pública e chamável direto pela API).
  if (select count(*) from public.site_solicitacoes
       where organizacao_id = s.organizacao_id and origem = 'site' and created_at > now() - interval '1 hour') >= 60 then
    raise exception 'Muitas mensagens agora. Tente de novo mais tarde.';
  end if;
  if (select count(*) from public.site_solicitacoes ss
       where ss.organizacao_id = s.organizacao_id and ss.origem = 'site' and ss.created_at > now() - interval '1 hour'
         and ((v_email is not null and lower(ss.email) = v_email)
           or (length(v_dig) >= 8 and right(regexp_replace(coalesce(ss.telefone, ''), '\D', '', 'g'), 9) = v_dig))) >= 3 then
    raise exception 'Muitas mensagens agora. Tente de novo mais tarde.';
  end if;

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
    -- Mesmos horários que o site oferece (8h às 18h, de meia em meia hora, em Brasília).
    v_local := v_quando at time zone 'America/Sao_Paulo';
    if v_local::time < time '08:00' or v_local::time > time '18:00'
       or extract(minute from v_local)::int not in (0, 30) or extract(second from v_local) <> 0 then
      raise exception 'Escolha um horário entre 8h e 18h (de meia em meia hora).';
    end if;
    if (select count(*) from public.site_solicitacoes
         where organizacao_id = s.organizacao_id and origem = 'site' and tipo = 'visita' and created_at > now() - interval '1 hour') >= 20 then
      raise exception 'Muitas mensagens agora. Tente de novo mais tarde.';
    end if;
    if (select count(*) from public.site_solicitacoes ss
          join public.visitas v on v.id = ss.visita_id
         where ss.organizacao_id = s.organizacao_id and ss.tipo = 'visita' and v.status = 'agendada' and v.data_hora > now()
           and ((v_email is not null and lower(ss.email) = v_email)
             or (length(v_dig) >= 8 and right(regexp_replace(coalesce(ss.telefone, ''), '\D', '', 'g'), 9) = v_dig))) >= 2 then
      raise exception 'Você já tem pedidos de visita em aberto. Aguarde o nosso contato.';
    end if;
    -- Mensagem única para indisponível e ocupado: não revela a agenda de outros clientes.
    if exists (select 1 from public.imovel_indisponibilidades d
                where d.imovel_id = v_imovel.id and v_quando >= d.inicio and v_quando < d.fim)
       or exists (select 1 from public.visitas v
                   where v.imovel_id = v_imovel.id and v.status <> 'cancelada'
                     and v.data_hora > v_quando - interval '45 minutes' and v.data_hora < v_quando + interval '45 minutes') then
      raise exception 'Esse horário não está disponível. Escolha outro.';
    end if;
    v_extra := 'Quer visitar em ' || to_char(v_local, 'DD/MM/YYYY "às" HH24:MI') || '.';
  elsif v_tipo = 'empreendimento' then
    v_extra := 'Interesse no empreendimento ' || v_emp.nome || '.';
  elsif v_tipo = 'captacao' then
    v_extra := concat_ws(' · ',
      'Quer anunciar: ' || coalesce(v_tipo_imovel, 'imóvel'),
      nullif(concat_ws(', ', v_bairro, v_cidade), ''),
      case when p->>'finalidade' = 'venda' then 'para vender' when p->>'finalidade' = 'ambos' then 'para vender ou alugar' else 'para alugar' end);
  end if;
  v_msg := concat_ws(E'\n', nullif(v_extra, ''), v_texto);

  -- O mesmo envio repetido (mesmo contato, tipo e texto em 10 minutos) não grava de novo.
  if exists (select 1 from public.site_solicitacoes ss
              where ss.organizacao_id = s.organizacao_id and ss.origem = 'site' and ss.tipo = v_tipo
                and ss.created_at > now() - interval '10 minutes'
                and ss.mensagem is not distinct from nullif(v_msg, '')
                and ((v_email is not null and lower(ss.email) = v_email)
                  or (length(v_dig) >= 8 and right(regexp_replace(coalesce(ss.telefone, ''), '\D', '', 'g'), 9) = v_dig))) then
    return jsonb_build_object('ok', true);
  end if;

  v_res := public.receber_lead(o.leads_token, jsonb_build_object(
    'nome', v_nome, 'telefone', v_tel, 'email', v_email,
    'mensagem', v_msg, 'origem', 'site', 'funil', v_funil, 'imovel', v_imovel.codigo));

  if coalesce((v_res->>'captacao')::boolean, false) then
    v_capt := (v_res->>'id')::uuid;
    if not coalesce((v_res->>'duplicado')::boolean, false) then
      update public.captacoes set
        tipo = coalesce(v_tipo_imovel, tipo),
        finalidades = case when p->>'finalidade' = 'venda' then '{venda}'::text[]
                           when p->>'finalidade' = 'ambos' then '{locacao,venda}'::text[]
                           else '{locacao}'::text[] end,
        cidade = v_cidade,
        bairro = v_bairro,
        uf = v_uf,
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
            v_nome, v_tel, concat_ws(E'\n', 'Pedido pelo site — confirme com o cliente.', v_texto), null, true)
    returning id into v_visita;
    insert into public.visita_eventos (organizacao_id, visita_id, tipo, descricao, usuario_id)
    values (s.organizacao_id, v_visita, 'criada', 'Pedido pelo site', null);
  end if;

  insert into public.site_solicitacoes (organizacao_id, tipo, origem, nome, telefone, email, mensagem, imovel_id, empreendimento_id,
                                        lead_id, captacao_id, visita_id, visita_em, duplicado)
  values (s.organizacao_id, v_tipo, 'site', v_nome, v_tel, v_email, nullif(v_msg, ''), v_imovel.id, v_emp.id,
          v_lead, v_capt, v_visita, v_quando, coalesce((v_res->>'duplicado')::boolean, false));

  return jsonb_build_object('ok', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- 4) Feed dos portais
-- -----------------------------------------------------------------------------
/**
 * Dados do feed de um portal (código secreto da imobiliária). Nulo só se o código
 * não existir. Portal desligado, pausado ou site excluído: feed VAZIO (o portal
 * tira os anúncios), nunca "não encontrado" (o portal manteria a última carga).
 * Os imóveis saem na ordem do envio (destaques e os mais recentes primeiro).
 */
create or replace function public.portal_feed(p_token uuid, p_portal text)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  s public.site_config%rowtype;
  o public.organizacoes%rowtype;
  sp public.site_portais%rowtype;
  v_org uuid;
  v_ativo boolean;
begin
  if p_token is null or p_portal is null or p_portal not in ('zap','vivareal','olx') then return null; end if;
  select * into s from public.site_config where portais_token = p_token;
  if not found then
    select a.organizacao_id into v_org
      from privado.site_enderecos_antigos a
     where a.tipo = 'token' and a.valor = p_token::text and a.ate > now()
     order by a.created_at desc limit 1;
    if v_org is null then return null; end if;
    select * into o from public.organizacoes where id = v_org;
    if not found then return null; end if;
    return jsonb_build_object(
      'portal', p_portal, 'ativo', false, 'configurado', false, 'publicar_todos', false,
      'codigo_anunciante', null, 'limite_anuncios', null, 'limite_destaques', null,
      'site', jsonb_build_object('slug', null, 'ativo', false, 'nome', o.nome, 'email', o.email, 'telefone', o.telefone,
                                 'mostrar_endereco', false, 'dominio', null),
      'imoveis', '[]'::jsonb);
  end if;
  select * into o from public.organizacoes where id = s.organizacao_id and modo = 'imobiliaria';
  if not found then return null; end if;
  select * into sp from public.site_portais where organizacao_id = s.organizacao_id and portal = p_portal;
  v_ativo := coalesce(sp.ativo, false);

  return jsonb_build_object(
    'portal', p_portal,
    'ativo', v_ativo,
    'configurado', sp.id is not null,
    'publicar_todos', coalesce(sp.publicar_todos, false),
    'codigo_anunciante', sp.codigo_anunciante,
    'limite_anuncios', sp.limite_anuncios,
    'limite_destaques', sp.limite_destaques,
    'site', jsonb_build_object(
      'slug', s.slug, 'ativo', s.ativo, 'nome', coalesce(nullif(btrim(s.nome), ''), o.nome),
      'email', coalesce(s.email, o.email), 'telefone', coalesce(s.whatsapp, s.telefone, o.telefone),
      'mostrar_endereco', s.mostrar_endereco,
      'dominio', case when s.dominio_verificado_em is not null then s.dominio end),
    'imoveis', case when not v_ativo then '[]'::jsonb else coalesce((
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
             ) order by i.created_at desc, i.id desc)
        from public.imoveis i
        left join public.portal_imoveis pi on pi.imovel_id = i.id and pi.portal = p_portal and pi.organizacao_id = i.organizacao_id
       where i.organizacao_id = s.organizacao_id and i.status = 'disponivel'
         and coalesce(pi.publicado, sp.publicar_todos and i.publicar_site)), '[]'::jsonb) end
  );
end;
$$;

/**
 * Registra uma geração do feed com o que o PRÓPRIO banco calcula (os mesmos
 * imóveis de portal_feed, as mesmas falhas de validarParaPortal e o mesmo limite
 * do plano): quem chama não informa nada além da origem — com o link do feed
 * dá para, no máximo, registrar uma busca de verdade.
 * - origem 'portal' (o portal buscou): marca enviado/falha/fora do limite/fora do
 *   feed e mantém a aba Histórico do imóvel (abre o anúncio de quem entrou,
 *   encerra o de quem saiu, acompanha o preço), com as datas de Brasília;
 * - origem 'manual' ("Conferir agora", só quem é da imobiliária): grava a
 *   conferência e as falhas, mas NÃO marca "enviado" nem mexe nos anúncios — o
 *   portal ainda não buscou nada.
 * Devolve {id, elegiveis, enviados, falhas, fora_limite}, ou null se o portal não
 * estiver configurado ou passar do limite de registros por hora.
 */
create or replace function public.portal_sincronizar(p_token uuid, p_portal text, p_origem text default 'portal', p_agente text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
  sp public.site_portais%rowtype;
  v_manual boolean := coalesce(p_origem, 'portal') = 'manual';
  v_hoje date := (now() at time zone 'America/Sao_Paulo')::date;
  v_nome text := privado.portal_nome_anuncio(p_portal);
  v_enviados uuid[] := '{}';
  v_fora uuid[] := '{}';
  v_ids_falha uuid[] := '{}';
  v_falhas jsonb := '[]'::jsonb;
  v_elegiveis int := 0;
  v_id uuid;
  r record;
begin
  if p_portal is null or p_portal not in ('zap','vivareal','olx') then raise exception 'Portal desconhecido.'; end if;
  select s.organizacao_id into v_org
    from public.site_config s join public.organizacoes o on o.id = s.organizacao_id
   where s.portais_token = p_token and o.modo = 'imobiliaria';
  if v_org is null then raise exception 'Link de integração inválido.'; end if;
  if v_manual and not exists (select 1 from public.membros m where m.organizacao_id = v_org and m.user_id = auth.uid()) then
    raise exception 'Só a imobiliária confere o feed no sistema.';
  end if;
  select * into sp from public.site_portais where organizacao_id = v_org and portal = p_portal;
  if not found then return null; end if;
  -- Proteção contra excesso de chamadas: 120 buscas e 30 conferências por hora por portal.
  if (select count(*) from public.portal_sincronizacoes
       where organizacao_id = v_org and portal = p_portal and origem = case when v_manual then 'manual' else 'portal' end
         and gerado_em > now() - interval '1 hour') >= (case when v_manual then 30 else 120 end) then
    return null;
  end if;

  -- Mesma seleção do feed, na ordem do envio (destaques, mais recentes, id).
  for r in
    select i.id, i.codigo,
           privado.portal_problemas(i, p_portal,
             (select count(*)::int from public.imovel_midias m
               where m.imovel_id = i.id and m.tipo = 'foto' and m.organizacao_id = i.organizacao_id
                 and privado.caminho_do_imovel(m.path, i.organizacao_id, i.id))) as problemas
      from public.imoveis i
      left join public.portal_imoveis pi on pi.imovel_id = i.id and pi.portal = p_portal and pi.organizacao_id = i.organizacao_id
     where sp.ativo and i.organizacao_id = v_org and i.status = 'disponivel'
       and coalesce(pi.publicado, sp.publicar_todos and i.publicar_site)
     order by case coalesce(pi.destaque, 'normal') when 'super_destaque' then 2 when 'destaque' then 1 else 0 end desc,
              i.created_at desc, i.id desc
  loop
    v_elegiveis := v_elegiveis + 1;
    if cardinality(r.problemas) > 0 then
      v_ids_falha := v_ids_falha || r.id;
      v_falhas := v_falhas || jsonb_build_array(jsonb_build_object('imovel_id', r.id, 'codigo', r.codigo, 'problemas', to_jsonb(r.problemas)));
    elsif sp.limite_anuncios is null or cardinality(v_enviados) < sp.limite_anuncios then
      v_enviados := v_enviados || r.id;
    else
      v_fora := v_fora || r.id;
    end if;
  end loop;

  insert into public.portal_sincronizacoes (organizacao_id, portal, origem, total_elegiveis, total_enviados, total_falhas,
                                            total_fora_limite, falhas, agente)
  values (v_org, p_portal, case when v_manual then 'manual' else 'portal' end, v_elegiveis,
          cardinality(v_enviados), cardinality(v_ids_falha), cardinality(v_fora), v_falhas,
          privado.site_texto_limpo(p_agente, 200))
  returning id into v_id;

  -- Falhas e fora do limite: valem nos dois casos (é o que o portal recebe ou recebe sem).
  insert into public.portal_imoveis (organizacao_id, imovel_id, portal, verificado_em, ultimo_status, ultimas_falhas)
  select v_org, (f->>'imovel_id')::uuid, p_portal, now(), 'falha',
         array(select jsonb_array_elements_text(f->'problemas'))
    from jsonb_array_elements(v_falhas) f
  on conflict (imovel_id, portal) do update
    set verificado_em = now(), ultimo_status = 'falha', ultimas_falhas = excluded.ultimas_falhas
    where public.portal_imoveis.organizacao_id = v_org;

  insert into public.portal_imoveis (organizacao_id, imovel_id, portal, verificado_em, ultimo_status, ultimas_falhas)
  select v_org, x, p_portal, now(), 'fora_do_limite', '{}' from unnest(v_fora) x
  on conflict (imovel_id, portal) do update
    set verificado_em = now(), ultimo_status = 'fora_do_limite', ultimas_falhas = '{}'
    where public.portal_imoveis.organizacao_id = v_org;

  if v_manual then
    -- Conferência: quem está pronto fica "aguardando o portal" (sem status), sem data de envio.
    update public.portal_imoveis
       set ultimo_status = null, ultimas_falhas = '{}', verificado_em = now()
     where organizacao_id = v_org and portal = p_portal and imovel_id = any (v_enviados)
       and ultimo_status is distinct from 'enviado';
    return jsonb_build_object('id', v_id, 'elegiveis', v_elegiveis, 'enviados', to_jsonb(v_enviados),
                              'falhas', v_falhas, 'fora_limite', to_jsonb(v_fora));
  end if;

  insert into public.portal_imoveis (organizacao_id, imovel_id, portal, ultima_sincronizacao, verificado_em, ultimo_status, ultimas_falhas)
  select v_org, x, p_portal, now(), now(), 'enviado', '{}' from unnest(v_enviados) x
  on conflict (imovel_id, portal) do update
    set ultima_sincronizacao = now(), verificado_em = now(), ultimo_status = 'enviado', ultimas_falhas = '{}'
    where public.portal_imoveis.organizacao_id = v_org;

  -- Quem saiu do feed (alugado, vendido, tirado do site ou do portal, portal pausado).
  update public.portal_imoveis
     set ultimo_status = 'fora', ultimas_falhas = '{}', verificado_em = now()
   where organizacao_id = v_org and portal = p_portal
     and ultimo_status is distinct from 'fora'
     and not (imovel_id = any (v_enviados || v_ids_falha || v_fora));

  -- Histórico do imóvel (imovel_anuncios), com a data de hoje em Brasília --------
  -- 1) Saiu do feed: encerra hoje o anúncio aberto pelo feed.
  update public.imovel_anuncios a
     set fim = v_hoje
   where a.organizacao_id = v_org and a.origem = 'feed' and a.portal = v_nome and a.fim is null
     and not (a.imovel_id = any (v_enviados));
  -- 2) Voltou no mesmo dia em que saiu: reabre o mesmo anúncio.
  update public.imovel_anuncios a
     set fim = null
   where a.organizacao_id = v_org and a.origem = 'feed' and a.portal = v_nome and a.fim = v_hoje
     and a.imovel_id = any (v_enviados)
     and not exists (select 1 from public.imovel_anuncios b
                      where b.imovel_id = a.imovel_id and b.portal = v_nome and b.id <> a.id
                        and (b.fim is null or b.fim > v_hoje));
  -- 3) Entrou agora e não há anúncio desse portal no ar: abre um.
  insert into public.imovel_anuncios (organizacao_id, imovel_id, portal, url, inicio, valor, observacoes, origem)
  select v_org, i.id, v_nome, pi.url, v_hoje,
         coalesce(nullif(case when 'locacao' = any (i.finalidades) or not ('venda' = any (i.finalidades)) then i.valor_aluguel end, 0),
                  nullif(i.valor_venda, 0)),
         'Publicado pelo feed automático (Site e portais).', 'feed'
    from public.imoveis i
    left join public.portal_imoveis pi on pi.imovel_id = i.id and pi.portal = p_portal and pi.organizacao_id = i.organizacao_id
   where i.organizacao_id = v_org and i.id = any (v_enviados)
     and not exists (select 1 from public.imovel_anuncios a
                      where a.imovel_id = i.id and a.portal = v_nome and (a.fim is null or a.fim > v_hoje));
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

  return jsonb_build_object('id', v_id, 'elegiveis', v_elegiveis, 'enviados', to_jsonb(v_enviados),
                            'falhas', v_falhas, 'fora_limite', to_jsonb(v_fora));
end;
$$;

/**
 * Versão antiga do registro (recebia a lista pronta de quem chamava). Agora ignora
 * as listas enviadas e registra o que o banco calcula (portal_sincronizar). Não é
 * mais pública: o feed registra pela portal_sincronizar.
 */
create or replace function public.portal_registrar(p_token uuid, p_portal text, p jsonb)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  return (public.portal_sincronizar(p_token, p_portal,
            case when p->>'origem' = 'manual' then 'manual' else 'portal' end, p->>'agente')->>'id')::uuid;
end;
$$;

-- -----------------------------------------------------------------------------
-- 5) Leads dos portais (webhook)
-- -----------------------------------------------------------------------------
/**
 * Lead enviado pelo portal (webhook, com o código de LEADS — diferente do código do
 * feed). Entra pela receber_lead com a origem do portal. Limites: 120 por hora por
 * portal e 10 por hora por telefone/e-mail; o mesmo lead reenviado pelo portal
 * (id_externo) não repete. Devolve só {ok}.
 */
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
  v_nome text := privado.site_texto_limpo(p->>'nome', 120);
  v_tel text := privado.site_texto_limpo(p->>'telefone', 40);
  v_email text := lower(privado.site_texto_limpo(p->>'email', 160));
  v_msg text := privado.site_texto_limpo(p->>'mensagem', 2000, true);
  v_cod text := privado.site_texto_limpo(p->>'imovel', 40);
  v_ext text := privado.site_texto_limpo(p->>'id_externo', 80);
  v_dig text := right(regexp_replace(coalesce(p->>'telefone', ''), '\D', '', 'g'), 9);
begin
  if p_portal is null or p_portal not in ('zap','vivareal','olx') then raise exception 'Portal desconhecido.'; end if;
  select * into s from public.site_config where leads_portais_token = p_token;
  if not found then raise exception 'Link de integração inválido.'; end if;
  select * into o from public.organizacoes where id = s.organizacao_id and modo = 'imobiliaria';
  if not found then raise exception 'Link de integração inválido.'; end if;

  -- Reenvio do mesmo lead pelo portal (tentativas do webhook): já recebido.
  if v_ext is not null and exists (select 1 from public.site_solicitacoes
                                    where organizacao_id = o.id and origem = p_portal and id_externo = v_ext) then
    return jsonb_build_object('ok', true);
  end if;
  if (select count(*) from public.site_solicitacoes
       where organizacao_id = o.id and origem = p_portal and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'Muitas mensagens agora. Tente de novo mais tarde.';
  end if;
  if (select count(*) from public.site_solicitacoes ss
       where ss.organizacao_id = o.id and ss.origem = p_portal and ss.created_at > now() - interval '1 hour'
         and ((v_email is not null and lower(ss.email) = v_email)
           or (length(v_dig) >= 8 and right(regexp_replace(coalesce(ss.telefone, ''), '\D', '', 'g'), 9) = v_dig))) >= 10 then
    raise exception 'Muitas mensagens agora. Tente de novo mais tarde.';
  end if;

  if v_cod is not null then
    select id, finalidades into v_imovel, v_finalidades
      from public.imoveis where organizacao_id = o.id and lower(codigo) = lower(v_cod) limit 1;
  end if;
  -- Sem o tipo de negócio no lead, o funil sai do imóvel (só venda → funil de venda), como no site.
  v_dados := jsonb_build_object('nome', v_nome, 'telefone', v_tel, 'email', v_email,
                                'mensagem', v_msg, 'imovel', v_cod, 'origem', p_portal,
                                'funil', case when p->>'funil' in ('locacao','venda') then p->>'funil'
                                              when v_imovel is not null and not ('locacao' = any (coalesce(v_finalidades, '{}'))) then 'venda'
                                              else 'locacao' end);
  v_res := public.receber_lead(o.leads_token, v_dados);
  insert into public.site_solicitacoes (organizacao_id, tipo, origem, nome, telefone, email, mensagem, imovel_id, lead_id, duplicado, id_externo)
  values (o.id, 'portal', p_portal, v_nome, v_tel, v_email, v_msg, v_imovel,
          (v_res->>'id')::uuid, coalesce((v_res->>'duplicado')::boolean, false), v_ext);
  return jsonb_build_object('ok', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Permissões
-- -----------------------------------------------------------------------------
do $$
declare f text;
begin
  -- Públicas (anon): leitura do site/feed, formulários, registro do feed e leads.
  foreach f in array array[
    'public.site_slug_atual(text)', 'public.site_contato(text, jsonb)', 'public.portal_feed(uuid, text)',
    'public.portal_sincronizar(uuid, text, text, text)', 'public.portal_receber_lead(uuid, text, jsonb)'] loop
    execute format('revoke execute on function %s from public', f);
    execute format('grant execute on function %s to anon, authenticated', f);
  end loop;
end $$;
-- A versão antiga do registro (lista vinda de quem chama) deixa de ser pública.
revoke execute on function public.portal_registrar(uuid, text, jsonb) from public, anon;
grant execute on function public.portal_registrar(uuid, text, jsonb) to authenticated;
