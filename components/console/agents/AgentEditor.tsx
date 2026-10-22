'use client';

import { useActionState, useMemo, useState } from 'react';
import { saveVersion } from '@/app/console/_actions/agents';
import { AGENT_LANGS, DISCLOSURE_RE, QUESTION_TYPES, type QuestionT } from '@/lib/console/agent-constants';
import { getLanguage } from '@/lib/voice/languages';
import { Notice, Submit } from '../forms';
import { Field } from '../ui';

type Base = {
  opening: string; disclosure: string; goal: string; persona: string;
  questions: QuestionT[]; languages: string[]; voice: string; rate: '-8%' | '+0%' | '+8%';
};

const TEMPLATE: Base = {
  opening: 'Namaste {name} ji, main Glowleaf se Asha bol rahi hoon. Aapke recent order ke baare mein do minute baat kar sakte hain?',
  disclosure: 'Bata doon, yeh ek AI assistant ki call hai aur quality ke liye record ho rahi hai.',
  goal: 'Find out whether the order arrived on time, how the customer rates the product, and one thing to improve.',
  persona: 'Warm, quick and respectful. Sounds like a young professional from Pune. Never pushes a sale.',
  questions: [
    { key: 'delivery_on_time', type: 'yes_no', prompt: 'Kya aapka order time pe pahuncha tha?', required: true },
    { key: 'product_rating', type: 'rating', prompt: 'Product ko 1 se 5 mein kitna denge?', required: true },
    { key: 'improve', type: 'text', prompt: 'Ek cheez jo hum better kar sakte hain?', required: false },
  ],
  languages: ['hinglish', 'hi-IN', 'en-IN'],
  voice: 'hi-IN-SwaraNeural',
  rate: '+0%',
};

const slugKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'q_$1').slice(0, 40) || 'question';

