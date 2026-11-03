import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Formulario } from "@/components/formulario";
import { Campo, Cartao, Entrada, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { imoveisQueCombinam, type ImovelOferta } from "@/lib/dominio/pessoas";
import { rotaPermitida } from "@/lib/modos";
import { INTERESSES_PESSOA, TIPOS_IMOVEL, type Pessoa } from "@/lib/tipos";
import { salvarInteresse } from "../../actions";

export const metadata: Metadata = { title: "Interesse" };

const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));
const chip =
  "flex cursor-pointer items-center gap-2 rounded-full border border-borda px-3 py-1.5 text-[13px] capitalize text-texto-2 transition hover:border-borda-forte has-[:checked]:border-acento has-[:checked]:bg-acento-bg has-[:checked]:text-acento-hot";

export default async function InteressePage({ params }: PageProps<"/pessoas/[id]/interesse">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  if (!rotaPermitida(`/pessoas/${id}/interesse`, organizacao.modo)) redirect(`/pessoas/${id}`);
  const [{ data }, { data: imoveis }] = await Promise.all([
    supabase.from("pessoas").select("*").eq("id", id).single(),
    supabase.from("imoveis").select("id, codigo, tipo, finalidades, status, bairro, cidade, quartos, valor_aluguel, valor_venda, logradouro, numero").eq("status", "disponivel"),
  ]);
  const p = data as Pessoa;
  type I = ImovelOferta & { codigo: string; logradouro: string | null; numero: string | null };
  const perfil = {
    interesse: p.interesse ?? [],
    pref_tipos: p.pref_tipos ?? [],
    pref_regioes: p.pref_regioes,
    pref_valor_min: p.pref_valor_min == null ? null : Number(p.pref_valor_min),
    pref_valor_max: p.pref_valor_max == null ? null : Number(p.pref_valor_max),
    pref_quartos_min: p.pref_quartos_min,
  };
  const temPerfil = perfil.interesse.length || perfil.pref_tipos.length || perfil.pref_regioes || perfil.pref_valor_max || perfil.pref_quartos_min;
  const combinam = temPerfil ? imoveisQueCombinam(perfil, (imoveis ?? []) as I[]) : [];

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_420px]">
      <Formulario acao={salvarInteresse} automatico>
        <input type="hidden" name="id" value={id} />
        <Cartao titulo="O que a pessoa procura">
          <div className="space-y-5">
            <fieldset>
              <legend className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Quer</legend>
              <div className="flex flex-wrap gap-2">
                {Object.entries(INTERESSES_PESSOA).map(([k, r]) => (
                  <label key={k} className={chip}>
                    <input type="checkbox" name="interesse" value={k} defaultChecked={perfil.interesse.includes(k)} className="sr-only" />
                    {r}
                  </label>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Tipos de imóvel</legend>
              <div className="flex flex-wrap gap-2">
                {TIPOS_IMOVEL.map((t) => (
                  <label key={t} className={chip}>
                    <input type="checkbox" name="pref_tipos" value={t} defaultChecked={perfil.pref_tipos.includes(t)} className="sr-only" />
                    {t}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Bairros ou cidades" dica="Separe por vírgula: Gonzaga, Boqueirão, Santos">
                <Entrada name="pref_regioes" defaultValue={p.pref_regioes ?? ""} />
              </Campo>
              <Campo rotulo="Quartos (mínimo)">
                <Entrada name="pref_quartos_min" type="number" min={0} defaultValue={v(p.pref_quartos_min)} />
              </Campo>
              <Campo rotulo="Valor mínimo (R$)">
                <Entrada name="pref_valor_min" inputMode="decimal" defaultValue={v(p.pref_valor_min)} />
              </Campo>
              <Campo rotulo="Valor máximo (R$)" dica="Aluguel por mês para quem quer alugar; preço de venda para quem quer comprar.">
                <Entrada name="pref_valor_max" inputMode="decimal" defaultValue={v(p.pref_valor_max)} />
              </Campo>
            </div>
          </div>
        </Cartao>
      </Formulario>
      <Cartao titulo={`Imóveis que combinam (${combinam.length})`}>
        {!temPerfil ? (
          <p className="text-sm text-mudo">Preencha o que a pessoa procura para ver os imóveis disponíveis que combinam.</p>
        ) : combinam.length === 0 ? (
          <p className="text-sm text-mudo">Nenhum imóvel disponível dentro desse perfil agora.</p>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {(combinam as I[]).map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2.5">
                <Link href={`/imoveis/${i.id}`} className="min-w-0">
                  <span className="font-semibold text-acento hover:underline">{i.codigo}</span>
                  <span className="block truncate text-xs capitalize text-mudo">
                    {i.tipo}
                    {i.quartos ? ` · ${i.quartos} qto(s)` : ""}
                    {i.bairro ? ` · ${i.bairro}` : ""}
                  </span>
                </Link>
                <span className="text-right text-sm tabular-nums">
                  {i.valor_aluguel ? <div>{formatarReais(i.valor_aluguel)}/mês</div> : null}
                  {i.valor_venda ? <div className="text-xs text-texto-2">{formatarReais(i.valor_venda)}</div> : null}
                  <Selo cor="vermelho">disponível</Selo>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Cartao>
    </div>
  );
}
