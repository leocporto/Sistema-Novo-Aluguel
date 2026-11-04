import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { formatarDataBR, somarDias, type DataISO } from "@/lib/dominio/datas";
import { organizarPendencias, type PendenciaDoc } from "@/lib/dominio/ia";
import { pendencias, type PessoaBase } from "@/lib/dominio/pessoas";
import { CHECKLIST_DOCS_VENDA } from "@/lib/dominio/vendas";
import { ROTULO_GARANTIA } from "@/lib/tipos";
import { todas } from "../../financeiro/dados";
import { porLotes } from "../dados";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type PessoaMin = { id: string; nome: string; telefone: string | null; email: string | null };
type Parte = { papel: string; pessoa: PessoaMin | null };

const locatario = (partes: Parte[] | null | undefined) => (partes ?? []).find((p) => p.papel === "locatario")?.pessoa ?? null;

/**
 * Verificação assistida de documentos pendentes: cruza os checklists que já
 * existem (análise cadastral, cadastro das pessoas com contrato ativo, garantias
 * e seguro incêndio dos contratos e — na imobiliária — vendas em andamento).
 * Só leitura, com o acesso de quem está logado.
 */
export async function carregarPendencias(supabase: Supabase, o: { hoje: DataISO; pessoal: boolean; diasAviso: number }): Promise<PendenciaDoc[]> {
  const limite = somarDias(o.hoje, o.diasAviso);
  const lista: PendenciaDoc[] = [];

  // 1. Análise cadastral: documentos obrigatórios pendentes ou recusados.
  const { data: analises } = await supabase.from("analises").select("id, candidato:pessoas!candidato_id(id, nome, telefone, email)").eq("status", "em_analise").limit(300);
  const ans = (analises ?? []) as unknown as { id: string; candidato: PessoaMin | null }[];
  if (ans.length) {
    // Em lotes de 100 ids: o filtro "in" vai na URL (300 UUIDs passariam do limite).
    const docs = await porLotes(
      ans.map((a) => a.id),
      (lote) =>
        todas<{ analise_id: string; rotulo: string; status: string; motivo_recusa: string | null }>(() =>
          supabase
            .from("analise_documentos")
            .select("id, analise_id, rotulo, status, motivo_recusa")
            .in("analise_id", lote)
            .eq("obrigatorio", true)
            .in("status", ["pendente", "recusado"])
            .order("id"),
        ),
    );
    for (const a of ans) {
      const itens = docs.filter((d) => d.analise_id === a.id).map((d) => (d.status === "recusado" ? `${d.rotulo} (recusado${d.motivo_recusa ? `: ${d.motivo_recusa}` : ""})` : d.rotulo));
      if (a.candidato && itens.length)
        lista.push({ chave: `analise:${a.id}`, origem: "analise", pessoa: a.candidato.nome, telefone: a.candidato.telefone, email: a.candidato.email, itens, link: `/analise/${a.id}/documentos`, vence: null });
    }
  }

  // 2. Cadastro de quem tem contrato ativo (mesma regra do alerta de documentação das Pessoas).
  const partes = await todas<{ pessoa_id: string }>(() =>
    supabase.from("contrato_partes").select("pessoa_id, contrato_id, contrato:contratos!inner(status)").eq("contrato.status", "ativo").order("contrato_id").order("pessoa_id").order("papel"),
  );
  const ids = [...new Set(partes.map((p) => p.pessoa_id))];
  if (ids.length) {
    // Em lotes de 100 ids (o filtro "in" vai na URL); erro não é ignorado — sem isso
    // as pendências de cadastro sumiriam sem aviso.
    const [pessoas, arquivos] = await Promise.all([
      porLotes(ids, async (lote) => {
        const { data, error } = await supabase.from("pessoas").select("id, nome, tipo_pessoa, documento, email, telefone, papeis, banco, conta, pix_chave").in("id", lote);
        if (error) throw new Error(`Não foi possível ler os cadastros: ${error.message}`);
        return (data ?? []) as unknown as (PessoaBase & { id: string })[];
      }),
      porLotes(ids, (lote) =>
        todas<{ pessoa_id: string; categoria: string | null }>(() => supabase.from("pessoa_arquivos").select("id, pessoa_id, categoria").in("pessoa_id", lote).order("id")),
      ),
    ]);
    const cats = new Map<string, string[]>();
    for (const a of arquivos) cats.set(a.pessoa_id, [...(cats.get(a.pessoa_id) ?? []), a.categoria ?? ""]);
    for (const p of pessoas) {
      const itens = pendencias(p, cats.get(p.id) ?? [], o.pessoal ? "pessoal" : "imobiliaria");
      if (itens.length) lista.push({ chave: `pessoa:${p.id}`, origem: "cadastro", pessoa: p.nome, telefone: p.telefone ?? null, email: p.email ?? null, itens, link: `/pessoas/${p.id}/documentos`, vence: null });
    }
  }

  // 3. Garantias ativas vencidas ou vencendo.
  const { data: garantias } = await supabase
    .from("contrato_garantias")
    .select("id, tipo, fim, contrato_id, contrato:contratos!inner(status, partes:contrato_partes(papel, pessoa:pessoas(id, nome, telefone, email)))")
    .eq("status", "ativa")
    .eq("contrato.status", "ativo")
    .not("fim", "is", null)
    .lte("fim", limite)
    .limit(300);
  for (const g of (garantias ?? []) as unknown as { id: string; tipo: string; fim: string; contrato_id: string; contrato: { partes: Parte[] } }[]) {
    const p = locatario(g.contrato?.partes);
    lista.push({
      chave: `garantia:${g.contrato_id}`,
      origem: "garantia",
      pessoa: p?.nome ?? "Locatário",
      telefone: p?.telefone ?? null,
      email: p?.email ?? null,
      itens: [`Renovação da garantia (${ROTULO_GARANTIA[g.tipo] ?? g.tipo}) — ${g.fim < o.hoje ? "venceu" : "vence"} em ${formatarDataBR(g.fim)}`],
      link: "/analise/garantias",
      vence: g.fim,
    });
  }

  // 4. Seguro incêndio do contrato.
  const { data: seguros } = await supabase
    .from("contratos")
    .select("id, seguro_incendio_vencimento, partes:contrato_partes(papel, pessoa:pessoas(id, nome, telefone, email))")
    .eq("status", "ativo")
    .not("seguro_incendio_vencimento", "is", null)
    .lte("seguro_incendio_vencimento", limite)
    .limit(300);
  for (const c of (seguros ?? []) as unknown as { id: string; seguro_incendio_vencimento: string; partes: Parte[] }[]) {
    const p = locatario(c.partes);
    const v = c.seguro_incendio_vencimento;
    lista.push({
      chave: `seguro:${c.id}`,
      origem: "seguro",
      pessoa: p?.nome ?? "Locatário",
      telefone: p?.telefone ?? null,
      email: p?.email ?? null,
      itens: [`Apólice nova do seguro incêndio — ${v < o.hoje ? "venceu" : "vence"} em ${formatarDataBR(v)}`],
      link: `/contratos/${c.id}`,
      vence: v,
    });
  }

  // 5. Vendas em andamento (imobiliária): itens do checklist de documentação ainda não marcados.
  if (!o.pessoal) {
    const { data: vendas } = await supabase
      .from("vendas")
      .select("id, comprador_nome, comprador_telefone, checklist_docs, comprador:pessoas!comprador_id(nome, telefone, email)")
      .not("status", "in", "(concluida,cancelada)")
      .limit(200);
    for (const v of (vendas ?? []) as unknown as {
      id: string;
      comprador_nome: string | null;
      comprador_telefone: string | null;
      checklist_docs: Record<string, boolean> | null;
      comprador: { nome: string; telefone: string | null; email: string | null } | null;
    }[]) {
      const marcados = v.checklist_docs ?? {};
      const itens = CHECKLIST_DOCS_VENDA.filter((g) => g.parte === "comprador").flatMap((g) => g.itens.filter((i) => !marcados[i.id]).map((i) => i.rotulo));
      if (itens.length)
        lista.push({
          chave: `venda:${v.id}`,
          origem: "venda",
          pessoa: v.comprador?.nome ?? v.comprador_nome ?? "Comprador",
          telefone: v.comprador?.telefone ?? v.comprador_telefone,
          email: v.comprador?.email ?? null,
          itens,
          link: `/vendas/${v.id}/documentos`,
          vence: null,
        });
    }
  }
  return organizarPendencias(lista);
}
