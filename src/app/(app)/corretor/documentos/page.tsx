import type { Metadata } from "next";
import { ExternalLink } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Cartao, Celula, LinhaVazia, Tabela, classeBotao } from "@/components/ui";
import { diaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR } from "@/lib/dominio/datas";
import { excluirDocumentoCorretor } from "../actions";
import { contextoCorretor, portalCorretor, semVinculo } from "../dados";
import { AvisoSemVinculo, TopoCorretor } from "../topo";
import { EnviarDocumentoCorretor } from "./enviar";

export const metadata: Metadata = { title: "Documentação do corretor" };

const ROTULO_CATEGORIA: Record<string, string> = { pessoal: "Meu documento", cliente: "Cliente", imovel: "Imóvel", proposta: "Proposta / ficha", outro: "Outro" };

type Doc = { id: string; titulo: string; categoria: string; path: string; nome: string | null; created_at: string; lead: { nome: string } | null };

/**
 * Documentação do corretor e dos clientes dele (bucket privado "corretores",
 * pasta <org>/<corretor>/). O corretor só vê e envia na pasta dele (RLS no banco
 * e no Storage); a gestão vê de todos.
 */
export default async function DocumentosCorretorPage({ searchParams }: PageProps<"/corretor/documentos">) {
  const ctx = await contextoCorretor(await searchParams);
  const resumo = await portalCorretor<{ pessoa: { id: string; nome: string } }>(ctx.supabase, "resumo", ctx.escolhido);
  if (semVinculo(resumo))
    return (
      <>
        <TopoCorretor ctx={ctx} titulo="Documentação" />
        <AvisoSemVinculo ctx={ctx} />
      </>
    );
  const corretorId = resumo.pessoa.id;
  const [{ data }, leads] = await Promise.all([
    ctx.supabase.from("corretor_documentos").select("id, titulo, categoria, path, nome, created_at, lead:leads(nome)").eq("corretor_id", corretorId).order("created_at", { ascending: false }).limit(300),
    portalCorretor<{ id: string; nome: string; status: string }[]>(ctx.supabase, "leads", ctx.escolhido),
  ]);
  const docs = (data ?? []) as unknown as Doc[];
  const { data: links } = docs.length ? await ctx.supabase.storage.from("corretores").createSignedUrls(docs.map((d) => d.path), 3600) : { data: [] };
  const url = new Map((links ?? []).map((l) => [l.path, l.signedUrl]));
  const leadsAbertos = semVinculo(leads) ? [] : leads.filter((l) => l.status !== "perdido").map((l) => ({ id: l.id, nome: l.nome }));

  return (
    <>
      <TopoCorretor ctx={ctx} titulo="Documentação" descricao="Envie e guarde documentos seus e dos seus clientes (fotos ou PDF, até 10 MB). Só você e a gestão da imobiliária veem." />
      <div className="space-y-5">
        <Cartao titulo={`Enviar documento${ctx.escolhido ? ` para ${resumo.pessoa.nome}` : ""}`}>
          <EnviarDocumentoCorretor organizacaoId={ctx.organizacao.id} corretorId={corretorId} leads={leadsAbertos} />
        </Cartao>
        <Tabela colunas={["Documento", "Tipo", "Lead", "Enviado em", ""]}>
          {docs.length === 0 && <LinhaVazia colunas={5}>Nenhum documento ainda.</LinhaVazia>}
          {docs.map((d) => (
            <tr key={d.id}>
              <Celula>
                <span className="font-medium">{d.titulo}</span>
                {d.nome && d.nome !== d.titulo && <span className="block text-xs text-mudo">{d.nome}</span>}
              </Celula>
              <Celula>{ROTULO_CATEGORIA[d.categoria] ?? d.categoria}</Celula>
              <Celula>{d.lead?.nome ?? "—"}</Celula>
              <Celula>{formatarDataBR(diaLocal(d.created_at))}</Celula>
              <Celula>
                <div className="flex justify-end gap-2">
                  {url.get(d.path) && (
                    <a href={url.get(d.path) as string} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                      <ExternalLink className="size-3.5" /> Abrir
                    </a>
                  )}
                  <BotaoExcluir acao={excluirDocumentoCorretor} id={d.id} rotulo="Excluir documento" confirmar={`Excluir "${d.titulo}"? O arquivo é apagado.`} />
                </div>
              </Celula>
            </tr>
          ))}
        </Tabela>
      </div>
    </>
  );
}
