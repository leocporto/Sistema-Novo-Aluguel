import type { Metadata } from "next";
import Link from "next/link";
import { BotaoLink, Cabecalho, Cartao, Indicador } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { proximoReajuste } from "@/lib/dominio/reajuste";

export const metadata: Metadata = { title: "Painel" };

export default async function PainelPage() {
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const em7 = somarDias(hoje, 7);
  const em30 = somarDias(hoje, 30);
  const mes = hoje.slice(0, 7);

  const [abertas, repasses, contratos, imoveis, recebidasMes] = await Promise.all([
    supabase.from("faturas").select("id, valor_total, vencimento").eq("status", "aberta"),
    supabase.from("repasses").select("valor_liquido, previsto_para").eq("status", "pendente"),
    supabase
      .from("contratos")
      .select("id, numero, data_fim, data_base_reajuste, periodicidade_reajuste_meses, valor_aluguel, seguro_incendio_vencimento, imovel:imoveis(codigo)")
      .eq("status", "ativo"),
    supabase.from("imoveis").select("status"),
    supabase.from("faturas").select("valor_pago").eq("status", "paga").gte("pago_em", `${mes}-01`),
  ]);

  const fat = abertas.data ?? [];
  const atrasadas = fat.filter((f) => f.vencimento < hoje);
  const aVencer = fat.filter((f) => f.vencimento >= hoje && f.vencimento <= em7);
  const rep = repasses.data ?? [];
  const repHoje = rep.filter((r) => r.previsto_para <= hoje);
  type C = { id: string; numero: number; data_fim: string; data_base_reajuste: string; periodicidade_reajuste_meses: number; valor_aluguel: number; seguro_incendio_vencimento: string | null; imovel: { codigo: string } };
  const ativos = (contratos.data ?? []) as unknown as C[];
  const carteira = ativos.reduce((s, c) => s + Number(c.valor_aluguel), 0);
  const im = imoveis.data ?? [];
  const alugados = im.filter((i) => i.status === "alugado").length;
  const disponiveis = im.filter((i) => i.status === "disponivel").length;
  const soma = (l: { valor_total?: number; valor_liquido?: number }[], k: "valor_total" | "valor_liquido") =>
    l.reduce((s, x) => s + Number(x[k] ?? 0), 0);

  const alertas: { texto: string; href: string; data: string }[] = [];
  for (const c of ativos) {
    const r = proximoReajuste(c.data_base_reajuste, c.periodicidade_reajuste_meses);
    if (r <= em30) alertas.push({ texto: `Reajuste do contrato #${c.numero} (${c.imovel.codigo})`, href: `/contratos/${c.id}`, data: r });
    if (c.data_fim <= somarDias(hoje, 60)) alertas.push({ texto: `Fim do prazo do contrato #${c.numero} (${c.imovel.codigo})`, href: `/contratos/${c.id}`, data: c.data_fim });
    if (c.seguro_incendio_vencimento && c.seguro_incendio_vencimento <= em30)
      alertas.push({ texto: `Seguro incêndio vencendo — contrato #${c.numero}`, href: `/contratos/${c.id}`, data: c.seguro_incendio_vencimento });
  }
  alertas.sort((a, b) => a.data.localeCompare(b.data));

  return (
    <>
      <Cabecalho
        titulo={`Olá, ${organizacao.nome}`}
        descricao={`Resumo de ${formatarDataBR(hoje)}`}
        acoes={
          <>
            <BotaoLink href="/faturas" variante="secundario">
              Gerar cobranças
            </BotaoLink>
            <BotaoLink href="/contratos/novo">Novo contrato</BotaoLink>
          </>
        }
      />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Inadimplência"
          valor={formatarReais(soma(atrasadas, "valor_total"))}
          detalhe={`${atrasadas.length} fatura(s) em atraso`}
          tom={atrasadas.length ? "perigo" : "sucesso"}
          href="/faturas?situacao=atraso"
        />
        <Indicador
          rotulo="Vencendo em 7 dias"
          valor={formatarReais(soma(aVencer, "valor_total"))}
          detalhe={`${aVencer.length} fatura(s)`}
          href="/faturas"
        />
        <Indicador
          rotulo="Repasses a pagar hoje"
          valor={formatarReais(soma(repHoje, "valor_liquido"))}
          detalhe={`${repHoje.length} de ${rep.length} pendente(s)`}
          tom={repHoje.length ? "alerta" : "neutro"}
          href="/repasses"
        />
        <Indicador
          rotulo="Recebido no mês"
          valor={formatarReais((recebidasMes.data ?? []).reduce((s, f) => s + Number(f.valor_pago ?? 0), 0))}
          tom="sucesso"
        />
        <Indicador rotulo="Contratos ativos" valor={ativos.length} detalhe={`Carteira: ${formatarReais(carteira)}/mês`} href="/contratos" />
        <Indicador rotulo="Imóveis alugados" valor={alugados} detalhe={`${disponiveis} disponível(is)`} href="/imoveis" />
        <Indicador
          rotulo="Ocupação"
          valor={alugados + disponiveis ? `${Math.round((alugados / (alugados + disponiveis)) * 100)}%` : "—"}
        />
        <Indicador rotulo="Taxa média de administração" valor={`${Number(organizacao.taxa_administracao_pct)}%`} detalhe="padrão da imobiliária" />
      </div>

      <Cartao titulo="Próximos eventos" className="mt-6">
        <ul className="divide-y divide-slate-100 text-sm">
          {alertas.slice(0, 15).map((a, i) => (
            <li key={i} className="flex justify-between py-2">
              <Link href={a.href} className="text-emerald-700 hover:underline">
                {a.texto}
              </Link>
              <span className={a.data < hoje ? "text-red-600" : "text-slate-500"}>{formatarDataBR(a.data)}</span>
            </li>
          ))}
          {alertas.length === 0 && <li className="py-2 text-slate-500">Nada nos próximos 30 dias.</li>}
        </ul>
      </Cartao>
    </>
  );
}
