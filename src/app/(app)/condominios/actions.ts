"use server";

import { redirect } from "next/navigation";
import { hojeISO } from "@/lib/dominio/datas";
import { CRITERIOS_RATEIO, PAPEIS_CONDOMINIO, PERIODICIDADES, SITUACOES_UNIDADE, TIPOS_CONSUMO, TIPOS_RATEIO, TIPOS_UNIDADE, expandirNumeros } from "@/lib/dominio/condominios";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { MES, UUID, contextoCondominio, falha, partes, revalidarCondominio, type Resultado } from "./acesso";

/*
 * Ações dos condomínios (cadastro, livro-caixa, orçamento, cotas, acordos,
 * fornecedores). Toda regra sensível também está no banco (policies com
 * privado.cond_pode e as RPCs cond_*): aqui só damos a mensagem amigável.
 */

const umDe = <T extends string>(v: string | null, lista: Record<T, string>, padrao: NoInfer<T>): T => (v && v in lista ? (v as T) : padrao);
const marcado = (fd: FormData, k: string) => fd.getAll(k).includes("on");
const condDe = (fd: FormData) => {
  const c = textoObrigatorio(fd, "condominio_id", "o condomínio");
  if (!UUID.test(c)) throw new ErroValidacao("Condomínio inválido.");
  return c;
};
const mesDe = (fd: FormData, k = "mes") => {
  const m = texto(fd, k);
  if (!m || !MES.test(m)) throw new ErroValidacao("Escolha o mês.");
  return `${m}-01`;
};

// ---------------------------------------------------------------------------
// Condomínio
// ---------------------------------------------------------------------------

function camposCondominio(fd: FormData) {
  return {
    nome: textoObrigatorio(fd, "nome", "o nome do condomínio"),
    cnpj: texto(fd, "cnpj"),
    cep: texto(fd, "cep"),
    logradouro: texto(fd, "logradouro"),
    numero: texto(fd, "numero"),
    complemento: texto(fd, "complemento"),
    bairro: texto(fd, "bairro"),
    cidade: texto(fd, "cidade"),
    uf: texto(fd, "uf")?.toUpperCase().slice(0, 2) ?? null,
    dia_vencimento: Math.min(31, Math.max(1, inteiro(fd, "dia_vencimento") ?? 10)),
    multa_pct: numero(fd, "multa_pct") ?? 2,
    juros_mes_pct: numero(fd, "juros_mes_pct") ?? 1,
    criterio_rateio: umDe(texto(fd, "criterio_rateio"), CRITERIOS_RATEIO, "fracao"),
    fundo_reserva_pct: numero(fd, "fundo_reserva_pct") ?? 0,
  };
}

