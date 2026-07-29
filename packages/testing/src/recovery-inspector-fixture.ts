import {
  RecoveryInspectionAvailability,
  RecoveryInspectionReasonCode,
  decodeRecoveryInspectionRequest,
  type RecoveryInspectionRequest,
  type RecoveryInspector,
} from '@codeclosure/runtime';

export const FakeRecoveryInspectionMode = {
  EXACT: 'EXACT',
  PROJECT_MISMATCH: 'PROJECT_MISMATCH',
  CANDIDATE_MISMATCH: 'CANDIDATE_MISMATCH',
  UNAVAILABLE: 'UNAVAILABLE',
  THROW: 'THROW',
} as const;
export type FakeRecoveryInspectionMode =
  (typeof FakeRecoveryInspectionMode)[keyof typeof FakeRecoveryInspectionMode];

export class FakeRecoveryInspector implements RecoveryInspector {
  readonly #modes: readonly FakeRecoveryInspectionMode[];
  readonly #requests: RecoveryInspectionRequest[] = [];

  public constructor(modes: readonly FakeRecoveryInspectionMode[]) {
    if (modes.length === 0) {
      throw new TypeError('FakeRecoveryInspector requires at least one scripted result');
    }
    this.#modes = Object.freeze([...modes]);
  }

  public inspect(rawRequest: RecoveryInspectionRequest): unknown {
    const request = decodeRecoveryInspectionRequest(rawRequest);
    this.#requests.push(request);
    const mode = this.#modes[this.#requests.length - 1];
    if (mode === undefined) {
      throw new RangeError('FakeRecoveryInspector script is exhausted');
    }
    if (mode === FakeRecoveryInspectionMode.THROW) {
      throw new Error('scripted RecoveryInspector failure');
    }
    if (mode === FakeRecoveryInspectionMode.UNAVAILABLE) {
      return Object.freeze({
        ...this.identity(request),
        availability: RecoveryInspectionAvailability.UNAVAILABLE,
        reasonCode: RecoveryInspectionReasonCode.PROJECT_UNAVAILABLE,
        observationRefs: Object.freeze(['fake:project-unavailable']),
      });
    }
    const observedProjectIdentity =
      mode === FakeRecoveryInspectionMode.PROJECT_MISMATCH
        ? `${request.expectedProjectIdentity}:changed`
        : request.expectedProjectIdentity;
    const observedCandidateDigest =
      mode === FakeRecoveryInspectionMode.CANDIDATE_MISMATCH
        ? 'sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'
        : request.expectedCandidateDigest;
    return Object.freeze({
      ...this.identity(request),
      availability: RecoveryInspectionAvailability.OBSERVED,
      reasonCode: RecoveryInspectionReasonCode.INSPECTION_COMPLETE,
      observedProjectIdentity,
      ...(request.candidateGenerationId === undefined
        ? {}
        : {
            candidateGenerationId: request.candidateGenerationId,
            candidateBaseIdentity: request.candidateBaseIdentity,
            observedCandidateDigest,
          }),
      observationRefs: Object.freeze([`fake:${mode.toLowerCase()}`]),
    });
  }

  public requests(): readonly RecoveryInspectionRequest[] {
    return Object.freeze([...this.#requests]);
  }

  private identity(request: RecoveryInspectionRequest) {
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
}
