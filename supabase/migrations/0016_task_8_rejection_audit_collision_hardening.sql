-- Task 8 fix round 5: rejection audit identity includes the canonical command
-- result and fails loudly if a distinct audit row ever shares its UUID.

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
      and metadata_json = result
  ) then
    raise exception 'audit id collision';
  end if;
end;
$$;

revoke all on function proofline_internal.record_lifecycle_rejection(
  uuid, uuid, uuid, text, jsonb, text, text, uuid, uuid
) from public;
