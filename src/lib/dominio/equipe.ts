/**
 * Regras puras da gestão de equipe (só no modo imobiliária): módulos e
 * operações dos perfis de acesso (espelho de privado.modulos_equipe e
 * privado.permissoes_padrao — mude os dois juntos), mapa rota → módulo,
 * CRECI e documentos com validade, metas individuais/coletivas, produtividade,
 * distribuição por rodízio, aprovações, tarefas internas, onboarding e os
 * rótulos da trilha de auditoria.
 * Dinheiro em centavos por dentro (dinheiro.ts); datas ISO (datas.ts).
 */
import { diasEntre, somarDias, type DataISO } from "./datas";

// ---------------------------------------------------------------------------
// Papéis
// ---------------------------------------------------------------------------

export const PAPEIS_USUARIO = ["admin", "gestor", "financeiro", "corretor"] as const;
export type PapelUsuario = (typeof PAPEIS_USUARIO)[number];
export const ROTULO_PAPEL_USUARIO: Record<string, string> = {
  admin: "Administrador",
  gestor: "Gestor",
  financeiro: "Financeiro",
  corretor: "Corretor",
};
export const DICA_PAPEL_USUARIO: Record<string, string> = {
  admin: "Tudo, inclusive perfis de acesso e usuários.",
  gestor: "Tudo do dia a dia: aprova, redistribui e acompanha a equipe.",
  financeiro: "Financeiro, aluguéis, cobranças, repasses e comissões.",
  corretor: "Leads, captação, vendas, agenda e atendimento.",
};
export const COR_PAPEL_USUARIO = { admin: "azul", gestor: "verde", financeiro: "amarelo", corretor: "cinza" } as const;

// ---------------------------------------------------------------------------
// Módulos × operações (perfis de acesso)
// ---------------------------------------------------------------------------

export const OPERACOES = ["ver", "criar", "editar", "excluir", "aprovar"] as const;
export type Operacao = (typeof OPERACOES)[number];
export const ROTULO_OPERACAO: Record<Operacao, string> = { ver: "Ver", criar: "Criar", editar: "Editar", excluir: "Excluir", aprovar: "Aprovar" };

export type Modulo =
  | "painel"
  | "imoveis"
  | "pessoas"
  | "contratos"
  | "faturas"
  | "cobrancas"
  | "repasses"
  | "financeiro"
  | "comissoes"
  | "comercial"
  | "captacao"
  | "vendas"
  | "site"
  | "marketing"
  | "agenda"
  | "vistorias"
  | "manutencao"
  | "analise"
  | "documentos"
  | "relatorios"
  | "equipe"
  | "aprovacoes"
  | "auditoria"
  | "configuracoes";

type DefModulo = { id: Modulo; rotulo: string; grupo: string; rotas: string[]; operacoes: readonly Operacao[] };

const T5 = OPERACOES;
const T4 = ["ver", "criar", "editar", "excluir"] as const;

/** Lista de módulos (mesma ordem e operações de privado.modulos_equipe no banco). */
export const MODULOS: readonly DefModulo[] = [
  { id: "painel", rotulo: "Painel", grupo: "Geral", rotas: ["/"], operacoes: ["ver"] },
  { id: "imoveis", rotulo: "Imóveis e empreendimentos", grupo: "Cadastros", rotas: ["/imoveis", "/empreendimentos"], operacoes: T4 },
  { id: "pessoas", rotulo: "Pessoas", grupo: "Cadastros", rotas: ["/pessoas"], operacoes: T4 },
  { id: "documentos", rotulo: "Documentos", grupo: "Cadastros", rotas: ["/documentos"], operacoes: T5 },
  { id: "contratos", rotulo: "Contratos, reajustes e índices", grupo: "Locação", rotas: ["/contratos", "/reajustes", "/indices"], operacoes: T5 },
  { id: "faturas", rotulo: "Aluguéis do mês", grupo: "Locação", rotas: ["/faturas"], operacoes: T4 },
  { id: "cobrancas", rotulo: "Cobranças", grupo: "Locação", rotas: ["/cobrancas", "/regua"], operacoes: T5 },
  { id: "analise", rotulo: "Análise cadastral", grupo: "Locação", rotas: ["/analise"], operacoes: T5 },
  { id: "vistorias", rotulo: "Vistorias", grupo: "Locação", rotas: ["/vistorias"], operacoes: T5 },
  { id: "manutencao", rotulo: "Manutenção", grupo: "Locação", rotas: ["/manutencao"], operacoes: T5 },
  { id: "agenda", rotulo: "Agenda e chaves", grupo: "Agenda", rotas: ["/agenda", "/chaves"], operacoes: T4 },
  { id: "comercial", rotulo: "Leads, propostas e tarefas comerciais", grupo: "Comercial", rotas: ["/comercial"], operacoes: T4 },
  { id: "captacao", rotulo: "Captação de imóveis", grupo: "Comercial", rotas: ["/captacao"], operacoes: T4 },
  { id: "vendas", rotulo: "Vendas", grupo: "Comercial", rotas: ["/vendas"], operacoes: T5 },
  { id: "comissoes", rotulo: "Comissões", grupo: "Comercial", rotas: ["/comissoes"], operacoes: T5 },
  { id: "site", rotulo: "Site e portais", grupo: "Comercial", rotas: ["/site"], operacoes: T4 },
  { id: "marketing", rotulo: "Marketing", grupo: "Comercial", rotas: ["/marketing"], operacoes: T4 },
  { id: "repasses", rotulo: "Repasses", grupo: "Gestão", rotas: ["/repasses"], operacoes: T5 },
  { id: "financeiro", rotulo: "Financeiro e despesas", grupo: "Gestão", rotas: ["/financeiro", "/despesas"], operacoes: T5 },
  { id: "relatorios", rotulo: "Relatórios e DIMOB", grupo: "Gestão", rotas: ["/relatorios"], operacoes: ["ver"] },
  { id: "equipe", rotulo: "Equipe (colaboradores, metas, tarefas, comunicação)", grupo: "Gestão", rotas: ["/equipe"], operacoes: T4 },
  { id: "aprovacoes", rotulo: "Aprovações", grupo: "Gestão", rotas: ["/equipe/aprovacoes"], operacoes: ["ver", "criar", "editar", "aprovar"] },
  { id: "auditoria", rotulo: "Histórico de ações dos usuários", grupo: "Gestão", rotas: ["/equipe/historico"], operacoes: ["ver"] },
  { id: "configuracoes", rotulo: "Configurações", grupo: "Gestão", rotas: ["/configuracoes"], operacoes: ["ver", "editar"] },
];

