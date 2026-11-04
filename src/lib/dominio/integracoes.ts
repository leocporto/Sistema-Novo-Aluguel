/**
 * Regras puras das integrações externas e da API (nos dois modos; o que é de
 * imobiliária — portais, anúncios, repasses, leads — some no pessoal):
 * catálogo de integrações e status, escopos das chaves de API, eventos de
 * webhook (espelho de privado.webhook_eventos — mude os dois juntos), espera
 * entre tentativas (espelho de privado.webhook_atraso_min), bloqueio de
 * destinos internos (SSRF), exportação contábil com de-para e o assistente de
 * importação de contratos.
 * Dinheiro em centavos por dentro (dinheiro.ts); datas ISO (datas.ts).
 */
import type { ModoUso } from "../modos";
import { paraCentavos, paraReais } from "./dinheiro";
import { somenteDigitos, validarCNPJ, validarCPF } from "./documentos";
import { paraCSV } from "./financeiro";
import { normalizar, numeroBR } from "./imoveis";

// ---------------------------------------------------------------------------
// Catálogo
// ---------------------------------------------------------------------------

export type CategoriaIntegracao =
  | "api"
  | "bancos"
  | "pagamentos"
  | "assinatura"
  | "mensagens"
  | "email"
  | "agenda"
  | "portais"
  | "anuncios"
  | "cadastral"
  | "seguro"
  | "contabil"
  | "fiscal"
  | "mapas"
  | "armazenamento"
  | "importacao";

export const CATEGORIAS_INTEGRACAO: { id: CategoriaIntegracao; rotulo: string; soImobiliaria?: boolean }[] = [
  { id: "api", rotulo: "API, webhooks e automação" },
  { id: "bancos", rotulo: "Bancos, Pix e boletos" },
  { id: "pagamentos", rotulo: "Gateways de pagamento" },
  { id: "assinatura", rotulo: "Assinatura eletrônica" },
  { id: "mensagens", rotulo: "WhatsApp e mensagens" },
  { id: "email", rotulo: "Envio de e-mail" },
  { id: "agenda", rotulo: "Google Agenda, Outlook e Apple" },
  { id: "portais", rotulo: "Portais imobiliários", soImobiliaria: true },
  { id: "anuncios", rotulo: "Plataformas de anúncios", soImobiliaria: true },
  { id: "cadastral", rotulo: "Consulta cadastral" },
  { id: "seguro", rotulo: "Seguro-fiança e garantidoras" },
  { id: "contabil", rotulo: "Sistemas contábeis" },
  { id: "fiscal", rotulo: "Emissão fiscal" },
  { id: "mapas", rotulo: "Mapas e localização" },
  { id: "armazenamento", rotulo: "Armazenamento de documentos" },
  { id: "importacao", rotulo: "Importar de outro sistema" },
];

export type CampoProvedor = {
  nome: string;
  rotulo: string;
  tipo: "texto" | "segredo" | "selecao";
  opcoes?: { valor: string; rotulo: string }[];
  dica?: string;
  obrigatorio?: boolean;
};

/**
 * - "interno": já funciona dentro do sistema (leva para a tela existente);
 * - "provedor": depende de conta/contrato com uma empresa de fora. `testavel`
 *   = o botão "Testar conexão" faz uma chamada real (as demais só guardam a
 *   configuração: estrutura pronta, falta o contrato/credencial).
 */
export type ItemCatalogo = {
  id: string;
  nome: string;
  categoria: CategoriaIntegracao;
  descricao: string;
  tipo: "interno" | "provedor";
  href?: string;
  /** Tela existente no modo pessoal (quando a da imobiliária não existe lá). */
  hrefPessoal?: string;
  soImobiliaria?: boolean;
  testavel?: boolean;
  campos?: CampoProvedor[];
  site?: string;
};

const AMBIENTES = [
  { valor: "sandbox", rotulo: "Testes (sandbox)" },
  { valor: "producao", rotulo: "Produção" },
];
const CAMPO_TOKEN: CampoProvedor = { nome: "api_key", rotulo: "Chave da API (token)", tipo: "segredo", obrigatorio: true };
const CAMPOS_OAUTH: CampoProvedor[] = [
  { nome: "client_id", rotulo: "Client ID", tipo: "texto", obrigatorio: true },
  { nome: "client_secret", rotulo: "Client secret", tipo: "segredo", obrigatorio: true },
];

