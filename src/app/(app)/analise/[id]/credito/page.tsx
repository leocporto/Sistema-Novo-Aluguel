import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FileSearch, ShieldCheck, Zap } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { BASES_LEGAIS, ORIGENS_CONSENTIMENTO, ROTULO_BASE_LEGAL, ROTULO_BUREAU, ultimaConsulta } from "@/lib/dominio/analise";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { situacaoIntegracaoCredito } from "@/lib/servicos/credito";
import { consultarCreditoAutomatico, excluirConsulta, registrarConsentimento, registrarConsulta, retirarConsentimento } from "../../actions";
import { CamposConsulta } from "../../campos";
import { carregarAnalise, carregarConfig, nomesEquipe, quando } from "../../dados";

export const metadata: Metadata = { title: "Crédito do candidato" };

function Autorizacao({ chave, nome, em, origem }: { chave: string; nome: string; em: string | null; origem: string | null }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className="min-w-0">
        <div className="text-sm font-medium text-texto">{nome}</div>
        <div className="text-xs text-mudo">{em ? `Autorizou em ${quando(em)} · ${origem ?? "sem origem"}` : "Sem autorização registrada"}</div>
      </div>
      {em ? (
        <span className="flex items-center gap-2">
          <Selo cor="verde">autorizado</Selo>
          <BotaoAcao acao={retirarConsentimento} id={chave} tamanho="sm" variante="fantasma" confirmar="Registrar que a autorização foi retirada? Novas consultas por consentimento ficam bloqueadas.">
            retirar
          </BotaoAcao>
        </span>
      ) : (
        <JanelaCadastro rotuloBotao="Registrar autorização" tamanho="sm" variante="secundario" titulo={`Autorização de ${nome}`} acao={registrarConsentimento} rotuloSalvar="Registrar" icone={<ShieldCheck />}>
          <input type="hidden" name="alvo" value={chave} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Como autorizou">
              <Selecao name="origem" defaultValue="assinatura">
                {ORIGENS_CONSENTIMENTO.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Quando">
              <Entrada type="date" name="data" defaultValue={hojeISO()} max={hojeISO()} />
            </Campo>
          </div>
          <p className="text-xs text-mudo">Guarde o documento da autorização (ficha assinada, e-mail, print) na aba Documentos.</p>
        </JanelaCadastro>
      )}
    </li>
  );
}

