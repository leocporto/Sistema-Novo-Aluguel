import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { Building2, Check } from "lucide-react";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Aviso, BotaoLink, Cabecalho, Cartao } from "@/components/ui";
import { AvisoBancoPendente } from "@/components/aviso-banco-pendente";
import { faltaNoBanco } from "@/lib/banco-pendente";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, mensagemErro } from "@/lib/form";
import { equipeCondominio, moduloCondominios } from "../../condominios/dados";

export const metadata: Metadata = { title: "Gestão de condomínios" };

/** Liga/desliga o módulo (só o administrador; o banco confere em public.cond_ligar_modulo e no gatilho de organizacoes). */
async function ligar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase, papel, organizacao } = await obterContexto();
  const ligarModulo = fd.get("ligar") === "sim";
  try {
    if (papel !== "admin") throw new Error("Só o administrador liga ou desliga o módulo de condomínios.");
    if (organizacao.modo !== "imobiliaria") throw new Error("A gestão de condomínios só existe no modo imobiliária.");
    const { error } = await supabase.rpc("cond_ligar_modulo", { p_ligar: ligarModulo });
    if (faltaNoBanco(error)) return { erro: "Este módulo ainda espera uma atualização do banco de dados. Assim que ela for aplicada, o botão passa a funcionar." };
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/", "layout");
  return { ok: ligarModulo ? "Módulo ligado. Use o botão “Abrir Condomínios” no alto desta tela." : "Módulo desligado. Os dados ficam guardados." };
}

export default async function ConfigCondominiosPage() {
  const { organizacao, papel, supabase } = await obterContexto();
  if (organizacao.modo === "pessoal") redirect("/configuracoes");
  if (!equipeCondominio(papel)) redirect("/configuracoes");
  // Publicado antes da migração de condomínios chegar ao banco: avisa em vez de oferecer "Ligar".
  const { error: semBanco } = await supabase.from("cond_condominios").select("id").limit(1);
  if (faltaNoBanco(semBanco)) return <AvisoBancoPendente titulo="Gestão de condomínios" />;
  const ligado = moduloCondominios(organizacao);
  return (
    <>
      <Cabecalho
        titulo="Gestão de condomínios"
        trilha="Configurações"
        descricao="Módulo opcional para quando a imobiliária também administra condomínios: unidades e frações ideais, cotas, inadimplência, fundo de reserva, prestação de contas, assembleias, comunicados, reservas e portal do condômino."
        acoes={
          ligado && (
            <BotaoLink href="/condominios">
              <Building2 className="size-4" /> Abrir Condomínios
            </BotaoLink>
          )
        }
      />
      <Cartao titulo={ligado ? "O módulo está ligado" : "O módulo está desligado"}>
        <ul className="mb-5 space-y-2 text-sm text-texto-2">
          {[
            "O dinheiro de cada condomínio fica num livro-caixa próprio (conta corrente e fundo de reserva), separado do financeiro da imobiliária.",
            "A taxa de administração que a imobiliária cobra do condomínio pode ir para o seu financeiro com um botão (uma vez por mês).",
            "Desligar não apaga nada: as telas somem, o portal do condômino sai do ar e nada pode ser gravado até ligar de novo.",
          ].map((t) => (
            <li key={t} className="flex gap-2">
              <Check className="mt-0.5 size-4 shrink-0 text-ok" /> {t}
            </li>
          ))}
        </ul>
        {papel === "admin" ? (
          <Formulario acao={ligar} className="space-y-3">
            <input type="hidden" name="ligar" value={ligado ? "nao" : "sim"} />
            <BotaoEnviar variante={ligado ? "secundario" : "primario"} confirmar={ligado ? "Desligar a gestão de condomínios? As telas e o portal do condômino saem do ar (os dados ficam)." : undefined}>
              {ligado ? "Desligar o módulo" : "Ligar a gestão de condomínios"}
            </BotaoEnviar>
          </Formulario>
        ) : (
          <Aviso>Só o administrador da conta liga ou desliga este módulo.</Aviso>
        )}
      </Cartao>
    </>
  );
}
