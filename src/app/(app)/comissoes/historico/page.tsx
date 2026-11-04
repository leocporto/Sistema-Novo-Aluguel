import type { Metadata } from "next";
import Link from "next/link";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasComissoes } from "../abas";

export const metadata: Metadata = { title: "Histórico de comissões" };

const TIPOS: Record<string, string> = { criada: "Criadas", liberada: "Liberadas", paga: "Pagas", ajuste: "Ajustes", estornada: "Estornos", cancelada: "Canceladas" };
const ROTULO: Record<string, string> = {
  criada: "Criada",
  liberada: "Liberada",
  paga: "Paga",
  ajuste: "Ajuste",
  estornada: "Estornada",
  cancelada: "Cancelada",
  pagamento_desfeito: "Pagamento desfeito",
  transferida: "Transferida",
  excluida: "Excluída",
};
const COR: Record<string, "azul" | "verde" | "amarelo" | "vermelho" | "cinza"> = {
  liberada: "azul",
  paga: "verde",
  ajuste: "amarelo",
  estornada: "vermelho",
  excluida: "vermelho",
  pagamento_desfeito: "vermelho",
};

/** Tudo o que aconteceu com as comissões: criação, liberação, pagamento, ajustes e estornos (com motivo). Não se apaga. */
export default async function HistoricoComissoesPage({ searchParams }: PageProps<"/comissoes/historico">) {
  const sp = await searchParams;
  const tipo = typeof sp.tipo === "string" && sp.tipo in TIPOS ? sp.tipo : "";
  const hoje = hojeISO();
  const de = typeof sp.de === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.de) ? sp.de : somarDias(hoje, -30);
  const { supabase } = await obterContexto();
  let q = supabase.from("comissao_eventos").select("*").gte("data", `${de}T00:00:00`).order("data", { ascending: false }).limit(500);
  if (tipo) q = q.eq("tipo", tipo);
  const [{ data }, { data: membros }, { data: pessoas }] = await Promise.all([
    q,
    supabase.from("membros").select("user_id, nome").limit(500),
    supabase.from("pessoas").select("id, nome").overlaps("papeis", ["corretor", "parceiro"]).limit(5000),
  ]);
  const nomes = new Map((membros ?? []).map((m) => [m.user_id as string, (m.nome as string | null) ?? "usuário"]));
  const nomePessoa = new Map((pessoas ?? []).map((p) => [p.id as string, p.nome as string]));
  const eventos = (data ?? []) as { id: string; comissao_id: string; pessoa_id: string | null; tipo: string; descricao: string | null; valor: number | null; usuario_id: string | null; data: string }[];
  const url = (k: string) => `/comissoes/historico?de=${de}${k ? `&tipo=${k}` : ""}`;

  return (
    <>
      <Cabecalho titulo="Histórico de comissões" trilha="Comissões" descricao="Registro automático: quem criou, liberou, pagou, ajustou ou estornou cada comissão, com o motivo. Serve de auditoria e não pode ser apagado." />
      <AbasComissoes />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Tipo de registro" ativo={url(tipo)} itens={[{ href: url(""), rotulo: "Tudo" }, ...Object.entries(TIPOS).map(([k, r]) => ({ href: url(k), rotulo: r }))]} />
        <FiltroAutomatico className="flex items-center gap-2">
          {tipo && <input type="hidden" name="tipo" value={tipo} />}
          <span className="text-sm text-texto-2">Desde</span>
          <Entrada type="date" name="de" aria-label="Mostrar desde" defaultValue={de} className="w-44" />
        </FiltroAutomatico>
      </div>
      <Tabela colunas={["Quando", "O que", "Corretor", "Detalhe", "Valor", "Quem"]}>
        {eventos.map((e) => (
          <tr key={e.id}>
            <Celula>{new Date(e.data).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" })}</Celula>
            <Celula>
              <Selo cor={COR[e.tipo] ?? "cinza"}>{ROTULO[e.tipo] ?? e.tipo}</Selo>
            </Celula>
            <Celula>
              {e.tipo === "excluida" ? (
                <span className="text-texto-2">{(e.pessoa_id && nomePessoa.get(e.pessoa_id)) ?? "—"}</span>
              ) : (
                <Link href={`/comissoes/${e.comissao_id}`} className="text-acento hover:underline">
                  {(e.pessoa_id && nomePessoa.get(e.pessoa_id)) ?? "abrir comissão"}
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