export default async function CreditoAnalise({ params }: PageProps<"/analise/[id]/credito">) {
  const { id } = await params;
  const { supabase, usuario, organizacao } = await obterContexto();
  const [c, cfg, nome] = await Promise.all([carregarAnalise(supabase, id), carregarConfig(supabase, organizacao.id), nomesEquipe(supabase, usuario.id)]);
  if (!c) notFound();
  const { analise: a, consultas, fiadores } = c;
  const nomeDe = (fiadorId: string | null) => (fiadorId ? (fiadores.find((f) => f.id === fiadorId)?.pessoa?.nome ?? "Fiador") : (a.candidato?.nome ?? "Candidato"));
  const valeAgora = ultimaConsulta(consultas);
  const integracao = situacaoIntegracaoCredito();
  const ligados = integracao.filter((b) => b.ligado);

  return (
    <div className="space-y-6">
      {ligados.length === 0 ? (
        <Aviso>
          <b>Consulta automática ao birô:</b> a estrutura está pronta para ligar quando houver contrato com Serasa, SPC, Boa Vista ou Quod (contrato e
          credenciais próprios com o birô). Por enquanto, faça a consulta no site do birô e registre aqui o resultado — com a base legal da LGPD.
        </Aviso>
      ) : (
        <Aviso>
          <b>Consulta automática ligada:</b> {ligados.map((l) => l.nome).join(", ")}. O resultado entra direto na lista, com a base legal da LGPD e quem consultou.
        </Aviso>
      )}

      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm text-texto-2">
              {valeAgora ? (
                <>
                  Vale a consulta mais recente do candidato: <b className="text-texto">{ROTULO_BUREAU[valeAgora.bureau]}</b> em {formatarDataBR(valeAgora.consultado_em)}
                  {valeAgora.score !== null ? ` · score ${valeAgora.score}` : ""} · {valeAgora.restricoes ? "com restrições" : "sem restrições"}
                </>
              ) : (
                "Nenhuma consulta do candidato registrada."
              )}
              {cfg.score_minimo !== null && <span className="block text-xs text-mudo">Score mínimo da casa: {cfg.score_minimo}</span>}
            </div>
            <div className="flex flex-wrap gap-2">
              {ligados.length > 0 && (
                <JanelaCadastro rotuloBotao={<><Zap className="size-4" /> Consultar agora</>} variante="secundario" titulo="Consulta automática ao birô" acao={consultarCreditoAutomatico} rotuloSalvar="Consultar" icone={<Zap />}>
                  <input type="hidden" name="analise_id" value={id} />
                  <Campo rotulo="Quem">
                    <Selecao name="fiador_id" defaultValue="">
                      <option value="">Candidato — {a.candidato?.nome ?? ""}</option>
                      {fiadores.map((f) => (
                        <option key={f.id} value={f.id}>
                          Fiador — {f.pessoa?.nome ?? ""}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Birô">
                    <Selecao name="bureau" defaultValue={ligados.some((l) => l.bureau === cfg.bureau_padrao) ? (cfg.bureau_padrao ?? "") : ligados[0].bureau}>
                      {ligados.map((l) => (
                        <option key={l.bureau} value={l.bureau}>
                          {l.nome}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Base legal (LGPD)">
                    <Selecao name="base_legal" required defaultValue="">
                      <option value="" disabled>
                        Escolha…
                      </option>
                      {BASES_LEGAIS.map((b) => (
                        <option key={b} value={b}>
                          {ROTULO_BASE_LEGAL[b]}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <p className="text-xs text-mudo">Cada consulta pode ser cobrada pelo birô. Pelo consentimento, só com a autorização registrada ao lado.</p>
                </JanelaCadastro>
              )}
              <JanelaCadastro rotuloBotao={<><FileSearch className="size-4" /> Registrar consulta</>} titulo="Registrar consulta de crédito" acao={registrarConsulta} rotuloSalvar="Registrar" larguraMax="max-w-2xl" icone={<FileSearch />}>
                <input type="hidden" name="analise_id" value={id} />
                <CamposConsulta
                  bureauPadrao={cfg.bureau_padrao}
                  alvos={[{ valor: "", rotulo: `Candidato — ${a.candidato?.nome ?? ""}` }, ...fiadores.map((f) => ({ valor: f.id, rotulo: `Fiador — ${f.pessoa?.nome ?? ""}` }))]}
                />
              </JanelaCadastro>
            </div>
          </div>
          <Tabela colunas={["Data", "Quem", "Birô", "Score", "Restrições", "Base legal", "Registrado por", ""]}>
            {consultas.map((q) => (
              <tr key={q.id} className="align-top">
                <Celula>{formatarDataBR(q.consultado_em)}</Celula>
                <Celula>
                  <span className="font-medium text-texto">{nomeDe(q.fiador_id)}</span>
                  <span className="block text-xs text-mudo">
                    {q.fiador_id ? "fiador" : "candidato"}
                    {q.documento_consultado ? ` · ${formatarDocumento(q.documento_consultado)}` : ""}
                  </span>
                </Celula>
                <Celula>
                  {q.bureau === "outro" ? (q.bureau_nome ?? "Outro") : ROTULO_BUREAU[q.bureau]}
                  {q.protocolo && <span className="block text-xs text-mudo">protocolo {q.protocolo}</span>}
                  {q.origem === "integracao" && <span className="block text-xs text-acento">automática</span>}
                </Celula>
                <Celula className="tabular-nums">
                  {q.score ?? "—"}
                  {q.faixa_risco && <span className="block text-xs text-mudo">{q.faixa_risco}</span>}
                </Celula>
                <Celula>
                  {q.restricoes ? (
                    <>
                      <Selo cor="vermelho">{q.restricoes_qtd ? `${q.restricoes_qtd} restrição(ões)` : "tem"}</Selo>
                      {q.restricoes_valor !== null && <span className="block text-xs text-mudo">{formatarReais(q.restricoes_valor)}</span>}
                      {q.restricoes_descricao && <span className="block max-w-56 text-xs text-texto-2">{q.restricoes_descricao}</span>}
                    </>
                  ) : (
                    <Selo cor="verde">nada consta</Selo>
                  )}
                </Celula>
                <Celula>
                  <span className="text-xs text-texto-2">{ROTULO_BASE_LEGAL[q.base_legal]}</span>
                  {q.consentimento_em && <span className="block text-xs text-mudo">autorização de {formatarDataBR(q.consentimento_em.slice(0, 10))}</span>}
                </Celula>
                <Celula>
                  <span className="text-xs text-texto-2">{nome(q.consultado_por)}</span>
                  <span className="block text-xs text-mudo">{quando(q.created_at)}</span>
                </Celula>
                <Celula>
                  <BotaoExcluir acao={excluirConsulta} id={q.id} rotulo="Excluir consulta" confirmar="Excluir este registro de consulta? A exclusão fica na auditoria." />
                </Celula>
              </tr>
            ))}
            {consultas.length === 0 && <LinhaVazia colunas={8}>Nenhuma consulta registrada.</LinhaVazia>}
          </Tabela>
          <p className="text-xs text-mudo">Consulta registrada não se altera (é prova da análise). Se errou, exclua e registre de novo — tudo fica na auditoria.</p>
        </div>

        <div className="space-y-6">
          <Cartao titulo="Autorização para consultar (LGPD)">
            <ul className="divide-y divide-borda-suave">
              <Autorizacao chave={`analise:${id}`} nome={a.candidato?.nome ?? "Candidato"} em={a.consentimento_em} origem={a.consentimento_origem} />
              {fiadores.map((f) => (
                <Autorizacao key={f.id} chave={`fiador:${f.id}`} nome={`${f.pessoa?.nome ?? "Fiador"} (fiador)`} em={f.consentimento_em} origem={f.consentimento_origem} />
              ))}
            </ul>
            {a.consentimento_texto && (
              <details className="mt-3 text-xs text-texto-2">
                <summary className="cursor-pointer text-acento">Texto que o candidato aceitou na ficha online</summary>
                <p className="mt-2">{a.consentimento_texto}</p>
                {a.consentimento_ip && <p className="mt-1 text-mudo">IP informado pelo site: {a.consentimento_ip}</p>}
                {a.consentimento_ip_rede && <p className="mt-1 text-mudo">Conexão que chegou ao sistema: {a.consentimento_ip_rede}</p>}
              </details>
            )}
          </Cartao>
          <Cartao titulo="Integração com birôs">
            <ul className="space-y-2 text-sm">
              {integracao.map((b) => (
                <li key={b.bureau} className="flex items-center justify-between gap-2">
                  <span className="text-texto">{b.nome}</span>
                  <Selo cor={b.ligado ? "verde" : "cinza"}>{b.ligado ? "ligado" : "não ligado"}</Selo>
                </li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-mudo">
              Para ligar um birô é preciso contratar o serviço de consulta dele e cadastrar as credenciais no servidor. Até lá, consulte no site do birô e registre o resultado.
            </p>
          </Cartao>
          <Cartao titulo="Base legal: qual usar">
            <ul className="space-y-2 text-sm text-texto-2">
              <li>
                <b className="text-texto">Consentimento (art. 7º, I):</b> o candidato autoriza por escrito. Só vale com a autorização registrada; se ele retirar, novas
                consultas por esse motivo ficam bloqueadas.
              </li>
              <li>
                <b className="text-texto">Proteção do crédito (art. 7º, X):</b> permitida para avaliar o risco desta locação que o candidato pediu. Use só para isso e avise
                o candidato.
              </li>
              <li>Os dados ficam só com a equipe da organização e cada consulta registra quem fez e quando.</li>
            </ul>
          </Cartao>
        </div>
      </div>
    </div>
  );
}
