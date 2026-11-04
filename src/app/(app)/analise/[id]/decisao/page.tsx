import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileSignature, Link2, MessageCircle, RotateCcw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { AreaTexto, Aviso, BotaoLink, Campo, Cartao, Celula, Definicao, Entrada, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import {
  COR_STATUS_GARANTIA_PROPOSTA,
  GARANTIA_APROVADA,
  ROTULO_DECISAO,
  aprovacaoVencida,
  comprometimentoPct,
  contratoSugerido,
  contratosVinculaveis,
  foraDaRegra,
  linkNovoContrato,
  mensagemProprietario,
  papelAprovaExcecao,
  papelDecide,
  podeVirarContrato,
  rendaComprovada,
  type ContratoPossivel,
} from "@/lib/dominio/analise";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_TIPO_GARANTIA } from "@/lib/dominio/garantias";
import { linkWhatsapp } from "@/lib/whatsapp";
import { atualizarAnalise, decidirAnalise, desvincularContrato, reabrirAnalise, vincularContrato, vincularContratoSugerido } from "../../actions";
import { carregarAnalise, carregarConfig, dadosDaRegra, nomesEquipe, quando } from "../../dados";

export const metadata: Metadata = { title: "Decisão da análise" };

type Decisao = {
  id: string;
  decisao: string;
  justificativa: string;
  condicoes: string | null;
  excecao: boolean;
  fora_da_regra: string[];
  excecao_justificativa: string | null;
  comprometimento_pct: number | null;
  usuario_id: string | null;
  papel: string | null;
  data: string;
};

const COR_DECISAO = { aprovado: "verde", aprovado_condicoes: "amarelo", reprovado: "vermelho" } as const;

