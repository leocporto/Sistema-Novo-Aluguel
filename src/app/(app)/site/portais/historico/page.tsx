import type { Metadata } from "next";
import Link from "next/link";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Cartao, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { LISTA_PORTAIS, PORTAIS, ehPortal, type Portal } from "@/lib/dominio/site-portais";
import { AbasSite } from "../../abas";

export const metadata: Metadata = { title: "Envios e falhas" };

const dataHora = (iso: string) =>
  new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });

type Falha = { portal: Portal; ultimo_status: string; ultimas_falhas: string[]; verificado_em: string | null; imovel: { id: string; codigo: string } | null };
type Envio = {
  id: string;
  portal: Portal;
  origem: string;
  gerado_em: string;
  total_elegiveis: number;
  total_enviados: number;
  total_falhas: number;
  total_fora_limite: number;
  falhas: { codigo: string; problemas: string[] }[];
  agente: string | null;
};

/** Identificação de falhas de sincronização e o registro de cada geração do feed. */
export default async function EnviosPortaisPage({ searchParams }: PageProps<"/site/portais/historico">) {
  const sp = await searchParams;
  const portal = typeof sp.portal === "string" && ehPortal(sp.portal) ? sp.portal : "";
  const { supabase } = await obterContexto();
  let qf = supabase
    .from("portal_imoveis")
    .select("portal, ultimo_status, ultimas_falhas, verificado_em, imovel:imoveis(id, codigo)")
    .in("ultimo_status", ["falha", "fora_do_limite"])
    .order("verificado_em", { ascending: false })
    .limit(500);
  let qe = supabase
    .from("portal_sincronizacoes")
    .select("id, portal, origem, gerado_em, total_elegiveis, total_enviados, total_falhas, total_fora_limite, falhas, agente")
    .order("gerado_em", { ascending: false })
    .limit(100);
  if (portal) {
    qf = qf.eq("portal", portal);
    qe = qe.eq("portal", portal);
  }
  const [{ data: f }, { data: e }] = await Promise.all([qf, qe]);
  const falhas = (f ?? []) as unknown as Falha[];
  const envios = (e ?? []) as Envio[];
  const url = (p: string) => `/site/portais/historico${p ? `?portal=${p}` : ""}`;

  return (
    <>
      <Cabecalho
        titulo="Envios e falhas"
        trilha="Site e portais"
        descricao="O que não foi para os portais e por quê, e cada vez que um portal buscou o feed (ou que você conferiu no sistema). O histórico de envios não pode ser apagado."
      />
      <AbasSite />
      <PilulasLink className="mb-5" rotulo="Portal" ativo={url(portal)} itens={[{ href: url(""), rotulo: "Todos" }, ...LISTA_PORTAIS.map((p) => ({ href: url(p), rotulo: PORTAIS[p].nome }))]} />

      <Cartao titulo={`Falhas de sincronização (${falhas.filter((x) => x.ultimo_status === "falha").length})`} className="mb-6">
        {falhas.length === 0 ? (
          <p className="text-sm text-ok">Nenhuma falha no último envio. Tudo certo!</p>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {falhas.map((x, k) => (
              <li key={`${x.imovel?.id}-${x.portal}-${k}`} className="flex flex-wrap items-start justify-between gap-3 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {x.imovel ? (
                      <Link href={`/imoveis/${x.imovel.id}`} className="font-semibold text-acento hover:underline">
                        {x.imovel.codigo}
                      </Link>
                    ) : (
                      "—"
                    )}
                    <Selo>{PORTAIS[x.portal]?.nome.toUpperCase() ?? x.portal}</Selo>
                    {x.ultimo_status === "falha" ? <Selo cor="vermelho">NÃO FOI ENVIADO</Selo> : <Selo cor="amarelo">FORA DO LIMITE DO PLANO</Selo>}
                  </div>
                  {x.ultimas_falhas.length > 0 && (
                    <ul className="mt-1 list-disc pl-5 text-sm text-texto-2">
                      {x.ultimas_falhas.map((m) => (
                        <li key={m}>{m}</li>
                      ))}
                    </ul>
                  )}
                </div>
                <div className="flex items-center gap-3 text-xs text-mudo">
                  {x.verificado_em && <span>visto em {dataHora(x.verificado_em)}</span>}
                  {x.imovel && (
                    <Link href={`/imoveis/${x.imovel.id}`} className="font-semibold text-acento hover:underline">
                      corrigir no cadastro
                    </Link>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Cartao>

      <Tabela colunas={["Quando", "Portal", "Quem gerou", "Elegíveis", "Enviados", "Com falha", "Fora do limite", "Imóveis com falha"]}>
        {envios.map((x) => (
          <tr key={x.id}>
            <Celula className="whitespace-nowrap text-xs">{dataHora(x.gerado_em)}</Celula>
            <Celula>{PORTAIS[x.portal]?.nome ?? x.portal}</Celula>
            <Celula className="text-xs text-texto-2">
              {x.origem === "manual" ? "Conferido no sistema (não é envio)" : "O portal buscou"}
              {x.agente && x.origem !== "manual" && <span className="block max-w-56 truncate text-mudo">{x.agente}</span>}
            </Celula>
            <Celula className="tabular-nums">{x.total_elegiveis}</Celula>
            <Celula className={`tabular-nums ${x.origem === "manual" ? "text-mudo" : "text-ok"}`}>{x.total_enviados}</Celula>
            <Celula className={`tabular-nums ${x.total_falhas ? "text-ruim" : ""}`}>{x.total_falhas}</Celula>
            <Celula className={`tabular-nums ${x.total_fora_limite ? "text-alerta" : ""}`}>{x.total_fora_limite}</Celula>
            <Celula className="max-w-80 text-xs text-texto-2">{x.falhas.length ? x.falhas.map((y) => y.codigo).join(", ") : "—"}</Celula>
          </tr>
        ))}
        {envios.length === 0 && <LinhaVazia colunas={8}>Nenhum envio registrado ainda.</LinhaVazia>}
      </Tabela>
    </>
  );
}
