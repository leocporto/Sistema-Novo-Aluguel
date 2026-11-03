/**
 * Regras puras do Marketing e comunicação (só modo imobiliária): modelos com
 * variáveis, público das campanhas (filtros + descadastro/LGPD), fila, NPS,
 * origem das conversões (UTM/gclid/fbclid), recomendação por perfil,
 * automações e leitura dos webhooks (WhatsApp Cloud API, Lead Ads).
 */
import { paraReativar, perfilDoLead } from "./crm";
import { diasEntre, somarDias } from "./datas";
import { formatarReais, paraCentavos, paraReais } from "./dinheiro";
import { normalizar } from "./imoveis";
import { imoveisQueCombinam, type ImovelOferta, type PerfilInteresse } from "./pessoas";

// -----------------------------------------------------------------------------
// Canais, tipos e rótulos
// -----------------------------------------------------------------------------
export const CANAIS = ["whatsapp", "email", "sms"] as const;
export type Canal = (typeof CANAIS)[number];
export const ROTULO_CANAL: Record<Canal, string> = { whatsapp: "WhatsApp", email: "E-mail", sms: "SMS" };

export type Finalidade = "ofertas" | "relacionamento";

export const TIPOS_CAMPANHA = ["manual", "reativacao", "novo_imovel", "reducao_preco", "recomendacao", "pos_venda", "pos_locacao", "pesquisa"] as const;
export type TipoCampanha = (typeof TIPOS_CAMPANHA)[number];
export const ROTULO_TIPO_CAMPANHA: Record<TipoCampanha, string> = {
  manual: "Campanha livre",
  reativacao: "Reativação de leads",
  novo_imovel: "Imóvel novo",
  reducao_preco: "Redução de preço",
  recomendacao: "Sugestão de imóveis",
  pos_venda: "Pós-venda",
  pos_locacao: "Pós-locação",
  pesquisa: "Pesquisa de satisfação",
};

/** Pesquisa, pós-venda e pós-locação são relacionamento: quem recusou só "ofertas" continua recebendo. */
export function finalidadeDoTipo(tipo: string): Finalidade {
  return tipo === "pesquisa" || tipo === "pos_venda" || tipo === "pos_locacao" ? "relacionamento" : "ofertas";
}

export const USOS_MODELO: Record<string, string> = {
  geral: "Geral",
  novo_imovel: "Imóvel novo",
  reducao_preco: "Redução de preço",
  reativacao: "Reativação",
  recomendacao: "Sugestão de imóveis",
  pos_venda: "Pós-venda",
  pos_locacao: "Pós-locação",
  pesquisa: "Pesquisa de satisfação",
};

export const GATILHOS = ["novo_imovel", "reducao_preco", "pos_venda", "pos_locacao"] as const;
export type Gatilho = (typeof GATILHOS)[number];
export const ROTULO_GATILHO: Record<Gatilho, string> = {
  novo_imovel: "Imóvel novo (ou de volta ao mercado)",
  reducao_preco: "Preço do imóvel baixou",
  pos_venda: "Dias depois de concluir uma venda",
  pos_locacao: "Dias depois do início do contrato de locação",
};

export const ROTULO_STATUS_ENVIO: Record<string, string> = {
  pendente: "Para enviar",
  enviado: "Enviado",
  falhou: "Falhou",
  cancelado: "Cancelado",
  bloqueado: "Descadastrado",
};

export const ROTULO_STATUS_CONVERSA: Record<string, string> = { aberta: "Aguardando resposta nossa", aguardando: "Aguardando o cliente", resolvida: "Resolvida" };

export const ROTULO_CANAL_DESCADASTRO: Record<string, string> = {
  todos: "Tudo",
  whatsapp: "WhatsApp",
  email: "E-mail",
  sms: "SMS",
  ofertas: "Ofertas e novidades",
};

/** Respostas no WhatsApp que valem como "não quero mais receber" (igual ao banco). */
export const PALAVRAS_SAIR = ["SAIR", "PARAR", "STOP", "DESCADASTRAR", "DESCADASTRO"];

// -----------------------------------------------------------------------------
// Modelos de mensagem
// -----------------------------------------------------------------------------
export const VARIAVEIS_MENSAGEM: { chave: string; descricao: string }[] = [
  { chave: "nome", descricao: "Nome completo do contato" },
  { chave: "primeiro_nome", descricao: "Primeiro nome" },
  { chave: "imobiliaria", descricao: "Nome da imobiliária" },
  { chave: "corretor", descricao: "Corretor responsável" },
  { chave: "imovel", descricao: "Imóvel (código, tipo e bairro)" },
  { chave: "codigo", descricao: "Código do imóvel" },
  { chave: "preco", descricao: "Preço do imóvel (aluguel ou venda)" },
  { chave: "preco_anterior", descricao: "Preço antes da redução" },
  { chave: "imoveis", descricao: "Lista de imóveis sugeridos" },
  { chave: "link", descricao: "Link (página do imóvel ou landing page)" },
  { chave: "link_pesquisa", descricao: "Link da pesquisa de satisfação" },
  { chave: "link_preferencias", descricao: "Link para a pessoa escolher o que recebe / sair da lista" },
];

export type ModeloPadrao = { nome: string; canal: Canal; uso: string; assunto?: string; corpo: string };

