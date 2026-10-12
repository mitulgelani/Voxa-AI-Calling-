'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import {
  AudioWaveform, Bot, ChevronDown, ChevronRight, ClipboardPaste, Copy, Download, History, Pause, Phone, Play,
  Plus, Trash2, Upload, Users, X,
} from 'lucide-react';
import CallStudio from './CallStudio';
import type { Agent, CallRecord, Contact } from '@/lib/types';
import { MODELS, RATES, VOICES } from '@/lib/types';
import { LANGUAGES, getLanguage } from '@/lib/languages';
import { PRESET_AGENTS, blankAgent } from '@/lib/presets';
import { newId, useStored } from '@/lib/store';
import { downloadText, parseContacts, toCsv } from '@/lib/contacts';

type Tab = 'playground' | 'agents' | 'contacts' | 'history';

const TABS: { id: Tab; label: string; icon: typeof Phone }[] = [
  { id: 'playground', label: 'Playground', icon: Phone },
  { id: 'agents', label: 'Agents', icon: Bot },
  { id: 'contacts', label: 'Contacts', icon: Users },
  { id: 'history', label: 'Calls', icon: History },
];

export default function Workspace() {
  const [tab, setTab] = useState<Tab>('playground');
  const [agents, setAgents, agentsReady] = useStored<Agent[]>('voxa.agents.v1', PRESET_AGENTS);
  const [contacts, setContacts] = useStored<Contact[]>('voxa.contacts.v1', []);
  const [calls, setCalls] = useStored<CallRecord[]>('voxa.calls.v1', []);
  const [agentId, setAgentId] = useStored<string>('voxa.agentId', PRESET_AGENTS[0].id);
  const [contactId, setContactId] = useState<string>('');

  const agent = agents.find((a) => a.id === agentId) || agents[0];
  const contact = contacts.find((c) => c.id === contactId) || null;

  useEffect(() => {
    if (agentsReady && !agents.length) setAgents(PRESET_AGENTS);
  }, [agentsReady, agents.length, setAgents]);

  const callContact = (c: Contact) => {
    setContactId(c.id);
    setTab('playground');
  };

  const onCallEnd = (record: CallRecord) => {
    setCalls((prev) => [record, ...prev].slice(0, 300));
    if (record.contactId) {
      setContacts((prev) =>
        prev.map((c) =>
          c.id === record.contactId ? { ...c, status: c.status === 'new' ? 'called' : c.status, lastCallAt: record.endedAt } : c,
        ),
      );
    }
  };

  return (
    <div className="shell">
      <aside className="sidebar">
        <Link href="/" className="brand">
          <span className="brand-mark"><AudioWaveform size={18} /></span> Voxa
        </Link>
        <nav>
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
              <t.icon size={18} />
              <span>{t.label}</span>
              {t.id === 'contacts' && contacts.length > 0 && <em>{contacts.length}</em>}
              {t.id === 'history' && calls.length > 0 && <em>{calls.length}</em>}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot muted tiny">Free speech · Edge voices · Whisper</div>
      </aside>

      <main className="main">
        {tab === 'playground' && agent && (
          <div className="page">
            <header className="page-head">
              <div>
                <h1>Playground</h1>
                <p className="muted">Pick an agent and talk to it like a real call. Pause to let it answer, talk over it to interrupt.</p>
              </div>
            </header>
            <div className="pickers">
              <label>
                <span>Agent</span>
                <select value={agent.id} onChange={(e) => setAgentId(e.target.value)}>
                  {agents.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
              <label>
                <span>Calling as</span>
                <select value={contactId} onChange={(e) => setContactId(e.target.value)}>
                  <option value="">Yourself (no contact)</option>
                  {contacts.map((c) => (
                    <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>
                  ))}
                </select>
              </label>
              <button className="ghost-btn" onClick={() => setTab('agents')}>Edit agent</button>
            </div>
            <CallStudio key={`${agent.id}:${contactId}:${agent.updatedAt}`} agent={agent} contact={contact} onCallEnd={onCallEnd} />
          </div>
        )}

        {tab === 'agents' && (
          <AgentsPage
            agents={agents}
            setAgents={setAgents}
            selectedId={agent?.id}
            onSelect={setAgentId}
            onTest={(id) => {
              setAgentId(id);
              setTab('playground');
            }}
            contacts={contacts}
          />
        )}

        {tab === 'contacts' && <ContactsPage contacts={contacts} setContacts={setContacts} onCall={callContact} />}

        {tab === 'history' && <HistoryPage calls={calls} setCalls={setCalls} />}
      </main>

      <nav className="bottom-tabs">
        {TABS.map((t) => (
          <button key={t.id} className={tab === t.id ? 'active' : ''} onClick={() => setTab(t.id)}>
            <t.icon size={20} />
            <span>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

// =====================================================================================
// Agents
// =====================================================================================
function AgentsPage(props: {
  agents: Agent[];
  setAgents: (fn: (prev: Agent[]) => Agent[]) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
  onTest: (id: string) => void;
  contacts: Contact[];
}) {
  const { agents, setAgents, onTest } = props;
  const [editingId, setEditingId] = useState<string>(props.selectedId || agents[0]?.id || '');
  const editing = agents.find((a) => a.id === editingId) || agents[0];

  const update = (patch: Partial<Agent>) => {
    if (!editing) return;
    setAgents((prev) => prev.map((a) => (a.id === editing.id ? { ...a, ...patch, updatedAt: Date.now() } : a)));
  };

  const create = () => {
    const a = blankAgent(newId('a'));
    setAgents((prev) => [...prev, a]);
    setEditingId(a.id);
  };
  const duplicate = () => {
    if (!editing) return;
    const copy: Agent = { ...editing, id: newId('a'), name: `${editing.name} copy`, createdAt: Date.now(), updatedAt: Date.now() };
    setAgents((prev) => [...prev, copy]);
    setEditingId(copy.id);
  };
  const remove = () => {
    if (!editing || agents.length <= 1) return;
    if (!window.confirm(`Delete ${editing.name}?`)) return;
    const rest = agents.filter((a) => a.id !== editing.id);
    setAgents(() => rest);
    setEditingId(rest[0].id);
  };

  const columns = useMemo(() => {
    const set = new Set<string>(['name', 'first_name', 'phone']);
    props.contacts.forEach((c) => Object.keys(c.fields).forEach((k) => set.add(k)));
    return Array.from(set).slice(0, 14);
  }, [props.contacts]);

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Agents</h1>
          <p className="muted">Give each agent a personality, a goal and a voice. It will think, talk and behave like that on the call.</p>
        </div>
        <button className="primary-btn" onClick={create}><Plus size={18} /> New agent</button>
      </header>

      <div className="agents-layout">
        <div className="agent-list">
          {agents.map((a) => (
            <button key={a.id} className={`agent-item ${a.id === editing?.id ? 'active' : ''}`} onClick={() => setEditingId(a.id)}>
              <span className="avatar">{a.name.slice(0, 1).toUpperCase()}</span>
              <span className="agent-meta">
                <b>{a.name}</b>
                <small className="muted">{getLanguage(a.language).label} · {VOICES.find((v) => v.id === a.voice)?.label || 'Voice'}</small>
              </span>
            </button>
          ))}
        </div>

        {editing && (
          <div className="card editor">
            <div className="editor-head">
              <input className="title-input" value={editing.name} onChange={(e) => update({ name: e.target.value })} aria-label="Agent name" />
              <div className="row gap">
                <button className="ghost-btn" onClick={duplicate}><Copy size={16} /> Duplicate</button>
                <button className="ghost-btn danger" onClick={remove} disabled={agents.length <= 1}><Trash2 size={16} /></button>
                <button className="primary-btn" onClick={() => onTest(editing.id)}><Phone size={16} /> Test call</button>
              </div>
            </div>

            <Field label="Personality" hint="Who they are, how they talk, what they know, what they care about. Written in the second person works best.">
              <textarea rows={6} value={editing.persona} onChange={(e) => update({ persona: e.target.value })} />
            </Field>
            <Field label="Goal of the call" hint="What the agent steers the conversation toward.">
              <textarea rows={3} value={editing.goal} onChange={(e) => update({ goal: e.target.value })} />
            </Field>
            <Field label="Opening line" hint="Spoken the instant the call connects, no model wait.">
              <textarea rows={2} value={editing.greeting} onChange={(e) => update({ greeting: e.target.value })} />
            </Field>
            <div className="chips">
              <span className="muted tiny">Variables from your contact sheet:</span>
              {columns.map((c) => (
                <code key={c} className="chip">{`{{${c}}}`}</code>
              ))}
            </div>

            <Field label="Language" hint="The agent speaks, listens and thinks in this language. Write the opening line in it too.">
              <select
                value={getLanguage(editing.language).id}
                onChange={(e) => {
                  const lang = getLanguage(e.target.value);
                  const keepVoice = lang.voices.some((v) => v.id === editing.voice);
                  update({ language: lang.id, voice: keepVoice ? editing.voice : lang.voices[0].id });
                }}
              >
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>{l.label}{l.native !== l.label && l.native !== 'English' ? ` · ${l.native}` : ''}</option>
                ))}
              </select>
            </Field>

            <Field label="Voice">
              <VoicePicker value={editing.voice} rate={editing.rate} language={getLanguage(editing.language).id} onChange={(voice) => update({ voice })} />
            </Field>

            <div className="grid-3">
              <Field label="Speaking pace">
                <select value={editing.rate} onChange={(e) => update({ rate: e.target.value })}>
                  {RATES.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                </select>
              </Field>
              <Field label="Reply length">
                <select value={editing.brevity} onChange={(e) => update({ brevity: e.target.value as Agent['brevity'] })}>
                  <option value="short">Short, one sentence</option>
                  <option value="natural">Natural, up to two</option>
                </select>
              </Field>
              <Field label="Brain">
                <select value={editing.model} onChange={(e) => update({ model: e.target.value })}>
                  {MODELS.map((m) => <option key={m.id} value={m.id}>{m.label} ({m.provider}, {m.note})</option>)}
                </select>
              </Field>
            </div>

            <label className="toggle">
              <input type="checkbox" checked={editing.discloseAI} onChange={(e) => update({ discloseAI: e.target.checked })} />
              <span>Introduces itself as an AI assistant</span>
            </label>
            {editing.discloseAI && !/\bAI\b/.test(editing.greeting) && (
              <div className="notice warn small">Your opening line does not mention it is an AI yet.</div>
            )}
            <p className="muted tiny">Whatever the persona, the agent always answers honestly if someone asks whether it is an AI, and never asks for card numbers, passwords or one-time codes.</p>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="field">
      <span className="field-label">{label}</span>
      {children}
      {hint && <span className="muted tiny">{hint}</span>}
    </label>
  );
}

function VoicePicker({ value, rate, language, onChange }: { value: string; rate: string; language: string; onChange: (v: string) => void }) {
  const lang = getLanguage(language);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);

  const preview = async (id: string, label: string) => {
    if (playing === id) {
      audio.current?.pause();
      setPlaying(null);
      return;
    }
    setPlaying(id);
    try {
      const res = await fetch('/api/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice: id, rate, text: lang.sample.replace('{name}', label) }),
      });
      if (!res.ok) throw new Error();
      const url = URL.createObjectURL(await res.blob());
      if (!audio.current) audio.current = new Audio();
      audio.current.src = url;
      audio.current.onended = () => setPlaying(null);
      await audio.current.play();
    } catch {
      setPlaying(null);
    }
  };

  return (
    <div className="voices">
      {(['Female', 'Male'] as const).filter((g) => lang.voices.some((v) => v.group === g)).map((group) => (
        <div key={group} className="voice-group">
          <div className="muted tiny">{group}</div>
          <div className="voice-row">
            {lang.voices.filter((v) => v.group === group).map((v) => (
              <div key={v.id} className={`voice ${value === v.id ? 'active' : ''}`}>
                <button className="voice-pick" onClick={(e) => { e.preventDefault(); onChange(v.id); }}>
                  <b>{v.label}</b>
                  <small>{v.tone}</small>
                </button>
                <button className="voice-play" aria-label={`Preview ${v.label}`} onClick={(e) => { e.preventDefault(); void preview(v.id, v.label); }}>
                  {playing === v.id ? <Pause size={14} /> : <Play size={14} />}
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// =====================================================================================
// Contacts
// =====================================================================================
function ContactsPage(props: { contacts: Contact[]; setContacts: (fn: (prev: Contact[]) => Contact[]) => void; onCall: (c: Contact) => void }) {
  const { contacts, setContacts, onCall } = props;
  const [paste, setPaste] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const fileRef = useRef<HTMLInputElement | null>(null);

  const importText = (text: string) => {
    const r = parseContacts(text, contacts);
    if (!r.contacts.length) {
      setResult(`No phone numbers found.${r.skipped ? ` ${r.skipped} rows had no usable number.` : ''}`);
      return;
    }
    setContacts((prev) => [...prev, ...r.contacts]);
    setPaste('');
    setResult(
      `Imported ${r.contacts.length} contact${r.contacts.length === 1 ? '' : 's'}` +
        (r.duplicates ? `, ${r.duplicates} duplicate${r.duplicates === 1 ? '' : 's'} skipped` : '') +
        (r.skipped ? `, ${r.skipped} row${r.skipped === 1 ? '' : 's'} without a number` : '') +
        '.',
    );
  };

  const onFile = async (file: File) => {
    if (/\.xlsx?$/i.test(file.name)) {
      setResult('For .xlsx files, select the cells in Excel, copy, and paste them in the box. CSV files can be uploaded directly.');
      return;
    }
    importText(await file.text());
  };

  const columns = useMemo(() => {
    const set = new Set<string>();
    contacts.forEach((c) => Object.keys(c.fields).forEach((k) => set.add(k)));
    return Array.from(set).slice(0, 4);
  }, [contacts]);

  const shown = contacts.filter((c) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return c.name.toLowerCase().includes(q) || c.phone.includes(q) || Object.values(c.fields).some((v) => v.toLowerCase().includes(q));
  });

  const exportCsv = () => {
    const keys = Array.from(new Set(contacts.flatMap((c) => Object.keys(c.fields))));
    const rows = [['name', 'phone', 'status', 'last call', ...keys]];
    contacts.forEach((c) =>
      rows.push([c.name, c.phone, c.status, c.lastCallAt ? new Date(c.lastCallAt).toLocaleString() : '', ...keys.map((k) => c.fields[k] || '')]),
    );
    downloadText('voxa-contacts.csv', toCsv(rows));
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Contacts</h1>
          <p className="muted">Copy rows from Excel or Google Sheets and paste them here. Headers are detected; every column becomes a variable the agent can use.</p>
        </div>
      </header>

      <div className="card import">
        <textarea
          rows={6}
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          placeholder={'Name\tPhone\tCity\tNotes\nPriya Shah\t+91 98765 43210\tSurat\tAsked about pricing\nJohn Lee\t+1 415 555 0134\tSan Francisco\tTrial user'}
        />
        <div className="row gap wrap">
          <button className="primary-btn" onClick={() => importText(paste)} disabled={!paste.trim()}>
            <ClipboardPaste size={16} /> Import pasted rows
          </button>
          <button className="ghost-btn" onClick={() => fileRef.current?.click()}><Upload size={16} /> Upload CSV</button>
          <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,.xlsx,.xls" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
          {result && <span className="muted small">{result}</span>}
        </div>
      </div>

      {contacts.length > 0 && (
        <div className="card">
          <div className="card-head">
            <input className="search" placeholder="Search name, number or any field" value={query} onChange={(e) => setQuery(e.target.value)} />
            <div className="row gap">
              <button className="ghost-btn" onClick={exportCsv}><Download size={16} /> Export</button>
              <button
                className="ghost-btn danger"
                onClick={() => window.confirm('Remove all contacts?') && setContacts(() => [])}
              >
                <Trash2 size={16} /> Clear
              </button>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Phone</th>
                  {columns.map((c) => <th key={c}>{c}</th>)}
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b></td>
                    <td className="mono">{c.phone}</td>
                    {columns.map((k) => <td key={k}>{c.fields[k] || ''}</td>)}
                    <td>
                      <select
                        className={`status ${c.status}`}
                        value={c.status}
                        onChange={(e) => setContacts((prev) => prev.map((x) => (x.id === c.id ? { ...x, status: e.target.value as Contact['status'] } : x)))}
                      >
                        <option value="new">New</option>
                        <option value="called">Called</option>
                        <option value="follow-up">Follow-up</option>
                        <option value="done">Done</option>
                      </select>
                    </td>
                    <td className="row gap end">
                      <button className="icon-btn call" onClick={() => onCall(c)} aria-label={`Test call as ${c.name}`}><Phone size={16} /></button>
                      <button className="icon-btn" onClick={() => setContacts((prev) => prev.filter((x) => x.id !== c.id))} aria-label="Remove"><X size={16} /></button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="muted tiny pad">
            The phone button opens a playground call where the agent treats you as that contact, with all their details. Dialling real phone numbers needs a telephony provider and is the next step after the voice feels right.
          </p>
        </div>
      )}
    </div>
  );
}

// =====================================================================================
// Call history
// =====================================================================================
function HistoryPage({ calls, setCalls }: { calls: CallRecord[]; setCalls: (fn: (prev: CallRecord[]) => CallRecord[]) => void }) {
  const [open, setOpen] = useState<string | null>(calls[0]?.id || null);

  const exportCsv = () => {
    const rows: (string | number)[][] = [['call id', 'agent', 'contact', 'started', 'seconds', 'ended by', 'speaker', 'text', 'cut off']];
    calls.forEach((c) =>
      c.turns.forEach((t) =>
        rows.push([
          c.id, c.agentName, c.contactName || '', new Date(c.startedAt).toISOString(), Math.round((c.endedAt - c.startedAt) / 1000),
          c.endedBy, t.role, t.text, t.interrupted ? 'yes' : '',
        ]),
      ),
    );
    downloadText('voxa-calls.csv', toCsv(rows));
  };

  return (
    <div className="page">
      <header className="page-head">
        <div>
          <h1>Calls</h1>
          <p className="muted">Every playground call with its full transcript. Interruptions are marked where the agent was cut off.</p>
        </div>
        {calls.length > 0 && <button className="ghost-btn" onClick={exportCsv}><Download size={16} /> Export CSV</button>}
      </header>
      {!calls.length && <div className="card empty">No calls yet. Start one in the Playground.</div>}
      <div className="call-list">
        {calls.map((c) => {
          const seconds = Math.round((c.endedAt - c.startedAt) / 1000);
          const isOpen = open === c.id;
          return (
            <div key={c.id} className="card call-item">
              <button className="call-summary" onClick={() => setOpen(isOpen ? null : c.id)}>
                {isOpen ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <b>{c.agentName}</b>
                <span className="muted">→ {c.contactName || 'You'}</span>
                <span className="muted small push">{new Date(c.startedAt).toLocaleString()} · {Math.floor(seconds / 60)}m {seconds % 60}s · {c.turns.length} lines</span>
              </button>
              {isOpen && (
                <div className="lines compact">
                  {c.turns.map((t, i) => (
                    <div key={i} className={`line ${t.role}`}>
                      <div className="who">{t.role === 'agent' ? c.agentName : c.contactName || 'You'}</div>
                      <div className="bubble">{t.text}{t.interrupted && <span className="cut"> — cut off</span>}</div>
                    </div>
                  ))}
                  <div className="row end">
                    <button className="ghost-btn danger" onClick={() => setCalls((prev) => prev.filter((x) => x.id !== c.id))}>
                      <Trash2 size={16} /> Delete
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
