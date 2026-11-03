import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento, qualificacao, type DadosQualificacao } from "@/lib/dominio/documentos";
import { NOME_INDICE } from "@/lib/dominio/reajuste";
import { NOMES_MES } from "@/components/navegador-mes";
import { reaisPorExtenso } from "@/lib/dominio/modelos";
import { ROTULO_GARANTIA, type Organizacao } from "@/lib/tipos";

export type Vinculos = { imovel_id?: string | null; pessoa_id?: string | null; contrato_id?: string | null; venda_id?: string | null; captacao_id?: string | null };

const valor = (n: unknown) => (n === null || n === undefined || n === "" ? null : formatarReais(Number(n)).replace("R$", "").trim());
const lista = (ps: DadosQualificacao[]) => (ps.length ? ps.map(qualificacao).join("; ") : null);

function dataPorExtenso(iso: string) {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${NOMES_MES[m - 1]} de ${a}`;
}

/**
 * Junta os dados do sistema (imóvel, pessoa, contrato, venda, captação e a
 * própria imobiliária) no formato das variáveis dos modelos.
 */
export async function dadosDoDocumento(sb: SupabaseClient, v: Vinculos, org: Organizacao): Promise<Record<string, string | null>> {
  const d: Record<string, string | null> = {
    data_hoje: dataPorExtenso(hojeISO()),
    "organizacao.nome": org.nome,
    "organizacao.documento": org.documento ? `${org.documento.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF"} ${formatarDocumento(org.documento)}` : null,
    "organizacao.creci": org.creci,
  };

  let imovelId = v.imovel_id ?? null;
  if (v.contrato_id) {
    const { data: c } = await sb
      .from("contratos")
      .select("*, contrato_partes(papel, pessoa:pessoas(*))")
      .eq("id", v.contrato_id)
      .maybeSingle();
    if (c) {
      imovelId = imovelId ?? c.imovel_id;
      type P = { papel: string; pessoa: DadosQualificacao };
      const partes = (c.contrato_partes ?? []) as P[];
      const doPapel = (p: string) => partes.filter((x) => x.papel === p).map((x) => x.pessoa);
      Object.assign(d, {
        "contrato.numero": String(c.numero),
        "contrato.valor_aluguel": valor(c.valor_aluguel),
        "contrato.valor_aluguel_extenso": reaisPorExtenso(Number(c.valor_aluguel)),
        "contrato.inicio": formatarDataBR(c.data_inicio),
        "contrato.fim": formatarDataBR(c.data_fim),
        "contrato.prazo_meses": String(c.prazo_meses),
        "contrato.dia_vencimento": String(c.dia_vencimento),
        "contrato.indice": NOME_INDICE[c.indice_reajuste as keyof typeof NOME_INDICE] ?? c.indice_reajuste,
        "contrato.multa_rescisoria": String(Number(c.multa_rescisoria_alugueis)),
        "contrato.garantia": `${ROTULO_GARANTIA[c.garantia_tipo] ?? c.garantia_tipo}${c.garantia_valor ? `, no valor de R$ ${valor(c.garantia_valor)}` : ""}`,
        "contrato.taxa_administracao": String(Number(c.taxa_administracao_pct)),
        "locatarios.nomes": doPapel("locatario").map((p) => p.nome).join(", ") || null,
        "locatarios.qualificacao": lista(doPapel("locatario")),
        "fiadores.qualificacao": lista(doPapel("fiador")) ?? "não há",
      });
      if (org.modo === "pessoal")
        d["proprietarios.qualificacao"] = `${org.nome}${org.documento ? `, CPF/CNPJ ${formatarDocumento(org.documento)}` : ""}`;
      else if (doPapel("proprietario").length) d["proprietarios.qualificacao"] = lista(doPapel("proprietario"));
    }
  }

  if (v.venda_id) {
    const { data: vd } = await sb.from("vendas").select("*, comprador:pessoas!vendas_comprador_id_fkey(*)").eq("id", v.venda_id).maybeSingle();
    if (vd) {
      imovelId = imovelId ?? vd.imovel_id;
      Object.assign(d, {
        "venda.valor": valor(vd.valor),
        "venda.valor_extenso": reaisPorExtenso(Number(vd.valor)),
        "venda.comprador.qualificacao": vd.comprador ? qualificacao(vd.comprador as DadosQualificacao) : vd.comprador_nome,
        "venda.comissao_pct": String(Number(vd.comissao_pct)),
      });
    }
  }

  if (v.captacao_id) {
    const { data: cp } = await sb.from("captacoes").select("*").eq("id", v.captacao_id).maybeSingle();
    if (cp) {
      imovelId = imovelId ?? cp.imovel_id;
      Object.assign(d, {
        "captacao.valor": valor(cp.valor_avaliado_venda ?? cp.valor_avaliado_aluguel ?? cp.valor_pretendido),
        "captacao.taxa_adm": cp.proposta_taxa_adm == null ? null : String(Number(cp.proposta_taxa_adm)),
        "captacao.comissao_venda": cp.proposta_comissao_venda == null ? null : String(Number(cp.proposta_comissao_venda)),
        "captacao.exclusividade_fim": cp.exclusividade_fim ? formatarDataBR(cp.exclusividade_fim) : null,
      });
      if (!imovelId) {
        d["imovel.endereco"] = [cp.logradouro, cp.numero_end, cp.complemento, cp.bairro, cp.cidade, cp.uf].filter(Boolean).join(", ") || null;
        d.cidade = cp.cidade;
        d["proprietarios.qualificacao"] = d["proprietarios.qualificacao"] ?? cp.proprietario_nome;
      }
    }
  }

  if (imovelId) {
    const { data: im } = await sb.from("imoveis").select("*, imovel_proprietarios(pessoa:pessoas(*))").eq("id", imovelId).maybeSingle();
    if (im) {
      const props = ((im.imovel_proprietarios ?? []) as { pessoa: DadosQualificacao | null }[]).map((p) => p.pessoa).filter((p): p is DadosQualificacao => !!p);
      Object.assign(d, {
        "imovel.codigo": im.codigo,
        "imovel.tipo": im.tipo,
        "imovel.endereco": [im.logradouro, im.numero, im.complemento, im.bairro, im.cidade, im.uf].filter(Boolean).join(", ") + (im.cep ? `, CEP ${im.cep}` : ""),
        "imovel.matricula": im.matricula,
        "imovel.iptu": im.inscricao_iptu,
        "imovel.valor_aluguel": valor(im.valor_aluguel),
        "imovel.valor_venda": valor(im.valor_venda),
        cidade: im.cidade,
        "proprietarios.nomes": props.map((p) => p.nome).join(", ") || null,
      });
      if (!d["proprietarios.qualificacao"]) d["proprietarios.qualificacao"] = lista(props);
    }
  }

  if (v.pessoa_id) {
    const { data: p } = await sb.from("pessoas").select("*").eq("id", v.pessoa_id).maybeSingle();
    if (p) Object.assign(d, { "pessoa.nome": p.nome, "pessoa.qualificacao": qualificacao(p as DadosQualificacao) });
  }
  return d;
}

