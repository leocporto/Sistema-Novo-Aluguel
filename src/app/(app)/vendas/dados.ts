import type { obterContexto } from "@/lib/contexto";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
export type OpcaoNome = { id: string; nome: string };

export const SELECT_VENDA =
  "*, imovel:imoveis(id, codigo, tipo, logradouro, numero, complemento, bairro, cidade, uf, cep, matricula, inscricao_iptu, area_util, imovel_proprietarios(percentual, pessoa:pessoas(id, nome, telefone, documento, email))), comprador:pessoas!vendas_comprador_id_fkey(id, nome, telefone, documento, email, estado_civil, profissao, logradouro, numero, bairro, cidade, uf), lead:leads(id, nome, telefone), corretor:pessoas!vendas_corretor_id_fkey(id, nome)";

export type Proprietario = { percentual: number; pessoa: { id: string; nome: string; telefone: string | null; documento: string | null; email: string | null } | null };

export type Venda = {
  id: string;
  numero: number;
  imovel_id: string | null;
  comprador_id: string | null;
  comprador_nome: string | null;
  comprador_telefone: string | null;
  lead_id: string | null;
  corretor_id: string | null;
  status: string;
  valor: number;
  forma_pagamento: string;
  reserva_ate: string | null;
  aprovado_proprietario_em: string | null;
  banco: string | null;
  valor_financiado: number | null;
  fin_status: string;
  fin_observacoes: string | null;
  itbi_aliquota: number;
  itbi_valor: number | null;
  itbi_pago_em: string | null;
  cartorio: string | null;
  escritura_data: string | null;
  registro_data: string | null;
  matricula: string | null;
  posse_data: string | null;
  checklist_docs: Record<string, boolean>;
  checklist_posse: Record<string, boolean>;
  pos_venda_nota: number | null;
  pos_venda_texto: string | null;
  pos_venda_contato_em: string | null;
  comissao_pct: number;
  comissao_valor: number | null;
  concluida_em: string | null;
  motivo_cancelamento: string | null;
  observacoes: string | null;
  created_at: string;
  imovel: {
    id: string;
    codigo: string;
    tipo: string;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
    cep: string | null;
    matricula: string | null;
    inscricao_iptu: string | null;
    area_util: number | null;
    imovel_proprietarios: Proprietario[];
  } | null;
  comprador: {
    id: string;
    nome: string;
    telefone: string | null;
    documento: string | null;
    email: string | null;
    estado_civil: string | null;
    profissao: string | null;
    logradouro: string | null;
    numero: string | null;
    bairro: string | null;
    cidade: string | null;
    uf: string | null;
  } | null;
  lead: { id: string; nome: string; telefone: string | null } | null;
  corretor: { id: string; nome: string } | null;
};

export const nomeComprador = (v: Pick<Venda, "comprador" | "lead" | "comprador_nome">) => v.comprador?.nome ?? v.comprador_nome ?? v.lead?.nome ?? "Comprador a definir";
export const telefoneComprador = (v: Pick<Venda, "comprador" | "lead" | "comprador_telefone">) => v.comprador?.telefone ?? v.comprador_telefone ?? v.lead?.telefone ?? null;
export const enderecoImovel = (i: Venda["imovel"]) =>
  i ? [[i.logradouro, i.numero].filter(Boolean).join(", "), i.complemento, i.bairro, [i.cidade, i.uf].filter(Boolean).join("/")].filter(Boolean).join(" · ") : "";

export async function carregarOpcoesVenda(supabase: Supabase) {
  const [imoveis, pessoas, corretores, leads] = await Promise.all([
    supabase.from("imoveis").select("id, codigo, logradouro, numero, valor_venda, status").contains("finalidades", ["venda"]).neq("status", "inativo").order("codigo"),
    supabase.from("pessoas").select("id, nome").order("nome").limit(2000),
    supabase.from("pessoas").select("id, nome").overlaps("papeis", ["corretor", "parceiro"]).order("nome"),
    supabase.from("leads").select("id, nome").not("status", "in", "(ganho,perdido)").order("nome"),
  ]);
  return {
    imoveis: (imoveis.data ?? []) as { id: string; codigo: string; logradouro: string | null; numero: string | null; valor_venda: number | null; status: string }[],
    pessoas: (pessoas.data ?? []) as OpcaoNome[],
    corretores: (corretores.data ?? []) as OpcaoNome[],
    leads: (leads.data ?? []) as OpcaoNome[],
  };
}
