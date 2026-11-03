-- Despesa paga pela imobiliária em nome do proprietário (ex.: conserto de
-- responsabilidade do dono) que deve ser DESCONTADA do próximo repasse dele.
-- Base compartilhada para "despesas autorizadas" (repasses) e "lançamento
-- automático da manutenção". repasse_id = em qual repasse foi descontada.
alter table public.lancamentos
  add column if not exists descontar_repasse boolean not null default false,
  add column if not exists repasse_id uuid references public.repasses(id) on delete set null;
create index if not exists lancamentos_descontar_repasse_idx on public.lancamentos (imovel_id)
  where descontar_repasse and repasse_id is null;
