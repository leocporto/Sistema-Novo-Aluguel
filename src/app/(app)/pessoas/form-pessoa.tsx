import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Campo, Cartao, Entrada, Grade, Selecao } from "@/components/ui";
import type { Pessoa } from "@/lib/tipos";
import { ROTULO_PAPEL } from "@/lib/tipos";
import { PAPEIS_SO_IMOBILIARIA } from "@/lib/modos";
import { salvarPessoa } from "./actions";

export interface ImovelOpcao {
  id: string;
  codigo: string;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
}

export function FormPessoa({
  pessoa,
  papelInicial,
  imoveis = [],
  imoveisVinculados = [],
  pessoal = false,
}: {
  pessoa?: Pessoa;
  papelInicial?: string;
  imoveis?: ImovelOpcao[];
  imoveisVinculados?: string[];
  /** Modo imóveis pessoais: sem vínculo de proprietário nem imposto de repasse. */
  pessoal?: boolean;
}) {
  const p = pessoa;
  const papeis = p?.papeis ?? (papelInicial ? [papelInicial] : []);
  return (
    <Formulario acao={salvarPessoa} automatico={Boolean(p)}>
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
            <Campo rotulo="Especialidade (prestador)">
              <Entrada name="especialidade" defaultValue={p?.especialidade ?? ""} placeholder="Encanador, eletricista, pintor…" />
            </Campo>
            <Campo rotulo="E-mail">
              <Entrada type="email" name="email" defaultValue={p?.email ?? ""} />
            </Campo>
            <Campo rotulo="Telefone / WhatsApp">
              <Entrada name="telefone" defaultValue={p?.telefone ?? ""} />
            </Campo>
          </Grade>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-texto-2">Papéis</legend>
            <div className="flex flex-wrap gap-4 text-sm">
              {Object.entries(ROTULO_PAPEL)
                .filter(([k]) => !pessoal || !(PAPEIS_SO_IMOBILIARIA as readonly string[]).includes(k) || papeis.includes(k))
                .map(([k, v]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" name="papeis" value={k} defaultChecked={papeis.includes(k)} />
                  {v}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Cartao>

      {!pessoal && (
      <Cartao titulo="Imóveis desta pessoa (como proprietária)">
        <input type="hidden" name="vinculo_imoveis" value="1" />
        {imoveis.length === 0 ? (
          <p className="text-sm text-mudo">Nenhum imóvel cadastrado ainda.</p>
        ) : (
          <>
            <p className="mb-3 text-xs text-mudo">
              Marque os imóveis dos quais esta pessoa é proprietária. Ao marcar, ela é vinculada com a participação que falta para
              100% (ajuste as porcentagens na página do imóvel, se houver mais de um dono).
            </p>
            <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
              {imoveis.map((i) => (
                <label
                  key={i.id}
                  className="flex items-start gap-2 rounded-lg border border-borda px-3 py-2 text-sm hover:bg-card-hover"
                >
                  <input type="checkbox" name="imoveis" value={i.id} defaultChecked={imoveisVinculados.includes(i.id)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{[i.logradouro, i.numero].filter(Boolean).join(", ") || "Sem endereço"}</span>
                    <span className="block text-xs text-mudo">
                      {i.codigo}
                      {i.bairro || i.cidade ? ` · ${[i.bairro, i.cidade].filter(Boolean).join(", ")}` : ""}
                    </span>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
      </Cartao>
      )}

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

      {pessoal ? (
        <input
          type="hidden"
          name="imposto_pct"
          value={p?.imposto_pct === null || p?.imposto_pct === undefined ? "" : String(p.imposto_pct)}
        />
      ) : (
      <Cartao titulo="Imposto sobre o repasse (proprietário)">
        <Grade colunas={3}>
          <Campo
            rotulo="Imposto descontado no repasse (%)"
            dica="Em branco = padrão da imobiliária para pessoa física ou jurídica (Configurações). Use 0 para não descontar."
          >
            <Entrada
              name="imposto_pct"
              inputMode="decimal"
              placeholder="padrão da imobiliária"
              defaultValue={p?.imposto_pct === null || p?.imposto_pct === undefined ? "" : String(p.imposto_pct)}
            />
          </Campo>
        </Grade>
      </Cartao>
      )}

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

      {!p && (
        <div className="flex justify-end">
          <BotaoEnviar>Cadastrar pessoa</BotaoEnviar>
        </div>
      )}
    </Formulario>
  );
}
