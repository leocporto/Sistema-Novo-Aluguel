import type { Metadata } from "next";
import { FileText, Plus, Receipt, Sparkles } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { NavegadorMes, lerMes } from "@/components/navegador-mes";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, Cabecalho, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { AbasFinanceiro } from "../abas";
import { criarNota, excluirNota, gerarNotasDasTaxas } from "../actions";

export const metadata: Metadata = { title: "Notas fiscais" };

const ROTULO_STATUS_NOTA: Record<string, string> = { a_emitir: "A emitir", emitida: "Emitida", cancelada: "Cancelada" };
const COR = { a_emitir: "amarelo", emitida: "verde", cancelada: "cinza" } as const;
const FILTROS: Record<string, string> = { "": "Todas", a_emitir: "A emitir", emitida: "Emitidas", cancelada: "Canceladas" };

type Nota = { id: string; numero: string | null; competencia: string; emitida_em: string | null; tomador_nome: string; descricao: string; valor_servicos: number; valor_iss: number; status: keyof typeof COR };

export default async function NotasPage({ searchParams }: PageProps<"/financeiro/notas">) {
  const sp = await searchParams;
  const hoje = hojeISO();
  const mes = lerMes(sp.mes, hoje);
  const status = typeof sp.status === "string" && sp.status in FILTROS ? sp.status : "";
  const { supabase, organizacao } = await obterContexto();
  const q = supabase.from("notas_fiscais").select("id, numero, competencia, emitida_em, tomador_nome, descricao, valor_servicos, valor_iss, status").eq("competencia", `${mes}-01`).order("created_at");
  const [{ data }, { data: pessoas }, { data: org }] = await Promise.all([
    q,
    supabase.from("pessoas").select("id, nome").order("nome").limit(2000),
    supabase.from("organizacoes").select("aliquota_iss").eq("id", organizacao.id).single(),
  ]);
  // Indicadores sobre o mês inteiro; a pílula só filtra a lista.
  const todasDoMes = (data ?? []) as Nota[];
  const lista = status ? todasDoMes.filter((n) => n.status === status) : todasDoMes;
  const validas = todasDoMes.filter((n) => n.status !== "cancelada");
  const total = paraReais(validas.reduce((a, n) => a + paraCentavos(n.valor_servicos), 0));
  const iss = paraReais(validas.reduce((a, n) => a + paraCentavos(n.valor_iss), 0));
  const url = (k: string) => `/financeiro/notas?mes=${mes}${k ? `&status=${k}` : ""}`;

  return (
    <>
      <Cabecalho
        titulo="Notas fiscais"
        trilha="Financeiro"
        descricao="Controle das notas de serviço (NFS-e) da imobiliária: o que falta emitir, número, código de verificação e ISS do mês."
        acoes={
          <>
            <BotaoAcao acao={gerarNotasDasTaxas} id={`${mes}-01`} confirmar="Criar as notas a emitir das taxas de administração deste mês (uma por proprietário)?">
              <Sparkles className="size-4" /> Gerar das taxas do mês
            </BotaoAcao>
            <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova nota</>} titulo="Nova nota de serviço" acao={criarNota} icone={<Receipt />} larguraMax="max-w-2xl">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Tomador (cliente cadastrado)">
                  <Selecao name="tomador_id" defaultValue="">
                    <option value="">—</option>
                    {(pessoas ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Nome do tomador">
                  <Entrada name="tomador_nome" required placeholder="Como sai na nota" />
                </Campo>
                <Campo rotulo="CPF/CNPJ do tomador">
                  <Entrada name="tomador_documento" />
                </Campo>
                <Campo rotulo="Mês de competência">
                  <Entrada type="month" name="competencia" defaultValue={mes} />
                </Campo>
                <Campo rotulo="Valor do serviço (R$)">
                  <Entrada name="valor_servicos" required inputMode="decimal" />
                </Campo>
                <Campo rotulo="Alíquota ISS (%)">
                  <Entrada name="aliquota_iss" inputMode="decimal" defaultValue={String(org?.aliquota_iss ?? 0).replace(".", ",")} />
                </Campo>
              </div>
              <Campo rotulo="Descrição do serviço">
                <Entrada name="descricao" required defaultValue="Serviços de administração de imóveis" />
              </Campo>
            </JanelaCadastro>
          </>
        }
      />
      <AbasFinanceiro pessoal={false} />
      <div className="mb-4">
        <Aviso tipo="info">
          A nota oficial é emitida no site da prefeitura (ou pelo seu contador). Aqui você controla o que falta, guarda número, código e link, e imprime o espelho. A emissão automática
          precisa de um provedor de NFS-e contratado (ex.: Focus NFe, eNotas, NFE.io) — dá para ligar depois.
        </Aviso>
      </div>
      <div className="mb-5">
        <NavegadorMes caminho="/financeiro/notas" mes={mes} hoje={hoje} extra={{ status: status || undefined }} />
      </div>
      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="A emitir" icone={<FileText />} valor={<Contador valor={todasDoMes.filter((n) => n.status === "a_emitir").length} />} tom="alerta" href={url("a_emitir")} />
        <Indicador rotulo="Valor dos serviços" icone={<Receipt />} valor={<Contador valor={total} formato="moeda" />} />
        <Indicador rotulo="ISS do mês" icone={<Receipt />} valor={<Contador valor={iss} formato="moeda" />} />
      </div>
      <PilulasLink className="mb-4" rotulo="Situação" ativo={url(status)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
      <Tabela colunas={["Nº", "Tomador", "Serviço", "Valor", "ISS", "Situação", ""]}>
        {lista.map((n) => (
          <LinhaLink key={n.id} href={`/financeiro/notas/${n.id}`}>
            <Celula>{n.numero ?? "—"}</Celula>
            <Celula className="font-medium text-texto">{n.tomador_nome}</Celula>
            <Celula>
              <span className="text-xs text-texto-2">{n.descricao}</span>
            </Celula>
            <Celula className="tabular-nums">{formatarReais(n.valor_servicos)}</Celula>
            <Celula className="tabular-nums">{formatarReais(n.valor_iss)}</Celula>
            <Celula>
              <Selo cor={COR[n.status]}>{n.status === "emitida" && n.emitida_em ? `emitida ${formatarDataBR(n.emitida_em)}` : ROTULO_STATUS_NOTA[n.status]}</Selo>
            </Celula>
            <Celula>
              <BotaoExcluir acao={excluirNota} id={n.id} rotulo="Excluir nota" confirmar={`Excluir a nota de ${n.tomador_nome}?`} />
            </Celula>
          </LinhaLink>
        ))}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhuma nota neste mês.</LinhaVazia>}
      </Tabela>
    </>
  );
}
