import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/* Componentes base no padrão visual do Gueco (docs/DESIGN.md). */

/** Cabeçalho padrão de toda tela: "Novo Aluguel › Tela", título grande, subtítulo e ações à direita. */
export function Cabecalho({
  titulo,
  descricao,
  acoes,
  trilha,
}: {
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
  /** Texto da trilha (padrão: o próprio título). */
  trilha?: string;
}) {
  return (
    <div className="cabecalho mb-[clamp(14px,1.5vw,18px)] flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0 max-w-[760px]">
        <div className="flex items-center gap-2 text-[13px] text-mudo">
          <span>Novo Aluguel</span>
          <span className="text-fraco">›</span>
          <span className="text-acento-hot">{trilha ?? titulo}</span>
        </div>
        <h1 className="mt-1.5 text-[clamp(28px,3vw,38px)] font-semibold leading-[1.05] tracking-[-0.025em] text-texto">
          {titulo}
        </h1>
        {descricao && <div className="mt-2 text-[13.5px] leading-normal text-texto-2">{descricao}</div>}
      </div>
      {acoes && <div className="flex flex-wrap items-center gap-2">{acoes}</div>}
    </div>
  );
}

export function Cartao({
  titulo,
  acoes,
  children,
  className = "",
}: {
  titulo?: ReactNode;
  acoes?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`entrar rounded-card border border-borda bg-card ${className}`}>
      {(titulo || acoes) && (
        <header className="flex items-center justify-between gap-2 px-[clamp(18px,1.8vw,24px)] pt-[clamp(16px,1.6vw,20px)]">
          <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-texto">{titulo}</h3>
          {acoes}
        </header>
      )}
      <div className="p-[clamp(18px,1.8vw,24px)]">{children}</div>
    </section>
  );
}

const estilosBotao = {
  primario:
    "border border-acento bg-acento text-white hover:-translate-y-px hover:bg-acento-hot hover:border-acento-hot hover:shadow-[0_8px_22px_-8px_var(--accent-glow)]",
  secundario: "border border-borda bg-card text-texto hover:border-borda-forte",
  perigo: "border border-ruim bg-ruim text-white hover:opacity-90",
  fantasma: "border border-transparent text-texto-2 hover:bg-card-hover hover:text-texto",
};
export type VarianteBotao = keyof typeof estilosBotao;

/** Botão padrão: 40px de altura, raio 11, 13,5px semibold. */
export function classeBotao(v: VarianteBotao = "primario", tamanho: "md" | "sm" = "md") {
  const t = tamanho === "sm" ? "min-h-[34px] rounded-[9px] px-3 text-[12.5px]" : "min-h-10 rounded-btn px-4 text-[13.5px]";
  return `inline-flex items-center justify-center gap-2 whitespace-nowrap align-middle font-semibold leading-[1.2] transition duration-150 active:scale-[.97] disabled:opacity-50 ${t} ${estilosBotao[v]}`;
}

export function BotaoLink({
  href,
  variante = "primario",
  children,
  ...resto
}: { href: string; variante?: VarianteBotao; children: ReactNode } & Omit<ComponentProps<typeof Link>, "href">) {
  return (
    <Link href={href} className={classeBotao(variante)} {...resto}>
      {children}
    </Link>
  );
}

const coresSelo = {
  azul: "bg-acento-bg text-acento-hot border-acento-bd",
  verde: "bg-ok-bg text-ok border-ok-bd",
  amarelo: "bg-alerta-bg text-alerta border-alerta-bd",
  vermelho: "bg-ruim-bg text-ruim border-ruim-bd",
  cinza: "bg-elev text-mudo border-borda",
};

