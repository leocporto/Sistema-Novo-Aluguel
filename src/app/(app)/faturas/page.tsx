import type { Metadata } from "next";
import Link from "next/link";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { fimDoMes, formatarCompetencia, formatarDataBR, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import type { Fatura } from "@/lib/tipos";
import { gerarFaturasDoMes } from "./actions";

export const metadata: Metadata = { title: "Cobranças" };

type Linha = Fatura & {
  contrato: {
    numero: number;
    imovel: { codigo: string };
    contrato_partes: { papel: string; pessoa: { nome: string } }[];
  };
};

export default async function FaturasPage({ searchParams }: PageProps<"/faturas">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = typeof sp.mes === "string" && sp.mes ? sp.mes : hoje.slice(0, 7);
  const situacao = typeof sp.situacao === "string" ? sp.situacao : "";
  const { supabase } = await obterContexto();

  let q = supabase
    .from("faturas")
    .select("*, contrato:contratos(numero, imovel:imoveis(codigo), contrato_partes(papel, pessoa:pessoas(nome)))")
    .order("vencimento")
    .limit(500);
  if (situacao === "atraso") q = q.eq("status", "aberta").lt("vencimento", hoje);
  else {
    q = q.gte("vencimento", `${mes}-01`).lte("vencimento", fimDoMes(`${mes}-01`));
    if (situacao) q = q.eq("status", situacao);
  }
  const { data } = await q;
  const faturas = (data ?? []) as unknown as Linha[];

  const soma = (f: (x: Linha) => boolean) => faturas.filter(f).reduce((s, x) => s + Number(x.valor_pago ?? x.valor_total), 0);
  const aReceber = soma((f) => f.status === "aberta" && f.vencimento >= hoje);
  const atraso = soma((f) => f.status === "aberta" && f.vencimento < hoje);
  const recebido = soma((f) => f.status === "paga");

  return (
    <>
      <Cabecalho
        titulo="Cobranças"
        descricao="Faturas mensais dos locatários: geração, baixa e acompanhamento da inadimplência."
        acoes={
          <Formulario acao={gerarFaturasDoMes} className="flex flex-wrap items-center gap-2">
            <Entrada type="month" name="competencia" defaultValue={inicioDoMes(hoje).slice(0, 7)} className="w-40" />
            <BotaoEnviar>Gerar faturas do mês</BotaoEnviar>
          </Formulario>
        }
      />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="A receber" valor={formatarReais(aReceber)} />
        <Indicador rotulo="Em atraso" valor={formatarReais(atraso)} tom={atraso > 0 ? "perigo" : "neutro"} />
        <Indicador rotulo="Recebido" valor={formatarReais(recebido)} tom="sucesso" />
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <Entrada type="month" name="mes" defaultValue={mes} className="w-44" />
        <Selecao name="situacao" defaultValue={situacao} className="max-w-48">
          <option value="">Todas</option>
          <option value="aberta">Em aberto</option>
          <option value="paga">Pagas</option>
          <option value="cancelada">Canceladas</option>
          <option value="atraso">Todas em atraso</option>
        </Selecao>
        <button className={classeBotao("secundario")}>Filtrar</button>
      </form>
      <Tabela colunas={["Nº", "Contrato", "Locatário", "Competência", "Vencimento", "Valor", "Situação"]}>
        {faturas.length === 0 && <LinhaVazia colunas={7}>Nenhuma fatura no período.</LinhaVazia>}
        {faturas.map((f) => {
          const atrasada = f.status === "aberta" && f.vencimento < hoje;
          return (
            <tr key={f.id} className="hover:bg-slate-50">
              <Celula>
                <Link href={`/faturas/${f.id}`} className="font-medium text-emerald-700 hover:underline">
                  #{f.numero}
                </Link>
              </Celula>
              <Celula>
                #{f.contrato.numero} · {f.contrato.imovel.codigo}
              </Celula>
              <Celula>
                {f.contrato.contrato_partes.filter((p) => p.papel === "locatario").map((p) => p.pessoa.nome).join(", ")}
              </Celula>
              <Celula>{formatarCompetencia(f.competencia)}</Celula>
              <Celula>{formatarDataBR(f.vencimento)}</Celula>
              <Celula>{formatarReais(f.valor_pago ?? f.valor_total)}</Celula>
              <Celula>
                <Selo cor={atrasada ? "vermelho" : f.status === "paga" ? "verde" : f.status === "aberta" ? "amarelo" : "cinza"}>
                  {atrasada ? "em atraso" : f.status}
                </Selo>
              </Celula>
            </tr>
          );
        })}
      </Tabela>
    </>
  );
}
