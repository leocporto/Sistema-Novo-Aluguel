"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, booleano, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { inicioDoMes, somarDias, somarMeses } from "@/lib/dominio/datas";
import { paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { acertoDeSaida } from "@/lib/dominio/rescisao";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Resultado = { ok: boolean; erro?: string };

function revalidar(contratoId?: string | null) {
  if (contratoId) revalidatePath(`/contratos/${contratoId}`, "layout");
  revalidatePath("/contratos");
  revalidatePath("/faturas", "layout");
  revalidatePath("/financeiro");
  revalidatePath("/repasses", "layout");
  revalidatePath("/imoveis", "layout");
  revalidatePath("/");
}

async function contratoDe(supabase: Supabase, tabela: string, id: string) {
  const { data } = await supabase.from(tabela).select("contrato_id").eq("id", id).maybeSingle();
  return (data?.contrato_id as string | undefined) ?? null;
}

// Ativação (rascunho → ativo) ------------------------------------------------
export async function ativarContrato(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: c, error } = await supabase
    .from("contratos")
    .update({ status: "ativo", ativado_em: new Date().toISOString() })
    .eq("id", id)
    .eq("status", "rascunho")
    .select("imovel_id")
    .maybeSingle();
  if (error) return { ok: false, erro: mensagemErro(error) };
  if (!c) return { ok: false, erro: "Só contrato em rascunho pode ser ativado." };
  await supabase.from("imoveis").update({ status: "alugado" }).eq("id", c.imovel_id);
  revalidar(id);
  return { ok: true };
}

