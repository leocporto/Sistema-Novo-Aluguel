import type { ReactNode } from "react";
import Link from "next/link";
import { FiltroAutomatico } from "@/components/filtro-automatico";
import { Aviso, Cabecalho, Selecao } from "@/components/ui";
import { AbasCorretor } from "./abas";
import { sufixo } from "./dados";

type Ctx = { ehCorretor: boolean; escolhido: string | null; corretores: { id: string; nome: string }[]; gestao: boolean };

/** Cabeçalho, seleção do corretor (para a gestão) e abas do portal do corretor. */
export function TopoCorretor({ titulo, descricao, ctx, acoes }: { titulo: string; descricao?: ReactNode; ctx: Ctx; acoes?: ReactNode }) {
  return (
    <>
      <Cabecalho
        titulo={titulo}
        trilha="Meu portal (corretor)"
        descricao={descricao}
        acoes={
          <>
            {!ctx.ehCorretor && (
              <FiltroAutomatico className="barra-filtros flex gap-2">
                <Selecao name="corretor" defaultValue={ctx.escolhido ?? ""} aria-label="Ver o portal de qual corretor" className="max-w-64">
                  <option value="">Meu cadastro</option>
                  {ctx.corretores.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                    </option>
                  ))}
                </Selecao>
              </FiltroAutomatico>
            )}
            {acoes}
          </>
        }
      />
      <AbasCorretor sufixo={sufixo(ctx.escolhido)} gestao={ctx.gestao} />
    </>
  );
}

/** O usuário ainda não está ligado a um cadastro de corretor. */
export function AvisoSemVinculo({ ctx }: { ctx: Ctx }) {
  return (
    <Aviso tipo="alerta">
      {ctx.ehCorretor ? (
        <>Seu usuário ainda não está ligado ao seu cadastro de corretor. Peça a um administrador ou gestor para fazer a ligação em “Meu portal (corretor) → Usuários e corretores”.</>
      ) : (
        <>
          Escolha um corretor acima para ver o portal dele
          {ctx.gestao ? (
            <>
              {" "}
              ou ligue os usuários aos cadastros em{" "}
              <Link href="/corretor/equipe" className="font-semibold text-acento hover:underline">
                Usuários e corretores
              </Link>
            </>
          ) : null}
          .
        </>
      )}
    </Aviso>
  );
}
