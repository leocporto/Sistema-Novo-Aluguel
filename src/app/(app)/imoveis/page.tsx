import type { Metadata } from "next";
import Link from "next/link";
import { Copy, FileSpreadsheet, LayoutGrid, List, Plus } from "lucide-react";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { PilulasLink } from "@/components/pilulas-link";
import { BotaoLink, Cabecalho, Entrada, Selecao, classeBotao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { acharDuplicados } from "@/lib/dominio/imoveis";
import { ROTULO_STATUS_IMOVEL, TIPOS_IMOVEL, type Imovel } from "@/lib/tipos";
import { ListaImoveis, type LinhaImovel } from "./lista-imoveis";

export const metadata: Metadata = { title: "Imóveis" };

export default async function ImoveisPage({ searchParams }: PageProps<"/imoveis">) {
  const sp = await searchParams;
  const s = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const busca = s("q").trim().replace(/[%,()]/g, "");
  const { status, tipo, finalidade, empreendimento } = { status: s("status"), tipo: s("tipo"), finalidade: s("finalidade"), empreendimento: s("empreendimento") };
  const { supabase, organizacao } = await obterContexto();
  const pessoal = organizacao.modo === "pessoal";

  let q = supabase.from("imoveis").select("*, imovel_proprietarios(pessoa:pessoas(nome))").order("codigo").limit(500);
  if (busca) q = q.or(`codigo.ilike.%${busca}%,logradouro.ilike.%${busca}%,bairro.ilike.%${busca}%,cidade.ilike.%${busca}%`);
  if (status) q = q.eq("status", status);
  if (tipo) q = q.eq("tipo", tipo);
  if (finalidade) q = q.contains("finalidades", [finalidade]);
  if (empreendimento && !pessoal) q = q.eq("empreendimento_id", empreendimento);

  const [{ data }, { data: chavesDup }, { data: corretores }, { data: emps }] = await Promise.all([
    q,
    supabase.from("imoveis").select("id, codigo, logradouro, numero, complemento, cidade, matricula, inscricao_iptu"),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("pessoas").select("id, nome").contains("papeis", ["corretor"]).order("nome"),
    pessoal ? Promise.resolve({ data: [] }) : supabase.from("empreendimentos").select("id, nome").order("nome"),
  ]);
  const imoveis = (data ?? []) as (Imovel & { imovel_proprietarios: { pessoa: { nome: string } }[] })[];
  const gruposDup = acharDuplicados(chavesDup ?? []).length;

  // Foto de capa de cada imóvel da lista
  const { data: capas } = imoveis.length
    ? await supabase.from("imovel_midias").select("imovel_id, path, capa, ordem").eq("tipo", "foto").in("imovel_id", imoveis.map((i) => i.id)).order("capa", { ascending: false }).order("ordem")
    : { data: [] };
  const caminhoCapa = new Map<string, string>();
  for (const c of capas ?? []) if (!caminhoCapa.has(c.imovel_id as string)) caminhoCapa.set(c.imovel_id as string, c.path as string);
  const { data: assinadas } = caminhoCapa.size ? await supabase.storage.from("imoveis").createSignedUrls([...caminhoCapa.values()], 3600) : { data: [] };
  const url = new Map((assinadas ?? []).map((a) => [a.path, a.signedUrl]));

  const itens: LinhaImovel[] = imoveis.map((i) => ({
    id: i.id,
    codigo: i.codigo,
    endereco: [i.logradouro, i.numero, i.complemento].filter(Boolean).join(", "),
    regiao: [i.bairro, i.cidade].filter(Boolean).join(" · "),
    tipo: i.tipo,
    proprietarios: i.imovel_proprietarios.map((p) => p.pessoa.nome).join(", "),
    valor_aluguel: i.valor_aluguel == null ? null : Number(i.valor_aluguel),
    valor_venda: i.valor_venda == null ? null : Number(i.valor_venda),
    status: i.status,
    capa: url.get(caminhoCapa.get(i.id) ?? "") ?? null,
    exclusivo: Boolean(i.exclusivo),
    bairro: i.bairro,
    cidade: i.cidade,
    quartos: i.quartos,
    vagas: i.vagas,
    area: (() => {
      const a = i.area_privativa ?? i.area_util ?? i.area_construida ?? i.area_total;
      return a == null ? null : Number(a);
    })(),
  }));
  // Padrão: cartões com foto. A lista só com ?ver=lista.
  const visual = s("ver") === "lista" ? "lista" : "cartoes";
  const urlVisual = (v: string) => {
    const q = new URLSearchParams();
    for (const k of ["q", "status", "tipo", "finalidade", "empreendimento"]) if (s(k)) q.set(k, s(k));
    if (v === "lista") q.set("ver", "lista");
    const t = q.toString();
    return t ? `/imoveis?${t}` : "/imoveis";
  };

  return (
    <>
      <Cabecalho
        titulo="Imóveis"
        descricao={`${imoveis.length} imóvel(is). Marque as caixinhas para alterar vários de uma vez.`}
        acoes={
          <>
            {gruposDup > 0 && (
              <Link href="/imoveis/duplicados" className={classeBotao("fantasma")}>
                <Copy className="size-4" /> Possíveis repetidos ({gruposDup})
              </Link>
            )}
            <BotaoLink href="/imoveis/importar" variante="secundario">
              <FileSpreadsheet className="size-4" /> Importar planilha
            </BotaoLink>
            <BotaoLink href="/imoveis/novo">
              <Plus className="size-4" /> Novo imóvel
            </BotaoLink>
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-start gap-2">
      <FiltroAutomatico className="flex flex-1 flex-wrap gap-2">
        {visual === "lista" && <input type="hidden" name="ver" value="lista" />}
        <Entrada name="q" placeholder="Código, rua, bairro ou cidade" defaultValue={busca} className="max-w-xs" />
        <Selecao name="status" defaultValue={status} className="max-w-48">
          <option value="">Todas as situações</option>
          {Object.entries(ROTULO_STATUS_IMOVEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </Selecao>
        <Selecao name="tipo" defaultValue={tipo} className="max-w-48 capitalize">
          <option value="">Todos os tipos</option>
          {TIPOS_IMOVEL.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </Selecao>
        <Selecao name="finalidade" defaultValue={finalidade} className="max-w-48">
          <option value="">Toda finalidade</option>
          <option value="locacao">Locação</option>
          <option value="venda">Venda</option>
          <option value="temporada">Temporada</option>
        </Selecao>
        {!pessoal && (emps ?? []).length > 0 && (
          <Selecao name="empreendimento" defaultValue={empreendimento} className="max-w-56">
            <option value="">Todos os empreendimentos</option>
            {(emps ?? []).map((e) => (
              <option key={e.id} value={e.id}>
                {e.nome}
              </option>
            ))}
          </Selecao>
        )}
      </FiltroAutomatico>
        <PilulasLink
          rotulo="Forma de ver"
          ativo={urlVisual(visual)}
          itens={[
            { href: urlVisual("cartoes"), rotulo: <LayoutGrid className="size-4" />, titulo: "Cartões com foto" },
            { href: urlVisual("lista"), rotulo: <List className="size-4" />, titulo: "Lista" },
          ]}
        />
      </div>
      <ListaImoveis itens={itens} pessoal={pessoal} visual={visual} corretores={corretores ?? []} empreendimentos={emps ?? []} />
    </>
  );
}
