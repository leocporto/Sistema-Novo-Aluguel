import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Campo, Cartao, Entrada, Grade, Selecao } from "@/components/ui";
import { ROTULO_STATUS_IMOVEL, TIPOS_IMOVEL, type Imovel, type Pessoa } from "@/lib/tipos";
import { salvarImovel } from "./actions";

const v = (n: number | string | null | undefined) => (n === null || n === undefined ? "" : String(n));

export function FormImovel({ imovel, proprietarios }: { imovel?: Imovel; proprietarios?: Pessoa[] }) {
  const i = imovel;
  const fins = i?.finalidades ?? ["locacao"];
  return (
    <Formulario acao={salvarImovel}>
      {i && <input type="hidden" name="id" value={i.id} />}
      <Cartao titulo="Identificação">
        <div className="space-y-4">
          <Grade colunas={4}>
            <Campo rotulo="Código">
              <Entrada name="codigo" required defaultValue={i?.codigo} placeholder="AP-101" />
            </Campo>
            <Campo rotulo="Tipo">
              <Selecao name="tipo" defaultValue={i?.tipo ?? "apartamento"}>
                {TIPOS_IMOVEL.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Situação">
              <Selecao name="status" defaultValue={i?.status ?? "disponivel"}>
                {Object.entries(ROTULO_STATUS_IMOVEL).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            {!i && proprietarios && (
              <Campo rotulo="Proprietário">
                <Selecao name="proprietario_id" defaultValue="">
                  <option value="">Vincular depois</option>
                  {proprietarios.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
            )}
          </Grade>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-slate-700">Finalidades</legend>
            <div className="flex gap-4 text-sm">
              {[
                ["locacao", "Locação"],
                ["venda", "Venda"],
                ["temporada", "Temporada"],
              ].map(([k, r]) => (
                <label key={k} className="flex items-center gap-2">
                  <input type="checkbox" name="finalidades" value={k} defaultChecked={fins.includes(k)} />
                  {r}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Cartao>

      <Cartao titulo="Endereço">
        <Grade colunas={4}>
          <Campo rotulo="CEP">
            <Entrada name="cep" defaultValue={i?.cep ?? ""} />
          </Campo>
          <Campo rotulo="Logradouro" className="md:col-span-2">
            <Entrada name="logradouro" defaultValue={i?.logradouro ?? ""} />
          </Campo>
          <Campo rotulo="Número">
            <Entrada name="numero" defaultValue={i?.numero ?? ""} />
          </Campo>
          <Campo rotulo="Complemento">
            <Entrada name="complemento" defaultValue={i?.complemento ?? ""} />
          </Campo>
          <Campo rotulo="Bairro">
            <Entrada name="bairro" defaultValue={i?.bairro ?? ""} />
          </Campo>
          <Campo rotulo="Cidade">
            <Entrada name="cidade" defaultValue={i?.cidade ?? ""} />
          </Campo>
          <Campo rotulo="UF">
            <Entrada name="uf" maxLength={2} defaultValue={i?.uf ?? ""} />
          </Campo>
        </Grade>
      </Cartao>

      <Cartao titulo="Características">
        <div className="space-y-4">
          <Grade colunas={4}>
            <Campo rotulo="Área útil (m²)">
              <Entrada name="area_util" inputMode="decimal" defaultValue={v(i?.area_util)} />
            </Campo>
            <Campo rotulo="Área total (m²)">
              <Entrada name="area_total" inputMode="decimal" defaultValue={v(i?.area_total)} />
            </Campo>
            <Campo rotulo="Quartos">
              <Entrada type="number" min={0} name="quartos" defaultValue={v(i?.quartos)} />
            </Campo>
            <Campo rotulo="Suítes">
              <Entrada type="number" min={0} name="suites" defaultValue={v(i?.suites)} />
            </Campo>
            <Campo rotulo="Banheiros">
              <Entrada type="number" min={0} name="banheiros" defaultValue={v(i?.banheiros)} />
            </Campo>
            <Campo rotulo="Vagas">
              <Entrada type="number" min={0} name="vagas" defaultValue={v(i?.vagas)} />
            </Campo>
            <Campo rotulo="Matrícula">
              <Entrada name="matricula" defaultValue={i?.matricula ?? ""} />
            </Campo>
            <Campo rotulo="Inscrição IPTU">
              <Entrada name="inscricao_iptu" defaultValue={i?.inscricao_iptu ?? ""} />
            </Campo>
          </Grade>
          <Campo rotulo="Itens e diferenciais" dica="Separe por vírgula: piscina, churrasqueira, mobiliado…">
            <Entrada name="caracteristicas" defaultValue={i?.caracteristicas.join(", ") ?? ""} />
          </Campo>
        </div>
      </Cartao>

      <Cartao titulo="Valores">
        <Grade colunas={4}>
          <Campo rotulo="Aluguel (R$)">
            <Entrada name="valor_aluguel" inputMode="decimal" defaultValue={v(i?.valor_aluguel)} />
          </Campo>
          <Campo rotulo="Venda (R$)">
            <Entrada name="valor_venda" inputMode="decimal" defaultValue={v(i?.valor_venda)} />
          </Campo>
          <Campo rotulo="Condomínio (R$)">
            <Entrada name="valor_condominio" inputMode="decimal" defaultValue={v(i?.valor_condominio)} />
          </Campo>
          <Campo rotulo="IPTU mensal (R$)">
            <Entrada name="valor_iptu" inputMode="decimal" defaultValue={v(i?.valor_iptu)} />
          </Campo>
        </Grade>
      </Cartao>

      <Cartao titulo="Anúncio">
        <div className="space-y-4">
          <Campo rotulo="Título">
            <Entrada name="titulo" defaultValue={i?.titulo ?? ""} />
          </Campo>
          <Campo rotulo="Descrição">
            <AreaTexto name="descricao" rows={5} defaultValue={i?.descricao ?? ""} />
          </Campo>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="publicar_site" defaultChecked={i?.publicar_site} />
            Publicar no site e portais (quando a integração estiver ativa)
          </label>
        </div>
      </Cartao>

      <div className="flex justify-end">
        <BotaoEnviar>Salvar</BotaoEnviar>
      </div>
    </Formulario>
  );
}
