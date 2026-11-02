import { paraReais } from "./dinheiro";

/**
 * Consolidação anual para a DIMOB (Declaração de Informações sobre Atividades
 * Imobiliárias): por contrato e locador, o aluguel bruto, a comissão
 * (taxa de administração + intermediação) e o IR retido em cada mês.
 *
 * Esta versão gera uma planilha (CSV) com os dados exigidos pela declaração.
 * A geração do arquivo no layout oficial da Receita Federal (registros de
 * posições fixas) fica para uma próxima etapa, pois deve ser validada no
 * programa gerador da DIMOB.
 */
export interface RepasseDimob {
  contratoCodigo: string;
  dataContrato: string;
  imovelEndereco: string;
  imovelCep: string;
  imovelCidade: string;
  imovelUf: string;
  locadorNome: string;
  locadorDocumento: string;
  locatarioNome: string;
  locatarioDocumento: string;
  competencia: string; // AAAA-MM-01
  aluguelBruto: number; // centavos
  comissao: number; // centavos
  irrf: number; // centavos
}

export interface LinhaDimob {
  chave: string;
  base: Omit<RepasseDimob, "competencia" | "aluguelBruto" | "comissao" | "irrf">;
  meses: { aluguel: number; comissao: number; irrf: number }[]; // 12 posições, centavos
}

export function consolidarDimob(repasses: RepasseDimob[], ano: number): LinhaDimob[] {
  const mapa = new Map<string, LinhaDimob>();
  for (const r of repasses) {
    if (!r.competencia.startsWith(String(ano))) continue;
    const chave = `${r.contratoCodigo}|${r.locadorDocumento}`;
    let linha = mapa.get(chave);
    if (!linha) {
      linha = {
        chave,
        base: {
          contratoCodigo: r.contratoCodigo,
          dataContrato: r.dataContrato,
          imovelEndereco: r.imovelEndereco,
          imovelCep: r.imovelCep,
          imovelCidade: r.imovelCidade,
          imovelUf: r.imovelUf,
          locadorNome: r.locadorNome,
          locadorDocumento: r.locadorDocumento,
          locatarioNome: r.locatarioNome,
          locatarioDocumento: r.locatarioDocumento,
        },
        meses: Array.from({ length: 12 }, () => ({ aluguel: 0, comissao: 0, irrf: 0 })),
      };
      mapa.set(chave, linha);
    }
    const m = Number(r.competencia.slice(5, 7)) - 1;
    linha.meses[m].aluguel += r.aluguelBruto;
    linha.meses[m].comissao += r.comissao;
    linha.meses[m].irrf += r.irrf;
  }
  return [...mapa.values()].sort((a, b) => a.chave.localeCompare(b.chave));
}

function csv(valor: string | number): string {
  const s = typeof valor === "number" ? valor.toFixed(2).replace(".", ",") : valor;
  return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function dimobParaCSV(linhas: LinhaDimob[]): string {
  const meses = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
  const cab = [
    "contrato",
    "data_contrato",
    "locador",
    "cpf_cnpj_locador",
    "locatario",
    "cpf_cnpj_locatario",
    "endereco_imovel",
    "cep",
    "cidade",
    "uf",
    ...meses.flatMap((m) => [`aluguel_${m}`, `comissao_${m}`, `irrf_${m}`]),
  ];
  const corpo = linhas.map((l) =>
    [
      l.base.contratoCodigo,
      l.base.dataContrato,
      l.base.locadorNome,
      l.base.locadorDocumento,
      l.base.locatarioNome,
      l.base.locatarioDocumento,
      l.base.imovelEndereco,
      l.base.imovelCep,
      l.base.imovelCidade,
      l.base.imovelUf,
      ...l.meses.flatMap((m) => [paraReais(m.aluguel), paraReais(m.comissao), paraReais(m.irrf)]),
    ]
      .map(csv)
      .join(";"),
  );
  return [cab.join(";"), ...corpo].join("\n");
}
