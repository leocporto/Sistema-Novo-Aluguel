"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CalendarCheck, Check, ChevronLeft, ChevronRight, Heart, ImageIcon, Maximize2, MessageCircle, Scale, X } from "lucide-react";
import { AbasSegmentadas } from "@/components/abas-segmentadas";
import { AreaTexto, Campo, Entrada, Selecao, classeBotao } from "@/components/ui";
import { MAX_COMPARAR, MAX_FAVORITOS, alternarNaLista, horariosVisita, lerCodigos } from "@/lib/dominio/site";
import { TIPOS_IMOVEL } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import { enviarContatoSite } from "./actions";
import { gravarLista, lerLista, useLista, useNoNavegador, type TipoLista } from "./listas";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
}

const botaoIcone =
  "grid size-9 shrink-0 place-items-center rounded-full border border-borda bg-card/95 text-texto-2 shadow-sm transition duration-150 hover:-translate-y-px hover:text-ruim active:scale-90";

/** Coração do anúncio: guarda o imóvel nos favoritos (no navegador). */
export function BotaoFavorito({ slug, codigo, comTexto = false }: { slug: string; codigo: string; comTexto?: boolean }) {
  const lista = useLista(slug, "favoritos");
  const ativo = lista.includes(codigo);
  const alternar = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    gravarLista(slug, "favoritos", alternarNaLista(lerLista(slug, "favoritos"), codigo, MAX_FAVORITOS));
  };
  if (comTexto)
    return (
      <button type="button" onClick={alternar} className={classeBotao("secundario")} aria-pressed={ativo}>
        <Heart className={`size-4 ${ativo ? "fill-ruim text-ruim" : ""}`} /> {ativo ? "Nos favoritos" : "Favoritar"}
      </button>
    );
  return (
    <button type="button" onClick={alternar} className={botaoIcone} aria-pressed={ativo} aria-label={ativo ? "Tirar dos favoritos" : "Guardar nos favoritos"} title={ativo ? "Tirar dos favoritos" : "Guardar nos favoritos"}>
      <Heart className={`size-4 ${ativo ? "fill-ruim text-ruim" : ""}`} />
    </button>
  );
}

/** Põe/tira o imóvel da comparação (até 4). */
export function BotaoComparar({ slug, codigo, tamanho = "sm" }: { slug: string; codigo: string; tamanho?: "sm" | "md" }) {
  const lista = useLista(slug, "comparar");
  const ativo = lista.includes(codigo);
  return (
    <button
      type="button"
      aria-pressed={ativo}
      className={classeBotao(ativo ? "primario" : "secundario", tamanho)}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const atual = lerLista(slug, "comparar");
        if (!atual.includes(codigo) && atual.length >= MAX_COMPARAR) {
          window.alert(`Dá para comparar até ${MAX_COMPARAR} imóveis. Tire um da comparação antes.`);
          return;
        }
        gravarLista(slug, "comparar", alternarNaLista(atual, codigo, MAX_COMPARAR));
      }}
    >
      {ativo ? <Check className="size-3.5" /> : <Scale className="size-3.5" />} {ativo ? "Comparando" : "Comparar"}
    </button>
  );
}

/** Coração do topo com quantos favoritos o visitante tem. */
export function ContadorFavoritos({ slug, base }: { slug: string; base: string }) {
  const n = useLista(slug, "favoritos").length;
  return (
    <Link href={`${base}/favoritos`} className="relative grid size-10 place-items-center rounded-full border border-borda bg-card text-texto-2 transition hover:-translate-y-px hover:text-ruim" aria-label={`Favoritos (${n})`} title="Favoritos">
      <Heart className={`size-[18px] ${n ? "fill-ruim text-ruim" : ""}`} />
      {n > 0 && <span className="absolute -right-1 -top-1 min-w-[18px] rounded-full bg-ruim px-1 text-center text-[10.5px] font-bold leading-[18px] text-white">{n}</span>}
    </Link>
  );
}

