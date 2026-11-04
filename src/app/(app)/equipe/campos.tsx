import { Campo, Entrada, Selecao } from "@/components/ui";
import { TIPOS_CRECI, UFS } from "@/lib/dominio/equipe";
import type { Colaborador, Equipe, Filial } from "./dados";

/** Campos do CRECI (número, UF, validade e tipo). */
export function CamposCreci({ c }: { c?: Pick<Colaborador, "creci_numero" | "creci_uf" | "creci_validade" | "creci_tipo"> | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-4">
      <Campo rotulo="CRECI (número)">
        <Entrada name="creci_numero" defaultValue={c?.creci_numero ?? ""} placeholder="12345-F" />
      </Campo>
      <Campo rotulo="UF do CRECI">
        <Selecao name="creci_uf" defaultValue={c?.creci_uf ?? ""}>
          <option value="">—</option>
          {UFS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Validade do CRECI" dica="Avisamos 60 dias antes.">
        <Entrada type="date" name="creci_validade" defaultValue={c?.creci_validade ?? ""} />
      </Campo>
      <Campo rotulo="Tipo de inscrição">
        <Selecao name="creci_tipo" defaultValue={c?.creci_tipo ?? ""}>
          <option value="">—</option>
          {Object.entries(TIPOS_CRECI).map(([k, r]) => (
            <option key={k} value={k}>
              {r}
            </option>
          ))}
        </Selecao>
      </Campo>
    </div>
  );
}

/** Filial e equipe do colaborador. */
export function CamposLotacao({ filiais, equipes, filialId, equipeId }: { filiais: Filial[]; equipes: Equipe[]; filialId?: string | null; equipeId?: string | null }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Campo rotulo="Filial">
        <Selecao name="filial_id" defaultValue={filialId ?? ""}>
          <option value="">Sem filial</option>
          {filiais.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
              {!f.ativa ? " (inativa)" : ""}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Equipe">
        <Selecao name="equipe_id" defaultValue={equipeId ?? ""}>
          <option value="">Sem equipe</option>
          {equipes.map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
              {!e.ativa ? " (inativa)" : ""}
            </option>
          ))}
        </Selecao>
      </Campo>
    </div>
  );
}