export const CATALOGO: ItemCatalogo[] = [
  // API e automação
  { id: "api_rest", nome: "API REST", categoria: "api", tipo: "interno", href: "/integracoes/api", descricao: "Outros sistemas leem imóveis, pessoas, contratos e cobranças (e mandam leads) com uma chave de API." },
  { id: "webhooks", nome: "Webhooks", categoria: "api", tipo: "interno", href: "/integracoes/webhooks", descricao: "O sistema avisa outro endereço na hora em que algo acontece: lead novo, contrato, pagamento, chamado…" },
  { id: "n8n", nome: "n8n, Make e Zapier", categoria: "api", tipo: "interno", href: "/integracoes/api#n8n", descricao: "Monte automações sem programar: o n8n recebe os webhooks e chama a API com a sua chave." },
  // Bancos
  { id: "pix_copia_cola", nome: "Pix copia e cola", categoria: "bancos", tipo: "interno", href: "/cobrancas/configuracoes", descricao: "Cada cobrança sai com Pix copia e cola e QR Code (sem banco contratado), na 2ª via e no portal do locatário." },
  { id: "baixa_automatica", nome: "Baixa automática pelo extrato", categoria: "bancos", tipo: "interno", href: "/cobrancas/baixa", descricao: "Importe o extrato (OFX ou CSV) e o sistema acha os aluguéis pagos e dá a baixa de uma vez." },
  { id: "extrato_ofx", nome: "Extrato bancário OFX/CSV e conciliação", categoria: "bancos", tipo: "interno", href: "/financeiro/contas", descricao: "Importe o extrato de qualquer banco e concilie com os lançamentos do Financeiro." },
  {
    id: "banco_cobranca",
    nome: "Boleto registrado e Pix com aviso do banco",
    categoria: "bancos",
    tipo: "provedor",
    descricao: "Registro de boletos, Pix dinâmico e aviso de pagamento na hora, direto com o seu banco (Itaú, Bradesco, Santander, BB, Sicoob, Inter…). Precisa do contrato de cobrança e do certificado do banco.",
    campos: [
      { nome: "banco", rotulo: "Banco", tipo: "texto", obrigatorio: true },
      { nome: "agencia", rotulo: "Agência", tipo: "texto" },
      { nome: "conta", rotulo: "Conta", tipo: "texto" },
      { nome: "convenio", rotulo: "Convênio / código do beneficiário", tipo: "texto" },
      { nome: "carteira", rotulo: "Carteira", tipo: "texto" },
      ...CAMPOS_OAUTH,
    ],
  },
  {
    id: "banco_pagamentos",
    nome: "Pagamento de repasses pelo banco (Pix/TED em lote)",
    categoria: "bancos",
    tipo: "provedor",
    soImobiliaria: true,
    descricao: "Mandar os repasses aprovados direto para o banco pagar. Precisa do contrato de pagamentos (API) com o banco.",
    campos: [{ nome: "banco", rotulo: "Banco", tipo: "texto", obrigatorio: true }, ...CAMPOS_OAUTH],
  },
  // Gateways
  { id: "asaas", nome: "Asaas", categoria: "pagamentos", tipo: "provedor", testavel: true, site: "https://www.asaas.com", descricao: "Boleto, Pix e cartão. Hoje o sistema só confere a chave (Testar conexão); emitir cobranças pelo Asaas fica pronto para ligar quando o serviço for contratado.", campos: [CAMPO_TOKEN] },
  { id: "mercadopago", nome: "Mercado Pago", categoria: "pagamentos", tipo: "provedor", testavel: true, site: "https://www.mercadopago.com.br/developers", descricao: "Pix e cartão. Hoje o sistema só confere o access token (Testar conexão); cobrar pelo Mercado Pago fica pronto para ligar quando o serviço for contratado.", campos: [{ ...CAMPO_TOKEN, rotulo: "Access token" }] },
  { id: "pagarme", nome: "Pagar.me", categoria: "pagamentos", tipo: "provedor", site: "https://pagar.me", descricao: "Boleto, Pix e cartão. Estrutura pronta: depende da conta e da chave secreta.", campos: [{ ...CAMPO_TOKEN, rotulo: "Chave secreta (sk_…)" }] },
  { id: "inter", nome: "Banco Inter (API)", categoria: "pagamentos", tipo: "provedor", site: "https://developers.inter.co", descricao: "Boleto com Pix e extrato. Estrutura pronta: depende da conta PJ, da aplicação e do certificado.", campos: CAMPOS_OAUTH },
  { id: "efi", nome: "Efí (Gerencianet)", categoria: "pagamentos", tipo: "provedor", site: "https://dev.efipay.com.br", descricao: "Pix com cobrança, boleto e carnê. Estrutura pronta: depende da conta, da aplicação e do certificado.", campos: CAMPOS_OAUTH },
  // Assinatura
  { id: "assinatura_interna", nome: "Assinatura eletrônica do sistema", categoria: "assinatura", tipo: "interno", href: "/documentos", descricao: "Contratos, laudos e termos assinados por link, com registro de IP, data e conferência do documento." },
  { id: "clicksign", nome: "Clicksign", categoria: "assinatura", tipo: "provedor", site: "https://www.clicksign.com", descricao: "Assinatura com certificado ICP/selfie. Estrutura pronta: depende do plano com API.", campos: [CAMPO_TOKEN] },
  { id: "d4sign", nome: "D4Sign", categoria: "assinatura", tipo: "provedor", site: "https://d4sign.com.br", descricao: "Assinatura eletrônica e digital. Estrutura pronta: depende do plano com API.", campos: [CAMPO_TOKEN, { nome: "crypt_key", rotulo: "Crypt key", tipo: "segredo" }] },
  { id: "docusign", nome: "DocuSign", categoria: "assinatura", tipo: "provedor", site: "https://developers.docusign.com", descricao: "Assinatura eletrônica. Estrutura pronta: depende da conta e da aplicação (OAuth).", campos: CAMPOS_OAUTH },
  // Mensagens
  { id: "whatsapp", nome: "WhatsApp Business Platform", categoria: "mensagens", tipo: "interno", href: "/marketing/configuracoes", hrefPessoal: "/cobrancas/fila", descricao: "Conversas do WhatsApp (Cloud API da Meta) no Marketing; mensagens prontas de cobrança abrem o WhatsApp com o texto." },
  { id: "lead_ads", nome: "Meta e Google Lead Ads", categoria: "anuncios", tipo: "interno", href: "/marketing/configuracoes", soImobiliaria: true, descricao: "Leads dos formulários de anúncio do Facebook/Instagram e do Google entram sozinhos no Comercial." },
  { id: "conversoes", nome: "Conversões offline (Google e Meta)", categoria: "anuncios", tipo: "interno", href: "/marketing/origem", soImobiliaria: true, descricao: "Origem dos leads por UTM/gclid/fbclid e arquivo de conversões para subir nas plataformas." },
  { id: "ga4", nome: "Google Analytics (GA4) no site", categoria: "anuncios", tipo: "interno", href: "/site", soImobiliaria: true, descricao: "Código do GA4 no site público da imobiliária." },
  // E-mail
  { id: "resend", nome: "Resend", categoria: "email", tipo: "provedor", testavel: true, site: "https://resend.com", descricao: "E-mail transacional. Hoje o sistema só confere a chave (Testar conexão); mandar avisos e cobranças pelo Resend fica pronto para ligar.", campos: [CAMPO_TOKEN, { nome: "remetente", rotulo: "Remetente (ex.: avisos@suaimobiliaria.com.br)", tipo: "texto" }] },
  {
    id: "smtp",
    nome: "SMTP (Gmail, Outlook, provedor próprio)",
    categoria: "email",
    tipo: "provedor",
    descricao: "Envio pelo servidor de e-mail da empresa. Estrutura pronta: depende do servidor e da senha de aplicativo.",
    campos: [
      { nome: "host", rotulo: "Servidor SMTP", tipo: "texto", obrigatorio: true },
      { nome: "porta", rotulo: "Porta", tipo: "texto" },
      { nome: "usuario", rotulo: "Usuário", tipo: "texto" },
      { nome: "senha", rotulo: "Senha", tipo: "segredo" },
      { nome: "remetente", rotulo: "Remetente", tipo: "texto" },
    ],
  },
  // Agenda
  { id: "ics", nome: "Calendário assinável (.ics)", categoria: "agenda", tipo: "interno", href: "/agenda", descricao: "Google Agenda, Outlook e Apple assinam o endereço da agenda e mostram as visitas e compromissos (atualiza sozinho)." },
  { id: "google_calendar", nome: "Google Agenda (duas vias)", categoria: "agenda", tipo: "provedor", site: "https://console.cloud.google.com", descricao: "Criar e mover eventos nos dois sentidos. Estrutura pronta: depende do app OAuth do Google aprovado.", campos: CAMPOS_OAUTH },
  { id: "outlook", nome: "Microsoft Outlook (duas vias)", categoria: "agenda", tipo: "provedor", site: "https://entra.microsoft.com", descricao: "Agenda do Microsoft 365 nos dois sentidos. Estrutura pronta: depende do app no Microsoft Entra.", campos: CAMPOS_OAUTH },
  // Portais
  { id: "portais_feed", nome: "ZAP Imóveis, Viva Real e OLX", categoria: "portais", tipo: "interno", href: "/site/portais", soImobiliaria: true, descricao: "Feed XML gerado na hora, controle de destaques e leads dos portais por webhook." },
  { id: "imovelweb", nome: "Imovelweb, Chaves na Mão e outros", categoria: "portais", tipo: "provedor", soImobiliaria: true, descricao: "Outros portais por feed ou API própria. Estrutura pronta: depende do contrato e do layout do portal.", campos: [{ nome: "portal", rotulo: "Portal", tipo: "texto", obrigatorio: true }, { nome: "codigo_anunciante", rotulo: "Código do anunciante", tipo: "texto" }, CAMPO_TOKEN] },
  // Consulta cadastral
  { id: "consultas_registro", nome: "Registro de consultas (LGPD)", categoria: "cadastral", tipo: "interno", href: "/analise", descricao: "Na análise cadastral: consulta feita fora do sistema com base legal, resultado e anexo." },
  { id: "serasa", nome: "Serasa Experian", categoria: "cadastral", tipo: "provedor", site: "https://www.serasaexperian.com.br", descricao: "Score e restrições direto na análise. Estrutura pronta: depende do contrato com o birô.", campos: CAMPOS_OAUTH },
  { id: "boavista", nome: "Boa Vista (SCPC)", categoria: "cadastral", tipo: "provedor", site: "https://www.boavistaservicos.com.br", descricao: "Consulta de CPF/CNPJ. Estrutura pronta: depende do contrato com o birô.", campos: [{ nome: "usuario", rotulo: "Usuário", tipo: "texto" }, { nome: "senha", rotulo: "Senha", tipo: "segredo" }] },
  // Seguro
  { id: "garantidoras", nome: "Acompanhamento nas garantidoras", categoria: "seguro", tipo: "interno", href: "/analise/garantidoras", descricao: "Pedidos de seguro-fiança, título e garantidoras, com vencimento e renovação." },
  { id: "seguro_fianca", nome: "Seguradora / garantidora por API", categoria: "seguro", tipo: "provedor", descricao: "Mandar a ficha e receber a aprovação da seguradora (Porto, Tokio Marine, CredPago, Loft…). Estrutura pronta: depende do contrato e da API de cada uma.", campos: [{ nome: "seguradora", rotulo: "Seguradora", tipo: "texto", obrigatorio: true }, CAMPO_TOKEN] },
  // Contábil
  { id: "contabil_csv", nome: "Exportação contábil (CSV)", categoria: "contabil", tipo: "interno", href: "/integracoes/exportar", descricao: "Lançamentos do período no layout genérico (data, conta, histórico, D/C, valor, documento) com de-para do plano de contas." },
  { id: "contabil_layout", nome: "Domínio, Alterdata, Contmatic", categoria: "contabil", tipo: "provedor", descricao: "Layouts próprios de cada sistema contábil podem ser acrescentados a partir do CSV genérico.", campos: [{ nome: "sistema", rotulo: "Sistema contábil", tipo: "texto", obrigatorio: true }, { nome: "codigo_empresa", rotulo: "Código da empresa no escritório", tipo: "texto" }] },
  // Fiscal
  { id: "notas_controle", nome: "Controle de notas fiscais", categoria: "fiscal", tipo: "interno", href: "/financeiro/notas", soImobiliaria: true, descricao: "Notas de serviço das taxas do mês, espelho e controle de emissão." },
  { id: "nfse", nome: "Emissor de NFS-e", categoria: "fiscal", tipo: "provedor", descricao: "Emissão automática da nota de serviço (NFE.io, Focus NFe, prefeitura). Estrutura pronta: depende do contrato e do certificado digital.", campos: [{ nome: "emissor", rotulo: "Emissor", tipo: "texto", obrigatorio: true }, { nome: "inscricao_municipal", rotulo: "Inscrição municipal", tipo: "texto" }, CAMPO_TOKEN] },
  // Mapas
  { id: "mapa_imovel", nome: "Mapa no cadastro do imóvel", categoria: "mapas", tipo: "interno", href: "/imoveis", descricao: "Latitude e longitude no cadastro e o mapa na ficha do imóvel." },
  { id: "nominatim", nome: "Localização pelo endereço (OpenStreetMap)", categoria: "mapas", tipo: "interno", testavel: true, href: "/integracoes/provedores/nominatim", descricao: "Gratuito, sem chave: preenche latitude e longitude dos imóveis a partir do endereço (uma consulta por segundo)." },
  // Armazenamento
  { id: "armazenamento", nome: "Arquivos guardados no sistema", categoria: "armazenamento", tipo: "interno", href: "/integracoes/exportar#armazenamento", descricao: "Quanto cada área ocupa e a exportação completa dos documentos e fotos em .zip." },
  { id: "s3", nome: "Amazon S3 (cópia externa)", categoria: "armazenamento", tipo: "provedor", descricao: "Cópia dos documentos num bucket S3 da empresa. Estrutura pronta: depende da conta AWS.", campos: [{ nome: "bucket", rotulo: "Bucket", tipo: "texto", obrigatorio: true }, { nome: "regiao", rotulo: "Região", tipo: "texto" }, { nome: "access_key_id", rotulo: "Access key ID", tipo: "texto" }, { nome: "secret_access_key", rotulo: "Secret access key", tipo: "segredo" }] },
  { id: "google_drive", nome: "Google Drive (cópia externa)", categoria: "armazenamento", tipo: "provedor", descricao: "Cópia dos documentos numa pasta do Drive. Estrutura pronta: depende do app OAuth do Google.", campos: CAMPOS_OAUTH },
  // Importação
  { id: "importar_imoveis", nome: "Importar imóveis", categoria: "importacao", tipo: "interno", href: "/imoveis/importar", descricao: "Planilha (Excel/CSV) de outro sistema, com prévia e aviso de repetidos." },
  { id: "importar_pessoas", nome: "Importar pessoas", categoria: "importacao", tipo: "interno", href: "/pessoas/importar", descricao: "Proprietários, locatários e fiadores de outro sistema, com aviso de repetidos." },
  { id: "importar_contratos", nome: "Importar contratos", categoria: "importacao", tipo: "interno", href: "/integracoes/importar", descricao: "Contratos de outro ERP ligando imóvel (código) e pessoas (CPF/CNPJ), com mapeamento de colunas salvo." },
];

