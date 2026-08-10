# Task 3 Fix Round 1 Report

Implementation commit: `b739870 fix: harden action passport invariants`

## Scope

This fix round remains within Task 3. It corrects RFC 8785-compatible
canonicalization, shares JSON-safety validation between hashing and domain
validation, invalidates approval on revisions, and hardens display redaction.

## RED evidence

The following failures were run and observed before their corresponding
production fixes:

1. `pnpm vitest run tests/unit/domain/action-passport.test.ts tests/unit/domain/canonicalization.test.ts`
   - Exit code: `1`
   - Result: `7 failed | 26 passed` tests across `2 failed` files.
   - Observed failures: canonicalization NFC-normalized decomposed text and
     rejected normalization-distinct keys; `validatePassport` accepted a
     non-NFC target and accepted `undefined`, function, symbol, and bigint
     values that `computePassportHash` rejected.
2. `pnpm vitest run tests/unit/domain/action-passport.test.ts`
   - Exit code: `1`
   - Result: `1 failed | 23 passed` tests.
   - Observed failure: a revision retained approval metadata and had no
     `DRAFT` lifecycle status.
3. `pnpm vitest run tests/unit/domain/canonicalization.test.ts`
   - Exit code: `1`
   - Result: `2 failed | 10 passed` tests.
   - Observed failures: token-shaped root strings and token-shaped values in
     arrays/key variants were returned unredacted.

## GREEN evidence

1. Shared JSON-safety and RFC-compatible canonicalization:
   `pnpm vitest run tests/unit/domain/action-passport.test.ts tests/unit/domain/canonicalization.test.ts`
   - Exit code: `0`
   - Result: `33 passed` tests in `2 passed` files.
2. Approval invalidation on revisions:
   `pnpm vitest run tests/unit/domain/action-passport.test.ts`
   - Exit code: `0`
   - Result: `24 passed` tests in `1 passed` file.
3. Recursive redaction:
   `pnpm vitest run tests/unit/domain/canonicalization.test.ts`
   - Exit code: `0`
   - Result: `12 passed` tests in `1 passed` file.
4. Expanded structural, nested-schema, null-revision, and terminal lifecycle
   coverage:
   `pnpm vitest run tests/unit/domain/action-passport.test.ts`
   - Exit code: `0`
   - Result: `37 passed` tests in `1 passed` file.

## REFACTOR evidence

Extracted the shared `packages/canonical/src/json-safe.ts` predicate and kept
canonicalization as a serializer over prevalidated JSON-safe values. Applied
Prettier, then ran:

`pnpm vitest run tests/unit/domain/action-passport.test.ts tests/unit/domain/canonicalization.test.ts`

- Exit code: `0`
- Result: `49 passed` tests in `2 passed` files.

## Final verification

Ran as one fresh sequence before implementation commit:

`pnpm format:check; pnpm typecheck; pnpm lint; pnpm test; pnpm build`

- Exit code: `0`
- `pnpm format:check`: all files matched Prettier style.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: `57 passed` tests in `4 passed` files.
- `pnpm build`: passed for `9 of 10` workspace projects.

## Changed files

- `packages/canonical/src/canonicalize.ts`
- `packages/canonical/src/json-safe.ts`
- `packages/canonical/src/redaction.ts`
- `packages/domain/src/action.ts`
- `packages/domain/package.json`
- `pnpm-lock.yaml`
- `tests/unit/domain/action-passport.test.ts`
- `tests/unit/domain/canonicalization.test.ts`

## Concerns

- Domain input deliberately rejects non-NFC strings and keys before hashing;
  canonical JSON itself preserves code points as required by RFC 8785.
- Redaction covers explicit sensitive key variants, `secrets`/`credentials`
  containers, and common token patterns. It cannot reliably identify every
  arbitrary secret embedded in otherwise ordinary prose, so future adapters
  should continue to provide explicit sensitive-field metadata.

---

# Task 3 Fix Round 2 Report

Implementation commit: `169050b fix: bind passport hashes to explicit status`

## Scope

This round remains within Task 3. It binds raw hash input to the validated
passport shape, extends root/array redaction patterns, and makes the canonical
package buildable and consumable through its declared workspace package name.

## RED evidence

1. `pnpm vitest run tests/unit/domain/action-passport.test.ts tests/unit/domain/canonicalization.test.ts tests/unit/domain/canonical-package.test.ts`
   - Exit code: `1`
   - Result: `6 failed | 49 passed` tests across `3 failed` files.
   - Observed failures: omitted `status` validated as `DRAFT`; synthetic raw
     64-hex Nostr private keys, `nsec` keys, JWTs, and Supabase keys leaked at
     root/array positions; canonical had no buildable public package entrypoint.
