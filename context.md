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

Start Task 9 proposer/verifier agent implementation. Keep Tasks 7–8 stable
unless a regression is proven; do not claim overall production readiness until
Tasks 9–18 are complete and reviewed.

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

## Task 8 fix round 5 status (2026-08-11)

The final reviewer findings are addressed: approval RPC serialization is a strict 13-field allowlist; credentialed database verification fails loudly when the v2/0015 lifecycle contract is absent; rejection audit IDs include canonical command hash/result with collision detection; and approve/create Edge files are formatted.

Evidence: RED recorded 4 failures / 27 tests; focused GREEN passed 3 files / 27 tests; bounded full Vitest passed 24 files / 256 tests with 1 skip; both builds, typecheck, lint, Prettier, diff check, and the credential-gated db-verifier skip passed. No live database credentials were available. Do not begin Task 9.

## Task 8 post-review remediation status (2026-08-11)

The two remaining review gaps are remediated without starting Task 9. Credentialed database verification now requires the migration-0016 rejection-audit contract before fixture work and executes exact-replay plus distinct-command conflict probes; only missing credentials can skip. Migration 0016 serializes rejection recording, accepts only an identical receipt/audit replay, stores command identity in audit metadata, and raises deterministic idempotency/collision errors instead of silently suppressing conflicts.

Strict RED covered stale credentialed verification, an executable probe that accepted a distinct command identity, and the remaining silent SQL conflict clauses. Final focused verification passed 3 files / 24 tests; typecheck exited 0. No live database probe was run, so migration 0016 deployment is not claimed. Do not begin Task 9.

Takeover verification re-inspected the remediation contract on 2026-08-11. A
fresh bounded run passed the same 3 files / 24 tests; typecheck, changed-file
Prettier, and `git diff --check` passed. No live database probe ran because no
credentials were available. Do not begin Task 9.

## Task 8 final blocker remediation status (2026-08-11)

The final review blocker is addressed without starting Task 9. Forward-only
migration `0017_task_8_rejection_audit_identity_hardening.sql` replaces only
the rejection recorder and treats an existing deterministic audit UUID as an
exact replay only when every deterministic field owned by the recorder is
identical. This includes `aggregate_type`, normalized actor identity,
event/aggregate identity, null before/after hashes, the complete metadata JSON,
and correlation/causation IDs; `occurred_at` is intentionally excluded.

Strict RED produced 4 expected failures / 22 tests for the missing migration,
complete-identity comparison, executable pre-existing poison-row probe, and
verifier migration list. Focused GREEN passed 3 files / 25 tests. The bounded
full suite passed 24 files / 259 tests with 1 existing credential-gated skip;
typecheck, workspace build, lint, repository-wide Prettier, and `git diff
--check` exited 0. `pnpm db:verify` exited 0 with the expected missing-
`SUPABASE_DB_URL` skip, so migration deployment is not claimed. This runtime
exposed no independent subagent dispatch control; a scoped controller diff and
mutation review found no additional issue. Do not begin Task 9.

## Task 9 status (2026-08-11)

Task 9 is implemented and ready for independent review. `packages/agents`
contains distinct deterministic proposer and verifier responsibilities: proposal
construction is hash-bound and evidence-backed, while verification independently
rejects schema/hash/evidence/policy/scope defects and returns only
`approve`/`reject`/`request_changes`. Neither agent has execution, approval,
lifecycle mutation, or direct persistence capability. Optional providers are
typed, retry/timeout bounded, non-authoritative, and have deterministic fallback.
The authenticated verifier boundary captures feedback through an injected
append-only contract only. Fresh bounded verification passed 4 focused files /
14 tests, typecheck, agents package build, scoped Prettier, and diff check. No
live provider, credentials, Buzz, tool, database action, migration, or Task 10+
work was used.

The lockfile change is limited to the three new workspace links required by
`@proofline/agents`; unrelated lockfile formatting was not rewritten.

## Task 9 fix round 1 status (2026-08-11)

The final review findings are addressed. The concrete `run-verifier` default
entrypoint now authenticates and authorizes against Supabase, loads and validates
the server passport/revision, binds verification input to that passport, and
captures feedback through an append-only audit adapter with request-byte
idempotency and duplicate replay protection. The verifier rejects empty claims,
empty evidence, omitted/unbound facts, and missing citations. Optional provider
calls receive `AbortSignal` and settle cancellation before retry. Proposer
ordering is locale-independent by codepoint. No lifecycle mutation or paid
provider was introduced.

