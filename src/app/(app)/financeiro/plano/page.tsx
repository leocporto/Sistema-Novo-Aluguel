import type { Metadata } from "next";
import { ListTree, Plus, Sparkles } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { GRUPOS_DRE } from "@/lib/dominio/financeiro";
import { AbasFinanceiro } from "../abas";
import { atualizarPlano, criarCentro, criarPlano, excluirCentro, excluirPlano, instalarPlanoPadrao, salvarRegrasFinanceiro } from "../actions";
import { opcoesFinanceiro } from "../dados";

export const metadata: Metadata = { title: "Plano de contas" };

export default async function PlanoPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const gestor = papel === "admin" || papel === "gestor";
  const [op, { data: org }] = await Promise.all([opcoesFinanceiro(supabase), supabase.from("organizacoes").select("aprovacao_pagamento_acima, aliquota_iss").eq("id", organizacao.id).single()]);

  return (
    <>
      <Cabecalho
        titulo="Plano de contas"
        trilha="Financeiro"
        descricao="Como cada receita e despesa é classificada (é o que monta a DRE e o orçamento), os centros de custo e as regras do financeiro."
        acoes={
          <>
            <BotaoAcao acao={instalarPlanoPadrao} id={organizacao.modo} confirmar="Adicionar o plano de contas padrão? Contas com o mesmo código não são repetidas.">
              <Sparkles className="size-4" /> Instalar plano padrão
            </BotaoAcao>
            <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova conta</>} titulo="Nova conta do plano" acao={criarPlano} icone={<ListTree />}>
              <div className="grid gap-4 sm:grid-cols-[120px_1fr]">
                <Campo rotulo="Código">
                  <Entrada name="codigo" required placeholder="4.9" />
                </Campo>
                <Campo rotulo="Nome">
                  <Entrada name="nome" required />
                </Campo>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tipo">
                  <Selecao name="tipo" defaultValue="despesa">
                    <option value="despesa">Despesa</option>
                    <option value="receita">Receita</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Grupo na DRE">
                  <Selecao name="grupo_dre" defaultValue="despesas_operacionais">
                    {Object.entries(GRUPOS_DRE).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>
            </JanelaCadastro>
          </>
        }
      />
      <AbasFinanceiro pessoal={pessoal} />
      <div className="grid gap-6 xl:grid-cols-[1fr_360px]">
        <Cartao titulo={`Contas (${op.planos.length})`}>
          {op.planos.length === 0 && <p className="text-sm text-mudo">Nenhuma conta. Clique em &quot;Instalar plano padrão&quot; para começar com um plano pronto.</p>}
          {op.planos.length > 0 && (
            <div className="mb-1 hidden grid-cols-[80px_1fr_120px_220px_44px_36px] gap-2 px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo lg:grid">
              <span>Código</span>
              <span>Nome</span>
              <span>Tipo</span>
              <span>Grupo na DRE</span>
              <span>Ativa</span>
              <span />
            </div>
          )}
          <div className="divide-y divide-borda-suave">
            {op.planos.map((p) => (
              <div key={p.id} className="flex items-center gap-2 py-1.5">
                <Formulario acao={atualizarPlano} automatico className="grid flex-1 grid-cols-1 items-center gap-2 sm:grid-cols-2 lg:grid-cols-[80px_1fr_120px_220px_44px]">
                  <input type="hidden" name="id" value={p.id} />
                  <Entrada name="codigo" defaultValue={p.codigo} aria-label="Código" />
                  <Entrada name="nome" defaultValue={p.nome} aria-label="Nome" />
                  <Selecao name="tipo" defaultValue={p.tipo} aria-label="Tipo">
                    <option value="despesa">Despesa</option>
                    <option value="receita">Receita</option>
                  </Selecao>
                  <Selecao name="grupo_dre" defaultValue={p.grupo_dre} aria-label="Grupo na DRE">
                    {Object.entries(GRUPOS_DRE).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                  <label className="flex justify-center">
                    <input type="hidden" name="ativo" value="" />
                    <input type="checkbox" name="ativo" defaultChecked={p.ativo} aria-label="Ativa" />
                  </label>
                </Formulario>
                <BotaoExcluir acao={excluirPlano} id={p.id} rotulo="Excluir conta do plano" confirmar={`Excluir "${p.codigo} ${p.nome}"? Os lançamentos ficam sem classificação.`} />
              </div>
            ))}
          </div>
        </Cartao>
        <div className="space-y-6">
          <Cartao titulo="Centros de custo">
            <p className="mb-3 text-sm text-texto-2">{pessoal ? "Ex.: um centro por imóvel ou por prédio." : "Ex.: Locação, Vendas, Administrativo, filial."}</p>
            <ul className="mb-4 divide-y divide-borda-suave text-sm">
              {op.centros.map((c) => (
                <li key={c.id} className="flex items-center justify-between py-1.5">
                  {c.nome}
                  <BotaoExcluir acao={excluirCentro} id={c.id} rotulo="Excluir centro" confirmar={`Excluir o centro "${c.nome}"?`} />
                </li>
              ))}
              {!op.centros.length && <li className="py-1.5 text-mudo">Nenhum ainda.</li>}
            </ul>
            <Formulario acao={criarCentro} className="flex gap-2">
              <Entrada name="nome" required placeholder="Nome do centro" />
              <BotaoEnviar variante="secundario">Adicionar</BotaoEnviar>
            </Formulario>
          </Cartao>
          <Cartao titulo="Regras">
            {gestor ? (
              <Formulario acao={salvarRegrasFinanceiro} automatico className="space-y-3">
                <Campo rotulo="Pagamentos acima de (R$) precisam de aprovação" dica="Vazio = sem aprovação. Só administradores e gestores aprovam.">
                  <Entrada name="aprovacao_pagamento_acima" inputMode="decimal" defaultValue={org?.aprovacao_pagamento_acima ? String(org.aprovacao_pagamento_acima).replace(".", ",") : ""} />
                </Campo>
                {!pessoal && (
                  <Campo rotulo="Alíquota de ISS das notas (%)" dica="Usada nas notas fiscais geradas das taxas.">
                    <Entrada name="aliquota_iss" inputMode="decimal" defaultValue={String(org?.aliquota_iss ?? 0).replace(".", ",")} />
                  </Campo>
                )}
              </Formulario>
            ) : (
              <p className="text-sm text-mudo">Só administradores e gestores mudam as regras.</p>
            )}
          </Cartao>
        </div>
      </div>
    </>
  );
}
