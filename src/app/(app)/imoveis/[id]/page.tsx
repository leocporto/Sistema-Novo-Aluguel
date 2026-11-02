import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { BotaoLink, Cabecalho, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import type { Imovel, Pessoa } from "@/lib/tipos";
import { adicionarProprietario, removerProprietario } from "../actions";
import { FormImovel } from "../form-imovel";

export const metadata: Metadata = { title: "Imóvel" };

export default async function ImovelPage({ params }: PageProps<"/imoveis/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("imoveis").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const imovel = data as Imovel;

  const [{ data: props }, { data: pessoas }, { data: contratos }, { data: chaves }] = await Promise.all([
    supabase.from("imovel_proprietarios").select("percentual, pessoa:pessoas(id, nome)").eq("imovel_id", id),
    supabase.from("pessoas").select("id, nome").order("nome"),
    supabase.from("contratos").select("id, numero, status, data_inicio, valor_aluguel").eq("imovel_id", id).order("data_inicio", { ascending: false }),
    supabase.from("chaves").select("id, identificacao, local").eq("imovel_id", id),
  ]);
  const proprietarios = (props ?? []) as unknown as { percentual: number; pessoa: { id: string; nome: string } }[];
  const soma = proprietarios.reduce((s, p) => s + Number(p.percentual), 0);

  return (
    <>
      <Cabecalho
        titulo={`Imóvel ${imovel.codigo}`}
        descricao={[imovel.logradouro, imovel.numero, imovel.bairro, imovel.cidade].filter(Boolean).join(", ")}
        acoes={<BotaoLink href={`/contratos/novo?imovel=${imovel.id}`}>Novo contrato de locação</BotaoLink>}
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
        <FormImovel imovel={imovel} />
        <div className="space-y-6">
          <Cartao titulo="Proprietários">
            <ul className="mb-4 space-y-2 text-sm">
              {proprietarios.map((p) => (
                <li key={p.pessoa.id} className="flex items-center justify-between gap-2">
                  <Link href={`/pessoas/${p.pessoa.id}`} className="text-acento hover:underline">
                    {p.pessoa.nome}
                  </Link>
                  <span className="flex items-center gap-2">
                    {Number(p.percentual)}%
                    <form action={removerProprietario}>
                      <input type="hidden" name="imovel_id" value={id} />
                      <input type="hidden" name="pessoa_id" value={p.pessoa.id} />
                      <button className="text-xs text-ruim hover:underline">remover</button>
                    </form>
                  </span>
                </li>
              ))}
              {proprietarios.length === 0 && <li className="text-mudo">Nenhum proprietário vinculado.</li>}
            </ul>
            {proprietarios.length > 0 && Math.abs(soma - 100) > 0.01 && (
              <p className="mb-3 text-xs text-alerta">As participações somam {soma}% — devem somar 100%.</p>
            )}
            <Formulario acao={adicionarProprietario} className="space-y-3">
              <input type="hidden" name="imovel_id" value={id} />
              <Campo rotulo="Pessoa">
                <Selecao name="pessoa_id" required defaultValue="">
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {((pessoas ?? []) as Pick<Pessoa, "id" | "nome">[]).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Participação (%)">
                <Entrada name="percentual" inputMode="decimal" defaultValue={proprietarios.length ? "" : "100"} />
              </Campo>
              <BotaoEnviar variante="secundario">Vincular proprietário</BotaoEnviar>
            </Formulario>
          </Cartao>

          <Cartao titulo="Contratos de locação">
            <ul className="space-y-2 text-sm">
              {(contratos ?? []).map((c) => (
                <li key={c.id} className="flex items-center justify-between">
                  <Link href={`/contratos/${c.id}`} className="text-acento hover:underline">
                    #{c.numero} · {formatarReais(c.valor_aluguel)}
                  </Link>
                  <Selo cor={c.status === "ativo" ? "verde" : "cinza"}>{c.status}</Selo>
                </li>
              ))}
              {!contratos?.length && <li className="text-mudo">Nenhum contrato.</li>}
            </ul>
          </Cartao>

          <Cartao titulo="Chaves" acoes={<Link href="/chaves" className="text-xs text-acento">gerenciar</Link>}>
            <ul className="space-y-1 text-sm">
              {(chaves ?? []).map((c) => (
                <li key={c.id}>
                  {c.identificacao} <span className="text-mudo">— {c.local ?? "sem local"}</span>
                </li>
              ))}
              {!chaves?.length && <li className="text-mudo">Nenhuma chave cadastrada.</li>}
            </ul>
          </Cartao>
        </div>
      </div>
    </>
  );
}
