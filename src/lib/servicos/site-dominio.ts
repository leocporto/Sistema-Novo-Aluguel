import { promises as dns } from "node:dns";
import { createClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { NOME_TXT, caminhoNoSite, dominioDoHost, txtConfere } from "@/lib/dominio/site";
import { supabaseConfig } from "@/lib/supabase/config";

/*
 * Domínio próprio do site imobiliário (usado pelo src/proxy.ts).
 *
 * Quem abre https://minhaimobiliaria.com.br/imovel/AP-1 vê a página
 * /s/<slug>/imovel/AP-1, com o cabeçalho x-site-dominio para os links do site
 * saírem sem o "/s/<slug>" (veja enderecosDoSite em ./site.ts).
 *
 * Segurança: o banco devolve os sites que dizem ser donos do domínio
 * (site_dominio_candidatos, só os já verificados) e aqui conferimos no DNS qual
 * deles tem o registro TXT "_novoaluguel.<domínio>" = "novoaluguel-site=<id>".
 * Marcar "verificado" à mão no banco não basta: sem o TXT o site não abre.
 *
 * Ponto de integração (src/proxy.ts), ANTES da checagem de login:
 *   const site = await reescreverDominioProprio(request);
 *   if (site) return site;
 * Em produção: HOSTS_DO_SISTEMA="app.novoaluguel.com.br" (separados por vírgula)
 * — o proxy nem consulta o banco nos endereços do próprio sistema e qualquer outro
 * domínio sem site confirmado recebe 404 (veja reescreverDominioProprio).
 */

type Guardado = { slug: string | null; ate: number };
const memoria = new Map<string, Guardado>();
const ACHOU_MS = 10 * 60_000;
const NAO_ACHOU_MS = 2 * 60_000;

async function registrosTxt(nome: string): Promise<string[][]> {
  const resolvedor = new dns.Resolver({ timeout: 2500, tries: 1 });
  return resolvedor.resolveTxt(nome).catch(() => []);
}

/** Slug do site que é dono deste domínio (null se nenhum). Guarda a resposta por alguns minutos. */
export async function slugDoDominio(dominio: string): Promise<string | null> {
  const agora = Date.now();
  const guardado = memoria.get(dominio);
  if (guardado && guardado.ate > agora) return guardado.slug;
  let slug: string | null = null;
  try {
    const { url, key } = supabaseConfig();
    const cliente = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data } = await cliente.rpc("site_dominio_candidatos", { p_dominio: dominio });
    const candidatos = (data as { slug: string; id: string }[] | null) ?? [];
    if (candidatos.length) {
      const txt = await registrosTxt(`${NOME_TXT}.${dominio}`);
      slug = candidatos.find((c) => txtConfere(txt, c.id))?.slug ?? null;
    }
  } catch {
    slug = null;
  }
  if (memoria.size > 500) memoria.clear();
  memoria.set(dominio, { slug, ate: agora + (slug ? ACHOU_MS : NAO_ACHOU_MS) });
  return slug;
}

/**
 * Se a requisição veio por um domínio próprio de imobiliária, devolve a
 * reescrita para o site público dela; senão devolve null (segue o fluxo normal).
 *
 * Com HOSTS_DO_SISTEMA configurado, um domínio que não é do sistema e não tem
 * site confirmado (TXT ausente, site fora do ar, conta no modo pessoal) recebe
 * 404 — nunca o sistema (login, telas logadas) num domínio que a imobiliária
 * controla: quem entrasse por ali deixaria os cookies da sessão nesse domínio.
 * Sem HOSTS_DO_SISTEMA não dá para separar o endereço do sistema de um domínio
 * de imobiliária, então segue como antes (configure-o em produção).
 */
export async function reescreverDominioProprio(request: NextRequest): Promise<NextResponse | null> {
  const host = request.headers.get("host");
  const extras = (process.env.HOSTS_DO_SISTEMA ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const dominio = dominioDoHost(host, extras);
  if (!dominio || !host) return null;
  const slug = await slugDoDominio(dominio);
  if (!slug) return extras.length ? new NextResponse("Site não encontrado", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } }) : null;
  const caminho = caminhoNoSite(request.nextUrl.pathname, slug);
  if (!caminho) return null;
  const destino = request.nextUrl.clone();
  destino.pathname = caminho;
  const cabecalhos = new Headers(request.headers);
  cabecalhos.set("x-site-dominio", host.toLowerCase().replace(/:\d+$/, ""));
  return NextResponse.rewrite(destino, { request: { headers: cabecalhos } });
}
