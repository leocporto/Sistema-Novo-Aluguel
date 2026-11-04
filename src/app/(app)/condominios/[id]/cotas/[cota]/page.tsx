import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle, Undo2 } from "lucide-react";
import { Copiar } from "@/components/copiar";
import { BotaoImprimir } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Campo, Cartao, Celula, Definicao, Entrada, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COR_STATUS_COTA, STATUS_COTA, TIPOS_COTA, nomeUnidade, situacaoCota, txidCota } from "@/lib/dominio/condominios";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { gerarPixCopiaCola } from "@/lib/dominio/pix";
import { linkWhatsapp } from "@/lib/whatsapp";
import { estornarPagamento } from "../../../actions";
import { carregarCondominio } from "../../../dados";

export const metadata: Metadata = { title: "2ª via da cota" };

/** 2ª via da cota (para imprimir ou mandar): itens, saldo, multa e juros de hoje e Pix copia e cola; recebimentos e estorno. */
export default async function SegundaViaCota({ params }: PageProps<"/condominios/[id]/cotas/[cota]">) {
  const { id, cota } = await params;
  const { supabase } = await obterContexto();
  const c = await carregarCondominio(supabase, id);
  const [{ data: q }, { data: itens }, { data: pags }] = await Promise.all([
    supabase.from("cond_cotas").select("id, numero, tipo, competencia, vencimento, valor, valor_abatido, status, unidade_id, unidade:cond_unidades(numero, bloco:cond_blocos(nome))").eq("id", cota).eq("condominio_id", id).maybeSingle(),
    supabase.from("cond_cota_itens").select("id, tipo, descricao, valor").eq("cota_id", cota).order("tipo"),
    supabase.from("cond_cota_pagamentos").select("id, data, valor, principal, multa, juros, desconto, forma, estornado_em, estorno_motivo").eq("cota_id", cota).order("data"),
  ]);
  if (!c || !q) notFound();
  const { data: resp } = await supabase
    .from("cond_pessoas_unidade")
    .select("pessoa:pessoas(nome, telefone)")
    .eq("unidade_id", q.unidade_id as string)
    .is("fim", null)
    .order("responsavel_financeiro", { ascending: false })
    .limit(1)
    .maybeSingle();
  const pessoa = (resp?.pessoa as unknown as { nome: string; telefone: string | null } | null) ?? null;
  const hoje = hojeISO();
  const validos = (pags ?? []).filter((p) => !p.estornado_em);
  const s = situacaoCota(
    { valor: paraCentavos(q.valor as number), vencimento: q.vencimento as string },
    validos.map((p) => ({ data: p.data as string, valor: paraCentavos(p.valor as number), principal: paraCentavos(p.principal as number), multa: paraCentavos(p.multa as number), juros: paraCentavos(p.juros as number), desconto: paraCentavos(p.desconto as number) })),
    { multaPct: Number(c.multa_pct), jurosMesPct: Number(c.juros_mes_pct) },
    hoje,
  );
  const unidade = nomeUnidade(q.unidade as unknown as { numero: string; bloco: { nome: string } | null });
  let pix: string | null = null;
  if (q.status === "aberta" && c.pix_chave && s.totalComEncargos > 0) {
    try {
      pix = gerarPixCopiaCola({ chave: c.pix_chave, nome: c.pix_nome ?? c.nome, cidade: c.pix_cidade ?? c.cidade, valor: s.totalComEncargos, txid: txidCota(q.numero as number), descricao: `Cota ${formatarCompetencia(q.competencia as string)} ${unidade}` });
    } catch {
      pix = null;
    }
  }
  const mensagem = `Olá${pessoa ? `, ${pessoa.nome.split(" ")[0]}` : ""}! Segue a cota do ${c.nome} (unidade ${unidade}, ${formatarCompetencia(q.competencia as string)}): ${formatarReais(paraReais(s.totalComEncargos))}, vencimento ${formatarDataBR(q.vencimento as string)}.${pix ? `\n\nPix copia e cola:\n${pix}` : ""}`;

  return (
    <div className="space-y-5">
      <div className="nao-imprimir flex flex-wrap items-center justify-between gap-2">
        <Link href={`/condominios/${id}/cotas?mes=${String(q.competencia).slice(0, 7)}`} className={classeBotao("fantasma")}>
          <ArrowLeft className="size-4" /> Cotas
        </Link>
        <div className="flex flex-wrap gap-2">
          {pessoa?.telefone && q.status === "aberta" && (
            <a href={linkWhatsapp(pessoa.telefone, mensagem)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> Mandar no WhatsApp
            </a>
          )}
          <BotaoImprimir />
        </div>
      </div>

      <Cartao titulo={`${c.nome} — cota nº ${q.numero}`}>
        <Definicao
          itens={[
            ["Unidade", unidade],
            ["Responsável", pessoa?.nome ?? "—"],
            ["Competência", formatarCompetencia(q.competencia as string)],
            ["Vencimento", formatarDataBR(q.vencimento as string)],
            ["Tipo", TIPOS_COTA[q.tipo as keyof typeof TIPOS_COTA] ?? (q.tipo as string)],
            ["Situação", <Selo key="s" cor={COR_STATUS_COTA[q.status as string] ?? "cinza"}>{STATUS_COTA[q.status as keyof typeof STATUS_COTA] ?? (q.status as string)}</Selo>],
          ]}
        />
        <div className="mt-5">
          <Tabela colunas={["Item", "Valor"]}>
            {(itens ?? []).map((i) => (
              <tr key={i.id as string}>
                <Celula>{i.descricao as string}</Celula>
                <Celula className="tabular-nums">{formatarReais(i.valor as number)}</Celula>
              </tr>
            ))}
            <tr>
              <Celula className="font-semibold">Total da cota</Celula>
              <Celula className="font-semibold tabular-nums">{formatarReais(q.valor as number)}</Celula>
            </tr>
          </Tabela>
        </div>
        {q.status === "aberta" && (
          <div className="mt-4 space-y-1 text-sm text-texto-2">
            {s.abatido > 0 && <p>Já pago: {formatarReais(paraReais(s.abatido))} · saldo {formatarReais(paraReais(s.saldo))}</p>}
            {s.multa + s.juros > 0 && (
              <p>
                Em atraso há {s.diasAtraso} dia(s): multa {formatarReais(paraReais(s.multa))} ({c.multa_pct}%) e juros {formatarReais(paraReais(s.juros))} ({c.juros_mes_pct}% ao mês).
              </p>
            )}
            <p className="text-[18px] font-semibold text-texto">Para pagar hoje: {formatarReais(paraReais(s.totalComEncargos))}</p>
          </div>
        )}
      </Cartao>

      {q.status === "aberta" &&
        (pix ? (
          <Cartao titulo="Pix copia e cola">
            <p className="mb-2 break-all rounded-[12px] border border-borda bg-elev p-3 font-mono text-xs text-texto">{pix}</p>
            <div className="nao-imprimir">
              <Copiar texto={pix} rotulo="Copiar código Pix" />
            </div>
            <p className="mt-2 text-xs text-mudo">O valor inclui multa e juros de hoje. Pagou outro dia? Gere de novo.</p>
          </Cartao>
        ) : (
          <Aviso tipo="alerta">
            Sem chave Pix do condomínio: cadastre no Resumo para a 2ª via sair com o Pix copia e cola.
            {c.banco ? ` Depósito: ${c.banco} ag. ${c.agencia ?? "—"} c/c ${c.conta ?? "—"}.` : ""}
          </Aviso>
        ))}

      {(pags ?? []).length > 0 && (
        <Cartao titulo="Recebimentos">
          <Tabela colunas={["Data", "Valor", "Multa + juros", "Desconto", "Situação", ""]}>
            {(pags ?? []).map((p) => (
              <tr key={p.id as string} className={p.estornado_em ? "opacity-60" : ""}>
                <Celula>{formatarDataBR(p.data as string)}</Celula>
                <Celula className="tabular-nums">{formatarReais(p.valor as number)}</Celula>
                <Celula className="tabular-nums">{formatarReais(Number(p.multa) + Number(p.juros))}</Celula>
                <Celula className="tabular-nums">{formatarReais(p.desconto as number)}</Celula>
                <Celula>{p.estornado_em ? <Selo cor="cinza">desfeito: {p.estorno_motivo as string}</Selo> : <Selo cor="verde">recebido</Selo>}</Celula>
                <Celula>
                  {!p.estornado_em && (
                    <span className="nao-imprimir">
                      <JanelaCadastro rotuloBotao={<Undo2 className="size-4" />} variante="fantasma" tamanho="sm" titulo="Desfazer recebimento" acao={estornarPagamento} icone={<Undo2 />} rotuloSalvar="Desfazer">
                        <input type="hidden" name="condominio_id" value={id} />
                        <input type="hidden" name="pagamento_id" value={p.id as string} />
                        <p className="text-sm text-texto-2">
                          Tira {formatarReais(p.valor as number)} de {formatarDataBR(p.data as string)} do livro-caixa e a cota volta a ficar em aberto. Mês fechado não deixa.
                        </p>
                        <Campo rotulo="Motivo">
                          <Entrada name="motivo" required placeholder="Ex.: lançado na cota errada" />
                        </Campo>
                      </JanelaCadastro>
                    </span>
                  )}
                </Celula>
              </tr>
            ))}
          </Tabela>
        </Cartao>
      )}
    </div>
  );
}
