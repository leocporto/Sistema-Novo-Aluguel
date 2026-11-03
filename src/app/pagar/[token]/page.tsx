import type { Metadata } from "next";
import type { ReactNode } from "react";
import { pixDaCobranca } from "@/app/(app)/cobrancas/dados";
import { DocumentoCobranca } from "@/app/(app)/faturas/documento-cobranca";
import { Copiar } from "@/components/copiar";
import { identificacaoImovel, situacaoFatura, type ImovelEndereco } from "@/lib/dominio/cobrancas";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { formatarReais, paraCentavos } from "@/lib/dominio/dinheiro";
import { clienteAnonimo } from "@/lib/supabase/anonimo";
import { criarClienteServidor } from "@/lib/supabase/server";
import { FormJaPaguei } from "./form";
import { RegistrarVisita } from "./visita";

export const metadata: Metadata = { title: "2ª via de pagamento", robots: { index: false } };

type Num = number | string;
type Via = {
  tipo: "fatura" | "parcela";
  organizacao: {
    nome: string;
    documento: string | null;
    telefone: string | null;
    email: string | null;
    pix_chave: string | null;
    pix_nome: string | null;
    pix_cidade: string | null;
    meios: string[] | null;
    instrucoes: string | null;
    banco: string | null;
    agencia: string | null;
    conta: string | null;
  };
  imovel: ImovelEndereco;
  locatario: string | null;
  contrato: { numero: number; multa_pct: Num; juros_mes_pct: Num; carencia_dias: number; pontualidade_pct: Num | null; valor_aluguel: Num };
  fatura: {
    numero: number;
    competencia: string;
    vencimento: string;
    valor_total: Num;
    valor_abatido: Num;
    valor_recebido: Num;
    status: string;
    pago_em: string | null;
    valor_pago: Num | null;
    linha_digitavel: string | null;
    url_pagamento: string | null;
    periodo_inicio: string | null;
    periodo_fim: string | null;
    itens: { descricao: string; valor: Num }[];
    multa_cobrada: Num;
    ultimo_pagamento: string | null;
  } | null;
  parcela: { numero: number; vencimento: string; valor: Num; status: string; pago_em: string | null; acordo: number; parcelas: number; tem_entrada: boolean } | null;
};

