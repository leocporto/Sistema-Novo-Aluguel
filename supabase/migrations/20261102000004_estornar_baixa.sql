-- =============================================================================
-- Desfazer a baixa de uma fatura (check "pago" desmarcado por engano).
-- Volta a fatura para "aberta" e apaga o que a baixa gerou: multa/juros,
-- repasses pendentes (exceto repasse garantido, que nasce com a fatura) e a
-- receita de taxas no financeiro. Recusa se o proprietário já foi pago.
-- SECURITY INVOKER: a RLS continua valendo.
-- =============================================================================

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
     set status = 'aberta', pago_em = null, valor_pago = null, forma_pagamento = null
   where id = f.id;
end;
$$;

revoke execute on function public.estornar_baixa(uuid) from public, anon;
grant execute on function public.estornar_baixa(uuid) to authenticated;
