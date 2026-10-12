# Voxa — AI voice agents that talk like people

Build an AI caller with its own personality, paste your contact list from Excel, and talk to it live in the browser. Speech in and out is free; the only paid part is the language model.

- **Voice out:** Microsoft Edge neural TTS over a warm WebSocket (~0.3s per line, no key)
- **Voice in:** local Whisper (faster-whisper `base`, CPU) or the browser's built-in recogniser
- **Brain:** OpenRouter (default, Gemini 2.5 Flash) with KIE as automatic fallback

## What's in v1

| Area | What it does |
|---|---|
| Landing page `/` | Product page with a call to action into the app |
| Playground `/app` | One-button live call with any agent, optionally "as" one of your contacts |
| Agents | Personality, goal, opening line, voice (with preview), pace, reply length, model |
| Contacts | Paste rows from Excel / Google Sheets or upload CSV. Headers detected, every column becomes a `{{variable}}` |
| Calls | Full transcripts with interruptions marked, CSV export |

Data is stored in the browser (localStorage) for v1.

## Languages

27 options, each with free native Edge neural voices, set per agent:

- **India:** Hindi, Hinglish (Hindi + English mixed, the way people actually talk), Gujarati, Marathi, Tamil, Telugu, Bengali, Kannada, Malayalam, Urdu, Indian English
- **World:** English (US/UK), Spanish (Spain/Mexico), French, German, Portuguese (Brazil), Italian, Arabic, Russian, Turkish, Indonesian, Japanese, Mandarin, Korean, Dutch

The language drives everything: the voice, the model's replies (native script), the listening engine, bridge sounds ("हम्म।", "अच्छा।"), the fallback line, and the interruption and nod detection ("ruko", "haan ji").

**Listening in non-English languages:** Whisper `base` is weak for Hindi and Indian languages, so those agents default to the browser engine (Google's recogniser in Chrome/Edge), which is faster and more accurate for them. To use Whisper for them, set `STT_MODEL=small` (about 3x slower on CPU, much better) and test on real recordings first.

## How it stays human

All in `components/CallStudio.tsx`:

- Ends your turn after 650ms of silence, waits ~1.3s when you trail off ("so I was wondering if…")
- Pauses the moment you talk over it, then decides from your words: a real interruption (stops and answers) or a nod / cough (resumes). "Wait", "stop", "sorry" interrupt even when short
- Remembers only what it actually said before being cut off, so it answers you instead of finishing its old sentence
- If you keep talking while it is thinking, it drops the pending reply and merges both halves into one turn
- Short bridges ("Right.") only when a substantive reply is slow, never twice in a row
- Echo protection three ways: louder-than-echo gate, 450ms cooldown, and comparing your words with its recent lines
- Checks in after 9s of silence, hangs up politely after the second check-in
- Says goodbye and ends the call itself when the conversation is done
- Watchdog every 7s re-acquires a dead mic, restarts the recogniser, resumes a suspended audio context
- Auto-switches engines if Whisper goes down or the browser recogniser hears sound but no words

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
