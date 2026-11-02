import type { Metadata } from "next";
import { revalidatePath } from "next/cache";
import { BotaoEnviar, Formulario } from "@/components/formulario";
import { AreaTexto, Aviso, Cabecalho, Campo, Cartao, Celula, Entrada, LinhaVazia, Selecao, Selo, Tabela } from "@/components/ui";
import { obterContexto } from "@/lib/contexto";
import { formatarDataBR, hojeISO, somarDias } from "@/lib/dominio/datas";
import { enviosDevidos, renderizarMensagem, JANELA_RECUPERACAO_DIAS } from "@/lib/dominio/regua";
import { type EstadoAcao, inteiro, lista, mensagemErro, texto, textoObrigatorio } from "@/lib/form";

export const metadata: Metadata = { title: "Régua de cobrança" };

type Regra = { id: string; nome: string; dias_relativos: number; canal: string; assunto: string | null; mensagem: string; ativo: boolean };
type FaturaR = {
  id: string;
  numero: number;
  vencimento: string;
  competencia: string;
  valor_total: number;
  status: string;
  contrato: { imovel: { codigo: string; logradouro: string | null; numero: string | null }; contrato_partes: { papel: string; pessoa: { nome: string; email: string | null; telefone: string | null } }[] };
};

async function salvarRegra(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase } = await obterContexto();
  try {
    const id = texto(fd, "id");
    const dados = {
      nome: textoObrigatorio(fd, "nome", "o nome"),
      dias_relativos: inteiro(fd, "dias_relativos") ?? 0,
      canal: texto(fd, "canal") ?? "email",
      assunto: texto(fd, "assunto"),
      mensagem: textoObrigatorio(fd, "mensagem", "a mensagem"),
      ativo: fd.get("ativo") === "on",
    };
    const { error } = id
      ? await supabase.from("regua_regras").update(dados).eq("id", id)
      : await supabase.from("regua_regras").insert(dados);
    if (error) throw error;
  } catch (e) {
    return { erro: mensagemErro(e) };
  }
  revalidatePath("/regua");
  return { ok: "Regra salva." };
}

async function registrarEnvios(_: EstadoAcao, fd: FormData): Promise<EstadoAcao> {
  "use server";
  const { supabase } = await obterContexto();
  const pares = lista(fd, "envio").map((s) => {
    const [regra_id, fatura_id, destinatario] = s.split("|");
    return { regra_id, fatura_id, destinatario: destinatario || null, status: "registrado" };
  });
  if (!pares.length) return { erro: "Nada para registrar." };
  const { error } = await supabase.from("regua_envios").upsert(pares, { onConflict: "regra_id,fatura_id", ignoreDuplicates: true });
  if (error) return { erro: mensagemErro(error) };
  revalidatePath("/regua");
  return { ok: `${pares.length} envio(s) registrado(s).` };
}

