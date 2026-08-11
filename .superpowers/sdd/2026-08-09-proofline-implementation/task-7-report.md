# Task 7 — Buzz Adapter and Event Provenance Layer

## Status

`DONE_WITH_CONCERNS`

The Buzz adapter now verifies standard Nostr envelopes with the computed event
hash and BIP-340 Schnorr signature, publishes only through an injected signer
and transport, and parses approvals only when the exact stored proposal proves
the requested workspace/channel and the signer is in the server-owned reviewer
key set. NIP-25 reactions with only an `e` tag are accepted; an `h` tag is
validated only when supplied. No display metadata is used for authority.

## Implementation

- Added `@proofline/buzz-adapter` public exports/build configuration and its
  `@noble/curves` runtime dependency.
- Added `event-codec.ts`, `client.ts`, `approval-parser.ts`, and
  `provenance.ts`.
- Added structured `proofline.passport.v1` message payloads; event/user
  references use standard `e` and `p` tags, and content is capped at 16,384
  UTF-8 bytes.
- Added forward-only migration `0008_task_7_buzz_provenance.sql`; `0001` was
  not changed. It adds service-role reviewer-key state, append-only event
  provenance, atomic duplicate recording, and a row-locking approval
  transition that only accepts `PENDING_APPROVAL`.
- Added package, codec, parser, provenance, relay, and migration coverage.

## RED / GREEN Evidence

Each implementation increment was driven by a focused test. Relevant commands
and observed outcomes:

| Cycle | RED command / output | GREEN command / output |
| --- | --- | --- |
| Signed event codec | `pnpm vitest run tests/unit/buzz-adapter/event-codec.test.ts` → `Cannot find module .../event-codec.js` | Same command → `1 passed (1)` |
| Content cap | Same command → expected `content_too_large`, received verified event | Same command → `2 passed (2)` |
| Approval parser | `pnpm vitest run tests/unit/buzz-adapter/approval-parser.test.ts` → `Cannot find module .../approval-parser.js` | Same command → `1 passed (1)` |
| Reject reaction | Same command → expected `decision: reject`, received `unrecognized_decision` | Same command → `2 passed (2)` |
| Wrong channel | Same command → expected `wrong_channel`, received `approve` | Same command → `3 passed (3)` |
| Unknown reviewer | Same command → expected `unknown_reviewer`, received `approve` | Same command → `4 passed (4)` |
| Relay client | `pnpm vitest run tests/integration/buzz-adapter/relay.test.ts` → `Cannot find module .../client.js` | Same command → `1 passed, 1 skipped (2)` |
| Approval reader | Same command → `client.readApprovalForProposal is not a function` | Same command → `2 passed, 1 skipped (3)` |
| Provenance replay | `pnpm vitest run tests/unit/buzz-adapter/provenance.test.ts` → `Cannot find module .../provenance.js` | Same command → `1 passed (1)` |
| Out-of-order decision | Same command → expected `recorded_unapplied`, received `applied/BLOCKED` | Same command → `3 passed (3)` |
| Package boundary | `pnpm vitest run tests/unit/buzz-adapter/package-boundary.test.ts` → build status `1` | Same command → `1 passed (1)` |
| Migration artifact | `pnpm vitest run tests/integration/database/constraints.test.ts` → expected migration file existed, received `false` | Same command → `11 passed (11)` |

The first codec fixture initially could not resolve `@noble/curves` from the
workspace-root test runner. I added it as a root dev dependency strictly for
the deterministic, public test fixture, reran, and obtained the intended
missing-code RED before creating the codec.

## Verification

Final commands and output:

```text
pnpm typecheck
$ tsc --noEmit

pnpm lint
$ eslint .

pnpm format:check
Checking formatting...
All matched files use Prettier code style!

pnpm build
Scope: 9 of 10 workspace projects
... packages/buzz-adapter build: Done

pnpm test
Test Files  19 passed (19)
Tests  198 passed | 1 skipped (199)

git diff --check
# exit 0

pnpm db:verify
SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.
```

Focused adapter verification also passed before the final suite:

```text
pnpm vitest run tests/unit/buzz-adapter tests/integration/buzz-adapter tests/integration/database/constraints.test.ts
Test Files  6 passed (6)
Tests  24 passed | 1 skipped (25)
```

## Files

- `packages/buzz-adapter/src/{approval-parser,client,event-codec,index,provenance}.ts`
- `packages/buzz-adapter/{package.json,tsconfig.build.json}`
- `supabase/migrations/0008_task_7_buzz_provenance.sql`
- `tests/unit/buzz-adapter/*` and `tests/integration/buzz-adapter/relay.test.ts`
- Package resolution/build configuration, migration verification lists, and lockfile.

## Self-review

- Confirmed NIP-25 accepts an `e`-only reaction and resolves channel/workspace
  from stored proposal provenance.
