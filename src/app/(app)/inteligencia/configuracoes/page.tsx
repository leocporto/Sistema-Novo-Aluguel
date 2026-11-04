import type { Metadata } from "next";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Definicao, Entrada, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { CAMPOS_QUALIFICACAO, NOMES_DIAS_SEMANA, PERGUNTAS_PADRAO, ROTULO_CAMPO_QUALIFICACAO, ROTULO_RECURSO, recursosDoModo, textoHorario } from "@/lib/dominio/ia";
import { pode } from "@/lib/permissoes";
import { AbasInteligencia } from "../abas";
import { salvarConfigIA } from "../actions";
import { estadoIA, exigirOuVoltar, podeConfigurarIA } from "../dados";

export const metadata: Metadata = { title: "Configurações da IA" };

const caixa = "size-4 accent-[var(--accent)]";

/** Configurações da IA (nos dois modos): ligar/desligar, recursos, limites, horário, fora do horário e aprovação humana. */
export default async function ConfiguracoesIAPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  await exigirOuVoltar("configuracoes", "ver");
  const pessoal = organizacao.modo === "pessoal";
  const ia = await estadoIA(supabase);
  const cfg = ia.config;
  const podeMudar = podeConfigurarIA(papel) && (await pode("configuracoes", "editar"));
  const admin = papel === "admin";
  const hoje = hojeISO();
  const { data: uso } = await supabase.rpc("ia_uso_resumo", { p_de: hoje, p_ate: hoje });
  const u = (uso ?? {}) as { chamadas?: number };
  const recursos = recursosDoModo(organizacao.modo);
  const pergunta = (campo: string) => cfg.perguntas.find((p) => p.campo === campo) ?? PERGUNTAS_PADRAO.find((p) => p.campo === campo)!;

  return (
    <>
      <Cabecalho
        titulo="Configurações da IA"
        trilha="Assistente e automações"
        descricao="A IA é um serviço externo (Anthropic). Ela só recebe o mínimo necessário, sem CPF, RG, conta bancária, e-mail ou telefone, e nunca dados de outra conta. Tudo fica registrado no Histórico."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <Cartao titulo="Situação">
          <Definicao
            itens={[
              [
                "Chave da IA no servidor",
                ia.configurada ? <Selo cor="verde">Configurada</Selo> : <Selo cor="amarelo">IA não configurada (peça ao administrador para cadastrar a chave)</Selo>,
              ],
              ["IA nesta conta", cfg.ativa ? <Selo cor="verde">Ligada</Selo> : <Selo cor="cinza">Desligada (só regras)</Selo>],
              // ia_uso_resumo segue a regra do Histórico: administrador e gestor contam a conta toda; os demais, só os próprios usos.
              podeConfigurarIA(papel)
                ? ["Usos hoje (conta)", `${Number(u.chamadas ?? 0)} de ${cfg.limite_dia_org} · limite de ${cfg.limite_dia_usuario} por pessoa`]
                : ["Seus usos hoje", `${Number(u.chamadas ?? 0)} de ${cfg.limite_dia_usuario} · a conta toda pode usar ${cfg.limite_dia_org} por dia`],
            ]}
          />
          {!ia.configurada && (
            <p className="mt-3 text-xs text-mudo">
              Para ligar: na Vercel, cadastre as variáveis ANTHROPIC_API_KEY (a chave) e ANTHROPIC_MODEL (o modelo escolhido) e publique de novo. Sem elas, tudo que funciona por regra continua
              funcionando.
            </p>
          )}
        </Cartao>

        {!podeMudar ? (
          <Cartao titulo="Como está">
            <Definicao
              itens={[
                ["Recursos ligados", cfg.recursos.filter((r) => recursos.includes(r)).map((r) => ROTULO_RECURSO[r]).join(", ") || "nenhum"],
                ["Exigir aprovação humana", cfg.exigir_aprovacao ? "Sim" : "Não"],
                ["Horário comercial", `${textoHorario(cfg)} · ${cfg.dias_uteis.map((d) => NOMES_DIAS_SEMANA[d]).join(", ")}`],
              ]}
            />
            <div className="mt-4">
              <Aviso>Só o administrador ou o gestor mudam estas configurações.</Aviso>
            </div>
          </Cartao>
        ) : (
          <Formulario acao={salvarConfigIA} automatico>
            <Cartao titulo="Ligar e escolher os recursos">
              <div className="space-y-4">
                <label className="flex items-center gap-2 text-sm font-semibold text-texto">
                  <input type="hidden" name="ativa" value="off" />
                  <input type="checkbox" name="ativa" defaultChecked={cfg.ativa} className={caixa} /> Usar IA nesta conta
                </label>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {recursos.map((r) => (
                    <label key={r} className="flex items-center gap-2 text-sm text-texto">
                      <input type="checkbox" name="recursos" value={r} defaultChecked={cfg.recursos.includes(r)} className={caixa} /> {ROTULO_RECURSO[r]}
                    </label>
                  ))}
                  {/* Recursos que não existem neste modo continuam guardados como estão. */}
                  {cfg.recursos
                    .filter((r) => !recursos.includes(r))
                    .map((r) => (
                      <input key={r} type="hidden" name="recursos" value={r} />
                    ))}
                </div>
                <label className="flex items-center gap-2 text-sm text-texto">
                  <input type="hidden" name="exigir_aprovacao" value="off" />
                  <input type="checkbox" name="exigir_aprovacao" defaultChecked={cfg.exigir_aprovacao} className={caixa} /> Exigir aprovação de outra pessoa (administrador, gestor ou quem aprova no
                  módulo) para as ações críticas
                </label>
                <p className="text-xs text-mudo">
                  Mesmo desligado, nada crítico roda sozinho: quem pediu precisa confirmar com um clique. Ligado (recomendado), a confirmação tem que ser de outra pessoa.
                </p>
              </div>
            </Cartao>
            <Cartao titulo="Limites e custo">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <Campo rotulo="Usos por dia (conta)">
                  <Entrada name="limite_dia_org" type="number" min={1} max={10000} defaultValue={cfg.limite_dia_org} />
                </Campo>
                <Campo rotulo="Usos por dia (pessoa)">
                  <Entrada name="limite_dia_usuario" type="number" min={1} max={5000} defaultValue={cfg.limite_dia_usuario} />
                </Campo>
                <Campo rotulo="US$ por milhão (entrada)" dica="Só para o custo estimado.">
                  <Entrada name="preco_entrada_mtok" inputMode="decimal" defaultValue={String(cfg.preco_entrada_mtok)} />
                </Campo>
                <Campo rotulo="US$ por milhão (saída)">
                  <Entrada name="preco_saida_mtok" inputMode="decimal" defaultValue={String(cfg.preco_saida_mtok)} />
                </Campo>
              </div>
              <p className="mt-3 text-xs text-mudo">O limite é conferido no banco antes de cada chamada (duas abas ao mesmo tempo não passam do limite). Conta o dia de Brasília.</p>
            </Cartao>
            <Cartao titulo="Horário comercial">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Campo rotulo="Abre às">
                  <Entrada name="horario_inicio" type="time" defaultValue={cfg.horario_inicio} />
                </Campo>
                <Campo rotulo="Fecha às">
                  <Entrada name="horario_fim" type="time" defaultValue={cfg.horario_fim} />
                </Campo>
              </div>
              <div className="mt-3 flex flex-wrap gap-4">
                {[1, 2, 3, 4, 5, 6, 7].map((d) => (
                  <label key={d} className="flex items-center gap-2 text-sm text-texto">
                    <input type="checkbox" name="dias_uteis" value={d} defaultChecked={cfg.dias_uteis.includes(d)} className={caixa} /> {NOMES_DIAS_SEMANA[d]}
                  </label>
                ))}
              </div>
            </Cartao>
            {!pessoal && (
              <Cartao titulo="Atendimento fora do horário e qualificação de leads">
                <div className="space-y-4">
                  <label className="flex items-center gap-2 text-sm text-texto">
                    <input type="hidden" name="fora_horario_ativo" value="off" />
                    <input type="checkbox" name="fora_horario_ativo" defaultChecked={cfg.fora_horario_ativo} className={caixa} /> Preparar resposta automática para mensagens que chegam fora do
                    horário
                  </label>
                  <Campo rotulo="Mensagem fora do horário" dica="Texto fixo (não é escrito pela IA). Pode usar {{nome}} e {{horario}}.">
                    <AreaTexto name="mensagem_fora_horario" rows={3} maxLength={1000} defaultValue={cfg.mensagem_fora_horario} />
                  </Campo>
                  {admin ? (
                    <label className="flex items-start gap-2 text-sm text-texto">
                      <input type="hidden" name="fora_horario_envio_auto" value="off" />
                      <input type="checkbox" name="fora_horario_envio_auto" defaultChecked={cfg.fora_horario_envio_auto} className={`${caixa} mt-0.5`} />
                      <span>
                        Aprovo este texto para as respostas fora do horário não precisarem de aprovação, uma por uma (só administrador). O envio continua pelo botão “Abrir WhatsApp”: o
                        sistema ainda não envia mensagens sozinho (isso depende de uma integração de envio que ainda não existe). Se outra pessoa mudar o texto, isto desliga sozinho.
                      </span>
                    </label>
                  ) : (
                    <p className="text-xs text-mudo">Envio sem aprovação: {cfg.fora_horario_envio_auto ? "ligado pelo administrador" : "desligado"} (só o administrador muda).</p>
                  )}
                  <div>
                    <div className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Perguntas de qualificação</div>
                    <div className="space-y-2">
                      {CAMPOS_QUALIFICACAO.map((c) => {
                        const p = pergunta(c);
                        return (
                          <div key={c} className="grid grid-cols-1 items-center gap-2 sm:grid-cols-[220px_1fr]">
                            <label className="flex items-center gap-2 text-sm text-texto">
                              <input type="hidden" name={`pergunta_ativa_${c}`} value="off" />
                              <input type="checkbox" name={`pergunta_ativa_${c}`} defaultChecked={p.ativa} className={caixa} /> {ROTULO_CAMPO_QUALIFICACAO[c]}
                            </label>
                            <Entrada name={`pergunta_${c}`} maxLength={300} defaultValue={p.texto} aria-label={`Pergunta: ${ROTULO_CAMPO_QUALIFICACAO[c]}`} />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </Cartao>
            )}
            {pessoal && (
              <>
                <input type="hidden" name="fora_horario_ativo" value={cfg.fora_horario_ativo ? "on" : "off"} />
                <input type="hidden" name="mensagem_fora_horario" value={cfg.mensagem_fora_horario} />
                {admin && <input type="hidden" name="fora_horario_envio_auto" value={cfg.fora_horario_envio_auto ? "on" : "off"} />}
                {cfg.perguntas.map((p) => (
                  <span key={p.campo}>
                    <input type="hidden" name={`pergunta_ativa_${p.campo}`} value={p.ativa ? "on" : "off"} />
                    <input type="hidden" name={`pergunta_${p.campo}`} value={p.texto} />
                  </span>
                ))}
              </>
            )}
          </Formulario>
        )}
      </div>
    </>
  );
}
