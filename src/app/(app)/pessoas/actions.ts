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
    ...(fd.has("especialidade") ? { especialidade: texto(fd, "especialidade") } : {}),
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
  revalidatePath("/pessoas", "layout");
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
        ? "Não dá para excluir: esta pessoa faz parte de um contrato ou é proprietária de um imóvel. Tire esses vínculos antes — ou, se for cadastro repetido, use “Possíveis repetidos → Juntar”."
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

// =============================================================================
// Ficha completa: documentos, relacionamento, vínculos, comunicação e interesse
// =============================================================================
type Resultado = { ok: boolean; erro?: string };
const revalidarPessoa = (id: string) => {
  revalidatePath(`/pessoas/${id}`, "layout");
  revalidatePath("/pessoas");
};

export async function registrarArquivoPessoa(dados: { pessoaId: string; path: string; nome: string; categoria: string }): Promise<Resultado> {
  const { supabase, organizacao } = await obterContexto();
  if (!dados.path.startsWith(`${organizacao.id}/${dados.pessoaId}/`)) return { ok: false, erro: "Caminho de arquivo inválido." };
  const { error } = await supabase
    .from("pessoa_arquivos")
    .insert({ pessoa_id: dados.pessoaId, path: dados.path, nome: dados.nome.slice(0, 200), categoria: dados.categoria || "Outro" });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidarPessoa(dados.pessoaId);
  revalidatePath("/");
  return { ok: true };
}

export async function excluirArquivoPessoa(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("pessoa_arquivos").select("path, pessoa_id").eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Arquivo não encontrado." };
  const { error } = await supabase.from("pessoa_arquivos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  await supabase.storage.from("pessoas").remove([data.path as string]);
  revalidarPessoa(data.pessoa_id as string);
  revalidatePath("/");
  return { ok: true };
}

export async function linkArquivoPessoa(id: string): Promise<{ ok: boolean; url?: string; erro?: string }> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("pessoa_arquivos").select("path").eq("id", id).maybeSingle();
  if (!data) return { ok: false, erro: "Arquivo não encontrado." };
  const { data: s, error } = await supabase.storage.from("pessoas").createSignedUrl(data.path as string, 600);
  if (error || !s) return { ok: false, erro: "Não foi possível abrir o arquivo." };
  return { ok: true, url: s.signedUrl };
}

