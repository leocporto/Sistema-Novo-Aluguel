"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { horaLocal, diaLocal, instante } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais, percentual } from "@/lib/dominio/dinheiro";
import {
  CATEGORIAS_CHAMADO,
  URGENCIAS,
  chamadoEmGarantia,
  efeitoNaAprovacao,
  garantiaAte,
  parteDoProprietario,
  partesDaResponsabilidade,
  planoFinanceiro,
  podeDecidirChamado,
  podeIrPara,
  precisaAprovacaoProprietario,
  responsavelEfetivo,
  statusAoEscolherOrcamento,
  sugerirResponsabilidade,
  type Modo,
} from "@/lib/dominio/manutencao";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];
type Resultado = { ok: boolean; erro?: string };

function revalidar(id?: string | null) {
  if (id) revalidatePath(`/manutencao/${id}`, "layout");
  revalidatePath("/manutencao", "layout");
  revalidatePath("/");
}
function revalidarFinanceiro() {
  revalidatePath("/financeiro", "layout");
  revalidatePath("/despesas");
  revalidatePath("/faturas", "layout");
  revalidatePath("/contratos", "layout");
  revalidatePath("/repasses", "layout");
}

const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });
/**
 * Corretor abre chamados, pede orçamentos e agenda; decidir e mexer no
 * financeiro é de admin, gestor e financeiro (lista fechada; o banco confere
 * a mesma regra nos gatilhos e RPCs).
 */
const podeDecidir = podeDecidirChamado;
const MSG_PAPEL = "Só administradores, gestores e o financeiro fazem isto.";

const umDe = <T extends string>(v: string | null, lista: readonly T[], padrao: T): T => ((lista as readonly string[]).includes(v ?? "") ? (v as T) : padrao);

async function evento(supabase: Supabase, chamadoId: string, tipo: string, descricao: string) {
  await supabase.from("chamado_eventos").insert({ chamado_id: chamadoId, tipo, descricao });
}

async function chamadoBase(supabase: Supabase, id: string) {
  const { data, error } = await supabase
    .from("chamados")
    .select("id, organizacao_id, numero, titulo, status, categoria, imovel_id, contrato_id, prestador_id, responsabilidade, pct_locatario, pct_proprietario, pct_imobiliaria, pago_direto, valor_aprovado, garantia_dias, visita_id, solicitante_pessoa_id, cobranca_locatario, fatura_item_id, valor_final, agendado_para, aprovacao_status, status_antes_aprovacao, orcamento_id, upload_token")
    .eq("id", id)
    .single();
  if (error || !data) throw new ErroValidacao("Chamado não encontrado.");
  return data as {
    id: string;
    organizacao_id: string;
    numero: number;
    titulo: string;
    status: string;
    categoria: string;
    imovel_id: string;
    contrato_id: string | null;
    prestador_id: string | null;
    responsabilidade: string | null;
    pct_locatario: number;
    pct_proprietario: number;
    pct_imobiliaria: number;
    pago_direto: boolean;
    valor_aprovado: number | null;
    garantia_dias: number | null;
    visita_id: string | null;
    solicitante_pessoa_id: string | null;
    cobranca_locatario: string | null;
    fatura_item_id: string | null;
    valor_final: number | null;
    agendado_para: string | null;
    aprovacao_status: string;
    status_antes_aprovacao: string | null;
    orcamento_id: string | null;
    upload_token: string;
  };
}

/** Partes (%) do chamado, aplicando a sugestão da categoria se ainda não definiram. */
function partesDo(c: { responsabilidade: string | null; categoria: string; pct_locatario: number; pct_proprietario: number; pct_imobiliaria: number }, modo: Modo) {
  const resp = c.responsabilidade ?? sugerirResponsabilidade(c.categoria).responsavel;
  return { resp, partes: partesDaResponsabilidade(resp, modo, { locatario: Number(c.pct_locatario), proprietario: Number(c.pct_proprietario), imobiliaria: Number(c.pct_imobiliaria) }) };
}

// ---------------------------------------------------------------------------
// Chamado
// ---------------------------------------------------------------------------

