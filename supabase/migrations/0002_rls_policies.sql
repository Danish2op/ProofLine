create function public.is_workspace_member(
  target_workspace_id uuid,
  allowed_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = public, auth
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

revoke all on function public.is_workspace_member(uuid, text[]) from public;
grant execute on function public.is_workspace_member(uuid, text[]) to authenticated, service_role;

alter table public.workspaces enable row level security;
alter table public.workspaces force row level security;
alter table public.workspace_members enable row level security;
alter table public.workspace_members force row level security;
alter table public.agents enable row level security;
alter table public.agents force row level security;
alter table public.tool_definitions enable row level security;
alter table public.tool_definitions force row level security;
alter table public.policies enable row level security;
alter table public.policies force row level security;
alter table public.action_passports enable row level security;
alter table public.action_passports force row level security;
alter table public.action_revisions enable row level security;
alter table public.action_revisions force row level security;
alter table public.evidence_items enable row level security;
alter table public.evidence_items force row level security;
alter table public.approval_events enable row level security;
alter table public.approval_events force row level security;
alter table public.execution_attempts enable row level security;
alter table public.execution_attempts force row level security;
alter table public.execution_receipts enable row level security;
alter table public.execution_receipts force row level security;
alter table public.buzz_events enable row level security;
alter table public.buzz_events force row level security;
alter table public.audit_events enable row level security;
alter table public.audit_events force row level security;
alter table public.outbox_jobs enable row level security;
alter table public.outbox_jobs force row level security;
alter table public.demo_runs enable row level security;
alter table public.demo_runs force row level security;

revoke all on table public.workspaces from anon;
revoke all on table public.workspace_members from anon;
revoke all on table public.agents from anon;
revoke all on table public.tool_definitions from anon;
revoke all on table public.policies from anon;
revoke all on table public.action_passports from anon;
revoke all on table public.action_revisions from anon;
revoke all on table public.evidence_items from anon;
revoke all on table public.approval_events from anon;
revoke all on table public.execution_attempts from anon;
revoke all on table public.execution_receipts from anon;
revoke all on table public.buzz_events from anon;
revoke all on table public.audit_events from anon;
revoke all on table public.outbox_jobs from anon;
revoke all on table public.demo_runs from anon;

create policy workspaces_member_read on public.workspaces for select to authenticated using (public.is_workspace_member(id));
create policy workspace_members_member_read on public.workspace_members for select to authenticated using (public.is_workspace_member(workspace_id));
create policy agents_member_read on public.agents for select to authenticated using (public.is_workspace_member(workspace_id));
create policy tool_definitions_member_read on public.tool_definitions for select to authenticated using (public.is_workspace_member(workspace_id));
create policy policies_member_read on public.policies for select to authenticated using (public.is_workspace_member(workspace_id));
create policy action_passports_member_read on public.action_passports for select to authenticated using (public.is_workspace_member(workspace_id));
create policy action_revisions_member_read on public.action_revisions for select to authenticated using (public.is_workspace_member(workspace_id));
create policy evidence_items_member_read on public.evidence_items for select to authenticated using (public.is_workspace_member(workspace_id));
create policy approval_events_member_read on public.approval_events for select to authenticated using (public.is_workspace_member(workspace_id));
create policy execution_attempts_member_read on public.execution_attempts for select to authenticated using (public.is_workspace_member(workspace_id));
create policy execution_receipts_member_read on public.execution_receipts for select to authenticated using (public.is_workspace_member(workspace_id));
create policy buzz_events_member_read on public.buzz_events for select to authenticated using (public.is_workspace_member(workspace_id));
create policy audit_events_member_read on public.audit_events for select to authenticated using (public.is_workspace_member(workspace_id));
create policy outbox_jobs_member_read on public.outbox_jobs for select to authenticated using (public.is_workspace_member(workspace_id));
create policy demo_runs_member_read on public.demo_runs for select to authenticated using (public.is_workspace_member(workspace_id));

create policy action_passports_proposer_insert on public.action_passports for insert to authenticated with check (public.is_workspace_member(workspace_id, array['owner', 'admin', 'proposer']));
create policy approval_events_reviewer_insert on public.approval_events for insert to authenticated with check (public.is_workspace_member(workspace_id, array['owner', 'admin', 'reviewer']));
create policy demo_runs_member_insert on public.demo_runs for insert to authenticated with check (public.is_workspace_member(workspace_id));

create policy workspaces_worker_write on public.workspaces for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy workspace_members_worker_write on public.workspace_members for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy agents_worker_write on public.agents for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy tool_definitions_worker_write on public.tool_definitions for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy policies_worker_write on public.policies for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy action_passports_worker_write on public.action_passports for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy action_revisions_worker_write on public.action_revisions for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy evidence_items_worker_write on public.evidence_items for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy approval_events_worker_write on public.approval_events for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy execution_attempts_worker_write on public.execution_attempts for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy execution_receipts_worker_write on public.execution_receipts for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy buzz_events_worker_write on public.buzz_events for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy audit_events_worker_insert on public.audit_events for insert to service_role with check (auth.role() = 'service_role');
create policy outbox_jobs_worker_write on public.outbox_jobs for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy demo_runs_worker_write on public.demo_runs for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
