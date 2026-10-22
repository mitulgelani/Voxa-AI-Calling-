-- VaniDial core schema. Every table has RLS enabled and denies by default.
-- Money is integer minor units (paise / cents). Times are timestamptz (UTC).

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------
-- Types
-- ---------------------------------------------------------------------------
create type public.org_role as enum ('viewer', 'reviewer', 'operator', 'admin', 'owner');
create type public.campaign_status as enum ('draft', 'running', 'paused', 'completed', 'cancelled');
create type public.campaign_purpose as enum ('service', 'promotional');
create type public.carrier as enum ('plivo', 'telnyx', 'sandbox');
create type public.call_status as enum ('queued', 'dialing', 'ringing', 'in_progress', 'completed', 'failed');
create type public.call_outcome as enum (
  'completed', 'partial', 'no_answer', 'busy', 'voicemail', 'failed', 'opted_out', 'callback', 'transferred', 'hung_up_early'
);
create type public.answer_type as enum ('rating', 'yes_no', 'choice', 'text', 'number', 'date');
create type public.review_state as enum ('auto', 'needs_review', 'corrected', 'confirmed');
create type public.job_state as enum ('pending', 'claimed', 'done', 'skipped', 'cancelled');

-- ---------------------------------------------------------------------------
-- Organisations and membership
-- ---------------------------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 80),
  country text not null default 'IN' check (country in ('IN', 'US', 'CA')),
  timezone text not null default 'Asia/Kolkata',
  recording_retention_days int not null default 180 check (recording_retention_days between 7 and 3650),
  created_at timestamptz not null default now()
);

create table public.memberships (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'viewer',
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);
create index memberships_user_idx on public.memberships(user_id);

-- Role lookup used by every policy. Security definer so it can read memberships
-- without recursive RLS; returns null when the caller is not a member.
create or replace function public.org_role(p_org uuid)
returns public.org_role
language sql stable security definer set search_path = ''
as $$
  select m.role from public.memberships m
  where m.org_id = p_org and m.user_id = (select auth.uid())
$$;

create or replace function public.has_role(p_org uuid, p_min public.org_role)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce(public.org_role(p_org) >= p_min, false)
$$;

revoke all on function public.org_role(uuid) from public, anon;
revoke all on function public.has_role(uuid, public.org_role) from public, anon;
grant execute on function public.org_role(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.org_role) to authenticated;

-- Create an org and make the caller its owner, atomically.
create or replace function public.create_organization(p_name text, p_country text default 'IN')
returns uuid
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_uid uuid := (select auth.uid());
begin
  if v_uid is null then raise exception 'not signed in'; end if;
  if exists (select 1 from auth.users u where u.id = v_uid and u.is_anonymous) then
    raise exception 'create an account before creating an organisation';
  end if;
  insert into public.organizations(name, country, timezone)
  values (trim(p_name), p_country, case when p_country = 'IN' then 'Asia/Kolkata' else 'America/New_York' end)
  returning id into v_id;
  insert into public.memberships(org_id, user_id, role) values (v_id, v_uid, 'owner');
  return v_id;