export const MODELOS_PADRAO: ModeloPadrao[] = [
  {
    nome: "Imóvel novo para o seu perfil",
    canal: "whatsapp",
    uso: "novo_imovel",
    corpo: "Olá {{primeiro_nome}}! Aqui é da {{imobiliaria}}. Acabou de entrar um imóvel com o seu perfil: {{imovel}} — {{preco}}. Quer agendar uma visita? {{link}}",
  },
  {
    nome: "O preço baixou",
    canal: "whatsapp",
    uso: "reducao_preco",
    corpo: "Oi {{primeiro_nome}}! Boa notícia: o imóvel {{imovel}} baixou de {{preco_anterior}} para {{preco}}. Quer ver de novo? {{link}}",
  },
  {
    nome: "Reativação de contato",
    canal: "whatsapp",
    uso: "reativacao",
    corpo: "Olá {{primeiro_nome}}, tudo bem? Aqui é da {{imobiliaria}}. Você ainda está procurando imóvel? Chegaram opções novas que podem te interessar. Posso te mandar?",
  },
  {
    nome: "Sugestões de imóveis",
    canal: "whatsapp",
    uso: "recomendacao",
    corpo: "Olá {{primeiro_nome}}! Separei imóveis que combinam com o que você procura:\n{{imoveis}}\nQuer visitar algum?",
  },
  {
    nome: "Pós-venda (pesquisa)",
    canal: "whatsapp",
    uso: "pos_venda",
    corpo: "Olá {{primeiro_nome}}! Parabéns pelo novo imóvel. Como foi a experiência com a {{imobiliaria}}? Leva menos de 1 minuto: {{link_pesquisa}}",
  },
  {
    nome: "Pós-locação (boas-vindas)",
    canal: "whatsapp",
    uso: "pos_locacao",
    corpo: "Olá {{primeiro_nome}}! Esperamos que esteja gostando do imóvel {{imovel}}. Qualquer coisa, estamos por aqui. Pode avaliar nosso atendimento? {{link_pesquisa}}",
  },
  {
    nome: "Pesquisa de satisfação (e-mail)",
    canal: "email",
    uso: "pesquisa",
    assunto: "Como foi o atendimento da {{imobiliaria}}?",
    corpo: "Olá {{primeiro_nome}},\n\nQueremos saber como foi a sua experiência com a {{imobiliaria}}. É uma pergunta só:\n{{link_pesquisa}}\n\nObrigado!",
  },
  {
    nome: "Novidades por e-mail",
    canal: "email",
    uso: "geral",
    assunto: "Novidades da {{imobiliaria}} para você",
    corpo: "Olá {{primeiro_nome}},\n\nSeparamos imóveis que combinam com o seu perfil:\n{{imoveis}}\n\nResponda este e-mail para agendar uma visita.",
  },
];

export const primeiroNome = (nome: string | null | undefined) => (nome ?? "").trim().split(/\s+/)[0] ?? "";

