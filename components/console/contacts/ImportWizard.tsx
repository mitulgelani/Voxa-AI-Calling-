'use client';

import { useMemo, useRef, useState } from 'react';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { createList, finishImport, importChunk, type ImportRow } from '@/app/console/_actions/contacts';
import { maskPhone } from '@/lib/console/format';

const MAX_ROWS = 50_000;
const CHUNK = 1000;

/** RFC 4180-ish CSV parser: quotes, escaped quotes, CRLF, BOM; delimiter sniffed from line one. */
function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.slice(0, src.indexOf('\n') === -1 ? undefined : src.indexOf('\n'));
  const delim = [',', ';', '\t'].map((d) => [d, first.split(d).length] as const).sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (q) {
      if (c === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (c === '"') q = false;
      else cell += c;
    } else if (c === '"' && cell === '') q = true;
    else if (c === delim) { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) break;
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  return rows;
}

const guess = (headers: string[], words: RegExp) => headers.findIndex((h) => words.test(h.toLowerCase()));

const LANG_WORDS: [RegExp, ImportRow['language']][] = [
  [/hinglish/, 'hinglish'], [/^(hi|hin|hindi|हिन्दी|हिंदी)/, 'hi-IN'], [/^(gu|guj|gujarati|ગુજરાતી)/, 'gu-IN'],
  [/^(en-us|us english|american)/, 'en-US'], [/^(en|eng|english)/, 'en-IN'],
];
function toLang(v: string): ImportRow['language'] {
  const s = v.trim().toLowerCase();
  for (const [re, id] of LANG_WORDS) if (re.test(s)) return id;
  return null;
}

/** Accepts 2026-03-14, 2026-03-14T10:00, 14/03/2026 and 14-03-2026 (day first, as written in India). */
function toDate(v: string): string | null {
  const s = v.trim();
  if (!s) return null;
  let d: Date | null = null;
  const dmy = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})/);
  if (dmy) d = new Date(Date.UTC(+dmy[3], +dmy[2] - 1, +dmy[1], 6, 30));
  else if (/^\d{4}-\d{2}-\d{2}/.test(s)) d = new Date(s.length === 10 ? `${s}T12:00:00Z` : s);
  if (!d || Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 864e5) return null;
  return d.toISOString();
}

type Mapping = { phone: number; name: number; language: number; consentAt: number; consentSource: number; keep: boolean };

