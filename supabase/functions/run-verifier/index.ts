/**
 * Authenticated server boundary for verifier runs. The default implementation
 * reads passports and membership from Supabase, calls the configured local
 * deterministic agent service, and records feedback as an append-only audit
 * event. It never changes an action lifecycle status.
 */
export interface AuthenticatedCaller {
  userId: string;
  accessToken?: string;
}

export interface ServerPassportRecord {
  actionPassportRowId: string;
  actionId: string;
  workspaceId: string;
  actionPassportHash: string;
  passportHash: string;
  revisionHash: string;
  passport: Record<string, unknown>;
  actor: unknown;
  toolMetadata: unknown;
  workspacePolicy: unknown;
  trustedEvidenceFacts: unknown[];
}

export interface FeedbackLookup {
  workspaceId: string;
  actionPassportId: string;
  actionId: string;
  actorId: string;
  requestId: string;
  idempotencyKey: string;
  requestFingerprint: string;
  accessToken?: string;
}

export interface FeedbackCapture extends FeedbackLookup {
  passportHash: string;
  result: unknown;
  feedback: unknown;
}

export interface StoredFeedback {
  requestFingerprint: string;
  result: unknown;
}

export interface RunVerifierDependencies {
  authenticate(request: Request): Promise<AuthenticatedCaller | null>;
  authorize(caller: AuthenticatedCaller, workspaceId: string): Promise<boolean>;
  loadPassport?(
    caller: AuthenticatedCaller,
    workspaceId: string,
    actionPassportId: string,
  ): Promise<ServerPassportRecord | null>;
  findFeedback?(
    lookup: FeedbackLookup,
  ): Promise<StoredFeedback | null | undefined>;
  verify(
    input: unknown,
  ): Promise<{ feedback: unknown; [key: string]: unknown }>;
  captureFeedback(feedback: FeedbackCapture | unknown): Promise<void>;
}

export function createRunVerifierHandler(
  dependencies: RunVerifierDependencies = defaultRunVerifierDependencies(),
): (request: Request) => Promise<Response> {
  const replayResults = new Map<
    string,
    { requestFingerprint: string; result: unknown }
  >();
  return async (request) => {
    if (request.method !== 'POST') return error('invalid_request', 405);
    const caller = await dependencies.authenticate(request);
    if (caller === null) return error('unauthenticated', 401);

    const rawBody = await request.text();
    const body = parseJson(rawBody);
    if (!isRecord(body) || typeof body.workspaceId !== 'string') {
      return error('invalid_request', 400);
    }
    const workspaceId = body.workspaceId;
    if (!(await dependencies.authorize(caller, workspaceId))) {
      return error('permission_denied', 403);
    }

    const actionPassportId =
      typeof body.actionPassportId === 'string'
        ? body.actionPassportId
        : undefined;
    const requestId =
      typeof body.requestId === 'string' ? body.requestId : undefined;
    const idempotencyKey =
      typeof body.idempotencyKey === 'string' ? body.idempotencyKey : undefined;
    const strictRequest =
      actionPassportId !== undefined &&
      requestId !== undefined &&
      idempotencyKey !== undefined &&
      Object.keys(body).every((key) =>
        [
          'workspaceId',
          'actionPassportId',
          'requestId',
          'idempotencyKey',
        ].includes(key),
      ) &&
      Object.keys(body).length === 4;
    if (!strictRequest) {
      return error('invalid_request', 400);
    }
    if (
      dependencies.loadPassport === undefined ||
      dependencies.findFeedback === undefined
    ) {
      return error('configuration_missing', 503);
    }
    const loadPassport = dependencies.loadPassport;
    const findFeedback = dependencies.findFeedback;

    const passport = await loadPassport(caller, workspaceId, actionPassportId);
    if (
      passport === null ||
      !validateServerPassport(passport, workspaceId, actionPassportId)
    ) {
      return error('passport_not_found_or_invalid', 404);
    }

    const requestFingerprint = await sha256Hex(rawBody);
    const lookup: FeedbackLookup = {
      workspaceId,
      actionPassportId: passport.actionPassportRowId,
      actionId: passport.actionId,
      actorId: caller.userId,
      requestId,
      idempotencyKey,
      requestFingerprint,
      accessToken: caller.accessToken,
    };
    const replayKey = `${lookup.workspaceId}:${lookup.actionPassportId}:${lookup.actorId}:${lookup.requestId}:${lookup.idempotencyKey}`;
    const replay = replayResults.get(replayKey);
    if (replay !== undefined) {
      return replay.requestFingerprint === requestFingerprint
        ? Response.json(replay.result)
        : error('idempotency_conflict', 409);
    }
    const existing = await findFeedback(lookup);
    if (existing !== null && existing !== undefined) {
      return existing.requestFingerprint === requestFingerprint
        ? Response.json(existing.result)
        : error('idempotency_conflict', 409);
    }

    const boundInput = bindVerificationInput(
      body,
      passport,
      requestId,
      idempotencyKey,
    );
    const result = await dependencies.verify(boundInput);
    const capture: FeedbackCapture = {
      ...lookup,
      passportHash: passport.passportHash,
      result,
      feedback: result.feedback,
    };
    try {
      await dependencies.captureFeedback(capture);
    } catch {
      const raced = await findFeedback(lookup);
      if (raced == null) return error('feedback_persistence_failed', 503);
      return raced.requestFingerprint === requestFingerprint
        ? Response.json(raced.result)
        : error('idempotency_conflict', 409);
    }
    replayResults.set(replayKey, {
      requestFingerprint,
      result,
    });
    return Response.json(result);
  };
}

