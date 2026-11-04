"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { BotaoEnviar } from "@/components/formulario";
import { Aviso, Selo } from "@/components/ui";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { buscarImoveisPorTexto, type EstadoBusca } from "../actions";
import { SeloOrigem } from "../componentes";

/** Busca de imóveis por texto: a IA (ou a regra) só preenche filtros de uma lista fechada; a busca roda no banco. */
export function BuscaImoveis() {
  const [estado, executar] = useActionState<EstadoBusca, FormData>(buscarImoveisPorTexto, {});
  return (
    <div className="space-y-4">
      <form action={executar} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">O que o cliente procura</span>
          <input
            name="pedido"
            required
            maxLength={600}
            placeholder="apartamento 2 quartos até 2.500 perto do centro com vaga"
            className="w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] text-texto outline-none transition placeholder:text-fraco focus:border-acento focus:ring-4 focus:ring-acento-bg"
          />
        </label>
        <BotaoEnviar>
          <Search className="size-4" /> Buscar
        </BotaoEnviar>
      </form>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.aviso && <Aviso tipo="alerta">{estado.aviso}</Aviso>}
      {estado.entendido && (
        <div className="flex flex-wrap items-center gap-2">
          <SeloOrigem usouIA={!!estado.usouIA} />
          <span className="text-xs text-mudo">Filtros usados:</span>
          {estado.entendido.map((e) => (
            <Selo key={e} cor="azul">
              {e}
            </Selo>
          ))}
        </div>
      )}
      {estado.imoveis &&
        (estado.imoveis.length === 0 ? (
          <p className="text-sm text-mudo">Nenhum imóvel disponível com esses filtros.</p>
        ) : (
          <div className="entrar-cascata grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {estado.imoveis.map((i) => (
              <Link key={i.id} href={`/imoveis/${i.id}`} className="block rounded-card border border-borda bg-card p-4 transition hover:border-borda-forte">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-xs text-mudo">{i.codigo}</span>
                  <span className="text-[13px] font-semibold text-texto">
                    {estado.filtros?.finalidade === "venda" ? formatarReais(i.valor_venda) : i.valor_aluguel ? `${formatarReais(i.valor_aluguel)}/mês` : formatarReais(i.valor_venda)}
                  </span>
                </div>
                <div className="mt-1 text-[14px] font-semibold text-texto">{i.titulo || `${i.tipo ?? "Imóvel"} — ${i.bairro ?? ""}`}</div>
                <div className="mt-1 text-xs text-texto-2">
                  {[i.bairro, i.cidade].filter(Boolean).join(", ")} · {i.quartos ?? 0} quarto(s) · {i.vagas ?? 0} vaga(s){i.area_util ? ` · ${i.area_util} m²` : ""}
                </div>
              </Link>
            ))}
          </div>
        ))}
    </div>
  );
}
