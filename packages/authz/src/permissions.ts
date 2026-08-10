import type { AuthorizedActor, WorkspaceRole } from './roles.js';

export const permissions = [
  'create_proposal',
  'verify_action',
  'approve_action',
  'revoke_action',
  'execute_action',
  'export_audit',
  'manage_members',
  'update_policy',
] as const;

export type Permission = (typeof permissions)[number];

export interface AuthorizationResource {
  workspaceId: string;
  proposerUserId?: string;
  prohibitSelfApproval?: boolean;
}

const permissionRoles: Readonly<Record<Permission, readonly WorkspaceRole[]>> =
  {
    create_proposal: ['owner', 'admin', 'proposer'],
    verify_action: ['owner', 'admin', 'verifier'],
    approve_action: ['owner', 'admin', 'reviewer'],
    revoke_action: ['owner', 'admin', 'reviewer'],
    execute_action: ['owner', 'admin'],
    export_audit: ['owner', 'admin', 'auditor'],
    manage_members: ['owner', 'admin'],
    update_policy: ['owner', 'admin'],
  };

export function can(
  actor: AuthorizedActor,
  permission: Permission,
  resource: AuthorizationResource,
): boolean {
  if (
    actor.membershipStatus !== 'active' ||
    actor.workspaceId !== resource.workspaceId ||
    !permissionRoles[permission].includes(actor.role)
  ) {
    return false;
  }

  return !(
    permission === 'approve_action' &&
    resource.prohibitSelfApproval === true &&
    resource.proposerUserId === actor.userId
  );
}
