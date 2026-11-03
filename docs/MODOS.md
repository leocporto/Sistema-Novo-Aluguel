# Modos de uso — o que existe em cada um

O sistema tem **dois modos**, escolhidos em **Configurações → Modo de uso**
(`organizacoes.modo`). Tudo que for criado daqui em diante **precisa** dizer em
qual modo aparece. Na dúvida: **recurso novo nasce só no modo imobiliária**, a
não ser que o Leo peça para o modo pessoal também.

| Modo | Para quem | Ideia |
|------|-----------|-------|
| **Imobiliária** (`imobiliaria`, padrão) | Quem administra imóveis de terceiros, vende e aluga | Tudo liberado: proprietários, repasses, taxas, comercial, corretores, DIMOB |
| **Imóveis pessoais** (`pessoal`) | Quem aluga os **próprios** imóveis | Só o essencial do dono: imóveis, inquilinos, contratos, aluguéis, despesas dos imóveis |

## Matriz: telas e recursos

| Tela / recurso | Imobiliária | Pessoal | Observação |
|---|:---:|:---:|---|
| Painel | ✅ completo | ✅ reduzido | Quadros comerciais somem no pessoal (ver lista abaixo) |
| Imóveis | ✅ | ✅ | No pessoal não pede proprietário (o dono é a própria conta) |
| Contratos | ✅ | ✅ | No pessoal: sem taxa de administração/intermediação e sem repasse; no contrato impresso a conta é o LOCADOR |
| Aluguéis do mês (baixa) | ✅ | ✅ | No pessoal o aluguel inteiro entra como receita no Financeiro |
| **Repasses** (e extrato) | ✅ | ❌ | `/repasses` redireciona para `/` no pessoal |
| **Comercial**: Leads, Visitas, Propostas, Tarefas, Metas | ✅ | ❌ | `/comercial/*` — o `comercial/layout.tsx` redireciona para `/` no pessoal |
| Comissões de corretor | ✅ | ❌ | Nascem ao aceitar proposta |
| Papel **Corretor** em Pessoas | ✅ | ❌ | Escondido no cadastro e no filtro (a não ser que a pessoa já tenha) |
| **Despesas** | ✅ escritório | ✅ imóveis | Mesma tela `/despesas`, conteúdo muda: imobiliária = despesas do **escritório**; pessoal = despesas **dos imóveis** (imóvel obrigatório, filtro por imóvel) |
| Financeiro | ✅ | ✅ | Card de repasses só na imobiliária |
| Pessoas | ✅ | ✅ | No pessoal some o vínculo "imóveis como proprietário" e o imposto do proprietário |
| Imposto do proprietário (PF/PJ) | ✅ | ❌ | Configurações e cadastro da pessoa |
| Relatórios: DIMOB e informe de rendimentos | ✅ | ❌ | |
| Inadimplência (régua, WhatsApp) | ✅ | ✅ | |
| Reajustes, Chaves, Índices | ✅ | ✅ | |
| Configurações | ✅ | ✅ | No pessoal somem CRECI, taxas e imposto (valores ficam guardados em campos escondidos) |

### Quadros do Painel só da imobiliária
`disp_venda`, `captados`, `leads_mes`, `leads_aguardando`, `visitas`, `propostas`,
`repasses`, `comissoes`, `metas` — lista em `QUADROS_SO_IMOBILIARIA`.
No pessoal, as Notificações também não trazem tarefas, leads nem visitas.

## Onde a regra mora no código (mude num lugar só)
- `src/lib/modos.ts` — **fonte da verdade**:
  - `ROTAS_SO_IMOBILIARIA` + `rotaPermitida(caminho, modo)` → menu (topo e lateral) e bloqueio de rota;
  - `QUADROS_SO_IMOBILIARIA` + `quadroPermitido(id, modo)` → Painel;
  - `PAPEIS_SO_IMOBILIARIA` → papéis de Pessoas.
- `ehPessoal(organizacao)` em `src/lib/tipos.ts` — atalho para condicionais na tela.
- Server actions que dependem do modo leem `organizacao.modo` do `obterContexto()`
  (ex.: `liquidarFatura` no pessoal não gera repasse nem taxa).

## Checklist para recurso novo
1. Decida o modo (padrão: **só imobiliária**).
2. Tela nova só da imobiliária → acrescente a rota em `ROTAS_SO_IMOBILIARIA` **e** bloqueie no
   servidor (layout ou `redirect("/")` na página).
3. Quadro novo no Painel só da imobiliária → acrescente o id em `QUADROS_SO_IMOBILIARIA`.
4. Campo que some no pessoal → mantenha o valor num `<input type="hidden">` para não apagar
   ao salvar (padrão já usado em Configurações e Contratos).
5. Atualize esta tabela.
