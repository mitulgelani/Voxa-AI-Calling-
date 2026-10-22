import { z } from 'zod';

import { DISCLOSURE_RE } from './agent-constants';
export { AGENT_LANGS, QUESTION_TYPES, DISCLOSURE_RE, type QuestionT } from './agent-constants';

export const Question = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]{1,39}$/, 'Question keys use lowercase letters, digits and underscores.'),
  type: z.enum(['rating', 'yes_no', 'choice', 'text', 'number', 'date']),
  prompt: z.string().trim().min(3, 'Every question needs the words the agent will say.').max(300),
  required: z.boolean().default(true),
  options: z.array(z.string().trim().min(1).max(60)).max(12).optional(),
});

export const AgentVersion = z.object({
  agent: z.string().uuid(),
  opening: z.string().trim().min(10, 'The opening line needs at least 10 characters.').max(400),
  disclosure: z.string().trim().min(10).max(200).refine((s) => DISCLOSURE_RE.test(s), 'The disclosure must say this is an AI or automated call.'),
  goal: z.string().trim().min(5, 'Say what the call is for.').max(1000),
  persona: z.string().trim().max(2000).default(''),
  questions: z.array(Question).min(1, 'Add at least one question.').max(25)
    .refine((qs) => new Set(qs.map((q) => q.key)).size === qs.length, 'Two questions share the same key.')
    .refine((qs) => qs.every((q) => q.type !== 'choice' || (q.options?.length ?? 0) >= 2), 'Choice questions need at least two options.'),
  languages: z.array(z.enum(['hinglish', 'hi-IN', 'gu-IN', 'en-IN', 'en-US'])).min(1, 'Pick at least one language.').max(5),
  voice: z.string().min(3).max(60),
  rate: z.enum(['-8%', '+0%', '+8%']).default('+0%'),
});
export type AgentVersionT = z.infer<typeof AgentVersion>;
