"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { Check, CircleDollarSign, Paperclip, Upload, X } from "lucide-react";
import { AbasSegmentadas } from "@/components/abas-segmentadas";
import { classeBotao } from "@/components/ui";
import { diasEntre, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { calcularAtraso } from "@/lib/dominio/encargos";
import { enviarComprovante, TAMANHO_MAX_COMPROVANTE, TIPOS_COMPROVANTE } from "@/lib/supabase/navegador";
import { desfazerPagamento, linkComprovante, marcarPago, salvarComprovante } from "./actions";

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
  /** Já tem comprovante anexado. */
  comprovante: boolean;
  multaPct: number;
  jurosMesPct: number;
  carenciaDias: number;
}

type Filtro = "todos" | "falta" | "pagos";

const rotulo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";
const campo =
  "w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 text-[15px] text-texto outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg";

/** Controle do mês: um check por aluguel; marcar abre a confirmação, desmarcar desfaz a baixa. */
function validarArquivo(f: File): string | null {
  if (!TIPOS_COMPROVANTE.includes(f.type)) return "Envie uma imagem (JPG, PNG) ou PDF.";
  if (f.size > TAMANHO_MAX_COMPROVANTE) return "O arquivo passa de 10 MB.";
  return null;
}

/** Abre o comprovante em nova aba (a aba abre na hora para o navegador não bloquear). */
async function abrirComprovante(faturaId: string) {
  const aba = window.open("about:blank", "_blank");
  const r = await linkComprovante(faturaId);
  if (r.ok && r.url) {
    if (aba) aba.location.href = r.url;
    else window.open(r.url, "_blank");
  } else {
    aba?.close();
    window.alert(r.erro ?? "Não foi possível abrir o comprovante.");
  }
}

