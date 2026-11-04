"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { CheckCircle2, Download, FileSpreadsheet, Save, Upload } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Entrada, Selecao, classeBotao } from "@/components/ui";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { lerCSV } from "@/lib/dominio/imoveis";
import {
  aplicarModelo,
  camposContratoDoModo,
  interpretarContratos,
  modeloCSVContratos,
  modeloDoMapa,
  sugerirMapeamento,
  type CampoContrato,
  type LinhaContratoImportada,
  type MapaColunas,
} from "@/lib/dominio/integracoes";
import type { ModoUso } from "@/lib/modos";
import { conferirContratos, excluirModeloImportacao, importarContratos, salvarModeloImportacao } from "../actions";

type Modelo = { id: string; nome: string; mapa: Record<string, string> };
type Linha = LinhaContratoImportada & { problemas: string[] };
const PARTE = 100;

/** Assistente: arquivo → colunas → prévia conferida com o cadastro → importação em partes. */
export function ImportadorContratos({ modo, modelos }: { modo: ModoUso; modelos: Modelo[] }) {
  const entrada = useRef<HTMLInputElement>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [tabela, setTabela] = useState<unknown[][]>([]);
  const [mapa, setMapa] = useState<MapaColunas>([]);
  const [modeloId, setModeloId] = useState("");
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [nomeModelo, setNomeModelo] = useState("");
  const [progresso, setProgresso] = useState<string | null>(null);
  const [resultado, setResultado] = useState<{ criados: number; falhas: string[] } | null>(null);
  const [rodando, iniciar] = useTransition();
  const campos = camposContratoDoModo(modo);
  const cabecalhos = useMemo(() => (tabela[0] ?? []).map((c) => String(c ?? "").trim()), [tabela]);
  const faltando = campos.filter((c) => c.obrigatorio && !mapa.includes(c.campo));

  const baixarModelo = () => {
    const blob = new Blob([modeloCSVContratos(modo)], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "modelo-contratos.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const ler = async (f: File) => {
    setErro(null);
    setAviso(null);
    setResultado(null);
    setLinhas(null);
    setNomeArquivo(f.name);
    try {
      let t: unknown[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        t = (await readSheet(f)) as unknown[][];
      } else if (/\.(csv|txt)$/i.test(f.name)) t = lerCSV(await f.text());
      else throw new Error("Envie um arquivo .xlsx (Excel) ou .csv.");
      if (t.length < 2) throw new Error("O arquivo precisa ter a linha de títulos e pelo menos um contrato.");
      if (t.length > 2001) throw new Error("Até 2.000 contratos por arquivo. Divida em arquivos menores.");
      const cab = (t[0] ?? []).map((c) => String(c ?? "").trim());
      const modelo = modelos.find((m) => m.id === modeloId);
      setTabela(t);
      setMapa(modelo ? aplicarModelo(cab, modelo.mapa, modo) : sugerirMapeamento(cab, modo));
    } catch (e) {
      setTabela([]);
      setErro(e instanceof Error ? e.message : "Não foi possível ler o arquivo.");
    } finally {
      if (entrada.current) entrada.current.value = "";
    }
  };

  const mudarColuna = (i: number, campo: string) => {
    setLinhas(null);
    setMapa((m) => m.map((c, j) => (j === i ? ((campo || null) as CampoContrato | null) : c === campo && campo ? null : c)));
  };

  const usarModelo = (id: string) => {
    setModeloId(id);
    const modelo = modelos.find((m) => m.id === id);
    if (modelo && cabecalhos.length) {
      setLinhas(null);
      setMapa(aplicarModelo(cabecalhos, modelo.mapa, modo));
    }
  };

  const conferir = () =>
    iniciar(async () => {
      setErro(null);
      setResultado(null);
      const lidas = interpretarContratos(tabela, mapa, modo);
      const boas = lidas.filter((l) => !l.erros.length);
      let problemas: Record<number, string[]> = {};
      if (boas.length) {
        const r = await conferirContratos(boas.map((l) => ({ linha: l.linha, dados: l.dados })));
        if (!r.ok) {
          setErro(r.erro ?? "Não foi possível conferir.");
          return;
        }
        problemas = r.problemas ?? {};
      }
      setLinhas(lidas.map((l) => ({ ...l, problemas: problemas[l.linha] ?? [] })));
    });

  const salvarModelo = () =>
    iniciar(async () => {
      const r = await salvarModeloImportacao(nomeModelo, modeloDoMapa(cabecalhos, mapa));
      if (!r.ok) setErro(r.erro ?? "Não foi possível salvar o modelo.");
      else {
        setAviso(`Modelo “${nomeModelo.trim()}” salvo: da próxima vez, escolha-o antes de abrir o arquivo.`);
        setNomeModelo("");
      }
    });

  const prontas = (linhas ?? []).filter((l) => !l.erros.length && !l.problemas.length);
  const importar = () =>
    iniciar(async () => {
      setErro(null);
      let criados = 0;
      const falhas: string[] = [];
      for (let i = 0; i < prontas.length; i += PARTE) {
        setProgresso(`Importando ${Math.min(i + PARTE, prontas.length)} de ${prontas.length}…`);
        const r = await importarContratos(prontas.slice(i, i + PARTE).map((l) => ({ linha: l.linha, dados: l.dados })));
        criados += r.criados ?? 0;
        falhas.push(...(r.falhas ?? []));
        if (!r.ok) {
          falhas.push(r.erro ?? "Importação interrompida.");
          break;
        }
      }
      setProgresso(null);
      setResultado({ criados, falhas });
      setLinhas(null);
    });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-2">
        <button type="button" className={classeBotao("secundario")} onClick={baixarModelo}>
          <Download className="size-4" /> Planilha-modelo
        </button>
        {modelos.length > 0 && (
          <Selecao aria-label="Modelo de mapeamento salvo" value={modeloId} onChange={(e) => usarModelo(e.target.value)} className="w-auto min-h-10">
            <option value="">Mapear colunas sozinho</option>
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                Modelo: {m.nome}
              </option>
            ))}
          </Selecao>
        )}
        {modeloId && <BotaoExcluir acao={excluirModeloImportacao} id={modeloId} confirmar="Excluir este modelo de mapeamento?" rotulo="Excluir modelo" />}
        <button type="button" className={classeBotao("primario")} onClick={() => entrada.current?.click()}>
          <Upload className="size-4" /> Escolher arquivo (.xlsx ou .csv)
        </button>
        <input ref={entrada} type="file" accept=".xlsx,.csv,.txt" className="hidden" aria-label="Arquivo de contratos" onChange={(e) => e.target.files?.[0] && void ler(e.target.files[0])} />
      </div>

      {erro && <div role="alert" className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      {aviso && <div role="status" className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-2.5 text-sm text-ok">{aviso}</div>}
      {resultado && (
        <div role="status" className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-3 text-sm text-ok">
          <CheckCircle2 className="mr-1 inline size-4" /> {resultado.criados} contrato(s) importado(s).{" "}
          <Link href="/contratos" className="font-semibold underline">
            Ver contratos
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

      {tabela.length > 1 && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-texto">
            <FileSpreadsheet className="size-4" /> {nomeArquivo}: {tabela.length - 1} linha(s). Diga o que é cada coluna:
          </div>
          <div className="overflow-x-auto rounded-card border border-borda">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-borda bg-elev text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                  <th className="px-3 py-2.5">Coluna do arquivo</th>
                  <th className="px-3 py-2.5">Exemplo</th>
                  <th className="px-3 py-2.5">Campo no sistema</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda-suave">
                {cabecalhos.map((c, i) => (
                  <tr key={`${c}-${i}`}>
                    <td className="px-3 py-2 font-semibold">{c || `(coluna ${i + 1})`}</td>
                    <td className="max-w-[220px] truncate px-3 py-2 text-texto-2">{String((tabela[1] ?? [])[i] instanceof Date ? ((tabela[1] ?? [])[i] as Date).toLocaleDateString("pt-BR", { timeZone: "UTC" }) : ((tabela[1] ?? [])[i] ?? ""))}</td>
                    <td className="px-3 py-2">
                      <Selecao aria-label={`Campo da coluna ${c || i + 1}`} value={mapa[i] ?? ""} onChange={(e) => mudarColuna(i, e.target.value)} className="min-h-10">
                        <option value="">Ignorar esta coluna</option>
                        {campos.map((f) => (
                          <option key={f.campo} value={f.campo}>
                            {f.rotulo}
                            {f.obrigatorio ? " *" : ""}
                          </option>
                        ))}
                      </Selecao>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {faltando.length > 0 && <p className="text-sm text-alerta">Falta ligar: {faltando.map((f) => f.rotulo).join(", ")}.</p>}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={classeBotao("primario")} disabled={rodando || faltando.length > 0} onClick={conferir}>
              {rodando && !progresso ? "Conferindo…" : "Conferir contratos"}
            </button>
            <Entrada aria-label="Nome do modelo de mapeamento" placeholder="Nome do modelo (ex.: sistema antigo)" value={nomeModelo} onChange={(e) => setNomeModelo(e.target.value)} className="w-auto min-h-10 max-w-xs" />
            <button type="button" className={classeBotao("secundario")} disabled={rodando || !nomeModelo.trim()} onClick={salvarModelo}>
              <Save className="size-4" /> Salvar mapeamento
            </button>
          </div>
        </div>
      )}

      {linhas && (
        <div className="space-y-3">
          <div className="rounded-card border border-borda bg-elev p-4 text-sm">
            <span className="font-semibold text-ok">{prontas.length} pronto(s) para importar</span>
            {linhas.length - prontas.length > 0 && <span className="text-ruim"> · {linhas.length - prontas.length} com problema (ficam de fora)</span>}
            <div className="mt-3">
              <button type="button" className={classeBotao("primario")} disabled={!prontas.length || rodando} onClick={importar}>
                {progresso ?? `Importar ${prontas.length} contrato(s)`}
              </button>
            </div>
          </div>
          <div className="overflow-x-auto rounded-card border border-borda bg-card">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="border-b border-borda text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                  <th className="px-3 py-2.5">Linha</th>
                  <th className="px-3 py-2.5">Imóvel</th>
                  <th className="px-3 py-2.5">Locatário</th>
                  <th className="px-3 py-2.5">Início</th>
                  <th className="px-3 py-2.5">Aluguel</th>
                  <th className="px-3 py-2.5">Situação</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borda-suave">
                {linhas.map((l) => {
                  const erros = [...l.erros, ...l.problemas];
                  return (
                    <tr key={l.linha} className={erros.length ? "bg-ruim-bg/40" : ""}>
                      <td className="px-3 py-2 text-mudo">{l.linha}</td>
                      <td className="px-3 py-2 font-semibold">{l.dados.imovel_codigo || "—"}</td>
                      <td className="px-3 py-2 font-mono text-[12.5px]">{l.dados.locatario_documento || "—"}</td>
                      <td className="px-3 py-2">{l.dados.data_inicio ? l.dados.data_inicio.split("-").reverse().join("/") : "—"}</td>
                      <td className="px-3 py-2 tabular-nums">{l.dados.valor_aluguel ? formatarReais(l.dados.valor_aluguel) : "—"}</td>
                      <td className="px-3 py-2 text-xs">{erros.length ? <span className="text-ruim">{erros.join("; ")}</span> : <span className="text-ok">OK ({l.dados.status})</span>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
