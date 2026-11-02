# Novo Aluguel

Sistema de gestão de locação de imóveis para imobiliárias: contratos, cobranças, repasses aos
proprietários, reajustes, rescisões, régua de cobrança, DIMOB e financeiro.

- **Stack:** Next.js 16 (App Router, Server Actions) · TypeScript · Tailwind CSS 4 · Supabase (Postgres + Auth + RLS)
- **Multi-imobiliária:** cada organização só enxerga os próprios dados (Row Level Security).
- **Regras de negócio** puras e testadas em `src/lib/dominio` (centavos inteiros, datas em UTC).

O que já existe e o que vem a seguir: [docs/ROADMAP.md](docs/ROADMAP.md). Análise funcional que
orientou o escopo: [docs/pesquisa-jetimob.md](docs/pesquisa-jetimob.md).

## Como rodar

1. Crie um projeto em [supabase.com](https://supabase.com) e aplique a migração:
   - pelo SQL Editor, colando `supabase/migrations/20261102000001_schema_inicial.sql`, ou
   - com a CLI: `supabase link --project-ref <ref>` e `supabase db push`.
2. Copie `.env.example` para `.env.local` e preencha URL e chave publicável.
3. Instale e rode:

```bash
npm install
```

```bash
npm run dev
```

4. Acesse http://localhost:3000, crie a conta, cadastre a imobiliária e comece por
   **Pessoas → Imóveis → Contratos → Cobranças**.

> Para testes locais, desative a confirmação de e-mail em Supabase → Authentication → Providers → Email.

## Fluxo da locação

1. **Contrato**: imóvel + locatário (+ fiador); proprietários e % vêm do imóvel.
2. **Cobranças**: "Gerar faturas do mês" cria a fatura de cada contrato ativo (aluguel pro rata
   no 1º/último mês, encargos, IRRF quando o locatário é PJ e o proprietário PF).
3. **Baixa**: ao registrar o pagamento, o sistema calcula multa e juros, lança a receita de
   taxas no financeiro e gera os **repasses** (aluguel − taxa de administração − intermediação
   no 1º mês − IRRF), rateados entre os proprietários. No repasse **garantido**, o repasse nasce
   junto com a fatura.
4. **Repasses**: marque como pagos após a transferência; o extrato anual serve de informe de rendimentos.
5. **Reajuste**: cadastre os índices mensais em *Índices econômicos*; no aniversário o contrato
   mostra o acumulado e aplica o novo valor com histórico.
6. **Rescisão**: simule multa proporcional e saldo; encerre o contrato e libere o imóvel.

## Testes

```bash
npm test
```

- `tests/dominio.test.ts` — cálculos (multa/juros, reajuste, IRRF, faturas, repasses, rescisão, régua, CPF/CNPJ, DIMOB).
- `tests/sql.test.ts` — aplica a migração num Postgres embutido (PGlite) e valida RLS entre
  imobiliárias, faturamento, liquidação, repasses e reajuste.

## Estrutura

```
src/
  app/(app)/        telas autenticadas (painel, cadastros, locação, gestão)
  app/login         acesso
  lib/dominio/      regras de negócio puras (testadas)
  lib/servicos/     orquestração: dominio + Supabase
  lib/supabase/     clientes Supabase (SSR)
  proxy.ts          renovação de sessão e proteção de rotas
supabase/migrations esquema, RLS e funções transacionais
```

## Avisos

- A tabela de IRRF (`src/lib/dominio/irrf.ts`) reflete a legislação de 2026 — confirme com a contabilidade.
- A minuta de contrato é um modelo-base; revise com assessoria jurídica.
