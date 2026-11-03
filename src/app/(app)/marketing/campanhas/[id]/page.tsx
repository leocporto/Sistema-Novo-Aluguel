import type { Metadata } from "next";
import Link from "next/link";
import { ListPlus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { rotuloEtapa } from "@/lib/dominio/crm";
import { agoraMs } from "@/lib/dominio/datas";
import { VARIAVEIS_MENSAGEM, finalidadeDoTipo, formatarDataHora, isoParaDataHoraLocal, lerFiltros, renderizarMensagem, comRodape } from "@/lib/dominio/marketing";
import { INTERESSES_PESSOA, ROTULO_ORIGEM_LEAD, ROTULO_PAPEL } from "@/lib/tipos";
import { atualizarCampanha, montarFila } from "../../actions";
import { SelecaoCanal, TextoMensagem } from "../../campos";
import { urlBase, type Campanha } from "../../dados";
import { variaveisDoContato } from "../../montar-fila";
import { prepararCampanha } from "../../publico-campanha";

export const metadata: Metadata = { title: "Campanha" };

const chip =
  "flex cursor-pointer items-center gap-2 rounded-full border border-borda px-3 py-1.5 text-[13px] text-texto-2 transition hover:border-borda-forte has-[:checked]:border-acento has-[:checked]:bg-acento-bg has-[:checked]:text-acento-hot";
const caixa = "flex cursor-pointer items-center gap-2 text-sm text-texto-2";
const ETAPAS = ["novo", "em_atendimento", "visita", "proposta", "perdido"];

export default async function CampanhaPage({ params }: PageProps<"/marketing/campanhas/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const { data } = await supabase.from("mkt_campanhas").select("*").eq("id", id).single();
  const c = data as Campanha;
  const f = lerFiltros(c.filtros);
  const finalidade = finalidadeDoTipo(c.tipo);
  const base = await urlBase();
  const [{ data: modelos }, { data: imoveis }, { data: corretores }, preparo] = await Promise.all([
    supabase.from("mkt_modelos").select("id, nome, canal").eq("ativo", true).order("nome"),
    supabase.from("imoveis").select("id, codigo, bairro, status").order("codigo").limit(2000),
    supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"]).order("nome"),
    // Mesma conta da fila de envio (publico-campanha.ts).
    prepararCampanha(supabase, c, { base, imobiliaria: organizacao.nome, agoraMs: agoraMs() }),
  ]);
  const { incluidos, excluidos, ctx, problema } = preparo;
  const porMotivo = new Map<string, number>();
  for (const e of excluidos) porMotivo.set(e.motivo, (porMotivo.get(e.motivo) ?? 0) + 1);
  const exemplo = incluidos[0];
  const previa = exemplo
    ? comRodape(
        renderizarMensagem(c.mensagem, variaveisDoContato(exemplo, ctx, { link_pesquisa: `${base}/pesquisa/(link-da-pesquisa)` })),
        c.canal,
        exemplo.preferencias_token ? `${base}/preferencias/${exemplo.preferencias_token}` : null,
        finalidade,
      )
    : null;
  const editavel = c.status !== "cancelada";
  const total = incluidos.length;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <Formulario acao={atualizarCampanha} automatico>
        <input type="hidden" name="id" value={id} />
        <input type="hidden" name="filtros" value="1" />
        {!editavel && <Aviso tipo="alerta">Campanha cancelada: nada mais é enviado.</Aviso>}
        {c.status === "fila" && (
          <Aviso>
            A fila foi montada em {formatarDataHora(c.fila_em)}. Mudanças no texto e no público valem para quem entrar ao clicar de novo em “Acrescentar à fila”.
          </Aviso>
        )}
        <Cartao titulo="Mensagem">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome da campanha">
                <Entrada name="nome" required defaultValue={c.nome} />
              </Campo>
              <Campo rotulo="Canal">
                <SelecaoCanal padrao={c.canal} />
              </Campo>
            </div>
            <Campo rotulo="Modelo" dica="Trocar o modelo troca o texto abaixo.">
              <Selecao name="modelo_id" defaultValue={c.modelo_id ?? ""}>
                <option value="">— texto livre —</option>
                {(modelos ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome} ({m.canal})
                  </option>
                ))}
              </Selecao>
            </Campo>
            {c.canal === "email" && (
              <Campo rotulo="Assunto do e-mail">
                <Entrada key={`a-${c.modelo_id}`} name="assunto" defaultValue={c.assunto ?? ""} />
              </Campo>
            )}
            <Campo rotulo="Texto" dica={`Variáveis: ${VARIAVEIS_MENSAGEM.map((v) => `{{${v.chave}}}`).join(" ")}`}>
              <AreaTexto key={`m-${c.modelo_id}`} name="mensagem" rows={7} defaultValue={c.mensagem} />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Link da campanha (opcional)" dica="Vira {{link}} com UTM automático.">
                <Entrada name="link" type="url" defaultValue={c.link ?? ""} placeholder="https://" />
              </Campo>
              <Campo rotulo="Nome da campanha nos links (utm_campaign)">
                <Entrada name="utm_campaign" defaultValue={c.utm_campaign ?? ""} />
              </Campo>
              <Campo rotulo="Imóvel da campanha" dica="Usado em {{imovel}}, {{preco}} e no filtro de perfil.">
                <Selecao name="imovel_id" defaultValue={c.imovel_id ?? ""}>
                  <option value="">— nenhum —</option>
                  {(imoveis ?? []).map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.codigo}
                      {i.bairro ? ` — ${i.bairro}` : ""}
                      {i.status !== "disponivel" ? " (indisponível)" : ""}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Agendar para (horário de Brasília)" dica="Vazio = assim que a fila for montada.">
                <Entrada name="agendada_para" type="datetime-local" defaultValue={isoParaDataHoraLocal(c.agendada_para)} />
              </Campo>
            </div>
          </div>
        </Cartao>

        <Cartao titulo="Público">
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Quem">
                <Selecao name="f_publico" defaultValue={f.publico ?? "ambos"}>
                  <option value="ambos">Leads e pessoas</option>
                  <option value="leads">Só leads</option>
                  <option value="pessoas">Só pessoas cadastradas</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Funil / quer">
                <Selecao name="f_funil" defaultValue={f.funil ?? ""}>
                  <option value="">Qualquer</option>
                  <option value="locacao">Alugar (locação)</option>
                  <option value="venda">Comprar (venda)</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Região (bairro ou cidade)">
                <Entrada name="f_regiao" defaultValue={f.regiao ?? ""} placeholder="Ex.: Gonzaga" />
              </Campo>
            </div>
            <fieldset>
              <legend className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Leads: etapa do funil (vazio = todas abertas)</legend>
              <div className="flex flex-wrap gap-2">
                {ETAPAS.map((e) => (
                  <label key={e} className={chip}>
                    <input type="checkbox" name="f_etapas" value={e} defaultChecked={(f.etapas ?? []).includes(e)} className="sr-only" />
                    {rotuloEtapa("locacao", e)}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Leads: origem">
                <Selecao name="f_origem" defaultValue={f.origem ?? ""}>
                  <option value="">Qualquer</option>
                  {Object.entries(ROTULO_ORIGEM_LEAD).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Leads: fonte (utm_source)">
                <Entrada name="f_utm_source" defaultValue={f.utm_source ?? ""} placeholder="google, facebook…" />
              </Campo>
              <Campo rotulo="Leads: corretor">
                <Selecao name="f_corretor" defaultValue={f.corretor ?? ""}>
                  <option value="">Qualquer</option>
                  {(corretores ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Leads: sem contato há (dias)" dica="Para reativação. Vazio = qualquer.">
                <Entrada name="f_parado_dias" type="number" min={0} defaultValue={f.parado_dias ?? ""} />
              </Campo>
              <Campo rotulo="Pessoas: papel">
                <Selecao name="f_papel" defaultValue={f.papel ?? ""}>
                  <option value="">Qualquer</option>
                  {Object.entries(ROTULO_PAPEL).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Pessoas: interesse">
                <Selecao name="f_interesse" defaultValue={f.interesse ?? ""}>
                  <option value="">Qualquer</option>
                  {Object.entries(INTERESSES_PESSOA).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            </div>
            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <label className={caixa}>
                <input type="hidden" name="f_reativar" value="" />
                <input type="checkbox" name="f_reativar" defaultChecked={f.reativar} className="size-4" /> Leads para reativar (mesma regra de{" "}
                <Link href="/comercial/reativar" className="text-acento hover:underline">
                  Comercial › Reativar
                </Link>
                : perdidos há 30+ dias ou parados há 60+)
              </label>
              <label className={caixa}>
                <input type="hidden" name="f_incluir_perdidos" value="" />
                <input type="checkbox" name="f_incluir_perdidos" defaultChecked={f.incluir_perdidos} className="size-4" /> Incluir leads perdidos
              </label>
              <label className={caixa}>
                <input type="hidden" name="f_combina_imovel" value="" />
                <input type="checkbox" name="f_combina_imovel" defaultChecked={f.combina_imovel} className="size-4" /> Só quem tem perfil para o imóvel da campanha
              </label>
              <label className={caixa}>
                <input type="hidden" name="so_autorizados" value="" />
                <input type="checkbox" name="so_autorizados" defaultChecked={c.so_autorizados} className="size-4" /> Pessoas: só quem autorizou este canal e ofertas (aba Comunicação)
              </label>
            </div>
          </div>
        </Cartao>
      </Formulario>

      <div className="space-y-6">
        <Cartao titulo="Público agora">
          <div className="text-[34px] font-semibold leading-none tracking-[-0.02em] tabular-nums text-texto">{total}</div>
          <p className="mt-1 text-sm text-texto-2">contato(s) recebem esta campanha.</p>
          {excluidos.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-texto-2">
              {[...porMotivo.entries()].map(([m, n]) => (
                <li key={m}>
                  <b className="tabular-nums text-texto">{n}</b> fora: {m.toLowerCase()}
                </li>
              ))}
            </ul>
          )}
          {problema && (
            <div className="mt-3">
              <Aviso tipo="alerta">{problema}</Aviso>
            </div>
          )}
          <p className="mt-3 text-xs text-mudo">Quem pediu para não receber (descadastro, “SAIR” no WhatsApp ou autorização retirada) nunca entra — o banco confere de novo na hora de enviar.</p>
          {editavel && total > 0 && !problema && (
            <div className="mt-4">
              <BotaoAcao
                acao={montarFila}
                id={id}
                variante="primario"
                confirmar={`${c.status === "fila" ? "Acrescentar à fila quem ainda não está" : "Montar a fila de envio"} — até ${total} contato(s)?`}
              >
                <ListPlus className="size-4" /> {c.status === "fila" ? "Acrescentar à fila" : "Montar fila de envio"}
              </BotaoAcao>
            </div>
          )}
        </Cartao>
        <Cartao titulo="Prévia">
          {previa ? (
            <>
              <p className="mb-2 text-xs text-mudo">Para {exemplo!.nome}:</p>
              <div className="rounded-[14px] border border-borda bg-elev p-4">
                <TextoMensagem texto={previa} />
              </div>
            </>
          ) : (
            <p className="text-sm text-mudo">Sem ninguém no público para mostrar a prévia.</p>
          )}
        </Cartao>
      </div>
    </div>
  );
}
