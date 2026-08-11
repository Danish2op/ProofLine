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
