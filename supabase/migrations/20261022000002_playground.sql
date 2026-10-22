-- Playground: shareable AI personas that anyone with the link can call in the browser.
-- Quotas are enforced here. The web server proves it is the caller of the quota
-- functions with a shared secret stored in a table nobody can read.

create table public.personas (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid default auth.uid() references auth.users(id) on delete cascade, -- null = VaniDial showcase persona
  name text not null check (char_length(name) between 1 and 40),
  tagline text not null default '' check (char_length(tagline) <= 120),
  description text not null check (char_length(description) between 20 and 2000),
  greeting text not null default '' check (char_length(greeting) <= 300),
  language text not null default 'hinglish' check (char_length(language) <= 16),
  voice text not null check (voice ~ '^[a-z]{2,3}-[A-Z]{2}-[A-Za-z]+Neural$'),
  rate text not null default '+0%' check (rate in ('-8%', '+0%', '+8%')),
  visibility text not null default 'unlisted' check (visibility in ('private', 'unlisted', 'public')),
  share_slug text not null unique default encode(extensions.gen_random_bytes(7), 'hex'),
  accent text not null default 'saffron' check (accent in ('saffron', 'teal', 'violet', 'rose', 'sky', 'lime')),
  daily_minutes_cap int not null default 60 check (daily_minutes_cap between 1 and 600),
  call_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index personas_owner_idx on public.personas(owner_id, created_at desc);

create or replace function public.personas_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.owner_id is not null and (select count(*) from public.personas p where p.owner_id = new.owner_id) >= 25 then
      raise exception 'you can keep up to 25 personas';
    end if;
  else
    new.share_slug := old.share_slug;
    new.owner_id := old.owner_id;
    new.call_count := old.call_count;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger personas_guard before insert or update on public.personas
  for each row execute function public.personas_guard();

alter table public.personas enable row level security;
create policy personas_owner_read on public.personas for select to authenticated using (owner_id = (select auth.uid()));
create policy personas_owner_insert on public.personas for insert to authenticated with check (owner_id = (select auth.uid()));
create policy personas_owner_update on public.personas for update to authenticated using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy personas_owner_delete on public.personas for delete to authenticated using (owner_id = (select auth.uid()));

-- Public view of a persona by its share link: only safe fields, never the owner.
create or replace function public.persona_by_slug(p_slug text)
returns table (id uuid, name text, tagline text, description text, greeting text, language text, voice text, rate text, accent text, call_count int, is_owner boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, p.tagline, p.description, p.greeting, p.language, p.voice, p.rate, p.accent, p.call_count,
         p.owner_id = (select auth.uid())
  from public.personas p
  where p.share_slug = p_slug and (p.visibility <> 'private' or p.owner_id = (select auth.uid()))
$$;
grant execute on function public.persona_by_slug(text) to anon, authenticated;

create or replace function public.public_personas(p_limit int default 12)
returns table (name text, tagline text, language text, accent text, share_slug text, call_count int)
language sql stable security definer set search_path = ''
as $$
  select p.name, p.tagline, p.language, p.accent, p.share_slug, p.call_count
  from public.personas p where p.visibility = 'public'
  order by p.call_count desc, p.created_at desc limit least(greatest(p_limit, 1), 48)
$$;
grant execute on function public.public_personas(int) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Quotas
-- ---------------------------------------------------------------------------
create table public.play_secrets (
  id int primary key default 1 check (id = 1),
  server_token_hash text not null,
  global_daily_minutes int not null default 600,
  per_ip_daily_minutes int not null default 15,
  max_call_seconds int not null default 300
);
alter table public.play_secrets enable row level security; -- no policies: unreadable from the API

create table public.play_sessions (
  id uuid primary key default gen_random_uuid(),
  persona_id uuid not null references public.personas(id) on delete cascade,
  ip_hash text not null,
  allowed_seconds int not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  turns int not null default 0,
  last_turn_at timestamptz,
  turns_this_minute int not null default 0
);
create index play_sessions_persona_day_idx on public.play_sessions(persona_id, started_at desc);
create index play_sessions_ip_day_idx on public.play_sessions(ip_hash, started_at desc);
create index play_sessions_day_idx on public.play_sessions(started_at desc);
alter table public.play_sessions enable row level security; -- no policies: only the functions below touch it

create or replace function public._play_check_token(p_token text)
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.play_secrets s
                 where s.server_token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')) then
    raise exception 'forbidden';
  end if;
end $$;
revoke all on function public._play_check_token(text) from public, anon, authenticated;

create or replace function public._play_used_seconds(p_since timestamptz, p_persona uuid, p_ip text)
returns int language sql stable security definer set search_path = '' as $$
  select coalesce(sum(least(extract(epoch from coalesce(s.ended_at, now()) - s.started_at)::int, s.allowed_seconds)), 0)::int
  from public.play_sessions s
  where s.started_at >= p_since
    and (p_persona is null or s.persona_id = p_persona)
    and (p_ip is null or s.ip_hash = p_ip)
$$;
revoke all on function public._play_used_seconds(timestamptz, uuid, text) from public, anon, authenticated;

-- Start a call. Returns the session and how many seconds it may last, or raises with a reason.
create or replace function public.play_session_start(p_token text, p_slug text, p_ip_hash text)
returns table (session_id uuid, allowed_seconds int)
language plpgsql security definer set search_path = ''
as $$
declare
  cfg public.play_secrets;
  p public.personas;
  day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  left_link int; left_ip int; left_global int; allowed int; sid uuid;
begin
  perform public._play_check_token(p_token);
  select * into cfg from public.play_secrets where id = 1;
  select * into p from public.personas where share_slug = p_slug;
  if p.id is null or p.visibility = 'private' then raise exception 'persona not found'; end if;

  -- one live call per IP at a time
  update public.play_sessions set ended_at = now()
  where ip_hash = p_ip_hash and ended_at is null and started_at < now() - make_interval(secs => cfg.max_call_seconds);
  if exists (select 1 from public.play_sessions where ip_hash = p_ip_hash and ended_at is null) then
    raise exception 'a call is already running from this network';
  end if;

  left_link := p.daily_minutes_cap * 60 - public._play_used_seconds(day_start, p.id, null);
  left_ip := cfg.per_ip_daily_minutes * 60 - public._play_used_seconds(day_start, null, p_ip_hash);
  left_global := cfg.global_daily_minutes * 60 - public._play_used_seconds(day_start, null, null);
  allowed := least(cfg.max_call_seconds, left_link, left_ip, left_global);

  if left_global < 20 then raise exception 'the playground has reached today''s limit, try again tomorrow'; end if;
  if left_link < 20 then raise exception 'this persona has used today''s call minutes'; end if;
  if left_ip < 20 then raise exception 'you have used today''s free call minutes'; end if;

  insert into public.play_sessions(persona_id, ip_hash, allowed_seconds)
  values (p.id, p_ip_hash, allowed) returning id into sid;
  update public.personas set call_count = call_count + 1 where id = p.id;
  session_id := sid; allowed_seconds := allowed;
  return next;
end $$;
revoke all on function public.play_session_start(text, text, text) from public;
grant execute on function public.play_session_start(text, text, text) to anon, authenticated;

-- Every STT/LLM/TTS request in a call goes through this: is the session alive, within time, not flooding?
create or replace function public.play_session_tick(p_token text, p_session uuid, p_kind text)
returns table (persona_id uuid, seconds_left int)
language plpgsql security definer set search_path = ''
as $$
declare s public.play_sessions; elapsed int; per_minute int;
begin
  perform public._play_check_token(p_token);
  select * into s from public.play_sessions where id = p_session for update;
  if s.id is null or s.ended_at is not null then raise exception 'call has ended'; end if;
  elapsed := extract(epoch from now() - s.started_at)::int;
  if elapsed > s.allowed_seconds + 15 then
    update public.play_sessions set ended_at = now() where id = s.id;
    raise exception 'call time is up';
  end if;
  if p_kind = 'chat' then
    per_minute := case when s.last_turn_at > now() - interval '60 seconds' then s.turns_this_minute + 1 else 1 end;
    if per_minute > 24 then raise exception 'too many turns, slow down'; end if;
    update public.play_sessions set turns = turns + 1, last_turn_at = now(), turns_this_minute = per_minute where id = s.id;
  end if;
  persona_id := s.persona_id; seconds_left := greatest(s.allowed_seconds - elapsed, 0);
  return next;
end $$;
revoke all on function public.play_session_tick(text, uuid, text) from public;
grant execute on function public.play_session_tick(text, uuid, text) to anon, authenticated;

create or replace function public.play_session_end(p_token text, p_session uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._play_check_token(p_token);
  update public.play_sessions set ended_at = now() where id = p_session and ended_at is null;
end $$;
revoke all on function public.play_session_end(text, uuid) from public;
grant execute on function public.play_session_end(text, uuid) to anon, authenticated;

-- Full persona text for the model, only for a live session (server-side, token-gated).
create or replace function public.play_persona_for_session(p_token text, p_session uuid)
returns table (name text, description text, greeting text, language text, voice text, rate text)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._play_check_token(p_token);
  return query
  select p.name, p.description, p.greeting, p.language, p.voice, p.rate
  from public.play_sessions s join public.personas p on p.id = s.persona_id
  where s.id = p_session and s.ended_at is null;
end $$;
revoke all on function public.play_persona_for_session(text, uuid) from public;
grant execute on function public.play_persona_for_session(text, uuid) to anon, authenticated;

-- Generic fixed-window limiter (auth forms, persona creation, API), token-gated.
create table public.rate_buckets (
  key text not null,
  window_start timestamptz not null,
  hits int not null default 0,
  primary key (key, window_start)
);
alter table public.rate_buckets enable row level security;

create or replace function public.rate_limit_hit(p_token text, p_key text, p_limit int, p_window_seconds int)
returns boolean language plpgsql security definer set search_path = '' as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds); n int;
begin
  perform public._play_check_token(p_token);
  insert into public.rate_buckets(key, window_start, hits) values (p_key, w, 1)
  on conflict (key, window_start) do update set hits = public.rate_buckets.hits + 1
  returning hits into n;
  delete from public.rate_buckets where window_start < now() - interval '2 days' and random() < 0.01;
  return n <= p_limit;
end $$;
revoke all on function public.rate_limit_hit(text, text, int, int) from public;
grant execute on function public.rate_limit_hit(text, text, int, int) to anon, authenticated;

-- Showcase personas (owned by nobody, editable by nobody through the API).
insert into public.personas (owner_id, name, tagline, description, greeting, language, voice, visibility, accent, daily_minutes_cap) values
(null, 'Asha', 'Hinglish feedback call for a skincare brand',
 'You are Asha, calling on behalf of Glowleaf, a fictional skincare brand, to ask a recent customer how their order went. You are warm, quick and a little playful, like a friendly young professional from Mumbai. Ask about: delivery experience, how the product feels after a week, a rating from 1 to 5, and one thing they would change. Keep it light, thank them, and wrap up within three minutes.',
 '', 'hinglish', 'hi-IN-SwaraNeural', 'public', 'saffron', 180),
(null, 'Kiran', 'Gujarati follow-up after a clinic visit',
 'You are Kiran, calling from Shanti Clinic, a fictional clinic in Ahmedabad, to follow up on a patient''s visit last week. You are calm, respectful and patient with older callers. Ask how they are feeling, whether the doctor explained things clearly, whether waiting time was okay, and a rating from 1 to 5. Never give medical advice; if they have a health concern, suggest they call the clinic.',
 '', 'gu-IN', 'gu-IN-DhwaniNeural', 'public', 'teal', 120),
(null, 'Rohan', 'Hindi delivery feedback for a grocery app',
 'You are Rohan, calling from TazaKart, a fictional grocery delivery app, to ask about yesterday''s delivery. You speak simple, polite Hindi and keep things brisk. Ask whether everything arrived, whether anything was damaged or missing, how the delivery partner behaved, and a rating from 1 to 5.',
 '', 'hi-IN', 'hi-IN-MadhurNeural', 'public', 'sky', 120),
(null, 'Meera', 'English check-in for an online course',
 'You are Meera, calling from Learnwell, a fictional online learning platform, to check in with a student two weeks into a course. You are encouraging and curious. Ask how the course is going, what is hardest so far, whether the live sessions are at a good time, and how likely they are to recommend it from 0 to 10.',
 '', 'en-IN', 'en-IN-NeerjaNeural', 'public', 'violet', 120)
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Personas made without an account. The browser holds a random owner key in an
-- HttpOnly cookie; only its hash is stored. All access goes through token-gated
-- functions called by the web server.
-- ---------------------------------------------------------------------------
alter table public.personas add column owner_key_hash text;
create index personas_owner_key_idx on public.personas(owner_key_hash) where owner_key_hash is not null;

create or replace function public._key_hash(p_key text)
returns text language sql immutable set search_path = '' as $$
  select encode(extensions.digest('vd-owner:' || coalesce(p_key, ''), 'sha256'), 'hex')
$$;
revoke all on function public._key_hash(text) from public, anon, authenticated;

create or replace function public.play_save_persona(
  p_token text, p_owner_key text, p_slug text,
  p_name text, p_tagline text, p_description text, p_greeting text,
  p_language text, p_voice text, p_rate text, p_visibility text, p_accent text
) returns text
language plpgsql security definer set search_path = '' as $$
declare v_hash text := public._key_hash(p_owner_key); v_slug text;
begin
  perform public._play_check_token(p_token);
  if char_length(coalesce(p_owner_key, '')) < 32 then raise exception 'forbidden'; end if;
  if p_slug is null then
    if (select count(*) from public.personas where owner_key_hash = v_hash) >= 25 then
      raise exception 'you can keep up to 25 personas';
    end if;
    insert into public.personas(owner_id, owner_key_hash, name, tagline, description, greeting, language, voice, rate, visibility, accent)
    values (null, v_hash, p_name, coalesce(p_tagline, ''), p_description, coalesce(p_greeting, ''), p_language, p_voice, coalesce(p_rate, '+0%'), p_visibility, coalesce(p_accent, 'saffron'))
    returning share_slug into v_slug;
  else
    update public.personas set name = p_name, tagline = coalesce(p_tagline, ''), description = p_description,
      greeting = coalesce(p_greeting, ''), language = p_language, voice = p_voice, rate = coalesce(p_rate, '+0%'),
      visibility = p_visibility, accent = coalesce(p_accent, accent)
    where share_slug = p_slug and owner_key_hash = v_hash
    returning share_slug into v_slug;
    if v_slug is null then raise exception 'persona not found'; end if;
  end if;
  return v_slug;
end $$;
revoke all on function public.play_save_persona(text, text, text, text, text, text, text, text, text, text, text, text) from public;
grant execute on function public.play_save_persona(text, text, text, text, text, text, text, text, text, text, text, text) to anon, authenticated;

create or replace function public.play_my_personas(p_token text, p_owner_key text)
returns table (share_slug text, name text, tagline text, description text, greeting text, language text, voice text, rate text, visibility text, accent text, call_count int, updated_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  perform public._play_check_token(p_token);
  return query select p.share_slug, p.name, p.tagline, p.description, p.greeting, p.language, p.voice, p.rate, p.visibility, p.accent, p.call_count, p.updated_at
  from public.personas p where p.owner_key_hash = public._key_hash(p_owner_key) order by p.updated_at desc;
end $$;
revoke all on function public.play_my_personas(text, text) from public;
grant execute on function public.play_my_personas(text, text) to anon, authenticated;

create or replace function public.play_delete_persona(p_token text, p_owner_key text, p_slug text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  perform public._play_check_token(p_token);
  delete from public.personas where share_slug = p_slug and owner_key_hash = public._key_hash(p_owner_key);
end $$;
revoke all on function public.play_delete_persona(text, text, text) from public;
grant execute on function public.play_delete_persona(text, text, text) to anon, authenticated;
