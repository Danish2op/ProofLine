# Task 6 Report: Authentication, Workspace Roles, and Server Authorization

## Scope

Implemented only Task 6 from `docs/superpowers/plans/2026-08-09-proofline-implementation.md`.

Implementation commit: `3d3a5425df993577c09f56dd3b697d38d9751d44` (`feat: add workspace authorization`)

## RED

Added the Task 6 unit and integration specifications before the implementation:

- `tests/unit/authz/permissions.test.ts` defines the owner/admin/proposer/verifier/reviewer/auditor matrix for proposal, verification, approval, revocation, execution, audit export, member management, and policy updates.
- `tests/integration/authz/server-route.test.ts` defines expired-session refresh/failure, CSRF rejection, role downgrade during approval, self-approval prohibition, cross-tenant rejection, isolated demo reads, and public-only Supabase configuration.

Command:

```text
pnpm test tests/unit/authz/permissions.test.ts tests/integration/authz/server-route.test.ts
```

Result: failed as expected because the new Task 6 modules did not yet exist (`Cannot find module .../packages/authz/src/permissions.js` and `.../apps/web/middleware.js`).

## GREEN

Added the minimal implementation required by those specifications:

- `@proofline/authz` role definitions, membership conversion, and the single `can(actor, permission, resource)` application permission entry point.
- Server-injected Supabase session resolver that refreshes expired sessions and never includes a service-role key in browser configuration.
- Secure, HttpOnly, `SameSite=Lax` auth-cookie options and Origin plus double-submit-token CSRF validation for unsafe browser methods.
- Per-request server membership lookup with active-status, tenant/user identity, role, permission, and self-approval checks.
- A separate `/demo` GET/HEAD-only public boundary that does not authorize workspace routes or mutations.

Focused command:

```text
pnpm test tests/unit/authz/permissions.test.ts tests/integration/authz/server-route.test.ts
```

Result: passed — 2 files, 37 tests.

## REFACTOR

- Added the authz package export/build wiring and its workspace dependency from the web package.
- Normalized TypeScript package aliases and Vitest resolution for the new boundary.
- Formatted all changed code and lockfile with Prettier.
- Corrected two test-only typing issues found by the first typecheck run; no authorization behavior changed.

## Verification

| Command | Result |
| --- | --- |
| `pnpm test tests/unit/authz/permissions.test.ts tests/integration/authz/server-route.test.ts` | Passed: 37 tests |
| `pnpm typecheck` | Passed |
| `pnpm lint` | Passed |
| `pnpm format:check` | Passed |
| `pnpm --filter @proofline/authz run build` | Passed |
| `pnpm test` | Passed: 13 files, 150 tests |
| `pnpm build` | Passed: all package builds |
| `git diff --check` | Passed: no whitespace errors |

## Changed Files

- `packages/authz/src/roles.ts`
- `packages/authz/src/permissions.ts`
- `packages/authz/src/workspace.ts`
- `packages/authz/src/index.ts`
- `packages/authz/tsconfig.build.json`
- `packages/authz/package.json`
- `apps/web/lib/auth.ts`
- `apps/web/lib/server-authz.ts`
- `apps/web/middleware.ts`
- `apps/web/package.json`
- `tests/unit/authz/permissions.test.ts`
- `tests/integration/authz/server-route.test.ts`
- `tsconfig.base.json`
- `vitest.config.ts`
- `pnpm-lock.yaml`

## Concerns / Follow-up Boundaries

- The web application remains bootstrap-level. `SupabaseSessionClient` and `WorkspaceMembershipStore` are deliberately injected server adapters; a later route implementation must bind them to the Supabase server client and database/RLS queries, never client-provided role data.
- Secure cookies require HTTPS in deployed environments. No credentials were requested or used.
- The public demo guard permits only `/demo` GET/HEAD requests. It is intentionally separate from workspace authorization and does not grant tenant access.

## Fix Round 1: Independent Review Findings

Fix commit: `69fe5ce977fb5d019c4c675709deea35bf85261b` (`fix: harden task 6 authz boundaries`)

### RED evidence

