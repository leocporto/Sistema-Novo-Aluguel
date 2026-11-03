import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Layers, Plus } from "lucide-react";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { BotaoLink, Cabecalho, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_STATUS_IMOVEL, TIPOS_IMOVEL } from "@/lib/tipos";
import { atualizarEmpreendimento, excluirEmpreendimento, gerarUnidadesEmpreendimento } from "../actions";
import { CamposEmpreendimento, type Empreendimento } from "../campos";

export const metadata: Metadata = { title: "Empreendimento" };

const COR = { disponivel: "vermelho", alugado: "verde", reservado: "amarelo", vendido: "cinza", inativo: "cinza" } as const;

export default async function EmpreendimentoPage({ params }: PageProps<"/empreendimentos/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [{ data }, { data: unidades }] = await Promise.all([
    supabase.from("empreendimentos").select("*").eq("id", id).maybeSingle(),
    supabase.from("imoveis").select("id, codigo, bloco, unidade, tipo, quartos, valor_aluguel, valor_venda, status").eq("empreendimento_id", id).order("bloco").order("codigo"),
  ]);
  if (!data) notFound();
  const e = data as Empreendimento;
  type U = { id: string; codigo: string; bloco: string | null; unidade: string | null; tipo: string; quartos: number | null; valor_aluguel: number | null; valor_venda: number | null; status: string };
  const lista = (unidades ?? []) as U[];
  const prefixo = e.nome
    .normalize("NFD")
    .replace(/[^\w\s]/g, "")
    .split(/\s+/)
    .filter((p) => p.length > 2)
    .map((p) => p[0])
    .join("")
    .toUpperCase()
    .slice(0, 4);

  return (
    <>
      <Cabecalho
        titulo={e.nome}
        trilha="Empreendimentos"
        descricao={`${lista.length} unidade(s) · ${lista.filter((u) => u.status === "disponivel").length} disponível(is)`}
        acoes={
          <>
            <JanelaCadastro
              rotuloBotao={<><Layers className="size-4" /> Gerar unidades</>}
              titulo="Gerar unidades em massa"
              acao={gerarUnidadesEmpreendimento}
              rotuloSalvar="Gerar unidades"
              icone={<Layers />}
              larguraMax="max-w-2xl"
            >
              <input type="hidden" name="id" value={id} />
              <p className="text-sm text-texto-2">
                Ex.: blocos <strong>A, B</strong>, andares <strong>1 a 10</strong>, <strong>4</strong> por andar → cria {prefixo || "ED"}-A-101 até {prefixo || "ED"}-B-1004 (80 unidades). Códigos que já existem são pulados.
              </p>
              <div className="grid gap-4 sm:grid-cols-4">
                <Campo rotulo="Prefixo do código">
                  <Entrada name="prefixo" required defaultValue={prefixo || "ED"} />
                </Campo>
                <Campo rotulo="Blocos (vírgula)">
                  <Entrada name="blocos" placeholder="A, B" />
                </Campo>
                <Campo rotulo="Do andar">
                  <Entrada name="andar_inicial" type="number" min={0} defaultValue={1} />
                </Campo>
                <Campo rotulo="Até o andar">
                  <Entrada name="andar_final" type="number" min={0} defaultValue={1} />
                </Campo>
                <Campo rotulo="Unidades por andar">
                  <Entrada name="por_andar" type="number" min={1} max={50} defaultValue={4} />
                </Campo>
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue="apartamento">
                    {TIPOS_IMOVEL.map((t) => (
                      <option key={t}>{t}</option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Finalidade">
                  <Selecao name="finalidade" defaultValue="locacao">
                    <option value="locacao">Locação</option>
                    <option value="venda">Venda</option>
                    <option value="ambas">Venda e locação</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Área privativa (m²)">
                  <Entrada name="area_privativa" inputMode="decimal" />
                </Campo>
                <Campo rotulo="Quartos">
                  <Entrada name="quartos" type="number" min={0} />
                </Campo>
                <Campo rotulo="Suítes">
                  <Entrada name="suites" type="number" min={0} />
                </Campo>
                <Campo rotulo="Banheiros">
                  <Entrada name="banheiros" type="number" min={0} />
                </Campo>
                <Campo rotulo="Vagas">
                  <Entrada name="vagas" type="number" min={0} />
                </Campo>
                <Campo rotulo="Aluguel (R$)">
                  <Entrada name="valor_aluguel" inputMode="decimal" />
                </Campo>
                <Campo rotulo="Venda (R$)">
                  <Entrada name="valor_venda" inputMode="decimal" />
                </Campo>
                <Campo rotulo="Condomínio (R$)">
                  <Entrada name="valor_condominio" inputMode="decimal" />
                </Campo>
              </div>
            </JanelaCadastro>
            <BotaoLink href={`/imoveis/novo?empreendimento=${id}`} variante="secundario">
              <Plus className="size-4" /> Unidade avulsa
            </BotaoLink>
          </>
        }
      />
      <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
        <div>
          <Tabela colunas={["Código", "Bloco", "Unidade", "Tipo", "Valor", "Situação"]}>
            {lista.length === 0 && <LinhaVazia colunas={6}>Nenhuma unidade. Use “Gerar unidades”.</LinhaVazia>}
            {lista.map((u) => (
              <LinhaLink key={u.id} href={`/imoveis/${u.id}`} className="hover:bg-card-hover">
                <Celula className="font-semibold text-acento">{u.codigo}</Celula>
                <Celula>{u.bloco ?? "—"}</Celula>
                <Celula>{u.unidade ?? "—"}</Celula>
                <Celula className="capitalize">
                  {u.tipo}
                  {u.quartos ? ` · ${u.quartos} qto(s)` : ""}
                </Celula>
                <Celula>{u.valor_aluguel ? formatarReais(u.valor_aluguel) : u.valor_venda ? formatarReais(u.valor_venda) : "—"}</Celula>
                <Celula>
                  <Selo cor={COR[u.status as keyof typeof COR] ?? "cinza"}>{ROTULO_STATUS_IMOVEL[u.status] ?? u.status}</Selo>
                </Celula>
              </LinhaLink>
            ))}
          </Tabela>
          <p className="mt-2 text-xs text-mudo">Para alterar várias unidades de uma vez (situação, valores, corretor), use a lista de Imóveis filtrando por este empreendimento.</p>
        </div>
        <div className="space-y-6">
          <Formulario acao={atualizarEmpreendimento} automatico>
            <input type="hidden" name="id" value={id} />
            <Cartao titulo="Dados do empreendimento">
              <CamposEmpreendimento e={e} />
            </Cartao>
          </Formulario>
          <form action={excluirEmpreendimento}>
            <input type="hidden" name="id" value={id} />
            <BotaoEnviar variante="fantasma" confirmar="Excluir o empreendimento? As unidades continuam cadastradas como imóveis avulsos.">
              Excluir empreendimento
            </BotaoEnviar>
          </form>
        </div>
      </div>
    </>
  );
}
