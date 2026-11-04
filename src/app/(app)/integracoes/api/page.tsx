import type { Metadata } from "next";
import Link from "next/link";
import { FileJson, KeyRound } from "lucide-react";
import { Copiar } from "@/components/copiar";
import { Aviso, Cabecalho, Cartao, Celula, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { FILTROS_API } from "@/lib/dominio/api";
import { EVENTOS_WEBHOOK, LIMITE_HORA_CHAVE, LIMITE_PAGINA_API, MAX_TENTATIVAS_WEBHOOK, escoposDoModo, eventosDoModo, type RecursoApi } from "@/lib/dominio/integracoes";
import { AbasIntegracoes } from "../abas";
import { urlBase } from "../dados";

export const metadata: Metadata = { title: "Documentação da API" };

function Codigo({ texto }: { texto: string }) {
  return (
    <div className="relative">
      <pre className="overflow-x-auto rounded-[11px] border border-borda bg-elev p-3.5 pr-24 font-mono text-[12.5px] leading-relaxed text-texto">{texto}</pre>
      <div className="absolute right-2 top-2">
        <Copiar texto={texto} />
      </div>
    </div>
  );
}

const ROTULO_RECURSO: Record<RecursoApi, string> = { imoveis: "Imóveis", pessoas: "Pessoas", contratos: "Contratos (com as partes)", faturas: "Cobranças (faturas)", leads: "Leads" };

/** Documentação da API em português, com exemplos de curl e de n8n. */
export default async function DocumentacaoApiPage() {
  const { organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const base = `${await urlBase()}/api/v1`;
  const recursos = (Object.keys(FILTROS_API) as RecursoApi[]).filter((r) => !(pessoal && r === "leads"));
  const exemploCorpo = JSON.stringify(
    {
      id: "6f1c…",
      evento: "fatura.paga",
      criado_em: "2026-11-04T13:05:22.123Z",
      enviado_em: "2026-11-04T13:05:30.004Z",
      tentativa: 1,
      organizacao_id: "…",
      dados: { id: "…", numero: 1532, contrato_id: "…", vencimento: "2026-11-10", valor_total: 2350, pago_em: "2026-11-04", valor_pago: 2350 },
    },
    null,
    2,
  );

  return (
    <>
      <Cabecalho
        titulo="Documentação da API"
        trilha="Integrações"
        descricao="Para quem vai ligar outro sistema ao Novo Aluguel: autenticação, o que dá para consultar, erros, limites, webhooks e exemplos prontos para o n8n."
        acoes={
          <>
            <a href="/api/v1/openapi.json" target="_blank" rel="noopener noreferrer" className={classeBotao("secundario")}>
              <FileJson className="size-4" /> Especificação OpenAPI
            </a>
            {papel === "admin" && (
              <Link href="/integracoes/chaves" className={classeBotao("primario")}>
                <KeyRound className="size-4" /> Criar chave
              </Link>
            )}
          </>
        }
      />
      <AbasIntegracoes />
      <div className="space-y-6">
        <Cartao titulo="1. Endereço e autenticação">
          <div className="space-y-3 text-sm text-texto-2">
            <p>
              Endereço base: <code className="font-mono text-texto">{base}</code>. Toda chamada leva a chave de API no cabeçalho <code className="font-mono">Authorization</code>. A chave
              vê só os dados desta conta e só o que as permissões dela deixam.
            </p>
            <Codigo texto={`curl -H "Authorization: Bearer na_xxxxxxxxxx_…" "${base}/imoveis?status=disponivel&limite=20"`} />
            <p>
              Respostas em JSON. Listas vêm como <code className="font-mono">{"{ dados: [...], proximo_cursor }"}</code>, dos mais novos para os mais antigos, até {LIMITE_PAGINA_API} por
              página (<code className="font-mono">limite</code>). Para a próxima página, mande o <code className="font-mono">cursor</code> recebido; quando ele vier{" "}
              <code className="font-mono">null</code>, acabou.
            </p>
          </div>
        </Cartao>

        <Cartao titulo="2. O que dá para consultar">
          <Tabela colunas={["Recurso", "Endereços", "Permissão", "Filtros"]}>
            {recursos.map((r) => (
              <tr key={r}>
                <Celula className="font-semibold">{ROTULO_RECURSO[r]}</Celula>
                <Celula className="font-mono text-[12px] text-texto-2">
                  GET /{r}
                  <br />
                  GET /{r}/{"{id}"}
                  {r === "leads" && (
                    <>
                      <br />
                      POST /leads
                    </>
                  )}
                </Celula>
                <Celula className="font-mono text-[12px] text-texto-2">
                  {r}:leitura{r === "leads" ? " · leads:escrita" : ""}
                </Celula>
                <Celula className="text-[12.5px] text-texto-2">
                  {FILTROS_API[r].map((f) => (
                    <div key={f.nome}>
                      <span className="font-mono text-texto">{f.nome}</span> — {f.descricao}
                    </div>
                  ))}
                </Celula>
              </tr>
            ))}
          </Tabela>
          <p className="mt-3 text-xs text-mudo">
            Pessoas vêm sem CPF/CNPJ, RG, dados bancários e documentos (dá para buscar alguém pelo CPF que você já tem, mas ele não volta na resposta). Permissões disponíveis:{" "}
            {escoposDoModo(organizacao.modo)
              .map((e) => e.id)
              .join(", ")}
            .
          </p>
        </Cartao>

        {!pessoal && (
          <Cartao titulo="3. Mandar um lead">
            <div className="space-y-3 text-sm text-texto-2">
              <p>
                Segue a mesma regra do formulário de captação: contato repetido (mesmo telefone ou e-mail) vira mensagem no lead que já existe, e a distribuição para os corretores é a
                configurada em Equipe. A resposta traz o <code className="font-mono">id</code> só se a chave também puder ler leads.
              </p>
              <Codigo
                texto={`curl -X POST "${base}/leads" \\\n  -H "Authorization: Bearer na_xxxxxxxxxx_…" \\\n  -H "Content-Type: application/json" \\\n  -d '{"nome":"Ana Souza","telefone":"51999990000","mensagem":"Quero visitar","imovel":"AP-101","origem":"site","utm_source":"google"}'`}
              />
            </div>
          </Cartao>
        )}

        <Cartao titulo="4. Erros e limites">
          <div className="space-y-3 text-sm text-texto-2">
            <p>
              Erro sempre no formato <code className="font-mono">{'{ "erro": { "codigo": "…", "mensagem": "…" } }'}</code>:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>401</strong> nao_autorizado — chave ausente, errada, expirada ou revogada;
              </li>
              <li>
                <strong>403</strong> sem_permissao — a chave não tem a permissão do recurso{pessoal ? "" : " (ou o recurso não existe no modo da conta)"};
              </li>
              <li>
                <strong>404</strong> nao_encontrado — registro de outra conta ou inexistente;
              </li>
              <li>
                <strong>400/422</strong> requisicao_invalida / dados_invalidos — corpo ou filtro inválido;
              </li>
              <li>
                <strong>429</strong> limite_excedido — passou de {LIMITE_HORA_CHAVE} chamadas por hora (padrão; muda por chave). Respeite o cabeçalho <code className="font-mono">Retry-After</code>{" "}
                (segundos).
              </li>
            </ul>
            <p>Cada chamada fica registrada (sem a chave) e aparece em Monitoramento.</p>
          </div>
        </Cartao>

        <section id="webhooks">
          <Cartao titulo="5. Webhooks (o sistema avisa você)">
            <div className="space-y-3 text-sm text-texto-2">
              <p>
                Cadastre um endereço https em <Link href="/integracoes/webhooks" className="text-acento hover:underline">Webhooks</Link> e escolha os eventos. A cada evento sai um POST em
                JSON com os ids e os campos principais (para detalhes, consulte a API). Cabeçalhos: <code className="font-mono">X-NovoAluguel-Evento</code>,{" "}
                <code className="font-mono">X-NovoAluguel-Entrega</code> (id único: use para não processar duas vezes) e <code className="font-mono">X-NovoAluguel-Assinatura</code> ={" "}
                <code className="font-mono">sha256=</code> + HMAC-SHA256 do corpo com o segredo do webhook.
              </p>
              <p>
                Responda 2xx em até 10 segundos. Sem resposta, erro ou redirecionamento: nova tentativa em 5 min, 15 min, 45 min… até {MAX_TENTATIVAS_WEBHOOK} vezes (depois dá para
                reprocessar na tela). Eventos: {eventosDoModo(organizacao.modo).map((e) => e.id).join(", ")}.
              </p>
              <Codigo texto={exemploCorpo} />
              <p>Conferir a assinatura (Node.js):</p>
              <Codigo
                texto={`import { createHmac, timingSafeEqual } from "node:crypto";\n\nfunction assinaturaOk(corpoBruto, cabecalho, segredo) {\n  const esperado = "sha256=" + createHmac("sha256", segredo).update(corpoBruto, "utf8").digest("hex");\n  return cabecalho.length === esperado.length && timingSafeEqual(Buffer.from(cabecalho), Buffer.from(esperado));\n}`}
              />
              <p className="text-xs text-mudo">Use o corpo exatamente como chegou (texto), antes de converter para JSON. Total de eventos disponíveis: {EVENTOS_WEBHOOK.length}.</p>
            </div>
          </Cartao>
        </section>

        <section id="n8n">
          <Cartao titulo="6. Passo a passo no n8n (também vale para Make e Zapier)">
            <ol className="list-decimal space-y-2 pl-5 text-sm text-texto-2">
              <li>
                <strong>Receber eventos:</strong> crie um fluxo com o nó <em>Webhook</em> (método POST, “Respond: Immediately”) e copie a “Production URL”. Cadastre essa URL em Integrações ›
                Webhooks marcando os eventos. Use “Enviar teste” para ver o primeiro evento chegar.
              </li>
              <li>
                <strong>Conferir a assinatura (recomendado):</strong> no nó <em>Crypto</em>, ação HMAC, SHA256, valor = corpo bruto, segredo = o segredo do webhook; compare com o
                cabeçalho <code className="font-mono">x-novoaluguel-assinatura</code> num nó <em>IF</em>.
              </li>
              <li>
                <strong>Buscar detalhes ou mandar dados:</strong> nó <em>HTTP Request</em> com autenticação “Header Auth” (nome <code className="font-mono">Authorization</code>, valor{" "}
                <code className="font-mono">Bearer na_…</code>) e a URL, por exemplo <code className="font-mono">{base}/faturas/{"{{$json.body.dados.id}}"}</code>.
              </li>
              <li>
                <strong>Exemplos de uso:</strong> lead novo → mensagem no WhatsApp do corretor; cobrança quitada → planilha do Google; chamado aberto → grupo da manutenção; contrato
                criado → sistema contábil.
              </li>
            </ol>
          </Cartao>
        </section>

        <Aviso>
          Rotas da API: <code className="font-mono">/api/v1/…</code>. Especificação completa (para importar no Postman, Insomnia ou no n8n):{" "}
          <a href="/api/v1/openapi.json" className="text-acento hover:underline" target="_blank" rel="noopener noreferrer">
            /api/v1/openapi.json
          </a>
          .
        </Aviso>
      </div>
    </>
  );
}