- Confirmed reviewer approval uses only the supplied server-owned key set; the
  migration gives reviewer identity state no authenticated access.
- Confirmed verified event hashes/signatures, malformed content, wrong
  channels, unknown reviewers, duplicate/replayed IDs, and out-of-order
  decisions fail closed or remain recorded-but-unapplied.
- Corrected an initially discovered second-transition gap: the generic domain
  graph permits `APPROVED → BLOCKED`, but Buzz processing now requires
  `PENDING_APPROVAL` in both TypeScript and SQL.
- Corrected provenance RLS to grant authenticated members read-only access only
  through its tenant policy, while retaining service-only writes.
- No private keys, relay credentials, or secrets were added. Test fixtures use
  only deterministic test keys.

## Live-test Status and Concerns

- `BUZZ_RELAY_URL` and `BUZZ_DEMO_CHANNEL` were both unset, so the live relay
  test was skipped. It did not sign, authenticate, publish, or claim success.
- `SUPABASE_DB_URL` was unset, so the live database/migration probe was also
  skipped. Migration `0008` is committed but was not applied from this task.
- Commit: `699b295b236b093557dd2ebddb56bcb4cf05e1f1` (`feat: add buzz provenance adapter`).

## Fix Round 1 (2026-08-10)

### Status

`DONE_WITH_CONCERNS`. The Task 7
adapter now has a concrete NIP-01 WebSocket transport, handles a NIP-42
`AUTH` challenge by signing and framing a kind `22242` event, and only reports
publish success after the relay sends a NIP-01 `OK` success frame. The live
test remains conditional and makes no authentication or publish claim when its
environment variables are absent.

The prior process-local replay set was removed. `DatabaseProvenanceWriter`
re-verifies the raw signed Nostr event and invokes exactly one server-only RPC.
Forward-only migration `0009_task_7_verified_buzz_approval.sql` records
provenance and applies the lifecycle transition in that same transaction.
The RPC derives identity, references, channel, and decision from raw event
data; it accepts neither a caller-supplied hash nor a caller-supplied
`signature_verified` state or decision. It validates an active row in the
server-owned reviewer identity set and rejects the proposal proposer.

### RED / GREEN evidence

| Defect | RED evidence | GREEN evidence |
| --- | --- | --- |
| Concrete relay/auth transport | `pnpm vitest run tests/integration/buzz-adapter/relay.test.ts` initially failed because `Nip01RelayTransport` was absent. | Same command: `4 passed, 1 skipped`; the deterministic socket test observes `AUTH` kind 22242 and waits for `OK`. |
| Reviewer activation and self-approval | `pnpm vitest run tests/unit/buzz-adapter/approval-parser.test.ts` failed: expected `self_approval`, received `decision: approve`; then the inactive-reviewer case failed by returning an approval. | Same command: `8 passed`; inactive and proposer identities fail closed. |
| Canonical decisions | `pnpm vitest run tests/unit/buzz-adapter/approval-parser.test.ts tests/unit/buzz-adapter/provenance.test.ts tests/integration/buzz-adapter/relay.test.ts` failed with expected `approved`/`rejected`, received `approve`/`reject`. | Same command: `15 passed, 1 skipped`; parser, TypeScript, and SQL now use `approved`/`rejected`. |
| Forged verification state | `pnpm vitest run tests/unit/buzz-adapter/provenance.test.ts` failed because a fabricated `VerifiedBuzzEvent` reached the RPC. | Same command: `3 passed`; the writer recomputes hash/signature from raw event before calling the RPC. |
| RPC decision trust boundary | `pnpm vitest run tests/unit/buzz-adapter/provenance.test.ts` failed because the RPC payload contained `source_decision`. | Same command: `3 passed`; the RPC receives the raw event only and derives the decision. |
| Forward migration/probe | `pnpm vitest run tests/integration/database/constraints.test.ts` failed: expected `0009_task_7_verified_buzz_approval.sql` to exist, received `false`. | Same command: `11 passed`; the executable database probe includes RPC, replay, self-approval, and service-role checks when configured. |
| Clean package build | `pnpm vitest run tests/unit/buzz-adapter/package-boundary.test.ts` failed after deleting generated `dist` directories (build exit `2`). | Same command: `1 passed`; adapter build explicitly builds the domain dependency. |

Focused verification after the final code changes:

```text
pnpm vitest run tests/unit/buzz-adapter/provenance.test.ts tests/unit/buzz-adapter/approval-parser.test.ts tests/integration/buzz-adapter/relay.test.ts tests/unit/buzz-adapter/package-boundary.test.ts tests/integration/database/constraints.test.ts
Test Files  5 passed (5)
Tests  27 passed | 1 skipped (28)

pnpm typecheck
$ tsc --noEmit

pnpm db:verify
SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.
```

Final requested focused verification (after stopping the interrupted broad
suite command):

