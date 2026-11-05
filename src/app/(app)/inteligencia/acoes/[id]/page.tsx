import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RotateCw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { Aviso, BotaoLink, Cabecalho, Cartao, Definicao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import {
  ACAO_AUTOMATICA,
  COR_STATUS_ACAO,
  ROTULO_ORIGEM_ACAO,
  ROTULO_STATUS_ACAO,
  ROTULO_TIPO_ACAO,
  alvoDaAcao,
  confirmacaoAcao,
  detalhesAcao,
  permissaoAcao,
  podeDecidirAcao,
  referenciaDoPayload,
  type StatusAcaoIA,
  type TipoAcaoIA,
} from "@/lib/dominio/ia";
import { linkEmail, linkSms } from "@/lib/dominio/marketing";
import { pode } from "@/lib/permissoes";
import { linkWhatsapp } from "@/lib/whatsapp";
import { AbasInteligencia } from "../../abas";
import { cancelarAcao, executarAprovada, marcarAcaoFeita } from "../../actions";
import { carregarConfigIA, linkReferencia, nomesUsuarios, quando } from "../../dados";
import { Decidir, EnviarMensagem } from "../decidir";
import { carregarRegistrosAlvo } from "../registros";

export const metadata: Metadata = { title: "Ação para aprovar" };

type Acao = {
  id: string;
  numero: number;
  tipo: TipoAcaoIA;
  origem: string;
  titulo: string;
  descricao: string | null;
  valor: number | null;
  payload: Record<string, unknown>;
  referencia_tipo: string | null;
  referencia_id: string | null;
  status: StatusAcaoIA;
  aprovacao_automatica: boolean;
  criada_por: string | null;
  decidida_por: string | null;
  decidida_em: string | null;
  motivo: string | null;
  executada_por: string | null;
  executada_em: string | null;
  resultado: string | null;
  erro: string | null;
  created_at: string;
};

/** Ficha de uma ação sugerida: o que será feito, quem pediu, e aprovar/recusar ou concluir. */
export default async function AcaoPage({ params }: PageProps<"/inteligencia/acoes/[id]">) {
  const { id } = await params;
  const { supabase, organizacao, papel, usuario } = await obterContexto();
  const { data } = await supabase.from("ia_acoes").select("*").eq("id", id).maybeSingle();
  if (!data) notFound();
  const a = data as Acao;
  const imob = organizacao.modo !== "pessoal";
  const p = a.payload;
  // A mensagem ao cliente pede o módulo do registro (cobrança, contrato, chamado…): mesma regra do banco.
  const [modulo, operacao] = permissaoAcao(a.tipo, imob, a.referencia_tipo);
  const [cfg, nomes, temModulo, temAprovar, registros] = await Promise.all([
    carregarConfigIA(supabase),
    nomesUsuarios(supabase),
    pode(modulo, operacao),
    pode(modulo, "aprovar"),
    carregarRegistrosAlvo(supabase, a.tipo, p),
  ]);
  const decide = podeDecidirAcao({ papel, temPermissaoModulo: temModulo, temAprovarModulo: temAprovar, exigirAprovacao: cfg.exigir_aprovacao, souQuemPediu: a.criada_por === usuario.id });
  // O que aparece (registro, link, confirmação) sai do payload que será executado, nunca do título.
  const alvo = alvoDaAcao(a.tipo, p, registros);
  const refPayload = a.tipo === "mensagem_cliente" ? null : referenciaDoPayload(a.tipo, p);
  const ref = refPayload ? linkReferencia(refPayload[0], refPayload[1]) : linkReferencia(a.referencia_tipo, a.referencia_id);
  const nome = (u: string | null) => (u ? (nomes.get(u) ?? "Usuário") : "—");
  const destino = String(p.destino ?? "");
  const texto = String(p.texto ?? "");
  const linkMensagem =
    a.tipo === "mensagem_cliente" && destino
      ? p.canal === "email"
        ? linkEmail(destino, `Contato — ${organizacao.nome}`, texto)
        : p.canal === "sms"
          ? linkSms(destino, texto)
          : linkWhatsapp(destino, texto)
      : null;
  const confirmacao = confirmacaoAcao(a.tipo, a.titulo, a.valor, alvo);
  const { data: fat } =
    a.tipo === "renegociar_cobranca" && typeof p.fatura_id === "string" ? await supabase.from("faturas").select("contrato_id").eq("id", p.fatura_id).maybeSingle() : { data: null };
  const contratoDaFatura = (fat?.contrato_id as string | undefined) ?? null;

  return (
    <>
      <Cabecalho
        titulo={a.titulo}
        trilha="Ações para aprovar"
        descricao={
          <span className="flex flex-wrap items-center gap-2">
            <Selo cor={COR_STATUS_ACAO[a.status]}>{a.aprovacao_automatica && a.status === "aprovada" ? "Pré-aprovada (regra do administrador)" : ROTULO_STATUS_ACAO[a.status]}</Selo>
            <span>
              {ROTULO_TIPO_ACAO[a.tipo]} · nº {a.numero} · {ROTULO_ORIGEM_ACAO[a.origem] ?? a.origem}
            </span>
          </span>
        }
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <Cartao titulo="O que será feito">
          {a.descricao && <p className="mb-4 whitespace-pre-line text-sm text-texto-2">{a.descricao}</p>}
          <Definicao itens={[...alvo.itens, ...detalhesAcao(a.tipo, p)].map(([k, v]) => [k, <span key={k} className="whitespace-pre-line">{v}</span>])} />
          {alvo.faltando.length > 0 && (
            <div className="mt-4">
              <Aviso tipo="alerta">Não encontrei {alvo.faltando.join(", ")} desta ação (apagado ou sem acesso). Confira no módulo antes de decidir.</Aviso>
            </div>
          )}
          {a.valor !== null && <p className="mt-4 text-sm text-texto">Valor envolvido: <strong>{formatarReais(a.valor)}</strong></p>}
          {ref && (
            <p className="mt-4 text-sm">
              <Link href={ref} className="text-acento hover:underline">
                Abrir o registro relacionado
              </Link>
            </p>
          )}
        </Cartao>

        {a.status === "pendente" && (
          <Cartao titulo="Decisão">
            {decide ? (
              <>
                <p className="mb-3 text-sm text-texto-2">
                  {ACAO_AUTOMATICA[a.tipo]
                    ? "Ao aprovar, a ação é feita na hora pela via normal do sistema (com as mesmas regras e permissões da tela do módulo)."
                    : "Ao aprovar, a ação fica pronta para alguém fazer pelo botão (abrir o WhatsApp com o texto / montar o acordo) e marcar como feita."}
                </p>
                <Decidir id={a.id} confirmacao={confirmacao} />
              </>
            ) : (
              <Aviso>
                {a.criada_por === usuario.id && cfg.exigir_aprovacao
                  ? "Você pediu esta ação: outra pessoa com permissão (administrador, gestor ou quem aprova no módulo) precisa decidir."
                  : "Você não tem permissão para decidir esta ação."}
              </Aviso>
            )}
            {(a.criada_por === usuario.id || papel === "admin" || papel === "gestor") && (
              <div className="mt-3">
                <BotaoAcao acao={cancelarAcao} id={a.id} variante="fantasma" tamanho="sm" confirmar="Cancelar esta sugestão?">
                  Cancelar sugestão
                </BotaoAcao>
              </div>
            )}
          </Cartao>
        )}

        {a.status === "executando" && (
          <Cartao titulo="Sendo feita agora">
            <p className="text-sm text-texto-2">
              {nome(a.executada_por)} começou a fazer esta ação em {quando(a.executada_em)}. Enquanto isso, ninguém mais consegue rodá-la (evita fazer duas vezes).
            </p>
            {temModulo && ACAO_AUTOMATICA[a.tipo] && a.executada_em && agoraMs() - new Date(a.executada_em).getTime() > 10 * 60_000 && (
              <div className="mt-3 space-y-3">
                <Aviso tipo="alerta">Parou no meio há mais de 10 minutos. Confira no módulo se a ação foi feita antes de tentar de novo.</Aviso>
                <BotaoAcao acao={executarAprovada} id={a.id} variante="primario" confirmar={`Tentar de novo?\n\n${confirmacao}`}>
                  <RotateCw className="size-4" /> Tentar de novo
                </BotaoAcao>
              </div>
            )}
          </Cartao>
        )}

        {(a.status === "aprovada" || a.status === "erro") && temModulo && (
          <Cartao titulo="Fazer">
            {a.erro && <div className="mb-3"><Aviso tipo="erro">Último erro: {a.erro}</Aviso></div>}
            {a.resultado && <p className="mb-3 text-sm text-texto-2">{a.resultado}</p>}
            <div className="flex flex-wrap gap-2">
              {a.tipo === "mensagem_cliente" && <EnviarMensagem id={a.id} link={linkMensagem} rotulo={p.canal === "email" ? "Abrir e-mail e marcar como enviada" : p.canal === "sms" ? "Abrir SMS e marcar como enviada" : "Abrir WhatsApp e marcar como enviada"} />}
              {a.tipo === "renegociar_cobranca" && (
                <>
                  <BotaoLink href={contratoDaFatura ? `/cobrancas/acordos/novo?contrato=${contratoDaFatura}` : "/cobrancas/acordos/novo"} variante="secundario">
                    Montar o acordo
                  </BotaoLink>
                  <BotaoAcao acao={marcarAcaoFeita} id={a.id} variante="primario" confirmar="O acordo já foi montado em Cobranças?">
                    Marcar como feita
                  </BotaoAcao>
                </>
              )}
              {ACAO_AUTOMATICA[a.tipo] && (
                <BotaoAcao acao={executarAprovada} id={a.id} variante="primario" confirmar={`Fazer agora?\n\n${confirmacao}`}>
                  <RotateCw className="size-4" /> {a.status === "erro" ? "Tentar de novo" : "Fazer agora"}
                </BotaoAcao>
              )}
            </div>
          </Cartao>
        )}

        <Cartao titulo="Histórico desta ação">
          <Definicao
            itens={[
              ["Sugerida em", quando(a.created_at)],
              ["Pedida por", a.criada_por ? nome(a.criada_por) : ROTULO_ORIGEM_ACAO[a.origem]],
              ["Decidida por", a.aprovacao_automatica ? "Regra do administrador (texto fixo)" : nome(a.decidida_por)],
              ["Decidida em", quando(a.decidida_em)],
              ["Motivo", a.motivo ?? "—"],
              ["Feita por", nome(a.executada_por)],
              ["Feita em", quando(a.executada_em)],
              ["Resultado", a.resultado ?? a.erro ?? "—"],
            ]}
          />
        </Cartao>
      </div>
    </>
  );
}
