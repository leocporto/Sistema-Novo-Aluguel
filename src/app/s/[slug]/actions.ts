"use server";

import { instanteVisita, problemaHorarioVisita, valorParaBanco } from "@/lib/dominio/site";
import type { EstadoAcao } from "@/lib/form";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

const campo = (fd: FormData, k: string, max = 200) => String(fd.get(k) ?? "").trim().slice(0, max);

/** Mensagens do banco que podem ir direto para o visitante. */
const AMIGAVEIS = [/^Escolha /, /^Informe /, /^Esse horário/, /^Este site/, /^Muitas mensagens/, /^O agendamento/, /^Empreendimento não/, /^Você já tem/];

/**
 * Formulários do site público: contato, agendamento de visita, interesse em
 * empreendimento e "Anuncie seu imóvel". Tudo vira lead (ou captação) no
 * Comercial pela função site_contato, que valida o site e o horário.
 */
export async function enviarContatoSite(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  // Campo escondido: robôs preenchem, pessoas não.
  if (campo(fd, "site_url")) return { ok: "Recebemos seu contato. Obrigado!" };
  const slug = campo(fd, "slug", 60);
  const tipo = ["contato", "visita", "captacao", "empreendimento"].includes(campo(fd, "tipo")) ? campo(fd, "tipo") : "contato";
  const p: Record<string, string | null> = {
    tipo,
    nome: campo(fd, "nome", 120),
    telefone: campo(fd, "telefone", 40),
    email: campo(fd, "email", 160),
    mensagem: campo(fd, "mensagem", 1500),
    imovel: campo(fd, "imovel", 40) || null,
    empreendimento: campo(fd, "empreendimento", 40) || null,
    funil: ["locacao", "venda"].includes(campo(fd, "funil")) ? campo(fd, "funil") : null,
  };
  if (!p.nome) return { erro: "Informe seu nome." };
  if (!p.telefone && !p.email) return { erro: "Informe telefone ou e-mail para retornarmos." };
  if (tipo === "visita") {
    const quando = instanteVisita(campo(fd, "data", 10), campo(fd, "hora", 5));
    const problema = problemaHorarioVisita(quando);
    if (problema) return { erro: problema };
    p.quando = quando;
  }
  if (tipo === "captacao") {
    Object.assign(p, {
      tipo_imovel: campo(fd, "tipo_imovel", 40),
      finalidade: ["locacao", "venda", "ambos"].includes(campo(fd, "finalidade")) ? campo(fd, "finalidade") : "locacao",
      cidade: campo(fd, "cidade", 80),
      bairro: campo(fd, "bairro", 80),
      uf: campo(fd, "uf", 2).toUpperCase(),
      quartos: /^\d{1,2}$/.test(campo(fd, "quartos")) ? campo(fd, "quartos") : null,
      area: valorParaBanco(campo(fd, "area", 20)),
      valor: valorParaBanco(campo(fd, "valor", 20)),
    });
  }
  const { error } = await clienteAnonimo().rpc("site_contato", { p_slug: slug, p });
  if (error) {
    const msg = error.message ?? "";
    return { erro: AMIGAVEIS.some((re) => re.test(msg)) ? msg : "Não foi possível enviar agora. Tente de novo ou chame no WhatsApp." };
  }
  if (tipo === "visita") return { ok: "Pedido de visita enviado! Vamos confirmar o horário com você." };
  if (tipo === "captacao") return { ok: "Recebemos os dados do seu imóvel! Um corretor vai falar com você." };
  return { ok: "Mensagem enviada! Em breve falamos com você." };
}
