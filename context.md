# Proofline Continuation Context

Last updated: 2026-08-11 (Asia/Calcutta)

## Mission

Build the Proofline MVP: a multi-workspace, auditable human/agent approval workflow whose Buzz channel is the human coordination surface. Agents propose bounded actions; a human reviews an evidence-backed passport in Buzz; only an approved, verified decision may execute.

## Repository and branch

- Remote: `https://github.com/Danish2op/ProofLine.git`
- Worktree: `D:\Projects\idea\.worktrees\proofline-mvp`
- Branch: `feat/proofline-mvp`
- Base workspace: `D:\Projects\idea`
- Never work directly in the base workspace when changing implementation files.

## Required process

- Use strict TDD: write/adjust a failing test, run RED, implement, run focused GREEN, then full relevant verification.
- Use one implementation subagent for a scoped task; never run competing writers against the same files.
- Independently review every task before marking it complete.
- Reviewer fix rounds: rounds 1–3 resume the same implementer; rounds 4–5 use a fresh stronger implementer. Maximum five rounds.
- Do not claim completion without command output/evidence.
- Keep this file and `decisions.md` current after every task/fix round.

## Current implementation status

Completed and reviewed:

1. Foundation/bootstrap.
2. Buzz event/protocol primitives and live unauthenticated relay probe.
3. Canonical domain model and hashing/redaction.
4. Policy engine.
5. Supabase schema/RLS/audit; migrations through `0007` applied to linked project.
6. Auth/authz and middleware; final scoped review approved.

Task 7 post-review remediation is implemented and independently approved on
commit `0c9f1b1`.
Its fresh bounded verification on 2026-08-11 passed: the relay/probe Vitest
command reported 16 passed and 1 credential-gated relay skip; `pnpm typecheck`
exited 0. `pnpm db:verify` exited 0 with the expected missing-
`SUPABASE_DB_URL` skip, so it made no live connection. No full suite was run.
Base implementation commits were `699b295`, `b86879c`; prior fix commits are
`71a59a6`, `fab1b30`, `d59e5d2`, and `bc7573e`. The round 5 implementation is
the current scoped commit.

Task 7 review findings that were fixed before approval:

1. No complete proposal provenance writer path: publishing returns a relay ref but does not persist the proposal row, while approval RPC requires it.
2. Approval RPC can transition a caller-supplied passport different from the passport bound to proposal provenance. (Addressed in fix round 2.)
3. `request_changes` is accepted by parser but not applied by SQL transition contract. (Addressed in fix round 2.)
4. NIP-42 transport sent `EVENT` before challenge/auth and did not retry after auth; publication had no timeout. (Addressed in fix round 3 with an auth-probe state and safe unauthenticated fallback.)

5. Connection establishment can hang forever because the timeout starts after `connect()`. (Addressed in fix round 3.)
6. Proposal recording trusts a caller-provided passport ID instead of verifying it against signed `passportHash` and the stored passport hash. (Addressed in fix round 3 with migration 0011 and an executable mismatch probe.)

Earlier findings already addressed in `71a59a6` but must not regress: DB-backed dedupe/atomic guarded transition, reviewer identity and self-approval checks, raw-event hash/signature binding, clean package-boundary build.

7. Concurrent publications could escape the NIP-42 gate while AUTH signing
   was pending; a publication after `authEventId` existed could also be
   skipped by the flush. Addressed in fix round 4; independent review pending.
8. A delayed signer from a closed socket can still write AUTH through a newly
   reconnected socket or reject its queue; auth work must validate a connection
   generation/socket identity before mutating shared state. Addressed in fix
   round 5 with generation- and socket-scoped continuations; final review pending.
9. Duplicate publication calls using the same event ID overwrite the pending
   entry, allowing the first promise to remain pending after the second resolves.
   (Addressed in post-review remediation with in-flight promise reuse for
   equivalent envelopes and deterministic rejection for conflicting payloads.)
10. `scripts/verify-supabase-db.ts` is stale for migration 0011: it does not
    retain/use the second passport hash and omits `passportHash` from the second
    proposal, so the live request_changes probe would reject and then assert the
    wrong result. (Addressed in post-review remediation with a hash-bound second
    proposal and asserted proposal RPC result.)

## Credentials and external systems

