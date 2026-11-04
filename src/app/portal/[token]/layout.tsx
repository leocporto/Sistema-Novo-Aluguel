import type { Metadata } from "next";
import type { ReactNode } from "react";
import { LockKeyhole, LogOut } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { SubAbas } from "@/components/sub-abas";
import { Campo, Entrada } from "@/components/ui";
import { DICA_CODIGO, ROTULO_PERFIL, TENTATIVAS_PORTAL, secoesPortal } from "@/lib/dominio/portal";
import { entrarPortal, sairPortal } from "./actions";
import { infoPortal } from "./sessao";

export const metadata: Metadata = { title: "Portal do cliente", robots: { index: false, follow: false } };

function Casca({ children }: { children: ReactNode }) {
  return (
    <main className="min-h-screen bg-app px-4 py-6 sm:py-8">
      <div className="mx-auto max-w-5xl space-y-5">{children}</div>
    </main>
  );
}

/**
 * Portal do cliente (sem login do sistema): o link é pessoal e a pessoa
 * confirma quem é com 4 números antes de ver qualquer dado. Cada perfil
 * (proprietário, locatário, prestador) tem as suas seções.
 */
export default async function PortalLayout({ children, params }: LayoutProps<"/portal/[token]">) {
  const { token } = await params;
  const info = await infoPortal(token);

  if (!info)
    return (
      <Casca>
        <div className="rounded-card border border-borda bg-card p-8 text-center text-texto-2">
          Este link não está ativo. Ele pode ter sido trocado ou desativado. Peça um novo link a quem enviou.
        </div>
      </Casca>
    );

  const contato = [info.organizacao.telefone, info.organizacao.email].filter(Boolean).join(" · ");

  if (!info.entrou)
    return (
      <Casca>
        <section className="mx-auto max-w-md rounded-card border border-borda bg-card p-6">
          <div className="mb-4 flex items-center gap-3">
            <span className="flex size-10 items-center justify-center rounded-[12px] border border-acento-bd bg-acento-bg text-acento-hot">
              <LockKeyhole className="size-5" />
            </span>
            <div>
              <div className="text-sm text-mudo">
                {info.organizacao.nome} · portal do {ROTULO_PERFIL[info.perfil].toLowerCase()}
              </div>
              <h1 className="text-[22px] font-semibold tracking-[-0.02em] text-texto">Olá{info.primeiro_nome ? `, ${info.primeiro_nome}` : ""}!</h1>
            </div>
          </div>
          <p className="mb-4 text-sm text-texto-2">
            Para proteger seus dados, confirme quem é você: digite <b className="text-texto">{info.tipo_codigo ? DICA_CODIGO[info.tipo_codigo] : "os números pedidos"}</b>.
            Depois de {TENTATIVAS_PORTAL} tentativas erradas, a entrada fica bloqueada por 30 minutos.
          </p>
          <Formulario acao={entrarPortal} className="space-y-4">
            <input type="hidden" name="token" value={token} />
            <Campo rotulo="Seus 4 números">
              <Entrada name="codigo" inputMode="numeric" autoComplete="off" maxLength={8} required placeholder="0000" className="text-center text-[20px] tracking-[0.4em]" />
            </Campo>
            <BotaoEnviar>Entrar</BotaoEnviar>
          </Formulario>
          <p className="mt-4 text-xs text-mudo">O link é pessoal: não compartilhe com outras pessoas.{contato ? ` Dúvidas: ${contato}.` : ""}</p>
        </section>
      </Casca>
    );

  const base = `/portal/${token}`;
  const itens = [...secoesPortal(info.perfil), { slug: "arquivos", rotulo: "Arquivos" }].map((s) => ({ href: s.slug ? `${base}/${s.slug}` : base, rotulo: s.rotulo }));

  return (
    <Casca>
      <header className="nao-imprimir flex flex-wrap items-center justify-between gap-3 rounded-card border border-borda bg-card px-5 py-4">
        <div className="min-w-0">
          <div className="text-sm text-mudo">
            {info.organizacao.nome} · portal do {ROTULO_PERFIL[info.perfil].toLowerCase()}
          </div>
          <h1 className="text-[clamp(20px,2.4vw,26px)] font-semibold tracking-[-0.02em] text-texto">Olá, {info.primeiro_nome || info.nome}!</h1>
        </div>
        <BotaoAcao acao={sairPortal} id={token} depois={base} variante="fantasma">
          <LogOut className="size-4" /> Sair
        </BotaoAcao>
      </header>
      <nav className="nao-imprimir" aria-label="Seções do portal">
        <SubAbas rotulo="Seções do portal" itens={itens} />
      </nav>
      {children}
      <footer className="nao-imprimir pb-4 text-center text-xs text-mudo">
        {info.organizacao.nome}
        {contato ? ` · ${contato}` : ""} · Este portal é pessoal: não compartilhe o link.
      </footer>
    </Casca>
  );
}
