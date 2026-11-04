import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarClock, Gavel, Megaphone, MessageSquareWarning, Receipt } from "lucide-react";
import { Contador } from "@/components/abas-segmentadas";
import { Aviso, Cartao, Definicao, Indicador } from "@/components/ui";
import { PAPEIS_CONDOMINIO, totalHoje } from "@/lib/dominio/condominios";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";
import { dadosCondominio, ehErro, infoCondominio } from "./sessao";

type Inicio = {
  condominio: { nome: string; endereco: string | null; dia_vencimento: number };
  unidades: { id: string; nome: string }[];
  papeis: string[];
  cotas_abertas: number;
  em_atraso: number;
  proxima: { id: string; competencia: string; vencimento: string; saldo: number; multa: number; juros: number } | null;
  nao_lidos: number;
  ocorrencias_abertas: number;
  assembleias: number;
  reservas: number;
};

/** Início do portal do condômino: resumo (o layout cuida da entrada). */
export default async function InicioCondominio({ params }: PageProps<"/condominio/[token]">) {
  const { token } = await params;
  const info = await infoCondominio(token);
  if (!info?.entrou) return null;
  const d = await dadosCondominio<Inicio>(token, "inicio");
  if (!d || ehErro(d)) notFound();
  const base = `/condominio/${token}`;
  return (
    <div className="space-y-5">
      {d.em_atraso > 0 && (
        <Aviso tipo="alerta">
          Você tem {d.em_atraso} cota(s) vencida(s). <Link href={`${base}/cotas`} className="font-semibold text-acento hover:underline">Ver e pagar com Pix</Link>.
        </Aviso>
      )}
      <div className="entrar-cascata grid grid-cols-2 gap-4 xl:grid-cols-3">
        <Indicador
          rotulo="Próxima cota"
          icone={<Receipt />}
          valor={d.proxima ? formatarReais(totalHoje(d.proxima)) : "—"}
          detalhe={d.proxima ? `${formatarCompetencia(d.proxima.competencia)} · vence ${formatarDataBR(d.proxima.vencimento)}` : "nada em aberto"}
          tom={d.em_atraso ? "perigo" : "neutro"}
          href={d.proxima ? `${base}/cotas/${d.proxima.id}` : `${base}/cotas`}
        />
        <Indicador rotulo="Cotas em aberto" icone={<AlertTriangle />} valor={<Contador valor={d.cotas_abertas} />} tom={d.em_atraso ? "alerta" : "neutro"} href={`${base}/cotas`} />
        <Indicador rotulo="Comunicados não lidos" icone={<Megaphone />} valor={<Contador valor={d.nao_lidos} />} tom={d.nao_lidos ? "alerta" : "neutro"} href={`${base}/comunicados`} />
        <Indicador rotulo="Minhas reservas" icone={<CalendarClock />} valor={<Contador valor={d.reservas} />} detalhe="pedidas ou confirmadas" href={`${base}/reservas`} />
        <Indicador rotulo="Ocorrências abertas" icone={<MessageSquareWarning />} valor={<Contador valor={d.ocorrencias_abertas} />} href={`${base}/ocorrencias`} />
        <Indicador rotulo="Assembleias" icone={<Gavel />} valor={<Contador valor={d.assembleias} />} detalhe="convocadas ou em andamento" href={`${base}/assembleias`} />
      </div>
      <Cartao titulo={d.condominio.nome}>
        <Definicao
          itens={[
            ["Endereço", d.condominio.endereco ?? "—"],
            ["Minhas unidades", d.unidades.map((u) => u.nome).join(", ") || "—"],
            ["Como participo", d.papeis.map((p) => PAPEIS_CONDOMINIO[p as keyof typeof PAPEIS_CONDOMINIO] ?? p).join(", ")],
            ["Vencimento das cotas", `todo dia ${d.condominio.dia_vencimento}`],
          ]}
        />
      </Cartao>
    </div>
  );
}
