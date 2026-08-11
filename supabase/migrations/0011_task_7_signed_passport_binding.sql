-- Task 7 fix round 3: bind proposal provenance to the passport hash in the
-- signed Buzz payload, not to an unchecked caller-selected passport.

create or replace function public.record_verified_buzz_proposal(
  target_workspace_id uuid,
  target_action_passport_id uuid,
  source_relay_url text,
  source_raw_event_json jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  source_event_id text;
  source_actor_pubkey text;
  source_event_kind integer;
  source_event_created_at bigint;
  source_channel_id text;
  source_passport_hash text;
  matching_action_passport_id uuid;
begin
  if jsonb_typeof(source_raw_event_json) <> 'object'
    or jsonb_typeof(source_raw_event_json->'tags') <> 'array' then
    raise exception 'verified Buzz proposal envelope is malformed';
  end if;

  source_event_id := source_raw_event_json->>'id';
  source_actor_pubkey := source_raw_event_json->>'pubkey';
  source_event_kind := (source_raw_event_json->>'kind')::integer;
  source_event_created_at := (source_raw_event_json->>'created_at')::bigint;
  select tag->>1 into source_channel_id
  from jsonb_array_elements(source_raw_event_json->'tags') as tag
  where tag->>0 = 'h'
  limit 1;
  if left(ltrim(source_raw_event_json->>'content'), 1) = '{' then
    source_passport_hash :=
      (source_raw_event_json->>'content')::jsonb #>> '{proofline,passportHash}';
  end if;

  select id into matching_action_passport_id
  from public.action_passports
  where workspace_id = target_workspace_id
    and passport_hash = source_passport_hash;

  if matching_action_passport_id is null
    or matching_action_passport_id <> target_action_passport_id then
    return 'rejected';
  end if;

  if source_event_id !~ '^[0-9a-f]{64}$'
    or source_actor_pubkey !~ '^[0-9a-f]{64}$'
    or source_event_kind <> 9
    or source_event_created_at < 0
    or source_raw_event_json->>'sig' !~ '^[0-9a-f]{128}$'
    or source_channel_id is null
    or source_relay_url !~ '^wss?://' then
    raise exception 'verified Buzz proposal envelope is malformed';
  end if;

  insert into public.buzz_event_provenance (
    workspace_id, action_passport_id, buzz_event_id, channel_id, relay_url,
    signer_pubkey, event_kind, event_created_at, raw_event_hash,
    signature_verified, raw_event_json
  ) values (
    target_workspace_id, matching_action_passport_id, source_event_id,
    source_channel_id, source_relay_url, source_actor_pubkey,
    source_event_kind, source_event_created_at, source_event_id, true,
    source_raw_event_json
  ) on conflict (workspace_id, buzz_event_id) do nothing;

  if found then return 'stored'; end if;
  return 'duplicate';
end;
$$;

revoke all on function public.record_verified_buzz_proposal(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_verified_buzz_proposal(uuid, uuid, text, jsonb)
  to service_role;
