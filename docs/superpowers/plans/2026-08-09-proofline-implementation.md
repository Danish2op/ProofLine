# Proofline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Proofline, a production-minded human–agent action-integrity gateway that creates immutable, metadata-bound Action Passports, uses Buzz for signed proposal/review/approval events, blocks approval drift at execution time, and ships as a reliable public demo with a deterministic GitHub-deployment simulator.

**Architecture:** Proofline is a TypeScript monorepo with a Next.js client on Vercel, Supabase Postgres/Auth/Realtime/Edge Functions for application state and short-lived orchestration, and a Buzz adapter that speaks only documented Buzz/Nostr relay interfaces. The core domain is provider-independent: a proposer creates a canonical action envelope, a verifier challenges it, a human approves the exact hash through Buzz, and a deterministic execution gate validates the hash, policy snapshot, evidence freshness, expiry, identity, and idempotency immediately before execution.

**Tech Stack:** pnpm workspaces, TypeScript with strict mode, Next.js App Router, React, Zod, Supabase Postgres/Auth/Realtime/Edge Functions, `@supabase/supabase-js`, `nostr-tools` or the smallest documented-compatible Nostr client, RFC 8785 JSON Canonicalization Scheme, Web Crypto APIs, Vitest, Testing Library, Playwright, ESLint, Prettier, GitHub Actions, Vercel.

## Global Constraints

- The first customer-facing workflow is GitHub-style deployment approval in a deterministic sandbox; real GitHub mutation is deferred behind an explicit provider adapter.
- The MVP must work without an LLM, paid API, private GitHub repository, or running customer agent.
- Deterministic Proposer and Verifier workers must implement the same action lifecycle and approval invariants as an optional model-backed provider.
- Buzz is a required runtime collaboration dependency in live mode; offline replay is a clearly labeled failure-mode fallback, not the primary integration.
- Do not invent Buzz approval APIs or undocumented Buzz custom event kinds; use documented Nostr/Buzz event publication, query/subscription, channel/thread references, and reactions only after the protocol-validation spike confirms the current interface.
- Never store a Nostr private key, GitHub token, Supabase service-role key, or provider secret in Postgres, browser local storage, logs, fixtures, screenshots, or audit exports.
- Every consequential action is bound to an immutable `passport_hash`; changing normalized arguments, target, tool definition, evidence hash, policy version, delegated identity, or expiry creates a new passport revision and invalidates prior approval.
- All state transitions are server-authoritative, monotonic, transactionally recorded, idempotent, and auditable.
- All tenant-owned reads and writes are enforced by Postgres Row Level Security in addition to application authorization.
- Public demo data is synthetic and must be labeled as such throughout the UI and README.
- Free hosting is acceptable for a personal/non-commercial demo; Vercel Hobby’s published terms restrict it to personal, non-commercial use, so production commercialization requires a hosting-plan decision.
- Every task ends with focused tests, a full relevant test command, and a small conventional commit.

---

## Scope and Decomposition

This plan contains one vertical product but separates independently testable subsystems: domain invariants, persistence/auth, Buzz protocol adapter, policy/verifier, execution gate, demo provider, UI, and deployment. The first milestone is the complete sandbox path; GitHub and model-provider adapters are separate extension points and are not allowed to delay the sandbox.

The implementation order is deliberately vertical:

```text
protocol validation
→ domain contracts
→ database/auth
→ passport and lifecycle
→ Buzz proposal/approval
→ deterministic agents
→ execution gate
→ replayable UI
→ security/load/deployment hardening
```

## Repository File Map

Create the following structure before implementing feature work:

```text
apps/
  web/
    app/
      (marketing)/
      demo/
      actions/[actionId]/
      audit/[actionId]/
      api/health/route.ts
    components/
    lib/
    middleware.ts
    next.config.ts
  worker/
    src/
      jobs/
      providers/
      runtime.ts
packages/
  domain/
    src/
      action.ts
      evidence.ts
      policy.ts
      lifecycle.ts
      errors.ts
      events.ts
  canonical/
    src/
      canonicalize.ts
      hashing.ts
      redaction.ts
  policy-engine/
    src/
      evaluate.ts
      risk.ts
      rules.ts
  buzz-adapter/
    src/
      client.ts
      event-codec.ts
      approval-parser.ts
      fixtures.ts
  agents/
    src/
      proposer.ts
      verifier.ts
      prompts/
  execution/
    src/
      gate.ts
      idempotency.ts
      receipts.ts
      providers/sandbox.ts
  authz/
    src/
      roles.ts
      permissions.ts
      workspace.ts
supabase/
  migrations/
  functions/
    create-action/
    run-verifier/
    process-buzz-event/
    approve-action/
    execute-action/
    demo-reset/
  seed.sql
  config.toml
fixtures/
  demo/
    deployment/
    evidence/
    buzz-events/
tests/
  unit/
  integration/
  security/
  e2e/
docs/
  architecture.md
  security-model.md
  buzz-integration.md
  runbooks/
```

The domain packages must not import React, Supabase, Vercel, or Buzz. Buzz, HTTP, and database details belong at the adapters and application boundaries.

---

### Task 1: Bootstrap the Repository and Toolchain

**Files:**
- Create: `package.json`
- Create: `pnpm-workspace.yaml`
- Create: `tsconfig.base.json`
- Create: `.editorconfig`
- Create: `.gitignore`
- Create: `.env.example`
- Create: `README.md`
- Create: `packages/domain/package.json`
- Create: `packages/canonical/package.json`
- Create: `packages/policy-engine/package.json`
- Create: `packages/buzz-adapter/package.json`
- Create: `packages/agents/package.json`
- Create: `packages/execution/package.json`
- Create: `packages/authz/package.json`
- Create: `apps/web/package.json`
- Create: `apps/worker/package.json`
- Create: `vitest.config.ts`
- Create: `.github/workflows/ci.yml`

