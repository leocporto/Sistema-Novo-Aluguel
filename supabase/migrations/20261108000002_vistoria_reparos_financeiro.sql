-- Reparos de vistoria por conta do proprietário ou da imobiliária entram no Financeiro.
--
-- Antes, só o reparo do locatário tinha destino (acerto de saída). O do
-- proprietário/imobiliária ficava só na vistoria: o custo não aparecia em
-- contas a pagar, no repasse nem no Painel. Agora, ao marcar a pendência como
-- resolvida, o sistema lança a conta a pagar ao prestador (a do proprietário é
-- descontada do repasse, como na Manutenção) e liga o lançamento à pendência.
alter table public.lancamentos
  add column if not exists vistoria_pendencia_id uuid references public.vistoria_pendencias(id) on delete set null;

-- Um lançamento valendo por pendência (cancelados não contam).
create unique index if not exists lancamentos_vistoria_pendencia_uk
  on public.lancamentos (vistoria_pendencia_id)
  where vistoria_pendencia_id is not null and status <> 'cancelado';
