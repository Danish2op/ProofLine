import { describe, expect, it } from 'vitest';

import { isReadOnlyDemoRequest } from '../../../apps/web/middleware.js';
import {
  createSessionResolver,
  getPublicSupabaseConfig,
  type SupabaseSession,
} from '../../../apps/web/lib/auth.js';
import {
  AuthorizationError,
  createServerAuthorization,
  type WorkspaceMembershipStore,
} from '../../../apps/web/lib/server-authz.js';

const appOrigin = 'https://proofline.example.test';
const workspaceA = 'workspace-a';
const workspaceB = 'workspace-b';
const session: SupabaseSession = {
  accessToken: 'access-token',
  expiresAt: 1_800_000_000,
  user: { id: 'user-1' },
};

describe('server workspace authorization', () => {
  it('rejects an expired Supabase session when refresh cannot establish a valid session', async () => {
    const resolveSession = createSessionResolver(
      {
        getSession: async () => ({ ...session, expiresAt: 1 }),
        refreshSession: async () => null,
      },
      () => 2_000,
    );

    await expect(resolveSession(request('GET'))).rejects.toMatchObject({
      code: 'session_expired',
    });
  });

  it('refreshes an expired Supabase session before authorizing a workspace request', async () => {
    const authorizer = createServerAuthorization({
      appOrigin,
      membershipStore: membershipStore({ role: 'proposer' }),
      resolveSession: createSessionResolver(
        {
          getSession: async () => ({ ...session, expiresAt: 1 }),
          refreshSession: async () => session,
        },
        () => 2_000,
      ),
    });

    await expect(
      authorizer.requireWorkspaceMember(
        request('POST'),
        workspaceA,
        'create_proposal',
      ),
    ).resolves.toMatchObject({ role: 'proposer', workspaceId: workspaceA });
  });

  it('requires same-origin CSRF proof for browser mutations', async () => {
    const authorizer = createServerAuthorization({
      appOrigin,
      membershipStore: membershipStore({ role: 'proposer' }),
      resolveSession: async () => session,
    });

    await expect(
      authorizer.requireWorkspaceMember(
        request('POST', { origin: 'https://attacker.example.test' }),
        workspaceA,
        'create_proposal',
      ),
    ).rejects.toMatchObject({ code: 'csrf_failed' });
  });

  it('rechecks membership so a role downgrade blocks an open approval', async () => {
    const records = { role: 'reviewer' as const };
    const authorizer = createServerAuthorization({
      appOrigin,
      membershipStore: {
        getMembership: async () => ({
          workspaceId: workspaceA,
          userId: 'user-1',
          role: records.role,
          status: 'active',
        }),
      },
      resolveSession: async () => session,
    });

    await expect(
      authorizer.requireWorkspaceMember(
        request('POST'),
        workspaceA,
        'approve_action',
      ),
    ).resolves.toMatchObject({ role: 'reviewer' });

    records.role = 'auditor' as never;

    await expect(
      authorizer.requireWorkspaceMember(
        request('POST'),
        workspaceA,
        'approve_action',
      ),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('prevents a reviewer from approving their own proposal when policy forbids it', async () => {
    const authorizer = createServerAuthorization({
      appOrigin,
      membershipStore: membershipStore({ role: 'reviewer' }),
      resolveSession: async () => session,
    });

    await expect(
      authorizer.requireWorkspaceMember(
        request('POST'),
        workspaceA,
        'approve_action',
        { proposerUserId: 'user-1', prohibitSelfApproval: true },
      ),
    ).rejects.toMatchObject({ code: 'self_approval_forbidden' });
  });

  it('rejects a membership record returned for another tenant', async () => {
    const authorizer = createServerAuthorization({
      appOrigin,
      membershipStore: membershipStore({
        workspaceId: workspaceB,
        role: 'owner',
      }),
      resolveSession: async () => session,
    });

    await expect(
      authorizer.requireWorkspaceMember(
        request('GET'),
        workspaceA,
        'export_audit',
      ),
    ).rejects.toMatchObject({ code: 'cross_tenant' });
  });

  it('allows public reads only under the isolated demo path', () => {
    expect(isReadOnlyDemoRequest(new Request(`${appOrigin}/demo`))).toEqual({
      allowed: true,
      public: true,
    });
    expect(
      isReadOnlyDemoRequest(
        new Request(`${appOrigin}/demo/runs/one`, { method: 'POST' }),
      ),
    ).toEqual({ allowed: false, public: true, status: 405 });
    expect(
      isReadOnlyDemoRequest(
        new Request(`${appOrigin}/workspaces/${workspaceA}`),
      ),
    ).toEqual({ allowed: false, public: false, status: 404 });
  });

  it('exposes only public Supabase configuration to browser code', () => {
    const environment = {
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
      NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      SUPABASE_SERVICE_ROLE_KEY: 'must-not-leak',
    };

    expect(getPublicSupabaseConfig(environment)).toEqual({
      url: 'https://project.supabase.co',
      anonKey: 'anon-key',
    });
  });

  it('uses a typed error at the authorization boundary', () => {
    expect(new AuthorizationError('permission_denied').status).toBe(403);
  });
});

function request(
  method: string,
  headers: Record<string, string> = {},
): Request {
  return new Request(`${appOrigin}/api/workspaces/${workspaceA}/actions`, {
    method,
    headers:
      method === 'GET'
        ? headers
        : {
            origin: appOrigin,
            cookie: 'proofline_csrf=csrf-token',
            'x-proofline-csrf': 'csrf-token',
            ...headers,
          },
  });
}

function membershipStore(membership: {
  workspaceId?: string;
  userId?: string;
  role: 'owner' | 'admin' | 'proposer' | 'verifier' | 'reviewer' | 'auditor';
  status?: 'active' | 'suspended' | 'removed';
}): WorkspaceMembershipStore {
  return {
    getMembership: async () => ({
      workspaceId: membership.workspaceId ?? workspaceA,
      userId: membership.userId ?? 'user-1',
      role: membership.role,
      status: membership.status ?? 'active',
    }),
  };
}
