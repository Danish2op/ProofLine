/**
 * Task 9 HTTP boundary. The injected service must call the deterministic
 * verifier and may persist feedback only through an existing append-only
 * provenance/audit adapter. This function never transitions an action status.
 */
export interface RunVerifierDependencies {
  authenticate(request: Request): Promise<{ userId: string } | null>;
  authorize(userId: string, workspaceId: string): Promise<boolean>;
  verify(input: unknown): Promise<{ feedback: unknown }>;
  captureFeedback(feedback: unknown): Promise<void>;
}

export function createRunVerifierHandler(
  dependencies: RunVerifierDependencies,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== 'POST') return error('invalid_request', 405);
    const caller = await dependencies.authenticate(request);
    if (caller === null) return error('unauthenticated', 401);
    const body = await readJson(request);
    if (
      !isRecord(body) ||
      typeof body.workspaceId !== 'string' ||
      !('verification' in body)
    ) {
      return error('invalid_request', 400);
    }
    if (!(await dependencies.authorize(caller.userId, body.workspaceId))) {
      return error('permission_denied', 403);
    }
    const result = await dependencies.verify(body.verification);
    await dependencies.captureFeedback(result.feedback);
    return Response.json(result);
  };
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

function error(code: string, status: number): Response {
  return Response.json({ error: { code, retryable: false } }, { status });
}
