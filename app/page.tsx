import Link from 'next/link';
import { Nav } from '@/components/site/Nav';
import { Footer } from '@/components/site/Footer';
import { EvidenceCard } from '@/components/landing/EvidenceCard';
import { VoiceSample } from '@/components/landing/VoiceSample';
import { Showcase } from '@/components/play/Showcase';
import { GateFigure } from '@/components/figures/gate/GateFigure';
import { SwitchboardFigure } from '@/components/figures/switchboard/SwitchboardFigure';
import { getShowcase } from '@/lib/server/personas';

export const revalidate = 300;

const STEPS = [
  { title: 'Write the call', body: 'The opening line, the goal and the questions to ask. Pick the languages. The line that says the call is automated is locked in and cannot be removed.' },
  { title: 'Upload your customers', body: 'CSV, API or your CRM. Duplicates are removed, invalid numbers are rejected, and anyone without consent on record is flagged before anything is saved.' },
  { title: 'Pass the gate', body: 'Six checks must pass before a campaign can start: purpose, caller ID, consent, a DND scrub less than a day old, an approved script, and legal calling hours.' },
  { title: 'Read the answers', body: 'Each answer arrives as a typed field with a confidence score and a link to the second it was said. Unsure answers go to a reviewer first.' },
];

const LANGS = [
  { name: 'Hinglish', script: 'Order time पे आया था? Packaging कैसी लगी?', voice: 'hi-IN-SwaraNeural', lang: 'hinglish', speaker: 'Swara', note: 'Its own language profile, not a mistake to correct.' },
  { name: 'हिन्दी', script: 'नमस्ते, क्या आपके पास दो मिनट हैं?', voice: 'hi-IN-MadhurNeural', lang: 'hi-IN', speaker: 'Madhur', note: 'Everyday spoken Hindi, not textbook Hindi.' },
  { name: 'ગુજરાતી', script: 'નમસ્તે, તમારો અનુભવ કેવો રહ્યો?', voice: 'gu-IN-DhwaniNeural', lang: 'gu-IN', speaker: 'Dhwani', note: 'Gujarati callers answered in Gujarati.' },
  { name: 'English', script: 'Hi, is this a good time for a two-minute call?', voice: 'en-IN-NeerjaNeural', lang: 'en-IN', speaker: 'Neerja', note: 'Indian English, and US English for US numbers.' },
];

const MOMENTS = [
  { caller: 'Wait, am I talking to a robot?', agent: 'Yes, I’m an automated assistant from Glowleaf. Happy to keep it short.' },
  { caller: 'Abhi busy hoon, shaam ko call karo.', agent: 'Bilkul. Main aapko aaj shaam 6 baje call karti hoon, theek hai?' },
  { caller: 'Can I talk to a real person?', agent: 'Of course. I’ll connect you to the team now.' },
  { caller: 'Mujhe dobara call mat karna.', agent: 'Samajh gayi. Aapka number hata diya hai, ab call nahi aayega.' },
];

