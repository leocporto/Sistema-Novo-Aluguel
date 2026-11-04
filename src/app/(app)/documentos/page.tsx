import type { Metadata } from "next";
import { AlarmClock, FilePen, FileSignature, FileText, Lock } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diasEntre, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { ROTULO_STATUS_DOCUMENTO, ROTULO_TIPO_DOCUMENTO, TIPOS_DOCUMENTO, TIPOS_DOC_SO_IMOBILIARIA } from "@/lib/dominio/modelos";
import { excluirDocumento, gerarDocumento } from "./actions";
import { AbasDocumentos, CampoValidade, CamposVinculos } from "./campos";
import { opcoesDocumentos } from "./dados";
import { EnviarArquivo } from "./enviar-arquivo";

export const metadata: Metadata = { title: "Documentos" };

const FILTROS: Record<string, string> = {
  "": "Todos",
  andamento: "Em andamento",
  assinatura: "Aguardando assinatura",
  assinado: "Assinados",
  vencendo: "Vencendo",
  arquivo: "Arquivos",
};
const COR: Record<string, "cinza" | "amarelo" | "azul" | "verde" | "vermelho"> = {
  rascunho: "cinza",
  em_revisao: "amarelo",
  aprovado: "azul",
  aguardando_assinatura: "amarelo",
  assinado: "verde",
  recusado: "vermelho",
  cancelado: "cinza",
  arquivo: "azul",
};

type D = {
  id: string;
  numero: number;
  titulo: string;
  tipo: string;
  status: string;
  validade: string | null;
  alerta_dias: number;
  restrito: boolean;
  updated_at: string;
  imovel: { id: string; codigo: string } | null;
  pessoa: { id: string; nome: string } | null;
  contrato: { id: string; numero: number } | null;
  documento_signatarios: { assinado_em: string | null }[];
};

