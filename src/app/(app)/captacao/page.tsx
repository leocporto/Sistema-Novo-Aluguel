import type { Metadata } from "next";
import { CalendarClock, Home, ShieldCheck, Target, TrendingUp } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BarraProgresso } from "@/components/barra-progresso";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Cabecalho, Entrada, Indicador, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { CHECKLIST_CAPTACAO, ORIGENS_CAPTACAO, progressoChecklist } from "@/lib/dominio/captacao";
import { agoraMs, fimDoMes, hojeISO, inicioDoMes } from "@/lib/dominio/datas";
import { normalizar } from "@/lib/dominio/imoveis";
import { criarCaptacao } from "./actions";
import { AbasCaptacao, CamposImovelPreliminar, CamposProprietario, type Captacao } from "./campos";
import { carregarCorretores, haQuanto } from "./dados";
import { QuadroCaptacao, type CartaoCaptacao } from "./quadro-captacao";

export const metadata: Metadata = { title: "Captação de imóveis" };

export default async function CaptacaoPage({ searchParams }: PageProps<"/captacao">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const f = { corretor: s("corretor"), origem: s("origem"), busca: s("busca") };
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const agora = agoraMs();
  const ini = inicioDoMes(hoje);
  const fim = fimDoMes(hoje);

  let consulta = supabase
    .from("captacoes")
    .select("*, corretor:pessoas!captacoes_corretor_id_fkey(nome)")
    .order("created_at", { ascending: false })
    .limit(800);
  if (f.corretor === "sem") consulta = consulta.is("corretor_id", null);
  else if (f.corretor) consulta = consulta.eq("corretor_id", f.corretor);
  if (f.origem) consulta = consulta.eq("origem", f.origem);

  const [{ data }, corretores, { data: captadosMes }, { data: meta }, { data: avaliacoes }] = await Promise.all([
    consulta,
    carregarCorretores(supabase),
    supabase.from("imoveis").select("id").gte("captado_em", ini).lte("captado_em", fim),
    supabase.from("metas").select("valor").eq("competencia", ini).eq("tipo", "captacoes").maybeSingle(),
    supabase.from("visitas").select("id").eq("tipo", "avaliacao").eq("status", "agendada").gte("data_hora", `${hoje}T00:00:00-03:00`),
  ]);
  type C = Captacao & { corretor: { nome: string } | null };
  let lista = (data ?? []) as unknown as C[];
  if (f.busca) {
    const b = normalizar(f.busca);
    lista = lista.filter((c) => normalizar([c.proprietario_nome, c.proprietario_telefone, c.logradouro, c.bairro, c.cidade, String(c.numero)].join(" ")).includes(b));
  }

  const abertas = lista.filter((c) => c.status !== "captado" && c.status !== "nao_captado");
  const captadas = lista.filter((c) => c.status === "captado").length;
  const naoCaptadas = lista.filter((c) => c.status === "nao_captado").length;
  const exclusivos = abertas.filter((c) => c.exclusivo && (!c.exclusividade_fim || c.exclusividade_fim >= hoje)).length;
  const valorMeta = meta?.valor ? Number(meta.valor) : null;
  const noMes = captadosMes?.length ?? 0;

  const cartoes: CartaoCaptacao[] = lista.map((c) => ({
    id: c.id,
    numero: c.numero,
    nome: c.proprietario_nome,
    telefone: c.proprietario_telefone,
    status: c.status,
    origem: c.origem,
    resumo: [c.tipo, c.quartos ? `${c.quartos} qto(s)` : null, c.area ? `${Number(c.area)} m²` : null, c.bairro].filter(Boolean).join(" · "),
    valor: c.valor_avaliado_aluguel ?? c.valor_avaliado_venda ?? c.valor_pretendido ?? null,
    corretor: c.corretor?.nome.split(" ")[0] ?? null,
    docs: progressoChecklist(c.checklist).feitos,
    docsTotal: CHECKLIST_CAPTACAO.length,
    exclusivo: c.exclusivo,
    chegou: haQuanto(c.created_at, agora),
  }));

  return (
    <>
      <Cabecalho
        titulo="Captação de imóveis"
        trilha="Comercial"
        descricao="Do primeiro contato com o proprietário ao imóvel ativo na carteira. Arraste os cartões entre as etapas."
        acoes={
          <JanelaCadastro rotuloBotao={<><Home className="size-4" /> Nova captação</>} titulo="Nova oportunidade de captação" acao={criarCaptacao} icone={<Home />} larguraMax="max-w-2xl">
            <CamposProprietario corretores={corretores} novo />
            <CamposImovelPreliminar />
          </JanelaCadastro>
        }
      />
      <AbasCaptacao />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Indicador rotulo="Em andamento" icone={<TrendingUp />} valor={<Contador valor={abertas.length} />} detalhe="oportunidades abertas" />
        <Indicador
          rotulo="Captados no mês"
          icone={<Target />}
          valor={<Contador valor={noMes} />}
          tom={valorMeta && noMes >= valorMeta ? "sucesso" : "neutro"}
          detalhe={
            valorMeta ? (
              <span className="block">
                <BarraProgresso pct={(noMes / valorMeta) * 100} atingida={noMes >= valorMeta} />
                <span className="mt-1 block">meta: {valorMeta}</span>
              </span>
            ) : (
              "sem meta definida (Comercial › Metas)"
            )
          }
          href="/captacao/relatorio"
        />
        <Indicador
          rotulo="Taxa de captação"
          icone={<ShieldCheck />}
          valor={captadas + naoCaptadas ? `${Math.round((captadas / (captadas + naoCaptadas)) * 100)}%` : "—"}
          detalhe={`${captadas} captado(s) · ${naoCaptadas} não captado(s) · ${exclusivos} exclusivo(s) em aberto`}
        />
        <Indicador
          rotulo="Avaliações agendadas"
          icone={<CalendarClock />}
          valor={<Contador valor={avaliacoes?.length ?? 0} />}
          detalhe="visitas de avaliação a fazer"
          href="/comercial/visitas"
          tom={avaliacoes?.length ? "alerta" : "neutro"}
        />
      </div>

      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Entrada name="busca" defaultValue={f.busca} placeholder="Buscar proprietário, endereço, nº…" className="max-w-72" />
        <Selecao name="corretor" defaultValue={f.corretor} className="w-48">
          <option value="">Todos os corretores</option>
          <option value="sem">Sem corretor</option>
          {corretores.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </Selecao>
        <Selecao name="origem" defaultValue={f.origem} className="w-48">
          <option value="">Todas as origens</option>
          {Object.entries(ORIGENS_CAPTACAO).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Selecao>
      </FiltroAutomatico>

      <QuadroCaptacao itens={cartoes} />
    </>
  );
}
