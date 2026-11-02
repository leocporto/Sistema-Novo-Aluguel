import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Cabecalho, Campo, Cartao, Entrada, Grade } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, inteiro, mensagemErro, numero, texto, textoObrigatorio } from "@/lib/form";

export const metadata: Metadata = { title: "Configurações" };

async function salvar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase, organizacao, papel } = await obterContexto();
  if (papel !== "admin") return { erro: "Apenas administradores podem alterar as configurações." };
  try {
    const { error } = await supabase
      .from("organizacoes")
      .update({
        nome: textoObrigatorio(fd, "nome", "o nome"),
        documento: texto(fd, "documento"),
        creci: texto(fd, "creci"),
        email: texto(fd, "email"),
        telefone: texto(fd, "telefone"),
        multa_atraso_pct: numero(fd, "multa_atraso_pct") ?? 10,
        juros_mes_pct: numero(fd, "juros_mes_pct") ?? 1,
        taxa_administracao_pct: numero(fd, "taxa_administracao_pct") ?? 10,
        taxa_intermediacao_pct: numero(fd, "taxa_intermediacao_pct") ?? 100,
        carencia_dias: inteiro(fd, "carencia_dias") ?? 0,
      })
      .eq("id", organizacao.id);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/", "layout");
  return { ok: "Configurações salvas." };
}

export default async function ConfiguracoesPage() {
  const { organizacao: o } = await obterContexto();
  return (
    <>
      <Cabecalho titulo="Configurações da imobiliária" />
      <Formulario acao={salvar}>
        <Cartao titulo="Dados da empresa">
          <Grade colunas={3}>
            <Campo rotulo="Nome">
              <Entrada name="nome" required defaultValue={o.nome} />
            </Campo>
            <Campo rotulo="CNPJ / CPF">
              <Entrada name="documento" defaultValue={o.documento ?? ""} />
            </Campo>
            <Campo rotulo="CRECI">
              <Entrada name="creci" defaultValue={o.creci ?? ""} />
            </Campo>
            <Campo rotulo="E-mail">
              <Entrada type="email" name="email" defaultValue={o.email ?? ""} />
            </Campo>
            <Campo rotulo="Telefone">
              <Entrada name="telefone" defaultValue={o.telefone ?? ""} />
            </Campo>
          </Grade>
        </Cartao>
        <Cartao titulo="Padrões para novos contratos">
          <Grade colunas={3}>
            <Campo rotulo="Taxa de administração (%)">
              <Entrada name="taxa_administracao_pct" defaultValue={String(o.taxa_administracao_pct)} />
            </Campo>
            <Campo rotulo="Intermediação (% do 1º aluguel)">
              <Entrada name="taxa_intermediacao_pct" defaultValue={String(o.taxa_intermediacao_pct)} />
            </Campo>
            <Campo rotulo="Multa por atraso (%)">
              <Entrada name="multa_atraso_pct" defaultValue={String(o.multa_atraso_pct)} />
            </Campo>
            <Campo rotulo="Juros (% ao mês)">
              <Entrada name="juros_mes_pct" defaultValue={String(o.juros_mes_pct)} />
            </Campo>
            <Campo rotulo="Carência (dias)">
              <Entrada type="number" min={0} name="carencia_dias" defaultValue={o.carencia_dias} />
            </Campo>
          </Grade>
        </Cartao>
        <div className="flex justify-end">
          <BotaoEnviar>Salvar</BotaoEnviar>
        </div>
      </Formulario>
    </>
  );
}
