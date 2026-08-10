# Task 5 Report: Supabase Schema, RLS, and Audit Model

## Commit

- `52db2ab feat: add tenant database and audit schema`

## RED

Added deterministic database-contract tests before creating any Task 5 schema or persistence implementation:

- `tests/integration/database/constraints.test.ts`
- `tests/integration/database/rls.test.ts`
- `tests/integration/database/migration-test-helpers.ts`

Command:

```text
pnpm vitest run tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts
```

Result: exit 1, 2 failed test files, 13 failed tests. Every failure was expected: the tests reported missing `supabase/migrations/*`, `supabase/seed.sql`, and `packages/domain/src/persistence-types.ts`, rather than a test setup error.

## GREEN

Implemented the Task 5 migration/configuration/type artifacts, then ran:

```text
pnpm vitest run tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts
```

Result: exit 0, 2 passed test files, 13 passed tests.

The migrations provide:

- Normalized UUID/timestamptz tables for all required aggregates, workspace-scoped foreign keys, restrictive deletes, and explicit demo-run cleanup cascade.
- Database constraints for lifecycle states, immutable passport fields, valid transitions, approval expiry, hashes, JSON object payloads, idempotency, and action uniqueness.
- Tenant RLS with `auth.uid()` membership checks, forced RLS, no anonymous table privileges, role-scoped human inserts, and explicit `service_role` worker policies.
- Append-only audit enforcement plus automatic action-passport audit events.
- Synthetic-only seeds using `example.invalid` identities and no credentials.

## REFACTOR

Extracted the repeated tenant-table fixture into `migration-test-helpers.ts` without changing coverage.

Commands:

```text
pnpm vitest run tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts
pnpm typecheck
```

Result: exit 0; focused suite passed 13/13 and TypeScript completed with no errors.

## Final Verification

Commands and results:

```text
pnpm format:check
```

Initial result: exit 1, reporting formatting only in `persistence-types.ts`, `constraints.test.ts`, and `rls.test.ts`.

```text
pnpm exec prettier --write packages/domain/src/persistence-types.ts tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts
pnpm format:check
pnpm lint
pnpm test
pnpm build
pnpm typecheck
git diff --check
git diff --cached --check
```

Final results: all exit 0. `pnpm test` passed 10 test files / 103 tests. Build completed for `packages/canonical`, `packages/domain`, and `packages/policy-engine`. Both diff hygiene checks were clean before commit.

## Changed Files

- `packages/domain/src/index.ts`
- `packages/domain/src/persistence-types.ts`
- `supabase/config.toml`
- `supabase/migrations/0001_initial_schema.sql`
- `supabase/migrations/0002_rls_policies.sql`
- `supabase/migrations/0003_indexes_constraints.sql`
- `supabase/seed.sql`
- `tests/integration/database/constraints.test.ts`
- `tests/integration/database/migration-test-helpers.ts`
- `tests/integration/database/rls.test.ts`

## Concerns / Limitation

No local PostgreSQL runtime was available: `psql`, `postgres`, `pg_isready`, `supabase`, Docker, Podman, and in-repository `pg`/`pg-mem` packages were all unavailable. Consequently, live Supabase RLS cross-tenant read/update/inference probes and migration application were not run. The focused tests are deterministic static validation of the deployable SQL contract; a follow-up environment with Supabase CLI plus Docker or PostgreSQL must apply the migrations and execute live RLS probes before deployment.

---

## Fix Round 1: Lifecycle, Grants, and Live Verification Harness

### Commit

- `31915da fix: harden action passport database guards`

### Review Findings Addressed

