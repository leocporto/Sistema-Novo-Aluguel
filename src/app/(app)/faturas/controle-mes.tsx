"use client";

import { useMemo, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, CircleDollarSign } from "lucide-react";
import { AbasSegmentadas } from "@/components/abas-segmentadas";
import { classeBotao } from "@/components/ui";
import { diasEntre, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { calcularAtraso } from "@/lib/dominio/encargos";
import { desfazerPagamento, marcarPago } from "./actions";

export interface AluguelDoMes {
  contratoId: string;
  contratoNumero: number;
  faturaId: string | null;
  situacao: "paga" | "aberta" | "sem_fatura";
  inquilino: string;
  imovel: string;
  /** Valor da fatura (ou o aluguel do contrato, se a fatura ainda não foi gerada). */
  valor: number;
  vencimento: string;
  pagoEm: string | null;
  valorPago: number | null;
  multaPct: number;
  jurosMesPct: number;
  carenciaDias: number;
}

type Filtro = "todos" | "falta" | "pagos";

const rotulo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";
const campo =
  "w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 text-[15px] text-texto outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg";

/** Controle do mês: um check por aluguel; marcar abre a confirmação, desmarcar desfaz a baixa. */
export function ControleMes({ itens, competencia, hoje }: { itens: AluguelDoMes[]; competencia: string; hoje: string }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberto, setAberto] = useState<AluguelDoMes | null>(null);
  const [data, setData] = useState(hoje);
  const [forma, setForma] = useState("pix");
  const [dispensar, setDispensar] = useState(false);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const [ocupado, setOcupado] = useState<string | null>(null);

  const visiveis = useMemo(() => {
    const ordem = (i: AluguelDoMes) => (i.situacao === "paga" ? 2 : i.vencimento < hoje ? 0 : 1);
    return itens
      .filter((i) => (filtro === "pagos" ? i.situacao === "paga" : filtro === "falta" ? i.situacao !== "paga" : true))
      .sort((a, b) => ordem(a) - ordem(b) || a.vencimento.localeCompare(b.vencimento));
  }, [itens, filtro, hoje]);

  const calculo = aberto
    ? calcularAtraso({
        valor: paraCentavos(aberto.valor),
        vencimento: aberto.vencimento,
        pagamento: data,
        multaPct: dispensar ? 0 : aberto.multaPct,
        jurosMesPct: dispensar ? 0 : aberto.jurosMesPct,
        carenciaDias: aberto.carenciaDias,
      })
    : null;

  const abrir = (it: AluguelDoMes) => {
    setAberto(it);
    setData(hoje);
    setForma("pix");
    setDispensar(false);
    setErro("");
  };

  const confirmar = () => {
    if (!aberto) return;
    const it = aberto;
    setErro("");
    iniciar(async () => {
      const r = await marcarPago({
        contratoId: it.contratoId,
        competencia,
        faturaId: it.faturaId,
        pagoEm: data,
        formaPagamento: forma,
        dispensarEncargos: dispensar,
      });
      if (r.ok) setAberto(null);
      else setErro(r.erro ?? "Não foi possível registrar o pagamento.");
    });
  };

  const desfazer = (it: AluguelDoMes) => {
    if (!it.faturaId) return;
    if (!window.confirm(`Desfazer o pagamento de ${it.inquilino}? O aluguel volta para "em aberto".`)) return;
    setOcupado(it.contratoId);
    iniciar(async () => {
      const r = await desfazerPagamento(it.faturaId!);
      setOcupado(null);
      if (!r.ok) window.alert(r.erro ?? "Não foi possível desfazer.");
    });
  };

  const total = (f: Filtro) =>
    f === "todos" ? itens.length : f === "pagos" ? itens.filter((i) => i.situacao === "paga").length : itens.filter((i) => i.situacao !== "paga").length;

  return (
    <>
      <div className="mb-4">
        <AbasSegmentadas
          variante="seg"
          valor={filtro}
          aoMudar={(id) => setFiltro(id as Filtro)}
          rotuloAcessivel="Filtrar aluguéis"
          itens={[
            { id: "todos", rotulo: `Todos (${total("todos")})` },
            { id: "falta", rotulo: `Falta pagar (${total("falta")})` },
            { id: "pagos", rotulo: `Pagos (${total("pagos")})` },
          ]}
        />
      </div>

      {visiveis.length === 0 ? (
        <div className="rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">
          {itens.length === 0 ? "Nenhum contrato com aluguel neste mês." : "Nada nesta lista."}
        </div>
      ) : (
        <ul className="overflow-hidden rounded-card border border-borda bg-card">
          {visiveis.map((it) => {
            const pago = it.situacao === "paga";
            const atraso = !pago ? diasEntre(it.vencimento, hoje) : 0;
            const carregando = ocupado === it.contratoId;
            return (
              <li
                key={it.contratoId}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a")) return;
                  if (pago) desfazer(it);
                  else abrir(it);
                }}
                className={`flex cursor-pointer flex-wrap items-center gap-x-5 gap-y-2 border-b border-borda-suave px-5 py-4 transition last:border-b-0 hover:bg-card-hover ${
                  carregando ? "opacity-50" : ""
                }`}
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={pago}
                  aria-label={pago ? `Desfazer pagamento de ${it.inquilino}` : `Marcar ${it.inquilino} como pago`}
                  className={`grid size-8 shrink-0 place-items-center rounded-[10px] border-2 transition active:scale-90 ${
                    pago ? "border-ok bg-ok text-white" : "border-borda-forte bg-card text-transparent hover:border-ok"
                  }`}
                >
                  <Check className="size-5" strokeWidth={3} />
                </button>

                <div className="min-w-[200px] flex-1">
                  <div className="text-[15px] font-semibold text-texto">{it.inquilino}</div>
                  <div className="text-[13px] text-texto-2">
                    {it.imovel} · contrato #{it.contratoNumero}
                  </div>
                </div>

                <div className="w-36 text-[13px] text-texto-2">
                  Vence {formatarDataBR(it.vencimento)}
                  <div className="mt-1">
                    {pago ? (
                      <span className="rounded-full border border-ok-bd bg-ok-bg px-2.5 py-0.5 font-mono text-[10.5px] font-bold text-ok">
                        Pago {formatarDataBR(it.pagoEm)}
                      </span>
                    ) : atraso > 0 ? (
                      <span className="rounded-full border border-ruim-bd bg-ruim-bg px-2.5 py-0.5 font-mono text-[10.5px] font-bold text-ruim">
                        {atraso} {atraso === 1 ? "dia" : "dias"} de atraso
                      </span>
                    ) : (
                      <span className="rounded-full border border-alerta-bd bg-alerta-bg px-2.5 py-0.5 font-mono text-[10.5px] font-bold text-alerta">
                        Em aberto
                      </span>
                    )}
                  </div>
                </div>

                <div className="w-32 text-right">
                  <div className={`text-[16px] font-semibold tabular-nums ${pago ? "text-ok" : "text-texto"}`}>
                    {formatarReais(pago && it.valorPago ? it.valorPago : it.valor)}
                  </div>
                  {it.faturaId ? (
                    <Link href={`/faturas/${it.faturaId}`} className="text-xs text-mudo hover:text-acento hover:underline">
                      ver cobrança
                    </Link>
                  ) : (
                    <span className="text-xs text-fraco">fatura não gerada</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {aberto &&
        calculo &&
        createPortal(
          <div
            className="janela-fundo fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px]"
            onClick={(e) => {
              if (e.target === e.currentTarget && !pendente) setAberto(null);
            }}
          >
            <div role="dialog" aria-modal="true" className="janela w-full max-w-md rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]">
              <div className="mb-5 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-[10px] border border-ok-bd bg-ok-bg text-ok">
                  <CircleDollarSign className="size-[18px]" />
                </span>
                <div>
                  <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-texto">Marcar como pago</h3>
                  <p className="text-xs text-mudo">
                    {aberto.inquilino} · {aberto.imovel}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <label className="flex flex-col gap-1.5">
                  <span className={rotulo}>Pago em</span>
                  <input type="date" value={data} max={hoje} onChange={(e) => setData(e.target.value || hoje)} className={campo} />
                </label>
                <label className="flex flex-col gap-1.5">
                  <span className={rotulo}>Forma</span>
                  <select value={forma} onChange={(e) => setForma(e.target.value)} className={campo}>
                    <option value="pix">Pix</option>
                    <option value="boleto">Boleto</option>
                    <option value="transferencia">Transferência</option>
                    <option value="dinheiro">Dinheiro</option>
                    <option value="cartao">Cartão</option>
                    <option value="outro">Outro</option>
                  </select>
                </label>
              </div>

              <div className="mt-4 space-y-1.5 rounded-[14px] border border-borda bg-elev px-4 py-3 text-sm">
                <div className="flex justify-between text-texto-2">
                  <span>Aluguel (vence {formatarDataBR(aberto.vencimento)})</span>
                  <span>{formatarReais(aberto.valor)}</span>
                </div>
                {calculo.multa + calculo.juros > 0 && (
                  <div className="flex justify-between text-ruim">
                    <span>
                      Multa e juros ({calculo.diasAtraso} {calculo.diasAtraso === 1 ? "dia" : "dias"})
                    </span>
                    <span>{formatarReais(paraReais(calculo.multa + calculo.juros))}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-borda pt-1.5 text-[15px] font-semibold text-texto">
                  <span>Total recebido</span>
                  <span>{formatarReais(paraReais(calculo.total))}</span>
                </div>
              </div>

              {diasEntre(aberto.vencimento, data) > aberto.carenciaDias && (
                <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-texto-2">
                  <input type="checkbox" checked={dispensar} onChange={(e) => setDispensar(e.target.checked)} className="size-4 accent-[var(--accent)]" />
                  Dispensar multa e juros
                </label>
              )}

              {erro && <div className="mt-3 rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}

              <div className="mt-6 flex justify-end gap-2">
                <button type="button" className={classeBotao("secundario")} onClick={() => setAberto(null)} disabled={pendente}>
                  Cancelar
                </button>
                <button type="button" className={classeBotao("primario")} onClick={confirmar} disabled={pendente}>
                  <Check className="size-4" /> {pendente ? "Salvando…" : "Confirmar pagamento"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
