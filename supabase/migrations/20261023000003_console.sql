-- VaniDial console support: tightened grants, workflow RPCs, invites, audit triggers.
-- Principle: every state change that matters for compliance goes through one audited function,
-- and the tables refuse the shortcuts (triggers), so a bug in the app cannot skip a rule.

-- ---------------------------------------------------------------------------
-- 1. Grants: write_audit is internal (definer functions call it as owner).
-- ---------------------------------------------------------------------------
revoke all on function public.write_audit(uuid, text, text, text, jsonb) from public, anon, authenticated;
revoke all on function public.org_role(uuid) from public, anon;
revoke all on function public.has_role(uuid, public.org_role) from public, anon;
grant execute on function public.org_role(uuid) to authenticated;
grant execute on function public.has_role(uuid, public.org_role) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. Generic audit trigger for configuration tables (never copies secrets).
-- ---------------------------------------------------------------------------
create or replace function public.audit_row()
returns trigger language plpgsql security definer set search_path = '' as $$
declare r record; v_org uuid; v_id text; v_detail jsonb := '{}'::jsonb;
begin
  if tg_op = 'DELETE' then r := old; else r := new; end if;
  v_org := (to_jsonb(r) ->> 'org_id')::uuid;
  v_id := coalesce(to_jsonb(r) ->> 'id', to_jsonb(r) ->> 'user_id');
  if tg_table_name = 'memberships' then
    v_detail := jsonb_build_object('role', to_jsonb(r) ->> 'role');
  elsif tg_table_name = 'phone_numbers' then
    v_detail := jsonb_build_object('e164', to_jsonb(r) ->> 'e164', 'purpose', to_jsonb(r) ->> 'purpose', 'carrier', to_jsonb(r) ->> 'carrier');
  elsif tg_table_name = 'api_keys' then
    v_detail := jsonb_build_object('name', to_jsonb(r) ->> 'name', 'prefix', to_jsonb(r) ->> 'prefix', 'revoked', (to_jsonb(r) ->> 'revoked_at') is not null);
  elsif tg_table_name = 'webhook_endpoints' then
    v_detail := jsonb_build_object('url', to_jsonb(r) ->> 'url', 'active', to_jsonb(r) ->> 'active');
  elsif tg_table_name = 'campaigns' then
    v_detail := jsonb_build_object('name', to_jsonb(r) ->> 'name', 'status', to_jsonb(r) ->> 'status');
  elsif tg_table_name = 'contact_lists' then
    v_detail := jsonb_build_object('name', to_jsonb(r) ->> 'name');
  elsif tg_table_name = 'organizations' then
    v_org := (to_jsonb(r) ->> 'id')::uuid;
    v_detail := jsonb_build_object('name', to_jsonb(r) ->> 'name', 'retention_days', to_jsonb(r) ->> 'recording_retention_days');
  end if;
  insert into public.audit_log(org_id, actor_id, action, entity, entity_id, detail)
  values (v_org, (select auth.uid()), tg_table_name || '.' || lower(tg_op), tg_table_name, v_id, v_detail);
  return null;
end $$;
revoke all on function public.audit_row() from public, anon, authenticated;

