import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, PhoneCall } from "lucide-react";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { AreaTexto, Campo, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { ROTULO_FUNIL, ROTULO_PRIORIDADE, rotuloEtapa } from "@/lib/dominio/crm";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { diaLocal } from "@/lib/dominio/agenda";
import { linkWhatsapp } from "@/lib/whatsapp";
import { registrarContatoCorretor } from "../actions";
import { contextoCorretor, portalCorretor, semVinculo } from "../dados";
import { AvisoSemVinculo, TopoCorretor } from "../topo";

export const metadata: Metadata = { title: "Clientes e leads" };

type Lead = {
  id: string;
  nome: string;
  telefone: string | null;
  email: string | null;
  status: string;
  funil: string;
  prioridade: string;
  origem: string;
  proximo_contato: string | null;
  ultimo_contato: string | null;
  criado_em: string;
  imovel: string | null;
};

const ABERTOS = (s: string) => s !== "ganho" && s !== "perdido";

/** Leads atribuídos ao corretor: registrar contato e próximo retorno; o resto na ficha do lead. */
export default async function LeadsCorretorPage({ searchParams }: PageProps<"/corretor/leads">) {
  const sp = await searchParams;
  const ctx = await contextoCorretor(sp);
  const filtro = sp.ver === "todos" ? "todos" : sp.ver === "retorno" ? "retorno" : "abertos";
  const d = await portalCorretor<Lead[]>(ctx.supabase, "leads", ctx.escolhido);
  const hoje = hojeISO();
  const url = (ver: string) => `/corretor/leads?${new URLSearchParams({ ...(ctx.escolhido ? { corretor: ctx.escolhido } : {}), ...(ver === "abertos" ? {} : { ver }) }).toString()}`.replace(/\?$/, "");
  return (
    <>
      <TopoCorretor ctx={ctx} titulo="Clientes e leads" descricao="Leads atribuídos a você. Registre cada contato e marque o próximo retorno; mudar etapa, transferir ou fazer proposta é na ficha do lead." />
      {semVinculo(d) ? (
        <AvisoSemVinculo ctx={ctx} />
      ) : (
        <>
          <div className="mb-4">
            <PilulasLink
              rotulo="Mostrar"
              ativo={url(filtro)}
              itens={[
                { href: url("abertos"), rotulo: `Em aberto (${d.filter((l) => ABERTOS(l.status)).length})` },
                { href: url("retorno"), rotulo: "Retorno até hoje" },
                { href: url("todos"), rotulo: "Todos (6 meses)" },
              ]}
            />
          </div>
          <Tabela colunas={["Cliente", "Etapa", "Interesse", "Último contato", "Próximo retorno", ""]}>
            {(() => {
              const lista = d.filter((l) => (filtro === "todos" ? true : filtro === "retorno" ? ABERTOS(l.status) && l.proximo_contato && l.proximo_contato <= hoje : ABERTOS(l.status)));
              if (lista.length === 0) return <LinhaVazia colunas={6}>Nenhum lead aqui.</LinhaVazia>;
              return lista.map((l) => (
                <tr key={l.id}>
                  <Celula>
                    <Link href={`/comercial/leads/${l.id}`} className="font-medium text-texto hover:underline">
                      {l.nome}
                    </Link>
                    <span className="block text-xs text-mudo">{[l.telefone, l.email].filter(Boolean).join(" · ") || "sem contato"}</span>
                  </Celula>
                  <Celula>
                    <Selo cor={l.status === "ganho" ? "verde" : l.status === "perdido" ? "cinza" : l.status === "novo" ? "amarelo" : "azul"}>{rotuloEtapa(l.funil, l.status)}</Selo>
                    <span className="mt-1 block text-xs text-mudo">{ROTULO_PRIORIDADE[l.prioridade] ?? l.prioridade}</span>
                  </Celula>
                  <Celula className="text-sm">
                    {ROTULO_FUNIL[l.funil as keyof typeof ROTULO_FUNIL] ?? l.funil}
                    {l.imovel ? ` · ${l.imovel}` : ""}
                  </Celula>
                  <Celula className="text-sm">{l.ultimo_contato ? formatarDataBR(diaLocal(l.ultimo_contato)) : <span className="text-mudo">nunca</span>}</Celula>
                  <Celula className="text-sm">
                    {l.proximo_contato ? <span className={l.proximo_contato <= hoje && ABERTOS(l.status) ? "font-semibold text-alerta" : ""}>{formatarDataBR(l.proximo_contato)}</span> : "—"}
                  </Celula>
                  <Celula>
                    <div className="flex flex-wrap justify-end gap-2">
                      {l.telefone && (
                        <a href={linkWhatsapp(l.telefone)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                          <MessageCircle className="size-3.5" /> WhatsApp
                        </a>
                      )}
                      <JanelaCadastro
                        rotuloBotao={
                          <>
                            <PhoneCall className="size-3.5" /> Registrar contato
                          </>
                        }
                        titulo={`Contato com ${l.nome}`}
                        acao={registrarContatoCorretor}
                        tamanho="sm"
                        variante="secundario"
                        rotuloSalvar="Registrar"
                      >
                        <input type="hidden" name="lead_id" value={l.id} />
                        <Campo rotulo="Como foi">
                          <Selecao name="tipo" defaultValue="whatsapp">
                            <option value="ligacao">Ligação</option>
                            <option value="whatsapp">WhatsApp</option>
                            <option value="email">E-mail</option>
                            <option value="reuniao">Reunião</option>
                            <option value="nota">Só anotação</option>
                          </Selecao>
                        </Campo>
                        <Campo rotulo="O que foi conversado">
                          <AreaTexto name="descricao" required rows={3} />
                        </Campo>
                        <Campo rotulo="Próximo retorno">
                          <Entrada type="date" name="proximo_contato" min={hoje} defaultValue={l.proximo_contato ?? ""} />
                        </Campo>
                      </JanelaCadastro>
                    </div>
                  </Celula>
                </tr>
              ));
            })()}
          </Tabela>
          <p className="mt-3 text-xs text-mudo">
            Para ver o funil completo, use o <Link href="/comercial" className="text-acento hover:underline">Comercial</Link>.
          </p>
        </>
      )}
    </>
  );
}
