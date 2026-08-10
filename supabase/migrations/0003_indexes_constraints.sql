create function public.is_valid_action_transition(previous_status text, next_status text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select case previous_status
    when 'DRAFT' then next_status in ('CHALLENGE_REQUIRED', 'PENDING_APPROVAL', 'EXPIRED', 'REVOKED', 'BLOCKED')
    when 'CHALLENGE_REQUIRED' then next_status in ('PENDING_APPROVAL', 'EXPIRED', 'REVOKED', 'BLOCKED')
    when 'PENDING_APPROVAL' then next_status in ('APPROVED', 'EXPIRED', 'REVOKED', 'BLOCKED')
    when 'APPROVED' then next_status in ('EXECUTING', 'EXPIRED', 'REVOKED', 'BLOCKED')
    when 'EXECUTING' then next_status in ('SUCCEEDED', 'FAILED', 'BLOCKED')
    else false
  end;
$$;

create function public.guard_action_passport_update()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.workspace_id is distinct from new.workspace_id
    or old.action_id is distinct from new.action_id
    or old.passport_hash is distinct from new.passport_hash
    or old.agent_id is distinct from new.agent_id
    or old.tool_definition_id is distinct from new.tool_definition_id
    or old.policy_id is distinct from new.policy_id
    or old.demo_run_id is distinct from new.demo_run_id
    or old.target is distinct from new.target
    or old.environment is distinct from new.environment
    or old.normalized_arguments is distinct from new.normalized_arguments
    or old.idempotency_key is distinct from new.idempotency_key
    or old.approval_required is distinct from new.approval_required
  then
    raise exception 'action passport fields are immutable after creation';
  end if;

  if old.status is distinct from new.status
    and not public.is_valid_action_transition(old.status, new.status)
  then
    raise exception 'invalid action lifecycle transition from % to %', old.status, new.status;
  end if;

  if new.status in ('APPROVED', 'EXECUTING', 'SUCCEEDED')
    and (new.approved_at is null or new.approval_expires_at is null or new.approval_expires_at <= current_timestamp)
  then
    raise exception 'approved action requires an unexpired approval';
  end if;

  new.updated_at := current_timestamp;
  return new;
end;
$$;

create trigger action_passports_guard_update
before update on public.action_passports
for each row execute function public.guard_action_passport_update();

create function public.guard_approval_event()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.expires_at <= current_timestamp then
    raise exception 'approval event is expired at insertion time';
  end if;
  return new;
end;
$$;

create trigger approval_events_guard_expiry
before insert or update on public.approval_events
for each row execute function public.guard_approval_event();

create function public.reject_audit_event_mutation()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'audit events are append-only';
end;
$$;

create trigger audit_events_reject_mutation
before update or delete on public.audit_events
for each row execute function public.reject_audit_event_mutation();

create function public.record_action_passport_audit()
returns trigger
language plpgsql
security definer
set search_path = public, pg_catalog
as $$
begin
  insert into public.audit_events (
    workspace_id,
    actor_type,
    actor_id,
    event_type,
    aggregate_type,
    aggregate_id,
    before_hash,
    after_hash,
    metadata_json,
    occurred_at,
    correlation_id,
    causation_id
  ) values (
    new.workspace_id,
    'system',
    null,
    case when tg_op = 'INSERT' then 'action_passport.created' else 'action_passport.transitioned' end,
    'action_passport',
    new.id,
    case when tg_op = 'INSERT' then null else encode(digest(to_jsonb(old)::text, 'sha256'), 'hex') end,
    encode(digest(to_jsonb(new)::text, 'sha256'), 'hex'),
    jsonb_build_object('status', new.status),
    current_timestamp,
    null,
    null
  );
  return new;
end;
$$;

create trigger action_passports_audit
after insert or update on public.action_passports
for each row execute function public.record_action_passport_audit();

create index action_passports_workspace_created_at_idx on public.action_passports (workspace_id, created_at desc);
create index action_passports_workspace_status_idx on public.action_passports (workspace_id, status);
create index action_passports_workspace_idempotency_idx on public.action_passports (workspace_id, idempotency_key);
create index action_passports_workspace_passport_hash_idx on public.action_passports (workspace_id, passport_hash);
create index buzz_events_workspace_event_id_idx on public.buzz_events (workspace_id, buzz_event_id);
create index outbox_jobs_claim_idx on public.outbox_jobs (available_at, locked_at, locked_by);
create index audit_events_workspace_occurred_at_idx on public.audit_events (workspace_id, occurred_at desc);
create index approval_events_workspace_passport_idx on public.approval_events (workspace_id, action_passport_id, approved_at desc);
