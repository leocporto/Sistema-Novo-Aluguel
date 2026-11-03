import { AreaTexto, Campo, Entrada, Selecao } from "@/components/ui";
import { ROTULO_GATILHO } from "@/lib/dominio/marketing";
import { SelecaoCanal } from "../campos";

export type AutomacaoForm = {
  nome: string;
  gatilho: string;
  acao: string;
  canal: string;
  modelo_id: string | null;
  mensagem: string | null;
  dias: number;
  reducao_min_pct: number | string;
  publico: string;
};

/** Campos da regra (criação e edição). */
export function CamposAutomacao({ a, modelos }: { a?: AutomacaoForm; modelos: { id: string; nome: string; canal: string }[] }) {
  return (
    <div className="space-y-4">
      <Campo rotulo="Nome">
        <Entrada name="nome" required defaultValue={a?.nome ?? ""} placeholder="Ex.: Avisar imóvel novo para quem tem perfil" />
      </Campo>
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Quando">
          <Selecao name="gatilho" required defaultValue={a?.gatilho ?? "novo_imovel"}>
            {Object.entries(ROTULO_GATILHO).map(([k, r]) => (
              <option key={k} value={k}>
                {r}
              </option>
            ))}
          </Selecao>
        </Campo>
        <Campo rotulo="O que fazer">
          <Selecao name="acao" defaultValue={a?.acao ?? "mensagem"}>
            <option value="mensagem">Pôr mensagem na fila de envio</option>
            <option value="tarefa">Criar tarefa no Comercial</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Dias depois" dica="Só para pós-venda e pós-locação (ex.: 30).">
          <Entrada name="dias" type="number" min={0} max={3650} defaultValue={a?.dias ?? 30} />
        </Campo>
        <Campo rotulo="Redução mínima do preço (%)" dica="Só para “preço baixou” (0 = qualquer redução).">
          <Entrada name="reducao_min_pct" inputMode="decimal" defaultValue={String(a?.reducao_min_pct ?? 0).replace(".", ",")} />
        </Campo>
        <Campo rotulo="Canal">
          <SelecaoCanal padrao={a?.canal ?? "whatsapp"} />
        </Campo>
        <Campo rotulo="Para quem (imóvel novo / preço)">
          <Selecao name="publico" defaultValue={a?.publico ?? "ambos"}>
            <option value="ambos">Leads e pessoas com perfil</option>
            <option value="leads">Só leads</option>
            <option value="pessoas">Só pessoas cadastradas</option>
          </Selecao>
        </Campo>
      </div>
      <Campo rotulo="Modelo de mensagem">
        <Selecao name="modelo_id" defaultValue={a?.modelo_id ?? ""}>
          <option value="">— usar o texto abaixo (ou o padrão) —</option>
          {modelos.map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome} ({m.canal})
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Texto (se não escolher modelo)" dica="Pós-venda e pós-locação: use {{link_pesquisa}} para mandar a pesquisa de satisfação.">
        <AreaTexto name="mensagem" rows={3} defaultValue={a?.mensagem ?? ""} />
      </Campo>
    </div>
  );
}
