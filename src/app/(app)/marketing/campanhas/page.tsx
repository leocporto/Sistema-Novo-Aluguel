import type { Metadata } from "next";
import { Megaphone } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Campo, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import {
  ROTULO_SITUACAO_CAMPANHA,
  ROTULO_TIPO_CAMPANHA,
  TIPOS_CAMPANHA,
  formatarDataHora,
  situacaoCampanha,
  type SituacaoCampanha,
  type TipoCampanha,
} from "@/lib/dominio/marketing";
import { criarCampanha, excluirCampanha } from "../actions";
import { AbasMarketing, SelecaoCanal, SeloCanal } from "../campos";
import { contagemVazia, contagensPorCampanha, type Campanha } from "../dados";

export const metadata: Metadata = { title: "Campanhas" };

const FILTROS: Record<string, string> = { "": "Todas", rascunho: "Rascunhos", agendada: "Agendadas", enviando: "Enviando", concluida: "Concluídas", cancelada: "Canceladas" };
const COR: Record<SituacaoCampanha, "cinza" | "amarelo" | "azul" | "verde"> = { rascunho: "cinza", agendada: "amarelo", enviando: "azul", concluida: "verde", cancelada: "cinza" };

export default async function CampanhasPage({ searchParams }: PageProps<"/marketing/campanhas">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("situacao") in FILTROS ? s("situacao") : "";
  const { supabase } = await obterContexto();
  const agora = agoraMs();
  const [{ data }, { data: modelos }, { data: imoveis }] = await Promise.all([
    supabase.from("mkt_campanhas").select("*, imovel:imoveis(codigo)").order("created_at", { ascending: false }).limit(500),
    supabase.from("mkt_modelos").select("id, nome, canal").eq("ativo", true).order("nome"),
    supabase.from("imoveis").select("id, codigo, bairro").eq("status", "disponivel").order("codigo").limit(2000),
  ]);
  const campanhas = (data ?? []) as (Campanha & { imovel: { codigo: string } | null })[];
  const cont = await contagensPorCampanha(
    supabase,
    campanhas.map((c) => c.id),
  );
  const linhas = campanhas
    .map((c) => {
      const n = cont.get(c.id) ?? contagemVazia();
      return { c, n, sit: situacaoCampanha(c, n.pendentes, agora) };
    })
    .filter((x) => !filtro || x.sit === filtro);
  const url = (k: string) => (k ? `/marketing/campanhas?situacao=${k}` : "/marketing/campanhas");

  return (
    <>
      <Cabecalho
        titulo="Campanhas"
        trilha="Marketing"
        descricao="Escolha o público por filtros (funil, etapa, origem, parados há X dias, papel, região, perfil de busca), o canal e a data. Quem pediu para não receber fica sempre de fora."
        acoes={
          <JanelaCadastro rotuloBotao={<><Megaphone className="size-4" /> Nova campanha</>} titulo="Nova campanha" acao={criarCampanha} icone={<Megaphone />} abertaInicial={s("novo") === "1"}>
            <Campo rotulo="Nome">
              <Entrada name="nome" required placeholder="Ex.: Reativação de novembro" />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Tipo">
                <Selecao name="tipo" defaultValue={s("tipo") || "manual"}>
                  {TIPOS_CAMPANHA.map((t) => (
                    <option key={t} value={t}>
                      {ROTULO_TIPO_CAMPANHA[t]}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Canal">
                <SelecaoCanal />
              </Campo>
            </div>
            <Campo rotulo="Modelo de mensagem (opcional)" dica="Sem modelo, a campanha começa com um texto pronto do tipo escolhido.">
              <Selecao name="modelo_id" defaultValue="">
                <option value="">— texto pronto do tipo —</option>
                {(modelos ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.nome} ({m.canal})
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Imóvel (para imóvel novo e redução de preço)">
              <Selecao name="imovel_id" defaultValue={s("imovel")}>
                <option value="">— nenhum —</option>
                {(imoveis ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.codigo}
                    {i.bairro ? ` — ${i.bairro}` : ""}
                  </option>
                ))}
              </Selecao>
            </Campo>
          </JanelaCadastro>
        }
      />
      <AbasMarketing />
      <PilulasLink className="mb-4" rotulo="Situação da campanha" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
      <Tabela colunas={["Campanha", "Canal", "Situação", "Enviadas", "Descadastrados", "Criada", ""]}>
        {linhas.map(({ c, n, sit }) => (
          <LinhaLink key={c.id} href={`/marketing/campanhas/${c.id}`}>
            <Celula>
              <span className="font-semibold text-texto">{c.nome}</span>
              <span className="block text-xs text-mudo">
                {ROTULO_TIPO_CAMPANHA[c.tipo as TipoCampanha] ?? c.tipo}
                {c.imovel ? ` · ${c.imovel.codigo}` : ""}
              </span>
            </Celula>
            <Celula>
              <SeloCanal canal={c.canal} />
            </Celula>
            <Celula>
              <Selo cor={COR[sit]}>{sit === "agendada" ? `Agendada ${formatarDataHora(c.agendada_para)}` : ROTULO_SITUACAO_CAMPANHA[sit]}</Selo>
            </Celula>
            <Celula className="tabular-nums">
              {n.enviados} de {n.total - n.bloqueados - n.falhas}
            </Celula>
            <Celula className="tabular-nums text-texto-2">{n.bloqueados || "—"}</Celula>
            <Celula className="text-xs text-texto-2">{formatarDataHora(c.created_at)}</Celula>
            <Celula>
              <BotaoExcluir acao={excluirCampanha} id={c.id} rotulo="Excluir campanha" confirmar={`Excluir a campanha "${c.nome}" e a fila dela?`} />
            </Celula>
          </LinhaLink>
        ))}
        {linhas.length === 0 && <LinhaVazia colunas={7}>Nenhuma campanha aqui.</LinhaVazia>}
      </Tabela>
    </>
  );
}
