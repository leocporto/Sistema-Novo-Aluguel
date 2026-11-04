import type { Metadata } from "next";
import { CheckCheck, Megaphone, Pin } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Cabecalho, Campo, Entrada, Selecao, Selo } from "@/components/ui";
import { formatarDataBR, formatarDataLocal, hojeISO } from "@/lib/dominio/datas";
import { PAPEIS_USUARIO, PUBLICOS_AVISO, ROTULO_PAPEL_USUARIO, avisoParaMim } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../abas";
import { alternarFixado, confirmarLeitura, excluirAviso, publicarAviso } from "../actions";
import { carregarColaboradores, carregarEstrutura, carregarMembros, contextoEquipe, nomeDoMembro } from "../dados";
import { AbasComunicacao } from "./abas";

export const metadata: Metadata = { title: "Comunicação interna" };

type Aviso = {
  id: string;
  titulo: string;
  texto: string;
  importante: boolean;
  fixado: boolean;
  exige_leitura: boolean;
  para: string;
  equipe_id: string | null;
  filial_id: string | null;
  papel: string | null;
  autor_id: string | null;
  expira_em: string | null;
  created_at: string;
  leituras: { user_id: string; lido_em: string }[];
};

export default async function MuralPage({ searchParams }: PageProps<"/equipe/comunicacao">) {
  await exigirVerRota("/equipe");
  const sp = await searchParams;
  const ver = sp.ver === "todos" ? "todos" : "meus";
  const hoje = hojeISO();
  const { supabase, usuario, papel, pode, minhaPessoa } = await contextoEquipe();
  const podePublicar = pode("equipe", "criar");
  const podeGerir = pode("equipe", "editar");
  const membros = await carregarMembros(supabase);
  const [{ data }, estrutura, colaboradores] = await Promise.all([
    supabase
      .from("equipe_avisos")
      .select("id, titulo, texto, importante, fixado, exige_leitura, para, equipe_id, filial_id, papel, autor_id, expira_em, created_at, leituras:equipe_aviso_leituras(user_id, lido_em)")
      .order("fixado", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
    carregarEstrutura(supabase),
    carregarColaboradores(supabase, membros),
  ]);
  const filialDe = new Map(colaboradores.map((c) => [c.id, c.filial_id]));
  const quem = (m: { papel: string; pessoa_id: string | null }) => ({
    papel: m.papel,
    equipeId: m.pessoa_id ? (estrutura.equipeDe.get(m.pessoa_id) ?? null) : null,
    filialId: m.pessoa_id ? (filialDe.get(m.pessoa_id) ?? null) : null,
  });
  const eu = quem({ papel, pessoa_id: minhaPessoa });
  const nomes = new Map(membros.map((m) => [m.user_id, nomeDoMembro(m)]));
  const avisos = ((data ?? []) as Aviso[]).filter((a) => ver === "todos" || a.autor_id === usuario.id || avisoParaMim(a, eu, hoje));
  const publico = (a: Aviso) => {
    if (a.para === "equipe") return a.equipe_id ? `equipe ${estrutura.equipes.find((e) => e.id === a.equipe_id)?.nome ?? "—"}` : "uma equipe que foi excluída (ninguém recebe)";
    if (a.para === "filial") return a.filial_id ? `filial ${estrutura.filiais.find((f) => f.id === a.filial_id)?.nome ?? "—"}` : "uma filial que foi excluída (ninguém recebe)";
    if (a.para === "papel") return `só ${ROTULO_PAPEL_USUARIO[a.papel ?? ""]?.toLowerCase() ?? "—"}`;
    return "toda a equipe";
  };

  return (
    <>
      <Cabecalho
        titulo="Comunicação interna"
        trilha="Equipe"
        descricao="Mural de avisos com confirmação de leitura e mensagens diretas entre colegas."
        acoes={
          podePublicar && (
            <JanelaCadastro rotuloBotao={<><Megaphone className="size-4" /> Publicar aviso</>} titulo="Novo aviso no mural" acao={publicarAviso} icone={<Megaphone />} rotuloSalvar="Publicar">
              <Campo rotulo="Título">
                <Entrada name="titulo" required />
              </Campo>
              <Campo rotulo="Aviso">
                <AreaTexto name="texto" required rows={4} />
              </Campo>
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Para quem">
                  <Selecao name="para" defaultValue="todos">
                    {Object.entries(PUBLICOS_AVISO).map(([k, r]) => (
                      <option key={k} value={k}>
                        {r}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Some do mural em (opcional)">
                  <Entrada type="date" name="expira_em" />
                </Campo>
                <Campo rotulo="Equipe (se for para uma equipe)">
                  <Selecao name="equipe_id" defaultValue="">
                    <option value="">—</option>
                    {estrutura.equipes.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Filial (se for para uma filial)">
                  <Selecao name="filial_id" defaultValue="">
                    <option value="">—</option>
                    {estrutura.filiais.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Papel (se for para um papel)">
                  <Selecao name="papel" defaultValue="">
                    <option value="">—</option>
                    {PAPEIS_USUARIO.map((p) => (
                      <option key={p} value={p}>
                        {ROTULO_PAPEL_USUARIO[p]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>
              <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-texto">
                <label className="flex items-center gap-2">
                  <input type="hidden" name="exige_leitura" value="" />
                  <input type="checkbox" name="exige_leitura" defaultChecked /> Pedir confirmação de leitura
                </label>
                <label className="flex items-center gap-2">
                  <input type="hidden" name="importante" value="" />
                  <input type="checkbox" name="importante" /> Importante
                </label>
                <label className="flex items-center gap-2">
                  <input type="hidden" name="fixado" value="" />
                  <input type="checkbox" name="fixado" /> Fixar no topo
                </label>
              </div>
            </JanelaCadastro>
          )
        }
      />
      <AbasEquipe />
      <AbasComunicacao />
      {podeGerir && (
        <PilulasLink
          className="mb-4"
          rotulo="Quais avisos"
          ativo={ver === "todos" ? "/equipe/comunicacao?ver=todos" : "/equipe/comunicacao"}
          itens={[
            { href: "/equipe/comunicacao", rotulo: "Para mim" },
            { href: "/equipe/comunicacao?ver=todos", rotulo: "Todos os avisos" },
          ]}
        />
      )}
      {avisos.length === 0 ? (
        <div className="rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">Nenhum aviso no mural.</div>
      ) : (
        <ul className="entrar-cascata space-y-4">
          {avisos.map((a) => {
            const li = a.leituras.find((l) => l.user_id === usuario.id);
            const autor = a.autor_id === usuario.id;
            const alvo = membros.filter((m) => m.user_id !== a.autor_id && avisoParaMim({ ...a, expira_em: null }, quem(m), hoje));
            const lidos = alvo.filter((m) => a.leituras.some((l) => l.user_id === m.user_id));
            const faltam = alvo.filter((m) => !a.leituras.some((l) => l.user_id === m.user_id));
            const vencido = Boolean(a.expira_em && a.expira_em < hoje);
            return (
              <li key={a.id} className={`rounded-card border bg-card p-5 ${a.importante ? "border-alerta-bd" : "border-borda"}`}>
                <div className="flex flex-wrap items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {a.fixado && <Pin className="size-4 text-acento" aria-label="Fixado" />}
                      <h3 className="text-[16px] font-semibold text-texto">{a.titulo}</h3>
                      {a.importante && <Selo cor="amarelo">importante</Selo>}
                      {vencido && <Selo>expirado</Selo>}
                    </div>
                    <div className="mt-1 text-xs text-mudo">
                      {a.autor_id ? (nomes.get(a.autor_id) ?? "ex-usuário") : "—"} · {formatarDataLocal(a.created_at)} · para {publico(a)}
                      {a.expira_em && ` · até ${formatarDataBR(a.expira_em)}`}
                    </div>
                    <p className="mt-3 whitespace-pre-wrap text-[14px] leading-relaxed text-texto">{a.texto}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {(autor || podeGerir) && (
                      <BotaoAcao acao={alternarFixado} id={a.id} tamanho="sm">
                        {a.fixado ? "Desafixar" : "Fixar"}
                      </BotaoAcao>
                    )}
                    {(autor || podeGerir) && <BotaoExcluir acao={excluirAviso} id={a.id} rotulo="Excluir aviso" confirmar={`Excluir o aviso "${a.titulo}"?`} />}
                  </div>
                </div>
                {a.exige_leitura && (
                  <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-borda-suave pt-3 text-sm">
                    {!autor &&
                      (li ? (
                        <span className="flex items-center gap-1.5 text-ok">
                          <CheckCheck className="size-4" /> Você confirmou em {formatarDataLocal(li.lido_em)}
                        </span>
                      ) : (
                        <BotaoAcao acao={confirmarLeitura} id={a.id} variante="primario" tamanho="sm">
                          <CheckCheck className="size-4" /> Li e entendi
                        </BotaoAcao>
                      ))}
                    {(autor || podeGerir) && (
                      <span className="text-texto-2">
                        Lido por {lidos.length} de {alvo.length}
                        {faltam.length > 0 && <span className="text-mudo"> · falta: {faltam.slice(0, 8).map(nomeDoMembro).join(", ")}{faltam.length > 8 ? "…" : ""}</span>}
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
