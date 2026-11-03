"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { validarCNPJ, validarCPF, somenteDigitos } from "@/lib/dominio/documentos";
import { type EstadoAcao, ErroValidacao, lista, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";

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
    imposto_pct: lerImposto(fd),
  };
}

function lerImposto(fd: FormData): number | null {
  const v = numero(fd, "imposto_pct");
  if (v === null) return null;
  if (v < 0 || v > 100) throw new ErroValidacao("O imposto deve ficar entre 0% e 100%.");
  return v;
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

export async function excluirPessoa(id: string): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("pessoas").delete().eq("id", id);
  if (error)
    return {
      ok: false,
      erro: error.message.includes("foreign key")
        ? "Não dá para excluir: esta pessoa faz parte de um contrato. Tire-a do contrato antes (ou exclua o contrato)."
        : mensagemErro(error),
    };
  revalidatePath("/pessoas");
  revalidatePath("/imoveis", "layout");
  return { ok: true };
}

/**
 * Cadastro rápido (nome + CPF/CNPJ) usado na janela "Novo locatário/fiador"
 * do contrato. Retorna a pessoa criada para já ficar selecionada.
 */
export async function criarPessoaRapida(dados: {
  nome: string;
  documento: string;
  papel: "locatario" | "fiador" | "proprietario";
}): Promise<{ ok: true; id: string; nome: string } | { ok: false; erro: string }> {
  const { supabase } = await obterContexto();
  const nome = dados.nome.trim();
  if (!nome) return { ok: false, erro: "Informe o nome." };
  const documento = somenteDigitos(dados.documento) || null;
  let tipo: "PF" | "PJ" = "PF";
  if (documento) {
    if (documento.length === 14) tipo = "PJ";
    const valido = tipo === "PF" ? validarCPF(documento) : validarCNPJ(documento);
    if (!valido) return { ok: false, erro: tipo === "PF" ? "CPF inválido." : "CNPJ inválido." };
    const { data: existente } = await supabase.from("pessoas").select("id, nome").eq("documento", documento).maybeSingle();
    if (existente) return { ok: false, erro: `Já existe um cadastro com esse documento: ${existente.nome}.` };
  }
  const { data, error } = await supabase
    .from("pessoas")
    .insert({ nome, documento, tipo_pessoa: tipo, papeis: [dados.papel] })
    .select("id, nome")
    .single();
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidatePath("/pessoas");
  return { ok: true, id: data.id as string, nome: data.nome as string };
}

/** Atualiza só o celular/WhatsApp da pessoa (usado no envio rápido da régua). */
export async function atualizarTelefone(pessoaId: string, telefone: string): Promise<{ ok: boolean; erro?: string }> {
  const { supabase } = await obterContexto();
  const digitos = somenteDigitos(telefone);
  if (digitos.length < 10 || digitos.length > 13) return { ok: false, erro: "Celular inválido. Use DDD + número." };
  const { error } = await supabase.from("pessoas").update({ telefone }).eq("id", pessoaId);
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidatePath("/pessoas");
  revalidatePath(`/pessoas/${pessoaId}`);
  return { ok: true };
}
