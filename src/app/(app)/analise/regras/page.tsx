import type { Metadata } from "next";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { BUREAUS, ROTULO_BUREAU, checklistPadrao, papelAprovaExcecao, textoConsentimentoPadrao } from "@/lib/dominio/analise";
import { AbasAnalise } from "../abas";
import { salvarRegras } from "../actions";
import { carregarConfig } from "../dados";

export const metadata: Metadata = { title: "Regras da análise cadastral" };

function Caixa({ name, marcado, rotulo, desligado }: { name: string; marcado: boolean; rotulo: string; desligado: boolean }) {
  return (
    <>
      <input type="hidden" name={name} value="" />
      <label className="flex items-center gap-2 text-sm text-texto-2">
        <input type="checkbox" name={name} defaultChecked={marcado} disabled={desligado} className="size-4 accent-[var(--accent)]" /> {rotulo}
      </label>
    </>
  );
}

/** Regras para aprovar candidatos (usadas na checagem e garantidas no banco). Só admin/gestor mudam. */
export default async function RegrasPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  const cfg = await carregarConfig(supabase, organizacao.id);
  const pode = papelAprovaExcecao(papel);
  const listas: [string, ReturnType<typeof checklistPadrao>][] = [
    ["Candidato pessoa física", checklistPadrao("candidato", "PF")],
    ["Candidato empresa (PJ)", checklistPadrao("candidato", "PJ")],
    ["Fiador", checklistPadrao("fiador", "PF")],
  ];

  return (
    <>
      <Cabecalho
        titulo="Regras"
        trilha="Análise cadastral"
        descricao="O que precisa estar certo para aprovar um candidato. Aprovar com algo fora destas regras vira exceção (só administrador ou gestor, com justificativa)."
      />
      <AbasAnalise />
      {!pode && (
        <div className="mb-4">
          <Aviso tipo="alerta">Só administradores e gestores mudam estas regras. Você pode consultar.</Aviso>
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
        <Formulario acao={salvarRegras} automatico>
          <fieldset disabled={!pode} className="space-y-6">
            <Cartao titulo="Renda">
              <div className="grid gap-4 sm:grid-cols-3">
                <Campo rotulo="Comprometimento máximo (%)" dica="Aluguel + encargos ÷ renda comprovada. O comum é 30%.">
                  <Entrada name="limite_comprometimento_pct" inputMode="decimal" defaultValue={String(cfg.limite_comprometimento_pct)} />
                </Campo>
                <Campo rotulo="Sinal amarelo a partir de (%)" dica="Até aqui fica verde.">
                  <Entrada name="alerta_comprometimento_pct" inputMode="decimal" defaultValue={String(cfg.alerta_comprometimento_pct)} />
                </Campo>
                <Campo rotulo="Renda do fiador (× aluguel)" dica="Ex.: 3 = fiador comprova 3× aluguel + encargos. 0 = não exige.">
                  <Entrada name="renda_fiador_multiplo" inputMode="decimal" defaultValue={String(cfg.renda_fiador_multiplo)} />
                </Campo>
              </div>
            </Cartao>
            <Cartao titulo="Crédito e garantia">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Score mínimo (0 a 1000)" dica="Em branco: não exige score.">
                  <Entrada name="score_minimo" type="number" min={0} max={1000} defaultValue={cfg.score_minimo ?? ""} />
                </Campo>
                <Campo rotulo="Birô que vocês usam">
                  <Selecao name="bureau_padrao" defaultValue={cfg.bureau_padrao ?? ""}>
                    <option value="">—</option>
                    {BUREAUS.map((b) => (
                      <option key={b} value={b}>
                        {ROTULO_BUREAU[b]}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
              </div>
              <div className="mt-4 space-y-2">
                <Caixa name="exigir_consulta" marcado={cfg.exigir_consulta} rotulo="Exigir consulta de crédito do candidato" desligado={!pode} />
                <Caixa name="aceitar_restricoes" marcado={cfg.aceitar_restricoes} rotulo="Aceitar candidato com restrições no nome" desligado={!pode} />
                <Caixa name="exigir_garantia" marcado={cfg.exigir_garantia} rotulo="Exigir garantia aprovada (seguro, caução, título, carta ou fiador)" desligado={!pode} />
              </div>
            </Cartao>
            <Cartao titulo="Prazos">
              <div className="grid gap-4 sm:grid-cols-2">
                <Campo rotulo="Aprovação vale por (dias)" dica="Depois disso, a aprovação aparece como vencida.">
                  <Entrada name="validade_dias" type="number" min={1} max={365} defaultValue={cfg.validade_dias} />
                </Campo>
                <Campo rotulo="Link da ficha online vale por (dias)">
                  <Entrada name="ficha_dias" type="number" min={1} max={90} defaultValue={cfg.ficha_dias} />
                </Campo>
              </div>
            </Cartao>
            <Cartao titulo="Autorização na ficha online (LGPD)">
              <Campo rotulo="Texto que o candidato aceita" dica="Em branco: usa o texto padrão abaixo.">
                <AreaTexto name="texto_consentimento" rows={4} defaultValue={cfg.texto_consentimento ?? ""} placeholder={textoConsentimentoPadrao(organizacao.nome)} />
              </Campo>
            </Cartao>
          </fieldset>
        </Formulario>
        <Cartao titulo="Documentos pedidos por padrão">
          <div className="space-y-4">
            {listas.map(([titulo, itens]) => (
              <div key={titulo}>
                <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">{titulo}</div>
                <ul className="space-y-1 text-sm text-texto-2">
                  {itens.map((i) => (
                    <li key={i.item}>
                      {i.rotulo} {!i.obrigatorio && <span className="text-xs text-mudo">(opcional)</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            <p className="text-xs text-mudo">Em cada análise dá para incluir, dispensar ou tirar documentos do checklist.</p>
          </div>
        </Cartao>
      </div>
    </>
  );
}