export async function criarCondominio(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  let id: string;
  try {
    const { supabase } = await contextoCondominio("imoveis", "criar");
    const { data, error } = await supabase.from("cond_condominios").insert(camposCondominio(fd)).select("id").single();
    if (error) throw error;
    id = data.id as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(id);
  redirect(`/condominios/${id}`);
}

export async function salvarCondominio(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const id = String(fd.get("id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const { error } = await supabase
      .from("cond_condominios")
      .update({
        ...camposCondominio(fd),
        responsavel_user_id: texto(fd, "responsavel_user_id"),
        voto_peso: texto(fd, "voto_peso") === "unidade" ? "unidade" : "fracao",
        pix_chave: texto(fd, "pix_chave"),
        pix_nome: texto(fd, "pix_nome"),
        pix_cidade: texto(fd, "pix_cidade"),
        banco: texto(fd, "banco"),
        agencia: texto(fd, "agencia"),
        conta: texto(fd, "conta"),
        taxa_administracao: numero(fd, "taxa_administracao") ?? 0,
        ativo: marcado(fd, "ativo"),
        observacoes: texto(fd, "observacoes"),
      })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(id);
  return { ok: "Salvo." };
}

export async function excluirCondominio(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "excluir");
    // O banco recusa se houver histórico (cota recebida, lançamento pago, mês fechado, assembleia encerrada).
    const { error } = await supabase.from("cond_condominios").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidarCondominio();
  return { ok: true };
}

/** Taxa de administração do mês no financeiro DA IMOBILIÁRIA (botão explícito; uma vez por mês). */
export async function lancarTaxaAdmin(valor: string): Promise<Resultado> {
  const [cond, mes] = partes(valor);
  try {
    if (!MES.test(mes)) throw new ErroValidacao("Mês inválido.");
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const { error } = await supabase.rpc("cond_lancar_taxa_admin", { p_condominio: cond, p_competencia: `${mes}-01` });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidarCondominio(cond);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Blocos e unidades
// ---------------------------------------------------------------------------

export async function criarBloco(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "criar");
    const { error } = await supabase.from("cond_blocos").insert({ condominio_id: condDe(fd), nome: textoObrigatorio(fd, "nome", "o nome do bloco"), ordem: inteiro(fd, "ordem") ?? 0 });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Bloco criado." };
}

export async function excluirBloco(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "excluir");
    const { data } = await supabase.from("cond_blocos").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_blocos").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

/** Cria várias unidades de uma vez ("101-104, 201-204"), com a mesma fração/área se informadas. */
export async function criarUnidades(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  let n = 0;
  try {
    const { supabase } = await contextoCondominio("imoveis", "criar");
    let numeros: string[];
    try {
      numeros = expandirNumeros(textoObrigatorio(fd, "numeros", "os números das unidades"));
    } catch (e) {
      throw new ErroValidacao(e instanceof Error ? e.message : "Números inválidos.");
    }
    const linhas = numeros.map((numero) => ({
      condominio_id: condDe(fd),
      bloco_id: texto(fd, "bloco_id"),
      numero,
      tipo: umDe(texto(fd, "tipo"), TIPOS_UNIDADE, "apartamento"),
      area_privativa: numero_(fd, "area_privativa"),
      fracao_ideal: numero_(fd, "fracao_ideal"),
    }));
    const { error } = await supabase.from("cond_unidades").insert(linhas);
    if (error) throw error;
    n = linhas.length;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: `${n} unidade(s) criada(s).` };
}
const numero_ = (fd: FormData, k: string) => numero(fd, k);

export async function salvarUnidade(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const id = String(fd.get("id") ?? "");
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const { error } = await supabase
      .from("cond_unidades")
      .update({
        numero: textoObrigatorio(fd, "numero", "o número"),
        bloco_id: texto(fd, "bloco_id"),
        tipo: umDe(texto(fd, "tipo"), TIPOS_UNIDADE, "apartamento"),
        area_privativa: numero(fd, "area_privativa"),
        fracao_ideal: numero(fd, "fracao_ideal"),
        vaga: texto(fd, "vaga"),
        situacao: umDe(texto(fd, "situacao"), SITUACOES_UNIDADE, "ocupada"),
        observacoes: texto(fd, "observacoes"),
      })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Salvo." };
}

export async function excluirUnidade(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "excluir");
    const { data } = await supabase.from("cond_unidades").select("condominio_id").eq("id", id).maybeSingle();
    const { count } = await supabase.from("cond_cotas").select("id", { count: "exact", head: true }).eq("unidade_id", id);
    if (count) throw new ErroValidacao("Esta unidade já tem cotas: não dá para excluir.");
    const { error } = await supabase.from("cond_unidades").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Condôminos, moradores, síndico
// ---------------------------------------------------------------------------

export async function vincularPessoa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "criar");
    const papel = umDe(texto(fd, "papel"), PAPEIS_CONDOMINIO, "proprietario");
    const { error } = await supabase.from("cond_pessoas_unidade").insert({
      condominio_id: condDe(fd),
      unidade_id: texto(fd, "unidade_id"),
      pessoa_id: textoObrigatorio(fd, "pessoa_id", "a pessoa"),
      papel,
      inicio: texto(fd, "inicio") ?? hojeISO(),
      responsavel_financeiro: marcado(fd, "responsavel_financeiro"),
    });
    if (error) {
      if (error.message.includes("cond_pessoas_unidade_resp_idx")) throw new ErroValidacao("Esta unidade já tem responsável financeiro: encerre o vínculo dele antes.");
      throw error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Pessoa ligada ao condomínio." };
}

/** Encerra o vínculo hoje (mudou, vendeu, saiu do conselho…). O histórico fica. */
export async function encerrarVinculo(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const { data, error } = await supabase.from("cond_pessoas_unidade").update({ fim: hojeISO(), responsavel_financeiro: false }).eq("id", id).select("condominio_id").single();
    if (error) throw error;
    revalidarCondominio(data.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function excluirVinculo(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "excluir");
    const { data } = await supabase.from("cond_pessoas_unidade").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_pessoas_unidade").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Livro-caixa: contas e lançamentos
// ---------------------------------------------------------------------------

export async function criarConta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const tipo = texto(fd, "tipo");
    const { error } = await supabase.from("cond_contas").insert({
      condominio_id: condDe(fd),
      nome: textoObrigatorio(fd, "nome", "o nome da conta"),
      tipo: tipo === "reserva" || tipo === "fundo" ? tipo : "corrente",
      saldo_inicial: numero(fd, "saldo_inicial") ?? 0,
      banco: texto(fd, "banco"),
      agencia: texto(fd, "agencia"),
      conta: texto(fd, "conta"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Conta criada." };
}

export async function salvarConta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { error } = await supabase
      .from("cond_contas")
      .update({ nome: textoObrigatorio(fd, "nome", "o nome"), saldo_inicial: numero(fd, "saldo_inicial") ?? 0, ativa: marcado(fd, "ativa") })
      .eq("id", String(fd.get("id") ?? ""));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Salvo." };
}

export async function excluirConta(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "excluir");
    const { data } = await supabase.from("cond_contas").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_contas").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

/** Receita, despesa ou transferência no livro-caixa do condomínio (nada vai para o financeiro da imobiliária). */
export async function criarLancamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const tipo = texto(fd, "tipo");
    if (tipo !== "receita" && tipo !== "despesa" && tipo !== "transferencia") throw new ErroValidacao("Escolha o tipo.");
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor.");
    const pago = texto(fd, "status") === "pago";
    const vencimento = texto(fd, "vencimento") ?? hojeISO();
    const { error } = await supabase.from("cond_lancamentos").insert({
      condominio_id: condDe(fd),
      tipo,
      conta_id: texto(fd, "conta_id"),
      conta_destino_id: tipo === "transferencia" ? texto(fd, "conta_destino_id") : null,
      categoria: tipo === "transferencia" ? "Transferência entre contas" : textoObrigatorio(fd, "categoria", "a categoria"),
      descricao: textoObrigatorio(fd, "descricao", "a descrição"),
      valor,
      competencia: texto(fd, "competencia") ? `${texto(fd, "competencia")}-01` : vencimento,
      vencimento,
      status: pago ? "pago" : "aberto",
      pago_em: pago ? (texto(fd, "pago_em") ?? hojeISO()) : null,
      fornecedor_id: texto(fd, "fornecedor_id"),
      aprovacao_assembleia_id: texto(fd, "aprovacao_assembleia_id"),
      aprovacao_texto: texto(fd, "aprovacao_texto"),
      observacoes: texto(fd, "observacoes"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Lançado." };
}

/** Marca como pago hoje (botão com confirmação mostrando o valor). */
export async function pagarLancamento(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { data, error } = await supabase.from("cond_lancamentos").update({ status: "pago", pago_em: hojeISO() }).eq("id", id).eq("status", "aberto").select("condominio_id").single();
    if (error) throw error;
    revalidarCondominio(data.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function reabrirLancamento(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { data, error } = await supabase.from("cond_lancamentos").update({ status: "aberto" }).eq("id", id).select("condominio_id").single();
    if (error) throw error;
    revalidarCondominio(data.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function excluirLancamento(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "excluir");
    const { data } = await supabase.from("cond_lancamentos").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_lancamentos").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function fecharMes(valor: string): Promise<Resultado> {
  const [cond, mes] = partes(valor);
  try {
    if (!MES.test(mes)) throw new ErroValidacao("Mês inválido.");
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { error } = await supabase.rpc("cond_fechar_mes", { p_condominio: cond, p_competencia: `${mes}-01` });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidarCondominio(cond);
  return { ok: true };
}

/** Reabrir mês fechado: só o administrador, com motivo (o banco também confere e registra). */
export async function reabrirMes(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase, papel } = await contextoCondominio("financeiro", "editar");
    if (papel !== "admin") throw new ErroValidacao("Só o administrador reabre um mês fechado.");
    const { error } = await supabase.rpc("cond_reabrir_mes", { p_condominio: condDe(fd), p_competencia: mesDe(fd), p_motivo: textoObrigatorio(fd, "motivo", "o motivo") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Mês reaberto." };
}

// ---------------------------------------------------------------------------
// Orçamento e rateios extras
// ---------------------------------------------------------------------------

export async function criarOrcamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const ano = inteiro(fd, "ano");
    if (!ano || ano < 2000 || ano > 2100) throw new ErroValidacao("Ano inválido.");
    const { data, error } = await supabase.from("cond_orcamentos").insert({ condominio_id: condDe(fd), ano, descricao: texto(fd, "descricao") }).select("id").single();
    if (error) throw error;
    // Copia os itens do orçamento aprovado do ano anterior (se houver), para ajustar.
    if (marcado(fd, "copiar")) {
      const { data: ant } = await supabase.from("cond_orcamentos").select("id").eq("condominio_id", cond).eq("ano", ano - 1).eq("status", "aprovado").maybeSingle();
      if (ant) {
        const { data: itens } = await supabase.from("cond_orcamento_itens").select("categoria, tipo, valor_mensal, observacao").eq("orcamento_id", ant.id);
        if (itens?.length) {
          const { error: e2 } = await supabase.from("cond_orcamento_itens").insert(itens.map((i) => ({ ...i, condominio_id: cond, orcamento_id: data.id })));
          if (e2) throw e2;
        }
      }
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Orçamento criado." };
}

export async function adicionarItemOrcamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { error } = await supabase.from("cond_orcamento_itens").insert({
      condominio_id: condDe(fd),
      orcamento_id: textoObrigatorio(fd, "orcamento_id", "o orçamento"),
      categoria: textoObrigatorio(fd, "categoria", "a categoria"),
      tipo: texto(fd, "tipo") === "receita" ? "receita" : "despesa",
      valor_mensal: numero(fd, "valor_mensal") ?? 0,
      observacao: texto(fd, "observacao"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Item incluído." };
}

export async function excluirItemOrcamento(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { data } = await supabase.from("cond_orcamento_itens").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_orcamento_itens").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

/** "id|aprovado" ou "id|rascunho". */
export async function statusOrcamento(valor: string): Promise<Resultado> {
  const [id, status] = partes(valor);
  try {
    const { supabase } = await contextoCondominio("financeiro", "aprovar");
    const { data, error } = await supabase
      .from("cond_orcamentos")
      .update({ status: status === "aprovado" ? "aprovado" : "rascunho" })
      .eq("id", id)
      .select("condominio_id")
      .single();
    if (error) {
      if (error.message.includes("cond_orcamentos_aprovado_idx")) throw new ErroValidacao("Já existe um orçamento aprovado para este ano: volte o outro para rascunho antes.");
      throw error;
    }
    revalidarCondominio(data.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function excluirOrcamento(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "excluir");
    const { data } = await supabase.from("cond_orcamentos").select("condominio_id, status").eq("id", id).maybeSingle();
    if (data?.status === "aprovado") throw new ErroValidacao("Volte o orçamento para rascunho antes de excluir.");
    const { error } = await supabase.from("cond_orcamentos").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function criarRateio(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const valor = numero(fd, "valor_total");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor total.");
    const { error } = await supabase.from("cond_rateios").insert({
      condominio_id: condDe(fd),
      descricao: textoObrigatorio(fd, "descricao", "a descrição"),
      tipo: umDe(texto(fd, "tipo"), TIPOS_RATEIO, "obra"),
      valor_total: valor,
      parcelas: Math.min(120, Math.max(1, inteiro(fd, "parcelas") ?? 1)),
      primeira_competencia: mesDe(fd, "primeira"),
      criterio: umDe(texto(fd, "criterio"), CRITERIOS_RATEIO, "fracao"),
      conta_id: texto(fd, "conta_id"),
      assembleia_id: texto(fd, "assembleia_id"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Rateio criado: entra nas próximas cotas geradas." };
}

export async function encerrarRateio(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { data, error } = await supabase.from("cond_rateios").update({ ativo: false }).eq("id", id).select("condominio_id").single();
    if (error) throw error;
    revalidarCondominio(data.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function excluirRateio(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "excluir");
    const { data } = await supabase.from("cond_rateios").select("condominio_id").eq("id", id).maybeSingle();
    const { count } = await supabase.from("cond_cota_itens").select("id", { count: "exact", head: true }).eq("rateio_id", id);
    if (count) throw new ErroValidacao("Este rateio já foi cobrado em cotas: encerre em vez de excluir.");
    const { error } = await supabase.from("cond_rateios").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Cotas, consumo, baixa, acordo, inadimplência
// ---------------------------------------------------------------------------

export async function gerarCotas(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  let msg = "";
  try {
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const base = numero(fd, "valor_base");
    const { data, error } = await supabase.rpc("cond_gerar_cotas", { p_condominio: condDe(fd), p_competencia: mesDe(fd), p_valor_base: base && base > 0 ? base : null });
    if (error) throw error;
    const r = data as { criadas: number; existentes: number };
    msg = r.criadas ? `${r.criadas} cota(s) gerada(s).` : "Todas as unidades já tinham cota neste mês.";
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: msg };
}

export async function cotaAvulsa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const { error } = await supabase.rpc("cond_cota_avulsa", {
      p_unidade: textoObrigatorio(fd, "unidade_id", "a unidade"),
      p_vencimento: textoObrigatorio(fd, "vencimento", "o vencimento"),
      p_descricao: textoObrigatorio(fd, "descricao", "a descrição"),
      p_valor: numero(fd, "valor") ?? 0,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Cobrança criada." };
}

/** Baixa (inteira ou parcial) com multa e juros separados — sempre pela RPC do banco. */
export async function receberCota(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { error } = await supabase.rpc("cond_registrar_pagamento", {
      p_cota: textoObrigatorio(fd, "cota_id", "a cota"),
      p_data: texto(fd, "data") ?? hojeISO(),
      p_valor: numero(fd, "valor") ?? 0,
      p_multa: numero(fd, "multa") ?? 0,
      p_juros: numero(fd, "juros") ?? 0,
      p_desconto: numero(fd, "desconto") ?? 0,
      p_forma: texto(fd, "forma"),
      p_conta: texto(fd, "conta_id"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Recebimento registrado." };
}

export async function estornarPagamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { error } = await supabase.rpc("cond_estornar_pagamento", { p_pagamento: textoObrigatorio(fd, "pagamento_id", "o recebimento"), p_motivo: textoObrigatorio(fd, "motivo", "o motivo") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Recebimento desfeito." };
}

export async function cancelarCota(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "excluir");
    const { error } = await supabase.rpc("cond_cancelar_cota", { p_cota: textoObrigatorio(fd, "cota_id", "a cota"), p_motivo: textoObrigatorio(fd, "motivo", "o motivo") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Cota cancelada." };
}

export async function registrarConsumo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const anterior = numero(fd, "leitura_anterior");
    const atual = numero(fd, "leitura_atual");
    const tarifa = numero(fd, "tarifa");
    let valor = numero(fd, "valor");
    if (valor == null && anterior != null && atual != null && tarifa != null) {
      if (atual < anterior) throw new ErroValidacao("A leitura atual é menor que a anterior.");
      valor = Math.round((atual - anterior) * tarifa * 100) / 100;
    }
    if (valor == null || valor < 0) throw new ErroValidacao("Informe o valor (ou as leituras e o preço por unidade).");
    const { error } = await supabase.from("cond_consumos").insert({
      condominio_id: condDe(fd),
      unidade_id: textoObrigatorio(fd, "unidade_id", "a unidade"),
      competencia: mesDe(fd),
      tipo: umDe(texto(fd, "tipo"), TIPOS_CONSUMO, "agua"),
      leitura_anterior: anterior,
      leitura_atual: atual,
      valor,
    });
    if (error) {
      if (error.message.includes("cond_consumos_un_idx")) throw new ErroValidacao("Esta unidade já tem esse consumo lançado no mês.");
      throw error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Consumo lançado: entra na cota do mês." };
}

export async function excluirConsumo(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "excluir");
    const { data } = await supabase.from("cond_consumos").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_consumos").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function marcarJuridico(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  const ligar = texto(fd, "juridico") === "sim";
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { error } = await supabase.rpc("cond_marcar_juridico", { p_unidade: textoObrigatorio(fd, "unidade_id", "a unidade"), p_juridico: ligar, p_obs: texto(fd, "obs") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: ligar ? "Marcada como cobrança judicial." : "Cobrança judicial encerrada." };
}

export async function criarAcordo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const cotas = fd.getAll("cotas").map(String).filter((c) => UUID.test(c));
    if (!cotas.length) throw new ErroValidacao("Escolha as cotas do acordo.");
    const { error } = await supabase.rpc("cond_criar_acordo", {
      p_unidade: textoObrigatorio(fd, "unidade_id", "a unidade"),
      p_cotas: cotas,
      p_parcelas: inteiro(fd, "parcelas") ?? 1,
      p_primeiro_vencimento: textoObrigatorio(fd, "primeiro_vencimento", "o primeiro vencimento"),
      p_desconto: numero(fd, "desconto") ?? 0,
      p_obs: texto(fd, "obs"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Acordo criado: as parcelas aparecem em Cotas." };
}

export async function cancelarAcordo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "excluir");
    const { error } = await supabase.rpc("cond_cancelar_acordo", { p_acordo: textoObrigatorio(fd, "acordo_id", "o acordo"), p_motivo: textoObrigatorio(fd, "motivo", "o motivo") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Acordo cancelado: as cotas voltaram a ficar em aberto." };
}

// ---------------------------------------------------------------------------
// Contratos com fornecedores
// ---------------------------------------------------------------------------

function camposContrato(fd: FormData) {
  return {
    fornecedor_id: texto(fd, "fornecedor_id"),
    fornecedor_nome: texto(fd, "fornecedor_nome"),
    servico: textoObrigatorio(fd, "servico", "o serviço"),
    categoria: texto(fd, "categoria") ?? "Serviços",
    valor: numero(fd, "valor") ?? 0,
    periodicidade: umDe(texto(fd, "periodicidade"), PERIODICIDADES, "mensal"),
    inicio: textoObrigatorio(fd, "inicio", "o início"),
    fim: texto(fd, "fim"),
    dia_vencimento: inteiro(fd, "dia_vencimento"),
    reajuste_indice: texto(fd, "reajuste_indice"),
    reajuste_mes: inteiro(fd, "reajuste_mes"),
    conta_id: texto(fd, "conta_id"),
    observacoes: texto(fd, "observacoes"),
  };
}

export async function criarContrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const c = camposContrato(fd);
    if (!c.fornecedor_id && !c.fornecedor_nome) throw new ErroValidacao("Escolha o fornecedor (ou escreva o nome).");
    const { error } = await supabase.from("cond_contratos_fornecedores").insert({ condominio_id: condDe(fd), ...c });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Contrato cadastrado." };
}

export async function salvarContrato(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { error } = await supabase
      .from("cond_contratos_fornecedores")
      .update({ ...camposContrato(fd), ativo: marcado(fd, "ativo") })
      .eq("id", String(fd.get("id") ?? ""));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Salvo." };
}

export async function excluirContrato(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "excluir");
    const { data } = await supabase.from("cond_contratos_fornecedores").select("condominio_id, documento_path").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_contratos_fornecedores").delete().eq("id", id);
    if (error) throw error;
    if (data?.documento_path) await supabase.storage.from("condominios").remove([data.documento_path as string]);
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

/**
 * Arquivo do contrato (PDF, foto, Word…) enviado pela tela para
 * <org>/<condomínio>/contratos/<contrato>/ do bucket privado "condominios";
 * aqui só gravamos o caminho (o banco confere a pasta). O arquivo anterior é apagado.
 */
export async function registrarArquivoContrato(p: { contratoId: string; path: string }): Promise<Resultado> {
  try {
    if (!UUID.test(p.contratoId)) throw new ErroValidacao("Contrato inválido.");
    const { supabase, organizacao } = await contextoCondominio("financeiro", "editar");
    const { data: k } = await supabase.from("cond_contratos_fornecedores").select("condominio_id, documento_path").eq("id", p.contratoId).maybeSingle();
    if (!k) throw new ErroValidacao("Contrato não encontrado.");
    const pasta = `${organizacao.id}/${k.condominio_id as string}/contratos/${p.contratoId}/`;
    if (!p.path.startsWith(pasta) || p.path.includes("..")) throw new ErroValidacao("Arquivo fora da pasta do contrato.");
    const { error } = await supabase.from("cond_contratos_fornecedores").update({ documento_path: p.path }).eq("id", p.contratoId);
    if (error) {
      await supabase.storage.from("condominios").remove([p.path]);
      throw error;
    }
    if (k.documento_path && k.documento_path !== p.path) await supabase.storage.from("condominios").remove([k.documento_path as string]);
    revalidarCondominio(k.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

/** Tira o arquivo do contrato (o contrato continua cadastrado). */
export async function tirarArquivoContrato(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("financeiro", "editar");
    const { data: k } = await supabase.from("cond_contratos_fornecedores").select("condominio_id, documento_path").eq("id", id).maybeSingle();
    if (!k) throw new ErroValidacao("Contrato não encontrado.");
    const { error } = await supabase.from("cond_contratos_fornecedores").update({ documento_path: null }).eq("id", id);
    if (error) throw error;
    if (k.documento_path) await supabase.storage.from("condominios").remove([k.documento_path as string]);
    revalidarCondominio(k.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

/** "cond|AAAA-MM": cria as despesas previstas do mês a partir dos contratos (sem repetir). */
export async function gerarPrevisoes(valor: string): Promise<Resultado> {
  const [cond, mes] = partes(valor);
  try {
    if (!MES.test(mes)) throw new ErroValidacao("Mês inválido.");
    const { supabase } = await contextoCondominio("financeiro", "criar");
    const { error } = await supabase.rpc("cond_gerar_previsoes", { p_condominio: cond, p_competencia: `${mes}-01` });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidarCondominio(cond);
  return { ok: true };
}
