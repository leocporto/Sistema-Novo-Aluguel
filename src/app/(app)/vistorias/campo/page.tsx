import type { Metadata } from "next";
import Link from "next/link";
import { ChevronRight, ClipboardCheck } from "lucide-react";
import { Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { COR_STATUS_VISTORIA, ROTULO_STATUS_VISTORIA, ROTULO_TIPO_VISTORIA, progressoVistoria } from "@/lib/dominio/vistorias";
import { quemFez, type Vistoria } from "../dados";
import { GuardarOffline } from "./guardar-offline";

export const metadata: Metadata = { title: "Vistorias em campo" };

/** Entrada do app de campo no celular: as vistorias em aberto, com botões grandes. */
export default async function CampoInicio() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const { data } = await supabase
    .from("vistorias")
    .select("*, imovel:imoveis(id, codigo, logradouro, numero, bairro), responsavel:pessoas(id, nome), vistoria_itens(estado)")
    .in("status", ["rascunho", "em_andamento"])
    .order("data")
    .limit(100);
  const lista = (data ?? []) as unknown as (Vistoria & { vistoria_itens: { estado: string | null }[] })[];
  // As vistorias de até depois de amanhã já ficam guardadas no celular para abrir sem internet.
  const proximas = lista.filter((v) => v.data <= somarDias(hoje, 2)).slice(0, 10).map((v) => `/vistorias/campo/${v.id}`);

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <GuardarOffline paginas={proximas} />
      <div>
        <Link href="/vistorias" className="text-sm text-acento hover:underline">
          ‹ Vistorias
        </Link>
        <h1 className="mt-1 text-[28px] font-semibold leading-tight text-texto">Vistorias em campo</h1>
        <p className="text-sm text-texto-2">Abra esta tela com internet antes de sair: as vistorias de hoje até depois de amanhã (e as que você abrir) ficam guardadas no celular e abrem mesmo sem sinal. O que fizer no imóvel fica no celular e é enviado quando a internet voltar.</p>
      </div>
      {lista.length === 0 ? (
        <div className="rounded-card border border-borda bg-card p-6 text-center text-sm text-mudo">
          <ClipboardCheck className="mx-auto mb-2 size-6" />
          Nenhuma vistoria em aberto. Crie uma em{" "}
          <Link href="/vistorias?novo=1" className="text-acento underline">
            Vistorias
          </Link>
          .
        </div>
      ) : (
        <ul className="entrar-cascata space-y-3">
          {lista.map((v) => {
            const p = progressoVistoria(v.vistoria_itens);
            return (
              <li key={v.id}>
                <Link
                  href={`/vistorias/campo/${v.id}`}
                  className="flex min-h-20 items-center justify-between gap-3 rounded-card border border-borda bg-card p-4 transition hover:-translate-y-px hover:border-borda-forte active:scale-[.98]"
                >
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-[17px] font-semibold text-texto">
                        {ROTULO_TIPO_VISTORIA[v.tipo]} · {v.imovel?.codigo}
                      </span>
                      <Selo cor={COR_STATUS_VISTORIA[v.status]}>{ROTULO_STATUS_VISTORIA[v.status]}</Selo>
                      {v.data === hoje && <Selo cor="azul">hoje</Selo>}
                    </span>
                    <span className="block truncate text-sm text-texto-2">{[v.imovel?.logradouro, v.imovel?.numero, v.imovel?.bairro].filter(Boolean).join(", ")}</span>
                    <span className="block text-xs text-mudo">
                      {formatarDataBR(v.data)} · {p.avaliados}/{p.total} itens{quemFez(v) ? ` · ${quemFez(v)}` : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-5 shrink-0 text-mudo" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
