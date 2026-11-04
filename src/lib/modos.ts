/**
 * Regras do modo de uso (ver docs/MODOS.md).
 * - "imobiliaria": administra imóveis de terceiros e vende/aluga (tudo liberado).
 * - "pessoal": a pessoa aluga os PRÓPRIOS imóveis — sem repasse, sem taxa de
 *   administração e sem a parte comercial (leads, visitas, propostas, tarefas, metas,
 *   comissões, corretores).
 */
export type ModoUso = "imobiliaria" | "pessoal";

/** Telas que só existem no modo imobiliária (e tudo abaixo delas). */
export const ROTAS_SO_IMOBILIARIA = ["/repasses", "/comercial", "/captacao", "/vendas", "/empreendimentos", "/comissoes", "/site", "/marketing", "/corretor", "/equipe"] as const;

/** Partes de telas compartilhadas que só existem na imobiliária (ex.: aba Comercialização do imóvel). */
const SUBROTAS_SO_IMOBILIARIA = [
  /^\/imoveis\/[^/]+\/comercializacao(\/|$)/,
  /^\/pessoas\/[^/]+\/interesse(\/|$)/,
  /^\/financeiro\/(proprietarios|notas)(\/|$)/,
  /^\/portais\/informes(\/|$)/,
  /^\/relatorios\/(comercial|equipe|obrigacoes|dimob)(\/|$)/,
];

/** A rota pode ser aberta neste modo? */
export function rotaPermitida(caminho: string, modo: ModoUso | null | undefined): boolean {
  if (modo !== "pessoal") return true;
  if (SUBROTAS_SO_IMOBILIARIA.some((re) => re.test(caminho))) return false;
  return !ROTAS_SO_IMOBILIARIA.some((r) => caminho === r || caminho.startsWith(`${r}/`));
}

/** Papéis de pessoa que só fazem sentido no modo imobiliária. */
export const PAPEIS_SO_IMOBILIARIA = ["corretor", "comprador", "investidor", "parceiro"] as const;

/** Quadros do Painel que só aparecem no modo imobiliária. */
export const QUADROS_SO_IMOBILIARIA = [
  "disp_venda",
  "captados",
  "leads_mes",
  "leads_aguardando",
  "propostas",
  "repasses",
  "comissoes",
  "metas",
  "site_contatos",
  "portais_falhas",
  "mkt_conversas",
  "mkt_fila",
  "equipe_creci",
  "equipe_documentos",
  "equipe_aprovacoes",
  "equipe_tarefas",
  "equipe_mensagens",
  "equipe_avisos",
] as const;

export function quadroPermitido(id: string, modo: ModoUso | null | undefined): boolean {
  return modo !== "pessoal" || !(QUADROS_SO_IMOBILIARIA as readonly string[]).includes(id);
}
