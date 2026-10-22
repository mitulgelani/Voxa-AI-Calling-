-- Private playground personas: callable only from the browser that owns them (the vd_owner
-- cookie key). Previously "private" made a persona uncallable for everyone, owner included.

drop function if exists public.persona_by_slug(text);
create or replace function public.persona_by_slug(p_slug text, p_owner_key text default null)
returns table (id uuid, name text, tagline text, description text, greeting text, language text, voice text, rate text, accent text, call_count int, is_owner boolean)
language sql stable security definer set search_path = ''
as $$
  select p.id, p.name, p.tagline, p.description, p.greeting, p.language, p.voice, p.rate, p.accent, p.call_count,
         coalesce(p.owner_id = (select auth.uid()), false)
           or (p_owner_key is not null and p.owner_key_hash = public._key_hash(p_owner_key))
  from public.personas p
  where p.share_slug = p_slug
    and (p.visibility <> 'private'
         or p.owner_id = (select auth.uid())
         or (p_owner_key is not null and p.owner_key_hash = public._key_hash(p_owner_key)))
$$;
revoke all on function public.persona_by_slug(text, text) from public;
grant execute on function public.persona_by_slug(text, text) to anon, authenticated;

-- _key_hash is internal, but persona_by_slug (definer) calls it as owner, so no grant is needed.

drop function if exists public.play_session_start(text, text, text);
create or replace function public.play_session_start(p_token text, p_slug text, p_ip_hash text, p_owner_key text default null)
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
  if p.id is null or (p.visibility = 'private'
      and (p_owner_key is null or p.owner_key_hash is distinct from public._key_hash(p_owner_key))) then
    raise exception 'persona not found';
  end if;

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
revoke all on function public.play_session_start(text, text, text, text) from public;
grant execute on function public.play_session_start(text, text, text, text) to anon, authenticated;
