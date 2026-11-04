import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Wrench } from "lucide-react";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, BotaoLink, Campo, Cartao, Definicao, Grade, Selecao, Selo, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { STATUS_OCORRENCIA, TIPOS_OCORRENCIA, nomeUnidade } from "@/lib/dominio/condominios";
import { formatarDataLocal } from "@/lib/dominio/datas";
import { excluirOcorrencia, responderOcorrencia, salvarOcorrencia } from "../../../actions-gestao";
import { opcoesEquipe } from "../../../dados";
import { EnviarFotosOcorrencia } from "../../../envios";

export const metadata: Metadata = { title: "Ocorrência" };

/** Ocorrência: situação (salva sozinha), fotos (bucket privado, link assinado), respostas (aparecem para o morador no portal). */
export default async function OcorrenciaPage({ params }: PageProps<"/condominios/[id]/ocorrencias/[oc]">) {
  const { id, oc } = await params;
  const { supabase, organizacao } = await obterContexto();
  const [{ data: o }, { data: respostas }, equipe] = await Promise.all([
    supabase
      .from("cond_ocorrencias")
      .select("id, numero, tipo, titulo, descricao, status, origem, fotos, created_at, resolvida_em, responsavel_user_id, unidade:cond_unidades(numero, bloco:cond_blocos(nome)), pessoa:pessoas(nome, telefone)")
      .eq("id", oc)
      .eq("condominio_id", id)
      .maybeSingle(),
    supabase.from("cond_ocorrencia_respostas").select("id, autor, texto, created_at").eq("ocorrencia_id", oc).order("created_at"),
    opcoesEquipe(supabase),
  ]);
  if (!o) notFound();
  const fotos = (o.fotos as string[]) ?? [];
  const { data: assinadas } = fotos.length ? await supabase.storage.from("condominios").createSignedUrls(fotos, 3600) : { data: [] };
  const unidade = o.unidade ? nomeUnidade(o.unidade as unknown as { numero: string; bloco: { nome: string } | null }) : "Área comum";
  const pessoa = o.pessoa as unknown as { nome: string; telefone: string | null } | null;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href={`/condominios/${id}/ocorrencias`} className={classeBotao("fantasma")}>
          <ArrowLeft className="size-4" /> Ocorrências
        </Link>
        <div className="flex flex-wrap gap-2">
          {o.tipo === "manutencao" && (
            <BotaoLink href={`/manutencao?novo=1&titulo=${encodeURIComponent(`${o.titulo as string} (condomínio)`)}`} variante="secundario">
              <Wrench className="size-4" /> Abrir chamado na Manutenção
            </BotaoLink>
          )}
          <BotaoExcluir acao={excluirOcorrencia} id={oc} variante="botao" rotulo="Excluir" confirmar={`Excluir a ocorrência #${o.numero}? Fotos e respostas saem junto.`} depois={`/condominios/${id}/ocorrencias`} />
        </div>
      </div>

      <Cartao titulo={`#${o.numero} · ${o.titulo as string}`}>
        <Definicao
          itens={[
            ["Unidade", unidade],
            ["Quem avisou", pessoa?.nome ?? "—"],
            ["Aberta em", formatarDataLocal(o.created_at as string)],
            ["Origem", o.origem === "portal" ? <Selo key="o" cor="azul">portal do condômino</Selo> : "equipe"],
            ["Resolvida em", formatarDataLocal(o.resolvida_em as string | null)],
          ]}
        />
        {o.descricao && <p className="mt-4 whitespace-pre-line text-sm text-texto">{o.descricao as string}</p>}
        <Formulario acao={salvarOcorrencia} automatico className="mt-5 space-y-3">
          <input type="hidden" name="id" value={oc} />
          <input type="hidden" name="condominio_id" value={id} />
          <Grade colunas={3}>
            <Campo rotulo="Situação">
              <Selecao name="status" defaultValue={o.status as string}>
                {Object.entries(STATUS_OCORRENCIA).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Tipo">
              <Selecao name="tipo" defaultValue={o.tipo as string}>
                {Object.entries(TIPOS_OCORRENCIA).map(([k, r]) => (
                  <option key={k} value={k}>
                    {r}
                  </option>
                ))}
              </Selecao>
            </Campo>
            <Campo rotulo="Responsável na equipe">
              <Selecao name="responsavel_user_id" defaultValue={(o.responsavel_user_id as string | null) ?? ""}>
                <option value="">—</option>
                {equipe.map((m) => (
                  <option key={m.user_id} value={m.user_id}>
                    {m.nome ?? "Sem nome"}
                  </option>
                ))}
              </Selecao>
            </Campo>
          </Grade>
        </Formulario>
      </Cartao>

      <Cartao titulo="Fotos">
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(assinadas ?? []).map((f, i) =>
            f.signedUrl ? (
              <a key={i} href={f.signedUrl} target="_blank" rel="noreferrer" className="block overflow-hidden rounded-[12px] border border-borda">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={f.signedUrl} alt={`Foto ${i + 1}`} className="aspect-square w-full object-cover" />
              </a>
            ) : null,
          )}
          {fotos.length === 0 && <p className="text-sm text-mudo">Sem fotos.</p>}
        </div>
        <EnviarFotosOcorrencia organizacaoId={organizacao.id} condominioId={id} ocorrenciaId={oc} />
      </Cartao>

      <Cartao titulo="Conversa">
        <ul className="mb-4 space-y-3">
          {(respostas ?? []).map((r) => (
            <li key={r.id as string} className={`rounded-[14px] border px-4 py-3 text-sm ${r.autor === "equipe" ? "border-acento-bd bg-acento-bg" : "border-borda bg-elev"}`}>
              <div className="mb-1 text-xs text-mudo">
                {r.autor === "equipe" ? "Equipe" : "Morador (portal)"} · {formatarDataLocal(r.created_at as string)}
              </div>
              <p className="whitespace-pre-line text-texto">{r.texto as string}</p>
            </li>
          ))}
          {(respostas ?? []).length === 0 && <li className="text-sm text-mudo">Nenhuma resposta ainda.</li>}
        </ul>
        <Formulario acao={responderOcorrencia} className="space-y-3">
          <input type="hidden" name="condominio_id" value={id} />
          <input type="hidden" name="ocorrencia_id" value={oc} />
          <Campo rotulo="Responder (o morador vê no portal)">
            <AreaTexto name="texto" required rows={3} />
          </Campo>
          <BotaoEnviar>Enviar resposta</BotaoEnviar>
        </Formulario>
      </Cartao>
    </div>
  );
}
