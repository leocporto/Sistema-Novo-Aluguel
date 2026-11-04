import type { Metadata } from "next";
import { Plus, Scale } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Cabecalho, Campo, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { TIPOS_APROVACAO, TIPO_QUALQUER, descreverAprovador } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../../abas";
import { alternarRegraAprovacao, criarRegraAprovacao, excluirRegraAprovacao } from "../../actions";
import { carregarEstrutura, carregarMembros, contextoEquipe, nomeDoMembro } from "../../dados";

export const metadata: Metadata = { title: "Quem aprova o quê" };

type Regra = { id: string; tipo: string; descricao: string | null; valor_minimo: number; aprovador_papel: string | null; aprovador_perfil_id: string | null; aprovador_id: string | null; ativa: boolean };

export default async function RegrasAprovacaoPage() {
  await exigirVerRota("/equipe/aprovacoes");
  const { supabase, pode } = await contextoEquipe();
  const podeEditar = pode("aprovacoes", "editar");
  const [{ data }, membros, estrutura] = await Promise.all([
    supabase.from("aprovacao_regras").select("id, tipo, descricao, valor_minimo, aprovador_papel, aprovador_perfil_id, aprovador_id, ativa").order("tipo").order("valor_minimo"),
    carregarMembros(supabase),
    carregarEstrutura(supabase),
  ]);
  const regras = (data ?? []) as Regra[];
  const nomes = new Map(membros.map((m) => [m.user_id, nomeDoMembro(m)]));
  const perfis = new Map(estrutura.perfis.map((p) => [p.id, p.nome]));
  const tipos: Record<string, string> = { [TIPO_QUALQUER]: "Qualquer tipo", ...TIPOS_APROVACAO };

  return (
    <>
      <Cabecalho
        titulo="Quem aprova o quê"
        trilha="Aprovações"
        descricao="Regras das solicitações da equipe: pelo tipo e a partir de qual valor, quem decide. Vale a regra do mesmo tipo com o maior valor mínimo alcançado; sem regra, decide um gestor ou o administrador. O administrador sempre pode decidir, e ninguém aprova o próprio pedido."
        acoes={
          podeEditar && (
            <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova regra</>} titulo="Nova regra de aprovação" acao={criarRegraAprovacao} icone={<Scale />} rotuloSalvar="Criar">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo de solicitação">
                  <Selecao name="tipo" defaultValue={TIPO_QUALQUER}>
                    {Object.entries(tipos).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="A partir de (R$)" dica="0 = qualquer valor.">
                  <Entrada name="valor_minimo" inputMode="decimal" defaultValue="0" />
                </Campo>
              </div>
              <Campo rotulo="Quem aprova">
                <Selecao name="aprovador" required defaultValue="papel:gestor">
                  <optgroup label="Por papel">
                    <option value="papel:gestor">Gestor (ou administrador)</option>
                    <option value="papel:financeiro">Financeiro (ou gestor)</option>
                    <option value="papel:admin">Só o administrador</option>
                  </optgroup>
                  {estrutura.perfis.length > 0 && (
                    <optgroup label="Por perfil de acesso">
                      {estrutura.perfis.map((p) => (
                        <option key={p.id} value={`perfil:${p.id}`}>
                          Perfil {p.nome}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  <optgroup label="Uma pessoa">
                    {membros.map((m) => (
                      <option key={m.user_id} value={`usuario:${m.user_id}`}>
                        {nomeDoMembro(m)}
                      </option>
                    ))}
                  </optgroup>
                </Selecao>
              </Campo>
              <Campo rotulo="Observação">
                <Entrada name="descricao" placeholder="Ex.: despesas grandes passam pela diretoria" />
              </Campo>
              <p className="text-xs text-mudo">Para decidir, a pessoa também precisa da permissão “Aprovar” em Aprovações no perfil de acesso dela.</p>
            </JanelaCadastro>
          )
        }
      />
      <AbasEquipe />
      {!podeEditar && (
        <div className="mb-4">
          <Aviso>Seu perfil de acesso não permite mudar estas regras.</Aviso>
        </div>
      )}
      <Tabela colunas={["Tipo", "A partir de", "Quem aprova", "Situação", ""]}>
        {regras.length === 0 && <LinhaVazia colunas={5}>Sem regras: toda solicitação vai para gestor ou administrador.</LinhaVazia>}
        {regras.map((r) => (
          <tr key={r.id}>
            <Celula>
              <span className="font-medium text-texto">{tipos[r.tipo] ?? r.tipo}</span>
              {r.descricao && <span className="block text-xs text-mudo">{r.descricao}</span>}
            </Celula>
            <Celula className="tabular-nums">{Number(r.valor_minimo) > 0 ? formatarReais(r.valor_minimo) : "qualquer valor"}</Celula>
            <Celula>{descreverAprovador({ ...r, solicitante_id: null }, { usuarios: nomes, perfis })}</Celula>
            <Celula>
              <Selo cor={r.ativa ? "verde" : "cinza"}>{r.ativa ? "ativa" : "pausada"}</Selo>
            </Celula>
            <Celula>
              {podeEditar && (
                <span className="flex items-center justify-end gap-2">
                  <BotaoAcao acao={alternarRegraAprovacao} id={r.id} tamanho="sm">
                    {r.ativa ? "Pausar" : "Ativar"}
                  </BotaoAcao>
                  <BotaoExcluir acao={excluirRegraAprovacao} id={r.id} rotulo="Excluir regra" confirmar="Excluir esta regra? As solicitações já feitas continuam com o aprovador que tinham." />
                </span>
              )}
            </Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
