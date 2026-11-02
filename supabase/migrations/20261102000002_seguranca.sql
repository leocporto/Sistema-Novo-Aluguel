-- =============================================================================
-- Endurecimento de segurança (alertas do Supabase Database Linter)
-- =============================================================================

-- Funções auxiliares de RLS saem do schema exposto pela API (public) para um
-- schema privado. Políticas e defaults referenciam as funções pelo OID, então
-- continuam funcionando após a mudança de schema.
create schema if not exists privado;
revoke all on schema privado from public, anon;
grant usage on schema privado to authenticated;

alter function public.org_ids() set schema privado;
alter function public.org_atual() set schema privado;

revoke execute on function privado.org_ids() from public, anon;
revoke execute on function privado.org_atual() from public, anon;
grant execute on function privado.org_ids() to authenticated;
grant execute on function privado.org_atual() to authenticated;

-- A macro usada só durante a criação do esquema não é mais necessária.
drop function if exists public._habilitar_rls_org(text);