export default async function DocumentosPage({ searchParams }: PageProps<"/documentos">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtro = s("filtro") in FILTROS ? s("filtro") : "";
  const f = { busca: s("busca"), tipo: s("tipo"), imovel: s("imovel"), pessoa: s("pessoa") };
  const { supabase, organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const hoje = hojeISO();

  let q = supabase
    .from("documentos")
    .select("id, numero, titulo, tipo, status, validade, alerta_dias, restrito, updated_at, imovel:imoveis(id, codigo), pessoa:pessoas(id, nome), contrato:contratos(id, numero), documento_signatarios(assinado_em)")
    .order("updated_at", { ascending: false })
    .limit(500);
  if (filtro === "andamento") q = q.in("status", ["rascunho", "em_revisao", "aprovado"]);
  if (filtro === "assinatura") q = q.eq("status", "aguardando_assinatura");
  if (filtro === "assinado") q = q.eq("status", "assinado");
  if (filtro === "arquivo") q = q.eq("status", "arquivo");
  if (filtro === "vencendo") q = q.not("validade", "is", null).lte("validade", somarDias(hoje, 90)).neq("status", "cancelado");
  if (f.tipo) q = q.eq("tipo", f.tipo);
  if (f.imovel) q = q.eq("imovel_id", f.imovel);
  if (f.pessoa) q = q.eq("pessoa_id", f.pessoa);
  if (f.busca) {
    const b = f.busca.replace(/[%,()]/g, " ").trim();
    q = q.or(`titulo.ilike.%${b}%,conteudo.ilike.%${b}%,arquivo_nome.ilike.%${b}%`);
  }
  const [{ data }, op, { data: todos }] = await Promise.all([
    q,
    opcoesDocumentos(supabase, pessoal),
    supabase.from("documentos").select("status, validade, alerta_dias").neq("status", "cancelado"),
  ]);
  const lista = (data ?? []) as unknown as D[];
  const t = todos ?? [];
  const vencendo = t.filter((d) => d.validade && diasEntre(hoje, d.validade) <= (d.alerta_dias ?? 30)).length;
  const tipos = TIPOS_DOCUMENTO.filter((x) => !(pessoal && TIPOS_DOC_SO_IMOBILIARIA.includes(x)));
  const url = (k: string) => {
    const p = new URLSearchParams(Object.entries({ filtro: k, ...f }).filter(([, v]) => v) as [string, string][]);
    return p.toString() ? `/documentos?${p}` : "/documentos";
  };

  return (
    <>
      <Cabecalho
        titulo="Documentos"
        descricao="Contratos, propostas, autorizações e aditivos gerados com os dados do sistema, com revisão, versões, assinatura eletrônica e arquivos por imóvel e cliente."
        acoes={
          <>
            <EnviarArquivo
              organizacaoId={organizacao.id}
              tipos={[...tipos]}
              imoveis={op.imoveis.map((i) => ({ id: i.id, rotulo: i.codigo }))}
              pessoas={op.pessoas.map((p) => ({ id: p.id, rotulo: p.nome }))}
              contratos={op.contratos.map((c) => ({ id: c.id, rotulo: `#${c.numero} · ${c.imovel?.codigo ?? ""}` }))}
            />
            <JanelaCadastro rotuloBotao={<><FilePen className="size-4" /> Novo documento</>} titulo="Gerar documento" acao={gerarDocumento} rotuloSalvar="Gerar" icone={<FilePen />} larguraMax="max-w-2xl" abertaInicial={s("novo") === "1"}>
              <Campo rotulo="Modelo" dica={op.modelos.length ? "O texto já sai preenchido com os dados escolhidos abaixo." : "Nenhum modelo ainda: vá em Modelos e instale os modelos-base."}>
                <Selecao name="modelo_id" defaultValue="">
                  <option value="">— documento em branco —</option>
                  {op.modelos
                    .filter((m) => !(pessoal && TIPOS_DOC_SO_IMOBILIARIA.includes(m.tipo)))
                    .map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.nome}
                      </option>
                    ))}
                </Selecao>
              </Campo>
              <div className="grid gap-4 sm:grid-cols-[1fr_200px]">
                <Campo rotulo="Título (opcional)">
                  <Entrada name="titulo" placeholder="Se vazio, usa o nome do modelo" />
                </Campo>
                <CampoValidade />
              </div>
              <CamposVinculos
                imoveis={op.imoveis}
                pessoas={op.pessoas}
                contratos={op.contratos}
                vendas={op.vendas}
                padrao={{ imovel_id: s("imovel") || null, pessoa_id: s("pessoa") || null, contrato_id: s("contrato") || null, venda_id: s("venda") || null }}
              />
              {s("captacao") && <input type="hidden" name="captacao_id" value={s("captacao")} />}
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-texto-2">
                <label className="flex items-center gap-2">
                  <input type="checkbox" name="com_partes" defaultChecked /> Já incluir as partes como signatárias
                </label>
                {(papel === "admin" || papel === "gestor") && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="restrito" /> Restrito (só administradores e gestores)
                  </label>
                )}
              </div>
            </JanelaCadastro>
          </>
        }
      />
      <AbasDocumentos />

      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Documentos" icone={<FileText />} valor={<Contador valor={t.length} />} detalhe="na central" />
        <Indicador rotulo="Em andamento" icone={<FilePen />} valor={<Contador valor={t.filter((d) => ["rascunho", "em_revisao", "aprovado"].includes(d.status)).length} />} detalhe="rascunho, revisão, aprovado" href={url("andamento")} />
        <Indicador rotulo="Aguardando assinatura" icone={<FileSignature />} valor={<Contador valor={t.filter((d) => d.status === "aguardando_assinatura").length} />} href={url("assinatura")} tom="alerta" />
        <Indicador rotulo="Vencendo" icone={<AlarmClock />} valor={<Contador valor={vencendo} />} detalhe="dentro do prazo de aviso" tom={vencendo ? "perigo" : "sucesso"} href={url("vencendo")} />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink rotulo="Situação" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="flex flex-wrap gap-2">
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          <Entrada name="busca" defaultValue={f.busca} placeholder="Buscar no título e no texto…" className="max-w-72" />
          <Selecao name="tipo" defaultValue={f.tipo} className="w-52">
            <option value="">Todos os tipos</option>
            {[...tipos, "arquivo"].map((x) => (
              <option key={x} value={x}>
                {ROTULO_TIPO_DOCUMENTO[x]}
              </option>
            ))}
          </Selecao>
          <Selecao name="imovel" defaultValue={f.imovel} className="w-44">
            <option value="">Todos os imóveis</option>
            {op.imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo}
              </option>
            ))}
          </Selecao>
          <Selecao name="pessoa" defaultValue={f.pessoa} className="w-52">
            <option value="">Todos os clientes</option>
            {op.pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
      </div>

      <Tabela colunas={["Documento", "Tipo", "Vínculos", "Assinaturas", "Vence", "Situação", ""]}>
        {lista.map((d) => {
          const ass = d.documento_signatarios;
          const venc = d.validade ? diasEntre(hoje, d.validade) : null;
          return (
            <LinhaLink key={d.id} href={`/documentos/${d.id}`}>
              <Celula>
                <span className="font-medium text-texto">
                  {d.restrito && <Lock className="mr-1 inline size-3.5 text-mudo" />}
                  {d.titulo}
                </span>
                <span className="block text-xs text-mudo">
                  nº {d.numero} · atualizado {formatarDataBR(d.updated_at.slice(0, 10))}
                </span>
              </Celula>
              <Celula>{ROTULO_TIPO_DOCUMENTO[d.tipo] ?? d.tipo}</Celula>
              <Celula>
                <span className="text-xs text-texto-2">{[d.imovel?.codigo, d.pessoa?.nome, d.contrato ? `contrato #${d.contrato.numero}` : null].filter(Boolean).join(" · ") || "—"}</span>
              </Celula>
              <Celula>{ass.length ? `${ass.filter((a) => a.assinado_em).length}/${ass.length}` : "—"}</Celula>
              <Celula className={venc !== null && venc <= d.alerta_dias ? (venc < 0 ? "text-ruim" : "text-alerta") : ""}>{formatarDataBR(d.validade)}</Celula>
              <Celula>
                <Selo cor={COR[d.status] ?? "cinza"}>{ROTULO_STATUS_DOCUMENTO[d.status] ?? d.status}</Selo>
              </Celula>
              <Celula>
                <BotaoExcluir acao={excluirDocumento} id={d.id} rotulo="Excluir documento" confirmar={`Excluir "${d.titulo}"?`} />
              </Celula>
            </LinhaLink>
          );
        })}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhum documento aqui.</LinhaVazia>}
      </Tabela>
    </>
  );
}
