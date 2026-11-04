import { notFound } from "next/navigation";
import { Aviso } from "@/components/ui";
import { SECOES_PORTAL_COND } from "@/lib/dominio/condominios";
import { agoraMs } from "@/lib/dominio/datas";
import { SecaoAssembleias, SecaoComunicados, SecaoContas, SecaoCotas, SecaoDocumentos, SecaoOcorrencias, SecaoReservas, type CotaPortal } from "../secoes";
import { dadosCondominio, ehErro, infoCondominio } from "../sessao";

/** Seções do portal do condômino (o banco devolve só o que é da pessoa). */
export default async function SecaoPortalCondominio({ params, searchParams }: PageProps<"/condominio/[token]/[secao]">) {
  const { token, secao } = await params;
  const sp = await searchParams;
  const info = await infoCondominio(token);
  if (!info?.entrou) return null;
  if (!SECOES_PORTAL_COND.some((s) => s.slug && s.slug === secao)) notFound();
  const p: Record<string, unknown> = {};
  if (secao === "contas" && typeof sp.mes === "string" && /^\d{4}-\d{2}$/.test(sp.mes)) p.mes = sp.mes;
  const d = await dadosCondominio<unknown>(token, secao, p);
  if (ehErro(d)) return <Aviso tipo="alerta">Sua sessão terminou. Recarregue a página para entrar de novo.</Aviso>;

  if (secao === "cotas") return <SecaoCotas token={token} cotas={(d ?? []) as CotaPortal[]} />;
  if (secao === "comunicados") return <SecaoComunicados token={token} lista={(d ?? []) as Parameters<typeof SecaoComunicados>[0]["lista"]} />;
  if (secao === "reservas") return <SecaoReservas token={token} d={d as Parameters<typeof SecaoReservas>[0]["d"]} agoraIso={new Date(agoraMs()).toISOString()} />;
  if (secao === "ocorrencias") return <SecaoOcorrencias token={token} d={d as Parameters<typeof SecaoOcorrencias>[0]["d"]} />;
  if (secao === "assembleias") return <SecaoAssembleias token={token} lista={(d ?? []) as Parameters<typeof SecaoAssembleias>[0]["lista"]} />;
  if (secao === "documentos") return <SecaoDocumentos lista={(d ?? []) as Parameters<typeof SecaoDocumentos>[0]["lista"]} />;
  const c = (d ?? { meses: [], balancete: null }) as { meses: string[]; balancete: Parameters<typeof SecaoContas>[0]["b"] };
  return <SecaoContas token={token} meses={c.meses} b={c.balancete} mes={(p.mes as string | undefined) ?? null} />;
}
