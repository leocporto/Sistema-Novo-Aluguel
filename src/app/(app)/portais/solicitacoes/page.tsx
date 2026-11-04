import type { Metadata } from "next";
import Link from "next/link";
import { ListTodo, NotebookPen } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Aviso, Cabecalho, Cartao, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR } from "@/lib/dominio/datas";
import {
  COR_STATUS_SOLICITACAO,
  ROTULO_PERFIL,
  ROTULO_STATUS_SOLICITACAO,
  ROTULO_TIPO_SOLICITACAO,
  STATUS_SOLICITACAO,
  type PerfilPortal,
  type StatusSolicitacao,
  type TipoSolicitacao,
} from "@/lib/dominio/portal";
import { AbasPortais } from "../abas";
import { criarTarefaDoPedido, excluirSolicitacao, registrarPedidoNaPessoa, tratarSolicitacao } from "../actions";

export const metadata: Metadata = { title: "Pedidos do portal" };

type Pedido = {
  id: string;
  numero: number;
  perfil: PerfilPortal;
  tipo: TipoSolicitacao;
  mensagem: string;
  data_desejada: string | null;
  status: StatusSolicitacao;
  resposta: string | null;
  tratado_em: string | null;
  tarefa_id: string | null;
  interacao_id: string | null;
  acesso_id: string | null;
  created_at: string;
  pessoa: { id: string; nome: string; telefone: string | null } | null;
  contrato: { id: string; numero: number; imovel: { codigo: string } | null } | null;
};

/**
 * Pedidos que chegaram pelo portal (renovação, desocupação, contato): a equipe
 * responde (a resposta aparece no portal), cria tarefa ou registra na pessoa.
 * A desocupação NÃO é aberta sozinha: quem decide e registra é a equipe, no contrato.
 */
