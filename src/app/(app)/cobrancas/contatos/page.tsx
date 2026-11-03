import type { Metadata } from "next";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { Cabecalho, Cartao, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_CANAL } from "@/lib/dominio/cobrancas";
import { hojeISO } from "@/lib/dominio/datas";
import { AbasCobrancas } from "../abas";
import { JanelaContato, ListaContatos, SELECT_CONTATO, type ContatoDb } from "../campos";

export const metadata: Metadata = { title: "Contatos de cobrança" };

const FILTROS: Record<string, string> = { "": "Todos", promessas: "Promessas pendentes", retornos: "Retornos marcados", informou: "Disse que pagou" };

export default async function ContatosPage({ searchParams }: PageProps<"/cobrancas/contatos">) {
  const sp = await searchParams;
  const filtro = typeof sp.filtro === "string" && sp.filtro in FILTROS ? sp.filtro : "";
  const canal = typeof sp.canal === "string" && sp.canal in ROTULO_CANAL ? sp.canal : "";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  let q = supabase.from("cobranca_contatos").select(SELECT_CONTATO).order("data", { ascending: false }).limit(300);
  if (filtro === "promessas") q = q.eq("promessa_status", "pendente").neq("resultado", "informou_pagamento");
  if (filtro === "retornos") q = q.not("proximo_contato", "is", null).order("proximo_contato");
  if (filtro === "informou") q = q.eq("resultado", "informou_pagamento");
  if (canal) q = q.eq("canal", canal);
  const [{ data }, { data: contratos }] = await Promise.all([
    q,
    supabase.from("contratos").select("id, numero, imovel:imoveis(codigo), contrato_partes(papel, pessoa:pessoas(nome))").in("status", ["ativo", "encerrado", "rescindido"]).order("numero", { ascending: false }).limit(1000),
  ]);
  const opcoes = ((contratos ?? []) as unknown as { id: string; numero: number; imovel: { codigo: string } | null; contrato_partes: { papel: string; pessoa: { nome: string } }[] }[]).map((c) => ({
    id: c.id,
    rotulo: `#${c.numero} · ${c.imovel?.codigo ?? ""} · ${c.contrato_partes.find((p) => p.papel === "locatario")?.pessoa.nome ?? "sem locatário"}`,
  }));
  const url = (f: string) => {
    const p = new URLSearchParams();
    if (f) p.set("filtro", f);
    if (canal) p.set("canal", canal);
    const s = p.toString();
    return s ? `/cobrancas/contatos?${s}` : "/cobrancas/contatos";
  };

  return (
    <>
      <Cabecalho
        titulo="Contatos de cobrança"
        trilha="Cobranças"
        descricao="Tudo o que foi falado com cada devedor: mensagens enviadas, ligações, promessas de pagamento e próximos retornos."
        acoes={<JanelaContato contratos={opcoes} hoje={hoje} rotulo="Registrar contato" variante="primario" />}
      />
      <AbasCobrancas />
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <PilulasLink rotulo="Tipo de contato" ativo={url(filtro)} itens={Object.entries(FILTROS).map(([k, r]) => ({ href: url(k), rotulo: r }))} />
        <FiltroAutomatico className="flex flex-wrap gap-2">
          {filtro && <input type="hidden" name="filtro" value={filtro} />}
          <Selecao name="canal" aria-label="Filtrar por canal" defaultValue={canal} className="w-48">
            <option value="">Todos os canais</option>
            {Object.entries(ROTULO_CANAL).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </FiltroAutomatico>
      </div>
      <Cartao>
        <ListaContatos contatos={(data ?? []) as unknown as ContatoDb[]} hoje={hoje} mostrarContrato />
      </Cartao>
    </>
  );
}
