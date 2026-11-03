import type { Metadata } from "next";
import { CircleCheck, CircleDashed } from "lucide-react";
import { Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { pendencias } from "@/lib/dominio/pessoas";
import { CATEGORIAS_DOCUMENTO_PESSOA, type Pessoa } from "@/lib/tipos";
import { ArquivosPessoa } from "./arquivos-pessoa";
import { DocumentosVinculados } from "../../../documentos/vinculados";

export const metadata: Metadata = { title: "Documentos da pessoa" };

export default async function DocumentosPessoaPage({ params }: PageProps<"/pessoas/[id]/documentos">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const [{ data: p }, { data: arqs }] = await Promise.all([
    supabase.from("pessoas").select("*").eq("id", id).single(),
    supabase.from("pessoa_arquivos").select("id, nome, categoria, created_at").eq("pessoa_id", id).order("created_at", { ascending: false }),
  ]);
  const pessoa = p as Pessoa;
  const lista = arqs ?? [];
  const cats = lista.map((a) => a.categoria as string);
  const faltando = pendencias(pessoa, cats, organizacao.modo).filter((f) => f.startsWith("Falta"));
  const primeiraFalta = CATEGORIAS_DOCUMENTO_PESSOA.find((c) => faltando.some((f) => f.includes(c.split(" ")[0]) || f.includes(c)));
  const enviados = [...new Set(cats)];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <Cartao titulo={`Documentos (${lista.length})`}>
        <ArquivosPessoa
          organizacaoId={organizacao.id}
          pessoaId={id}
          categorias={CATEGORIAS_DOCUMENTO_PESSOA}
          sugerida={primeiraFalta}
          arquivos={lista.map((a) => ({ id: a.id, nome: a.nome, categoria: a.categoria, criado: formatarDataBR(String(a.created_at).slice(0, 10)) }))}
        />
      </Cartao>
      <Cartao titulo="Checklist">
        <ul className="space-y-2 text-sm">
          {faltando.map((f) => (
            <li key={f} className="flex items-center gap-2 text-alerta">
              <CircleDashed className="size-4 shrink-0" /> {f.replace("Falta ", "")}
            </li>
          ))}
          {enviados.map((c) => (
            <li key={c} className="flex items-center gap-2 text-ok">
              <CircleCheck className="size-4 shrink-0" /> {c}
            </li>
          ))}
          {!faltando.length && !enviados.length && <li className="text-mudo">Nada exigido para os papéis desta pessoa.</li>}
        </ul>
        <p className="mt-3 text-xs text-mudo">O que é exigido depende do papel: locatário e fiador precisam de documento, residência e renda; proprietário, de documento (e contrato social se for empresa).</p>
      </Cartao>
      <DocumentosVinculados campo="pessoa_id" id={id} />
    </div>
  );
}