do $$
declare t text;
begin
  foreach t in array array['memberships', 'phone_numbers', 'api_keys', 'webhook_endpoints', 'contact_lists', 'organizations'] loop
    execute format('create trigger %1$s_audit after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;
create trigger campaigns_audit after insert or delete on public.campaigns for each row execute function public.audit_row();

-- ---------------------------------------------------------------------------
-- 3. Phone numbers: verification is set only by the voice gateway (service role),
--    after it finds the number in the org's Plivo/Telnyx account.
-- ---------------------------------------------------------------------------
create or replace function public.phone_numbers_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (select auth.role()) = 'service_role' then return new; end if;
  if tg_op = 'INSERT' then
    new.verified_at := null;
  else
    new.verified_at := case when (new.e164, new.carrier, new.carrier_ref, new.country) is distinct from (old.e164, old.carrier, old.carrier_ref, old.country)
                            then null else old.verified_at end;
  end if;
  if new.country = 'IN' and new.carrier not in ('plivo', 'sandbox') then raise exception 'Indian numbers are connected through Plivo'; end if;
  if new.country in ('US', 'CA') and new.carrier not in ('telnyx', 'sandbox') then raise exception 'US and Canadian numbers are connected through Telnyx'; end if;
  return new;
end $$;
create trigger phone_numbers_guard before insert or update on public.phone_numbers
  for each row execute function public.phone_numbers_guard();

-- API keys: a revoked key stays revoked; the hash never changes.
create or replace function public.api_keys_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.key_hash is distinct from old.key_hash or new.prefix is distinct from old.prefix then raise exception 'keys cannot be edited; create a new one'; end if;
  if old.revoked_at is not null and new.revoked_at is distinct from old.revoked_at then raise exception 'a revoked key cannot be restored'; end if;
  return new;
end $$;
create trigger api_keys_guard before update on public.api_keys for each row execute function public.api_keys_guard();

-- ---------------------------------------------------------------------------
-- 4. Agents: versions are created and approved only through these functions.
-- ---------------------------------------------------------------------------
create or replace function public.create_agent_version(
  p_agent uuid, p_opening text, p_disclosure text, p_goal text, p_persona text,
  p_questions jsonb, p_languages text[], p_voice jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare a public.agents; v_id uuid; v_next int;
begin
  select * into a from public.agents where id = p_agent for update;
  if a.id is null or not public.has_role(a.org_id, 'operator') then raise exception 'agent not found'; end if;
  if a.archived_at is not null then raise exception 'this agent is archived'; end if;
  if jsonb_typeof(p_questions) <> 'array' or exists (
    select 1 from jsonb_array_elements(p_questions) q
    where coalesce(q ->> 'key', '') !~ '^[a-z][a-z0-9_]{1,39}$'
       or coalesce(q ->> 'type', '') not in ('rating', 'yes_no', 'choice', 'text', 'number', 'date')
       or char_length(coalesce(q ->> 'prompt', '')) not between 3 and 300) then
    raise exception 'each question needs a key (lowercase, underscores), a type and a prompt';
  end if;
  if exists (select 1 from unnest(p_languages) l where l not in ('hinglish', 'hi-IN', 'gu-IN', 'en-IN', 'en-US', 'mr-IN', 'ta-IN', 'te-IN', 'bn-IN', 'kn-IN', 'ml-IN', 'pa-IN')) then
    raise exception 'unsupported language';
  end if;
  select coalesce(max(version), 0) + 1 into v_next from public.agent_versions where agent_id = p_agent;
  insert into public.agent_versions(agent_id, org_id, version, opening_line, disclosure_line, goal, persona, questions, languages, voice)
  values (p_agent, a.org_id, v_next, trim(p_opening), trim(p_disclosure), trim(p_goal), coalesce(trim(p_persona), ''), p_questions, p_languages, coalesce(p_voice, '{}'::jsonb))
  returning id into v_id;
  update public.agents set updated_at = now() where id = p_agent;
  perform public.write_audit(a.org_id, 'agent.version_created', 'agent_version', v_id::text, jsonb_build_object('agent_id', p_agent, 'version', v_next));
  return v_id;
end $$;
revoke all on function public.create_agent_version(uuid, text, text, text, text, jsonb, text[], jsonb) from public, anon;
grant execute on function public.create_agent_version(uuid, text, text, text, text, jsonb, text[], jsonb) to authenticated;

-- Four-eyes: when the org has another admin, the author cannot approve their own script.
create or replace function public.approve_agent_version(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare v public.agent_versions; v_uid uuid := (select auth.uid()); other_admins int;
begin
  select * into v from public.agent_versions where id = p_version for update;
  if v.id is null or not public.has_role(v.org_id, 'admin') then raise exception 'only an admin can approve scripts'; end if;
  if v.approved_at is not null then raise exception 'this version is already approved'; end if;
  select count(*) into other_admins from public.memberships m
   where m.org_id = v.org_id and m.role >= 'admin' and m.user_id <> v_uid;
  if v.created_by = v_uid and other_admins > 0 then
    raise exception 'another admin must approve a script you wrote';
  end if;
  update public.agent_versions set approved_at = now(), approved_by = v_uid where id = p_version;
  update public.agents set current_version_id = p_version, updated_at = now() where id = v.agent_id;
  perform public.write_audit(v.org_id, 'agent.version_approved', 'agent_version', p_version::text,
    jsonb_build_object('agent_id', v.agent_id, 'version', v.version, 'disclosure_line', v.disclosure_line));
end $$;
revoke all on function public.approve_agent_version(uuid) from public, anon;
grant execute on function public.approve_agent_version(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. Campaign status: only legal transitions; cancelling cancels queued work.
-- ---------------------------------------------------------------------------
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
  if new.status is distinct from old.status and not (
       (old.status = 'draft' and new.status = 'running' and new.frozen_at is not null)
    or (old.status = 'draft' and new.status = 'cancelled')
    or (old.status = 'running' and new.status in ('paused', 'completed', 'cancelled'))
    or (old.status = 'paused' and new.status in ('running', 'cancelled'))
  ) then
    raise exception 'a % campaign cannot become %', old.status, new.status;
  end if;
  if (select auth.role()) <> 'service_role' and new.spent_minor is distinct from old.spent_minor then
    raise exception 'spend is recorded by the dialler';
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.set_campaign_status(p_campaign uuid, p_status public.campaign_status)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.campaigns;
begin
  select * into c from public.campaigns where id = p_campaign for update;
  if c.id is null or not public.has_role(c.org_id, 'operator') then raise exception 'campaign not found'; end if;
  if p_status = 'running' and c.status = 'draft' then raise exception 'use launch to start a campaign'; end if;
  update public.campaigns set status = p_status where id = p_campaign;
  if p_status in ('cancelled', 'completed') then
    update public.call_jobs set state = 'cancelled', skip_reason = 'campaign_' || p_status::text
     where campaign_id = p_campaign and state = 'pending';
  end if;
  perform public.write_audit(c.org_id, 'campaign.' || p_status::text, 'campaign', p_campaign::text,
    jsonb_build_object('from', c.status, 'to', p_status));
end $$;
revoke all on function public.set_campaign_status(uuid, public.campaign_status) from public, anon;
grant execute on function public.set_campaign_status(uuid, public.campaign_status) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. DND scrub (India). The operator scrubs the list with their DLT/NCPR provider and
--    uploads the numbers the provider flagged; we remove them and stamp the scrub.
-- ---------------------------------------------------------------------------
create or replace function public.record_dnd_scrub(p_list uuid, p_provider text, p_flagged text[])
returns int language plpgsql security definer set search_path = '' as $$
declare l public.contact_lists; v_checked int; v_removed int;
begin
  select * into l from public.contact_lists where id = p_list;
  if l.id is null or not public.has_role(l.org_id, 'operator') then raise exception 'list not found'; end if;
  if char_length(coalesce(trim(p_provider), '')) not between 2 and 80 then raise exception 'name the provider that ran the scrub'; end if;
  select count(*) into v_checked from public.contacts where list_id = p_list;
  with gone as (
    delete from public.contacts where list_id = p_list and e164 = any(coalesce(p_flagged, array[]::text[])) returning 1
  ) select count(*) into v_removed from gone;
  insert into public.dnd_scrubs(org_id, list_id, provider, checked_count, removed_count)
  values (l.org_id, p_list, trim(p_provider), v_checked, v_removed);
  perform public.write_audit(l.org_id, 'list.dnd_scrub', 'contact_list', p_list::text,
    jsonb_build_object('provider', trim(p_provider), 'checked', v_checked, 'removed', v_removed));
  return v_removed;
end $$;
revoke all on function public.record_dnd_scrub(uuid, text, text[]) from public, anon;
grant execute on function public.record_dnd_scrub(uuid, text, text[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 7. Review: finishing a call's review confirms whatever the reviewer did not change.
-- ---------------------------------------------------------------------------
create or replace function public.finish_review(p_call uuid, p_skip boolean default false)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.calls; v_corrected int;
begin
  select * into c from public.calls where id = p_call for update;
  if c.id is null or not public.has_role(c.org_id, 'reviewer') then raise exception 'call not found'; end if;
  if not p_skip then
    update public.answers set review_state = 'confirmed', reviewed_by = (select auth.uid()), reviewed_at = now()
     where call_id = p_call and review_state in ('auto', 'needs_review');
    update public.calls set needs_review = false where id = p_call;
  end if;
  update public.review_tasks set state = case when p_skip then 'skipped' else 'done' end, done_by = (select auth.uid()), done_at = now()
   where call_id = p_call and state = 'open';
  select count(*) into v_corrected from public.answers where call_id = p_call and review_state = 'corrected';
  perform public.write_audit(c.org_id, case when p_skip then 'review.skipped' else 'review.done' end, 'call', p_call::text,
    jsonb_build_object('corrected', v_corrected));
end $$;
revoke all on function public.finish_review(uuid, boolean) from public, anon;
grant execute on function public.finish_review(uuid, boolean) to authenticated;

-- ---------------------------------------------------------------------------
-- 8. Team invites: a hashed one-time token, bound to an email, valid 7 days.
-- ---------------------------------------------------------------------------
create table public.invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role public.org_role not null check (role <> 'owner'),
  token_hash text not null unique,
  invited_by uuid default auth.uid(),
  expires_at timestamptz not null default now() + interval '7 days',
  accepted_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;
create policy inv_read on public.invites for select to authenticated using (public.has_role(org_id, 'admin'));
create policy inv_insert on public.invites for insert to authenticated with check (public.has_role(org_id, 'admin') and accepted_at is null);
create policy inv_delete on public.invites for delete to authenticated using (public.has_role(org_id, 'admin'));
create trigger invites_audit after insert or delete on public.invites for each row execute function public.audit_row();

create or replace function public.accept_invite(p_token text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare i public.invites; v_uid uuid := (select auth.uid()); v_email text;
begin
  if v_uid is null then raise exception 'sign in first'; end if;
  select lower(email) into v_email from auth.users where id = v_uid and not is_anonymous;
  select * into i from public.invites where token_hash = encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if i.id is null or i.accepted_at is not null or i.expires_at < now() then raise exception 'this invite has expired or was already used'; end if;
  if lower(i.email) <> v_email then raise exception 'this invite was sent to a different email address'; end if;
  insert into public.memberships(org_id, user_id, role) values (i.org_id, v_uid, i.role)
  on conflict (org_id, user_id) do update set role = greatest(public.memberships.role, excluded.role);
  update public.invites set accepted_at = now() where id = i.id;
  perform public.write_audit(i.org_id, 'invite.accepted', 'membership', v_uid::text, jsonb_build_object('role', i.role));
  return i.org_id;
end $$;
revoke all on function public.accept_invite(text) from public, anon;
grant execute on function public.accept_invite(text) to authenticated;

-- Members can see each other's email inside their org (for the team page and review attribution).
create or replace function public.org_members(p_org uuid)
returns table (user_id uuid, email text, role public.org_role, joined_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select m.user_id, u.email::text, m.role, m.created_at
  from public.memberships m join auth.users u on u.id = m.user_id
  where m.org_id = p_org and public.has_role(p_org, 'viewer')
  order by m.role desc, m.created_at
$$;
revoke all on function public.org_members(uuid) from public, anon;
grant execute on function public.org_members(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 9. Indexes for the console's main reads.
-- ---------------------------------------------------------------------------
create index if not exists calls_org_created on public.calls(org_id, created_at desc);
create index if not exists calls_campaign on public.calls(campaign_id, created_at desc);
create index if not exists calls_review on public.calls(org_id) where needs_review;
create index if not exists answers_call on public.answers(call_id);
create index if not exists turns_call on public.call_turns(call_id, seq);
create index if not exists contacts_list on public.contacts(list_id);
create index if not exists jobs_due on public.call_jobs(state, due_at) where state = 'pending';
create index if not exists usage_org_at on public.usage_events(org_id, at desc);
create index if not exists audit_org_at on public.audit_log(org_id, at desc);
create index if not exists review_open on public.review_tasks(org_id, created_at) where state = 'open';

-- ---------------------------------------------------------------------------
-- 10. Contact import: one audited call per chunk; duplicates in the list are skipped.
--     The operator's consent attestation is stored in the audit trail with the counts.
-- ---------------------------------------------------------------------------
create or replace function public.import_contacts(p_list uuid, p_rows jsonb, p_attestation text)
returns int language plpgsql security definer set search_path = '' as $$
declare l public.contact_lists; v_in int;
begin
  select * into l from public.contact_lists where id = p_list;
  if l.id is null or not public.has_role(l.org_id, 'operator') then raise exception 'list not found'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 2000 then raise exception 'send at most 2000 contacts at a time'; end if;
  with ins as (
    insert into public.contacts(org_id, list_id, e164, name, language, timezone, consent_source, consent_at, attrs)
    select l.org_id, p_list, r ->> 'e164', left(coalesce(r ->> 'name', ''), 120), nullif(r ->> 'language', ''), nullif(r ->> 'timezone', ''),
           nullif(left(r ->> 'consent_source', 200), ''), nullif(r ->> 'consent_at', '')::timestamptz, coalesce(r -> 'attrs', '{}'::jsonb)
    from jsonb_array_elements(p_rows) r
    where (r ->> 'e164') ~ '^\+[1-9][0-9]{6,14}$'
    on conflict (list_id, e164) do nothing
    returning 1
  ) select count(*) into v_in from ins;
  perform public.write_audit(l.org_id, 'list.import', 'contact_list', p_list::text,
    jsonb_build_object('received', jsonb_array_length(p_rows), 'inserted', v_in, 'attestation', left(coalesce(p_attestation, ''), 300)));
  return v_in;
end $$;
revoke all on function public.import_contacts(uuid, jsonb, text) from public, anon;
grant execute on function public.import_contacts(uuid, jsonb, text) to authenticated;
