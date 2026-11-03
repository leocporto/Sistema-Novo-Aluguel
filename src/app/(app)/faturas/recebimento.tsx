"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, Check, CircleDollarSign, LoaderCircle, Paperclip, Undo2, Upload, X } from "lucide-react";
import { classeBotao, type VarianteBotao } from "@/components/ui";
import { analisarRecebimento, FORMAS_RECEBIMENTO, situacaoFatura } from "@/lib/dominio/cobrancas";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { enviarComprovante, TAMANHO_MAX_COMPROVANTE, TIPOS_COMPROVANTE } from "@/lib/supabase/navegador";
import { desfazerBaixa, receberAluguel, salvarComprovante } from "./actions";

/** Tudo em reais (vem do servidor). */
export interface AlvoRecebimento {
  faturaId: string | null;
  contratoId: string;
  competencia: string;
  titulo: string;
  subtitulo: string;
  vencimento: string;
  valorTotal: number;
  pagamentos: { data: string; valor: number; principal: number; multa: number; juros: number; desconto: number }[];
  multaPct: number;
  jurosMesPct: number;
  carenciaDias: number;
  pontualidadePct: number;
  aluguel: number;
}

export interface OpcoesRecebimento {
  hoje: string;
  organizacaoId: string;
  contas: { id: string; nome: string }[];
  contaPadrao: string | null;
}

const rotulo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";
const campo =
  "w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 text-[15px] text-texto outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg";

/** "1.234,56" → centavos (vazio ou inválido = 0). */
function lerReais(t: string): number {
  const s = t.trim();
  if (!s) return 0;
  const n = Number(s.includes(",") ? s.replace(/\./g, "").replace(",", ".") : s);
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
}
const paraTexto = (c: number) => (c > 0 ? (c / 100).toFixed(2).replace(".", ",") : "");

function Fundo({ children, aoFechar, ocupado }: { children: ReactNode; aoFechar: () => void; ocupado: boolean }) {
  return createPortal(
    <div
      className="janela-fundo fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px] sm:items-center"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !ocupado) aoFechar();
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !ocupado) aoFechar();
      }}
    >
      {children}
    </div>,
    document.body,
  );
}

/**
 * Janela "Receber aluguel": data, forma, conta, multa e juros SEPARADOS (só
 * entram se o usuário aplicar), desconto e valor recebido. Recebeu menos que o
 * saldo = pagamento parcial. Nada é gravado sem o clique em "Confirmar".
 */