- Supabase project ref: `tlaecrrimbpumhqmxltk`.
- Supabase URL and public key are user-provided; do not print secrets.
- User supplied a database password and an NSEC in prior chat. Treat both as compromised: never reuse, echo, commit, or place in these files. Rotate/discard them.
- Buzz demo relay: `wss://proofline-demo.communities.buzz.xyz`.
- Buzz channel ID: `27b824ac-02a5-4725-aa64-808cb55978ef`.
- No valid Buzz private key or live DB connection string is currently available in the environment. Credential-gated live tests must skip explicitly and report that fact.
- Do not ask the user to paste private keys into chat. If live authentication is required later, generate/store a disposable local secret through the terminal or use a secure deployment secret input.

## Important existing files

- `packages/domain`: canonical entities, action passports, lifecycle/policy contracts.
- `packages/buzz-adapter`: Task 7 protocol/client/parser/provenance implementation.
- `supabase/migrations/0001`–`0010`: forward-only migrations; do not edit old migrations, add a new migration.
- Fix round 3 adds forward-only migration `0011_task_7_signed_passport_binding.sql`.
- `.superpowers/sdd/2026-08-09-proofline-implementation/progress.md`: execution ledger.
- `.superpowers/sdd/2026-08-09-proofline-implementation/task-7-report.md`: Task 7 evidence report.
- `docs/superpowers/plans/2026-08-09-proofline-implementation.md`: master plan.

## Next exact action

Start Task 8 lifecycle/state-machine implementation. Keep Task 7 stable unless
a regression is proven; do not claim overall production readiness until Tasks
8–18 are complete and reviewed.

## Task 8 status (2026-08-11)

Task 8 is implemented in commit `49fc1f7` with a pure lifecycle engine,
serialized command boundary, forward-only migration `0012`, and Edge command
adapters. Focused lifecycle/database tests passed (33 tests), typecheck passed,
and the race suite passed five consecutive bounded runs. No post-change full
suite, build, lint, format, or live database migration probe was run at the
user's direction. Do not begin Task 9 in this task.

## Do not do

- Do not begin Tasks 8–18 until Task 7 review is approved.
- Do not fake Buzz agents, NIP-42 auth, or Supabase live probes.
- Do not expose, rotate, or deploy using secrets found in chat.
- Do not rewrite migration history or use destructive git commands.

## Task 8 fix round 1 status (2026-08-11)

The five reviewer findings are addressed: Edge handlers authenticate and authorize workspace membership/role before service-role mutation; approval uses the versioned Task 8 lifecycle RPC; migration 0013 binds hashes to the canonical server-side command payload and records deterministic rejection receipts/audits; the worker package has an explicit domain dependency/build boundary; and expired approvals are rejected before `APPROVED`.

Focused verification: 3 files and 21 tests passed; `pnpm typecheck` exited 0. No full suite, build, lint, format, or live database probe was run.

## Task 8 fix round 2 status (2026-08-11)

The five fix-round findings are addressed. The legacy Buzz processor now fails closed; approval requires a complete command contract and server-stored verified provenance bound to the exact workspace/action/proposal and active reviewer; create-action authenticates before service-role insertion; audit IDs are tenant/action scoped with collision detection; and `pnpm-lock.yaml` is formatted.

Evidence: RED recorded 5 failures / 21 tests; final bounded regression passed 5 files / 44 tests in 4.11s, `pnpm typecheck` exited 0, and the lockfile-only Prettier check exited 0. No full suite or live database probe was run.

## Task 8 fix round 3 status (2026-08-11)

Verified Buzz approval parsing now matches the actual Nostr event shape: kind 9 decision JSON is read from `content`, kind 7 reactions are supported, and malformed/wrong-shape approval observations fail closed. The Buzz adapter records observations only; application uses the versioned provenance-aware lifecycle RPC, while migration 0015 revokes the legacy service-role approval grant and stores verified approval timestamps.

Evidence: RED recorded 4 failures / 21 tests; final focused tests passed 6 files / 59 tests; Buzz adapter build and typecheck exited 0; scoped ESLint exited 0 with six configuration-ignore warnings; formatter-supported changed files passed Prettier. No full suite or live database probe was run.

## Task 8 fix round 4 status (2026-08-11)

The approval boundary now serializes exactly the v2 SQL contract, migration 0015 and the adapter use the last NIP-25 `e` tag, and the Supabase verification script covers migrations through 0015 without retired approval-RPC calls. Worker subprocess checks are explicitly bounded and deterministic.

Evidence: RED recorded 4 failures / 36 tests; focused GREEN passed 5 files / 36 tests; bounded full Vitest passed 24 files / 255 tests with 1 skip; both package builds, typecheck, lint, and formatter checks passed. `pnpm db:verify` exited 0 with the expected missing-credentials skip. Do not begin Task 9.
