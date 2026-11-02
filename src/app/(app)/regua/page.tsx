import type { Metadata } from "next";
import { Cabecalho, Cartao, Indicador } from "@/components/ui";
import { Contador } from "@/components/abas-segmentadas";
import { obterContexto } from "@/lib/contexto";
import { diasEntre, formatarCompetencia, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { calcularAtraso } from "@/lib/dominio/encargos";
import { renderizarMensagem } from "@/lib/dominio/regua";
import { AlertTriangle, CalendarClock, Users } from "lucide-react";
import type { AvisoRegua } from "./actions";
import { EditorRegua } from "./editor-regua";
import { ListaCobranca, type ItemCobranca } from "./lista-cobranca";

export const metadata: Metadata = { title: "Inadimplência" };

/** Quantos dias à frente entram em "Vence nos próximos dias". */
const DIAS_A_VENCER = 5;

type Regra = { id: string; dias_relativos: number; canal: string; mensagem: string; ativo: boolean };
type FaturaAberta = {
  id: string;
  contrato_id: string;
  competencia: string;
  vencimento: string;
  valor_total: number;
  contrato: {
    multa_atraso_pct: number;
    juros_mes_pct: number;
    carencia_dias: number;
    imovel: { codigo: string; logradouro: string | null; numero: string | null };
    contrato_partes: { papel: string; pessoa_id: string; pessoa: { nome: string; telefone: string | null } }[];
  };
};

const PADRAO_ATRASO =
  "Olá {{nome}}, não identificamos o pagamento do aluguel de {{competencia}} ({{valor}}), vencido em {{vencimento}}. Se já pagou, desconsidere.";
const PADRAO_LEMBRETE = "Olá {{nome}}! Lembrete: o aluguel de {{competencia}} ({{valor}}) vence em {{vencimento}}.";

/**
 * Escolhe a mensagem da régua para a situação: em atraso, o aviso "depois"
 * de maior prazo já alcançado (ou o primeiro); a vencer, o aviso "antes"/"no dia".
 */
function regraPara(regras: Regra[], dias: number): Regra | null {
  const ativas = regras.filter((r) => r.ativo);
  if (dias > 0) {
    const depois = ativas.filter((r) => r.dias_relativos > 0).sort((a, b) => a.dias_relativos - b.dias_relativos);
    return [...depois].reverse().find((r) => r.dias_relativos <= dias) ?? depois[0] ?? null;
  }
  if (dias === 0) return ativas.find((r) => r.dias_relativos === 0) ?? null;
  const antes = ativas.filter((r) => r.dias_relativos < 0).sort((a, b) => b.dias_relativos - a.dias_relativos);
  return antes.find((r) => -r.dias_relativos >= -dias) ?? antes[antes.length - 1] ?? null;
}

export default async function InadimplenciaPage() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data: regrasRaw }, { data: faturasRaw }] = await Promise.all([
    supabase.from("regua_regras").select("id, dias_relativos, canal, mensagem, ativo").order("dias_relativos"),
    supabase
      .from("faturas")
      .select(
        "id, contrato_id, competencia, vencimento, valor_total, contrato:contratos(multa_atraso_pct, juros_mes_pct, carencia_dias, imovel:imoveis(codigo, logradouro, numero), contrato_partes(papel, pessoa_id, pessoa:pessoas(nome, telefone)))",
      )
      .eq("status", "aberta")
      .lte("vencimento", somarDias(hoje, DIAS_A_VENCER))
      .order("vencimento"),
  ]);
  const regras = (regrasRaw ?? []) as Regra[];
  const faturas = (faturasRaw ?? []) as unknown as FaturaAberta[];

  const ids = faturas.map((f) => f.id);
  const { data: enviosRaw } = ids.length
    ? await supabase.from("regua_envios").select("fatura_id, enviado_em").in("fatura_id", ids).order("enviado_em", { ascending: false })
    : { data: [] as { fatura_id: string; enviado_em: string }[] };
  const ultimoAviso = new Map<string, string>();
  for (const e of enviosRaw ?? []) if (!ultimoAviso.has(e.fatura_id)) ultimoAviso.set(e.fatura_id, e.enviado_em);

  const itens: ItemCobranca[] = faturas.map((f) => {
    const dias = diasEntre(f.vencimento, hoje);
    const loc = f.contrato.contrato_partes.find((p) => p.papel === "locatario");
    const im = f.contrato.imovel;
    const imovel = [im.logradouro, im.numero].filter(Boolean).join(", ") || im.codigo;
    const atraso =
      dias > 0
        ? calcularAtraso({
            valor: paraCentavos(f.valor_total),
            vencimento: f.vencimento,
            pagamento: hoje,
            multaPct: Number(f.contrato.multa_atraso_pct),
            jurosMesPct: Number(f.contrato.juros_mes_pct),
            carenciaDias: f.contrato.carencia_dias,
          })
        : null;
    const totalHoje = atraso ? paraReais(atraso.total) : Number(f.valor_total);
    const regra = regraPara(regras, dias);
    const mensagem = renderizarMensagem(regra?.mensagem ?? (dias > 0 ? PADRAO_ATRASO : PADRAO_LEMBRETE), {
      nome: loc?.pessoa.nome.split(" ")[0] ?? "",
      valor: totalHoje,
      vencimento: f.vencimento,
      competencia: f.competencia,
      imovel,
    });
    const aviso = ultimoAviso.get(f.id);
    return {
      faturaId: f.id,
      contratoId: f.contrato_id,
      inquilinoId: loc?.pessoa_id ?? null,
      inquilino: loc?.pessoa.nome ?? "Locatário sem cadastro",
      telefone: loc?.pessoa.telefone ?? null,
      imovel,
      competencia: formatarCompetencia(f.competencia),
      vencimento: formatarDataBR(f.vencimento),
      dias,
      valor: formatarReais(f.valor_total),
      valorAtualizado: atraso && atraso.total !== paraCentavos(f.valor_total) ? formatarReais(totalHoje) : null,
      ultimoAviso: aviso ? new Date(aviso).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : null,
      regraId: regra?.id ?? null,
      mensagem,
    };
  });

  const emAtraso = itens.filter((i) => i.dias > 0).sort((a, b) => b.dias - a.dias);
  const vencendo = itens.filter((i) => i.dias <= 0);
  const totalAtraso = faturas
    .filter((f) => diasEntre(f.vencimento, hoje) > 0)
    .reduce((s, f) => s + Number(f.valor_total), 0);
  const devedores = new Set(emAtraso.map((i) => i.inquilinoId ?? i.faturaId)).size;

  const inicial: AvisoRegua[] = regras.map((r) => ({
    id: r.id,
    dias: Math.abs(r.dias_relativos) || 1,
    quando: r.dias_relativos < 0 ? "antes" : r.dias_relativos === 0 ? "no_dia" : "depois",
    canal: r.canal === "whatsapp" ? "whatsapp" : "email",
    mensagem: r.mensagem,
    ativo: r.ativo,
  }));

  return (
    <>
      <Cabecalho
        titulo="Inadimplência"
        descricao="Quem está devendo e quem vai vencer, já com a mensagem pronta para cobrar no WhatsApp."
      />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador
          rotulo="Em atraso"
          icone={<AlertTriangle />}
          tom={emAtraso.length ? "perigo" : "sucesso"}
          valor={<Contador valor={totalAtraso} formato="moeda" />}
          detalhe={`${emAtraso.length} cobrança(s) vencida(s)`}
        />
        <Indicador rotulo="Inquilinos devendo" icone={<Users />} tom={devedores ? "perigo" : "sucesso"} valor={<Contador valor={devedores} />} />
        <Indicador
          rotulo={`Vencem em até ${DIAS_A_VENCER} dias`}
          icone={<CalendarClock />}
          valor={<Contador valor={vencendo.length} />}
          detalhe="lembrete antes do vencimento"
        />
      </div>

      <Cartao titulo={`Quem está devendo (${emAtraso.length})`} className="mb-6">
        <ListaCobranca itens={emAtraso} tipo="atraso" />
      </Cartao>

      <Cartao titulo={`Vence nos próximos ${DIAS_A_VENCER} dias (${vencendo.length})`} className="mb-6">
        <ListaCobranca itens={vencendo} tipo="vencendo" />
      </Cartao>

      <Cartao titulo="Mensagens de cobrança (quando avisar)">
        <p className="mb-4 text-[13px] text-texto-2">
          O botão de cobrar usa a mensagem do aviso que combina com os dias de atraso (ou de antecedência).
        </p>
        <EditorRegua inicial={inicial} />
      </Cartao>
    </>
  );
}
