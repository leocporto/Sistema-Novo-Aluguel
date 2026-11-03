import Link from "next/link";
import { Celula, LinhaVazia, Tabela } from "@/components/ui";
import { formatarDataHora } from "@/lib/dominio/marketing";
import { AcoesEnvio } from "./acoes-envio";
import { SeloCanal, SeloEnvio } from "./campos";
import type { Envio } from "./dados";

export type EnvioLista = Envio & { campanha?: { id: string; nome: string } | null; automacao?: { nome: string } | null };

const ORIGEM: Record<string, string> = { automacao: "Automação", recomendacao: "Sugestão de imóveis", pesquisa: "Pesquisa", manual: "Manual", campanha: "Campanha" };

/** Lista da fila com o envio assistido em cada linha. */
export function TabelaEnvios({ envios, mostrarCampanha = true, vazio }: { envios: EnvioLista[]; mostrarCampanha?: boolean; vazio: string }) {
  return (
    <Tabela colunas={["Para", "Mensagem", ...(mostrarCampanha ? ["De onde veio"] : []), "Situação", ""]}>
      {envios.map((e) => (
        <tr key={e.id}>
          <Celula className="min-w-44">
            <span className="font-semibold text-texto">
              {e.lead_id ? (
                <Link href={`/comercial/leads/${e.lead_id}`} className="hover:underline">
                  {e.nome ?? "—"}
                </Link>
              ) : e.pessoa_id ? (
                <Link href={`/pessoas/${e.pessoa_id}`} className="hover:underline">
                  {e.nome ?? "—"}
                </Link>
              ) : (
                (e.nome ?? "—")
              )}
            </span>
            <span className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-mudo">
              <SeloCanal canal={e.canal} /> {e.canal === "email" ? e.email : e.telefone}
            </span>
          </Celula>
          <Celula className="max-w-[420px]">
            {e.assunto && <span className="block text-xs font-semibold text-texto-2">{e.assunto}</span>}
            <span className="line-clamp-3 whitespace-pre-wrap text-[13px] text-texto-2" title={e.mensagem}>
              {e.mensagem}
            </span>
          </Celula>
          {mostrarCampanha && (
            <Celula className="text-xs text-texto-2">
              {e.campanha ? (
                <Link href={`/marketing/campanhas/${e.campanha.id}`} className="text-acento hover:underline">
                  {e.campanha.nome}
                </Link>
              ) : (
                (ORIGEM[e.origem] ?? e.origem)
              )}
              {e.automacao && <span className="block">{e.automacao.nome}</span>}
            </Celula>
          )}
          <Celula>
            <SeloEnvio status={e.status} />
            <span className="mt-1 block text-xs text-mudo">
              {e.status === "enviado" ? formatarDataHora(e.enviado_em) : e.motivo ? e.motivo : e.status === "pendente" ? `desde ${formatarDataHora(e.agendado_para)}` : ""}
            </span>
          </Celula>
          <Celula>
            <AcoesEnvio envio={{ id: e.id, canal: e.canal, telefone: e.telefone, email: e.email, assunto: e.assunto, mensagem: e.mensagem, status: e.status, nome: e.nome }} />
          </Celula>
        </tr>
      ))}
      {envios.length === 0 && <LinhaVazia colunas={mostrarCampanha ? 5 : 4}>{vazio}</LinhaVazia>}
    </Tabela>
  );
}
