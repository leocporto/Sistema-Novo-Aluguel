import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, ClipboardList, MessageCircle, Send } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, Campo, Cartao, Celula, Definicao, Entrada, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais, percentual } from "@/lib/dominio/dinheiro";
import { compararOrcamentos, mensagemAprovacao, mensagemPedidoOrcamento, podeDecidirChamado, rotuloResponsavel } from "@/lib/dominio/manutencao";
import { linkWhatsapp } from "@/lib/whatsapp";
import { atualizarOrcamento, escolherOrcamento, excluirOrcamento, registrarAprovacao, salvarNovoOrcamento } from "../../actions";
import { OpcoesPrestador } from "../../campos";
import { carregarChamado, enderecoImovel, prestadores, proprietariosDoImovel, urlBase, type Orcamento } from "../../dados";

export const metadata: Metadata = { title: "Orçamentos do chamado" };

const COR_ORC = { solicitado: "amarelo", recebido: "azul", escolhido: "verde", recusado: "cinza" } as const;
const ROTULO_ORC: Record<string, string> = { solicitado: "pedido", recebido: "recebido", escolhido: "escolhido", recusado: "recusado" };
const COR_APROVACAO = { nao_precisa: "cinza", pendente: "amarelo", aprovado: "verde", recusado: "vermelho" } as const;
const ROTULO_APROVACAO: Record<string, string> = { nao_precisa: "não pedida", pendente: "aguardando resposta", aprovado: "aprovado", recusado: "recusado" };

function CamposOrcamento({ lista, comValor }: { lista: Awaited<ReturnType<typeof prestadores>>; comValor: boolean }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Prestador">
          <Selecao name="prestador_id" defaultValue="">
            <OpcoesPrestador prestadores={lista} vazio="— digitar o nome ao lado —" />
          </Selecao>
        </Campo>
        <Campo rotulo="Ou o nome (sem cadastro)" dica="Ao escolher o orçamento, o prestador entra no cadastro.">
          <Entrada name="prestador_nome" />
        </Campo>
      </div>
      {comValor && (
        <div className="grid gap-4 sm:grid-cols-4">
          <Campo rotulo="Valor (R$)">
            <Entrada name="valor" inputMode="decimal" required />
          </Campo>
          <Campo rotulo="Prazo (dias)">
            <Entrada name="prazo_dias" inputMode="numeric" />
          </Campo>
          <Campo rotulo="Garantia (dias)">
            <Entrada name="garantia_dias" inputMode="numeric" placeholder="90" />
          </Campo>
          <Campo rotulo="Válido até">
            <Entrada type="date" name="validade" />
          </Campo>
        </div>
      )}
      <Campo rotulo={comValor ? "O que está incluso" : "Observação para o prestador"}>
        <AreaTexto name="descricao" rows={2} />
      </Campo>
    </>
  );
}

