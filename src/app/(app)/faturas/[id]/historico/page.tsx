import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { JanelaContato, ListaContatos, ListaEventos, SELECT_CONTATO, type ContatoDb, type EventoDb } from "../../../cobrancas/campos";
import { carregarFicha } from "../../ficha";

export const metadata: Metadata = { title: "Contatos e histórico da cobrança" };

export default async function HistoricoFatura({ params }: PageProps<"/faturas/[id]/historico">) {
  const { id } = await params;
  const ficha = await carregarFicha(id);
  if (!ficha) notFound();
  const { supabase } = await obterContexto();
  const { fatura, dados, hoje } = ficha;
  const [{ data: contatos }, { data: eventos }] = await Promise.all([
    supabase.from("cobranca_contatos").select(SELECT_CONTATO).eq("fatura_id", id).order("data", { ascending: false }).limit(200),
    supabase.from("cobranca_eventos").select("id, tipo, descricao, valor, data, fatura_id").eq("fatura_id", id).order("data", { ascending: false }).limit(200),
  ]);
  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Cartao
        titulo="Contatos de cobrança"
        acoes={fatura.status !== "cancelada" && <JanelaContato contratoId={dados.contrato.id} faturaId={id} acordoId={fatura.acordo_id} hoje={hoje} />}
      >
        <ListaContatos contatos={(contatos ?? []) as unknown as ContatoDb[]} hoje={hoje} />
      </Cartao>
      <Cartao titulo="Histórico (não se apaga)">
        <ListaEventos eventos={(eventos ?? []) as EventoDb[]} />
      </Cartao>
    </div>
  );
}
