import "server-only";

/*
 * Localização pelo endereço com o Nominatim (OpenStreetMap): gratuito e sem
 * chave, com as regras de uso deles — identificação do sistema no User-Agent e
 * no máximo 1 consulta por segundo (fila por instância do servidor).
 */

const AGENTE = "NovoAluguel/1.0 (sistema de administracao de imoveis)";
let proximaVez = 0;

async function esperarVez(): Promise<void> {
  const agora = Date.now();
  const minha = Math.max(agora, proximaVez);
  proximaVez = minha + 1100;
  if (minha > agora) await new Promise((r) => setTimeout(r, minha - agora));
}

export type EnderecoGeo = { logradouro: string | null; numero: string | null; bairro: string | null; cidade: string | null; uf: string | null; cep?: string | null };

/** Consultas, da mais precisa para a menos (sem cair no "centro da cidade": isso erraria o mapa). */
export function consultasDoEndereco(e: EnderecoGeo): string[] {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(" ");
  const q = [
    [rua, e.bairro, e.cidade, e.uf],
    [e.logradouro, e.cidade, e.uf],
  ].map((p) => p.filter(Boolean).join(", "));
  return [...new Set(q)].filter((x) => e.logradouro && e.cidade && x);
}

/** Uma consulta (respeitando 1/s). null = não achou; lança em erro de rede. */
export async function buscarPosicao(consulta: string): Promise<{ lat: number; lon: number } | null> {
  await esperarVez();
  const r = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=br&q=${encodeURIComponent(consulta)}`, {
    headers: { "User-Agent": AGENTE, "Accept-Language": "pt-BR" },
    signal: AbortSignal.timeout(8000),
    cache: "no-store",
  });
  if (!r.ok) throw new Error(`OpenStreetMap respondeu ${r.status}`);
  const lista = (await r.json()) as { lat: string; lon: string }[];
  if (!lista[0]) return null;
  const lat = Number(Number(lista[0].lat).toFixed(7));
  const lon = Number(Number(lista[0].lon).toFixed(7));
  return Number.isFinite(lat) && Number.isFinite(lon) ? { lat, lon } : null;
}
