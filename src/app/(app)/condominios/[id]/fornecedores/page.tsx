import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, Eye, FileSignature, Plus, X } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Campo, Cartao, Entrada, Grade, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { CATEGORIAS_DESPESA, COR_VALIDADE, PERIODICIDADES, contratoNoMes, situacaoValidade, type Periodicidade } from "@/lib/dominio/condominios";
import { formatarCompetencia, formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { criarContrato, excluirContrato, gerarPrevisoes, salvarContrato, tirarArquivoContrato } from "../../actions";
import { contasDo, opcoesPessoas } from "../../dados";
import { EnviarArquivoContrato } from "../../envios";

export const metadata: Metadata = { title: "Fornecedores do condomínio" };

type Contrato = {
  id: string;
  fornecedor_id: string | null;
  fornecedor_nome: string | null;
  servico: string;
  categoria: string;
  valor: number;
  periodicidade: Periodicidade;
  inicio: string;
  fim: string | null;
  dia_vencimento: number | null;
  reajuste_indice: string | null;
  reajuste_mes: number | null;
  conta_id: string | null;
  documento_path: string | null;
  ativo: boolean;
  observacoes: string | null;
  fornecedor: { nome: string; telefone: string | null } | null;
};

function CamposContrato({ k, pessoas, contas }: { k?: Contrato; pessoas: { id: string; nome: string; papeis: string[] | null }[]; contas: { id: string; nome: string }[] }) {
  const prestadores = [...pessoas].sort((a, b) => Number((b.papeis ?? []).includes("prestador")) - Number((a.papeis ?? []).includes("prestador")) || a.nome.localeCompare(b.nome, "pt-BR"));
  return (
    <Grade colunas={3}>
      <Campo rotulo="Fornecedor (Pessoas)">
        <Selecao name="fornecedor_id" defaultValue={k?.fornecedor_id ?? ""}>
          <option value="">— escrever o nome ao lado —</option>
          {prestadores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
              {(p.papeis ?? []).includes("prestador") ? " (prestador)" : ""}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Ou nome do fornecedor">
        <Entrada name="fornecedor_nome" defaultValue={k?.fornecedor_nome ?? ""} />
      </Campo>
      <Campo rotulo="Serviço">
        <Entrada name="servico" required defaultValue={k?.servico ?? ""} placeholder="Ex.: Manutenção dos elevadores" />
      </Campo>
      <Campo rotulo="Categoria da despesa">
        <Entrada name="categoria" list="categorias-forn" defaultValue={k?.categoria ?? "Manutenção"} />
      </Campo>
      <Campo rotulo="Valor (R$)">
        <Entrada name="valor" inputMode="decimal" defaultValue={k ? String(k.valor) : ""} />
      </Campo>
      <Campo rotulo="Periodicidade">
        <Selecao name="periodicidade" defaultValue={k?.periodicidade ?? "mensal"}>
          {Object.entries(PERIODICIDADES).map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Início da vigência">
        <Entrada name="inicio" type="date" required defaultValue={k?.inicio ?? hojeISO()} />
      </Campo>
      <Campo rotulo="Fim da vigência">
        <Entrada name="fim" type="date" defaultValue={k?.fim ?? ""} />
      </Campo>
      <Campo rotulo="Dia do vencimento">
        <Entrada name="dia_vencimento" type="number" min={1} max={31} defaultValue={k?.dia_vencimento ?? ""} />
      </Campo>
      <Campo rotulo="Reajuste (índice)">
        <Entrada name="reajuste_indice" defaultValue={k?.reajuste_indice ?? ""} placeholder="IGP-M, IPCA…" />
      </Campo>
      <Campo rotulo="Mês do reajuste">
        <Selecao name="reajuste_mes" defaultValue={k?.reajuste_mes ?? ""}>
          <option value="">—</option>
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>
              {String(i + 1).padStart(2, "0")}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Paga pela conta">
        <Selecao name="conta_id" defaultValue={k?.conta_id ?? ""}>
          <option value="">Conta corrente</option>
          {contas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Selecao>
      </Campo>
    </Grade>
  );
}

/** Contratos com fornecedores: geram as previsões de despesa do mês e avisam o fim da vigência. */
export default async function FornecedoresPage({ params }: PageProps<"/condominios/[id]/fornecedores">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const hoje = hojeISO();
  const mes = hoje.slice(0, 7);
  const [{ data }, pessoas, contas] = await Promise.all([
    supabase.from("cond_contratos_fornecedores").select("*, fornecedor:pessoas(nome, telefone)").eq("condominio_id", id).order("ativo", { ascending: false }).order("servico"),
    opcoesPessoas(supabase),
    contasDo(supabase, id),
  ]);
  const lista = (data ?? []) as unknown as Contrato[];
  // Arquivo do contrato: bucket privado, aberto por link assinado de 10 minutos.
  const caminhos = lista.map((k) => k.documento_path).filter((p): p is string => Boolean(p));
  const { data: links } = caminhos.length ? await supabase.storage.from("condominios").createSignedUrls(caminhos, 600) : { data: [] };
  const urlArquivo = new Map((links ?? []).map((l) => [l.path, l.signedUrl]));
  const doMes = lista.filter((k) => k.ativo && contratoNoMes(k, `${mes}-01`));
  const totalMes = doMes.reduce((a, k) => a + Number(k.valor), 0);

  return (
    <div className="space-y-5">
      <datalist id="categorias-forn">
        {CATEGORIAS_DESPESA.map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-texto-2">
          {doMes.length} contrato(s) vencem em {formatarCompetencia(`${mes}-01`)}: {formatarReais(totalMes)}.
        </p>
        <div className="flex flex-wrap gap-2">
          <BotaoAcao acao={gerarPrevisoes} id={`${id}|${mes}`} confirmar={`Criar as despesas previstas de ${formatarCompetencia(`${mes}-01`)} a partir dos contratos (${formatarReais(totalMes)})? Quem já tem a despesa do mês não é repetido.`}>
            <CalendarPlus className="size-4" /> Prever despesas do mês
          </BotaoAcao>
          <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Novo contrato</>} titulo="Contrato com fornecedor" acao={criarContrato} icone={<FileSignature />} larguraMax="max-w-3xl">
            <input type="hidden" name="condominio_id" value={id} />
            <CamposContrato pessoas={pessoas} contas={contas} />
            <Campo rotulo="Observações">
              <Entrada name="observacoes" />
            </Campo>
          </JanelaCadastro>
        </div>
      </div>

      {lista.length === 0 && (
        <Cartao>
          <p className="text-sm text-mudo">Nenhum contrato. Cadastre limpeza, portaria, elevadores, jardinagem, seguro… e o sistema prevê as despesas de cada mês.</p>
        </Cartao>
      )}
      {lista.map((k) => {
        const v = situacaoValidade(k.fim, hoje);
        return (
          <Cartao
            key={k.id}
            titulo={
              <span className="flex flex-wrap items-center gap-2">
                {k.servico} · {k.fornecedor?.nome ?? k.fornecedor_nome ?? "fornecedor"}
                <span className="text-sm font-normal text-texto-2">
                  {formatarReais(k.valor)} {PERIODICIDADES[k.periodicidade].toLowerCase()}
                </span>
                {!k.ativo && <Selo cor="cinza">encerrado</Selo>}
                {k.ativo && v.situacao && v.situacao !== "ok" && <Selo cor={COR_VALIDADE[v.situacao]}>{v.situacao === "vencido" ? "vigência terminou" : `termina em ${v.dias} dia(s)`}</Selo>}
              </span>
            }
            acoes={<BotaoExcluir acao={excluirContrato} id={k.id} rotulo="Excluir contrato" confirmar={`Excluir o contrato de ${k.servico}? As despesas já lançadas ficam no livro-caixa.`} />}
          >
            <Formulario acao={salvarContrato} automatico>
              <input type="hidden" name="id" value={k.id} />
              <input type="hidden" name="condominio_id" value={id} />
              <CamposContrato k={k} pessoas={pessoas} contas={contas} />
              <div className="flex flex-wrap items-center gap-4">
                <label className="flex items-center gap-2 text-sm text-texto-2">
                  <input type="hidden" name="ativo" value="off" />
                  <input type="checkbox" name="ativo" defaultChecked={k.ativo} className="size-4 accent-[var(--accent)]" /> Contrato ativo
                </label>
                <Entrada name="observacoes" defaultValue={k.observacoes ?? ""} placeholder="Observações" aria-label="Observações do contrato" className="max-w-md" />
                {k.fim && <span className="text-xs text-mudo">Vigência até {formatarDataBR(k.fim)}</span>}
                <Link href={`/condominios/${id}/financeiro`} className="text-xs text-acento hover:underline">
                  ver despesas no Financeiro
                </Link>
              </div>
            </Formulario>
            {/* Fora do formulário que salva sozinho (o arquivo sobe direto para o Storage). */}
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-borda pt-3">
              <span className="text-xs text-mudo">{k.documento_path ? "Arquivo do contrato:" : "Sem o arquivo do contrato."}</span>
              {k.documento_path && urlArquivo.get(k.documento_path) && (
                <a href={urlArquivo.get(k.documento_path)!} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                  <Eye className="size-3.5" /> Abrir o contrato
                </a>
              )}
              <EnviarArquivoContrato organizacaoId={organizacao.id} condominioId={id} contratoId={k.id} temArquivo={Boolean(k.documento_path)} />
              {k.documento_path && (
                <BotaoAcao acao={tirarArquivoContrato} id={k.id} tamanho="sm" variante="fantasma" confirmar="Tirar o arquivo deste contrato? O arquivo é apagado.">
                  <X className="size-3.5" /> Tirar arquivo
                </BotaoAcao>
              )}
            </div>
          </Cartao>
        );
      })}
    </div>
  );
}
