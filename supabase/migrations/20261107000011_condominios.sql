-- =============================================================================
-- Gestão de condomínios (etapa 23) — módulo OPCIONAL e SÓ DA IMOBILIÁRIA.
--
-- Para quando a imobiliária também administra condomínios. Só aparece quando o
-- administrador liga o módulo (organizacoes.modulo_condominios) e a conta está
-- no modo imobiliária. O banco garante: toda escrita (policies e funções)
-- recusa com o módulo desligado ou no modo pessoal (privado.cond_ativo).
--
-- O DINHEIRO DO CONDOMÍNIO NÃO SE MISTURA COM O DA IMOBILIÁRIA: cada
-- condomínio tem o próprio livro-caixa (cond_contas: conta corrente e fundo de
-- reserva/fundos; cond_lancamentos: receitas, despesas e transferências). Nada
-- aqui grava em public.lancamentos, a não ser o botão explícito "lançar a taxa
-- de administração no financeiro da imobiliária" (cond_lancar_taxa_admin).
--
-- Quem mexe: administrador, gestor e financeiro (o corretor não), conforme o
-- perfil de acesso: cadastro/assembleias/comunicados/portal = módulo
-- "imoveis"; dinheiro (contas, lançamentos, orçamento, cotas, acordos,
-- fechamento, fornecedores) = "financeiro"; documentos = "documentos";
-- ocorrências = "manutencao"; áreas comuns e reservas = "agenda".
--
-- Cotas: rateio por fração ideal, igual ou por área, sem perder centavo
-- (privado.cond_ratear ≡ ratear() de src/lib/dominio/dinheiro.ts; a conta das
-- cotas é a mesma de calcularCotas() em src/lib/dominio/condominios.ts — mude
-- as duas juntas). Baixa SÓ pela RPC cond_registrar_pagamento (parcial, multa e
-- juros separados), que lança a receita no livro-caixa (a parte do fundo de
-- reserva vai para a conta do fundo).
--
-- Portal do condômino: /condominio/[token] (mesmo desenho do portal de
-- clientes: confirmação de 4 números, sessão com hash), tabelas próprias
-- cond_portal_*. Escrita pública só por funções que conferem token + sessão,
-- com limite por link e por condomínio.
--
-- Sem DROP: tabelas/índices "if not exists", funções e gatilhos "create or
-- replace", policies criadas só se ainda não existirem.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Módulo ligado/desligado e permissões
-- -----------------------------------------------------------------------------
alter table public.organizacoes add column if not exists modulo_condominios boolean not null default false;

