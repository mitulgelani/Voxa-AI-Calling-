import type { Metadata } from 'next';
import { ReadingPage, Block } from '@/components/site/Page';

export const metadata: Metadata = { title: 'API docs', description: 'Read calls and answers, add contacts, and receive signed webhooks.' };

const toc = [
  { id: 'auth', label: 'Authentication' }, { id: 'calls', label: 'Calls' }, { id: 'campaigns', label: 'Campaigns' },
  { id: 'contacts', label: 'Adding contacts' }, { id: 'webhooks', label: 'Webhooks' }, { id: 'errors', label: 'Errors and limits' },
];

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-xl border border-line bg-panel p-4 font-mono text-[0.82rem] leading-relaxed text-ink"><code>{children}</code></pre>;
}

export default function Docs() {
  return (
    <ReadingPage title="API" toc={toc} lede="Pull every answer with its evidence timestamp into your CRM, push contacts from your store, and get told the moment a call finishes. JSON over HTTPS, one key per integration.">
      <Block id="auth" title="Authentication">
        <p>Create a key in Settings → API keys and choose its permissions: <code>calls:read</code>, <code>campaigns:read</code>, <code>contacts:write</code>. Send it as a bearer token. Keys are shown once; revoke one and it stops working immediately.</p>
        <Code>{`curl https://vanidial.vercel.app/api/v1/calls \\
  -H "Authorization: Bearer vd_live_…"`}</Code>
      </Block>
      <Block id="calls" title="Calls">
        <p><strong>GET /api/v1/calls</strong> lists calls, newest first. Query: <code>campaign_id</code>, <code>limit</code> (1–200), <code>before</code> (use <code>next_before</code> from the previous page).</p>
        <Code>{`{
  "data": [{
    "id": "8f1c…", "campaign_id": "2b9e…", "phone": "+919876543210",
    "status": "completed", "outcome": "completed", "language": "hinglish",
    "duration_ms": 161000, "needs_review": false,
    "answers": {
      "product_rating": { "value": 4, "confidence": 0.94, "evidence_ms": 62000, "review_state": "auto" }
    }
  }],
  "next_before": "2026-10-23T08:14:02Z"
}`}</Code>
        <p><strong>GET /api/v1/calls/:id</strong> returns one call with answers, evidence spans and the full timecoded transcript.</p>
      </Block>
      <Block id="campaigns" title="Campaigns">
        <p><strong>GET /api/v1/campaigns</strong> lists campaigns with status, spend and budget cap (in paise or cents).</p>
      </Block>
      <Block id="contacts" title="Adding contacts">
        <p><strong>POST /api/v1/contact-lists/:id/contacts</strong> adds up to 1,000 contacts. Phone numbers must be in international format. Contacts without <code>consent_source</code> and <code>consent_at</code> are stored but never called. Numbers already in the list are skipped.</p>
        <Code>{`{
  "contacts": [{
    "phone": "+919876543210", "name": "Ritika Sharma", "language": "hinglish",
    "consent_source": "Checkout opt-in on glowleaf.in", "consent_at": "2026-10-01T10:00:00+05:30",
    "attributes": { "order_id": "GL-20931" }
  }]
}`}</Code>
        <p>The response says how many were received and inserted, and lists the indexes of invalid numbers.</p>
      </Block>
      <Block id="webhooks" title="Webhooks">
        <p>Add an endpoint in Settings → Webhooks. Events: <code>call.completed</code>, <code>answer.reviewed</code>, <code>contact.opted_out</code>, <code>campaign.finished</code>. Failed deliveries retry with exponential backoff for about a day.</p>
        <p>Every request carries <code>VaniDial-Signature: t=&lt;unix seconds&gt;,v1=&lt;hex&gt;</code>, an HMAC-SHA256 of <code>t + "." + raw body</code> using your endpoint secret. Reject anything older than five minutes.</p>
        <Code>{`import crypto from 'node:crypto';

function verify(rawBody, header, secret) {
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  if (Math.abs(Date.now() / 1000 - Number(t)) > 300) return false;
  const want = crypto.createHmac('sha256', secret).update(\`\${t}.\${rawBody}\`).digest('hex');
  return crypto.timingSafeEqual(Buffer.from(want), Buffer.from(v1));
}`}</Code>
      </Block>
      <Block id="errors" title="Errors and limits">
        <p>Errors look like <code>{`{"error":{"code":"invalid_key","message":"…"}}`}</code> with status 400, 401, 403, 404, 429 or 500. Each key may make 600 requests a minute.</p>
      </Block>
    </ReadingPage>
  );
}