**Interfaces:**
- Produces workspace scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:e2e`, `pnpm build`, `pnpm format:check`.
- Produces environment names only; never commit values: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `BUZZ_RELAY_URL`, `BUZZ_DEMO_CHANNEL`, `BUZZ_AGENT_PRIVATE_KEY`, `BUZZ_VERIFIER_PRIVATE_KEY`, `BUZZ_HUMAN_PUBLIC_KEY`, `DEMO_MODE`, `APP_ORIGIN`.

- [ ] **Step 1: Write repository smoke tests** for package resolution, strict TypeScript compilation, and the root scripts.
- [ ] **Step 2: Run `pnpm install --frozen-lockfile` and `pnpm typecheck`** to verify the empty workspace fails only on missing package entrypoints, not on configuration errors.
- [ ] **Step 3: Create the monorepo configuration** with Node 22 LTS, pnpm version pinned in `packageManager`, strict TypeScript, and no implicit `any`.
- [ ] **Step 4: Add the root scripts and CI workflow** so every pull request runs install, format check, lint, typecheck, unit tests, and build.
- [ ] **Step 5: Run `pnpm lint && pnpm typecheck && pnpm test`** and verify all bootstrap tests pass.
- [ ] **Step 6: Commit** with `git add . && git commit -m "chore: bootstrap proofline monorepo"`.

**Acceptance:** A fresh clone can install and run all non-E2E checks without secrets; CI fails closed on type, lint, formatting, or unit-test errors.

---

### Task 2: Validate the Current Buzz Protocol Before Writing the Adapter

**Files:**
- Create: `docs/buzz-integration.md`
- Create: `packages/buzz-adapter/src/protocol-capabilities.ts`
- Create: `packages/buzz-adapter/src/fixtures.ts`
- Create: `tests/integration/buzz-protocol.contract.test.ts`
- Create: `scripts/buzz-smoke.ts`

**Interfaces:**
- `BuzzCapabilities`: `{ relayUrl: string; publishEvents: boolean; queryEvents: boolean; subscribeEvents: boolean; reactions: boolean; threads: boolean; channelReferences: boolean; source: string; verifiedAt: string }`.
- `BuzzRelayClient` boundary is not implemented until the smoke test confirms the current transport and response shapes.

- [ ] **Step 1: Record the verified interfaces** from the current Buzz repository, architecture documentation, CLI documentation, and relay protocol. Document which interfaces are authoritative, which are adapters, and which remain maintenance risks.
- [ ] **Step 2: Write contract fixtures** for a human proposal reply, verifier reply, human approval reaction, human rejection reaction, duplicate event, out-of-order event, malformed event, and unknown signer.
- [ ] **Step 3: Write contract tests** that validate fixture parsing without making network calls.
- [ ] **Step 4: Add `scripts/buzz-smoke.ts`** that performs a read-only capability probe against `BUZZ_RELAY_URL`, records the exact response shape, and exits nonzero if required capabilities are unavailable.
- [ ] **Step 5: Run the smoke script only against a disposable test community** and store no private data in fixtures or logs.
- [ ] **Step 6: Update `docs/buzz-integration.md`** with the verified date, supported path, fallback path, and explicit note that Proofline approval semantics are implemented by Proofline over Buzz events, not claimed as a native Buzz API.
- [ ] **Step 7: Commit** with `git add docs packages/buzz-adapter tests scripts && git commit -m "docs: validate buzz integration contract"`.

**Acceptance:** The plan has a tested, current Buzz contract before adapter code is written. If reactions or subscriptions are unavailable, the adapter must use the documented message/query fallback and the limitation must be visible in the UI.

---

### Task 3: Define the Domain Contracts and Immutable Action Passport

**Files:**
- Create: `packages/domain/src/action.ts`
- Create: `packages/domain/src/evidence.ts`
- Create: `packages/domain/src/policy.ts`
- Create: `packages/domain/src/events.ts`
- Create: `packages/domain/src/errors.ts`
- Create: `packages/canonical/src/canonicalize.ts`
- Create: `packages/canonical/src/hashing.ts`
- Create: `packages/canonical/src/redaction.ts`
- Test: `tests/unit/domain/action-passport.test.ts`
- Test: `tests/unit/domain/canonicalization.test.ts`

**Interfaces:**
- `ActionPassportV1` fields: `schemaVersion`, `actionId`, `workspaceId`, `agentPubkey`, `delegatedBy`, `toolName`, `toolDefinitionHash`, `target`, `normalizedArguments`, `environment`, `risk`, `evidence`, `policySnapshot`, `approval`, `idempotencyKey`, `createdAt`.
- `computePassportHash(passport: HashablePassport): string` returns lowercase SHA-256 of RFC 8785 canonical JSON.
- `validatePassport(passport: unknown): Result<ActionPassportV1, DomainError>` rejects unknown fields where security-sensitive, invalid Unicode, non-finite numbers, oversized strings, missing identity, and invalid timestamps.
- `createPassportRevision(previous: ActionPassportV1 | null, patch: PassportPatch): ActionPassportV1` always creates a new `actionId` revision and never mutates the previous passport.

- [ ] **Step 1: Write failing tests** for deterministic key-order-independent hashing, Unicode normalization, rejection of `NaN`/`Infinity`, maximum sizes, missing required fields, and revision immutability.
- [ ] **Step 2: Write failing lifecycle tests** for `DRAFT`, `CHALLENGE_REQUIRED`, `PENDING_APPROVAL`, `APPROVED`, `EXECUTING`, `SUCCEEDED`, `FAILED`, `EXPIRED`, `REVOKED`, and `BLOCKED` transitions.
- [ ] **Step 3: Implement schemas** with Zod and domain-specific branded types for `PassportHash`, `EventId`, `Pubkey`, `WorkspaceId`, and `IdempotencyKey`.
- [ ] **Step 4: Implement canonicalization and hashing** using RFC 8785-compatible canonical JSON; reject values that cannot be represented deterministically rather than silently coercing them.
- [ ] **Step 5: Implement redaction** that replaces secrets and sensitive values with stable labels before UI display or logging while preserving the hash of the original protected payload.
- [ ] **Step 6: Run focused tests** with `pnpm vitest run tests/unit/domain/action-passport.test.ts tests/unit/domain/canonicalization.test.ts`.
- [ ] **Step 7: Commit** with `git add packages/domain packages/canonical tests/unit/domain && git commit -m "feat: add immutable action passport domain"`.

**Acceptance:** The same logical passport always yields the same hash; any security-sensitive change yields a different hash; old revisions remain immutable; invalid data cannot enter the domain.

---

### Task 4: Implement Risk Metadata and Policy Evaluation

**Files:**
- Create: `packages/policy-engine/src/risk.ts`
- Create: `packages/policy-engine/src/rules.ts`
- Create: `packages/policy-engine/src/evaluate.ts`
- Test: `tests/unit/policy-engine/evaluate.test.ts`
- Test: `tests/security/policy-bypass.test.ts`

**Interfaces:**
- `PolicyInput`: `{ passport: ActionPassportV1; actor: Actor; toolMetadata: ToolMetadata; workspacePolicy: WorkspacePolicy; now: Date }`.
- `PolicyDecision`: `{ decision: "allow" | "require_approval" | "deny"; reasons: PolicyReason[]; requiredRoles: Role[]; riskScore: number; policySnapshotHash: string }`.
- `ToolMetadata`: `{ readOnly: boolean; destructive: boolean; idempotent: boolean; externalSideEffect: boolean; dataClasses: DataClass[]; declaredScopes: string[]; definitionHash: string }`.
- `evaluatePolicy(input: PolicyInput): PolicyDecision` is pure and deterministic.

- [ ] **Step 1: Write failing policy tests** for read-only auto-allow, destructive action approval, production approval, sensitive-data restriction, unknown tool metadata denial, stale evidence denial, unrecognized agent denial, and missing delegated authority denial.
- [ ] **Step 2: Write failing tests** for policy precedence: explicit deny beats approval, approval requirement beats auto-allow, and unknown metadata never defaults to safe.
- [ ] **Step 3: Implement a versioned policy document** with a fixed MVP rule set and deterministic policy snapshot hash.
- [ ] **Step 4: Implement risk scoring** as an explainable sum of typed factors; persist reasons, not just the score.
- [ ] **Step 5: Add tool annotation ingestion** for read-only, destructive, idempotent, and external-side-effect hints; treat annotations as untrusted hints that require policy validation.
- [ ] **Step 6: Run policy and bypass tests** and verify a forged client-side `decision=allow` is ignored.
- [ ] **Step 7: Commit** with `git add packages/policy-engine tests && git commit -m "feat: add metadata policy engine"`.

**Acceptance:** Every decision is explainable, reproducible from a policy snapshot, and fail-closed when metadata is missing or ambiguous.

---

### Task 5: Create the Supabase Schema, RLS Policies, and Audit Model

**Files:**
- Create: `supabase/migrations/0001_initial_schema.sql`
- Create: `supabase/migrations/0002_rls_policies.sql`
- Create: `supabase/migrations/0003_indexes_constraints.sql`
- Create: `supabase/seed.sql`
- Create: `supabase/config.toml`
- Create: `packages/domain/src/persistence-types.ts`
- Test: `tests/integration/database/rls.test.ts`
- Test: `tests/integration/database/constraints.test.ts`

**Interfaces:**
- Tables: `workspaces`, `workspace_members`, `agents`, `tool_definitions`, `policies`, `action_passports`, `action_revisions`, `evidence_items`, `approval_events`, `execution_attempts`, `execution_receipts`, `buzz_events`, `audit_events`, `outbox_jobs`, `demo_runs`.
- All tenant tables carry `workspace_id`; all foreign keys use restrictive deletes except explicit demo-run cleanup.
- `audit_events`: `{ id, workspace_id, actor_type, actor_id, event_type, aggregate_type, aggregate_id, before_hash, after_hash, metadata_json, occurred_at, correlation_id, causation_id }`.

- [ ] **Step 1: Write migration tests** for tenant isolation, duplicate action IDs, duplicate idempotency keys, impossible lifecycle transitions, expired approval constraints, and foreign-key behavior.
- [ ] **Step 2: Create normalized tables** with UUID primary keys, `timestamptz`, JSONB only for versioned structured payloads, explicit hash columns, and check constraints for lifecycle states.
- [ ] **Step 3: Add indexes** on `(workspace_id, created_at)`, `(workspace_id, status)`, `(workspace_id, idempotency_key)`, `(workspace_id, passport_hash)`, Buzz event IDs, and outbox claim fields.
- [ ] **Step 4: Add RLS policies** using `auth.uid()` membership checks and separate service-role-only policies for workers; deny anonymous access to tenant rows.
- [ ] **Step 5: Add an append-only audit trigger** that rejects updates/deletes to audit rows and records state changes for action aggregates.
- [ ] **Step 6: Seed only synthetic demo data** with visibly fake identities, targets, and credentials.
- [ ] **Step 7: Run local Supabase integration tests** and verify a user from workspace A cannot read, update, or infer rows from workspace B.
- [ ] **Step 8: Commit** with `git add supabase packages/domain tests/integration/database && git commit -m "feat: add tenant database and audit schema"`.

**Acceptance:** Database authorization remains correct even if an API route contains a bug; audit records are append-only; all high-volume queries have matching indexes.

---

### Task 6: Implement Authentication, Workspace Roles, and Server Authorization

**Files:**
- Create: `packages/authz/src/roles.ts`
- Create: `packages/authz/src/permissions.ts`
- Create: `packages/authz/src/workspace.ts`
- Create: `apps/web/middleware.ts`
- Create: `apps/web/lib/auth.ts`
- Create: `apps/web/lib/server-authz.ts`
- Test: `tests/unit/authz/permissions.test.ts`
- Test: `tests/integration/authz/server-route.test.ts`

**Interfaces:**
- Roles: `owner`, `admin`, `proposer`, `verifier`, `reviewer`, `auditor`.
- `can(actor, permission, resource): boolean` is the only application-level permission entry point.
- `requireWorkspaceMember(request, workspaceId, permission): Promise<AuthorizedActor>` rejects unauthenticated, removed, suspended, and cross-tenant actors.

- [ ] **Step 1: Write role-matrix tests** for proposal, verification, approval, revocation, execution, audit export, member management, and policy updates.
- [ ] **Step 2: Implement Supabase Auth session handling** with secure cookies, refresh handling, CSRF protection for state-changing browser requests, and no service-role key in client bundles.
- [ ] **Step 3: Implement workspace membership checks** that resolve role and status server-side for every mutation.
- [ ] **Step 4: Add demo-mode authorization** as a separate, read-only public path; never treat `DEMO_MODE` as permission to access real workspace data.
- [ ] **Step 5: Run authz tests** including expired sessions, role downgrades during an open approval, and a user attempting to approve their own proposal when policy forbids it.
- [ ] **Step 6: Commit** with `git add packages/authz apps/web tests && git commit -m "feat: add workspace authorization"`.

**Acceptance:** The browser cannot perform a privileged mutation without a valid session and role; demo access cannot reach tenant data.

---

### Task 7: Build the Buzz Adapter and Event Provenance Layer

**Files:**
- Create: `packages/buzz-adapter/src/client.ts`
- Create: `packages/buzz-adapter/src/event-codec.ts`
- Create: `packages/buzz-adapter/src/approval-parser.ts`
- Create: `packages/buzz-adapter/src/provenance.ts`
- Modify: `supabase/migrations/0001_initial_schema.sql`
- Test: `tests/unit/buzz-adapter/event-codec.test.ts`
- Test: `tests/unit/buzz-adapter/approval-parser.test.ts`
- Test: `tests/integration/buzz-adapter/relay.test.ts`

**Interfaces:**
- `publishProposal(input: BuzzProposalInput): Promise<BuzzEventRef>`.
- `publishVerification(input: BuzzVerificationInput): Promise<BuzzEventRef>`.
- `publishExecutionReceipt(input: BuzzReceiptInput): Promise<BuzzEventRef>`.
- `readApprovalForProposal(proposalEventId: EventId): Promise<ApprovalObservation>`.
- `verifyEvent(event: UnknownBuzzEvent): VerifiedBuzzEvent | BuzzAdapterError`.
- `BuzzEventRef`: `{ eventId, relayUrl, pubkey, createdAt, kind, rawHash }`.

- [ ] **Step 1: Write parser tests** for valid proposal replies, valid approval reactions, rejection reactions, thread references, duplicate events, event replay, malformed JSON content, invalid signatures, unknown public keys, and wrong-channel events.
- [ ] **Step 2: Implement event verification** using the documented Nostr event fields and signature validation; preserve the raw event hash and never trust client-provided display metadata.
- [ ] **Step 3: Implement reference tags** using standard event/user references; store Proofline passport identifiers in structured content and enforce a maximum content size.
- [ ] **Step 4: Implement approval parsing** with explicit mapping from Buzz reaction/message semantics to `approve`, `reject`, `request_changes`; require the human event to reference the proposal event and match an authorized reviewer public key.
- [ ] **Step 5: Implement duplicate and out-of-order handling** by storing every seen event ID and applying only the highest valid lifecycle transition under a database transaction.
- [ ] **Step 6: Implement retry classification**: retry network timeouts and relay unavailability; do not retry invalid signatures, unauthorized signers, malformed events, or policy-denied approvals.
- [ ] **Step 7: Run recorded fixtures and disposable-relay integration tests**; if the live Buzz interface differs from the validated contract, update the adapter boundary rather than weakening domain invariants.
- [ ] **Step 8: Commit** with `git add packages/buzz-adapter supabase tests && git commit -m "feat: add buzz provenance adapter"`.

**Acceptance:** A Buzz event can authenticate an agent or human, reference an exact proposal, be safely replayed, and produce at most one valid approval transition.

---

### Task 8: Implement Action Lifecycle and Concurrency Control

**Files:**
- Create: `packages/domain/src/lifecycle.ts`
- Create: `apps/worker/src/runtime.ts`
- Create: `supabase/functions/create-action/index.ts`
- Create: `supabase/functions/process-buzz-event/index.ts`
- Create: `supabase/functions/approve-action/index.ts`
- Create: `supabase/functions/revoke-action/index.ts`
- Test: `tests/unit/lifecycle/state-machine.test.ts`
- Test: `tests/integration/lifecycle/race-conditions.test.ts`

**Interfaces:**
- `transitionAction(input: TransitionInput): TransitionResult` is pure and rejects illegal transitions.
- `approveAction(actionId, approvalEvent): Promise<ActionState>` is idempotent on the same approval event and rejects different approvals after a terminal state.
- `revokeAction(actionId, actor, reason): Promise<ActionState>` invalidates future execution but never rewrites history.

- [ ] **Step 1: Write state-machine tests** for every legal transition and every illegal reverse, skip, duplicate, expired, and terminal transition.
- [ ] **Step 2: Write race tests** for simultaneous approve/reject, approve/expire, approve/revoke, two executions, and two workers claiming the same job.
- [ ] **Step 3: Implement lifecycle transitions** with optimistic version checks and a single transaction that inserts an audit event for every accepted transition.
- [ ] **Step 4: Implement database advisory/row locking** for the action row during approval and execution claim; return a conflict response rather than silently retrying a rejected transition.
- [ ] **Step 5: Add correlation and causation IDs** to every request, Buzz event, job, state transition, and execution receipt.
- [ ] **Step 6: Run race-condition tests** repeatedly and verify no test produces two successful execution attempts for one idempotency key.
- [ ] **Step 7: Commit** with `git add packages/domain apps/worker supabase/functions tests && git commit -m "feat: add durable action lifecycle"`.

**Acceptance:** The lifecycle is monotonic and concurrency-safe; rejected or stale approvals cannot resurrect an action.

---

### Task 9: Implement Deterministic Proposer and Verifier Agents

**Files:**
- Create: `packages/agents/src/proposer.ts`
- Create: `packages/agents/src/verifier.ts`
- Create: `packages/agents/src/result-types.ts`
- Create: `packages/agents/src/prompts/optional-model-provider.md`
- Create: `supabase/functions/run-verifier/index.ts`
- Test: `tests/unit/agents/proposer.test.ts`
- Test: `tests/unit/agents/verifier.test.ts`
- Test: `tests/security/agents/untrusted-content.test.ts`

**Interfaces:**
- `ProposerAgent.propose(input: ProposalInput): Promise<ProposalResult>`.
- `VerifierAgent.verify(input: VerificationInput): Promise<VerificationResult>`.
- `ProposalResult` contains a passport, evidence references, normalized arguments, risk factors, and explicit uncertainties.
- `VerificationResult` contains `pass | challenge | deny`, findings, checked hashes, and required human questions.

- [ ] **Step 1: Write fixture-driven tests** for safe staging deployment, production deployment, changed target, stale test evidence, missing test evidence, unknown tool, unsafe tool description, and prompt-injection text inside an evidence document.
- [ ] **Step 2: Implement the Proposer Agent** as deterministic code over typed inputs; it must never execute tools or infer approval from its own output.
- [ ] **Step 3: Implement the Verifier Agent** to recompute hashes, compare tool metadata, check evidence freshness, detect scope expansion, and emit structured findings.
- [ ] **Step 4: Add explicit untrusted-content handling**: evidence content is data; instructions found in it cannot alter policy, tools, identity, or approval state.
- [ ] **Step 5: Add optional model-provider interfaces** without making them required for the sandbox; model output must be parsed into the same typed result and cannot bypass deterministic checks.
- [ ] **Step 6: Run agent security tests** and confirm model-like text cannot call an executor, approve itself, or modify a passport.
- [ ] **Step 7: Commit** with `git add packages/agents supabase/functions/run-verifier tests && git commit -m "feat: add bounded proposer and verifier agents"`.

**Acceptance:** The agents do useful bounded work, have separate permissions, produce structured outputs, and remain safe when all evidence is adversarial text.

---

### Task 10: Implement the Execution Gate and Sandbox Provider

**Files:**
- Create: `packages/execution/src/gate.ts`
- Create: `packages/execution/src/idempotency.ts`
- Create: `packages/execution/src/receipts.ts`
- Create: `packages/execution/src/providers/sandbox.ts`
- Create: `supabase/functions/execute-action/index.ts`
- Test: `tests/unit/execution/gate.test.ts`
- Test: `tests/unit/execution/idempotency.test.ts`
- Test: `tests/integration/execution/sandbox.test.ts`

**Interfaces:**
- `ExecutionGate.validate(input: ExecutionInput): GateDecision`.
- `SandboxProvider.execute(action: ApprovedAction): Promise<ProviderResult>`.
- `createReceipt(input: ReceiptInput): ExecutionReceipt`.
- `ProviderResult`: `{ providerRequestId, outcome, sideEffects, rollbackReference, providerMetadata }`.

- [ ] **Step 1: Write failing gate tests** for exact-match success, changed target, changed arguments, changed tool hash, changed evidence, changed policy, expired approval, revoked action, wrong executor identity, duplicate idempotency key, and missing approval.
- [ ] **Step 2: Implement passport re-hashing** immediately before execution; never trust a cached client or worker decision.
- [ ] **Step 3: Implement idempotency** with a unique database key and an explicit distinction between `already_succeeded`, `in_progress`, `retryable_failure`, and `permanent_failure`.
- [ ] **Step 4: Implement the sandbox provider** with deterministic staging/production targets, simulated latency, simulated provider outage, partial-side-effect fixture, and a deliberate approval-drift switch.
- [ ] **Step 5: Implement receipt creation** with approved passport hash, execution attempt, provider request ID, outcome, side-effect summary, and result hash; redact secrets before persistence.
- [ ] **Step 6: Run integration tests** for retries, provider timeout, duplicate request, partial side effect, and replayed receipt.
- [ ] **Step 7: Commit** with `git add packages/execution supabase/functions/execute-action tests && git commit -m "feat: add approval-bound execution gate"`.

**Acceptance:** The sandbox demonstrates the central invariant: an approved staging action cannot be transformed into a production action without a new approval.

---

### Task 11: Implement Demo Run Orchestration and Offline Replay

**Files:**
- Create: `fixtures/demo/deployment/action.json`
- Create: `fixtures/demo/deployment/tools.json`
- Create: `fixtures/demo/evidence/test-run.json`
- Create: `fixtures/demo/evidence/runbook.md`
- Create: `fixtures/demo/evidence/prompt-injection.txt`
- Create: `supabase/functions/demo-reset/index.ts`
- Create: `apps/web/lib/demo-client.ts`
- Create: `tests/integration/demo/vertical-slice.test.ts`
- Create: `tests/e2e/demo-replay.spec.ts`

**Interfaces:**
- `POST /api/demo/runs` returns `{ runId, actionId, mode }`.
- `POST /api/demo/runs/:runId/advance` returns `{ state, nextRequiredAction, eventIds }`.
- `POST /api/demo/runs/:runId/reset` returns a fresh synthetic run and never deletes non-demo workspace data.
- `GET /api/demo/runs/:runId/replay` returns ordered, redacted events and state snapshots.

- [ ] **Step 1: Write the vertical-slice test** for reset → propose → verify → Buzz approval fixture/live event → drift block → corrected approval → execute → receipt.
- [ ] **Step 2: Implement demo fixture loading** with schema validation, immutable fixture IDs, size limits, and clear synthetic-data labels.
- [ ] **Step 3: Implement state advancement** as idempotent commands; repeated clicks return the existing transition instead of duplicating agents or execution attempts.
- [ ] **Step 4: Implement offline replay** from signed/verified fixture events; visibly show `OFFLINE REPLAY` and disable claims that a live Buzz event was received.
- [ ] **Step 5: Add simulated failure controls** for Buzz unavailable, verifier timeout, stale evidence, provider timeout, and approval drift.
- [ ] **Step 6: Run the vertical integration and Playwright tests** on a clean local Supabase instance.
- [ ] **Step 7: Commit** with `git add fixtures supabase/functions/demo-reset apps/web tests && git commit -m "feat: add deterministic proofline demo"`.

**Acceptance:** A new visitor can complete the full workflow without real agents or external credentials; a presenter can switch to live Buzz mode when configured.

---

### Task 12: Build the Public Web Experience and Audit Viewer

**Files:**
- Create: `apps/web/app/(marketing)/page.tsx`
- Create: `apps/web/app/demo/page.tsx`
- Create: `apps/web/app/actions/[actionId]/page.tsx`
- Create: `apps/web/app/audit/[actionId]/page.tsx`
- Create: `apps/web/components/action-passport.tsx`
- Create: `apps/web/components/metadata-diff.tsx`
- Create: `apps/web/components/event-timeline.tsx`
- Create: `apps/web/components/approval-panel.tsx`
- Create: `apps/web/components/failure-banner.tsx`
- Create: `apps/web/lib/view-models.ts`
- Test: `tests/unit/web/view-models.test.ts`
- Test: `tests/e2e/demo-replay.spec.ts`

**Interfaces:**
- The UI consumes typed view models, never raw database rows.
- Sensitive fields render only through `redactForViewer(value, viewerContext)`.
- Every mutation button sends a server command with an idempotency key and displays the returned server state.

- [ ] **Step 1: Write view-model tests** for masked secrets, missing evidence, expired approvals, unknown Buzz event, duplicate event, offline replay, and provider failure.
- [ ] **Step 2: Build the landing page** around the invariant: “approved action differs from requested action → blocked.” Include a clear synthetic-demo disclaimer.
- [ ] **Step 3: Build the demo flow** with a visible state machine, two agent identities, Buzz event references, metadata fields, and a single intentional drift moment.
- [ ] **Step 4: Build the passport view** showing identity, target, normalized arguments, tool hash, evidence freshness, policy version, risk reasons, approval expiry, and idempotency status.
- [ ] **Step 5: Build the metadata diff view** that highlights only the changed fields and explains why each change invalidates approval.
- [ ] **Step 6: Build the audit viewer** with causal order, raw event references, state transitions, retries, failures, and receipt hash; prevent copying sensitive payloads.
- [ ] **Step 7: Add accessible loading, empty, error, retry, offline, and reduced-motion states**; test keyboard approval flow and screen-reader labels.
- [ ] **Step 8: Run Playwright** at mobile and desktop sizes and commit with `git add apps/web tests && git commit -m "feat: add proofline public demo and audit viewer"`.

**Acceptance:** A technical reviewer can understand the protocol, watch the drift block, inspect metadata, and trace the final receipt without reading the source code.

---

### Task 13: Add API Contracts, Rate Limits, and Abuse Controls

**Files:**
- Create: `apps/web/lib/api-errors.ts`
- Create: `apps/web/lib/idempotency.ts`
- Create: `apps/web/lib/rate-limit.ts`
- Create: `apps/web/app/api/health/route.ts`
- Create: `docs/api.md`
- Test: `tests/integration/api/idempotency.test.ts`
- Test: `tests/security/api/abuse.test.ts`

**Interfaces:**
- All mutations accept `Idempotency-Key` and return a stable result for repeated identical requests.
- Error envelope: `{ error: { code, message, retryable, correlationId, details? } }`.
- Required routes: `POST /api/actions`, `GET /api/actions/:id`, `POST /api/actions/:id/challenge`, `POST /api/actions/:id/approve`, `POST /api/actions/:id/reject`, `POST /api/actions/:id/revoke`, `POST /api/actions/:id/execute`, `GET /api/actions/:id/audit`, `POST /api/demo/runs`, `POST /api/demo/runs/:id/advance`, `POST /api/demo/runs/:id/reset`, `GET /api/health`.

- [ ] **Step 1: Write route contract tests** for validation errors, auth failures, cross-workspace IDs, duplicate requests, stale versions, and unsupported content types.
- [ ] **Step 2: Implement uniform error mapping** without exposing SQL, stack traces, provider secrets, or raw Buzz payloads.
- [ ] **Step 3: Implement idempotency records** with request-body hash comparison; return `409` when the same key is reused with a different body.
- [ ] **Step 4: Implement per-IP demo rate limits** and per-user/workspace mutation limits; allow health checks and replay reads within a separate budget.
- [ ] **Step 5: Add payload limits**: 256 KB action request, 64 KB evidence item, 10 MB total demo fixture, maximum 100 evidence items per passport, maximum 100 event references per action.
- [ ] **Step 6: Run abuse tests** for request floods, oversized JSON, duplicate approvals, invalid UTF-8, path traversal strings, and attempted service-role header injection.
- [ ] **Step 7: Document routes and commit** with `git add apps/web docs tests && git commit -m "feat: harden proofline api contracts"`.

**Acceptance:** API behavior is deterministic under retries and hostile input; rate limits degrade with explicit `429` responses rather than partial mutations.

---

### Task 14: Add Observability, Redaction, and Operational Runbooks

**Files:**
- Create: `apps/web/lib/telemetry.ts`
- Create: `apps/worker/src/telemetry.ts`
- Create: `packages/canonical/src/redaction.ts`
- Create: `docs/runbooks/buzz-outage.md`
- Create: `docs/runbooks/database-outage.md`
- Create: `docs/runbooks/provider-partial-failure.md`
- Create: `docs/runbooks/key-rotation.md`
- Create: `docs/runbooks/incident-replay.md`
- Create: `tests/security/log-redaction.test.ts`

**Interfaces:**
- Structured log fields: `level`, `timestamp`, `service`, `environment`, `correlationId`, `causationId`, `workspaceIdHash`, `actionId`, `eventType`, `durationMs`, `retryable`, `errorCode`.
- Never log: private keys, access tokens, full customer content, raw credentials, full evidence payloads, or unredacted provider responses.

- [ ] **Step 1: Write redaction tests** for GitHub tokens, JWTs, Nostr private keys, Supabase keys, AWS-like credentials, email addresses, and nested JSON secrets.
- [ ] **Step 2: Implement structured logging** with stable correlation IDs and a workspace hash rather than a raw workspace identifier in public logs.
- [ ] **Step 3: Add counters** for proposal success, verifier challenge rate, approval latency, drift blocks, stale-evidence blocks, Buzz delivery failures, provider failures, and duplicate-execution prevention.
- [ ] **Step 4: Add health checks** that distinguish app availability, database connectivity, Buzz connectivity, and demo fixture integrity.
- [ ] **Step 5: Write runbooks** with exact detection, containment, recovery, and replay procedures for each failure mode.
- [ ] **Step 6: Run redaction and failure-injection tests** and verify logs contain correlation IDs but no secrets.
- [ ] **Step 7: Commit** with `git add apps packages docs tests && git commit -m "feat: add observability and operational runbooks"`.

**Acceptance:** An operator can diagnose a failed run without accessing sensitive payloads; every failed action has a replay path and a clear user-facing state.

---

### Task 15: Security, Privacy, Supply Chain, and License Review

**Files:**
- Create: `docs/security-model.md`
- Create: `docs/threat-model.md`
- Create: `SECURITY.md`
- Create: `LICENSE`
- Create: `scripts/license-check.ts`
- Create: `tests/security/tenant-isolation.test.ts`
- Create: `tests/security/replay-attack.test.ts`
- Create: `tests/security/approval-forgery.test.ts`
- Create: `tests/security/prompt-injection.test.ts`

**Interfaces:**
- Threat model assets: action passports, Buzz event identities, policy documents, evidence content, provider credentials, audit records, workspace membership.
- Security invariants: no cross-tenant read/write, no unsigned approval, no approval for a different hash, no private-key persistence, no secret exposure, no unbounded action arguments, no silent provider retry after partial side effect.

- [ ] **Step 1: Write the threat model** covering confused deputy, prompt injection, malicious tool metadata, replayed approval, forged signer, compromised agent key, relay tampering, stale evidence, race conditions, data exfiltration, and denial of service.
- [ ] **Step 2: Implement security tests** for each invariant, including forged Buzz reactions, wrong channel, wrong workspace, altered event content, and reused idempotency keys.
- [ ] **Step 3: Pin dependency versions** and configure lockfile-only CI, Dependabot/Renovate updates, npm audit review, and a generated dependency inventory.
- [ ] **Step 4: Review Buzz Apache-2.0 compatibility** and preserve required notices; choose Apache-2.0 for Proofline if the final dependency review confirms compatibility and no stronger copyleft dependency is introduced.
- [ ] **Step 5: Add key rotation procedures** for demo agent keys and provider credentials; rotation must revoke old public keys without rewriting historical events.
- [ ] **Step 6: Run all security suites** and record accepted residual risks in `docs/security-model.md`.
- [ ] **Step 7: Commit** with `git add SECURITY.md LICENSE docs scripts tests && git commit -m "security: add proofline threat model and controls"`.

**Acceptance:** The security model is reviewable by an engineering team and every claimed control has a test or documented operational boundary.

---

### Task 16: Add Load, Failure, and Data-Volume Validation

**Files:**
- Create: `tests/load/action-lifecycle.load.ts`
- Create: `tests/load/large-audit-export.load.ts`
- Create: `tests/integration/failure-matrix.test.ts`
- Create: `docs/performance.md`

**Interfaces:**
- Test profile: 100 workspaces, 1,000 actions, 10,000 audit events, 100 concurrent read sessions, 20 concurrent mutation attempts, and 10 duplicate execution attempts per action.
- Performance budgets: p95 action read under 500 ms, p95 state mutation under 1 s excluding Buzz/network latency, no duplicate successful execution, and no unbounded memory growth in replay assembly.

- [ ] **Step 1: Seed synthetic load data** in a disposable Supabase project or local instance; never load real user data.
- [ ] **Step 2: Test indexed list queries** with pagination, cursor stability, deleted/expired records, and audit ordering under identical timestamps.
- [ ] **Step 3: Test large audit exports** with streaming pagination, maximum export size, redaction, and cancellation.
- [ ] **Step 4: Inject failures** for database timeout, Buzz timeout, duplicate Buzz delivery, provider timeout, provider partial success, stale evidence, and worker crash after claim.
- [ ] **Step 5: Run load tests** and record p50/p95/p99, error rate, retry count, row-lock wait, and duplicate suppression.
- [ ] **Step 6: Add indexes or bounded pagination** wherever the test reveals a full-table scan or unbounded response.
- [ ] **Step 7: Commit** with `git add tests/load tests/integration/failure-matrix.test.ts docs/performance.md && git commit -m "test: validate proofline load and failure behavior"`.

**Acceptance:** The system remains correct under retries, concurrent mutations, out-of-order events, and realistic demo-scale data volume; performance limits and degradation behavior are documented.

---

### Task 17: Deploy the Zero-Cost Public MVP

**Files:**
- Create: `vercel.json`
- Create: `.env.production.example`
- Create: `docs/deployment.md`
- Create: `docs/demo-operations.md`
- Modify: `.github/workflows/ci.yml`

**Interfaces:**
- Vercel serves the Next.js app and short-lived API routes.
- Supabase provides Auth, Postgres, Realtime, Storage, and Edge Functions.
- Buzz is configured through a relay URL and a disposable demo community/channel.
- GitHub Actions runs CI and optional scheduled smoke checks without being required for the demo’s core interaction.

- [ ] **Step 1: Create a separate Supabase project** for the demo, apply migrations, enable RLS, seed synthetic data, and configure Auth redirect URLs.
- [ ] **Step 2: Configure secrets** only in Vercel/Supabase secret stores; verify that `NEXT_PUBLIC_*` values contain no service credentials.
- [ ] **Step 3: Deploy Edge Functions** and run database, auth, Buzz, and demo smoke tests against the deployed project.
- [ ] **Step 4: Deploy Vercel preview** and run Playwright against the preview URL, including offline replay and failure controls.
- [ ] **Step 5: Deploy production demo** only after the health endpoint, rate limits, redaction, and synthetic-data labels pass verification.
- [ ] **Step 6: Configure a public read-only demo path** and keep live Buzz credentials restricted to presenter mode.
- [ ] **Step 7: Document free-tier limits and degradation**: Supabase inactivity pause, database/storage/function/realtime quotas, Vercel Hobby personal/non-commercial restriction, and the local self-host path.
- [ ] **Step 8: Commit deployment documentation** with `git add vercel.json docs .github && git commit -m "chore: document zero-cost public deployment"`.

**Acceptance:** A clean visitor can complete the sandbox demo from the public URL without credentials; the deployment cannot expose service keys or real user data.

---

### Task 18: Production Readiness Review and Handoff

**Files:**
- Create: `docs/production-readiness.md`
- Create: `docs/release-checklist.md`
- Create: `docs/demo-script.md`
- Modify: `README.md`

**Interfaces:**
- Readiness document maps every global constraint to evidence: test, migration, log, runbook, or documented limitation.
- Release checklist is executable by a second engineer from a clean checkout.

- [ ] **Step 1: Run the complete verification suite**: formatting, lint, typecheck, unit, integration, security, load smoke, build, and E2E.
- [ ] **Step 2: Perform a clean-room setup** using only README instructions and the documented credentials; record every manual step that remains.
- [ ] **Step 3: Walk the demo script** with Buzz live mode, Buzz unavailable mode, offline replay, verifier failure, provider failure, and approval drift.
- [ ] **Step 4: Inspect database policies and production logs** for accidental public data, service-key exposure, raw event leakage, or missing correlation IDs.
- [ ] **Step 5: Review the five highest residual risks**: Buzz interface maintenance, free-tier suspension, provider side effects, key compromise, and false verifier confidence.
- [ ] **Step 6: Update README** with architecture, safety boundary, demo disclaimer, local setup, deployment, and extension guide.
- [ ] **Step 7: Commit** with `git add docs README.md && git commit -m "docs: complete proofline production readiness handoff"`.

**Acceptance:** A reviewer can reproduce the demo, understand what is real versus simulated, inspect the action invariant, and identify every remaining production limitation.

---

## Required Edge-Case Matrix

The implementation is incomplete until each case has a deterministic state, user message, audit event, and test.

| Edge case | Required behavior |
|---|---|
| Same request retried | Return the original result for the same idempotency key and body hash. |
| Same key, different body | Return `409 idempotency_key_conflict`; perform no mutation. |
| Approval arrives twice | Store both raw events, apply one transition, mark the second duplicate. |
| Approval after expiry | Record observation, reject execution, require a new passport revision. |
| Rejection after approval | Record it but do not reverse an already executing/succeeded action; allow explicit revoke before execution. |
| Target changes after approval | Hash mismatch; block execution and create a new revision. |
| Tool definition changes | Hash mismatch; invalidate approval. |
| Evidence becomes stale | Block execution or require fresh evidence according to policy. |
| Buzz delivers events out of order | Persist all events, order by causal reference and server state version, never by client timestamp alone. |
| Buzz relay unavailable | Live mode becomes `DEGRADED`; no approval is accepted; offline replay is clearly labeled. |
| Invalid Buzz signature | Store rejected observation without applying it. |
| Unknown signer | Store rejected observation and alert workspace owner. |
| Wrong workspace/channel | Ignore for state transition and record a security event. |
| Agent key compromised | Revoke public key for future actions; preserve historical attribution. |
| Human loses session during approval | No partial approval; reload latest state and require explicit retry. |
| Worker crashes after claim | Lease expires; retry only if provider idempotency is safe. |
| Provider times out after side effect | Mark `UNKNOWN_OUTCOME`; never blindly retry; require reconciliation. |
| Provider partially succeeds | Persist provider request ID and side-effect summary; require manual recovery path. |
| Browser sends forged `allow` state | Ignore client decision; recompute server-side. |
| Evidence contains prompt injection | Treat as untrusted content; do not execute instructions or alter policy. |
| Oversized payload | Reject before persistence with bounded error response. |
| Unicode/canonicalization ambiguity | Normalize/reject before hashing; never silently coerce. |
| Audit export is large | Cursor paginate, stream, redact, and enforce export limit. |
| Database unavailable | Return retryable error; do not claim Buzz approval or execution success. |
| Demo reset requested twice | Return the same reset result for the command key; delete only demo-run rows. |

## Credentials Needed for Implementation/Deployment

No credentials are needed to review this plan. Once you approve execution, the minimum secrets are:

1. A Supabase project URL and publishable/anon key.
2. A Supabase service-role key supplied only through the deployment secret manager.
3. A disposable Buzz relay/community/channel configuration.
4. Two disposable Buzz agent private keys for the Proposer and Verifier, stored only as deployment secrets.
5. A Buzz human reviewer public key or a configured presenter identity.
6. A Vercel account/project for deployment, if using Vercel.
7. A GitHub repository only if the optional GitHub Action smoke integration is enabled; a personal token is not needed for the sandbox.

The first implementation should not request production GitHub, cloud, payment, customer, or personal-data credentials.

## Plan Self-Review

- **Spec coverage:** Passport schema, metadata policy, Buzz identity/provenance, human approval, bounded agents, deterministic executor, replay, tenancy, auditability, failure handling, security, zero-cost deployment, testing, and handoff are each mapped to tasks.
- **Placeholder scan:** Every deferred production integration is explicitly bounded and has a named adapter interface; no implementation step relies on an unspecified action.
- **Type consistency:** `ActionPassportV1`, `PolicyDecision`, `BuzzEventRef`, `ExecutionInput`, `ProviderResult`, lifecycle states, and API error shapes are defined before their consumers.
- **Scope check:** The sandbox vertical slice is independently deployable. GitHub mutation and model-backed execution remain optional provider extensions and cannot block the MVP.