/** Catálogo do modo (no pessoal somem portais, anúncios e repasses). */
export function catalogoDoModo(modo: ModoUso | null | undefined): ItemCatalogo[] {
  const pessoal = modo === "pessoal";
  const cats = new Set(CATEGORIAS_INTEGRACAO.filter((c) => !(pessoal && c.soImobiliaria)).map((c) => c.id));
  return CATALOGO.filter((i) => cats.has(i.categoria) && !(pessoal && i.soImobiliaria));
}

export function itemCatalogo(id: string): ItemCatalogo | undefined {
  return CATALOGO.find((i) => i.id === id);
}

export const PROVEDORES = CATALOGO.filter((i) => i.tipo === "provedor").map((i) => i.id);
export const ehProvedor = (id: string) => PROVEDORES.includes(id);

export type StatusIntegracao = "ativo" | "conexao_ok" | "configurado" | "no_sistema" | "disponivel" | "depende_contrato";
export const ROTULO_STATUS_INTEGRACAO: Record<StatusIntegracao, string> = {
  ativo: "Ativo",
  conexao_ok: "Configurado (conexão ok)",
  configurado: "Configurado",
  no_sistema: "Disponível no sistema",
  disponivel: "Disponível",
  depende_contrato: "Depende de contrato",
};
export const COR_STATUS_INTEGRACAO = {
  ativo: "verde",
  conexao_ok: "azul",
  configurado: "azul",
  no_sistema: "cinza",
  disponivel: "cinza",
  depende_contrato: "amarelo",
} as const;

export type ConfigSalva = { ativo: boolean; ultimo_teste_ok: boolean | null } | null | undefined;

/**
 * Sinais de uso dos recursos internos (o que a organização já ligou nas telas
 * existentes). Sem sinal, o recurso aparece como "Disponível no sistema".
 */