end $$;
revoke all on function public.create_organization(text, text) from public, anon;
grant execute on function public.create_organization(text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- Audit log: append-only for everyone, including the service role via trigger.
-- ---------------------------------------------------------------------------
create table public.audit_log (
  id bigint generated always as identity primary key,
  org_id uuid references public.organizations(id) on delete set null,
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id text,
  detail jsonb not null default '{}'::jsonb,
  at timestamptz not null default now()
);
create index audit_log_org_at_idx on public.audit_log(org_id, at desc);

create or replace function public.audit_log_immutable()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'audit_log is append-only';
end $$;
create trigger audit_log_no_update before update or delete on public.audit_log
  for each row execute function public.audit_log_immutable();

create or replace function public.write_audit(p_org uuid, p_action text, p_entity text, p_entity_id text, p_detail jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.audit_log(org_id, actor_id, action, entity, entity_id, detail)
  values (p_org, (select auth.uid()), p_action, p_entity, p_entity_id, coalesce(p_detail, '{}'::jsonb))
$$;
revoke all on function public.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Agents and immutable versions
-- ---------------------------------------------------------------------------
create table public.agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  description text not null default '' check (char_length(description) <= 500),
  current_version_id uuid,
  archived_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index agents_org_idx on public.agents(org_id);

-- The locked disclosure is enforced here, not in the UI: a version without it cannot exist.
create table public.agent_versions (
  id uuid primary key default gen_random_uuid(),
  agent_id uuid not null references public.agents(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  version int not null,
  opening_line text not null check (char_length(opening_line) between 10 and 400),
  disclosure_line text not null check (char_length(disclosure_line) between 10 and 200),
  goal text not null check (char_length(goal) between 5 and 1000),
  persona text not null default '' check (char_length(persona) <= 2000),
  questions jsonb not null default '[]'::jsonb check (jsonb_typeof(questions) = 'array' and jsonb_array_length(questions) <= 25),
  languages text[] not null default array['hi-IN']::text[] check (cardinality(languages) between 1 and 6),
  voice jsonb not null default '{}'::jsonb,
  approved_at timestamptz,
  approved_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  unique (agent_id, version),
  check (disclosure_line ~* '(AI|automated|स्वचालित|एआई|ઓટોમેટેડ|એઆઈ)')
);

create or replace function public.agent_versions_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'agent versions cannot be deleted'; end if;
  -- Only the approval stamp may be set, once.
  if (new.opening_line, new.disclosure_line, new.goal, new.persona, new.questions, new.languages, new.voice, new.version, new.agent_id)
     is distinct from
     (old.opening_line, old.disclosure_line, old.goal, old.persona, old.questions, old.languages, old.voice, old.version, old.agent_id) then
    raise exception 'agent versions are immutable; create a new version';
  end if;
  if old.approved_at is not null and new.approved_at is distinct from old.approved_at then
    raise exception 'approval is final';
  end if;
  return new;
end $$;
create trigger agent_versions_immutable before update or delete on public.agent_versions
  for each row execute function public.agent_versions_guard();

alter table public.agents add constraint agents_current_version_fk
  foreign key (current_version_id) references public.agent_versions(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Numbers, contacts, consent, do-not-call
-- ---------------------------------------------------------------------------
create table public.phone_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  label text not null default '',
  country text not null check (country in ('IN', 'US', 'CA')),
  carrier public.carrier not null,
  carrier_ref text,
  purpose public.campaign_purpose not null,
  dlt_header text,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  unique (org_id, e164)
);

create table public.contact_lists (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  source text not null default 'csv' check (source in ('csv', 'api', 'crm')),
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.contacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  list_id uuid not null references public.contact_lists(id) on delete cascade,
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  name text not null default '' check (char_length(name) <= 120),
  language text,
  timezone text,
  consent_source text check (consent_source is null or char_length(consent_source) <= 200),
  consent_at timestamptz,
  attrs jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (list_id, e164)
);
create index contacts_org_e164_idx on public.contacts(org_id, e164);

create table public.dnc_entries (
  org_id uuid not null references public.organizations(id) on delete cascade,
  e164 text not null check (e164 ~ '^\+[1-9][0-9]{6,14}$'),
  reason text not null default 'opt_out' check (reason in ('opt_out', 'complaint', 'manual', 'legal')),
  source_call_id uuid,
  created_at timestamptz not null default now(),
  primary key (org_id, e164)
);

create table public.dnd_scrubs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  list_id uuid not null references public.contact_lists(id) on delete cascade,
  provider text not null,
  checked_count int not null default 0,
  removed_count int not null default 0,
  scrubbed_at timestamptz not null default now()
);
create index dnd_scrubs_list_idx on public.dnd_scrubs(list_id, scrubbed_at desc);

-- ---------------------------------------------------------------------------
-- Campaigns, jobs, calls, transcript, answers, review
-- ---------------------------------------------------------------------------
create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  status public.campaign_status not null default 'draft',
  purpose public.campaign_purpose,
  agent_version_id uuid references public.agent_versions(id),
  phone_number_id uuid references public.phone_numbers(id),
  list_id uuid references public.contact_lists(id),
  window_start time not null default '09:00',
  window_end time not null default '21:00',
  days smallint[] not null default array[1,2,3,4,5,6]::smallint[],
  max_concurrent int not null default 10 check (max_concurrent between 1 and 200),
  dials_per_minute int not null default 20 check (dials_per_minute between 1 and 600),
  max_attempts int not null default 3 check (max_attempts between 1 and 6),
  retry_after_minutes int not null default 120 check (retry_after_minutes between 15 and 4320),
  budget_cap_minor bigint not null default 500000 check (budget_cap_minor > 0),
  currency text not null default 'INR' check (currency in ('INR', 'USD')),
  spent_minor bigint not null default 0,
  frozen_at timestamptz,
  frozen_config jsonb,
  launched_by uuid,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (window_start < window_end)
);
create index campaigns_org_idx on public.campaigns(org_id, created_at desc);

create or replace function public.campaigns_freeze_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.frozen_at is not null and (
     new.agent_version_id, new.phone_number_id, new.list_id, new.purpose, new.window_start, new.window_end, new.days,
     new.max_attempts, new.budget_cap_minor, new.frozen_config, new.frozen_at
  ) is distinct from (
     old.agent_version_id, old.phone_number_id, old.list_id, old.purpose, old.window_start, old.window_end, old.days,
     old.max_attempts, old.budget_cap_minor, old.frozen_config, old.frozen_at
  ) then
    raise exception 'campaign configuration is frozen after launch';
  end if;
  -- status can only move draft→running through launch_campaign()
  if old.status = 'draft' and new.status = 'running' and new.frozen_at is null then
    raise exception 'use launch_campaign() to start a campaign';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger campaigns_frozen before update on public.campaigns
  for each row execute function public.campaigns_freeze_guard();

create table public.call_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  contact_id uuid not null references public.contacts(id) on delete cascade,
  attempt int not null default 1,
  due_at timestamptz not null default now(),
  state public.job_state not null default 'pending',
  claimed_at timestamptz,
  skip_reason text,
  unique (campaign_id, contact_id, attempt)
);
create index call_jobs_due_idx on public.call_jobs(state, due_at) where state = 'pending';

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid references public.campaigns(id) on delete set null,
  contact_id uuid references public.contacts(id) on delete set null,
  job_id uuid references public.call_jobs(id) on delete set null,
  to_e164 text not null check (to_e164 ~ '^\+[1-9][0-9]{6,14}$'),
  from_e164 text,
  carrier public.carrier not null,
  carrier_call_id text,
  status public.call_status not null default 'queued',
  outcome public.call_outcome,
  language_detected text,
  started_at timestamptz,
  answered_at timestamptz,
  ended_at timestamptz,
  duration_ms int,
  recording_path text,
  cost_minor bigint not null default 0,
  metrics jsonb not null default '{}'::jsonb,
  needs_review boolean not null default false,
  created_at timestamptz not null default now()
);
create index calls_org_created_idx on public.calls(org_id, created_at desc);
create index calls_campaign_idx on public.calls(campaign_id);
create unique index calls_carrier_ref_idx on public.calls(carrier, carrier_call_id) where carrier_call_id is not null;

