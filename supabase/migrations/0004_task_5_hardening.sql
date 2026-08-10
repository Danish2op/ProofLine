-- Forward-only Task 5 hardening for already-migrated Supabase projects.
drop trigger if exists action_passports_guard_update on public.action_passports;
drop function if exists public.guard_action_passport_update();

create or replace function public.guard_action_passport_write()
returns trigger
language plpgsql
set search_path = public
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

    if new.status in ('APPROVED', 'EXECUTING', 'SUCCEEDED')
      and (new.approved_at is null or new.approval_expires_at is null or new.approval_expires_at <= current_timestamp)
    then
      raise exception 'approved action requires an unexpired approval';
    end if;

    new.updated_at := current_timestamp;
  end if;

  return new;
end;
$$;

create trigger action_passports_guard_write
before insert or update on public.action_passports
for each row execute function public.guard_action_passport_write();

-- Supabase Data API access requires grants as well as RLS. Explicit grants
-- make the API surface stable even on projects created with secure defaults.
revoke all on schema public from anon;
revoke all privileges on table
  public.workspaces,
  public.workspace_members,
  public.agents,
  public.tool_definitions,
  public.policies,
  public.action_passports,
  public.action_revisions,
  public.evidence_items,
  public.approval_events,
  public.execution_attempts,
  public.execution_receipts,
  public.buzz_events,
  public.audit_events,
  public.outbox_jobs,
  public.demo_runs
from anon, authenticated;

grant usage on schema public to authenticated;
grant select on table
  public.workspaces,
  public.workspace_members,
  public.agents,
  public.tool_definitions,
  public.policies,
  public.action_passports,
  public.action_revisions,
  public.evidence_items,
  public.approval_events,
  public.execution_attempts,
  public.execution_receipts,
  public.buzz_events,
  public.audit_events,
  public.outbox_jobs,
  public.demo_runs
to authenticated;
grant insert on table public.action_passports, public.approval_events, public.demo_runs to authenticated;
grant execute on function public.is_workspace_member(uuid, text[]) to authenticated;
grant execute on function public.is_valid_action_transition(text, text) to authenticated;

revoke execute on function public.guard_action_passport_write() from public;
revoke execute on function public.guard_approval_event() from public;
revoke execute on function public.reject_audit_event_mutation() from public;
revoke execute on function public.record_action_passport_audit() from public;

grant usage on schema public to service_role;
grant select, insert, update, delete on table
  public.workspaces,
  public.workspace_members,
  public.agents,
  public.tool_definitions,
  public.policies,
  public.action_passports,
  public.action_revisions,
  public.evidence_items,
  public.approval_events,
  public.execution_attempts,
  public.execution_receipts,
  public.buzz_events,
  public.audit_events,
  public.outbox_jobs,
  public.demo_runs
to service_role;
grant execute on function public.is_workspace_member(uuid, text[]) to service_role;
grant execute on function public.is_valid_action_transition(text, text) to service_role;
