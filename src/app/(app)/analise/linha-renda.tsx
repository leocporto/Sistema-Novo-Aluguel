import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { Campo, Entrada, Selecao, Selo } from "@/components/ui";
import { ROTULO_TIPO_RENDA, TIPOS_RENDA } from "@/lib/dominio/analise";
import { atualizarRenda, excluirRenda } from "./actions";
import { quando, type Renda } from "./dados";

/** Linha editável de uma fonte de renda (salva sozinha). */
export function LinhaRenda({ r, nome }: { r: Renda; nome: (id: string | null) => string }) {
  const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));
  return (
    <li className="rounded-[14px] border border-borda p-4">
      <Formulario acao={atualizarRenda} automatico semAviso className="space-y-3">
        <input type="hidden" name="id" value={r.id} />
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Campo rotulo="Tipo">
            <Selecao name="tipo" defaultValue={r.tipo}>
              {TIPOS_RENDA.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_RENDA[t]}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Fonte / pagador">
            <Entrada name="fonte" defaultValue={r.fonte ?? ""} />
          </Campo>
          {!r.fiador_id && (
            <Campo rotulo="De quem (se não for o candidato)">
              <Entrada name="titular" defaultValue={r.titular ?? ""} placeholder="Ex.: cônjuge — Maria" />
            </Campo>
          )}
          <Campo rotulo="Declarado por mês (R$)">
            <Entrada name="valor_declarado" inputMode="decimal" defaultValue={v(r.valor_declarado)} />
          </Campo>
          <Campo rotulo="Comprovado (R$)" dica="Preencha ao conferir o comprovante.">
            <Entrada name="valor_comprovado" inputMode="decimal" defaultValue={v(r.valor_comprovado)} />
          </Campo>
          <Campo rotulo="Comprovante">
            <Entrada name="comprovante" defaultValue={r.comprovante ?? ""} placeholder="Holerites, extrato, IR…" />
          </Campo>
        </div>
      </Formulario>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-mudo">
        <span className="flex flex-wrap items-center gap-2">
          {r.origem === "ficha" && <Selo cor="azul">informada pelo candidato</Selo>}
          {r.valor_comprovado !== null ? (
            <span>
              Comprovada por {nome(r.comprovado_por)} em {quando(r.comprovado_em)}
            </span>
          ) : (
            <span className="text-alerta">Ainda não comprovada</span>
          )}
        </span>
        <BotaoExcluir acao={excluirRenda} id={r.id} rotulo="Excluir renda" confirmar="Excluir esta fonte de renda?" />
      </div>
    </li>
  );
}
