import type { Metadata } from "next";
import { AlertTriangle, Gavel, Handshake, MessageCircle, Scale, XCircle } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Celula, Entrada, Grade, Indicador, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { faixaAtrasoCota, mensagemCobranca } from "@/lib/dominio/condominios";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { linkWhatsapp } from "@/lib/whatsapp";
import { cancelarAcordo, criarAcordo, marcarJuridico } from "../../actions";
import { carregarCondominio } from "../../dados";

export const metadata: Metadata = { title: "Inadimplência do condomínio" };

type Linha = {
  unidade_id: string;
  unidade: string;
  responsavel: { id: string; nome: string; telefone: string | null; email: string | null } | null;
  cotas: number;
  saldo: number;
  multa: number;
  juros: number;
  corrigido: number;
  dias: number;
  mais_antiga: string;
  competencias: string[];
  cota_ids: string[];
  juridico: boolean;
  acordo: boolean;
};

/** Unidades em atraso (com multa e juros de hoje, calculados no banco), mensagem pronta, acordo e cobrança judicial. */
export default async function InadimplenciaPage({ params }: PageProps<"/condominios/[id]/inadimplencia">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const [c, { data }, { data: acordos }] = await Promise.all([
    carregarCondominio(supabase, id),
    supabase.rpc("cond_inadimplencia", { p_condominio: id }),
    supabase.from("cond_acordos").select("id, numero, valor_total, parcelas, primeiro_vencimento, status, unidade:cond_unidades(numero, bloco:cond_blocos(nome))").eq("condominio_id", id).eq("status", "ativo").order("created_at", { ascending: false }),
  ]);
  const linhas = ((data ?? []) as Linha[]).map((l) => ({ ...l, saldo: Number(l.saldo), corrigido: Number(l.corrigido), multa: Number(l.multa), juros: Number(l.juros) }));
  const total = linhas.reduce((a, l) => a + l.corrigido, 0);
  const faixa = (f: string) => linhas.filter((l) => faixaAtrasoCota(l.dias) === f).reduce((a, l) => a + l.corrigido, 0);

  return (
    <div className="space-y-6">
      <div className="entrar-cascata grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Total devido hoje" icone={<AlertTriangle />} tom={total ? "perigo" : "sucesso"} valor={<Contador valor={total} formato="moeda" />} detalhe={`${linhas.length} unidade(s), com multa e juros`} />
        <Indicador rotulo="Até 30 dias" icone={<AlertTriangle />} valor={<Contador valor={faixa("ate30")} formato="moeda" />} />
        <Indicador rotulo="31 a 90 dias" icone={<AlertTriangle />} tom={faixa("ate90") ? "alerta" : "neutro"} valor={<Contador valor={faixa("ate90")} formato="moeda" />} />
        <Indicador rotulo="Mais de 90 dias" icone={<Gavel />} tom={faixa("mais90") ? "perigo" : "neutro"} valor={<Contador valor={faixa("mais90")} formato="moeda" />} />
      </div>

      <Tabela colunas={["Unidade", "Responsável", "Cotas", "Atraso", "Saldo", "Com multa e juros", "", ""]}>
        {linhas.map((l) => {
          const msg = mensagemCobranca({ nome: l.responsavel?.nome, condominio: c?.nome ?? "condomínio", unidade: l.unidade, competencias: l.competencias, corrigido: l.corrigido, organizacao: organizacao.nome });
          return (
            <tr key={l.unidade_id}>
              <Celula className="font-medium">{l.unidade}</Celula>
              <Celula className="text-sm text-texto-2">{l.responsavel?.nome ?? <span className="text-mudo">sem responsável</span>}</Celula>
              <Celula className="text-sm">
                {l.cotas}
                <span className="block text-xs text-mudo">{l.competencias.join(", ")}</span>
              </Celula>
              <Celula className={`whitespace-nowrap text-sm font-semibold ${l.dias > 90 ? "text-ruim" : l.dias > 30 ? "text-alerta" : "text-texto"}`}>{l.dias} dia(s)</Celula>
              <Celula className="tabular-nums">{formatarReais(l.saldo)}</Celula>
              <Celula className="tabular-nums font-semibold">{formatarReais(l.corrigido)}</Celula>
              <Celula>
                <span className="flex flex-wrap gap-1">
                  {l.juridico && <Selo cor="vermelho">jurídico</Selo>}
                  {l.acordo && <Selo cor="azul">tem acordo</Selo>}
                </span>
              </Celula>
              <Celula>
                <span className="flex justify-end gap-2">
                  {l.responsavel?.telefone && (
                    <a href={linkWhatsapp(l.responsavel.telefone, msg)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")} title="Mensagem pronta no WhatsApp">
                      <MessageCircle className="size-3.5" />
                    </a>
                  )}
                  {l.responsavel?.email && (
                    <a href={`mailto:${l.responsavel.email}?subject=${encodeURIComponent(`${c?.nome ?? "Condomínio"}: cotas em aberto`)}&body=${encodeURIComponent(msg)}`} className={classeBotao("secundario", "sm")} title="Mensagem pronta por e-mail">
                      @
                    </a>
                  )}
                  <JanelaCadastro rotuloBotao={<><Handshake className="size-3.5" /> Acordo</>} variante="secundario" tamanho="sm" titulo={`Acordo da unidade ${l.unidade}`} acao={criarAcordo} icone={<Handshake />} rotuloSalvar="Fazer acordo">
                    <input type="hidden" name="condominio_id" value={id} />
                    <input type="hidden" name="unidade_id" value={l.unidade_id} />
                    <p className="text-sm text-texto-2">Entram as cotas marcadas, com multa e juros de hoje. As originais ficam “em acordo” e as parcelas viram cotas novas.</p>
                    <div className="space-y-1">
                      {l.cota_ids.map((cid, i) => (
                        <label key={cid} className="flex items-center gap-2 text-sm text-texto">
                          <input type="checkbox" name="cotas" value={cid} defaultChecked className="size-4 accent-[var(--accent)]" /> Cota de {l.competencias[i]}
                        </label>
                      ))}
                    </div>
                    <Grade colunas={3}>
                      <Campo rotulo="Parcelas">
                        <Entrada name="parcelas" type="number" min={1} max={60} defaultValue={3} />
                      </Campo>
                      <Campo rotulo="1º vencimento">
                        <Entrada name="primeiro_vencimento" type="date" min={hoje} defaultValue={somarDias(hoje, 5)} />
                      </Campo>
                      <Campo rotulo="Desconto (R$)">
                        <Entrada name="desconto" inputMode="decimal" defaultValue="0" />
                      </Campo>
                    </Grade>
                    <Campo rotulo="Observação">
                      <AreaTexto name="obs" rows={2} />
                    </Campo>
                  </JanelaCadastro>
                  <JanelaCadastro rotuloBotao={<Scale className="size-3.5" />} variante="fantasma" tamanho="sm" titulo={`Cobrança judicial — ${l.unidade}`} acao={marcarJuridico} icone={<Scale />} rotuloSalvar="Salvar">
                    <input type="hidden" name="condominio_id" value={id} />
                    <input type="hidden" name="unidade_id" value={l.unidade_id} />
                    <Campo rotulo="Situação">
                      <Selecao name="juridico" defaultValue={l.juridico ? "nao" : "sim"}>
                        <option value="sim">Enviar para cobrança judicial</option>
                        <option value="nao">Encerrar a cobrança judicial</option>
                      </Selecao>
                    </Campo>
                    <Campo rotulo="Observação (processo, advogado…)">
                      <Entrada name="obs" />
                    </Campo>
                  </JanelaCadastro>
                </span>
              </Celula>
            </tr>
          );
        })}
        {linhas.length === 0 && <LinhaVazia colunas={8}>Nenhuma unidade em atraso.</LinhaVazia>}
      </Tabela>

      {(acordos ?? []).length > 0 && (
        <Cartao titulo="Acordos ativos">
          <ul className="space-y-2 text-sm">
            {(acordos ?? []).map((a) => {
              const u = a.unidade as unknown as { numero: string; bloco: { nome: string } | null } | null;
              return (
                <li key={a.id as string} className="flex flex-wrap items-center justify-between gap-2 rounded-[12px] border border-borda bg-elev px-3 py-2">
                  <span>
                    Acordo nº {a.numero as number} · {u ? (u.bloco ? `${u.bloco.nome} - ${u.numero}` : u.numero) : "—"} · {formatarReais(a.valor_total as number)} em {a.parcelas as number}x, 1º vencimento {formatarDataBR(a.primeiro_vencimento as string)}
                  </span>
                  <JanelaCadastro rotuloBotao={<><XCircle className="size-3.5" /> Cancelar</>} variante="fantasma" tamanho="sm" titulo={`Cancelar o acordo nº ${a.numero}`} acao={cancelarAcordo} icone={<XCircle />} rotuloSalvar="Cancelar acordo">
                    <input type="hidden" name="condominio_id" value={id} />
                    <input type="hidden" name="acordo_id" value={a.id as string} />
                    <p className="text-sm text-texto-2">Só dá se nenhuma parcela foi paga. As cotas originais voltam a ficar em aberto.</p>
                    <Campo rotulo="Motivo">
                      <Entrada name="motivo" required />
                    </Campo>
                  </JanelaCadastro>
                </li>
              );
            })}
          </ul>
        </Cartao>
      )}
    </div>
  );
}
