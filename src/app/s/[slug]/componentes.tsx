import Link from "next/link";
import type { ReactNode } from "react";
import { Bath, BedDouble, Building, Car, ImageIcon, MapPin, Ruler } from "lucide-react";
import { Selo } from "@/components/ui";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { ROTULO_FASE, areaPrincipal, precosExibidos, tituloImovel, type EmpreendimentoSite, type ImovelSite } from "@/lib/dominio/site";
import { BotaoComparar, BotaoFavorito } from "./interativo";

export const linkImovel = (base: string, codigo: string) => `${base}/imovel/${encodeURIComponent(codigo)}`;

/** Título de seção do site. */
export function Secao({ titulo, descricao, acoes, children }: { titulo: string; descricao?: ReactNode; acoes?: ReactNode; children: ReactNode }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-[clamp(22px,2.4vw,28px)] font-semibold tracking-[-0.02em] text-texto">{titulo}</h2>
          {descricao && <p className="mt-1 text-sm text-texto-2">{descricao}</p>}
        </div>
        {acoes}
      </div>
      {children}
    </section>
  );
}

/** Preço principal do cartão: aluguel (/mês) e/ou venda. */
export function PrecoCartao({ i }: { i: ImovelSite }) {
  const p = precosExibidos(i);
  if (!p.aluguel && !p.venda) return <div className="text-[19px] font-semibold text-texto">Consulte o valor</div>;
  return (
    <div className="space-y-0.5">
      {p.aluguel && (
        <div className="text-[19px] font-semibold tracking-[-0.01em] text-acento">
          {formatarReais(p.aluguel)}
          <span className="text-sm font-medium text-mudo"> /mês</span>
        </div>
      )}
      {p.venda && <div className={p.aluguel ? "text-sm font-semibold text-texto" : "text-[19px] font-semibold tracking-[-0.01em] text-acento"}>{p.aluguel ? `Venda: ${formatarReais(p.venda)}` : formatarReais(p.venda)}</div>}
      {p.aluguel && (p.condominio || p.iptu) ? (
        <div className="text-xs text-mudo">
          {[p.condominio ? `Cond. ${formatarReais(p.condominio)}` : null, p.iptu ? `IPTU ${formatarReais(p.iptu)}/mês` : null].filter(Boolean).join(" · ")}
        </div>
      ) : null}
    </div>
  );
}

