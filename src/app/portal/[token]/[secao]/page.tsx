import { notFound } from "next/navigation";
import { secaoValida } from "@/lib/dominio/portal";
import { Arquivos, Fale } from "../secoes/comum";
import { CobrancasLocatario, ContratoLocatario, ManutencaoLocatario, PagamentosLocatario, VistoriasLocatario, contratosDoLocatario } from "../secoes/locatario";
import { OrdensPrestador, PagamentosPrestador } from "../secoes/prestador";
import {
  AlugueisProprietario,
  AprovacoesProprietario,
  ContratosProprietario,
  DespesasProprietario,
  ImoveisProprietario,
  InformeProprietario,
  RepassesProprietario,
} from "../secoes/proprietario";
import { infoPortal } from "../sessao";

/** Seções do portal: cada perfil só abre as suas (os dados vêm filtrados pelo banco). */
export default async function PortalSecao({ params, searchParams }: PageProps<"/portal/[token]/[secao]">) {
  const { token, secao } = await params;
  const sp = await searchParams;
  const info = await infoPortal(token);
  if (!info?.entrou) return null;
  if (!secaoValida(info.perfil, secao)) notFound();
  if (secao === "arquivos") return <Arquivos token={token} />;
  if (secao === "fale") return <Fale token={token} perfil={info.perfil} contratos={info.perfil === "locatario" ? await contratosDoLocatario(token) : []} />;

  if (info.perfil === "proprietario") {
    if (secao === "imoveis") return <ImoveisProprietario token={token} />;
    if (secao === "contratos") return <ContratosProprietario token={token} />;
    if (secao === "alugueis") return <AlugueisProprietario token={token} />;
    if (secao === "repasses") return <RepassesProprietario token={token} />;
    if (secao === "despesas") return <DespesasProprietario token={token} />;
    if (secao === "aprovacoes") return <AprovacoesProprietario token={token} nome={info.nome ?? ""} />;
    if (secao === "informe") return <InformeProprietario token={token} ano={typeof sp.ano === "string" ? sp.ano : undefined} />;
  }
  if (info.perfil === "locatario") {
    if (secao === "contrato") return <ContratoLocatario token={token} />;
    if (secao === "cobrancas") return <CobrancasLocatario token={token} />;
    if (secao === "pagamentos") return <PagamentosLocatario token={token} />;
    if (secao === "manutencao") return <ManutencaoLocatario token={token} telefone={null} />;
    if (secao === "vistorias") return <VistoriasLocatario token={token} />;
  }
  if (info.perfil === "prestador") {
    if (secao === "ordens") return <OrdensPrestador token={token} />;
    if (secao === "pagamentos") return <PagamentosPrestador token={token} />;
  }
  notFound();
}
