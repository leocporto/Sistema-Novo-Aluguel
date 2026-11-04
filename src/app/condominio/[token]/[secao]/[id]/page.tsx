import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Copiar } from "@/components/copiar";
import { BotaoImprimir } from "@/components/formulario";
import { Aviso, Cartao, Celula, Definicao, Selo, Tabela, classeBotao } from "@/components/ui";
import { COR_STATUS_COTA, STATUS_COTA, totalHoje, txidCota } from "@/lib/dominio/condominios";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos } from "@/lib/dominio/dinheiro";
import { gerarPixCopiaCola } from "@/lib/dominio/pix";
import type { CotaPortal } from "../../secoes";
import { dadosCondominio, ehErro, infoCondominio } from "../../sessao";

type Cota = CotaPortal & {
  condominio: string;
  cnpj: string | null;
  pix: { chave: string | null; nome: string; cidade: string | null };
  banco: { banco: string | null; agencia: string | null; conta: string | null };
};

/** 2ª via da cota no portal: itens, situação de hoje (multa e juros) e Pix copia e cola gerado aqui (sem depender de link público). */
export default async function CotaPortalPage({ params }: PageProps<"/condominio/[token]/[secao]/[id]">) {
  const { token, secao, id } = await params;
  if (secao !== "cotas") notFound();
  const info = await infoCondominio(token);
  if (!info?.entrou) return null;
  const c = await dadosCondominio<Cota>(token, "cota", { id });
  if (!c || ehErro(c)) notFound();
  const total = totalHoje(c);
  let pix: string | null = null;
  if (c.status === "aberta" && c.pix.chave && total > 0) {
    try {
      pix = gerarPixCopiaCola({ chave: c.pix.chave, nome: c.pix.nome, cidade: c.pix.cidade, valor: paraCentavos(total), txid: txidCota(c.numero), descricao: `Cota ${formatarCompetencia(c.competencia)} ${c.unidade}` });
    } catch {
      pix = null;
    }
  }
  return (
    <div className="space-y-4">
      <div className="nao-imprimir flex flex-wrap justify-between gap-2">
        <Link href={`/condominio/${token}/cotas`} className={classeBotao("fantasma")}>
          <ArrowLeft className="size-4" /> Minhas cotas
        </Link>
        <BotaoImprimir />
      </div>
      <Cartao titulo={`${c.condominio} — cota nº ${c.numero}`}>
        <Definicao
          itens={[
            ["Unidade", c.unidade],
            ["Competência", formatarCompetencia(c.competencia)],
            ["Vencimento", formatarDataBR(c.vencimento)],
            ["Situação", <Selo key="s" cor={COR_STATUS_COTA[c.status] ?? "cinza"}>{STATUS_COTA[c.status as keyof typeof STATUS_COTA] ?? c.status}</Selo>],
            ["CNPJ do condomínio", c.cnpj ?? "—"],
          ]}
        />
        <div className="mt-4">
          <Tabela colunas={["Item", "Valor"]}>
            {c.itens.map((i, k) => (
              <tr key={k}>
                <Celula>{i.descricao}</Celula>
                <Celula className="tabular-nums">{formatarReais(i.valor)}</Celula>
              </tr>
            ))}
            <tr>
              <Celula className="font-semibold">Total</Celula>
              <Celula className="font-semibold tabular-nums">{formatarReais(c.valor)}</Celula>
            </tr>
          </Tabela>
        </div>
        {c.pagamentos.length > 0 && (
          <p className="mt-3 text-sm text-texto-2">Pagamentos: {c.pagamentos.map((p) => `${formatarDataBR(p.data)} ${formatarReais(p.valor)}`).join(" · ")}</p>
        )}
        {c.status === "aberta" && (
          <div className="mt-3 space-y-1 text-sm text-texto-2">
            {Number(c.multa) + Number(c.juros) > 0 && (
              <p>
                Em atraso há {c.dias} dia(s): multa {formatarReais(c.multa)} e juros {formatarReais(c.juros)}.
              </p>
            )}
            <p className="text-[18px] font-semibold text-texto">Para pagar hoje: {formatarReais(total)}</p>
          </div>
        )}
      </Cartao>
      {c.status === "aberta" &&
        (pix ? (
          <Cartao titulo="Pague com Pix copia e cola">
            <p className="mb-2 break-all rounded-[12px] border border-borda bg-elev p-3 font-mono text-xs text-texto">{pix}</p>
            <div className="nao-imprimir">
              <Copiar texto={pix} rotulo="Copiar código Pix" />
            </div>
            <p className="mt-2 text-xs text-mudo">Abra o app do seu banco, escolha Pix › Copia e cola e cole o código. O valor já inclui multa e juros de hoje.</p>
          </Cartao>
        ) : (
          <Aviso>
            O condomínio ainda não cadastrou a chave Pix. Fale com a administradora para receber a forma de pagamento.
            {c.banco.banco ? ` Depósito: ${c.banco.banco} ag. ${c.banco.agencia ?? "—"} c/c ${c.banco.conta ?? "—"}.` : ""}
          </Aviso>
        ))}
    </div>
  );
}
