/**
 * Regras das vistorias (nos dois modos): checklist padrão por tipo de
 * ambiente, ambientes sugeridos pelo cadastro do imóvel, andamento do
 * checklist, comparação entrada × saída, consumo dos medidores, totais de
 * reparo (em centavos) para o acerto de saída, prazo de contestação, texto
 * do laudo para assinatura e a fila de alterações do app de campo (offline).
 */
import { formatarDataBR, somarDias, type DataISO } from "./datas";
import { formatarReais, paraCentavos, paraReais, type Centavos } from "./dinheiro";
import { planoFinanceiro, type Modo } from "./manutencao";

// Tipos e situações ---------------------------------------------------------------
export const TIPOS_VISTORIA = ["entrada", "saida", "periodica"] as const;
export type TipoVistoria = (typeof TIPOS_VISTORIA)[number];
export const ROTULO_TIPO_VISTORIA: Record<string, string> = {
  entrada: "Entrada",
  saida: "Saída",
  periodica: "Periódica",
};

export const STATUS_VISTORIA = ["rascunho", "em_andamento", "concluida", "assinada", "contestada"] as const;
export type StatusVistoria = (typeof STATUS_VISTORIA)[number];
export const ROTULO_STATUS_VISTORIA: Record<string, string> = {
  rascunho: "Agendada",
  em_andamento: "Em andamento",
  concluida: "Concluída",
  assinada: "Assinada",
  contestada: "Contestada",
};
export const COR_STATUS_VISTORIA: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  rascunho: "cinza",
  em_andamento: "azul",
  concluida: "amarelo",
  assinada: "verde",
  contestada: "vermelho",
};

/** Vistoria ainda pode ser preenchida (checklist, fotos, medidores). */
export const vistoriaEditavel = (status: string) => status === "rascunho" || status === "em_andamento";

/**
 * Mudanças de situação que a pessoa pode fazer (assinada vem do laudo;
 * contestada, do locatário). Assinada ainda pode ser reaberta para corrigir
 * (ex.: contestação aceita): o laudo assinado fica em Documentos como
 * histórico e um laudo novo é gerado depois.
 */
export function proximosStatus(status: string): StatusVistoria[] {
  switch (status) {
    case "rascunho":
      return ["em_andamento"];
    case "em_andamento":
      return ["concluida"];
    case "concluida":
      return ["em_andamento", "assinada"];
    case "contestada":
    case "assinada":
      return ["em_andamento"];
    default:
      return [];
  }
}

export const ESTADOS_ITEM = ["novo", "bom", "regular", "ruim", "danificado", "nao_se_aplica"] as const;
export type EstadoItem = (typeof ESTADOS_ITEM)[number];
export const ROTULO_ESTADO: Record<string, string> = {
  novo: "Novo",
  bom: "Bom",
  regular: "Regular",
  ruim: "Ruim",
  danificado: "Danificado",
  nao_se_aplica: "Não se aplica",
};
export const COR_ESTADO: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  novo: "azul",
  bom: "verde",
  regular: "amarelo",
  ruim: "vermelho",
  danificado: "vermelho",
  nao_se_aplica: "cinza",
};
/** Nota do estado (maior = melhor); "não se aplica" e vazio não entram na comparação. */
const PESO_ESTADO: Record<string, number> = { novo: 5, bom: 4, regular: 3, ruim: 2, danificado: 1 };
export const estadoComDano = (e: string | null | undefined) => e === "ruim" || e === "danificado";

export const TIPOS_MEDIDOR = ["agua", "energia", "gas"] as const;
export const ROTULO_MEDIDOR: Record<string, string> = { agua: "Água", energia: "Energia elétrica", gas: "Gás" };
export const UNIDADE_MEDIDOR: Record<string, string> = { agua: "m³", energia: "kWh", gas: "m³" };

