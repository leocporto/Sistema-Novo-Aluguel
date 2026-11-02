import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, ChevronLeft, ChevronRight, ListChecks, Wallet } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Cabecalho, Indicador, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaNoMes, fimDoMes, formatarCompetencia, hojeISO, somarMeses } from "@/lib/dominio/datas";
import { gerarFaturasDoMes } from "./actions";
import { ControleMes, type AluguelDoMes } from "./controle-mes";

export const metadata: Metadata = { title: "Aluguéis do mês" };

const NOMES_MES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

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
  imovel: { codigo: string; logradouro: string | null; numero: string | null };
  contrato_partes: { papel: string; pessoa: { nome: string } }[];
};
type FaturaMes = {
  id: string;
  contrato_id: string;
  status: "aberta" | "paga" | "cancelada";
  vencimento: string;
  valor_total: number;
  valor_pago: number | null;
  pago_em: string | null;
  comprovante_path: string | null;
};

export default async function AlugueisDoMesPage({ searchParams }: PageProps<"/faturas">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes) ? sp.mes : hoje.slice(0, 7);
  const competencia = `${mes}-01`;
  const fim = fimDoMes(competencia);
  const { supabase, organizacao } = await obterContexto();

  const [{ data: contratosRaw }, { data: faturasRaw }] = await Promise.all([
    supabase
      .from("contratos")
      .select(
        "id, numero, status, data_inicio, data_fim, data_rescisao, valor_aluguel, dia_vencimento, modalidade, multa_atraso_pct, juros_mes_pct, carencia_dias, imovel:imoveis(codigo, logradouro, numero), contrato_partes(papel, pessoa:pessoas(nome))",
      )
      .neq("status", "rascunho")
      .lte("data_inicio", fim),
    supabase
      .from("faturas")
      .select("id, contrato_id, status, vencimento, valor_total, valor_pago, pago_em, comprovante_path")
      .eq("competencia", competencia)
      .neq("status", "cancelada"),
  ]);
  const faturaDo = new Map(((faturasRaw ?? []) as FaturaMes[]).map((f) => [f.contrato_id, f]));

  // Um aluguel por contrato que cobre o mês (ou que já tem fatura dele).
  const itens: AluguelDoMes[] = ((contratosRaw ?? []) as unknown as ContratoMes[])
    .filter((c) => faturaDo.has(c.id) || (c.status === "ativo" && (c.data_rescisao ?? c.data_fim) >= competencia))
    .map((c) => {
      const f = faturaDo.get(c.id);
      const mesVenc = c.modalidade === "vencido" ? somarMeses(competencia, 1) : competencia;
      const vencPrevisto = diaNoMes(mesVenc, c.dia_vencimento);
      const im = c.imovel;
      return {
        contratoId: c.id,
        contratoNumero: c.numero,
        faturaId: f?.id ?? null,
        situacao: f ? (f.status === "paga" ? "paga" : "aberta") : "sem_fatura",
        inquilino: c.contrato_partes.find((p) => p.papel === "locatario")?.pessoa.nome ?? "Locatário sem cadastro",
        imovel: [im.logradouro, im.numero].filter(Boolean).join(", ") || im.codigo,
        valor: Number(f?.valor_total ?? c.valor_aluguel),
        vencimento: f?.vencimento ?? (vencPrevisto < c.data_inicio ? c.data_inicio : vencPrevisto),
        pagoEm: f?.pago_em ?? null,
        valorPago: f?.valor_pago != null ? Number(f.valor_pago) : null,
        comprovante: Boolean(f?.comprovante_path),
        multaPct: Number(c.multa_atraso_pct),
        jurosMesPct: Number(c.juros_mes_pct),
        carenciaDias: c.carencia_dias,
      } satisfies AluguelDoMes;
    });

  const pagos = itens.filter((i) => i.situacao === "paga");
  const faltam = itens.filter((i) => i.situacao !== "paga");
  const recebido = pagos.reduce((s, i) => s + (i.valorPago ?? i.valor), 0);
  const falta = faltam.reduce((s, i) => s + i.valor, 0);
  const atrasados = faltam.filter((i) => i.vencimento < hoje);
  const valorAtraso = atrasados.reduce((s, i) => s + i.valor, 0);
  const semFatura = itens.filter((i) => i.situacao === "sem_fatura").length;

  const [ano, m] = mes.split("-").map(Number);
  const anterior = somarMeses(competencia, -1).slice(0, 7);
  const proximo = somarMeses(competencia, 1).slice(0, 7);

  return (
    <>
      <Cabecalho
        titulo="Aluguéis do mês"
        descricao="Marque o check de quem já pagou. Desmarcar desfaz o pagamento."
        acoes={
          semFatura > 0 ? (
            <Formulario acao={gerarFaturasDoMes} className="flex items-center gap-2">
              <input type="hidden" name="competencia" value={mes} />
              <BotaoEnviar variante="secundario">Gerar faturas de {formatarCompetencia(competencia)}</BotaoEnviar>
            </Formulario>
          ) : undefined
        }
      />

      <div className="mb-5 flex items-center gap-2">
        <Link href={`/faturas?mes=${anterior}`} className={classeBotao("secundario")} aria-label="Mês anterior">
          <ChevronLeft className="size-4" />
        </Link>
        <div className="min-w-44 text-center text-[17px] font-semibold capitalize text-texto">
          {NOMES_MES[m - 1]} de {ano}
        </div>
        <Link href={`/faturas?mes=${proximo}`} className={classeBotao("secundario")} aria-label="Próximo mês">
          <ChevronRight className="size-4" />
        </Link>
        {mes !== hoje.slice(0, 7) && (
          <Link href="/faturas" className={classeBotao("fantasma", "sm")}>
            Voltar para este mês
          </Link>
        )}
      </div>

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Pagos" icone={<ListChecks />} tom="sucesso" valor={<><Contador valor={pagos.length} /> de {itens.length}</>} />
        <Indicador rotulo="Recebido" icone={<Wallet />} tom="sucesso" valor={<Contador valor={recebido} formato="moeda" />} />
        <Indicador rotulo="Falta receber" icone={<CalendarClock />} valor={<Contador valor={falta} formato="moeda" />} detalhe={`${faltam.length} aluguel(is)`} />
        <Indicador
          rotulo="Em atraso"
          icone={<AlertTriangle />}
          tom={atrasados.length ? "perigo" : "sucesso"}
          valor={<Contador valor={valorAtraso} formato="moeda" />}
          detalhe={atrasados.length ? `${atrasados.length} atrasado(s)` : "nenhum atrasado"}
          href={atrasados.length ? "/regua" : undefined}
        />
      </div>

      <ControleMes key={mes} itens={itens} competencia={competencia} hoje={hoje} organizacaoId={organizacao.id} />
    </>
  );
}
