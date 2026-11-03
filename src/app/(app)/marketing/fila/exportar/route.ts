import { NextResponse, type NextRequest } from "next/server";
import { paraCSV } from "@/lib/dominio/financeiro";
import { formatarDataHora, primeiroNome, ROTULO_CANAL, ROTULO_STATUS_ENVIO, type Canal } from "@/lib/dominio/marketing";
import { criarClienteServidor } from "@/lib/supabase/server";
import { todas } from "../../dados";

type Linha = {
  id: string;
  nome: string | null;
  email: string | null;
  telefone: string | null;
  canal: string;
  assunto: string | null;
  mensagem: string;
  status: string;
  agendado_para: string;
  enviado_em: string | null;
  campanha: { nome: string } | null;
};

/**
 * Exporta a fila em CSV:
 * - padrão: planilha (abre no Excel) com tudo;
 * - ?formato=email: e-mail, nome, assunto e mensagem separados por vírgula,
 *   no formato que Mailchimp, Brevo e RD Station importam.
 */
export async function GET(request: NextRequest) {
  const supabase = await criarClienteServidor();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ erro: "não autenticado" }, { status: 401 });
  const { data: membro } = await supabase.from("membros").select("organizacao:organizacoes(modo)").eq("user_id", auth.user.id).order("created_at").limit(1).maybeSingle();
  if ((membro?.organizacao as unknown as { modo?: string } | null)?.modo === "pessoal") return NextResponse.json({ erro: "só no modo imobiliária" }, { status: 403 });

  const p = request.nextUrl.searchParams;
  const situacao = p.get("situacao") ?? "agora";
  const canal = p.get("canal");
  const campanha = p.get("campanha");
  // "ate": momento em que a tela foi aberta — o CSV e o botão "marcar como enviados"
  // pegam exatamente as mesmas mensagens (o que entrou depois fica para a próxima).
  const ateParam = p.get("ate");
  const ate = ateParam && !Number.isNaN(Date.parse(ateParam)) ? new Date(ateParam).toISOString() : null;
  const agora = ate ?? new Date().toISOString();
  const linhas = await todas<Linha>(() => {
    let q = supabase.from("mkt_envios").select("id, nome, email, telefone, canal, assunto, mensagem, status, agendado_para, enviado_em, campanha:mkt_campanhas(nome)").order("id");
    if (campanha) q = q.eq("campanha_id", campanha);
    else if (situacao === "agora") q = q.eq("status", "pendente").lte("agendado_para", agora);
    else if (situacao === "agendado") q = q.eq("status", "pendente").gt("agendado_para", agora);
    else if (situacao === "problemas") q = q.in("status", ["falhou", "cancelado"]);
    else if (["enviado", "bloqueado", "pendente"].includes(situacao)) q = q.eq("status", situacao);
    if (canal) q = q.eq("canal", canal);
    if (ate) q = q.lte("created_at", ate);
    return q;
  });

  if (p.get("formato") === "email") {
    const cel = (v: string | null) => {
      const s = v ?? "";
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const corpo = linhas
      .filter((l) => l.email && l.status === "pendente")
      .map((l) => [l.email, l.nome, primeiroNome(l.nome), l.assunto, l.mensagem].map(cel).join(","));
    return new NextResponse(["email,nome,primeiro_nome,assunto,mensagem", ...corpo].join("\r\n") + "\r\n", {
      headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fila-email.csv"` },
    });
  }

  const csv = paraCSV(
    ["Nome", "E-mail", "Telefone", "Canal", "Assunto", "Mensagem", "Situação", "Campanha", "Agendado para", "Enviado em"],
    linhas.map((l) => [
      l.nome,
      l.email,
      l.telefone,
      ROTULO_CANAL[l.canal as Canal] ?? l.canal,
      l.assunto,
      l.mensagem,
      ROTULO_STATUS_ENVIO[l.status] ?? l.status,
      l.campanha?.nome ?? "",
      formatarDataHora(l.agendado_para),
      l.enviado_em ? formatarDataHora(l.enviado_em) : "",
    ]),
  );
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="fila-de-envio.csv"` } });
}
