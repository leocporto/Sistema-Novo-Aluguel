import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { CATEGORIAS_CHAMADO, DICA_URGENCIA, ROTULO_CATEGORIA, ROTULO_URGENCIA, URGENCIAS } from "@/lib/dominio/manutencao";
import type { ContratoOpcao, OpcaoNome, PrestadorOpcao } from "./dados";

export function OpcoesCategoria() {
  return (
    <>
      {CATEGORIAS_CHAMADO.map((c) => (
        <option key={c} value={c}>
          {ROTULO_CATEGORIA[c]}
        </option>
      ))}
    </>
  );
}

export function OpcoesUrgencia() {
  return (
    <>
      {URGENCIAS.map((u) => (
        <option key={u} value={u}>
          {ROTULO_URGENCIA[u]} — {DICA_URGENCIA[u]}
        </option>
      ))}
    </>
  );
}

export function OpcoesPrestador({ prestadores, vazio = "— escolher depois —" }: { prestadores: PrestadorOpcao[]; vazio?: string }) {
  return (
    <>
      <option value="">{vazio}</option>
      {prestadores.map((p) => (
        <option key={p.id} value={p.id}>
          {p.nome}
          {p.especialidade ? ` · ${p.especialidade}` : ""}
        </option>
      ))}
    </>
  );
}

export const rotuloContrato = (c: ContratoOpcao) => `#${c.numero}${c.codigo ? ` (${c.codigo})` : ""} · ${c.imovel}${c.locatario ? ` · ${c.locatario}` : ""}`;

/** Campos do "Novo chamado" (equipe). */
export function CamposNovoChamado({
  opcoes,
  pessoal,
  padrao,
}: {
  opcoes: { imoveis: { id: string; codigo: string; logradouro: string | null; numero: string | null }[]; contratos: ContratoOpcao[]; prestadores: PrestadorOpcao[]; garantias: OpcaoNome[] };
  pessoal: boolean;
  padrao: { imovelId?: string; contratoId?: string; origemId?: string; categoria?: string; prestadorId?: string; titulo?: string };
}) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Imóvel" dica="Ou escolha só o contrato: o imóvel vem junto.">
          <Selecao name="imovel_id" defaultValue={padrao.imovelId ?? ""}>
            <option value="">— escolha —</option>
            {opcoes.imoveis.map((i) => (
              <option key={i.id} value={i.id}>
                {i.codigo}
                {i.logradouro ? ` · ${[i.logradouro, i.numero].filter(Boolean).join(", ")}` : ""}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Contrato (se estiver alugado)">
          <Selecao name="contrato_id" defaultValue={padrao.contratoId ?? ""}>
            <option value="">— sem contrato —</option>
            {opcoes.contratos.map((c) => (
              <option key={c.id} value={c.id}>
                {rotuloContrato(c)}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <Campo rotulo="O que aconteceu">
        <Entrada name="titulo" required defaultValue={padrao.titulo ?? ""} placeholder="Vazamento embaixo da pia, tomada sem energia…" />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Tipo de problema">
          <Selecao name="categoria" defaultValue={padrao.categoria ?? "outros"}>
            <OpcoesCategoria />
          </Selecao>
        </Campo>
        <Campo rotulo="Urgência">
          <Selecao name="urgencia" defaultValue="media">
            <OpcoesUrgencia />
          </Selecao>
        </Campo>
        <Campo rotulo="Onde (cômodo)">
          <Entrada name="local" placeholder="Cozinha, banheiro social…" />
        </Campo>
        <Campo rotulo="Quem pediu">
          <Selecao name="aberto_por" defaultValue="locatario">
            <option value="locatario">Locatário</option>
            {!pessoal && <option value="proprietario">Proprietário</option>}
            <option value="equipe">{pessoal ? "Eu mesmo" : "Equipe (vistoria, ronda…)"}</option>
            <option value="outro">Outro (vizinho, condomínio…)</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Nome de quem pediu">
          <Entrada name="solicitante_nome" />
        </Campo>
        <Campo rotulo="Telefone / WhatsApp">
          <Entrada name="solicitante_telefone" inputMode="tel" />
        </Campo>
      </div>
      <Campo rotulo="Detalhes">
        <AreaTexto name="descricao" rows={3} placeholder="Desde quando, o que já foi tentado, horários para o prestador entrar…" />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Prestador (se já souber)">
          <Selecao name="prestador_id" defaultValue={padrao.prestadorId ?? ""}>
            <OpcoesPrestador prestadores={opcoes.prestadores} />
          </Selecao>
        </Campo>
        <Campo rotulo="Retorno de serviço na garantia?" dica="No automático, se houver serviço do mesmo tipo neste imóvel ainda na garantia, o chamado é ligado a ele.">
          <Selecao name="chamado_origem_id" defaultValue={padrao.origemId ?? ""}>
            <option value="">Automático (ligar se houver garantia)</option>
            <option value="nao">Não é retorno de garantia</option>
            {opcoes.garantias.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nome}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <p className="text-xs text-mudo">Fotos e vídeos você envia na ficha do chamado, logo depois de cadastrar.</p>
    </>
  );
}
