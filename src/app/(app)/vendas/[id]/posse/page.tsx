import type { Metadata } from "next";
import { MessageCircle } from "lucide-react";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Campo, Cartao, Entrada, Selecao, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { CHECKLIST_POSSE } from "@/lib/dominio/vendas";
import { linkWhatsapp } from "@/lib/whatsapp";
import { atualizarVenda, salvarChecklistVenda } from "../../actions";
import { SELECT_VENDA, nomeComprador, telefoneComprador, type Venda } from "../../dados";

export const metadata: Metadata = { title: "Posse e pós-venda" };

export default async function PosseVenda({ params }: PageProps<"/vendas/[id]/posse">) {
  const { id } = await params;
  const { supabase } = await obterContexto();
  const { data } = await supabase.from("vendas").select(SELECT_VENDA).eq("id", id).single();
  const v = data as unknown as Venda;
  const marcados = v.checklist_posse ?? {};
  const feitos = CHECKLIST_POSSE.filter((i) => marcados[i.id]).length;
  const base = v.posse_data ?? v.concluida_em;
  const retorno = base ? somarDias(base, 30) : null;
  const tel = telefoneComprador(v);
  const atrasado = retorno && !v.pos_venda_contato_em && retorno <= hojeISO();

  return (
    <div className="grid gap-6 xl:grid-cols-2">
      <Cartao titulo={`Entrega da posse (${feitos}/${CHECKLIST_POSSE.length})`}>
        <Formulario acao={atualizarVenda} automatico className="mb-4">
          <input type="hidden" name="id" value={id} />
          <Campo rotulo="Data da entrega das chaves">
            <Entrada type="date" name="posse_data" defaultValue={v.posse_data ?? ""} />
          </Campo>
        </Formulario>
        <Formulario acao={salvarChecklistVenda} automatico className="space-y-1">
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="qual" value="posse" />
          {CHECKLIST_POSSE.map((i) => (
            <label key={i.id} className="flex cursor-pointer items-start gap-2.5 rounded-[10px] px-2 py-1.5 text-sm text-texto-2 transition hover:bg-elev has-[:checked]:text-texto">
              <input type="checkbox" name="item" value={i.id} defaultChecked={!!marcados[i.id]} className="mt-0.5 size-4 accent-[var(--accent)]" />
              {i.rotulo}
            </label>
          ))}
        </Formulario>
      </Cartao>

      <Cartao titulo="Pós-venda">
        <p className={`mb-4 text-sm ${atrasado ? "font-semibold text-alerta" : "text-texto-2"}`}>
          {retorno ? `Retorno sugerido: ${formatarDataBR(retorno)} (30 dias depois da ${v.posse_data ? "entrega" : "conclusão"}).` : "O retorno é sugerido 30 dias depois da entrega das chaves."}
          {v.pos_venda_contato_em ? ` Contato feito em ${formatarDataBR(v.pos_venda_contato_em)}.` : ""}
        </p>
        {tel && (
          <a
            href={linkWhatsapp(tel, `Olá ${nomeComprador(v).split(" ")[0]}! Tudo certo com o imóvel novo? Ficou alguma pendência que possamos ajudar? Sua opinião sobre o nosso atendimento é muito importante.`)}
            target="_blank"
            rel="noreferrer"
            className={`mb-4 ${classeBotao("secundario", "sm")}`}
          >
            <MessageCircle className="size-3.5" /> Mensagem de pós-venda
          </a>
        )}
        <Formulario acao={atualizarVenda} automatico className="space-y-4">
          <input type="hidden" name="id" value={id} />
          <div className="grid grid-cols-2 gap-3">
            <Campo rotulo="Contato feito em">
              <Entrada type="date" name="pos_venda_contato_em" defaultValue={v.pos_venda_contato_em ?? ""} />
            </Campo>
            <Campo rotulo="Satisfação">
              <Selecao name="pos_venda_nota" defaultValue={v.pos_venda_nota ? String(v.pos_venda_nota) : ""}>
                <option value="">—</option>
                {[5, 4, 3, 2, 1].map((n) => (
                  <option key={n} value={n}>
                    {"★".repeat(n)}
                  </option>
                ))}
              </Selecao>
            </Campo>
          </div>
          <Campo rotulo="O que o cliente disse">
            <AreaTexto name="pos_venda_texto" rows={4} defaultValue={v.pos_venda_texto ?? ""} placeholder="Elogios, reclamações, indicações de amigos…" />
          </Campo>
        </Formulario>
      </Cartao>
    </div>
  );
}
