import type { Metadata } from "next";
import { Table2 } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { AreaTexto, Cabecalho, Campo, Celula, Entrada, LinhaVazia, Selecao, Tabela } from "@/components/ui";
import { FONTES_BI, campoDaFonte, ehFonte, fontesDoModo, fontesPermitidas } from "@/lib/dominio/bi";
import { formatarDataLocal } from "@/lib/dominio/datas";
import { AbasRelatorios } from "../abas";
import { criarRelatorio } from "../actions";
import { ComoCalculamos } from "../componentes";
import { SELECT_SALVO, contextoRelatorios, type RelatorioSalvo } from "../dados";

export const metadata: Metadata = { title: "Relatórios personalizados" };

export default async function PersonalizadosPage() {
  const { supabase, imob, bi, perms } = await contextoRelatorios();
  // Só aparecem (e só rodam) os relatórios de fontes cujo módulo o perfil de acesso vê (o banco confere: privado.bi_pode_fonte).
  const { data } = await supabase.from("relatorios_salvos").select(SELECT_SALVO).order("nome").limit(500);
  const lista = (data ?? []) as RelatorioSalvo[];
  const fontes = fontesPermitidas(imob, perms);
  const escondidas = fontesDoModo(imob).filter((f) => !fontes.includes(f));

  return (
    <>
      <Cabecalho
        titulo="Relatórios personalizados"
        trilha="Relatórios"
        descricao="Monte a sua planilha: escolha de onde vêm os dados, as colunas, os filtros, o agrupamento e os totais. Fica salva para abrir, baixar ou programar o envio."
        acoes={
          bi.editar &&
          fontes.length > 0 && (
            <JanelaCadastro rotuloBotao={<><Table2 className="size-4" /> Novo relatório</>} titulo="Novo relatório personalizado" acao={criarRelatorio} icone={<Table2 />} rotuloSalvar="Criar e montar">
              <Campo rotulo="Nome">
                <Entrada name="nome" required maxLength={120} placeholder="Ex.: Contratos que vencem este ano" />
              </Campo>
              <Campo rotulo="De onde vêm os dados" dica="Depois você escolhe as colunas, os filtros e os totais.">
                <Selecao name="fonte" defaultValue="imoveis">
                  {fontes.map((f) => (
                    <option key={f} value={f}>
                      {FONTES_BI[f].rotulo} — {FONTES_BI[f].descricao}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Descrição (opcional)">
                <AreaTexto name="descricao" maxLength={1000} />
              </Campo>
            </JanelaCadastro>
          )
        }
      />
      <AbasRelatorios />
      <Tabela colunas={["Relatório", "Dados", "Colunas", "Agrupado por", "Atualizado em"]}>
        {lista.length === 0 && <LinhaVazia colunas={5}>{bi.editar ? "Nenhum relatório ainda. Clique em “Novo relatório” para montar o primeiro." : "Nenhum relatório personalizado ainda."}</LinhaVazia>}
        {lista.map((r) => {
          const fonte = ehFonte(r.fonte) ? r.fonte : null;
          return (
            <LinhaLink key={r.id} href={`/relatorios/personalizados/${r.id}`}>
              <Celula>
                <span className="font-medium">{r.nome}</span>
                {r.descricao && <span className="block max-w-md truncate text-xs text-mudo">{r.descricao}</span>}
              </Celula>
              <Celula>{fonte ? FONTES_BI[fonte].rotulo : r.fonte}</Celula>
              <Celula className="tabular-nums">{r.colunas.length}</Celula>
              <Celula>{r.agrupar_por && fonte ? (campoDaFonte(fonte, r.agrupar_por)?.rotulo ?? r.agrupar_por) : "—"}</Celula>
              <Celula>{formatarDataLocal(r.updated_at)}</Celula>
            </LinhaLink>
          );
        })}
      </Tabela>
      <ComoCalculamos
        itens={[
          ["Fontes", `Só dados do próprio sistema, de uma lista fechada: ${fontes.map((f) => FONTES_BI[f].rotulo.toLowerCase()).join(", ")}.`],
          [
            "Segurança",
            `${imob ? "Cada pessoa só vê os dados da imobiliária dela; o corretor vê só os leads, visitas e propostas dele." : "Só os dados da sua conta entram nos relatórios."} Cada fonte respeita o perfil de acesso: quem não vê um módulo (ex.: Financeiro) também não monta nem abre relatórios com os dados dele.${
              escondidas.length ? ` Fora do seu perfil: ${escondidas.map((f) => FONTES_BI[f].rotulo.toLowerCase()).join(", ")}.` : ""
            }`,
          ],
          ["Exportar", "Cada relatório sai em CSV, Excel ou PDF (impressão) e pode ser enviado sozinho pela aba Envios programados."],
        ]}
      />
    </>
  );
}
