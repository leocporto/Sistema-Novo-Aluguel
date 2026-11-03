/** Barra de progresso de meta: azul até 100%, verde quando atinge. */
export function BarraProgresso({ pct, atingida }: { pct: number; atingida: boolean }) {
  const largura = Math.max(0, Math.min(100, pct));
  return (
    <div className="h-2.5 w-full overflow-hidden rounded-full bg-elev" role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full transition-[width] duration-700 ${atingida ? "bg-ok" : "bg-acento"}`} style={{ width: `${largura}%` }} />
    </div>
  );
}
