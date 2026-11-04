"use client";

import { useState } from "react";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import {
  CONDICOES_POR_GATILHO,
  DICA_DIAS_GATILHO,
  GATILHOS_IA_IMOB,
  ORIGENS_LEAD,
  ROTULO_ACAO_REGRA,
  ROTULO_GATILHO_IA,
  TITULO_PADRAO_GATILHO,
  acoesRegraDoModo,
  gatilhosDoModo,
  type AcaoRegra,
  type GatilhoIA,
} from "@/lib/dominio/ia";
import { ROTULO_ORIGEM_LEAD } from "@/lib/tipos";

export type RegraInicial = {
  nome?: string;
  gatilho?: GatilhoIA;
  dias?: number;
  acao?: AcaoRegra;
  repetir_dias?: number;
  condicoes?: Record<string, unknown>;
  acao_config?: Record<string, unknown>;
};

/** Campos da automação: só aparecem as condições e opções que valem para o gatilho e a ação escolhidos. */
export function CamposRegra({ modo, inicial = {} }: { modo: string; inicial?: RegraInicial }) {
  const gatilhos = gatilhosDoModo(modo);
  const [gatilho, setGatilho] = useState<GatilhoIA>(inicial.gatilho ?? gatilhos[0]);
  // No pessoal não há tarefa (só aparece no Comercial): o padrão é avisar o responsável.
  const padrao: AcaoRegra = modo === "pessoal" ? "avisar_responsavel" : "criar_tarefa";
  const [acao, setAcao] = useState<AcaoRegra>(inicial.acao ?? padrao);
  const cond = inicial.condicoes ?? {};
  const cfg = inicial.acao_config ?? {};
  const permitidas = CONDICOES_POR_GATILHO[gatilho] as readonly string[];
  const acoes = acoesRegraDoModo(modo).filter((a) => a !== "marcar_prioridade" || GATILHOS_IA_IMOB.includes(gatilho));
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return (
    <div className="space-y-4">
      <Campo rotulo="Nome">
        <Entrada name="nome" required maxLength={80} defaultValue={inicial.nome ?? ""} placeholder="Ex.: Cobrar aluguel atrasado" />
      </Campo>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo rotulo="Quando (gatilho)">
          <Selecao name="gatilho" value={gatilho} onChange={(e) => setGatilho(e.target.value as GatilhoIA)}>
            {gatilhos.map((g) => (
              <option key={g} value={g}>
                {ROTULO_GATILHO_IA[g]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="N dias" dica={DICA_DIAS_GATILHO[gatilho]}>
          <Entrada name="dias" type="number" min={0} max={365} defaultValue={inicial.dias ?? 3} />
        </Campo>
      </div>
      {permitidas.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {permitidas.includes("funil") && (
            <Campo rotulo="Só do funil">
              <Selecao name="cond_funil" defaultValue={s(cond.funil)}>
                <option value="">Qualquer</option>
                <option value="locacao">Locação</option>
                <option value="venda">Venda</option>
                <option value="captacao">Captação</option>
              </Selecao>
            </Campo>
          )}
          {permitidas.includes("origem") && (
            <Campo rotulo="Só da origem">
              <Selecao name="cond_origem" defaultValue={s(cond.origem)}>
                <option value="">Qualquer</option>
                {ORIGENS_LEAD.map((o) => (
                  <option key={o} value={o}>
                    {ROTULO_ORIGEM_LEAD[o] ?? o}
                  </option>
                ))}
              </Selecao>
            </Campo>
          )}
          {permitidas.includes("prioridade") && (
            <Campo rotulo="Só com a prioridade">
              <Selecao name="cond_prioridade" defaultValue={s(cond.prioridade)}>
                <option value="">Qualquer</option>
                <option value="quente">Alta</option>
                <option value="morno">Média</option>
                <option value="frio">Baixa</option>
              </Selecao>
            </Campo>
          )}
          {permitidas.includes("sem_corretor") && (
            <label className="flex items-center gap-2 self-end pb-3 text-sm text-texto">
              <input type="hidden" name="cond_sem_corretor" value="off" />
              <input type="checkbox" name="cond_sem_corretor" defaultChecked={cond.sem_corretor === true} className="size-4 accent-[var(--accent)]" /> Só leads sem corretor
            </label>
          )}
          {permitidas.includes("valor_min") && (
            <Campo rotulo="Só a partir do valor (R$)">
              <Entrada name="cond_valor_min" inputMode="decimal" defaultValue={s(cond.valor_min)} />
            </Campo>
          )}
          {permitidas.includes("urgencia") && (
            <Campo rotulo="Só com a urgência">
              <Selecao name="cond_urgencia" defaultValue={s(cond.urgencia)}>
                <option value="">Qualquer</option>
                <option value="baixa">Baixa</option>
                <option value="media">Média</option>
                <option value="alta">Alta</option>
                <option value="emergencia">Emergência</option>
              </Selecao>
            </Campo>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo rotulo="Fazer (ação)">
          <Selecao name="acao" value={acoes.includes(acao) ? acao : padrao} onChange={(e) => setAcao(e.target.value as AcaoRegra)}>
            {acoes.map((a) => (
              <option key={a} value={a}>
                {ROTULO_ACAO_REGRA[a]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Repetir a cada (dias)" dica="0 = uma vez só por item. Ex.: 7 = lembra de novo toda semana enquanto continuar valendo.">
          <Entrada name="repetir_dias" type="number" min={0} max={365} defaultValue={inicial.repetir_dias ?? 0} />
        </Campo>
      </div>
      {(acao === "criar_tarefa" || acao === "avisar_responsavel") && (
        <Campo rotulo="Título" dica={`Pode usar {{nome}}, {{imovel}}, {{valor}} e {{data}}. Em branco: “${TITULO_PADRAO_GATILHO[gatilho]}”.`}>
          <Entrada name="cfg_titulo" maxLength={120} defaultValue={s(cfg.titulo)} />
        </Campo>
      )}
      {acao === "criar_tarefa" && (
        <Campo rotulo="Prioridade da tarefa">
          <Selecao name="cfg_prioridade_tarefa" defaultValue={s(cfg.prioridade) || "normal"}>
            <option value="normal">Normal</option>
            <option value="alta">Alta</option>
          </Selecao>
        </Campo>
      )}
      {acao === "sugerir_mensagem" && (
        <>
          <Campo rotulo="Canal">
            <Selecao name="cfg_canal" defaultValue={s(cfg.canal) || "whatsapp"}>
              <option value="whatsapp">WhatsApp</option>
              <option value="email">E-mail</option>
              <option value="sms">SMS</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Mensagem" dica="Pode usar {{nome}} (primeiro nome), {{imovel}}, {{valor}} e {{data}}. Cada mensagem vai para “Ações para aprovar” antes de sair.">
            <AreaTexto name="cfg_mensagem" rows={4} maxLength={1000} required defaultValue={s(cfg.mensagem)} />
          </Campo>
        </>
      )}
      {acao === "marcar_prioridade" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Campo rotulo="Marcar como">
            <Selecao name="cfg_prioridade_lead" defaultValue={s(cfg.prioridade)}>
              <option value="">Não mudar</option>
              <option value="quente">Alta</option>
              <option value="morno">Média</option>
              <option value="frio">Baixa</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Etiqueta">
            <Entrada name="cfg_etiqueta" maxLength={40} defaultValue={s(cfg.etiqueta)} placeholder="Ex.: esfriando" />
          </Campo>
        </div>
      )}
    </div>
  );
}
