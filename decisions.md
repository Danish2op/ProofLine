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

## D-027 — Task 8 final boundary hardening

Decision: approve RPC serialization is a closed named-argument allowlist; credentialed verification treats the complete migration-0015/v2 contract as mandatory; rejection audit identity includes canonical command hash and result with explicit collision failure; and formatter/build/typecheck/lint checks are required before closing Task 8.

Reason: security boundaries must fail closed both at the HTTP-to-PostgREST serialization edge and at deployment verification, while rejection auditing must preserve distinct conflicts rather than silently suppressing them.

Validation: RED recorded 4 failures / 27 tests. Focused GREEN passed 3 files / 27 tests; bounded full Vitest passed 24 files / 256 tests with 1 skip; both builds, typecheck, lint, Prettier, diff check, and credential-gated db-verifier skip passed. No live SQL execution was possible.

## D-028 — Task 8 rejection audit fail-closed remediation

Decision: a credentialed verifier must prove the migration-0016 rejection-audit definition before fixture work and execute exact-replay plus distinct-command conflict probes. Rejection recording is serialized by workspace/action and audit identity; an existing receipt or audit is accepted only when workspace, aggregate, command ID, command hash, and result are identical. Distinct identities raise `lifecycle rejection idempotency conflict` or `lifecycle rejection audit collision`; silent conflict suppression is forbidden.

Reason: listing a migration locally does not prove the connected database is current, and ignored uniqueness conflicts can erase evidence of a distinct rejected command.

Validation: strict RED covered stale credentialed verification, accepted distinct command identity, and both remaining `ON CONFLICT DO NOTHING` clauses. Final focused verification passed 3 files / 24 tests; typecheck exited 0. No live database credentials were used.

Takeover validation (2026-08-11): fresh focused verification again passed the
same 3 files / 24 tests. Typecheck, Prettier for changed formatter-supported
files, and `git diff --check` passed; no live database credentials were used.

## D-029 — Rejection audit replay requires complete row identity

Decision: add forward-only migration `0017` and accept an existing rejection
audit UUID only when every deterministic field written by
`record_lifecycle_rejection` matches: workspace, normalized actor type and ID,
event type, aggregate type and ID, null before/after hashes, exact metadata JSON,
and correlation/causation IDs. `occurred_at` is not replay identity because it
is generated only when the row is first inserted. Any difference raises the
deterministic `lifecycle rejection audit collision`; an exact replay remains a
no-op success.

Reason: migration `0016` checked selected metadata keys but omitted
`aggregate_type` and tolerated extra metadata keys, allowing a pre-existing
same-UUID row with a different intended audit identity to masquerade as replay.

Validation: RED produced 4 expected failures / 22 tests. Focused GREEN passed
3 files / 25 tests; bounded full Vitest passed 24 files / 259 tests with 1 skip;
typecheck, workspace build, lint, repository-wide Prettier, and diff checks
passed. The credential-gated database verifier skipped because
`SUPABASE_DB_URL` is absent; no migration deployment claim is made.

## D-022 — Task 8 approved

Decision: advance to Task 9 after independent approval of commit `e0acb7c`.

Reason: lifecycle state transitions, provenance binding, workspace authorization, worker boundaries, replay/idempotency, audit collision handling, and stale-database verification are covered by passing bounded evidence.

## D-030 — Deterministic agents are bounded reviewers, not authorities

Decision: Task 9 uses two separate deterministic agents. The proposer creates a canonical draft passport from structured evidence and server-supplied policy inputs; the verifier independently recalculates canonical hash and policy, then returns a review disposition. Neither agent has execution, approval, lifecycle mutation, or direct persistence capability. `approve` means only that the verifier found no technical objection; a human must still approve the exact passport hash through the existing Buzz/provenance/lifecycle boundary.

Reason: proposal synthesis and validation need independent responsibilities, and an AI/model-shaped output must never turn into self-authorization.

Validation: focused agent/security tests passed 4 files / 14 tests. They cover canonical deterministic replay, production permission requests, conflicting and stale evidence, missing citations, malformed proposals/provider output, unknown tools, target changes, prompt injection, provider failures, and feedback capture authorization. Typecheck, agents build, Prettier, and `git diff --check` passed. Optional providers are retry/timeout-bounded and fall back to deterministic results; no paid provider is required.

## D-031 — Task 9 verifier boundary is server-authoritative and replay-safe

Decision: the production verifier entrypoint must load the passport and latest
revision from Supabase after bearer authentication and active verifier-capable
workspace membership. It binds all security-sensitive verification fields to
that server record and records feedback only as an append-only audit event with
workspace, actor, request, idempotency, byte-fingerprint, and passport identity.
Exact duplicate requests replay their stored result without a second capture;
conflicting reuse fails closed. The boundary never calls a lifecycle transition.

