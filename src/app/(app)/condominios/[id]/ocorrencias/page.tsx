import type { Metadata } from "next";
import Link from "next/link";
import { MessageSquareWarning, Plus } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Campo, Celula, Entrada, Grade, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COR_STATUS_OCORRENCIA, STATUS_OCORRENCIA, TIPOS_OCORRENCIA, nomeUnidade } from "@/lib/dominio/condominios";
import { formatarDataLocal } from "@/lib/dominio/datas";
import { criarOcorrencia } from "../../actions-gestao";
import { unidadesDo, vinculosDo } from "../../dados";

export const metadata: Metadata = { title: "Ocorrências do condomínio" };

const FILTROS: Record<string, { rotulo: string; status: string[] | null }> = {
  "": { rotulo: "Em aberto", status: ["aberta", "em_andamento"] },
  resolvidas: { rotulo: "Resolvidas", status: ["resolvida"] },
  todas: { rotulo: "Todas", status: null },
};

/** Solicitações e ocorrências (manutenção, barulho, segurança, sugestão, reclamação) — da equipe ou do portal do condômino. */
export default async function OcorrenciasPage({ params, searchParams }: PageProps<"/condominios/[id]/ocorrencias">) {
  const { id } = await params;
  const sp = await searchParams;
  const filtro = typeof sp.filtro === "string" && sp.filtro in FILTROS ? sp.filtro : "";
  const { supabase } = await obterContexto();
  let q = supabase
    .from("cond_ocorrencias")
    .select("id, numero, tipo, titulo, status, origem, created_at, fotos, unidade_id, pessoa:pessoas(nome)")
    .eq("condominio_id", id)
    .order("created_at", { ascending: false })
    .limit(300);
  const st = FILTROS[filtro].status;
  if (st) q = q.in("status", st);
  const [{ data }, unidades, vinculos] = await Promise.all([q, unidadesDo(supabase, id), vinculosDo(supabase, id)]);
  const lista = (data ?? []) as unknown as { id: string; numero: number; tipo: string; titulo: string; status: string; origem: string; created_at: string; fotos: string[]; unidade_id: string | null; pessoa: { nome: string } | null }[];
  const nomeU = new Map(unidades.map((u) => [u.id, nomeUnidade(u)]));
  const pessoas = [...new Map(vinculos.filter((v) => v.pessoa).map((v) => [v.pessoa_id, v.pessoa!.nome])).entries()].sort((a, b) => a[1].localeCompare(b[1], "pt-BR"));
  const base = `/condominios/${id}/ocorrencias`;
  const url = (k: string) => (k ? `${base}?filtro=${k}` : base);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PilulasLink rotulo="Situação" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, v]) => ({ href: url(k), rotulo: v.rotulo }))} />
        <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova ocorrência</>} titulo="Registrar ocorrência" acao={criarOcorrencia} icone={<MessageSquareWarning />} rotuloSalvar="Registrar">
          <input type="hidden" name="condominio_id" value={id} />
          <Grade colunas={2}>
            <Campo rotulo="Tipo">
              <Selecao name="tipo" defaultValue="manutencao">
                {Object.entries(TIPOS_OCORRENCIA).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Unidade">
              <Selecao name="unidade_id" defaultValue="">
                <option value="">Área comum / geral</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {nomeUnidade(u)}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Quem avisou">
              <Selecao name="pessoa_id" defaultValue="">
                <option value="">—</option>
                {pessoas.map(([pid, nome]) => (
                  <option key={pid} value={pid}>
                    {nome}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Assunto">
              <Entrada name="titulo" required placeholder="Ex.: Vazamento na garagem" />
            </Campo>
          </Grade>
          <Campo rotulo="Descrição">
            <AreaTexto name="descricao" rows={4} />
          </Campo>
        </JanelaCadastro>
      </div>
      <Tabela colunas={["Nº", "Ocorrência", "Unidade", "Quem avisou", "Aberta em", "Situação"]}>
        {lista.map((o) => (
          <LinhaLink key={o.id} href={`${base}/${o.id}`}>
            <Celula className="tabular-nums text-mudo">#{o.numero}</Celula>
            <Celula>
              <Link href={`${base}/${o.id}`} className="font-medium text-texto hover:underline">
                {o.titulo}
              </Link>
              <span className="block text-xs text-mudo">
                {TIPOS_OCORRENCIA[o.tipo as keyof typeof TIPOS_OCORRENCIA] ?? o.tipo}
                {o.origem === "portal" ? " · pelo portal" : ""}
                {o.fotos.length ? ` · ${o.fotos.length} foto(s)` : ""}
              </span>
            </Celula>
            <Celula className="text-sm text-texto-2">{o.unidade_id ? nomeU.get(o.unidade_id) : "área comum"}</Celula>
            <Celula className="text-sm text-texto-2">{o.pessoa?.nome ?? "—"}</Celula>
            <Celula className="text-sm text-texto-2">{formatarDataLocal(o.created_at)}</Celula>
            <Celula>
              <Selo cor={COR_STATUS_OCORRENCIA[o.status] ?? "cinza"}>{STATUS_OCORRENCIA[o.status as keyof typeof STATUS_OCORRENCIA] ?? o.status}</Selo>
            </Celula>
          </LinhaLink>
        ))}
        {lista.length === 0 && <LinhaVazia colunas={6}>Nenhuma ocorrência aqui.</LinhaVazia>}
      </Tabela>
    </div>
  );
}
