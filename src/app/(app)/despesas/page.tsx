import type { Metadata } from "next";
import { AlertTriangle, CircleCheck, Clock, Receipt } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Cabecalho, Cartao, Indicador, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { fimDoMes, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { CATEGORIAS_DESPESA_ESCRITORIO, CATEGORIAS_DESPESA_IMOVEL } from "@/lib/tipos";
import { criarDespesa } from "./actions";
import { CamposDespesa, type ImovelDespesa } from "./campos";
import { ListaDespesas, type DespesaLinha } from "./lista-despesas";

export const metadata: Metadata = { title: "Despesas" };

type L = {
  id: string;
  descricao: string;
  categoria: string | null;
  valor: number;
  vencimento: string;
  status: string;
  liquidado_em: string | null;
  imovel_id: string | null;
  serie_id: string | null;
  comprovante_path: string | null;
  imovel: { codigo: string } | null;
  pessoa: { nome: string } | null;
};

function Barras({ dados, total }: { dados: [string, number][]; total: number }) {
  return (
    <ul className="space-y-3">
      {dados.map(([nome, v]) => (
        <li key={nome}>
          <div className="mb-1 flex justify-between gap-2 text-sm">
            <span className="truncate text-texto-2">{nome}</span>
            <span className="font-semibold tabular-nums text-texto">{formatarReais(v)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-elev">
            <div className="h-full rounded-full bg-ruim" style={{ width: `${total ? Math.max(3, (v / total) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
      {dados.length === 0 && <li className="text-sm text-mudo">Sem despesas no mês.</li>}
    </ul>
  );
}

export default async function DespesasPage({ searchParams }: PageProps<"/despesas">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const ini = `${mes}-01`;
  const fim = fimDoMes(ini);
  const imovelFiltro = typeof sp.imovel === "string" ? sp.imovel : "";
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";

  let consulta = supabase
    .from("lancamentos")
    .select("id, descricao, categoria, valor, vencimento, status, liquidado_em, imovel_id, serie_id, comprovante_path, imovel:imoveis(codigo), pessoa:pessoas!lancamentos_pessoa_id_fkey(nome)")
    .eq("tipo", "pagar")
    .neq("status", "cancelado")
    .gte("vencimento", ini)
    .lte("vencimento", fim)
    .order("vencimento");
  let atrasadas = supabase.from("lancamentos").select("valor").eq("tipo", "pagar").eq("status", "aberto").lt("vencimento", hoje);
  if (imovelFiltro) {
    consulta = consulta.eq("imovel_id", imovelFiltro);
    atrasadas = atrasadas.eq("imovel_id", imovelFiltro);
  }
  // Na imobiliária, dinheiro de terceiros e adiantamento a proprietário não são despesa do escritório.
  if (organizacao.modo !== "pessoal") {
    consulta = consulta.eq("terceiros", false).eq("adiantamento", false);
    atrasadas = atrasadas.eq("terceiros", false).eq("adiantamento", false);
  }
  const [{ data }, { data: imoveisRaw }, { data: vencidasRaw }] = await Promise.all([
    consulta,
    supabase.from("imoveis").select("id, codigo, logradouro, numero").neq("status", "inativo").order("codigo"),
    atrasadas,
  ]);
  const lanc = (data ?? []) as unknown as L[];
  const imoveis = (imoveisRaw ?? []) as ImovelDespesa[];
  const base = pessoal ? CATEGORIAS_DESPESA_IMOVEL : CATEGORIAS_DESPESA_ESCRITORIO;
  const categorias = [...base, ...[...new Set(lanc.map((l) => l.categoria).filter((c): c is string => Boolean(c)))].filter((c) => !base.includes(c))];

  const total = lanc.reduce((s, l) => s + Number(l.valor), 0);
  const pago = lanc.filter((l) => l.status === "liquidado").reduce((s, l) => s + Number(l.valor), 0);
  const vencidas = vencidasRaw ?? [];
  const totalVencidas = vencidas.reduce((s, l) => s + Number(l.valor), 0);

  const porCategoria = Object.entries(
    lanc.reduce<Record<string, number>>((acc, l) => {
      const c = l.categoria ?? "Sem categoria";
      acc[c] = (acc[c] ?? 0) + Number(l.valor);
      return acc;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const porImovel = pessoal
    ? Object.entries(
        lanc.reduce<Record<string, number>>((acc, l) => {
          const c = l.imovel?.codigo ?? "Sem imóvel";
          acc[c] = (acc[c] ?? 0) + Number(l.valor);
          return acc;
        }, {}),
      ).sort((a, b) => b[1] - a[1])
    : [];

  const itens: DespesaLinha[] = lanc
    .map((l) => ({
      id: l.id,
      descricao: l.descricao,
      categoria: l.categoria,
      valor: Number(l.valor),
      vencimento: l.vencimento,
      status: l.status,
      liquidado_em: l.liquidado_em,
      imovel_id: l.imovel_id,
      imovelCodigo: l.imovel?.codigo ?? null,
      pessoaNome: l.pessoa?.nome ?? null,
      serie: Boolean(l.serie_id),
      comprovante: Boolean(l.comprovante_path),
    }))
    .sort((a, b) => Number(a.status === "liquidado") - Number(b.status === "liquidado") || a.vencimento.localeCompare(b.vencimento));
  const campos = Object.fromEntries(
    lanc.map((l) => [
      l.id,
      <CamposDespesa
        key={l.id}
        categorias={categorias.includes(l.categoria ?? "") ? categorias : [...categorias, l.categoria ?? "Outros"]}
        imoveis={imoveis}
        pessoal={pessoal}
        despesa={{ id: l.id, descricao: l.descricao, categoria: l.categoria, valor: Number(l.valor), vencimento: l.vencimento, imovel_id: l.imovel_id }}
      />,
    ]),
  );



  return (
    <>
      <Cabecalho
        titulo={pessoal ? "Despesas dos imóveis" : "Despesas do escritório"}
        trilha="Despesas"
        descricao={
          pessoal
            ? "Condomínio, IPTU, manutenção e tudo que sai do bolso por imóvel. Marque o check quando pagar."
            : "As contas da imobiliária: aluguel da sala, contas, salários, marketing e comissões. Marque o check quando pagar."
        }
        acoes={
          <JanelaCadastro rotuloBotao={<><Receipt className="size-4" /> Nova despesa</>} titulo="Nova despesa" acao={criarDespesa} rotuloSalvar="Lançar" icone={<Receipt />}>
            <CamposDespesa categorias={categorias} imoveis={imoveis} pessoal={pessoal} imovelPadrao={imovelFiltro || undefined} nova />
          </JanelaCadastro>
        }
      />

      <div className="mb-5 flex flex-wrap items-center gap-3">
        <NavegadorMes caminho="/despesas" mes={mes} hoje={hoje} extra={{ imovel: imovelFiltro || undefined }} />
        {pessoal && (
          <FiltroAutomatico className="flex gap-2">
            <input type="hidden" name="mes" value={mes} />
            <Selecao name="imovel" defaultValue={imovelFiltro} className="w-64">
              <option value="">Todos os imóveis</option>
              {imoveis.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.codigo}
                </option>
              ))}
            </Selecao>
          </FiltroAutomatico>
        )}
      </div>

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Total do mês" icone={<Receipt />} valor={<Contador valor={total} formato="moeda" />} detalhe={`${lanc.length} despesa(s)`} />
        <Indicador rotulo="Pago" icone={<CircleCheck />} valor={<Contador valor={pago} formato="moeda" />} tom="sucesso" />
        <Indicador rotulo="A pagar" icone={<Clock />} valor={<Contador valor={total - pago} formato="moeda" />} tom={total - pago > 0 ? "alerta" : "neutro"} />
        <Indicador
          rotulo="Vencidas (todos os meses)"
          icone={<AlertTriangle />}
          valor={<Contador valor={totalVencidas} formato="moeda" />}
          detalhe={`${vencidas.length} sem pagamento`}
          tom={vencidas.length ? "perigo" : "sucesso"}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <ListaDespesas itens={itens} hoje={hoje} organizacaoId={organizacao.id} pessoal={pessoal} campos={campos} />
        <div className="space-y-6">
          <Cartao titulo="Por categoria">
            <Barras dados={porCategoria} total={total} />
          </Cartao>
          {pessoal && !imovelFiltro && (
            <Cartao titulo="Por imóvel">
              <Barras dados={porImovel} total={total} />
            </Cartao>
          )}
        </div>
      </div>
    </>
  );
}
