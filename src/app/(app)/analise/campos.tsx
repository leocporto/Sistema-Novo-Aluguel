import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { BASES_LEGAIS, BUREAUS, ROTULO_BASE_LEGAL, ROTULO_BUREAU, ROTULO_TIPO_RENDA, TIPOS_RENDA, EXPLICA_BASE_LEGAL } from "@/lib/dominio/analise";
import { hojeISO } from "@/lib/dominio/datas";
import type { OpcaoNome } from "./dados";

type Imovel = { id: string; codigo: string; logradouro: string | null; numero: string | null; status: string };

export function OpcoesNome({ opcoes, vazio }: { opcoes: OpcaoNome[]; vazio: string }) {
  return (
    <>
      <option value="">{vazio}</option>
      {opcoes.map((o) => (
        <option key={o.id} value={o.id}>
          {o.nome}
        </option>
      ))}
    </>
  );
}

/** Campos para abrir uma análise (candidato existente ou novo). */
export function CamposNovaAnalise({
  pessoas,
  imoveis,
  corretores,
  pessoal,
  padrao = {},
}: {
  pessoas: OpcaoNome[];
  imoveis: Imovel[];
  corretores: OpcaoNome[];
  pessoal: boolean;
  padrao?: { imovelId?: string; pessoaId?: string };
}) {
  return (
    <>
      <Campo rotulo="Candidato já cadastrado em Pessoas">
        <Selecao name="candidato_id" defaultValue={padrao.pessoaId ?? ""}>
          <OpcoesNome opcoes={pessoas} vazio="— é um candidato novo (preencha abaixo) —" />
        </Selecao>
      </Campo>
      <fieldset className="space-y-4 rounded-[14px] border border-borda-suave p-4">
        <legend className="px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Ou candidato novo</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome completo ou razão social">
            <Entrada name="nome" autoComplete="off" />
          </Campo>
          <Campo rotulo="CPF ou CNPJ">
            <Entrada name="documento" inputMode="numeric" placeholder="000.000.000-00" />
          </Campo>
          <Campo rotulo="WhatsApp / telefone">
            <Entrada name="telefone" inputMode="tel" />
          </Campo>
          <Campo rotulo="E-mail">
            <Entrada name="email" type="email" />
          </Campo>
        </div>
      </fieldset>
      <Campo rotulo={pessoal ? "Imóvel que ele quer alugar" : "Imóvel pretendido"}>
        <Selecao name="imovel_id" defaultValue={padrao.imovelId ?? ""}>
          <option value="">— ainda não definido —</option>
          {imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {[i.codigo, [i.logradouro, i.numero].filter(Boolean).join(", ")].filter(Boolean).join(" — ")}
              {i.status !== "disponivel" ? ` (${i.status})` : ""}
            </option>
          ))}
        </Selecao>
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Aluguel (R$)" dica="Em branco: usa o valor do imóvel.">
          <Entrada name="valor_aluguel" inputMode="decimal" />
        </Campo>
        <Campo rotulo="Encargos por mês (R$)" dica="Condomínio + IPTU. Em branco: usa os do imóvel.">
          <Entrada name="valor_encargos" inputMode="decimal" />
        </Campo>
        <Campo rotulo="Renda mensal declarada (R$)">
          <Entrada name="renda_declarada" inputMode="decimal" />
        </Campo>
        <Campo rotulo="Quantas pessoas vão morar">
          <Entrada name="moradores" type="number" min={0} max={50} />
        </Campo>
        <Campo rotulo="Finalidade">
          <Selecao name="finalidade" defaultValue="residencial">
            <option value="residencial">Residencial</option>
            <option value="comercial">Comercial</option>
          </Selecao>
        </Campo>
        {!pessoal && (
          <Campo rotulo="Corretor (opcional)">
            <Selecao name="corretor_id" defaultValue="">
              <OpcoesNome opcoes={corretores} vazio="— nenhum —" />
            </Selecao>
          </Campo>
        )}
      </div>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} />
      </Campo>
    </>
  );
}

/** Campos de uma fonte de renda. */
export function CamposRenda() {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo de renda">
          <Selecao name="tipo" defaultValue="clt">
            {TIPOS_RENDA.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_RENDA[t]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Fonte (empresa, órgão, pagador)">
          <Entrada name="fonte" />
        </Campo>
        <Campo rotulo="Valor declarado por mês (R$)">
          <Entrada name="valor_declarado" required inputMode="decimal" />
        </Campo>
        <Campo rotulo="Valor comprovado (R$)" dica="Deixe em branco até ver o comprovante.">
          <Entrada name="valor_comprovado" inputMode="decimal" />
        </Campo>
      </div>
      <Campo rotulo="Comprovante" dica="Ex.: 3 holerites, extrato bancário, declaração de IR, DECORE.">
        <Entrada name="comprovante" />
      </Campo>
    </>
  );
}

/** Campos da consulta de crédito (registro do resultado e base legal). */
export function CamposConsulta({ alvos, bureauPadrao }: { alvos: { valor: string; rotulo: string }[]; bureauPadrao: string | null }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Quem foi consultado">
          <Selecao name="fiador_id" defaultValue="">
            {alvos.map((a) => (
              <option key={a.valor} value={a.valor}>
                {a.rotulo}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Birô de crédito">
          <Selecao name="bureau" defaultValue={bureauPadrao ?? "serasa"}>
            {BUREAUS.map((b) => (
              <option key={b} value={b}>
                {ROTULO_BUREAU[b]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Data da consulta">
          <Entrada type="date" name="consultado_em" defaultValue={hojeISO()} max={hojeISO()} />
        </Campo>
        <Campo rotulo="Nome do birô (se outro)">
          <Entrada name="bureau_nome" />
        </Campo>
        <Campo rotulo="Score (0 a 1000)">
          <Entrada name="score" type="number" min={0} max={1000} />
        </Campo>
        <Campo rotulo="Faixa de risco (se o birô informar)">
          <Entrada name="faixa_risco" placeholder="Ex.: baixo, médio, alto" />
        </Campo>
        <Campo rotulo="Restrições no nome">
          <Selecao name="restricoes" defaultValue="nao">
            <option value="nao">Não tem</option>
            <option value="sim">Tem restrições</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Protocolo da consulta">
          <Entrada name="protocolo" />
        </Campo>
        <Campo rotulo="Quantas restrições">
          <Entrada name="restricoes_qtd" type="number" min={0} />
        </Campo>
        <Campo rotulo="Valor das restrições (R$)">
          <Entrada name="restricoes_valor" inputMode="decimal" />
        </Campo>
      </div>
      <Campo rotulo="Quais restrições (credor, valor, data)">
        <AreaTexto name="restricoes_descricao" rows={2} />
      </Campo>
      <Campo rotulo="Base legal (LGPD)">
        <Selecao name="base_legal" required defaultValue="protecao_credito">
          {BASES_LEGAIS.map((b) => (
            <option key={b} value={b}>
              {ROTULO_BASE_LEGAL[b]}
            </option>
          ))}
        </Selecao>
      </Campo>
      <ul className="space-y-1 text-xs text-mudo">
        {BASES_LEGAIS.map((b) => (
          <li key={b}>
            <b className="text-texto-2">{ROTULO_BASE_LEGAL[b]}:</b> {EXPLICA_BASE_LEGAL[b]}
          </li>
        ))}
      </ul>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} />
      </Campo>
    </>
  );
}
