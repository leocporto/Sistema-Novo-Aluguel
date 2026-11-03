import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_MEDIDOR, ROTULO_STATUS_VISTORIA, vistoriaEditavel } from "@/lib/dominio/vistorias";
import { atualizarMidia, excluirMidia } from "../../actions";
import { carregarAmbientes, carregarMedidores, carregarMidias, carregarVistoria, linksAssinados } from "../../dados";
import { EnvioMidia } from "../../envio-midia";
import { Miniatura } from "../../galeria";

export const metadata: Metadata = { title: "Fotos e vídeos da vistoria" };

const quando = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function FotosVistoria({ params, searchParams }: PageProps<"/vistorias/[id]/fotos">) {
  const { id } = await params;
  const sp = await searchParams;
  const amb = typeof sp.amb === "string" ? sp.amb : "";
  const { supabase, organizacao } = await obterContexto();
  const v = await carregarVistoria(supabase, id);
  if (!v) notFound();
  const [ambientes, midias, medidores] = await Promise.all([carregarAmbientes(supabase, id), carregarMidias(supabase, id), carregarMedidores(supabase, id)]);
  const numero = new Map(midias.map((m, i) => [m.id, i + 1]));
  const visiveis = amb === "geral" ? midias.filter((m) => !m.ambiente_id) : amb ? midias.filter((m) => m.ambiente_id === amb) : midias;
  const links = await linksAssinados(
    supabase,
    visiveis.map((m) => m.path),
  );
  const nomeAmb = new Map(ambientes.map((a) => [a.id, a.nome]));
  const nomeItem = new Map(ambientes.flatMap((a) => a.vistoria_itens.map((i) => [i.id, i.nome] as const)));
  const nomeMedidor = new Map(medidores.map((m) => [m.id, `Medidor de ${ROTULO_MEDIDOR[m.tipo].toLowerCase()}`]));
  const base = `/vistorias/${id}/fotos`;
  // Concluída ou assinada: as fotos são as do laudo (só consulta; para mudar, reabra no Resumo).
  const editavel = vistoriaEditavel(v.status);

  return (
    <div className="space-y-6">
      {editavel ? (
        <Cartao titulo="Enviar fotos e vídeos">
          <EnvioMidia organizacaoId={organizacao.id} vistoriaId={id} ambientes={ambientes.map((a) => ({ id: a.id, nome: a.nome, itens: a.vistoria_itens.map((i) => ({ id: i.id, nome: i.nome })) }))} />
          <p className="mt-2 text-xs text-mudo">
            As fotos ganham no canto a data e a hora em que foram tiradas e o ambiente. No celular, use “Abrir no celular” para fotografar ambiente por ambiente.
          </p>
        </Cartao>
      ) : (
        <Aviso tipo="alerta">
          Vistoria {ROTULO_STATUS_VISTORIA[v.status].toLowerCase()}: as fotos e vídeos estão só para consulta (são os do laudo). Para incluir, mudar ou excluir, use “Reabrir” no Resumo.
        </Aviso>
      )}

      <PilulasLink
        rotulo="Ambiente das fotos"
        ativo={amb ? `${base}?amb=${amb}` : base}
        itens={[
          { href: base, rotulo: `Todas (${midias.length})` },
          { href: `${base}?amb=geral`, rotulo: `Gerais (${midias.filter((m) => !m.ambiente_id).length})` },
          ...ambientes.map((a) => ({ href: `${base}?amb=${a.id}`, rotulo: `${a.nome} (${midias.filter((m) => m.ambiente_id === a.id).length})` })),
        ]}
      />

      {visiveis.length === 0 ? (
        <p className="text-sm text-mudo">Nenhuma foto ou vídeo aqui ainda.</p>
      ) : (
        <ul className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {visiveis.map((m) => {
            const itensAmb = ambientes.find((a) => a.id === m.ambiente_id)?.vistoria_itens ?? [];
            return (
              <li key={m.id} className="rounded-card border border-borda bg-card p-3">
                <Miniatura url={links[m.path]} tipo={m.tipo} legenda={m.legenda} />
                <div className="mt-2 flex items-start justify-between gap-2">
                  <div className="min-w-0 text-xs text-mudo">
                    <span className="font-semibold text-texto">
                      {m.tipo === "video" ? "Vídeo" : "Foto"} {numero.get(m.id)}
                    </span>{" "}
                    · {quando(m.tirada_em)}
                    <div className="truncate">
                      {[m.ambiente_id ? nomeAmb.get(m.ambiente_id) : m.medidor_id ? nomeMedidor.get(m.medidor_id) : "Geral", m.item_id ? nomeItem.get(m.item_id) : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  {editavel && <BotaoExcluir acao={excluirMidia} id={m.id} rotulo="Excluir foto" confirmar="Excluir esta foto/vídeo da vistoria?" />}
                </div>
                {editavel ? (
                  // Trocar de ambiente remonta o quadro (a lista de itens passa a ser a do ambiente novo).
                  <Formulario key={`${m.id}-${m.ambiente_id ?? ""}`} acao={atualizarMidia} automatico className="mt-2 space-y-2 [&>p]:hidden">
                    <input type="hidden" name="id" value={m.id} />
                    <Entrada name="legenda" aria-label="Legenda" defaultValue={m.legenda ?? ""} placeholder="Legenda" className="min-h-10 py-1.5 text-sm" />
                    <div className="grid grid-cols-2 gap-2">
                      <Selecao name="ambiente_id" aria-label="Ambiente" defaultValue={m.ambiente_id ?? ""} className="min-h-10 py-1.5 text-sm">
                        <option value="">Geral (sem ambiente)</option>
                        {ambientes.map((a) => (
                          <option key={a.id} value={a.id}>
                            {a.nome}
                          </option>
                        ))}
                      </Selecao>
                      <Selecao name="item_id" aria-label="Item" defaultValue={m.item_id ?? ""} disabled={!m.ambiente_id} className="min-h-10 py-1.5 text-sm">
                        <option value="">Todo o ambiente</option>
                        {itensAmb.map((i) => (
                          <option key={i.id} value={i.id}>
                            {i.nome}
                          </option>
                        ))}
                      </Selecao>
                    </div>
                  </Formulario>
                ) : (
                  m.legenda && <p className="mt-2 text-sm text-texto-2">{m.legenda}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
