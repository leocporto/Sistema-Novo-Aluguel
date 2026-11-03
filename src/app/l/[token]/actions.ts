"use server";

import type { EstadoAcao } from "@/lib/form";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

/** Recebe o formulário público e cria (ou atualiza) o lead na imobiliária do link. */
export async function enviarLeadPublico(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  // Campo escondido: robôs preenchem, pessoas não.
  if (String(fd.get("site_url") ?? "")) return { ok: "Recebemos seu contato. Obrigado!" };
  const token = String(fd.get("token") ?? "");
  const dados = {
    nome: String(fd.get("nome") ?? "").trim(),
    telefone: String(fd.get("telefone") ?? "").trim(),
    email: String(fd.get("email") ?? "").trim(),
    mensagem: String(fd.get("mensagem") ?? "").trim(),
    funil: String(fd.get("funil") ?? "locacao"),
    origem: String(fd.get("origem") ?? "site"),
    imovel: String(fd.get("imovel") ?? "") || undefined,
  };
  if (!dados.nome) return { erro: "Informe seu nome." };
  if (!dados.telefone && !dados.email) return { erro: "Informe telefone ou e-mail para retornarmos." };
  const { error } = await clienteAnonimo().rpc("receber_lead", { p_token: token, p: dados });
  if (error) return { erro: error.message.includes("inválido") ? "Este link não está mais ativo." : "Não foi possível enviar agora. Tente de novo." };
  return { ok: "Recebemos seu contato! Em breve um corretor fala com você." };
}