export const ROTULO_MODULO: Record<string, string> = Object.fromEntries(MODULOS.map((m) => [m.id, m.rotulo]));

export type Permissoes = Partial<Record<Modulo, Operacao[]>>;

/** Tudo liberado (administrador). */
export function permissoesTotais(): Record<Modulo, Operacao[]> {
  return Object.fromEntries(MODULOS.map((m) => [m.id, [...m.operacoes]])) as Record<Modulo, Operacao[]>;
}

/**
 * Deixa as permissões no formato do banco: só módulos e operações conhecidos,
 * na ordem da lista, e "ver" entra sozinho quando o módulo tem qualquer outra
 * operação (não dá para editar o que não se vê). Mesma conta de
 * privado.normalizar_permissoes.
 */
export function normalizarPermissoes(p: unknown): Record<Modulo, Operacao[]> {
  const fonte = (p && typeof p === "object" ? p : {}) as Record<string, unknown>;
  const out = {} as Record<Modulo, Operacao[]>;
  for (const m of MODULOS) {
    const v = fonte[m.id];
    const lista = Array.isArray(v) ? v.map(String) : [];
    const validas = lista.filter((o) => (m.operacoes as readonly string[]).includes(o));
    out[m.id] = m.operacoes.filter((o) => lista.includes(o) || (o === "ver" && validas.length > 0));
  }
  return out;
}

const todosVer = (): Record<Modulo, Operacao[]> =>
  Object.fromEntries(MODULOS.map((m) => [m.id, m.id === "auditoria" ? [] : (["ver"] as Operacao[])])) as Record<Modulo, Operacao[]>;

/**
 * Permissões padrão de cada papel (o papel continua sendo a base: o padrão
 * mantém o que cada um já via no sistema). Mesmo conteúdo de
 * privado.permissoes_padrao no banco.
 */
export function permissoesPadrao(papel: string): Record<Modulo, Operacao[]> {
  if (papel === "admin" || papel === "gestor") return permissoesTotais();
  if (papel === "financeiro")
    return normalizarPermissoes({
      ...todosVer(),
      pessoas: ["ver", "criar", "editar"],
      contratos: ["ver", "criar", "editar"],
      documentos: ["ver", "criar", "editar"],
      faturas: [...T4],
      cobrancas: [...T5],
      repasses: [...T5],
      financeiro: [...T5],
      comissoes: [...T5],
      agenda: [...T4],
      manutencao: ["ver", "criar", "editar", "aprovar"],
      vistorias: ["ver", "criar", "editar", "aprovar"],
      analise: ["ver", "criar", "editar"],
      aprovacoes: ["ver", "criar", "aprovar"],
      configuracoes: ["ver", "editar"],
    });
  if (papel === "corretor")
    return normalizarPermissoes({
      ...todosVer(),
      imoveis: ["ver", "criar", "editar"],
      pessoas: ["ver", "criar", "editar"],
      documentos: ["ver", "criar", "editar"],
      contratos: ["ver", "criar"],
      cobrancas: ["ver", "criar"],
      comercial: [...T4],
      captacao: [...T4],
      vendas: ["ver", "criar", "editar"],
      agenda: [...T4],
      vistorias: ["ver", "criar", "editar"],
      manutencao: ["ver", "criar", "editar"],
      analise: ["ver", "criar", "editar"],
      marketing: ["ver", "criar", "editar"],
      aprovacoes: ["ver", "criar"],
      configuracoes: ["ver", "editar"],
    });
  return normalizarPermissoes({});
}

