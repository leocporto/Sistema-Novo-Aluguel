import "server-only";
import {
  DIAS_GUARDA_ARQUIVOS,
  ehRelatorioPadrao,
  nomeArquivo,
  periodoAnterior,
  periodoRelativo,
  tabelaParaCSV,
  tabelaParaXLS,
  type TabelaRelatorio,
} from "@/lib/dominio/bi";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { mensagemErro } from "@/lib/form";
import { enviarEmail, escaparHtml } from "@/lib/servicos/email";
import type { Organizacao } from "@/lib/tipos";
import { funcaoAusente, type Agendamento, type Supabase } from "./dados";
import { montarPersonalizado, montarRelatorio } from "./tabelas";

type Ctx = { supabase: Supabase; organizacao: Pick<Organizacao, "id" | "nome" | "modo"> };

/**
 * Gera os envios programados que já venceram (ou um só, com `id`: "rodar
 * agora"). O banco "pega" os vencidos de forma atômica
 * (relatorio_agendamentos_vez) e já marca a próxima execução; aqui o arquivo
 * é montado, guardado no bucket privado "relatorios" (<org>/<agendamento>/) e,
 * se houver provedor de e-mail (RESEND_API_KEY), enviado com o arquivo anexo.
 * Sem provedor, a execução fica "pronta para enviar" (link e WhatsApp na tela).
 * Os arquivos ficam guardados por DIAS_GUARDA_ARQUIVOS dias (limparArquivosVencidos).
 */
export async function processarAgendamentos(ctx: Ctx, opcoes: { id?: string; limite?: number } = {}): Promise<{ gerados: number; erros: number }> {
  const { data, error } = await ctx.supabase.rpc("relatorio_agendamentos_vez", { p_limite: opcoes.limite ?? 3, p_id: opcoes.id ?? null });
  if (error) {
    if (funcaoAusente(error)) return { gerados: 0, erros: 0 };
    throw new Error(error.message);
  }
  let gerados = 0;
  let erros = 0;
  for (const ag of (Array.isArray(data) ? data : []) as Agendamento[]) {
    const ok = await gerarEnvio(ctx, ag, opcoes.id ? "manual" : "agendada");
    if (ok) gerados++;
    else erros++;
  }
  // No "relógio" (sem id), aproveita para apagar os arquivos que passaram do prazo de guarda.
  if (!opcoes.id) await limparArquivosVencidos(ctx.supabase).catch(() => 0);
  return { gerados, erros };
}

