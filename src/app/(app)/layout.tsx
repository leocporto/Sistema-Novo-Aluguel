import { CascaApp } from "@/components/casca-app";
import { obterContexto } from "@/lib/contexto";
import { sair } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { organizacao, usuario } = await obterContexto();
  return (
    <CascaApp nomeOrganizacao={organizacao.nome} email={usuario.email ?? ""} acaoSair={sair}>
      {children}
    </CascaApp>
  );
}
