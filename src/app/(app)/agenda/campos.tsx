import { SubAbas } from "@/components/sub-abas";
import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { ROTULO_TIPO_COMPROMISSO, TIPOS_COMPROMISSO, TIPOS_SO_IMOBILIARIA } from "@/lib/dominio/agenda";
import type { OpcaoImovel, OpcaoNome } from "./dados";

export const rotuloImovel = (i: Pick<OpcaoImovel, "codigo" | "logradouro" | "numero">) =>
  [i.codigo, [i.logradouro, i.numero].filter(Boolean).join(", ")].filter(Boolean).join(" — ");

export function AbasAgenda() {
  return (
    <SubAbas
      rotulo="Agenda"
      itens={[
        { href: "/agenda", rotulo: "Agenda" },
        { href: "/chaves", rotulo: "Chaves" },
        { href: "/agenda/sincronizar", rotulo: "Sincronizar com o celular" },
      ]}
    />
  );
}

function Lista({ name, opcoes, padrao, vazio = "— nenhum —" }: { name: string; opcoes: OpcaoNome[]; padrao?: string | null; vazio?: string }) {
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

export const OPCOES_LEMBRETE = [
  [0, "Sem lembrete"],
  [15, "15 minutos antes"],
  [30, "30 minutos antes"],
  [60, "1 hora antes"],
  [120, "2 horas antes"],
  [1440, "1 dia antes"],
] as const;

/** Campos do novo compromisso. No modo pessoal, sem lead, corretor e avaliação de captação. */
export function CamposCompromisso({
  opcoes,
  pessoal,
  hoje,
  padrao = {},
}: {
  opcoes: { imoveis: OpcaoImovel[]; leads: OpcaoNome[]; corretores: OpcaoNome[]; pessoas: OpcaoNome[] };
  pessoal: boolean;
  hoje: string;
  padrao?: { tipo?: string; data?: string; hora?: string; imovelId?: string; leadId?: string; pessoaId?: string };
}) {
  const tipos = TIPOS_COMPROMISSO.filter((t) => !(pessoal && TIPOS_SO_IMOBILIARIA.includes(t)) && t !== "avaliacao");
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-[1.3fr_1fr_100px_120px]">
        <Campo rotulo="Tipo">
          <Selecao name="tipo" defaultValue={padrao.tipo ?? "visita"}>
            {tipos.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO_COMPROMISSO[t]}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="Data">
          <Entrada type="date" name="data" required defaultValue={padrao.data ?? hoje} />
        </Campo>
        <Campo rotulo="Hora">
          <Entrada type="time" name="hora" required defaultValue={padrao.hora ?? "10:00"} />
        </Campo>
        <Campo rotulo="Duração">
          <Selecao name="duracao_min" defaultValue="60">
            {[15, 30, 45, 60, 90, 120, 180, 240].map((m) => (
              <option key={m} value={m}>
                {m < 60 ? `${m} min` : `${m / 60} h`.replace(".5", ",5")}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <Campo rotulo="Título (opcional)" dica="Se ficar vazio, usamos o tipo, o imóvel e o nome do cliente.">
        <Entrada name="titulo" placeholder="Ex.: Vistoria de entrada" />
      </Campo>
      <Campo rotulo="Imóvel">
        <Selecao name="imovel_id" defaultValue={padrao.imovelId ?? ""}>
          <option value="">— nenhum —</option>
          {opcoes.imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {rotuloImovel(i)}
            </option>
          ))}
        </Selecao>
      </Campo>
      <div className={`grid gap-4 ${pessoal ? "sm:grid-cols-1" : "sm:grid-cols-2"}`}>
        {!pessoal && (
          <Campo rotulo="Cliente (lead)">
            <Lista name="lead_id" opcoes={opcoes.leads} padrao={padrao.leadId} />
          </Campo>
        )}
        <Campo rotulo={pessoal ? "Interessado (cadastrado em Pessoas)" : "Ou pessoa cadastrada"}>
          <Lista name="pessoa_id" opcoes={opcoes.pessoas} padrao={padrao.pessoaId} />
        </Campo>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Ou nome do contato">
          <Entrada name="contato_nome" placeholder="Quem não está cadastrado" />
        </Campo>
        <Campo rotulo="Telefone do contato">
          <Entrada name="contato_telefone" inputMode="tel" />
        </Campo>
      </div>
      <div className={`grid gap-4 ${pessoal ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
        {!pessoal && (
          <Campo rotulo="Corretor">
            <Lista name="corretor_id" opcoes={opcoes.corretores} />
          </Campo>
        )}
        <Campo rotulo="Como">
          <Selecao name="modalidade" defaultValue="presencial">
            <option value="presencial">Presencial</option>
            <option value="virtual">Virtual (vídeo)</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Lembrete">
          <Selecao name="lembrete_min" defaultValue="60">
            {OPCOES_LEMBRETE.map(([v, r]) => (
              <option key={v} value={v}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
      </div>
      <Campo rotulo="Link da chamada (se virtual)">
        <Entrada name="link_virtual" type="url" placeholder="https://meet.google.com/…" />
      </Campo>
      <Campo rotulo="Observações">
        <AreaTexto name="observacoes" rows={2} />
      </Campo>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-texto-2">
        <label className="flex items-center gap-2">
          <input type="checkbox" name="privada" /> Só na minha agenda (não compartilhar)
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="agendar_mesmo_assim" /> Agendar mesmo se houver conflito de horário
        </label>
      </div>
    </>
  );
}
