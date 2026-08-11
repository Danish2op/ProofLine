-- Task 8 fix round 1: authenticate command callers at the Edge boundary and
-- make lifecycle command receipts authoritative for approval and rejection.

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
    (md5(source_command_id::text || ':rejected'))::uuid,
    target_workspace_id,
    case when source_actor_type in ('human', 'agent', 'worker', 'system')
      then source_actor_type else 'system' end,
    source_actor_id,
    'action_command.rejected',
    'action_passport',
    target_action_passport_id,
    result,
    current_timestamp,
    source_correlation_id,
    source_causation_id
  ) on conflict (id) do nothing;
end;
$$;

revoke all on function proofline_internal.record_lifecycle_rejection(
  uuid, uuid, uuid, text, jsonb, text, text, uuid, uuid
) from public;

drop function if exists public.transition_action(
  uuid, uuid, bigint, text, uuid, text, text, text, uuid, uuid
);

create function public.transition_action(
  target_workspace_id uuid,
  target_action_passport_id uuid,
  source_expected_version bigint,
  source_target_status text,
  source_command_id uuid,
  source_command_hash text,
  source_actor_type text,
  source_actor_id text,
  source_correlation_id uuid,
  source_causation_id uuid default null,
  source_approval_event_id text default null,
  source_approved_at timestamptz default null,
  source_expires_at timestamptz default null,
  source_approval_actor_pubkey text default null,
  source_approval_raw_event_json jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  current_version bigint;
  current_approval_expires_at timestamptz;
  existing_command_hash text;
  existing_result jsonb;
  command_payload jsonb;
  computed_command_hash text;
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'lifecycle transition requires service_role';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_workspace_id::text || ':' || target_action_passport_id::text, 0)
  );
  select status, version, approval_expires_at
    into current_status, current_version, current_approval_expires_at
    from public.action_passports
    where workspace_id = target_workspace_id and id = target_action_passport_id
    for update;

  if not found then
    return jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'action_not_found', 'retryable', false
    ));
  end if;

  command_payload := jsonb_build_object(
    'workspaceId', target_workspace_id,
    'actionPassportId', target_action_passport_id,
    'expectedVersion', source_expected_version,
    'targetStatus', source_target_status,
    'commandId', source_command_id,
    'actorType', source_actor_type,
    'actorId', source_actor_id,
    'correlationId', source_correlation_id,
    'causationId', source_causation_id,
    'approvalEventId', source_approval_event_id,
    'approvedAt', source_approved_at,
    'expiresAt', source_expires_at,
    'approvalActorPubkey', source_approval_actor_pubkey,
    'approvalRawEvent', source_approval_raw_event_json
  );
  computed_command_hash := proofline_internal.sha256_json(command_payload);

  select command_hash, result_json
    into existing_command_hash, existing_result
    from public.lifecycle_command_receipts
    where workspace_id = target_workspace_id
      and action_passport_id = target_action_passport_id
      and command_id = source_command_id
    for update;

  if found then
    if existing_command_hash = computed_command_hash
      and source_command_hash = computed_command_hash then
      return existing_result || jsonb_build_object('replayed', true);
    end if;
    result := jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', case when source_command_hash <> computed_command_hash
        then 'command_hash_mismatch' else 'idempotency_conflict' end,
      'retryable', false
    ));
    perform proofline_internal.record_lifecycle_rejection(
      target_workspace_id, target_action_passport_id, source_command_id,
      computed_command_hash, result, source_actor_type, source_actor_id,
      source_correlation_id, source_causation_id
    );
    return result;
  end if;

  if source_command_hash is distinct from computed_command_hash then
    result := jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'command_hash_mismatch', 'retryable', false
    ));
    perform proofline_internal.record_lifecycle_rejection(
      target_workspace_id, target_action_passport_id, source_command_id,
      computed_command_hash, result, source_actor_type, source_actor_id,
      source_correlation_id, source_causation_id
    );
    return result;
  end if;

  if source_target_status not in (
    'DRAFT', 'CHALLENGE_REQUIRED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING',
    'SUCCEEDED', 'FAILED', 'EXPIRED', 'REVOKED', 'BLOCKED'
  ) or source_actor_type not in ('human', 'agent', 'worker', 'system') then
    result := jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'invalid_command', 'retryable', false
    ));
    perform proofline_internal.record_lifecycle_rejection(
      target_workspace_id, target_action_passport_id, source_command_id,
      computed_command_hash, result, source_actor_type, source_actor_id,
      source_correlation_id, source_causation_id
    );
    return result;
  end if;

  if current_version <> source_expected_version then
    result := jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'stale_version', 'retryable', true,
      'details', jsonb_build_object('expected', source_expected_version, 'actual', current_version)
    ));
    perform proofline_internal.record_lifecycle_rejection(
      target_workspace_id, target_action_passport_id, source_command_id,
      computed_command_hash, result, source_actor_type, source_actor_id,
      source_correlation_id, source_causation_id
    );
    return result;
  end if;

  if current_status in ('SUCCEEDED', 'FAILED', 'EXPIRED', 'REVOKED', 'BLOCKED') then
    result := jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'terminal_state', 'retryable', false
    ));
    perform proofline_internal.record_lifecycle_rejection(
      target_workspace_id, target_action_passport_id, source_command_id,
      computed_command_hash, result, source_actor_type, source_actor_id,
      source_correlation_id, source_causation_id
    );
    return result;
  end if;

  if source_target_status = 'APPROVED' then
    if source_approval_event_id is null or source_approved_at is null
      or source_expires_at is null or source_expires_at <= current_timestamp
      or source_approval_actor_pubkey !~ '^[0-9a-f]{64}$' then
      result := jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'approval_expired', 'retryable', false
      ));
      perform proofline_internal.record_lifecycle_rejection(
        target_workspace_id, target_action_passport_id, source_command_id,
        computed_command_hash, result, source_actor_type, source_actor_id,
        source_correlation_id, source_causation_id
      );
      return result;
    end if;
    if not public.is_valid_action_transition(current_status, 'APPROVED') then
      result := jsonb_build_object('ok', false, 'error', jsonb_build_object(
        'code', 'invalid_transition', 'retryable', false
      ));
      perform proofline_internal.record_lifecycle_rejection(
        target_workspace_id, target_action_passport_id, source_command_id,
        computed_command_hash, result, source_actor_type, source_actor_id,
        source_correlation_id, source_causation_id
      );
      return result;
    end if;
    insert into public.approval_events (
      workspace_id, action_passport_id, event_id, decision, actor_pubkey,
      approved_at, expires_at, raw_event_json, applied_at
    ) values (
      target_workspace_id, target_action_passport_id, source_approval_event_id,
      'approved', source_approval_actor_pubkey, source_approved_at,
      source_expires_at, source_approval_raw_event_json, current_timestamp
    ) on conflict (workspace_id, event_id) do nothing;
  elsif not public.is_valid_action_transition(current_status, source_target_status) then
    result := jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'invalid_transition', 'retryable', false
    ));
    perform proofline_internal.record_lifecycle_rejection(
      target_workspace_id, target_action_passport_id, source_command_id,
      computed_command_hash, result, source_actor_type, source_actor_id,
      source_correlation_id, source_causation_id
    );
    return result;
  elsif source_target_status = 'EXECUTING'
    and (current_approval_expires_at is null or current_approval_expires_at <= current_timestamp) then
    result := jsonb_build_object('ok', false, 'error', jsonb_build_object(
      'code', 'approval_expired', 'retryable', false
    ));
    perform proofline_internal.record_lifecycle_rejection(
      target_workspace_id, target_action_passport_id, source_command_id,
      computed_command_hash, result, source_actor_type, source_actor_id,
      source_correlation_id, source_causation_id
    );
    return result;
  end if;

  perform set_config('proofline.actor_type', source_actor_type, true);
  perform set_config('proofline.actor_id', coalesce(source_actor_id, ''), true);
  perform set_config('proofline.correlation_id', source_correlation_id::text, true);
  perform set_config('proofline.causation_id', coalesce(source_causation_id::text, ''), true);
  perform set_config('proofline.audit_event_id', (md5(source_command_id::text || ':transition'))::uuid::text, true);

  update public.action_passports
  set status = source_target_status,
      version = version + 1,
      approved_at = case when source_target_status = 'APPROVED' then source_approved_at else approved_at end,
      approval_expires_at = case when source_target_status = 'APPROVED' then source_expires_at else approval_expires_at end,
      updated_at = current_timestamp
  where workspace_id = target_workspace_id and id = target_action_passport_id;

  result := jsonb_build_object(
    'ok', true, 'replayed', false,
    'state', jsonb_build_object(
      'actionId', target_action_passport_id, 'workspaceId', target_workspace_id,
      'status', source_target_status, 'version', current_version + 1
    )
  );
  insert into public.lifecycle_command_receipts (
    workspace_id, action_passport_id, command_id, command_hash, result_json
  ) values (
    target_workspace_id, target_action_passport_id, source_command_id,
    computed_command_hash, result
  );
  return result;
