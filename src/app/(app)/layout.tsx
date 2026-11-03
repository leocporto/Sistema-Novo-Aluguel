import { CascaApp } from "@/components/casca-app";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { sair } from "../login/actions";
import { agendarAutomacoesMarketing } from "./marketing/agendar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, organizacao, usuario } = await obterContexto();
  // Aviso do sininho: quantas cobranças estão vencidas e sem pagamento.
  const { count } = await supabase
    .from("faturas")
    .select("id", { count: "exact", head: true })
    .eq("status", "aberta")
    .lt("vencimento", hojeISO());
  // Automações de marketing (imobiliária) rodam depois de responder a tela, sem atrasar nada.
  await agendarAutomacoesMarketing();
  return (
    <CascaApp nomeOrganizacao={organizacao.nome} email={usuario.email ?? ""} acaoSair={sair} emAtraso={count ?? 0} modo={organizacao.modo}>
      {children}
    </CascaApp>
  );
}