Each review finding was converted to a regression test before its production change.

| Finding | Exact command | Initial result |
| --- | --- | --- |
| Actual Next middleware boundary | `pnpm test tests/integration/authz/server-route.test.ts` | Failed: `Cannot find package 'next/server'`; no Next handler/dependency existed. |
| Server-derived approval context | `pnpm test tests/integration/authz/server-route.test.ts` | Failed 2 tests: old `server-authz` resolved an approval call without context and allowed it. |
| Supabase SSR cookie writer/refresh | `pnpm test tests/integration/authz/server-route.test.ts` | Failed 2 tests: `createSupabaseServerAuth` was not a function. |
| Secure cookie override resistance | `pnpm test tests/integration/authz/server-route.test.ts` | Failed 1 test after the first implementation: insecure callback options overrode secure defaults. |
| Approval-event RLS hardening | `pnpm test tests/integration/database/rls.test.ts` | Failed 1 test: migration 0007 was absent. |
| Built web/authz package boundary | `pnpm test tests/unit/authz/package-boundary.test.ts` | Failed: `@proofline/web` had no build script. |

### GREEN evidence

- Middleware: `pnpm test tests/integration/authz/server-route.test.ts` — 13 tests passed after the handler, matcher, server-derived approval context, and cookie adapter were implemented.
- RLS: `pnpm test tests/integration/database/rls.test.ts` — 10 tests passed after migration 0007 revoked authenticated approval inserts and dropped the reviewer insert policy.
- Package boundary: `pnpm test tests/unit/authz/package-boundary.test.ts` — 1 test passed; web compiled against `packages/authz/dist` and imported `can` through the built package export.
- Combined focused verification: `pnpm test tests/unit/authz/permissions.test.ts tests/unit/authz/package-boundary.test.ts tests/integration/authz/server-route.test.ts tests/integration/database/rls.test.ts` — 4 files, 78 tests passed.

### REFACTOR evidence

- `apps/web/middleware.ts` now exports a real `NextResponse` middleware handler and `config.matcher = ['/demo/:path*']`; it performs no Supabase or tenant-data access and returns 405 for demo writes.
- `server-authz.ts` accepts only an action identifier for approval authorization. It loads proposer ownership and self-approval policy from `ApprovalContextStore`; missing or malformed context fails closed with `authorization_context_missing`.
- `auth.ts` now wraps `@supabase/ssr` `createServerClient`, persists `setAll` refresh cookies on the returned `NextResponse`, enforces secure HttpOnly SameSite-Lax options, and maps refreshed sessions into the server auth shape. Service-role configuration is not part of the public config contract.
- `supabase/migrations/0007_task_6_authz_hardening.sql` makes approval-event inserts service-role-only; the server authorization boundary remains responsible for user, workspace, action ownership, and policy checks before a server write.
- Added `apps/web` build/typecheck scripts and `apps/web/tsconfig.build.json` with the authz path resolved to `packages/authz/dist/index.d.ts`.
- Added the complete 6-role × 8-permission matrix plus unauthenticated, suspended, removed, cross-tenant, role-downgrade, omitted-context, self-approval, and forged-actor RLS regressions.
- Pinned Next to 15.5.23 after the initial 15.5.0 install was flagged by pnpm as vulnerable; approved only the required `sharp` build in `pnpm-workspace.yaml`.

### Fix-round verification

| Exact command | Result |
| --- | --- |
| `pnpm test` | Passed: 14 files, 182 tests |
| `pnpm build` | Passed: authz, canonical, web, domain, and policy-engine builds |
| `pnpm typecheck` | Passed |
| `pnpm --filter @proofline/web run typecheck` | Passed |
| `pnpm --filter @proofline/authz run build` | Passed |
| `pnpm lint` | Passed |
| `pnpm format:check` | Passed |
| `git diff --check` | Passed |
| `pnpm db:verify` | Safely skipped: `SUPABASE_DB_URL` was not set; no credentials were requested or used. |

The final fix-round worktree was clean after the implementation commit; the report update is committed separately so this file can record the exact implementation hash.
