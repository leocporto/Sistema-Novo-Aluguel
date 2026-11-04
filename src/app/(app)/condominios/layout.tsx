import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { equipeCondominio, moduloCondominios } from "./dados";

/**
 * Gestão de condomínios: módulo OPCIONAL e só da imobiliária. No modo pessoal
 * volta para o Painel; com o módulo desligado, para Configurações ›
 * Condomínios (onde o administrador liga). O corretor não vê. O banco garante
 * o mesmo (privado.cond_ativo / cond_equipe / cond_pode).
 */
export default async function CondominiosLayout({ children }: LayoutProps<"/condominios">) {
  const { organizacao, papel } = await obterContexto();
  if (organizacao.modo === "pessoal" || !equipeCondominio(papel)) redirect("/");
  if (!moduloCondominios(organizacao)) redirect("/configuracoes/condominios");
  return children;
}
