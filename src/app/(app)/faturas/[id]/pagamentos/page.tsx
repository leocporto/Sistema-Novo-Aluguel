import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Aviso, Cartao, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { FORMAS_RECEBIMENTO, ROTULO_ORIGEM } from "@/lib/dominio/cobrancas";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { estornarRecebimento } from "../../actions";
import { carregarFicha } from "../../ficha";
import { BotaoDesfazer } from "../../recebimento";

export const metadata: Metadata = { title: "Recebimentos da cobrança" };

export default async function PagamentosFatura({ params }: PageProps<"/faturas/[id]/pagamentos">) {
  const { id } = await params;
  const ficha = await carregarFicha(id);
  if (!ficha) notFound();
  const { supabase, organizacao } = await obterContexto();
  const { fatura, pagamentos, sit, locatario, acordo, travadoPeloAcordo } = ficha;
  const contasIds = [...new Set(pagamentos.map((p) => p.conta_id).filter(Boolean))] as string[];
  const [{ data: contas }, links] = await Promise.all([
    contasIds.length ? supabase.from("contas_financeiras").select("id, nome").in("id", contasIds) : Promise.resolve({ data: [] as { id: string; nome: string }[] }),
    Promise.all(
      pagamentos.map(async (p) => (p.comprovante_path ? ((await supabase.storage.from("comprovantes").createSignedUrl(p.comprovante_path, 300)).data?.signedUrl ?? null) : null)),
    ),
  ]);
  const nomeConta = new Map((contas ?? []).map((c) => [c.id, c.nome]));
  const ultimoId = pagamentos.at(-1)?.id;
  const antigo = fatura.status === "paga" && pagamentos.length === 0;

  return (
    <div className="space-y-6">
      {sit?.parcial && (
        <Aviso tipo="alerta">
          Pagamento parcial: já entraram {formatarReais(sit.recebido / 100)} e falta {formatarReais(sit.saldo / 100)} do aluguel. A fatura só é quitada (e o
          {organizacao.modo === "pessoal" ? " lançamento no Financeiro" : " repasse ao proprietário"} só é gerado) quando o saldo zera.
        </Aviso>
      )}
      <Cartao titulo="Recebimentos desta cobrança">
        <Tabela colunas={["Data", "Forma", "Origem", "Recebido", "Aluguel", "Multa", "Juros", "Desconto", "Conta", ""]}>
          {pagamentos.length === 0 && !antigo && <LinhaVazia colunas={10}>Nenhum recebimento ainda.</LinhaVazia>}
          {antigo && (
            <tr>
              <Celula>{formatarDataBR(fatura.pago_em)}</Celula>
              <Celula>{FORMAS_RECEBIMENTO[fatura.forma_pagamento ?? ""] ?? fatura.forma_pagamento ?? "—"}</Celula>
              <Celula>
                <Selo cor="cinza">baixa anterior</Selo>
              </Celula>
              <Celula className="font-medium tabular-nums">{formatarReais(fatura.valor_pago)}</Celula>
              <Celula className="text-mudo" />
              <Celula className="text-mudo" />
              <Celula className="text-mudo" />
              <Celula className="text-mudo" />
              <Celula className="text-mudo">—</Celula>
              <Celula>
                {ficha.desfazer && <BotaoDesfazer faturaId={fatura.id} titulo={locatario?.nome ?? "Cobrança"} {...ficha.desfazer} pessoal={organizacao.modo === "pessoal"} />}
              </Celula>
            </tr>
          )}
          {pagamentos.map((p, i) => (
            <tr key={p.id}>
              <Celula>{formatarDataBR(p.pago_em)}</Celula>
              <Celula>{FORMAS_RECEBIMENTO[p.forma ?? ""] ?? "—"}</Celula>
              <Celula>
                <Selo cor={p.origem === "acordo" ? "azul" : p.origem === "manual" ? "cinza" : "verde"}>{ROTULO_ORIGEM[p.origem] ?? p.origem}</Selo>
                {p.observacao && <span className="mt-1 block max-w-56 text-xs text-mudo">{p.observacao}</span>}
              </Celula>
              <Celula className="font-medium tabular-nums">{formatarReais(p.valor)}</Celula>
              <Celula className="tabular-nums">{formatarReais(p.principal)}</Celula>
              <Celula className="tabular-nums text-ruim">{Number(p.multa) ? formatarReais(p.multa) : "—"}</Celula>
              <Celula className="tabular-nums text-ruim">{Number(p.juros) ? formatarReais(p.juros) : "—"}</Celula>
              <Celula className="tabular-nums text-ok">{Number(p.desconto) ? formatarReais(p.desconto) : "—"}</Celula>
              <Celula>
                {p.conta_id ? (nomeConta.get(p.conta_id) ?? "—") : "—"}
                {links[i] && (
                  <a href={links[i]!} target="_blank" rel="noreferrer" className="block text-xs text-acento hover:underline">
                    comprovante
                  </a>
                )}
              </Celula>
              <Celula>
                {p.origem === "acordo" || travadoPeloAcordo ? (
                  fatura.acordo_id && (
                    <Link
                      href={`/cobrancas/acordos/${fatura.acordo_id}`}
                      className="text-xs text-acento hover:underline"
                      title={p.origem === "acordo" ? "Desfaça pela parcela, na ficha do acordo" : "Recebimento de antes do acordo: para desfazer, desfaça as parcelas pagas e quebre ou exclua o acordo"}
                    >
                      {p.origem === "acordo" ? "pelo acordo" : `travado pelo acordo nº ${acordo?.numero ?? ""}`}
                    </Link>
                  )
                ) : (
                  <BotaoExcluir
                    acao={estornarRecebimento}
                    id={p.id}
                    rotulo="Desfazer este recebimento"
                    confirmar={`Desfazer o recebimento de ${formatarReais(p.valor)} de ${formatarDataBR(p.pago_em)}?${
                      fatura.status === "paga" && p.id === ultimoId
                        ? " A cobrança volta para em aberto e o repasse/taxa (ou o lançamento no Financeiro) desta baixa é apagado."
                        : fatura.status === "paga"
                          ? " A cobrança volta para em aberto."
                          : " O valor volta a faltar no saldo."
                    }`}
                  />
                )}
              </Celula>
            </tr>
          ))}
        </Tabela>
        <p className="mt-3 text-xs text-mudo">
          Cada recebimento fica registrado com quem fez e quando (aba Contatos e histórico). Desfazer um recebimento não apaga o histórico.
          {travadoPeloAcordo &&
            " Esta cobrança está num acordo: o saldo dela foi renegociado, então os recebimentos de antes do acordo só podem ser desfeitos depois de desfazer as parcelas e quebrar ou excluir o acordo."}
        </p>
      </Cartao>
    </div>
  );
}
