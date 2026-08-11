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

Task 7 fix round 2 implementation is complete pending the next independent review. Base implementation commits were `699b295`, `b86879c`; fix round 1 commit was `71a59a6`.

Task 7 review findings that must be fixed before Task 8:

1. No complete proposal provenance writer path: publishing returns a relay ref but does not persist the proposal row, while approval RPC requires it.
2. Approval RPC can transition a caller-supplied passport different from the passport bound to proposal provenance. (Addressed in fix round 2.)
3. `request_changes` is accepted by parser but not applied by SQL transition contract. (Addressed in fix round 2.)
4. NIP-42 transport sends `EVENT` before challenge/auth and does not retry after auth; publication has no timeout. Tests do not cover required-auth rejection/retry. (Addressed in fix round 2 with bounded retry behavior.)

Earlier findings already addressed in `71a59a6` but must not regress: DB-backed dedupe/atomic guarded transition, reviewer identity and self-approval checks, raw-event hash/signature binding, clean package-boundary build.

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
- `.superpowers/sdd/2026-08-09-proofline-implementation/progress.md`: execution ledger.
- `.superpowers/sdd/2026-08-09-proofline-implementation/task-7-report.md`: Task 7 evidence report.
- `docs/superpowers/plans/2026-08-09-proofline-implementation.md`: master plan.

## Next exact action

Obtain a fresh scoped review for Task 7 fix round 2. Do not begin Task 8 until that review approves the proposal writer path, stored-passport binding, request_changes transition, and NIP-42 retry/timeout behavior.

## Do not do

- Do not begin Tasks 8–18 until Task 7 review is approved.
- Do not fake Buzz agents, NIP-42 auth, or Supabase live probes.
- Do not expose, rotate, or deploy using secrets found in chat.
- Do not rewrite migration history or use destructive git commands.
