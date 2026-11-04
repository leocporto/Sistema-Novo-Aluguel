import type { Metadata } from "next";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { LinhaLink } from "@/components/linha-link";
import { AreaTexto, Cabecalho, Cartao, Celula, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { exigirVerRota } from "@/lib/permissoes";
import { AbasEquipe } from "../../abas";
import { enviarMensagem, excluirMensagem } from "../../actions";
import { carregarMembros, contextoEquipe, nomeDoMembro } from "../../dados";
import { AbasComunicacao } from "../abas";
import { MarcarLidas } from "./marcar-lidas";

export const metadata: Metadata = { title: "Mensagens" };

const quando = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

type Mensagem = { id: string; de_id: string; para_id: string; texto: string; lida_em: string | null; created_at: string };

export default async function MensagensPage({ searchParams }: PageProps<"/equipe/comunicacao/mensagens">) {
  await exigirVerRota("/equipe");
  const sp = await searchParams;
  const com = typeof sp.com === "string" ? sp.com : "";
  const { supabase, usuario } = await contextoEquipe();
  const [membros, { data: recentes }] = await Promise.all([
    carregarMembros(supabase),
    supabase.from("equipe_mensagens").select("id, de_id, para_id, texto, lida_em, created_at").order("created_at", { ascending: false }).limit(1000),
  ]);
  const colegas = membros.filter((m) => m.user_id !== usuario.id);
  const nomes = new Map(membros.map((m) => [m.user_id, nomeDoMembro(m)]));
  const conversas = new Map<string, { ultima: Mensagem; naoLidas: number }>();
  for (const m of (recentes ?? []) as Mensagem[]) {
    const outro = m.de_id === usuario.id ? m.para_id : m.de_id;
    const c = conversas.get(outro) ?? { ultima: m, naoLidas: 0 };
    if (m.para_id === usuario.id && !m.lida_em) c.naoLidas += 1;
    conversas.set(outro, c);
  }
  const colega = colegas.find((m) => m.user_id === com);
  const { data: fio } = colega
    ? await supabase
        .from("equipe_mensagens")
        .select("id, de_id, para_id, texto, lida_em, created_at")
        .or(`and(de_id.eq.${usuario.id},para_id.eq.${com}),and(de_id.eq.${com},para_id.eq.${usuario.id})`)
        .order("created_at", { ascending: false })
        .limit(200)
    : { data: null };
  const mensagens = ((fio ?? []) as Mensagem[]).reverse();

  return (
    <>
      <Cabecalho titulo="Comunicação interna" trilha="Equipe" descricao="Mensagens diretas: só quem mandou e quem recebeu enxergam." />
      <AbasEquipe />
      <AbasComunicacao />
      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Selecao name="com" defaultValue={com} aria-label="Conversar com" className="max-w-xs">
          <option value="">Conversar com…</option>
          {colegas.map((m) => (
            <option key={m.user_id} value={m.user_id}>
              {nomeDoMembro(m)}
            </option>
          ))}
        </Selecao>
      </FiltroAutomatico>
      <div className="grid gap-6 lg:grid-cols-[360px_1fr]">
        <Tabela colunas={["Conversas", ""]}>
          {conversas.size === 0 && <LinhaVazia colunas={2}>Nenhuma conversa ainda.</LinhaVazia>}
          {[...conversas.entries()].map(([outro, c]) => (
            <LinhaLink key={outro} href={`/equipe/comunicacao/mensagens?com=${outro}`}>
              <Celula>
                <span className="font-medium text-texto">{nomes.get(outro) ?? "ex-colega"}</span>
                <span className="block max-w-56 truncate text-xs text-mudo">
                  {c.ultima.de_id === usuario.id ? "Você: " : ""}
                  {c.ultima.texto}
                </span>
              </Celula>
              <Celula className="text-right">{c.naoLidas > 0 ? <Selo cor="azul">{c.naoLidas} nova(s)</Selo> : <span className="text-xs text-mudo">{quando.format(new Date(c.ultima.created_at))}</span>}</Celula>
            </LinhaLink>
          ))}
        </Tabela>
        {colega ? (
          <Cartao titulo={`Conversa com ${nomeDoMembro(colega)}`}>
            {conversas.get(com)?.naoLidas ? <MarcarLidas de={com} /> : null}
            <ul className="mb-4 max-h-[460px] space-y-2 overflow-y-auto">
              {mensagens.length === 0 && <li className="text-sm text-mudo">Nenhuma mensagem ainda. Escreva a primeira abaixo.</li>}
              {mensagens.map((m) => {
                const minha = m.de_id === usuario.id;
                return (
                  <li key={m.id} className={`flex ${minha ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[80%] rounded-[14px] border px-3.5 py-2 ${minha ? "border-acento-bd bg-acento-bg" : "border-borda bg-elev"}`}>
                      <p className="whitespace-pre-wrap text-sm text-texto">{m.texto}</p>
                      <div className="mt-1 flex items-center justify-end gap-2 text-[11px] text-mudo">
                        {quando.format(new Date(m.created_at))}
                        {minha && (m.lida_em ? " · lida" : " · enviada")}
                        {minha && <BotaoExcluir acao={excluirMensagem} id={m.id} variante="texto" rotulo="Apagar" confirmar="Apagar esta mensagem para os dois?" />}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
            <Formulario acao={enviarMensagem} className="space-y-3">
              <input type="hidden" name="para_id" value={com} />
              <AreaTexto name="texto" required rows={2} placeholder={`Mensagem para ${nomeDoMembro(colega)}…`} aria-label="Mensagem" />
              <div className="flex justify-end">
                <BotaoEnviar>Enviar</BotaoEnviar>
              </div>
            </Formulario>
          </Cartao>
        ) : (
          <div className="rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">Escolha um colega para conversar.</div>
        )}
      </div>
    </>
  );
}
