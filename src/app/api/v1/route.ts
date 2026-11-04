/** GET /api/v1 — ponto de partida: versão e onde está a documentação. */
export function GET() {
  return Response.json(
    { api: "Novo Aluguel", versao: "1.0.0", especificacao: "/api/v1/openapi.json", recursos: ["imoveis", "pessoas", "contratos", "faturas", "leads"] },
    { headers: { "Cache-Control": "public, max-age=300" } },
  );
}
