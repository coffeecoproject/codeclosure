import { z } from 'zod';

import {
  EvidenceProducerType,
  EvidenceResultStatus,
  candidateGenerationId,
  candidateId,
  checkSpecificationRef,
  decodeCandidateGeneration,
  decodeCheckSpecification,
  decodeEvidenceObservation,
  decodeVerificationObligation,
  evidenceId,
  fakeVerificationDetailCodeForStatus,
  goalId,
  goalRevision,
  policyBundleId,
  sha256Digest,
  verificationObligationId,
  workflowId,
  workflowVersion,
  attemptId,
  type AttemptId,
  type CandidateGeneration,
  type CandidateGenerationId,
  type CandidateId,
  type CheckSpecificationId,
  type CheckSpecification,
  type EvidenceId,
  type EvidenceResultStatus as EvidenceResultStatusType,
  type FakeVerificationObservation,
  type GoalId,
  type GoalRevision,
  type PolicyBundleId,
  type Sha256Digest,
  type VerificationObligation,
  type VerificationObligationId,
  type WorkflowId,
  type WorkflowVersion,
} from '@codeclosure/domain';

export interface CandidatePreparationRequest {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly candidateId: CandidateId;
  readonly generationId: CandidateGenerationId;
  readonly projectPath: string;
}

export interface CandidatePreparation {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly workflowId: WorkflowId;
  readonly candidateId: CandidateId;
  readonly generationId: CandidateGenerationId;
  readonly baseDigest: Sha256Digest;
}

export interface CandidateFreezeRequest {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly attemptId: AttemptId;
  readonly generation: CandidateGeneration;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
}

export interface CandidateFreezeObservation {
  readonly schemaVersion: 1;
  readonly generationId: CandidateGenerationId;
  readonly firstSourceDigest: Sha256Digest;
  readonly secondSourceDigest: Sha256Digest;
  readonly changeSetDigest: Sha256Digest;
}

export interface FrozenCandidateIntegrityRequest {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly workflowId: WorkflowId;
  readonly generation: CandidateGeneration;
}

export interface FrozenCandidateIntegrityObservation {
  readonly schemaVersion: 1;
  readonly generationId: CandidateGenerationId;
  readonly observedDigest: Sha256Digest;
}

export interface VerificationRequest {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly attemptId: AttemptId;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly candidateDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly obligation: VerificationObligation;
  readonly checkSpec: CheckSpecification;
  readonly environmentIdentity: {
    readonly schemaVersion: 1;
    readonly kind: 'M1_LOGICAL';
    readonly identity: string;
    readonly digest: Sha256Digest;
  };
}

export interface VerificationResult {
  readonly schemaVersion: 1;
  readonly resultStatus: Exclude<EvidenceResultStatusType, typeof EvidenceResultStatus.OBSERVED>;
  readonly observation: FakeVerificationObservation;
}

export const VerificationResultAdmissionFailureCode = {
  RUNNER_INVOCATION_FAILED: 'VERIFICATION_RUNNER_INVOCATION_FAILED',
  OUTPUT_MALFORMED: 'VERIFICATION_OUTPUT_MALFORMED',
  OUTPUT_TOO_LARGE: 'VERIFICATION_OUTPUT_TOO_LARGE',
  TIMEOUT_CONTRACT_VIOLATION: 'VERIFICATION_TIMEOUT_CONTRACT_VIOLATION',
} as const;
export type VerificationResultAdmissionFailureCode =
  (typeof VerificationResultAdmissionFailureCode)[keyof typeof VerificationResultAdmissionFailureCode];

export type VerificationResultAdmission =
  | { readonly status: 'ADMITTED'; readonly result: VerificationResult }
  | {
      readonly status: 'REJECTED';
      readonly failureCode: Exclude<
        VerificationResultAdmissionFailureCode,
        typeof VerificationResultAdmissionFailureCode.RUNNER_INVOCATION_FAILED
      >;
    };

export const CandidateSourceFailureCode = {
  PREPARATION_INVOCATION_FAILED: 'CANDIDATE_SOURCE_PREPARATION_INVOCATION_FAILED',
  PREPARATION_OUTPUT_MALFORMED: 'CANDIDATE_SOURCE_PREPARATION_OUTPUT_MALFORMED',
  PREPARATION_BINDING_MISMATCH: 'CANDIDATE_SOURCE_PREPARATION_BINDING_MISMATCH',
  PREPARATION_AUTHORITY_MISMATCH: 'CANDIDATE_SOURCE_PREPARATION_AUTHORITY_MISMATCH',
  FREEZE_INVOCATION_FAILED: 'CANDIDATE_SOURCE_FREEZE_INVOCATION_FAILED',
  FREEZE_OUTPUT_MALFORMED: 'CANDIDATE_SOURCE_FREEZE_OUTPUT_MALFORMED',
  FREEZE_BINDING_MISMATCH: 'CANDIDATE_SOURCE_FREEZE_BINDING_MISMATCH',
  INTEGRITY_INVOCATION_FAILED: 'CANDIDATE_SOURCE_INTEGRITY_INVOCATION_FAILED',
  INTEGRITY_OUTPUT_MALFORMED: 'CANDIDATE_SOURCE_INTEGRITY_OUTPUT_MALFORMED',
  INTEGRITY_BINDING_MISMATCH: 'CANDIDATE_SOURCE_INTEGRITY_BINDING_MISMATCH',
} as const;
export type CandidateSourceFailureCode =
  (typeof CandidateSourceFailureCode)[keyof typeof CandidateSourceFailureCode];

