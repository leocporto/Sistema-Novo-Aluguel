import { gerarICS } from "@/lib/dominio/agenda";
import { clienteAnonimo } from "@/lib/supabase/anonimo";

const ROTULO: Record<string, string> = {
  visita: "Visita",
  avaliacao: "Avaliação",
  vistoria: "Vistoria",
  reuniao: "Reunião",
  entrega_chaves: "Entrega de chaves",
  lembrete: "Lembrete",
  outro: "Compromisso",
};

type Linha = {
  id: string;
  tipo: string;
  titulo: string | null;
  data_hora: string;
  duracao_min: number;
  modalidade: string;
  link_virtual: string | null;
  observacoes: string | null;
  lembrete_min: number;
  imovel: string | null;
  endereco: string | null;
  cliente: string | null;
  telefone: string | null;
  organizacao: string;
};

/**
 * Calendário assinável (Google Agenda, iPhone, Outlook): os compromissos da
 * agenda em formato .ics. Só funciona com o token secreto da imobiliária.
 * `?u=<id do usuário>` mostra só a agenda dele + os compartilhados.
 */
export async function GET(req: Request, ctx: RouteContext<"/api/agenda/[token]">) {
  const { token } = await ctx.params;
  const limpo = token.replace(/\.ics$/, "");
  if (!/^[0-9a-f-]{36}$/i.test(limpo)) return new Response("Link inválido", { status: 404 });
  const u = new URL(req.url).searchParams.get("u");
  const { data, error } = await clienteAnonimo().rpc("agenda_feed", { p_token: limpo, p_usuario: u && /^[0-9a-f-]{36}$/i.test(u) ? u : null });
  if (error) return new Response("Erro ao ler a agenda", { status: 500 });
  const linhas = (data ?? []) as Linha[];
  if (!linhas.length) {
    // Token errado e agenda vazia respondem igual (não revela se o link existe).
    return new Response(gerarICS([], "Agenda"), { headers: { "Content-Type": "text/calendar; charset=utf-8" } });
  }
  const ics = gerarICS(
    linhas.map((l) => ({
      id: l.id,
      titulo: l.titulo || [ROTULO[l.tipo] ?? "Compromisso", l.imovel, l.cliente?.split(" ")[0]].filter(Boolean).join(" · "),
      inicio: l.data_hora,
      duracao_min: l.duracao_min,
      local: l.modalidade === "virtual" ? (l.link_virtual ?? "Virtual") : l.endereco,
      descricao: [l.cliente, l.telefone, l.link_virtual, l.observacoes].filter(Boolean).join("\n"),
      lembrete_min: l.lembrete_min,
    })),
    `Agenda — ${linhas[0].organizacao}`,
  );
  return new Response(ics, { headers: { "Content-Type": "text/calendar; charset=utf-8", "Cache-Control": "private, max-age=300" } });
}
