import type { Metadata } from "next";
import Link from "next/link";
import { AlertTriangle, CheckCircle2, KeyRound, LogOut, Plus, Undo2 } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Cabecalho, Campo, Entrada, Indicador, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal, situacaoChave, sugerirCodigoChave } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { normalizar } from "@/lib/dominio/imoveis";
import { AbasAgenda } from "../agenda/campos";
import { cadastrarChave, devolverChave, excluirChave, retirarChave } from "./actions";
import { CamposChave, CamposRetirada } from "./campos";

export const metadata: Metadata = { title: "Chaves" };

type Mov = { id: string; retirada_por: string; motivo: string | null; retirada_em: string; previsao_devolucao: string | null; devolvida_em: string | null };
type Chave = {
  id: string;
  codigo: string | null;
  identificacao: string;
  local: string | null;
  quantidade: number;
  imovel: { id: string; codigo: string; logradouro: string | null; numero: string | null } | null;
  responsavel: { nome: string } | null;
  chave_movimentacoes: Mov[];
};

const FILTROS = { "": "Todas", disponiveis: "Disponíveis", retiradas: "Retiradas", atrasadas: "Atrasadas" } as const;
const quando = (iso: string) => `${formatarDataBR(diaLocal(iso))} ${horaLocal(iso)}`;

