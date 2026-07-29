import { statSync } from 'node:fs';
import { isAbsolute, normalize, resolve } from 'node:path';

import {
  RecoveryInspectionAvailability,
  RecoveryInspectionReasonCode,
  decodeRecoveryInspectionRequest,
  decodeRecoveryInspectionResult,
  deriveM1BaseProjectIdentity,
  type DigestProvider,
  type RecoveryInspectionRequest,
  type RecoveryInspector,
} from '@codeclosure/runtime';

function isUnavailablePathError(error: unknown): boolean {
  if (!(error instanceof Error) || !('code' in error)) {
    return false;
  }
  const code: unknown = Reflect.get(error, 'code');
  return code === 'ENOENT' || code === 'ENOTDIR';
}

function identity(request: RecoveryInspectionRequest) {
  return Object.freeze({
    schemaVersion: 1 as const,
    goalId: request.goalId,
    goalRevision: request.goalRevision,
    workflowId: request.workflowId,
    workflowVersion: request.workflowVersion,
    phase: request.phase,
    sourceAttemptId: request.sourceAttemptId,
    executionProfileId: request.executionProfileId,
    executionProfileDigest: request.executionProfileDigest,
  });
}

/**
 * M1 observes local project availability and its path-bound logical identity.
 * Candidate identity remains Runtime-owned logical authority, so this adapter
 * reports the exact expected Candidate fields instead of interpreting an ID as
 * a filesystem path.
 */
export class M1LocalRecoveryInspector implements RecoveryInspector {
  readonly #digests: DigestProvider;

  public constructor(digests: DigestProvider) {
    this.#digests = digests;
  }

  public inspect(rawRequest: RecoveryInspectionRequest): unknown {
    const request = decodeRecoveryInspectionRequest(rawRequest);
    if (
      !isAbsolute(request.projectPath) ||
      normalize(resolve(request.projectPath)) !== request.projectPath
    ) {
      throw new TypeError('Recovery project path must be normalized and absolute');
    }

    try {
      if (!statSync(request.projectPath).isDirectory()) {
        return this.unavailable(request);
      }
    } catch (error) {
      if (isUnavailablePathError(error)) {
        return this.unavailable(request);
      }
      throw error;
    }

    return decodeRecoveryInspectionResult({
      ...identity(request),
      availability: RecoveryInspectionAvailability.OBSERVED,
      reasonCode: RecoveryInspectionReasonCode.INSPECTION_COMPLETE,
      observedProjectIdentity: deriveM1BaseProjectIdentity(request.projectPath, this.#digests),
      ...(request.candidateGenerationId === undefined
        ? {}
        : {
            candidateGenerationId: request.candidateGenerationId,
            candidateBaseIdentity: request.candidateBaseIdentity,
            observedCandidateDigest: request.expectedCandidateDigest,
          }),
      observationRefs: Object.freeze(['m1-local:logical-authority-observed']),
    });
  }

  private unavailable(request: RecoveryInspectionRequest) {
    return decodeRecoveryInspectionResult({
      ...identity(request),
      availability: RecoveryInspectionAvailability.UNAVAILABLE,
      reasonCode: RecoveryInspectionReasonCode.PROJECT_UNAVAILABLE,
      observationRefs: Object.freeze(['m1-local:project-unavailable']),
    });
  }
}
