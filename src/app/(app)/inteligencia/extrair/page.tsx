import type { Metadata } from "next";
import Link from "next/link";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { Aviso, Cabecalho, Cartao, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { MAX_ARQUIVO_IA } from "@/lib/servicos/ia";
import { AbasInteligencia } from "../abas";
import { AvisoIA } from "../componentes";
import { estadoIA, exigirOuVoltar, podeConfigurarIA } from "../dados";
import { Extrator } from "./extrator";

export const metadata: Metadata = { title: "Ler documento" };

/** Extração de dados de documentos da pessoa (nos dois modos): prévia para conferir, nunca grava sozinha. */
export default async function ExtrairPage({ searchParams }: PageProps<"/inteligencia/extrair">) {
  const sp = await searchParams;
  const { supabase, organizacao, papel } = await obterContexto();
  await exigirOuVoltar("pessoas", "editar");
  const pessoaId = typeof sp.pessoa === "string" ? sp.pessoa : "";
  const [ia, { data: comArquivo }] = await Promise.all([
    estadoIA(supabase),
    supabase.from("pessoa_arquivos").select("pessoa_id, pessoa:pessoas(nome)").order("created_at", { ascending: false }).limit(500),
  ]);
  const pessoas = new Map<string, string>();
  for (const r of (comArquivo ?? []) as unknown as { pessoa_id: string; pessoa: { nome: string } | null }[]) if (!pessoas.has(r.pessoa_id)) pessoas.set(r.pessoa_id, r.pessoa?.nome ?? "Pessoa");
  const nome = pessoas.get(pessoaId);
  const { data: arqs } = nome
    ? await supabase.from("pessoa_arquivos").select("id, nome, categoria, path").eq("pessoa_id", pessoaId).order("created_at", { ascending: false })
    : { data: [] };
  const arquivos = ((arqs ?? []) as { id: string; nome: string; categoria: string | null; path: string }[]).filter((a) => /\.(jpe?g|png|webp|gif|pdf)$/i.test(a.path));

  return (
    <>
      <Cabecalho
        titulo="Ler documento"
        trilha="Assistente e automações"
        descricao="A IA lê o documento anexado no cadastro da pessoa e mostra os campos numa prévia. Você confere com o documento e escolhe o que gravar."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <AvisoIA configurada={ia.configurada} ativa={ia.config.ativa} podeConfigurar={podeConfigurarIA(papel)} />
        <Aviso>
          O arquivo é aberto pelo servidor com o seu acesso e enviado só para a leitura (imagem até {MAX_ARQUIVO_IA.imagem / 1024 / 1024} MB, PDF até {MAX_ARQUIVO_IA.pdf / 1024 / 1024} MB). O
          Histórico guarda só o tipo e o tamanho do arquivo e os nomes dos campos encontrados — nunca os dados lidos.
        </Aviso>
        <FiltroAutomatico>
          <Selecao name="pessoa" defaultValue={pessoaId} aria-label="Escolha a pessoa" className="max-w-xl">
            <option value="">Escolha a pessoa (com documentos anexados)…</option>
            {[...pessoas.entries()]
              .sort((a, b) => a[1].localeCompare(b[1]))
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </Selecao>
        </FiltroAutomatico>
        {!nome ? (
          <Aviso>Escolha uma pessoa. Os documentos são os da aba Documentos do cadastro.</Aviso>
        ) : arquivos.length === 0 ? (
          <Aviso tipo="alerta">
            {nome} não tem imagem ou PDF anexado.{" "}
            <Link href={`/pessoas/${pessoaId}/documentos`} className="text-acento hover:underline">
              Anexar documentos
            </Link>
          </Aviso>
        ) : (
          <Cartao titulo={`Documentos de ${nome}`}>
            <Extrator key={pessoaId} arquivos={arquivos} iaDisponivel={ia.disponivel} />
          </Cartao>
        )}
      </div>
    </>
  );
}
