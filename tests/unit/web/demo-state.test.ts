import { describe, expect, it } from 'vitest';
import {
  advanceDemoRun,
  createDemoRun,
} from '../../../apps/web/lib/demo-state.ts';

describe('offline demo state', () => {
  it('replays the human-agent workflow and makes approval drift visible', () => {
    let state = createDemoRun('run-1');
    for (let index = 0; index < 4; index += 1) state = advanceDemoRun(state);
    expect(state.state).toBe('drift_blocked');
    expect(state.target).toBe('sandbox://production');
    state = advanceDemoRun(state);
    state = advanceDemoRun(state);
    expect(state.state).toBe('executed');
    expect(state.target).toBe('sandbox://staging');
    expect(state.receiptHash).toMatch(/^[0-9a-f]{64}$/);
    expect(state.mode).toBe('offline-replay');
  });

  it('is idempotent after completion', () => {
    let state = createDemoRun('run-2');
    for (let index = 0; index < 10; index += 1) state = advanceDemoRun(state);
    expect(advanceDemoRun(state)).toEqual(state);
  });
});
