"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { paraReais } from "@/lib/dominio/dinheiro";
import { inicioDoMes, somarDias, somarMeses } from "@/lib/dominio/datas";
import {
  type EstadoAcao,
  booleano,
  ErroValidacao,
  inteiro,
  mensagemErro,
  numero,
  texto,
  textoObrigatorio,
} from "@/lib/form";
import { calcularReajusteDoContrato, carregarContrato, gerarFaturaDoContrato } from "@/lib/servicos/locacao";

function taxaPct(fd: FormData, campo: string): number {
  const v = numero(fd, campo) ?? 0;
  if (v < 0 || v > 100) throw new ErroValidacao("As taxas devem ficar entre 0% e 100%.");
  return v;
}

export async function criarContrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  let id: string | null = null;
  try {
    const imovelId = textoObrigatorio(fd, "imovel_id", "o imóvel");
    const locatarioId = textoObrigatorio(fd, "locatario_id", "o locatário");
    const inicio = textoObrigatorio(fd, "data_inicio", "a data de início");
    const prazo = inteiro(fd, "prazo_meses") ?? 30;
    const valor = numero(fd, "valor_aluguel");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor do aluguel.");
    const dia = inteiro(fd, "dia_vencimento") ?? 10;
    if (dia < 1 || dia > 31) throw new ErroValidacao("Dia de vencimento deve estar entre 1 e 31.");

    const { data: props } = await supabase
      .from("imovel_proprietarios")
      .select("pessoa_id, percentual")
      .eq("imovel_id", imovelId);
    // Imóveis pessoais: o dono é a própria conta, não há proprietário de terceiros.
    if (!pessoal) {
      if (!props?.length) throw new ErroValidacao("Vincule ao menos um proprietário ao imóvel antes de criar o contrato.");
      const soma = props.reduce((s, p) => s + Number(p.percentual), 0);
      if (Math.abs(soma - 100) > 0.01) throw new ErroValidacao(`As participações dos proprietários do imóvel somam ${soma}%.`);
    }

    const { data, error } = await supabase
      .from("contratos")
      .insert({
        imovel_id: imovelId,
        codigo: texto(fd, "codigo"),
        finalidade: texto(fd, "finalidade") ?? "residencial",
        data_inicio: inicio,
        prazo_meses: prazo,
        data_fim: somarDias(somarMeses(inicio, prazo), -1),
        valor_aluguel: valor,
        dia_vencimento: dia,
        modalidade: texto(fd, "modalidade") ?? "antecipado",
        indice_reajuste: texto(fd, "indice_reajuste") ?? "IGPM",
        periodicidade_reajuste_meses: inteiro(fd, "periodicidade_reajuste_meses") ?? 12,
        data_base_reajuste: inicio,
        // Vazio ou 0 = sem taxa (pode ser 0%).
        taxa_administracao_pct: pessoal ? 0 : taxaPct(fd, "taxa_administracao_pct"),
        taxa_intermediacao_pct: pessoal ? 0 : taxaPct(fd, "taxa_intermediacao_pct"),
        tipo_repasse: pessoal ? "manual" : (texto(fd, "tipo_repasse") ?? "automatico"),
        dias_repasse: inteiro(fd, "dias_repasse") ?? 2,
        repassar_multa_juros: booleano(fd, "repassar_multa_juros"),
        multa_atraso_pct: numero(fd, "multa_atraso_pct") ?? 10,
        juros_mes_pct: numero(fd, "juros_mes_pct") ?? 1,
        carencia_dias: inteiro(fd, "carencia_dias") ?? 0,
        multa_rescisoria_alugueis: numero(fd, "multa_rescisoria_alugueis") ?? 3,
        garantia_tipo: texto(fd, "garantia_tipo") ?? "sem_garantia",
        garantia_valor: numero(fd, "garantia_valor"),
        garantia_detalhes: texto(fd, "garantia_detalhes"),
        seguro_incendio_apolice: texto(fd, "seguro_incendio_apolice"),
        seguro_incendio_vencimento: texto(fd, "seguro_incendio_vencimento"),
        observacoes: texto(fd, "observacoes"),
        carencia_meses: inteiro(fd, "carencia_meses") ?? 0,
        carencia_desconto_pct: taxaPct(fd, "carencia_desconto_pct") || 100,
        desconto_pontualidade_pct: taxaPct(fd, "desconto_pontualidade_pct"),
        status: booleano(fd, "rascunho") ? "rascunho" : "ativo",
        ativado_em: booleano(fd, "rascunho") ? null : new Date().toISOString(),
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;

    try {
      const partes = [
        ...(pessoal ? [] : (props ?? [])).map((p) => ({
          contrato_id: id,
          pessoa_id: p.pessoa_id,
          papel: "proprietario",
          percentual: p.percentual,
        })),
        { contrato_id: id, pessoa_id: locatarioId, papel: "locatario", percentual: null },
      ];
      const fiador = texto(fd, "fiador_id");
      if (fiador) partes.push({ contrato_id: id, pessoa_id: fiador, papel: "fiador", percentual: null });
      const r1 = await supabase.from("contrato_partes").insert(partes);
      if (r1.error) throw r1.error;

      const encargos = [];
      const cond = numero(fd, "encargo_condominio");
      if (cond)
        encargos.push({
          contrato_id: id,
          descricao: "Condomínio",
          tipo: "condominio",
          valor: cond,
          destino: texto(fd, "encargo_condominio_destino") ?? "terceiro",
        });
      const iptu = numero(fd, "encargo_iptu");
      if (iptu)
        encargos.push({
          contrato_id: id,
          descricao: "IPTU",
          tipo: "iptu",
          valor: iptu,
          destino: texto(fd, "encargo_iptu_destino") ?? "proprietario",
        });
      if (encargos.length) {
        const r2 = await supabase.from("contrato_encargos").insert(encargos);
        if (r2.error) throw r2.error;
      }
      const gTipo = texto(fd, "garantia_tipo");
      if (gTipo && gTipo !== "sem_garantia") {
        const fiadorId = texto(fd, "fiador_id");
        await supabase.from("contrato_garantias").insert({
          contrato_id: id,
          tipo: gTipo,
          pessoa_id: gTipo === "fiador" ? fiadorId : null,
          valor: numero(fd, "garantia_valor"),
          observacoes: texto(fd, "garantia_detalhes"),
        });
      }
      if (!booleano(fd, "rascunho")) await supabase.from("imoveis").update({ status: "alugado" }).eq("id", imovelId);
      for (const pid of [locatarioId, texto(fd, "fiador_id")].filter(Boolean) as string[]) {
        const { data: pes } = await supabase.from("pessoas").select("papeis").eq("id", pid).single();
        const papel = pid === locatarioId ? "locatario" : "fiador";
        if (pes && !pes.papeis.includes(papel))
          await supabase.from("pessoas").update({ papeis: [...pes.papeis, papel] }).eq("id", pid);
      }
      // Veio da análise cadastral aprovada: liga a análise e leva garantias e fiadores aprovados.
      const analiseId = texto(fd, "analise_id");
      if (analiseId) {
        const r3 = await supabase.rpc("levar_garantias_contrato", { p_analise: analiseId, p_contrato: id });
        if (r3.error) throw r3.error;
      }
    } catch (e) {
      await supabase.from("contratos").delete().eq("id", id);
      throw e;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/contratos");
  revalidatePath("/analise");
  revalidatePath("/");
  redirect(`/contratos/${id}`);
}

const CAMPOS_TEXTO = ["codigo", "modalidade", "indice_reajuste", "tipo_repasse", "garantia_tipo", "garantia_detalhes", "seguro_incendio_apolice", "seguro_incendio_vencimento", "observacoes"];
const CAMPOS_INTEIRO = ["dia_vencimento", "dias_repasse", "carencia_dias", "carencia_meses", "aviso_fim_dias"];
const CAMPOS_NUMERO = ["multa_atraso_pct", "juros_mes_pct", "garantia_valor", "multa_rescisoria_alugueis"];
const CAMPOS_PCT = ["taxa_administracao_pct", "carencia_desconto_pct", "desconto_pontualidade_pct"];

/** Salva sozinho só os campos que vieram (cada aba manda a sua parte). */
export async function atualizarContrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = {};
    for (const c of CAMPOS_TEXTO) if (fd.has(c)) d[c] = texto(fd, c);
    for (const c of CAMPOS_INTEIRO) if (fd.has(c)) d[c] = inteiro(fd, c) ?? 0;
    for (const c of CAMPOS_NUMERO) if (fd.has(c)) d[c] = numero(fd, c);
    for (const c of CAMPOS_PCT) if (fd.has(c)) d[c] = taxaPct(fd, c);
    if (fd.has("carencia_desconto_pct") && !d.carencia_desconto_pct) d.carencia_desconto_pct = 100;
    if (fd.has("_repassar")) d.repassar_multa_juros = booleano(fd, "repassar_multa_juros");
    if (fd.has("_renovacao")) d.renovacao_automatica = booleano(fd, "renovacao_automatica");
    for (const c of ["multa_atraso_pct", "juros_mes_pct", "multa_rescisoria_alugueis"]) if (c in d && d[c] === null) d[c] = 0;
    if (typeof d.dia_vencimento === "number" && (d.dia_vencimento < 1 || d.dia_vencimento > 31)) throw new ErroValidacao("Dia de vencimento deve estar entre 1 e 31.");
    const { error } = await supabase.from("contratos").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/contratos/${id}`, "layout");
  revalidatePath("/");
  return { ok: "Contrato atualizado." };
}

export async function adicionarParte(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const papel = textoObrigatorio(fd, "papel");
    const { error } = await supabase.from("contrato_partes").insert({
      contrato_id,
      pessoa_id: textoObrigatorio(fd, "pessoa_id", "a pessoa"),
      papel,
      percentual: papel === "proprietario" ? (numero(fd, "percentual") ?? 100) : null,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/contratos/${contrato_id}`, "layout");
  revalidatePath("/");
  return { ok: "Parte adicionada." };
}

export async function removerParte(fd: FormData) {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  await supabase
    .from("contrato_partes")
    .delete()
    .eq("contrato_id", contrato_id)
    .eq("pessoa_id", String(fd.get("pessoa_id")))
    .eq("papel", String(fd.get("papel")));
  revalidatePath(`/contratos/${contrato_id}`, "layout");
  revalidatePath("/");
}

export async function adicionarEncargo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const valor = numero(fd, "valor");
    if (!valor) throw new ErroValidacao("Informe o valor do encargo.");
    const inicio = texto(fd, "inicio");
    const fim = texto(fd, "fim");
    const { error } = await supabase.from("contrato_encargos").insert({
      contrato_id,
      descricao: textoObrigatorio(fd, "descricao", "a descrição"),
      tipo: texto(fd, "tipo") ?? "outro",
      valor,
      destino: texto(fd, "destino") ?? "proprietario",
      inicio: inicio ? inicioDoMes(`${inicio}-01`) : null,
      fim: fim ? inicioDoMes(`${fim}-01`) : null,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/contratos/${contrato_id}`, "layout");
  revalidatePath("/");
  return { ok: "Encargo adicionado." };
}

export async function removerEncargo(fd: FormData) {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  await supabase.from("contrato_encargos").delete().eq("id", String(fd.get("id")));
  revalidatePath(`/contratos/${contrato_id}`, "layout");
  revalidatePath("/");
}

export async function gerarFaturaManual(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const comp = textoObrigatorio(fd, "competencia", "a competência");
    const c = await carregarContrato(supabase, contrato_id);
    if (!c) throw new ErroValidacao("Contrato não encontrado.");
    const id = await gerarFaturaDoContrato(supabase, c, `${comp}-01`);
    if (!id) return { erro: "Já existe fatura para essa competência ou o contrato não cobre esse mês." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/contratos/${contrato_id}`, "layout");
  revalidatePath("/");
  return { ok: "Fatura gerada." };
}

export async function aplicarReajuste(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const data = textoObrigatorio(fd, "data_reajuste", "a data do reajuste");
    const c = await carregarContrato(supabase, contrato_id);
    if (!c) throw new ErroValidacao("Contrato não encontrado.");
    const manual = numero(fd, "percentual_manual");
    let pct: number;
    let novo: number;
    if (manual !== null) {
      pct = manual;
      novo = Math.round(Number(c.contrato.valor_aluguel) * (1 + manual / 100) * 100) / 100;
    } else {
      const r = await calcularReajusteDoContrato(supabase, c.contrato, data);
      if (r.mesesFaltantes.length)
        throw new ErroValidacao(
          `Cadastre o ${c.contrato.indice_reajuste} dos meses: ${r.mesesFaltantes.map((m) => m.slice(0, 7)).join(", ")} (ou informe o percentual manualmente).`,
        );
      pct = r.percentualAcumulado;
      novo = paraReais(r.valorNovo);
    }
    const { error } = await supabase.rpc("aplicar_reajuste", {
      p_contrato_id: contrato_id,
      p_data: data,
      p_indice: manual !== null ? "MANUAL" : c.contrato.indice_reajuste,
      p_percentual: pct,
      p_valor_novo: novo,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/contratos/${contrato_id}`, "layout");
  revalidatePath("/");
  revalidatePath("/reajustes");
  return { ok: "Reajuste aplicado. O novo valor vale para as próximas faturas." };
}

export async function encerrarContrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const data = textoObrigatorio(fd, "data_entrega", "a data de entrega das chaves");
    const status = texto(fd, "tipo") === "encerrado" ? "encerrado" : "rescindido";
    const { data: c, error } = await supabase
      .from("contratos")
      .update({ status, data_rescisao: data })
      .eq("id", contrato_id)
      .select("imovel_id")
      .single();
    if (error) throw error;
    const { count: outros } = await supabase.from("contratos").select("id", { count: "exact", head: true }).eq("imovel_id", c.imovel_id).eq("status", "ativo");
    if (!outros) await supabase.from("imoveis").update({ status: "disponivel" }).eq("id", c.imovel_id).in("status", ["alugado", "reservado"]);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/contratos/${contrato_id}`, "layout");
  revalidatePath("/");
  revalidatePath("/contratos");
  return { ok: "Contrato encerrado e imóvel marcado como desalugado." };
}

/**
 * Exclui um contrato lançado por engano. Só se nenhum aluguel ou repasse foi
 * pago — com pagamento, o certo é encerrar (o histórico financeiro fica).
 */
export async function excluirContrato(id: string): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const [{ count: pagas }, { count: repassesPagos }, { data: c }] = await Promise.all([
    supabase.from("faturas").select("id", { count: "exact", head: true }).eq("contrato_id", id).eq("status", "paga"),
    supabase.from("repasses").select("id", { count: "exact", head: true }).eq("contrato_id", id).eq("status", "pago"),
    supabase.from("contratos").select("imovel_id").eq("id", id).maybeSingle(),
  ]);
  if (!c) return { ok: false, erro: "Contrato não encontrado." };
  if (pagas || repassesPagos)
    return { ok: false, erro: "Este contrato já tem aluguel ou repasse pago. Para manter o histórico, encerre o contrato em vez de excluir." };
  const { error } = await supabase.from("contratos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  const { count: outros } = await supabase.from("contratos").select("id", { count: "exact", head: true }).eq("imovel_id", c.imovel_id).eq("status", "ativo");
  if (!outros) await supabase.from("imoveis").update({ status: "disponivel" }).eq("id", c.imovel_id).eq("status", "alugado");
  revalidatePath("/contratos");
  revalidatePath("/faturas");
  revalidatePath("/imoveis", "layout");
  revalidatePath("/");
  return { ok: true };
}
