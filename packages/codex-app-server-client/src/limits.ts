export interface AppServerClientLimits {
  readonly initializationTimeoutMilliseconds: number;
  readonly manualCompactionTimeoutMilliseconds: number;
  readonly maximumBufferedStdoutBytes: number;
  readonly maximumCollectionEntries: number;
  readonly maximumJsonDepth: number;
  readonly maximumJsonNodes: number;
  readonly maximumObservedCompactions: number;
  readonly maximumOutgoingLineBytes: number;
  readonly maximumPendingManualCompactions: number;
  readonly maximumPendingRequests: number;
  readonly maximumProtocolLineBytes: number;
  readonly maximumServerRequests: number;
  readonly maximumStderrBytes: number;
  readonly requestTimeoutMilliseconds: number;
  readonly shutdownGraceMilliseconds: number;
  readonly shutdownKillMilliseconds: number;
}

export const defaultAppServerClientLimits: AppServerClientLimits = Object.freeze({
  initializationTimeoutMilliseconds: 30_000,
  manualCompactionTimeoutMilliseconds: 60_000,
  maximumBufferedStdoutBytes: 4 * 1024 * 1024 + 1,
  maximumCollectionEntries: 10_000,
  maximumJsonDepth: 64,
  maximumJsonNodes: 50_000,
  maximumObservedCompactions: 64,
  maximumOutgoingLineBytes: 4 * 1024 * 1024,
  maximumPendingManualCompactions: 64,
  maximumPendingRequests: 64,
  maximumProtocolLineBytes: 4 * 1024 * 1024,
  maximumServerRequests: 256,
  maximumStderrBytes: 64 * 1024,
  requestTimeoutMilliseconds: 30_000,
  shutdownGraceMilliseconds: 5_000,
  shutdownKillMilliseconds: 2_000,
});

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
}

export function appServerClientLimits(
  overrides: Partial<AppServerClientLimits> = {},
): AppServerClientLimits {
  const limits = Object.freeze({ ...defaultAppServerClientLimits, ...overrides });
  for (const [field, value] of Object.entries(limits)) {
    assertPositiveSafeInteger(value, field);
  }
  if (limits.maximumBufferedStdoutBytes < limits.maximumProtocolLineBytes) {
    throw new TypeError('maximumBufferedStdoutBytes must be at least maximumProtocolLineBytes');
  }
  return limits;
}
