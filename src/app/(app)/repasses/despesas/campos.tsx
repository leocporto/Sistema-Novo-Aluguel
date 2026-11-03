"use client";

import { useState } from "react";
import { Campo, Selecao } from "@/components/ui";

export type ImovelComDonos = { id: string; rotulo: string; donos: { id: string; nome: string }[] };

/**
 * Imóvel e "Descontar de": a lista de donos muda conforme o imóvel escolhido
 * (só quem é proprietário dele — no cadastro do imóvel ou no contrato).
 */
export function CamposImovelDono({ imoveis }: { imoveis: ImovelComDonos[] }) {
  const [imovelId, setImovelId] = useState("");
  const donos = imoveis.find((i) => i.id === imovelId)?.donos ?? [];
  return (
    <>
      <Campo rotulo="Imóvel">
        <Selecao name="imovel_id" required value={imovelId} onChange={(e) => setImovelId(e.target.value)}>
          <option value="">Selecione…</option>
          {imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.rotulo}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Descontar de" dica="Vazio = todos os donos do imóvel, cada um pela sua participação no contrato.">
        <Selecao name="descontar_de_id" defaultValue="" key={imovelId} disabled={!imovelId}>
          <option value="">{imovelId ? "Todos os proprietários (rateio)" : "Escolha o imóvel primeiro"}</option>
          {donos.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Selecao>
      </Campo>
    </>
  );
}