/** Ícones com quartos, banheiros, vagas e área. */
export function Caracteristicas({ i, grande = false }: { i: ImovelSite; grande?: boolean }) {
  const area = areaPrincipal(i);
  const itens: [ReactNode, string][] = [];
  if (i.quartos) itens.push([<BedDouble key="q" />, `${i.quartos} ${i.quartos === 1 ? "quarto" : "quartos"}${i.suites ? ` (${i.suites} suíte${i.suites > 1 ? "s" : ""})` : ""}`]);
  if (i.banheiros) itens.push([<Bath key="b" />, `${i.banheiros} ${i.banheiros === 1 ? "banheiro" : "banheiros"}`]);
  if (i.vagas) itens.push([<Car key="v" />, `${i.vagas} ${i.vagas === 1 ? "vaga" : "vagas"}`]);
  if (area) itens.push([<Ruler key="a" />, `${area.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} m²`]);
  if (!itens.length) return null;
  return (
    <ul className={`flex flex-wrap gap-x-4 gap-y-1.5 ${grande ? "text-[15px]" : "text-[13px]"} text-texto-2`}>
      {itens.map(([icone, t]) => (
        <li key={t} className={`flex items-center gap-1.5 ${grande ? "[&>svg]:size-5" : "[&>svg]:size-4"} [&>svg]:text-mudo`}>
          {icone}
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Cartão do imóvel no catálogo. */
export function CartaoImovel({ i, base, slug, foto }: { i: ImovelSite; base: string; slug: string; foto: string | null }) {
  const titulo = tituloImovel(i);
  const href = linkImovel(base, i.codigo);
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-card border border-borda bg-card transition duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-24px_rgba(20,40,80,.45)]">
      <Link href={href} className="relative block aspect-[4/3] overflow-hidden bg-elev" aria-label={titulo}>
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt={titulo} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span className="grid size-full place-items-center text-mudo">
            <ImageIcon className="size-8" />
          </span>
        )}
        <span className="absolute left-3 top-3 flex flex-wrap gap-1.5">
          {i.status === "reservado" && <Selo cor="amarelo">RESERVADO</Selo>}
          {i.empreendimento && <Selo cor="azul">{i.empreendimento.toUpperCase()}</Selo>}
        </span>
      </Link>
      <span className="absolute right-3 top-3">
        <BotaoFavorito slug={slug} codigo={i.codigo} />
      </span>
      <div className="flex flex-1 flex-col gap-2 p-4">
        <PrecoCartao i={i} />
        <Link href={href} className="line-clamp-2 text-[15px] font-semibold leading-snug text-texto hover:text-acento">
          {titulo}
        </Link>
        {(i.bairro || i.cidade) && (
          <div className="flex items-center gap-1 text-[13px] text-mudo">
            <MapPin className="size-3.5 shrink-0" /> {[i.bairro, i.cidade].filter(Boolean).join(", ")}
          </div>
        )}
        <Caracteristicas i={i} />
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="font-mono text-[11px] text-fraco">Cód. {i.codigo}</span>
          <BotaoComparar slug={slug} codigo={i.codigo} />
        </div>
      </div>
    </article>
  );
}

export function GradeImoveis({ itens, base, slug, fotos, vazio = "Nenhum imóvel encontrado." }: { itens: ImovelSite[]; base: string; slug: string; fotos: Map<string, string>; vazio?: ReactNode }) {
  if (!itens.length) return <div className="rounded-card border border-dashed border-borda-forte bg-card px-6 py-12 text-center text-sm text-texto-2">{vazio}</div>;
  return (
    <div className="entrar-cascata grid gap-5 sm:grid-cols-2 xl:grid-cols-3">
      {itens.map((i) => (
        <CartaoImovel key={i.id} i={i} base={base} slug={slug} foto={i.capa ? (fotos.get(i.capa.path) ?? null) : null} />
      ))}
    </div>
  );
}

/** Cartão de empreendimento/lançamento. */
export function CartaoEmpreendimento({ e, base, foto }: { e: EmpreendimentoSite; base: string; foto: string | null }) {
  return (
    <Link href={`${base}/empreendimentos/${e.id}`} className="group flex flex-col overflow-hidden rounded-card border border-borda bg-card transition hover:-translate-y-0.5 hover:shadow-[0_18px_40px_-24px_rgba(20,40,80,.45)]">
      <div className="relative aspect-[16/10] overflow-hidden bg-elev">
        {foto ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt={e.nome} loading="lazy" className="size-full object-cover transition duration-500 group-hover:scale-[1.03]" />
        ) : (
          <span className="grid size-full place-items-center text-mudo">
            <Building className="size-9" />
          </span>
        )}
        {e.fase && (
          <span className="absolute left-3 top-3">
            <Selo cor={e.fase === "lancamento" ? "azul" : e.fase === "em_obras" ? "amarelo" : "verde"}>{ROTULO_FASE[e.fase].toUpperCase()}</Selo>
          </span>
        )}
      </div>
      <div className="space-y-1.5 p-4">
        <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-texto group-hover:text-acento">{e.nome}</h3>
        <div className="text-[13px] text-mudo">{[e.bairro, e.cidade].filter(Boolean).join(", ") || "—"}</div>
        <div className="text-sm text-texto-2">
          {e.venda_desde ? `A partir de ${formatarReais(e.venda_desde)}` : e.aluguel_desde ? `Aluguel a partir de ${formatarReais(e.aluguel_desde)}` : "Consulte os valores"}
        </div>
        <div className="text-xs text-mudo">
          {e.unidades ? `${e.unidades} unidade(s) disponível(is)` : "Unidades em breve"}
          {e.previsao_entrega ? ` · entrega prevista ${formatarDataBR(e.previsao_entrega).slice(3)}` : ""}
        </div>
      </div>
    </Link>
  );
}
