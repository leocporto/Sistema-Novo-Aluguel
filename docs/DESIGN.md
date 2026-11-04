# Design — regras do sistema

O Novo Aluguel usa o mesmo sistema visual do **Gueco** (tema "Shapefy"). Esta é a referência
para qualquer tela nova. Tokens em `src/app/globals.css`; componentes em `src/components/ui.tsx`.

## Tema
- **Claro é o padrão para todo mundo.** O escuro vale só para quem clicar no sol/lua
  (`BotaoTema`, em `src/components/menu-lateral.tsx`), e só essa escolha é gravada
  (`localStorage` → `novoaluguel_tema`; atributo `data-tema="escuro"` no `<html>`, aplicado
  antes da pintura por `SCRIPT_TEMA` em `src/lib/tema.ts`).
- **Nunca use cor fixa** (`#fff`, `bg-white`, `text-slate-500`, `emerald-*`…). Use os tokens,
  que trocam sozinhos com o tema. Impressão sai sempre no claro.

## Tokens (classes do Tailwind)
| Uso | Classe | Claro | Escuro |
|---|---|---|---|
| Fundo da página | `bg-app` | #f4f6f9 | #0d1117 |
| Menu lateral | `bg-sidebar` | #ffffff | #0a0d12 |
| Cartão | `bg-card` / `hover:bg-card-hover` | #ffffff / #f0f3f7 | #11161d / #161c25 |
| Cabeçalho de tabela, áreas rebaixadas | `bg-elev` | #f7f9fb | #0f141a |
| Campo de formulário | `bg-input` | #f1f4f8 | #0d1117 |
| Bordas | `border-borda`, `border-borda-forte`, `border-borda-suave` | | |
| Texto | `text-texto`, `text-texto-2`, `text-mudo`, `text-fraco` | #1a2230 … | #e6edf3 … |
| Destaque (links, botão principal, item ativo) | `text-acento`, `bg-acento`, `text-acento-hot`, `bg-acento-bg`, `border-acento-bd` | #2563eb | #3b82f6 |
| Sucesso / alerta / erro | `ok`, `alerta`, `ruim` (+ `-bg`, `-bd`) | | |

## Tipografia
- **Outfit** em todo o sistema (`font-sans`).
- **Spline Sans Mono** (`font-mono`) **só** em rótulos pequenos: cabeçalho de tabela, rótulo de
  campo, grupos do menu e selos. Nada de título em mono/caixa alta.

## Estrutura de tela
- Toda tela abre com `<Cabecalho>`: trilha "Novo Aluguel › Tela", título grande
  (28–38px, peso 600), subtítulo e ações à direita.
- Cartões (`<Cartao>`): raio **18px**, borda `border-borda`, título 15px peso 600, sem caixa alta.
- KPI (`<Indicador>`): **ícone 32px** (lucide) num quadrado à esquerda do rótulo (13px), número
  grande peso 600, detalhe 12px. Tons: `neutro`, `alerta`, `perigo`, `sucesso`.
- Tabelas (`<Tabela>`/`<Celula>`): cartão de raio 18, cabeçalho mono 10,5px caixa alta sobre
  `bg-elev`, linhas com 14px e hover suave.
- Selos (`<Selo>`): pílula mono 10,5px; cores `azul`, `verde`, `amarelo`, `vermelho`, `cinza`.

## Controles
- **Botões: 40px de altura, raio 11, 13,5px semibold** (`classeBotao`, `<BotaoLink>`,
  `<BotaoEnviar>`). Variantes: `primario` (acento), `secundario` (cartão com borda), `perigo`,
  `fantasma`. Botões lado a lado usam a mesma classe — nunca padding inline diferente.
- **Tudo que fica lado a lado tem a altura do botão (40px)**: busca e seleção em barra de
  filtros (`<FiltroAutomatico>` aplica a classe `barra-filtros`).
- Campos de formulário (com rótulo em cima): **46px**, `bg-input`, borda forte, raio 11, foco
  com borda de acento e anel suave.
- `<select>` sempre sem a seta nativa, com a seta do sistema (definida no `globals.css`).
- Filtros de lista se aplicam sozinhos (sem botão "Filtrar").
- **Pílulas de filtro e busca na mesma linha**: `<div className="mb-4 flex flex-wrap items-center gap-3">` com `<PilulasLink>` e `<FiltroAutomatico className="filtros-linha">` dentro (sem `mb-4` nos dois). Busca e seletores ficam SEMPRE juntos, numa linha só (nunca um campo desce sozinho): em tela larga dividem o espaço ao lado das pílulas; em tela estreita o grupo inteiro desce, ainda lado a lado (`.filtros-linha` no `globals.css`).

