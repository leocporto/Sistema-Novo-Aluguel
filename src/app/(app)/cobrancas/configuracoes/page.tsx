import type { Metadata } from "next";
import Link from "next/link";
import { Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Entrada, Selecao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { MEIOS_COBRANCA } from "@/lib/dominio/cobrancas";
import { normalizarChavePix, ROTULO_TIPO_CHAVE } from "@/lib/dominio/pix";
import { AbasCobrancas } from "../abas";
import { salvarConfigCobranca, type AvisoRegua } from "../actions";
import { carregarRegras, configCobranca, contasAtivas, pixDaCobranca, recebedorPix } from "../dados";
import { EditorRegua } from "./editor-regua";

export const metadata: Metadata = { title: "Régua e Pix" };

export default async function ConfigCobrancaPage() {
  const { supabase, organizacao, papel } = await obterContexto();
  const cfg = configCobranca(organizacao);
  const pode = papel === "admin" || papel === "gestor";
  const [regras, contas, recebedor] = await Promise.all([carregarRegras(supabase), contasAtivas(supabase), recebedorPix(supabase, organizacao)]);
  const tipoChave = normalizarChavePix(recebedor?.chave)?.tipo;
  const exemplo = pixDaCobranca(recebedor, 150000, "FAT123");
  const inicial: AvisoRegua[] = regras.map((r) => ({
    id: r.id,
    dias: Math.abs(r.dias_relativos) || 1,
    quando: r.dias_relativos < 0 ? "antes" : r.dias_relativos === 0 ? "no_dia" : "depois",
    canal: r.canal === "whatsapp" || r.canal === "sms" ? r.canal : "email",
    mensagem: r.mensagem,
    ativo: r.ativo,
  }));

  return (
    <>
      <Cabecalho titulo="Régua e Pix" trilha="Cobranças" descricao="Quando avisar (antes e depois do vencimento), por qual canal, com qual mensagem — e como o locatário paga." />
      <AbasCobrancas />
      {!pode && (
        <div className="mb-5">
          <Aviso tipo="alerta">Só administrador ou gestor muda estas configurações.</Aviso>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Cartao titulo="Como o locatário paga">
          <Formulario acao={salvarConfigCobranca} automatico className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Chave Pix para receber" dica={tipoChave ? `Chave reconhecida: ${ROTULO_TIPO_CHAVE[tipoChave]}.` : "CPF, CNPJ, e-mail, celular com DDD ou chave aleatória."}>
                <Entrada name="cobranca_pix_chave" defaultValue={cfg.pixChave ?? ""} placeholder={recebedor && !cfg.pixChave ? `${recebedor.chave} (da conta)` : ""} />
              </Campo>
              <Campo rotulo="Conta de recebimento">
                <Selecao name="cobranca_conta_id" defaultValue={cfg.contaId ?? ""}>
                  <option value="">— não informar —</option>
                  {contas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.nome}
                      {c.pix_chave ? " (tem chave Pix)" : ""}
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Nome de quem recebe (no Pix)" dica="Até 25 letras, sem acento.">
                <Entrada name="cobranca_pix_nome" maxLength={25} defaultValue={cfg.pixNome ?? ""} placeholder={organizacao.nome.slice(0, 25)} />
              </Campo>
              <Campo rotulo="Cidade de quem recebe (no Pix)" dica="Até 15 letras.">
                <Entrada name="cobranca_pix_cidade" maxLength={15} defaultValue={cfg.pixCidade ?? ""} />
              </Campo>
            </div>
            <fieldset>
              <legend className="mb-2 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Meios aceitos (aparecem na 2ª via)</legend>
              <input type="hidden" name="cobranca_meios" value="" />
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-texto-2">
                {Object.entries(MEIOS_COBRANCA).map(([k, r]) => (
                  <label key={k} className="flex items-center gap-2">
                    <input type="checkbox" name="cobranca_meios" value={k} defaultChecked={cfg.meios.includes(k)} className="size-4" /> {r}
                  </label>
                ))}
              </div>
            </fieldset>
            <Campo rotulo="Instruções na 2ª via (opcional)">
              <AreaTexto name="cobranca_instrucoes" rows={2} defaultValue={cfg.instrucoes ?? ""} placeholder="Ex.: depois de pagar, mande o comprovante no WhatsApp (51) 9…" />
            </Campo>
            <label className="flex items-center gap-2 text-sm text-texto-2">
              <input type="hidden" name="cobranca_link_publico" value="" />
              <input type="checkbox" name="cobranca_link_publico" defaultChecked={cfg.linkPublico} className="size-4" /> Mandar link da 2ª via nas mensagens (o locatário abre sem senha)
            </label>
          </Formulario>
          {exemplo ? (
            <p className="mt-4 break-all rounded-[12px] bg-elev p-3 font-mono text-[11px] text-texto-2">Exemplo de Pix (R$ 1.500,00, cobrança #123): {exemplo}</p>
          ) : (
            cfg.meios.includes("pix") && <p className="mt-4 text-xs text-alerta">Sem chave Pix válida: o código Pix não sai na cobrança.</p>
          )}
          <p className="mt-3 text-xs text-mudo">
            O Pix gerado aqui é “copia e cola” estático com o valor e o identificador da cobrança (FAT + número). Boleto registrado e Pix com confirmação automática do banco ficam prontos para ligar quando houver contrato de cobrança com um banco.
          </p>
        </Cartao>

        <Cartao titulo="Envio automático e prazos">
          <Formulario acao={salvarConfigCobranca} automatico className="space-y-4">
            <label className="flex items-center gap-2 text-sm text-texto">
              <input type="hidden" name="cobranca_envio_automatico" value="" />
              <input type="checkbox" name="cobranca_envio_automatico" defaultChecked={cfg.envioAutomatico} className="size-4" /> Envio automático: montar a fila de saída dos avisos todo dia
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Horário do envio">
                <Selecao name="cobranca_hora_envio" defaultValue={String(cfg.horaEnvio)}>
                  {Array.from({ length: 15 }, (_, i) => i + 7).map((h) => (
                    <option key={h} value={h}>
                      {h}h
                    </option>
                  ))}
                </Selecao>
              </Campo>
              <Campo rotulo="Canal padrão">
                <Selecao name="cobranca_canal_padrao" defaultValue={cfg.canalPadrao}>
                  <option value="whatsapp">WhatsApp</option>
                  <option value="email">E-mail</option>
                  <option value="sms">SMS</option>
                </Selecao>
              </Campo>
              <Campo rotulo="Sugerir jurídico com atraso de (dias)">
                <Entrada name="cobranca_juridico_dias" type="number" min={1} defaultValue={cfg.juridicoDias} />
              </Campo>
              <Campo rotulo="Quebra do acordo com parcela atrasada há (dias)">
                <Entrada name="cobranca_quebra_dias" type="number" min={1} defaultValue={cfg.quebraDias} />
              </Campo>
            </div>
          </Formulario>
          <div className="mt-4">
            <Aviso tipo="info">
              Ligado, a partir do horário escolhido os avisos do dia são gravados na fila de saída, com a mensagem pronta (2ª via e Pix), o canal e o destinatário. Para eles saírem
              sem nenhum clique é preciso contratar um provedor (WhatsApp Business API, SMS ou e-mail) — ainda não há nenhum ligado, então nada é enviado sozinho. Até lá, os avisos
              ficam em{" "}
              <Link href="/cobrancas/fila" className="text-acento hover:underline">
                Avisos de hoje
              </Link>{" "}
              para enviar com um clique.
            </Aviso>
          </div>
          <p className="mt-4 text-sm text-texto-2">
            Multa e juros: valem os do contrato. O padrão para contratos novos ({Number(organizacao.multa_atraso_pct)}% de multa e {Number(organizacao.juros_mes_pct)}% de juros ao mês
            {organizacao.carencia_dias ? `, ${organizacao.carencia_dias} dia(s) de tolerância` : ""}) fica em{" "}
            <Link href="/configuracoes" className="text-acento hover:underline">
              Configurações
            </Link>
            . A Lei do Inquilinato e o Código Civil limitam a multa moratória contratual; juros de mora costumam ser de até 1% ao mês.
          </p>
        </Cartao>
      </div>

      <Cartao titulo="Régua de cobrança (quando avisar)" className="mt-6">
        <p className="mb-4 text-[13px] text-texto-2">
          Avisos antes do vencimento (lembrete), no dia e depois (cobrança). Use {"{{link}}"} e {"{{pix}}"} para pôr a 2ª via e o Pix no texto — se não usar, eles vão no fim da mensagem.
        </p>
        <EditorRegua inicial={inicial} />
      </Cartao>
    </>
  );
}
