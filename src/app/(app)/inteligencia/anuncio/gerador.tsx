"use client";

import { useActionState, useState } from "react";
import { Sparkles } from "lucide-react";
import { BotaoEnviar } from "@/components/formulario";
import { Copiar } from "@/components/copiar";
import { Aviso } from "@/components/ui";
import { TAMANHOS_DESCRICAO, TONS_DESCRICAO } from "@/lib/dominio/ia";
import type { EstadoAcao } from "@/lib/form";
import { aceitarDescricao, gerarDescricao, type EstadoDescricao } from "../actions";
import { SeloOrigem } from "../componentes";

const campo =
  "w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] text-texto outline-none transition placeholder:text-fraco focus:border-acento focus:ring-4 focus:ring-acento-bg";
const rotulo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";

/** Gera a descrição (IA ou regra) e só grava no imóvel quando o usuário aceita. */
export function GeradorDescricao({ imovelId }: { imovelId: string }) {
  const [estado, gerar] = useActionState<EstadoDescricao, FormData>(gerarDescricao, {});
  const [salvo, aceitar] = useActionState<EstadoAcao, FormData>(aceitarDescricao, {});
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [base, setBase] = useState<EstadoDescricao | null>(null);
  if (estado !== base) {
    setBase(estado);
    setTitulo(estado.titulo ?? "");
    setDescricao(estado.descricao ?? "");
  }
  return (
    <div className="space-y-5">
      <form action={gerar} className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <input type="hidden" name="imovel_id" value={imovelId} />
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Tom</span>
          <select name="tom" className={campo} defaultValue="profissional">
            {Object.entries(TONS_DESCRICAO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5">
          <span className={rotulo}>Tamanho</span>
          <select name="tamanho" className={campo} defaultValue="medio">
            {Object.entries(TAMANHOS_DESCRICAO).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 self-end pb-3 text-sm text-texto">
          <input type="checkbox" name="incluir_valores" defaultChecked className="size-4 accent-[var(--accent)]" /> Citar aluguel/venda, condomínio e IPTU
        </label>
        <label className="flex flex-col gap-1.5 md:col-span-3">
          <span className={rotulo}>Destaques que você quer citar (opcional)</span>
          <input name="destaques" maxLength={500} placeholder="Ex.: reformado, sol da manhã, perto do parque" className={campo} />
          <span className="text-xs text-mudo">Só entram se não contradisserem o cadastro. A IA não inventa o que não está lá.</span>
        </label>
        <div className="md:col-span-3">
          <BotaoEnviar>
            <Sparkles className="size-4" /> Gerar descrição
          </BotaoEnviar>
        </div>
      </form>
      {estado.erro && <Aviso tipo="erro">{estado.erro}</Aviso>}
      {estado.aviso && <Aviso tipo="alerta">{estado.aviso}</Aviso>}
      {estado.descricao && (
        <form action={aceitar} className="space-y-3 rounded-card border border-borda bg-card p-5">
          <input type="hidden" name="imovel_id" value={imovelId} />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-texto">Sugestão (edite à vontade antes de aceitar)</h3>
            <SeloOrigem usouIA={!!estado.usouIA} />
          </div>
          {estado.avisos && estado.avisos.length > 0 && (
            <Aviso tipo="alerta">
              <strong>Confira antes de usar:</strong>
              <ul className="mt-1 list-disc pl-5">
                {estado.avisos.map((a) => (
                  <li key={a}>{a}</li>
                ))}
              </ul>
            </Aviso>
          )}
          <label className="flex flex-col gap-1.5">
            <span className={rotulo}>Título</span>
            <input name="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} maxLength={150} className={campo} />
          </label>
          <label className="flex items-center gap-2 text-sm text-texto">
            <input type="checkbox" name="usar_titulo" defaultChecked className="size-4 accent-[var(--accent)]" /> Trocar também o título do anúncio
          </label>
          <label className="flex flex-col gap-1.5">
            <span className={rotulo}>Descrição</span>
            <textarea name="descricao" rows={8} value={descricao} onChange={(e) => setDescricao(e.target.value)} className={campo} />
          </label>
          {salvo.erro && <Aviso tipo="erro">{salvo.erro}</Aviso>}
          {salvo.ok && <Aviso>{salvo.ok}</Aviso>}
          <div className="flex flex-wrap gap-2">
            <BotaoEnviar confirmar="Gravar esta descrição no cadastro do imóvel (vale para o site e os portais)?">Aceitar e gravar no imóvel</BotaoEnviar>
            <Copiar texto={`${titulo}\n\n${descricao}`} rotulo="Copiar texto" />
          </div>
        </form>
      )}
    </div>
  );
}
