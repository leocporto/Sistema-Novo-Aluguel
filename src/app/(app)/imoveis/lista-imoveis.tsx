"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Copy, ImageIcon, Trash2 } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_STATUS_IMOVEL } from "@/lib/tipos";
import { acaoEmMassa, type AcaoMassa } from "./actions";

export type LinhaImovel = {
  id: string;
  codigo: string;
  endereco: string;
  regiao: string;
  tipo: string;
  proprietarios: string;
  valor_aluguel: number | null;
  valor_venda: number | null;
  status: string;
  capa: string | null;
  exclusivo: boolean;
  bairro: string | null;
  cidade: string | null;
  quartos: number | null;
  vagas: number | null;
  area: number | null;
};

const COR = {
  disponivel: "bg-ruim-bg text-ruim border-ruim-bd",
  alugado: "bg-ok-bg text-ok border-ok-bd",
  reservado: "bg-alerta-bg text-alerta border-alerta-bd",
  vendido: "bg-elev text-mudo border-borda",
  inativo: "bg-elev text-mudo border-borda",
} as const;

const sel = "min-h-[34px] rounded-[9px] border border-borda-forte bg-input px-2 text-[12.5px] text-texto";

/** Tabela de imóveis com seleção e ações em massa. */
export function ListaImoveis({
  itens,
  pessoal,
  visual = "lista",
  corretores,
  empreendimentos,
}: {
  itens: LinhaImovel[];
  pessoal: boolean;
  /** "lista" (tabela) ou "cartoes" (fotos grandes, estilo feed). */
  visual?: "lista" | "cartoes";
  corretores: { id: string; nome: string }[];
  empreendimentos: { id: string; nome: string }[];
}) {
  const router = useRouter();
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [pct, setPct] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; texto: string } | null>(null);
  const [rodando, iniciar] = useTransition();
  const ids = useMemo(() => itens.map((i) => i.id), [itens]);
  const todos = marcados.size > 0 && ids.every((id) => marcados.has(id));

  const alternar = (id: string) =>
    setMarcados((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const executar = (acao: AcaoMassa, confirmar?: string) => {
    if (confirmar && !window.confirm(confirmar)) return;
    setMsg(null);
    iniciar(async () => {
      const r = await acaoEmMassa([...marcados], acao);
      if (r.ok) {
        setMsg({ ok: !r.erro, texto: r.erro ?? `Pronto: ${r.feitos} imóvel(is) atualizado(s).` });
        if (acao.tipo === "excluir" || acao.tipo === "duplicar") setMarcados(new Set());
      } else setMsg({ ok: false, texto: r.erro ?? "Não foi possível concluir." });
    });
  };

  const n = marcados.size;

  return (
    <>
      {n > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-card border border-acento-bd bg-card p-3 shadow-lg">
          <span className="mr-1 text-sm font-semibold text-texto">{n} selecionado(s)</span>
          <select className={sel} defaultValue="" disabled={rodando} onChange={(e) => {
              if (e.target.value) executar({ tipo: "status", valor: e.target.value });
              e.target.value = "";
            }}
            aria-label="Mudar situação"
          >
            <option value="">Mudar situação…</option>
            {Object.entries(ROTULO_STATUS_IMOVEL).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          <select
            className={sel}
            defaultValue=""
            disabled={rodando}
            onChange={(e) => {
              const [tipo, valor] = e.target.value.split(":");
              if (tipo) executar({ tipo: tipo as "finalidade_add" | "finalidade_remover", valor });
              e.target.value = "";
            }}
            aria-label="Finalidade"
          >
            <option value="">Finalidade…</option>
            <option value="finalidade_add:locacao">+ Locação</option>
            <option value="finalidade_add:venda">+ Venda</option>
            <option value="finalidade_add:temporada">+ Temporada</option>
            <option value="finalidade_remover:locacao">− Locação</option>
            <option value="finalidade_remover:venda">− Venda</option>
            <option value="finalidade_remover:temporada">− Temporada</option>
          </select>
          <span className="flex items-center gap-1">
            <input
              value={pct}
              onChange={(e) => setPct(e.target.value)}
              placeholder="% ex. 5"
              inputMode="decimal"
              className={`${sel} w-20`}
              aria-label="Percentual de reajuste"
            />
            <button
              type="button"
              disabled={rodando || !pct}
              className={classeBotao("secundario", "sm")}
              onClick={() => {
                const v = Number(pct.replace(",", "."));
                if (!Number.isFinite(v) || !v) return setMsg({ ok: false, texto: "Digite o percentual (use negativo para baixar)." });
                executar({ tipo: "reajuste", pct: v, campos: ["valor_aluguel", "valor_venda"] }, `Reajustar aluguel e venda de ${n} imóvel(is) em ${v}%?`);
              }}
            >
              Reajustar valores
            </button>
          </span>
          {!pessoal && (
            <>
              <select
                className={sel}
                defaultValue=""
                disabled={rodando}
                onChange={(e) => {
                  if (e.target.value) executar({ tipo: "corretor", valor: e.target.value === "-" ? null : e.target.value });
                  e.target.value = "";
                }}
                aria-label="Corretor"
              >
                <option value="">Corretor…</option>
                <option value="-">— tirar corretor —</option>
                {corretores.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
              <select
                className={sel}
                defaultValue=""
                disabled={rodando}
                onChange={(e) => {
                  if (e.target.value) executar({ tipo: "empreendimento", valor: e.target.value === "-" ? null : e.target.value });
                  e.target.value = "";
                }}
                aria-label="Empreendimento"
              >
                <option value="">Empreendimento…</option>
                <option value="-">— nenhum —</option>
                {empreendimentos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nome}
                  </option>
                ))}
              </select>
            </>
          )}
          <button type="button" disabled={rodando} className={classeBotao("secundario", "sm")} onClick={() => executar({ tipo: "duplicar" }, `Duplicar ${n} imóvel(is)?`)}>
            <Copy className="size-3.5" /> Duplicar
          </button>
          <button
            type="button"
            disabled={rodando}
            className={classeBotao("fantasma", "sm")}
            onClick={() => executar({ tipo: "excluir" }, `Excluir ${n} imóvel(is) com fotos e documentos? Imóveis com contrato não são excluídos.`)}
          >
            <Trash2 className="size-3.5" /> Excluir
          </button>
          <button type="button" className="ml-auto text-xs text-mudo hover:underline" onClick={() => setMarcados(new Set())}>
            limpar seleção
          </button>
        </div>
      )}
      {msg && (
        <div className={`mb-3 rounded-[14px] border px-4 py-2.5 text-sm ${msg.ok ? "border-ok-bd bg-ok-bg text-ok" : "border-ruim-bd bg-ruim-bg text-ruim"}`}>{msg.texto}</div>
      )}

      {visual === "cartoes" ? (
        itens.length === 0 ? (
          <div className="rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">Nenhum imóvel encontrado.</div>
        ) : (
          <ul className="entrar-cascata grid grid-cols-1 gap-x-5 gap-y-7 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {itens.map((i) => {
              const marcado = marcados.has(i.id);
              const detalhes = [
                i.quartos ? `${i.quartos} ${i.quartos === 1 ? "quarto" : "quartos"}` : null,
                i.vagas ? `${i.vagas} ${i.vagas === 1 ? "vaga" : "vagas"}` : null,
                i.area ? `${Number(i.area).toLocaleString("pt-BR")} m²` : null,
              ].filter(Boolean);
              return (
                <li key={i.id}>
                  <div
                    role="link"
                    tabIndex={0}
                    onMouseEnter={() => router.prefetch(`/imoveis/${i.id}`)}
                    onClick={(e) => {
                      if ((e.target as HTMLElement).closest("button, input, label")) return;
                      router.push(`/imoveis/${i.id}`);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && router.push(`/imoveis/${i.id}`)}
                    className="group block cursor-pointer"
                  >
                    <div
                      className={`relative aspect-square overflow-hidden rounded-[18px] bg-elev ${marcado ? "ring-4 ring-acento" : ""}`}
                    >
                      {i.capa ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.capa} alt={i.codigo} loading="lazy" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />
                      ) : (
                        <div className="grid size-full place-items-center text-mudo">
                          <div className="flex flex-col items-center gap-2 text-xs">
                            <ImageIcon className="size-8" />
                            sem foto
                          </div>
                        </div>
                      )}
                      <span
                        className={`absolute left-3 top-3 rounded-full border px-2.5 py-1 text-[11.5px] font-semibold shadow-sm backdrop-blur ${COR[i.status as keyof typeof COR] ?? COR.inativo}`}
                      >
                        {ROTULO_STATUS_IMOVEL[i.status] ?? i.status}
                      </span>
                      {!pessoal && i.exclusivo && (
                        <span className="absolute bottom-3 left-3 rounded-full bg-card/90 px-2.5 py-1 text-[11px] font-semibold text-acento-hot shadow-sm">exclusivo</span>
                      )}
                      <label
                        className="absolute right-3 top-3 grid size-8 cursor-pointer place-items-center rounded-full bg-card/90 shadow-sm"
                        title="Selecionar"
                      >
                        <input type="checkbox" aria-label={`Selecionar ${i.codigo}`} checked={marcado} onChange={() => alternar(i.id)} />
                      </label>
                    </div>
                    <div className="mt-2.5 px-0.5">
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-[15px] font-semibold capitalize text-texto">
                          {i.tipo}
                          {i.bairro ? ` · ${i.bairro}` : i.cidade ? ` · ${i.cidade}` : ""}
                        </span>
                        <span className="shrink-0 text-xs font-medium text-mudo">{i.codigo}</span>
                      </div>
                      <div className="truncate text-[13.5px] text-texto-2">{i.endereco || "Sem endereço"}</div>
                      {detalhes.length > 0 && <div className="text-[13px] text-mudo">{detalhes.join(" · ")}</div>}
                      <div className="mt-1 text-[14px] text-texto">
                        {i.valor_aluguel ? (
                          <>
                            <strong className="font-semibold">{formatarReais(i.valor_aluguel)}</strong>
                            <span className="text-mudo"> /mês</span>
                          </>
                        ) : null}
                        {i.valor_venda ? (
                          <span className={i.valor_aluguel ? "ml-2 text-[13px] text-mudo" : ""}>
                            {i.valor_aluguel ? "venda " : ""}
                            <strong className={i.valor_aluguel ? "font-medium" : "font-semibold"}>{formatarReais(i.valor_venda)}</strong>
                          </span>
                        ) : null}
                        {!i.valor_aluguel && !i.valor_venda && <span className="text-mudo">Sem valor</span>}
                      </div>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )
      ) : (
      <div className="entrar overflow-x-auto rounded-card border border-borda bg-card">
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="border-b border-borda text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
              <th className="w-10 px-4 py-3">
                <input
                  type="checkbox"
                  aria-label="Selecionar todos"
                  checked={todos}
                  onChange={() => setMarcados(todos ? new Set() : new Set(ids))}
                />
              </th>
              <th className="px-2 py-3">Imóvel</th>
              <th className="px-3 py-3">Tipo</th>
              {!pessoal && <th className="px-3 py-3">Proprietário(s)</th>}
              <th className="px-3 py-3">Valor</th>
              <th className="px-3 py-3">Situação</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-borda-suave">
            {itens.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-mudo">
                  Nenhum imóvel encontrado.
                </td>
              </tr>
            )}
            {itens.map((i) => (
              <tr
                key={i.id}
                className={`cursor-pointer transition hover:bg-card-hover ${marcados.has(i.id) ? "bg-acento-bg" : ""}`}
                onMouseEnter={() => router.prefetch(`/imoveis/${i.id}`)}
                onClick={(e) => {
                  if ((e.target as HTMLElement).closest("a, button, input, select, label")) return;
                  router.push(`/imoveis/${i.id}`);
                }}
              >
                <td className="px-4 py-2.5">
                  <input type="checkbox" aria-label={`Selecionar ${i.codigo}`} checked={marcados.has(i.id)} onChange={() => alternar(i.id)} />
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-3">
                    <span className="grid size-11 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-borda bg-elev text-mudo">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      {i.capa ? <img src={i.capa} alt="" className="size-full object-cover" loading="lazy" /> : <ImageIcon className="size-4" />}
                    </span>
                    <div className="min-w-0">
                      <div className="font-semibold text-acento">
                        {i.codigo}
                        {!pessoal && i.exclusivo && <span className="ml-2 rounded-full bg-acento-bg px-1.5 py-0.5 text-[10px] font-semibold text-acento-hot">exclusivo</span>}
                      </div>
                      <div className="truncate text-texto">{i.endereco || "—"}</div>
                      <div className="text-xs text-mudo">{i.regiao}</div>
                    </div>
                  </div>
                </td>
                <td className="px-3 py-2.5 capitalize">{i.tipo}</td>
                {!pessoal && <td className="px-3 py-2.5">{i.proprietarios || "—"}</td>}
                <td className="px-3 py-2.5 tabular-nums">
                  {i.valor_aluguel ? <div>{formatarReais(i.valor_aluguel)}<span className="text-xs text-mudo">/mês</span></div> : null}
                  {i.valor_venda ? <div className="text-xs text-texto-2">venda {formatarReais(i.valor_venda)}</div> : null}
                  {!i.valor_aluguel && !i.valor_venda && "—"}
                </td>
                <td className="px-3 py-2.5">
                  <span className={`inline-flex rounded-full border px-2.5 py-0.5 font-mono text-[11px] font-semibold ${COR[i.status as keyof typeof COR] ?? COR.inativo}`}>
                    {ROTULO_STATUS_IMOVEL[i.status] ?? i.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      )}
    </>
  );
}
