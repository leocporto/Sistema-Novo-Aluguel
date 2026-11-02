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
  let avisos: string[] = [];
  try {
    const dados = lerPessoa(fd);
    const imoveisMarcados = lista(fd, "imoveis");
    if (imoveisMarcados.length && !dados.papeis.includes("proprietario")) {
      dados.papeis = [...dados.papeis.filter((p) => p !== "cliente"), "proprietario"];
    }
    if (id) {
      const { error } = await supabase.from("pessoas").update(dados).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("pessoas").insert(dados).select("id").single();
      if (error) throw error;
      novoId = data.id;
    }
    if (fd.has("vinculo_imoveis")) {
      avisos = await sincronizarImoveis(supabase, (id ?? novoId)!, imoveisMarcados);
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/pessoas");
  revalidatePath("/imoveis");
  revalidatePath("/");
  if (novoId) redirect(`/pessoas/${novoId}`);
  return { ok: ["Cadastro salvo.", ...avisos].join(" ") };
}

type Supabase = Awaited<ReturnType<typeof obterContexto>>["supabase"];

/**
 * Vincula a pessoa como proprietária dos imóveis marcados e remove os
 * vínculos desmarcados. A participação de um novo vínculo é o que falta para
 * completar 100% no imóvel.
 */
async function sincronizarImoveis(supabase: Supabase, pessoaId: string, marcados: string[]): Promise<string[]> {
  const avisos: string[] = [];
  const { data: atuais, error } = await supabase
    .from("imovel_proprietarios")
    .select("imovel_id")
    .eq("pessoa_id", pessoaId);
  if (error) throw error;
  const jaVinculados = new Set((atuais ?? []).map((v) => v.imovel_id as string));

  const remover = [...jaVinculados].filter((i) => !marcados.includes(i));
  if (remover.length) {
    const r = await supabase.from("imovel_proprietarios").delete().eq("pessoa_id", pessoaId).in("imovel_id", remover);
    if (r.error) throw r.error;
  }

  for (const imovelId of marcados.filter((i) => !jaVinculados.has(i))) {
    const { data: outros } = await supabase
      .from("imovel_proprietarios")
      .select("percentual, imovel:imoveis(codigo)")
      .eq("imovel_id", imovelId);
    const ocupado = (outros ?? []).reduce((s, o) => s + Number(o.percentual), 0);
    const restante = Math.round((100 - ocupado) * 1000) / 1000;
    if (restante <= 0) {
      const { data: im } = await supabase.from("imoveis").select("codigo").eq("id", imovelId).single();
      avisos.push(`O imóvel ${im?.codigo ?? ""} já tem 100% de participação; ajuste as porcentagens na página do imóvel.`);
      continue;
    }
    const r = await supabase.from("imovel_proprietarios").insert({ imovel_id: imovelId, pessoa_id: pessoaId, percentual: restante });
    if (r.error) throw r.error;
  }
  return avisos;
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
