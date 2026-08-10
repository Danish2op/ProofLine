export const actionLifecycleStatuses = [
  'DRAFT',
  'CHALLENGE_REQUIRED',
  'PENDING_APPROVAL',
  'APPROVED',
  'EXECUTING',
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'REVOKED',
  'BLOCKED',
] as const;

export type ActionLifecycleStatus = (typeof actionLifecycleStatuses)[number];

const transitions: Readonly<
  Record<ActionLifecycleStatus, readonly ActionLifecycleStatus[]>
> = {
  DRAFT: [
    'CHALLENGE_REQUIRED',
    'PENDING_APPROVAL',
    'EXPIRED',
    'REVOKED',
    'BLOCKED',
  ],
  CHALLENGE_REQUIRED: ['PENDING_APPROVAL', 'EXPIRED', 'REVOKED', 'BLOCKED'],
  PENDING_APPROVAL: ['APPROVED', 'EXPIRED', 'REVOKED', 'BLOCKED'],
  APPROVED: ['EXECUTING', 'EXPIRED', 'REVOKED', 'BLOCKED'],
  EXECUTING: ['SUCCEEDED', 'FAILED', 'BLOCKED'],
  SUCCEEDED: [],
  FAILED: [],
  EXPIRED: [],
  REVOKED: [],
  BLOCKED: [],
};

export function isValidLifecycleTransition(
  from: ActionLifecycleStatus,
  to: ActionLifecycleStatus,
): boolean {
  return transitions[from].includes(to);
}