/** Troca {{variavel}} pelos dados (sem maiúsculas/espaços importarem). Variável sem valor some. */
export function renderizarMensagem(texto: string, dados: Record<string, string | number | null | undefined>): string {
  const mapa = new Map(Object.entries(dados).map(([k, v]) => [k.toLowerCase(), v]));
  return texto
    .replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, chave: string) => {
      const v = mapa.get(chave.toLowerCase());
      return v === null || v === undefined ? "" : String(v);
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

export function variaveisUsadas(texto: string): string[] {
  return [...new Set([...texto.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].map((m) => m[1].toLowerCase()))];
}

/**
 * Toda mensagem de oferta leva o jeito de sair da lista (LGPD). No WhatsApp
 * também vale responder SAIR. Se o modelo já tem o link, não repete.
 */
export function comRodape(mensagem: string, canal: Canal, linkPreferencias: string | null, finalidade: Finalidade = "ofertas"): string {
  if (!linkPreferencias || mensagem.includes(linkPreferencias)) return mensagem;
  if (finalidade === "relacionamento") return mensagem;
  const rodape =
    canal === "whatsapp" ? `Não quer mais receber? Responda SAIR ou escolha aqui: ${linkPreferencias}` : `Para escolher o que recebe ou sair da lista: ${linkPreferencias}`;
  return `${mensagem}\n\n${rodape}`;
}

/** Link mailto com assunto e corpo. */
export function linkEmail(email: string, assunto: string | null, corpo: string): string {
  const q = new URLSearchParams();
  if (assunto) q.set("subject", assunto);
  q.set("body", corpo);
  return `mailto:${encodeURIComponent(email.trim())}?${q.toString().replace(/\+/g, "%20")}`;
}

/** Link de SMS (abre o app de mensagens no celular). */
export function linkSms(telefone: string, corpo: string): string {
  return `sms:${telefone.replace(/[^\d+]/g, "")}?body=${encodeURIComponent(corpo)}`;
}

// -----------------------------------------------------------------------------
// Público das campanhas
// -----------------------------------------------------------------------------
export type Contato = {
  tipo: "lead" | "pessoa";
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  preferencias_token?: string | null;
  // leads
  funil?: string | null;
  status?: string | null;
  origem?: string | null;
  corretor_id?: string | null;
  corretor?: string | null;
  ultimo_contato?: string | null;
  perdido_em?: string | null;
  created_at?: string | null;
  utm_source?: string | null;
  // pessoas
  papeis?: string[];
  cidade?: string | null;
  bairro?: string | null;
  interesse?: string[];
  aceita?: { whatsapp: boolean; email: boolean; sms: boolean; marketing: boolean } | null;
  // perfil de busca (lead ou pessoa)
  perfil?: PerfilInteresse | null;
  /** imóveis ligados ao lead (lead_imoveis) */
  imoveis?: string[];
};

export type FiltrosCampanha = {
  publico?: "leads" | "pessoas" | "ambos";
  funil?: string;
  etapas?: string[];
  origem?: string;
  utm_source?: string;
  corretor?: string;
  parado_dias?: number | null;
  incluir_perdidos?: boolean;
  /** Mesma regra da tela Comercial › Reativar: perdidos há 30+ dias ou parados há 60+. */
  reativar?: boolean;
  papel?: string;
  regiao?: string;
  interesse?: string;
  /** Só quem tem perfil que combina com o imóvel da campanha. */
  combina_imovel?: boolean;
};

export type Descadastro = { pessoa_id: string | null; lead_id: string | null; email: string | null; telefone: string | null; canal: string };
export type Consentimento = { pessoa_id: string; canal: string; concedido: boolean; em: string };

const dig9 = (t: string | null | undefined) => (t ?? "").replace(/\D/g, "").slice(-9);

/** Mesma regra do banco (privado.mkt_bloqueado). */
export function contatoBloqueado(
  c: Pick<Contato, "tipo" | "id" | "email" | "telefone">,
  canal: Canal | "-",
  finalidade: Finalidade,
  descadastros: Descadastro[],
  consentimentos: Consentimento[] = [],
): boolean {
  const email = (c.email ?? "").trim().toLowerCase();
  const tel = dig9(c.telefone);
  const porRegra = descadastros.some((d) => {
    const vale = d.canal === "todos" || d.canal === canal || (d.canal === "ofertas" && finalidade === "ofertas");
    if (!vale) return false;
    // Só compara cadastro quando os dois lados têm id (envio sem cadastro não casa com bloqueio sem cadastro).
    if (c.id && c.tipo === "pessoa" && d.pessoa_id && d.pessoa_id === c.id) return true;
    if (c.id && c.tipo === "lead" && d.lead_id && d.lead_id === c.id) return true;
    if (email && (d.email ?? "").trim().toLowerCase() === email) return true;
    return tel.length >= 8 && dig9(d.telefone) === tel;
  });
  if (porRegra || c.tipo !== "pessoa") return porRegra;
  const canais = [canal, finalidade === "ofertas" ? "marketing" : null].filter(Boolean) as string[];
  return canais.some((k) => {
    const ultimo = consentimentos.filter((x) => x.pessoa_id === c.id && x.canal === k).sort((a, b) => b.em.localeCompare(a.em))[0];
    return ultimo ? !ultimo.concedido : false;
  });
}

/** Filtros da campanha (antes da checagem de canal e descadastro). */
export function filtrarContatos<C extends Contato>(contatos: C[], f: FiltrosCampanha, opcoes: { agoraMs: number; imovel?: ImovelOferta | null }): C[] {
  const publico = f.publico ?? "ambos";
  const regiao = normalizar(f.regiao);
  const dias = (iso: string | null | undefined) => (iso ? (opcoes.agoraMs - new Date(iso).getTime()) / 86_400_000 : Infinity);
  return contatos.filter((c) => {
    if (publico === "leads" && c.tipo !== "lead") return false;
    if (publico === "pessoas" && c.tipo !== "pessoa") return false;
    if (c.tipo === "lead") {
      if (c.status === "ganho") return false;
      if (f.reativar) {
        const l = { status: c.status ?? "", perdido_em: c.perdido_em ?? null, ultimo_contato: c.ultimo_contato ?? null, created_at: c.created_at ?? new Date(opcoes.agoraMs).toISOString() };
        if (!paraReativar([l], opcoes.agoraMs).length) return false;
      } else if (c.status === "perdido" && !f.incluir_perdidos && !(f.etapas ?? []).includes("perdido")) return false;
      if (f.funil && c.funil !== f.funil) return false;
      if (f.etapas?.length && !f.etapas.includes(c.status ?? "")) return false;
      if (f.origem && c.origem !== f.origem) return false;
      if (f.utm_source && normalizar(c.utm_source) !== normalizar(f.utm_source)) return false;
      if (f.corretor && c.corretor_id !== f.corretor) return false;
      if (f.parado_dias && f.parado_dias > 0) {
        const ref = c.status === "perdido" ? (c.perdido_em ?? c.created_at) : (c.ultimo_contato ?? c.created_at);
        if (dias(ref) < f.parado_dias) return false;
      }
    } else {
      // Filtros só de lead excluem as pessoas (ex.: "leads parados há 60 dias").
      if (f.reativar || f.etapas?.length || f.origem || f.utm_source || f.corretor || (f.parado_dias && f.parado_dias > 0)) return false;
      if (f.papel && !(c.papeis ?? []).includes(f.papel)) return false;
      if (f.interesse && !(c.interesse ?? []).includes(f.interesse)) return false;
      if (f.funil) {
        const quer = f.funil === "venda" ? ["comprar", "investir"] : ["alugar"];
        if (!(c.interesse ?? []).some((i) => quer.includes(i))) return false;
      }
    }
    if (f.papel && c.tipo === "lead") return false;
    if (f.interesse && c.tipo === "lead") {
      const quer = f.interesse === "alugar" ? "locacao" : "venda";
      if (c.funil !== quer) return false;
    }
    if (regiao) {
      const onde = normalizar([c.bairro, c.cidade, c.perfil?.pref_regioes].filter(Boolean).join(" "));
      if (!onde.includes(regiao)) return false;
    }
    if (f.combina_imovel && opcoes.imovel) {
      const tem = (c.perfil && temPerfil(c.perfil) && imoveisQueCombinam(c.perfil, [opcoes.imovel]).length > 0) || (c.imoveis ?? []).includes(opcoes.imovel.id);
      if (!tem) return false;
    }
    return true;
  });
}

/** Por que o contato fica fora (sem destino, descadastro, sem autorização) — null = entra. */
export function motivoExclusao(
  c: Contato,
  canal: Canal,
  finalidade: Finalidade,
  soAutorizados: boolean,
  descadastros: Descadastro[],
  consentimentos: Consentimento[] = [],
): string | null {
  if ((canal === "whatsapp" || canal === "sms") && dig9(c.telefone).length < 8) return "Sem telefone";
  if (canal === "email" && !/^[^@\s]+@[^@\s]+$/.test((c.email ?? "").trim())) return "Sem e-mail";
  if (contatoBloqueado(c, canal, finalidade, descadastros, consentimentos)) return "Pediu para não receber";
  if (soAutorizados && c.tipo === "pessoa") {
    const a = c.aceita;
    if (!a || !a[canal] || (finalidade === "ofertas" && !a.marketing)) return "Não autorizou (aba Comunicação)";
  }
  return null;
}

/** A mesma pessoa não recebe duas vezes (lead e cadastro com o mesmo telefone ou e-mail): fica o cadastro. */
export function deduplicar<C extends Contato>(contatos: C[]): C[] {
  const ordenados = [...contatos].sort((a, b) => (a.tipo === b.tipo ? 0 : a.tipo === "pessoa" ? -1 : 1));
  const vistos = new Set<string>();
  const out: C[] = [];
  for (const c of ordenados) {
    const chaves = [`${c.tipo}:${c.id}`];
    const t = dig9(c.telefone);
    if (t.length >= 8) chaves.push(`t:${t}`);
    const e = (c.email ?? "").trim().toLowerCase();
    if (e) chaves.push(`e:${e}`);
    if (chaves.some((k) => vistos.has(k))) continue;
    chaves.forEach((k) => vistos.add(k));
    out.push(c);
  }
  return out;
}

/** Público final: filtros → sem repetidos → fora quem não pode receber. */
export function montarPublico<C extends Contato>(
  contatos: C[],
  f: FiltrosCampanha,
  opcoes: {
    canal: Canal;
    finalidade: Finalidade;
    soAutorizados: boolean;
    descadastros: Descadastro[];
    consentimentos?: Consentimento[];
    agoraMs: number;
    imovel?: ImovelOferta | null;
  },
): { incluidos: C[]; excluidos: { contato: C; motivo: string }[] } {
  const filtrados = deduplicar(filtrarContatos(contatos, f, opcoes));
  const incluidos: C[] = [];
  const excluidos: { contato: C; motivo: string }[] = [];
  for (const c of filtrados) {
    const motivo = motivoExclusao(c, opcoes.canal, opcoes.finalidade, opcoes.soAutorizados, opcoes.descadastros, opcoes.consentimentos ?? []);
    if (motivo) excluidos.push({ contato: c, motivo });
    else incluidos.push(c);
  }
  return { incluidos, excluidos };
}

/** Lê os filtros gravados (jsonb) com tipos seguros. */
export function lerFiltros(j: unknown): FiltrosCampanha {
  const o = (j && typeof j === "object" ? j : {}) as Record<string, unknown>;
  const s = (k: string) => (typeof o[k] === "string" && (o[k] as string).trim() ? (o[k] as string).trim() : undefined);
  const n = Number(o.parado_dias);
  const publico = s("publico");
  return {
    publico: publico === "leads" || publico === "pessoas" ? publico : "ambos",
    funil: s("funil"),
    etapas: Array.isArray(o.etapas) ? (o.etapas as unknown[]).map(String).filter(Boolean) : [],
    origem: s("origem"),
    utm_source: s("utm_source"),
    corretor: s("corretor"),
    parado_dias: Number.isFinite(n) && n > 0 ? Math.trunc(n) : null,
    incluir_perdidos: o.incluir_perdidos === true,
    reativar: o.reativar === true,
    papel: s("papel"),
    regiao: s("regiao"),
    interesse: s("interesse"),
    combina_imovel: o.combina_imovel === true,
  };
}

export function resumoFiltros(f: FiltrosCampanha, rotulos: { origem?: Record<string, string>; papel?: Record<string, string> } = {}): string {
  const partes: string[] = [];
  partes.push(f.publico === "leads" ? "Leads" : f.publico === "pessoas" ? "Pessoas cadastradas" : "Leads e pessoas");
  if (f.funil) partes.push(f.funil === "venda" ? "funil de venda" : "funil de locação");
  if (f.etapas?.length) partes.push(`etapas: ${f.etapas.join(", ")}`);
  if (f.origem) partes.push(`origem ${rotulos.origem?.[f.origem] ?? f.origem}`);
  if (f.utm_source) partes.push(`fonte ${f.utm_source}`);
  if (f.reativar) partes.push("para reativar (perdidos há 30+ dias ou parados há 60+)");
  if (f.parado_dias) partes.push(`sem contato há ${f.parado_dias}+ dias`);
  if (f.incluir_perdidos) partes.push("inclui perdidos");
  if (f.papel) partes.push(rotulos.papel?.[f.papel] ?? f.papel);
  if (f.interesse) partes.push(`quer ${f.interesse}`);
  if (f.regiao) partes.push(`região "${f.regiao}"`);
  if (f.combina_imovel) partes.push("perfil combina com o imóvel");
  return partes.join(" · ");
}

// -----------------------------------------------------------------------------
// Campanhas e fila
// -----------------------------------------------------------------------------
export type SituacaoCampanha = "rascunho" | "agendada" | "enviando" | "concluida" | "cancelada";
export const ROTULO_SITUACAO_CAMPANHA: Record<SituacaoCampanha, string> = {
  rascunho: "Rascunho",
  agendada: "Agendada",
  enviando: "Enviando",
  concluida: "Concluída",
  cancelada: "Cancelada",
};

export function situacaoCampanha(c: { status: string; agendada_para: string | null }, pendentes: number, agoraMs: number): SituacaoCampanha {
  if (c.status === "cancelada") return "cancelada";
  if (c.status !== "fila") return "rascunho";
  if (pendentes === 0) return "concluida";
  if (c.agendada_para && new Date(c.agendada_para).getTime() > agoraMs) return "agendada";
  return "enviando";
}

/** Chave única do envio (não repete a mesma pessoa na mesma campanha/automação). */
export const chaveEnvio = (prefixo: string, c: Pick<Contato, "tipo" | "id">) => `${prefixo}:${c.tipo === "lead" ? "l" : "p"}:${c.id}`;

/** "2026-11-10T09:30" (campo datetime-local, horário de Brasília) → ISO com fuso. */
export function dataHoraLocalParaISO(v: string | null | undefined): string | null {
  if (!v || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)) return null;
  return `${v.slice(0, 16)}:00-03:00`;
}