export function AgentEditor({ agentId, base, baseVersion }: { agentId: string; base: Base | null; baseVersion: number | null }) {
  const [d, setD] = useState<Base>(base ?? TEMPLATE);
  const [state, run] = useActionState(saveVersion, null);
  const set = <K extends keyof Base>(k: K, v: Base[K]) => setD((x) => ({ ...x, [k]: v }));
  const setQ = (i: number, patch: Partial<QuestionT>) => set('questions', d.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));
  const move = (i: number, by: number) => {
    const qs = [...d.questions];
    const [q] = qs.splice(i, 1);
    qs.splice(i + by, 0, q);
    set('questions', qs);
  };
  // The voice must belong to the opening language; pick that language's first voice when it changes.
  const setLanguages = (langs: string[]) => setD((x) => {
    const vs = getLanguage(langs[0] ?? 'hinglish').voices;
    return { ...x, languages: langs, voice: vs.some((v) => v.id === x.voice) ? x.voice : vs[0]?.id ?? x.voice };
  });
  const disclosureOk = DISCLOSURE_RE.test(d.disclosure);
  const voices = useMemo(() => getLanguage(d.languages[0] ?? 'hinglish').voices, [d.languages]);
  const dirty = JSON.stringify(d) !== JSON.stringify(base ?? null);
  const payload = JSON.stringify({ agent: agentId, ...d });

  return (
    <form action={run} className="space-y-8">
      <input type="hidden" name="payload" value={payload} />
      <p className="text-sm text-ink-3">
        {baseVersion ? <>Editing from v{baseVersion}. Saving creates v{baseVersion + 1}; v{baseVersion} stays as it is.</> : 'This will be v1.'}
      </p>

      <fieldset className="surface space-y-5 p-6">
        <legend className="sr-only">The first ten seconds</legend>
        <h2 className="font-display text-xl">The first ten seconds</h2>
        <Field label="Opening line" htmlFor="opening" hint="Use {name} for the contact’s name. Ask for permission to continue.">
          <textarea id="opening" className="field indic min-h-20" value={d.opening} onChange={(e) => set('opening', e.target.value)} maxLength={400} />
        </Field>
        <Field label="AI disclosure" htmlFor="disclosure"
          error={d.disclosure && !disclosureOk ? 'Say plainly that this is an AI or automated call. Launch is blocked without it.' : undefined}
          hint={disclosureOk ? 'Spoken right after the opening, on every call. Required by law in India, the US and Canada.' : undefined}>
          <textarea id="disclosure" className="field indic min-h-16" value={d.disclosure} onChange={(e) => set('disclosure', e.target.value)} maxLength={200} aria-invalid={!disclosureOk} />
        </Field>
      </fieldset>

      <fieldset className="surface space-y-5 p-6">
        <legend className="sr-only">Goal and manner</legend>
        <h2 className="font-display text-xl">Goal and manner</h2>
        <Field label="What a successful call finds out" htmlFor="goal">
          <textarea id="goal" className="field min-h-20" value={d.goal} onChange={(e) => set('goal', e.target.value)} maxLength={1000} />
        </Field>
        <Field label="How the agent should sound" htmlFor="persona" hint="Tone, pace, what it must never do.">
          <textarea id="persona" className="field min-h-20" value={d.persona} onChange={(e) => set('persona', e.target.value)} maxLength={2000} />
        </Field>
      </fieldset>

      <fieldset className="surface p-6">
        <legend className="sr-only">Questions</legend>
        <div className="flex items-baseline justify-between gap-4">
          <h2 className="font-display text-xl">Questions</h2>
          <span className="tnum text-sm text-ink-3">{d.questions.length} of 25</span>
        </div>
        <p className="mt-1 text-sm text-ink-2">Each answer is saved with the second of audio it came from. The key becomes the column name in exports and webhooks.</p>
        <ol className="mt-5 space-y-3">
          {d.questions.map((q, i) => (
            <li key={i} className="rounded-xl border border-line bg-ground/40 p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tnum grid h-7 w-7 place-items-center rounded-full border border-line-2 text-sm text-ink-3" aria-hidden>{i + 1}</span>
                <label className="sr-only" htmlFor={`qtype-${i}`}>Answer type</label>
                <select id={`qtype-${i}`} className="field w-auto py-1.5 text-sm" value={q.type} onChange={(e) => setQ(i, { type: e.target.value as QuestionT['type'] })}>
                  {QUESTION_TYPES.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
                <label className="ml-1 flex items-center gap-1.5 text-sm text-ink-2">
                  <input type="checkbox" className="accent-[var(--color-lamp)]" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} /> Must ask
                </label>
                <span className="ml-auto flex gap-1">
                  <button type="button" className="btn btn-sm text-ink-3 hover:text-ink" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move question ${i + 1} up`}>↑</button>
                  <button type="button" className="btn btn-sm text-ink-3 hover:text-ink" disabled={i === d.questions.length - 1} onClick={() => move(i, 1)} aria-label={`Move question ${i + 1} down`}>↓</button>
                  <button type="button" className="btn btn-sm text-ink-3 hover:text-fail" disabled={d.questions.length === 1} onClick={() => set('questions', d.questions.filter((_, j) => j !== i))} aria-label={`Remove question ${i + 1}`}>Remove</button>
                </span>
              </div>
              <label className="sr-only" htmlFor={`qprompt-${i}`}>What the agent asks</label>
              <input id={`qprompt-${i}`} className="field indic mt-3" value={q.prompt} maxLength={300} placeholder="What the agent asks"
                onChange={(e) => setQ(i, { prompt: e.target.value })} />
              <div className="mt-2 grid gap-2 sm:grid-cols-[200px_minmax(0,1fr)]">
                <div>
                  <label className="text-xs text-ink-3" htmlFor={`qkey-${i}`}>Key</label>
                  <input id={`qkey-${i}`} className="field mt-1 py-1.5 font-mono text-sm" value={q.key} maxLength={40}
                    onChange={(e) => setQ(i, { key: slugKey(e.target.value) })} />
                </div>
                {q.type === 'choice' ? (
                  <div>
                    <label className="text-xs text-ink-3" htmlFor={`qopts-${i}`}>Options, comma separated</label>
                    <input id={`qopts-${i}`} className="field mt-1 py-1.5 text-sm" value={(q.options ?? []).join(', ')}
                      onChange={(e) => setQ(i, { options: e.target.value.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 12) })} />
                  </div>
                ) : null}
              </div>
            </li>
          ))}
        </ol>
        <button type="button" className="btn btn-quiet btn-sm mt-4" disabled={d.questions.length >= 25}
          onClick={() => set('questions', [...d.questions, { key: `question_${d.questions.length + 1}`, type: 'text', prompt: '', required: true }])}>
          Add a question
        </button>
      </fieldset>

      <fieldset className="surface space-y-5 p-6">
        <legend className="sr-only">Languages and voice</legend>
        <h2 className="font-display text-xl">Languages and voice</h2>
        <div>
          <p className="mb-2 text-sm font-medium text-ink-2">Languages the agent may switch to, first one opens the call</p>
          <div className="flex flex-wrap gap-2">
            {AGENT_LANGS.map((l) => {
              const on = d.languages.includes(l.id);
              const first = d.languages[0] === l.id;
              return (
                <button key={l.id} type="button" aria-pressed={on}
                  onClick={() => setLanguages(on ? d.languages.filter((x) => x !== l.id) : [...d.languages, l.id])}
                  className={`rounded-full border px-3 py-1.5 text-sm ${on ? 'border-lamp bg-lamp/10' : 'border-line-2 text-ink-2 hover:text-ink'}`}>
                  {l.label}{first ? <span className="ml-1.5 text-xs text-lamp">opens</span> : null}
                </button>
              );
            })}
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Voice" htmlFor="voice" hint="Voices for the opening language.">
            <select id="voice" className="field" value={d.voice} onChange={(e) => set('voice', e.target.value)}>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.label}, {v.group.toLowerCase()}, {v.tone}</option>)}
            </select>
          </Field>
          <Field label="Pace" htmlFor="rate">
            <select id="rate" className="field" value={d.rate} onChange={(e) => set('rate', e.target.value as Base['rate'])}>
              <option value="-8%">Slower</option><option value="+0%">Natural</option><option value="+8%">Brisk</option>
            </select>
          </Field>
        </div>
      </fieldset>

      <div className="sticky bottom-4 z-10 flex flex-wrap items-center gap-4 rounded-2xl border border-line-2 bg-panel/95 px-5 py-3 backdrop-blur">
        <Submit pending="Saving" disabled={!dirty && baseVersion !== null}>Save as new version</Submit>
        <span className="text-sm text-ink-3">{dirty || baseVersion === null ? 'Unsaved changes' : 'No changes since this version'}</span>
        <span className="ml-auto"><Notice state={state} /></span>
      </div>
    </form>
  );
}
