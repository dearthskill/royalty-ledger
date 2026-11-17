// Minimal CSV reader (RFC 4180): comma-separated, optional "quoted" fields, "" = a literal quote,
// CRLF or LF line ends. The first line is the header; returns one object per data row.
export function parseCsv(text: string): { header: string[]; rows: Record<string, string>[] } {
  const lines: string[][] = [];
  let field = '', line: string[] = [], quoted = false;
  const src = text.replace(/^﻿/, ''); // strip a byte-order mark (Excel exports)

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { line.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      line.push(field); lines.push(line); field = ''; line = [];
    } else field += ch;
  }
  if (field !== '' || line.length) { line.push(field); lines.push(line); }

  const nonEmpty = lines.filter(l => !(l.length === 1 && l[0].trim() === ''));
  if (!nonEmpty.length) return { header: [], rows: [] };
  const header = nonEmpty[0].map(h => h.trim());
  const rows = nonEmpty.slice(1).map(cells =>
    Object.fromEntries(header.map((h, j) => [h, (cells[j] ?? '').trim()])));
  return { header, rows };
}
