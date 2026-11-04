import type { Metadata } from "next";
import { CalendarCheck, CalendarX, PartyPopper, Plus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Campo, Cartao, Celula, Entrada, Grade, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { COR_STATUS_RESERVA, STATUS_RESERVA, nomeUnidade } from "@/lib/dominio/condominios";
import { agoraMs, formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { criarArea, criarReserva, decidirReserva, excluirArea, excluirReserva, salvarArea } from "../../actions-gestao";
import { unidadesDo } from "../../dados";

export const metadata: Metadata = { title: "Reservas de áreas comuns" };

type Area = { id: string; nome: string; regras: string | null; capacidade: number | null; antecedencia_min_horas: number; antecedencia_max_dias: number; duracao_max_horas: number; taxa: number; ativa: boolean };

function CamposArea({ a }: { a?: Area }) {
  return (
    <Grade colunas={3}>
      <Campo rotulo="Nome">
        <Entrada name="nome" required defaultValue={a?.nome ?? ""} placeholder="Salão de festas, churrasqueira…" />
      </Campo>
      <Campo rotulo="Capacidade (pessoas)">
        <Entrada name="capacidade" type="number" min={1} defaultValue={a?.capacidade ?? ""} />
      </Campo>
      <Campo rotulo="Taxa (R$)" dica="Vai na cota do mês seguinte.">
        <Entrada name="taxa" inputMode="decimal" defaultValue={a ? String(a.taxa) : "0"} />
      </Campo>
      <Campo rotulo="Antecedência mínima (horas)">
        <Entrada name="antecedencia_min_horas" type="number" min={0} defaultValue={a?.antecedencia_min_horas ?? 24} />
      </Campo>
      <Campo rotulo="Até quantos dias à frente">
        <Entrada name="antecedencia_max_dias" type="number" min={1} defaultValue={a?.antecedencia_max_dias ?? 90} />
      </Campo>
      <Campo rotulo="Duração máxima (horas)">
        <Entrada name="duracao_max_horas" type="number" min={1} max={72} defaultValue={a?.duracao_max_horas ?? 12} />
      </Campo>
    </Grade>
  );
}

/** Áreas comuns (regras, capacidade, antecedência, taxa) e reservas sem conflito de horário (o banco não deixa sobrepor). */
export default async function ReservasPage({ params, searchParams }: PageProps<"/condominios/[id]/reservas">) {
  const { id } = await params;
  const sp = await searchParams;
  const passadas = sp.ver === "passadas";
  const { supabase } = await obterContexto();
  const agora = new Date(agoraMs()).toISOString();
  let q = supabase
    .from("cond_reservas")
    .select("id, area_id, unidade_id, inicio, fim, status, taxa, origem, observacao, cota_item_id, area:cond_areas(nome), pessoa:pessoas(nome)")
    .eq("condominio_id", id)
    .limit(300);
  q = passadas ? q.lt("fim", agora).order("inicio", { ascending: false }) : q.gte("fim", agora).order("inicio");
  const [{ data: areasD }, { data }, unidades] = await Promise.all([
    supabase.from("cond_areas").select("id, nome, regras, capacidade, antecedencia_min_horas, antecedencia_max_dias, duracao_max_horas, taxa, ativa").eq("condominio_id", id).order("nome"),
    q,
    unidadesDo(supabase, id),
  ]);
  const areas = (areasD ?? []) as Area[];
  const lista = (data ?? []) as unknown as { id: string; area_id: string; unidade_id: string; inicio: string; fim: string; status: string; taxa: number | null; origem: string; observacao: string | null; cota_item_id: string | null; area: { nome: string } | null; pessoa: { nome: string } | null }[];
  const nomeU = new Map(unidades.map((u) => [u.id, nomeUnidade(u)]));
  const base = `/condominios/${id}/reservas`;
  const pedidas = lista.filter((r) => r.status === "pedida").length;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PilulasLink
          rotulo="Reservas"
          ativo={passadas ? `${base}?ver=passadas` : base}
          itens={[
            { href: base, rotulo: pedidas ? `Próximas (${pedidas} para confirmar)` : "Próximas" },
            { href: `${base}?ver=passadas`, rotulo: "Já aconteceram" },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <JanelaCadastro rotuloBotao={<><PartyPopper className="size-4" /> Nova área</>} variante="secundario" titulo="Área comum" acao={criarArea} icone={<PartyPopper />} larguraMax="max-w-2xl">
            <input type="hidden" name="condominio_id" value={id} />
            <CamposArea />
            <Campo rotulo="Regras de uso">
              <AreaTexto name="regras" rows={3} />
            </Campo>
          </JanelaCadastro>
          {areas.length > 0 && (
            <JanelaCadastro rotuloBotao={<><Plus className="size-4" /> Reservar</>} titulo="Reserva (já confirmada)" acao={criarReserva} icone={<CalendarCheck />}>
              <input type="hidden" name="condominio_id" value={id} />
              <Grade colunas={2}>
                <Campo rotulo="Área">
                  <Selecao name="area_id" required defaultValue={areas[0]?.id}>
                    {areas
                      .filter((a) => a.ativa)
                      .map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.nome}
                        </option>
                      ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Unidade">
                  <Selecao name="unidade_id" required defaultValue="">
                    <option value="" disabled>
                      Escolha…
                    </option>
                    {unidades.map((u) => (
                      <option key={u.id} value={u.id}>
                        {nomeUnidade(u)}
                      </option>
                    ))}
                  </Selecao>
                </Campo>
                <Campo rotulo="Dia">
                  <Entrada name="dia" type="date" required defaultValue={somarDias(hojeISO(), 7)} />
                </Campo>
                <Campo rotulo="Das">
                  <Entrada name="hora_inicio" type="time" required defaultValue="18:00" />
                </Campo>
                <Campo rotulo="Até" dica="Se terminar depois da meia-noite, vale para o dia seguinte.">
                  <Entrada name="hora_fim" type="time" required defaultValue="23:00" />
                </Campo>
                <Campo rotulo="Observação">
                  <Entrada name="observacao" />
                </Campo>
              </Grade>
            </JanelaCadastro>
          )}
        </div>
      </div>

      <Tabela colunas={["Quando", "Área", "Unidade", "Taxa", "Situação", ""]}>
        {lista.map((r) => (
          <tr key={r.id}>
            <Celula className="whitespace-nowrap text-sm">
              {formatarDataBR(diaLocal(r.inicio))}
              <span className="block text-xs text-mudo">
                {horaLocal(r.inicio)} às {horaLocal(r.fim)}
              </span>
            </Celula>
            <Celula>
              {r.area?.nome ?? "—"}
              {r.observacao && <span className="block text-xs text-mudo">{r.observacao}</span>}
            </Celula>
            <Celula className="text-sm text-texto-2">
              {nomeU.get(r.unidade_id)}
              {r.pessoa && <span className="block text-xs text-mudo">{r.pessoa.nome}</span>}
            </Celula>
            <Celula className="text-sm tabular-nums">
              {r.taxa ? formatarReais(r.taxa) : "—"}
              {r.cota_item_id && <span className="block text-xs text-ok">na cota</span>}
            </Celula>
            <Celula>
              <span className="flex flex-wrap gap-1">
                <Selo cor={COR_STATUS_RESERVA[r.status] ?? "cinza"}>{STATUS_RESERVA[r.status as keyof typeof STATUS_RESERVA] ?? r.status}</Selo>
                {r.origem === "portal" && <Selo cor="azul">portal</Selo>}
              </span>
            </Celula>
            <Celula>
              <span className="flex justify-end gap-2">
                {r.status === "pedida" && (
                  <>
                    <BotaoAcao acao={decidirReserva} id={`${r.id}|confirmada`} tamanho="sm" variante="primario">
                      <CalendarCheck className="size-3.5" /> Confirmar
                    </BotaoAcao>
                    <BotaoAcao acao={decidirReserva} id={`${r.id}|recusada`} tamanho="sm" confirmar="Recusar esta reserva?">
                      <CalendarX className="size-3.5" /> Recusar
                    </BotaoAcao>
                  </>
                )}
                {r.status === "confirmada" && !passadas && (
                  <BotaoAcao acao={decidirReserva} id={`${r.id}|cancelada`} tamanho="sm" variante="fantasma" confirmar="Cancelar esta reserva? O horário fica livre.">
                    Cancelar
                  </BotaoAcao>
                )}
                {!r.cota_item_id && <BotaoExcluir acao={excluirReserva} id={r.id} rotulo="Excluir reserva" confirmar="Excluir esta reserva?" />}
              </span>
            </Celula>
          </tr>
        ))}
        {lista.length === 0 && <LinhaVazia colunas={6}>{passadas ? "Nenhuma reserva passada." : "Nenhuma reserva marcada."}</LinhaVazia>}
      </Tabela>

      <div className="grid gap-4 lg:grid-cols-2">
        {areas.map((a) => (
          <Cartao key={a.id} titulo={a.nome} acoes={<BotaoExcluir acao={excluirArea} id={a.id} rotulo="Excluir área" confirmar={`Excluir ${a.nome}? As reservas dela saem junto.`} />}>
            <Formulario acao={salvarArea} automatico>
              <input type="hidden" name="id" value={a.id} />
              <input type="hidden" name="condominio_id" value={id} />
              <CamposArea a={a} />
              <Campo rotulo="Regras de uso">
                <AreaTexto name="regras" rows={2} defaultValue={a.regras ?? ""} />
              </Campo>
              <label className="flex items-center gap-2 text-sm text-texto-2">
                <input type="hidden" name="ativa" value="off" />
                <input type="checkbox" name="ativa" defaultChecked={a.ativa} className="size-4 accent-[var(--accent)]" /> Aceitando reservas
              </label>
            </Formulario>
          </Cartao>
        ))}
      </div>
      {areas.length === 0 && (
        <Cartao>
          <p className="text-sm text-mudo">Cadastre as áreas comuns (salão, churrasqueira, quadra…) para receber reservas — inclusive pelo portal do condômino.</p>
        </Cartao>
      )}
    </div>
  );
}
