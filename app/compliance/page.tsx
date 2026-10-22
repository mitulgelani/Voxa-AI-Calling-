import type { Metadata } from 'next';
import Link from 'next/link';
import { ReadingPage, Block } from '@/components/site/Page';

export const metadata: Metadata = { title: 'Compliance', description: 'TRAI, TCPA and CRTC rules VaniDial enforces on every call.' };

const toc = [
  { id: 'gate', label: 'The launch gate' }, { id: 'india', label: 'India (TRAI)' }, { id: 'na', label: 'US and Canada' },
  { id: 'calls', label: 'On every call' }, { id: 'data', label: 'Data and deletion' }, { id: 'yours', label: 'What stays your job' },
];

export default function CompliancePage() {
  return (
    <ReadingPage title="Compliance" toc={toc} lede="Automated calls are regulated in every market we serve. VaniDial turns the rules into checks the software enforces, so a hurried launch cannot skip them. This is a description of the product, not legal advice.">
      <Block id="gate" title="The launch gate">
        <p>A campaign stays a draft until six checks pass, and the database runs them again at the moment of launch:</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li><strong>Purpose</strong>: service or promotional, chosen up front.</li>
          <li><strong>Caller ID</strong>: verified with the carrier, registered for that purpose, with a DLT header in India.</li>
          <li><strong>Consent</strong>: contacts without a recorded source and date are never dialled.</li>
          <li><strong>DND scrub</strong>: in India, a scrub less than 24 hours old.</li>
          <li><strong>Script</strong>: an admin-approved version that includes the AI disclosure.</li>
          <li><strong>Hours</strong>: inside the legal window for the country.</li>
        </ol>
        <p>After launch the configuration is frozen, so every call traces back to exactly what was approved.</p>
      </Block>
      <Block id="india" title="India (TRAI)">
        <p>Calls go out through your own Plivo account from numbers registered on your DLT portal, with headers matched to the purpose of the call. Lists must be scrubbed against the NCPR registry before launch, and calls are placed only between 09:00 and 21:00 in the contact’s timezone.</p>
      </Block>
      <Block id="na" title="United States and Canada">
        <p>Calls go out through your Telnyx account. Contacts need prior express consent on record, calls run between 08:00 and 21:00 local time, and the agent identifies itself as automated at the start of every call.</p>
      </Block>
      <Block id="calls" title="On every call">
        <p>The agent says it is an AI in the first ten seconds and answers honestly if asked. When a person says they do not want calls, in Hindi, Gujarati, English or a mix, the agent apologises, confirms, ends the call, and the number joins the do-not-call list before the line drops. A number that answered in the past seven days is not called again by any campaign. The agent never asks for card numbers, one-time codes or ID documents.</p>
      </Block>
      <Block id="data" title="Data and deletion">
        <p>Recordings are deleted automatically when your retention period ends. Transcripts and answers stay for your records. To delete an organisation or a person’s data on request, write to <a className="text-lamp hover:underline" href="mailto:privacy@vanidial.com">privacy@vanidial.com</a>; opt-outs themselves are kept so that the person is never called again.</p>
      </Block>
      <Block id="yours" title="What stays your job">
        <p>VaniDial checks what software can check. Collecting real consent, registering your DLT entities and templates, and deciding whether a campaign is service or promotional remain your responsibility. Every decision your team makes is written to an append-only audit log you can show a regulator. <Link className="text-lamp hover:underline" href="/security">Read how the data is protected</Link>.</p>
      </Block>
    </ReadingPage>
  );
}
