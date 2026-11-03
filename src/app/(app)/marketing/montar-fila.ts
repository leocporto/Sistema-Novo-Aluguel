import "server-only";
import { randomUUID } from "node:crypto";
import {
  chaveEnvio,
  comRodape,
  descricaoImovel,
  listaImoveisTexto,
  precoDoImovel,
  primeiroNome,
  recomendarImoveis,
  renderizarMensagem,
  variaveisUsadas,
  type Canal,
  type Contato,
  type Finalidade,
  type ImovelTexto,
} from "@/lib/dominio/marketing";
import type { ImovelBasico, Supabase } from "./dados";

/** Linha da fila pronta para gravar (o banco ainda confere descadastro e destino). */
export type NovaLinhaEnvio = {
  chave: string;
  campanha_id: string | null;
  automacao_id: string | null;
  pesquisa_id: string | null;
  origem: "campanha" | "automacao" | "recomendacao" | "pesquisa" | "manual";
  finalidade: Finalidade;
  canal: Canal;
  pessoa_id: string | null;
  lead_id: string | null;
  imovel_id: string | null;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  assunto: string | null;
  mensagem: string;
  agendado_para: string;
};

export type NovaPesquisa = {
  id: string;
  token: string;
  contexto: "pos_venda" | "pos_locacao" | "atendimento" | "geral";
  pessoa_id: string | null;
  lead_id: string | null;
  venda_id?: string | null;
  contrato_id?: string | null;
  imovel_id?: string | null;
  nome: string | null;
  telefone: string | null;
  email: string | null;
  pergunta: string | null;
};

export type ContextoMensagem = {
  base: string;
  imobiliaria: string;
  imovel?: (ImovelTexto & { id: string }) | null;
  /** Já formatados (ex.: redução de preço do aluguel). */
  preco?: string | null;
  precoAnterior?: string | null;
  linkImovel?: string | null;
  link?: string | null;
  disponiveis?: ImovelBasico[];
};

/** Variáveis da mensagem para um contato. */
export function variaveisDoContato(
  c: Pick<Contato, "nome" | "corretor" | "perfil" | "preferencias_token">,
  ctx: ContextoMensagem,
  extra: Record<string, string> = {},
): Record<string, string> {
  const i = ctx.imovel;
  const sugeridos = ctx.disponiveis && c.perfil ? recomendarImoveis(c.perfil, ctx.disponiveis, 4) : [];
  const vendaSo = c.perfil?.interesse.includes("comprar") && !c.perfil.interesse.includes("alugar");
  return {
    nome: c.nome,
    primeiro_nome: primeiroNome(c.nome),
    imobiliaria: ctx.imobiliaria,
    corretor: c.corretor ?? "",
    imovel: i ? descricaoImovel(i) : "",
    codigo: i?.codigo ?? "",
    preco: ctx.preco ?? (i ? precoDoImovel(i, vendaSo ? "venda" : undefined) : ""),
    preco_anterior: ctx.precoAnterior ?? "",
    imoveis: sugeridos.length ? listaImoveisTexto(sugeridos, vendaSo ? "venda" : undefined) : "",
    link: ctx.link ?? ctx.linkImovel ?? "",
    link_preferencias: c.preferencias_token ? `${ctx.base}/preferencias/${c.preferencias_token}` : "",
    ...extra,
  };
}

