# VaniDial

AI feedback calls in Hindi, Gujarati, English and Hinglish, with the audio second behind every answer.

* `app/`, `components/`, `lib/`: Next.js 15 web app, which includes the landing site, the console, the playground and the public API.
* `supabase/migrations/`: schema, row-level security and the workflow functions. `supabase/tests/` holds the behavioural security suite.
* `services/voice-gateway/`: the long-running telephony server (Plivo, Telnyx, Sarvam), deployed as a Docker image.
* `docs/ARCHITECTURE.md`: covers the system design, the security model, costs and deployment.

## Run locally

```bash
pnpm install
cp .env.example .env.local   # fill in Supabase URL/anon key and the playground secrets
pnpm dev
```

## Database

Apply `supabase/migrations/*.sql` in order. Then insert the playground secret's hash:

```sql
insert into public.play_secrets(id, server_token_hash)
values (1, encode(extensions.digest('<PLAY_SERVER_TOKEN>', 'sha256'), 'hex'));
```

## Voice gateway

```bash
cd services/voice-gateway
cp .env.example .env    # service role key, carrier keys, Sarvam, OpenRouter
docker build -t vanidial-gateway . && docker run --env-file .env -p 8080:8080 vanidial-gateway
npm test                # codec, token, turn-taking and opt-out tests
```
