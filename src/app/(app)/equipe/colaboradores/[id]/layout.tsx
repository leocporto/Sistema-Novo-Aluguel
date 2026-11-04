import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeftRight, MessageCircle, UserRound } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { SubAbas } from "@/components/sub-abas";
import { BotaoLink, Selo, classeBotao } from "@/components/ui";
import { hojeISO } from "@/lib/dominio/datas";
import { COR_PAPEL_USUARIO, COR_VALIDADE, DIAS_AVISO_CRECI, ROTULO_PAPEL_USUARIO, formatarCreci, situacaoValidade, textoValidade } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { linkWhatsapp } from "@/lib/whatsapp";
import { deixarDeSerColaborador } from "../../actions";
import { SELECT_COLABORADOR, contextoEquipe, type Colaborador } from "../../dados";

/** Cabeçalho e abas da ficha do colaborador. */
export default async function ColaboradorLayout({ children, params }: LayoutProps<"/equipe/colaboradores/[id]">) {
  await exigirVerRota("/equipe");
  const { id } = await params;
  const { supabase, pode } = await contextoEquipe();
  const [{ data }, { data: membro }] = await Promise.all([
    supabase.from("pessoas").select(SELECT_COLABORADOR).eq("id", id).maybeSingle(),
    supabase.from("membros").select("papel").eq("pessoa_id", id).maybeSingle(),
  ]);
  if (!data) notFound();
  const c = data as Colaborador;
  const hoje = hojeISO();
  const cr = situacaoValidade(c.creci_validade, hoje, DIAS_AVISO_CRECI);
  const base = `/equipe/colaboradores/${id}`;
  const desligado = Boolean(c.desligamento && c.desligamento <= hoje);

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/equipe" className="text-acento-hot hover:underline">
              Equipe
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{c.nome}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            {c.cargo && <span>{c.cargo}</span>}
            {membro ? (
              <Selo cor={COR_PAPEL_USUARIO[membro.papel as keyof typeof COR_PAPEL_USUARIO] ?? "cinza"}>{ROTULO_PAPEL_USUARIO[membro.papel as string] ?? membro.papel}</Selo>
            ) : (
              <Selo>sem acesso ao sistema</Selo>
            )}
            {c.papeis.includes("corretor") && <Selo cor="azul">corretor</Selo>}
            {c.creci_numero && (
              <Selo cor={COR_VALIDADE[cr.situacao]}>
                {formatarCreci(c.creci_numero, c.creci_uf)} · {cr.situacao === "em_dia" ? "em dia" : cr.situacao === "sem_data" ? "sem validade" : textoValidade(cr.dias)}
              </Selo>
            )}
            {desligado && <Selo cor="vermelho">desligado</Selo>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {c.telefone && (
            <a href={linkWhatsapp(c.telefone)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> WhatsApp
            </a>
          )}
          <BotaoLink href={`/pessoas/${id}`} variante="secundario">
            <UserRound className="size-4" /> Cadastro em Pessoas
          </BotaoLink>
          {pode("equipe", "editar") && (
            <BotaoLink href={`/equipe/distribuicao?de=${id}`} variante="secundario">
              <ArrowLeftRight className="size-4" /> Redistribuir carteira
            </BotaoLink>
          )}
          {pode("equipe", "excluir") && !membro && (
            <BotaoExcluir
              acao={deixarDeSerColaborador}
              id={id}
              variante="botao"
              rotulo="Tirar da equipe"
              confirmar={`Tirar ${c.nome} da lista de colaboradores? O cadastro em Pessoas continua (e o histórico também).`}
              depois="/equipe"
            />
          )}
        </div>
      </div>
      <SubAbas
        rotulo="Colaborador"
        itens={[
          { href: base, rotulo: "Dados e acesso" },
          { href: `${base}/documentos`, rotulo: "Documentos" },
          { href: `${base}/clientes`, rotulo: "Clientes da carteira" },
          { href: `${base}/desempenho`, rotulo: "Desempenho e metas" },
        ]}
      />
      {children}
    </>
  );
}
