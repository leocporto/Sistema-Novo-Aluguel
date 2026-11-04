import type { Metadata } from "next";
import { AlertTriangle, Hammer, User, Wrench } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import { ROTULO_STATUS_PENDENCIA, ROTULO_TIPO_VISTORIA, responsaveisDoModo, totaisReparos, valorPendencia } from "@/lib/dominio/vistorias";
import { AbasVistorias } from "../campos";

export const metadata: Metadata = { title: "Danos e reparos" };

const FILTROS: Record<string, { rotulo: string; status: string[] | null }> = {
  "": { rotulo: "Em aberto", status: ["aberta", "em_reparo"] },
  resolvidas: { rotulo: "Resolvidas", status: ["resolvida"] },
  todas: { rotulo: "Todas", status: null },
};
const COR: Record<string, "vermelho" | "amarelo" | "verde" | "cinza"> = { aberta: "vermelho", em_reparo: "amarelo", resolvida: "verde", cancelada: "cinza" };

type P = {
  id: string;
  descricao: string;
  responsavel: string;
  status: string;
  prazo: string | null;
  valor_estimado: number | null;
  vistoria: { id: string; numero: number; tipo: string; imovel: { codigo: string } | null } | null;
  vistoria_orcamentos: { valor: number; aprovado: boolean }[];
};

/** Todos os danos e pendências de reparo das vistorias. */
export default async function PendenciasGerais({ searchParams }: PageProps<"/vistorias/pendencias">) {
  const sp = await searchParams;
  const situacao = typeof sp.situacao === "string" && FILTROS[sp.situacao] ? sp.situacao : "";
  const responsavel = typeof sp.responsavel === "string" ? sp.responsavel : "";
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();
  let q = supabase
    .from("vistoria_pendencias")
    .select("id, descricao, responsavel, status, prazo, valor_estimado, vistoria:vistorias(id, numero, tipo, imovel:imoveis(codigo)), vistoria_orcamentos(valor, aprovado)")
    .order("prazo", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(1000);
  const st = FILTROS[situacao].status;
  if (st) q = q.in("status", st);
  if (responsavel) q = q.eq("responsavel", responsavel);
  const { data } = await q;
  const lista = (data ?? []) as unknown as P[];
  const t = totaisReparos(lista.map((p) => ({ ...p, orcamentos: p.vistoria_orcamentos })));
  const atrasadas = lista.filter((p) => p.prazo && p.prazo < hoje && (p.status === "aberta" || p.status === "em_reparo")).length;
  const responsaveis = responsaveisDoModo(pessoal);
  const rotulo = Object.fromEntries(responsaveis.map((r) => [r.valor, r.rotulo]));
  const url = (s: string) => {
    const p = new URLSearchParams();
    if (s) p.set("situacao", s);
    if (responsavel) p.set("responsavel", responsavel);
    const x = p.toString();
    return x ? `/vistorias/pendencias?${x}` : "/vistorias/pendencias";
  };

  return (
    <>
      <Cabecalho titulo="Danos e reparos" trilha="Vistorias" descricao="Tudo o que as vistorias apontaram para consertar, com responsável, prazo e orçamento." />
      <AbasVistorias />
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Pendências na lista" icone={<Wrench />} valor={<Contador valor={lista.length} formato="inteiro" />} detalhe={`${t.abertas} em aberto`} />
        <Indicador rotulo="Com prazo vencido" icone={<AlertTriangle />} valor={<Contador valor={atrasadas} formato="inteiro" />} tom={atrasadas ? "perigo" : "neutro"} detalhe="abertas ou em reparo" />
        <Indicador rotulo="Do locatário" icone={<User />} valor={<Contador valor={paraReais(t.porResponsavel.locatario)} formato="moeda" />} detalhe="cobrado no acerto de saída" />
        <Indicador rotulo={pessoal ? "Por minha conta" : "Do proprietário"} icone={<Hammer />} valor={<Contador valor={paraReais(t.porResponsavel.proprietario)} formato="moeda" />} detalhe="manutenção do imóvel" />
      </div>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Situação" ativo={url(situacao)} itens={Object.entries(FILTROS).map(([k, f]) => ({ href: url(k), rotulo: f.rotulo }))} />
        <FiltroAutomatico className="filtros-linha">
          {situacao && <input type="hidden" name="situacao" value={situacao} />}
          <Selecao name="responsavel" aria-label="Filtrar por responsável" defaultValue={responsavel} className="w-60">
            <option value="">Todos os responsáveis</option>
            {responsaveis.map((r) => (
              <option key={r.valor} value={r.valor}>
                {r.rotulo}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
      </div>
      <Tabela colunas={["Pendência", "Imóvel", "Vistoria", "Responsável", "Prazo", "Valor", "Situação"]}>
        {lista.map((p) => (
          <LinhaLink key={p.id} href={p.vistoria ? `/vistorias/${p.vistoria.id}/pendencias` : "/vistorias"}>
            <Celula className="font-medium">{p.descricao}</Celula>
            <Celula>{p.vistoria?.imovel?.codigo ?? "—"}</Celula>
            <Celula className="text-texto-2">{p.vistoria ? `${ROTULO_TIPO_VISTORIA[p.vistoria.tipo]} nº ${p.vistoria.numero}` : "—"}</Celula>
            <Celula className="text-texto-2">{rotulo[p.responsavel] ?? p.responsavel}</Celula>
            <Celula className={`tabular-nums ${p.prazo && p.prazo < hoje && p.status !== "resolvida" ? "font-semibold text-ruim" : ""}`}>{formatarDataBR(p.prazo)}</Celula>
            <Celula className="tabular-nums">{formatarReais(paraReais(valorPendencia({ ...p, orcamentos: p.vistoria_orcamentos })))}</Celula>
            <Celula>
              <Selo cor={COR[p.status]}>{ROTULO_STATUS_PENDENCIA[p.status]}</Selo>
            </Celula>
          </LinhaLink>
        ))}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhuma pendência aqui.</LinhaVazia>}
      </Tabela>
    </>
  );
}
