export interface AuthenticatedCaller {
  userId: string;
  accessToken: string;
}

export type LifecyclePermission =
  'approve_action' | 'revoke_action' | 'create_action';

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
    permission === 'create_action'
      ? ['owner', 'admin', 'proposer']
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
  const rpcName =
    input.source_target_status === 'APPROVED'
      ? 'approve_verified_action_v2'
      : 'transition_action';
  return fetch(`${url}/rest/v1/rpc/${rpcName}`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(lifecycleRpcPayload(input)),
  });
}

export function lifecycleRpcPayload(
  input: Record<string, unknown>,
): Record<string, unknown> {
  if (input.source_target_status !== 'APPROVED') return { ...input };
  const approvedArgumentNames = [
    'target_workspace_id',
    'target_action_passport_id',
    'source_expected_version',
    'source_command_id',
    'source_command_hash',
    'source_actor_id',
    'source_correlation_id',
    'source_causation_id',
    'source_approval_event_id',
    'source_approved_at',
    'source_expires_at',
    'source_approval_actor_pubkey',
    'source_approval_raw_event_json',
  ] as const;
  return Object.fromEntries(
    approvedArgumentNames
      .filter((name) => name in input)
      .map((name) => [name, input[name]]),
  );
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
