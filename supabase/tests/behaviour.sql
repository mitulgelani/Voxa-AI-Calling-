\set ON_ERROR_STOP 1
-- users
insert into auth.users(id, email) values
 ('00000000-0000-0000-0000-00000000000a', 'owner@a.in'), ('00000000-0000-0000-0000-00000000000b', 'admin2@a.in'),
 ('00000000-0000-0000-0000-00000000000c', 'outsider@b.in'), ('00000000-0000-0000-0000-00000000000d', 'viewer@a.in');
create or replace function t_as(uid text, r text default 'authenticated') returns void language plpgsql as $$
begin perform set_config('request.jwt.claim.sub', uid, false); perform set_config('request.jwt.claim.role', r, false); end $$;
grant execute on function t_as(text, text) to public;
create table t_ids(k text primary key, v uuid); grant all on t_ids to public;
create or replace function t_expect_fail(sql text, needle text) returns void language plpgsql as $$
begin
  begin execute sql; exception when others then
    if position(needle in sqlerrm) = 0 then raise exception 'expected error containing "%" got "%"', needle, sqlerrm; end if;
    raise notice 'ok (blocked): %', needle; return;
  end;
  raise exception 'expected failure: %', sql;
end $$;
grant execute on function t_expect_fail(text, text) to public;

set role authenticated;
select t_as('00000000-0000-0000-0000-00000000000a');
insert into t_ids values ('org', public.create_organization('Glowleaf Naturals', 'IN'));
-- owner sees org; outsider does not
select t_as('00000000-0000-0000-0000-00000000000c');
do $$ begin if exists (select 1 from organizations) then raise exception 'outsider sees org'; end if; raise notice 'ok: outsider isolated'; end $$;
select t_expect_fail($q$insert into agents(org_id, name) select v, 'x' from t_ids where k='org'$q$, 'row-level security');
select t_as('00000000-0000-0000-0000-00000000000a');
-- add admin2 and viewer via membership insert (admin)
insert into memberships(org_id, user_id, role) select v, '00000000-0000-0000-0000-00000000000b', 'admin' from t_ids where k='org';
insert into memberships(org_id, user_id, role) select v, '00000000-0000-0000-0000-00000000000d', 'viewer' from t_ids where k='org';
select t_expect_fail($q$insert into memberships(org_id, user_id, role) select v, '00000000-0000-0000-0000-00000000000c', 'owner' from t_ids where k='org'$q$, 'row-level security');
-- agent + version
with x as (insert into agents(org_id, name) select v, 'Feedback' from t_ids where k='org' returning id) insert into t_ids select 'agent', id from x;
select t_expect_fail($q$select create_agent_version((select v from t_ids where k='agent'), 'Namaste ji, Glowleaf se bol rahi hoon.', 'This is a human call, recorded.', 'Get feedback', '', '[{"key":"rating","type":"rating","prompt":"Rate us","required":true}]', array['hinglish'], '{}')$q$, 'disclosure');
insert into t_ids values ('v1', create_agent_version((select v from t_ids where k='agent'), 'Namaste ji, Glowleaf se bol rahi hoon.', 'Yeh ek AI assistant ki call hai.', 'Get feedback', '', '[{"key":"rating","type":"rating","prompt":"Rate us","required":true}]', array['hinglish'], '{}'));
select t_expect_fail($q$select approve_agent_version((select v from t_ids where k='v1'))$q$, 'another admin must approve');
select t_expect_fail($q$update agent_versions set goal='changed' where id=(select v from t_ids where k='v1')$q$, 'immutable');
select t_as('00000000-0000-0000-0000-00000000000b');
select approve_agent_version((select v from t_ids where k='v1'));
select t_expect_fail($q$select approve_agent_version((select v from t_ids where k='v1'))$q$, 'already approved');
-- viewer cannot create versions
select t_as('00000000-0000-0000-0000-00000000000d');
select t_expect_fail($q$select create_agent_version((select v from t_ids where k='agent'), 'Namaste ji, Glowleaf se.', 'AI call hai yeh.', 'Get feedback', '', '[]', array['hinglish'], '{}')$q$, 'agent not found');
select t_as('00000000-0000-0000-0000-00000000000a');
-- number: admin cannot self-verify
with x as (insert into phone_numbers(org_id, e164, country, carrier, purpose, dlt_header, verified_at) select v, '+918045678900', 'IN', 'plivo', 'service', 'GLWLEF', now() from t_ids where k='org' returning id) insert into t_ids select 'num', id from x;
do $$ begin if (select verified_at from phone_numbers limit 1) is not null then raise exception 'self-verified!'; end if; raise notice 'ok: verification blocked for app users'; end $$;
select t_expect_fail($q$insert into phone_numbers(org_id, e164, country, carrier, purpose) select v, '+14155550134', 'US', 'plivo', 'service' from t_ids where k='org'$q$, 'Telnyx');
-- list + import
with x as (insert into contact_lists(org_id, name) select v, 'Oct buyers' from t_ids where k='org' returning id) insert into t_ids select 'list', id from x;
select import_contacts((select v from t_ids where k='list'), '[{"e164":"+919876543210","name":"Ritika","consent_source":"checkout","consent_at":"2026-10-01T10:00:00+05:30"},{"e164":"+919876543211","name":"NoConsent"},{"e164":"bad"},{"e164":"+919876543210"}]', 'test attest') as inserted;
-- campaign draft & checks
with x as (insert into campaigns(org_id, name, purpose, agent_version_id, phone_number_id, list_id) select (select v from t_ids where k='org'), 'Oct', 'service', (select v from t_ids where k='v1'), (select v from t_ids where k='num'), (select v from t_ids where k='list') returning id) insert into t_ids select 'camp', id from x;
select key, ok, message from campaign_checks((select v from t_ids where k='camp'));
select t_expect_fail($q$select launch_campaign((select v from t_ids where k='camp'))$q$, 'launch blocked');
select t_expect_fail($q$update campaigns set status='running' where id=(select v from t_ids where k='camp')$q$, 'cannot become');
-- fix: service verifies number; operator records scrub
reset role; set role service_role; select t_as('', 'service_role');
update phone_numbers set verified_at = now();
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select record_dnd_scrub((select v from t_ids where k='list'), 'Jio DLT', array['+919876543299']) as removed;
select count(*) filter (where ok) as passing from campaign_checks((select v from t_ids where k='camp'));
select launch_campaign((select v from t_ids where k='camp'));
select count(*) as jobs_created from call_jobs;
select t_expect_fail($q$update campaigns set window_end='22:00' where id=(select v from t_ids where k='camp')$q$, 'frozen');
select t_expect_fail($q$update campaigns set spent_minor=5 where id=(select v from t_ids where k='camp')$q$, 'spend');
select set_campaign_status((select v from t_ids where k='camp'), 'paused');
select set_campaign_status((select v from t_ids where k='camp'), 'running');
-- audit is append-only even for owner (no policy) and for superuser trigger
delete from audit_log;

