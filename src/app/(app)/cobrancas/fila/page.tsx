import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, CalendarCheck, Handshake, Send } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { Aviso, Cabecalho, Cartao, Indicador, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_CANAL, textoDias } from "@/lib/dominio/cobrancas";
import { diasEntre, formatarCompetencia, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasCobrancas } from "../abas";
import { pularAviso } from "../actions";
import { ListaContatos, SELECT_CONTATO, type ContatoDb } from "../campos";
import { BotaoCobrar } from "../cobrar";
import { carregarFilaDoDia, montarCobrar, reais } from "../dados";
import { RotinaEnvioAutomatico } from "../rotina";

export const metadata: Metadata = { title: "Avisos de hoje" };

export default async function FilaPage() {
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const inicioHoje = `${hoje}T00:00:00-03:00`;
  const [{ cfg, regrasDb, porId, recebedor, base, fila, proximos }, { data: enviadosHojeRaw }, { data: retornosRaw }, { data: parcelasRaw }] = await Promise.all([
    carregarFilaDoDia(supabase, organizacao, hoje),
    supabase
      .from("regua_envios")
      .select("id, status, canal, enviado_em, fatura_id, automatico, regra:regua_regras(nome)")
      .gte("enviado_em", inicioHoje)
      .neq("status", "agendado")
      .order("enviado_em", { ascending: false }),
    supabase
      .from("cobranca_contatos")
      .select(SELECT_CONTATO)
      .or(`proximo_contato.lte.${hoje},and(promessa_status.eq.pendente,promessa_data.lte.${hoje}),and(promessa_status.eq.pendente,resultado.eq.informou_pagamento)`)
      .order("data", { ascending: false })
      .limit(200),
    supabase
      .from("acordo_parcelas")
      .select("id, numero, vencimento, valor, acordo:acordos!inner(id, numero, status, contrato:contratos(numero, imovel:imoveis(codigo)), pessoa:pessoas(nome))")
      .eq("status", "aberta")
      .eq("acordo.status", "ativo")
      .lte("vencimento", somarDias(hoje, 3))
      .order("vencimento"),
  ]);
  const regraPorId = new Map(regrasDb.map((r) => [r.id, r]));
  const agendados = fila.filter((f) => f.agendado).length;
  const ctx = { base, recebedor, cfg };
  const enviadosHoje = (enviadosHojeRaw ?? []) as unknown as { id: string; status: string; canal: string | null; enviado_em: string; fatura_id: string; automatico: boolean; regra: { nome: string } | null }[];
  const retornos = (retornosRaw ?? []) as unknown as ContatoDb[];
  const parcelas = (parcelasRaw ?? []) as unknown as {
    id: string;
    numero: number;
    vencimento: string;
    valor: number;
    acordo: { id: string; numero: number; contrato: { numero: number; imovel: { codigo: string } | null } | null; pessoa: { nome: string } | null };
  }[];

  return (
    <>
      <Cabecalho titulo="Avisos de hoje" trilha="Cobranças" descricao="A régua monta sozinha a lista do dia: lembretes antes do vencimento e cobranças depois. Confira, clique e envie." />
      <AbasCobrancas />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="A enviar hoje" icone={<BellRing />} tom={fila.length ? "alerta" : "sucesso"} valor={<Contador valor={fila.length} />} detalhe="avisos da régua" />
        <Indicador rotulo="Enviados hoje" icone={<Send />} tom="sucesso" valor={<Contador valor={enviadosHoje.filter((e) => e.status === "enviado").length} />} />
        <Indicador rotulo="Retornos e promessas" icone={<CalendarCheck />} tom={retornos.length ? "alerta" : "neutro"} valor={<Contador valor={retornos.length} />} detalhe="para conferir hoje" />
        <Indicador rotulo="Parcelas de acordo" icone={<Handshake />} valor={<Contador valor={parcelas.length} />} detalhe="vencidas ou vencendo em 3 dias" />
      </div>

      {cfg.envioAutomatico && <RotinaEnvioAutomatico />}
      <div className="mb-6">
        <Aviso tipo={cfg.envioAutomatico ? "alerta" : "info"}>
          {cfg.envioAutomatico
            ? `Envio automático ligado: a partir das ${cfg.horaEnvio}h os avisos do dia vão para a fila de saída, já com a mensagem, o canal e o destinatário (${agendados} hoje). Ainda não há provedor de WhatsApp Business, SMS ou e-mail contratado, então NADA sai sozinho: envie pelos botões abaixo — a mensagem já vai pronta. Quando o provedor for ligado, é essa fila que ele envia.`
            : "Os avisos abrem o WhatsApp, o e-mail ou o SMS do seu aparelho com a mensagem pronta (com link da 2ª via e Pix). Ligando o envio automático (Régua e Pix), a fila de saída do dia fica gravada, pronta para quando houver provedor de envio contratado."}
        </Aviso>
      </div>

      <Cartao titulo={`Para enviar hoje (${fila.length})`} className="mb-6">
        {fila.length === 0 ? (
          <p className="text-sm text-mudo">Nada para enviar hoje. {regrasDb.some((r) => r.ativo) ? "" : "A régua está sem avisos ligados — configure em Régua e Pix."}</p>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {fila.map((f) => {
              const c = f.cobranca;
              const regra = regraPorId.get(f.regraId);
              return (
                <li key={f.faturaId} className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div className="min-w-[240px] flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[15px] font-semibold text-texto">{c.locatario?.nome ?? "Locatário sem cadastro"}</span>
                      <Selo cor={c.dias > 0 ? "vermelho" : c.dias === 0 ? "amarelo" : "azul"}>{textoDias(c.dias)}</Selo>
                      <Selo cor="cinza">
                        {regra?.nome ?? "aviso"} · {ROTULO_CANAL[regra?.canal ?? "whatsapp"]}
                      </Selo>
                      {f.agendado && (
                        <Selo cor="azul">
                          na fila de saída{f.agendado.para ? ` · ${new Date(f.agendado.para).toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" })}` : ""} · aguardando provedor
                        </Selo>
                      )}
                      {f.dataAlvo < hoje && <span className="text-xs text-alerta">era para {formatarDataBR(f.dataAlvo)}</span>}
                    </div>
                    <div className="text-[13px] text-texto-2">
                      {c.imovelTexto} ·{" "}
                      <Link href={`/faturas/${c.faturaId}`} className="hover:text-acento hover:underline">
                        #{c.numero} · {formatarCompetencia(c.competencia)}
                      </Link>
                      {!c.locatario?.telefone && !c.locatario?.email && <span className="text-alerta"> · sem celular nem e-mail no cadastro</span>}
                    </div>
                  </div>
                  <span className="tabular-nums text-texto">{formatarReais(reais(c.dias > 0 ? c.sit.totalComEncargos : c.sit.saldo))}</span>
                  <div className="flex items-center gap-2">
                    <BotaoCobrar dados={montarCobrar(c, regrasDb, { ...ctx, regraId: f.regraId, superados: f.superados })} rotuloBotao="Enviar" />
                    <BotaoAcao acao={pularAviso} id={`${f.faturaId}|${[f.regraId, ...f.superados].join(",")}`} tamanho="sm" variante="fantasma" confirmar="Pular este aviso hoje? Ele sai da lista e não volta.">
                      Pular
                    </BotaoAcao>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Cartao>

      <div className="mb-6 grid gap-6 xl:grid-cols-2">
        <Cartao titulo={`Retornos, promessas e “já paguei” (${retornos.length})`}>
          <ListaContatos contatos={retornos} hoje={hoje} mostrarContrato />
        </Cartao>
        <Cartao titulo={`Parcelas de acordo (${parcelas.length})`}>
          {parcelas.length === 0 ? (
            <p className="text-sm text-mudo">Nenhuma parcela vencida ou vencendo.</p>
          ) : (
            <ul className="divide-y divide-borda-suave text-sm">
              {parcelas.map((p) => {
                const d = diasEntre(p.vencimento, hoje);
                return (
                  <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0">
                    <span>
                      <Link href={`/cobrancas/acordos/${p.acordo.id}`} className="font-medium text-texto hover:text-acento">
                        {p.acordo.pessoa?.nome ?? "Acordo"} · acordo nº {p.acordo.numero}
                      </Link>
                      <span className="block text-xs text-mudo">
                        parcela {p.numero === 0 ? "de entrada" : p.numero} · vence {formatarDataBR(p.vencimento)}
                        {p.acordo.contrato?.imovel ? ` · ${p.acordo.contrato.imovel.codigo}` : ""}
                      </span>
                    </span>
                    <span className="flex items-center gap-2">
                      <Selo cor={d > 0 ? "vermelho" : d === 0 ? "amarelo" : "azul"}>{textoDias(d)}</Selo>
                      <span className="tabular-nums">{formatarReais(p.valor)}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Cartao titulo={`Já enviados hoje (${enviadosHoje.length})`}>
          {enviadosHoje.length === 0 ? (
            <p className="text-sm text-mudo">Nenhum aviso enviado hoje.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {enviadosHoje.map((e) => {
                const c = porId.get(e.fatura_id);
                return (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {c?.locatario?.nome ?? "Cobrança"} · {e.regra?.nome ?? "aviso"}
                    </span>
                    <span className="flex items-center gap-2 text-xs text-mudo">
                      {e.canal ? ROTULO_CANAL[e.canal] : ""}
                      <Selo cor={e.status === "enviado" ? "verde" : "cinza"}>{e.status}</Selo>
                      {e.automatico && <Selo cor="cinza">da fila automática</Selo>}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>
        <Cartao titulo="Próximos 7 dias">
          {proximos.length === 0 ? (
            <p className="text-sm text-mudo">Nenhum aviso programado.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {proximos.slice(0, 40).map((p) => {
                const c = porId.get(p.faturaId)!;
                return (
                  <li key={`${p.regraId}:${p.faturaId}`} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {formatarDataBR(p.dataAlvo)} · {c.locatario?.nome ?? "Cobrança"}
                    </span>
                    <span className="text-xs text-mudo">{regraPorId.get(p.regraId)?.nome}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Cartao>
      </div>
    </>
  );
}
