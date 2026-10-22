# VaniDial — Architecture & System Design

Version 1 · October 2026

VaniDial phones a business's customers, holds a natural conversation in their language, and turns each call into a structured feedback record. Every answer in the record links to the second of audio where the customer gave it. Everything below exists to make one number good: **cost per trustworthy completed feedback record**.

---

## 1. First principles

| Problem | What it reduces to | Design consequence |
|---|---|---|
| "Can I trust an AI's answer?" | Can a human check it in under 5 seconds? | Every answer stores `evidence_start_ms`/`evidence_end_ms` into a private recording. The review UI plays that exact slice. |
| "Are we legal?" | Can an invalid campaign ever dial? | The rules live in the database. A campaign can only move to `running` through `launch_campaign()`, and that function re-runs the six checks itself. A trigger rejects any call to a do-not-call (DNC) number, whatever app code does. |
| "Does it sound human?" | Turn-taking latency and barge-in | The streaming pipeline has a budget of 800 ms from end of speech to first word. The caller always has the floor. |
| "Is it cheaper than people?" | Minutes per completed record × ₹/min | The cost of every leg (telephony, STT, LLM, TTS, storage, review) is recorded per call in `usage_events`. The dashboard shows cost per record, not cost per minute. |
| "Public demo links get abused" | Every playground second spends money | The playground has per-link, per-IP and global daily budgets enforced in Postgres, a 5-minute call cap, anonymous identities, and no telephony. |

## 2. System components

```
                   ┌──────────────────────── Vercel (Next.js 15) ────────────────────────┐
 Browser  ───────▶ │ Marketing site · Console · Playground · /p/[slug] share pages        │
 (operator,        │ Route handlers: /api/v1/* (API keys) · /api/play/* (STT/TTS/LLM)     │
  reviewer,        │ /api/webhooks/{plivo,telnyx} (signed status callbacks)               │
  public caller)   └──────────────┬──────────────────────────────────────────┬────────────┘
                                  │ anon key + user JWT (RLS)                 │ Groq · OpenRouter · Edge TTS
                                  ▼                                           ▼
                   ┌──────────── Supabase ────────────┐            ┌── AI providers ──┐
                   │ Postgres (RLS on every table)    │            │ STT: Sarvam /    │
                   │ Auth (email, Google, anonymous)  │◀──────────▶│   Groq Whisper   │
                   │ Storage: recordings (private)    │            │ LLM: OpenRouter  │
                   │ Realtime: live monitor           │            │ TTS: Sarvam /    │
                   └──────────────▲───────────────────┘            │   Edge neural    │
                                  │ service role (server only)     └────────▲─────────┘
                   ┌──────────────┴───────────────────────────────────────────┴─────────┐
                   │ Voice gateway (Node 22, long-running; Oracle VM via Coolify, ap-south) │
                   │  • Dialler: pulls due call jobs (FOR UPDATE SKIP LOCKED)            │
                   │  • Carrier adapters: Plivo (India), Telnyx (US/CA/intl)             │
                   │  • Media WebSocket: 8 kHz μ-law ⇄ streaming STT → LLM → TTS         │
                   │  • Turn-taking, barge-in, language switch, live answer extraction  │
                   └──────────────▲──────────────────────────────────▲─────────────────┘
                                  │ media streams (WSS)              │ REST (dial, hangup)
                            ┌─────┴─────┐                      ┌─────┴─────┐
                            │  Plivo    │  India (+91)         │  Telnyx   │  US / CA / rest
                            └───────────┘                      └───────────┘
```

**Why the voice gateway is not on Vercel.** A phone call is a 3-minute bidirectional WebSocket that carries audio every 20 ms. Serverless functions are request/response with time limits. The gateway is a small, stateful, long-running service in an Indian region (latency to Plivo Mumbai below 20 ms). Everything else is serverless.

**Why Postgres is the queue.** At pilot scale (about 40 concurrent calls, a few thousand dials a day), `SELECT … FOR UPDATE SKIP LOCKED` on `call_jobs` is exactly-once, transactional with the compliance checks, and needs no Redis. Move to a dedicated queue above roughly 500 concurrent calls.

## 3. Data model

Every business row carries `org_id`. Row-level security resolves the caller's role in that org through `public.org_role(org_id)` (security definer, stable).

