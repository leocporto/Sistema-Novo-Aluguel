import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { Bell, BellOff, CircleDollarSign, FileSearch, FileText, Home, MessageSquareReply, NotebookPen, ScanText, Search } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { AbasInteligencia } from "./abas";
import { marcarAvisoLido } from "./actions";
import { AvisoIA } from "./componentes";
import { estadoIA, podeConfigurarIA, quando } from "./dados";
import { Pergunta } from "./pergunta";

export const metadata: Metadata = { title: "Assistente e automações" };

type Ferramenta = { href: string; titulo: string; texto: string; icone: ReactNode; soImob?: boolean; regra?: boolean };

const FERRAMENTAS: Ferramenta[] = [
  { href: "/inteligencia/busca", titulo: "Imóveis por texto", texto: "Escreva o que o cliente quer e veja os imóveis disponíveis que combinam.", icone: <Search />, regra: true },
  { href: "/inteligencia/anuncio", titulo: "Descrição de anúncio", texto: "Título e texto do anúncio a partir do cadastro, sem inventar nada. Grava só se você aceitar.", icone: <FileText />, regra: true },
  { href: "/inteligencia/resumo", titulo: "Resumir conversas e anotações", texto: "Resumo do histórico de uma pessoa, lead ou conversa do WhatsApp.", icone: <NotebookPen />, regra: true },
  { href: "/inteligencia/extrair", titulo: "Ler documento", texto: "RG, CNH, renda, conta de consumo ou contrato viram uma prévia para conferir.", icone: <ScanText /> },
  { href: "/inteligencia/documentos", titulo: "Documentos pendentes", texto: "O que falta em análises, cadastros, garantias, seguros e vendas, com mensagem pronta.", icone: <FileSearch />, regra: true },
  { href: "/inteligencia/preco", titulo: "Preço por comparáveis", texto: "Faixa de aluguel ou venda pela mediana do m² dos parecidos da sua carteira.", icone: <CircleDollarSign />, regra: true },
  { href: "/inteligencia/atendimento", titulo: "Atendimento e qualificação", texto: "Resposta sugerida, perguntas de qualificação e resposta fora do horário.", icone: <MessageSquareReply />, soImob: true, regra: true },
];

/** Assistente: perguntas ao sistema, avisos das automações e as ferramentas de IA. */
export default async function AssistentePage() {
  const { supabase, organizacao, papel, usuario } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const [ia, { data: avisos }] = await Promise.all([
    estadoIA(supabase),
    supabase.from("ia_avisos").select("id, titulo, texto, link, criado_em").eq("usuario_id", usuario.id).is("lido_em", null).order("criado_em", { ascending: false }).limit(20),
  ]);
  const lista = (avisos ?? []) as { id: string; titulo: string; texto: string | null; link: string | null; criado_em: string }[];
  const exemplos = pessoal
    ? ["Quanto recebi de aluguel este ano?", "Quais contratos vencem em 90 dias?", "Quem está devendo?"]
    : ["Quanto recebi de aluguel em outubro?", "Quais contratos vencem em 60 dias?", "Quantos leads chegaram mês passado?"];

  return (
    <>
      <Cabecalho
        titulo="Assistente e automações"
        descricao="Pergunte ao sistema em português, use as ferramentas de IA e acompanhe as automações. A IA só sugere: o que muda dados ou fala com cliente passa por aprovação de uma pessoa."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <AvisoIA configurada={ia.configurada} ativa={ia.config.ativa} podeConfigurar={podeConfigurarIA(papel)} />
        {lista.length > 0 && (
          <Cartao
            titulo={
              <span className="flex items-center gap-2">
                <Bell className="size-4 text-acento-hot" /> Avisos das automações para você ({lista.length})
              </span>
            }
            acoes={
              <BotaoAcao acao={marcarAvisoLido} id="todos" tamanho="sm">
                <BellOff className="size-3.5" /> Marcar todos como lidos
              </BotaoAcao>
            }
          >
            <ul className="divide-y divide-borda-suave">
              {lista.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    {a.link ? (
                      <Link href={a.link} className="font-semibold text-texto hover:text-acento">
                        {a.titulo}
                      </Link>
                    ) : (
                      <span className="font-semibold text-texto">{a.titulo}</span>
                    )}
                    <div className="text-xs text-mudo">
                      {a.texto} · {quando(a.criado_em)}
                    </div>
                  </div>
                  <BotaoAcao acao={marcarAvisoLido} id={a.id} tamanho="sm" variante="fantasma">
                    Lido
                  </BotaoAcao>
                </li>
              ))}
            </ul>
          </Cartao>
        )}
        <Cartao titulo="Pergunte ao sistema">
          <p className="mb-3 text-[13px] text-texto-2">
            O assistente escolhe uma consulta pronta (aluguel recebido, atrasos, contratos vencendo, despesas, imóveis vagos{pessoal ? "" : ", repasses, leads"}, chamados e seus relatórios
            personalizados), roda com o seu acesso e mostra de onde veio cada número. Sem IA, entende as perguntas mais comuns por palavras-chave.
          </p>
          <Pergunta exemplos={exemplos} />
        </Cartao>
        <section aria-labelledby="ferramentas">
          <h2 id="ferramentas" className="mb-3 text-[17px] font-semibold tracking-[-0.01em] text-texto">
            Ferramentas
          </h2>
          <div className="entrar-cascata grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {FERRAMENTAS.filter((f) => !(pessoal && f.soImob)).map((f) => (
              <Link key={f.href} href={f.href} className="flex h-full flex-col gap-2 rounded-card border border-borda bg-card p-5 transition hover:-translate-y-px hover:border-borda-forte">
                <span className="flex size-8 items-center justify-center rounded-[10px] border border-acento-bd bg-acento-bg text-acento-hot [&>svg]:size-4">{f.icone}</span>
                <span className="text-[15px] font-semibold text-texto">{f.titulo}</span>
                <span className="text-[13px] leading-relaxed text-texto-2">{f.texto}</span>
                <span className="mt-auto text-xs text-mudo">{f.regra ? "Funciona também sem IA (por regra)." : "Precisa da IA ligada."}</span>
              </Link>
            ))}
          </div>
        </section>
        <p className="flex items-center gap-1.5 text-xs text-mudo">
          <Home className="size-3.5" /> Os textos que você manda para a IA vão sem CPF, RG, conta bancária, e-mail e telefone; tudo fica no Histórico.
        </p>
      </div>
    </>
  );
}
