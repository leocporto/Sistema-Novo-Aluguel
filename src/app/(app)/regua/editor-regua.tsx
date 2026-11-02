"use client";

import { useRef, useState } from "react";
import { Mail, MessageCircle, Plus, Trash2 } from "lucide-react";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { classeBotao } from "@/components/ui";
import { salvarRegua, type AvisoRegua } from "./actions";

const VARIAVEIS = [
  ["{{nome}}", "Nome"],
  ["{{valor}}", "Valor"],
  ["{{vencimento}}", "Vencimento"],
  ["{{competencia}}", "Mês"],
  ["{{imovel}}", "Imóvel"],
] as const;

const MODELOS: Record<AvisoRegua["quando"], string> = {
  antes: "Olá {{nome}}! Lembrete: o aluguel de {{competencia}} ({{valor}}) vence em {{vencimento}}.",
  no_dia: "Olá {{nome}}! Seu aluguel de {{valor}} vence hoje ({{vencimento}}).",
  depois: "Olá {{nome}}, não identificamos o pagamento do aluguel de {{competencia}} ({{valor}}), vencido em {{vencimento}}. Se já pagou, desconsidere.",
};

function ordem(a: AvisoRegua) {
  return a.quando === "antes" ? -a.dias : a.quando === "depois" ? a.dias : 0;
}

