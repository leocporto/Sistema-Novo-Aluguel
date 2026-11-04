import Link from "next/link";
import { notFound } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { SubAbas } from "@/components/sub-abas";
import { Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { linkWhatsapp } from "@/lib/whatsapp";
import { excluirCondominio } from "../actions";
import { carregarCondominio } from "../dados";

/** Ficha do condomínio: cabeçalho e abas. */
export default async function CondominioLayout({ children, params }: LayoutProps<"/condominios/[id]">) {
  const { id } = await params;
  const { supabase, papel } = await obterContexto();
  const c = await carregarCondominio(supabase, id);
  if (!c) notFound();
  const base = `/condominios/${id}`;
  const endereco = [[c.logradouro, c.numero].filter(Boolean).join(", "), c.bairro, [c.cidade, c.uf].filter(Boolean).join(" / ")].filter(Boolean).join(" · ");

  return (
    <>
      <div className="nao-imprimir mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/condominios" className="text-acento-hot hover:underline">
              Condomínios
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{c.nome}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            {!c.ativo && <Selo cor="cinza">inativo</Selo>}
            {endereco && <span>{endereco}</span>}
            {c.cnpj && <span className="text-mudo">CNPJ {c.cnpj}</span>}
            {c.sindico && <span>Síndico: {c.sindico.nome}</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.sindico?.telefone && (
            <a href={linkWhatsapp(c.sindico.telefone, `Olá ${c.sindico.nome.split(" ")[0]}! Sobre o ${c.nome}: `)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> Síndico
            </a>
          )}
          {(papel === "admin" || papel === "gestor") && (
            <BotaoExcluir
              acao={excluirCondominio}
              id={id}
              variante="botao"
              rotulo="Excluir"
              confirmar={`Excluir o ${c.nome}? Unidades, cotas, lançamentos, assembleias e documentos saem junto. Se já houve cota recebida, o sistema não deixa (desative em vez de excluir).`}
              depois="/condominios"
            />
          )}
        </div>
      </div>
      <div className="nao-imprimir">
        <SubAbas
          rotulo="Condomínio"
          itens={[
            { href: base, rotulo: "Resumo" },
            { href: `${base}/unidades`, rotulo: "Unidades" },
            { href: `${base}/pessoas`, rotulo: "Pessoas" },
            { href: `${base}/financeiro`, rotulo: "Financeiro" },
            { href: `${base}/cotas`, rotulo: "Cotas" },
            { href: `${base}/inadimplencia`, rotulo: "Inadimplência" },
            { href: `${base}/fundo`, rotulo: "Fundo" },
            { href: `${base}/orcamento`, rotulo: "Orçamento" },
            { href: `${base}/fornecedores`, rotulo: "Fornecedores" },
            { href: `${base}/ocorrencias`, rotulo: "Ocorrências" },
            { href: `${base}/assembleias`, rotulo: "Assembleias" },
            { href: `${base}/comunicados`, rotulo: "Comunicados" },
            { href: `${base}/reservas`, rotulo: "Reservas" },
            { href: `${base}/documentos`, rotulo: "Documentos" },
            { href: `${base}/portal`, rotulo: "Portal" },
            { href: `${base}/relatorios`, rotulo: "Relatórios" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
