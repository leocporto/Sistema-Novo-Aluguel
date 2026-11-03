import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Formulario } from "@/components/formulario";
import { BotaoExcluir } from "@/components/botao-excluir";
import { JanelaCadastro } from "@/components/janela-cadastro";
import { CalendarX } from "lucide-react";
import { ROTULO_TIPO_COMPROMISSO, diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR, hojeISO } from "@/lib/dominio/datas";
import { adicionarIndisponibilidade, excluirIndisponibilidade, salvarHorarioVisitas } from "../../agenda/actions";
import { BotaoEnviar } from "@/components/formulario";
import { Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarReais } from "@/lib/dominio/dinheiro";
import type { Imovel, Pessoa } from "@/lib/tipos";
import { adicionarProprietario, excluirImovel, removerProprietario } from "../actions";
import { FormImovel, type OpcaoEmpreendimento } from "../form-imovel";

export const metadata: Metadata = { title: "Imóvel" };

export default async function ImovelPage({ params }: PageProps<"/imoveis/[id]">) {
  const { id } = await params;
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";
  const [{ data }, { data: props }, { data: pessoas }, { data: contratos }, { data: chaves }, { data: emps }, { data: bloqueios }, { data: proximas }] = await Promise.all([
    supabase.from("imoveis").select("*").eq("id", id).maybeSingle(),
    supabase.from("imovel_proprietarios").select("percentual, pessoa:pessoas(id, nome)").eq("imovel_id", id),
    supabase.from("pessoas").select("id, nome").order("nome"),
    supabase.from("contratos").select("id, numero, status, data_inicio, valor_aluguel").eq("imovel_id", id).order("data_inicio", { ascending: false }),
    supabase.from("chaves").select("id, codigo, identificacao, local, chave_movimentacoes(retirada_por, devolvida_em)").eq("imovel_id", id).order("codigo"),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("empreendimentos").select("id, nome").order("nome"),
    supabase.from("imovel_indisponibilidades").select("id, inicio, fim, motivo").eq("imovel_id", id).gte("fim", new Date().toISOString()).order("inicio"),
    supabase.from("visitas").select("id, tipo, titulo, data_hora").eq("imovel_id", id).eq("status", "agendada").gte("data_hora", new Date().toISOString()).order("data_hora").limit(5),
  ]);
  if (!data) notFound();
  const imovel = data as Imovel;
  const proprietarios = (props ?? []) as unknown as { percentual: number; pessoa: { id: string; nome: string } }[];
  const soma = proprietarios.reduce((s, p) => s + Number(p.percentual), 0);
  const falta = Math.round((100 - soma) * 100) / 100;

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_340px]">
      <FormImovel imovel={imovel} pessoal={pessoal} empreendimentos={(emps ?? []) as OpcaoEmpreendimento[]} />
      <div className="space-y-6">
        {!pessoal && (
          <Cartao titulo="Proprietários e titularidade">
            <ul className="mb-4 space-y-2 text-sm">
              {proprietarios.map((p) => (
                <li key={p.pessoa.id} className="flex items-center justify-between gap-2">
                  <Link href={`/pessoas/${p.pessoa.id}`} className="text-acento hover:underline">
                    {p.pessoa.nome}
                  </Link>
                  <span className="flex items-center gap-2">
                    <Formulario acao={adicionarProprietario} automatico salvarQuando="percentual" className="flex items-center gap-1">
                      <input type="hidden" name="imovel_id" value={id} />
                      <input type="hidden" name="pessoa_id" value={p.pessoa.id} />
                      <input type="hidden" name="editar" value="1" />
                      <input
                        name="percentual"
                        inputMode="decimal"
                        required
                        aria-label={`Participação de ${p.pessoa.nome} (%)`}
                        defaultValue={String(Number(p.percentual))}
                        className="h-9 w-16 rounded-[9px] border border-borda-forte bg-input px-2 text-right text-sm outline-none focus:border-acento"
                      />
                      %
                    </Formulario>
                    <form action={removerProprietario}>
                      <input type="hidden" name="imovel_id" value={id} />
                      <input type="hidden" name="pessoa_id" value={p.pessoa.id} />
                      <button className="text-xs text-ruim hover:underline">remover</button>
                    </form>
                  </span>
                </li>
              ))}
              {proprietarios.length === 0 && <li className="text-mudo">Nenhum proprietário vinculado.</li>}
            </ul>
            {proprietarios.length > 0 && Math.abs(soma - 100) > 0.01 && (
              <p className="mb-3 text-xs text-alerta">As participações somam {soma}% — devem somar 100%.</p>
            )}
            <Formulario
              key={proprietarios.map((p) => p.pessoa.id).join(",")}
              acao={adicionarProprietario}
              automatico
              salvarQuando="pessoa_id"
              className="space-y-3 border-t border-borda-suave pt-4"
            >
              <input type="hidden" name="imovel_id" value={id} />
              <p className="text-xs text-mudo">Adicionar proprietário: escolha a pessoa — entra na hora.</p>
              <Campo rotulo="Participação (%)">
                <Entrada name="percentual" inputMode="decimal" defaultValue={falta > 0 ? String(falta) : ""} placeholder="100" />
              </Campo>
              <Campo rotulo="Pessoa">
                <Selecao name="pessoa_id" required defaultValue="">
                  <option value="" disabled>
                    Selecione…
                  </option>
                  {((pessoas ?? []) as Pick<Pessoa, "id" | "nome">[])
                    .filter((p) => !proprietarios.some((v) => v.pessoa.id === p.id))
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.nome}
                      </option>
                    ))}
                </Selecao>
              </Campo>
            </Formulario>
          </Cartao>
        )}

        <Cartao titulo="Contratos de locação">
          <ul className="space-y-2 text-sm">
            {(contratos ?? []).map((c) => (
              <li key={c.id} className="flex items-center justify-between">
                <Link href={`/contratos/${c.id}`} className="text-acento hover:underline">
                  #{c.numero} · {formatarReais(c.valor_aluguel)}
                </Link>
                <Selo cor={c.status === "ativo" ? "verde" : "cinza"}>{c.status}</Selo>
              </li>
            ))}
            {!contratos?.length && <li className="text-mudo">Nenhum contrato.</li>}
          </ul>
        </Cartao>

        <Cartao
          titulo="Disponibilidade para visitas"
          acoes={
            <Link href={`/agenda?novo=1&imovel_novo=${id}`} className="text-xs text-acento hover:underline">
              + agendar
            </Link>
          }
        >
          <Formulario acao={salvarHorarioVisitas} automatico className="mb-4">
            <input type="hidden" name="imovel_id" value={id} />
            <Campo rotulo="Horário para visitas">
              <Entrada name="horario_visitas" defaultValue={imovel.horario_visitas ?? ""} placeholder="Seg a sex, 9h–18h; sáb até 12h" />
            </Campo>
          </Formulario>
          <h4 className="mb-1.5 text-sm font-semibold text-texto">Períodos sem visita</h4>
          <ul className="mb-3 space-y-1.5 text-sm">
            {(bloqueios ?? []).map((b) => (
              <li key={b.id} className="flex items-center justify-between gap-2">
                <span>
                  {formatarDataBR(diaLocal(b.inicio))} {horaLocal(b.inicio)} → {formatarDataBR(diaLocal(b.fim))} {horaLocal(b.fim)}
                  {b.motivo && <span className="text-mudo"> · {b.motivo}</span>}
                </span>
                <BotaoExcluir acao={excluirIndisponibilidade} id={b.id} rotulo="Liberar período" confirmar="Liberar este período para visitas?" />
              </li>
            ))}
            {!bloqueios?.length && <li className="text-mudo">Nenhum bloqueio.</li>}
          </ul>
          <JanelaCadastro rotuloBotao={<><CalendarX className="size-3.5" /> Bloquear período</>} variante="secundario" tamanho="sm" titulo="Bloquear visitas" acao={adicionarIndisponibilidade} rotuloSalvar="Bloquear" icone={<CalendarX />}>
            <input type="hidden" name="imovel_id" value={id} />
            <div className="grid grid-cols-2 gap-3">
              <Campo rotulo="De">
                <Entrada type="date" name="inicio_data" required defaultValue={hojeISO()} />
              </Campo>
              <Campo rotulo="Hora">
                <Entrada type="time" name="inicio_hora" defaultValue="00:00" />
              </Campo>
              <Campo rotulo="Até">
                <Entrada type="date" name="fim_data" required defaultValue={hojeISO()} />
              </Campo>
              <Campo rotulo="Hora">
                <Entrada type="time" name="fim_hora" defaultValue="23:59" />
              </Campo>
            </div>
            <Campo rotulo="Motivo">
              <Entrada name="motivo" placeholder="Pintura, inquilino viajando…" />
            </Campo>
          </JanelaCadastro>
          {(proximas ?? []).length > 0 && (
            <>
              <h4 className="mb-1.5 mt-4 text-sm font-semibold text-texto">Próximos compromissos</h4>
              <ul className="space-y-1 text-sm">
                {(proximas ?? []).map((v) => (
                  <li key={v.id}>
                    <Link href={`/agenda/${v.id}`} className="text-acento hover:underline">
                      {formatarDataBR(diaLocal(v.data_hora))} {horaLocal(v.data_hora)} · {v.titulo ?? ROTULO_TIPO_COMPROMISSO[v.tipo]}
                    </Link>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Cartao>

        <Cartao titulo="Chaves" acoes={<Link href="/chaves" className="text-xs text-acento">gerenciar</Link>}>
          <ul className="space-y-1.5 text-sm">
            {((chaves ?? []) as { id: string; codigo: string | null; identificacao: string; local: string | null; chave_movimentacoes: { retirada_por: string; devolvida_em: string | null }[] }[]).map((c) => {
              const fora = c.chave_movimentacoes.find((m) => !m.devolvida_em);
              return (
                <li key={c.id} className="flex items-center justify-between gap-2">
                  <Link href={`/chaves/${c.id}`} className="hover:underline">
                    {c.codigo} · {c.identificacao} <span className="text-mudo">— {c.local ?? "sem local"}</span>
                  </Link>
                  {fora ? <Selo cor="amarelo">com {fora.retirada_por.split(" ")[0]}</Selo> : <Selo cor="verde">no lugar</Selo>}
                </li>
              );
            })}
            {!chaves?.length && <li className="text-mudo">Nenhuma chave cadastrada.</li>}
          </ul>
        </Cartao>

        <Formulario acao={excluirImovel} className="space-y-2">
          <input type="hidden" name="id" value={id} />
          <BotaoEnviar variante="fantasma" confirmar="Excluir este imóvel com fotos e documentos? Não dá para desfazer.">
            Excluir imóvel
          </BotaoEnviar>
        </Formulario>
      </div>
    </div>
  );
}
