/** Regras puras da captação de imóveis: etapas, checklist e avaliação de mercado. */
import { normalizar } from "./imoveis";

export const ETAPAS_CAPTACAO = ["prospeccao", "contato", "avaliacao", "proposta", "autorizacao", "captado"] as const;
export const TODAS_ETAPAS_CAPTACAO = [...ETAPAS_CAPTACAO, "nao_captado"] as const;
export const ROTULO_ETAPA_CAPTACAO: Record<string, string> = {
  prospeccao: "Prospecção",
  contato: "Em contato",
  avaliacao: "Avaliação",
  proposta: "Proposta",
  autorizacao: "Autorização",
  captado: "Captado",
  nao_captado: "Não captado",
};
export const ordemEtapaCaptacao = (e: string) => (ETAPAS_CAPTACAO as readonly string[]).indexOf(e);

export const ORIGENS_CAPTACAO: Record<string, string> = {
  indicacao: "Indicação",
  placa: "Placa / faixa",
  prospeccao: "Prospecção ativa",
  site: "Site",
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  portal: "Portal",
  carteira: "Cliente da carteira",
  outro: "Outro",
};

export const MOTIVOS_NAO_CAPTADO = [
  "Proprietário fechou com outra imobiliária",
  "Valor pretendido muito acima do mercado",
  "Não aceitou a taxa / comissão",
  "Desistiu de alugar/vender",
  "Documentação irregular",
  "Imóvel fora do perfil da imobiliária",
  "Sem retorno do proprietário",
  "Outro",
];

/** Documentos que a captação deve reunir (checklist). */
export const CHECKLIST_CAPTACAO: { id: string; rotulo: string }[] = [
  { id: "doc_proprietario", rotulo: "Documento do proprietário (RG/CNH ou contrato social)" },
  { id: "matricula", rotulo: "Matrícula atualizada" },
  { id: "iptu", rotulo: "Carnê / certidão de IPTU" },
  { id: "condominio", rotulo: "Declaração de condomínio quitado" },
  { id: "contas", rotulo: "Contas de água e luz" },
  { id: "certidoes", rotulo: "Certidões negativas" },
  { id: "planta", rotulo: "Planta / habite-se" },
  { id: "autorizacao_assinada", rotulo: "Autorização de comercialização assinada" },
];

export function progressoChecklist(marcados: Record<string, boolean> | null | undefined) {
  const feitos = CHECKLIST_CAPTACAO.filter((c) => marcados?.[c.id]).length;
  return { feitos, total: CHECKLIST_CAPTACAO.length, pct: Math.round((feitos / CHECKLIST_CAPTACAO.length) * 100) };
}

export type Amostra = { descricao: string; valor: number; area: number | null; finalidade: "locacao" | "venda"; fonte: string };

const mediana = (xs: number[]) => {
  if (!xs.length) return null;
  const o = [...xs].sort((a, b) => a - b);
  const m = Math.floor(o.length / 2);
  return o.length % 2 ? o[m] : (o[m - 1] + o[m]) / 2;
};

/**
 * Avaliação de mercado: pega imóveis parecidos do cadastro (mesmo tipo e região)
 * + comparativos digitados, calcula o R$/m² mediano e sugere o valor.
 */
