"use client";

import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { EVENTO_SALVAR } from "@/components/formulario";
import { classeBotao } from "@/components/ui";
import { OPERADORES_POR_TIPO, OPERADORES_SEM_VALOR, ROTULO_OPERADOR, type CampoFonte, type FiltroRelatorio, type Operador } from "@/lib/dominio/bi";

type Linha = { k: number; campo: string; op: string; valor: string };

const MAX = 10;
const cls =
  "min-h-10 rounded-btn border border-borda-forte bg-input px-3 py-2 text-[14px] text-texto outline-none transition focus:border-acento focus:ring-4 focus:ring-acento-bg";

/**
 * Linhas de filtro do relatório personalizado (dentro do formulário que salva
 * sozinho): a lista de condições muda conforme o tipo da coluna escolhida e o
 * campo de valor some quando a condição não precisa de valor.
 */
export function FiltrosRelatorio({ campos, iniciais }: { campos: CampoFonte[]; iniciais: FiltroRelatorio[] }) {
  const [linhas, setLinhas] = useState<Linha[]>(() => [
    ...iniciais.slice(0, MAX).map((f, i) => ({ k: i, campo: f.campo, op: f.op, valor: f.valor ?? "" })),
    ...(iniciais.length < MAX ? [{ k: iniciais.length, campo: "", op: "", valor: "" }] : []),
  ]);
  const [proximo, setProximo] = useState(iniciais.length + 1);
  const caixa = useRef<HTMLDivElement>(null);
  const tipoDe = (campo: string) => campos.find((c) => c.id === campo)?.tipo;
  const pedirSalvar = () => setTimeout(() => caixa.current?.dispatchEvent(new CustomEvent(EVENTO_SALVAR, { bubbles: true, detail: 0 })), 0);
  const mudar = (k: number, m: Partial<Linha>) => setLinhas((ls) => ls.map((l) => (l.k === k ? { ...l, ...m } : l)));

  return (
    <div ref={caixa} className="space-y-2">
      <input type="hidden" name="f_n" value={linhas.length} />
      {linhas.map((l, i) => {
        const tipo = tipoDe(l.campo);
        const ops: Operador[] = tipo ? OPERADORES_POR_TIPO[tipo] : [];
        const semValor = (OPERADORES_SEM_VALOR as string[]).includes(l.op);
        const tipoValor = l.op === "ultimos_dias" ? "number" : tipo === "data" ? "date" : "text";
        return (
          <div key={l.k} className="flex flex-wrap items-center gap-2">
            <select
              name={`f_campo_${i}`}
              value={l.campo}
              aria-label={`Coluna do filtro ${i + 1}`}
              className={cls}
              onChange={(e) => {
                const t = tipoDe(e.target.value);
                mudar(l.k, { campo: e.target.value, op: t ? OPERADORES_POR_TIPO[t][0] : "", valor: "" });
              }}
            >
              <option value="">— escolha a coluna —</option>
              {campos.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.rotulo}
                </option>
              ))}
            </select>
            <select name={`f_op_${i}`} value={l.op} aria-label={`Condição do filtro ${i + 1}`} className={cls} disabled={!tipo} onChange={(e) => mudar(l.k, { op: e.target.value })}>
              {!tipo && <option value="">—</option>}
              {ops.map((o) => (
                <option key={o} value={o}>
                  {ROTULO_OPERADOR[o]}
                </option>
              ))}
            </select>
            {tipo && !semValor && (
              <input
                name={`f_valor_${i}`}
                type={tipoValor}
                value={l.valor}
                min={tipoValor === "number" ? 1 : undefined}
                max={tipoValor === "number" ? 3650 : undefined}
                inputMode={tipo === "dinheiro" || tipo === "numero" || tipo === "inteiro" ? "decimal" : undefined}
                placeholder={l.op === "ultimos_dias" ? "dias" : "valor"}
                aria-label={`Valor do filtro ${i + 1}`}
                className={`${cls} w-44`}
                onChange={(e) => mudar(l.k, { valor: e.target.value })}
              />
            )}
            {(l.campo || linhas.length > 1) && (
              <button
                type="button"
                title="Tirar este filtro"
                aria-label={`Tirar o filtro ${i + 1}`}
                className="grid size-8 shrink-0 place-items-center rounded-[9px] border border-ruim-bd bg-ruim-bg text-ruim transition duration-150 hover:-translate-y-px active:scale-90"
                onClick={() => {
                  setLinhas((ls) => ls.filter((x) => x.k !== l.k));
                  pedirSalvar();
                }}
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        );
      })}
      {linhas.length < MAX && (
        <button
          type="button"
          className={classeBotao("fantasma", "sm")}
          onClick={() => {
            setLinhas((ls) => [...ls, { k: proximo, campo: "", op: "", valor: "" }]);
            setProximo((p) => p + 1);
          }}
        >
          <Plus className="size-3.5" /> Mais um filtro
        </button>
      )}
      <p className="text-xs text-mudo">Filtro sem valor ainda não vale. Datas: “nos últimos N dias”, “neste mês” e “no mês passado” andam com o calendário (bom para envios programados).</p>
    </div>
  );
}
