import "server-only";
import {
  finalidadeDoTipo,
  interessadoNoPreco,
  lerFiltros,
  montarLinkUtm,
  montarPublico,
  separarPorSugestao,
  textosPreco,
  ultimaReducao,
  variaveisUsadas,
  type Contato,
  type MudancaPreco,
} from "@/lib/dominio/marketing";
import { carregarBloqueios, carregarContatos, imoveisDisponiveis, landingPorImovel, numerico, SELECT_IMOVEL_BASICO, type Campanha, type ImovelBasico, type Supabase } from "./dados";
import type { ContextoMensagem } from "./montar-fila";

export type PreparoCampanha = {
  incluidos: Contato[];
  excluidos: { contato: Contato; motivo: string }[];
  ctx: ContextoMensagem;
  imovel: ImovelBasico | null;
  /** O que impede montar a fila (a tela mostra; a ação recusa). */
  problema: string | null;
};

/**
 * Público e variáveis da campanha — a MESMA conta para o "Público agora", a
 * prévia e a fila de envio:
 * - quem pediu para não receber fica de fora (montarPublico);
 * - sugestão de imóveis ({{imoveis}}): só quem tem perfil e algum imóvel que combina;
 * - redução de preço: preço anterior/novo vêm do histórico de preços do imóvel e
 *   só entra quem procura aquele tipo de negócio (aluguel × compra).
 */
export async function prepararCampanha(supabase: Supabase, c: Campanha, opcoes: { base: string; imobiliaria: string; agoraMs: number }): Promise<PreparoCampanha> {
  const filtros = lerFiltros(c.filtros);
  const finalidade = finalidadeDoTipo(c.tipo);
  const variaveis = variaveisUsadas(`${c.mensagem} ${c.assunto ?? ""}`);
  const usaImoveis = c.tipo === "recomendacao" || variaveis.includes("imoveis");
  const usaReducao = c.tipo === "reducao_preco" || variaveis.includes("preco_anterior");

  const [contatos, bloqueios, imovelR, disponiveis, landing, historicoR] = await Promise.all([
    carregarContatos(supabase, filtros.publico ?? "ambos"),
    carregarBloqueios(supabase),
    c.imovel_id ? supabase.from("imoveis").select(SELECT_IMOVEL_BASICO).eq("id", c.imovel_id).maybeSingle() : Promise.resolve({ data: null }),
    usaImoveis ? imoveisDisponiveis(supabase) : Promise.resolve([] as ImovelBasico[]),
    landingPorImovel(supabase, opcoes.base),
    usaReducao && c.imovel_id
      ? supabase
          .from("imovel_precos")
          .select("campo, valor_anterior, valor_novo, alterado_em")
          .eq("imovel_id", c.imovel_id)
          .in("campo", ["aluguel", "venda"])
          .order("alterado_em", { ascending: false })
          .limit(50)
      : Promise.resolve({ data: [] as MudancaPreco[] }),
  ]);
  const imovel = imovelR.data ? numerico(imovelR.data as ImovelBasico) : null;

  let problema: string | null = null;
  if (filtros.combina_imovel && !imovel) problema = "Escolha o imóvel da campanha (o público é quem tem perfil para ele).";
  const reducao = usaReducao && imovel ? ultimaReducao((historicoR.data ?? []) as MudancaPreco[]) : null;
  if (usaReducao && !problema) {
    if (!imovel) problema = "Escolha o imóvel que baixou de preço.";
    else if (!reducao)
      problema = `O ${imovel.codigo} não tem redução de preço no histórico (o último preço registrado não é menor que o anterior). Baixe o preço no cadastro do imóvel ou use outro tipo de campanha.`;
  }

  const { incluidos, excluidos } = montarPublico(contatos, filtros, {
    canal: c.canal,
    finalidade,
    soAutorizados: c.so_autorizados,
    descadastros: bloqueios.descadastros,
    consentimentos: bloqueios.consentimentos,
    agoraMs: opcoes.agoraMs,
    imovel,
  });
  let publico = incluidos;
  const fora = [...excluidos];

  if (reducao && imovel && c.tipo === "reducao_preco") {
    const quer = reducao.campo === "aluguel" ? "alugar" : "comprar";
    const ok: Contato[] = [];
    for (const x of publico) {
      if (interessadoNoPreco(x, reducao.campo, imovel.id)) ok.push(x);
      else fora.push({ contato: x, motivo: `Não procura imóvel para ${quer}` });
    }
    publico = ok;
  }
  if (usaImoveis) {
    const { comImoveis, semPerfil, semImovel } = separarPorSugestao(publico, disponiveis);
    for (const x of semPerfil) fora.push({ contato: x, motivo: "Sem perfil de busca (tipo, região, valor ou quartos)" });
    for (const x of semImovel) fora.push({ contato: x, motivo: "Nenhum imóvel disponível combina com o perfil" });
    publico = comImoveis;
  }

  const precos = reducao ? textosPreco(reducao.campo, reducao.anterior, reducao.novo) : { preco: null, precoAnterior: null };
  const utm = { source: c.canal, medium: "mensagem", campaign: c.utm_campaign };
  return {
    incluidos: publico,
    excluidos: fora,
    imovel,
    problema,
    ctx: {
      base: opcoes.base,
      imobiliaria: opcoes.imobiliaria,
      imovel,
      preco: precos.preco,
      precoAnterior: precos.precoAnterior,
      link: c.link ? montarLinkUtm(c.link, utm) : null,
      linkImovel: imovel && landing.get(imovel.id) ? montarLinkUtm(landing.get(imovel.id)!, utm) : null,
      disponiveis,
    },
  };
}
