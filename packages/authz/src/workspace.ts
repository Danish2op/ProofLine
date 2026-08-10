import {
  isWorkspaceRole,
  type AuthorizedActor,
  type WorkspaceMembershipStatus,
} from './roles.js';

export interface WorkspaceMembership {
  workspaceId: string;
  userId: string;
  role: string;
  status: WorkspaceMembershipStatus;
}

export interface WorkspaceMembershipStore {
  getMembership(
    userId: string,
    workspaceId: string,
  ): Promise<WorkspaceMembership | null>;
}

export function toAuthorizedActor(
  membership: WorkspaceMembership,
): AuthorizedActor | null {
  if (!isWorkspaceRole(membership.role)) {
    return null;
  }

  return {
    userId: membership.userId,
    workspaceId: membership.workspaceId,
    role: membership.role,
    membershipStatus: membership.status,
  };
}
