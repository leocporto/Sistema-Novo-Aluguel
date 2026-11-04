import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Copy } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Definicao, Entrada, Selecao } from "@/components/ui";
import {
  FONTES_BI,
  ROTULO_OPERADOR,
  camposDaFonte,
  campoDaFonte,
  ehFonte,
  tabelaDoResultado,
  type DefinicaoRelatorio,
  type Operador,
} from "@/lib/dominio/bi";
import { AbasRelatorios } from "../../abas";
import { duplicarRelatorio, excluirRelatorio, salvarRelatorio } from "../../actions";
import { BotoesExportar, TabelaRelatorioView } from "../../componentes";
import { carregarSalvo, contextoRelatorios, executarPersonalizado } from "../../dados";
import { FiltrosRelatorio } from "../filtros";

export const metadata: Metadata = { title: "Relatório personalizado" };

const LIMITE_TELA = 200;

export default async function PersonalizadoPage({ params }: PageProps<"/relatorios/personalizados/[id]">) {
  const { id } = await params;
  const { supabase, imob, bi } = await contextoRelatorios();
  const r = await carregarSalvo(supabase, id);
  if (!r) notFound();
  if (!ehFonte(r.fonte)) notFound();
  const fonte = r.fonte;
  const campos = camposDaFonte(fonte, imob);
  const def: DefinicaoRelatorio = r;
  const res = await executarPersonalizado(supabase, def, Math.min(r.limite, LIMITE_TELA));
  const tabela = res.ok ? tabelaDoResultado(def, res.resultado, r.nome) : null;
  const numericos = campos.filter((c) => c.tipo === "dinheiro" || c.tipo === "numero" || c.tipo === "inteiro");
  const agrupaveis = campos.filter((c) => c.tipo !== "dinheiro" && c.tipo !== "numero");
  const rot = (c: string) => (c === "quantidade" ? "Quantidade" : (campoDaFonte(fonte, c)?.rotulo ?? c));

  return (
    <>
      <Cabecalho
        titulo={r.nome}
        trilha="Relatórios"
        descricao={r.descricao ?? `${FONTES_BI[fonte].rotulo}: ${FONTES_BI[fonte].descricao}`}
        acoes={
          <>
            <BotoesExportar consulta={`r=personalizado&id=${r.id}`} rotulo="este relatório" />
            {bi.editar && (
              <BotaoAcao acao={duplicarRelatorio} id={r.id}>
                <Copy className="size-4" /> Duplicar
              </BotaoAcao>
            )}
            {bi.editar && <BotaoExcluir acao={excluirRelatorio} id={r.id} variante="botao" confirmar={`Excluir o relatório "${r.nome}"? Envios programados dele também saem.`} depois="/relatorios/personalizados" />}
          </>
        }
      />
      <AbasRelatorios />
      {FONTES_BI[fonte].soImobiliaria && !imob && <Aviso tipo="alerta">Esta fonte de dados só existe no modo imobiliária.</Aviso>}

      {bi.editar ? (
        <div className="nao-imprimir mb-6">
          <Cartao titulo="Montar o relatório">
            <Formulario acao={salvarRelatorio} automatico>
              <input type="hidden" name="id" value={r.id} />
              <div className="grid gap-4 md:grid-cols-2">
                <Campo rotulo="Nome">
                  <Entrada name="nome" defaultValue={r.nome} required maxLength={120} />
                </Campo>
                <Campo rotulo="Descrição">
                  <AreaTexto name="descricao" defaultValue={r.descricao ?? ""} rows={1} maxLength={1000} />
                </Campo>
              </div>
              <fieldset>
                <legend className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Colunas ({FONTES_BI[fonte].rotulo})</legend>
                <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                  {campos.map((c) => (
                    <label key={c.id} className="flex items-center gap-2 text-sm text-texto">
                      <input type="checkbox" name="colunas" value={c.id} defaultChecked={r.colunas.includes(c.id)} className="size-4 accent-[var(--accent)]" />
                      {c.rotulo}
                    </label>
                  ))}
                </div>
              </fieldset>
              <fieldset>
                <legend className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Filtros</legend>
                <FiltrosRelatorio campos={campos} iniciais={r.filtros ?? []} />
              </fieldset>
              <div className="grid gap-4 md:grid-cols-4">
                <Campo rotulo="Agrupar por" dica="Agrupado: uma linha por valor, com a quantidade e os totais.">
                  <Selecao name="agrupar_por" defaultValue={r.agrupar_por ?? ""}>
                    <option value="">Não agrupar (uma linha por registro)</option>
                    {agrupaveis.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.rotulo}
                        {c.tipo === "data" ? " (por mês)" : ""}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Ordenar por">
                  <Selecao name="ordenar_por" defaultValue={r.ordenar_por ?? ""}>
                    <option value="">Padrão</option>
                    {r.agrupar_por && <option value="quantidade">Quantidade</option>}
                    {campos.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.rotulo}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Ordem">
                  <Selecao name="ordem" defaultValue={r.ordem}>
                    <option value="asc">Crescente (A→Z, menor primeiro)</option>
                    <option value="desc">Decrescente (Z→A, maior primeiro)</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Máximo de linhas" dica="Na tela aparecem até 200; o arquivo leva até este limite (máx. 5.000).">
                  <Entrada name="limite" type="number" min={1} max={10000} defaultValue={r.limite} />
                </Campo>
              </div>
              {numericos.length > 0 && (
                <fieldset>
                  <legend className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Somar (totais)</legend>
                  <div className="grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-4">
                    {numericos.map((c) => (
                      <label key={c.id} className="flex items-center gap-2 text-sm text-texto">
                        <input type="checkbox" name="totais" value={c.id} defaultChecked={r.totais.includes(c.id)} className="size-4 accent-[var(--accent)]" />
                        {c.rotulo}
                      </label>
                    ))}
                  </div>
                </fieldset>
              )}
            </Formulario>
          </Cartao>
        </div>
      ) : (
        <div className="mb-6">
          <Cartao titulo="Como o relatório é montado">
            <Definicao
              itens={[
                ["Dados", FONTES_BI[fonte].rotulo],
                ["Colunas", r.colunas.map(rot).join(", ")],
                ["Filtros", r.filtros.length ? r.filtros.map((f) => `${rot(f.campo)} ${ROTULO_OPERADOR[f.op as Operador] ?? f.op}${f.valor ? ` ${f.valor}` : ""}`).join("; ") : "nenhum"],
                ["Agrupado por", r.agrupar_por ? rot(r.agrupar_por) : "não agrupa"],
                ["Totais", r.totais.length ? r.totais.map(rot).join(", ") : "—"],
              ]}
            />
          </Cartao>
        </div>
      )}

      <Cartao titulo={tabela ? `Resultado — ${tabela.total > tabela.linhas.length ? `mostrando ${tabela.linhas.length} de ${tabela.total}` : `${tabela.total} linha(s)`}` : "Resultado"}>
        {res.ok && tabela ? <TabelaRelatorioView t={tabela} vazio="Nenhum registro com esses filtros." /> : <Aviso tipo="erro">{res.ok ? "" : res.erro}</Aviso>}
      </Cartao>
    </>
  );
}
