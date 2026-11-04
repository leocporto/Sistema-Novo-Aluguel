import type { Metadata } from "next";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { LinhaLink } from "@/components/linha-link";
import { Aviso, Cabecalho, Celula, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { diaLocal, horaLocal } from "@/lib/dominio/agenda";
import { formatarDataBR } from "@/lib/dominio/datas";
import { ROTULO_PERFIL, type PerfilPortal } from "@/lib/dominio/portal";
import { AbasPortais } from "../abas";

export const metadata: Metadata = { title: "Registro de acessos do portal" };

const TIPOS: Record<string, { rotulo: string; cor: "azul" | "verde" | "amarelo" | "vermelho" | "cinza" }> = {
  entrada: { rotulo: "Entrou", cor: "verde" },
  falha: { rotulo: "Errou os números", cor: "amarelo" },
  bloqueio: { rotulo: "Bloqueado", cor: "vermelho" },
  saida: { rotulo: "Saiu", cor: "cinza" },
  gerado: { rotulo: "Link gerado", cor: "azul" },
  trocado: { rotulo: "Link trocado", cor: "azul" },
  revogado: { rotulo: "Desativado", cor: "cinza" },
  reativado: { rotulo: "Reativado", cor: "azul" },
  validade: { rotulo: "Validade", cor: "cinza" },
  solicitacao: { rotulo: "Pedido", cor: "azul" },
  chamado: { rotulo: "Chamado", cor: "azul" },
  pasta: { rotulo: "Fotos", cor: "cinza" },
  aprovacao: { rotulo: "Aprovação", cor: "verde" },
  orcamento: { rotulo: "Orçamento", cor: "azul" },
  execucao: { rotulo: "Serviço", cor: "azul" },
  excluido: { rotulo: "Link excluído", cor: "cinza" },
};

type Evento = {
  id: string;
  tipo: string;
  descricao: string | null;
  ip: string | null;
  data: string;
  /** Cópias guardadas no próprio registro: valem mesmo depois que o link ou a pessoa são excluídos. */
  perfil: PerfilPortal | null;
  pessoa_nome: string | null;
  acesso: { id: string; perfil: PerfilPortal; pessoa: { nome: string } | null } | null;
};

/** Registro de acessos e ações feitas pelo portal (só leitura; o banco grava). */
export default async function RegistroPage({ searchParams }: PageProps<"/portais/registro">) {
  const sp = await searchParams;
  const tipo = typeof sp.tipo === "string" && sp.tipo in TIPOS ? sp.tipo : "";
  const { supabase, organizacao, papel } = await obterContexto();
  if (papel === "corretor")
    return (
      <>
        <Cabecalho titulo="Registro de acessos" trilha="Portal de clientes" />
        <Aviso>Só administradores, gestores e o financeiro veem o registro do portal.</Aviso>
      </>
    );
  let q = supabase
    .from("portal_eventos")
    .select("id, tipo, descricao, ip, data, perfil, pessoa_nome, acesso:portal_acessos(id, perfil, pessoa:pessoas(nome))")
    .order("data", { ascending: false })
    .limit(500);
  if (tipo) q = q.eq("tipo", tipo);
  const { data } = await q;
  const eventos = ((data ?? []) as unknown as Evento[]).filter((e) => !(organizacao.modo === "pessoal" && (e.acesso?.perfil ?? e.perfil) === "proprietario"));

  return (
    <>
      <Cabecalho titulo="Registro de acessos" trilha="Portal de clientes" descricao="Quem entrou no portal, tentativas erradas, bloqueios e o que cada pessoa fez (os 500 mais recentes). Não se apaga pelo sistema." />
      <AbasPortais modo={organizacao.modo} />
      <FiltroAutomatico className="barra-filtros mb-4 flex flex-wrap gap-2">
        <Selecao name="tipo" defaultValue={tipo} aria-label="Tipo de registro" className="max-w-60">
          <option value="">Tudo</option>
          {Object.entries(TIPOS).map(([k, t]) => (
            <option key={k} value={k}>
              {t.rotulo}
            </option>
          ))}
        </Selecao>
      </FiltroAutomatico>
      <Tabela colunas={["Quando", "Pessoa", "O que aconteceu", "IP"]}>
        {eventos.length === 0 && <LinhaVazia colunas={4}>Nada registrado ainda.</LinhaVazia>}
        {eventos.map((e) => {
          const perfil = e.acesso?.perfil ?? e.perfil;
          const celulas = (
            <>
              <Celula className="whitespace-nowrap text-sm">
                {formatarDataBR(diaLocal(e.data))} {horaLocal(e.data)}
              </Celula>
              <Celula>
                {e.acesso?.pessoa?.nome ?? e.pessoa_nome ?? "—"}
                {perfil && (
                  <span className="block text-xs text-mudo">
                    {ROTULO_PERFIL[perfil] ?? perfil}
                    {e.acesso ? "" : " · link excluído"}
                  </span>
                )}
              </Celula>
              <Celula>
                <Selo cor={TIPOS[e.tipo]?.cor ?? "cinza"}>{TIPOS[e.tipo]?.rotulo ?? e.tipo}</Selo>
                {e.descricao && <span className="ml-2 text-sm text-texto-2">{e.descricao}</span>}
              </Celula>
              <Celula className="text-xs text-mudo">{e.ip ?? "—"}</Celula>
            </>
          );
          // Link excluído: a linha continua no registro, mas não abre ficha.
          return e.acesso ? (
            <LinhaLink key={e.id} href={`/portais/${e.acesso.id}`}>
              {celulas}
            </LinhaLink>
          ) : (
            <tr key={e.id}>{celulas}</tr>
          );
        })}
      </Tabela>
    </>
  );
}
