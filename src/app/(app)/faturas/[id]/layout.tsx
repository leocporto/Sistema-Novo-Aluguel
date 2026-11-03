import Link from "next/link";
import { notFound } from "next/navigation";
import { CircleDollarSign, Receipt } from "lucide-react";
import { Copiar } from "@/components/copiar";
import { BotaoImprimir } from "@/components/formulario";
import { SubAbas } from "@/components/sub-abas";
import { BotaoLink, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diasEntre, formatarCompetencia } from "@/lib/dominio/datas";
import { BotaoCobrar } from "../../cobrancas/cobrar";
import { carregarCobrancas, carregarRegras, configCobranca, contasAtivas, linkPagar, montarCobrar, recebedorPix, urlBase } from "../../cobrancas/dados";
import { carregarFicha } from "../ficha";
import { BotaoDesfazer, BotaoReceber } from "../recebimento";

/** Cabeçalho e abas da ficha da cobrança (nos dois modos). */
export default async function FaturaLayout({ children, params }: LayoutProps<"/faturas/[id]">) {
  const { id } = await params;
  const ficha = await carregarFicha(id);
  if (!ficha) notFound();
  const { supabase, organizacao } = await obterContexto();
  const { fatura, dados, locatario, alvo, hoje, imovelTexto } = ficha;
  const cfg = configCobranca(organizacao);
  const aberta = fatura.status === "aberta";
  const atraso = aberta ? diasEntre(fatura.vencimento, hoje) : 0;
  const base = `/faturas/${id}`;
  const [contas, base2, regras, recebedor, [cob]] = await Promise.all([
    aberta ? contasAtivas(supabase) : Promise.resolve([]),
    urlBase(),
    aberta ? carregarRegras(supabase) : Promise.resolve([]),
    aberta ? recebedorPix(supabase, organizacao) : Promise.resolve(null),
    aberta ? carregarCobrancas(supabase, hoje, { ids: [id] }) : Promise.resolve([]),
  ]);
  const link = linkPagar(base2, fatura.token_publico);
  const cor = fatura.status === "paga" ? "verde" : fatura.status === "renegociada" ? "azul" : fatura.status === "cancelada" ? "cinza" : atraso > 0 ? "vermelho" : "amarelo";
  const rotuloStatus =
    fatura.status === "renegociada" ? "em acordo" : fatura.status === "aberta" ? (ficha.sit?.parcial ? "pago parcial" : atraso > 0 ? `${atraso} dia(s) em atraso` : "em aberto") : fatura.status;

  return (
    <>
      <div className="nao-imprimir mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 max-w-[760px]">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href={`/faturas?mes=${fatura.competencia.slice(0, 7)}`} className="text-acento-hot hover:underline">
              Aluguéis do mês
            </Link>
            <span className="text-fraco">›</span>
            <span>Cobrança #{fatura.numero}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">
            {locatario?.nome ?? "Cobrança"} · {formatarCompetencia(fatura.competencia)}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={cor}>{rotuloStatus}</Selo>
            <span>{imovelTexto}</span>
            <Link href={`/contratos/${dados.contrato.id}/cobrancas`} className="text-acento hover:underline">
              contrato #{dados.contrato.numero}
            </Link>
            {fatura.acordo_id && (
              <Link href={`/cobrancas/acordos/${fatura.acordo_id}`} className="text-acento hover:underline">
                ver acordo
              </Link>
            )}
            {fatura.juridico_id && (
              <Link href={`/cobrancas/juridico/${fatura.juridico_id}`} className="text-acento hover:underline">
                cobrança jurídica
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {aberta && (
            <BotaoReceber alvo={alvo} opcoes={{ hoje, organizacaoId: organizacao.id, contas: contas.map((c) => ({ id: c.id, nome: c.nome })), contaPadrao: cfg.contaId }}>
              <CircleDollarSign className="size-4" /> Receber
            </BotaoReceber>
          )}
          {aberta && cob && <BotaoCobrar dados={montarCobrar(cob, regras, { base: base2, recebedor, cfg })} rotuloBotao={atraso > 0 ? "Cobrar" : "Lembrar"} variante="secundario" />}
          {aberta && cfg.linkPublico && <Copiar texto={link} rotulo="Copiar link da 2ª via" />}
          {fatura.status === "paga" && (
            <>
              <BotaoLink href={`${base}/recibo`} variante="secundario">
                <Receipt className="size-4" /> Recibo
              </BotaoLink>
              {ficha.desfazer && (
                <BotaoDesfazer
                  faturaId={fatura.id}
                  titulo={locatario?.nome ?? "Cobrança"}
                  {...ficha.desfazer}
                  pessoal={organizacao.modo === "pessoal"}
                  rotulo={ficha.desfazer.outros > 0 ? "Desfazer último recebimento" : "Desfazer recebimento"}
                />
              )}
            </>
          )}
          <BotaoImprimir />
        </div>
      </div>
      <div className="nao-imprimir">
        <SubAbas
          rotulo="Cobrança"
          itens={[
            { href: base, rotulo: "Cobrança e 2ª via" },
            { href: `${base}/pagamentos`, rotulo: `Recebimentos (${ficha.pagamentos.length})` },
            { href: `${base}/historico`, rotulo: "Contatos e histórico" },
            ...(fatura.status === "paga" ? [{ href: `${base}/recibo`, rotulo: "Recibo" }] : []),
          ]}
        />
      </div>
      {children}
    </>
  );
}
