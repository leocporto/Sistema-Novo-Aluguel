"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Download, FileSpreadsheet, Upload } from "lucide-react";
import { classeBotao } from "@/components/ui";
import { formatarReais } from "@/lib/dominio/dinheiro";
import {
  COLUNAS_IMPORTACAO,
  ROTULO_MOTIVO_DUPLICADO,
  acharDuplicados,
  duplicadosDe,
  interpretarPlanilha,
  lerCSV,
  modeloCSV,
  type ImovelChave,
  type LinhaImportada,
} from "@/lib/dominio/imoveis";
import { importarImoveis } from "../actions";

type Linha = LinhaImportada & { duplicado: string | null };

/** Lê CSV/XLSX no navegador, mostra a prévia (erros e repetidos) e importa. */
export function Importador({ existentes }: { existentes: (ImovelChave & { id: string; codigo: string })[] }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [colunas, setColunas] = useState<(string | null)[]>([]);
  const [linhas, setLinhas] = useState<Linha[]>([]);
  const [incluirRepetidos, setIncluirRepetidos] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ criados: number; falhas: string[] } | null>(null);
  const [importando, iniciar] = useTransition();

  const baixarModelo = () => {
    const blob = new Blob([modeloCSV()], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "modelo-imoveis.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const ler = async (f: File) => {
    setErro(null);
    setResultado(null);
    setNomeArquivo(f.name);
    try {
      let tabela: unknown[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        tabela = (await readSheet(f)) as unknown[][];
      } else if (/\.(csv|txt)$/i.test(f.name)) {
        tabela = lerCSV(await f.text());
      } else throw new Error("Envie um arquivo .xlsx (Excel) ou .csv.");
      const { colunas: cols, itens } = interpretarPlanilha(tabela);
      if (!cols.some(Boolean)) throw new Error("Não reconheci as colunas. Baixe o modelo e use os mesmos títulos na 1ª linha.");
      // Repetidos: com o que já está cadastrado e dentro da própria planilha.
      const internos = new Map<number, string>();
      for (const g of acharDuplicados(itens.map((it) => ({ ...(it.dados as ImovelChave), id: String(it.linha) })))) {
        for (const it of g.itens.slice(1)) internos.set(Number(it.id), `${ROTULO_MOTIVO_DUPLICADO[g.motivo]} da linha ${g.itens[0].id}`);
      }
      setColunas(cols);
      setLinhas(
        itens.map((it) => {
          const ja = duplicadosDe(it.dados as ImovelChave, existentes)[0];
          return {
            ...it,
            duplicado: ja ? `${ROTULO_MOTIVO_DUPLICADO[ja.motivo]} de ${ja.item.codigo}` : (internos.get(it.linha) ?? null),
          };
        }),
      );
    } catch (e) {
      setLinhas([]);
      setErro(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      if (entrada.current) entrada.current.value = "";
    }
  };

  const prontas = useMemo(() => linhas.filter((l) => !l.erros.length && (incluirRepetidos || !l.duplicado)), [linhas, incluirRepetidos]);
  const comErro = linhas.filter((l) => l.erros.length).length;
  const repetidas = linhas.filter((l) => !l.erros.length && l.duplicado).length;
  const reconhecidas = colunas.filter(Boolean).map((c) => COLUNAS_IMPORTACAO.find((x) => x.campo === c)?.rotulo);

  const importar = () =>
    iniciar(async () => {
      const r = await importarImoveis(prontas.map((l) => l.dados));
      if (!r.ok) setErro(r.erro ?? "Não foi possível importar.");
      else {
        setResultado({ criados: r.criados ?? 0, falhas: r.falhas ?? [] });
        setLinhas([]);
      }
    });

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
          {resultado.criados} imóvel(is) importado(s).{" "}
          <Link href="/imoveis" className="font-semibold underline">
            Ver imóveis
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
            <div className="flex items-center gap-2 font-semibold text-texto">
              <FileSpreadsheet className="size-4" /> {nomeArquivo}: {linhas.length} linha(s)
            </div>
            <p className="mt-1 text-texto-2">
              Colunas reconhecidas: {reconhecidas.join(", ")}.
              {colunas.some((c) => !c) && <span className="text-mudo"> Colunas com outros títulos foram ignoradas.</span>}
            </p>
            <p className="mt-2">
              <span className="font-semibold text-ok">{prontas.length} pronta(s) para importar</span>
              {comErro > 0 && <span className="text-ruim"> · {comErro} com erro (ficam de fora)</span>}
              {repetidas > 0 && <span className="text-alerta"> · {repetidas} parecem repetidas</span>}
            </p>
            {repetidas > 0 && (
              <label className="mt-2 flex items-center gap-2 text-texto-2">
                <input type="checkbox" checked={incluirRepetidos} onChange={(e) => setIncluirRepetidos(e.target.checked)} /> Importar também as que parecem repetidas
              </label>
            )}
            <button type="button" className={`${classeBotao("primario")} mt-3`} disabled={!prontas.length || importando} onClick={importar}>
              {importando ? "Importando…" : `Importar ${prontas.length} imóvel(is)`}
            </button>
          </div>

          <div className="overflow-x-auto rounded-card border border-borda bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-borda text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                  <th className="px-3 py-2.5">Linha</th>
                  <th className="px-3 py-2.5">Código</th>
                  <th className="px-3 py-2.5">Endereço</th>
                  <th className="px-3 py-2.5">Tipo</th>
                  <th className="px-3 py-2.5">Valores</th>
                  <th className="px-3 py-2.5">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda-suave">
                {linhas.map((l) => {
                  const d = l.dados as Record<string, string | number | undefined>;
                  return (
                    <tr key={l.linha} className={l.erros.length ? "bg-ruim-bg/40" : l.duplicado ? "bg-alerta-bg/40" : ""}>
                      <td className="px-3 py-2 text-mudo">{l.linha}</td>
                      <td className="px-3 py-2 font-semibold">{d.codigo ?? "—"}</td>
                      <td className="px-3 py-2">{[d.logradouro, d.numero, d.complemento, d.cidade].filter(Boolean).join(", ") || "—"}</td>
                      <td className="px-3 py-2 capitalize">{d.tipo ?? "—"}</td>
                      <td className="px-3 py-2 tabular-nums">
                        {d.valor_aluguel ? `${formatarReais(d.valor_aluguel)}/mês` : ""}
                        {d.valor_venda ? ` venda ${formatarReais(d.valor_venda)}` : ""}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {l.erros.length ? (
                          <span className="text-ruim">{l.erros.join("; ")}</span>
                        ) : l.duplicado ? (
                          <span className="text-alerta">Parece repetido: {l.duplicado}</span>
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
