import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import {
  DIAS_SEMANA,
  DICA_XLS_CURTA,
  FORMATOS,
  FREQUENCIAS,
  PERIODOS_AGENDADOS,
  RELATORIOS_PADRAO,
  ROTULO_FORMATO,
  ROTULO_FREQUENCIA,
  ROTULO_PERIODO_AGENDADO,
  padroesDoModo,
} from "@/lib/dominio/bi";
import type { Agendamento } from "../dados";

/** Campos do envio programado (mesmos na criação e na edição). */
export function CamposAgendamento({ ag, salvos, imob }: { ag?: Agendamento | null; salvos: { id: string; nome: string }[]; imob: boolean }) {
  const relatorio = ag ? (ag.relatorio_id ? `salvo:${ag.relatorio_id}` : `padrao:${ag.padrao}`) : "padrao:financeiro_mensal";
  const destinatarios = ag ? [...ag.emails, ...ag.whatsapps].join(", ") : "";
  return (
    <>
      <Campo rotulo="Nome do envio">
        <Entrada name="nome" required maxLength={120} defaultValue={ag?.nome ?? ""} placeholder="Ex.: Fechamento do mês para o sócio" />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Relatório">
          <Selecao name="relatorio" defaultValue={relatorio}>
            <optgroup label="Relatórios prontos">
              {padroesDoModo(imob).map((p) => (
                <option key={p} value={`padrao:${p}`}>
                  {RELATORIOS_PADRAO[p].rotulo}
                </option>
              ))}
            </optgroup>
            {salvos.length > 0 && (
              <optgroup label="Personalizados">
                {salvos.map((s) => (
                  <option key={s.id} value={`salvo:${s.id}`}>
                    {s.nome}
                  </option>
                ))}
              </optgroup>
            )}
          </Selecao>
        </Campo>
        <Campo rotulo="Período (relatórios prontos)" dica="Os personalizados seguem os filtros deles.">
          <Selecao name="periodo" defaultValue={ag?.periodo ?? "mes_anterior"}>
            {PERIODOS_AGENDADOS.map((p) => (
              <option key={p} value={p}>
                {ROTULO_PERIODO_AGENDADO[p]}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <Campo rotulo="Frequência">
          <Selecao name="frequencia" defaultValue={ag?.frequencia ?? "mensal"}>
            {FREQUENCIAS.map((f) => (
              <option key={f} value={f}>
                {ROTULO_FREQUENCIA[f]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Dia da semana" dica="Para “toda semana”.">
          <Selecao name="dia_semana" defaultValue={String(ag?.dia_semana ?? 1)}>
            {DIAS_SEMANA.map((d, i) => (
              <option key={d} value={i}>
                {d}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Dia do mês" dica="Para “todo mês” (1 a 28).">
          <Selecao name="dia_mes" defaultValue={String(ag?.dia_mes ?? 1)}>
            {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
              <option key={d} value={d}>
                dia {d}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Hora (Brasília)">
          <Selecao name="hora" defaultValue={String(ag?.hora ?? 8)}>
            {Array.from({ length: 24 }, (_, i) => i).map((h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_2fr]">
        <Campo rotulo="Formato do arquivo" dica={DICA_XLS_CURTA}>
          <Selecao name="formato" defaultValue={ag?.formato ?? "csv"}>
            {FORMATOS.map((f) => (
              <option key={f} value={f}>
                {ROTULO_FORMATO[f]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Para quem" dica="E-mails e WhatsApps (com DDD), separados por vírgula.">
          <AreaTexto name="destinatarios" rows={2} defaultValue={destinatarios} placeholder="socio@email.com, (51) 99999-0000" />
        </Campo>
      </div>
      <label className="flex items-center gap-2 text-sm text-texto">
        <input type="hidden" name="ativo" value="off" />
        <input type="checkbox" name="ativo" defaultChecked={ag?.ativo ?? true} className="size-4 accent-[var(--accent)]" />
        Envio ligado
      </label>
    </>
  );
}
