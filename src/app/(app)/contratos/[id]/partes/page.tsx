import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Pencil, ShieldPlus } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { ROTULO_STATUS_GARANTIA, ROTULO_TIPO_GARANTIA, TIPOS_GARANTIA, situacaoGarantia } from "@/lib/dominio/garantias";
import { carregarContrato } from "@/lib/servicos/locacao";
import { ROTULO_PAPEL, type Pessoa } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import { adicionarParte, removerParte } from "../../actions";
import { adicionarGarantia, atualizarGarantia, excluirGarantia } from "../../locacao-actions";

export const metadata: Metadata = { title: "Partes e garantias" };

type G = {
  id: string;
  tipo: string;
  pessoa_id: string | null;
  instituicao: string | null;
  numero: string | null;
  valor: number | null;
  inicio: string | null;
  fim: string | null;
  conta: string | null;
  status: string;
  devolvida_em: string | null;
  valor_devolvido: number | null;
  observacoes: string | null;
  pessoa: { id: string; nome: string; telefone: string | null } | null;
};

function CamposGarantia({ g, pessoas }: { g?: G; pessoas: { id: string; nome: string }[] }) {
  const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));
  return (
    <>
      {!g && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Tipo">
            <Selecao name="tipo" defaultValue="caucao">
              {TIPOS_GARANTIA.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_GARANTIA[t]}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Fiador (se for fiança)">
            <Selecao name="pessoa_id" defaultValue="">
              <option value="">—</option>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Seguradora / banco / instituição">
          <Entrada name="instituicao" defaultValue={g?.instituicao ?? ""} />
        </Campo>
        <Campo rotulo="Apólice / nº do título / conta">
          <Entrada name="numero" defaultValue={g?.numero ?? ""} />
        </Campo>
        <Campo rotulo="Valor (R$)">
          <Entrada name="valor" inputMode="decimal" defaultValue={v(g?.valor)} />
        </Campo>
        <Campo rotulo="Onde está o dinheiro (caução)">
          <Entrada name="conta" defaultValue={g?.conta ?? ""} placeholder="Poupança Caixa ag. 123…" />
        </Campo>
        <Campo rotulo="Início">
          <Entrada type="date" name="inicio" defaultValue={g?.inicio ?? ""} />
        </Campo>
        <Campo rotulo="Vence em">
          <Entrada type="date" name="fim" defaultValue={g?.fim ?? ""} />
        </Campo>
      </div>
      {g && (
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Situação">
            <Selecao name="status" defaultValue={g.status}>
              {Object.entries(ROTULO_STATUS_GARANTIA).map(([k, r]) => (
                <option key={k} value={k}>
                  {r}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Devolvida em">
            <Entrada type="date" name="devolvida_em" defaultValue={g.devolvida_em ?? ""} />
          </Campo>
          <Campo rotulo="Valor devolvido">
            <Entrada name="valor_devolvido" inputMode="decimal" defaultValue={v(g.valor_devolvido)} />
          </Campo>
        </div>
      )}
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} defaultValue={g?.observacoes ?? ""} />
      </Campo>
    </>
  );
}

export default async function PartesContrato({ params }: PageProps<"/contratos/[id]/partes">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const dados = await carregarContrato(supabase, id);
  if (!dados) notFound();
  const { partes } = dados;
  const hoje = hojeISO();
  const [{ data: pessoas }, { data: gs }, { data: analise }] = await Promise.all([
    supabase.from("pessoas").select("id, nome").order("nome"),
    supabase.from("contrato_garantias").select("*, pessoa:pessoas(id, nome, telefone)").eq("contrato_id", id).order("created_at"),
    supabase.from("analises").select("id, numero").eq("contrato_id", id).limit(1).maybeSingle(),
  ]);
  const garantias = (gs ?? []) as unknown as G[];
  const props = partes.filter((p) => p.papel === "proprietario");
  const soma = props.reduce((s, p) => s + Number(p.percentual ?? 0), 0);
  const ordem = { locatario: 0, fiador: 1, proprietario: 2 };

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Cartao titulo={`Partes do contrato (${partes.length})`}>
        {!pessoal && props.length > 0 && Math.abs(soma - 100) > 0.01 && (
          <p className="mb-3 rounded-[12px] border border-alerta-bd bg-alerta-bg px-3 py-2 text-sm text-alerta">As participações dos proprietários somam {soma}% — devem somar 100% para gerar cobrança.</p>
        )}
        <ul className="mb-4 space-y-2.5 text-sm">
          {[...partes]
            .filter((p) => !pessoal || p.papel !== "proprietario")
            .sort((a, b) => ordem[a.papel] - ordem[b.papel])
            .map((p) => (
              <li key={`${p.pessoa_id}-${p.papel}`} className="flex items-start justify-between gap-2">
                <div>
                  <Link href={`/pessoas/${p.pessoa_id}`} className="font-medium text-acento hover:underline">
                    {p.pessoa.nome}
                  </Link>
                  <div className="text-xs text-mudo">
                    {ROTULO_PAPEL[p.papel]}
                    {p.papel === "proprietario" && ` · ${Number(p.percentual)}%`} · {formatarDocumento(p.pessoa.documento) || "sem CPF/CNPJ"}
                    {p.pessoa.telefone ? ` · ${p.pessoa.telefone}` : ""}
                  </div>
                </div>
                <form action={removerParte}>
                  <input type="hidden" name="contrato_id" value={id} />
                  <input type="hidden" name="pessoa_id" value={p.pessoa_id} />
                  <input type="hidden" name="papel" value={p.papel} />
                  <BotaoEnviar variante="fantasma" confirmar={`Tirar ${p.pessoa.nome} do contrato?`}>
                    Remover
                  </BotaoEnviar>
                </form>
              </li>
            ))}
        </ul>
        <p className="mb-3 text-xs text-mudo">Vários locatários respondem juntos pelo contrato (solidários) e aparecem na fatura, no recibo e nos demonstrativos.</p>
        <Formulario
          key={partes.map((p) => `${p.pessoa_id}-${p.papel}`).join(",")}
          acao={adicionarParte}
          automatico
          salvarQuando="pessoa_id"
          className="space-y-3 border-t border-borda-suave pt-4"
        >
          <input type="hidden" name="contrato_id" value={id} />
          <p className="text-xs text-mudo">Adicionar: escolha o papel e depois a pessoa — entra na hora.</p>
          <div className="grid grid-cols-2 gap-2">
            <Campo rotulo="Papel">
              <Selecao name="papel" defaultValue="locatario">
                <option value="locatario">Locatário</option>
                <option value="fiador">Fiador</option>
                {!pessoal && <option value="proprietario">Proprietário</option>}
              </Selecao>
            </Campo>
            {!pessoal && (
              <Campo rotulo="% (proprietário)">
                <Entrada name="percentual" inputMode="decimal" placeholder="100" />
              </Campo>
            )}
          </div>
          <Campo rotulo="Pessoa">
            <Selecao name="pessoa_id" required defaultValue="">
              <option value="" disabled>
                Selecione…
              </option>
              {((pessoas ?? []) as Pick<Pessoa, "id" | "nome">[]).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
        </Formulario>
      </Cartao>

      <Cartao
        titulo={`Garantias locatícias (${garantias.length})`}
        acoes={
          <>
          {analise && (
            <Link href={`/analise/${analise.id}`} className="text-xs text-acento hover:underline">
              Análise cadastral #{analise.numero}
            </Link>
          )}
          <Link href="/analise/garantias" className="text-xs text-acento hover:underline">
            Vencimentos e renovações
          </Link>
          <JanelaCadastro rotuloBotao={<><ShieldPlus className="size-3.5" /> Incluir</>} tamanho="sm" titulo="Nova garantia" acao={adicionarGarantia} rotuloSalvar="Incluir" larguraMax="max-w-2xl">
            <input type="hidden" name="contrato_id" value={id} />
            <CamposGarantia pessoas={pessoas ?? []} />
          </JanelaCadastro>
          </>
        }
      >
        <ul className="space-y-3">
          {garantias.map((g) => {
            const s = situacaoGarantia(g, hoje);
            return (
              <li key={g.id} className="rounded-[14px] border border-borda p-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-texto">{ROTULO_TIPO_GARANTIA[g.tipo]}</span>
                      <Selo cor={g.status === "ativa" ? (s === "vencida" ? "vermelho" : s === "vencendo" ? "amarelo" : "verde") : "cinza"}>
                        {g.status === "ativa" && s === "vencida" ? "vencida" : g.status === "ativa" && s === "vencendo" ? "vence logo" : ROTULO_STATUS_GARANTIA[g.status]}
                      </Selo>
                    </div>
                    <div className="mt-0.5 text-xs text-mudo">
                      {[
                        g.pessoa?.nome,
                        g.instituicao,
                        g.numero,
                        g.valor ? formatarReais(g.valor) : null,
                        g.fim ? `vence ${formatarDataBR(g.fim)}` : null,
                        g.conta,
                        g.devolvida_em ? `devolvida ${formatarDataBR(g.devolvida_em)}${g.valor_devolvido ? ` (${formatarReais(g.valor_devolvido)})` : ""}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                    {g.observacoes && <p className="mt-1 text-xs text-texto-2">{g.observacoes}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {g.pessoa?.telefone && g.tipo === "fiador" && (
                      <a href={linkWhatsapp(g.pessoa.telefone)} target="_blank" rel="noreferrer" className="text-xs text-acento hover:underline">
                        WhatsApp
                      </a>
                    )}
                    <JanelaCadastro rotuloBotao={<><Pencil className="size-3.5" /> Editar</>} variante="secundario" tamanho="sm" titulo={ROTULO_TIPO_GARANTIA[g.tipo]} acao={atualizarGarantia} rotuloSalvar="Salvar" larguraMax="max-w-2xl">
                      <input type="hidden" name="id" value={g.id} />
                      <CamposGarantia g={g} pessoas={pessoas ?? []} />
                    </JanelaCadastro>
                    <BotaoExcluir acao={excluirGarantia} id={g.id} rotulo="Excluir garantia" confirmar="Excluir esta garantia?" />
                  </div>
                </div>
              </li>
            );
          })}
          {garantias.length === 0 && <li className="text-sm text-mudo">Nenhuma garantia cadastrada (sem garantia).</li>}
        </ul>
      </Cartao>
    </div>
  );
}
