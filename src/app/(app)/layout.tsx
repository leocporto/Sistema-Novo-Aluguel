import { CascaApp } from "@/components/casca-app";
import { obterContexto } from "@/lib/contexto";
import { hojeISO } from "@/lib/dominio/datas";
import { permissoesDoUsuario } from "@/lib/permissoes";
import { sair } from "../login/actions";
import { agendarAutomacoesMarketing } from "./marketing/agendar";
import { agendarRelatorios } from "./relatorios/agendar";
import { agendarWebhooks } from "./integracoes/agendar";
import { agendarAutomacoesIA } from "./inteligencia/agendar";
import { equipeCondominio, moduloCondominios } from "./condominios/dados";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const { supabase, organizacao, usuario, papel } = await obterContexto();
  // Aviso do sininho: quantas cobranças estão vencidas e sem pagamento.
  const { count } = await supabase
    .from("faturas")
    .select("id", { count: "exact", head: true })
    .eq("status", "aberta")
    .lt("vencimento", hojeISO());
  // Automações de marketing (imobiliária) rodam depois de responder a tela, sem atrasar nada.
  await agendarAutomacoesMarketing();
  // Automações por regras do Assistente (nos dois modos; o banco roda no máximo a cada 10 min).
  await agendarAutomacoesIA();
  // Envios programados de relatórios e entregas de webhooks (também em segundo plano).
  await agendarRelatorios();
  await agendarWebhooks();
  // Perfis de acesso (Equipe → Perfis) só existem na imobiliária; no pessoal vale o papel.
  const permissoes = organizacao.modo === "pessoal" ? undefined : await permissoesDoUsuario();
  return (
    <CascaApp
      nomeOrganizacao={organizacao.nome}
      email={usuario.email ?? ""}
      acaoSair={sair}
      emAtraso={count ?? 0}
      modo={organizacao.modo}
      permissoes={permissoes}
      ocultar={[
        ...(papel === "admin" || papel === "gestor" ? [] : ["/integracoes"]),
        // Condomínios: módulo opcional (ligado pelo admin) e só para administração/financeiro.
        ...(moduloCondominios(organizacao) && equipeCondominio(papel) ? [] : ["/condominios"]),
      ]}
    >
      {children}
    </CascaApp>
  );
}