export const ROTULO_RESPONSAVEL: Record<string, string> = {
  locatario: "Locatário",
  proprietario: "Proprietário",
  imobiliaria: "Imobiliária",
  ninguem: "Ninguém (desgaste natural)",
};
/** Quem pode responder por um reparo em cada modo (no pessoal o dono é o proprietário). */
export function responsaveisDoModo(pessoal: boolean): { valor: string; rotulo: string }[] {
  return pessoal
    ? [
        { valor: "locatario", rotulo: "Locatário" },
        { valor: "proprietario", rotulo: "Eu (dono do imóvel)" },
        { valor: "ninguem", rotulo: ROTULO_RESPONSAVEL.ninguem },
      ]
    : (["locatario", "proprietario", "imobiliaria", "ninguem"] as const).map((v) => ({ valor: v, rotulo: ROTULO_RESPONSAVEL[v] }));
}
export const ROTULO_STATUS_PENDENCIA: Record<string, string> = {
  aberta: "Aberta",
  em_reparo: "Em reparo",
  resolvida: "Resolvida",
  cancelada: "Cancelada",
};
export const ROTULO_DECISAO: Record<string, string> = {
  aceita: "Aceita (o laudo será corrigido)",
  parcial: "Aceita em parte",
  mantida: "Mantida (o laudo está correto)",
};

// Ambientes e checklist ---------------------------------------------------------
const BASE = ["Paredes", "Pintura", "Teto", "Piso", "Rodapé", "Portas", "Janelas e vidros", "Fechaduras e chaves", "Elétrica (tomadas e interruptores)", "Iluminação"];
const MOLHADA = ["Paredes e azulejos", "Teto", "Piso", "Portas", "Janela / ventilação", "Elétrica (tomadas e interruptores)", "Iluminação", "Hidráulica (vazamentos e ralos)"];

export const TIPOS_AMBIENTE: Record<string, { rotulo: string; itens: string[] }> = {
  sala: { rotulo: "Sala", itens: [...BASE, "Cortinas / persianas", "Móveis (se mobiliado)"] },
  quarto: { rotulo: "Quarto", itens: [...BASE, "Armários embutidos", "Móveis (se mobiliado)"] },
  cozinha: { rotulo: "Cozinha", itens: [...MOLHADA, "Bancada e pia", "Torneira", "Armários", "Instalação de gás", "Fogão / cooktop", "Coifa / exaustor"] },
  banheiro: { rotulo: "Banheiro", itens: [...MOLHADA, "Box", "Vaso sanitário e descarga", "Pia e gabinete", "Torneiras e chuveiro", "Espelho", "Metais e acessórios"] },
  lavabo: { rotulo: "Lavabo", itens: [...MOLHADA, "Vaso sanitário e descarga", "Pia e torneira", "Espelho"] },
  area_servico: { rotulo: "Área de serviço", itens: [...MOLHADA, "Tanque", "Torneiras", "Ponto da máquina de lavar", "Varal", "Aquecedor"] },
  varanda: { rotulo: "Varanda / sacada", itens: ["Piso", "Paredes", "Guarda-corpo", "Vidros / fechamento", "Iluminação", "Ralo", "Churrasqueira"] },
  garagem: { rotulo: "Garagem", itens: ["Piso", "Paredes", "Portão", "Controle remoto", "Iluminação"] },
  area_externa: { rotulo: "Área externa", itens: ["Muros", "Portão", "Jardim", "Calçada", "Iluminação externa", "Telhado e calhas", "Piscina"] },
  escritorio: { rotulo: "Escritório", itens: BASE },
  corredor: { rotulo: "Corredor / hall", itens: ["Paredes", "Pintura", "Teto", "Piso", "Iluminação", "Elétrica (tomadas e interruptores)"] },
  salao: { rotulo: "Salão comercial", itens: [...BASE, "Vitrine / fachada", "Porta de enrolar", "Ar-condicionado"] },
  deposito: { rotulo: "Depósito", itens: ["Paredes", "Piso", "Teto", "Portas", "Iluminação"] },
  outro: { rotulo: "Outro", itens: ["Paredes", "Pintura", "Teto", "Piso", "Portas", "Janelas e vidros", "Elétrica (tomadas e interruptores)", "Iluminação"] },
};

