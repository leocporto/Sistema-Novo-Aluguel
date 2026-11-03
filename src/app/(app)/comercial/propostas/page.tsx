import type { Metadata } from "next";
import Link from "next/link";
import { BadgeDollarSign, CircleCheck, Handshake, Wallet } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Celula, Indicador, LinhaVazia, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_STATUS_PROPOSTA, ROTULO_TIPO_PROPOSTA } from "@/lib/tipos";
import { aceitarProposta, criarProposta, excluirProposta, recusarProposta } from "../actions";
import { AbasComercial, CamposProposta } from "../campos";
import { carregarOpcoes } from "../dados";

export const metadata: Metadata = { title: "Propostas" };

type P = {
  id: string;
  tipo: "locacao" | "venda";
  valor: number;
  status: string;
  comissao_pct: number | null;
  fechada_em: string | null;
  created_at: string;
  observacoes: string | null;
  lead: { id: string; nome: string } | null;
  imovel: { id: string; codigo: string } | null;
  corretor: { nome: string } | null;
};

const COR = { em_negociacao: "amarelo", aceita: "verde", recusada: "vermelho", cancelada: "cinza" } as const;

export default async function PropostasPage({ searchParams }: PageProps<"/comercial/propostas">) {
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const mes = hoje.slice(0, 7);
  const [{ data }, opcoes, { data: comissoes }] = await Promise.all([
    supabase
      .from("propostas")
      .select("id, tipo, valor, status, comissao_pct, fechada_em, created_at, observacoes, lead:leads(id, nome), imovel:imoveis(id, codigo), corretor:pessoas(nome)")
      .order("created_at", { ascending: false })
      .limit(300),
    carregarOpcoes(supabase),
    supabase.from("lancamentos").select("valor").eq("tipo", "pagar").eq("categoria", "Comissões").eq("status", "aberto"),
  ]);
  const props = (data ?? []) as unknown as P[];
  const ordem = (p: P) => (p.status === "em_negociacao" ? 0 : 1);
  props.sort((a, b) => ordem(a) - ordem(b));
  const negociando = props.filter((p) => p.status === "em_negociacao");
  const aceitasMes = props.filter((p) => p.status === "aceita" && p.fechada_em?.slice(0, 7) === mes);
  const aPagar = (comissoes ?? []).reduce((s, c) => s + Number(c.valor), 0);

  return (
    <>
      <Cabecalho
        titulo="Propostas"
        trilha="Comercial"
        descricao="Propostas de locação e venda. Ao aceitar, o imóvel muda de situação e a comissão do corretor vira conta a pagar."
        acoes={
          <JanelaCadastro
            rotuloBotao={<><Handshake className="size-4" /> Nova proposta</>}
            titulo="Nova proposta"
            acao={criarProposta}
            rotuloSalvar="Registrar"
            icone={<Handshake />}
            abertaInicial={sp.novo === "1"}
          >
            <CamposProposta
              imoveis={opcoes.imoveis}
              leads={opcoes.leads}
              corretores={opcoes.corretores}
              leadId={typeof sp.lead === "string" ? sp.lead : undefined}
              pessoal={pessoal}
            />
          </JanelaCadastro>
        }
      />
      <AbasComercial />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Em negociação" icone={<Handshake />} valor={<Contador valor={negociando.length} />} tom={negociando.length ? "alerta" : "neutro"} />
        <Indicador rotulo="Valor em negociação" icone={<BadgeDollarSign />} valor={<Contador valor={negociando.reduce((s, p) => s + Number(p.valor), 0)} formato="moeda" />} />
        <Indicador rotulo="Aceitas no mês" icone={<CircleCheck />} valor={<Contador valor={aceitasMes.length} />} tom="sucesso" />
        {!pessoal && (
          <Indicador rotulo="Comissões a pagar" icone={<Wallet />} valor={<Contador valor={aPagar} formato="moeda" />} href="/financeiro" tom={aPagar ? "alerta" : "neutro"} />
        )}
      </div>

      <Tabela colunas={["Data", "Cliente", "Imóvel", "Tipo", "Valor", ...(pessoal ? [] : ["Corretor"]), "Situação", ""]}>
        {props.length === 0 && <LinhaVazia colunas={pessoal ? 7 : 8}>Nenhuma proposta ainda.</LinhaVazia>}
        {props.map((p) => (
          <tr key={p.id}>
            <Celula>{formatarDataBR(p.created_at.slice(0, 10))}</Celula>
            <Celula>
              {p.lead ? (
                <Link href={`/comercial/leads/${p.lead.id}`} className="font-medium text-acento hover:underline">
                  {p.lead.nome}
                </Link>
              ) : (
                "—"
              )}
            </Celula>
            <Celula>
              {p.imovel ? (
                <Link href={`/imoveis/${p.imovel.id}`} className="hover:underline">
                  {p.imovel.codigo}
                </Link>
              ) : (
                "—"
              )}
            </Celula>
            <Celula>{ROTULO_TIPO_PROPOSTA[p.tipo]}</Celula>
            <Celula className="font-medium">
              {formatarReais(p.valor)}
              {p.tipo === "locacao" && <span className="text-xs text-mudo">/mês</span>}
            </Celula>
            {!pessoal && (
              <Celula>
                {p.corretor ? (
                  <>
                    {p.corretor.nome}
                    {p.comissao_pct ? (
                      <div className="text-xs text-mudo">
                        {Number(p.comissao_pct)}% = {formatarReais((Number(p.valor) * Number(p.comissao_pct)) / 100)}
                      </div>
                    ) : null}
                  </>
                ) : (
                  "—"
                )}
              </Celula>
            )}
            <Celula>
              <Selo cor={COR[p.status as keyof typeof COR] ?? "cinza"}>{ROTULO_STATUS_PROPOSTA[p.status]}</Selo>
              {p.fechada_em && <div className="mt-1 text-xs text-mudo">{formatarDataBR(p.fechada_em)}</div>}
            </Celula>
            <Celula>
              <div className="flex flex-wrap items-center justify-end gap-2">
                {p.status === "em_negociacao" && (
                  <>
                    <form action={aceitarProposta}>
                      <input type="hidden" name="id" value={p.id} />
                      <BotaoEnviar
                        confirmar={
                          p.tipo === "venda"
                            ? "Aceitar a proposta? O imóvel será marcado como vendido."
                            : "Aceitar a proposta? O imóvel fica reservado até você criar o contrato."
                        }
                      >
                        Aceitar
                      </BotaoEnviar>
                    </form>
                    <form action={recusarProposta}>
                      <input type="hidden" name="id" value={p.id} />
                      <BotaoEnviar variante="secundario" confirmar="Marcar a proposta como recusada?">
                        Recusar
                      </BotaoEnviar>
                    </form>
                  </>
                )}
                {p.status === "aceita" && p.tipo === "locacao" && p.imovel && (
                  <Link href={`/contratos/novo?imovel=${p.imovel.id}`} className={classeBotao("secundario", "sm")}>
                    Criar contrato
                  </Link>
                )}
                <BotaoExcluir
                  acao={excluirProposta}
                  id={p.id}
                  rotulo="Excluir proposta"
                  confirmar={
                    p.status === "aceita"
                      ? "Excluir esta proposta aceita? A comissão ainda não paga sai junto. A situação do imóvel não muda."
                      : "Excluir esta proposta?"
                  }
                />
              </div>
            </Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
