import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Campo, Cartao, Entrada, Grade, Selecao } from "@/components/ui";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { COMODIDADES, ROTULO_STATUS_IMOVEL, TIPOS_IMOVEL, type Imovel, type Pessoa } from "@/lib/tipos";
import { salvarImovel } from "./actions";
import { MapaImovel } from "./mapa";

const v = (n: number | string | null | undefined) => (n === null || n === undefined ? "" : String(n));

export type OpcaoEmpreendimento = { id: string; nome: string };

/**
 * Formulário do imóvel. Editando, salva sozinho; cadastrando, tem o botão "Cadastrar".
 * Campos de comercialização (exclusividade, autorização, corretor) ficam na aba própria.
 */
export function FormImovel({
  imovel,
  proprietarios,
  pessoal = false,
  empreendimentos = [],
  empreendimentoPadrao,
}: {
  imovel?: Imovel;
  proprietarios?: Pessoa[];
  pessoal?: boolean;
  empreendimentos?: OpcaoEmpreendimento[];
  empreendimentoPadrao?: string;
}) {
  const i = imovel;
  const fins = i?.finalidades ?? ["locacao"];
  const comodidades = new Set(i?.comodidades ?? []);
  const totalMensal = [i?.valor_aluguel, i?.valor_condominio, i?.valor_iptu, i?.outros_encargos].reduce<number>((s, x) => s + Number(x ?? 0), 0);
  return (
    <Formulario acao={salvarImovel} automatico={Boolean(i)}>
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
            <input type="hidden" name="_finalidades" value="1" />
            <legend className="mb-1 text-sm font-medium text-texto-2">Finalidade</legend>
            <div className="flex flex-wrap gap-4 text-sm">
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
          {!pessoal && (
            <Grade colunas={3}>
              <Campo rotulo="Empreendimento">
                <Selecao name="empreendimento_id" defaultValue={i?.empreendimento_id ?? empreendimentoPadrao ?? ""}>
                  <option value="">— nenhum (imóvel avulso) —</option>
                  {empreendimentos.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Bloco / torre">
                <Entrada name="bloco" defaultValue={i?.bloco ?? ""} />
              </Campo>
              <Campo rotulo="Unidade">
                <Entrada name="unidade" defaultValue={i?.unidade ?? ""} placeholder="101" />
              </Campo>
            </Grade>
          )}
        </div>
      </Cartao>

      <Cartao titulo="Endereço e localização">
        <div className="space-y-4">
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
            <Campo rotulo="Latitude (opcional)" dica="Para o ponto exato no mapa.">
              <Entrada name="latitude" inputMode="decimal" defaultValue={v(i?.latitude)} placeholder="-23.5614" />
            </Campo>
            <Campo rotulo="Longitude (opcional)">
              <Entrada name="longitude" inputMode="decimal" defaultValue={v(i?.longitude)} placeholder="-46.6559" />
            </Campo>
          </Grade>
          {i && <MapaImovel imovel={i} />}
        </div>
      </Cartao>

      <Cartao titulo="Áreas e cômodos">
        <Grade colunas={4}>
          <Campo rotulo="Área útil (m²)">
            <Entrada name="area_util" inputMode="decimal" defaultValue={v(i?.area_util)} />
          </Campo>
          <Campo rotulo="Área construída (m²)">
            <Entrada name="area_construida" inputMode="decimal" defaultValue={v(i?.area_construida)} />
          </Campo>
          <Campo rotulo="Área privativa (m²)">
            <Entrada name="area_privativa" inputMode="decimal" defaultValue={v(i?.area_privativa)} />
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
        </Grade>
      </Cartao>

      <Cartao titulo="Características e comodidades">
        <input type="hidden" name="_comodidades" value="1" />
        <div className="space-y-4">
          {COMODIDADES.map((g) => (
            <fieldset key={g.grupo}>
              <legend className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">{g.grupo}</legend>
              <div className="flex flex-wrap gap-2">
                {g.itens.map((c) => (
                  <label
                    key={c}
                    className="flex cursor-pointer items-center gap-2 rounded-full border border-borda px-3 py-1.5 text-[13px] text-texto-2 transition hover:border-borda-forte has-[:checked]:border-acento has-[:checked]:bg-acento-bg has-[:checked]:text-acento-hot"
                  >
                    <input type="checkbox" name="comodidades" value={c} defaultChecked={comodidades.has(c)} className="sr-only" />
                    {c}
                  </label>
                ))}
              </div>
            </fieldset>
          ))}
          <Campo rotulo="Outros itens" dica="Separe por vírgula: depósito, vista livre, reformado…">
            <Entrada name="caracteristicas" defaultValue={i?.caracteristicas.join(", ") ?? ""} />
          </Campo>
        </div>
      </Cartao>

      <Cartao titulo="Valores e encargos">
        <div className="space-y-4">
          <Grade colunas={4}>
            <Campo rotulo="Aluguel (R$)">
              <Entrada name="valor_aluguel" inputMode="decimal" defaultValue={v(i?.valor_aluguel)} />
            </Campo>
            <Campo rotulo="Venda (R$)">
              <Entrada name="valor_venda" inputMode="decimal" defaultValue={v(i?.valor_venda)} />
            </Campo>
            <Campo rotulo="Condomínio (R$/mês)">
              <Entrada name="valor_condominio" inputMode="decimal" defaultValue={v(i?.valor_condominio)} />
            </Campo>
            <Campo rotulo="IPTU (R$/mês)">
              <Entrada name="valor_iptu" inputMode="decimal" defaultValue={v(i?.valor_iptu)} />
            </Campo>
            <Campo rotulo="Outros encargos (R$/mês)">
              <Entrada name="outros_encargos" inputMode="decimal" defaultValue={v(i?.outros_encargos)} />
            </Campo>
            <Campo rotulo="Quais encargos" className="md:col-span-3">
              <Entrada name="outros_encargos_descricao" defaultValue={i?.outros_encargos_descricao ?? ""} placeholder="Taxa de lixo, seguro incêndio, fundo de reserva…" />
            </Campo>
          </Grade>
          {i && totalMensal > 0 && (
            <p className="text-sm text-texto-2">
              Custo mensal total para o inquilino: <strong className="text-texto">{formatarReais(totalMensal)}</strong>{" "}
              <span className="text-mudo">(aluguel + condomínio + IPTU + outros)</span>
            </p>
          )}
        </div>
      </Cartao>

      <Cartao titulo="Documentação">
        <Grade colunas={3}>
          <Campo rotulo="Matrícula">
            <Entrada name="matricula" defaultValue={i?.matricula ?? ""} />
          </Campo>
          <Campo rotulo="Inscrição IPTU">
            <Entrada name="inscricao_iptu" defaultValue={i?.inscricao_iptu ?? ""} />
          </Campo>
        </Grade>
        {i && <p className="mt-3 text-xs text-mudo">Os arquivos (matrícula, escritura, IPTU…) ficam na aba Documentos.</p>}
      </Cartao>

      <Cartao titulo="Anúncio">
        <div className="space-y-4">
          <Campo rotulo="Título">
            <Entrada name="titulo" defaultValue={i?.titulo ?? ""} />
          </Campo>
          <Campo rotulo="Descrição">
            <AreaTexto name="descricao" rows={5} defaultValue={i?.descricao ?? ""} />
          </Campo>
          <input type="hidden" name="_publicar_site" value="1" />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" name="publicar_site" defaultChecked={i?.publicar_site} />
            Publicar no site (e nos portais configurados em Site e portais)
          </label>
        </div>
      </Cartao>

      {!i && (
        <div className="flex flex-wrap items-center justify-end gap-4">
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="checkbox" name="ignorar_duplicado" /> Cadastrar mesmo assim se parecer repetido
          </label>
          <BotaoEnviar>Cadastrar imóvel</BotaoEnviar>
        </div>
      )}
    </Formulario>
  );
}
