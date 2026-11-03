import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Cabecalho, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { identificacaoImovel, ROTULO_SITUACAO_JURIDICO, type ImovelEndereco } from "@/lib/dominio/cobrancas";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { atualizarJuridico, excluirJuridico } from "../../actions";
import { JanelaContato, ListaContatos, ListaEventos, SELECT_CONTATO, type ContatoDb, type EventoDb } from "../../campos";

export const metadata: Metadata = { title: "Caso de cobrança jurídica" };

type Caso = {
  id: string;
  encaminhado_em: string;
  escritorio: string | null;
  responsavel: string | null;
  contato: string | null;
  numero_processo: string | null;
  situacao: string;
  valor_encaminhado: number;
  honorarios_pct: number | null;
  proxima_acao: string | null;
  observacoes: string | null;
  encerrado_em: string | null;
  contrato: { id: string; numero: number; imovel: ImovelEndereco | null } | null;
  pessoa: { id: string; nome: string; telefone: string | null; email: string | null } | null;
};

export default async function CasoJuridico({ params }: PageProps<"/cobrancas/juridico/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const { data } = await supabase
    .from("cobrancas_juridicas")
    .select("*, contrato:contratos(id, numero, imovel:imoveis(codigo, logradouro, numero, complemento, bairro, cidade, uf)), pessoa:pessoas(id, nome, telefone, email)")
    .eq("id", id)
    .maybeSingle();
  if (!data) notFound();
  const c = data as unknown as Caso;
  const [{ data: faturas }, { data: contatos }, { data: eventos }] = await Promise.all([
    supabase.from("faturas").select("id, numero, competencia, vencimento, valor_total, valor_abatido, status").eq("juridico_id", id).order("vencimento"),
    supabase.from("cobranca_contatos").select(SELECT_CONTATO).eq("juridico_id", id).order("data", { ascending: false }).limit(100),
    supabase.from("cobranca_eventos").select("id, tipo, descricao, valor, data, fatura_id").eq("juridico_id", id).order("data", { ascending: false }).limit(100),
  ]);

  return (
    <>
      <Cabecalho
        titulo={`Jurídico · ${c.pessoa?.nome ?? "Devedor"}`}
        trilha="Cobranças"
        descricao={
          c.contrato ? (
            <>
              {identificacaoImovel(c.contrato.imovel)} ·{" "}
              <Link href={`/contratos/${c.contrato.id}/cobrancas`} className="text-acento hover:underline">
                contrato #{c.contrato.numero}
              </Link>{" "}
              · encaminhado em {formatarDataBR(c.encaminhado_em)} · {formatarReais(c.valor_encaminhado)}
            </>
          ) : undefined
        }
        acoes={
          <>
            <Selo cor={c.situacao === "pago" ? "verde" : c.situacao === "encerrado" ? "cinza" : "amarelo"}>{ROTULO_SITUACAO_JURIDICO[c.situacao] ?? c.situacao}</Selo>
            <BotaoExcluir acao={excluirJuridico} id={id} variante="botao" rotulo="Excluir" confirmar="Excluir este caso? As cobranças voltam para a régua de avisos." depois="/cobrancas/juridico" />
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <Cartao titulo="Acompanhamento">
            <Formulario acao={atualizarJuridico} automatico className="space-y-4">
              <input type="hidden" name="id" value={id} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Situação">
                  <Selecao name="situacao" defaultValue={c.situacao}>
                    {Object.entries(ROTULO_SITUACAO_JURIDICO).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Próxima ação (data)">
                  <Entrada type="date" name="proxima_acao" defaultValue={c.proxima_acao ?? ""} />
                </Campo>
                <Campo rotulo="Escritório / advogado">
                  <Entrada name="escritorio" defaultValue={c.escritorio ?? ""} />
                </Campo>
                <Campo rotulo="Responsável">
                  <Entrada name="responsavel" defaultValue={c.responsavel ?? ""} />
                </Campo>
                <Campo rotulo="Contato do escritório">
                  <Entrada name="contato" defaultValue={c.contato ?? ""} />
                </Campo>
                <Campo rotulo="Nº do processo">
                  <Entrada name="numero_processo" defaultValue={c.numero_processo ?? ""} />
                </Campo>
                <Campo rotulo="Honorários (%)">
                  <Entrada name="honorarios_pct" inputMode="decimal" defaultValue={c.honorarios_pct ?? ""} />
                </Campo>
                <Campo rotulo="Encaminhado em">
                  <Entrada type="date" name="encaminhado_em" required defaultValue={c.encaminhado_em} />
                </Campo>
                <Campo rotulo="Encerrado em">
                  <Entrada type="date" name="encerrado_em" defaultValue={c.encerrado_em ?? ""} />
                </Campo>
              </div>
              <Campo rotulo="Observações">
                <AreaTexto name="observacoes" rows={3} defaultValue={c.observacoes ?? ""} />
              </Campo>
            </Formulario>
          </Cartao>
          <Cartao titulo="Cobranças no jurídico">
            <Tabela colunas={["Cobrança", "Vencimento", "Valor", "Saldo", "Situação"]}>
              {(faturas ?? []).length === 0 && <LinhaVazia colunas={5}>Nenhuma cobrança ligada.</LinhaVazia>}
              {(faturas ?? []).map((f) => (
                <tr key={f.id}>
                  <Celula>
                    <Link href={`/faturas/${f.id}`} className="text-acento hover:underline">
                      #{f.numero} · {formatarCompetencia(f.competencia)}
                    </Link>
                  </Celula>
                  <Celula>{formatarDataBR(f.vencimento)}</Celula>
                  <Celula className="tabular-nums">{formatarReais(f.valor_total)}</Celula>
                  <Celula className="tabular-nums">{f.status === "paga" ? "—" : formatarReais(Number(f.valor_total) - Number(f.valor_abatido))}</Celula>
                  <Celula>
                    <Selo cor={f.status === "paga" ? "verde" : f.status === "renegociada" ? "azul" : "vermelho"}>{f.status === "renegociada" ? "em acordo" : f.status}</Selo>
                  </Celula>
                </tr>
              ))}
            </Tabela>
          </Cartao>
        </div>
        <div className="space-y-6">
          <Cartao titulo="Contatos" acoes={c.contrato && <JanelaContato contratoId={c.contrato.id} juridicoId={id} hoje={hoje} />}>
            <ListaContatos contatos={(contatos ?? []) as unknown as ContatoDb[]} hoje={hoje} />
          </Cartao>
          <Cartao titulo="Histórico (não se apaga)">
            <ListaEventos eventos={(eventos ?? []) as EventoDb[]} />
          </Cartao>
        </div>
      </div>
    </>
  );
}
