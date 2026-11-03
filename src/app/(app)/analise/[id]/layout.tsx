import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSignature, MessageCircle } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { SubAbas } from "@/components/sub-abas";
import { BotaoLink, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COR_STATUS_ANALISE, ROTULO_STATUS_ANALISE, aprovacaoVencida, linkNovoContrato } from "@/lib/dominio/analise";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { linkWhatsapp } from "@/lib/whatsapp";
import { excluirAnalise } from "../actions";

/** Cabeçalho e abas da ficha do candidato. */
export default async function AnaliseLayout({ children, params }: LayoutProps<"/analise/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const { data } = await supabase
    .from("analises")
    .select("id, numero, status, excecao, validade_ate, valor_aluguel, valor_encargos, imovel_id, candidato_id, contrato_id, candidato:pessoas!analises_candidato_id_fkey(nome, telefone), imovel:imoveis(id, codigo), contrato:contratos(id, numero)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const a = data as unknown as {
    id: string;
    numero: number;
    status: string;
    excecao: boolean;
    validade_ate: string | null;
    valor_aluguel: number;
    valor_encargos: number;
    imovel_id: string | null;
    candidato_id: string;
    contrato_id: string | null;
    candidato: { nome: string; telefone: string | null } | null;
    imovel: { id: string; codigo: string } | null;
    contrato: { id: string; numero: number } | null;
  };
  const nome = a.candidato?.nome ?? "Candidato";
  const base = `/analise/${id}`;
  const aprovada = a.status === "aprovada" || a.status === "aprovada_condicoes";
  const venceu = aprovacaoVencida(a, hojeISO());

  return (
    <>
      <div className="nao-imprimir mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/analise" className="text-acento-hot hover:underline">
              Análise cadastral
            </Link>
            <span className="text-fraco">›</span>
            <span>#{a.numero}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{nome}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={COR_STATUS_ANALISE[a.status]}>{ROTULO_STATUS_ANALISE[a.status]}</Selo>
            {a.excecao && <Selo cor="amarelo">Exceção</Selo>}
            <span className="font-semibold tabular-nums text-texto">{formatarReais(Number(a.valor_aluguel) + Number(a.valor_encargos))}/mês</span>
            {a.imovel && (
              <Link href={`/imoveis/${a.imovel.id}`} className="text-acento hover:underline">
                imóvel {a.imovel.codigo}
              </Link>
            )}
            {a.contrato && (
              <Link href={`/contratos/${a.contrato.id}`} className="text-acento hover:underline">
                contrato #{a.contrato.numero}
              </Link>
            )}
            {aprovada && a.validade_ate && <span className={venceu ? "text-ruim" : "text-mudo"}>aprovação {venceu ? "venceu" : "vale até"} {formatarDataBR(a.validade_ate)}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {a.candidato?.telefone && (
            <a href={linkWhatsapp(a.candidato.telefone, `Olá ${nome.split(" ")[0]}! Tudo bem?`)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
          {aprovada && !a.contrato_id && (
            <BotaoLink href={linkNovoContrato(a)} variante="primario">
              <FileSignature className="size-4" /> Criar contrato
            </BotaoLink>
          )}
          <BotaoExcluir
            acao={excluirAnalise}
            id={id}
            variante="botao"
            rotulo="Excluir"
            confirmar={`Excluir a análise de ${nome}? Os documentos enviados também saem. A auditoria continua guardada.`}
            depois="/analise"
          />
        </div>
      </div>
      <div className="nao-imprimir">
        <SubAbas
          rotulo="Análise"
          itens={[
            { href: base, rotulo: "Resumo" },
            { href: `${base}/documentos`, rotulo: "Documentos" },
            { href: `${base}/renda`, rotulo: "Renda" },
            { href: `${base}/credito`, rotulo: "Crédito" },
            { href: `${base}/fiadores`, rotulo: "Fiadores" },
            { href: `${base}/garantias`, rotulo: "Garantias" },
            { href: `${base}/decisao`, rotulo: "Decisão" },
            { href: `${base}/historico`, rotulo: "Histórico" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