-- No call can ever be placed to a number on the org's do-not-call list.
create or replace function public.calls_dnc_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if exists (select 1 from public.dnc_entries d where d.org_id = new.org_id and d.e164 = new.to_e164) then
    raise exception 'number is on the do-not-call list';
  end if;
  return new;
end $$;
create trigger calls_dnc before insert on public.calls
  for each row execute function public.calls_dnc_guard();

create table public.call_turns (
  id bigint generated always as identity primary key,
  call_id uuid not null references public.calls(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  seq int not null,
  speaker text not null check (speaker in ('agent', 'customer')),
  text text not null,
  lang text,
  start_ms int not null,
  end_ms int not null,
  interrupted boolean not null default false,
  unique (call_id, seq)
);

create table public.answers (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  question_key text not null,
  type public.answer_type not null,
  value jsonb,
  confidence real not null check (confidence between 0 and 1),
  evidence_start_ms int,
  evidence_end_ms int,
  review_state public.review_state not null default 'auto',
  original_value jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (call_id, question_key),
  check (evidence_end_ms is null or evidence_end_ms >= evidence_start_ms)
);

create table public.review_tasks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  call_id uuid not null references public.calls(id) on delete cascade,
  reason text not null,
  state text not null default 'open' check (state in ('open', 'done', 'skipped')),
  assigned_to uuid,
  done_by uuid,
  done_at timestamptz,
  created_at timestamptz not null default now(),
  unique (call_id)
);

