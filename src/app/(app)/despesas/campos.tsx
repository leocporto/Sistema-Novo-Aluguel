import { Campo, Entrada, Selecao } from "@/components/ui";
import { hojeISO } from "@/lib/dominio/datas";

export type ImovelDespesa = { id: string; codigo: string; logradouro: string | null; numero: string | null };
export type DespesaEditavel = { id: string; descricao: string; categoria: string | null; valor: number; vencimento: string; imovel_id: string | null };

export function CamposDespesa({
  categorias,
  imoveis,
  pessoal,
  despesa,
  imovelPadrao,
  nova = false,
}: {
  categorias: string[];
  imoveis: ImovelDespesa[];
  pessoal: boolean;
  despesa?: DespesaEditavel;
  imovelPadrao?: string;
  nova?: boolean;
}) {
  return (
    <>
      {despesa && <input type="hidden" name="id" value={despesa.id} />}
      {pessoal && (
        <Campo rotulo="Imóvel">
          <Selecao name="imovel_id" required defaultValue={despesa?.imovel_id ?? imovelPadrao ?? ""}>
            <option value="" disabled>
              Selecione…
            </option>
            {imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {[i.codigo, [i.logradouro, i.numero].filter(Boolean).join(", ")].filter(Boolean).join(" — ")}
              </option>
            ))}
          </Selecao>
        </Campo>
      )}
      <Campo rotulo="Descrição">
        <Entrada name="descricao" required defaultValue={despesa?.descricao} placeholder={pessoal ? "Condomínio de novembro, troca do chuveiro…" : "Aluguel da sala, conta de luz…"} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Categoria">
          <Selecao name="categoria" defaultValue={despesa?.categoria ?? categorias[0]}>
            {categorias.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Valor (R$)">
          <Entrada name="valor" required inputMode="decimal" defaultValue={despesa ? String(despesa.valor).replace(".", ",") : ""} placeholder="0,00" />
        </Campo>
        <Campo rotulo="Vencimento">
          <Entrada type="date" name="vencimento" required defaultValue={despesa?.vencimento ?? hojeISO()} />
        </Campo>
        {nova && (
          <Campo rotulo="Repetir">
            <Selecao name="repetir" defaultValue="nao">
              <option value="nao">Não repete</option>
              <option value="mensal">Todo mês</option>
            </Selecao>
          </Campo>
        )}
      </div>
      {nova && (
        <>
          <Campo rotulo="Quantos meses (se repetir)" dica="Cria uma despesa por mês, no mesmo dia. Ex.: 12 = um ano.">
            <Entrada name="meses" type="number" min={2} max={60} defaultValue={12} />
          </Campo>
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="checkbox" name="pago" /> Já está paga
          </label>
        </>
      )}
    </>
  );
}
