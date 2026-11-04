import type { Metadata } from "next";
import Link from "next/link";
import { Ruler, Scale, TrendingUp } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Campo, Cartao, Celula, Entrada, Indicador, Selecao, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { explicarPreco, type ResultadoPreco } from "@/lib/dominio/ia";
import { pode } from "@/lib/permissoes";
import { AbasInteligencia } from "../abas";
import { sugerirAcao } from "../actions";
import { estadoIA, exigirOuVoltar } from "../dados";
import { ExplicarPrecoIA } from "./explicar";

export const metadata: Metadata = { title: "Preço por comparáveis" };

/**
 * Sugestão de preço (aluguel e venda) pela mediana do R$/m² dos imóveis
 * parecidos da própria carteira — conta feita no banco (public.ia_preco_comparaveis).
 * Mudar o preço vira ação para aprovar. Nos dois modos.
 */
export default async function PrecoPage({ searchParams }: PageProps<"/inteligencia/preco">) {
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  await exigirOuVoltar("imoveis", "ver");
  const finalidade = sp.f === "venda" ? "venda" : "locacao";
  const id = typeof sp.imovel === "string" ? sp.imovel : "";
  const [ia, { data }, podeSugerir] = await Promise.all([
    estadoIA(supabase),
    supabase.from("imoveis").select("id, codigo, tipo, bairro").neq("status", "inativo").order("codigo").limit(500),
    pode("imoveis", "ver"),
  ]);
  const imoveis = (data ?? []) as { id: string; codigo: string; tipo: string | null; bairro: string | null }[];
  const atual = imoveis.find((i) => i.id === id);
  let r: ResultadoPreco | null = null;
  let erro: string | null = null;
  if (atual) {
    const resp = await supabase.rpc("ia_preco_comparaveis", { p_imovel: atual.id, p_finalidade: finalidade });
    if (resp.error) erro = resp.error.message;
    else r = resp.data as ResultadoPreco;
  }
  const campo = finalidade === "venda" ? "valor_venda" : "valor_aluguel";
  const base = `/inteligencia/preco?imovel=${id}`;
  return (
    <>
      <Cabecalho
        titulo="Preço por comparáveis"
        trilha="Assistente e automações"
        descricao="Compara com imóveis da sua carteira do mesmo tipo e cidade (primeiro o mesmo bairro), área de 70% a 130% e quartos parecidos. O aluguel dos alugados vem do contrato ativo. A IA só escreve a explicação; os números são do sistema."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <FiltroAutomatico className="flex flex-wrap gap-2">
          <input type="hidden" name="f" value={finalidade} />
          <Selecao name="imovel" defaultValue={id} aria-label="Escolha o imóvel" className="max-w-xl">
            <option value="">Escolha o imóvel…</option>
            {imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo} — {i.tipo ?? "imóvel"}
                {i.bairro ? `, ${i.bairro}` : ""}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
        <PilulasLink
          rotulo="Aluguel ou venda"
          ativo={`${base}&f=${finalidade}`}
          itens={[
            { href: `${base}&f=locacao`, rotulo: "Aluguel" },
            { href: `${base}&f=venda`, rotulo: "Venda" },
          ]}
        />
      </div>
      {!atual ? (
        <Aviso>Escolha um imóvel para ver a faixa de preço.</Aviso>
      ) : erro ? (
        <Aviso tipo="erro">{erro}</Aviso>
      ) : r && (r.erro || !r.sugerido) ? (
        <Aviso tipo="alerta">{explicarPreco(r)}</Aviso>
      ) : r ? (
        <div className="space-y-5">
          <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Indicador rotulo="Preço sugerido (mediana)" valor={<Contador valor={Number(r.sugerido ?? 0)} formato="moeda" />} icone={<Scale />} detalhe={`${r.amostra} comparável(is) ${r.nivel === "bairro" ? "no bairro" : "na cidade"}`} />
            <Indicador rotulo="Faixa (metade do meio)" valor={
                <span className="text-[22px]">
                  <Contador valor={Number(r.faixa_min ?? 0)} formato="moeda" /> – <Contador valor={Number(r.faixa_max ?? 0)} formato="moeda" />
                </span>
              } icone={<TrendingUp />} />
            <Indicador rotulo="R$/m² mediano" valor={<Contador valor={Number(r.mediana_m2 ?? 0)} formato="moeda" />} icone={<Ruler />} detalhe={`${r.area} m² · preço atual ${r.valor_atual ? formatarReais(r.valor_atual) : "não informado"}`} />
          </div>
          <Cartao
            titulo="Por que esse preço"
            acoes={
              podeSugerir ? (
                <JanelaCadastro rotuloBotao="Sugerir novo preço" titulo="Sugerir novo preço (vai para aprovação)" acao={sugerirAcao} variante="secundario" rotuloSalvar="Enviar para aprovação">
                  <input type="hidden" name="tipo" value="alterar_preco" />
                  <input type="hidden" name="origem" value="usuario" />
                  <input type="hidden" name="imovel_id" value={atual.id} />
                  <input type="hidden" name="campo" value={campo} />
                  <input type="hidden" name="titulo" value={`${finalidade === "venda" ? "Preço de venda" : "Aluguel"} do imóvel ${atual.codigo}`} />
                  <input type="hidden" name="descricao" value={explicarPreco(r)} />
                  <Campo rotulo={finalidade === "venda" ? "Novo preço de venda (R$)" : "Novo aluguel (R$)"} dica="O preço só muda depois que alguém com permissão aprovar.">
                    <Entrada name="valor" required inputMode="decimal" defaultValue={String(r.sugerido ?? "").replace(".", ",")} />
                  </Campo>
                </JanelaCadastro>
              ) : undefined
            }
          >
            <p className="text-[14px] leading-relaxed text-texto">{explicarPreco(r)}</p>
            {ia.disponivel && (
              <div className="mt-4">
                <ExplicarPrecoIA imovelId={atual.id} finalidade={finalidade} />
              </div>
            )}
          </Cartao>
          <Tabela colunas={["Imóvel", "Bairro", "Área", "Quartos", finalidade === "venda" ? "Venda" : "Aluguel", "R$/m²"]}>
            {(r.comparaveis ?? []).map((c) => (
              <tr key={c.id}>
                <Celula className="font-semibold">
                  <Link href={`/imoveis/${c.id}`} className="hover:text-acento">
                    {c.codigo}
                  </Link>
                </Celula>
                <Celula>{c.bairro ?? "—"}</Celula>
                <Celula className="tabular-nums">{c.area} m²</Celula>
                <Celula className="tabular-nums">{c.quartos ?? "—"}</Celula>
                <Celula className="tabular-nums">{formatarReais(c.valor)}</Celula>
                <Celula className="tabular-nums">{formatarReais(c.m2)}</Celula>
              </tr>
            ))}
          </Tabela>
        </div>
      ) : null}
    </>
  );
}