/** Signatários sugeridos a partir do contrato/venda/imóvel (para "Adicionar as partes"). */
export async function signatariosSugeridos(sb: SupabaseClient, v: Vinculos) {
  const lista: { pessoa_id: string; nome: string; cpf: string | null; telefone: string | null; email: string | null; papel: string }[] = [];
  const add = (p: { id: string; nome: string; documento: string | null; telefone: string | null; email: string | null } | null, papel: string) => {
    if (p && !lista.some((x) => x.pessoa_id === p.id && x.papel === papel)) lista.push({ pessoa_id: p.id, nome: p.nome, cpf: p.documento, telefone: p.telefone, email: p.email, papel });
  };
  if (v.contrato_id) {
    const { data } = await sb.from("contrato_partes").select("papel, pessoa:pessoas(id, nome, documento, telefone, email)").eq("contrato_id", v.contrato_id);
    for (const x of (data ?? []) as unknown as { papel: string; pessoa: Parameters<typeof add>[0] }[]) add(x.pessoa, x.papel === "proprietario" ? "locador" : x.papel);
  }
  if (v.venda_id) {
    const { data } = await sb.from("vendas").select("imovel_id, comprador:pessoas!vendas_comprador_id_fkey(id, nome, documento, telefone, email)").eq("id", v.venda_id).maybeSingle();
    if (data) {
      add(data.comprador as unknown as Parameters<typeof add>[0], "comprador");
      v = { ...v, imovel_id: v.imovel_id ?? data.imovel_id };
    }
  }
  if (v.imovel_id && !v.contrato_id) {
    const { data } = await sb.from("imovel_proprietarios").select("pessoa:pessoas(id, nome, documento, telefone, email)").eq("imovel_id", v.imovel_id);
    for (const x of (data ?? []) as unknown as { pessoa: Parameters<typeof add>[0] }[]) add(x.pessoa, v.venda_id ? "vendedor" : "proprietario");
  }
  if (v.pessoa_id) {
    const { data } = await sb.from("pessoas").select("id, nome, documento, telefone, email").eq("id", v.pessoa_id).maybeSingle();
    add(data, "parte");
  }
  return lista;
}