## Casca do sistema (`src/components/casca-app.tsx`)
- **Barra do topo (76px)**: ☰ (só em telas < 1024px), marca (quadrado azul em gradiente +
  "Novo Aluguel" + nome da imobiliária), relógio (≥ 1280px), **navegação principal só com nomes**
  (Painel, Imóveis, Pessoas, Contratos, Aluguéis, Repasses) em pílula, sininho (avisos de
  cobrança), **atalhos de ícone Equipe e Configurações** (`ATALHOS`; acesos na própria tela; no
  celular vão para o fim do menu), sol/lua e cartão do usuário (avatar, nome/e-mail ≥ 1367px, Sair).
- **Menu lateral**: recolhido em **69px só com ícones**; ao passar o mouse abre para **236px
  empurrando o conteúdo**, com rótulos e grupos entrando em fade + 6px. Em telas < 1024px vira
  gaveta (260px) aberta pelo ☰, com fundo desfocado, e recebe também os itens do topo.
- **Uma seleção só no app**: se a tela é do topo, a pílula do menu some (encolhe até um ponto),
  e vice-versa.
- **Menu lateral na ordem da operação**: Locação (Análise cadastral → Chaves → Vistorias →
  Cobranças → Reajustes e índices → Manutenção), Atendimento (Agenda, Documentos, Portal de
  clientes), Comercial (Leads e propostas, Captação, Vendas, Empreendimentos, Comissões, Meu portal),
  Divulgação (Site e portais, Marketing) e Gestão (Financeiro, Despesas, Relatórios e DIMOB).
- **Não duplique**: o que já é aba de uma tela não vira item de menu (Propostas/Tarefas/Metas são
  abas de Leads; Índices é aba de Reajustes; Aprovações é aba de Equipe e só aparece no menu para
  quem não vê a Equipe — `seNaoVer`). Tela fora do menu que pertence a um item: `PERTENCE_A`.
- Item novo de navegação: acrescentar em `TOPO` ou `LATERAL` no `casca-app.tsx`.

## Movimento (`src/lib/movimento`, `src/components/abas-segmentadas.tsx`)
- **`<AbasSegmentadas>`**: todo grupo de seleção única. A pílula azul é uma camada recortada por
  `clip-path` (frente 220ms, trás 340ms) e há uma pílula de hover neutra por baixo. Variantes
  `nav` (topo), `lateral` (menu) e `seg` (filtros).
  - ⚠️ **Nunca** faça seletor com `<Link>`/botões soltos e `bg-acento` no ativo. Use:
    - escolha que muda a URL (funil, período, filtro, lista/cartões): **`<PilulasLink>`**
      (`src/components/pilulas-link.tsx`);
    - abas entre telas irmãs: **`<SubAbas>`**;
    - escolha só na tela (sem URL): `<AbasSegmentadas variante="seg">` direto.
- **Botões**: sempre `classeBotao`/`BotaoLink`/`BotaoEnviar`/`BotaoExcluir` (sobem 1px no hover e
  afundam no clique). Botão de ícone novo segue o `BotaoExcluir`: `size-8`, raio 9, borda,
  `hover:-translate-y-px active:scale-90`.
- **`<Contador>`**: todo número grande de KPI conta até o valor (0,85s ao abrir, 0,55s ao mudar);
  formatos `moeda`, `inteiro`, `pct`.
- **Entrada de toda tela**: a cada troca de rota os blocos da tela sobem em cascata (`.tela`);
  grades de KPI usam `entrar-cascata`.
- **Troca de aba (`<SubAbas>`)** não parece tela nova: a pílula anda no clique, o cabeçalho e as abas
  ficam parados e só o conteúdo desliza para o lado da aba escolhida (`data-entrada="aba"`).
  Enquanto o servidor prepara a próxima tela, a atual fica na frente com o conteúdo esmaecido e uma
  linha azul corre no pé da barra do topo. Tudo passa por `useNavegacao()` (`src/lib/navegacao.tsx`);
  navegação de menu, abas e pílulas **não** usa `router.push` direto. Telas abertas há menos de 30s
  voltam na hora (`staleTimes.dynamic` no `next.config.ts`; toda action já chama `revalidatePath`).
- **Janelas (modais)**: abrem por **portal no `<body>`** (`createPortal`), camada escura
  desfocada com a classe `janela-fundo` e a janela (`.janela`) como primeiro filho; animam ao
  abrir e ao fechar (`useMovimentoJanelas`, ligado na casca).
- Nada que responde a clique ou hover passa de 340ms; `prefers-reduced-motion` desliga tudo.

## Formatos
- Moeda em BRL (`R$ 1.234,56`), datas `dd/mm/aaaa`, competência `mm/aaaa`.