export const checklistDoAmbiente = (tipo: string) => (TIPOS_AMBIENTE[tipo] ?? TIPOS_AMBIENTE.outro).itens;

/** Ambientes a criar a partir do cadastro do imóvel (tipo, quartos, banheiros, vagas). */
export function ambientesSugeridos(im: { tipo?: string | null; quartos?: number | null; banheiros?: number | null; vagas?: number | null }): { nome: string; tipo: string }[] {
  const t = (im.tipo ?? "").toLowerCase();
  const lista: { nome: string; tipo: string }[] = [];
  const varios = (qtd: number, nome: string, tipo: string) => {
    for (let i = 1; i <= qtd; i++) lista.push({ nome: qtd > 1 ? `${nome} ${i}` : nome, tipo });
  };
  if (["sala comercial", "loja", "galpão"].includes(t)) {
    lista.push({ nome: t === "galpão" ? "Galpão" : "Salão", tipo: "salao" });
    varios(Math.max(1, im.banheiros ?? 1), "Banheiro", "banheiro");
    if ((im.vagas ?? 0) > 0) lista.push({ nome: "Garagem", tipo: "garagem" });
    return lista;
  }
  if (t === "terreno") return [{ nome: "Área externa", tipo: "area_externa" }];
  lista.push({ nome: "Sala", tipo: "sala" }, { nome: "Cozinha", tipo: "cozinha" });
  varios(t === "kitnet/studio" ? 0 : Math.max(1, im.quartos ?? 1), "Quarto", "quarto");
  varios(Math.max(1, im.banheiros ?? 1), "Banheiro", "banheiro");
  lista.push({ nome: "Área de serviço", tipo: "area_servico" });
  if ((im.vagas ?? 0) > 0) lista.push({ nome: "Garagem", tipo: "garagem" });
  if (t.startsWith("casa") || t === "sítio/chácara") lista.push({ nome: "Área externa", tipo: "area_externa" });
  return lista;
}

// Andamento do checklist --------------------------------------------------------
export type ItemEstado = { estado: string | null };

export function progressoVistoria(itens: ItemEstado[]) {
  const porEstado: Record<string, number> = {};
  let avaliados = 0;
  let danos = 0;
  for (const i of itens) {
    if (!i.estado) continue;
    avaliados++;
    porEstado[i.estado] = (porEstado[i.estado] ?? 0) + 1;
    if (estadoComDano(i.estado)) danos++;
  }
  const total = itens.length;
  return { total, avaliados, faltam: total - avaliados, pct: total ? Math.round((avaliados / total) * 100) : 0, danos, porEstado };
}

// Comparação entre duas vistorias (ex.: entrada × saída) ----------------------
const chave = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

export type AmbienteComparavel = { nome: string; itens: { id?: string; nome: string; estado: string | null; observacao?: string | null }[] };
export type SituacaoComparacao = "piorou" | "melhorou" | "igual" | "sem_avaliacao" | "item_novo" | "nao_vistoriado";
export const ROTULO_SITUACAO_COMPARACAO: Record<SituacaoComparacao, string> = {
  piorou: "Piorou",
  melhorou: "Melhorou",
  igual: "Igual",
  sem_avaliacao: "Sem avaliação",
  item_novo: "Só na atual",
  nao_vistoriado: "Não vistoriado agora",
};
export type LinhaComparacao = {
  ambiente: string;
  item: string;
  itemId: string | null;
  antes: string | null;
  depois: string | null;
  obsAntes: string | null;
  obsDepois: string | null;
  situacao: SituacaoComparacao;
};

/**
 * Compara a vistoria de referência (antes) com a atual (depois), casando
 * ambiente e item pelo nome (sem acento e sem diferença de maiúsculas).
 */
