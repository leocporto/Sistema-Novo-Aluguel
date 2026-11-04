import Link from "next/link";
import { Building2, ClipboardCheck, FileText, HandCoins, Wrench } from "lucide-react";
import { DocumentoInforme } from "@/app/(app)/portais/informe";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoEnviar, BotaoImprimir, Formulario } from "@/components/formulario";
import { NOMES_MES } from "@/components/navegador-mes";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Aviso, Campo, Cartao, Celula, Definicao, Entrada, Indicador, LinhaVazia, Selo, Tabela, classeBotao } from "@/components/ui";
import { diaLocal } from "@/lib/dominio/agenda";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { COR_STATUS_CHAMADO, ROTULO_CATEGORIA_CURTO, ROTULO_STATUS_CHAMADO, ROTULO_URGENCIA } from "@/lib/dominio/manutencao";
import { informeRendimentos, type LinhaInforme } from "@/lib/dominio/portal";
import { COR_SITUACAO_REPASSE, ROTULO_SITUACAO_REPASSE, situacaoDespesa, situacaoRepasse, totaisDemonstrativo } from "@/lib/dominio/repasses";
import { ROTULO_STATUS_IMOVEL } from "@/lib/tipos";
import { responderOrcamentoPortal } from "../actions";
import { dadosPortal, ehErroPortal } from "../sessao";
import { AvisoSessao, NaoEncontrado } from "./comum";

type Num = number | string;
const reais = (v: Num | null | undefined) => formatarReais(v ?? 0);
const corChamado = (s: string) => COR_STATUS_CHAMADO[s as keyof typeof COR_STATUS_CHAMADO] ?? "cinza";

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

type Inicio = {
  imoveis: number;
  contratos_ativos: number;
  a_receber: Num;
  ultimo_repasse: { valor: Num; pago_em: string | null; competencia: string } | null;
  aprovacoes: number;
  chamados_abertos: number;
};

