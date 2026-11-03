import type { Metadata } from "next";
import Link from "next/link";
import { AlarmClock, Inbox, Timer, TrendingUp, UserPlus } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Entrada, Indicador, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { FUNIS, ROTULO_FUNIL, horasAtePrimeiroAtendimento, textoHoras, type Funil } from "@/lib/dominio/crm";
import { agoraMs, hojeISO } from "@/lib/dominio/datas";
import { normalizar } from "@/lib/dominio/imoveis";
import { ROTULO_ORIGEM_LEAD, TIPOS_IMOVEL, type Lead } from "@/lib/tipos";
import { criarLead } from "./actions";
import { AbasComercial, CamposLead } from "./campos";
import { carregarOpcoes } from "./dados";
import { QuadroLeads, type CartaoLead } from "./quadro-leads";

export const metadata: Metadata = { title: "Leads" };

function haQuanto(iso: string, agora: number) {
  const dias = Math.floor((agora - new Date(iso).getTime()) / 86_400_000);
  if (dias <= 0) return "hoje";
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

export default async function LeadsPage({ searchParams }: PageProps<"/comercial">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const funil: Funil = FUNIS.includes(s("funil") as Funil) ? (s("funil") as Funil) : "locacao";
  const f = { corretor: s("corretor"), origem: s("origem"), prioridade: s("prioridade"), etiqueta: s("etiqueta"), ate: s("ate"), regiao: s("regiao"), tipo: s("tipo") };
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const agora = agoraMs();

  let consulta = supabase
    .from("leads")
    .select("*, corretor:pessoas!leads_corretor_id_fkey(nome), lead_imoveis(imovel_id)")
    .eq("funil", funil)
    .order("created_at", { ascending: false })
    .limit(800);
  if (f.corretor === "sem") consulta = consulta.is("corretor_id", null);
  else if (f.corretor) consulta = consulta.eq("corretor_id", f.corretor);
  if (f.origem) consulta = consulta.eq("origem", f.origem);
  if (f.prioridade) consulta = consulta.eq("prioridade", f.prioridade);
  if (f.etiqueta) consulta = consulta.contains("etiquetas", [f.etiqueta.toLowerCase()]);
  if (f.tipo) consulta = consulta.contains("tipos", [f.tipo]);
  const ate = Number(f.ate.replace(/\./g, "").replace(",", "."));
  if (f.ate && Number.isFinite(ate) && ate > 0) consulta = consulta.lte("orcamento_max", ate);

  const [{ data }, opcoes, { data: todasEtiquetas }] = await Promise.all([
    consulta,
    carregarOpcoes(supabase),
    supabase.from("leads").select("etiquetas").eq("funil", funil),
  ]);
  type L = Lead & { corretor: { nome: string } | null; lead_imoveis: { imovel_id: string }[] };
  let leads = (data ?? []) as unknown as L[];
  if (f.regiao) {
    const r = normalizar(f.regiao);
    leads = leads.filter((l) => normalizar(l.regioes).includes(r));
  }
  const etiquetas = [...new Set((todasEtiquetas ?? []).flatMap((x) => x.etiquetas as string[]))].sort();

  const novos = leads.filter((l) => l.status === "novo");
  const followUps = leads.filter((l) => l.proximo_contato && l.proximo_contato <= hoje && l.status !== "ganho" && l.status !== "perdido");
  const ultimos30 = leads.filter((l) => agora - new Date(l.created_at).getTime() < 30 * 86_400_000);
  const horas = ultimos30.map((l) => horasAtePrimeiroAtendimento(l.created_at, l.atendido_em)).filter((h): h is number => h !== null);
  const media = horas.length ? horas.reduce((a, b) => a + b, 0) / horas.length : null;
  const ganhos = leads.filter((l) => l.status === "ganho").length;
  const perdidos = leads.filter((l) => l.status === "perdido").length;

  const cartoes: CartaoLead[] = leads.map((l) => ({
    id: l.id,
    nome: l.nome,
    telefone: l.telefone,
    status: l.status,
    origem: l.origem,
    prioridade: l.prioridade,
    etiquetas: l.etiquetas ?? [],
    orcamento_max: l.orcamento_max == null ? null : Number(l.orcamento_max),
    corretor: l.corretor?.nome.split(" ")[0] ?? null,
    imoveis: l.lead_imoveis.length,
    proximo_contato: l.proximo_contato,
    horasEsperando: l.status === "novo" && !l.atendido_em ? (agora - new Date(l.created_at).getTime()) / 3_600_000 : null,
    chegou: haQuanto(l.created_at, agora),
  }));

  return (
    <>
      <Cabecalho
        titulo="Leads"
        trilha="Comercial"
        descricao="Do primeiro contato ao negócio fechado. Arraste os cartões entre as etapas."
        acoes={
          <JanelaCadastro rotuloBotao={<><UserPlus className="size-4" /> Novo lead</>} titulo="Novo lead" acao={criarLead} icone={<UserPlus />} larguraMax="max-w-2xl">
            <CamposLead imoveis={opcoes.imoveis} corretores={opcoes.corretores} funilPadrao={funil} />
          </JanelaCadastro>
        }
      />
      <AbasComercial />

      <div className="mb-5 flex flex-wrap gap-2">
        {FUNIS.map((x) => (
          <Link
            key={x}
            href={x === "locacao" ? "/comercial" : `/comercial?funil=${x}`}
            className={`rounded-full px-4 py-2 text-sm font-semibold transition ${x === funil ? "bg-acento text-white" : "border border-borda bg-card text-texto-2 hover:border-borda-forte"}`}
          >
            Funil de {ROTULO_FUNIL[x].toLowerCase()}
          </Link>
        ))}
      </div>

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador
          rotulo="Aguardando atendimento"
          icone={<Inbox />}
          valor={<Contador valor={novos.length} />}
          tom={novos.length ? "alerta" : "sucesso"}
          detalhe={novos.length ? `o mais antigo chegou ${haQuanto(novos[novos.length - 1].created_at, agora)}` : "ninguém esperando"}
        />
        <Indicador
          rotulo="Tempo até o 1º atendimento"
          icone={<Timer />}
          valor={textoHoras(media)}
          detalhe="média dos últimos 30 dias"
          tom={media !== null && media > 24 ? "perigo" : media !== null && media > 2 ? "alerta" : "sucesso"}
        />
        <Indicador
          rotulo="Retornos para hoje"
          icone={<AlarmClock />}
          valor={<Contador valor={followUps.length} />}
          detalhe="follow-ups vencidos ou de hoje"
          tom={followUps.length ? "alerta" : "neutro"}
        />
        <Indicador
          rotulo="Conversão do funil"
          icone={<TrendingUp />}
          valor={ganhos + perdidos ? `${Math.round((ganhos / (ganhos + perdidos)) * 100)}%` : "—"}
          detalhe={`${ganhos} fechado(s) · ${perdidos} perdido(s)`}
          href="/comercial/conversao"
        />
      </div>

      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        {funil !== "locacao" && <input type="hidden" name="funil" value={funil} />}
        <Selecao name="corretor" defaultValue={f.corretor} className="w-48">
          <option value="">Todos os corretores</option>
          <option value="sem">Sem corretor</option>
          {opcoes.corretores.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Selecao>
        <Selecao name="origem" defaultValue={f.origem} className="w-44">
          <option value="">Todas as origens</option>
          {Object.entries(ROTULO_ORIGEM_LEAD).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Selecao>
        <Selecao name="prioridade" defaultValue={f.prioridade} className="w-40">
          <option value="">Toda prioridade</option>
          <option value="quente">🔥 Quente</option>
          <option value="morno">Morno</option>
          <option value="frio">Frio</option>
        </Selecao>
        <Selecao name="tipo" defaultValue={f.tipo} className="w-44 capitalize">
          <option value="">Todo tipo de imóvel</option>
          {TIPOS_IMOVEL.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Selecao>
        {etiquetas.length > 0 && (
          <Selecao name="etiqueta" defaultValue={f.etiqueta} className="w-40">
            <option value="">Toda etiqueta</option>
            {etiquetas.map((t) => (
              <option key={t} value={t}>
                #{t}
              </option>
            ))}
          </Selecao>
        )}
        <Entrada name="regiao" defaultValue={f.regiao} placeholder="Bairro/cidade" className="max-w-44" />
        <Entrada name="ate" defaultValue={f.ate} placeholder="Orçamento até R$" inputMode="decimal" className="max-w-48" />
      </FiltroAutomatico>

      <QuadroLeads funil={funil} leads={cartoes} hoje={hoje} />
    </>
  );
}
