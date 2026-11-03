import type { Metadata } from "next";
import Link from "next/link";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { Formulario } from "@/components/formulario";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Entrada, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { normalizar } from "@/lib/dominio/imoveis";
import { PORTAIS, ROTULO_DESTAQUE, type Destaque } from "@/lib/dominio/site-portais";
import { todas } from "../../../financeiro/dados";
import { AbasSite } from "../../abas";
import { salvarPortalImovel } from "../../actions";
import { carregarPortais, type ControlePortal } from "../../dados";

export const metadata: Metadata = { title: "Publicação nos portais" };

const FILTROS: Record<string, string> = { "": "Disponíveis", vai: "Indo para algum portal", falha: "Com falha", limite: "Fora do limite" };

type Linha = { id: string; codigo: string; titulo: string | null; bairro: string | null; cidade: string | null; valor_aluguel: number | null; valor_venda: number | null; publicar_site: boolean };

const STATUS: Record<string, { cor: "verde" | "vermelho" | "amarelo" | "cinza"; rotulo: string }> = {
  enviado: { cor: "verde", rotulo: "ENVIADO" },
  falha: { cor: "vermelho", rotulo: "FALHA" },
  fora_do_limite: { cor: "amarelo", rotulo: "FORA DO LIMITE" },
  fora: { cor: "cinza", rotulo: "FORA DO FEED" },
};