export async function InicioProprietario({ token }: { token: string }) {
  const d = await dadosPortal<Inicio>(token, "inicio");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  const base = `/portal/${token}`;
  return (
    <div className="space-y-5">
      {d.aprovacoes > 0 && (
        <Aviso tipo="alerta">
          Há {d.aprovacoes} orçamento(s) de manutenção esperando a sua aprovação.{" "}
          <Link href={`${base}/aprovacoes`} className="font-semibold text-acento hover:underline">
            Ver e responder
          </Link>
        </Aviso>
      )}
      <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Imóveis" valor={<Contador valor={d.imoveis} />} icone={<Building2 />} href={`${base}/imoveis`} detalhe={`${d.contratos_ativos} contrato(s) ativo(s)`} />
        <Indicador
          rotulo="A receber (repasses)"
          valor={<Contador valor={Number(d.a_receber)} formato="moeda" />}
          icone={<HandCoins />}
          href={`${base}/repasses`}
          detalhe={d.ultimo_repasse ? `último: ${reais(d.ultimo_repasse.valor)} em ${formatarDataBR(d.ultimo_repasse.pago_em)}` : "nenhum repasse pago ainda"}
        />
        <Indicador rotulo="Orçamentos para aprovar" valor={<Contador valor={d.aprovacoes} />} icone={<ClipboardCheck />} tom={d.aprovacoes ? "alerta" : "neutro"} href={`${base}/aprovacoes`} />
        <Indicador rotulo="Manutenções em andamento" valor={<Contador valor={d.chamados_abertos} />} icone={<Wrench />} href={`${base}/despesas`} />
      </div>
      <Cartao titulo="O que você encontra aqui">
        <ul className="grid gap-2 text-sm text-texto-2 sm:grid-cols-2">
          <li>• Seus imóveis, contratos e documentos</li>
          <li>• Aluguéis recebidos e em aberto</li>
          <li>• Extrato dos repasses e demonstrativo de cada mês</li>
          <li>• Despesas descontadas e manutenções dos imóveis</li>
          <li>• Aprovação dos orçamentos de manutenção</li>
          <li>• Informe de rendimentos para o Imposto de Renda</li>
        </ul>
      </Cartao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Imóveis
// ---------------------------------------------------------------------------

type Imovel = {
  id: string;
  codigo: string;
  titulo: string | null;
  status: string;
  endereco: string | null;
  percentual: Num;
  valor_aluguel: Num | null;
  valor_condominio: Num | null;
  valor_iptu: Num | null;
  contrato: { numero: number; inicio: string; fim: string; valor: Num; locatario: string | null } | null;
  chamados_abertos: number;
};

export async function ImoveisProprietario({ token }: { token: string }) {
  const lista = await dadosPortal<Imovel[]>(token, "imoveis");
  if (ehErroPortal(lista)) return <AvisoSessao erro={lista.erro} token={token} />;
  return (
    <Tabela colunas={["Imóvel", "Situação", "Sua parte", "Aluguel", "Contrato", "Manutenções"]}>
      {(lista ?? []).length === 0 && <LinhaVazia colunas={6}>Nenhum imóvel ligado ao seu cadastro.</LinhaVazia>}
      {(lista ?? []).map((i) => (
        <tr key={i.id}>
          <Celula>
            <div className="font-medium">{i.codigo}</div>
            <div className="text-xs text-mudo">{i.endereco ?? i.titulo ?? "—"}</div>
          </Celula>
          <Celula>
            <Selo cor={i.status === "alugado" ? "verde" : i.status === "disponivel" ? "amarelo" : "cinza"}>{ROTULO_STATUS_IMOVEL[i.status] ?? i.status}</Selo>
          </Celula>
          <Celula className="tabular-nums">{Number(i.percentual).toLocaleString("pt-BR")}%</Celula>
          <Celula className="tabular-nums">
            {i.valor_aluguel ? reais(i.valor_aluguel) : "—"}
            {(Number(i.valor_condominio) > 0 || Number(i.valor_iptu) > 0) && (
              <span className="block text-xs text-mudo">
                {Number(i.valor_condominio) > 0 ? `cond. ${reais(i.valor_condominio)}` : ""}
                {Number(i.valor_iptu) > 0 ? ` IPTU ${reais(i.valor_iptu)}/mês` : ""}
              </span>
            )}
          </Celula>
          <Celula className="text-sm">
            {i.contrato ? (
              <>
                nº {i.contrato.numero} · {i.contrato.locatario ?? "—"}
                <span className="block text-xs text-mudo">
                  {reais(i.contrato.valor)} · até {formatarDataBR(i.contrato.fim)}
                </span>
              </>
            ) : (
              <span className="text-mudo">sem contrato ativo</span>
            )}
          </Celula>
          <Celula className="tabular-nums">{i.chamados_abertos > 0 ? <Selo cor="amarelo">{i.chamados_abertos} em andamento</Selo> : "—"}</Celula>
        </tr>
      ))}
    </Tabela>
  );
}

// ---------------------------------------------------------------------------
// Contratos e documentos
// ---------------------------------------------------------------------------

type Contrato = {
  id: string;
  numero: number;
  codigo: string | null;
  status: string;
  inicio: string;
  fim: string;
  valor_aluguel: Num;
  dia_vencimento: number;
  indice: string;
  taxa_administracao_pct: Num;
  imovel: string;
  endereco: string | null;
  locatario: string | null;
  percentual: Num | null;
};
export type DocumentoLista = { id: string; numero: number; titulo: string; tipo: string; status: string; criado_em: string; assinado_em: string | null; tem_texto: boolean };

const ROTULO_STATUS_CONTRATO: Record<string, string> = { ativo: "Ativo", encerrado: "Encerrado", rescindido: "Rescindido" };
const ROTULO_STATUS_DOC: Record<string, string> = { aprovado: "Aprovado", aguardando_assinatura: "Aguardando assinatura", assinado: "Assinado", arquivo: "Arquivo" };

export function ListaDocumentos({ token, documentos }: { token: string; documentos: DocumentoLista[] }) {
  if (documentos.length === 0) return <p className="text-sm text-mudo">Nenhum documento disponível.</p>;
  return (
    <ul className="divide-y divide-borda-suave">
      {documentos.map((d) => (
        <li key={d.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
          <div>
            <div className="font-medium text-texto">{d.titulo}</div>
            <div className="text-xs text-mudo">
              {ROTULO_STATUS_DOC[d.status] ?? d.status}
              {d.assinado_em ? ` em ${formatarDataBR(diaLocal(d.assinado_em))}` : ""}
            </div>
          </div>
          {d.tem_texto ? (
            <Link href={`/portal/${token}/documento/${d.id}`} className={classeBotao("secundario", "sm")}>
              <FileText className="size-3.5" /> Ver e imprimir
            </Link>
          ) : (
            <span className="text-xs text-mudo">arquivo: peça para a equipe compartilhar em “Arquivos”</span>
          )}
        </li>
      ))}
    </ul>
  );
}

export async function ContratosProprietario({ token }: { token: string }) {
  const d = await dadosPortal<{ contratos: Contrato[]; documentos: DocumentoLista[] }>(token, "contratos");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  return (
    <div className="space-y-5">
      <Tabela colunas={["Contrato", "Imóvel", "Locatário", "Vigência", "Aluguel", "Taxa de adm.", "Situação"]}>
        {d.contratos.length === 0 && <LinhaVazia colunas={7}>Nenhum contrato.</LinhaVazia>}
        {d.contratos.map((c) => (
          <tr key={c.id}>
            <Celula>
              nº {c.numero}
              {c.codigo ? ` (${c.codigo})` : ""}
              {c.percentual != null && Number(c.percentual) < 100 && <span className="block text-xs text-mudo">sua parte {Number(c.percentual).toLocaleString("pt-BR")}%</span>}
            </Celula>
            <Celula>
              {c.imovel}
              <span className="block text-xs text-mudo">{c.endereco ?? ""}</span>
            </Celula>
            <Celula>{c.locatario ?? "—"}</Celula>
            <Celula className="text-sm">
              {formatarDataBR(c.inicio)} a {formatarDataBR(c.fim)}
            </Celula>
            <Celula className="tabular-nums">
              {reais(c.valor_aluguel)}
              <span className="block text-xs text-mudo">vence dia {c.dia_vencimento} · reajuste {c.indice}</span>
            </Celula>
            <Celula className="tabular-nums">{Number(c.taxa_administracao_pct).toLocaleString("pt-BR")}%</Celula>
            <Celula>
              <Selo cor={c.status === "ativo" ? "verde" : "cinza"}>{ROTULO_STATUS_CONTRATO[c.status] ?? c.status}</Selo>
            </Celula>
          </tr>
        ))}
      </Tabela>
      <Cartao titulo="Documentos">
        <ListaDocumentos token={token} documentos={d.documentos} />
      </Cartao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aluguéis
// ---------------------------------------------------------------------------

type Fatura = { id: string; numero: number; competencia: string; vencimento: string; valor_total: Num; valor_abatido: Num; status: string; pago_em: string | null; imovel: string; contrato: number; locatario: string | null };

export function situacaoAluguel(f: { status: string; vencimento: string; valor_abatido: Num; pago_em: string | null }, hoje: string): { rotulo: string; cor: "verde" | "amarelo" | "vermelho" | "cinza" | "azul" } {
  if (f.status === "paga") return { rotulo: `Pago em ${formatarDataBR(f.pago_em)}`, cor: "verde" };
  if (f.status === "renegociada") return { rotulo: "Em acordo", cor: "azul" };
  if (f.status === "cancelada") return { rotulo: "Cancelado", cor: "cinza" };
  if (Number(f.valor_abatido) > 0) return { rotulo: "Pago em parte", cor: "amarelo" };
  return f.vencimento < hoje ? { rotulo: "Em atraso", cor: "vermelho" } : { rotulo: "A vencer", cor: "amarelo" };
}

export async function AlugueisProprietario({ token }: { token: string }) {
  const lista = await dadosPortal<Fatura[]>(token, "alugueis");
  if (ehErroPortal(lista)) return <AvisoSessao erro={lista.erro} token={token} />;
  const hoje = hojeISO();
  const faturas = lista ?? [];
  const ano = hoje.slice(0, 4);
  const pagoNoAno = faturas.filter((f) => f.status === "paga" && f.pago_em?.startsWith(ano)).reduce((s, f) => s + paraCentavos(f.valor_total), 0);
  return (
    <div className="space-y-4">
      <p className="text-sm text-texto-2">
        Aluguéis cobrados dos locatários nos seus imóveis (últimos 24 meses). Recebidos em {ano}: <b className="text-texto">{formatarReais(paraReais(pagoNoAno))}</b>. O
        valor que chega para você, já com as taxas e descontos, está em “Extrato e repasses”.
      </p>
      <Tabela colunas={["Competência", "Imóvel", "Locatário", "Vencimento", "Valor", "Situação"]}>
        {faturas.length === 0 && <LinhaVazia colunas={6}>Nenhum aluguel no período.</LinhaVazia>}
        {faturas.map((f) => {
          const s = situacaoAluguel(f, hoje);
          return (
            <tr key={f.id}>
              <Celula>{formatarCompetencia(f.competencia)}</Celula>
              <Celula>
                {f.imovel}
                <span className="block text-xs text-mudo">contrato nº {f.contrato}</span>
              </Celula>
              <Celula>{f.locatario ?? "—"}</Celula>
              <Celula>{formatarDataBR(f.vencimento)}</Celula>
              <Celula className="tabular-nums">{reais(f.valor_total)}</Celula>
              <Celula>
                <Selo cor={s.cor}>{s.rotulo}</Selo>
              </Celula>
            </tr>
          );
        })}
      </Tabela>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Extrato, repasses e demonstrativo
// ---------------------------------------------------------------------------

type Repasse = {
  id: string;
  competencia: string;
  status: string;
  aluguel: Num;
  encargos: Num;
  multa_juros: Num;
  valor_bruto: Num;
  taxa_administracao: Num;
  taxa_intermediacao: Num;
  irrf: Num;
  imposto: Num;
  outros_descontos: Num;
  valor_liquido: Num;
  previsto_para: string;
  programado_para: string | null;
  aprovado_em: string | null;
  pago_em: string | null;
  forma_pagamento: string | null;
  imovel: string;
  endereco: string | null;
  contrato: number;
  descontos: { descricao: string; valor: Num; tipo: string }[];
};

export async function RepassesProprietario({ token }: { token: string }) {
  const lista = await dadosPortal<Repasse[]>(token, "repasses");
  if (ehErroPortal(lista)) return <AvisoSessao erro={lista.erro} token={token} />;
  const hoje = hojeISO();
  const repasses = lista ?? [];
  const meses = [...new Set(repasses.map((r) => r.competencia.slice(0, 7)))];
  const t = totaisDemonstrativo(repasses);
  return (
    <div className="space-y-5">
      <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Líquido (24 meses)" valor={<Contador valor={t.liquido} formato="moeda" />} icone={<HandCoins />} />
        <Indicador rotulo="Já repassado" valor={<Contador valor={t.pago} formato="moeda" />} tom="sucesso" icone={<HandCoins />} />
        <Indicador rotulo="A repassar" valor={<Contador valor={t.aPagar} formato="moeda" />} tom={t.aPagar ? "alerta" : "neutro"} icone={<HandCoins />} />
      </div>
      {meses.length === 0 && <NaoEncontrado texto="Nenhum repasse nos últimos 24 meses." />}
      {meses.map((mes) => {
        const doMes = repasses.filter((r) => r.competencia.startsWith(mes));
        const tm = totaisDemonstrativo(doMes);
        return (
          <Cartao
            key={mes}
            titulo={`${NOMES_MES[Number(mes.slice(5)) - 1]} de ${mes.slice(0, 4)}`}
            acoes={
              <Link href={`/portal/${token}/demonstrativo/${mes}`} className={classeBotao("secundario", "sm")}>
                <FileText className="size-3.5" /> Demonstrativo
              </Link>
            }
          >
            <ul className="divide-y divide-borda-suave">
              {doMes.map((r) => {
                const sit = situacaoRepasse(r, hoje);
                return (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <div className="font-medium text-texto">
                        {r.imovel} <span className="text-xs text-mudo">contrato nº {r.contrato}</span>
                      </div>
                      <div className="text-xs text-mudo">
                        recebido {reais(Number(r.aluguel) + Number(r.encargos) + Number(r.multa_juros))} · taxas −
                        {reais(Number(r.taxa_administracao) + Number(r.taxa_intermediacao))}
                        {Number(r.irrf) + Number(r.imposto) > 0 ? ` · impostos −${reais(Number(r.irrf) + Number(r.imposto))}` : ""}
                        {Number(r.outros_descontos) > 0 ? ` · despesas −${reais(r.outros_descontos)}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-semibold tabular-nums">{reais(r.valor_liquido)}</span>
                      <Selo cor={COR_SITUACAO_REPASSE[sit]}>{sit === "pago" ? `Pago em ${formatarDataBR(r.pago_em)}` : ROTULO_SITUACAO_REPASSE[sit]}</Selo>
                    </div>
                  </li>
                );
              })}
            </ul>
            <div className="mt-2 text-right text-sm text-texto-2">
              Líquido do mês: <b className="text-texto">{reais(tm.liquido)}</b>
            </div>
          </Cartao>
        );
      })}
    </div>
  );
}

type Informe = {
  ano: number;
  organizacao: { nome: string; documento: string | null };
  beneficiario: { nome: string; documento: string | null };
  linhas: {
    competencia: string;
    fatura_pago_em: string | null;
    fatura_paga: boolean | null;
    repasse_pago_em: string | null;
    status: string;
    imovel: string;
    endereco: string | null;
    contrato: number;
    locatario: { nome: string; documento: string | null } | null;
    aluguel: Num;
    encargos: Num;
    multa_juros: Num;
    taxa_administracao: Num;
    taxa_intermediacao: Num;
    irrf: Num;
    imposto: Num;
    outros_descontos: Num;
    valor_liquido: Num;
  }[];
};

export async function DemonstrativoProprietario({ token, mes }: { token: string; mes: string }) {
  if (!/^\d{4}-\d{2}$/.test(mes)) return <NaoEncontrado />;
  const [lista, cab] = await Promise.all([dadosPortal<Repasse[]>(token, "repasses", { mes }), dadosPortal<Informe>(token, "informe", { ano: mes.slice(0, 4) })]);
  if (ehErroPortal(lista)) return <AvisoSessao erro={lista.erro} token={token} />;
  if (ehErroPortal(cab) || !cab) return <NaoEncontrado />;
  const repasses = lista ?? [];
  const t = totaisDemonstrativo(repasses);
  const hoje = hojeISO();
  return (
    <div className="space-y-4">
      <div className="nao-imprimir flex flex-wrap justify-between gap-2">
        <Link href={`/portal/${token}/repasses`} className={classeBotao("fantasma")}>
          ← Voltar ao extrato
        </Link>
        <BotaoImprimir />
      </div>
      <article className="space-y-5 rounded-card border border-borda bg-card p-[clamp(18px,2.4vw,32px)] text-sm text-texto print:border-0 print:p-0">
        <header className="flex flex-wrap justify-between gap-4 border-b border-borda pb-4">
          <div>
            <h2 className="text-[20px] font-semibold">
              Demonstrativo de repasse — {NOMES_MES[Number(mes.slice(5)) - 1]} de {mes.slice(0, 4)}
            </h2>
            <p className="text-texto-2">
              {cab.organizacao.nome}
              {cab.organizacao.documento ? ` · ${formatarDocumento(cab.organizacao.documento)}` : ""}
            </p>
          </div>
          <div className="text-right">
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Proprietário</div>
            <div className="font-medium">{cab.beneficiario.nome}</div>
            {cab.beneficiario.documento && <div className="text-xs text-mudo">{formatarDocumento(cab.beneficiario.documento)}</div>}
          </div>
        </header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[680px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                <th className="py-2 pr-2">Imóvel</th>
                <th className="px-2 py-2 text-right">Aluguel</th>
                <th className="px-2 py-2 text-right">Encargos e multa</th>
                <th className="px-2 py-2 text-right">Taxas</th>
                <th className="px-2 py-2 text-right">Impostos</th>
                <th className="px-2 py-2 text-right">Despesas</th>
                <th className="px-2 py-2 text-right">Líquido</th>
                <th className="py-2 pl-2">Situação</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borda-suave">
              {repasses.map((r) => {
                const sit = situacaoRepasse(r, hoje);
                return (
                  <tr key={r.id}>
                    <td className="py-2 pr-2">
                      {r.imovel} <span className="text-xs text-mudo">nº {r.contrato}</span>
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{reais(r.aluguel)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{reais(Number(r.encargos) + Number(r.multa_juros))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">−{reais(Number(r.taxa_administracao) + Number(r.taxa_intermediacao))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">−{reais(Number(r.irrf) + Number(r.imposto))}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{Number(r.outros_descontos) ? `−${reais(r.outros_descontos)}` : "—"}</td>
                    <td className="px-2 py-2 text-right font-semibold tabular-nums">{reais(r.valor_liquido)}</td>
                    <td className="py-2 pl-2">
                      <Selo cor={COR_SITUACAO_REPASSE[sit]}>{ROTULO_SITUACAO_REPASSE[sit]}</Selo>
                      {r.pago_em && <span className="block text-xs text-mudo">{formatarDataBR(r.pago_em)}</span>}
                    </td>
                  </tr>
                );
              })}
              {repasses.length === 0 && (
                <tr>
                  <td colSpan={8} className="py-6 text-center text-mudo">
                    Nenhum repasse com competência {formatarCompetencia(`${mes}-01`)}.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {repasses.some((r) => r.descontos.length > 0) && (
          <section>
            <h3 className="mb-2 text-[15px] font-semibold">Despesas e descontos</h3>
            <ul className="divide-y divide-borda-suave">
              {repasses.flatMap((r) =>
                r.descontos.map((d, i) => (
                  <li key={`${r.id}-${i}`} className="flex justify-between gap-3 py-1.5">
                    <span>
                      {d.descricao} <span className="text-xs text-mudo">({r.imovel})</span>
                    </span>
                    <span className="tabular-nums">−{reais(d.valor)}</span>
                  </li>
                )),
              )}
            </ul>
          </section>
        )}
        <div className="grid gap-2 rounded-[14px] border border-borda bg-elev p-4 sm:grid-cols-3">
          <div>
            <div className="text-xs text-mudo">Líquido do mês</div>
            <div className="text-[20px] font-semibold tabular-nums">{reais(t.liquido)}</div>
          </div>
          <div>
            <div className="text-xs text-mudo">Já repassado</div>
            <div className="text-[20px] font-semibold tabular-nums text-ok">{reais(t.pago)}</div>
          </div>
          <div>
            <div className="text-xs text-mudo">A repassar</div>
            <div className="text-[20px] font-semibold tabular-nums text-alerta">{reais(t.aPagar)}</div>
          </div>
        </div>
        <p className="text-xs text-mudo">
          Taxas = administração e intermediação. Impostos = IRRF retido pelo locatário pessoa jurídica e imposto descontado no repasse. Emitido em{" "}
          {formatarDataBR(hoje)}.
        </p>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Despesas e manutenções
// ---------------------------------------------------------------------------

type Despesas = {
  despesas: { id: string; descricao: string; categoria: string | null; valor: Num; vencimento: string; status: string; imovel: string | null; rateada: boolean; descontado: Num }[];
  chamados: {
    id: string;
    numero: number;
    titulo: string;
    categoria: string;
    status: string;
    criado_em: string;
    concluido_em: string | null;
    valor_aprovado: Num | null;
    valor_final: Num | null;
    responsabilidade: string | null;
    pct_proprietario: Num;
    imovel: string;
    garantia_ate: string | null;
  }[];
};

export async function DespesasProprietario({ token }: { token: string }) {
  const d = await dadosPortal<Despesas>(token, "despesas");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  return (
    <div className="space-y-5">
      <Cartao titulo="Despesas dos imóveis descontadas nos repasses">
        <p className="mb-3 text-sm text-texto-2">Contas do imóvel pagas pela administração e autorizadas para desconto no seu repasse (últimos 2 anos).</p>
        <Tabela colunas={["Despesa", "Imóvel", "Data", "Valor", "Situação"]}>
          {d.despesas.length === 0 && <LinhaVazia colunas={5}>Nenhuma despesa a descontar.</LinhaVazia>}
          {d.despesas.map((x) => {
            const s = situacaoDespesa(paraCentavos(x.valor), paraCentavos(x.descontado));
            return (
              <tr key={x.id}>
                <Celula>
                  {x.descricao}
                  {x.rateada && <span className="block text-xs text-mudo">dividida entre os proprietários pela participação</span>}
                </Celula>
                <Celula>{x.imovel ?? "—"}</Celula>
                <Celula>{formatarDataBR(x.vencimento)}</Celula>
                <Celula className="tabular-nums">{reais(x.valor)}</Celula>
                <Celula>
                  <Selo cor={s.cor}>{s.rotulo}</Selo>
                </Celula>
              </tr>
            );
          })}
        </Tabela>
      </Cartao>
      <Cartao titulo="Manutenções dos imóveis">
        <Tabela colunas={["Chamado", "Imóvel", "Situação", "Valor", "Sua parte"]}>
          {d.chamados.length === 0 && <LinhaVazia colunas={5}>Nenhuma manutenção registrada.</LinhaVazia>}
          {d.chamados.map((c) => {
            const valor = c.valor_final ?? c.valor_aprovado;
            return (
              <tr key={c.id}>
                <Celula>
                  #{c.numero} · {c.titulo}
                  <span className="block text-xs text-mudo">
                    {ROTULO_CATEGORIA_CURTO[c.categoria] ?? c.categoria} · aberto em {formatarDataBR(diaLocal(c.criado_em))}
                    {c.garantia_ate ? ` · garantia até ${formatarDataBR(c.garantia_ate)}` : ""}
                  </span>
                </Celula>
                <Celula>{c.imovel}</Celula>
                <Celula>
                  <Selo cor={corChamado(c.status)}>{ROTULO_STATUS_CHAMADO[c.status] ?? c.status}</Selo>
                </Celula>
                <Celula className="tabular-nums">{valor != null ? reais(valor) : "—"}</Celula>
                <Celula className="tabular-nums">{valor != null && Number(c.pct_proprietario) > 0 ? reais(paraReais(Math.round((paraCentavos(valor) * Number(c.pct_proprietario)) / 100))) : "—"}</Celula>
              </tr>
            );
          })}
        </Tabela>
      </Cartao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Aprovar orçamentos
// ---------------------------------------------------------------------------

type Aprovacoes = {
  pendentes: {
    id: string;
    numero: number;
    titulo: string;
    descricao: string | null;
    categoria: string;
    urgencia: string;
    local: string | null;
    criado_em: string;
    imovel: string;
    endereco: string | null;
    pct_proprietario: Num;
    pago_direto: boolean;
    valor: Num | null;
    parte_proprietario: Num;
    orcamento_id: string | null;
    orcamentos: { id: string; prestador: string | null; especialidade: string | null; valor: Num; prazo_dias: number | null; garantia_dias: number | null; validade: string | null; descricao: string | null; escolhido: boolean }[];
  }[];
  respondidas: { numero: number; titulo: string; aprovacao_status: string; aprovacao_em: string; aprovacao_nome: string | null; valor: Num | null }[];
};

export async function AprovacoesProprietario({ token, nome }: { token: string; nome: string }) {
  const d = await dadosPortal<Aprovacoes>(token, "aprovacoes");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  return (
    <div className="space-y-5">
      {d.pendentes.length === 0 && <NaoEncontrado texto="Nenhum orçamento esperando a sua aprovação." />}
      {d.pendentes.map((c) => (
        <Cartao key={c.id} titulo={`Chamado nº ${c.numero} · ${c.titulo}`} acoes={<Selo cor="amarelo">aguardando você</Selo>}>
          <Definicao
            itens={[
              ["Imóvel", `${c.imovel}${c.endereco ? ` — ${c.endereco}` : ""}`],
              ["Tipo / urgência", `${ROTULO_CATEGORIA_CURTO[c.categoria] ?? c.categoria} · ${ROTULO_URGENCIA[c.urgencia] ?? c.urgencia}`],
              ["Onde", c.local],
              ["Valor do serviço", c.valor != null ? reais(c.valor) : "—"],
              ["Sua parte", `${reais(c.parte_proprietario)} (${Number(c.pct_proprietario).toLocaleString("pt-BR")}%)`],
              ["Pagamento", c.pago_direto ? "você paga direto ao prestador" : "descontado no seu repasse"],
            ]}
          />
          {c.descricao && <p className="mt-4 whitespace-pre-line text-sm text-texto-2">{c.descricao}</p>}
          {c.orcamentos.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="text-left font-mono text-[10px] uppercase tracking-[0.12em] text-mudo">
                    <th className="py-2 pr-2">Orçamento</th>
                    <th className="px-2 py-2 text-right">Valor</th>
                    <th className="px-2 py-2">Prazo</th>
                    <th className="px-2 py-2">Garantia</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-borda-suave">
                  {c.orcamentos.map((o) => (
                    <tr key={o.id} className={o.escolhido ? "font-medium" : "text-texto-2"}>
                      <td className="py-2 pr-2">
                        {o.prestador ?? "—"}
                        {o.especialidade ? ` (${o.especialidade})` : ""} {o.escolhido && <Selo cor="azul">escolhido</Selo>}
                        {o.descricao && <span className="block text-xs text-mudo">{o.descricao}</span>}
                      </td>
                      <td className="px-2 py-2 text-right tabular-nums">{reais(o.valor)}</td>
                      <td className="px-2 py-2">{o.prazo_dias != null ? `${o.prazo_dias} dia(s)` : "—"}</td>
                      <td className="px-2 py-2">{o.garantia_dias != null ? `${o.garantia_dias} dias` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-5 border-t border-borda pt-4">
            <Formulario acao={responderOrcamentoPortal} className="space-y-3">
              <input type="hidden" name="token" value={token} />
              <input type="hidden" name="chamado" value={c.id} />
              <input type="hidden" name="orcamento" value={c.orcamento_id ?? ""} />
              <input type="hidden" name="valor" value={String(c.valor ?? "")} />
              <input type="hidden" name="parte" value={String(c.parte_proprietario)} />
              <div className="grid gap-3 sm:grid-cols-2">
                <Campo rotulo="Seu nome completo">
                  <Entrada name="nome" required defaultValue={nome} />
                </Campo>
                <Campo rotulo="Observação (opcional)">
                  <AreaTexto name="obs" rows={1} maxLength={1000} />
                </Campo>
              </div>
              <div className="flex flex-wrap gap-2">
                <BotaoEnviar name="aprovar" value="1" confirmar={`Aprovar o orçamento de ${reais(c.valor)}? A sua parte é ${reais(c.parte_proprietario)}.`}>
                  Aprovar orçamento
                </BotaoEnviar>
                <BotaoEnviar name="aprovar" value="0" variante="secundario" confirmar="Recusar este orçamento? A equipe vai procurar outra solução e falar com você.">
                  Recusar
                </BotaoEnviar>
              </div>
            </Formulario>
          </div>
        </Cartao>
      ))}
      {d.respondidas.length > 0 && (
        <Cartao titulo="Respostas anteriores">
          <ul className="divide-y divide-borda-suave">
            {d.respondidas.map((r) => (
              <li key={r.numero} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                <span>
                  #{r.numero} · {r.titulo} {r.valor != null ? `· ${reais(r.valor)}` : ""}
                </span>
                <span className="flex items-center gap-2 text-xs text-mudo">
                  {formatarDataBR(diaLocal(r.aprovacao_em))}
                  <Selo cor={r.aprovacao_status === "aprovado" ? "verde" : "cinza"}>{r.aprovacao_status === "aprovado" ? "aprovado" : "recusado"}</Selo>
                </span>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Informe de rendimentos
// ---------------------------------------------------------------------------

export function linhasDoInforme(linhas: Informe["linhas"]): LinhaInforme[] {
  return linhas.map((l) => ({
    competencia: l.competencia,
    faturaPagoEm: l.fatura_pago_em,
    faturaPaga: l.fatura_paga,
    repassePagoEm: l.repasse_pago_em,
    status: l.status,
    imovel: l.imovel,
    endereco: l.endereco,
    contrato: l.contrato,
    locatarioNome: l.locatario?.nome ?? null,
    locatarioDocumento: l.locatario?.documento ?? null,
    aluguel: l.aluguel,
    encargos: l.encargos,
    multaJuros: l.multa_juros,
    taxaAdministracao: l.taxa_administracao,
    taxaIntermediacao: l.taxa_intermediacao,
    irrf: l.irrf,
    imposto: l.imposto,
    outrosDescontos: l.outros_descontos,
    liquido: l.valor_liquido,
  }));
}

export async function InformeProprietario({ token, ano }: { token: string; ano: string | undefined }) {
  const atual = Number(hojeISO().slice(0, 4));
  const escolhido = ano && /^\d{4}$/.test(ano) ? Number(ano) : atual - 1;
  const d = await dadosPortal<Informe>(token, "informe", { ano: String(escolhido) });
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  const informe = informeRendimentos(linhasDoInforme(d.linhas), escolhido);
  const anos = [atual, atual - 1, atual - 2, atual - 3];
  return (
    <div className="space-y-4">
      <div className="nao-imprimir flex flex-wrap items-center justify-between gap-3">
        <PilulasLink rotulo="Ano" ativo={`/portal/${token}/informe?ano=${escolhido}`} itens={anos.map((a) => ({ href: `/portal/${token}/informe?ano=${a}`, rotulo: String(a) }))} />
        <BotaoImprimir />
      </div>
      <DocumentoInforme informe={informe} organizacao={d.organizacao} beneficiario={d.beneficiario} />
    </div>
  );
}
