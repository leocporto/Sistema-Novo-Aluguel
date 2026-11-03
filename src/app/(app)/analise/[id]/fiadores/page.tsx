import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Plus, ShieldCheck, UserPlus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { SeletorPessoa } from "@/components/seletor-pessoa";
import { Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_STATUS_FIADOR, papelDecide, rendaComprovada, rendaMinimaFiador, situacaoDocumento, ultimaConsulta } from "@/lib/dominio/analise";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { adicionarFiador, adicionarRenda, atualizarFiador, conferirIdentidade, desfazerIdentidade, excluirFiador } from "../../actions";
import { CamposRenda } from "../../campos";
import { carregarAnalise, carregarConfig, carregarOpcoes, nomesEquipe, quando } from "../../dados";
import { LinhaRenda } from "../../linha-renda";

export const metadata: Metadata = { title: "Fiadores" };

export default async function FiadoresAnalise({ params }: PageProps<"/analise/[id]/fiadores">) {
  const { id } = await params;
  const { supabase, usuario, papel, organizacao } = await obterContexto();
  const [c, cfg, opcoes, nome] = await Promise.all([carregarAnalise(supabase, id), carregarConfig(supabase, organizacao.id), carregarOpcoes(supabase), nomesEquipe(supabase, usuario.id)]);
  if (!c) notFound();
  const { analise: a, fiadores, rendas, consultas } = c;
  const minimo = rendaMinimaFiador(a.valor_aluguel, a.valor_encargos, cfg.renda_fiador_multiplo);
  const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));
  const podeDecidir = papelDecide(papel);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-texto-2">
          Cada fiador tem análise própria: renda comprovada (mínimo de {String(cfg.renda_fiador_multiplo).replace(".", ",")}× o aluguel + encargos ={" "}
          <b className="text-texto">{formatarReais(minimo)}</b>), imóvel em garantia com matrícula, cônjuge e consulta de crédito (aba Crédito).
        </p>
        <JanelaCadastro rotuloBotao={<><UserPlus className="size-4" /> Incluir fiador</>} titulo="Incluir fiador" acao={adicionarFiador} rotuloSalvar="Incluir" icone={<UserPlus />}>
          <input type="hidden" name="analise_id" value={id} />
          <Campo rotulo="Fiador">
            <SeletorPessoa name="pessoa_id" pessoas={opcoes.pessoas.filter((p) => p.id !== a.candidato_id)} papel="fiador" rotuloNovo="Novo fiador" obrigatorio />
          </Campo>
          <Campo rotulo="Relação com o candidato">
            <Entrada name="parentesco" placeholder="Pai, irmã, amigo, sócio…" />
          </Campo>
          <p className="text-xs text-mudo">Os documentos do fiador entram sozinhos no checklist.</p>
        </JanelaCadastro>
      </div>

      {fiadores.length === 0 && (
        <Cartao>
          <p className="text-sm text-mudo">Nenhum fiador. Se a garantia for fiança, inclua o fiador aqui; se for seguro-fiança, caução ou título, use a aba Garantias.</p>
        </Cartao>
      )}

      {fiadores.map((f) => {
        const renda = rendaComprovada(rendas, f.id);
        const ok = renda >= minimo;
        const doc = situacaoDocumento(f.pessoa?.documento);
        const consulta = ultimaConsulta(consultas, f.id);
        const rendasDele = rendas.filter((r) => r.fiador_id === f.id);
        return (
          <Cartao
            key={f.id}
            titulo={
              <span className="flex flex-wrap items-center gap-2">
                <Link href={`/pessoas/${f.pessoa_id}`} className="hover:underline">
                  {f.pessoa?.nome ?? "Fiador"}
                </Link>
                <Selo cor={f.status === "aprovado" ? "verde" : f.status === "reprovado" ? "vermelho" : "cinza"}>{ROTULO_STATUS_FIADOR[f.status]}</Selo>
              </span>
            }
            acoes={<BotaoExcluir acao={excluirFiador} id={f.id} rotulo="Tirar fiador" confirmar={`Tirar ${f.pessoa?.nome ?? "o fiador"} desta análise? Os documentos e rendas dele saem junto.`} />}
          >
            <div className="mb-4 grid gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-[12px] border border-borda bg-elev px-3 py-2.5">
                <div className="text-xs text-mudo">CPF / CNPJ</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-texto">{f.pessoa?.documento ? formatarDocumento(f.pessoa.documento) : "—"}</span>
                  <Selo cor={doc === "valido" ? "verde" : doc === "invalido" ? "vermelho" : "amarelo"}>{doc === "valido" ? "válido" : doc === "invalido" ? "inválido" : "falta"}</Selo>
                </div>
              </div>
              <div className="rounded-[12px] border border-borda bg-elev px-3 py-2.5">
                <div className="text-xs text-mudo">Renda comprovada</div>
                <div className={`font-semibold tabular-nums ${ok ? "text-ok" : "text-ruim"}`}>{formatarReais(renda)}</div>
                <div className="text-xs text-mudo">mínimo {formatarReais(minimo)}</div>
              </div>
              <div className="rounded-[12px] border border-borda bg-elev px-3 py-2.5">
                <div className="text-xs text-mudo">Crédito</div>
                <div className="text-texto">{consulta ? `${consulta.score ?? "sem score"} · ${consulta.restricoes ? "com restrições" : "sem restrições"}` : "sem consulta"}</div>
                <Link href={`/analise/${id}/credito`} className="text-xs text-acento hover:underline">
                  registrar consulta
                </Link>
              </div>
              <div className="rounded-[12px] border border-borda bg-elev px-3 py-2.5">
                <div className="text-xs text-mudo">Documento original</div>
                {f.identidade_conferida_em ? (
                  <div className="text-xs text-texto-2">
                    conferido por {nome(f.identidade_conferida_por)} em {quando(f.identidade_conferida_em)}{" "}
                    <BotaoAcao acao={desfazerIdentidade} id={`fiador:${f.id}`} tamanho="sm" variante="fantasma" confirmar="Desfazer a conferência?">
                      desfazer
                    </BotaoAcao>
                  </div>
                ) : (
                  <BotaoAcao acao={conferirIdentidade} id={`fiador:${f.id}`} tamanho="sm" confirmar="Confirma que conferiu o documento original do fiador?">
                    <ShieldCheck className="size-3.5" /> Conferi
                  </BotaoAcao>
                )}
              </div>
            </div>

            <Formulario acao={atualizarFiador} automatico>
              <input type="hidden" name="id" value={f.id} />
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Campo rotulo="Parecer sobre o fiador" dica={podeDecidir ? undefined : "Só administrador, gestor ou financeiro aprovam."}>
                  <Selecao name="status" defaultValue={f.status} disabled={!podeDecidir}>
                    <option value="pendente">Pendente</option>
                    <option value="aprovado">Aprovado</option>
                    <option value="reprovado">Reprovado</option>
                  </Selecao>
                </Campo>
                <Campo rotulo="Relação com o candidato">
                  <Entrada name="parentesco" defaultValue={f.parentesco ?? ""} />
                </Campo>
                <Campo rotulo="Por quê (parecer)">
                  <Entrada name="parecer" defaultValue={f.parecer ?? ""} />
                </Campo>
                <Campo rotulo="Cônjuge (nome)">
                  <Entrada name="conjuge_nome" defaultValue={f.conjuge_nome ?? ""} />
                </Campo>
                <Campo rotulo="CPF do cônjuge">
                  <Entrada name="conjuge_documento" inputMode="numeric" defaultValue={f.conjuge_documento ?? ""} />
                </Campo>
                <div className="flex items-end pb-3">
                  <input type="hidden" name="outorga_conjuge" value="" />
                  <label className="flex items-center gap-2 text-sm text-texto-2">
                    <input type="checkbox" name="outorga_conjuge" defaultChecked={f.outorga_conjuge} className="size-4 accent-[var(--accent)]" /> Cônjuge vai assinar junto (outorga)
                  </label>
                </div>
                <Campo rotulo="Imóvel em garantia (endereço)" className="sm:col-span-2">
                  <Entrada name="imovel_descricao" defaultValue={f.imovel_descricao ?? ""} />
                </Campo>
                <Campo rotulo="Valor estimado do imóvel (R$)">
                  <Entrada name="imovel_valor" inputMode="decimal" defaultValue={v(f.imovel_valor)} />
                </Campo>
                <Campo rotulo="Matrícula">
                  <Entrada name="imovel_matricula" defaultValue={f.imovel_matricula ?? ""} />
                </Campo>
                <Campo rotulo="Cartório de registro">
                  <Entrada name="imovel_cartorio" defaultValue={f.imovel_cartorio ?? ""} />
                </Campo>
                <div className="flex items-end pb-3">
                  <input type="hidden" name="imovel_onus" value="" />
                  <label className="flex items-center gap-2 text-sm text-texto-2">
                    <input type="checkbox" name="imovel_onus" defaultChecked={f.imovel_onus} className="size-4 accent-[var(--accent)]" /> Imóvel tem ônus (hipoteca, penhora…)
                  </label>
                </div>
              </div>
              {f.analisado_em && (
                <p className="text-xs text-mudo">
                  Parecer dado por {nome(f.analisado_por)} em {quando(f.analisado_em)}.
                </p>
              )}
            </Formulario>

            <div className="mt-5 border-t border-borda-suave pt-4">
              <div className="mb-3 flex items-center justify-between gap-2">
                <h4 className="text-sm font-semibold text-texto">Renda do fiador</h4>
                <JanelaCadastro rotuloBotao={<><Plus className="size-3.5" /> Incluir renda</>} tamanho="sm" variante="secundario" titulo={`Renda de ${f.pessoa?.nome ?? "fiador"}`} acao={adicionarRenda} rotuloSalvar="Incluir" larguraMax="max-w-2xl">
                  <input type="hidden" name="analise_id" value={id} />
                  <input type="hidden" name="fiador_id" value={f.id} />
                  <CamposRenda />
                </JanelaCadastro>
              </div>
              {rendasDele.length ? (
                <ul className="space-y-3">
                  {rendasDele.map((r) => (
                    <LinhaRenda key={r.id} r={r} nome={nome} />
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-mudo">Nenhuma renda cadastrada.</p>
              )}
            </div>
            {f.consentimento_em && <p className="mt-3 text-xs text-mudo">Autorizou consulta em {formatarDataBR(f.consentimento_em.slice(0, 10))}.</p>}
          </Cartao>
        );
      })}
      {fiadores.length > 0 && <p className="text-xs text-mudo">Fiador aprovado conta como garantia na decisão — desde que a renda comprovada passe do mínimo.</p>}
    </div>
  );
}
