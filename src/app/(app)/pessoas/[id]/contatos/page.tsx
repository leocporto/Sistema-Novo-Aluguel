import type { Metadata } from "next";
import Link from "next/link";
import { Link2, MessageCircle } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDocumento } from "@/lib/dominio/documentos";
import { TIPOS_VINCULO } from "@/lib/tipos";
import { linkWhatsapp } from "@/lib/whatsapp";
import { adicionarVinculo, excluirVinculo } from "../../actions";

export const metadata: Metadata = { title: "Contatos vinculados" };

type Outro = { id: string; nome: string; telefone: string | null; email: string | null; documento: string | null };
type V = { id: string; tipo: string; observacao: string | null; outro: Outro };

export default async function ContatosPage({ params }: PageProps<"/pessoas/[id]/contatos">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const campos = "id, nome, telefone, email, documento";
  const [{ data: meus }, { data: deles }, { data: pessoas }] = await Promise.all([
    supabase.from("pessoa_vinculos").select(`id, tipo, observacao, outro:pessoas!pessoa_vinculos_vinculado_id_fkey(${campos})`).eq("pessoa_id", id),
    supabase.from("pessoa_vinculos").select(`id, tipo, observacao, outro:pessoas!pessoa_vinculos_pessoa_id_fkey(${campos})`).eq("vinculado_id", id),
    supabase.from("pessoas").select("id, nome").neq("id", id).order("nome").limit(2000),
  ]);
  const vinculos = [...((meus ?? []) as unknown as V[]), ...((deles ?? []) as unknown as V[])];

  return (
    <Cartao
      titulo={`Contatos vinculados (${vinculos.length})`}
      acoes={
        <JanelaCadastro rotuloBotao={<><Link2 className="size-4" /> Vincular contato</>} titulo="Vincular contato" acao={adicionarVinculo} rotuloSalvar="Vincular" icone={<Link2 />} tamanho="sm">
          <input type="hidden" name="pessoa_id" value={id} />
          <Campo rotulo="Tipo de vínculo">
            <Selecao name="tipo" defaultValue="conjuge">
              {Object.entries(TIPOS_VINCULO).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Pessoa já cadastrada">
            <Selecao name="vinculado_id" defaultValue="">
              <option value="">— cadastrar uma nova abaixo —</option>
              {(pessoas ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <div className="rounded-[14px] border border-borda-suave p-3">
            <p className="mb-3 text-xs text-mudo">Ou cadastre uma pessoa nova (deixe a de cima em branco):</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Campo rotulo="Nome">
                <Entrada name="novo_nome" />
              </Campo>
              <Campo rotulo="CPF/CNPJ">
                <Entrada name="novo_documento" inputMode="numeric" />
              </Campo>
              <Campo rotulo="Telefone">
                <Entrada name="novo_telefone" inputMode="tel" />
              </Campo>
            </div>
          </div>
          <Campo rotulo="Observação">
            <Entrada name="observacao" placeholder="Ex.: assina pelo proprietário, procuração até 2027" />
          </Campo>
        </JanelaCadastro>
      }
    >
      {vinculos.length === 0 ? (
        <p className="text-sm text-mudo">Nenhum contato vinculado. Cadastre cônjuge, representante legal, procurador, sócios…</p>
      ) : (
        <ul className="divide-y divide-borda-suave">
          {vinculos.map((v) => (
            <li key={v.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/pessoas/${v.outro.id}`} className="font-semibold text-acento hover:underline">
                  {v.outro.nome}
                </Link>
                <div className="text-xs text-mudo">
                  {TIPOS_VINCULO[v.tipo] ?? v.tipo}
                  {v.outro.documento ? ` · ${formatarDocumento(v.outro.documento)}` : ""}
                  {v.outro.telefone ? ` · ${v.outro.telefone}` : ""}
                  {v.outro.email ? ` · ${v.outro.email}` : ""}
                  {v.observacao ? ` · ${v.observacao}` : ""}
                </div>
              </div>
              {v.outro.telefone && (
                <a
                  href={linkWhatsapp(v.outro.telefone, `Olá ${v.outro.nome.split(" ")[0]}!`)}
                  target="_blank"
                  rel="noreferrer"
                  title="WhatsApp"
                  className="grid size-8 place-items-center rounded-[9px] border border-ok-bd bg-ok-bg text-ok"
                >
                  <MessageCircle className="size-4" />
                </a>
              )}
              <BotaoExcluir acao={excluirVinculo} id={v.id} rotulo="Desfazer vínculo" confirmar={`Desfazer o vínculo com ${v.outro.nome}? O cadastro dela continua.`} />
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}
