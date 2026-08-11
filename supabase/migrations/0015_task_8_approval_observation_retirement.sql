-- Task 8 fix round 3: parse standard Nostr approval events and retire the
-- lifecycle-bypassing Task 7 approval RPC.

alter table public.buzz_event_provenance
  add column if not exists approval_approved_at timestamptz,
  add column if not exists approval_expires_at timestamptz;

create or replace function proofline_internal.approval_decision(
  source_raw_event_json jsonb
)
returns text
language plpgsql
immutable
set search_path = pg_catalog, pg_temp
as $$
declare
  content_json jsonb;
  decision text;
begin
  if (source_raw_event_json->>'kind')::integer = 7 then
    if source_raw_event_json->>'content' in ('+', '✅', '👍') then
      return 'approved';
    elsif source_raw_event_json->>'content' in ('-', '❌', '👎') then
      return 'rejected';
    end if;
    return null;
  end if;
  if (source_raw_event_json->>'kind')::integer <> 9 then return null; end if;
  begin
    content_json := (source_raw_event_json->>'content')::jsonb;
  exception when others then
    return null;
  end;
  decision := content_json #>> '{proofline,decision}';
  if decision in ('approved', 'rejected', 'request_changes') then
    return decision;
  end if;
  return null;
end;
$$;

