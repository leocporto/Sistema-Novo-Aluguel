import { Campo, Entrada, Grade, Selecao } from "@/components/ui";
import { FORMAS_RECEBIMENTO } from "@/lib/dominio/cobrancas";
import { formatarReais } from "@/lib/dominio/dinheiro";

/** Campos da baixa de cota (inteira ou parcial; multa e juros separados; sugestão do dia). */
export function CamposReceber({
  condominioId,
  cotaId,
  saldo,
  multa,
  juros,
  hoje,
  contas,
}: {
  condominioId: string;
  cotaId: string;
  saldo: number;
  multa: number;
  juros: number;
  hoje: string;
  contas: { id: string; nome: string; tipo: string }[];
}) {
  const total = Math.round((saldo + multa + juros) * 100) / 100;
  return (
    <>
      <input type="hidden" name="condominio_id" value={condominioId} />
      <input type="hidden" name="cota_id" value={cotaId} />
      <p className="text-sm text-texto-2">
        Saldo da cota: <b className="text-texto">{formatarReais(saldo)}</b>
        {multa + juros > 0 && (
          <>
            {" "}
            · sugestão de hoje: multa {formatarReais(multa)} e juros {formatarReais(juros)} = <b className="text-texto">{formatarReais(total)}</b>
          </>
        )}
        . Pagamento parcial: informe só o que entrou.
      </p>
      <Grade colunas={2}>
        <Campo rotulo="Data do pagamento">
          <Entrada name="data" type="date" defaultValue={hoje} max={hoje} />
        </Campo>
        <Campo rotulo="Valor recebido (R$)">
          <Entrada name="valor" required inputMode="decimal" defaultValue={total.toFixed(2).replace(".", ",")} />
        </Campo>
        <Campo rotulo="Desse valor, multa (R$)">
          <Entrada name="multa" inputMode="decimal" defaultValue={multa.toFixed(2).replace(".", ",")} />
        </Campo>
        <Campo rotulo="Desse valor, juros (R$)">
          <Entrada name="juros" inputMode="decimal" defaultValue={juros.toFixed(2).replace(".", ",")} />
        </Campo>
        <Campo rotulo="Desconto concedido (R$)">
          <Entrada name="desconto" inputMode="decimal" defaultValue="0" />
        </Campo>
        <Campo rotulo="Forma">
          <Selecao name="forma" defaultValue="pix">
            {Object.entries(FORMAS_RECEBIMENTO).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Entrou na conta">
          <Selecao name="conta_id" defaultValue={contas.find((c) => c.tipo === "corrente")?.id ?? ""}>
            {contas
              .filter((c) => c.tipo === "corrente")
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
          </Selecao>
        </Campo>
      </Grade>
      <p className="text-xs text-mudo">A parte do fundo de reserva vai sozinha para a conta do fundo.</p>
    </>
  );
}
