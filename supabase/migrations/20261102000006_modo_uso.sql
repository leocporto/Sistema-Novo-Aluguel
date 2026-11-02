-- =============================================================================
-- Modo de uso da conta:
--   imobiliaria → administra imóveis de terceiros (taxa de administração,
--                 repasses aos proprietários, DIMOB)
--   pessoal     → imóveis próprios (sem taxa de administração e sem repasses;
--                 o aluguel recebido entra direto no financeiro)
-- =============================================================================

alter table public.organizacoes
  add column if not exists modo text not null default 'imobiliaria'
  check (modo in ('imobiliaria', 'pessoal'));