export function compararVistorias(antes: AmbienteComparavel[], depois: AmbienteComparavel[]) {
  const mapaAntes = new Map<string, { ambiente: string; item: AmbienteComparavel["itens"][number] }>();
  for (const a of antes) for (const i of a.itens) mapaAntes.set(`${chave(a.nome)}|${chave(i.nome)}`, { ambiente: a.nome, item: i });
  const linhas: LinhaComparacao[] = [];
  const vistos = new Set<string>();
  for (const a of depois)
    for (const i of a.itens) {
      const k = `${chave(a.nome)}|${chave(i.nome)}`;
      vistos.add(k);
      const ant = mapaAntes.get(k);
      let situacao: SituacaoComparacao;
      if (!ant) situacao = "item_novo";
      else {
        const pa = PESO_ESTADO[ant.item.estado ?? ""];
        const pd = PESO_ESTADO[i.estado ?? ""];
        situacao = pa === undefined || pd === undefined ? "sem_avaliacao" : pd < pa ? "piorou" : pd > pa ? "melhorou" : "igual";
      }
      linhas.push({
        ambiente: a.nome,
        item: i.nome,
        itemId: i.id ?? null,
        antes: ant?.item.estado ?? null,
        depois: i.estado,
        obsAntes: ant?.item.observacao ?? null,
        obsDepois: i.observacao ?? null,
        situacao,
      });
    }
  for (const [k, v] of mapaAntes)
    if (!vistos.has(k))
      linhas.push({ ambiente: v.ambiente, item: v.item.nome, itemId: null, antes: v.item.estado, depois: null, obsAntes: v.item.observacao ?? null, obsDepois: null, situacao: "nao_vistoriado" });
  const contagem = { piorou: 0, melhorou: 0, igual: 0, sem_avaliacao: 0, item_novo: 0, nao_vistoriado: 0 } as Record<SituacaoComparacao, number>;
  for (const l of linhas) contagem[l.situacao]++;
  return { linhas, contagem };
}

/** Consumo entre duas leituras, casando o medidor pelo tipo e número (ou só pelo tipo, se houver um só). */
export function consumoMedidores(
  antes: { tipo: string; numero: string | null; leitura: number | null }[],
  depois: { tipo: string; numero: string | null; leitura: number | null }[],
) {
  return depois.map((m) => {
    const mesmoTipo = antes.filter((a) => a.tipo === m.tipo);
    const par = mesmoTipo.find((a) => m.numero && a.numero && chave(a.numero) === chave(m.numero)) ?? (mesmoTipo.length === 1 ? mesmoTipo[0] : undefined);
    const consumo = par && par.leitura !== null && m.leitura !== null ? Math.round((m.leitura - par.leitura) * 1000) / 1000 : null;
    return { tipo: m.tipo, numero: m.numero, antes: par?.leitura ?? null, depois: m.leitura, consumo };
  });
}

// Reparos e acerto ---------------------------------------------------------------
export type PendenciaValor = {
  responsavel: string;
  status: string;
  valor_estimado: number | string | null;
  orcamentos: { valor: number | string; aprovado: boolean }[];
};

/** Valor de um reparo: o orçamento aprovado; sem ele, o valor estimado. */
export function valorPendencia(p: PendenciaValor): Centavos {
  const aprovado = p.orcamentos.find((o) => o.aprovado);
  return aprovado ? paraCentavos(aprovado.valor) : paraCentavos(p.valor_estimado);
}

/** Totais por responsável (centavos), sem as canceladas; "paraAcerto" = o que é do locatário. */
export function totaisReparos(pendencias: PendenciaValor[]) {
  const porResponsavel: Record<string, Centavos> = { locatario: 0, proprietario: 0, imobiliaria: 0, ninguem: 0 };
  let comOrcamentoAprovado = 0;
  let abertas = 0;
  for (const p of pendencias) {
    if (p.status === "cancelada") continue;
    porResponsavel[p.responsavel] = (porResponsavel[p.responsavel] ?? 0) + valorPendencia(p);
    if (p.orcamentos.some((o) => o.aprovado)) comOrcamentoAprovado++;
    if (p.status === "aberta" || p.status === "em_reparo") abertas++;
  }
  const total = Object.values(porResponsavel).reduce((a, b) => a + b, 0);
  return { porResponsavel, total, paraAcerto: porResponsavel.locatario, comOrcamentoAprovado, abertas };
}

