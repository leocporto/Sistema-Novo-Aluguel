"use server";

import { promises as dns } from "node:dns";
import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { NOME_TXT, RE_COR, codigoTxt, dnsApontaCerto, ga4Valido, normalizarDominio, slugValido, txtConfere } from "@/lib/dominio/site";
import { LISTA_PORTAIS, ehPortal } from "@/lib/dominio/site-portais";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, texto, textoObrigatorio } from "@/lib/form";
import { montarFeed } from "@/lib/servicos/portais";
import { origemAtual, podeAdministrar } from "./dados";

type Resultado = { ok: boolean; erro?: string };
const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });

function revalidar() {
  revalidatePath("/site", "layout");
}

/** Site e portais só existem no modo imobiliária. */
async function contexto() {
  const ctx = await obterContexto();
  if (ctx.organizacao.modo === "pessoal") throw new ErroValidacao("O site imobiliário só existe no modo imobiliária.");
  return ctx;
}

const marcado = (fd: FormData, campo: string) => fd.getAll(campo).includes("on");

function mensagemUnica(e: unknown): string {
  const bruta = e && typeof e === "object" && "message" in e ? String((e as { message: string }).message) : "";
  if (bruta.includes("site_config_slug_unico")) return "Esse endereço já está em uso por outra imobiliária. Escolha outro.";
  if (bruta.includes("site_config_org_unica")) return "Sua imobiliária já tem um site.";
  return mensagemErro(e);
}

// ---------------------------------------------------------------------------
// Configuração do site
// ---------------------------------------------------------------------------

export async function criarSite(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await contexto();
    const slug = textoObrigatorio(fd, "slug", "o endereço do site").toLowerCase();
    if (!slugValido(slug)) throw new ErroValidacao("Endereço inválido: use de 3 a 50 letras minúsculas, números e hífen (ex.: imobiliaria-central).");
    const { error } = await supabase.from("site_config").insert({
      slug,
      nome: texto(fd, "nome") ?? organizacao.nome,
      telefone: organizacao.telefone,
      email: organizacao.email,
      creci: organizacao.creci,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemUnica(e) };
  }
  revalidar();
  return { ok: "Site criado. Complete a marca e os contatos e marque “Site no ar”." };
}

const TEXTOS: [string, number][] = [
  ["nome", 120],
  ["slogan", 160],
  ["titulo_home", 120],
  ["subtitulo_home", 300],
  ["sobre", 3000],
  ["telefone", 40],
  ["whatsapp", 40],
  ["email", 160],
  ["endereco", 300],
  ["creci", 40],
  ["seo_titulo", 70],
  ["seo_descricao", 200],
];
const REDES = ["instagram", "facebook", "youtube"];
const MARCAS = ["ativo", "mostrar_endereco", "captacao_ativa", "agendamento_ativo"];

/** Link de rede social sempre com https:// ("@perfil" vira o endereço da rede). */
function linkRede(rede: string, v: string | null): string | null {
  if (!v) return null;
  const perfil: Record<string, string> = { instagram: "instagram.com/", facebook: "facebook.com/", youtube: "youtube.com/@" };
  const url = /^https?:\/\//i.test(v) ? v.replace(/^http:/i, "https:") : `https://${v.startsWith("@") ? `${perfil[rede]}${v.slice(1)}` : v}`;
  try {
    return new URL(url).toString();
  } catch {
    throw new ErroValidacao(`Link inválido: ${v}`);
  }
}

/** Edição da configuração (salva sozinha; só os campos que vieram). */
export async function salvarSite(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const id = textoObrigatorio(fd, "id");
    const d: Record<string, unknown> = {};
    for (const [c, max] of TEXTOS) if (fd.has(c)) d[c] = texto(fd, c)?.slice(0, max) ?? null;
    if (d.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(d.email))) throw new ErroValidacao("E-mail inválido.");
    for (const c of REDES) if (fd.has(c)) d[c] = linkRede(c, texto(fd, c));
    for (const c of ["cor_primaria", "cor_secundaria"]) {
      if (!fd.has(c)) continue;
      const v = texto(fd, c);
      if (!v || !RE_COR.test(v)) throw new ErroValidacao("Escolha uma cor válida.");
      d[c] = v.toLowerCase();
    }
    if (fd.has("ga4_id")) {
      const v = texto(fd, "ga4_id")?.toUpperCase().replace(/\s/g, "") ?? null;
      if (v && !ga4Valido(v)) throw new ErroValidacao("O código do Google Analytics 4 começa com G- (ex.: G-AB12CD34EF).");
      d.ga4_id = v;
    }
    for (const c of MARCAS) if (fd.has(c)) d[c] = marcado(fd, c);
    const { error } = await supabase.from("site_config").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemUnica(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

/** Endereço (slug) e domínio próprio: mudam os links do site, então só admin/gestor e com botão. */
export async function salvarEnderecoSite(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, papel } = await contexto();
    if (!podeAdministrar(papel)) throw new ErroValidacao("Só administradores e gestores mudam o endereço e o domínio do site.");
    const id = textoObrigatorio(fd, "id");
    const slug = textoObrigatorio(fd, "slug", "o endereço do site").toLowerCase();
    if (!slugValido(slug)) throw new ErroValidacao("Endereço inválido: use de 3 a 50 letras minúsculas, números e hífen.");
    const bruto = texto(fd, "dominio");
    const dominio = bruto ? normalizarDominio(bruto) : null;
    if (bruto && !dominio) throw new ErroValidacao("Domínio inválido. Escreva só o domínio, como minhaimobiliaria.com.br.");
    const { error } = await supabase.from("site_config").update({ slug, dominio }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemUnica(e) };
  }
  revalidar();
  return { ok: "Endereço salvo." };
}

