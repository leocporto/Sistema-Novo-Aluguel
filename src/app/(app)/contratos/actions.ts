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
        taxa_administracao_pct: pessoal ? 0 : (numero(fd, "taxa_administracao_pct") ?? 10),
        taxa_intermediacao_pct: pessoal ? 0 : (numero(fd, "taxa_intermediacao_pct") ?? 0),
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
      await supabase.from("imoveis").update({ status: "alugado" }).eq("id", imovelId);
      for (const pid of [locatarioId, texto(fd, "fiador_id")].filter(Boolean) as string[]) {
        const { data: pes } = await supabase.from("pessoas").select("papeis").eq("id", pid).single();
        const papel = pid === locatarioId ? "locatario" : "fiador";
        if (pes && !pes.papeis.includes(papel))
          await supabase.from("pessoas").update({ papeis: [...pes.papeis, papel] }).eq("id", pid);
      }
    } catch (e) {
      await supabase.from("contratos").delete().eq("id", id);
      throw e;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/contratos");
  revalidatePath("/");
  redirect(`/contratos/${id}`);
}

export async function atualizarContrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { error } = await supabase
      .from("contratos")
      .update({
        codigo: texto(fd, "codigo"),
        dia_vencimento: inteiro(fd, "dia_vencimento"),
        modalidade: texto(fd, "modalidade"),
        indice_reajuste: texto(fd, "indice_reajuste"),
        taxa_administracao_pct: numero(fd, "taxa_administracao_pct"),
        tipo_repasse: texto(fd, "tipo_repasse"),
        dias_repasse: inteiro(fd, "dias_repasse"),
        repassar_multa_juros: booleano(fd, "repassar_multa_juros"),
        multa_atraso_pct: numero(fd, "multa_atraso_pct"),
        juros_mes_pct: numero(fd, "juros_mes_pct"),
        carencia_dias: inteiro(fd, "carencia_dias"),
        garantia_tipo: texto(fd, "garantia_tipo"),
        garantia_valor: numero(fd, "garantia_valor"),
        garantia_detalhes: texto(fd, "garantia_detalhes"),
        seguro_incendio_apolice: texto(fd, "seguro_incendio_apolice"),
        seguro_incendio_vencimento: texto(fd, "seguro_incendio_vencimento"),
        observacoes: texto(fd, "observacoes"),
      })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/contratos/${id}`);
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
  revalidatePath(`/contratos/${contrato_id}`);
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
  revalidatePath(`/contratos/${contrato_id}`);
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
  revalidatePath(`/contratos/${contrato_id}`);
  revalidatePath("/");
  return { ok: "Encargo adicionado." };
}

export async function removerEncargo(fd: FormData) {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  await supabase.from("contrato_encargos").delete().eq("id", String(fd.get("id")));
  revalidatePath(`/contratos/${contrato_id}`);
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
  revalidatePath(`/contratos/${contrato_id}`);
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
  revalidatePath(`/contratos/${contrato_id}`);
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
    await supabase.from("imoveis").update({ status: "disponivel" }).eq("id", c.imovel_id);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath(`/contratos/${contrato_id}`);
  revalidatePath("/");
  revalidatePath("/contratos");
  return { ok: "Contrato encerrado e imóvel marcado como desalugado." };
}
