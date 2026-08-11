export type DemoState =
  | 'ready'
  | 'proposed'
  | 'verified'
  | 'approval_required'
  | 'drift_blocked'
  | 'approved'
  | 'executed';

export interface DemoSnapshot {
  runId: string;
  mode: 'offline-replay';
  state: DemoState;
  actionId: string;
  passportHash: string;
  target: string;
  eventIds: string[];
  nextRequiredAction: string | null;
  receiptHash: string | null;
}

const steps: Array<{ state: DemoState; action: string | null }> = [
  { state: 'ready', action: 'generate_proposal' },
  { state: 'proposed', action: 'run_verifier' },
  { state: 'verified', action: 'review_in_buzz' },
  { state: 'approval_required', action: 'approve_in_buzz' },
  { state: 'drift_blocked', action: 'approve_corrected_passport' },
  { state: 'approved', action: 'execute_sandbox_action' },
  { state: 'executed', action: null },
];

export function createDemoRun(runId: string): DemoSnapshot {
  return snapshot(runId, 0);
}

export function advanceDemoRun(current: DemoSnapshot): DemoSnapshot {
  const index = steps.findIndex((step) => step.state === current.state);
  if (index < 0 || index === steps.length - 1) return current;
  return snapshot(current.runId, index + 1, current);
}

function snapshot(
  runId: string,
  index: number,
  previous?: DemoSnapshot,
): DemoSnapshot {
  const step = steps[index];
  const eventIds = [...(previous?.eventIds ?? []), `offline-${step.state}`];
  return {
    runId,
    mode: 'offline-replay',
    state: step.state,
    actionId: previous?.actionId ?? 'demo-action-20260811',
    passportHash: previous?.passportHash ?? 'a'.repeat(64),
    target:
      step.state === 'drift_blocked'
        ? 'sandbox://production'
        : step.state === 'approved' || step.state === 'executed'
          ? 'sandbox://staging'
          : (previous?.target ?? 'sandbox://staging'),
    eventIds,
    nextRequiredAction: step.action,
    receiptHash: step.state === 'executed' ? 'e'.repeat(64) : null,
  };
}
