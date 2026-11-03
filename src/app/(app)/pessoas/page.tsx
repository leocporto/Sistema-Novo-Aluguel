import type { Metadata } from "next";
import Link from "next/link";
import { Copy, Download, FileSpreadsheet, UserPlus } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { LinhaLink } from "@/components/linha-link";
import { BotaoLink, Cabecalho, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { acharPessoasRepetidas } from "@/lib/dominio/pessoas";
import { PAPEIS_SO_IMOBILIARIA } from "@/lib/modos";
import { ROTULO_PAPEL } from "@/lib/tipos";
import { excluirPessoa } from "./actions";
import { buscarPessoas } from "./filtro";

export const metadata: Metadata = { title: "Pessoas" };

export default async function PessoasPage({ searchParams }: PageProps<"/pessoas">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const filtros = { q: s("q"), papel: s("papel"), pendencia: s("pendencia") === "1" };
  const ctx = await obterContexto();
  const { supabase, organizacao } = ctx;
  const [pessoas, { data: todas }] = await Promise.all([
    buscarPessoas(ctx, filtros),
    supabase.from("pessoas").select("id, nome, documento, email, telefone"),
  ]);
  const repetidos = acharPessoasRepetidas(todas ?? []).length;
  const papeis = Object.entries(ROTULO_PAPEL).filter(([k]) => organizacao.modo !== "pessoal" || !(PAPEIS_SO_IMOBILIARIA as readonly string[]).includes(k));
  const qs = new URLSearchParams(Object.entries({ q: filtros.q, papel: filtros.papel, pendencia: filtros.pendencia ? "1" : "" }).filter(([, v]) => v)).toString();

  return (
    <>
      <Cabecalho
        titulo="Pessoas"
        descricao={`${pessoas.length} cadastro(s) — proprietários, inquilinos, fiadores, prestadores${organizacao.modo !== "pessoal" ? ", compradores, corretores" : ""} e contatos.`}
        acoes={
          <>
            {repetidos > 0 && (
              <Link href="/pessoas/duplicados" className={classeBotao("fantasma")}>
                <Copy className="size-4" /> Possíveis repetidos ({repetidos})
              </Link>
            )}
            <a href={`/pessoas/exportar${qs ? `?${qs}` : ""}`} className={classeBotao("secundario")}>
              <Download className="size-4" /> Exportar
            </a>
            <BotaoLink href="/pessoas/importar" variante="secundario">
              <FileSpreadsheet className="size-4" /> Importar
            </BotaoLink>
            <BotaoLink href="/pessoas/novo">
              <UserPlus className="size-4" /> Nova pessoa
            </BotaoLink>
          </>
        }
      />
      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Entrada name="q" placeholder="Nome, CPF/CNPJ, e-mail ou telefone" defaultValue={filtros.q} className="max-w-xs" />
        <Selecao name="papel" defaultValue={filtros.papel} className="max-w-56">
          <option value="">Todos os papéis</option>
          {papeis.map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Selecao>
        <label className="flex h-10 cursor-pointer items-center gap-2 rounded-btn border border-borda bg-card px-3 text-sm text-texto-2 has-[:checked]:border-alerta-bd has-[:checked]:bg-alerta-bg has-[:checked]:text-alerta">
          <input type="checkbox" name="pendencia" value="1" defaultChecked={filtros.pendencia} /> Só com documentação pendente
        </label>
      </FiltroAutomatico>
      <Tabela colunas={["Nome", "Documento", "Contato", "Papéis", "Documentação", ""]}>
        {pessoas.length === 0 && <LinhaVazia colunas={6}>Nenhuma pessoa encontrada.</LinhaVazia>}
        {pessoas.map((p) => (
          <LinhaLink href={`/pessoas/${p.id}`} key={p.id} className="hover:bg-card-hover">
            <Celula>
              <Link href={`/pessoas/${p.id}`} className="font-medium text-acento hover:underline">
                {p.nome}
              </Link>
              <div className="text-xs text-mudo">
                {p.tipo_pessoa === "PF" ? "Pessoa física" : "Pessoa jurídica"}
                {p.especialidade ? ` · ${p.especialidade}` : ""}
              </div>
            </Celula>
            <Celula>{formatarDocumento(p.documento) || "—"}</Celula>
            <Celula>
              <div>{p.email ?? "—"}</div>
              <div className="text-xs text-mudo">{p.telefone}</div>
            </Celula>
            <Celula>
              <div className="flex flex-wrap gap-1">
                {p.papeis.map((x) => (
                  <Selo key={x} cor={x === "proprietario" ? "verde" : x === "locatario" ? "azul" : "cinza"}>
                    {ROTULO_PAPEL[x] ?? x}
                  </Selo>
                ))}
              </div>
            </Celula>
            <Celula>
              {p.pendencias.length ? (
                <span title={p.pendencias.join(" · ")}>
                  <Selo cor="amarelo">{p.pendencias.length} pendência(s)</Selo>
                </span>
              ) : (
                <Selo cor="verde">em dia</Selo>
              )}
            </Celula>
            <Celula>
              <BotaoExcluir acao={excluirPessoa} id={p.id} rotulo={`Excluir ${p.nome}`} confirmar={`Excluir o cadastro de ${p.nome}?`} />
            </Celula>
          </LinhaLink>
        ))}
      </Tabela>
    </>
  );
}