/** Permissões que valem para o usuário: administrador sempre tudo; senão o perfil (ou o padrão do papel). */
export function permissoesEfetivas(papel: string, perfil?: unknown | null): Record<Modulo, Operacao[]> {
  if (papel === "admin") return permissoesTotais();
  return perfil ? normalizarPermissoes(perfil) : permissoesPadrao(papel);
}

export function temPermissao(perms: Permissoes, modulo: Modulo, operacao: Operacao): boolean {
  return Boolean(perms[modulo]?.includes(operacao));
}

/** Módulo que governa a rota (o mais específico). null = rota sem módulo (ex.: login). */
export function moduloDaRota(caminho: string): Modulo | null {
  const c = caminho.split("?")[0].replace(/\/+$/, "") || "/";
  let achado: { id: Modulo; tam: number } | null = null;
  for (const m of MODULOS)
    for (const r of m.rotas) {
      const casa = r === "/" ? c === "/" : c === r || c.startsWith(`${r}/`);
      if (casa && (!achado || r.length > achado.tam)) achado = { id: m.id, tam: r.length };
    }
  return achado?.id ?? null;
}

/**
 * O perfil deixa ver esta rota? (para filtrar o menu na casca e bloquear a
 * tela no servidor). Rota sem módulo e o Painel: sempre.
 */
export function rotaVisivel(caminho: string, perms: Permissoes): boolean {
  const m = moduloDaRota(caminho);
  if (!m || m === "painel") return true;
  return temPermissao(perms, m, "ver");
}

export function mensagemSemPermissao(modulo: Modulo, operacao: Operacao): string {
  return `Seu perfil de acesso não permite ${ROTULO_OPERACAO[operacao].toLowerCase()} em ${ROTULO_MODULO[modulo] ?? modulo}. Fale com o administrador.`;
}

/** Diferença de um perfil para o padrão do papel (para mostrar "personalizado"). */
export function diferencasDoPadrao(papel: string, perfil: unknown): { modulo: Modulo; mais: Operacao[]; menos: Operacao[] }[] {
  const base = permissoesPadrao(papel);
  const atual = normalizarPermissoes(perfil);
  const out: { modulo: Modulo; mais: Operacao[]; menos: Operacao[] }[] = [];
  for (const m of MODULOS) {
    const mais = atual[m.id].filter((o) => !base[m.id].includes(o));
    const menos = base[m.id].filter((o) => !atual[m.id].includes(o));
    if (mais.length || menos.length) out.push({ modulo: m.id, mais, menos });
  }
  return out;
}

// ---------------------------------------------------------------------------
// CRECI e documentos profissionais
// ---------------------------------------------------------------------------

export const UFS = ["AC", "AL", "AP", "AM", "BA", "CE", "DF", "ES", "GO", "MA", "MT", "MS", "MG", "PA", "PB", "PR", "PE", "PI", "RJ", "RN", "RS", "RO", "RR", "SC", "SP", "SE", "TO"];
export const TIPOS_CRECI: Record<string, string> = { definitivo: "Pessoa física (definitivo)", estagiario: "Estagiário", juridica: "Pessoa jurídica" };

/** Antecedência (dias) dos avisos de vencimento. */
export const DIAS_AVISO_CRECI = 60;
export const DIAS_AVISO_DOCUMENTO = 30;

export type SituacaoValidade = "sem_data" | "vencido" | "vencendo" | "em_dia";
export const ROTULO_VALIDADE: Record<SituacaoValidade, string> = { sem_data: "Sem validade", vencido: "Vencido", vencendo: "Vence logo", em_dia: "Em dia" };
export const COR_VALIDADE = { sem_data: "cinza", vencido: "vermelho", vencendo: "amarelo", em_dia: "verde" } as const;

export function situacaoValidade(validade: DataISO | null | undefined, hoje: DataISO, aviso = DIAS_AVISO_DOCUMENTO): { situacao: SituacaoValidade; dias: number | null } {
  if (!validade) return { situacao: "sem_data", dias: null };
  const dias = diasEntre(hoje, validade);
  if (dias < 0) return { situacao: "vencido", dias };
  if (dias <= aviso) return { situacao: "vencendo", dias };
  return { situacao: "em_dia", dias };
}

export function textoValidade(dias: number | null): string {
  if (dias === null) return "sem data de validade";
  if (dias < 0) return dias === -1 ? "venceu ontem" : `venceu há ${-dias} dias`;
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `vence em ${dias} dias`;
}

