create extension if not exists pgcrypto;

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  name text not null,
  is_synthetic boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspaces_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,62}$')
);

create table public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role text not null,
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint workspace_members_workspace_user_key unique (workspace_id, user_id),
  constraint workspace_members_role_check check (role in ('owner', 'admin', 'proposer', 'verifier', 'reviewer', 'auditor')),
  constraint workspace_members_status_check check (status in ('active', 'suspended', 'removed'))
);

create table public.agents (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  pubkey text not null,
  display_name text not null,
  status text not null default 'active',
  delegated_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint agents_workspace_pubkey_key unique (workspace_id, pubkey),
  constraint agents_pubkey_format check (pubkey ~ '^[0-9a-f]{64}$'),
  constraint agents_delegated_by_format check (delegated_by is null or delegated_by ~ '^[0-9a-f]{64}$'),
  constraint agents_status_check check (status in ('active', 'revoked'))
);

create table public.tool_definitions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  name text not null,
  definition_hash text not null,
  metadata_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint tool_definitions_workspace_hash_key unique (workspace_id, definition_hash),
  constraint tool_definitions_hash_format check (definition_hash ~ '^[0-9a-f]{64}$'),
  constraint tool_definitions_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create table public.policies (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  version text not null,
  document_json jsonb not null,
  snapshot_hash text not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint policies_workspace_version_key unique (workspace_id, version),
  constraint policies_snapshot_hash_format check (snapshot_hash ~ '^[0-9a-f]{64}$'),
  constraint policies_document_object check (jsonb_typeof(document_json) = 'object')
);

create table public.demo_runs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  label text not null,
  reset_key text not null,
  state text not null default 'ready',
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (workspace_id, id),
  constraint demo_runs_workspace_reset_key_key unique (workspace_id, reset_key),
  constraint demo_runs_state_check check (state in ('ready', 'running', 'completed', 'failed'))
);

create table public.action_passports (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action_id uuid not null,
  passport_hash text not null,
  status text not null default 'DRAFT',
  agent_id uuid not null,
  tool_definition_id uuid not null,
  policy_id uuid not null,
  demo_run_id uuid,
  target text not null,
  environment text not null,
  normalized_arguments jsonb not null,
  idempotency_key text not null,
  approval_required boolean not null,
  approved_at timestamptz,
  approval_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint action_passports_workspace_action_key unique (workspace_id, action_id),
  constraint action_passports_workspace_idempotency_key unique (workspace_id, idempotency_key),
  constraint action_passports_workspace_passport_hash_key unique (workspace_id, passport_hash),
  constraint action_passports_passport_hash_format check (passport_hash ~ '^[0-9a-f]{64}$'),
  constraint action_passports_status_check check (status in ('DRAFT', 'CHALLENGE_REQUIRED', 'PENDING_APPROVAL', 'APPROVED', 'EXECUTING', 'SUCCEEDED', 'FAILED', 'EXPIRED', 'REVOKED', 'BLOCKED')),
  constraint action_passports_approval_shape check (
    (approval_required and (approved_at is null or approval_expires_at is null or approval_expires_at > approved_at))
    or (not approval_required and approved_at is null and approval_expires_at is null)
  ),
  constraint action_passports_agent_workspace_fkey foreign key (workspace_id, agent_id) references public.agents(workspace_id, id) on delete restrict,
  constraint action_passports_tool_workspace_fkey foreign key (workspace_id, tool_definition_id) references public.tool_definitions(workspace_id, id) on delete restrict,
  constraint action_passports_policy_workspace_fkey foreign key (workspace_id, policy_id) references public.policies(workspace_id, id) on delete restrict,
  constraint action_passports_demo_run_workspace_fkey foreign key (workspace_id, demo_run_id) references public.demo_runs(workspace_id, id) on delete cascade
);

create table public.action_revisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action_passport_id uuid not null,
  revision_number integer not null,
  passport_hash text not null,
  payload_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint action_revisions_workspace_passport_revision_key unique (workspace_id, action_passport_id, revision_number),
  constraint action_revisions_revision_number_check check (revision_number > 0),
  constraint action_revisions_hash_format check (passport_hash ~ '^[0-9a-f]{64}$'),
  constraint action_revisions_payload_object check (jsonb_typeof(payload_json) = 'object'),
  constraint action_revisions_passport_workspace_fkey foreign key (workspace_id, action_passport_id) references public.action_passports(workspace_id, id) on delete restrict
);

