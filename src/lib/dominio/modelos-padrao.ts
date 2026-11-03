/**
 * Modelos-base que acompanham o sistema. A imobiliária pode copiar e editar.
 * Linhas que começam com "# " viram título; **texto** fica em negrito.
 * São modelos de partida: revise com a assessoria jurídica antes de usar.
 */
export type ModeloPadrao = { chave: string; nome: string; tipo: string; conteudo: string };

const ASSINATURAS_LOCACAO = `{{cidade}}, {{data_hoje}}.

_______________________________
LOCADOR(ES)

_______________________________
LOCATÁRIO(S)

_______________________________
FIADOR(ES)

Testemunhas:
1. _____________________________   2. _____________________________`;

export const MODELOS_PADRAO: ModeloPadrao[] = [
  {
    chave: "locacao_residencial",
    nome: "Contrato de locação residencial",
    tipo: "locacao",
    conteudo: `# CONTRATO DE LOCAÇÃO RESIDENCIAL

**LOCADOR(ES):** {{proprietarios.qualificacao}}.

**LOCATÁRIO(S):** {{locatarios.qualificacao}}.

**FIADOR(ES):** {{fiadores.qualificacao}}.

**ADMINISTRADORA:** {{organizacao.nome}}, {{organizacao.documento}}, CRECI {{organizacao.creci}}.

**Cláusula 1ª — Objeto.** O imóvel residencial situado em {{imovel.endereco}}, matrícula {{imovel.matricula}}, inscrição de IPTU {{imovel.iptu}}, destinado exclusivamente à moradia do(s) LOCATÁRIO(S).

**Cláusula 2ª — Prazo.** A locação vigora por {{contrato.prazo_meses}} meses, de {{contrato.inicio}} a {{contrato.fim}}.

**Cláusula 3ª — Aluguel.** O aluguel mensal é de R$ {{contrato.valor_aluguel}} ({{contrato.valor_aluguel_extenso}}), com vencimento todo dia {{contrato.dia_vencimento}}.

**Cláusula 4ª — Reajuste.** O aluguel será reajustado a cada 12 meses pela variação do {{contrato.indice}}.

**Cláusula 5ª — Encargos.** Correm por conta do(s) LOCATÁRIO(S) as despesas ordinárias de condomínio, consumo de água, luz e gás, e o IPTU, salvo disposição em contrário.

**Cláusula 6ª — Atraso.** O atraso no pagamento sujeita o(s) LOCATÁRIO(S) à multa e aos juros previstos neste contrato.

**Cláusula 7ª — Garantia.** {{contrato.garantia}}.

**Cláusula 8ª — Rescisão antecipada.** A devolução do imóvel antes do fim do prazo sujeita o(s) LOCATÁRIO(S) à multa de {{contrato.multa_rescisoria}} aluguéis, proporcional ao período restante (art. 4º da Lei 8.245/91).

**Cláusula 9ª — Vistoria.** O imóvel é entregue conforme laudo de vistoria de entrada, que integra este contrato, e deverá ser devolvido no mesmo estado, ressalvado o desgaste natural.

**Cláusula 10ª — Foro.** Fica eleito o foro da comarca de {{cidade}}.

${ASSINATURAS_LOCACAO}`,
  },
  {
    chave: "administracao",
    nome: "Contrato de administração de imóvel",
    tipo: "administracao",
    conteudo: `# CONTRATO DE ADMINISTRAÇÃO DE IMÓVEL

**PROPRIETÁRIO(S):** {{proprietarios.qualificacao}}.

**ADMINISTRADORA:** {{organizacao.nome}}, {{organizacao.documento}}, CRECI {{organizacao.creci}}.

**Cláusula 1ª — Objeto.** A administração da locação do imóvel situado em {{imovel.endereco}} (código {{imovel.codigo}}), incluindo anúncio, seleção e análise de locatários, elaboração do contrato, vistorias, cobrança, repasse dos aluguéis e prestação de contas.

**Cláusula 2ª — Remuneração.** A ADMINISTRADORA receberá {{contrato.taxa_administracao}}% sobre cada aluguel recebido, além da taxa de intermediação equivalente ao primeiro aluguel, salvo acordo diverso.

**Cláusula 3ª — Repasse.** Os valores recebidos serão repassados ao(s) PROPRIETÁRIO(S), descontadas as taxas e despesas autorizadas, com demonstrativo mensal.

**Cláusula 4ª — Prazo.** Este contrato vigora por prazo indeterminado, podendo ser rescindido por qualquer parte com aviso prévio de 30 dias, respeitadas as locações em curso.

**Cláusula 5ª — Foro.** Fica eleito o foro da comarca de {{cidade}}.

{{cidade}}, {{data_hoje}}.

_______________________________
PROPRIETÁRIO(S)

_______________________________
{{organizacao.nome}}`,
  },
  {
    chave: "intermediacao_exclusividade",
    nome: "Autorização de venda/locação com exclusividade",
    tipo: "exclusividade",
    conteudo: `# AUTORIZAÇÃO DE INTERMEDIAÇÃO COM EXCLUSIVIDADE

**PROPRIETÁRIO(S):** {{proprietarios.qualificacao}}.

**INTERMEDIADORA:** {{organizacao.nome}}, {{organizacao.documento}}, CRECI {{organizacao.creci}}.

O(s) PROPRIETÁRIO(S) autoriza(m), com **exclusividade**, a INTERMEDIADORA a promover a venda e/ou locação do imóvel situado em {{imovel.endereco}}, matrícula {{imovel.matricula}}, pelo valor de R$ {{captacao.valor}}, até {{captacao.exclusividade_fim}}.

1. A INTERMEDIADORA poderá anunciar o imóvel em seu site, portais e redes sociais, fazer fotos e vídeos e levar interessados para visita.
2. A comissão será de {{captacao.comissao_venda}}% sobre o valor da venda, ou de um aluguel na locação, devida na assinatura do negócio.
3. Durante a exclusividade, a comissão é devida mesmo que o negócio seja fechado diretamente pelo(s) PROPRIETÁRIO(S) ou por terceiros (art. 726 do Código Civil).

{{cidade}}, {{data_hoje}}.

_______________________________
PROPRIETÁRIO(S)

_______________________________
{{organizacao.nome}}`,
  },
  {
    chave: "autorizacao_anuncio",
    nome: "Autorização de anúncio",
    tipo: "autorizacao",
    conteudo: `# AUTORIZAÇÃO DE ANÚNCIO

Eu, {{proprietarios.qualificacao}}, autorizo {{organizacao.nome}} (CRECI {{organizacao.creci}}) a anunciar o imóvel situado em {{imovel.endereco}} (código {{imovel.codigo}}) em site próprio, portais imobiliários e redes sociais, inclusive com fotos, vídeos e tour virtual, pelos valores de aluguel R$ {{imovel.valor_aluguel}} e/ou venda R$ {{imovel.valor_venda}}.

Esta autorização pode ser revogada a qualquer tempo por escrito.

{{cidade}}, {{data_hoje}}.

_______________________________
PROPRIETÁRIO(S)`,
  },
  {
    chave: "proposta_locacao",
    nome: "Proposta de locação",
    tipo: "proposta",
    conteudo: `# PROPOSTA DE LOCAÇÃO

**Proponente:** {{pessoa.qualificacao}}.

**Imóvel:** {{imovel.endereco}} (código {{imovel.codigo}}).

Proponho locar o imóvel acima pelo aluguel mensal de R$ ________, com início em ____/____/______, prazo de ____ meses e garantia ______________________.

Declaro que as informações prestadas são verdadeiras e autorizo a análise cadastral.

{{cidade}}, {{data_hoje}}.

_______________________________
PROPONENTE`,
  },
  {
    chave: "compra_venda",
    nome: "Compromisso de compra e venda",
    tipo: "venda",
    conteudo: `# INSTRUMENTO PARTICULAR DE COMPROMISSO DE COMPRA E VENDA

**VENDEDOR(ES):** {{proprietarios.qualificacao}}.

**COMPRADOR(ES):** {{venda.comprador.qualificacao}}.

**INTERVENIENTE:** {{organizacao.nome}}, CRECI {{organizacao.creci}}.

**Cláusula 1ª — Objeto.** O imóvel situado em {{imovel.endereco}}, matrícula {{imovel.matricula}}, livre de ônus.

**Cláusula 2ª — Preço.** R$ {{venda.valor}} ({{venda.valor_extenso}}), pago nas condições ajustadas entre as partes.

**Cláusula 3ª — Escritura e posse.** A escritura será outorgada após a quitação, quando também será transmitida a posse.

**Cláusula 4ª — Comissão.** A comissão de intermediação de {{venda.comissao_pct}}% é devida pelo(s) VENDEDOR(ES).

**Cláusula 5ª — Foro.** Comarca de {{cidade}}.

{{cidade}}, {{data_hoje}}.

_______________________________
VENDEDOR(ES)

_______________________________
COMPRADOR(ES)`,
  },
  {
    chave: "notificacao_desocupacao",
    nome: "Notificação de desocupação",
    tipo: "notificacao",
    conteudo: `# NOTIFICAÇÃO

Ao(s) locatário(s) {{locatarios.nomes}}, do imóvel situado em {{imovel.endereco}} (contrato nº {{contrato.numero}}).

Fica(m) notificado(s) de que o contrato de locação vence em {{contrato.fim}}, devendo o imóvel ser desocupado e as chaves entregues até essa data, salvo renovação ajustada por escrito.

{{cidade}}, {{data_hoje}}.

_______________________________
{{organizacao.nome}}`,
  },
  {
    chave: "recibo_generico",
    nome: "Recibo",
    tipo: "recibo",
    conteudo: `# RECIBO

Recebi de {{pessoa.nome}} a importância de R$ ________ (________________), referente a ______________________________.

{{cidade}}, {{data_hoje}}.

_______________________________
{{organizacao.nome}}`,
  },
];
