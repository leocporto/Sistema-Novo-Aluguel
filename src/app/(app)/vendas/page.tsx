import type { Metadata } from "next";
import { BadgeDollarSign, Handshake, Landmark, Target } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BarraProgresso } from "@/components/barra-progresso";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Entrada, Indicador, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs, fimDoMes, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { normalizar } from "@/lib/dominio/imoveis";
import { comissaoTotal, progressoChecklistVenda, resumoPagamentos } from "@/lib/dominio/vendas";
import { criarVenda } from "./actions";
import { AbasVendas, CamposNovaVenda } from "./campos";
import { carregarOpcoesVenda, nomeComprador, telefoneComprador, type Venda } from "./dados";
import { QuadroVendas, type CartaoVenda } from "./quadro-vendas";

export const metadata: Metadata = { title: "Vendas" };

const haQuanto = (iso: string, agora: number) => {
  const d = Math.floor((agora - new Date(iso).getTime()) / 86_400_000);
  return d <= 0 ? "hoje" : d === 1 ? "ontem" : `há ${d} dias`;
};

export default async function VendasPage({ searchParams }: PageProps<"/vendas">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f = { corretor: s("corretor"), busca: s("busca") };
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const agora = agoraMs();
  const ini = inicioDoMes(hoje);

  let q = supabase
    .from("vendas")
    .select("*, imovel:imoveis(id, codigo, logradouro, numero), comprador:pessoas!vendas_comprador_id_fkey(id, nome, telefone), lead:leads(id, nome, telefone), corretor:pessoas!vendas_corretor_id_fkey(id, nome), venda_pagamentos(valor, vencimento, pago_em)")
    .order("created_at", { ascending: false })
    .limit(600);
  if (f.corretor) q = q.eq("corretor_id", f.corretor);
  const [{ data }, opcoes, { data: meta }] = await Promise.all([
    q,
    carregarOpcoesVenda(supabase),
    supabase.from("metas").select("valor").eq("competencia", ini).eq("tipo", "vendas").maybeSingle(),
  ]);
  type V = Venda & { venda_pagamentos: { valor: number; vencimento: string | null; pago_em: string | null }[] };
  let vendas = (data ?? []) as unknown as V[];
  if (f.busca) {
    const b = normalizar(f.busca);
    vendas = vendas.filter((v) => normalizar([v.imovel?.codigo, v.imovel?.logradouro, nomeComprador(v), String(v.numero)].join(" ")).includes(b));
  }
  // Canceladas e concluídas antigas saem do quadro (ficam só as do mês).
  const visiveis = vendas.filter((v) => !["concluida", "cancelada"].includes(v.status) || (v.concluida_em ?? v.created_at.slice(0, 10)) >= ini);
  const andamento = vendas.filter((v) => !["concluida", "cancelada"].includes(v.status));
  const vgv = andamento.reduce((s, v) => s + Number(v.valor), 0);
  const comissoesPrev = andamento.reduce((s, v) => s + comissaoTotal(Number(v.valor), Number(v.comissao_pct), v.comissao_valor == null ? null : Number(v.comissao_valor)), 0);
  const noMes = vendas.filter((v) => v.status === "concluida" && v.concluida_em && v.concluida_em >= ini && v.concluida_em <= fimDoMes(hoje)).length;
  const valorMeta = meta?.valor ? Number(meta.valor) : null;
  const parados = andamento.filter((v) => ["simulacao", "analise_credito", "avaliacao_banco"].includes(v.fin_status)).length;

  const cartoes: CartaoVenda[] = visiveis.map((v) => {
    const docs = progressoChecklistVenda(v.checklist_docs);
    return {
      id: v.id,
      numero: v.numero,
      imovel: v.imovel?.codigo ?? "Imóvel removido",
      comprador: nomeComprador(v),
      telefone: telefoneComprador(v),
      status: v.status,
      valor: Number(v.valor),
      corretor: v.corretor?.nome.split(" ")[0] ?? null,
      financiamento: v.forma_pagamento === "financiamento" || v.forma_pagamento === "misto" ? v.fin_status : null,
      docs: `${docs.feitos}/${docs.total}`,
      pagoPct: resumoPagamentos(v.venda_pagamentos.map((p) => ({ ...p, valor: Number(p.valor) })), Number(v.valor), hoje).pctPago,
      desde: haQuanto(v.created_at, agora),
    };
  });

  return (
    <>
      <Cabecalho
        titulo="Vendas"
        trilha="Comercial"
        descricao="Da proposta aceita à escritura: reserva, documentação, financiamento, ITBI, registro, comissões e pós-venda."
        acoes={
          <JanelaCadastro rotuloBotao={<><Handshake className="size-4" /> Nova venda</>} titulo="Abrir negociação de venda" acao={criarVenda} icone={<Handshake />} larguraMax="max-w-2xl" abertaInicial={s("novo") === "1"}>
            <CamposNovaVenda opcoes={opcoes} padrao={{ imovelId: s("imovel") || undefined, leadId: s("lead") || undefined }} />
          </JanelaCadastro>
        }
      />
      <AbasVendas />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Em andamento (VGV)" icone={<Handshake />} valor={<Contador valor={vgv} formato="moeda" />} detalhe={`${andamento.length} venda(s) abertas`} />
        <Indicador rotulo="Comissões previstas" icone={<BadgeDollarSign />} valor={<Contador valor={comissoesPrev} formato="moeda" />} detalhe="se tudo for concluído" href="/vendas/comissoes" />
        <Indicador
          rotulo="Vendidos no mês"
          icone={<Target />}
          valor={<Contador valor={noMes} />}
          tom={valorMeta && noMes >= valorMeta ? "sucesso" : "neutro"}
          detalhe={
            valorMeta ? (
              <span className="block">
                <BarraProgresso pct={(noMes / valorMeta) * 100} atingida={noMes >= valorMeta} />
                <span className="mt-1 block">meta: {valorMeta}</span>
              </span>
            ) : (
              "sem meta (Comercial › Metas)"
            )
          }
        />
        <Indicador rotulo="Financiamentos em análise" icone={<Landmark />} valor={<Contador valor={parados} />} detalhe="simulação, crédito ou avaliação do banco" tom={parados ? "alerta" : "neutro"} />
      </div>

      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Entrada name="busca" defaultValue={f.busca} placeholder="Buscar imóvel, comprador, nº…" className="max-w-72" />
        <Selecao name="corretor" defaultValue={f.corretor} className="w-52">
          <option value="">Todos os corretores</option>
          {opcoes.corretores.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Selecao>
      </FiltroAutomatico>

      <QuadroVendas itens={cartoes} />
    </>
  );
}
