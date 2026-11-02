import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Campo, Cartao, Entrada, Grade, Selecao } from "@/components/ui";
import type { Pessoa } from "@/lib/tipos";
import { ROTULO_PAPEL } from "@/lib/tipos";
import { salvarPessoa } from "./actions";

export function FormPessoa({ pessoa, papelInicial }: { pessoa?: Pessoa; papelInicial?: string }) {
  const p = pessoa;
  const papeis = p?.papeis ?? (papelInicial ? [papelInicial] : []);
  return (
    <Formulario acao={salvarPessoa}>
      {p && <input type="hidden" name="id" value={p.id} />}
      <Cartao titulo="Dados principais">
        <div className="space-y-4">
          <Grade colunas={4}>
            <Campo rotulo="Tipo">
              <Selecao name="tipo_pessoa" defaultValue={p?.tipo_pessoa ?? "PF"}>
                <option value="PF">Pessoa física</option>
                <option value="PJ">Pessoa jurídica</option>
              </Selecao>
            </Campo>
            <Campo rotulo="Nome / Razão social" className="md:col-span-2">
              <Entrada name="nome" required defaultValue={p?.nome} />
            </Campo>
            <Campo rotulo="CPF / CNPJ">
              <Entrada name="documento" defaultValue={p?.documento ?? ""} />
            </Campo>
            <Campo rotulo="RG / Inscrição estadual">
              <Entrada name="rg_ie" defaultValue={p?.rg_ie ?? ""} />
            </Campo>
            <Campo rotulo="Nascimento">
              <Entrada type="date" name="data_nascimento" defaultValue={p?.data_nascimento ?? ""} />
            </Campo>
            <Campo rotulo="Estado civil">
              <Entrada name="estado_civil" defaultValue={p?.estado_civil ?? ""} />
            </Campo>
            <Campo rotulo="Profissão">
              <Entrada name="profissao" defaultValue={p?.profissao ?? ""} />
            </Campo>
            <Campo rotulo="E-mail">
              <Entrada type="email" name="email" defaultValue={p?.email ?? ""} />
            </Campo>
            <Campo rotulo="Telefone / WhatsApp">
              <Entrada name="telefone" defaultValue={p?.telefone ?? ""} />
            </Campo>
          </Grade>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Papéis</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {Object.entries(ROTULO_PAPEL).map(([k, v]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" name="papeis" value={k} defaultChecked={papeis.includes(k)} />
                  {v}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Cartao>

      <Cartao titulo="Endereço">
        <Grade colunas={4}>
          <Campo rotulo="CEP">
            <Entrada name="cep" defaultValue={p?.cep ?? ""} />
          </Campo>
          <Campo rotulo="Logradouro" className="md:col-span-2">
            <Entrada name="logradouro" defaultValue={p?.logradouro ?? ""} />
          </Campo>
          <Campo rotulo="Número">
            <Entrada name="numero" defaultValue={p?.numero ?? ""} />
          </Campo>
          <Campo rotulo="Complemento">
            <Entrada name="complemento" defaultValue={p?.complemento ?? ""} />
          </Campo>
          <Campo rotulo="Bairro">
            <Entrada name="bairro" defaultValue={p?.bairro ?? ""} />
          </Campo>
          <Campo rotulo="Cidade">
            <Entrada name="cidade" defaultValue={p?.cidade ?? ""} />
          </Campo>
          <Campo rotulo="UF">
            <Entrada name="uf" maxLength={2} defaultValue={p?.uf ?? ""} />
          </Campo>
        </Grade>
      </Cartao>

      <Cartao titulo="Dados bancários (para repasses)">
        <Grade colunas={4}>
          <Campo rotulo="Banco">
            <Entrada name="banco" defaultValue={p?.banco ?? ""} />
          </Campo>
          <Campo rotulo="Agência">
            <Entrada name="agencia" defaultValue={p?.agencia ?? ""} />
          </Campo>
          <Campo rotulo="Conta">
            <Entrada name="conta" defaultValue={p?.conta ?? ""} />
          </Campo>
          <Campo rotulo="Tipo de conta">
            <Selecao name="tipo_conta" defaultValue={p?.tipo_conta ?? ""}>
              <option value="">—</option>
              <option value="corrente">Corrente</option>
              <option value="poupanca">Poupança</option>
              <option value="pagamento">Pagamento</option>
            </Selecao>
          </Campo>
          <Campo rotulo="Chave Pix" className="md:col-span-2">
            <Entrada name="pix_chave" defaultValue={p?.pix_chave ?? ""} />
          </Campo>
        </Grade>
      </Cartao>

      <Cartao titulo="Observações">
        <AreaTexto name="observacoes" defaultValue={p?.observacoes ?? ""} />
      </Cartao>

      <div className="flex justify-end">
        <BotaoEnviar>Salvar</BotaoEnviar>
      </div>
    </Formulario>
  );
}
