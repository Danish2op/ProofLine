# Proofline

### Approval-bound execution for human–agent operations

Proofline is a human–agent action-integrity gateway. An agent can investigate
evidence and propose a bounded action; a second verifier recomputes the policy
decision; a human reviews the proposal in Buzz; and the executor runs only the
exact passport that was approved.

If the target, arguments, tool metadata, evidence, policy, or executor identity
changes after approval, Proofline blocks execution and requires a new decision.

## Public demonstration

- Product: <https://proofline.danis.live>
- Demo: <https://proofline.danis.live/demo>
- Fallback Vercel URL: <https://proofline-d02qliopj-danishs-projects-64849313.vercel.app/demo>

The public demo is an explicit **offline technical replay**. It needs no login,
API key, model provider, database, or live agent. This is intentional: a
reviewer can see the complete product invariant without being asked to trust a
temporary AI service or a hidden backend.

## The five-minute demo

1. Open `/demo` and explain that the replay is synthetic and offline.
2. Advance to **proposed**: the proposer agent creates an evidence-backed action.
3. Advance to **verified**: the independent verifier recomputes hashes and policy.
4. Advance to **approval required**: the consequential decision belongs to a human in Buzz.
5. Advance to **drift blocked**: the target changes from `sandbox://staging` to
   `sandbox://production`; the original approval is no longer valid.
6. Advance to **approved**: the corrected staging passport is approved.
7. Advance to **executed**: the deterministic sandbox returns a receipt hash.
8. Point to the audit timeline and the final target. It must be staging, never
   the drifted production target.

The important sentence is:

> Proofline does not ask whether an action was approved in general. It asks
> whether this exact action, with this exact metadata, is still the approved one.

## Why Buzz matters

Buzz is the human coordination surface, not a chatbot window. In live mode:

- Proofline publishes a signed, passport-bound proposal event to the configured Buzz channel.
- Human reviewers inspect the proposal and respond in the same Buzz thread/channel.
- The Buzz adapter verifies signatures, channel references, proposal hashes, reviewer identity, and expiry.
- Supabase stores the verified Buzz provenance and approval observation.
- The execution gate rechecks the approved passport before any provider call.

The deterministic offline replay mirrors those states without claiming that a
live Buzz event was received.

## Architecture

```text
Agent proposer ──> Action Passport ──> Deterministic verifier
                                      │
                                      v
                              Signed Buzz proposal
                                      │
                              Human review/approval
                                      │
                                      v
Supabase provenance/audit <── Execution gate <── Sandbox or real provider
```

Core packages:

- `packages/domain` — strict passport, evidence, lifecycle, and persistence types.
- `packages/policy-engine` — deterministic risk and policy evaluation.
- `packages/agents` — bounded proposer/verifier agents; no execution authority.
- `packages/buzz-adapter` — signed Buzz event codec, provenance, and approval parsing.
- `packages/execution` — hash-bound gate, idempotency, sandbox provider, and receipts.
- `supabase/functions` — authenticated action, verifier, approval, revoke, Buzz, and execution boundaries.
- `apps/web` — public landing page and offline replay.

## Realtime usage

The public replay is not the live integration. A team that wants realtime usage
does the following:

1. Creates a Supabase project and applies the migrations:

   ```powershell
   npx supabase login
   npx supabase link --project-ref YOUR_PROJECT_REF
   npx supabase db push --linked --yes
   ```

2. Deploys the authenticated functions with the included Deno import map:

   ```powershell
   npx supabase functions deploy run-verifier --use-api --import-map supabase/functions/import_map.json
   npx supabase functions deploy execute-action --use-api --import-map supabase/functions/import_map.json
   npx supabase functions deploy create-action approve-action revoke-action process-buzz-event --use-api --import-map supabase/functions/import_map.json
   ```

3. Creates a workspace, member, agent identity, tool definition, policy, and
   action passport. The authenticated caller must be a permitted workspace role.

4. Connects a Buzz signer/relay worker using `packages/buzz-adapter`. The worker
   publishes proposals and forwards verified Buzz events to
   `process-buzz-event`.

5. Calls the deployed functions with a Supabase user access token:

   ```text
   POST /functions/v1/create-action
   POST /functions/v1/run-verifier
   POST /functions/v1/approve-action
   POST /functions/v1/execute-action
   ```

6. Keeps the browser/UI free of service-role secrets. The browser may hold a
   publishable Supabase key; service-role operations remain inside Edge
   Functions or a trusted worker.

### Current live-mode boundary

The security-critical Supabase functions and migrations are deployed for the
Proofline project used by the demo. The public web demo remains offline by
design. Realtime Buzz usage still requires a real Supabase user/member, a
configured signer/relay worker, and actual stored action/evidence/provenance
rows. No fake live approval is generated for the public demo.

## Local development

Requirements:

- Node.js 22 LTS or newer
- pnpm 11.16.0
- Optional: Supabase CLI for live/local database work

```powershell
pnpm install --frozen-lockfile
pnpm test
pnpm typecheck
pnpm format:check
pnpm --filter @proofline/web run next-build
```

Run the web app locally:

```powershell
pnpm --filter @proofline/web exec next dev
```

Then open <http://localhost:3000/demo>.

## Deployment

The repository is a pnpm monorepo. Vercel uses the root `vercel.json`:

- frozen `pnpm install`
- `pnpm --filter @proofline/web run next-build`
- Next.js 15
- static prerendering for `/` and `/demo`

Deploy manually:

```powershell
vercel --prod --yes --project proofline
```

The custom domain `proofline.danis.live` is attached to the Vercel project.
Its registrar must point `proofline` to the Vercel-provided CNAME target.

## Security model

- Client requests contain identifiers, not authoritative verifier context.
- Server-owned passport/revision/policy/evidence records are reloaded before verification.
- Proposal hashes and approval events are bound to the exact passport.
- Agents cannot approve, execute, mutate lifecycle state, or persist directly.
- Execution recomputes the passport hash immediately before provider execution.
- Idempotency and append-only audit records prevent duplicate or ambiguous actions.
- Evidence content is untrusted data; prompt-injection text cannot change policy.
- Service-role credentials never belong in the browser or repository.

## Verification status

The current branch has a green bounded verification suite with **306 passing
tests and 1 credential-gated skip**, plus typecheck, package builds, formatting,
Supabase migration parity, Supabase function deployment, and Vercel production
build verification.

## Repository status

- Branch: `feat/proofline-mvp`
- Repository: <https://github.com/Danish2op/ProofLine>
- License: no license file is currently declared; add the intended license before accepting external contributions.
