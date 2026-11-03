import type { Metadata } from "next";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR } from "@/lib/dominio/datas";
import { ROTULO_CATEGORIA_CURTO, ROTULO_STATUS_CHAMADO } from "@/lib/dominio/manutencao";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { ConfirmarServico, FormChamado } from "./form";

export const metadata: Metadata = { title: "Pedir conserto", robots: { index: false } };

type Info = {
  organizacao: string;
  telefone: string | null;
  imovel: string;
  endereco: string | null;
  locatario: string;
  ativo: boolean;
  chamados: { id: string; numero: number; titulo: string; categoria: string; status: string; criado_em: string; agendado_para: string | null; concluido_em: string | null; garantia_ate: string | null; confirmado: boolean }[];
};

const COR: Record<string, string> = {
  concluido: "border-ok-bd bg-ok-bg text-ok",
  avaliado: "border-ok-bd bg-ok-bg text-ok",
  recusado: "border-borda bg-elev text-mudo",
  cancelado: "border-borda bg-elev text-mudo",
};

/** Página pública do locatário: abrir chamado de manutenção e acompanhar os chamados do contrato. */
export default async function ChamadoPublico({ params }: PageProps<"/chamado/[token]">) {
  const { token } = await params;
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await clienteAnonimo().rpc("info_chamado_link", { p_token: token }) : { data: null };
  const info = data as Info | null;

  return (
    <main className="min-h-screen bg-app px-4 py-8">
      <div className="mx-auto max-w-2xl space-y-5">
        {!info ? (
          <div className="rounded-card border border-borda bg-card p-8 text-center text-texto-2">Link inválido ou desativado. Peça um novo link à administração do imóvel.</div>
        ) : (
          <>
            <header className="rounded-card border border-borda bg-card p-5">
              <div className="text-sm text-mudo">{info.organizacao}</div>
              <h1 className="mt-1 text-[24px] font-semibold text-texto">Pedir conserto no imóvel</h1>
              <p className="mt-1 text-sm text-texto-2">
                {info.imovel}
                {info.endereco ? ` — ${info.endereco}` : ""}
              </p>
            </header>
            <section className="rounded-card border border-borda bg-card p-5">
              {info.ativo ? (
                <>
                  <h2 className="mb-1 text-[16px] font-semibold text-texto">{info.locatario ? `Olá, ${info.locatario}!` : "Olá!"} O que precisa de conserto?</h2>
                  <p className="mb-4 text-sm text-texto-2">Em caso de risco (gás, fogo, curto-circuito), saia do local e ligue para os bombeiros (193) antes de abrir o chamado.</p>
                  <FormChamado token={token} nomeInicial={info.locatario} />
                </>
              ) : (
                <p className="text-[15px] text-texto-2">Este contrato não está ativo. Fale com {info.organizacao}{info.telefone ? ` pelo telefone ${info.telefone}` : ""}.</p>
              )}
            </section>
            {info.chamados.length > 0 && (
              <section className="rounded-card border border-borda bg-card p-5">
                <h2 className="mb-3 text-[16px] font-semibold text-texto">Seus chamados</h2>
                <ul className="divide-y divide-borda-suave">
                  {info.chamados.map((c) => (
                    <li key={c.id} className="py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="font-medium text-texto">
                            #{c.numero} · {c.titulo}
                          </div>
                          <div className="text-xs text-mudo">
                            {ROTULO_CATEGORIA_CURTO[c.categoria] ?? c.categoria} · aberto em {formatarDataBR(diaLocal(c.criado_em))}
                            {c.agendado_para && !["concluido", "avaliado"].includes(c.status) ? ` · marcado para ${formatarDataBR(diaLocal(c.agendado_para))} às ${horaLocal(c.agendado_para)}` : ""}
                            {c.concluido_em ? ` · concluído em ${formatarDataBR(c.concluido_em)}` : ""}
                            {c.garantia_ate ? ` · garantia até ${formatarDataBR(c.garantia_ate)}` : ""}
                          </div>
                        </div>
                        <span className={`rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-bold ${COR[c.status] ?? "border-acento-bd bg-acento-bg text-acento-hot"}`}>{ROTULO_STATUS_CHAMADO[c.status] ?? c.status}</span>
                      </div>
                      {["agendado", "em_execucao", "concluido", "avaliado"].includes(c.status) && (
                        <div className="mt-2">{c.confirmado ? <p className="text-xs text-ok">Você confirmou que o serviço foi feito.</p> : <ConfirmarServico token={token} chamado={c.id} />}</div>
                      )}
                    </li>
                  ))}
                </ul>
              </section>
            )}
            <p className="text-center text-[11px] text-mudo">Este link é do seu contrato. Não compartilhe com outras pessoas.</p>
          </>
        )}
      </div>
    </main>
  );
}
