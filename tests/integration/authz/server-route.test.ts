import { describe, expect, it } from 'vitest';
import { NextRequest } from 'next/server';

import {
  config as middlewareConfig,
  isReadOnlyDemoRequest,
  middleware,
} from '../../../apps/web/middleware.js';
import {
  createSessionResolver,
  createSupabaseServerAuth,
  getPublicSupabaseConfig,
  refreshSupabaseSession,
  supabaseAuthCookieOptions,
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

  it('rejects an unauthenticated request before membership lookup', async () => {
    const authorizer = createServerAuthorization({
      appOrigin,
      membershipStore: membershipStore({ role: 'owner' }),
      resolveSession: async () => null,
    });

    await expect(
      authorizer.requireWorkspaceMember(
        request('GET'),
        workspaceA,
        'export_audit',
      ),
    ).rejects.toMatchObject({ code: 'unauthenticated', status: 401 });
  });

  it.each([
    ['suspended', 'member_suspended'],
    ['removed', 'member_removed'],
  ] as const)(
    'rejects a %s membership for every server route',
    async (status, code) => {
      const authorizer = createServerAuthorization({
        appOrigin,
        membershipStore: membershipStore({ role: 'owner', status }),
        resolveSession: async () => session,
      });

      await expect(
        authorizer.requireWorkspaceMember(
          request('GET'),
          workspaceA,
          'export_audit',
        ),
      ).rejects.toMatchObject({ code, status: 403 });
    },
  );

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
      approvalContextStore: {
        getApprovalContext: async () => ({
          actionId: 'action-1',
          proposerUserId: 'user-2',
          prohibitSelfApproval: true,
        }),
      },
    });

    await expect(
      authorizer.requireWorkspaceMember(
        request('POST'),
        workspaceA,
        'approve_action',
        'action-1',
      ),
    ).resolves.toMatchObject({ role: 'reviewer' });

    records.role = 'auditor' as never;

    await expect(
      authorizer.requireWorkspaceMember(
        request('POST'),
        workspaceA,
        'approve_action',
        'action-1',
      ),
    ).rejects.toMatchObject({ code: 'permission_denied' });
  });

  it('prevents a reviewer from approving their own proposal when policy forbids it', async () => {
    const authorizer = createServerAuthorization({
      appOrigin,
      membershipStore: membershipStore({ role: 'reviewer' }),
      resolveSession: async () => session,
      approvalContextStore: {
        getApprovalContext: async () => ({
          actionId: 'action-1',
          proposerUserId: 'user-1',
          prohibitSelfApproval: true,
        }),
      },
    });

    await expect(
      authorizer.requireWorkspaceMember(
        request('POST'),
        workspaceA,
        'approve_action',
        'action-1',
      ),
    ).rejects.toMatchObject({ code: 'self_approval_forbidden' });
  });

  it('fails closed when approval context is omitted from the server boundary', async () => {
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
      ),
    ).rejects.toMatchObject({ code: 'authorization_context_missing' });
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

  it('uses a Next middleware handler and matcher to keep demo access read-only and tenant-free', () => {
    expect(middlewareConfig.matcher).toEqual(['/demo/:path*']);

    const originalFetch = globalThis.fetch;
    let fetchCalls = 0;
    globalThis.fetch = async (...args) => {
      fetchCalls += 1;
      return originalFetch(...args);
    };

    try {
      const readResponse = middleware(
        new NextRequest(`${appOrigin}/demo/runs/synthetic`),
      );
      const writeResponse = middleware(
        new NextRequest(`${appOrigin}/demo/runs/synthetic`, { method: 'POST' }),
      );

      expect(readResponse.status).toBe(200);
      expect(writeResponse.status).toBe(405);
      expect(writeResponse.headers.get('allow')).toBe('GET, HEAD');
      expect(fetchCalls).toBe(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
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

  it('persists Supabase SSR refresh cookies on the Next response with secure options', () => {
    const auth = createSupabaseServerAuth(
      new NextRequest(`${appOrigin}/auth/callback`, {
        headers: { cookie: 'sb-access-token=expired' },
      }),
      {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      },
      (_url, _anonKey, options) => {
        expect(options.cookieOptions).toMatchObject(supabaseAuthCookieOptions);
        options.cookies.setAll([
          {
            name: 'sb-access-token',
            value: 'refreshed',
            options: { httpOnly: false, secure: false },
          },
        ]);
        return fakeSupabaseClient();
      },
    );

    expect(auth.response.cookies.get('sb-access-token')).toMatchObject({
      value: 'refreshed',
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  });

  it('keeps the returned response live when async refresh later writes all Set-Cookie headers', async () => {
    let triggerRefreshCookies: (() => Promise<void>) | undefined;
    const auth = createSupabaseServerAuth(
      new NextRequest(`${appOrigin}/auth/callback`),
      {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      },
      (_url, _anonKey, options) => {
        triggerRefreshCookies = async () => {
          await Promise.resolve();
          options.cookies.setAll([
            {
              name: 'sb-access-token',
              value: 'refreshed-access',
              options: { httpOnly: false, secure: false },
            },
            {
              name: 'sb-refresh-token',
              value: 'refreshed-refresh',
              options: { httpOnly: false, secure: false },
            },
          ]);
        };

        return {
          auth: {
            getUser: async () => ({
              data: { user: { id: 'user-1' } },
              error: null,
            }),
            refreshSession: async () => {
              await triggerRefreshCookies?.();
              return {
                data: {
                  session: {
                    access_token: 'refreshed-access',
                    expires_at: session.expiresAt,
                    user: { id: session.user.id },
                  },
                },
                error: null,
              };
            },
          },
        };
      },
    );

    await auth.client.auth.refreshSession();

    expect(auth.response.cookies.getAll()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'sb-access-token',
          value: 'refreshed-access',
          httpOnly: true,
          secure: true,
        }),
        expect.objectContaining({
          name: 'sb-refresh-token',
          value: 'refreshed-refresh',
          httpOnly: true,
          secure: true,
        }),
      ]),
    );
  });

  it('refreshes a session through the Supabase server client adapter', async () => {
    const auth = createSupabaseServerAuth(
      new NextRequest(`${appOrigin}/auth/callback`),
      {
        NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.co',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'anon-key',
      },
      (_url, _anonKey, _options) => fakeSupabaseClient(),
    );

    await expect(refreshSupabaseSession(auth)).resolves.toEqual(session);
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

function fakeSupabaseClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: { id: 'user-1' } }, error: null }),
      refreshSession: async () => ({
        data: {
          session: {
            access_token: session.accessToken,
            expires_at: session.expiresAt,
            user: { id: session.user.id },
          },
        },
        error: null,
      }),
    },
  };
}
