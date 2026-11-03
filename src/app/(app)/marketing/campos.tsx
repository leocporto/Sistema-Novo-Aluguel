import { SubAbas } from "@/components/sub-abas";
import { Selecao, Selo } from "@/components/ui";
import { ROTULO_CANAL, ROTULO_STATUS_ENVIO, type Canal } from "@/lib/dominio/marketing";
import type { Supabase } from "./dados";

/** Abas do Marketing (telas irmãs). */
export function AbasMarketing() {
  return (
    <SubAbas
      rotulo="Marketing"
      itens={[
        { href: "/marketing", rotulo: "Visão geral" },
        { href: "/marketing/campanhas", rotulo: "Campanhas" },
        { href: "/marketing/fila", rotulo: "Fila de envio" },
        { href: "/marketing/conversas", rotulo: "Conversas" },
        { href: "/marketing/modelos", rotulo: "Modelos" },
        { href: "/marketing/automacoes", rotulo: "Automações" },
        { href: "/marketing/sugestoes", rotulo: "Sugestões por perfil" },
        { href: "/marketing/landing", rotulo: "Landing pages" },
        { href: "/marketing/origem", rotulo: "Origem dos leads" },
        { href: "/marketing/pesquisas", rotulo: "Pesquisas" },
        { href: "/marketing/materiais", rotulo: "Materiais" },
        { href: "/marketing/preferencias", rotulo: "Descadastros" },
        { href: "/marketing/configuracoes", rotulo: "Integrações" },
      ]}
    />
  );
}

const COR_ENVIO = { pendente: "azul", enviado: "verde", falhou: "vermelho", cancelado: "cinza", bloqueado: "amarelo" } as const;

export function SeloEnvio({ status }: { status: string }) {
  return <Selo cor={COR_ENVIO[status as keyof typeof COR_ENVIO] ?? "cinza"}>{ROTULO_STATUS_ENVIO[status] ?? status}</Selo>;
}

export function SeloCanal({ canal }: { canal: string }) {
  return <Selo cor={canal === "whatsapp" ? "verde" : canal === "email" ? "azul" : "cinza"}>{ROTULO_CANAL[canal as Canal] ?? canal}</Selo>;
}

export function SelecaoCanal({ name = "canal", padrao = "whatsapp", rotulo }: { name?: string; padrao?: string; rotulo?: string }) {
  return (
    <Selecao name={name} defaultValue={padrao} aria-label={rotulo}>
      {Object.entries(ROTULO_CANAL).map(([k, r]) => (
        <option key={k} value={k}>
          {r}
        </option>
      ))}
    </Selecao>
  );
}

export type OpcaoContato = { valor: string; rotulo: string };

/** Pessoas e leads abertos para escolher num formulário ("p:<id>" ou "l:<id>"). */
export async function opcoesContato(supabase: Supabase): Promise<OpcaoContato[]> {
  const [p, l] = await Promise.all([
    supabase.from("pessoas").select("id, nome, telefone").order("nome").limit(2000),
    supabase.from("leads").select("id, nome, telefone").not("status", "in", "(ganho,perdido)").order("nome").limit(2000),
  ]);
  return [
    ...(p.data ?? []).map((x) => ({ valor: `p:${x.id}`, rotulo: `${x.nome}${x.telefone ? ` · ${x.telefone}` : ""} (cadastro)` })),
    ...(l.data ?? []).map((x) => ({ valor: `l:${x.id}`, rotulo: `${x.nome}${x.telefone ? ` · ${x.telefone}` : ""} (lead)` })),
  ];
}

export function SelecaoContato({ opcoes, name = "contato", vazio = "— digitar abaixo —" }: { opcoes: OpcaoContato[]; name?: string; vazio?: string }) {
  return (
    <Selecao name={name} defaultValue="">
      <option value="">{vazio}</option>
      {opcoes.map((o) => (
        <option key={o.valor} value={o.valor}>
          {o.rotulo}
        </option>
      ))}
    </Selecao>
  );
}

/** Texto com quebras de linha preservadas (prévia de mensagem). */
export function TextoMensagem({ texto }: { texto: string }) {
  return <p className="whitespace-pre-wrap break-words text-[14px] leading-relaxed text-texto">{texto}</p>;
}
