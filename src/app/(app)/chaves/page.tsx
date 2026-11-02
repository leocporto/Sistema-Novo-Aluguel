import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Cabecalho, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { type EstadoAcao, mensagemErro, texto, textoObrigatorio } from "@/lib/form";

export const metadata: Metadata = { title: "Chaves" };

type Mov = { id: string; retirada_por: string; motivo: string | null; retirada_em: string; previsao_devolucao: string | null; devolvida_em: string | null };
type Chave = { id: string; identificacao: string; local: string | null; imovel: { codigo: string }; chave_movimentacoes: Mov[] };

async function cadastrarChave(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase } = await obterContexto();
  const { error } = await supabase.from("chaves").insert({
    imovel_id: String(fd.get("imovel_id")),
    identificacao: String(fd.get("identificacao") ?? "").trim() || "Chave",
    local: texto(fd, "local"),
  });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath("/chaves");
  return { ok: "Chave cadastrada." };
}

async function retirar(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase } = await obterContexto();
  try {
    const prev = texto(fd, "previsao_devolucao");
    const { error } = await supabase.from("chave_movimentacoes").insert({
      chave_id: textoObrigatorio(fd, "chave_id"),
      retirada_por: textoObrigatorio(fd, "retirada_por", "quem retirou"),
      motivo: texto(fd, "motivo"),
      previsao_devolucao: prev ? new Date(prev).toISOString() : null,
    });
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/chaves");
  return { ok: "Retirada registrada." };
}

async function devolver(fd: FormData) {
  "use server";
  const { supabase } = await obterContexto();
  await supabase.from("chave_movimentacoes").update({ devolvida_em: new Date().toISOString() }).eq("id", String(fd.get("mov_id")));
  revalidatePath("/chaves");
}

const fmt = (s: string | null) => (s ? new Date(s).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—");

export default async function ChavesPage() {
  const { supabase } = await obterContexto();
  const [{ data: chavesRaw }, { data: imoveis }] = await Promise.all([
    supabase.from("chaves").select("*, imovel:imoveis(codigo), chave_movimentacoes(*)").order("identificacao"),
    supabase.from("imoveis").select("id, codigo").order("codigo"),
  ]);
  const chaves = (chavesRaw ?? []) as unknown as Chave[];
  const agora = new Date().toISOString();

  return (
    <>
      <Cabecalho titulo="Gestão de chaves" descricao="Controle de retirada e devolução de chaves para visitas, vistorias e manutenção." />
      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <Tabela colunas={["Chave", "Imóvel", "Local", "Situação", "Ação"]}>
          {chaves.length === 0 && <LinhaVazia colunas={5}>Nenhuma chave cadastrada.</LinhaVazia>}
          {chaves.map((c) => {
            const aberta = c.chave_movimentacoes.find((m) => !m.devolvida_em);
            const atrasada = aberta?.previsao_devolucao && aberta.previsao_devolucao < agora;
            return (
              <tr key={c.id}>
                <Celula>{c.identificacao}</Celula>
                <Celula>{c.imovel.codigo}</Celula>
                <Celula>{c.local ?? "—"}</Celula>
                <Celula>
                  {aberta ? (
                    <>
                      <Selo cor={atrasada ? "vermelho" : "amarelo"}>{atrasada ? "devolução atrasada" : "retirada"}</Selo>
                      <div className="mt-1 text-xs text-mudo">
                        {aberta.retirada_por} · {fmt(aberta.retirada_em)}
                        {aberta.motivo && ` · ${aberta.motivo}`}
                        {aberta.previsao_devolucao && ` · prev. ${fmt(aberta.previsao_devolucao)}`}
                      </div>
                    </>
                  ) : (
                    <Selo cor="verde">disponível</Selo>
                  )}
                </Celula>
                <Celula>
                  {aberta ? (
                    <form action={devolver}>
                      <input type="hidden" name="mov_id" value={aberta.id} />
                      <button className="text-sm text-acento hover:underline">Registrar devolução</button>
                    </form>
                  ) : (
                    <Formulario acao={retirar} className="flex flex-col gap-1">
                      <input type="hidden" name="chave_id" value={c.id} />
                      <Entrada name="retirada_por" placeholder="Retirada por" required />
                      <Entrada name="motivo" placeholder="Motivo (visita, vistoria…)" />
                      <Entrada type="datetime-local" name="previsao_devolucao" />
                      <BotaoEnviar variante="secundario">Registrar retirada</BotaoEnviar>
                    </Formulario>
                  )}
                </Celula>
              </tr>
            );
          })}
        </Tabela>
        <Cartao titulo="Cadastrar chave">
          <Formulario acao={cadastrarChave} className="space-y-3">
            <Campo rotulo="Imóvel">
              <Selecao name="imovel_id" required defaultValue="">
                <option value="" disabled>
                  Selecione…
                </option>
                {(imoveis ?? []).map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.codigo}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Identificação">
              <Entrada name="identificacao" placeholder="Molho 1, portão…" />
            </Campo>
            <Campo rotulo="Local de guarda">
              <Entrada name="local" placeholder="Claviculário A, gaveta 3" />
            </Campo>
            <BotaoEnviar>Cadastrar</BotaoEnviar>
          </Formulario>
        </Cartao>
      </div>
    </>
  );
}
