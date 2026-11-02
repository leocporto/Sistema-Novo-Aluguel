import type { Metadata } from "next";
import Link from "next/link";
import { BotaoLink, Cabecalho, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { ROTULO_PAPEL, type Pessoa } from "@/lib/tipos";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { LinhaLink } from "@/components/linha-link";

export const metadata: Metadata = { title: "Pessoas" };

export default async function PessoasPage({ searchParams }: PageProps<"/pessoas">) {
  const sp = await searchParams;
  const busca = typeof sp.q === "string" ? sp.q.trim() : "";
  const papel = typeof sp.papel === "string" ? sp.papel : "";
  const { supabase } = await obterContexto();

  let q = supabase.from("pessoas").select("*").order("nome").limit(200);
  if (busca) q = q.or(`nome.ilike.%${busca.replace(/[%,()]/g, "")}%,documento.ilike.%${busca.replace(/\D/g, "") || "_"}%`);
  if (papel) q = q.contains("papeis", [papel]);
  const { data } = await q;
  const pessoas = (data ?? []) as Pessoa[];

  return (
    <>
      <Cabecalho
        titulo="Pessoas"
        descricao="Proprietários, locatários, fiadores e clientes."
        acoes={<BotaoLink href="/pessoas/novo">Nova pessoa</BotaoLink>}
      />
      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Entrada name="q" placeholder="Buscar por nome ou documento" defaultValue={busca} className="max-w-xs" />
        <Selecao name="papel" defaultValue={papel} className="max-w-48">
          <option value="">Todos os papéis</option>
          {Object.entries(ROTULO_PAPEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Selecao>
      </FiltroAutomatico>
      <Tabela colunas={["Nome", "Documento", "Contato", "Papéis"]}>
        {pessoas.length === 0 && <LinhaVazia colunas={4}>Nenhuma pessoa encontrada.</LinhaVazia>}
        {pessoas.map((p) => (
          <LinhaLink href={`/pessoas/${p.id}`} key={p.id} className="hover:bg-card-hover">
            <Celula>
              <Link href={`/pessoas/${p.id}`} className="font-medium text-acento hover:underline">
                {p.nome}
              </Link>
              <div className="text-xs text-mudo">{p.tipo_pessoa === "PF" ? "Pessoa física" : "Pessoa jurídica"}</div>
            </Celula>
            <Celula>{formatarDocumento(p.documento) || "—"}</Celula>
            <Celula>
              <div>{p.email ?? "—"}</div>
              <div className="text-xs text-mudo">{p.telefone}</div>
            </Celula>
            <Celula>
              <div className="flex flex-wrap gap-1">
                {p.papeis.map((x) => (
                  <Selo key={x} cor={x === "proprietario" ? "verde" : x === "locatario" ? "azul" : "cinza"}>
                    {ROTULO_PAPEL[x] ?? x}
                  </Selo>
                ))}
              </div>
            </Celula>
          </LinhaLink>
        ))}
      </Tabela>
    </>
  );
}
