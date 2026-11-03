import type { Metadata } from "next";
import Link from "next/link";
import { LinhaLink } from "@/components/linha-link";
import { Aviso, Cabecalho, Celula, LinhaVazia, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { textoDias } from "@/lib/dominio/cobrancas";
import { hojeISO, somarMeses } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { AbasCobrancas } from "../../abas";
import { carregarCobrancas, reais } from "../../dados";
import { SimuladorAcordo } from "./simulador";

export const metadata: Metadata = { title: "Novo acordo" };

export default async function NovoAcordoPage({ searchParams }: PageProps<"/cobrancas/acordos/novo">) {
  const sp = await searchParams;
  const contratoId = typeof sp.contrato === "string" ? sp.contrato : "";
  const { supabase } = await obterContexto();
  const hoje = hojeISO();

  if (!contratoId) {
    const todas = (await carregarCobrancas(supabase, hoje)).filter((c) => c.dias > 0 && !c.juridicoAtivo);
    const grupos = [...Map.groupBy(todas, (c) => c.contratoId).values()].sort((a, b) => Math.max(...b.map((c) => c.dias)) - Math.max(...a.map((c) => c.dias)));
    return (
      <>
        <Cabecalho titulo="Novo acordo" trilha="Cobranças" descricao="Escolha o contrato com débitos para negociar." />
        <AbasCobrancas />
        <Tabela colunas={["Locatário", "Imóvel", "Contrato", "Cobranças vencidas", "Maior atraso", "Total hoje"]}>
          {grupos.length === 0 && <LinhaVazia colunas={6}>Nenhum contrato com aluguel vencido.</LinhaVazia>}
          {grupos.map((g) => (
            <LinhaLink key={g[0].contratoId} href={`/cobrancas/acordos/novo?contrato=${g[0].contratoId}`}>
              <Celula className="font-medium">{g[0].locatario?.nome ?? "—"}</Celula>
              <Celula>{g[0].imovelTexto}</Celula>
              <Celula>#{g[0].contratoNumero}</Celula>
              <Celula>{g.length}</Celula>
              <Celula>
                <Selo cor="vermelho">{textoDias(Math.max(...g.map((c) => c.dias)))}</Selo>
              </Celula>
              <Celula className="tabular-nums">{formatarReais(reais(g.reduce((s, c) => s + c.sit.totalComEncargos, 0)))}</Celula>
            </LinhaLink>
          ))}
        </Tabela>
      </>
    );
  }

  const debitos = await carregarCobrancas(supabase, hoje, { contratoId });
  const c0 = debitos[0];
  return (
    <>
      <Cabecalho
        titulo="Novo acordo"
        trilha="Cobranças"
        descricao={
          c0 ? (
            <>
              {c0.locatario?.nome ?? "Locatário"} · {c0.imovelTexto} ·{" "}
              <Link href={`/contratos/${contratoId}/cobrancas`} className="text-acento hover:underline">
                contrato #{c0.contratoNumero}
              </Link>
            </>
          ) : undefined
        }
      />
      <AbasCobrancas />
      {debitos.length === 0 ? (
        <Aviso tipo="info">Este contrato não tem cobrança em aberto para negociar (cobranças já em acordo não entram de novo).</Aviso>
      ) : (
        <SimuladorAcordo
          contratoId={contratoId}
          hoje={hoje}
          primeiroPadrao={somarMeses(hoje, 1)}
          debitos={debitos.map((c) => ({ faturaId: c.faturaId, numero: c.numero, competencia: c.competencia, vencimento: c.vencimento, dias: c.dias, saldo: c.sit.saldo, multa: c.sit.multa, juros: c.sit.juros }))}
        />
      )}
    </>
  );
}
