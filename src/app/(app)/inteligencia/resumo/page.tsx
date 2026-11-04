import type { Metadata } from "next";
import Link from "next/link";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Cartao, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { pode } from "@/lib/permissoes";
import { AbasInteligencia } from "../abas";
import type { FonteResumo } from "../actions";
import { AvisoIA } from "../componentes";
import { estadoIA, exigirOuVoltar, podeConfigurarIA } from "../dados";
import { Resumir } from "./resumir";

export const metadata: Metadata = { title: "Resumir conversas e anotações" };

/** Resumo automático: anotações da pessoa (nos dois modos), histórico do lead e conversas do WhatsApp (imobiliária). */
export default async function ResumoPage({ searchParams }: PageProps<"/inteligencia/resumo">) {
  const sp = await searchParams;
  const { supabase, organizacao, papel } = await obterContexto();
  await exigirOuVoltar("pessoas", "ver");
  const pessoal = organizacao.modo === "pessoal";
  const comercial = !pessoal && (await pode("comercial", "ver"));
  const fontes: FonteResumo[] = comercial ? ["pessoa", "lead", "conversa"] : ["pessoa"];
  const fonte = fontes.find((f) => f === sp.fonte) ?? "pessoa";
  const id = typeof sp.id === "string" ? sp.id : "";
  const ia = await estadoIA(supabase);

  let opcoes: { id: string; rotulo: string }[] = [];
  if (fonte === "pessoa") {
    const { data } = await supabase.from("pessoa_interacoes").select("pessoa_id, pessoa:pessoas(nome)").order("data", { ascending: false }).limit(400);
    const vistos = new Map<string, string>();
    for (const r of (data ?? []) as unknown as { pessoa_id: string; pessoa: { nome: string } | null }[]) if (!vistos.has(r.pessoa_id)) vistos.set(r.pessoa_id, r.pessoa?.nome ?? "Pessoa");
    opcoes = [...vistos.entries()].map(([k, v]) => ({ id: k, rotulo: v }));
  } else if (fonte === "lead") {
    const { data } = await supabase.from("leads").select("id, nome, status").order("created_at", { ascending: false }).limit(300);
    opcoes = ((data ?? []) as { id: string; nome: string; status: string }[]).map((l) => ({ id: l.id, rotulo: `${l.nome} (${l.status})` }));
  } else {
    const { data } = await supabase.from("mkt_conversas").select("id, nome, contato, ultima_em").order("ultima_em", { ascending: false, nullsFirst: false }).limit(300);
    opcoes = ((data ?? []) as { id: string; nome: string | null; contato: string }[]).map((c) => ({ id: c.id, rotulo: c.nome || c.contato }));
  }
  const escolhido = opcoes.find((o) => o.id === id);
  const ROTULO: Record<FonteResumo, string> = { pessoa: "Anotações de uma pessoa", lead: "Histórico de um lead", conversa: "Conversa do WhatsApp" };
  const LINK: Record<FonteResumo, string> = { pessoa: "/pessoas/", lead: "/comercial/leads/", conversa: "/marketing/conversas/" };

  return (
    <>
      <Cabecalho
        titulo="Resumir conversas e anotações"
        trilha="Assistente e automações"
        descricao="Um resumo do que já aconteceu para quem vai assumir o atendimento: fatos importantes, o que ficou pendente e o próximo passo. Telefones, e-mails e documentos não vão para a IA."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <AvisoIA configurada={ia.configurada} ativa={ia.config.ativa} podeConfigurar={podeConfigurarIA(papel)} />
        <div className="mb-4 flex flex-wrap items-center gap-3">
          {fontes.length > 1 && <PilulasLink rotulo="O que resumir" ativo={`/inteligencia/resumo?fonte=${fonte}`} itens={fontes.map((f) => ({ href: `/inteligencia/resumo?fonte=${f}`, rotulo: ROTULO[f] }))} />}
          <FiltroAutomatico className="flex flex-wrap gap-2">
            <input type="hidden" name="fonte" value={fonte} />
            <Selecao name="id" defaultValue={id} aria-label="Escolha o que resumir" className="max-w-xl">
              <option value="">Escolha…</option>
              {opcoes.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.rotulo}
                </option>
              ))}
            </Selecao>
          </FiltroAutomatico>
        </div>
        {!escolhido ? (
          <Aviso>{opcoes.length ? "Escolha na lista acima." : "Nada com histórico para resumir ainda."}</Aviso>
        ) : (
          <Cartao
            titulo={escolhido.rotulo}
            acoes={
              <Link href={`${LINK[fonte]}${escolhido.id}`} className="text-sm text-acento hover:underline">
                Abrir
              </Link>
            }
          >
            <Resumir key={`${fonte}-${escolhido.id}`} fonte={fonte} id={escolhido.id} />
          </Cartao>
        )}
      </div>
    </>
  );
}
