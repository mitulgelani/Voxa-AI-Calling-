import { orgContext } from '@/lib/console/context';
import { campaignOptions } from '@/lib/console/campaign-options';
import { PageHeader } from '@/components/console/ui';
import { CampaignForm } from '@/components/console/campaigns/CampaignForm';

export const metadata = { title: 'New campaign' };

export default async function NewCampaign() {
  const { db, org } = await orgContext('operator');
  const options = await campaignOptions(db, org.id);
  return (
    <>
      <PageHeader title="New campaign" back={{ href: '/console/campaigns', label: 'Campaigns' }}
        lede="A campaign is a draft until all six launch checks pass. Saving never calls anyone." />
      <CampaignForm options={options} currency={org.country === 'IN' ? 'INR' : 'USD'} country={org.country}
        draft={{ name: '', purpose: 'service', agent_version_id: '', phone_number_id: '', list_id: '', window_start: org.country === 'IN' ? '10:00' : '09:00', window_end: '19:00',
          days: [1, 2, 3, 4, 5, 6], max_concurrent: 10, dials_per_minute: 20, max_attempts: 3, retry_after_minutes: 120, budget: org.country === 'IN' ? 5000 : 100 }} />
    </>
  );
}
