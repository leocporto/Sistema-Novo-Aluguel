import "server-only";
import { revalidatePath } from "next/cache";
import { obterContexto } from "@/lib/contexto";
import type { Modulo, Operacao } from "@/lib/dominio/equipe";
import { ErroValidacao, mensagemErro } from "@/lib/form";
import { exigirPermissao } from "@/lib/permissoes";
import { equipeCondominio, moduloCondominios } from "./dados";

export type Resultado = { ok: boolean; erro?: string };
export const falha = (e: unknown): Resultado => ({ ok: false, erro: mensagemErro(e) });

/**
 * Para as server actions do módulo: conta no modo imobiliária, módulo ligado,
 * papel da equipe (admin, gestor, financeiro) e perfil de acesso com a
 * operação. O banco confere o mesmo (privado.cond_pode / cond_exigir).
 * Módulos usados (mesmos do banco): cadastro/assembleias/comunicados/portal =
 * "imoveis"; dinheiro = "financeiro"; documentos = "documentos"; ocorrências =
 * "manutencao"; áreas e reservas = "agenda".
 */
export async function contextoCondominio(modulo: Modulo, operacao: Operacao) {
  const ctx = await obterContexto();
  if (ctx.organizacao.modo !== "imobiliaria") throw new ErroValidacao("A gestão de condomínios só existe no modo imobiliária.");
  if (!moduloCondominios(ctx.organizacao)) throw new ErroValidacao("O módulo de condomínios está desligado. O administrador liga em Configurações › Condomínios.");
  if (!equipeCondominio(ctx.papel)) throw new ErroValidacao("Só administradores, gestores e o financeiro cuidam dos condomínios.");
  await exigirPermissao(modulo, operacao);
  return ctx;
}

export function revalidarCondominio(id?: string | null) {
  if (id) revalidatePath(`/condominios/${id}`, "layout");
  revalidatePath("/condominios", "layout");
}

/** "id|extra" (ações de botão que precisam de dois valores). */
export function partes(valor: string): [string, string] {
  const [a, b = ""] = valor.split("|");
  return [a, b];
}

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MES = /^\d{4}-\d{2}$/;
