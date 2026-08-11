import {
  authenticateCaller,
  authorizeCaller,
  errorResponse,
  isRecord,
  type AuthenticatedCaller,
} from '../_shared/lifecycle-boundary.ts';

export interface CreateActionDependencies {
  authenticate(request: Request): Promise<AuthenticatedCaller | null>;
  authorize(
    caller: AuthenticatedCaller,
    workspaceId: string,
    permission: 'create_action',
  ): Promise<boolean>;
  insert(action: Record<string, unknown>): Promise<Response>;
}

export function createCreateActionHandler(
  dependencies: CreateActionDependencies = {
    authenticate: authenticateCaller,
    authorize: authorizeCaller,
    insert: insertAction,
  },
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST')
      return errorResponse('invalid_request', 'POST is required.', 405);
    const caller = await dependencies.authenticate(request);
    if (!caller)
      return errorResponse(
        'unauthenticated',
        'A valid authenticated caller is required.',
        401,
      );
    const body = await readJson(request);
    if (!isRecord(body) || !isRecord(body.action))
      return errorResponse(
        'invalid_request',
        'A new action must provide an action passport.',
        400,
      );
    const action = { ...body.action };
    const workspaceId =
      typeof action.workspace_id === 'string' ? action.workspace_id : null;
    if (!workspaceId || action.status !== 'DRAFT')
      return errorResponse(
        'invalid_request',
        'A new action must provide a DRAFT action passport and workspace.',
        400,
      );
    if (!(await dependencies.authorize(caller, workspaceId, 'create_action')))
      return errorResponse(
        'permission_denied',
        'The caller cannot create actions in this workspace.',
        403,
      );
    delete action.version;
    const response = await dependencies.insert(action);
    return response.ok
      ? json(await response.json(), 201)
      : errorResponse('upstream_failure', 'Action creation was rejected.', response.status);
  };
}

const deno = (
  globalThis as {
    Deno?: { serve(handler: (request: Request) => Promise<Response>): void };
  }
).Deno;
if (deno) deno.serve(createCreateActionHandler());

async function insertAction(action: Record<string, unknown>): Promise<Response> {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key)
    return Response.json(
      { error: { code: 'configuration_missing', retryable: false } },
      { status: 503 },
    );
  return fetch(`${url}/rest/v1/action_passports`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      prefer: 'return=representation',
    },
    body: JSON.stringify(action),
  });
}

function env(name: string): string | undefined {
  const deno = (
    globalThis as { Deno?: { env: { get(key: string): string | undefined } } }
  ).Deno;
  return deno?.env.get(name);
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function json(value: unknown, status: number): Response {
  return Response.json(value, { status });
}
