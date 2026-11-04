import { Campo, Entrada, Grade, Selecao } from "@/components/ui";
import { CRITERIOS_RATEIO } from "@/lib/dominio/condominios";

/** Campos do cadastro do condomínio (criar e editar). */
export function CamposCondominio({ c }: { c?: Partial<Record<string, string | number | null>> }) {
  const v = (k: string, padrao = "") => (c?.[k] ?? padrao) === null ? "" : String(c?.[k] ?? padrao);
  return (
    <>
      <Grade colunas={2}>
        <Campo rotulo="Nome do condomínio">
          <Entrada name="nome" required defaultValue={v("nome")} placeholder="Ex.: Edifício Solar das Flores" />
        </Campo>
        <Campo rotulo="CNPJ">
          <Entrada name="cnpj" defaultValue={v("cnpj")} inputMode="numeric" />
        </Campo>
      </Grade>
      <Grade colunas={3}>
        <Campo rotulo="CEP">
          <Entrada name="cep" defaultValue={v("cep")} inputMode="numeric" />
        </Campo>
        <Campo rotulo="Rua" className="md:col-span-2">
          <Entrada name="logradouro" defaultValue={v("logradouro")} />
        </Campo>
        <Campo rotulo="Número">
          <Entrada name="numero" defaultValue={v("numero")} />
        </Campo>
        <Campo rotulo="Complemento">
          <Entrada name="complemento" defaultValue={v("complemento")} />
        </Campo>
        <Campo rotulo="Bairro">
          <Entrada name="bairro" defaultValue={v("bairro")} />
        </Campo>
        <Campo rotulo="Cidade">
          <Entrada name="cidade" defaultValue={v("cidade")} />
        </Campo>
        <Campo rotulo="UF">
          <Entrada name="uf" maxLength={2} defaultValue={v("uf")} />
        </Campo>
      </Grade>
      <Grade colunas={3}>
        <Campo rotulo="Dia do vencimento da cota">
          <Entrada name="dia_vencimento" type="number" min={1} max={31} defaultValue={v("dia_vencimento", "10")} />
        </Campo>
        <Campo rotulo="Multa por atraso (%)" dica="Pelo Código Civil, no condomínio a multa é de até 2%.">
          <Entrada name="multa_pct" inputMode="decimal" defaultValue={v("multa_pct", "2")} />
        </Campo>
        <Campo rotulo="Juros (% ao mês)">
          <Entrada name="juros_mes_pct" inputMode="decimal" defaultValue={v("juros_mes_pct", "1")} />
        </Campo>
        <Campo rotulo="Como dividir as despesas">
          <Selecao name="criterio_rateio" defaultValue={v("criterio_rateio", "fracao")}>
            {Object.entries(CRITERIOS_RATEIO).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Fundo de reserva (% sobre a cota)">
          <Entrada name="fundo_reserva_pct" inputMode="decimal" defaultValue={v("fundo_reserva_pct", "0")} />
        </Campo>
      </Grade>
    </>
  );
}
