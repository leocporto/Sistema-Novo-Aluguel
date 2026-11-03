import type { obterContexto } from "@/lib/contexto";
import { ROTULO_TIPO_COMPROMISSO } from "@/lib/dominio/agenda";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
export type OpcaoNome = { id: string; nome: string };
export type OpcaoImovel = { id: string; codigo: string; logradouro: string | null; numero: string | null; bairro?: string | null; cidade?: string | null };

/** Colunas da agenda + nomes ligados (imóvel, cliente, corretor, captação). */
export const SELECT_COMPROMISSO =
  "*, imovel:imoveis(id, codigo, logradouro, numero, bairro, cidade, horario_visitas, imovel_proprietarios(pessoa:pessoas(id, nome, telefone))), lead:leads(id, nome, telefone), pessoa:pessoas!visitas_pessoa_id_fkey(id, nome, telefone), corretor:pessoas!visitas_corretor_id_fkey(id, nome), captacao:captacoes(id, proprietario_nome, proprietario_telefone, logradouro, numero_end, bairro, cidade)";

export type CompromissoTela = {
  id: string;
  tipo: string;
  titulo: string | null;
  data_hora: string;
  duracao_min: number;
  status: string;
  modalidade: string;
  link_virtual: string | null;
  observacoes: string | null;
  contato_nome: string | null;
  contato_telefone: string | null;
  responsavel_id: string | null;
  compartilhada: boolean;
  corretor_id: string | null;
  imovel_id: string | null;
  lead_id: string | null;
  pessoa_id: string | null;
  captacao_id: string | null;
  cliente_confirmado_em: string | null;
  proprietario_confirmado_em: string | null;
  checkin_em: string | null;
  checkout_em: string | null;
  feedback_nota: number | null;
  feedback_interesse: string | null;
  feedback_texto: string | null;
  feedback_proprietario: string | null;
  motivo_cancelamento: string | null;
  lembrete_min: number;
  imovel: (OpcaoImovel & { horario_visitas: string | null; imovel_proprietarios: { pessoa: { id: string; nome: string; telefone: string | null } | null }[] }) | null;
  lead: { id: string; nome: string; telefone: string | null } | null;
  pessoa: { id: string; nome: string; telefone: string | null } | null;
  corretor: { id: string; nome: string } | null;
  captacao: { id: string; proprietario_nome: string; proprietario_telefone: string | null; logradouro: string | null; numero_end: string | null; bairro: string | null; cidade: string | null } | null;
};

/** Quem é o cliente/interessado do compromisso. */
export function clienteDo(v: CompromissoTela): { nome: string; telefone: string | null; href: string | null } | null {
  if (v.lead) return { nome: v.lead.nome, telefone: v.lead.telefone, href: `/comercial/leads/${v.lead.id}` };
  if (v.pessoa) return { nome: v.pessoa.nome, telefone: v.pessoa.telefone, href: `/pessoas/${v.pessoa.id}` };
  if (v.captacao) return { nome: v.captacao.proprietario_nome, telefone: v.captacao.proprietario_telefone, href: `/captacao/${v.captacao.id}` };
  if (v.contato_nome) return { nome: v.contato_nome, telefone: v.contato_telefone, href: null };
  return null;
}

export function enderecoDo(v: CompromissoTela): string | null {
  const i = v.imovel ?? (v.captacao ? { logradouro: v.captacao.logradouro, numero: v.captacao.numero_end, bairro: v.captacao.bairro, cidade: v.captacao.cidade } : null);
  if (!i) return null;
  return [[i.logradouro, i.numero].filter(Boolean).join(", "), i.bairro, i.cidade].filter(Boolean).join(" · ") || null;
}

/** Título curto para o calendário: "Visita · AP-12 · Ana". */
export function tituloDo(v: CompromissoTela): string {
  if (v.titulo) return v.titulo;
  const c = clienteDo(v);
  return [ROTULO_TIPO_COMPROMISSO[v.tipo] ?? v.tipo, v.imovel?.codigo, c?.nome.split(" ")[0]].filter(Boolean).join(" · ");
}

export async function carregarOpcoesAgenda(supabase: Supabase) {
  const [imoveis, leads, corretores, pessoas] = await Promise.all([
    supabase.from("imoveis").select("id, codigo, logradouro, numero").neq("status", "inativo").order("codigo"),
    supabase.from("leads").select("id, nome").not("status", "in", "(ganho,perdido)").order("nome"),
    supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"]).order("nome"),
    supabase.from("pessoas").select("id, nome").order("nome").limit(2000),
  ]);
  return {
    imoveis: (imoveis.data ?? []) as OpcaoImovel[],
    leads: (leads.data ?? []) as OpcaoNome[],
    corretores: (corretores.data ?? []) as OpcaoNome[],
    pessoas: (pessoas.data ?? []) as OpcaoNome[],
  };
}

export const COR_TIPO: Record<string, string> = {
  visita: "border-acento-bd bg-acento-bg text-acento-hot",
  avaliacao: "border-alerta-bd bg-alerta-bg text-alerta",
  vistoria: "border-ok-bd bg-ok-bg text-ok",
  reuniao: "border-borda-forte bg-elev text-texto",
  entrega_chaves: "border-ok-bd bg-ok-bg text-ok",
  lembrete: "border-borda bg-elev text-texto-2",
  outro: "border-borda bg-elev text-texto-2",
};
