"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CircleDollarSign, LoaderCircle, Paperclip, Receipt } from "lucide-react";
import { AbasSegmentadas } from "@/components/abas-segmentadas";
import { Selo } from "@/components/ui";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { enviarComprovante, TAMANHO_MAX_COMPROVANTE, TIPOS_COMPROVANTE } from "@/lib/supabase/navegador";
import { linkComprovante, salvarComprovante } from "./actions";
import { BotaoDesfazer, BotaoReceber, type AlvoRecebimento, type OpcoesRecebimento } from "./recebimento";

export interface AluguelDoMes {
  contratoId: string;
  contratoNumero: number;
  faturaId: string | null;
  acordoId: string | null;
  situacao: "paga" | "aberta" | "parcial" | "acordo" | "sem_fatura";
  inquilino: string;
  imovel: string;
  codigoImovel: string;
  /** Valor da fatura (ou o aluguel do contrato, se a fatura ainda não foi gerada). */
  valor: number;
  /** O que falta do aluguel (sem multa e juros). */
  saldo: number;
  /** Dinheiro já recebido (pagamentos parciais). */
  recebido: number;
  vencimento: string;
  /** > 0 = dias de atraso. */
  dias: number;
  pagoEm: string | null;
  valorPago: number | null;
  /** Já tem comprovante anexado. */
  comprovante: boolean;
  /** O que o "Desfazer" tira (o último recebimento) e o que continua; null = desfaz pelo acordo. */
  desfazer: { valor: number; pagoEm: string | null; restante: number; outros: number } | null;
  alvo: AlvoRecebimento;
}

type Filtro = "todos" | "falta" | "pagos";

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

/**
 * Controle do mês: cada aluguel tem botões explícitos — "Receber" abre a
 * janela de confirmação (com valor, multa e juros separados) e "Desfazer"
 * abre outra confirmação. Nada de caixa de marcar disparando dinheiro.
 */
