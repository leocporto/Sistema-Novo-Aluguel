import Link from "next/link";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { SubAbas } from "@/components/sub-abas";
import { ROTULO_ORIGEM_LEAD, TIPOS_IMOVEL } from "@/lib/tipos";

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
        { href: "/comercial/reativar", rotulo: "Reativar" },
        { href: "/comercial/conversao", rotulo: "Conversão" },
        { href: "/comercial/captacao", rotulo: "Captação de leads" },
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

export type LeadEditavel = {
  nome: string;
  telefone: string | null;
  email: string | null;
  origem: string;
  funil: string;
  prioridade: string;
  orcamento_min: number | string | null;
  orcamento_max: number | string | null;
  regioes: string | null;
  tipos: string[];
  quartos_min: number | null;
  etiquetas: string[];
  observacoes: string | null;
  proximo_contato: string | null;
};

const chipLead =
  "flex cursor-pointer items-center rounded-full border border-borda px-3 py-1.5 text-[13px] capitalize text-texto-2 transition hover:border-borda-forte has-[:checked]:border-acento has-[:checked]:bg-acento-bg has-[:checked]:text-acento-hot";

/** Campos do lead. Sem `lead` = cadastro novo (com corretor, imóvel e "criar mesmo assim"). */
export function CamposLead({
  imoveis,
  corretores = [],
  lead,
  funilPadrao = "locacao",
}: {
  imoveis: OpcaoImovel[];
  corretores?: OpcaoNome[];
  lead?: LeadEditavel;
  funilPadrao?: string;
}) {
  const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));
  const novo = !lead;
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Funil">
          <Selecao name="funil" defaultValue={lead?.funil ?? funilPadrao}>
            <option value="locacao">Locação (quer alugar)</option>
            <option value="venda">Venda (quer comprar)</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Origem">
          <Selecao name="origem" defaultValue={lead?.origem ?? "whatsapp"}>
            {Object.entries(ROTULO_ORIGEM_LEAD).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Prioridade">
          <Selecao name="prioridade" defaultValue={lead?.prioridade ?? "morno"}>
            <option value="quente">🔥 Quente</option>
            <option value="morno">Morno</option>
            <option value="frio">Frio</option>
          </Selecao>
        </Campo>
      </div>
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
      </div>
      {novo && (
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Corretor responsável">
            <Selecao name="corretor_id" defaultValue={corretores.length ? "auto" : ""}>
              <option value="">— sem corretor —</option>
              {corretores.length > 0 && <option value="auto">Distribuir automaticamente (rodízio)</option>}
              {corretores.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Imóvel de interesse">
            <SelImovel imoveis={imoveis} />
          </Campo>
        </div>
      )}
      <fieldset className="rounded-[14px] border border-borda-suave p-3">
        <legend className="px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">O que procura</legend>
        <input type="hidden" name="_tipos" value="1" />
        <div className="mb-3 flex flex-wrap gap-1.5">
          {TIPOS_IMOVEL.map((t) => (
            <label key={t} className={chipLead}>
              <input type="checkbox" name="tipos" value={t} defaultChecked={lead?.tipos?.includes(t)} className="sr-only" />
              {t}
            </label>
          ))}
        </div>
        <div className="grid gap-3 sm:grid-cols-4">
          <Campo rotulo="Orçamento mín. (R$)">
            <Entrada name="orcamento_min" inputMode="decimal" defaultValue={v(lead?.orcamento_min)} />
          </Campo>
          <Campo rotulo="Orçamento máx. (R$)">
            <Entrada name="orcamento_max" inputMode="decimal" defaultValue={v(lead?.orcamento_max)} />
          </Campo>
          <Campo rotulo="Quartos (mín.)">
            <Entrada name="quartos_min" type="number" min={0} defaultValue={v(lead?.quartos_min)} />
          </Campo>
          <Campo rotulo="Bairros / cidades">
            <Entrada name="regioes" defaultValue={lead?.regioes ?? ""} placeholder="Gonzaga, Santos" />
          </Campo>
        </div>
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Etiquetas" dica="Separe por vírgula: investidor, pet, urgente…">
          <Entrada name="etiquetas" defaultValue={lead?.etiquetas?.join(", ") ?? ""} />
        </Campo>
        <Campo rotulo="Próximo contato (follow-up)">
          <Entrada type="date" name="proximo_contato" defaultValue={lead?.proximo_contato ?? ""} />
        </Campo>
      </div>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={3} defaultValue={lead?.observacoes ?? ""} />
      </Campo>
      {novo && (
        <label className="flex items-center gap-2 text-sm text-texto-2">
          <input type="checkbox" name="criar_mesmo_assim" /> Criar mesmo assim se já existir lead com esse telefone/e-mail
        </label>
      )}
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