reset role;
do $$ begin if (select count(*) from audit_log) = 0 then raise exception 'audit deleted'; end if; raise notice 'ok: app delete removed nothing'; end $$;
select t_expect_fail($q$update audit_log set action='x'$q$, 'append-only');
select t_expect_fail($q$delete from audit_log$q$, 'append-only');
select action, count(*) from audit_log group by 1 order by 1;
-- DNC
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
select add_to_dnc((select v from t_ids where k='org'), '+919876543210', 'manual');
select state, skip_reason from call_jobs;
reset role;
select t_expect_fail($q$insert into calls(org_id, to_e164, carrier) select v, '+919876543210', 'plivo' from t_ids where k='org'$q$, 'do-not-call');
-- claim (service role)
set role service_role; select t_as('', 'service_role');
select count(*) as claimable from claim_call_jobs(5);
reset role;
-- invites
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000a');
insert into invites(org_id, email, role, token_hash) select v, 'outsider@b.in', 'reviewer', encode(extensions.digest('a'||repeat('b',47), 'sha256'),'hex') from t_ids where k='org';
select t_as('00000000-0000-0000-0000-00000000000d');
select t_expect_fail($q$select accept_invite('a'||repeat('b',47))$q$, 'different email');
select t_as('00000000-0000-0000-0000-00000000000c');
select accept_invite('a'||repeat('b',47)) is not null as joined;
select t_expect_fail($q$select accept_invite('a'||repeat('b',47))$q$, 'expired or was already used');
select count(*) as outsider_now_sees from organizations;
-- members list
select t_as('00000000-0000-0000-0000-00000000000a');
select email, role from org_members((select v from t_ids where k='org'));
-- api key + api functions as anon
insert into api_keys(org_id, name, prefix, key_hash, scopes) select v, 'crm', 'vd_live_xxxxxx', encode(extensions.digest('vd_live_'||repeat('A',43),'sha256'),'hex'), array['calls:read'] from t_ids where k='org';
reset role; set role anon; select t_as('', 'anon');
select jsonb_array_length(api_list_calls('vd_live_'||repeat('A',43))) as api_calls;
select t_expect_fail($q$select api_list_campaigns('vd_live_'||repeat('A',43))$q$, 'lacks');
select t_expect_fail($q$select api_list_calls('vd_live_'||repeat('B',43))$q$, 'invalid api key');
do $$ begin if exists (select 1 from campaigns) or exists (select 1 from calls) or exists (select 1 from dnc_entries) then raise exception 'anon reads data'; end if; raise notice 'ok: anon sees no rows'; end $$;
reset role;
-- gateway path as service role: a call, answers, review, webhook
set role service_role; select t_as('', 'service_role');
insert into webhook_endpoints(org_id, url, events, secret_enc) select v, 'https://hooks.example.com/x', array['call.completed','answer.reviewed'], 'v1.a.b.c' from t_ids where k='org';
with x as (insert into calls(org_id, campaign_id, to_e164, carrier, status, needs_review) select (select v from t_ids where k='org'), (select v from t_ids where k='camp'), '+919876543211', 'plivo', 'completed', true returning id) insert into t_ids select 'call', id from x;
insert into answers(call_id, org_id, question_key, type, value, confidence, evidence_start_ms, evidence_end_ms, review_state)
  select (select v from t_ids where k='call'), (select v from t_ids where k='org'), 'rating', 'rating', '4', 0.7, 62000, 66000, 'needs_review';
