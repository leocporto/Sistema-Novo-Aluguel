/**
 * "Pílula elástica" das abas (mesmo sistema de movimento do Gueco).
 * A aba ativa é uma camada cheia (mesmo layout das abas, conteúdo branco)
 * recortada por clip-path no formato da aba. Ao trocar, a borda da frente anda
 * rápido (220ms) e a de trás segue mais devagar (340ms): a pílula estica e
 * encolhe. O clip-path é escrito direto no DOM, sem passar pelo React.
 */

export type Bordas = { l: number; t: number; r: number; b: number };
export type EstadoPilula = { atual?: Bordas; raf?: number; apagada?: boolean };

const saida = (x: number) => 1 - Math.pow(1 - x, 3);
const entradaSaida = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

export function prefereMenosMovimento(): boolean {
  try {
    return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
  } catch {
    return false;
  }
}

/**
 * Move a pílula até a aba `idx`. idx < 0: a pílula encolhe até um ponto e some
 * (a próxima seleção nasce desse ponto). A primeira medição não anima.
 */
export function moverPilula(
  caixa: HTMLElement | null,
  camada: HTMLElement | null,
  idx: number,
  estado: EstadoPilula,
  animar = true,
  raio = 12,
) {
  if (!caixa || !camada) return;
  const botao = idx >= 0 ? caixa.querySelectorAll<HTMLElement>(":scope > [data-aba]")[idx] : null;

  const ponto = (e: Bordas): Bordas => {
    const W = caixa.clientWidth;
    const H = caixa.clientHeight;
    const cx = e.l + (W - e.l - e.r) / 2;
    const cy = e.t + (H - e.t - e.b) / 2;
    return { l: cx, r: W - cx, t: cy, b: H - cy };
  };
  // O alvo é medido a cada quadro: se a caixa muda de tamanho no meio da animação,
  // a pílula termina no lugar certo.
  const medir = (): Bordas => {
    const W = caixa.clientWidth;
    const H = caixa.clientHeight;
    return {
      l: botao!.offsetLeft,
      t: botao!.offsetTop,
      r: W - botao!.offsetLeft - botao!.offsetWidth,
      b: H - botao!.offsetTop - botao!.offsetHeight,
    };
  };

  let alvo: Bordas;
  if (botao) alvo = medir();
  else {
    if (!estado.atual) {
      camada.style.clipPath = "inset(50% 50% 50% 50%)";
      return;
    }
    alvo = ponto(estado.atual);
  }
  const pontoFinal = botao ? null : { ...alvo };
  if (!estado.atual) estado.atual = animar ? ponto(alvo) : { ...alvo };
  else if (estado.apagada && botao) estado.atual = ponto(alvo);
  estado.apagada = !botao;
  const st = estado.atual;
  const desenhar = () => {
    camada.style.clipPath = `inset(${st.t}px ${st.r}px ${st.b}px ${st.l}px round ${raio}px)`;
  };
  cancelAnimationFrame(estado.raf ?? 0);
  if (!animar || prefereMenosMovimento()) {
    Object.assign(st, alvo);
    desenhar();
    return;
  }
  const de = { ...st };
  const horizontal = Math.abs(alvo.l - de.l) >= Math.abs(alvo.t - de.t);
  let frente: keyof Bordas;
  let tras: keyof Bordas;
  let cruzadas: (keyof Bordas)[];
  if (horizontal) {
    const avanca = alvo.l > de.l;
    frente = avanca ? "r" : "l";
    tras = avanca ? "l" : "r";
    cruzadas = ["t", "b"];
  } else {
    const avanca = alvo.t > de.t;
    frente = avanca ? "b" : "t";
    tras = avanca ? "t" : "b";
    cruzadas = ["l", "r"];
  }
  const t0 = performance.now();
  const passo = (agora: number) => {
    const dt = agora - t0;
    const a = Math.min(1, dt / 220);
    const b = Math.min(1, dt / 340);
    const fim = pontoFinal ?? (botao!.isConnected ? medir() : de);
    st[frente] = de[frente] + (fim[frente] - de[frente]) * saida(a);
    st[tras] = de[tras] + (fim[tras] - de[tras]) * entradaSaida(b);
    for (const c of cruzadas) st[c] = de[c] + (fim[c] - de[c]) * saida(a);
    desenhar();
    estado.raf = b < 1 ? requestAnimationFrame(passo) : 0;
  };
  estado.raf = requestAnimationFrame(passo);
}

/** Redesenha no lugar certo, sem animar (resize, fonte carregada, menu abrindo). */
export function remedirPilula(
  caixa: HTMLElement | null,
  camada: HTMLElement | null,
  idx: number,
  estado: EstadoPilula,
  raio = 12,
) {
  if (estado.raf) return;
  if (idx < 0 && (estado.apagada || !estado.atual)) return;
  moverPilula(caixa, camada, idx, estado, false, raio);
}
