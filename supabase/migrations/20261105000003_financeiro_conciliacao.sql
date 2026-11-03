-- Conciliação também com aluguéis recebidos (faturas) e repasses pagos:
-- assim o saldo da conta bate com o extrato do banco.
alter table public.faturas
  add column if not exists conta_id uuid references public.contas_financeiras(id) on delete set null,
  add column if not exists conciliado_em timestamptz;
alter table public.repasses
  add column if not exists conta_id uuid references public.contas_financeiras(id) on delete set null,
  add column if not exists conciliado_em timestamptz;
alter table public.extrato_itens
  add column if not exists fatura_id uuid references public.faturas(id) on delete set null,
  add column if not exists repasse_id uuid references public.repasses(id) on delete set null;
create index if not exists faturas_conta_idx on public.faturas (conta_id) where conta_id is not null;
create index if not exists repasses_conta_idx on public.repasses (conta_id) where conta_id is not null;

-- Alíquota de ISS padrão da imobiliária (para as notas de serviço).
alter table public.organizacoes add column if not exists aliquota_iss numeric(6,3) not null default 0;