export async function criarChamado(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao } = await obterContexto();
  let id: string;
  try {
    const contrato_id = texto(fd, "contrato_id");
    let imovel_id = texto(fd, "imovel_id");
    let solicitante_pessoa_id: string | null = null;
    if (contrato_id) {
      const { data: c } = await supabase.from("contratos").select("imovel_id").eq("id", contrato_id).single();
      if (!c) throw new ErroValidacao("Contrato não encontrado.");
      if (imovel_id && imovel_id !== c.imovel_id) throw new ErroValidacao("O contrato escolhido é de outro imóvel.");
      imovel_id = c.imovel_id as string;
    }
    if (!imovel_id) throw new ErroValidacao("Escolha o imóvel (ou o contrato) do chamado.");
    const aberto_por = umDe(texto(fd, "aberto_por"), ["locatario", "proprietario", "equipe", "outro"] as const, "equipe");
    if (aberto_por === "locatario" && contrato_id) {
      const { data: loc } = await supabase.from("contrato_partes").select("pessoa_id").eq("contrato_id", contrato_id).eq("papel", "locatario").limit(1).maybeSingle();
      solicitante_pessoa_id = (loc?.pessoa_id as string | undefined) ?? null;
    }
    const prestador_id = texto(fd, "prestador_id");
    const categoria = umDe(texto(fd, "categoria"), CATEGORIAS_CHAMADO, "outros");
    // Retorno na garantia: escolhido à mão, "nao" (não é retorno) ou vazio = o sistema
    // procura serviço do mesmo tipo neste imóvel ainda na garantia e liga sozinho.
    const origemEscolhida = texto(fd, "chamado_origem_id");
    let chamado_origem_id: string | null = origemEscolhida === "nao" ? null : origemEscolhida;
    let origemPrestador: string | null = null;
    if (!origemEscolhida) {
      const { data: anteriores } = await supabase
        .from("chamados")
        .select("id, imovel_id, categoria, status, garantia_ate, prestador_id")
        .eq("imovel_id", imovel_id)
        .eq("categoria", categoria)
        .in("status", ["concluido", "avaliado"])
        .gte("garantia_ate", hojeISO())
        .limit(50);
      const naGarantia = chamadoEmGarantia({ imovel_id, categoria }, (anteriores ?? []) as { id: string; imovel_id: string; categoria: string; status: string; garantia_ate: string | null; prestador_id: string | null }[], hojeISO());
      chamado_origem_id = naGarantia?.id ?? null;
      origemPrestador = naGarantia?.prestador_id ?? null;
    }
    const { data, error } = await supabase
      .from("chamados")
      .insert({
        imovel_id,
        contrato_id,
        aberto_por: organizacao.modo === "pessoal" && aberto_por === "proprietario" ? "equipe" : aberto_por,
        solicitante_pessoa_id,
        solicitante_nome: texto(fd, "solicitante_nome"),
        solicitante_telefone: texto(fd, "solicitante_telefone"),
        categoria,
        urgencia: umDe(texto(fd, "urgencia"), URGENCIAS, "media"),
        titulo: textoObrigatorio(fd, "titulo", "o que aconteceu (título)"),
        descricao: texto(fd, "descricao"),
        local: texto(fd, "local"),
        chamado_origem_id,
        // Na garantia, quem volta é o mesmo prestador (se ninguém foi escolhido).
        prestador_id: prestador_id ?? origemPrestador,
      })
      .select("id")
      .single();
    if (error) throw error;
    id = data.id as string;
    if (chamado_origem_id && !origemEscolhida) await evento(supabase, id, "garantia", "Ligado sozinho a um serviço do mesmo tipo neste imóvel que ainda está na garantia.");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  redirect(`/manutencao/${id}`);
}

const CAMPOS_TEXTO = ["titulo", "descricao", "local", "solicitante_nome", "solicitante_telefone", "chamado_origem_id"];

/** Salva sozinho os quadros da ficha (cada quadro manda só os seus campos). */
export async function atualizarChamado(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao, papel } = await obterContexto();
  const id = String(fd.get("id"));
  const modo = organizacao.modo;
  let aviso = "";
  try {
    // Quem paga, valor e prestador são decisões financeiras: corretor não mexe.
    if (["responsabilidade", "pagamento", "pct_locatario", "pct_proprietario", "pct_imobiliaria", "valor_aprovado", "prestador_id", "garantia_dias"].some((k) => fd.has(k)) && !podeDecidir(papel))
      throw new ErroValidacao(MSG_PAPEL);
    const atual = await chamadoBase(supabase, id);
    const d: Record<string, unknown> = {};
    for (const c of CAMPOS_TEXTO) if (fd.has(c)) d[c] = texto(fd, c);
    if (fd.has("titulo") && !d.titulo) throw new ErroValidacao("O título não pode ficar vazio.");
    if (d.chamado_origem_id === id || d.chamado_origem_id === "nao") d.chamado_origem_id = null;
    if (fd.has("categoria")) d.categoria = umDe(texto(fd, "categoria"), CATEGORIAS_CHAMADO, "outros");
    if (fd.has("urgencia")) d.urgencia = umDe(texto(fd, "urgencia"), URGENCIAS, "media");
    if (fd.has("aberto_por")) d.aberto_por = umDe(texto(fd, "aberto_por"), ["locatario", "proprietario", "equipe", "outro"] as const, "equipe");
    if (fd.has("contrato_id")) {
      const contrato_id = texto(fd, "contrato_id");
      if (contrato_id) {
        const { data: c } = await supabase.from("contratos").select("imovel_id").eq("id", contrato_id).single();
        if (!c || c.imovel_id !== atual.imovel_id) throw new ErroValidacao("Escolha um contrato deste imóvel.");
      }
      if (atual.fatura_item_id && contrato_id !== atual.contrato_id) throw new ErroValidacao("A cobrança já está numa fatura deste contrato; desfaça a conclusão antes de trocar.");
      d.contrato_id = contrato_id;
    }
    const concluido = ["concluido", "avaliado"].includes(atual.status);
    if (fd.has("responsabilidade")) {
      const resp = texto(fd, "responsabilidade");
      // Depois do orçamento escolhido, "A definir" faria a aprovação e o financeiro olharem regras diferentes.
      if (!resp && atual.orcamento_id && atual.responsabilidade) throw new ErroValidacao("Depois de escolher o orçamento, defina quem paga o conserto (não dá para voltar para “A definir”).");
      const pagoDireto = texto(fd, "pagamento") === "direto";
      let informado = { locatario: numero(fd, "pct_locatario") ?? 0, proprietario: numero(fd, "pct_proprietario") ?? 0, imobiliaria: modo === "pessoal" ? 0 : (numero(fd, "pct_imobiliaria") ?? 0) };
      // Acabou de escolher "Dividido" e ainda não digitou nada: começa meio a meio (locatário e proprietário).
      if (resp === "dividido" && informado.locatario + informado.proprietario + informado.imobiliaria === 0) informado = { locatario: 50, proprietario: 50, imobiliaria: 0 };
      const partes = resp ? partesDaResponsabilidade(resp, modo, informado) : { locatario: 0, proprietario: 0, imobiliaria: 0 };
      // Para a aprovação vale quem paga de fato (com "A definir", a sugestão da categoria — a mesma do financeiro).
      const categoria = (d.categoria as string | undefined) ?? atual.categoria;
      const partesEfetivas = resp ? partes : partesDaResponsabilidade(responsavelEfetivo(resp, categoria), modo, informado);
      if (pagoDireto && (resp === "dividido" || resp === "imobiliaria")) throw new ErroValidacao(resp === "dividido" ? "Com a conta dividida, o pagamento ao prestador passa por vocês." : "Se a imobiliária paga, escolha “Nós pagamos o prestador”.");
      const mudou =
        resp !== atual.responsabilidade ||
        pagoDireto !== atual.pago_direto ||
        paraCentavos(partes.locatario) !== paraCentavos(atual.pct_locatario) ||
        paraCentavos(partes.proprietario) !== paraCentavos(atual.pct_proprietario) ||
        paraCentavos(partes.imobiliaria) !== paraCentavos(atual.pct_imobiliaria);
      if (mudou) {
        if (concluido) throw new ErroValidacao("O chamado já foi concluído e lançado no financeiro. Desfaça a conclusão para mudar quem paga.");
        Object.assign(d, { responsabilidade: resp, pago_direto: pagoDireto, pct_locatario: partes.locatario, pct_proprietario: partes.proprietario, pct_imobiliaria: partes.imobiliaria });
        // A parte do proprietário apareceu/aumentou depois do serviço aprovado → pede de novo;
        // zerou enquanto esperava a resposta dele → segue sem ele.
        const antes = parteDoProprietario(responsavelEfetivo(atual.responsabilidade, atual.categoria), modo, {
          locatario: Number(atual.pct_locatario),
          proprietario: Number(atual.pct_proprietario),
          imobiliaria: Number(atual.pct_imobiliaria),
        });
        const efeito = efeitoNaAprovacao({ modo, status: atual.status, aprovacaoStatus: atual.aprovacao_status, parteAntes: antes, parteDepois: partesEfetivas.proprietario });
        if (efeito === "pedir") {
          Object.assign(d, {
            status: "aguardando_aprovacao",
            aprovacao_status: "pendente",
            status_antes_aprovacao: atual.status,
            aprovacao_em: null,
            aprovacao_nome: null,
            aprovacao_obs: null,
            aprovacao_canal: null,
            aprovacao_ip: null,
          });
          aviso = " A parte do proprietário aumentou: o serviço volta a esperar a aprovação dele (aba Orçamentos e aprovação, com um link novo).";
        } else if (efeito === "liberar") {
          Object.assign(d, { status: atual.status_antes_aprovacao ?? "aprovado", aprovacao_status: "nao_precisa", status_antes_aprovacao: null, aprovacao_em: null, aprovacao_nome: null, aprovacao_obs: null, aprovacao_canal: null, aprovacao_ip: null });
          aviso = " O proprietário não paga mais nada: o serviço segue sem a aprovação dele.";
        }
      }
    }
    if (fd.has("prestador_id")) d.prestador_id = texto(fd, "prestador_id");
    if (fd.has("valor_aprovado")) {
      const v = numero(fd, "valor_aprovado");
      if (v != null && v < 0) throw new ErroValidacao("O valor não pode ser negativo.");
      if (concluido && paraCentavos(v) !== paraCentavos(atual.valor_aprovado)) throw new ErroValidacao("O chamado já foi concluído. Desfaça a conclusão para mudar o valor.");
      d.valor_aprovado = v;
    }
    if (fd.has("garantia_dias")) d.garantia_dias = inteiro(fd, "garantia_dias");
    const { error } = await supabase.from("chamados").update(d).eq("id", id);
    if (error) throw error;
    if (aviso) await evento(supabase, id, "aprovacao", aviso.trim());
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  return { ok: `Salvo.${aviso}` };
}

