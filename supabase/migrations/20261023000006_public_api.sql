-- Public REST API (/api/v1). The web app holds no service key, so each endpoint calls one of these
-- definer functions with the caller's raw API key; the database hashes it, checks scope and
-- revocation, and only then reads that key's organisation.

create or replace function public._api_org(p_key text, p_scope text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare k public.api_keys;
begin
  if p_key is null or p_key !~ '^vd_live_[A-Za-z0-9_-]{43}$' then raise exception 'invalid api key' using errcode = '28000'; end if;
  select * into k from public.api_keys where key_hash = encode(extensions.digest(p_key, 'sha256'), 'hex');
  if k.id is null or k.revoked_at is not null then raise exception 'invalid api key' using errcode = '28000'; end if;
  if not (p_scope = any(k.scopes)) then raise exception 'this key lacks the % permission', p_scope using errcode = '42501'; end if;
  update public.api_keys set last_used_at = now() where id = k.id and (last_used_at is null or last_used_at < now() - interval '1 minute');
  return k.org_id;
end $$;
revoke all on function public._api_org(text, text) from public, anon, authenticated;

create or replace function public.api_list_calls(p_key text, p_campaign uuid default null, p_after timestamptz default null, p_limit int default 50)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public._api_org(p_key, 'calls:read');
begin
  return coalesce((
    select jsonb_agg(row_to_json(x) order by x.created_at desc) from (
      select c.id, c.campaign_id, c.to_e164 as phone, c.status, c.outcome, c.language_detected as language, c.duration_ms,
             c.needs_review, c.created_at, c.ended_at,
             (select jsonb_object_agg(a.question_key, jsonb_build_object('value', a.value, 'confidence', a.confidence, 'evidence_ms', a.evidence_start_ms, 'review_state', a.review_state))
              from public.answers a where a.call_id = c.id) as answers
      from public.calls c
      where c.org_id = v_org and (p_campaign is null or c.campaign_id = p_campaign) and (p_after is null or c.created_at < p_after)
      order by c.created_at desc limit least(greatest(p_limit, 1), 200)
    ) x), '[]'::jsonb);
end $$;
revoke all on function public.api_list_calls(text, uuid, timestamptz, int) from public;
grant execute on function public.api_list_calls(text, uuid, timestamptz, int) to anon;

create or replace function public.api_get_call(p_key text, p_call uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public._api_org(p_key, 'calls:read'); r jsonb;
begin
  select jsonb_build_object(
    'id', c.id, 'campaign_id', c.campaign_id, 'phone', c.to_e164, 'status', c.status, 'outcome', c.outcome,
    'language', c.language_detected, 'duration_ms', c.duration_ms, 'needs_review', c.needs_review, 'created_at', c.created_at,
    'answers', (select coalesce(jsonb_agg(jsonb_build_object('key', a.question_key, 'value', a.value, 'confidence', a.confidence,
                 'evidence', jsonb_build_object('start_ms', a.evidence_start_ms, 'end_ms', a.evidence_end_ms), 'review_state', a.review_state)), '[]'::jsonb)
                from public.answers a where a.call_id = c.id),
    'transcript', (select coalesce(jsonb_agg(jsonb_build_object('speaker', t.speaker, 'text', t.text, 'start_ms', t.start_ms, 'end_ms', t.end_ms) order by t.seq), '[]'::jsonb)
                   from public.call_turns t where t.call_id = c.id))
  into r from public.calls c where c.id = p_call and c.org_id = v_org;
  if r is null then raise exception 'call not found' using errcode = 'P0002'; end if;
  return r;
end $$;
revoke all on function public.api_get_call(text, uuid) from public;
grant execute on function public.api_get_call(text, uuid) to anon;

create or replace function public.api_list_campaigns(p_key text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public._api_org(p_key, 'campaigns:read');
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'name', name, 'status', status, 'purpose', purpose,
    'spent_minor', spent_minor, 'budget_cap_minor', budget_cap_minor, 'currency', currency, 'created_at', created_at) order by created_at desc)
    from public.campaigns where org_id = v_org), '[]'::jsonb);
end $$;
revoke all on function public.api_list_campaigns(text) from public;
grant execute on function public.api_list_campaigns(text) to anon;

create or replace function public.api_add_contacts(p_key text, p_list uuid, p_rows jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org uuid := public._api_org(p_key, 'contacts:write'); v_in int;
begin
  if not exists (select 1 from public.contact_lists where id = p_list and org_id = v_org) then raise exception 'list not found' using errcode = 'P0002'; end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) > 1000 then raise exception 'send between 1 and 1000 contacts' using errcode = '22023'; end if;
  with ins as (
    insert into public.contacts(org_id, list_id, e164, name, language, consent_source, consent_at, attrs)
    select v_org, p_list, r ->> 'phone', left(coalesce(r ->> 'name', ''), 120), nullif(r ->> 'language', ''),
           nullif(left(r ->> 'consent_source', 200), ''), nullif(r ->> 'consent_at', '')::timestamptz, coalesce(r -> 'attributes', '{}'::jsonb)
    from jsonb_array_elements(p_rows) r
    where (r ->> 'phone') ~ '^\+[1-9][0-9]{6,14}$'
    on conflict (list_id, e164) do nothing returning 1
  ) select count(*) into v_in from ins;
  insert into public.audit_log(org_id, actor_id, action, entity, entity_id, detail)
  values (v_org, null, 'list.import', 'contact_list', p_list::text, jsonb_build_object('received', jsonb_array_length(p_rows), 'inserted', v_in, 'via', 'api'));
  return jsonb_build_object('received', jsonb_array_length(p_rows), 'inserted', v_in);
end $$;
revoke all on function public.api_add_contacts(text, uuid, jsonb) from public;
grant execute on function public.api_add_contacts(text, uuid, jsonb) to anon;
