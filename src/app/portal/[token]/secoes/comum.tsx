import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Campo, Cartao, Entrada, Selecao, Selo, classeBotao } from "@/components/ui";
import { diaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import {
  COR_STATUS_SOLICITACAO,
  ROTULO_STATUS_SOLICITACAO,
  ROTULO_TIPO_SOLICITACAO,
  tiposDoPerfil,
  type PerfilPortal,
  type StatusSolicitacao,
  type TipoSolicitacao,
} from "@/lib/dominio/portal";
import { solicitarPortal } from "../actions";
import { dadosPortal, ehErroPortal, type ErroPortal } from "../sessao";

/** Sessão expirada (12 horas) ou link trocado no meio do caminho. */
export function AvisoSessao({ erro, token }: { erro: ErroPortal["erro"]; token: string }) {
  return (
    <div className="rounded-card border border-borda bg-card p-6 text-center text-texto-2">
      {erro === "sessao" ? (
        <>
          Sua sessão terminou. Por segurança, confirme seus dados de novo.{" "}
          <Link href={`/portal/${token}`} className="font-medium text-acento hover:underline">
            Entrar de novo
          </Link>
        </>
      ) : (
        "Este link não está mais ativo. Peça um novo link a quem enviou."
      )}
    </div>
  );
}

export function NaoEncontrado({ texto = "Não encontrado." }: { texto?: string }) {
  return <div className="rounded-card border border-borda bg-card p-6 text-center text-texto-2">{texto}</div>;
}

type Solicitacao = { numero: number; tipo: TipoSolicitacao; mensagem: string; status: StatusSolicitacao; resposta: string | null; criado_em: string; data_desejada: string | null; tratado_em: string | null };

/** "Fale com a gente": renovação, desocupação (locatário) ou contato, e a lista dos pedidos. */
export async function Fale({ token, perfil, contratos = [] }: { token: string; perfil: PerfilPortal; contratos?: { id: string; rotulo: string }[] }) {
  const lista = await dadosPortal<Solicitacao[]>(token, "solicitacoes");
  if (ehErroPortal(lista)) return <AvisoSessao erro={lista.erro} token={token} />;
  const tipos = tiposDoPerfil(perfil);
  const hoje = hojeISO();
  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_1fr]">
      <Cartao titulo={perfil === "locatario" ? "Renovação, saída ou contato" : "Fale com a gente"}>
        {perfil === "locatario" && (
          <div className="mb-4">
            <Aviso>
              Pedir a <b>desocupação</b> por aqui avisa a equipe, que entra em contato para combinar a vistoria e a entrega das chaves (o aviso não encerra o contrato
              sozinho). Confira no contrato o prazo de aviso e a multa por saída antecipada.
            </Aviso>
          </div>
        )}
        <Formulario acao={solicitarPortal} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          {tipos.length > 1 ? (
            <Campo rotulo="O que você precisa?">
              <Selecao name="tipo" defaultValue={tipos[0]}>
                {tipos.map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TIPO_SOLICITACAO[t]}
                  </option>
                ))}
              </Selecao>
            </Campo>
          ) : (
            <input type="hidden" name="tipo" value="contato" />
          )}
          {perfil === "locatario" && contratos.length > 0 && (
            <Campo rotulo="Contrato">
              <Selecao name="contrato_id" defaultValue={contratos[0].id}>
                {contratos.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.rotulo}
                  </option>
                ))}
              </Selecao>
            </Campo>
          )}
          {perfil === "locatario" && (
            <Campo rotulo="Data desejada (opcional)" dica="Para a desocupação: quando pretende entregar o imóvel.">
              <Entrada type="date" name="data_desejada" min={hoje} />
            </Campo>
          )}
          <Campo rotulo="Mensagem">
            <AreaTexto name="mensagem" rows={4} maxLength={2000} placeholder="Conte o que precisa…" />
          </Campo>
          <BotaoEnviar>Enviar pedido</BotaoEnviar>
        </Formulario>
      </Cartao>
      <Cartao titulo="Seus pedidos">
        {lista && lista.length > 0 ? (
          <ul className="divide-y divide-borda-suave">
            {lista.map((s) => (
              <li key={s.numero} className="py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium text-texto">
                    #{s.numero} · {ROTULO_TIPO_SOLICITACAO[s.tipo] ?? s.tipo}
                  </span>
                  <Selo cor={COR_STATUS_SOLICITACAO[s.status] ?? "cinza"}>{ROTULO_STATUS_SOLICITACAO[s.status] ?? s.status}</Selo>
                </div>
                <p className="mt-1 whitespace-pre-line text-sm text-texto-2">{s.mensagem}</p>
                <p className="mt-1 text-xs text-mudo">
                  enviado em {formatarDataBR(diaLocal(s.criado_em))}
                  {s.data_desejada ? ` · data desejada ${formatarDataBR(s.data_desejada)}` : ""}
                </p>
                {s.resposta && <p className="mt-2 rounded-[12px] border border-borda bg-elev px-3 py-2 text-sm text-texto">Resposta: {s.resposta}</p>}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-mudo">Nenhum pedido ainda.</p>
        )}
      </Cartao>
    </div>
  );
}

type Arquivo = { id: string; titulo: string; url: string; expira_em: string; criado_em: string };

/** Arquivos (PDF/fotos) que a equipe compartilhou com link de validade. */
export async function Arquivos({ token }: { token: string }) {
  const lista = await dadosPortal<Arquivo[]>(token, "arquivos");
  if (ehErroPortal(lista)) return <AvisoSessao erro={lista.erro} token={token} />;
  return (
    <Cartao titulo="Arquivos compartilhados">
      <p className="mb-4 text-sm text-texto-2">
        Contratos, recibos, extratos e informes aparecem nas outras seções e podem ser impressos ou salvos em PDF. Aqui ficam os arquivos que a equipe
        compartilhou com você (cada um com prazo para baixar). Precisa de outro? Peça em “Fale com a gente”.
      </p>
      {lista && lista.length > 0 ? (
        <ul className="divide-y divide-borda-suave">
          {lista.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <div>
                <div className="font-medium text-texto">{a.titulo}</div>
                <div className="text-xs text-mudo">disponível até {formatarDataBR(diaLocal(a.expira_em))}</div>
              </div>
              <a href={a.url} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                <ExternalLink className="size-3.5" /> Abrir
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-mudo">Nenhum arquivo compartilhado no momento.</p>
      )}
    </Cartao>
  );
}
