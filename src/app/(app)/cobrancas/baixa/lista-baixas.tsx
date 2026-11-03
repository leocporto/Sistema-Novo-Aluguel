"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, FileUp, LoaderCircle } from "lucide-react";
import { Selo, classeBotao } from "@/components/ui";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { analisarArquivoRetorno, confirmarBaixasAutomaticas } from "../actions";
import type { SugestaoBaixa } from "../dados";

/** Lista de entradas que casaram com cobranças: o usuário confere, desmarca o que não quer e confirma de uma vez. */
export function ListaBaixas({ sugestoes, origem }: { sugestoes: SugestaoBaixa[]; origem: "extrato" | "arquivo" }) {
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set(sugestoes.map((s) => s.chave)));
  const [resultado, setResultado] = useState<{ feitos: number; erros: string[] } | null>(null);
  const [pendente, iniciar] = useTransition();
  const escolhidas = sugestoes.filter((s) => marcadas.has(s.chave));
  const total = escolhidas.reduce((a, s) => a + Math.round(s.valor * 100), 0) / 100;

  if (!sugestoes.length) return <p className="text-sm text-mudo">Nenhuma entrada de dinheiro casou com cobranças em aberto.</p>;
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-borda-suave rounded-card border border-borda">
        {sugestoes.map((s) => (
          <li key={s.chave} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-4 py-3">
            <label className="flex min-w-[260px] flex-1 items-start gap-3 text-sm">
              <input
                type="checkbox"
                className="mt-1 size-4"
                checked={marcadas.has(s.chave)}
                aria-label={`Incluir ${s.locatario}`}
                onChange={(e) =>
                  setMarcadas((m) => {
                    const n = new Set(m);
                    if (e.target.checked) n.add(s.chave);
                    else n.delete(s.chave);
                    return n;
                  })
                }
              />
              <span>
                <span className="font-medium text-texto">
                  {formatarDataBR(s.data)} · {formatarReais(s.valor)}
                </span>
                <span className="block text-xs text-mudo">
                  {s.descricao}
                  {s.conta ? ` · ${s.conta}` : ""}
                </span>
              </span>
            </label>
            <span className="min-w-[220px] flex-1 text-sm">
              <Link href={s.href} className="font-medium text-texto hover:text-acento">
                {s.titulo}
              </Link>
              <span className="block text-xs text-mudo">
                {s.tipo === "parcela" ? `${s.locatario} · ` : ""}
                {s.imovel} · venc. {formatarDataBR(s.vencimento)} · {s.tipo === "parcela" ? "parcela" : "saldo"} {formatarReais(s.saldo)}
              </span>
            </span>
            <span className="flex flex-wrap items-center gap-1.5">
              <Selo cor={s.confianca === "alta" ? "verde" : "amarelo"}>{s.motivo}</Selo>
              <Selo cor={s.efeito === "quita" ? "azul" : "amarelo"}>{s.efeito === "quita" ? "quita" : "parcial"}</Selo>
            </span>
          </li>
        ))}
      </ul>
      {resultado && (
        <div className={`rounded-[14px] border px-4 py-3 text-sm ${resultado.erros.length ? "border-alerta-bd bg-alerta-bg" : "border-ok-bd bg-ok-bg text-ok"}`}>
          {resultado.feitos} baixa(s) feita(s).
          {resultado.erros.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-texto">
              {resultado.erros.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-mudo">
          Valor acima do saldo vira multa e juros (até o que o contrato prevê). Valor menor vira pagamento parcial. Parcela de acordo só é baixada com o valor exato dela.
        </span>
        <button
          type="button"
          disabled={pendente || !escolhidas.length}
          className={classeBotao("primario")}
          onClick={() => {
            if (!window.confirm(`Dar baixa em ${escolhidas.length} cobrança(s), total ${formatarReais(total)}? Cada uma fica registrada como recebida na data da entrada.`)) return;
            iniciar(async () => {
              const r = await confirmarBaixasAutomaticas(
                escolhidas.map((s) => ({
                  tipo: s.tipo,
                  faturaId: s.faturaId,
                  parcelaId: s.parcelaId,
                  data: s.data,
                  valor: s.valor,
                  extratoItemId: s.extratoItemId,
                  contaId: s.contaId,
                  chaveBaixa: s.chaveBaixa,
                  origem,
                })),
              );
              setResultado({ feitos: r.feitos, erros: r.erros });
            });
          }}
        >
          {pendente ? <LoaderCircle className="size-4 animate-spin" /> : <Check className="size-4" />}
          {pendente ? "Dando baixa…" : `Dar baixa em ${escolhidas.length} (${formatarReais(total)})`}
        </button>
      </div>
    </div>
  );
}

/** Colar um arquivo de retorno ou extrato (OFX/CSV) e ver as cobranças que ele paga. */
export function ColarArquivo({ contas }: { contas: { id: string; nome: string }[] }) {
  const [texto, setTexto] = useState("");
  const [conta, setConta] = useState("");
  const [res, setRes] = useState<{ itens: SugestaoBaixa[]; entradas: number; jaBaixadas: number } | null>(null);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <label className={classeBotao("secundario", "sm")}>
          <FileUp className="size-3.5" /> Escolher arquivo
          <input
            type="file"
            accept=".ofx,.csv,.txt,text/csv,text/plain"
            className="hidden"
            onChange={async (e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) setTexto(await f.text());
            }}
          />
        </label>
        {contas.length > 0 && (
          <select value={conta} onChange={(e) => setConta(e.target.value)} aria-label="Conta do arquivo" className="h-[34px] rounded-[9px] border border-borda-forte bg-input pl-3 pr-8 text-[12.5px] text-texto">
            <option value="">Conta: não informar</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </select>
        )}
      </div>
      <textarea
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        rows={5}
        aria-label="Conteúdo do arquivo"
        placeholder={"Ou cole aqui. Ex.:\ndata;descrição;valor\n05/11/2026;PIX RECEBIDO FAT123 BRUNO;2.150,00"}
        className="w-full rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 font-mono text-[12.5px] text-texto outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg"
      />
      {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      <button
        type="button"
        disabled={pendente || !texto.trim()}
        className={classeBotao("secundario")}
        onClick={() =>
          iniciar(async () => {
            setErro("");
            const r = await analisarArquivoRetorno(texto, conta || null);
            if (!r.ok) setErro(r.erro ?? "Não foi possível ler o arquivo.");
            setRes(r.ok ? { itens: r.itens, entradas: r.entradas, jaBaixadas: r.jaBaixadas } : null);
          })
        }
      >
        {pendente && <LoaderCircle className="size-4 animate-spin" />} Procurar cobranças
      </button>
      {res && (
        <div className="space-y-2">
          <p className="text-sm text-texto-2">
            {res.entradas} entrada(s) de dinheiro no arquivo · {res.itens.length} casaram com cobranças ou parcelas de acordo em aberto.
            {res.jaBaixadas > 0 && ` ${res.jaBaixadas} entrada(s) já tinham dado baixa antes e ficaram de fora (nada é baixado duas vezes).`}
          </p>
          <ListaBaixas key={res.itens.map((i) => i.chave).join(",")} sugestoes={res.itens} origem="arquivo" />
        </div>
      )}
    </div>
  );
}
