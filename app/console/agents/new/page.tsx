import { orgContext } from '@/lib/console/context';
import { PageHeader } from '@/components/console/ui';
import { NewAgentForm } from '@/components/console/agents/NewAgentForm';

export const metadata = { title: 'New agent' };

export default async function NewAgent() {
  await orgContext('operator');
  return (
    <div className="max-w-xl">
      <PageHeader title="New agent" back={{ href: '/console/agents', label: 'Agents' }} lede="Name it after the job it does. You will write the script on the next screen." />
      <div className="surface p-6"><NewAgentForm /></div>
    </div>
  );
}