```text
pnpm vitest run tests/unit/buzz-adapter tests/integration/buzz-adapter
Test Files  5 passed (5)
Tests  19 passed | 1 skipped (20)

pnpm typecheck
$ tsc --noEmit
```

There were no focused-test or typecheck failures. The one skipped test is the
credential-gated live relay test described below.

Fix commit: `fix: harden buzz approval provenance` (this report is included in
the same commit; see repository history for its final object ID).

### Changed files

- `packages/buzz-adapter/src/relay-transport.ts` (new NIP-01/NIP-42 transport)
- `packages/buzz-adapter/src/{client,approval-parser,provenance,index}.ts`
- `packages/buzz-adapter/package.json`
- `supabase/migrations/0009_task_7_verified_buzz_approval.sql`
- `scripts/verify-supabase-db.ts`
- `tests/integration/buzz-adapter/relay.test.ts`
- `tests/integration/database/migration-test-helpers.ts`
- `tests/unit/buzz-adapter/{approval-parser,package-boundary,provenance}.test.ts`

### Self-review and limitations

- `0001` and all Task 8+ files were unchanged. The obsolete, separately
  callable provenance/transition RPCs are revoked in migration 0009.
- Standard NIP-25 reactions are accepted with an `e` reference only; any `h`
  tag is checked against the stored proposal channel.
- The database probe uses deterministic envelope-shaped rows only to exercise
  transactional/RLS behavior; cryptographic verification remains at the
  server-owned TypeScript boundary and is covered with a deterministic BIP-340
  signature test. No private keys or credentials were added.
- `BUZZ_RELAY_URL`, `BUZZ_DEMO_CHANNEL`, and `SUPABASE_DB_URL` were absent, so
  neither the live relay nor live database probe authenticated, published, or
  claimed success. These are the remaining credential-gated limitations.

## Fix Round 2 (2026-08-11)

### RED / GREEN evidence

| Defect | RED evidence | GREEN evidence |
| --- | --- | --- |
| Proposal provenance writer | `pnpm vitest run tests/unit/buzz-adapter/provenance.test.ts tests/integration/database/constraints.test.ts` failed with `writer.recordProposal is not a function`. | The focused suite below passes; `DatabaseProvenanceWriter.recordProposal` verifies and sends workspace, passport, channel-bearing raw event, proposer pubkey, and relay data to `record_verified_buzz_proposal`. |
| Passport substitution | The same RED run failed because the RPC payload still contained `target_action_passport_id` from the approval caller. | The same focused suite passes; approval input has no passport target and migration 0010 resolves the stored proposal's bound passport. |
| Forward migration | The same RED run failed because `0010_task_7_proposal_binding_and_request_changes.sql` did not exist. | `pnpm vitest run tests/integration/database/constraints.test.ts` -> `11 passed`. |
| NIP-42 retry and timeout | `pnpm vitest run tests/integration/buzz-adapter/relay.test.ts` failed 3 tests: auth-required rejection did not retry, timeout test hung until Vitest's 5-second test timeout, and proposal recording hook was absent. | Same command -> `7 passed, 1 skipped`; retry sends a second EVENT after AUTH success and no-ack publication returns `network_timeout`. |

The final focused verification for this round was:

```text
pnpm vitest run tests/unit/buzz-adapter tests/integration/buzz-adapter tests/integration/database/constraints.test.ts --testTimeout=5000 --hookTimeout=5000
Test Files  6 passed (6)
Tests  34 passed | 1 skipped (35)
Duration  11.51s (tests 11.66s)

pnpm typecheck
$ tsc --noEmit
```

The full repository suite was not rerun in this round because the requested
verification scope was focused Buzz adapter tests plus typecheck. The live
relay test remains skipped without configured identity/membership, and the
live Supabase probe remains credential-gated; neither claims authenticated
success.

Final requested verification after the interrupted attempt was stopped:

```text
pnpm exec vitest run tests/unit/buzz-adapter tests/integration/buzz-adapter --reporter=dot --testTimeout=5000 --hookTimeout=5000
Test Files  5 passed (5)
Tests  23 passed | 1 skipped (24)
Duration  4.74s (tests 4.94s)

pnpm typecheck
$ tsc --noEmit
```

No focused test or typecheck failure remained. The separate migration artifact
check had already passed earlier in this round with `11 passed`.

### Fix Round 2 changed files

- `packages/buzz-adapter/src/{client,provenance,relay-transport}.ts`
- `supabase/migrations/0010_task_7_proposal_binding_and_request_changes.sql`
- `scripts/verify-supabase-db.ts`
- `tests/integration/buzz-adapter/relay.test.ts`
- `tests/integration/database/migration-test-helpers.ts`
- `tests/unit/buzz-adapter/provenance.test.ts`
- `context.md` and `decisions.md` (round state and decisions D-010/D-011)