export type SinaisInternos = {
  pix?: boolean;
  whatsapp?: boolean;
  leadAds?: boolean;
  portais?: boolean;
  ga4?: boolean;
  chavesApi?: number;
  webhooks?: number;
};

/** Item interno → está em uso de verdade nesta organização? */
export function internoEmUso(id: string, s: SinaisInternos | null | undefined): boolean {
  if (!s) return false;
  const api = (s.chavesApi ?? 0) > 0;
  const hooks = (s.webhooks ?? 0) > 0;
  switch (id) {
    case "api_rest":
      return api;
    case "webhooks":
      return hooks;
    case "n8n":
      return api || hooks;
    case "pix_copia_cola":
      return Boolean(s.pix);
    case "whatsapp":
      return Boolean(s.whatsapp);
    case "lead_ads":
      return Boolean(s.leadAds);
    case "portais_feed":
      return Boolean(s.portais);
    case "ga4":
      return Boolean(s.ga4);
    default:
      return false;
  }
}

/**
 * Status no catálogo (nada aparece "Ativo" sem estar funcionando de verdade):
 * - interno: "ativo" só com sinal de uso na organização (chave Pix, número do
 *   WhatsApp, portal ligado, chave de API…); senão "disponível no sistema";
 * - provedor com teste real (Asaas, Mercado Pago, Resend): sem configuração
 *   "disponível"; com o último teste ok, "configurado (conexão ok)" — nunca
 *   "ativo", porque o sistema ainda não emite cobrança nem manda e-mail por
 *   eles (estrutura pronta: depende de ligar o serviço);
 * - provedor sem chamada implementada: "depende de contrato" sem configuração
 *   e "configurado" com a configuração guardada (a integração não roda).
 */
export function statusIntegracao(item: ItemCatalogo, cfg: ConfigSalva, sinais?: SinaisInternos | null): StatusIntegracao {
  if (item.tipo === "interno") return internoEmUso(item.id, sinais) ? "ativo" : "no_sistema";
  if (!item.testavel) return cfg ? "configurado" : "depende_contrato";
  if (!cfg) return "disponivel";
  return cfg.ultimo_teste_ok ? "conexao_ok" : "configurado";
}

export const ROTULO_AMBIENTE: Record<string, string> = { sandbox: "Testes (sandbox)", producao: "Produção" };
export const OPCOES_AMBIENTE = AMBIENTES;

/** "…a1b2": dica do segredo guardado (nunca o valor). */
export function dicaSegredo(valor: string): string {
  const v = valor.trim();
  return v.length <= 4 ? "••••" : `••••${v.slice(-4)}`;
}

/** Separa os campos do formulário em configuração comum e segredos (só os preenchidos). */
export function separarCampos(item: ItemCatalogo, valores: Record<string, string | null | undefined>) {
  const config: Record<string, string> = {};
  const segredos: Record<string, string> = {};
  const faltando: string[] = [];
  for (const c of item.campos ?? []) {
    const v = (valores[c.nome] ?? "").toString().trim();
    if (c.tipo === "segredo") {
      if (v) segredos[c.nome] = v.slice(0, 4000);
    } else if (v) config[c.nome] = v.slice(0, 500);
    else if (c.obrigatorio) faltando.push(c.rotulo);
  }
  return { config, segredos, faltando };
}

// ---------------------------------------------------------------------------
// API: escopos
// ---------------------------------------------------------------------------

export const RECURSOS_API = ["imoveis", "pessoas", "contratos", "faturas", "leads"] as const;
export type RecursoApi = (typeof RECURSOS_API)[number];
export const ehRecursoApi = (r: string): r is RecursoApi => (RECURSOS_API as readonly string[]).includes(r);

export const ESCOPOS_API: { id: string; rotulo: string; soImobiliaria?: boolean }[] = [
  { id: "imoveis:leitura", rotulo: "Imóveis — ler" },
  { id: "pessoas:leitura", rotulo: "Pessoas — ler (sem CPF, banco e documentos)" },
  { id: "contratos:leitura", rotulo: "Contratos — ler" },
  { id: "faturas:leitura", rotulo: "Cobranças (faturas) — ler" },
  { id: "leads:leitura", rotulo: "Leads — ler", soImobiliaria: true },
  { id: "leads:escrita", rotulo: "Leads — criar", soImobiliaria: true },
  { id: "webhooks:escrita", rotulo: "Webhooks — disparar teste" },
];
export const escoposDoModo = (modo: ModoUso | null | undefined) => ESCOPOS_API.filter((e) => !(modo === "pessoal" && e.soImobiliaria));
export const ROTULO_ESCOPO: Record<string, string> = Object.fromEntries(ESCOPOS_API.map((e) => [e.id, e.rotulo]));

/** Escopos válidos para o modo (descarta repetidos e desconhecidos). */
export function filtrarEscopos(lista: string[], modo: ModoUso | null | undefined): string[] {
  const validos = new Set(escoposDoModo(modo).map((e) => e.id));
  return [...new Set(lista)].filter((e) => validos.has(e));
}

/** Limite padrão de chamadas por hora (por chave) e por organização. Mesmos valores do banco. */
export const LIMITE_HORA_CHAVE = 600;
export const LIMITE_HORA_ORGANIZACAO = 5000;
export const LIMITE_PAGINA_API = 100;

/** Formato da chave: na_<10 hex>_<48 hex> (o prefixo "na_<10 hex>" aparece na tela). */
export const FORMATO_CHAVE = /^na_[0-9a-f]{10}_[0-9a-f]{48}$/;
export function prefixoDaChave(chave: string): string | null {
  return FORMATO_CHAVE.test(chave) ? chave.slice(0, 13) : null;
}

/** Lê a chave do cabeçalho Authorization: Bearer … (ou X-Api-Key). */
export function chaveDoCabecalho(authorization: string | null, xApiKey?: string | null): string | null {
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(authorization ?? "");
  const v = (m?.[1] ?? xApiKey ?? "").trim();
  return v || null;
}

export type SituacaoChave = "ativa" | "expirada" | "revogada";
export function situacaoChave(c: { revogada_em: string | null; expira_em: string | null }, agoraIso: string): SituacaoChave {
  if (c.revogada_em) return "revogada";
  if (c.expira_em && c.expira_em <= agoraIso) return "expirada";
  return "ativa";
}
export const ROTULO_SITUACAO_CHAVE: Record<SituacaoChave, string> = { ativa: "Ativa", expirada: "Expirada", revogada: "Revogada" };
export const COR_SITUACAO_CHAVE = { ativa: "verde", expirada: "amarelo", revogada: "cinza" } as const;

