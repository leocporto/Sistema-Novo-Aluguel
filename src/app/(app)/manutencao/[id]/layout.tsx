import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, MessageCircle, Play, Printer, RotateCcw, Search } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { SubAbas } from "@/components/sub-abas";
import { AreaTexto, BotaoLink, Campo, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { COR_STATUS_CHAMADO, COR_URGENCIA, ROTULO_STATUS_CHAMADO, ROTULO_URGENCIA, podeIrPara, situacaoPrazo, textoPrazo } from "@/lib/dominio/manutencao";
import { linkWhatsapp } from "@/lib/whatsapp";
import { encerrarChamado, excluirChamado, iniciarAnalise, iniciarExecucao, reabrirChamado } from "../actions";
import { carregarChamado, contatoDoSolicitante } from "../dados";

/** Cabeçalho e abas da ficha do chamado. */
export default async function ChamadoLayout({ children, params }: LayoutProps<"/manutencao/[id]">) {
  const { id } = await params;
  const { supabase, papel } = await obterContexto();
  const decide = papel !== "corretor";
  const c = await carregarChamado(supabase, id);
  if (!c) notFound();
  const contato = await contatoDoSolicitante(supabase, c);
  const prazo = situacaoPrazo(c, new Date(agoraMs()).toISOString());
  const base = `/manutencao/${id}`;
  // Recusar, cancelar e excluir são decisões de admin, gestor ou financeiro.
  const podeRecusar = decide && podeIrPara(c.status, "recusado");
  const podeCancelar = decide && podeIrPara(c.status, "cancelado");

  return (
    <>
      <div className="nao-imprimir mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/manutencao" className="text-acento-hot hover:underline">
              Manutenção
            </Link>
            <span className="text-fraco">›</span>
            <span>#{c.numero}</span>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">
            #{c.numero} · {c.titulo}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={COR_STATUS_CHAMADO[c.status as keyof typeof COR_STATUS_CHAMADO] ?? "cinza"}>{ROTULO_STATUS_CHAMADO[c.status] ?? c.status}</Selo>
            <Selo cor={COR_URGENCIA[c.urgencia as keyof typeof COR_URGENCIA] ?? "cinza"}>urgência {ROTULO_URGENCIA[c.urgencia]?.toLowerCase()}</Selo>
            {prazo.situacao !== "atendido" && <span className={prazo.situacao === "atrasado" ? "font-semibold text-ruim" : ""}>{textoPrazo(prazo.horas)} para atender</span>}
            {c.imovel && (
              <Link href={`/imoveis/${c.imovel.id}`} className="text-acento hover:underline">
                {c.imovel.codigo}
              </Link>
            )}
            {c.contrato && (
              <Link href={`/contratos/${c.contrato.id}`} className="text-acento hover:underline">
                contrato #{c.contrato.numero}
              </Link>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {contato && (
            <a href={linkWhatsapp(contato.telefone, `Olá ${contato.nome.split(" ")[0] || ""}! Sobre o chamado de manutenção #${c.numero} (${c.titulo}): `)} target="_blank" rel="noreferrer" className={classeBotao("secundario")}>
              <MessageCircle className="size-4" /> Quem pediu
            </a>
          )}
          <BotaoLink href={`${base}/os`} variante="secundario">
            <Printer className="size-4" /> Ordem de serviço
          </BotaoLink>
          {c.status === "aberto" && (
            <BotaoAcao acao={iniciarAnalise} id={id} variante="primario">
              <Search className="size-4" /> Começar análise
            </BotaoAcao>
          )}
          {["aprovado", "agendado"].includes(c.status) && (
            <BotaoAcao acao={iniciarExecucao} id={id} variante="primario" confirmar="Marcar que o prestador começou o serviço?">
              <Play className="size-4" /> Iniciar execução
            </BotaoAcao>
          )}
          {["recusado", "cancelado"].includes(c.status) && (
            <BotaoAcao acao={reabrirChamado} id={id} confirmar="Reabrir o chamado (volta para análise)?">
              <RotateCcw className="size-4" /> Reabrir
            </BotaoAcao>
          )}
          {(podeRecusar || podeCancelar) && (
            <JanelaCadastro
              rotuloBotao={
                <>
                  <Ban className="size-4" /> Encerrar
                </>
              }
              variante="secundario"
              titulo="Encerrar o chamado"
              acao={encerrarChamado}
              icone={<Ban />}
              rotuloSalvar="Encerrar"
            >
              <input type="hidden" name="id" value={id} />
              <Campo rotulo="O que fazer">
                <Selecao name="acao" defaultValue={podeRecusar ? "recusar" : "cancelar"}>
                  {podeRecusar && <option value="recusar">Recusar — não procede (mau uso, não é manutenção…)</option>}
                  {podeCancelar && <option value="cancelar">Cancelar — não vai mais ser feito</option>}
                </Selecao>
              </Campo>
              <Campo rotulo="Motivo">
                <AreaTexto name="motivo" required rows={3} placeholder="Explique para o histórico (e para avisar quem pediu)." />
              </Campo>
            </JanelaCadastro>
          )}
          {decide && (
            <BotaoExcluir
              acao={excluirChamado}
              id={id}
              variante="botao"
              rotulo="Excluir"
              confirmar={`Excluir o chamado #${c.numero}? Fotos, orçamentos, o compromisso agendado e lançamentos ainda em aberto no financeiro saem junto.`}
              depois="/manutencao"
            />
          )}
        </div>
      </div>
      <div className="nao-imprimir">
        <SubAbas
          rotulo="Chamado"
          itens={[
            { href: base, rotulo: "Resumo e fotos" },
            { href: `${base}/orcamentos`, rotulo: "Orçamentos e aprovação" },
            { href: `${base}/execucao`, rotulo: "Agenda e conclusão" },
            { href: `${base}/historico`, rotulo: "Histórico" },
          ]}
        />
      </div>
      {children}
    </>
  );
}
