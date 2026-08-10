export type DomainErrorCode =
  | 'invalid_passport'
  | 'invalid_timestamp'
  | 'invalid_unicode'
  | 'missing_identity'
  | 'non_deterministic_value'
  | 'too_large'
  | 'unknown_field';

export interface DomainError {
  code: DomainErrorCode;
  message: string;
  path?: string;
}

export type Result<T, E = DomainError> =
  { ok: true; value: T } | { ok: false; error: E };

export class DomainValidationError extends Error {
  constructor(public readonly domainError: DomainError) {
    super(domainError.message);
    this.name = 'DomainValidationError';
  }
}
