import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { BadgeCheck, FileCheck2, Gauge, Link2, Mail, MessageCircle, ShieldCheck, Wallet } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoAcao } from "@/components/botao-acao";
import { Copiar } from "@/components/copiar";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, Campo, Cartao, Entrada, Indicador, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import {
  COR_STATUS_GARANTIA_PROPOSTA,
  GARANTIA_APROVADA,
  ROTULO_SEMAFORO,
  ROTULO_STATUS_GARANTIA_PROPOSTA,
  comprometimentoPct,
  foraDaRegra,
  mensagemFicha,
  progressoDocumentos,
  rendaComprovada,
  semaforoComprometimento,
  situacaoDocumento,
  ultimaConsulta,
} from "@/lib/dominio/analise";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { ROTULO_TIPO_GARANTIA } from "@/lib/dominio/garantias";
import { linkWhatsapp } from "@/lib/whatsapp";
import {
  ativarFicha,
  atualizarAnalise,
  conferirIdentidade,
  desativarFicha,
  desfazerIdentidade,
  marcarDesistencia,
  novoLinkFicha,
  retomarAnalise,
} from "../actions";
import { carregarAnalise, carregarConfig, carregarOpcoes, dadosDaRegra, enderecoSite, nomesEquipe, quando } from "../dados";
import { OpcoesNome } from "../campos";
import { ContadorPct } from "../contador-pct";

export const metadata: Metadata = { title: "Análise do candidato" };

const TOM = { verde: "sucesso", amarelo: "alerta", vermelho: "perigo", sem_renda: "neutro" } as const;

