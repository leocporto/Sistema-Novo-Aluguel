import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, ClipboardCheck, FileText } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { SubAbas } from "@/components/sub-abas";
import { Aviso, BotaoLink, Cabecalho, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { ativarContrato } from "../locacao-actions";

const COR_STATUS = { ativo: "verde", rascunho: "amarelo", encerrado: "cinza", rescindido: "cinza" } as const;

/** Cabeçalho e abas da ficha do contrato (nos dois modos). */
export default async function ContratoLayout({ children, params }: LayoutProps<"/contratos/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data: c }, { data: atrasadas }, { data: desoc }] = await Promise.all([
    supabase.from("contratos").select("id, numero, codigo, status, imovel:imoveis(id, codigo, logradouro, numero, complemento, bairro, cidade)").eq("id", id).maybeSingle(),
    // Saldo de cada fatura vencida (desconta os pagamentos parciais).
    supabase.from("faturas").select("valor_total, valor_abatido").eq("contrato_id", id).eq("status", "aberta").lt("vencimento", hoje),
    supabase.from("contrato_desocupacoes").select("status").eq("contrato_id", id).maybeSingle(),
  ]);
  if (!c) notFound();
  const im = c.imovel as unknown as { id: string; codigo: string; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null };
  const base = `/contratos/${id}`;
  const emAtraso = (atrasadas ?? []).map((f) => paraCentavos(f.valor_total) - paraCentavos(f.valor_abatido ?? 0)).filter((v) => v > 0);

  return (
    <>
      <div className="nao-imprimir">
        <Cabecalho
          titulo={`Contrato #${c.numero}${c.codigo ? ` · ${c.codigo}` : ""}`}
          trilha="Contratos"
          descricao={
            <>
              <Link href={`/imoveis/${im.id}`} className="text-acento hover:underline">
                {im.codigo}
              </Link>{" "}
              — {[im.logradouro, im.numero, im.complemento, im.bairro, im.cidade].filter(Boolean).join(", ")}
            </>
          }
          acoes={
            <>
              <Selo cor={COR_STATUS[c.status as keyof typeof COR_STATUS] ?? "cinza"}>{c.status === "rascunho" ? "rascunho" : c.status}</Selo>
              {desoc && desoc.status !== "concluida" && <Selo cor="amarelo">em desocupação</Selo>}
              {c.status === "rascunho" && (
                <BotaoAcao acao={ativarContrato} id={id} variante="primario" confirmar="Ativar o contrato? O imóvel passa a constar como alugado e as cobranças podem ser geradas.">
                  <CheckCircle2 className="size-4" /> Ativar contrato
                </BotaoAcao>
              )}
              <BotaoLink href={`${base}/documento`} variante="secundario">
                <FileText className="size-4" /> Contrato (documento)
              </BotaoLink>
              <BotaoLink href={`/vistorias?contrato=${id}`} variante="secundario">
                <ClipboardCheck className="size-4" /> Vistorias
              </BotaoLink>
            </>
          }
        />
        {emAtraso.length > 0 && (
          <div className="mb-5">
            <Aviso tipo="erro">
              {emAtraso.length} fatura(s) em atraso, faltando {formatarReais(paraReais(emAtraso.reduce((s, v) => s + v, 0)))} (sem multa e juros).{" "}
              <Link href={`${base}/cobrancas`} className="underline">
                Ver cobranças
              </Link>
            </Aviso>
          </div>
        )}
        <SubAbas
          rotulo="Contrato"
          itens={[
            { href: base, rotulo: "Resumo" },
            { href: `${base}/cobrancas`, rotulo: "Cobranças e descontos" },
            { href: `${base}/partes`, rotulo: "Partes e garantias" },
            { href: `${base}/reajustes`, rotulo: "Reajustes, renovação e aditivos" },
            { href: `${base}/encerramento`, rotulo: "Desocupação e rescisão" },
            { href: `${base}/demonstrativos`, rotulo: "Demonstrativos" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
