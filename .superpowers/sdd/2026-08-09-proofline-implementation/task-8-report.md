# Task 8 Report — Durable Action Lifecycle

Implementation commit: `49fc1f7 feat: add durable action lifecycle`.

## Scope delivered

- Added `packages/domain/src/lifecycle.ts`: a pure, monotonic state transition engine with explicit terminal states, optimistic version checks, approval expiry/binding checks, deterministic audit records, and approval-clearing revision creation.
- Added `apps/worker/src/runtime.ts`: a serialized command boundary that returns structured errors, preserves workspace isolation, replays equivalent commands, rejects conflicting command-ID reuse, and records retryable versus terminal execution failures.
- Added forward-only migration `0012_task_8_lifecycle_commands.sql`: action versions, workspace/action-scoped lifecycle command receipts, advisory plus row locking, a service-role-only `transition_action` RPC, and correlation/causation propagation through the action audit trigger.
- Added the requested Supabase Edge command adapters. The Buzz adapters invoke only the existing verified-Buzz approval RPC; relay or parser behavior was not changed.

## TDD evidence

- RED: `pnpm vitest run tests/unit/lifecycle/state-machine.test.ts tests/integration/lifecycle/race-conditions.test.ts` exited 1 because `packages/domain/src/lifecycle.ts` and `apps/worker/src/runtime.ts` did not exist. Both suites reported the expected module-resolution failures.
- GREEN: the same focused command passed with 21 tests after the minimum lifecycle/runtime implementation.
- Database RED: `pnpm vitest run tests/integration/database/constraints.test.ts` exited 1 on the new lifecycle-migration assertion because the version/receipt/RPC migration had not yet been added.
- Database GREEN: `pnpm vitest run tests/unit/lifecycle/state-machine.test.ts tests/integration/lifecycle/race-conditions.test.ts tests/integration/database/constraints.test.ts` passed: 3 files, 33 tests.
- Fresh final bounded verification on 2026-08-11: the same three-file focused command passed 3 files / 33 tests; `pnpm typecheck` exited 0.
- Race evidence: `tests/integration/lifecycle/race-conditions.test.ts` was run five times in a bounded PowerShell loop; each run passed 1 file / 6 tests, with no double-successful execution claim.

## Limits and remaining failures

- No post-change full suite, lint, build, or repository-wide format check was run, per the user's explicit bounded-verification instruction.
- No live migration probe ran because this task was finalized without `SUPABASE_DB_URL`; no claim is made that migration 0012 has been applied to a database.
- An attempted `vitest --repeat 5` command failed before executing tests because Vitest 4.1.10 does not support `--repeat`. The replacement five-run loop passed.
- This runtime exposed no subagent dispatch/review controls, so an independent subagent review could not be performed. The implementation received controller diff review plus the bounded verification above.

## Fix round 1 evidence (2026-08-11)

All five reviewer findings were addressed: authenticated membership/role checks now precede service-role revoke mutation; approve-action uses the Task 8 transition RPC with version/receipt/audit semantics; migration 0013 derives and validates canonical command hashes and records deterministic rejection receipts/audits; the worker package declares the domain dependency and has a real build/direct-import boundary; and the pure lifecycle engine rejects already-expired approvals before `APPROVED`.

Strict TDD evidence:

- RED: `pnpm vitest run tests/unit/lifecycle/state-machine.test.ts tests/integration/lifecycle/edge-boundaries.test.ts tests/unit/lifecycle/worker-package.test.ts tests/integration/database/constraints.test.ts` — expected 8 failures out of 34 tests.
- Focused GREEN: `pnpm vitest run tests/unit/lifecycle/state-machine.test.ts tests/integration/lifecycle/edge-boundaries.test.ts tests/unit/lifecycle/worker-package.test.ts tests/integration/database/constraints.test.ts tests/integration/lifecycle/race-conditions.test.ts` — 5 files passed, 40 tests passed, 3.94s.
- `pnpm typecheck` — exit 0.
- `pnpm --filter @proofline/worker run build` — exit 0.

