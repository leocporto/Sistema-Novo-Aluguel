import type { Metadata } from "next";
import { ArrowDownCircle, ArrowUpCircle, Download, FileSpreadsheet, HardDrive, TriangleAlert } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { Formulario } from "@/components/formulario";
import { Aviso, Cabecalho, Cartao, Entrada, Indicador, Selecao, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { podeVer } from "@/lib/permissoes";
import { normalizar } from "@/lib/dominio/imoveis";
import { ROTULO_BUCKET, ZIP_MAX_ARQUIVOS, ZIP_MAX_BYTES, formatarBytes, resumoContabil, type ItemMapa, type OrigemMapa } from "@/lib/dominio/integracoes";
import { AbasIntegracoes } from "../abas";
import { salvarMapaContabil } from "../actions";
import { lancamentosContabeis, lerFiltroContabil } from "../contabil";
import { usoArmazenamento } from "../dados";

export const metadata: Metadata = { title: "Exportar e contabilidade" };

type LinhaMapa = { chave: string; tipo: OrigemMapa; id?: string; texto?: string; rotulo: string; detalhe?: string };

function acharMapa(mapa: ItemMapa[], l: LinhaMapa) {
  return mapa.find((m) => m.origem_tipo === l.tipo && (l.id ? m.origem_id === l.id : normalizar(m.origem_texto ?? "") === normalizar(l.texto ?? "")));
}

/** Uma linha do de-para (salva sozinha). */
function LinhaDePara({ l, mapa, admin }: { l: LinhaMapa; mapa: ItemMapa[]; admin: boolean }) {
  const atual = acharMapa(mapa, l);
  return (
    <Formulario acao={salvarMapaContabil} automatico semAviso className="grid grid-cols-1 items-center gap-2 border-b border-borda-suave py-2.5 last:border-0 sm:grid-cols-[1.3fr_0.8fr_1.2fr]">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-texto">{l.rotulo}</div>
        {l.detalhe && <div className="truncate text-xs text-mudo">{l.detalhe}</div>}
      </div>
      <input type="hidden" name="origem_tipo" value={l.tipo} />
      {l.id ? <input type="hidden" name="origem_id" value={l.id} /> : <input type="hidden" name="origem_texto" value={l.texto} />}
      <Entrada name="conta_contabil" aria-label={`Conta contábil de ${l.rotulo}`} placeholder="Conta contábil" defaultValue={atual?.conta_contabil ?? ""} maxLength={60} disabled={!admin} className="min-h-10" />
      <Entrada
        name="historico_padrao"
        aria-label={`Histórico padrão de ${l.rotulo}`}
        placeholder="Histórico (opcional): {descricao} - {pessoa}"
        defaultValue={atual?.historico_padrao ?? ""}
        maxLength={200}
        disabled={!admin || l.tipo === "conta_financeira" || l.tipo === "padrao"}
        className="min-h-10"
      />
    </Formulario>
  );
}

/**
 * Exportar: CSV contábil no layout genérico com de-para do plano de contas e
 * os arquivos guardados (uso por área e exportação completa em .zip).
 */
export default async function ExportarPage({ searchParams }: PageProps<"/integracoes/exportar">) {
  const sp = await searchParams;
  const { supabase, papel, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const f = lerFiltroContabil(sp, organizacao.modo);
  const admin = papel === "admin";
  // O arquivo do contador mostra lançamentos: segue a permissão do Financeiro (perfil de acesso).
  const veFinanceiro = await podeVer("financeiro");
  const [{ lancamentos, mapa, linhas }, { data: planos }, { data: contas }, uso] = await Promise.all([
    veFinanceiro ? lancamentosContabeis(supabase, f) : Promise.resolve({ lancamentos: [], mapa: [], linhas: [] }),
    supabase.from("plano_contas").select("id, codigo, nome, tipo").eq("ativo", true).order("codigo"),
    supabase.from("contas_financeiras").select("id, nome, banco").eq("ativa", true).order("nome"),
    usoArmazenamento(supabase),
  ]);
  const r = resumoContabil(linhas);
  const qs = new URLSearchParams({ de: f.de, ate: f.ate, regime: f.regime, terceiros: f.terceiros ? "sim" : "nao" }).toString();
  const categorias = [...new Map(lancamentos.filter((l) => l.categoria).map((l) => [normalizar(l.categoria), l.categoria as string])).values()].sort((a, b) => a.localeCompare(b, "pt-BR"));

  const padroes: LinhaMapa[] = [
    { chave: "p-receita", tipo: "padrao", texto: "receita", rotulo: "Receitas sem conta definida" },
    { chave: "p-despesa", tipo: "padrao", texto: "despesa", rotulo: "Despesas sem conta definida" },
    { chave: "p-banco", tipo: "padrao", texto: "banco", rotulo: "Contrapartida padrão (banco/caixa)" },
  ];

  return (
    <>
      <Cabecalho
        titulo="Exportar e contabilidade"
        trilha="Integrações"
        descricao="Arquivo para o contador com os lançamentos do período (layout genérico, que os sistemas contábeis importam) e a cópia de todos os documentos e fotos."
      />
      <AbasIntegracoes />
      <FiltroAutomatico className="mb-4 flex flex-wrap items-center gap-2">
        <Entrada type="date" name="de" defaultValue={f.de} aria-label="De" className="w-auto min-h-10" />
        <Entrada type="date" name="ate" defaultValue={f.ate} aria-label="Até" className="w-auto min-h-10" />
        <Selecao name="regime" defaultValue={f.regime} aria-label="Regime" className="w-auto min-h-10">
          <option value="caixa">Regime de caixa (pelo pagamento)</option>
          <option value="competencia">Competência (pelo vencimento)</option>
        </Selecao>
        {!pessoal && (
          <Selecao name="terceiros" defaultValue={f.terceiros ? "sim" : "nao"} aria-label="Valores de terceiros" className="w-auto min-h-10">
            <option value="nao">Sem valores de terceiros</option>
            <option value="sim">Com valores de terceiros</option>
          </Selecao>
        )}
      </FiltroAutomatico>
      {!veFinanceiro && (
        <div className="mb-5">
          <Aviso tipo="alerta">Seu perfil de acesso não vê o Financeiro, então o arquivo do contador fica de fora. Os arquivos guardados continuam abaixo.</Aviso>
        </div>
      )}
      <div className="entrar-cascata mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Lançamentos no período" valor={<Contador valor={r.total} />} icone={<FileSpreadsheet />} />
        <Indicador rotulo="Créditos (receitas)" valor={<Contador valor={r.creditos} formato="moeda" />} icone={<ArrowUpCircle />} tom="sucesso" />
        <Indicador rotulo="Débitos (despesas)" valor={<Contador valor={r.debitos} formato="moeda" />} icone={<ArrowDownCircle />} />
        <Indicador rotulo="Sem conta contábil" valor={<Contador valor={r.semConta} />} icone={<TriangleAlert />} tom={r.semConta ? "alerta" : "neutro"} detalhe="preencha o de-para abaixo" />
      </div>
      <div className="mb-8 flex flex-wrap items-center gap-3">
        {veFinanceiro && (
          <a href={`/integracoes/exportar/contabil?${qs}`} className={classeBotao("primario")} download>
            <Download className="size-4" /> Baixar CSV para o contador
          </a>
        )}
        <span className="text-xs text-mudo">Colunas: Data; Conta; Contrapartida; Histórico; D/C; Valor; Documento; Categoria.</span>
      </div>

      <div className="mb-5">
        <Aviso>
          A conta de cada lançamento sai, nesta ordem, do de-para da conta do plano, do de-para da categoria, do código do plano de contas e, por fim, do padrão. Layouts próprios de
          sistemas contábeis (Domínio, Alterdata, Contmatic…) podem ser acrescentados a partir deste arquivo: o escritório costuma importar o CSV genérico.
        </Aviso>
      </div>
      <div className="mb-10 grid grid-cols-1 gap-5 xl:grid-cols-2">
        <Cartao titulo="De-para: padrões">
          {padroes.map((l) => (
            <LinhaDePara key={l.chave} l={l} mapa={mapa} admin={admin} />
          ))}
        </Cartao>
        <Cartao titulo="De-para: contas bancárias e caixa (contrapartida)">
          {(contas ?? []).length === 0 ? (
            <p className="text-sm text-mudo">Nenhuma conta cadastrada no Financeiro.</p>
          ) : (
            (contas ?? []).map((c) => <LinhaDePara key={c.id} l={{ chave: c.id, tipo: "conta_financeira", id: c.id, rotulo: c.nome, detalhe: c.banco ?? undefined }} mapa={mapa} admin={admin} />)
          )}
        </Cartao>
        <Cartao titulo="De-para: plano de contas">
          {(planos ?? []).length === 0 ? (
            <p className="text-sm text-mudo">Nenhuma conta no plano de contas do Financeiro.</p>
          ) : (
            (planos ?? []).map((p) => (
              <LinhaDePara key={p.id} l={{ chave: p.id, tipo: "plano", id: p.id, rotulo: `${p.codigo} ${p.nome}`, detalhe: p.tipo === "receita" ? "Receita" : "Despesa" }} mapa={mapa} admin={admin} />
            ))
          )}
        </Cartao>
        <Cartao titulo="De-para: categorias usadas no período">
          {categorias.length === 0 ? (
            <p className="text-sm text-mudo">Nenhuma categoria nos lançamentos deste período.</p>
          ) : (
            categorias.map((c) => <LinhaDePara key={c} l={{ chave: c, tipo: "categoria", texto: c, rotulo: c }} mapa={mapa} admin={admin} />)
          )}
        </Cartao>
      </div>

      <section id="armazenamento" aria-labelledby="titulo-armazenamento">
        <h2 id="titulo-armazenamento" className="mb-3 text-[17px] font-semibold text-texto">
          Arquivos guardados
        </h2>
        <p className="mb-4 text-sm text-texto-2">
          Quanto cada área ocupa e a cópia completa em .zip (em partes de até {ZIP_MAX_ARQUIVOS} arquivos ou {formatarBytes(ZIP_MAX_BYTES)}). Cópia automática para fora (Amazon S3,
          Google Drive) fica pronta para ligar quando houver a conta: veja o Catálogo.
        </p>
        {uso.length === 0 ? (
          <Aviso>Nenhum arquivo guardado ainda (ou o uso não pôde ser calculado nesta instalação).</Aviso>
        ) : (
          <div className="entrar-cascata grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {uso.map((b) => {
              const partes = Math.max(1, Math.ceil(b.arquivos / ZIP_MAX_ARQUIVOS), Math.ceil(b.bytes / ZIP_MAX_BYTES));
              const tam = Math.max(1, Math.ceil(b.arquivos / partes));
              return (
                <Cartao key={b.bucket} titulo={ROTULO_BUCKET[b.bucket] ?? b.bucket}>
                  <div className="mb-3 flex items-center gap-2 text-sm text-texto-2">
                    <HardDrive className="size-4" /> {b.arquivos} arquivo(s) · {formatarBytes(b.bytes)}
                  </div>
                  {admin && b.bucket in ROTULO_BUCKET && (
                    <div className="flex flex-wrap gap-2">
                      {Array.from({ length: partes }, (_, k) => (
                        <a
                          key={k}
                          href={`/integracoes/exportar/arquivos?bucket=${b.bucket}&pular=${k * tam}&limite=${tam}&parte=${k + 1}`}
                          className={classeBotao("secundario", "sm")}
                          download
                        >
                          <Download className="size-3.5" /> {partes > 1 ? `Parte ${k + 1}` : "Baixar .zip"}
                        </a>
                      ))}
                    </div>
                  )}
                </Cartao>
              );
            })}
          </div>
        )}
      </section>
    </>
  );
}
