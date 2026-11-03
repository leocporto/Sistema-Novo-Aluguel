import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, Star, UserPlus, Users, Wrench } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { BotaoExcluir } from "@/components/botao-excluir";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { LinhaLink } from "@/components/linha-link";
import { Cabecalho, Campo, Celula, Entrada, Indicador, LinhaVazia, Selecao, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { normalizar } from "@/lib/dominio/imoveis";
import { estrelas, mediaNotas, resumoPrestadores } from "@/lib/dominio/manutencao";
import { linkWhatsapp } from "@/lib/whatsapp";
import { todas } from "../../financeiro/dados";
import { AbasManutencao } from "../abas";
import { criarPrestador, tirarPrestador } from "../actions";

export const metadata: Metadata = { title: "Prestadores de serviço" };

export default async function PrestadoresPage({ searchParams }: PageProps<"/manutencao/prestadores">) {
  const sp = await searchParams;
  const busca = typeof sp.busca === "string" ? sp.busca : "";
  const ordem = sp.ordem === "nota" || sp.ordem === "servicos" ? sp.ordem : "nome";
  const { supabase } = await obterContexto();
  const [{ data }, chamados] = await Promise.all([
    supabase.from("pessoas").select("id, nome, telefone, email, especialidade").contains("papeis", ["prestador"]).order("nome").limit(2000),
    todas<{ prestador_id: string | null; status: string; avaliacao_nota: number | null; valor_final: number | null; concluido_em: string | null }>(() =>
      supabase.from("chamados").select("prestador_id, status, avaliacao_nota, valor_final, concluido_em").not("prestador_id", "is", null).order("id"),
    ),
  ]);
  const resumo = resumoPrestadores(chamados);
  let lista = ((data ?? []) as { id: string; nome: string; telefone: string | null; email: string | null; especialidade: string | null }[]).map((p) => ({
    ...p,
    r: resumo.get(p.id) ?? { servicos: 0, avaliacoes: 0, media: null, gasto: 0, ultimo: null, emAndamento: 0 },
  }));
  if (busca) {
    const b = normalizar(busca);
    lista = lista.filter((p) => normalizar(`${p.nome} ${p.especialidade ?? ""}`).includes(b));
  }
  if (ordem === "nota") lista.sort((a, b) => (b.r.media ?? 0) - (a.r.media ?? 0) || b.r.servicos - a.r.servicos);
  if (ordem === "servicos") lista.sort((a, b) => b.r.servicos - a.r.servicos);
  const mediaGeral = mediaNotas(chamados.map((c) => c.avaliacao_nota));
  const emAndamento = [...resumo.values()].reduce((a, r) => a + r.emAndamento, 0);

  return (
    <>
      <Cabecalho
        titulo="Prestadores de serviço"
        trilha="Manutenção"
        descricao="Encanadores, eletricistas, pintores e outros profissionais. O cadastro completo fica em Pessoas (papel “Prestador de serviço”)."
        acoes={
          <JanelaCadastro rotuloBotao={<><UserPlus className="size-4" /> Novo prestador</>} titulo="Cadastrar prestador" acao={criarPrestador} icone={<UserPlus />}>
            <Campo rotulo="Nome">
              <Entrada name="nome" required />
            </Campo>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Especialidade">
                <Entrada name="especialidade" placeholder="Encanador, eletricista, pintor…" />
              </Campo>
              <Campo rotulo="Tipo">
                <Selecao name="tipo_pessoa" defaultValue="PF">
                  <option value="PF">Pessoa física</option>
                  <option value="PJ">Empresa</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Telefone / WhatsApp">
                <Entrada name="telefone" inputMode="tel" />
              </Campo>
              <Campo rotulo="E-mail">
                <Entrada name="email" type="email" />
              </Campo>
            </div>
            <Campo rotulo="Chave Pix (para pagar)">
              <Entrada name="pix_chave" />
            </Campo>
          </JanelaCadastro>
        }
      />
      <AbasManutencao />

      <div className="entrar-cascata mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Indicador rotulo="Prestadores cadastrados" icone={<Users />} valor={<Contador valor={(data ?? []).length} />} />
        <Indicador rotulo="Serviços em andamento" icone={<Wrench />} valor={<Contador valor={emAndamento} />} detalhe="com prestador escolhido" />
        <Indicador rotulo="Nota média" icone={<Star />} valor={mediaGeral != null ? String(mediaGeral).replace(".", ",") : "—"} detalhe={mediaGeral != null ? estrelas(mediaGeral) : "nenhuma avaliação ainda"} />
      </div>

      <FiltroAutomatico className="mb-4 flex flex-wrap gap-2">
        <Entrada name="busca" aria-label="Buscar prestador ou especialidade" defaultValue={busca} placeholder="Buscar nome ou especialidade…" className="max-w-72" />
        <Selecao name="ordem" aria-label="Ordenar prestadores" defaultValue={ordem} className="w-48">
          <option value="nome">Ordem alfabética</option>
          <option value="nota">Melhor avaliados</option>
          <option value="servicos">Mais serviços</option>
        </Selecao>
      </FiltroAutomatico>

      <Tabela colunas={["Prestador", "Contato", "Serviços", "Avaliação", "Total pago", "Último serviço", ""]}>
        {lista.map((p) => (
          <LinhaLink key={p.id} href={`/pessoas/${p.id}`}>
            <Celula>
              <Link href={`/pessoas/${p.id}`} className="font-medium text-texto hover:underline">
                {p.nome}
              </Link>
              <span className="block text-xs text-mudo">{p.especialidade ?? "sem especialidade"}</span>
            </Celula>
            <Celula>
              {p.telefone ? (
                <a href={linkWhatsapp(p.telefone, `Olá ${p.nome.split(" ")[0]}! Tudo bem?`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-acento hover:underline">
                  <MessageCircle className="size-3.5" /> {p.telefone}
                </a>
              ) : (
                <span className="text-sm text-mudo">{p.email ?? "—"}</span>
              )}
            </Celula>
            <Celula className="tabular-nums">
              {p.r.servicos}
              {p.r.emAndamento > 0 && <span className="block text-xs text-mudo">{p.r.emAndamento} em andamento</span>}
            </Celula>
            <Celula>
              {p.r.media != null ? (
                <span title={`${p.r.avaliacoes} avaliação(ões)`}>
                  <span className="text-alerta">{estrelas(p.r.media)}</span> <b className="tabular-nums">{String(p.r.media).replace(".", ",")}</b>
                  <span className="block text-xs text-mudo">{p.r.avaliacoes} avaliação(ões)</span>
                </span>
              ) : (
                <span className="text-sm text-mudo">sem nota</span>
              )}
            </Celula>
            <Celula className="tabular-nums">{p.r.gasto ? formatarReais(p.r.gasto) : "—"}</Celula>
            <Celula className="text-sm text-texto-2">{formatarDataBR(p.r.ultimo)}</Celula>
            <Celula>
              <BotaoExcluir acao={tirarPrestador} id={p.id} rotulo="Tirar da lista de prestadores" confirmar={`Tirar ${p.nome} da lista de prestadores? O cadastro continua em Pessoas.`} />
            </Celula>
          </LinhaLink>
        ))}
        {lista.length === 0 && <LinhaVazia colunas={7}>Nenhum prestador. Cadastre no botão acima ou marque o papel “Prestador de serviço” em Pessoas.</LinhaVazia>}
      </Tabela>
    </>
  );
}