/** CRECI precisa de número (com dígitos) e UF válida. */
export function validarCreci(numero: string | null | undefined, uf: string | null | undefined): string | null {
  const n = (numero ?? "").trim();
  const u = (uf ?? "").trim().toUpperCase();
  if (!n && !u) return null;
  if (!/\d/.test(n)) return "Informe o número do CRECI.";
  if (n.length > 20) return "Número do CRECI muito longo.";
  if (!UFS.includes(u)) return "Escolha a UF do CRECI.";
  return null;
}

export function formatarCreci(numero: string | null | undefined, uf: string | null | undefined): string {
  const n = (numero ?? "").trim();
  if (!n) return "—";
  const u = (uf ?? "").trim().toUpperCase();
  return u ? `CRECI ${n}/${u}` : `CRECI ${n}`;
}

export const TIPOS_DOCUMENTO_PROFISSIONAL = [
  "Carteira do CRECI",
  "Certidão de regularidade do CRECI",
  "Anuidade do CRECI",
  "RG ou CNH",
  "CPF",
  "Comprovante de residência",
  "Contrato de trabalho / parceria",
  "Certificado de curso (TTI, CNAI…)",
  "Seguro de responsabilidade",
  "Outro",
];

// ---------------------------------------------------------------------------
// Convites
// ---------------------------------------------------------------------------

export function mascararEmail(email: string | null | undefined): string {
  const e = (email ?? "").trim();
  const [u, d] = e.split("@");
  if (!u || !d) return e;
  const vis = u.length <= 2 ? u.slice(0, 1) : u.slice(0, 2);
  return `${vis}${"*".repeat(Math.max(1, Math.min(6, u.length - vis.length)))}@${d}`;
}

export const emailValido = (e: string) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e.trim());

// ---------------------------------------------------------------------------
// Metas individuais e coletivas
// ---------------------------------------------------------------------------

export const TIPOS_META_EQUIPE = ["leads", "atendimentos", "visitas", "propostas", "locacoes", "vendas", "valor_vendas", "captacoes", "tarefas", "chamados"] as const;
export type TipoMetaEquipe = (typeof TIPOS_META_EQUIPE)[number];
export const ROTULO_META_EQUIPE: Record<TipoMetaEquipe, string> = {
  leads: "Leads recebidos",
  atendimentos: "Leads atendidos",
  visitas: "Visitas feitas",
  propostas: "Propostas feitas",
  locacoes: "Locações fechadas",
  vendas: "Vendas concluídas",
  valor_vendas: "Valor vendido (R$)",
  captacoes: "Imóveis captados",
  tarefas: "Tarefas concluídas",
  chamados: "Chamados resolvidos",
};
export const ALVOS_META = ["pessoa", "equipe", "filial"] as const;
export type AlvoMeta = (typeof ALVOS_META)[number];
export const ROTULO_ALVO_META: Record<AlvoMeta, string> = { pessoa: "Individual (colaborador)", equipe: "Coletiva (equipe)", filial: "Coletiva (filial)" };

// ---------------------------------------------------------------------------
// Produtividade e desempenho
// ---------------------------------------------------------------------------

/** Uma linha de public.equipe_produtividade (por colaborador). */
export type LinhaProdutividade = {
  pessoa_id: string;
  nome: string;
  user_id: string | null;
  equipe_id: string | null;
  filial_id: string | null;
  leads_recebidos: number;
  leads_atendidos: number;
  resposta_soma_min: number;
  resposta_qtd: number;
  visitas: number;
  propostas: number;
  propostas_aceitas: number;
  locacoes: number;
  vendas: number;
  valor_vendas: number;
  captacoes: number;
  tarefas: number;
  chamados: number;
};

export const CAMPOS_SOMA = [
  "leads_recebidos",
  "leads_atendidos",
  "resposta_soma_min",
  "resposta_qtd",
  "visitas",
  "propostas",
  "propostas_aceitas",
  "locacoes",
  "vendas",
  "valor_vendas",
  "captacoes",
  "tarefas",
  "chamados",
] as const;
type CampoSoma = (typeof CAMPOS_SOMA)[number];
export type TotaisProdutividade = Record<CampoSoma, number>;

export function totaisVazios(): TotaisProdutividade {
  return Object.fromEntries(CAMPOS_SOMA.map((c) => [c, 0])) as TotaisProdutividade;
}

/** Converte a linha vinda do banco (numéricos podem chegar como texto). */
export function lerLinhaProdutividade(r: Record<string, unknown>): LinhaProdutividade {
  const n = (k: string) => Number(r[k] ?? 0) || 0;
  return {
    pessoa_id: String(r.pessoa_id),
    nome: String(r.nome ?? ""),
    user_id: (r.user_id as string | null) ?? null,
    equipe_id: (r.equipe_id as string | null) ?? null,
    filial_id: (r.filial_id as string | null) ?? null,
    ...(Object.fromEntries(CAMPOS_SOMA.map((c) => [c, n(c)])) as TotaisProdutividade),
  };
}

