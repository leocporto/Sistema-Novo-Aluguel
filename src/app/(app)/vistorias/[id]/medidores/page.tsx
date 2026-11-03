import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Gauge, Plus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_MEDIDOR, ROTULO_STATUS_VISTORIA, UNIDADE_MEDIDOR, consumoMedidores, vistoriaEditavel } from "@/lib/dominio/vistorias";
import { atualizarMedidor, criarMedidor, criarMedidoresPadrao, excluirMedidor } from "../../actions";
import { carregarMedidores, carregarMidias, carregarVistoria, linksAssinados } from "../../dados";
import { EnvioMidia } from "../../envio-midia";
import { Miniatura } from "../../galeria";

export const metadata: Metadata = { title: "Medidores da vistoria" };

const fmt = (n: number | null) => (n === null ? "—" : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));

export default async function MedidoresVistoria({ params }: PageProps<"/vistorias/[id]/medidores">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const v = await carregarVistoria(supabase, id);
  if (!v) notFound();
  const [medidores, midias, ref] = await Promise.all([
    carregarMedidores(supabase, id),
    carregarMidias(supabase, id),
    v.referencia_id ? carregarMedidores(supabase, v.referencia_id) : Promise.resolve([]),
  ]);
  const fotos = midias.filter((m) => m.medidor_id);
  const links = await linksAssinados(
    supabase,
    fotos.map((m) => m.path),
  );
  const consumo = v.referencia_id ? consumoMedidores(ref, medidores) : [];
  // Concluída ou assinada: as leituras são as do laudo (só consulta; para mudar, reabra no Resumo).
  const editavel = vistoriaEditavel(v.status);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
      <div className="space-y-4">
        {!editavel && (
          <Aviso tipo="alerta">Vistoria {ROTULO_STATUS_VISTORIA[v.status].toLowerCase()}: as leituras estão só para consulta (são as do laudo). Para corrigir, use “Reabrir” no Resumo.</Aviso>
        )}
        {medidores.length === 0 && (
          <Cartao titulo="Medidores">
            <p className="mb-4 text-sm text-texto-2">
              Registre o número e a leitura dos relógios de água, energia e gás no dia da vistoria (com foto do visor). Na saída, o sistema mostra o consumo desde a entrada.
            </p>
            {editavel ? (
              <BotaoAcao acao={criarMedidoresPadrao} id={id} variante="primario">
                <Gauge className="size-4" /> Incluir água, energia e gás
              </BotaoAcao>
            ) : (
              <p className="text-sm text-mudo">Nenhum medidor registrado nesta vistoria.</p>
            )}
          </Cartao>
        )}
        {medidores.map((m) => {
          const fm = fotos.filter((f) => f.medidor_id === m.id);
          return (
            <Cartao
              key={m.id}
              titulo={ROTULO_MEDIDOR[m.tipo]}
              acoes={editavel ? <BotaoExcluir acao={excluirMedidor} id={m.id} rotulo={`Excluir medidor de ${ROTULO_MEDIDOR[m.tipo]}`} confirmar="Excluir este medidor?" /> : undefined}
            >
              {editavel ? (
                <Formulario acao={atualizarMedidor} automatico>
                  <input type="hidden" name="id" value={m.id} />
                  <div className="grid gap-4 sm:grid-cols-3">
                    <Campo rotulo="Nº do medidor">
                      <Entrada name="numero" defaultValue={m.numero ?? ""} />
                    </Campo>
                    <Campo rotulo={`Leitura (${UNIDADE_MEDIDOR[m.tipo]})`}>
                      <Entrada name="leitura" inputMode="decimal" defaultValue={m.leitura === null ? "" : String(m.leitura).replace(".", ",")} />
                    </Campo>
                    <Campo rotulo="Observação">
                      <Entrada name="observacao" defaultValue={m.observacao ?? ""} placeholder="Ex.: lacre ok" />
                    </Campo>
                  </div>
                </Formulario>
              ) : (
                <dl className="grid gap-4 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-mudo">Nº do medidor</dt>
                    <dd className="text-texto">{m.numero ?? "—"}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-mudo">Leitura</dt>
                    <dd className="tabular-nums text-texto">
                      {fmt(m.leitura)} {m.leitura === null ? "" : UNIDADE_MEDIDOR[m.tipo]}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-mudo">Observação</dt>
                    <dd className="text-texto-2">{m.observacao ?? "—"}</dd>
                  </div>
                </dl>
              )}
              <div className="mt-4 grid gap-3 sm:grid-cols-[repeat(auto-fill,minmax(140px,1fr))]">
                {fm.map((f) => (
                  <Miniatura key={f.id} url={links[f.path]} tipo={f.tipo} legenda={f.legenda} />
                ))}
              </div>
              {editavel && (
                <div className="mt-3">
                  <EnvioMidia organizacaoId={organizacao.id} vistoriaId={id} ambientes={[]} medidorId={m.id} rotulo="Foto do visor do medidor" />
                </div>
              )}
            </Cartao>
          );
        })}
        {editavel && medidores.length > 0 && (
          <JanelaCadastro
            rotuloBotao={
              <>
                <Plus className="size-4" /> Outro medidor
              </>
            }
            variante="secundario"
            titulo="Novo medidor"
            acao={criarMedidor}
            icone={<Gauge />}
            rotuloSalvar="Incluir"
          >
            <input type="hidden" name="vistoria_id" value={id} />
            <div className="grid gap-4 sm:grid-cols-3">
              <Campo rotulo="Tipo">
                <Selecao name="tipo" defaultValue="energia">
                  {Object.entries(ROTULO_MEDIDOR).map(([k, r]) => (
                    <option key={k} value={k}>
                      {r}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Nº do medidor">
                <Entrada name="numero" />
              </Campo>
              <Campo rotulo="Leitura">
                <Entrada name="leitura" inputMode="decimal" />
              </Campo>
            </div>
          </JanelaCadastro>
        )}
      </div>

      <Cartao titulo="Consumo desde a vistoria de referência">
        {!v.referencia_id ? (
          <p className="text-sm text-mudo">Sem vistoria de referência. Escolha uma na aba Comparação para ver o consumo.</p>
        ) : consumo.length === 0 ? (
          <p className="text-sm text-mudo">Registre as leituras para comparar.</p>
        ) : (
          <ul className="space-y-3 text-sm">
            {consumo.map((c, i) => (
              <li key={i} className="border-b border-borda-suave pb-2 last:border-0">
                <div className="font-medium text-texto">
                  {ROTULO_MEDIDOR[c.tipo]}
                  {c.numero ? ` · nº ${c.numero}` : ""}
                </div>
                <div className="text-texto-2">
                  {fmt(c.antes)} → {fmt(c.depois)} {UNIDADE_MEDIDOR[c.tipo]}
                  {c.consumo !== null && (
                    <span className={`ml-2 font-semibold ${c.consumo < 0 ? "text-ruim" : "text-texto"}`}>
                      {c.consumo < 0 ? "leitura menor que a anterior (confira)" : `consumo ${fmt(c.consumo)} ${UNIDADE_MEDIDOR[c.tipo]}`}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