insert into review_tasks(org_id, call_id, reason) select (select v from t_ids where k='org'), (select v from t_ids where k='call'), 'low confidence';
select enqueue_webhook((select v from t_ids where k='org'), 'call.completed', '{"x":1}') as queued;
select add_campaign_spend((select v from t_ids where k='camp'), 250);
select spent_minor from campaigns;
select count(*) as claimed from claim_webhook_deliveries(10);
select gateway_opt_out((select v from t_ids where k='call'));
select count(*) as dnc_entries from dnc_entries;
reset role;
-- reviewer corrects and finishes
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000c');
select t_expect_fail($q$update answers set confidence = 1$q$, 'only the value');
update answers set value = '5', review_state = 'corrected';
select value, original_value, review_state, reviewed_by is not null as stamped from answers;
select finish_review((select v from t_ids where k='call'));
select state from review_tasks;
reset role;
select event, attempts from webhook_deliveries order by id;
-- viewer cannot review
set role authenticated; select t_as('00000000-0000-0000-0000-00000000000d');
update answers set value = '1';
reset role;
do $$ begin if (select value::text from answers) <> '5' then raise exception 'viewer changed answer'; end if; raise notice 'ok: viewer cannot edit answers'; end $$;
-- playground: private persona callable only with the owner key
insert into play_secrets(id, server_token_hash) values (1, encode(extensions.digest('tok','sha256'),'hex')) on conflict (id) do update set server_token_hash = excluded.server_token_hash;
set role anon; select t_as('', 'anon');
select play_save_persona('tok', repeat('k', 43), null, 'Zoya', '', 'A witty film critic from Mumbai who loves arguing.', '', 'hinglish', 'hi-IN-SwaraNeural', '+0%', 'private', 'saffron') is not null as saved;
select count(*) as visible_without_key from persona_by_slug((select share_slug from play_my_personas('tok', repeat('k',43)) limit 1));
select count(*) as visible_with_key from persona_by_slug((select share_slug from play_my_personas('tok', repeat('k',43)) limit 1), repeat('k',43));
select t_expect_fail($q$select * from play_session_start('tok', (select share_slug from play_my_personas('tok', repeat('k',43)) limit 1), 'iphash1')$q$, 'persona not found');
select allowed_seconds > 0 as started from play_session_start('tok', (select share_slug from play_my_personas('tok', repeat('k',43)) limit 1), 'iphash1', repeat('k',43));
select t_expect_fail($q$select * from play_session_start('wrong', 'x', 'y')$q$, 'forbidden');
reset role;
\echo ALL TESTS PASSED
