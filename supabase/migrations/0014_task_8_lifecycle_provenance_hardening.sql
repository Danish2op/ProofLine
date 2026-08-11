-- 0014_task_8_lifecycle_provenance_hardening
-- Approval is accepted only from server-stored, verified Buzz provenance.

create or replace function proofline_internal.record_lifecycle_rejection(
  target_workspace_id uuid,
  target_action_passport_id uuid,
  source_command_id uuid,
  computed_command_hash text,
  result jsonb,
  source_actor_type text,
  source_actor_id text,
  source_correlation_id uuid,
  source_causation_id uuid
)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  audit_id uuid := (
    md5(target_workspace_id::text || ':' || target_action_passport_id::text || ':' ||
      source_command_id::text || ':rejected')
  )::uuid;
begin
  insert into public.lifecycle_command_receipts (
    workspace_id, action_passport_id, command_id, command_hash, result_json
  ) values (
    target_workspace_id, target_action_passport_id, source_command_id,
    computed_command_hash, result
  ) on conflict (workspace_id, action_passport_id, command_id) do nothing;

  insert into public.audit_events (
    id, workspace_id, actor_type, actor_id, event_type, aggregate_type,
    aggregate_id, metadata_json, occurred_at, correlation_id, causation_id
  ) values (
    audit_id, target_workspace_id,
    case when source_actor_type in ('human', 'agent', 'worker', 'system')
      then source_actor_type else 'system' end,
    source_actor_id, 'action_command.rejected', 'action_passport',
    target_action_passport_id, result, current_timestamp,
    source_correlation_id, source_causation_id
  ) on conflict (id) do nothing;

  if not exists (
    select 1 from public.audit_events
    where id = audit_id
      and workspace_id = target_workspace_id
      and aggregate_id = target_action_passport_id
  ) then
    raise exception 'audit id collision';
  end if;
end;
$$;

create or replace function public.approve_verified_action(
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
  stored_event_created_at bigint;
  stored_processing_status text;
  stored_approved_at timestamptz;
  stored_expires_at timestamptz;
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'verified lifecycle approval requires service_role';
  end if;

  if source_expected_version is null
    or source_approval_event_id is null
    or source_approval_actor_pubkey is null
    or source_approval_raw_event_json is null then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'invalid_approval_contract', 'retryable', false
    ));
  end if;

  select action_passport_id, proposal_event_id, signer_pubkey,
    raw_event_json, raw_event_hash, signature_verified, event_kind,
    event_created_at, processing_status
  into stored_action_passport_id, stored_proposal_event_id, stored_signer_pubkey,
    stored_raw_event_json, stored_raw_event_hash, stored_signature_verified,
    stored_event_kind, stored_event_created_at, stored_processing_status
  from public.buzz_event_provenance
  where workspace_id = target_workspace_id
    and buzz_event_id = source_approval_event_id
  for update;

  stored_approved_at := coalesce(
    nullif(stored_raw_event_json #>> '{proofline,approvedAt}', '')::timestamptz,
    to_timestamp(stored_event_created_at)
  );
  stored_expires_at := nullif(
    stored_raw_event_json #>> '{proofline,expiresAt}', ''
  )::timestamptz;

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
    or stored_expires_at is null
    or stored_approved_at <> source_approved_at
    or stored_expires_at <> source_expires_at
    or not exists (
      select 1 from public.buzz_event_provenance as proposal
      where proposal.workspace_id = target_workspace_id
        and proposal.buzz_event_id = stored_proposal_event_id
        and proposal.action_passport_id = target_action_passport_id
        and proposal.signature_verified
        and proposal.event_kind = 9
    )
    or not exists (
      select 1 from public.buzz_reviewer_identities
      where workspace_id = target_workspace_id
        and pubkey = stored_signer_pubkey
        and active
    ) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'approval_provenance_mismatch', 'retryable', false
    ));
  end if;

  if not (
    stored_raw_event_json #>> '{proofline,decision}' = 'approved'
    or (stored_event_kind = 7 and stored_raw_event_json->>'content' in
      ('+', chr(9989), chr(128077)))
  ) then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'approval_provenance_mismatch', 'retryable', false
    ));
  end if;

  result := public.transition_action(
    target_workspace_id,
    target_action_passport_id,
    source_expected_version,
    'APPROVED',
    source_command_id,
    source_command_hash,
    'human',
    source_actor_id,
    source_correlation_id,
    source_causation_id,
    source_approval_event_id,
    stored_approved_at,
    stored_expires_at,
    stored_signer_pubkey,
    stored_raw_event_json
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

revoke all on function public.approve_verified_action(
  uuid, uuid, bigint, uuid, text, text, uuid, uuid, text, timestamptz,
  timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.approve_verified_action(
  uuid, uuid, bigint, uuid, text, text, uuid, uuid, text, timestamptz,
  timestamptz, text, jsonb
) to service_role;

create or replace function public.record_action_passport_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  audit_id uuid := (
    md5(new.workspace_id::text || ':' || new.id::text || ':' ||
      new.version::text || ':' ||
      case when tg_op = 'INSERT' then 'created' else 'transitioned' end)
  )::uuid;
begin
  insert into public.audit_events (
    id, workspace_id, actor_type, actor_id, event_type, aggregate_type,
    aggregate_id, before_hash, after_hash, metadata_json, occurred_at,
    correlation_id, causation_id
  ) values (
    audit_id,
    new.workspace_id,
    coalesce(nullif(current_setting('proofline.actor_type', true), ''), 'system'),
    nullif(current_setting('proofline.actor_id', true), ''),
    case when tg_op = 'INSERT' then 'action_passport.created'
      else 'action_passport.transitioned' end,
    'action_passport', new.id,
    case when tg_op = 'INSERT' then null
      else proofline_internal.sha256_json(pg_catalog.to_jsonb(old)) end,
    proofline_internal.sha256_json(pg_catalog.to_jsonb(new)),
    pg_catalog.jsonb_build_object('status', new.status, 'version', new.version),
    current_timestamp,
    nullif(current_setting('proofline.correlation_id', true), '')::uuid,
    nullif(current_setting('proofline.causation_id', true), '')::uuid
  ) on conflict (id) do nothing;

  if not exists (
    select 1 from public.audit_events
    where id = audit_id
      and workspace_id = new.workspace_id
      and aggregate_id = new.id
  ) then
    raise exception 'audit id collision';
  end if;
  return new;
end;
$$;
