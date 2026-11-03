import { Video } from "lucide-react";

/** Miniatura de foto ou vídeo (link temporário do bucket privado). */
export function Miniatura({ url, tipo, legenda, className = "aspect-[4/3]" }: { url: string | undefined; tipo: string; legenda?: string | null; className?: string }) {
  if (!url) return <div className={`grid place-items-center rounded-[12px] bg-elev text-xs text-mudo ${className}`}>sem acesso</div>;
  if (tipo === "video")
    return (
      <div className={`relative overflow-hidden rounded-[12px] bg-elev ${className}`}>
        <video src={url} controls preload="metadata" className="size-full object-cover" aria-label={legenda ?? "Vídeo da vistoria"} />
        <Video className="pointer-events-none absolute left-2 top-2 size-4 text-white drop-shadow" />
      </div>
    );
  return (
    <a href={url} target="_blank" rel="noreferrer" className={`block overflow-hidden rounded-[12px] bg-elev ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={legenda ?? "Foto da vistoria"} loading="lazy" className="size-full object-cover transition duration-200 hover:scale-[1.03]" />
    </a>
  );
}
