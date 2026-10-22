'use client';

import { createAgent } from '@/app/console/_actions/agents';
import { ActionForm, Submit } from '../forms';
import { Field } from '../ui';

export function NewAgentForm() {
  return (
    <ActionForm action={createAgent} className="space-y-5">
      <Field label="Name" htmlFor="agent-name" hint="Customers do not hear this name unless the script uses it.">
        <input id="agent-name" name="name" className="field" required maxLength={60} placeholder="Post-delivery feedback" />
      </Field>
      <Field label="What it is for" htmlFor="agent-desc" hint="Optional. Helps teammates pick the right agent.">
        <textarea id="agent-desc" name="description" className="field min-h-24" maxLength={500} placeholder="Calls customers two days after delivery to ask about the order." />
      </Field>
      <Submit pending="Creating">Create and write the script</Submit>
    </ActionForm>
  );
}
