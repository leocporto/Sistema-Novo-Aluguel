import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CalendarClock, Gavel, Handshake, Scale, Users } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, BotaoLink, Cabecalho, Campo, Cartao, Entrada, Indicador, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { aging, FAIXAS_ATRASO, faixaAtraso, textoDias } from "@/lib/dominio/cobrancas";
import { formatarCompetencia, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasCobrancas } from "./abas";
import { encaminharJuridico } from "./actions";
import { JanelaContato } from "./campos";
import { BotaoCobrar } from "./cobrar";
import { carregarCobrancas, carregarRegras, configCobranca, montarCobrar, reais, recebedorPix, urlBase, type CobrancaDoSistema } from "./dados";
import { RotinaEnvioAutomatico } from "./rotina";

export const metadata: Metadata = { title: "Cobranças" };

const DIAS_A_VENCER = 5;

export default async function CobrancasPage({ searchParams }: PageProps<"/cobrancas">) {
  const sp = await searchParams;
  const faixa = typeof sp.faixa === "string" && FAIXAS_ATRASO.some((f) => f.id === sp.faixa) ? sp.faixa : "";
  const busca = typeof sp.busca === "string" ? sp.busca.trim().toLowerCase() : "";
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const cfg = configCobranca(organizacao);
  const [cobrancas, regras, recebedor, base, { data: acordos }, { data: parcelasAbertas }, { count: juridicos }, { data: pendentes }] = await Promise.all([
    carregarCobrancas(supabase, hoje, { venceAte: somarDias(hoje, DIAS_A_VENCER) }),
    carregarRegras(supabase),
    recebedorPix(supabase, organizacao),
    urlBase(),
    supabase.from("acordos").select("id").eq("status", "ativo"),
    supabase.from("acordo_parcelas").select("valor, acordo:acordos!inner(status)").eq("status", "aberta").eq("acordo.status", "ativo"),
    supabase.from("cobrancas_juridicas").select("id", { count: "exact", head: true }).not("situacao", "in", "(pago,encerrado)"),
    supabase.from("cobranca_contatos").select("contrato_id, resultado, promessa_data, data").eq("promessa_status", "pendente").order("data", { ascending: false }),
  ]);
  const ctx = { base, recebedor, cfg };
  const atrasadas = cobrancas.filter((c) => c.dias > 0);
  const vencendo = cobrancas.filter((c) => c.dias <= 0);
  const ag = aging(atrasadas.map((c) => ({ dias: c.dias, valor: c.sit.saldo })));
  const soma = (l: CobrancaDoSistema[], k: "saldo" | "multa" | "juros" | "totalComEncargos") => l.reduce((s, c) => s + c.sit[k], 0);
  const emAcordo = (parcelasAbertas ?? []).reduce((s, p) => s + Number(p.valor), 0);
  const promessa = new Map<string, { resultado: string; promessa_data: string | null }>();
  for (const p of pendentes ?? []) if (!promessa.has(p.contrato_id as string)) promessa.set(p.contrato_id as string, p as { resultado: string; promessa_data: string | null });

  // Agrupa por contrato (um devedor por contrato).
  const filtradas = atrasadas.filter(
    (c) =>
      (!faixa || faixaAtraso(c.dias) === faixa) &&
      (!busca || [c.locatario?.nome, c.imovelTexto, String(c.contratoNumero)].some((t) => (t ?? "").toLowerCase().includes(busca))),
  );
  const grupos = [...Map.groupBy(filtradas, (c) => c.contratoId).values()]
    .map((lista) => ({ lista: lista.sort((a, b) => a.vencimento.localeCompare(b.vencimento)), total: soma(lista, "totalComEncargos"), dias: Math.max(...lista.map((c) => c.dias)) }))
    .sort((a, b) => b.dias - a.dias || b.total - a.total);
  const devedores = new Set(atrasadas.map((c) => c.contratoId)).size;
  const url = (f: string) => {
    const q = new URLSearchParams();
    if (f) q.set("faixa", f);
    if (busca) q.set("busca", busca);
    const s = q.toString();
    return s ? `/cobrancas?${s}` : "/cobrancas";
  };

  return (
    <>
      <Cabecalho
        titulo="Cobranças"
        descricao="Quem está devendo, quanto (aluguel, multa e juros separados) e o que fazer: cobrar com mensagem pronta, registrar o contato, fazer acordo ou encaminhar ao jurídico."
        acoes={
          <>
            <BotaoLink href="/cobrancas/fila" variante="secundario">
              <CalendarClock className="size-4" /> Avisos de hoje
            </BotaoLink>
            <BotaoLink href="/cobrancas/acordos/novo">
              <Handshake className="size-4" /> Fazer acordo
            </BotaoLink>
          </>
        }
      />
      <AbasCobrancas />
      {cfg.envioAutomatico && <RotinaEnvioAutomatico />}

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Indicador
          rotulo="Em atraso"
          icone={<AlertTriangle />}
          tom={atrasadas.length ? "perigo" : "sucesso"}
          valor={<Contador valor={reais(soma(atrasadas, "saldo"))} formato="moeda" />}
          detalhe={atrasadas.length ? `+ multa ${formatarReais(reais(soma(atrasadas, "multa")))} e juros ${formatarReais(reais(soma(atrasadas, "juros")))} se pagos hoje` : "ninguém devendo"}
        />
        <Indicador rotulo="Inquilinos devendo" icone={<Users />} tom={devedores ? "perigo" : "sucesso"} valor={<Contador valor={devedores} />} detalhe={`${atrasadas.length} cobrança(s) vencida(s)`} />
        <Indicador
          rotulo={`Vencem em até ${DIAS_A_VENCER} dias`}
          icone={<CalendarClock />}
          valor={<Contador valor={vencendo.length} />}
          detalhe={formatarReais(reais(soma(vencendo, "saldo")))}
          href="/cobrancas/fila"
        />
        <Indicador rotulo="Em acordo (a receber)" icone={<Scale />} valor={<Contador valor={emAcordo} formato="moeda" />} detalhe={`${(acordos ?? []).length} acordo(s) em andamento`} href="/cobrancas/acordos" />
        <Indicador rotulo="No jurídico" icone={<Gavel />} tom={juridicos ? "alerta" : "neutro"} valor={<Contador valor={juridicos ?? 0} />} detalhe="casos em andamento" href="/cobrancas/juridico" />
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PilulasLink
          rotulo="Faixa de atraso"
          ativo={url(faixa)}
          itens={[
            { href: url(""), rotulo: `Todos (${atrasadas.length})` },
            ...ag.faixas.map((f) => ({ href: url(f.id), rotulo: `${f.rotulo} (${f.quantidade})`, titulo: formatarReais(reais(f.valor)) })),
          ]}
        />
        <FiltroAutomatico className="flex flex-wrap gap-2">
          {faixa && <input type="hidden" name="faixa" value={faixa} />}
          <Entrada name="busca" aria-label="Buscar locatário, imóvel ou contrato" defaultValue={busca} placeholder="Buscar locatário, imóvel, contrato…" className="w-72" />
        </FiltroAutomatico>
      </div>

      <Cartao titulo={`Quem está devendo (${grupos.length})`} className="mb-6">
        {grupos.length === 0 ? (
          <div className="rounded-[14px] border border-ok-bd bg-ok-bg px-5 py-4 text-sm text-texto">
            {atrasadas.length ? "Nenhum devedor neste filtro." : "Ninguém devendo. Todos os aluguéis estão em dia."}
          </div>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {grupos.map(({ lista, total, dias }) => {
              const c0 = lista[0];
              const pr = promessa.get(c0.contratoId);
              const juridico = lista.some((c) => c.juridicoAtivo);
              return (
                <li key={c0.contratoId} className="py-4 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
                    <div className="min-w-[240px] flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        {c0.locatario ? (
                          <Link href={`/pessoas/${c0.locatario.id}`} className="text-[15px] font-semibold text-texto hover:text-acento">
                            {c0.locatario.nome}
                          </Link>
                        ) : (
                          <span className="text-[15px] font-semibold text-texto">Locatário sem cadastro</span>
                        )}
                        <Selo cor="vermelho">{textoDias(dias)}</Selo>
                        {juridico && <Selo cor="amarelo">no jurídico</Selo>}
                        {pr && (
                          <Selo cor={pr.promessa_data && pr.promessa_data < hoje ? "vermelho" : "azul"}>
                            {pr.resultado === "informou_pagamento" ? "disse que pagou" : "prometeu"} {formatarDataBR(pr.promessa_data)}
                          </Selo>
                        )}
                        {!juridico && dias >= cfg.juridicoDias && <Selo cor="amarelo">sugestão: jurídico</Selo>}
                      </div>
                      <div className="mt-0.5 text-[13px] text-texto-2">
                        {c0.imovelTexto} ·{" "}
                        <Link href={`/contratos/${c0.contratoId}/cobrancas`} className="hover:text-acento hover:underline">
                          contrato #{c0.contratoNumero}
                        </Link>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-[17px] font-semibold tabular-nums text-ruim">{formatarReais(reais(total))}</div>
                      <div className="text-xs text-mudo">
                        aluguel {formatarReais(reais(soma(lista, "saldo")))} + multa {formatarReais(reais(soma(lista, "multa")))} + juros {formatarReais(reais(soma(lista, "juros")))}
                      </div>
                    </div>
                  </div>

                  <ul className="mt-3 space-y-1.5">
                    {lista.map((c) => (
                      <li key={c.faturaId} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-borda-suave bg-elev px-3 py-2 text-[13px]">
                        <span className="text-texto-2">
                          <Link href={`/faturas/${c.faturaId}`} className="font-medium text-texto hover:text-acento">
                            #{c.numero} · {formatarCompetencia(c.competencia)}
                          </Link>{" "}
                          · venceu {formatarDataBR(c.vencimento)} · {textoDias(c.dias)}
                          {c.sit.parcial && <span className="text-alerta"> · parcial (já pagou {formatarReais(reais(c.sit.recebido))})</span>}
                          {c.vistaEm && <span className="text-mudo"> · link da 2ª via aberto</span>}
                        </span>
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums text-texto">{formatarReais(reais(c.sit.totalComEncargos))}</span>
                          {!c.juridicoAtivo && <BotaoCobrar dados={montarCobrar(c, regras, ctx)} />}
                        </span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-3 flex flex-wrap gap-2">
                    <JanelaContato contratoId={c0.contratoId} faturaId={lista.length === 1 ? c0.faturaId : null} hoje={hoje} variante="fantasma" />
                    <BotaoLink href={`/cobrancas/acordos/novo?contrato=${c0.contratoId}`} variante="fantasma">
                      <Handshake className="size-4" /> Fazer acordo
                    </BotaoLink>
                    {!juridico && (
                      <JanelaCadastro
                        rotuloBotao={<><Gavel className="size-3.5" /> Encaminhar ao jurídico</>}
                        variante="fantasma"
                        tamanho="sm"
                        titulo="Encaminhar para cobrança jurídica"
                        acao={encaminharJuridico}
                        rotuloSalvar="Encaminhar"
                        icone={<Gavel />}
                      >
                        <input type="hidden" name="contrato_id" value={c0.contratoId} />
                        <p className="text-sm text-texto-2">
                          Vão {lista.length} cobrança(s) vencida(s), total hoje {formatarReais(reais(total))}. A régua para de mandar avisos automáticos para elas.
                        </p>
                        <div className="grid gap-4 sm:grid-cols-2">
                          <Campo rotulo="Escritório / advogado">
                            <Entrada name="escritorio" placeholder="Ex.: Silva Advogados" />
                          </Campo>
                          <Campo rotulo="Responsável">
                            <Entrada name="responsavel" />
                          </Campo>
                          <Campo rotulo="Contato (telefone ou e-mail)">
                            <Entrada name="contato" />
                          </Campo>
                          <Campo rotulo="Honorários (%)">
                            <Entrada name="honorarios_pct" inputMode="decimal" placeholder="Ex.: 10" />
                          </Campo>
                          <Campo rotulo="Encaminhado em">
                            <Entrada type="date" name="encaminhado_em" defaultValue={hoje} />
                          </Campo>
                        </div>
                        <Campo rotulo="Observações">
                          <AreaTexto name="observacoes" rows={2} />
                        </Campo>
                      </JanelaCadastro>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>

      <Cartao titulo={`Vence nos próximos ${DIAS_A_VENCER} dias (${vencendo.length})`}>
        {vencendo.length === 0 ? (
          <p className="text-sm text-mudo">Nenhum aluguel vencendo nos próximos dias.</p>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {vencendo.map((c) => (
              <li key={c.faturaId} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0">
                <div className="min-w-[220px] flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-[15px] font-semibold text-texto">{c.locatario?.nome ?? "Locatário sem cadastro"}</span>
                    <Selo cor={c.dias === 0 ? "amarelo" : "azul"}>{textoDias(c.dias)}</Selo>
                  </div>
                  <div className="text-[13px] text-texto-2">
                    {c.imovelTexto} ·{" "}
                    <Link href={`/faturas/${c.faturaId}`} className="hover:text-acento hover:underline">
                      #{c.numero} · {formatarCompetencia(c.competencia)}
                    </Link>
                  </div>
                </div>
                <span className="tabular-nums text-texto">{formatarReais(reais(c.sit.saldo))}</span>
                <BotaoCobrar dados={montarCobrar(c, regras, ctx)} rotuloBotao="Lembrar" variante="secundario" />
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </>
  );
}
