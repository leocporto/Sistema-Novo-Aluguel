import { InicioLocatario } from "./secoes/locatario";
import { InicioPrestador } from "./secoes/prestador";
import { InicioProprietario } from "./secoes/proprietario";
import { infoPortal } from "./sessao";

/** Início do portal: resumo do perfil (o layout cuida da entrada). */
export default async function PortalInicio({ params }: PageProps<"/portal/[token]">) {
  const { token } = await params;
  const info = await infoPortal(token);
  if (!info?.entrou) return null;
  if (info.perfil === "proprietario") return <InicioProprietario token={token} />;
  if (info.perfil === "locatario") return <InicioLocatario token={token} />;
  return <InicioPrestador token={token} />;
}