export default async function OrcamentosChamado({ params }: PageProps<"/manutencao/[id]/orcamentos">) {
  const { id } = await params;
  const { supabase, organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  // Escolher o orçamento, excluir e mandar/registrar a aprovação do proprietário são decisões (corretor não faz).
  const decide = podeDecidirChamado(papel);
  const c = await carregarChamado(supabase, id);
  if (!c) notFound();
  const [{ data }, lista, donos, base] = await Promise.all([
    supabase.from("chamado_orcamentos").select("*, prestador:pessoas(id, nome, telefone, especialidade)").eq("chamado_id", id).order("created_at"),
    prestadores(supabase),
    pessoal ? Promise.resolve([]) : proprietariosDoImovel(supabase, c.imovel_id),
    urlBase(),
  ]);
  const orcamentos = compararOrcamentos(((data ?? []) as unknown as Orcamento[]).map((o) => ({ ...o, valor: o.valor == null ? null : Number(o.valor) })));
  const endereco = enderecoImovel(c.imovel) || c.imovel?.codigo || "";
  const podeEscolher = ["aberto", "em_analise", "aguardando_aprovacao"].includes(c.status);
  const encerrado = ["concluido", "avaliado", "recusado", "cancelado"].includes(c.status);
  const linkAprovacao = `${base}/chamado/aprovar/${c.aprovacao_token}`;
  const valor = c.valor_aprovado == null ? 0 : Number(c.valor_aprovado);
  const parteDono = paraReais(percentual(paraCentavos(valor), Number(c.pct_proprietario)));
  const recusadoPeloDono = !pessoal && c.aprovacao_status === "recusado";

  return (
    <div className="space-y-6">
      <Cartao
        titulo={`Orçamentos (${orcamentos.length})`}
        acoes={
          !encerrado && (
            <div className="flex flex-wrap gap-2">
              <JanelaCadastro rotuloBotao={<><Send className="size-3.5" /> Pedir orçamento</>} tamanho="sm" variante="secundario" titulo="Pedir orçamento a um prestador" acao={salvarNovoOrcamento} icone={<Send />} rotuloSalvar="Registrar pedido">
                <input type="hidden" name="chamado_id" value={id} />
                <CamposOrcamento lista={lista} comValor={false} />
                <p className="text-xs text-mudo">Depois de registrar, use o botão de WhatsApp da linha para mandar o pedido com os detalhes do chamado.</p>
              </JanelaCadastro>
              <JanelaCadastro rotuloBotao={<><ClipboardList className="size-3.5" /> Registrar orçamento</>} tamanho="sm" titulo="Registrar orçamento recebido" acao={salvarNovoOrcamento} icone={<ClipboardList />} rotuloSalvar="Registrar" larguraMax="max-w-2xl">
                <input type="hidden" name="chamado_id" value={id} />
                <CamposOrcamento lista={lista} comValor />
              </JanelaCadastro>
            </div>
          )
        }
      >
        <p className="mb-4 text-sm text-texto-2">
          Peça a vários prestadores e compare valor, prazo e garantia. Ao <b>escolher</b>, o prestador e o valor vão para o chamado
          {pessoal ? " e o serviço já fica aprovado." : "; se o proprietário paga alguma parte, ele precisa aprovar (link abaixo)."}
          {!decide && " Quem escolhe o orçamento é um administrador, gestor ou o financeiro."}
        </p>
        <Tabela colunas={["Prestador", "Valor", "Prazo", "Garantia", "Validade", "Situação", ""]}>
          {orcamentos.map((o) => {
            const nome = o.prestador?.nome ?? o.prestador_nome ?? "—";
            const tel = o.prestador?.telefone;
            return (
              <tr key={o.id}>
                <Celula>
                  <span className="font-medium text-texto">{nome}</span>
                  {o.prestador?.especialidade && <span className="block text-xs text-mudo">{o.prestador.especialidade}</span>}
                  {o.descricao && <span className="block max-w-80 truncate text-xs text-mudo" title={o.descricao}>{o.descricao}</span>}
                </Celula>
                <Celula className="tabular-nums">
                  {o.valor != null ? <b>{formatarReais(o.valor)}</b> : <span className="text-mudo">aguardando</span>}
                  {o.diferencaMenor ? <span className="block text-xs text-mudo">+{formatarReais(o.diferencaMenor)} que o menor</span> : null}
                  {o.menorValor && <span className="mt-1 block"><Selo cor="verde">mais barato</Selo></span>}
                </Celula>
                <Celula>
                  {o.prazo_dias != null ? `${o.prazo_dias} dia(s)` : "—"}
                  {o.menorPrazo && <span className="mt-1 block"><Selo cor="azul">mais rápido</Selo></span>}
                </Celula>
                <Celula>
                  {o.garantia_dias != null ? `${o.garantia_dias} dias` : "—"}
                  {o.maiorGarantia && <span className="mt-1 block"><Selo cor="azul">maior garantia</Selo></span>}
                </Celula>
                <Celula className="text-sm text-texto-2">{formatarDataBR(o.validade)}</Celula>
                <Celula>
                  <Selo cor={COR_ORC[o.status as keyof typeof COR_ORC] ?? "cinza"}>{ROTULO_ORC[o.status] ?? o.status}</Selo>
                  {recusadoPeloDono && o.id === c.orcamento_id && <span className="mt-1 block text-xs text-ruim">recusado pelo proprietário</span>}
                </Celula>
                <Celula>
                  <div className="flex items-center justify-end gap-2">
                    {tel && (
                      <a
                        href={linkWhatsapp(tel, mensagemPedidoOrcamento({ prestador: nome, numero: c.numero, categoria: c.categoria, titulo: c.titulo, descricao: c.descricao, endereco, urgencia: c.urgencia }))}
                        target="_blank"
                        rel="noreferrer"
                        className={classeBotao("secundario", "sm")}
                        title="Pedir orçamento pelo WhatsApp"
                      >
                        <MessageCircle className="size-3.5" /> Pedir
                      </a>
                    )}
                    {decide && podeEscolher && o.valor != null && (o.status !== "escolhido" || ["aberto", "em_analise"].includes(c.status)) && (
                      <BotaoAcao
                        acao={escolherOrcamento}
                        id={o.id}
                        tamanho="sm"
                        variante="primario"
                        confirmar={
                          o.id === c.orcamento_id && recusadoPeloDono
                            ? `Escolher de novo o orçamento de ${nome} (${formatarReais(o.valor)})? O proprietário recebe outra vez o pedido de aprovação, com um link novo (o antigo deixa de valer).`
                            : `Escolher o orçamento de ${nome} (${formatarReais(o.valor)})?${pessoal ? " O serviço fica aprovado." : " Se o proprietário paga alguma parte, o chamado vai esperar a aprovação dele."}`
                        }
                      >
                        <CheckCircle2 className="size-3.5" /> {o.id === c.orcamento_id && recusadoPeloDono ? "Pedir aprovação de novo" : "Escolher"}
                      </BotaoAcao>
                    )}
                    {decide && <BotaoExcluir acao={excluirOrcamento} id={o.id} rotulo="Excluir orçamento" confirmar={`Excluir o orçamento de ${nome}?`} />}
                  </div>
                </Celula>
              </tr>
            );
          })}
          {orcamentos.length === 0 && <LinhaVazia colunas={7}>Nenhum orçamento ainda. Peça ou registre acima.</LinhaVazia>}
        </Tabela>
      </Cartao>

      {orcamentos.length > 0 && !encerrado && (
        <Cartao titulo="Preencher os valores recebidos">
          <div className="space-y-4">
            {orcamentos.map((o) => (
              <Formulario key={o.id} acao={atualizarOrcamento} automatico semAviso className="grid items-end gap-3 rounded-[14px] border border-borda-suave p-3 sm:grid-cols-[1.2fr_repeat(4,minmax(0,1fr))]">
                <input type="hidden" name="id" value={o.id} />
                <div className="text-sm font-medium text-texto sm:pb-3">{o.prestador?.nome ?? o.prestador_nome}</div>
                <Campo rotulo="Valor (R$)">
                  <Entrada name="valor" inputMode="decimal" defaultValue={o.valor != null ? String(o.valor).replace(".", ",") : ""} />
                </Campo>
                <Campo rotulo="Prazo (dias)">
                  <Entrada name="prazo_dias" inputMode="numeric" defaultValue={o.prazo_dias ?? ""} />
                </Campo>
                <Campo rotulo="Garantia (dias)">
                  <Entrada name="garantia_dias" inputMode="numeric" defaultValue={o.garantia_dias ?? ""} />
                </Campo>
                <Campo rotulo="Válido até">
                  <Entrada type="date" name="validade" defaultValue={o.validade ?? ""} />
                </Campo>
              </Formulario>
            ))}
            <p className="text-right text-xs text-mudo">As alterações são salvas automaticamente.</p>
          </div>
        </Cartao>
      )}

      {pessoal ? (
        <Aviso>No modo imóveis pessoais você é o dono: escolher o orçamento já aprova o serviço (não há pedido de aprovação ao proprietário).</Aviso>
      ) : (
        <Cartao
          titulo="Aprovação do proprietário"
          acoes={<Selo cor={COR_APROVACAO[c.aprovacao_status as keyof typeof COR_APROVACAO] ?? "cinza"}>{ROTULO_APROVACAO[c.aprovacao_status] ?? c.aprovacao_status}</Selo>}
        >
          {c.aprovacao_status === "nao_precisa" && c.status !== "aguardando_aprovacao" ? (
            <p className="text-sm text-texto-2">
              Só é pedida quando o proprietário paga alguma parte do conserto (hoje: {rotuloResponsavel(c.responsabilidade, "imobiliaria").toLowerCase()}). Ao escolher um orçamento nesse caso, o chamado fica “aguardando aprovação”.
            </p>
          ) : (
            <div className="space-y-4">
              <Definicao
                itens={[
                  ["Orçamento escolhido", c.valor_aprovado != null ? formatarReais(c.valor_aprovado) : "—"],
                  ["Parte do proprietário", `${formatarReais(parteDono)} (${String(Number(c.pct_proprietario)).replace(".", ",")}%)`],
                  ["Resposta", c.aprovacao_em ? `${c.aprovacao_nome ?? "—"} em ${formatarDataBR(diaLocal(c.aprovacao_em))}${c.aprovacao_canal === "link" ? " (pelo link)" : " (registro manual)"}` : "—"],
                  ["Observação", c.aprovacao_obs ?? "—"],
                  ...(c.status === "aguardando_aprovacao" && c.status_antes_aprovacao
                    ? ([["Pedido de novo", "A parte do proprietário aumentou depois do serviço aprovado. Quando ele aprovar, o chamado volta para onde estava."]] as [string, string][])
                    : []),
                  ...(recusadoPeloDono && ["aberto", "em_analise"].includes(c.status)
                    ? ([["E agora?", "Negocie e use “Pedir aprovação de novo” no orçamento, escolha outro orçamento ou mude quem paga (aba Resumo)."]] as [string, string][])
                    : []),
                ]}
              />
              {c.status === "aguardando_aprovacao" && !decide && (
                <p className="text-sm text-mudo">Quem manda o link e registra a resposta do proprietário é um administrador, gestor ou o financeiro.</p>
              )}
              {c.status === "aguardando_aprovacao" && decide && (
                <>
                  <div className="rounded-[14px] border border-borda-suave bg-elev p-3">
                    <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Link para o proprietário aprovar</div>
                    <div className="flex flex-wrap items-center gap-2">
                      <code className="min-w-0 flex-1 break-all text-xs text-texto-2">{linkAprovacao}</code>
                      <Copiar texto={linkAprovacao} rotulo="Copiar link" />
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {donos
                      .filter((d) => d.telefone)
                      .map((d) => (
                        <a
                          key={d.id}
                          href={linkWhatsapp(d.telefone!, mensagemAprovacao({ proprietario: d.nome, numero: c.numero, titulo: c.titulo, endereco, valor, parte: parteDono, link: linkAprovacao }))}
                          target="_blank"
                          rel="noreferrer"
                          className={classeBotao("secundario")}
                        >
                          <MessageCircle className="size-4" /> Pedir a {d.nome.split(" ")[0]}
                        </a>
                      ))}
                    {donos.length === 0 && <span className="text-sm text-mudo">O imóvel não tem proprietário cadastrado: copie o link e mande por onde preferir.</span>}
                    {decide && (
                      <JanelaCadastro rotuloBotao="Registrar resposta" variante="secundario" titulo="Resposta do proprietário" acao={registrarAprovacao} rotuloSalvar="Registrar">
                        <input type="hidden" name="id" value={id} />
                        <p className="text-sm text-texto-2">Use quando o proprietário respondeu por telefone, e-mail ou pessoalmente (ou quando o contrato dispensa a aprovação).</p>
                        <Campo rotulo="Resposta">
                          <Selecao name="decisao" defaultValue="aprovado">
                            <option value="aprovado">Aprovou o orçamento</option>
                            <option value="recusado">Recusou (volta para análise)</option>
                          </Selecao>
                        </Campo>
                        <Campo rotulo="Quem respondeu">
                          <Entrada name="nome" required defaultValue={donos[0]?.nome ?? ""} />
                        </Campo>
                        <Campo rotulo="Observação">
                          <AreaTexto name="obs" rows={2} placeholder="Aprovou por telefone às 15h; pediu nota fiscal…" />
                        </Campo>
                      </JanelaCadastro>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </Cartao>
      )}
    </div>
  );
}
