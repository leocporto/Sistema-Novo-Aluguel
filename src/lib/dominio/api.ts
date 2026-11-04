/**
 * Especificação da API REST v1 (OpenAPI 3.1) num objeto só: daqui saem o
 * /api/v1/openapi.json, a lista de filtros aceitos por recurso (as rotas só
 * repassam ao banco o que está aqui) e a página de documentação.
 * As regras de verdade (escopo, modo, limite, organização) ficam no banco:
 * public.api_v1_listar / api_v1_obter / api_v1_criar_lead / api_v1_webhook_teste.
 */
import { EVENTOS_WEBHOOK, LIMITE_HORA_CHAVE, LIMITE_PAGINA_API, type RecursoApi } from "./integracoes";

type Filtro = { nome: string; descricao: string; tipo: "string" | "integer"; formato?: "uuid" | "date"; valores?: readonly string[] };

const STATUS_IMOVEL = ["disponivel", "alugado", "vendido", "reservado", "inativo"] as const;
const STATUS_CONTRATO = ["rascunho", "ativo", "encerrado", "rescindido"] as const;
const STATUS_FATURA = ["aberta", "paga", "cancelada", "renegociada"] as const;
const STATUS_LEAD = ["novo", "em_atendimento", "visita", "proposta", "ganho", "perdido"] as const;

/** Filtros aceitos em GET /<recurso> (todos opcionais; o banco confere de novo). */
export const FILTROS_API: Record<RecursoApi, Filtro[]> = {
  imoveis: [
    { nome: "status", descricao: "Situação do imóvel.", tipo: "string", valores: STATUS_IMOVEL },
    { nome: "finalidade", descricao: "locacao ou venda.", tipo: "string", valores: ["locacao", "venda"] },
    { nome: "codigo", descricao: "Código do imóvel (exato).", tipo: "string" },
    { nome: "cidade", descricao: "Cidade (exata, sem diferenciar maiúsculas).", tipo: "string" },
    { nome: "bairro", descricao: "Bairro (exato, sem diferenciar maiúsculas).", tipo: "string" },
    { nome: "publicado", descricao: "true = só os publicados no site.", tipo: "string", valores: ["true", "false"] },
  ],
  pessoas: [
    { nome: "papel", descricao: "proprietario, locatario, fiador…", tipo: "string" },
    { nome: "documento", descricao: "CPF/CNPJ (só números) para achar uma pessoa que você já conhece. O documento não volta na resposta.", tipo: "string" },
    { nome: "busca", descricao: "Parte do nome.", tipo: "string" },
  ],
  contratos: [
    { nome: "status", descricao: "Situação do contrato.", tipo: "string", valores: STATUS_CONTRATO },
    { nome: "imovel_id", descricao: "Contratos de um imóvel.", tipo: "string", formato: "uuid" },
  ],
  faturas: [
    { nome: "status", descricao: "Situação da cobrança.", tipo: "string", valores: STATUS_FATURA },
    { nome: "contrato_id", descricao: "Cobranças de um contrato.", tipo: "string", formato: "uuid" },
    { nome: "vencimento_de", descricao: "Vencimento a partir de (AAAA-MM-DD).", tipo: "string", formato: "date" },
    { nome: "vencimento_ate", descricao: "Vencimento até (AAAA-MM-DD).", tipo: "string", formato: "date" },
  ],
  leads: [
    { nome: "status", descricao: "Etapa do lead.", tipo: "string", valores: STATUS_LEAD },
    { nome: "funil", descricao: "locacao, venda ou captacao.", tipo: "string", valores: ["locacao", "venda", "captacao"] },
    { nome: "origem", descricao: "Origem (site, whatsapp, portal…).", tipo: "string" },
    { nome: "desde", descricao: "Criados a partir de (AAAA-MM-DD).", tipo: "string", formato: "date" },
  ],
};

/** Só os filtros conhecidos, cortados em 200 caracteres (o resto é ignorado). */
export function filtrosDaConsulta(recurso: RecursoApi, sp: URLSearchParams): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of FILTROS_API[recurso]) {
    const v = sp.get(f.nome);
    if (v !== null && v.trim() !== "") out[f.nome] = v.trim().slice(0, 200);
  }
  return out;
}

