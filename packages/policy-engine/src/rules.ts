import type { ActionPassportV1 } from '../../domain/src/action.js';
import { hashCanonicalJson } from '@proofline/canonical';

import { riskFactors, type RiskFactor } from './risk.js';

export const policyEngineVersion = 'proofline-mvp-policy-v1';

const dataClasses = [
  'public',
  'internal',
  'confidential',
  'restricted',
] as const;
const roles = ['agent', 'owner', 'operator', 'security_reviewer'] as const;

export type DataClass = (typeof dataClasses)[number];
export type Role = (typeof roles)[number];

export interface ToolMetadata {
  readOnly: boolean;
  destructive: boolean;
  idempotent: boolean;
  externalSideEffect: boolean;
  dataClasses: DataClass[];
  declaredScopes: string[];
  definitionHash: string;
}

export interface DelegatedAuthority {
  delegatedBy: string;
  scopes: string[];
  expiresAt?: string;
}

export interface Actor {
  pubkey: string;
  roles: Role[];
  recognized: boolean;
  delegatedAuthority?: DelegatedAuthority;
}

export interface WorkspacePolicy {
  version: string;
  trustedToolDefinitionHashes: string[];
  deniedToolNames?: string[];
  deniedScopes?: string[];
  restrictedDataClasses?: DataClass[];
  approvalRoles?: Role[];
}

interface NormalizedWorkspacePolicy {
  version: string;
  trustedToolDefinitionHashes: string[];
  deniedToolNames: string[];
  deniedScopes: string[];
  restrictedDataClasses: DataClass[];
  approvalRoles: Role[];
}

export interface RuleEvaluation {
  factors: RiskFactor[];
  policySnapshotHash: string;
  requiredRoles: Role[];
}

export function evaluateRules(input: {
  passport: ActionPassportV1;
  actor: Actor;
  toolMetadata: ToolMetadata;
  workspacePolicy: WorkspacePolicy;
  now: Date;
}): RuleEvaluation {
  const policy = normalizeWorkspacePolicy(input.workspacePolicy);
  if (!policy) return invalidPolicyEvaluation();

  const metadata = input.toolMetadata;
  if (!isTrustedToolMetadata(metadata, input.passport, policy)) {
    return {
      factors: [riskFactors.untrustedToolMetadata],
      policySnapshotHash: snapshotHash(policy),
      requiredRoles: [],
    };
  }

  const factors: RiskFactor[] = [];
  if (!isMatchingActor(input.actor, input.passport)) {
    factors.push(riskFactors.actorIdentityMismatch);
  }
  if (!input.actor.recognized) factors.push(riskFactors.unrecognizedAgent);
  if (
    !hasValidDelegatedAuthority(
      input.actor,
      input.passport,
      metadata,
      input.now,
    )
  ) {
    factors.push(
      isExpiredAuthority(input.actor, input.now)
        ? riskFactors.expiredDelegatedAuthority
        : riskFactors.missingDelegatedAuthority,
    );
  }
  if (hasStaleEvidence(input.passport, input.now)) {
    factors.push(riskFactors.staleEvidence);
  }
  if (isExplicitlyDenied(input.passport, metadata, policy)) {
    factors.push(riskFactors.workspaceExplicitDeny);
  }
  if (
    metadata.dataClasses.some((dataClass) =>
      policy.restrictedDataClasses.includes(dataClass),
    )
  ) {
    factors.push(riskFactors.restrictedData);
  } else if (
    metadata.dataClasses.some((dataClass) => dataClass === 'confidential')
  ) {
    factors.push(riskFactors.sensitiveData);
  }
  if (metadata.destructive) factors.push(riskFactors.destructiveAction);
  if (
    !metadata.readOnly &&
    !metadata.destructive &&
    !metadata.externalSideEffect
  ) {
    factors.push(riskFactors.writeCapableAction);
  }
  if (metadata.externalSideEffect) factors.push(riskFactors.externalSideEffect);
  if (!metadata.idempotent) factors.push(riskFactors.nonIdempotentAction);
  if (input.passport.environment === 'production') {
    factors.push(riskFactors.productionEnvironment);
  }

  return {
    factors,
    policySnapshotHash: snapshotHash(policy),
    requiredRoles: policy.approvalRoles,
  };
}

function invalidPolicyEvaluation(): RuleEvaluation {
  return {
    factors: [riskFactors.untrustedToolMetadata],
    policySnapshotHash: hashCanonicalJson({
      policyEngineVersion,
      workspacePolicy: 'invalid',
    }),
    requiredRoles: [],
  };
}