// Descontos temporários --------------------------------------------------------
export async function adicionarDesconto(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const tipo = texto(fd, "tipo") === "pct" ? "pct" : "valor";
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor do desconto.");
    if (tipo === "pct" && valor > 100) throw new ErroValidacao("O desconto não pode passar de 100%.");
    const ini = textoObrigatorio(fd, "inicio", "o mês inicial");
    const fim = texto(fd, "fim");
    const { error } = await supabase.from("contrato_descontos").insert({
      contrato_id,
      tipo,
      valor,
      inicio: inicioDoMes(`${ini}-01`),
      fim: fim ? inicioDoMes(`${fim}-01`) : null,
      motivo: texto(fd, "motivo"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(contrato_id);
  return { ok: "Desconto incluído. Vale para as faturas geradas daqui em diante." };
}

export async function excluirDesconto(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const c = await contratoDe(supabase, "contrato_descontos", id);
  const { error } = await supabase.from("contrato_descontos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar(c);
  return { ok: true };
}

// Itens avulsos na fatura aberta (desconto, reembolso, rateio de despesa) ---------
export async function adicionarItemFatura(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const fatura_id = textoObrigatorio(fd, "fatura_id", "a fatura");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const natureza = texto(fd, "natureza") ?? "cobranca";
    const { data: f, error: e1 } = await supabase.from("faturas").select("status, valor_total").eq("id", fatura_id).single();
    if (e1) throw e1;
    if (f.status !== "aberta") throw new ErroValidacao("Só dá para mexer em fatura em aberto.");
    const assinado = natureza === "desconto" ? -valor : valor;
    if (Number(f.valor_total) + assinado < 0) throw new ErroValidacao("O desconto deixaria a fatura negativa.");
    const { error } = await supabase.from("fatura_itens").insert({
      fatura_id,
      descricao: textoObrigatorio(fd, "descricao", "a descrição"),
      tipo: natureza === "desconto" ? "desconto" : "outro",
      valor: assinado,
      destino: texto(fd, "destino") ?? "proprietario",
    });
    if (error) throw error;
    const { error: e2 } = await supabase
      .from("faturas")
      .update({ valor_total: paraReais(paraCentavos(f.valor_total) + paraCentavos(assinado)) })
      .eq("id", fatura_id);
    if (e2) throw e2;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(contrato_id);
  return { ok: "Item lançado na fatura." };
}

/** Remove um item avulso (desconto/outro) de fatura aberta e corrige o total. */
export async function removerItemFatura(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: it } = await supabase.from("fatura_itens").select("valor, tipo, fatura:faturas(id, status, valor_total, contrato_id)").eq("id", id).single();
  const f = it?.fatura as unknown as { id: string; status: string; valor_total: number; contrato_id: string } | null;
  if (!it || !f) return { ok: false, erro: "Item não encontrado." };
  if (f.status !== "aberta") return { ok: false, erro: "A fatura já foi paga ou cancelada." };
  if (!["desconto", "outro"].includes(it.tipo)) return { ok: false, erro: "Só itens avulsos (desconto/outro) podem ser removidos aqui." };
  const { error } = await supabase.from("fatura_itens").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  await supabase.from("faturas").update({ valor_total: paraReais(paraCentavos(f.valor_total) - paraCentavos(it.valor)) }).eq("id", f.id);
  revalidar(f.contrato_id);
  return { ok: true };
}

/** Desconta do repasse pendente uma despesa do imóvel paga pela imobiliária (só imobiliária). */
export async function descontarNoRepasse(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    if (organizacao.modo === "pessoal") throw new ErroValidacao("Repasse só existe no modo imobiliária.");
    const repasse = textoObrigatorio(fd, "repasse_id", "o repasse");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const { data: r, error: e1 } = await supabase.from("repasses").select("status, outros_descontos, valor_liquido, observacoes").eq("id", repasse).single();
    if (e1) throw e1;
    if (r.status !== "pendente") throw new ErroValidacao("Esse repasse já foi pago ou cancelado.");
    if (Number(r.valor_liquido) - valor < 0) throw new ErroValidacao("O desconto é maior que o repasse.");
    const motivo = textoObrigatorio(fd, "motivo", "o motivo");
    const { error } = await supabase
      .from("repasses")
      .update({
        outros_descontos: paraReais(paraCentavos(r.outros_descontos) + paraCentavos(valor)),
        valor_liquido: paraReais(paraCentavos(r.valor_liquido) - paraCentavos(valor)),
        observacoes: [r.observacoes, `Desconto: ${motivo} (R$ ${valor.toFixed(2).replace(".", ",")})`].filter(Boolean).join(" · "),
      })
      .eq("id", repasse);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(contrato_id);
  return { ok: "Descontado do repasse." };
}

// Aditivos e renovação ----------------------------------------------------------
async function proximoNumeroAditivo(supabase: Supabase, contrato_id: string) {
  const { count } = await supabase.from("contrato_aditivos").select("id", { count: "exact", head: true }).eq("contrato_id", contrato_id);
  return (count ?? 0) + 1;
}

export async function criarAditivo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const valor_novo = numero(fd, "valor_novo");
    if (valor_novo !== null && valor_novo < 0) throw new ErroValidacao("Valor inválido.");
    const { data, error } = await supabase
      .from("contrato_aditivos")
      .insert({
        contrato_id,
        numero: await proximoNumeroAditivo(supabase, contrato_id),
        tipo: texto(fd, "tipo") ?? "outro",
        descricao: textoObrigatorio(fd, "descricao", "o que muda"),
        data: texto(fd, "data") ?? new Date().toISOString().slice(0, 10),
        valor_novo,
        data_fim_nova: texto(fd, "data_fim_nova"),
      })
      .select("id")
      .single();
    if (error) throw error;
    if (booleano(fd, "aplicar") && (valor_novo !== null || texto(fd, "data_fim_nova"))) {
      const { error: e2 } = await supabase.rpc("aplicar_aditivo", { p_id: data.id });
      if (e2) throw e2;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(contrato_id);
  return { ok: "Aditivo registrado." };
}

export async function aplicarAditivo(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const c = await contratoDe(supabase, "contrato_aditivos", id);
  const { error } = await supabase.rpc("aplicar_aditivo", { p_id: id });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar(c);
  return { ok: true };
}

export async function excluirAditivo(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const c = await contratoDe(supabase, "contrato_aditivos", id);
  const { error } = await supabase.from("contrato_aditivos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar(c);
  return { ok: true };
}

/** Renova: cria o aditivo de renovação (novo prazo e, se quiser, novo valor) e aplica. */
export async function renovarContrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const meses = inteiro(fd, "meses");
    if (!meses || meses < 1 || meses > 120) throw new ErroValidacao("Informe por quantos meses renova (1 a 120).");
    const { data: c, error: e1 } = await supabase.from("contratos").select("data_fim, valor_aluguel").eq("id", contrato_id).single();
    if (e1) throw e1;
    const novoFim = somarDias(somarMeses(somarDias(c.data_fim, 1), meses), -1);
    const valor = numero(fd, "valor_novo");
    const { data, error } = await supabase
      .from("contrato_aditivos")
      .insert({
        contrato_id,
        numero: await proximoNumeroAditivo(supabase, contrato_id),
        tipo: "renovacao",
        descricao: `Renovação por mais ${meses} meses${valor ? `, aluguel de R$ ${valor.toFixed(2).replace(".", ",")}` : ""}`,
        valor_novo: valor,
        data_fim_nova: novoFim,
      })
      .select("id")
      .single();
    if (error) throw error;
    const { error: e2 } = await supabase.rpc("aplicar_aditivo", { p_id: data.id });
    if (e2) throw e2;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(contrato_id);
  return { ok: "Contrato renovado." };
}

// Garantias ------------------------------------------------------------------------
export async function adicionarGarantia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const tipo = textoObrigatorio(fd, "tipo", "o tipo");
    const pessoa_id = texto(fd, "pessoa_id");
    if (tipo === "fiador" && !pessoa_id) throw new ErroValidacao("Escolha o fiador.");
    const { error } = await supabase.from("contrato_garantias").insert({
      contrato_id,
      tipo,
      pessoa_id,
      instituicao: texto(fd, "instituicao"),
      numero: texto(fd, "numero"),
      valor: numero(fd, "valor"),
      inicio: texto(fd, "inicio"),
      fim: texto(fd, "fim"),
      conta: texto(fd, "conta"),
      observacoes: texto(fd, "observacoes"),
    });
    if (error) throw error;
    if (tipo === "fiador" && pessoa_id) {
      await supabase.from("contrato_partes").upsert({ contrato_id, pessoa_id, papel: "fiador" }, { onConflict: "contrato_id,pessoa_id,papel" });
      const { data: pes } = await supabase.from("pessoas").select("papeis").eq("id", pessoa_id).single();
      if (pes && !pes.papeis.includes("fiador")) await supabase.from("pessoas").update({ papeis: [...pes.papeis, "fiador"] }).eq("id", pessoa_id);
    }
    // O resumo do contrato (documento) acompanha a garantia principal.
    await supabase.from("contratos").update({ garantia_tipo: tipo, garantia_valor: numero(fd, "valor") }).eq("id", contrato_id).eq("garantia_tipo", "sem_garantia");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(contrato_id);
  return { ok: "Garantia incluída." };
}

export async function atualizarGarantia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = {};
    for (const c of ["instituicao", "numero", "inicio", "fim", "conta", "observacoes", "devolvida_em"]) if (fd.has(c)) d[c] = texto(fd, c);
    for (const c of ["valor", "valor_devolvido"]) if (fd.has(c)) d[c] = numero(fd, c);
    if (fd.has("status")) d.status = texto(fd, "status") ?? "ativa";
    const { error } = await supabase.from("contrato_garantias").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(await contratoDe(supabase, "contrato_garantias", id));
  return { ok: "Salvo." };
}

export async function excluirGarantia(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const c = await contratoDe(supabase, "contrato_garantias", id);
  const { error } = await supabase.from("contrato_garantias").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar(c);
  return { ok: true };
}

// Desocupação e acerto de saída -------------------------------------------------------
export async function iniciarDesocupacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const contrato_id = String(fd.get("contrato_id"));
  try {
    const { data: gar } = await supabase.from("contrato_garantias").select("valor").eq("contrato_id", contrato_id).eq("tipo", "caucao").eq("status", "ativa");
    const caucao = (gar ?? []).reduce((s, g) => s + Number(g.valor ?? 0), 0);
    const { error } = await supabase.from("contrato_desocupacoes").insert({
      contrato_id,
      motivo: texto(fd, "motivo") ?? "rescisao_locatario",
      aviso_em: texto(fd, "aviso_em") ?? new Date().toISOString().slice(0, 10),
      entrega_prevista: texto(fd, "entrega_prevista"),
      aviso_previo_cumprido: !booleano(fd, "sem_aviso"),
      caucao_devolver: caucao,
    });
    if (error) throw error.code === "23505" ? new ErroValidacao("Este contrato já tem uma desocupação em andamento.") : error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(contrato_id);
  return { ok: "Desocupação iniciada." };
}

export async function atualizarDesocupacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const d: Record<string, unknown> = {};
    for (const c of ["motivo", "aviso_em", "entrega_prevista", "entrega_em", "pago_ate", "vistoria_data", "vistoria_resultado", "vistoria_obs", "chaves_devolvidas_em"])
      if (fd.has(c)) d[c] = texto(fd, c);
    for (const c of ["reparos", "outros_debitos", "caucao_devolver"]) if (fd.has(c)) d[c] = Math.max(0, numero(fd, c) ?? 0);
    if (fd.has("_flags")) {
      d.isentar_multa = booleano(fd, "isentar_multa");
      d.aviso_previo_cumprido = !booleano(fd, "sem_aviso");
    }
    if (d.motivo === null) d.motivo = "rescisao_locatario";
    const { data: atual } = await supabase.from("contrato_desocupacoes").select("status, vistoria_data, entrega_em").eq("id", id).single();
    if (atual?.status === "concluida") throw new ErroValidacao("A desocupação já foi concluída.");
    const vistoria = "vistoria_data" in d ? d.vistoria_data : atual?.vistoria_data;
    const entrega = "entrega_em" in d ? d.entrega_em : atual?.entrega_em;
    d.status = entrega ? "acerto" : vistoria ? "vistoria" : "aviso";
    const { error } = await supabase.from("contrato_desocupacoes").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(await contratoDe(supabase, "contrato_desocupacoes", id));
  return { ok: "Salvo." };
}

