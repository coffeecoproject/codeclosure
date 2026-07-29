import { z } from 'zod';

import {
  WorkflowPhase,
  attemptId,
  candidateGenerationId,
  executionProfileId,
  goalId,
  goalRevision,
  sha256Digest,
  workflowId,
  workflowVersion,
  type AttemptId,
  type CandidateGenerationId,
  type ExecutionProfileId,
  type GoalId,
  type GoalRevision,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowPhase as WorkflowPhaseType,
  type WorkflowVersion,
} from '@codeclosure/domain';

export const RecoveryInspectionAvailability = {
  OBSERVED: 'OBSERVED',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type RecoveryInspectionAvailability =
  (typeof RecoveryInspectionAvailability)[keyof typeof RecoveryInspectionAvailability];

export const RecoveryInspectionReasonCode = {
  INSPECTION_COMPLETE: 'INSPECTION_COMPLETE',
  PROJECT_UNAVAILABLE: 'PROJECT_UNAVAILABLE',
  CANDIDATE_UNAVAILABLE: 'CANDIDATE_UNAVAILABLE',
  INSPECTOR_ERROR: 'INSPECTOR_ERROR',
} as const;
export type RecoveryInspectionReasonCode =
  (typeof RecoveryInspectionReasonCode)[keyof typeof RecoveryInspectionReasonCode];

export interface RecoveryInspectionRequest {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly phase: WorkflowPhaseType;
  readonly sourceAttemptId: AttemptId;
  readonly projectPath: string;
  readonly expectedProjectIdentity: string;
  readonly candidateGenerationId?: CandidateGenerationId;
  readonly candidateBaseIdentity?: string;
  readonly expectedCandidateDigest?: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
}

export interface RecoveryInspectionResult {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly phase: WorkflowPhaseType;
  readonly sourceAttemptId: AttemptId;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
  readonly availability: RecoveryInspectionAvailability;
  readonly reasonCode: RecoveryInspectionReasonCode;
  readonly observedProjectIdentity?: string;
  readonly candidateGenerationId?: CandidateGenerationId;
  readonly candidateBaseIdentity?: string;
  readonly observedCandidateDigest?: Sha256Digest;
  readonly observationRefs: readonly string[];
}

export interface RecoveryInspector {
  inspect(request: RecoveryInspectionRequest): unknown;
}

const inspectionRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    workflowVersion: z.number().int().positive(),
    phase: z.enum(Object.values(WorkflowPhase)),
    sourceAttemptId: z.string(),
    projectPath: z.string().min(1),
    expectedProjectIdentity: z.string().min(1),
    candidateGenerationId: z.string().optional(),
    candidateBaseIdentity: z.string().min(1).optional(),
    expectedCandidateDigest: z.string().optional(),
    executionProfileId: z.string(),
    executionProfileDigest: z.string(),
  })
  .strict();

function candidateFieldsAreComplete(value: {
  readonly candidateGenerationId?: unknown;
  readonly candidateBaseIdentity?: unknown;
  readonly expectedCandidateDigest?: unknown;
}): boolean {
  const fields = [
    value.candidateGenerationId !== undefined,
    value.candidateBaseIdentity !== undefined,
    value.expectedCandidateDigest !== undefined,
  ];
  return fields.every((present) => present === fields[0]);
}

export function decodeRecoveryInspectionRequest(value: unknown): RecoveryInspectionRequest {
  const parsed = inspectionRequestSchema.parse(value);
  if (!candidateFieldsAreComplete(parsed)) {
    throw new TypeError('Recovery inspection request Candidate authority is incomplete');
  }
  let candidateAuthority:
    | Pick<
        RecoveryInspectionRequest,
        'candidateGenerationId' | 'candidateBaseIdentity' | 'expectedCandidateDigest'
      >
    | undefined;
  if (parsed.candidateGenerationId !== undefined) {
    if (
      parsed.candidateBaseIdentity === undefined ||
      parsed.expectedCandidateDigest === undefined
    ) {
      throw new TypeError('Recovery inspection request Candidate authority is incomplete');
    }
    candidateAuthority = Object.freeze({
      candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
      candidateBaseIdentity: parsed.candidateBaseIdentity,
      expectedCandidateDigest: sha256Digest(parsed.expectedCandidateDigest),
    });
  }
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    phase: parsed.phase,
    sourceAttemptId: attemptId(parsed.sourceAttemptId),
    projectPath: parsed.projectPath,
    expectedProjectIdentity: parsed.expectedProjectIdentity,
    ...(candidateAuthority ?? {}),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
  });
}

const inspectionResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    workflowVersion: z.number().int().positive(),
    phase: z.enum(Object.values(WorkflowPhase)),
    sourceAttemptId: z.string(),
    executionProfileId: z.string(),
    executionProfileDigest: z.string(),
    availability: z.enum(Object.values(RecoveryInspectionAvailability)),
    reasonCode: z.enum(Object.values(RecoveryInspectionReasonCode)),
    observedProjectIdentity: z.string().min(1).optional(),
    candidateGenerationId: z.string().optional(),
    candidateBaseIdentity: z.string().min(1).optional(),
    observedCandidateDigest: z.string().optional(),
    observationRefs: z.array(z.string().min(1)).min(1),
  })
  .strict();

export function decodeRecoveryInspectionResult(value: unknown): RecoveryInspectionResult {
  const parsed = inspectionResultSchema.parse(value);
  if (new Set(parsed.observationRefs).size !== parsed.observationRefs.length) {
    throw new TypeError('Recovery inspection observation references must be unique');
  }
  if (
    parsed.availability === RecoveryInspectionAvailability.OBSERVED &&
    (parsed.reasonCode !== RecoveryInspectionReasonCode.INSPECTION_COMPLETE ||
      parsed.observedProjectIdentity === undefined)
  ) {
    throw new TypeError('Observed recovery inspection lacks exact project observation');
  }
  if (
    parsed.availability === RecoveryInspectionAvailability.UNAVAILABLE &&
    parsed.reasonCode === RecoveryInspectionReasonCode.INSPECTION_COMPLETE
  ) {
    throw new TypeError('Unavailable recovery inspection cannot claim completion');
  }
  const candidateFields = [
    parsed.candidateGenerationId !== undefined,
    parsed.candidateBaseIdentity !== undefined,
    parsed.observedCandidateDigest !== undefined,
  ];
  if (!candidateFields.every((present) => present === candidateFields[0])) {
    throw new TypeError('Recovery inspection Candidate observation is incomplete');
  }
  let candidateObservation:
    | Pick<
        RecoveryInspectionResult,
        'candidateGenerationId' | 'candidateBaseIdentity' | 'observedCandidateDigest'
      >
    | undefined;
  if (parsed.candidateGenerationId !== undefined) {
    if (
      parsed.candidateBaseIdentity === undefined ||
      parsed.observedCandidateDigest === undefined
    ) {
      throw new TypeError('Recovery inspection Candidate observation is incomplete');
    }
    candidateObservation = Object.freeze({
      candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
      candidateBaseIdentity: parsed.candidateBaseIdentity,
      observedCandidateDigest: sha256Digest(parsed.observedCandidateDigest),
    });
  }
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    phase: parsed.phase,
    sourceAttemptId: attemptId(parsed.sourceAttemptId),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
    availability: parsed.availability,
    reasonCode: parsed.reasonCode,
    ...(parsed.observedProjectIdentity === undefined
      ? {}
      : { observedProjectIdentity: parsed.observedProjectIdentity }),
    ...(candidateObservation ?? {}),
    observationRefs: Object.freeze([...parsed.observationRefs]),
  });
}
