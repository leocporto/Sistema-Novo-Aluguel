import type { Metadata } from "next";
import Link from "next/link";
import { Cabecalho, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_FUNIL, paraReativar, rotuloEtapa, type Funil } from "@/lib/dominio/crm";
import { agoraMs } from "@/lib/dominio/datas";
import { ROTULO_ORIGEM_LEAD } from "@/lib/tipos";
import { BotaoReativar } from "../botoes-lead";
import { AbasComercial } from "../campos";

export const metadata: Metadata = { title: "Reativar contatos" };

export default async function ReativarPage() {
  const { supabase } = await obterContexto();
  const agora = agoraMs();
  const { data } = await supabase
    .from("leads")
    .select("id, nome, telefone, status, funil, origem, motivo_perda, perdido_em, ultimo_contato, created_at, corretor:pessoas!leads_corretor_id_fkey(nome)")
    .neq("status", "ganho")
    .order("created_at", { ascending: false })
    .limit(2000);
  type L = {
    id: string;
    nome: string;
    telefone: string | null;
    status: string;
    funil: string;
    origem: string;
    motivo_perda: string | null;
    perdido_em: string | null;
    ultimo_contato: string | null;
    created_at: string;
    corretor: { nome: string } | null;
  };
  const lista = paraReativar((data ?? []) as unknown as L[], agora);
  const dias = (iso: string | null) => (iso ? Math.floor((agora - new Date(iso).getTime()) / 86_400_000) : null);

  return (
    <>
      <Cabecalho
        titulo="Reativar contatos antigos"
        trilha="Comercial"
        descricao="Leads perdidos há mais de 30 dias ou parados há mais de 60. Clique em Reativar: o lead volta para “Em atendimento”, ganha retorno para hoje e abre o WhatsApp com uma mensagem pronta."
      />
      <AbasComercial />
      <Tabela colunas={["Lead", "Funil", "Situação", "Parado há", "Corretor", ""]}>
        {lista.length === 0 && <LinhaVazia colunas={6}>Nenhum contato para reativar agora.</LinhaVazia>}
        {lista.map((l) => (
          <tr key={l.id}>
            <Celula>
              <Link href={`/comercial/leads/${l.id}`} className="font-semibold text-acento hover:underline">
                {l.nome}
              </Link>
              <div className="text-xs text-mudo">{ROTULO_ORIGEM_LEAD[l.origem] ?? l.origem}</div>
            </Celula>
            <Celula>{ROTULO_FUNIL[l.funil as Funil] ?? l.funil}</Celula>
            <Celula>
              <Selo cor={l.status === "perdido" ? "cinza" : "amarelo"}>{rotuloEtapa(l.funil, l.status)}</Selo>
              {l.motivo_perda && <div className="mt-1 text-xs text-mudo">{l.motivo_perda}</div>}
            </Celula>
            <Celula>{dias(l.status === "perdido" ? (l.perdido_em ?? l.created_at) : (l.ultimo_contato ?? l.created_at))} dias</Celula>
            <Celula>{l.corretor?.nome ?? "—"}</Celula>
            <Celula>
              <BotaoReativar id={l.id} telefone={l.telefone} nome={l.nome} />
            </Celula>
          </tr>
        ))}
      </Tabela>
    </>
  );
}