export function JanelaRecebimento({ alvo, opcoes, aoFechar }: { alvo: AlvoRecebimento; opcoes: OpcoesRecebimento; aoFechar: () => void }) {
  const { hoje } = opcoes;
  const [data, setData] = useState(hoje);
  const [forma, setForma] = useState("pix");
  const [conta, setConta] = useState(opcoes.contaPadrao ?? "");
  const [cobrarMulta, setCobrarMulta] = useState(false);
  const [multaTxt, setMultaTxt] = useState("");
  const [cobrarJuros, setCobrarJuros] = useState(false);
  const [jurosTxt, setJurosTxt] = useState("");
  const [descontoTxt, setDescontoTxt] = useState<string | null>(null);
  const [valorTxt, setValorTxt] = useState<string | null>(null);
  const [obs, setObs] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const entrada = useRef<HTMLInputElement>(null);

  const pagamentos = alvo.pagamentos.map((p) => ({
    data: p.data,
    valor: paraCentavos(p.valor),
    principal: paraCentavos(p.principal),
    multa: paraCentavos(p.multa),
    juros: paraCentavos(p.juros),
    desconto: paraCentavos(p.desconto),
  }));
  const sit = situacaoFatura(
    { valorTotal: paraCentavos(alvo.valorTotal), vencimento: alvo.vencimento },
    pagamentos,
    { multaPct: alvo.multaPct, jurosMesPct: alvo.jurosMesPct, carenciaDias: alvo.carenciaDias },
    data,
    { pct: alvo.pontualidadePct, aluguel: paraCentavos(alvo.aluguel) },
  );
  const multa = cobrarMulta ? lerReais(multaTxt) : 0;
  const juros = cobrarJuros ? lerReais(jurosTxt) : 0;
  const desconto = descontoTxt === null ? sit.descontoPontualidade : lerReais(descontoTxt);
  const totalDevido = Math.max(0, sit.saldo + multa + juros - desconto);
  const valor = valorTxt === null ? totalDevido : lerReais(valorTxt);
  const an = analisarRecebimento(sit.saldo, { valor, multa, juros, desconto });
  const rotuloDesconto =
    desconto > 0 && desconto === sit.descontoPontualidade ? `Desconto de pontualidade (${alvo.pontualidadePct}%)` : desconto > 0 ? "Desconto concedido" : null;

  const mudarData = (d: string) => {
    setData(d || hoje);
    // Nova data = novas sugestões (os valores só entram se continuarem aplicados).
    setMultaTxt("");
    setJurosTxt("");
    setCobrarMulta(false);
    setCobrarJuros(false);
    setDescontoTxt(null);
    setValorTxt(null);
  };

  const confirmar = () => {
    if (an.erro) return setErro(an.erro);
    setErro("");
    iniciar(async () => {
      const r = await receberAluguel({
        faturaId: alvo.faturaId,
        contratoId: alvo.contratoId,
        competencia: alvo.competencia,
        pagoEm: data,
        valor: paraReais(valor),
        multa: paraReais(multa),
        juros: paraReais(juros),
        desconto: paraReais(desconto),
        forma,
        contaId: conta || null,
        observacao: obs.trim() || null,
        rotuloDesconto,
        valorEsperado: alvo.faturaId ? undefined : alvo.valorTotal,
      });
      if (!r.ok || !r.faturaId) {
        setErro(r.erro ?? "Não foi possível registrar o recebimento.");
        return;
      }
      if (arquivo) {
        try {
          const caminho = await enviarComprovante(opcoes.organizacaoId, r.faturaId, arquivo);
          const s = await salvarComprovante(r.faturaId, caminho, r.pagamentoId ?? null);
          if (!s.ok) throw new Error(s.erro);
        } catch (e) {
          aoFechar();
          window.alert(`O recebimento foi registrado, mas o comprovante não foi anexado: ${e instanceof Error ? e.message : "erro"}. Anexe de novo na ficha da cobrança.`);
          return;
        }
      }
      aoFechar();
    });
  };

  return (
    <Fundo aoFechar={aoFechar} ocupado={pendente}>
      <div role="dialog" aria-modal="true" aria-label="Receber aluguel" className="janela my-6 w-full max-w-lg rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]">
        <div className="mb-5 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[10px] border border-ok-bd bg-ok-bg text-ok">
            <CircleDollarSign className="size-[18px]" />
          </span>
          <div className="min-w-0">
            <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-texto">Receber aluguel</h3>
            <p className="truncate text-xs text-mudo">
              {alvo.titulo} · {alvo.subtitulo}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1.5">
            <span className={rotulo}>Pago em</span>
            <input type="date" value={data} max={hoje} onChange={(e) => mudarData(e.target.value)} className={campo} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={rotulo}>Forma</span>
            <select value={forma} onChange={(e) => setForma(e.target.value)} className={campo}>
              {Object.entries(FORMAS_RECEBIMENTO).map(([k, r]) => (
                <option key={k} value={k}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          {opcoes.contas.length > 0 && (
            <label className="col-span-2 flex flex-col gap-1.5">
              <span className={rotulo}>Conta onde o dinheiro entrou</span>
              <select value={conta} onChange={(e) => setConta(e.target.value)} className={campo}>
                <option value="">— não informar —</option>
                {opcoes.contas.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        <div className="mt-4 space-y-2 rounded-[14px] border border-borda bg-elev px-4 py-3 text-sm">
          <div className="flex justify-between text-texto-2">
            <span>Aluguel em aberto (vence {formatarDataBR(alvo.vencimento)})</span>
            <span className="tabular-nums">{formatarReais(paraReais(sit.saldo))}</span>
          </div>
          {sit.abatido > 0 && (
            <div className="flex justify-between text-xs text-mudo">
              <span>Já recebido antes</span>
              <span className="tabular-nums">{formatarReais(paraReais(sit.recebido))}</span>
            </div>
          )}

          {sit.diasAtraso > 0 && (
            <>
              <LinhaEncargo
                titulo={`Multa (${alvo.multaPct}%)`}
                sugestao={sit.multa}
                ativo={cobrarMulta}
                texto={multaTxt}
                aoTexto={setMultaTxt}
                aoLigar={() => {
                  setCobrarMulta(true);
                  setMultaTxt(paraTexto(sit.multa));
                  setValorTxt(null);
                }}
                aoDesligar={() => {
                  setCobrarMulta(false);
                  setValorTxt(null);
                }}
                vazio={sit.multaCobrada > 0 ? "multa já cobrada num recebimento anterior" : undefined}
              />
              <LinhaEncargo
                titulo={`Juros (${alvo.jurosMesPct}% ao mês · ${sit.diasJuros} dia${sit.diasJuros === 1 ? "" : "s"})`}
                sugestao={sit.juros}
                ativo={cobrarJuros}
                texto={jurosTxt}
                aoTexto={setJurosTxt}
                aoLigar={() => {
                  setCobrarJuros(true);
                  setJurosTxt(paraTexto(sit.juros));
                  setValorTxt(null);
                }}
                aoDesligar={() => {
                  setCobrarJuros(false);
                  setValorTxt(null);
                }}
              />
            </>
          )}

          <div className="flex items-center justify-between gap-3">
            <span className="text-texto-2">{sit.descontoPontualidade > 0 && descontoTxt === null ? `Desconto de pontualidade (${alvo.pontualidadePct}%)` : "Desconto (opcional)"}</span>
            <input
              aria-label="Desconto em reais"
              inputMode="decimal"
              value={descontoTxt ?? paraTexto(sit.descontoPontualidade)}
              onChange={(e) => {
                setDescontoTxt(e.target.value);
                setValorTxt(null);
              }}
              placeholder="0,00"
              className="h-9 w-28 rounded-[9px] border border-borda-forte bg-input px-2 text-right text-sm tabular-nums text-texto"
            />
          </div>

          <div className="flex justify-between border-t border-borda pt-2 text-[15px] font-semibold text-texto">
            <span>Total a receber</span>
            <span className="tabular-nums">{formatarReais(paraReais(totalDevido))}</span>
          </div>
        </div>

        {sit.diasAtraso > 0 && !cobrarMulta && !cobrarJuros && (
          <p className="mt-2 flex items-start gap-1.5 text-xs text-alerta">
            <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
            {sit.diasAtraso} dia(s) de atraso. Multa e juros só entram se você clicar em “Cobrar”.
          </p>
        )}

        <label className="mt-4 flex flex-col gap-1.5">
          <span className={rotulo}>Valor recebido (R$)</span>
          <input inputMode="decimal" value={valorTxt ?? paraTexto(totalDevido)} onChange={(e) => setValorTxt(e.target.value)} className={campo} />
          <span className="text-xs text-mudo">Se recebeu menos, fica registrado como pagamento parcial e o resto continua em aberto.</span>
        </label>

        <div
          className={`mt-3 rounded-[14px] border px-4 py-2.5 text-sm font-medium ${
            an.erro ? "border-ruim-bd bg-ruim-bg text-ruim" : an.quita ? "border-ok-bd bg-ok-bg text-ok" : "border-alerta-bd bg-alerta-bg text-alerta"
          }`}
        >
          {an.erro ? an.erro : an.quita ? "Quita a cobrança." : `Pagamento parcial: fica faltando ${formatarReais(paraReais(an.falta))} do aluguel.`}
        </div>

        <details className="mt-4">
          <summary className="cursor-pointer text-sm font-medium text-acento">Comprovante e observação (opcional)</summary>
          <div className="mt-3 space-y-3">
            <input
              ref={entrada}
              type="file"
              accept={TIPOS_COMPROVANTE.join(",")}
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                e.target.value = "";
                if (!f) return;
                if (!TIPOS_COMPROVANTE.includes(f.type)) return setErro("Envie uma imagem (JPG, PNG) ou PDF.");
                if (f.size > TAMANHO_MAX_COMPROVANTE) return setErro("O arquivo passa de 10 MB.");
                setErro("");
                setArquivo(f);
              }}
            />
            {arquivo ? (
              <div className="flex items-center gap-3 rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-2.5 text-sm">
                <Paperclip className="size-4 shrink-0 text-ok" />
                <span className="min-w-0 flex-1 truncate text-texto">{arquivo.name}</span>
                <button type="button" onClick={() => setArquivo(null)} aria-label="Remover comprovante" className="grid size-7 place-items-center rounded-lg text-mudo hover:text-ruim">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <button type="button" onClick={() => entrada.current?.click()} className={classeBotao("secundario", "sm")}>
                <Upload className="size-3.5" /> Anexar comprovante
              </button>
            )}
            <input value={obs} onChange={(e) => setObs(e.target.value)} placeholder="Observação (ex.: pagou em duas vezes)" aria-label="Observação" className={campo} />
          </div>
        </details>

        {erro && <div className="mt-3 rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}

        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" className={classeBotao("secundario")} onClick={aoFechar} disabled={pendente}>
            Cancelar
          </button>
          <button type="button" className={classeBotao("primario")} onClick={confirmar} disabled={pendente || Boolean(an.erro)}>
            {pendente ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
            {pendente ? "Registrando…" : an.quita ? `Confirmar recebimento de ${formatarReais(paraReais(valor))}` : `Registrar parcial de ${formatarReais(paraReais(valor))}`}
          </button>
        </div>
      </div>
    </Fundo>
  );
}

function LinhaEncargo({
  titulo,
  sugestao,
  ativo,
  texto,
  aoTexto,
  aoLigar,
  aoDesligar,
  vazio,
}: {
  titulo: string;
  sugestao: number;
  ativo: boolean;
  texto: string;
  aoTexto: (t: string) => void;
  aoLigar: () => void;
  aoDesligar: () => void;
  vazio?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="text-texto-2">
        {titulo}
        <span className="block text-xs text-mudo">{vazio ?? `sugestão pelo contrato: ${formatarReais(paraReais(sugestao))}`}</span>
      </span>
      {ativo ? (
        <span className="flex items-center gap-1.5">
          <input
            autoFocus
            aria-label={titulo}
            inputMode="decimal"
            value={texto}
            onChange={(e) => aoTexto(e.target.value)}
            className="h-9 w-28 rounded-[9px] border border-borda-forte bg-input px-2 text-right text-sm tabular-nums text-ruim"
          />
          <button type="button" onClick={aoDesligar} className="text-xs text-mudo hover:text-ruim hover:underline">
            tirar
          </button>
        </span>
      ) : (
        <button type="button" onClick={aoLigar} disabled={sugestao <= 0} className={classeBotao("secundario", "sm")}>
          + Cobrar
        </button>
      )}
    </div>
  );
}

/** Botão que abre a janela de recebimento. */
export function BotaoReceber({
  alvo,
  opcoes,
  children,
  variante = "primario",
  tamanho = "md",
}: {
  alvo: AlvoRecebimento;
  opcoes: OpcoesRecebimento;
  children: ReactNode;
  variante?: VarianteBotao;
  tamanho?: "md" | "sm";
}) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button
        type="button"
        className={classeBotao(variante, tamanho)}
        onClick={(e) => {
          e.stopPropagation();
          setAberta(true);
        }}
      >
        {children}
      </button>
      {aberta && <JanelaRecebimento alvo={alvo} opcoes={opcoes} aoFechar={() => setAberta(false)} />}
    </>
  );
}

/** Dados da confirmação de "Desfazer" (o último recebimento e o que continua registrado), em reais. */
export interface PropsDesfazer {
  faturaId: string;
  titulo: string;
  /** Valor do último recebimento — é só ele que sai. */
  valor: number;
  /** Data do último recebimento. */
  pagoEm: string | null;
  /** Soma dos recebimentos anteriores, que continuam registrados. */
  restante?: number;
  /** Quantos recebimentos anteriores continuam. */
  outros?: number;
  pessoal: boolean;
}

/**
 * Confirmação explícita para desfazer a baixa: mostra quem, quanto e quando
 * (o ÚLTIMO recebimento, que é o que sai), o que continua registrado, o que
 * sai junto (repasse pendente, taxa, lançamento) e só desfaz no botão
 * vermelho. "Cancelar" é o padrão (foco).
 */
export function JanelaDesfazer({ faturaId, titulo, valor, pagoEm, restante = 0, outros = 0, pessoal, aoFechar }: PropsDesfazer & { aoFechar: () => void }) {
  const [pendente, iniciar] = useTransition();
  const [erro, setErro] = useState("");
  return (
    <Fundo aoFechar={aoFechar} ocupado={pendente}>
      <div role="alertdialog" aria-modal="true" aria-label="Desfazer recebimento" className="janela my-6 w-full max-w-md rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]">
        <div className="mb-4 flex items-center gap-3">
          <span className="flex size-9 items-center justify-center rounded-[10px] border border-ruim-bd bg-ruim-bg text-ruim">
            <Undo2 className="size-[18px]" />
          </span>
          <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-texto">Desfazer o recebimento?</h3>
        </div>
        <p className="text-[14.5px] leading-relaxed text-texto">
          {titulo}: sai {outros > 0 ? "o último recebimento" : "o recebimento"} — <strong className="tabular-nums">{formatarReais(valor)}</strong> recebido em{" "}
          <strong>{formatarDataBR(pagoEm)}</strong>.
        </p>
        {outros > 0 && (
          <p className="mt-2 rounded-[12px] border border-borda bg-elev px-3 py-2 text-sm text-texto-2">
            Continua registrado: <strong className="tabular-nums text-texto">{formatarReais(restante)}</strong> em {outros} recebimento{outros === 1 ? "" : "s"} anterior
            {outros === 1 ? "" : "es"} (pagamento parcial). Para desfazer esse{outros === 1 ? "" : "s"} também, use a aba Recebimentos da cobrança.
          </p>
        )}
        <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-texto-2">
          <li>O aluguel volta para “em aberto”{outros > 0 ? " (com o saldo que este recebimento tinha quitado)" : ""}.</li>
          {pessoal ? (
            <li>O lançamento deste recebimento no Financeiro é apagado.</li>
          ) : (
            <li>O repasse ainda não pago ao proprietário e a taxa da imobiliária são apagados (voltam quando a cobrança for quitada de novo).</li>
          )}
          <li>Multa, juros e descontos lançados na quitação saem da fatura.</li>
        </ul>
        <p className="mt-3 text-xs text-mudo">Use só se o dinheiro não entrou ou se a baixa foi feita por engano. Tudo fica registrado no histórico da cobrança.</p>
        {erro && <div className="mt-3 rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
        <div className="mt-6 flex flex-wrap justify-end gap-2">
          <button type="button" autoFocus className={classeBotao("secundario")} onClick={aoFechar} disabled={pendente}>
            Cancelar
          </button>
          <button
            type="button"
            className={classeBotao("perigo")}
            disabled={pendente}
            onClick={() =>
              iniciar(async () => {
                const r = await desfazerBaixa(faturaId);
                if (!r.ok) setErro(r.erro ?? "Não foi possível desfazer.");
                else aoFechar();
              })
            }
          >
            {pendente ? <LoaderCircle className="size-4 animate-spin" /> : <Undo2 className="size-4" />}
            {pendente ? "Desfazendo…" : `Sim, desfazer ${formatarReais(valor)}`}
          </button>
        </div>
      </div>
    </Fundo>
  );
}

export function BotaoDesfazer(props: PropsDesfazer & { rotulo?: string }) {
  const [aberta, setAberta] = useState(false);
  return (
    <>
      <button
        type="button"
        className={classeBotao("fantasma", "sm")}
        onClick={(e) => {
          e.stopPropagation();
          setAberta(true);
        }}
      >
        <Undo2 className="size-3.5" /> {props.rotulo ?? "Desfazer"}
      </button>
      {aberta && <JanelaDesfazer {...props} aoFechar={() => setAberta(false)} />}
    </>
  );
}
