import { notFound } from "next/navigation";
import { DocumentoPortal, PagarLocatario, ReciboLocatario, VistoriaLocatario } from "../../secoes/locatario";
import { OrdemPrestador } from "../../secoes/prestador";
import { DemonstrativoProprietario } from "../../secoes/proprietario";
import { infoPortal } from "../../sessao";

/**
 * Páginas de detalhe, imprimíveis (HTML gerado do banco): documento,
 * demonstrativo do mês, recibo, 2ª via com Pix, vistoria e ordem de serviço.
 */
export default async function PortalDetalhe({ params }: PageProps<"/portal/[token]/[secao]/[id]">) {
  const { token, secao, id } = await params;
  const info = await infoPortal(token);
  if (!info?.entrou) return null;
  const p = info.perfil;
  if (secao === "documento" && (p === "proprietario" || p === "locatario")) return <DocumentoPortal token={token} id={id} voltar={p === "proprietario" ? "contratos" : "contrato"} />;
  if (secao === "demonstrativo" && p === "proprietario") return <DemonstrativoProprietario token={token} mes={id} />;
  if (secao === "recibo" && p === "locatario") return <ReciboLocatario token={token} id={id} />;
  if (secao === "pagar" && p === "locatario") return <PagarLocatario token={token} id={id} />;
  if (secao === "vistoria" && p === "locatario") return <VistoriaLocatario token={token} id={id} />;
  if (secao === "ordem" && p === "prestador") return <OrdemPrestador token={token} id={id} />;
  notFound();
}
