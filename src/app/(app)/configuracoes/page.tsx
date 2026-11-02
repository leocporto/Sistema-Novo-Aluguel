import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { Formulario } from "@/components/formulario";
import { Building, Check, House } from "lucide-react";
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
        imposto_pf_pct: numero(fd, "imposto_pf_pct") ?? 0,
        imposto_pj_pct: numero(fd, "imposto_pj_pct") ?? 0,
        modo: texto(fd, "modo") === "pessoal" ? "pessoal" : "imobiliaria",
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
  const pessoal = o.modo === "pessoal";
  const opcoes = [
    {
      valor: "imobiliaria",
      titulo: "Modo imobiliária",
      Icone: Building,
      texto: "Para quem administra imóveis de terceiros: taxa de administração, intermediação, repasse aos proprietários, imposto do proprietário e DIMOB.",
    },
    {
      valor: "pessoal",
      titulo: "Modo imóveis pessoais",
      Icone: House,
      texto: "Para quem aluga os próprios imóveis: sem taxa de administração e sem repasses. O aluguel recebido entra direto no Financeiro.",
    },
  ] as const;
  return (
    <>
      <Cabecalho titulo="Configurações" descricao="Modo de uso, dados e padrões para novos contratos." />
      <Formulario acao={salvar} automatico>
        <Cartao titulo="Modo de uso">
          <div className="grid gap-3 md:grid-cols-2">
            {opcoes.map(({ valor, titulo, Icone, texto: t }) => (
              <label
                key={valor}
                className="group relative flex cursor-pointer gap-4 rounded-card border-2 border-borda bg-card p-5 transition hover:border-borda-forte has-[:checked]:border-acento has-[:checked]:bg-acento-bg"
              >
                <input type="radio" name="modo" value={valor} defaultChecked={o.modo === valor} className="peer sr-only" />
                <span className="flex size-11 shrink-0 items-center justify-center rounded-[12px] border border-acento-bd bg-acento-bg text-acento-hot">
                  <Icone className="size-5" />
                </span>
                <span>
                  <span className="block text-[16px] font-semibold text-texto">{titulo}</span>
                  <span className="mt-1 block text-[13px] leading-relaxed text-texto-2">{t}</span>
                </span>
                <span className="absolute right-4 top-4 grid size-5 place-items-center rounded-full border-2 border-borda-forte text-transparent peer-checked:border-acento peer-checked:bg-acento peer-checked:text-white">
                  <Check className="size-3" strokeWidth={3} />
                </span>
              </label>
            ))}
          </div>
          <p className="mt-3 text-xs text-mudo">
            A troca vale para os próximos pagamentos registrados; o que já foi lançado não muda.
          </p>
        </Cartao>

        <Cartao titulo={pessoal ? "Seus dados" : "Dados da empresa"}>
          <Grade colunas={3}>
            <Campo rotulo="Nome">
              <Entrada name="nome" required defaultValue={o.nome} />
            </Campo>
            <Campo rotulo="CNPJ / CPF">
              <Entrada name="documento" defaultValue={o.documento ?? ""} />
            </Campo>
            {pessoal ? (
              <input type="hidden" name="creci" value={o.creci ?? ""} />
            ) : (
              <Campo rotulo="CRECI">
                <Entrada name="creci" defaultValue={o.creci ?? ""} />
              </Campo>
            )}
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
            {pessoal ? (
              <>
                <input type="hidden" name="taxa_administracao_pct" value={String(o.taxa_administracao_pct)} />
                <input type="hidden" name="taxa_intermediacao_pct" value={String(o.taxa_intermediacao_pct)} />
              </>
            ) : (
              <>
                <Campo rotulo="Taxa de administração (%)">
                  <Entrada name="taxa_administracao_pct" defaultValue={String(o.taxa_administracao_pct)} />
                </Campo>
                <Campo rotulo="Intermediação (% do 1º aluguel)">
                  <Entrada name="taxa_intermediacao_pct" defaultValue={String(o.taxa_intermediacao_pct)} />
                </Campo>
              </>
            )}
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
{pessoal ? (
          <>
            <input type="hidden" name="imposto_pf_pct" value={String(o.imposto_pf_pct ?? 0)} />
            <input type="hidden" name="imposto_pj_pct" value={String(o.imposto_pj_pct ?? 0)} />
          </>
        ) : (
                  <Cartao titulo="Imposto do proprietário (descontado no repasse)">
          <p className="mb-4 text-[13px] text-texto-2">
            Valem para os proprietários sem % próprio no cadastro. O imposto incide sobre o aluguel da parte do proprietário,
            já descontadas as taxas de administração e intermediação.
          </p>
          <Grade colunas={3}>
            <Campo rotulo="Pessoa física (%)">
              <Entrada name="imposto_pf_pct" inputMode="decimal" defaultValue={String(o.imposto_pf_pct ?? 0)} />
            </Campo>
            <Campo rotulo="Pessoa jurídica (%)">
              <Entrada name="imposto_pj_pct" inputMode="decimal" defaultValue={String(o.imposto_pj_pct ?? 0)} />
            </Campo>
          </Grade>
        </Cartao>
        )}
      </Formulario>
    </>
  );
}
