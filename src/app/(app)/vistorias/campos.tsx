import { SubAbas } from "@/components/sub-abas";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { ROTULO_ESTADO, ROTULO_TIPO_VISTORIA, TIPOS_AMBIENTE } from "@/lib/dominio/vistorias";
import type { OpcaoNome } from "./dados";

export function AbasVistorias() {
  return (
    <SubAbas
      rotulo="Vistorias"
      itens={[
        { href: "/vistorias", rotulo: "Vistorias" },
        { href: "/vistorias/pendencias", rotulo: "Danos e reparos" },
      ]}
    />
  );
}

/** Seleção do estado de um item (vazio = ainda não avaliado). */
export function OpcoesEstado() {
  return (
    <>
      <option value="">— avaliar —</option>
      {Object.entries(ROTULO_ESTADO).map(([k, r]) => (
        <option key={k} value={k}>
          {r}
        </option>
      ))}
    </>
  );
}

export function OpcoesTipoAmbiente() {
  return (
    <>
      {Object.entries(TIPOS_AMBIENTE).map(([k, t]) => (
        <option key={k} value={k}>
          {t.rotulo}
        </option>
      ))}
    </>
  );
}

type Opcoes = {
  imoveis: { id: string; codigo: string; logradouro: string | null; numero: string | null }[];
  contratos: { id: string; numero: number; status: string; imovel_id: string; imovel: { codigo: string } | null }[];
  vistoriadores: OpcaoNome[];
};

/** Campos para abrir uma vistoria (entrada, saída ou periódica). */
export function CamposNovaVistoria({
  opcoes,
  pessoal,
  hoje,
  padrao = {},
}: {
  opcoes: Opcoes;
  pessoal: boolean;
  hoje: string;
  padrao?: { tipo?: string; imovelId?: string; contratoId?: string };
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo de vistoria">
          <Selecao name="tipo" defaultValue={padrao.tipo ?? "entrada"}>
            {Object.entries(ROTULO_TIPO_VISTORIA).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Contrato (se tiver)" dica="Com o contrato, o imóvel e o locatário vêm sozinhos.">
          <Selecao name="contrato_id" defaultValue={padrao.contratoId ?? ""}>
            <option value="">— sem contrato —</option>
            {opcoes.contratos.map((c) => (
              <option key={c.id} value={c.id}>
                Nº {c.numero} · {c.imovel?.codigo ?? "imóvel"} {c.status !== "ativo" ? `(${c.status})` : ""}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <Campo rotulo="Imóvel">
        <Selecao name="imovel_id" defaultValue={padrao.imovelId ?? ""}>
          <option value="">— escolha (ou use o contrato) —</option>
          {opcoes.imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {[i.codigo, [i.logradouro, i.numero].filter(Boolean).join(", ")].filter(Boolean).join(" — ")}
            </option>
          ))}
        </Selecao>
      </Campo>
      <div className="grid gap-4 sm:grid-cols-3">
        <Campo rotulo="Data">
          <Entrada type="date" name="data" defaultValue={hoje} required />
        </Campo>
        <Campo rotulo="Hora">
          <Entrada type="time" name="hora" defaultValue="09:00" />
        </Campo>
        <Campo rotulo="Prazo p/ contestar (dias)">
          <Entrada name="contestacao_dias" inputMode="numeric" defaultValue="10" />
        </Campo>
      </div>
      <label className="flex items-center gap-2 text-sm text-texto-2">
        <input type="hidden" name="agendar" value="" />
        <input type="checkbox" name="agendar" defaultChecked /> Marcar na agenda
      </label>
      {pessoal ? (
        <Campo rotulo="Acompanhou (ex.: o inquilino)">
          <Entrada name="acompanhante" />
        </Campo>
      ) : (
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Vistoriador">
            <Selecao name="responsavel_id" defaultValue="">
              <option value="">— escolha —</option>
              {opcoes.vistoriadores.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </Selecao>
          </Campo>
          <Campo rotulo="Ou nome do vistoriador">
            <Entrada name="responsavel_nome" />
          </Campo>
          <Campo rotulo="Acompanhou">
            <Entrada name="acompanhante" placeholder="Locatário, proprietário…" />
          </Campo>
        </div>
      )}
      <fieldset className="space-y-2 rounded-[14px] border border-borda-suave p-3 text-sm text-texto-2">
        <legend className="px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Ambientes e checklist</legend>
        <label className="flex items-start gap-2">
          <input type="radio" name="modelo" value="auto" defaultChecked className="mt-1" />
          <span>
            Automático: na saída e na periódica, copia os ambientes da última vistoria do imóvel (para comparar); na entrada, monta pelo cadastro do imóvel (quartos, banheiros, vagas).
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="modelo" value="imovel" className="mt-1" /> Montar pelo cadastro do imóvel, com o checklist padrão de cada ambiente
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="modelo" value="vazio" className="mt-1" /> Começar vazia (incluo os ambientes eu mesmo)
        </label>
      </fieldset>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} />
      </Campo>
    </>
  );
}
