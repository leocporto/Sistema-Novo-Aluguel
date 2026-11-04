import Link from "next/link";
import { CalendarClock, ClipboardList, HandCoins, Hammer } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoEnviar, BotaoImprimir, Formulario } from "@/components/formulario";
import { LinhaLink } from "@/components/linha-link";
import { AreaTexto, Aviso, Campo, Cartao, Celula, Entrada, Indicador, LinhaVazia, Selo, Tabela, classeBotao } from "@/components/ui";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { formatarReais, paraCentavos, paraReais } from "@/lib/dominio/dinheiro";
import { COR_STATUS_CHAMADO, ROTULO_CATEGORIA_CURTO, ROTULO_STATUS_CHAMADO, ROTULO_URGENCIA } from "@/lib/dominio/manutencao";
import { enviarOrcamentoPortal, execucaoPortal } from "../actions";
import { EnviarFotos } from "../formularios";
import { dadosPortal, ehErroPortal } from "../sessao";
import { AvisoSessao, NaoEncontrado } from "./comum";

type Num = number | string;
const reais = (v: Num | null | undefined) => formatarReais(v ?? 0);
const corChamado = (s: string) => COR_STATUS_CHAMADO[s as keyof typeof COR_STATUS_CHAMADO] ?? "cinza";
const quando = (iso: string | null) => (iso ? `${formatarDataBR(diaLocal(iso))} às ${horaLocal(iso)}` : "a combinar");

// ---------------------------------------------------------------------------
// Início
// ---------------------------------------------------------------------------

type Inicio = { pedidos: number; em_andamento: number; a_receber: Num; proximo: { id: string; numero: number; titulo: string; agendado_para: string } | null };

