import type { Metadata } from "next";
import Link from "next/link";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasRepasses } from "../abas";
import { nomesDosMembros } from "../dados";

export const metadata: Metadata = { title: "Histórico de repasses" };

const TIPOS: Record<string, string> = {
  aprovado: "Aprovados",
  pago: "Pagos",
  desconto: "Descontos",
  cancelado: "Cancelados",
  pagamento_desfeito: "Pagamentos desfeitos",
  criado: "Gerados",
};
const ROTULO: Record<string, string> = {
  criado: "Gerado",
  desconto: "Desconto",
  desconto_devolvido: "Desconto devolvido",
  valor_alterado: "Valor alterado",
  aprovado: "Aprovado",
  aprovacao_desfeita: "Aprovação desfeita",
  agendado: "Reagendado",
  pago: "Pago",
  pagamento_desfeito: "Pagamento desfeito",
  cancelado: "Cancelado",
  reaberto: "Reaberto",
  conciliado: "Conciliado",
  excluido: "Excluído",
};
const COR: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  pago: "verde",
  aprovado: "verde",
  desconto: "amarelo",
  cancelado: "vermelho",
  excluido: "vermelho",
  pagamento_desfeito: "vermelho",
  criado: "azul",
};

/** Tudo o que aconteceu com os repasses (gerado, aprovado, descontado, pago, cancelado…). Não dá para apagar. */
export default async function HistoricoRepassesPage({ searchParams }: PageProps<"/repasses/historico">) {
  const sp = await searchParams;
  const tipo = typeof sp.tipo === "string" && sp.tipo in TIPOS ? sp.tipo : "";
  const hoje = hojeISO();
  const de = typeof sp.de === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.de) ? sp.de : somarDias(hoje, -30);
  const { supabase } = await obterContexto();
  let q = supabase.from("repasse_eventos").select("*").gte("data", `${de}T00:00:00`).order("data", { ascending: false }).limit(500);
  if (tipo) q = q.eq("tipo", tipo);
  const [{ data }, nomes, { data: pessoas }] = await Promise.all([q, nomesDosMembros(supabase), supabase.from("pessoas").select("id, nome").contains("papeis", ["proprietario"]).limit(5000)]);
  const nomePessoa = new Map((pessoas ?? []).map((p) => [p.id as string, p.nome as string]));
  const eventos = (data ?? []) as { id: string; repasse_id: string; pessoa_id: string | null; tipo: string; descricao: string | null; valor: number | null; usuario_id: string | null; data: string }[];
  const url = (k: string) => `/repasses/historico?de=${de}${k ? `&tipo=${k}` : ""}`;

  return (
    <>
      <Cabecalho titulo="Histórico de repasses" trilha="Repasses" descricao="Registro automático de cada repasse: quando foi gerado, aprovado (e por quem), descontado, pago, desfeito ou cancelado. Serve de auditoria e não pode ser apagado." />
      <AbasRepasses />
      <PilulasLink className="mb-4" rotulo="Tipo de registro" ativo={url(tipo)} itens={[{ href: url(""), rotulo: "Tudo" }, ...Object.entries(TIPOS).map(([k, r]) => ({ href: url(k), rotulo: r }))]} />
      <FiltroAutomatico className="mb-4 flex items-center gap-2">
        {tipo && <input type="hidden" name="tipo" value={tipo} />}
        <span className="text-sm text-texto-2">Desde</span>
        <Entrada type="date" name="de" aria-label="Mostrar desde" defaultValue={de} className="w-44" />
      </FiltroAutomatico>
      <Tabela colunas={["Quando", "O que", "Proprietário", "Detalhe", "Valor", "Quem"]}>
        {eventos.map((e) => (
          <tr key={e.id}>
            <Celula>{new Date(e.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</Celula>
            <Celula>
              <Selo cor={COR[e.tipo] ?? "cinza"}>{ROTULO[e.tipo] ?? e.tipo}</Selo>
            </Celula>
            <Celula>
              {e.tipo === "excluido" ? (
                <span className="text-texto-2">{(e.pessoa_id && nomePessoa.get(e.pessoa_id)) ?? "—"}</span>
              ) : (
                <Link href={`/repasses/${e.repasse_id}`} className="text-acento hover:underline">
                  {(e.pessoa_id && nomePessoa.get(e.pessoa_id)) ?? "abrir repasse"}
                </Link>
              )}
            </Celula>
            <Celula className="text-texto-2">{e.descricao ?? "—"}</Celula>
            <Celula className="tabular-nums">{e.valor !== null ? formatarReais(e.valor) : "—"}</Celula>
            <Celula className="text-texto-2">{e.usuario_id ? (nomes.get(e.usuario_id) ?? "usuário") : "sistema"}</Celula>
          </tr>
        ))}
        {eventos.length === 0 && <LinhaVazia colunas={6}>Nada registrado neste período.</LinhaVazia>}
      </Tabela>
    </>
  );
}
