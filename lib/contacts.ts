// Parse a block pasted from Excel / Google Sheets (tab separated) or a CSV file.
import type { Contact } from './types';

export interface ParseResult {
  contacts: Contact[];
  headers: string[];
  skipped: number;
  duplicates: number;
}

function splitCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"' && cur.trim() === '') quoted = true;
    else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function detectDelimiter(lines: string[]): string {
  const sample = lines.slice(0, 5).join('\n');
  if (sample.includes('\t')) return '\t';
  const counts = [',', ';', '|'].map((d) => ({ d, n: sample.split(d).length }));
  counts.sort((a, b) => b.n - a.n);
  return counts[0].n > 1 ? counts[0].d : '\t';
}

export function normalisePhone(raw: string): string {
  let s = String(raw || '').trim();
  // Excel turns long numbers into 9.19876543210E+11
  if (/^\d+(\.\d+)?e\+\d+$/i.test(s)) s = Number(s).toFixed(0);
  const plus = s.startsWith('+') || s.startsWith('00');
  const digits = s.replace(/\D/g, '').replace(/^00/, '');
  return digits ? (plus ? `+${digits}` : digits) : '';
}

function looksLikePhone(v: string): boolean {
  const d = normalisePhone(v).replace('+', '');
  return d.length >= 7 && d.length <= 15;
}

const PHONE_HEADER = /phone|mobile|cell|number|contact|tel|whatsapp|msisdn/i;
const NAME_HEADER = /name|customer|client|lead|person/i;

export function parseContacts(text: string, existing: Contact[] = []): ParseResult {
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim());
  if (!lines.length) return { contacts: [], headers: [], skipped: 0, duplicates: 0 };
  const delimiter = detectDelimiter(lines);
  const rows = lines.map((l) => splitCsvLine(l, delimiter));
  const width = Math.max(...rows.map((r) => r.length));

  // Header row: has no phone-like cell and at least one cell that reads like a label.
  const first = rows[0];
  const hasHeader = !first.some(looksLikePhone) && first.some((c) => /[a-z]/i.test(c));
  const headers = hasHeader
    ? Array.from({ length: width }, (_, i) => (first[i] || `column ${i + 1}`).trim())
    : Array.from({ length: width }, (_, i) => `column ${i + 1}`);
  const body = hasHeader ? rows.slice(1) : rows;

  let phoneCol = headers.findIndex((h) => PHONE_HEADER.test(h));
  if (phoneCol < 0 || !body.some((r) => looksLikePhone(r[phoneCol] || ''))) {
    // Pick the column where most cells look like phone numbers.
    let best = -1;
    let bestScore = 0;
    for (let c = 0; c < width; c++) {
      const score = body.filter((r) => looksLikePhone(r[c] || '')).length;
      if (score > bestScore) {
        best = c;
        bestScore = score;
      }
    }
    phoneCol = best;
  }
  let nameCol = headers.findIndex((h, i) => i !== phoneCol && NAME_HEADER.test(h));
  if (nameCol < 0) {
    nameCol = headers.findIndex((_, i) => i !== phoneCol && body.some((r) => /[a-z]/i.test(r[i] || '')));
  }

  const seen = new Set(existing.map((c) => c.phone));
  const contacts: Contact[] = [];
  let skipped = 0;
  let duplicates = 0;
  body.forEach((r, idx) => {
    const phone = phoneCol >= 0 ? normalisePhone(r[phoneCol] || '') : '';
    if (!phone || !looksLikePhone(phone)) {
      skipped++;
      return;
    }
    if (seen.has(phone)) {
      duplicates++;
      return;
    }
    seen.add(phone);
    const fields: Record<string, string> = {};
    headers.forEach((h, i) => {
      if (i === phoneCol || i === nameCol) return;
      const v = (r[i] || '').trim();
      if (v) fields[h] = v;
    });
    contacts.push({
      id: `c${Date.now().toString(36)}${idx.toString(36)}${Math.random().toString(36).slice(2, 5)}`,
      name: (nameCol >= 0 ? r[nameCol] : '')?.trim() || `Contact ${existing.length + contacts.length + 1}`,
      phone,
      fields,
      status: 'new',
    });
  });
  return { contacts, headers, skipped, duplicates };
}

export function toCsv(rows: (string | number)[][]): string {
  return rows
    .map((r) => r.map((c) => {
      const s = String(c ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    }).join(','))
    .join('\n');
}

export function downloadText(filename: string, text: string, type = 'text/csv') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
