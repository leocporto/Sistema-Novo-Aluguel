import type { Metadata } from "next";
import Link from "next/link";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_ACAO_HISTORICO, ROTULO_CAMPO_HISTORICO } from "@/lib/dominio/financeiro";
import { AbasFinanceiro } from "../abas";

export const metadata: Metadata = { title: "Histórico financeiro" };

const COR: Record<string, "cinza" | "azul" | "verde" | "amarelo" | "vermelho"> = {
  criado: "azul",
  alterado: "cinza",
  liquidado: "verde",
  estornado: "amarelo",
  cancelado: "vermelho",
  aprovado: "verde",
  excluido: "vermelho",
};

function resumo(v: unknown, campo: string) {
  if (v === null || v === undefined || v === "") return "—";
  if (["valor", "valor_pago", "juros", "desconto"].includes(campo)) return formatarReais(Number(v));
  if (["vencimento", "liquidado_em"].includes(campo)) return formatarDataBR(String(v));
  if (["conta_id", "plano_id", "pessoa_id"].includes(campo)) return "alterado";
  if (campo === "aprovado_em") return "aprovado";
  return String(v);
}

/** Tudo o que mudou no financeiro: quem criou, baixou, estornou, cancelou, aprovou ou excluiu. Não dá para apagar. */
export default async function HistoricoPage({ searchParams }: PageProps<"/financeiro/historico">) {
  const sp = await searchParams;
  const acao = typeof sp.acao === "string" && sp.acao in ROTULO_ACAO_HISTORICO ? sp.acao : "";
  const hoje = hojeISO();
  const de = typeof sp.de === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.de) ? sp.de : somarDias(hoje, -30);
  const { supabase, organizacao, usuario } = await obterContexto();
  let q = supabase.from("lancamento_historico").select("*").gte("data", `${de}T00:00:00`).order("data", { ascending: false }).limit(500);
  if (acao) q = q.eq("acao", acao);
  const [{ data }, { data: membros }] = await Promise.all([q, supabase.from("membros").select("user_id, nome").limit(500)]);
  const nomes = new Map((membros ?? []).map((m) => [m.user_id as string, (m.nome as string | null) ?? null]));
  const url = (k: string) => `/financeiro/historico?de=${de}${k ? `&acao=${k}` : ""}`;

  return (
    <>
      <Cabecalho titulo="Histórico financeiro" trilha="Financeiro" descricao="Registro automático de toda alteração em lançamentos (quem e quando). Serve de auditoria e não pode ser apagado." />
      <AbasFinanceiro pessoal={organizacao.modo === "pessoal"} />
      <PilulasLink
        className="mb-4"
        rotulo="Ação"
        ativo={url(acao)}
        itens={[{ href: url(""), rotulo: "Tudo" }, ...Object.entries(ROTULO_ACAO_HISTORICO).map(([k, r]) => ({ href: url(k), rotulo: r }))]}
      />
      <FiltroAutomatico className="mb-4 flex items-center gap-2">
        {acao && <input type="hidden" name="acao" value={acao} />}
        <span className="text-sm text-texto-2">Desde</span>
        <Entrada type="date" name="de" aria-label="Mostrar desde" defaultValue={de} className="w-44" />
      </FiltroAutomatico>
      <Tabela colunas={["Quando", "Ação", "Lançamento", "O que mudou", "Quem"]}>
        {(data ?? []).map((h) => {
          const antes = (h.antes ?? {}) as Record<string, unknown>;
          const depois = (h.depois ?? {}) as Record<string, unknown>;
          const base = h.acao === "excluido" ? antes : depois;
          const campos = h.acao === "criado" || h.acao === "excluido" ? [] : Object.keys(depois).filter((c) => c !== "descricao");
          return (
            <tr key={h.id} className="align-top">
              <Celula>{new Date(h.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</Celula>
              <Celula>
                <Selo cor={COR[h.acao] ?? "cinza"}>{ROTULO_ACAO_HISTORICO[h.acao] ?? h.acao}</Selo>
              </Celula>
              <Celula>
                {h.acao === "excluido" ? (
                  <span className="text-texto-2">{String(base.descricao ?? "—")}</span>
                ) : (
                  <Link href={`/financeiro/lancamentos/${h.lancamento_id}`} className="text-acento hover:underline">
                    {String(base.descricao ?? antes.descricao ?? "abrir")}
                  </Link>
                )}
                {base.valor !== undefined && <span className="block text-xs text-mudo">{formatarReais(Number(base.valor))}</span>}
              </Celula>
              <Celula>
                <ul className="text-xs text-texto-2">
                  {campos.map((c) => (
                    <li key={c}>
                      {ROTULO_CAMPO_HISTORICO[c] ?? c}: {resumo(antes[c], c)} → {resumo(depois[c], c)}
                    </li>
                  ))}
                </ul>
              </Celula>
              <Celula>
                <span className="text-xs text-texto-2">{h.usuario_id ? (h.usuario_id === usuario.id ? "você" : (nomes.get(h.usuario_id) ?? "outro usuário")) : "sistema"}</span>
              </Celula>
            </tr>
          );
        })}
        {!data?.length && <LinhaVazia colunas={5}>Nada registrado no período.</LinhaVazia>}
      </Tabela>
    </>
  );
}