/** Grava o logo enviado pelo navegador (bucket público "site") e apaga o anterior. */
export async function registrarLogo(caminho: string): Promise<Resultado> {
  try {
    const { supabase, organizacao } = await contexto();
    if (!caminho.startsWith(`${organizacao.id}/`) || caminho.includes("..")) throw new ErroValidacao("Arquivo inválido.");
    const { data: atual } = await supabase.from("site_config").select("id, logo_path").maybeSingle();
    if (!atual) throw new ErroValidacao("Crie o site primeiro.");
    const { error } = await supabase.from("site_config").update({ logo_path: caminho }).eq("id", atual.id);
    if (error) throw error;
    if (atual.logo_path && atual.logo_path !== caminho) await supabase.storage.from("site").remove([atual.logo_path]);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

export async function removerLogo(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { data } = await supabase.from("site_config").select("logo_path").eq("id", id).maybeSingle();
    const { error } = await supabase.from("site_config").update({ logo_path: null }).eq("id", id);
    if (error) throw error;
    if (data?.logo_path) await supabase.storage.from("site").remove([data.logo_path]);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/**
 * Consulta o DNS do domínio. Só marca como verificado quando:
 * - o registro TXT "_novoaluguel.<domínio>" tem o código deste site (prova que o
 *   domínio é da imobiliária — apontar para a hospedagem não prova nada);
 * - e o domínio (ou o www) aponta para a hospedagem.
 */
export async function verificarDominio(id: string): Promise<Resultado> {
  try {
    const { supabase, papel } = await contexto();
    // O banco também confere (gatilho site_config_regras_trg).
    if (!podeAdministrar(papel)) throw new ErroValidacao("Só administradores e gestores confirmam o domínio do site.");
    const { data } = await supabase.from("site_config").select("id, dominio").eq("id", id).maybeSingle();
    if (!data?.dominio) throw new ErroValidacao("Informe o domínio primeiro.");
    const resolvedor = new dns.Resolver({ timeout: 4000, tries: 2 });
    const consulta = async (nome: string) => {
      const [a, cname] = await Promise.all([resolvedor.resolve4(nome).catch(() => [] as string[]), resolvedor.resolveCname(nome).catch(() => [] as string[])]);
      return { a, cname };
    };
    const [raiz, www, txt] = await Promise.all([
      consulta(data.dominio),
      consulta(`www.${data.dominio}`),
      resolvedor.resolveTxt(`${NOME_TXT}.${data.dominio}`).catch(() => [] as string[][]),
    ]);
    const dono = txtConfere(txt, data.id as string);
    const aponta = dnsApontaCerto(raiz) || dnsApontaCerto(www);
    if (!dono && !aponta) throw new ErroValidacao("Ainda não achei os registros no DNS. Confira os três registros da tabela (a mudança pode levar até 24 horas).");
    if (!dono)
      throw new ErroValidacao(`Falta o registro TXT "${NOME_TXT}" com o código ${codigoTxt(data.id as string)}. Ele prova que o domínio é seu; sem ele o site não abre no domínio.`);
    if (!aponta) throw new ErroValidacao("O registro TXT está certo, mas o domínio ainda não aponta para o sistema (registros A e CNAME da tabela).");
    const { error } = await supabase.from("site_config").update({ dominio_verificado_em: new Date().toISOString() }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

/**
 * Exclui o site. O banco (gatilho site_config_regras_trg) confere o papel, guarda o
 * endereço antigo reservado para esta imobiliária, encerra hoje os anúncios abertos
 * pelo feed e faz o endereço antigo do feed responder vazio (o portal tira os anúncios).
 */
export async function excluirSite(id: string): Promise<Resultado> {
  try {
    const { supabase, papel } = await contexto();
    if (!podeAdministrar(papel)) throw new ErroValidacao("Só administradores e gestores excluem o site.");
    const { data } = await supabase.from("site_config").select("logo_path").eq("id", id).maybeSingle();
    const { error } = await supabase.from("site_config").delete().eq("id", id);
    if (error) throw error;
    if (data?.logo_path) await supabase.storage.from("site").remove([data.logo_path]);
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidatePath("/imoveis", "layout");
  return { ok: true };
}

/** Novos endereços secretos dos portais (feed e leads; os antigos param de funcionar: atualize no painel dos portais). */
export async function novoTokenPortais(id: string): Promise<Resultado> {
  try {
    const { supabase, papel } = await contexto();
    if (!podeAdministrar(papel)) throw new ErroValidacao("Só administradores e gestores trocam o endereço dos portais.");
    const { error } = await supabase
      .from("site_config")
      .update({ portais_token: crypto.randomUUID(), leads_portais_token: crypto.randomUUID() })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Imóveis no site
// ---------------------------------------------------------------------------

/** Liga/desliga o imóvel no site (caixa da lista). */
export async function salvarPublicacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const id = textoObrigatorio(fd, "id");
    const { error } = await supabase.from("imoveis").update({ publicar_site: marcado(fd, "publicar_site") }).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  revalidatePath("/imoveis", "layout");
  return { ok: "Salvo." };
}

export async function publicarDisponiveis(): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("imoveis").update({ publicar_site: true }).eq("status", "disponivel").eq("publicar_site", false);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidatePath("/imoveis", "layout");
  return { ok: true };
}

export async function tirarTodosDoSite(): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("imoveis").update({ publicar_site: false }).eq("publicar_site", true);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidatePath("/imoveis", "layout");
  return { ok: true };
}

/** Busca a posição do imóvel no mapa pelo endereço (OpenStreetMap, gratuito; 1 consulta por clique). */
export async function localizarImovel(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { data: i } = await supabase.from("imoveis").select("logradouro, numero, bairro, cidade, uf, cep").eq("id", id).maybeSingle();
    if (!i) throw new ErroValidacao("Imóvel não encontrado.");
    if (!i.cidade) throw new ErroValidacao("Preencha ao menos a cidade do imóvel.");
    const tentativas = [
      [[i.logradouro, i.numero].filter(Boolean).join(" "), i.bairro, i.cidade, i.uf],
      [i.bairro, i.cidade, i.uf],
      [i.cidade, i.uf],
    ].map((p) => p.filter(Boolean).join(", "));
    let achado: { lat: string; lon: string } | null = null;
    for (const q of [...new Set(tentativas)]) {
      const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(q)}`, {
        headers: { "User-Agent": "NovoAluguel/1.0 (sistema de administracao de imoveis)", "Accept-Language": "pt-BR" },
        signal: AbortSignal.timeout(8000),
        cache: "no-store",
      });
      if (!r.ok) break;
      const lista = (await r.json()) as { lat: string; lon: string }[];
      if (lista[0]) {
        achado = lista[0];
        break;
      }
    }
    if (!achado) throw new ErroValidacao("Não achei esse endereço no mapa. Preencha latitude e longitude no cadastro do imóvel.");
    const { error } = await supabase
      .from("imoveis")
      .update({ latitude: Number(Number(achado.lat).toFixed(7)), longitude: Number(Number(achado.lon).toFixed(7)) })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidatePath(`/imoveis/${id}`, "layout");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Lançamentos e empreendimentos no site
// ---------------------------------------------------------------------------

export async function salvarEmpreendimentoSite(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase } = await contexto();
    const id = textoObrigatorio(fd, "id");
    const d: Record<string, unknown> = {};
    if (fd.has("publicar_site")) d.publicar_site = marcado(fd, "publicar_site");
    if (fd.has("fase")) {
      const f = texto(fd, "fase");
      d.fase = f && ["lancamento", "em_obras", "pronto"].includes(f) ? f : null;
    }
    if (fd.has("previsao_entrega")) d.previsao_entrega = texto(fd, "previsao_entrega");
    if (fd.has("descricao_site")) d.descricao_site = texto(fd, "descricao_site")?.slice(0, 4000) ?? null;
    for (const c of ["video_url", "tour_url"]) {
      if (!fd.has(c)) continue;
      const v = texto(fd, c);
      if (v && !/^https:\/\//i.test(v)) throw new ErroValidacao("Use um link que comece com https://");
      d[c] = v;
    }
    const { error } = await supabase.from("empreendimentos").update(d).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  revalidatePath("/empreendimentos", "layout");
  return { ok: "Salvo." };
}

// ---------------------------------------------------------------------------
// Portais
// ---------------------------------------------------------------------------

/** Configuração de um portal (cria na primeira vez; depois salva sozinha). */
export async function salvarPortal(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await contexto();
    const portal = textoObrigatorio(fd, "portal");
    if (!ehPortal(portal)) throw new ErroValidacao("Portal desconhecido.");
    const d: Record<string, unknown> = { organizacao_id: organizacao.id, portal };
    if (fd.has("ativo")) d.ativo = marcado(fd, "ativo");
    if (fd.has("publicar_todos")) d.publicar_todos = marcado(fd, "publicar_todos");
    if (fd.has("codigo_anunciante")) d.codigo_anunciante = texto(fd, "codigo_anunciante")?.slice(0, 80) ?? null;
    if (fd.has("observacoes")) d.observacoes = texto(fd, "observacoes")?.slice(0, 1000) ?? null;
    for (const c of ["limite_anuncios", "limite_destaques"]) {
      if (!fd.has(c)) continue;
      const n = inteiro(fd, c);
      if (n !== null && n < 0) throw new ErroValidacao("O limite não pode ser negativo.");
      d[c] = n;
    }
    const { error } = await supabase.from("site_portais").upsert(d, { onConflict: "organizacao_id,portal" });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

/**
 * Desliga o portal. O feed continua respondendo, VAZIO (o portal tira os anúncios);
 * o banco (gatilho site_portais_desligar_trg) apaga as escolhas por imóvel desse
 * portal e encerra hoje os anúncios abertos pelo feed (aba Histórico do imóvel).
 */
export async function excluirPortal(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("site_portais").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  revalidatePath("/imoveis", "layout");
  return { ok: true };
}

/**
 * Escolha por imóvel × portal: automático (segue o site), não publicar, normal,
 * destaque ou super destaque, e o código do anúncio no portal.
 */
export async function salvarPortalImovel(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  try {
    const { supabase, organizacao } = await contexto();
    const imovel_id = textoObrigatorio(fd, "imovel_id");
    // Só imóvel da própria imobiliária (o banco também confere).
    const { data: imovel } = await supabase.from("imoveis").select("id").eq("id", imovel_id).eq("organizacao_id", organizacao.id).maybeSingle();
    if (!imovel) throw new ErroValidacao("Imóvel não encontrado.");
    const linhas = LISTA_PORTAIS.filter((p) => fd.has(`modo_${p}`)).map((p) => {
      const modo = texto(fd, `modo_${p}`) ?? "auto";
      return {
        organizacao_id: organizacao.id,
        imovel_id,
        portal: p,
        publicado: modo === "auto" ? null : modo !== "nao",
        destaque: modo === "destaque" || modo === "super_destaque" ? modo : "normal",
        codigo_portal: texto(fd, `codigo_${p}`)?.slice(0, 80) ?? null,
      };
    });
    if (!linhas.length) return { ok: "Salvo." };
    const { error } = await supabase.from("portal_imoveis").upsert(linhas, { onConflict: "imovel_id,portal" });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidar();
  return { ok: "Salvo." };
}

/**
 * Gera o feed agora (como o portal faria) e confere as falhas. Fica registrado como
 * conferência: NÃO conta como envio (só o portal buscando marca "enviado" e abre o
 * anúncio na aba Histórico do imóvel).
 */
export async function conferirPortal(portal: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    if (!ehPortal(portal)) throw new ErroValidacao("Portal desconhecido.");
    const { data: cfg } = await supabase.from("site_config").select("portais_token").maybeSingle();
    if (!cfg) throw new ErroValidacao("Crie o site primeiro (aba Configuração).");
    const feed = await montarFeed(supabase, cfg.portais_token as string, portal, { origem: await origemAtual(), registro: "manual", agente: "Conferido no sistema" });
    if (!feed || !feed.configurado) throw new ErroValidacao("Configure este portal primeiro.");
    if (!feed.registrado) throw new ErroValidacao("Muitas conferências na última hora. Tente de novo mais tarde.");
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Contatos recebidos
// ---------------------------------------------------------------------------

export async function excluirSolicitacao(id: string): Promise<Resultado> {
  try {
    const { supabase } = await contexto();
    const { error } = await supabase.from("site_solicitacoes").delete().eq("id", id);
    if (error) throw error;
  } catch (e) {
    return falha(e);
  }
  revalidar();
  return { ok: true };
}
