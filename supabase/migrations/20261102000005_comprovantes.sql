-- =============================================================================
-- Comprovante de pagamento do aluguel (imagem ou PDF anexado na baixa).
-- Arquivos no Storage, bucket privado "comprovantes", na pasta da organização:
--   <organizacao_id>/faturas/<fatura_id>/<arquivo>
-- Só membros da organização leem/gravam/apagam (RLS em storage.objects).
-- =============================================================================

alter table public.faturas add column if not exists comprovante_path text;

-- Desfazer a baixa também solta o comprovante.
create or replace function public.estornar_baixa(p_fatura_id uuid)
returns void
language plpgsql security invoker set search_path = ''
as $$
declare
  f public.faturas%rowtype;
  v_garantido boolean;
begin
  select * into f from public.faturas where id = p_fatura_id for update;
  if not found then
    raise exception 'Fatura não encontrada';
  end if;
  if f.status <> 'paga' then
    raise exception 'Esta fatura não está paga';
  end if;
  if exists (select 1 from public.repasses where fatura_id = f.id and status = 'pago') then
    raise exception 'O repasse ao proprietário já foi pago. Desfaça o repasse antes de desfazer o pagamento.';
  end if;

  select (tipo_repasse = 'garantido') into v_garantido from public.contratos where id = f.contrato_id;

  if not coalesce(v_garantido, false) then
    delete from public.repasses where fatura_id = f.id and status = 'pendente';
  end if;
  delete from public.fatura_itens where fatura_id = f.id and tipo in ('multa', 'juros');
  delete from public.lancamentos where fatura_id = f.id and tipo = 'receber';

  update public.faturas
     set status = 'aberta', pago_em = null, valor_pago = null, forma_pagamento = null, comprovante_path = null
   where id = f.id;
end;
$$;

-- Storage (só existe no Supabase; ignorado em bancos de teste sem o schema storage).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('comprovantes', 'comprovantes', false, 10485760,
            array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'application/pdf'])
    on conflict (id) do update
      set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

    execute 'drop policy if exists comprovantes_ler on storage.objects';
    execute 'drop policy if exists comprovantes_gravar on storage.objects';
    execute 'drop policy if exists comprovantes_apagar on storage.objects';
    execute $p$create policy comprovantes_ler on storage.objects for select to authenticated
      using (bucket_id = 'comprovantes' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
    execute $p$create policy comprovantes_gravar on storage.objects for insert to authenticated
      with check (bucket_id = 'comprovantes' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
    execute $p$create policy comprovantes_apagar on storage.objects for delete to authenticated
      using (bucket_id = 'comprovantes' and (storage.foldername(name))[1] in (select privado.org_ids()::text))$p$;
  end if;
end $$;
