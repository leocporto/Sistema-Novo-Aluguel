import type { Metadata } from "next";
import { Download } from "lucide-react";
import { BotaoImprimir } from "@/components/formulario";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Celula, Entrada, LinhaVazia, Selecao, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { carregarCondominio, contasDo } from "../../dados";
import { RELATORIOS_COND, montarRelatorioCond, type RelatorioCond } from "./tabelas";

export const metadata: Metadata = { title: "Relatórios do condomínio" };

/** Relatórios financeiros do condomínio: balancete, previsto × realizado, inadimplência, fundo de reserva e extrato da conta (tela, impressão e CSV). */
export default async function RelatoriosCondominio({ params, searchParams }: PageProps<"/condominios/[id]/relatorios">) {
  const { id } = await params;
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const hoje = hojeISO();
  const r: RelatorioCond = s("r") in RELATORIOS_COND ? (s("r") as RelatorioCond) : "balancete";
  const mes = /^\d{4}-\d{2}$/.test(s("mes")) ? s("mes") : hoje.slice(0, 7);
  const ano = /^\d{4}$/.test(s("ano")) ? Number(s("ano")) : Number(hoje.slice(0, 4));
  const conta = s("conta") || null;
  const { supabase } = await obterContexto();
  const [c, contas, t] = await Promise.all([carregarCondominio(supabase, id), contasDo(supabase, id), montarRelatorioCond(supabase, id, r, { mes, ano, conta })]);
  const base = `/condominios/${id}/relatorios`;
  const qs = new URLSearchParams({ r, mes, ano: String(ano), ...(conta ? { conta } : {}) }).toString();
  const usaMes = r === "balancete" || r === "extrato";
  const usaAno = r === "previsto" || r === "fundo";

  return (
    <div className="space-y-5">
      <div className="nao-imprimir flex flex-wrap items-center justify-between gap-3">
        <PilulasLink rotulo="Relatório" ativo={`${base}?r=${r}`} itens={Object.entries(RELATORIOS_COND).map(([k, rot]) => ({ href: `${base}?r=${k}`, rotulo: rot }))} />
        <div className="flex flex-wrap gap-2">
          <a href={`${base}/exportar?${qs}`} className={classeBotao("secundario")}>
            <Download className="size-4" /> CSV (Excel)
          </a>
          <BotaoImprimir />
        </div>
      </div>
      {(usaMes || usaAno) && (
        <FiltroAutomatico className="nao-imprimir flex flex-wrap gap-2">
          <input type="hidden" name="r" value={r} />
          {usaMes && <Entrada type="month" name="mes" defaultValue={mes} aria-label="Mês" className="max-w-48" />}
          {usaAno && <Entrada type="number" name="ano" defaultValue={ano} min={2000} max={2100} aria-label="Ano" className="max-w-32" />}
          {r === "extrato" && (
            <Selecao name="conta" defaultValue={conta ?? contas.find((x) => x.tipo === "corrente")?.id ?? ""} aria-label="Conta" className="max-w-64">
              {contas.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.nome}
                </option>
              ))}
            </Selecao>
          )}
        </FiltroAutomatico>
      )}
      <div>
        <div className="mb-3">
          <div className="text-sm text-mudo">{c?.nome}</div>
          <h2 className="text-[20px] font-semibold text-texto">{t.titulo}</h2>
          <p className="text-sm text-texto-2">{t.subtitulo}</p>
        </div>
        <Tabela colunas={t.colunas}>
          {t.linhas.map((l, i) => (
            <tr key={i}>
              {l.map((v, j) => (
                <Celula key={j} className={j === l.length - 1 || /^[−-]?\s?R\$/.test(v) ? "whitespace-nowrap tabular-nums" : ""}>
                  {v}
                </Celula>
              ))}
            </tr>
          ))}
          {t.linhas.length === 0 && <LinhaVazia colunas={t.colunas.length}>Nada no período.</LinhaVazia>}
          {(t.rodape ?? []).map((l, i) => (
            <tr key={`r${i}`}>
              {l.map((v, j) => (
                <Celula key={j} className="whitespace-nowrap font-semibold tabular-nums">
                  {v}
                </Celula>
              ))}
            </tr>
          ))}
        </Tabela>
      </div>
    </div>
  );
}
