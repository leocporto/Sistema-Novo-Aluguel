import type { Metadata } from "next";
import Link from "next/link";
import { Cabecalho, Cartao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { ROTULO_MOTIVO_DUPLICADO, acharDuplicados } from "@/lib/dominio/imoveis";
import { ROTULO_STATUS_IMOVEL } from "@/lib/tipos";

export const metadata: Metadata = { title: "Imóveis repetidos" };

export default async function DuplicadosPage() {
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("imoveis").select("id, codigo, status, logradouro, numero, complemento, bairro, cidade, matricula, inscricao_iptu, created_at").order("created_at");
  const grupos = acharDuplicados(data ?? []);
  return (
    <>
      <Cabecalho
        titulo="Possíveis imóveis repetidos"
        trilha="Imóveis"
        descricao="Imóveis com o mesmo endereço, matrícula, inscrição de IPTU ou código parecido. Abra, confira e exclua ou marque como Inativo o que estiver sobrando."
      />
      {grupos.length === 0 ? (
        <div className="rounded-card border border-borda bg-card px-5 py-10 text-center text-sm text-mudo">Nenhum imóvel repetido encontrado. 👍</div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {grupos.map((g, idx) => (
            <Cartao key={idx} titulo={<span className="capitalize">{ROTULO_MOTIVO_DUPLICADO[g.motivo]}</span>}>
              <ul className="divide-y divide-borda-suave text-sm">
                {g.itens.map((i) => (
                  <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                    <Link href={`/imoveis/${i.id}`} className="min-w-0 truncate">
                      <span className="font-semibold text-acento hover:underline">{i.codigo}</span>
                      <span className="text-mudo"> — {[i.logradouro, i.numero, i.complemento, i.cidade].filter(Boolean).join(", ") || "sem endereço"}</span>
                    </Link>
                    <Selo>{ROTULO_STATUS_IMOVEL[i.status] ?? i.status}</Selo>
                  </li>
                ))}
              </ul>
            </Cartao>
          ))}
        </div>
      )}
    </>
  );
}
