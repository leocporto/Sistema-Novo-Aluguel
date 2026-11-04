import type { Metadata } from "next";
import Link from "next/link";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { Aviso, Cartao, Entrada } from "@/components/ui";
import { contextoEquipe } from "../../../dados";
import { porNaCarteira, tirarDaCarteira } from "../../../actions";

export const metadata: Metadata = { title: "Clientes da carteira" };

type Cliente = { id: string; nome: string; telefone: string | null; email: string | null; corretor_id: string | null };

/**
 * Carteira de clientes do corretor (pessoas.corretor_id): quem é atendido por
 * ele. O gestor põe e tira clientes aqui; a carteira inteira pode ser passada
 * para outro corretor em Equipe → Distribuição. Compradores de vendas com
 * corretor entram sozinhos na carteira dele.
 */
export default async function ClientesCarteiraPage({ params, searchParams }: PageProps<"/equipe/colaboradores/[id]/clientes">) {
  const { id } = await params;
  const sp = await searchParams;
  const busca = (typeof sp.q === "string" ? sp.q : "").trim().replace(/[%_,()*]/g, "").slice(0, 60);
  const { supabase, pode } = await contextoEquipe();
  const gestor = pode("equipe", "editar");
  const [{ data: carteira }, { data: achados }] = await Promise.all([
    supabase.from("pessoas").select("id, nome, telefone, email, corretor_id").eq("corretor_id", id).order("nome").limit(500),
    gestor && busca.length >= 2
      ? supabase
          .from("pessoas")
          .select("id, nome, telefone, email, corretor_id")
          .or(`nome.ilike.%${busca}%,telefone.ilike.%${busca}%,email.ilike.%${busca}%`)
          .neq("id", id)
          .eq("colaborador", false)
          .order("nome")
          .limit(20)
      : Promise.resolve({ data: [] as Cliente[] }),
  ]);
  const lista = (carteira ?? []) as Cliente[];
  const resultados = ((achados ?? []) as Cliente[]).filter((p) => p.corretor_id !== id);
  const outros = [...new Set(resultados.map((p) => p.corretor_id).filter(Boolean))] as string[];
  const { data: corretores } = outros.length ? await supabase.from("pessoas").select("id, nome").in("id", outros) : { data: [] };
  const nomeCorretor = new Map(((corretores ?? []) as { id: string; nome: string }[]).map((c) => [c.id, c.nome]));

  return (
    <div className="space-y-6">
      {gestor && (
        <Cartao titulo="Pôr cliente na carteira">
          <FiltroAutomatico className="mb-3 flex flex-wrap gap-2">
            <Entrada name="q" defaultValue={busca} placeholder="Nome, telefone ou e-mail do cliente" aria-label="Buscar cliente para a carteira" className="max-w-sm" />
          </FiltroAutomatico>
          {busca.length < 2 ? (
            <p className="text-sm text-mudo">Digite pelo menos 2 letras para buscar em Pessoas.</p>
          ) : resultados.length === 0 ? (
            <p className="text-sm text-mudo">Ninguém encontrado (ou já está nesta carteira).</p>
          ) : (
            <ul className="divide-y divide-borda-suave">
              {resultados.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="text-texto">{p.nome}</span>
                    <span className="block text-xs text-mudo">
                      {[p.telefone, p.email].filter(Boolean).join(" · ") || "—"}
                      {p.corretor_id && ` · hoje com ${nomeCorretor.get(p.corretor_id) ?? "outro corretor"}`}
                    </span>
                  </span>
                  <BotaoAcao
                    acao={porNaCarteira}
                    id={`${id}:${p.id}`}
                    tamanho="sm"
                    confirmar={p.corretor_id ? `${p.nome} está na carteira de ${nomeCorretor.get(p.corretor_id) ?? "outro corretor"}. Passar para esta carteira?` : undefined}
                  >
                    Pôr na carteira
                  </BotaoAcao>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      )}

      <Cartao
        titulo={`Clientes da carteira (${lista.length})`}
        acoes={
          gestor && lista.length > 0 ? (
            <Link href={`/equipe/distribuicao?de=${id}&tipo=clientes`} className="text-sm text-acento hover:underline">
              Passar para outro corretor
            </Link>
          ) : undefined
        }
      >
        {!gestor && <Aviso>Quem põe e tira clientes da carteira é o gestor (Equipe → editar).</Aviso>}
        {lista.length === 0 ? (
          <p className="mt-2 text-sm text-mudo">Nenhum cliente na carteira ainda.{gestor ? " Busque acima para incluir." : ""}</p>
        ) : (
          <ul className="mt-2 divide-y divide-borda-suave">
            {lista.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <Link href={`/pessoas/${p.id}`} className="min-w-0 flex-1 hover:underline">
                  <span className="text-texto">{p.nome}</span>
                  <span className="block text-xs text-mudo">{[p.telefone, p.email].filter(Boolean).join(" · ") || "—"}</span>
                </Link>
                {gestor && <BotaoExcluir acao={tirarDaCarteira} id={p.id} rotulo="Tirar da carteira" confirmar={`Tirar ${p.nome} desta carteira? O cadastro continua em Pessoas, sem corretor responsável.`} />}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
