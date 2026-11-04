"use server";

import { redirect } from "next/navigation";
import { instante } from "@/lib/dominio/agenda";
import {
  PUBLICOS_COMUNICADO,
  STATUS_ASSEMBLEIA,
  STATUS_OCORRENCIA,
  TIPOS_ASSEMBLEIA,
  TIPOS_DOCUMENTO_COND,
  TIPOS_OCORRENCIA,
  TIPOS_VOTACAO,
  apurarItem,
  nomeUnidade,
  quorum,
  textoAta,
  textoEdital,
  type ItemPauta,
} from "@/lib/dominio/condominios";
import { expiraEm } from "@/lib/dominio/portal";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";
import { todas } from "../financeiro/dados";
import { UUID, contextoCondominio, falha, partes, revalidarCondominio, type Resultado } from "./acesso";

/*
 * Ações da gestão do dia a dia: ocorrências, assembleias, comunicados,
 * reservas, documentos e links do portal do condômino. O banco confere a
 * mesma coisa (policies + gatilhos + RPCs).
 */

const umDe = <T extends string>(v: string | null, lista: Record<T, string>, padrao: NoInfer<T>): T => (v && v in lista ? (v as T) : padrao);
const marcado = (fd: FormData, k: string) => fd.getAll(k).includes("on");
const condDe = (fd: FormData) => {
  const c = textoObrigatorio(fd, "condominio_id", "o condomínio");
  if (!UUID.test(c)) throw new ErroValidacao("Condomínio inválido.");
  return c;
};
const dataHora = (fd: FormData, data: string, hora: string, rotulo: string) => {
  const d = textoObrigatorio(fd, data, rotulo);
  const h = texto(fd, hora) ?? "00:00";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || !/^\d{2}:\d{2}$/.test(h)) throw new ErroValidacao(`Confira ${rotulo}.`);
  return instante(d, h);
};

// ---------------------------------------------------------------------------
// Ocorrências
// ---------------------------------------------------------------------------