export function defaultRunVerifierDependencies(): RunVerifierDependencies {
  return {
    authenticate: authenticateFromSupabase,
    authorize: authorizeFromSupabase,
    loadPassport: loadPassportFromSupabase,
    findFeedback: findFeedbackFromSupabase,
    verify: verifyWithLocalAgentService,
    captureFeedback: captureFeedbackToAudit,
  };
}

function bindVerificationInput(
  body: Record<string, unknown>,
  passport: ServerPassportRecord,
  requestId: string,
  idempotencyKey: string,
): Record<string, unknown> {
  return {
    workspaceId: body.workspaceId,
    actionPassportId: passport.actionPassportRowId,
    actionId: passport.actionId,
    requestId,
    idempotencyKey,
    passportHash: passport.passportHash,
    passport: passport.passport,
    authorizedTarget: passport.passport.target,
    actor: passport.actor,
    toolMetadata: passport.toolMetadata,
    workspacePolicy: passport.workspacePolicy,
    trustedEvidenceFacts: passport.trustedEvidenceFacts,
  };
}

function validateServerPassport(
  passport: ServerPassportRecord,
  workspaceId: string,
  actionPassportId: string,
): boolean {
  return (
    passport.workspaceId === workspaceId &&
    passport.actionId === actionPassportId &&
    typeof passport.actionPassportRowId === 'string' &&
    passport.actionPassportRowId.length > 0 &&
    typeof passport.revisionHash === 'string' &&
    typeof passport.actionPassportHash === 'string' &&
    passport.actionPassportHash === passport.revisionHash &&
    passport.revisionHash === passport.passportHash &&
    /^[0-9a-f]{64}$/.test(passport.passportHash) &&
    isRecord(passport.passport) &&
    passport.passport.actionId === actionPassportId &&
    passport.passport.workspaceId === workspaceId
  );
}

