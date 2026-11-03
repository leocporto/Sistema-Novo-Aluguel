import { redirect } from "next/navigation";

/** A antiga tela "Inadimplência" agora é a central de Cobranças (/cobrancas). */
export default function ReguaPage() {
  redirect("/cobrancas");
}
