import type { Metadata } from "next";
import Link from "next/link";
import { CheckCheck, HandCoins, SearchCheck, TriangleAlert } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { DICA_INCONSISTENCIA, ROTULO_INCONSISTENCIA, inconsistenciasDoModo, type TipoInconsistencia } from "@/lib/dominio/ia";
import { pode } from "@/lib/permissoes";
import { AbasInteligencia } from "../abas";
import { conferirInconsistencia, desmarcarInconsistencia, sugerirAcao } from "../actions";
import { exigirOuVoltar, linkReferencia, porLotes, quando } from "../dados";

export const metadata: Metadata = { title: "Inconsistências financeiras" };

type Origem = { id: string; tipo: string; pessoa_id: string | null; contrato_id: string | null; imovel_id: string | null; descricao: string };

type Achado = {
  tipo: TipoInconsistencia;
  chave: string;
  descricao: string;
  valor: number | null;
  referencia_tipo: string | null;
  referencia_id: string | null;
  data: string | null;
  conferido_em: string | null;
  observacao: string | null;
};

/** Possíveis inconsistências financeiras (regras no banco, nos dois modos; as de repasse só na imobiliária). */
export default async function InconsistenciasPage({ searchParams }: PageProps<"/inteligencia/inconsistencias">) {
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  await exigirOuVoltar("financeiro", "ver");
  const podeConferir = await pode("financeiro", "editar");
  const tipos = inconsistenciasDoModo(organizacao.modo);
  const ver = sp.ver === "conferidas" ? "conferidas" : sp.ver === "todas" ? "todas" : "revisar";
  const tipo = tipos.find((t) => t === sp.tipo) ?? null;
  const { data, error } = await supabase.rpc("ia_inconsistencias", { p_dias_repasse: 5 });
  const todos = (data ?? []) as Achado[];
  const abertas = todos.filter((a) => !a.conferido_em);
  const lista = todos.filter((a) => (ver === "revisar" ? !a.conferido_em : ver === "conferidas" ? !!a.conferido_em : true)).filter((a) => !tipo || a.tipo === tipo);
  const base = "/inteligencia/inconsistencias";
  // "Pago a mais": sugerir o lançamento do acerto (devolução ou cobrança da diferença), que só
  // entra no Financeiro depois de aprovado. Dados da origem para preencher o lançamento.
  const pagoAMais = abertas.filter((a) => a.tipo === "pagamento_maior" && a.referencia_id);
  const idsLanc = pagoAMais.filter((a) => a.referencia_tipo === "lancamento").map((a) => a.referencia_id!);
  const idsFat = pagoAMais.filter((a) => a.referencia_tipo === "fatura").map((a) => a.referencia_id!);
  const [lancs, fats] = await Promise.all([
    porLotes(idsLanc, async (lote) => ((await supabase.from("lancamentos").select("id, tipo, pessoa_id, contrato_id, imovel_id, descricao").in("id", lote)).data ?? []) as Origem[]),
    porLotes(idsFat, async (lote) => ((await supabase.from("faturas").select("id, numero, contrato_id").in("id", lote)).data ?? []) as { id: string; numero: number | null; contrato_id: string | null }[]),
  ]);
  const origemLanc = new Map(lancs.map((l) => [l.id, l]));
  const origemFat = new Map(fats.map((f) => [f.id, f]));
  const hoje = hojeISO();
  const url = (o: { ver?: string; tipo?: string | null }) => {
    const p = new URLSearchParams();
    const v = o.ver ?? ver;
    if (v !== "revisar") p.set("ver", v);
    const t = o.tipo === undefined ? tipo : o.tipo;
    if (t) p.set("tipo", t);
    const s = p.toString();
    return s ? `${base}?${s}` : base;
  };
  return (
    <>
      <Cabecalho
        titulo="Inconsistências financeiras"
        trilha="Assistente e automações"
        descricao="O sistema confere sozinho, por regras: lançamento repetido, pago a mais, lançamento sem categoria, conta com saldo negativo e, na imobiliária, repasse sem o aluguel pago, aluguel pago sem repasse e taxa diferente do contrato. Revise e marque como conferido."
      />
      <AbasInteligencia modo={organizacao.modo} />
      {error && (
        <div className="mb-4">
          <Aviso tipo="erro">{error.message}</Aviso>
        </div>
      )}
      <div className="entrar-cascata mb-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Para revisar" valor={<Contador valor={abertas.length} />} icone={<TriangleAlert />} tom={abertas.length ? "alerta" : "sucesso"} href={url({ ver: "revisar" })} />
        <Indicador rotulo="Já conferidas" valor={<Contador valor={todos.length - abertas.length} />} icone={<CheckCheck />} href={url({ ver: "conferidas" })} />
        <Indicador rotulo="Tipos com ocorrência" valor={<Contador valor={new Set(abertas.map((a) => a.tipo)).size} />} icone={<SearchCheck />} detalhe={`de ${tipos.length} regras`} />
      </div>
      <div className="mb-4 flex flex-col gap-3">
        <PilulasLink
          rotulo="Situação"
          ativo={url({})}
          itens={[
            { href: url({ ver: "revisar" }), rotulo: "Para revisar" },
            { href: url({ ver: "conferidas" }), rotulo: "Conferidas" },
            { href: url({ ver: "todas" }), rotulo: "Todas" },
          ]}
        />
        <PilulasLink
          rotulo="Tipo"
          ativo={url({})}
          itens={[{ href: url({ tipo: null }), rotulo: "Todos os tipos" }, ...tipos.map((t) => ({ href: url({ tipo: t }), rotulo: ROTULO_INCONSISTENCIA[t], titulo: DICA_INCONSISTENCIA[t] }))]}
        />
      </div>
      <Tabela colunas={["Tipo", "O que foi encontrado", "Valor", "Data", "Situação", ""]}>
        {lista.length === 0 ? (
          <LinhaVazia colunas={6}>{ver === "revisar" ? "Nada para revisar." : "Nada aqui."}</LinhaVazia>
        ) : (
          lista.map((a) => {
            const link = linkReferencia(a.referencia_tipo, a.referencia_id);
            return (
              <tr key={`${a.tipo}|${a.chave}`}>
                <Celula>
                  <Selo cor={a.tipo === "saldo_negativo" || a.tipo === "pagamento_maior" ? "vermelho" : "amarelo"}>{ROTULO_INCONSISTENCIA[a.tipo]}</Selo>
                </Celula>
                <Celula className="text-[13px]">
                  {link ? (
                    <Link href={link} className="hover:text-acento">
                      {a.descricao}
                    </Link>
                  ) : (
                    a.descricao
                  )}
                  {a.observacao && <div className="text-xs text-mudo">Conferido: {a.observacao}</div>}
                </Celula>
                <Celula className="whitespace-nowrap tabular-nums">{a.valor !== null ? formatarReais(a.valor) : "—"}</Celula>
                <Celula className="whitespace-nowrap text-texto-2">{a.data ? formatarDataBR(a.data) : "—"}</Celula>
                <Celula className="whitespace-nowrap text-[13px]">{a.conferido_em ? <Selo cor="verde">Conferido {quando(a.conferido_em)}</Selo> : <Selo cor="amarelo">Revisar</Selo>}</Celula>
                <Celula>
                  <div className="flex flex-wrap gap-2">
                  {!a.conferido_em && a.tipo === "pagamento_maior" && a.referencia_id && a.valor !== null && a.valor > 0 && (
                    <SugerirAcerto
                      achado={a}
                      lanc={a.referencia_tipo === "lancamento" ? origemLanc.get(a.referencia_id) : undefined}
                      fatura={a.referencia_tipo === "fatura" ? origemFat.get(a.referencia_id) : undefined}
                      vencimento={somarDias(hoje, 5)}
                    />
                  )}
                  {podeConferir &&
                    (a.conferido_em ? (
                      <BotaoAcao acao={desmarcarInconsistencia} id={`${a.tipo}|${a.chave}`} tamanho="sm" variante="fantasma">
                        Desmarcar
                      </BotaoAcao>
                    ) : (
                      <JanelaCadastro rotuloBotao="Conferido" titulo="Marcar como conferido" acao={conferirInconsistencia} variante="secundario" tamanho="sm" rotuloSalvar="Marcar" icone={<CheckCheck />}>
                        <input type="hidden" name="tipo" value={a.tipo} />
                        <input type="hidden" name="chave" value={a.chave} />
                        <p className="text-sm text-texto-2">{a.descricao}</p>
                        <Campo rotulo="Observação (opcional)">
                          <Entrada name="observacao" maxLength={500} placeholder="Ex.: são duas contas diferentes" />
                        </Campo>
                      </JanelaCadastro>
                    ))}
                  </div>
                </Celula>
              </tr>
            );
          })
        )}
      </Tabela>
    </>
  );
}

