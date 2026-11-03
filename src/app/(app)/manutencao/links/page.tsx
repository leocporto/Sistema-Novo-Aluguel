import type { Metadata } from "next";
import Link from "next/link";
import { Link2, MessageCircle, RefreshCw } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Copiar } from "@/components/copiar";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { Aviso, Cabecalho, Celula, Entrada, LinhaVazia, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { normalizar } from "@/lib/dominio/imoveis";
import { mensagemLinkLocatario } from "@/lib/dominio/manutencao";
import { linkWhatsapp } from "@/lib/whatsapp";
import { AbasManutencao } from "../abas";
import { excluirLinkLocatario, gerarLinkLocatario, trocarLinkLocatario } from "../actions";
import { contratosAtivos, urlBase } from "../dados";

export const metadata: Metadata = { title: "Link do locatário" };

export default async function LinksLocatario({ searchParams }: PageProps<"/manutencao/links">) {
  const sp = await searchParams;
  const busca = typeof sp.busca === "string" ? sp.busca : "";
  const { supabase, organizacao } = await obterContexto();
  const [contratos, { data: links }, base, { data: abertos }] = await Promise.all([
    contratosAtivos(supabase),
    supabase.from("chamado_links").select("id, contrato_id, token, ativo, created_at"),
    urlBase(),
    supabase.from("chamados").select("contrato_id").eq("origem", "link").in("status", ["aberto", "em_analise"]),
  ]);
  const porContrato = new Map((links ?? []).map((l) => [l.contrato_id as string, l as { id: string; contrato_id: string; token: string; ativo: boolean }]));
  const novos = new Map<string, number>();
  for (const a of abertos ?? []) if (a.contrato_id) novos.set(a.contrato_id as string, (novos.get(a.contrato_id as string) ?? 0) + 1);
  let lista = contratos;
  if (busca) {
    const b = normalizar(busca);
    lista = lista.filter((c) => normalizar(`${c.numero} ${c.codigo ?? ""} ${c.imovel} ${c.locatario ?? ""}`).includes(b));
  }

  return (
    <>
      <Cabecalho
        titulo="Link do locatário"
        trilha="Manutenção"
        descricao="Cada contrato tem um link para o locatário pedir conserto sem senha: ele descreve o problema, escolhe a urgência, manda fotos e vídeos e acompanha o andamento."
      />
      <AbasManutencao />
      <div className="mb-4">
        <Aviso>
          O link é pessoal do contrato: quem tiver o link consegue abrir chamados daquele imóvel. Se ele for parar em mãos erradas, use <b>Trocar link</b> (o antigo para de funcionar). Envio automático por WhatsApp Business ou SMS fica pronto para ligar quando houver a integração contratada; por enquanto o botão abre o WhatsApp com a mensagem pronta.
        </Aviso>
      </div>
      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Entrada name="busca" aria-label="Buscar contrato, imóvel ou locatário" defaultValue={busca} placeholder="Buscar contrato, imóvel ou locatário…" className="max-w-80" />
      </FiltroAutomatico>
      <Tabela colunas={["Contrato", "Locatário", "Link", ""]}>
        {lista.map((c) => {
          const l = porContrato.get(c.id);
          const url = l ? `${base}/chamado/${l.token}` : null;
          return (
            <tr key={c.id}>
              <Celula>
                <Link href={`/contratos/${c.id}`} className="font-medium text-texto hover:underline">
                  #{c.numero}
                  {c.codigo ? ` (${c.codigo})` : ""} · {c.imovel}
                </Link>
                {(novos.get(c.id) ?? 0) > 0 && (
                  <span className="mt-1 block">
                    <Link href={`/manutencao?imovel=${c.imovel_id}`}>
                      <Selo cor="amarelo">{novos.get(c.id)} chamado(s) novo(s) pelo link</Selo>
                    </Link>
                  </span>
                )}
              </Celula>
              <Celula className="text-sm text-texto-2">{c.locatario ?? "—"}</Celula>
              <Celula>
                {url && l?.ativo ? (
                  <div className="flex max-w-md items-center gap-2">
                    <code className="min-w-0 flex-1 truncate text-xs text-texto-2" title={url}>
                      {url}
                    </code>
                    <Copiar texto={url} rotulo="Copiar" />
                  </div>
                ) : l && !l.ativo ? (
                  <Selo cor="cinza">desativado</Selo>
                ) : (
                  <span className="text-sm text-mudo">ainda não gerado</span>
                )}
              </Celula>
              <Celula>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  {(!l || !l.ativo) && (
                    <BotaoAcao acao={gerarLinkLocatario} id={c.id} tamanho="sm" variante="primario">
                      <Link2 className="size-3.5" /> {l ? "Reativar" : "Gerar link"}
                    </BotaoAcao>
                  )}
                  {url && l?.ativo && c.locatarioTelefone && (
                    <a
                      href={linkWhatsapp(c.locatarioTelefone, mensagemLinkLocatario({ locatario: c.locatario ?? "", link: url, organizacao: organizacao.nome }))}
                      target="_blank"
                      rel="noreferrer"
                      className={classeBotao("secundario", "sm")}
                    >
                      <MessageCircle className="size-3.5" /> Enviar
                    </a>
                  )}
                  {l?.ativo && (
                    <BotaoAcao acao={trocarLinkLocatario} id={l.id} tamanho="sm" confirmar="Trocar o link? O link antigo para de funcionar e você precisa mandar o novo ao locatário.">
                      <RefreshCw className="size-3.5" /> Trocar link
                    </BotaoAcao>
                  )}
                  {l && <BotaoExcluir acao={excluirLinkLocatario} id={l.id} rotulo="Apagar link" confirmar="Apagar o link deste contrato? O locatário não conseguirá mais abrir chamados por ele (os chamados já abertos continuam)." />}
                </div>
              </Celula>
            </tr>
          );
        })}
        {lista.length === 0 && <LinhaVazia colunas={4}>Nenhum contrato ativo.</LinhaVazia>}
      </Tabela>
    </>
  );
}