export function somarProdutividade(linhas: Pick<LinhaProdutividade, CampoSoma>[]): TotaisProdutividade {
  const t = totaisVazios();
  for (const l of linhas) for (const c of CAMPOS_SOMA) t[c] += Number(l[c]) || 0;
  t.valor_vendas = Math.round(t.valor_vendas * 100) / 100;
  return t;
}

/** Tempo médio até o primeiro atendimento do lead (minutos), ponderado pela quantidade. */
export function tempoMedioResposta(t: Pick<TotaisProdutividade, "resposta_soma_min" | "resposta_qtd">): number | null {
  return t.resposta_qtd > 0 ? Math.round(t.resposta_soma_min / t.resposta_qtd) : null;
}

export function formatarDuracao(min: number | null): string {
  if (min === null) return "—";
  if (min < 60) return `${min} min`;
  if (min < 48 * 60) {
    const h = Math.floor(min / 60);
    const m = min % 60;
    return m ? `${h} h ${m} min` : `${h} h`;
  }
  return `${Math.round(min / 1440)} dias`;
}

/** % de propostas que viraram negócio. */
export function taxaConversao(t: Pick<TotaisProdutividade, "propostas" | "propostas_aceitas">): number | null {
  return t.propostas > 0 ? Math.round((t.propostas_aceitas / t.propostas) * 1000) / 10 : null;
}

export type Agrupamento = "pessoa" | "equipe" | "filial";

/** Agrupa as linhas por colaborador, equipe ou filial (sem grupo = "Sem equipe"/"Sem filial"). */
export function agruparProdutividade(
  linhas: LinhaProdutividade[],
  por: Agrupamento,
  nomes: { equipes?: Map<string, string>; filiais?: Map<string, string> } = {},
): { chave: string; nome: string; pessoas: number; totais: TotaisProdutividade }[] {
  const grupos = new Map<string, { nome: string; linhas: LinhaProdutividade[] }>();
  for (const l of linhas) {
    const chave = por === "pessoa" ? l.pessoa_id : por === "equipe" ? (l.equipe_id ?? "") : (l.filial_id ?? "");
    const nome =
      por === "pessoa"
        ? l.nome
        : por === "equipe"
          ? (l.equipe_id ? (nomes.equipes?.get(l.equipe_id) ?? "Equipe") : "Sem equipe")
          : l.filial_id
            ? (nomes.filiais?.get(l.filial_id) ?? "Filial")
            : "Sem filial";
    const g = grupos.get(chave) ?? { nome, linhas: [] };
    g.linhas.push(l);
    grupos.set(chave, g);
  }
  return [...grupos.entries()]
    .map(([chave, g]) => ({ chave, nome: g.nome, pessoas: g.linhas.length, totais: somarProdutividade(g.linhas) }))
    .sort((a, b) => (a.chave === "" ? 1 : 0) - (b.chave === "" ? 1 : 0) || pontuacao(b.totais) - pontuacao(a.totais) || a.nome.localeCompare(b.nome, "pt-BR"));
}

/** Ordem do ranking: negócios fechados pesam mais que atividade. */
export function pontuacao(t: TotaisProdutividade): number {
  return t.vendas * 50 + t.locacoes * 30 + t.captacoes * 20 + t.propostas * 5 + t.visitas * 3 + t.leads_atendidos + t.tarefas + t.chamados;
}

/** Quanto foi feito para o tipo de meta. */
export function realizadoMeta(tipo: TipoMetaEquipe, t: TotaisProdutividade): number {
  switch (tipo) {
    case "leads":
      return t.leads_recebidos;
    case "atendimentos":
      return t.leads_atendidos;
    case "visitas":
      return t.visitas;
    case "propostas":
      return t.propostas;
    case "locacoes":
      return t.locacoes;
    case "vendas":
      return t.vendas;
    case "valor_vendas":
      return t.valor_vendas;
    case "captacoes":
      return t.captacoes;
    case "tarefas":
      return t.tarefas;
    case "chamados":
      return t.chamados;
  }
}

/** Linhas que contam para a meta (pessoa, equipe ou filial). */
export function linhasDoAlvo(linhas: LinhaProdutividade[], alvo: AlvoMeta, id: string): LinhaProdutividade[] {
  if (alvo === "pessoa") return linhas.filter((l) => l.pessoa_id === id);
  if (alvo === "equipe") return linhas.filter((l) => l.equipe_id === id);
  return linhas.filter((l) => l.filial_id === id);
}

/** Ritmo esperado: quanto do mês já passou (para dizer se está adiantado ou atrasado). */
export function ritmoDoMes(competencia: DataISO, hoje: DataISO): number {
  const ini = competencia.slice(0, 7);
  if (hoje.slice(0, 7) < ini) return 0;
  if (hoje.slice(0, 7) > ini) return 100;
  const [a, m] = ini.split("-").map(Number);
  const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return Math.round((Number(hoje.slice(8, 10)) / dias) * 100);
}

// ---------------------------------------------------------------------------
// Distribuição (rodízio)
// ---------------------------------------------------------------------------

