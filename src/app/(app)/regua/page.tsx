import type { Metadata } from "next";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { enviosDevidos, renderizarMensagem } from "@/lib/dominio/regua";
import type { AvisoRegua } from "./actions";
import { AvisosHoje, type AvisoDoDia } from "./avisos-hoje";
import { EditorRegua } from "./editor-regua";

export const metadata: Metadata = { title: "Régua de cobrança" };

type Regra = { id: string; nome: string; dias_relativos: number; canal: string; mensagem: string; assunto: string | null; ativo: boolean };
type FaturaR = {
  id: string;
  vencimento: string;
  competencia: string;
  valor_total: number;
  status: string;
  contrato: {
    imovel: { codigo: string; logradouro: string | null; numero: string | null };
    contrato_partes: { papel: string; pessoa: { nome: string; email: string | null; telefone: string | null } }[];
  };
};

function quandoTexto(dias: number) {
  if (dias === 0) return "Aviso do dia do vencimento";
  const n = Math.abs(dias);
  return dias < 0 ? `Lembrete de ${n} ${n === 1 ? "dia" : "dias"} antes` : `Cobrança de ${n} ${n === 1 ? "dia" : "dias"} de atraso`;
}

export default async function ReguaPage() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data: regrasRaw }, { data: faturasRaw }, { data: enviosRaw }] = await Promise.all([
    supabase.from("regua_regras").select("*").order("dias_relativos"),
    supabase
      .from("faturas")
      .select(
        "id, vencimento, competencia, valor_total, status, contrato:contratos(imovel:imoveis(codigo, logradouro, numero), contrato_partes(papel, pessoa:pessoas(nome, email, telefone)))",
      )
      .eq("status", "aberta")
      .gte("vencimento", somarDias(hoje, -95))
      .lte("vencimento", somarDias(hoje, 95)),
    supabase.from("regua_envios").select("regra_id, fatura_id").gte("enviado_em", somarDias(hoje, -120)),
  ]);
  const regras = (regrasRaw ?? []) as Regra[];
  const faturas = (faturasRaw ?? []) as unknown as FaturaR[];
  const enviados = new Set((enviosRaw ?? []).map((e) => `${e.regra_id}:${e.fatura_id}`));

  const inicial: AvisoRegua[] = regras.map((r) => ({
    id: r.id,
    dias: Math.abs(r.dias_relativos) || 1,
    quando: r.dias_relativos < 0 ? "antes" : r.dias_relativos === 0 ? "no_dia" : "depois",
    canal: r.canal === "whatsapp" ? "whatsapp" : "email",
    mensagem: r.mensagem,
    ativo: r.ativo,
  }));

  const avisos: AvisoDoDia[] = enviosDevidos(
    regras.map((r) => ({ id: r.id, diasRelativos: r.dias_relativos, ativo: r.ativo })),
    faturas,
    hoje,
    enviados,
  ).map((d) => {
    const regra = regras.find((r) => r.id === d.regraId)!;
    const f = faturas.find((x) => x.id === d.faturaId)!;
    const loc = f.contrato.contrato_partes.find((p) => p.papel === "locatario")?.pessoa;
    const vars = {
      nome: loc?.nome?.split(" ")[0] ?? "",
      valor: Number(f.valor_total),
      vencimento: f.vencimento,
      competencia: f.competencia,
      imovel: [f.contrato.imovel.logradouro, f.contrato.imovel.numero].filter(Boolean).join(", ") || f.contrato.imovel.codigo,
    };
    const mensagem = renderizarMensagem(regra.mensagem, vars);
    const assunto = renderizarMensagem(regra.assunto ?? "Aluguel", vars);
    const canal = regra.canal === "whatsapp" ? "whatsapp" : "email";
    const fone = (loc?.telefone ?? "").replace(/\D/g, "");
    const link =
      canal === "whatsapp"
        ? fone
          ? `https://wa.me/${fone.length <= 11 ? `55${fone}` : fone}?text=${encodeURIComponent(mensagem)}`
          : null
        : loc?.email
          ? `mailto:${loc.email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(mensagem)}`
          : null;
    return {
      chave: `${d.regraId}:${d.faturaId}`,
      regraId: d.regraId,
      faturaId: d.faturaId,
      quando: quandoTexto(regra.dias_relativos),
      inquilino: loc?.nome ?? "Locatário sem cadastro",
      valor: formatarReais(f.valor_total),
      vencimento: formatarDataBR(f.vencimento),
      canal,
      destinatario: canal === "whatsapp" ? fone || null : (loc?.email ?? null),
      link,
      mensagem,
    };
  });

  return (
    <>
      <Cabecalho titulo="Régua de cobrança" descricao="Defina quando avisar o inquilino sobre o aluguel. Todo dia, os avisos do dia aparecem aqui prontos para enviar." />

      <Cartao titulo={`Para enviar hoje (${avisos.length})`} className="mb-6">
        <AvisosHoje avisos={avisos} />
      </Cartao>

      <Cartao titulo="Quando avisar">
        <EditorRegua inicial={inicial} />
      </Cartao>
    </>
  );
}