/** Controle imóvel × portal: publicar ou não, destaque, código no portal e o resultado do último envio. */
export default async function PublicacaoPortaisPage({ searchParams }: PageProps<"/site/portais/imoveis">) {
  const sp = await searchParams;
  const filtro = typeof sp.filtro === "string" && sp.filtro in FILTROS ? sp.filtro : "";
  const busca = typeof sp.busca === "string" ? sp.busca : "";
  const { supabase } = await obterContexto();
  const [portais, imoveis, controles] = await Promise.all([
    carregarPortais(supabase),
    todas<Linha>(() => supabase.from("imoveis").select("id, codigo, titulo, bairro, cidade, valor_aluguel, valor_venda, publicar_site").eq("status", "disponivel").order("codigo").order("id")),
    todas<ControlePortal>(() =>
      supabase.from("portal_imoveis").select("imovel_id, portal, publicado, destaque, codigo_portal, url, ultima_sincronizacao, verificado_em, ultimo_status, ultimas_falhas").order("id"),
    ),
  ]);
  const ctl = new Map(controles.map((c) => [`${c.imovel_id}|${c.portal}`, c]));
  const vai = (i: Linha, p: (typeof portais)[number]) => {
    const c = ctl.get(`${i.id}|${p.portal}`);
    return p.ativo && (c?.publicado ?? (p.publicar_todos && i.publicar_site));
  };
  const termo = normalizar(busca);
  const lista = imoveis.filter((i) => {
    if (termo && !normalizar([i.codigo, i.titulo, i.bairro, i.cidade].filter(Boolean).join(" ")).includes(termo)) return false;
    if (filtro === "vai") return portais.some((p) => vai(i, p));
    if (filtro === "falha") return portais.some((p) => ctl.get(`${i.id}|${p.portal}`)?.ultimo_status === "falha");
    if (filtro === "limite") return portais.some((p) => ctl.get(`${i.id}|${p.portal}`)?.ultimo_status === "fora_do_limite");
    return true;
  });
  const url = (f: string) => `/site/portais/imoveis${f || busca ? `?${new URLSearchParams(Object.entries({ filtro: f, busca }).filter(([, v]) => v) as [string, string][])}` : ""}`;
  const colunas = `minmax(200px,1.1fr) repeat(${Math.max(portais.length, 1)}, minmax(250px,1fr))`;

  return (
    <>
      <Cabecalho
        titulo="Publicação nos portais"
        trilha="Site e portais"
        descricao="Escolha, imóvel por imóvel, o que vai para cada portal. “Automático” segue o site (se o portal estiver para mandar todos). Alugados e vendidos não aparecem aqui nem nos portais."
      />
      <AbasSite />
      {portais.length === 0 ? (
        <Aviso tipo="alerta">
          Ligue ao menos um portal na aba{" "}
          <Link href="/site/portais" className="font-semibold text-acento hover:underline">
            Portais
          </Link>
          .
        </Aviso>
      ) : (
        <>
          <PilulasLink className="mb-4" rotulo="Filtro" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
          <FiltroAutomatico>
            {filtro && <input type="hidden" name="filtro" value={filtro} />}
            <Entrada name="busca" aria-label="Buscar imóvel" defaultValue={busca} placeholder="Código, título, bairro…" className="max-w-72" />
          </FiltroAutomatico>
          <div className="entrar overflow-x-auto rounded-card border border-borda bg-card">
            <div className="min-w-max">
              <div className="grid border-b border-borda bg-elev font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mudo" style={{ gridTemplateColumns: colunas }}>
                <div className="px-[18px] py-[13px]">Imóvel</div>
                {portais.map((p) => (
                  <div key={p.portal} className="px-[18px] py-[13px]">
                    {PORTAIS[p.portal].nome} {!p.ativo && "(pausado)"}
                  </div>
                ))}
              </div>
              {lista.slice(0, 300).map((i) => (
                <Formulario key={i.id} acao={salvarPortalImovel} automatico semAviso className="border-b border-borda-suave transition-colors last:border-b-0 hover:bg-card-hover">
                  <input type="hidden" name="imovel_id" value={i.id} />
                  <div className="grid gap-0" style={{ gridTemplateColumns: colunas }}>
                    <div className="px-[18px] py-3">
                      <Link href={`/imoveis/${i.id}`} className="font-semibold text-acento hover:underline">
                        {i.codigo}
                      </Link>
                      <span className="block truncate text-xs text-mudo">{[i.bairro, i.cidade].filter(Boolean).join(", ") || i.titulo || "—"}</span>
                      <span className="block text-xs text-texto-2">
                        {i.valor_aluguel ? `${formatarReais(i.valor_aluguel)}/mês` : i.valor_venda ? formatarReais(i.valor_venda) : "sem valor"}
                        {i.publicar_site ? "" : " · fora do site"}
                      </span>
                    </div>
                    {portais.map((p) => {
                      const c = ctl.get(`${i.id}|${p.portal}`);
                      const modo = c?.publicado == null ? "auto" : !c.publicado ? "nao" : (c.destaque as Destaque);
                      const automatico = p.publicar_todos && i.publicar_site;
                      const st = c?.ultimo_status ? STATUS[c.ultimo_status] : null;
                      return (
                        <div key={p.portal} className="space-y-1.5 px-[18px] py-3">
                          <div className="flex gap-1.5">
                            <select name={`modo_${p.portal}`} defaultValue={modo} aria-label={`${PORTAIS[p.portal].nome}: ${i.codigo}`} className="h-[34px] min-w-0 flex-1 rounded-[9px] border border-borda-forte bg-input px-2 text-[13px] text-texto">
                              <option value="auto">Automático ({automatico ? "vai" : "não vai"})</option>
                              <option value="nao">Não publicar</option>
                              {(Object.keys(ROTULO_DESTAQUE) as Destaque[]).map((d) => (
                                <option key={d} value={d}>
                                  {ROTULO_DESTAQUE[d]}
                                </option>
                              ))}
                            </select>
                            <input
                              name={`codigo_${p.portal}`}
                              defaultValue={c?.codigo_portal ?? ""}
                              placeholder="Cód. no portal"
                              aria-label={`Código do anúncio de ${i.codigo} no ${PORTAIS[p.portal].nome}`}
                              className="h-[34px] w-28 rounded-[9px] border border-borda-forte bg-input px-2 text-[13px] text-texto placeholder:text-fraco"
                            />
                          </div>
                          {st && (
                            <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-mudo">
                              <Selo cor={st.cor}>{st.rotulo}</Selo>
                              {c?.ultimo_status === "enviado" && c.ultima_sincronizacao && <span>em {formatarDataBR(c.ultima_sincronizacao)}</span>}
                            </div>
                          )}
                          {c?.ultimo_status === "falha" && c.ultimas_falhas.length > 0 && (
                            <ul className="list-disc pl-4 text-[11.5px] leading-snug text-ruim">
                              {c.ultimas_falhas.map((f) => (
                                <li key={f}>{f}</li>
                              ))}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </Formulario>
              ))}
              {lista.length === 0 && <div className="px-4 py-10 text-center text-sm text-mudo">Nenhum imóvel aqui.</div>}
            </div>
          </div>
          {lista.length > 300 && <p className="mt-3 text-sm text-alerta">Mostrando 300 de {lista.length}. Use a busca para achar os outros.</p>}
          <p className="mt-3 text-right text-xs text-mudo">As alterações são salvas automaticamente. O resultado aparece depois da próxima busca do portal (ou do botão “Conferir agora”).</p>
        </>
      )}
    </>
  );
}
