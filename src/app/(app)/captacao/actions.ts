"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, booleano, inteiro, lista, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { CHECKLIST_CAPTACAO, ROTULO_ETAPA_CAPTACAO, TODAS_ETAPAS_CAPTACAO, ordemEtapaCaptacao } from "@/lib/dominio/captacao";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Resultado = { ok: boolean; erro?: string };

function revalidarTudo() {
  revalidatePath("/captacao", "layout");
  revalidatePath("/");
}

const DATAS = ["avaliado_em", "proposta_enviada_em", "exclusividade_inicio", "exclusividade_fim", "autorizacao_data", "autorizacao_validade"];
const TEXTOS = [
  "proprietario_telefone", "proprietario_email", "cep", "logradouro", "numero_end", "complemento", "bairro", "cidade", "uf",
  "observacoes", "avaliacao_notas", "proposta_texto",
];
const NUMEROS = [
  "area", "valor_pretendido", "valor_avaliado_aluguel", "valor_avaliado_venda",
  "proposta_taxa_adm", "proposta_taxa_intermediacao", "proposta_comissao_venda",
];
const INTEIROS = ["quartos", "suites", "banheiros", "vagas"];

/** Lê só os campos que vieram no formulário (cada quadro da ficha salva a sua parte). */
function lerCaptacao(fd: FormData) {
  const d: Record<string, unknown> = {};
  if (fd.has("proprietario_nome")) d.proprietario_nome = textoObrigatorio(fd, "proprietario_nome", "o nome do proprietário");
  for (const c of [...TEXTOS, ...DATAS]) if (fd.has(c)) d[c] = texto(fd, c);
  for (const c of NUMEROS) if (fd.has(c)) d[c] = numero(fd, c);
  for (const c of INTEIROS) if (fd.has(c)) d[c] = inteiro(fd, c);
  if (fd.has("tipo")) d.tipo = texto(fd, "tipo") ?? "apartamento";
  if (fd.has("origem")) d.origem = texto(fd, "origem") ?? "outro";
  if (fd.has("corretor_id")) d.corretor_id = texto(fd, "corretor_id");
  if (fd.has("proprietario_id")) d.proprietario_id = texto(fd, "proprietario_id");
  if (fd.has("_finalidades")) {
    const f = lista(fd, "finalidades").filter((x) => x === "locacao" || x === "venda");
    if (!f.length) throw new ErroValidacao("Marque se o imóvel é para alugar, vender ou os dois.");
    d.finalidades = f;
  }
  if (fd.has("proposta_tipo")) {
    const t = texto(fd, "proposta_tipo");
    d.proposta_tipo = t === "intermediacao" || t === "ambos" ? t : "administracao";
  }
  if (fd.has("proposta_status")) {
    const s = texto(fd, "proposta_status");
    d.proposta_status = ["rascunho", "enviada", "aceita", "recusada"].includes(s ?? "") ? s : "rascunho";
  }
  if (fd.has("fotos_status")) {
    const s = texto(fd, "fotos_status");
    d.fotos_status = ["pendente", "agendadas", "feitas", "tratadas"].includes(s ?? "") ? s : "pendente";
  }
  if (fd.has("_exclusivo")) d.exclusivo = booleano(fd, "exclusivo");
  if (fd.has("_autorizacao")) d.autorizacao_anuncio = booleano(fd, "autorizacao_anuncio");
  for (const c of ["proposta_taxa_adm", "proposta_taxa_intermediacao", "proposta_comissao_venda"]) {
    const v = d[c];
    if (typeof v === "number" && (v < 0 || v > 100)) throw new ErroValidacao("As taxas devem ficar entre 0% e 100%.");
  }
  if (typeof d.uf === "string") d.uf = d.uf.toUpperCase().slice(0, 2);
  if (typeof d.proprietario_email === "string") d.proprietario_email = d.proprietario_email.toLowerCase();
  if (d.exclusividade_inicio && d.exclusividade_fim && String(d.exclusividade_fim) < String(d.exclusividade_inicio))
    throw new ErroValidacao("O fim da exclusividade está antes do início.");
  return d;
}

