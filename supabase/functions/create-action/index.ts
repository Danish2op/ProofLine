type ErrorCode = 'invalid_request' | 'upstream_failure';

Deno.serve(async (request) => {
  if (request.method !== 'POST')
    return error('invalid_request', 'POST is required.', 405);
  const body = await readJson(request);
  if (
    !isRecord(body) ||
    !isRecord(body.action) ||
    body.action.status !== 'DRAFT'
  ) {
    return error(
      'invalid_request',
      'A new action must provide a DRAFT action passport.',
      400,
    );
  }

  const action = { ...body.action };
  delete action.version;
  const response = await supabaseRequest('/rest/v1/action_passports', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify(action),
  });
  if (!response.ok)
    return error(
      'upstream_failure',
      'Action creation was rejected.',
      response.status,
    );
  return json(await response.json(), 201);
});

async function supabaseRequest(
  path: string,
  init: RequestInit,
): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key)
    throw new Error('Supabase lifecycle configuration is missing.');
  return fetch(`${url}${path}`, {
    ...init,
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
      ...init.headers,
    },
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}
function error(code: ErrorCode, message: string, status: number): Response {
  return json({ error: { code, message, retryable: false } }, status);
}
