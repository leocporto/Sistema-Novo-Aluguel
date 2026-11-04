import { RotateCcw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { COR_STATUS_ENTREGA, MAX_TENTATIVAS_WEBHOOK, ROTULO_EVENTO, ROTULO_STATUS_ENTREGA } from "@/lib/dominio/integracoes";
import { reprocessarEntrega } from "./actions";
import { quando, type Entrega } from "./dados";

/** Entregas de webhook (só leitura; o administrador pode mandar de novo). */
export function TabelaEntregas({ entregas, nomes, admin, vazio = "Nenhuma entrega ainda." }: { entregas: Entrega[]; nomes?: Map<string, string>; admin: boolean; vazio?: string }) {
  const colunas = ["Quando", ...(nomes ? ["Webhook"] : []), "Evento", "Situação", "Tentativas", "Resposta", ""];
  return (
    <Tabela colunas={colunas}>
      {entregas.length === 0 ? (
        <LinhaVazia colunas={colunas.length}>{vazio}</LinhaVazia>
      ) : (
        entregas.map((e) => (
          <tr key={e.id}>
            <Celula className="whitespace-nowrap text-texto-2">{quando(e.criado_em)}</Celula>
            {nomes && <Celula className="font-semibold">{nomes.get(e.assinatura_id) ?? "—"}</Celula>}
            <Celula>
              <div className="text-[13px]">{ROTULO_EVENTO[e.evento] ?? e.evento}</div>
              <div className="font-mono text-[11px] text-mudo">{e.id.slice(0, 8)}</div>
            </Celula>
            <Celula>
              <Selo cor={COR_STATUS_ENTREGA[e.status]}>{ROTULO_STATUS_ENTREGA[e.status]}</Selo>
              {(e.status === "falhou" || e.status === "pendente") && e.tentativas > 0 && (
                <div className="mt-1 text-[11.5px] text-mudo">próxima: {quando(e.proxima_tentativa)}</div>
              )}
            </Celula>
            <Celula className="whitespace-nowrap text-texto-2">
              {e.tentativas}/{MAX_TENTATIVAS_WEBHOOK}
            </Celula>
            <Celula className="max-w-[320px] text-[12.5px] text-texto-2">
              {e.resposta_status ? <span className="font-mono">HTTP {e.resposta_status}</span> : null}
              {e.erro ? <div className="text-ruim">{e.erro}</div> : null}
              {e.resposta_trecho ? <div className="truncate font-mono text-[11px] text-mudo">{e.resposta_trecho}</div> : null}
              {!e.resposta_status && !e.erro && "—"}
            </Celula>
            <Celula>
              {admin && e.status !== "pendente" && (
                <BotaoAcao acao={reprocessarEntrega} id={e.id} tamanho="sm" confirmar={e.status === "entregue" ? "Esta entrega já foi feita. Mandar de novo?" : undefined}>
                  <RotateCcw className="size-3.5" /> Reprocessar
                </BotaoAcao>
              )}
            </Celula>
          </tr>
        ))
      )}
    </Tabela>
  );
}
