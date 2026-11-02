"use client";

import { useEffect, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { UserPlus } from "lucide-react";
import { criarPessoaRapida } from "@/app/(app)/pessoas/actions";
import { classeBotao, Entrada, Selecao } from "./ui";

const NOVA = "__nova__";

type Opcao = { id: string; nome: string };

/**
 * Seleção de pessoa com a opção "+ Novo …" que abre uma janela para
 * cadastrar só nome e CPF/CNPJ; a pessoa criada já fica selecionada.
 */
export function SeletorPessoa({
  name,
  pessoas,
  papel,
  rotuloNovo,
  obrigatorio = false,
  vazio = "Selecione…",
}: {
  name: string;
  pessoas: Opcao[];
  papel: "locatario" | "fiador" | "proprietario";
  rotuloNovo: string;
  obrigatorio?: boolean;
  vazio?: string;
}) {
  const [opcoes, setOpcoes] = useState<Opcao[]>(pessoas);
  const [valor, setValor] = useState("");
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState("");
  const [documento, setDocumento] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, iniciar] = useTransition();
  const campoNome = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberto) campoNome.current?.focus();
  }, [aberto]);

  function fechar() {
    setAberto(false);
    setErro(null);
    setNome("");
    setDocumento("");
  }

  function salvar() {
    setErro(null);
    iniciar(async () => {
      const r = await criarPessoaRapida({ nome, documento, papel });
      if (!r.ok) {
        setErro(r.erro);
        return;
      }
      setOpcoes((atual) => [...atual, { id: r.id, nome: r.nome }].sort((a, b) => a.nome.localeCompare(b.nome)));
      setValor(r.id);
      fechar();
    });
  }

  // Os campos da janela ficam dentro do formulário do contrato: Enter salva a
  // pessoa em vez de enviar o contrato.
  function aoTeclar(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter") {
      e.preventDefault();
      salvar();
    }
    if (e.key === "Escape") fechar();
  }

  return (
    <>
      <Selecao
        name={name}
        required={obrigatorio}
        value={valor}
        onChange={(e) => {
          if (e.target.value === NOVA) setAberto(true);
          else setValor(e.target.value);
        }}
      >
        <option value="" disabled={obrigatorio}>
          {vazio}
        </option>
        <option value={NOVA}>+ {rotuloNovo}</option>
        {opcoes.map((p) => (
          <option key={p.id} value={p.id}>
            {p.nome}
          </option>
        ))}
      </Selecao>

      {aberto &&
        createPortal(
        <div
          className="janela-fundo fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[rgba(10,14,20,.45)] p-4 backdrop-blur-[6px]"
          onClick={(e) => {
            if (e.target === e.currentTarget) fechar();
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label={rotuloNovo}
            className="janela w-full max-w-md rounded-card border border-borda bg-card p-6 shadow-[0_24px_60px_-20px_rgba(0,0,0,.45)]"
          >
            <div className="mb-5 flex items-center gap-3">
              <span className="flex size-9 items-center justify-center rounded-[10px] border border-acento-bd bg-acento-bg text-acento-hot">
                <UserPlus className="size-4" />
              </span>
              <h3 className="text-[17px] font-semibold tracking-[-0.01em] text-texto">{rotuloNovo}</h3>
            </div>
            <div className="space-y-4">
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">Nome completo</span>
                <Entrada ref={campoNome} value={nome} onChange={(e) => setNome(e.target.value)} onKeyDown={aoTeclar} />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-mudo">CPF ou CNPJ</span>
                <Entrada
                  inputMode="numeric"
                  value={documento}
                  onChange={(e) => setDocumento(e.target.value)}
                  onKeyDown={aoTeclar}
                  placeholder="000.000.000-00"
                />
              </label>
              {erro && <div className="rounded-[14px] border border-ruim-bd bg-ruim-bg px-4 py-2.5 text-sm text-ruim">{erro}</div>}
              <p className="text-xs text-mudo">Os demais dados (contato, endereço, banco) podem ser completados depois em Pessoas.</p>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <button type="button" className={classeBotao("secundario")} onClick={fechar}>
                Cancelar
              </button>
              <button type="button" className={classeBotao("primario")} onClick={salvar} disabled={salvando || !nome.trim()}>
                {salvando ? "Salvando…" : "Salvar e selecionar"}
              </button>
            </div>
          </div>
        </div>,
          document.body,
        )}
    </>
  );
}