export default async function ReguaPage() {
  const { supabase } = await obterContexto();
  const hoje = hojeISO();
  const [{ data: regrasRaw }, { data: faturasRaw }, { data: enviosRaw }] = await Promise.all([
    supabase.from("regua_regras").select("*").order("dias_relativos"),
    supabase
      .from("faturas")
      .select(
        "id, numero, vencimento, competencia, valor_total, status, contrato:contratos(imovel:imoveis(codigo, logradouro, numero), contrato_partes(papel, pessoa:pessoas(nome, email, telefone)))",
      )
      .eq("status", "aberta")
      .gte("vencimento", somarDias(hoje, -60))
      .lte("vencimento", somarDias(hoje, 30)),
    supabase.from("regua_envios").select("regra_id, fatura_id, enviado_em").gte("enviado_em", somarDias(hoje, -90)),
  ]);
  const regras = (regrasRaw ?? []) as Regra[];
  const faturas = (faturasRaw ?? []) as unknown as FaturaR[];
  const enviados = new Set((enviosRaw ?? []).map((e) => `${e.regra_id}:${e.fatura_id}`));
  const devidos = enviosDevidos(
    regras.map((r) => ({ id: r.id, diasRelativos: r.dias_relativos, ativo: r.ativo })),
    faturas,
    hoje,
    enviados,
  ).map((d) => {
    const regra = regras.find((r) => r.id === d.regraId)!;
    const f = faturas.find((x) => x.id === d.faturaId)!;
    const loc = f.contrato.contrato_partes.find((p) => p.papel === "locatario")?.pessoa;
    const vars = {
      nome: loc?.nome ?? "",
      valor: Number(f.valor_total),
      vencimento: f.vencimento,
      competencia: f.competencia,
      imovel: `${f.contrato.imovel.codigo} (${[f.contrato.imovel.logradouro, f.contrato.imovel.numero].filter(Boolean).join(", ")})`,
    };
    const corpo = renderizarMensagem(regra.mensagem, vars);
    const assunto = renderizarMensagem(regra.assunto ?? "", vars);
    const fone = (loc?.telefone ?? "").replace(/\D/g, "");
    const link =
      regra.canal === "whatsapp" && fone
        ? `https://wa.me/${fone.length <= 11 ? `55${fone}` : fone}?text=${encodeURIComponent(corpo)}`
        : loc?.email
          ? `mailto:${loc.email}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent(corpo)}`
          : null;
    return { ...d, regra, fatura: f, loc, corpo, link, destinatario: regra.canal === "whatsapp" ? fone : (loc?.email ?? "") };
  });

  return (
    <>
      <Cabecalho
        titulo="Régua de cobrança"
        descricao="Lembretes antes do vencimento e cobranças após o atraso, disparados conforme as regras abaixo."
      />
      <div className="mb-6">
        <Aviso>
          Os disparos devidos hoje aparecem abaixo com a mensagem pronta (e-mail ou WhatsApp). O envio automático exige conectar um provedor de
          e-mail/WhatsApp — veja docs/ROADMAP.md. Atrasos de até {JANELA_RECUPERACAO_DIAS} dias no disparo são recuperados.
        </Aviso>
      </div>

      <Cartao titulo={`Envios devidos hoje (${formatarDataBR(hoje)})`} className="mb-6">
        <Formulario acao={registrarEnvios} className="space-y-3">
          <Tabela colunas={["Regra", "Fatura", "Locatário", "Mensagem", "Ação"]}>
            {devidos.length === 0 && <LinhaVazia colunas={5}>Nenhum envio pendente hoje.</LinhaVazia>}
            {devidos.map((d) => (
              <tr key={`${d.regraId}:${d.faturaId}`}>
                <Celula>
                  <input type="hidden" name="envio" value={`${d.regraId}|${d.faturaId}|${d.destinatario}`} />
                  {d.regra.nome}
                  <div className="text-xs text-mudo">{d.regra.canal}</div>
                </Celula>
                <Celula>
                  #{d.fatura.numero} · vence {formatarDataBR(d.fatura.vencimento)}
                </Celula>
                <Celula>
                  {d.loc?.nome}
                  <div className="text-xs text-mudo">{d.destinatario || "sem contato"}</div>
                </Celula>
                <Celula className="max-w-md text-xs">{d.corpo}</Celula>
                <Celula>
                  {d.link ? (
                    <a href={d.link} target="_blank" rel="noreferrer" className="text-acento hover:underline">
                      Abrir {d.regra.canal === "whatsapp" ? "WhatsApp" : "e-mail"}
                    </a>
                  ) : (
                    <Selo cor="amarelo">cadastrar contato</Selo>
                  )}
                </Celula>
              </tr>
            ))}
          </Tabela>
          {devidos.length > 0 && <BotaoEnviar>Marcar todos como enviados</BotaoEnviar>}
        </Formulario>
      </Cartao>

      <div className="grid gap-6 lg:grid-cols-2">
        {regras.map((r) => (
          <Cartao key={r.id} titulo={r.nome} acoes={<Selo cor={r.ativo ? "verde" : "cinza"}>{r.ativo ? "ativa" : "inativa"}</Selo>}>
            <FormRegra regra={r} />
          </Cartao>
        ))}
        <Cartao titulo="Nova regra">
          <FormRegra />
        </Cartao>
      </div>
    </>
  );
}

function FormRegra({ regra }: { regra?: Regra }) {
  return (
    <Formulario acao={salvarRegra} className="space-y-3">
      {regra && <input type="hidden" name="id" value={regra.id} />}
      <div className="grid grid-cols-3 gap-2">
        <Campo rotulo="Nome" className="col-span-3">
          <Entrada name="nome" required defaultValue={regra?.nome} />
        </Campo>
        <Campo rotulo="Dias (− antes, + depois)">
          <Entrada type="number" name="dias_relativos" defaultValue={regra?.dias_relativos ?? 0} />
        </Campo>
        <Campo rotulo="Canal">
          <Selecao name="canal" defaultValue={regra?.canal ?? "email"}>
            <option value="email">E-mail</option>
            <option value="whatsapp">WhatsApp</option>
            <option value="sms">SMS</option>
          </Selecao>
        </Campo>
        <label className="flex items-end gap-2 pb-2 text-sm">
          <input type="checkbox" name="ativo" defaultChecked={regra?.ativo ?? true} /> Ativa
        </label>
      </div>
      <Campo rotulo="Assunto">
        <Entrada name="assunto" defaultValue={regra?.assunto ?? ""} />
      </Campo>
      <Campo rotulo="Mensagem" dica="Variáveis: {{nome}} {{valor}} {{vencimento}} {{competencia}} {{imovel}}">
        <AreaTexto name="mensagem" required defaultValue={regra?.mensagem} />
      </Campo>
      <BotaoEnviar variante="secundario">Salvar regra</BotaoEnviar>
    </Formulario>
  );
}
