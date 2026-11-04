import type { Metadata } from "next";
import Link from "next/link";
import { Formulario } from "@/components/formulario";
import { Aviso, Celula, LinhaVazia, Selecao, Tabela } from "@/components/ui";
import { contextoCorretor } from "../dados";
import { TopoCorretor } from "../topo";
import { ligarUsuarioCorretor } from "../actions";

export const metadata: Metadata = { title: "Usuários e corretores" };

const ROTULO_PAPEL: Record<string, string> = { admin: "Administrador", gestor: "Gestor", financeiro: "Financeiro", corretor: "Corretor" };

/**
 * Liga cada usuário do sistema ao cadastro de corretor dele (Pessoas, papel
 * Corretor): é isso que faz o portal do corretor mostrar só o que é dele.
 * Só administrador e gestor (o banco confere em ligar_membro_pessoa).
 */
export default async function EquipeCorretorPage({ searchParams }: PageProps<"/corretor/equipe">) {
  const ctx = await contextoCorretor(await searchParams);
  if (!ctx.gestao)
    return (
      <>
        <TopoCorretor ctx={ctx} titulo="Usuários e corretores" />
        <Aviso>Só administradores e gestores ligam usuários aos cadastros de corretor.</Aviso>
      </>
    );
  const { data: membros } = await ctx.supabase.from("membros").select("user_id, nome, papel, pessoa_id, created_at").eq("organizacao_id", ctx.organizacao.id).order("created_at");
  const lista = (membros ?? []) as { user_id: string; nome: string | null; papel: string; pessoa_id: string | null }[];
  return (
    <>
      <TopoCorretor ctx={ctx} titulo="Usuários e corretores" descricao="Escolha o cadastro de corretor de cada usuário. Usuário com papel Corretor só vê no portal o que está no cadastro ligado a ele." />
      <div className="mb-4">
        <Aviso>
          O cadastro do corretor fica em Pessoas, com o papel <b>Corretor</b>.{" "}
          <Link href="/pessoas?papel=corretor" className="text-acento hover:underline">
            Ver corretores
          </Link>
          . Cada cadastro pode estar ligado a um usuário só.
        </Aviso>
      </div>
      <Tabela colunas={["Usuário", "Papel", "Cadastro de corretor"]}>
        {lista.length === 0 && <LinhaVazia colunas={3}>Nenhum usuário.</LinhaVazia>}
        {lista.map((m) => (
          <tr key={m.user_id}>
            <Celula>
              <span className="font-medium">{m.nome ?? "Usuário sem nome"}</span>
              <span className="block font-mono text-[10.5px] text-mudo">{m.user_id.slice(0, 8)}</span>
            </Celula>
            <Celula>{ROTULO_PAPEL[m.papel] ?? m.papel}</Celula>
            <Celula>
              <Formulario acao={ligarUsuarioCorretor} automatico semAviso>
                <input type="hidden" name="user_id" value={m.user_id} />
                <Selecao name="pessoa_id" defaultValue={m.pessoa_id ?? ""} aria-label={`Cadastro de corretor de ${m.nome ?? "usuário"}`} className="max-w-72">
                  <option value="">— não é corretor —</option>
                  {ctx.corretores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Selecao>
              </Formulario>
            </Celula>
          </tr>
        ))}
      </Tabela>
      <p className="mt-3 text-xs text-mudo">As alterações são salvas sozinhas.</p>
    </>
  );
}
