// Shared types and catalogues used by both the browser and the API routes.

export type Brevity = 'short' | 'natural';

export interface Agent {
  id: string;
  name: string;
  /** Who the agent is, how it thinks, what it knows. Free text. */
  persona: string;
  /** What the call is for; the agent steers toward it. */
  goal: string;
  /** First thing the agent says when the call connects. Supports {{variables}}. */
  greeting: string;
  voice: string;
  /** Edge prosody rate, e.g. "+0%". */
  rate: string;
  model: string;
  brevity: Brevity;
  /** Whether the opening line states it is an AI. Honest answers when asked are always on. */
  discloseAI: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Contact {
  id: string;
  name: string;
  phone: string;
  /** Every other column from the pasted sheet, keyed by header. */
  fields: Record<string, string>;
  status: 'new' | 'called' | 'follow-up' | 'done';
  lastCallAt?: number;
}

export interface Turn {
  role: 'agent' | 'caller';
  text: string;
  at: number;
  /** The agent was cut off part-way through this line. */
  interrupted?: boolean;
}

export interface CallRecord {
  id: string;
  agentId: string;
  agentName: string;
  contactId?: string;
  contactName?: string;
  startedAt: number;
  endedAt: number;
  turns: Turn[];
  endedBy: 'agent' | 'caller' | 'error';
}

export const VOICES = [
  { id: 'en-US-AvaNeural', label: 'Ava', group: 'Female', tone: 'warm' },
  { id: 'en-US-EmmaNeural', label: 'Emma', group: 'Female', tone: 'cheerful' },
  { id: 'en-US-JennyNeural', label: 'Jenny', group: 'Female', tone: 'friendly' },
  { id: 'en-US-AndrewNeural', label: 'Andrew', group: 'Male', tone: 'confident' },
  { id: 'en-US-BrianNeural', label: 'Brian', group: 'Male', tone: 'casual' },
  { id: 'en-US-GuyNeural', label: 'Guy', group: 'Male', tone: 'lively' },
] as const;

export const VOICE_IDS: string[] = VOICES.map((v) => v.id);
export const DEFAULT_VOICE = 'en-US-AvaNeural';

export const MODELS = [
  { id: 'or:google/gemini-2.5-flash', label: 'Gemini 2.5 Flash', note: 'fastest, ~0.7s', provider: 'OpenRouter' },
  { id: 'or:openai/gpt-4o-mini', label: 'GPT-4o mini', note: 'fast', provider: 'OpenRouter' },
  { id: 'or:meta-llama/llama-3.3-70b-instruct', label: 'Llama 3.3 70B', note: 'fast', provider: 'OpenRouter' },
  { id: 'or:deepseek/deepseek-chat', label: 'DeepSeek Chat', note: 'medium', provider: 'OpenRouter' },
  { id: 'kie:deepseek-v4-1-flash', label: 'DeepSeek v4.1 Flash', note: 'slow start, 4-6s', provider: 'KIE' },
  { id: 'kie:gpt-5-5', label: 'GPT-5.5', note: 'slow start', provider: 'KIE' },
  { id: 'kie:gpt-6-luna', label: 'GPT-6 Luna', note: 'slow start', provider: 'KIE' },
] as const;

export const DEFAULT_MODEL = 'or:google/gemini-2.5-flash';

export const RATES = [
  { id: '-8%', label: 'Relaxed' },
  { id: '+0%', label: 'Normal' },
  { id: '+8%', label: 'Brisk' },
];

/** Replace {{column}} placeholders with contact values. Unknown keys become empty. */
export function fillTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_, key: string) => {
    const k = key.trim().toLowerCase();
    for (const name of Object.keys(vars)) {
      if (name.toLowerCase() === k) return vars[name];
    }
    return '';
  });
}

export function contactVars(contact?: Contact | null): Record<string, string> {
  if (!contact) return {};
  return { ...contact.fields, name: contact.name, phone: contact.phone, first_name: contact.name.split(/\s+/)[0] || '' };
}
