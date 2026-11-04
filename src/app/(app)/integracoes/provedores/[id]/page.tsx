import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExternalLink, MapPin, PlugZap } from "lucide-react";
import { BotaoAcao } from "@/components/botao-acao";
import { BotaoExcluir } from "@/components/botao-excluir";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { Aviso, BotaoLink, Cabecalho, Campo, Cartao, Entrada, Selecao, Selo } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { COR_STATUS_INTEGRACAO, OPCOES_AMBIENTE, ROTULO_STATUS_INTEGRACAO, itemCatalogo, statusIntegracao } from "@/lib/dominio/integracoes";
import { cifragemLigada } from "@/lib/servicos/integracoes/segredos";
import { AbasIntegracoes } from "../../abas";
import { apagarSegredos, excluirProvedor, guardarSegredos, localizarImoveis, salvarProvedor, testarProvedor } from "../../actions";
import { quando, type ConfigProvedor } from "../../dados";

export const metadata: Metadata = { title: "Configurar integração" };

function UltimoTeste({ cfg }: { cfg: ConfigProvedor | null }) {
  if (!cfg?.ultimo_teste_em) return <p className="text-sm text-mudo">Ainda não testado.</p>;
  return (
    <p className={`text-sm ${cfg.ultimo_teste_ok ? "text-ok" : "text-ruim"}`}>
      Último teste ({quando(cfg.ultimo_teste_em)}): {cfg.ultimo_teste_msg ?? (cfg.ultimo_teste_ok ? "ok" : "falhou")}
    </p>
  );
}

