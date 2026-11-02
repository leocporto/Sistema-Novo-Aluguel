import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function Cabecalho({
  titulo,
  descricao,
  acoes,
}: {
  titulo: string;
  descricao?: ReactNode;
  acoes?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-900">{titulo}</h1>
        {descricao && <p className="mt-1 text-sm text-slate-500">{descricao}</p>}
      </div>
      {acoes && <div className="flex flex-wrap gap-2">{acoes}</div>}
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
    <section className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      {(titulo || acoes) && (
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 px-5 py-3">
          <h2 className="font-medium text-slate-800">{titulo}</h2>
          {acoes}
        </header>
      )}
      <div className="p-5">{children}</div>
    </section>
  );
}

const estilosBotao = {
  primario: "bg-emerald-600 text-white hover:bg-emerald-700",
  secundario: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  perigo: "bg-red-600 text-white hover:bg-red-700",
  fantasma: "text-slate-600 hover:bg-slate-100",
};
export type VarianteBotao = keyof typeof estilosBotao;

export function classeBotao(v: VarianteBotao = "primario") {
  return `inline-flex items-center justify-center gap-1 rounded-lg px-3 py-2 text-sm font-medium transition disabled:opacity-50 ${estilosBotao[v]}`;
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

const coresSelo: Record<string, string> = {
  verde: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  amarelo: "bg-amber-50 text-amber-700 ring-amber-200",
  vermelho: "bg-red-50 text-red-700 ring-red-200",
  azul: "bg-sky-50 text-sky-700 ring-sky-200",
  cinza: "bg-slate-100 text-slate-600 ring-slate-200",
};

export function Selo({ cor = "cinza", children }: { cor?: keyof typeof coresSelo; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${coresSelo[cor]}`}>
      {children}
    </span>
  );
}

export function Tabela({ colunas, children }: { colunas: ReactNode[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
      <table className="min-w-full divide-y divide-slate-200 text-sm">
        <thead className="bg-slate-50">
          <tr>
            {colunas.map((c, i) => (
              <th key={i} className="px-4 py-2.5 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
    </div>
  );
}

export function Celula({ children, className = "" }: { children?: ReactNode; className?: string }) {
  return <td className={`px-4 py-2.5 align-top text-slate-700 ${className}`}>{children}</td>;
}

export function LinhaVazia({ colunas, children }: { colunas: number; children: ReactNode }) {
  return (
    <tr>
      <td colSpan={colunas} className="px-4 py-10 text-center text-sm text-slate-500">
        {children}
      </td>
    </tr>
  );
}

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
    <label className={`flex flex-col gap-1 text-sm ${className}`}>
      <span className="font-medium text-slate-700">{rotulo}</span>
      {children}
      {dica && <span className="text-xs text-slate-500">{dica}</span>}
    </label>
  );
}

const classeEntrada =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 shadow-sm outline-none focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100";

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

export function Indicador({
  rotulo,
  valor,
  detalhe,
  href,
  tom = "neutro",
}: {
  rotulo: string;
  valor: ReactNode;
  detalhe?: ReactNode;
  href?: string;
  tom?: "neutro" | "alerta" | "perigo" | "sucesso";
}) {
  const cor = {
    neutro: "text-slate-900",
    alerta: "text-amber-600",
    perigo: "text-red-600",
    sucesso: "text-emerald-600",
  }[tom];
  const corpo = (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-emerald-300">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{rotulo}</div>
      <div className={`mt-1 text-2xl font-semibold ${cor}`}>{valor}</div>
      {detalhe && <div className="mt-1 text-xs text-slate-500">{detalhe}</div>}
    </div>
  );
  return href ? <Link href={href}>{corpo}</Link> : corpo;
}

export function Definicao({ itens }: { itens: [string, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
      {itens.map(([k, v]) => (
        <div key={k}>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</dt>
          <dd className="mt-0.5 text-slate-800">{v ?? "—"}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Aviso({ tipo = "info", children }: { tipo?: "info" | "alerta" | "erro"; children: ReactNode }) {
  const cls = {
    info: "border-sky-200 bg-sky-50 text-sky-800",
    alerta: "border-amber-200 bg-amber-50 text-amber-800",
    erro: "border-red-200 bg-red-50 text-red-800",
  }[tipo];
  return <div className={`rounded-lg border px-4 py-3 text-sm ${cls}`}>{children}</div>;
}
