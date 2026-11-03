import type { Metadata } from "next";
import Link from "next/link";
import { CircleDollarSign, Hammer, ShieldCheck } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { BotaoImprimir } from "@/components/formulario";
import { LinhaLink } from "@/components/linha-link";
import { Cabecalho, Celula, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { COR_STATUS_CHAMADO, ROTULO_CATEGORIA_CURTO, ROTULO_GARANTIA, ROTULO_STATUS_CHAMADO, resumoPorImovel, situacaoGarantia } from "@/lib/dominio/manutencao";
import { todas } from "../../financeiro/dados";
import { AbasManutencao } from "../abas";
import { SELECT_LISTA, enderecoImovel, type ChamadoLista } from "../dados";

export const metadata: Metadata = { title: "Histórico de reparos por imóvel" };

const COR_GARANTIA = { sem: "cinza", ativa: "verde", vencendo: "amarelo", vencida: "cinza" } as const;

export default async function HistoricoReparos({ searchParams }: PageProps<"/manutencao/historico">) {
  const sp = await searchParams;
  const imovelId = typeof sp.imovel === "string" ? sp.imovel : "";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data: imoveis }, chamados] = await Promise.all([
    supabase.from("imoveis").select("id, codigo, logradouro, numero, complemento, bairro, cidade, uf").order("codigo").limit(3000),
    imovelId
      ? todas<ChamadoLista>(() => supabase.from("chamados").select(SELECT_LISTA).eq("imovel_id", imovelId).order("created_at", { ascending: false }).order("id"))
      : todas<ChamadoLista>(() => supabase.from("chamados").select("imovel_id, status, valor_final, concluido_em, garantia_ate, created_at").order("id")),
  ]);
  type Im = { id: string; codigo: string; logradouro: string | null; numero: string | null; complemento: string | null; bairro: string | null; cidade: string | null; uf: string | null };
  const lista = (imoveis ?? []) as Im[];
  const imovel = lista.find((i) => i.id === imovelId) ?? null;
  const resumo = resumoPorImovel(chamados, hoje);

  return (
    <>
      <Cabecalho
        titulo="Histórico de reparos"
        trilha="Manutenção"
        descricao="Tudo o que já foi consertado em cada imóvel: quando, quem fez, quanto custou e até quando vale a garantia."
        acoes={imovel ? <BotaoImprimir /> : undefined}
      />
      <div className="nao-imprimir">
        <AbasManutencao />
        <FiltroAutomatico className="mb-5 flex flex-wrap gap-2">
          <Selecao name="imovel" aria-label="Escolher o imóvel" defaultValue={imovelId} className="w-80">
            <option value="">Todos os imóveis (resumo)</option>
            {lista.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo}
                {i.logradouro ? ` · ${[i.logradouro, i.numero].filter(Boolean).join(", ")}` : ""}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
      </div>

      {imovel ? (
        <>
          <h2 className="mb-3 text-[17px] font-semibold text-texto">
            <Link href={`/imoveis/${imovel.id}`} className="hover:underline">
              {imovel.codigo}
            </Link>{" "}
            <span className="text-sm font-normal text-texto-2">{enderecoImovel(imovel)}</span>
          </h2>
          <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Indicador rotulo="Chamados" icone={<Hammer />} valor={<Contador valor={chamados.length} />} detalhe={`${resumo.get(imovel.id)?.abertos ?? 0} em andamento`} />
            <Indicador rotulo="Gasto com reparos" icone={<CircleDollarSign />} valor={<Contador valor={resumo.get(imovel.id)?.gasto ?? 0} formato="moeda" />} detalhe="soma dos serviços concluídos" />
            <Indicador rotulo="Garantias valendo" icone={<ShieldCheck />} valor={<Contador valor={resumo.get(imovel.id)?.garantias ?? 0} />} tom={(resumo.get(imovel.id)?.garantias ?? 0) ? "sucesso" : "neutro"} />
          </div>
          <Tabela colunas={["Data", "Nº", "Reparo", "Prestador", "Valor", "Garantia", "Situação"]}>
            {chamados.map((c) => {
              const g = situacaoGarantia(c.garantia_ate, hoje);
              return (
                <LinhaLink key={c.id} href={`/manutencao/${c.id}`}>
                  <Celula className="text-sm text-texto-2">{formatarDataBR(c.concluido_em ?? c.created_at.slice(0, 10))}</Celula>
                  <Celula className="tabular-nums text-mudo">#{c.numero}</Celula>
                  <Celula>
                    <span className="font-medium text-texto">{c.titulo}</span>
                    <span className="block text-xs text-mudo">{ROTULO_CATEGORIA_CURTO[c.categoria] ?? c.categoria}</span>
                  </Celula>
                  <Celula className="text-sm text-texto-2">{c.prestador?.nome ?? "—"}</Celula>
                  <Celula className="tabular-nums">{c.valor_final != null ? formatarReais(c.valor_final) : "—"}</Celula>
                  <Celula>
                    {g === "sem" ? <span className="text-sm text-mudo">—</span> : <Selo cor={COR_GARANTIA[g]}>{`${ROTULO_GARANTIA[g]} · ${formatarDataBR(c.garantia_ate)}`}</Selo>}
                  </Celula>
                  <Celula>
                    <Selo cor={COR_STATUS_CHAMADO[c.status as keyof typeof COR_STATUS_CHAMADO] ?? "cinza"}>{ROTULO_STATUS_CHAMADO[c.status]}</Selo>
                  </Celula>
                </LinhaLink>
              );
            })}
            {chamados.length === 0 && <LinhaVazia colunas={7}>Nenhum reparo registrado neste imóvel.</LinhaVazia>}
          </Tabela>
        </>
      ) : (
        <Tabela colunas={["Imóvel", "Chamados", "Em andamento", "Gasto com reparos", "Último reparo", "Garantias valendo"]}>
          {lista
            .filter((i) => resumo.has(i.id))
            .sort((a, b) => paraCentavos(resumo.get(b.id)!.gasto) - paraCentavos(resumo.get(a.id)!.gasto))
            .map((i) => {
              const r = resumo.get(i.id)!;
              return (
                <LinhaLink key={i.id} href={`/manutencao/historico?imovel=${i.id}`}>
                  <Celula>
                    <span className="font-medium text-texto">{i.codigo}</span>
                    <span className="block text-xs text-mudo">{enderecoImovel(i)}</span>
                  </Celula>
                  <Celula className="tabular-nums">{r.chamados}</Celula>
                  <Celula className="tabular-nums">{r.abertos || "—"}</Celula>
                  <Celula className="tabular-nums">{formatarReais(r.gasto)}</Celula>
                  <Celula className="text-sm text-texto-2">{formatarDataBR(r.ultimo)}</Celula>
                  <Celula className="tabular-nums">{r.garantias || "—"}</Celula>
                </LinhaLink>
              );
            })}
          {resumo.size === 0 && <LinhaVazia colunas={6}>Nenhum chamado de manutenção ainda.</LinhaVazia>}
        </Tabela>
      )}
      {!imovel && resumo.size > 0 && (
        <p className="mt-3 text-right text-sm text-texto-2">
          Total gasto com reparos: <b>{formatarReais(paraReais([...resumo.values()].reduce((a, r) => a + paraCentavos(r.gasto), 0)))}</b>
        </p>
      )}
    </>
  );
}
