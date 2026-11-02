import type { Metadata } from "next";
import Link from "next/link";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import type { Repasse } from "@/lib/tipos";
import { marcarRepassesPagos } from "./actions";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { ArrowLeftRight, CalendarClock, Percent } from "lucide-react";

export const metadata: Metadata = { title: "Repasses" };

type Linha = Repasse & {
  pessoa: { id: string; nome: string; banco: string | null; agencia: string | null; conta: string | null; pix_chave: string | null };
  contrato: { id: string; numero: number; imovel: { codigo: string } };
};

export default async function RepassesPage({ searchParams }: PageProps<"/repasses">) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "pendente";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();

  let q = supabase
    .from("repasses")
    .select("*, pessoa:pessoas(id, nome, banco, agencia, conta, pix_chave), contrato:contratos(id, numero, imovel:imoveis(codigo))")
    .order("previsto_para")
    .limit(500);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  const repasses = (data ?? []) as unknown as Linha[];
  const pendentes = repasses.filter((r) => r.status === "pendente");
  const vencidos = pendentes.filter((r) => r.previsto_para <= hoje);

  return (
    <>
      <Cabecalho
        titulo="Repasses aos proprietários"
        descricao="Valores líquidos (aluguel − taxas − IRRF) gerados na baixa das faturas ou agendados no repasse garantido."
      />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Pendentes" icone={<ArrowLeftRight />} valor={formatarReais(pendentes.reduce((s, r) => s + Number(r.valor_liquido), 0))} detalhe={`${pendentes.length} repasse(s)`} />
        <Indicador
          rotulo="Para pagar até hoje" icone={<CalendarClock />}
          valor={formatarReais(vencidos.reduce((s, r) => s + Number(r.valor_liquido), 0))}
          tom={vencidos.length ? "alerta" : "neutro"}
          detalhe={`${vencidos.length} repasse(s)`}
        />
        <Indicador
          rotulo="Taxas retidas (lista)" icone={<Percent />}
          valor={formatarReais(repasses.reduce((s, r) => s + Number(r.taxa_administracao) + Number(r.taxa_intermediacao), 0))}
          tom="sucesso"
        />
      </div>
      <FiltroAutomatico className="mb-4 flex gap-2">
        <Selecao name="status" defaultValue={status} className="max-w-48">
          <option value="pendente">Pendentes</option>
          <option value="pago">Pagos</option>
          <option value="cancelado">Cancelados</option>
          <option value="">Todos</option>
        </Selecao>
      </FiltroAutomatico>
      <Formulario acao={marcarRepassesPagos} className="space-y-4">
        <Tabela colunas={["", "Previsto", "Proprietário", "Contrato", "Competência", "Bruto", "Taxas", "IRRF", "Líquido", "Dados bancários", "Situação"]}>
          {repasses.length === 0 && <LinhaVazia colunas={11}>Nenhum repasse.</LinhaVazia>}
          {repasses.map((r) => (
            <tr key={r.id} className="hover:bg-card-hover">
              <Celula>{r.status === "pendente" && <input type="checkbox" name="ids" value={r.id} aria-label="Selecionar" />}</Celula>
              <Celula className={r.status === "pendente" && r.previsto_para <= hoje ? "font-medium text-alerta" : ""}>
                {formatarDataBR(r.previsto_para)}
              </Celula>
              <Celula>
                <Link href={`/repasses/extrato?pessoa=${r.pessoa.id}`} className="text-acento hover:underline">
                  {r.pessoa.nome}
                </Link>
              </Celula>
              <Celula>
                <Link href={`/contratos/${r.contrato.id}`} className="hover:underline">
                  #{r.contrato.numero} · {r.contrato.imovel.codigo}
                </Link>
              </Celula>
              <Celula>{formatarCompetencia(r.competencia)}</Celula>
              <Celula>{formatarReais(r.valor_bruto)}</Celula>
              <Celula>{formatarReais(Number(r.taxa_administracao) + Number(r.taxa_intermediacao))}</Celula>
              <Celula>{formatarReais(r.irrf)}</Celula>
              <Celula className="font-semibold">{formatarReais(r.valor_liquido)}</Celula>
              <Celula className="text-xs text-mudo">
                {r.pessoa.pix_chave ? `Pix: ${r.pessoa.pix_chave}` : [r.pessoa.banco, r.pessoa.agencia, r.pessoa.conta].filter(Boolean).join(" / ") || "—"}
              </Celula>
              <Celula>
                <Selo cor={r.status === "pago" ? "verde" : r.status === "pendente" ? "amarelo" : "cinza"}>{r.status}</Selo>
                {r.pago_em && <div className="text-xs text-mudo">{formatarDataBR(r.pago_em)}</div>}
              </Celula>
            </tr>
          ))}
        </Tabela>
        {pendentes.length > 0 && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block font-medium">Data do pagamento</span>
              <Entrada type="date" name="pago_em" defaultValue={hoje} />
            </label>
            <label className="text-sm">
              <span className="mb-1 block font-medium">Comprovante / ID da transferência</span>
              <Entrada name="comprovante" />
            </label>
            <BotaoEnviar>Marcar selecionados como pagos</BotaoEnviar>
          </div>
        )}
      </Formulario>
    </>
  );
}
