import { Aviso, BotaoLink, Cabecalho } from "@/components/ui";

/** Tela publicada antes da atualização do banco: avisa em vez de quebrar. */
export function AvisoBancoPendente({ titulo }: { titulo: string }) {
  return (
    <>
      <Cabecalho titulo={titulo} />
      <Aviso tipo="alerta">
        Esta tela ainda está esperando uma atualização do banco de dados. Assim que ela for aplicada no Supabase, a tela passa a funcionar sozinha — não precisa fazer nada aqui.
      </Aviso>
      <div className="mt-4">
        <BotaoLink href="/" variante="secundario">
          Voltar ao Painel
        </BotaoLink>
      </div>
    </>
  );
}
