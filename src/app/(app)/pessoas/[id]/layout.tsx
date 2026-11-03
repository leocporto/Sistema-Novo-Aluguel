import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, MessageCircle } from "lucide-react";
import { SubAbas } from "@/components/sub-abas";
import { BotaoLink, Cabecalho, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { pendencias } from "@/lib/dominio/pessoas";
import { rotaPermitida } from "@/lib/modos";
import { ROTULO_PAPEL, type Pessoa } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";

/** Cabeçalho da pessoa, documentação pendente e abas — comuns a todas as telas da ficha. */
export default async function PessoaLayout({ children, params }: LayoutProps<"/pessoas/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const [{ data }, { data: arquivos }] = await Promise.all([
    supabase.from("pessoas").select("*").eq("id", id).maybeSingle(),
    supabase.from("pessoa_arquivos").select("categoria").eq("pessoa_id", id),
  ]);
  if (!data) notFound();
  const p = data as Pessoa;
  const faltando = pendencias(p, (arquivos ?? []).map((a) => a.categoria as string), organizacao.modo);
  const base = `/pessoas/${id}`;
  const abas = [
    { href: base, rotulo: "Dados" },
    { href: `${base}/documentos`, rotulo: `Documentos${arquivos?.length ? ` (${arquivos.length})` : ""}` },
    { href: `${base}/relacionamento`, rotulo: "Relacionamento" },
    { href: `${base}/contatos`, rotulo: "Contatos vinculados" },
    { href: `${base}/comunicacao`, rotulo: "Comunicação (LGPD)" },
    { href: `${base}/interesse`, rotulo: "Interesse" },
  ].filter((a) => rotaPermitida(a.href, organizacao.modo));

  return (
    <>
      <Cabecalho
        titulo={p.nome}
        trilha="Pessoas"
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            {p.papeis.map((x) => (
              <Selo key={x} cor={x === "proprietario" ? "verde" : x === "locatario" ? "azul" : "cinza"}>
                {ROTULO_PAPEL[x] ?? x}
              </Selo>
            ))}
            <span>
              {p.tipo_pessoa === "PJ" ? "Pessoa jurídica" : "Pessoa física"}
              {p.documento ? ` · ${formatarDocumento(p.documento)}` : ""}
              {p.especialidade ? ` · ${p.especialidade}` : ""}
            </span>
          </span>
        }
        acoes={
          <>
            {p.telefone && (
              <a href={linkWhatsapp(p.telefone, `Olá ${p.nome.split(" ")[0]}! Tudo bem?`)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
                <MessageCircle className="size-4" /> WhatsApp
              </a>
            )}
            {!pessoal && p.papeis.includes("proprietario") && (
              <BotaoLink variante="secundario" href={`/repasses/extrato?pessoa=${p.id}`}>
                Extrato de repasses
              </BotaoLink>
            )}
            {(p.papeis.includes("locatario") || p.papeis.includes("fiador")) && (
              <BotaoLink variante="secundario" href={`/analise?novo=1&pessoa=${p.id}`}>
                Nova análise cadastral
              </BotaoLink>
            )}
            {p.papeis.includes("prestador") && (
              <BotaoLink variante="secundario" href="/manutencao/prestadores">
                Serviços e avaliação
              </BotaoLink>
            )}
          </>
        }
      />
      {faltando.length > 0 && (
        <div className="mb-4 flex flex-wrap items-start gap-3 rounded-card border border-alerta-bd bg-alerta-bg px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-alerta" />
          <div className="flex-1">
            <span className="font-semibold text-alerta">Documentação pendente: </span>
            <span className="text-texto-2">{faltando.join(" · ")}</span>
          </div>
          <Link href={`${base}/documentos`} className="text-xs font-semibold text-acento hover:underline">
            Enviar documentos
          </Link>
        </div>
      )}
      <SubAbas rotulo="Seções da pessoa" itens={abas} />
      {children}
    </>
  );
}