export async function criarOcorrencia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  let id: string;
  try {
    const { supabase } = await contextoCondominio("manutencao", "criar");
    const { data, error } = await supabase
      .from("cond_ocorrencias")
      .insert({
        condominio_id: condDe(fd),
        unidade_id: texto(fd, "unidade_id"),
        pessoa_id: texto(fd, "pessoa_id"),
        tipo: umDe(texto(fd, "tipo"), TIPOS_OCORRENCIA, "manutencao"),
        titulo: textoObrigatorio(fd, "titulo", "o assunto"),
        descricao: texto(fd, "descricao"),
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  redirect(`/condominios/${cond}/ocorrencias/${id}`);
}

export async function salvarOcorrencia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("manutencao", "editar");
    const { error } = await supabase
      .from("cond_ocorrencias")
      .update({
        status: umDe(texto(fd, "status"), STATUS_OCORRENCIA, "aberta"),
        tipo: umDe(texto(fd, "tipo"), TIPOS_OCORRENCIA, "manutencao"),
        responsavel_user_id: texto(fd, "responsavel_user_id"),
      })
      .eq("id", String(fd.get("id") ?? ""));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Salvo." };
}

export async function responderOcorrencia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("manutencao", "editar");
    const { error } = await supabase
      .from("cond_ocorrencia_respostas")
      .insert({ condominio_id: condDe(fd), ocorrencia_id: textoObrigatorio(fd, "ocorrencia_id", "a ocorrência"), texto: textoObrigatorio(fd, "texto", "a resposta") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Resposta registrada (aparece para o morador no portal)." };
}

/** Foto enviada pela equipe (o arquivo já subiu para <org>/<condominio>/ocorrencias/<id>/). */
export async function registrarFotoOcorrencia(p: { ocorrenciaId: string; path: string }): Promise<Resultado> {
  try {
    const { supabase, organizacao } = await contextoCondominio("manutencao", "editar");
    const { data: o } = await supabase.from("cond_ocorrencias").select("condominio_id, fotos").eq("id", p.ocorrenciaId).maybeSingle();
    if (!o) throw new ErroValidacao("Ocorrência não encontrada.");
    const pasta = `${organizacao.id}/${o.condominio_id}/ocorrencias/${p.ocorrenciaId}/`;
    if (!p.path.startsWith(pasta) || p.path.includes("..")) throw new ErroValidacao("Arquivo fora da pasta da ocorrência.");
    const { error } = await supabase.from("cond_ocorrencias").update({ fotos: [...((o.fotos as string[]) ?? []), p.path] }).eq("id", p.ocorrenciaId);
    if (error) throw error;
    revalidarCondominio(o.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function excluirOcorrencia(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("manutencao", "excluir");
    const { data } = await supabase.from("cond_ocorrencias").select("condominio_id, fotos").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_ocorrencias").delete().eq("id", id);
    if (error) throw error;
    const fotos = (data?.fotos as string[] | null) ?? [];
    if (fotos.length) await supabase.storage.from("condominios").remove(fotos);
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Assembleias, pauta, presença e votos
// ---------------------------------------------------------------------------

export async function criarAssembleia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  let id: string;
  try {
    const { supabase } = await contextoCondominio("imoveis", "criar");
    const { data: c } = await supabase.from("cond_condominios").select("voto_peso").eq("id", cond).maybeSingle();
    const { data, error } = await supabase
      .from("cond_assembleias")
      .insert({
        condominio_id: condDe(fd),
        tipo: umDe(texto(fd, "tipo"), TIPOS_ASSEMBLEIA, "ordinaria"),
        titulo: textoObrigatorio(fd, "titulo", "o título"),
        data: dataHora(fd, "data", "hora", "a data"),
        local: texto(fd, "local"),
        link_online: texto(fd, "link_online"),
        voto_peso: (c?.voto_peso as string) ?? "fracao",
        voto_portal: marcado(fd, "voto_portal"),
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  redirect(`/condominios/${cond}/assembleias/${id}`);
}

export async function salvarAssembleia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const segunda = texto(fd, "segunda_data") ? dataHora(fd, "segunda_data", "segunda_hora", "a segunda chamada") : null;
    const { error } = await supabase
      .from("cond_assembleias")
      .update({
        titulo: textoObrigatorio(fd, "titulo", "o título"),
        tipo: umDe(texto(fd, "tipo"), TIPOS_ASSEMBLEIA, "ordinaria"),
        data: dataHora(fd, "data", "hora", "a data"),
        segunda_chamada: segunda,
        local: texto(fd, "local"),
        link_online: texto(fd, "link_online"),
        voto_peso: texto(fd, "voto_peso") === "unidade" ? "unidade" : "fracao",
        voto_portal: marcado(fd, "voto_portal"),
      })
      .eq("id", String(fd.get("id") ?? ""));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Salvo." };
}

/** Edital ou ata (texto livre, salva sozinho; a ata pode ser ajustada depois de encerrada). */
export async function salvarTextoAssembleia(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const campo = texto(fd, "campo") === "ata" ? "ata" : "edital";
    const { error } = await supabase
      .from("cond_assembleias")
      .update({ [campo]: texto(fd, "texto") })
      .eq("id", String(fd.get("id") ?? ""));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Salvo." };
}

/** "id|status": convocar, abrir a votação, encerrar, cancelar ou voltar para rascunho. */
export async function statusAssembleia(valor: string): Promise<Resultado> {
  const [id, status] = partes(valor);
  try {
    if (!(status in STATUS_ASSEMBLEIA)) throw new ErroValidacao("Situação inválida.");
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const { data, error } = await supabase.from("cond_assembleias").update({ status }).eq("id", id).select("condominio_id").single();
    if (error) throw error;
    revalidarCondominio(data.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function excluirAssembleia(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "excluir");
    const { data } = await supabase.from("cond_assembleias").select("condominio_id, status").eq("id", id).maybeSingle();
    if (data?.status === "encerrada") throw new ErroValidacao("Assembleia encerrada fica no histórico (é a ata do condomínio).");
    const { error } = await supabase.from("cond_assembleias").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function adicionarItemPauta(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const tipo = umDe(texto(fd, "tipo_votacao"), TIPOS_VOTACAO, "simples");
    const opcoes = (texto(fd, "opcoes") ?? "Sim, Não, Abstenção")
      .split(/[,;\n]/)
      .map((o) => o.trim())
      .filter(Boolean);
    const { error } = await supabase.from("cond_assembleia_itens").insert({
      condominio_id: condDe(fd),
      assembleia_id: textoObrigatorio(fd, "assembleia_id", "a assembleia"),
      ordem: inteiro(fd, "ordem") ?? 1,
      titulo: textoObrigatorio(fd, "titulo", "o item"),
      descricao: texto(fd, "descricao"),
      tipo_votacao: tipo,
      opcoes: tipo === "informativo" ? [] : opcoes,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Item incluído na pauta." };
}

export async function excluirItemPauta(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const { data } = await supabase.from("cond_assembleia_itens").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_assembleia_itens").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function registrarPresenca(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const procurador = texto(fd, "procurador_nome");
    const { error } = await supabase.from("cond_assembleia_presencas").insert({
      condominio_id: condDe(fd),
      assembleia_id: textoObrigatorio(fd, "assembleia_id", "a assembleia"),
      unidade_id: textoObrigatorio(fd, "unidade_id", "a unidade"),
      pessoa_id: texto(fd, "pessoa_id"),
      nome: texto(fd, "nome"),
      procuracao: Boolean(procurador),
      procurador_nome: procurador,
    });
    if (error) {
      if (error.message.includes("cond_assembleia_presencas_un_idx")) throw new ErroValidacao("Esta unidade já está na lista de presença.");
      throw error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Presença registrada." };
}

export async function excluirPresenca(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const { data } = await supabase.from("cond_assembleia_presencas").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_assembleia_presencas").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

/** Voto presencial (a equipe registra; o peso é calculado pelo banco). */
export async function registrarVoto(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const { error } = await supabase.rpc("cond_registrar_voto", {
      p_item: textoObrigatorio(fd, "item_id", "o item"),
      p_unidade: textoObrigatorio(fd, "unidade_id", "a unidade"),
      p_opcao: textoObrigatorio(fd, "opcao", "o voto"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Voto registrado." };
}

export async function desfazerVoto(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const { data } = await supabase.from("cond_votos").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.rpc("cond_desfazer_voto", { p_voto: id });
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

type DadosAssembleia = {
  ass: { id: string; condominio_id: string; tipo: "ordinaria" | "extraordinaria"; titulo: string; data: string; segunda_chamada: string | null; local: string | null; link_online: string | null; voto_peso: "fracao" | "unidade"; voto_portal: boolean };
  cond: { nome: string; cnpj: string | null; sindico: { nome: string } | null };
  itens: ItemPauta[];
};

async function dadosAssembleia(supabase: Awaited<ReturnType<typeof contextoCondominio>>["supabase"], id: string): Promise<DadosAssembleia> {
  const { data: ass } = await supabase.from("cond_assembleias").select("id, condominio_id, tipo, titulo, data, segunda_chamada, local, link_online, voto_peso, voto_portal").eq("id", id).maybeSingle();
  if (!ass) throw new ErroValidacao("Assembleia não encontrada.");
  const [{ data: cond }, { data: itens }] = await Promise.all([
    supabase.from("cond_condominios").select("nome, cnpj, sindico:pessoas(nome)").eq("id", ass.condominio_id).single(),
    supabase.from("cond_assembleia_itens").select("id, ordem, titulo, descricao, tipo_votacao, opcoes").eq("assembleia_id", id).order("ordem"),
  ]);
  return { ass: ass as DadosAssembleia["ass"], cond: cond as unknown as DadosAssembleia["cond"], itens: (itens ?? []) as ItemPauta[] };
}

/** Preenche o edital de convocação com a pauta (texto continua editável). */
export async function gerarEdital(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const d = await dadosAssembleia(supabase, id);
    const edital = textoEdital({
      condominio: d.cond.nome,
      cnpj: d.cond.cnpj,
      tipo: d.ass.tipo,
      data: d.ass.data,
      segundaChamada: d.ass.segunda_chamada,
      local: d.ass.local,
      linkOnline: d.ass.link_online,
      itens: d.itens,
      sindico: d.cond.sindico?.nome,
      votoPortal: d.ass.voto_portal,
    });
    const { error } = await supabase.from("cond_assembleias").update({ edital }).eq("id", id);
    if (error) throw error;
    revalidarCondominio(d.ass.condominio_id);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

/** Preenche a ata com presença, quórum e resultado de cada item (texto continua editável). */
export async function gerarAta(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const d = await dadosAssembleia(supabase, id);
    // Tudo, de 1.000 em 1.000 (o Supabase corta cada resposta em 1.000 linhas): a ata não pode apurar só uma parte dos votos.
    const [us, presencas, votos] = await Promise.all([
      todas<{ id: string; numero: string; fracao_ideal: number | null; bloco: { nome: string } | null }>(() =>
        supabase.from("cond_unidades").select("id, numero, fracao_ideal, bloco:cond_blocos(nome)").eq("condominio_id", d.ass.condominio_id).order("id"),
      ),
      todas<{ unidade_id: string }>(() => supabase.from("cond_assembleia_presencas").select("id, unidade_id").eq("assembleia_id", id).order("id")),
      todas<{ item_id: string; opcao: string; peso: number }>(() => supabase.from("cond_votos").select("id, item_id, opcao, peso").eq("assembleia_id", id).order("id")),
    ]);
    const presentes = presencas.map((p) => p.unidade_id);
    const q = quorum(
      us.map((u) => ({ id: u.id, fracao: Number(u.fracao_ideal) })),
      presentes,
      d.ass.voto_peso,
    );
    const apuracao = d.itens.map((it) =>
      apurarItem(
        it,
        votos.filter((v) => v.item_id === it.id).map((v) => ({ opcao: v.opcao, peso: Number(v.peso) })),
        q.pesoTotal,
      ),
    );
    const ata = textoAta({
      condominio: d.cond.nome,
      tipo: d.ass.tipo,
      data: d.ass.data,
      local: d.ass.local,
      quorum: q,
      peso: d.ass.voto_peso,
      itens: d.itens,
      apuracao,
      presentes: us.filter((u) => presentes.includes(u.id)).map((u) => nomeUnidade(u)),
    });
    const { error } = await supabase.from("cond_assembleias").update({ ata }).eq("id", id);
    if (error) throw error;
    // O resultado de cada item fica guardado (aparece no portal depois de encerrada).
    for (const ap of apuracao) await supabase.from("cond_assembleia_itens").update({ resultado: ap.texto }).eq("id", ap.itemId);
    revalidarCondominio(d.ass.condominio_id);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Comunicados
// ---------------------------------------------------------------------------

export async function criarComunicado(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "criar");
    const publico = umDe(texto(fd, "publico"), PUBLICOS_COMUNICADO, "todos");
    const unidades = fd.getAll("unidades").map(String).filter((u) => UUID.test(u));
    if (publico === "bloco" && !texto(fd, "bloco_id")) throw new ErroValidacao("Escolha o bloco.");
    if (publico === "unidades" && !unidades.length) throw new ErroValidacao("Escolha as unidades.");
    const { error } = await supabase.from("cond_comunicados").insert({
      condominio_id: condDe(fd),
      titulo: textoObrigatorio(fd, "titulo", "o título"),
      texto: textoObrigatorio(fd, "texto", "o texto"),
      publico,
      bloco_id: publico === "bloco" ? texto(fd, "bloco_id") : null,
      unidades: publico === "unidades" ? unidades : [],
      expira_em: texto(fd, "expira_em"),
      fixado: marcado(fd, "fixado"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Comunicado publicado no portal." };
}

export async function excluirComunicado(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "excluir");
    const { data } = await supabase.from("cond_comunicados").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_comunicados").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Áreas comuns e reservas
// ---------------------------------------------------------------------------

function camposArea(fd: FormData) {
  return {
    nome: textoObrigatorio(fd, "nome", "o nome da área"),
    regras: texto(fd, "regras"),
    capacidade: inteiro(fd, "capacidade"),
    antecedencia_min_horas: inteiro(fd, "antecedencia_min_horas") ?? 24,
    antecedencia_max_dias: inteiro(fd, "antecedencia_max_dias") ?? 90,
    duracao_max_horas: inteiro(fd, "duracao_max_horas") ?? 12,
    taxa: numero(fd, "taxa") ?? 0,
  };
}

export async function criarArea(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("agenda", "criar");
    const { error } = await supabase.from("cond_areas").insert({ condominio_id: condDe(fd), ...camposArea(fd) });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Área cadastrada." };
}

export async function salvarArea(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("agenda", "editar");
    const { error } = await supabase
      .from("cond_areas")
      .update({ ...camposArea(fd), ativa: marcado(fd, "ativa") })
      .eq("id", String(fd.get("id") ?? ""));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Salvo." };
}

export async function excluirArea(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("agenda", "excluir");
    const { data } = await supabase.from("cond_areas").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_areas").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function criarReserva(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("agenda", "criar");
    const dia = textoObrigatorio(fd, "dia", "o dia");
    const ini = instante(dia, textoObrigatorio(fd, "hora_inicio", "o horário de início"));
    let fim = instante(dia, textoObrigatorio(fd, "hora_fim", "o horário de fim"));
    if (fim <= ini) fim = new Date(new Date(fim).getTime() + 86_400_000).toISOString(); // termina no dia seguinte
    const { error } = await supabase.from("cond_reservas").insert({
      condominio_id: condDe(fd),
      area_id: textoObrigatorio(fd, "area_id", "a área"),
      unidade_id: textoObrigatorio(fd, "unidade_id", "a unidade"),
      inicio: ini,
      fim,
      status: "confirmada",
      observacao: texto(fd, "observacao"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Reserva confirmada." };
}

/** "id|confirmada" | "id|recusada" | "id|cancelada". */
export async function decidirReserva(valor: string): Promise<Resultado> {
  const [id, status] = partes(valor);
  try {
    if (!["confirmada", "recusada", "cancelada"].includes(status)) throw new ErroValidacao("Situação inválida.");
    const { supabase } = await contextoCondominio("agenda", "editar");
    const { data, error } = await supabase.from("cond_reservas").update({ status }).eq("id", id).select("condominio_id").single();
    if (error) throw error;
    revalidarCondominio(data.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function excluirReserva(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("agenda", "excluir");
    const { data } = await supabase.from("cond_reservas").select("condominio_id, cota_item_id").eq("id", id).maybeSingle();
    if (data?.cota_item_id) throw new ErroValidacao("A taxa desta reserva já foi cobrada na cota: cancele em vez de excluir.");
    const { error } = await supabase.from("cond_reservas").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Documentos (bucket privado "condominios")
// ---------------------------------------------------------------------------

export async function registrarDocumento(p: { condominioId: string; path: string; nome: string; titulo: string; tipo: string; validade: string | null }): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("documentos", "criar");
    const { error } = await supabase.from("cond_documentos").insert({
      condominio_id: p.condominioId,
      path: p.path,
      nome_arquivo: p.nome.slice(0, 160),
      titulo: p.titulo || p.nome,
      tipo: p.tipo in TIPOS_DOCUMENTO_COND ? p.tipo : "outro",
      validade: p.validade && /^\d{4}-\d{2}-\d{2}$/.test(p.validade) ? p.validade : null,
    });
    if (error) {
      await supabase.storage.from("condominios").remove([p.path]);
      throw error;
    }
  } catch (e) {
    return falha(e);
  }
  revalidarCondominio(p.condominioId);
  return { ok: true };
}

export async function salvarDocumento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("documentos", "editar");
    const { error } = await supabase
      .from("cond_documentos")
      .update({ titulo: textoObrigatorio(fd, "titulo", "o nome"), tipo: umDe(texto(fd, "tipo"), TIPOS_DOCUMENTO_COND, "outro"), validade: texto(fd, "validade") })
      .eq("id", String(fd.get("id") ?? ""));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Salvo." };
}

/** Libera no portal do condômino: gera um link assinado de 30 dias (o anônimo nunca lê o Storage). */
export async function liberarDocumentoPortal(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("documentos", "editar");
    const { data: d } = await supabase.from("cond_documentos").select("condominio_id, path").eq("id", id).maybeSingle();
    if (!d) throw new ErroValidacao("Documento não encontrado.");
    const dias = 30;
    const { data: assinado, error: e1 } = await supabase.storage.from("condominios").createSignedUrl(d.path as string, dias * 86_400);
    if (e1 || !assinado?.signedUrl) throw new ErroValidacao("Não foi possível gerar o link do arquivo.");
    const { error } = await supabase.from("cond_documentos").update({ publico_portal: true, link_portal: assinado.signedUrl, link_expira_em: expiraEm(dias) }).eq("id", id);
    if (error) throw error;
    revalidarCondominio(d.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function tirarDocumentoPortal(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("documentos", "editar");
    const { data, error } = await supabase.from("cond_documentos").update({ publico_portal: false }).eq("id", id).select("condominio_id").single();
    if (error) throw error;
    revalidarCondominio(data.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function excluirDocumento(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("documentos", "excluir");
    const { data } = await supabase.from("cond_documentos").select("condominio_id, path").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_documentos").delete().eq("id", id);
    if (error) throw error;
    if (data?.path) await supabase.storage.from("condominios").remove([data.path as string]);
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Portal do condômino: links
// ---------------------------------------------------------------------------

export async function gerarLinkCondominio(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const cond = String(fd.get("condominio_id") ?? "");
  try {
    const { supabase } = await contextoCondominio("imoveis", "criar");
    const pessoa = textoObrigatorio(fd, "pessoa_id", "a pessoa");
    const { data: atual } = await supabase.from("cond_portal_acessos").select("id").eq("condominio_id", cond).eq("pessoa_id", pessoa).eq("ativo", true).maybeSingle();
    if (atual) throw new ErroValidacao("Esta pessoa já tem link ativo neste condomínio. Use “Trocar link” se precisar de um endereço novo.");
    const { error } = await supabase.from("cond_portal_acessos").insert({ condominio_id: condDe(fd), pessoa_id: pessoa, expira_em: expiraEm(inteiro(fd, "validade") ?? 0) });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarCondominio(cond);
  return { ok: "Link gerado. Copie ou envie pelo WhatsApp." };
}

async function mudarLink(id: string, mudanca: Record<string, unknown>): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "editar");
    const { data, error } = await supabase.from("cond_portal_acessos").update(mudanca).eq("id", id).select("condominio_id").single();
    if (error) throw error;
    revalidarCondominio(data.condominio_id as string);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}

export async function trocarLinkCondominio(id: string): Promise<Resultado> {
  return mudarLink(id, { token: crypto.randomUUID(), ativo: true });
}
export async function desativarLinkCondominio(id: string): Promise<Resultado> {
  return mudarLink(id, { ativo: false });
}
export async function reativarLinkCondominio(id: string): Promise<Resultado> {
  return mudarLink(id, { ativo: true, expira_em: expiraEm(90) });
}

export async function excluirLinkCondominio(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contextoCondominio("imoveis", "excluir");
    const { data } = await supabase.from("cond_portal_acessos").select("condominio_id").eq("id", id).maybeSingle();
    const { error } = await supabase.from("cond_portal_acessos").delete().eq("id", id);
    if (error) throw error;
    revalidarCondominio(data?.condominio_id as string | undefined);
  } catch (e) {
    return falha(e);
  }
  return { ok: true };
}
