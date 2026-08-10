import { describe, expect, it } from 'vitest';

import { can } from '../../../packages/authz/src/permissions.js';
import type {
  AuthorizedActor,
  WorkspaceRole,
} from '../../../packages/authz/src/roles.js';

const workspaceId = 'workspace-a';

describe('workspace permission matrix', () => {
  it.each([
    ['owner', 'create_proposal', true],
    ['owner', 'verify_action', true],
    ['owner', 'approve_action', true],
    ['owner', 'revoke_action', true],
    ['owner', 'execute_action', true],
    ['owner', 'export_audit', true],
    ['owner', 'manage_members', true],
    ['owner', 'update_policy', true],
    ['admin', 'create_proposal', true],
    ['admin', 'verify_action', true],
    ['admin', 'approve_action', true],
    ['admin', 'revoke_action', true],
    ['admin', 'execute_action', true],
    ['admin', 'export_audit', true],
    ['admin', 'manage_members', true],
    ['admin', 'update_policy', true],
    ['proposer', 'create_proposal', true],
    ['proposer', 'approve_action', false],
    ['verifier', 'verify_action', true],
    ['verifier', 'execute_action', false],
    ['reviewer', 'approve_action', true],
    ['reviewer', 'revoke_action', true],
    ['reviewer', 'create_proposal', false],
    ['auditor', 'export_audit', true],
    ['auditor', 'update_policy', false],
  ] as const)('%s %s is %s', (role, permission, expected) => {
    expect(can(actor(role), permission, { workspaceId })).toBe(expected);
  });

  it('denies a reviewer approving their own proposal when the resource forbids it', () => {
    expect(
      can(actor('reviewer'), 'approve_action', {
        workspaceId,
        proposerUserId: 'user-1',
        prohibitSelfApproval: true,
      }),
    ).toBe(false);
  });

  it('does not let a suspended actor retain a permission', () => {
    expect(
      can(
        { ...actor('owner'), membershipStatus: 'suspended' },
        'update_policy',
        { workspaceId },
      ),
    ).toBe(false);
  });

  it('does not let an actor apply a workspace-a role to workspace-b', () => {
    expect(
      can(actor('owner'), 'manage_members', { workspaceId: 'workspace-b' }),
    ).toBe(false);
  });
});

function actor(role: WorkspaceRole): AuthorizedActor {
  return {
    userId: 'user-1',
    workspaceId,
    role,
    membershipStatus: 'active',
  };
}
