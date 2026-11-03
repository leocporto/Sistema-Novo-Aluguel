import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileCheck2, Receipt } from "lucide-react";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Cartao, Celula, LinhaVazia, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { carregarContrato } from "@/lib/servicos/locacao";

export const metadata: Metadata = { title: "Demonstrativos" };

/** Demonstrativo do locatário (pagamentos do ano, recibos, declaração de quitação) e atalho do locador. */
export default async function Demonstrativos({ params, searchParams }: PageProps<"/contratos/[id]/demonstrativos">) {
  const { id } = await params;
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const dados = await carregarContrato(supabase, id);
  if (!dados) notFound();
  const { contrato: c, partes } = dados;
  const anoAtual = new Date().getFullYear();
  const inicio = Number(c.data_inicio.slice(0, 4));
  const anos = Array.from({ length: Math.max(1, anoAtual - inicio + 1) }, (_, i) => String(anoAtual - i)).slice(0, 6);
  const ano = typeof sp.ano === "string" && anos.includes(sp.ano) ? sp.ano : anos[0];
  const { data } = await supabase
    .from("faturas")
    .select("id, numero, competencia, vencimento, pago_em, valor_total, valor_pago, status, forma_pagamento")
    .eq("contrato_id", id)
    .gte("competencia", `${ano}-01-01`)
    .lte("competencia", `${ano}-12-01`)
    .neq("status", "cancelada")
    .order("competencia");
  const faturas = data ?? [];
  const pagas = faturas.filter((f) => f.status === "paga");
  const total = pagas.reduce((s, f) => s + Number(f.valor_pago ?? f.valor_total), 0);
  const emAberto = faturas.filter((f) => f.status === "aberta");
  const proprietarios = partes.filter((p) => p.papel === "proprietario");

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <Cartao
        titulo={`Pagamentos do locatário em ${ano}`}
        acoes={
          <BotaoLink href={`/contratos/${id}/demonstrativos/declaracao?ano=${ano}`} variante="secundario">
            <FileCheck2 className="size-4" /> Declaração de quitação
          </BotaoLink>
        }
      >
        <PilulasLink className="mb-4" rotulo="Ano" ativo={`/contratos/${id}/demonstrativos?ano=${ano}`} itens={anos.map((a) => ({ href: `/contratos/${id}/demonstrativos?ano=${a}`, rotulo: a }))} />
        <Tabela colunas={["Competência", "Vencimento", "Pago em", "Valor", ""]}>
          {faturas.map((f) => (
            <tr key={f.id}>
              <Celula>{formatarCompetencia(f.competencia)}</Celula>
              <Celula>{formatarDataBR(f.vencimento)}</Celula>
              <Celula className={f.status === "aberta" ? "text-alerta" : ""}>{f.status === "paga" ? formatarDataBR(f.pago_em) : "em aberto"}</Celula>
              <Celula className="tabular-nums">{formatarReais(f.valor_pago ?? f.valor_total)}</Celula>
              <Celula>
                {f.status === "paga" ? (
                  <Link href={`/faturas/${f.id}/recibo`} className="inline-flex items-center gap-1 text-xs text-acento hover:underline">
                    <Receipt className="size-3.5" /> recibo
                  </Link>
                ) : (
                  <Link href={`/faturas/${f.id}`} className="text-xs text-acento hover:underline">
                    2ª via
                  </Link>
                )}
              </Celula>
            </tr>
          ))}
          {faturas.length === 0 && <LinhaVazia colunas={5}>Nenhuma cobrança neste ano.</LinhaVazia>}
        </Tabela>
        <p className="mt-3 text-sm text-texto-2">
          Total pago em {ano}: <strong className="tabular-nums text-texto">{formatarReais(total)}</strong>
          {emAberto.length ? ` · ${emAberto.length} em aberto` : ""}
        </p>
      </Cartao>
      <div className="space-y-6">
        <Cartao titulo="Para o locatário">
          <ul className="space-y-2 text-sm text-texto-2">
            <li>Recibo de cada aluguel pago (botão “recibo” na lista).</li>
            <li>Declaração anual de quitação — serve para imposto de renda e comprovar que está em dia.</li>
          </ul>
        </Cartao>
        {!pessoal && (
          <Cartao titulo="Para o proprietário">
            <p className="mb-3 text-sm text-texto-2">O demonstrativo do locador (repasses, taxas e informe de rendimentos) fica no extrato de repasses.</p>
            <ul className="space-y-1.5 text-sm">
              {proprietarios.map((p) => (
                <li key={p.pessoa_id}>
                  <Link href={`/repasses/extrato?pessoa=${p.pessoa_id}&ano=${ano}`} className="text-acento hover:underline">
                    Extrato de {p.pessoa.nome} ({ano})
                  </Link>
                </li>
              ))}
            </ul>
          </Cartao>
        )}
      </div>
    </div>
  );
}
