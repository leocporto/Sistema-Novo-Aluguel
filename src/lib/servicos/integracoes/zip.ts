/*
 * Arquivo .zip simples ("store": sem compressão — fotos e PDFs já vêm
 * comprimidos), com nomes em UTF-8. Sem biblioteca: cabeçalho local, diretório
 * central e fim de diretório (formato PKWARE APPNOTE). Até 4 GB por arquivo.
 */

const TABELA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function crc32(dados: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < dados.length; i++) c = TABELA_CRC[(c ^ dados[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function dataDos(d: Date): { hora: number; dia: number } {
  const ano = Math.max(1980, d.getFullYear());
  return {
    hora: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2),
    dia: ((ano - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

export type ArquivoZip = { nome: string; dados: Uint8Array; data?: Date };

export function montarZip(arquivos: ArquivoZip[]): Uint8Array {
  const enc = new TextEncoder();
  const locais: Uint8Array[] = [];
  const centrais: Uint8Array[] = [];
  let deslocamento = 0;
  for (const a of arquivos) {
    const nome = enc.encode(a.nome.replace(/^\/+/, ""));
    const crc = crc32(a.dados);
    const { hora, dia } = dataDos(a.data ?? new Date());
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true);
    local.setUint16(8, 0, true);
    local.setUint16(10, hora, true);
    local.setUint16(12, dia, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, a.dados.length, true);
    local.setUint32(22, a.dados.length, true);
    local.setUint16(26, nome.length, true);
    local.setUint16(28, 0, true);
    locais.push(new Uint8Array(local.buffer), nome, a.dados);

    const central = new DataView(new ArrayBuffer(46));
    central.setUint32(0, 0x02014b50, true);
    central.setUint16(4, 20, true);
    central.setUint16(6, 20, true);
    central.setUint16(8, 0x0800, true);
    central.setUint16(10, 0, true);
    central.setUint16(12, hora, true);
    central.setUint16(14, dia, true);
    central.setUint32(16, crc, true);
    central.setUint32(20, a.dados.length, true);
    central.setUint32(24, a.dados.length, true);
    central.setUint16(28, nome.length, true);
    central.setUint32(42, deslocamento, true);
    centrais.push(new Uint8Array(central.buffer), nome);
    deslocamento += 30 + nome.length + a.dados.length;
  }
  const tamCentral = centrais.reduce((s, p) => s + p.length, 0);
  const fimDir = new DataView(new ArrayBuffer(22));
  fimDir.setUint32(0, 0x06054b50, true);
  fimDir.setUint16(8, arquivos.length, true);
  fimDir.setUint16(10, arquivos.length, true);
  fimDir.setUint32(12, tamCentral, true);
  fimDir.setUint32(16, deslocamento, true);
  const partes = [...locais, ...centrais, new Uint8Array(fimDir.buffer)];
  const total = partes.reduce((s, p) => s + p.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const p of partes) {
    out.set(p, i);
    i += p.length;
  }
  return out;
}
