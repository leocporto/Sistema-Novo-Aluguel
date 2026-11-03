"use client";

import { useState } from "react";
import { Search } from "lucide-react";
import { normalizar } from "@/lib/dominio/imoveis";
import type { ImovelOpcao } from "./form-pessoa";

/**
 * Caixinhas dos imóveis com busca. Os que não batem com a busca só ficam
 * escondidos (continuam no formulário), para não desmarcar nada ao salvar.
 */
export function MarcarImoveis({ imoveis, vinculados }: { imoveis: ImovelOpcao[]; vinculados: string[] }) {
  const [busca, setBusca] = useState("");
  const [marcados, setMarcados] = useState(() => new Set(vinculados));
  const termo = normalizar(busca);
  const texto = (i: ImovelOpcao) => normalizar([i.codigo, i.logradouro, i.numero, i.bairro, i.cidade].filter(Boolean).join(" "));
  const visiveis = imoveis.filter((i) => !termo || texto(i).includes(termo));
  // Os que já eram dela aparecem primeiro (a ordem não muda enquanto marca).
  const ordem = [...imoveis].sort((a, b) => Number(vinculados.includes(b.id)) - Number(vinculados.includes(a.id)));

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <label className="flex h-10 min-w-0 flex-1 items-center gap-2 rounded-btn border border-borda-forte bg-input px-3 focus-within:border-acento">
          <Search className="size-4 shrink-0 text-mudo" />
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && e.preventDefault()}
            placeholder="Buscar imóvel por código, rua, bairro ou cidade"
            className="h-full w-full bg-transparent text-sm text-texto outline-none placeholder:text-fraco"
            aria-label="Buscar imóvel"
          />
        </label>
        <span className="text-xs text-mudo">
          {marcados.size} marcado(s){termo ? ` · ${visiveis.length} encontrado(s)` : ""}
        </span>
      </div>
      <div className="grid max-h-72 grid-cols-1 gap-2 overflow-y-auto md:grid-cols-2">
        {ordem.map((i) => {
          const aparece = !termo || texto(i).includes(termo);
          return (
            <label
              key={i.id}
              className={`flex items-start gap-2 rounded-lg border border-borda px-3 py-2 text-sm hover:bg-card-hover has-[:checked]:border-acento-bd has-[:checked]:bg-acento-bg ${aparece ? "" : "hidden"}`}
            >
              <input
                type="checkbox"
                name="imoveis"
                value={i.id}
                defaultChecked={vinculados.includes(i.id)}
                onChange={(e) =>
                  setMarcados((s) => {
                    const n = new Set(s);
                    if (e.target.checked) n.add(i.id);
                    else n.delete(i.id);
                    return n;
                  })
                }
                className="mt-0.5"
              />
              <span>
                <span className="font-medium">{i.codigo}</span>
                <span className="block text-xs text-mudo">
                  {[[i.logradouro, i.numero].filter(Boolean).join(", "), i.bairro, i.cidade].filter(Boolean).join(" · ") || "Sem endereço"}
                </span>
              </span>
            </label>
          );
        })}
        {termo && visiveis.length === 0 && <p className="text-sm text-mudo">Nenhum imóvel com “{busca}”.</p>}
      </div>
    </>
  );
}
