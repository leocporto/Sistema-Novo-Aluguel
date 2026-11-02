"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { validarCNPJ, validarCPF, somenteDigitos } from "@/lib/dominio/documentos";
import { type EstadoAcao, ErroValidacao, lista, mensagemErro, texto, textoObrigatorio } from "@/lib/form";

function lerPessoa(fd: FormData) {
  const tipo = texto(fd, "tipo_pessoa") === "PJ" ? "PJ" : "PF";
  const documento = somenteDigitos(texto(fd, "documento")) || null;
  if (documento) {
    const ok = tipo === "PF" ? validarCPF(documento) : validarCNPJ(documento);
    if (!ok) throw new ErroValidacao(tipo === "PF" ? "CPF inválido." : "CNPJ inválido.");
  }
  const papeis = lista(fd, "papeis");
  return {
    tipo_pessoa: tipo,
    nome: textoObrigatorio(fd, "nome", "o nome"),
    documento,
    rg_ie: texto(fd, "rg_ie"),
    data_nascimento: texto(fd, "data_nascimento"),
    estado_civil: texto(fd, "estado_civil"),
    profissao: texto(fd, "profissao"),
    email: texto(fd, "email"),
    telefone: texto(fd, "telefone"),
    cep: texto(fd, "cep"),
    logradouro: texto(fd, "logradouro"),
    numero: texto(fd, "numero"),
    complemento: texto(fd, "complemento"),
    bairro: texto(fd, "bairro"),
    cidade: texto(fd, "cidade"),
    uf: texto(fd, "uf")?.toUpperCase() ?? null,
    banco: texto(fd, "banco"),
    agencia: texto(fd, "agencia"),
    conta: texto(fd, "conta"),
    tipo_conta: texto(fd, "tipo_conta"),
    pix_chave: texto(fd, "pix_chave"),
    papeis: papeis.length ? papeis : ["cliente"],
    observacoes: texto(fd, "observacoes"),
  };
}

export async function salvarPessoa(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = texto(fd, "id");
  let novoId: string | null = null;
  try {
    const dados = lerPessoa(fd);
    if (id) {
      const { error } = await supabase.from("pessoas").update(dados).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("pessoas").insert(dados).select("id").single();
      if (error) throw error;
      novoId = data.id;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/pessoas");
  if (novoId) redirect(`/pessoas/${novoId}`);
  return { ok: "Cadastro salvo." };
}

export async function excluirPessoa(fd: FormData) {
  const { supabase } = await obterContexto();
  const id = texto(fd, "id");
  if (!id) return;
  const { error } = await supabase.from("pessoas").delete().eq("id", id);
  if (error) throw new Error("Não é possível excluir: a pessoa está vinculada a imóveis ou contratos.");
  revalidatePath("/pessoas");
  redirect("/pessoas");
}
