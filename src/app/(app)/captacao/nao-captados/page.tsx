import type { Metadata } from "next";
import { Cabecalho, Selo } from "@/components/ui";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { LinhaLink } from "@/components/linha-link";
import { Selecao, Tabela, Celula, LinhaVazia } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { MOTIVOS_NAO_CAPTADO, ORIGENS_CAPTACAO, ROTULO_ETAPA_CAPTACAO, ETAPAS_CAPTACAO } from "@/lib/dominio/captacao";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasCaptacao, enderecoCaptacao, type Captacao } from "../campos";
import { BotaoRetomar } from "./retomar";

export const metadata: Metadata = { title: "Não captados" };

/** Histórico de oportunidades que não viraram imóvel — para entender o porquê e retomar. */
export default async function NaoCaptados({ searchParams }: PageProps<"/captacao/nao-captados">) {
  const sp = await searchParams;
  const motivo = typeof sp.motivo === "string" ? sp.motivo : "";
  const { supabase } = await obterContexto();
  let q = supabase
    .from("captacoes")
    .select("*, corretor:pessoas!captacoes_corretor_id_fkey(nome)")
    .eq("status", "nao_captado")
    .order("nao_captado_em", { ascending: false });
  if (motivo) q = q.eq("motivo_nao_captado", motivo);
  const { data } = await q;
  const lista = (data ?? []) as unknown as (Captacao & { corretor: { nome: string } | null })[];

  return (
    <>
      <Cabecalho titulo="Não captados" trilha="Captação" descricao="Oportunidades que não viraram imóvel, com o motivo. Retome quando o proprietário mudar de ideia." />
      <AbasCaptacao />
      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Selecao name="motivo" defaultValue={motivo} className="w-80">
          <option value="">Todos os motivos</option>
          {MOTIVOS_NAO_CAPTADO.map((m) => (
            <option key={m}>{m}</option>
          ))}
        </Selecao>
      </FiltroAutomatico>
      <Tabela colunas={["Proprietário", "Imóvel", "Chegou até", "Motivo", "Quando", "Corretor", ""]}>
        {lista.map((c) => (
          <LinhaLink key={c.id} href={`/captacao/${c.id}`}>
            <Celula>
              <span className="font-medium text-texto">{c.proprietario_nome}</span>
              <span className="block text-xs text-mudo">{ORIGENS_CAPTACAO[c.origem] ?? c.origem}</span>
            </Celula>
            <Celula>
              <span className="capitalize">{c.tipo}</span>
              <span className="block max-w-64 truncate text-xs text-mudo">{enderecoCaptacao(c) || "—"}</span>
              {c.valor_pretendido ? <span className="block text-xs text-mudo">pedia {formatarReais(c.valor_pretendido)}</span> : null}
            </Celula>
            <Celula>
              <Selo>{ROTULO_ETAPA_CAPTACAO[ETAPAS_CAPTACAO[Math.min(c.etapa_max, 4)]]}</Selo>
            </Celula>
            <Celula className="text-ruim">{c.motivo_nao_captado ?? "—"}</Celula>
            <Celula>{formatarDataBR(c.nao_captado_em?.slice(0, 10))}</Celula>
            <Celula>{c.corretor?.nome ?? "—"}</Celula>
            <Celula>
              <BotaoRetomar id={c.id} />
            </Celula>
          </LinhaLink>
        ))}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhuma oportunidade perdida{motivo ? " com esse motivo" : ""}.</LinhaVazia>}
      </Tabela>
    </>
  );
}
