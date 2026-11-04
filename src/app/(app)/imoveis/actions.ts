"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { ROTULO_MOTIVO_DUPLICADO, duplicadosDe } from "@/lib/dominio/imoveis";
import { type EstadoAcao, booleano, ErroValidacao, inteiro, lista, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

const CAMPOS_TEXTO = [
  "tipo", "status", "cep", "logradouro", "numero", "complemento", "bairro", "cidade",
  "titulo", "descricao", "matricula", "inscricao_iptu", "outros_encargos_descricao", "video_url", "tour_url",
  "exclusividade_inicio", "exclusividade_fim", "autorizacao_numero", "autorizacao_data", "autorizacao_validade",
  "corretor_id", "empreendimento_id", "bloco", "unidade",
] as const;
const CAMPOS_NUMERO = [
  "area_util", "area_construida", "area_privativa", "area_total", "valor_venda", "valor_aluguel",
  "valor_condominio", "valor_iptu", "outros_encargos", "latitude", "longitude",
] as const;
const CAMPOS_INTEIRO = ["quartos", "suites", "banheiros", "vagas"] as const;

/**
 * Lê só os campos que vieram no formulário: cada aba do imóvel salva a sua parte
 * sem apagar o resto. Caixas de marcar (que somem quando desmarcadas) vêm com um
 * campo-marcador "_<campo>".
 */
function lerImovel(fd: FormData) {
  const d: Record<string, unknown> = {};
  if (fd.has("codigo")) d.codigo = textoObrigatorio(fd, "codigo", "o código");
  for (const c of CAMPOS_TEXTO) if (fd.has(c)) d[c] = texto(fd, c);
  for (const c of CAMPOS_NUMERO) if (fd.has(c)) d[c] = numero(fd, c);
  for (const c of CAMPOS_INTEIRO) if (fd.has(c)) d[c] = inteiro(fd, c);
  if (fd.has("uf")) d.uf = texto(fd, "uf")?.toUpperCase() ?? null;
  if (fd.has("_finalidades")) {
    const f = lista(fd, "finalidades");
    if (f.length === 0) throw new ErroValidacao("Selecione ao menos uma finalidade.");
    d.finalidades = f;
  }
  if (fd.has("_comodidades")) d.comodidades = lista(fd, "comodidades");
  if (fd.has("_publicar_site")) d.publicar_site = booleano(fd, "publicar_site");
  if (fd.has("_exclusivo")) d.exclusivo = booleano(fd, "exclusivo");
  if (fd.has("caracteristicas"))
    d.caracteristicas = (texto(fd, "caracteristicas") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  if (d.tipo === null) d.tipo = "apartamento";
  if (d.status === null) d.status = "disponivel";
  return d;
}

function revalidarImovel(id?: string | null) {
  revalidatePath("/imoveis", "layout");
  if (id) revalidatePath(`/imoveis/${id}`, "layout");
  revalidatePath("/");
}

async function avisoDuplicado(supabase: Supabase, d: Record<string, unknown>, id: string | null) {
  const { data } = await supabase.from("imoveis").select("id, codigo, logradouro, numero, complemento, cidade, matricula, inscricao_iptu");
  return duplicadosDe({ ...(d as object), id: id ?? undefined }, data ?? []);
}

export async function salvarImovel(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = texto(fd, "id");
  let novoId: string | null = null;
  try {
    const dados = lerImovel(fd);
    if (id) {
      const { error } = await supabase.from("imoveis").update(dados).eq("id", id);
      if (error) throw error;
    } else {
      if (!booleano(fd, "ignorar_duplicado")) {
        const dup = await avisoDuplicado(supabase, dados, null);
        if (dup.length)
          throw new ErroValidacao(
            `Parece que este imóvel já está cadastrado: ${dup
              .slice(0, 3)
              .map((x) => `${x.item.codigo} (${ROTULO_MOTIVO_DUPLICADO[x.motivo]})`)
              .join(", ")}. Se for outro imóvel mesmo, marque "Cadastrar mesmo assim" no fim da página.`,
          );
      }
      const { data, error } = await supabase.from("imoveis").insert(dados).select("id").single();
      if (error) throw error;
      novoId = data.id;
      const proprietario = texto(fd, "proprietario_id");
      if (proprietario) {
        const { error: e2 } = await supabase.from("imovel_proprietarios").insert({ imovel_id: novoId, pessoa_id: proprietario, percentual: 100 });
        if (e2) throw e2;
      }
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarImovel(id);
  if (novoId) redirect(`/imoveis/${novoId}`);
  return { ok: "Imóvel salvo." };
}

export async function adicionarProprietario(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const imovel_id = textoObrigatorio(fd, "imovel_id");
    const pessoa_id = textoObrigatorio(fd, "pessoa_id", "o proprietário");
    const percentual = numero(fd, "percentual") ?? 100;
    const { error } = await supabase
      .from("imovel_proprietarios")
      .upsert({ imovel_id, pessoa_id, percentual }, { onConflict: "imovel_id,pessoa_id" });
    if (error) throw error;
    await supabase.from("pessoas").select("papeis").eq("id", pessoa_id).single().then(async ({ data }) => {
      if (data && !data.papeis.includes("proprietario"))
        await supabase.from("pessoas").update({ papeis: [...data.papeis, "proprietario"] }).eq("id", pessoa_id);
    });
    revalidarImovel(imovel_id);
    return { ok: fd.has("editar") ? "Participação salva." : "Proprietário vinculado." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function removerProprietario(fd: FormData) {
  const { supabase } = await obterContexto();
  const imovel_id = String(fd.get("imovel_id"));
  await supabase.from("imovel_proprietarios").delete().eq("imovel_id", imovel_id).eq("pessoa_id", String(fd.get("pessoa_id")));
  revalidarImovel(imovel_id);
}

// Duplicar / excluir -----------------------------------------------------------
async function proximoCodigoLivre(supabase: Supabase, base: string) {
  const { data } = await supabase.from("imoveis").select("codigo").ilike("codigo", `${base}%`);
  const usados = new Set((data ?? []).map((r) => String(r.codigo).toUpperCase()));
  for (let n = 2; n < 1000; n++) {
    const c = `${base}-${n}`;
    if (!usados.has(c.toUpperCase())) return c;
  }
  return `${base}-${Date.now()}`;
}

async function duplicarUm(supabase: Supabase, id: string): Promise<string> {
  const { data: orig, error } = await supabase.from("imoveis").select("*").eq("id", id).single();
  if (error || !orig) throw error ?? new Error("Imóvel não encontrado.");
  const resto: Record<string, unknown> = { ...orig };
  for (const k of ["id", "organizacao_id", "created_at", "captado_em", "vendido_em"]) delete resto[k];
  const codigo = await proximoCodigoLivre(supabase, String(orig.codigo).replace(/-\d+$/, ""));
  const { data: novo, error: e2 } = await supabase
    .from("imoveis")
    .insert({ ...resto, codigo, status: "disponivel", exclusivo: false })
    .select("id")
    .single();
  if (e2) throw e2;
  const { data: props } = await supabase.from("imovel_proprietarios").select("pessoa_id, percentual").eq("imovel_id", id);
  if (props?.length) await supabase.from("imovel_proprietarios").insert(props.map((p) => ({ ...p, imovel_id: novo.id })));
  return novo.id as string;
}

export async function duplicarImovel(fd: FormData) {
  const { supabase } = await obterContexto();
  const novo = await duplicarUm(supabase, String(fd.get("id")));
  revalidarImovel();
  redirect(`/imoveis/${novo}`);
}

export async function excluirImovel(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  const { count } = await supabase.from("contratos").select("id", { count: "exact", head: true }).eq("imovel_id", id);
  if (count) return { erro: "Este imóvel tem contrato(s). Marque como Inativo em vez de excluir." };
  const { data: arquivos } = await supabase.from("imovel_midias").select("path").eq("imovel_id", id);
  const { error } = await supabase.from("imoveis").delete().eq("id", id);
  if (error) return { erro: mensagemErro(error) };
  if (arquivos?.length) await supabase.storage.from("imoveis").remove(arquivos.map((a) => a.path as string));
  revalidarImovel();
  redirect("/imoveis");
}

// Ações em massa -----------------------------------------------------------------
export type AcaoMassa =
  | { tipo: "status"; valor: string }
  | { tipo: "finalidade_add" | "finalidade_remover"; valor: string }
  | { tipo: "reajuste"; pct: number; campos: ("valor_aluguel" | "valor_venda")[] }
  | { tipo: "corretor" | "empreendimento"; valor: string | null }
  | { tipo: "duplicar" | "excluir" };

export async function acaoEmMassa(ids: string[], acao: AcaoMassa): Promise<{ ok: boolean; erro?: string; feitos?: number }> {
  const { supabase } = await obterContexto();
  if (!ids.length) return { ok: false, erro: "Selecione ao menos um imóvel." };
  if (ids.length > 500) return { ok: false, erro: "Selecione no máximo 500 imóveis por vez." };
  try {
    let feitos = 0;
    if (acao.tipo === "status") {
      const { error, count } = await supabase.from("imoveis").update({ status: acao.valor }, { count: "exact" }).in("id", ids);
      if (error) throw error;
      feitos = count ?? ids.length;
    } else if (acao.tipo === "corretor" || acao.tipo === "empreendimento") {
      const campo = acao.tipo === "corretor" ? "corretor_id" : "empreendimento_id";
      const { error, count } = await supabase.from("imoveis").update({ [campo]: acao.valor || null }, { count: "exact" }).in("id", ids);
      if (error) throw error;
      feitos = count ?? ids.length;
    } else if (acao.tipo === "finalidade_add" || acao.tipo === "finalidade_remover" || acao.tipo === "reajuste") {
      const { data, error } = await supabase.from("imoveis").select("id, finalidades, valor_aluguel, valor_venda").in("id", ids);
      if (error) throw error;
      for (const im of data ?? []) {
        let mudanca: Record<string, unknown> | null = null;
        if (acao.tipo === "finalidade_add" && !im.finalidades.includes(acao.valor)) mudanca = { finalidades: [...im.finalidades, acao.valor] };
        if (acao.tipo === "finalidade_remover" && im.finalidades.includes(acao.valor)) {
          const f = im.finalidades.filter((x: string) => x !== acao.valor);
          if (f.length) mudanca = { finalidades: f };
        }
        if (acao.tipo === "reajuste") {
          if (!Number.isFinite(acao.pct) || Math.abs(acao.pct) > 200) throw new ErroValidacao("Percentual inválido.");
          mudanca = {};
          for (const c of acao.campos) {
            const v = im[c as "valor_aluguel" | "valor_venda"];
            if (v != null) mudanca[c] = Math.round(Number(v) * (1 + acao.pct / 100) * 100) / 100;
          }
          if (!Object.keys(mudanca).length) mudanca = null;
        }
        if (mudanca) {
          const r = await supabase.from("imoveis").update(mudanca).eq("id", im.id);
          if (r.error) throw r.error;
          feitos++;
        }
      }
    } else if (acao.tipo === "duplicar") {
      if (ids.length > 50) throw new ErroValidacao("Duplique no máximo 50 de uma vez.");
      for (const id of ids) {
        await duplicarUm(supabase, id);
        feitos++;
      }
    } else if (acao.tipo === "excluir") {
      const { data: comContrato } = await supabase.from("contratos").select("imovel_id").in("imovel_id", ids);
      const bloqueados = new Set((comContrato ?? []).map((c) => c.imovel_id as string));
      const livres = ids.filter((i) => !bloqueados.has(i));
      if (livres.length) {
        const { data: arquivos } = await supabase.from("imovel_midias").select("path").in("imovel_id", livres);
        const { error } = await supabase.from("imoveis").delete().in("id", livres);
        if (error) throw error;
        if (arquivos?.length) await supabase.storage.from("imoveis").remove(arquivos.map((a) => a.path as string));
      }
      feitos = livres.length;
      if (bloqueados.size) {
        revalidarImovel();
        return { ok: true, feitos, erro: `${bloqueados.size} imóvel(is) com contrato não foram excluídos (marque como Inativo).` };
      }
    }
    revalidarImovel();
    return { ok: true, feitos };
  } catch (e) {
    return { ok: false, erro: mensagemErro(e) };
  }
}

// Importação ------------------------------------------------------------------------
const PERMITIDOS_IMPORTACAO = new Set([
  "codigo", "tipo", "finalidades", "cep", "logradouro", "numero", "complemento", "bairro", "cidade", "uf",
  "quartos", "suites", "banheiros", "vagas", "area_util", "area_construida", "area_privativa", "area_total",
  "valor_aluguel", "valor_venda", "valor_condominio", "valor_iptu", "matricula", "inscricao_iptu", "descricao",
]);

export async function importarImoveis(itens: Record<string, unknown>[]): Promise<{ ok: boolean; erro?: string; criados?: number; falhas?: string[] }> {
  const { supabase } = await obterContexto();
  if (!Array.isArray(itens) || !itens.length) return { ok: false, erro: "Nada para importar." };
  if (itens.length > 2000) return { ok: false, erro: "Importe no máximo 2.000 imóveis por vez." };
  const linhas = itens.map((it) => Object.fromEntries(Object.entries(it).filter(([k]) => PERMITIDOS_IMPORTACAO.has(k))));
  const falhas: string[] = [];
  let criados = 0;
  for (let i = 0; i < linhas.length; i += 100) {
    const lote = linhas.slice(i, i + 100);
    const { error } = await supabase.from("imoveis").insert(lote);
    if (!error) {
      criados += lote.length;
      continue;
    }
    // Lote com problema: tenta um por um para salvar o que der.
    for (const l of lote) {
      const r = await supabase.from("imoveis").insert(l);
      if (r.error) falhas.push(`${String(l.codigo)}: ${mensagemErro(r.error)}`);
      else criados++;
    }
  }
  revalidarImovel();
  return { ok: true, criados, falhas };
}

// Mídia e documentos ------------------------------------------------------------------
export async function registrarArquivo(dados: {
  imovelId: string;
  tipo: "foto" | "planta" | "documento" | "autorizacao";
  path: string;
  nome: string;
  categoria?: string | null;
}): Promise<{ ok: boolean; erro?: string }> {
  const { supabase, organizacao } = await obterContexto();
  if (!dados.path.startsWith(`${organizacao.id}/${dados.imovelId}/`)) return { ok: false, erro: "Caminho de arquivo inválido." };
  const { count } = await supabase.from("imovel_midias").select("id", { count: "exact", head: true }).eq("imovel_id", dados.imovelId).eq("tipo", dados.tipo);
  const { error } = await supabase.from("imovel_midias").insert({
    imovel_id: dados.imovelId,
    tipo: dados.tipo,
    path: dados.path,
    nome: dados.nome.slice(0, 200),
    categoria: dados.categoria ?? null,
    ordem: count ?? 0,
    capa: dados.tipo === "foto" && !count,
  });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarImovel(dados.imovelId);
  return { ok: true };
}

export async function excluirArquivo(id: string): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("imovel_midias").select("path, imovel_id, capa, tipo").eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Arquivo não encontrado." };
  const { error } = await supabase.from("imovel_midias").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  await supabase.storage.from("imoveis").remove([data.path as string]);
  if (data.capa) {
    const { data: prox } = await supabase.from("imovel_midias").select("id").eq("imovel_id", data.imovel_id).eq("tipo", "foto").order("ordem").limit(1);
    if (prox?.[0]) await supabase.from("imovel_midias").update({ capa: true }).eq("id", prox[0].id);
  }
  revalidarImovel(data.imovel_id as string);
  return { ok: true };
}

export async function definirCapa(id: string): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("imovel_midias").select("imovel_id").eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Foto não encontrada." };
  await supabase.from("imovel_midias").update({ capa: false }).eq("imovel_id", data.imovel_id).eq("tipo", "foto");
  const { error } = await supabase.from("imovel_midias").update({ capa: true }).eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarImovel(data.imovel_id as string);
  return { ok: true };
}

/** Troca a posição da foto/planta com a vizinha (-1 = para trás, +1 = para frente). */
export async function moverArquivo(id: string, passo: -1 | 1): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const { data: atual } = await supabase.from("imovel_midias").select("imovel_id, tipo").eq("id", id).maybeSingle();
  if (!atual) return { ok: false, erro: "Arquivo não encontrado." };
  const { data: todos } = await supabase
    .from("imovel_midias")
    .select("id")
    .eq("imovel_id", atual.imovel_id)
    .eq("tipo", atual.tipo)
    .order("ordem")
    .order("created_at");
  const lista = (todos ?? []).map((t) => t.id as string);
  const i = lista.indexOf(id);
  const j = i + passo;
  if (i < 0 || j < 0 || j >= lista.length) return { ok: true };
  [lista[i], lista[j]] = [lista[j], lista[i]];
  for (let k = 0; k < lista.length; k++) await supabase.from("imovel_midias").update({ ordem: k }).eq("id", lista[k]);
  revalidarImovel(atual.imovel_id as string);
  return { ok: true };
}

export async function linkArquivo(id: string): Promise<{ ok: boolean; url?: string; erro?: string }> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("imovel_midias").select("path").eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Arquivo não encontrado." };
  const { data: s, error } = await supabase.storage.from("imoveis").createSignedUrl(data.path as string, 600);
  if (error || !s) return { ok: false, erro: "Não foi possível abrir o arquivo." };
  return { ok: true, url: s.signedUrl };
}

// Anúncios (modo imobiliária) ----------------------------------------------------------
export async function criarAnuncio(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const imovel_id = String(fd.get("imovel_id"));
  try {
    const { error } = await supabase.from("imovel_anuncios").insert({
      imovel_id,
      portal: textoObrigatorio(fd, "portal", "o portal"),
      url: texto(fd, "url"),
      inicio: texto(fd, "inicio") ?? undefined,
      fim: texto(fd, "fim"),
      valor: numero(fd, "valor"),
      observacoes: texto(fd, "observacoes"),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarImovel(imovel_id);
  return { ok: "Anúncio registrado." };
}

export async function encerrarAnuncio(fd: FormData) {
  const { supabase } = await obterContexto();
  const imovel_id = String(fd.get("imovel_id"));
  // Data de hoje em Brasília (a de UTC já é amanhã depois das 21h).
  await supabase.from("imovel_anuncios").update({ fim: hojeISO() }).eq("id", String(fd.get("id")));
  revalidarImovel(imovel_id);
}

export async function excluirAnuncio(fd: FormData) {
  const { supabase } = await obterContexto();
  const imovel_id = String(fd.get("imovel_id"));
  await supabase.from("imovel_anuncios").delete().eq("id", String(fd.get("id")));
  revalidarImovel(imovel_id);
}
