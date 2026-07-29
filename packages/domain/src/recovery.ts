import {
  attemptId,
  candidateGenerationId,
  commandId,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  nextWorkflowVersion,
  recoveryReconciliationId,
  sha256Digest,
  workflowId,
  workflowVersion,
  type AttemptId,
  type CandidateGenerationId,
  type CommandId,
  type ExecutionProfileId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type RecoveryReconciliationId,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import {
  RunStatus,
  WorkflowPhase,
  type WorkflowInstance,
  type WorkflowPhase as WorkflowPhaseType,
} from './model.js';
import { DomainInvariantError, assertWorkflowInvariant } from './workflow.js';

export const RecoveryReconciliationPurpose = {
  STARTUP: 'STARTUP',
  RESUME: 'RESUME',
} as const;
export type RecoveryReconciliationPurpose =
  (typeof RecoveryReconciliationPurpose)[keyof typeof RecoveryReconciliationPurpose];

export const RecoveryReconciliationDisposition = {
  SAFE_SAME_PHASE: 'SAFE_SAME_PHASE',
  SAFE_EARLIER_PHASE: 'SAFE_EARLIER_PHASE',
  BLOCKED: 'BLOCKED',
} as const;
export type RecoveryReconciliationDisposition =
  (typeof RecoveryReconciliationDisposition)[keyof typeof RecoveryReconciliationDisposition];

export const RecoveryReasonCode = {
  EXACT_AUTHORITY_MATCH: 'EXACT_AUTHORITY_MATCH',
  INSPECTION_UNAVAILABLE: 'INSPECTION_UNAVAILABLE',
  INSPECTOR_FAILURE: 'INSPECTOR_FAILURE',
  PROFILE_BINDING_MISSING: 'PROFILE_BINDING_MISSING',
  PROFILE_BINDING_MISMATCH: 'PROFILE_BINDING_MISMATCH',
  SOURCE_ATTEMPT_NOT_RECOVERABLE: 'SOURCE_ATTEMPT_NOT_RECOVERABLE',
  PROJECT_IDENTITY_MISMATCH: 'PROJECT_IDENTITY_MISMATCH',
  CANDIDATE_AUTHORITY_MISSING: 'CANDIDATE_AUTHORITY_MISSING',
  CANDIDATE_GENERATION_MISMATCH: 'CANDIDATE_GENERATION_MISMATCH',
  CANDIDATE_BASE_IDENTITY_MISMATCH: 'CANDIDATE_BASE_IDENTITY_MISMATCH',
  CANDIDATE_DIGEST_MISMATCH: 'CANDIDATE_DIGEST_MISMATCH',
  UNSUPPORTED_RECOVERY_PHASE: 'UNSUPPORTED_RECOVERY_PHASE',
} as const;
export type RecoveryReasonCode = (typeof RecoveryReasonCode)[keyof typeof RecoveryReasonCode];

export interface RecoveryReconciliationRecord {
  readonly id: RecoveryReconciliationId;
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly phase: WorkflowPhaseType;
  readonly inspectedWorkflowVersion: WorkflowVersion;
  readonly resultingWorkflowVersion: WorkflowVersion;
  readonly sourceAttemptId?: AttemptId;
  readonly dispatchClaimDigest?: Sha256Digest;
  readonly lastAuditSequence: number;
  readonly expectedProjectIdentity: string;
  readonly observedProjectIdentity?: string;
  readonly candidateGenerationId?: CandidateGenerationId;
  readonly candidateBaseIdentity?: string;
  readonly expectedCandidateDigest?: Sha256Digest;
  readonly observedCandidateDigest?: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
  readonly purpose: RecoveryReconciliationPurpose;
  readonly disposition: RecoveryReconciliationDisposition;
  readonly safeResumePhase?: WorkflowPhaseType;
  readonly reasonCode: RecoveryReasonCode;
  readonly observationRefs: readonly string[];
  readonly inspectorVersion: string;
  readonly recoveryPolicyVersion: string;
  readonly inspectedAt: IsoTimestamp;
  readonly reconciliationDigest: Sha256Digest;
}

export interface RecoveryWorkflowReconciled {
  readonly type: 'WORKFLOW_RECOVERY_RECONCILED';
  readonly commandId: CommandId;
  readonly workflowId: WorkflowId;
  readonly fromPhase: WorkflowPhaseType;
  readonly toPhase: WorkflowPhaseType;
  readonly fromVersion: WorkflowVersion;
  readonly toVersion: WorkflowVersion;
  readonly resultingRunStatus: typeof RunStatus.READY | typeof RunStatus.BLOCKED;
  readonly reconciliationId: RecoveryReconciliationId;
  readonly reconciliationDigest: Sha256Digest;
  readonly reason: string;
  readonly occurredAt: IsoTimestamp;
}

function own(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}

function assertNonBlank(value: string, field: string): void {
  if (value.trim().length === 0) {
    throw new DomainInvariantError(`${field} must not be blank`);
  }
}

function phaseIndex(phase: WorkflowPhaseType): number {
  return Object.values(WorkflowPhase).indexOf(phase);
}

export function assertRecoveryReconciliationInvariant(record: RecoveryReconciliationRecord): void {
  recoveryReconciliationId(record.id);
  goalId(record.goalId);
  goalRevision(record.goalRevision);
  workflowId(record.workflowId);
  workflowVersion(record.inspectedWorkflowVersion);
  workflowVersion(record.resultingWorkflowVersion);
  if (record.resultingWorkflowVersion !== nextWorkflowVersion(record.inspectedWorkflowVersion)) {
    throw new DomainInvariantError('Recovery reconciliation must advance Workflow exactly once');
  }
  if (!Object.values(WorkflowPhase).includes(record.phase)) {
    throw new DomainInvariantError('Recovery reconciliation phase is unknown');
  }
  if (record.sourceAttemptId === undefined && record.dispatchClaimDigest !== undefined) {
    throw new DomainInvariantError('Recovery dispatch identity requires a source Attempt');
  }
  if (record.sourceAttemptId !== undefined) {
    attemptId(record.sourceAttemptId);
  }
  if (record.dispatchClaimDigest !== undefined) {
    sha256Digest(record.dispatchClaimDigest);
  }
  if (!Number.isSafeInteger(record.lastAuditSequence) || record.lastAuditSequence < 1) {
    throw new DomainInvariantError('Recovery last Audit sequence must be positive');
  }
  assertNonBlank(record.expectedProjectIdentity, 'Recovery expected project identity');
  if (record.observedProjectIdentity !== undefined) {
    assertNonBlank(record.observedProjectIdentity, 'Recovery observed project identity');
  }

  const candidateFields = [
    own(record, 'candidateGenerationId'),
    own(record, 'candidateBaseIdentity'),
    own(record, 'expectedCandidateDigest'),
  ];
  if (!candidateFields.every((present) => present === candidateFields[0])) {
    throw new DomainInvariantError('Recovery expected Candidate authority must be complete');
  }
  if (record.candidateGenerationId === undefined) {
    if (record.observedCandidateDigest !== undefined) {
      throw new DomainInvariantError('Recovery observed Candidate digest has no Candidate');
    }
  } else {
    const candidateBaseIdentity = record.candidateBaseIdentity;
    const expectedCandidateDigest = record.expectedCandidateDigest;
    if (candidateBaseIdentity === undefined || expectedCandidateDigest === undefined) {
      throw new DomainInvariantError('Recovery expected Candidate authority must be complete');
    }
    candidateGenerationId(record.candidateGenerationId);
    assertNonBlank(candidateBaseIdentity, 'Recovery Candidate base identity');
    sha256Digest(expectedCandidateDigest);
    if (record.observedCandidateDigest !== undefined) {
      sha256Digest(record.observedCandidateDigest);
    }
  }

  executionProfileId(record.executionProfileId);
  sha256Digest(record.executionProfileDigest);
  if (!Object.values(RecoveryReconciliationPurpose).includes(record.purpose)) {
    throw new DomainInvariantError('Recovery reconciliation purpose is unknown');
  }
  if (!Object.values(RecoveryReconciliationDisposition).includes(record.disposition)) {
    throw new DomainInvariantError('Recovery reconciliation disposition is unknown');
  }
  if (!Object.values(RecoveryReasonCode).includes(record.reasonCode)) {
    throw new DomainInvariantError('Recovery reconciliation reason is unknown');
  }

  switch (record.disposition) {
    case RecoveryReconciliationDisposition.BLOCKED:
      if (record.safeResumePhase !== undefined) {
        throw new DomainInvariantError('Blocked recovery cannot grant a safe resume phase');
      }
      if (record.reasonCode === RecoveryReasonCode.EXACT_AUTHORITY_MATCH) {
        throw new DomainInvariantError('Blocked recovery cannot claim exact authority match');
      }
      break;
    case RecoveryReconciliationDisposition.SAFE_SAME_PHASE:
      if (
        record.safeResumePhase !== record.phase ||
        record.reasonCode !== RecoveryReasonCode.EXACT_AUTHORITY_MATCH
      ) {
        throw new DomainInvariantError('Same-phase recovery must grant the inspected phase');
      }
      break;
    case RecoveryReconciliationDisposition.SAFE_EARLIER_PHASE:
      if (
        record.safeResumePhase === undefined ||
        phaseIndex(record.safeResumePhase) < 0 ||
        phaseIndex(record.safeResumePhase) >= phaseIndex(record.phase) ||
        record.reasonCode !== RecoveryReasonCode.EXACT_AUTHORITY_MATCH
      ) {
        throw new DomainInvariantError('Earlier-phase recovery must grant a real earlier phase');
      }
      break;
  }
  if (
    record.disposition !== RecoveryReconciliationDisposition.BLOCKED &&
    (record.observedProjectIdentity !== record.expectedProjectIdentity ||
      (record.expectedCandidateDigest !== undefined &&
        record.observedCandidateDigest !== record.expectedCandidateDigest))
  ) {
    throw new DomainInvariantError('Safe recovery requires exact observed external identity');
  }
  if (record.observationRefs.length === 0) {
    throw new DomainInvariantError('Recovery reconciliation requires observation references');
  }
  const refs = new Set<string>();
  for (const ref of record.observationRefs) {
    assertNonBlank(ref, 'Recovery observation reference');
    if (refs.has(ref)) {
      throw new DomainInvariantError('Recovery observation references must be unique');
    }
    refs.add(ref);
  }
  assertNonBlank(record.inspectorVersion, 'Recovery inspector version');
  assertNonBlank(record.recoveryPolicyVersion, 'Recovery policy version');
  isoTimestamp(record.inspectedAt);
  sha256Digest(record.reconciliationDigest);
}

export type RecoveryReconciliationSemanticFields = Omit<
  RecoveryReconciliationRecord,
  'reconciliationDigest'
>;

export function recoveryReconciliationProjection(
  record: RecoveryReconciliationSemanticFields,
): unknown {
  return {
    id: record.id,
    schemaVersion: record.schemaVersion,
    goalId: record.goalId,
    goalRevision: record.goalRevision,
    workflowId: record.workflowId,
    phase: record.phase,
    inspectedWorkflowVersion: record.inspectedWorkflowVersion,
    resultingWorkflowVersion: record.resultingWorkflowVersion,
    ...(record.sourceAttemptId === undefined ? {} : { sourceAttemptId: record.sourceAttemptId }),
    ...(record.dispatchClaimDigest === undefined
      ? {}
      : { dispatchClaimDigest: record.dispatchClaimDigest }),
    lastAuditSequence: record.lastAuditSequence,
    expectedProjectIdentity: record.expectedProjectIdentity,
    ...(record.observedProjectIdentity === undefined
      ? {}
      : { observedProjectIdentity: record.observedProjectIdentity }),
    ...(record.candidateGenerationId === undefined
      ? {}
      : {
          candidateGenerationId: record.candidateGenerationId,
          candidateBaseIdentity: record.candidateBaseIdentity,
          expectedCandidateDigest: record.expectedCandidateDigest,
        }),
    ...(record.observedCandidateDigest === undefined
      ? {}
      : { observedCandidateDigest: record.observedCandidateDigest }),
    executionProfileId: record.executionProfileId,
    executionProfileDigest: record.executionProfileDigest,
    purpose: record.purpose,
    disposition: record.disposition,
    ...(record.safeResumePhase === undefined ? {} : { safeResumePhase: record.safeResumePhase }),
    reasonCode: record.reasonCode,
    observationRefs: record.observationRefs,
    inspectorVersion: record.inspectorVersion,
    recoveryPolicyVersion: record.recoveryPolicyVersion,
    inspectedAt: record.inspectedAt,
  };
}

export function planRecoveryWorkflowEvent(
  workflow: WorkflowInstance,
  record: RecoveryReconciliationRecord,
  commandIdentifier: CommandId,
): RecoveryWorkflowReconciled {
  assertWorkflowInvariant(workflow);
  assertRecoveryReconciliationInvariant(record);
  commandId(commandIdentifier);
  if (
    record.purpose !== RecoveryReconciliationPurpose.RESUME ||
    workflow.runStatus !== RunStatus.BLOCKED ||
    workflow.activeAttemptId !== undefined ||
    record.goalId !== workflow.goalId ||
    record.goalRevision !== workflow.goalRevision ||
    record.workflowId !== workflow.id ||
    record.phase !== workflow.phase ||
    record.inspectedWorkflowVersion !== workflow.version ||
    record.inspectedAt < workflow.updatedAt
  ) {
    throw new DomainInvariantError('Resume recovery does not match a blocked Workflow');
  }
  const safe = record.disposition !== RecoveryReconciliationDisposition.BLOCKED;
  const safeResumePhase = record.safeResumePhase;
  let toPhase: WorkflowPhaseType = workflow.phase;
  if (safe) {
    if (safeResumePhase === undefined) {
      throw new DomainInvariantError('Safe recovery has no granted resume phase');
    }
    toPhase = safeResumePhase;
  }
  return Object.freeze({
    type: 'WORKFLOW_RECOVERY_RECONCILED',
    commandId: commandIdentifier,
    workflowId: workflow.id,
    fromPhase: workflow.phase,
    toPhase,
    fromVersion: workflow.version,
    toVersion: record.resultingWorkflowVersion,
    resultingRunStatus: safe ? RunStatus.READY : RunStatus.BLOCKED,
    reconciliationId: record.id,
    reconciliationDigest: record.reconciliationDigest,
    reason: `RECOVERY:${record.reasonCode}`,
    occurredAt: record.inspectedAt,
  });
}

export function applyRecoveryWorkflowEvent(
  workflow: WorkflowInstance,
  event: RecoveryWorkflowReconciled,
): WorkflowInstance {
  assertWorkflowInvariant(workflow);
  if (
    workflow.runStatus !== RunStatus.BLOCKED ||
    workflow.activeAttemptId !== undefined ||
    event.workflowId !== workflow.id ||
    event.fromPhase !== workflow.phase ||
    event.fromVersion !== workflow.version ||
    event.toVersion !== nextWorkflowVersion(workflow.version) ||
    event.occurredAt < workflow.updatedAt ||
    event.reason.trim().length === 0
  ) {
    throw new DomainInvariantError('Recovery Workflow event does not match current authority');
  }
  if (
    (event.resultingRunStatus === RunStatus.BLOCKED && event.toPhase !== workflow.phase) ||
    (event.resultingRunStatus === RunStatus.READY &&
      phaseIndex(event.toPhase) > phaseIndex(workflow.phase))
  ) {
    throw new DomainInvariantError('Recovery Workflow event grants an invalid phase');
  }
  const next = Object.freeze({
    id: workflow.id,
    goalId: workflow.goalId,
    goalRevision: workflow.goalRevision,
    phase: event.toPhase,
    runStatus: event.resultingRunStatus,
    version: event.toVersion,
    ...(workflow.activeCandidateGenerationId === undefined
      ? {}
      : { activeCandidateGenerationId: workflow.activeCandidateGenerationId }),
    ...(event.resultingRunStatus === RunStatus.BLOCKED ? { suspendedReason: event.reason } : {}),
    createdAt: workflow.createdAt,
    updatedAt: event.occurredAt,
  });
  assertWorkflowInvariant(next);
  return next;
}
