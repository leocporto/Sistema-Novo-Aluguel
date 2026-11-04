import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { obterContexto } from "./contexto";
import {
  mensagemSemPermissao,
  moduloDaRota,
  normalizarPermissoes,
  permissoesPadrao,
  permissoesTotais,
  rotaVisivel,
  temPermissao,
  type Modulo,
  type Operacao,
} from "./dominio/equipe";
import { ErroValidacao } from "./form";

/**
 * Permissões do usuário logado (perfil de acesso → padrão do papel; admin: tudo).
 * Vêm do banco (public.minhas_permissoes, a mesma conta de privado.tem_permissao);
 * se a migração da equipe ainda não estiver aplicada, cai no padrão do papel.
 * Uma consulta por requisição (cache do React).
 */
export const permissoesDoUsuario = cache(async () => {
  const { supabase, papel } = await obterContexto();
  if (papel === "admin") return permissoesTotais();
  const { data, error } = await supabase.rpc("minhas_permissoes");
  if (error || !data || typeof data !== "object") return permissoesPadrao(papel);
  return normalizarPermissoes(data);
});

export async function pode(modulo: Modulo, operacao: Operacao): Promise<boolean> {
  return temPermissao(await permissoesDoUsuario(), modulo, operacao);
}

export async function podeVer(modulo: Modulo): Promise<boolean> {
  return pode(modulo, "ver");
}

/** Para as server actions: lança o erro amigável quando falta a permissão. */
export async function exigirPermissao(modulo: Modulo, operacao: Operacao): Promise<void> {
  if (!(await pode(modulo, operacao))) throw new ErroValidacao(mensagemSemPermissao(modulo, operacao));
}

/** Para layouts/páginas: sem "ver" no módulo da rota, volta para o Painel. */
export async function exigirVerRota(caminho: string): Promise<void> {
  const modulo = moduloDaRota(caminho);
  if (modulo && modulo !== "painel" && !(await podeVer(modulo))) redirect("/");
}

/** Esta rota aparece para o usuário? (menu da casca: ponto de integração). */
export async function podeVerRota(caminho: string): Promise<boolean> {
  return rotaVisivel(caminho, await permissoesDoUsuario());
}

/** Lista dos módulos que o usuário vê (para filtrar o menu na casca: ponto de integração). */
export async function modulosVisiveis(): Promise<Modulo[]> {
  const p = await permissoesDoUsuario();
  return (Object.keys(p) as Modulo[]).filter((m) => p[m]?.includes("ver"));
}
