import type { Metadata } from 'next';
import { ReadingPage, Block } from '@/components/site/Page';

export const metadata: Metadata = { title: 'Security', description: 'How VaniDial protects call recordings, phone numbers and your account.' };

const toc = [
  { id: 'isolation', label: 'Tenant isolation' }, { id: 'secrets', label: 'Keys and secrets' }, { id: 'recordings', label: 'Recordings' },
  { id: 'web', label: 'Web hardening' }, { id: 'playground', label: 'Playground abuse' }, { id: 'report', label: 'Report a problem' },
];

export default function Security() {
  return (
    <ReadingPage title="Security" toc={toc} lede="You hand us your customers’ phone numbers and voices. This page explains, without marketing, how that data is kept apart, who can touch it, and what happens when something goes wrong.">
      <Block id="isolation" title="Tenant isolation in the database">
        <p>Every table that holds customer data has Postgres row-level security switched on. A request from the console runs as the signed-in person, and each row is visible only if that person is a member of the row’s organisation with a high enough role. The check lives in the database, so a bug in the web app cannot read another company’s calls.</p>
        <p>Roles go from viewer to owner. Viewers see partly hidden phone numbers. Only admins approve scripts, launch campaigns, manage caller IDs, API keys and webhooks.</p>
        <p>The rules that protect people on the phone are enforced by the database, not the interface: a campaign cannot start until its six checks pass, its configuration freezes at launch, numbers on the do-not-call list cannot be inserted into the calls table, approved scripts cannot be edited, and the audit log rejects every update and delete.</p>
      </Block>
      <Block id="secrets" title="Keys and secrets">
        <p>The website holds no database master key. The powerful service key exists only on the voice gateway, a separate server that places calls.</p>
        <p>API keys and invite links are shown once and stored as SHA-256 hashes. Webhook signing secrets are encrypted with AES-256-GCM, and every webhook carries an HMAC-SHA256 signature with a timestamp so receivers can reject forgeries and replays.</p>
        <p>Carrier callbacks and media streams are authorised with short-lived, per-call signed tokens; Telnyx events are also checked against Telnyx’s Ed25519 signature.</p>
      </Block>
      <Block id="recordings" title="Recordings">
        <p>Recordings live in a private storage bucket, in a folder per organisation. The console plays them through signed links that expire after 30 minutes. Each organisation sets how long audio is kept, from 7 days to 10 years; after that the audio is deleted automatically while transcripts and answers remain.</p>
      </Block>
      <Block id="web" title="Web hardening">
        <p>Every page is served with a per-request Content-Security-Policy nonce, HSTS with preload, frame blocking, a strict referrer policy and a permissions policy that only allows the microphone on our own pages. Sessions use HttpOnly, Secure cookies. Server actions validate every input on the server, and spreadsheet exports neutralise formulas.</p>
      </Block>
      <Block id="playground" title="Playground abuse controls">
        <p>The public playground has no phone numbers. Calls run only in the browser, last at most five minutes, and are limited per link, per network and globally each day. Visitor IP addresses are never stored, only a keyed hash. Every model, speech and voice request is checked against a live session in the database.</p>
      </Block>
      <Block id="report" title="Report a problem">
        <p>Write to <a className="text-lamp hover:underline" href="mailto:security@vanidial.com">security@vanidial.com</a>. We reply within two working days and do not take action against good-faith research that avoids real customer data.</p>
      </Block>
    </ReadingPage>
  );
}
