'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Pause, Play, Trash2, PencilLine, Phone, Copy, Check } from 'lucide-react';
import { CORE_LANGUAGES, MORE_LANGUAGES, getLanguage } from '@/lib/voice/languages';

interface Draft {
  slug?: string;
  name: string;
  tagline: string;
  description: string;
  greeting: string;
  language: string;
  voice: string;
  rate: '-8%' | '+0%' | '+8%';
  visibility: 'unlisted' | 'private';
}

interface Mine extends Draft {
  share_slug: string;
  call_count: number;
}

const TEMPLATES: { label: string; draft: Omit<Draft, 'voice'> }[] = [
  {
    label: 'Feedback caller',
    draft: {
      name: 'Priya', tagline: 'Checks how your last order went', language: 'hinglish', rate: '+0%', visibility: 'unlisted', greeting: '',
      description:
        'You are Priya, calling for a fictional online store to ask a recent customer about their order. You are warm and quick, like a friendly young professional from Pune. Ask how delivery went, how the product feels, a rating from 1 to 5, and one thing to improve. Thank them and wrap up within three minutes.',
    },
  },
  {
    label: 'Appointment confirmer',
    draft: {
      name: 'Arjun', tagline: 'Confirms tomorrow’s appointment', language: 'hi-IN', rate: '-8%', visibility: 'unlisted', greeting: '',
      description:
        'You are Arjun, a calm assistant for a fictional dental clinic, confirming an appointment for tomorrow at 11 am. Speak slowly and politely, repeat the date and time back, and offer two other slots if they cannot come. Never give medical advice.',
    },
  },
  {
    label: 'Film critic',
    draft: {
      name: 'Zoya', tagline: 'Strong opinions about every Bollywood film', language: 'hinglish', rate: '+8%', visibility: 'unlisted', greeting: '',
      description:
        'You are Zoya, a witty Bollywood film critic from Mumbai with strong but good-natured opinions. You love 90s classics, quote dialogues, and gently tease people about their favourite films. Ask the caller what they watched last and argue about it playfully.',
    },
  },
  {
    label: 'Patient tutor',
    draft: {
      name: 'Dev', tagline: 'Explains maths like a favourite teacher', language: 'en-IN', rate: '+0%', visibility: 'unlisted', greeting: '',
      description:
        'You are Dev, a patient maths tutor for school students. You explain one idea at a time with everyday Indian examples (cricket scores, auto fares, cooking), check understanding with a quick question, and never make the student feel slow.',
    },
  },
];

const EMPTY: Draft = { name: '', tagline: '', description: '', greeting: '', language: 'hinglish', voice: 'hi-IN-SwaraNeural', rate: '+0%', visibility: 'unlisted' };

