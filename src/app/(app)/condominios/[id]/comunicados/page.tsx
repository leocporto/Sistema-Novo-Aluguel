import type { Metadata } from "next";
import { Megaphone, Pin, Plus } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Grade, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { PUBLICOS_COMUNICADO, comunicadoParaUnidade, mensagemComunicado, nomeUnidade } from "@/lib/dominio/condominios";
import { formatarDataBR, formatarDataLocal } from "@/lib/dominio/datas";
import { excluirComunicado, criarComunicado } from "../../actions-gestao";
import { blocosDo, carregarCondominio, unidadesDo, vinculosDo } from "../../dados";

export const metadata: Metadata = { title: "Comunicados do condomínio" };

/**
 * Mural de comunicados: para todos, um bloco ou unidades escolhidas; aparecem
 * no portal do condômino (com confirmação de leitura). Mensagem pronta para
 * WhatsApp/e-mail — o envio automático depende de um provedor (Integrações).
 */
export default async function ComunicadosPage({ params }: PageProps<"/condominios/[id]/comunicados">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [c, { data }, unidades, blocos, vinculos] = await Promise.all([
    carregarCondominio(supabase, id),
    supabase.from("cond_comunicados").select("id, titulo, texto, publico, bloco_id, unidades, publicado_em, expira_em, fixado, leituras:cond_comunicado_leituras(pessoa_id)").eq("condominio_id", id).order("publicado_em", { ascending: false }).limit(100),
    unidadesDo(supabase, id),
    blocosDo(supabase, id),
    vinculosDo(supabase, id),
  ]);
  const lista = (data ?? []) as unknown as { id: string; titulo: string; texto: string; publico: string; bloco_id: string | null; unidades: string[]; publicado_em: string; expira_em: string | null; fixado: boolean; leituras: { pessoa_id: string }[] }[];

  /** Pessoas (com unidade) que recebem o comunicado. */
  const destinatarios = (cm: (typeof lista)[number]) => {
    const us = unidades.filter((u) => comunicadoParaUnidade(cm, u)).map((u) => u.id);
    return [...new Map(vinculos.filter((v) => v.unidade_id && us.includes(v.unidade_id) && v.pessoa).map((v) => [v.pessoa_id, v.pessoa!])).values()];
  };

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Novo comunicado</>} titulo="Novo comunicado" acao={criarComunicado} icone={<Megaphone />} larguraMax="max-w-2xl" rotuloSalvar="Publicar">
          <input type="hidden" name="condominio_id" value={id} />
          <Campo rotulo="Título">
            <Entrada name="titulo" required placeholder="Ex.: Limpeza da caixa d'água" />
          </Campo>
          <Campo rotulo="Texto">
            <AreaTexto name="texto" required rows={5} />
          </Campo>
          <Grade colunas={3}>
            <Campo rotulo="Para quem">
              <Selecao name="publico" defaultValue="todos">
                {Object.entries(PUBLICOS_COMUNICADO).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Bloco (se for um bloco)">
              <Selecao name="bloco_id" defaultValue="">
                <option value="">—</option>
                {blocos.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Sai do mural em">
              <Entrada name="expira_em" type="date" />
            </Campo>
          </Grade>
          {unidades.length > 0 && (
            <details className="rounded-[12px] border border-borda p-3">
              <summary className="cursor-pointer text-sm text-texto-2">Unidades escolhidas (se for para algumas unidades)</summary>
              <div className="mt-2 grid max-h-48 grid-cols-3 gap-1 overflow-y-auto">
                {unidades.map((u) => (
                  <label key={u.id} className="flex items-center gap-1.5 text-sm text-texto">
                    <input type="checkbox" name="unidades" value={u.id} className="size-4 accent-[var(--accent)]" /> {nomeUnidade(u)}
                  </label>
                ))}
              </div>
            </details>
          )}
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="hidden" name="fixado" value="off" />
            <input type="checkbox" name="fixado" className="size-4 accent-[var(--accent)]" /> Fixar no topo do mural
          </label>
        </JanelaCadastro>
      </div>

      {lista.length === 0 && (
        <Cartao>
          <p className="text-sm text-mudo">Nenhum comunicado. O que for publicado aqui aparece no portal do condômino.</p>
        </Cartao>
      )}
      {lista.map((cm) => {
        const dest = destinatarios(cm);
        const lidos = new Set(cm.leituras.map((l) => l.pessoa_id));
        const msg = mensagemComunicado({ condominio: c?.nome ?? "Condomínio", titulo: cm.titulo, texto: cm.texto });
        const emails = dest.map((p) => p.email).filter(Boolean).join(",");
        return (
          <Cartao
            key={cm.id}
            titulo={
              <span className="flex flex-wrap items-center gap-2">
                {cm.fixado && <Pin className="size-4 text-acento" />}
                {cm.titulo}
                <Selo cor="cinza">
                  {cm.publico === "todos" ? "todos" : cm.publico === "bloco" ? (blocos.find((b) => b.id === cm.bloco_id)?.nome ?? "bloco") : `${cm.unidades.length} unidade(s)`}
                </Selo>
              </span>
            }
            acoes={<BotaoExcluir acao={excluirComunicado} id={cm.id} rotulo="Excluir comunicado" confirmar={`Excluir o comunicado "${cm.titulo}"? Ele sai do portal.`} />}
          >
            <p className="whitespace-pre-line text-sm text-texto">{cm.texto}</p>
            <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-mudo">
              <span>Publicado em {formatarDataLocal(cm.publicado_em)}</span>
              {cm.expira_em && <span>· sai do mural em {formatarDataBR(cm.expira_em)}</span>}
              <span>
                · lido por {[...lidos].filter((p) => dest.some((d) => d.id === p)).length} de {dest.length} pessoa(s) pelo portal
              </span>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Copiar texto={msg} rotulo="Copiar para o WhatsApp" />
              {emails && (
                <a href={`mailto:?bcc=${encodeURIComponent(emails)}&subject=${encodeURIComponent(`${c?.nome ?? ""}: ${cm.titulo}`)}&body=${encodeURIComponent(msg)}`} className={classeBotao("secundario", "sm")}>
                  Mandar por e-mail
                </a>
              )}
            </div>
          </Cartao>
        );
      })}
    </div>
  );
}
