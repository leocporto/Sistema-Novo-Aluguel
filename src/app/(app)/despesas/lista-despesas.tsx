"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Check, Paperclip, Pencil, Trash2 } from "lucide-react";
import { Formulario } from "@/components/formulario";
import { classeBotao } from "@/components/ui";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { TIPOS_COMPROVANTE, enviarComprovanteDespesa } from "@/lib/supabase/navegador";
import { atualizarDespesa, excluirDespesa, linkComprovanteDespesa, marcarDespesaPaga, salvarComprovanteDespesa } from "./actions";

export type DespesaLinha = {
  id: string;
  descricao: string;
  categoria: string | null;
  valor: number;
  vencimento: string;
  status: string;
  liquidado_em: string | null;
  imovel_id: string | null;
  imovelCodigo: string | null;
  pessoaNome: string | null;
  serie: boolean;
  comprovante: boolean;
};

/** Lista de despesas com check de pago, comprovante, edição (salva sozinha) e exclusão. */
export function ListaDespesas({
  itens,
  hoje,
  organizacaoId,
  pessoal,
  campos,
}: {
  itens: DespesaLinha[];
  hoje: string;
  organizacaoId: string;
  pessoal: boolean;
  /** Campos do formulário de edição, por despesa (renderizados no servidor). */
  campos: Record<string, ReactNode>;
}) {
  const [, iniciar] = useTransition();
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [editando, setEditando] = useState<string | null>(null);
  const arquivo = useRef<HTMLInputElement>(null);
  const alvoAnexo = useRef<string | null>(null);

  const alternar = (d: DespesaLinha) => {
    if (ocupado) return;
    const pagar = d.status !== "liquidado";
    const confirmar = pagar
      ? `Marcar "${d.descricao}" (${formatarReais(d.valor)}) como paga hoje?`
      : `Desfazer o pagamento de "${d.descricao}" (${formatarReais(d.valor)})? Ela volta a ficar em aberto.`;
    if (!window.confirm(confirmar)) return;
    setOcupado(d.id);
    iniciar(async () => {
      const r = await marcarDespesaPaga(d.id, pagar);
      setOcupado(null);
      if (!r.ok) window.alert(r.erro ?? "Não foi possível salvar.");
    });
  };

  const excluir = (d: DespesaLinha) => {
    let proximas = false;
    if (d.serie) {
      if (!window.confirm(`Excluir "${d.descricao}"?`)) return;
      proximas = window.confirm("Ela se repete todo mês. Excluir também as dos próximos meses?\n\nOK = esta e as próximas · Cancelar = só esta");
    } else if (!window.confirm(`Excluir "${d.descricao}"?`)) return;
    setOcupado(d.id);
    iniciar(async () => {
      const r = await excluirDespesa(d.id, proximas);
      setOcupado(null);
      if (!r.ok) window.alert(r.erro ?? "Não foi possível excluir.");
    });
  };

  const abrirComprovante = (d: DespesaLinha) =>
    iniciar(async () => {
      const r = await linkComprovanteDespesa(d.id);
      if (r.ok && r.url) window.open(r.url, "_blank");
      else window.alert(r.erro ?? "Não foi possível abrir.");
    });

  const anexar = (d: DespesaLinha) => {
    alvoAnexo.current = d.id;
    arquivo.current?.click();
  };

  const aoEscolherArquivo = (f: File | undefined) => {
    const id = alvoAnexo.current;
    if (!f || !id) return;
    setOcupado(id);
    iniciar(async () => {
      try {
        const caminho = await enviarComprovanteDespesa(organizacaoId, id, f);
        const r = await salvarComprovanteDespesa(id, caminho);
        if (!r.ok) window.alert(r.erro);
      } catch (e) {
        window.alert(e instanceof Error ? e.message : "Não foi possível enviar.");
      } finally {
        setOcupado(null);
        if (arquivo.current) arquivo.current.value = "";
      }
    });
  };

  if (itens.length === 0)
    return <div className="rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">Nenhuma despesa neste mês.</div>;

  const atual = itens.find((i) => i.id === editando);

  return (
    <>
      <input ref={arquivo} type="file" accept={TIPOS_COMPROVANTE.join(",")} className="hidden" onChange={(e) => aoEscolherArquivo(e.target.files?.[0])} />
      <ul className="entrar divide-y divide-borda-suave overflow-hidden rounded-card border border-borda bg-card">
        {itens.map((d) => {
          const pago = d.status === "liquidado";
          const vencida = !pago && d.vencimento < hoje;
          return (
            <li key={d.id} className={`flex flex-wrap items-center gap-3 px-4 py-3 transition ${ocupado === d.id ? "opacity-50" : ""}`}>
              <button
                type="button"
                role="checkbox"
                aria-checked={pago}
                aria-label={pago ? `Desfazer pagamento: ${d.descricao}` : `Marcar como paga: ${d.descricao}`}
                onClick={() => alternar(d)}
                disabled={ocupado === d.id}
                className={`grid size-8 shrink-0 place-items-center rounded-[10px] border-2 transition ${pago ? "border-ok bg-ok text-white" : "border-borda-forte text-transparent hover:border-ok hover:text-ok"}`}
              >
                <Check className="size-4" strokeWidth={3} />
              </button>
              <button type="button" onClick={() => setEditando(d.id)} className="min-w-0 flex-1 text-left">
                <div className={`font-medium ${pago ? "text-texto-2" : "text-texto"}`}>{d.descricao}</div>
                <div className="text-xs text-mudo">
                  {d.categoria ?? "Sem categoria"}
                  {pessoal && d.imovelCodigo ? ` · ${d.imovelCodigo}` : ""}
                  {d.pessoaNome ? ` · ${d.pessoaNome}` : ""}
                </div>
              </button>
              <div className="w-28 text-right">
                <div className="font-semibold tabular-nums text-texto">{formatarReais(d.valor)}</div>
                <div className={`text-xs ${pago ? "text-ok" : vencida ? "font-semibold text-ruim" : "text-mudo"}`}>
                  {pago ? `pago ${formatarDataBR(d.liquidado_em)}` : vencida ? `venceu ${formatarDataBR(d.vencimento)}` : `vence ${formatarDataBR(d.vencimento)}`}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {d.comprovante ? (
                  <button type="button" onClick={() => abrirComprovante(d)} className={classeBotao("fantasma", "sm")} title="Ver comprovante">
                    <Paperclip className="size-3.5" /> Ver
                  </button>
                ) : (
                  <button type="button" onClick={() => anexar(d)} className={classeBotao("fantasma", "sm")} title="Anexar comprovante">
                    <Paperclip className="size-3.5" /> Anexar
                  </button>
                )}
                <button type="button" onClick={() => setEditando(d.id)} title="Editar" aria-label="Editar" className="grid size-8 place-items-center rounded-[9px] text-mudo hover:bg-card-hover hover:text-texto">
                  <Pencil className="size-4" />
                </button>
                <button type="button" onClick={() => excluir(d)} title="Excluir" aria-label="Excluir" className="grid size-8 place-items-center rounded-[9px] text-mudo hover:bg-ruim-bg hover:text-ruim">
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {atual &&
        createPortal(
          <div
            className="janela-fundo fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px] sm:items-center"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget) setEditando(null);
            }}
          >
            <div role="dialog" aria-modal="true" aria-label="Editar despesa" className="janela my-6 w-full max-w-lg rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]">
              <h3 className="mb-5 text-[17px] font-semibold tracking-[-0.01em] text-texto">Editar despesa</h3>
              <Formulario key={atual.id} acao={atualizarDespesa} automatico className="space-y-4">
                {campos[atual.id]}
              </Formulario>
              <div className="mt-4 flex justify-end">
                <button type="button" className={classeBotao("primario")} onClick={() => setEditando(null)}>
                  Fechar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
