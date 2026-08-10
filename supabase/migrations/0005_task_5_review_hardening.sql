-- Forward-only hardening for Task 5 review round 2.
create or replace function public.guard_action_passport_write()
returns trigger
language plpgsql
set search_path = pg_catalog, pg_temp
as $$
begin
  if tg_op = 'INSERT' and new.status <> 'DRAFT' then
    raise exception 'new action passports must start in DRAFT';
  end if;

  if tg_op = 'INSERT'
    and (new.approved_at is not null or new.approval_expires_at is not null)
  then
    raise exception 'new action passports may not include an approval';
  end if;

  if tg_op = 'UPDATE' then
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

    if old.status is distinct from new.status
      and new.status in ('APPROVED', 'EXECUTING')
      and (new.approved_at is null or new.approval_expires_at is null or new.approval_expires_at <= current_timestamp)
    then
      raise exception 'approved action requires an unexpired approval';
    end if;

    new.updated_at := current_timestamp;
  end if;

  return new;
end;
$$;

create or replace function public.is_workspace_member(
  target_workspace_id uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, pg_temp
as $$
  select exists (
    select 1
    from public.workspace_members as membership
    where membership.workspace_id = target_workspace_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and (allowed_roles is null or membership.role = any(allowed_roles))
  );
$$;

create schema if not exists proofline_internal;
revoke all on schema proofline_internal from public;

create or replace function proofline_internal.sha256_json(payload jsonb)
returns text
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  pgcrypto_schema name;
  result_hash text;
begin
  select namespace.nspname
  into pgcrypto_schema
  from pg_catalog.pg_extension as extension
  join pg_catalog.pg_namespace as namespace on namespace.oid = extension.extnamespace
  where extension.extname = 'pgcrypto';

  if pgcrypto_schema is null then
    raise exception 'pgcrypto extension is required for Proofline audit hashing';
  end if;

  if pg_catalog.to_regprocedure(
    pg_catalog.format('%I.digest(bytea,text)', pgcrypto_schema)
  ) is null then
    raise exception 'pgcrypto digest(bytea,text) is required for Proofline audit hashing';
  end if;

  execute pg_catalog.format(
    'select pg_catalog.encode(%I.digest(pg_catalog.convert_to($1, ''UTF8''), ''sha256''), ''hex'')',
    pgcrypto_schema
  ) into result_hash using payload::text;

  return result_hash;
end;
$$;

revoke all on function proofline_internal.sha256_json(jsonb) from public;

create or replace function public.record_action_passport_audit()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
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
    case when tg_op = 'INSERT' then null else proofline_internal.sha256_json(pg_catalog.to_jsonb(old)) end,
    proofline_internal.sha256_json(pg_catalog.to_jsonb(new)),
    pg_catalog.jsonb_build_object('status', new.status),
    current_timestamp,
    null,
    null
  );
  return new;
end;
$$;

create or replace function public.cleanup_demo_run(target_demo_run_id uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, pg_temp
as $$
declare
  target_workspace_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'demo run cleanup requires service_role';
  end if;

  select workspace_id
  into target_workspace_id
  from public.demo_runs
  where id = target_demo_run_id
  for update;

  if not found then
    return;
  end if;

  insert into public.audit_events (
    workspace_id, actor_type, actor_id, event_type, aggregate_type,
    aggregate_id, before_hash, after_hash, metadata_json, occurred_at,
    correlation_id, causation_id
  ) values (
    target_workspace_id, 'worker', null, 'demo_run.cleaned_up', 'demo_run',
    target_demo_run_id, null, null,
    pg_catalog.jsonb_build_object('synthetic', true), current_timestamp,
    null, null
  );

  delete from public.execution_receipts as receipt
  using public.execution_attempts as attempt, public.action_passports as passport
  where receipt.workspace_id = target_workspace_id
    and receipt.execution_attempt_id = attempt.id
    and attempt.workspace_id = target_workspace_id
    and attempt.action_passport_id = passport.id
    and passport.workspace_id = target_workspace_id
    and passport.demo_run_id = target_demo_run_id;

  delete from public.execution_attempts as attempt
  using public.action_passports as passport
  where attempt.workspace_id = target_workspace_id
    and attempt.action_passport_id = passport.id
    and passport.workspace_id = target_workspace_id
    and passport.demo_run_id = target_demo_run_id;

  delete from public.evidence_items as evidence
  using public.action_passports as passport
  where evidence.workspace_id = target_workspace_id
    and evidence.action_passport_id = passport.id
    and passport.workspace_id = target_workspace_id
    and passport.demo_run_id = target_demo_run_id;

  delete from public.approval_events as approval
  using public.action_passports as passport
  where approval.workspace_id = target_workspace_id
    and approval.action_passport_id = passport.id
    and passport.workspace_id = target_workspace_id
    and passport.demo_run_id = target_demo_run_id;

  delete from public.buzz_events as buzz
  using public.action_passports as passport
  where buzz.workspace_id = target_workspace_id
    and buzz.action_passport_id = passport.id
    and passport.workspace_id = target_workspace_id
    and passport.demo_run_id = target_demo_run_id;

  delete from public.outbox_jobs as outbox
  using public.action_passports as passport
  where outbox.workspace_id = target_workspace_id
    and outbox.action_passport_id = passport.id
    and passport.workspace_id = target_workspace_id
    and passport.demo_run_id = target_demo_run_id;

  delete from public.action_revisions as revision
  using public.action_passports as passport
  where revision.workspace_id = target_workspace_id
    and revision.action_passport_id = passport.id
    and passport.workspace_id = target_workspace_id
    and passport.demo_run_id = target_demo_run_id;

  delete from public.action_passports
  where workspace_id = target_workspace_id
    and demo_run_id = target_demo_run_id;

  delete from public.demo_runs
  where id = target_demo_run_id
    and workspace_id = target_workspace_id;
end;
$$;

revoke all on function public.is_workspace_member(uuid, text[]) from public;
revoke all on function public.record_action_passport_audit() from public;
revoke all on function public.cleanup_demo_run(uuid) from public;
grant execute on function public.is_workspace_member(uuid, text[]) to authenticated, service_role;
grant execute on function public.cleanup_demo_run(uuid) to service_role;
