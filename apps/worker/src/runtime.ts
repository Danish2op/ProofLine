import {
  transitionAction,
  type ActionState,
  type LifecycleAuditRecord,
  type LifecycleError,
  type TransitionInput,
  type TransitionResult,
} from '@proofline/domain';

export type LifecycleCommand = Omit<TransitionInput, 'state'> &
  Pick<ActionState, 'actionId' | 'workspaceId'>;
export type LifecycleCommandResult =
  | TransitionResult
  | {
      ok: false;
      error:
        | LifecycleError
        | {
            code: 'action_not_found' | 'idempotency_conflict';
            message: string;
            retryable: false;
          };
    };

interface CommandReceipt {
  fingerprint: string;
  result: LifecycleCommandResult;
}

export class InMemoryLifecycleCommandStore {
  private readonly actions = new Map<string, ActionState>();
  private readonly receipts = new Map<string, CommandReceipt>();
  private readonly audit = new Array<LifecycleAuditRecord>();
  private lock: Promise<void> = Promise.resolve();

  constructor(actions: ActionState[]) {
    for (const action of actions) this.actions.set(actionKey(action), action);
  }

  async transact<T>(operation: () => T | Promise<T>): Promise<T> {
    const previous = this.lock;
    let release: (() => void) | undefined;
    this.lock = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }

  action(workspaceId: string, actionId: string): ActionState | undefined {
    return this.actions.get(`${workspaceId}:${actionId}`);
  }

  replace(action: ActionState): void {
    this.actions.set(actionKey(action), action);
  }

  receipt(key: string): CommandReceipt | undefined {
    return this.receipts.get(key);
  }

  remember(key: string, receipt: CommandReceipt): void {
    this.receipts.set(key, receipt);
  }

  appendAudit(audit: LifecycleAuditRecord): void {
    this.audit.push(audit);
  }

  auditEvents(): readonly LifecycleAuditRecord[] {
    return this.audit;
  }
}

export class LifecycleCommandService {
  constructor(private readonly store: InMemoryLifecycleCommandStore) {}

  async execute(command: LifecycleCommand): Promise<LifecycleCommandResult> {
    return this.store.transact(() => this.executeLocked(command));
  }

  async approveAction(
    command: Omit<LifecycleCommand, 'to'> & {
      approval: NonNullable<LifecycleCommand['approval']>;
    },
  ): Promise<LifecycleCommandResult> {
    return this.execute({ ...command, to: 'APPROVED' });
  }

  async revokeAction(
    command: Omit<LifecycleCommand, 'to'>,
  ): Promise<LifecycleCommandResult> {
    return this.execute({ ...command, to: 'REVOKED' });
  }

  async recordFailure(
    command: Omit<LifecycleCommand, 'to' | 'failure'> & {
      retryable: boolean;
      reason: string;
    },
  ): Promise<LifecycleCommandResult> {
    return this.execute({
      ...command,
      to: command.retryable ? 'EXECUTING' : 'FAILED',
      failure: { retryable: command.retryable, reason: command.reason },
    });
  }

  private executeLocked(command: LifecycleCommand): LifecycleCommandResult {
    const receiptKey = `${command.workspaceId}:${command.actionId}:${command.commandId}`;
    const fingerprint = fingerprintCommand(command);
    const prior = this.store.receipt(receiptKey);
    if (prior !== undefined) {
      if (prior.fingerprint === fingerprint) return prior.result;
      return idempotencyConflict();
    }

    const state = this.store.action(command.workspaceId, command.actionId);
    if (state === undefined) return actionNotFound();

    const result = transitionAction({ ...command, state });
    this.store.remember(receiptKey, { fingerprint, result });
    if (result.ok) {
      this.store.replace(result.value.state);
      this.store.appendAudit(result.value.audit);
    }
    return result;
  }
}

function actionKey(action: ActionState): string {
  return `${action.workspaceId}:${action.actionId}`;
}

function fingerprintCommand(command: LifecycleCommand): string {
  return JSON.stringify({
    to: command.to,
    expectedVersion: command.expectedVersion,
    actor: command.actor,
    correlationId: command.correlationId,
    causationId: command.causationId,
    occurredAt: command.occurredAt,
    approval: command.approval,
    failure: command.failure,
  });
}

function actionNotFound(): LifecycleCommandResult {
  return {
    ok: false,
    error: {
      code: 'action_not_found',
      message: 'Action was not found in this workspace.',
      retryable: false,
    },
  };
}

function idempotencyConflict(): LifecycleCommandResult {
  return {
    ok: false,
    error: {
      code: 'idempotency_conflict',
      message: 'Command ID was already used with a different payload.',
      retryable: false,
    },
  };
}