export function ControleMes({ itens, opcoes, pessoal }: { itens: AluguelDoMes[]; opcoes: OpcoesRecebimento; pessoal: boolean }) {
  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [pendente, iniciar] = useTransition();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const anexar = useRef<HTMLInputElement>(null);
  const [anexandoEm, setAnexandoEm] = useState<AluguelDoMes | null>(null);

  const visiveis = useMemo(() => {
    const ordem = (i: AluguelDoMes) => (i.situacao === "paga" ? 3 : i.situacao === "acordo" ? 2 : i.dias > 0 ? 0 : 1);
    return itens
      .filter((i) => (filtro === "pagos" ? i.situacao === "paga" : filtro === "falta" ? i.situacao !== "paga" : true))
      .sort((a, b) => ordem(a) - ordem(b) || a.vencimento.localeCompare(b.vencimento));
  }, [itens, filtro]);

  const anexarEmPago = (f: File | undefined | null) => {
    const it = anexandoEm;
    setAnexandoEm(null);
    if (!f || !it?.faturaId) return;
    if (!TIPOS_COMPROVANTE.includes(f.type)) return window.alert("Envie uma imagem (JPG, PNG) ou PDF.");
    if (f.size > TAMANHO_MAX_COMPROVANTE) return window.alert("O arquivo passa de 10 MB.");
    setOcupado(it.contratoId);
    iniciar(async () => {
      try {
        const caminho = await enviarComprovante(opcoes.organizacaoId, it.faturaId!, f);
        const r = await salvarComprovante(it.faturaId!, caminho);
        if (!r.ok) window.alert(r.erro);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Não foi possível anexar.");
      } finally {
        setOcupado(null);
      }
    });
  };

  const total = (f: Filtro) => (f === "todos" ? itens.length : itens.filter((i) => (f === "pagos" ? i.situacao === "paga" : i.situacao !== "paga")).length);

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
            const carregando = ocupado === it.contratoId && pendente;
            return (
              <li key={it.contratoId} className={`flex flex-wrap items-center gap-x-5 gap-y-2 border-b border-borda-suave px-5 py-4 transition last:border-b-0 hover:bg-card-hover ${carregando ? "opacity-50" : ""}`}>
                <span
                  className={`grid size-9 shrink-0 place-items-center rounded-[10px] border ${pago ? "border-ok-bd bg-ok-bg text-ok" : it.dias > 0 && it.situacao !== "acordo" ? "border-ruim-bd bg-ruim-bg text-ruim" : "border-borda bg-elev text-mudo"}`}
                  aria-hidden
                >
                  {carregando ? <LoaderCircle className="size-4 animate-spin" /> : <CircleDollarSign className="size-4" />}
                </span>

                <div className="min-w-[200px] flex-1">
                  <div className="text-[15px] font-semibold text-texto">{it.inquilino}</div>
                  <div className="text-[13px] text-texto-2">
                    <span className="font-medium">{it.codigoImovel}</span>
                    {it.imovel !== it.codigoImovel ? ` · ${it.imovel}` : ""} · contrato #{it.contratoNumero}
                  </div>
                </div>

                <div className="w-44 text-[13px] text-texto-2">
                  Vence {formatarDataBR(it.vencimento)}
                  <div className="mt-1">
                    {pago ? (
                      <Selo cor="verde">Pago {formatarDataBR(it.pagoEm)}</Selo>
                    ) : it.situacao === "acordo" ? (
                      <Selo cor="azul">Em acordo</Selo>
                    ) : it.situacao === "parcial" ? (
                      <Selo cor="amarelo">Parcial · falta {formatarReais(it.saldo)}</Selo>
                    ) : it.dias > 0 ? (
                      <Selo cor="vermelho">
                        {it.dias} {it.dias === 1 ? "dia" : "dias"} de atraso
                      </Selo>
                    ) : (
                      <Selo cor="amarelo">Em aberto</Selo>
                    )}
                  </div>
                </div>

                <div className="w-32 text-right">
                  <div className={`text-[16px] font-semibold tabular-nums ${pago ? "text-ok" : "text-texto"}`}>{formatarReais(pago && it.valorPago ? it.valorPago : it.valor)}</div>
                  {it.situacao === "parcial" && <div className="text-xs text-mudo">recebido {formatarReais(it.recebido)}</div>}
                </div>

                <div className="flex min-w-[220px] flex-wrap items-center justify-end gap-1.5">
                  {pago && it.faturaId ? (
                    <>
                      <Link href={`/faturas/${it.faturaId}/recibo`} className="inline-flex items-center gap-1 px-2 text-xs font-medium text-acento hover:underline">
                        <Receipt className="size-3.5" /> Recibo
                      </Link>
                      {it.comprovante ? (
                        <button type="button" onClick={() => abrirComprovante(it.faturaId!)} className="inline-flex items-center gap-1 px-2 text-xs font-medium text-acento hover:underline">
                          <Paperclip className="size-3.5" /> Comprovante
                        </button>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setAnexandoEm(it);
                            anexar.current?.click();
                          }}
                          className="inline-flex items-center gap-1 px-2 text-xs text-mudo hover:text-acento hover:underline"
                        >
                          <Paperclip className="size-3.5" /> Anexar
                        </button>
                      )}
                      {it.desfazer ? (
                        <BotaoDesfazer faturaId={it.faturaId} titulo={it.inquilino} {...it.desfazer} pessoal={pessoal} rotulo={it.desfazer.outros > 0 ? "Desfazer último" : "Desfazer"} />
                      ) : (
                        it.acordoId && (
                          <Link href={`/cobrancas/acordos/${it.acordoId}`} className="px-2 text-xs text-mudo hover:text-acento hover:underline">
                            desfazer pelo acordo
                          </Link>
                        )
                      )}
                    </>
                  ) : it.situacao === "acordo" ? (
                    it.acordoId && (
                      <Link href={`/cobrancas/acordos/${it.acordoId}`} className="px-2 text-xs font-medium text-acento hover:underline">
                        ver acordo
                      </Link>
                    )
                  ) : (
                    <BotaoReceber alvo={it.alvo} opcoes={opcoes} tamanho="sm">
                      <CircleDollarSign className="size-3.5" /> Receber
                    </BotaoReceber>
                  )}
                  {it.faturaId ? (
                    <Link href={`/faturas/${it.faturaId}`} className="px-2 text-xs text-mudo hover:text-acento hover:underline">
                      ver cobrança
                    </Link>
                  ) : (
                    <span className="px-2 text-xs text-fraco">fatura não gerada</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <input
        ref={anexar}
        type="file"
        accept={TIPOS_COMPROVANTE.join(",")}
        className="hidden"
        aria-label="Anexar comprovante"
        onChange={(e) => {
          anexarEmPago(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
    </>
  );
}
