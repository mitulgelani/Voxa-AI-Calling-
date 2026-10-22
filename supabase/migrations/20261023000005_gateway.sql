-- Voice gateway support: webhook outbox and the service-role helpers the gateway calls.
-- Everything here is service-role only; the app never touches these directly.

create table public.webhook_deliveries (
  id bigint generated always as identity primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  endpoint_id uuid not null references public.webhook_endpoints(id) on delete cascade,
  event text not null,
  payload jsonb not null,
  attempts int not null default 0,
  next_at timestamptz not null default now(),
  delivered_at timestamptz,
  last_status int,
  created_at timestamptz not null default now()
);
create index webhook_deliveries_due on public.webhook_deliveries(next_at) where delivered_at is null and attempts < 12;
alter table public.webhook_deliveries enable row level security;
create policy whd_read on public.webhook_deliveries for select to authenticated using (public.has_role(org_id, 'admin'));

-- Queue an event for every active endpoint of the org that subscribed to it.
create or replace function public.enqueue_webhook(p_org uuid, p_event text, p_payload jsonb)
returns int language sql security definer set search_path = '' as $$
  with ins as (
    insert into public.webhook_deliveries(org_id, endpoint_id, event, payload)
    select p_org, w.id, p_event, p_payload from public.webhook_endpoints w
    where w.org_id = p_org and w.active and p_event = any(w.events)
    returning 1
  ) select count(*)::int from ins
$$;
revoke all on function public.enqueue_webhook(uuid, text, jsonb) from public, anon, authenticated;

-- Claim due deliveries (skip-locked so several gateway instances can share the work).
create or replace function public.claim_webhook_deliveries(p_limit int default 20)
returns table (id bigint, org_id uuid, event text, payload jsonb, attempts int, url text, secret_enc text)
language plpgsql security definer set search_path = '' as $$
begin
  return query
  with due as (
    select d.id from public.webhook_deliveries d
    where d.delivered_at is null and d.attempts < 12 and d.next_at <= now()
    order by d.next_at limit p_limit for update skip locked
  ), bumped as (
    update public.webhook_deliveries d set attempts = d.attempts + 1,
      next_at = now() + make_interval(secs => least(86400, 30 * power(2, d.attempts)::int))
    from due where d.id = due.id
    returning d.id, d.org_id, d.event, d.payload, d.attempts, d.endpoint_id
  )
  select b.id, b.org_id, b.event, b.payload, b.attempts, w.url, w.secret_enc
  from bumped b join public.webhook_endpoints w on w.id = b.endpoint_id;
end $$;
revoke all on function public.claim_webhook_deliveries(int) from public, anon, authenticated;

-- Record an opt-out heard on a call: block the number, cancel queued work, audit it. Atomic.
create or replace function public.gateway_opt_out(p_call uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.calls;
begin
  select * into c from public.calls where id = p_call;
  if c.id is null then return; end if;
  insert into public.dnc_entries(org_id, e164, reason, source_call_id) values (c.org_id, c.to_e164, 'opt_out', c.id) on conflict do nothing;
  update public.call_jobs j set state = 'cancelled', skip_reason = 'dnc'
    from public.contacts ct where j.contact_id = ct.id and ct.org_id = c.org_id and ct.e164 = c.to_e164 and j.state = 'pending';
  insert into public.audit_log(org_id, actor_id, action, entity, entity_id, detail)
  values (c.org_id, null, 'dnc.add', 'call', c.id::text, jsonb_build_object('reason', 'opt_out', 'source', 'call'));
end $$;
revoke all on function public.gateway_opt_out(uuid) from public, anon, authenticated;

-- Add spend to a campaign without a read-modify-write race.
create or replace function public.add_campaign_spend(p_campaign uuid, p_minor bigint)
returns void language sql security definer set search_path = '' as $$
  update public.campaigns set spent_minor = spent_minor + greatest(p_minor, 0) where id = p_campaign
$$;
revoke all on function public.add_campaign_spend(uuid, bigint) from public, anon, authenticated;
