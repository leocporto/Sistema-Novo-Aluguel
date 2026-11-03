"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Download, Upload } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { lerCSV } from "@/lib/dominio/imoveis";
import {
  COLUNAS_PESSOA,
  ROTULO_MOTIVO_PESSOA,
  acharPessoasRepetidas,
  interpretarPlanilhaPessoas,
  modeloCSVPessoas,
  pessoaRepetidaDe,
  type LinhaPessoa,
  type PessoaBase,
} from "@/lib/dominio/pessoas";
import { ROTULO_PAPEL } from "@/lib/tipos";
import { importarPessoas } from "../actions";

type Linha = LinhaPessoa & { repetido: string | null };

export function ImportadorPessoas({ existentes, papeisPermitidos }: { existentes: (PessoaBase & { id: string })[]; papeisPermitidos: string[] }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [colunas, setColunas] = useState<(string | null)[]>([]);
  const [incluir, setIncluir] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ criados: number; falhas: string[] } | null>(null);
  const [importando, iniciar] = useTransition();

  const baixarModelo = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([modeloCSVPessoas()], { type: "text/csv;charset=utf-8" }));
    a.download = "modelo-pessoas.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const ler = async (f: File) => {
    setErro(null);
    setResultado(null);
    try {
      let tabela: unknown[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        tabela = (await readSheet(f)) as unknown[][];
      } else if (/\.(csv|txt)$/i.test(f.name)) tabela = lerCSV(await f.text());
      else throw new Error("Envie um arquivo .xlsx (Excel) ou .csv.");
      const { colunas: cols, itens } = interpretarPlanilhaPessoas(tabela);
      if (!cols.includes("nome")) throw new Error('Não achei a coluna "Nome". Baixe o modelo e use os mesmos títulos na 1ª linha.');
      // Papéis que não existem neste modo viram "cliente".
      for (const it of itens) {
        const ps = (it.dados.papeis as string[]).filter((p) => papeisPermitidos.includes(p));
        it.dados.papeis = ps.length ? ps : ["cliente"];
      }
      const internos = new Map<number, string>();
      for (const g of acharPessoasRepetidas(itens.map((it) => ({ ...(it.dados as PessoaBase), id: String(it.linha) })))) {
        if (g.motivo === "nome") continue;
        for (const it of g.itens.slice(1)) internos.set(Number(it.id), `${ROTULO_MOTIVO_PESSOA[g.motivo]} da linha ${g.itens[0].id}`);
      }
      setColunas(cols);
      setLinhas(
        itens.map((it) => {
          const ja = pessoaRepetidaDe(it.dados as PessoaBase, existentes);
          return { ...it, repetido: ja ? `${ROTULO_MOTIVO_PESSOA[ja.motivo]} de ${ja.item.nome}` : (internos.get(it.linha) ?? null) };
        }),
      );
    } catch (e) {
      setLinhas([]);
      setErro(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      if (entrada.current) entrada.current.value = "";
    }
  };

  const prontas = useMemo(() => linhas.filter((l) => !l.erros.length && (incluir || !l.repetido)), [linhas, incluir]);
  const comErro = linhas.filter((l) => l.erros.length).length;
  const repetidas = linhas.filter((l) => !l.erros.length && l.repetido).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2">
        <button type="button" className={classeBotao("secundario")} onClick={baixarModelo}>
          <Download className="size-4" /> Baixar planilha-modelo
        </button>
        <button type="button" className={classeBotao("primario")} onClick={() => entrada.current?.click()}>
          <Upload className="size-4" /> Escolher arquivo (.xlsx ou .csv)
        </button>
        <input ref={entrada} type="file" accept=".xlsx,.csv,.txt" className="hidden" onChange={(e) => e.target.files?.[0] && void ler(e.target.files[0])} />
      </div>
      {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      {resultado && (
        <div className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-3 text-sm text-ok">
          {resultado.criados} pessoa(s) importada(s).{" "}
          <Link href="/pessoas" className="font-semibold underline">
            Ver pessoas
          </Link>
          {resultado.falhas.length > 0 && (
            <ul className="mt-2 list-disc pl-5 text-ruim">
              {resultado.falhas.map((f) => (
                <li key={f}>{f}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {linhas.length > 0 && (
        <>
          <div className="rounded-card border border-borda bg-card p-4 text-sm">
            <p className="text-texto-2">
              Colunas reconhecidas: {colunas.filter(Boolean).map((c) => COLUNAS_PESSOA.find((x) => x.campo === c)?.rotulo).join(", ")}.
            </p>
            <p className="mt-2">
              <span className="font-semibold text-ok">{prontas.length} pronta(s)</span>
              {comErro > 0 && <span className="text-ruim"> · {comErro} com erro (ficam de fora)</span>}
              {repetidas > 0 && <span className="text-alerta"> · {repetidas} parecem repetidas</span>}
            </p>
            {repetidas > 0 && (
              <label className="mt-2 flex items-center gap-2 text-texto-2">
                <input type="checkbox" checked={incluir} onChange={(e) => setIncluir(e.target.checked)} /> Importar também as que parecem repetidas
              </label>
            )}
            <button
              type="button"
              className={`${classeBotao("primario")} mt-3`}
              disabled={!prontas.length || importando}
              onClick={() =>
                iniciar(async () => {
                  const r = await importarPessoas(prontas.map((l) => l.dados));
                  if (!r.ok) setErro(r.erro ?? "Não foi possível importar.");
                  else {
                    setResultado({ criados: r.criados ?? 0, falhas: r.falhas ?? [] });
                    setLinhas([]);
                  }
                })
              }
            >
              {importando ? "Importando…" : `Importar ${prontas.length} pessoa(s)`}
            </button>
          </div>
          <div className="overflow-x-auto rounded-card border border-borda bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-borda text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                  <th className="px-3 py-2.5">Linha</th>
                  <th className="px-3 py-2.5">Nome</th>
                  <th className="px-3 py-2.5">CPF/CNPJ</th>
                  <th className="px-3 py-2.5">Contato</th>
                  <th className="px-3 py-2.5">Papéis</th>
                  <th className="px-3 py-2.5">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda-suave">
                {linhas.map((l) => {
                  const d = l.dados as Record<string, string | string[] | undefined>;
                  return (
                    <tr key={l.linha} className={l.erros.length ? "bg-ruim-bg/40" : l.repetido ? "bg-alerta-bg/40" : ""}>
                      <td className="px-3 py-2 text-mudo">{l.linha}</td>
                      <td className="px-3 py-2 font-semibold">{(d.nome as string) ?? "—"}</td>
                      <td className="px-3 py-2">{(d.documento as string) ?? "—"}</td>
                      <td className="px-3 py-2">{[d.telefone, d.email].filter(Boolean).join(" · ") || "—"}</td>
                      <td className="px-3 py-2">{((d.papeis as string[]) ?? []).map((p) => ROTULO_PAPEL[p] ?? p).join(", ")}</td>
                      <td className="px-3 py-2 text-xs">
                        {l.erros.length ? (
                          <span className="text-ruim">{l.erros.join("; ")}</span>
                        ) : l.repetido ? (
                          <span className="text-alerta">Parece repetido: {l.repetido}</span>
                        ) : (
                          <span className="text-ok">OK</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
