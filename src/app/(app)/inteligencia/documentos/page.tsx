import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, FileWarning, MessageCircle } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Celula, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { ROTULO_ORIGEM_PENDENCIA, mensagemPedidoDocumentos, type PendenciaDoc } from "@/lib/dominio/ia";
import { linkWhatsapp } from "@/lib/whatsapp";
import { AbasInteligencia } from "../abas";
import { exigirOuVoltar } from "../dados";
import { carregarPendencias } from "./pendencias";

export const metadata: Metadata = { title: "Documentos pendentes" };

const ORIGENS: (PendenciaDoc["origem"] | "")[] = ["", "analise", "cadastro", "garantia", "seguro", "venda"];

/** Verificação assistida de documentos pendentes (por regra, nos dois modos; vendas só na imobiliária). */
export default async function DocumentosPendentesPage({ searchParams }: PageProps<"/inteligencia/documentos">) {
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  await exigirOuVoltar("pessoas", "ver");
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  // Falha ao ler (rede, banco) vira aviso na tela em vez de derrubar a página.
  const { lista: todasPendencias, erro } = await carregarPendencias(supabase, { hoje, pessoal, diasAviso: 60 }).then(
    (lista) => ({ lista, erro: null as string | null }),
    (e: unknown) => ({ lista: [] as PendenciaDoc[], erro: e instanceof Error ? e.message : "Não foi possível conferir os documentos agora." }),
  );
  const origem = ORIGENS.find((x) => x && x === sp.origem) ?? "";
  const lista = origem ? todasPendencias.filter((p) => p.origem === origem) : todasPendencias;
  const vencendo = todasPendencias.filter((p) => p.vence).length;
  const base = "/inteligencia/documentos";
  return (
    <>
      <Cabecalho
        titulo="Documentos pendentes"
        trilha="Assistente e automações"
        descricao="O que falta pedir, cruzando a análise cadastral, o cadastro de quem tem contrato ativo, as garantias e o seguro incêndio que vencem em até 60 dias e, na imobiliária, as vendas em andamento. Cada linha tem a mensagem pronta para pedir."
      />
      <AbasInteligencia modo={organizacao.modo} />
      {erro && (
        <div className="mb-4">
          <Aviso tipo="erro">{erro} Atualize a página para tentar de novo.</Aviso>
        </div>
      )}
      <div className="entrar-cascata mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Pessoas com pendência" valor={<Contador valor={todasPendencias.length} />} icone={<ClipboardList />} />
        <Indicador rotulo="Itens a pedir" valor={<Contador valor={todasPendencias.reduce((a, p) => a + p.itens.length, 0)} />} icone={<FileWarning />} tom={todasPendencias.length ? "alerta" : "neutro"} />
        <Indicador rotulo="Garantias e seguros vencendo" valor={<Contador valor={vencendo} />} icone={<FileWarning />} tom={vencendo ? "perigo" : "neutro"} detalhe="em até 60 dias (ou já vencidos)" />
      </div>
      <PilulasLink
        className="mb-4"
        rotulo="Filtrar por origem"
        ativo={origem ? `${base}?origem=${origem}` : base}
        itens={ORIGENS.filter((x) => !(pessoal && x === "venda")).map((x) => ({ href: x ? `${base}?origem=${x}` : base, rotulo: x ? ROTULO_ORIGEM_PENDENCIA[x] : "Tudo" }))}
      />
      <Tabela colunas={["Pessoa", "De onde", "O que falta", "Vence", "Pedir"]}>
        {lista.length === 0 ? (
          <LinhaVazia colunas={5}>Nada pendente.</LinhaVazia>
        ) : (
          lista.map((p) => {
            const msg = mensagemPedidoDocumentos(p.pessoa, p.itens, organizacao.nome);
            return (
              <tr key={p.chave}>
                <Celula className="font-semibold">
                  <Link href={p.link} className="hover:text-acento">
                    {p.pessoa}
                  </Link>
                </Celula>
                <Celula>
                  <Selo cor={p.origem === "garantia" || p.origem === "seguro" ? "amarelo" : "azul"}>{ROTULO_ORIGEM_PENDENCIA[p.origem]}</Selo>
                </Celula>
                <Celula className="text-[13px] text-texto-2">
                  <ul className="list-disc pl-4">
                    {p.itens.map((i) => (
                      <li key={i}>{i}</li>
                    ))}
                  </ul>
                </Celula>
                <Celula className="whitespace-nowrap">{p.vence ? <span className={p.vence < hoje ? "text-ruim" : "text-alerta"}>{formatarDataBR(p.vence)}</span> : "—"}</Celula>
                <Celula>
                  {p.telefone ? (
                    <a href={linkWhatsapp(p.telefone, msg)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-sm font-semibold text-acento hover:underline">
                      <MessageCircle className="size-4" /> WhatsApp
                    </a>
                  ) : p.email ? (
                    <a href={`mailto:${p.email}?subject=${encodeURIComponent("Documentos pendentes")}&body=${encodeURIComponent(msg)}`} className="text-sm font-semibold text-acento hover:underline">
                      E-mail
                    </a>
                  ) : (
                    <span className="text-xs text-mudo">Sem contato</span>
                  )}
                </Celula>
              </tr>
            );
          })
        )}
      </Tabela>
    </>
  );
}
