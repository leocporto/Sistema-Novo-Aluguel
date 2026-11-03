import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArrowDown, ArrowUp, Equal, HelpCircle, ListPlus } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { Formulario } from "@/components/formulario";
import { PilulasLink } from "@/components/pilulas-link";
import { Campo, Cartao, Celula, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { COR_ESTADO, ROTULO_ESTADO, ROTULO_SITUACAO_COMPARACAO, ROTULO_STATUS_VISTORIA, ROTULO_TIPO_VISTORIA, compararVistorias, type SituacaoComparacao } from "@/lib/dominio/vistorias";
import { atualizarVistoria, gerarPendenciasDoQuePiorou } from "../../actions";
import { carregarAmbientes, carregarMidias, carregarVistoria, linksAssinados, type Ambiente, type Midia } from "../../dados";
import { Miniatura } from "../../galeria";

export const metadata: Metadata = { title: "Comparação de vistorias" };

const COR_SITUACAO: Record<SituacaoComparacao, "vermelho" | "verde" | "cinza" | "amarelo" | "azul"> = {
  piorou: "vermelho",
  melhorou: "verde",
  igual: "cinza",
  sem_avaliacao: "amarelo",
  item_novo: "azul",
  nao_vistoriado: "amarelo",
};

const chave = (a: string, i: string) => `${a}|${i}`.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();

/** Fotos por "ambiente|item" (pelo nome, para casar as duas vistorias). */
function fotosPorItem(ambientes: Ambiente[], midias: Midia[]) {
  const nome = new Map(ambientes.flatMap((a) => a.vistoria_itens.map((i) => [i.id, chave(a.nome, i.nome)] as const)));
  const mapa = new Map<string, Midia[]>();
  for (const m of midias) {
    const k = m.item_id ? nome.get(m.item_id) : undefined;
    if (k) mapa.set(k, [...(mapa.get(k) ?? []), m]);
  }
  return mapa;
}

function Estado({ e }: { e: string | null }) {
  return e ? <Selo cor={COR_ESTADO[e]}>{ROTULO_ESTADO[e]}</Selo> : <span className="text-mudo">—</span>;
}

export default async function ComparacaoVistoria({ params, searchParams }: PageProps<"/vistorias/[id]/comparacao">) {
  const { id } = await params;
  const sp = await searchParams;
  const tudo = sp.ver === "tudo";
  const { supabase } = await obterContexto();
  const v = await carregarVistoria(supabase, id);
  if (!v) notFound();
  const { data: outras } = await supabase.from("vistorias").select("id, numero, tipo, data, status").eq("imovel_id", v.imovel_id).neq("id", id).order("data", { ascending: false });
  const base = `/vistorias/${id}/comparacao`;

  const seletor = (
    <Formulario acao={atualizarVistoria} automatico className="space-y-3 [&>p]:hidden">
      <input type="hidden" name="id" value={id} />
      <Campo rotulo="Comparar com a vistoria" dica="Na saída, use a vistoria de entrada do mesmo contrato.">
        <Selecao name="referencia_id" defaultValue={v.referencia_id ?? ""}>
          <option value="">— nenhuma —</option>
          {(outras ?? []).map((o) => (
            <option key={o.id} value={o.id}>
              Nº {o.numero} · {ROTULO_TIPO_VISTORIA[o.tipo]} · {formatarDataBR(o.data)} ({ROTULO_STATUS_VISTORIA[o.status]})
            </option>
          ))}
        </Selecao>
      </Campo>
    </Formulario>
  );

  if (!v.referencia_id)
    return (
      <Cartao titulo="Comparação entre vistorias">
        <p className="mb-4 text-sm text-texto-2">
          Escolha a vistoria anterior do mesmo imóvel (normalmente a de entrada) para ver, item por item, o que piorou, o que ficou igual e o que melhorou.
        </p>
        <div className="max-w-xl">{seletor}</div>
      </Cartao>
    );

  const [antes, depois, midiasAntes, midiasDepois] = await Promise.all([
    carregarAmbientes(supabase, v.referencia_id),
    carregarAmbientes(supabase, id),
    carregarMidias(supabase, v.referencia_id),
    carregarMidias(supabase, id),
  ]);
  const r = compararVistorias(
    antes.map((a) => ({ nome: a.nome, itens: a.vistoria_itens })),
    depois.map((a) => ({ nome: a.nome, itens: a.vistoria_itens })),
  );
  const linhas = tudo ? r.linhas : r.linhas.filter((l) => l.situacao === "piorou");
  const fa = fotosPorItem(antes, midiasAntes);
  const fd = fotosPorItem(depois, midiasDepois);
  const caminhos = linhas.filter((l) => l.situacao === "piorou").flatMap((l) => [...(fa.get(chave(l.ambiente, l.item)) ?? []).slice(0, 2), ...(fd.get(chave(l.ambiente, l.item)) ?? []).slice(0, 2)].map((m) => m.path));
  const links = await linksAssinados(supabase, caminhos);
  const ref = (outras ?? []).find((o) => o.id === v.referencia_id);

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <div className="space-y-6">
          <div className="entrar-cascata grid grid-cols-2 gap-4 xl:grid-cols-4">
            <Indicador rotulo="Pioraram" icone={<ArrowDown />} valor={<Contador valor={r.contagem.piorou} formato="inteiro" />} tom={r.contagem.piorou ? "perigo" : "neutro"} />
            <Indicador rotulo="Iguais" icone={<Equal />} valor={<Contador valor={r.contagem.igual} formato="inteiro" />} />
            <Indicador rotulo="Melhoraram" icone={<ArrowUp />} valor={<Contador valor={r.contagem.melhorou} formato="inteiro" />} tom={r.contagem.melhorou ? "sucesso" : "neutro"} />
            <Indicador
              rotulo="Sem par ou sem nota"
              icone={<HelpCircle />}
              valor={<Contador valor={r.contagem.item_novo + r.contagem.nao_vistoriado + r.contagem.sem_avaliacao} formato="inteiro" />}
              tom={r.contagem.nao_vistoriado ? "alerta" : "neutro"}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <PilulasLink
              rotulo="O que mostrar"
              ativo={tudo ? `${base}?ver=tudo` : base}
              itens={[
                { href: base, rotulo: `Só o que piorou (${r.contagem.piorou})` },
                { href: `${base}?ver=tudo`, rotulo: `Todos os itens (${r.linhas.length})` },
              ]}
            />
            {r.contagem.piorou > 0 && (
              <BotaoAcao acao={gerarPendenciasDoQuePiorou} id={id} variante="primario" confirmar="Criar uma pendência (responsável: locatário) para cada item que piorou e ainda não tem pendência?">
                <ListPlus className="size-4" /> Criar pendências do que piorou
              </BotaoAcao>
            )}
          </div>

          <Tabela colunas={["Ambiente", "Item", `Antes (nº ${ref?.numero ?? "—"})`, "Agora", "Situação"]}>
            {linhas.map((l, i) => {
              const k = chave(l.ambiente, l.item);
              const ant = l.situacao === "piorou" ? (fa.get(k) ?? []).slice(0, 2) : [];
              const dep = l.situacao === "piorou" ? (fd.get(k) ?? []).slice(0, 2) : [];
              return (
                <tr key={i}>
                  <Celula className="text-texto-2">{l.ambiente}</Celula>
                  <Celula className="font-medium">{l.item}</Celula>
                  <Celula>
                    <Estado e={l.antes} />
                    {l.obsAntes && <span className="mt-1 block text-xs text-mudo">{l.obsAntes}</span>}
                    {ant.length > 0 && (
                      <span className="mt-2 flex gap-2">
                        {ant.map((m) => (
                          <Miniatura key={m.id} url={links[m.path]} tipo={m.tipo} legenda={m.legenda} className="size-16" />
                        ))}
                      </span>
                    )}
                  </Celula>
                  <Celula>
                    <Estado e={l.depois} />
                    {l.obsDepois && <span className="mt-1 block text-xs text-mudo">{l.obsDepois}</span>}
                    {dep.length > 0 && (
                      <span className="mt-2 flex gap-2">
                        {dep.map((m) => (
                          <Miniatura key={m.id} url={links[m.path]} tipo={m.tipo} legenda={m.legenda} className="size-16" />
                        ))}
                      </span>
                    )}
                  </Celula>
                  <Celula>
                    <Selo cor={COR_SITUACAO[l.situacao]}>{ROTULO_SITUACAO_COMPARACAO[l.situacao]}</Selo>
                  </Celula>
                </tr>
              );
            })}
            {linhas.length === 0 && <LinhaVazia colunas={5}>{tudo ? "Nenhum item para comparar." : "Nenhum item piorou."}</LinhaVazia>}
          </Tabela>
        </div>
        <div className="space-y-6">
          <Cartao titulo="Vistoria de referência">{seletor}</Cartao>
          <Cartao titulo="Como a comparação funciona">
            <p className="text-sm text-texto-2">
              Os itens são casados pelo nome do ambiente e do item (sem diferença de acento ou maiúsculas). A nota de cada estado vai de Novo (melhor) a Danificado (pior); “Não se aplica” e itens sem avaliação não entram na conta.
            </p>
          </Cartao>
        </div>
      </div>
    </>
  );
}
