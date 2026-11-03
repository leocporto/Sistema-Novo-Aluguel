import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { NotebookPen } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR } from "@/lib/dominio/datas";
import { COR_STATUS_CHAMADO, ROTULO_STATUS_CHAMADO, textoGarantia } from "@/lib/dominio/manutencao";
import { registrarNota } from "../../actions";
import { carregarChamado } from "../../dados";

export const metadata: Metadata = { title: "Histórico do chamado" };

const ROTULO_EVENTO: Record<string, string> = {
  aberto: "Abertura",
  status: "Situação",
  urgencia: "Urgência",
  responsabilidade: "Quem paga",
  prestador: "Prestador",
  agenda: "Agenda",
  aprovacao: "Aprovação",
  orcamento: "Orçamento",
  financeiro: "Financeiro",
  confirmacao: "Locatário",
  avaliacao: "Avaliação",
  nota: "Anotação",
};

export default async function HistoricoChamado({ params }: PageProps<"/manutencao/[id]/historico">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const c = await carregarChamado(supabase, id);
  if (!c) notFound();
  const [{ data: eventos }, { data: membros }, { data: ligados }] = await Promise.all([
    supabase.from("chamado_eventos").select("id, tipo, descricao, usuario_id, data").eq("chamado_id", id).order("data", { ascending: false }).limit(500),
    supabase.from("membros").select("user_id, nome"),
    supabase
      .from("chamados")
      .select("id, numero, titulo, status, concluido_em, garantia_ate, created_at, chamado_origem_id")
      .or(`chamado_origem_id.eq.${id}${c.chamado_origem_id ? `,id.eq.${c.chamado_origem_id}` : ""}`)
      .order("created_at"),
  ]);
  const nomes = new Map((membros ?? []).map((m) => [m.user_id as string, (m.nome as string | null) ?? "equipe"]));
  type L = { id: string; numero: number; titulo: string; status: string; concluido_em: string | null; garantia_ate: string | null; created_at: string; chamado_origem_id: string | null };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Cartao
        titulo={`Histórico (${eventos?.length ?? 0})`}
        acoes={
          <JanelaCadastro rotuloBotao={<><NotebookPen className="size-3.5" /> Anotar</>} tamanho="sm" variante="secundario" titulo="Anotação no chamado" acao={registrarNota} icone={<NotebookPen />} rotuloSalvar="Anotar">
            <input type="hidden" name="id" value={id} />
            <Campo rotulo="Anotação">
              <AreaTexto name="descricao" required rows={4} placeholder="Liguei para o locatário; prestador pediu para voltar amanhã…" />
            </Campo>
          </JanelaCadastro>
        }
      >
        <p className="mb-4 text-xs text-mudo">O histórico é gravado sozinho e não pode ser alterado nem apagado.</p>
        <ol className="space-y-3">
          {(eventos ?? []).map((e) => (
            <li key={e.id as string} className="flex gap-3 border-l-2 border-borda pl-3">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-xs text-mudo">
                  <Selo cor={e.tipo === "nota" ? "cinza" : "azul"}>{ROTULO_EVENTO[e.tipo as string] ?? (e.tipo as string)}</Selo>
                  <span>
                    {formatarDataBR(diaLocal(e.data as string))} às {horaLocal(e.data as string)}
                  </span>
                  <span>· {e.usuario_id ? nomes.get(e.usuario_id as string) ?? "equipe" : "pelo link / sistema"}</span>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-texto">{e.descricao as string}</p>
              </div>
            </li>
          ))}
          {!eventos?.length && <li className="text-sm text-mudo">Nada registrado ainda.</li>}
        </ol>
      </Cartao>
      <div className="space-y-6">
        <Cartao titulo="Chamados ligados (garantia)">
          <ul className="space-y-3 text-sm">
            {((ligados ?? []) as L[]).map((x) => (
              <li key={x.id}>
                <Link href={`/manutencao/${x.id}`} className="font-medium text-acento hover:underline">
                  #{x.numero} · {x.titulo}
                </Link>
                <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mudo">
                  <Selo cor={COR_STATUS_CHAMADO[x.status as keyof typeof COR_STATUS_CHAMADO] ?? "cinza"}>{ROTULO_STATUS_CHAMADO[x.status]}</Selo>
                  {x.id === c.chamado_origem_id ? `serviço original · garantia ${textoGarantia(x.concluido_em, x.garantia_ate)}` : "retorno aberto na garantia deste serviço"}
                </span>
              </li>
            ))}
            {!ligados?.length && <li className="text-mudo">Nenhum chamado de garantia ligado a este.</li>}
          </ul>
        </Cartao>
        <Cartao titulo="Mais deste imóvel">
          <Link href={`/manutencao/historico?imovel=${c.imovel_id}`} className="text-sm text-acento hover:underline">
            Ver todos os reparos de {c.imovel?.codigo ?? "este imóvel"}
          </Link>
        </Cartao>
      </div>
    </div>
  );
}
