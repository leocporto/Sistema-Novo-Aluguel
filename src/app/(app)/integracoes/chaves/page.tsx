import type { Metadata } from "next";
import Link from "next/link";
import { KeyRound, Plus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Aviso, Cabecalho, Campo, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { COR_SITUACAO_CHAVE, LIMITE_HORA_CHAVE, ROTULO_ESCOPO, ROTULO_SITUACAO_CHAVE, escoposDoModo, situacaoChave } from "@/lib/dominio/integracoes";
import { AbasIntegracoes } from "../abas";
import { criarChave, excluirChave, revogarChave } from "../actions";
import { quando, type ChaveApi } from "../dados";
import { JanelaSegredo } from "../janela-segredo";

export const metadata: Metadata = { title: "Chaves de API" };

const VALIDADES = [
  { dias: 0, rotulo: "Sem data para expirar" },
  { dias: 30, rotulo: "30 dias" },
  { dias: 90, rotulo: "90 dias" },
  { dias: 180, rotulo: "6 meses" },
  { dias: 365, rotulo: "1 ano" },
];

/** Chaves da API REST: criadas pelo administrador; a chave aparece uma vez e o banco guarda só o hash. */
export default async function ChavesPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  const admin = papel === "admin";
  const { data } = await supabase
    .from("api_chaves")
    .select("id, nome, prefixo, escopos, limite_hora, created_at, expira_em, revogada_em, ultimo_uso")
    .order("created_at", { ascending: false })
    .limit(200);
  const chaves = (data ?? []) as ChaveApi[];
  const agora = new Date(agoraMs()).toISOString();

  return (
    <>
      <Cabecalho
        titulo="Chaves de API"
        trilha="Integrações"
        descricao="Cada sistema que vai ler seus dados (n8n, site próprio, BI, outro ERP) recebe a sua chave, só com as permissões que precisa. Revogue quando não usar mais."
        acoes={
          admin ? (
            <JanelaSegredo
              rotuloBotao={
                <>
                  <Plus className="size-4" /> Nova chave
                </>
              }
              titulo="Nova chave de API"
              acao={criarChave}
              rotuloSalvar="Criar chave"
              explicacao={
                <>
                  <strong>Copie a chave agora.</strong> Por segurança ela não aparece de novo: o sistema guarda só uma “impressão digital” dela. Se perder, revogue e crie outra.
                </>
              }
            >
              <Campo rotulo="Nome (para você saber onde está em uso)">
                <Entrada name="nome" required maxLength={80} placeholder="Ex.: n8n, site, planilha do contador" />
              </Campo>
              <fieldset className="space-y-2">
                <legend className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Permissões</legend>
                {escoposDoModo(organizacao.modo).map((e) => (
                  <label key={e.id} className="flex items-center gap-2 text-sm text-texto-2">
                    <input type="checkbox" name="escopos" value={e.id} className="size-4" /> {e.rotulo}
                  </label>
                ))}
              </fieldset>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Campo rotulo="Validade">
                  <Selecao name="validade_dias" defaultValue="0">
                    {VALIDADES.map((v) => (
                      <option key={v.dias} value={v.dias}>
                        {v.rotulo}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Limite por hora" dica="Chamadas por hora desta chave (até 5.000).">
                  <Entrada name="limite_hora" type="number" min={1} max={5000} defaultValue={LIMITE_HORA_CHAVE} />
                </Campo>
              </div>
            </JanelaSegredo>
          ) : undefined
        }
      />
      <AbasIntegracoes />
      <div className="mb-5">
        <Aviso>
          Use no cabeçalho <code className="font-mono text-[12.5px]">Authorization: Bearer &lt;chave&gt;</code>. Exemplos e a lista do que dá para consultar em{" "}
          <Link href="/integracoes/api" className="text-acento hover:underline">
            Documentação da API
          </Link>
          . O uso de cada chave aparece em{" "}
          <Link href="/integracoes/monitoramento" className="text-acento hover:underline">
            Monitoramento
          </Link>
          .
        </Aviso>
      </div>
      <Tabela colunas={["Nome", "Chave", "Permissões", "Situação", "Último uso", "Validade", ""]}>
        {chaves.length === 0 ? (
          <LinhaVazia colunas={7}>
            <KeyRound className="mx-auto mb-2 size-5" />
            Nenhuma chave ainda.
          </LinhaVazia>
        ) : (
          chaves.map((c) => {
            const st = situacaoChave(c, agora);
            return (
              <tr key={c.id}>
                <Celula className="font-semibold">{c.nome}</Celula>
                <Celula className="font-mono text-[12.5px] text-texto-2">{c.prefixo}_••••</Celula>
                <Celula className="text-[12.5px] text-texto-2">{c.escopos.map((e) => ROTULO_ESCOPO[e] ?? e).join(" · ")}</Celula>
                <Celula>
                  <Selo cor={COR_SITUACAO_CHAVE[st]}>{ROTULO_SITUACAO_CHAVE[st]}</Selo>
                </Celula>
                <Celula className="whitespace-nowrap text-texto-2">{quando(c.ultimo_uso)}</Celula>
                <Celula className="whitespace-nowrap text-texto-2">{c.expira_em ? quando(c.expira_em) : "sem data"}</Celula>
                <Celula>
                  {admin && (
                    <div className="flex items-center justify-end gap-2">
                      {st === "ativa" && (
                        <BotaoAcao acao={revogarChave} id={c.id} tamanho="sm" confirmar={`Revogar a chave "${c.nome}"? Quem usa esta chave para de acessar na hora.`}>
                          Revogar
                        </BotaoAcao>
                      )}
                      <BotaoExcluir acao={excluirChave} id={c.id} confirmar={`Excluir a chave "${c.nome}"? O registro de uso continua no Monitoramento.`} />
                    </div>
                  )}
                </Celula>
              </tr>
            );
          })
        )}
      </Tabela>
    </>
  );
}
