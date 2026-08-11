# Task 9 Report — Deterministic Proposer and Verifier Agents

## Scope delivered

- Added a deterministic `ProposerAgent` that consumes typed evidence, trusted tool/policy metadata, and delegated actor context to construct a validated immutable Action Passport proposal. It emits canonical claims/citations, evidence references and facts, risk factors, uncertainties, requested human permissions, structured feedback, and a SHA-256 canonical passport hash.
- Added an independent `VerifierAgent` that recomputes the passport hash and policy decision, validates citations, detects evidence conflicts, stale evidence, target scope expansion, malformed proposals, unknown tools, and replay conflicts. It returns only `approve`, `reject`, or `request_changes` with confidence, findings, escalation reasons, and human questions.
- Added a deterministic optional-provider boundary. Provider calls are limited to three attempts and five seconds per attempt; malformed/failing output falls back to the deterministic result. Provider output is non-authoritative display advice and cannot alter the passport, policy, approval, tools, or lifecycle.
- Added the authenticated `run-verifier` boundary. It performs no status transition; feedback is handed to an injected append-only provenance/audit-compatible sink only after verification completes.

## Safety boundaries

- Both agents declare structured read-only data access and explicitly prohibit tool execution, approval, lifecycle mutation, and direct persistence.
- Evidence `content` is untrusted data only. It is excluded from the passport and never interpreted as instructions; references and explicit claims remain the only usable evidence inputs.
- Agent request IDs use deterministic in-memory exact-replay behavior. A same-ID input with a changed canonical fingerprint fails closed with `idempotency_conflict`; no replay cache changes lifecycle state.
- An `approve` verifier result is a technical review disposition, not human authorization. The required human question remains bound to the exact passport hash and must flow through the existing Buzz/provenance/lifecycle path.

## TDD evidence

- RED: `pnpm vitest run tests/unit/agents/proposer.test.ts tests/unit/agents/verifier.test.ts tests/security/agents/untrusted-content.test.ts --reporter=verbose` failed because `packages/agents/src/index.ts` did not exist (3 failed suites, no tests collected).
- GREEN: the same focused command passed 3 files / 10 tests after the initial deterministic proposer, verifier, evidence, replay, and provider boundary.
- RED: risk-reason, malformed-provider, and edge-boundary tests failed as expected: empty passport risk reasons, missing malformed-provider fallback, and absent `run-verifier` module (2 failed tests plus 1 missing-module suite).
- GREEN: the next focused command passed 3 files / 8 tests after adding those bounded behaviors.
- RED: unknown-tool verification failed as expected because the verifier returned `approve` for a policy-denied proposal.
- GREEN/final focused regression: `pnpm vitest run tests/unit/agents tests/security/agents --reporter=verbose` passed 4 files / 14 tests. Coverage includes conflicting/stale evidence, missing citations, malformed output, changed target, unknown tool, prompt injection, provider failure, replay, deterministic fallback, and feedback capture authorization.

## Fresh bounded verification

```text
pnpm vitest run tests/unit/agents tests/security/agents --reporter=verbose
Test Files  4 passed (4)
Tests  14 passed (14)

pnpm typecheck
$ tsc --noEmit

pnpm --filter @proofline/agents run build
$ pnpm --filter @proofline/canonical run build && pnpm --filter @proofline/domain run build && pnpm --filter @proofline/policy-engine run build && tsc -p tsconfig.build.json

pnpm exec prettier --check packages/agents tests/unit/agents tests/security/agents supabase/functions/run-verifier tsconfig.base.json
All matched files use Prettier code style!

git diff --check
# exit 0
```

No live credentials, model provider, tool execution, Buzz publication, or database mutation was used. No migration was required, and Tasks 10+ were not started.

The Task 9 code, tests, edge boundary, and evidence documents passed the scoped
Prettier check. `pnpm-lock.yaml` contains only the required three workspace-link
entries for `@proofline/agents`; a standalone Prettier check would rewrite
unrelated lockfile whitespace, so that whole-file rewrite was intentionally not
included in this bounded Task 9 commit.

## Fix round 1 — final reviewer findings

- The verifier boundary now has a concrete default Supabase-backed production
  entrypoint. It authenticates a bearer token, checks active workspace
  membership with verifier-capable roles, loads the action passport and latest
  revision server-side, validates workspace/action/hash identity, and overwrites
  untrusted request passport fields with the loaded server values before
  verification.
- Feedback is captured through an append-only `audit_events` adapter with
  workspace, actor, request ID, idempotency key, request-byte fingerprint, and
  passport hash. Deterministic event identity plus lookup/replay handling means
  byte-identical duplicates return the original result without a second capture;
  conflicting reuse fails with `idempotency_conflict`. No lifecycle status is
  mutated.
- The verifier rejects empty claims, empty passport evidence, omitted evidence
  facts, missing citations, and facts whose IDs are absent from passport
  evidence before any approval disposition.
- Optional providers now receive `AbortSignal`; timeout aborts and settles the
  provider before retrying. The regression proves at most one active call,
  abort delivery for every timed-out attempt, and no late side effect.
- Proposer sorting uses a locale-independent codepoint comparator for all
  security-relevant ordering.

Strict TDD evidence for this round:

- RED: the new fix-round suite reported 6 failures / 21 tests for server
  binding/deduplication, cancellation, locale ordering, and verifier completeness.
- GREEN: the focused suite passed 4 files / 21 tests after the fixes.
- `pnpm typecheck` passed and `pnpm --filter @proofline/agents run build` passed.
- Initial `pnpm format:check` identified only the six changed Task 9 files and
  `pnpm-lock.yaml`; after formatting those exact files, the repository check
  passed: `All matched files use Prettier code style!`.

