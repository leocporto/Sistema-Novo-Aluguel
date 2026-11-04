import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { CATEGORIAS_TAREFA, PRIORIDADES_TAREFA, ROTULO_PRIORIDADE } from "@/lib/dominio/equipe";
import { nomeDoMembro, type Membro } from "../dados";

export type OpcoesTarefa = {
  membros: Membro[];
  imoveis: { id: string; codigo: string }[];
  contratos: { id: string; numero: number }[];
  pessoas: { id: string; nome: string }[];
  equipes: { id: string; nome: string }[];
};

export type TarefaEditavel = {
  titulo: string;
  descricao: string | null;
  categoria: string;
  prioridade: string;
  responsavel_id: string | null;
  prazo: string | null;
  imovel_id: string | null;
  contrato_id: string | null;
  pessoa_id: string | null;
  equipe_id: string | null;
};

/** Campos da tarefa interna (nova e edição). */
export function CamposTarefaInterna({ t, opcoes, eu }: { t?: TarefaEditavel; opcoes: OpcoesTarefa; eu: string }) {
  return (
    <div className="space-y-4">
      <Campo rotulo="O que precisa ser feito">
        <Entrada name="titulo" required defaultValue={t?.titulo ?? ""} />
      </Campo>
      <Campo rotulo="Detalhes">
        <AreaTexto name="descricao" rows={3} defaultValue={t?.descricao ?? ""} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Responsável">
          <Selecao name="responsavel_id" defaultValue={t ? (t.responsavel_id ?? "") : eu}>
            <option value="">Ninguém ainda</option>
            {opcoes.membros.map((m) => (
              <option key={m.user_id} value={m.user_id}>
                {nomeDoMembro(m)}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Prazo">
          <Entrada type="date" name="prazo" defaultValue={t?.prazo ?? ""} />
        </Campo>
        <Campo rotulo="Categoria">
          <Selecao name="categoria" defaultValue={t?.categoria ?? "geral"}>
            {Object.entries(CATEGORIAS_TAREFA).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Prioridade">
          <Selecao name="prioridade" defaultValue={t?.prioridade ?? "normal"}>
            {PRIORIDADES_TAREFA.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PRIORIDADE[p]}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <details className="rounded-[14px] border border-borda px-4 py-3" open={Boolean(t?.imovel_id || t?.contrato_id || t?.pessoa_id || t?.equipe_id)}>
        <summary className="cursor-pointer text-sm font-medium text-texto">Ligar a um imóvel, contrato, pessoa ou equipe (opcional)</summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Imóvel">
            <Selecao name="imovel_id" defaultValue={t?.imovel_id ?? ""}>
              <option value="">—</option>
              {opcoes.imoveis.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.codigo}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Contrato">
            <Selecao name="contrato_id" defaultValue={t?.contrato_id ?? ""}>
              <option value="">—</option>
              {opcoes.contratos.map((c) => (
                <option key={c.id} value={c.id}>
                  Contrato #{c.numero}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Pessoa">
            <Selecao name="pessoa_id" defaultValue={t?.pessoa_id ?? ""}>
              <option value="">—</option>
              {opcoes.pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Equipe">
            <Selecao name="equipe_id" defaultValue={t?.equipe_id ?? ""}>
              <option value="">—</option>
              {opcoes.equipes.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
        </div>
      </details>
    </div>
  );
}
