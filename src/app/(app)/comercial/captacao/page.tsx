import type { Metadata } from "next";
import { headers } from "next/headers";
import { Formulario } from "@/components/formulario";
import { Cabecalho, Cartao } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { salvarCaptacao } from "../actions";
import { AbasComercial } from "../campos";
import { Copiar, NovoLink } from "./copiar";

export const metadata: Metadata = { title: "Captação de leads" };

const ORIGENS: [string, string][] = [
  ["site", "Site"],
  ["instagram", "Instagram (link na bio)"],
  ["facebook", "Facebook"],
  ["whatsapp", "WhatsApp (status/mensagem)"],
  ["tiktok", "TikTok"],
];

export default async function CaptacaoPage() {
  const { supabase, organizacao } = await obterContexto();
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const base = `${host.startsWith("localhost") ? "http" : "https"}://${host}`;
  const [{ data: org }, { data: corretores }] = await Promise.all([
    supabase.from("organizacoes").select("leads_token, distribuicao_leads").eq("id", organizacao.id).single(),
    supabase.from("pessoas").select("id, nome, recebe_leads").contains("papeis", ["corretor"]).order("nome"),
  ]);
  const token = org?.leads_token as string;
  const link = `${base}/l/${token}`;
  const api = `${base}/api/leads/${token}`;
  const exemplo = `curl -X POST ${api} \\\n  -H "Content-Type: application/json" \\\n  -d '{"nome":"Maria","telefone":"11999999999","origem":"zap","funil":"locacao","imovel":"AP-101","mensagem":"Quero visitar"}'`;
  const iframe = `<iframe src="${link}?origem=site" style="width:100%;max-width:480px;height:640px;border:0"></iframe>`;
  const pre = "mt-2 overflow-x-auto whitespace-pre-wrap break-all rounded-[12px] border border-borda bg-elev p-3 font-mono text-[12px] text-texto";

  return (
    <>
      <Cabecalho
        titulo="Captação de leads"
        trilha="Comercial"
        descricao="Links e integrações para os contatos caírem sozinhos no funil — sem repetir quem já está em atendimento — e o rodízio entre corretores."
      />
      <AbasComercial />
      <div className="grid gap-6 xl:grid-cols-2">
        <Cartao titulo="Formulário de contato" acoes={<NovoLink />}>
          <p className="text-sm text-texto-2">Coloque este link no site, na bio do Instagram, no Facebook ou mande pelo WhatsApp. Quem preencher vira lead na hora.</p>
          <div className={pre}>{link}</div>
          <div className="mt-2 flex flex-wrap gap-2">
            <Copiar texto={link} />
            <a href={link} target="_blank" rel="noreferrer" className="text-sm font-semibold text-acento hover:underline">
              Abrir formulário
            </a>
          </div>
          <h4 className="mb-1 mt-5 text-sm font-semibold text-texto">Um link para cada origem (para saber de onde veio)</h4>
          <ul className="space-y-2 text-sm">
            {ORIGENS.map(([o, r]) => (
              <li key={o} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-texto-2">{r}</span>
                <Copiar texto={`${link}?origem=${o}`} rotulo="Copiar link" />
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-mudo">
            Para um imóvel específico, acrescente <code>&imovel=CÓDIGO</code> (ex.: <code>?origem=instagram&imovel=AP-101</code>) — o imóvel já entra associado ao lead.
          </p>
        </Cartao>

        <Formulario acao={salvarCaptacao} automatico>
          <Cartao titulo="Distribuição entre corretores">
            <div className="space-y-3">
              {[
                ["manual", "Manual", "O lead entra sem corretor; você escolhe quem atende."],
                ["rodizio", "Rodízio automático", "Cada lead novo vai para o próximo corretor da fila (quem recebeu há mais tempo)."],
              ].map(([v, t, d]) => (
                <label key={v} className="flex cursor-pointer gap-3 rounded-[14px] border border-borda p-3 has-[:checked]:border-acento has-[:checked]:bg-acento-bg">
                  <input type="radio" name="distribuicao_leads" value={v} defaultChecked={(org?.distribuicao_leads ?? "manual") === v} className="mt-1" />
                  <span>
                    <span className="block font-semibold text-texto">{t}</span>
                    <span className="text-xs text-texto-2">{d}</span>
                  </span>
                </label>
              ))}
              <div>
                <h4 className="mb-2 mt-2 text-sm font-semibold text-texto">Quem entra no rodízio</h4>
                {(corretores ?? []).length === 0 ? (
                  <p className="text-sm text-mudo">Cadastre corretores em Pessoas (papel “Corretor”).</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {(corretores ?? []).map((c) => (
                      <label key={c.id} className="flex cursor-pointer items-center gap-2 rounded-full border border-borda px-3 py-1.5 text-sm has-[:checked]:border-ok-bd has-[:checked]:bg-ok-bg">
                        <input type="checkbox" name="recebe" value={c.id} defaultChecked={c.recebe_leads} /> {c.nome}
                      </label>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </Cartao>
        </Formulario>

        <Cartao titulo="No seu site (incorporar)">
          <p className="text-sm text-texto-2">Cole este código na página de contato do site:</p>
          <div className={pre}>{iframe}</div>
          <div className="mt-2">
            <Copiar texto={iframe} />
          </div>
        </Cartao>

        <Cartao titulo="Portais e integrações (API)">
          <p className="text-sm text-texto-2">
            Para portais, Zapier/Make ou o seu site enviarem leads direto: faça um <strong>POST</strong> em JSON para o endereço abaixo. Campos: nome, telefone,
            email, mensagem, origem (zap, vivareal, olx, imovelweb, site…), funil (locacao, venda, captacao) e imovel (código).
          </p>
          <div className={pre}>{api}</div>
          <div className="mt-2">
            <Copiar texto={api} />
          </div>
          <div className={pre}>{exemplo}</div>
        </Cartao>
      </div>
    </>
  );
}