async function authenticateFromSupabase(
  request: Request,
): Promise<AuthenticatedCaller | null> {
  const token = request.headers
    .get('authorization')
    ?.match(/^Bearer\s+([^\s]+)$/i)?.[1];
  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!token || !url || !anonKey) return null;
  const response = await fetch(`${url}/auth/v1/user`, {
    headers: { apikey: anonKey, authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;
  const value = await response.json();
  return isRecord(value) && typeof value.id === 'string'
    ? { userId: value.id, accessToken: token }
    : null;
}

async function authorizeFromSupabase(
  caller: AuthenticatedCaller,
  workspaceId: string,
): Promise<boolean> {
  const url = env('SUPABASE_URL');
  const anonKey = env('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !anonKey || !caller.accessToken) return false;
  const response = await fetch(`${url}/rest/v1/rpc/is_workspace_member`, {
    method: 'POST',
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${caller.accessToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      target_workspace_id: workspaceId,
      allowed_roles: ['owner', 'admin', 'verifier'],
    }),
  });
  if (!response.ok) return false;
  const value = await response.json();
  return value === true || (Array.isArray(value) && value[0] === true);
}

async function loadPassportFromSupabase(
  caller: AuthenticatedCaller,
  workspaceId: string,
  actionId: string,
): Promise<ServerPassportRecord | null> {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key || !caller.accessToken || !isUuid(actionId)) return null;
  const headers = {
    apikey: key,
    authorization: `Bearer ${caller.accessToken}`,
  };
  const action = await getJson(
    `${url}/rest/v1/action_passports?workspace_id=eq.${encodeURIComponent(workspaceId)}&action_id=eq.${actionId}&select=id,action_id,workspace_id,passport_hash`,
    headers,
  );
  if (!Array.isArray(action) || !isRecord(action[0])) return null;
  const actionRow = action[0];
  const rowId = typeof actionRow.id === 'string' ? actionRow.id : null;
  if (rowId === null) return null;
  const revision = await getJson(
    `${url}/rest/v1/action_revisions?workspace_id=eq.${encodeURIComponent(workspaceId)}&action_passport_id=eq.${rowId}&select=passport_hash,payload_json&order=revision_number.desc&limit=1`,
    headers,
  );
  if (!Array.isArray(revision) || !isRecord(revision[0])) return null;
  const payload = revision[0].payload_json;
  return isRecord(payload) &&
    typeof actionRow.action_id === 'string' &&
    typeof actionRow.workspace_id === 'string' &&
    typeof actionRow.passport_hash === 'string' &&
    typeof revision[0].passport_hash === 'string' &&
    isRecord(payload)
    ? {
        actionPassportRowId: rowId,
        actionId: actionRow.action_id,
        workspaceId: actionRow.workspace_id,
        actionPassportHash: actionRow.passport_hash,
        passportHash: revision[0].passport_hash,
        revisionHash: revision[0].passport_hash,
        passport: payload,
        actor: payload.actor,
        toolMetadata: payload.toolMetadata,
        workspacePolicy: payload.workspacePolicy,
        trustedEvidenceFacts: Array.isArray(payload.trustedEvidenceFacts)
          ? payload.trustedEvidenceFacts
          : [],
      }
    : null;
}

async function findFeedbackFromSupabase(
  lookup: FeedbackLookup,
): Promise<StoredFeedback | null> {
  const url = env('SUPABASE_URL');
  const key = env('SUPABASE_ANON_KEY', 'NEXT_PUBLIC_SUPABASE_ANON_KEY');
  if (!url || !key || !isUuid(lookup.actionPassportId) || !lookup.accessToken)
    return null;
  const query = `${url}/rest/v1/audit_events?workspace_id=eq.${encodeURIComponent(lookup.workspaceId)}&aggregate_id=eq.${lookup.actionPassportId}&event_type=eq.AGENT_VERIFICATION_FEEDBACK&select=metadata_json`;
  const rows = await getJson(query, {
    apikey: key,
    authorization: `Bearer ${lookup.accessToken}`,
  });
  if (!Array.isArray(rows)) return null;
  const row = rows.find((candidate) => {
    if (!isRecord(candidate) || !isRecord(candidate.metadata_json))
      return false;
    const metadata = candidate.metadata_json;
    return (
      metadata.actorId === lookup.actorId &&
      metadata.actionId === lookup.actionId &&
      metadata.requestId === lookup.requestId &&
      metadata.idempotencyKey === lookup.idempotencyKey
    );
  });
  if (!isRecord(row) || !isRecord(row.metadata_json)) return null;
  const metadata = row.metadata_json;
  return typeof metadata.requestFingerprint === 'string' && 'result' in metadata
    ? {
        requestFingerprint: metadata.requestFingerprint,
        result: metadata.result,
      }
    : null;
}

async function captureFeedbackToAudit(
  feedback: FeedbackCapture | unknown,
): Promise<void> {
  if (
    !isRecord(feedback) ||
    typeof feedback.workspaceId !== 'string' ||
    typeof feedback.actionPassportId !== 'string' ||
    typeof feedback.actionId !== 'string' ||
    typeof feedback.actorId !== 'string' ||
    typeof feedback.requestId !== 'string' ||
    typeof feedback.idempotencyKey !== 'string' ||
    typeof feedback.requestFingerprint !== 'string' ||
    typeof feedback.passportHash !== 'string' ||
    !('result' in feedback)
  )
    throw new Error('invalid_feedback_capture');
  const url = env('SUPABASE_URL');
  const serviceKey = env('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey || !isUuid(feedback.actionPassportId))
    throw new Error('configuration_missing');
  const eventId = await uuidFrom(
    `${feedback.workspaceId}:${feedback.actionPassportId}:${feedback.actionId}:${feedback.actorId}:${feedback.requestId}:${feedback.idempotencyKey}`,
  );
  const response = await fetch(`${url}/rest/v1/audit_events`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      'content-type': 'application/json',
      prefer: 'return=minimal',
    },
    body: JSON.stringify({
      id: eventId,
      workspace_id: feedback.workspaceId,
      actor_type: 'human',
      actor_id: feedback.actorId,
      event_type: 'AGENT_VERIFICATION_FEEDBACK',
      aggregate_type: 'action_passport',
      aggregate_id: feedback.actionPassportId,
      after_hash: feedback.passportHash,
      metadata_json: {
        actorId: feedback.actorId,
        workspaceId: feedback.workspaceId,
        actionPassportId: feedback.actionPassportId,
        actionId: feedback.actionId,
        requestId: feedback.requestId,
        idempotencyKey: feedback.idempotencyKey,
        requestFingerprint: feedback.requestFingerprint,
        result: feedback.result,
        feedback: feedback.feedback,
      },
    }),
  });
  if (!response.ok) throw new Error('feedback_persistence_failed');
}

