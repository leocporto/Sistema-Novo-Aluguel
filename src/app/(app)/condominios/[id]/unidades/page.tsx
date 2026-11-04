import type { Metadata } from "next";
import { Building, Check, Home, Plus } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Campo, Cartao, Entrada, Grade, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { SITUACOES_UNIDADE, TIPOS_UNIDADE, conferirFracoes, fracaoEmPct } from "@/lib/dominio/condominios";
import { criarBloco, criarUnidades, excluirBloco, excluirUnidade, salvarUnidade } from "../../actions";
import { blocosDo, unidadesDo, vinculosDo } from "../../dados";

export const metadata: Metadata = { title: "Unidades do condomínio" };

const opcoes = (o: Record<string, string>) =>
  Object.entries(o).map(([k, r]) => (
    <option key={k} value={k}>
      {r}
    </option>
  ));

/** Blocos e unidades com fração ideal (6 casas), área, vaga e situação. Editar salva sozinho. */
export default async function UnidadesPage({ params }: PageProps<"/condominios/[id]/unidades">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [unidades, blocos, vinculos] = await Promise.all([unidadesDo(supabase, id), blocosDo(supabase, id), vinculosDo(supabase, id)]);
  const fr = conferirFracoes(unidades.map((u) => u.fracao_ideal));
  const responsavel = (u: string) => vinculos.find((v) => v.unidade_id === u && v.responsavel_financeiro)?.pessoa?.nome ?? vinculos.find((v) => v.unidade_id === u && v.papel === "proprietario")?.pessoa?.nome;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm text-texto-2">
          <span>
            {unidades.length} unidade(s) em {blocos.length || "nenhum"} bloco(s).
          </span>
          {unidades.length > 0 &&
            (fr.ok ? (
              <Selo cor="verde">
                <Check className="size-3" /> frações somam {fr.escala === "percentual" ? "100%" : "1"}
              </Selo>
            ) : (
              <Selo cor="amarelo">frações não fecham</Selo>
            ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <JanelaCadastro rotuloBotao={<><Building className="size-4" /> Novo bloco</>} variante="secundario" titulo="Novo bloco (torre)" acao={criarBloco} icone={<Building />}>
            <input type="hidden" name="condominio_id" value={id} />
            <Campo rotulo="Nome">
              <Entrada name="nome" required placeholder="Ex.: Bloco A, Torre 1" />
            </Campo>
            <Campo rotulo="Ordem na lista">
              <Entrada name="ordem" type="number" defaultValue={blocos.length + 1} />
            </Campo>
          </JanelaCadastro>
          <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Novas unidades</>} titulo="Cadastrar unidades" acao={criarUnidades} icone={<Home />}>
            <input type="hidden" name="condominio_id" value={id} />
            <Campo rotulo="Números" dica="Intervalos e listas: 101-104, 201-204, Loja 1">
              <Entrada name="numeros" required placeholder="101-104, 201-204" />
            </Campo>
            <Grade colunas={2}>
              <Campo rotulo="Bloco">
                <Selecao name="bloco_id" defaultValue="">
                  <option value="">Sem bloco</option>
                  {blocos.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Tipo">
                <Selecao name="tipo" defaultValue="apartamento">
                  {opcoes(TIPOS_UNIDADE)}
                </Selecao>
              </Campo>
              <Campo rotulo="Fração ideal (opcional)" dica="Mesma para todas; ajuste depois.">
                <Entrada name="fracao_ideal" inputMode="decimal" placeholder="0,025000" />
              </Campo>
              <Campo rotulo="Área privativa m² (opcional)">
                <Entrada name="area_privativa" inputMode="decimal" />
              </Campo>
            </Grade>
          </JanelaCadastro>
        </div>
      </div>

      {unidades.length > 0 && !fr.ok && (
        <Aviso tipo="alerta">
          A soma das frações ideais é <b>{fr.soma.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}</b>
          {fr.semFracao ? `, com ${fr.semFracao} unidade(s) sem fração` : ""}. Ela precisa fechar 1 (ou 100%): faltam{" "}
          <b>{fr.diferenca.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}</b>. As cotas por fração só são geradas com todas as unidades preenchidas.
        </Aviso>
      )}

      {blocos.length > 0 && (
        <Cartao titulo="Blocos">
          <div className="flex flex-wrap gap-2">
            {blocos.map((b) => (
              <span key={b.id} className="inline-flex items-center gap-2 rounded-full border border-borda bg-elev py-1 pl-3 pr-1 text-sm text-texto">
                {b.nome} <span className="text-xs text-mudo">({unidades.filter((u) => u.bloco_id === b.id).length})</span>
                <BotaoExcluir acao={excluirBloco} id={b.id} rotulo={`Excluir ${b.nome}`} confirmar={`Excluir o ${b.nome}? Só dá se não tiver unidades.`} />
              </span>
            ))}
          </div>
        </Cartao>
      )}

      <Cartao titulo="Unidades">
        {unidades.length === 0 ? (
          <p className="text-sm text-mudo">Nenhuma unidade ainda. Use “Novas unidades” para cadastrar várias de uma vez.</p>
        ) : (
          <div className="overflow-x-auto">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[90px_140px_130px_110px_130px_110px_140px_1fr_40px] gap-2 border-b border-borda pb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">
                <span>Número</span>
                <span>Bloco</span>
                <span>Tipo</span>
                <span>Área m²</span>
                <span>Fração ideal</span>
                <span>Vaga</span>
                <span>Situação</span>
                <span>Responsável</span>
                <span />
              </div>
              {unidades.map((u) => (
                <Formulario
                  key={u.id}
                  acao={salvarUnidade}
                  automatico
                  semAviso
                  className="grid grid-cols-[90px_140px_130px_110px_130px_110px_140px_1fr_40px] items-center gap-2 border-b border-borda-suave py-2"
                >
                  <input type="hidden" name="id" value={u.id} />
                  <input type="hidden" name="condominio_id" value={id} />
                  <Entrada name="numero" required defaultValue={u.numero} aria-label="Número da unidade" />
                  <Selecao name="bloco_id" defaultValue={u.bloco_id ?? ""} aria-label="Bloco">
                    <option value="">—</option>
                    {blocos.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.nome}
                      </option>
                    ))}
                  </Selecao>
                  <Selecao name="tipo" defaultValue={u.tipo} aria-label="Tipo">
                    {opcoes(TIPOS_UNIDADE)}
                  </Selecao>
                  <Entrada name="area_privativa" inputMode="decimal" defaultValue={u.area_privativa ?? ""} aria-label="Área privativa" />
                  <Entrada name="fracao_ideal" inputMode="decimal" defaultValue={u.fracao_ideal ?? ""} aria-label="Fração ideal" title={u.fracao_ideal != null ? `${fracaoEmPct(Number(u.fracao_ideal), fr.escala)?.toLocaleString("pt-BR", { maximumFractionDigits: 4 })}%` : undefined} />
                  <Entrada name="vaga" defaultValue={u.vaga ?? ""} aria-label="Vaga" />
                  <Selecao name="situacao" defaultValue={u.situacao} aria-label="Situação">
                    {opcoes(SITUACOES_UNIDADE)}
                  </Selecao>
                  <span className="truncate text-sm text-texto-2">{responsavel(u.id) ?? <span className="text-mudo">—</span>}</span>
                  <input type="hidden" name="observacoes" value={u.observacoes ?? ""} />
                  <BotaoExcluir acao={excluirUnidade} id={u.id} rotulo="Excluir unidade" confirmar={`Excluir a unidade ${u.numero}? Só dá se ela ainda não tiver cotas.`} />
                </Formulario>
              ))}
              <p className="mt-3 flex items-center justify-end gap-1.5 text-xs text-mudo">
                <Check className="size-3.5" /> As alterações são salvas automaticamente.
              </p>
            </div>
          </div>
        )}
      </Cartao>
    </div>
  );
}