async function evento(supabase: Supabase, id: string, tipo: string, descricao: string | null) {
  await supabase.from("captacao_eventos").insert({ captacao_id: id, tipo, descricao });
}

export async function criarCaptacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  let id: string;
  try {
    const dados = lerCaptacao(fd);
    let corretor = (dados.corretor_id as string | null) ?? null;
    if (corretor === "auto") {
      const { data } = await supabase.rpc("proximo_corretor_lead");
      corretor = (data as string | null) ?? null;
    }
    const { data, error } = await supabase
      .from("captacoes")
      .insert({ ...dados, corretor_id: corretor })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id;
    await evento(supabase, id, "entrada", "Oportunidade cadastrada");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  redirect(`/captacao/${id}`);
}

/** Muda a etapa (guarda até onde chegou e o motivo quando não foi captado). */
async function aplicarEtapa(supabase: Supabase, id: string, status: string, motivo?: string | null) {
  if (!(TODAS_ETAPAS_CAPTACAO as readonly string[]).includes(status)) throw new ErroValidacao("Etapa inválida.");
  if (status === "captado") throw new ErroValidacao('Para captar, use o botão "Converter em imóvel" na ficha.');
  const { data: atual, error: e1 } = await supabase.from("captacoes").select("status, etapa_max, imovel_id").eq("id", id).single();
  if (e1) throw e1;
  if (atual.status === status) return;
  if (atual.imovel_id) throw new ErroValidacao("Esta captação já virou imóvel.");
  if (status === "nao_captado" && !motivo) throw new ErroValidacao("Escolha o motivo.");
  const dados: Record<string, unknown> = { status };
  const ordem = ordemEtapaCaptacao(status);
  if (ordem > atual.etapa_max) dados.etapa_max = ordem;
  if (status === "nao_captado") {
    dados.motivo_nao_captado = motivo;
    dados.nao_captado_em = new Date().toISOString();
  } else {
    dados.motivo_nao_captado = null;
    dados.nao_captado_em = null;
  }
  const { error } = await supabase.from("captacoes").update(dados).eq("id", id);
  if (error) throw error;
  await evento(
    supabase,
    id,
    status === "nao_captado" ? "perda" : "etapa",
    status === "nao_captado" ? `Não captado: ${motivo}` : `${ROTULO_ETAPA_CAPTACAO[atual.status]} → ${ROTULO_ETAPA_CAPTACAO[status]}`,
  );
}

export async function moverCaptacao(id: string, status: string, motivo?: string | null): Promise<Resultado> {
  const { supabase } = await obterContexto();
  try {
    await aplicarEtapa(supabase, id, status, motivo);
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: true };
}

export async function atualizarCaptacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const dados = lerCaptacao(fd);
    if (dados.proposta_status === "enviada" && !fd.get("proposta_enviada_em")) dados.proposta_enviada_em = new Date().toISOString().slice(0, 10);
    if (Object.keys(dados).length) {
      const { data: antes } = await supabase.from("captacoes").select("proposta_status, corretor_id").eq("id", id).single();
      const { error } = await supabase.from("captacoes").update(dados).eq("id", id);
      if (error) throw error;
      if (dados.proposta_status && antes && antes.proposta_status !== dados.proposta_status)
        await evento(supabase, id, "proposta", `Proposta ${String(dados.proposta_status)}`);
    }
    const status = texto(fd, "status");
    if (status) await aplicarEtapa(supabase, id, status, texto(fd, "motivo_nao_captado"));
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Salvo." };
}

/** Checklist de documentos: salva todas as marcações juntas. */
export async function salvarChecklist(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const marcados = new Set(lista(fd, "doc"));
  const checklist = Object.fromEntries(CHECKLIST_CAPTACAO.map((c) => [c.id, marcados.has(c.id)]));
  const { error } = await supabase.from("captacoes").update({ checklist }).eq("id", String(fd.get("id")));
  if (error) return { erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: "Checklist salvo." };
}

export async function excluirCaptacao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("captacoes").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

