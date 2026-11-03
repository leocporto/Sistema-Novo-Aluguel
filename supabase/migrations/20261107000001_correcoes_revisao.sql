-- =============================================================================
-- Correções da revisão das etapas 14–17 (aplicadas depois de publicadas).
-- Sem DROP: policies são neutralizadas com ALTER POLICY.
-- =============================================================================

-- Manutenção: o anônimo (locatário pelo link) só ENVIA fotos; ler de volta não é
-- necessário e a policy de leitura deixava listar/baixar as fotos recentes de
-- todas as organizações só com a chave anon pública.
do $$
begin
  if exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'manutencao_ler_link') then
    execute 'alter policy manutencao_ler_link on storage.objects using (false)';
  end if;
end $$;
