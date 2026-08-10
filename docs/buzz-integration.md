# Buzz integration contract

Verified against public documentation on 2026-08-10. This pre-adapter contract
describes only signed-event transport and synthetic fixtures; it does not
provide a `BuzzRelayClient`.

## Interfaces and authority

| Interface                                                                | Authority                                                                                           | Proofline use                                   | Status                                          |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- | ----------------------------------------------- | ----------------------------------------------- |
| Nostr event envelope and `EVENT` / `REQ` / `CLOSE` frames                | [Buzz architecture](https://github.com/block/buzz/blob/main/ARCHITECTURE.md#2-the-protocol)         | Publish, query, and subscribe                   | Required after authenticated smoke confirmation |
| NIP-42 WebSocket and NIP-98 HTTP authentication                          | [Buzz architecture](https://github.com/block/buzz/blob/main/ARCHITECTURE.md#3-connection-lifecycle) | Future authenticated boundary                   | Not exercised by the read-only probe            |
| Channel messages (`kind:9`, `h`), reactions (`kind:7`, `e`), and replies | [Buzz Nostr guide](https://github.com/block/buzz/blob/main/NOSTR.md#what-works)                     | Proposal, verifier, reaction, and thread events | Supported path subject to probe                 |
| Relay information (NIP-11)                                               | [Buzz Nostr guide](https://github.com/block/buzz/blob/main/NOSTR.md#what-works)                     | Read-only capability discovery                  | Used by `pnpm buzz:smoke`                       |
| Agent CLI                                                                | [Buzz CLI README](https://github.com/block/buzz/blob/main/crates/buzz-cli/README.md)                | Operational reference                           | Never parse its response as an adapter contract |

The Buzz repository and architecture document are authoritative for Buzz
behavior; Nostr NIPs are authoritative for portable wire format. Proofline's
fixture parser is an adapter-side structural guard, not signature verification.

## Supported and fallback paths

The intended live path is authenticated NIP-01 WebSocket publication, filtered
queries, and channel-scoped subscriptions. Messages use `kind:9` with an `h`
channel tag. Replies use the documented NIP-10 `e` reply marker. Reactions use
`kind:7` with an `e` target; the relay derives their channel from the target, so
live reaction subscriptions must include `#h`.

Buzz is required for Proofline live operation. Offline replay is a clearly
labeled non-live fallback for demonstrations and failure handling; it must not
be presented as live collaboration or as evidence that a Buzz relay is working.
The live adapter task cannot be approved until the read-only probe and the
subsequent authenticated transport checks run against a disposable Buzz
relay/community.

When reactions are unavailable, Proofline must use an explicit approval or
rejection channel-message reply. When subscriptions are unavailable, it must
poll filtered historical queries and visibly label delivery as delayed. The UI
must show either relay limitation rather than implying live reaction status.

NIP-01 transport is required. The `reactions`, `threads`, and
`channelReferences` capability flags are optional and may intentionally be
`false`: `reactions=false` selects the explicit message fallback;
`threads=false` selects flat, explicitly linked messages with no native thread
view; and `channelReferences=false` makes the channel-scoped live path
incompatible and fails closed to the labeled offline replay fallback. A future
adapter must make the selected fallback visible in the UI.

Proofline approval semantics are implemented by Proofline over Buzz events,
not claimed as a native Buzz approval API. A check-mark reaction is not approval
until later Proofline code validates the event ID, signer, role, exact passport
hash, policy snapshot, expiry, and replay state.

## Recorded fixtures

`packages/buzz-adapter/src/fixtures.ts` contains only synthetic identifiers,
timestamps, messages, public-key-shaped strings, and signature-shaped strings.
It covers the required eight cases. Fixtures are not signed events and must
never be sent to a relay. `parseRecordedBuzzEvent` checks only the envelope
shape. It does not verify Schnorr signatures, trust a signer, deduplicate,
order events, or interpret approvals; those boundaries are intentionally later.

## Read-only smoke probe

Run only against a disposable test community:

```bash
BUZZ_RELAY_URL=https://relay.example.test pnpm buzz:smoke
```

The script converts explicit `ws(s)` URLs to `http(s)`, issues one `GET` with
`Accept: application/nostr+json`, and does not authenticate, subscribe,
publish, or transmit private material. It emits a capability assessment and a
recursive JSON _shape_ (not response values), then exits nonzero when the URL
is absent, contains userinfo, the response is unusable, or NIP-01 is not
advertised. It never logs a credential-bearing relay URL.

No disposable relay URL was provided for this task, so no external smoke request
was made. The checked-in test verifies the mandatory missing-URL failure. Before
writing a live adapter, run the probe on a disposable community and record only
the sanitized output and date in an operational runbook, never fixtures or Git.

## Risks and uncertainties

- NIP-11 advertises support but does not prove authenticated authorization.
- Private-channel global subscriptions are excluded, and reaction live delivery
  requires a channel-scoped filter; the future adapter must preserve this.
- The CLI may evolve independently; target documented Nostr transport instead.
- `buzz workflows approve` is a Buzz workflow feature, not Proofline's approval
  model.