/** Configuração de um provedor: campos comuns (salvam sozinhos), chaves (guardadas sem voltar à tela) e teste real quando existe. */
export default async function ProvedorPage({ params }: PageProps<"/integracoes/provedores/[id]">) {
  const { id } = await params;
  const item = itemCatalogo(id);
  const { supabase, organizacao, papel } = await obterContexto();
  if (!item || (item.tipo !== "provedor" && id !== "nominatim") || (item.soImobiliaria && organizacao.modo === "pessoal")) notFound();
  const admin = papel === "admin";
  const { data } = await supabase.from("integracoes_config").select("*").eq("provedor", id).maybeSingle();
  const cfg = (data as ConfigProvedor | null) ?? null;
  const st = statusIntegracao(item, cfg);

  if (id === "nominatim") {
    const { count: semPosicao } = await supabase
      .from("imoveis")
      .select("id", { count: "exact", head: true })
      .or("latitude.is.null,longitude.is.null")
      .not("logradouro", "is", null)
      .not("cidade", "is", null);
    return (
      <>
        <Cabecalho titulo={item.nome} trilha="Integrações" descricao={item.descricao} />
        <AbasIntegracoes />
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <Cartao titulo="Testar">
            <div className="space-y-3">
              <UltimoTeste cfg={cfg} />
              {admin && (
                <BotaoAcao acao={testarProvedor} id="nominatim">
                  <PlugZap className="size-4" /> Testar conexão
                </BotaoAcao>
              )}
            </div>
          </Cartao>
          <Cartao titulo={`Imóveis sem posição no mapa: ${semPosicao ?? 0}`}>
            <p className="mb-3 text-sm text-texto-2">
              Preenche latitude e longitude a partir da rua, número, bairro e cidade do cadastro. O OpenStreetMap aceita uma consulta por segundo, então cada clique localiza alguns imóveis.
              Se o endereço não for achado, preencha a posição à mão no cadastro do imóvel.
            </p>
            {admin && (semPosicao ?? 0) > 0 && (
              <Formulario acao={localizarImoveis} className="space-y-3">
                <BotaoEnviar>
                  <MapPin className="size-4" /> Localizar agora
                </BotaoEnviar>
              </Formulario>
            )}
          </Cartao>
        </div>
      </>
    );
  }

  const comuns = (item.campos ?? []).filter((c) => c.tipo !== "segredo");
  const segredos = (item.campos ?? []).filter((c) => c.tipo === "segredo");
  return (
    <>
      <Cabecalho
        titulo={item.nome}
        trilha="Integrações"
        descricao={item.descricao}
        acoes={
          <>
            <Selo cor={COR_STATUS_INTEGRACAO[st]}>{ROTULO_STATUS_INTEGRACAO[st]}</Selo>
            {item.site && (
              <BotaoLink href={item.site} variante="secundario" target="_blank" rel="noopener noreferrer">
                <ExternalLink className="size-4" /> Site do provedor
              </BotaoLink>
            )}
          </>
        }
      />
      <AbasIntegracoes />
      <div className="mb-5">
        {item.testavel ? (
          <Aviso>
            O botão <strong>Testar conexão</strong> faz uma consulta real (só leitura) na API do provedor com a chave guardada. Emitir cobranças, mandar e-mails e receber avisos por
            ele ainda depende de ligar o serviço contratado.
          </Aviso>
        ) : (
          <Aviso tipo="alerta">
            <strong>Estrutura pronta, depende do contrato/credencial.</strong> A configuração fica guardada aqui, mas o sistema ainda não conversa com este provedor — nenhuma chamada é
            feita. Quando o contrato existir, a integração é ligada usando estes dados.
          </Aviso>
        )}
      </div>
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <Cartao titulo="Configuração">
          <Formulario acao={salvarProvedor} automatico>
            <fieldset disabled={!admin} className="space-y-4">
              <input type="hidden" name="provedor" value={item.id} />
              <Campo rotulo="Ambiente">
                <Selecao name="ambiente" defaultValue={cfg?.ambiente ?? "sandbox"}>
                  {OPCOES_AMBIENTE.map((o) => (
                    <option key={o.valor} value={o.valor}>
                      {o.rotulo}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              {comuns.map((c) => (
                <Campo key={c.nome} rotulo={c.rotulo} dica={c.dica}>
                  {c.tipo === "selecao" ? (
                    <Selecao name={c.nome} defaultValue={cfg?.config?.[c.nome] ?? ""}>
                      <option value="">—</option>
                      {(c.opcoes ?? []).map((o) => (
                        <option key={o.valor} value={o.valor}>
                          {o.rotulo}
                        </option>
                      ))}
                    </Selecao>
                  ) : (
                    <Entrada name={c.nome} defaultValue={cfg?.config?.[c.nome] ?? ""} required={c.obrigatorio} autoComplete="off" />
                  )}
                </Campo>
              ))}
              <label className="flex items-center gap-2 text-sm text-texto-2">
                <input type="hidden" name="ativo" value="off" />
                <input type="checkbox" name="ativo" defaultChecked={cfg?.ativo ?? false} className="size-4" /> Integração ligada
              </label>
            </fieldset>
          </Formulario>
        </Cartao>

        {segredos.length > 0 && (
          <Cartao
            titulo="Chaves e senhas"
            acoes={
              admin && Object.keys(cfg?.chaves_dica ?? {}).length > 0 ? (
                <BotaoExcluir acao={apagarSegredos} id={item.id} variante="texto" rotulo="Apagar chaves" confirmar="Apagar as chaves guardadas deste provedor? A integração fica desligada." />
              ) : undefined
            }
          >
            {admin ? (
              <Formulario acao={guardarSegredos} className="space-y-4">
                <input type="hidden" name="provedor" value={item.id} />
                {segredos.map((c) => {
                  const dica = cfg?.chaves_dica?.[c.nome];
                  return (
                    <Campo key={c.nome} rotulo={c.rotulo} dica={dica ? `Guardada (${dica}). Deixe em branco para manter.` : "Ainda não guardada."}>
                      <Entrada name={c.nome} type="password" autoComplete="new-password" placeholder={dica ?? ""} />
                    </Campo>
                  );
                })}
                <p className="text-xs text-mudo">
                  {cifragemLigada()
                    ? "As chaves são cifradas antes de ir para o banco e só o administrador consegue usá-las. Elas não aparecem de novo na tela."
                    : "As chaves ficam no banco numa área que só o administrador lê e não aparecem de novo na tela. Para cifrar também, configure a variável INTEGRACOES_CHAVE na Vercel."}
                </p>
                <BotaoEnviar>Guardar chaves</BotaoEnviar>
              </Formulario>
            ) : (
              <ul className="space-y-2 text-sm">
                {segredos.map((c) => (
                  <li key={c.nome} className="flex justify-between gap-3">
                    <span className="text-texto-2">{c.rotulo}</span>
                    <span className="font-mono text-mudo">{cfg?.chaves_dica?.[c.nome] ?? "não guardada"}</span>
                  </li>
                ))}
              </ul>
            )}
          </Cartao>
        )}

        {item.testavel && (
          <Cartao titulo="Testar conexão">
            <div className="space-y-3">
              <UltimoTeste cfg={cfg} />
              {admin && (
                <BotaoAcao acao={testarProvedor} id={item.id}>
                  <PlugZap className="size-4" /> Testar conexão
                </BotaoAcao>
              )}
              <p className="text-xs text-mudo">Com o último teste ok, o status fica “Configurado (conexão ok)”. Emitir cobranças ou mandar e-mails por este provedor ainda depende de ligar o serviço.</p>
            </div>
          </Cartao>
        )}
      </div>
      {admin && cfg && (
        <div className="mt-6">
          <BotaoExcluir acao={excluirProvedor} id={item.id} variante="botao" rotulo="Excluir configuração" confirmar="Excluir a configuração e as chaves deste provedor?" depois="/integracoes" />
        </div>
      )}
    </>
  );
}
