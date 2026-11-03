import Link from "next/link";
import { notFound } from "next/navigation";
import { ClipboardCheck, Copy, ImageIcon, Wrench } from "lucide-react";
import { BotaoEnviar } from "@/components/formulario";
import { SubAbas } from "@/components/sub-abas";
import { BotaoLink, Cabecalho, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { rotaPermitida } from "@/lib/modos";
import { ROTULO_STATUS_IMOVEL } from "@/lib/tipos";
import { duplicarImovel } from "../actions";

const COR = { disponivel: "vermelho", alugado: "verde", reservado: "amarelo", vendido: "cinza", inativo: "cinza" } as const;

/** Cabeçalho do imóvel (com a foto de capa) e as abas, comuns a todas as telas do imóvel. */
export default async function ImovelLayout({ children, params }: LayoutProps<"/imoveis/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const [{ data: im }, { data: capa }] = await Promise.all([
    supabase
      .from("imoveis")
      .select("id, codigo, status, logradouro, numero, complemento, bairro, cidade, exclusivo, empreendimento:empreendimentos(id, nome)")
      .eq("id", id)
      .maybeSingle(),
    supabase.from("imovel_midias").select("path").eq("imovel_id", id).eq("tipo", "foto").order("capa", { ascending: false }).order("ordem").limit(1),
  ]);
  if (!im) notFound();
  const imovel = im as unknown as {
    id: string;
    codigo: string;
    status: string;
    logradouro: string | null;
    numero: string | null;
    complemento: string | null;
    bairro: string | null;
    cidade: string | null;
    exclusivo: boolean;
    empreendimento: { id: string; nome: string } | null;
  };
  let urlCapa: string | null = null;
  if (capa?.[0]) {
    const { data } = await supabase.storage.from("imoveis").createSignedUrl(capa[0].path as string, 3600);
    urlCapa = data?.signedUrl ?? null;
  }
  const base = `/imoveis/${id}`;
  const abas = [
    { href: base, rotulo: "Dados" },
    { href: `${base}/midia`, rotulo: "Fotos e mídia" },
    { href: `${base}/documentos`, rotulo: "Documentos" },
    { href: `${base}/historico`, rotulo: "Histórico" },
    { href: `${base}/comercializacao`, rotulo: "Comercialização" },
  ].filter((a) => rotaPermitida(a.href, organizacao.modo));

  return (
    <>
      <div className="flex items-start gap-4">
        <Link
          href={`${base}/midia`}
          className="mt-1 hidden size-[76px] shrink-0 place-items-center overflow-hidden rounded-[16px] border border-borda bg-elev text-mudo sm:grid"
          title="Fotos do imóvel"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {urlCapa ? <img src={urlCapa} alt="" className="size-full object-cover" /> : <ImageIcon className="size-6" />}
        </Link>
        <div className="min-w-0 flex-1">
          <Cabecalho
            titulo={`Imóvel ${imovel.codigo}`}
            trilha="Imóveis"
            descricao={
              <span className="flex flex-wrap items-center gap-2">
                <Selo cor={COR[imovel.status as keyof typeof COR] ?? "cinza"}>{ROTULO_STATUS_IMOVEL[imovel.status] ?? imovel.status}</Selo>
                {organizacao.modo !== "pessoal" && imovel.exclusivo && <Selo cor="azul">exclusivo</Selo>}
                <span>{[imovel.logradouro, imovel.numero, imovel.complemento, imovel.bairro, imovel.cidade].filter(Boolean).join(", ") || "Sem endereço"}</span>
                {organizacao.modo !== "pessoal" && imovel.empreendimento && (
                  <Link href={`/empreendimentos/${imovel.empreendimento.id}`} className="text-acento hover:underline">
                    {imovel.empreendimento.nome}
                  </Link>
                )}
              </span>
            }
            acoes={
              <>
                <form action={duplicarImovel}>
                  <input type="hidden" name="id" value={id} />
                  <BotaoEnviar variante="secundario" confirmar="Criar uma cópia deste imóvel (sem fotos e documentos)?">
                    <Copy className="size-4" /> Duplicar
                  </BotaoEnviar>
                </form>
                <BotaoLink href={`/vistorias?imovel=${id}`} variante="secundario">
                  <ClipboardCheck className="size-4" /> Vistorias
                </BotaoLink>
                <BotaoLink href={`/manutencao/historico?imovel=${id}`} variante="secundario">
                  <Wrench className="size-4" /> Reparos
                </BotaoLink>
                <BotaoLink href={`/contratos/novo?imovel=${id}`}>Novo contrato de locação</BotaoLink>
              </>
            }
          />
        </div>
      </div>
      <SubAbas rotulo="Seções do imóvel" itens={abas} />
      {children}
    </>
  );
}
