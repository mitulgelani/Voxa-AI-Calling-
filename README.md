# Voxa — AI voice agents that talk like people

Build an AI caller with its own personality, paste your contact list from Excel, and talk to it live in the browser. Speech in and out is free; the only paid part is the language model.

- **Voice out:** Microsoft Edge neural TTS over a warm WebSocket (~0.3s per line, no key)
- **Voice in:** local Whisper (faster-whisper `base`, CPU) or the browser's built-in recogniser
- **Brain:** OpenRouter (default, Gemini 2.5 Flash) with KIE as automatic fallback

## What's in it

| Area | What it does |
|---|---|
| Landing page `/` | Product page with a call to action into the app |
| Playground `/app` | Pick 1) language, 2) voice (only that language's natural voices), 3) agent, 4) who you are, then one-button live call |
| Agents | Personality, goal, opening line, voice (with preview), pace, reply length, model |
| Contacts | Paste rows from Excel / Google Sheets or upload CSV. Headers detected, every column becomes a `{{variable}}` |
| Calls | Full transcripts with interruptions marked, CSV export |

Data is stored in the browser (localStorage) for v1.

## Languages

27 options, each with free native Edge neural voices, set per agent:

- **India:** Hindi, Hinglish (Hindi + English mixed, the way people actually talk), Gujarati, Marathi, Tamil, Telugu, Bengali, Kannada, Malayalam, Urdu, Indian English
- **World:** English (US/UK), Spanish (Spain/Mexico), French, German, Portuguese (Brazil), Italian, Arabic, Russian, Turkish, Indonesian, Japanese, Mandarin, Korean, Dutch

The language drives everything: the voice, the model's replies (native script), the listening engine, bridge sounds ("हम्म।", "अच्छा।"), the fallback line, and the interruption and nod detection ("ruko", "haan ji").

**Strict language, switchable by voice.** The agent only speaks the selected language; if a reply comes back in the wrong language or script it is rewritten before it is spoken. If the caller speaks a full sentence in another language or asks ("English mein baat karo"), the agent switches: new voice of the same gender, new listening language, and it carries on.

**Listening engine (auto):** phones use Whisper (silent; Android's browser recogniser beeps on every restart and fights the mic). Desktop Chrome/Edge/Safari use the browser recogniser (silent there, live words, most accurate). Whisper uses `base` for English and `small` for Hindi and other languages (`STT_MODEL_MULTI`), and filters the phrases Whisper invents on silence ("Thank you.", "धन्यवाद").

## How it stays human

All in `components/CallStudio.tsx`:

- **The caller has priority.** Talk over the agent and it pauses within ~0.3s. Keep talking past ~0.9s, or say "wait / ruko / stop", and it drops the rest of its sentence and listens. A quick "haan" or "mm-hmm" lets it carry on.
- **It never starts talking over you.** Before every reply it waits until you have been quiet for 0.3s; if you start again, the reply is thrown away.
- If you keep talking while it is thinking, it drops the pending reply and merges both halves into one turn.
- Ends your turn after 650ms of silence, waits ~1.3s when you trail off ("so I was wondering if…", "मतलब…").
- Mic threshold adapts to room noise, so quiet voices are heard and fans or traffic are not.
- Remembers only what it actually said before being cut off, so it answers you instead of finishing its old sentence.
- Short bridges ("Right.", "अच्छा।") only when a substantive reply is slow, never twice in a row.
- Echo protection three ways: louder-than-echo gate, 450ms cooldown, and comparing your words with its recent lines.
- Checks in after 9s of silence, hangs up politely after the second check-in, and ends the call itself after saying goodbye.
- Watchdog every 7s re-acquires a dead mic and restarts listening.

## Run it (single Linux box)

Requirements: Node 22+ (24 recommended), pnpm, Python 3.10+, optionally `cloudflared` for a public link.

```bash
cp .env.example .env        # add OPENROUTER_API_KEY and/or KIE_API_KEY
./start-all.sh              # installs, builds, starts Whisper + web app + tunnel, prints the link
```

Or by hand:

```bash
pnpm install
pnpm dev                    # http://localhost:3210
./stt.sh                    # in another terminal: builds .venv, starts Whisper on 127.0.0.1:8897
```

The first Whisper start downloads the `base` model (~140 MB).

## Deploy on Vercel

The web app deploys as-is (`pnpm build`). Set `OPENROUTER_API_KEY` / `KIE_API_KEY` in the Vercel project.

Whisper cannot run inside Vercel functions. Two options:

1. **Browser engine only** — leave `STT_URL` unset. The app detects Whisper is offline and uses the browser recogniser (Chrome, Edge, Safari).
2. **Whisper on your own box** — run `stt.sh` on a VPS with `STT_HOST=0.0.0.0` and a `STT_TOKEN`, expose it (tunnel or HTTPS proxy), and set `STT_URL` + the same `STT_TOKEN` in Vercel.

Edge TTS works from Vercel functions; the warm socket is reused while a function instance stays warm.

## Environment

```
OPENROUTER_API_KEY=   # default brain
KIE_API_KEY=          # fallback brain
STT_URL=http://127.0.0.1:8897
STT_MODEL=base        # do not shrink without testing on real accented speech
STT_PORT=8897
STT_THREADS=2         # set to your core count
STT_TOKEN=            # optional bearer token for the Whisper service
PORT=3210
```

## Not in v1 yet

Dialling real phone numbers from the contact list needs a telephony provider (Twilio, Plivo, Exotel or a SIP trunk); the contact list, variables and call engine are built so that can plug in next. Accounts and a server-side database come with multi-user.
