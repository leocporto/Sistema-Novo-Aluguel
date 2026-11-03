"use client";

import { useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { Check, LoaderCircle, Mail, MessageCircle, Smartphone } from "lucide-react";
import { atualizarTelefone } from "@/app/(app)/pessoas/actions";
import { AbasSegmentadas } from "@/components/abas-segmentadas";
import { classeBotao, type VarianteBotao } from "@/components/ui";
import { linkEmail, linkSms } from "@/lib/dominio/cobrancas";
import { linkWhatsapp } from "@/lib/whatsapp";
import { registrarEnvio } from "./actions";

type Canal = "whatsapp" | "email" | "sms";

export interface DadosCobrar {
  faturaId: string;
  contratoId: string;
  pessoaId: string | null;
  nome: string;
  telefone: string | null;
  email: string | null;
  regraId: string | null;
  superados?: string[];
  canalInicial: Canal;
  /** Mensagem pronta (já com link da 2ª via e Pix). */
  mensagem: string;
  assunto: string;
  resumo: string;
  acordoId?: string | null;
}

const rotulo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";
const campo =
  "min-h-[46px] w-full rounded-btn border border-borda-forte bg-input px-3.5 text-[15px] text-texto outline-none focus:border-acento focus:ring-4 focus:ring-acento-bg";
const ICONE = { whatsapp: MessageCircle, email: Mail, sms: Smartphone };

/**
 * Cobrar/lembrar com mensagem pronta: abre o WhatsApp, o e-mail ou o SMS do
 * próprio aparelho com o texto (o envio sem clique depende de integração
 * contratada) e registra o envio no histórico de contatos.
 */
export function BotaoCobrar({ dados, rotuloBotao, variante = "primario" }: { dados: DadosCobrar; rotuloBotao?: string; variante?: VarianteBotao }) {
  const [aberta, setAberta] = useState(false);
  const [feito, setFeito] = useState(false);
  const [canal, setCanal] = useState<Canal>(dados.canalInicial);
  const [tel, setTel] = useState(dados.telefone ?? "");
  const [email, setEmail] = useState(dados.email ?? "");
  const [texto, setTexto] = useState(dados.mensagem);
  const [erro, setErro] = useState("");
  const [pendente, iniciar] = useTransition();
  const Icone = ICONE[canal];

  if (feito)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full border border-ok-bd bg-ok-bg px-3 py-1.5 text-xs font-semibold text-ok">
        <Check className="size-3.5" /> Aviso registrado
      </span>
    );

  const registrar = (abrir: boolean) => {
    setErro("");
    const dig = tel.replace(/\D/g, "");
    if (abrir && canal !== "email" && (dig.length < 10 || dig.length > 13)) return setErro("Digite o celular com DDD, ex.: (51) 98123-4567.");
    if (abrir && canal === "email" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setErro("Digite um e-mail válido.");
    if (!texto.trim()) return setErro("Escreva a mensagem.");
    if (abrir) {
      const link = canal === "whatsapp" ? linkWhatsapp(tel, texto) : canal === "sms" ? linkSms(tel, texto) : linkEmail(email, dados.assunto, texto);
      if (canal === "whatsapp") window.open(link, "_blank", "noopener");
      else window.location.href = link;
    }
    iniciar(async () => {
      if (canal !== "email" && dados.pessoaId && dig && (dados.telefone ?? "").replace(/\D/g, "") !== dig) await atualizarTelefone(dados.pessoaId, tel);
      const r = await registrarEnvio({
        faturaId: dados.faturaId,
        contratoId: dados.contratoId,
        pessoaId: dados.pessoaId,
        regraId: dados.regraId,
        superados: dados.superados,
        canal,
        destinatario: canal === "email" ? email.trim() : dig || null,
        mensagem: texto,
        acordoId: dados.acordoId ?? null,
      });
      if (!r.ok) setErro(r.erro ?? "Não foi possível registrar.");
      else {
        setAberta(false);
        setFeito(true);
      }
    });
  };

  return (
    <>
      <button type="button" onClick={() => setAberta(true)} className={classeBotao(variante, "sm")}>
        <Icone className="size-3.5" /> {rotuloBotao ?? "Cobrar"}
      </button>
      {aberta &&
        createPortal(
          <div
            className="janela-fundo fixed inset-0 z-[100] flex items-start justify-center overflow-y-auto bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px] sm:items-center"
            onMouseDown={(e) => {
              if (e.target === e.currentTarget && !pendente) setAberta(false);
            }}
          >
            <div role="dialog" aria-modal="true" aria-label={`Cobrar ${dados.nome}`} className="janela my-6 w-full max-w-lg rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]">
              <div className="mb-4 flex items-center gap-3">
                <span className="flex size-9 items-center justify-center rounded-[10px] border border-ok-bd bg-ok-bg text-ok">
                  <Icone className="size-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-texto">Mensagem para {dados.nome.split(" ")[0]}</h3>
                  <p className="truncate text-xs text-mudo">{dados.resumo}</p>
                </div>
              </div>
              <div className="mb-4">
                <AbasSegmentadas
                  variante="seg"
                  valor={canal}
                  aoMudar={(c) => setCanal(c as Canal)}
                  rotuloAcessivel="Canal do aviso"
                  itens={[
                    { id: "whatsapp", rotulo: "WhatsApp" },
                    { id: "email", rotulo: "E-mail" },
                    { id: "sms", rotulo: "SMS" },
                  ]}
                />
              </div>
              <div className="space-y-4">
                {canal === "email" ? (
                  <label className="flex flex-col gap-1.5">
                    <span className={rotulo}>E-mail</span>
                    <input value={email} onChange={(e) => setEmail(e.target.value)} inputMode="email" placeholder="nome@exemplo.com" className={campo} />
                  </label>
                ) : (
                  <label className="flex flex-col gap-1.5">
                    <span className={rotulo}>Celular</span>
                    <input value={tel} onChange={(e) => setTel(e.target.value)} inputMode="tel" placeholder="(51) 98123-4567" className={campo} />
                    {!dados.telefone && <span className="text-xs text-mudo">O número digitado fica salvo no cadastro do locatário.</span>}
                  </label>
                )}
                <label className="flex flex-col gap-1.5">
                  <span className={rotulo}>Mensagem (pode editar)</span>
                  <textarea rows={7} value={texto} onChange={(e) => setTexto(e.target.value)} className={`${campo} resize-y py-2.5 leading-relaxed`} />
                </label>
                <p className="text-xs text-mudo">
                  Abre o {canal === "whatsapp" ? "WhatsApp" : canal === "sms" ? "aplicativo de mensagens" : "seu programa de e-mail"} com o texto pronto. O envio sem clique fica pronto para ligar quando houver a integração (WhatsApp Business, SMS ou e-mail).
                </p>
                {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
              </div>
              <div className="mt-6 flex flex-wrap justify-end gap-2">
                <button type="button" className={classeBotao("secundario")} onClick={() => setAberta(false)} disabled={pendente}>
                  Cancelar
                </button>
                <button type="button" className={classeBotao("fantasma")} onClick={() => registrar(false)} disabled={pendente}>
                  Já enviei por fora
                </button>
                <button type="button" className={classeBotao("primario")} onClick={() => registrar(true)} disabled={pendente}>
                  {pendente ? <LoaderCircle className="size-4 animate-spin" /> : <Icone className="size-4" />}
                  {canal === "whatsapp" ? "Abrir no WhatsApp" : canal === "sms" ? "Abrir SMS" : "Abrir e-mail"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
