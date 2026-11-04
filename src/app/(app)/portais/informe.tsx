import { NOMES_MES } from "@/components/navegador-mes";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { formatarReais, paraReais } from "@/lib/dominio/dinheiro";
import type { InformeRendimentos, TotaisInforme } from "@/lib/dominio/portal";

const r = (c: number) => formatarReais(paraReais(c));

function Linha({ rotulo, t, forte = false }: { rotulo: string; t: TotaisInforme; forte?: boolean }) {
  return (
    <tr className={forte ? "font-semibold" : ""}>
      <td className="py-1.5 pr-2">{rotulo}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r(t.rendimento)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r(t.taxas)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r(t.irrf)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r(t.imposto + t.descontos)}</td>
      <td className="px-2 py-1.5 text-right tabular-nums">{r(t.encargos)}</td>
      <td className="py-1.5 pl-2 text-right tabular-nums">{r(t.liquido)}</td>
    </tr>
  );
}

const CABECALHO = ["Rendimento (aluguel + multa/juros)", "Taxas da administração", "IRRF retido", "Imposto e despesas descontados", "Encargos repassados", "Líquido repassado"];

/**
 * Informe de rendimentos de aluguéis do ano (imprimível): usado no portal do
 * proprietário e na tela interna /portais/informes. Regime de caixa: o mês em
 * que o aluguel foi pago pelo locatário.
 */
export function DocumentoInforme({
  informe,
  organizacao,
  beneficiario,
}: {
  informe: InformeRendimentos;
  organizacao: { nome: string; documento: string | null };
  beneficiario: { nome: string; documento: string | null };
}) {
  const t = informe.total;
  return (
    <article className="space-y-5 rounded-card border border-borda bg-card p-[clamp(18px,2.4vw,32px)] text-sm text-texto print:border-0 print:p-0">
      <header className="flex flex-wrap justify-between gap-4 border-b border-borda pb-4">
        <div>
          <h2 className="text-[20px] font-semibold">Informe de rendimentos de aluguéis — {informe.ano}</h2>
          <p className="text-texto-2">
            Fonte / administradora: {organizacao.nome}
            {organizacao.documento ? ` · ${formatarDocumento(organizacao.documento)}` : ""}
          </p>
        </div>
        <div className="text-right">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Beneficiário (proprietário)</div>
          <div className="font-medium">{beneficiario.nome}</div>
          {beneficiario.documento && <div className="text-xs text-mudo">{formatarDocumento(beneficiario.documento)}</div>}
        </div>
      </header>

      <div className="grid gap-2 rounded-[14px] border border-borda bg-elev p-4 sm:grid-cols-4">
        <div>
          <div className="text-xs text-mudo">Rendimento bruto</div>
          <div className="text-[18px] font-semibold tabular-nums">{r(t.rendimento)}</div>
        </div>
        <div>
          <div className="text-xs text-mudo">Taxas (dedutíveis)</div>
          <div className="text-[18px] font-semibold tabular-nums">{r(t.taxas)}</div>
        </div>
        <div>
          <div className="text-xs text-mudo">IRRF retido</div>
          <div className="text-[18px] font-semibold tabular-nums">{r(t.irrf)}</div>
        </div>
        <div>
          <div className="text-xs text-mudo">Líquido repassado</div>
          <div className="text-[18px] font-semibold tabular-nums">{r(t.liquido)}</div>
        </div>
      </div>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">Mês a mês</h3>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-mudo">
                <th className="py-2 pr-2">Mês do pagamento</th>
                {CABECALHO.map((c) => (
                  <th key={c} className="px-2 py-2 text-right">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-borda-suave">
              {informe.meses.map((m, i) => (
                <Linha key={i} rotulo={NOMES_MES[i]} t={m} />
              ))}
              <Linha rotulo="Total do ano" t={t} forte />
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h3 className="mb-2 text-[15px] font-semibold">Por imóvel e locatário (fonte pagadora)</h3>
        {informe.porImovel.length === 0 ? (
          <p className="text-mudo">Nenhum aluguel recebido neste ano.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left font-mono text-[10px] uppercase tracking-[0.1em] text-mudo">
                  <th className="py-2 pr-2">Imóvel / locatário</th>
                  {CABECALHO.map((c) => (
                    <th key={c} className="px-2 py-2 text-right">
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-borda-suave">
                {informe.porImovel.map((p) => (
                  <Linha
                    key={p.chave}
                    rotulo={`${p.imovel}${p.endereco ? ` (${p.endereco})` : ""} · ${p.locatario ?? "—"}${p.documento ? ` · ${formatarDocumento(p.documento)}` : ""}`}
                    t={p.totais}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <p className="text-xs text-mudo">
        Rendimento = aluguel + multa e juros pagos pelo locatário, no mês em que o aluguel foi pago (regime de caixa). Encargos repassados (IPTU, condomínio)
        são reembolsos e não entram no rendimento. Taxas de administração e intermediação podem ser deduzidas. IRRF = imposto retido pelo locatário pessoa
        jurídica.{informe.pendentes > 0 ? ` ${informe.pendentes} aluguel(éis) do ano ainda sem pagamento não entraram.` : ""} Confira os valores com seu contador.
        Emitido em {formatarDataBR(hojeISO())}.
      </p>
    </article>
  );
}