export async function criarInteracao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const pessoaId = String(fd.get("pessoa_id"));
  try {
    const data = texto(fd, "data");
    const { error } = await supabase.from("pessoa_interacoes").insert({
      pessoa_id: pessoaId,
      tipo: texto(fd, "tipo") ?? "nota",
      descricao: textoObrigatorio(fd, "descricao", "o que aconteceu"),
      ...(data ? { data: `${data}T12:00:00-03:00` } : {}),
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarPessoa(pessoaId);
  return { ok: "Registrado." };
}

export async function excluirInteracao(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("pessoa_interacoes").select("pessoa_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("pessoa_interacoes").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  if (data) revalidarPessoa(data.pessoa_id as string);
  return { ok: true };
}

/** Liga outra pessoa (existente ou criada na hora com nome + CPF) a esta. */
export async function adicionarVinculo(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const pessoaId = String(fd.get("pessoa_id"));
  try {
    let vinculado = texto(fd, "vinculado_id");
    if (!vinculado) {
      const nome = textoObrigatorio(fd, "novo_nome", "a pessoa (escolha uma ou digite o nome de uma nova)");
      const documento = somenteDigitos(texto(fd, "novo_documento")) || null;
      const tipoPessoa = documento && documento.length === 14 ? "PJ" : "PF";
      if (documento && !(tipoPessoa === "PF" ? validarCPF(documento) : validarCNPJ(documento)))
        throw new ErroValidacao(tipoPessoa === "PF" ? "CPF inválido." : "CNPJ inválido.");
      const { data, error } = await supabase
        .from("pessoas")
        .insert({ nome, documento, tipo_pessoa: tipoPessoa, telefone: texto(fd, "novo_telefone"), papeis: ["cliente"] })
        .select("id")
        .single();
      if (error) throw error;
      vinculado = data.id as string;
    }
    if (vinculado === pessoaId) throw new ErroValidacao("Escolha outra pessoa.");
    const { error } = await supabase
      .from("pessoa_vinculos")
      .insert({ pessoa_id: pessoaId, vinculado_id: vinculado, tipo: texto(fd, "tipo") ?? "contato", observacao: texto(fd, "observacao") });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarPessoa(pessoaId);
  return { ok: "Contato vinculado." };
}

export async function excluirVinculo(id: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("pessoa_vinculos").select("pessoa_id, vinculado_id").eq("id", id).maybeSingle();
  const { error } = await supabase.from("pessoa_vinculos").delete().eq("id", id);
  if (error) return { ok: false, erro: mensagemErro(error) };
  if (data) {
    revalidarPessoa(data.pessoa_id as string);
    revalidarPessoa(data.vinculado_id as string);
  }
  return { ok: true };
}

const CANAIS = ["whatsapp", "email", "sms", "marketing"] as const;

/** Salva as permissões de contato e registra cada mudança (LGPD). */
export async function salvarComunicacao(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { data: atual, error: e1 } = await supabase
      .from("pessoas")
      .select("aceita_whatsapp, aceita_email, aceita_sms, aceita_marketing")
      .eq("id", id)
      .single();
    if (e1) throw e1;
    const origem = texto(fd, "consentimento_origem");
    const novos = Object.fromEntries(CANAIS.map((c) => [`aceita_${c}`, fd.get(`aceita_${c}`) === "on"])) as Record<string, boolean>;
    const mudou = CANAIS.filter((c) => (atual as Record<string, boolean>)[`aceita_${c}`] !== novos[`aceita_${c}`]);
    const { error } = await supabase
      .from("pessoas")
      .update({
        ...novos,
        canal_preferido: texto(fd, "canal_preferido"),
        consentimento_origem: origem,
        ...(mudou.length ? { consentimento_em: new Date().toISOString() } : {}),
      })
      .eq("id", id);
    if (error) throw error;
    if (mudou.length) {
      const r = await supabase
        .from("pessoa_consentimentos")
        .insert(mudou.map((c) => ({ pessoa_id: id, canal: c, concedido: novos[`aceita_${c}`], origem })));
      if (r.error) throw r.error;
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarPessoa(id);
  return { ok: "Preferências salvas." };
}

export async function salvarInteresse(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const min = numero(fd, "pref_valor_min");
    const max = numero(fd, "pref_valor_max");
    if (min !== null && max !== null && min > max) throw new ErroValidacao("O valor mínimo está maior que o máximo.");
    const { error } = await supabase
      .from("pessoas")
      .update({
        interesse: lista(fd, "interesse"),
        pref_tipos: lista(fd, "pref_tipos"),
        pref_regioes: texto(fd, "pref_regioes"),
        pref_valor_min: min,
        pref_valor_max: max,
        pref_quartos_min: numero(fd, "pref_quartos_min"),
      })
      .eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidarPessoa(id);
  return { ok: "Interesse salvo." };
}

const PERMITIDOS_IMPORTACAO = new Set([
  "nome", "tipo_pessoa", "documento", "rg_ie", "email", "telefone", "papeis", "cep", "logradouro", "numero",
  "complemento", "bairro", "cidade", "uf", "banco", "agencia", "conta", "pix_chave", "observacoes",
]);

export async function importarPessoas(itens: Record<string, unknown>[]): Promise<{ ok: boolean; erro?: string; criados?: number; falhas?: string[] }> {
  const { supabase } = await obterContexto();
  if (!Array.isArray(itens) || !itens.length) return { ok: false, erro: "Nada para importar." };
  if (itens.length > 3000) return { ok: false, erro: "Importe no máximo 3.000 pessoas por vez." };
  const linhas = itens.map((it) => Object.fromEntries(Object.entries(it).filter(([k]) => PERMITIDOS_IMPORTACAO.has(k))));
  let criados = 0;
  const falhas: string[] = [];
  for (let i = 0; i < linhas.length; i += 200) {
    const lote = linhas.slice(i, i + 200);
    const { error } = await supabase.from("pessoas").insert(lote);
    if (!error) {
      criados += lote.length;
      continue;
    }
    for (const l of lote) {
      const r = await supabase.from("pessoas").insert(l);
      if (r.error) falhas.push(`${String(l.nome)}: ${mensagemErro(r.error)}`);
      else criados++;
    }
  }
  revalidatePath("/pessoas", "layout");
  return { ok: true, criados, falhas };
}

/** Junta dois cadastros da mesma pessoa: tudo passa para `manter` e `remover` é apagado. */
export async function juntarPessoas(manter: string, remover: string): Promise<Resultado> {
  const { supabase } = await obterContexto();
  const { error } = await supabase.rpc("juntar_pessoas", { p_manter: manter, p_remover: remover });
  if (error) return { ok: false, erro: mensagemErro(error) };
  revalidatePath("/pessoas", "layout");
  revalidatePath("/imoveis", "layout");
  revalidatePath("/contratos", "layout");
  revalidatePath("/");
  return { ok: true };
}
