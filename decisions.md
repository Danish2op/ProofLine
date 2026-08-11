# Proofline Decision Log

Last updated: 2026-08-11 (Asia/Calcutta)

## D-001 — Worktree isolation

Decision: implement on branch `feat/proofline-mvp` in `D:\Projects\idea\.worktrees\proofline-mvp`.

Reason: preserve the user’s base workspace and make each reviewed task auditable.

## D-002 — Buzz is the human approval surface

Decision: Buzz is structurally required for proposal/approval coordination and provenance, while Proofline owns durable workflow state, authorization, execution, and audit.

Reason: the product must remain meaningful human–agent collaboration rather than a replaceable chat box.

## D-003 — Forward-only database migrations

Decision: add new Supabase migrations for fixes; never edit already-applied migrations.

Reason: the linked project has migrations through `0007`, and production migration history must remain reproducible.

## D-004 — Secrets are compromised

Decision: never reuse or echo the database password or NSEC previously pasted in chat; treat them as compromised and rotate/discard them.

Reason: deleting chat later is not a sufficient security guarantee.

## D-005 — No mandatory paid AI dependency

Decision: the MVP uses deterministic/sandbox agent execution and optional BYOK/provider adapters; no paid model API is required for the core demo.

Reason: the user requires a genuinely workable zero-mandatory-cost MVP.

## D-006 — Task 7 remains blocked by correctness, not credentials

Decision: do not advance to Task 8 until Task 7 passes independent review.

Reason: the current review found a missing proposal persistence path, passport substitution risk, request-changes regression, and incomplete NIP-42 retry/timeout semantics. Missing live credentials are a separately documented test limitation, not permission to ignore these code defects.

## D-007 — Approval binding is by stored proposal provenance

Decision: a Buzz approval must resolve to exactly one stored proposal provenance record and its bound action passport; the approval request must not choose an unrelated target passport.

Reason: prevents a valid approval from being replayed against another action in the same workspace.

## D-008 — NIP-42 behavior must be explicit

Decision: the transport must handle challenge/auth ordering, retry the event after successful auth when required, and fail with a bounded timeout.

Reason: a WebSocket that merely sends an EVENT before auth is not a production-grade authenticated relay integration.

## D-009 — Review evidence is part of the product

Decision: every task report records focused RED/GREEN commands, full verification, live probe status, and known limitations.

Reason: this project is intended to impress an engineering team through durable correctness, not only a visual demo.

## D-010 — Proposal provenance precedes approval processing

Decision: proposal publication requires a verified, durable provenance write
containing the workspace, action passport, channel, event, and proposer identity;
approval processing resolves its passport only from that stored proposal row.

Reason: a valid approval must not be redirected to another action passport, and
an approval without a stored proposal must fail closed.

## D-011 — Request changes is a terminal blocking decision

Decision: canonical `request_changes` is persisted in `approval_events` and
maps from `PENDING_APPROVAL` to `BLOCKED` in the guarded SQL transaction.

Reason: parser and persistence contracts must agree and must not silently drop a
reviewer decision.

## D-012 — Auth-gated Buzz publication

Decision: treat a relay as requiring authentication until it explicitly proves otherwise; queue the event while awaiting challenge/auth, retry after successful AUTH, and bound both connection and publication waits.

Reason: publishing before NIP-42 completes is not reliable for authenticated relays, and an unbounded socket is a production hang.

## D-013 — Signed passport hash is authoritative

Decision: proposal persistence must derive or verify the action passport relationship from the signed proposal `passportHash` and the stored passport hash; a caller-provided passport ID cannot override the signed binding.

Reason: prevents a valid signed proposal for passport A from being persisted as passport B.

## D-014 — Auth probing has a bounded unauthenticated fallback

Decision: a new publication waits briefly for a relay AUTH challenge; a
challenge gates the EVENT behind successful AUTH, while a relay that sends no
challenge receives the EVENT after the bounded probe window. Connection and
publication waits share explicit bounded failure behavior.

Reason: this supports relays that accept unauthenticated events without
publishing before authentication on relays that require NIP-42.

## D-015 — Single relay auth gate for concurrent publishes

Decision: relay transport owns one explicit per-connection authentication state/promise; every publication observes that state and queues behind it until AUTH succeeds or the bounded operation fails.

Reason: independent per-publish probes create a race where concurrent events bypass NIP-42 or are omitted from the auth flush.

Validation: fix round 4 added a delayed-signer concurrency regression that
holds a challenge open, publishes both before and after the AUTH frame exists,
and observes all events only after the successful AUTH `OK`. The focused suite
passed 37 tests with one explicitly credential-gated live test skipped.

## D-016 — Invalidate stale relay auth continuations

Decision: every async authentication operation captures its socket and connection generation; after close/reconnect, stale continuations may not send frames or mutate the current connection’s queue/state.

Reason: delayed signing on a dead connection must never authenticate or fail a newly connected socket.

Validation: fix round 5 added deterministic reconnect regressions for both a
resolved and rejected stale signer. Socket B receives no stale `AUTH`, its
publication remains pending until B's own auth probe completes, and it then
publishes successfully. The focused Task 7 suite passed 39 tests with one
explicitly credential-gated live relay test skipped.

## D-017 — Task 7 review stop

Decision: stop the Task 7 review loop after the fifth fix round; do not advance to runtime work while duplicate publication promises can hang or the live database probe contradicts migration 0011.

Reason: the remaining defects affect liveness and deployment evidence. Continuing without a new controlled repair/review would violate the TDD review protocol and create false production confidence.

## D-018 — Post-review remediation

Decision: resume Task 7 in a separately named remediation phase after the user requested continuation; preserve the prior five-round evidence and require a fresh RED/GREEN cycle plus independent review for only the two remaining defects.

