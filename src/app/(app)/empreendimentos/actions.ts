"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import { gerarUnidades } from "@/lib/dominio/imoveis";
import { type EstadoAcao, ErroValidacao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";

function lerEmpreendimento(fd: FormData) {
  return {
    nome: textoObrigatorio(fd, "nome", "o nome"),
    construtora: texto(fd, "construtora"),
    cep: texto(fd, "cep"),
    logradouro: texto(fd, "logradouro"),
    numero: texto(fd, "numero"),
    bairro: texto(fd, "bairro"),
    cidade: texto(fd, "cidade"),
    uf: texto(fd, "uf")?.toUpperCase() ?? null,
    observacoes: texto(fd, "observacoes"),
  };
}

export async function criarEmpreendimento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const { error } = await supabase.from("empreendimentos").insert(lerEmpreendimento(fd));
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/empreendimentos");
  return { ok: "Empreendimento cadastrado. Abra-o para gerar as unidades." };
}

export async function atualizarEmpreendimento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { error } = await supabase.from("empreendimentos").update(lerEmpreendimento(fd)).eq("id", id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/empreendimentos", "layout");
  return { ok: "Empreendimento salvo." };
}

export async function excluirEmpreendimento(fd: FormData) {
  const { supabase } = await obterContexto();
  await supabase.from("empreendimentos").delete().eq("id", String(fd.get("id")));
  revalidatePath("/empreendimentos");
  revalidatePath("/imoveis");
  redirect("/empreendimentos");
}

/** Cadastro em massa: cria todas as unidades do empreendimento de uma vez. */
export async function gerarUnidadesEmpreendimento(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = String(fd.get("id"));
  try {
    const { data: emp, error: e1 } = await supabase.from("empreendimentos").select("*").eq("id", id).single();
    if (e1 || !emp) throw e1 ?? new Error("Empreendimento não encontrado.");
    const andarInicial = inteiro(fd, "andar_inicial") ?? 1;
    const andarFinal = inteiro(fd, "andar_final") ?? andarInicial;
    const porAndar = inteiro(fd, "por_andar") ?? 1;
    if (andarFinal < andarInicial) throw new ErroValidacao("O último andar precisa ser maior ou igual ao primeiro.");
    if (porAndar < 1 || porAndar > 50) throw new ErroValidacao("Unidades por andar: de 1 a 50.");
    const unidades = gerarUnidades({
      prefixo: textoObrigatorio(fd, "prefixo", "o prefixo do código"),
      blocos: (texto(fd, "blocos") ?? "").split(","),
      andarInicial,
      andarFinal,
      porAndar,
    });
    if (unidades.length > 1000) throw new ErroValidacao(`Isso criaria ${unidades.length} unidades. Faça em partes de até 1.000.`);
    const { data: existentes } = await supabase.from("imoveis").select("codigo");
    const usados = new Set((existentes ?? []).map((r) => String(r.codigo).toUpperCase()));
    const novas = unidades.filter((u) => !usados.has(u.codigo.toUpperCase()));
    if (!novas.length) throw new ErroValidacao("Todas essas unidades já existem.");
    const fins = texto(fd, "finalidade") === "venda" ? ["venda"] : texto(fd, "finalidade") === "ambas" ? ["locacao", "venda"] : ["locacao"];
    const base = {
      tipo: texto(fd, "tipo") ?? "apartamento",
      finalidades: fins,
      empreendimento_id: id,
      cep: emp.cep,
      logradouro: emp.logradouro,
      numero: emp.numero,
      bairro: emp.bairro,
      cidade: emp.cidade,
      uf: emp.uf,
      quartos: inteiro(fd, "quartos"),
      suites: inteiro(fd, "suites"),
      banheiros: inteiro(fd, "banheiros"),
      vagas: inteiro(fd, "vagas"),
      area_privativa: numero(fd, "area_privativa"),
      valor_aluguel: numero(fd, "valor_aluguel"),
      valor_venda: numero(fd, "valor_venda"),
      valor_condominio: numero(fd, "valor_condominio"),
    };
    const linhas = novas.map((u) => ({
      ...base,
      codigo: u.codigo,
      bloco: u.bloco,
      unidade: u.unidade,
      complemento: [u.bloco ? `Bloco ${u.bloco}` : null, `Unidade ${u.unidade}`].filter(Boolean).join(", "),
    }));
    for (let i = 0; i < linhas.length; i += 200) {
      const { error } = await supabase.from("imoveis").insert(linhas.slice(i, i + 200));
      if (error) throw error;
    }
    revalidatePath(`/empreendimentos/${id}`);
    revalidatePath("/imoveis");
    revalidatePath("/");
    const pulos = unidades.length - novas.length;
    return { ok: `${novas.length} unidade(s) criada(s)${pulos ? ` (${pulos} já existiam e foram puladas)` : ""}.` };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}