export default async function ChavesPage({ searchParams }: PageProps<"/chaves">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = (s("filtro") in FILTROS ? s("filtro") : "") as keyof typeof FILTROS;
  const busca = s("busca");
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const agora = new Date().toISOString();
  const [{ data: chavesRaw }, { data: imoveis }, { data: pessoas }] = await Promise.all([
    supabase
      .from("chaves")
      .select("*, imovel:imoveis(id, codigo, logradouro, numero), responsavel:pessoas!chaves_responsavel_id_fkey(nome), chave_movimentacoes(*)")
      .order("codigo"),
    supabase.from("imoveis").select("id, codigo").order("codigo"),
    supabase.from("pessoas").select("id, nome").order("nome").limit(2000),
  ]);
  const todas = ((chavesRaw ?? []) as unknown as Chave[]).map((c) => ({ ...c, ...situacaoChave(c.chave_movimentacoes, agora) }));
  const cont = {
    total: todas.length,
    disponiveis: todas.filter((c) => c.situacao === "disponivel").length,
    retiradas: todas.filter((c) => c.situacao !== "disponivel").length,
    atrasadas: todas.filter((c) => c.situacao === "atrasada").length,
  };
  let lista = todas;
  if (filtro === "disponiveis") lista = lista.filter((c) => c.situacao === "disponivel");
  if (filtro === "retiradas") lista = lista.filter((c) => c.situacao !== "disponivel");
  if (filtro === "atrasadas") lista = lista.filter((c) => c.situacao === "atrasada");
  if (busca) {
    const b = normalizar(busca);
    lista = lista.filter((c) => normalizar([c.codigo, c.identificacao, c.local, c.imovel?.codigo, c.imovel?.logradouro].join(" ")).includes(b));
  }
  const retirarId = s("retirar");
  const visitaId = s("visita") || null;
  const url = (f: string) => {
    const p = new URLSearchParams();
    if (f) p.set("filtro", f);
    if (busca) p.set("busca", busca);
    return p.toString() ? `/chaves?${p}` : "/chaves";
  };

  return (
    <>
      <Cabecalho
        titulo="Chaves"
        trilha="Agenda"
        descricao="Cada chave com código, onde fica, quem está com ela e até quando. Retiradas vencidas aparecem em vermelho."
        acoes={
          <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova chave</>} titulo="Nova chave" acao={cadastrarChave} icone={<KeyRound />}>
            <CamposChave imoveis={imoveis ?? []} pessoas={pessoas ?? []} codigo={sugerirCodigoChave(todas.map((c) => c.codigo))} />
          </JanelaCadastro>
        }
      />
      <AbasAgenda />

      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Chaves" icone={<KeyRound />} valor={<Contador valor={cont.total} />} detalhe="cadastradas" />
        <Indicador rotulo="No lugar" icone={<CheckCircle2 />} valor={<Contador valor={cont.disponiveis} />} detalhe="disponíveis" tom="sucesso" href={url("disponiveis")} />
        <Indicador rotulo="Retiradas" icone={<LogOut />} valor={<Contador valor={cont.retiradas} />} detalhe="fora do escritório" href={url("retiradas")} />
        <Indicador rotulo="Não devolvidas" icone={<AlertTriangle />} valor={<Contador valor={cont.atrasadas} />} detalhe="passou do prazo" tom={cont.atrasadas ? "perigo" : "sucesso"} href={url("atrasadas")} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Situação" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="flex flex-wrap gap-2">
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          <Entrada name="busca" defaultValue={busca} placeholder="Buscar código, imóvel, local…" className="max-w-72" />
        </FiltroAutomatico>
      </div>

      <section className="entrar overflow-hidden rounded-card border border-borda bg-card">
        <div className="divide-y divide-borda-suave">
          {lista.map((c) => (
            <div key={c.id} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-3.5">
              <div className="w-56 min-w-0">
                <Link href={`/chaves/${c.id}`} className="font-semibold text-texto hover:underline">
                  {c.codigo} · {c.identificacao}
                </Link>
                <div className="truncate text-xs text-mudo">
                  {c.quantidade > 1 ? `${c.quantidade} chaves · ` : ""}
                  {c.local ?? "sem local"}
                  {c.responsavel ? ` · guarda: ${c.responsavel.nome}` : ""}
                </div>
              </div>
              <div className="w-40 min-w-0">
                {c.imovel ? (
                  <Link href={`/imoveis/${c.imovel.id}`} className="font-medium text-acento hover:underline">
                    {c.imovel.codigo}
                  </Link>
                ) : (
                  "—"
                )}
                <div className="truncate text-xs text-mudo">{[c.imovel?.logradouro, c.imovel?.numero].filter(Boolean).join(", ")}</div>
              </div>
              <div className="min-w-0 flex-1">
                {c.situacao === "disponivel" ? (
                  <Selo cor="verde">no lugar</Selo>
                ) : (
                  <>
                    <Selo cor={c.situacao === "atrasada" ? "vermelho" : "amarelo"}>{c.situacao === "atrasada" ? "não devolvida" : "retirada"}</Selo>
                    <div className="mt-1 text-xs text-texto-2">
                      com <strong className="text-texto">{c.aberta!.retirada_por}</strong> desde {quando(c.aberta!.retirada_em)}
                      {c.aberta!.previsao_devolucao ? ` · devolve até ${quando(c.aberta!.previsao_devolucao)}` : ""}
                      {c.aberta!.motivo ? ` · ${c.aberta!.motivo}` : ""}
                    </div>
                  </>
                )}
              </div>
              <div className="flex items-center gap-2">
                {c.situacao === "disponivel" ? (
                  <JanelaCadastro
                    rotuloBotao={<><LogOut className="size-4" /> Retirar</>}
                    variante="secundario"
                    titulo={`Retirar ${c.codigo}`}
                    acao={retirarChave}
                    rotuloSalvar="Registrar retirada"
                    icone={<LogOut />}
                    abertaInicial={retirarId === c.id}
                  >
                    <CamposRetirada chaveId={c.id} pessoas={pessoas ?? []} visitaId={retirarId === c.id ? visitaId : null} hoje={hoje} />
                  </JanelaCadastro>
                ) : (
                  <JanelaCadastro rotuloBotao={<><Undo2 className="size-4" /> Devolver</>} titulo={`Devolver ${c.codigo}`} acao={devolverChave} rotuloSalvar="Registrar devolução" icone={<Undo2 />}>
                    <input type="hidden" name="mov_id" value={c.aberta!.id} />
                    <p className="text-sm text-texto-2">
                      Devolvida por <strong>{c.aberta!.retirada_por}</strong> agora.
                    </p>
                    <Campo rotulo="Observação (opcional)">
                      <AreaTexto name="observacao_devolucao" rows={2} placeholder="Faltou uma chave, devolveu com o porteiro…" />
                    </Campo>
                  </JanelaCadastro>
                )}
                <BotaoExcluir acao={excluirChave} id={c.id} rotulo={`Excluir ${c.codigo}`} confirmar={`Excluir a chave ${c.codigo} e todo o histórico dela?`} />
              </div>
            </div>
          ))}
          {lista.length === 0 && <p className="px-5 py-6 text-sm text-mudo">{todas.length ? "Nenhuma chave neste filtro." : "Nenhuma chave cadastrada. Use “Nova chave”."}</p>}
        </div>
      </section>
    </>
  );
}
