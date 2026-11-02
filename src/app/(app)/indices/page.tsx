import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Cabecalho, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarCompetencia } from "@/lib/dominio/datas";
import { INDICES, NOME_INDICE, acumular } from "@/lib/dominio/reajuste";
import { type EstadoAcao, ErroValidacao, mensagemErro, numero, textoObrigatorio } from "@/lib/form";
import { FiltroAutomatico } from "@/components/filtro-automatico";

export const metadata: Metadata = { title: "Índices econômicos" };

async function salvarIndice(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase } = await obterContexto();
  try {
    const indice = textoObrigatorio(fd, "indice");
    const mes = textoObrigatorio(fd, "competencia", "o mês");
    const variacao = numero(fd, "variacao_pct");
    if (variacao === null) throw new ErroValidacao("Informe a variação do mês (%).");
    const { error } = await supabase
      .from("indices_economicos")
      .upsert({ indice, competencia: `${mes}-01`, variacao_pct: variacao }, { onConflict: "organizacao_id,indice,competencia" });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/indices");
  return { ok: "Índice salvo." };
}

async function importarIndices(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase } = await obterContexto();
  try {
    const indice = textoObrigatorio(fd, "indice");
    const linhas = textoObrigatorio(fd, "dados", "os dados").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const registros = linhas.map((l) => {
      const m = l.match(/^(\d{2})\/(\d{4})[;\t, ]+(-?[\d.,]+)$/) ?? l.match(/^(\d{4})-(\d{2})[;\t, ]+(-?[\d.,]+)$/);
      if (!m) throw new ErroValidacao(`Linha inválida: "${l}". Use MM/AAAA;variação`);
      const [mes, ano] = l.includes("/") ? [m[1], m[2]] : [m[2], m[1]];
      return { indice, competencia: `${ano}-${mes}-01`, variacao_pct: Number(m[3].replace(",", ".")) };
    });
    const { error } = await supabase.from("indices_economicos").upsert(registros, { onConflict: "organizacao_id,indice,competencia" });
    if (error) throw error;
    revalidatePath("/indices");
    return { ok: `${registros.length} mês(es) importado(s).` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export default async function IndicesPage({ searchParams }: PageProps<"/indices">) {
  const sp = await searchParams;
  const indice = typeof sp.indice === "string" && sp.indice ? sp.indice : "IGPM";
  const { supabase } = await obterContexto();
  const { data } = await supabase
    .from("indices_economicos")
    .select("competencia, variacao_pct")
    .eq("indice", indice)
    .order("competencia", { ascending: false })
    .limit(36);
  const linhas = (data ?? []) as { competencia: string; variacao_pct: number }[];

  return (
    <>
      <Cabecalho
        titulo="Índices econômicos"
        descricao="Variações mensais usadas no cálculo dos reajustes. Consulte os valores oficiais (FGV/IBGE) e cadastre aqui."
      />
      <div className="grid gap-6 lg:grid-cols-[1fr_360px]">
        <div>
          <FiltroAutomatico className="mb-4 flex gap-2">
            <Selecao name="indice" defaultValue={indice} className="max-w-xs">
              {INDICES.map((i) => (
                <option key={i} value={i}>
                  {NOME_INDICE[i]}
                </option>
              ))}
            </Selecao>
          </FiltroAutomatico>
          <Tabela colunas={["Mês", "Variação do mês", "Acumulado 12 meses"]}>
            {linhas.length === 0 && <LinhaVazia colunas={3}>Nenhum mês cadastrado para {indice}.</LinhaVazia>}
            {linhas.map((l, i) => {
              const janela = linhas.slice(i, i + 12);
              return (
                <tr key={l.competencia}>
                  <Celula>{formatarCompetencia(l.competencia)}</Celula>
                  <Celula>{Number(l.variacao_pct).toFixed(4)}%</Celula>
                  <Celula>{janela.length === 12 ? `${acumular(janela.map((j) => Number(j.variacao_pct))).toFixed(4)}%` : "—"}</Celula>
                </tr>
              );
            })}
          </Tabela>
        </div>
        <div className="space-y-6">
          <Cartao titulo="Cadastrar mês">
            <Formulario acao={salvarIndice} className="space-y-3">
              <Campo rotulo="Índice">
                <Selecao name="indice" defaultValue={indice}>
                  {INDICES.map((i) => (
                    <option key={i} value={i}>
                      {NOME_INDICE[i]}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Mês">
                <Entrada type="month" name="competencia" required />
              </Campo>
              <Campo rotulo="Variação (%)">
                <Entrada name="variacao_pct" inputMode="decimal" required placeholder="0,45" />
              </Campo>
              <BotaoEnviar>Salvar</BotaoEnviar>
            </Formulario>
          </Cartao>
          <Cartao titulo="Importar vários meses">
            <Formulario acao={importarIndices} className="space-y-3">
              <Campo rotulo="Índice">
                <Selecao name="indice" defaultValue={indice}>
                  {INDICES.map((i) => (
                    <option key={i} value={i}>
                      {NOME_INDICE[i]}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Dados (um mês por linha)" dica="Formato: MM/AAAA;variação — ex.: 01/2026;0,27">
                <textarea name="dados" rows={8} className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs" />
              </Campo>
              <BotaoEnviar variante="secundario">Importar</BotaoEnviar>
            </Formulario>
          </Cartao>
        </div>
      </div>
    </>
  );
}
