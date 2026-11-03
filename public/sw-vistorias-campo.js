/*
 * Service worker do app de campo das vistorias (só vale em /vistorias/campo).
 *
 * Guarda no celular uma cópia das telas do app de campo e dos arquivos de que
 * elas precisam (scripts, estilos, fontes). Assim a tela abre e recarrega
 * mesmo sem internet. Com internet, sempre busca a versão nova primeiro
 * (a cópia só é usada quando a rede falha ou demora demais).
 *
 * As alterações feitas sem internet NÃO ficam aqui: ficam na fila do aparelho
 * (IndexedDB) e sobem pela própria tela quando a internet volta.
 */
const CACHE = "vistorias-campo-v1";
const ESPERA_REDE_MS = 6000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const nomes = await caches.keys();
      await Promise.all(nomes.filter((n) => n.startsWith("vistorias-campo-") && n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

const mesmaOrigem = (url) => {
  try {
    return new URL(url, self.location.origin).origin === self.location.origin;
  } catch {
    return false;
  }
};

// Só respostas normais do próprio site (nunca um redirecionamento, ex.: para o login).
const podeGuardar = (res) => res && res.ok && res.type === "basic" && !res.redirected;

function paginaSemInternet() {
  const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sem internet</title>
<style>body{font-family:system-ui,sans-serif;background:#0d1117;color:#e6edf3;margin:0;padding:32px 16px}main{max-width:480px;margin:0 auto}a{color:#5a98ff}p{color:#9ba8b8;line-height:1.5}</style></head>
<body><main><h1>Sem internet</h1><p>Esta tela do app de campo ainda não foi guardada neste celular. Abra a vistoria uma vez com internet antes de ir ao imóvel: depois ela abre mesmo sem sinal.</p>
<p><a href="/vistorias/campo">Voltar para as vistorias em campo</a></p></main></body></html>`;
  return new Response(html, { status: 503, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

async function redePrimeiro(req, navegacao) {
  const cache = await caches.open(CACHE);
  const daRede = fetch(req).then(async (res) => {
    if (podeGuardar(res)) await cache.put(req, res.clone());
    // Sessão expirou ou saiu do sistema (redirecionou para o login): apaga as cópias.
    else if (navegacao && res.type === "opaqueredirect") await caches.delete(CACHE);
    return res;
  });
  const guardado = () => cache.match(req, { ignoreVary: true });
  if (!navegacao) return daRede.catch(async () => (await guardado()) || Response.error());

  // Tela: se a rede falhar ou demorar (sinal fraco), usa a cópia guardada.
  const tempo = new Promise((ok) => setTimeout(() => ok("tempo"), ESPERA_REDE_MS));
  const primeiro = await Promise.race([daRede.catch(() => "falhou"), tempo]);
  if (primeiro instanceof Response) return primeiro;
  const copia = await guardado();
  if (copia) return copia;
  if (primeiro === "tempo") {
    try {
      return await daRede;
    } catch {
      /* cai na página de sem internet */
    }
  }
  return paginaSemInternet();
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  // Gravações (Server Actions), envio de fotos e outros sites passam direto.
  if (req.method !== "GET" || !mesmaOrigem(req.url)) return;
  e.respondWith(redePrimeiro(req, req.mode === "navigate"));
});

/** A tela pede para guardar ela mesma e os arquivos que já carregou (e outras telas do app de campo). */
async function guardar(urls) {
  const cache = await caches.open(CACHE);
  const feitos = new Set();
  const buscar = async (url) => {
    if (!mesmaOrigem(url) || feitos.has(url)) return;
    feitos.add(url);
    try {
      // Scripts e estilos têm nome único por versão: se já estão guardados, não baixa de novo.
      if (url.includes("/_next/static/") && (await cache.match(url))) return;
      const res = await fetch(url, { credentials: "same-origin" });
      if (!podeGuardar(res)) return;
      const tipo = res.headers.get("Content-Type") || "";
      if (tipo.includes("text/html")) {
        const html = await res.text();
        const cab = new Headers(res.headers);
        cab.delete("Content-Encoding");
        cab.delete("Content-Length");
        await cache.put(url, new Response(html, { status: res.status, statusText: res.statusText, headers: cab }));
        // Scripts e estilos que essa tela usa.
        const estaticos = html.match(/\/_next\/static\/[^"'\s)\\]+/g) || [];
        await Promise.all([...new Set(estaticos)].map((u) => buscar(u)));
      } else await cache.put(url, res);
    } catch {
      /* sem internet agora: guarda na próxima vez */
    }
  };
  await Promise.all(urls.map((u) => buscar(new URL(u, self.location.origin).href)));
}

self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.tipo === "guardar" && Array.isArray(d.urls)) e.waitUntil(guardar(d.urls.slice(0, 300)));
  else if (d.tipo === "limpar") e.waitUntil(caches.delete(CACHE));
});