end;
$$;

create or replace function public.record_action_passport_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.audit_events (
    id, workspace_id, actor_type, actor_id, event_type, aggregate_type,
    aggregate_id, before_hash, after_hash, metadata_json, occurred_at,
    correlation_id, causation_id
  ) values (
    coalesce(nullif(current_setting('proofline.audit_event_id', true), '')::uuid, public.gen_random_uuid()),
    new.workspace_id,
    coalesce(nullif(current_setting('proofline.actor_type', true), ''), 'system'),
    nullif(current_setting('proofline.actor_id', true), ''),
    case when tg_op = 'INSERT' then 'action_passport.created' else 'action_passport.transitioned' end,
    'action_passport', new.id,
    case when tg_op = 'INSERT' then null else proofline_internal.sha256_json(pg_catalog.to_jsonb(old)) end,
    proofline_internal.sha256_json(pg_catalog.to_jsonb(new)),
    pg_catalog.jsonb_build_object('status', new.status, 'version', new.version),
    current_timestamp,
    nullif(current_setting('proofline.correlation_id', true), '')::uuid,
    nullif(current_setting('proofline.causation_id', true), '')::uuid
  ) on conflict (id) do nothing;
  return new;
end;
$$;

revoke all on function public.transition_action(
  uuid, uuid, bigint, text, uuid, text, text, text, uuid, uuid,
  text, timestamptz, timestamptz, text, jsonb
) from public, anon, authenticated;
grant execute on function public.transition_action(
  uuid, uuid, bigint, text, uuid, text, text, text, uuid, uuid,
  text, timestamptz, timestamptz, text, jsonb
) to service_role;