create or replace function public.record_verified_buzz_approval_observation(
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
  source_proposal_event_id text;
  source_channel_id text;
  proposal_action_passport_id uuid;
  proposal_signer_pubkey text;
  proposal_channel_id text;
  decision text;
begin
  if auth.role() <> 'service_role'
    or jsonb_typeof(source_raw_event_json) <> 'object'
    or source_approved_at is null
    or source_expires_at is null
    or source_expires_at <= source_approved_at
    or source_expires_at <= current_timestamp
    or source_relay_url !~ '^wss?://'
    or source_raw_event_json->>'id' !~ '^[0-9a-f]{64}$'
    or source_raw_event_json->>'pubkey' !~ '^[0-9a-f]{64}$'
    or source_raw_event_json->>'sig' !~ '^[0-9a-f]{128}$'
    or (source_raw_event_json->>'kind')::integer not in (7, 9)
    or jsonb_typeof(source_raw_event_json->'tags') <> 'array' then
    raise exception 'approval_observation_malformed';
  end if;

  source_event_id := source_raw_event_json->>'id';
  source_actor_pubkey := source_raw_event_json->>'pubkey';
  select tag->>1 into source_proposal_event_id
  from jsonb_array_elements(source_raw_event_json->'tags') with ordinality as item(tag, ordinal)
  where tag->>0 = 'e'
  order by ordinal desc
  limit 1;
  select tag->>1 into source_channel_id
  from jsonb_array_elements(source_raw_event_json->'tags') as tag
  where tag->>0 = 'h'
  limit 1;
  decision := proofline_internal.approval_decision(source_raw_event_json);
  if source_proposal_event_id is null or decision is null then
    raise exception 'approval_observation_malformed';
  end if;

  select action_passport_id, signer_pubkey, channel_id
  into proposal_action_passport_id, proposal_signer_pubkey, proposal_channel_id
  from public.buzz_event_provenance
  where workspace_id = target_workspace_id
    and buzz_event_id = source_proposal_event_id
    and signature_verified
    and event_kind = 9
  for update;

  if proposal_action_passport_id is null
    or (source_channel_id is not null and source_channel_id <> proposal_channel_id)
    or source_actor_pubkey = proposal_signer_pubkey
    or not exists (
      select 1 from public.buzz_reviewer_identities
      where workspace_id = target_workspace_id
        and pubkey = source_actor_pubkey
        and active
    ) then
    return 'rejected';
  end if;

  insert into public.buzz_event_provenance (
    workspace_id, action_passport_id, buzz_event_id, proposal_event_id,
    channel_id, relay_url, signer_pubkey, event_kind, event_created_at,
    raw_event_hash, signature_verified, raw_event_json,
    approval_approved_at, approval_expires_at
  ) values (
    target_workspace_id, proposal_action_passport_id, source_event_id,
    source_proposal_event_id, coalesce(source_channel_id, proposal_channel_id),
    source_relay_url, source_actor_pubkey, (source_raw_event_json->>'kind')::integer,
    (source_raw_event_json->>'created_at')::bigint, source_event_id, true,
    source_raw_event_json, source_approved_at, source_expires_at
  ) on conflict (workspace_id, buzz_event_id) do nothing;

  if found then return 'stored'; end if;
  return 'duplicate';
end;
$$;

revoke all on function public.record_verified_buzz_approval_observation(
  uuid, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.record_verified_buzz_approval_observation(
  uuid, timestamptz, timestamptz, text, jsonb
) to service_role;

revoke all on function public.apply_verified_buzz_approval(
  uuid, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.approve_verified_action(
  uuid, uuid, bigint, uuid, text, text, uuid, uuid, text, timestamptz,
  timestamptz, text, jsonb
) from public, anon, authenticated, service_role;

create or replace function public.approve_verified_action_v2(
  target_workspace_id uuid,
  target_action_passport_id uuid,
  source_expected_version bigint,
  source_command_id uuid,
  source_command_hash text,
  source_actor_id text,
  source_correlation_id uuid,
  source_causation_id uuid,
  source_approval_event_id text,
  source_approved_at timestamptz,
  source_expires_at timestamptz,
  source_approval_actor_pubkey text,
  source_approval_raw_event_json jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored_action_passport_id uuid;
  stored_proposal_event_id text;
  stored_signer_pubkey text;
  stored_raw_event_json jsonb;
  stored_raw_event_hash text;
  stored_signature_verified boolean;
  stored_event_kind integer;
  stored_processing_status text;
  stored_approved_at timestamptz;
  stored_expires_at timestamptz;
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'verified lifecycle approval requires service_role';
  end if;
  if source_expected_version is null or source_approval_event_id is null
    or source_approval_actor_pubkey is null
    or source_approval_raw_event_json is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'invalid_approval_contract', 'retryable', false
    ));
  end if;

  select action_passport_id, proposal_event_id, signer_pubkey, raw_event_json,
    raw_event_hash, signature_verified, event_kind, processing_status,
    approval_approved_at, approval_expires_at
  into stored_action_passport_id, stored_proposal_event_id, stored_signer_pubkey,
    stored_raw_event_json, stored_raw_event_hash, stored_signature_verified,
    stored_event_kind, stored_processing_status, stored_approved_at,
    stored_expires_at
  from public.buzz_event_provenance
  where workspace_id = target_workspace_id
    and buzz_event_id = source_approval_event_id
  for update;

  if not found
    or stored_action_passport_id <> target_action_passport_id
    or stored_proposal_event_id is null
    or not stored_signature_verified
    or stored_processing_status not in ('received', 'applied')
    or stored_signer_pubkey <> source_approval_actor_pubkey
    or stored_raw_event_json <> source_approval_raw_event_json
    or stored_raw_event_json->>'id' <> source_approval_event_id
    or stored_raw_event_json->>'pubkey' <> stored_signer_pubkey
    or stored_raw_event_json->>'sig' !~ '^[0-9a-f]{128}$'
    or stored_raw_event_hash <> source_approval_event_id
    or stored_event_kind not in (7, 9)
    or proofline_internal.approval_decision(stored_raw_event_json) <> 'approved'
    or stored_approved_at is null or stored_expires_at is null
    or stored_expires_at <= stored_approved_at
    or stored_expires_at <= current_timestamp
    or stored_approved_at <> source_approved_at
    or stored_expires_at <> source_expires_at
    or not exists (
      select 1 from public.buzz_event_provenance as proposal
      where proposal.workspace_id = target_workspace_id
        and proposal.buzz_event_id = stored_proposal_event_id
        and proposal.action_passport_id = target_action_passport_id
        and proposal.signature_verified and proposal.event_kind = 9
    )
    or not exists (
      select 1 from public.buzz_reviewer_identities
      where workspace_id = target_workspace_id
        and pubkey = stored_signer_pubkey and active
    ) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'approval_provenance_mismatch', 'retryable', false
    ));
  end if;

  result := public.transition_action(
    target_workspace_id, target_action_passport_id, source_expected_version,
    'APPROVED', source_command_id, source_command_hash, 'human',
    source_actor_id, source_correlation_id, source_causation_id,
    source_approval_event_id, stored_approved_at, stored_expires_at,
    stored_signer_pubkey, stored_raw_event_json
  );
  if coalesce((result->>'ok')::boolean, false) then
    update public.buzz_event_provenance
    set processing_status = 'applied', applied_at = current_timestamp
    where workspace_id = target_workspace_id
      and buzz_event_id = source_approval_event_id;
  end if;
  return result;
end;
$$;

revoke all on function public.approve_verified_action_v2(
  uuid, uuid, bigint, uuid, text, text, uuid, uuid, text, timestamptz,
  timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.approve_verified_action_v2(
  uuid, uuid, bigint, uuid, text, text, uuid, uuid, text, timestamptz,
  timestamptz, text, jsonb
) to service_role;
