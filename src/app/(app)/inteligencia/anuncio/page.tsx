import type { Metadata } from "next";
import Link from "next/link";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { Aviso, Cabecalho, Cartao, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { AbasInteligencia } from "../abas";
import { AvisoIA } from "../componentes";
import { estadoIA, exigirOuVoltar, podeConfigurarIA } from "../dados";
import { GeradorDescricao } from "./gerador";

export const metadata: Metadata = { title: "Descrição de anúncio" };

/** Geração de descrição de anúncio (nos dois modos); grava só quando o usuário aceita. */
export default async function AnuncioPage({ searchParams }: PageProps<"/inteligencia/anuncio">) {
  const sp = await searchParams;
  const { supabase, organizacao, papel } = await obterContexto();
  await exigirOuVoltar("imoveis", "editar");
  const [ia, { data }] = await Promise.all([
    estadoIA(supabase),
    supabase.from("imoveis").select("id, codigo, tipo, bairro, titulo, descricao").neq("status", "inativo").order("codigo").limit(500),
  ]);
  type Im = { id: string; codigo: string; tipo: string | null; bairro: string | null; titulo: string | null; descricao: string | null };
  const imoveis = (data ?? []) as Im[];
  const id = typeof sp.imovel === "string" ? sp.imovel : "";
  // Veio do botão "Gerar descrição" da ficha com um imóvel fora da lista (inativo ou além dos 500): busca direto.
  if (/^[0-9a-f-]{36}$/i.test(id) && !imoveis.some((i) => i.id === id)) {
    const { data: um } = await supabase.from("imoveis").select("id, codigo, tipo, bairro, titulo, descricao").eq("id", id).maybeSingle();
    if (um) imoveis.unshift(um as Im);
  }
  const atual = imoveis.find((i) => i.id === id);
  return (
    <>
      <Cabecalho
        titulo="Descrição de anúncio"
        trilha="Assistente e automações"
        descricao="Título e descrição a partir do cadastro do imóvel (tipo, áreas, cômodos, comodidades e valores). Nada é inventado e nada é gravado sem você aceitar."
      />
      <AbasInteligencia modo={organizacao.modo} />
      <div className="space-y-5">
        <AvisoIA configurada={ia.configurada} ativa={ia.config.ativa} podeConfigurar={podeConfigurarIA(papel)} />
        <FiltroAutomatico>
          <Selecao name="imovel" defaultValue={id} aria-label="Escolha o imóvel" className="max-w-xl">
            <option value="">Escolha o imóvel…</option>
            {imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo} — {i.tipo ?? "imóvel"}
                {i.bairro ? `, ${i.bairro}` : ""}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
        {!atual ? (
          <Aviso>Escolha um imóvel para gerar a descrição.</Aviso>
        ) : (
          <>
            <Cartao titulo="Descrição atual" acoes={<Link href={`/imoveis/${atual.id}`} className="text-sm text-acento hover:underline">Abrir o imóvel</Link>}>
              <p className="text-sm font-semibold text-texto">{atual.titulo || "Sem título"}</p>
              <p className="mt-1 whitespace-pre-line text-sm text-texto-2">{atual.descricao || "Sem descrição ainda."}</p>
            </Cartao>
            <Cartao titulo="Gerar nova descrição">
              <GeradorDescricao key={atual.id} imovelId={atual.id} />
            </Cartao>
          </>
        )}
      </div>
    </>
  );
}