async function mudarStatus(
  id: string,
  para: string,
  extra: Record<string, unknown> = {},
  depois?: (c: Awaited<ReturnType<typeof chamadoBase>>, supabase: Supabase) => Promise<void>,
  soQuemDecide = false,
): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  try {
    if (soQuemDecide && !podeDecidir(papel)) throw new ErroValidacao(MSG_PAPEL);
    const c = await chamadoBase(supabase, id);
    if (!podeIrPara(c.status, para)) throw new ErroValidacao("Este passo não vale para a situação atual do chamado.");
    const { error } = await supabase.from("chamados").update({ status: para, ...extra }).eq("id", id);
    if (error) throw error;
    if (depois) await depois(c, supabase);
  } catch (e) {
    return falha(e);
  }
  revalidar(id);
  return { ok: true };
}

export async function iniciarAnalise(id: string): Promise<Resultado> {
  return mudarStatus(id, "em_analise");
}

/** O prestador chegou: o compromisso da agenda passa a "realizado" (não fica pendente). */
export async function iniciarExecucao(id: string): Promise<Resultado> {
  const r = await mudarStatus(id, "em_execucao", { iniciado_em: new Date().toISOString() }, async (c, supabase) => {
    if (!c.visita_id) return;
    const { data } = await supabase.from("visitas").update({ status: "realizada" }).eq("id", c.visita_id).eq("status", "agendada").select("id");
    if (data?.length) await supabase.from("visita_eventos").insert({ visita_id: c.visita_id, tipo: "realizada", descricao: `Prestador começou o serviço do chamado #${c.numero}` });
  });
  revalidatePath("/agenda", "layout");
  return r;
}

/**
 * Reabre um chamado recusado ou cancelado (volta para análise). A agenda
 * antiga já foi desmarcada ao encerrar; o orçamento escolhido volta a ser só
 * "recebido" para poder ser escolhido (e aprovado) de novo.
 */
export async function reabrirChamado(id: string): Promise<Resultado> {
  // Desfazer uma recusa/cancelamento é decisão de quem pode recusar/cancelar.
  return mudarStatus(
    id,
    "em_analise",
    { motivo: null, agendado_para: null, iniciado_em: null, status_antes_aprovacao: null },
    async (c, supabase) => {
      if (c.orcamento_id) await supabase.from("chamado_orcamentos").update({ status: "recebido" }).eq("id", c.orcamento_id).eq("status", "escolhido");
    },
    true,
  );
}