create table public.evidence_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action_passport_id uuid not null,
  evidence_id text not null,
  source text not null,
  content_hash text not null,
  collected_at timestamptz not null,
  expires_at timestamptz not null,
  metadata_json jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint evidence_items_workspace_evidence_key unique (workspace_id, action_passport_id, evidence_id),
  constraint evidence_items_hash_format check (content_hash ~ '^[0-9a-f]{64}$'),
  constraint evidence_items_expiry_check check (expires_at > collected_at),
  constraint evidence_items_metadata_object check (jsonb_typeof(metadata_json) = 'object'),
  constraint evidence_items_passport_workspace_fkey foreign key (workspace_id, action_passport_id) references public.action_passports(workspace_id, id) on delete restrict
);

create table public.approval_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action_passport_id uuid not null,
  event_id text not null,
  decision text not null,
  actor_pubkey text not null,
  approved_at timestamptz not null,
  expires_at timestamptz not null,
  raw_event_json jsonb not null,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint approval_events_workspace_event_key unique (workspace_id, event_id),
  constraint approval_events_decision_check check (decision in ('approved', 'rejected', 'revoked')),
  constraint approval_events_actor_pubkey_format check (actor_pubkey ~ '^[0-9a-f]{64}$'),
  constraint approval_events_expiry_after_approval check (expires_at > approved_at),
  constraint approval_events_raw_event_object check (jsonb_typeof(raw_event_json) = 'object'),
  constraint approval_events_passport_workspace_fkey foreign key (workspace_id, action_passport_id) references public.action_passports(workspace_id, id) on delete restrict
);

create table public.execution_attempts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action_passport_id uuid not null,
  attempt_number integer not null,
  status text not null default 'pending',
  provider_request_id text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint execution_attempts_workspace_attempt_key unique (workspace_id, action_passport_id, attempt_number),
  constraint execution_attempts_number_check check (attempt_number > 0),
  constraint execution_attempts_status_check check (status in ('pending', 'running', 'succeeded', 'failed', 'unknown_outcome')),
  constraint execution_attempts_completion_check check (completed_at is null or started_at is not null),
  constraint execution_attempts_passport_workspace_fkey foreign key (workspace_id, action_passport_id) references public.action_passports(workspace_id, id) on delete restrict
);

create table public.execution_receipts (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  execution_attempt_id uuid not null,
  receipt_hash text not null,
  receipt_json jsonb not null,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint execution_receipts_workspace_attempt_key unique (workspace_id, execution_attempt_id),
  constraint execution_receipts_hash_format check (receipt_hash ~ '^[0-9a-f]{64}$'),
  constraint execution_receipts_json_object check (jsonb_typeof(receipt_json) = 'object'),
  constraint execution_receipts_attempt_workspace_fkey foreign key (workspace_id, execution_attempt_id) references public.execution_attempts(workspace_id, id) on delete restrict
);

create table public.buzz_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action_passport_id uuid,
  buzz_event_id text not null,
  event_kind text not null,
  signer_pubkey text not null,
  received_at timestamptz not null default now(),
  raw_event_json jsonb not null,
  processing_status text not null default 'received',
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint buzz_events_workspace_event_key unique (workspace_id, buzz_event_id),
  constraint buzz_events_signer_pubkey_format check (signer_pubkey ~ '^[0-9a-f]{64}$'),
  constraint buzz_events_raw_event_object check (jsonb_typeof(raw_event_json) = 'object'),
  constraint buzz_events_processing_status_check check (processing_status in ('received', 'applied', 'duplicate', 'rejected')),
  constraint buzz_events_passport_workspace_fkey foreign key (workspace_id, action_passport_id) references public.action_passports(workspace_id, id) on delete restrict
);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  actor_type text not null,
  actor_id text,
  event_type text not null,
  aggregate_type text not null,
  aggregate_id uuid not null,
  before_hash text,
  after_hash text,
  metadata_json jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  correlation_id uuid,
  causation_id uuid,
  unique (workspace_id, id),
  constraint audit_events_actor_type_check check (actor_type in ('human', 'agent', 'worker', 'system')),
  constraint audit_events_before_hash_format check (before_hash is null or before_hash ~ '^[0-9a-f]{64}$'),
  constraint audit_events_after_hash_format check (after_hash is null or after_hash ~ '^[0-9a-f]{64}$'),
  constraint audit_events_metadata_object check (jsonb_typeof(metadata_json) = 'object')
);

create table public.outbox_jobs (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces(id) on delete restrict,
  action_passport_id uuid,
  job_type text not null,
  payload_json jsonb not null,
  available_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  attempts integer not null default 0,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (workspace_id, id),
  constraint outbox_jobs_payload_object check (jsonb_typeof(payload_json) = 'object'),
  constraint outbox_jobs_attempts_check check (attempts >= 0),
  constraint outbox_jobs_claim_shape check ((locked_at is null and locked_by is null) or (locked_at is not null and locked_by is not null)),
  constraint outbox_jobs_passport_workspace_fkey foreign key (workspace_id, action_passport_id) references public.action_passports(workspace_id, id) on delete restrict
);
