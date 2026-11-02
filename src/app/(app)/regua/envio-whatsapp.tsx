"use client";

import { useMemo, useState, useTransition } from "react";
import { MessageCircle, Search } from "lucide-react";
import { atualizarTelefone } from "@/app/(app)/pessoas/actions";
import { classeBotao } from "@/components/ui";
import { renderizarMensagem } from "@/lib/dominio/regua";
import { formatarCompetencia, formatarDataBR } from "@/lib/dominio/datas";
import { formatarReais } from "@/lib/dominio/dinheiro";

export interface ClienteEnvio {
  id: string;
  nome: string;
  telefone: string | null;
  faturas: { id: string; competencia: string; vencimento: string; valor: number; imovel: string }[];
}

export interface ModeloEnvio {
  id: string;
  nome: string;
  mensagem: string;
}

const LIVRE = "__livre__";
const rotuloCampo = "font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo";
const campo =
  "w-full min-h-[46px] rounded-btn border border-borda-forte bg-input px-3.5 py-2.5 text-[15px] text-texto outline-none transition focus:border-acento focus:ring-4 focus:ring-acento-bg";

function linkWhatsapp(telefone: string, mensagem: string) {
  const d = telefone.replace(/\D/g, "");
  const numero = d.length <= 11 ? `55${d}` : d;
  return `https://wa.me/${numero}?text=${encodeURIComponent(mensagem)}`;
}

/** Envio avulso: escolhe o cliente, confere o celular, escolhe a mensagem e abre o WhatsApp. */
export function EnvioWhatsapp({ clientes, modelos }: { clientes: ClienteEnvio[]; modelos: ModeloEnvio[] }) {
  const [busca, setBusca] = useState("");
  const [clienteId, setClienteId] = useState("");
  const [telefone, setTelefone] = useState("");
  const [faturaId, setFaturaId] = useState("");
  const [modeloId, setModeloId] = useState(modelos[0]?.id ?? LIVRE);
  const [texto, setTexto] = useState("");
  const [editado, setEditado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; msg: string } | null>(null);
  const [, iniciar] = useTransition();

  const cliente = clientes.find((c) => c.id === clienteId) ?? null;
  const fatura = cliente?.faturas.find((f) => f.id === faturaId) ?? cliente?.faturas[0] ?? null;

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? clientes.filter((c) => c.nome.toLowerCase().includes(q)) : clientes;
  }, [busca, clientes]);

  // Mensagem montada a partir do modelo + dados da cobrança (até a pessoa editar à mão).
  const gerada = useMemo(() => {
    if (!cliente) return "";
    const modelo = modelos.find((m) => m.id === modeloId);
    if (!modelo) return `Olá ${cliente.nome.split(" ")[0]}! `;
    return renderizarMensagem(modelo.mensagem, {
      nome: cliente.nome.split(" ")[0],
      valor: fatura?.valor ?? 0,
      vencimento: fatura?.vencimento ?? "",
      competencia: fatura?.competencia ?? "",
      imovel: fatura?.imovel ?? "",
    });
  }, [cliente, fatura, modeloId, modelos]);
  const mensagem = editado ? texto : gerada;

  const escolherCliente = (id: string) => {
    const c = clientes.find((x) => x.id === id);
    setClienteId(id);
    setTelefone(c?.telefone ?? "");
    setFaturaId(c?.faturas[0]?.id ?? "");
    setEditado(false);
    setAviso(null);
  };

  const digitos = telefone.replace(/\D/g, "");
  const telefoneValido = digitos.length >= 10 && digitos.length <= 13;

  const enviar = () => {
    if (!cliente || !telefoneValido || !mensagem.trim()) return;
    // Abre o WhatsApp na hora (o navegador bloqueia janelas abertas depois de esperar o servidor).
    window.open(linkWhatsapp(telefone, mensagem), "_blank", "noopener");
    const mudou = (cliente.telefone ?? "").replace(/\D/g, "") !== digitos;
    if (mudou) {
      iniciar(async () => {
        const r = await atualizarTelefone(cliente.id, telefone);
        setAviso(r.ok ? { tipo: "ok", msg: "Celular salvo no cadastro do cliente." } : { tipo: "erro", msg: r.erro ?? "Erro ao salvar o celular." });
      });
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
      <div className="space-y-4">
        <label className="flex flex-col gap-1.5">
          <span className={rotuloCampo}>1. Cliente</span>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-mudo" />
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar pelo nome"
              className={`${campo} pl-10`}
            />
          </div>
          <select value={clienteId} onChange={(e) => escolherCliente(e.target.value)} className={campo} size={Math.min(6, Math.max(3, filtrados.length))}>
            {filtrados.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome}
                {c.telefone ? "" : "  · sem celular"}
              </option>
            ))}
          </select>
          {filtrados.length === 0 && <span className="text-xs text-mudo">Ninguém encontrado com esse nome.</span>}
        </label>

        {cliente && (
          <>
            <label className="flex flex-col gap-1.5">
              <span className={rotuloCampo}>2. Celular (WhatsApp)</span>
              <input
                value={telefone}
                onChange={(e) => setTelefone(e.target.value)}
                inputMode="tel"
                placeholder="(51) 99999-9999"
                className={campo}
              />
              <span className="text-xs text-mudo">
                {cliente.telefone ? "Se mudar o número, ele é atualizado no cadastro." : "Sem celular no cadastro: o número digitado será salvo."}
              </span>
            </label>

            {cliente.faturas.length > 1 && (
              <label className="flex flex-col gap-1.5">
                <span className={rotuloCampo}>Cobrança</span>
                <select
                  value={fatura?.id ?? ""}
                  onChange={(e) => {
                    setFaturaId(e.target.value);
                    setEditado(false);
                  }}
                  className={campo}
                >
                  {cliente.faturas.map((f) => (
                    <option key={f.id} value={f.id}>
                      {formatarCompetencia(f.competencia)} · {formatarReais(f.valor)} · vence {formatarDataBR(f.vencimento)}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </>
        )}
      </div>

      <div className="space-y-4">
        <label className="flex flex-col gap-1.5">
          <span className={rotuloCampo}>3. Mensagem</span>
          <select
            value={modeloId}
            onChange={(e) => {
              setModeloId(e.target.value);
              setEditado(false);
            }}
            className={campo}
            disabled={!cliente}
          >
            {modelos.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nome}
              </option>
            ))}
            <option value={LIVRE}>Mensagem livre</option>
          </select>
        </label>
        <textarea
          rows={5}
          value={mensagem}
          disabled={!cliente}
          onChange={(e) => {
            setTexto(e.target.value);
            setEditado(true);
          }}
          placeholder="Escolha um cliente para montar a mensagem."
          className={`${campo} resize-y`}
        />
        {cliente && !fatura && modeloId !== LIVRE && (
          <p className="text-xs text-alerta">Este cliente não tem cobrança em aberto: valor e vencimento ficam em branco na mensagem.</p>
        )}
        {aviso && <p className={`text-xs ${aviso.tipo === "ok" ? "text-ok" : "text-ruim"}`}>{aviso.msg}</p>}
        <div className="flex justify-end">
          <button
            type="button"
            onClick={enviar}
            disabled={!cliente || !telefoneValido || !mensagem.trim()}
            className={classeBotao("primario")}
            title={!cliente ? "Escolha um cliente" : !telefoneValido ? "Informe o celular com DDD" : undefined}
          >
            <MessageCircle className="size-4" /> Abrir no WhatsApp
          </button>
        </div>
      </div>
    </div>
  );
}
