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
