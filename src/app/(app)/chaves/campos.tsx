import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";

type Opcao = { id: string; nome: string };

/** Campos de cadastro/edição da chave. */
export function CamposChave({
  imoveis,
  pessoas,
  codigo,
  chave,
}: {
  imoveis?: { id: string; codigo: string }[];
  pessoas: Opcao[];
  codigo?: string;
  chave?: { codigo: string | null; identificacao: string; local: string | null; quantidade: number; responsavel_id: string | null; observacoes: string | null };
}) {
  return (
    <>
      {imoveis && (
        <Campo rotulo="Imóvel">
          <Selecao name="imovel_id" required defaultValue="">
            <option value="">Selecione…</option>
            {imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo}
              </option>
            ))}
          </Selecao>
        </Campo>
      )}
      <div className="grid gap-4 sm:grid-cols-[140px_1fr_90px]">
        <Campo rotulo="Código">
          <Entrada name="codigo" required defaultValue={chave?.codigo ?? codigo} className="uppercase" />
        </Campo>
        <Campo rotulo="Identificação">
          <Entrada name="identificacao" defaultValue={chave?.identificacao ?? ""} placeholder="Portão, apto, molho completo…" />
        </Campo>
        <Campo rotulo="Qtd.">
          <Entrada name="quantidade" type="number" min={1} defaultValue={chave?.quantidade ?? 1} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Onde fica" dica="Quadro de chaves, gaveta, portaria…">
          <Entrada name="local" defaultValue={chave?.local ?? ""} placeholder="Quadro A, gancho 12" />
        </Campo>
        <Campo rotulo="Quem guarda (responsável)">
          <Selecao name="responsavel_id" defaultValue={chave?.responsavel_id ?? ""}>
            <option value="">— no escritório —</option>
            {pessoas.map((p) => (
              <option key={p.id} value={p.id}>
                {p.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} defaultValue={chave?.observacoes ?? ""} />
      </Campo>
    </>
  );
}

/** Campos da retirada: quem leva, por quê e até quando. */
export function CamposRetirada({ chaveId, pessoas, visitaId, hoje }: { chaveId: string; pessoas: Opcao[]; visitaId?: string | null; hoje: string }) {
  return (
    <>
      <input type="hidden" name="chave_id" value={chaveId} />
      {visitaId && <input type="hidden" name="visita_id" value={visitaId} />}
      <Campo rotulo="Quem está levando (cadastrado)">
        <Selecao name="pessoa_id" defaultValue="">
          <option value="">— escolher —</option>
          {pessoas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Ou nome">
        <Entrada name="retirada_por" placeholder="Nome de quem retirou" />
      </Campo>
      <Campo rotulo="Motivo">
        <Selecao name="motivo" defaultValue={visitaId ? "Visita" : "Visita"}>
          {["Visita", "Vistoria", "Manutenção", "Entrega ao inquilino", "Fotos", "Avaliação", "Outro"].map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Selecao>
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Devolve até (data)">
          <Entrada type="date" name="previsao_data" defaultValue={hoje} min={hoje} />
        </Campo>
        <Campo rotulo="Hora">
          <Entrada type="time" name="previsao_hora" defaultValue="18:00" />
        </Campo>
      </div>
    </>
  );
}
