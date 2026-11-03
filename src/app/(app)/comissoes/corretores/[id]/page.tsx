import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CalendarClock, CircleCheck, Clock, MessageCircle, RotateCcw } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoImprimir } from "@/components/formulario";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cartao, Celula, Indicador, LinhaVazia, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import {
  COR_STATUS_COMISSAO,
  ROTULO_STATUS_COMISSAO,
  ROTULO_TIPO_COMISSAO,
  SEM_REGRA,
  dataEsperada,
  descreverRegra,
  escolherRegra,
  mensagemCorretor,
  totaisComissoes,
  type TipoRegra,
} from "@/lib/dominio/comissoes";
import { comissaoTotal, dividirComissao } from "@/lib/dominio/vendas";
import { linkWhatsapp } from "@/lib/whatsapp";
import { carregarBaseComissoes, type Comissao } from "../../dados";

export const metadata: Metadata = { title: "Relatório do corretor" };

type C = Comissao & { imovel: { codigo: string } | null; lancamento: { liquidado_em: string | null } | null };
type V = { id: string; numero: number; valor: number; comissao_pct: number; comissao_valor: number | null; status: string; imovel: { codigo: string } | null; venda_comissoes: { id: string; pessoa_id: string | null; percentual: number; papel: string }[] };

/** Relatório individual do corretor: regras que valem para ele, comissões do ano e o que está por vir. */
export default async function RelatorioCorretorPage({ params, searchParams }: PageProps<"/comissoes/corretores/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const hoje = hojeISO();
  const ano = typeof sp.ano === "string" && /^\d{4}$/.test(sp.ano) ? sp.ano : hoje.slice(0, 4);
  const { supabase, organizacao } = await obterContexto();
  const [{ data: pessoa }, { data }, base, { data: vendas }, { data: devolucoes }] = await Promise.all([
    supabase.from("pessoas").select("id, nome, telefone, email, documento").eq("id", id).maybeSingle(),
    supabase
      .from("comissoes")
      .select("*, imovel:imoveis(codigo), lancamento:lancamentos!comissoes_lancamento_id_fkey(liquidado_em)")
      .eq("pessoa_id", id)
      .order("created_at", { ascending: false })
      .limit(2000),
    carregarBaseComissoes(supabase),
    supabase
      .from("vendas")
      .select("id, numero, valor, comissao_pct, comissao_valor, status, imovel:imoveis(codigo), venda_comissoes!inner(id, pessoa_id, percentual, papel)")
      .eq("venda_comissoes.pessoa_id", id)
      .not("status", "in", "(concluida,cancelada)")
      .limit(500),
    // Devoluções de comissão (estorno ou ajuste para menos) que ele ainda deve.
    supabase.from("lancamentos").select("valor").eq("pessoa_id", id).not("comissao_devolucao_id", "is", null).eq("status", "aberto").limit(1000),
  ]);
  if (!pessoa) notFound();
  const todas = (data ?? []) as unknown as C[];
  const doAno = todas.filter((c) =>
    c.status === "prevista" || c.status === "a_pagar" ? true : (c.status === "paga" ? (c.lancamento?.liquidado_em ?? c.created_at) : c.created_at).slice(0, 4) === ano,
  );
  const t = totaisComissoes(doAno, hoje);
  const aDevolver = paraReais((devolucoes ?? []).reduce((s, d) => s + paraCentavos(d.valor), 0));
  const equipeId = base.equipeDe.get(id) ?? null;
  const equipe = base.equipes.find((e) => e.id === equipeId);
  const tipos: TipoRegra[] = ["venda", "locacao", "angariacao", "administracao"];
  // Vendas em andamento em que ele está na divisão (quanto recebe se concluir).
  const emAndamento = ((vendas ?? []) as unknown as V[]).map((v) => {
    const partes = v.venda_comissoes.filter((c) => c.papel !== "imobiliaria" && c.pessoa_id).sort((a, b) => a.id.localeCompare(b.id));
    let parte = 0;
    try {
      const d = dividirComissao(comissaoTotal(Number(v.valor), Number(v.comissao_pct), v.comissao_valor == null ? null : Number(v.comissao_valor)), partes.map((p) => ({ percentual: Number(p.percentual) })));
      parte = partes.reduce((s, p, i) => (p.pessoa_id === id ? s + d.porPessoa[i] : s), 0);
    } catch {
      parte = 0;
    }
    return { ...v, parte };
  });
  const anos = [0, 1, 2].map((i) => String(Number(hoje.slice(0, 4)) - i));
  const msg = mensagemCorretor(pessoa.nome, ano, t);

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="nao-imprimir flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/comissoes/corretores" className="text-acento-hot hover:underline">
              Comissões por corretor
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{pessoa.nome}</h1>
          <div className="mt-2 text-[13.5px] text-texto-2">
            Relatório de comissões · {ano}
            {equipe ? ` · equipe ${equipe.nome}` : ""} · {organizacao.nome}
          </div>
        </div>
        <div className="nao-imprimir flex flex-wrap items-center gap-2">
          {pessoa.telefone && (
            <a href={linkWhatsapp(pessoa.telefone, msg)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
          <BotaoImprimir />
        </div>
      </div>
      <div className="nao-imprimir">
        <PilulasLink className="mb-5" rotulo="Ano" ativo={`/comissoes/corretores/${id}?ano=${ano}`} itens={anos.map((a) => ({ href: `/comissoes/corretores/${id}?ano=${a}`, rotulo: a }))} />
      </div>
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Previstas" icone={<Clock />} valor={<Contador valor={t.previstas} formato="moeda" />} detalhe="aguardando recebimento" />
        <Indicador rotulo="A pagar" icone={<CalendarClock />} valor={<Contador valor={t.aPagar} formato="moeda" />} tom={t.vencidas ? "perigo" : "alerta"} detalhe={t.vencidas ? `${formatarReais(t.vencidas)} vencidas` : undefined} />
        <Indicador rotulo={`Pagas em ${ano}`} icone={<CircleCheck />} valor={<Contador valor={t.pagas} formato="moeda" />} tom="sucesso" />
        <Indicador
          rotulo={`Estornadas em ${ano}`}
          icone={<RotateCcw />}
          valor={<Contador valor={t.estornadas} formato="moeda" />}
          detalhe={aDevolver ? `${formatarReais(aDevolver)} a devolver (estornos e ajustes)` : undefined}
          tom={aDevolver ? "alerta" : "neutro"}
        />
      </div>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Tabela colunas={["Data", "Tipo", "Descrição", "Valor", "Paga em / previsão", "Situação"]}>
          {doAno.length === 0 && <LinhaVazia colunas={6}>Nenhuma comissão em {ano}.</LinhaVazia>}
          {doAno.map((c) => {
            const quando = c.status === "paga" ? c.lancamento?.liquidado_em : dataEsperada(c);
            return (
              <LinhaLink key={c.id} href={`/comissoes/${c.id}`}>
                <Celula>{formatarDataBR(c.created_at.slice(0, 10))}</Celula>
                <Celula>{ROTULO_TIPO_COMISSAO[c.tipo]}</Celula>
                <Celula>
                  {c.descricao}
                  {c.motivo && <span className="block text-xs text-mudo">{c.motivo}</span>}
                </Celula>
                <Celula className="font-semibold tabular-nums">{formatarReais(c.valor)}</Celula>
                <Celula>{formatarDataBR(quando ?? null)}</Celula>
                <Celula>
                  <Selo cor={COR_STATUS_COMISSAO[c.status]}>{ROTULO_STATUS_COMISSAO[c.status]}</Selo>
                </Celula>
              </LinhaLink>
            );
          })}
        </Tabela>
        <div className="space-y-6">
          <Cartao titulo="Regras que valem para ele">
            <ul className="space-y-2 text-sm">
              {tipos.map((tp) => {
                const r = escolherRegra(base.regras, tp, id, equipeId);
                return (
                  <li key={tp}>
                    <b>{ROTULO_TIPO_COMISSAO[tp]}:</b>{" "}
                    {r ? (
                      <>
                        {descreverRegra(r)} <span className="text-xs text-mudo">({r.pessoa_id ? "dele" : r.equipe_id ? "da equipe" : "geral"})</span>
                      </>
                    ) : (
                      `sem regra: ${SEM_REGRA[tp]}`
                    )}
                  </li>
                );
              })}
            </ul>
          </Cartao>
          <Cartao titulo="Vendas em andamento">
            <ul className="divide-y divide-borda-suave text-sm">
              {emAndamento.map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-3 py-2">
                  <Link href={`/vendas/${v.id}/comissoes`} className="hover:underline">
                    Venda #{v.numero} {v.imovel ? `· ${v.imovel.codigo}` : ""}
                  </Link>
                  <span className="tabular-nums">{formatarReais(v.parte)}</span>
                </li>
              ))}
              {emAndamento.length === 0 && <li className="py-2 text-mudo">Nenhuma venda em andamento com ele na divisão.</li>}
            </ul>
            <p className="mt-2 text-xs text-mudo">Valor que ele recebe se a venda for concluída.</p>
          </Cartao>
        </div>
      </div>
    </>
  );
}
