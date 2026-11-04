import type { ReactNode } from "react";
import Link from "next/link";
import { AlertTriangle, ClipboardCheck, CreditCard, FileText, Receipt, Wrench } from "lucide-react";
import { pixDaCobranca } from "@/app/(app)/cobrancas/dados";
import { TextoDocumento } from "@/app/(app)/documentos/campos";
import { DocumentoCobranca } from "@/app/(app)/faturas/documento-cobranca";
import { FormJaPaguei } from "@/app/pagar/[token]/form";
import { Contador } from "@/components/abas-segmentadas";
import { Copiar } from "@/components/copiar";
import { BotaoImprimir } from "@/components/formulario";
import { Aviso, Cartao, Celula, Definicao, Indicador, LinhaVazia, Selo, Tabela, classeBotao } from "@/components/ui";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { FORMAS_RECEBIMENTO, identificacaoImovel, situacaoFatura, type ImovelEndereco } from "@/lib/dominio/cobrancas";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { formatarReais, paraCentavos } from "@/lib/dominio/dinheiro";
import { COR_STATUS_CHAMADO, ROTULO_CATEGORIA_CURTO, ROTULO_STATUS_CHAMADO } from "@/lib/dominio/manutencao";
import { COR_ESTADO, ROTULO_ESTADO, ROTULO_MEDIDOR, ROTULO_RESPONSAVEL, ROTULO_STATUS_PENDENCIA, ROTULO_STATUS_VISTORIA, ROTULO_TIPO_VISTORIA, UNIDADE_MEDIDOR } from "@/lib/dominio/vistorias";
import { EnviarFotos, FormChamadoPortal } from "../formularios";
import { dadosPortal, ehErroPortal } from "../sessao";
import { AvisoSessao, NaoEncontrado } from "./comum";
import { ListaDocumentos, situacaoAluguel, type DocumentoLista } from "./proprietario";

type Num = number | string;
const reais = (v: Num | null | undefined) => formatarReais(v ?? 0);
const saldo = (f: { valor_total: Num; valor_abatido: Num }) => Math.max(0, Number(f.valor_total) - Number(f.valor_abatido));
const corChamado = (s: string) => COR_STATUS_CHAMADO[s as keyof typeof COR_STATUS_CHAMADO] ?? "cinza";
const ROTULO_GARANTIA: Record<string, string> = {
  fiador: "Fiador",
  caucao: "Caução",
  seguro_fianca: "Seguro-fiança",
  titulo_capitalizacao: "Título de capitalização",
  carta_fianca: "Carta-fiança",
  outro: "Outra garantia",
};
const ROTULO_DESOCUPACAO: Record<string, string> = { aviso: "Aviso recebido", vistoria: "Vistoria de saída", acerto: "Acerto de contas", concluida: "Concluída" };

/** Contratos ativos para os formulários (rótulo curto). */
export async function contratosDoLocatario(token: string): Promise<{ id: string; rotulo: string }[]> {
  const d = await dadosPortal<{ contratos: { id: string; numero: number; imovel: string }[] }>(token, "manutencao");
  if (!d || ehErroPortal(d)) return [];
  return d.contratos.map((c) => ({ id: c.id, rotulo: `${c.imovel} · contrato nº ${c.numero}` }));
}

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

type Inicio = {
  contrato: { id: string; numero: number; imovel: string; endereco: string | null; valor_aluguel: Num; dia_vencimento: number; fim: string; status: string } | null;
  proxima: { id: string; numero: number; competencia: string; vencimento: string; valor_total: Num; valor_abatido: Num; token: string } | null;
  em_atraso: number;
  chamados_abertos: number;
  vistorias: number;
};