// Contestação -------------------------------------------------------------------
export const prazoContestacao = (base: DataISO, dias: number): DataISO => somarDias(base, Math.max(0, dias));
export const contestacaoAberta = (prazo: DataISO | null, hoje: DataISO) => !prazo || hoje <= prazo;

// Laudo para assinatura ---------------------------------------------------------
export type DadosLaudo = {
  numero: number;
  tipo: string;
  data: DataISO;
  imovel: { codigo: string; endereco: string; cidade: string | null };
  contratoNumero: number | null;
  locatarios: string[];
  locadores: string[];
  responsavel: string | null;
  acompanhante: string | null;
  organizacao: string;
  ambientes: { nome: string; observacoes: string | null; itens: { nome: string; estado: string | null; observacao: string | null }[] }[];
  medidores: { tipo: string; numero: string | null; leitura: number | null }[];
  pendencias: { descricao: string; ambiente: string | null; responsavel: string; valor: Centavos }[];
  fotos: number;
  videos: number;
  comparacao?: { referencia: number; pioraram: { ambiente: string; item: string; antes: string | null; depois: string | null }[] } | null;
  observacoes: string | null;
  conclusao: string | null;
  contestacaoAte: DataISO | null;
  dataExtenso: string;
};

const num = (n: number) => String(n).replace(".", ",");

/**
 * Texto do laudo no formato dos documentos ("# " título, **negrito**,
 * parágrafos separados por linha em branco), pronto para assinatura eletrônica.
 */
export function textoLaudo(d: DadosLaudo): string {
  const b: string[] = [];
  b.push(`# LAUDO DE VISTORIA DE ${ROTULO_TIPO_VISTORIA[d.tipo]?.toUpperCase() ?? "IMÓVEL"} Nº ${d.numero}`);
  const partes = [
    `**Imóvel:** ${d.imovel.codigo}${d.imovel.endereco ? ` — ${d.imovel.endereco}` : ""}`,
    d.contratoNumero ? `**Contrato de locação:** nº ${d.contratoNumero}` : null,
    d.locadores.length ? `**Locador(es):** ${d.locadores.join(", ")}` : null,
    d.locatarios.length ? `**Locatário(s):** ${d.locatarios.join(", ")}` : null,
    `**Data da vistoria:** ${formatarDataBR(d.data)}`,
    d.responsavel ? `**Vistoria feita por:** ${d.responsavel}` : null,
    d.acompanhante ? `**Acompanhou:** ${d.acompanhante}` : null,
  ].filter(Boolean);
  b.push(partes.join("\n"));
  b.push(
    "Estados usados: Novo; Bom (sem defeitos, com desgaste normal); Regular (marcas de uso, funciona); Ruim (precisa de reparo); Danificado (quebrado ou sem funcionar); Não se aplica.",
  );
  if (d.medidores.length)
    b.push(
      ["**Leitura dos medidores**", ...d.medidores.map((m) => `${ROTULO_MEDIDOR[m.tipo] ?? m.tipo}${m.numero ? ` (nº ${m.numero})` : ""}: ${m.leitura === null ? "sem leitura" : `${num(m.leitura)} ${UNIDADE_MEDIDOR[m.tipo] ?? ""}`}`)].join("\n"),
    );
  d.ambientes.forEach((a, i) => {
    const linhas = a.itens.map((it) => `${it.nome}: ${it.estado ? ROTULO_ESTADO[it.estado] : "não avaliado"}${it.observacao ? ` — ${it.observacao}` : ""}`);
    b.push([`**${i + 1}. ${a.nome}**`, ...linhas, a.observacoes ? `Observações: ${a.observacoes}` : null].filter(Boolean).join("\n"));
  });
  if (d.comparacao)
    b.push(
      d.comparacao.pioraram.length
        ? [
            `**Comparação com a vistoria nº ${d.comparacao.referencia}** — itens que pioraram:`,
            ...d.comparacao.pioraram.map((p) => `${p.ambiente} · ${p.item}: ${p.antes ? ROTULO_ESTADO[p.antes] : "—"} → ${p.depois ? ROTULO_ESTADO[p.depois] : "—"}`),
          ].join("\n")
        : `**Comparação com a vistoria nº ${d.comparacao.referencia}:** nenhum item piorou.`,
    );
  if (d.pendencias.length)
    b.push(
      [
        "**Danos e pendências**",
        ...d.pendencias.map(
          (p, i) => `${i + 1}. ${p.descricao}${p.ambiente ? ` (${p.ambiente})` : ""} — responsável: ${ROTULO_RESPONSAVEL[p.responsavel] ?? p.responsavel}${p.valor ? ` — ${formatarReais(paraReais(p.valor))}` : ""}`,
        ),
      ].join("\n"),
    );
  if (d.fotos || d.videos)
    b.push(`**Registro fotográfico:** ${d.fotos} foto(s)${d.videos ? ` e ${d.videos} vídeo(s)` : ""}, identificados por ambiente, item, legenda, data e hora, fazem parte deste laudo (versão completa em PDF).`);
  if (d.observacoes) b.push(`**Observações:** ${d.observacoes}`);
  if (d.conclusao) b.push(`**Conclusão:** ${d.conclusao}`);
  b.push(
    `As partes conferiram o estado do imóvel descrito neste laudo, que integra o contrato de locação.${
      d.contestacaoAte ? ` O locatário pode contestar qualquer item até ${formatarDataBR(d.contestacaoAte)}, pelo link enviado por ${d.organizacao}.` : ""
    }`,
  );
  b.push(`${d.imovel.cidade ? `${d.imovel.cidade}, ` : ""}${d.dataExtenso}.`);
  return b.join("\n\n");
}