/**
 * "Pago a mais" → sugerir o lançamento do acerto (vai para "Ações para aprovar"; só entra
 * no Financeiro, em aberto, depois de aprovado por quem pode criar lançamentos).
 * Recebido a mais (aluguel ou conta a receber) = devolver (a pagar); pago a mais a
 * fornecedor = cobrar a diferença (a receber).
 */
function SugerirAcerto({
  achado,
  lanc,
  fatura,
  vencimento,
}: {
  achado: Achado;
  lanc?: Origem;
  fatura?: { id: string; numero: number | null; contrato_id: string | null };
  vencimento: string;
}) {
  const tipo = lanc?.tipo === "pagar" ? "receber" : "pagar";
  const contrato = lanc?.contrato_id ?? fatura?.contrato_id ?? null;
  const descricao = fatura
    ? `Devolução de pagamento a maior — fatura${fatura.numero ? ` #${fatura.numero}` : ""}`
    : tipo === "pagar"
      ? `Devolução de valor recebido a maior — ${lanc?.descricao ?? "lançamento"}`
      : `Diferença paga a maior — ${lanc?.descricao ?? "lançamento"}`;
  return (
    <JanelaCadastro
      rotuloBotao={
        <>
          <HandCoins className="size-4" /> Sugerir acerto
        </>
      }
      titulo="Sugerir lançamento do acerto (vai para aprovação)"
      acao={sugerirAcao}
      variante="secundario"
      tamanho="sm"
      rotuloSalvar="Enviar para aprovação"
      icone={<HandCoins />}
    >
      <input type="hidden" name="tipo" value="criar_lancamento" />
      <input type="hidden" name="origem" value="usuario" />
      <input type="hidden" name="titulo" value={descricao.slice(0, 200)} />
      <input type="hidden" name="descricao" value={`Inconsistência: ${achado.descricao}`} />
      {lanc?.pessoa_id && <input type="hidden" name="pessoa_id" value={lanc.pessoa_id} />}
      {contrato && <input type="hidden" name="contrato_id" value={contrato} />}
      {lanc?.imovel_id && <input type="hidden" name="imovel_id" value={lanc.imovel_id} />}
      <p className="text-sm text-texto-2">{achado.descricao}</p>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Campo rotulo="Lançamento">
          <Selecao name="tipo_lancamento" defaultValue={tipo}>
            <option value="pagar">A pagar (devolver)</option>
            <option value="receber">A receber (cobrar a diferença)</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Valor (R$)">
          <Entrada name="valor" required inputMode="decimal" defaultValue={String(achado.valor ?? "").replace(".", ",")} />
        </Campo>
        <Campo rotulo="Vencimento">
          <Entrada name="vencimento" type="date" required defaultValue={vencimento} />
        </Campo>
        <Campo rotulo="Categoria (opcional)">
          <Entrada name="categoria" maxLength={80} placeholder="Ex.: Devoluções" />
        </Campo>
      </div>
      <Campo rotulo="Descrição">
        <Entrada name="descricao_lancamento" required maxLength={200} defaultValue={descricao.slice(0, 200)} />
      </Campo>
    </JanelaCadastro>
  );
}
