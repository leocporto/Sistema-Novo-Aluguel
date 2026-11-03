import { redirect } from "next/navigation";

/** As visitas agora vivem na Agenda (com calendário, confirmação e feedback). */
export default async function VisitasPage({ searchParams }: PageProps<"/comercial/visitas">) {
  const sp = await searchParams;
  const p = new URLSearchParams({ vista: "lista", tipo: "visita" });
  if (sp.novo === "1") p.set("novo", "1");
  if (typeof sp.lead === "string") p.set("lead", sp.lead);
  redirect(`/agenda?${p}`);
}