// App de campo: fila de alterações feitas sem internet --------------------------
export type OpCampo =
  | { op: "item"; id: string; ambienteId: string; estado: string | null; observacao: string | null }
  | { op: "ambiente"; id: string; nome: string; tipo: string; itens: { id: string; nome: string }[] }
  | { op: "ambiente_obs"; id: string; observacoes: string | null }
  | { op: "medidor"; id: string; tipo: string; numero: string | null; leitura: number | null }
  | { op: "foto"; id: string; ambienteId: string | null; itemId: string | null; medidorId: string | null; tipo: "foto" | "video"; legenda: string | null; nome: string; mime: string; tiradaEm: string; path?: string }
  | { op: "status"; status: "em_andamento" | "concluida" };

/** Identifica a alteração na fila (a mais nova do mesmo item/ambiente/medidor/foto substitui a anterior). */
export const chaveOp = (o: OpCampo) => (o.op === "foto" ? `foto|${o.id}` : o.op === "status" ? "status" : `${o.op}|${o.id}`);

/**
 * Alteração que o servidor não aceitou na sincronização:
 * - "travada": a vistoria já foi concluída/assinada no sistema (reabrir e tentar de novo);
 * - "invalida": o ambiente/item foi excluído no computador ou o dado não vale;
 * - "erro": falha ao gravar (pode tentar de novo).
 */
export type TipoRecusa = "travada" | "invalida" | "erro";
export type RecusaCampo = { chave: string; motivo: string; tipo: TipoRecusa };
export type OpRecusada = { op: OpCampo; motivo: string; tipo: TipoRecusa; descricao: string };

/**
 * Depois de enviar a fila: tira dela o que foi enviado (mas mantém o que
 * mudou enquanto enviava), separa o que o servidor aceitou (para atualizar a
 * tela) e o que recusou (para mostrar à pessoa, que tenta de novo ou descarta).
 * Nada recusado volta para a fila sozinho, então uma alteração ruim não trava
 * as outras.
 */