export function ControleMes({
  itens,
  competencia,
  hoje,
  organizacaoId,
}: {
  itens: AluguelDoMes[];
  competencia: string;
  hoje: string;
  organizacaoId: string;
}) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [aberto, setAberto] = useState<AluguelDoMes | null>(null);
  const [data, setData] = useState(hoje);
  const [forma, setForma] = useState("pix");
  const [aplicarMulta, setAplicarMulta] = useState(false);
  const [multaTexto, setMultaTexto] = useState("");
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [arrastando, setArrastando] = useState(false);
  const entradaArquivo = useRef<HTMLInputElement>(null);
  const anexarDepois = useRef<HTMLInputElement>(null);
  const [anexandoEm, setAnexandoEm] = useState<AluguelDoMes | null>(null);

  const escolherArquivo = (f: File | undefined | null) => {
    if (!f) return;
    const problema = validarArquivo(f);
    if (problema) {
      setErro(problema);
      return;
    }
    setErro("");
    setArquivo(f);
  };

  // Anexar a um aluguel já pago (sem abrir a janela de pagamento).
  const anexarEmPago = (f: File | undefined | null) => {
    const it = anexandoEm;
    setAnexandoEm(null);
    if (!f || !it?.faturaId) return;
    const problema = validarArquivo(f);
    if (problema) return window.alert(problema);
    setOcupado(it.contratoId);
    iniciar(async () => {
      try {
        const caminho = await enviarComprovante(organizacaoId, it.faturaId!, f);
        const r = await salvarComprovante(it.faturaId!, caminho);
        if (!r.ok) window.alert(r.erro);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Não foi possível anexar.");
      } finally {
        setOcupado(null);
      }
    });
  };

  const visiveis = useMemo(() => {
    const ordem = (i: AluguelDoMes) => (i.situacao === "paga" ? 2 : i.vencimento < hoje ? 0 : 1);
    return itens
      .filter((i) => (filtro === "pagos" ? i.situacao === "paga" : filtro === "falta" ? i.situacao !== "paga" : true))
      .sort((a, b) => ordem(a) - ordem(b) || a.vencimento.localeCompare(b.vencimento));
  }, [itens, filtro, hoje]);

  // Só uma sugestão: a multa entra apenas se o usuário clicar em "Aplicar multa".
  const calculo = aberto
    ? calcularAtraso({
        valor: paraCentavos(aberto.valor),
        vencimento: aberto.vencimento,
        pagamento: data,
        multaPct: aberto.multaPct,
        jurosMesPct: aberto.jurosMesPct,
        carenciaDias: aberto.carenciaDias,
      })
    : null;
  const sugestao = calculo ? paraReais(calculo.multa + calculo.juros) : 0;
  const multaDigitada = (() => {
    const t = multaTexto.trim();
    if (!t) return 0;
    const n = Number(t.includes(",") ? t.replace(/\./g, "").replace(",", ".") : t);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0;
  })();
  const multaFinal = aplicarMulta ? multaDigitada : 0;
  const totalFinal = aberto ? Math.round((aberto.valor + multaFinal) * 100) / 100 : 0;
  const diasAtrasados = aberto ? diasEntre(aberto.vencimento, data) : 0;

  const abrir = (it: AluguelDoMes) => {
    setAberto(it);
    setData(hoje);
    setForma("pix");
    setAplicarMulta(false);
    setMultaTexto("");
    setErro("");
    setArquivo(null);
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
        multa: multaFinal,
      });
      if (!r.ok) {
        setErro(r.erro ?? "Não foi possível registrar o pagamento.");
        return;
      }
      if (arquivo && r.faturaId) {
        try {
          const caminho = await enviarComprovante(organizacaoId, r.faturaId, arquivo);
          const s2 = await salvarComprovante(r.faturaId, caminho);
          if (!s2.ok) throw new Error(s2.erro);
        } catch (e) {
          setAberto(null);
          window.alert(
            `O pagamento foi registrado, mas o comprovante não foi anexado: ${e instanceof Error ? e.message : "erro"}. Use "Anexar" na linha para tentar de novo.`,
          );
          return;
        }
      }
      setAberto(null);
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
                  const alvo = e.target as HTMLElement;
                  if (alvo.closest("a") || (alvo.closest("button") && !alvo.closest("[role=checkbox]"))) return;
                  // Desfazer só pelo botão do check (clicar no resto da linha paga não faz nada).
                  if (pago) {
                    if (alvo.closest("[role=checkbox]")) desfazer(it);
                  } else abrir(it);
                }}
                className={`flex ${pago ? "cursor-default" : "cursor-pointer"} flex-wrap items-center gap-x-5 gap-y-2 border-b border-borda-suave px-5 py-4 transition last:border-b-0 hover:bg-card-hover ${
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
                  <div className="flex items-center justify-end gap-2 text-xs">
                    {pago && it.faturaId && it.comprovante && (
                      <button
                        type="button"
                        onClick={() => abrirComprovante(it.faturaId!)}
                        className="inline-flex items-center gap-1 font-medium text-acento hover:underline"
                      >
                        <Paperclip className="size-3.5" /> Comprovante
                      </button>
                    )}
                    {pago && it.faturaId && !it.comprovante && (
                      <button
                        type="button"
                        onClick={() => {
                          setAnexandoEm(it);
                          anexarDepois.current?.click();
                        }}
                        className="inline-flex items-center gap-1 text-mudo hover:text-acento hover:underline"
                      >
                        <Paperclip className="size-3.5" /> Anexar
                      </button>
                    )}
                    {it.faturaId ? (
                      <Link href={`/faturas/${it.faturaId}`} className="text-mudo hover:text-acento hover:underline">
                        ver cobrança
                      </Link>
                    ) : (
                      <span className="text-fraco">fatura não gerada</span>
                    )}
                  </div>
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
                {multaFinal > 0 && (
                  <div className="flex justify-between text-ruim">
                    <span>Multa por atraso</span>
                    <span>{formatarReais(multaFinal)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t border-borda pt-1.5 text-[15px] font-semibold text-texto">
                  <span>Total recebido</span>
                  <span>{formatarReais(totalFinal)}</span>
                </div>
              </div>

              {diasAtrasados > 0 && (
                <div className="mt-3 rounded-[14px] border border-alerta-bd bg-alerta-bg px-4 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-medium text-alerta">
                      Pago com {diasAtrasados} {diasAtrasados === 1 ? "dia" : "dias"} de atraso
                    </span>
                    {aplicarMulta ? (
                      <button
                        type="button"
                        className="text-xs text-mudo hover:text-ruim hover:underline"
                        onClick={() => {
                          setAplicarMulta(false);
                          setMultaTexto("");
                        }}
                      >
                        tirar multa
                      </button>
                    ) : (
                      <button
                        type="button"
                        className={classeBotao("secundario", "sm")}
                        onClick={() => {
                          setAplicarMulta(true);
                          setMultaTexto(sugestao > 0 ? sugestao.toFixed(2).replace(".", ",") : "");
                        }}
                      >
                        + Aplicar multa
                      </button>
                    )}
                  </div>
                  {aplicarMulta ? (
                    <label className="mt-3 flex flex-col gap-1.5">
                      <span className={rotulo}>Valor da multa (R$)</span>
                      <input
                        autoFocus
                        inputMode="decimal"
                        value={multaTexto}
                        onChange={(e) => setMultaTexto(e.target.value)}
                        placeholder="0,00"
                        className={campo}
                      />
                      <span className="text-xs text-texto-2">
                        Sugestão pelo contrato: {formatarReais(sugestao)} ({aberto.multaPct}% de multa + {aberto.jurosMesPct}% de juros ao mês
                        {aberto.carenciaDias ? `, ${aberto.carenciaDias} dia(s) de carência` : ""}). Você decide o valor.
                      </span>
                    </label>
                  ) : (
                    <p className="mt-1 text-xs text-texto-2">Sem multa. Se quiser cobrar, clique em “Aplicar multa” e digite o valor.</p>
                  )}
                </div>
              )}

              <div className="mt-4">
                <span className={rotulo}>Comprovante (opcional)</span>
                <input
                  ref={entradaArquivo}
                  type="file"
                  accept={TIPOS_COMPROVANTE.join(",")}
                  className="hidden"
                  onChange={(e) => {
                    escolherArquivo(e.target.files?.[0]);
                    e.target.value = "";
                  }}
                />
                {arquivo ? (
                  <div className="mt-1.5 flex items-center gap-3 rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-3 text-sm">
                    <Paperclip className="size-4 shrink-0 text-ok" />
                    <span className="min-w-0 flex-1 truncate text-texto">{arquivo.name}</span>
                    <span className="shrink-0 text-xs text-mudo">{(arquivo.size / 1024 / 1024).toFixed(1)} MB</span>
                    <button
                      type="button"
                      onClick={() => setArquivo(null)}
                      aria-label="Remover comprovante"
                      className="grid size-7 place-items-center rounded-lg text-mudo hover:bg-card hover:text-ruim"
                    >
                      <X className="size-4" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => entradaArquivo.current?.click()}
                    onDragOver={(e) => {
                      e.preventDefault();
                      setArrastando(true);
                    }}
                    onDragLeave={() => setArrastando(false)}
                    onDrop={(e) => {
                      e.preventDefault();
                      setArrastando(false);
                      escolherArquivo(e.dataTransfer.files?.[0]);
                    }}
                    className={`mt-1.5 flex w-full flex-col items-center gap-1 rounded-[14px] border-2 border-dashed px-4 py-4 text-center transition ${
                      arrastando ? "border-acento bg-acento-bg" : "border-borda-forte hover:border-acento hover:bg-acento-bg"
                    }`}
                  >
                    <Upload className="size-5 text-acento" />
                    <span className="text-sm font-medium text-texto">Anexar comprovante</span>
                    <span className="text-xs text-mudo">Clique ou arraste a imagem ou o PDF (até 10 MB)</span>
                  </button>
                )}
              </div>

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
      <input
        ref={anexarDepois}
        type="file"
        accept={TIPOS_COMPROVANTE.join(",")}
        className="hidden"
        onChange={(e) => {
          anexarEmPago(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}
