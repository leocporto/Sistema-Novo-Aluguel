import Script from "next/script";
import { pixelMetaValido, rotuloConversaoValido, tagGoogleValida } from "@/lib/dominio/marketing";

/**
 * Pixel da Meta e tag do Google (gtag.js) com os IDs da imobiliária. Os IDs são
 * conferidos antes (só números / G-… / AW-…), então nada além disso vai para o script.
 */
export function Rastreio({ pixel, tag, conversao }: { pixel: string | null; tag: string | null; conversao: string | null }) {
  const p = pixel && pixelMetaValido(pixel) ? pixel.trim() : null;
  const t = tag && tagGoogleValida(tag) ? tag.trim().toUpperCase() : null;
  const conv = conversao && rotuloConversaoValido(conversao) ? conversao.trim() : null;
  const contaAds = conv ? conv.split("/")[0] : null;
  return (
    <>
      {p && (
        <Script id="pixel-meta" strategy="afterInteractive">
          {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${p}');fbq('track','PageView');`}
        </Script>
      )}
      {(t || contaAds) && (
        <>
          <Script id="gtag-js" src={`https://www.googletagmanager.com/gtag/js?id=${t ?? contaAds}`} strategy="afterInteractive" />
          <Script id="gtag-config" strategy="afterInteractive">
            {`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}window.gtag=gtag;gtag('js',new Date());${t ? `gtag('config','${t}');` : ""}${contaAds && contaAds !== t ? `gtag('config','${contaAds}');` : ""}`}
          </Script>
        </>
      )}
    </>
  );
}
