import type { Metadata } from "next";
import { BarraProgresso } from "@/components/barra-progresso";
import { Formulario } from "@/components/formulario";
import { Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { CHECKLIST_DOCS_VENDA, ROTULO_PARTE_DOC, progressoChecklistVenda } from "@/lib/dominio/vendas";
import { salvarChecklistVenda } from "../../actions";
import { ArquivosVenda } from "./arquivos-venda";

export const metadata: Metadata = { title: "Documentação da venda" };

export default async function DocumentosVenda({ params }: PageProps<"/vendas/[id]/documentos">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const [{ data: v }, { data: arqs }] = await Promise.all([
    supabase.from("vendas").select("checklist_docs").eq("id", id).single(),
    supabase.from("venda_arquivos").select("id, nome, categoria, parte, created_at").eq("venda_id", id).order("created_at", { ascending: false }),
  ]);
  const marcados = (v?.checklist_docs ?? {}) as Record<string, boolean>;
  const prog = progressoChecklistVenda(marcados);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <Cartao titulo={`Arquivos (${arqs?.length ?? 0})`}>
        <ArquivosVenda
          organizacaoId={organizacao.id}
          vendaId={id}
          arquivos={(arqs ?? []).map((a) => ({ id: a.id, nome: a.nome, categoria: a.categoria, parte: a.parte, criado: formatarDataBR(String(a.created_at).slice(0, 10)) }))}
        />
      </Cartao>
      <Cartao titulo={`Checklist de documentos e certidões (${prog.feitos}/${prog.total})`}>
        <BarraProgresso pct={prog.pct} atingida={prog.feitos === prog.total} />
        <Formulario acao={salvarChecklistVenda} automatico className="mt-4 space-y-4">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="qual" value="docs" />
          {CHECKLIST_DOCS_VENDA.map((g) => (
            <fieldset key={g.parte}>
              <legend className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">{ROTULO_PARTE_DOC[g.parte]}</legend>
              {g.itens.map((i) => (
                <label key={i.id} className="flex cursor-pointer items-start gap-2.5 rounded-[10px] px-2 py-1.5 text-sm text-texto-2 transition hover:bg-elev has-[:checked]:text-texto">
                  <input type="checkbox" name="item" value={i.id} defaultChecked={!!marcados[i.id]} className="mt-0.5 size-4 accent-[var(--accent)]" />
                  {i.rotulo}
                </label>
              ))}
            </fieldset>
          ))}
        </Formulario>
      </Cartao>
    </div>
  );
}