function normalizeWorkspacePolicy(
  policy: WorkspacePolicy,
): NormalizedWorkspacePolicy | null {
  if (!isRecord(policy) || !isNonEmptyString(policy.version)) return null;
  if (!isStringSet(policy.trustedToolDefinitionHashes, isHash)) return null;
  if (!isOptionalStringSet(policy.deniedToolNames)) return null;
  if (!isOptionalStringSet(policy.deniedScopes)) return null;
  if (!isOptionalStringSet(policy.restrictedDataClasses, isDataClass))
    return null;
  if (!isOptionalStringSet(policy.approvalRoles, isRole)) return null;

  return {
    version: policy.version,
    trustedToolDefinitionHashes: [...policy.trustedToolDefinitionHashes].sort(),
    deniedToolNames: [...(policy.deniedToolNames ?? [])].sort(),
    deniedScopes: [...(policy.deniedScopes ?? [])].sort(),
    restrictedDataClasses: [...(policy.restrictedDataClasses ?? [])].sort(),
    approvalRoles: [...(policy.approvalRoles ?? ['owner'])].sort(),
  };
}

function isTrustedToolMetadata(
  metadata: ToolMetadata,
  passport: ActionPassportV1,
  policy: NormalizedWorkspacePolicy,
): boolean {
  if (!isRecord(metadata)) return false;
  if (
    typeof metadata.readOnly !== 'boolean' ||
    typeof metadata.destructive !== 'boolean' ||
    typeof metadata.idempotent !== 'boolean' ||
    typeof metadata.externalSideEffect !== 'boolean'
  ) {
    return false;
  }
  if (
    metadata.readOnly &&
    (metadata.destructive || metadata.externalSideEffect)
  ) {
    return false;
  }
  if (!isStringSet(metadata.dataClasses, isDataClass)) return false;
  if (!isStringSet(metadata.declaredScopes)) return false;
  if (metadata.declaredScopes.length === 0) return false;
  if (!isHash(metadata.definitionHash)) return false;
  return (
    metadata.definitionHash === passport.toolDefinitionHash &&
    policy.trustedToolDefinitionHashes.includes(metadata.definitionHash)
  );
}

function isMatchingActor(actor: Actor, passport: ActionPassportV1): boolean {
  return isRecord(actor) && actor.pubkey === passport.agentPubkey;
}

function hasValidDelegatedAuthority(
  actor: Actor,
  passport: ActionPassportV1,
  metadata: ToolMetadata,
  now: Date,
): boolean {
  const authority = actor.delegatedAuthority;
  if (!isRecord(authority) || authority.delegatedBy !== passport.delegatedBy) {
    return false;
  }
  if (
    !isStringSet(authority.scopes) ||
    !metadata.declaredScopes.every((scope) => authority.scopes.includes(scope))
  ) {
    return false;
  }
  if (authority.expiresAt === undefined) return true;
  const expiresAt = Date.parse(authority.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt > now.getTime();
}

function isExpiredAuthority(actor: Actor, now: Date): boolean {
  const expiresAt = actor.delegatedAuthority?.expiresAt;
  return expiresAt !== undefined && Date.parse(expiresAt) <= now.getTime();
}

function hasStaleEvidence(passport: ActionPassportV1, now: Date): boolean {
  return (
    passport.evidence.length === 0 ||
    passport.evidence.some((evidence) => {
      if (evidence.expiresAt === undefined) return true;
      const expiresAt = Date.parse(evidence.expiresAt);
      return !Number.isFinite(expiresAt) || expiresAt <= now.getTime();
    })
  );
}

function isExplicitlyDenied(
  passport: ActionPassportV1,
  metadata: ToolMetadata,
  policy: NormalizedWorkspacePolicy,
): boolean {
  return (
    policy.deniedToolNames.includes(passport.toolName) ||
    metadata.declaredScopes.some((scope) => policy.deniedScopes.includes(scope))
  );
}

function snapshotHash(policy: NormalizedWorkspacePolicy): string {
  return hashCanonicalJson({ policyEngineVersion, workspacePolicy: policy });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringSet(
  value: unknown,
  predicate: (candidate: string) => boolean = isNonEmptyString,
): value is string[] {
  return (
    Array.isArray(value) &&
    value.every(
      (candidate) => typeof candidate === 'string' && predicate(candidate),
    ) &&
    new Set(value).size === value.length
  );
}

function isOptionalStringSet(
  value: unknown,
  predicate: (candidate: string) => boolean = isNonEmptyString,
): value is string[] | undefined {
  return value === undefined || isStringSet(value, predicate);
}

function isHash(value: string): boolean {
  return /^[0-9a-f]{64}$/.test(value);
}

function isNonEmptyString(value: string): boolean {
  return value.length > 0;
}

function isDataClass(value: string): value is DataClass {
  return (dataClasses as readonly string[]).includes(value);
}

function isRole(value: string): value is Role {
  return (roles as readonly string[]).includes(value);
}