const ref = (n: string) => ({ $ref: `#/components/schemas/${n}` });
const str = (descricao?: string, extra: Record<string, unknown> = {}) => ({ type: "string", ...(descricao ? { description: descricao } : {}), ...extra });
const nul = (t: Record<string, unknown>) => ({ ...t, type: [t.type as string, "null"] });
const num = (descricao?: string) => ({ type: "number", ...(descricao ? { description: descricao } : {}) });
const int = (descricao?: string) => ({ type: "integer", ...(descricao ? { description: descricao } : {}) });
const uuid = { type: "string", format: "uuid" };
const data = { type: "string", format: "date" };
const dataHora = { type: "string", format: "date-time" };

const erros = (...codigos: number[]) =>
  Object.fromEntries(
    codigos.map((c) => [
      String(c),
      {
        description:
          { 400: "Requisição inválida", 401: "Chave ausente, inválida, expirada ou revogada", 403: "A chave não tem o escopo (ou o recurso não existe no modo da conta)", 404: "Não encontrado", 422: "Dados inválidos", 429: "Limite de chamadas atingido (veja Retry-After)" }[c] ?? "Erro",
        content: { "application/json": { schema: ref("Erro") } },
      },
    ]),
  );

function listar(recurso: RecursoApi, schema: string, escopo: string, resumo: string) {
  return {
    get: {
      tags: [recurso],
      summary: resumo,
      description: `Escopo: \`${escopo}\`. Mais novos primeiro; até ${LIMITE_PAGINA_API} por página. Use \`proximo_cursor\` para a página seguinte.`,
      parameters: [
        { $ref: "#/components/parameters/limite" },
        { $ref: "#/components/parameters/cursor" },
        ...FILTROS_API[recurso].map((f) => ({
          name: f.nome,
          in: "query",
          required: false,
          description: f.descricao,
          schema: { type: f.tipo, ...(f.formato ? { format: f.formato } : {}), ...(f.valores ? { enum: [...f.valores] } : {}) },
        })),
      ],
      responses: {
        200: {
          description: "Página da lista",
          content: {
            "application/json": {
              schema: { type: "object", required: ["dados", "proximo_cursor"], properties: { dados: { type: "array", items: ref(schema) }, proximo_cursor: nul(str("Cursor da próxima página (null = acabou)")) } },
            },
          },
        },
        ...erros(401, 403, 422, 429),
      },
    },
  };
}

function obter(recurso: RecursoApi, schema: string, escopo: string, resumo: string) {
  return {
    get: {
      tags: [recurso],
      summary: resumo,
      description: `Escopo: \`${escopo}\`.`,
      parameters: [{ name: "id", in: "path", required: true, schema: uuid }],
      responses: {
        200: { description: "Registro", content: { "application/json": { schema: { type: "object", properties: { dados: ref(schema) } } } } },
        ...erros(401, 403, 404, 429),
      },
    },
  };
}

