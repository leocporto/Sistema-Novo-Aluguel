/**
 * Mostrado na hora em que se clica em qualquer item do menu, enquanto o
 * servidor busca os dados da tela (navegação instantânea).
 */
export default function Carregando() {
  return (
    <div aria-busy="true" aria-label="Carregando" className="animate-pulse">
      <div className="mb-5 space-y-3">
        <div className="h-3 w-40 rounded-full bg-card-hover" />
        <div className="h-9 w-72 rounded-xl bg-card-hover" />
        <div className="h-3 w-96 max-w-full rounded-full bg-card-hover" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <div key={i} className="h-[132px] rounded-card border border-borda bg-card" />
        ))}
      </div>
      <div className="mt-6 h-72 rounded-card border border-borda bg-card" />
    </div>
  );
}
