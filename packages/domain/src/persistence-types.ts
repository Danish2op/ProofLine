import type { ActionLifecycleStatus } from './events.js';

export type WorkspaceRole =
  'owner' | 'admin' | 'proposer' | 'verifier' | 'reviewer' | 'auditor';

export type WorkspaceMembershipStatus = 'active' | 'suspended' | 'removed';
export type AgentStatus = 'active' | 'revoked';
export type ApprovalDecision = 'approved' | 'rejected' | 'revoked';
export type ExecutionAttemptStatus =
  'pending' | 'running' | 'succeeded' | 'failed' | 'unknown_outcome';
export type BuzzProcessingStatus =
  'received' | 'applied' | 'duplicate' | 'rejected';
export type AuditActorType = 'human' | 'agent' | 'worker' | 'system';

export interface PersistenceRow {
  id: string;
  workspace_id: string;
  created_at: string;
}

export interface ActionPassportRow extends PersistenceRow {
  action_id: string;
  passport_hash: string;
  status: ActionLifecycleStatus;
  agent_id: string;
  tool_definition_id: string;
  policy_id: string;
  demo_run_id: string | null;
  target: string;
  environment: string;
  normalized_arguments: Record<string, unknown>;
  idempotency_key: string;
  approval_required: boolean;
  approved_at: string | null;
  approval_expires_at: string | null;
  updated_at: string;
}

export interface AuditEventRow extends PersistenceRow {
  actor_type: AuditActorType;
  actor_id: string | null;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  before_hash: string | null;
  after_hash: string | null;
  metadata_json: Record<string, unknown>;
  occurred_at: string;
  correlation_id: string | null;
  causation_id: string | null;
}

export interface Database {
  public: {
    Tables: {
      action_passports: { Row: ActionPassportRow };
      audit_events: { Row: AuditEventRow };
    };
  };
}