/** A especificação (servers é trocado pelo endereço real ao servir). */
export const ESPECIFICACAO_API = {
  openapi: "3.1.0",
  info: {
    title: "API do Novo Aluguel",
    version: "1.0.0",
    description:
      "API REST para ler imóveis, pessoas, contratos e cobranças e para mandar leads ao Novo Aluguel. Autenticação por chave de API (no sistema: tela Integrações e API › Chaves de API, também aberta pelo botão em Configurações) no cabeçalho `Authorization: Bearer <chave>`. " +
      `Cada chave vê só os dados da própria conta e só os recursos dos escopos marcados. Limite: ${LIMITE_HORA_CHAVE} chamadas por hora por chave (resposta 429 com Retry-After). ` +
      "Erros sempre em JSON: `{ \"erro\": { \"codigo\": \"…\", \"mensagem\": \"…\" } }`. Leads só existem no modo imobiliária.",
  },
  servers: [{ url: "/api/v1" }],
  security: [{ chave: [] }],
  tags: [
    { name: "imoveis", description: "Imóveis (escopo imoveis:leitura)" },
    { name: "pessoas", description: "Pessoas — sem CPF/CNPJ, dados bancários e documentos (escopo pessoas:leitura)" },
    { name: "contratos", description: "Contratos de locação com as partes (escopo contratos:leitura)" },
    { name: "faturas", description: "Cobranças de aluguel (escopo faturas:leitura)" },
    { name: "leads", description: "Leads do Comercial — só imobiliária (leads:leitura / leads:escrita)" },
    { name: "webhooks", description: "Teste dos webhooks (webhooks:escrita)" },
  ],
  paths: {
    "/imoveis": listar("imoveis", "Imovel", "imoveis:leitura", "Listar imóveis"),
    "/imoveis/{id}": obter("imoveis", "Imovel", "imoveis:leitura", "Um imóvel"),
    "/pessoas": listar("pessoas", "Pessoa", "pessoas:leitura", "Listar pessoas"),
    "/pessoas/{id}": obter("pessoas", "Pessoa", "pessoas:leitura", "Uma pessoa"),
    "/contratos": listar("contratos", "Contrato", "contratos:leitura", "Listar contratos"),
    "/contratos/{id}": obter("contratos", "Contrato", "contratos:leitura", "Um contrato (com as partes)"),
    "/faturas": listar("faturas", "Fatura", "faturas:leitura", "Listar cobranças"),
    "/faturas/{id}": obter("faturas", "Fatura", "faturas:leitura", "Uma cobrança (com os itens)"),
    "/leads": {
      ...listar("leads", "Lead", "leads:leitura", "Listar leads"),
      post: {
        tags: ["leads"],
        summary: "Criar lead",
        description:
          "Escopo: `leads:escrita`. Segue a mesma regra do formulário de captação da conta: contato repetido (mesmo telefone/e-mail) vira mensagem no lead que já existe, distribuição por rodízio/fila e origem (UTM). " +
          "A resposta traz o `id` só se a chave também tiver `leads:leitura`.",
        requestBody: { required: true, content: { "application/json": { schema: ref("NovoLead") } } },
        responses: {
          201: { description: "Recebido", content: { "application/json": { schema: { type: "object", properties: { ok: { type: "boolean" }, id: uuid } } } } },
          ...erros(400, 401, 403, 422, 429),
        },
      },
    },
    "/leads/{id}": obter("leads", "Lead", "leads:leitura", "Um lead"),
    "/webhooks/teste": {
      post: {
        tags: ["webhooks"],
        summary: "Disparar um evento de teste",
        description: "Escopo: `webhooks:escrita`. Põe na fila um evento `webhook.teste` para cada webhook ativo (ou só para `assinatura_id`).",
        requestBody: { required: false, content: { "application/json": { schema: { type: "object", properties: { assinatura_id: uuid } } } } },
        responses: {
          202: { description: "Na fila", content: { "application/json": { schema: { type: "object", properties: { enfileiradas: { type: "integer" } } } } } },
          ...erros(401, 403, 404, 429),
        },
      },
    },
  },
  webhooks: Object.fromEntries(
    EVENTOS_WEBHOOK.map((e) => [
      e.id,
      {
        post: {
          summary: e.rotulo,
          description:
            "Corpo assinado com HMAC-SHA256 do segredo do webhook: cabeçalho `X-NovoAluguel-Assinatura: sha256=<hex>`. Também vêm `X-NovoAluguel-Evento` e `X-NovoAluguel-Entrega` (id, use para não processar duas vezes). Responda 2xx em até 10 s.",
          requestBody: { content: { "application/json": { schema: ref("EventoWebhook") } } },
          responses: { 200: { description: "Recebido" } },
        },
      },
    ]),
  ),
  components: {
    securitySchemes: { chave: { type: "http", scheme: "bearer", description: "Chave de API no formato na_xxxxxxxxxx_…" } },
    parameters: {
      limite: { name: "limite", in: "query", required: false, description: `Itens por página (1 a ${LIMITE_PAGINA_API}, padrão 50).`, schema: { type: "integer", minimum: 1, maximum: LIMITE_PAGINA_API } },
      cursor: { name: "cursor", in: "query", required: false, description: "Valor de proximo_cursor da página anterior.", schema: { type: "string" } },
    },
    schemas: {
      Erro: {
        type: "object",
        required: ["erro"],
        properties: {
          erro: {
            type: "object",
            properties: {
              codigo: str("nao_autorizado, sem_permissao, nao_encontrado, dados_invalidos, nao_processado, limite_excedido, requisicao_invalida, erro_interno"),
              mensagem: str("Explicação em português"),
            },
          },
        },
      },
      Imovel: {
        type: "object",
        properties: {
          id: uuid,
          codigo: nul(str()),
          tipo: str(),
          status: str(undefined, { enum: [...STATUS_IMOVEL] }),
          finalidades: { type: "array", items: str() },
          titulo: nul(str()),
          descricao: nul(str()),
          cep: nul(str()),
          logradouro: nul(str()),
          numero: nul(str()),
          complemento: nul(str()),
          bairro: nul(str()),
          cidade: nul(str()),
          uf: nul(str()),
          latitude: nul(num()),
          longitude: nul(num()),
          area_util: nul(num()),
          area_total: nul(num()),
          quartos: nul(int()),
          suites: nul(int()),
          banheiros: nul(int()),
          vagas: nul(int()),
          valor_aluguel: nul(num()),
          valor_venda: nul(num()),
          valor_condominio: nul(num()),
          valor_iptu: nul(num("IPTU por mês")),
          caracteristicas: { type: "array", items: str() },
          comodidades: { type: "array", items: str() },
          publicar_site: { type: "boolean" },
          criado_em: dataHora,
        },
      },
      Pessoa: {
        type: "object",
        properties: {
          id: uuid,
          tipo_pessoa: str(undefined, { enum: ["PF", "PJ"] }),
          nome: str(),
          email: nul(str()),
          telefone: nul(str()),
          papeis: { type: "array", items: str() },
          cidade: nul(str()),
          uf: nul(str()),
          criado_em: dataHora,
        },
      },
      Contrato: {
        type: "object",
        properties: {
          id: uuid,
          numero: int(),
          codigo: nul(str()),
          imovel_id: uuid,
          status: str(undefined, { enum: [...STATUS_CONTRATO] }),
          finalidade: str(),
          data_inicio: data,
          data_fim: nul(data),
          prazo_meses: int(),
          valor_aluguel: num(),
          dia_vencimento: int(),
          indice_reajuste: str(),
          garantia_tipo: str(),
          data_rescisao: nul(data),
          partes: { type: "array", items: { type: "object", properties: { pessoa_id: uuid, papel: str(undefined, { enum: ["locatario", "fiador", "proprietario"] }), percentual: nul(num()) } } },
          criado_em: dataHora,
        },
      },
      Fatura: {
        type: "object",
        properties: {
          id: uuid,
          numero: int(),
          contrato_id: uuid,
          competencia: data,
          vencimento: data,
          valor_total: num(),
          valor_abatido: num("Já recebido em pagamentos parciais"),
          status: str(undefined, { enum: [...STATUS_FATURA] }),
          pago_em: nul(data),
          valor_pago: nul(num()),
          pix_copia_cola: nul(str()),
          linha_digitavel: nul(str()),
          itens: { type: "array", description: "Só em GET /faturas/{id}", items: { type: "object", properties: { descricao: str(), tipo: str(), valor: num() } } },
          criado_em: dataHora,
        },
      },
      Lead: {
        type: "object",
        properties: {
          id: uuid,
          nome: str(),
          telefone: nul(str()),
          email: nul(str()),
          origem: str(),
          funil: str(),
          interesse: str(),
          status: str(undefined, { enum: [...STATUS_LEAD] }),
          prioridade: str(),
          imovel_id: nul(uuid),
          corretor_id: nul(uuid),
          utm_source: nul(str()),
          utm_medium: nul(str()),
          utm_campaign: nul(str()),
          criado_em: dataHora,
        },
      },
      NovoLead: {
        type: "object",
        required: ["nome"],
        properties: {
          nome: str("Obrigatório"),
          telefone: str("Telefone ou e-mail: pelo menos um"),
          email: str(),
          mensagem: str(),
          origem: str("site, whatsapp, instagram, facebook, portal, zap, vivareal, olx, indicacao, outro…"),
          funil: str("locacao (padrão), venda ou captacao"),
          imovel: str("Código do imóvel de interesse"),
          utm_source: str(),
          utm_medium: str(),
          utm_campaign: str(),
          utm_content: str(),
          utm_term: str(),
          gclid: str(),
          fbclid: str(),
        },
      },
      EventoWebhook: {
        type: "object",
        properties: {
          id: { ...uuid, description: "Id da entrega (o mesmo de X-NovoAluguel-Entrega)" },
          evento: str(undefined, { enum: [...EVENTOS_WEBHOOK.map((e) => e.id), "webhook.teste"] }),
          criado_em: dataHora,
          enviado_em: dataHora,
          tentativa: int(),
          dados: { type: "object", description: "Ids e campos principais do registro. Para os detalhes, consulte a API com a sua chave." },
        },
      },
    },
  },
};

/** Especificação com o endereço real do servidor. */
export function especificacaoCom(base: string) {
  return { ...ESPECIFICACAO_API, servers: [{ url: `${base.replace(/\/$/, "")}/api/v1`, description: "Este sistema" }] };
}
