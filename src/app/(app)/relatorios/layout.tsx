import { exigirVerRota } from "@/lib/permissoes";

/**
 * Centro de relatórios (nos dois modos). Sem Relatórios → ver no perfil de
 * acesso, volta para o Painel; o banco confere de novo em cada função bi_*.
 * Os envios programados vencidos rodam em segundo plano a partir do layout do
 * app (agendarRelatorios), em qualquer tela.
 */
export default async function RelatoriosLayout({ children }: LayoutProps<"/relatorios">) {
  await exigirVerRota("/relatorios");
  return children;
}
