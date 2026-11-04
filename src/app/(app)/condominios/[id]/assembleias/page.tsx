import type { Metadata } from "next";
import Link from "next/link";
import { Gavel, Plus } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Campo, Celula, Entrada, Grade, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { COR_STATUS_ASSEMBLEIA, STATUS_ASSEMBLEIA, TIPOS_ASSEMBLEIA } from "@/lib/dominio/condominios";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { criarAssembleia } from "../../actions-gestao";

export const metadata: Metadata = { title: "Assembleias do condomínio" };

/** Assembleias (AGO/AGE): convocação, pauta, presença, votação com quórum e ata. */
export default async function AssembleiasPage({ params }: PageProps<"/condominios/[id]/assembleias">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const { data } = await supabase
    .from("cond_assembleias")
    .select("id, tipo, titulo, data, status, voto_portal, itens:cond_assembleia_itens(id), presencas:cond_assembleia_presencas(id)")
    .eq("condominio_id", id)
    .order("data", { ascending: false })
    .limit(200);
  const lista = (data ?? []) as unknown as { id: string; tipo: string; titulo: string; data: string; status: string; voto_portal: boolean; itens: { id: string }[]; presencas: { id: string }[] }[];
  const base = `/condominios/${id}/assembleias`;

  return (
    <div className="space-y-5">
      <div className="flex justify-end">
        <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Nova assembleia</>} titulo="Nova assembleia" acao={criarAssembleia} icone={<Gavel />} rotuloSalvar="Criar">
          <input type="hidden" name="condominio_id" value={id} />
          <Campo rotulo="Título">
            <Entrada name="titulo" required placeholder="Ex.: AGO 2027 — contas e orçamento" />
          </Campo>
          <Grade colunas={3}>
            <Campo rotulo="Tipo">
              <Selecao name="tipo" defaultValue="ordinaria">
                {Object.entries(TIPOS_ASSEMBLEIA).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Dia">
              <Entrada name="data" type="date" required defaultValue={somarDias(hojeISO(), 15)} />
            </Campo>
            <Campo rotulo="Hora">
              <Entrada name="hora" type="time" defaultValue="19:30" />
            </Campo>
          </Grade>
          <Grade colunas={2}>
            <Campo rotulo="Local">
              <Entrada name="local" placeholder="Ex.: Salão de festas" />
            </Campo>
            <Campo rotulo="Link da reunião online">
              <Entrada name="link_online" placeholder="https://…" />
            </Campo>
          </Grade>
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="hidden" name="voto_portal" value="off" />
            <input type="checkbox" name="voto_portal" className="size-4 accent-[var(--accent)]" /> Aceitar voto pelo portal do condômino (uma vez por unidade)
          </label>
        </JanelaCadastro>
      </div>
      <Tabela colunas={["Data", "Assembleia", "Tipo", "Pauta", "Presenças", "Situação"]}>
        {lista.map((a) => (
          <LinhaLink key={a.id} href={`${base}/${a.id}`}>
            <Celula className="whitespace-nowrap text-sm text-texto-2">
              {formatarDataBR(diaLocal(a.data))} {horaLocal(a.data)}
            </Celula>
            <Celula>
              <Link href={`${base}/${a.id}`} className="font-medium text-texto hover:underline">
                {a.titulo}
              </Link>
              {a.voto_portal && <span className="block text-xs text-mudo">voto pelo portal</span>}
            </Celula>
            <Celula className="text-sm text-texto-2">{TIPOS_ASSEMBLEIA[a.tipo as keyof typeof TIPOS_ASSEMBLEIA] ?? a.tipo}</Celula>
            <Celula className="tabular-nums">{a.itens.length} item(ns)</Celula>
            <Celula className="tabular-nums">{a.presencas.length}</Celula>
            <Celula>
              <Selo cor={COR_STATUS_ASSEMBLEIA[a.status] ?? "cinza"}>{STATUS_ASSEMBLEIA[a.status as keyof typeof STATUS_ASSEMBLEIA] ?? a.status}</Selo>
            </Celula>
          </LinhaLink>
        ))}
        {lista.length === 0 && <LinhaVazia colunas={6}>Nenhuma assembleia ainda.</LinhaVazia>}
      </Tabela>
    </div>
  );
}
