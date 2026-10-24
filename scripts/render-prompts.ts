// Renders docs/prompts/universal-sales-agent.md from lib/prompts/universal-agent.ts.
// Run: node --experimental-strip-types scripts/render-prompts.ts
import { writeFileSync } from 'node:fs';
import { BRIEF_BUILDER_PROMPT, buildAgentPrompt } from '../lib/prompts/universal-agent.ts';

const call = buildAgentPrompt({
  name: '{{agent_name}}',
  brief: '{{brief}}',
  contact: 'You are speaking with {{customer_name}}. Known details: {{customer_details}}.',
  languageRules: 'Speak ONLY {{language}}. Every reply must be in {{language}}, even though these instructions are in English. If the person speaks a full sentence in another language, or asks to switch, switch from this reply on.',
  reminder: 'Remember: reply in {{language}}, and match your length to the question.',
});

const md = `# Universal AI sales call agent

Two prompts. Use them together.

1. **Brief builder** runs once, when someone saves an agent. It turns their rough description, written in any order, into a fixed-shape brief. Send it as the system prompt, with the user message: \`Agent name: …\\nOwner's description: """…"""\`.
2. **Call prompt** runs on every turn of every call. Put the brief from step 1 where it says \`{{brief}}\`. If you have no brief yet, the raw description works there too.

Placeholders are \`{{like_this}}\`. Leave out the "Known details" line if you have none.

Model settings that matter as much as the words:
- Allow enough output for 10 spoken sentences: about 700 tokens, or about 1,400 for reasoning models such as gpt-oss (with reasoning effort low).
- Speak the reply sentence by sentence, starting text-to-speech on the first sentence while the rest are generated, so long answers start as fast as short ones.
- Stop speaking the moment the caller talks, and send the cut-off line back marked "(cut off)".
- Keep the \`# How you work\` part first and identical for every call. Providers cache a repeated prompt start: on Groq, cached tokens cost half. Groq says they don't count towards rate limits, but in our tests a long prompt still hit the free tier's 8,000-tokens-a-minute limit within one fast call, so use a paid tier for real campaigns.
- Back the length rule with a hard cap in code (VaniDial uses \`capReply\`: at most 10 sentences and about 170 words, keeping the closing question). Models overshoot sometimes, especially in Hindi.
- Prompts alone don't stop a model's habits. In our tests gpt-oss kept opening with "Sure thing" and "Great" despite the ban, so back it up in code: strip stock openers from the start of each reply (VaniDial: \`humanizeReply\`), and add a one-line nudge to every caller turn: "(React to exactly what they just said, in their mood, with no stock opener, then answer.)". The model weighs the latest message most.

---

## 1. Brief builder (system prompt)

\`\`\`text
${BRIEF_BUILDER_PROMPT}
\`\`\`

---

## 2. Call prompt (system prompt, every turn)

\`\`\`text
${call}
\`\`\`
`;
writeFileSync(new URL('../docs/prompts/universal-sales-agent.md', import.meta.url), md);
console.log('written', md.length, 'chars,', call.split(/\s+/).length, 'words in the call prompt');
