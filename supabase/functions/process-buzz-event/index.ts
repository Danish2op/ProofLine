Deno.serve(async (request) => {
  if (request.method !== 'POST')
    return error('invalid_request', 'POST is required.', 405);
  const body = await readJson(request);
  if (
    !isRecord(body) ||
    typeof body.workspaceId !== 'string' ||
    typeof body.approvedAt !== 'string' ||
    typeof body.expiresAt !== 'string' ||
    typeof body.relayUrl !== 'string' ||
    !isRecord(body.rawEvent)
  ) {
    return error(
      'invalid_request',
      'A verified Buzz approval payload is required.',
      400,
    );
  }
  const response = await rpc('apply_verified_buzz_approval', {
    target_workspace_id: body.workspaceId,
    source_approved_at: body.approvedAt,
    source_expires_at: body.expiresAt,
    source_relay_url: body.relayUrl,
    source_raw_event_json: body.rawEvent,
  });
  if (!response.ok)
    return error(
      'upstream_failure',
      'Buzz approval processing failed.',
      response.status,
    );
  return json({ result: await response.json() });
});

async function rpc(
  name: string,
  input: Record<string, unknown>,
): Promise<Response> {
  const url = Deno.env.get('SUPABASE_URL');
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !key)
    throw new Error('Supabase lifecycle configuration is missing.');
  return fetch(`${url}/rest/v1/rpc/${name}`, {
    method: 'POST',
    headers: {
      apikey: key,
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
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
function error(code: string, message: string, status: number): Response {
  return json({ error: { code, message, retryable: false } }, status);
}
