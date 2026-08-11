export type IdempotencyState =
  | { kind: 'new' }
  | { kind: 'already_succeeded'; receipt: unknown }
  | { kind: 'in_progress' }
  | { kind: 'retryable_failure'; error: unknown };

export class IdempotencyStore {
  private readonly records = new Map<
    string,
    { state: Exclude<IdempotencyState, { kind: 'new' }> }
  >();

  begin(key: string): IdempotencyState {
    const current = this.records.get(key)?.state;
    if (current !== undefined) return current;
    this.records.set(key, { state: { kind: 'in_progress' } });
    return { kind: 'new' };
  }

  succeed(key: string, receipt: unknown): void {
    this.records.set(key, { state: { kind: 'already_succeeded', receipt } });
  }

  failRetryably(key: string, error: unknown): void {
    this.records.set(key, { state: { kind: 'retryable_failure', error } });
  }
}
