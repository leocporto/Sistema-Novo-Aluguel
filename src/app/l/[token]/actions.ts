"use server";

import type { EstadoAcao } from "@/lib/form";
import { CAMPOS_UTM, lerUtm, origemDaUtm } from "@/lib/dominio/marketing";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/** Recebe o formulário público e cria (ou atualiza) o lead na imobiliária do link. */
export async function enviarLeadPublico(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  // Campo escondido: robôs preenchem, pessoas não.
  if (String(fd.get("site_url") ?? "")) return { ok: "Recebemos seu contato. Obrigado!" };
  const token = String(fd.get("token") ?? "");
  // Origem da conversão (UTM, gclid, fbclid) que veio no link — fica gravada no lead.
  const utm = lerUtm(Object.fromEntries(CAMPOS_UTM.map((k) => [k, String(fd.get(k) ?? "")])));
  const dados = {
    nome: String(fd.get("nome") ?? "").trim(),
    telefone: String(fd.get("telefone") ?? "").trim(),
    email: String(fd.get("email") ?? "").trim(),
    mensagem: String(fd.get("mensagem") ?? "").trim(),
    funil: String(fd.get("funil") ?? "locacao"),
    origem: origemDaUtm(utm, String(fd.get("origem") ?? "site")),
    imovel: String(fd.get("imovel") ?? "") || undefined,
    ...utm,
  };
  if (!dados.nome) return { erro: "Informe seu nome." };
  if (!dados.telefone && !dados.email) return { erro: "Informe telefone ou e-mail para retornarmos." };
  // receber_lead_marketing = receber_lead + UTM/gclid/fbclid no lead (migração do Marketing).
  const { error } = await clienteAnonimo().rpc("receber_lead_marketing", { p_token: token, p: dados });
  if (error) return { erro: error.message.includes("inválido") ? "Este link não está mais ativo." : "Não foi possível enviar agora. Tente de novo." };
  return { ok: "Recebemos seu contato! Em breve um corretor fala com você." };
}