/** Recusar (não procede) ou cancelar, com o motivo. Desmarca o compromisso da agenda. */
export async function encerrarChamado(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    if (!podeDecidir(papel)) throw new ErroValidacao(MSG_PAPEL);
    const para = texto(fd, "acao") === "recusar" ? "recusado" : "cancelado";
    const c = await chamadoBase(supabase, id);
    if (!podeIrPara(c.status, para)) throw new ErroValidacao(para === "recusado" ? "Só dá para recusar um chamado ainda em análise." : "Este chamado não pode ser cancelado agora.");
    const motivo = textoObrigatorio(fd, "motivo", "o motivo");
    const { error } = await supabase.from("chamados").update({ status: para, motivo }).eq("id", id);
    if (error) throw error;
    if (c.visita_id) {
      await supabase.from("visitas").update({ status: "cancelada", motivo_cancelamento: `Chamado ${para}: ${motivo}` }).eq("id", c.visita_id).eq("status", "agendada");
      revalidatePath("/agenda", "layout");
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  return { ok: "Feito." };
}

/** Arquivos guardados na pasta do chamado (inclusive os que o locatário enviou e não chegaram a ser registrados). */
async function arquivosDaPasta(supabase: Supabase, c: { organizacao_id: string; id: string; upload_token: string }) {
  const caminhos: string[] = [];
  for (const pasta of [`${c.organizacao_id}/${c.id}`, `${c.organizacao_id}/${c.id}/${c.upload_token}`]) {
    const { data } = await supabase.storage.from("manutencao").list(pasta, { limit: 1000 });
    for (const a of data ?? []) if (a.id) caminhos.push(`${pasta}/${a.name}`);
  }
  return caminhos;
}

export async function excluirChamado(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  try {
    if (!podeDecidir(papel)) throw new ErroValidacao(MSG_PAPEL);
    const c = await chamadoBase(supabase, id);
    const { data: midias } = await supabase.from("chamado_midias").select("path").eq("chamado_id", id);
    const pasta = await arquivosDaPasta(supabase, c).catch(() => [] as string[]);
    const { error } = await supabase.rpc("excluir_chamado", { p_chamado: id });
    if (error) throw error;
    const caminhos = [...new Set([...(midias ?? []).map((m) => m.path as string), ...pasta])];
    if (caminhos.length) await supabase.storage.from("manutencao").remove(caminhos);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidarFinanceiro();
  revalidatePath("/agenda", "layout");
  return { ok: true };
}

export async function registrarNota(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    await evento(supabase, id, "nota", textoObrigatorio(fd, "descricao", "a anotação"));
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  return { ok: "Anotado." };
}

// ---------------------------------------------------------------------------
// Fotos e vídeos
// ---------------------------------------------------------------------------

export async function registrarMidia(m: { chamadoId: string; path: string; nome: string; tipo: string; momento: string }): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("chamado_midias").insert({
    chamado_id: m.chamadoId,
    path: m.path,
    nome: m.nome.slice(0, 160),
    tipo: m.tipo === "video" ? "video" : "foto",
    momento: umDe(m.momento, ["antes", "depois", "orcamento"] as const, "antes"),
    enviado_por: "equipe",
  });
  if (error) return falha(error);
  revalidar(m.chamadoId);
  return { ok: true };
}

export async function excluirMidia(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("chamado_midias").select("path, chamado_id").eq("id", id).single();
  if (!data) return { ok: false, erro: "Arquivo não encontrado." };
  await supabase.storage.from("manutencao").remove([data.path as string]);
  const { error } = await supabase.from("chamado_midias").delete().eq("id", id);
  if (error) return falha(error);
  revalidar(data.chamado_id as string);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Orçamentos
// ---------------------------------------------------------------------------

function lerOrcamento(fd: FormData) {
  const prestador_id = texto(fd, "prestador_id");
  const prestador_nome = texto(fd, "prestador_nome");
  if (!prestador_id && !prestador_nome) throw new ErroValidacao("Escolha o prestador ou digite o nome dele.");
  const valor = numero(fd, "valor");
  if (valor != null && valor < 0) throw new ErroValidacao("O valor não pode ser negativo.");
  return {
    prestador_id,
    prestador_nome: prestador_id ? null : prestador_nome,
    valor,
    prazo_dias: inteiro(fd, "prazo_dias"),
    garantia_dias: inteiro(fd, "garantia_dias"),
    validade: texto(fd, "validade"),
    descricao: texto(fd, "descricao"),
  };
}

/** Pede orçamento (fica "solicitado") ou registra um recebido (com valor). */
export async function salvarNovoOrcamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const chamado_id = String(fd.get("chamado_id"));
  try {
    const c = await chamadoBase(supabase, chamado_id);
    if (["concluido", "avaliado", "recusado", "cancelado"].includes(c.status)) throw new ErroValidacao("O chamado já foi encerrado.");
    const o = lerOrcamento(fd);
    const recebido = o.valor != null;
    const { error } = await supabase.from("chamado_orcamentos").insert({ ...o, chamado_id, status: recebido ? "recebido" : "solicitado", recebido_em: recebido ? new Date().toISOString() : null });
    if (error) throw error;
    if (c.status === "aberto") await supabase.from("chamados").update({ status: "em_analise" }).eq("id", chamado_id);
    await evento(supabase, chamado_id, "orcamento", recebido ? `Orçamento registrado: ${formatarReais(o.valor)}` : "Orçamento pedido ao prestador");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(chamado_id);
  return { ok: "Orçamento salvo." };
}

/** Edição automática dos valores de um orçamento (ao preencher o valor, vira "recebido"). */
export async function atualizarOrcamento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, papel } = await obterContexto();
  const id = String(fd.get("id"));
  let chamadoId = "";
  try {
    const { data: atual } = await supabase.from("chamado_orcamentos").select("status, valor, chamado_id, chamado:chamados!chamado_orcamentos_chamado_id_fkey(status)").eq("id", id).single();
    if (!atual) throw new ErroValidacao("Orçamento não encontrado.");
    chamadoId = atual.chamado_id as string;
    const stChamado = (atual.chamado as unknown as { status: string } | null)?.status ?? "";
    const d: Record<string, unknown> = {};
    if (fd.has("valor")) {
      const v = numero(fd, "valor");
      if (v != null && v < 0) throw new ErroValidacao("O valor não pode ser negativo.");
      // Corretor registra o valor que chegou; trocar um valor já informado é decisão.
      if (atual.valor != null && paraCentavos(v) !== paraCentavos(atual.valor) && !podeDecidir(papel)) throw new ErroValidacao(MSG_PAPEL);
      // Escolhido e já aprovado/aguardando: o valor está com o chamado (e com o proprietário).
      if (atual.status === "escolhido" && !["aberto", "em_analise"].includes(stChamado) && paraCentavos(v) !== paraCentavos(atual.valor))
        throw new ErroValidacao("Este é o orçamento escolhido. Para mudar o valor, escolha de novo depois de ajustar (ou ajuste o valor final na conclusão).");
      d.valor = v;
      if (v != null && atual.status === "solicitado") Object.assign(d, { status: "recebido", recebido_em: new Date().toISOString() });
    }
    for (const c of ["prazo_dias", "garantia_dias"]) if (fd.has(c)) d[c] = inteiro(fd, c);
    for (const c of ["validade", "descricao"]) if (fd.has(c)) d[c] = texto(fd, c);
    const { error } = await supabase.from("chamado_orcamentos").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(chamadoId);
  return { ok: "Salvo." };
}

export async function excluirOrcamento(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podeDecidir(papel)) return { ok: false, erro: MSG_PAPEL };
  const { data: o } = await supabase.from("chamado_orcamentos").select("status, chamado_id, chamado:chamados!chamado_orcamentos_chamado_id_fkey(status)").eq("id", id).single();
  if (!o) return { ok: false, erro: "Orçamento não encontrado." };
  const st = (o.chamado as unknown as { status: string } | null)?.status ?? "";
  if (o.status === "escolhido" && !["aberto", "em_analise", "recusado", "cancelado"].includes(st))
    return { ok: false, erro: "Este é o orçamento escolhido do chamado. Escolha outro antes de excluir." };
  const { error } = await supabase.from("chamado_orcamentos").delete().eq("id", id);
  if (error) return falha(error);
  revalidar(o.chamado_id as string);
  return { ok: true };
}