/** Calcula o acerto no servidor (mesma conta da tela) e conclui. */
export async function concluirDesocupacao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const contratoId = await contratoDe(supabase, "contrato_desocupacoes", id);
  try {
    const { data: d, error } = await supabase
      .from("contrato_desocupacoes")
      .select("*, contrato:contratos(numero, valor_aluguel, data_inicio, prazo_meses, data_fim, multa_rescisoria_alugueis)")
      .eq("id", id)
      .single();
    if (error) throw error;
    const c = d.contrato as unknown as { numero: number; valor_aluguel: number; data_inicio: string; prazo_meses: number; data_fim: string; multa_rescisoria_alugueis: number };
    const entrega = d.entrega_em ?? d.chaves_devolvidas_em;
    if (!entrega) throw new ErroValidacao("Informe a data em que as chaves foram entregues.");
    const pagoAte = d.pago_ate ?? (await ultimoDiaPago(supabase, String(d.contrato_id))) ?? somarDias(c.data_inicio, -1);
    const a = acertoDeSaida(
      {
        valorAluguel: paraCentavos(c.valor_aluguel),
        dataInicio: c.data_inicio,
        prazoMeses: c.prazo_meses,
        dataEntrega: entrega,
        pagoAte,
        multaAlugueis: Number(c.multa_rescisoria_alugueis),
        isentarMulta: d.isentar_multa || d.motivo === "fim_prazo" || d.motivo === "rescisao_locador" || d.motivo === "acordo",
        avisoPrevioCumprido: d.aviso_previo_cumprido,
      },
      { reparos: paraCentavos(d.reparos), outros: paraCentavos(d.outros_debitos), caucao: paraCentavos(d.caucao_devolver) },
    );
    const { error: e2 } = await supabase.rpc("concluir_desocupacao", {
      p_id: id,
      p: {
        total: paraReais(a.total),
        entrega,
        pago_ate: pagoAte,
        encerrar_como: d.motivo === "fim_prazo" ? "encerrado" : "rescindido",
        descricao: `Acerto de saída — contrato #${c.numero}`,
        itens: a.linhas.map((l) => ({ descricao: l.descricao, valor: paraReais(l.valor) })),
      },
    });
    if (e2) throw e2;
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidar(contratoId);
  return { ok: true };
}

export async function excluirDesocupacao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const c = await contratoDe(supabase, "contrato_desocupacoes", id);
  const { data } = await supabase.from("contrato_desocupacoes").select("status").eq("id", id).single();
  if (data?.status === "concluida") return { ok: false, erro: "Desocupação concluída não pode ser excluída (o contrato já foi encerrado)." };
  const { error } = await supabase.from("contrato_desocupacoes").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidar(c);
  return { ok: true };
}

/** Último dia coberto por fatura paga do contrato. */
async function ultimoDiaPago(supabase: Supabase, contratoId: string): Promise<string | null> {
  const { data } = await supabase
    .from("faturas")
    .select("periodo_fim, competencia")
    .eq("contrato_id", contratoId)
    .eq("status", "paga")
    .order("competencia", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.periodo_fim as string | null) ?? null;
}