/** Barra fixa embaixo quando há imóveis para comparar. */
export function BarraComparar({ slug, base }: { slug: string; base: string }) {
  const lista = useLista(slug, "comparar");
  if (!lista.length) return null;
  return (
    <div className="fixed bottom-24 left-1/2 z-40 flex -translate-x-1/2 items-center gap-2 rounded-full sm:bottom-5 border border-borda bg-card px-3 py-2 shadow-[0_16px_40px_-16px_rgba(0,0,0,.4)]">
      <Scale className="size-4 text-acento" />
      <span className="text-sm text-texto">
        {lista.length} para comparar
      </span>
      <Link href={`${base}/comparar?c=${encodeURIComponent(lista.join(","))}`} className={classeBotao("primario", "sm")}>
        Comparar
      </Link>
      <button type="button" className={classeBotao("fantasma", "sm")} onClick={() => gravarLista(slug, "comparar", [])}>
        Limpar
      </button>
    </div>
  );
}

/**
 * Favoritos e comparação: a página é montada no servidor pelos códigos da URL
 * (?c=…). Este componente põe na URL o que está guardado no navegador e
 * acompanha quando o visitante tira um imóvel.
 */
export function SincronizarLista({ slug, tipo, atual, maximo }: { slug: string; tipo: TipoLista; atual: string[]; maximo: number }) {
  const lista = useLista(slug, tipo);
  const noNavegador = useNoNavegador();
  const router = useRouter();
  const anterior = useRef<string | null>(null);
  const chaveLista = lerCodigos(lista, maximo).join(",");
  const chaveAtual = atual.join(",");
  useEffect(() => {
    if (!noNavegador) return;
    const antes = anterior.current;
    anterior.current = chaveLista;
    const ir = () => router.replace(chaveLista ? `?c=${encodeURIComponent(chaveLista)}` : "?", { scroll: false });
    // Primeira vez: só completa a URL se ela veio vazia (link compartilhado continua valendo).
    if (antes === null) {
      if (!chaveAtual && chaveLista) ir();
      return;
    }
    if (antes !== chaveLista && chaveLista !== chaveAtual) ir();
  }, [noNavegador, chaveLista, chaveAtual, router]);
  return null;
}

