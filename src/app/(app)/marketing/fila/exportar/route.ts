import { NextResponse, type NextRequest } from "next/server";
import { paraCSV } from "@/lib/dominio/financeiro";
import { csvFilaEmail, formatarDataHora, ROTULO_CANAL, ROTULO_STATUS_ENVIO, type Canal } from "@/lib/dominio/marketing";
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
 *   no formato que Mailchimp, Brevo e RD Station importam — só envios de e-mail
 *   pendentes que o banco liberou na hora (mkt_conferir_envios).
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
  const paraEmail = p.get("formato") === "email";
  const linhas = await todas<Linha>(() => {
    let q = supabase.from("mkt_envios").select("id, nome, email, telefone, canal, assunto, mensagem, status, agendado_para, enviado_em, campanha:mkt_campanhas(nome)").order("id");
    if (campanha) q = q.eq("campanha_id", campanha);
    else if (situacao === "agora") q = q.eq("status", "pendente").lte("agendado_para", agora);
    else if (situacao === "agendado") q = q.eq("status", "pendente").gt("agendado_para", agora);
    else if (situacao === "problemas") q = q.in("status", ["falhou", "cancelado"]);
    else if (["enviado", "bloqueado", "pendente"].includes(situacao)) q = q.eq("status", situacao);
    // CSV para ferramenta de e-mail: só envio de E-MAIL (o de WhatsApp/SMS também guarda o e-mail
    // do contato, mas o descadastro dele foi conferido para o outro canal).
    if (paraEmail) q = q.eq("canal", "email").eq("status", "pendente");
    else if (canal) q = q.eq("canal", canal);
    if (ate) q = q.lte("created_at", ate);
    return q;
  });

  if (paraEmail) {
    // O banco confere o descadastro AGORA (pode ter mudado depois de a fila ser montada):
    // quem passou a barrar vira "bloqueado" e fica fora do CSV.
    const permitidos = new Set<string>();
    for (let i = 0; i < linhas.length; i += 500) {
      const { data, error } = await supabase.rpc("mkt_conferir_envios", { p_ids: linhas.slice(i, i + 500).map((l) => l.id) });
      if (error) return NextResponse.json({ erro: "Não foi possível conferir os descadastros agora. Tente de novo." }, { status: 500 });
      for (const id of (data ?? []) as string[]) permitidos.add(id);
    }
    return new NextResponse(csvFilaEmail(linhas, permitidos), {
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