export const TIPOS_REDISTRIBUICAO: Record<string, string> = {
  leads: "Leads em aberto",
  captacoes: "Captações em andamento",
  imoveis: "Imóveis (corretor responsável)",
  clientes: "Clientes da carteira",
  visitas: "Visitas agendadas",
};

/**
 * Divide os itens entre os destinos: cada item vai para quem está com menos
 * carga naquele momento (empate: a ordem da lista). Mesma regra de
 * public.equipe_redistribuir no banco.
 */
export function dividirRodizio(itens: string[], destinos: string[], cargaAtual: Record<string, number> = {}): Map<string, string> {
  const out = new Map<string, string>();
  if (!destinos.length) return out;
  const carga = destinos.map((d) => cargaAtual[d] ?? 0);
  for (const item of itens) {
    let i = 0;
    for (let k = 1; k < destinos.length; k++) if (carga[k] < carga[i]) i = k;
    out.set(item, destinos[i]);
    carga[i] += 1;
  }
  return out;
}

export function contarPorDestino(mapa: Map<string, string>): Record<string, number> {
  const c: Record<string, number> = {};
  for (const d of mapa.values()) c[d] = (c[d] ?? 0) + 1;
  return c;
}

// ---------------------------------------------------------------------------
// Aprovações
// ---------------------------------------------------------------------------

export const TIPOS_APROVACAO: Record<string, string> = {
  despesa: "Despesa ou compra",
  pagamento: "Pagamento",
  reembolso: "Reembolso",
  desconto: "Desconto para cliente",
  contrato: "Condição especial de contrato",
  comissao: "Comissão ou bônus",
  ferias: "Férias ou folga",
  outro: "Outro",
};
/** Regra que vale para qualquer tipo de solicitação. */
export const TIPO_QUALQUER = "qualquer";

export const ROTULO_STATUS_APROVACAO: Record<string, string> = { pendente: "Pendente", aprovada: "Aprovada", recusada: "Recusada", cancelada: "Cancelada" };
export const COR_STATUS_APROVACAO = { pendente: "amarelo", aprovada: "verde", recusada: "vermelho", cancelada: "cinza" } as const;

export type RegraAprovacao = { id: string; tipo: string; valor_minimo: number; ativa: boolean; created_at?: string };

/**
 * Regra que decide quem aprova: a do mesmo tipo (ou "qualquer") com o maior
 * valor mínimo que o valor alcança. Mesma conta de privado.aprovacoes_antes.
 */
export function escolherRegra<R extends RegraAprovacao>(regras: R[], tipo: string, valor: number | null): R | null {
  const v = Math.round((Number(valor) || 0) * 100);
  const cand = regras
    .filter((r) => r.ativa && (r.tipo === tipo || r.tipo === TIPO_QUALQUER) && v >= Math.round(Number(r.valor_minimo) * 100))
    .sort(
      (a, b) =>
        (b.tipo === tipo ? 1 : 0) - (a.tipo === tipo ? 1 : 0) ||
        Number(b.valor_minimo) - Number(a.valor_minimo) ||
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
    );
  return cand[0] ?? null;
}

export type AprovadorAlvo = { aprovador_id: string | null; aprovador_papel: string | null; aprovador_perfil_id: string | null; solicitante_id: string | null };
export type Aprovador = { userId: string; papel: string; perfilEfetivo: string | null; podeAprovar: boolean };

/** Esta pessoa pode decidir? Mesma regra de privado.pode_aprovar no banco. */
export function podeDecidirAprovacao(a: AprovadorAlvo, u: Aprovador): boolean {
  if (u.papel === "admin") return true;
  if (u.userId === a.solicitante_id) return false;
  if (!u.podeAprovar) return false;
  if (a.aprovador_id) return a.aprovador_id === u.userId;
  if (a.aprovador_perfil_id) return u.perfilEfetivo === a.aprovador_perfil_id;
  if (a.aprovador_papel) return u.papel === a.aprovador_papel || (u.papel === "gestor" && a.aprovador_papel === "financeiro");
  return u.papel === "gestor";
}

/**
 * Link de uma solicitação: só tela do próprio sistema ("/…", sem "//" nem
 * "/\"). Qualquer outra coisa (site de fora, javascript:) vira null. Mesma
 * regra de privado.aprovacoes_antes.
 */
export function linkInterno(link: string | null | undefined): string | null {
  const l = (link ?? "").trim();
  if (!l || l.length > 500 || !l.startsWith("/") || /^\/[/\\]/.test(l) || /\s/.test(l)) return null;
  return l;
}

export function descreverAprovador(a: AprovadorAlvo, nomes: { usuarios?: Map<string, string>; perfis?: Map<string, string> } = {}): string {
  if (a.aprovador_id) return nomes.usuarios?.get(a.aprovador_id) ?? "um usuário";
  if (a.aprovador_perfil_id) return `perfil ${nomes.perfis?.get(a.aprovador_perfil_id) ?? "escolhido"}`;
  if (a.aprovador_papel === "financeiro") return "financeiro ou gestor";
  if (a.aprovador_papel === "admin") return "administrador";
  return "gestor ou administrador";
}