```
organizations ─┬─ memberships (user_id, role: owner|admin|operator|reviewer|viewer)
               ├─ agents ── agent_versions (immutable: script, questions[], languages[], voice, disclosure)
               ├─ phone_numbers (e164, country, carrier, purpose: service|promotional, series, verified_at)
               ├─ contact_lists ── contacts (e164, name, language, timezone, consent_source, consent_at, attrs jsonb)
               ├─ dnc_entries (e164, reason, source)        ← opt-outs land here instantly, never removed by app roles
               ├─ dnd_scrubs (list_id, provider, scrubbed_at, removed_count)
               ├─ campaigns (status, purpose, agent_version_id, phone_number_id, list_id, schedule, limits,
               │             budget_cap_paise, frozen_at, frozen_config jsonb)
               │     └─ campaign_checks (view) → six gate checks computed live
               ├─ call_jobs (campaign_id, contact_id, attempt, due_at, state)    ← dialler queue
               ├─ calls (job_id, carrier, carrier_call_id, status, outcome, started_at, answered_at, ended_at,
               │         duration_ms, recording_path, language_detected, cost breakdown in paise)
               │     ├─ call_turns (speaker, text, lang, start_ms, end_ms, interrupted)
               │     └─ answers (question_key, type, value jsonb, confidence, evidence_start_ms, evidence_end_ms,
               │                 review_state: auto|needs_review|corrected|confirmed, reviewed_by)
               ├─ review_tasks (call_id, reason, assigned_to, state)
               ├─ usage_events (call_id, kind: telephony|stt|tts|llm|storage|review, quantity, unit, cost_paise)
               ├─ webhook_endpoints (url, secret_hash, events[]) · api_keys (prefix, hash, scopes, last_used_at)
               └─ audit_log (actor, action, entity, diff, at)   ← append-only: no UPDATE/DELETE for any role

personas (playground)  owner_id (auth uid, may be anonymous), name, description, language, voice,
                       greeting, visibility: private|unlisted|public, share_slug, daily_minutes_cap
play_sessions          persona_id, ip_hash, started_at, seconds_used          ← quotas
rate_buckets           key, window_start, count                              ← generic limiter
```

Money is stored as integer **paise** (or cents for USD numbers) to avoid floating-point errors.

## 4. The campaign lifecycle and the compliance gate

```
 draft ──(operator edits)──▶ draft ──launch_campaign()──▶ running ⇄ paused ──▶ completed
                                         │                    │
                                         │                    └─ auto-pause: failure rate > 30% over 50 dials,
                                         │                                    or budget cap reached
                                         └─ fails if any check fails; nothing changes
```

`launch_campaign(campaign_id)` runs in one transaction:

1. **Purpose classified.** `purpose` is `service` or `promotional`.
2. **Caller ID verified.** `phone_numbers.verified_at` is set, the country matches the contacts' country, and the series matches the purpose (India: 1600-series for service, 140-series for promotional).
3. **Consent attached.** Every contact in the list has `consent_source` and `consent_at`. Contacts without them are excluded, never dialled.
4. **Fresh DND scrub.** A `dnd_scrubs` row for this list less than 24 hours old (India).
5. **Script approved.** The agent version has `approved_at`, and its disclosure line contains the locked AI disclosure.
6. **Calling window valid.** The schedule is inside 09:00–21:00 in each contact's timezone (India), or the US rules for US numbers.

If all six pass, the campaign's `frozen_config` is written (snapshot of agent version, number, schedule, limits), `frozen_at` is set, an `audit_log` row records the approver, and `call_jobs` are generated. Triggers block any later change to frozen columns. The console shows the Launch button only when the view `campaign_checks` reports 6/6. Otherwise it shows one sentence saying what is missing.

**Defence in depth at dial time.** The dialler calls `claim_call_job()`. It re-checks the DNC list, the frequency cap (the same number dialled at most once in 7 days across all campaigns), the contact's local time and the budget, then marks the job `dialing`. A `calls` insert trigger rejects DNC numbers whatever the application does.

## 5. The call pipeline (production, phone)

```
 Carrier ──WSS media (8 kHz μ-law, 20 ms frames)──▶ Gateway session
   │                                                   │
   │  VAD (energy + model) → end-of-turn (650 ms; 1.3 s if trailing "aur…/and…")
   │  Streaming STT (Sarvam Saarika / Groq) → partials + final, language id
   │  LLM (OpenRouter, streamed, first sentence early) with tools:
   │      record_answer(key, value, confidence, evidence_span)  ← live extraction
   │      switch_language(code) · schedule_callback(at) · opt_out() · transfer_to_human()
   │  TTS (Sarvam Bulbul / Edge) streamed per sentence → μ-law → carrier
   │  Barge-in: caller voice > adaptive threshold for 300 ms while agent speaks → stop
   │            playback (carrier "clearAudio"), keep only the words actually played
   ▼
 On hangup: recording → Storage (private), turns + answers committed, cost events,
            low-confidence answers → review_tasks, webhooks fired (HMAC-signed)
```

**Latency budget** (end of caller speech → first agent audio): VAD tail 250 ms + STT final 150 ms + LLM first token 300 ms + TTS first chunk 120 ms ≈ **820 ms**. To get under 800 ms, LLM generation starts on a stable STT partial, and the first sentence is spoken while the rest is still being generated.

**Language.** Each language profile (Hindi, Gujarati, English-India, Hinglish) has its own voice, STT model, prompts, disclosure and bridge words. Switching uses the same gender's voice in the new language. A language goes GA only after native-speaker scoring on more than 100 calls (`language_profiles.ga`).

