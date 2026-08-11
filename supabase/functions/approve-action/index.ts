import {
  defaultLifecycleDependencies,
  errorResponse,
  isRecord,
  type LifecycleBoundaryDependencies,
} from '../_shared/lifecycle-boundary.ts';

export function createApproveActionHandler(
  dependencies: LifecycleBoundaryDependencies = defaultLifecycleDependencies(),
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST')
      return errorResponse('invalid_request', 'POST is required.', 405);
    const caller = await dependencies.authenticate(request);
    if (caller === null)
      return errorResponse(
        'unauthenticated',
        'A valid authenticated caller is required.',
        401,
      );
    const body = await readJson(request);
    if (
      !isRecord(body) ||
      !requiredStrings(body, [
        'workspaceId',
        'actionPassportId',
        'commandId',
        'commandHash',
        'correlationId',
        'approvalEventId',
        'approvedAt',
        'expiresAt',
        'approvalActorPubkey',
      ])
      || typeof body.expectedVersion !== 'number'
      || !isRecord(body.rawEvent)
    ) {
      return errorResponse(
        'invalid_request',
        'A complete lifecycle approval command is required.',
        400,
      );
    }
    const workspaceId = body.workspaceId as string;
    const actionPassportId = body.actionPassportId as string;
    if (
      !(await dependencies.authorize(caller, workspaceId, 'approve_action'))
    ) {
      return errorResponse(
        'permission_denied',
        'The caller cannot approve actions in this workspace.',
        403,
      );
    }
    const response = await dependencies.transition({
      target_workspace_id: workspaceId,
      target_action_passport_id: actionPassportId,
      source_expected_version: body.expectedVersion,
      source_target_status: 'APPROVED',
      source_command_id: body.commandId,
      source_command_hash: body.commandHash,
      source_actor_type: 'human',
      source_actor_id: caller.userId,
      source_correlation_id: body.correlationId,
      source_causation_id:
        typeof body.causationId === 'string' ? body.causationId : null,
      source_approval_event_id: body.approvalEventId,
      source_approved_at: body.approvedAt,
      source_expires_at: body.expiresAt,
      source_approval_actor_pubkey: body.approvalActorPubkey,
      source_approval_raw_event_json: body.rawEvent,
    });
    return response.ok
      ? json(await response.json(), response.status)
      : errorResponse(
          'upstream_failure',
          'Lifecycle approval failed.',
          response.status,
        );
  };
}

const deno = (
  globalThis as {
    Deno?: { serve(handler: (request: Request) => Promise<Response>): void };
  }
).Deno;
if (deno) deno.serve(createApproveActionHandler());

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
function requiredStrings(
  body: Record<string, unknown>,
  fields: string[],
): boolean {
  return fields.every(
    (field) => typeof body[field] === 'string' && body[field].length > 0,
  );
}
async function json(value: unknown, status: number): Promise<Response> {
  return Response.json(value, { status });
}