No migration was required. Tasks 10+ remain untouched.

## Fix round 2 â€” verifier identity, deadline, and evidence completeness

- The HTTP boundary accepts only `workspaceId`, public `actionPassportId`
  (action ID), `requestId`, and `idempotencyKey`; no client-supplied
  verification context remains. The server resolves that action ID to the
  `action_passports` row UUID and latest revision, then rejects any
  row/revision/passport-hash mismatch before invoking verification.
- Feedback lookup, replay, deterministic audit UUID, aggregate identity, and
  stored metadata use the server row UUID together with workspace, action,
  actor, request, and idempotency identity. This preserves exact replay while
  preventing action/workspace collisions.
- Evidence facts include a claim ID. The verifier requires every fact to match
  trusted server facts and a cited claim/evidence pair, so distinct claims with
  identical subject/value text cannot share a single fact.
- A timed-out optional provider is aborted and detached; fallback returns at
  that deadline even if the provider promise never settles.

Strict TDD evidence:

- RED: `pnpm vitest run tests/unit/agents/run-verifier-boundary.test.ts
  tests/unit/agents/verifier.test.ts --reporter=verbose` produced three
  expected failures: public action ID used for feedback lookup, accepted
  row/revision hash mismatch, and omitted same-valued claim fact.
- GREEN: `pnpm vitest run tests/unit/agents/run-verifier-boundary.test.ts
  tests/unit/agents/verifier.test.ts tests/security/agents/untrusted-content.test.ts
  --reporter=verbose` passed 3 files / 23 tests. It includes the
  never-settling-provider deadline regression.

Fresh bounded verification also ran `pnpm typecheck`,
`pnpm --filter @proofline/agents run build`, scoped Prettier, and `git diff
--check`. No full suite, live provider, credentials, Buzz publication,
database mutation, migration, lifecycle mutation, or Task 10+ work was run.

## Fix round 3 — canonical revision trust and feedback identity

- `run-verifier` validates the server-loaded revision payload with
  `validatePassport`, replaces the raw value with the validated
  `ActionPassportV1`, recomputes `computePassportHash`, and requires the result
  to equal both the revision hash and parent action-passport hash before calling
  the verifier. Malformed, arbitrary-hash, and valid-shaped tampered payloads
  fail closed.
- The production Supabase loader performs the same validation and hash binding
  before returning its record. It no longer reads `trustedEvidenceFacts` from
  unvalidated revision JSON; no unvalidated fact reaches verification.
- In-memory feedback replay and deterministic audit UUID generation share a
  canonical structured identity hash. It retains workspace, passport-row,
  canonical action, actor, request, and idempotency scope while making embedded
  delimiters unambiguous.

Strict TDD evidence:

- Test-fixture normalization to valid literal-hash `ActionPassportV1` records
  preserved the focused baseline at 1 file / 7 tests.
- RED: `pnpm vitest run tests/unit/agents/run-verifier-boundary.test.ts
  --reporter=verbose --maxWorkers=1` produced 4 expected failures / 11 tests:
  malformed arbitrary-hash payload returned 200, tampered payload returned 200,
  replay tuples collided with 409, and audit tuples produced one UUID.
- GREEN: `pnpm vitest run tests/unit/agents/run-verifier-boundary.test.ts
  tests/unit/agents/verifier.test.ts tests/security/agents/untrusted-content.test.ts
  --maxWorkers=1` passed 3 files / 27 tests.

Bounded verification:

- The first one-worker full run passed 26 files but reproduced the two known
  5-second package-build timeouts. The canonical and worker probes then passed
  alone (2 files / 2 tests), and two fresh full reruns each passed 28 files / 290
  tests with 1 credential-gated skip.
- `pnpm typecheck` initially caught a local generic-record narrowing issue in
  the new audit helper call; after explicit validated-field projection, the
  fresh typecheck passed.
- `pnpm build`, `pnpm lint`, and `pnpm format:check` passed.

No migration, lifecycle mutation, tool execution, UI work, live provider,
credentials, Buzz publication, database mutation, or Task 10+ work was used.

### Takeover verification (2026-08-11)

- `pnpm vitest run tests/unit/agents/run-verifier-boundary.test.ts
  tests/unit/agents/verifier.test.ts tests/security/agents/untrusted-content.test.ts
  --maxWorkers=1 --reporter=verbose` passed 3 files / 27 tests.
- `pnpm typecheck`, `pnpm --filter @proofline/agents run build`, repository-wide
  `pnpm format:check`, and `git diff --check` each exited 0.

No unbounded full suite, migration, lifecycle mutation, live provider,
credentials, Buzz publication, database action, or Task 10+ work was run.

## Final blocker — NUL-safe evidence identity

- Replaced every NUL-delimited identity in verifier evidence coverage with the
  existing `hashCanonicalJson` structured SHA-256 boundary. Complete facts hash
  named claim, evidence, subject, and value fields; citation coverage hashes the
  named claim/evidence pair.
- Added an adversarial real-agent regression using two distinct subject/value
  tuples that collapse to the same delimiter-concatenated string. The verifier
  must reject the proposed tuple as `unbound_evidence_fact`.
- RED: the isolated regression failed because the verifier returned `approve`.
- GREEN: the isolated regression passed, then the bounded verifier regression
  passed 3 files / 28 tests with one worker.
- Fresh `pnpm typecheck`, `pnpm build`, and repository-wide `pnpm
  format:check` each exited 0.

No migration, lifecycle mutation, live provider, credentials, Buzz
publication, database action, execution/UI work, or Task 10+ work was used.
