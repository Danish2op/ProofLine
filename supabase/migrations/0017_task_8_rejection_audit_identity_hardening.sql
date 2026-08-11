-- Task 8 final remediation: an existing deterministic rejection-audit UUID is
-- an exact replay only when every deterministic field owned by this function
-- matches. occurred_at is intentionally excluded because it is insertion time.

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
    md5(
      target_workspace_id::text || ':' ||
      target_action_passport_id::text || ':' ||
      source_command_id::text || ':' ||
      computed_command_hash || ':' ||
      result::text || ':rejected'
    )
  )::uuid;
  audit_actor_type text := case
    when source_actor_type in ('human', 'agent', 'worker', 'system')
      then source_actor_type
    else 'system'
  end;
  audit_metadata jsonb := jsonb_build_object(
    'commandId', source_command_id,
    'commandHash', computed_command_hash,
    'result', result
  );
  existing_command_hash text;
  existing_result jsonb;
  existing_receipt_found boolean := false;
  existing_audit_workspace_id uuid;
  existing_audit_actor_type text;
  existing_audit_actor_id text;
  existing_audit_event_type text;
  existing_audit_aggregate_type text;
  existing_audit_aggregate_id uuid;
  existing_audit_before_hash text;
  existing_audit_after_hash text;
  existing_audit_metadata jsonb;
  existing_audit_correlation_id uuid;
  existing_audit_causation_id uuid;
  existing_audit_found boolean := false;
begin
  perform pg_advisory_xact_lock(
    hashtextextended(
      target_workspace_id::text || ':' || target_action_passport_id::text,
      0
    )
  );
  perform pg_advisory_xact_lock(
    hashtextextended('rejection-audit:' || audit_id::text, 0)
  );

  select command_hash, result_json, true
    into existing_command_hash, existing_result, existing_receipt_found
  from public.lifecycle_command_receipts
  where workspace_id = target_workspace_id
    and action_passport_id = target_action_passport_id
    and command_id = source_command_id
  for update;

  if existing_receipt_found then
    if existing_command_hash is distinct from computed_command_hash
      or existing_result is distinct from result then
      raise exception 'lifecycle rejection idempotency conflict';
    end if;
  else
    insert into public.lifecycle_command_receipts (
      workspace_id, action_passport_id, command_id, command_hash, result_json
    ) values (
      target_workspace_id, target_action_passport_id, source_command_id,
      computed_command_hash, result
    );
  end if;

  select
    workspace_id,
    actor_type,
    actor_id,
    event_type,
    aggregate_type,
    aggregate_id,
    before_hash,
    after_hash,
    metadata_json,
    correlation_id,
    causation_id,
    true
  into
    existing_audit_workspace_id,
    existing_audit_actor_type,
    existing_audit_actor_id,
    existing_audit_event_type,
    existing_audit_aggregate_type,
    existing_audit_aggregate_id,
    existing_audit_before_hash,
    existing_audit_after_hash,
    existing_audit_metadata,
    existing_audit_correlation_id,
    existing_audit_causation_id,
    existing_audit_found
  from public.audit_events
  where id = audit_id
  for update;

  if existing_audit_found then
    if existing_audit_workspace_id is distinct from target_workspace_id
      or existing_audit_actor_type is distinct from audit_actor_type
      or existing_audit_actor_id is distinct from source_actor_id
      or existing_audit_event_type is distinct from 'action_command.rejected'
      or existing_audit_aggregate_type is distinct from 'action_passport'
      or existing_audit_aggregate_id is distinct from target_action_passport_id
      or existing_audit_before_hash is not null
      or existing_audit_after_hash is not null
      or existing_audit_metadata is distinct from audit_metadata
      or existing_audit_correlation_id is distinct from source_correlation_id
      or existing_audit_causation_id is distinct from source_causation_id then
      raise exception 'lifecycle rejection audit collision';
    end if;
    return;
  end if;

  insert into public.audit_events (
    id, workspace_id, actor_type, actor_id, event_type, aggregate_type,
    aggregate_id, metadata_json, occurred_at, correlation_id, causation_id
  ) values (
    audit_id, target_workspace_id, audit_actor_type, source_actor_id,
    'action_command.rejected', 'action_passport', target_action_passport_id,
    audit_metadata, current_timestamp, source_correlation_id,
    source_causation_id
  );
end;
$$;

revoke all on function proofline_internal.record_lifecycle_rejection(
  uuid, uuid, uuid, text, jsonb, text, text, uuid, uuid
) from public;
