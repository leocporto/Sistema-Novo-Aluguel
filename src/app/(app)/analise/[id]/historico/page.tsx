import type { Metadata } from "next";
import { MessageSquarePlus } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { registrarNota } from "../../actions";
import { ROTULO_EVENTO, COR_EVENTO } from "../../eventos";
import { nomesEquipe, quando } from "../../dados";

export const metadata: Metadata = { title: "Histórico da análise" };

/** Tudo o que aconteceu nesta análise (gravado pelo banco; não se apaga). */
export default async function HistoricoAnalise({ params }: PageProps<"/analise/[id]/historico">) {
  const { id } = await params;
  const { supabase, usuario } = await obterContexto();
  const [{ data }, nome] = await Promise.all([
    supabase.from("analise_eventos").select("id, tipo, descricao, usuario_id, data").eq("analise_id", id).order("data", { ascending: false }).limit(500),
    nomesEquipe(supabase, usuario.id),
  ]);
  const eventos = data ?? [];

  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-texto-2">Registro automático de cada passo (quem fez e quando). Serve de auditoria: ninguém altera nem apaga.</p>
        <JanelaCadastro rotuloBotao={<><MessageSquarePlus className="size-4" /> Anotação</>} titulo="Registrar anotação" acao={registrarNota} rotuloSalvar="Registrar" icone={<MessageSquarePlus />}>
          <input type="hidden" name="analise_id" value={id} />
          <Campo rotulo="O que aconteceu">
            <AreaTexto name="descricao" required rows={4} placeholder="Ligação, conversa com a seguradora, pedido de prazo…" />
          </Campo>
        </JanelaCadastro>
      </div>
      <Tabela colunas={["Quando", "O quê", "Detalhe", "Quem"]}>
        {eventos.map((e) => (
          <tr key={e.id} className="align-top">
            <Celula className="whitespace-nowrap">{quando(e.data)}</Celula>
            <Celula>
              <Selo cor={COR_EVENTO[e.tipo] ?? "cinza"}>{ROTULO_EVENTO[e.tipo] ?? e.tipo}</Selo>
            </Celula>
            <Celula>
              <span className="text-sm text-texto">{e.descricao}</span>
            </Celula>
            <Celula>
              <span className="text-xs text-texto-2">{nome(e.usuario_id)}</span>
            </Celula>
          </tr>
        ))}
        {eventos.length === 0 && <LinhaVazia colunas={4}>Nada registrado ainda.</LinhaVazia>}
      </Tabela>
    </>
  );
}