export default async function SolicitacoesPage({ searchParams }: PageProps<"/portais/solicitacoes">) {
  const sp = await searchParams;
  const { supabase, organizacao, papel } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const filtro = typeof sp.status === "string" && (STATUS_SOLICITACAO as readonly string[]).includes(sp.status) ? sp.status : "abertos";

  if (papel === "corretor")
    return (
      <>
        <Cabecalho titulo="Pedidos do portal" trilha="Portal de clientes" />
        <Aviso>Só administradores, gestores e o financeiro tratam os pedidos do portal.</Aviso>
      </>
    );

  let q = supabase
    .from("portal_solicitacoes")
    .select("id, numero, perfil, tipo, mensagem, data_desejada, status, resposta, tratado_em, tarefa_id, interacao_id, acesso_id, created_at, pessoa:pessoas(id, nome, telefone), contrato:contratos(id, numero, imovel:imoveis(codigo))")
    .order("created_at", { ascending: false })
    .limit(300);
  q = filtro === "abertos" ? q.in("status", ["nova", "em_andamento"]) : q.eq("status", filtro);
  const { data } = await q;
  const pedidos = ((data ?? []) as unknown as Pedido[]).filter((p) => !(pessoal && p.perfil === "proprietario"));

  return (
    <>
      <Cabecalho
        titulo="Pedidos do portal"
        trilha="Portal de clientes"
        descricao="Renovação, desocupação e contatos enviados pelo portal. Responda (a resposta aparece para a pessoa no portal), crie uma tarefa ou registre na ficha da pessoa."
      />
      <AbasPortais modo={organizacao.modo} />
      <div className="mb-4">
        <PilulasLink
          rotulo="Situação"
          ativo={filtro === "abertos" ? "/portais/solicitacoes" : `/portais/solicitacoes?status=${filtro}`}
          itens={[
            { href: "/portais/solicitacoes", rotulo: "Em aberto" },
            ...STATUS_SOLICITACAO.filter((s) => s !== "nova" && s !== "em_andamento").map((s) => ({ href: `/portais/solicitacoes?status=${s}`, rotulo: ROTULO_STATUS_SOLICITACAO[s] })),
          ]}
        />
      </div>
      {pedidos.length === 0 && <div className="rounded-card border border-borda bg-card p-8 text-center text-sm text-mudo">Nenhum pedido nesta situação.</div>}
      <div className="entrar-cascata grid gap-4 lg:grid-cols-2">
        {pedidos.map((p) => (
          <Cartao
            key={p.id}
            titulo={`#${p.numero} · ${ROTULO_TIPO_SOLICITACAO[p.tipo] ?? p.tipo}`}
            acoes={<Selo cor={COR_STATUS_SOLICITACAO[p.status] ?? "cinza"}>{ROTULO_STATUS_SOLICITACAO[p.status] ?? p.status}</Selo>}
          >
            <div className="mb-2 text-sm text-texto-2">
              {p.pessoa ? (
                <Link href={`/pessoas/${p.pessoa.id}`} className="font-medium text-texto hover:underline">
                  {p.pessoa.nome}
                </Link>
              ) : (
                "—"
              )}{" "}
              · {ROTULO_PERFIL[p.perfil]}
              {p.contrato ? (
                <>
                  {" "}
                  ·{" "}
                  <Link href={`/contratos/${p.contrato.id}`} className="text-acento hover:underline">
                    contrato nº {p.contrato.numero}
                    {p.contrato.imovel ? ` (${p.contrato.imovel.codigo})` : ""}
                  </Link>
                </>
              ) : null}{" "}
              · {formatarDataBR(diaLocal(p.created_at))} {horaLocal(p.created_at)}
            </div>
            <p className="whitespace-pre-line rounded-[12px] border border-borda bg-elev px-3 py-2 text-sm text-texto">{p.mensagem}</p>
            {p.data_desejada && <p className="mt-2 text-sm text-texto-2">Data desejada: {formatarDataBR(p.data_desejada)}</p>}
            {p.tipo === "desocupacao" && p.contrato && (
              <p className="mt-2 text-xs text-mudo">
                Para registrar a saída, abra o contrato → Desocupação (aviso, vistoria, acerto). O pedido do portal não encerra nada sozinho.
              </p>
            )}
            <Formulario acao={tratarSolicitacao} className="mt-4 space-y-3">
              <input type="hidden" name="id" value={p.id} />
              <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                <Selecao name="status" defaultValue={p.status} aria-label="Situação do pedido">
                  {STATUS_SOLICITACAO.map((s) => (
                    <option key={s} value={s}>
                      {ROTULO_STATUS_SOLICITACAO[s]}
                    </option>
                  ))}
                </Selecao>
                <AreaTexto name="resposta" rows={2} defaultValue={p.resposta ?? ""} aria-label="Resposta para a pessoa" placeholder="Resposta (aparece no portal da pessoa)…" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <BotaoEnviar variante="secundario">Salvar resposta</BotaoEnviar>
                {!pessoal && !p.tarefa_id && (
                  <BotaoAcao acao={criarTarefaDoPedido} id={p.id} tamanho="sm">
                    <ListTodo className="size-3.5" /> Criar tarefa
                  </BotaoAcao>
                )}
                {p.tarefa_id && (
                  <Link href="/comercial/tarefas" className="text-xs text-acento hover:underline">
                    virou tarefa
                  </Link>
                )}
                {p.pessoa && !p.interacao_id && (
                  <BotaoAcao acao={registrarPedidoNaPessoa} id={p.id} tamanho="sm">
                    <NotebookPen className="size-3.5" /> Registrar na pessoa
                  </BotaoAcao>
                )}
                {p.interacao_id && p.pessoa && (
                  <Link href={`/pessoas/${p.pessoa.id}/relacionamento`} className="text-xs text-acento hover:underline">
                    registrado na pessoa
                  </Link>
                )}
                {p.acesso_id && (
                  <Link href={`/portais/${p.acesso_id}`} className="text-xs text-acento hover:underline">
                    link do portal
                  </Link>
                )}
                <span className="ml-auto">
                  <BotaoExcluir acao={excluirSolicitacao} id={p.id} rotulo="Excluir pedido" confirmar={`Excluir o pedido nº ${p.numero}? Ele some também do portal da pessoa.`} />
                </span>
              </div>
            </Formulario>
          </Cartao>
        ))}
      </div>
    </>
  );
}

