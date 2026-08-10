-- Task 7: server-owned reviewer identities and append-only Buzz provenance.
-- This migration is intentionally forward-only; 0001 is already applied.

create table public.buzz_reviewer_identities (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  pubkey text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (workspace_id, id),
  constraint buzz_reviewer_identities_workspace_pubkey_key unique (workspace_id, pubkey),
  constraint buzz_reviewer_identities_pubkey_format check (pubkey ~ '^[0-9a-f]{64}$'),
  constraint buzz_reviewer_identities_revocation_shape check (
    (active and revoked_at is null) or (not active and revoked_at is not null)
  )
);

create table public.buzz_event_provenance (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action_passport_id uuid,
  buzz_event_id text not null,
  proposal_event_id text,
  channel_id text,
  relay_url text not null,
  signer_pubkey text not null,
  event_kind integer not null,
  event_created_at bigint not null,
  raw_event_hash text not null,
  signature_verified boolean not null,
  raw_event_json jsonb not null,
  received_at timestamptz not null default now(),
  applied_at timestamptz,
  processing_status text not null default 'received',
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint buzz_event_provenance_workspace_event_key unique (workspace_id, buzz_event_id),
  constraint buzz_event_provenance_workspace_passport_fkey foreign key (workspace_id, action_passport_id) references public.action_passports(workspace_id, id) on delete cascade,
  constraint buzz_event_provenance_event_id_format check (buzz_event_id ~ '^[0-9a-f]{64}$'),
  constraint buzz_event_provenance_proposal_id_format check (proposal_event_id is null or proposal_event_id ~ '^[0-9a-f]{64}$'),
  constraint buzz_event_provenance_signer_format check (signer_pubkey ~ '^[0-9a-f]{64}$'),
  constraint buzz_event_provenance_hash_format check (raw_event_hash ~ '^[0-9a-f]{64}$'),
  constraint buzz_event_provenance_kind_check check (event_kind >= 0),
  constraint buzz_event_provenance_created_at_check check (event_created_at >= 0),
  constraint buzz_event_provenance_relay_url_check check (relay_url ~ '^wss?://'),
  constraint buzz_event_provenance_raw_event_object check (jsonb_typeof(raw_event_json) = 'object'),
  constraint buzz_event_provenance_status_check check (processing_status in ('received', 'applied', 'duplicate', 'rejected'))
);

create index buzz_reviewer_identities_active_workspace_idx
  on public.buzz_reviewer_identities (workspace_id, pubkey)
  where active;
create index buzz_event_provenance_proposal_idx
  on public.buzz_event_provenance (workspace_id, proposal_event_id, received_at desc);

alter table public.buzz_reviewer_identities enable row level security;
alter table public.buzz_reviewer_identities force row level security;
alter table public.buzz_event_provenance enable row level security;
alter table public.buzz_event_provenance force row level security;

revoke all on table public.buzz_reviewer_identities from anon, authenticated;
revoke all on table public.buzz_event_provenance from anon, authenticated;
grant select, insert, update, delete on table public.buzz_reviewer_identities to service_role;
grant select on table public.buzz_event_provenance to authenticated;
grant select, insert, update, delete on table public.buzz_event_provenance to service_role;

create policy buzz_reviewer_identities_service_only on public.buzz_reviewer_identities
  for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
create policy buzz_event_provenance_member_read on public.buzz_event_provenance
  for select to authenticated using (public.is_workspace_member(workspace_id));
create policy buzz_event_provenance_service_write on public.buzz_event_provenance
  for all to service_role using (auth.role() = 'service_role') with check (auth.role() = 'service_role');

create function public.record_buzz_event_provenance(
  target_workspace_id uuid,
  target_action_passport_id uuid,
  source_event_id text,
  source_proposal_event_id text,
  source_channel_id text,
  source_relay_url text,
  source_signer_pubkey text,
  source_event_kind integer,
  source_event_created_at bigint,
  source_raw_event_hash text,
  source_signature_verified boolean,
  source_raw_event_json jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.buzz_event_provenance (
    workspace_id, action_passport_id, buzz_event_id, proposal_event_id,
    channel_id, relay_url, signer_pubkey, event_kind, event_created_at,
    raw_event_hash, signature_verified, raw_event_json
  ) values (
    target_workspace_id, target_action_passport_id, source_event_id,
    source_proposal_event_id, source_channel_id, source_relay_url,
    source_signer_pubkey, source_event_kind, source_event_created_at,
    source_raw_event_hash, source_signature_verified, source_raw_event_json
  ) on conflict (workspace_id, buzz_event_id) do nothing;

  if found then
    return 'stored';
  end if;
  return 'duplicate';
end;
$$;

revoke all on function public.record_buzz_event_provenance(uuid, uuid, text, text, text, text, text, integer, bigint, text, boolean, jsonb) from public, anon, authenticated;
grant execute on function public.record_buzz_event_provenance(uuid, uuid, text, text, text, text, text, integer, bigint, text, boolean, jsonb) to service_role;

create function public.apply_buzz_approval_transition(
  target_workspace_id uuid,
  target_action_passport_id uuid,
  source_event_id text,
  source_decision text,
  source_actor_pubkey text,
  source_approved_at timestamptz,
  source_expires_at timestamptz,
  source_raw_event_json jsonb
)
returns text
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  current_status text;
  target_status text;
begin
  select status into current_status
  from public.action_passports
  where workspace_id = target_workspace_id and id = target_action_passport_id
  for update;

  if current_status is null then
    raise exception 'action passport is not in the requested workspace';
  end if;

  if source_decision = 'approved' then
    target_status := 'APPROVED';
  elsif source_decision in ('rejected', 'request_changes') then
    target_status := 'BLOCKED';
  else
    raise exception 'unsupported Buzz approval decision';
  end if;

  if current_status <> 'PENDING_APPROVAL'
    or not public.is_valid_lifecycle_transition(current_status, target_status) then
    return 'recorded_unapplied';
  end if;

  insert into public.approval_events (
    workspace_id, action_passport_id, event_id, decision, actor_pubkey,
    approved_at, expires_at, raw_event_json, applied_at
  ) values (
    target_workspace_id, target_action_passport_id, source_event_id,
    case when source_decision = 'approved' then 'approved' else 'rejected' end,
    source_actor_pubkey, source_approved_at, source_expires_at,
    source_raw_event_json, current_timestamp
  ) on conflict (workspace_id, event_id) do nothing;

  if not found then
    return 'duplicate';
  end if;

  update public.action_passports
  set status = target_status,
      approved_at = case when target_status = 'APPROVED' then source_approved_at else approved_at end,
      approval_expires_at = case when target_status = 'APPROVED' then source_expires_at else approval_expires_at end,
      updated_at = current_timestamp
  where workspace_id = target_workspace_id and id = target_action_passport_id;

  return 'applied';
end;
$$;

revoke all on function public.apply_buzz_approval_transition(uuid, uuid, text, text, text, timestamptz, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_buzz_approval_transition(uuid, uuid, text, text, text, timestamptz, timestamptz, jsonb) to service_role;