export default async function Home() {
  const showcase = await getShowcase(4);
  return (
    <>
      <Nav />
      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-7xl items-center gap-12 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] lg:pt-24">
          <div>
            <h1 className="font-display text-display font-semibold">
              Customer feedback, called in their language.
            </h1>
            <p className="mt-6 max-w-xl text-lg leading-relaxed text-ink-2">
              VaniDial phones your customers in Hindi, Gujarati, Hinglish or English, holds a natural conversation, and hands you every answer with the second of audio that proves it.
            </p>
            <div className="mt-9 flex flex-wrap gap-3">
              <Link href="/playground" className="btn btn-lamp min-h-[52px] px-6">Hear a live call</Link>
              <Link href="/login" className="btn btn-quiet min-h-[52px] px-6">Start a pilot</Link>
            </div>
            <p className="mt-6 text-sm text-ink-3">Every call opens by saying it is automated. Nobody without consent is ever dialled.</p>
          </div>
          <EvidenceCard />
        </section>

        {/* How it works: a real sequence */}
        <section id="how" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <h2 className="max-w-2xl font-display text-h2">From a contact list to answers you can check.</h2>
            <ol className="mt-12 grid gap-x-8 gap-y-10 md:grid-cols-2 lg:grid-cols-4">
              {STEPS.map((s, i) => (
                <li key={s.title} className="border-t border-line-2 pt-5">
                  <span className="tnum text-sm text-lamp">Step {i + 1}</span>
                  <h3 className="mt-2 font-display text-xl">{s.title}</h3>
                  <p className="mt-2 text-ink-2">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Compliance gate figure */}
        <section id="compliance" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <h2 className="font-display text-h2">The Launch button does not exist until the campaign is legal.</h2>
              <p className="mt-5 text-ink-2">
                Compliance is enforced by the product, not left to a checklist. The database itself refuses to start a campaign that fails any check, and refuses to dial a number on your do-not-call list, whatever the app asks for.
              </p>
              <ul className="mt-6 space-y-2 text-ink-2">
                <li>India: DLT header, 1600 series for service calls, DND scrub within 24 hours, 09:00 to 21:00 in the customer’s time.</li>
                <li>US and Canada: a separate number pool and their own calling rules.</li>
                <li>Opt-outs land on the do-not-call list during the call and can never be dialled again.</li>
              </ul>
            </div>
            <GateFigure />
          </div>
        </section>

        {/* Evidence */}
        <section id="evidence" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <div className="grid gap-10 lg:grid-cols-2">
              <h2 className="font-display text-h2">An answer without its audio is just a guess.</h2>
              <div className="space-y-5 text-ink-2">
                <p>
                  Each answer is saved as a typed field, such as a rating, yes or no, a choice or a comment, with a confidence score and the start and end of the audio it came from.
                </p>
                <p>
                  Anything the AI is unsure about goes to a review queue built for speed: the reviewer hears only the few seconds that matter and confirms or corrects with the keyboard. The transcript keeps speech exactly as spoken, Hinglish included.
                </p>
                <p>Card numbers and ID numbers are redacted from transcripts as they are spoken.</p>
              </div>
            </div>
          </div>
        </section>

        {/* Languages + switchboard */}
        <section id="languages" className="scroll-mt-20 border-t border-line">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <div className="grid items-center gap-12 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
              <SwitchboardFigure />
              <div>
                <h2 className="font-display text-h2">It speaks the way your customers do, and switches when they do.</h2>
                <p className="mt-5 text-ink-2">
                  If a customer answers a Hindi call in English, the next sentence is in English, in a voice that matches. Each language has its own voice, prompts and quality bar, and goes live only after native speakers have scored more than a hundred real calls.
                </p>
              </div>
            </div>
            <ul className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {LANGS.map((l) => (
                <li key={l.name} className="flex flex-col rounded-[var(--radius-card)] border border-line bg-panel p-5">
                  <span className="indic font-display text-2xl">{l.name}</span>
                  <p className="indic mt-3 flex-1 text-ink">“{l.script}”</p>
                  <p className="mt-3 text-sm text-ink-3">{l.note}</p>
                  <div className="mt-4"><VoiceSample voice={l.voice} lang={l.lang} name={l.speaker} /></div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Conversation */}
        <section className="border-t border-line">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 py-20 sm:px-6 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
            <div>
              <h2 className="font-display text-h2">Built for the moments that break scripts.</h2>
              <p className="mt-5 text-ink-2">
                Customers interrupt, go quiet, get suspicious, ask for a person or say no. The agent stops talking the moment the customer does, replies in under a second, and treats every one of these as part of the conversation.
              </p>
            </div>
            <ul className="divide-y divide-line border-y border-line">
              {MOMENTS.map((m) => (
                <li key={m.caller} className="grid gap-2 py-5 sm:grid-cols-2 sm:gap-6">
                  <p className="text-ink-2"><span className="block text-xs text-ink-3">Customer</span>{m.caller}</p>
                  <p className="text-ink"><span className="block text-xs text-lamp">VaniDial</span>{m.agent}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* Playground */}
        <section className="border-t border-line">
          <div className="mx-auto max-w-7xl px-4 py-20 sm:px-6">
            <div className="flex flex-wrap items-end justify-between gap-6">
              <div className="max-w-2xl">
                <h2 className="font-display text-h2">Talk to one now. It takes ten seconds.</h2>
                <p className="mt-4 text-ink-2">Pick a caller, press Start call and answer the way a customer would. Or write your own personality and share the link with your team.</p>
              </div>
              <Link href="/playground" className="btn btn-quiet">Open the playground</Link>
            </div>
            {showcase.length ? <div className="mt-10"><Showcase personas={showcase} /></div> : null}
          </div>
        </section>

        {/* Pricing teaser */}
        <section className="border-t border-line">
          <div className="mx-auto grid max-w-7xl gap-10 px-4 py-20 sm:px-6 lg:grid-cols-2">
            <div>
              <h2 className="font-display text-h2">Pay for answers, not for dialling.</h2>
              <p className="mt-5 text-ink-2">
                The dashboard shows what matters to a CX team: the cost of each completed, trustworthy feedback record, including failed attempts, retries and human review. Set a budget cap and new dials stop the moment it is reached.
              </p>
              <Link href="/pricing" className="btn btn-quiet mt-8">See pricing</Link>
            </div>
            <dl className="grid content-start gap-px overflow-hidden rounded-[var(--radius-card)] border border-line bg-line sm:grid-cols-2">
              {[
                ['Reply time', 'Under 800 ms from the end of the customer’s sentence'],
                ['Field accuracy', '95% target on required answers, 99% after read-back'],
                ['Early hang-ups', 'Under 20% in the first 15 seconds'],
                ['Human review', 'Under 10% of calls'],
              ].map(([k, v]) => (
                <div key={k} className="bg-panel p-5">
                  <dt className="text-sm text-ink-3">{k}</dt>
                  <dd className="mt-1 text-ink">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