async function verifyWithLocalAgentService(
  input: unknown,
): Promise<{ feedback: unknown; [key: string]: unknown }> {
  const url = env('PROOFLINE_AGENT_SERVICE_URL');
  const key = env('PROOFLINE_AGENT_SERVICE_KEY');
  if (!url || !key) throw new Error('deterministic_agent_service_unconfigured');
  const response = await fetch(`${url.replace(/\/$/, '')}/verify`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${key}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error('deterministic_agent_service_failed');
  const result = await response.json();
  if (!isRecord(result) || !('feedback' in result))
    throw new Error('malformed_verifier_result');
  return result as { feedback: unknown; [key: string]: unknown };
}

async function getJson(
  url: string,
  headers: Record<string, string>,
): Promise<unknown> {
  const response = await fetch(url, { headers });
  return response.ok ? response.json() : null;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function uuidFrom(value: string): Promise<string> {
  const hash = await sha256Hex(value);
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-5${hash.slice(13, 16)}-${((Number.parseInt(hash.slice(16, 18), 16) & 0x3f) | 0x80).toString(16).padStart(2, '0')}${hash.slice(18, 20)}-${hash.slice(20, 32)}`;
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function error(code: string, status: number): Response {
  return Response.json({ error: { code, retryable: false } }, { status });
}

function env(name: string, fallback?: string): string | undefined {
  const deno = (
    globalThis as { Deno?: { env: { get(key: string): string | undefined } } }
  ).Deno;
  return (
    deno?.env.get(name) ?? (fallback ? deno?.env.get(fallback) : undefined)
  );
}

const deno = (
  globalThis as {
    Deno?: { serve(handler: (request: Request) => Promise<Response>): void };
  }
).Deno;
if (deno) deno.serve(createRunVerifierHandler());