**Redaction.** Before storage, transcripts are passed through redaction: card numbers (Luhn-valid 13–19 digits), Aadhaar (12 digits, Verhoeff), PAN, OTP-like strings after "OTP/code". The audio for those spans is not redacted in the pilot, which is a known gap; recordings stay private with short-lived signed URLs.

## 6. The playground (browser, no telephony)

* `/playground`: anyone can create a **persona** (name, personality description, language, voice, opening line). The first visit signs the browser in as a Supabase **anonymous user**, so personas have an owner without a signup. Signing up later keeps them.
* `/p/[slug]`: a public, share-ready call page. One button, "Start call". It uses the browser microphone, the same turn-taking engine as the phone pipeline, Groq Whisper for STT (falling back to the browser recogniser), Edge neural TTS and OpenRouter.
* **Abuse controls** (enforced in Postgres via `play_quota_take()`; the API never trusts the client):
  * per link: `daily_minutes_cap` (default 60 min/day)
  * per IP (HMAC-hashed, never stored raw): 15 min/day across all links
  * global: `PLAY_GLOBAL_DAILY_MINUTES` env cap, which acts as the kill switch
  * per call: 5 minutes hard stop; per request: 20 LLM turns/minute
  * persona text is capped (2,000 chars), and the system rules are placed *after* the persona so they win over prompt-injected instructions
* The playground never dials phone numbers and never sees org data.

## 7. Security model

| Layer | Control |
|---|---|
| Identity | Supabase Auth (email OTP, Google). Sessions in HttpOnly cookies via `@supabase/ssr`. Anonymous users only for the playground. |
| Authorization | RLS on every table, deny by default. `org_role()` hierarchy: owner > admin > operator > reviewer > viewer. Reviewers write only `answers.review_*` and `review_tasks`. Viewers are read-only. |
| Immutability | `audit_log`: no UPDATE/DELETE grants, plus a trigger that raises. `agent_versions`: immutable after insert. Campaign frozen columns: trigger. `dnc_entries`: insert-only for app roles. |
| Secrets | Service-role key only in the voice gateway and server-only modules (`import 'server-only'`). Never in the browser bundle. Carrier and AI keys only in env. |
| API keys | `vd_live_` + 32 random bytes. Only `sha256(key)` and an 8-char prefix are stored. Scoped (`calls:read`, `contacts:write`…). Shown once. |
| Webhooks in | Plivo: `X-Plivo-Signature-V3` HMAC-SHA256 with nonce. Telnyx: Ed25519 signature + timestamp (5 min tolerance). Rejected otherwise. |
| Webhooks out | `X-VaniDial-Signature: t=…,v1=HMAC-SHA256(secret, t.body)`, retries with backoff, idempotency key. |
| Transport & browser | HSTS, strict CSP (self + Supabase + required origins), `frame-ancestors 'none'`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy: microphone=(self)`. |
| Input | Zod validation on every route. Phone numbers normalised to E.164 with libphonenumber. CSV import is staged and confirmed before commit. |
| Data rights | `delete_contact_data(e164)` removes the contact, calls, turns, answers, recordings and exports for that number, and logs the deletion in the audit log (hash of the number only). Retention per org (default 180 days for recordings). |
| Rate limits | Postgres token buckets for auth, API and playground routes. Vercel Firewall in front. |

## 8. Cost model and billing

`usage_events` records each leg as it happens. Pricing per unit lives in `rate_cards`, versioned per provider, so invoices can be reconciled.

| Leg | Estimate (₹/min) | Source of truth |
|---|---|---|
| Telephony | 0.50 | carrier CDR via status webhook (`calls.carrier_cost`) |
| STT | 0.50 | seconds of audio sent |
| TTS | 0.54 | characters synthesised |
| LLM | 0.90 | tokens in/out from provider usage |
| **Total** | **≈ 2.44** | → cost per completed record ≈ ₹47 including retries and review |

The budget cap is checked in `claim_call_job()` using spent + reserved (in-flight calls × expected cost). New dials stop the moment the cap would be crossed.

## 9. Environments & deployment

* **Web**: Vercel, `main` → production, PRs → previews. Region `bom1` for functions.
* **DB**: Supabase project `vanidial` (ap-south-1). Migrations in `supabase/migrations`, applied in order.
* **Gateway**: `services/voice-gateway` Docker image on the Oracle VM via Coolify (Mumbai), behind TLS. Health at `/healthz`.
* **Observability**: structured JSON logs with `call_id`, Vercel log drains, per-call latency spans (`stt_ms`, `llm_ttft_ms`, `tts_ttfb_ms`) stored on `calls.metrics`.

## 10. What is real today vs. what needs an account

| Works on deploy | Needs your accounts / approvals |
|---|---|
| Landing site, auth, console, all data screens, RLS | Plivo account + verified Indian number + DLT registration |
| Playground with share links, live voice calls in the browser | Telnyx account + US number |
| Campaign wizard and compliance gate (enforced in DB) | DND scrub provider (TRAI NCPR via carrier) |
| Gateway code: adapters, media loop, extraction | Sarvam API key (production Hinglish/Gujarati voice) |
