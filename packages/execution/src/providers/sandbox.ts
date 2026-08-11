import type { ActionPassportV1 } from '@proofline/domain';

export interface ApprovedAction {
  passport: ActionPassportV1;
  passportHash: string;
}
export interface ProviderResult {
  providerRequestId: string;
  outcome: 'succeeded' | 'failed';
  sideEffects: string[];
  rollbackReference: string | null;
  providerMetadata: Record<string, unknown>;
}

export class SandboxProvider {
  constructor(
    private readonly options: { fail?: boolean; latencyMs?: number } = {},
  ) {}

  async execute(action: ApprovedAction): Promise<ProviderResult> {
    if (this.options.latencyMs)
      await new Promise((resolve) =>
        setTimeout(resolve, this.options.latencyMs),
      );
    const providerRequestId = `sandbox-${action.passport.actionId}-${action.passportHash.slice(0, 12)}`;
    if (this.options.fail) {
      return {
        providerRequestId,
        outcome: 'failed',
        sideEffects: [],
        rollbackReference: null,
        providerMetadata: {
          provider: 'offline-sandbox',
          reason: 'simulated_outage',
        },
      };
    }
    return {
      providerRequestId,
      outcome: 'succeeded',
      sideEffects: [`deployed:${action.passport.target}`],
      rollbackReference: `rollback://${providerRequestId}`,
      providerMetadata: {
        provider: 'offline-sandbox',
        target: action.passport.target,
      },
    };
  }
}
