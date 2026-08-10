export const workspaceRoles = [
  'owner',
  'admin',
  'proposer',
  'verifier',
  'reviewer',
  'auditor',
] as const;

export type WorkspaceRole = (typeof workspaceRoles)[number];

export const workspaceMembershipStatuses = [
  'active',
  'suspended',
  'removed',
] as const;

export type WorkspaceMembershipStatus =
  (typeof workspaceMembershipStatuses)[number];

export interface AuthorizedActor {
  userId: string;
  workspaceId: string;
  role: WorkspaceRole;
  membershipStatus: WorkspaceMembershipStatus;
}

export function isWorkspaceRole(value: unknown): value is WorkspaceRole {
  return (
    typeof value === 'string' && workspaceRoles.includes(value as WorkspaceRole)
  );
}
