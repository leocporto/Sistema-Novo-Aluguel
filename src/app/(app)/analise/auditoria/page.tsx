import type { Metadata } from "next";
import Link from "next/link";
import { Gavel, ShieldAlert, ThumbsDown, ThumbsUp } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, Indicador, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { hojeISO, somarDias } from "@/lib/dominio/datas";
import { AbasAnalise } from "../abas";
import { nomesEquipe, quando } from "../dados";
import { COR_EVENTO, GRUPOS_EVENTO, ROTULO_EVENTO } from "../eventos";

export const metadata: Metadata = { title: "Histórico da análise cadastral" };

/** Quem fez o quê e quando nas análises (decisões, exceções, documentos, crédito, garantias). Só leitura. */
export default async function AuditoriaPage({ searchParams }: PageProps<"/analise/auditoria">) {
  const sp = await searchParams;
  const grupo = typeof sp.grupo === "string" && sp.grupo in GRUPOS_EVENTO ? sp.grupo : "";
  const hoje = hojeISO();
  const de = typeof sp.de === "string" && /^\d{4}-\d{2}-\d{2}$/.test(sp.de) ? sp.de : somarDias(hoje, -90);
  const { supabase, usuario } = await obterContexto();
  let q = supabase.from("analise_eventos").select("id, analise_id, contrato_id, tipo, descricao, usuario_id, data").gte("data", `${de}T00:00:00-03:00`).order("data", { ascending: false }).limit(1000);
  if (grupo) q = q.in("tipo", GRUPOS_EVENTO[grupo].tipos);
  const [{ data }, { data: decs }, nome] = await Promise.all([
    q,
    supabase.from("analise_decisoes").select("decisao, excecao").gte("data", `${de}T00:00:00-03:00`).limit(5000),
    nomesEquipe(supabase, usuario.id),
  ]);
  const eventos = data ?? [];
  const ds = decs ?? [];
  const url = (k: string) => `/analise/auditoria?de=${de}${k ? `&grupo=${k}` : ""}`;

  return (
    <>
      <Cabecalho
        titulo="Histórico da análise"
        trilha="Análise cadastral"
        descricao="Registro automático de decisões, exceções, documentos, consultas de crédito, garantias e renovações. Ninguém altera nem apaga — nem quando a análise é excluída."
      />
      <AbasAnalise />
      <div className="entrar-cascata mb-6 grid grid-cols-2 gap-4 xl:grid-cols-4">
        <Indicador rotulo="Decisões no período" icone={<Gavel />} valor={<Contador valor={ds.length} />} href={url("decisoes")} />
        <Indicador rotulo="Aprovações" icone={<ThumbsUp />} valor={<Contador valor={ds.filter((d) => d.decisao !== "reprovado").length} />} tom="sucesso" />
        <Indicador rotulo="Reprovações" icone={<ThumbsDown />} valor={<Contador valor={ds.filter((d) => d.decisao === "reprovado").length} />} tom="perigo" />
        <Indicador rotulo="Exceções (fora da regra)" icone={<ShieldAlert />} valor={<Contador valor={ds.filter((d) => d.excecao).length} />} tom={ds.some((d) => d.excecao) ? "alerta" : "neutro"} href={url("excecoes")} />
      </div>
      <PilulasLink
        className="mb-4"
        rotulo="Assunto"
        ativo={url(grupo)}
        itens={[{ href: url(""), rotulo: "Tudo" }, ...Object.entries(GRUPOS_EVENTO).map(([k, g]) => ({ href: url(k), rotulo: g.rotulo }))]}
      />
      <FiltroAutomatico className="mb-4 flex items-center gap-2">
        {grupo && <input type="hidden" name="grupo" value={grupo} />}
        <span className="text-sm text-texto-2">Desde</span>
        <Entrada type="date" name="de" aria-label="Mostrar desde" defaultValue={de} className="w-44" />
      </FiltroAutomatico>
      <Tabela colunas={["Quando", "O quê", "Detalhe", "Onde", "Quem"]}>
        {eventos.map((e) => (
          <tr key={e.id} className="align-top">
            <Celula className="whitespace-nowrap">{quando(e.data)}</Celula>
            <Celula>
              <Selo cor={COR_EVENTO[e.tipo] ?? "cinza"}>{ROTULO_EVENTO[e.tipo] ?? e.tipo}</Selo>
            </Celula>
            <Celula>
              <span className="text-sm text-texto">{e.descricao}</span>
            </Celula>
            <Celula>
              {e.analise_id && e.tipo !== "excluida" ? (
                <Link href={`/analise/${e.analise_id}/historico`} className="text-xs text-acento hover:underline">
                  análise
                </Link>
              ) : e.contrato_id ? (
                <Link href={`/contratos/${e.contrato_id}/partes`} className="text-xs text-acento hover:underline">
                  contrato
                </Link>
              ) : (
                <span className="text-xs text-mudo">—</span>
              )}
            </Celula>
            <Celula>
              <span className="text-xs text-texto-2">{nome(e.usuario_id)}</span>
            </Celula>
          </tr>
        ))}
        {eventos.length === 0 && <LinhaVazia colunas={5}>Nada registrado no período.</LinhaVazia>}
      </Tabela>
      {eventos.length >= 1000 && <p className="mt-3 text-sm text-alerta">Mostrando os 1.000 registros mais recentes. Escolha uma data mais próxima para ver o resto.</p>}
    </>
  );
}
