import type { Metadata } from "next";
import Link from "next/link";
import { Plus, Scale, Users } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Cabecalho, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { BASE_REGRA, ROTULO_TIPO_COMISSAO, SEM_REGRA, regraAceitaCondicao, type TipoRegra } from "@/lib/dominio/comissoes";
import { AbasComissoes } from "../abas";
import { adicionarMembro, atualizarEquipe, atualizarRegra, criarEquipe, criarRegra, excluirEquipe, excluirRegra, removerMembro } from "../actions";
import { carregarBaseComissoes } from "../dados";

export const metadata: Metadata = { title: "Regras de comissão" };

const TIPOS_REGRA: TipoRegra[] = ["venda", "locacao", "angariacao", "administracao"];

/** Regras por tipo de negócio, por corretor, por equipe ou gerais — e as equipes. */
export default async function RegrasPage() {
  const { supabase } = await obterContexto();
  const base = await carregarBaseComissoes(supabase);
  const nome = new Map(base.corretores.map((p) => [p.id, p.nome]));
  const quemOpcoes = (
    <>
      <option value="">Todos (regra geral)</option>
      {base.equipes.length > 0 && (
        <optgroup label="Equipe">
          {base.equipes.map((e) => (
            <option key={e.id} value={`e:${e.id}`}>
              Equipe {e.nome}
            </option>
          ))}
        </optgroup>
      )}
      <optgroup label="Corretor">
        {base.corretores.map((p) => (
          <option key={p.id} value={`p:${p.id}`}>
            {p.nome}
          </option>
        ))}
      </optgroup>
    </>
  );

  return (
    <>
      <Cabecalho
        titulo="Regras e equipes"
        trilha="Comissões"
        descricao="Quanto cada corretor ganha em cada tipo de negócio. Vale a regra do corretor; se ele não tiver, a da equipe dele; se não, a geral. A regra também diz em quantos dias pagar e se só paga depois que a imobiliária receber."
        acoes={
          <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova regra</>} titulo="Nova regra de comissão" acao={criarRegra} icone={<Scale />} rotuloSalvar="Criar regra">
            <Campo rotulo="Nome (opcional)">
              <Entrada name="nome" placeholder="Padrão da equipe Centro" />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Tipo de negócio">
                <Selecao name="tipo" required defaultValue="locacao">
                  {TIPOS_REGRA.map((t) => (
                    <option key={t} value={t}>
                      {ROTULO_TIPO_COMISSAO[t]}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Vale para">
                <Selecao name="quem" defaultValue="">
                  {quemOpcoes}
                </Selecao>
              </Campo>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Percentual (%)">
                <Entrada name="percentual" inputMode="decimal" required />
              </Campo>
              <Campo rotulo="Pagar em (dias)">
                <Entrada name="dias_pagamento" inputMode="numeric" defaultValue="30" />
              </Campo>
            </div>
            <label className="flex items-center gap-2 text-sm text-texto">
              <input type="hidden" name="condicionada" value="" />
              <input type="checkbox" name="condicionada" /> Só pagar depois que a imobiliária receber
            </label>
            <p className="-mt-2 text-xs text-mudo">Não vale para Administração: a taxa já foi recebida na baixa do aluguel, então essa comissão vira conta a pagar na hora.</p>
            <ul className="space-y-1 rounded-[12px] bg-elev p-3 text-xs text-texto-2">
              {TIPOS_REGRA.map((t) => (
                <li key={t}>
                  <b>{ROTULO_TIPO_COMISSAO[t]}:</b> {BASE_REGRA[t]}.
                </li>
              ))}
            </ul>
          </JanelaCadastro>
        }
      />
      <AbasComissoes />

      <div className="mb-6">
        <Aviso>
          <b>Como o sistema usa as regras:</b> locação — ao aceitar a proposta, o corretor recebe o % da proposta sobre o aluguel (em branco, o % da regra); venda — ao aceitar, o
          captador do imóvel (se for outro corretor e houver regra de angariação) entra na divisão com o % dela e o corretor que vendeu com o % da regra de venda (sem regra, 100%
          menos a parte do captador); ao concluir, cada um recebe a sua parte; angariação — o corretor responsável pelo imóvel (captador) recebe a parte da regra; administração —
          em “Gerar de administração”, % da taxa retida em cada repasse, já como conta a pagar. “Só depois de receber”: na venda, quando a imobiliária recebe a comissão do vendedor;
          na locação, quando o próximo aluguel do imóvel é pago (se a baixa for desfeita, volta a ficar prevista).
        </Aviso>
      </div>

      <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
        <Cartao titulo="Regras">
          {TIPOS_REGRA.map((t) => {
            const lista = base.regras.filter((r) => r.tipo === t);
            return (
              <section key={t} className="mb-5 last:mb-0">
                <h4 className="mb-1 text-sm font-semibold text-texto">{ROTULO_TIPO_COMISSAO[t]}</h4>
                <p className="mb-2 text-xs text-mudo">{BASE_REGRA[t]}</p>
                <ul className="divide-y divide-borda-suave rounded-[14px] border border-borda">
                  {lista.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-3 py-2">
                      <div className="min-w-40 flex-1">
                        <div className="text-sm font-medium text-texto">{r.pessoa?.nome ?? (r.equipe ? `Equipe ${r.equipe.nome}` : "Todos (geral)")}</div>
                        <div className="text-xs text-mudo">{r.nome ?? (r.pessoa_id ? "regra do corretor" : r.equipe_id ? "regra da equipe" : "regra geral")}</div>
                      </div>
                      <Formulario acao={atualizarRegra} automatico className="flex flex-wrap items-center gap-2 [&>p]:hidden">
                        <input type="hidden" name="id" value={r.id} />
                        <Entrada name="percentual" inputMode="decimal" defaultValue={String(r.percentual).replace(".", ",")} aria-label="Percentual" className="w-20" />
                        <span className="text-xs text-mudo">%</span>
                        <Entrada name="dias_pagamento" inputMode="numeric" defaultValue={String(r.dias_pagamento)} aria-label="Dias para pagar" className="w-16" />
                        <span className="text-xs text-mudo">dias</span>
                        {regraAceitaCondicao(r.tipo) ? (
                          <label className="flex items-center gap-1 text-xs text-texto-2">
                            <input type="hidden" name="condicionada" value="" />
                            <input type="checkbox" name="condicionada" defaultChecked={r.condicionada} /> só depois de receber
                          </label>
                        ) : (
                          <span className="text-xs text-mudo">taxa já recebida na baixa</span>
                        )}
                        <label className="flex items-center gap-1 text-xs text-texto-2">
                          <input type="hidden" name="ativa" value="" />
                          <input type="checkbox" name="ativa" defaultChecked={r.ativa} /> ativa
                        </label>
                      </Formulario>
                      {!r.ativa && <Selo>inativa</Selo>}
                      <BotaoExcluir acao={excluirRegra} id={r.id} rotulo="Excluir regra" confirmar="Excluir esta regra? As comissões já criadas não mudam." />
                    </li>
                  ))}
                  {lista.length === 0 && (
                    <li className="px-3 py-2 text-sm text-mudo">Sem regra: {SEM_REGRA[t]}</li>
                  )}
                </ul>
              </section>
            );
          })}
        </Cartao>

        <Cartao
          titulo="Equipes"
          acoes={
            <JanelaCadastro rotuloBotao={<><Users className="size-3.5" /> Nova equipe</>} tamanho="sm" variante="secundario" titulo="Nova equipe" acao={criarEquipe} icone={<Users />} rotuloSalvar="Criar">
              <Campo rotulo="Nome">
                <Entrada name="nome" required placeholder="Equipe Centro" />
              </Campo>
              <Campo rotulo="Líder (opcional)">
                <Selecao name="lider_id" defaultValue="">
                  <option value="">—</option>
                  {base.corretores.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            </JanelaCadastro>
          }
        >
          <div className="space-y-5">
            {base.equipes.map((e) => {
              const membros = base.membros.filter((m) => m.equipe_id === e.id);
              return (
                <section key={e.id} className="rounded-[14px] border border-borda p-3">
                  <div className="flex items-start justify-between gap-2">
                    <Formulario acao={atualizarEquipe} automatico className="grid flex-1 gap-2 [&>p]:hidden">
                      <input type="hidden" name="id" value={e.id} />
                      <Entrada name="nome" defaultValue={e.nome} required aria-label="Nome da equipe" />
                      <Selecao name="lider_id" defaultValue={e.lider_id ?? ""} aria-label="Líder da equipe">
                        <option value="">Sem líder</option>
                        {base.corretores.map((p) => (
                          <option key={p.id} value={p.id}>
                            Líder: {p.nome}
                          </option>
                        ))}
                      </Selecao>
                    </Formulario>
                    <BotaoExcluir acao={excluirEquipe} id={e.id} rotulo="Excluir equipe" confirmar={`Excluir a equipe ${e.nome}? As regras dela também saem.`} />
                  </div>
                  <ul className="mt-3 space-y-1 text-sm">
                    {membros.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-2">
                        <Link href={`/comissoes/corretores/${m.pessoa_id}`} className="hover:underline">
                          {nome.get(m.pessoa_id) ?? "—"}
                        </Link>
                        <BotaoExcluir acao={removerMembro} id={m.id} rotulo="Tirar da equipe" confirmar="Tirar este corretor da equipe?" />
                      </li>
                    ))}
                    {membros.length === 0 && <li className="text-mudo">Ninguém na equipe ainda.</li>}
                  </ul>
                  <Formulario acao={adicionarMembro} className="mt-3 flex flex-wrap items-center gap-2 space-y-0">
                    <input type="hidden" name="equipe_id" value={e.id} />
                    <Selecao name="pessoa_id" required defaultValue="" aria-label="Corretor para incluir" className="max-w-56">
                      <option value="">Incluir corretor…</option>
                      {base.corretores
                        .filter((p) => base.equipeDe.get(p.id) !== e.id)
                        .map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.nome}
                            {base.equipeDe.get(p.id) ? " (muda de equipe)" : ""}
                          </option>
                        ))}
                    </Selecao>
                    <BotaoEnviar variante="secundario">Incluir</BotaoEnviar>
                  </Formulario>
                </section>
              );
            })}
            {base.equipes.length === 0 && <p className="text-sm text-mudo">Crie equipes para ter regras diferentes por time (cada corretor fica em uma equipe só).</p>}
            {base.corretores.length === 0 && (
              <p className="text-xs text-mudo">
                Cadastre corretores e parceiros em{" "}
                <Link href="/pessoas/novo?papel=corretor" className="text-acento hover:underline">
                  Pessoas
                </Link>
                .
              </p>
            )}
          </div>
        </Cartao>
      </div>
    </>
  );
}
