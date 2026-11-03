import type { Metadata } from "next";
import { AlertTriangle, CalendarClock, ListChecks, Wallet } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { Cabecalho, Indicador } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { imovelCurto } from "@/lib/dominio/cobrancas";
import { diaNoMes, diasEntre, fimDoMes, formatarCompetencia, hojeISO, somarMeses } from "@/lib/dominio/datas";
import { paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { aluguelDaFatura, paraPagamento, situacaoDaFatura, ultimoRecebimento, type PagamentoDb } from "@/lib/servicos/cobrancas";
import { configCobranca, contasAtivas } from "../cobrancas/dados";
import { gerarFaturasDoMes } from "./actions";
import { ControleMes, type AluguelDoMes } from "./controle-mes";

export const metadata: Metadata = { title: "Aluguéis do mês" };

type ContratoMes = {
  id: string;
  numero: number;
  status: string;
  data_inicio: string;
  data_fim: string;
  data_rescisao: string | null;
  valor_aluguel: number;
  dia_vencimento: number;
  modalidade: "antecipado" | "vencido";
  multa_atraso_pct: number;
  juros_mes_pct: number;
  carencia_dias: number;
  desconto_pontualidade_pct: number | null;
  imovel: { codigo: string; logradouro: string | null; numero: string | null };
  contrato_partes: { papel: string; pessoa: { nome: string } }[];
};
type FaturaMes = {
  id: string;
  contrato_id: string;
  status: string;
  vencimento: string;
  valor_total: number;
  valor_pago: number | null;
  pago_em: string | null;
  comprovante_path: string | null;
  acordo_id: string | null;
};

export default async function AlugueisDoMesPage({ searchParams }: PageProps<"/faturas">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const competencia = `${mes}-01`;
  const fim = fimDoMes(competencia);
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";

  const [{ data: contratosRaw }, { data: faturasRaw }, contas] = await Promise.all([
    supabase
      .from("contratos")
      .select(
        "id, numero, status, data_inicio, data_fim, data_rescisao, valor_aluguel, dia_vencimento, modalidade, multa_atraso_pct, juros_mes_pct, carencia_dias, desconto_pontualidade_pct, imovel:imoveis(codigo, logradouro, numero), contrato_partes(papel, pessoa:pessoas(nome))",
      )
      .neq("status", "rascunho")
      .lte("data_inicio", fim),
    supabase
      .from("faturas")
      .select("id, contrato_id, status, vencimento, valor_total, valor_pago, pago_em, comprovante_path, acordo_id")
      .eq("competencia", competencia)
      .neq("status", "cancelada"),
    contasAtivas(supabase),
  ]);
  const faturas = (faturasRaw ?? []) as FaturaMes[];
  const faturaDo = new Map(faturas.map((f) => [f.contrato_id, f]));
  const ids = faturas.map((f) => f.id);
  const [{ data: pgRaw }, { data: itensRaw }] = ids.length
    ? await Promise.all([
        supabase
          .from("fatura_pagamentos")
          .select("fatura_id, pago_em, valor, principal, multa, juros, desconto, acordo_parcela_id, created_at")
          .in("fatura_id", ids)
          .order("pago_em")
          .order("created_at"),
        supabase.from("fatura_itens").select("fatura_id, tipo, valor").in("fatura_id", ids).eq("tipo", "aluguel"),
      ])
    : [{ data: [] }, { data: [] }];
  const pagamentosDe = (id: string) => ((pgRaw ?? []) as PagamentoDb[]).filter((p) => p.fatura_id === id);

  // Um aluguel por contrato que cobre o mês (ou que já tem fatura dele).
  const itens: AluguelDoMes[] = ((contratosRaw ?? []) as unknown as ContratoMes[])
    .filter((c) => faturaDo.has(c.id) || (c.status === "ativo" && (c.data_rescisao ?? c.data_fim) >= competencia))
    .map((c) => {
      const f = faturaDo.get(c.id);
      const mesVenc = c.modalidade === "vencido" ? somarMeses(competencia, 1) : competencia;
      const vencPrevisto = diaNoMes(mesVenc, c.dia_vencimento);
      const vencimento = f?.vencimento ?? (vencPrevisto < c.data_inicio ? c.data_inicio : vencPrevisto);
      const valor = Number(f?.valor_total ?? c.valor_aluguel);
      const pg = f ? pagamentosDe(f.id) : [];
      const aluguel = paraReais(aluguelDaFatura(((itensRaw ?? []) as { fatura_id: string; tipo: string; valor: number }[]).filter((i) => i.fatura_id === f?.id), c));
      const sit = situacaoDaFatura({ valor_total: valor, vencimento }, c, pg.map(paraPagamento), hoje);
      const situacao: AluguelDoMes["situacao"] = !f ? "sem_fatura" : f.status === "paga" ? "paga" : f.status === "renegociada" ? "acordo" : sit.parcial ? "parcial" : "aberta";
      // "Desfazer" tira só o último recebimento; quitado por parcela de acordo (ou fatura de acordo) desfaz-se pelo acordo.
      const ultimoPg = pg.at(-1);
      const desfazer = f && situacao === "paga" && !ultimoPg?.acordo_parcela_id && !f.acordo_id ? ultimoRecebimento(f, pg) : null;
      return {
        contratoId: c.id,
        contratoNumero: c.numero,
        faturaId: f?.id ?? null,
        acordoId: f?.acordo_id ?? null,
        situacao,
        inquilino: c.contrato_partes.find((p) => p.papel === "locatario")?.pessoa.nome ?? "Locatário sem cadastro",
        imovel: imovelCurto(c.imovel),
        codigoImovel: c.imovel.codigo,
        valor,
        saldo: paraReais(sit.saldo),
        recebido: paraReais(sit.recebido),
        vencimento,
        dias: diasEntre(vencimento, hoje),
        pagoEm: f?.pago_em ?? null,
        valorPago: f?.valor_pago != null ? Number(f.valor_pago) : null,
        comprovante: Boolean(f?.comprovante_path),
        desfazer,
        alvo: {
          faturaId: f?.id ?? null,
          contratoId: c.id,
          competencia,
          titulo: c.contrato_partes.find((p) => p.papel === "locatario")?.pessoa.nome ?? "Locatário",
          subtitulo: `${c.imovel.codigo} · contrato #${c.numero}`,
          vencimento,
          valorTotal: valor,
          pagamentos: pg.map((p) => ({ data: p.pago_em, valor: Number(p.valor), principal: Number(p.principal), multa: Number(p.multa), juros: Number(p.juros), desconto: Number(p.desconto) })),
          multaPct: Number(c.multa_atraso_pct),
          jurosMesPct: Number(c.juros_mes_pct),
          carenciaDias: c.carencia_dias,
          pontualidadePct: Number(c.desconto_pontualidade_pct ?? 0),
          aluguel,
        },
      } satisfies AluguelDoMes;
    });

  const pagos = itens.filter((i) => i.situacao === "paga");
  const faltam = itens.filter((i) => i.situacao !== "paga");
  const soma = (l: number[]) => paraReais(l.reduce((s, v) => s + paraCentavos(v), 0));
  const recebido = soma([...pagos.map((i) => i.valorPago ?? i.valor), ...faltam.map((i) => i.recebido)]);
  const falta = soma(faltam.filter((i) => i.situacao !== "acordo").map((i) => i.saldo));
  const atrasados = faltam.filter((i) => i.situacao !== "acordo" && i.dias > 0);
  const valorAtraso = soma(atrasados.map((i) => i.saldo));
  const semFatura = itens.filter((i) => i.situacao === "sem_fatura").length;

  return (
    <>
      <Cabecalho
        titulo="Aluguéis do mês"
        descricao="Clique em “Receber” para registrar o pagamento (inteiro ou parcial). Tudo é confirmado numa janela antes de gravar."
        acoes={
          semFatura > 0 ? (
            <Formulario acao={gerarFaturasDoMes} className="flex items-center gap-2">
              <input type="hidden" name="competencia" value={mes} />
              <BotaoEnviar variante="secundario">Gerar faturas de {formatarCompetencia(competencia)}</BotaoEnviar>
            </Formulario>
          ) : undefined
        }
      />

      <div className="mb-5">
        <NavegadorMes caminho="/faturas" mes={mes} hoje={hoje} />
      </div>

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Pagos" icone={<ListChecks />} tom="sucesso" valor={<><Contador valor={pagos.length} /> de {itens.length}</>} />
        <Indicador rotulo="Recebido" icone={<Wallet />} tom="sucesso" valor={<Contador valor={recebido} formato="moeda" />} detalhe="inclui pagamentos parciais" />
        <Indicador rotulo="Falta receber" icone={<CalendarClock />} valor={<Contador valor={falta} formato="moeda" />} detalhe={`${faltam.length} aluguel(is)`} />
        <Indicador
          rotulo="Em atraso"
          icone={<AlertTriangle />}
          tom={atrasados.length ? "perigo" : "sucesso"}
          valor={<Contador valor={valorAtraso} formato="moeda" />}
          detalhe={atrasados.length ? `${atrasados.length} atrasado(s)` : "nenhum atrasado"}
          href={atrasados.length ? "/cobrancas" : undefined}
        />
      </div>

      <ControleMes
        key={mes}
        itens={itens}
        opcoes={{ hoje, organizacaoId: organizacao.id, contas: contas.map((c) => ({ id: c.id, nome: c.nome })), contaPadrao: configCobranca(organizacao).contaId }}
        pessoal={pessoal}
      />
    </>
  );
}
