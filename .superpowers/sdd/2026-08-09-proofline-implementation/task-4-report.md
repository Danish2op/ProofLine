# Task 4 Report: Deterministic Risk Metadata and Policy Evaluation

Implementation commit: `5f3402f feat: add metadata policy engine`

## Scope

Implemented only Task 4. The policy engine recomputes deterministic decisions
from the passport, server-authoritative actor context, validated tool metadata,
workspace policy, and server time. It uses Task 3's canonical JSON hashing for
the versioned policy snapshot; it does not duplicate canonicalization or hashing
helpers.

## RED evidence

Each production change followed a failing test run:

1. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts tests/security/policy-bypass.test.ts`
   - Exit code: `1`
   - Result: `2 failed` test files with no discovered tests because both imports
     failed to resolve the absent `packages/policy-engine/src/evaluate.ts`.
2. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `1`
   - Result: `1 failed | 12 passed` tests.
   - Observed failure: empty `declaredScopes` incorrectly returned `allow`.
3. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `1`
   - Result: `1 failed | 13 passed` tests.
   - Observed failure: an invalid evidence-expiry timestamp incorrectly returned
     `allow`.
4. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `1`
   - Result: `1 failed | 14 passed` tests.
   - Observed failure: a trusted but non-read-only action with no other flags
     incorrectly returned `allow`.

## GREEN evidence

1. Added the fixed versioned rule document, strict runtime metadata/policy
   validation, typed explainable risk factors, canonical snapshot hashing, and
   deny > approval > allow precedence.
   - `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts tests/security/policy-bypass.test.ts`
   - Exit code: `0`; `13 passed` tests in `2 passed` files.
2. Rejected empty declared tool scopes.
   - `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `0`; `13 passed` tests in `1 passed` file.
3. Treated invalid evidence expiry as stale evidence.
   - `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `0`; `14 passed` tests in `1 passed` file.
4. Added the `write_capable_action` approval factor for non-read-only actions
   without destructive or external-side-effect annotations.
   - `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts tests/security/policy-bypass.test.ts`
   - Exit code: `0`; `16 passed` tests in `2 passed` files.

## REFACTOR evidence

Formatted the policy implementation and tests with:

`pnpm exec prettier --write packages/policy-engine/src/risk.ts packages/policy-engine/src/rules.ts tests/unit/policy-engine/evaluate.test.ts`

The focused suite remained green:

`pnpm vitest run tests/unit/policy-engine/evaluate.test.ts tests/security/policy-bypass.test.ts`

- Exit code: `0`; `16 passed` tests in `2 passed` files.

## Final verification

All commands completed with exit code `0`:

- `pnpm format:check` — all matched files use Prettier style.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm test` — `79 passed` tests in `7 passed` files.
- `pnpm build` — passed; canonical emitted successfully and the workspace build
  completed for the configured projects.

## Changed files

- `packages/policy-engine/package.json`
- `packages/policy-engine/src/evaluate.ts`
- `packages/policy-engine/src/risk.ts`
- `packages/policy-engine/src/rules.ts`
- `pnpm-lock.yaml`
- `tests/security/policy-bypass.test.ts`
- `tests/unit/policy-engine/evaluate.test.ts`

## Concerns

- The fixed MVP rule set is intentionally conservative: missing/ambiguous
  metadata, unrecognized agents, missing or expired delegation, and missing or
  stale evidence deny; production, destructive, write-capable, external-side-
  effect, non-idempotent, and confidential-data actions require approval.
- `pnpm build` currently invokes build scripts only for workspace projects that
  declare them; the policy engine is typechecked and exercised from source in
  this task, while a packaged `dist` entrypoint remains a future package-
  hardening concern outside Task 4's requested file map.
- A generic subagent-dispatch tool was unavailable in this environment, so the
  requested independent-review workflow could not be run; a local post-commit
  requirement review found and corrected the non-read-only auto-allow gap.
