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
