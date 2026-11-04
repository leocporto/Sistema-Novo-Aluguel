import type { Metadata } from "next";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { Cabecalho, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { COR_ACAO_AUDITORIA, ROTULO_ACAO_AUDITORIA, TABELAS_AUDITADAS, tituloRegistro, valorAuditoria } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../abas";
import { carregarMembros, contextoEquipe, nomeDoMembro } from "../dados";

export const metadata: Metadata = { title: "Histórico de ações" };

const POR_PAGINA = 100;
const quando = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

/** Para onde leva cada registro (quando há uma ficha). */
const LINK: Record<string, (id: string) => string> = {
  imoveis: (id) => `/imoveis/${id}`,
  contratos: (id) => `/contratos/${id}`,
  pessoas: (id) => `/pessoas/${id}`,
  faturas: (id) => `/faturas/${id}`,
  perfis_acesso: (id) => `/equipe/perfis/${id}`,
  equipe_tarefas: (id) => `/equipe/tarefas/${id}`,
  equipe_onboardings: (id) => `/equipe/onboarding/${id}`,
  equipe_onboarding_modelos: (id) => `/equipe/onboarding/modelos/${id}`,
};

type Linha = {
  id: string;
  usuario_id: string | null;
  tabela: string;
  registro_id: string | null;
  acao: "insert" | "update" | "delete";
  campos: string[];
  antes: Record<string, unknown> | null;
  depois: Record<string, unknown> | null;
  data: string;
};

export default async function HistoricoAcoesPage({ searchParams }: PageProps<"/equipe/historico">) {
  await exigirVerRota("/equipe/historico");
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const hoje = hojeISO();
  const de = /^\d{4}-\d{2}-\d{2}$/.test(s("de")) ? s("de") : somarDias(hoje, -30);
  const ate = /^\d{4}-\d{2}-\d{2}$/.test(s("ate")) ? s("ate") : hoje;
  const usuarioF = s("usuario");
  const tabela = s("tabela") in TABELAS_AUDITADAS ? s("tabela") : "";
  const acao = s("acao") in ROTULO_ACAO_AUDITORIA ? s("acao") : "";
  const registro = s("registro");
  const pagina = Math.max(1, Number(s("pagina")) || 1);
  const { supabase } = await contextoEquipe();

  let q = supabase
    .from("auditoria")
    .select("id, usuario_id, tabela, registro_id, acao, campos, antes, depois, data")
    .gte("data", `${de}T00:00:00-03:00`)
    .lt("data", `${somarDias(ate, 1)}T00:00:00-03:00`)
    .order("data", { ascending: false })
    .range((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  if (usuarioF === "sistema") q = q.is("usuario_id", null);
  else if (usuarioF) q = q.eq("usuario_id", usuarioF);
  if (tabela) q = q.eq("tabela", tabela);
  if (acao) q = q.eq("acao", acao);
  if (registro) q = q.eq("registro_id", registro);
  const [{ data, error }, membros] = await Promise.all([q, carregarMembros(supabase)]);
  const linhas = ((data ?? []) as Linha[]).slice(0, POR_PAGINA);
  const temMais = (data ?? []).length > POR_PAGINA;
  const nomes = new Map(membros.map((m) => [m.user_id, nomeDoMembro(m)]));
  const url = (p: number) => {
    const q2 = new URLSearchParams(Object.entries({ de, ate, usuario: usuarioF, tabela, acao, registro, pagina: p > 1 ? String(p) : "" }).filter(([, v]) => v) as [string, string][]);
    return `/equipe/historico?${q2}`;
  };

  return (
    <>
      <Cabecalho
        titulo="Histórico de ações"
        trilha="Equipe"
        descricao="Quem criou, mudou ou excluiu o quê: imóveis, contratos, pessoas, aluguéis, financeiro, repasses, usuários, perfis, configurações e a gestão da equipe. Não se apaga nem se altera."
      />
      <AbasEquipe />
      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Entrada type="date" name="de" defaultValue={de} aria-label="De" className="max-w-44" />
        <Entrada type="date" name="ate" defaultValue={ate} aria-label="Até" className="max-w-44" />
        <Selecao name="usuario" defaultValue={usuarioF} aria-label="Usuário" className="max-w-56">
          <option value="">Todos os usuários</option>
          {membros.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {nomeDoMembro(m)}
            </option>
          ))}
          <option value="sistema">Sistema / link público</option>
        </Selecao>
        <Selecao name="tabela" defaultValue={tabela} aria-label="O que mudou" className="max-w-60">
          <option value="">Tudo</option>
          {Object.entries(TABELAS_AUDITADAS).map(([k, r]) => (
            <option key={k} value={k}>
              {r}
            </option>
          ))}
        </Selecao>
        <Selecao name="acao" defaultValue={acao} aria-label="Ação" className="max-w-44">
          <option value="">Qualquer ação</option>
          {Object.entries(ROTULO_ACAO_AUDITORIA).map(([k, r]) => (
            <option key={k} value={k}>
              {r}
            </option>
          ))}
        </Selecao>
        {registro && <input type="hidden" name="registro" value={registro} />}
      </FiltroAutomatico>
      {error && <p className="mb-4 text-sm text-ruim">Não foi possível ler o histórico: {error.message}</p>}
      <Tabela colunas={["Quando", "Quem", "Ação", "O quê", "Mudanças"]}>
        {linhas.length === 0 && <LinhaVazia colunas={5}>Nada neste período com esses filtros.</LinhaVazia>}
        {linhas.map((l) => {
          const dados = l.depois ?? l.antes;
          const titulo = tituloRegistro(l.acao === "update" ? { ...(l.antes ?? {}), ...(l.depois ?? {}) } : dados);
          const link = l.registro_id && l.acao !== "delete" ? LINK[l.tabela]?.(l.registro_id) : null;
          return (
            <tr key={l.id}>
              <Celula className="whitespace-nowrap text-sm">{quando.format(new Date(l.data))}</Celula>
              <Celula className="text-sm">{l.usuario_id ? (nomes.get(l.usuario_id) ?? "ex-usuário") : <span className="text-mudo">sistema</span>}</Celula>
              <Celula>
                <Selo cor={COR_ACAO_AUDITORIA[l.acao]}>{ROTULO_ACAO_AUDITORIA[l.acao]}</Selo>
              </Celula>
              <Celula>
                <span className="text-sm text-texto">{TABELAS_AUDITADAS[l.tabela] ?? l.tabela}</span>
                <span className="block text-xs text-mudo">
                  {link ? (
                    <Link href={link} className="text-acento hover:underline">
                      {titulo ?? "abrir"}
                    </Link>
                  ) : (
                    (titulo ?? "")
                  )}
                  {l.registro_id && (
                    <Link href={`/equipe/historico?registro=${l.registro_id}&de=${somarDias(hoje, -3650)}`} className="ml-2 text-mudo hover:underline">
                      ver tudo deste registro
                    </Link>
                  )}
                </span>
              </Celula>
              <Celula className="max-w-[520px] text-xs text-texto-2">
                {l.acao === "update" ? (
                  <ul className="space-y-0.5">
                    {l.campos.slice(0, 6).map((c) => (
                      <li key={c}>
                        <span className="font-mono text-[11px] text-mudo">{c}</span>: {valorAuditoria(l.antes?.[c])} → <span className="text-texto">{valorAuditoria(l.depois?.[c])}</span>
                      </li>
                    ))}
                    {l.campos.length > 6 && <li className="text-mudo">e mais {l.campos.length - 6} campo(s)</li>}
                  </ul>
                ) : l.acao === "insert" ? (
                  "registro criado"
                ) : (
                  "registro excluído"
                )}
              </Celula>
            </tr>
          );
        })}
      </Tabela>
      {(pagina > 1 || temMais) && (
        <div className="mt-4 flex items-center justify-end gap-2">
          {pagina > 1 && (
            <Link href={url(pagina - 1)} className={classeBotao("secundario")} aria-label="Página anterior">
              <ChevronLeft className="size-4" /> Anterior
            </Link>
          )}
          <span className="text-sm text-mudo">página {pagina}</span>
          {temMais && (
            <Link href={url(pagina + 1)} className={classeBotao("secundario")} aria-label="Próxima página">
              Próxima <ChevronRight className="size-4" />
            </Link>
          )}
        </div>
      )}
    </>
  );
}