/** Ligação, WhatsApp, reunião, negociação ou anotação. */
export async function registrarContatoCaptacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("captacao_id"));
  try {
    const tipo = texto(fd, "tipo") ?? "nota";
    const { error } = await supabase
      .from("captacao_eventos")
      .insert({ captacao_id: id, tipo, descricao: textoObrigatorio(fd, "descricao", "o que foi conversado") });
    if (error) throw error;
    if (tipo !== "nota") {
      const { data } = await supabase.from("captacoes").select("status").eq("id", id).single();
      if (data?.status === "prospeccao") await aplicarEtapa(supabase, id, "contato");
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Registrado." };
}

export async function excluirEventoCaptacao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("captacao_eventos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

// Avaliação de mercado ------------------------------------------------------
export async function adicionarComparativo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const valor = numero(fd, "valor");
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor do imóvel comparado.");
    const area = numero(fd, "area");
    const { error } = await supabase.from("captacao_comparativos").insert({
      captacao_id: String(fd.get("captacao_id")),
      descricao: textoObrigatorio(fd, "descricao", "a descrição (endereço ou anúncio)"),
      valor,
      area: area && area > 0 ? area : null,
      finalidade: texto(fd, "finalidade") === "venda" ? "venda" : "locacao",
      fonte: texto(fd, "fonte"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  return { ok: "Comparativo adicionado." };
}

export async function excluirComparativo(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("captacao_comparativos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

/** Aplica o valor sugerido pela avaliação de mercado. */
export async function usarValorSugerido(fd: FormData) {
  const { supabase } = await obterContexto();
  const campo = String(fd.get("campo")) === "venda" ? "valor_avaliado_venda" : "valor_avaliado_aluguel";
  const valor = Number(fd.get("valor"));
  if (!Number.isFinite(valor) || valor <= 0) return;
  await supabase
    .from("captacoes")
    .update({ [campo]: valor, avaliado_em: new Date().toISOString().slice(0, 10) })
    .eq("id", String(fd.get("id")));
  revalidarTudo();
}

/** Agenda a visita de avaliação (entra em Visitas como tipo "avaliação"). */
export async function agendarAvaliacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("captacao_id"));
  try {
    const data = textoObrigatorio(fd, "data", "a data");
    const hora = texto(fd, "hora") ?? "10:00";
    const { error } = await supabase.from("visitas").insert({
      captacao_id: id,
      tipo: "avaliacao",
      corretor_id: texto(fd, "corretor_id"),
      data_hora: `${data}T${hora}:00-03:00`,
      observacoes: texto(fd, "observacoes"),
    });
    if (error) throw error;
    const { data: c } = await supabase.from("captacoes").select("status").eq("id", id).single();
    if (c && ordemEtapaCaptacao(c.status) >= 0 && ordemEtapaCaptacao(c.status) < ordemEtapaCaptacao("avaliacao")) await aplicarEtapa(supabase, id, "avaliacao");
    await evento(supabase, id, "reuniao", `Visita de avaliação marcada para ${data.split("-").reverse().join("/")} às ${hora}`);
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  revalidatePath("/agenda", "layout");
  return { ok: "Avaliação agendada." };
}

export async function mudarStatusAvaliacao(fd: FormData) {
  const { supabase } = await obterContexto();
  const status = String(fd.get("status"));
  if (!["agendada", "realizada", "cancelada"].includes(status)) return;
  await supabase.from("visitas").update({ status }).eq("id", String(fd.get("id")));
  revalidarTudo();
}

export async function excluirAvaliacao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("visitas").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarTudo();
  return { ok: true };
}

/** Converte em imóvel ativo (com proprietário) e abre o imóvel novo. */
export async function converterCaptacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  let imovel: string;
  try {
    const codigo = textoObrigatorio(fd, "codigo", "o código do imóvel").toUpperCase();
    const { data: existe } = await supabase.from("imoveis").select("id").ilike("codigo", codigo).maybeSingle();
    if (existe) throw new ErroValidacao(`Já existe um imóvel com o código ${codigo}.`);
    const { data, error } = await supabase.rpc("converter_captacao", { p_id: String(fd.get("id")), p_codigo: codigo });
    if (error) throw error;
    imovel = data as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarTudo();
  revalidatePath("/imoveis", "layout");
  revalidatePath("/pessoas", "layout");
  redirect(`/imoveis/${imovel}`);
}
