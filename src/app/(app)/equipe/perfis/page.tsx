import type { Metadata } from "next";
import { ShieldCheck, ShieldPlus } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Aviso, Cabecalho, Campo, Celula, Entrada, Selecao, Selo, Tabela } from "@/components/ui";
import { PAPEIS_USUARIO, ROTULO_MODULO, ROTULO_PAPEL_USUARIO, diferencasDoPadrao } from "@/lib/dominio/equipe";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../abas";
import { criarPerfil } from "../actions";
import { carregarEstrutura, carregarMembros, contextoEquipe } from "../dados";

export const metadata: Metadata = { title: "Perfis de acesso" };

export default async function PerfisPage() {
  await exigirVerRota("/equipe");
  const { supabase, papel } = await contextoEquipe();
  const admin = papel === "admin";
  const [estrutura, membros] = await Promise.all([carregarEstrutura(supabase), carregarMembros(supabase)]);
  const usam = (id: string, padrao: boolean, papelBase: string) =>
    membros.filter((m) => m.papel !== "admin" && (m.perfil_id === id || (padrao && !m.perfil_id && m.papel === papelBase))).length;

  return (
    <>
      <Cabecalho
        titulo="Perfis de acesso"
        trilha="Equipe"
        descricao="O papel (gestor, financeiro, corretor) é a base. Cada papel tem um perfil padrão que você pode ajustar, e dá para criar perfis próprios — por módulo do sistema e por operação (ver, criar, editar, excluir, aprovar)."
        acoes={
          admin && (
            <JanelaCadastro rotuloBotao={<><ShieldPlus className="size-4" /> Novo perfil</>} titulo="Novo perfil de acesso" acao={criarPerfil} icone={<ShieldPlus />} rotuloSalvar="Criar e ajustar">
              <Campo rotulo="Nome">
                <Entrada name="nome" required placeholder="Corretor de vendas, Recepção, Estagiário…" />
              </Campo>
              <Campo rotulo="Papel base" dica="Usado para quem aprova 'por papel' e como ponto de partida das permissões.">
                <Selecao name="papel_base" defaultValue="corretor">
                  {PAPEIS_USUARIO.filter((p) => p !== "admin").map((p) => (
                    <option key={p} value={p}>
                      {ROTULO_PAPEL_USUARIO[p]}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Começar copiando de">
                <Selecao name="copiar_de" defaultValue="">
                  <option value="">Padrão do papel base</option>
                  {estrutura.perfis.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Descrição">
                <Entrada name="descricao" />
              </Campo>
            </JanelaCadastro>
          )
        }
      />
      <AbasEquipe />
      {!admin && (
        <div className="mb-4">
          <Aviso>Só o administrador muda os perfis. Você pode ver o que cada um libera.</Aviso>
        </div>
      )}
      <Tabela colunas={["Perfil", "Papel base", "Quem usa", "Diferença do padrão do papel"]}>
        <tr>
          <Celula>
            <span className="flex items-center gap-2 font-medium text-texto">
              <ShieldCheck className="size-4 text-acento" /> Administrador
            </span>
            <span className="block text-xs text-mudo">Acesso total, sempre (inclusive perfis e usuários).</span>
          </Celula>
          <Celula>{ROTULO_PAPEL_USUARIO.admin}</Celula>
          <Celula>{membros.filter((m) => m.papel === "admin").length}</Celula>
          <Celula className="text-xs text-mudo">—</Celula>
        </tr>
        {estrutura.perfis.map((p) => {
          const dif = diferencasDoPadrao(p.papel_base, p.permissoes);
          return (
            <LinhaLink key={p.id} href={`/equipe/perfis/${p.id}`}>
              <Celula>
                <span className="flex items-center gap-2 font-medium text-texto">
                  {p.nome} {p.padrao && <Selo cor="azul">padrão</Selo>}
                </span>
                {p.descricao && <span className="block text-xs text-mudo">{p.descricao}</span>}
              </Celula>
              <Celula>{ROTULO_PAPEL_USUARIO[p.papel_base]}</Celula>
              <Celula>{usam(p.id, p.padrao, p.papel_base)}</Celula>
              <Celula className="text-xs text-texto-2">
                {dif.length === 0
                  ? "igual ao padrão"
                  : dif
                      .slice(0, 3)
                      .map((d) => `${ROTULO_MODULO[d.modulo]}: ${[...d.mais.map((o) => `+${o}`), ...d.menos.map((o) => `−${o}`)].join(" ")}`)
                      .join(" · ") + (dif.length > 3 ? ` · e mais ${dif.length - 3}` : "")}
              </Celula>
            </LinhaLink>
          );
        })}
      </Tabela>
    </>
  );
}
