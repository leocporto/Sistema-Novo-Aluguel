import type { Metadata } from "next";
import Link from "next/link";
import { LinhaLink } from "@/components/linha-link";
import { PilulasLink } from "@/components/pilulas-link";
import { Aviso, BotaoLink, Cabecalho, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_SITUACAO_JURIDICO } from "@/lib/dominio/cobrancas";
import { formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasCobrancas } from "../abas";
import { configCobranca } from "../dados";

export const metadata: Metadata = { title: "Cobrança jurídica" };

type Caso = {
  id: string;
  encaminhado_em: string;
  escritorio: string | null;
  responsavel: string | null;
  numero_processo: string | null;
  situacao: string;
  valor_encaminhado: number;
  proxima_acao: string | null;
  contrato: { id: string; numero: number; imovel: { codigo: string } | null } | null;
  pessoa: { nome: string } | null;
};

export default async function JuridicoPage({ searchParams }: PageProps<"/cobrancas/juridico">) {
  const sp = await searchParams;
  const ver = sp.ver === "encerrados" ? "encerrados" : sp.ver === "todos" ? "todos" : "andamento";
  const { supabase, organizacao } = await obterContexto();
  const cfg = configCobranca(organizacao);
  let q = supabase
    .from("cobrancas_juridicas")
    .select("id, encaminhado_em, escritorio, responsavel, numero_processo, situacao, valor_encaminhado, proxima_acao, contrato:contratos(id, numero, imovel:imoveis(codigo)), pessoa:pessoas(nome)")
    .order("encaminhado_em", { ascending: false })
    .limit(500);
  if (ver === "andamento") q = q.not("situacao", "in", "(pago,encerrado)");
  if (ver === "encerrados") q = q.in("situacao", ["pago", "encerrado"]);
  const { data } = await q;
  const casos = (data ?? []) as unknown as Caso[];

  return (
    <>
      <Cabecalho
        titulo="Cobrança jurídica"
        trilha="Cobranças"
        descricao="Débitos encaminhados ao advogado: escritório, responsável, processo e situação. Cobranças no jurídico ficam fora da régua de avisos."
        acoes={
          <BotaoLink href="/cobrancas" variante="secundario">
            Encaminhar a partir de “Quem deve”
          </BotaoLink>
        }
      />
      <AbasCobrancas />
      <div className="mb-4">
        <Aviso tipo="info">Sugestão: encaminhar quando o atraso passar de {cfg.juridicoDias} dias (ajuste em Régua e Pix). O sistema marca esses devedores em “Quem deve”.</Aviso>
      </div>
      <PilulasLink
        className="mb-4"
        rotulo="Situação dos casos"
        ativo={`/cobrancas/juridico?ver=${ver}`}
        itens={[
          { href: "/cobrancas/juridico?ver=andamento", rotulo: "Em andamento" },
          { href: "/cobrancas/juridico?ver=encerrados", rotulo: "Encerrados" },
          { href: "/cobrancas/juridico?ver=todos", rotulo: "Todos" },
        ]}
      />
      <Tabela colunas={["Locatário", "Contrato", "Encaminhado", "Escritório", "Processo", "Valor", "Próxima ação", "Situação"]}>
        {casos.length === 0 && <LinhaVazia colunas={8}>Nenhum caso nesta lista.</LinhaVazia>}
        {casos.map((c) => (
          <LinhaLink key={c.id} href={`/cobrancas/juridico/${c.id}`}>
            <Celula className="font-medium">
              <Link href={`/cobrancas/juridico/${c.id}`} className="hover:text-acento">
                {c.pessoa?.nome ?? "—"}
              </Link>
            </Celula>
            <Celula>
              {c.contrato ? `#${c.contrato.numero}` : "—"}
              {c.contrato?.imovel && <span className="block text-xs text-mudo">{c.contrato.imovel.codigo}</span>}
            </Celula>
            <Celula>{formatarDataBR(c.encaminhado_em)}</Celula>
            <Celula>
              {c.escritorio ?? "—"}
              {c.responsavel && <span className="block text-xs text-mudo">{c.responsavel}</span>}
            </Celula>
            <Celula>{c.numero_processo ?? "—"}</Celula>
            <Celula className="tabular-nums">{formatarReais(c.valor_encaminhado)}</Celula>
            <Celula>{formatarDataBR(c.proxima_acao)}</Celula>
            <Celula>
              <Selo cor={c.situacao === "pago" ? "verde" : c.situacao === "encerrado" ? "cinza" : c.situacao === "acao_ajuizada" ? "vermelho" : "amarelo"}>{ROTULO_SITUACAO_JURIDICO[c.situacao] ?? c.situacao}</Selo>
            </Celula>
          </LinhaLink>
        ))}
      </Tabela>
    </>
  );
}
