import type { Metadata } from "next";
import Link from "next/link";
import { MessageCircle, UserMinus, UserPlus } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { PilulasLink } from "@/components/pilulas-link";
import { Campo, Celula, Entrada, Grade, LinhaVazia, Selecao, Selo, Tabela, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { PAPEIS_CONDOMINIO, nomeUnidade } from "@/lib/dominio/condominios";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { linkWhatsapp } from "@/lib/whatsapp";
import { encerrarVinculo, excluirVinculo, vincularPessoa } from "../../actions";
import { opcoesPessoas, unidadesDo, vinculosDo } from "../../dados";

export const metadata: Metadata = { title: "Pessoas do condomínio" };

const COR_PAPEL: Record<string, "azul" | "verde" | "amarelo" | "cinza"> = {
  proprietario: "azul",
  inquilino: "verde",
  morador: "cinza",
  sindico: "amarelo",
  subsindico: "amarelo",
  conselheiro: "amarelo",
};

/** Condôminos (proprietários), inquilinos, moradores, síndico, subsíndico e conselho. A pessoa vem do cadastro de Pessoas. */
export default async function PessoasCondominio({ params, searchParams }: PageProps<"/condominios/[id]/pessoas">) {
  const { id } = await params;
  const sp = await searchParams;
  const todos = sp.ver === "todos";
  const { supabase } = await obterContexto();
  const [vinculos, unidades, pessoas] = await Promise.all([vinculosDo(supabase, id, todos), unidadesDo(supabase, id), opcoesPessoas(supabase)]);
  const nomeU = new Map(unidades.map((u) => [u.id, nomeUnidade(u)]));
  const ordem = Object.keys(PAPEIS_CONDOMINIO);
  const lista = [...vinculos].sort(
    (a, b) =>
      (a.unidade_id ? 1 : 0) - (b.unidade_id ? 1 : 0) ||
      (nomeU.get(a.unidade_id ?? "") ?? "").localeCompare(nomeU.get(b.unidade_id ?? "") ?? "", "pt-BR", { numeric: true }) ||
      ordem.indexOf(a.papel) - ordem.indexOf(b.papel),
  );
  const hoje = hojeISO();
  const base = `/condominios/${id}/pessoas`;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PilulasLink
          rotulo="Vínculos"
          ativo={todos ? `${base}?ver=todos` : base}
          itens={[
            { href: base, rotulo: "Em vigor" },
            { href: `${base}?ver=todos`, rotulo: "Com histórico" },
          ]}
        />
        <JanelaCadastro rotuloBotao={<><UserPlus className="size-4" /> Ligar pessoa</>} titulo="Ligar pessoa ao condomínio" acao={vincularPessoa} icone={<UserPlus />}>
          <input type="hidden" name="condominio_id" value={id} />
          <Campo rotulo="Pessoa" dica="Do cadastro de Pessoas. Não achou? Cadastre em Pessoas primeiro.">
            <Selecao name="pessoa_id" required defaultValue="">
              <option value="" disabled>
                Escolha…
              </option>
              {pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Grade colunas={2}>
            <Campo rotulo="Papel">
              <Selecao name="papel" defaultValue="proprietario">
                {Object.entries(PAPEIS_CONDOMINIO).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Unidade" dica="Obrigatória para condômino, inquilino e morador.">
              <Selecao name="unidade_id" defaultValue="">
                <option value="">Sem unidade (síndico profissional, conselho…)</option>
                {unidades.map((u) => (
                  <option key={u.id} value={u.id}>
                    {nomeUnidade(u)}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Desde">
              <Entrada name="inicio" type="date" defaultValue={hoje} />
            </Campo>
          </Grade>
          <label className="flex items-center gap-2 text-sm text-texto-2">
            <input type="hidden" name="responsavel_financeiro" value="off" />
            <input type="checkbox" name="responsavel_financeiro" className="size-4 accent-[var(--accent)]" /> Responsável financeiro (recebe as cotas e cobranças)
          </label>
        </JanelaCadastro>
      </div>

      <Tabela colunas={["Unidade", "Pessoa", "Papel", "Contato", "Desde", ""]}>
        {lista.map((v) => {
          const encerrado = Boolean(v.fim && v.fim < hoje);
          return (
            <tr key={v.id} className={encerrado ? "opacity-60" : ""}>
              <Celula className="font-medium">{v.unidade_id ? nomeU.get(v.unidade_id) : <span className="text-mudo">—</span>}</Celula>
              <Celula>
                <Link href={`/pessoas/${v.pessoa_id}`} className="text-texto hover:underline">
                  {v.pessoa?.nome ?? "—"}
                </Link>
              </Celula>
              <Celula>
                <span className="flex flex-wrap gap-1">
                  <Selo cor={COR_PAPEL[v.papel] ?? "cinza"}>{PAPEIS_CONDOMINIO[v.papel as keyof typeof PAPEIS_CONDOMINIO] ?? v.papel}</Selo>
                  {v.responsavel_financeiro && <Selo cor="verde">financeiro</Selo>}
                  {v.fim && <Selo cor="cinza">até {formatarDataBR(v.fim)}</Selo>}
                </span>
              </Celula>
              <Celula className="text-sm text-texto-2">
                {v.pessoa?.telefone ? (
                  <a href={linkWhatsapp(v.pessoa.telefone)} target="_blank" rel="noreferrer" className={classeBotao("secundario", "sm")}>
                    <MessageCircle className="size-3.5" /> {v.pessoa.telefone}
                  </a>
                ) : (
                  (v.pessoa?.email ?? "—")
                )}
              </Celula>
              <Celula className="text-sm text-texto-2">{formatarDataBR(v.inicio)}</Celula>
              <Celula>
                <span className="flex justify-end gap-2">
                  {!v.fim && (
                    <BotaoAcao acao={encerrarVinculo} id={v.id} tamanho="sm" confirmar={`Encerrar hoje o vínculo de ${v.pessoa?.nome ?? "esta pessoa"}? O histórico fica guardado.`}>
                      <UserMinus className="size-3.5" /> Encerrar
                    </BotaoAcao>
                  )}
                  <BotaoExcluir acao={excluirVinculo} id={v.id} rotulo="Excluir vínculo" confirmar="Excluir este vínculo (lançado errado)? Para quem mudou ou vendeu, use “Encerrar”." />
                </span>
              </Celula>
            </tr>
          );
        })}
        {lista.length === 0 && <LinhaVazia colunas={6}>Ninguém ligado ao condomínio ainda.</LinhaVazia>}
      </Tabela>
    </div>
  );
}
