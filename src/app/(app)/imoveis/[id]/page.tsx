import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/components/formulario";
import { BotaoEnviar } from "@/components/formulario";
import { Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import type { Imovel, Pessoa } from "@/lib/tipos";
import { adicionarProprietario, excluirImovel, removerProprietario } from "../actions";
import { FormImovel, type OpcaoEmpreendimento } from "../form-imovel";

export const metadata: Metadata = { title: "Imóvel" };

export default async function ImovelPage({ params }: PageProps<"/imoveis/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const [{ data }, { data: props }, { data: pessoas }, { data: contratos }, { data: chaves }, { data: emps }] = await Promise.all([
    supabase.from("imoveis").select("*").eq("id", id).maybeSingle(),
    supabase.from("imovel_proprietarios").select("percentual, pessoa:pessoas(id, nome)").eq("imovel_id", id),
    supabase.from("pessoas").select("id, nome").order("nome"),
    supabase.from("contratos").select("id, numero, status, data_inicio, valor_aluguel").eq("imovel_id", id).order("data_inicio", { ascending: false }),
    supabase.from("chaves").select("id, identificacao, local").eq("imovel_id", id),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("empreendimentos").select("id, nome").order("nome"),
  ]);
  if (!data) notFound();
  const imovel = data as Imovel;
  const proprietarios = (props ?? []) as unknown as { percentual: number; pessoa: { id: string; nome: string } }[];
  const soma = proprietarios.reduce((s, p) => s + Number(p.percentual), 0);
  const falta = Math.round((100 - soma) * 100) / 100;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <FormImovel imovel={imovel} pessoal={pessoal} empreendimentos={(emps ?? []) as OpcaoEmpreendimento[]} />
      <div className="space-y-6">
        {!pessoal && (
          <Cartao titulo="Proprietários e titularidade">
            <ul className="mb-4 space-y-2 text-sm">
              {proprietarios.map((p) => (
                <li key={p.pessoa.id} className="flex items-center justify-between gap-2">
                  <Link href={`/pessoas/${p.pessoa.id}`} className="text-acento hover:underline">
                    {p.pessoa.nome}
                  </Link>
                  <span className="flex items-center gap-2">
                    <Formulario acao={adicionarProprietario} automatico salvarQuando="percentual" className="flex items-center gap-1">
                      <input type="hidden" name="imovel_id" value={id} />
                      <input type="hidden" name="pessoa_id" value={p.pessoa.id} />
                      <input type="hidden" name="editar" value="1" />
                      <input
                        name="percentual"
                        inputMode="decimal"
                        required
                        aria-label={`Participação de ${p.pessoa.nome} (%)`}
                        defaultValue={String(Number(p.percentual))}
                        className="h-9 w-16 rounded-[9px] border border-borda-forte bg-input px-2 text-right text-sm outline-none focus:border-acento"
                      />
                      %
                    </Formulario>
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
            <Formulario
              key={proprietarios.map((p) => p.pessoa.id).join(",")}
              acao={adicionarProprietario}
              automatico
              salvarQuando="pessoa_id"
              className="space-y-3 border-t border-borda-suave pt-4"
            >
              <input type="hidden" name="imovel_id" value={id} />
              <p className="text-xs text-mudo">Adicionar proprietário: escolha a pessoa — entra na hora.</p>
              <Campo rotulo="Participação (%)">
                <Entrada name="percentual" inputMode="decimal" defaultValue={falta > 0 ? String(falta) : ""} placeholder="100" />
              </Campo>
              <Campo rotulo="Pessoa">
                <Selecao name="pessoa_id" required defaultValue="">
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {((pessoas ?? []) as Pick<Pessoa, "id" | "nome">[])
                    .filter((p) => !proprietarios.some((v) => v.pessoa.id === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                </Selecao>
              </Campo>
            </Formulario>
          </Cartao>
        )}

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

        <Formulario acao={excluirImovel} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <BotaoEnviar variante="fantasma" confirmar="Excluir este imóvel com fotos e documentos? Não dá para desfazer.">
            Excluir imóvel
          </BotaoEnviar>
        </Formulario>
      </div>
    </div>
  );
}