export function ImportWizard({ country }: { country: CountryCode }) {
  const [file, setFile] = useState<{ name: string; rows: string[][] } | null>(null);
  const [err, setErr] = useState('');
  const [listName, setListName] = useState('');
  const [map, setMap] = useState<Mapping | null>(null);
  const [consentMode, setConsentMode] = useState<'column' | 'same'>('same');
  const [sameSource, setSameSource] = useState('');
  const [sameDate, setSameDate] = useState('');
  const [attest, setAttest] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number; inserted: number } | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = async (f: File | undefined) => {
    setErr('');
    if (!f) return;
    if (f.size > 10_000_000) return setErr('The file is larger than 10 MB. Split it into smaller lists.');
    if (!/\.(csv|tsv|txt)$/i.test(f.name)) return setErr('Choose a .csv file. In Excel or Sheets use File → Download → CSV.');
    const rows = parseCsv(await f.text());
    if (rows.length < 2) return setErr('The file needs a header row and at least one contact.');
    if (rows.length > MAX_ROWS + 1) return setErr(`A list can hold up to ${MAX_ROWS.toLocaleString('en-IN')} contacts. Split the file.`);
    const headers = rows[0];
    const m: Mapping = {
      phone: guess(headers, /phone|mobile|msisdn|number|contact|whatsapp/),
      name: guess(headers, /name/),
      language: guess(headers, /lang|bhasha/),
      consentAt: guess(headers, /consent.*(date|at|time)|opt.?in.*(date|at)/),
      consentSource: guess(headers, /consent.*(source|how|method)|opt.?in.*(source|channel)/),
      keep: true,
    };
    if (m.consentAt >= 0) setConsentMode('column');
    setMap(m);
    setFile({ name: f.name, rows });
    setListName(f.name.replace(/\.[a-z]+$/i, '').replace(/[_-]+/g, ' ').slice(0, 80));
  };

  const result = useMemo(() => {
    if (!file || !map || map.phone < 0) return null;
    const [headers, ...body] = file.rows;
    const used = new Set([map.phone, map.name, map.language, map.consentAt, map.consentSource]);
    const extra = headers.map((h, i) => [h.trim().slice(0, 40), i] as const).filter(([h, i]) => h && !used.has(i)).slice(0, 20);
    const sameIso = consentMode === 'same' ? toDate(sameDate) : null;
    const seen = new Set<string>();
    const ok: ImportRow[] = [];
    const bad: { line: number; value: string }[] = [];
    let dupes = 0;
    let noConsent = 0;
    body.forEach((r, i) => {
      const raw = (r[map.phone] ?? '').trim();
      const p = parsePhoneNumberFromString(raw.replace(/[^\d+]/g, '').replace(/^00/, '+'), country);
      if (!p?.isValid()) { bad.push({ line: i + 2, value: raw }); return; }
      if (seen.has(p.number)) { dupes++; return; }
      seen.add(p.number);
      const consent_source = consentMode === 'same' ? (sameSource.trim() || null) : map.consentSource >= 0 ? (r[map.consentSource] ?? '').trim().slice(0, 200) || null : null;
      const consent_at = consentMode === 'same' ? sameIso : map.consentAt >= 0 ? toDate(r[map.consentAt] ?? '') : null;
      if (!consent_source || !consent_at) noConsent++;
      ok.push({
        e164: p.number,
        name: map.name >= 0 ? (r[map.name] ?? '').trim().slice(0, 120) : '',
        language: map.language >= 0 ? toLang(r[map.language] ?? '') : null,
        consent_source, consent_at,
        attrs: map.keep ? Object.fromEntries(extra.map(([h, idx]) => [h, (r[idx] ?? '').trim().slice(0, 200)]).filter(([, v]) => v)) : {},
      });
    });
    return { ok, bad, dupes, noConsent, extra: extra.map(([h]) => h) };
  }, [file, map, consentMode, sameSource, sameDate, country]);

  const run = async () => {
    if (!result || !attest) return;
    setErr('');
    const created = await createList(listName);
    if (!created.ok || !created.id) return setErr(created.ok ? 'Could not create the list.' : created.error);
    const attestation = consentMode === 'same' ? `Same for all rows: ${sameSource} (${sameDate})` : 'Per-row consent columns';
    let inserted = 0;
    setProgress({ done: 0, total: result.ok.length, inserted: 0 });
    for (let i = 0; i < result.ok.length; i += CHUNK) {
      const res = await importChunk(created.id, result.ok.slice(i, i + CHUNK), attestation);
      if (!res.ok) { setErr(`${res.error} ${inserted.toLocaleString('en-IN')} contacts were saved before this.`); setProgress(null); return; }
      inserted += res.inserted;
      setProgress({ done: Math.min(i + CHUNK, result.ok.length), total: result.ok.length, inserted });
    }
    await finishImport(created.id);
  };

  if (!file || !map) {
    return (
      <div className="max-w-2xl">
        <label
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); load(e.dataTransfer.files[0]); }}
          className="flex cursor-pointer flex-col items-center rounded-[var(--radius-card)] border border-dashed border-line-2 bg-panel/50 px-6 py-14 text-center hover:border-lamp/60">
          <span className="font-display text-xl">Drop a CSV here, or choose a file</span>
          <span className="mt-2 max-w-md text-sm text-ink-2">One row per person, with a phone column. Indian numbers can be written as 98765 43210, 098765-43210 or +91 98765 43210.</span>
          <input ref={input} type="file" accept=".csv,.tsv,.txt,text/csv" className="sr-only" onChange={(e) => load(e.target.files?.[0])} />
          <span className="btn btn-quiet btn-sm mt-6">Choose file</span>
        </label>
        {err ? <p role="alert" className="mt-4 text-sm text-fail">{err}</p> : null}
        <p className="mt-6 text-sm text-ink-3">Up to {MAX_ROWS.toLocaleString('en-IN')} contacts and 10 MB per file.</p>
      </div>
    );
  }

  const headers = file.rows[0];
  const sel = (key: keyof Omit<Mapping, 'keep'>, label: string, required = false) => (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-ink-2">{label}{required ? '' : <span className="font-normal text-ink-3"> (optional)</span>}</span>
      <select className="field" value={map[key]} onChange={(e) => setMap({ ...map, [key]: Number(e.target.value) })}>
        <option value={-1}>{required ? 'Choose a column' : 'Not in this file'}</option>
        {headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
      </select>
    </label>
  );
  const ready = result && result.ok.length > 0 && listName.trim() && attest && (consentMode === 'column' || (sameSource.trim().length >= 3 && toDate(sameDate)));

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <section className="surface p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-xl">Columns</h2>
            <button type="button" className="text-sm text-ink-3 hover:text-ink" onClick={() => { setFile(null); setMap(null); }}>Choose a different file</button>
          </div>
          <p className="mt-1 text-sm text-ink-3">{file.name}, {(file.rows.length - 1).toLocaleString('en-IN')} rows</p>
          <div className="mt-5 grid gap-4 sm:grid-cols-3">
            {sel('phone', 'Phone number', true)}
            {sel('name', 'Name')}
            {sel('language', 'Preferred language')}
          </div>
          <label className="mt-4 flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" className="mt-1 accent-[var(--color-lamp)]" checked={map.keep} onChange={(e) => setMap({ ...map, keep: e.target.checked })} />
            <span>Keep the other columns ({result?.extra.length ? result.extra.slice(0, 5).join(', ') + (result.extra.length > 5 ? '…' : '') : 'none'}) so the agent can use them, for example the order ID.</span>
          </label>
        </section>

        <section className="surface p-6">
          <h2 className="font-display text-xl">How did these people agree to be called?</h2>
          <p className="mt-1 text-sm text-ink-2">Campaigns only call contacts with a consent source and date. Keep the original evidence; this is what you will show a regulator.</p>
          <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Consent evidence">
            {(['same', 'column'] as const).map((m) => (
              <button key={m} type="button" role="radio" aria-checked={consentMode === m} onClick={() => setConsentMode(m)}
                className={`rounded-full border px-3 py-1.5 text-sm ${consentMode === m ? 'border-lamp bg-lamp/10' : 'border-line-2 text-ink-2'}`}>
                {m === 'same' ? 'The same way for everyone' : 'It is in the file'}
              </button>
            ))}
          </div>
          {consentMode === 'same' ? (
            <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_180px]">
              <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Consent source</span>
                <input className="field" value={sameSource} onChange={(e) => setSameSource(e.target.value)} maxLength={200} placeholder="Checkout checkbox on glowleaf.in" /></label>
              <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">Collected on or after</span>
                <input type="date" className="field" value={sameDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setSameDate(e.target.value)} /></label>
            </div>
          ) : (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {sel('consentSource', 'Consent source column', true)}
              {sel('consentAt', 'Consent date column', true)}
            </div>
          )}
        </section>

        {result && result.bad.length ? (
          <section className="surface p-6">
            <h2 className="font-display text-xl">Rows that will be skipped</h2>
            <p className="mt-1 text-sm text-ink-2">{result.bad.length.toLocaleString('en-IN')} rows do not contain a valid phone number.</p>
            <ul className="tnum mt-3 grid gap-1 text-sm text-ink-3 sm:grid-cols-2">
              {result.bad.slice(0, 8).map((b) => <li key={b.line}>Line {b.line}: “{b.value || 'empty'}”</li>)}
            </ul>
          </section>
        ) : null}
      </div>

      <aside className="lg:sticky lg:top-8 lg:self-start">
        <div className="surface p-6">
          <label className="block"><span className="mb-1.5 block text-sm font-medium text-ink-2">List name</span>
            <input className="field" value={listName} onChange={(e) => setListName(e.target.value)} maxLength={80} /></label>
          {result ? (
            <dl className="tnum mt-5 space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-ink-2">Will be imported</dt><dd className="font-medium">{result.ok.length.toLocaleString('en-IN')}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Duplicates in the file</dt><dd>{result.dupes.toLocaleString('en-IN')}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Invalid numbers</dt><dd className={result.bad.length ? 'text-warn' : ''}>{result.bad.length.toLocaleString('en-IN')}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-2">Without consent evidence</dt><dd className={result.noConsent ? 'text-warn' : 'text-pass'}>{result.noConsent.toLocaleString('en-IN')}</dd></div>
            </dl>
          ) : <p className="mt-5 text-sm text-warn">Choose the phone column.</p>}
          {result && result.noConsent ? <p className="mt-3 text-xs text-ink-3">Contacts without consent are saved but never called.</p> : null}
          {result?.ok.length ? (
            <ul className="tnum mt-5 space-y-1 border-t border-line pt-4 text-sm text-ink-3" aria-label="First contacts">
              {result.ok.slice(0, 4).map((r) => <li key={r.e164} className="flex justify-between gap-3"><span className="truncate">{r.name || 'No name'}</span><span>{maskPhone(r.e164)}</span></li>)}
            </ul>
          ) : null}
          <label className="mt-5 flex items-start gap-2 text-sm">
            <input type="checkbox" className="mt-1 accent-[var(--color-lamp)]" checked={attest} onChange={(e) => setAttest(e.target.checked)} />
            <span>I confirm these people agreed to be contacted by us as described, and I can produce the evidence. This statement is saved in the audit log.</span>
          </label>
          <button type="button" className="btn btn-lamp mt-5 w-full" disabled={!ready || !!progress} onClick={run}>
            {progress ? `Importing ${progress.done.toLocaleString('en-IN')} of ${progress.total.toLocaleString('en-IN')}` : `Import ${result?.ok.length.toLocaleString('en-IN') ?? ''} contacts`}
          </button>
          {progress ? <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><div className="h-full bg-lamp transition-[width]" style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }} /></div> : null}
          {err ? <p role="alert" className="mt-3 text-sm text-fail">{err}</p> : null}
        </div>
      </aside>
    </div>
  );
}
