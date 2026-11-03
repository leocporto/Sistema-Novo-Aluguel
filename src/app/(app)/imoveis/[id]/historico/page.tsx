import type { Metadata } from "next";
import Link from "next/link";
import { Megaphone } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { PORTAIS_ANUNCIO, ROTULO_STATUS_VISITA } from "@/lib/tipos";
import { criarAnuncio, encerrarAnuncio, excluirAnuncio } from "../../actions";

export const metadata: Metadata = { title: "Histórico do imóvel" };

const ROTULO_CAMPO: Record<string, string> = { aluguel: "Aluguel", venda: "Venda", condominio: "Condomínio", iptu: "IPTU" };
const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function HistoricoImovelPage({ params }: PageProps<"/imoveis/[id]/historico">) {
  const { id } = await params;
  const { supabase, organizacao, usuario } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const [{ data: precos }, { data: contratos }, { data: anuncios }, { data: visitas }] = await Promise.all([
    supabase.from("imovel_precos").select("id, campo, valor_anterior, valor_novo, alterado_em, usuario_id").eq("imovel_id", id).order("alterado_em", { ascending: false }).limit(200),
    supabase.from("contratos").select("id, numero, status, data_inicio, data_fim, valor_aluguel").eq("imovel_id", id).order("data_inicio", { ascending: false }),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("imovel_anuncios").select("*").eq("imovel_id", id).order("inicio", { ascending: false }),
    pessoal
      ? Promise.resolve({ data: [] })
      : supabase.from("visitas").select("id, data_hora, status, lead:leads(id, nome), corretor:pessoas(nome)").eq("imovel_id", id).order("data_hora", { ascending: false }).limit(50),
  ]);
  type A = { id: string; portal: string; url: string | null; inicio: string; fim: string | null; valor: number | null; observacoes: string | null };
  type V = { id: string; data_hora: string; status: string; lead: { id: string; nome: string } | null; corretor: { nome: string } | null };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Cartao titulo="Histórico de preços">
        <ul className="space-y-3 text-sm">
          {(precos ?? []).map((p) => {
            const ant = p.valor_anterior == null ? null : Number(p.valor_anterior);
            const novo = p.valor_novo == null ? null : Number(p.valor_novo);
            const subiu = ant != null && novo != null && novo > ant;
            return (
              <li key={p.id} className="flex items-start justify-between gap-3">
                <div>
                  <div className="font-medium text-texto">{ROTULO_CAMPO[p.campo] ?? p.campo}</div>
                  <div className="text-xs text-mudo">
                    {dataHora(p.alterado_em)}
                    {p.usuario_id === usuario.id ? " · por você" : ""}
                  </div>
                </div>
                <div className="text-right tabular-nums">
                  {ant == null ? (
                    <span className="text-xs text-mudo">valor inicial </span>
                  ) : (
                    <span className="text-xs text-mudo line-through">{formatarReais(ant)} </span>
                  )}
                  <span className={`font-semibold ${ant == null ? "text-texto" : subiu ? "text-ok" : "text-ruim"}`}>{novo == null ? "sem valor" : formatarReais(novo)}</span>
                  {ant != null && novo != null && ant > 0 && (
                    <div className="text-xs text-mudo">
                      {subiu ? "+" : ""}
                      {(((novo - ant) / ant) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
                    </div>
                  )}
                </div>
              </li>
            );
          })}
          {!precos?.length && <li className="text-mudo">Nenhuma mudança de preço registrada ainda. A partir de agora, toda alteração aparece aqui.</li>}
        </ul>
      </Cartao>

      <Cartao titulo="Contratos">
        <ul className="space-y-2 text-sm">
          {(contratos ?? []).map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <Link href={`/contratos/${c.id}`} className="text-acento hover:underline">
                #{c.numero} · {formatarDataBR(c.data_inicio)} a {formatarDataBR(c.data_fim)}
              </Link>
              <span className="flex items-center gap-2">
                {formatarReais(c.valor_aluguel)}
                <Selo cor={c.status === "ativo" ? "verde" : "cinza"}>{c.status}</Selo>
              </span>
            </li>
          ))}
          {!contratos?.length && <li className="text-mudo">Nenhum contrato.</li>}
        </ul>
      </Cartao>

      {!pessoal && (
        <>
          <Cartao
            titulo="Anúncios em portais"
            acoes={
              <JanelaCadastro rotuloBotao={<><Megaphone className="size-3.5" /> Novo anúncio</>} tamanho="sm" variante="secundario" titulo="Registrar anúncio" acao={criarAnuncio} rotuloSalvar="Registrar" icone={<Megaphone />}>
                <input type="hidden" name="imovel_id" value={id} />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Portal">
                    <Selecao name="portal" defaultValue={PORTAIS_ANUNCIO[0]}>
                      {PORTAIS_ANUNCIO.map((p) => (
                        <option key={p}>{p}</option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Valor anunciado (R$)">
                    <Entrada name="valor" inputMode="decimal" />
                  </Campo>
                  <Campo rotulo="Início">
                    <Entrada type="date" name="inicio" defaultValue={hoje} />
                  </Campo>
                  <Campo rotulo="Fim (se já saiu do ar)">
                    <Entrada type="date" name="fim" />
                  </Campo>
                </div>
                <Campo rotulo="Link do anúncio">
                  <Entrada type="url" name="url" placeholder="https://…" />
                </Campo>
                <Campo rotulo="Observações">
                  <AreaTexto name="observacoes" rows={2} />
                </Campo>
              </JanelaCadastro>
            }
          >
            <ul className="space-y-3 text-sm">
              {((anuncios ?? []) as A[]).map((a) => {
                const ativo = !a.fim || a.fim >= hoje;
                return (
                  <li key={a.id} className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-texto">
                        {a.url ? (
                          <a href={a.url} target="_blank" rel="noreferrer" className="text-acento hover:underline">
                            {a.portal}
                          </a>
                        ) : (
                          a.portal
                        )}
                        {a.valor ? <span className="text-texto-2"> · {formatarReais(a.valor)}</span> : null}
                      </div>
                      <div className="text-xs text-mudo">
                        desde {formatarDataBR(a.inicio)}
                        {a.fim ? ` até ${formatarDataBR(a.fim)}` : ""}
                        {a.observacoes ? ` · ${a.observacoes}` : ""}
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Selo cor={ativo ? "verde" : "cinza"}>{ativo ? "no ar" : "encerrado"}</Selo>
                      {ativo && (
                        <form action={encerrarAnuncio}>
                          <input type="hidden" name="id" value={a.id} />
                          <input type="hidden" name="imovel_id" value={id} />
                          <button className="text-xs text-mudo hover:underline">encerrar</button>
                        </form>
                      )}
                      <form action={excluirAnuncio}>
                        <input type="hidden" name="id" value={a.id} />
                        <input type="hidden" name="imovel_id" value={id} />
                        <button className="text-xs text-mudo hover:text-ruim hover:underline">excluir</button>
                      </form>
                    </div>
                  </li>
                );
              })}
              {!anuncios?.length && <li className="text-mudo">Nenhum anúncio registrado.</li>}
            </ul>
          </Cartao>

          <Cartao titulo="Visitas" acoes={<Link href={`/agenda?novo=1&imovel_novo=${id}`} className="text-xs text-acento hover:underline">+ agendar</Link>}>
            <ul className="space-y-2 text-sm">
              {((visitas ?? []) as unknown as V[]).map((v) => (
                <li key={v.id} className="flex items-center justify-between gap-2">
                  <span>
                    {dataHora(v.data_hora)}
                    {v.lead ? (
                      <>
                        {" · "}
                        <Link href={`/comercial/leads/${v.lead.id}`} className="text-acento hover:underline">
                          {v.lead.nome}
                        </Link>
                      </>
                    ) : null}
                    {v.corretor ? <span className="text-mudo"> · {v.corretor.nome}</span> : null}
                  </span>
                  <Selo cor={v.status === "realizada" ? "verde" : v.status === "cancelada" ? "cinza" : "azul"}>{ROTULO_STATUS_VISITA[v.status]}</Selo>
                </li>
              ))}
              {!visitas?.length && <li className="text-mudo">Nenhuma visita a este imóvel.</li>}
            </ul>
          </Cartao>
        </>
      )}
    </div>
  );
}