export default async function DecisaoAnalise({ params }: PageProps<"/analise/[id]/decisao">) {
  const { id } = await params;
  const { supabase, organizacao, usuario, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const [c, cfg, nome, { data: regrasDb }, { data: decs }] = await Promise.all([
    carregarAnalise(supabase, id),
    carregarConfig(supabase, organizacao.id),
    nomesEquipe(supabase, usuario.id),
    supabase.rpc("analise_checar_regras", { p_id: id }),
    supabase.from("analise_decisoes").select("*").eq("analise_id", id).order("data", { ascending: false }),
  ]);
  if (!c) notFound();
  const { analise: a, rendas, garantias, fiadores } = c;
  // O banco é quem decide; se a consulta falhar, mostra a mesma conta feita aqui.
  const regras = regrasDb ? (regrasDb as string[]) : foraDaRegra(dadosDaRegra(c), cfg).map((m) => m.texto);
  const decisoes = (decs ?? []) as Decisao[];
  const decide = papelDecide(papel);
  const excecao = papelAprovaExcecao(papel);
  const aprovada = a.decisao === "aprovado" || a.decisao === "aprovado_condicoes";
  const renda = rendaComprovada(rendas);
  const pct = comprometimentoPct(a.valor_aluguel, a.valor_encargos, renda);
  // Fiança conta pelo fiador aprovado (igual à regra do banco), não pela garantia marcada.
  const garantiaOk = garantias.find((g) => g.tipo !== "fiador" && (GARANTIA_APROVADA as readonly string[]).includes(g.status));
  const fiadorOk = fiadores.find((f) => f.status === "aprovado");
  const textoGarantia = garantiaOk ? `${ROTULO_TIPO_GARANTIA[garantiaOk.tipo]}${garantiaOk.garantidora ? ` (${garantiaOk.garantidora})` : ""}` : fiadorOk ? `fiador ${fiadorOk.pessoa?.nome ?? ""}` : null;

  // Contratos que podem receber esta análise (mesma conferência do banco): o candidato é
  // locatário, é do imóvel da análise e está ativo ou em rascunho.
  type ContratoLinha = { id: string; numero: number; status: string; data_inicio: string; imovel_id: string | null; created_at: string };
  const COLS = "id, numero, status, data_inicio, imovel_id, created_at";
  const { data: partes } = await supabase
    .from("contrato_partes")
    .select(`contrato:contratos(${COLS})`)
    .eq("pessoa_id", a.candidato_id)
    .eq("papel", "locatario")
    .limit(50);
  const doCandidato = ((partes ?? []) as unknown as { contrato: ContratoLinha | null }[]).map((p) => p.contrato).filter(Boolean) as ContratoLinha[];
  const candidatos = contratosVinculaveis(
    doCandidato.map((k) => ({ ...k, candidatoLocatario: true }) as ContratoLinha & ContratoPossivel),
    a,
  );
  const hoje = hojeISO();
  // Aprovada, sem contrato, sem desistência e no prazo (o banco confere de novo).
  const podeContratar = podeVirarContrato(a, hoje);
  // O contrato criado depois da aprovação, com o candidato como locatário: um clique para vincular.
  const sugerido = podeContratar ? contratoSugerido(candidatos, a) : null;

  // Proprietários (imobiliária): mensagem de ciência
  const { data: props } =
    !pessoal && a.imovel_id
      ? await supabase.from("imovel_proprietarios").select("pessoa:pessoas(id, nome, telefone)").eq("imovel_id", a.imovel_id)
      : { data: [] };
  const proprietarios = ((props ?? []) as unknown as { pessoa: { id: string; nome: string; telefone: string | null } | null }[]).map((p) => p.pessoa).filter(Boolean) as {
    id: string;
    nome: string;
    telefone: string | null;
  }[];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_400px]">
      <div className="space-y-6">
        {!a.decisao ? (
          <>
            <Cartao titulo="Regras para aprovar (o sistema confere de novo ao gravar)">
              {regras.length === 0 ? (
                <Aviso>Tudo dentro da regra: renda, crédito, documentos e garantia.</Aviso>
              ) : (
                <>
                  <ul className="space-y-2">
                    {regras.map((r) => (
                      <li key={r} className="flex items-start gap-2 text-sm text-texto">
                        <span className="mt-1 size-2 shrink-0 rounded-full bg-alerta" aria-hidden />
                        {r}
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-xs text-mudo">
                    Para aprovar assim é preciso registrar uma <b>exceção</b>: só administrador ou gestor, com justificativa. Reprovar não precisa de exceção.
                  </p>
                </>
              )}
            </Cartao>

            <Cartao titulo="Registrar decisão">
              {!decide ? (
                <Aviso tipo="alerta">Seu usuário não decide análises cadastrais. Peça a um administrador, gestor ou ao financeiro.</Aviso>
              ) : (
                <Formulario acao={decidirAnalise} className="space-y-4">
                  <input type="hidden" name="id" value={id} />
                  {regras.length > 0 && !excecao && (
                    <Aviso tipo="alerta">Há itens fora da regra: você pode reprovar ou pedir a um administrador/gestor para aprovar como exceção.</Aviso>
                  )}
                  <Campo rotulo="Decisão">
                    <Selecao name="decisao" required defaultValue="">
                      <option value="" disabled>
                        Escolha…
                      </option>
                      {Object.entries(ROTULO_DECISAO).map(([k, r]) => (
                        <option key={k} value={k}>
                          {r}
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                  <Campo rotulo="Justificativa (obrigatória)" dica="Fica registrada na auditoria e não pode ser apagada.">
                    <AreaTexto name="justificativa" required rows={4} minLength={10} placeholder="Renda comprovada de 4x o aluguel, sem restrições, seguro-fiança aprovado…" />
                  </Campo>
                  <Campo rotulo="Condições (se aprovar com condições)">
                    <AreaTexto name="condicoes" rows={2} placeholder="Ex.: caução de 3 aluguéis, fiador adicional, seguro pago à vista…" />
                  </Campo>
                  {regras.length > 0 && excecao && (
                    <Campo rotulo="Justificativa da exceção (para aprovar fora da regra)">
                      <AreaTexto name="excecao_justificativa" rows={3} placeholder="Por que vale aprovar mesmo fora da regra?" />
                    </Campo>
                  )}
                  <div className="flex justify-end">
                    <BotaoEnviar confirmar="Registrar a decisão? Ela fica na auditoria e só um administrador ou gestor pode reabrir.">Registrar decisão</BotaoEnviar>
                  </div>
                </Formulario>
              )}
            </Cartao>
          </>
        ) : (
          <Cartao
            titulo="Decisão"
            acoes={
              excecao && !a.contrato_id ? (
                <JanelaCadastro rotuloBotao={<><RotateCcw className="size-3.5" /> Reabrir</>} tamanho="sm" variante="secundario" titulo="Reabrir a análise" acao={reabrirAnalise} rotuloSalvar="Reabrir" icone={<RotateCcw />}>
                  <input type="hidden" name="id" value={id} />
                  <p className="text-sm text-texto-2">A decisão atual continua no histórico e na auditoria. A análise volta para “Em análise”.</p>
                  <Campo rotulo="Motivo">
                    <AreaTexto name="motivo" required rows={3} />
                  </Campo>
                </JanelaCadastro>
              ) : undefined
            }
          >
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <Selo cor={COR_DECISAO[a.decisao as keyof typeof COR_DECISAO] ?? "cinza"}>{ROTULO_DECISAO[a.decisao]}</Selo>
              {a.excecao && <Selo cor="amarelo">Exceção (fora da regra)</Selo>}
              {aprovacaoVencida(a, hoje) && <Selo cor="vermelho">Aprovação vencida</Selo>}
            </div>
            <Definicao
              itens={[
                ["Decidido por", `${nome(a.decidido_por)} em ${quando(a.decidido_em)}`],
                ["Comprometimento", pct === null ? "sem renda comprovada" : `${String(pct).replace(".", ",")}% da renda`],
                ["Aprovação vale até", a.validade_ate ? formatarDataBR(a.validade_ate) : "—"],
              ]}
            />
            <div className="mt-4 space-y-3 text-sm">
              <div>
                <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Justificativa</div>
                <p className="mt-1 whitespace-pre-line text-texto">{a.decisao_justificativa}</p>
              </div>
              {a.decisao_condicoes && (
                <div>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Condições</div>
                  <p className="mt-1 whitespace-pre-line text-texto">{a.decisao_condicoes}</p>
                </div>
              )}
              {a.fora_da_regra.length > 0 && (
                <div>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Fora da regra no momento da decisão</div>
                  <ul className="mt-1 list-disc pl-5 text-texto-2">
                    {a.fora_da_regra.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
              {a.excecao_justificativa && (
                <div>
                  <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Por que a exceção</div>
                  <p className="mt-1 whitespace-pre-line text-texto">{a.excecao_justificativa}</p>
                </div>
              )}
            </div>
          </Cartao>
        )}

        <div>
          <h3 className="mb-3 text-[15px] font-semibold text-texto">Histórico de decisões</h3>
          <Tabela colunas={["Quando", "Decisão", "Justificativa", "Comprometimento", "Quem"]}>
            {decisoes.map((d) => (
              <tr key={d.id} className="align-top">
                <Celula>{quando(d.data)}</Celula>
                <Celula>
                  <Selo cor={COR_DECISAO[d.decisao as keyof typeof COR_DECISAO] ?? "cinza"}>{ROTULO_DECISAO[d.decisao] ?? d.decisao}</Selo>
                  {d.excecao && <span className="mt-1 block text-xs text-alerta">exceção</span>}
                </Celula>
                <Celula>
                  <span className="text-sm text-texto">{d.justificativa}</span>
                  {d.excecao_justificativa && <span className="mt-1 block text-xs text-texto-2">Exceção: {d.excecao_justificativa}</span>}
                  {d.fora_da_regra.length > 0 && <span className="mt-1 block text-xs text-mudo">{d.fora_da_regra.join(" · ")}</span>}
                </Celula>
                <Celula className="tabular-nums">{d.comprometimento_pct === null ? "—" : `${String(d.comprometimento_pct).replace(".", ",")}%`}</Celula>
                <Celula>
                  <span className="text-xs text-texto-2">
                    {nome(d.usuario_id)}
                    {d.papel ? ` (${d.papel})` : ""}
                  </span>
                </Celula>
              </tr>
            ))}
            {decisoes.length === 0 && <LinhaVazia colunas={5}>Nenhuma decisão ainda.</LinhaVazia>}
          </Tabela>
        </div>
      </div>

      <div className="space-y-6">
        <Cartao titulo="Contrato">
          {a.contrato ? (
            <div className="space-y-3 text-sm">
              <p className="text-texto">
                Virou o contrato{" "}
                <Link href={`/contratos/${a.contrato.id}`} className="font-medium text-acento hover:underline">
                  #{a.contrato.numero}
                </Link>
                . As garantias aprovadas e os fiadores foram levados para a ficha do contrato.
              </p>
              {excecao && (
                <BotaoAcao
                  acao={desvincularContrato}
                  id={id}
                  tamanho="sm"
                  variante="fantasma"
                  confirmar="Desvincular o contrato desta análise? As garantias levadas ficam encerradas nesse contrato (com aviso) e voltam a “Aprovada” aqui, para irem ao contrato certo. Os fiadores continuam como partes dele: confira o contrato."
                >
                  Desvincular
                </BotaoAcao>
              )}
            </div>
          ) : aprovada && !podeContratar ? (
            <Aviso tipo="alerta">
              {a.status === "desistencia"
                ? "O candidato desistiu. Para seguir com o contrato, retome a análise."
                : `A aprovação venceu${a.validade_ate ? ` em ${formatarDataBR(a.validade_ate)}` : ""}. Para criar o contrato, um administrador ou gestor reabre a análise e decide de novo (com a consulta de crédito em dia).`}
            </Aviso>
          ) : aprovada ? (
            <div className="space-y-3 text-sm">
              {sugerido ? (
                <Aviso>
                  <div className="space-y-2">
                    <p>
                      Achamos o contrato <b>#{sugerido.numero}</b> ({sugerido.status}) com {a.candidato?.nome ?? "o candidato"} como locatário
                      {a.imovel ? ` no imóvel ${a.imovel.codigo}` : ""}. Vincule para levar as garantias aprovadas e os fiadores.
                    </p>
                    <BotaoAcao acao={vincularContratoSugerido} id={`${id}|${sugerido.id}`} tamanho="sm" variante="primario" confirmar={`Vincular o contrato #${sugerido.numero} a esta análise e levar as garantias aprovadas e os fiadores?`}>
                      <Link2 className="size-3.5" /> Vincular contrato #{sugerido.numero}
                    </BotaoAcao>
                  </div>
                </Aviso>
              ) : (
                <>
                  <p className="text-texto-2">Candidato aprovado. Crie o contrato e depois volte aqui para vincular — é o vínculo que leva as garantias e os fiadores.</p>
                  <Aviso tipo="alerta">
                    {a.imovel ? `Na tela do contrato, o imóvel ${a.imovel.codigo} já vem escolhido. ` : "Na tela do contrato, escolha o imóvel. "}
                    Escolha o locatário <b>{a.candidato?.nome ?? "candidato"}</b> e confira o aluguel: {formatarReais(Number(a.valor_aluguel))}. Depois de criar, volte a
                    esta aba e clique em <b>Vincular</b>.
                  </Aviso>
                </>
              )}
              <BotaoLink href={linkNovoContrato(a)} variante={sugerido ? "secundario" : "primario"}>
                <FileSignature className="size-4" /> Criar contrato
              </BotaoLink>
              <JanelaCadastro rotuloBotao={<><Link2 className="size-3.5" /> Vincular contrato já criado</>} tamanho="sm" variante="secundario" titulo="Vincular contrato" acao={vincularContrato} rotuloSalvar="Vincular" icone={<Link2 />}>
                <input type="hidden" name="id" value={id} />
                {candidatos.length ? (
                  <Campo rotulo="Contrato">
                    <Selecao name="contrato_id" required defaultValue="">
                      <option value="" disabled>
                        Escolha…
                      </option>
                      {candidatos.map((k) => (
                        <option key={k.id} value={k.id}>
                          #{k.numero} — início {formatarDataBR(k.data_inicio)} ({k.status})
                        </option>
                      ))}
                    </Selecao>
                  </Campo>
                ) : (
                  <p className="text-sm text-mudo">
                    Nenhum contrato ativo ou em rascunho {a.imovel ? `do imóvel ${a.imovel.codigo} ` : ""}com {a.candidato?.nome ?? "o candidato"} como locatário. Crie o contrato
                    (botão acima) ou inclua o candidato como locatário no contrato.
                  </p>
                )}
                <p className="text-xs text-mudo">As garantias aprovadas (seguro, caução, título, carta-fiança) e os fiadores aprovados entram na ficha do contrato.</p>
              </JanelaCadastro>
            </div>
          ) : (
            <p className="text-sm text-mudo">Depois da aprovação, o candidato pode virar contrato.</p>
          )}
        </Cartao>

        {!pessoal && a.decisao && (
          <Cartao titulo="Ciência do proprietário">
            <Formulario acao={atualizarAnalise} automatico>
              <input type="hidden" name="id" value={id} />
              <Campo rotulo="Proprietário de acordo em">
                <Entrada type="date" name="proprietario_ciente_em" defaultValue={a.proprietario_ciente_em ?? ""} />
              </Campo>
            </Formulario>
            <ul className="mt-3 space-y-2">
              {proprietarios.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span className="text-texto">{p.nome}</span>
                  {p.telefone ? (
                    <a
                      href={linkWhatsapp(
                        p.telefone,
                        mensagemProprietario({
                          proprietario: p.nome,
                          candidato: a.candidato?.nome ?? "",
                          imovel: a.imovel?.codigo,
                          aluguel: Number(a.valor_aluguel),
                          encargos: Number(a.valor_encargos),
                          comprometimento: pct,
                          garantia: textoGarantia,
                          decisao: a.decisao,
                          condicoes: a.decisao_condicoes,
                          organizacao: organizacao.nome,
                        }),
                      )}
                      target="_blank"
                      rel="noreferrer"
                      className={classeBotao("secundario", "sm")}
                    >
                      <MessageCircle className="size-3.5" /> Avisar
                    </a>
                  ) : (
                    <span className="text-xs text-mudo">sem telefone</span>
                  )}
                </li>
              ))}
              {proprietarios.length === 0 && <li className="text-xs text-mudo">Imóvel sem proprietário cadastrado.</li>}
            </ul>
          </Cartao>
        )}

        <Cartao titulo="Resumo">
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-mudo">Aluguel + encargos</dt>
              <dd className="tabular-nums text-texto">{formatarReais(Number(a.valor_aluguel) + Number(a.valor_encargos))}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-mudo">Renda comprovada</dt>
              <dd className="tabular-nums text-texto">{formatarReais(renda)}</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-mudo">Garantia</dt>
              <dd className="text-right text-texto">
                {garantiaOk ? <Selo cor={COR_STATUS_GARANTIA_PROPOSTA[garantiaOk.status]}>{textoGarantia}</Selo> : (textoGarantia ?? "nenhuma aprovada")}
              </dd>
            </div>
          </dl>
        </Cartao>
      </div>
    </div>
  );
}