1. **P0 lifecycle insert bypass:** Added forward-only migration `0004_task_5_hardening.sql`. It replaces the update-only action passport guard with a `BEFORE INSERT OR UPDATE` trigger. Inserts must start in `DRAFT` and may not carry approval timestamps; updates still enforce immutable fields, allowed transitions, and unexpired approval state.
2. **P1 explicit Data API grants:** The migration revokes tenant-table privileges from `anon` and `authenticated`, then grants only authenticated reads plus the three intended authenticated inserts. It grants worker CRUD only to `service_role`, and explicitly grants the RLS helper functions needed at runtime. This follows Supabase's documented two-layer model: grants control whether Data API roles can reach an object and RLS controls which rows they may reach. Source: https://supabase.com/docs/guides/api/securing-your-api
3. **P1 live verification:** Added `pnpm db:verify`, backed by `scripts/verify-supabase-db.ts` and the `pg` development dependency. It uses a transaction and synthetic `example.invalid` data, probes cross-tenant invisibility and denied mutation, verifies rejected `APPROVED`/`EXECUTING`/`SUCCEEDED` direct inserts, and verifies an allowed `DRAFT` insert. It rolls all probe data back.

### RED

Added regression tests before creating migration `0004` or the verifier:

- `tests/integration/database/constraints.test.ts`
- `tests/integration/database/rls.test.ts`
- `tests/integration/database/live-harness.test.ts`

Command:

```text
pnpm vitest run tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts tests/integration/database/live-harness.test.ts
```

Result: exit 1, 3 failed files, 6 failed / 17 total tests. Expected failures were missing `0004_task_5_hardening.sql`, no guarded insert trigger, no explicit grants, and no verification script. No test setup failure occurred.

### GREEN

Commands:

```text
pnpm vitest run tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts tests/integration/database/live-harness.test.ts
pnpm db:verify
```

Result: exit 0; focused suite passed 17/17. `pnpm db:verify` printed:

```text
SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.
```

The skip is intentional and is not a runtime verification claim.

### REFACTOR and Final Verification

Applied Prettier to the verifier, tests, and lockfile, then ran:

```text
pnpm format:check
pnpm lint
pnpm test
pnpm build
pnpm typecheck
pnpm db:verify
git diff --check
git diff --cached --check
```

Results: every command exited 0. Full tests passed 11 files / 107 tests. Build completed for `packages/canonical`, `packages/domain`, and `packages/policy-engine`. The live verifier skipped because no database URL was available. Formatting was initially required only for `pnpm-lock.yaml`, `scripts/verify-supabase-db.ts`, and the updated database tests; it was applied before the final checks.

### Changed Files (Fix Round 1)

- `package.json`
- `pnpm-lock.yaml`
- `scripts/verify-supabase-db.ts`
- `supabase/migrations/0004_task_5_hardening.sql`
- `tests/integration/database/constraints.test.ts`
- `tests/integration/database/live-harness.test.ts`
- `tests/integration/database/migration-test-helpers.ts`
- `tests/integration/database/rls.test.ts`

### Live Verification Command and Remaining Limitation

Run only against a disposable Supabase project database. No URL or credentials are committed.

```text
SUPABASE_DB_URL="postgresql://…" pnpm db:verify --apply
```

`--apply` is for a fresh disposable database and applies all Proofline migrations before the transaction-scoped probes. For a database where migrations are already applied:

```text
SUPABASE_DB_URL="postgresql://…" pnpm db:verify
```

Fresh runtime detection in this fix round found no `psql`, `postgres`, `pg_isready`, Supabase CLI, Docker, Podman, or configured `SUPABASE_DB_URL`; therefore neither migrations nor live probes were run locally. The committed harness provides the required real verification path, but deployment remains blocked on executing it successfully against a disposable Supabase database.

---

## Fix Round 2: Execution Expiry, Safe Apply, Cleanup, and SECURITY DEFINER

### Commit

- `6e99a63 fix: harden database lifecycle and cleanup`

### Review Findings Addressed

