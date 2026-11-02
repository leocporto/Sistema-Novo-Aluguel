import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoEnviar } from "@/components/formulario";
import { BotaoLink, Cabecalho, Cartao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_PAPEL, type Pessoa } from "@/lib/tipos";
import { excluirPessoa } from "../actions";
import { FormPessoa } from "../form-pessoa";

export const metadata: Metadata = { title: "Pessoa" };

export default async function PessoaPage({ params }: PageProps<"/pessoas/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("pessoas").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const pessoa = data as Pessoa;

  const { data: vinculos } = await supabase
    .from("contrato_partes")
    .select("papel, contrato:contratos(id, numero, status, imovel:imoveis(codigo, logradouro, numero))")
    .eq("pessoa_id", id);
  const { data: imoveis } = await supabase
    .from("imovel_proprietarios")
    .select("percentual, imovel:imoveis(id, codigo, logradouro, numero, status)")
    .eq("pessoa_id", id);

  type Vinc = {
    papel: string;
    contrato: { id: string; numero: number; status: string; imovel: { codigo: string; logradouro: string | null; numero: string | null } };
  };
  type Prop = { percentual: number; imovel: { id: string; codigo: string; logradouro: string | null; numero: string | null; status: string } };

  return (
    <>
      <Cabecalho
        titulo={pessoa.nome}
        descricao={pessoa.papeis.map((p) => ROTULO_PAPEL[p] ?? p).join(" · ")}
        acoes={
          pessoa.papeis.includes("proprietario") ? (
            <BotaoLink variante="secundario" href={`/repasses/extrato?pessoa=${pessoa.id}`}>
              Extrato de repasses
            </BotaoLink>
          ) : undefined
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
        <FormPessoa pessoa={pessoa} />
        <div className="space-y-6">
          <Cartao titulo="Imóveis (proprietário)">
            <ul className="space-y-2 text-sm">
              {((imoveis ?? []) as unknown as Prop[]).map((i) => (
                <li key={i.imovel.id}>
                  <Link className="text-emerald-700 hover:underline" href={`/imoveis/${i.imovel.id}`}>
                    {i.imovel.codigo}
                  </Link>{" "}
                  — {i.imovel.logradouro} {i.imovel.numero} ({Number(i.percentual)}%)
                </li>
              ))}
              {!imoveis?.length && <li className="text-slate-500">Nenhum.</li>}
            </ul>
          </Cartao>
          <Cartao titulo="Contratos">
            <ul className="space-y-2 text-sm">
              {((vinculos ?? []) as unknown as Vinc[]).map((v) => (
                <li key={`${v.contrato.id}-${v.papel}`} className="flex items-center justify-between gap-2">
                  <Link className="text-emerald-700 hover:underline" href={`/contratos/${v.contrato.id}`}>
                    #{v.contrato.numero} · {v.contrato.imovel.codigo}
                  </Link>
                  <Selo>{ROTULO_PAPEL[v.papel] ?? v.papel}</Selo>
                </li>
              ))}
              {!vinculos?.length && <li className="text-slate-500">Nenhum.</li>}
            </ul>
          </Cartao>
          <form action={excluirPessoa}>
            <input type="hidden" name="id" value={pessoa.id} />
            <BotaoEnviar variante="fantasma" confirmar="Excluir este cadastro?">
              Excluir cadastro
            </BotaoEnviar>
          </form>
        </div>
      </div>
    </>
  );
}
