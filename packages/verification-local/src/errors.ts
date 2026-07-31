export const VerificationLocalFailureCode = {
  UNSUPPORTED_PLATFORM: 'UNSUPPORTED_PLATFORM',
  ISOLATION_UNAVAILABLE: 'ISOLATION_UNAVAILABLE',
  ISOLATION_PROFILE_MISMATCH: 'ISOLATION_PROFILE_MISMATCH',
  EXECUTABLE_IDENTITY_MISMATCH: 'EXECUTABLE_IDENTITY_MISMATCH',
  CWD_CONTAINMENT_FAILED: 'CWD_CONTAINMENT_FAILED',
  WORKSPACE_LEASE_STALE: 'WORKSPACE_LEASE_STALE',
  REQUEST_INVALID: 'REQUEST_INVALID',
  RUN_ROOT_INVALID: 'RUN_ROOT_INVALID',
} as const;
export type VerificationLocalFailureCode =
  (typeof VerificationLocalFailureCode)[keyof typeof VerificationLocalFailureCode];

export class LocalCommandRunnerError extends Error {
  public readonly code: VerificationLocalFailureCode;

  public constructor(code: VerificationLocalFailureCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'LocalCommandRunnerError';
    this.code = code;
  }
}

export class DarwinSeatbeltIsolationError extends LocalCommandRunnerError {
  public override readonly name = 'DarwinSeatbeltIsolationError';
}