/**
 * Escolhe o orçamento: prestador e valor vão para o chamado. Na imobiliária,
 * se o proprietário paga alguma parte, o chamado espera a aprovação dele; no
 * modo pessoal (ou sem parte do proprietário) já fica aprovado.
 */
export async function escolherOrcamento(id: string): Promise<Resultado> {
  const { supabase, organizacao, papel } = await obterContexto();
  let chamadoId = "";
  try {
    if (!podeDecidir(papel)) throw new ErroValidacao(MSG_PAPEL);
    const { data: o } = await supabase.from("chamado_orcamentos").select("*").eq("id", id).single();
    if (!o) throw new ErroValidacao("Orçamento não encontrado.");
    if (o.valor == null) throw new ErroValidacao("Preencha o valor do orçamento antes de escolher.");
    chamadoId = o.chamado_id as string;
    const c = await chamadoBase(supabase, chamadoId);
    if (!["aberto", "em_analise", "aguardando_aprovacao"].includes(c.status)) throw new ErroValidacao("O orçamento só pode ser escolhido antes da aprovação do serviço.");
    let prestadorId = o.prestador_id as string | null;
    if (!prestadorId) {
      // Prestador digitado à mão vira cadastro (para pagar, avaliar e achar depois).
      const { data: p, error: e } = await supabase.from("pessoas").insert({ nome: o.prestador_nome, papeis: ["prestador"] }).select("id").single();
      if (e) throw e;
      prestadorId = p.id as string;
      await supabase.from("chamado_orcamentos").update({ prestador_id: prestadorId, prestador_nome: null }).eq("id", id);
    }
    const { resp, partes } = partesDo(c, organizacao.modo);
    const precisa = precisaAprovacaoProprietario(organizacao.modo, partes);
    // Num "pedido de novo" (serviço já agendado/em execução), a etapa de antes não se perde.
    const situacao = statusAoEscolherOrcamento({ precisa, status: c.status, statusAntes: c.status_antes_aprovacao });
    const { error } = await supabase
      .from("chamados")
      .update({
        orcamento_id: id,
        prestador_id: prestadorId,
        valor_aprovado: o.valor,
        garantia_dias: o.garantia_dias,
        responsabilidade: resp,
        pct_locatario: partes.locatario,
        pct_proprietario: partes.proprietario,
        pct_imobiliaria: partes.imobiliaria,
        status: situacao.status,
        aprovacao_status: precisa ? "pendente" : "nao_precisa",
        status_antes_aprovacao: situacao.status_antes_aprovacao,
        aprovacao_em: null,
        aprovacao_nome: null,
        aprovacao_obs: null,
        aprovacao_canal: null,
        aprovacao_ip: null,
      })
      .eq("id", chamadoId);
    if (error) throw error;
    await supabase.from("chamado_orcamentos").update({ status: "recebido" }).eq("chamado_id", chamadoId).eq("status", "escolhido").neq("id", id);
    await supabase.from("chamado_orcamentos").update({ status: "escolhido" }).eq("id", id);
    await evento(supabase, chamadoId, "orcamento", `Orçamento escolhido: ${formatarReais(o.valor)}`);
  } catch (e) {
    return falha(e);
  }
  revalidar(chamadoId);
  return { ok: true };
}

