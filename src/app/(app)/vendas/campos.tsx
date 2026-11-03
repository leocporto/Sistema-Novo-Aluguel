import { SubAbas } from "@/components/sub-abas";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { ROTULO_FORMA_PAGAMENTO } from "@/lib/dominio/vendas";
import type { OpcaoNome } from "./dados";

export function AbasVendas() {
  return (
    <SubAbas
      rotulo="Vendas"
      itens={[
        { href: "/vendas", rotulo: "Vendas em andamento" },
        { href: "/vendas/comissoes", rotulo: "Comissões" },
      ]}
    />
  );
}

function Lista({ name, opcoes, vazio = "— nenhum —", padrao }: { name: string; opcoes: OpcaoNome[]; vazio?: string; padrao?: string }) {
  return (
    <Selecao name={name} defaultValue={padrao ?? ""}>
      <option value="">{vazio}</option>
      {opcoes.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nome}
        </option>
      ))}
    </Selecao>
  );
}

/** Campos para abrir uma venda (negociação) direto, sem passar pela tela de propostas. */
export function CamposNovaVenda({
  opcoes,
  padrao = {},
}: {
  opcoes: { imoveis: { id: string; codigo: string; logradouro: string | null; numero: string | null; valor_venda: number | null }[]; pessoas: OpcaoNome[]; corretores: OpcaoNome[]; leads: OpcaoNome[] };
  padrao?: { imovelId?: string; leadId?: string };
}) {
  return (
    <>
      <Campo rotulo="Imóvel">
        <Selecao name="imovel_id" required defaultValue={padrao.imovelId ?? ""}>
          <option value="">Selecione…</option>
          {opcoes.imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {[i.codigo, [i.logradouro, i.numero].filter(Boolean).join(", ")].filter(Boolean).join(" — ")}
            </option>
          ))}
        </Selecao>
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Comprador (cadastrado em Pessoas)">
          <Lista name="comprador_id" opcoes={opcoes.pessoas} />
        </Campo>
        <Campo rotulo="Ou lead">
          <Lista name="lead_id" opcoes={opcoes.leads} padrao={padrao.leadId} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Ou nome do comprador">
          <Entrada name="comprador_nome" />
        </Campo>
        <Campo rotulo="Telefone">
          <Entrada name="comprador_telefone" inputMode="tel" />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Valor negociado (R$)">
          <Entrada name="valor" inputMode="decimal" />
        </Campo>
        <Campo rotulo="Pagamento">
          <Selecao name="forma_pagamento" defaultValue="a_vista">
            {Object.entries(ROTULO_FORMA_PAGAMENTO).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Comissão (%)">
          <Entrada name="comissao_pct" inputMode="decimal" defaultValue="6" />
        </Campo>
      </div>
      <Campo rotulo="Corretor da venda">
        <Lista name="corretor_id" opcoes={opcoes.corretores} />
      </Campo>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} />
      </Campo>
    </>
  );
}
