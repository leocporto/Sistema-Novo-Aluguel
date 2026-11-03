import type { Metadata } from "next";
import { Formulario } from "@/components/formulario";
import { Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { CANAIS_COMUNICACAO, type Pessoa } from "@/lib/tipos";
import { salvarComunicacao } from "../../actions";

export const metadata: Metadata = { title: "Comunicação e consentimento" };

const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });

export default async function ComunicacaoPage({ params }: PageProps<"/pessoas/[id]/comunicacao">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const [{ data }, { data: registros }] = await Promise.all([
    supabase.from("pessoas").select("*").eq("id", id).single(),
    supabase.from("pessoa_consentimentos").select("id, canal, concedido, origem, em").eq("pessoa_id", id).order("em", { ascending: false }).limit(100),
  ]);
  const p = data as Pessoa;
  const marcado = (c: string) => Boolean((p as unknown as Record<string, boolean>)[`aceita_${c}`]);

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_380px]">
      <Formulario acao={salvarComunicacao} automatico>
        <input type="hidden" name="id" value={id} />
        <Cartao titulo="Pode entrar em contato por">
          <div className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {Object.entries(CANAIS_COMUNICACAO).map(([k, v]) => (
                <label
                  key={k}
                  className="flex cursor-pointer items-center gap-3 rounded-[14px] border border-borda px-4 py-3 text-sm transition has-[:checked]:border-ok-bd has-[:checked]:bg-ok-bg"
                >
                  <input type="checkbox" name={`aceita_${k}`} defaultChecked={marcado(k)} className="size-4 accent-[var(--ok)]" />
                  <span className="font-medium text-texto">{v}</span>
                </label>
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Canal preferido">
                <Selecao name="canal_preferido" defaultValue={p.canal_preferido ?? ""}>
                  <option value="">— sem preferência —</option>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="ligacao">Ligação</option>
                  <option value="email">E-mail</option>
                  <option value="sms">SMS</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Como a pessoa autorizou" dica="Ex.: cláusula do contrato, mensagem no WhatsApp em 03/11, formulário do site.">
                <Entrada name="consentimento_origem" defaultValue={p.consentimento_origem ?? ""} />
              </Campo>
            </div>
            {p.consentimento_em && <p className="text-xs text-mudo">Última mudança de autorização: {dataHora(p.consentimento_em)}</p>}
          </div>
        </Cartao>
      </Formulario>
      <Cartao titulo="Registro de consentimentos (LGPD)">
        <ul className="space-y-2 text-sm">
          {(registros ?? []).map((r) => (
            <li key={r.id} className="flex items-start justify-between gap-2">
              <span>
                <span className={r.concedido ? "font-medium text-ok" : "font-medium text-ruim"}>{r.concedido ? "Autorizou" : "Retirou"}</span>{" "}
                {CANAIS_COMUNICACAO[r.canal] ?? r.canal}
                {r.origem && <span className="block text-xs text-mudo">{r.origem}</span>}
              </span>
              <span className="whitespace-nowrap text-xs text-mudo">{dataHora(r.em)}</span>
            </li>
          ))}
          {!registros?.length && <li className="text-mudo">Nenhum registro ainda. Cada vez que uma autorização mudar, fica guardado aqui com data e hora.</li>}
        </ul>
      </Cartao>
    </div>
  );
}