Reason: the user wants the project completed, but the prior review ceiling and evidence must remain auditable rather than being overwritten.

## D-019 — In-flight relay publication idempotency

Decision: register a publication before connection work begins. While an event
ID is pending, an equivalent signed event (all signed envelope fields and
ordered tags equal) returns the exact same promise and emits one relay EVENT; a
same-ID event with any conflicting field rejects immediately as non-retryable
`relay_rejected` without disturbing the original publication. ACK, timeout,
connection failure, authentication failure, and close settle the shared promise.
After settlement the entry is removed, so this is in-flight idempotency rather
than a permanent publication cache.

Reason: one event ID must own one resolver/timer lifecycle; overwriting a map
entry made earlier callers unreachable and able to hang indefinitely.

Validation: on 2026-08-11, the bounded relay/probe command reported 2 passing
files and 16 passed tests with 1 explicitly credential-gated relay test skipped.
It covers equivalent-ID acknowledgement and timeout settlement plus immediate
conflict rejection without disturbing the original publication.

## D-020 — Migration-aware live Buzz probe

Decision: the migration 0011 probe retains each inserted passport hash, embeds
the second hash in the second proposal envelope, and asserts the result of the
second `record_verified_buzz_proposal` call before applying `request_changes`.

Reason: a live probe must fail at the first incorrect RPC outcome instead of
continuing with missing proposal provenance and asserting a stale transition.

Validation: the same bounded command exercised the executable probe helper's
hash-bound envelope and wrong-result assertion; `pnpm typecheck` exited 0.
`pnpm db:verify` exited 0 with the expected missing-`SUPABASE_DB_URL` skip, so
no live database claim is made.

## D-021 — Task 7 approved

Decision: advance to Task 8 after independent approval of commit `0c9f1b1`.

Reason: duplicate publication promises settle deterministically, the migration-0011 probe is corrected, and full regression evidence is green (216 passed, one explicit credential-gated skip).

## D-022 — Lifecycle commands use versioned, replay-safe transactions

Decision: Task 8 lifecycle changes use a pure state-machine contract in the
domain and a forward-only database command boundary with action versions,
command receipts, advisory plus row locking, and audit correlation/causation
identifiers. Equivalent command replay returns its stored result; a reused
command ID with a different payload fails closed.

Reason: state transitions must be monotonic and concurrency-safe without
silently retrying a rejected command or allowing a stale approval to resurrect
an action.

Validation: commit `49fc1f7`; focused lifecycle/database verification passed
33 tests, typecheck passed, and the race suite passed five consecutive bounded
runs. Live migration application was not attempted because no disposable
`SUPABASE_DB_URL` was configured.

## D-023 — Task 8 fix round 1 hardening

Decision: lifecycle Edge boundaries authenticate and authorize callers before service-role mutation; approval and revoke use the versioned Task 8 transition RPC; migration 0013 derives and validates command hashes from a canonical server-side payload and persists deterministic rejection receipts/audits; worker package boundaries are explicit; and approval expiry is enforced at the pure transition boundary.

Validation: focused lifecycle/edge/worker verification passed 3 files / 21 tests; `pnpm typecheck` exited 0. Full-suite and live database checks remain intentionally unrun.

## D-024 — Task 8 fix round 2 provenance boundary

Decision: the retired Buzz processor is fail-closed; approval is admitted only by a server-side provenance-aware lifecycle RPC that resolves the exact stored proposal/action/workspace binding and active reviewer identity; create-action uses the authenticated membership boundary; and audit identifiers are deterministically tenant/action scoped with explicit collision failure.

Reason: a valid Buzz event or service-role endpoint must never be reusable as authorization for another action or workspace, and audit uniqueness must not depend on silent conflict suppression.

Validation: RED recorded 5 failures / 21 tests. Final bounded regression passed 5 files / 44 tests; `pnpm typecheck` and `pnpm exec prettier --check pnpm-lock.yaml` exited 0. No live SQL execution was available or attempted.

## D-025 — Task 8 fix round 3 observation/application split

Decision: Buzz adapter provenance records verified approval observations only; the server parses the standard Nostr content shape and kind 7 reactions, stores the verified observation/timestamps, and only the authenticated/versioned provenance-aware lifecycle RPC may apply approval. Migration 0015 revokes the legacy Task 7 service-role approval mutation grant.

Reason: provenance recording and lifecycle mutation have different trust boundaries. A verified event must be durably observed without allowing the adapter to bypass Task 8 version checks, workspace/action binding, reviewer authorization, or lifecycle audit receipts.

Validation: RED recorded 4 failures / 21 tests. Final focused tests passed 6 files / 59 tests; Buzz adapter build and `pnpm typecheck` exited 0. Scoped ESLint had six configuration-ignore warnings; formatter-supported files passed Prettier; no live SQL execution was attempted.

## D-026 — Task 8 fix round 4 exact RPC and bounded verification

Decision: Edge approval serialization is an explicit allowlist for the v2 SQL signature; NIP-25 target resolution uses the final `e` tag; the executable database probe follows observation plus versioned lifecycle calls through migration 0015; and worker subprocess checks are timeout-bounded with spawn failures surfaced.

Reason: named RPC boundaries must not accidentally widen when internal command fields evolve, and live verification must exercise the same retired-RPC-free path as production while remaining safe without credentials.

Validation: RED recorded 4 failures / 36 tests. Focused GREEN passed 5 files / 36 tests; bounded full Vitest passed 24 files / 255 tests with 1 skip; Buzz adapter and worker builds, typecheck, lint, Prettier, `git diff --check`, and credential-gated `pnpm db:verify` skip all passed.
