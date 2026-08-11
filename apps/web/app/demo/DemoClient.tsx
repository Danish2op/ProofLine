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
  return (
    <main style={{ maxWidth: 1080, margin: '0 auto', padding: '48px 24px' }}>
      <p style={{ color: '#8ce6c1', letterSpacing: 2 }}>
        OFFLINE TECHNICAL REPLAY · NO LIVE CREDENTIALS
      </p>
      <h1>Proofline deployment rehearsal</h1>
      <p style={{ color: '#b9c1d0' }}>
        Two bounded agents prepare and verify. A human decision is represented
        by the Buzz approval step. The sandbox executes only the exact approved
        passport.
      </p>
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
          <p>
            {snapshot.nextRequiredAction ??
              'Completed with deterministic sandbox receipt.'}
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
