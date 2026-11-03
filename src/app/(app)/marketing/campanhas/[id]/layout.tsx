import Link from "next/link";
import { notFound } from "next/navigation";
import { Ban, Copy } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { SubAbas } from "@/components/sub-abas";
import { Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { agoraMs } from "@/lib/dominio/datas";
import { formatarDataHora, ROTULO_SITUACAO_CAMPANHA, ROTULO_TIPO_CAMPANHA, situacaoCampanha, type TipoCampanha } from "@/lib/dominio/marketing";
import { cancelarCampanha, duplicarCampanha, excluirCampanha } from "../../actions";
import { SeloCanal } from "../../campos";
import { contagemVazia, contagensPorCampanha } from "../../dados";

/** Cabeçalho e abas da ficha da campanha. */
export default async function CampanhaLayout({ children, params }: LayoutProps<"/marketing/campanhas/[id]">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const { data: c } = await supabase.from("mkt_campanhas").select("id, nome, tipo, canal, status, agendada_para, fila_em").eq("id", id).maybeSingle();
  if (!c) notFound();
  const n = (await contagensPorCampanha(supabase, [id])).get(id) ?? contagemVazia();
  const sit = situacaoCampanha(c, n.pendentes, agoraMs());
  const base = `/marketing/campanhas/${id}`;

  return (
    <>
      <div className="mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[13px] text-mudo">
            <span>Novo Aluguel</span>
            <span className="text-fraco">›</span>
            <Link href="/marketing/campanhas" className="text-acento-hot hover:underline">
              Campanhas
            </Link>
          </div>
          <h1 className="mt-1.5 text-[clamp(26px,2.8vw,36px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">{c.nome}</h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-[13.5px] text-texto-2">
            <Selo cor={sit === "concluida" ? "verde" : sit === "agendada" ? "amarelo" : sit === "enviando" ? "azul" : "cinza"}>
              {sit === "agendada" ? `Agendada para ${formatarDataHora(c.agendada_para)}` : ROTULO_SITUACAO_CAMPANHA[sit]}
            </Selo>
            <SeloCanal canal={c.canal} />
            <span>{ROTULO_TIPO_CAMPANHA[c.tipo as TipoCampanha] ?? c.tipo}</span>
            {n.total > 0 && (
              <span className="tabular-nums">
                · {n.enviados} enviada(s), {n.pendentes} na fila{n.bloqueados ? `, ${n.bloqueados} descadastrado(s)` : ""}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <BotaoAcao acao={duplicarCampanha} id={id} depois="/marketing/campanhas">
            <Copy className="size-4" /> Duplicar
          </BotaoAcao>
          {c.status !== "cancelada" && sit !== "concluida" && (
            <BotaoAcao acao={cancelarCampanha} id={id} confirmar="Cancelar a campanha? O que ainda está na fila não será enviado.">
              <Ban className="size-4" /> Cancelar
            </BotaoAcao>
          )}
          <BotaoExcluir acao={excluirCampanha} id={id} variante="botao" confirmar={`Excluir a campanha "${c.nome}" e a fila dela?`} depois="/marketing/campanhas" />
        </div>
      </div>
      <SubAbas
        rotulo="Campanha"
        itens={[
          { href: base, rotulo: "Mensagem e público" },
          { href: `${base}/envios`, rotulo: `Fila desta campanha${n.total ? ` (${n.total})` : ""}` },
        ]}
      />
      {children}
    </>
  );
}
