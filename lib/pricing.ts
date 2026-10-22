/**
 * Public price list. Early-access numbers: change them here and every page follows.
 * Carrier minutes are billed by Plivo or Telnyx directly to the customer's own account.
 */
export const PLANS = [
  {
    name: 'Playground', price: 'Free', unit: '', for: 'Trying voices and personalities in your browser',
    includes: ['Unlimited personas with share links', '5 minutes a day per visitor', 'Hindi, Gujarati, English and Hinglish', 'No phone numbers, no account'],
    cta: { href: '/playground', label: 'Open the playground' },
  },
  {
    name: 'Pay as you go', price: '₹3', unit: 'per connected minute', for: 'Teams running their first feedback campaigns',
    includes: ['Every compliance check and the audit log', 'Recordings, transcripts and evidence links', 'Review queue for unsure answers', 'API and signed webhooks', 'Budget caps per campaign'],
    cta: { href: '/login', label: 'Start a workspace' },
  },
  {
    name: 'Scale', price: 'Custom', unit: '', for: 'More than 50,000 minutes a month, or your own models',
    includes: ['Volume pricing', 'Dedicated voice gateway in your region', 'Custom retention and data residency', 'Named support and onboarding'],
    cta: { href: 'mailto:hello@vanidial.com', label: 'Talk to us' },
  },
] as const;