Reason: an injectable-only handler could be wired around server authority, and
feedback without durable identity could be duplicated or attributed to the
wrong workspace/action.

Validation: fix-round RED found the unbound injectable-only path; GREEN passed
the concrete-entrypoint, server-binding, and duplicate-capture regressions.

## D-032 â€” Task 9 verifier identity is row- and claim-bound

Decision: treat the public action ID as a lookup key only. After loading, use
the server passport-row UUID for feedback replay, audit lookup, aggregate ID,
and deterministic event identity; retain the canonical action ID and workspace
as additional metadata. Refuse a verifier run unless the server row hash and
latest revision hash are identical. Evidence facts must include a claim ID and
must match the trusted server fact plus a cited claim/evidence pair; an optional
provider deadline returns fallback immediately after abort rather than awaiting
an uncooperative promise.

Reason: action IDs and passport-row IDs identify different database entities,
so conflating them prevents durable feedback lookup and weakens tenant/action
identity. Evidence values alone can collapse distinct claims, and an abort-only
timeout is not a deadline when a provider ignores cancellation.

Validation: strict RED produced three failures for row-ID lookup, mismatched
row/revision hashes, and same-valued facts covering two claims. Focused GREEN
passed 3 files / 23 tests; typecheck, agents build, scoped formatting, and diff
checks passed. No lifecycle transition, migration, live provider, credentials,
or Task 10+ work was used.

## D-033 — Task 9 revision trust and feedback identity are canonical

Decision: `run-verifier` accepts a loaded revision only after the existing
domain validator returns an `ActionPassportV1` and `computePassportHash` of that
validated value equals the stored latest-revision hash and parent passport-row
hash. The raw payload never supplies trusted evidence facts before validation.
Feedback replay and deterministic audit identity use a canonical structured hash
that preserves workspace, passport-row, canonical action, actor, request, and
idempotency fields instead of delimiter-concatenated text.

Reason: equality between two aliases of one stored hash does not authenticate a
payload, and delimiter concatenation is not injective for unrestricted client
strings. Canonical validation plus recomputation binds the payload bytes to both
database records; structured hashing keeps distinct identity tuples distinct.

Validation: strict RED produced 4 expected failures / 11 tests. Focused GREEN
passed 3 files / 27 tests; final bounded full Vitest passed 28 files / 290 tests
with 1 credential-gated skip. Typecheck, workspace build, lint, repository-wide
Prettier, and diff checks passed. No migration, lifecycle transition, execution,
UI, live provider, credentials, database mutation, or Task 10+ work was used.

Takeover validation (2026-08-11): the bounded three-file verifier regression
passed 27 tests with one worker. Typecheck, the `@proofline/agents` package
build, repository-wide Prettier, and the Git whitespace check each exited 0. No
unbounded full suite or Task 10+ work was run.

## D-034 — Task 9 evidence identity is canonical and NUL-safe

Decision: the verifier represents both complete evidence facts and
claim/evidence pairs with `hashCanonicalJson` over named structured fields.
NUL-delimited concatenation is forbidden for evidence identity because all
tuple fields are untrusted strings.

Reason: `(subject = "deployment-checks", value = "passed\u0000verified")` and
`(subject = "deployment-checks\u0000passed", value = "verified")` are distinct
tuples but produced the same delimiter-concatenated identity. That collision
allowed a proposed fact to match a different trusted fact.

Validation: strict RED returned `approve` for the colliding tuple. Focused
GREEN passed 3 Task 9 verifier files / 28 tests, including the adversarial
regression that now requires `unbound_evidence_fact`. Typecheck, workspace
build, and repository-wide Prettier passed. Task 10 was not started.

## D-035 — Server-owned verifier context is mandatory

Decision: the public verifier request contains only workspace/action/request
identifiers. The Edge Function reconstructs proposal, agent, tool metadata,
policy, evidence facts, and current time from authenticated server-owned
records, including the latest signature-verified Buzz proposal provenance.
Missing or malformed context fails closed before calling the verifier.

Reason: accepting client-supplied verifier context would create a confused
deputy and the previous production loader could invoke the verifier with
undefined required fields. Buzz proposal content is parsed only after its
server provenance row, passport hash binding, and proposal envelope are
checked; human-readable or absent proposal messages are rejected.

Validation: RED exposed the missing proposal/now binding; GREEN and the full
bounded suite passed 28 files / 291 tests / 1 credential-gated skip, plus
typecheck, agent build, formatting, and diff checks.

## D-036 — Offline replay is the first public surface

Decision: the initial web surface is a static, credential-free replay with an
explicit offline label. It demonstrates the state machine and drift invariant;
it does not imply that a live Buzz event, Supabase write, or external agent ran.

Reason: the product must remain demonstrable without paid APIs, live secrets,
or unreliable infrastructure. Live integrations can be added behind the same
server-owned boundaries after the replay has been independently validated.
