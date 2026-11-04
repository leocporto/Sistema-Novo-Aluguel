import { AreaTexto, Campo, Entrada, Grade, Selecao } from "@/components/ui";
import { CATEGORIAS_DESPESA, CATEGORIAS_RECEITA, TIPOS_CONTA } from "@/lib/dominio/condominios";

type Opcao = { id: string; nome: string };

/** Campos do lançamento no livro-caixa do condomínio (usado no Financeiro e no Fundo). */
export function CamposLancamento({
  condominioId,
  contas,
  fornecedores,
  assembleias,
  hoje,
  tipoPadrao = "despesa",
  contaPadrao,
  fundo = false,
}: {
  condominioId: string;
  contas: (Opcao & { tipo: string })[];
  fornecedores: Opcao[];
  assembleias: Opcao[];
  hoje: string;
  tipoPadrao?: "receita" | "despesa" | "transferencia";
  contaPadrao?: string;
  fundo?: boolean;
}) {
  return (
    <>
      <input type="hidden" name="condominio_id" value={condominioId} />
      <Grade colunas={2}>
        <Campo rotulo="Tipo">
          <Selecao name="tipo" defaultValue={tipoPadrao}>
            <option value="despesa">Despesa (saída)</option>
            <option value="receita">Receita (entrada)</option>
            <option value="transferencia">Transferência entre contas</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Conta (de onde sai / onde entra)">
          <Selecao name="conta_id" defaultValue={contaPadrao ?? contas.find((c) => c.tipo === "corrente")?.id ?? ""}>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome} ({TIPOS_CONTA[c.tipo as keyof typeof TIPOS_CONTA] ?? c.tipo})
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Conta de destino (só transferência)">
          <Selecao name="conta_destino_id" defaultValue="">
            <option value="">—</option>
            {contas.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Categoria">
          <Entrada name="categoria" list="categorias-cond" placeholder="Ex.: Limpeza" />
        </Campo>
      </Grade>
      <datalist id="categorias-cond">
        {[...CATEGORIAS_DESPESA, ...CATEGORIAS_RECEITA].map((c) => (
          <option key={c} value={c} />
        ))}
      </datalist>
      <Campo rotulo="Descrição">
        <Entrada name="descricao" required placeholder="Ex.: Conta de energia das áreas comuns" />
      </Campo>
      <Grade colunas={3}>
        <Campo rotulo="Valor (R$)">
          <Entrada name="valor" required inputMode="decimal" />
        </Campo>
        <Campo rotulo="Vencimento">
          <Entrada name="vencimento" type="date" defaultValue={hoje} />
        </Campo>
        <Campo rotulo="Situação">
          <Selecao name="status" defaultValue="aberto">
            <option value="aberto">A pagar / a receber</option>
            <option value="pago">Já pago (hoje ou na data abaixo)</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Pago em">
          <Entrada name="pago_em" type="date" />
        </Campo>
        <Campo rotulo="Fornecedor">
          <Selecao name="fornecedor_id" defaultValue="">
            <option value="">—</option>
            {fornecedores.map((f) => (
              <option key={f.id} value={f.id}>
                {f.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      </Grade>
      <div className={`space-y-3 rounded-[14px] border p-3 ${fundo ? "border-alerta-bd bg-alerta-bg" : "border-borda bg-elev"}`}>
        <p className="text-xs text-texto-2">
          <b>Saída do fundo de reserva</b> só com aprovação registrada (assembleia ou quem aprovou) e por administrador ou gestor.
        </p>
        <Grade colunas={2}>
          <Campo rotulo="Aprovada na assembleia">
            <Selecao name="aprovacao_assembleia_id" defaultValue="">
              <option value="">—</option>
              {assembleias.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Ou: quem aprovou">
            <Entrada name="aprovacao_texto" placeholder="Ex.: Conselho, ata de 10/02" />
          </Campo>
        </Grade>
      </div>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} />
      </Campo>
    </>
  );
}
