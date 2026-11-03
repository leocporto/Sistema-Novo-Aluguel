import { Fragment, type ReactNode } from "react";
import { SubAbas } from "@/components/sub-abas";
import { Campo, Entrada, Selecao } from "@/components/ui";

export type OpcaoNome = { id: string; nome: string };

export function AbasDocumentos() {
  return (
    <SubAbas
      rotulo="Documentos"
      itens={[
        { href: "/documentos", rotulo: "Documentos" },
        { href: "/documentos/modelos", rotulo: "Modelos" },
      ]}
    />
  );
}

/** Negrito com **texto** dentro de uma linha. */
function linha(t: string): ReactNode {
  const partes = t.split(/(\*\*[^*]+\*\*)/g);
  return partes.map((p, i) => (p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));
}

/** Mostra o texto do documento: "# " vira título, **x** negrito, parágrafos por linha em branco. */
export function TextoDocumento({ texto, className = "" }: { texto: string; className?: string }) {
  const blocos = texto.replace(/\r/g, "").split(/\n{2,}/);
  return (
    <div className={`space-y-3 text-[15px] leading-relaxed text-texto ${className}`}>
      {blocos.map((b, i) =>
        b.startsWith("# ") ? (
          <h2 key={i} className="pb-2 text-center text-lg font-bold uppercase">
            {b.slice(2)}
          </h2>
        ) : (
          <p key={i} className="whitespace-pre-line">
            {linha(b)}
          </p>
        ),
      )}
    </div>
  );
}

/** Vínculos do documento (imóvel, pessoa, contrato, venda). */
export function CamposVinculos({
  imoveis,
  pessoas,
  contratos,
  vendas,
  padrao = {},
}: {
  imoveis: { id: string; codigo: string }[];
  pessoas: OpcaoNome[];
  contratos: { id: string; numero: number; imovel: { codigo: string } | null }[];
  vendas: { id: string; numero: number; imovel: { codigo: string } | null }[] | null;
  padrao?: { imovel_id?: string | null; pessoa_id?: string | null; contrato_id?: string | null; venda_id?: string | null };
}) {
  return (
    <div className={`grid gap-4 ${vendas ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
      <Campo rotulo="Imóvel">
        <Selecao name="imovel_id" defaultValue={padrao.imovel_id ?? ""}>
          <option value="">— nenhum —</option>
          {imoveis.map((i) => (
            <option key={i.id} value={i.id}>
              {i.codigo}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Pessoa (cliente)">
        <Selecao name="pessoa_id" defaultValue={padrao.pessoa_id ?? ""}>
          <option value="">— nenhuma —</option>
          {pessoas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nome}
            </option>
          ))}
        </Selecao>
      </Campo>
      <Campo rotulo="Contrato de locação">
        <Selecao name="contrato_id" defaultValue={padrao.contrato_id ?? ""}>
          <option value="">— nenhum —</option>
          {contratos.map((c) => (
            <option key={c.id} value={c.id}>
              #{c.numero} · {c.imovel?.codigo}
            </option>
          ))}
        </Selecao>
      </Campo>
      {vendas && (
        <Campo rotulo="Venda">
          <Selecao name="venda_id" defaultValue={padrao.venda_id ?? ""}>
            <option value="">— nenhuma —</option>
            {vendas.map((v) => (
              <option key={v.id} value={v.id}>
                #{v.numero} · {v.imovel?.codigo}
              </option>
            ))}
          </Selecao>
        </Campo>
      )}
    </div>
  );
}

export function CampoValidade({ padrao }: { padrao?: string | null }) {
  return (
    <Campo rotulo="Vence em (opcional)" dica="Para avisar renovação">
      <Entrada type="date" name="validade" defaultValue={padrao ?? ""} />
    </Campo>
  );
}
