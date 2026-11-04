import type { Metadata } from "next";
import { Eye, EyeOff, FileText, Globe } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COR_VALIDADE, TIPOS_DOCUMENTO_COND, situacaoValidade } from "@/lib/dominio/condominios";
import { agoraMs, formatarDataBR, formatarDataLocal, hojeISO } from "@/lib/dominio/datas";
import { excluirDocumento, liberarDocumentoPortal, salvarDocumento, tirarDocumentoPortal } from "../../actions-gestao";
import { EnviarDocumento } from "../../envios";

export const metadata: Metadata = { title: "Documentos do condomínio" };

type Doc = { id: string; tipo: string; titulo: string; path: string; nome_arquivo: string | null; validade: string | null; publico_portal: boolean; link_expira_em: string | null; created_at: string };

/**
 * Documentos condominiais no bucket privado "condominios" (convenção,
 * regimento, atas, seguro, AVCB, contratos) com validade e alerta. No portal
 * do condômino só por link assinado gerado aqui (30 dias; o anônimo nunca lê o Storage).
 */
export default async function DocumentosPage({ params }: PageProps<"/condominios/[id]/documentos">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const agoraIso = new Date(agoraMs()).toISOString();
  const { data } = await supabase
    .from("cond_documentos")
    .select("id, tipo, titulo, path, nome_arquivo, validade, publico_portal, link_expira_em, created_at")
    .eq("condominio_id", id)
    .order("tipo")
    .order("created_at", { ascending: false });
  const docs = (data ?? []) as Doc[];
  const { data: links } = docs.length ? await supabase.storage.from("condominios").createSignedUrls(docs.map((d) => d.path), 600) : { data: [] };
  const url = new Map((links ?? []).map((l) => [l.path, l.signedUrl]));

  return (
    <div className="space-y-5">
      <Cartao titulo="Enviar documento">
        <EnviarDocumento organizacaoId={organizacao.id} condominioId={id} />
      </Cartao>
      {docs.length === 0 && (
        <Cartao>
          <p className="text-sm text-mudo">Nenhum documento ainda. Comece pela convenção, o regimento interno, a apólice de seguro e o AVCB.</p>
        </Cartao>
      )}
      <div className="space-y-2">
        {docs.map((d) => {
          const v = situacaoValidade(d.validade, hoje);
          const linkValido = d.publico_portal && d.link_expira_em && d.link_expira_em > agoraIso;
          return (
            <Formulario key={d.id} acao={salvarDocumento} automatico semAviso className="flex flex-wrap items-center gap-2 rounded-card border border-borda bg-card px-4 py-3">
              <input type="hidden" name="id" value={d.id} />
              <input type="hidden" name="condominio_id" value={id} />
              <FileText className="size-5 text-mudo" />
              <Selecao name="tipo" defaultValue={d.tipo} aria-label="Tipo do documento" className="!w-44">
                {Object.entries(TIPOS_DOCUMENTO_COND).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
              <Entrada name="titulo" required defaultValue={d.titulo} aria-label="Nome do documento" className="!w-auto min-w-48 flex-1" />
              <Entrada name="validade" type="date" defaultValue={d.validade ?? ""} aria-label="Validade" className="!w-44" />
              {v.situacao && v.situacao !== "ok" && <Selo cor={COR_VALIDADE[v.situacao]}>{v.situacao === "vencido" ? "vencido" : `vence em ${v.dias} dia(s)`}</Selo>}
              {linkValido ? <Selo cor="verde">no portal até {formatarDataLocal(d.link_expira_em)}</Selo> : d.publico_portal ? <Selo cor="amarelo">link do portal venceu</Selo> : null}
              <span className="ml-auto flex items-center gap-2">
                {url.get(d.path) && (
                  <a href={url.get(d.path)!} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                    <Eye className="size-3.5" /> Abrir
                  </a>
                )}
                <BotaoAcao acao={liberarDocumentoPortal} id={d.id} tamanho="sm" confirmar="Deixar este arquivo disponível no portal do condômino por 30 dias (link assinado)?">
                  <Globe className="size-3.5" /> {linkValido ? "Renovar no portal" : "Pôr no portal"}
                </BotaoAcao>
                {d.publico_portal && (
                  <BotaoAcao acao={tirarDocumentoPortal} id={d.id} tamanho="sm" variante="fantasma" confirmar="Tirar este documento do portal?">
                    <EyeOff className="size-3.5" />
                  </BotaoAcao>
                )}
                <BotaoExcluir acao={excluirDocumento} id={d.id} rotulo="Excluir documento" confirmar={`Excluir ${d.titulo}? O arquivo é apagado.`} />
              </span>
              <span className="w-full text-xs text-mudo">
                {d.nome_arquivo ?? ""} · enviado em {formatarDataLocal(d.created_at)}
                {d.validade ? ` · validade ${formatarDataBR(d.validade)}` : ""}
              </span>
            </Formulario>
          );
        })}
      </div>
    </div>
  );
}
