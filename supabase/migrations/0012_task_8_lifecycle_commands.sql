-- Task 8: server-authoritative lifecycle commands with replay-safe receipts.

alter table public.action_passports
  add column if not exists version bigint not null default 0;
alter table public.action_passports
  add constraint action_passports_version_nonnegative check (version >= 0);

create table if not exists public.lifecycle_command_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action_passport_id uuid not null,
  command_id uuid not null,
  command_hash text not null,
  result_json jsonb not null,
  created_at timestamptz not null default current_timestamp,
  unique (workspace_id, id),
  constraint lifecycle_command_receipts_workspace_command_key unique (workspace_id, action_passport_id, command_id),
  constraint lifecycle_command_receipts_command_hash_format check (command_hash ~ '^[0-9a-f]{64}$'),
  constraint lifecycle_command_receipts_result_object check (jsonb_typeof(result_json) = 'object'),
  constraint lifecycle_command_receipts_passport_workspace_fkey foreign key (workspace_id, action_passport_id)
    references public.action_passports(workspace_id, id) on delete restrict
);

alter table public.lifecycle_command_receipts enable row level security;
alter table public.lifecycle_command_receipts force row level security;
revoke all on table public.lifecycle_command_receipts from anon, authenticated;
grant select, insert, update, delete on table public.lifecycle_command_receipts to service_role;
create policy lifecycle_command_receipts_worker_write
  on public.lifecycle_command_receipts for all to service_role
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

-- The transition trigger remains the one audit writer. Commands set these
-- transaction-local values before their guarded update, preserving one audit
-- record per accepted transition with causal identifiers.
create or replace function public.record_action_passport_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
begin
  insert into public.audit_events (
    workspace_id, actor_type, actor_id, event_type, aggregate_type,
    aggregate_id, before_hash, after_hash, metadata_json, occurred_at,
    correlation_id, causation_id
  ) values (
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
  );
  return new;
end;
$$;

create or replace function public.transition_action(
  target_workspace_id uuid,
  target_action_passport_id uuid,
  source_expected_version bigint,
  source_target_status text,
  source_command_id uuid,
  source_command_hash text,
  source_actor_type text,
  source_actor_id text,
  source_correlation_id uuid,
  source_causation_id uuid default null
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
  result jsonb;
begin
  if auth.role() <> 'service_role' then
    raise exception 'lifecycle transition requires service_role';
  end if;

  if source_target_status not in (
    'DRAFT', 'CHALLENGE_REQUIRED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING',
    'SUCCEEDED', 'FAILED', 'EXPIRED', 'REVOKED', 'BLOCKED'
  ) or source_command_hash !~ '^[0-9a-f]{64}$'
    or source_actor_type not in ('human', 'agent', 'worker', 'system') then
    return jsonb_build_object(
      'ok', false, 'error', jsonb_build_object(
        'code', 'invalid_command', 'retryable', false
      )
    );
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(target_workspace_id::text || ':' || target_action_passport_id::text, 0)
  );

  select command_hash, result_json
    into existing_command_hash, existing_result
    from public.lifecycle_command_receipts
    where workspace_id = target_workspace_id
      and action_passport_id = target_action_passport_id
      and command_id = source_command_id
    for update;

  if found then
    if existing_command_hash = source_command_hash then
      return existing_result || jsonb_build_object('replayed', true);
    end if;
    return jsonb_build_object(
      'ok', false, 'error', jsonb_build_object(
        'code', 'idempotency_conflict', 'retryable', false
      )
    );
  end if;

  select status, version, approval_expires_at
    into current_status, current_version, current_approval_expires_at
    from public.action_passports
    where workspace_id = target_workspace_id and id = target_action_passport_id
    for update;

  if not found then
    return jsonb_build_object(
      'ok', false, 'error', jsonb_build_object(
        'code', 'action_not_found', 'retryable', false
      )
    );
  end if;

  if current_version <> source_expected_version then
    return jsonb_build_object(
      'ok', false, 'error', jsonb_build_object(
        'code', 'stale_version', 'retryable', true,
        'details', jsonb_build_object('expected', source_expected_version, 'actual', current_version)
      )
    );
  end if;

  if current_status in ('SUCCEEDED', 'FAILED', 'EXPIRED', 'REVOKED', 'BLOCKED') then
    return jsonb_build_object(
      'ok', false, 'error', jsonb_build_object(
        'code', 'terminal_state', 'retryable', false
      )
    );
  end if;

  if source_target_status = 'APPROVED' then
    return jsonb_build_object(
      'ok', false, 'error', jsonb_build_object(
        'code', 'approval_required', 'retryable', false
      )
    );
  end if;

  if source_target_status = 'EXECUTING'
    and (current_approval_expires_at is null or current_approval_expires_at <= current_timestamp) then
    return jsonb_build_object(
      'ok', false, 'error', jsonb_build_object(
        'code', 'approval_expired', 'retryable', false
      )
    );
  end if;

  if not public.is_valid_action_transition(current_status, source_target_status) then
    return jsonb_build_object(
      'ok', false, 'error', jsonb_build_object(
        'code', 'invalid_transition', 'retryable', false,
        'details', jsonb_build_object('from', current_status, 'to', source_target_status)
      )
    );
  end if;

  perform set_config('proofline.actor_type', source_actor_type, true);
  perform set_config('proofline.actor_id', coalesce(source_actor_id, ''), true);
  perform set_config('proofline.correlation_id', source_correlation_id::text, true);
  perform set_config('proofline.causation_id', coalesce(source_causation_id::text, ''), true);

  update public.action_passports
    set status = source_target_status,
        version = version + 1,
        updated_at = current_timestamp
    where workspace_id = target_workspace_id and id = target_action_passport_id;

  result := jsonb_build_object(
    'ok', true,
    'replayed', false,
    'state', jsonb_build_object(
      'actionId', target_action_passport_id,
      'workspaceId', target_workspace_id,
      'status', source_target_status,
      'version', current_version + 1
    )
  );

  insert into public.lifecycle_command_receipts (
    workspace_id, action_passport_id, command_id, command_hash, result_json
  ) values (
    target_workspace_id, target_action_passport_id, source_command_id, source_command_hash, result
  );

  return result;
end;
$$;

revoke all on function public.transition_action(
  uuid, uuid, bigint, text, uuid, text, text, text, uuid, uuid
) from public, anon, authenticated;
grant execute on function public.transition_action(
  uuid, uuid, bigint, text, uuid, text, text, text, uuid, uuid
) to service_role;
