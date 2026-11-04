import type { Metadata } from "next";
import { BotaoExcluir } from "@/components/botao-excluir";
import { Formulario } from "@/components/formulario";
import { Aviso, Cartao, Entrada, Selo } from "@/components/ui";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { COR_VALIDADE, DIAS_AVISO_CRECI, DIAS_AVISO_DOCUMENTO, formatarCreci, situacaoValidade, textoValidade } from "@/lib/dominio/equipe";
import { excluirDocumento, salvarDocumento } from "../../../actions";
import { contextoEquipe } from "../../../dados";
import { AbrirDocumento, NovoDocumento } from "./envio-documento";

export const metadata: Metadata = { title: "Documentos do colaborador" };

type Doc = { id: string; tipo: string; numero: string | null; emissao: string | null; validade: string | null; path: string | null; nome_arquivo: string | null; created_at: string };

export default async function DocumentosColaboradorPage({ params }: PageProps<"/equipe/colaboradores/[id]/documentos">) {
  const { id } = await params;
  const { supabase, pode, minhaPessoa, organizacao } = await contextoEquipe();
  const hoje = hojeISO();
  const [{ data }, { data: p }] = await Promise.all([
    supabase.from("equipe_documentos").select("id, tipo, numero, emissao, validade, path, nome_arquivo, created_at").eq("pessoa_id", id).order("validade", { ascending: true, nullsFirst: false }),
    supabase.from("pessoas").select("creci_numero, creci_uf, creci_validade").eq("id", id).maybeSingle(),
  ]);
  const docs = (data ?? []) as Doc[];
  const podeEditar = pode("equipe", "editar") || minhaPessoa === id;
  const creci = situacaoValidade((p?.creci_validade as string | null) ?? null, hoje, DIAS_AVISO_CRECI);

  return (
    <div className="space-y-6">
      {p?.creci_numero ? (
        <Aviso tipo={creci.situacao === "vencido" ? "erro" : creci.situacao === "vencendo" ? "alerta" : "info"}>
          {formatarCreci(p.creci_numero as string, p.creci_uf as string | null)}:{" "}
          {creci.situacao === "sem_data" ? "sem data de validade — informe na aba Dados e acesso." : `${textoValidade(creci.dias)} (${formatarDataBR(p.creci_validade as string)}).`}
        </Aviso>
      ) : (
        <Aviso tipo="alerta">Sem CRECI cadastrado. Informe o número na aba Dados e acesso (obrigatório para quem intermedeia negócios).</Aviso>
      )}

      {podeEditar && (
        <Cartao titulo="Adicionar documento">
          <NovoDocumento pessoaId={id} pasta={`${organizacao.id}/${id}`} />
        </Cartao>
      )}

      <Cartao titulo="Documentos profissionais">
        {!podeEditar ? (
          <p className="text-sm text-mudo">
            Os documentos são dados pessoais: só o próprio colaborador e quem tem Equipe → editar no perfil de acesso podem ver (LGPD).
          </p>
        ) : docs.length === 0 ? (
          <p className="text-sm text-mudo">Nenhum documento ainda. Avisamos {DIAS_AVISO_DOCUMENTO} dias antes de cada validade.</p>
        ) : (
          <ul className="divide-y divide-borda-suave">
            {docs.map((d) => {
              const v = situacaoValidade(d.validade, hoje, DIAS_AVISO_DOCUMENTO);
              return (
                <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-48 flex-1">
                    <div className="font-medium text-texto">{d.tipo}</div>
                    {d.path ? <AbrirDocumento id={d.id} nome={d.nome_arquivo ?? "arquivo"} /> : <span className="text-xs text-mudo">sem arquivo</span>}
                  </div>
                  {podeEditar ? (
                    <Formulario acao={salvarDocumento} automatico semAviso className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={d.id} />
                      <Entrada name="numero" defaultValue={d.numero ?? ""} placeholder="número" aria-label={`Número de ${d.tipo}`} className="!min-h-10 w-32 !text-sm" />
                      <Entrada type="date" name="emissao" defaultValue={d.emissao ?? ""} aria-label={`Emissão de ${d.tipo}`} className="!min-h-10 w-40 !text-sm" />
                      <Entrada type="date" name="validade" defaultValue={d.validade ?? ""} aria-label={`Validade de ${d.tipo}`} className="!min-h-10 w-40 !text-sm" />
                    </Formulario>
                  ) : (
                    <span className="text-sm text-texto-2">
                      {d.numero ?? "—"} · validade {formatarDataBR(d.validade)}
                    </span>
                  )}
                  <Selo cor={COR_VALIDADE[v.situacao]}>{v.situacao === "em_dia" ? "em dia" : v.situacao === "sem_data" ? "sem validade" : textoValidade(v.dias)}</Selo>
                  {podeEditar && <BotaoExcluir acao={excluirDocumento} id={d.id} rotulo="Excluir documento" confirmar={`Excluir "${d.tipo}"${d.path ? " e o arquivo" : ""}?`} />}
                </li>
              );
            })}
          </ul>
        )}
        {podeEditar && docs.length > 0 && <p className="mt-3 text-right text-xs text-mudo">Mudanças no número e nas datas são salvas automaticamente.</p>}
      </Cartao>
    </div>
  );
}
