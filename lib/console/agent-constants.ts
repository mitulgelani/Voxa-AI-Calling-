/** Client-safe constants for the agent editor (no validation library). */

export const AGENT_LANGS = [
  { id: 'hinglish', label: 'Hinglish' },
  { id: 'hi-IN', label: 'Hindi' },
  { id: 'gu-IN', label: 'Gujarati' },
  { id: 'en-IN', label: 'English (India)' },
  { id: 'en-US', label: 'English (US)' },
] as const;

export const QUESTION_TYPES = [
  { id: 'rating', label: 'Rating 1–5' },
  { id: 'yes_no', label: 'Yes / no' },
  { id: 'choice', label: 'One of a list' },
  { id: 'text', label: 'Open answer' },
  { id: 'number', label: 'Number' },
  { id: 'date', label: 'Date' },
] as const;

/** The disclosure must say the caller is automated, in a language the customer reads. */
export const DISCLOSURE_RE = /(AI|automated|स्वचालित|एआई|ઓટોમેટેડ|એઆઈ)/i;

export type QuestionT = {
  key: string;
  type: 'rating' | 'yes_no' | 'choice' | 'text' | 'number' | 'date';
  prompt: string;
  required: boolean;
  options?: string[];
};