export function avaliacaoMercado(
  alvo: { tipo: string; bairro: string | null; cidade: string | null; area: number | null; quartos: number | null },
  cadastro: { codigo: string; tipo: string; bairro: string | null; cidade: string | null; area: number | null; quartos: number | null; valor_aluguel: number | null; valor_venda: number | null }[],
  manuais: Amostra[],
) {
  const mesmaRegiao = (b: string | null, c: string | null) =>
    (alvo.bairro && normalizar(b) === normalizar(alvo.bairro)) || (!alvo.bairro && alvo.cidade && normalizar(c) === normalizar(alvo.cidade));
  const parecidos = cadastro.filter(
    (i) =>
      normalizar(i.tipo) === normalizar(alvo.tipo) &&
      mesmaRegiao(i.bairro, i.cidade) &&
      (alvo.quartos == null || i.quartos == null || Math.abs(i.quartos - alvo.quartos) <= 1),
  );
  const amostras: Amostra[] = [
    ...manuais,
    ...parecidos.flatMap((i) => [
      ...(i.valor_aluguel ? [{ descricao: i.codigo, valor: Number(i.valor_aluguel), area: i.area, finalidade: "locacao" as const, fonte: "Cadastro" }] : []),
      ...(i.valor_venda ? [{ descricao: i.codigo, valor: Number(i.valor_venda), area: i.area, finalidade: "venda" as const, fonte: "Cadastro" }] : []),
    ]),
  ];
  const calc = (fin: "locacao" | "venda") => {
    const daqui = amostras.filter((a) => a.finalidade === fin);
    const porM2 = daqui.filter((a) => a.area && a.area > 0).map((a) => a.valor / Number(a.area));
    const m2 = mediana(porM2);
    const valores = daqui.map((a) => a.valor);
    const sugerido = m2 && alvo.area ? Math.round((m2 * alvo.area) / 10) * 10 : mediana(valores);
    return {
      amostras: daqui.length,
      precoM2: m2 === null ? null : Math.round(m2 * 100) / 100,
      sugerido: sugerido === null ? null : Math.round(sugerido),
      minimo: valores.length ? Math.min(...valores) : null,
      maximo: valores.length ? Math.max(...valores) : null,
    };
  };
  return { amostras, locacao: calc("locacao"), venda: calc("venda") };
}

/** Sugere o próximo código de imóvel seguindo o padrão mais usado (ex.: AP-012 → AP-013). */
export function sugerirCodigo(codigos: string[], tipo = "imovel"): string {
  const usados = new Set(codigos.map((c) => c.toUpperCase()));
  const contagem = new Map<string, { n: number; max: number; largura: number }>();
  for (const c of codigos) {
    const m = /^(.*?)(\d+)$/.exec(c.trim().toUpperCase());
    if (!m) continue;
    const atual = contagem.get(m[1]) ?? { n: 0, max: 0, largura: 0 };
    atual.n++;
    atual.max = Math.max(atual.max, Number(m[2]));
    atual.largura = Math.max(atual.largura, m[2].length);
    contagem.set(m[1], atual);
  }
  const melhor = [...contagem.entries()].sort((a, b) => b[1].n - a[1].n)[0];
  const [prefixo, info] = melhor ?? [`${normalizar(tipo).slice(0, 2).toUpperCase() || "IM"}-`, { max: 0, largura: 3 }];
  for (let i = info.max + 1; ; i++) {
    const cod = `${prefixo}${String(i).padStart(info.largura, "0")}`;
    if (!usados.has(cod)) return cod;
  }
}

export type CaptacaoResumo = { status: string; etapa_max: number; corretor_id: string | null; origem: string; exclusivo: boolean; motivo_nao_captado: string | null };

/** Números da captação agrupados (por corretor, origem…). Taxa = captados ÷ (captados + não captados). */
export function resumoCaptacoes(lista: CaptacaoResumo[], chave: (c: CaptacaoResumo) => string) {
  const grupos = new Map<string, CaptacaoResumo[]>();
  for (const c of lista) grupos.set(chave(c), [...(grupos.get(chave(c)) ?? []), c]);
  return [...grupos.entries()]
    .map(([k, cs]) => {
      const captados = cs.filter((c) => c.status === "captado").length;
      const nao = cs.filter((c) => c.status === "nao_captado").length;
      return {
        chave: k,
        total: cs.length,
        abertos: cs.length - captados - nao,
        captados,
        naoCaptados: nao,
        exclusivos: cs.filter((c) => c.status === "captado" && c.exclusivo).length,
        taxa: captados + nao ? Math.round((captados / (captados + nao)) * 100) : null,
      };
    })
    .sort((a, b) => b.captados - a.captados || b.total - a.total);
}

/** Quantas oportunidades chegaram a cada etapa (usa a etapa máxima atingida). */
export function funilCaptacao(lista: CaptacaoResumo[]) {
  return ETAPAS_CAPTACAO.map((e, i) => {
    const chegaram = lista.filter((c) => (c.status === "captado" ? 5 : c.etapa_max) >= i).length;
    return { etapa: e, chegaram, pct: lista.length ? Math.round((chegaram / lista.length) * 100) : 0 };
  });
}