/** Selo (badge): pílula pequena em mono. */
export function Selo({ cor = "cinza", children }: { cor?: keyof typeof coresSelo; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2.5 py-1 font-mono text-[10.5px] font-bold tracking-[0.04em] ${coresSelo[cor]}`}
    >
      {children}
    </span>
  );
}

export function Tabela({ colunas, children }: { colunas: ReactNode[]; children: ReactNode }) {
  return (
    <div className="entrar overflow-x-auto rounded-card border border-borda bg-card">
      <table className="min-w-full border-collapse text-sm">
        <thead>
          <tr>
            {colunas.map((c, i) => (
              <th
                key={i}
                className="whitespace-nowrap border-b border-borda bg-elev px-[18px] py-[13px] text-left font-mono text-[10.5px] font-semibold uppercase tracking-[0.12em] text-mudo"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr:last-child>td]:border-b-0 [&>tr]:transition-colors [&>tr:hover>td]:bg-card-hover">{children}</tbody>
      </table>
    </div>
  );
}

export function Celula({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`border-b border-borda-suave px-[18px] py-3.5 align-middle text-[14px] text-texto ${className}`}>{children}</td>;
}

export function LinhaVazia({ colunas, children }: { colunas: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colunas} className="px-4 py-10 text-center text-sm text-mudo">
        {children}
      </td>
    </tr>
  );
}

/** Campo de formulário: rótulo pequeno em mono, caixa alta. */
export function Campo({
  rotulo,
  dica,
  children,
  className = "",
}: {
  rotulo: string;
  dica?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">{rotulo}</span>
      {children}
      {dica && <span className="text-xs text-mudo">{dica}</span>}
    </label>
  );
}

/** Campo de formulário: 46px, fundo de entrada, borda forte, raio 11. */
const classeEntrada =
  "w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] text-texto outline-none transition placeholder:text-fraco focus:border-acento focus:ring-4 focus:ring-acento-bg";

export function Entrada(props: ComponentProps<"input">) {
  return <input {...props} className={`${classeEntrada} ${props.className ?? ""}`} />;
}

export function Selecao(props: ComponentProps<"select">) {
  return <select {...props} className={`${classeEntrada} ${props.className ?? ""}`} />;
}

export function AreaTexto(props: ComponentProps<"textarea">) {
  return <textarea rows={3} {...props} className={`${classeEntrada} ${props.className ?? ""}`} />;
}

export function Grade({ children, colunas = 3 }: { children: ReactNode; colunas?: 2 | 3 | 4 }) {
  const cls = { 2: "md:grid-cols-2", 3: "md:grid-cols-3", 4: "md:grid-cols-4" }[colunas];
  return <div className={`grid grid-cols-1 gap-4 ${cls}`}>{children}</div>;
}

const tonsIndicador = {
  neutro: { valor: "text-texto", icone: "bg-acento-bg text-acento-hot border-acento-bd" },
  alerta: { valor: "text-alerta", icone: "bg-alerta-bg text-alerta border-alerta-bd" },
  perigo: { valor: "text-ruim", icone: "bg-ruim-bg text-ruim border-ruim-bd" },
  sucesso: { valor: "text-ok", icone: "bg-ok-bg text-ok border-ok-bd" },
};

/** KPI: ícone 32px à esquerda do rótulo (13px), número grande peso 600. */
export function Indicador({
  rotulo,
  valor,
  detalhe,
  href,
  tom = "neutro",
  icone,
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  href?: string;
  tom?: keyof typeof tonsIndicador;
  icone?: ReactNode;
}) {
  const t = tonsIndicador[tom];
  const corpo = (
    <div className="flex h-full flex-col gap-3.5 rounded-card border border-borda bg-card p-[clamp(16px,1.6vw,20px)] transition hover:border-borda-forte active:scale-[.99]">
      <div className="flex min-h-8 items-center gap-2.5">
        {icone && (
          <span className={`flex size-8 shrink-0 items-center justify-center rounded-[10px] border [&>svg]:size-4 ${t.icone}`}>{icone}</span>
        )}
        <span className="text-[13px] font-medium text-texto-2">{rotulo}</span>
      </div>
      <div className={`text-[30px] font-semibold leading-none tracking-[-0.025em] tabular-nums ${t.valor}`}>{valor}</div>
      {detalhe && <div className="text-xs text-mudo">{detalhe}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block">
      {corpo}
    </Link>
  ) : (
    corpo
  );
}

export function Definicao({ itens }: { itens: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {itens.map(([k, v]) => (
        <div key={k}>
          <dt className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">{k}</dt>
          <dd className="mt-1 text-texto">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Aviso({ tipo = "info", children }: { tipo?: "info" | "alerta" | "erro"; children: ReactNode }) {
  const cls = {
    info: "border-acento-bd bg-acento-bg text-texto",
    alerta: "border-alerta-bd bg-alerta-bg text-texto",
    erro: "border-ruim-bd bg-ruim-bg text-texto",
  }[tipo];
  return <div className={`rounded-[14px] border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}
