import Link from "next/link";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { SubAbas } from "@/components/sub-abas";
import { ROTULO_INTERESSE, ROTULO_ORIGEM_LEAD } from "@/lib/tipos";

export type OpcaoImovel = { id: string; codigo: string; logradouro: string | null; numero: string | null };
export type OpcaoNome = { id: string; nome: string };

export const rotuloImovel = (i: Pick<OpcaoImovel, "codigo" | "logradouro" | "numero">) =>
  [i.codigo, [i.logradouro, i.numero].filter(Boolean).join(", ")].filter(Boolean).join(" — ");

export function AbasComercial() {
  return (
    <SubAbas
      rotulo="Comercial"
      itens={[
        { href: "/comercial", rotulo: "Leads" },
        { href: "/comercial/visitas", rotulo: "Visitas" },
        { href: "/comercial/propostas", rotulo: "Propostas" },
        { href: "/comercial/tarefas", rotulo: "Tarefas" },
        { href: "/comercial/metas", rotulo: "Metas" },
      ]}
    />
  );
}

function SelImovel({ imoveis, padrao, obrigatorio = false }: { imoveis: OpcaoImovel[]; padrao?: string | null; obrigatorio?: boolean }) {
  return (
    <Selecao name="imovel_id" defaultValue={padrao ?? ""} required={obrigatorio}>
      <option value="">{obrigatorio ? "Selecione…" : "— nenhum —"}</option>
      {imoveis.map((i) => (
        <option key={i.id} value={i.id}>
          {rotuloImovel(i)}
        </option>
      ))}
    </Selecao>
  );
}

function SelNome({ name, opcoes, padrao, vazio = "— nenhum —" }: { name: string; opcoes: OpcaoNome[]; padrao?: string | null; vazio?: string }) {
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

export function SemCorretor() {
  return (
    <p className="text-xs text-mudo">
      Para escolher corretor, cadastre a pessoa em{" "}
      <Link href="/pessoas/novo?papel=corretor" className="text-acento hover:underline">
        Pessoas
      </Link>{" "}
      com o papel “Corretor”.
    </p>
  );
}

export function CamposLead({
  imoveis,
  lead,
}: {
  imoveis: OpcaoImovel[];
  lead?: { nome: string; telefone: string | null; email: string | null; origem: string; interesse: string; imovel_id: string | null; observacoes: string | null };
}) {
  return (
    <>
      <Campo rotulo="Nome">
        <Entrada name="nome" required defaultValue={lead?.nome} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Telefone / WhatsApp">
          <Entrada name="telefone" inputMode="tel" defaultValue={lead?.telefone ?? ""} placeholder="(11) 99999-9999" />
        </Campo>
        <Campo rotulo="E-mail">
          <Entrada name="email" type="email" defaultValue={lead?.email ?? ""} />
        </Campo>
        <Campo rotulo="Origem">
          <Selecao name="origem" defaultValue={lead?.origem ?? "whatsapp"}>
            {Object.entries(ROTULO_ORIGEM_LEAD).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Quer">
          <Selecao name="interesse" defaultValue={lead?.interesse ?? "locacao"}>
            {Object.entries(ROTULO_INTERESSE).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <Campo rotulo="Imóvel de interesse">
        <SelImovel imoveis={imoveis} padrao={lead?.imovel_id} />
      </Campo>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={3} defaultValue={lead?.observacoes ?? ""} />
      </Campo>
    </>
  );
}

export function CamposVisita({
  imoveis,
  leads,
  corretores,
  leadId,
  imovelId,
  hoje,
}: {
  imoveis: OpcaoImovel[];
  leads: OpcaoNome[];
  corretores: OpcaoNome[];
  leadId?: string | null;
  imovelId?: string | null;
  hoje: string;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Data">
          <Entrada type="date" name="data" required defaultValue={hoje} />
        </Campo>
        <Campo rotulo="Hora">
          <Entrada type="time" name="hora" required defaultValue="10:00" />
        </Campo>
      </div>
      <Campo rotulo="Cliente (lead)">
        <SelNome name="lead_id" opcoes={leads} padrao={leadId} />
      </Campo>
      <Campo rotulo="Imóvel">
        <SelImovel imoveis={imoveis} padrao={imovelId} />
      </Campo>
      <Campo rotulo="Corretor">
        <SelNome name="corretor_id" opcoes={corretores} />
      </Campo>
      {corretores.length === 0 && <SemCorretor />}
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} />
      </Campo>
    </>
  );
}

export function CamposProposta({
  imoveis,
  leads,
  corretores,
  leadId,
  imovelId,
  tipo,
  pessoal,
}: {
  imoveis: OpcaoImovel[];
  leads: OpcaoNome[];
  corretores: OpcaoNome[];
  leadId?: string | null;
  imovelId?: string | null;
  tipo?: "locacao" | "venda";
  pessoal: boolean;
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo">
          <Selecao name="tipo" defaultValue={tipo ?? "locacao"}>
            <option value="locacao">Locação (valor do aluguel)</option>
            <option value="venda">Venda (valor de venda)</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Valor proposto (R$)">
          <Entrada name="valor" required inputMode="decimal" placeholder="2.500,00" />
        </Campo>
      </div>
      <Campo rotulo="Imóvel">
        <SelImovel imoveis={imoveis} padrao={imovelId} obrigatorio />
      </Campo>
      <Campo rotulo="Cliente (lead)">
        <SelNome name="lead_id" opcoes={leads} padrao={leadId} />
      </Campo>
      {!pessoal && (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Corretor">
              <SelNome name="corretor_id" opcoes={corretores} />
            </Campo>
            <Campo rotulo="Comissão do corretor (%)" dica="Sobre o valor proposto. Vira conta a pagar quando a proposta é aceita.">
              <Entrada name="comissao_pct" inputMode="decimal" placeholder="6" />
            </Campo>
          </div>
          {corretores.length === 0 && <SemCorretor />}
        </>
      )}
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} placeholder="Condições, prazo, forma de pagamento…" />
      </Campo>
    </>
  );
}

export function CamposTarefa({ leadId, imovelId, contratoId, hoje }: { leadId?: string; imovelId?: string; contratoId?: string; hoje: string }) {
  return (
    <>
      {leadId && <input type="hidden" name="lead_id" value={leadId} />}
      {imovelId && <input type="hidden" name="imovel_id" value={imovelId} />}
      {contratoId && <input type="hidden" name="contrato_id" value={contratoId} />}
      <Campo rotulo="O que fazer">
        <Entrada name="titulo" required placeholder="Ligar para o cliente, enviar documentos…" />
      </Campo>
      <Campo rotulo="Até quando">
        <Entrada type="date" name="vencimento" defaultValue={hoje} />
      </Campo>
      <label className="flex items-center gap-2 text-sm text-texto-2">
        <input type="checkbox" name="alta" /> Prioridade alta
      </label>
    </>
  );
}