export function separarResultado(filaAtual: OpCampo[], enviadas: OpCampo[], recusas: RecusaCampo[]) {
  const json = new Set(enviadas.map((o) => JSON.stringify(o)));
  const resto = filaAtual.filter((o) => !json.has(JSON.stringify(o)));
  const recusa = new Map(recusas.map((r) => [r.chave, r]));
  const ficou = new Set(resto.map(chaveOp));
  const aceitas: OpCampo[] = [];
  const recusadas: { op: OpCampo; motivo: string; tipo: TipoRecusa }[] = [];
  for (const o of enviadas) {
    const r = recusa.get(chaveOp(o));
    if (!r) aceitas.push(o);
    // Se a pessoa mudou de novo enquanto enviava, a versão nova segue na fila.
    else if (!ficou.has(chaveOp(o))) recusadas.push({ op: o, motivo: r.motivo, tipo: r.tipo });
  }
  return { resto, aceitas, recusadas };
}

/**
 * Vínculos de uma foto tirada no aparelho que ainda existem no sistema (o
 * ambiente, o item ou o medidor pode ter sido excluído no computador enquanto
 * o celular estava sem internet). O item manda no ambiente. A foto é guardada
 * mesmo assim, sem o vínculo perdido.
 */
export function vinculosDaFoto(
  o: { ambienteId: string | null; itemId: string | null; medidorId: string | null },
  existe: { ambientes: Set<string>; itens: Map<string, string>; medidores: Set<string> },
) {
  const itemId = o.itemId && existe.itens.has(o.itemId) ? o.itemId : null;
  const ambienteId = itemId ? (existe.itens.get(itemId) as string) : o.ambienteId && existe.ambientes.has(o.ambienteId) ? o.ambienteId : null;
  const medidorId = o.medidorId && existe.medidores.has(o.medidorId) ? o.medidorId : null;
  const perdidos = [
    o.ambienteId && !ambienteId ? "ambiente" : null,
    o.itemId && !itemId ? "item" : null,
    o.medidorId && !medidorId ? "medidor" : null,
  ].filter((x): x is string => Boolean(x));
  return { ambienteId, itemId, medidorId, perdidos };
}

/** Junta uma alteração na fila: a mais nova do mesmo item/ambiente/medidor substitui a anterior (mantendo a posição). */
export function juntarOp(fila: OpCampo[], nova: OpCampo): OpCampo[] {
  const k = chaveOp(nova);
  const i = fila.findIndex((o) => chaveOp(o) === k);
  if (i < 0) return [...fila, nova];
  const copia = [...fila];
  copia[i] = nova.op === "ambiente" ? nova : ({ ...copia[i], ...nova } as OpCampo);
  return copia;
}

export type AmbienteCampo = {
  id: string;
  nome: string;
  tipo: string;
  observacoes: string | null;
  itens: { id: string; nome: string; estado: string | null; observacao: string | null }[];
};
export type MedidorCampo = { id: string; tipo: string; numero: string | null; leitura: number | null };

/** Aplica sobre os dados do servidor o que ainda está na fila do aparelho (para não "sumir" ao reabrir). */
export function aplicarFila(ambientes: AmbienteCampo[], medidores: MedidorCampo[], fila: OpCampo[]) {
  let amb = ambientes.map((a) => ({ ...a, itens: a.itens.map((i) => ({ ...i })) }));
  let med = medidores.map((m) => ({ ...m }));
  let status: string | null = null;
  for (const o of fila) {
    if (o.op === "ambiente") {
      if (!amb.some((a) => a.id === o.id)) amb = [...amb, { id: o.id, nome: o.nome, tipo: o.tipo, observacoes: null, itens: o.itens.map((i) => ({ ...i, estado: null, observacao: null })) }];
    } else if (o.op === "ambiente_obs") {
      amb = amb.map((a) => (a.id === o.id ? { ...a, observacoes: o.observacoes } : a));
    } else if (o.op === "item") {
      amb = amb.map((a) => (a.id === o.ambienteId ? { ...a, itens: a.itens.map((i) => (i.id === o.id ? { ...i, estado: o.estado, observacao: o.observacao } : i)) } : a));
    } else if (o.op === "medidor") {
      const m = { id: o.id, tipo: o.tipo, numero: o.numero, leitura: o.leitura };
      med = med.some((x) => x.id === o.id) ? med.map((x) => (x.id === o.id ? m : x)) : [...med, m];
    } else if (o.op === "status") status = o.status;
  }
  return { ambientes: amb, medidores: med, status };
}

