import type { Metadata } from "next";
import Link from "next/link";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Entrada, Grade, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { INDICES, NOME_INDICE } from "@/lib/dominio/reajuste";
import { ROTULO_GARANTIA, ROTULO_REPASSE, type Imovel, type Pessoa } from "@/lib/tipos";
import { criarContrato } from "../actions";

export const metadata: Metadata = { title: "Novo contrato" };

export default async function NovoContratoPage({ searchParams }: PageProps<"/contratos/novo">) {
  const sp = await searchParams;
  const imovelSel = typeof sp.imovel === "string" ? sp.imovel : "";
  const { supabase, organizacao: org } = await obterContexto();
  const [{ data: imoveis }, { data: pessoas }] = await Promise.all([
    supabase.from("imoveis").select("*").contains("finalidades", ["locacao"]).neq("status", "inativo").order("codigo"),
    supabase.from("pessoas").select("id, nome, documento").order("nome"),
  ]);
  const lista = (imoveis ?? []) as Imovel[];
  const imovel = lista.find((i) => i.id === imovelSel);
  const ps = (pessoas ?? []) as Pick<Pessoa, "id" | "nome" | "documento">[];

  return (
    <>
      <Cabecalho titulo="Novo contrato de locação" descricao="Os proprietários e suas participações vêm do cadastro do imóvel." />
      {lista.length === 0 && (
        <Aviso tipo="alerta">
          Cadastre primeiro um <Link className="underline" href="/imoveis/novo">imóvel</Link> com finalidade locação e vincule o proprietário.
        </Aviso>
      )}
      {!imovel && lista.length > 0 && (
        <form className="mb-6 flex items-end gap-2">
          <Campo rotulo="Escolha o imóvel para preencher os valores sugeridos">
            <Selecao name="imovel" defaultValue="">
              <option value="" disabled>
                Selecione…
              </option>
              {lista.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.codigo} — {i.logradouro} {i.numero} ({i.status})
                </option>
              ))}
            </Selecao>
          </Campo>
          <button className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">Continuar</button>
        </form>
      )}
      {imovel && (
        <Formulario acao={criarContrato}>
          <input type="hidden" name="imovel_id" value={imovel.id} />
          <Cartao titulo={`Imóvel ${imovel.codigo} — ${[imovel.logradouro, imovel.numero].filter(Boolean).join(", ")}`}>
            <Grade colunas={4}>
              <Campo rotulo="Locatário">
                <Selecao name="locatario_id" required defaultValue="">
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {ps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Código interno (opcional)">
                <Entrada name="codigo" />
              </Campo>
              <Campo rotulo="Finalidade">
                <Selecao name="finalidade" defaultValue="residencial">
                  <option value="residencial">Residencial</option>
                  <option value="comercial">Comercial</option>
                  <option value="temporada">Temporada</option>
                </Selecao>
              </Campo>
              <div className="flex items-end text-sm">
                <Link href="/pessoas/novo?papel=locatario" className="text-emerald-700 hover:underline" target="_blank">
                  + cadastrar pessoa
                </Link>
              </div>
            </Grade>
          </Cartao>

          <Cartao titulo="Prazo e valores">
            <Grade colunas={4}>
              <Campo rotulo="Início">
                <Entrada type="date" name="data_inicio" required defaultValue={hojeISO()} />
              </Campo>
              <Campo rotulo="Prazo (meses)">
                <Entrada type="number" min={1} name="prazo_meses" defaultValue={30} />
              </Campo>
              <Campo rotulo="Aluguel (R$)">
                <Entrada name="valor_aluguel" required inputMode="decimal" defaultValue={imovel.valor_aluguel ?? ""} />
              </Campo>
              <Campo rotulo="Dia do vencimento">
                <Entrada type="number" min={1} max={31} name="dia_vencimento" defaultValue={10} />
              </Campo>
              <Campo rotulo="Modalidade" dica="Vencido: paga no mês seguinte ao uso.">
                <Selecao name="modalidade" defaultValue="vencido">
                  <option value="vencido">Mês vencido</option>
                  <option value="antecipado">Mês antecipado</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Índice de reajuste">
                <Selecao name="indice_reajuste" defaultValue="IGPM">
                  {INDICES.map((i) => (
                    <option key={i} value={i}>
                      {NOME_INDICE[i]}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Reajuste a cada (meses)">
                <Entrada type="number" min={1} name="periodicidade_reajuste_meses" defaultValue={12} />
              </Campo>
            </Grade>
          </Cartao>

          <Cartao titulo="Encargos mensais cobrados do locatário">
            <Grade colunas={4}>
              <Campo rotulo="Condomínio (R$)">
                <Entrada name="encargo_condominio" inputMode="decimal" defaultValue={imovel.valor_condominio ?? ""} />
              </Campo>
              <Campo rotulo="Condomínio vai para">
                <Selecao name="encargo_condominio_destino" defaultValue="terceiro">
                  <option value="terceiro">Pago pela imobiliária ao condomínio</option>
                  <option value="proprietario">Repassado ao proprietário</option>
                </Selecao>
              </Campo>
              <Campo rotulo="IPTU mensal (R$)">
                <Entrada name="encargo_iptu" inputMode="decimal" defaultValue={imovel.valor_iptu ?? ""} />
              </Campo>
              <Campo rotulo="IPTU vai para">
                <Selecao name="encargo_iptu_destino" defaultValue="proprietario">
                  <option value="proprietario">Repassado ao proprietário</option>
                  <option value="terceiro">Pago pela imobiliária à prefeitura</option>
                </Selecao>
              </Campo>
            </Grade>
          </Cartao>

          <Cartao titulo="Administração e repasse">
            <Grade colunas={4}>
              <Campo rotulo="Taxa de administração (%)">
                <Entrada name="taxa_administracao_pct" inputMode="decimal" defaultValue={String(org.taxa_administracao_pct)} />
              </Campo>
              <Campo rotulo="Intermediação (% do 1º aluguel)">
                <Entrada name="taxa_intermediacao_pct" inputMode="decimal" defaultValue={String(org.taxa_intermediacao_pct)} />
              </Campo>
              <Campo rotulo="Tipo de repasse">
                <Selecao name="tipo_repasse" defaultValue="automatico">
                  {Object.entries(ROTULO_REPASSE).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Repassar em (dias)" dica="Após o pagamento (ou após o vencimento, se garantido).">
                <Entrada type="number" min={0} name="dias_repasse" defaultValue={2} />
              </Campo>
            </Grade>
            <label className="mt-4 flex items-center gap-2 text-sm">
              <input type="checkbox" name="repassar_multa_juros" defaultChecked />
              Repassar multa e juros de atraso ao proprietário
            </label>
          </Cartao>

          <Cartao titulo="Atraso e rescisão">
            <Grade colunas={4}>
              <Campo rotulo="Multa por atraso (%)">
                <Entrada name="multa_atraso_pct" inputMode="decimal" defaultValue={String(org.multa_atraso_pct)} />
              </Campo>
              <Campo rotulo="Juros (% ao mês)">
                <Entrada name="juros_mes_pct" inputMode="decimal" defaultValue={String(org.juros_mes_pct)} />
              </Campo>
              <Campo rotulo="Carência (dias)">
                <Entrada type="number" min={0} name="carencia_dias" defaultValue={org.carencia_dias} />
              </Campo>
              <Campo rotulo="Multa rescisória (nº de aluguéis)">
                <Entrada name="multa_rescisoria_alugueis" inputMode="decimal" defaultValue="3" />
              </Campo>
            </Grade>
          </Cartao>

          <Cartao titulo="Garantia e seguro">
            <Grade colunas={4}>
              <Campo rotulo="Tipo de garantia">
                <Selecao name="garantia_tipo" defaultValue="sem_garantia">
                  {Object.entries(ROTULO_GARANTIA).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Fiador (se houver)">
                <Selecao name="fiador_id" defaultValue="">
                  <option value="">—</option>
                  {ps.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nome}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Valor da garantia (R$)" dica="Caução, título ou cobertura do seguro.">
                <Entrada name="garantia_valor" inputMode="decimal" />
              </Campo>
              <Campo rotulo="Detalhes" dica="Seguradora, apólice, banco do depósito…">
                <Entrada name="garantia_detalhes" />
              </Campo>
              <Campo rotulo="Apólice seguro incêndio">
                <Entrada name="seguro_incendio_apolice" />
              </Campo>
              <Campo rotulo="Vencimento do seguro">
                <Entrada type="date" name="seguro_incendio_vencimento" />
              </Campo>
            </Grade>
          </Cartao>

          <Cartao titulo="Observações">
            <AreaTexto name="observacoes" />
          </Cartao>

          <div className="flex justify-end">
            <BotaoEnviar>Criar contrato</BotaoEnviar>
          </div>
        </Formulario>
      )}
    </>
  );
}
