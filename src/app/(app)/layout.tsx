import { CascaApp } from "@/components/casca-app";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { sair } from "../login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, organizacao, usuario } = await obterContexto();
  // Aviso do sininho: quantas cobranças estão vencidas e sem pagamento.
  const { count } = await supabase
    .from("faturas")
    .select("id", { count: "exact", head: true })
    .eq("status", "aberta")
    .lt("vencimento", hojeISO());
  return (
    <CascaApp nomeOrganizacao={organizacao.nome} email={usuario.email ?? ""} acaoSair={sair} emAtraso={count ?? 0}>
      {children}
    </CascaApp>
  );
}