/** Descrição curta de uma alteração da fila, para a pessoa entender o que não foi aceito. */
export function descreverOp(o: OpCampo, ambientes: AmbienteCampo[], medidores: MedidorCampo[]): string {
  const ambiente = (id: string | null) => (id ? ambientes.find((a) => a.id === id) : undefined);
  switch (o.op) {
    case "item": {
      const a = ambiente(o.ambienteId);
      const i = a?.itens.find((x) => x.id === o.id);
      const onde = [a?.nome, i?.nome].filter(Boolean).join(" · ") || "Item";
      return `${onde}: ${o.estado ? ROTULO_ESTADO[o.estado] : "sem estado"}${o.observacao ? ` (${o.observacao})` : ""}`;
    }
    case "ambiente":
      return `Ambiente novo: ${o.nome}`;
    case "ambiente_obs":
      return `Observações de ${ambiente(o.id)?.nome ?? "um ambiente"}`;
    case "medidor":
      return `Medidor de ${(ROTULO_MEDIDOR[o.tipo] ?? o.tipo).toLowerCase()}${o.leitura !== null ? `: ${num(o.leitura)} ${UNIDADE_MEDIDOR[o.tipo] ?? ""}` : ""}`.trim();
    case "foto": {
      const a = ambiente(o.ambienteId);
      const item = a?.itens.find((x) => x.id === o.itemId)?.nome;
      const med = o.medidorId ? medidores.find((m) => m.id === o.medidorId) : undefined;
      const lugar = med ? `medidor de ${(ROTULO_MEDIDOR[med.tipo] ?? med.tipo).toLowerCase()}` : [a?.nome, item].filter(Boolean).join(" · ");
      return `${o.tipo === "video" ? "Vídeo" : "Foto"}${lugar ? ` de ${lugar}` : " geral"}`;
    }
    case "status":
      return o.status === "concluida" ? "Concluir a vistoria" : "Iniciar a vistoria";
  }
}

/** Texto do contador da fila ("3 alterações esperando internet"). */
export function resumoFila(fila: OpCampo[]) {
  const fotos = fila.filter((o) => o.op === "foto").length;
  const outras = fila.length - fotos;
  const partes = [outras ? `${outras} alteraç${outras === 1 ? "ão" : "ões"}` : null, fotos ? `${fotos} foto${fotos === 1 ? "" : "s"}/vídeo${fotos === 1 ? "" : "s"}` : null].filter(Boolean);
  return partes.length ? partes.join(" e ") : "nada pendente";
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Custo do reparo no Financeiro ---------------------------------------------------
/**
 * Reparo resolvido por conta do proprietário ou da imobiliária vira conta a
 * pagar ao prestador — mesma regra da Manutenção (`planoFinanceiro`): na
 * imobiliária a parte do proprietário é descontada do próximo repasse. Vale o
 * orçamento aprovado; sem orçamento, o valor estimado. O reparo do locatário
 * vai para o acerto de saída e "ninguém" (desgaste natural) não gera custo.
 * Devolve null quando não há nada a lançar.
 */
export function custoDoReparo(p: {
  status: string;
  responsavel: string;
  valorAprovado: number | null | undefined;
  valorEstimado: number | null | undefined;
  modo: Modo;
  descricao: string;
}): ReturnType<typeof planoFinanceiro> | null {
  if (p.status !== "resolvida") return null;
  if (p.responsavel !== "proprietario" && p.responsavel !== "imobiliaria") return null;
  if (p.modo === "pessoal" && p.responsavel === "imobiliaria") return null;
  const valor = Number(p.valorAprovado ?? p.valorEstimado ?? 0);
  if (!(valor > 0)) return null;
  const plano = planoFinanceiro({ modo: p.modo, valor, responsabilidade: p.responsavel, titulo: p.descricao });
  return {
    ...plano,
    pagar: plano.pagar.map((l) => ({ ...l, descricao: l.descricao.replace(/^Manutenção/, "Reparo de vistoria") })),
  };
}
