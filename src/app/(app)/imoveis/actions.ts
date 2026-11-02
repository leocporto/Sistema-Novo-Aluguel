"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { obterContexto } from "@/lib/contexto";
import {
  type EstadoAcao,
  booleano,
  ErroValidacao,
  inteiro,
  lista,
  mensagemErro,
  numero,
  texto,
  textoObrigatorio,
} from "@/lib/form";

function lerImovel(fd: FormData) {
  const finalidades = lista(fd, "finalidades");
  if (finalidades.length === 0) throw new ErroValidacao("Selecione ao menos uma finalidade.");
  return {
    codigo: textoObrigatorio(fd, "codigo", "o código"),
    finalidades,
    tipo: texto(fd, "tipo") ?? "apartamento",
    status: texto(fd, "status") ?? "disponivel",
    cep: texto(fd, "cep"),
    logradouro: texto(fd, "logradouro"),
    numero: texto(fd, "numero"),
    complemento: texto(fd, "complemento"),
    bairro: texto(fd, "bairro"),
    cidade: texto(fd, "cidade"),
    uf: texto(fd, "uf")?.toUpperCase() ?? null,
    area_util: numero(fd, "area_util"),
    area_total: numero(fd, "area_total"),
    quartos: inteiro(fd, "quartos"),
    suites: inteiro(fd, "suites"),
    banheiros: inteiro(fd, "banheiros"),
    vagas: inteiro(fd, "vagas"),
    valor_venda: numero(fd, "valor_venda"),
    valor_aluguel: numero(fd, "valor_aluguel"),
    valor_condominio: numero(fd, "valor_condominio"),
    valor_iptu: numero(fd, "valor_iptu"),
    titulo: texto(fd, "titulo"),
    descricao: texto(fd, "descricao"),
    caracteristicas: (texto(fd, "caracteristicas") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    matricula: texto(fd, "matricula"),
    inscricao_iptu: texto(fd, "inscricao_iptu"),
    publicar_site: booleano(fd, "publicar_site"),
  };
}

export async function salvarImovel(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  const id = texto(fd, "id");
  let novoId: string | null = null;
  try {
    const dados = lerImovel(fd);
    if (id) {
      const { error } = await supabase.from("imoveis").update(dados).eq("id", id);
      if (error) throw error;
    } else {
      const { data, error } = await supabase.from("imoveis").insert(dados).select("id").single();
      if (error) throw error;
      novoId = data.id;
      const proprietario = texto(fd, "proprietario_id");
      if (proprietario) {
        const { error: e2 } = await supabase
          .from("imovel_proprietarios")
          .insert({ imovel_id: novoId, pessoa_id: proprietario, percentual: 100 });
        if (e2) throw e2;
      }
    }
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/imoveis");
  revalidatePath("/");
  if (novoId) redirect(`/imoveis/${novoId}`);
  return { ok: "Imóvel salvo." };
}

export async function adicionarProprietario(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  const { supabase } = await obterContexto();
  try {
    const imovel_id = textoObrigatorio(fd, "imovel_id");
    const pessoa_id = textoObrigatorio(fd, "pessoa_id", "o proprietário");
    const percentual = numero(fd, "percentual") ?? 100;
    const { error } = await supabase
      .from("imovel_proprietarios")
      .upsert({ imovel_id, pessoa_id, percentual }, { onConflict: "imovel_id,pessoa_id" });
    if (error) throw error;
    await supabase.from("pessoas").select("papeis").eq("id", pessoa_id).single().then(async ({ data }) => {
      if (data && !data.papeis.includes("proprietario"))
        await supabase.from("pessoas").update({ papeis: [...data.papeis, "proprietario"] }).eq("id", pessoa_id);
    });
    revalidatePath(`/imoveis/${imovel_id}`);
    revalidatePath("/");
    return { ok: "Proprietário vinculado." };
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
}

export async function removerProprietario(fd: FormData) {
  const { supabase } = await obterContexto();
  const imovel_id = String(fd.get("imovel_id"));
  await supabase.from("imovel_proprietarios").delete().eq("imovel_id", imovel_id).eq("pessoa_id", String(fd.get("pessoa_id")));
  revalidatePath(`/imoveis/${imovel_id}`);
  revalidatePath("/");
}
