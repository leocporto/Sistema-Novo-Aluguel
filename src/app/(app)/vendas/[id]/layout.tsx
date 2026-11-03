import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, MessageCircle, Printer } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { SubAbas } from "@/components/sub-abas";
import { BotaoLink, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_ETAPA_VENDA } from "@/lib/dominio/vendas";
import { linkWhatsapp } from "@/lib/whatsapp";
import { concluirVenda, excluirVenda } from "../actions";
import { nomeComprador, telefoneComprador, type Venda } from "../dados";

/** Cabeçalho e abas da ficha da venda. */
export default async function VendaLayout({ children, params }: LayoutProps<"/vendas/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const { data } = await supabase
    .from("vendas")
    .select("id, numero, status, valor, comprador_nome, comprador_telefone, imovel:imoveis(id, codigo), comprador:pessoas!vendas_comprador_id_fkey(nome, telefone), lead:leads(nome, telefone)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const v = data as unknown as Pick<Venda, "id" | "numero" | "status" | "valor" | "comprador_nome" | "comprador_telefone" | "lead" | "comprador"> & { imovel: { id: string; codigo: string } | null };
  const comprador = nomeComprador(v);
  const tel = telefoneComprador(v);
  const aberta = v.status !== "concluida" && v.status !== "cancelada";
  const base = `/vendas/${id}`;

  return (
    <>
      <div className="nao-imprimir mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/vendas" className="text-acento-hot hover:underline">
              Vendas
            </Link>
            <span className="text-fraco">›</span>
            <span>#{v.numero}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">
            {v.imovel?.codigo ?? "Venda"} · {comprador}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={v.status === "concluida" ? "verde" : v.status === "cancelada" ? "cinza" : "azul"}>{ROTULO_ETAPA_VENDA[v.status]}</Selo>
            <span className="font-semibold tabular-nums text-texto">{formatarReais(v.valor)}</span>
            {v.imovel && (
              <Link href={`/imoveis/${v.imovel.id}`} className="text-acento hover:underline">
                ver imóvel
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {tel && (
            <a href={linkWhatsapp(tel, `Olá ${comprador.split(" ")[0]}! Tudo bem?`)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
          <BotaoLink href={`/documentos?novo=1&venda=${id}${v.imovel ? `&imovel=${v.imovel.id}` : ""}`} variante="secundario">
            Gerar documento
          </BotaoLink>
          <BotaoLink href={`${base}/contrato`} variante="secundario">
            <Printer className="size-4" /> Contrato de compra e venda
          </BotaoLink>
          {aberta && (
            <BotaoAcao acao={concluirVenda} id={id} variante="primario" confirmar='Concluir a venda? O imóvel vira "vendido", o lead fica como ganho, a comissão da imobiliária entra no financeiro como "a receber" e a parte de cada corretor vira conta a pagar (ou fica prevista até a imobiliária receber, se a regra mandar).'>
              <CheckCircle2 className="size-4" /> Concluir venda
            </BotaoAcao>
          )}
          <BotaoExcluir acao={excluirVenda} id={id} variante="botao" rotulo="Excluir" confirmar="Excluir esta venda? Comissões ainda não pagas saem junto." depois="/vendas" />
        </div>
      </div>
      <div className="nao-imprimir">
        <SubAbas
          rotulo="Venda"
          itens={[
            { href: base, rotulo: "Resumo" },
            { href: `${base}/propostas`, rotulo: "Propostas" },
            { href: `${base}/pagamentos`, rotulo: "Pagamentos e financiamento" },
            { href: `${base}/documentos`, rotulo: "Documentação" },
            { href: `${base}/transferencia`, rotulo: "ITBI, escritura e registro" },
            { href: `${base}/comissoes`, rotulo: "Comissões" },
            { href: `${base}/posse`, rotulo: "Posse e pós-venda" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
