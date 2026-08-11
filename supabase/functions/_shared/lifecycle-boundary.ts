export interface AuthenticatedCaller {
  userId: string;
  accessToken: string;
}

export type LifecyclePermission = 'approve_action' | 'revoke_action';

export interface LifecycleBoundaryDependencies {
  authenticate(request: Request): Promise<AuthenticatedCaller | null>;
  authorize(
    caller: AuthenticatedCaller,
    workspaceId: string,
    permission: LifecyclePermission,
  ): Promise<boolean>;
  transition(input: Record<string, unknown>): Promise<Response>;
}

export function defaultLifecycleDependencies(): LifecycleBoundaryDependencies {
  return {
    authenticate: authenticateCaller,
    authorize: authorizeCaller,
    transition: transitionRpc,
  };
}

export async function authenticateCaller(
  request: Request,
): Promise<AuthenticatedCaller | null> {
  const authorization = request.headers.get('authorization');
  const token = authorization?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!token || !url || !anonKey) return null;

  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const payload: unknown = await response.json();
  if (!isRecord(payload) || typeof payload.id !== 'string') return null;
  return { userId: payload.id, accessToken: token };
}

export async function authorizeCaller(
  caller: AuthenticatedCaller,
  workspaceId: string,
  permission: LifecyclePermission,
): Promise<boolean> {
  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anonKey) return false;
  const roles =
    permission === 'approve_action'
      ? ['owner', 'admin', 'reviewer']
      : ['owner', 'admin', 'reviewer'];
  const response = await fetch(`${url}/rest/v1/rpc/is_workspace_member`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${caller.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      target_workspace_id: workspaceId,
      allowed_roles: roles,
    }),
  });
  if (!response.ok) return false;
  const payload: unknown = await response.json();
  return payload === true || (Array.isArray(payload) && payload[0] === true);
}

export async function transitionRpc(
  input: Record<string, unknown>,
): Promise<Response> {
  const url = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey)
    return Response.json(
      { error: { code: 'configuration_missing', retryable: false } },
      { status: 503 },
    );
  return fetch(`${url}/rest/v1/rpc/transition_action`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function errorResponse(
  code: string,
  message: string,
  status: number,
): Response {
  return Response.json(
    { error: { code, message, retryable: false } },
    { status },
  );
}

export function env(name: string, fallback?: string): string | undefined {
  const deno = (
    globalThis as { Deno?: { env: { get(key: string): string | undefined } } }
  ).Deno;
  return (
    deno?.env.get(name) ?? (fallback ? deno?.env.get(fallback) : undefined)
  );
}
