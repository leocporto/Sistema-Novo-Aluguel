import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Handshake, Scale, XCircle } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Cabecalho, Celula, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { acordoEmRisco, ROTULO_STATUS_ACORDO } from "@/lib/dominio/cobrancas";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasCobrancas } from "../abas";
import { configCobranca } from "../dados";

export const metadata: Metadata = { title: "Acordos de cobrança" };

const FILTROS: Record<string, string> = { ativo: "Em andamento", cumprido: "Cumpridos", quebrado: "Quebrados", todos: "Todos" };
const COR = { ativo: "azul", cumprido: "verde", quebrado: "vermelho", cancelado: "cinza" } as const;

type Linha = {
  id: string;
  numero: number;
  status: keyof typeof COR;
  data: string;
  total: number;
  parcelas: number;
  contrato: { id: string; numero: number; imovel: { codigo: string } | null } | null;
  pessoa: { nome: string } | null;
  acordo_parcelas: { status: string; vencimento: string; valor: number }[];
};

export default async function AcordosPage({ searchParams }: PageProps<"/cobrancas/acordos">) {
  const sp = await searchParams;
  const filtro = typeof sp.situacao === "string" && sp.situacao in FILTROS ? sp.situacao : "ativo";
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const cfg = configCobranca(organizacao);
  let q = supabase
    .from("acordos")
    .select("id, numero, status, data, total, parcelas, contrato:contratos(id, numero, imovel:imoveis(codigo)), pessoa:pessoas(nome), acordo_parcelas(status, vencimento, valor)")
    .order("data", { ascending: false })
    .limit(500);
  if (filtro !== "todos") q = q.eq("status", filtro);
  const [{ data }, { data: todos }] = await Promise.all([q, supabase.from("acordos").select("status, total")]);
  const lista = (data ?? []) as unknown as Linha[];
  const cont = (s: string) => (todos ?? []).filter((a) => a.status === s).length;
  const cumpridos = cont("cumprido");
  const quebrados = cont("quebrado");

  return (
    <>
      <Cabecalho
        titulo="Acordos"
        trilha="Cobranças"
        descricao="Negociação e parcelamento de débitos: o que foi combinado, parcelas pagas e atrasadas, cumprimento e quebra."
        acoes={
          <BotaoLink href="/cobrancas/acordos/novo">
            <Handshake className="size-4" /> Novo acordo
          </BotaoLink>
        }
      />
      <AbasCobrancas />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Em andamento" icone={<Scale />} valor={<Contador valor={cont("ativo")} />} />
        <Indicador rotulo="Cumpridos" icone={<CheckCircle2 />} tom="sucesso" valor={<Contador valor={cumpridos} />} />
        <Indicador rotulo="Quebrados" icone={<XCircle />} tom={quebrados ? "perigo" : "neutro"} valor={<Contador valor={quebrados} />} />
        <Indicador
          rotulo="Taxa de cumprimento"
          icone={<Handshake />}
          tom="sucesso"
          valor={cumpridos + quebrados ? <Contador valor={Math.round((cumpridos / (cumpridos + quebrados)) * 1000) / 10} formato="pct" /> : "—"}
          detalhe="cumpridos ÷ (cumpridos + quebrados)"
        />
      </div>
      <PilulasLink className="mb-4" rotulo="Situação dos acordos" ativo={`/cobrancas/acordos?situacao=${filtro}`} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: `/cobrancas/acordos?situacao=${k}`, rotulo: r }))} />
      <Tabela colunas={["Nº", "Locatário", "Imóvel", "Data", "Total", "Pago", "Parcelas", "Próxima", "Situação"]}>
        {lista.length === 0 && <LinhaVazia colunas={9}>Nenhum acordo nesta lista.</LinhaVazia>}
        {lista.map((a) => {
          const pagas = a.acordo_parcelas.filter((p) => p.status === "paga");
          const abertas = a.acordo_parcelas.filter((p) => p.status === "aberta").sort((x, y) => x.vencimento.localeCompare(y.vencimento));
          const risco = a.status === "ativo" ? acordoEmRisco(a.acordo_parcelas, hoje, cfg.quebraDias) : null;
          return (
            <LinhaLink key={a.id} href={`/cobrancas/acordos/${a.id}`}>
              <Celula>
                <Link href={`/cobrancas/acordos/${a.id}`} className="text-acento hover:underline">
                  #{a.numero}
                </Link>
              </Celula>
              <Celula>{a.pessoa?.nome ?? "—"}</Celula>
              <Celula>{a.contrato?.imovel?.codigo ?? "—"}</Celula>
              <Celula>{formatarDataBR(a.data)}</Celula>
              <Celula className="tabular-nums">{formatarReais(a.total)}</Celula>
              <Celula className="tabular-nums text-ok">{formatarReais(pagas.reduce((s, p) => s + Number(p.valor), 0))}</Celula>
              <Celula>
                {pagas.length}/{a.acordo_parcelas.filter((p) => p.status !== "cancelada").length || a.acordo_parcelas.length}
              </Celula>
              <Celula>{abertas[0] ? `${formatarDataBR(abertas[0].vencimento)} · ${formatarReais(abertas[0].valor)}` : "—"}</Celula>
              <Celula>
                <span className="flex flex-wrap gap-1">
                  <Selo cor={COR[a.status] ?? "cinza"}>{ROTULO_STATUS_ACORDO[a.status] ?? a.status}</Selo>
                  {risco?.atrasadas ? <Selo cor={risco.sugerirQuebra ? "vermelho" : "amarelo"}>{risco.atrasadas} parcela(s) atrasada(s)</Selo> : null}
                </span>
              </Celula>
            </LinhaLink>
          );
        })}
      </Tabela>
    </>
  );
}