// ---------------------------------------------------------------------------
// Tarefas internas
// ---------------------------------------------------------------------------

export const STATUS_TAREFA = ["a_fazer", "em_andamento", "aguardando", "concluida", "cancelada"] as const;
export type StatusTarefa = (typeof STATUS_TAREFA)[number];
export const ROTULO_STATUS_TAREFA: Record<string, string> = { a_fazer: "A fazer", em_andamento: "Em andamento", aguardando: "Aguardando", concluida: "Concluída", cancelada: "Cancelada" };
export const COR_STATUS_TAREFA = { a_fazer: "cinza", em_andamento: "azul", aguardando: "amarelo", concluida: "verde", cancelada: "cinza" } as const;
export const PRIORIDADES_TAREFA = ["baixa", "normal", "alta", "urgente"] as const;
export const ROTULO_PRIORIDADE: Record<string, string> = { baixa: "Baixa", normal: "Normal", alta: "Alta", urgente: "Urgente" };
export const COR_PRIORIDADE = { baixa: "cinza", normal: "azul", alta: "amarelo", urgente: "vermelho" } as const;
export const CATEGORIAS_TAREFA: Record<string, string> = {
  geral: "Geral",
  administrativo: "Administrativo",
  financeiro: "Financeiro",
  juridico: "Jurídico",
  documentacao: "Documentação",
  manutencao: "Manutenção",
  atendimento: "Atendimento",
  ti: "Sistemas e TI",
  rh: "Pessoas (RH)",
};

export const tarefaAberta = (s: string) => s !== "concluida" && s !== "cancelada";

/** Atrasadas primeiro, depois por prioridade e prazo. */
export function ordenarTarefas<T extends { status: string; prioridade: string; prazo: string | null }>(lista: T[], hoje: DataISO): T[] {
  const peso = { urgente: 0, alta: 1, normal: 2, baixa: 3 } as Record<string, number>;
  const atrasada = (t: T) => (tarefaAberta(t.status) && t.prazo !== null && t.prazo < hoje ? 0 : 1);
  return [...lista].sort(
    (a, b) =>
      (tarefaAberta(a.status) ? 0 : 1) - (tarefaAberta(b.status) ? 0 : 1) ||
      atrasada(a) - atrasada(b) ||
      (peso[a.prioridade] ?? 2) - (peso[b.prioridade] ?? 2) ||
      (a.prazo ?? "9999").localeCompare(b.prazo ?? "9999"),
  );
}

// ---------------------------------------------------------------------------
// Onboarding
// ---------------------------------------------------------------------------

export const RESPONSAVEIS_ONBOARDING: Record<string, string> = { colaborador: "O colaborador", gestor: "O gestor", rh: "Pessoas (RH)", ti: "Sistemas (TI)" };

/** Checklist sugerido para quem está chegando. */
export const MODELO_ONBOARDING_PADRAO: { titulo: string; descricao: string; responsavel: string; prazo_dias: number }[] = [
  { titulo: "Contrato de trabalho ou parceria assinado", descricao: "Contrato, termo de confidencialidade e LGPD.", responsavel: "rh", prazo_dias: 1 },
  { titulo: "Documentos pessoais e CRECI conferidos", descricao: "RG/CNH, CPF, comprovante de residência e carteira do CRECI com validade.", responsavel: "rh", prazo_dias: 3 },
  { titulo: "Acesso ao sistema criado", descricao: "Convite enviado, perfil de acesso escolhido e primeiro login feito.", responsavel: "ti", prazo_dias: 1 },
  { titulo: "E-mail, WhatsApp e assinatura", descricao: "E-mail da empresa, WhatsApp comercial e assinatura de e-mail.", responsavel: "ti", prazo_dias: 3 },
  { titulo: "Apresentação à equipe", descricao: "Conhecer as pessoas, a filial e quem é o gestor.", responsavel: "gestor", prazo_dias: 2 },
  { titulo: "Treinamento do sistema", descricao: "Leads, agenda, imóveis, propostas e como registrar cada contato.", responsavel: "gestor", prazo_dias: 7 },
  { titulo: "Carteira de imóveis e clientes recebida", descricao: "Imóveis e leads repassados na Distribuição.", responsavel: "gestor", prazo_dias: 10 },
  { titulo: "Metas do primeiro mês combinadas", descricao: "Metas individuais cadastradas em Equipe → Metas.", responsavel: "gestor", prazo_dias: 10 },
  { titulo: "Primeira semana acompanhada", descricao: "Conversa de retorno com o gestor ao fim da primeira semana.", responsavel: "gestor", prazo_dias: 7 },
];

export function prazoItemOnboarding(inicio: DataISO, prazoDias: number | null | undefined): DataISO {
  return somarDias(inicio, Math.max(0, Math.trunc(Number(prazoDias) || 0)));
}

