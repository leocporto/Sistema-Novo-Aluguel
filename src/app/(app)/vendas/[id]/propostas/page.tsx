import type { Metadata } from "next";
import { MessageCircle, Reply } from "lucide-react";
import type { ReactNode } from "react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_FORMA_PAGAMENTO, cadeiaPropostas } from "@/lib/dominio/vendas";
import { ROTULO_STATUS_PROPOSTA } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import { aceitarPropostaVenda, criarPropostaVenda, excluirPropostaVenda, recusarPropostaVenda } from "../../actions";
import { SELECT_VENDA, nomeComprador, telefoneComprador, type Venda } from "../../dados";

export const metadata: Metadata = { title: "Propostas da venda" };

type P = {
  id: string;
  proposta_pai_id: string | null;
  autor: string;
  valor: number;
  status: string;
  validade: string | null;
  condicoes: string | null;
  sinal_valor: number | null;
  forma_pagamento: string | null;
  aprovada_proprietario_em: string | null;
  created_at: string;
};

function CamposProposta({ vendaId, paiId, autor, valor }: { vendaId: string; paiId?: string; autor: string; valor?: number }): ReactNode {
  return (
    <>
      <input type="hidden" name="venda_id" value={vendaId} />
      {paiId && <input type="hidden" name="proposta_pai_id" value={paiId} />}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="De quem é">
          <Selecao name="autor" defaultValue={autor}>
            <option value="comprador">Comprador</option>
            <option value="proprietario">Proprietário (vendedor)</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Valor (R$)">
          <Entrada name="valor" inputMode="decimal" required defaultValue={valor ? String(valor) : ""} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Sinal (R$)">
          <Entrada name="sinal_valor" inputMode="decimal" />
        </Campo>
        <Campo rotulo="Pagamento">
          <Selecao name="forma_pagamento" defaultValue="">
            <option value="">—</option>
            {Object.entries(ROTULO_FORMA_PAGAMENTO).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Válida até">
          <Entrada type="date" name="validade" />
        </Campo>
      </div>
      <Campo rotulo="Condições">
        <AreaTexto name="condicoes" rows={3} placeholder="Ex.: 10% de sinal, saldo com financiamento em até 90 dias, imóvel desocupado na escritura…" />
      </Campo>
    </>
  );
}

export default async function PropostasVenda({ params }: PageProps<"/vendas/[id]/propostas">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [{ data: vd }, { data }] = await Promise.all([
    supabase.from("vendas").select(SELECT_VENDA).eq("id", id).single(),
    supabase.from("propostas").select("*").eq("venda_id", id).order("created_at"),
  ]);
  const v = vd as unknown as Venda;
  const lista = cadeiaPropostas(((data ?? []) as P[]).map((p) => ({ ...p, valor: Number(p.valor) })));
  const donos = (v.imovel?.imovel_proprietarios ?? []).map((p) => p.pessoa).filter((p): p is NonNullable<typeof p> => !!p);
  const tel = telefoneComprador(v);
  const encerrada = v.status === "concluida" || v.status === "cancelada";

  return (
    <Cartao
      titulo={`Propostas e contrapropostas (${lista.length})`}
      acoes={
        !encerrada && (
          <JanelaCadastro rotuloBotao="Nova proposta" tamanho="sm" titulo="Nova proposta" acao={criarPropostaVenda} rotuloSalvar="Registrar">
            <CamposProposta vendaId={id} autor="comprador" valor={Number(v.valor) || undefined} />
          </JanelaCadastro>
        )
      }
    >
      <ul className="space-y-3">
        {lista.map((p) => {
          const aberta = p.status === "em_negociacao" || p.status === "contraproposta";
          const msgDono = `Olá! Recebemos uma proposta de ${formatarReais(p.valor)} pelo imóvel ${v.imovel?.codigo ?? ""}${p.condicoes ? ` — ${p.condicoes}` : ""}. Posso seguir com o aceite?`;
          const msgComprador = `Olá ${nomeComprador(v).split(" ")[0]}! O proprietário respondeu: ${formatarReais(p.valor)}${p.condicoes ? ` — ${p.condicoes}` : ""}. O que acha?`;
          return (
            <li key={p.id} style={{ marginLeft: `${Math.min(p.nivel, 4) * 28}px` }} className="rounded-[14px] border border-borda bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    {p.nivel > 0 && <Reply className="size-4 rotate-180 text-mudo" />}
                    <span className="text-[17px] font-semibold tabular-nums text-texto">{formatarReais(p.valor)}</span>
                    <Selo cor={p.status === "aceita" ? "verde" : p.status === "recusada" ? "vermelho" : p.status === "contraproposta" ? "azul" : "amarelo"}>{ROTULO_STATUS_PROPOSTA[p.status] ?? p.status}</Selo>
                  </div>
                  <div className="mt-1 text-xs text-mudo">
                    {p.nivel > 0 ? "Contraproposta" : "Proposta"} do {p.autor === "proprietario" ? "proprietário" : "comprador"} · {formatarDataBR(p.created_at.slice(0, 10))}
                    {p.validade ? ` · válida até ${formatarDataBR(p.validade)}` : ""}
                    {p.sinal_valor ? ` · sinal ${formatarReais(p.sinal_valor)}` : ""}
                    {p.forma_pagamento ? ` · ${ROTULO_FORMA_PAGAMENTO[p.forma_pagamento] ?? p.forma_pagamento}` : ""}
                    {p.aprovada_proprietario_em ? ` · aprovada pelo proprietário em ${formatarDataBR(p.aprovada_proprietario_em)}` : ""}
                  </div>
                  {p.condicoes && <p className="mt-2 whitespace-pre-line text-sm text-texto-2">{p.condicoes}</p>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {aberta && p.autor === "comprador" && donos[0]?.telefone && (
                    <a href={linkWhatsapp(donos[0].telefone, msgDono)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                      <MessageCircle className="size-3.5" /> Pedir aprovação
                    </a>
                  )}
                  {aberta && p.autor === "proprietario" && tel && (
                    <a href={linkWhatsapp(tel, msgComprador)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                      <MessageCircle className="size-3.5" /> Enviar ao comprador
                    </a>
                  )}
                  {aberta && !encerrada && (
                    <>
                      <JanelaCadastro rotuloBotao={<><Reply className="size-3.5" /> Contraproposta</>} variante="secundario" tamanho="sm" titulo="Contraproposta" acao={criarPropostaVenda} rotuloSalvar="Registrar">
                        <CamposProposta vendaId={id} paiId={p.id} autor={p.autor === "comprador" ? "proprietario" : "comprador"} valor={p.valor} />
                      </JanelaCadastro>
                      <BotaoAcao acao={aceitarPropostaVenda} id={p.id} variante="primario" tamanho="sm" confirmar="Aceitar esta proposta? O valor da venda passa a ser este e as outras propostas abertas ficam recusadas.">
                        Aceitar
                      </BotaoAcao>
                      <BotaoAcao acao={recusarPropostaVenda} id={p.id} tamanho="sm" confirmar="Marcar como recusada?">
                        Recusar
                      </BotaoAcao>
                    </>
                  )}
                  <BotaoExcluir acao={excluirPropostaVenda} id={p.id} rotulo="Excluir proposta" confirmar="Excluir esta proposta?" />
                </div>
              </div>
            </li>
          );
        })}
        {lista.length === 0 && <li className="text-sm text-mudo">Nenhuma proposta registrada nesta venda.</li>}
      </ul>
    </Cartao>
  );
}
