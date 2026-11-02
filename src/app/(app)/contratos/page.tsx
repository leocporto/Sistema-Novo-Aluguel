import type { Metadata } from "next";
import Link from "next/link";
import { BotaoLink, Cabecalho, Celula, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_GARANTIA } from "@/lib/tipos";
import { FiltroAutomatico } from "@/components/filtro-automatico";

export const metadata: Metadata = { title: "Contratos" };

type Linha = {
  id: string;
  numero: number;
  codigo: string | null;
  status: string;
  data_inicio: string;
  data_fim: string;
  valor_aluguel: number;
  garantia_tipo: string;
  imovel: { codigo: string; logradouro: string | null; numero: string | null };
  contrato_partes: { papel: string; pessoa: { nome: string } }[];
};

export default async function ContratosPage({ searchParams }: PageProps<"/contratos">) {
  const sp = await searchParams;
  const status = typeof sp.status === "string" ? sp.status : "ativo";
  const { supabase } = await obterContexto();
  let q = supabase
    .from("contratos")
    .select(
      "id, numero, codigo, status, data_inicio, data_fim, valor_aluguel, garantia_tipo, imovel:imoveis(codigo, logradouro, numero), contrato_partes(papel, pessoa:pessoas(nome))",
    )
    .order("numero", { ascending: false })
    .limit(300);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  const contratos = (data ?? []) as unknown as Linha[];

  return (
    <>
      <Cabecalho
        titulo="Contratos de locação"
        acoes={<BotaoLink href="/contratos/novo">Novo contrato</BotaoLink>}
      />
      <FiltroAutomatico className="mb-4 flex gap-2">
        <Selecao name="status" defaultValue={status} className="max-w-48">
          <option value="">Todos</option>
          <option value="ativo">Ativos</option>
          <option value="rescindido">Rescindidos</option>
          <option value="encerrado">Encerrados</option>
        </Selecao>
      </FiltroAutomatico>
      <Tabela colunas={["Nº", "Imóvel", "Locatário", "Proprietário(s)", "Vigência", "Aluguel", "Garantia", "Situação"]}>
        {contratos.length === 0 && <LinhaVazia colunas={8}>Nenhum contrato.</LinhaVazia>}
        {contratos.map((c) => (
          <tr key={c.id} className="hover:bg-slate-50">
            <Celula>
              <Link href={`/contratos/${c.id}`} className="font-medium text-emerald-700 hover:underline">
                #{c.numero}
              </Link>
              {c.codigo && <div className="text-xs text-slate-500">{c.codigo}</div>}
            </Celula>
            <Celula>
              {c.imovel.codigo}
              <div className="text-xs text-slate-500">
                {c.imovel.logradouro} {c.imovel.numero}
              </div>
            </Celula>
            <Celula>{c.contrato_partes.filter((p) => p.papel === "locatario").map((p) => p.pessoa.nome).join(", ")}</Celula>
            <Celula>{c.contrato_partes.filter((p) => p.papel === "proprietario").map((p) => p.pessoa.nome).join(", ")}</Celula>
            <Celula>
              {formatarDataBR(c.data_inicio)} a {formatarDataBR(c.data_fim)}
            </Celula>
            <Celula>{formatarReais(c.valor_aluguel)}</Celula>
            <Celula>{ROTULO_GARANTIA[c.garantia_tipo]}</Celula>
            <Celula>
              <Selo cor={c.status === "ativo" ? "verde" : "cinza"}>{c.status}</Selo>
            </Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