2. The initial package build test encountered Windows command-launch status
   `null`, so its harness was corrected to use the platform shell. The
   repeated command `pnpm vitest run tests/unit/domain/canonical-package.test.ts`
   then exited `1` with `1 failed` test because the canonical package had no
   `build` script, which is the intended RED condition.

## GREEN evidence

`pnpm vitest run tests/unit/domain/action-passport.test.ts tests/unit/domain/canonicalization.test.ts tests/unit/domain/canonical-package.test.ts`

- Exit code: `0`
- Result: `55 passed` tests in `3 passed` files.
- The package test runs the canonical TypeScript build and launches Node from
  `packages/domain` to import `findJsonSafetyIssue` through
  `@proofline/canonical`.

## REFACTOR and final verification

After Prettier, the focused command remained green at `55 passed` tests. A
fresh full sequence then completed with exit code `0`:

`pnpm format:check; pnpm typecheck; pnpm lint; pnpm test; pnpm build`

- `pnpm format:check`: all files matched Prettier style.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: `63 passed` tests in `5 passed` files.
- `pnpm build`: passed; canonical ran `tsc -p tsconfig.build.json` and the
  workspace build completed.

## Changed files

- `packages/canonical/package.json`
- `packages/canonical/tsconfig.build.json`
- `packages/canonical/src/index.ts`
- `packages/canonical/src/hashing.ts`
- `packages/canonical/src/redaction.ts`
- `packages/domain/src/action.ts`
- `tsconfig.base.json`
- `vitest.config.ts`
- `tests/unit/domain/action-passport.test.ts`
- `tests/unit/domain/canonicalization.test.ts`
- `tests/unit/domain/canonical-package.test.ts`

## Concerns

- Raw 64-hex strings are redacted as requested because they can be Nostr
  private keys. This can also redact a hash when it appears as a bare
  root/array string; structured UI values should label non-secret hashes with
  explicit field metadata.
- Pattern-based redaction remains defense in depth, not a substitute for
  explicit sensitive-field metadata from future provider adapters.

---

# Task 3 Fix Round 3 Report

Implementation commit: `aa9afc8 fix: preserve auditable hex identifiers`

## Scope and trust boundary

Bare 64-hex values are semantically ambiguous: they can be Proofline hashes,
Nostr public keys/event IDs, or raw private keys. Redaction therefore preserves
them by default so audit and provenance fields remain usable. Callers must mark
an ambiguous secret through a recognized sensitive field name (for example,
`privateKey`) or `sensitivePaths`, whose path-segment form supports the root
(`[]`), an array element (`[0]`), or nested fields (`['nested', 'value']`).

`nsec`, JWT, Supabase, and the previously covered token patterns remain
automatically redacted anywhere because their syntax identifies them as secrets.

## RED evidence

`pnpm vitest run tests/unit/domain/canonicalization.test.ts`

- Exit code: `1`
- Result: `1 failed | 15 passed` tests in `1 failed` file.
- Observed failure: a bare synthetic 64-hex audit identifier at the root was
  rendered as `[REDACTED:…]` by the global hex pattern. The test also covers
  root/array visibility, named sensitive-field redaction, explicit path
  redaction, and the concrete `passportHash`, `toolDefinitionHash`,
  `contentHash`, `agentPubkey`, and `eventId` field names.

## GREEN and REFACTOR evidence

After replacing the global hex pattern with path-aware sensitivity metadata:

`pnpm vitest run tests/unit/domain/canonicalization.test.ts`

- Exit code: `0`
- Result: `16 passed` tests in `1 passed` file.

Applied Prettier to the implementation and regression test, then reran the
same focused command with the same `16 passed` result.

## Final verification

`pnpm format:check; pnpm typecheck; pnpm lint; pnpm test; pnpm build`

- Exit code: `0`
- `pnpm format:check`: all files matched Prettier style.
- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: `63 passed` tests in `5 passed` files.
- `pnpm build`: passed, including the canonical TypeScript build.

## Changed files

- `packages/canonical/src/redaction.ts`
- `tests/unit/domain/canonicalization.test.ts`

## Concerns

- A raw 64-hex private key cannot be distinguished syntactically from a public
  identifier or audit hash. The caller metadata contract is therefore a
  required trust boundary for those values; the redactor cannot safely infer
  it from the raw string alone.