export interface CandidateSourcePort {
  prepare(request: CandidatePreparationRequest): unknown;
  observeFreeze(request: CandidateFreezeRequest): unknown;
  observeFrozen(request: FrozenCandidateIntegrityRequest): unknown;
}

export interface VerificationPort {
  run(request: VerificationRequest): unknown;
}

export interface CandidateEvidenceIdentityGenerator {
  nextCandidateId(): CandidateId;
  nextCandidateGenerationId(): CandidateGenerationId;
  nextCheckSpecificationId(): CheckSpecificationId;
  nextEvidenceId(): EvidenceId;
  nextVerificationObligationId(): VerificationObligationId;
}

const preparationSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    workflowId: z.string(),
    candidateId: z.string(),
    generationId: z.string(),
    baseDigest: z.string(),
  })
  .strict();

export function decodeCandidatePreparation(value: unknown): CandidatePreparation {
  const parsed = preparationSchema.parse(value);
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    workflowId: workflowId(parsed.workflowId),
    candidateId: candidateId(parsed.candidateId),
    generationId: candidateGenerationId(parsed.generationId),
    baseDigest: sha256Digest(parsed.baseDigest),
  });
}

const freezeObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    generationId: z.string(),
    firstSourceDigest: z.string(),
    secondSourceDigest: z.string(),
    changeSetDigest: z.string(),
  })
  .strict();

export function decodeCandidateFreezeObservation(value: unknown): CandidateFreezeObservation {
  const parsed = freezeObservationSchema.parse(value);
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    generationId: candidateGenerationId(parsed.generationId),
    firstSourceDigest: sha256Digest(parsed.firstSourceDigest),
    secondSourceDigest: sha256Digest(parsed.secondSourceDigest),
    changeSetDigest: sha256Digest(parsed.changeSetDigest),
  });
}

const frozenObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    generationId: z.string(),
    observedDigest: z.string(),
  })
  .strict();

export function decodeFrozenCandidateIntegrityObservation(
  value: unknown,
): FrozenCandidateIntegrityObservation {
  const parsed = frozenObservationSchema.parse(value);
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    generationId: candidateGenerationId(parsed.generationId),
    observedDigest: sha256Digest(parsed.observedDigest),
  });
}

const verificationResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    resultStatus: z.enum([
      EvidenceResultStatus.PASS,
      EvidenceResultStatus.FAIL,
      EvidenceResultStatus.RUNNER_ERROR,
      EvidenceResultStatus.TIMEOUT,
    ]),
  })
  .strict();

export function admitVerificationResult(
  rawRequest: VerificationRequest,
  value: unknown,
  elapsedMilliseconds: number,
): VerificationResultAdmission {
  const request = decodeVerificationRequest(rawRequest);
  let serialized: unknown;
  try {
    serialized = JSON.stringify(value);
  } catch {
    return Object.freeze({
      status: 'REJECTED',
      failureCode: VerificationResultAdmissionFailureCode.OUTPUT_MALFORMED,
    });
  }
  if (typeof serialized !== 'string') {
    return Object.freeze({
      status: 'REJECTED',
      failureCode: VerificationResultAdmissionFailureCode.OUTPUT_MALFORMED,
    });
  }
  if (new TextEncoder().encode(serialized).byteLength > request.checkSpec.outputLimitBytes) {
    return Object.freeze({
      status: 'REJECTED',
      failureCode: VerificationResultAdmissionFailureCode.OUTPUT_TOO_LARGE,
    });
  }

  const parsed = verificationResultSchema.safeParse(value);
  if (!parsed.success) {
    return Object.freeze({
      status: 'REJECTED',
      failureCode: VerificationResultAdmissionFailureCode.OUTPUT_MALFORMED,
    });
  }
  if (
    !Number.isSafeInteger(elapsedMilliseconds) ||
    elapsedMilliseconds < 0 ||
    (elapsedMilliseconds > request.checkSpec.timeoutMilliseconds &&
      parsed.data.resultStatus !== EvidenceResultStatus.TIMEOUT)
  ) {
    return Object.freeze({
      status: 'REJECTED',
      failureCode: VerificationResultAdmissionFailureCode.TIMEOUT_CONTRACT_VIOLATION,
    });
  }

  const observation = decodeEvidenceObservation({
    schemaVersion: 1,
    kind: 'FAKE_VERIFICATION',
    checkSpecRef: checkSpecificationRef(request.checkSpec),
    observedResult: parsed.data.resultStatus,
    detailCode: fakeVerificationDetailCodeForStatus(parsed.data.resultStatus),
  });
  if (observation.kind !== 'FAKE_VERIFICATION') {
    throw new TypeError('Verification admission constructed the wrong observation kind');
  }
  const result: VerificationResult = Object.freeze({
    schemaVersion: parsed.data.schemaVersion,
    resultStatus: parsed.data.resultStatus,
    observation,
  });
  return Object.freeze({ status: 'ADMITTED', result });
}

const verificationRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    goalId: z.string(),
    goalRevision: z.number().int().positive(),
    workflowId: z.string(),
    workflowVersion: z.number().int().positive(),
    attemptId: z.string(),
    candidateGenerationId: z.string(),
    candidateDigest: z.string(),
    policyBundleId: z.string(),
    policyBundleDigest: z.string(),
    obligation: z.unknown(),
    checkSpec: z.unknown(),
    environmentIdentity: z
      .object({
        schemaVersion: z.literal(1),
        kind: z.literal('M1_LOGICAL'),
        identity: z.string().refine((identity) => identity.trim().length > 0),
        digest: z.string(),
      })
      .strict(),
  })
  .strict();

export function decodeVerificationRequest(value: unknown): VerificationRequest {
  const parsed = verificationRequestSchema.parse(value);
  const obligation = decodeVerificationObligation(parsed.obligation);
  const checkSpec = decodeCheckSpecification(parsed.checkSpec);
  const request: VerificationRequest = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    attemptId: attemptId(parsed.attemptId),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    candidateDigest: sha256Digest(parsed.candidateDigest),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    obligation,
    checkSpec,
    environmentIdentity: Object.freeze({
      schemaVersion: parsed.environmentIdentity.schemaVersion,
      kind: parsed.environmentIdentity.kind,
      identity: parsed.environmentIdentity.identity,
      digest: sha256Digest(parsed.environmentIdentity.digest),
    }),
  });
  if (
    request.obligation.goalId !== request.goalId ||
    request.obligation.goalRevision !== request.goalRevision ||
    request.obligation.candidateGenerationId !== request.candidateGenerationId ||
    request.obligation.checkSpecRef !== `${request.checkSpec.id}@${request.checkSpec.version}` ||
    !request.checkSpec.inputRefs.includes(request.candidateGenerationId) ||
    request.checkSpec.producerType !== EvidenceProducerType.VERIFICATION_RUNNER ||
    request.environmentIdentity.identity !== `m1-logical:${request.checkSpec.cwdIdentity}`
  ) {
    throw new TypeError('Verification Request contains cross-authority bindings');
  }
  return request;
}

export function validateCandidatePreparationRequest(
  request: CandidatePreparationRequest,
): CandidatePreparationRequest {
  return Object.freeze({
    schemaVersion: z.literal(1).parse(request.schemaVersion),
    goalId: goalId(request.goalId),
    goalRevision: goalRevision(request.goalRevision),
    workflowId: workflowId(request.workflowId),
    candidateId: candidateId(request.candidateId),
    generationId: candidateGenerationId(request.generationId),
    projectPath: z
      .string()
      .refine((path) => path.trim().length > 0)
      .parse(request.projectPath),
  });
}

export function validateCandidateFreezeRequest(
  request: CandidateFreezeRequest,
): CandidateFreezeRequest {
  const generation = decodeCandidateGeneration(request.generation);
  return Object.freeze({
    schemaVersion: z.literal(1).parse(request.schemaVersion),
    goalId: goalId(request.goalId),
    goalRevision: goalRevision(request.goalRevision),
    workflowId: workflowId(request.workflowId),
    workflowVersion: workflowVersion(request.workflowVersion),
    attemptId: attemptId(request.attemptId),
    generation,
    policyBundleId: policyBundleId(request.policyBundleId),
    policyBundleDigest: sha256Digest(request.policyBundleDigest),
  });
}

export function validateFrozenCandidateIntegrityRequest(
  request: FrozenCandidateIntegrityRequest,
): FrozenCandidateIntegrityRequest {
  return Object.freeze({
    schemaVersion: z.literal(1).parse(request.schemaVersion),
    goalId: goalId(request.goalId),
    workflowId: workflowId(request.workflowId),
    generation: decodeCandidateGeneration(request.generation),
  });
}

export function validateEvidenceIdentity(value: EvidenceId): EvidenceId {
  return evidenceId(value);
}

export function validateObligationIdentity(
  value: VerificationObligationId,
): VerificationObligationId {
  return verificationObligationId(value);
}
