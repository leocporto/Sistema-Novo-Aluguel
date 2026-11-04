import type { Metadata } from "next";
import Link from "next/link";
import { ListPlus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Celula, Entrada, LinhaVazia, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { normalizar } from "@/lib/dominio/imoveis";
import { descricaoImovel, precoDoImovel, recomendarImoveis, resumoPerfil, temPerfil } from "@/lib/dominio/marketing";
import { enfileirarSugestao } from "../actions";
import { AbasMarketing } from "../campos";
import { carregarContatos, imoveisDisponiveis } from "../dados";

export const metadata: Metadata = { title: "Sugestões por perfil" };

export default async function SugestoesPage({ searchParams }: PageProps<"/marketing/sugestoes">) {
  const sp = await searchParams;
  const quem = sp.quem === "pessoas" ? "pessoas" : "leads";
  const busca = typeof sp.busca === "string" ? sp.busca : "";
  const { supabase } = await obterContexto();
  const [contatos, disponiveis] = await Promise.all([carregarContatos(supabase, quem), imoveisDisponiveis(supabase)]);
  const b = normalizar(busca);
  const linhas = contatos
    .filter((c) => (c.tipo === "pessoa" || (c.status !== "ganho" && c.status !== "perdido")) && c.perfil && temPerfil(c.perfil))
    .filter((c) => !b || normalizar(`${c.nome} ${c.telefone ?? ""} ${c.email ?? ""}`).includes(b))
    .map((c) => ({ c, imoveis: recomendarImoveis(c.perfil!, disponiveis, 5) }))
    .filter((x) => x.imoveis.length > 0)
    .sort((a, b2) => b2.imoveis.length - a.imoveis.length || a.c.nome.localeCompare(b2.c.nome));
  const url = (k: string) => `/marketing/sugestoes${k === "leads" ? "" : `?quem=${k}`}`;

  return (
    <>
      <Cabecalho
        titulo="Sugestões por perfil"
        trilha="Marketing"
        descricao="Quem tem perfil de busca preenchido (no lead ou na aba Interesse da pessoa) e os imóveis disponíveis que combinam agora. “Pôr na fila” monta a mensagem com a lista de imóveis."
      />
      <AbasMarketing />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <PilulasLink
          rotulo="Quem"
          ativo={url(quem)}
          itens={[
            { href: url("leads"), rotulo: "Leads em aberto" },
            { href: url("pessoas"), rotulo: "Pessoas cadastradas" },
          ]}
        />
        <FiltroAutomatico className="filtros-linha">
          {quem === "pessoas" && <input type="hidden" name="quem" value="pessoas" />}
          <Entrada name="busca" aria-label="Buscar contato" defaultValue={busca} placeholder="Buscar nome, telefone…" className="max-w-72" />
        </FiltroAutomatico>
      </div>
      <Tabela colunas={["Contato", "Procura", "Imóveis que combinam", ""]}>
        {linhas.slice(0, 300).map(({ c, imoveis }) => (
          <tr key={`${c.tipo}:${c.id}`}>
            <Celula className="min-w-44">
              <Link href={c.tipo === "lead" ? `/comercial/leads/${c.id}` : `/pessoas/${c.id}/interesse`} className="font-semibold text-acento hover:underline">
                {c.nome}
              </Link>
              <span className="block text-xs text-mudo">{c.telefone ?? c.email ?? "sem contato"}</span>
            </Celula>
            <Celula className="max-w-[260px] text-[13px] text-texto-2">{resumoPerfil(c.perfil!)}</Celula>
            <Celula>
              <ul className="space-y-1 text-[13px]">
                {imoveis.map((i) => (
                  <li key={i.id}>
                    <Link href={`/imoveis/${i.id}`} className="text-acento hover:underline">
                      {descricaoImovel(i)}
                    </Link>{" "}
                    <span className="tabular-nums text-texto-2">— {precoDoImovel(i, c.perfil!.interesse.includes("comprar") && !c.perfil!.interesse.includes("alugar") ? "venda" : undefined)}</span>
                  </li>
                ))}
              </ul>
            </Celula>
            <Celula>
              {c.telefone || c.email ? (
                <BotaoAcao acao={enfileirarSugestao} id={`${c.tipo === "lead" ? "l" : "p"}:${c.id}`} tamanho="sm">
                  <ListPlus className="size-3.5" /> Pôr na fila
                </BotaoAcao>
              ) : null}
            </Celula>
          </tr>
        ))}
        {linhas.length === 0 && (
          <LinhaVazia colunas={4}>Ninguém com perfil preenchido combina com os imóveis disponíveis agora. Preencha o perfil de busca dos leads e a aba Interesse das pessoas.</LinhaVazia>
        )}
      </Tabela>
      {linhas.length > 300 && <p className="mt-3 text-sm text-texto-2">Mostrando 300 de {linhas.length}. Use a busca ou uma campanha “Sugestão de imóveis” para mandar a todos.</p>}
    </>
  );
}