export async function InicioPrestador({ token }: { token: string }) {
  const d = await dadosPortal<Inicio>(token, "inicio");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  const base = `/portal/${token}`;
  return (
    <div className="space-y-5">
      <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Pedidos de orçamento" valor={<Contador valor={d.pedidos} />} icone={<ClipboardList />} tom={d.pedidos ? "alerta" : "neutro"} href={`${base}/ordens`} />
        <Indicador rotulo="Serviços em andamento" valor={<Contador valor={d.em_andamento} />} icone={<Hammer />} href={`${base}/ordens`} />
        <Indicador rotulo="A receber" valor={<Contador valor={Number(d.a_receber)} formato="moeda" />} icone={<HandCoins />} href={`${base}/pagamentos`} />
      </div>
      {d.proximo && (
        <Cartao
          titulo="Próximo serviço agendado"
          acoes={
            <Link href={`${base}/ordem/${d.proximo.id}`} className={classeBotao("secundario", "sm")}>
              Abrir ordem de serviço
            </Link>
          }
        >
          <p className="flex items-center gap-2 text-sm text-texto">
            <CalendarClock className="size-4 text-acento" /> #{d.proximo.numero} · {d.proximo.titulo} — {quando(d.proximo.agendado_para)}
          </p>
        </Cartao>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Ordens de serviço e pedidos de orçamento
// ---------------------------------------------------------------------------

type Ordens = {
  servicos: { id: string; numero: number; titulo: string; categoria: string; urgencia: string; status: string; agendado_para: string | null; valor_aprovado: Num | null; concluido_em: string | null; prestador_concluiu_em: string | null; bairro: string | null }[];
  pedidos: { orcamento_id: string; id: string; numero: number; titulo: string; categoria: string; urgencia: string; solicitado_em: string; status: string; valor: Num | null; bairro: string | null }[];
};

export async function OrdensPrestador({ token }: { token: string }) {
  const d = await dadosPortal<Ordens>(token, "ordens");
  if (ehErroPortal(d)) return <AvisoSessao erro={d.erro} token={token} />;
  if (!d) return <NaoEncontrado />;
  const base = `/portal/${token}`;
  return (
    <div className="space-y-5">
      <Cartao titulo="Pedidos de orçamento">
        <Tabela colunas={["Chamado", "Local", "Urgência", "Pedido em", "Seu orçamento"]}>
          {d.pedidos.length === 0 && <LinhaVazia colunas={5}>Nenhum pedido de orçamento aberto.</LinhaVazia>}
          {d.pedidos.map((p) => (
            <LinhaLink key={p.orcamento_id} href={`${base}/ordem/${p.id}`}>
              <Celula>
                #{p.numero} · {p.titulo}
                <span className="block text-xs text-mudo">{ROTULO_CATEGORIA_CURTO[p.categoria] ?? p.categoria}</span>
              </Celula>
              <Celula>{p.bairro ?? "—"}</Celula>
              <Celula>{ROTULO_URGENCIA[p.urgencia] ?? p.urgencia}</Celula>
              <Celula>{formatarDataBR(diaLocal(p.solicitado_em))}</Celula>
              <Celula>{p.status === "recebido" && p.valor != null ? <Selo cor="verde">enviado: {reais(p.valor)}</Selo> : <Selo cor="amarelo">a enviar</Selo>}</Celula>
            </LinhaLink>
          ))}
        </Tabela>
      </Cartao>
      <Cartao titulo="Seus serviços">
        <Tabela colunas={["Chamado", "Local", "Quando", "Valor", "Situação"]}>
          {d.servicos.length === 0 && <LinhaVazia colunas={5}>Nenhum serviço com você ainda.</LinhaVazia>}
          {d.servicos.map((s) => (
            <LinhaLink key={s.id} href={`${base}/ordem/${s.id}`}>
              <Celula>
                #{s.numero} · {s.titulo}
                <span className="block text-xs text-mudo">{ROTULO_CATEGORIA_CURTO[s.categoria] ?? s.categoria}</span>
              </Celula>
              <Celula>{s.bairro ?? "—"}</Celula>
              <Celula className="text-sm">{s.concluido_em ? `concluído em ${formatarDataBR(s.concluido_em)}` : quando(s.agendado_para)}</Celula>
              <Celula className="tabular-nums">{s.valor_aprovado != null ? reais(s.valor_aprovado) : "—"}</Celula>
              <Celula>
                <Selo cor={corChamado(s.status)}>{ROTULO_STATUS_CHAMADO[s.status] ?? s.status}</Selo>
                {s.prestador_concluiu_em && !s.concluido_em && <span className="mt-1 block text-xs text-mudo">você avisou que terminou</span>}
              </Celula>
            </LinhaLink>
          ))}
        </Tabela>
      </Cartao>
    </div>
  );
}

type Ordem = {
  id: string;
  numero: number;
  titulo: string;
  descricao: string | null;
  local: string | null;
  categoria: string;
  urgencia: string;
  status: string;
  aprovacao_status: string;
  designado: boolean;
  criado_em: string;
  agendado_para: string | null;
  iniciado_em: string | null;
  prestador_concluiu_em: string | null;
  prestador_comentario: string | null;
  concluido_em: string | null;
  garantia_ate: string | null;
  valor_aprovado: Num | null;
  imovel: string;
  endereco: string | null;
  contato: { nome: string | null; telefone: string | null } | null;
  organizacao: { nome: string; documento: string | null; telefone: string | null; email: string | null; modo: string };
  prestador: { nome: string; documento: string | null; telefone: string | null; especialidade: string | null };
  escolhido: { valor: Num | null; prazo_dias: number | null; garantia_dias: number | null; descricao: string | null } | null;
  meus_orcamentos: { id: string; status: string; valor: Num | null; prazo_dias: number | null; garantia_dias: number | null; validade: string | null; descricao: string | null; solicitado_em: string; recebido_em: string | null }[];
  fotos: number;
  pode_orcar: boolean;
  pode_iniciar: boolean;
  pode_concluir: boolean;
  pode_fotos: boolean;
};

function Linha({ rotulo, children }: { rotulo: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[140px_1fr] gap-3 border-b border-borda-suave py-1.5 text-[13.5px]">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.1em] text-mudo">{rotulo}</span>
      <span className="text-texto">{children || "—"}</span>
    </div>
  );
}

export async function OrdemPrestador({ token, id }: { token: string; id: string }) {
  const c = await dadosPortal<Ordem>(token, "ordem", { id });
  if (ehErroPortal(c)) return <AvisoSessao erro={c.erro} token={token} />;
  if (!c) return <NaoEncontrado texto="Ordem de serviço não encontrada." />;
  const pedido = c.meus_orcamentos.find((o) => o.status === "solicitado" || o.status === "recebido");
  return (
    <div className="space-y-5">
      <div className="nao-imprimir flex flex-wrap justify-between gap-2">
        <Link href={`/portal/${token}/ordens`} className={classeBotao("fantasma")}>
          ← Voltar às ordens
        </Link>
        {c.designado && <BotaoImprimir />}
      </div>

      {c.pode_orcar && pedido && (
        <Cartao titulo={pedido.status === "recebido" ? "Seu orçamento (pode corrigir até a escolha)" : "Enviar orçamento"} className="nao-imprimir">
          <Formulario acao={enviarOrcamentoPortal} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="orcamento" value={pedido.id} />
            <div className="grid gap-3 sm:grid-cols-4">
              <Campo rotulo="Valor (R$)">
                <Entrada name="valor" inputMode="decimal" required defaultValue={pedido.valor != null ? String(pedido.valor).replace(".", ",") : ""} />
              </Campo>
              <Campo rotulo="Prazo (dias)">
                <Entrada name="prazo_dias" inputMode="numeric" defaultValue={pedido.prazo_dias ?? ""} />
              </Campo>
              <Campo rotulo="Garantia (dias)">
                <Entrada name="garantia_dias" inputMode="numeric" defaultValue={pedido.garantia_dias ?? ""} />
              </Campo>
              <Campo rotulo="Válido até">
                <Entrada type="date" name="validade" min={hojeISO()} defaultValue={pedido.validade ?? ""} />
              </Campo>
            </div>
            <Campo rotulo="O que está incluído">
              <AreaTexto name="descricao" rows={3} defaultValue={pedido.descricao ?? ""} placeholder="Material, mão de obra, o que será feito…" />
            </Campo>
            <BotaoEnviar>{pedido.status === "recebido" ? "Corrigir orçamento" : "Enviar orçamento"}</BotaoEnviar>
          </Formulario>
        </Cartao>
      )}

      {c.designado && (c.pode_iniciar || c.pode_concluir) && (
        <Cartao titulo="Atualizar o serviço" className="nao-imprimir">
          {c.prestador_concluiu_em && (
            <div className="mb-3">
              <Aviso>Você avisou que terminou em {formatarDataBR(diaLocal(c.prestador_concluiu_em))}. A equipe vai conferir e aprovar a conclusão.</Aviso>
            </div>
          )}
          <Formulario acao={execucaoPortal} className="space-y-3">
            <input type="hidden" name="token" value={token} />
            <input type="hidden" name="chamado" value={c.id} />
            <Campo rotulo="Comentário (opcional)">
              <AreaTexto name="comentario" rows={2} maxLength={2000} placeholder="O que foi feito, peças trocadas, recomendações…" />
            </Campo>
            <div className="flex flex-wrap gap-2">
              {c.pode_iniciar && (
                <BotaoEnviar name="acao" value="iniciar" variante="secundario">
                  Cheguei e comecei
                </BotaoEnviar>
              )}
              {c.pode_concluir && (
                <BotaoEnviar name="acao" value="concluir" confirmar="Avisar que o serviço terminou? A equipe confere e aprova a conclusão.">
                  Terminei o serviço
                </BotaoEnviar>
              )}
              <BotaoEnviar name="acao" value="comentario" variante="fantasma">
                Só enviar o comentário
              </BotaoEnviar>
            </div>
          </Formulario>
        </Cartao>
      )}

      {c.designado && c.pode_fotos && (
        <Cartao titulo="Fotos da conclusão" className="nao-imprimir">
          <p className="mb-3 text-sm text-texto-2">Mande fotos do serviço pronto (antes de ir embora). {c.fotos > 0 ? `Você já mandou ${c.fotos} arquivo(s).` : ""}</p>
          <EnviarFotos token={token} chamadoId={c.id} rotulo="Enviar fotos do serviço pronto" />
        </Cartao>
      )}

      <article className="mx-auto max-w-3xl rounded-card border border-borda bg-card p-8 print:border-0 print:p-0">
        <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-borda pb-4">
          <div>
            <div className="text-[17px] font-semibold text-texto">{c.organizacao.nome}</div>
            <div className="text-xs text-mudo">{[c.organizacao.documento ? formatarDocumento(c.organizacao.documento) : null, c.organizacao.telefone, c.organizacao.email].filter(Boolean).join(" · ")}</div>
          </div>
          <div className="text-right">
            <div className="text-[20px] font-semibold text-texto">{c.designado ? "Ordem de serviço" : "Pedido de orçamento"} nº {c.numero}</div>
            <div className="text-xs text-mudo">
              <Selo cor={corChamado(c.status)}>{ROTULO_STATUS_CHAMADO[c.status] ?? c.status}</Selo>
            </div>
          </div>
        </header>
        <section className="mb-5">
          <h2 className="mb-2 text-[14px] font-semibold text-texto">Local do serviço</h2>
          <Linha rotulo="Imóvel">{`${c.imovel}${c.endereco ? ` — ${c.endereco}` : ""}`}</Linha>
          <Linha rotulo="Cômodo">{c.local}</Linha>
          {c.designado && <Linha rotulo="Contato no local">{c.contato ? `${c.contato.nome ?? ""} · ${c.contato.telefone ?? ""}` : null}</Linha>}
          {c.designado && <Linha rotulo="Data e hora">{quando(c.agendado_para)}</Linha>}
        </section>
        <section className="mb-5">
          <h2 className="mb-2 text-[14px] font-semibold text-texto">Serviço</h2>
          <Linha rotulo="Problema">{c.titulo}</Linha>
          <Linha rotulo="Tipo">{ROTULO_CATEGORIA_CURTO[c.categoria] ?? c.categoria}</Linha>
          <Linha rotulo="Urgência">{ROTULO_URGENCIA[c.urgencia] ?? c.urgencia}</Linha>
          <Linha rotulo="Detalhes">{c.descricao}</Linha>
          {c.designado && <Linha rotulo="Orçamento">{c.escolhido?.descricao}</Linha>}
          {c.designado && <Linha rotulo="Valor aprovado">{c.valor_aprovado != null ? reais(c.valor_aprovado) : null}</Linha>}
          {c.designado && <Linha rotulo="Garantia">{c.escolhido?.garantia_dias != null ? `${c.escolhido.garantia_dias} dias a partir da conclusão` : null}</Linha>}
          {c.designado && c.aprovacao_status === "pendente" && <Linha rotulo="Aprovação">aguardando o proprietário aprovar o orçamento</Linha>}
        </section>
        <section className="mb-5">
          <h2 className="mb-2 text-[14px] font-semibold text-texto">Prestador</h2>
          <Linha rotulo="Nome">{c.prestador.nome}</Linha>
          <Linha rotulo="Documento">{c.prestador.documento ? formatarDocumento(c.prestador.documento) : null}</Linha>
          <Linha rotulo="Especialidade">{c.prestador.especialidade}</Linha>
        </section>
        {c.designado && (
          <section className="grid gap-8 pt-6 sm:grid-cols-2">
            {["Prestador", "Quem recebeu o serviço"].map((r) => (
              <div key={r} className="text-center text-xs text-mudo">
                <div className="mb-1 h-10 border-b border-borda-forte" />
                {r}
              </div>
            ))}
          </section>
        )}
      </article>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pagamentos
// ---------------------------------------------------------------------------

type Pagamento = { id: string; descricao: string; valor: Num; vencimento: string; status: string; liquidado_em: string | null; chamado: number | null };

export async function PagamentosPrestador({ token }: { token: string }) {
  const lista = await dadosPortal<Pagamento[]>(token, "pagamentos");
  if (ehErroPortal(lista)) return <AvisoSessao erro={lista.erro} token={token} />;
  const pagamentos = lista ?? [];
  const soma = (f: (p: Pagamento) => boolean) => paraReais(pagamentos.filter(f).reduce((s, p) => s + paraCentavos(p.valor), 0));
  return (
    <div className="space-y-5">
      <div className="entrar-cascata grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Indicador rotulo="A receber" valor={<Contador valor={soma((p) => p.status === "aberto")} formato="moeda" />} icone={<HandCoins />} tom="alerta" />
        <Indicador rotulo="Recebido (2 anos)" valor={<Contador valor={soma((p) => p.status === "liquidado")} formato="moeda" />} icone={<HandCoins />} tom="sucesso" />
      </div>
      <Tabela colunas={["Serviço", "Previsto para", "Valor", "Situação"]}>
        {pagamentos.length === 0 && <LinhaVazia colunas={4}>Nenhum pagamento registrado.</LinhaVazia>}
        {pagamentos.map((p) => (
          <tr key={p.id}>
            <Celula>
              {p.descricao}
              {p.chamado ? <span className="block text-xs text-mudo">chamado nº {p.chamado}</span> : null}
            </Celula>
            <Celula>{formatarDataBR(p.vencimento)}</Celula>
            <Celula className="tabular-nums">{reais(p.valor)}</Celula>
            <Celula>{p.status === "liquidado" ? <Selo cor="verde">Pago em {formatarDataBR(p.liquidado_em)}</Selo> : <Selo cor="amarelo">A receber</Selo>}</Celula>
          </tr>
        ))}
      </Tabela>
    </div>
  );
}
