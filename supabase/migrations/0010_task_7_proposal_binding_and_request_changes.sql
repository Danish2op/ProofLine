-- Task 7 fix round 2: durably record proposals and bind approvals to them.

alter table public.approval_events
  drop constraint approval_events_decision_check;
alter table public.approval_events
  add constraint approval_events_decision_check
  check (decision in ('approved', 'rejected', 'request_changes', 'revoked'));

create function public.record_verified_buzz_proposal(
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
    target_workspace_id, target_action_passport_id, source_event_id,
    source_channel_id, source_relay_url, source_actor_pubkey,
    source_event_kind, source_event_created_at, source_event_id, true,
    source_raw_event_json
  ) on conflict (workspace_id, buzz_event_id) do nothing;

  if found then return 'stored'; end if;
  return 'duplicate';
end;
$$;

drop function if exists public.apply_verified_buzz_approval(
  uuid, uuid, timestamptz, timestamptz, text, jsonb
);

create function public.apply_verified_buzz_approval(
  target_workspace_id uuid,
  source_approved_at timestamptz,
  source_expires_at timestamptz,
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
  source_proposal_event_id text;
  source_channel_id text;
  proposal_proposer_pubkey text;
  proposal_channel_id text;
  proposal_action_passport_id uuid;
  current_status text;
  target_status text;
  source_decision text;
  stored_provenance_id uuid;
begin
  if jsonb_typeof(source_raw_event_json) <> 'object'
    or jsonb_typeof(source_raw_event_json->'tags') <> 'array' then
    raise exception 'verified Buzz event envelope is malformed';
  end if;

  source_event_id := source_raw_event_json->>'id';
  source_actor_pubkey := source_raw_event_json->>'pubkey';
  source_event_kind := (source_raw_event_json->>'kind')::integer;
  source_event_created_at := (source_raw_event_json->>'created_at')::bigint;
  select tag->>1 into source_proposal_event_id
  from jsonb_array_elements(source_raw_event_json->'tags') as tag
  where tag->>0 = 'e'
  limit 1;
  select tag->>1 into source_channel_id
  from jsonb_array_elements(source_raw_event_json->'tags') as tag
  where tag->>0 = 'h'
  limit 1;

  if source_event_id !~ '^[0-9a-f]{64}$'
    or source_actor_pubkey !~ '^[0-9a-f]{64}$'
    or source_event_kind not in (7, 9)
    or source_event_created_at < 0
    or source_raw_event_json->>'sig' !~ '^[0-9a-f]{128}$'
    or source_proposal_event_id is null
    or source_relay_url !~ '^wss?://' then
    raise exception 'verified Buzz event envelope is malformed';
  end if;

  select action_passport_id, signer_pubkey, channel_id
  into proposal_action_passport_id, proposal_proposer_pubkey, proposal_channel_id
  from public.buzz_event_provenance
  where workspace_id = target_workspace_id
    and buzz_event_id = source_proposal_event_id
    and signature_verified
    and event_kind = 9
  for update;

  if proposal_action_passport_id is null
    or (source_channel_id is not null and source_channel_id <> proposal_channel_id) then
    return 'rejected';
  end if;

  insert into public.buzz_event_provenance (
    workspace_id, action_passport_id, buzz_event_id, proposal_event_id,
    channel_id, relay_url, signer_pubkey, event_kind, event_created_at,
    raw_event_hash, signature_verified, raw_event_json
  ) values (
    target_workspace_id, proposal_action_passport_id, source_event_id,
    source_proposal_event_id, coalesce(source_channel_id, proposal_channel_id),
    source_relay_url, source_actor_pubkey, source_event_kind,
    source_event_created_at, source_event_id, true, source_raw_event_json
  ) on conflict (workspace_id, buzz_event_id) do nothing
  returning id into stored_provenance_id;

  if stored_provenance_id is null then return 'duplicate'; end if;

  if source_actor_pubkey = proposal_proposer_pubkey
    or not exists (
      select 1 from public.buzz_reviewer_identities
      where workspace_id = target_workspace_id
        and pubkey = source_actor_pubkey
        and active
    ) then
    update public.buzz_event_provenance
    set processing_status = 'rejected'
    where id = stored_provenance_id;
    return 'rejected';
  end if;

  if source_event_kind = 7 and source_raw_event_json->>'content' in
    ('+', chr(9989), chr(128077), '-', chr(10060), chr(128078)) then
    source_decision := case when source_raw_event_json->>'content' in
      ('+', chr(9989), chr(128077)) then 'approved' else 'rejected' end;
  elsif source_event_kind = 9
    and left(ltrim(source_raw_event_json->>'content'), 1) = '{' then
    source_decision := (source_raw_event_json->>'content')::jsonb #>> '{proofline,decision}';
  end if;

  if source_decision = 'approved' then
    target_status := 'APPROVED';
  elsif source_decision in ('rejected', 'request_changes') then
    target_status := 'BLOCKED';
  else
    update public.buzz_event_provenance
    set processing_status = 'rejected'
    where id = stored_provenance_id;
    return 'rejected';
  end if;

  select status into current_status
  from public.action_passports
  where workspace_id = target_workspace_id and id = proposal_action_passport_id
  for update;

  if current_status is null or current_status <> 'PENDING_APPROVAL'
    or not public.is_valid_action_transition(current_status, target_status) then
    update public.buzz_event_provenance
    set processing_status = 'rejected'
    where id = stored_provenance_id;
    return 'rejected';
  end if;

  insert into public.approval_events (
    workspace_id, action_passport_id, event_id, decision, actor_pubkey,
    approved_at, expires_at, raw_event_json, applied_at
  ) values (
    target_workspace_id, proposal_action_passport_id, source_event_id,
    source_decision, source_actor_pubkey, source_approved_at, source_expires_at,
    source_raw_event_json, current_timestamp
  );

  update public.action_passports
  set status = target_status,
      approved_at = case when target_status = 'APPROVED' then source_approved_at else approved_at end,
      approval_expires_at = case when target_status = 'APPROVED' then source_expires_at else approval_expires_at end,
      updated_at = current_timestamp
  where workspace_id = target_workspace_id and id = proposal_action_passport_id;

  update public.buzz_event_provenance
  set processing_status = 'applied', applied_at = current_timestamp
  where id = stored_provenance_id;
  return 'applied';
end;
$$;

revoke all on function public.record_verified_buzz_proposal(uuid, uuid, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.record_verified_buzz_proposal(uuid, uuid, text, jsonb)
  to service_role;
revoke all on function public.apply_verified_buzz_approval(
  uuid, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.apply_verified_buzz_approval(
  uuid, timestamptz, timestamptz, text, jsonb
) to service_role;