async function gerarEnvio(ctx: Ctx, ag: Agendamento, origem: "manual" | "agendada"): Promise<boolean> {
  const { supabase, organizacao } = ctx;
  const hoje = hojeISO();
  const imob = organizacao.modo !== "pessoal";
  const destinatarios = { emails: ag.emails ?? [], whatsapps: ag.whatsapps ?? [] };
  let periodoTxt = "";
  let guardado: string | null = null;
  try {
    let tabela: TabelaRelatorio;
    if (ag.relatorio_id) {
      tabela = await montarPersonalizado(supabase, ag.relatorio_id);
      periodoTxt = `gerado em ${formatarDataBR(hoje)}`;
    } else if (ehRelatorioPadrao(ag.padrao)) {
      const per = periodoRelativo(ag.periodo, hoje);
      tabela = await montarRelatorio(supabase, ag.padrao, { periodo: per, anterior: periodoAnterior("int", per.inicio, per.fim, hoje), imob, hoje });
      periodoTxt = per.rotulo;
    } else {
      throw new Error("Relatório do envio não encontrado.");
    }
    const xls = ag.formato === "xls";
    const conteudo = xls ? tabelaParaXLS(tabela) : tabelaParaCSV(tabela);
    const tipo = xls ? "application/vnd.ms-excel" : "text/csv";
    const arquivo = nomeArquivo(ag.nome, hoje, xls ? "xls" : "csv");
    const caminho = `${organizacao.id}/${ag.id}/${Date.now()}-${arquivo}`;
    const up = await supabase.storage.from("relatorios").upload(caminho, new Blob([conteudo], { type: `${tipo};charset=utf-8` }), { contentType: tipo, upsert: false });
    if (up.error) throw new Error(`Não foi possível guardar o arquivo: ${up.error.message}`);
    guardado = caminho;

    let status: "enviado" | "pronto_para_enviar" = "pronto_para_enviar";
    let erroEnvio: string | null = null;
    if (destinatarios.emails.length) {
      const { data: link } = await supabase.storage.from("relatorios").createSignedUrl(caminho, 7 * 24 * 3600);
      const r = await enviarEmail({
        para: destinatarios.emails,
        assunto: `${ag.nome} — ${periodoTxt}`,
        html: `<p>Olá!</p><p>Segue o relatório <strong>${escaparHtml(ag.nome)}</strong> (${escaparHtml(periodoTxt)}) de ${escaparHtml(organizacao.nome)}, com ${tabela.linhas.length} linha(s), no anexo.</p>${
          link?.signedUrl ? `<p>Se preferir, baixe pelo link (vale por 7 dias): <a href="${escaparHtml(link.signedUrl)}">baixar relatório</a></p>` : ""
        }<p style="color:#828d9b;font-size:12px">Envio programado no Novo Aluguel.</p>`,
        anexos: [{ nome: arquivo, conteudo, tipo }],
      });
      if (r.ok) status = "enviado";
      else if (r.configurado) erroEnvio = r.erro ?? "Falha no envio do e-mail.";
    }
    // A execução só é gravada pelo banco (relatorio_registrar_execucao), logo depois da "vez".
    const { error } = await supabase.rpc("relatorio_registrar_execucao", {
      p_agendamento: ag.id,
      p: {
        origem,
        status,
        formato: xls ? "xls" : "csv",
        linhas: tabela.linhas.length,
        resumo: `${tabela.linhas.length} linha(s) · ${periodoTxt}`,
        arquivo_path: caminho,
        periodo: periodoTxt,
        erro: erroEnvio,
      },
    });
    if (error) throw new Error(error.message);
    return true;
  } catch (e) {
    await supabase.rpc("relatorio_registrar_execucao", {
      p_agendamento: ag.id,
      // Se o arquivo chegou a ser guardado, fica ligado à execução (para baixar e para o prazo de guarda).
      p: { origem, status: "erro", formato: ag.formato === "xls" ? "xls" : "csv", periodo: periodoTxt, erro: mensagemErro(e), arquivo_path: guardado },
    });
    return false;
  }
}

/**
 * Prazo de guarda (LGPD): apaga do Storage os arquivos de envios com mais de
 * DIAS_GUARDA_ARQUIVOS dias e marca a execução (relatorio_marcar_arquivos_apagados).
 * Roda junto com os envios, em segundo plano; erro aqui não atrapalha nada.
 */
export async function limparArquivosVencidos(supabase: Supabase, limite = 50): Promise<number> {
  const corte = new Date(Date.now() - DIAS_GUARDA_ARQUIVOS * 86_400_000).toISOString();
  const { data, error } = await supabase
    .from("relatorio_execucoes")
    .select("id, arquivo_path")
    .not("arquivo_path", "is", null)
    .is("arquivo_apagado_em", null)
    .lt("data", corte)
    .order("data")
    .limit(limite);
  if (error || !data?.length) return 0;
  return apagarArquivos(supabase, data as { id: string; arquivo_path: string }[]);
}

/** Tira os arquivos do Storage e marca as execuções (só as que saíram de fato). */
export async function apagarArquivos(supabase: Supabase, execucoes: { id: string; arquivo_path: string | null }[]): Promise<number> {
  const com = execucoes.filter((e): e is { id: string; arquivo_path: string } => !!e.arquivo_path);
  if (!com.length) return 0;
  const { error } = await supabase.storage.from("relatorios").remove(com.map((e) => e.arquivo_path));
  if (error) throw new Error(`Não foi possível apagar o arquivo: ${error.message}`);
  const { data, error: e2 } = await supabase.rpc("relatorio_marcar_arquivos_apagados", { p_ids: com.map((e) => e.id) });
  if (e2) throw new Error(e2.message);
  return Number(data) || 0;
}
