# Roadmap

Comparação com as funcionalidades levantadas em [pesquisa-jetimob.md](pesquisa-jetimob.md).

## ✅ Fase 1 — Administração de locação (implementado)

| Funcionalidade | Onde |
|---|---|
| Multi-imobiliária com isolamento por RLS | `supabase/migrations`, `/onboarding` |
| Cadastro de pessoas (PF/PJ, CPF/CNPJ validados, dados bancários/Pix, papéis) | `/pessoas` |
| Cadastro de imóveis (finalidades, características, valores, proprietários com %) | `/imoveis` |
| Gestão de chaves (retirada, devolução, atraso) | `/chaves` |
| Contratos de locação (prazo, vencimento, modalidade antecipado/vencido, índice, garantias, seguro incêndio, encargos) | `/contratos` |
| Minuta de contrato gerada a partir do cadastro (imprimir/PDF) | `/contratos/[id]/documento` |
| Geração de faturas mensais (pro rata, encargos, IRRF quando locatário PJ) | `/faturas` |
| 2ª via da fatura para impressão | `/faturas/[id]` |
| Baixa de pagamento com multa e juros pro rata, carência e dispensa | `/faturas/[id]` |
| Repasse automático, garantido ou manual, com taxa de administração, intermediação e rateio entre proprietários | `/repasses` |
| Extrato / informe de rendimentos do proprietário | `/repasses/extrato` |
| Reajuste por índice (IGP-M, IPCA, INPC, IVAR, IGP-DI), com histórico e percentual manual | `/contratos/[id]`, `/reajustes`, `/indices` |
| Calculadora de rescisão (multa proporcional — art. 4º Lei 8.245/91, saldo de dias, caução) e encerramento | `/contratos/[id]` |
| Régua de cobrança configurável (mensagens prontas para e-mail/WhatsApp) | `/regua` |
| Inadimplência e planilha de apoio à DIMOB | `/relatorios` |
| Financeiro: contas a pagar/receber, receita de taxas automática | `/financeiro` |
| Painel com indicadores e alertas (reajustes, fim de contrato, seguro) | `/` |

## 🔜 Fase 2 — Automação de cobrança e pagamentos

- Integração bancária para **boleto e Pix** com baixa automática por webhook (ex.: Asaas, Banco
  Inter, Efí). Os campos `linha_digitavel`, `pix_copia_cola` e `url_pagamento` já existem.
- **Repasse automático por Pix/TED** pela mesma conta digital.
- **Envio automático da régua** (e-mail via Resend/SES, WhatsApp via API oficial) por um job
  diário (Supabase Cron / Vercel Cron).
- **Geração automática mensal** das faturas (job no dia 1º).
- **Arquivo DIMOB no layout oficial** da Receita (validar no programa gerador).
- **NFS-e** da taxa de administração (integração com prefeitura/emissor).
- **Assinatura eletrônica** de contratos e aditivos (ex.: Clicksign, ZapSign, D4Sign).
- Aditivo de reajuste gerado automaticamente.

## 🔜 Fase 3 — Portais externos

- **Área do locatário**: 2ª via, Pix, histórico, informe de pagamentos.
- **Área do proprietário**: extratos, repasses, informe de rendimentos.
- **Vistoria** de entrada/saída com fotos e assinatura.

## 🔜 Fase 4 — Comercial (CRM, site e portais)

- Leads, funil kanban personalizável, propostas, agenda de visitas com termo de visita.
- Distribuição automática de leads (roleta) e notificações.
- Fotos/vídeos dos imóveis (Supabase Storage) com marca d'água.
- Site da imobiliária com busca de imóveis e captura de leads.
- Integração com portais (feeds XML ZAP/VivaReal/OLX etc.).
- Comissões de venda, conciliação bancária (OFX) e DRE.
- Recursos de IA: descrição de anúncios e atendimento inicial de leads.
- App do corretor (PWA).
