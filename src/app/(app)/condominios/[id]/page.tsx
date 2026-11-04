import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarClock, Home, Landmark, MessageSquareWarning, PiggyBank, Receipt } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Campo, Cartao, Entrada, Grade, Indicador, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COR_VALIDADE, PESOS_VOTO, TIPOS_DOCUMENTO_COND, conferirFracoes, situacaoValidade } from "@/lib/dominio/condominios";
import { formatarCompetencia, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { lancarTaxaAdmin, salvarCondominio } from "../actions";
import { CamposCondominio } from "../campos";
import { carregarCondominio, opcoesEquipe, saldosDo, unidadesDo } from "../dados";

export const metadata: Metadata = { title: "Condomínio" };

/** Resumo: números do condomínio, alertas (frações, documentos, contratos) e o cadastro (salva sozinho). */
export default async function ResumoCondominio({ params }: PageProps<"/condominios/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const c = await carregarCondominio(supabase, id);
  if (!c) notFound();
  const hoje = hojeISO();
  const mes = hoje.slice(0, 7);
  const [unidades, saldos, equipe, { data: inad }, { count: ocorrencias }, { data: proxima }, { data: docs }, { data: contratos }, { data: taxa }] = await Promise.all([
    unidadesDo(supabase, id),
    saldosDo(supabase, id),
    opcoesEquipe(supabase),
    supabase.rpc("cond_inadimplencia", { p_condominio: id }),
    supabase.from("cond_ocorrencias").select("id", { count: "exact", head: true }).eq("condominio_id", id).in("status", ["aberta", "em_andamento"]),
    supabase.from("cond_assembleias").select("id, titulo, data, status").eq("condominio_id", id).in("status", ["convocada", "em_andamento"]).order("data").limit(1).maybeSingle(),
    supabase.from("cond_documentos").select("id, titulo, tipo, validade").eq("condominio_id", id).not("validade", "is", null).lte("validade", somarDias(hoje, 60)).order("validade"),
    supabase.from("cond_contratos_fornecedores").select("id, servico, fim").eq("condominio_id", id).eq("ativo", true).not("fim", "is", null).lte("fim", somarDias(hoje, 60)).order("fim"),
    supabase.from("cond_taxas_admin").select("id").eq("condominio_id", id).eq("competencia", `${mes}-01`).maybeSingle(),
  ]);
  const fr = conferirFracoes(unidades.map((u) => u.fracao_ideal));
  const corrente = saldos.filter((s) => s.tipo === "corrente").reduce((a, s) => a + s.saldo, 0);
  const fundo = saldos.filter((s) => s.tipo !== "corrente").reduce((a, s) => a + s.saldo, 0);
  const inadimplentes = (inad ?? []) as { corrigido: number }[];
  const devido = inadimplentes.reduce((a, x) => a + Number(x.corrigido), 0);
  const base = `/condominios/${id}`;

  return (
    <div className="space-y-6">
      <div className="entrar-cascata grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Indicador
          rotulo="Unidades"
          icone={<Home />}
          valor={<Contador valor={unidades.length} />}
          tom={unidades.length && !fr.ok ? "alerta" : "neutro"}
          detalhe={unidades.length === 0 ? "cadastre as unidades" : fr.ok ? "frações ideais conferidas" : `frações somam ${fr.soma.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}`}
          href={`${base}/unidades`}
        />
        <Indicador rotulo="Conta corrente" icone={<Landmark />} valor={<Contador valor={corrente} formato="moeda" />} tom={corrente < 0 ? "perigo" : "neutro"} detalhe="saldo de hoje no livro-caixa" href={`${base}/financeiro`} />
        <Indicador rotulo="Fundo de reserva" icone={<PiggyBank />} valor={<Contador valor={fundo} formato="moeda" />} detalhe={`${c.fundo_reserva_pct}% sobre cada cota`} href={`${base}/fundo`} />
        <Indicador
          rotulo="Inadimplência"
          icone={<AlertTriangle />}
          tom={devido > 0 ? "perigo" : "sucesso"}
          valor={<Contador valor={devido} formato="moeda" />}
          detalhe={`${inadimplentes.length} unidade(s), com multa e juros`}
          href={`${base}/inadimplencia`}
        />
        <Indicador rotulo="Ocorrências abertas" icone={<MessageSquareWarning />} tom={ocorrencias ? "alerta" : "neutro"} valor={<Contador valor={ocorrencias ?? 0} />} detalhe="abertas ou em andamento" href={`${base}/ocorrencias`} />
        <Indicador
          rotulo="Próxima assembleia"
          icone={<CalendarClock />}
          valor={proxima ? formatarDataBR(new Date(proxima.data as string).toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" })) : "—"}
          detalhe={proxima ? (proxima.titulo as string) : "nenhuma marcada"}
          href={proxima ? `${base}/assembleias/${proxima.id}` : `${base}/assembleias`}
        />
      </div>

      {unidades.length > 0 && !fr.ok && (
        <Aviso tipo="alerta">
          As frações ideais não fecham {fr.escala === "percentual" || fr.soma > 2 ? "100%" : "1"}: a soma é {fr.soma.toLocaleString("pt-BR", { maximumFractionDigits: 6 })}
          {fr.semFracao ? ` e ${fr.semFracao} unidade(s) estão sem fração` : ""}. Confira em <Link href={`${base}/unidades`} className="text-acento hover:underline">Unidades</Link>.
        </Aviso>
      )}
      {((docs ?? []).length > 0 || (contratos ?? []).length > 0) && (
        <Cartao titulo="Vencendo nos próximos 60 dias">
          <ul className="space-y-2 text-sm">
            {(docs ?? []).map((d) => {
              const v = situacaoValidade(d.validade as string, hoje);
              return (
                <li key={d.id as string} className="flex flex-wrap items-center gap-2">
                  <Selo cor={COR_VALIDADE[v.situacao ?? "ok"]}>{v.situacao === "vencido" ? "vencido" : `${v.dias} dia(s)`}</Selo>
                  <Link href={`${base}/documentos`} className="text-texto hover:underline">
                    {TIPOS_DOCUMENTO_COND[d.tipo as keyof typeof TIPOS_DOCUMENTO_COND] ?? d.tipo}: {d.titulo as string}
                  </Link>
                  <span className="text-mudo">validade {formatarDataBR(d.validade as string)}</span>
                </li>
              );
            })}
            {(contratos ?? []).map((k) => {
              const v = situacaoValidade(k.fim as string, hoje);
              return (
                <li key={k.id as string} className="flex flex-wrap items-center gap-2">
                  <Selo cor={COR_VALIDADE[v.situacao ?? "ok"]}>{v.situacao === "vencido" ? "vencido" : `${v.dias} dia(s)`}</Selo>
                  <Link href={`${base}/fornecedores`} className="text-texto hover:underline">
                    Contrato: {k.servico as string}
                  </Link>
                  <span className="text-mudo">termina em {formatarDataBR(k.fim as string)}</span>
                </li>
              );
            })}
          </ul>
        </Cartao>
      )}

      <Formulario acao={salvarCondominio} automatico>
        <input type="hidden" name="id" value={id} />
        <Cartao titulo="Cadastro">
          <div className="space-y-4">
            <CamposCondominio c={c as unknown as Record<string, string | number | null>} />
          </div>
        </Cartao>
        <Cartao titulo="Administração">
          <Grade colunas={3}>
            <Campo rotulo="Responsável na equipe">
              <Selecao name="responsavel_user_id" defaultValue={c.responsavel_user_id ?? ""}>
                <option value="">Ninguém definido</option>
                {equipe.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.nome ?? "Sem nome"}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Peso do voto nas assembleias">
              <Selecao name="voto_peso" defaultValue={c.voto_peso}>
                {Object.entries(PESOS_VOTO).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Taxa de administração (R$/mês)" dica="O que a imobiliária cobra do condomínio.">
              <Entrada name="taxa_administracao" inputMode="decimal" defaultValue={String(c.taxa_administracao ?? 0)} />
            </Campo>
          </Grade>
          <label className="mt-4 flex items-center gap-2 text-sm text-texto-2">
            <input type="hidden" name="ativo" value="off" />
            <input type="checkbox" name="ativo" defaultChecked={c.ativo} className="size-4 accent-[var(--accent)]" /> Condomínio ativo (administrado agora)
          </label>
        </Cartao>
        <Cartao titulo="Recebimento das cotas">
          <Grade colunas={3}>
            <Campo rotulo="Chave Pix do condomínio" dica="Gera o Pix copia e cola da 2ª via.">
              <Entrada name="pix_chave" defaultValue={c.pix_chave ?? ""} />
            </Campo>
            <Campo rotulo="Nome no Pix">
              <Entrada name="pix_nome" defaultValue={c.pix_nome ?? ""} placeholder={c.nome} />
            </Campo>
            <Campo rotulo="Cidade no Pix">
              <Entrada name="pix_cidade" defaultValue={c.pix_cidade ?? ""} placeholder={c.cidade ?? ""} />
            </Campo>
            <Campo rotulo="Banco">
              <Entrada name="banco" defaultValue={c.banco ?? ""} />
            </Campo>
            <Campo rotulo="Agência">
              <Entrada name="agencia" defaultValue={c.agencia ?? ""} />
            </Campo>
            <Campo rotulo="Conta">
              <Entrada name="conta" defaultValue={c.conta ?? ""} />
            </Campo>
          </Grade>
          <p className="mt-3 text-xs text-mudo">Boleto registrado depende de contrato com o banco: fica pronto para ligar em Integrações. Até lá, a 2ª via sai com Pix copia e cola.</p>
        </Cartao>
        <Cartao titulo="Observações">
          <Campo rotulo="Anotações internas">
            <AreaTexto name="observacoes" rows={3} defaultValue={c.observacoes ?? ""} />
          </Campo>
        </Cartao>
      </Formulario>

      {c.taxa_administracao > 0 && (
        <Cartao titulo="Taxa de administração da imobiliária">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-texto-2">
              {formatarReais(c.taxa_administracao)} de {formatarCompetencia(`${mes}-01`)} vão para o <b>financeiro da imobiliária</b> como conta a receber (não sai do livro-caixa do condomínio).
            </p>
            {taxa ? (
              <Selo cor="verde">
                <Receipt className="size-3" /> já lançada
              </Selo>
            ) : (
              <BotaoAcao acao={lancarTaxaAdmin} id={`${id}|${mes}`} variante="primario" confirmar={`Lançar ${formatarReais(c.taxa_administracao)} de taxa de administração (${formatarCompetencia(`${mes}-01`)}) no financeiro da imobiliária?`}>
                <Receipt className="size-4" /> Lançar taxa do mês
              </BotaoAcao>
            )}
          </div>
        </Cartao>
      )}
    </div>
  );
}
