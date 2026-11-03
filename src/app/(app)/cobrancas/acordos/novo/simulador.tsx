"use client";

import { useState } from "react";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { planejarAcordo, type TipoDesconto } from "@/lib/dominio/cobrancas";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { criarAcordo } from "../../actions";

/** Débito em aberto (valores em centavos). */
export interface DebitoSimulador {
  faturaId: string;
  numero: number;
  competencia: string;
  vencimento: string;
  dias: number;
  saldo: number;
  multa: number;
  juros: number;
}

function lerNumero(t: string): number {
  const s = t.trim();
  if (!s) return 0;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
const R = (c: number) => formatarReais(paraReais(c));

/**
 * Simulador do acordo: escolhe as cobranças, se entram multa e juros, o
 * desconto, a entrada e as parcelas, e vê na hora quanto fica cada parcela.
 * O servidor refaz todas as contas ao fechar.
 */
export function SimuladorAcordo({ contratoId, debitos, hoje, primeiroPadrao }: { contratoId: string; debitos: DebitoSimulador[]; hoje: string; primeiroPadrao: string }) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(debitos.filter((d) => d.dias > 0).map((d) => d.faturaId)));
  const [comMulta, setComMulta] = useState(true);
  const [comJuros, setComJuros] = useState(true);
  const [tipo, setTipo] = useState<TipoDesconto>("pct_encargos");
  const [desconto, setDesconto] = useState("");
  const [entrada, setEntrada] = useState("");
  const [parcelas, setParcelas] = useState("3");
  const [primeiro, setPrimeiro] = useState(primeiroPadrao);

  const dv = lerNumero(desconto);
  const plano = planejarAcordo({
    debitos: debitos.filter((d) => marcadas.has(d.faturaId)).map((d) => ({ faturaId: d.faturaId, vencimento: d.vencimento, saldo: d.saldo, multa: comMulta ? d.multa : 0, juros: comJuros ? d.juros : 0 })),
    desconto: dv > 0 ? { tipo, valor: tipo === "valor" ? Math.round(dv * 100) : dv } : null,
    entrada: Math.round(lerNumero(entrada) * 100),
    parcelas: Math.trunc(lerNumero(parcelas)),
    primeiroVencimento: primeiro || primeiroPadrao,
    dataAcordo: hoje,
  });
  const n = plano.parcelas.filter((p) => p.numero > 0).length;

  return (
    <Formulario acao={criarAcordo} className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <input type="hidden" name="contrato_id" value={contratoId} />
      <div className="space-y-5">
        <section className="rounded-card border border-borda bg-card p-5">
          <h3 className="mb-3 text-[15px] font-semibold text-texto">1. O que entra no acordo</h3>
          <ul className="divide-y divide-borda-suave">
            {debitos.map((d) => (
              <li key={d.faturaId} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <label className="flex items-center gap-3 text-sm">
                  <input
                    type="checkbox"
                    name="fatura_id"
                    value={d.faturaId}
                    checked={marcadas.has(d.faturaId)}
                    onChange={(e) =>
                      setMarcadas((s) => {
                        const n2 = new Set(s);
                        if (e.target.checked) n2.add(d.faturaId);
                        else n2.delete(d.faturaId);
                        return n2;
                      })
                    }
                    className="size-4"
                  />
                  <span>
                    <span className="font-medium text-texto">
                      #{d.numero} · aluguel de {formatarCompetencia(d.competencia)}
                    </span>
                    <span className="block text-xs text-mudo">
                      venceu {formatarDataBR(d.vencimento)} {d.dias > 0 ? `· ${d.dias} dias de atraso` : "· ainda não venceu"}
                    </span>
                  </span>
                </label>
                <span className="text-right text-xs text-texto-2 tabular-nums">
                  aluguel {R(d.saldo)}
                  <span className="block">
                    multa {R(d.multa)} · juros {R(d.juros)}
                  </span>
                </span>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2 text-sm text-texto-2">
            <label className="flex items-center gap-2">
              <input type="hidden" name="cobrar_multa" value="" />
              <input type="checkbox" name="cobrar_multa" checked={comMulta} onChange={(e) => setComMulta(e.target.checked)} className="size-4" /> Cobrar a multa do contrato
            </label>
            <label className="flex items-center gap-2">
              <input type="hidden" name="cobrar_juros" value="" />
              <input type="checkbox" name="cobrar_juros" checked={comJuros} onChange={(e) => setComJuros(e.target.checked)} className="size-4" /> Cobrar os juros até hoje
            </label>
          </div>
        </section>

        <section className="rounded-card border border-borda bg-card p-5">
          <h3 className="mb-3 text-[15px] font-semibold text-texto">2. Negociação</h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Tipo de desconto">
              <Selecao name="desconto_tipo" value={tipo} onChange={(e) => setTipo(e.target.value as TipoDesconto)}>
                <option value="pct_encargos">% sobre multa e juros</option>
                <option value="pct_total">% sobre o total</option>
                <option value="valor">Valor fixo (R$)</option>
              </Selecao>
            </Campo>
            <Campo rotulo={tipo === "valor" ? "Desconto (R$)" : "Desconto (%)"}>
              <Entrada name="desconto_valor" inputMode="decimal" value={desconto} onChange={(e) => setDesconto(e.target.value)} placeholder="0" />
            </Campo>
            <Campo rotulo="Entrada (R$, hoje)" dica="Vazio = sem entrada.">
              <Entrada name="entrada" inputMode="decimal" value={entrada} onChange={(e) => setEntrada(e.target.value)} placeholder="0,00" />
            </Campo>
            <Campo rotulo="Número de parcelas">
              <Entrada name="parcelas" type="number" min={1} max={120} value={parcelas} onChange={(e) => setParcelas(e.target.value)} />
            </Campo>
            <Campo rotulo="Vencimento da 1ª parcela" dica="As outras vencem no mesmo dia dos meses seguintes.">
              <Entrada name="primeiro_vencimento" type="date" min={hoje} value={primeiro} onChange={(e) => setPrimeiro(e.target.value)} />
            </Campo>
          </div>
          <div className="mt-4 grid gap-4">
            <Campo rotulo="Condições combinadas (saem no termo)">
              <AreaTexto name="condicoes" rows={3} placeholder="Ex.: atraso de qualquer parcela por mais de 30 dias quebra o acordo e o saldo volta a ser cobrado com multa e juros do contrato." />
            </Campo>
            <Campo rotulo="Observações internas">
              <AreaTexto name="observacoes" rows={2} />
            </Campo>
          </div>
        </section>
      </div>

      <aside className="space-y-4 xl:sticky xl:top-4 xl:self-start">
        <section className="rounded-card border border-borda bg-card p-5">
          <h3 className="mb-3 text-[15px] font-semibold text-texto">3. Resumo</h3>
          {plano.erro ? (
            <p className="rounded-[14px] border border-alerta-bd bg-alerta-bg px-4 py-3 text-sm text-alerta">{plano.erro}</p>
          ) : (
            <>
              <dl className="space-y-1.5 text-sm">
                {[
                  ["Aluguéis em aberto", R(plano.principal)],
                  ["Multa", R(plano.multa)],
                  ["Juros", R(plano.juros)],
                  ["Desconto", plano.desconto ? `− ${R(plano.desconto)}` : R(0)],
                ].map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="text-texto-2">{k}</dt>
                    <dd className="tabular-nums">{v}</dd>
                  </div>
                ))}
                <div className="flex justify-between border-t border-borda pt-1.5 text-[15px] font-semibold">
                  <dt>Total do acordo</dt>
                  <dd className="tabular-nums">{R(plano.total)}</dd>
                </div>
              </dl>
              <ol className="mt-4 space-y-1 text-sm">
                {plano.parcelas.map((p) => (
                  <li key={p.numero} className="flex justify-between rounded-[10px] bg-elev px-3 py-1.5">
                    <span>
                      {p.numero === 0 ? "Entrada" : `${p.numero}ª parcela`} · {formatarDataBR(p.vencimento)}
                    </span>
                    <span className="tabular-nums">{R(p.valor)}</span>
                  </li>
                ))}
              </ol>
              <p className="mt-3 text-xs text-mudo">
                As cobranças escolhidas ficam “em acordo”. Cada parcela paga quita os aluguéis do mais antigo para o mais novo (com repasse ao proprietário, na imobiliária). O desconto abate primeiro juros, depois multa.
              </p>
            </>
          )}
        </section>
        {!plano.erro && (
          <BotaoEnviar confirmar={`Fechar acordo de ${R(plano.total)}${plano.entrada ? ` (entrada de ${R(plano.entrada)} +` : " em"} ${n} parcela(s)${plano.entrada ? ")" : ""}?`}>
            Fechar acordo de {R(plano.total)}
          </BotaoEnviar>
        )}
      </aside>
    </Formulario>
  );
}
