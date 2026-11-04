import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Activity, CircleDollarSign, Cpu, TriangleAlert } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import {
  ABAS_HISTORICO,
  COR_STATUS_ACAO,
  GATILHOS_IA,
  ROTULO_GATILHO_IA,
  ROTULO_RECURSO,
  ROTULO_STATUS_ACAO,
  ROTULO_STATUS_EXECUCAO,
  ROTULO_TIPO_ACAO,
  recursosDoModo,
  type StatusAcaoIA,
  type TipoAcaoIA,
} from "@/lib/dominio/ia";
import { AbasInteligencia } from "../abas";
import { ContadorDolar } from "../contador-dolar";
import { nomesUsuarios, quando } from "../dados";

export const metadata: Metadata = { title: "Histórico de execuções e decisões" };

const dataOk = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * Histórico (só leitura) das chamadas à IA, dos disparos das automações e das
 * decisões humanas sobre as ações sugeridas. Cada um vê o seu; administrador e
 * gestor veem tudo (o banco filtra).
 */
export default async function HistoricoPage({ searchParams }: PageProps<"/inteligencia/historico">) {
  const sp = await searchParams;
  const { supabase, organizacao, papel } = await obterContexto();
  const aba = sp.aba === "automacoes" || sp.aba === "decisoes" ? sp.aba : "ia";
  const hoje = hojeISO();
  const de = dataOk(sp.de) ? sp.de : somarDias(hoje, -30);
  const ate = dataOk(sp.ate) ? sp.ate : hoje;
  const usuario = typeof sp.usuario === "string" && UUID.test(sp.usuario) ? sp.usuario : "";
  const recurso = typeof sp.recurso === "string" ? sp.recurso : "";
  const status = typeof sp.status === "string" ? sp.status : "";
  const nomes = await nomesUsuarios(supabase);
  const gestao = papel === "admin" || papel === "gestor";
  const ate1 = somarDias(ate, 1);
  const base = "/inteligencia/historico";
  const qs = (a: string) => `${base}?aba=${a}&de=${de}&ate=${ate}`;

  let tabela: ReactNode = null;
  let indicadores: ReactNode = null;
  if (aba === "ia") {
    const recursos = recursosDoModo(organizacao.modo);
    let q = supabase
      .from("ia_execucoes")
      .select("id, usuario_id, recurso, entrada_resumo, status, erro, tokens_entrada, tokens_saida, custo_estimado, duracao_ms, criado_em")
      .gte("dia", de)
      .lte("dia", ate)
      .order("criado_em", { ascending: false })
      .limit(200);
    if (usuario) q = q.eq("usuario_id", usuario);
    if (recursos.includes(recurso as never)) q = q.eq("recurso", recurso);
    if (["ok", "erro", "reservada"].includes(status)) q = q.eq("status", status);
    const [{ data }, { data: uso }] = await Promise.all([
      q,
      supabase.rpc("ia_uso_resumo", { p_de: de, p_ate: ate, p_usuario: usuario || null, p_recurso: recursos.includes(recurso as never) ? recurso : null }),
    ]);
    const u = (uso ?? {}) as { chamadas?: number; erros?: number; tokens_entrada?: number; tokens_saida?: number; custo?: number; duracao_media_ms?: number };
    const linhas = (data ?? []) as {
      id: string;
      usuario_id: string | null;
      recurso: string;
      entrada_resumo: string | null;
      status: string;
      erro: string | null;
      tokens_entrada: number;
      tokens_saida: number;
      custo_estimado: number;
      duracao_ms: number | null;
      criado_em: string;
    }[];
    indicadores = (
      <div className="entrar-cascata mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Chamadas à IA" valor={<Contador valor={Number(u.chamadas ?? 0)} />} icone={<Activity />} detalhe={`média ${Math.round(Number(u.duracao_media_ms ?? 0) / 100) / 10} s`} />
        <Indicador rotulo="Com erro" valor={<Contador valor={Number(u.erros ?? 0)} />} icone={<TriangleAlert />} tom={u.erros ? "alerta" : "neutro"} />
        <Indicador
          rotulo="Tokens (entrada / saída)"
          valor={
            <span className="text-[22px]">
              <Contador valor={Number(u.tokens_entrada ?? 0)} /> / <Contador valor={Number(u.tokens_saida ?? 0)} />
            </span>
          }
          icone={<Cpu />}
        />
        <Indicador rotulo="Custo estimado (US$)" valor={<ContadorDolar valor={Number(u.custo ?? 0)} />} icone={<CircleDollarSign />} detalhe="pelo preço por milhão de tokens das Configurações" />
      </div>
    );
    tabela = (
      <>
        <FiltroAutomatico>
          <input type="hidden" name="aba" value="ia" />
          <Entrada type="date" name="de" defaultValue={de} aria-label="De" className="w-auto" />
          <Entrada type="date" name="ate" defaultValue={ate} aria-label="Até" className="w-auto" />
          <Selecao name="recurso" defaultValue={recurso} aria-label="Recurso" className="w-auto">
            <option value="">Todos os recursos</option>
            {recursos.map((r) => (
              <option key={r} value={r}>
                {ROTULO_RECURSO[r]}
              </option>
            ))}
          </Selecao>
          <Selecao name="status" defaultValue={status} aria-label="Situação" className="w-auto">
            <option value="">Todas as situações</option>
            <option value="ok">Concluídas</option>
            <option value="erro">Com erro</option>
            <option value="reservada">Em andamento</option>
          </Selecao>
          {gestao && (
            <Selecao name="usuario" defaultValue={usuario} aria-label="Usuário" className="w-auto">
              <option value="">Todos os usuários</option>
              {[...nomes.entries()].map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Selecao>
          )}
        </FiltroAutomatico>
        <Tabela colunas={["Quando", "Recurso", "Quem", "Pedido (sem dados pessoais)", "Tokens", "Custo (US$)", "Situação"]}>
          {linhas.length === 0 ? (
            <LinhaVazia colunas={7}>Nenhuma chamada à IA no período.</LinhaVazia>
          ) : (
            linhas.map((l) => (
              <tr key={l.id}>
                <Celula className="whitespace-nowrap text-texto-2">{quando(l.criado_em)}</Celula>
                <Celula className="whitespace-nowrap">{ROTULO_RECURSO[l.recurso as keyof typeof ROTULO_RECURSO] ?? l.recurso}</Celula>
                <Celula className="whitespace-nowrap">{l.usuario_id ? (nomes.get(l.usuario_id) ?? "Usuário") : "—"}</Celula>
                <Celula className="max-w-[360px] text-[13px] text-texto-2">
                  {l.entrada_resumo ?? "—"}
                  {l.erro && <div className="text-xs text-ruim">{l.erro}</div>}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums text-[13px]">
                  {l.tokens_entrada.toLocaleString("pt-BR")} / {l.tokens_saida.toLocaleString("pt-BR")}
                </Celula>
                <Celula className="tabular-nums text-[13px]">{Number(l.custo_estimado).toFixed(4)}</Celula>
                <Celula>
                  <Selo cor={l.status === "ok" ? "verde" : l.status === "erro" ? "vermelho" : "cinza"}>{ROTULO_STATUS_EXECUCAO[l.status] ?? l.status}</Selo>
                </Celula>
              </tr>
            ))
          )}
        </Tabela>
      </>
    );
  } else if (aba === "automacoes") {
    let q = supabase
      .from("automacoes_execucoes")
      .select("id, regra_id, regra_nome, gatilho, acao, objeto_nome, status, resultado, criado_em")
      .gte("criado_em", `${de}T03:00:00Z`)
      .lt("criado_em", `${ate1}T03:00:00Z`)
      .order("criado_em", { ascending: false })
      .limit(300);
    if ((GATILHOS_IA as readonly string[]).includes(recurso)) q = q.eq("gatilho", recurso);
    if (["ok", "erro", "ignorado"].includes(status)) q = q.eq("status", status);
    const { data } = await q;
    const linhas = (data ?? []) as { id: string; regra_id: string; regra_nome: string | null; gatilho: string; objeto_nome: string | null; status: string; resultado: string | null; criado_em: string }[];
    tabela = (
      <>
        <FiltroAutomatico>
          <input type="hidden" name="aba" value="automacoes" />
          <Entrada type="date" name="de" defaultValue={de} aria-label="De" className="w-auto" />
          <Entrada type="date" name="ate" defaultValue={ate} aria-label="Até" className="w-auto" />
          <Selecao name="recurso" defaultValue={recurso} aria-label="Gatilho" className="w-auto">
            <option value="">Todos os gatilhos</option>
            {GATILHOS_IA.map((g) => (
              <option key={g} value={g}>
                {ROTULO_GATILHO_IA[g]}
              </option>
            ))}
          </Selecao>
          <Selecao name="status" defaultValue={status} aria-label="Situação" className="w-auto">
            <option value="">Todas as situações</option>
            <option value="ok">Concluídas</option>
            <option value="erro">Com erro</option>
            <option value="ignorado">Ignoradas</option>
          </Selecao>
        </FiltroAutomatico>
        <Tabela colunas={["Quando", "Automação", "Gatilho", "Item", "Resultado", "Situação"]}>
          {linhas.length === 0 ? (
            <LinhaVazia colunas={6}>Nenhum disparo de automação no período.</LinhaVazia>
          ) : (
            linhas.map((l) => (
              <tr key={l.id}>
                <Celula className="whitespace-nowrap text-texto-2">{quando(l.criado_em)}</Celula>
                <Celula>
                  <Link href={`/inteligencia/automacoes/${l.regra_id}`} className="hover:text-acento">
                    {l.regra_nome ?? "Automação"}
                  </Link>
                </Celula>
                <Celula className="whitespace-nowrap text-texto-2">{ROTULO_GATILHO_IA[l.gatilho as keyof typeof ROTULO_GATILHO_IA] ?? l.gatilho}</Celula>
                <Celula>{l.objeto_nome ?? "—"}</Celula>
                <Celula className="text-[13px] text-texto-2">{l.resultado ?? "—"}</Celula>
                <Celula>
                  <Selo cor={l.status === "ok" ? "verde" : l.status === "erro" ? "vermelho" : "cinza"}>{ROTULO_STATUS_EXECUCAO[l.status] ?? l.status}</Selo>
                </Celula>
              </tr>
            ))
          )}
        </Tabela>
      </>
    );
  } else {
    let q = supabase
      .from("ia_acoes")
      .select("id, numero, tipo, origem, titulo, status, aprovacao_automatica, criada_por, decidida_por, decidida_em, motivo, executada_em, resultado, erro")
      .neq("status", "pendente")
      .gte("decidida_em", `${de}T03:00:00Z`)
      .lt("decidida_em", `${ate1}T03:00:00Z`)
      .order("decidida_em", { ascending: false })
      .limit(300);
    if (usuario) q = q.eq("decidida_por", usuario);
    if (["aprovada", "recusada", "executada", "erro", "cancelada"].includes(status)) q = q.eq("status", status);
    const { data } = await q;
    const linhas = (data ?? []) as {
      id: string;
      numero: number;
      tipo: TipoAcaoIA;
      titulo: string;
      status: StatusAcaoIA;
      aprovacao_automatica: boolean;
      criada_por: string | null;
      decidida_por: string | null;
      decidida_em: string | null;
      motivo: string | null;
      resultado: string | null;
      erro: string | null;
    }[];
    tabela = (
      <>
        <FiltroAutomatico>
          <input type="hidden" name="aba" value="decisoes" />
          <Entrada type="date" name="de" defaultValue={de} aria-label="De" className="w-auto" />
          <Entrada type="date" name="ate" defaultValue={ate} aria-label="Até" className="w-auto" />
          <Selecao name="status" defaultValue={status} aria-label="Decisão" className="w-auto">
            <option value="">Todas as decisões</option>
            {(["aprovada", "recusada", "executada", "erro", "cancelada"] as const).map((s) => (
              <option key={s} value={s}>
                {ROTULO_STATUS_ACAO[s]}
              </option>
            ))}
          </Selecao>
          <Selecao name="usuario" defaultValue={usuario} aria-label="Quem decidiu" className="w-auto">
            <option value="">Quem decidiu: todos</option>
            {[...nomes.entries()].map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
        <Tabela colunas={["Decidida em", "Ação", "O quê", "Decidiu", "Motivo / resultado", "Situação"]}>
          {linhas.length === 0 ? (
            <LinhaVazia colunas={6}>Nenhuma decisão no período.</LinhaVazia>
          ) : (
            linhas.map((l) => (
              <tr key={l.id}>
                <Celula className="whitespace-nowrap text-texto-2">{quando(l.decidida_em)}</Celula>
                <Celula className="whitespace-nowrap">{ROTULO_TIPO_ACAO[l.tipo]}</Celula>
                <Celula>
                  <Link href={`/inteligencia/acoes/${l.id}`} className="font-semibold hover:text-acento">
                    {l.titulo}
                  </Link>
                </Celula>
                <Celula className="whitespace-nowrap">{l.aprovacao_automatica ? "Regra do administrador" : l.decidida_por ? (nomes.get(l.decidida_por) ?? "Usuário") : "—"}</Celula>
                <Celula className="text-[13px] text-texto-2">{l.motivo ?? l.resultado ?? l.erro ?? "—"}</Celula>
                <Celula>
                  <Selo cor={COR_STATUS_ACAO[l.status]}>{ROTULO_STATUS_ACAO[l.status]}</Selo>
                </Celula>
              </tr>
            ))
          )}
        </Tabela>
      </>
    );
  }

  return (
    <>
      <Cabecalho
        titulo="Histórico"
        trilha="Assistente e automações"
        descricao="Tudo o que a IA e as automações fizeram e o que cada pessoa decidiu: chamadas à IA (com tokens e custo estimado, sem dados pessoais), disparos das automações e aprovações/recusas. Só leitura."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <PilulasLink className="mb-4" rotulo="O que ver" ativo={qs(aba)} itens={(Object.keys(ABAS_HISTORICO) as (keyof typeof ABAS_HISTORICO)[]).map((a) => ({ href: qs(a), rotulo: ABAS_HISTORICO[a] }))} />
      {indicadores}
      {tabela}
    </>
  );
}