/** Cursor de paginação: o banco devolve "data|id"; para fora vai em base64url (opaco). */
export function codificarCursor(bruto: string | null | undefined): string | null {
  if (!bruto || !/^[\x20-\x7e]+$/.test(bruto)) return null;
  return btoa(bruto).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
const CURSOR_BRUTO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z\|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** null = sem cursor; false = cursor inválido. */
export function decodificarCursor(c: string | null | undefined): string | null | false {
  if (!c) return null;
  if (!/^[A-Za-z0-9_-]{1,200}$/.test(c)) return false;
  let bruto: string;
  try {
    const b64 = c.replace(/-/g, "+").replace(/_/g, "/");
    bruto = atob(b64 + "=".repeat((4 - (b64.length % 4)) % 4));
  } catch {
    return false;
  }
  return CURSOR_BRUTO.test(bruto) ? bruto : false;
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

export const EVENTOS_WEBHOOK = [
  { id: "lead.criado", rotulo: "Lead novo", grupo: "Comercial", soImobiliaria: true },
  { id: "proposta.criada", rotulo: "Proposta nova", grupo: "Comercial", soImobiliaria: true },
  { id: "visita.agendada", rotulo: "Visita agendada", grupo: "Agenda" },
  { id: "imovel.criado", rotulo: "Imóvel cadastrado", grupo: "Imóveis" },
  { id: "imovel.atualizado", rotulo: "Imóvel alterado", grupo: "Imóveis" },
  { id: "contrato.criado", rotulo: "Contrato criado", grupo: "Locação" },
  { id: "contrato.encerrado", rotulo: "Contrato encerrado ou rescindido", grupo: "Locação" },
  { id: "fatura.criada", rotulo: "Cobrança gerada", grupo: "Cobranças" },
  { id: "fatura.paga", rotulo: "Cobrança quitada", grupo: "Cobranças" },
  { id: "pagamento.recebido", rotulo: "Pagamento recebido (inclusive parcial)", grupo: "Cobranças" },
  { id: "chamado.aberto", rotulo: "Chamado de manutenção aberto", grupo: "Manutenção" },
  { id: "chamado.concluido", rotulo: "Chamado concluído", grupo: "Manutenção" },
  { id: "documento.assinado", rotulo: "Documento assinado por todos", grupo: "Documentos" },
] as const;
export type EventoWebhook = (typeof EVENTOS_WEBHOOK)[number]["id"];
export const EVENTO_TESTE = "webhook.teste";
export const ROTULO_EVENTO: Record<string, string> = { ...Object.fromEntries(EVENTOS_WEBHOOK.map((e) => [e.id, e.rotulo])), [EVENTO_TESTE]: "Teste" };
export const eventosDoModo = (modo: ModoUso | null | undefined) => EVENTOS_WEBHOOK.filter((e) => !(modo === "pessoal" && "soImobiliaria" in e && e.soImobiliaria));
export function filtrarEventos(lista: string[], modo: ModoUso | null | undefined): string[] {
  const validos = new Set<string>(eventosDoModo(modo).map((e) => e.id));
  return [...new Set(lista)].filter((e) => validos.has(e));
}

export const MAX_TENTATIVAS_WEBHOOK = 6;
export const PAUSA_APOS_FALHAS = 50;
export const TIMEOUT_WEBHOOK_MS = 10_000;
export const ENTREGAS_POR_RODADA = 5;

/** Espera (minutos) depois da tentativa n que falhou: 5, 15, 45, 135, 405… até 1 dia. Mesma conta de privado.webhook_atraso_min. */
export function atrasoMinutos(tentativa: number): number {
  const n = Math.max(1, Math.trunc(tentativa));
  return Math.min(5 * 3 ** (n - 1), 1440);
}

export type StatusEntrega = "pendente" | "entregue" | "falhou" | "desistiu";
export const ROTULO_STATUS_ENTREGA: Record<StatusEntrega, string> = { pendente: "Na fila", entregue: "Entregue", falhou: "Falhou (vai tentar de novo)", desistiu: "Desistiu" };
export const COR_STATUS_ENTREGA = { pendente: "azul", entregue: "verde", falhou: "amarelo", desistiu: "vermelho" } as const;

/** Resposta HTTP que conta como entregue: 2xx (redirecionamento não é seguido). */
export const entregaOk = (status: number | null | undefined) => typeof status === "number" && status >= 200 && status < 300;

// --- Destinos internos (SSRF) ----------------------------------------------

function ipv4ParaNumero(ip: string): number | null {
  const p = ip.split(".");
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null;
  return p.reduce((acc, x) => acc * 256 + Number(x), 0);
}
const FAIXAS_V4: [string, number][] = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

/** IPv4 de rede interna, reservado, link-local (metadados de nuvem) ou multicast. */
export function ipv4Bloqueado(ip: string): boolean {
  const n = ipv4ParaNumero(ip);
  if (n === null) return true;
  return FAIXAS_V4.some(([base, bits]) => {
    const b = ipv4ParaNumero(base) as number;
    const tam = 2 ** (32 - bits);
    return n >= b && n < b + tam;
  });
}

/** Expande um IPv6 em 8 grupos de 16 bits (aceita IPv4 embutido no fim). */
function gruposIpv6(ip: string): number[] | null {
  let s = ip.toLowerCase().replace(/^\[|\]$/g, "").split("%")[0];
  const v4 = /(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(s);
  if (v4) {
    const n = ipv4ParaNumero(v4[1]);
    if (n === null) return null;
    s = s.slice(0, -v4[1].length) + `${(n >>> 16).toString(16)}:${(n & 0xffff).toString(16)}`;
  }
  const partes = s.split("::");
  if (partes.length > 2) return null;
  const esq = partes[0] ? partes[0].split(":") : [];
  const dir = partes.length === 2 && partes[1] ? partes[1].split(":") : [];
  if ([...esq, ...dir].some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return null;
  const faltam = 8 - esq.length - dir.length;
  if (partes.length === 1 ? faltam !== 0 : faltam < 1) return null;
  return [...esq, ...Array(partes.length === 2 ? faltam : 0).fill("0"), ...dir].map((g) => parseInt(g, 16));
}

export function ipv6Bloqueado(ip: string): boolean {
  const g = gruposIpv6(ip);
  if (!g) return true;
  const zero = (i: number, j: number) => g.slice(i, j).every((x) => x === 0);
  if (zero(0, 8)) return true; // ::
  if (zero(0, 7) && g[7] === 1) return true; // ::1
  // IPv4 embutido: ::ffff:a.b.c.d, ::a.b.c.d, 64:ff9b::a.b.c.d (NAT64)
  const v4 = () => `${g[6] >> 8}.${g[6] & 255}.${g[7] >> 8}.${g[7] & 255}`;
  if (zero(0, 5) && (g[5] === 0xffff || g[5] === 0)) return ipv4Bloqueado(v4());
  if (g[0] === 0x64 && g[1] === 0xff9b && zero(2, 6)) return ipv4Bloqueado(v4());
  if ((g[0] & 0xfe00) === 0xfc00) return true; // fc00::/7 (rede interna, inclui fd00:ec2::254)
  if ((g[0] & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g[0] & 0xff00) === 0xff00) return true; // multicast
  if (g[0] === 0x2001 && g[1] === 0x0db8) return true; // documentação
  if (g[0] === 0x0100 && zero(1, 4)) return true; // descarte
  return false;
}

export function ehIpLiteral(host: string): 4 | 6 | 0 {
  const h = host.replace(/^\[|\]$/g, "");
  if (ipv4ParaNumero(h) !== null) return 4;
  if (h.includes(":") && gruposIpv6(h)) return 6;
  return 0;
}

export function ipBloqueado(ip: string): boolean {
  const tipo = ehIpLiteral(ip);
  if (tipo === 4) return ipv4Bloqueado(ip);
  if (tipo === 6) return ipv6Bloqueado(ip);
  return true;
}

const NOMES_INTERNOS = /(^|\.)(localhost|local|internal|intranet|lan|home|corp|localdomain|home\.arpa)$/i;

/** Nome de máquina que aponta para dentro (ou IP literal interno). */
export function hostBloqueado(host: string): boolean {
  const h = host.trim().toLowerCase().replace(/\.$/, "");
  if (!h) return true;
  const ip = ehIpLiteral(h);
  if (ip) return ipBloqueado(h);
  if (!h.includes(".")) return true; // nome sem domínio (ex.: "metadata", "servidor")
  if (NOMES_INTERNOS.test(h)) return true;
  if (h === "metadata.google.internal" || h.endsWith(".nip.io") || h.endsWith(".sslip.io")) return true;
  return false;
}

/** Valida a URL do webhook: https, sem usuário/senha e sem destino interno. null = ok. */
export function validarUrlWebhook(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return "Endereço inválido. Use o endereço completo, começando com https://";
  }
  if (u.protocol !== "https:") return "O endereço precisa começar com https:// (conexão segura).";
  if (u.username || u.password) return "Não coloque usuário e senha no endereço. Confira a assinatura do webhook no destino.";
  if (hostBloqueado(u.hostname)) return "Endereço interno (localhost, rede local ou IP reservado) não é aceito.";
  if (url.length > 2000) return "Endereço muito longo.";
  return null;
}

// ---------------------------------------------------------------------------
// Exportação contábil (layout genérico)
// ---------------------------------------------------------------------------

export type OrigemMapa = "plano" | "categoria" | "conta_financeira" | "padrao";
export const ROTULO_ORIGEM_MAPA: Record<OrigemMapa, string> = {
  plano: "Conta do plano de contas",
  categoria: "Categoria",
  conta_financeira: "Conta bancária / caixa",
  padrao: "Padrão",
};
export type ItemMapa = { origem_tipo: OrigemMapa; origem_id: string | null; origem_texto: string | null; conta_contabil: string; historico_padrao?: string | null };

export type LancamentoContabil = {
  data: string;
  tipo: "receber" | "pagar";
  descricao: string;
  categoria: string | null;
  valor: number;
  documento: string | null;
  pessoa: string | null;
  plano_id: string | null;
  plano_codigo: string | null;
  conta_id: string | null;
  conta_nome: string | null;
};

export type LinhaContabil = {
  data: string;
  conta: string;
  contrapartida: string;
  historico: string;
  natureza: "D" | "C";
  valor: number;
  documento: string;
  categoria: string;
};

function acharMapa(mapa: ItemMapa[], tipo: OrigemMapa, id: string | null, textoChave: string | null) {
  return mapa.find((m) => m.origem_tipo === tipo && (id ? m.origem_id === id : normalizar(m.origem_texto ?? "") === normalizar(textoChave ?? "")));
}

/**
 * Conta contábil de um lançamento, na ordem: de-para da conta do plano →
 * de-para da categoria → código do plano de contas → padrão (receita/despesa).
 * Contrapartida: de-para da conta bancária → padrão "banco".
 * Receber = crédito (C) na conta de resultado; pagar = débito (D).
 */
export function linhaContabil(l: LancamentoContabil, mapa: ItemMapa[]): LinhaContabil {
  const porPlano = l.plano_id ? acharMapa(mapa, "plano", l.plano_id, null) : undefined;
  const porCategoria = l.categoria ? acharMapa(mapa, "categoria", null, l.categoria) : undefined;
  const padrao = acharMapa(mapa, "padrao", null, l.tipo === "receber" ? "receita" : "despesa");
  const conta = porPlano?.conta_contabil ?? porCategoria?.conta_contabil ?? l.plano_codigo ?? padrao?.conta_contabil ?? "";
  const porBanco = l.conta_id ? acharMapa(mapa, "conta_financeira", l.conta_id, null) : undefined;
  const contrapartida = porBanco?.conta_contabil ?? acharMapa(mapa, "padrao", null, "banco")?.conta_contabil ?? "";
  const modelo = porPlano?.historico_padrao ?? porCategoria?.historico_padrao ?? null;
  const historico = (modelo ? modelo.replace(/\{descricao\}/g, l.descricao).replace(/\{pessoa\}/g, l.pessoa ?? "") : [l.descricao, l.pessoa].filter(Boolean).join(" - ")).trim();
  return {
    data: l.data,
    conta,
    contrapartida,
    historico,
    natureza: l.tipo === "receber" ? "C" : "D",
    valor: paraReais(paraCentavos(l.valor)),
    documento: l.documento ?? "",
    categoria: l.categoria ?? "",
  };
}

export function resumoContabil(linhas: LinhaContabil[]) {
  let d = 0;
  let c = 0;
  let semConta = 0;
  for (const l of linhas) {
    if (l.natureza === "D") d += paraCentavos(l.valor);
    else c += paraCentavos(l.valor);
    if (!l.conta) semConta += 1;
  }
  return { debitos: paraReais(d), creditos: paraReais(c), semConta, total: linhas.length };
}

/** CSV no layout genérico (separador ;, decimal com vírgula, data dd/mm/aaaa). */
export function csvContabil(linhas: LinhaContabil[]): string {
  const br = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
  return paraCSV(
    ["Data", "Conta", "Contrapartida", "Historico", "D/C", "Valor", "Documento", "Categoria"],
    linhas.map((l) => [br(l.data), l.conta, l.contrapartida, l.historico, l.natureza, l.valor, l.documento, l.categoria]),
  );
}

// ---------------------------------------------------------------------------
// Importação de contratos (outro ERP)
// ---------------------------------------------------------------------------

export type CampoContrato =
  | "imovel_codigo"
  | "locatario_documento"
  | "fiador_documento"
  | "codigo"
  | "data_inicio"
  | "prazo_meses"
  | "data_fim"
  | "valor_aluguel"
  | "dia_vencimento"
  | "indice_reajuste"
  | "finalidade"
  | "modalidade"
  | "taxa_administracao_pct"
  | "taxa_intermediacao_pct"
  | "garantia_tipo"
  | "garantia_valor"
  | "status"
  | "observacoes";

export const CAMPOS_IMPORTACAO_CONTRATO: { campo: CampoContrato; rotulo: string; nomes: string[]; obrigatorio?: boolean; soImobiliaria?: boolean }[] = [
  { campo: "imovel_codigo", rotulo: "Código do imóvel", nomes: ["imovel", "codigo do imovel", "cod imovel", "codigo imovel", "ref imovel", "referencia"], obrigatorio: true },
  { campo: "locatario_documento", rotulo: "CPF/CNPJ do locatário", nomes: ["cpf locatario", "cpf do locatario", "documento locatario", "cpf cnpj locatario", "locatario cpf", "inquilino cpf", "cpf inquilino", "cpf"], obrigatorio: true },
  { campo: "fiador_documento", rotulo: "CPF/CNPJ do fiador", nomes: ["cpf fiador", "cpf do fiador", "documento fiador", "fiador cpf"] },
  { campo: "codigo", rotulo: "Código do contrato", nomes: ["codigo do contrato", "cod contrato", "numero do contrato", "contrato", "codigo"] },
  { campo: "data_inicio", rotulo: "Início", nomes: ["inicio", "data inicio", "data de inicio", "inicio vigencia", "inicio do contrato"], obrigatorio: true },
  { campo: "prazo_meses", rotulo: "Prazo (meses)", nomes: ["prazo", "prazo meses", "meses", "duracao"] },
  { campo: "data_fim", rotulo: "Fim", nomes: ["fim", "data fim", "data final", "termino", "fim vigencia", "data de termino"] },
  { campo: "valor_aluguel", rotulo: "Valor do aluguel", nomes: ["aluguel", "valor", "valor aluguel", "valor do aluguel", "valor locacao"], obrigatorio: true },
  { campo: "dia_vencimento", rotulo: "Dia do vencimento", nomes: ["vencimento", "dia vencimento", "dia de vencimento", "dia pagamento"] },
  { campo: "indice_reajuste", rotulo: "Índice de reajuste", nomes: ["indice", "reajuste", "indice reajuste", "indice de reajuste"] },
  { campo: "finalidade", rotulo: "Finalidade", nomes: ["finalidade", "uso", "tipo de locacao"] },
  { campo: "modalidade", rotulo: "Pagamento (antecipado/vencido)", nomes: ["modalidade", "forma de pagamento do aluguel"] },
  { campo: "taxa_administracao_pct", rotulo: "Taxa de administração (%)", nomes: ["taxa administracao", "taxa de administracao", "taxa adm", "administracao"], soImobiliaria: true },
  { campo: "taxa_intermediacao_pct", rotulo: "Taxa de intermediação (%)", nomes: ["taxa intermediacao", "taxa de intermediacao", "intermediacao"], soImobiliaria: true },
  { campo: "garantia_tipo", rotulo: "Garantia", nomes: ["garantia", "tipo garantia", "tipo de garantia"] },
  { campo: "garantia_valor", rotulo: "Valor da garantia", nomes: ["valor garantia", "valor da garantia", "caucao valor"] },
  { campo: "status", rotulo: "Situação (ativo/encerrado)", nomes: ["status", "situacao"] },
  { campo: "observacoes", rotulo: "Observações", nomes: ["observacoes", "obs", "observacao"] },
];
export const camposContratoDoModo = (modo: ModoUso | null | undefined) => CAMPOS_IMPORTACAO_CONTRATO.filter((c) => !(modo === "pessoal" && c.soImobiliaria));

/** Mapa de colunas: índice da coluna da planilha → campo do sistema (ou null = ignorar). */
export type MapaColunas = (CampoContrato | null)[];

/** Sugere o campo de cada coluna pelo título (sem acento/maiúscula); cada campo uma vez só. */
export function sugerirMapeamento(cabecalhos: string[], modo: ModoUso | null | undefined = "imobiliaria"): MapaColunas {
  const usados = new Set<string>();
  const campos = camposContratoDoModo(modo);
  const titulos = cabecalhos.map((c) => normalizar(String(c ?? "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim());
  const out: MapaColunas = titulos.map(() => null);
  // Primeiro os nomes exatos, depois os que contêm o nome (evita "cpf" pegar a coluna do fiador).
  for (const exato of [true, false])
    titulos.forEach((t, i) => {
      if (out[i] || !t) return;
      const achado = campos.find((c) => !usados.has(c.campo) && (exato ? c.nomes.includes(t) || normalizar(c.rotulo) === t : c.nomes.some((n) => n.length > 3 && t.includes(n))));
      if (achado) {
        out[i] = achado.campo;
        usados.add(achado.campo);
      }
    });
  return out;
}

/** Mapa salvo (por título de coluna) aplicado a uma planilha nova. */
export function aplicarModelo(cabecalhos: string[], modelo: Record<string, string>, modo: ModoUso | null | undefined = "imobiliaria"): MapaColunas {
  const validos = new Set<string>(camposContratoDoModo(modo).map((c) => c.campo));
  const porTitulo = new Map(Object.entries(modelo).map(([k, v]) => [normalizar(k), v]));
  return cabecalhos.map((c) => {
    const v = porTitulo.get(normalizar(String(c ?? "")));
    return v && validos.has(v) ? (v as CampoContrato) : null;
  });
}

/** Converte o mapa em modelo salvável (título da coluna → campo). */
export function modeloDoMapa(cabecalhos: string[], mapa: MapaColunas): Record<string, string> {
  const out: Record<string, string> = {};
  cabecalhos.forEach((c, i) => {
    if (mapa[i] && String(c ?? "").trim()) out[String(c).trim()] = mapa[i] as string;
  });
  return out;
}

/** Data da planilha → ISO. Aceita Date, dd/mm/aaaa, dd/mm/aa, aaaa-mm-dd e número de série do Excel. */
export function dataPlanilha(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const iso = (a: number, m: number, d: number) => {
    const dt = new Date(Date.UTC(a, m - 1, d));
    if (dt.getUTCFullYear() !== a || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
    return dt.toISOString().slice(0, 10);
  };
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(s);
  if (m) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]);
  return null;
}

const INDICES: Record<string, string> = { igpm: "IGPM", "igp m": "IGPM", ipca: "IPCA", inpc: "INPC", ivar: "IVAR", igpdi: "IGPDI", "igp di": "IGPDI" };
const GARANTIAS: Record<string, string> = {
  "": "sem_garantia",
  sem: "sem_garantia",
  "sem garantia": "sem_garantia",
  nenhuma: "sem_garantia",
  fiador: "fiador",
  caucao: "caucao",
  deposito: "caucao",
  "seguro fianca": "seguro_fianca",
  seguro: "seguro_fianca",
  "titulo de capitalizacao": "titulo_capitalizacao",
  titulo: "titulo_capitalizacao",
  "titulo capitalizacao": "titulo_capitalizacao",
};
const chave = (v: unknown) => normalizar(String(v ?? "")).replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();

export type ContratoImportado = {
  imovel_codigo: string;
  locatario_documento: string;
  fiador_documento: string | null;
  codigo: string | null;
  data_inicio: string;
  prazo_meses: number;
  data_fim: string | null;
  valor_aluguel: number;
  dia_vencimento: number;
  indice_reajuste: string;
  finalidade: string;
  modalidade: string;
  taxa_administracao_pct: number | null;
  taxa_intermediacao_pct: number | null;
  garantia_tipo: string;
  garantia_valor: number | null;
  status: "ativo" | "encerrado";
  observacoes: string | null;
};
export type LinhaContratoImportada = { linha: number; dados: ContratoImportado; erros: string[] };

function documentoValido(d: string): boolean {
  return d.length === 11 ? validarCPF(d) : d.length === 14 ? validarCNPJ(d) : false;
}

/** Meses entre início e fim (fim = véspera do aniversário: 01/01 a 31/12 = 12). */
function mesesDoPeriodo(inicio: string, fim: string): number {
  const [a1, m1, d1] = inicio.split("-").map(Number);
  const [a2, m2, d2] = fim.split("-").map(Number);
  let meses = (a2 - a1) * 12 + (m2 - m1);
  if (d2 + 1 >= d1) meses += 1;
  return Math.max(1, meses);
}

/**
 * Lê as linhas da planilha (1ª linha = títulos) com o mapa de colunas e
 * valida cada contrato. Ligação com imóvel e pessoas é conferida depois (no
 * servidor, pelo código e CPF/CNPJ já cadastrados).
 */
export function interpretarContratos(tabela: unknown[][], mapa: MapaColunas, modo: ModoUso | null | undefined = "imobiliaria"): LinhaContratoImportada[] {
  const pessoal = modo === "pessoal";
  const out: LinhaContratoImportada[] = [];
  tabela.slice(1).forEach((linha, idx) => {
    if (!linha.some((c) => String(c ?? "").trim())) return;
    const bruto: Partial<Record<CampoContrato, unknown>> = {};
    mapa.forEach((campo, i) => {
      if (campo) bruto[campo] = linha[i];
    });
    const erros: string[] = [];
    const txt = (c: CampoContrato) => {
      const v = bruto[c];
      if (v === null || v === undefined) return "";
      return (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).trim();
    };
    const imovel = txt("imovel_codigo");
    if (!imovel) erros.push("sem código do imóvel");
    const loc = somenteDigitos(txt("locatario_documento"));
    if (!loc) erros.push("sem CPF/CNPJ do locatário");
    else if (!documentoValido(loc)) erros.push("CPF/CNPJ do locatário inválido");
    const fia = somenteDigitos(txt("fiador_documento")) || null;
    if (fia && !documentoValido(fia)) erros.push("CPF/CNPJ do fiador inválido");
    if (fia && fia === loc) erros.push("fiador igual ao locatário");
    const inicio = dataPlanilha(bruto.data_inicio);
    if (!inicio) erros.push("data de início inválida");
    const fim = dataPlanilha(bruto.data_fim);
    if (bruto.data_fim && txt("data_fim") && !fim) erros.push("data de fim inválida");
    let prazo = numeroBR(bruto.prazo_meses);
    if (prazo === null && inicio && fim) prazo = fim > inicio ? mesesDoPeriodo(inicio, fim) : null;
    if (prazo === null) prazo = 30;
    if (!Number.isInteger(prazo) || prazo < 1 || prazo > 600) erros.push("prazo em meses inválido");
    const valor = numeroBR(bruto.valor_aluguel);
    if (!valor || valor <= 0) erros.push("valor do aluguel inválido");
    const dia = numeroBR(bruto.dia_vencimento) ?? 10;
    if (!Number.isInteger(dia) || dia < 1 || dia > 31) erros.push("dia do vencimento inválido");
    const indTxt = chave(txt("indice_reajuste")).replace(/ /g, "");
    const indice = indTxt ? (INDICES[indTxt] ?? INDICES[chave(txt("indice_reajuste"))] ?? null) : "IGPM";
    if (!indice) erros.push("índice de reajuste desconhecido (use IGP-M, IPCA, INPC, IVAR ou IGP-DI)");
    const finTxt = chave(txt("finalidade"));
    const finalidade = !finTxt ? "residencial" : finTxt.startsWith("res") ? "residencial" : finTxt.startsWith("com") ? "comercial" : finTxt.startsWith("temp") ? "temporada" : null;
    if (!finalidade) erros.push("finalidade desconhecida");
    const modTxt = chave(txt("modalidade"));
    const modalidade = !modTxt ? "antecipado" : modTxt.startsWith("ant") ? "antecipado" : modTxt.startsWith("ven") || modTxt.includes("postec") ? "vencido" : null;
    if (!modalidade) erros.push("pagamento deve ser antecipado ou vencido");
    const pct = (c: CampoContrato) => {
      if (pessoal) return null;
      const n = numeroBR(bruto[c]);
      if (n !== null && (n < 0 || n > 100)) erros.push(`${c === "taxa_administracao_pct" ? "taxa de administração" : "taxa de intermediação"} fora de 0–100%`);
      return n;
    };
    const taxaAdm = pct("taxa_administracao_pct");
    const taxaInt = pct("taxa_intermediacao_pct");
    const gTxt = chave(txt("garantia_tipo"));
    const garantia = GARANTIAS[gTxt] ?? Object.entries(GARANTIAS).find(([k]) => k.length > 3 && gTxt.startsWith(k))?.[1] ?? null;
    if (!garantia) erros.push("garantia desconhecida");
    if (garantia === "fiador" && !fia) erros.push("garantia por fiador sem o CPF/CNPJ do fiador");
    const stTxt = chave(txt("status"));
    const status = !stTxt || stTxt.startsWith("ativ") || stTxt.startsWith("vig") ? "ativo" : stTxt.startsWith("encerr") || stTxt.startsWith("finaliz") || stTxt.startsWith("rescind") ? "encerrado" : null;
    if (!status) erros.push("situação deve ser ativo ou encerrado");
    const obs = txt("observacoes");
    out.push({
      linha: idx + 2,
      erros,
      dados: {
        imovel_codigo: imovel,
        locatario_documento: loc,
        fiador_documento: fia,
        codigo: txt("codigo") || null,
        data_inicio: inicio ?? "",
        prazo_meses: Number.isInteger(prazo) ? prazo : 30,
        data_fim: fim,
        valor_aluguel: valor ?? 0,
        dia_vencimento: Number.isInteger(dia) ? dia : 10,
        indice_reajuste: indice ?? "IGPM",
        finalidade: finalidade ?? "residencial",
        modalidade: modalidade ?? "antecipado",
        taxa_administracao_pct: taxaAdm,
        taxa_intermediacao_pct: taxaInt,
        garantia_tipo: garantia ?? "sem_garantia",
        garantia_valor: numeroBR(bruto.garantia_valor),
        status: status ?? "ativo",
        observacoes: obs ? obs.slice(0, 2000) : null,
      },
    });
  });
  return out;
}

/** Planilha-modelo (CSV) da importação de contratos. */
export function modeloCSVContratos(modo: ModoUso | null | undefined = "imobiliaria"): string {
  const campos = camposContratoDoModo(modo);
  const exemplo: Record<string, string> = {
    imovel_codigo: "AP-101",
    locatario_documento: "123.456.789-09",
    fiador_documento: "",
    codigo: "C-2024-001",
    data_inicio: "01/03/2024",
    prazo_meses: "30",
    data_fim: "",
    valor_aluguel: "2.500,00",
    dia_vencimento: "10",
    indice_reajuste: "IGP-M",
    finalidade: "residencial",
    modalidade: "antecipado",
    taxa_administracao_pct: "10",
    taxa_intermediacao_pct: "100",
    garantia_tipo: "caução",
    garantia_valor: "7.500,00",
    status: "ativo",
    observacoes: "",
  };
  return "﻿" + [campos.map((c) => c.rotulo).join(";"), campos.map((c) => exemplo[c.campo] ?? "").join(";")].join("\r\n");
}

// ---------------------------------------------------------------------------
// Armazenamento
// ---------------------------------------------------------------------------

export const ROTULO_BUCKET: Record<string, string> = {
  comprovantes: "Comprovantes",
  imoveis: "Fotos e documentos de imóveis",
  pessoas: "Documentos de pessoas",
  vendas: "Vendas",
  documentos: "Documentos e contratos",
  vistorias: "Vistorias",
  manutencao: "Manutenção",
  analises: "Análise cadastral",
  site: "Site",
  corretores: "Corretores",
  equipe: "Equipe",
};

export function formatarBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return "0 KB";
  const u = ["bytes", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = b;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${i === 0 ? v : v.toFixed(v >= 100 ? 0 : 1).replace(".", ",")} ${u[i]}`;
}

/** Partes da exportação de arquivos (cada .zip com até N arquivos e M bytes). */
export const ZIP_MAX_ARQUIVOS = 150;
export const ZIP_MAX_BYTES = 80 * 1024 * 1024;