/** ISO → "2026-11-10T09:30" (para o campo datetime-local, horário de Brasília). */
export function isoParaDataHoraLocal(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "";
  return new Date(t - 3 * 3_600_000).toISOString().slice(0, 16);
}

export function formatarDataHora(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

// -----------------------------------------------------------------------------
// Pesquisa de satisfação (NPS)
// -----------------------------------------------------------------------------
export function classeNota(n: number): "promotor" | "neutro" | "detrator" {
  return n >= 9 ? "promotor" : n >= 7 ? "neutro" : "detrator";
}

/** NPS = % de promotores (9–10) − % de detratores (0–6). */
export function calcularNps(notas: (number | null | undefined)[]) {
  const v = notas.filter((n): n is number => typeof n === "number" && n >= 0 && n <= 10);
  const promotores = v.filter((n) => n >= 9).length;
  const detratores = v.filter((n) => n <= 6).length;
  const neutros = v.length - promotores - detratores;
  return {
    respostas: v.length,
    promotores,
    neutros,
    detratores,
    nps: v.length ? Math.round(((promotores - detratores) / v.length) * 100) : null,
    media: v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null,
  };
}

// -----------------------------------------------------------------------------
// Origem das conversões (UTM, gclid, fbclid)
// -----------------------------------------------------------------------------
export const CAMPOS_UTM = ["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term", "gclid", "fbclid"] as const;
export type CampoUtm = (typeof CAMPOS_UTM)[number];
export type Utm = Partial<Record<CampoUtm, string>>;

/** Lê UTM/gclid/fbclid da URL (limpa e corta). */
export function lerUtm(sp: Record<string, string | string[] | undefined>): Utm {
  const out: Utm = {};
  for (const k of CAMPOS_UTM) {
    const v = sp[k];
    const bruto = Array.isArray(v) ? v[0] : v;
    const s = bruto ? [...bruto].filter((ch) => ch.charCodeAt(0) >= 32 && !'<>"'.includes(ch)).join("").trim() : "";
    if (s) out[k] = s.slice(0, k === "gclid" || k === "fbclid" ? 300 : 200);
  }
  return out;
}

const ORIGENS_VALIDAS = ["site", "whatsapp", "instagram", "facebook", "tiktok", "portal", "zap", "vivareal", "olx", "imovelweb", "indicacao", "placa", "telefone", "email", "visita", "outro"];

/** Origem do lead a partir da UTM (a fonte detalhada fica em utm_source). */
export function origemDaUtm(u: Utm, padrao = "site"): string {
  const s = normalizar(u.utm_source);
  if (/\b(ig|instagram)\b/.test(s)) return "instagram";
  if (/\b(fb|facebook|meta)\b/.test(s) || (!s && u.fbclid)) return "facebook";
  if (/\btiktok\b/.test(s)) return "tiktok";
  if (/\b(wa|whatsapp|zap zap)\b/.test(s)) return "whatsapp";
  if (/\b(email|e mail|newsletter|mail)\b/.test(s)) return "email";
  if (/\bzap\b/.test(s)) return "zap";
  if (/\bvivareal\b|\bviva real\b/.test(s)) return "vivareal";
  if (/\bolx\b/.test(s)) return "olx";
  if (/\bimovelweb\b/.test(s)) return "imovelweb";
  return ORIGENS_VALIDAS.includes(padrao) ? padrao : "site";
}

/** Link com UTM (para colar no anúncio, post ou e-mail). */
export function montarLinkUtm(base: string, u: { source: string; medium: string; campaign?: string | null; content?: string | null }): string {
  const q = new URLSearchParams();
  q.set("utm_source", u.source);
  q.set("utm_medium", u.medium);
  if (u.campaign) q.set("utm_campaign", u.campaign);
  if (u.content) q.set("utm_content", u.content);
  return `${base}${base.includes("?") ? "&" : "?"}${q.toString()}`;
}

export type LeadConversao = {
  id: string;
  status: string;
  etapa_max: number;
  visitas: number;
  propostas: number;
  /** valor do negócio fechado (proposta aceita ou venda), em reais */
  valor: number | null;
};

export type LinhaOrigem = { chave: string; leads: number; visitas: number; propostas: number; negocios: number; conversao: number | null; valor: number };

/** Lead → visita → proposta → negócio, agrupado pela chave (origem, fonte, campanha…). */
export function funilPorOrigem<L extends LeadConversao>(leads: L[], chave: (l: L) => string | null | undefined): LinhaOrigem[] {
  const grupos = new Map<string, L[]>();
  for (const l of leads) {
    const k = (chave(l) ?? "").trim() || "(sem informação)";
    grupos.set(k, [...(grupos.get(k) ?? []), l]);
  }
  return [...grupos.entries()]
    .map(([k, ls]) => {
      const ganho = (l: L) => l.status === "ganho";
      const negocios = ls.filter(ganho).length;
      return {
        chave: k,
        leads: ls.length,
        visitas: ls.filter((l) => ganho(l) || l.etapa_max >= 2 || l.visitas > 0).length,
        propostas: ls.filter((l) => ganho(l) || l.etapa_max >= 3 || l.propostas > 0).length,
        negocios,
        conversao: ls.length ? Math.round((negocios / ls.length) * 1000) / 10 : null,
        valor: paraReais(ls.filter(ganho).reduce((s, l) => s + paraCentavos(l.valor ?? 0), 0)),
      };
    })
    .sort((a, b) => b.leads - a.leads || a.chave.localeCompare(b.chave));
}

const csvCampo = (v: string | number | null | undefined) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Data/hora no horário de Brasília no formato "AAAA-MM-DD HH:MM:SS". */
function horaBrasilia(iso: string): string {
  return new Date(new Date(iso).getTime() - 3 * 3_600_000).toISOString().slice(0, 19).replace("T", " ");
}

/**
 * Conversões offline para o Google Ads (Ferramentas › Conversões › Uploads):
 * modelo oficial com fuso, gclid, nome da conversão, data, valor e moeda.
 */
export function csvConversoesGoogle(linhas: { gclid: string; data: string; valor: number | null }[], nomeConversao: string): string {
  const cab = "Parameters:TimeZone=America/Sao_Paulo\nGoogle Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency";
  const corpo = linhas
    .filter((l) => l.gclid)
    .map((l) => [l.gclid, nomeConversao, horaBrasilia(l.data), l.valor != null ? l.valor.toFixed(2) : "", "BRL"].map(csvCampo).join(","));
  return [cab, ...corpo].join("\n") + "\n";
}

export const normalizarEmail = (e: string | null | undefined) => (e ?? "").trim().toLowerCase();

/** Telefone no padrão internacional só com dígitos (55 + DDD + número). */
export function telefoneE164(t: string | null | undefined): string {
  const d = (t ?? "").replace(/\D/g, "");
  if (!d) return "";
  return d.length <= 11 ? `55${d.replace(/^0+/, "")}` : d;
}

/**
 * Eventos offline para a Meta (Gerenciador de Eventos › Eventos offline ›
 * Carregar): e-mail, telefone, nome, cidade, evento, data (unix), valor e moeda.
 * A Meta criptografa (hash) no envio pelo Gerenciador.
 */
export function csvConversoesMeta(
  linhas: { email: string | null; telefone: string | null; nome: string; cidade?: string | null; evento: string; data: string; valor: number | null }[],
): string {
  const cab = "email,phone,fn,ln,ct,country,event_name,event_time,value,currency";
  const corpo = linhas
    .filter((l) => l.email || l.telefone)
    .map((l) => {
      const partes = normalizar(l.nome).split(" ").filter(Boolean);
      return [
        normalizarEmail(l.email),
        telefoneE164(l.telefone),
        partes[0] ?? "",
        partes.length > 1 ? partes[partes.length - 1] : "",
        normalizar(l.cidade).replace(/ /g, ""),
        "br",
        l.evento,
        Math.floor(new Date(l.data).getTime() / 1000),
        l.valor != null ? l.valor.toFixed(2) : "",
        "BRL",
      ]
        .map(csvCampo)
        .join(",");
    });
  return [cab, ...corpo].join("\n") + "\n";
}

/** IDs de rastreamento aceitos (evita injetar script com texto qualquer). */
export const pixelMetaValido = (id: string | null | undefined) => !!id && /^\d{6,20}$/.test(id.trim());
export const tagGoogleValida = (id: string | null | undefined) => !!id && /^(G|AW|GT)-[A-Z0-9]{4,20}$/i.test(id.trim());
export const rotuloConversaoValido = (r: string | null | undefined) => !!r && /^AW-\d{5,15}\/[\w-]{4,40}$/.test(r.trim());

// -----------------------------------------------------------------------------
// Recomendação de imóveis por perfil
// -----------------------------------------------------------------------------
export function temPerfil(p: PerfilInteresse | null | undefined): boolean {
  if (!p) return false;
  return !!(p.pref_tipos.length || (p.pref_regioes ?? "").trim() || p.pref_valor_max || p.pref_valor_min || p.pref_quartos_min);
}

/** Perfil de busca da pessoa (aba Interesse). */
export function perfilDaPessoa(p: {
  interesse?: string[] | null;
  pref_tipos?: string[] | null;
  pref_regioes?: string | null;
  pref_valor_min?: number | string | null;
  pref_valor_max?: number | string | null;
  pref_quartos_min?: number | null;
}): PerfilInteresse {
  return {
    interesse: p.interesse ?? [],
    pref_tipos: p.pref_tipos ?? [],
    pref_regioes: p.pref_regioes ?? null,
    pref_valor_min: p.pref_valor_min == null ? null : Number(p.pref_valor_min),
    pref_valor_max: p.pref_valor_max == null ? null : Number(p.pref_valor_max),
    pref_quartos_min: p.pref_quartos_min ?? null,
  };
}

export { perfilDoLead };

/** "Alugar · apartamento, casa · Gonzaga · até R$ 3.000,00 · 2+ quartos" */
export function resumoPerfil(p: PerfilInteresse): string {
  const quer = p.interesse.map((i) => ({ alugar: "Alugar", comprar: "Comprar", investir: "Investir" })[i] ?? i).join("/");
  const faixa =
    p.pref_valor_min && p.pref_valor_max
      ? `${formatarReais(p.pref_valor_min)} a ${formatarReais(p.pref_valor_max)}`
      : p.pref_valor_max
        ? `até ${formatarReais(p.pref_valor_max)}`
        : p.pref_valor_min
          ? `a partir de ${formatarReais(p.pref_valor_min)}`
          : null;
  return [quer || null, p.pref_tipos.join(", ") || null, p.pref_regioes?.trim() || null, faixa, p.pref_quartos_min ? `${p.pref_quartos_min}+ quartos` : null]
    .filter(Boolean)
    .join(" · ");
}

/** Imóveis que combinam com o perfil, do mais barato para o mais caro (até `limite`). */
export function recomendarImoveis<T extends ImovelOferta>(perfil: PerfilInteresse, imoveis: T[], limite = 5): T[] {
  if (!temPerfil(perfil)) return [];
  const querComprar = perfil.interesse.includes("comprar") || perfil.interesse.includes("investir");
  const preco = (i: T) => Number((querComprar && !perfil.interesse.includes("alugar") ? i.valor_venda : (i.valor_aluguel ?? i.valor_venda)) ?? Infinity);
  return imoveisQueCombinam(perfil, imoveis)
    .sort((a, b) => preco(a) - preco(b))
    .slice(0, limite);
}

export type ImovelTexto = {
  codigo: string;
  tipo: string;
  bairro: string | null;
  cidade?: string | null;
  quartos: number | null;
  valor_aluguel: number | string | null;
  valor_venda: number | string | null;
  finalidades?: string[];
};

/** Preço que aparece na mensagem: aluguel por mês ou venda. */
export function precoDoImovel(i: Pick<ImovelTexto, "valor_aluguel" | "valor_venda" | "finalidades">, preferir?: "aluguel" | "venda"): string {
  const alug = i.valor_aluguel != null && Number(i.valor_aluguel) > 0 ? Number(i.valor_aluguel) : null;
  const venda = i.valor_venda != null && Number(i.valor_venda) > 0 ? Number(i.valor_venda) : null;
  if (preferir === "venda" && venda) return formatarReais(venda);
  if (alug && preferir !== "venda") return `${formatarReais(alug)}/mês`;
  if (venda) return formatarReais(venda);
  return alug ? `${formatarReais(alug)}/mês` : "valor sob consulta";
}

/** "AP-101 · Apartamento · 2 qtos · Gonzaga" */
export function descricaoImovel(i: ImovelTexto): string {
  const tipo = i.tipo ? i.tipo.charAt(0).toUpperCase() + i.tipo.slice(1) : "";
  return [i.codigo, tipo, i.quartos ? `${i.quartos} qto${i.quartos > 1 ? "s" : ""}` : null, i.bairro].filter(Boolean).join(" · ");
}

/** Lista "• AP-101 · Apartamento · 2 qtos · Gonzaga — R$ 2.500,00/mês" para a variável {{imoveis}}. */
export function listaImoveisTexto(imoveis: ImovelTexto[], preferir?: "aluguel" | "venda"): string {
  return imoveis.map((i) => `• ${descricaoImovel(i)} — ${precoDoImovel(i, preferir)}`).join("\n");
}

/**
 * Sugestão de imóveis: só entra quem tem perfil de busca E pelo menos um imóvel
 * disponível que combina (senão {{imoveis}} sairia vazio).
 */
export function separarPorSugestao<C extends Pick<Contato, "perfil">>(contatos: C[], disponiveis: ImovelOferta[]): { comImoveis: C[]; semPerfil: C[]; semImovel: C[] } {
  const comImoveis: C[] = [];
  const semPerfil: C[] = [];
  const semImovel: C[] = [];
  for (const c of contatos) {
    if (!c.perfil || !temPerfil(c.perfil)) semPerfil.push(c);
    else if (!recomendarImoveis(c.perfil, disponiveis, 1).length) semImovel.push(c);
    else comImoveis.push(c);
  }
  return { comImoveis, semPerfil, semImovel };
}

export type CampoPreco = "aluguel" | "venda";

/**
 * O contato se interessa pelo preço que baixou? Aluguel → quem quer alugar;
 * venda → quem quer comprar ou investir. Sem interesse informado, só quem já
 * demonstrou interesse neste imóvel.
 */
export function interessadoNoPreco(c: Pick<Contato, "perfil" | "imoveis">, campo: CampoPreco, imovelId: string): boolean {
  const quer = c.perfil?.interesse ?? [];
  if (quer.length) return campo === "aluguel" ? quer.includes("alugar") : quer.includes("comprar") || quer.includes("investir");
  return (c.imoveis ?? []).includes(imovelId);
}

export type MudancaPreco = { campo: string; valor_anterior: number | string | null; valor_novo: number | string | null; alterado_em: string };

/**
 * Última redução de preço do imóvel (histórico de preços): olha a mudança mais
 * recente de aluguel e de venda; se ela foi uma queda, vale. Preço que subiu
 * depois não conta como redução.
 */
export function ultimaReducao(historico: MudancaPreco[]): { campo: CampoPreco; anterior: number; novo: number; em: string } | null {
  const achadas: { campo: CampoPreco; anterior: number; novo: number; em: string }[] = [];
  for (const campo of ["aluguel", "venda"] as const) {
    const ultima = historico.filter((h) => h.campo === campo).sort((a, b) => b.alterado_em.localeCompare(a.alterado_em))[0];
    if (!ultima) continue;
    const anterior = Number(ultima.valor_anterior);
    const novo = Number(ultima.valor_novo);
    if (anterior > 0 && novo > 0 && novo < anterior) achadas.push({ campo, anterior, novo, em: ultima.alterado_em });
  }
  return achadas.sort((a, b) => b.em.localeCompare(a.em))[0] ?? null;
}

/** Textos de {{preco}} e {{preco_anterior}} de uma redução ("R$ 2.700,00/mês"). */
export function textosPreco(campo: string | null, anterior: number | string | null, novo: number | string | null): { preco: string | null; precoAnterior: string | null } {
  const sufixo = campo === "aluguel" ? "/mês" : "";
  const fmt = (v: number | string | null) => (v != null && Number(v) > 0 ? `${formatarReais(Number(v))}${sufixo}` : null);
  return { preco: fmt(novo), precoAnterior: fmt(anterior) };
}

/** Contatos com perfil que combina com o imóvel (ou que já demonstraram interesse nele). */
export function contatosParaImovel<C extends Pick<Contato, "perfil" | "imoveis">>(imovel: ImovelOferta, contatos: C[], incluirInteressados = true): C[] {
  return contatos.filter(
    (c) => (incluirInteressados && (c.imoveis ?? []).includes(imovel.id)) || (c.perfil && temPerfil(c.perfil) && imoveisQueCombinam(c.perfil, [imovel]).length > 0),
  );
}

// -----------------------------------------------------------------------------
// Automações
// -----------------------------------------------------------------------------
/** Só dispara para o que venceu há pouco (evita mandar para contratos/vendas antigos ao criar a regra). */
export const JANELA_AUTOMACAO_DIAS = 15;

export function devidoAgora(dataBase: string | null | undefined, dias: number, hoje: string, janela = JANELA_AUTOMACAO_DIAS): boolean {
  if (!dataBase) return false;
  const vence = somarDias(dataBase.slice(0, 10), Math.max(0, dias));
  if (vence > hoje) return false;
  return diasEntre(vence, hoje) <= janela;
}

/** Quanto o preço caiu, em % (uma casa). */
export function reducaoPct(anterior: number | string | null, novo: number | string | null): number {
  const a = Number(anterior);
  const n = Number(novo);
  if (!(a > 0) || !(n >= 0) || n >= a) return 0;
  return Math.round(((a - n) / a) * 1000) / 10;
}

/** Evento antigo e ainda não aproveitado (ex.: imóvel novo que nunca ficou disponível) é descartado. */
export const VALIDADE_EVENTO_DIAS = 30;

// -----------------------------------------------------------------------------
// Landing pages
// -----------------------------------------------------------------------------
export function gerarSlug(texto: string): string {
  return normalizar(texto).replace(/ /g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60).replace(/-$/, "");
}

export const slugValido = (s: string) => /^[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?$/.test(s);

// -----------------------------------------------------------------------------
// Webhook do WhatsApp Business (Cloud API)
// -----------------------------------------------------------------------------
export type MensagemRecebida = { telefone: string; nome: string | null; texto: string | null; tipo: string; externo_id: string | null; data: string };
export type StatusRecebido = { externo_id: string; status: "enviada" | "entregue" | "lida" | "falhou" };

const STATUS_WHATSAPP: Record<string, StatusRecebido["status"]> = { sent: "enviada", delivered: "entregue", read: "lida", failed: "falhou" };

type Obj = Record<string, unknown>;
const obj = (v: unknown): Obj => (v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v : typeof v === "number" ? String(v) : null);

function textoDaMensagem(m: Obj): { tipo: string; texto: string | null } {
  const tipo = str(m.type) ?? "texto";
  switch (tipo) {
    case "text":
      return { tipo: "texto", texto: str(obj(m.text).body) };
    case "button":
      return { tipo: "botao", texto: str(obj(m.button).text) };
    case "interactive": {
      const i = obj(m.interactive);
      return { tipo: "botao", texto: str(obj(i.button_reply).title) ?? str(obj(i.list_reply).title) };
    }
    case "image":
    case "video":
    case "document":
    case "audio":
    case "sticker": {
      const rot: Record<string, string> = { image: "imagem", video: "video", document: "documento", audio: "audio", sticker: "figurinha" };
      const midia = obj(m[tipo]);
      return { tipo: rot[tipo], texto: str(midia.caption) ?? str(midia.filename) };
    }
    case "location": {
      const l = obj(m.location);
      return { tipo: "localizacao", texto: [str(l.name), str(l.address), l.latitude != null ? `${l.latitude},${l.longitude}` : null].filter(Boolean).join(" · ") || null };
    }
    case "reaction":
      return { tipo: "reacao", texto: str(obj(m.reaction).emoji) };
    default:
      return { tipo: tipo.slice(0, 30), texto: null };
  }
}

/** Lê o corpo do webhook da WhatsApp Cloud API (mensagens recebidas e status das enviadas). */
export function lerWebhookWhatsapp(payload: unknown): { mensagens: MensagemRecebida[]; status: StatusRecebido[] } {
  const mensagens: MensagemRecebida[] = [];
  const status: StatusRecebido[] = [];
  for (const e of arr(obj(payload).entry)) {
    for (const ch of arr(obj(e).changes)) {
      const v = obj(obj(ch).value);
      const nomes = new Map<string, string>();
      for (const c of arr(v.contacts)) {
        const wa = str(obj(c).wa_id);
        const nome = str(obj(obj(c).profile).name);
        if (wa && nome) nomes.set(wa, nome);
      }
      for (const raw of arr(v.messages)) {
        const m = obj(raw);
        const tel = (str(m.from) ?? "").replace(/\D/g, "");
        if (tel.length < 8) continue;
        const ts = Number(m.timestamp);
        const { tipo, texto } = textoDaMensagem(m);
        mensagens.push({
          telefone: tel,
          nome: nomes.get(tel) ?? null,
          texto: texto ? texto.slice(0, 4000) : null,
          tipo,
          externo_id: str(m.id),
          data: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
        });
      }
      for (const raw of arr(v.statuses)) {
        const s = obj(raw);
        const id = str(s.id);
        const st = STATUS_WHATSAPP[str(s.status) ?? ""];
        if (id && st) status.push({ externo_id: id, status: st });
      }
    }
  }
  return { mensagens, status };
}

// -----------------------------------------------------------------------------
// Lead Ads (Google formulário de lead / Meta / genérico via Zapier/Make)
// -----------------------------------------------------------------------------
export type LeadAnuncio = {
  plataforma: "google" | "meta" | "outro";
  chave?: string | null;
  teste?: boolean;
  externo_id?: string | null;
  formulario_id?: string | null;
  campanha?: string | null;
  lead?: Record<string, string> | null;
};

/** Webhook do formulário de lead do Google Ads (user_column_data + google_key). */
export function lerLeadGoogle(payload: unknown): LeadAnuncio | null {
  const p = obj(payload);
  if (!Array.isArray(p.user_column_data)) return null;
  const col = new Map<string, string>();
  for (const c of arr(p.user_column_data)) {
    const o = obj(c);
    const id = (str(o.column_id) ?? str(o.column_name) ?? "").toUpperCase();
    const v = str(o.string_value);
    if (id && v) col.set(id, v.trim());
  }
  const nome = col.get("FULL_NAME") ?? [col.get("FIRST_NAME"), col.get("LAST_NAME")].filter(Boolean).join(" ");
  const extras = [...col.entries()]
    .filter(([k]) => !["FULL_NAME", "FIRST_NAME", "LAST_NAME", "EMAIL", "PHONE_NUMBER", "WORK_EMAIL", "WORK_PHONE"].includes(k))
    .map(([k, v]) => `${k.toLowerCase().replace(/_/g, " ")}: ${v}`);
  const campanha = str(p.campaign_id);
  const lead: Record<string, string> = {
    nome: nome || "",
    telefone: col.get("PHONE_NUMBER") ?? col.get("WORK_PHONE") ?? "",
    email: col.get("EMAIL") ?? col.get("WORK_EMAIL") ?? "",
    mensagem: ["Formulário de lead do Google Ads", ...extras].join("\n"),
    origem: "site",
    utm_source: "google",
    utm_medium: "cpc",
    utm_campaign: campanha ? `google-${campanha}` : "google-lead-form",
  };
  const gclid = str(p.gcl_id);
  if (gclid) lead.gclid = gclid;
  return {
    plataforma: "google",
    chave: str(p.google_key),
    teste: p.is_test === true,
    externo_id: str(p.lead_id),
    formulario_id: str(p.form_id),
    campanha,
    lead,
  };
}

/** Aviso do Meta Lead Ads: traz só os ids; os dados do lead vêm da Graph API (precisa do token da página). */
export function lerLeadMeta(payload: unknown): LeadAnuncio[] {
  const out: LeadAnuncio[] = [];
  for (const e of arr(obj(payload).entry)) {
    for (const ch of arr(obj(e).changes)) {
      if (str(obj(ch).field) !== "leadgen") continue;
      const v = obj(obj(ch).value);
      out.push({ plataforma: "meta", externo_id: str(v.leadgen_id), formulario_id: str(v.form_id), campanha: str(v.ad_id) ?? str(v.adgroup_id), lead: null });
    }
  }
  return out;
}

/** Corpo simples (Zapier, Make, site): {nome, telefone, email, mensagem, utm_*…}. */
export function lerLeadGenerico(payload: unknown): LeadAnuncio | null {
  const p = obj(payload);
  const nome = str(p.nome) ?? str(p.name) ?? str(p.full_name);
  if (!nome) return null;
  const lead: Record<string, string> = {
    nome,
    telefone: str(p.telefone) ?? str(p.phone) ?? str(p.phone_number) ?? "",
    email: str(p.email) ?? "",
    mensagem: str(p.mensagem) ?? str(p.message) ?? "",
  };
  for (const k of [...CAMPOS_UTM, "funil", "imovel"]) {
    const v = str(p[k]);
    if (v) lead[k] = v.slice(0, 300);
  }
  const plataforma = normalizar(str(p.plataforma) ?? str(p.platform) ?? lead.utm_source);
  const plat = /facebook|meta|instagram/.test(plataforma) ? "meta" : /google/.test(plataforma) ? "google" : "outro";
  lead.origem = origemDaUtm(lead as Utm, plat === "meta" ? "facebook" : "site");
  // "google" fica para o webhook oficial (com chave); o resto entra como "outro"/"meta".
  return { plataforma: plat === "google" ? "outro" : plat, externo_id: str(p.id) ?? str(p.lead_id), formulario_id: str(p.form_id), campanha: str(p.campaign) ?? lead.utm_campaign ?? null, lead };
}

// -----------------------------------------------------------------------------
// Materiais de divulgação
// -----------------------------------------------------------------------------
export type ImovelMaterial = ImovelTexto & {
  titulo?: string | null;
  descricao?: string | null;
  suites?: number | null;
  banheiros?: number | null;
  vagas?: number | null;
  area_util?: number | string | null;
  valor_condominio?: number | string | null;
  valor_iptu?: number | string | null;
  comodidades?: string[] | null;
  logradouro?: string | null;
  uf?: string | null;
};

/** Principais números do imóvel ("3 quartos", "1 suíte", "85 m²"…). */
export function destaquesImovel(i: ImovelMaterial): string[] {
  const n = (v: number | null | undefined, um: string, varios: string) => (v ? `${v} ${v > 1 ? varios : um}` : null);
  return [
    i.area_util ? `${Number(i.area_util).toLocaleString("pt-BR")} m²` : null,
    n(i.quartos, "quarto", "quartos"),
    n(i.suites, "suíte", "suítes"),
    n(i.banheiros, "banheiro", "banheiros"),
    n(i.vagas, "vaga", "vagas"),
  ].filter((x): x is string => !!x);
}

/** Texto pronto para anúncio, post ou status do WhatsApp. */
export function textoAnuncio(i: ImovelMaterial, contato: { imobiliaria: string; telefone?: string | null; creci?: string | null }): string {
  const tipo = i.tipo ? i.tipo.charAt(0).toUpperCase() + i.tipo.slice(1) : "Imóvel";
  const finalidade = (i.finalidades ?? []).includes("venda") && !(i.finalidades ?? []).some((f) => f === "locacao" || f === "temporada") ? "à venda" : "para alugar";
  const onde = [i.bairro, i.cidade].filter(Boolean).join(", ");
  const linhas = [
    `${i.titulo?.trim() || `${tipo} ${finalidade}${onde ? ` — ${onde}` : ""}`}`,
    destaquesImovel(i).join(" · "),
    (i.comodidades ?? []).length ? `Destaques: ${(i.comodidades ?? []).slice(0, 6).join(" · ")}` : null,
    `Valor: ${precoDoImovel(i, finalidade === "à venda" ? "venda" : undefined)}${i.valor_condominio && Number(i.valor_condominio) > 0 ? ` + condomínio ${formatarReais(Number(i.valor_condominio))}` : ""}`,
    `Código ${i.codigo}`,
    `Fale com a ${contato.imobiliaria}${contato.telefone ? ` — ${contato.telefone}` : ""}${contato.creci ? ` · CRECI ${contato.creci}` : ""}`,
  ];
  return linhas.filter(Boolean).join("\n");
}
