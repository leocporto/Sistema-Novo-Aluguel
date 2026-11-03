import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_CATEGORIA_CURTO, ROTULO_URGENCIA, rotuloResponsavel } from "@/lib/dominio/manutencao";
import { carregarChamado, contatoDoSolicitante, enderecoImovel } from "../../dados";

export const metadata: Metadata = { title: "Ordem de serviço" };

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[150px_1fr] gap-3 border-b border-borda-suave py-1.5 text-[13.5px]">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-mudo">{rotulo}</span>
      <span className="text-texto">{children || "—"}</span>
    </div>
  );
}

/** Ordem de serviço para imprimir e entregar ao prestador. */
export default async function OrdemServico({ params }: PageProps<"/manutencao/[id]/os">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const c = await carregarChamado(supabase, id);
  if (!c) notFound();
  const [{ data: orc }, contato] = await Promise.all([
    c.orcamento_id ? supabase.from("chamado_orcamentos").select("valor, prazo_dias, garantia_dias, descricao").eq("id", c.orcamento_id).maybeSingle() : Promise.resolve({ data: null }),
    contatoDoSolicitante(supabase, c),
  ]);
  const quando = c.agendado_para ? `${formatarDataBR(diaLocal(c.agendado_para))} às ${horaLocal(c.agendado_para)}` : "a combinar";

  return (
    <div className="space-y-4">
      <div className="nao-imprimir flex justify-end">
        <BotaoImprimir />
      </div>
      <article className="mx-auto max-w-3xl rounded-card border border-borda bg-card p-8 print:border-0 print:p-0">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-borda pb-4">
          <div>
            <div className="text-[17px] font-semibold text-texto">{organizacao.nome}</div>
            <div className="text-xs text-mudo">
              {[organizacao.documento ? formatarDocumento(organizacao.documento) : null, organizacao.telefone, organizacao.email].filter(Boolean).join(" · ")}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[20px] font-semibold text-texto">Ordem de serviço nº {c.numero}</div>
            <div className="text-xs text-mudo">emitida em {formatarDataBR(hojeISO())}</div>
          </div>
        </header>

        <section className="mb-5">
          <h2 className="mb-2 text-[14px] font-semibold text-texto">Local do serviço</h2>
          <Linha rotulo="Imóvel">{c.imovel ? `${c.imovel.codigo} — ${enderecoImovel(c.imovel)}` : null}</Linha>
          <Linha rotulo="Cômodo">{c.local}</Linha>
          <Linha rotulo="Contato no local">{contato ? `${contato.nome} · ${contato.telefone}` : null}</Linha>
          <Linha rotulo="Data e hora">{quando}</Linha>
        </section>

        <section className="mb-5">
          <h2 className="mb-2 text-[14px] font-semibold text-texto">Prestador</h2>
          <Linha rotulo="Nome">{c.prestador?.nome}</Linha>
          <Linha rotulo="Documento">{c.prestador?.documento ? formatarDocumento(c.prestador.documento) : null}</Linha>
          <Linha rotulo="Especialidade">{c.prestador?.especialidade}</Linha>
          <Linha rotulo="Telefone">{c.prestador?.telefone}</Linha>
        </section>

        <section className="mb-5">
          <h2 className="mb-2 text-[14px] font-semibold text-texto">Serviço</h2>
          <Linha rotulo="Problema">{c.titulo}</Linha>
          <Linha rotulo="Tipo">{ROTULO_CATEGORIA_CURTO[c.categoria] ?? c.categoria}</Linha>
          <Linha rotulo="Urgência">{ROTULO_URGENCIA[c.urgencia]}</Linha>
          <Linha rotulo="Detalhes">{c.descricao}</Linha>
          <Linha rotulo="Orçamento">{orc?.descricao}</Linha>
          <Linha rotulo="Valor aprovado">{c.valor_aprovado != null ? formatarReais(c.valor_aprovado) : null}</Linha>
          <Linha rotulo="Prazo">{orc?.prazo_dias != null ? `${orc.prazo_dias} dia(s)` : null}</Linha>
          <Linha rotulo="Garantia">{(orc?.garantia_dias ?? c.garantia_dias) != null ? `${orc?.garantia_dias ?? c.garantia_dias} dias a partir da conclusão` : null}</Linha>
          {!pessoal && <Linha rotulo="Quem paga">{rotuloResponsavel(c.responsabilidade, organizacao.modo)}</Linha>}
        </section>

        <section className="mb-8">
          <h2 className="mb-2 text-[14px] font-semibold text-texto">Observações do serviço executado</h2>
          <div className="space-y-6 pt-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="border-b border-borda" />
            ))}
          </div>
        </section>

        <section className="grid gap-8 pt-6 sm:grid-cols-3">
          {["Prestador", pessoal ? "Proprietário" : "Responsável pela administração", "Quem recebeu o serviço"].map((r) => (
            <div key={r} className="text-center text-xs text-mudo">
              <div className="mb-1 h-10 border-b border-borda-forte" />
              {r}
            </div>
          ))}
        </section>
      </article>
    </div>
  );
}
