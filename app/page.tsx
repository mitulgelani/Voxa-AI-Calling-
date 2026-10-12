import Link from 'next/link';
import {
  ArrowRight, AudioWaveform, Bot, Ear, Hand, Mic, PhoneCall, Repeat, ShieldCheck, Sparkles, Timer, Users, Volume2,
} from 'lucide-react';

const HUMAN = [
  { icon: Timer, title: 'Answers when you pause', text: 'Turn-taking tuned to a 650ms pause, and it waits longer when you trail off mid-thought.' },
  { icon: Hand, title: 'Stops when you cut in', text: 'Talk over it and it pauses instantly, then decides: a real interruption, or just you saying "mm-hmm".' },
  { icon: Ear, title: 'Never hears itself', text: 'Echo gating by loudness, timing and words, so speakerphone calls do not loop.' },
  { icon: Repeat, title: 'No dead air', text: 'Short bridges like "Right." cover a slow reply, and it checks in if the line goes quiet.' },
  { icon: Sparkles, title: 'Remembers being cut off', text: 'It only keeps what it actually said, so it responds to you instead of finishing its old sentence.' },
  { icon: PhoneCall, title: 'Ends like a person', text: 'Says goodbye and hangs up on its own when the conversation is done.' },
];

const STEPS = [
  { icon: Bot, title: 'Shape a personality', text: 'Write who the agent is, how it talks and what it is trying to achieve. Pick one of six natural voices.' },
  { icon: Users, title: 'Paste your list', text: 'Copy rows from Excel or Google Sheets. Every column becomes something the agent knows about the person.' },
  { icon: Mic, title: 'Talk to it', text: 'Press one button and hold a real conversation. No push-to-talk, no buttons between turns.' },
];

export default function Landing() {
  return (
    <div className="landing">
      <header className="land-nav">
        <Link href="/" className="brand">
          <span className="brand-mark"><AudioWaveform size={18} /></span> Voxa
        </Link>
        <Link href="/app" className="primary-btn">Open playground <ArrowRight size={16} /></Link>
      </header>

      <section className="hero">
        <div className="pill"><Volume2 size={14} /> Free speech in and out · bring your own LLM key</div>
        <h1>AI voice agents that<br /><span className="grad">talk like people.</span></h1>
        <p className="lead">
          Give an agent a personality, paste your contact list, and talk to it live in the browser. It answers when you
          pause, stops when you interrupt, and never mistakes its own voice for yours.
        </p>
        <div className="row gap center wrap">
          <Link href="/app" className="primary-btn big">Start a call <PhoneCall size={18} /></Link>
          <a href="#how" className="ghost-btn big">How it works</a>
        </div>
        <div className="wave" aria-hidden>
          {Array.from({ length: 48 }).map((_, i) => (
            <i key={i} style={{ animationDelay: `${(i % 12) * 0.09}s`, height: `${18 + ((i * 37) % 60)}%` }} />
          ))}
        </div>
      </section>

      <section className="land-section" id="how">
        <h2>Three steps to a live call</h2>
        <div className="steps">
          {STEPS.map((s, i) => (
            <div key={s.title} className="card step">
              <div className="step-num">{i + 1}</div>
              <s.icon size={22} />
              <h3>{s.title}</h3>
              <p className="muted">{s.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="land-section">
        <h2>Built around how people actually talk</h2>
        <p className="muted center-text">Turn-taking is the product. Every one of these is handled in the call engine, not left to the model.</p>
        <div className="features">
          {HUMAN.map((f) => (
            <div key={f.title} className="card feature">
              <f.icon size={20} />
              <h3>{f.title}</h3>
              <p className="muted">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="land-section">
        <div className="card stack">
          <div>
            <h2>Speech costs nothing</h2>
            <p className="muted">
              Voices come from Microsoft Edge neural TTS over a warm connection (~0.3s). Listening runs on local Whisper
              on your own server, or the browser&apos;s built-in recogniser. The only paid part is the model that decides
              what to say: OpenRouter by default, KIE as automatic fallback.
            </p>
          </div>
          <ul className="stack-list">
            <li><Volume2 size={16} /> Edge neural voices · free, no key</li>
            <li><Ear size={16} /> faster-whisper on CPU · private</li>
            <li><Sparkles size={16} /> Gemini 2.5 Flash · ~0.7s to first token</li>
            <li><ShieldCheck size={16} /> Honest about being an AI · never asks for card numbers or codes</li>
          </ul>
        </div>
      </section>

      <section className="land-cta">
        <h2>Hear it for yourself</h2>
        <Link href="/app" className="primary-btn big">Open the playground <ArrowRight size={18} /></Link>
      </section>

      <footer className="land-foot muted small">Voxa · voice agent playground</footer>
    </div>
  );
}
