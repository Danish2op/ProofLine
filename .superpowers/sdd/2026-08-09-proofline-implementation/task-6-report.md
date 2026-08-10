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
