# Pesquisa funcional — Jetimob

Levantamento feito em 02/11/2026 a partir de **fontes públicas** (páginas de produto e planos,
títulos de artigos da central de ajuda, termos de uso, reviews de terceiros). O site
`jetimob.com` estava bloqueado pela rede do ambiente de desenvolvimento, então as informações
vieram de buscas na web. Nenhum código, texto ou tela do Jetimob foi copiado: este documento
descreve *o que* o produto faz, para orientar uma implementação própria.

> Observação: parte do material é marketing do próprio fornecedor e as estruturas de plano
> mudaram recentemente (Lite/Pro/Enterprise → Essential/Growth/Scale/Corporate). Detalhes
> podem estar desatualizados.

## Visão geral

Plataforma SaaS para imobiliárias e corretores que reúne, em módulos contratados por plano:
CRM de vendas, site da imobiliária, integração com portais, gestão de aluguéis (administração
de locação), gestão financeira, apps móveis e recursos de IA. Atende mais de mil imobiliárias e
mantém também um portal de anúncios próprio e um evento do setor.

## 1. Gestão de aluguéis (administração de locação)

| Função | Como funciona (resumo) |
|---|---|
| Cadastro de contrato | Imóvel, locatário, proprietários (beneficiários), valor, vencimento, garantia, tipo de repasse. |
| Tipos de garantia | Seleção do tipo no cadastro (fiador, caução, seguro fiança, título…), com campos próprios; é possível alterar o tipo depois. |
| Seguro incêndio | Contratação de seguro dentro do sistema, por meio de parceria com seguradora. |
| Cobrança automática | Geração das faturas mensais, emissão por boleto ou Pix por meio de conta digital integrada. |
| Régua de cobrança | Sequência personalizável de e-mails automáticos antes/depois do vencimento; notificação por WhatsApp como adicional. |
| Liquidação de fatura | Baixa da fatura (automática pela conta digital ou manual); reenviar/baixar fatura; reativar repasse de fatura cancelada mas paga. |
| Repasse ao proprietário | Automático (sistema identifica o pagamento e transfere aos beneficiários), garantido (imobiliária repassa mesmo sem receber) ou manual; finalização manual de repasse. Transferências por TED/Pix. |
| Taxa de administração | Percentual descontado do aluguel recebido antes do repasse; sistema calcula retenção e gera comprovante. |
| Reajuste | Cálculo pelo índice do contrato a partir da data-base e do valor atual; formalização por aditivo. |
| Rescisão | Cálculo de rescisão (multa proporcional, saldo). |
| Documentos | Emissão de contratos a partir de modelos, assinatura eletrônica (adicional pago), checklists. |
| Inadimplência | Controle de faturas em atraso. |
| Obrigações fiscais | Arquivo da DIMOB no formato da Receita; IRRF sobre aluguel; NFS-e da taxa (anunciada como "em breve"). |
| Áreas externas | Área do locatário (2ª via) e área do proprietário (acompanhamento). |

## 2. Gestão financeira

Contas a pagar e a receber, marcação de recebimento, comissões de vendas vinculadas a cada
negociação, conciliação bancária (com opção de ignorar movimentações), DRE, anexos e
dashboards (planos superiores).

## 3. CRM e vendas

- Funil de vendas personalizável (lista e kanban), gestão de propostas e permutas.
- Distribuição automática de leads entre corretores ("roleta"), com regras configuráveis.
- Leads vindos do site e de 75–100+ portais; integração com RD Station.
- Notificações aos corretores no celular; agenda de visitas com termo de visita automático.
- Apps adicionais: plantão de vendas, cadência de atividades, ranking de corretores.
- IA: descrições de imóveis geradas por IA e um "SDR" que faz o primeiro contato via WhatsApp.

## 4. Imóveis

- Cadastro com finalidades venda/locação/temporada (pode acumular), endereço, proprietário e
  responsável; fotos, vídeos, plantas e tour 360; marca d'água configurável.
- Ficha completa do imóvel, termos de visita e de agenciamento na linha do tempo.
- Gestão de chaves.
- Integração de estoque de incorporadoras.

## 5. Site e portais

Site da imobiliária com páginas de captura (landing pages), integração com o CRM e
publicação em portais.

## 6. Apps

App do corretor (iOS/Android).

## Fontes

- [Planos e preços](https://www.jetimob.com/planos) · [Planos (novo)](https://www.jetimob.io/planos)
- [Sistema para gestão de aluguéis](https://www.jetimob.com/sistema-gestao-alugueis-imoveis)
- [Sistema de gestão financeira](https://www.jetimob.com/sistema-gestao-financeira-imobiliaria)
- [Central de ajuda — Gestão de aluguéis](https://ajuda.jetimob.com/gest%C3%A3o-de-alugu%C3%A9is)
- [Central de ajuda — Como cadastrar contrato de locação](https://ajuda.jetimob.com/como-cadastrar-contrato-locacao)
- [Central de ajuda — Gestão financeira](https://ajuda.jetimob.com/gest%C3%A3o-financeira)
- [Termos de uso](https://www.jetimob.com/termos)
- [Landing "Sistema imobiliário"](https://lp.jetimob.com/sistema-imobiliario)
- [CRM imobiliário](https://www.jetimob.com/crm-imobiliario)
- [Review Website Imobiliário (2026)](https://www.websiteimobiliario.com.br/blog/jetimob-review-completo-precos-e-melhores-alternativas.html)
- [B2B Stack — Jetimob](https://www.b2bstack.com.br/product/jetimob)
- [RD Station — integração](https://www.rdstation.com/integracoes/jetimob/)