/** Galeria de fotos com miniaturas e tela cheia (setas do teclado e Esc). */
export function Galeria({ fotos, titulo }: { fotos: { url: string; nome?: string | null }[]; titulo: string }) {
  const [i, setI] = useState(0);
  const [cheia, setCheia] = useState(false);
  const total = fotos.length;
  const ir = (passo: number) => setI((v) => (v + passo + total) % total);
  useEffect(() => {
    if (!cheia) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") setCheia(false);
      if (e.key === "ArrowRight") setI((v) => (v + 1) % total);
      if (e.key === "ArrowLeft") setI((v) => (v - 1 + total) % total);
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, [cheia, total]);
  if (!total)
    return (
      <div className="grid aspect-[16/9] place-items-center rounded-card border border-borda bg-elev text-mudo">
        <span className="flex flex-col items-center gap-2 text-sm">
          <ImageIcon className="size-8" /> Fotos em breve
        </span>
      </div>
    );
  const atual = fotos[i];
  const seta = "absolute top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/45 text-white backdrop-blur transition hover:bg-black/65 active:scale-90";
  return (
    <div className="space-y-2">
      <div className="relative overflow-hidden rounded-card border border-borda bg-elev">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={atual.url} alt={`${titulo} — foto ${i + 1} de ${total}`} className="aspect-[16/9] w-full cursor-zoom-in object-cover" onClick={() => setCheia(true)} />
        {total > 1 && (
          <>
            <button type="button" className={`${seta} left-3`} onClick={() => ir(-1)} aria-label="Foto anterior">
              <ChevronLeft className="size-5" />
            </button>
            <button type="button" className={`${seta} right-3`} onClick={() => ir(1)} aria-label="Próxima foto">
              <ChevronRight className="size-5" />
            </button>
          </>
        )}
        <span className="absolute bottom-3 left-3 rounded-full bg-black/55 px-2.5 py-1 text-xs font-semibold text-white">
          {i + 1} / {total}
        </span>
        <button type="button" onClick={() => setCheia(true)} className="absolute bottom-3 right-3 grid size-9 place-items-center rounded-full bg-black/55 text-white transition hover:bg-black/70" aria-label="Ver em tela cheia">
          <Maximize2 className="size-4" />
        </button>
      </div>
      {total > 1 && (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {fotos.map((f, k) => (
            <button
              key={f.url}
              type="button"
              onClick={() => setI(k)}
              aria-label={`Ver foto ${k + 1}`}
              className={`shrink-0 overflow-hidden rounded-[10px] border-2 transition ${k === i ? "border-acento" : "border-transparent opacity-70 hover:opacity-100"}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.url} alt="" loading="lazy" className="h-16 w-24 object-cover" />
            </button>
          ))}
        </div>
      )}
      {cheia &&
        createPortal(
          <div className="janela-fundo fixed inset-0 z-[100] flex items-center justify-center bg-[rgba(5,8,12,.88)] p-4 backdrop-blur-[6px]" onMouseDown={(e) => e.target === e.currentTarget && setCheia(false)}>
            <div className="janela relative w-full max-w-6xl" role="dialog" aria-modal="true" aria-label="Fotos em tela cheia">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={atual.url} alt={`${titulo} — foto ${i + 1}`} className="max-h-[86vh] w-full rounded-[14px] object-contain" />
              {total > 1 && (
                <>
                  <button type="button" className={`${seta} left-2`} onClick={() => ir(-1)} aria-label="Foto anterior">
                    <ChevronLeft className="size-5" />
                  </button>
                  <button type="button" className={`${seta} right-2`} onClick={() => ir(1)} aria-label="Próxima foto">
                    <ChevronRight className="size-5" />
                  </button>
                </>
              )}
              <button type="button" onClick={() => setCheia(false)} className="absolute -top-3 right-0 grid size-10 place-items-center rounded-full bg-white text-black shadow transition hover:scale-105" aria-label="Fechar">
                <X className="size-5" />
              </button>
              <p className="mt-2 text-center text-sm text-white/80">
                {i + 1} / {total}
              </p>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}

function Resposta({ estado, children }: { estado: { erro?: string; ok?: string }; children?: ReactNode }) {
  if (estado.ok)
    return (
      <div role="status" className="rounded-[14px] border border-ok-bd bg-ok-bg px-4 py-4 text-[15px] font-medium text-ok">
        <Check className="mb-1 size-5" />
        {estado.ok}
        {children}
      </div>
    );
  if (estado.erro)
    return (
      <div role="alert" className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">
        {estado.erro}
      </div>
    );
  return null;
}

/** Avisa o Google Analytics (se a imobiliária ligou) que chegou um contato. */
function useEventoLead(ok: string | undefined, tipo: string) {
  useEffect(() => {
    if (ok) window.gtag?.("event", "generate_lead", { lead_type: tipo });
  }, [ok, tipo]);
}

/**
 * Formulário do anúncio/empreendimento: "Mensagem" ou "Agendar visita"
 * (dia e horário). Vira lead no Comercial; a visita já cai na Agenda.
 */
export function FormContato({
  slug,
  imovel,
  empreendimento,
  funil,
  ambas = false,
  agendamento,
  horario,
  mensagemPadrao,
  whatsapp,
  amanha,
}: {
  slug: string;
  imovel?: string;
  empreendimento?: string;
  funil?: "locacao" | "venda";
  /** O imóvel é para alugar e para vender: o visitante escolhe. */
  ambas?: boolean;
  agendamento: boolean;
  horario?: string | null;
  mensagemPadrao: string;
  whatsapp?: string | null;
  /** Primeira data que o formulário oferece (AAAA-MM-DD), calculada no servidor. */
  amanha: string;
}) {
  const [aba, setAba] = useState<"contato" | "visita">("contato");
  const [estado, enviar, enviando] = useActionState(enviarContatoSite, {});
  const tipo = empreendimento ? "empreendimento" : aba;
  useEventoLead(estado.ok, tipo);
  if (estado.ok) return <Resposta estado={estado} />;
  return (
    <form action={enviar} className="space-y-3">
      {agendamento && imovel && (
        <AbasSegmentadas
          variante="seg"
          valor={aba}
          aoMudar={(v) => setAba(v as "contato" | "visita")}
          rotuloAcessivel="Tipo de contato"
          itens={[
            { id: "contato", rotulo: "Mensagem" },
            { id: "visita", rotulo: "Agendar visita" },
          ]}
        />
      )}
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="tipo" value={tipo} />
      {imovel && <input type="hidden" name="imovel" value={imovel} />}
      {empreendimento && <input type="hidden" name="empreendimento" value={empreendimento} />}
      {funil && !ambas && <input type="hidden" name="funil" value={funil} />}
      <input type="text" name="site_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <Campo rotulo="Seu nome">
        <Entrada name="nome" required autoComplete="name" />
      </Campo>
      {ambas && (
        <Campo rotulo="Você quer">
          <Selecao name="funil" defaultValue="locacao">
            <option value="locacao">Alugar</option>
            <option value="venda">Comprar</option>
          </Selecao>
        </Campo>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="WhatsApp / telefone">
          <Entrada name="telefone" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" />
        </Campo>
        <Campo rotulo="E-mail">
          <Entrada name="email" type="email" autoComplete="email" />
        </Campo>
      </div>
      {aba === "visita" && !empreendimento && (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Campo rotulo="Dia da visita">
              <Entrada name="data" type="date" required min={amanha} defaultValue={amanha} />
            </Campo>
            <Campo rotulo="Horário">
              <Selecao name="hora" defaultValue="10:00">
                {horariosVisita().map((h) => (
                  <option key={h}>{h}</option>
                ))}
              </Selecao>
            </Campo>
          </div>
          {horario && <p className="text-xs text-mudo">Horário de visitas deste imóvel: {horario}</p>}
        </>
      )}
      <Campo rotulo={aba === "visita" ? "Recado (opcional)" : "Mensagem"}>
        <AreaTexto key={aba} name="mensagem" rows={3} defaultValue={aba === "visita" ? "" : mensagemPadrao} />
      </Campo>
      <Resposta estado={estado} />
      <button type="submit" disabled={enviando} className={`${classeBotao("primario")} w-full`}>
        {aba === "visita" ? <CalendarCheck className="size-4" /> : <MessageCircle className="size-4" />}
        {enviando ? "Enviando…" : aba === "visita" ? "Pedir visita" : "Enviar mensagem"}
      </button>
      {whatsapp && (
        <a href={linkWhatsapp(whatsapp, mensagemPadrao)} target="_blank" rel="noreferrer" className={`${classeBotao("secundario")} w-full`}>
          <MessageCircle className="size-4" /> Chamar no WhatsApp
        </a>
      )}
      <p className="text-[11px] leading-snug text-mudo">Usamos seus dados só para falar sobre imóveis com você. Você pode pedir a exclusão a qualquer momento.</p>
    </form>
  );
}

/** "Anuncie seu imóvel": o proprietário manda os dados e vira uma captação no sistema. */
export function FormAnuncie({ slug }: { slug: string }) {
  const [estado, enviar, enviando] = useActionState(enviarContatoSite, {});
  useEventoLead(estado.ok, "captacao");
  if (estado.ok) return <Resposta estado={estado} />;
  return (
    <form action={enviar} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="tipo" value="captacao" />
      <input type="text" name="site_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Seu nome" className="sm:col-span-3">
          <Entrada name="nome" required autoComplete="name" />
        </Campo>
        <Campo rotulo="WhatsApp / telefone">
          <Entrada name="telefone" inputMode="tel" autoComplete="tel" placeholder="(11) 99999-9999" />
        </Campo>
        <Campo rotulo="E-mail" className="sm:col-span-2">
          <Entrada name="email" type="email" autoComplete="email" />
        </Campo>
        <Campo rotulo="Tipo do imóvel">
          <Selecao name="tipo_imovel" defaultValue="apartamento">
            {TIPOS_IMOVEL.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Você quer">
          <Selecao name="finalidade" defaultValue="locacao">
            <option value="locacao">Alugar</option>
            <option value="venda">Vender</option>
            <option value="ambos">Alugar ou vender</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Valor que pretende (R$)">
          <Entrada name="valor" inputMode="decimal" placeholder="Opcional" />
        </Campo>
        <Campo rotulo="Cidade">
          <Entrada name="cidade" autoComplete="address-level2" />
        </Campo>
        <Campo rotulo="Bairro">
          <Entrada name="bairro" />
        </Campo>
        <Campo rotulo="UF">
          <Entrada name="uf" maxLength={2} placeholder="SP" />
        </Campo>
        <Campo rotulo="Quartos">
          <Entrada name="quartos" inputMode="numeric" />
        </Campo>
        <Campo rotulo="Área (m²)">
          <Entrada name="area" inputMode="decimal" />
        </Campo>
      </div>
      <Campo rotulo="Conte um pouco do imóvel (opcional)">
        <AreaTexto name="mensagem" rows={3} placeholder="Endereço aproximado, estado de conservação, melhor horário para falar…" />
      </Campo>
      <Resposta estado={estado} />
      <button type="submit" disabled={enviando} className={classeBotao("primario")}>
        {enviando ? "Enviando…" : "Quero anunciar meu imóvel"}
      </button>
      <p className="text-[11px] text-mudo">Usamos seus dados só para falar sobre o anúncio do seu imóvel.</p>
    </form>
  );
}