/** Página pública (sem login): 2ª via com Pix copia e cola e o botão "Já paguei". */
export default async function PagarPage({ params }: PageProps<"/pagar/[token]">) {
  const { token } = await params;
  const valido = /^[0-9a-f-]{36}$/i.test(token);
  const { data } = valido ? await clienteAnonimo().rpc("segunda_via", { p_token: token }) : { data: null };
  const via = data as Via | null;
  const hoje = hojeISO();
  // Alguém da equipe conferindo (logado): não conta como "link aberto" pelo locatário.
  const logado = Boolean((await (await criarClienteServidor()).auth.getClaims()).data?.claims?.sub);
  const o = via?.organizacao;
  const meios = o?.meios ?? [];
  const recebedor = o?.pix_chave && meios.includes("pix") ? { chave: o.pix_chave, nome: o.pix_nome || o.nome, cidade: o.pix_cidade } : null;

  if (!via || !o)
    return (
      <main className="min-h-screen bg-app px-4 py-8">
        <div className="mx-auto max-w-2xl rounded-card border border-borda bg-card p-8 text-center text-texto-2">Link de pagamento inválido ou expirado. Fale com quem enviou.</div>
      </main>
    );

  let corpo: ReactNode = null;
  let aberta = false;
  if (via.tipo === "fatura" && via.fatura) {
    const f = via.fatura;
    aberta = f.status === "aberta";
    const abatido = paraCentavos(f.valor_abatido);
    const pagamentos = abatido
      ? [{ data: f.ultimo_pagamento ?? f.vencimento, valor: paraCentavos(f.valor_recebido), principal: abatido, multa: paraCentavos(f.multa_cobrada), juros: 0, desconto: 0 }]
      : [];
    const sit = aberta
      ? situacaoFatura(
          { valorTotal: paraCentavos(f.valor_total), vencimento: f.vencimento },
          pagamentos,
          { multaPct: Number(via.contrato.multa_pct), jurosMesPct: Number(via.contrato.juros_mes_pct), carenciaDias: via.contrato.carencia_dias },
          hoje,
          { pct: Number(via.contrato.pontualidade_pct ?? 0), aluguel: paraCentavos(via.contrato.valor_aluguel) },
        )
      : null;
    const total = sit ? (sit.diasAtraso > 0 ? sit.totalComEncargos : sit.saldo) : 0;
    corpo = (
      <DocumentoCobranca
        d={{
          organizacao: { nome: o.nome, documento: o.documento, telefone: o.telefone, email: o.email },
          numero: f.numero,
          competencia: f.competencia,
          vencimento: f.vencimento,
          periodoInicio: f.periodo_inicio,
          periodoFim: f.periodo_fim,
          locatario: via.locatario ? { nome: via.locatario } : null,
          imovel: via.imovel,
          itens: f.itens,
          status: f.status === "renegociada" ? "renegociada" : f.status,
          pagoEm: f.pago_em,
          valorPago: f.valor_pago,
          sit,
          hoje,
          multaPct: Number(via.contrato.multa_pct),
          jurosMesPct: Number(via.contrato.juros_mes_pct),
          carenciaDias: via.contrato.carencia_dias,
          pix: aberta ? pixDaCobranca(recebedor, total, `FAT${f.numero}`) : null,
          linhaDigitavel: f.linha_digitavel,
          urlPagamento: f.url_pagamento,
          meios,
          banco: { banco: o.banco, agencia: o.agencia, conta: o.conta },
          instrucoes: o.instrucoes,
        }}
      />
    );
    if (f.status === "renegociada")
      corpo = (
        <div className="rounded-card border border-borda bg-card p-6 text-texto-2">
          Este aluguel entrou num acordo de pagamento. Use o link da parcela do acordo enviado por {o.nome}.
        </div>
      );
  } else if (via.parcela) {
    const p = via.parcela;
    aberta = p.status === "aberta";
    const pix = aberta ? pixDaCobranca(recebedor, paraCentavos(p.valor), `AC${p.acordo}P${p.numero}`) : null;
    corpo = (
      <article className="rounded-card border border-borda bg-card p-6 text-texto">
        <div className="text-sm text-mudo">{o.nome}</div>
        <h2 className="mt-1 text-[20px] font-semibold">
          Acordo nº {p.acordo} · {p.numero === 0 ? "entrada" : `parcela ${p.numero} de ${p.parcelas}`}
        </h2>
        <p className="mt-1 text-sm text-texto-2">
          {via.locatario ?? ""} · {identificacaoImovel(via.imovel)}
        </p>
        <div className="mt-4 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-sm text-texto-2">Vencimento {formatarDataBR(p.vencimento)}</div>
            <div className="text-[28px] font-semibold tabular-nums">{formatarReais(p.valor)}</div>
          </div>
          {p.status === "paga" && <span className="text-sm font-medium text-ok">Paga em {formatarDataBR(p.pago_em)}. Obrigado!</span>}
        </div>
        {pix && (
          <div className="mt-4 rounded-[14px] border border-borda bg-elev p-3">
            <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-semibold">Pix copia e cola</span>
              <Copiar texto={pix} rotulo="Copiar código Pix" />
            </div>
            <div className="break-all font-mono text-[11px] text-texto-2">{pix}</div>
          </div>
        )}
        {o.instrucoes && <p className="mt-3 whitespace-pre-line text-sm text-texto-2">{o.instrucoes}</p>}
      </article>
    );
  }

  return (
    <main className="min-h-screen bg-app px-4 py-8">
      <div className="mx-auto max-w-3xl space-y-5">
        {logado ? (
          <div className="rounded-[14px] border border-borda bg-elev px-4 py-2.5 text-sm text-texto-2">
            Você está logado no sistema: esta é a página que o locatário vê. Sua visita não é marcada como “link aberto”.
          </div>
        ) : (
          via.tipo === "fatura" && <RegistrarVisita token={token} />
        )}
        {corpo}
        {aberta && (
          <section className="rounded-card border border-borda bg-card p-5">
            <h2 className="mb-1 text-[16px] font-semibold text-texto">Já pagou?</h2>
            <p className="mb-3 text-sm text-texto-2">Avise por aqui que a gente confere e dá a baixa.</p>
            <FormJaPaguei token={token} hoje={hoje} />
          </section>
        )}
        <p className="text-center text-xs text-mudo">2ª via gerada por {o.nome} · Novo Aluguel</p>
      </div>
    </main>
  );
}
