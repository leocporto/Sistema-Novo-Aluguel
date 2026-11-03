/** Link do WhatsApp (wa.me) com DDI 55 quando o número é brasileiro. */
export function linkWhatsapp(telefone: string, mensagem = "") {
  const d = telefone.replace(/\D/g, "");
  const numero = d.length <= 11 ? `55${d}` : d;
  return mensagem ? `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}` : `https://wa.me/${numero}`;
}
