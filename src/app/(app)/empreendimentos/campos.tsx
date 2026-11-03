import { AreaTexto, Campo, Entrada, Grade } from "@/components/ui";

export type Empreendimento = {
  id: string;
  nome: string;
  construtora: string | null;
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  observacoes: string | null;
};

export function CamposEmpreendimento({ e }: { e?: Empreendimento }) {
  return (
    <div className="space-y-4">
      <Grade colunas={2}>
        <Campo rotulo="Nome do empreendimento">
          <Entrada name="nome" required defaultValue={e?.nome} placeholder="Residencial Jardim das Flores" />
        </Campo>
        <Campo rotulo="Construtora / incorporadora">
          <Entrada name="construtora" defaultValue={e?.construtora ?? ""} />
        </Campo>
      </Grade>
      <Grade colunas={4}>
        <Campo rotulo="CEP">
          <Entrada name="cep" defaultValue={e?.cep ?? ""} />
        </Campo>
        <Campo rotulo="Logradouro" className="md:col-span-2">
          <Entrada name="logradouro" defaultValue={e?.logradouro ?? ""} />
        </Campo>
        <Campo rotulo="Número">
          <Entrada name="numero" defaultValue={e?.numero ?? ""} />
        </Campo>
        <Campo rotulo="Bairro">
          <Entrada name="bairro" defaultValue={e?.bairro ?? ""} />
        </Campo>
        <Campo rotulo="Cidade">
          <Entrada name="cidade" defaultValue={e?.cidade ?? ""} />
        </Campo>
        <Campo rotulo="UF">
          <Entrada name="uf" maxLength={2} defaultValue={e?.uf ?? ""} />
        </Campo>
      </Grade>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} defaultValue={e?.observacoes ?? ""} />
      </Campo>
    </div>
  );
}
