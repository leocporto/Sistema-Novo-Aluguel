"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Upload } from "lucide-react";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Campo, Entrada, Selecao, classeBotao } from "@/components/ui";
import { enviarArquivoAnalise } from "@/app/(app)/analise/envio";
import { enviarFicha, registrarArquivoFicha } from "./actions";

const TIPOS: [string, string][] = [
  ["clt", "Salário (carteira assinada)"],
  ["servidor", "Servidor público"],
  ["pro_labore", "Pró-labore"],
  ["autonomo", "Autônomo / profissional liberal"],
  ["empresario", "Lucros da empresa"],
  ["aposentadoria", "Aposentadoria"],
  ["pensao", "Pensão"],
  ["aluguel", "Aluguéis recebidos"],
  ["investimentos", "Investimentos"],
  ["beneficio", "Benefício (INSS, bolsa…)"],
  ["outro", "Outra renda"],
];

/** Dados, renda e autorização (LGPD). */
export function FichaDados({ token, textoConsentimento, jaEnviou }: { token: string; textoConsentimento: string; jaEnviou: boolean }) {
  return (
    <Formulario acao={enviarFicha} className="space-y-4">
      <input type="hidden" name="token" value={token} />
      <input type="text" name="site_url" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      <div className="grid gap-4 sm:grid-cols-2">
        <Campo rotulo="WhatsApp / telefone">
          <Entrada name="telefone" inputMode="tel" autoComplete="tel" />
        </Campo>
        <Campo rotulo="E-mail">
          <Entrada name="email" type="email" autoComplete="email" />
        </Campo>
        <Campo rotulo="Profissão">
          <Entrada name="profissao" />
        </Campo>
        <Campo rotulo="Estado civil">
          <Selecao name="estado_civil" defaultValue="">
            <option value="">—</option>
            <option>solteiro(a)</option>
            <option>casado(a)</option>
            <option>união estável</option>
            <option>divorciado(a)</option>
            <option>viúvo(a)</option>
          </Selecao>
        </Campo>
        <Campo rotulo="Onde trabalha (empresa)">
          <Entrada name="empregador" />
        </Campo>
        <Campo rotulo="Quantas pessoas vão morar">
          <Entrada name="moradores" type="number" min={0} max={50} />
        </Campo>
      </div>
      <Campo rotulo="Quem vai morar (nomes, idades, animais)">
        <AreaTexto name="moradores_obs" rows={2} />
      </Campo>
      <fieldset className="space-y-3 rounded-[14px] border border-borda-suave p-4">
        <legend className="px-1 font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Sua renda por mês</legend>
        {[0, 1, 2].map((i) => (
          <div key={i} className="grid gap-3 sm:grid-cols-[1.2fr_1.2fr_.8fr]">
            <Selecao name={`renda_tipo_${i}`} defaultValue="clt" aria-label={`Tipo da renda ${i + 1}`}>
              {TIPOS.map(([k, r]) => (
                <option key={k} value={k}>
                  {r}
                </option>
              ))}
            </Selecao>
            <Entrada name={`renda_fonte_${i}`} placeholder="De onde vem (empresa, INSS…)" aria-label={`De onde vem a renda ${i + 1}`} />
            <Entrada name={`renda_valor_${i}`} inputMode="decimal" placeholder="R$ por mês (ex.: 3.500,00)" aria-label={`Valor da renda ${i + 1}`} />
          </div>
        ))}
        <p className="text-xs text-mudo">Preencha só as linhas que tiver. A renda é confirmada pelos comprovantes que você enviar.</p>
      </fieldset>
      <Campo rotulo="Algo mais que devemos saber (opcional)">
        <AreaTexto name="observacoes" rows={2} />
      </Campo>
      <label className="flex items-start gap-2 rounded-[14px] border border-borda bg-elev px-4 py-3 text-sm text-texto-2">
        <input type="checkbox" name="consentimento" required className="mt-0.5 size-4 shrink-0 accent-[var(--accent)]" />
        <span>{textoConsentimento}</span>
      </label>
      <div className="flex justify-end">
        <BotaoEnviar>{jaEnviou ? "Enviar de novo" : "Enviar ficha"}</BotaoEnviar>
      </div>
    </Formulario>
  );
}

type Doc = { id: string; rotulo: string; status: string; obrigatorio: boolean; parte: string; motivo: string | null };

/** Envio dos documentos pedidos (cada um com seu botão). */
export function FichaDocumentos({ token, documentos, organizacao }: { token: string; documentos: Doc[]; organizacao: string | null }) {
  const [enviados, setEnviados] = useState<Record<string, number>>({});
  const [enviando, setEnviando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const entradas = useRef<Record<string, HTMLInputElement | null>>({});
  const router = useRouter();

  const enviar = async (docId: string | null, lista: FileList) => {
    const fs = [...lista];
    if (!fs.length) return;
    setErro(null);
    const chave = docId ?? "outro";
    for (let i = 0; i < fs.length; i++) {
      setEnviando(`${chave}:${i + 1}/${fs.length}`);
      try {
        const path = await enviarArquivoAnalise(`ficha/${token}`, fs[i]);
        const r = await registrarArquivoFicha(token, path, fs[i].name, docId);
        if (!r.ok) throw new Error(r.erro);
        setEnviados((e) => ({ ...e, [chave]: (e[chave] ?? 0) + 1 }));
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível enviar.");
        break;
      }
    }
    setEnviando(null);
    const el = entradas.current[chave];
    if (el) el.value = "";
    router.refresh();
  };

  const linha = (id: string | null, rotulo: string, detalhe?: string | null, status?: string) => {
    const chave = id ?? "outro";
    const n = enviados[chave] ?? 0;
    const rodando = enviando?.startsWith(`${chave}:`);
    return (
      <li key={chave} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <div className="text-sm font-medium text-texto">{rotulo}</div>
          {status === "recusado" && detalhe && <div className="text-xs text-ruim">Precisa enviar de novo: {detalhe}</div>}
          {status === "recebido" && !n && <div className="text-xs text-ok">Recebido — em conferência</div>}
          {n > 0 && (
            <div className="flex items-center gap-1 text-xs text-ok">
              <Check className="size-3.5" /> {n} arquivo(s) enviado(s)
            </div>
          )}
        </div>
        <button
          type="button"
          disabled={Boolean(enviando)}
          onClick={() => entradas.current[chave]?.click()}
          className={classeBotao("secundario", "sm")}
        >
          <Upload className="size-3.5" /> {rodando ? `Enviando ${enviando?.split(":")[1]}…` : "Enviar"}
        </button>
        <input
          ref={(el) => {
            entradas.current[chave] = el;
          }}
          type="file"
          multiple
          accept="image/*,application/pdf"
          className="hidden"
          onChange={(e) => e.target.files && void enviar(id, e.target.files)}
        />
      </li>
    );
  };

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-borda-suave overflow-hidden rounded-[14px] border border-borda">
        {documentos.map((d) => linha(d.id, `${d.rotulo}${d.parte === "fiador" ? " — do fiador" : d.parte === "conjuge" ? " — do cônjuge" : ""}${d.obrigatorio ? "" : " (opcional)"}`, d.motivo, d.status))}
        {linha(null, "Outro documento")}
      </ul>
      {erro && <div className="rounded-[12px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
      <p className="text-xs text-mudo">Foto (JPG, PNG) ou PDF de até 10 MB. Os arquivos vão direto para {organizacao || "quem enviou o link"}, em ambiente protegido.</p>
    </div>
  );
}
