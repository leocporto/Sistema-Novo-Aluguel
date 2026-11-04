import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RotateCcw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { Cabecalho, Campo, Cartao, Entrada, Grade, Selo } from "@/components/ui";
import { MODULOS, OPERACOES, ROTULO_OPERACAO, ROTULO_PAPEL_USUARIO, normalizarPermissoes } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../../abas";
import { excluirPerfil, restaurarPerfil, salvarPerfil } from "../../actions";
import { carregarMembros, contextoEquipe, nomeDoMembro, type Perfil } from "../../dados";

export const metadata: Metadata = { title: "Perfil de acesso" };

export default async function PerfilPage({ params }: PageProps<"/equipe/perfis/[id]">) {
  await exigirVerRota("/equipe");
  const { id } = await params;
  const { supabase, papel } = await contextoEquipe();
  const admin = papel === "admin";
  const [{ data }, membros] = await Promise.all([
    supabase.from("perfis_acesso").select("id, nome, descricao, papel_base, padrao, permissoes, updated_at").eq("id", id).maybeSingle(),
    carregarMembros(supabase),
  ]);
  if (!data) notFound();
  const p = data as Perfil;
  const perms = normalizarPermissoes(p.permissoes);
  const usam = membros.filter((m) => m.papel !== "admin" && (m.perfil_id === id || (p.padrao && !m.perfil_id && m.papel === p.papel_base)));
  const grupos = [...new Set(MODULOS.map((m) => m.grupo))];

  const matriz = (
    <div className="overflow-x-auto">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            <th className="border-b border-borda bg-elev px-4 py-3 text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mudo">Módulo</th>
            {OPERACOES.map((o) => (
              <th key={o} className="border-b border-borda bg-elev px-3 py-3 text-center font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mudo">
                {ROTULO_OPERACAO[o]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {grupos.map((g) => (
            <GrupoModulos key={g} grupo={g} perms={perms} editavel={admin} />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <Cabecalho
        titulo={p.nome}
        trilha="Perfis de acesso"
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            Papel base: {ROTULO_PAPEL_USUARIO[p.papel_base]} {p.padrao && <Selo cor="azul">perfil padrão do papel</Selo>}
          </span>
        }
        acoes={
          admin && (
            <>
              <BotaoAcao acao={restaurarPerfil} id={id} confirmar={`Voltar "${p.nome}" para as permissões padrão do papel ${ROTULO_PAPEL_USUARIO[p.papel_base]}?`}>
                <RotateCcw className="size-4" /> Voltar ao padrão
              </BotaoAcao>
              {!p.padrao && (
                <BotaoExcluir
                  acao={excluirPerfil}
                  id={id}
                  variante="botao"
                  rotulo="Excluir perfil"
                  confirmar={`Excluir o perfil "${p.nome}"? Quem usa volta para o perfil padrão do papel. (Se ele for o aprovador de alguma regra de aprovação, exclua a regra antes.)`}
                  depois="/equipe/perfis"
                />
              )}
            </>
          )
        }
      />
      <AbasEquipe />
      <div className="space-y-6">
        {admin ? (
          <Formulario acao={salvarPerfil} automatico>
            <input type="hidden" name="id" value={id} />
            <Cartao titulo="Nome">
              <Grade colunas={2}>
                <Campo rotulo="Nome do perfil">
                  <Entrada name="nome" required defaultValue={p.nome} />
                </Campo>
                <Campo rotulo="Descrição">
                  <Entrada name="descricao" defaultValue={p.descricao ?? ""} />
                </Campo>
              </Grade>
            </Cartao>
            <Cartao titulo="Permissões por módulo">
              <p className="mb-3 text-sm text-texto-2">Marque o que este perfil pode fazer. Marcar qualquer operação já libera “Ver”. Telas que somem do menu dependem desta lista.</p>
              {matriz}
            </Cartao>
          </Formulario>
        ) : (
          <Cartao titulo="Permissões por módulo">{matriz}</Cartao>
        )}
        <Cartao titulo={`Quem usa este perfil (${usam.length})`}>
          {usam.length === 0 ? (
            <p className="text-sm text-mudo">Ninguém. Escolha o perfil na ficha do colaborador (aba Dados e acesso).</p>
          ) : (
            <ul className="flex flex-wrap gap-2">
              {usam.map((m) => (
                <li key={m.user_id}>
                  {m.pessoa_id ? (
                    <Link href={`/equipe/colaboradores/${m.pessoa_id}`} className="rounded-full border border-borda px-3 py-1 text-sm text-texto hover:border-borda-forte">
                      {nomeDoMembro(m)}
                    </Link>
                  ) : (
                    <span className="rounded-full border border-borda px-3 py-1 text-sm text-texto">{nomeDoMembro(m)}</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
    </>
  );
}

function GrupoModulos({ grupo, perms, editavel }: { grupo: string; perms: Record<string, string[]>; editavel: boolean }) {
  return (
    <>
      <tr>
        <td colSpan={OPERACOES.length + 1} className="px-4 pb-1 pt-4 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-acento-hot">
          {grupo}
        </td>
      </tr>
      {MODULOS.filter((m) => m.grupo === grupo).map((m) => (
        <tr key={m.id} className="hover:bg-card-hover">
          <td className="border-b border-borda-suave px-4 py-2.5 text-texto">{m.rotulo}</td>
          {OPERACOES.map((o) => (
            <td key={o} className="border-b border-borda-suave px-3 py-2.5 text-center">
              {(m.operacoes as readonly string[]).includes(o) ? (
                editavel ? (
                  <input type="checkbox" name="perm" value={`${m.id}:${o}`} defaultChecked={perms[m.id]?.includes(o)} aria-label={`${m.rotulo}: ${ROTULO_OPERACAO[o]}`} className="size-4 accent-[var(--accent)]" />
                ) : perms[m.id]?.includes(o) ? (
                  <span className="text-ok">✓</span>
                ) : (
                  <span className="text-fraco">·</span>
                )
              ) : (
                <span className="text-fraco">—</span>
              )}
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}