create table public.usage_events (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  call_id uuid references public.calls(id) on delete set null,
  kind text not null check (kind in ('telephony', 'stt', 'tts', 'llm', 'storage', 'review')),
  quantity numeric not null,
  unit text not null,
  cost_minor bigint not null,
  provider text not null,
  at timestamptz not null default now()
);
create index usage_events_org_at_idx on public.usage_events(org_id, at desc);

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array['calls:read']::text[],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.webhook_endpoints (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  url text not null check (url ~ '^https://'),
  events text[] not null default array['call.completed']::text[],
  secret_hash text not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Compliance gate: six checks, computed live. The Launch button and the
-- launch function read the same source.
-- ---------------------------------------------------------------------------
create or replace function public.campaign_checks(p_campaign uuid)
returns table (key text, ok boolean, message text)
language plpgsql stable security definer set search_path = ''
as $$
declare
  c public.campaigns;
  n public.phone_numbers;
  v public.agent_versions;
  total int; consented int; fresh_scrub boolean;
begin
  select * into c from public.campaigns where id = p_campaign;
  if c.id is null or not public.has_role(c.org_id, 'viewer') then
    raise exception 'campaign not found';
  end if;
  select * into n from public.phone_numbers where id = c.phone_number_id;
  select * into v from public.agent_versions where id = c.agent_version_id;
  select count(*), count(*) filter (where consent_source is not null and consent_at is not null)
    into total, consented from public.contacts where list_id = c.list_id;
  select exists (select 1 from public.dnd_scrubs s where s.list_id = c.list_id and s.scrubbed_at > now() - interval '24 hours')
    into fresh_scrub;

  key := 'purpose'; ok := c.purpose is not null;
  message := case when ok then 'Purpose: ' || c.purpose::text else 'Choose whether this campaign is service or promotional.' end;
  return next;

  key := 'caller_id';
  ok := n.id is not null and n.verified_at is not null and n.purpose = c.purpose
        and (n.country <> 'IN' or n.dlt_header is not null);
  message := case
    when n.id is null then 'Pick a caller ID.'
    when n.verified_at is null then 'The caller ID ' || n.e164 || ' is not verified yet.'
    when n.purpose is distinct from c.purpose then 'This number is registered for ' || n.purpose::text || ' calls, not ' || coalesce(c.purpose::text, 'this purpose') || '.'
    when n.country = 'IN' and n.dlt_header is null then 'Add the DLT header for ' || n.e164 || '.'
    else 'Caller ID ' || n.e164 || ' verified.' end;
  return next;

  key := 'consent'; ok := c.list_id is not null and total > 0 and consented > 0;
  message := case
    when c.list_id is null then 'Attach a contact list.'
    when total = 0 then 'The contact list is empty.'
    when consented = 0 then 'No contact in this list has consent evidence.'
    when consented < total then consented || ' of ' || total || ' contacts have consent; the other ' || (total - consented) || ' will be skipped.'
    else 'All ' || total || ' contacts have consent evidence.' end;
  return next;

  key := 'dnd_scrub'; ok := c.list_id is not null and (n.country is distinct from 'IN' or fresh_scrub);
  message := case when ok then 'DND scrub is less than 24 hours old.' else 'Run a DND scrub on this list (the last one is older than 24 hours).' end;
  return next;

  key := 'script'; ok := v.id is not null and v.approved_at is not null;
  message := case when v.id is null then 'Pick an agent version.' when v.approved_at is null then 'An admin needs to approve this agent version.' else 'Script v' || v.version || ' approved.' end;
  return next;

  key := 'window';
  ok := (n.country is distinct from 'IN' or (c.window_start >= '09:00' and c.window_end <= '21:00'))
        and (n.country not in ('US', 'CA') or (c.window_start >= '08:00' and c.window_end <= '21:00'))
        and cardinality(c.days) > 0;
  message := case when ok then 'Calls between ' || left(c.window_start::text, 5) || '–' || left(c.window_end::text, 5) || ' in each contact''s timezone.'
                  else 'The calling window must be inside the legal hours (India 09:00–21:00, US 08:00–21:00).' end;
  return next;
end $$;
revoke all on function public.campaign_checks(uuid) from public, anon;
grant execute on function public.campaign_checks(uuid) to authenticated;

create or replace function public.launch_campaign(p_campaign uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare c public.campaigns; failed text;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if c.id is null or not public.has_role(c.org_id, 'admin') then
    raise exception 'only an admin can launch campaigns';
  end if;
  if c.status <> 'draft' then raise exception 'campaign is not a draft'; end if;
  select string_agg(message, ' ') into failed from public.campaign_checks(p_campaign) where not ok;
  if failed is not null then raise exception 'launch blocked: %', failed; end if;

  update public.campaigns set
    status = 'running',
    frozen_at = now(),
    launched_by = (select auth.uid()),
    frozen_config = jsonb_build_object(
      'agent_version_id', agent_version_id, 'phone_number_id', phone_number_id, 'list_id', list_id,
      'purpose', purpose, 'window', jsonb_build_array(window_start, window_end), 'days', days,
      'max_concurrent', max_concurrent, 'dials_per_minute', dials_per_minute,
      'max_attempts', max_attempts, 'budget_cap_minor', budget_cap_minor)
  where id = p_campaign;

  insert into public.call_jobs(org_id, campaign_id, contact_id)
  select c.org_id, c.id, ct.id from public.contacts ct
  where ct.list_id = c.list_id and ct.consent_source is not null and ct.consent_at is not null
    and not exists (select 1 from public.dnc_entries d where d.org_id = c.org_id and d.e164 = ct.e164);

  perform public.write_audit(c.org_id, 'campaign.launch', 'campaign', c.id::text,
    jsonb_build_object('checks', (select jsonb_agg(to_jsonb(x)) from public.campaign_checks(p_campaign) x)));
end $$;
revoke all on function public.launch_campaign(uuid) from public, anon;
grant execute on function public.launch_campaign(uuid) to authenticated;

-- Opt-outs: any reviewer+ (and the gateway with service role) can add; nobody in the app can remove.
create or replace function public.add_to_dnc(p_org uuid, p_e164 text, p_reason text default 'manual')
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not public.has_role(p_org, 'reviewer') then raise exception 'not allowed'; end if;
  insert into public.dnc_entries(org_id, e164, reason) values (p_org, p_e164, p_reason) on conflict do nothing;
  update public.call_jobs j set state = 'cancelled', skip_reason = 'dnc'
    from public.contacts ct where j.contact_id = ct.id and ct.org_id = p_org and ct.e164 = p_e164 and j.state = 'pending';
  perform public.write_audit(p_org, 'dnc.add', 'dnc', null, jsonb_build_object('e164_hash', encode(extensions.digest(p_e164, 'sha256'), 'hex'), 'reason', p_reason));
end $$;
revoke all on function public.add_to_dnc(uuid, text, text) from public, anon;
grant execute on function public.add_to_dnc(uuid, text, text) to authenticated;

-- Dialler claim (service role only). Re-checks every rule at the moment of dialling.
create or replace function public.claim_call_jobs(p_limit int default 5)
returns setof public.call_jobs
language plpgsql security definer set search_path = ''
as $$
begin
  return query
  with due as (
    select j.id from public.call_jobs j
    join public.campaigns c on c.id = j.campaign_id and c.status = 'running'
    join public.contacts ct on ct.id = j.contact_id
    where j.state = 'pending' and j.due_at <= now()
      and c.spent_minor < c.budget_cap_minor
      and not exists (select 1 from public.dnc_entries d where d.org_id = j.org_id and d.e164 = ct.e164)
      -- global frequency cap: no answered call to this number in 7 days from this org
      and not exists (select 1 from public.calls x where x.org_id = j.org_id and x.to_e164 = ct.e164
                      and x.answered_at > now() - interval '7 days')
      and (now() at time zone coalesce(ct.timezone, (select o.timezone from public.organizations o where o.id = j.org_id)))::time
          between c.window_start and c.window_end
    order by j.due_at
    limit p_limit
    for update of j skip locked
  )
  update public.call_jobs j set state = 'claimed', claimed_at = now()
  from due where j.id = due.id
  returning j.*;
end $$;
revoke all on function public.claim_call_jobs(int) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.organizations enable row level security;
alter table public.memberships enable row level security;
alter table public.audit_log enable row level security;
alter table public.agents enable row level security;
alter table public.agent_versions enable row level security;
alter table public.phone_numbers enable row level security;
alter table public.contact_lists enable row level security;
alter table public.contacts enable row level security;
alter table public.dnc_entries enable row level security;
alter table public.dnd_scrubs enable row level security;
alter table public.campaigns enable row level security;
alter table public.call_jobs enable row level security;
alter table public.calls enable row level security;
alter table public.call_turns enable row level security;
alter table public.answers enable row level security;
alter table public.review_tasks enable row level security;
alter table public.usage_events enable row level security;
alter table public.api_keys enable row level security;
alter table public.webhook_endpoints enable row level security;

create policy org_read on public.organizations for select to authenticated using (public.has_role(id, 'viewer'));
create policy org_update on public.organizations for update to authenticated using (public.has_role(id, 'admin')) with check (public.has_role(id, 'admin'));

create policy mem_read on public.memberships for select to authenticated using (public.has_role(org_id, 'viewer'));
create policy mem_admin_insert on public.memberships for insert to authenticated with check (public.has_role(org_id, 'admin') and role <> 'owner');
create policy mem_admin_update on public.memberships for update to authenticated
  using (public.has_role(org_id, 'admin') and role <> 'owner') with check (public.has_role(org_id, 'admin') and role <> 'owner');
create policy mem_admin_delete on public.memberships for delete to authenticated using (public.has_role(org_id, 'admin') and role <> 'owner');

create policy audit_read on public.audit_log for select to authenticated using (public.has_role(org_id, 'admin'));

-- Read for every member; write for operators (config) or admins (numbers, keys).
do $$
declare t text;
begin
  foreach t in array array['agents', 'contact_lists', 'contacts', 'campaigns'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.has_role(org_id, ''viewer''))', t);
    execute format('create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_role(org_id, ''operator''))', t);
    execute format('create policy %1$s_update on public.%1$s for update to authenticated using (public.has_role(org_id, ''operator'')) with check (public.has_role(org_id, ''operator''))', t);
    execute format('create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_role(org_id, ''admin''))', t);
  end loop;
  foreach t in array array['calls', 'call_turns', 'dnd_scrubs', 'call_jobs', 'usage_events'] loop
    execute format('create policy %1$s_read on public.%1$s for select to authenticated using (public.has_role(org_id, ''viewer''))', t);
  end loop;
end $$;

create policy av_read on public.agent_versions for select to authenticated using (public.has_role(org_id, 'viewer'));
create policy av_insert on public.agent_versions for insert to authenticated with check (public.has_role(org_id, 'operator') and approved_at is null);
-- Approval is the only permitted update, and only by admins (the trigger blocks everything else).
create policy av_approve on public.agent_versions for update to authenticated using (public.has_role(org_id, 'admin')) with check (public.has_role(org_id, 'admin'));

create policy num_read on public.phone_numbers for select to authenticated using (public.has_role(org_id, 'viewer'));
create policy num_write on public.phone_numbers for all to authenticated using (public.has_role(org_id, 'admin')) with check (public.has_role(org_id, 'admin'));

create policy dnc_read on public.dnc_entries for select to authenticated using (public.has_role(org_id, 'reviewer'));
-- inserts go through add_to_dnc(); no update or delete policy exists for app users.

create policy ans_read on public.answers for select to authenticated using (public.has_role(org_id, 'viewer'));
create policy ans_review on public.answers for update to authenticated using (public.has_role(org_id, 'reviewer')) with check (public.has_role(org_id, 'reviewer'));

create policy rt_read on public.review_tasks for select to authenticated using (public.has_role(org_id, 'reviewer'));
create policy rt_update on public.review_tasks for update to authenticated using (public.has_role(org_id, 'reviewer')) with check (public.has_role(org_id, 'reviewer'));

create policy key_read on public.api_keys for select to authenticated using (public.has_role(org_id, 'admin'));
create policy key_write on public.api_keys for all to authenticated using (public.has_role(org_id, 'admin')) with check (public.has_role(org_id, 'admin'));
create policy wh_rw on public.webhook_endpoints for all to authenticated using (public.has_role(org_id, 'admin')) with check (public.has_role(org_id, 'admin'));

-- Reviewers may only change review fields of an answer.
create or replace function public.answers_review_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then return new; end if;
  if (new.call_id, new.org_id, new.question_key, new.type, new.confidence, new.evidence_start_ms, new.evidence_end_ms)
     is distinct from (old.call_id, old.org_id, old.question_key, old.type, old.confidence, old.evidence_start_ms, old.evidence_end_ms) then
    raise exception 'only the value and review state of an answer can be changed';
  end if;
  if new.value is distinct from old.value and old.original_value is null then
    new.original_value := old.value;
  end if;
  new.reviewed_by := (select auth.uid());
  new.reviewed_at := now();
  return new;
end $$;
create trigger answers_review before update on public.answers
  for each row execute function public.answers_review_guard();

-- Recordings bucket: private; members read via signed URLs created server-side.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('recordings', 'recordings', false, 52428800, array['audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/webm'])
on conflict (id) do nothing;

create policy recordings_read on storage.objects for select to authenticated
  using (bucket_id = 'recordings' and public.has_role(((storage.foldername(name))[1])::uuid, 'viewer'));
