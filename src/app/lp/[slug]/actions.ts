"use server";

import type { EstadoAcao } from "@/lib/form";
import { CAMPOS_UTM, lerUtm, origemDaUtm } from "@/lib/dominio/marketing";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/** Formulário da landing page: vira lead com a origem (UTM, gclid, fbclid). */
export async function enviarLeadLanding(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  // Campo escondido: robôs preenchem, pessoas não.
  if (String(fd.get("site_url") ?? "")) return { ok: "Recebemos seu contato. Obrigado!" };
  const slug = String(fd.get("slug") ?? "");
  const utm = lerUtm(Object.fromEntries(CAMPOS_UTM.map((k) => [k, String(fd.get(k) ?? "")])));
  const dados = {
    nome: String(fd.get("nome") ?? "").trim().slice(0, 120),
    telefone: String(fd.get("telefone") ?? "").trim().slice(0, 40),
    email: String(fd.get("email") ?? "").trim().slice(0, 160),
    mensagem: String(fd.get("mensagem") ?? "").trim().slice(0, 2000),
    origem: origemDaUtm(utm),
    ...utm,
  };
  if (!dados.nome) return { erro: "Informe seu nome." };
  if (!dados.telefone && !dados.email) return { erro: "Informe telefone ou e-mail para retornarmos." };
  const { error } = await clienteAnonimo().rpc("receber_lead_landing", { p_slug: slug, p: dados });
  if (error) return { erro: error.message.includes("não encontrada") ? "Esta página não está mais no ar." : "Não foi possível enviar agora. Tente de novo." };
  return { ok: "Recebemos seu contato! Em breve falamos com você." };
}