export function PersonaBuilder() {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [mine, setMine] = useState<Mine[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement | null>(null);
  const lang = getLanguage(draft.language);

  useEffect(() => {
    fetch('/api/play/personas', { cache: 'no-store' })
      .then((r) => r.json())
      .then((d) => setMine(Array.isArray(d.personas) ? d.personas : []))
      .catch(() => setMine([]));
  }, []);

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setDraft((d) => ({ ...d, [k]: v }));

  const setLanguage = (id: string) => {
    const next = getLanguage(id);
    setDraft((d) => {
      const keep = next.voices.find((v) => v.id === d.voice);
      const gender = lang.voices.find((v) => v.id === d.voice)?.group;
      const voice = keep || next.voices.find((v) => v.group === gender) || next.voices[0];
      return { ...d, language: next.id, voice: voice.id };
    });
  };

  const applyTemplate = (t: (typeof TEMPLATES)[number]) => {
    const l = getLanguage(t.draft.language);
    setDraft({ ...t.draft, voice: l.voices[0].id });
    setError(null);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/play/personas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not save.');
      router.push(`/p/${data.slug}`);
    } catch (err) {
      setError((err as Error).message);
      setSaving(false);
    }
  };

  const remove = async (slug: string) => {
    await fetch(`/api/play/personas?slug=${slug}`, { method: 'DELETE' });
    setMine((m) => (m || []).filter((p) => p.share_slug !== slug));
  };

  const ready = draft.name.trim().length > 0 && draft.description.trim().length >= 20;

  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,0.7fr)]">
      <form ref={formRef} onSubmit={save} className="surface scroll-mt-24 p-6 sm:p-8" aria-label="Build a persona">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-3">Start from</span>
          {TEMPLATES.map((t) => (
            <button key={t.label} type="button" onClick={() => applyTemplate(t)} className="rounded-full border border-line px-3 py-1.5 text-sm text-ink-2 hover:border-line-2 hover:text-ink">
              {t.label}
            </button>
          ))}
        </div>

        <ol className="mt-8 space-y-9">
          <Step n={1} title="Who is it?">
            <div className="grid gap-4 sm:grid-cols-[minmax(0,0.6fr)_minmax(0,1fr)]">
              <label className="block">
                <span className="mb-1.5 block text-sm text-ink-2">Name</span>
                <input id="pb-name" className="field" maxLength={40} value={draft.name} onChange={(e) => set('name', e.target.value)} placeholder="Priya" required />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm text-ink-2">One-line description <span className="text-ink-3">(shown on the share page)</span></span>
                <input id="pb-tagline" className="field" maxLength={120} value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder="Checks how your last order went" />
              </label>
            </div>
            <label className="mt-4 block">
              <span className="mb-1.5 block text-sm text-ink-2">Personality</span>
              <textarea
                id="pb-description"
                className="field min-h-[160px] leading-relaxed"
                maxLength={2000}
                value={draft.description}
                onChange={(e) => set('description', e.target.value)}
                placeholder="Who they are, how they talk, what they know, and what the call is for. Write it as “You are …”."
                required
              />
              <span className="mt-1 block text-right text-xs text-ink-3 tnum">{draft.description.length} / 2000</span>
            </label>
          </Step>

          <Step n={2} title="How do they sound?">
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1.5 block text-sm text-ink-2">Language</span>
                <select id="pb-language" className="field" value={draft.language} onChange={(e) => setLanguage(e.target.value)}>
                  <optgroup label="Production languages">
                    {CORE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}{l.native !== 'English' && l.native !== l.label ? ` (${l.native})` : ''}</option>)}
                  </optgroup>
                  <optgroup label="More languages (playground)">
                    {MORE_LANGUAGES.map((l) => <option key={l.id} value={l.id}>{l.label}</option>)}
                  </optgroup>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-sm text-ink-2">Pace</span>
                <select id="pb-rate" className="field" value={draft.rate} onChange={(e) => set('rate', e.target.value as Draft['rate'])}>
                  <option value="-8%">Relaxed</option>
                  <option value="+0%">Natural</option>
                  <option value="+8%">Brisk</option>
                </select>
              </label>
            </div>
            <fieldset className="mt-4">
              <legend className="mb-2 text-sm text-ink-2">Voice <span className="text-ink-3">({lang.voices.length} native voices for {lang.label})</span></legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {lang.voices.map((v) => (
                  <VoiceChip key={v.id} id={v.id} label={v.label} tone={v.tone} group={v.group} lang={lang.id} selected={draft.voice === v.id} onSelect={() => set('voice', v.id)} />
                ))}
              </div>
            </fieldset>
          </Step>

          <Step n={3} title="How do they open the call?">
            <label className="block">
              <span className="mb-1.5 block text-sm text-ink-2">Opening line <span className="text-ink-3">(optional; leave empty and {draft.name || 'the persona'} opens naturally in {lang.label})</span></span>
              <input id="pb-greeting" className="field indic" maxLength={300} value={draft.greeting} onChange={(e) => set('greeting', e.target.value)} placeholder={lang.sample.replace('{name}', draft.name || 'Priya')} />
            </label>
            <label className="mt-4 flex items-center gap-3 text-sm text-ink-2">
              <input type="checkbox" className="h-4 w-4 accent-[var(--color-lamp)]" checked={draft.visibility === 'private'} onChange={(e) => set('visibility', e.target.checked ? 'private' : 'unlisted')} />
              Keep private (only this browser can call it). Otherwise anyone with the link can.
            </label>
          </Step>
        </ol>

        {error ? <p role="alert" className="mt-6 rounded-xl border border-fail/40 bg-fail/10 px-4 py-3 text-sm text-ink">{error}</p> : null}

        <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-line pt-6">
          <button type="submit" className="btn btn-lamp min-h-[52px] px-6" disabled={!ready || saving}>
            <Phone size={18} aria-hidden /> {saving ? 'Saving' : draft.slug ? 'Save and call' : 'Create and call'}
          </button>
          <p className="text-sm text-ink-3">You get a link you can share. Anyone with it can talk to {draft.name || 'your persona'} for up to five minutes a call.</p>
        </div>
      </form>

      <aside className="space-y-6">
        <div className="surface p-5">
          <h2 className="font-display text-xl">Your personas</h2>
          {mine === null ? <p className="mt-3 text-sm text-ink-3">Loading</p> : null}
          {mine && mine.length === 0 ? <p className="mt-3 text-sm text-ink-3">None yet. The ones you create in this browser show up here.</p> : null}
          <ul className="mt-3 divide-y divide-line">
            {(mine || []).map((p) => (
              <MineRow key={p.share_slug} p={p} onEdit={() => { setDraft({ ...p, slug: p.share_slug }); formRef.current?.scrollIntoView({ behavior: 'smooth' }); }} onDelete={() => void remove(p.share_slug)} />
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <li className="grid grid-cols-[2rem_minmax(0,1fr)] gap-x-4">
      <span className="tnum grid h-8 w-8 place-items-center rounded-full border border-line-2 text-sm text-ink-2" aria-hidden>{n}</span>
      <div>
        <h3 className="font-display pt-0.5 text-xl">{title}</h3>
        <div className="mt-4">{children}</div>
      </div>
    </li>
  );
}

function VoiceChip({ id, label, tone, group, lang, selected, onSelect }: { id: string; label: string; tone: string; group: string; lang: string; selected: boolean; onSelect: () => void }) {
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle');
  const audio = useRef<HTMLAudioElement | null>(null);
  useEffect(() => () => audio.current?.pause(), []);
  const preview = async () => {
    if (state === 'playing') {
      audio.current?.pause();
      setState('idle');
      return;
    }
    setState('loading');
    try {
      if (!audio.current) audio.current = new Audio();
      audio.current.src = `/api/voice-sample?voice=${encodeURIComponent(id)}&lang=${encodeURIComponent(lang)}&name=${encodeURIComponent(label)}`;
      audio.current.onended = () => setState('idle');
      await audio.current.play();
      setState('playing');
    } catch {
      setState('idle');
    }
  };
  return (
    <div className={`flex items-stretch overflow-hidden rounded-xl border transition-colors ${selected ? 'border-lamp bg-lamp/10' : 'border-line bg-panel-2 hover:border-line-2'}`}>
      <button type="button" onClick={onSelect} aria-pressed={selected} className="flex flex-1 flex-col items-start px-3.5 py-2.5 text-left">
        <span className="font-medium">{label}</span>
        <span className="text-xs text-ink-3">{group}, {tone}</span>
      </button>
      <button type="button" onClick={preview} aria-label={`Hear ${label}`} className="grid w-11 place-items-center border-l border-line text-ink-2 hover:text-lamp" disabled={state === 'loading'}>
        {state === 'playing' ? <Pause size={15} aria-hidden /> : <Play size={15} aria-hidden />}
      </button>
    </div>
  );
}

function MineRow({ p, onEdit, onDelete }: { p: Mine; onEdit: () => void; onDelete: () => void }) {
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const url = useMemo(() => (typeof window !== 'undefined' ? `${window.location.origin}/p/${p.share_slug}` : `/p/${p.share_slug}`), [p.share_slug]);
  return (
    <li className="py-3">
      <div className="flex items-baseline justify-between gap-3">
        <Link href={`/p/${p.share_slug}`} className="font-medium hover:text-lamp">{p.name}</Link>
        <span className="tnum text-xs text-ink-3">{p.call_count} calls</span>
      </div>
      <p className="text-sm text-ink-3">{getLanguage(p.language).label}{p.visibility === 'private' ? ', private' : ''}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <button type="button" className="btn btn-quiet btn-sm !min-h-8 !px-2.5" onClick={async () => { try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* ignore */ } }}>
          {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />} {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className="btn btn-quiet btn-sm !min-h-8 !px-2.5" onClick={onEdit}><PencilLine size={14} aria-hidden /> Edit</button>
        {confirm ? (
          <button type="button" className="btn btn-sm !min-h-8 !px-2.5 bg-fail/20 text-fail" onClick={onDelete}>Delete {p.name}</button>
        ) : (
          <button type="button" className="btn btn-quiet btn-sm !min-h-8 !px-2.5" onClick={() => setConfirm(true)} aria-label={`Delete ${p.name}`}><Trash2 size={14} aria-hidden /></button>
        )}
      </div>
    </li>
  );
}
