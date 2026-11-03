import type { Metadata } from "next";
import Link from "next/link";
import { BotaoLink, Cabecalho, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { PilulasLink } from "@/components/pilulas-link";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_GARANTIA } from "@/lib/tipos";
import { LinhaLink } from "@/components/linha-link";

export const metadata: Metadata = { title: "Contratos" };

const FILTROS: Record<string, string> = {
  ativo: "Ativos",
  vencendo: "Vencendo (90 dias)",
  desocupacao: "Em desocupação",
  encerrados: "Encerrados",
  rascunho: "Rascunhos",
  todos: "Todos",
};

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
  const status = typeof sp.status === "string" && sp.status in FILTROS ? sp.status : "ativo";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const { data: desoc } = await supabase.from("contrato_desocupacoes").select("contrato_id").neq("status", "concluida");
  const emDesocupacao = new Set((desoc ?? []).map((d) => d.contrato_id as string));
  let q = supabase
    .from("contratos")
    .select(
      "id, numero, codigo, status, data_inicio, data_fim, valor_aluguel, garantia_tipo, imovel:imoveis(codigo, logradouro, numero), contrato_partes(papel, pessoa:pessoas(nome))",
    )
    .order("numero", { ascending: false })
    .limit(300);
  if (status === "vencendo") q = q.eq("status", "ativo").lte("data_fim", somarDias(hoje, 90));
  else if (status === "desocupacao") q = q.in("id", [...emDesocupacao, "00000000-0000-0000-0000-000000000000"]);
  else if (status === "encerrados") q = q.in("status", ["encerrado", "rescindido"]);
  else if (status !== "todos") q = q.eq("status", status);
  const { data } = await q;
  const contratos = (data ?? []) as unknown as Linha[];

  return (
    <>
      <Cabecalho
        titulo="Contratos de locação"
        acoes={<BotaoLink href="/contratos/novo">Novo contrato</BotaoLink>}
      />
      <PilulasLink
        className="mb-4"
        rotulo="Situação"
        ativo={status === "ativo" ? "/contratos" : `/contratos?status=${status}`}
        itens={Object.entries(FILTROS).map(([k, r]) => ({ href: k === "ativo" ? "/contratos" : `/contratos?status=${k}`, rotulo: r }))}
      />
      <Tabela colunas={["Nº", "Imóvel", "Locatário", "Proprietário(s)", "Vigência", "Aluguel", "Garantia", "Situação"]}>
        {contratos.length === 0 && <LinhaVazia colunas={8}>Nenhum contrato.</LinhaVazia>}
        {contratos.map((c) => (
          <LinhaLink href={`/contratos/${c.id}`} key={c.id} className="hover:bg-card-hover">
            <Celula>
              <Link href={`/contratos/${c.id}`} className="font-medium text-acento hover:underline">
                #{c.numero}
              </Link>
              {c.codigo && <div className="text-xs text-mudo">{c.codigo}</div>}
            </Celula>
            <Celula>
              {c.imovel.codigo}
              <div className="text-xs text-mudo">
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
              <Selo cor={c.status === "ativo" ? (c.data_fim < hoje ? "amarelo" : "verde") : c.status === "rascunho" ? "amarelo" : "cinza"}>
                {c.status === "ativo" && c.data_fim < hoje ? "prazo vencido" : c.status}
              </Selo>
              {emDesocupacao.has(c.id) && <div className="mt-1 text-xs text-alerta">em desocupação</div>}
            </Celula>
          </LinhaLink>
        ))}
      </Tabela>
    </>
  );
}
