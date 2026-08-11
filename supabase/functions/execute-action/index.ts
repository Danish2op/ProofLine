import {
  createReceipt,
  ExecutionGate,
  IdempotencyStore,
  type ExecutionInput,
  type ExecutionReceipt,
} from '@proofline/execution';

export interface ExecuteCaller {
  userId: string;
}
export interface ApprovedExecution {
  input: ExecutionInput;
  action: { passport: ExecutionInput['passport']; passportHash: string };
}
export interface ExecuteDependencies {
  authenticate(request: Request): Promise<ExecuteCaller | null>;
  authorize(caller: ExecuteCaller, workspaceId: string): Promise<boolean>;
  loadApprovedAction(
    workspaceId: string,
    actionId: string,
  ): Promise<ApprovedExecution | null>;
  execute(action: ApprovedExecution['action']): Promise<{
    providerRequestId: string;
    outcome: 'succeeded' | 'failed';
    sideEffects: string[];
    rollbackReference: string | null;
    providerMetadata: Record<string, unknown>;
  }>;
  capture(receipt: ExecutionReceipt): Promise<void>;
}

export function createExecuteActionHandler(
  dependencies: ExecuteDependencies,
): (request: Request) => Promise<Response> {
  const store = new IdempotencyStore();
  const gate = new ExecutionGate();
  return async (request) => {
    if (request.method !== 'POST') return error('invalid_request', 405);
    const caller = await dependencies.authenticate(request);
    if (caller === null) return error('unauthenticated', 401);
    const body = await readBody(request);
    if (
      !isRecord(body) ||
      typeof body.workspaceId !== 'string' ||
      typeof body.actionId !== 'string' ||
      typeof body.idempotencyKey !== 'string' ||
      Object.keys(body).length !== 3
    )
      return error('invalid_request', 400);
    if (!(await dependencies.authorize(caller, body.workspaceId)))
      return error('permission_denied', 403);
    const state = store.begin(
      `${body.workspaceId}:${body.actionId}:${body.idempotencyKey}`,
    );
    if (state.kind === 'already_succeeded') return Response.json(state.receipt);
    if (state.kind === 'in_progress')
      return error('execution_in_progress', 409);
    const loaded = await dependencies.loadApprovedAction(
      body.workspaceId,
      body.actionId,
    );
    if (loaded === null) return error('action_not_found', 404);
    const decision = gate.validate(loaded.input);
    if (!decision.ok)
      return Response.json({ error: decision }, { status: 409 });
    try {
      const result = await dependencies.execute(loaded.action);
      const receipt = createReceipt({
        actionId: loaded.input.passport.actionId,
        workspaceId: loaded.input.passport.workspaceId,
        passportHash: decision.passportHash,
        executionAttempt: 1,
        ...result,
        occurredAt: loaded.input.now,
      });
      await dependencies.capture(receipt);
      if (result.outcome === 'succeeded')
        store.succeed(
          `${body.workspaceId}:${body.actionId}:${body.idempotencyKey}`,
          receipt,
        );
      else
        store.failRetryably(
          `${body.workspaceId}:${body.actionId}:${body.idempotencyKey}`,
          receipt,
        );
      return Response.json(receipt, {
        status: result.outcome === 'succeeded' ? 200 : 502,
      });
    } catch (cause) {
      store.failRetryably(
        `${body.workspaceId}:${body.actionId}:${body.idempotencyKey}`,
        cause,
      );
      return error('provider_failure', 502);
    }
  };
}

function error(code: string, status: number): Response {
  return Response.json(
    { error: { code, retryable: status >= 500 } },
    { status },
  );
}
async function readBody(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