/** Módulo de condomínios em uso: ligado E conta no modo imobiliária. */
create or replace function privado.cond_ativo(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((select o.modulo_condominios and o.modo = 'imobiliaria' from public.organizacoes o where o.id = p_org), false)
$$;
revoke execute on function privado.cond_ativo(uuid) from public, anon;
grant execute on function privado.cond_ativo(uuid) to authenticated;

/** Equipe que cuida dos condomínios: administrador, gestor e financeiro (o corretor não). */
create or replace function privado.cond_equipe(p_org uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.membros m
                  where m.organizacao_id = p_org and m.user_id = auth.uid() and m.papel in ('admin','gestor','financeiro'))
$$;
revoke execute on function privado.cond_equipe(uuid) from public, anon;
grant execute on function privado.cond_equipe(uuid) to authenticated;

/** Pode gravar: módulo em uso + equipe + perfil de acesso com a operação no módulo. */
create or replace function privado.cond_pode(p_org uuid, p_modulo text, p_operacao text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select privado.cond_ativo(p_org) and privado.cond_equipe(p_org) and privado.tem_permissao(p_org, p_modulo, p_operacao)
$$;
revoke execute on function privado.cond_pode(uuid, text, text) from public, anon;
grant execute on function privado.cond_pode(uuid, text, text) to authenticated;

/** Para as funções que gravam (security definer): recusa com a mensagem certa. */
create or replace function privado.cond_exigir(p_org uuid, p_modulo text, p_operacao text)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_org is null then
    raise exception 'Condomínio não encontrado.';
  end if;
  if not privado.cond_ativo(p_org) then
    raise exception 'O módulo de condomínios está desligado (ou a conta está no modo imóveis pessoais). O administrador liga em Configurações › Condomínios.';
  end if;
  if auth.uid() is null then return; end if;
  if p_org not in (select privado.org_ids()) then
    raise exception 'Condomínio não encontrado.';
  end if;
  if not privado.cond_equipe(p_org) then
    raise exception 'Só administradores, gestores e o financeiro cuidam dos condomínios.';
  end if;
  perform privado.exigir_permissao(p_org, p_modulo, p_operacao);
end;
$$;
revoke execute on function privado.cond_exigir(uuid, text, text) from public, anon;
grant execute on function privado.cond_exigir(uuid, text, text) to authenticated;

/** Só o administrador liga/desliga; e só no modo imobiliária. */
create or replace function privado.cond_organizacao_modulo()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.modulo_condominios is distinct from old.modulo_condominios then
    if auth.uid() is not null and privado.papel_atual(old.id) is distinct from 'admin' then
      raise exception 'Só o administrador liga ou desliga o módulo de condomínios.';
    end if;
    if new.modulo_condominios and new.modo = 'pessoal' then
      raise exception 'A gestão de condomínios só existe no modo imobiliária.';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger organizacoes_cond_modulo_trg before update on public.organizacoes
  for each row execute function privado.cond_organizacao_modulo();

/** Liga ou desliga o módulo (Configurações › Condomínios). Os dados ficam guardados ao desligar. */
create or replace function public.cond_ligar_modulo(p_ligar boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid := privado.org_atual();
begin
  if v_org is null or privado.papel_atual(v_org) is distinct from 'admin' then
    raise exception 'Só o administrador liga ou desliga o módulo de condomínios.';
  end if;
  update public.organizacoes set modulo_condominios = coalesce(p_ligar, false) where id = v_org;
end;
$$;
revoke execute on function public.cond_ligar_modulo(boolean) from public, anon;
grant execute on function public.cond_ligar_modulo(boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. Tabelas
-- -----------------------------------------------------------------------------
create table if not exists public.cond_condominios (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  nome text not null,
  cnpj text,
  cep text,
  logradouro text,
  numero text,
  complemento text,
  bairro text,
  cidade text,
  uf text,
  sindico_id uuid references public.pessoas(id) on delete set null,
  responsavel_user_id uuid,
  dia_vencimento int not null default 10 check (dia_vencimento between 1 and 31),
  multa_pct numeric(6,3) not null default 2 check (multa_pct between 0 and 20),
  juros_mes_pct numeric(6,3) not null default 1 check (juros_mes_pct between 0 and 10),
  criterio_rateio text not null default 'fracao' check (criterio_rateio in ('fracao','igual','area')),
  fundo_reserva_pct numeric(6,3) not null default 0 check (fundo_reserva_pct between 0 and 100),
  voto_peso text not null default 'fracao' check (voto_peso in ('fracao','unidade')),
  pix_chave text,
  pix_nome text,
  pix_cidade text,
  banco text,
  agencia text,
  conta text,
  taxa_administracao numeric(14,2) not null default 0 check (taxa_administracao >= 0),
  ativo boolean not null default true,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.cond_blocos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  nome text not null,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);
create unique index if not exists cond_blocos_nome_idx on public.cond_blocos (condominio_id, lower(nome));

create table if not exists public.cond_unidades (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  bloco_id uuid references public.cond_blocos(id),
  numero text not null,
  tipo text not null default 'apartamento' check (tipo in ('apartamento','casa','sala','loja','garagem','outro')),
  area_privativa numeric(10,2) check (area_privativa is null or area_privativa >= 0),
  fracao_ideal numeric(12,6) check (fracao_ideal is null or fracao_ideal >= 0),
  vaga text,
  situacao text not null default 'ocupada' check (situacao in ('ocupada','alugada','vazia','em_obra')),
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists cond_unidades_numero_idx
  on public.cond_unidades (condominio_id, coalesce(bloco_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(numero));
create index if not exists cond_unidades_cond_idx on public.cond_unidades (condominio_id);

-- Condôminos (proprietários), inquilinos, moradores, síndico, subsíndico e conselheiros.
create table if not exists public.cond_pessoas_unidade (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  unidade_id uuid references public.cond_unidades(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  papel text not null check (papel in ('proprietario','inquilino','morador','sindico','subsindico','conselheiro')),
  inicio date not null default ((now() at time zone 'America/Sao_Paulo')::date),
  fim date,
  responsavel_financeiro boolean not null default false,
  created_at timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index if not exists cond_pessoas_unidade_cond_idx on public.cond_pessoas_unidade (condominio_id, papel);
create index if not exists cond_pessoas_unidade_pessoa_idx on public.cond_pessoas_unidade (pessoa_id);
create index if not exists cond_pessoas_unidade_unidade_idx on public.cond_pessoas_unidade (unidade_id);
-- Um responsável financeiro em vigor por unidade.
create unique index if not exists cond_pessoas_unidade_resp_idx on public.cond_pessoas_unidade (unidade_id)
  where responsavel_financeiro and fim is null;

-- Livro-caixa do condomínio: conta corrente, fundo de reserva e outros fundos.
create table if not exists public.cond_contas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  nome text not null,
  tipo text not null default 'corrente' check (tipo in ('corrente','reserva','fundo')),
  saldo_inicial numeric(14,2) not null default 0,
  banco text,
  agencia text,
  conta text,
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists cond_contas_cond_idx on public.cond_contas (condominio_id, tipo);

-- Contratos com fornecedores (geram previsões de despesa).
create table if not exists public.cond_contratos_fornecedores (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  fornecedor_id uuid references public.pessoas(id) on delete set null,
  fornecedor_nome text,
  servico text not null,
  categoria text not null default 'Serviços',
  valor numeric(14,2) not null default 0 check (valor >= 0),
  periodicidade text not null default 'mensal' check (periodicidade in ('mensal','bimestral','trimestral','semestral','anual','unico')),
  inicio date not null,
  fim date,
  dia_vencimento int check (dia_vencimento is null or dia_vencimento between 1 and 31),
  reajuste_indice text,
  reajuste_mes int check (reajuste_mes is null or reajuste_mes between 1 and 12),
  conta_id uuid references public.cond_contas(id) on delete set null,
  documento_path text,
  ativo boolean not null default true,
  observacoes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (fim is null or fim >= inicio)
);
create index if not exists cond_contratos_cond_idx on public.cond_contratos_fornecedores (condominio_id, ativo);

-- Assembleias (antes dos lançamentos: a saída do fundo de reserva aponta para a assembleia que aprovou).
create table if not exists public.cond_assembleias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  tipo text not null default 'ordinaria' check (tipo in ('ordinaria','extraordinaria')),
  titulo text not null,
  data timestamptz not null,
  segunda_chamada timestamptz,
  local text,
  link_online text,
  status text not null default 'rascunho' check (status in ('rascunho','convocada','em_andamento','encerrada','cancelada')),
  voto_peso text not null default 'fracao' check (voto_peso in ('fracao','unidade')),
  voto_portal boolean not null default false,
  edital text,
  ata text,
  convocada_em timestamptz,
  encerrada_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cond_assembleias_cond_idx on public.cond_assembleias (condominio_id, data desc);

create table if not exists public.cond_assembleia_itens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  assembleia_id uuid not null references public.cond_assembleias(id) on delete cascade,
  ordem int not null default 1,
  titulo text not null,
  descricao text,
  tipo_votacao text not null default 'simples' check (tipo_votacao in ('simples','dois_tercos','unanimidade','informativo')),
  opcoes text[] not null default array['Sim','Não','Abstenção'],
  resultado text,
  created_at timestamptz not null default now()
);
create index if not exists cond_assembleia_itens_idx on public.cond_assembleia_itens (assembleia_id, ordem);

create table if not exists public.cond_assembleia_presencas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  assembleia_id uuid not null references public.cond_assembleias(id) on delete cascade,
  unidade_id uuid not null references public.cond_unidades(id) on delete cascade,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  nome text,
  procuracao boolean not null default false,
  procurador_nome text,
  origem text not null default 'presencial' check (origem in ('presencial','portal')),
  created_at timestamptz not null default now()
);
create unique index if not exists cond_assembleia_presencas_un_idx on public.cond_assembleia_presencas (assembleia_id, unidade_id);

-- Votos: um por unidade em cada item (peso pela fração ideal ou 1 por unidade). Só pelo banco.
create table if not exists public.cond_votos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  assembleia_id uuid not null references public.cond_assembleias(id) on delete cascade,
  item_id uuid not null references public.cond_assembleia_itens(id) on delete cascade,
  unidade_id uuid not null references public.cond_unidades(id) on delete cascade,
  opcao text not null,
  peso numeric(12,6) not null default 1,
  origem text not null default 'presencial' check (origem in ('presencial','portal')),
  pessoa_id uuid references public.pessoas(id) on delete set null,
  registrado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create unique index if not exists cond_votos_un_idx on public.cond_votos (item_id, unidade_id);
create index if not exists cond_votos_assembleia_idx on public.cond_votos (assembleia_id);

-- Rateios extras (obra, fundo de reserva, chamada de capital), em parcelas.
create table if not exists public.cond_rateios (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  descricao text not null,
  tipo text not null default 'obra' check (tipo in ('obra','fundo_reserva','chamada_capital','outro')),
  valor_total numeric(14,2) not null check (valor_total > 0),
  parcelas int not null default 1 check (parcelas between 1 and 120),
  primeira_competencia date not null,
  criterio text not null default 'fracao' check (criterio in ('fracao','igual','area')),
  conta_id uuid references public.cond_contas(id) on delete set null,
  assembleia_id uuid references public.cond_assembleias(id) on delete set null,
  ativo boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists cond_rateios_cond_idx on public.cond_rateios (condominio_id, ativo);

-- Orçamento anual (valores mensais por categoria) → base da cota.
create table if not exists public.cond_orcamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  ano int not null check (ano between 2000 and 2100),
  descricao text,
  status text not null default 'rascunho' check (status in ('rascunho','aprovado')),
  aprovado_em date,
  assembleia_id uuid references public.cond_assembleias(id) on delete set null,
  observacoes text,
  created_at timestamptz not null default now()
);
create unique index if not exists cond_orcamentos_aprovado_idx on public.cond_orcamentos (condominio_id, ano) where status = 'aprovado';

create table if not exists public.cond_orcamento_itens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  orcamento_id uuid not null references public.cond_orcamentos(id) on delete cascade,
  categoria text not null,
  tipo text not null default 'despesa' check (tipo in ('despesa','receita')),
  valor_mensal numeric(14,2) not null default 0 check (valor_mensal >= 0),
  observacao text,
  created_at timestamptz not null default now()
);
create index if not exists cond_orcamento_itens_idx on public.cond_orcamento_itens (orcamento_id);

-- Consumo individual (água/gás por leitura), cobrado na cota do mês.
create table if not exists public.cond_consumos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  unidade_id uuid not null references public.cond_unidades(id) on delete cascade,
  competencia date not null,
  tipo text not null default 'agua' check (tipo in ('agua','gas','energia','outro')),
  leitura_anterior numeric(14,3),
  leitura_atual numeric(14,3),
  valor numeric(14,2) not null check (valor >= 0),
  cota_item_id uuid,
  created_at timestamptz not null default now()
);
create unique index if not exists cond_consumos_un_idx on public.cond_consumos (unidade_id, competencia, tipo);

-- Áreas comuns e reservas (sem conflito de horário: garantido no gatilho).
create table if not exists public.cond_areas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  nome text not null,
  regras text,
  capacidade int check (capacidade is null or capacidade > 0),
  antecedencia_min_horas int not null default 24 check (antecedencia_min_horas between 0 and 2160),
  antecedencia_max_dias int not null default 90 check (antecedencia_max_dias between 1 and 730),
  duracao_max_horas int not null default 12 check (duracao_max_horas between 1 and 72),
  taxa numeric(14,2) not null default 0 check (taxa >= 0),
  ativa boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.cond_reservas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  area_id uuid not null references public.cond_areas(id) on delete cascade,
  unidade_id uuid not null references public.cond_unidades(id) on delete cascade,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  inicio timestamptz not null,
  fim timestamptz not null,
  status text not null default 'pedida' check (status in ('pedida','confirmada','recusada','cancelada')),
  taxa numeric(14,2) check (taxa is null or taxa >= 0),
  origem text not null default 'equipe' check (origem in ('equipe','portal')),
  observacao text,
  resposta text,
  cota_item_id uuid,
  decidido_por uuid,
  decidido_em timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists cond_reservas_area_idx on public.cond_reservas (area_id, inicio);
create index if not exists cond_reservas_cond_idx on public.cond_reservas (condominio_id, inicio desc);

-- Acordos (parcelamento de cotas atrasadas).
create table if not exists public.cond_acordos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  unidade_id uuid not null references public.cond_unidades(id) on delete cascade,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  numero bigint generated by default as identity,
  valor_original numeric(14,2) not null,
  desconto numeric(14,2) not null default 0,
  valor_total numeric(14,2) not null,
  parcelas int not null,
  primeiro_vencimento date not null,
  status text not null default 'ativo' check (status in ('ativo','quitado','cancelado')),
  observacao text,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cond_acordos_cond_idx on public.cond_acordos (condominio_id, status);

-- Cotas condominiais (uma ordinária por unidade e mês; parcelas de acordo e avulsas à parte).
create table if not exists public.cond_cotas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  unidade_id uuid not null references public.cond_unidades(id) on delete cascade,
  numero bigint generated by default as identity,
  tipo text not null default 'ordinaria' check (tipo in ('ordinaria','acordo','avulsa')),
  competencia date not null,
  vencimento date not null,
  valor numeric(14,2) not null default 0 check (valor >= 0),
  valor_abatido numeric(14,2) not null default 0,
  status text not null default 'aberta' check (status in ('aberta','paga','cancelada','renegociada')),
  pago_em date,
  acordo_id uuid references public.cond_acordos(id) on delete set null,
  acordo_parcela_de uuid references public.cond_acordos(id) on delete set null,
  parcela int,
  juridico boolean not null default false,
  juridico_em date,
  juridico_obs text,
  cancelado_motivo text,
  created_at timestamptz not null default now()
);
create unique index if not exists cond_cotas_ordinaria_idx on public.cond_cotas (unidade_id, competencia)
  where tipo = 'ordinaria' and status <> 'cancelada';
create index if not exists cond_cotas_cond_idx on public.cond_cotas (condominio_id, competencia, status);
create index if not exists cond_cotas_aberta_idx on public.cond_cotas (condominio_id, status, vencimento);
create index if not exists cond_cotas_unidade_idx on public.cond_cotas (unidade_id, competencia desc);

create table if not exists public.cond_cota_itens (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  cota_id uuid not null references public.cond_cotas(id) on delete cascade,
  tipo text not null check (tipo in ('ordinaria','fundo_reserva','rateio_extra','consumo','reserva_area','acordo','outro')),
  descricao text not null,
  valor numeric(14,2) not null check (valor >= 0),
  conta_id uuid references public.cond_contas(id) on delete set null,
  rateio_id uuid references public.cond_rateios(id) on delete set null,
  consumo_id uuid references public.cond_consumos(id) on delete set null,
  reserva_id uuid references public.cond_reservas(id) on delete set null
);
create index if not exists cond_cota_itens_cota_idx on public.cond_cota_itens (cota_id);

create table if not exists public.cond_cota_pagamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  cota_id uuid not null references public.cond_cotas(id) on delete cascade,
  data date not null,
  valor numeric(14,2) not null check (valor > 0),
  principal numeric(14,2) not null default 0,
  multa numeric(14,2) not null default 0,
  juros numeric(14,2) not null default 0,
  desconto numeric(14,2) not null default 0,
  forma text,
  conta_id uuid references public.cond_contas(id) on delete set null,
  estornado_em timestamptz,
  estornado_por uuid,
  estorno_motivo text,
  registrado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cond_cota_pagamentos_cota_idx on public.cond_cota_pagamentos (cota_id);
create index if not exists cond_cota_pagamentos_data_idx on public.cond_cota_pagamentos (condominio_id, data);

-- Lançamentos do livro-caixa (receitas, despesas e transferências entre contas).
create table if not exists public.cond_lancamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  conta_id uuid references public.cond_contas(id),
  conta_destino_id uuid references public.cond_contas(id),
  tipo text not null check (tipo in ('receita','despesa','transferencia')),
  categoria text not null default 'Outros',
  descricao text not null,
  valor numeric(14,2) not null check (valor > 0),
  competencia date not null,
  vencimento date,
  pago_em date,
  status text not null default 'aberto' check (status in ('aberto','pago','cancelado')),
  fornecedor_id uuid references public.pessoas(id) on delete set null,
  contrato_id uuid references public.cond_contratos_fornecedores(id) on delete set null,
  rateio_id uuid references public.cond_rateios(id) on delete set null,
  cota_pagamento_id uuid references public.cond_cota_pagamentos(id) on delete set null,
  aprovacao_assembleia_id uuid references public.cond_assembleias(id) on delete set null,
  aprovacao_texto text,
  aprovado_por uuid,
  aprovado_em timestamptz,
  observacoes text,
  criado_por uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cond_lancamentos_cond_idx on public.cond_lancamentos (condominio_id, competencia);
create index if not exists cond_lancamentos_pago_idx on public.cond_lancamentos (condominio_id, status, pago_em);
create index if not exists cond_lancamentos_conta_idx on public.cond_lancamentos (conta_id, pago_em);
create index if not exists cond_lancamentos_destino_idx on public.cond_lancamentos (conta_destino_id, pago_em);
create index if not exists cond_lancamentos_pagamento_idx on public.cond_lancamentos (cota_pagamento_id);
create index if not exists cond_lancamentos_contrato_idx on public.cond_lancamentos (contrato_id, competencia);

-- Fechamento do mês (trava os lançamentos pagos naquele mês; reabrir só o administrador).
create table if not exists public.cond_fechamentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  competencia date not null,
  status text not null default 'fechado' check (status in ('fechado','reaberto')),
  fechado_em timestamptz,
  fechado_por uuid,
  reaberto_em timestamptz,
  reaberto_por uuid,
  motivo_reabertura text,
  resumo jsonb,
  created_at timestamptz not null default now()
);
create unique index if not exists cond_fechamentos_un_idx on public.cond_fechamentos (condominio_id, competencia);

-- Solicitações e ocorrências.
create table if not exists public.cond_ocorrencias (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  unidade_id uuid references public.cond_unidades(id) on delete set null,
  pessoa_id uuid references public.pessoas(id) on delete set null,
  numero bigint generated by default as identity,
  tipo text not null default 'manutencao' check (tipo in ('manutencao','barulho','seguranca','sugestao','reclamacao','outro')),
  titulo text not null,
  descricao text,
  status text not null default 'aberta' check (status in ('aberta','em_andamento','resolvida','cancelada')),
  origem text not null default 'equipe' check (origem in ('equipe','portal')),
  fotos text[] not null default '{}',
  responsavel_user_id uuid,
  resolvida_em timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists cond_ocorrencias_cond_idx on public.cond_ocorrencias (condominio_id, status, created_at desc);

-- Respostas (histórico: só leitura e acréscimo; autor e data fixados pelo banco).
create table if not exists public.cond_ocorrencia_respostas (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  ocorrencia_id uuid not null references public.cond_ocorrencias(id) on delete cascade,
  autor text not null default 'equipe' check (autor in ('equipe','morador')),
  texto text not null,
  usuario_id uuid default auth.uid(),
  pessoa_id uuid references public.pessoas(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cond_ocorrencia_respostas_idx on public.cond_ocorrencia_respostas (ocorrencia_id, created_at);

-- Comunicados aos moradores (mural) e confirmação de leitura pelo portal.
create table if not exists public.cond_comunicados (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  titulo text not null,
  texto text not null,
  publico text not null default 'todos' check (publico in ('todos','bloco','unidades')),
  bloco_id uuid references public.cond_blocos(id) on delete set null,
  unidades uuid[] not null default '{}',
  publicado_em timestamptz not null default now(),
  expira_em date,
  fixado boolean not null default false,
  autor uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cond_comunicados_cond_idx on public.cond_comunicados (condominio_id, publicado_em desc);

create table if not exists public.cond_comunicado_leituras (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  comunicado_id uuid not null references public.cond_comunicados(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
  lido_em timestamptz not null default now()
);
create unique index if not exists cond_comunicado_leituras_un_idx on public.cond_comunicado_leituras (comunicado_id, pessoa_id);

-- Documentos condominiais (bucket privado "condominios", pasta <org>/<condominio>/).
create table if not exists public.cond_documentos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  tipo text not null default 'outro' check (tipo in ('convencao','regimento','ata','seguro','avcb','contrato','balancete','outro')),
  titulo text not null,
  path text not null,
  nome_arquivo text,
  validade date,
  publico_portal boolean not null default false,
  link_portal text,
  link_expira_em timestamptz,
  enviado_por uuid default auth.uid(),
  created_at timestamptz not null default now()
);
create index if not exists cond_documentos_cond_idx on public.cond_documentos (condominio_id, tipo);

-- Taxa de administração lançada no financeiro da IMOBILIÁRIA (uma por mês).
create table if not exists public.cond_taxas_admin (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  competencia date not null,
  valor numeric(14,2) not null,
  lancamento_id uuid references public.lancamentos(id) on delete set null,
  created_at timestamptz not null default now()
);
create unique index if not exists cond_taxas_admin_un_idx on public.cond_taxas_admin (condominio_id, competencia);

-- Histórico das ações sensíveis (só leitura; gravado pelo banco).
create table if not exists public.cond_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid references public.cond_condominios(id) on delete cascade,
  tipo text not null,
  descricao text not null,
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index if not exists cond_eventos_cond_idx on public.cond_eventos (condominio_id, data desc);

-- Portal do condômino: link pessoal por pessoa + condomínio, sessões (só o hash) e registro.
create table if not exists public.cond_portal_acessos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid not null references public.cond_condominios(id) on delete cascade,
  pessoa_id uuid not null references public.pessoas(id) on delete cascade,
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
create unique index if not exists cond_portal_acessos_token_idx on public.cond_portal_acessos (token);
create unique index if not exists cond_portal_acessos_pessoa_idx on public.cond_portal_acessos (condominio_id, pessoa_id) where ativo;

create table if not exists public.cond_portal_sessoes (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  acesso_id uuid not null references public.cond_portal_acessos(id) on delete cascade,
  hash text not null,
  expira_em timestamptz not null,
  ip text,
  user_agent text,
  created_at timestamptz not null default now()
);
create unique index if not exists cond_portal_sessoes_hash_idx on public.cond_portal_sessoes (hash);
create index if not exists cond_portal_sessoes_acesso_idx on public.cond_portal_sessoes (acesso_id, expira_em);

-- Registro do portal: NÃO some com o link (acesso vira nulo; pessoa e condomínio ficam copiados).
create table if not exists public.cond_portal_eventos (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  condominio_id uuid,
  acesso_id uuid references public.cond_portal_acessos(id) on delete set null,
  pessoa_id uuid,
  pessoa_nome text,
  tipo text not null,
  descricao text,
  ip text,
  usuario_id uuid default auth.uid(),
  data timestamptz not null default now()
);
create index if not exists cond_portal_eventos_acesso_idx on public.cond_portal_eventos (acesso_id, tipo, data desc);
create index if not exists cond_portal_eventos_cond_idx on public.cond_portal_eventos (condominio_id, tipo, data desc);

-- Pasta liberada (2 horas) para fotos de uma ocorrência aberta pelo portal: <org>/portal/<envio>/.
create table if not exists public.cond_portal_envios (
  id uuid primary key default gen_random_uuid(),
  organizacao_id uuid not null default privado.org_atual() references public.organizacoes(id) on delete cascade,
  acesso_id uuid not null references public.cond_portal_acessos(id) on delete cascade,
  ocorrencia_id uuid not null references public.cond_ocorrencias(id) on delete cascade,
  arquivos int not null default 0,
  expira_em timestamptz not null default (now() + interval '2 hours'),
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 3. Apoio: rateio sem perder centavo, datas, nomes e registro
-- -----------------------------------------------------------------------------

/**
 * Divide p_total (centavos) pelos pesos; a soma das partes é exatamente o
 * total (a diferença de arredondamento vai, um centavo por vez, para os
 * maiores pesos; empate: quem vem primeiro). Mesma conta de ratear() em
 * src/lib/dominio/dinheiro.ts.
 */
create or replace function privado.cond_ratear(p_total bigint, p_pesos numeric[])
returns bigint[]
language plpgsql
immutable
set search_path = ''
as $$
declare
  n int := coalesce(array_length(p_pesos, 1), 0);
  v_soma numeric;
  v_partes bigint[];
  v_ordem int[];
  v_resto bigint;
  k int := 0;
  i int;
begin
  if n = 0 then return '{}'::bigint[]; end if;
  select sum(x) into v_soma from unnest(p_pesos) x;
  if v_soma is null or v_soma <= 0 then
    raise exception 'A soma dos pesos do rateio deve ser maior que zero.';
  end if;
  v_partes := array(select floor(p_total * p_pesos[g] / v_soma)::bigint from generate_series(1, n) g order by g);
  select p_total - sum(x) into v_resto from unnest(v_partes) x;
  v_ordem := array(select g from generate_series(1, n) g order by p_pesos[g] desc, g);
  while v_resto <> 0 loop
    i := v_ordem[(k % n) + 1];
    if v_resto > 0 then
      v_partes[i] := v_partes[i] + 1;
      v_resto := v_resto - 1;
    else
      v_partes[i] := v_partes[i] - 1;
      v_resto := v_resto + 1;
    end if;
    k := k + 1;
  end loop;
  return v_partes;
end;
$$;
revoke execute on function privado.cond_ratear(bigint, numeric[]) from public, anon;
grant execute on function privado.cond_ratear(bigint, numeric[]) to authenticated;

/** Hoje em Brasília. */
create or replace function privado.cond_hoje()
returns date
language sql
stable
set search_path = ''
as $$
  select (now() at time zone 'America/Sao_Paulo')::date
$$;

/** Dia do mês limitado ao último dia (dia 31 em fevereiro = 28/29). */
create or replace function privado.cond_dia_no_mes(p_mes date, p_dia int)
returns date
language sql
immutable
set search_path = ''
as $$
  select (date_trunc('month', p_mes)::date
          + (least(greatest(coalesce(p_dia, 1), 1),
                   extract(day from (date_trunc('month', p_mes) + interval '1 month - 1 day'))::int) - 1))
$$;

/** Peso de uma unidade no critério (fração ×1.000.000, área ×100, igual = 1): os mesmos inteiros de pesosDoCriterio(). */
create or replace function privado.cond_peso(p_criterio text, p_fracao numeric, p_area numeric)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select case p_criterio
           when 'fracao' then round(coalesce(p_fracao, 0) * 1000000)
           when 'area' then round(coalesce(p_area, 0) * 100)
           else 1 end::numeric
$$;

/** "Bloco A - 101" (ou só "101"). */
create or replace function privado.cond_unidade_nome(p_unidade uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select case when b.id is not null then b.nome || ' - ' || u.numero else u.numero end
    from public.cond_unidades u left join public.cond_blocos b on b.id = u.bloco_id
   where u.id = p_unidade
$$;
revoke execute on function privado.cond_unidade_nome(uuid) from public, anon;
grant execute on function privado.cond_unidade_nome(uuid) to authenticated;

create or replace function privado.cond_evento(p_condominio uuid, p_tipo text, p_descricao text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.cond_eventos (organizacao_id, condominio_id, tipo, descricao)
  select c.organizacao_id, c.id, p_tipo, left(p_descricao, 1000) from public.cond_condominios c where c.id = p_condominio
$$;
revoke execute on function privado.cond_evento(uuid, text, text) from public, anon, authenticated;

/** O condomínio (ou a organização inteira) está sendo excluído? Aí as travas não valem (exclusão em cascata). */
create or replace function privado.cond_em_exclusao(p_org uuid, p_condominio uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select not exists (select 1 from public.organizacoes where id = p_org)
      or not exists (select 1 from public.cond_condominios where id = p_condominio)
$$;
revoke execute on function privado.cond_em_exclusao(uuid, uuid) from public, anon, authenticated;

/** O mês (de uma data) está fechado neste condomínio? */
create or replace function privado.cond_mes_fechado(p_condominio uuid, p_data date)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select p_data is not null and exists (select 1 from public.cond_fechamentos f
                 where f.condominio_id = p_condominio and f.competencia = date_trunc('month', p_data)::date and f.status = 'fechado')
$$;
revoke execute on function privado.cond_mes_fechado(uuid, date) from public, anon;
grant execute on function privado.cond_mes_fechado(uuid, date) to authenticated;

/** Conta padrão do condomínio por tipo (a primeira ativa). */
create or replace function privado.cond_conta_padrao(p_condominio uuid, p_tipo text)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.cond_contas where condominio_id = p_condominio and tipo = p_tipo and ativa order by created_at, id limit 1
$$;
revoke execute on function privado.cond_conta_padrao(uuid, text) from public, anon;
grant execute on function privado.cond_conta_padrao(uuid, text) to authenticated;

/**
 * O contrato com fornecedor gera despesa neste mês? (mensal, bimestral,
 * trimestral, semestral, anual a partir do mês de início; único só no mês de
 * início; dentro da vigência). Mesma conta de contratoNoMes().
 */
create or replace function privado.cond_contrato_no_mes(p_periodicidade text, p_inicio date, p_fim date, p_competencia date)
returns boolean
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_comp date := date_trunc('month', p_competencia)::date;
  v_meses int;
  v_passo int;
begin
  if p_inicio is null then return false; end if;
  v_meses := ((extract(year from v_comp) - extract(year from p_inicio)) * 12 + extract(month from v_comp) - extract(month from p_inicio))::int;
  if v_meses < 0 then return false; end if;
  if p_fim is not null and v_comp > date_trunc('month', p_fim)::date then return false; end if;
  if p_periodicidade = 'unico' then return v_meses = 0; end if;
  v_passo := case p_periodicidade when 'bimestral' then 2 when 'trimestral' then 3 when 'semestral' then 6 when 'anual' then 12 else 1 end;
  return v_meses % v_passo = 0;
end;
$$;

/**
 * Situação de uma cota numa data: saldo e a sugestão de multa (uma vez, se
 * ainda não cobrada) e juros pro rata dia (mês de 30 dias) desde o vencimento
 * ou desde o último pagamento feito em atraso. Mesma conta de situacaoFatura()
 * (src/lib/dominio/cobrancas.ts) sem carência.
 */
create or replace function privado.cond_encargos(p_cota uuid, p_data date, out saldo numeric, out multa numeric, out juros numeric, out dias int)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  q public.cond_cotas%rowtype;
  c public.cond_condominios%rowtype;
  v_multa_cobrada numeric;
  v_ultimo date;
  v_dias_juros int;
begin
  select * into q from public.cond_cotas where id = p_cota;
  select * into c from public.cond_condominios where id = q.condominio_id;
  saldo := greatest(0, q.valor - q.valor_abatido);
  dias := greatest(0, p_data - q.vencimento);
  multa := 0;
  juros := 0;
  if saldo > 0 and dias > 0 and q.status = 'aberta' then
    select coalesce(sum(p.multa), 0), max(p.data) filter (where p.data > q.vencimento and p.data <= p_data)
      into v_multa_cobrada, v_ultimo
      from public.cond_cota_pagamentos p where p.cota_id = q.id and p.estornado_em is null;
    if v_multa_cobrada = 0 then
      multa := round(saldo * c.multa_pct / 100, 2);
    end if;
    v_dias_juros := greatest(0, p_data - coalesce(v_ultimo, q.vencimento));
    juros := round(saldo * c.juros_mes_pct / 100 * v_dias_juros / 30, 2);
  end if;
  if saldo = 0 or q.status <> 'aberta' then dias := 0; end if;
end;
$$;
revoke execute on function privado.cond_encargos(uuid, date) from public, anon;
grant execute on function privado.cond_encargos(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. Gatilhos de consistência
-- -----------------------------------------------------------------------------

/**
 * Conferência genérica: tudo do mesmo condomínio e da mesma organização
 * (unidade, bloco, conta, área, assembleia, item, ocorrência, comunicado,
 * orçamento, contrato, rateio, pessoas). Sem isso, a API aceitaria apontar
 * para registros de outro condomínio (ou de outra imobiliária).
 */
create or replace function privado.cond_conferir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  j jsonb := to_jsonb(new);
  v_cond uuid := nullif(j ->> 'condominio_id', '')::uuid;
  v_ref uuid;
  k text;
begin
  if tg_table_name = 'cond_condominios' then
    v_cond := new.id;
  elsif v_cond is null or not exists (select 1 from public.cond_condominios where id = v_cond and organizacao_id = new.organizacao_id) then
    raise exception 'Condomínio não encontrado.';
  end if;
  if tg_op = 'UPDATE' and tg_table_name <> 'cond_condominios' and (to_jsonb(old) ->> 'condominio_id') is distinct from (j ->> 'condominio_id') then
    raise exception 'Não dá para mudar o condomínio de um registro.';
  end if;

  foreach k in array array['unidade_id','bloco_id','conta_id','conta_destino_id','area_id','assembleia_id','aprovacao_assembleia_id',
                           'item_id','ocorrencia_id','comunicado_id','orcamento_id','contrato_id','rateio_id'] loop
    v_ref := nullif(j ->> k, '')::uuid;
    continue when v_ref is null;
    if not exists (
      select 1 from (
        select id, condominio_id from public.cond_unidades where k = 'unidade_id' and id = v_ref
        union all select id, condominio_id from public.cond_blocos where k = 'bloco_id' and id = v_ref
        union all select id, condominio_id from public.cond_contas where k in ('conta_id','conta_destino_id') and id = v_ref
        union all select id, condominio_id from public.cond_areas where k = 'area_id' and id = v_ref
        union all select id, condominio_id from public.cond_assembleias where k in ('assembleia_id','aprovacao_assembleia_id') and id = v_ref
        union all select id, condominio_id from public.cond_assembleia_itens where k = 'item_id' and id = v_ref
        union all select id, condominio_id from public.cond_ocorrencias where k = 'ocorrencia_id' and id = v_ref
        union all select id, condominio_id from public.cond_comunicados where k = 'comunicado_id' and id = v_ref
        union all select id, condominio_id from public.cond_orcamentos where k = 'orcamento_id' and id = v_ref
        union all select id, condominio_id from public.cond_contratos_fornecedores where k = 'contrato_id' and id = v_ref
        union all select id, condominio_id from public.cond_rateios where k = 'rateio_id' and id = v_ref
      ) x where x.condominio_id = v_cond
    ) then
      raise exception 'Registro ligado (%) não é deste condomínio.', replace(k, '_id', '');
    end if;
  end loop;

  foreach k in array array['pessoa_id','fornecedor_id','sindico_id'] loop
    v_ref := nullif(j ->> k, '')::uuid;
    continue when v_ref is null;
    if not exists (select 1 from public.pessoas where id = v_ref and organizacao_id = new.organizacao_id) then
      raise exception 'Pessoa não encontrada.';
    end if;
  end loop;
  return new;
end;
$$;

do $$
declare
  t text;
begin
  foreach t in array array['cond_condominios','cond_blocos','cond_unidades','cond_pessoas_unidade','cond_contas','cond_contratos_fornecedores',
                           'cond_assembleias','cond_assembleia_itens','cond_assembleia_presencas','cond_votos','cond_rateios','cond_orcamentos',
                           'cond_orcamento_itens','cond_consumos','cond_areas','cond_reservas','cond_acordos','cond_cotas','cond_cota_pagamentos',
                           'cond_lancamentos','cond_fechamentos','cond_ocorrencias','cond_ocorrencia_respostas','cond_comunicados',
                           'cond_comunicado_leituras','cond_documentos','cond_taxas_admin','cond_portal_acessos'] loop
    execute format('create or replace trigger %I before insert or update on public.%I for each row execute function privado.cond_conferir()',
                   t || '_00_conferir_trg', t);
  end loop;
end $$;

/** Condomínio: responsável da equipe precisa ser membro; ao criar, já nascem a conta corrente e o fundo de reserva. */
create or replace function privado.cond_condominios_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(new.nome), '') = '' then raise exception 'Informe o nome do condomínio.'; end if;
  new.nome := left(btrim(new.nome), 160);
  if new.responsavel_user_id is not null
     and not exists (select 1 from public.membros where organizacao_id = new.organizacao_id and user_id = new.responsavel_user_id) then
    raise exception 'O responsável precisa ser alguém da equipe.';
  end if;
  new.pix_chave := nullif(btrim(new.pix_chave), '');
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger cond_condominios_antes_trg before insert or update on public.cond_condominios
  for each row execute function privado.cond_condominios_antes();

/**
 * Excluir condomínio com história (cota recebida, lançamento pago, mês fechado
 * ou assembleia encerrada) apagaria o livro-caixa e as atas em cascata: o banco
 * recusa (a tela oferece desativar). Só a exclusão da organização inteira leva tudo.
 */
create or replace function privado.cond_condominios_excluir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.organizacoes where id = old.organizacao_id) then
    return old;
  end if;
  if exists (select 1 from public.cond_cota_pagamentos where condominio_id = old.id and estornado_em is null)
     or exists (select 1 from public.cond_lancamentos where condominio_id = old.id and status = 'pago')
     or exists (select 1 from public.cond_fechamentos where condominio_id = old.id)
     or exists (select 1 from public.cond_assembleias where condominio_id = old.id and status = 'encerrada') then
    raise exception 'Este condomínio já tem histórico (cotas recebidas, lançamentos pagos, mês fechado ou assembleia encerrada): desative em vez de excluir — a prestação de contas precisa ficar.';
  end if;
  return old;
end;
$$;
create or replace trigger cond_condominios_excluir_trg before delete on public.cond_condominios
  for each row execute function privado.cond_condominios_excluir();

create or replace function privado.cond_condominios_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.cond_contas (organizacao_id, condominio_id, nome, tipo)
  values (new.organizacao_id, new.id, 'Conta corrente', 'corrente'), (new.organizacao_id, new.id, 'Fundo de reserva', 'reserva');
  return new;
end;
$$;
create or replace trigger cond_condominios_depois_trg after insert on public.cond_condominios
  for each row execute function privado.cond_condominios_depois();

create or replace function privado.cond_unidades_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.numero := left(btrim(new.numero), 40);
  if new.numero = '' then raise exception 'Informe o número da unidade.'; end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger cond_unidades_antes_trg before insert or update on public.cond_unidades
  for each row execute function privado.cond_unidades_antes();

/**
 * Excluir unidade levaria junto, em cascata, as cotas (e o que já foi
 * recebido) e os votos/presenças de assembleias encerradas: o banco recusa.
 * Só a exclusão do condomínio (ou da organização) leva tudo.
 */
create or replace function privado.cond_unidades_excluir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if privado.cond_em_exclusao(old.organizacao_id, old.condominio_id) then return old; end if;
  if exists (select 1 from public.cond_cotas where unidade_id = old.id) then
    raise exception 'Esta unidade já tem cotas: não dá para excluir (o histórico financeiro precisa ficar).';
  end if;
  if exists (select 1 from public.cond_votos v join public.cond_assembleias a on a.id = v.assembleia_id
              where v.unidade_id = old.id and a.status = 'encerrada')
     or exists (select 1 from public.cond_assembleia_presencas p join public.cond_assembleias a on a.id = p.assembleia_id
                 where p.unidade_id = old.id and a.status = 'encerrada') then
    raise exception 'Esta unidade votou ou esteve presente em assembleia encerrada: não dá para excluir (a ata precisa ficar).';
  end if;
  return old;
end;
$$;
create or replace trigger cond_unidades_excluir_trg before delete on public.cond_unidades
  for each row execute function privado.cond_unidades_excluir();

/** Contrato com fornecedor: o arquivo do contrato fica na pasta do condomínio (bucket privado). */
create or replace function privado.cond_contratos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.documento_path := nullif(btrim(new.documento_path), '');
  if new.documento_path is not null
     and (left(new.documento_path, 74) <> new.organizacao_id::text || '/' || new.condominio_id::text || '/'
          or new.documento_path like '%..%' or length(new.documento_path) > 400) then
    raise exception 'Arquivo do contrato fora da pasta do condomínio.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger cond_contratos_antes_trg before insert or update on public.cond_contratos_fornecedores
  for each row execute function privado.cond_contratos_antes();

/** Vínculos: condômino/inquilino/morador precisam de unidade; o síndico em vigor fica no cadastro do condomínio. */
create or replace function privado.cond_pessoas_unidade_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.papel in ('proprietario','inquilino','morador') and new.unidade_id is null then
    raise exception 'Escolha a unidade.';
  end if;
  if new.responsavel_financeiro and new.papel not in ('proprietario','inquilino','morador') then
    raise exception 'Responsável financeiro só para condômino, inquilino ou morador.';
  end if;
  return new;
end;
$$;
create or replace trigger cond_pessoas_unidade_antes_trg before insert or update on public.cond_pessoas_unidade
  for each row execute function privado.cond_pessoas_unidade_antes();

/**
 * Síndico do cadastro = vínculo "síndico" em vigor (sem fim). Ligar um novo
 * síndico grava ele; encerrar (ou excluir) o vínculo de quem está no cadastro
 * põe o síndico em vigor mais recente, ou deixa vazio. Encerrar o mandato do
 * antigo DEPOIS de ligar o novo não traz o antigo de volta.
 */
create or replace function privado.cond_pessoas_unidade_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_cond uuid := coalesce(new.condominio_id, old.condominio_id);
begin
  if tg_op <> 'DELETE' and new.papel = 'sindico' and new.fim is null then
    update public.cond_condominios set sindico_id = new.pessoa_id where id = new.condominio_id and sindico_id is distinct from new.pessoa_id;
  elsif (tg_op <> 'INSERT' and old.papel = 'sindico') or (tg_op <> 'DELETE' and new.papel = 'sindico') then
    -- Quem está no cadastro não tem mais mandato em vigor: fica o síndico em vigor mais recente (ou ninguém).
    update public.cond_condominios c
       set sindico_id = (select pu.pessoa_id from public.cond_pessoas_unidade pu
                          where pu.condominio_id = c.id and pu.papel = 'sindico' and pu.fim is null
                          order by pu.inicio desc, pu.created_at desc limit 1)
     where c.id = v_cond and c.sindico_id is not null
       and not exists (select 1 from public.cond_pessoas_unidade pu
                        where pu.condominio_id = c.id and pu.papel = 'sindico' and pu.fim is null and pu.pessoa_id = c.sindico_id);
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
create or replace trigger cond_pessoas_unidade_depois_trg after insert or update or delete on public.cond_pessoas_unidade
  for each row execute function privado.cond_pessoas_unidade_depois();

/**
 * Lançamentos do livro-caixa:
 * - mês fechado: nada pago naquele mês entra, muda ou sai (reabrir só o administrador);
 * - recebimento de cota: só pela RPC de pagamento (e sai só pelo estorno);
 * - saída do fundo de reserva: só com aprovação registrada (assembleia ou quem aprovou) e por administrador/gestor.
 */
create or replace function privado.cond_lancamentos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_sistema boolean := coalesce(current_setting('cond.sistema', true), '') = 'sim';
  v_tipo_conta text;
  v_tipo_destino text;
begin
  -- "Juntar repetidos" só troca o fornecedor (pessoa): não é mexer no livro-caixa.
  if tg_op = 'UPDATE' and coalesce(current_setting('cond.juntando', true), '') = 'sim' then
    return new;
  end if;
  -- Cadastro ligado excluído (pessoa fornecedora, contrato, rateio ou assembleia): o banco só apaga a
  -- ligação ("on delete set null"). Valor, conta, datas e situação não mudam: vale mesmo em mês fechado.
  if tg_op = 'UPDATE'
     and (new.fornecedor_id, new.contrato_id, new.rateio_id, new.aprovacao_assembleia_id)
         is distinct from (old.fornecedor_id, old.contrato_id, old.rateio_id, old.aprovacao_assembleia_id)
     and (to_jsonb(new) - array['fornecedor_id','contrato_id','rateio_id','aprovacao_assembleia_id','updated_at'])
         = (to_jsonb(old) - array['fornecedor_id','contrato_id','rateio_id','aprovacao_assembleia_id','updated_at'])
     and (new.fornecedor_id is not distinct from old.fornecedor_id
          or (new.fornecedor_id is null and not exists (select 1 from public.pessoas where id = old.fornecedor_id)))
     and (new.contrato_id is not distinct from old.contrato_id
          or (new.contrato_id is null and not exists (select 1 from public.cond_contratos_fornecedores where id = old.contrato_id)))
     and (new.rateio_id is not distinct from old.rateio_id
          or (new.rateio_id is null and not exists (select 1 from public.cond_rateios where id = old.rateio_id)))
     and (new.aprovacao_assembleia_id is not distinct from old.aprovacao_assembleia_id
          or (new.aprovacao_assembleia_id is null and not exists (select 1 from public.cond_assembleias where id = old.aprovacao_assembleia_id))) then
    return new;
  end if;
  if tg_op in ('UPDATE','DELETE') and privado.cond_em_exclusao(old.organizacao_id, old.condominio_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('UPDATE','DELETE') then
    if old.cota_pagamento_id is not null and not v_sistema then
      raise exception 'Este lançamento veio do recebimento de uma cota: para desfazer, estorne o recebimento na aba Cotas.';
    end if;
    if old.status = 'pago' and privado.cond_mes_fechado(old.condominio_id, old.pago_em) then
      raise exception 'O mês %/% está fechado: peça ao administrador para reabrir antes de mexer.',
        lpad(extract(month from old.pago_em)::text, 2, '0'), extract(year from old.pago_em);
    end if;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  if new.cota_pagamento_id is not null and not v_sistema
     and (tg_op = 'INSERT' or new.cota_pagamento_id is distinct from old.cota_pagamento_id) then
    raise exception 'Recebimento de cota só pelo botão "Receber" da cota.';
  end if;
  if coalesce(btrim(new.descricao), '') = '' then raise exception 'Informe a descrição.'; end if;
  new.descricao := left(btrim(new.descricao), 300);
  new.categoria := left(coalesce(nullif(btrim(new.categoria), ''), 'Outros'), 80);
  new.competencia := date_trunc('month', coalesce(new.competencia, new.vencimento, new.pago_em, privado.cond_hoje()))::date;
  if new.status = 'pago' then
    new.pago_em := coalesce(new.pago_em, privado.cond_hoje());
  else
    new.pago_em := null;
  end if;
  if new.status = 'pago' and privado.cond_mes_fechado(new.condominio_id, new.pago_em) then
    raise exception 'O mês %/% está fechado: peça ao administrador para reabrir antes de lançar.',
      lpad(extract(month from new.pago_em)::text, 2, '0'), extract(year from new.pago_em);
  end if;

  if new.conta_id is null then
    new.conta_id := privado.cond_conta_padrao(new.condominio_id, 'corrente');
  end if;
  select tipo into v_tipo_conta from public.cond_contas where id = new.conta_id and condominio_id = new.condominio_id;
  if v_tipo_conta is null then raise exception 'Escolha a conta do condomínio.'; end if;
  if new.tipo = 'transferencia' then
    select tipo into v_tipo_destino from public.cond_contas where id = new.conta_destino_id and condominio_id = new.condominio_id;
    if v_tipo_destino is null or new.conta_destino_id = new.conta_id then
      raise exception 'Escolha a conta de destino (diferente da de origem).';
    end if;
  else
    new.conta_destino_id := null;
  end if;

  -- Saída do fundo de reserva ou de outro fundo (despesa ou transferência saindo da conta do fundo).
  -- O tipo da conta não muda depois de criada (gatilho de cond_contas): não dá para contornar.
  if v_tipo_conta in ('reserva','fundo') and new.tipo in ('despesa','transferencia') and new.status <> 'cancelado'
     and (tg_op = 'INSERT' or new.valor is distinct from old.valor or new.conta_id is distinct from old.conta_id
          or new.tipo is distinct from old.tipo or new.status is distinct from old.status) then
    if coalesce(btrim(new.aprovacao_texto), '') = '' and new.aprovacao_assembleia_id is null then
      raise exception 'Saída do fundo de reserva (ou de outro fundo) precisa de aprovação: informe a assembleia ou quem aprovou.';
    end if;
    if auth.uid() is not null and privado.papel_atual(new.organizacao_id) not in ('admin','gestor') then
      raise exception 'Só administradores e gestores registram saídas do fundo de reserva (e dos outros fundos).';
    end if;
    new.aprovado_por := coalesce(auth.uid(), new.aprovado_por);
    new.aprovado_em := now();
    perform privado.cond_evento(new.condominio_id, 'fundo_saida',
      'Saída do ' || case when v_tipo_conta = 'reserva' then 'fundo de reserva' else 'fundo' end || ': ' || new.descricao || ' — R$ ' || to_char(new.valor, 'FM999G999G990D00')
      || coalesce(' (aprovação: ' || nullif(btrim(new.aprovacao_texto), '') || ')', ''));
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger cond_lancamentos_antes_trg before insert or update or delete on public.cond_lancamentos
  for each row execute function privado.cond_lancamentos_antes();

/**
 * Contas do livro-caixa:
 * - o tipo (corrente, fundo de reserva, outro fundo) não muda depois de criada — a
 *   regra de saída do fundo depende dele (trocar o tipo seria um atalho para sacar sem aprovação);
 * - com mês fechado no condomínio, o saldo inicial não entra, não muda e não sai
 *   (mudaria saldos e balancetes já fechados): a diferença vira lançamento num mês aberto.
 */
create or replace function privado.cond_contas_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op in ('UPDATE','DELETE') and privado.cond_em_exclusao(old.organizacao_id, old.condominio_id) then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op = 'UPDATE' and new.tipo is distinct from old.tipo then
    raise exception 'O tipo da conta não muda depois de criada: crie uma conta nova com o tipo certo e transfira o saldo.';
  end if;
  if ((tg_op = 'INSERT' and new.saldo_inicial <> 0)
      or (tg_op = 'UPDATE' and new.saldo_inicial is distinct from old.saldo_inicial)
      or (tg_op = 'DELETE' and old.saldo_inicial <> 0))
     and exists (select 1 from public.cond_fechamentos f
                  where f.condominio_id = coalesce(new.condominio_id, old.condominio_id) and f.status = 'fechado') then
    raise exception 'Este condomínio tem mês fechado: o saldo inicial não muda mais (mudaria os balancetes fechados). Lance a diferença como receita, despesa ou transferência num mês aberto.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.nome := left(btrim(new.nome), 80);
  if new.nome = '' then raise exception 'Informe o nome da conta.'; end if;
  return new;
end;
$$;
create or replace trigger cond_contas_antes_trg before insert or update or delete on public.cond_contas
  for each row execute function privado.cond_contas_antes();

/** Reserva: área do condomínio e sem conflito de horário (a área fica travada enquanto confere). */
create or replace function privado.cond_reservas_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  ar public.cond_areas%rowtype;
begin
  if new.fim <= new.inicio then raise exception 'O fim da reserva precisa ser depois do início.'; end if;
  select * into ar from public.cond_areas where id = new.area_id and condominio_id = new.condominio_id for update;
  if not found then raise exception 'Área não encontrada.'; end if;
  if tg_op = 'INSERT' then
    if not ar.ativa then raise exception 'Esta área não está disponível para reservas.'; end if;
    new.taxa := coalesce(new.taxa, ar.taxa);
  elsif old.cota_item_id is not null and (new.taxa is distinct from old.taxa or new.unidade_id is distinct from old.unidade_id) then
    raise exception 'A taxa desta reserva já foi cobrada na cota.';
  end if;
  if new.status in ('pedida','confirmada') and exists (
       select 1 from public.cond_reservas r
        where r.area_id = new.area_id and r.id <> new.id and r.status in ('pedida','confirmada')
          and tstzrange(r.inicio, r.fim) && tstzrange(new.inicio, new.fim)) then
    raise exception 'Já existe reserva de % nesse horário.', ar.nome;
  end if;
  if tg_op = 'UPDATE' and new.status is distinct from old.status and new.status in ('confirmada','recusada') then
    new.decidido_por := coalesce(auth.uid(), new.decidido_por);
    new.decidido_em := now();
  end if;
  new.observacao := left(nullif(btrim(new.observacao), ''), 500);
  new.resposta := left(nullif(btrim(new.resposta), ''), 500);
  return new;
end;
$$;
create or replace trigger cond_reservas_antes_trg before insert or update on public.cond_reservas
  for each row execute function privado.cond_reservas_antes();

/** Ocorrência: resolvida/cancelada guarda a data. */
create or replace function privado.cond_ocorrencias_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(new.titulo), '') = '' then raise exception 'Informe o assunto.'; end if;
  new.titulo := left(btrim(new.titulo), 160);
  new.descricao := left(new.descricao, 4000);
  if new.status in ('resolvida','cancelada') then
    new.resolvida_em := coalesce(new.resolvida_em, now());
  else
    new.resolvida_em := null;
  end if;
  if new.responsavel_user_id is not null
     and not exists (select 1 from public.membros where organizacao_id = new.organizacao_id and user_id = new.responsavel_user_id) then
    raise exception 'O responsável precisa ser alguém da equipe.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger cond_ocorrencias_antes_trg before insert or update on public.cond_ocorrencias
  for each row execute function privado.cond_ocorrencias_antes();

/** Resposta: autor e data são do banco (equipe logada ou morador pelo portal); a equipe respondendo põe a ocorrência em andamento. */
create or replace function privado.cond_respostas_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(btrim(new.texto), '') = '' then raise exception 'Escreva a resposta.'; end if;
  new.texto := left(btrim(new.texto), 2000);
  new.created_at := now();
  if auth.uid() is not null then
    new.autor := 'equipe';
    new.usuario_id := auth.uid();
    new.pessoa_id := null;
  else
    new.autor := 'morador';
    new.usuario_id := null;
  end if;
  return new;
end;
$$;
create or replace trigger cond_respostas_antes_trg before insert on public.cond_ocorrencia_respostas
  for each row execute function privado.cond_respostas_antes();

create or replace function privado.cond_respostas_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.autor = 'equipe' then
    update public.cond_ocorrencias set status = 'em_andamento' where id = new.ocorrencia_id and status = 'aberta';
  elsif new.autor = 'morador' then
    update public.cond_ocorrencias set status = 'aberta' where id = new.ocorrencia_id and status = 'resolvida';
  end if;
  return new;
end;
$$;
create or replace trigger cond_respostas_depois_trg after insert on public.cond_ocorrencia_respostas
  for each row execute function privado.cond_respostas_depois();

/**
 * Assembleia: datas de convocação/encerramento e trava depois de encerrada —
 * encerrada não volta para nenhuma outra situação (o resultado e os votos ficam
 * como estão; só a ata pode ser ajustada) e não pode ser excluída (só junto
 * com o condomínio). Excluir uma assembleia com votos fica registrado.
 */
create or replace function privado.cond_assembleias_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_votos int;
begin
  if tg_op = 'DELETE' then
    if privado.cond_em_exclusao(old.organizacao_id, old.condominio_id) then return old; end if;
    if old.status = 'encerrada' then
      raise exception 'Assembleia encerrada fica no histórico do condomínio (é a ata e o resultado das votações): não pode ser excluída.';
    end if;
    select count(*) into v_votos from public.cond_votos where assembleia_id = old.id;
    if v_votos > 0 then
      perform privado.cond_evento(old.condominio_id, 'assembleia_excluida',
        'Assembleia "' || old.titulo || '" excluída com ' || v_votos || ' voto(s) registrado(s)');
    end if;
    return old;
  end if;
  if coalesce(btrim(new.titulo), '') = '' then raise exception 'Informe o título da assembleia.'; end if;
  new.link_online := nullif(btrim(new.link_online), '');
  if new.link_online is not null and new.link_online !~* '^https?://' then
    raise exception 'O link da reunião online precisa começar com https://';
  end if;
  if tg_op = 'UPDATE' and old.status = 'encerrada' and new.status is distinct from old.status then
    raise exception 'A assembleia já foi encerrada: ela não volta a ser aberta (o resultado das votações fica como está; só a ata pode ser ajustada).';
  end if;
  if tg_op = 'UPDATE' and old.status in ('encerrada','cancelada') and new.status = old.status
     and (new.data is distinct from old.data or new.voto_peso is distinct from old.voto_peso or new.tipo is distinct from old.tipo) then
    raise exception 'A assembleia já foi encerrada: só a ata pode mudar.';
  end if;
  if new.status = 'convocada' and new.convocada_em is null then new.convocada_em := now(); end if;
  if new.status = 'encerrada' and new.encerrada_em is null then new.encerrada_em := now(); end if;
  if new.status <> 'encerrada' then new.encerrada_em := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
create or replace trigger cond_assembleias_antes_trg before insert or update or delete on public.cond_assembleias
  for each row execute function privado.cond_assembleias_antes();

/** Pauta: não muda depois de encerrada (só o texto do resultado). */
create or replace function privado.cond_assembleia_itens_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' and (privado.cond_em_exclusao(old.organizacao_id, old.condominio_id)
                           or not exists (select 1 from public.cond_assembleias where id = old.assembleia_id)) then
    return old;
  end if;
  select status into v_status from public.cond_assembleias where id = coalesce(new.assembleia_id, old.assembleia_id);
  if v_status in ('encerrada','cancelada') and (tg_op <> 'UPDATE' or new.titulo is distinct from old.titulo
       or new.opcoes is distinct from old.opcoes or new.tipo_votacao is distinct from old.tipo_votacao) then
    raise exception 'A assembleia já foi encerrada: a pauta não muda mais.';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.cond_votos where item_id = old.id) then
      raise exception 'Este item já tem votos: desfaça os votos antes de tirar da pauta.';
    end if;
    return old;
  end if;
  if coalesce(btrim(new.titulo), '') = '' then raise exception 'Informe o item da pauta.'; end if;
  new.opcoes := array(select left(btrim(o), 60) from unnest(new.opcoes) o where btrim(o) <> '');
  if new.tipo_votacao <> 'informativo' and coalesce(array_length(new.opcoes, 1), 0) < 2 then
    raise exception 'A votação precisa de pelo menos duas opções.';
  end if;
  return new;
end;
$$;
create or replace trigger cond_assembleia_itens_antes_trg before insert or update or delete on public.cond_assembleia_itens
  for each row execute function privado.cond_assembleia_itens_antes();

/** Presença: só com a assembleia aberta (não encerrada nem cancelada). */
create or replace function privado.cond_presencas_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'UPDATE' and coalesce(current_setting('cond.juntando', true), '') = 'sim' then
    return new;
  end if;
  -- Pessoa excluída do cadastro ("on delete set null"): a presença fica, só sem a ligação.
  if tg_op = 'UPDATE' and new.pessoa_id is null and old.pessoa_id is not null
     and not exists (select 1 from public.pessoas where id = old.pessoa_id)
     and (to_jsonb(new) - 'pessoa_id') = (to_jsonb(old) - 'pessoa_id') then
    return new;
  end if;
  if tg_op = 'DELETE' and (privado.cond_em_exclusao(old.organizacao_id, old.condominio_id)
                           or not exists (select 1 from public.cond_assembleias where id = old.assembleia_id)) then
    return old;
  end if;
  select status into v_status from public.cond_assembleias where id = coalesce(new.assembleia_id, old.assembleia_id);
  if v_status in ('encerrada','cancelada') then
    raise exception 'A assembleia já foi encerrada: a lista de presença não muda mais.';
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.cond_votos v where v.assembleia_id = old.assembleia_id and v.unidade_id = old.unidade_id) then
      raise exception 'Esta unidade já votou: desfaça os votos antes de tirar a presença.';
    end if;
    return old;
  end if;
  new.nome := left(nullif(btrim(new.nome), ''), 160);
  new.procurador_nome := left(nullif(btrim(new.procurador_nome), ''), 160);
  if new.procuracao and new.procurador_nome is null then
    raise exception 'Informe o nome de quem representa a unidade (procurador).';
  end if;
  return new;
end;
$$;
create or replace trigger cond_presencas_antes_trg before insert or update or delete on public.cond_assembleia_presencas
  for each row execute function privado.cond_presencas_antes();

/** Votos de assembleia encerrada ficam como estão (nem em cascata saem, a não ser junto com o condomínio). */
create or replace function privado.cond_votos_excluir()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if privado.cond_em_exclusao(old.organizacao_id, old.condominio_id)
     or not exists (select 1 from public.cond_assembleias where id = old.assembleia_id) then
    return old;
  end if;
  if (select status from public.cond_assembleias where id = old.assembleia_id) = 'encerrada' then
    raise exception 'A assembleia já foi encerrada: os votos ficam como estão.';
  end if;
  return old;
end;
$$;
create or replace trigger cond_votos_excluir_trg before delete on public.cond_votos
  for each row execute function privado.cond_votos_excluir();

/** Documento: arquivo na pasta do condomínio; link do portal com no máximo 90 dias. */
create or replace function privado.cond_documentos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if left(new.path, 74) <> new.organizacao_id::text || '/' || new.condominio_id::text || '/' or new.path like '%..%' then
    raise exception 'Arquivo fora da pasta do condomínio.';
  end if;
  if coalesce(btrim(new.titulo), '') = '' then raise exception 'Dê um nome ao documento.'; end if;
  new.titulo := left(btrim(new.titulo), 160);
  if not new.publico_portal then
    new.link_portal := null;
    new.link_expira_em := null;
  end if;
  if new.link_portal is not null then
    if new.link_portal !~ '^https?://' then raise exception 'Link do documento inválido.'; end if;
    if new.link_expira_em is null or new.link_expira_em > now() + interval '91 days' then
      raise exception 'O documento pode ficar no portal por no máximo 90 dias de cada vez.';
    end if;
  end if;
  return new;
end;
$$;
create or replace trigger cond_documentos_antes_trg before insert or update on public.cond_documentos
  for each row execute function privado.cond_documentos_antes();

/** Orçamento aprovado guarda a data; itens só mudam enquanto for rascunho. */
create or replace function privado.cond_orcamentos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'aprovado' then
    new.aprovado_em := coalesce(new.aprovado_em, privado.cond_hoje());
  else
    new.aprovado_em := null;
  end if;
  return new;
end;
$$;
create or replace trigger cond_orcamentos_antes_trg before insert or update on public.cond_orcamentos
  for each row execute function privado.cond_orcamentos_antes();

create or replace function privado.cond_orcamento_itens_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
begin
  if tg_op = 'DELETE' and privado.cond_em_exclusao(old.organizacao_id, old.condominio_id) then
    return old;
  end if;
  select status into v_status from public.cond_orcamentos where id = coalesce(new.orcamento_id, old.orcamento_id);
  if v_status = 'aprovado' then
    raise exception 'O orçamento já foi aprovado: volte para rascunho antes de mudar os itens.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if coalesce(btrim(new.categoria), '') = '' then raise exception 'Informe a categoria.'; end if;
  new.categoria := left(btrim(new.categoria), 80);
  return new;
end;
$$;
create or replace trigger cond_orcamento_itens_antes_trg before insert or update or delete on public.cond_orcamento_itens
  for each row execute function privado.cond_orcamento_itens_antes();

/** Consumo já cobrado numa cota não muda (cancele a cota para refazer). */
create or replace function privado.cond_consumos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' and (privado.cond_em_exclusao(old.organizacao_id, old.condominio_id)
                           or not exists (select 1 from public.cond_unidades where id = old.unidade_id)) then
    return old;
  end if;
  if tg_op in ('UPDATE','DELETE') and old.cota_item_id is not null
     and coalesce(current_setting('cond.sistema', true), '') <> 'sim' then
    raise exception 'Este consumo já foi cobrado na cota do mês: cancele a cota para corrigir.';
  end if;
  if tg_op = 'DELETE' then return old; end if;
  new.competencia := date_trunc('month', new.competencia)::date;
  return new;
end;
$$;
create or replace trigger cond_consumos_antes_trg before insert or update or delete on public.cond_consumos
  for each row execute function privado.cond_consumos_antes();

create or replace function privado.cond_rateios_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.primeira_competencia := date_trunc('month', new.primeira_competencia)::date;
  if coalesce(btrim(new.descricao), '') = '' then raise exception 'Descreva o rateio.'; end if;
  return new;
end;
$$;
create or replace trigger cond_rateios_antes_trg before insert or update on public.cond_rateios
  for each row execute function privado.cond_rateios_antes();

-- -----------------------------------------------------------------------------
-- 5. RLS: leitura pela equipe; escrita só com o módulo em uso e o perfil de acesso
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
  t text;
begin
  for r in select * from (values
      ('cond_condominios','imoveis'), ('cond_blocos','imoveis'), ('cond_unidades','imoveis'), ('cond_pessoas_unidade','imoveis'),
      ('cond_assembleias','imoveis'), ('cond_assembleia_itens','imoveis'), ('cond_assembleia_presencas','imoveis'),
      ('cond_comunicados','imoveis'), ('cond_portal_acessos','imoveis'),
      ('cond_contas','financeiro'), ('cond_lancamentos','financeiro'), ('cond_orcamentos','financeiro'), ('cond_orcamento_itens','financeiro'),
      ('cond_rateios','financeiro'), ('cond_consumos','financeiro'), ('cond_contratos_fornecedores','financeiro'), ('cond_taxas_admin','financeiro'),
      ('cond_areas','agenda'), ('cond_reservas','agenda'),
      ('cond_ocorrencias','manutencao'),
      ('cond_documentos','documentos')
    ) v(tabela, modulo) loop
    execute format('alter table public.%I enable row level security', r.tabela);
    execute format('create index if not exists %I on public.%I (organizacao_id)', r.tabela || '_org_idx', r.tabela);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tabela and policyname = r.tabela || '_ler') then
      execute format($p$create policy %I on public.%I for select to authenticated
        using (organizacao_id in (select privado.org_ids()) and privado.cond_equipe(organizacao_id))$p$, r.tabela || '_ler', r.tabela);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tabela and policyname = r.tabela || '_criar') then
      execute format($p$create policy %I on public.%I for insert to authenticated
        with check (organizacao_id in (select privado.org_ids()) and privado.cond_pode(organizacao_id, %L, 'criar'))$p$, r.tabela || '_criar', r.tabela, r.modulo);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tabela and policyname = r.tabela || '_editar') then
      execute format($p$create policy %I on public.%I for update to authenticated
        using (organizacao_id in (select privado.org_ids()) and privado.cond_equipe(organizacao_id))
        with check (organizacao_id in (select privado.org_ids()) and privado.cond_pode(organizacao_id, %L, 'editar'))$p$, r.tabela || '_editar', r.tabela, r.modulo);
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = r.tabela and policyname = r.tabela || '_excluir') then
      execute format($p$create policy %I on public.%I for delete to authenticated
        using (organizacao_id in (select privado.org_ids()) and privado.cond_pode(organizacao_id, %L, 'excluir'))$p$, r.tabela || '_excluir', r.tabela, r.modulo);
    end if;
  end loop;

  -- Respostas das ocorrências: histórico (lê e acrescenta; não muda nem apaga).
  alter table public.cond_ocorrencia_respostas enable row level security;
  create index if not exists cond_ocorrencia_respostas_org_idx on public.cond_ocorrencia_respostas (organizacao_id);
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cond_ocorrencia_respostas' and policyname = 'cond_ocorrencia_respostas_ler') then
    create policy cond_ocorrencia_respostas_ler on public.cond_ocorrencia_respostas for select to authenticated
      using (organizacao_id in (select privado.org_ids()) and privado.cond_equipe(organizacao_id));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'cond_ocorrencia_respostas' and policyname = 'cond_ocorrencia_respostas_criar') then
    create policy cond_ocorrencia_respostas_criar on public.cond_ocorrencia_respostas for insert to authenticated
      with check (organizacao_id in (select privado.org_ids()) and privado.cond_pode(organizacao_id, 'manutencao', 'editar'));
  end if;

  -- Só leitura: gravados pelas funções do banco (cotas, baixas, acordos, fechamentos, votos, leituras, registros).
  foreach t in array array['cond_cotas','cond_cota_itens','cond_cota_pagamentos','cond_acordos','cond_fechamentos','cond_votos',
                           'cond_comunicado_leituras','cond_portal_eventos','cond_eventos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
    if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = t and policyname = t || '_ler') then
      execute format($p$create policy %I on public.%I for select to authenticated
        using (organizacao_id in (select privado.org_ids()) and privado.cond_equipe(organizacao_id))$p$, t || '_ler', t);
    end if;
  end loop;

  -- Sessões e pastas de envio do portal: nenhuma policy (só as funções do banco usam).
  foreach t in array array['cond_portal_sessoes','cond_portal_envios'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create index if not exists %I on public.%I (organizacao_id)', t || '_org_idx', t);
  end loop;
end $$;

-- Histórico de ações (auditoria) nas tabelas principais (não nas de evento/alto volume).
do $$
declare
  t text;
begin
  foreach t in array array['cond_condominios','cond_blocos','cond_unidades','cond_pessoas_unidade','cond_contas','cond_lancamentos',
                           'cond_orcamentos','cond_rateios','cond_contratos_fornecedores','cond_assembleias','cond_areas',
                           'cond_documentos','cond_portal_acessos','cond_fechamentos','cond_acordos','cond_taxas_admin'] loop
    execute format('create or replace trigger %I after insert or update or delete on public.%I
      for each row execute function privado.auditar()', t || '_auditoria_trg', t);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Frações ideais, cotas, baixa, acordos e inadimplência
-- -----------------------------------------------------------------------------

/**
 * Confere as frações ideais: a soma por condomínio deve fechar 1 (ou 100%).
 * Tolerância de meio milionésimo por unidade (arredondamento das 6 casas).
 * Mesma conta de conferirFracoes().
 */
create or replace function public.cond_conferir_fracoes(p_condominio uuid)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_n int;
  v_sem int;
  v_soma numeric;
  v_tol numeric;
  v_escala text;
  v_alvo numeric;
begin
  select count(*), count(*) filter (where coalesce(fracao_ideal, 0) = 0), coalesce(sum(fracao_ideal), 0)
    into v_n, v_sem, v_soma
    from public.cond_unidades where condominio_id = p_condominio;
  v_tol := greatest(0.000001, v_n * 0.0000005);
  if abs(v_soma - 1) <= v_tol then
    v_escala := 'unitaria'; v_alvo := 1;
  elsif abs(v_soma - 100) <= v_tol * 100 then
    v_escala := 'percentual'; v_alvo := 100;
  else
    v_escala := null; v_alvo := case when v_soma > 2 then 100 else 1 end;
  end if;
  return jsonb_build_object('unidades', v_n, 'sem_fracao', v_sem, 'soma', v_soma, 'escala', v_escala,
                            'ok', v_n > 0 and v_sem = 0 and v_escala is not null, 'diferenca', v_alvo - v_soma);
end;
$$;
revoke execute on function public.cond_conferir_fracoes(uuid) from public, anon;
grant execute on function public.cond_conferir_fracoes(uuid) to authenticated;

/** Quanto vale a base da cota no mês: orçamento aprovado do ano (despesas − outras receitas, por mês). */
create or replace function privado.cond_base_orcamento(p_condominio uuid, p_ano int)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select sum(case when i.tipo = 'despesa' then i.valor_mensal else -i.valor_mensal end)
    from public.cond_orcamento_itens i join public.cond_orcamentos o on o.id = i.orcamento_id
   where o.condominio_id = p_condominio and o.ano = p_ano and o.status = 'aprovado'
$$;
revoke execute on function privado.cond_base_orcamento(uuid, int) from public, anon;
grant execute on function privado.cond_base_orcamento(uuid, int) to authenticated;

/**
 * Gera as cotas do mês (uma por unidade; quem já tem cota do mês fica como
 * está). Cada cota = parte da base pelo critério (fração/igual/área) + fundo
 * de reserva (% sobre a parte ordinária) + parcela dos rateios extras + consumo
 * individual do mês + taxas de reservas de áreas comuns de meses anteriores.
 * Divisão em centavos sem perder centavo. Mesma conta de calcularCotas().
 */
create or replace function public.cond_gerar_cotas(p_condominio uuid, p_competencia date, p_valor_base numeric default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cond_condominios%rowtype;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_venc date;
  v_base bigint;
  v_ids uuid[];
  v_pesos numeric[];
  v_partes bigint[];
  v_n int;
  v_corrente uuid;
  v_reserva uuid;
  v_rateios jsonb := '[]'::jsonb;
  r record;
  v_k int;
  v_parcela bigint;
  v_rpesos numeric[];
  v_cota uuid;
  v_item uuid;
  v_fundo bigint;
  v_criadas int := 0;
  v_existentes int := 0;
  v_total bigint := 0;
  v_rat jsonb;
  i int;
begin
  select * into c from public.cond_condominios where id = p_condominio;
  if not found then raise exception 'Condomínio não encontrado.'; end if;
  perform privado.cond_exigir(c.organizacao_id, 'financeiro', 'criar');
  if p_competencia is null then raise exception 'Informe o mês.'; end if;
  if privado.cond_mes_fechado(c.id, v_comp) then
    raise exception 'O mês %/% está fechado.', lpad(extract(month from v_comp)::text, 2, '0'), extract(year from v_comp);
  end if;
  v_venc := privado.cond_dia_no_mes(v_comp, c.dia_vencimento);

  if p_valor_base is not null then
    v_base := round(p_valor_base * 100);
  else
    v_base := round(coalesce(privado.cond_base_orcamento(c.id, extract(year from v_comp)::int), 0) * 100);
  end if;
  if coalesce(v_base, 0) <= 0 then
    raise exception 'Sem orçamento aprovado para %: aprove o orçamento do ano ou informe o total das despesas do mês.', extract(year from v_comp);
  end if;

  select array_agg(u.id order by u.id), array_agg(privado.cond_peso(c.criterio_rateio, u.fracao_ideal, u.area_privativa) order by u.id)
    into v_ids, v_pesos
    from public.cond_unidades u where u.condominio_id = c.id;
  v_n := coalesce(array_length(v_ids, 1), 0);
  if v_n = 0 then raise exception 'Cadastre as unidades antes de gerar as cotas.'; end if;
  if exists (select 1 from unnest(v_pesos) p where p <= 0) then
    raise exception '%', case c.criterio_rateio when 'area' then 'Há unidades sem área privativa: complete o cadastro (o rateio é por área).'
                                               else 'Há unidades sem fração ideal: complete o cadastro (o rateio é pela fração ideal).' end;
  end if;
  v_partes := privado.cond_ratear(v_base, v_pesos);

  v_corrente := privado.cond_conta_padrao(c.id, 'corrente');
  v_reserva := privado.cond_conta_padrao(c.id, 'reserva');
  if v_corrente is null then raise exception 'Crie a conta corrente do condomínio (aba Financeiro).'; end if;
  if c.fundo_reserva_pct > 0 and v_reserva is null then
    raise exception 'Crie a conta do fundo de reserva (aba Financeiro) antes de gerar as cotas.';
  end if;

  -- Rateios extras com parcela neste mês: valor da parcela dividido entre as unidades pelo critério do rateio.
  for r in select * from public.cond_rateios where condominio_id = c.id and ativo order by created_at, id loop
    v_k := ((extract(year from v_comp) - extract(year from r.primeira_competencia)) * 12
            + extract(month from v_comp) - extract(month from r.primeira_competencia))::int + 1;
    continue when v_k < 1 or v_k > r.parcelas;
    v_parcela := (privado.cond_ratear(round(r.valor_total * 100)::bigint, array_fill(1::numeric, array[r.parcelas])))[v_k];
    select array_agg(privado.cond_peso(r.criterio, u.fracao_ideal, u.area_privativa) order by u.id) into v_rpesos
      from public.cond_unidades u where u.condominio_id = c.id;
    if exists (select 1 from unnest(v_rpesos) p where p <= 0) then
      raise exception 'O rateio "%" divide por % e há unidades sem esse dado.', r.descricao, case r.criterio when 'area' then 'área' else 'fração ideal' end;
    end if;
    v_rateios := v_rateios || jsonb_build_object(
      'id', r.id, 'conta', coalesce(r.conta_id, case when r.tipo = 'fundo_reserva' then v_reserva end, v_corrente),
      'descricao', r.descricao || case when r.parcelas > 1 then ' (parcela ' || v_k || '/' || r.parcelas || ')' else '' end,
      'partes', to_jsonb(privado.cond_ratear(v_parcela, v_rpesos)));
  end loop;

  for i in 1 .. v_n loop
    if exists (select 1 from public.cond_cotas q where q.unidade_id = v_ids[i] and q.competencia = v_comp and q.tipo = 'ordinaria' and q.status <> 'cancelada') then
      v_existentes := v_existentes + 1;
      continue;
    end if;
    insert into public.cond_cotas (organizacao_id, condominio_id, unidade_id, tipo, competencia, vencimento, valor)
    values (c.organizacao_id, c.id, v_ids[i], 'ordinaria', v_comp, v_venc, 0) returning id into v_cota;

    insert into public.cond_cota_itens (organizacao_id, condominio_id, cota_id, tipo, descricao, valor, conta_id)
    values (c.organizacao_id, c.id, v_cota, 'ordinaria', 'Cota condominial ' || to_char(v_comp, 'MM/YYYY'), v_partes[i] / 100.0, v_corrente);

    v_fundo := round(v_partes[i] * c.fundo_reserva_pct / 100);
    if v_fundo > 0 then
      insert into public.cond_cota_itens (organizacao_id, condominio_id, cota_id, tipo, descricao, valor, conta_id)
      values (c.organizacao_id, c.id, v_cota, 'fundo_reserva', 'Fundo de reserva (' || replace(trim_scale(c.fundo_reserva_pct)::text, '.', ',') || '%)', v_fundo / 100.0, v_reserva);
    end if;

    for v_rat in select * from jsonb_array_elements(v_rateios) loop
      if (v_rat -> 'partes' ->> (i - 1))::bigint > 0 then
        insert into public.cond_cota_itens (organizacao_id, condominio_id, cota_id, tipo, descricao, valor, conta_id, rateio_id)
        values (c.organizacao_id, c.id, v_cota, 'rateio_extra', v_rat ->> 'descricao', (v_rat -> 'partes' ->> (i - 1))::bigint / 100.0,
                (v_rat ->> 'conta')::uuid, (v_rat ->> 'id')::uuid);
      end if;
    end loop;

    perform set_config('cond.sistema', 'sim', true);
    for r in select * from public.cond_consumos where unidade_id = v_ids[i] and competencia = v_comp and cota_item_id is null and valor > 0 order by tipo loop
      insert into public.cond_cota_itens (organizacao_id, condominio_id, cota_id, tipo, descricao, valor, conta_id, consumo_id)
      values (c.organizacao_id, c.id, v_cota, 'consumo',
              'Consumo de ' || case r.tipo when 'agua' then 'água' when 'gas' then 'gás' when 'energia' then 'energia' else 'outros' end,
              r.valor, v_corrente, r.id) returning id into v_item;
      update public.cond_consumos set cota_item_id = v_item where id = r.id;
    end loop;
    for r in select rs.*, a.nome as area_nome from public.cond_reservas rs join public.cond_areas a on a.id = rs.area_id
              where rs.unidade_id = v_ids[i] and rs.status = 'confirmada' and coalesce(rs.taxa, 0) > 0 and rs.cota_item_id is null
                and (rs.inicio at time zone 'America/Sao_Paulo')::date < v_comp order by rs.inicio loop
      insert into public.cond_cota_itens (organizacao_id, condominio_id, cota_id, tipo, descricao, valor, conta_id, reserva_id)
      values (c.organizacao_id, c.id, v_cota, 'reserva_area',
              'Reserva: ' || r.area_nome || ' em ' || to_char(r.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY'), r.taxa, v_corrente, r.id)
      returning id into v_item;
      update public.cond_reservas set cota_item_id = v_item where id = r.id;
    end loop;
    perform set_config('cond.sistema', '', true);

    update public.cond_cotas set valor = (select coalesce(sum(valor), 0) from public.cond_cota_itens where cota_id = v_cota)
     where id = v_cota;
    v_total := v_total + (select round(valor * 100) from public.cond_cotas where id = v_cota);
    v_criadas := v_criadas + 1;
  end loop;

  if v_criadas > 0 then
    perform privado.cond_evento(c.id, 'cotas', v_criadas || ' cota(s) de ' || to_char(v_comp, 'MM/YYYY') || ' geradas — R$ '
      || to_char(v_total / 100.0, 'FM999G999G990D00'));
  end if;
  return jsonb_build_object('criadas', v_criadas, 'existentes', v_existentes, 'total', v_total / 100.0,
                            'competencia', v_comp, 'vencimento', v_venc);
end;
$$;
revoke execute on function public.cond_gerar_cotas(uuid, date, numeric) from public, anon;
grant execute on function public.cond_gerar_cotas(uuid, date, numeric) to authenticated;

/** Cota avulsa (ex.: multa por infração ao regimento, segunda via de chave…). */
create or replace function public.cond_cota_avulsa(p_unidade uuid, p_vencimento date, p_descricao text, p_valor numeric)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.cond_unidades%rowtype;
  v_cota uuid;
begin
  select * into u from public.cond_unidades where id = p_unidade;
  if not found then raise exception 'Unidade não encontrada.'; end if;
  perform privado.cond_exigir(u.organizacao_id, 'financeiro', 'criar');
  if coalesce(p_valor, 0) <= 0 then raise exception 'Informe o valor.'; end if;
  if coalesce(btrim(p_descricao), '') = '' then raise exception 'Descreva a cobrança.'; end if;
  if p_vencimento is null then raise exception 'Informe o vencimento.'; end if;
  insert into public.cond_cotas (organizacao_id, condominio_id, unidade_id, tipo, competencia, vencimento, valor)
  values (u.organizacao_id, u.condominio_id, u.id, 'avulsa', date_trunc('month', p_vencimento)::date, p_vencimento, round(p_valor, 2))
  returning id into v_cota;
  insert into public.cond_cota_itens (organizacao_id, condominio_id, cota_id, tipo, descricao, valor, conta_id)
  values (u.organizacao_id, u.condominio_id, v_cota, 'outro', left(btrim(p_descricao), 200), round(p_valor, 2),
          privado.cond_conta_padrao(u.condominio_id, 'corrente'));
  return v_cota;
end;
$$;
revoke execute on function public.cond_cota_avulsa(uuid, date, text, numeric) from public, anon;
grant execute on function public.cond_cota_avulsa(uuid, date, text, numeric) to authenticated;

/** Recalcula saldo e situação da cota pelos recebimentos (os estornados não contam) e fecha o acordo quitado. */
create or replace function privado.cond_recalcular_cota(p_cota uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.cond_cotas%rowtype;
begin
  update public.cond_cotas x
     set valor_abatido = s.abatido,
         status = case when x.status in ('cancelada','renegociada') then x.status when s.abatido >= x.valor then 'paga' else 'aberta' end,
         pago_em = case when x.status in ('cancelada','renegociada') then x.pago_em when s.abatido >= x.valor then s.ultima end
    from (select coalesce(sum(principal + desconto), 0) as abatido, max(data) as ultima
            from public.cond_cota_pagamentos where cota_id = p_cota and estornado_em is null) s
   where x.id = p_cota
  returning x.* into q;
  if q.acordo_parcela_de is not null then
    update public.cond_acordos a
       set status = case when not exists (select 1 from public.cond_cotas p where p.acordo_parcela_de = a.id and p.status = 'aberta')
                         then 'quitado' else 'ativo' end
     where a.id = q.acordo_parcela_de and a.status in ('ativo','quitado');
  end if;
end;
$$;
revoke execute on function privado.cond_recalcular_cota(uuid) from public, anon, authenticated;

/**
 * Baixa de cota (inteira ou parcial; multa e juros separados). Lança a receita
 * no livro-caixa: o principal é dividido pelos itens da cota — a parte de fundo
 * de reserva (ou de outro fundo) vai para a conta do fundo; o resto, e a multa e
 * os juros, para a conta corrente onde o dinheiro entrou (a escolhida na baixa).
 */
create or replace function public.cond_registrar_pagamento(p_cota uuid, p_data date, p_valor numeric, p_multa numeric default 0,
                                                           p_juros numeric default 0, p_desconto numeric default 0,
                                                           p_forma text default null, p_conta uuid default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.cond_cotas%rowtype;
  v_multa numeric := round(coalesce(p_multa, 0), 2);
  v_juros numeric := round(coalesce(p_juros, 0), 2);
  v_desc numeric := round(coalesce(p_desconto, 0), 2);
  v_valor numeric := round(coalesce(p_valor, 0), 2);
  v_principal numeric;
  v_saldo numeric;
  v_conta uuid;
  v_pag uuid;
  v_contas uuid[];
  v_pesos numeric[];
  v_partes bigint[];
  v_tipo text;
  i int;
  v_unidade text;
begin
  select * into q from public.cond_cotas where id = p_cota for update;
  if not found then raise exception 'Cota não encontrada.'; end if;
  perform privado.cond_exigir(q.organizacao_id, 'financeiro', 'editar');
  if q.status <> 'aberta' then raise exception 'Esta cota não está em aberto.'; end if;
  if p_data is null or p_data > privado.cond_hoje() then raise exception 'Informe a data do pagamento (hoje ou antes).'; end if;
  if v_valor <= 0 then raise exception 'Informe o valor recebido.'; end if;
  if v_multa < 0 or v_juros < 0 or v_desc < 0 then raise exception 'Multa, juros e desconto não podem ser negativos.'; end if;
  v_principal := v_valor - v_multa - v_juros;
  if v_principal < 0 then raise exception 'O valor recebido é menor que a multa e os juros informados.'; end if;
  v_saldo := q.valor - q.valor_abatido;
  if v_principal + v_desc > v_saldo then
    raise exception 'O valor passa do saldo da cota (R$ %). Lance a diferença como multa ou juros.', to_char(v_saldo, 'FM999G999G990D00');
  end if;
  if v_principal + v_desc <= 0 and v_multa + v_juros <= 0 then raise exception 'Nada a registrar.'; end if;

  v_conta := coalesce(p_conta, privado.cond_conta_padrao(q.condominio_id, 'corrente'));
  if v_conta is null or not exists (select 1 from public.cond_contas where id = v_conta and condominio_id = q.condominio_id) then
    raise exception 'Escolha a conta do condomínio onde o dinheiro entrou.';
  end if;
  if (select tipo from public.cond_contas where id = v_conta) <> 'corrente' then
    raise exception 'A cota entra numa conta corrente (a parte do fundo de reserva vai sozinha para a conta do fundo).';
  end if;

  insert into public.cond_cota_pagamentos (organizacao_id, condominio_id, cota_id, data, valor, principal, multa, juros, desconto, forma, conta_id)
  values (q.organizacao_id, q.condominio_id, q.id, p_data, v_valor, v_principal, v_multa, v_juros, v_desc, left(p_forma, 40), v_conta)
  returning id into v_pag;

  v_unidade := privado.cond_unidade_nome(q.unidade_id);
  perform set_config('cond.sistema', 'sim', true);
  if v_principal > 0 then
    -- A parte de conta corrente vai para a conta onde o dinheiro entrou (a escolhida); fundo de reserva e
    -- outros fundos continuam indo para a conta do fundo do item.
    select array_agg(conta order by conta), array_agg(valor order by conta) into v_contas, v_pesos
      from (select case when ct.tipo in ('reserva','fundo') then ct.id else v_conta end as conta, sum(round(i.valor * 100)) as valor
              from public.cond_cota_itens i left join public.cond_contas ct on ct.id = i.conta_id
             where i.cota_id = q.id group by 1 having sum(i.valor) > 0) x;
    if v_contas is null then
      v_contas := array[v_conta];
      v_pesos := array[1::numeric];
    end if;
    v_partes := privado.cond_ratear(round(v_principal * 100)::bigint, v_pesos);
    for i in 1 .. array_length(v_contas, 1) loop
      continue when v_partes[i] <= 0;
      select tipo into v_tipo from public.cond_contas where id = v_contas[i];
      insert into public.cond_lancamentos (organizacao_id, condominio_id, conta_id, tipo, categoria, descricao, valor, competencia,
                                           vencimento, pago_em, status, cota_pagamento_id)
      values (q.organizacao_id, q.condominio_id, v_contas[i], 'receita',
              case v_tipo when 'reserva' then 'Fundo de reserva' when 'fundo' then 'Rateio extra' else 'Cotas condominiais' end,
              'Cota nº ' || q.numero || ' — ' || v_unidade || ' (' || to_char(q.competencia, 'MM/YYYY') || ')',
              v_partes[i] / 100.0, p_data, p_data, p_data, 'pago', v_pag);
    end loop;
  end if;
  if v_multa + v_juros > 0 then
    insert into public.cond_lancamentos (organizacao_id, condominio_id, conta_id, tipo, categoria, descricao, valor, competencia,
                                         vencimento, pago_em, status, cota_pagamento_id)
    values (q.organizacao_id, q.condominio_id, v_conta, 'receita', 'Multa e juros',
            'Multa e juros da cota nº ' || q.numero || ' — ' || v_unidade, v_multa + v_juros, p_data, p_data, p_data, 'pago', v_pag);
  end if;
  perform set_config('cond.sistema', '', true);
  perform privado.cond_recalcular_cota(q.id);
  return v_pag;
end;
$$;
revoke execute on function public.cond_registrar_pagamento(uuid, date, numeric, numeric, numeric, numeric, text, uuid) from public, anon;
grant execute on function public.cond_registrar_pagamento(uuid, date, numeric, numeric, numeric, numeric, text, uuid) to authenticated;

/** Desfaz um recebimento (tira as receitas do livro-caixa; mês fechado impede). */
create or replace function public.cond_estornar_pagamento(p_pagamento uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  p public.cond_cota_pagamentos%rowtype;
  q public.cond_cotas%rowtype;
begin
  select * into p from public.cond_cota_pagamentos where id = p_pagamento for update;
  if not found then raise exception 'Recebimento não encontrado.'; end if;
  perform privado.cond_exigir(p.organizacao_id, 'financeiro', 'editar');
  if p.estornado_em is not null then raise exception 'Este recebimento já foi desfeito.'; end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  select * into q from public.cond_cotas where id = p.cota_id for update;
  if q.status in ('cancelada','renegociada') then raise exception 'A cota foi cancelada ou renegociada: não dá para desfazer.'; end if;
  perform set_config('cond.sistema', 'sim', true);
  delete from public.cond_lancamentos where cota_pagamento_id = p.id;
  perform set_config('cond.sistema', '', true);
  update public.cond_cota_pagamentos set estornado_em = now(), estornado_por = auth.uid(), estorno_motivo = left(btrim(p_motivo), 300)
   where id = p.id;
  perform privado.cond_recalcular_cota(p.cota_id);
  perform privado.cond_evento(p.condominio_id, 'estorno', 'Recebimento de R$ ' || to_char(p.valor, 'FM999G999G990D00')
    || ' da cota nº ' || q.numero || ' desfeito: ' || btrim(p_motivo));
end;
$$;
revoke execute on function public.cond_estornar_pagamento(uuid, text) from public, anon;
grant execute on function public.cond_estornar_pagamento(uuid, text) to authenticated;

/** Cancela uma cota sem recebimentos (consumos e reservas voltam a ficar para cobrar). */
create or replace function public.cond_cancelar_cota(p_cota uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  q public.cond_cotas%rowtype;
begin
  select * into q from public.cond_cotas where id = p_cota for update;
  if not found then raise exception 'Cota não encontrada.'; end if;
  perform privado.cond_exigir(q.organizacao_id, 'financeiro', 'excluir');
  if q.status <> 'aberta' then raise exception 'Só cotas em aberto podem ser canceladas.'; end if;
  if q.acordo_parcela_de is not null then raise exception 'Parcela de acordo: cancele o acordo inteiro.'; end if;
  if exists (select 1 from public.cond_cota_pagamentos where cota_id = q.id and estornado_em is null) then
    raise exception 'Esta cota já tem recebimento: desfaça o recebimento antes.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  perform set_config('cond.sistema', 'sim', true);
  update public.cond_consumos set cota_item_id = null where cota_item_id in (select id from public.cond_cota_itens where cota_id = q.id);
  perform set_config('cond.sistema', '', true);
  update public.cond_reservas set cota_item_id = null where cota_item_id in (select id from public.cond_cota_itens where cota_id = q.id);
  update public.cond_cotas set status = 'cancelada', cancelado_motivo = left(btrim(p_motivo), 300) where id = q.id;
  perform privado.cond_evento(q.condominio_id, 'cota_cancelada', 'Cota nº ' || q.numero || ' cancelada: ' || btrim(p_motivo));
end;
$$;
revoke execute on function public.cond_cancelar_cota(uuid, text) from public, anon;
grant execute on function public.cond_cancelar_cota(uuid, text) to authenticated;

/** Marca (ou desmarca) as cotas vencidas da unidade como cobrança judicial. */
create or replace function public.cond_marcar_juridico(p_unidade uuid, p_juridico boolean, p_obs text default null)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.cond_unidades%rowtype;
  v_n int;
begin
  select * into u from public.cond_unidades where id = p_unidade;
  if not found then raise exception 'Unidade não encontrada.'; end if;
  perform privado.cond_exigir(u.organizacao_id, 'financeiro', 'editar');
  update public.cond_cotas
     set juridico = coalesce(p_juridico, false),
         juridico_em = case when p_juridico then coalesce(juridico_em, privado.cond_hoje()) end,
         juridico_obs = case when p_juridico then left(nullif(btrim(p_obs), ''), 500) end
   where unidade_id = u.id and status = 'aberta' and (vencimento < privado.cond_hoje() or not coalesce(p_juridico, false));
  get diagnostics v_n = row_count;
  perform privado.cond_evento(u.condominio_id, 'juridico',
    case when p_juridico then 'Unidade ' else 'Cobrança judicial encerrada: unidade ' end || privado.cond_unidade_nome(u.id)
    || case when p_juridico then ' enviada para cobrança judicial' || coalesce(' (' || nullif(btrim(p_obs), '') || ')', '') else '' end);
  return v_n;
end;
$$;
revoke execute on function public.cond_marcar_juridico(uuid, boolean, text) from public, anon;
grant execute on function public.cond_marcar_juridico(uuid, boolean, text) to authenticated;

/**
 * Acordo: junta cotas em aberto da unidade (saldo + multa + juros de hoje),
 * aplica o desconto e divide em parcelas (centavos sem perda; a sobra vai na
 * primeira). As cotas originais ficam "renegociadas".
 */
create or replace function public.cond_criar_acordo(p_unidade uuid, p_cotas uuid[], p_parcelas int, p_primeiro_vencimento date,
                                                    p_desconto numeric default 0, p_obs text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  u public.cond_unidades%rowtype;
  v_hoje date := privado.cond_hoje();
  v_original numeric := 0;
  v_total numeric;
  v_acordo uuid;
  v_numero bigint;
  v_partes bigint[];
  v_venc date;
  v_cota uuid;
  v_pessoa uuid;
  v_qtd int;
  e record;
  k int;
begin
  select * into u from public.cond_unidades where id = p_unidade;
  if not found then raise exception 'Unidade não encontrada.'; end if;
  perform privado.cond_exigir(u.organizacao_id, 'financeiro', 'criar');
  if coalesce(p_parcelas, 0) < 1 or p_parcelas > 60 then raise exception 'Parcelas: de 1 a 60.'; end if;
  if p_primeiro_vencimento is null or p_primeiro_vencimento < v_hoje then raise exception 'O primeiro vencimento precisa ser hoje ou depois.'; end if;
  if coalesce(array_length(p_cotas, 1), 0) = 0 then raise exception 'Escolha as cotas do acordo.'; end if;
  perform 1 from public.cond_cotas where id = any(p_cotas) for update;
  select count(*) into v_qtd from public.cond_cotas where id = any(p_cotas) and unidade_id = u.id and status = 'aberta';
  if v_qtd <> (select count(distinct x) from unnest(p_cotas) x) then
    raise exception 'Só cotas em aberto desta unidade entram no acordo.';
  end if;
  for e in select (privado.cond_encargos(id, v_hoje)).* from public.cond_cotas where id = any(p_cotas) loop
    v_original := v_original + e.saldo + e.multa + e.juros;
  end loop;
  if coalesce(p_desconto, 0) < 0 or coalesce(p_desconto, 0) >= v_original then raise exception 'Desconto inválido.'; end if;
  v_total := v_original - coalesce(p_desconto, 0);
  select pessoa_id into v_pessoa from public.cond_pessoas_unidade
   where unidade_id = u.id and responsavel_financeiro and (fim is null or fim >= v_hoje) limit 1;

  insert into public.cond_acordos (organizacao_id, condominio_id, unidade_id, pessoa_id, valor_original, desconto, valor_total, parcelas,
                                   primeiro_vencimento, observacao)
  values (u.organizacao_id, u.condominio_id, u.id, v_pessoa, v_original, coalesce(p_desconto, 0), v_total, p_parcelas,
          p_primeiro_vencimento, left(nullif(btrim(p_obs), ''), 500))
  returning id, numero into v_acordo, v_numero;
  update public.cond_cotas set status = 'renegociada', acordo_id = v_acordo where id = any(p_cotas);

  v_partes := privado.cond_ratear(round(v_total * 100)::bigint, array_fill(1::numeric, array[p_parcelas]));
  for k in 1 .. p_parcelas loop
    v_venc := (p_primeiro_vencimento + make_interval(months => k - 1))::date;
    insert into public.cond_cotas (organizacao_id, condominio_id, unidade_id, tipo, competencia, vencimento, valor, acordo_parcela_de, parcela)
    values (u.organizacao_id, u.condominio_id, u.id, 'acordo', date_trunc('month', v_venc)::date, v_venc, v_partes[k] / 100.0, v_acordo, k)
    returning id into v_cota;
    insert into public.cond_cota_itens (organizacao_id, condominio_id, cota_id, tipo, descricao, valor, conta_id)
    values (u.organizacao_id, u.condominio_id, v_cota, 'acordo', 'Acordo nº ' || v_numero || ' — parcela ' || k || '/' || p_parcelas,
            v_partes[k] / 100.0, privado.cond_conta_padrao(u.condominio_id, 'corrente'));
  end loop;
  perform privado.cond_evento(u.condominio_id, 'acordo', 'Acordo nº ' || v_numero || ' da unidade ' || privado.cond_unidade_nome(u.id)
    || ': R$ ' || to_char(v_total, 'FM999G999G990D00') || ' em ' || p_parcelas || 'x');
  return v_acordo;
end;
$$;
revoke execute on function public.cond_criar_acordo(uuid, uuid[], int, date, numeric, text) from public, anon;
grant execute on function public.cond_criar_acordo(uuid, uuid[], int, date, numeric, text) to authenticated;

/** Cancela um acordo sem parcela paga: as cotas originais voltam a ficar em aberto. */
create or replace function public.cond_cancelar_acordo(p_acordo uuid, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_acordos%rowtype;
begin
  select * into a from public.cond_acordos where id = p_acordo for update;
  if not found then raise exception 'Acordo não encontrado.'; end if;
  perform privado.cond_exigir(a.organizacao_id, 'financeiro', 'excluir');
  if a.status <> 'ativo' then raise exception 'Só acordos ativos podem ser cancelados.'; end if;
  if exists (select 1 from public.cond_cota_pagamentos p join public.cond_cotas q on q.id = p.cota_id
              where q.acordo_parcela_de = a.id and p.estornado_em is null) then
    raise exception 'Já há parcela paga neste acordo: não dá para cancelar.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo.'; end if;
  update public.cond_cotas set status = 'cancelada', cancelado_motivo = 'Acordo cancelado: ' || left(btrim(p_motivo), 250)
   where acordo_parcela_de = a.id and status = 'aberta';
  update public.cond_cotas set status = 'aberta', acordo_id = null where acordo_id = a.id and status = 'renegociada';
  update public.cond_acordos set status = 'cancelado', observacao = left(coalesce(observacao || ' · ', '') || 'Cancelado: ' || btrim(p_motivo), 500)
   where id = a.id;
  perform privado.cond_evento(a.condominio_id, 'acordo_cancelado', 'Acordo nº ' || a.numero || ' cancelado: ' || btrim(p_motivo));
end;
$$;
revoke execute on function public.cond_cancelar_acordo(uuid, text) from public, anon;
grant execute on function public.cond_cancelar_acordo(uuid, text) to authenticated;

/**
 * Inadimplência por unidade numa data: cotas vencidas em aberto, saldo,
 * multa e juros (corrigido), dias do atraso mais antigo, cobrança judicial e
 * acordo ativo. Agrega no banco (sem limite de 1.000 linhas).
 */
create or replace function public.cond_inadimplencia(p_condominio uuid, p_data date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
  v_data date := coalesce(p_data, privado.cond_hoje());
begin
  select organizacao_id into v_org from public.cond_condominios where id = p_condominio;
  if v_org is null or v_org not in (select privado.org_ids()) or not privado.cond_equipe(v_org) then
    raise exception 'Condomínio não encontrado.';
  end if;
  return (
    select coalesce(jsonb_agg(x order by (x ->> 'corrigido')::numeric desc), '[]'::jsonb) from (
      select jsonb_build_object(
        'unidade_id', u.id,
        'unidade', privado.cond_unidade_nome(u.id),
        'responsavel', (select jsonb_build_object('id', p.id, 'nome', p.nome, 'telefone', p.telefone, 'email', p.email)
                          from public.cond_pessoas_unidade pu join public.pessoas p on p.id = pu.pessoa_id
                         where pu.unidade_id = u.id and (pu.fim is null or pu.fim >= v_data)
                         order by pu.responsavel_financeiro desc, (pu.papel = 'proprietario') desc, pu.inicio limit 1),
        'cotas', count(*),
        'saldo', sum(e.saldo),
        'multa', sum(e.multa),
        'juros', sum(e.juros),
        'corrigido', sum(e.saldo + e.multa + e.juros),
        'dias', max(e.dias),
        'mais_antiga', min(q.vencimento),
        'competencias', jsonb_agg(to_char(q.competencia, 'MM/YYYY') order by q.vencimento),
        'cota_ids', jsonb_agg(q.id order by q.vencimento),
        'juridico', bool_or(q.juridico),
        'acordo', exists (select 1 from public.cond_acordos a where a.unidade_id = u.id and a.status = 'ativo')
      ) as x
      from public.cond_cotas q
      join public.cond_unidades u on u.id = q.unidade_id
      cross join lateral privado.cond_encargos(q.id, v_data) e
      where q.condominio_id = p_condominio and q.status = 'aberta' and q.vencimento < v_data
      group by u.id
    ) t
  );
end;
$$;
revoke execute on function public.cond_inadimplencia(uuid, date) from public, anon;
grant execute on function public.cond_inadimplencia(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 7. Livro-caixa: saldos, balancete, previsto × realizado, fechamento
-- -----------------------------------------------------------------------------

/** Saldo de cada conta até uma data (saldo inicial + entradas − saídas pagas). */
create or replace function privado.cond_saldos_dados(p_condominio uuid, p_ate date)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', ct.id, 'nome', ct.nome, 'tipo', ct.tipo, 'ativa', ct.ativa,
           'saldo', ct.saldo_inicial
             + coalesce((select sum(l.valor) from public.cond_lancamentos l where l.status = 'pago' and l.pago_em <= p_ate
                          and ((l.tipo = 'receita' and l.conta_id = ct.id) or (l.tipo = 'transferencia' and l.conta_destino_id = ct.id))), 0)
             - coalesce((select sum(l.valor) from public.cond_lancamentos l where l.status = 'pago' and l.pago_em <= p_ate
                          and l.tipo in ('despesa','transferencia') and l.conta_id = ct.id), 0))
         order by (ct.tipo = 'corrente') desc, (ct.tipo = 'reserva') desc, ct.created_at), '[]'::jsonb)
    from public.cond_contas ct where ct.condominio_id = p_condominio
$$;
revoke execute on function privado.cond_saldos_dados(uuid, date) from public, anon, authenticated;

create or replace function public.cond_saldos(p_condominio uuid, p_ate date default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizacao_id into v_org from public.cond_condominios where id = p_condominio;
  if v_org is null or v_org not in (select privado.org_ids()) or not privado.cond_equipe(v_org) then
    raise exception 'Condomínio não encontrado.';
  end if;
  return privado.cond_saldos_dados(p_condominio, coalesce(p_ate, privado.cond_hoje()));
end;
$$;
revoke execute on function public.cond_saldos(uuid, date) from public, anon;
grant execute on function public.cond_saldos(uuid, date) to authenticated;

/**
 * Balancete do mês (regime de caixa: o que foi pago no mês): receitas e
 * despesas por categoria, movimento e saldo de cada conta, fundo de reserva,
 * cotas emitidas/recebidas e inadimplência na posição do fim do mês (ou de hoje,
 * se o mês ainda não acabou) — não pelo status de agora.
 */
create or replace function privado.cond_balancete_dados(p_condominio uuid, p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ini date := date_trunc('month', p_competencia)::date;
  v_fim date := (date_trunc('month', p_competencia) + interval '1 month - 1 day')::date;
  v_ref date := least((date_trunc('month', p_competencia) + interval '1 month - 1 day')::date, privado.cond_hoje());
  c public.cond_condominios%rowtype;
  v_contas jsonb;
begin
  select * into c from public.cond_condominios where id = p_condominio;
  select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'nome', x.nome, 'tipo', x.tipo,
           'saldo_anterior', x.anterior, 'entradas', x.entradas, 'saidas', x.saidas,
           'saldo_final', x.anterior + x.entradas - x.saidas)
           order by (x.tipo = 'corrente') desc, (x.tipo = 'reserva') desc, x.created_at), '[]'::jsonb)
    into v_contas
    from (select ct.id, ct.nome, ct.tipo, ct.created_at,
                 ct.saldo_inicial
                   + coalesce((select sum(case when (l.tipo = 'receita' and l.conta_id = ct.id) or (l.tipo = 'transferencia' and l.conta_destino_id = ct.id)
                                               then l.valor else -l.valor end)
                                 from public.cond_lancamentos l
                                where l.status = 'pago' and l.pago_em < v_ini
                                  and (l.conta_id = ct.id or l.conta_destino_id = ct.id)), 0) as anterior,
                 coalesce((select sum(l.valor) from public.cond_lancamentos l where l.status = 'pago' and l.pago_em between v_ini and v_fim
                            and ((l.tipo = 'receita' and l.conta_id = ct.id) or (l.tipo = 'transferencia' and l.conta_destino_id = ct.id))), 0) as entradas,
                 coalesce((select sum(l.valor) from public.cond_lancamentos l where l.status = 'pago' and l.pago_em between v_ini and v_fim
                            and l.tipo in ('despesa','transferencia') and l.conta_id = ct.id), 0) as saidas
            from public.cond_contas ct where ct.condominio_id = p_condominio) x;

  return jsonb_build_object(
    'competencia', v_ini,
    'condominio', jsonb_build_object('nome', c.nome, 'cnpj', c.cnpj, 'cidade', c.cidade, 'uf', c.uf),
    'receitas', (select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', total) order by total desc), '[]'::jsonb)
                   from (select categoria, sum(valor) as total from public.cond_lancamentos
                          where condominio_id = p_condominio and tipo = 'receita' and status = 'pago' and pago_em between v_ini and v_fim
                          group by categoria) r),
    'despesas', (select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'valor', total) order by total desc), '[]'::jsonb)
                   from (select categoria, sum(valor) as total from public.cond_lancamentos
                          where condominio_id = p_condominio and tipo = 'despesa' and status = 'pago' and pago_em between v_ini and v_fim
                          group by categoria) d),
    'total_receitas', (select coalesce(sum(valor), 0) from public.cond_lancamentos
                        where condominio_id = p_condominio and tipo = 'receita' and status = 'pago' and pago_em between v_ini and v_fim),
    'total_despesas', (select coalesce(sum(valor), 0) from public.cond_lancamentos
                        where condominio_id = p_condominio and tipo = 'despesa' and status = 'pago' and pago_em between v_ini and v_fim),
    'contas', v_contas,
    'fundo', (select jsonb_build_object('saldo_anterior', coalesce(sum((x ->> 'saldo_anterior')::numeric), 0),
                                         'entradas', coalesce(sum((x ->> 'entradas')::numeric), 0),
                                         'saidas', coalesce(sum((x ->> 'saidas')::numeric), 0),
                                         'saldo_final', coalesce(sum((x ->> 'saldo_final')::numeric), 0))
                from jsonb_array_elements(v_contas) x where x ->> 'tipo' in ('reserva','fundo')),
    'cotas', jsonb_build_object(
       'emitidas', (select count(*) from public.cond_cotas where condominio_id = p_condominio and competencia = v_ini and tipo = 'ordinaria' and status <> 'cancelada'),
       'valor_emitido', (select coalesce(sum(valor), 0) from public.cond_cotas where condominio_id = p_condominio and competencia = v_ini and tipo = 'ordinaria' and status <> 'cancelada'),
       'recebido', (select coalesce(sum(p.valor), 0) from public.cond_cota_pagamentos p
                     where p.condominio_id = p_condominio and p.estornado_em is null and p.data between v_ini and v_fim)),
    -- Posição NA DATA (fim do mês, ou hoje se o mês ainda não acabou): cotas vencidas até lá, menos o
    -- que foi pago até lá. Conta também a cota paga depois e a renegociada depois (o acordo é posterior).
    'inadimplencia', (select jsonb_build_object('em', v_ref, 'unidades', count(distinct x.unidade_id), 'valor', coalesce(sum(x.saldo), 0))
                        from (select q.unidade_id,
                                     q.valor - coalesce((select sum(p.principal + p.desconto) from public.cond_cota_pagamentos p
                                                          where p.cota_id = q.id and p.estornado_em is null and p.data <= v_ref), 0) as saldo
                                from public.cond_cotas q
                               where q.condominio_id = p_condominio and q.vencimento < v_ref
                                 and (q.status in ('aberta','paga')
                                      or (q.status = 'renegociada' and exists (
                                            select 1 from public.cond_acordos a
                                             where a.id = q.acordo_id and (a.created_at at time zone 'America/Sao_Paulo')::date > v_ref)))) x
                       where x.saldo > 0),
    'fechado', privado.cond_mes_fechado(p_condominio, v_ini)
  );
end;
$$;
revoke execute on function privado.cond_balancete_dados(uuid, date) from public, anon, authenticated;

create or replace function public.cond_balancete(p_condominio uuid, p_competencia date)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizacao_id into v_org from public.cond_condominios where id = p_condominio;
  if v_org is null or v_org not in (select privado.org_ids()) or not privado.cond_equipe(v_org) then
    raise exception 'Condomínio não encontrado.';
  end if;
  return privado.cond_balancete_dados(p_condominio, p_competencia);
end;
$$;
revoke execute on function public.cond_balancete(uuid, date) from public, anon;
grant execute on function public.cond_balancete(uuid, date) to authenticated;

/** Previsto (orçamento aprovado, por mês) × realizado (despesas e receitas pagas, por categoria e mês) do ano. */
create or replace function public.cond_previsto_realizado(p_condominio uuid, p_ano int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  select organizacao_id into v_org from public.cond_condominios where id = p_condominio;
  if v_org is null or v_org not in (select privado.org_ids()) or not privado.cond_equipe(v_org) then
    raise exception 'Condomínio não encontrado.';
  end if;
  return jsonb_build_object(
    'ano', p_ano,
    'previsto', (select coalesce(jsonb_agg(jsonb_build_object('categoria', i.categoria, 'tipo', i.tipo, 'mensal', i.valor_mensal)
                                           order by i.tipo, i.categoria), '[]'::jsonb)
                   from public.cond_orcamento_itens i join public.cond_orcamentos o on o.id = i.orcamento_id
                  where o.condominio_id = p_condominio and o.ano = p_ano and o.status = 'aprovado'),
    'realizado', (select coalesce(jsonb_agg(jsonb_build_object('categoria', categoria, 'tipo', tipo, 'mes', mes, 'valor', total)), '[]'::jsonb)
                    from (select categoria, tipo, extract(month from pago_em)::int as mes, sum(valor) as total
                            from public.cond_lancamentos
                           where condominio_id = p_condominio and status = 'pago' and tipo in ('receita','despesa')
                             and extract(year from pago_em)::int = p_ano
                           group by categoria, tipo, extract(month from pago_em)) r)
  );
end;
$$;
revoke execute on function public.cond_previsto_realizado(uuid, int) from public, anon;
grant execute on function public.cond_previsto_realizado(uuid, int) to authenticated;

/** Fecha o mês: guarda o balancete e trava os lançamentos pagos no mês. */
create or replace function public.cond_fechar_mes(p_condominio uuid, p_competencia date)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cond_condominios%rowtype;
  v_comp date := date_trunc('month', p_competencia)::date;
  f public.cond_fechamentos%rowtype;
begin
  select * into c from public.cond_condominios where id = p_condominio;
  if not found then raise exception 'Condomínio não encontrado.'; end if;
  perform privado.cond_exigir(c.organizacao_id, 'financeiro', 'editar');
  if v_comp > date_trunc('month', privado.cond_hoje())::date then raise exception 'Não dá para fechar um mês que ainda não começou.'; end if;
  select * into f from public.cond_fechamentos where condominio_id = c.id and competencia = v_comp for update;
  if found and f.status = 'fechado' then raise exception 'Este mês já está fechado.'; end if;
  if found then
    update public.cond_fechamentos set status = 'fechado', fechado_em = now(), fechado_por = auth.uid(),
           resumo = privado.cond_balancete_dados(c.id, v_comp)
     where id = f.id;
  else
    insert into public.cond_fechamentos (organizacao_id, condominio_id, competencia, status, fechado_em, fechado_por, resumo)
    values (c.organizacao_id, c.id, v_comp, 'fechado', now(), auth.uid(), privado.cond_balancete_dados(c.id, v_comp));
  end if;
  -- O resumo guardado já sai marcado como fechado.
  update public.cond_fechamentos set resumo = jsonb_set(resumo, '{fechado}', 'true'::jsonb)
   where condominio_id = c.id and competencia = v_comp;
  perform privado.cond_evento(c.id, 'fechamento', 'Mês ' || to_char(v_comp, 'MM/YYYY') || ' fechado');
end;
$$;
revoke execute on function public.cond_fechar_mes(uuid, date) from public, anon;
grant execute on function public.cond_fechar_mes(uuid, date) to authenticated;

/** Reabre um mês fechado: só o administrador, com motivo (fica registrado). */
create or replace function public.cond_reabrir_mes(p_condominio uuid, p_competencia date, p_motivo text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cond_condominios%rowtype;
  v_comp date := date_trunc('month', p_competencia)::date;
begin
  select * into c from public.cond_condominios where id = p_condominio;
  if not found then raise exception 'Condomínio não encontrado.'; end if;
  perform privado.cond_exigir(c.organizacao_id, 'financeiro', 'editar');
  if auth.uid() is not null and privado.papel_atual(c.organizacao_id) is distinct from 'admin' then
    raise exception 'Só o administrador reabre um mês fechado.';
  end if;
  if coalesce(btrim(p_motivo), '') = '' then raise exception 'Informe o motivo da reabertura.'; end if;
  update public.cond_fechamentos set status = 'reaberto', reaberto_em = now(), reaberto_por = auth.uid(),
         motivo_reabertura = left(btrim(p_motivo), 500)
   where condominio_id = c.id and competencia = v_comp and status = 'fechado';
  if not found then raise exception 'Este mês não está fechado.'; end if;
  perform privado.cond_evento(c.id, 'reabertura', 'Mês ' || to_char(v_comp, 'MM/YYYY') || ' reaberto: ' || btrim(p_motivo));
end;
$$;
revoke execute on function public.cond_reabrir_mes(uuid, date, text) from public, anon;
grant execute on function public.cond_reabrir_mes(uuid, date, text) to authenticated;

/** Previsões de despesa do mês a partir dos contratos com fornecedores (sem repetir). */
create or replace function public.cond_gerar_previsoes(p_condominio uuid, p_competencia date)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.cond_condominios%rowtype;
  v_comp date := date_trunc('month', p_competencia)::date;
  r record;
  v_n int := 0;
begin
  select * into c from public.cond_condominios where id = p_condominio;
  if not found then raise exception 'Condomínio não encontrado.'; end if;
  perform privado.cond_exigir(c.organizacao_id, 'financeiro', 'criar');
  for r in select k.*, coalesce(p.nome, k.fornecedor_nome) as nome_fornecedor
             from public.cond_contratos_fornecedores k left join public.pessoas p on p.id = k.fornecedor_id
            where k.condominio_id = c.id and k.ativo and k.valor > 0 loop
    continue when not privado.cond_contrato_no_mes(r.periodicidade, r.inicio, r.fim, v_comp);
    continue when exists (select 1 from public.cond_lancamentos l where l.contrato_id = r.id and l.competencia = v_comp and l.status <> 'cancelado');
    insert into public.cond_lancamentos (organizacao_id, condominio_id, conta_id, tipo, categoria, descricao, valor, competencia, vencimento,
                                         status, fornecedor_id, contrato_id)
    values (c.organizacao_id, c.id, coalesce(r.conta_id, privado.cond_conta_padrao(c.id, 'corrente')), 'despesa', r.categoria,
            r.servico || coalesce(' — ' || r.nome_fornecedor, '') || ' (' || to_char(v_comp, 'MM/YYYY') || ')', r.valor, v_comp,
            privado.cond_dia_no_mes(v_comp, coalesce(r.dia_vencimento, extract(day from r.inicio)::int)), 'aberto', r.fornecedor_id, r.id);
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.cond_gerar_previsoes(uuid, date) from public, anon;
grant execute on function public.cond_gerar_previsoes(uuid, date) to authenticated;

/**
 * Taxa de administração do mês no financeiro DA IMOBILIÁRIA (conta a receber
 * em public.lancamentos), uma vez por mês — botão explícito. Roda com as
 * regras do financeiro da imobiliária (security invoker: RLS e aprovação).
 */
create or replace function public.cond_lancar_taxa_admin(p_condominio uuid, p_competencia date)
returns uuid
language plpgsql
security invoker
set search_path = public
as $$
declare
  c public.cond_condominios%rowtype;
  v_comp date := date_trunc('month', p_competencia)::date;
  v_lanc uuid;
begin
  select * into c from public.cond_condominios where id = p_condominio;
  if not found then raise exception 'Condomínio não encontrado.'; end if;
  perform privado.cond_exigir(c.organizacao_id, 'financeiro', 'criar');
  if c.taxa_administracao <= 0 then raise exception 'Informe a taxa de administração no cadastro do condomínio.'; end if;
  if exists (select 1 from public.cond_taxas_admin where condominio_id = c.id and competencia = v_comp) then
    raise exception 'A taxa de %/% já foi lançada no financeiro da imobiliária.', lpad(extract(month from v_comp)::text, 2, '0'), extract(year from v_comp);
  end if;
  insert into public.lancamentos (organizacao_id, tipo, descricao, categoria, valor, vencimento, status)
  values (c.organizacao_id, 'receber', 'Taxa de administração — ' || c.nome || ' (' || to_char(v_comp, 'MM/YYYY') || ')',
          'Administração de condomínios', c.taxa_administracao, privado.cond_dia_no_mes(v_comp, c.dia_vencimento), 'aberto')
  returning id into v_lanc;
  insert into public.cond_taxas_admin (organizacao_id, condominio_id, competencia, valor, lancamento_id)
  values (c.organizacao_id, c.id, v_comp, c.taxa_administracao, v_lanc);
  return v_lanc;
end;
$$;
revoke execute on function public.cond_lancar_taxa_admin(uuid, date) from public, anon;
grant execute on function public.cond_lancar_taxa_admin(uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- 8. Assembleias: voto (presencial pela equipe) e desfazer
-- -----------------------------------------------------------------------------

/** Peso do voto da unidade: fração ideal (se a assembleia pesa pela fração) ou 1. */
create or replace function privado.cond_peso_voto(p_assembleia uuid, p_unidade uuid)
returns numeric
language sql
stable
security definer
set search_path = public
as $$
  select case when a.voto_peso = 'fracao' then coalesce(u.fracao_ideal, 0) else 1 end
    from public.cond_assembleias a, public.cond_unidades u where a.id = p_assembleia and u.id = p_unidade
$$;
revoke execute on function privado.cond_peso_voto(uuid, uuid) from public, anon, authenticated;

create or replace function public.cond_registrar_voto(p_item uuid, p_unidade uuid, p_opcao text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  it public.cond_assembleia_itens%rowtype;
  a public.cond_assembleias%rowtype;
  v_voto uuid;
begin
  select * into it from public.cond_assembleia_itens where id = p_item;
  if not found then raise exception 'Item da pauta não encontrado.'; end if;
  perform privado.cond_exigir(it.organizacao_id, 'imoveis', 'editar');
  select * into a from public.cond_assembleias where id = it.assembleia_id;
  if a.status <> 'em_andamento' then raise exception 'A votação só acontece com a assembleia em andamento.'; end if;
  if it.tipo_votacao = 'informativo' then raise exception 'Item informativo não tem votação.'; end if;
  if not (p_opcao = any(it.opcoes)) then raise exception 'Opção de voto inválida.'; end if;
  if not exists (select 1 from public.cond_unidades where id = p_unidade and condominio_id = a.condominio_id) then
    raise exception 'Unidade não encontrada.';
  end if;
  if privado.cond_peso_voto(a.id, p_unidade) <= 0 then
    raise exception 'Unidade sem fração ideal: o voto pesa pela fração. Complete o cadastro.';
  end if;
  if exists (select 1 from public.cond_votos where item_id = it.id and unidade_id = p_unidade) then
    raise exception 'Esta unidade já votou neste item.';
  end if;
  insert into public.cond_assembleia_presencas (organizacao_id, condominio_id, assembleia_id, unidade_id)
  values (a.organizacao_id, a.condominio_id, a.id, p_unidade)
  on conflict (assembleia_id, unidade_id) do nothing;
  insert into public.cond_votos (organizacao_id, condominio_id, assembleia_id, item_id, unidade_id, opcao, peso, origem)
  values (a.organizacao_id, a.condominio_id, a.id, it.id, p_unidade, p_opcao, privado.cond_peso_voto(a.id, p_unidade), 'presencial')
  returning id into v_voto;
  return v_voto;
end;
$$;
revoke execute on function public.cond_registrar_voto(uuid, uuid, text) from public, anon;
grant execute on function public.cond_registrar_voto(uuid, uuid, text) to authenticated;

create or replace function public.cond_desfazer_voto(p_voto uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v public.cond_votos%rowtype;
begin
  select * into v from public.cond_votos where id = p_voto;
  if not found then raise exception 'Voto não encontrado.'; end if;
  perform privado.cond_exigir(v.organizacao_id, 'imoveis', 'editar');
  if (select status from public.cond_assembleias where id = v.assembleia_id) <> 'em_andamento' then
    raise exception 'Só dá para desfazer voto com a assembleia em andamento.';
  end if;
  if v.origem = 'portal' then raise exception 'Voto dado pelo portal não pode ser desfeito pela equipe.'; end if;
  delete from public.cond_votos where id = v.id;
  perform privado.cond_evento(v.condominio_id, 'voto_desfeito',
    'Voto "' || v.opcao || '" da unidade ' || coalesce(privado.cond_unidade_nome(v.unidade_id), '?') || ' desfeito no item '
    || coalesce((select it.ordem || ' (' || it.titulo || ')' from public.cond_assembleia_itens it where it.id = v.item_id), '?')
    || ' da assembleia "' || coalesce((select titulo from public.cond_assembleias where id = v.assembleia_id), '?') || '"');
end;
$$;
revoke execute on function public.cond_desfazer_voto(uuid) from public, anon;
grant execute on function public.cond_desfazer_voto(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Portal do condômino (/condominio/[token])
-- -----------------------------------------------------------------------------

/** Link: pessoa da organização, ligada ao condomínio (vínculo em vigor) e com CPF/CNPJ ou telefone para confirmar. */
create or replace function privado.cond_portal_acessos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_juntando boolean := coalesce(current_setting('cond.juntando', true), '') = 'sim';
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from public.cond_pessoas_unidade pu where pu.condominio_id = new.condominio_id and pu.pessoa_id = new.pessoa_id
                     and (pu.fim is null or pu.fim >= privado.cond_hoje())) then
      raise exception 'Esta pessoa não está ligada ao condomínio (aba Pessoas): ligue antes de gerar o link.';
    end if;
    if (select x.codigo from privado.portal_codigo(new.pessoa_id) x) is null then
      raise exception 'Cadastre o CPF/CNPJ ou o telefone da pessoa antes de gerar o link: é com ele que ela confirma quem é.';
    end if;
    if new.expira_em is not null and (new.expira_em <= now() or new.expira_em > now() + interval '2 years') then
      raise exception 'Validade do link inválida.';
    end if;
  else
    if new.pessoa_id is distinct from old.pessoa_id and not v_juntando then
      raise exception 'Para outra pessoa, gere um link novo.';
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
create or replace trigger cond_portal_acessos_antes_trg before insert or update on public.cond_portal_acessos
  for each row execute function privado.cond_portal_acessos_antes();

/** Registro do portal (a pessoa e o nome ficam copiados: sobrevivem à exclusão do link). */
create or replace function privado.cond_portal_eventos_antes()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
begin
  if new.acesso_id is not null then
    select * into a from public.cond_portal_acessos where id = new.acesso_id;
    if found then
      new.pessoa_id := coalesce(new.pessoa_id, a.pessoa_id);
      new.condominio_id := coalesce(new.condominio_id, a.condominio_id);
    end if;
  end if;
  if new.pessoa_nome is null and new.pessoa_id is not null then
    new.pessoa_nome := (select nome from public.pessoas where id = new.pessoa_id);
  end if;
  return new;
end;
$$;
create or replace trigger cond_portal_eventos_antes_trg before insert on public.cond_portal_eventos
  for each row execute function privado.cond_portal_eventos_antes();

create or replace function privado.cond_portal_acessos_depois()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.cond_portal_eventos (organizacao_id, acesso_id, tipo, descricao) values (new.organizacao_id, new.id, 'gerado', 'Link do portal gerado');
    return new;
  end if;
  if tg_op = 'DELETE' then
    if exists (select 1 from public.organizacoes where id = old.organizacao_id) then
      insert into public.cond_portal_eventos (organizacao_id, condominio_id, acesso_id, pessoa_id, tipo, descricao)
      values (old.organizacao_id, old.condominio_id, null, old.pessoa_id, 'excluido', 'Link do portal excluído (' || old.acessos || ' entrada(s))');
    end if;
    return old;
  end if;
  if new.token is distinct from old.token then
    delete from public.cond_portal_sessoes where acesso_id = new.id;
    insert into public.cond_portal_eventos (organizacao_id, acesso_id, tipo, descricao) values (new.organizacao_id, new.id, 'trocado', 'Link trocado: o endereço antigo parou de funcionar');
  end if;
  if old.ativo and not new.ativo then
    delete from public.cond_portal_sessoes where acesso_id = new.id;
    insert into public.cond_portal_eventos (organizacao_id, acesso_id, tipo, descricao) values (new.organizacao_id, new.id, 'revogado', 'Link desativado');
  elsif new.ativo and not old.ativo then
    insert into public.cond_portal_eventos (organizacao_id, acesso_id, tipo, descricao) values (new.organizacao_id, new.id, 'reativado', 'Link reativado');
  end if;
  return new;
end;
$$;
create or replace trigger cond_portal_acessos_depois_trg after insert or update or delete on public.cond_portal_acessos
  for each row execute function privado.cond_portal_acessos_depois();

/** Link válido: ativo, dentro da validade, módulo em uso e pessoa ainda ligada ao condomínio. */
create or replace function privado.cond_link(p_token uuid)
returns public.cond_portal_acessos
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
begin
  select * into a from public.cond_portal_acessos where token = p_token;
  if not found or not a.ativo or (a.expira_em is not null and a.expira_em <= now()) then return null; end if;
  if not privado.cond_ativo(a.organizacao_id) then return null; end if;
  if not exists (select 1 from public.cond_pessoas_unidade pu where pu.condominio_id = a.condominio_id and pu.pessoa_id = a.pessoa_id
                   and (pu.fim is null or pu.fim >= privado.cond_hoje())) then
    return null;
  end if;
  return a;
end;
$$;
revoke execute on function privado.cond_link(uuid) from public, anon, authenticated;

create or replace function privado.cond_sessao(p_token uuid, p_sessao text)
returns public.cond_portal_acessos
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
begin
  a := privado.cond_link(p_token);
  if a.id is null or coalesce(length(p_sessao), 0) < 32 then return null; end if;
  if not exists (select 1 from public.cond_portal_sessoes s
                  where s.acesso_id = a.id and s.hash = privado.portal_hash(p_sessao, a.token) and s.expira_em > now()) then
    return null;
  end if;
  return a;
end;
$$;
revoke execute on function privado.cond_sessao(uuid, text) from public, anon, authenticated;

create or replace function privado.cond_validar(p_token uuid, p_sessao text)
returns public.cond_portal_acessos
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
begin
  a := privado.cond_link(p_token);
  if a.id is null then raise exception 'Link inválido ou desativado. Peça um novo link à administradora.'; end if;
  a := privado.cond_sessao(p_token, p_sessao);
  if a.id is null then raise exception 'Sessão expirada: confirme seus dados de novo.'; end if;
  return a;
end;
$$;
revoke execute on function privado.cond_validar(uuid, text) from public, anon, authenticated;

create or replace function privado.cond_portal_evento(p_acesso public.cond_portal_acessos, p_tipo text, p_descricao text, p_ip text default null)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.cond_portal_eventos (organizacao_id, condominio_id, acesso_id, tipo, descricao, ip, usuario_id)
  values (p_acesso.organizacao_id, p_acesso.condominio_id, p_acesso.id, p_tipo, left(p_descricao, 500), left(p_ip, 64), null)
$$;
revoke execute on function privado.cond_portal_evento(public.cond_portal_acessos, text, text, text) from public, anon, authenticated;

/** Limite por link (na janela) e por condomínio (por hora). */
create or replace function privado.cond_portal_limite(p_acesso public.cond_portal_acessos, p_tipo text, p_max int, p_janela interval default interval '1 day')
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if (select count(*) from public.cond_portal_eventos where acesso_id = p_acesso.id and tipo = p_tipo and data > now() - p_janela) >= p_max then
    raise exception 'Limite de envios atingido por hoje. Tente amanhã ou fale com a administradora.';
  end if;
  if (select count(*) from public.cond_portal_eventos where condominio_id = p_acesso.condominio_id and tipo = p_tipo and data > now() - interval '1 hour') >= 200 then
    raise exception 'Muitos envios agora. Tente de novo mais tarde.';
  end if;
end;
$$;
revoke execute on function privado.cond_portal_limite(public.cond_portal_acessos, text, int, interval) from public, anon, authenticated;

/** Unidades da pessoa no condomínio (vínculo em vigor). p_papel: 'todas', 'financeiro' (condômino ou responsável) ou 'voto' (condômino). */
create or replace function privado.cond_unidades_da_pessoa(p_acesso public.cond_portal_acessos, p_papel text default 'todas')
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select distinct pu.unidade_id from public.cond_pessoas_unidade pu
   where pu.condominio_id = p_acesso.condominio_id and pu.pessoa_id = p_acesso.pessoa_id and pu.unidade_id is not null
     and (pu.fim is null or pu.fim >= privado.cond_hoje())
     and (p_papel = 'todas'
          or (p_papel = 'financeiro' and (pu.papel = 'proprietario' or pu.responsavel_financeiro))
          or (p_papel = 'voto' and pu.papel = 'proprietario'))
$$;
revoke execute on function privado.cond_unidades_da_pessoa(public.cond_portal_acessos, text) from public, anon, authenticated;

/** Comunicados que a pessoa vê: para todos, para o bloco de uma unidade dela ou para a unidade dela. */
create or replace function privado.cond_comunicados_da_pessoa(p_acesso public.cond_portal_acessos)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select cm.id from public.cond_comunicados cm
   where cm.condominio_id = p_acesso.condominio_id and cm.publicado_em <= now()
     and (cm.expira_em is null or cm.expira_em >= privado.cond_hoje())
     and (cm.publico = 'todos'
          or (cm.publico = 'bloco' and cm.bloco_id in (select u.bloco_id from public.cond_unidades u
                                                         where u.id in (select privado.cond_unidades_da_pessoa(p_acesso))))
          or (cm.publico = 'unidades' and cm.unidades && array(select privado.cond_unidades_da_pessoa(p_acesso))))
$$;
revoke execute on function privado.cond_comunicados_da_pessoa(public.cond_portal_acessos) from public, anon, authenticated;

create or replace function public.cond_portal_inicio(p_token uuid, p_sessao text default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
  s public.cond_portal_acessos%rowtype;
  o public.organizacoes%rowtype;
  c public.cond_condominios%rowtype;
  k record;
  v_nome text;
begin
  a := privado.cond_link(p_token);
  if a.id is null then return null; end if;
  select * into o from public.organizacoes where id = a.organizacao_id;
  select * into c from public.cond_condominios where id = a.condominio_id;
  select nome into v_nome from public.pessoas where id = a.pessoa_id;
  select * into k from privado.portal_codigo(a.pessoa_id);
  s := privado.cond_sessao(p_token, p_sessao);
  return jsonb_build_object(
    'condominio', c.nome,
    'organizacao', jsonb_build_object('nome', o.nome, 'telefone', o.telefone, 'email', o.email),
    'primeiro_nome', split_part(btrim(coalesce(v_nome, '')), ' ', 1),
    'tipo_codigo', k.tipo,
    'bloqueado_ate', case when a.bloqueado_ate > now() then a.bloqueado_ate end,
    'entrou', s.id is not null,
    'nome', case when s.id is not null then v_nome end
  );
end;
$$;
revoke execute on function public.cond_portal_inicio(uuid, text) from public;
grant execute on function public.cond_portal_inicio(uuid, text) to anon, authenticated;

/** Confirma a identidade (4 números) e abre sessão de 12 horas. Erro de número não usa exception (o contador não pode ser desfeito). */
create or replace function public.cond_portal_entrar(p_token uuid, p_codigo text, p_ip text default null, p_ua text default null)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
  k record;
  v_digitos text := left(regexp_replace(coalesce(p_codigo, ''), '\D', '', 'g'), 8);
  v_falhas int;
  v_sessao text;
  v_expira timestamptz := now() + interval '12 hours';
begin
  a := privado.cond_link(p_token);
  if a.id is null then
    return jsonb_build_object('ok', false, 'erro', 'Link inválido ou desativado. Peça um novo link à administradora.');
  end if;
  select * into a from public.cond_portal_acessos where id = a.id for update;
  if a.bloqueado_ate is not null and a.bloqueado_ate > now() then
    return jsonb_build_object('ok', false, 'bloqueado_ate', a.bloqueado_ate,
      'erro', 'Muitas tentativas erradas. Tente de novo depois das ' || to_char(a.bloqueado_ate at time zone 'America/Sao_Paulo', 'HH24:MI') || '.');
  end if;
  if (select count(*) from public.cond_portal_eventos where condominio_id = a.condominio_id and tipo in ('falha','bloqueio') and data > now() - interval '1 hour') >= 300 then
    return jsonb_build_object('ok', false, 'erro', 'Muitas tentativas agora. Tente de novo mais tarde.');
  end if;
  if (select count(*) from public.cond_portal_eventos where acesso_id = a.id and tipo = 'entrada' and data > now() - interval '1 day') >= 30 then
    return jsonb_build_object('ok', false, 'erro', 'Limite de acessos de hoje atingido. Tente amanhã.');
  end if;
  select * into k from privado.portal_codigo(a.pessoa_id);
  if k.codigo is null or v_digitos <> k.codigo then
    v_falhas := a.falhas + 1;
    if v_falhas >= 5 then
      update public.cond_portal_acessos set falhas = 0, bloqueado_ate = now() + interval '30 minutes' where id = a.id;
      perform privado.cond_portal_evento(a, 'bloqueio', '5 tentativas erradas: entrada bloqueada por 30 minutos', p_ip);
      return jsonb_build_object('ok', false, 'restantes', 0, 'erro', 'Números errados 5 vezes. Por segurança, a entrada ficou bloqueada por 30 minutos.');
    end if;
    update public.cond_portal_acessos set falhas = v_falhas where id = a.id;
    perform privado.cond_portal_evento(a, 'falha', 'Tentativa de entrada com números errados', p_ip);
    return jsonb_build_object('ok', false, 'restantes', 5 - v_falhas, 'erro', 'Os números não conferem. Confira e tente de novo.');
  end if;
  v_sessao := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  delete from public.cond_portal_sessoes where acesso_id = a.id and expira_em <= now();
  delete from public.cond_portal_sessoes where id in (select id from public.cond_portal_sessoes where acesso_id = a.id order by created_at desc offset 9);
  insert into public.cond_portal_sessoes (organizacao_id, acesso_id, hash, expira_em, ip, user_agent)
  values (a.organizacao_id, a.id, privado.portal_hash(v_sessao, a.token), v_expira, left(p_ip, 64), left(p_ua, 200));
  update public.cond_portal_acessos set falhas = 0, bloqueado_ate = null, ultimo_acesso = now(), acessos = acessos + 1 where id = a.id;
  perform privado.cond_portal_evento(a, 'entrada', 'Entrou no portal', p_ip);
  return jsonb_build_object('ok', true, 'sessao', v_sessao, 'expira_em', v_expira);
end;
$$;
revoke execute on function public.cond_portal_entrar(uuid, text, text, text) from public;
grant execute on function public.cond_portal_entrar(uuid, text, text, text) to anon, authenticated;

create or replace function public.cond_portal_sair(p_token uuid, p_sessao text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
begin
  a := privado.cond_sessao(p_token, p_sessao);
  if a.id is null then return; end if;
  delete from public.cond_portal_sessoes where acesso_id = a.id and hash = privado.portal_hash(p_sessao, a.token);
  perform privado.cond_portal_evento(a, 'saida', 'Saiu do portal');
end;
$$;
revoke execute on function public.cond_portal_sair(uuid, text) from public;
grant execute on function public.cond_portal_sair(uuid, text) to anon, authenticated;

/** Cota vista pelo portal (com itens, recebimentos e a situação de hoje). */
create or replace function privado.cond_portal_cota_json(p_cota uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', q.id, 'numero', q.numero, 'tipo', q.tipo, 'competencia', q.competencia, 'vencimento', q.vencimento, 'valor', q.valor,
    'valor_abatido', q.valor_abatido, 'status', q.status, 'pago_em', q.pago_em, 'unidade', privado.cond_unidade_nome(q.unidade_id),
    'saldo', e.saldo, 'multa', e.multa, 'juros', e.juros, 'dias', e.dias,
    'itens', (select coalesce(jsonb_agg(jsonb_build_object('descricao', i.descricao, 'valor', i.valor, 'tipo', i.tipo) order by i.tipo <> 'ordinaria', i.descricao), '[]'::jsonb)
                from public.cond_cota_itens i where i.cota_id = q.id),
    'pagamentos', (select coalesce(jsonb_agg(jsonb_build_object('data', p.data, 'valor', p.valor) order by p.data), '[]'::jsonb)
                     from public.cond_cota_pagamentos p where p.cota_id = q.id and p.estornado_em is null))
    from public.cond_cotas q cross join lateral privado.cond_encargos(q.id, privado.cond_hoje()) e
   where q.id = p_cota
$$;
revoke execute on function privado.cond_portal_cota_json(uuid) from public, anon, authenticated;

/** Leitura do portal por seção (só o que é da pessoa e do condomínio dela). */
create or replace function public.cond_portal_dados(p_token uuid, p_sessao text, p_secao text, p jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
  c public.cond_condominios%rowtype;
  v_hoje date := privado.cond_hoje();
  v_id uuid;
  v_mes date;
begin
  a := privado.cond_link(p_token);
  if a.id is null then return jsonb_build_object('erro', 'link'); end if;
  a := privado.cond_sessao(p_token, p_sessao);
  if a.id is null then return jsonb_build_object('erro', 'sessao'); end if;
  select * into c from public.cond_condominios where id = a.condominio_id;
  v_id := case when coalesce(p ->> 'id', '') ~* '^[0-9a-f-]{36}$' then (p ->> 'id')::uuid end;

  if p_secao = 'inicio' then
    return jsonb_build_object(
      'condominio', jsonb_build_object('nome', c.nome, 'endereco', nullif(concat_ws(', ', nullif(concat_ws(', ', c.logradouro, c.numero), ''), c.bairro,
                                       nullif(concat_ws(' / ', c.cidade, c.uf), '')), ''), 'dia_vencimento', c.dia_vencimento),
      'unidades', (select coalesce(jsonb_agg(jsonb_build_object('id', u, 'nome', privado.cond_unidade_nome(u)) order by privado.cond_unidade_nome(u)), '[]'::jsonb)
                     from privado.cond_unidades_da_pessoa(a) u),
      'papeis', (select coalesce(jsonb_agg(distinct pu.papel), '[]'::jsonb) from public.cond_pessoas_unidade pu
                  where pu.condominio_id = a.condominio_id and pu.pessoa_id = a.pessoa_id and (pu.fim is null or pu.fim >= v_hoje)),
      'cotas_abertas', (select count(*) from public.cond_cotas q where q.unidade_id in (select privado.cond_unidades_da_pessoa(a, 'financeiro')) and q.status = 'aberta'),
      'em_atraso', (select count(*) from public.cond_cotas q where q.unidade_id in (select privado.cond_unidades_da_pessoa(a, 'financeiro'))
                      and q.status = 'aberta' and q.vencimento < v_hoje),
      'proxima', (select privado.cond_portal_cota_json(q.id) from public.cond_cotas q
                   where q.unidade_id in (select privado.cond_unidades_da_pessoa(a, 'financeiro')) and q.status = 'aberta'
                   order by q.vencimento limit 1),
      'nao_lidos', (select count(*) from privado.cond_comunicados_da_pessoa(a) cm
                     where not exists (select 1 from public.cond_comunicado_leituras l where l.comunicado_id = cm and l.pessoa_id = a.pessoa_id)),
      'ocorrencias_abertas', (select count(*) from public.cond_ocorrencias o where o.condominio_id = a.condominio_id and o.status in ('aberta','em_andamento')
                                and (o.pessoa_id = a.pessoa_id or o.unidade_id in (select privado.cond_unidades_da_pessoa(a)))),
      'assembleias', (select count(*) from public.cond_assembleias s where s.condominio_id = a.condominio_id and s.status in ('convocada','em_andamento')),
      'reservas', (select count(*) from public.cond_reservas r where r.unidade_id in (select privado.cond_unidades_da_pessoa(a))
                     and r.status in ('pedida','confirmada') and r.fim > now())
    );
  end if;

  if p_secao = 'cotas' then
    return (select coalesce(jsonb_agg(privado.cond_portal_cota_json(q.id) order by q.vencimento desc), '[]'::jsonb)
              from (select id, vencimento from public.cond_cotas
                     where unidade_id in (select privado.cond_unidades_da_pessoa(a, 'financeiro')) and status <> 'cancelada'
                       and vencimento >= v_hoje - 730
                     order by vencimento desc limit 60) q);
  end if;

  if p_secao = 'cota' then
    if not exists (select 1 from public.cond_cotas where id = v_id and unidade_id in (select privado.cond_unidades_da_pessoa(a, 'financeiro'))) then
      return null;
    end if;
    return privado.cond_portal_cota_json(v_id) || jsonb_build_object(
      'condominio', c.nome, 'cnpj', c.cnpj, 'pix', jsonb_build_object('chave', c.pix_chave, 'nome', coalesce(c.pix_nome, c.nome), 'cidade', c.pix_cidade),
      'banco', jsonb_build_object('banco', c.banco, 'agencia', c.agencia, 'conta', c.conta));
  end if;

  if p_secao = 'comunicados' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', cm.id, 'titulo', cm.titulo, 'texto', cm.texto, 'publicado_em', cm.publicado_em,
                                                         'fixado', cm.fixado,
                                                         'lido', exists (select 1 from public.cond_comunicado_leituras l where l.comunicado_id = cm.id and l.pessoa_id = a.pessoa_id))
                                      order by cm.fixado desc, cm.publicado_em desc), '[]'::jsonb)
              from (select * from public.cond_comunicados where id in (select privado.cond_comunicados_da_pessoa(a)) order by publicado_em desc limit 50) cm);
  end if;

  if p_secao = 'reservas' then
    return jsonb_build_object(
      'unidades', (select coalesce(jsonb_agg(jsonb_build_object('id', u, 'nome', privado.cond_unidade_nome(u))), '[]'::jsonb) from privado.cond_unidades_da_pessoa(a) u),
      'areas', (select coalesce(jsonb_agg(jsonb_build_object('id', ar.id, 'nome', ar.nome, 'regras', ar.regras, 'capacidade', ar.capacidade, 'taxa', ar.taxa,
                                                             'antecedencia_min_horas', ar.antecedencia_min_horas, 'antecedencia_max_dias', ar.antecedencia_max_dias,
                                                             'duracao_max_horas', ar.duracao_max_horas,
                                                             'ocupado', (select coalesce(jsonb_agg(jsonb_build_object('inicio', r.inicio, 'fim', r.fim) order by r.inicio), '[]'::jsonb)
                                                                           from public.cond_reservas r where r.area_id = ar.id and r.status in ('pedida','confirmada')
                                                                            and r.fim > now() and r.inicio < now() + interval '120 days'))
                                         order by ar.nome), '[]'::jsonb)
                  from public.cond_areas ar where ar.condominio_id = a.condominio_id and ar.ativa),
      'minhas', (select coalesce(jsonb_agg(jsonb_build_object('id', r.id, 'area', ar.nome, 'unidade', privado.cond_unidade_nome(r.unidade_id), 'inicio', r.inicio,
                                                              'fim', r.fim, 'status', r.status, 'taxa', r.taxa, 'resposta', r.resposta) order by r.inicio desc), '[]'::jsonb)
                   from public.cond_reservas r join public.cond_areas ar on ar.id = r.area_id
                  where r.unidade_id in (select privado.cond_unidades_da_pessoa(a)) and r.inicio > now() - interval '180 days')
    );
  end if;

  if p_secao = 'ocorrencias' then
    return jsonb_build_object(
      'unidades', (select coalesce(jsonb_agg(jsonb_build_object('id', u, 'nome', privado.cond_unidade_nome(u))), '[]'::jsonb) from privado.cond_unidades_da_pessoa(a) u),
      'lista', (select coalesce(jsonb_agg(jsonb_build_object('id', o.id, 'numero', o.numero, 'tipo', o.tipo, 'titulo', o.titulo, 'descricao', o.descricao,
                                                             'status', o.status, 'criado_em', o.created_at, 'unidade', privado.cond_unidade_nome(o.unidade_id),
                                                             'fotos', coalesce(array_length(o.fotos, 1), 0),
                                                             'respostas', (select coalesce(jsonb_agg(jsonb_build_object('autor', rs.autor, 'texto', rs.texto, 'data', rs.created_at)
                                                                                                     order by rs.created_at), '[]'::jsonb)
                                                                             from public.cond_ocorrencia_respostas rs where rs.ocorrencia_id = o.id))
                                         order by o.created_at desc), '[]'::jsonb)
                  from (select * from public.cond_ocorrencias x where x.condominio_id = a.condominio_id
                          and (x.pessoa_id = a.pessoa_id or x.unidade_id in (select privado.cond_unidades_da_pessoa(a)))
                        order by x.created_at desc limit 40) o)
    );
  end if;

  if p_secao = 'assembleias' then
    return (select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id, 'tipo', s.tipo, 'titulo', s.titulo, 'data', s.data, 'segunda_chamada', s.segunda_chamada, 'local', s.local,
        'link_online', s.link_online, 'status', s.status, 'voto_portal', s.voto_portal, 'edital', s.edital,
        'ata', case when s.status = 'encerrada' then s.ata end,
        'itens', (select coalesce(jsonb_agg(jsonb_build_object('id', it.id, 'ordem', it.ordem, 'titulo', it.titulo, 'descricao', it.descricao,
                                                               'tipo_votacao', it.tipo_votacao, 'opcoes', to_jsonb(it.opcoes),
                                                               'resultado', case when s.status = 'encerrada' then it.resultado end,
                                                               'meus_votos', (select coalesce(jsonb_agg(jsonb_build_object('unidade_id', v.unidade_id, 'opcao', v.opcao)), '[]'::jsonb)
                                                                                from public.cond_votos v where v.item_id = it.id
                                                                                 and v.unidade_id in (select privado.cond_unidades_da_pessoa(a, 'voto'))))
                                            order by it.ordem), '[]'::jsonb)
                    from public.cond_assembleia_itens it where it.assembleia_id = s.id),
        'unidades_voto', (select coalesce(jsonb_agg(jsonb_build_object('id', u, 'nome', privado.cond_unidade_nome(u))), '[]'::jsonb)
                            from privado.cond_unidades_da_pessoa(a, 'voto') u)
      ) order by s.data desc), '[]'::jsonb)
      from (select * from public.cond_assembleias x where x.condominio_id = a.condominio_id and x.status in ('convocada','em_andamento','encerrada')
             order by x.data desc limit 20) s);
  end if;

  if p_secao = 'documentos' then
    return (select coalesce(jsonb_agg(jsonb_build_object('id', d.id, 'tipo', d.tipo, 'titulo', d.titulo, 'url', d.link_portal, 'expira_em', d.link_expira_em,
                                                         'validade', d.validade) order by d.tipo, d.titulo), '[]'::jsonb)
              from public.cond_documentos d
             where d.condominio_id = a.condominio_id and d.publico_portal and d.link_portal is not null and d.link_expira_em > now());
  end if;

  if p_secao = 'contas' then
    v_mes := case when coalesce(p ->> 'mes', '') ~ '^\d{4}-\d{2}$' then ((p ->> 'mes') || '-01')::date end;
    return jsonb_build_object(
      'meses', (select coalesce(jsonb_agg(to_char(f.competencia, 'YYYY-MM') order by f.competencia desc), '[]'::jsonb)
                  from (select competencia from public.cond_fechamentos where condominio_id = a.condominio_id and status = 'fechado'
                         order by competencia desc limit 24) f),
      'balancete', (select f.resumo from public.cond_fechamentos f
                     where f.condominio_id = a.condominio_id and f.status = 'fechado'
                       and (v_mes is null or f.competencia = v_mes)
                     order by f.competencia desc limit 1)
    );
  end if;
  return null;
end;
$$;
revoke execute on function public.cond_portal_dados(uuid, text, text, jsonb) from public;
grant execute on function public.cond_portal_dados(uuid, text, text, jsonb) to anon, authenticated;

/** Confirma a leitura de um comunicado. */
create or replace function public.cond_portal_ler_comunicado(p_token uuid, p_sessao text, p_comunicado uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
begin
  a := privado.cond_validar(p_token, p_sessao);
  if p_comunicado not in (select privado.cond_comunicados_da_pessoa(a)) then raise exception 'Comunicado não encontrado.'; end if;
  insert into public.cond_comunicado_leituras (organizacao_id, condominio_id, comunicado_id, pessoa_id)
  values (a.organizacao_id, a.condominio_id, p_comunicado, a.pessoa_id)
  on conflict (comunicado_id, pessoa_id) do nothing;
end;
$$;
revoke execute on function public.cond_portal_ler_comunicado(uuid, text, uuid) from public;
grant execute on function public.cond_portal_ler_comunicado(uuid, text, uuid) to anon, authenticated;

/**
 * Pede uma reserva (a administradora confirma). Regras da área: antecedência
 * mínima e máxima e duração máxima (mesma conta de validarReserva()); sem
 * conflito de horário (gatilho).
 */
create or replace function public.cond_portal_reservar(p_token uuid, p_sessao text, p_area uuid, p_unidade uuid,
                                                       p_inicio timestamptz, p_fim timestamptz, p_obs text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
  ar public.cond_areas%rowtype;
  v_id uuid;
begin
  a := privado.cond_validar(p_token, p_sessao);
  perform privado.cond_portal_limite(a, 'reserva', 5);
  if p_unidade not in (select privado.cond_unidades_da_pessoa(a)) then raise exception 'Escolha uma unidade sua.'; end if;
  select * into ar from public.cond_areas where id = p_area and condominio_id = a.condominio_id and ativa;
  if not found then raise exception 'Área não encontrada.'; end if;
  if p_inicio is null or p_fim is null or p_fim <= p_inicio then raise exception 'O fim da reserva precisa ser depois do início.'; end if;
  if p_fim - p_inicio > make_interval(hours => ar.duracao_max_horas) then
    raise exception 'A reserva de % pode durar no máximo % hora(s).', ar.nome, ar.duracao_max_horas;
  end if;
  if p_inicio < now() + make_interval(hours => ar.antecedencia_min_horas) then
    raise exception 'Peça a reserva de % com pelo menos % hora(s) de antecedência.', ar.nome, ar.antecedencia_min_horas;
  end if;
  if p_inicio > now() + make_interval(days => ar.antecedencia_max_dias) then
    raise exception 'Reservas de % só até % dias à frente.', ar.nome, ar.antecedencia_max_dias;
  end if;
  insert into public.cond_reservas (organizacao_id, condominio_id, area_id, unidade_id, pessoa_id, inicio, fim, status, origem, observacao)
  values (a.organizacao_id, a.condominio_id, ar.id, p_unidade, a.pessoa_id, p_inicio, p_fim, 'pedida', 'portal', p_obs)
  returning id into v_id;
  perform privado.cond_portal_evento(a, 'reserva', 'Pediu reserva de ' || ar.nome || ' para '
    || to_char(p_inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));
  return v_id;
end;
$$;
revoke execute on function public.cond_portal_reservar(uuid, text, uuid, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.cond_portal_reservar(uuid, text, uuid, uuid, timestamptz, timestamptz, text) to anon, authenticated;

create or replace function public.cond_portal_cancelar_reserva(p_token uuid, p_sessao text, p_reserva uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
  r public.cond_reservas%rowtype;
begin
  a := privado.cond_validar(p_token, p_sessao);
  select * into r from public.cond_reservas where id = p_reserva and unidade_id in (select privado.cond_unidades_da_pessoa(a));
  if not found then raise exception 'Reserva não encontrada.'; end if;
  if r.status not in ('pedida','confirmada') or r.inicio <= now() then raise exception 'Esta reserva não pode mais ser cancelada pelo portal.'; end if;
  update public.cond_reservas set status = 'cancelada', resposta = 'Cancelada pelo morador no portal' where id = r.id;
  perform privado.cond_portal_evento(a, 'reserva_cancelada', 'Cancelou a reserva de ' || to_char(r.inicio at time zone 'America/Sao_Paulo', 'DD/MM/YYYY HH24:MI'));
end;
$$;
revoke execute on function public.cond_portal_cancelar_reserva(uuid, text, uuid) from public;
grant execute on function public.cond_portal_cancelar_reserva(uuid, text, uuid) to anon, authenticated;

/** Abre ocorrência pelo portal; devolve a pasta liberada (2 horas) para as fotos. */
create or replace function public.cond_portal_abrir_ocorrencia(p_token uuid, p_sessao text, p_unidade uuid, p_tipo text, p_titulo text, p_descricao text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
  v_id uuid;
  v_numero bigint;
  v_envio uuid;
begin
  a := privado.cond_validar(p_token, p_sessao);
  perform privado.cond_portal_limite(a, 'ocorrencia', 5);
  if p_unidade is not null and p_unidade not in (select privado.cond_unidades_da_pessoa(a)) then raise exception 'Escolha uma unidade sua.'; end if;
  if coalesce(p_tipo, '') not in ('manutencao','barulho','seguranca','sugestao','reclamacao','outro') then raise exception 'Tipo inválido.'; end if;
  if coalesce(btrim(p_titulo), '') = '' then raise exception 'Informe o assunto.'; end if;
  insert into public.cond_ocorrencias (organizacao_id, condominio_id, unidade_id, pessoa_id, tipo, titulo, descricao, origem)
  values (a.organizacao_id, a.condominio_id, p_unidade, a.pessoa_id, p_tipo, p_titulo, left(p_descricao, 4000), 'portal')
  returning id, numero into v_id, v_numero;
  insert into public.cond_portal_envios (organizacao_id, acesso_id, ocorrencia_id) values (a.organizacao_id, a.id, v_id) returning id into v_envio;
  perform privado.cond_portal_evento(a, 'ocorrencia', 'Abriu a ocorrência nº ' || v_numero || ': ' || left(btrim(p_titulo), 120));
  return jsonb_build_object('id', v_id, 'numero', v_numero, 'envio', v_envio, 'pasta', a.organizacao_id::text || '/portal/' || v_envio::text);
end;
$$;
revoke execute on function public.cond_portal_abrir_ocorrencia(uuid, text, uuid, text, text, text) from public;
grant execute on function public.cond_portal_abrir_ocorrencia(uuid, text, uuid, text, text, text) to anon, authenticated;

create or replace function public.cond_portal_responder_ocorrencia(p_token uuid, p_sessao text, p_ocorrencia uuid, p_texto text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
  o public.cond_ocorrencias%rowtype;
begin
  a := privado.cond_validar(p_token, p_sessao);
  perform privado.cond_portal_limite(a, 'resposta', 20);
  select * into o from public.cond_ocorrencias where id = p_ocorrencia and condominio_id = a.condominio_id
     and (pessoa_id = a.pessoa_id or unidade_id in (select privado.cond_unidades_da_pessoa(a)));
  if not found then raise exception 'Ocorrência não encontrada.'; end if;
  if o.status = 'cancelada' then raise exception 'Esta ocorrência foi encerrada.'; end if;
  insert into public.cond_ocorrencia_respostas (organizacao_id, condominio_id, ocorrencia_id, texto, pessoa_id)
  values (a.organizacao_id, a.condominio_id, o.id, p_texto, a.pessoa_id);
  perform privado.cond_portal_evento(a, 'resposta', 'Respondeu na ocorrência nº ' || o.numero);
end;
$$;
revoke execute on function public.cond_portal_responder_ocorrencia(uuid, text, uuid, text) from public;
grant execute on function public.cond_portal_responder_ocorrencia(uuid, text, uuid, text) to anon, authenticated;

/**
 * Storage (morador, logado ou não): só GRAVA em <org>/portal/<envio>/ de pasta
 * liberada há menos de 2 horas, com o link do portal ainda ativo e em vigor, e
 * até 6 arquivos — conta os arquivos que JÁ ESTÃO na pasta (não depende de o
 * morador registrar cada foto). Nunca lê.
 */
create or replace function public.cond_portal_pode_enviar(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_partes text[] := string_to_array(coalesce(p_nome, ''), '/');
  -- Só minúsculas (como o sistema gera): maiúsculas dariam outra pasta e escapariam da contagem.
  v_uuid text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_token uuid;
  v_n int := 0;
begin
  if coalesce(array_length(v_partes, 1), 0) <> 4 or v_partes[2] <> 'portal' or p_nome like '%..%' or length(p_nome) > 300
     or v_partes[1] !~ v_uuid or v_partes[3] !~ v_uuid
     or v_partes[4] !~* '^[^/]+\.(jpe?g|png|webp|heic)$' then
    return false;
  end if;
  select a.token into v_token
    from public.cond_portal_envios e join public.cond_portal_acessos a on a.id = e.acesso_id
   where e.id = v_partes[3]::uuid and e.organizacao_id = v_partes[1]::uuid and e.expira_em > now();
  -- Link ativo, dentro da validade, módulo em uso e pessoa ainda ligada ao condomínio.
  if v_token is null or (privado.cond_link(v_token)).id is null then
    return false;
  end if;
  if to_regclass('storage.objects') is not null then
    execute 'select count(*) from storage.objects where bucket_id = ''condominios'' and name like $1'
      into v_n using v_partes[1] || '/portal/' || v_partes[3] || '/%';
  end if;
  return v_n < 6;
end;
$$;
revoke execute on function public.cond_portal_pode_enviar(text) from public;
grant execute on function public.cond_portal_pode_enviar(text) to anon, authenticated;

/** Registra a foto enviada pelo portal na ocorrência (a pasta é a liberada para ela). */
create or replace function public.cond_portal_registrar_foto(p_token uuid, p_sessao text, p_envio uuid, p_path text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
  e public.cond_portal_envios%rowtype;
begin
  a := privado.cond_validar(p_token, p_sessao);
  select * into e from public.cond_portal_envios where id = p_envio and acesso_id = a.id for update;
  if not found or e.expira_em <= now() then raise exception 'O prazo para enviar fotos desta ocorrência acabou.'; end if;
  if e.arquivos >= 6 then raise exception 'No máximo 6 fotos por ocorrência.'; end if;
  if left(p_path, length(a.organizacao_id::text || '/portal/' || e.id::text || '/')) <> a.organizacao_id::text || '/portal/' || e.id::text || '/'
     or p_path like '%..%' or length(p_path) > 300 then
    raise exception 'Arquivo fora da pasta liberada.';
  end if;
  update public.cond_portal_envios set arquivos = arquivos + 1 where id = e.id;
  update public.cond_ocorrencias set fotos = array_append(fotos, p_path) where id = e.ocorrencia_id;
end;
$$;
revoke execute on function public.cond_portal_registrar_foto(uuid, text, uuid, text) from public;
grant execute on function public.cond_portal_registrar_foto(uuid, text, uuid, text) to anon, authenticated;

/** Voto pelo portal: só se a assembleia permitir, com a votação aberta, uma vez por unidade (do condômino). */
create or replace function public.cond_portal_votar(p_token uuid, p_sessao text, p_item uuid, p_unidade uuid, p_opcao text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  a public.cond_portal_acessos%rowtype;
  it public.cond_assembleia_itens%rowtype;
  s public.cond_assembleias%rowtype;
begin
  a := privado.cond_validar(p_token, p_sessao);
  perform privado.cond_portal_limite(a, 'voto', 200);
  select * into it from public.cond_assembleia_itens where id = p_item and condominio_id = a.condominio_id;
  if not found then raise exception 'Item da pauta não encontrado.'; end if;
  select * into s from public.cond_assembleias where id = it.assembleia_id;
  if not s.voto_portal then raise exception 'Esta assembleia não aceita voto pelo portal.'; end if;
  if s.status <> 'em_andamento' then raise exception 'A votação não está aberta.'; end if;
  if it.tipo_votacao = 'informativo' then raise exception 'Item informativo não tem votação.'; end if;
  if p_unidade not in (select privado.cond_unidades_da_pessoa(a, 'voto')) then raise exception 'Só o condômino (proprietário) da unidade vota.'; end if;
  if not (p_opcao = any(it.opcoes)) then raise exception 'Opção de voto inválida.'; end if;
  if privado.cond_peso_voto(s.id, p_unidade) <= 0 then raise exception 'Unidade sem fração ideal cadastrada: fale com a administradora.'; end if;
  if exists (select 1 from public.cond_votos where item_id = it.id and unidade_id = p_unidade) then
    raise exception 'Esta unidade já votou neste item.';
  end if;
  insert into public.cond_assembleia_presencas (organizacao_id, condominio_id, assembleia_id, unidade_id, pessoa_id, origem)
  values (a.organizacao_id, a.condominio_id, s.id, p_unidade, a.pessoa_id, 'portal')
  on conflict (assembleia_id, unidade_id) do nothing;
  insert into public.cond_votos (organizacao_id, condominio_id, assembleia_id, item_id, unidade_id, opcao, peso, origem, pessoa_id, registrado_por)
  values (a.organizacao_id, a.condominio_id, s.id, it.id, p_unidade, p_opcao, privado.cond_peso_voto(s.id, p_unidade), 'portal', a.pessoa_id, null);
  perform privado.cond_portal_evento(a, 'voto', 'Votou "' || p_opcao || '" no item ' || it.ordem || ' da assembleia (' || privado.cond_unidade_nome(p_unidade) || ')');
end;
$$;
revoke execute on function public.cond_portal_votar(uuid, text, uuid, uuid, text) from public;
grant execute on function public.cond_portal_votar(uuid, text, uuid, uuid, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- 10. Storage: bucket privado "condominios"
--   equipe: <org>/<condominio>/... (documentos, fotos de ocorrência, contratos);
--   portal (anônimo): só GRAVA em <org>/portal/<envio>/ liberada por função. Ninguém de fora lê.
-- -----------------------------------------------------------------------------
create or replace function privado.cond_pasta_equipe(p_nome text)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_org text := split_part(coalesce(p_nome, ''), '/', 1);
begin
  if v_org !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then return false; end if;
  return v_org::uuid in (select privado.org_ids()) and privado.cond_equipe(v_org::uuid);
end;
$$;
revoke execute on function privado.cond_pasta_equipe(text) from public, anon;
grant execute on function privado.cond_pasta_equipe(text) to authenticated;

do $$
begin
  if exists (select 1 from information_schema.schemata where schema_name = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('condominios', 'condominios', false, 26214400,
            array['application/pdf','image/jpeg','image/png','image/webp','image/heic',
                  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
    on conflict (id) do nothing;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'condominios_ler') then
      execute $p$create policy condominios_ler on storage.objects for select to authenticated
        using (bucket_id = 'condominios' and privado.cond_pasta_equipe(name))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'condominios_gravar') then
      execute $p$create policy condominios_gravar on storage.objects for insert to authenticated
        with check (bucket_id = 'condominios' and privado.cond_pasta_equipe(name))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'condominios_apagar') then
      execute $p$create policy condominios_apagar on storage.objects for delete to authenticated
        using (bucket_id = 'condominios' and privado.cond_pasta_equipe(name))$p$;
    end if;
    if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'condominios_enviar_portal') then
      execute $p$create policy condominios_enviar_portal on storage.objects for insert to anon, authenticated
        with check (bucket_id = 'condominios' and public.cond_portal_pode_enviar(name))$p$;
    end if;
  end if;
end $$;

-- =============================================================================
-- 11. Juntar cadastros repetidos (Pessoas): vínculos, síndico, fornecedores,
-- ocorrências, reservas, acordos, presenças, votos, leituras e links do portal
-- vão para o cadastro que fica. public.juntar_pessoas é recriada A PARTIR DO
-- CORPO QUE ESTÁ NO BANCO, só acrescentando a chamada antes do
-- "delete from public.pessoas where id = b.id;" (padrão da manutenção).
-- =============================================================================
create or replace function privado.condominios_juntar_pessoas(p_manter uuid, p_remover uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_org uuid;
begin
  -- Roda como dono (o módulo pode estar desligado e o "on delete cascade" apagaria os vínculos);
  -- por isso confere aqui que as duas pessoas são da conta de quem está juntando.
  select organizacao_id into v_org from public.pessoas where id = p_manter;
  if v_org is null or not exists (select 1 from public.pessoas where id = p_remover and organizacao_id = v_org)
     or (auth.uid() is not null and v_org not in (select privado.org_ids())) then
    raise exception 'Cadastros não encontrados.';
  end if;
  perform set_config('cond.juntando', 'sim', true);
  update public.cond_pessoas_unidade set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.cond_condominios set sindico_id = p_manter where sindico_id = p_remover;
  update public.cond_contratos_fornecedores set fornecedor_id = p_manter where fornecedor_id = p_remover;
  update public.cond_lancamentos set fornecedor_id = p_manter where fornecedor_id = p_remover;
  update public.cond_ocorrencias set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.cond_ocorrencia_respostas set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.cond_reservas set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.cond_acordos set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.cond_assembleia_presencas set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.cond_votos set pessoa_id = p_manter where pessoa_id = p_remover;
  -- Leitura de comunicado: uma por pessoa (fica a mais antiga).
  delete from public.cond_comunicado_leituras l where l.pessoa_id = p_remover
     and exists (select 1 from public.cond_comunicado_leituras k where k.comunicado_id = l.comunicado_id and k.pessoa_id = p_manter);
  update public.cond_comunicado_leituras set pessoa_id = p_manter where pessoa_id = p_remover;
  -- Link do portal: um ativo por pessoa e condomínio (o de quem sai é desativado se o outro já tem).
  update public.cond_portal_acessos x set ativo = false
   where x.pessoa_id = p_remover and x.ativo
     and exists (select 1 from public.cond_portal_acessos k where k.pessoa_id = p_manter and k.condominio_id = x.condominio_id and k.ativo);
  update public.cond_portal_acessos set pessoa_id = p_manter where pessoa_id = p_remover;
  update public.cond_portal_eventos set pessoa_id = p_manter where pessoa_id = p_remover;
  perform set_config('cond.juntando', '', true);
end;
$$;
revoke execute on function privado.condominios_juntar_pessoas(uuid, uuid) from public, anon;
grant execute on function privado.condominios_juntar_pessoas(uuid, uuid) to authenticated;

do $$
declare
  v_def text;
  v_novo text;
begin
  if to_regprocedure('public.juntar_pessoas(uuid, uuid)') is null then
    raise warning 'public.juntar_pessoas não existe: condomínios não entram no "juntar repetidos".';
    return;
  end if;
  v_def := pg_get_functiondef('public.juntar_pessoas(uuid, uuid)'::regprocedure);
  if v_def ilike '%privado.condominios_juntar_pessoas%' then
    return;
  end if;
  v_novo := regexp_replace(v_def,
    '(\n[ \t]*)(delete[ \t]+from[ \t]+public\.pessoas[ \t]+where[ \t]+id[ \t]*=[ \t]*b\.id[ \t]*;)',
    '\1perform privado.condominios_juntar_pessoas(a.id, b.id);\1\2', 'i');
  if v_novo = v_def then
    raise warning 'Não achei o "delete from public.pessoas where id = b.id;" em public.juntar_pessoas: inclua à mão a chamada a privado.condominios_juntar_pessoas(a.id, b.id).';
    return;
  end if;
  execute v_novo;
end $$;