1. **Execution expiry:** Migration `0005_task_5_review_hardening.sql` now evaluates approval expiry only while entering `APPROVED` or `EXECUTING`. `EXECUTING -> SUCCEEDED` and `EXECUTING -> FAILED` no longer depend on a still-unexpired approval, while expired approval still blocks execution start and `APPROVED -> REVOKED` remains a valid lifecycle transition.
2. **Safe `--apply`:** `pnpm db:verify --apply` refuses before opening a database connection unless `SUPABASE_DB_VERIFY_DISPOSABLE=I_UNDERSTAND` is supplied. Default `pnpm db:verify` remains non-mutating. The URL is never emitted by the script.
3. **Live harness:** On an explicitly disposable database, the verifier applies migrations only with the confirmation above and runs transaction-scoped synthetic probes for lifecycle expiry, tenant read isolation, denied cross-tenant mutation, guarded inserts, and populated demo cleanup. It always rolls its probe transaction back. This environment did not run those probes because no URL was supplied.
4. **Demo cleanup:** Added idempotent `public.cleanup_demo_run(uuid)`, executable only by `service_role`. It records an append-only cleanup audit event and deletes demo-run-owned descendants in foreign-key-safe order before deleting the passport and demo run. The existing cascade is therefore confined to demo-run-owned passport rows; production aggregate FKs remain restrictive.
5. **`SECURITY DEFINER`:** Replaced the membership and audit function definitions with `search_path = pg_catalog, pg_temp`, fully qualified `public` and `auth` references, and an explicit `public.digest` call. The new cleanup function uses the same trusted path.

### RED

Added regression expectations before creating migration `0005` or changing the verifier:

- expiry is enforced before execution, not completion;
- populated demo cleanup exists and is service-role-gated;
- membership/audit `SECURITY DEFINER` definitions use a trusted search path;
- unsafe `--apply` is refused before a connection is attempted.

Command:

```text
pnpm vitest run tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts tests/integration/database/live-harness.test.ts
```

Result: exit 1, 3 failed files, 5 failed / 21 total tests. Failures were the expected missing migration and absent `--apply` refusal; the unsafe invocation attempted localhost, which proved the pre-connect guard was missing.

### GREEN

Commands:

```text
pnpm vitest run tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts tests/integration/database/live-harness.test.ts
pnpm typecheck
pnpm db:verify
```

Result: all commands exited 0. Focused suite passed 21/21 and TypeScript passed. `pnpm db:verify` printed the truthful no-credential status:

```text
SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.
```

### REFACTOR and Final Verification

Applied Prettier to the changed verifier and tests, then ran:

```text
pnpm format:check
pnpm lint
pnpm test
pnpm build
pnpm typecheck
pnpm db:verify
git diff --check
git diff --cached --check
```

Results: every command exited 0. Full tests passed 11 files / 111 tests. Build completed for `packages/canonical`, `packages/domain`, and `packages/policy-engine`. The final verifier run skipped because there is still no `SUPABASE_DB_URL`; this is not live verification evidence.

### Changed Files (Fix Round 2)

- `scripts/verify-supabase-db.ts`
- `supabase/migrations/0005_task_5_review_hardening.sql`
- `tests/integration/database/constraints.test.ts`
- `tests/integration/database/live-harness.test.ts`
- `tests/integration/database/migration-test-helpers.ts`
- `tests/integration/database/rls.test.ts`

### Required Disposable Live Command

For a fresh, disposable Supabase database only:

```text
SUPABASE_DB_URL="postgresql://…" SUPABASE_DB_VERIFY_DISPOSABLE="I_UNDERSTAND" pnpm db:verify --apply
```

For an already-migrated disposable database, the confirmation is not needed because the default run does not apply migrations:

```text
SUPABASE_DB_URL="postgresql://…" pnpm db:verify
```

No credential was requested, stored, logged, or committed. The remaining required evidence is a successful run of the first command against a disposable database; absent that environment, the harness reports `SKIPPED` and the work does not claim a live result.

---

## Fix Round 3: Supabase pgcrypto Schema Compatibility

### Commit

- `934eb5f fix: support Supabase pgcrypto schema`

### Review Findings Addressed

