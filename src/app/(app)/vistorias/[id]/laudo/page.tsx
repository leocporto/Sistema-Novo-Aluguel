import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoImprimir } from "@/components/formulario";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { ROTULO_PAPEL_SIGNATARIO } from "@/lib/dominio/modelos";
import {
  ROTULO_ESTADO,
  ROTULO_MEDIDOR,
  ROTULO_RESPONSAVEL,
  ROTULO_STATUS_VISTORIA,
  ROTULO_TIPO_VISTORIA,
  UNIDADE_MEDIDOR,
  compararVistorias,
  progressoVistoria,
  valorPendencia,
} from "@/lib/dominio/vistorias";
import { carregarAmbientes, carregarMedidores, carregarMidias, carregarPendencias, carregarVistoria, enderecoImovel, linksAssinados, partesDaVistoria, quemFez, type Midia } from "../../dados";

export const metadata: Metadata = { title: "Laudo de vistoria" };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

function Fotos({ lista, links, numero }: { lista: Midia[]; links: Record<string, string>; numero: Map<string, number> }) {
  if (!lista.length) return null;
  return (
    <div className="mt-3 grid grid-cols-3 gap-3">
      {lista.map((m) => (
        <figure key={m.id} className="break-inside-avoid">
          {m.tipo === "video" ? (
            <div className="grid aspect-[4/3] place-items-center rounded-[8px] border border-borda bg-elev text-xs text-mudo">Vídeo {numero.get(m.id)} (disponível no sistema)</div>
          ) : links[m.path] ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={links[m.path]} alt={m.legenda ?? ""} className="aspect-[4/3] w-full rounded-[8px] border border-borda object-cover" />
          ) : (
            <div className="aspect-[4/3] rounded-[8px] bg-elev" />
          )}
          <figcaption className="mt-1 text-[11px] leading-tight text-texto-2">
            <strong>
              {m.tipo === "video" ? "Vídeo" : "Foto"} {numero.get(m.id)}
            </strong>{" "}
            · {quando(m.tirada_em)}
            {m.legenda ? ` · ${m.legenda}` : ""}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

/** Laudo completo para imprimir ou salvar em PDF (com fotos, comparação e assinaturas). */
export default async function LaudoVistoria({ params }: PageProps<"/vistorias/[id]/laudo">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const v = await carregarVistoria(supabase, id);
  if (!v) notFound();
  const [ambientes, medidores, midias, pendencias, partes, { data: sigs }, { data: cont }, antes, ref] = await Promise.all([
    carregarAmbientes(supabase, id),
    carregarMedidores(supabase, id),
    carregarMidias(supabase, id),
    carregarPendencias(supabase, id),
    partesDaVistoria(supabase, v),
    v.documento_id ? supabase.from("documento_signatarios").select("nome, papel, cpf, assinado_em, nome_assinado, cpf_assinado, ip").eq("documento_id", v.documento_id).order("ordem") : Promise.resolve({ data: [] }),
    supabase.from("vistoria_contestacoes").select("nome, texto, created_at, status, decisao, resposta, respondida_em").eq("vistoria_id", id).order("created_at"),
    v.referencia_id ? carregarAmbientes(supabase, v.referencia_id) : Promise.resolve(null),
    v.referencia_id ? supabase.from("vistorias").select("numero, tipo, data").eq("id", v.referencia_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const links = await linksAssinados(supabase, midias.filter((m) => m.tipo === "foto").map((m) => m.path));
  const numero = new Map(midias.map((m, i) => [m.id, i + 1]));
  const p = progressoVistoria(ambientes.flatMap((a) => a.vistoria_itens));
  const pioraram = antes
    ? compararVistorias(
        antes.map((a) => ({ nome: a.nome, itens: a.vistoria_itens })),
        ambientes.map((a) => ({ nome: a.nome, itens: a.vistoria_itens })),
      ).linhas.filter((l) => l.situacao === "piorou")
    : [];
  const nomeAmb = new Map(ambientes.map((a) => [a.id, a.nome]));
  const assinados = ((sigs ?? []) as { nome: string; papel: string; cpf: string | null; assinado_em: string | null; nome_assinado: string | null; cpf_assinado: string | null; ip: string | null }[]).filter((s) => s.assinado_em);
  const pend = pendencias.filter((x) => x.status !== "cancelada");
  const locadores = pessoal ? [organizacao.nome] : partes.proprietarios.map((x) => x.nome);
  const vistoriador = quemFez(v) ?? (pessoal ? organizacao.nome : null);
  const linhasAssinatura = [
    ...partes.locatarios.map((l) => ({ nome: l.nome, papel: "Locatário" })),
    ...locadores.map((n) => ({ nome: n, papel: "Locador" })),
    ...(!pessoal && vistoriador ? [{ nome: vistoriador, papel: "Vistoriador" }] : []),
  ];

  return (
    <div className="mx-auto max-w-4xl">
      <div className="nao-imprimir mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-texto-2">Use “Imprimir” e escolha “Salvar como PDF” para guardar ou mandar o laudo completo, com fotos.</p>
        <BotaoImprimir />
      </div>
      <article className="space-y-6 rounded-xl border border-borda bg-card p-8 text-[13.5px] text-texto print:border-0 print:p-0">
        <header className="border-b border-borda pb-4 text-center">
          <div className="text-xs uppercase tracking-[0.12em] text-mudo">{organizacao.nome}</div>
          <h1 className="mt-1 text-[22px] font-bold uppercase">
            Laudo de vistoria de {ROTULO_TIPO_VISTORIA[v.tipo]} nº {v.numero}
          </h1>
          <div className="mt-1 text-xs text-mudo">Situação: {ROTULO_STATUS_VISTORIA[v.status]}</div>
        </header>

        <section className="grid grid-cols-2 gap-x-6 gap-y-2">
          <div>
            <strong>Imóvel:</strong> {v.imovel?.codigo} — {enderecoImovel(v.imovel)}
          </div>
          <div>
            <strong>Data da vistoria:</strong> {formatarDataBR(v.data)}
          </div>
          {v.contrato && (
            <div>
              <strong>Contrato:</strong> nº {v.contrato.numero}
            </div>
          )}
          {locadores.length > 0 && (
            <div>
              <strong>Locador(es):</strong> {locadores.join(", ")}
            </div>
          )}
          {partes.locatarios.length > 0 && (
            <div>
              <strong>Locatário(s):</strong> {partes.locatarios.map((l) => l.nome).join(", ")}
            </div>
          )}
          {vistoriador && (
            <div>
              <strong>Vistoria feita por:</strong> {vistoriador}
            </div>
          )}
          {v.acompanhante && (
            <div>
              <strong>Acompanhou:</strong> {v.acompanhante}
            </div>
          )}
          <div>
            <strong>Checklist:</strong> {p.avaliados} de {p.total} itens avaliados · {midias.length} foto(s)/vídeo(s)
          </div>
        </section>
        <p className="text-xs text-texto-2">
          Estados: Novo; Bom (sem defeitos, com desgaste normal); Regular (marcas de uso, funciona); Ruim (precisa de reparo); Danificado (quebrado ou sem funcionar); Não se aplica.
        </p>

        {medidores.length > 0 && (
          <section className="break-inside-avoid">
            <h2 className="mb-2 text-[15px] font-semibold">Medidores</h2>
            <table className="w-full border-collapse text-sm">
              <tbody>
                {medidores.map((m) => (
                  <tr key={m.id} className="border-b border-borda-suave">
                    <td className="py-1.5 pr-3 font-medium">{ROTULO_MEDIDOR[m.tipo]}</td>
                    <td className="py-1.5 pr-3">{m.numero ? `nº ${m.numero}` : "—"}</td>
                    <td className="py-1.5 pr-3 tabular-nums">{m.leitura === null ? "sem leitura" : `${m.leitura.toLocaleString("pt-BR")} ${UNIDADE_MEDIDOR[m.tipo]}`}</td>
                    <td className="py-1.5 text-texto-2">{m.observacao ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <Fotos lista={midias.filter((x) => x.medidor_id)} links={links} numero={numero} />
          </section>
        )}

        {ambientes.map((a, i) => (
          <section key={a.id}>
            <h2 className="mb-2 text-[15px] font-semibold">
              {i + 1}. {a.nome}
            </h2>
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr className="border-b border-borda text-left text-[11px] uppercase tracking-[0.08em] text-mudo">
                  <th className="py-1 pr-3 font-semibold">Item</th>
                  <th className="py-1 pr-3 font-semibold">Estado</th>
                  <th className="py-1 font-semibold">Observação</th>
                </tr>
              </thead>
              <tbody>
                {a.vistoria_itens.map((it) => (
                  <tr key={it.id} className="break-inside-avoid border-b border-borda-suave">
                    <td className="py-1.5 pr-3">{it.nome}</td>
                    <td className={`py-1.5 pr-3 font-medium ${it.estado === "ruim" || it.estado === "danificado" ? "text-ruim" : ""}`}>{it.estado ? ROTULO_ESTADO[it.estado] : "não avaliado"}</td>
                    <td className="py-1.5 text-texto-2">{it.observacao ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {a.observacoes && (
              <p className="mt-2 text-sm">
                <strong>Observações:</strong> {a.observacoes}
              </p>
            )}
            <Fotos lista={midias.filter((m) => m.ambiente_id === a.id)} links={links} numero={numero} />
          </section>
        ))}

        {midias.some((m) => !m.ambiente_id && !m.medidor_id) && (
          <section>
            <h2 className="mb-2 text-[15px] font-semibold">Fotos gerais</h2>
            <Fotos lista={midias.filter((m) => !m.ambiente_id && !m.medidor_id)} links={links} numero={numero} />
          </section>
        )}

        {ref.data && (
          <section className="break-inside-avoid">
            <h2 className="mb-2 text-[15px] font-semibold">
              Comparação com a vistoria de {ROTULO_TIPO_VISTORIA[ref.data.tipo].toLowerCase()} nº {ref.data.numero} ({formatarDataBR(ref.data.data)})
            </h2>
            {pioraram.length === 0 ? (
              <p>Nenhum item piorou.</p>
            ) : (
              <ul className="list-disc space-y-1 pl-5">
                {pioraram.map((l, k) => (
                  <li key={k}>
                    {l.ambiente} · {l.item}: {l.antes ? ROTULO_ESTADO[l.antes] : "—"} → <strong>{l.depois ? ROTULO_ESTADO[l.depois] : "—"}</strong>
                    {l.obsDepois ? ` (${l.obsDepois})` : ""}
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {pend.length > 0 && (
          <section className="break-inside-avoid">
            <h2 className="mb-2 text-[15px] font-semibold">Danos e pendências</h2>
            {assinados.length > 0 && (
              <p className="mb-2 text-xs text-texto-2">
                Situação e valores dos reparos na data desta impressão (orçamentos e reparos continuam depois da vistoria). O texto exato que foi assinado está guardado no documento do laudo, em
                Documentos.
              </p>
            )}
            <table className="w-full border-collapse text-sm">
              <tbody>
                {pend.map((x, k) => {
                  const aprovado = x.vistoria_orcamentos.find((o) => o.aprovado);
                  return (
                    <tr key={x.id} className="border-b border-borda-suave">
                      <td className="py-1.5 pr-3">
                        {k + 1}. {x.descricao}
                        {x.ambiente_id ? ` (${nomeAmb.get(x.ambiente_id)})` : ""}
                      </td>
                      <td className="py-1.5 pr-3 text-texto-2">{pessoal && x.responsavel === "proprietario" ? "Locador" : ROTULO_RESPONSAVEL[x.responsavel]}</td>
                      <td className="py-1.5 pr-3 text-texto-2">{aprovado ? `orçamento: ${aprovado.prestador?.nome ?? aprovado.prestador_nome ?? ""}` : x.valor_estimado !== null ? "estimado" : ""}</td>
                      <td className="py-1.5 text-right tabular-nums">{formatarReais(paraReais(valorPendencia({ ...x, orcamentos: x.vistoria_orcamentos })))}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        )}

        {(v.observacoes || v.conclusao) && (
          <section className="break-inside-avoid space-y-2">
            {v.observacoes && (
              <p>
                <strong>Observações:</strong> {v.observacoes}
              </p>
            )}
            {v.conclusao && (
              <p>
                <strong>Conclusão:</strong> {v.conclusao}
              </p>
            )}
          </section>
        )}

        {(cont ?? []).length > 0 && (
          <section className="break-inside-avoid">
            <h2 className="mb-2 text-[15px] font-semibold">Contestações</h2>
            <ul className="space-y-2">
              {(cont ?? []).map((c, k) => (
                <li key={k}>
                  <strong>{c.nome}</strong> em {quando(c.created_at)}: {c.texto}
                  {c.resposta && <div className="text-texto-2">Resposta ({c.decisao === "aceita" ? "aceita" : c.decisao === "parcial" ? "aceita em parte" : "mantida"}): {c.resposta}</div>}
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="break-inside-avoid border-t border-borda pt-4">
          {v.contestacao_ate && <p className="mb-4 text-xs text-texto-2">O locatário pode contestar qualquer item deste laudo até {formatarDataBR(v.contestacao_ate)}.</p>}
          {assinados.length > 0 ? (
            <div className="text-xs text-texto-2">
              <h3 className="mb-2 text-sm font-semibold text-texto">Assinaturas eletrônicas</h3>
              <ul className="space-y-1">
                {assinados.map((s, k) => (
                  <li key={k}>
                    <strong>{s.nome_assinado ?? s.nome}</strong> ({s.papel === "parte" ? "Vistoriador" : ROTULO_PAPEL_SIGNATARIO[s.papel]}) · CPF/CNPJ {s.cpf_assinado ?? s.cpf ?? "—"} · {quando(s.assinado_em!)} · IP {s.ip ?? "—"}
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-10 gap-y-10 pt-6">
              {linhasAssinatura.map((l, k) => (
                <div key={k} className="border-t border-texto pt-1 text-center text-xs">
                  {l.nome}
                  <div className="text-mudo">{l.papel}</div>
                </div>
              ))}
            </div>
          )}
        </section>
      </article>
    </div>
  );
}
