import { orgContext } from '@/lib/console/context';
import { PageHeader } from '@/components/console/ui';
import { ImportWizard } from '@/components/console/contacts/ImportWizard';

export const metadata = { title: 'Import contacts' };

export default async function ImportPage() {
  const { org } = await orgContext('operator');
  return (
    <>
      <PageHeader title="Import contacts" back={{ href: '/console/contacts', label: 'Contacts' }}
        lede="The file is read in your browser. Nothing is uploaded until you review the result and confirm." />
      <ImportWizard country={org.country} />
    </>
  );
}