export async function InicioLocatario({ token }: { token: string }) {
  const d = await dadosPortal<Inicio>(token, "inicio");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  const base = `/portal/${token}`;
  const hoje = hojeISO();
  return (
    <div className="space-y-5">
      {d.em_atraso > 0 && (
        <Aviso tipo="erro">
          Você tem {d.em_atraso} aluguel(éis) em atraso.{" "}
          <Link href={`${base}/cobrancas`} className="font-semibold text-acento hover:underline">
            Ver e pagar
          </Link>
        </Aviso>
      )}
      <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador
          rotulo="Próximo aluguel"
          valor={d.proxima ? <Contador valor={saldo(d.proxima)} formato="moeda" /> : "—"}
          detalhe={d.proxima ? `vence em ${formatarDataBR(d.proxima.vencimento)}` : "nada em aberto"}
          icone={<CreditCard />}
          tom={d.proxima && d.proxima.vencimento < hoje ? "perigo" : "neutro"}
          href={`${base}/cobrancas`}
        />
        <Indicador rotulo="Em atraso" valor={<Contador valor={d.em_atraso} />} icone={<AlertTriangle />} tom={d.em_atraso ? "perigo" : "sucesso"} href={`${base}/cobrancas`} />
        <Indicador rotulo="Consertos em andamento" valor={<Contador valor={d.chamados_abertos} />} icone={<Wrench />} href={`${base}/manutencao`} />
        <Indicador rotulo="Vistorias" valor={<Contador valor={d.vistorias} />} icone={<ClipboardCheck />} href={`${base}/vistorias`} />
      </div>
      {d.contrato && (
        <Cartao
          titulo={`Seu contrato · ${d.contrato.imovel}`}
          acoes={
            <Link href={`${base}/contrato`} className={classeBotao("secundario", "sm")}>
              <FileText className="size-3.5" /> Ver contrato
            </Link>
          }
        >
          <Definicao
            itens={[
              ["Endereço", d.contrato.endereco],
              ["Aluguel", reais(d.contrato.valor_aluguel)],
              ["Vencimento", `todo dia ${d.contrato.dia_vencimento}`],
              ["Contrato até", formatarDataBR(d.contrato.fim)],
            ]}
          />
          {d.proxima && (
            <div className="mt-4 flex flex-wrap gap-2">
              <Link href={`${base}/pagar/${d.proxima.id}`} className={classeBotao("primario")}>
                Pagar {formatarCompetencia(d.proxima.competencia)} com Pix / 2ª via
              </Link>
              <Link href={`${base}/manutencao`} className={classeBotao("secundario")}>
                Pedir conserto
              </Link>
            </div>
          )}
        </Cartao>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Contrato
// ---------------------------------------------------------------------------

type Contrato = {
  id: string;
  numero: number;
  codigo: string | null;
  status: string;
  finalidade: string;
  inicio: string;
  fim: string;
  prazo_meses: number;
  valor_aluguel: Num;
  dia_vencimento: number;
  indice: string;
  data_base_reajuste: string;
  multa_pct: Num;
  juros_mes_pct: Num;
  pontualidade_pct: Num;
  multa_rescisoria_alugueis: Num;
  imovel: string;
  endereco: string | null;
  encargos: { descricao: string; tipo: string; valor: Num }[];
  garantias: { tipo: string; instituicao: string | null; valor: Num | null; fim: string | null; status: string; fiador: string | null }[];
  aditivos: { numero: number; tipo: string; descricao: string; data: string }[];
  desocupacao: { status: string; entrega_prevista: string | null; aviso_em: string } | null;
  documentos: DocumentoLista[];
};

const pct = (v: Num) => `${Number(v).toLocaleString("pt-BR")}%`;

export async function ContratoLocatario({ token }: { token: string }) {
  const lista = await dadosPortal<Contrato[]>(token, "contrato");
  if (ehErroPortal(lista)) return <AvisoSessao erro={lista.erro} token={token} />;
  if (!lista || lista.length === 0) return <NaoEncontrado texto="Nenhum contrato no seu nome." />;
  return (
    <div className="space-y-5">
      {lista.map((c) => (
        <Cartao key={c.id} titulo={`Contrato nº ${c.numero}${c.codigo ? ` (${c.codigo})` : ""} · ${c.imovel}`} acoes={<Selo cor={c.status === "ativo" ? "verde" : "cinza"}>{c.status}</Selo>}>
          <Definicao
            itens={[
              ["Endereço", c.endereco],
              ["Vigência", `${formatarDataBR(c.inicio)} a ${formatarDataBR(c.fim)} (${c.prazo_meses} meses)`],
              ["Aluguel", reais(c.valor_aluguel)],
              ["Vencimento", `todo dia ${c.dia_vencimento}`],
              ["Reajuste", `${c.indice} · a partir de ${formatarDataBR(c.data_base_reajuste)}`],
              ["Atraso", `multa ${pct(c.multa_pct)} + juros ${pct(c.juros_mes_pct)} ao mês`],
              ["Desconto por pontualidade", Number(c.pontualidade_pct) > 0 ? pct(c.pontualidade_pct) : "—"],
              ["Multa por saída antecipada", `${Number(c.multa_rescisoria_alugueis).toLocaleString("pt-BR")} aluguel(éis), proporcional ao tempo que falta`],
            ]}
          />
          {c.desocupacao && (
            <div className="mt-4">
              <Aviso tipo="alerta">
                Desocupação em andamento: {ROTULO_DESOCUPACAO[c.desocupacao.status] ?? c.desocupacao.status}
                {c.desocupacao.entrega_prevista ? ` · entrega prevista em ${formatarDataBR(c.desocupacao.entrega_prevista)}` : ""}.
              </Aviso>
            </div>
          )}
          <div className="mt-5 grid gap-5 lg:grid-cols-2">
            <section>
              <h4 className="mb-2 text-[14px] font-semibold">Encargos</h4>
              {c.encargos.length === 0 ? (
                <p className="text-sm text-mudo">Nenhum encargo no contrato.</p>
              ) : (
                <ul className="divide-y divide-borda-suave text-sm">
                  {c.encargos.map((e, i) => (
                    <li key={i} className="flex justify-between gap-3 py-1.5">
                      <span>{e.descricao}</span>
                      <span className="tabular-nums">{reais(e.valor)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section>
              <h4 className="mb-2 text-[14px] font-semibold">Garantia</h4>
              {c.garantias.length === 0 ? (
                <p className="text-sm text-mudo">Sem garantia cadastrada.</p>
              ) : (
                <ul className="divide-y divide-borda-suave text-sm">
                  {c.garantias.map((g, i) => (
                    <li key={i} className="py-1.5">
                      {ROTULO_GARANTIA[g.tipo] ?? g.tipo}
                      {g.fiador ? `: ${g.fiador}` : g.instituicao ? `: ${g.instituicao}` : ""}
                      {g.valor ? ` · ${reais(g.valor)}` : ""}
                      {g.fim ? ` · até ${formatarDataBR(g.fim)}` : ""}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
          {c.aditivos.length > 0 && (
            <section className="mt-5">
              <h4 className="mb-2 text-[14px] font-semibold">Aditivos</h4>
              <ul className="divide-y divide-borda-suave text-sm">
                {c.aditivos.map((a) => (
                  <li key={a.numero} className="py-1.5">
                    nº {a.numero} · {formatarDataBR(a.data)} — {a.descricao}
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="mt-5">
            <h4 className="mb-2 text-[14px] font-semibold">Documentos</h4>
            <ListaDocumentos token={token} documentos={c.documentos} />
          </section>
        </Cartao>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagar aluguel (2ª via, Pix, boleto)
// ---------------------------------------------------------------------------

type Cobrancas = {
  link_publico: boolean;
  meios: string[] | null;
  instrucoes: string | null;
  faturas: {
    id: string;
    numero: number;
    competencia: string;
    vencimento: string;
    valor_total: Num;
    valor_abatido: Num;
    status: string;
    pago_em: string | null;
    valor_pago: Num | null;
    token: string | null;
    linha_digitavel: string | null;
    url_pagamento: string | null;
    imovel: string;
  }[];
  parcelas: { id: string; numero: number; vencimento: string; valor: Num; token: string; acordo: number; parcelas: number }[];
};

export async function CobrancasLocatario({ token }: { token: string }) {
  const d = await dadosPortal<Cobrancas>(token, "cobrancas");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  const hoje = hojeISO();
  const abertas = d.faturas.filter((f) => f.status === "aberta" || f.status === "renegociada");
  const pagas = d.faturas.filter((f) => f.status === "paga");
  return (
    <div className="space-y-5">
      <Aviso>
        Para pagar, abra <b>Pagar / 2ª via</b>: ela mostra o valor do dia (com multa e juros, se houver atraso) e o <b>Pix copia e cola</b>. Depois de pagar, use o
        botão “Já paguei” para avisar a gente. <b>Boleto bancário</b> depende de integração com o banco: quando ela estiver ligada, a linha digitável aparece aqui.
      </Aviso>
      <Cartao titulo="Em aberto">
        {abertas.length === 0 && d.parcelas.length === 0 ? (
          <p className="text-sm text-ok">Nenhum aluguel em aberto. Obrigado!</p>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {abertas.map((f) => {
              const s = situacaoAluguel(f, hoje);
              return (
                <li key={f.id} className="space-y-2 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <div className="font-medium text-texto">
                        Aluguel {formatarCompetencia(f.competencia)} · {f.imovel}
                      </div>
                      <div className="text-xs text-mudo">
                        vence em {formatarDataBR(f.vencimento)} · {Number(f.valor_abatido) > 0 ? `falta ${reais(saldo(f))} de ${reais(f.valor_total)}` : reais(f.valor_total)}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Selo cor={s.cor}>{s.rotulo}</Selo>
                      {f.status === "aberta" && (
                        <Link href={`/portal/${token}/pagar/${f.id}`} className={classeBotao("primario", "sm")}>
                          <CreditCard className="size-3.5" /> Pagar / 2ª via
                        </Link>
                      )}
                      {f.url_pagamento && (
                        <a href={f.url_pagamento} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                          Boleto
                        </a>
                      )}
                    </div>
                  </div>
                  {f.linha_digitavel && (
                    <div className="flex flex-wrap items-center gap-2 rounded-[12px] border border-borda bg-elev px-3 py-2">
                      <code className="min-w-0 flex-1 break-all text-xs text-texto-2">{f.linha_digitavel}</code>
                      <Copiar texto={f.linha_digitavel} rotulo="Copiar linha do boleto" />
                    </div>
                  )}
                  {f.status === "renegociada" && <p className="text-xs text-mudo">Este aluguel entrou num acordo: pague pelas parcelas do acordo abaixo.</p>}
                </li>
              );
            })}
            {d.parcelas.map((p) => (
              <li key={p.token} className="flex flex-wrap items-center justify-between gap-3 py-3">
                <div>
                  <div className="font-medium text-texto">
                    Acordo nº {p.acordo} · {p.numero === 0 ? "entrada" : `parcela ${p.numero} de ${p.parcelas}`}
                  </div>
                  <div className="text-xs text-mudo">
                    vence em {formatarDataBR(p.vencimento)} · {reais(p.valor)}
                  </div>
                </div>
                <Link href={`/portal/${token}/pagar/${p.id}`} className={classeBotao("primario", "sm")}>
                  <CreditCard className="size-3.5" /> Pagar / 2ª via
                </Link>
              </li>
            ))}
          </ul>
        )}
        {d.instrucoes && <p className="mt-3 whitespace-pre-line text-sm text-texto-2">{d.instrucoes}</p>}
      </Cartao>
      {pagas.length > 0 && (
        <Cartao titulo="Pagos recentemente">
          <ul className="divide-y divide-borda-suave">
            {pagas.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <span>
                  Aluguel {formatarCompetencia(f.competencia)} · {f.imovel} · pago em {formatarDataBR(f.pago_em)}
                </span>
                <Link href={`/portal/${token}/recibo/${f.id}`} className={classeBotao("secundario", "sm")}>
                  <Receipt className="size-3.5" /> Recibo
                </Link>
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagar (2ª via dentro do portal, com Pix copia e cola)
// ---------------------------------------------------------------------------

type Via = {
  tipo: "fatura" | "parcela";
  token: string;
  link_publico: boolean;
  organizacao: {
    nome: string;
    documento: string | null;
    telefone: string | null;
    email: string | null;
    pix_chave: string | null;
    pix_nome: string | null;
    pix_cidade: string | null;
    meios: string[] | null;
    instrucoes: string | null;
    banco: string | null;
    agencia: string | null;
    conta: string | null;
  };
  imovel: ImovelEndereco;
  locatario: string | null;
  contrato: { numero: number; multa_pct: Num; juros_mes_pct: Num; carencia_dias: number; pontualidade_pct: Num | null; valor_aluguel: Num };
  fatura: {
    numero: number;
    competencia: string;
    vencimento: string;
    valor_total: Num;
    valor_abatido: Num;
    valor_recebido: Num;
    status: string;
    pago_em: string | null;
    valor_pago: Num | null;
    linha_digitavel: string | null;
    url_pagamento: string | null;
    periodo_inicio: string | null;
    periodo_fim: string | null;
    itens: { descricao: string; valor: Num }[];
    multa_cobrada: Num;
    ultimo_pagamento: string | null;
  } | null;
  parcela: { numero: number; vencimento: string; valor: Num; status: string; pago_em: string | null; acordo: number; parcelas: number; tem_entrada: boolean } | null;
};

/**
 * 2ª via dentro do portal: mesmo documento e mesmo Pix da página pública
 * /pagar/[token], mas sem depender do "link público da 2ª via" (a pessoa já
 * confirmou quem é). "Já paguei" avisa a equipe pela mesma função da 2ª via.
 */
export async function PagarLocatario({ token, id }: { token: string; id: string }) {
  const via = await dadosPortal<Via>(token, "pagar", { id });
  if (ehErroPortal(via)) return <AvisoSessao erro={via.erro} token={token} />;
  if (!via) return <NaoEncontrado texto="Cobrança não encontrada." />;
  const o = via.organizacao;
  const hoje = hojeISO();
  const meios = o.meios ?? [];
  const recebedor = o.pix_chave && meios.includes("pix") ? { chave: o.pix_chave, nome: o.pix_nome || o.nome, cidade: o.pix_cidade } : null;
  let corpo: ReactNode = null;
  let aberta = false;
  if (via.tipo === "fatura" && via.fatura) {
    const f = via.fatura;
    aberta = f.status === "aberta";
    const abatido = paraCentavos(f.valor_abatido);
    const pagamentos = abatido
      ? [{ data: f.ultimo_pagamento ?? f.vencimento, valor: paraCentavos(f.valor_recebido), principal: abatido, multa: paraCentavos(f.multa_cobrada), juros: 0, desconto: 0 }]
      : [];
    const sit = aberta
      ? situacaoFatura(
          { valorTotal: paraCentavos(f.valor_total), vencimento: f.vencimento },
          pagamentos,
          { multaPct: Number(via.contrato.multa_pct), jurosMesPct: Number(via.contrato.juros_mes_pct), carenciaDias: via.contrato.carencia_dias },
          hoje,
          { pct: Number(via.contrato.pontualidade_pct ?? 0), aluguel: paraCentavos(via.contrato.valor_aluguel) },
        )
      : null;
    const total = sit ? (sit.diasAtraso > 0 ? sit.totalComEncargos : sit.saldo) : 0;
    corpo =
      f.status === "renegociada" ? (
        <div className="rounded-card border border-borda bg-card p-6 text-texto-2">Este aluguel entrou num acordo de pagamento: pague pelas parcelas do acordo em “Pagar aluguel”.</div>
      ) : (
        <DocumentoCobranca
          d={{
            organizacao: { nome: o.nome, documento: o.documento, telefone: o.telefone, email: o.email },
            numero: f.numero,
            competencia: f.competencia,
            vencimento: f.vencimento,
            periodoInicio: f.periodo_inicio,
            periodoFim: f.periodo_fim,
            locatario: via.locatario ? { nome: via.locatario } : null,
            imovel: via.imovel,
            itens: f.itens,
            status: f.status,
            pagoEm: f.pago_em,
            valorPago: f.valor_pago,
            sit,
            hoje,
            multaPct: Number(via.contrato.multa_pct),
            jurosMesPct: Number(via.contrato.juros_mes_pct),
            carenciaDias: via.contrato.carencia_dias,
            pix: aberta ? pixDaCobranca(recebedor, total, `FAT${f.numero}`) : null,
            linhaDigitavel: f.linha_digitavel,
            urlPagamento: f.url_pagamento,
            meios,
            banco: { banco: o.banco, agencia: o.agencia, conta: o.conta },
            instrucoes: o.instrucoes,
          }}
        />
      );
  } else if (via.parcela) {
    const p = via.parcela;
    aberta = p.status === "aberta";
    const pix = aberta ? pixDaCobranca(recebedor, paraCentavos(p.valor), `AC${p.acordo}P${p.numero}`) : null;
    corpo = (
      <article className="rounded-card border border-borda bg-card p-6 text-texto">
        <div className="text-sm text-mudo">{o.nome}</div>
        <h2 className="mt-1 text-[20px] font-semibold">
          Acordo nº {p.acordo} · {p.numero === 0 ? "entrada" : `parcela ${p.numero} de ${p.parcelas}`}
        </h2>
        <p className="mt-1 text-sm text-texto-2">
          {via.locatario ?? ""} · {identificacaoImovel(via.imovel)}
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm text-texto-2">Vencimento {formatarDataBR(p.vencimento)}</div>
            <div className="text-[28px] font-semibold tabular-nums">{reais(p.valor)}</div>
          </div>
          {p.status === "paga" && <span className="text-sm font-medium text-ok">Paga em {formatarDataBR(p.pago_em)}. Obrigado!</span>}
        </div>
        {pix && (
          <div className="mt-4 rounded-[14px] border border-borda bg-elev p-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Pix copia e cola</span>
              <Copiar texto={pix} rotulo="Copiar código Pix" />
            </div>
            <div className="break-all font-mono text-[11px] text-texto-2">{pix}</div>
          </div>
        )}
        {o.instrucoes && <p className="mt-3 whitespace-pre-line text-sm text-texto-2">{o.instrucoes}</p>}
      </article>
    );
  }
  return (
    <div className="space-y-5">
      <div className="nao-imprimir flex flex-wrap justify-between gap-2">
        <Link href={`/portal/${token}/cobrancas`} className={classeBotao("fantasma")}>
          ← Voltar
        </Link>
        <BotaoImprimir />
      </div>
      {aberta && !recebedor && (
        <Aviso tipo="alerta">O Pix ainda não foi configurado por {o.nome}. Peça os dados de pagamento em “Renovação, saída e contato”.</Aviso>
      )}
      {corpo}
      {aberta && (
        <section className="nao-imprimir rounded-card border border-borda bg-card p-5">
          <h2 className="mb-1 text-[16px] font-semibold text-texto">Já pagou?</h2>
          <p className="mb-3 text-sm text-texto-2">Avise por aqui que a gente confere e dá a baixa.</p>
          <FormJaPaguei token={via.token} hoje={hoje} />
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Histórico de pagamentos e recibo
// ---------------------------------------------------------------------------

type Pagamentos = {
  recebimentos: { fatura_id: string; fatura: number; competencia: string; pago_em: string; valor: Num; principal: Num; multa: Num; juros: Num; desconto: Num; forma: string | null; status_fatura: string }[];
  antigos: { fatura_id: string; fatura: number; competencia: string; pago_em: string; valor: Num; forma: string | null }[];
};

export async function PagamentosLocatario({ token }: { token: string }) {
  const d = await dadosPortal<Pagamentos>(token, "pagamentos");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  const linhas = [
    ...d.recebimentos.map((r) => ({ ...r, detalhe: [Number(r.multa) > 0 ? `multa ${reais(r.multa)}` : null, Number(r.juros) > 0 ? `juros ${reais(r.juros)}` : null, Number(r.desconto) > 0 ? `desconto ${reais(r.desconto)}` : null].filter(Boolean).join(" · ") })),
    ...d.antigos.map((r) => ({ ...r, detalhe: "" })),
  ].sort((a, b) => b.pago_em.localeCompare(a.pago_em));
  return (
    <Tabela colunas={["Pago em", "Aluguel", "Valor", "Forma", ""]}>
      {linhas.length === 0 && <LinhaVazia colunas={5}>Nenhum pagamento nos últimos 3 anos.</LinhaVazia>}
      {linhas.map((l, i) => (
        <tr key={`${l.fatura_id}-${i}`}>
          <Celula>{formatarDataBR(l.pago_em)}</Celula>
          <Celula>
            {formatarCompetencia(l.competencia)} <span className="text-xs text-mudo">fatura nº {l.fatura}</span>
            {l.detalhe && <span className="block text-xs text-mudo">{l.detalhe}</span>}
          </Celula>
          <Celula className="tabular-nums">{reais(l.valor)}</Celula>
          <Celula>{l.forma ? (FORMAS_RECEBIMENTO[l.forma] ?? l.forma) : "—"}</Celula>
          <Celula>
            <Link href={`/portal/${token}/recibo/${l.fatura_id}`} className={classeBotao("secundario", "sm")}>
              <Receipt className="size-3.5" /> Recibo
            </Link>
          </Celula>
        </tr>
      ))}
    </Tabela>
  );
}

type Recibo = {
  organizacao: { nome: string; documento: string | null; telefone: string | null; email: string | null; modo: string };
  locatario: { nome: string; documento: string | null };
  imovel: string;
  endereco: string | null;
  contrato: number;
  fatura: { numero: number; competencia: string; vencimento: string; valor_total: Num; valor_abatido: Num; status: string; pago_em: string | null; valor_pago: Num | null; periodo_inicio: string | null; periodo_fim: string | null };
  itens: { descricao: string; valor: Num; tipo: string }[];
  pagamentos: { pago_em: string; valor: Num; forma: string | null; multa: Num; juros: Num; desconto: Num }[];
};

export async function ReciboLocatario({ token, id }: { token: string; id: string }) {
  const r = await dadosPortal<Recibo>(token, "recibo", { id });
  if (ehErroPortal(r)) return <AvisoSessao erro={r.erro} token={token} />;
  if (!r) return <NaoEncontrado texto="Recibo não encontrado (só aluguéis pagos, mesmo que em parte)." />;
  const f = r.fatura;
  const total = r.pagamentos.length ? r.pagamentos.reduce((s, p) => s + Number(p.valor), 0) : Number(f.valor_pago ?? f.valor_total);
  const quitado = f.status === "paga";
  return (
    <div className="space-y-4">
      <div className="nao-imprimir flex flex-wrap justify-between gap-2">
        <Link href={`/portal/${token}/pagamentos`} className={classeBotao("fantasma")}>
          ← Voltar aos pagamentos
        </Link>
        <BotaoImprimir />
      </div>
      <article className="mx-auto max-w-3xl space-y-5 rounded-card border border-borda bg-card p-8 text-sm text-texto print:border-0 print:p-0">
        <header className="flex flex-wrap items-start justify-between gap-4 border-b border-borda pb-4">
          <div>
            <div className="text-[17px] font-semibold">{r.organizacao.nome}</div>
            <div className="text-xs text-mudo">{[r.organizacao.documento ? formatarDocumento(r.organizacao.documento) : null, r.organizacao.telefone, r.organizacao.email].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="text-right">
            <div className="text-[20px] font-semibold">Recibo de aluguel</div>
            <div className="text-xs text-mudo">fatura nº {f.numero}</div>
          </div>
        </header>
        <p className="text-[15px] leading-relaxed">
          Recebemos de <b>{r.locatario.nome}</b>
          {r.locatario.documento ? ` (${formatarDocumento(r.locatario.documento)})` : ""} a quantia de <b>{reais(total)}</b>
          {quitado ? "" : " (pagamento parcial)"}, referente ao aluguel de <b>{formatarCompetencia(f.competencia)}</b>
          {f.periodo_inicio && f.periodo_fim ? ` (período de ${formatarDataBR(f.periodo_inicio)} a ${formatarDataBR(f.periodo_fim)})` : ""} do imóvel {r.imovel}
          {r.endereco ? `, ${r.endereco}` : ""}, contrato nº {r.contrato}.
        </p>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-borda-suave">
            {r.itens.map((i, k) => (
              <tr key={k}>
                <td className="py-1.5">{i.descricao}</td>
                <td className="py-1.5 text-right tabular-nums">{reais(i.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {r.pagamentos.length > 0 && (
          <section>
            <h3 className="mb-1 text-[14px] font-semibold">Pagamentos</h3>
            <ul className="divide-y divide-borda-suave">
              {r.pagamentos.map((p, k) => (
                <li key={k} className="flex justify-between gap-3 py-1.5">
                  <span>
                    {formatarDataBR(p.pago_em)} · {p.forma ? (FORMAS_RECEBIMENTO[p.forma] ?? p.forma) : "—"}
                    {Number(p.multa) + Number(p.juros) > 0 ? ` · inclui multa/juros ${reais(Number(p.multa) + Number(p.juros))}` : ""}
                  </span>
                  <span className="tabular-nums">{reais(p.valor)}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <p className="text-xs text-mudo">
          {quitado ? `Aluguel quitado em ${formatarDataBR(f.pago_em)}.` : `Ainda falta ${reais(saldo(f))} desta fatura.`} Recibo gerado pelo portal em {formatarDataBR(hojeISO())}.
        </p>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Manutenção
// ---------------------------------------------------------------------------

type Manutencao = {
  contratos: { id: string; numero: number; imovel: string }[];
  chamados: { id: string; numero: number; titulo: string; categoria: string; urgencia: string; status: string; criado_em: string; agendado_para: string | null; concluido_em: string | null; garantia_ate: string | null; confirmado: boolean; imovel: string }[];
};

export async function ManutencaoLocatario({ token, telefone }: { token: string; telefone: string | null }) {
  const d = await dadosPortal<Manutencao>(token, "manutencao");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  const contratos = d.contratos.map((c) => ({ id: c.id, rotulo: `${c.imovel} · contrato nº ${c.numero}` }));
  return (
    <div className="grid gap-5 lg:grid-cols-[1.1fr_1fr]">
      <Cartao titulo="Pedir conserto">
        <p className="mb-4 text-sm text-texto-2">Em caso de risco (gás, fogo, curto-circuito), saia do local e ligue para os bombeiros (193) antes de abrir o chamado.</p>
        <FormChamadoPortal token={token} contratos={contratos} telefone={telefone} />
      </Cartao>
      <Cartao titulo="Seus chamados">
        {d.chamados.length === 0 ? (
          <p className="text-sm text-mudo">Nenhum chamado ainda.</p>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {d.chamados.map((c) => (
              <li key={c.id} className="space-y-2 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="font-medium text-texto">
                      #{c.numero} · {c.titulo}
                    </div>
                    <div className="text-xs text-mudo">
                      {ROTULO_CATEGORIA_CURTO[c.categoria] ?? c.categoria} · {c.imovel} · aberto em {formatarDataBR(diaLocal(c.criado_em))}
                      {c.agendado_para && !["concluido", "avaliado"].includes(c.status) ? ` · marcado para ${formatarDataBR(diaLocal(c.agendado_para))} às ${horaLocal(c.agendado_para)}` : ""}
                      {c.concluido_em ? ` · concluído em ${formatarDataBR(c.concluido_em)}` : ""}
                      {c.garantia_ate ? ` · garantia até ${formatarDataBR(c.garantia_ate)}` : ""}
                    </div>
                  </div>
                  <Selo cor={corChamado(c.status)}>{ROTULO_STATUS_CHAMADO[c.status] ?? c.status}</Selo>
                </div>
                {["aberto", "em_analise", "aguardando_aprovacao", "aprovado", "agendado"].includes(c.status) && <EnviarFotos token={token} chamadoId={c.id} rotulo="Mandar mais fotos" />}
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Vistorias
// ---------------------------------------------------------------------------

type VistoriaLista = { id: string; numero: number; tipo: string; status: string; data: string; imovel: string; contestacao_ate: string | null; contestar_token: string | null };

export async function VistoriasLocatario({ token }: { token: string }) {
  const lista = await dadosPortal<VistoriaLista[]>(token, "vistorias");
  if (ehErroPortal(lista)) return <AvisoSessao erro={lista.erro} token={token} />;
  return (
    <Tabela colunas={["Vistoria", "Imóvel", "Data", "Situação", ""]}>
      {(lista ?? []).length === 0 && <LinhaVazia colunas={5}>Nenhuma vistoria concluída no seu contrato.</LinhaVazia>}
      {(lista ?? []).map((v) => (
        <tr key={v.id}>
          <Celula>
            nº {v.numero} · {ROTULO_TIPO_VISTORIA[v.tipo] ?? v.tipo}
          </Celula>
          <Celula>{v.imovel}</Celula>
          <Celula>{formatarDataBR(v.data)}</Celula>
          <Celula>
            <Selo cor={v.status === "contestada" ? "amarelo" : "verde"}>{ROTULO_STATUS_VISTORIA[v.status] ?? v.status}</Selo>
          </Celula>
          <Celula>
            <div className="flex flex-wrap justify-end gap-2">
              <Link href={`/portal/${token}/vistoria/${v.id}`} className={classeBotao("secundario", "sm")}>
                <ClipboardCheck className="size-3.5" /> Ver laudo
              </Link>
              {v.contestar_token && (
                <a href={`/contestar/${v.contestar_token}`} target="_blank" rel="noreferrer" className={classeBotao("fantasma", "sm")}>
                  Contestar{v.contestacao_ate ? ` (até ${formatarDataBR(v.contestacao_ate)})` : ""}
                </a>
              )}
            </div>
          </Celula>
        </tr>
      ))}
    </Tabela>
  );
}

type Vistoria = VistoriaLista & {
  endereco: string | null;
  responsavel: string | null;
  acompanhante: string | null;
  observacoes: string | null;
  conclusao: string | null;
  ambientes: { nome: string; observacoes: string | null; itens: { nome: string; estado: string | null; observacao: string | null }[] }[];
  medidores: { tipo: string; numero: string | null; leitura: Num | null; observacao: string | null }[];
  pendencias: { descricao: string; tipo: string; responsavel: string; status: string; prazo: string | null }[];
};

export async function VistoriaLocatario({ token, id }: { token: string; id: string }) {
  const v = await dadosPortal<Vistoria>(token, "vistoria", { id });
  if (ehErroPortal(v)) return <AvisoSessao erro={v.erro} token={token} />;
  if (!v) return <NaoEncontrado texto="Vistoria não encontrada." />;
  return (
    <div className="space-y-4">
      <div className="nao-imprimir flex flex-wrap justify-between gap-2">
        <Link href={`/portal/${token}/vistorias`} className={classeBotao("fantasma")}>
          ← Voltar às vistorias
        </Link>
        <div className="flex gap-2">
          {v.contestar_token && (
            <a href={`/contestar/${v.contestar_token}`} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              Contestar
            </a>
          )}
          <BotaoImprimir />
        </div>
      </div>
      <article className="space-y-5 rounded-card border border-borda bg-card p-[clamp(18px,2.4vw,32px)] text-sm text-texto print:border-0 print:p-0">
        <header className="border-b border-borda pb-4">
          <h2 className="text-[20px] font-semibold">
            Vistoria de {(ROTULO_TIPO_VISTORIA[v.tipo] ?? v.tipo).toLowerCase()} nº {v.numero}
          </h2>
          <p className="text-texto-2">
            {v.imovel}
            {v.endereco ? ` — ${v.endereco}` : ""} · {formatarDataBR(v.data)}
            {v.responsavel ? ` · vistoriador: ${v.responsavel}` : ""}
            {v.acompanhante ? ` · acompanhou: ${v.acompanhante}` : ""}
          </p>
        </header>
        {v.ambientes.map((a, i) => (
          <section key={i}>
            <h3 className="mb-1.5 text-[15px] font-semibold">{a.nome}</h3>
            <ul className="divide-y divide-borda-suave">
              {a.itens.map((it, k) => (
                <li key={k} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                  <span>
                    {it.nome}
                    {it.observacao && <span className="block text-xs text-mudo">{it.observacao}</span>}
                  </span>
                  {it.estado ? <Selo cor={COR_ESTADO[it.estado] ?? "cinza"}>{ROTULO_ESTADO[it.estado] ?? it.estado}</Selo> : <span className="text-xs text-mudo">—</span>}
                </li>
              ))}
            </ul>
            {a.observacoes && <p className="mt-1 text-xs text-texto-2">{a.observacoes}</p>}
          </section>
        ))}
        {v.medidores.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[15px] font-semibold">Medidores</h3>
            <ul className="divide-y divide-borda-suave">
              {v.medidores.map((m, i) => (
                <li key={i} className="flex justify-between gap-3 py-1.5">
                  <span>
                    {ROTULO_MEDIDOR[m.tipo] ?? m.tipo}
                    {m.numero ? ` nº ${m.numero}` : ""}
                  </span>
                  <span className="tabular-nums">{m.leitura != null ? `${Number(m.leitura).toLocaleString("pt-BR")} ${UNIDADE_MEDIDOR[m.tipo] ?? ""}` : "—"}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {v.pendencias.length > 0 && (
          <section>
            <h3 className="mb-1.5 text-[15px] font-semibold">Danos e pendências</h3>
            <ul className="divide-y divide-borda-suave">
              {v.pendencias.map((p, i) => (
                <li key={i} className="py-1.5">
                  {p.descricao}{" "}
                  <span className="text-xs text-mudo">
                    · responsável: {ROTULO_RESPONSAVEL[p.responsavel] ?? p.responsavel} · {ROTULO_STATUS_PENDENCIA[p.status] ?? p.status}
                    {p.prazo ? ` · prazo ${formatarDataBR(p.prazo)}` : ""}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}
        {(v.observacoes || v.conclusao) && (
          <section>
            <h3 className="mb-1.5 text-[15px] font-semibold">Observações e conclusão</h3>
            {v.observacoes && <p className="whitespace-pre-line text-texto-2">{v.observacoes}</p>}
            {v.conclusao && <p className="mt-1 whitespace-pre-line">{v.conclusao}</p>}
          </section>
        )}
        <p className="text-xs text-mudo">As fotos ficam guardadas com a administração; peça uma cópia em “Fale com a gente” se precisar.</p>
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Documento (texto gerado do banco, imprimível) — proprietário e locatário
// ---------------------------------------------------------------------------

type Documento = { id: string; numero: number; titulo: string; tipo: string; status: string; conteudo: string | null; assinado_em: string | null; hash: string | null; assinar_token: string | null };

export async function DocumentoPortal({ token, id, voltar }: { token: string; id: string; voltar: string }) {
  const d = await dadosPortal<Documento>(token, "documento", { id });
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado texto="Documento não encontrado." />;
  return (
    <div className="space-y-4">
      <div className="nao-imprimir flex flex-wrap justify-between gap-2">
        <Link href={`/portal/${token}/${voltar}`} className={classeBotao("fantasma")}>
          ← Voltar
        </Link>
        <div className="flex gap-2">
          {d.assinar_token && (
            <a href={`/assinar/${d.assinar_token}`} target="_blank" rel="noreferrer" className={classeBotao("primario")}>
              Assinar
            </a>
          )}
          <BotaoImprimir />
        </div>
      </div>
      {d.conteudo ? (
        <article className="mx-auto max-w-3xl rounded-card border border-borda bg-card p-8 print:border-0 print:p-0">
          <TextoDocumento texto={d.conteudo} />
          {d.assinado_em && (
            <p className="mt-6 border-t border-borda pt-3 text-xs text-mudo">
              Assinado eletronicamente em {formatarDataBR(diaLocal(d.assinado_em))}
              {d.hash ? ` · código SHA-256 ${d.hash}` : ""}.
            </p>
          )}
        </article>
      ) : (
        <NaoEncontrado texto="Este documento é um arquivo. Peça para a equipe compartilhar em “Arquivos”." />
      )}
    </div>
  );
}
