# CLAUDE.md — Novo Aluguel

Sistema de administração de aluguéis do Leo (Next.js 16 + Supabase + Tailwind 4).
Leia também `AGENTS.md` (regras do Next.js desta versão) e `docs/DESIGN.md` (visual).

## Como trabalhar com o dono
- O Leo **não é programador**: responda sempre em **português do Brasil**, simples e direto.
- Seja decisivo: execute e depois explique o que mudou e como testar.
- Sempre rode antes de commitar: `npx tsc --noEmit`, `npx eslint src`, `npm test` e `npx next build`.
- Desenvolva e faça push só no branch combinado da sessão; depois publique na Vercel.

## ⚠️ Modos de uso — decore
O sistema tem **modo imobiliária** e **modo imóveis pessoais**. A tabela completa do que
existe em cada um está em **`docs/MODOS.md`** — consulte antes de criar ou mudar qualquer tela.
- **Recurso novo nasce só no modo imobiliária**, a não ser que o Leo diga o contrário.
- Só da imobiliária: Repasses, **Comercial** (leads, visitas, propostas, tarefas, metas), **Captação de imóveis** (`/captacao`), **Vendas** (`/vendas`),
  comissões, papel Corretor, taxa de administração/intermediação, imposto do proprietário, DIMOB,
  **Empreendimentos**, e no imóvel: proprietários, aba Comercialização (corretor, exclusividade,
  autorização, similares), anúncios em portais e visitas; em Pessoas: papéis Comprador, Investidor,
  Corretor, Parceiro e a aba Interesse.
- Nos dois modos (cadastro do imóvel): fotos/plantas/vídeo/tour, documentos, mapa, áreas, comodidades,
  encargos, histórico de preços, duplicar, edição em massa, importação Excel/CSV, aviso de repetidos.
- Nos dois modos (pessoas): documentos, relacionamento/anotações, contatos vinculados, comunicação (LGPD),
  alertas de documentação, Prestador de serviço, importar/exportar/juntar repetidos.
- **Despesas** existe nos dois, mas muda: imobiliária = escritório; pessoal = despesas dos imóveis.
- **Agenda e Chaves** existem nos dois (`/agenda`, `/chaves`); no pessoal sem corretor/lead/avaliação de captação.
- Regra no código: `src/lib/modos.ts` (`rotaPermitida`, `quadroPermitido`, `PAPEIS_SO_IMOBILIARIA`).
  Tela só da imobiliária também precisa ser bloqueada no servidor (layout/página com `redirect("/")`).

## Banco
- Migrações em `supabase/migrations/` (aplicadas no projeto Supabase "Sistema B").
- RLS por organização via `privado.org_ids()`; tabelas novas: `organizacao_id default privado.org_atual()`.
- `tests/sql.test.ts` roda todas as migrações num Postgres embutido (PGlite).

## Rotas públicas (sem login)
- `/login`, `/l/[token]` (formulário de captação de leads), `/api/leads/[token]` (API de leads) e `/api/agenda/[token]` (calendário .ics assinável) — lista em `ROTAS_PUBLICAS` de `src/proxy.ts`.
- Escrita pública só por RPC `SECURITY DEFINER` validando o token (`receber_lead`), usando `clienteAnonimo()`.

## ⚠️ Padrões visuais — siga sempre (docs/DESIGN.md)
- Grupo de escolha única = pílula animada: `<PilulasLink>` (muda a URL), `<SubAbas>` (telas irmãs) ou
  `<AbasSegmentadas>` (só na tela). **Nunca** links/botões soltos com `bg-acento` no ativo.
- Botões só com `classeBotao`/`BotaoLink`/`BotaoEnviar`/`BotaoExcluir` (animação de hover e clique).
- Números de KPI com `<Contador>`; grades com `entrar-cascata`; janelas por portal com `janela-fundo`.

## Telas e edição
- Edição salva sozinha (`<Formulario automatico>`); criação usa botão "Cadastrar" (`JanelaCadastro`).
- Linhas de lista clicáveis (`LinhaLink`); janelas sempre em portal com fundo desfocado.