/** Monta a linha da fila para um contato (cria a pesquisa se a mensagem tiver {{link_pesquisa}}). */
export function linhaParaContato(
  c: Contato,
  opcoes: {
    prefixoChave: string;
    origem: NovaLinhaEnvio["origem"];
    finalidade: Finalidade;
    canal: Canal;
    corpo: string;
    assunto: string | null;
    agendadoPara: string;
    campanhaId?: string | null;
    automacaoId?: string | null;
    imovelId?: string | null;
    ctx: ContextoMensagem;
    pesquisa?: Omit<NovaPesquisa, "id" | "token" | "pessoa_id" | "lead_id" | "nome" | "telefone" | "email">;
  },
): { linha: NovaLinhaEnvio; pesquisa: NovaPesquisa | null } {
  const precisaPesquisa = variaveisUsadas(opcoes.corpo).includes("link_pesquisa") || opcoes.origem === "pesquisa";
  const pesquisa: NovaPesquisa | null = precisaPesquisa
    ? {
        id: randomUUID(),
        token: randomUUID(),
        contexto: opcoes.pesquisa?.contexto ?? "geral",
        pergunta: opcoes.pesquisa?.pergunta ? renderizarMensagem(opcoes.pesquisa.pergunta, { imobiliaria: opcoes.ctx.imobiliaria }) : null,
        venda_id: opcoes.pesquisa?.venda_id ?? null,
        contrato_id: opcoes.pesquisa?.contrato_id ?? null,
        imovel_id: opcoes.pesquisa?.imovel_id ?? opcoes.imovelId ?? null,
        pessoa_id: c.tipo === "pessoa" && c.id ? c.id : null,
        lead_id: c.tipo === "lead" && c.id ? c.id : null,
        nome: c.nome,
        telefone: c.telefone,
        email: c.email,
      }
    : null;
  const linkPesquisa = pesquisa ? `${opcoes.ctx.base}/pesquisa/${pesquisa.token}` : "";
  const dados = variaveisDoContato(c, opcoes.ctx, pesquisa ? { link_pesquisa: linkPesquisa } : {});
  let mensagem = renderizarMensagem(opcoes.corpo, dados);
  if (pesquisa && !mensagem.includes(linkPesquisa)) mensagem += `\n\n${linkPesquisa}`;
  mensagem = comRodape(mensagem, opcoes.canal, dados.link_preferencias || null, opcoes.finalidade);
  return {
    pesquisa,
    linha: {
      chave: c.id ? chaveEnvio(opcoes.prefixoChave, c) : `${opcoes.prefixoChave}:${randomUUID()}`,
      campanha_id: opcoes.campanhaId ?? null,
      automacao_id: opcoes.automacaoId ?? null,
      pesquisa_id: pesquisa?.id ?? null,
      origem: opcoes.origem,
      finalidade: opcoes.finalidade,
      canal: opcoes.canal,
      pessoa_id: c.tipo === "pessoa" && c.id ? c.id : null,
      lead_id: c.tipo === "lead" && c.id ? c.id : null,
      imovel_id: opcoes.imovelId ?? null,
      nome: c.nome,
      telefone: c.telefone,
      email: c.email,
      assunto: opcoes.assunto ? renderizarMensagem(opcoes.assunto, dados) : null,
      mensagem,
      agendado_para: opcoes.agendadoPara,
    },
  };
}

/** Grava pesquisas e envios em lotes; envio repetido (mesma chave) é ignorado. Devolve quantos entraram. */
export async function gravarFila(supabase: Supabase, linhas: NovaLinhaEnvio[], pesquisas: NovaPesquisa[]): Promise<number> {
  for (let i = 0; i < pesquisas.length; i += 500) {
    const { error } = await supabase.from("mkt_pesquisas").insert(pesquisas.slice(i, i + 500));
    if (error) throw new Error(error.message);
  }
  let n = 0;
  for (let i = 0; i < linhas.length; i += 500) {
    const { data, error } = await supabase
      .from("mkt_envios")
      .upsert(linhas.slice(i, i + 500), { onConflict: "organizacao_id,chave", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(error.message);
    n += data?.length ?? 0;
  }
  return n;
}

/** Corpo padrão quando a campanha/automação não tem texto. */
export function corpoPadrao(tipo: string): string {
  switch (tipo) {
    case "novo_imovel":
      return "Olá {{primeiro_nome}}! Aqui é da {{imobiliaria}}. Entrou um imóvel com o seu perfil: {{imovel}} — {{preco}}. {{link}}";
    case "reducao_preco":
      return "Oi {{primeiro_nome}}! O imóvel {{imovel}} baixou de {{preco_anterior}} para {{preco}}. {{link}}";
    case "pos_venda":
      return "Olá {{primeiro_nome}}! Parabéns pelo novo imóvel. Como foi a experiência com a {{imobiliaria}}? {{link_pesquisa}}";
    case "pos_locacao":
      return "Olá {{primeiro_nome}}! Esperamos que esteja gostando do imóvel {{imovel}}. Pode avaliar nosso atendimento? {{link_pesquisa}}";
    case "pesquisa":
      return "Olá {{primeiro_nome}}! Como foi o atendimento da {{imobiliaria}}? É uma pergunta só: {{link_pesquisa}}";
    case "recomendacao":
      return "Olá {{primeiro_nome}}! Separei imóveis que combinam com o que você procura:\n{{imoveis}}\nQuer visitar algum?";
    default:
      return "Olá {{primeiro_nome}}! Aqui é da {{imobiliaria}}.";
  }
}
