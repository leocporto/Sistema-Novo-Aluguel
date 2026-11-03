import Link from "next/link";
import { notFound } from "next/navigation";
import { Printer, Smartphone } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { SubAbas } from "@/components/sub-abas";
import { BotaoLink, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { COR_STATUS_VISTORIA, ROTULO_STATUS_VISTORIA, ROTULO_TIPO_VISTORIA, vistoriaEditavel } from "@/lib/dominio/vistorias";
import { excluirVistoria } from "../actions";

/** Cabeçalho e abas da ficha da vistoria. */
export default async function VistoriaLayout({ children, params }: LayoutProps<"/vistorias/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const { data } = await supabase
    .from("vistorias")
    .select("id, numero, tipo, status, data, imovel:imoveis(id, codigo, logradouro, numero), contrato:contratos(id, numero)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const v = data as unknown as {
    id: string;
    numero: number;
    tipo: string;
    status: string;
    data: string;
    imovel: { id: string; codigo: string; logradouro: string | null; numero: string | null } | null;
    contrato: { id: string; numero: number } | null;
  };
  const base = `/vistorias/${id}`;

  return (
    <>
      <div className="nao-imprimir mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/vistorias" className="text-acento-hot hover:underline">
              Vistorias
            </Link>
            <span className="text-fraco">›</span>
            <span>#{v.numero}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">
            Vistoria de {ROTULO_TIPO_VISTORIA[v.tipo].toLowerCase()} · {v.imovel?.codigo ?? "Imóvel"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={COR_STATUS_VISTORIA[v.status]}>{ROTULO_STATUS_VISTORIA[v.status]}</Selo>
            <span className="tabular-nums">{formatarDataBR(v.data)}</span>
            {v.imovel && (
              <Link href={`/imoveis/${v.imovel.id}`} className="text-acento hover:underline">
                {[v.imovel.logradouro, v.imovel.numero].filter(Boolean).join(", ") || "ver imóvel"}
              </Link>
            )}
            {v.contrato && (
              <Link href={`/contratos/${v.contrato.id}`} className="text-acento hover:underline">
                contrato nº {v.contrato.numero}
              </Link>
            )}
            {v.imovel && (
              <Link href={`/vistorias?imovel=${v.imovel.id}`} className="text-acento hover:underline">
                histórico do imóvel
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {vistoriaEditavel(v.status) && (
            <BotaoLink href={`/vistorias/campo/${id}`} variante="primario">
              <Smartphone className="size-4" /> Abrir no celular
            </BotaoLink>
          )}
          <BotaoLink href={`${base}/laudo`} variante="secundario">
            <Printer className="size-4" /> Laudo em PDF
          </BotaoLink>
          <BotaoExcluir
            acao={excluirVistoria}
            id={id}
            variante="botao"
            rotulo="Excluir"
            confirmar="Excluir esta vistoria com o checklist, fotos, medidores, pendências e contestações? (o laudo já gerado continua em Documentos)"
            depois="/vistorias"
          />
        </div>
      </div>
      <div className="nao-imprimir">
        <SubAbas
          rotulo="Vistoria"
          itens={[
            { href: base, rotulo: "Resumo" },
            { href: `${base}/ambientes`, rotulo: "Ambientes e checklist" },
            { href: `${base}/medidores`, rotulo: "Medidores" },
            { href: `${base}/fotos`, rotulo: "Fotos e vídeos" },
            { href: `${base}/comparacao`, rotulo: "Comparação" },
            { href: `${base}/pendencias`, rotulo: "Danos e orçamentos" },
            { href: `${base}/assinaturas`, rotulo: "Assinatura e contestação" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
