import type { Metadata } from "next";
import { BadgeDollarSign } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { Celula, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { COR_STATUS_COMISSAO, ROTULO_STATUS_COMISSAO, ROTULO_TIPO_COMISSAO } from "@/lib/dominio/comissoes";
import { diaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { contextoCorretor, portalCorretor, semVinculo } from "../dados";
import { AvisoSemVinculo, TopoCorretor } from "../topo";

export const metadata: Metadata = { title: "Minhas comissões" };

type Comissao = {
  id: string;
  tipo: string;
  descricao: string;
  base: number | null;
  percentual: number | null;
  valor: number;
  status: string;
  previsao: string | null;
  vencimento: string | null;
  liberada_em: string | null;
  motivo: string | null;
  criado_em: string;
  imovel: string | null;
};

/** Comissões do corretor: previstas (esperando o recebimento), a receber e pagas. */
export default async function ComissoesCorretorPage({ searchParams }: PageProps<"/corretor/comissoes">) {
  const ctx = await contextoCorretor(await searchParams);
  const d = await portalCorretor<Comissao[]>(ctx.supabase, "comissoes", ctx.escolhido);
  const ano = hojeISO().slice(0, 4);
  return (
    <>
      <TopoCorretor ctx={ctx} titulo="Comissões" descricao="Comissões no seu nome. “Prevista” espera a imobiliária receber; “A pagar” já foi liberada; o pagamento é feito pelo financeiro." />
      {semVinculo(d) ? (
        <AvisoSemVinculo ctx={ctx} />
      ) : (
        (() => {
          const soma = (f: (c: Comissao) => boolean) => paraReais(d.filter(f).reduce((s, c) => s + paraCentavos(c.valor), 0));
          return (
            <div className="space-y-5">
              <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-3">
                <Indicador rotulo="Previstas" valor={<Contador valor={soma((c) => c.status === "prevista")} formato="moeda" />} icone={<BadgeDollarSign />} />
                <Indicador rotulo="A receber" valor={<Contador valor={soma((c) => c.status === "a_pagar")} formato="moeda" />} icone={<BadgeDollarSign />} tom="alerta" />
                <Indicador
                  rotulo={`Pagas em ${ano}`}
                  valor={<Contador valor={soma((c) => c.status === "paga" && (c.liberada_em ?? c.vencimento ?? c.criado_em).startsWith(ano))} formato="moeda" />}
                  icone={<BadgeDollarSign />}
                  tom="sucesso"
                />
              </div>
              <Tabela colunas={["Comissão", "Imóvel", "Base", "Valor", "Previsão / vencimento", "Situação"]}>
                {d.length === 0 && <LinhaVazia colunas={6}>Nenhuma comissão no seu nome.</LinhaVazia>}
                {d.map((c) => (
                  <tr key={c.id}>
                    <Celula>
                      {c.descricao}
                      <span className="block text-xs text-mudo">
                        {ROTULO_TIPO_COMISSAO[c.tipo as keyof typeof ROTULO_TIPO_COMISSAO] ?? c.tipo} · {formatarDataBR(diaLocal(c.criado_em))}
                      </span>
                      {c.motivo && <span className="block text-xs text-mudo">{c.motivo}</span>}
                    </Celula>
                    <Celula>{c.imovel ?? "—"}</Celula>
                    <Celula className="text-sm tabular-nums">
                      {c.base != null ? formatarReais(c.base) : "—"}
                      {c.percentual != null ? ` · ${Number(c.percentual).toLocaleString("pt-BR")}%` : ""}
                    </Celula>
                    <Celula className="font-medium tabular-nums">{formatarReais(c.valor)}</Celula>
                    <Celula className="text-sm">{formatarDataBR(c.vencimento ?? c.previsao)}</Celula>
                    <Celula>
                      <Selo cor={COR_STATUS_COMISSAO[c.status as keyof typeof COR_STATUS_COMISSAO] ?? "cinza"}>{ROTULO_STATUS_COMISSAO[c.status as keyof typeof ROTULO_STATUS_COMISSAO] ?? c.status}</Selo>
                    </Celula>
                  </tr>
                ))}
              </Tabela>
            </div>
          );
        })()
      )}
    </>
  );
}