/** Resposta do proprietário registrada pela equipe (telefone, WhatsApp, e-mail…). Só imobiliária. */
export async function registrarAprovacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao, papel } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    if (organizacao.modo === "pessoal") throw new ErroValidacao("No modo pessoal não há aprovação de proprietário.");
    if (!podeDecidir(papel)) throw new ErroValidacao(MSG_PAPEL);
    const c = await chamadoBase(supabase, id);
    if (c.status !== "aguardando_aprovacao") throw new ErroValidacao("O chamado não está aguardando a aprovação do proprietário.");
    // Mesma regra do link: aprovou → volta para onde estava; recusou → análise,
    // orçamento volta a "recebido" e o compromisso marcado é desmarcado.
    const { error } = await supabase.rpc("registrar_aprovacao_chamado", {
      p_chamado: id,
      p: { aprovar: texto(fd, "decisao") === "aprovado", nome: textoObrigatorio(fd, "nome", "quem respondeu"), obs: texto(fd, "obs") },
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  revalidatePath("/agenda", "layout");
  return { ok: "Resposta registrada." };
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

/** Marca (ou remarca) o serviço: cria o compromisso na agenda ligado ao imóvel e ao prestador. */
export async function agendarChamado(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const c = await chamadoBase(supabase, id);
    if (!["aprovado", "agendado", "em_execucao"].includes(c.status)) throw new ErroValidacao("Escolha e aprove um orçamento antes de agendar.");
    const data_hora = instante(textoObrigatorio(fd, "data", "a data"), texto(fd, "hora") ?? "09:00");
    const duracao_min = Math.min(1440, Math.max(15, inteiro(fd, "duracao_min") ?? 120));
    const { data: p } = c.prestador_id ? await supabase.from("pessoas").select("nome, telefone").eq("id", c.prestador_id).single() : { data: null };
    const quando = `${formatarDataBR(diaLocal(data_hora))} às ${horaLocal(data_hora)}`;
    const compromisso = {
      tipo: "outro",
      titulo: `Manutenção #${c.numero}: ${c.titulo}`.slice(0, 200),
      data_hora,
      duracao_min,
      imovel_id: c.imovel_id,
      pessoa_id: c.prestador_id,
      contato_nome: p?.nome ?? null,
      contato_telefone: p?.telefone ?? null,
      observacoes: `Chamado de manutenção #${c.numero}${p?.nome ? ` · prestador ${p.nome}` : ""}.`,
    };
    let visitaId = c.visita_id;
    if (visitaId) {
      const { data: v } = await supabase.from("visitas").select("status").eq("id", visitaId).maybeSingle();
      if (!v || v.status !== "agendada") visitaId = null;
    }
    if (visitaId) {
      const { error } = await supabase.from("visitas").update(compromisso).eq("id", visitaId);
      if (error) throw error;
      await supabase.from("visita_eventos").insert({ visita_id: visitaId, tipo: "reagendada", descricao: `Remarcada para ${quando}` });
    } else {
      const { data: v, error } = await supabase.from("visitas").insert(compromisso).select("id").single();
      if (error) throw error;
      visitaId = v.id as string;
      await supabase.from("visita_eventos").insert({ visita_id: visitaId, tipo: "criada", descricao: `Manutenção marcada para ${quando}` });
    }
    const { error } = await supabase
      .from("chamados")
      .update({ agendado_para: data_hora, duracao_min, visita_id: visitaId, ...(c.status === "aprovado" ? { status: "agendado" } : {}) })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  revalidatePath("/agenda", "layout");
  return { ok: "Serviço agendado e colocado na agenda." };
}

// ---------------------------------------------------------------------------
// Conclusão e financeiro
// ---------------------------------------------------------------------------

async function planoDeContasManutencao(supabase: Supabase) {
  const { data } = await supabase.from("plano_contas").select("id, nome").eq("tipo", "despesa").eq("ativo", true).ilike("nome", "%manuten%").limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

/**
 * Aprova a conclusão: registra quem aprovou, a garantia e lança no Financeiro
 * (contas EM ABERTO — o pagamento é feito no Financeiro e respeita a aprovação
 * de pagamentos acima do limite). Parte do locatário: conta a receber ou item
 * na fatura em aberto do contrato.
 */
export async function concluirChamado(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase, organizacao, papel } = await obterContexto();
  const id = String(fd.get("id"));
  const modo = organizacao.modo;
  const avisos: string[] = [];
  try {
    if (!podeDecidir(papel)) throw new ErroValidacao(MSG_PAPEL);
    const c = await chamadoBase(supabase, id);
    if (!["aprovado", "agendado", "em_execucao"].includes(c.status)) throw new ErroValidacao("Só dá para concluir um chamado aprovado, agendado ou em execução.");
    const hoje = hojeISO();
    const concluido_em = texto(fd, "concluido_em") ?? hoje;
    if (concluido_em > hoje) throw new ErroValidacao("A data de conclusão não pode ser no futuro.");
    const valor = numero(fd, "valor_final") ?? (c.valor_aprovado != null ? Number(c.valor_aprovado) : null);
    if (!valor || valor <= 0) throw new ErroValidacao("Informe o valor final do serviço.");
    const aprovado_por = textoObrigatorio(fd, "aprovado_por", "quem aprovou a conclusão");
    const garantia_dias = fd.has("garantia_dias") ? inteiro(fd, "garantia_dias") : c.garantia_dias;
    if (garantia_dias != null && (garantia_dias < 0 || garantia_dias > 3650)) throw new ErroValidacao("Garantia: de 0 a 3650 dias.");
    const { resp, partes } = partesDo(c, modo);
    const plano = planoFinanceiro({ modo, valor, responsabilidade: resp, partes, pagoDireto: c.pago_direto, titulo: c.titulo });
    if (plano.pagar.length && !c.prestador_id) throw new ErroValidacao("Escolha o prestador (aba Orçamentos) para lançar o pagamento a ele.");
    const vencimento = texto(fd, "vencimento") ?? hoje;
    const planoId = await planoDeContasManutencao(supabase);
    const lancamentos: Record<string, unknown>[] = plano.pagar.map((l) => ({
      tipo: "pagar",
      descricao: `${l.descricao} · chamado #${c.numero}`,
      valor: l.valor,
      vencimento,
      pessoa_id: c.prestador_id,
      descontar_repasse: l.descontarRepasse,
      // Despesa do proprietário paga pela imobiliária e descontada no repasse: dinheiro de terceiros (fora do resultado).
      terceiros: l.descontarRepasse,
      plano_id: l.descontarRepasse ? null : planoId,
    }));
    let fatura: Record<string, unknown> | null = null;
    let cobranca: string | null = null;
    if (plano.cobrarLocatario > 0) {
      const forma = texto(fd, "cobranca") === "fatura" && c.contrato_id ? "fatura" : "receber";
      cobranca = forma;
      if (forma === "fatura") {
        const escolhida = texto(fd, "fatura_id");
        const { data: f } = escolhida
          ? await supabase.from("faturas").select("id, numero").eq("id", escolhida).eq("status", "aberta").maybeSingle()
          : await supabase.from("faturas").select("id, numero").eq("contrato_id", c.contrato_id!).eq("status", "aberta").gte("vencimento", hoje).order("vencimento").limit(1).maybeSingle();
        if (f) {
          fatura = { fatura_id: f.id, valor: plano.cobrarLocatario, descricao: `Manutenção #${c.numero} — ${c.titulo}${plano.cobrarLocatario < valor ? " (sua parte)" : ""}`, destino: modo === "pessoal" ? "proprietario" : "imobiliaria" };
          avisos.push(`${formatarReais(plano.cobrarLocatario)} lançado na fatura #${f.numero} do locatário.`);
        } else avisos.push(`Não há fatura em aberto: a cobrança de ${formatarReais(plano.cobrarLocatario)} fica pendente para a próxima fatura (aba Agenda e conclusão → Lançar na fatura).`);
      } else {
        const { data: loc } = c.contrato_id ? await supabase.from("contrato_partes").select("pessoa_id").eq("contrato_id", c.contrato_id).eq("papel", "locatario").limit(1).maybeSingle() : { data: null };
        lancamentos.push({
          tipo: "receber",
          descricao: `Reembolso de manutenção — chamado #${c.numero} (${c.titulo})`,
          valor: plano.cobrarLocatario,
          vencimento: texto(fd, "vencimento_receber") ?? vencimento,
          pessoa_id: (loc?.pessoa_id as string | undefined) ?? c.solicitante_pessoa_id,
          descontar_repasse: false,
          plano_id: null,
        });
        avisos.push(`${formatarReais(plano.cobrarLocatario)} a receber do locatário no Financeiro.`);
      }
    }
    const { error } = await supabase.rpc("concluir_chamado", {
      p_chamado: id,
      p: {
        concluido_em,
        valor_final: valor,
        aprovado_por,
        obs: texto(fd, "obs"),
        garantia_dias,
        garantia_ate: garantiaAte(concluido_em, garantia_dias),
        cobranca_locatario: cobranca,
        lancamentos,
        fatura,
      },
    });
    if (error) throw error;
    if (plano.pagar.some((l) => l.descontarRepasse)) avisos.push("A parte do proprietário será descontada do próximo repasse.");
    // Valor final acima do que o proprietário aprovou: avisar (a diferença sai do repasse dele).
    if (modo === "imobiliaria" && c.aprovacao_status === "aprovado" && c.valor_aprovado != null && plano.partes.proprietario > 0) {
      const aprovadoDono = paraReais(percentual(paraCentavos(c.valor_aprovado), partes.proprietario));
      if (paraCentavos(plano.partes.proprietario) > paraCentavos(aprovadoDono))
        avisos.push(`Atenção: a parte do proprietário (${formatarReais(plano.partes.proprietario)}) ficou acima da que ele aprovou (${formatarReais(aprovadoDono)}). Avise o proprietário antes do repasse.`);
    }
    if (plano.pagar.length) {
      const { data: org } = await supabase.from("organizacoes").select("aprovacao_pagamento_acima").eq("id", organizacao.id).single();
      const limite = org?.aprovacao_pagamento_acima == null ? null : Number(org.aprovacao_pagamento_acima);
      if (limite && plano.pagar.some((l) => l.valor > limite)) avisos.push("O pagamento passa do limite: um administrador ou gestor precisa aprová-lo no Financeiro.");
    }
    if (plano.pagar.length === 0 && c.pago_direto) avisos.push("O responsável pagou direto ao prestador: nada foi lançado no Financeiro.");
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  revalidarFinanceiro();
  return { ok: ["Conclusão aprovada.", ...avisos].join(" ") };
}

export async function desfazerConclusao(id: string): Promise<Resultado> {
  const { supabase, papel } = await obterContexto();
  if (!podeDecidir(papel)) return { ok: false, erro: MSG_PAPEL };
  const { error } = await supabase.rpc("desfazer_conclusao_chamado", { p_chamado: id });
  if (error) return falha(error);
  revalidar(id);
  revalidarFinanceiro();
  return { ok: true };
}

async function parteDoLocatario(supabase: Supabase, id: string, modo: Modo) {
  const c = await chamadoBase(supabase, id);
  if (!["concluido", "avaliado"].includes(c.status)) throw new ErroValidacao("O chamado ainda não foi concluído.");
  if (c.fatura_item_id) throw new ErroValidacao("A cobrança já está numa fatura.");
  const { count } = await supabase.from("lancamentos").select("id", { count: "exact", head: true }).eq("chamado_id", id).eq("tipo", "receber").neq("status", "cancelado");
  if (count) throw new ErroValidacao("A cobrança do locatário já está no Financeiro (conta a receber).");
  const { resp, partes } = partesDo(c, modo);
  const plano = planoFinanceiro({ modo, valor: Number(c.valor_final ?? c.valor_aprovado ?? 0), responsabilidade: resp, partes, pagoDireto: c.pago_direto, titulo: c.titulo });
  if (plano.cobrarLocatario <= 0) throw new ErroValidacao("Não há parte do locatário a cobrar.");
  return { c, valor: plano.cobrarLocatario };
}

/** Cobrança pendente do locatário → fatura em aberto do contrato (a primeira a vencer). */
export async function lancarNaFatura(id: string): Promise<Resultado> {
  const { supabase, organizacao, papel } = await obterContexto();
  try {
    if (!podeDecidir(papel)) throw new ErroValidacao(MSG_PAPEL);
    const { c, valor } = await parteDoLocatario(supabase, id, organizacao.modo);
    if (!c.contrato_id) throw new ErroValidacao("O chamado não está ligado a um contrato.");
    const { data: f } = await supabase.from("faturas").select("id").eq("contrato_id", c.contrato_id).eq("status", "aberta").gte("vencimento", hojeISO()).order("vencimento").limit(1).maybeSingle();
    if (!f) throw new ErroValidacao("Ainda não há fatura a vencer em aberto neste contrato. Gere a fatura (Contratos → Cobranças) ou use a conta a receber.");
    const { error } = await supabase.rpc("cobrar_chamado_na_fatura", {
      p_chamado: id,
      p_fatura: f.id,
      p_valor: valor,
      p_descricao: `Manutenção #${c.numero} — ${c.titulo}`,
      p_destino: organizacao.modo === "pessoal" ? "proprietario" : "imobiliaria",
    });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar(id);
  revalidarFinanceiro();
  return { ok: true };
}

/** Cobrança pendente do locatário → conta a receber no Financeiro (RPC trava o chamado: não duplica). */
export async function gerarContaReceber(id: string): Promise<Resultado> {
  const { supabase, organizacao, papel } = await obterContexto();
  try {
    if (!podeDecidir(papel)) throw new ErroValidacao(MSG_PAPEL);
    const { c, valor } = await parteDoLocatario(supabase, id, organizacao.modo);
    const { data: loc } = c.contrato_id ? await supabase.from("contrato_partes").select("pessoa_id").eq("contrato_id", c.contrato_id).eq("papel", "locatario").limit(1).maybeSingle() : { data: null };
    const { error } = await supabase.rpc("chamado_conta_receber", {
      p_chamado: id,
      p: {
        valor,
        vencimento: hojeISO(),
        pessoa_id: (loc?.pessoa_id as string | undefined) ?? c.solicitante_pessoa_id,
        descricao: `Reembolso de manutenção — chamado #${c.numero} (${c.titulo})`,
      },
    });
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar(id);
  revalidarFinanceiro();
  return { ok: true };
}

/** Nota de 1 a 5 e comentário sobre o prestador (o chamado passa a "avaliado"). */
export async function avaliarChamado(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const c = await chamadoBase(supabase, id);
    if (!["concluido", "avaliado"].includes(c.status)) throw new ErroValidacao("Avalie depois de concluir o serviço.");
    const n = inteiro(fd, "avaliacao_nota");
    const nota = n && n >= 1 && n <= 5 ? n : null;
    const d: Record<string, unknown> = { avaliacao_nota: nota, avaliacao_comentario: texto(fd, "avaliacao_comentario") };
    if (nota && c.status === "concluido") Object.assign(d, { status: "avaliado", avaliado_em: new Date().toISOString() });
    if (!nota && c.status === "avaliado") Object.assign(d, { status: "concluido", avaliado_em: null });
    const { error } = await supabase.from("chamados").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar(id);
  revalidatePath("/pessoas", "layout");
  return { ok: "Avaliação salva." };
}

// ---------------------------------------------------------------------------
// Link do locatário (um por contrato)
// ---------------------------------------------------------------------------

export async function gerarLinkLocatario(contratoId: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: atual } = await supabase.from("chamado_links").select("id").eq("contrato_id", contratoId).maybeSingle();
  const { error } = atual
    ? await supabase.from("chamado_links").update({ ativo: true }).eq("id", atual.id)
    : await supabase.from("chamado_links").insert({ contrato_id: contratoId });
  if (error) return falha(error);
  revalidatePath("/manutencao/links");
  return { ok: true };
}

/** Troca o endereço do link (o antigo deixa de funcionar). */
export async function trocarLinkLocatario(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("chamado_links").update({ token: crypto.randomUUID(), ativo: true }).eq("id", id);
  if (error) return falha(error);
  revalidatePath("/manutencao/links");
  return { ok: true };
}

export async function excluirLinkLocatario(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("chamado_links").delete().eq("id", id);
  if (error) return falha(error);
  revalidatePath("/manutencao/links");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Prestadores (cadastro em Pessoas com o papel "prestador")
// ---------------------------------------------------------------------------

export async function criarPrestador(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("pessoas").insert({
      nome: textoObrigatorio(fd, "nome", "o nome"),
      tipo_pessoa: texto(fd, "tipo_pessoa") === "PJ" ? "PJ" : "PF",
      telefone: texto(fd, "telefone"),
      email: texto(fd, "email"),
      especialidade: texto(fd, "especialidade"),
      pix_chave: texto(fd, "pix_chave"),
      papeis: ["prestador"],
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/manutencao", "layout");
  revalidatePath("/pessoas");
  return { ok: "Prestador cadastrado." };
}

/** Tira a pessoa da lista de prestadores (o cadastro continua em Pessoas). */
export async function tirarPrestador(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data: p } = await supabase.from("pessoas").select("papeis").eq("id", id).single();
  if (!p) return { ok: false, erro: "Cadastro não encontrado." };
  const papeis = ((p.papeis as string[]) ?? []).filter((x) => x !== "prestador");
  const { error } = await supabase.from("pessoas").update({ papeis: papeis.length ? papeis : ["cliente"] }).eq("id", id);
  if (error) return falha(error);
  revalidatePath("/manutencao", "layout");
  revalidatePath("/pessoas");
  return { ok: true };
}
