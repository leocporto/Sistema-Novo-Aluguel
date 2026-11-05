import "server-only";
import type { obterContexto } from "@/lib/contexto";
import { idsAlvoAcao, type RegistrosAlvoAcao, type TipoAcaoIA } from "@/lib/dominio/ia";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Contrato = { codigo: string | null; numero: number | null; valor_aluguel: number | null; imovel_id: string | null };

const rotuloContrato = (c: Contrato | null | undefined) => (c ? c.codigo || (c.numero ? `#${c.numero}` : null) : null);

/**
 * Lê, com a sessão de quem aprova (RLS vale), os registros que o PAYLOAD da
 * ação aponta — o que será executado de verdade (cobrança, lead e novo
 * corretor, contrato, imóvel e preço atual, pessoa do lançamento). Nunca usa
 * as colunas de referência.
 */
export async function carregarRegistrosAlvo(supabase: Supabase, tipo: TipoAcaoIA, payload: Record<string, unknown>): Promise<RegistrosAlvoAcao> {
  const ids = idsAlvoAcao(tipo, payload);
  const [fat, lead, contrato, imovel] = await Promise.all([
    ids.fatura ? supabase.from("faturas").select("numero, vencimento, valor_total, status, contrato_id").eq("id", ids.fatura).maybeSingle() : null,
    ids.lead ? supabase.from("leads").select("nome, status, corretor_id").eq("id", ids.lead).maybeSingle() : null,
    ids.contrato ? supabase.from("contratos").select("codigo, numero, valor_aluguel, imovel_id").eq("id", ids.contrato).maybeSingle() : null,
    ids.imovel ? supabase.from("imoveis").select("codigo, bairro, valor_aluguel, valor_venda").eq("id", ids.imovel).maybeSingle() : null,
  ]);
  const f = (fat?.data ?? null) as { numero: number | null; vencimento: string | null; valor_total: number | null; status: string | null; contrato_id: string | null } | null;
  const l = (lead?.data ?? null) as { nome: string | null; status: string | null; corretor_id: string | null } | null;
  const c = (contrato?.data ?? null) as Contrato | null;
  const i = (imovel?.data ?? null) as { codigo: string | null; bairro: string | null; valor_aluguel: number | null; valor_venda: number | null } | null;

  // Segunda volta: contrato e imóvel da cobrança, imóvel do contrato, nomes dos corretores e pessoa do lançamento.
  const { data: cf } = f?.contrato_id ? await supabase.from("contratos").select("codigo, numero, valor_aluguel, imovel_id").eq("id", f.contrato_id).maybeSingle() : { data: null };
  const contratoFatura = cf as Contrato | null;
  const imoveisIds = [contratoFatura?.imovel_id, c?.imovel_id].filter((x): x is string => !!x);
  const pessoasIds = [l?.corretor_id, ids.novoCorretor, ids.pessoa].filter((x): x is string => !!x);
  const [{ data: ims }, { data: pes }] = await Promise.all([
    imoveisIds.length ? supabase.from("imoveis").select("id, codigo").in("id", imoveisIds) : { data: [] },
    pessoasIds.length ? supabase.from("pessoas").select("id, nome, documento").in("id", pessoasIds) : { data: [] },
  ]);
  const codigoImovel = new Map(((ims ?? []) as { id: string; codigo: string }[]).map((x) => [x.id, x.codigo]));
  const pessoas = new Map(((pes ?? []) as { id: string; nome: string; documento: string | null }[]).map((x) => [x.id, x]));
  const nomePessoa = new Map([...pessoas].map(([id, x]) => [id, x.nome]));

  const r: RegistrosAlvoAcao = {};
  if (ids.fatura)
    r.fatura = f
      ? {
          numero: f.numero,
          vencimento: f.vencimento,
          valor: f.valor_total === null ? null : Number(f.valor_total),
          status: f.status,
          contrato: rotuloContrato(contratoFatura),
          imovel: contratoFatura?.imovel_id ? (codigoImovel.get(contratoFatura.imovel_id) ?? null) : null,
        }
      : null;
  if (ids.lead) r.lead = l ? { nome: l.nome, status: l.status, corretor: l.corretor_id ? (nomePessoa.get(l.corretor_id) ?? "corretor não encontrado") : null } : null;
  if (ids.novoCorretor) r.novoCorretor = nomePessoa.get(ids.novoCorretor) ?? null;
  if (ids.pessoa) {
    const pe = pessoas.get(ids.pessoa);
    r.pessoa = pe ? { nome: pe.nome, documento: pe.documento } : null;
  }
  if (ids.contrato)
    r.contrato = c
      ? { codigo: rotuloContrato(c), imovel: c.imovel_id ? (codigoImovel.get(c.imovel_id) ?? null) : null, aluguel: c.valor_aluguel === null ? null : Number(c.valor_aluguel) }
      : null;
  if (ids.imovel)
    r.imovel = i
      ? { codigo: i.codigo, bairro: i.bairro, aluguel: i.valor_aluguel === null ? null : Number(i.valor_aluguel), venda: i.valor_venda === null ? null : Number(i.valor_venda) }
      : null;
  return r;
}
