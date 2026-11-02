import type { Metadata } from "next";
import Link from "next/link";
import { BotaoLink, Cabecalho, Cartao, Indicador, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { proximoReajuste } from "@/lib/dominio/reajuste";
import { ROTULO_STATUS_IMOVEL } from "@/lib/tipos";

export const metadata: Metadata = { title: "Painel" };

const COR_STATUS = { disponivel: "verde", alugado: "azul", reservado: "amarelo", vendido: "cinza", inativo: "cinza" } as const;

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
    supabase
      .from("imoveis")
      .select("id, codigo, status, valor_aluguel, logradouro, numero, bairro, created_at, imovel_proprietarios(pessoa_id), contratos(status)")
      .order("created_at", { ascending: false }),
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
  type I = {
    id: string;
    codigo: string;
    status: string;
    valor_aluguel: number | null;
    logradouro: string | null;
    numero: string | null;
    bairro: string | null;
    imovel_proprietarios: { pessoa_id: string }[];
    contratos: { status: string }[];
  };
  const im = (imoveis.data ?? []) as unknown as I[];
  const alugados = im.filter((i) => i.status === "alugado").length;
  const disponiveis = im.filter((i) => i.status === "disponivel").length;
  const porStatus = Object.keys(ROTULO_STATUS_IMOVEL).map((s) => ({ status: s, qtd: im.filter((i) => i.status === s).length }));
  const potencialDisponiveis = im.filter((i) => i.status === "disponivel").reduce((s, i) => s + Number(i.valor_aluguel ?? 0), 0);
  const pendenciasImoveis: { texto: string; href: string }[] = [];
  for (const i of im) {
    if (i.imovel_proprietarios.length === 0)
      pendenciasImoveis.push({ texto: `${i.codigo}: sem proprietário vinculado`, href: `/imoveis/${i.id}` });
    if (i.status === "alugado" && !i.contratos.some((c) => c.status === "ativo"))
      pendenciasImoveis.push({ texto: `${i.codigo}: marcado como alugado, mas sem contrato ativo`, href: `/contratos/novo?imovel=${i.id}` });
  }
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
        titulo="Painel"
        descricao={`${organizacao.nome} · resumo de ${formatarDataBR(hoje)}`}
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
        <Indicador rotulo="Imóveis alugados" valor={alugados} detalhe={`${disponiveis} desalugado(s)`} href="/imoveis" />
        <Indicador
          rotulo="Ocupação"
          valor={alugados + disponiveis ? `${Math.round((alugados / (alugados + disponiveis)) * 100)}%` : "—"}
        />
        <Indicador rotulo="Taxa média de administração" valor={`${Number(organizacao.taxa_administracao_pct)}%`} detalhe="padrão da imobiliária" />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_380px]">
        <Cartao
          titulo={`Imóveis (${im.length})`}
          acoes={
            <Link href="/imoveis/novo" className="text-xs text-emerald-700 hover:underline">
              + novo imóvel
            </Link>
          }
        >
          <div className="mb-4 flex flex-wrap gap-2">
            {porStatus
              .filter((s) => s.qtd > 0)
              .map((s) => (
                <Link key={s.status} href={`/imoveis?status=${s.status}`}>
                  <Selo cor={COR_STATUS[s.status as keyof typeof COR_STATUS] ?? "cinza"}>
                    {ROTULO_STATUS_IMOVEL[s.status]}: {s.qtd}
                  </Selo>
                </Link>
              ))}
            {im.length > 0 && (
              <span className="text-xs text-slate-500">
                Aluguel potencial dos desalugados: {formatarReais(potencialDisponiveis)}/mês
              </span>
            )}
          </div>
          <ul className="divide-y divide-slate-100 text-sm">
            {im.slice(0, 8).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <div>
                  <Link href={`/imoveis/${i.id}`} className="font-medium text-emerald-700 hover:underline">
                    {i.codigo}
                  </Link>
                  <span className="text-slate-500"> — {[i.logradouro, i.numero, i.bairro].filter(Boolean).join(", ") || "sem endereço"}</span>
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  {i.valor_aluguel ? <span className="text-slate-600">{formatarReais(i.valor_aluguel)}</span> : null}
                  <Selo cor={COR_STATUS[i.status as keyof typeof COR_STATUS] ?? "cinza"}>{ROTULO_STATUS_IMOVEL[i.status] ?? i.status}</Selo>
                </div>
              </li>
            ))}
            {im.length === 0 && (
              <li className="py-2 text-slate-500">
                Nenhum imóvel cadastrado.{" "}
                <Link href="/imoveis/novo" className="text-emerald-700 hover:underline">
                  Cadastrar o primeiro
                </Link>
              </li>
            )}
          </ul>
          {im.length > 8 && (
            <Link href="/imoveis" className="mt-2 inline-block text-xs text-emerald-700 hover:underline">
              Ver todos os {im.length} imóveis
            </Link>
          )}
        </Cartao>

        <Cartao titulo={`Pendências dos imóveis (${pendenciasImoveis.length})`}>
          <ul className="space-y-2 text-sm">
            {pendenciasImoveis.slice(0, 10).map((p, i) => (
              <li key={i}>
                <Link href={p.href} className="text-amber-700 hover:underline">
                  {p.texto}
                </Link>
              </li>
            ))}
            {pendenciasImoveis.length === 0 && <li className="text-slate-500">Nenhuma pendência.</li>}
          </ul>
        </Cartao>
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
