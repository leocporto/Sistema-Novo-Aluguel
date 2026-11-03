import type { Metadata } from "next";
import Link from "next/link";
import { ShieldOff } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Aviso, Cabecalho, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataHora, ROTULO_CANAL_DESCADASTRO } from "@/lib/dominio/marketing";
import { bloquearContato, excluirDescadastro } from "../actions";
import { AbasMarketing, opcoesContato, SelecaoContato } from "../campos";

export const metadata: Metadata = { title: "Descadastros e preferências" };

const ORIGEM: Record<string, string> = { manual: "Equipe", link: "Pela página de preferências", whatsapp: "Respondeu SAIR", importacao: "Importação" };

export default async function PreferenciasPage() {
  const { supabase, papel } = await obterContexto();
  const podeRetirar = papel === "admin" || papel === "gestor";
  const [{ data }, { data: log }, opcoes] = await Promise.all([
    supabase.from("mkt_descadastros").select("*, pessoa:pessoas(id, nome), lead:leads(id, nome)").order("em", { ascending: false }).limit(1000),
    supabase.from("mkt_preferencias_log").select("*, pessoa:pessoas(id, nome), lead:leads(id, nome)").order("em", { ascending: false }).limit(200),
    opcoesContato(supabase),
  ]);
  type D = {
    id: string;
    email: string | null;
    telefone: string | null;
    canal: string;
    origem: string;
    motivo: string | null;
    em: string;
    pessoa: { id: string; nome: string } | null;
    lead: { id: string; nome: string } | null;
  };
  type Lg = D & { concedido: boolean; detalhe: string | null };
  const bloqueios = (data ?? []) as D[];
  const quem = (d: D) =>
    d.pessoa ? (
      <Link href={`/pessoas/${d.pessoa.id}/comunicacao`} className="font-semibold text-acento hover:underline">
        {d.pessoa.nome}
      </Link>
    ) : d.lead ? (
      <Link href={`/comercial/leads/${d.lead.id}`} className="font-semibold text-acento hover:underline">
        {d.lead.nome}
      </Link>
    ) : (
      <span className="font-semibold">{d.email ?? d.telefone ?? "—"}</span>
    );

  return (
    <>
      <Cabecalho
        titulo="Descadastros e preferências"
        trilha="Marketing"
        descricao="Quem pediu para não receber. Vale para todas as campanhas, automações e para a fila (o banco confere na hora de enviar). Para pessoas cadastradas, a autorização da aba Comunicação (LGPD) acompanha."
        acoes={
          <JanelaCadastro rotuloBotao={<><ShieldOff className="size-4" /> Bloquear contato</>} titulo="Não enviar mais para este contato" acao={bloquearContato} icone={<ShieldOff />}>
            <Campo rotulo="Contato">
              <SelecaoContato opcoes={opcoes} />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Ou telefone">
                <Entrada name="telefone" inputMode="tel" />
              </Campo>
              <Campo rotulo="Ou e-mail">
                <Entrada name="email" type="email" />
              </Campo>
            </div>
            <Campo rotulo="Não enviar">
              <Selecao name="canal" defaultValue="todos">
                {Object.entries(ROTULO_CANAL_DESCADASTRO).map(([k, r]) => (
                  <option key={k} value={k}>
                    {k === "todos" ? "Nada (nenhum canal)" : k === "ofertas" ? "Ofertas e novidades (pesquisa e pós-venda continuam)" : `Por ${r}`}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Motivo / como pediu">
              <Entrada name="motivo" placeholder="Ex.: pediu por telefone em 03/11" />
            </Campo>
          </JanelaCadastro>
        }
      />
      <AbasMarketing />
      <div className="mb-4">
        <Aviso>
          Toda mensagem de oferta sai com o link de preferências da própria pessoa (variável {"{{link_preferencias}}"}): ela escolhe por onde quer receber ou sai da lista, sem
          precisar falar com ninguém. No WhatsApp, responder SAIR também descadastra. Retirar um bloqueio (só administrador ou gestor) não
          autoriza nada sozinho: a autorização volta pela aba Comunicação da pessoa ou pelo link dela.
        </Aviso>
      </div>
      <Tabela colunas={["Contato", "Não recebe", "Como", "Quando", ""]}>
        {bloqueios.map((d) => (
          <tr key={d.id}>
            <Celula>
              {quem(d)}
              <span className="block text-xs text-mudo">{[d.telefone, d.email].filter(Boolean).join(" · ")}</span>
            </Celula>
            <Celula>
              <Selo cor={d.canal === "todos" ? "vermelho" : "amarelo"}>{ROTULO_CANAL_DESCADASTRO[d.canal] ?? d.canal}</Selo>
            </Celula>
            <Celula className="text-sm text-texto-2">
              {ORIGEM[d.origem] ?? d.origem}
              {d.motivo && <span className="block text-xs text-mudo">{d.motivo}</span>}
            </Celula>
            <Celula className="text-xs text-texto-2">{formatarDataHora(d.em)}</Celula>
            <Celula>
              {podeRetirar && (
                <BotaoExcluir
                  acao={excluirDescadastro}
                  id={d.id}
                  rotulo="Retirar bloqueio"
                  confirmar="Retirar o bloqueio? Faça isso só se a pessoa voltou a autorizar o contato (fica registrado). Se ela negou na aba Comunicação, continua negado até autorizar de novo por lá ou pelo link dela."
                />
              )}
            </Celula>
          </tr>
        ))}
        {bloqueios.length === 0 && <LinhaVazia colunas={5}>Ninguém pediu para sair da lista.</LinhaVazia>}
      </Tabela>
      <div className="mt-6">
        <Cartao titulo="Registro de preferências (não se apaga)">
          {!(log ?? []).length ? (
            <p className="text-sm text-mudo">Nenhuma mudança registrada ainda.</p>
          ) : (
            <ul className="divide-y divide-borda-suave text-sm">
              {((log ?? []) as Lg[]).map((l) => (
                <li key={l.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
                  <span>
                    {quem(l)} <span className={l.concedido ? "text-ok" : "text-ruim"}>{l.concedido ? "voltou a aceitar" : "não quer"}</span>{" "}
                    {(ROTULO_CANAL_DESCADASTRO[l.canal] ?? l.canal).toLowerCase()}
                    <span className="block text-xs text-mudo">
                      {ORIGEM[l.origem] ?? l.origem}
                      {l.detalhe ? ` · ${l.detalhe}` : ""}
                    </span>
                  </span>
                  <span className="whitespace-nowrap text-xs text-mudo">{formatarDataHora(l.em)}</span>
                </li>
              ))}
            </ul>
          )}
        </Cartao>
      </div>
    </>
  );
}
