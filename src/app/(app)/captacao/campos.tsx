import { SubAbas } from "@/components/sub-abas";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { ORIGENS_CAPTACAO } from "@/lib/dominio/captacao";
import { TIPOS_IMOVEL } from "@/lib/tipos";

export type OpcaoNome = { id: string; nome: string };

export type Captacao = {
  id: string;
  numero: number;
  status: string;
  etapa_max: number;
  origem: string;
  corretor_id: string | null;
  lead_id: string | null;
  proprietario_id: string | null;
  proprietario_nome: string;
  proprietario_telefone: string | null;
  proprietario_email: string | null;
  tipo: string;
  finalidades: string[];
  cep: string | null;
  logradouro: string | null;
  numero_end: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  area: number | null;
  quartos: number | null;
  suites: number | null;
  banheiros: number | null;
  vagas: number | null;
  valor_pretendido: number | null;
  observacoes: string | null;
  valor_avaliado_aluguel: number | null;
  valor_avaliado_venda: number | null;
  avaliado_em: string | null;
  avaliacao_notas: string | null;
  proposta_tipo: "administracao" | "intermediacao" | "ambos";
  proposta_taxa_adm: number | null;
  proposta_taxa_intermediacao: number | null;
  proposta_comissao_venda: number | null;
  proposta_status: "rascunho" | "enviada" | "aceita" | "recusada";
  proposta_enviada_em: string | null;
  proposta_texto: string | null;
  exclusivo: boolean;
  exclusividade_inicio: string | null;
  exclusividade_fim: string | null;
  autorizacao_anuncio: boolean;
  autorizacao_data: string | null;
  autorizacao_validade: string | null;
  fotos_status: "pendente" | "agendadas" | "feitas" | "tratadas";
  checklist: Record<string, boolean>;
  motivo_nao_captado: string | null;
  nao_captado_em: string | null;
  imovel_id: string | null;
  captado_em: string | null;
  created_at: string;
};

export const enderecoCaptacao = (c: Pick<Captacao, "logradouro" | "numero_end" | "bairro" | "cidade">) =>
  [[c.logradouro, c.numero_end].filter(Boolean).join(", "), c.bairro, c.cidade].filter(Boolean).join(" · ");

export function AbasCaptacao() {
  return (
    <SubAbas
      rotulo="Captação"
      itens={[
        { href: "/captacao", rotulo: "Oportunidades" },
        { href: "/captacao/relatorio", rotulo: "Desempenho e metas" },
        { href: "/captacao/nao-captados", rotulo: "Não captados" },
      ]}
    />
  );
}

export const chip =
  "flex cursor-pointer items-center rounded-full border border-borda px-3 py-1.5 text-[13px] capitalize text-texto-2 transition hover:border-borda-forte has-[:checked]:border-acento has-[:checked]:bg-acento-bg has-[:checked]:text-acento-hot";

const v = (n: unknown) => (n === null || n === undefined ? "" : String(n));

/** Proprietário em potencial + origem (cadastro novo e ficha). */
export function CamposProprietario({ c, corretores, novo = false }: { c?: Captacao; corretores: OpcaoNome[]; novo?: boolean }) {
  return (
    <>
      <Campo rotulo="Proprietário (nome)">
        <Entrada name="proprietario_nome" required defaultValue={c?.proprietario_nome} />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Telefone / WhatsApp">
          <Entrada name="proprietario_telefone" inputMode="tel" defaultValue={c?.proprietario_telefone ?? ""} placeholder="(13) 99999-9999" />
        </Campo>
        <Campo rotulo="E-mail">
          <Entrada name="proprietario_email" type="email" defaultValue={c?.proprietario_email ?? ""} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Como chegou">
          <Selecao name="origem" defaultValue={c?.origem ?? "indicacao"}>
            {Object.entries(ORIGENS_CAPTACAO).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Corretor captador">
          <Selecao name="corretor_id" defaultValue={novo ? (corretores.length ? "auto" : "") : (c?.corretor_id ?? "")}>
            <option value="">— sem corretor —</option>
            {novo && corretores.length > 0 && <option value="auto">Distribuir automaticamente (rodízio)</option>}
            {corretores.map((o) => (
              <option key={o.id} value={o.id}>
                {o.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
    </>
  );
}

/** Cadastro preliminar do imóvel. */
export function CamposImovelPreliminar({ c }: { c?: Captacao }) {
  const fin = c?.finalidades ?? ["locacao"];
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <Campo rotulo="Tipo">
          <Selecao name="tipo" defaultValue={c?.tipo ?? "apartamento"} className="capitalize">
            {TIPOS_IMOVEL.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Para">
          <input type="hidden" name="_finalidades" value="1" />
          <div className="flex gap-1.5 pt-1">
            <label className={chip}>
              <input type="checkbox" name="finalidades" value="locacao" defaultChecked={fin.includes("locacao")} className="sr-only" />
              Alugar
            </label>
            <label className={chip}>
              <input type="checkbox" name="finalidades" value="venda" defaultChecked={fin.includes("venda")} className="sr-only" />
              Vender
            </label>
          </div>
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-[2fr_90px_1fr]">
        <Campo rotulo="Endereço">
          <Entrada name="logradouro" defaultValue={c?.logradouro ?? ""} placeholder="Rua, avenida…" />
        </Campo>
        <Campo rotulo="Número">
          <Entrada name="numero_end" defaultValue={c?.numero_end ?? ""} />
        </Campo>
        <Campo rotulo="Complemento">
          <Entrada name="complemento" defaultValue={c?.complemento ?? ""} placeholder="Apto, bloco…" />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_70px_130px]">
        <Campo rotulo="Bairro">
          <Entrada name="bairro" defaultValue={c?.bairro ?? ""} />
        </Campo>
        <Campo rotulo="Cidade">
          <Entrada name="cidade" defaultValue={c?.cidade ?? ""} />
        </Campo>
        <Campo rotulo="UF">
          <Entrada name="uf" maxLength={2} defaultValue={c?.uf ?? ""} className="uppercase" />
        </Campo>
        <Campo rotulo="CEP">
          <Entrada name="cep" inputMode="numeric" defaultValue={c?.cep ?? ""} />
        </Campo>
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-6">
        <Campo rotulo="Área (m²)">
          <Entrada name="area" inputMode="decimal" defaultValue={v(c?.area)} />
        </Campo>
        <Campo rotulo="Quartos">
          <Entrada name="quartos" type="number" min={0} defaultValue={v(c?.quartos)} />
        </Campo>
        <Campo rotulo="Suítes">
          <Entrada name="suites" type="number" min={0} defaultValue={v(c?.suites)} />
        </Campo>
        <Campo rotulo="Banheiros">
          <Entrada name="banheiros" type="number" min={0} defaultValue={v(c?.banheiros)} />
        </Campo>
        <Campo rotulo="Vagas">
          <Entrada name="vagas" type="number" min={0} defaultValue={v(c?.vagas)} />
        </Campo>
        <Campo rotulo="Valor pretendido (R$)">
          <Entrada name="valor_pretendido" inputMode="decimal" defaultValue={v(c?.valor_pretendido)} />
        </Campo>
      </div>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={3} defaultValue={c?.observacoes ?? ""} />
      </Campo>
    </>
  );
}
