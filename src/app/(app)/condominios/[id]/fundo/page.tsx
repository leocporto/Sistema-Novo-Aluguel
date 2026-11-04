import type { Metadata } from "next";
import { ArrowDownCircle, ArrowUpCircle, PiggyBank } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Cartao, Celula, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR, formatarDataLocal, hojeISO, somarMeses } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { todas } from "../../../financeiro/dados";
import { criarLancamento } from "../../actions";
import { contasDo, opcoesPessoas, saldosDo } from "../../dados";
import { CamposLancamento } from "../lancamento-campos";

export const metadata: Metadata = { title: "Fundo de reserva" };

type Mov = { id: string; tipo: string; descricao: string; categoria: string; valor: number; pago_em: string; conta_id: string; conta_destino_id: string | null; aprovacao_texto: string | null; aprovado_em: string | null; aprovacao_assembleia: { titulo: string } | null };

/**
 * Fundo de reserva (e outros fundos): saldo, entradas (a % de cada cota, que o
 * banco manda sozinha para a conta do fundo) e saídas — só com aprovação
 * registrada, por administrador ou gestor (o banco recusa sem isso).
 */
export default async function FundoPage({ params }: PageProps<"/condominios/[id]/fundo">) {
  const { id } = await params;
  const { supabase, papel } = await obterContexto();
  const hoje = hojeISO();
  const desde = somarMeses(`${hoje.slice(0, 7)}-01`, -11);
  const [contas, saldos, pessoas, { data: assembleias }, { data: eventos }] = await Promise.all([
    contasDo(supabase, id),
    saldosDo(supabase, id),
    opcoesPessoas(supabase),
    supabase.from("cond_assembleias").select("id, titulo, data").eq("condominio_id", id).in("status", ["em_andamento", "encerrada"]).order("data", { ascending: false }).limit(30),
    supabase.from("cond_eventos").select("id, descricao, data").eq("condominio_id", id).eq("tipo", "fundo_saida").order("data", { ascending: false }).limit(20),
  ]);
  const fundos = contas.filter((c) => c.tipo !== "corrente");
  const ids = fundos.map((c) => c.id);
  const movs = ids.length
    ? await todas<Mov>(() =>
        supabase
          .from("cond_lancamentos")
          .select("id, tipo, descricao, categoria, valor, pago_em, conta_id, conta_destino_id, aprovacao_texto, aprovado_em, aprovacao_assembleia:cond_assembleias(titulo)")
          .eq("condominio_id", id)
          .eq("status", "pago")
          .gte("pago_em", desde)
          .or(`conta_id.in.(${ids.join(",")}),conta_destino_id.in.(${ids.join(",")})`)
          .order("id"),
      )
    : [];
  const entra = (m: Mov) => (m.tipo === "receita" && ids.includes(m.conta_id)) || (m.tipo === "transferencia" && ids.includes(m.conta_destino_id ?? ""));
  const saldo = saldos.filter((s) => s.tipo !== "corrente").reduce((a, s) => a + s.saldo, 0);
  const entradas = paraReais(movs.filter(entra).reduce((a, m) => a + paraCentavos(m.valor), 0));
  const saidas = paraReais(movs.filter((m) => !entra(m)).reduce((a, m) => a + paraCentavos(m.valor), 0));
  const reserva = fundos.find((c) => c.tipo === "reserva");
  const opcoesAss = (assembleias ?? []).map((a) => ({ id: a.id as string, nome: `${a.titulo as string} (${formatarDataBR(diaLocal(String(a.data)))})` }));
  const nome = new Map(contas.map((c) => [c.id, c.nome]));
  const ordenados = [...movs].sort((a, b) => b.pago_em.localeCompare(a.pago_em));
  const podeSair = papel === "admin" || papel === "gestor";

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <JanelaCadastro
          rotuloBotao={<><ArrowDownCircle className="size-4" /> Guardar no fundo</>}
          variante="secundario"
          titulo="Transferir da conta corrente para o fundo"
          acao={criarLancamento}
          icone={<PiggyBank />}
          larguraMax="max-w-2xl"
          rotuloSalvar="Transferir"
        >
          <CamposLancamento condominioId={id} contas={contas} fornecedores={pessoas} assembleias={opcoesAss} hoje={hoje} tipoPadrao="transferencia" />
        </JanelaCadastro>
        {podeSair && reserva && (
          <JanelaCadastro rotuloBotao={<><ArrowUpCircle className="size-4" /> Saída do fundo</>} titulo="Saída do fundo de reserva (com aprovação)" acao={criarLancamento} icone={<ArrowUpCircle />} larguraMax="max-w-2xl" rotuloSalvar="Registrar saída">
            <CamposLancamento condominioId={id} contas={contas} fornecedores={pessoas} assembleias={opcoesAss} hoje={hoje} contaPadrao={reserva.id} fundo />
          </JanelaCadastro>
        )}
      </div>
      {!podeSair && <Aviso>Saídas do fundo de reserva são registradas por administrador ou gestor, sempre com a aprovação (assembleia ou quem aprovou).</Aviso>}

      <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Saldo dos fundos" icone={<PiggyBank />} valor={<Contador valor={saldo} formato="moeda" />} detalhe={fundos.map((f) => `${f.nome}: ${formatarReais(saldos.find((s) => s.id === f.id)?.saldo ?? 0)}`).join(" · ")} />
        <Indicador rotulo="Entradas (12 meses)" icone={<ArrowDownCircle />} tom="sucesso" valor={<Contador valor={entradas} formato="moeda" />} detalhe="parte das cotas e transferências" />
        <Indicador rotulo="Saídas (12 meses)" icone={<ArrowUpCircle />} tom={saidas ? "alerta" : "neutro"} valor={<Contador valor={saidas} formato="moeda" />} detalhe="sempre com aprovação registrada" />
      </div>

      <Tabela colunas={["Data", "Movimento", "Conta", "Aprovação", "Valor"]}>
        {ordenados.map((m) => (
          <tr key={m.id}>
            <Celula className="whitespace-nowrap text-sm text-texto-2">{formatarDataBR(m.pago_em)}</Celula>
            <Celula>
              {m.descricao}
              <span className="block text-xs text-mudo">{m.categoria}</span>
            </Celula>
            <Celula className="text-sm text-texto-2">
              {nome.get(m.conta_id)}
              {m.conta_destino_id ? ` → ${nome.get(m.conta_destino_id)}` : ""}
            </Celula>
            <Celula className="text-sm text-texto-2">
              {entra(m) ? "—" : (m.aprovacao_assembleia?.titulo ?? m.aprovacao_texto ?? "—")}
              {!entra(m) && m.aprovado_em && <span className="block text-xs text-mudo">registrada em {formatarDataLocal(m.aprovado_em)}</span>}
            </Celula>
            <Celula className={`whitespace-nowrap tabular-nums font-medium ${entra(m) ? "text-ok" : "text-ruim"}`}>
              {entra(m) ? "+ " : "− "}
              {formatarReais(m.valor)}
            </Celula>
          </tr>
        ))}
        {ordenados.length === 0 && <LinhaVazia colunas={5}>Nenhum movimento nos fundos nos últimos 12 meses.</LinhaVazia>}
      </Tabela>

      {(eventos ?? []).length > 0 && (
        <Cartao titulo="Registro das saídas aprovadas">
          <ul className="space-y-1.5 text-sm text-texto-2">
            {(eventos ?? []).map((e) => (
              <li key={e.id as string}>
                <Selo cor="cinza">{formatarDataLocal(e.data as string)}</Selo> {e.descricao as string}
              </li>
            ))}
          </ul>
        </Cartao>
      )}
    </div>
  );
}
