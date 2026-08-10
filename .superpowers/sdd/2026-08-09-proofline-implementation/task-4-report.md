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

---

# Task 4 Fix Round 1 Report

Implementation commit: `c06460b fix: harden deterministic policy evaluation`

## Scope

Addressed all independent-review findings within Task 4: uncapped explainable
risk totals, fail-closed time and actor validation, expiry-required delegation,
domain/policy public package boundaries, and the requested policy-branch
coverage. No later task was started.

## RED evidence

Each behavior change was introduced by a failing regression:

1. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `1`; `1 failed | 15 passed`.
   - Aggregate factors totaled `105`, but `riskScore` was capped at `100`.
2. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `1`; `1 failed | 16 passed`.
   - `new Date('invalid')` incorrectly produced `allow`.
3. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `1`; `1 failed | 17 passed`.
   - A non-expiring delegation was allowed despite
     `requireDelegatedAuthorityExpiry: true`.
4. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `1`; `2 failed | 18 passed`.
   - Runtime actor metadata with `recognized: 'false'` or an unknown role was
     incorrectly allowed.
5. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `1`; `1 failed | 20 passed`.
   - A delegation expiry of `not-a-timestamp` was recorded as missing rather
     than a typed invalid-authority denial.
6. `pnpm vitest run tests/unit/policy-engine/package-boundary.test.ts`
   - Exit code: `1`; `1 failed`.
   - Domain/policy package builds had no build scripts or public entrypoints;
     after their initial addition, the direct build exposed TS6059 errors from
     source-path aliases crossing `rootDir`.
7. `pnpm vitest run tests/unit/policy-engine/evaluate.test.ts`
   - Exit code: `1`; `1 failed | 23 passed`.
   - A parseable but non-canonical evidence expiry (`2026-08-11`) incorrectly
     allowed execution.
8. `pnpm vitest run tests/unit/domain/action-passport.test.ts`
   - Exit code: `1`; `1 failed | 38 passed`.
   - The persisted `RiskSchema` rejected the required uncapped score of `105`.

## GREEN evidence

- Removed the risk-score cap. `riskScore` is now the deterministic sum of all
  typed reason scores; the aggregate regression asserts both `105` and
  `riskScore === sum(reasons)`.
- Added `invalid_clock`, `invalid_actor_metadata`,
  `invalid_delegated_authority`, and `non_expiring_delegated_authority` deny
  factors. Valid clocks require a finite `Date`; actor metadata requires a
  passport-matching 64-hex public key, nonempty known roles, and
  `recognized === true` before it can be allowed.
- Added `requireDelegatedAuthorityExpiry` to `WorkspacePolicy`; valid ISO UTC
  expiries are required whenever that policy flag is true. Evidence and
  delegated-authority timestamps use the exported domain ISO timestamp helper.
- Added public `@proofline/domain` and `@proofline/policy-engine` entrypoints,
  declaration builds, and a package-boundary test that builds canonical,
  domain, and policy then imports both public APIs by package name.
- Removed the persisted risk-score maximum so an evaluated policy decision can
  be represented by `ActionPassportV1`.

Focused verification after the final green/refactor cycle:

`pnpm vitest run tests/unit/domain/action-passport.test.ts tests/unit/policy-engine/evaluate.test.ts tests/security/policy-bypass.test.ts tests/unit/policy-engine/package-boundary.test.ts`

- Exit code: `0`; `65 passed` tests in `4 passed` files.

## REFACTOR evidence

Formatted modified package, configuration, and test files with Prettier and
reran focused tests. The package-boundary integration test was given an explicit
15-second timeout after the three real TypeScript builds exceeded Vitest's
default five-second unit-test timeout; its assertions and production behavior
were unchanged.

`pnpm vitest run tests/unit/policy-engine/evaluate.test.ts tests/security/policy-bypass.test.ts tests/unit/policy-engine/package-boundary.test.ts`

- Exit code: `0`; `26 passed` tests in `3 passed` files.

## Final verification

All commands completed with exit code `0` after the final code change:

- `pnpm format:check` — all matched files use Prettier style.
- `pnpm typecheck` — passed.
- `pnpm lint` — passed.
- `pnpm test` — `90 passed` tests in `8 passed` files.
- `pnpm build` — canonical, domain, and policy-engine each emitted their
  package builds successfully.

## Changed files

- `packages/domain/package.json`
- `packages/domain/src/index.ts`
- `packages/domain/src/policy.ts`
- `packages/domain/tsconfig.build.json`
- `packages/policy-engine/package.json`
- `packages/policy-engine/src/evaluate.ts`
- `packages/policy-engine/src/index.ts`
- `packages/policy-engine/src/risk.ts`
- `packages/policy-engine/src/rules.ts`
- `packages/policy-engine/tsconfig.build.json`
- `tests/unit/domain/action-passport.test.ts`
- `tests/unit/policy-engine/evaluate.test.ts`
- `tests/unit/policy-engine/package-boundary.test.ts`
- `tsconfig.base.json`
- `vitest.config.ts`

## Concerns

- The policy engine is pure and validates the supplied actor context, but the
  caller remains responsible for constructing that context from authenticated,
  server-authoritative identity and delegation records rather than browser
  input.