export function progressoOnboarding(itens: { concluido_em: string | null; prazo: string | null }[], hoje: DataISO): { feitos: number; total: number; pct: number; atrasados: number } {
  const total = itens.length;
  const feitos = itens.filter((i) => i.concluido_em).length;
  const atrasados = itens.filter((i) => !i.concluido_em && i.prazo !== null && i.prazo < hoje).length;
  return { feitos, total, pct: total ? Math.round((feitos / total) * 100) : 0, atrasados };
}

// ---------------------------------------------------------------------------
// Comunicação interna
// ---------------------------------------------------------------------------

export const PUBLICOS_AVISO: Record<string, string> = { todos: "Toda a equipe", equipe: "Uma equipe", filial: "Uma filial", papel: "Um papel (ex.: só corretores)" };

/** O aviso é para este usuário? */
export function avisoParaMim(
  a: { para: string; equipe_id: string | null; filial_id: string | null; papel: string | null; expira_em: string | null },
  eu: { papel: string; equipeId: string | null; filialId: string | null },
  hoje: DataISO,
): boolean {
  if (a.expira_em && a.expira_em < hoje) return false;
  if (a.para === "equipe") return Boolean(a.equipe_id) && a.equipe_id === eu.equipeId;
  if (a.para === "filial") return Boolean(a.filial_id) && a.filial_id === eu.filialId;
  if (a.para === "papel") return a.papel === eu.papel;
  return true;
}

// ---------------------------------------------------------------------------
// Histórico de ações (auditoria)
// ---------------------------------------------------------------------------

export const TABELAS_AUDITADAS: Record<string, string> = {
  imoveis: "Imóveis",
  contratos: "Contratos",
  pessoas: "Pessoas",
  faturas: "Aluguéis (faturas)",
  lancamentos: "Financeiro (lançamentos)",
  repasses: "Repasses",
  membros: "Usuários",
  organizacoes: "Configurações",
  perfis_acesso: "Perfis de acesso",
  filiais: "Filiais",
  equipes: "Equipes",
  equipe_membros: "Membros de equipe",
  equipe_convites: "Convites",
  equipe_documentos: "Documentos profissionais",
  equipe_metas: "Metas da equipe",
  equipe_distribuicao_regras: "Regras de distribuição",
  equipe_tarefas: "Tarefas internas",
  equipe_avisos: "Avisos do mural",
  equipe_onboardings: "Onboarding",
  equipe_onboarding_modelos: "Modelos de onboarding",
  aprovacoes: "Aprovações",
  aprovacao_regras: "Regras de aprovação",
};
export const ROTULO_ACAO_AUDITORIA: Record<string, string> = { insert: "Criou", update: "Alterou", delete: "Excluiu" };
export const COR_ACAO_AUDITORIA = { insert: "verde", update: "azul", delete: "vermelho" } as const;

/** Valor de um campo do histórico em texto curto. */
export function valorAuditoria(v: unknown): string {
  if (v === null || v === undefined || v === "") return "vazio";
  if (typeof v === "boolean") return v ? "sim" : "não";
  if (Array.isArray(v)) return v.length ? v.map((x) => valorAuditoria(x)).join(", ") : "vazio";
  if (typeof v === "object") return JSON.stringify(v).slice(0, 120);
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s.slice(8, 10)}/${s.slice(5, 7)}/${s.slice(0, 4)}`;
  return s.length > 120 ? `${s.slice(0, 117)}…` : s;
}

/** Nome de um registro para mostrar no histórico (título, código, nome…). */
export function tituloRegistro(dados: Record<string, unknown> | null | undefined): string | null {
  if (!dados) return null;
  for (const k of ["nome", "titulo", "codigo", "descricao", "email", "numero"]) {
    const v = dados[k];
    if (v !== null && v !== undefined && String(v).trim()) return String(v).slice(0, 80);
  }
  return null;
}

/** Datas da semana para os filtros de período. */
export function periodoPorChave(chave: string, hoje: DataISO): { inicio: DataISO; fim: DataISO; rotulo: string } {
  const mes = hoje.slice(0, 7);
  if (chave === "mes_passado") {
    const [a, m] = mes.split("-").map(Number);
    const ant = m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`;
    const [aa, mm] = ant.split("-").map(Number);
    const fim = new Date(Date.UTC(aa, mm, 0)).getUTCDate();
    return { inicio: `${ant}-01`, fim: `${ant}-${String(fim).padStart(2, "0")}`, rotulo: "Mês passado" };
  }
  if (chave === "90d") return { inicio: somarDias(hoje, -89), fim: hoje, rotulo: "Últimos 90 dias" };
  if (chave === "ano") return { inicio: `${hoje.slice(0, 4)}-01-01`, fim: hoje, rotulo: `Ano de ${hoje.slice(0, 4)}` };
  return { inicio: `${mes}-01`, fim: hoje, rotulo: "Este mês" };
}
