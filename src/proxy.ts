import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { supabaseConfig } from "@/lib/supabase/config";
import { reescreverDominioProprio } from "@/lib/servicos/site-dominio";

const ROTAS_PUBLICAS = ["/login", "/l", "/api/leads", "/api/agenda", "/assinar", "/pagar", "/contestar", "/chamado", "/ficha", "/s", "/api/portais", "/lp", "/pesquisa", "/preferencias", "/api/marketing", "/portal", "/api/v1"];

/**
 * Renova a sessão do Supabase a cada requisição e redireciona visitantes não
 * autenticados para /login.
 */
export async function proxy(request: NextRequest) {
  // Domínio próprio de imobiliária → site público dela (/s/<slug>), sem login.
  const site = await reescreverDominioProprio(request);
  if (site) return site;
  // Nos endereços do sistema, ninguém de fora manda este cabeçalho.
  request.headers.delete("x-site-dominio");

  let response = NextResponse.next({ request });
  const { url, key } = supabaseConfig();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(lista) {
        for (const { name, value } of lista) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of lista) response.cookies.set(name, value, options);
      },
    },
  });

  const { data } = await supabase.auth.getClaims();
  const logado = Boolean(data?.claims?.sub);
  const caminho = request.nextUrl.pathname;
  const publica = ROTAS_PUBLICAS.some((r) => caminho === r || caminho.startsWith(`${r}/`));

  if (!logado && !publica) {
    const destino = request.nextUrl.clone();
    destino.pathname = "/login";
    destino.search = "";
    return NextResponse.redirect(destino);
  }
  if (logado && caminho === "/login") {
    const destino = request.nextUrl.clone();
    destino.pathname = "/";
    destino.search = "";
    return NextResponse.redirect(destino);
  }
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
