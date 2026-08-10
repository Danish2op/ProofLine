import {
  can,
  toAuthorizedActor,
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
  | 'self_approval_forbidden'
  | 'authorization_context_missing';

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
  approvalContextStore?: ApprovalContextStore;
}

export interface ApprovalAuthorizationContext {
  actionId: string;
  proposerUserId: string;
  prohibitSelfApproval: boolean;
}

export interface ApprovalContextStore {
  getApprovalContext(
    workspaceId: string,
    actionId: string,
  ): Promise<ApprovalAuthorizationContext | null>;
}

export interface ServerAuthorization {
  requireWorkspaceMember(
    request: Request,
    workspaceId: string,
    permission: Permission,
    actionId?: string,
  ): Promise<ReturnType<typeof toAuthorizedActor> & object>;
}

export function createServerAuthorization(
  dependencies: ServerAuthorizationDependencies,
): ServerAuthorization {
  return {
    async requireWorkspaceMember(request, workspaceId, permission, actionId) {
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
      if (permission === 'approve_action') {
        if (!actionId || !dependencies.approvalContextStore) {
          throw new AuthorizationError('authorization_context_missing');
        }

        const approvalContext =
          await dependencies.approvalContextStore.getApprovalContext(
            workspaceId,
            actionId,
          );
        if (
          approvalContext === null ||
          approvalContext.actionId !== actionId ||
          !approvalContext.proposerUserId ||
          typeof approvalContext.prohibitSelfApproval !== 'boolean'
        ) {
          throw new AuthorizationError('authorization_context_missing');
        }

        const authorizationResource = {
          workspaceId,
          proposerUserId: approvalContext.proposerUserId,
          prohibitSelfApproval: approvalContext.prohibitSelfApproval,
        };
        if (actor === null || !can(actor, permission, authorizationResource)) {
          if (
            approvalContext.prohibitSelfApproval &&
            approvalContext.proposerUserId === session.user.id
          ) {
            throw new AuthorizationError('self_approval_forbidden');
          }
          throw new AuthorizationError('permission_denied');
        }

        return actor;
      }

      const authorizationResource = { workspaceId };
      if (actor === null || !can(actor, permission, authorizationResource)) {
        throw new AuthorizationError('permission_denied');
      }

      return actor;
    },
  };
}

export type { WorkspaceMembershipStore } from '@proofline/authz';