export default async function AnaliseResumo({ params }: PageProps<"/analise/[id]">) {
  const { id } = await params;
  const { supabase, organizacao, usuario } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const [c, cfg, opcoes, nome, site] = await Promise.all([carregarAnalise(supabase, id), carregarConfig(supabase, organizacao.id), carregarOpcoes(supabase), nomesEquipe(supabase, usuario.id), enderecoSite()]);
  if (!c) notFound();
  const { analise: a, rendas, documentos, consultas, garantias, fiadores } = c;
  const renda = rendaComprovada(rendas);
  const pct = comprometimentoPct(a.valor_aluguel, a.valor_encargos, renda);
  const sem = semaforoComprometimento(pct, cfg);
  const docs = progressoDocumentos(documentos);
  const ultima = ultimaConsulta(consultas);
  const regras = foraDaRegra(dadosDaRegra(c), cfg);
  const garantiaOk = garantias.find((g) => (GARANTIA_APROVADA as readonly string[]).includes(g.status));
  const fiadorOk = fiadores.find((f) => f.status === "aprovado");
  const decidida = a.decisao !== null;
  const doc = situacaoDocumento(a.candidato?.documento);
  const linkFicha = `${site}/ficha/${a.token}`;
  const convite = mensagemFicha({ nome: a.candidato?.nome ?? "", organizacao: organizacao.nome, link: linkFicha, validade: a.ficha_expira_em, imovel: a.imovel?.codigo });
  const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));
  const fichaDados = a.ficha_dados ?? {};

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <div className="space-y-6">
        <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
          <Indicador
            rotulo="Comprometimento"
            icone={<Gauge />}
            tom={TOM[sem]}
            valor={pct === null ? "—" : <ContadorPct valor={pct} />}
            detalhe={`${ROTULO_SEMAFORO[sem]} · regra: até ${String(cfg.limite_comprometimento_pct).replace(".", ",")}%`}
            href={`/analise/${id}/renda`}
          />
          <Indicador rotulo="Renda comprovada" icone={<Wallet />} valor={<Contador valor={renda} formato="moeda" />} detalhe={a.renda_declarada ? `declarada: ${formatarReais(a.renda_declarada)}` : "nada declarado"} href={`/analise/${id}/renda`} />
          <Indicador
            rotulo="Documentos validados"
            icone={<FileCheck2 />}
            tom={docs.obrigatoriosPendentes ? "alerta" : "sucesso"}
            valor={
              <>
                <Contador valor={docs.validados} />
                <span className="text-[18px] text-mudo">/{docs.total}</span>
              </>
            }
            detalhe={docs.obrigatoriosPendentes ? `${docs.obrigatoriosPendentes} obrigatório(s) faltando` : "obrigatórios em dia"}
            href={`/analise/${id}/documentos`}
          />
          <Indicador
            rotulo="Crédito"
            icone={<BadgeCheck />}
            tom={!ultima ? "neutro" : ultima.restricoes ? "perigo" : "sucesso"}
            valor={ultima?.score !== null && ultima?.score !== undefined ? <Contador valor={ultima.score} /> : "—"}
            detalhe={ultima ? `${ultima.restricoes ? "com restrições" : "sem restrições"} · ${formatarDataBR(ultima.consultado_em)}` : "nenhuma consulta registrada"}
            href={`/analise/${id}/credito`}
          />
        </div>

        <Cartao titulo="Checagem das regras para aprovar">
          {regras.length === 0 ? (
            <Aviso>Tudo dentro da regra. Já dá para decidir na aba Decisão.</Aviso>
          ) : (
            <ul className="space-y-2">
              {regras.map((r) => (
                <li key={r.codigo + r.texto} className="flex items-start gap-2 text-sm text-texto">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-alerta" aria-hidden />
                  {r.texto}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-mudo">
            Aprovar com algo fora da regra é uma exceção: só administrador ou gestor, com justificativa. Regras em{" "}
            <Link href="/analise/regras" className="text-acento hover:underline">
              Análise cadastral › Regras
            </Link>
            .
          </p>
        </Cartao>

        <Formulario acao={atualizarAnalise} automatico>
          <input type="hidden" name="id" value={id} />
          <Cartao titulo="Dados da locação pretendida">
            {decidida && <p className="mb-4 text-xs text-mudo">Análise decidida: imóvel, aluguel e encargos ficam travados. Para mudar, reabra a análise na aba Decisão.</p>}
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo={pessoal ? "Imóvel" : "Imóvel pretendido"}>
                <Selecao name="imovel_id" defaultValue={a.imovel_id ?? ""} disabled={decidida}>
                  <option value="">— não definido —</option>
                  {opcoes.imoveis.map((i) => (
                    <option key={i.id} value={i.id}>
                      {[i.codigo, [i.logradouro, i.numero].filter(Boolean).join(", ")].filter(Boolean).join(" — ")}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Finalidade">
                <Selecao name="finalidade" defaultValue={a.finalidade}>
                  <option value="residencial">Residencial</option>
                  <option value="comercial">Comercial</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Aluguel (R$)">
                <Entrada name="valor_aluguel" inputMode="decimal" defaultValue={v(a.valor_aluguel)} disabled={decidida} />
              </Campo>
              <Campo rotulo="Encargos por mês (R$)" dica="Condomínio, IPTU e outras taxas pagas pelo locatário.">
                <Entrada name="valor_encargos" inputMode="decimal" defaultValue={v(a.valor_encargos)} disabled={decidida} />
              </Campo>
              <Campo rotulo="Renda declarada (R$)">
                <Entrada name="renda_declarada" inputMode="decimal" defaultValue={v(a.renda_declarada)} />
              </Campo>
              <Campo rotulo="Moradores">
                <Entrada name="moradores" type="number" min={0} max={50} defaultValue={v(a.moradores)} />
              </Campo>
              {!pessoal && (
                <Campo rotulo="Corretor">
                  <Selecao name="corretor_id" defaultValue={a.corretor_id ?? ""}>
                    <OpcoesNome opcoes={opcoes.corretores} vazio="— nenhum —" />
                  </Selecao>
                </Campo>
              )}
              <Campo rotulo="Quem vai morar (nomes, idades, animais)" className="sm:col-span-2">
                <AreaTexto name="moradores_obs" rows={2} defaultValue={a.moradores_obs ?? ""} />
              </Campo>
              <Campo rotulo="Observações" className="sm:col-span-2">
                <AreaTexto name="observacoes" rows={3} defaultValue={a.observacoes ?? ""} />
              </Campo>
            </div>
          </Cartao>
        </Formulario>
      </div>

      <div className="space-y-6">
        <Cartao titulo="Candidato">
          {a.candidato ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="text-xs text-mudo">Nome</dt>
                <dd>
                  <Link href={`/pessoas/${a.candidato.id}`} className="font-medium text-texto hover:underline">
                    {a.candidato.nome}
                  </Link>
                  <span className="ml-2 text-xs text-mudo">{a.candidato.tipo_pessoa}</span>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mudo">CPF / CNPJ</dt>
                <dd className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-texto">{a.candidato.documento ? formatarDocumento(a.candidato.documento) : "—"}</span>
                  <Selo cor={doc === "valido" ? "verde" : doc === "invalido" ? "vermelho" : "amarelo"}>{doc === "valido" ? "válido" : doc === "invalido" ? "inválido" : "não informado"}</Selo>
                </dd>
              </div>
              <div>
                <dt className="text-xs text-mudo">Contato</dt>
                <dd className="text-texto-2">{[a.candidato.telefone, a.candidato.email].filter(Boolean).join(" · ") || "—"}</dd>
              </div>
              {(a.candidato.profissao || a.candidato.estado_civil) && (
                <div>
                  <dt className="text-xs text-mudo">Profissão · estado civil</dt>
                  <dd className="text-texto-2">{[a.candidato.profissao, a.candidato.estado_civil].filter(Boolean).join(" · ")}</dd>
                </div>
              )}
              <div className="border-t border-borda-suave pt-3">
                <dt className="text-xs text-mudo">Conferência do documento original</dt>
                <dd className="mt-1">
                  {a.identidade_conferida_em ? (
                    <span className="flex flex-wrap items-center gap-2 text-texto-2">
                      <Selo cor="verde">conferido</Selo> por {nome(a.identidade_conferida_por)} em {quando(a.identidade_conferida_em)}
                      <BotaoAcao acao={desfazerIdentidade} id={`analise:${id}`} tamanho="sm" variante="fantasma" confirmar="Desfazer a conferência do documento?">
                        desfazer
                      </BotaoAcao>
                    </span>
                  ) : (
                    <BotaoAcao acao={conferirIdentidade} id={`analise:${id}`} tamanho="sm" confirmar="Confirma que conferiu o documento original (foto e dados batem com a pessoa)?">
                      <ShieldCheck className="size-3.5" /> Conferi o documento
                    </BotaoAcao>
                  )}
                </dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-mudo">Cadastro do candidato não encontrado.</p>
          )}
        </Cartao>

        <Cartao titulo="Ficha online para o candidato">
          {a.decisao || a.status !== "em_analise" ? (
            <p className="text-sm text-texto-2">A ficha online fica fechada depois da decisão.</p>
          ) : a.ficha_ativa ? (
            <div className="space-y-3 text-sm">
              <p className="text-texto-2">
                O candidato preenche os dados, a renda, autoriza a consulta (LGPD) e envia os documentos por este link
                {a.ficha_expira_em ? ` (vale até ${formatarDataBR(a.ficha_expira_em)})` : ""}.
              </p>
              <div className="break-all rounded-[10px] border border-borda bg-elev px-3 py-2 font-mono text-xs text-texto-2">{linkFicha}</div>
              <div className="flex flex-wrap gap-2">
                <Copiar texto={linkFicha} rotulo="Copiar link" />
                {a.candidato?.telefone && (
                  <a href={linkWhatsapp(a.candidato.telefone, convite)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                    <MessageCircle className="size-3.5" /> Enviar no WhatsApp
                  </a>
                )}
                {a.candidato?.email && (
                  <a href={`mailto:${a.candidato.email}?subject=${encodeURIComponent("Ficha cadastral para locação")}&body=${encodeURIComponent(convite)}`} className={classeBotao("secundario", "sm")}>
                    <Mail className="size-3.5" /> E-mail
                  </a>
                )}
              </div>
              <div className="flex flex-wrap gap-2 border-t border-borda-suave pt-3">
                <BotaoAcao acao={novoLinkFicha} id={id} tamanho="sm" variante="fantasma" confirmar="Gerar um link novo? O link antigo para de funcionar.">
                  Gerar link novo
                </BotaoAcao>
                <BotaoAcao acao={desativarFicha} id={id} tamanho="sm" variante="fantasma" confirmar="Fechar o link da ficha?">
                  Fechar link
                </BotaoAcao>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <p className="text-texto-2">Mande um link para o próprio candidato preencher a ficha, autorizar a consulta e enviar os documentos — sem login.</p>
              <BotaoAcao acao={ativarFicha} id={id} tamanho="sm" variante="primario">
                <Link2 className="size-3.5" /> Abrir link da ficha
              </BotaoAcao>
            </div>
          )}
          {a.ficha_enviada_em && (
            <div className="mt-4 border-t border-borda-suave pt-3 text-sm">
              <div className="mb-1 font-medium text-texto">Ficha recebida em {quando(a.ficha_enviada_em)}</div>
              <dl className="space-y-1 text-xs text-texto-2">
                {[
                  ["Telefone", fichaDados.telefone],
                  ["E-mail", fichaDados.email],
                  ["Profissão", fichaDados.profissao],
                  ["Estado civil", fichaDados.estado_civil],
                  ["Onde trabalha", fichaDados.empregador],
                  ["Observações", fichaDados.observacoes],
                ]
                  .filter(([, x]) => x)
                  .map(([k, x]) => (
                    <div key={k}>
                      <dt className="inline text-mudo">{k}: </dt>
                      <dd className="inline">{x}</dd>
                    </div>
                  ))}
              </dl>
            </div>
          )}
        </Cartao>

        <Cartao titulo="Garantia">
          {garantiaOk ? (
            <p className="text-sm text-texto">
              <Selo cor={COR_STATUS_GARANTIA_PROPOSTA[garantiaOk.status]}>{ROTULO_STATUS_GARANTIA_PROPOSTA[garantiaOk.status]}</Selo>{" "}
              {ROTULO_TIPO_GARANTIA[garantiaOk.tipo] ?? garantiaOk.tipo}
              {garantiaOk.garantidora ? ` · ${garantiaOk.garantidora}` : ""}
            </p>
          ) : fiadorOk ? (
            <p className="text-sm text-texto">
              <Selo cor="verde">Fiador aprovado</Selo> {fiadorOk.pessoa?.nome}
            </p>
          ) : (
            <p className="text-sm text-mudo">{garantias.length ? "Garantia proposta ainda sem aprovação." : "Nenhuma garantia proposta."}</p>
          )}
          <Link href={`/analise/${id}/garantias`} className="mt-2 block text-xs text-acento hover:underline">
            ver garantias
          </Link>
        </Cartao>

        {a.status === "desistencia" ? (
          <Aviso tipo="alerta">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>O candidato desistiu{a.desistencia_motivo ? `: ${a.desistencia_motivo}` : "."}</span>
              <BotaoAcao acao={retomarAnalise} id={id} tamanho="sm">
                Retomar análise
              </BotaoAcao>
            </div>
          </Aviso>
        ) : (
          a.status !== "contratada" &&
          a.status !== "reprovada" && (
            <JanelaCadastro rotuloBotao="O candidato desistiu" variante="fantasma" titulo="Registrar desistência" acao={marcarDesistencia} rotuloSalvar="Registrar">
              <input type="hidden" name="id" value={id} />
              <Campo rotulo="Motivo (opcional)">
                <AreaTexto name="motivo" rows={3} placeholder="Achou outro imóvel, mudou de planos…" />
              </Campo>
            </JanelaCadastro>
          )
        )}
      </div>
    </div>
  );
}
