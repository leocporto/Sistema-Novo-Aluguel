-- =============================================================================
-- Um imóvel não pode ter dois contratos ATIVOS no mesmo período.
-- (Renovação que começa depois do fim do atual continua permitida.)
-- Só vale para gravações novas: casos antigos não são apagados.
-- =============================================================================
create or replace function public.checar_contrato_unico()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  outro record;
begin
  if new.status <> 'ativo' then
    return new;
  end if;
  select c.numero, c.data_inicio, coalesce(c.data_rescisao, c.data_fim) as fim
    into outro
    from public.contratos c
   where c.imovel_id = new.imovel_id
     and c.id <> new.id
     and c.status = 'ativo'
     and c.data_inicio <= coalesce(new.data_rescisao, new.data_fim)
     and coalesce(c.data_rescisao, c.data_fim) >= new.data_inicio
   limit 1;
  if found then
    raise exception 'Este imóvel já tem o contrato ativo #% (de % a %). Encerre ou exclua esse contrato antes, ou comece o novo depois do fim dele.',
      outro.numero, to_char(outro.data_inicio, 'DD/MM/YYYY'), to_char(outro.fim, 'DD/MM/YYYY')
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists contratos_unico_trg on public.contratos;
create trigger contratos_unico_trg
  before insert or update of status, imovel_id, data_inicio, data_fim, data_rescisao on public.contratos
  for each row execute function public.checar_contrato_unico();
