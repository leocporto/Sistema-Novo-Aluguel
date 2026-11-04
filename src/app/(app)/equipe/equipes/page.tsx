import type { Metadata } from "next";
import Link from "next/link";
import { Building2, UserPlus, Users } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Cabecalho, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { hojeISO } from "@/lib/dominio/datas";
import { UFS } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../abas";
import { colocarNaEquipe, criarEquipe, criarFilial, excluirEquipe, excluirFilial, salvarEquipe, salvarFilial, tirarDaEquipe } from "../actions";
import { carregarColaboradores, carregarEstrutura, carregarMembros, contextoEquipe, opcoesColaboradores, type Filial } from "../dados";

export const metadata: Metadata = { title: "Equipes e filiais" };

const pequeno = "!min-h-10 !text-sm";

function CamposFilial({ f, opcoes }: { f?: Filial; opcoes: { id: string; nome: string }[] }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Nome">
          <Entrada name="nome" required defaultValue={f?.nome ?? ""} />
        </Campo>
        <Campo rotulo="Código (opcional)">
          <Entrada name="codigo" defaultValue={f?.codigo ?? ""} />
        </Campo>
        <Campo rotulo="Cidade">
          <Entrada name="cidade" defaultValue={f?.cidade ?? ""} />
        </Campo>
        <Campo rotulo="UF">
          <Selecao name="uf" defaultValue={f?.uf ?? ""}>
            <option value="">—</option>
            {UFS.map((u) => (
              <option key={u}>{u}</option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Endereço">
          <Entrada name="endereco" defaultValue={f?.endereco ?? ""} />
        </Campo>
        <Campo rotulo="Telefone">
          <Entrada name="telefone" defaultValue={f?.telefone ?? ""} />
        </Campo>
        <Campo rotulo="E-mail">
          <Entrada name="email" type="email" defaultValue={f?.email ?? ""} />
        </Campo>
        <Campo rotulo="Gestor da filial">
          <Selecao name="gestor_id" defaultValue={f?.gestor_id ?? ""}>
            <option value="">—</option>
            {opcoes.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
    </>
  );
}

export default async function EquipesPage() {
  await exigirVerRota("/equipe");
  const { supabase, pode } = await contextoEquipe();
  const hoje = hojeISO();
  const podeEditar = pode("equipe", "editar");
  const membros = await carregarMembros(supabase);
  const [estrutura, colaboradores] = await Promise.all([carregarEstrutura(supabase), carregarColaboradores(supabase, membros)]);
  // Carteira de cada filial (imóveis, contratos e leads ganham a filial do corretor/imóvel sozinhos). Contagem no banco.
  const carteiraFilial = new Map(
    await Promise.all(
      estrutura.filiais.slice(0, 50).map(async (f) => {
        const [im, ct, ld] = await Promise.all([
          supabase.from("imoveis").select("id", { count: "exact", head: true }).eq("filial_id", f.id).neq("status", "inativo"),
          supabase.from("contratos").select("id", { count: "exact", head: true }).eq("filial_id", f.id).eq("status", "ativo"),
          supabase.from("leads").select("id", { count: "exact", head: true }).eq("filial_id", f.id).not("status", "in", "(ganho,perdido)"),
        ]);
        return [f.id, { imoveis: im.count ?? 0, contratos: ct.count ?? 0, leads: ld.count ?? 0 }] as const;
      }),
    ),
  );
  const opcoes = opcoesColaboradores(colaboradores, hoje);
  const nomePessoa = new Map(colaboradores.map((c) => [c.id, c.nome]));
  const nomeFilial = new Map(estrutura.filiais.map((f) => [f.id, f.nome]));

  return (
    <>
      <Cabecalho
        titulo="Equipes e filiais"
        trilha="Equipe"
        descricao="Organize a imobiliária em filiais e equipes, com gestor em cada uma. As equipes também valem para as regras de comissão e para a fila de leads. Leads e imóveis ficam na filial do corretor responsável, e os contratos na filial do imóvel."
        acoes={
          podeEditar && (
            <>
              <JanelaCadastro rotuloBotao={<><Building2 className="size-4" /> Nova filial</>} variante="secundario" titulo="Nova filial" acao={criarFilial} icone={<Building2 />} larguraMax="max-w-2xl">
                <CamposFilial opcoes={opcoes} />
              </JanelaCadastro>
              <JanelaCadastro rotuloBotao={<><Users className="size-4" /> Nova equipe</>} titulo="Nova equipe" acao={criarEquipe} icone={<Users />}>
                <Campo rotulo="Nome">
                  <Entrada name="nome" required placeholder="Locação Centro, Vendas alto padrão…" />
                </Campo>
                <Campo rotulo="Filial">
                  <Selecao name="filial_id" defaultValue="">
                    <option value="">Sem filial</option>
                    {estrutura.filiais.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Gestor (líder) da equipe">
                  <Selecao name="lider_id" defaultValue="">
                    <option value="">—</option>
                    {opcoes.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Descrição">
                  <AreaTexto name="descricao" rows={2} />
                </Campo>
              </JanelaCadastro>
            </>
          )
        }
      />
      <AbasEquipe />

      <h2 className="mb-3 text-[17px] font-semibold text-texto">Filiais</h2>
      {estrutura.filiais.length === 0 ? (
        <p className="mb-8 rounded-card border border-borda bg-card px-5 py-6 text-sm text-mudo">Nenhuma filial. Se a imobiliária tem uma loja só, não precisa cadastrar.</p>
      ) : (
        <div className="entrar-cascata mb-8 grid gap-4 lg:grid-cols-2">
          {estrutura.filiais.map((f) => {
            const equipes = estrutura.equipes.filter((e) => e.filial_id === f.id).length;
            const pessoas = colaboradores.filter((c) => c.filial_id === f.id).length;
            return (
              <Cartao
                key={f.id}
                titulo={
                  <span className="flex items-center gap-2">
                    {f.nome} {!f.ativa && <Selo>inativa</Selo>}
                  </span>
                }
                acoes={podeEditar ? <BotaoExcluir acao={excluirFilial} id={f.id} rotulo="Excluir filial" confirmar={`Excluir a filial ${f.nome}? Equipes, colaboradores, imóveis e contratos ficam sem filial.`} /> : undefined}
              >
                <p className="mb-3 text-xs text-mudo">
                  {pessoas} colaborador(es) · {equipes} equipe(s)
                  {f.gestor_id && ` · gestor: ${nomePessoa.get(f.gestor_id) ?? "—"}`}
                  {carteiraFilial.has(f.id) &&
                    ` · ${carteiraFilial.get(f.id)?.imoveis} imóvel(is) · ${carteiraFilial.get(f.id)?.contratos} contrato(s) em vigor · ${carteiraFilial.get(f.id)?.leads} lead(s) em aberto`}
                </p>
                {podeEditar ? (
                  <Formulario acao={salvarFilial} automatico semAviso className="space-y-4">
                    <input type="hidden" name="id" value={f.id} />
                    <CamposFilial f={f} opcoes={opcoes} />
                    <label className="flex items-center gap-2 text-sm text-texto">
                      <input type="hidden" name="ativa" value="" />
                      <input type="checkbox" name="ativa" defaultChecked={f.ativa} /> Filial ativa
                    </label>
                  </Formulario>
                ) : (
                  <p className="text-sm text-texto-2">{[f.endereco, f.cidade, f.uf, f.telefone].filter(Boolean).join(" · ") || "—"}</p>
                )}
              </Cartao>
            );
          })}
        </div>
      )}

      <h2 className="mb-3 text-[17px] font-semibold text-texto">Equipes</h2>
      {estrutura.equipes.length === 0 ? (
        <p className="rounded-card border border-borda bg-card px-5 py-6 text-sm text-mudo">Nenhuma equipe ainda.</p>
      ) : (
        <div className="entrar-cascata grid gap-4 lg:grid-cols-2">
          {estrutura.equipes.map((e) => {
            const membros = estrutura.membrosEquipe.filter((m) => m.equipe_id === e.id);
            return (
              <Cartao
                key={e.id}
                titulo={
                  <span className="flex items-center gap-2">
                    {e.nome} {!e.ativa && <Selo>inativa</Selo>}
                  </span>
                }
                acoes={
                  podeEditar ? <BotaoExcluir acao={excluirEquipe} id={e.id} rotulo="Excluir equipe" confirmar={`Excluir a equipe ${e.nome}? As pessoas continuam cadastradas, só saem da equipe.`} /> : undefined
                }
              >
                {podeEditar ? (
                  <Formulario acao={salvarEquipe} automatico semAviso className="mb-4 grid gap-3 sm:grid-cols-3">
                    <input type="hidden" name="id" value={e.id} />
                    <Entrada name="nome" required defaultValue={e.nome} aria-label="Nome da equipe" className={pequeno} />
                    <Selecao name="filial_id" defaultValue={e.filial_id ?? ""} aria-label="Filial da equipe" className={pequeno}>
                      <option value="">Sem filial</option>
                      {estrutura.filiais.map((f) => (
                        <option key={f.id} value={f.id}>
                          {f.nome}
                        </option>
                      ))}
                    </Selecao>
                    <Selecao name="lider_id" defaultValue={e.lider_id ?? ""} aria-label="Gestor da equipe" className={pequeno}>
                      <option value="">Sem gestor</option>
                      {opcoes.map((o) => (
                        <option key={o.id} value={o.id}>
                          Gestor: {o.nome}
                        </option>
                      ))}
                    </Selecao>
                    <Entrada name="descricao" defaultValue={e.descricao ?? ""} placeholder="Descrição" aria-label="Descrição da equipe" className={`${pequeno} sm:col-span-2`} />
                    <label className="flex items-center gap-2 text-sm text-texto">
                      <input type="hidden" name="ativa" value="" />
                      <input type="checkbox" name="ativa" defaultChecked={e.ativa} /> Ativa
                    </label>
                  </Formulario>
                ) : (
                  <p className="mb-3 text-xs text-mudo">
                    {e.filial_id ? nomeFilial.get(e.filial_id) : "Sem filial"} · gestor: {e.lider_id ? nomePessoa.get(e.lider_id) : "—"}
                  </p>
                )}
                <ul className="divide-y divide-borda-suave text-sm">
                  {membros.map((m) => (
                    <li key={m.id} className="flex items-center gap-2 py-2">
                      <Link href={`/equipe/colaboradores/${m.pessoa_id}`} className="flex-1 text-texto hover:underline">
                        {nomePessoa.get(m.pessoa_id) ?? "Pessoa"}
                      </Link>
                      {m.pessoa_id === e.lider_id && <Selo cor="azul">gestor</Selo>}
                      {podeEditar && <BotaoExcluir acao={tirarDaEquipe} id={m.id} rotulo="Tirar da equipe" confirmar={`Tirar ${nomePessoa.get(m.pessoa_id) ?? "esta pessoa"} da equipe ${e.nome}?`} />}
                    </li>
                  ))}
                  {membros.length === 0 && <li className="py-2 text-mudo">Ninguém na equipe ainda.</li>}
                </ul>
                {podeEditar && (
                  <div className="mt-3">
                    <JanelaCadastro rotuloBotao={<><UserPlus className="size-4" /> Colocar na equipe</>} variante="secundario" tamanho="sm" titulo={`Colocar na equipe ${e.nome}`} acao={colocarNaEquipe} icone={<UserPlus />} rotuloSalvar="Colocar">
                      <input type="hidden" name="equipe_id" value={e.id} />
                      <p className="text-sm text-texto-2">Cada pessoa fica em uma equipe só: se ela estiver em outra, muda para esta.</p>
                      <Campo rotulo="Colaborador">
                        <Selecao name="pessoa_id" required defaultValue="">
                          <option value="">Selecione…</option>
                          {opcoes
                            .filter((o) => !membros.some((m) => m.pessoa_id === o.id))
                            .map((o) => (
                              <option key={o.id} value={o.id}>
                                {o.nome}
                              </option>
                            ))}
                        </Selecao>
                      </Campo>
                    </JanelaCadastro>
                  </div>
                )}
              </Cartao>
            );
          })}
        </div>
      )}
    </>
  );
}