Per the bounded-verification instruction, no unbounded full suite was run. Root lint/format, root build, and live Supabase migration/RPC execution were not run; migration coverage is static-contract coverage only.

## Fix round 2 evidence (2026-08-11)

Reviewer findings addressed:

- `process-buzz-event` is now explicitly deprecated with a fail-closed 410 response and no legacy `apply_verified_buzz_approval` mutation path.
- `approve-action` requires expected version, approval event ID, timestamps, reviewer pubkey, and raw event fields. It routes approval through `approve_verified_action`; migration 0014 accepts only stored, signature-verified provenance bound to the exact workspace/action/proposal and an active reviewer identity, and derives the approval values from stored provenance.
- `create-action` authenticates and checks workspace membership/role before its service-role insert.
- Migration 0014 derives tenant/action-scoped audit IDs and raises on an existing ID belonging to another aggregate instead of silently swallowing a collision.
- `pnpm-lock.yaml` was formatted with Prettier and the bounded check passes.

Strict TDD evidence:

- RED: `pnpm vitest run tests/integration/lifecycle/edge-boundaries.test.ts tests/integration/database/constraints.test.ts` — 5 expected failures / 21 tests; failures covered the missing 0014 artifact/contract, incomplete approval acceptance, legacy endpoint, and create boundary.
- Focused GREEN: same command plus `tests/unit/lifecycle/state-machine.test.ts` — 3 files passed, 37 tests passed.
- Final bounded regression: `pnpm vitest run tests/integration/lifecycle/edge-boundaries.test.ts tests/integration/database/constraints.test.ts tests/unit/lifecycle/state-machine.test.ts tests/integration/lifecycle/race-conditions.test.ts tests/unit/lifecycle/worker-package.test.ts` — 5 files passed, 44 tests passed, 4.11s.
- `pnpm typecheck` — exit 0.
- `pnpm exec prettier --check pnpm-lock.yaml` — exit 0 after formatting.

No full suite, root build, lint, repository-wide format check, or live Supabase migration/RPC execution was run in this bounded round.

## Fix round 3 evidence (2026-08-11)

Reviewer findings addressed:

- Approval parsing now follows the verified Buzz adapter contract: kind 9 reads `proofline.decision` from the standard Nostr event `content` JSON, and kind 7 accepts the canonical reaction symbols. Invalid JSON, wrong content shape, unsupported decisions, invalid expiry, and malformed observations fail closed.
- `DatabaseProvenanceWriter.recordAndApply` is observation-only and calls `record_verified_buzz_approval_observation`; it no longer reaches `apply_verified_buzz_approval`. Migration 0015 stores the observation timestamps, preserves Task 7 provenance recording, routes application through `approve_verified_action_v2`, and revokes the old service-role approval grant.
- The migration contract tests cover canonical kind 9/kind 7 parsing, malformed observations, and legacy RPC retirement.

Strict TDD and bounded verification:

- RED: `pnpm vitest run tests/unit/buzz-adapter/provenance.test.ts tests/integration/database/constraints.test.ts` — 4 expected failures / 21 tests.
- Focused GREEN: the same command after implementation — 2 files passed, 21 tests passed.
- Final focused tests: `pnpm vitest run tests/unit/buzz-adapter/provenance.test.ts tests/unit/buzz-adapter/approval-parser.test.ts tests/integration/database/constraints.test.ts tests/integration/lifecycle/edge-boundaries.test.ts tests/unit/lifecycle/state-machine.test.ts tests/integration/lifecycle/race-conditions.test.ts` — 6 files passed, 59 tests passed.
- `pnpm --filter @proofline/buzz-adapter run build` — exit 0.
- `pnpm typecheck` — exit 0.
- Scoped ESLint invocation exited 0 with six existing “file ignored because no matching configuration was supplied” warnings.
- Prettier check passed for all changed formatter-supported Task 8 TypeScript/test files after formatting; SQL migrations were validated by migration contract tests and `git diff --check` because the configured Prettier parser does not support SQL.

No full suite, root lint, live Supabase migration/RPC execution, or unbounded command was run.
