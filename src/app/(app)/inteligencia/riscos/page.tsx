import type { Metadata } from "next";
import { BadgePercent, CalendarX2, Handshake, HousePlus, ShieldAlert, Wallet, XCircle } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Celula, Entrada, Indicador, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { somarReais } from "@/lib/dominio/ia";
import { pode } from "@/lib/permissoes";
import { AbasInteligencia } from "../abas";
import { sugerirAcao } from "../actions";
import { exigirOuVoltar, porLotes } from "../dados";

export const metadata: Metadata = { title: "Contratos em risco e vacância" };

type Atraso = { id: string; numero: number | null; contrato_id: string; vencimento: string; valor_total: number; valor_abatido: number };

type Risco = {
  contrato_id: string;
  codigo: string;
  imovel_id: string | null;
  imovel_codigo: string | null;
  bairro: string | null;
  data_fim: string;
  dias_para_fim: number;
  valor_aluguel: number;
  nota: number;
  motivos: string[];
  vago_previsto_dias: number;
  vago_base: string;
  perda_prevista: number;
};

const JANELAS = [60, 120, 180] as const;

/** Contratos em risco de vencimento/saída e previsão de dias vagos (regras no banco, nos dois modos). */
export default async function RiscosPage({ searchParams }: PageProps<"/inteligencia/riscos">) {
  const sp = await searchParams;
  const { supabase, organizacao } = await obterContexto();
  await exigirOuVoltar("contratos", "ver");
  const dias = JANELAS.find((d) => String(d) === sp.dias) ?? 120;
  const { data, error } = await supabase.rpc("ia_contratos_risco", { p_dias: dias });
  const lista = (data ?? []) as Risco[];
  const altos = lista.filter((r) => r.nota >= 50);
  const perda = somarReais(altos.map((r) => r.perda_prevista));
  const mediaVago = lista.length ? Math.round(lista.reduce((a, r) => a + r.vago_previsto_dias, 0) / lista.length) : 0;
  const base = "/inteligencia/riscos";
  const hoje = hojeISO();
  const pessoal = organizacao.modo === "pessoal";

  // Sugestões que vão para "Ações para aprovar": acordo/cancelamento das cobranças em
  // atraso e desconto para segurar a renovação. Nada muda até alguém com permissão aprovar.
  // A página já exige Contratos → ver (o banco confere a permissão do módulo de cada sugestão).
  const verCobrancas = await pode("cobrancas", "ver");
  const codigo = new Map(lista.map((r) => [r.contrato_id, r.codigo]));
  const comAtraso = lista.filter((r) => r.motivos.some((m) => m.includes("atraso"))).map((r) => r.contrato_id);
  const atrasos = verCobrancas
    ? (
        await porLotes(comAtraso, async (lote) => {
          const { data: f } = await supabase
            .from("faturas")
            .select("id, numero, contrato_id, vencimento, valor_total, valor_abatido")
            .in("contrato_id", lote)
            .eq("status", "aberta")
            .lt("vencimento", hoje)
            .order("vencimento");
          return (f ?? []) as Atraso[];
        })
      ).filter((f) => Number(f.valor_total) - Number(f.valor_abatido) > 0.004)
    : [];
  const renovar = lista.filter((r) => r.dias_para_fim >= 0 && r.dias_para_fim <= dias && !r.motivos.some((m) => m.includes("desocupação")));
  const mesQueVem = (() => {
    const [a, m] = hoje.split("-").map(Number);
    return m === 12 ? `${a + 1}-01` : `${a}-${String(m + 1).padStart(2, "0")}`;
  })();
  return (
    <>
      <Cabecalho
        titulo="Contratos em risco e vacância"
        trilha="Assistente e automações"
        descricao="Nota de 0 a 100 por regras: fim próximo (sem renovação registrada), aviso de desocupação, aluguéis em atraso e reajuste alto no último ano; renovação automática baixa a nota. A previsão de dias vagos usa o histórico do imóvel, depois do bairro e da carteira."
      />
      <AbasInteligencia modo={organizacao.modo} />
      {error && (
        <div className="mb-4">
          <Aviso tipo="erro">{error.message}</Aviso>
        </div>
      )}
      <div className="entrar-cascata mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Indicador rotulo="Contratos na lista" valor={<Contador valor={lista.length} />} icone={<CalendarX2 />} detalhe={`fim em até ${dias} dias, aviso ou atraso`} />
        <Indicador rotulo="Risco alto" valor={<Contador valor={altos.length} />} icone={<ShieldAlert />} tom={altos.length ? "perigo" : "neutro"} detalhe="nota 50 ou mais" />
        <Indicador rotulo="Aluguel que pode parar (risco alto)" valor={<Contador valor={perda} formato="moeda" />} icone={<Wallet />} tom={perda ? "alerta" : "neutro"} detalhe="previsão de dias vagos × aluguel" />
        <Indicador rotulo="Dias vagos previstos (média)" valor={<Contador valor={mediaVago} />} icone={<HousePlus />} />
      </div>
      <PilulasLink className="mb-4" rotulo="Janela" ativo={dias === 120 ? base : `${base}?dias=${dias}`} itens={JANELAS.map((d) => ({ href: d === 120 ? base : `${base}?dias=${d}`, rotulo: `Fim em até ${d} dias` }))} />
      <Tabela colunas={["Contrato", "Imóvel", "Fim", "Nota", "Por quê", "Vago previsto", "Perda prevista"]}>
        {lista.length === 0 ? (
          <LinhaVazia colunas={7}>Nenhum contrato em risco nessa janela.</LinhaVazia>
        ) : (
          lista.map((r) => (
            <LinhaLink key={r.contrato_id} href={`/contratos/${r.contrato_id}`}>
              <Celula className="font-semibold">{r.codigo}</Celula>
              <Celula className="text-texto-2">
                {r.imovel_codigo ?? "—"}
                {r.bairro ? ` · ${r.bairro}` : ""}
              </Celula>
              <Celula className="whitespace-nowrap">
                <span className={r.dias_para_fim < 0 ? "text-ruim" : r.dias_para_fim <= 60 ? "text-alerta" : ""}>{formatarDataBR(r.data_fim)}</span>
              </Celula>
              <Celula>
                <Selo cor={r.nota >= 70 ? "vermelho" : r.nota >= 50 ? "amarelo" : "cinza"}>{r.nota}</Selo>
              </Celula>
              <Celula className="text-[13px] text-texto-2">{r.motivos.join(" · ") || "—"}</Celula>
              <Celula className="whitespace-nowrap text-[13px]">
                {r.vago_previsto_dias} dias
                <div className="text-xs text-mudo">{r.vago_base}</div>
              </Celula>
              <Celula className="whitespace-nowrap tabular-nums">{formatarReais(r.perda_prevista)}</Celula>
            </LinhaLink>
          ))
        )}
      </Tabela>
      {(atrasos.length > 0 || renovar.length > 0) && (
        <div className="mt-6 grid grid-cols-1 gap-5 xl:grid-cols-2">
          {atrasos.length > 0 && (
            <Cartao titulo="Aluguéis em atraso destes contratos">
              <p className="mb-3 text-xs text-mudo">Sugira um acordo ou o cancelamento de uma cobrança lançada errada. Vai para “Ações para aprovar”: só muda depois que alguém de Cobranças aprovar.</p>
              <Tabela colunas={["Contrato", "Venceu", "Em aberto", ""]}>
                {atrasos.slice(0, 50).map((f) => {
                  const aberto = Number(f.valor_total) - Number(f.valor_abatido);
                  const rotulo = `${codigo.get(f.contrato_id) ?? "Contrato"} — fatura${f.numero ? ` #${f.numero}` : ""} de ${formatarDataBR(f.vencimento)}`;
                  return (
                    <tr key={f.id}>
                      <Celula className="font-semibold">{codigo.get(f.contrato_id) ?? "—"}</Celula>
                      <Celula className="whitespace-nowrap text-ruim">{formatarDataBR(f.vencimento)}</Celula>
                      <Celula className="whitespace-nowrap tabular-nums">{formatarReais(aberto)}</Celula>
                      <Celula>
                        <div className="flex flex-wrap gap-2">
                          <JanelaCadastro
                            rotuloBotao={<><Handshake className="size-4" /> Sugerir acordo</>}
                            titulo="Sugerir acordo (vai para aprovação)"
                            acao={sugerirAcao}
                            variante="secundario"
                            tamanho="sm"
                            rotuloSalvar="Enviar para aprovação"
                            icone={<Handshake />}
                          >
                            <input type="hidden" name="tipo" value="renegociar_cobranca" />
                            <input type="hidden" name="origem" value="usuario" />
                            <input type="hidden" name="fatura_id" value={f.id} />
                            <input type="hidden" name="titulo" value={`Acordo: ${rotulo}`} />
                            <input type="hidden" name="descricao" value={`Em aberto: ${formatarReais(aberto)}. Sugerido em Contratos em risco.`} />
                            <p className="text-sm text-texto-2">
                              {rotulo} · em aberto <strong>{formatarReais(aberto)}</strong>. Depois de aprovado, o acordo é montado em Cobranças → Acordos.
                            </p>
                            <Campo rotulo="Observação (opcional)">
                              <AreaTexto name="observacao" rows={2} maxLength={500} placeholder="Ex.: dividir em 3 vezes, o locatário pediu prazo" />
                            </Campo>
                          </JanelaCadastro>
                          <JanelaCadastro
                            rotuloBotao={<><XCircle className="size-4" /> Sugerir cancelamento</>}
                            titulo="Sugerir cancelamento da cobrança (vai para aprovação)"
                            acao={sugerirAcao}
                            variante="secundario"
                            tamanho="sm"
                            rotuloSalvar="Enviar para aprovação"
                            icone={<XCircle />}
                          >
                            <input type="hidden" name="tipo" value="cancelar_cobranca" />
                            <input type="hidden" name="origem" value="usuario" />
                            <input type="hidden" name="fatura_id" value={f.id} />
                            <input type="hidden" name="titulo" value={`Cancelar: ${rotulo}`} />
                            <input type="hidden" name="descricao" value={`Em aberto: ${formatarReais(aberto)}. Sugerido em Contratos em risco.`} />
                            <p className="text-sm text-texto-2">
                              {rotulo} · em aberto <strong>{formatarReais(aberto)}</strong>. Só para cobrança lançada errada: cancelada, ela some do “quem deve”.
                            </p>
                            <Campo rotulo="Motivo">
                              <Entrada name="motivo" required maxLength={300} placeholder="Ex.: cobrança lançada em dobro" />
                            </Campo>
                          </JanelaCadastro>
                        </div>
                      </Celula>
                    </tr>
                  );
                })}
              </Tabela>
            </Cartao>
          )}
          {renovar.length > 0 && (
            <Cartao titulo="Segurar a renovação">
              <p className="mb-3 text-xs text-mudo">Contratos que terminam na janela sem aviso de desocupação. Um desconto sugerido aqui só entra no contrato depois de aprovado.</p>
              <Tabela colunas={["Contrato", "Fim", "Aluguel", ""]}>
                {renovar.slice(0, 50).map((r) => (
                  <tr key={r.contrato_id}>
                    <Celula className="font-semibold">{r.codigo}</Celula>
                    <Celula className="whitespace-nowrap">{formatarDataBR(r.data_fim)}</Celula>
                    <Celula className="whitespace-nowrap tabular-nums">{formatarReais(r.valor_aluguel)}</Celula>
                    <Celula>
                      <JanelaCadastro
                        rotuloBotao={<><BadgePercent className="size-4" /> Sugerir desconto</>}
                        titulo="Sugerir desconto no aluguel (vai para aprovação)"
                        acao={sugerirAcao}
                        variante="secundario"
                        tamanho="sm"
                        rotuloSalvar="Enviar para aprovação"
                        icone={<BadgePercent />}
                      >
                        <input type="hidden" name="tipo" value="desconto" />
                        <input type="hidden" name="origem" value="usuario" />
                        <input type="hidden" name="contrato_id" value={r.contrato_id} />
                        <input type="hidden" name="titulo" value={`Desconto para renovar o contrato ${r.codigo}`} />
                        <input type="hidden" name="descricao" value={`Aluguel atual ${formatarReais(r.valor_aluguel)}; contrato termina em ${formatarDataBR(r.data_fim)}. ${r.motivos.join(" · ")}`} />
                        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                          <Campo rotulo="Tipo">
                            <Selecao name="tipo_desconto" defaultValue="valor">
                              <option value="valor">Valor fixo (R$)</option>
                              <option value="pct">Percentual (%)</option>
                            </Selecao>
                          </Campo>
                          <Campo rotulo="Desconto">
                            <Entrada name="valor" required inputMode="decimal" placeholder="Ex.: 100,00 ou 5" />
                          </Campo>
                          <Campo rotulo="A partir de">
                            <Entrada name="inicio" type="month" required defaultValue={mesQueVem} />
                          </Campo>
                          <Campo rotulo="Até (opcional)">
                            <Entrada name="fim" type="month" />
                          </Campo>
                        </div>
                        <Campo rotulo="Motivo">
                          <Entrada name="motivo" maxLength={300} placeholder={pessoal ? "Ex.: bom inquilino, renovar por mais 12 meses" : "Ex.: proposta para o locatário renovar"} />
                        </Campo>
                      </JanelaCadastro>
                    </Celula>
                  </tr>
                ))}
              </Tabela>
            </Cartao>
          )}
        </div>
      )}
      <p className="mt-4 text-xs text-mudo">
        Quer agir sozinho? Em Automações, crie “Contrato vencendo em 90 dias → {pessoal ? "avisar o responsável" : "criar tarefa"}” ou “→ sugerir mensagem” para falar com o locatário sobre a
        renovação.
      </p>
    </>
  );
}
