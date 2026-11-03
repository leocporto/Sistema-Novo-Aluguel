import type { Metadata } from "next";
import { ClipboardCheck, ClipboardList, FileSignature, MessageSquareWarning, Smartphone } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { fimDoMes, formatarDataBR, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { normalizar } from "@/lib/dominio/imoveis";
import { COR_STATUS_VISTORIA, ROTULO_STATUS_VISTORIA, ROTULO_TIPO_VISTORIA, progressoVistoria } from "@/lib/dominio/vistorias";
import { criarVistoria } from "./actions";
import { AbasVistorias, CamposNovaVistoria } from "./campos";
import { carregarOpcoesVistoria, quemFez, type Vistoria } from "./dados";
import { HistoricoVistoriasImovel } from "./historico-imovel";

export const metadata: Metadata = { title: "Vistorias" };

const FILTROS: Record<string, { rotulo: string; status: string[] | null }> = {
  "": { rotulo: "Todas", status: null },
  abertas: { rotulo: "Em aberto", status: ["rascunho", "em_andamento"] },
  concluidas: { rotulo: "Sem assinatura", status: ["concluida"] },
  assinadas: { rotulo: "Assinadas", status: ["assinada"] },
  contestadas: { rotulo: "Contestadas", status: ["contestada"] },
};

export default async function VistoriasPage({ searchParams }: PageProps<"/vistorias">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f = { situacao: FILTROS[s("situacao")] ? s("situacao") : "", tipo: s("tipo"), imovel: s("imovel"), contrato: s("contrato"), busca: s("busca") };
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  const ini = inicioDoMes(hoje);

  let q = supabase
    .from("vistorias")
    .select("*, imovel:imoveis(id, codigo, logradouro, numero), contrato:contratos(id, numero), responsavel:pessoas(id, nome), vistoria_itens(estado)")
    .order("data", { ascending: false })
    .order("numero", { ascending: false })
    .limit(400);
  const filtro = FILTROS[f.situacao];
  if (filtro.status) q = q.in("status", filtro.status);
  if (f.tipo) q = q.eq("tipo", f.tipo);
  if (f.imovel) q = q.eq("imovel_id", f.imovel);
  if (f.contrato) q = q.eq("contrato_id", f.contrato);

  const [{ data }, opcoes, { data: todas }, { count: contestacoes }] = await Promise.all([
    q,
    carregarOpcoesVistoria(supabase, pessoal, [f.imovel, s("imovel_novo")]),
    supabase.from("vistorias").select("status, concluida_em").limit(5000),
    supabase.from("vistoria_contestacoes").select("id", { count: "exact", head: true }).eq("status", "aberta"),
  ]);
  type V = Vistoria & { vistoria_itens: { estado: string | null }[] };
  let vistorias = (data ?? []) as unknown as V[];
  if (f.busca) {
    const b = normalizar(f.busca);
    vistorias = vistorias.filter((v) => normalizar([v.imovel?.codigo, v.imovel?.logradouro, quemFez(v), String(v.numero), v.acompanhante].join(" ")).includes(b));
  }
  const lista = (todas ?? []) as { status: string; concluida_em: string | null }[];
  const abertas = lista.filter((v) => v.status === "rascunho" || v.status === "em_andamento").length;
  // Dia da conclusão no horário de Brasília (o banco guarda em UTC: depois das 21h já seria o dia seguinte).
  const noMes = lista.filter((v) => {
    if (!v.concluida_em) return false;
    const dia = hojeISO(new Date(v.concluida_em));
    return dia >= ini && dia <= fimDoMes(hoje);
  }).length;
  const semAssinatura = lista.filter((v) => v.status === "concluida").length;

  const url = (situacao: string) => {
    const p = new URLSearchParams();
    if (situacao) p.set("situacao", situacao);
    for (const k of ["tipo", "imovel", "contrato", "busca"] as const) if (f[k]) p.set(k, f[k]);
    const t = p.toString();
    return t ? `/vistorias?${t}` : "/vistorias";
  };

  return (
    <>
      <Cabecalho
        titulo="Vistorias"
        trilha="Agenda"
        descricao={
          pessoal
            ? "Vistoria de entrada, saída e periódica dos seus imóveis: checklist por ambiente, fotos, medidores, comparação e laudo para o inquilino assinar."
            : "Vistoria de entrada, saída e periódica: checklist por ambiente, fotos e vídeos, medidores, danos e orçamentos, laudo com assinatura eletrônica e contestação do locatário."
        }
        acoes={
          <>
            <BotaoLink href="/vistorias/campo" variante="secundario">
              <Smartphone className="size-4" /> App de campo
            </BotaoLink>
            <JanelaCadastro
              rotuloBotao={<><ClipboardCheck className="size-4" /> Nova vistoria</>}
              titulo="Nova vistoria"
              acao={criarVistoria}
              icone={<ClipboardCheck />}
              larguraMax="max-w-2xl"
              abertaInicial={s("novo") === "1"}
            >
              <CamposNovaVistoria opcoes={opcoes} pessoal={pessoal} hoje={hoje} padrao={{ tipo: s("tipo_novo") || undefined, imovelId: s("imovel_novo") || undefined, contratoId: s("contrato_novo") || undefined }} />
            </JanelaCadastro>
          </>
        }
      />
      <AbasVistorias />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Em aberto" icone={<ClipboardList />} valor={<Contador valor={abertas} formato="inteiro" />} detalhe="agendadas ou em andamento" href="/vistorias?situacao=abertas" />
        <Indicador rotulo="Concluídas no mês" icone={<ClipboardCheck />} valor={<Contador valor={noMes} formato="inteiro" />} detalhe="laudos fechados este mês" tom={noMes ? "sucesso" : "neutro"} />
        <Indicador rotulo="Sem assinatura" icone={<FileSignature />} valor={<Contador valor={semAssinatura} formato="inteiro" />} detalhe="concluídas esperando o laudo assinado" tom={semAssinatura ? "alerta" : "neutro"} href="/vistorias?situacao=concluidas" />
        <Indicador
          rotulo="Contestações a responder"
          icone={<MessageSquareWarning />}
          valor={<Contador valor={contestacoes ?? 0} formato="inteiro" />}
          detalhe="do locatário, pelo link ou à mão"
          tom={contestacoes ? "perigo" : "neutro"}
          href="/vistorias?situacao=contestadas"
        />
      </div>

      {f.imovel && <HistoricoVistoriasImovel imovelId={f.imovel} className="mb-6" />}

      <PilulasLink className="mb-4" rotulo="Situação" ativo={url(f.situacao)} itens={Object.entries(FILTROS).map(([k, v]) => ({ href: url(k), rotulo: v.rotulo }))} />
      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        {f.situacao && <input type="hidden" name="situacao" value={f.situacao} />}
        <Entrada name="busca" aria-label="Buscar vistorias" defaultValue={f.busca} placeholder="Buscar imóvel, nº, vistoriador…" className="max-w-72" />
        <Selecao name="tipo" aria-label="Filtrar por tipo" defaultValue={f.tipo} className="w-44">
          <option value="">Todos os tipos</option>
          {Object.entries(ROTULO_TIPO_VISTORIA).map(([k, r]) => (
            <option key={k} value={k}>
              {r}
            </option>
          ))}
        </Selecao>
        <Selecao name="imovel" aria-label="Filtrar por imóvel (histórico)" defaultValue={f.imovel} className="w-56">
          <option value="">Todos os imóveis</option>
          {opcoes.imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.codigo}
            </option>
          ))}
        </Selecao>
        {f.contrato && <input type="hidden" name="contrato" value={f.contrato} />}
      </FiltroAutomatico>

      <Tabela colunas={["Nº", "Tipo", "Imóvel", "Contrato", "Data", pessoal ? "Feita por" : "Vistoriador", "Checklist", "Situação"]}>
        {vistorias.map((v) => {
          const p = progressoVistoria(v.vistoria_itens);
          return (
            <LinhaLink key={v.id} href={`/vistorias/${v.id}`}>
              <Celula className="font-mono text-xs text-mudo">#{v.numero}</Celula>
              <Celula>{ROTULO_TIPO_VISTORIA[v.tipo]}</Celula>
              <Celula>
                <span className="font-medium">{v.imovel?.codigo ?? "—"}</span>
                <span className="block text-xs text-mudo">{[v.imovel?.logradouro, v.imovel?.numero].filter(Boolean).join(", ")}</span>
              </Celula>
              <Celula className="text-texto-2">{v.contrato ? `Nº ${v.contrato.numero}` : "—"}</Celula>
              <Celula className="tabular-nums">{formatarDataBR(v.data)}</Celula>
              <Celula className="text-texto-2">{quemFez(v) ?? "—"}</Celula>
              <Celula>
                <span className="tabular-nums">
                  {p.avaliados}/{p.total}
                </span>
                {p.danos > 0 && <span className="ml-2 text-xs font-semibold text-ruim">{p.danos} com dano</span>}
              </Celula>
              <Celula>
                <Selo cor={COR_STATUS_VISTORIA[v.status]}>{ROTULO_STATUS_VISTORIA[v.status]}</Selo>
              </Celula>
            </LinhaLink>
          );
        })}
        {vistorias.length === 0 && <LinhaVazia colunas={8}>Nenhuma vistoria por aqui. Use “Nova vistoria” para começar.</LinhaVazia>}
      </Tabela>
    </>
  );
}
