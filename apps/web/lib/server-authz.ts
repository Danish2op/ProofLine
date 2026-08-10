import {
  can,
  toAuthorizedActor,
  type AuthorizationResource,
  type Permission,
  type WorkspaceMembershipStore,
} from '@proofline/authz';

import {
  assertCsrfProtection,
  AuthSessionError,
  AuthSessionErrorWithCode,
  type SessionResolver,
} from './auth.js';

export type AuthorizationFailureCode =
  | 'unauthenticated'
  | 'session_expired'
  | 'csrf_failed'
  | 'member_suspended'
  | 'member_removed'
  | 'cross_tenant'
  | 'permission_denied'
  | 'self_approval_forbidden';

export class AuthorizationError extends Error {
  readonly status: 401 | 403;

  constructor(readonly code: AuthorizationFailureCode) {
    super(code);
    this.status =
      code === 'unauthenticated' || code === 'session_expired' ? 401 : 403;
  }
}

export interface ServerAuthorizationDependencies {
  appOrigin: string;
  membershipStore: WorkspaceMembershipStore;
  resolveSession: SessionResolver;
}

export interface ServerAuthorization {
  requireWorkspaceMember(
    request: Request,
    workspaceId: string,
    permission: Permission,
    resource?: Omit<AuthorizationResource, 'workspaceId'>,
  ): Promise<ReturnType<typeof toAuthorizedActor> & object>;
}

export function createServerAuthorization(
  dependencies: ServerAuthorizationDependencies,
): ServerAuthorization {
  return {
    async requireWorkspaceMember(
      request,
      workspaceId,
      permission,
      resource = {},
    ) {
      let session;
      try {
        session = await dependencies.resolveSession(request);
      } catch (error) {
        if (error instanceof AuthSessionError) {
          throw new AuthorizationError('session_expired');
        }
        throw error;
      }

      if (session === null) {
        throw new AuthorizationError('unauthenticated');
      }

      try {
        assertCsrfProtection(request, dependencies.appOrigin);
      } catch (error) {
        if (error instanceof AuthSessionErrorWithCode) {
          throw new AuthorizationError(error.code);
        }
        throw error;
      }

      const membership = await dependencies.membershipStore.getMembership(
        session.user.id,
        workspaceId,
      );
      if (
        membership === null ||
        membership.userId !== session.user.id ||
        membership.workspaceId !== workspaceId
      ) {
        throw new AuthorizationError('cross_tenant');
      }
      if (membership.status === 'suspended') {
        throw new AuthorizationError('member_suspended');
      }
      if (membership.status === 'removed') {
        throw new AuthorizationError('member_removed');
      }

      const actor = toAuthorizedActor(membership);
      const authorizationResource = { ...resource, workspaceId };
      if (actor === null || !can(actor, permission, authorizationResource)) {
        if (
          permission === 'approve_action' &&
          resource.prohibitSelfApproval === true &&
          resource.proposerUserId === session.user.id
        ) {
          throw new AuthorizationError('self_approval_forbidden');
        }
        throw new AuthorizationError('permission_denied');
      }

      return actor;
    },
  };
}

export type { WorkspaceMembershipStore } from '@proofline/authz';