Fix-round bounded verification: focused agent/security tests passed 4 files / 21
tests; `pnpm typecheck` passed; `pnpm --filter @proofline/agents run build`
passed; and repository-wide `pnpm format:check` passed after formatting the
reported Task 9 files and lockfile. Task 10 was not started.

## Task 9 fix round 2 status (2026-08-11)

The verifier boundary now accepts only its four public identifiers and resolves
the server action ID to the internal passport-row UUID. It verifies that the
row, action, workspace, latest revision, and canonical hash agree before
calling the verifier. Feedback replay, lookup, deterministic audit identity,
and persisted metadata are scoped by workspace, row UUID, action ID, actor,
request, and idempotency key. Evidence facts now carry a claim ID and must bind
exactly to both trusted facts and each cited claim/evidence pair. An optional
provider timeout returns the deterministic fallback immediately after aborting,
even when the provider never settles.

Strict RED exposed three failures: feedback lookup used the public action ID,
row/revision mismatch was accepted, and a same-valued fact could cover two
claims. Focused GREEN passed 3 files / 23 tests. Typecheck, the agents build,
scoped Prettier, and diff checks passed. No lifecycle mutation, migration, live
provider, credentials, Buzz, database action, or Task 10+ work was used.

## Task 9 fix round 3 status (2026-08-11)

The `run-verifier` boundary now validates each loaded revision payload with the
existing `ActionPassportV1` domain validator, recomputes its canonical
`computePassportHash`, and requires that hash to match both the latest revision
hash and parent passport-row hash. Only the validated passport is bound into
verification. The Supabase loader no longer derives trusted evidence facts from
raw revision JSON. Feedback replay and audit UUIDs now use a canonical
structured hash over workspace, passport row, canonical action, actor, request,
and idempotency identity, so delimiter-containing client IDs cannot alias.

Strict RED produced 4 expected failures / 11 tests for malformed arbitrary-hash
payloads, valid-shaped tampering, replay-key delimiter collision, and audit-ID
delimiter collision. Focused GREEN passed 3 files / 27 tests. A first bounded
full run reproduced the known 5-second canonical/worker package-build timing
flake; both probes passed alone, and two subsequent one-worker full runs each
passed 28 files / 290 tests with 1 credential-gated skip. Typecheck, workspace
build, lint, and repository-wide formatting passed. No migration, lifecycle
mutation, live provider, credentials, Buzz publication, database mutation,
execution/UI work, or Task 10+ work was used.

## Task 9 fix round 3 takeover verification (2026-08-11)

A fresh bounded Task 9 verifier run passed 3 files / 27 tests with one worker.
`pnpm typecheck`, `pnpm --filter @proofline/agents run build`, repository-wide
`pnpm format:check`, and `git diff --check` each exited 0. No unbounded full
suite, migration, lifecycle mutation, live provider, credentials, Buzz
publication, database action, execution/UI work, or Task 10+ work was run.

## Task 9 final blocker remediation (2026-08-11)

Evidence-fact and claim/evidence identities in the deterministic verifier now
use the existing canonical structured SHA-256 boundary instead of NUL-delimited
strings. Distinct subject/value tuples therefore remain distinct even when an
untrusted field contains NUL. The adversarial RED test reproduced the defect as
an incorrect `approve`; focused GREEN passed 3 Task 9 verifier files / 28 tests.
Fresh typecheck, workspace build, and repository-wide formatting also passed.
Task 10 was not started.

## Task 9 production-boundary remediation (2026-08-11)

The `run-verifier` entrypoint now binds `proposal` and a server-generated `now`
into verifier input. Its Supabase loader resolves the action's agent, tool
definition, policy, evidence facts, and latest signature-verified Buzz proposal
provenance; incomplete or malformed server context fails closed before verifier
execution. Full bounded verification passed 28 files / 291 tests / 1
credential-gated skip; typecheck, agent build, format, and diff checks passed.
The loader requires structured tool/policy metadata and a JSON ProposalResult
message inside a recorded Buzz proposal event; human-readable or absent
proposals are intentionally rejected. Task 10 remains next.