1. **pgcrypto schema compatibility:** Removed the audit trigger's hardcoded `public.digest` dependency. `proofline_internal.sha256_json(jsonb)` is a `SECURITY DEFINER` helper with `search_path = pg_catalog, pg_temp`; it reads the installed `pgcrypto` extension schema from `pg_catalog.pg_extension`, explicitly checks that `digest(bytea,text)` exists there, and uses a quoted dynamic schema reference. This works whether the extension is installed under Supabase's `extensions` schema or a compatible alternative; it does not assume `CREATE EXTENSION IF NOT EXISTS` relocates an installed extension.
2. **Forward repair:** `0006_pgcrypto_compatibility.sql` creates/replaces the wrapper and audit function for databases that already applied `0005`. The amended `0005` gives fresh migration runs the same behavior before the audit function is created.
3. **Live evidence honesty:** `pnpm db:verify` now invokes the compatibility wrapper only when `SUPABASE_DB_URL` is present. It still emits only the credential-free `SKIPPED` status here; no URL, password, or live success claim is logged.

### RED

Added migration and harness regressions before the compatibility implementation:

- required `0006_pgcrypto_compatibility.sql`;
- required an internal wrapper instead of `public.digest`;
- required catalog-based extension discovery, trusted path, and audit-function replacement;
- retained an invocation test proving a refused apply does not print a supplied database URL.

Command:

```text
pnpm vitest run tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts tests/integration/database/live-harness.test.ts
```

Initial result: exit 1, 2 failed files, 3 failed / 23 total tests. The failures were the expected missing `0006` migration and missing wrapper reference in `0005`.

Added the final explicit `digest(bytea,text)` capability expectation, then repeated the same command. Result: exit 1, 1 failed / 23 total tests, because the wrapper had not yet performed `to_regprocedure` validation. This was the expected second RED state.

### GREEN

Commands:

```text
pnpm vitest run tests/integration/database/constraints.test.ts tests/integration/database/rls.test.ts tests/integration/database/live-harness.test.ts
pnpm typecheck
pnpm db:verify
```

Result: all exit 0. Focused suite passed 23/23 and TypeScript passed. The verifier output was:

```text
SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.
```

No runtime database verification occurred.

### REFACTOR and Final Verification

Applied Prettier to the updated verifier and tests, then ran:

```text
pnpm format:check
pnpm lint
pnpm test
pnpm build
pnpm typecheck
pnpm db:verify
git diff --check
git diff --cached --check
```

Results: every command exited 0. Full tests passed 11 files / 113 tests. Build completed for `packages/canonical`, `packages/domain`, and `packages/policy-engine`. The verifier again skipped due to the absent `SUPABASE_DB_URL` and did not log credentials.

### Changed Files (Fix Round 3)

- `scripts/verify-supabase-db.ts`
- `supabase/migrations/0005_task_5_review_hardening.sql`
- `supabase/migrations/0006_pgcrypto_compatibility.sql`
- `tests/integration/database/live-harness.test.ts`
- `tests/integration/database/migration-test-helpers.ts`
- `tests/integration/database/rls.test.ts`

### Pending Linked-Project Evidence

The exact disposable-database command remains:

```text
SUPABASE_DB_URL="postgresql://…" SUPABASE_DB_VERIFY_DISPOSABLE="I_UNDERSTAND" pnpm db:verify --apply
```

It will now validate the installed pgcrypto schema through `proofline_internal.sha256_json` before lifecycle/RLS/cleanup probes. No linked-project URL was supplied in this round, so this report intentionally does not claim that command has run.

---

## Linked Supabase CLI Live Evidence

**Date:** 2026-08-10

The linked Supabase project has migrations `0001` through `0006` applied. A rollback-scoped live SQL probe was run through:

```text
npx --yes supabase db query --linked
```

The command exited 0. The probe verified all of the following against the linked project:

- `proofline_internal.sha256_json` returned a 64-character SHA-256 hash.
- An authenticated synthetic workspace A user could not see workspace B action rows.
- A cross-workspace update changed 0 rows.
- A direct `APPROVED` action-passport insert was rejected by the database lifecycle guard.

The probe ended with `ROLLBACK`; no probe data persisted. This evidence contains no credentials or raw database/project URLs.

This was a Supabase CLI linked-project SQL probe, not `pnpm db:verify`. The `pg` connection harness remains unexecuted in this task record because no `SUPABASE_DB_URL` was supplied to it.
