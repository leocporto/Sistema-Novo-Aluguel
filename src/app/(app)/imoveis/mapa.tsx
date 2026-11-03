import { MapPin } from "lucide-react";
import { classeBotao } from "@/components/ui";
import type { Imovel } from "@/lib/tipos";

/** Endereço para busca no mapa (ou as coordenadas, se informadas). */
export function consultaMapa(i: Pick<Imovel, "latitude" | "longitude" | "logradouro" | "numero" | "bairro" | "cidade" | "uf" | "cep">) {
  if (i.latitude != null && i.longitude != null) return `${i.latitude},${i.longitude}`;
  const partes = [[i.logradouro, i.numero].filter(Boolean).join(", "), i.bairro, i.cidade, i.uf, i.cep].filter(Boolean);
  return partes.length >= 2 ? partes.join(", ") : "";
}

/** Mapa do Google pelo endereço (sem chave de API). */
export function MapaImovel({ imovel }: { imovel: Imovel }) {
  const q = consultaMapa(imovel);
  if (!q) return <p className="text-xs text-mudo">Preencha rua, número e cidade para ver o mapa.</p>;
  const enc = encodeURIComponent(q);
  return (
    <div className="space-y-2">
      <iframe
        title="Mapa do imóvel"
        src={`https://maps.google.com/maps?q=${enc}&z=16&output=embed`}
        className="h-64 w-full rounded-[14px] border border-borda"
        loading="lazy"
        referrerPolicy="no-referrer-when-downgrade"
      />
      <a href={`https://www.google.com/maps/search/?api=1&query=${enc}`} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
        <MapPin className="size-3.5" /> Abrir no Google Maps
      </a>
    </div>
  );
}