/** Editor da régua: uma linha do tempo de avisos, salva tudo de uma vez. */
export function EditorRegua({ inicial }: { inicial: AvisoRegua[] }) {
  const [avisos, setAvisos] = useState<AvisoRegua[]>(inicial);
  const [aberto, setAberto] = useState<number | null>(null);
  const textos = useRef<(HTMLTextAreaElement | null)[]>([]);

  const mudar = (i: number, parte: Partial<AvisoRegua>) =>
    setAvisos((lista) => lista.map((a, k) => (k === i ? { ...a, ...parte } : a)));

  const inserirVariavel = (i: number, token: string) => {
    const el = textos.current[i];
    const atual = avisos[i].mensagem;
    const ini = el?.selectionStart ?? atual.length;
    const fim = el?.selectionEnd ?? atual.length;
    mudar(i, { mensagem: atual.slice(0, ini) + token + atual.slice(fim) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(ini + token.length, ini + token.length);
    });
  };

  const adicionar = () => {
    const ultimo = avisos.length ? Math.max(...avisos.map(ordem)) : 0;
    const dias = Math.max(1, ultimo + 3);
    setAvisos((l) => [...l, { dias, quando: "depois", canal: "whatsapp", mensagem: MODELOS.depois, ativo: true }]);
    setAberto(avisos.length);
  };

  const ordenados = avisos.map((a, i) => ({ a, i })).sort((x, y) => ordem(x.a) - ordem(y.a));

  return (
    <Formulario acao={salvarRegua} className="space-y-4">
      <input type="hidden" name="avisos" value={JSON.stringify(avisos)} />

      <ol className="relative space-y-3 before:absolute before:bottom-6 before:left-[19px] before:top-6 before:w-px before:bg-borda">
        {ordenados.map(({ a, i }) => {
          const cor = a.quando === "antes" ? "bg-acento" : a.quando === "no_dia" ? "bg-alerta" : "bg-ruim";
          return (
            <li key={a.id ?? `novo-${i}`} className="relative flex gap-4">
              <span className={`relative z-10 mt-4 flex size-10 shrink-0 items-center justify-center rounded-full text-white ${a.ativo ? cor : "bg-fraco"}`}>
                {a.canal === "whatsapp" ? <MessageCircle className="size-[18px]" /> : <Mail className="size-[18px]" />}
              </span>
              <div className={`flex-1 rounded-card border border-borda bg-card p-4 transition ${a.ativo ? "" : "opacity-60"}`}>
                <div className="flex flex-wrap items-center gap-2 text-[14.5px]">
                  <span className="text-texto-2">Avisar</span>
                  {a.quando !== "no_dia" && (
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={a.dias}
                      onChange={(e) => mudar(i, { dias: Number(e.target.value) })}
                      className="h-10 w-16 rounded-btn border border-borda-forte bg-input px-2 text-center font-semibold"
                      aria-label="Quantidade de dias"
                    />
                  )}
                  <select
                    value={a.quando}
                    onChange={(e) => mudar(i, { quando: e.target.value as AvisoRegua["quando"] })}
                    className="h-10 rounded-btn border border-borda-forte bg-input pl-3 font-semibold"
                    aria-label="Quando"
                  >
                    <option value="antes">{a.dias === 1 ? "dia" : "dias"} antes do vencimento</option>
                    <option value="no_dia">no dia do vencimento</option>
                    <option value="depois">{a.dias === 1 ? "dia" : "dias"} depois (atraso)</option>
                  </select>
                  <span className="text-texto-2">por</span>
                  <select
                    value={a.canal}
                    onChange={(e) => mudar(i, { canal: e.target.value as AvisoRegua["canal"] })}
                    className="h-10 rounded-btn border border-borda-forte bg-input pl-3 font-semibold"
                    aria-label="Canal"
                  >
                    <option value="whatsapp">WhatsApp</option>
                    <option value="email">E-mail</option>
                  </select>

                  <div className="ml-auto flex items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-2 text-[13px] text-texto-2">
                      <span className="relative inline-flex">
                        <input
                          type="checkbox"
                          className="peer sr-only"
                          checked={a.ativo}
                          onChange={(e) => mudar(i, { ativo: e.target.checked })}
                        />
                        <span className="h-6 w-11 rounded-full bg-borda-forte transition peer-checked:bg-ok" />
                        <span className="absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition peer-checked:translate-x-5" />
                      </span>
                      {a.ativo ? "Ligado" : "Desligado"}
                    </label>
                    <button
                      type="button"
                      onClick={() => setAberto(aberto === i ? null : i)}
                      className={classeBotao("fantasma", "sm")}
                    >
                      {aberto === i ? "Fechar mensagem" : "Editar mensagem"}
                    </button>
                    <button
                      type="button"
                      title="Remover aviso"
                      aria-label="Remover aviso"
                      onClick={() => {
                        setAvisos((l) => l.filter((_, k) => k !== i));
                        setAberto(null);
                      }}
                      className="grid size-[34px] place-items-center rounded-[9px] text-mudo transition hover:bg-ruim-bg hover:text-ruim"
                    >
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                </div>

                {aberto === i ? (
                  <div className="mt-3 space-y-2">
                    <textarea
                      ref={(el) => {
                        textos.current[i] = el;
                      }}
                      rows={3}
                      value={a.mensagem}
                      onChange={(e) => mudar(i, { mensagem: e.target.value })}
                      className="w-full rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[14.5px] outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg"
                    />
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-mudo">
                      Inserir:
                      {VARIAVEIS.map(([token, rotulo]) => (
                        <button
                          key={token}
                          type="button"
                          onClick={() => inserirVariavel(i, token)}
                          className="rounded-full border border-acento-bd bg-acento-bg px-2.5 py-1 font-medium text-acento-hot hover:opacity-80"
                        >
                          + {rotulo}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 line-clamp-1 text-[13px] text-mudo">{a.mensagem.replace(/\{\{\s*(\w+)\s*\}\}/g, "[$1]")}</p>
                )}
              </div>
            </li>
          );
        })}
      </ol>

      {avisos.length === 0 && <p className="text-sm text-mudo">Nenhum aviso. Adicione o primeiro abaixo.</p>}

      <div className="flex flex-wrap justify-between gap-2">
        <button type="button" onClick={adicionar} className={classeBotao("secundario")}>
          <Plus className="size-4" /> Adicionar aviso
        </button>
        <BotaoEnviar>Salvar régua</BotaoEnviar>
      </div>
    </Formulario>
  );
}
