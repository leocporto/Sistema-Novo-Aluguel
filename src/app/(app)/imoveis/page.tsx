import type { Metadata } from "next";
import Link from "next/link";
import { BotaoLink, Cabecalho, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_STATUS_IMOVEL, type Imovel } from "@/lib/tipos";

export const metadata: Metadata = { title: "Imóveis" };

const corStatus = { disponivel: "verde", alugado: "azul", reservado: "amarelo", vendido: "cinza", inativo: "cinza" } as const;

export default async function ImoveisPage({ searchParams }: PageProps<"/imoveis">) {
  const sp = await searchParams;
  const busca = typeof sp.q === "string" ? sp.q.trim().replace(/[%,()]/g, "") : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const { supabase } = await obterContexto();

  let q = supabase.from("imoveis").select("*, imovel_proprietarios(pessoa:pessoas(nome))").order("codigo").limit(300);
  if (busca) q = q.or(`codigo.ilike.%${busca}%,logradouro.ilike.%${busca}%,bairro.ilike.%${busca}%,cidade.ilike.%${busca}%`);
  if (status) q = q.eq("status", status);
  const { data } = await q;
  const imoveis = (data ?? []) as (Imovel & { imovel_proprietarios: { pessoa: { nome: string } }[] })[];

  return (
    <>
      <Cabecalho
        titulo="Imóveis"
        descricao={`${imoveis.length} imóvel(is)`}
        acoes={<BotaoLink href="/imoveis/novo">Novo imóvel</BotaoLink>}
      />
      <form className="mb-4 flex flex-wrap gap-2">
        <Entrada name="q" placeholder="Código, rua, bairro ou cidade" defaultValue={busca} className="max-w-xs" />
        <Selecao name="status" defaultValue={status} className="max-w-48">
          <option value="">Todas as situações</option>
          {Object.entries(ROTULO_STATUS_IMOVEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Selecao>
        <button className={classeBotao("secundario")}>Filtrar</button>
      </form>
      <Tabela colunas={["Código", "Endereço", "Tipo", "Proprietário(s)", "Aluguel", "Situação"]}>
        {imoveis.length === 0 && <LinhaVazia colunas={6}>Nenhum imóvel cadastrado.</LinhaVazia>}
        {imoveis.map((i) => (
          <tr key={i.id} className="hover:bg-slate-50">
            <Celula>
              <Link href={`/imoveis/${i.id}`} className="font-medium text-emerald-700 hover:underline">
                {i.codigo}
              </Link>
            </Celula>
            <Celula>
              {[i.logradouro, i.numero, i.complemento].filter(Boolean).join(", ") || "—"}
              <div className="text-xs text-slate-500">{[i.bairro, i.cidade].filter(Boolean).join(" · ")}</div>
            </Celula>
            <Celula className="capitalize">{i.tipo}</Celula>
            <Celula>{i.imovel_proprietarios.map((p) => p.pessoa.nome).join(", ") || "—"}</Celula>
            <Celula>{i.valor_aluguel ? formatarReais(i.valor_aluguel) : "—"}</Celula>
            <Celula>
              <Selo cor={corStatus[i.status as keyof typeof corStatus] ?? "cinza"}>{ROTULO_STATUS_IMOVEL[i.status]}</Selo>
            </Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
