'use client';

import { useState } from 'react';
import {
  advanceDemoRun,
  createDemoRun,
  type DemoSnapshot,
} from '../../lib/demo-state';

export default function DemoClient() {
  const [snapshot, setSnapshot] = useState<DemoSnapshot>(() =>
    createDemoRun('public-offline-replay'),
  );
  const finished = snapshot.state === 'executed';
  const explanation = explanations[snapshot.state];
  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px' }}>
      <p style={{ color: '#8ce6c1', letterSpacing: 2 }}>
        OFFLINE TECHNICAL REPLAY · NO LIVE CREDENTIALS
      </p>
      <h1>Proofline deployment rehearsal</h1>
      <p style={{ color: '#b9c1d0' }}>
        Two bounded agents prepare and verify an immutable action passport. A
        human reviewer makes the consequential decision in Buzz. The sandbox
        executes only the exact corrected passport.
      </p>
      <div style={banner}>
        <strong>What this proves:</strong> an approved staging action cannot
        silently become a production action. Advance the replay to watch
        Proofline block the drift.
      </div>
      <section style={rolesGrid}>
        {['Proposer Agent', 'Verifier Agent', 'Human in Buzz'].map((role) => (
          <div key={role} style={roleCard}>
            <strong>{role}</strong>
            <small>
              {role === 'Proposer Agent'
                ? 'Builds evidence-backed proposal'
                : role === 'Verifier Agent'
                  ? 'Recomputes policy and hashes'
                  : 'Approves or corrects the consequence'}
            </small>
          </div>
        ))}
      </section>
      <section
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 18,
          marginTop: 32,
        }}
      >
        <article style={card}>
          <small>STATE</small>
          <h2>{snapshot.state.replaceAll('_', ' ')}</h2>
          <p>{explanation}</p>
          <p style={{ color: '#8ce6c1' }}>
            {snapshot.nextRequiredAction
              ? `Next: ${snapshot.nextRequiredAction.replaceAll('_', ' ')}`
              : 'Completed with deterministic sandbox receipt.'}
          </p>
        </article>
        <article style={card}>
          <small>BOUND METADATA</small>
          <p>
            Target: <code>{snapshot.target}</code>
          </p>
          <p>
            Passport: <code>{snapshot.passportHash.slice(0, 16)}…</code>
          </p>
          <p>
            Mode: <code>{snapshot.mode}</code>
          </p>
          {snapshot.receiptHash ? (
            <p>
              Receipt: <code>{snapshot.receiptHash.slice(0, 16)}…</code>
            </p>
          ) : null}
        </article>
      </section>
      <button
        disabled={finished}
        onClick={() => setSnapshot((current) => advanceDemoRun(current))}
        style={{ ...button, opacity: finished ? 0.5 : 1 }}
      >
        {finished
          ? 'Replay complete'
          : `Advance: ${snapshot.nextRequiredAction}`}
      </button>
      <button
        onClick={() => setSnapshot(createDemoRun('public-offline-replay'))}
        style={resetButton}
      >
        Reset replay
      </button>
      <h2 style={{ marginTop: 42 }}>Shared audit timeline</h2>
      <ol>
        {snapshot.eventIds.map((eventId) => (
          <li key={eventId} style={{ margin: '12px 0' }}>
            <code>{eventId}</code>
          </li>
        ))}
      </ol>
    </main>
  );
}

const card = {
  border: '1px solid #2b3444',
  borderRadius: 12,
  padding: 22,
  background: '#171c25',
};
const banner = {
  marginTop: 24,
  padding: 18,
  borderRadius: 12,
  background: '#20352f',
  border: '1px solid #3a6a58',
  color: '#d9fff0',
};
const rolesGrid = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 12,
  marginTop: 22,
};
const roleCard = { ...card, display: 'grid', gap: 8 };
const button = {
  marginTop: 28,
  padding: '13px 18px',
  border: 0,
  borderRadius: 9,
  background: '#8ce6c1',
  color: '#10131a',
  fontWeight: 700,
  cursor: 'pointer',
};
const resetButton = {
  ...button,
  marginLeft: 10,
  background: '#2b3444',
  color: '#f5f7fb',
};

const explanations = {
  ready: 'No action has been proposed yet.',
  proposed:
    'The proposer created a bounded deployment proposal from structured evidence.',
  verified:
    'The independent verifier recomputed the passport hash and policy decision.',
  approval_required:
    'Buzz is waiting for a human reviewer to make the consequential decision.',
  drift_blocked:
    'The target changed from staging to production after approval. Execution is blocked.',
  approved:
    'The corrected staging passport is approved and ready for the sandbox.',
  executed:
    'The sandbox executed the exact approved staging passport and emitted a receipt.',
} as const;
