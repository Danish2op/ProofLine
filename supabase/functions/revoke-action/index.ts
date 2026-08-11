Deno.serve(async (request) => {
  if (request.method !== 'POST')
    return error('invalid_request', 'POST is required.', 405);
  const body = await readJson(request);
  if (
    !isRecord(body) ||
    !requiredStrings(body, [
      'workspaceId',
      'actionPassportId',
      'commandId',
      'commandHash',
      'correlationId',
      'actorType',
    ]) ||
    typeof body.expectedVersion !== 'number'
  ) {
    return error(
      'invalid_request',
      'A complete lifecycle revoke command is required.',
      400,
    );
  }
  const response = await rpc('transition_action', {
    target_workspace_id: body.workspaceId,
    target_action_passport_id: body.actionPassportId,
    source_expected_version: body.expectedVersion,
    source_target_status: 'REVOKED',
    source_command_id: body.commandId,
    source_command_hash: body.commandHash,
    source_actor_type: body.actorType,
    source_actor_id: typeof body.actorId === 'string' ? body.actorId : null,
    source_correlation_id: body.correlationId,
    source_causation_id:
      typeof body.causationId === 'string' ? body.causationId : null,
  });
  if (!response.ok)
    return error(
      'upstream_failure',
      'Lifecycle revoke failed.',
      response.status,
    );
  return json(await response.json());
});

function requiredStrings(
  body: Record<string, unknown>,
  fields: string[],
): boolean {
  return fields.every(
    (field) => typeof body[field] === 'string' && body[field].length > 0,
  );
}
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
