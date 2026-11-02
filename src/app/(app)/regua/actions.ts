"use server";

import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, ErroValidacao, mensagemErro } from "@/lib/form";

export interface AvisoRegua {
  id?: string;
  dias: number;
  quando: "antes" | "no_dia" | "depois";
  canal: "whatsapp" | "email";
  mensagem: string;
  ativo: boolean;
}

/** Nome automático do aviso: "3 dias antes", "No dia do vencimento", "5 dias depois". */
function nomeDoAviso(diasRelativos: number): string {
  if (diasRelativos === 0) return "No dia do vencimento";
  const n = Math.abs(diasRelativos);
  return `${n} ${n === 1 ? "dia" : "dias"} ${diasRelativos < 0 ? "antes" : "depois"}`;
}

/** Salva a régua inteira de uma vez: atualiza, cria e remove avisos. */
export async function salvarRegua(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const avisos = JSON.parse(String(fd.get("avisos") ?? "[]")) as AvisoRegua[];
    const linhas = avisos.map((a) => {
      const dias = a.quando === "no_dia" ? 0 : Math.max(1, Math.min(90, Math.round(Number(a.dias) || 1)));
      const rel = a.quando === "antes" ? -dias : a.quando === "depois" ? dias : 0;
      if (!a.mensagem.trim()) throw new ErroValidacao(`Escreva a mensagem do aviso "${nomeDoAviso(rel)}".`);
      return {
        id: a.id,
        nome: nomeDoAviso(rel),
        dias_relativos: rel,
        canal: a.canal === "whatsapp" ? "whatsapp" : "email",
        assunto: rel < 0 ? "Lembrete: seu aluguel vence em {{vencimento}}" : rel === 0 ? "Seu aluguel vence hoje" : "Aluguel em atraso",
        mensagem: a.mensagem.trim(),
        ativo: Boolean(a.ativo),
      };
    });
    const repetidos = linhas.map((l) => l.dias_relativos).filter((d, i, arr) => arr.indexOf(d) !== i);
    if (repetidos.length) throw new ErroValidacao(`Há dois avisos para "${nomeDoAviso(repetidos[0])}". Deixe só um.`);

    const { data: atuais, error: e1 } = await supabase.from("regua_regras").select("id, dias_relativos");
    if (e1) throw e1;
    // Aviso novo (sem id) que já foi gravado num salvamento automático anterior:
    // reaproveita a linha de mesmo dia em vez de apagar e criar de novo.
    const usados = new Set(linhas.filter((l) => l.id).map((l) => l.id));
    for (const l of linhas) {
      if (l.id) continue;
      const igual = (atuais ?? []).find((r) => r.dias_relativos === l.dias_relativos && !usados.has(r.id as string));
      if (igual) {
        l.id = igual.id as string;
        usados.add(l.id);
      }
    }
    const manter = new Set(linhas.filter((l) => l.id).map((l) => l.id));
    const remover = (atuais ?? []).map((r) => r.id as string).filter((id) => !manter.has(id));
    if (remover.length) {
      const r = await supabase.from("regua_regras").delete().in("id", remover);
      if (r.error) throw r.error;
    }
    for (const { id, ...dados } of linhas) {
      const r = id
        ? await supabase.from("regua_regras").update(dados).eq("id", id)
        : await supabase.from("regua_regras").insert(dados);
      if (r.error) throw r.error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/regua");
  return { ok: "Régua de cobrança salva." };
}

/** Marca um aviso como enviado (chamado ao clicar em "Enviar"). */
export async function marcarAvisoEnviado(dados: { regraId: string; faturaId: string; destinatario: string | null }) {
  const { supabase } = await obterContexto();
  const { error } = await supabase
    .from("regua_envios")
    .upsert(
      { regra_id: dados.regraId, fatura_id: dados.faturaId, destinatario: dados.destinatario, status: "enviado" },
      { onConflict: "regra_id,fatura_id", ignoreDuplicates: true },
    );
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidatePath("/regua");
  return { ok: true };
}
