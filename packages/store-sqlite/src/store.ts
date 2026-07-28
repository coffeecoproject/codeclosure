import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { z } from 'zod';

import {
  AcceptanceOutcome,
  AttemptFailureClass,
  AttemptStatus,
  CandidateGenerationState,
  CheckSpecificationKind,
  ContextEntryKind,
  EvidenceEligibilityState,
  EvidenceKind,
  GoalStatus,
  GuardOutcome,
  RunStatus,
  WorkflowGuard,
  WorkflowPhase,
  applyAttemptEvent,
  applyCandidateEvent,
  applyEvidenceEligibilityEvent,
  applyWorkflowCancellationToAttempt,
  applyWorkflowEvent,
  acceptanceDecisionProjection,
  acceptanceInputManifestProjection,
  acceptanceDecisionId,
  attemptId,
  auditEventId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  commandId,
  contextManifestId,
  decodeContextPackage,
  decodeAcceptanceDecision,
  decodeAcceptanceInputManifest,
  decodeCandidate,
  decodeCandidateEvent,
  decodeCandidateGeneration,
  decodeCheckSpecification,
  decodeEvidenceEligibility,
  decodeEvidenceRecord,
  decodeEvidenceSet,
  decodeCloseoutRecord,
  decodePendingIssueSet,
  decodeContextManifest,
  decodeAttemptEvent,
  decodeGoalSnapshot,
  decodeWorkflowEvent,
  decodeWorkflowSnapshot,
  decodePolicyBundle,
  decodeVerificationObligation,
  decideEvidenceInvalidation,
  assertWorkflowInvariant,
  deriveGoalStatus,
  goalId,
  goalRevision,
  evidenceId,
  evidenceSetDigestProjection,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  sha256Digest,
  workflowId,
  workflowVersion,
  verificationObligationId,
  workerEventId,
  type AppliedAttemptEvent,
  type AcceptanceDecision,
  type AcceptanceDecisionId,
  type AcceptanceInputManifest,
  type Attempt,
  type AttemptEvent,
  type AttemptId,
  type AuditEventId,
  type CommandId,
  type Candidate,
  type CandidateGeneration,
  type CandidateGenerationId,
  type CheckSpecification,
  type CheckSpecificationId,
  type ContextManifest,
  type ContextManifestId,
  type EvidenceEligibility,
  type EvidenceId,
  type EvidenceRecord,
  type EvidenceSet,
  type CloseoutRecord,
  type Goal,
  type GoalId,
  type IsoTimestamp,
  type PolicyBundle,
  type PolicyBundleId,
  type Sha256Digest,
  type WorkflowEvent,
  type WorkflowId,
  type WorkflowInstance,
  type WorkflowVersion,
  type VerificationObligation,
  type VerificationObligationId,
  type WorkerEventId,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  contextManifestDigestProjection,
  compileM1AcceptanceInput,
  createAppliedStoredCommandOutcome,
  createRejectedStoredCommandOutcome,
  canonicalizeJson,
  decodeCommandTarget,
  decodeDeterministicCommandError,
  decodeJsonValue,
  decodeStoredCommandOutcome,
  decodeWorkerDispatchClaim,
  decodeWorkerEventReceipt,
  deriveContextManifestEntries,
  deriveM1BaseProjectIdentity,
  deriveM1WorkspaceIdentity,
  attemptFailureClassForKnownWorkerReasonCode,
  m1PhaseObjective,
  m1WorkerResponseContract,
  validateM1CandidateEvidencePolicy,
  verifyM1AcceptanceDecision,
  verifyEvidenceSetAuthority,
  assertStoredCommandOutcomeBinding,
  StoredCommandDisposition,
  storedCommandOutcomeToJson,
  type CommandTarget,
  type AdmittedWorkerEventReceipt,
  type AcceptanceAuthorityView,
  type AcceptanceControlStore,
  type ClaimWorkerDispatch,
  type CandidateAuthorityView,
  type CommitAcceptanceEvaluation,
  type CommitAcceptanceRepair,
  type CommitAcceptedCloseout,
  type CommitCandidateAttemptOutcome,
  type CommitCandidateIntegrityFailure,
  type CommitCandidatePreparation,
  type CommitEvidenceSetTransition,
  type CommittedCandidateAttemptOutcome,
  type CommittedAcceptanceEvaluation,
  type CommittedAcceptanceRepair,
  type CommittedAcceptedCloseout,
  type CommittedCandidateIntegrityFailure,
  type CommittedCandidatePreparation,
  type CommittedVerificationAttemptOutcome,
  type CommittedWorkflowCandidateEvent,
  type CommitVerificationAttemptOutcome,
  type CommitWorkflowCandidateEvent,
  type CommitContextBoundAttemptStart,
  type CommittedContextAttempt,
  type CommitWorkerAttemptEvent,
  type GoalWorkflowView,
  type InstallPolicyBundle,
  type InstalledPolicyBundle,
  type PolicyInstallResult,
  type RecordIgnoredWorkerEvent,
  type RecordCommandRejection,
  type StoreCommandResult,
  type WorkerDispatchClaim,
  type WorkerDispatchClaimResult,
  type WorkerEventReceipt,
  type WorkerEventStoreResult,
  verifyEvidenceRecordDigests,
} from '@codeclosure/runtime';

import {
  CommandIdConflictError,
  OptimisticConcurrencyError,
  StoreInvariantError,
} from './errors.js';
import { serializeJson } from './json.js';
import {
  applyMigrations,
  defaultMigrationsDirectory,
  type AppliedMigration,
} from './migrations.js';
import {
  decodeAttempt,
  decodeAcceptanceDecisionRow,
  decodeAcceptanceInputManifestRow,
  decodeAuditEvent,
  decodeCandidateGenerationRow,
  decodeCandidateRow,
  decodeCloseoutRow,
  decodeCheckSpecificationRow,
  decodeGoal,
  decodeContextManifestRow,
  decodePolicyBundleRow,
  decodeEvidenceEligibilityRow,
  decodeEvidenceRecordRow,
  decodeEvidenceSetRow,
  decodePendingIssueRow,
  decodeProcessedCommand,
  decodeWorkflow,
  decodeWorkerDispatchClaimRow,
  decodeWorkerEventReceiptRow,
  decodeVerificationObligationRow,
  type AuditEventRecord,
  type ProcessedCommandRecord,
} from './rows.js';

export const TransactionStep = {
  AFTER_COMMAND_CHECK: 'AFTER_COMMAND_CHECK',
  AFTER_ATTEMPT_STATE_WRITE: 'AFTER_ATTEMPT_STATE_WRITE',
  AFTER_STATE_WRITE: 'AFTER_STATE_WRITE',
  AFTER_AUDIT_APPEND: 'AFTER_AUDIT_APPEND',
  AFTER_COMMAND_RECORD: 'AFTER_COMMAND_RECORD',
  BEFORE_COMMIT: 'BEFORE_COMMIT',
} as const;
export type TransactionStep = (typeof TransactionStep)[keyof typeof TransactionStep];

export const WorkerTransactionStep = {
  AFTER_CONTEXT_MANIFEST_WRITE: 'AFTER_CONTEXT_MANIFEST_WRITE',
  AFTER_DISPATCH_CLAIM_WRITE: 'AFTER_DISPATCH_CLAIM_WRITE',
  AFTER_WORKER_RECEIPT_WRITE: 'AFTER_WORKER_RECEIPT_WRITE',
  AFTER_POLICY_AUDIT_WRITE: 'AFTER_POLICY_AUDIT_WRITE',
  AFTER_POLICY_WRITE: 'AFTER_POLICY_WRITE',
} as const;
export type WorkerTransactionStep =
  (typeof WorkerTransactionStep)[keyof typeof WorkerTransactionStep];

export const CandidateEvidenceTransactionStep = {
  AFTER_CANDIDATE_WRITE: 'AFTER_CANDIDATE_WRITE',
  AFTER_CANDIDATE_TRANSITION: 'AFTER_CANDIDATE_TRANSITION',
  AFTER_EVIDENCE_WRITE: 'AFTER_EVIDENCE_WRITE',
  AFTER_ELIGIBILITY_WRITE: 'AFTER_ELIGIBILITY_WRITE',
  AFTER_EVIDENCE_SET_WRITE: 'AFTER_EVIDENCE_SET_WRITE',
} as const;
export type CandidateEvidenceTransactionStep =
  (typeof CandidateEvidenceTransactionStep)[keyof typeof CandidateEvidenceTransactionStep];

export const AcceptanceTransactionStep = {
  AFTER_ACCEPTANCE_MANIFEST_WRITE: 'AFTER_ACCEPTANCE_MANIFEST_WRITE',
  AFTER_ACCEPTANCE_DECISION_WRITE: 'AFTER_ACCEPTANCE_DECISION_WRITE',
  AFTER_CLOSEOUT_WRITE: 'AFTER_CLOSEOUT_WRITE',
  AFTER_REPAIR_GENERATION_WRITE: 'AFTER_REPAIR_GENERATION_WRITE',
  AFTER_REPAIR_CHECK_SPECIFICATION_WRITE: 'AFTER_REPAIR_CHECK_SPECIFICATION_WRITE',
  AFTER_REPAIR_OBLIGATION_WRITE: 'AFTER_REPAIR_OBLIGATION_WRITE',
} as const;
export type AcceptanceTransactionStep =
  (typeof AcceptanceTransactionStep)[keyof typeof AcceptanceTransactionStep];

export interface SqliteControlStoreOptions {
  readonly filename: string;
  readonly migrationsDirectory?: string;
  readonly busyTimeoutMilliseconds?: number;
  readonly now?: () => IsoTimestamp;
  readonly transactionProbe?: (
    step:
      | TransactionStep
      | WorkerTransactionStep
      | CandidateEvidenceTransactionStep
      | AcceptanceTransactionStep,
  ) => void;
}

interface AuditWriteIdentity {
  readonly auditEventId: AuditEventId;
  readonly payloadDigest: Sha256Digest;
  readonly correlationId?: string;
  readonly causationId?: string;
}

const evidenceIdentifierRowsSchema = z.array(
  z
    .object({
      id: z.string(),
    })
    .strict(),
);

export interface CreateGoalWithWorkflowInput extends AuditWriteIdentity {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly workflowAuditEventId: AuditEventId;
}

export interface CommitWorkflowEventInput extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: WorkflowEvent;
  readonly attemptAuditEventId?: AuditEventId;
}

export interface CommitAttemptEventInput extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: AttemptEvent;
  readonly workflowAuditEventId: AuditEventId;
}

interface CreatedGoalAndWorkflow {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
}

interface InsertAuditInput {
  readonly id: AuditEventId;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly commandId?: CommandId;
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly payloadDigest: Sha256Digest;
  readonly occurredAt: IsoTimestamp;
}

function systemNow(): IsoTimestamp {
  return isoTimestamp(new Date().toISOString());
}

const canonicalAuthorityDigests = new CanonicalJsonSha256DigestProvider();

function normalizeFilename(filename: string): string {
  if (filename === ':memory:') {
    return filename;
  }
  if (filename.trim().length === 0) {
    throw new TypeError('SQLite filename must not be empty');
  }
  const absolute = resolve(filename);
  mkdirSync(dirname(absolute), { recursive: true });
  return absolute;
}

function validateBusyTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > 60_000) {
    throw new TypeError('busyTimeoutMilliseconds must be an integer from 0 through 60000');
  }
  return value;
}

function serializeAttemptCapabilityGrant(attempt: Attempt): string {
  const grant = attempt.capabilityGrant;
  return serializeJson({
    phase: grant.phase,
    projectRead: grant.projectRead,
    candidateAccess: grant.candidateAccess,
    runOutputScope: grant.runOutputScope,
    controlSubmission: grant.controlSubmission,
    acceptanceAccess: grant.acceptanceAccess,
    allowedActions: [...grant.allowedActions],
  });
}

function validateOptionalMetadata(value: unknown, fieldName: string): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string when present`);
  }
  return value;
}

function validateCreateGoalWithWorkflowInput(
  rawInput: CreateGoalWithWorkflowInput,
): CreateGoalWithWorkflowInput {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    commandId: commandId(rawInput.commandId),
    inputDigest: sha256Digest(rawInput.inputDigest),
    goal: decodeGoalSnapshot(rawInput.goal),
    workflow: decodeWorkflowSnapshot(rawInput.workflow),
    workflowAuditEventId: auditEventId(rawInput.workflowAuditEventId),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateCommitAttemptEventInput(
  rawInput: CommitAttemptEventInput,
): CommitAttemptEventInput {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  const input = Object.freeze({
    inputDigest: sha256Digest(rawInput.inputDigest),
    target: decodeCommandTarget(rawInput.target),
    event: decodeAttemptEvent(rawInput.event),
    workflowAuditEventId: auditEventId(rawInput.workflowAuditEventId),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
  assertKnownWorkerFailureClassification(input.event);
  return input;
}

function assertKnownWorkerFailureClassification(event: AttemptEvent): void {
  if (event.type !== 'ATTEMPT_FINISHED') {
    return;
  }
  assertKnownWorkerFailureClassificationFields(
    event.terminationReason,
    event.toStatus,
    event.failureClass,
  );
}

function assertKnownWorkerFailureClassificationFields(
  terminationReason: string | undefined,
  status: Attempt['status'],
  failureClass: Attempt['failureClass'],
): void {
  if (terminationReason === undefined) {
    return;
  }
  const expected = attemptFailureClassForKnownWorkerReasonCode(terminationReason);
  if (expected !== undefined && (status !== AttemptStatus.FAILED || failureClass !== expected)) {
    throw new StoreInvariantError(
      `Worker termination reason ${terminationReason} requires failure class ${expected}`,
    );
  }
}

function validateCommitWorkflowEventInput(
  rawInput: CommitWorkflowEventInput,
): CommitWorkflowEventInput {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    inputDigest: sha256Digest(rawInput.inputDigest),
    target: decodeCommandTarget(rawInput.target),
    event: decodeWorkflowEvent(rawInput.event),
    ...(rawInput.attemptAuditEventId === undefined
      ? {}
      : { attemptAuditEventId: auditEventId(rawInput.attemptAuditEventId) }),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateRecordCommandRejection(rawInput: RecordCommandRejection): RecordCommandRejection {
  return Object.freeze({
    commandId: commandId(rawInput.commandId),
    inputDigest: sha256Digest(rawInput.inputDigest),
    target: decodeCommandTarget(rawInput.target),
    workflowId: workflowId(rawInput.workflowId),
    observedWorkflowVersion: workflowVersion(rawInput.observedWorkflowVersion),
    error: decodeDeterministicCommandError(rawInput.error),
    completedAt: isoTimestamp(rawInput.completedAt),
  });
}

function validateCommitContextBoundAttemptStart(
  rawInput: CommitContextBoundAttemptStart,
): CommitContextBoundAttemptStart {
  const input = validateCommitAttemptEventInput(rawInput);
  const contextManifest = decodeContextManifest(rawInput.contextManifest);
  if (
    input.event.type !== 'ATTEMPT_STARTED' ||
    input.event.attempt.contextManifestId !== contextManifest.id ||
    input.event.attempt.workerSessionRef === undefined ||
    contextManifest.attemptId !== input.event.attempt.id ||
    contextManifest.workflowId !== input.event.workflowId ||
    contextManifest.workflowVersion !== input.event.toWorkflowVersion ||
    contextManifest.phase !== input.event.attempt.phase
  ) {
    throw new StoreInvariantError('Context Manifest does not bind the started Worker Attempt');
  }
  return Object.freeze({ ...input, contextManifest });
}

function validateCommitWorkerAttemptEvent(
  rawInput: CommitWorkerAttemptEvent,
): CommitWorkerAttemptEvent {
  const input = validateCommitAttemptEventInput(rawInput);
  const receipt = decodeWorkerEventReceipt(rawInput.receipt);
  if (
    receipt.disposition !== 'ADMITTED' ||
    input.event.type !== 'ATTEMPT_FINISHED' ||
    receipt.internalCommandId !== input.event.commandId ||
    receipt.workflowId !== input.event.workflowId ||
    receipt.observedWorkflowVersion !== input.event.fromWorkflowVersion ||
    receipt.attemptId !== input.event.attemptId
  ) {
    throw new StoreInvariantError('Admitted Worker Event receipt does not bind its Attempt event');
  }
  return Object.freeze({ ...input, receipt });
}

function validateIgnoredWorkerEvent(rawInput: RecordIgnoredWorkerEvent): RecordIgnoredWorkerEvent {
  const receipt = decodeWorkerEventReceipt(rawInput.receipt);
  if (receipt.disposition !== 'IGNORED') {
    throw new StoreInvariantError('Ignored Worker Event port requires an IGNORED receipt');
  }
  return Object.freeze({ receipt });
}

function validateInstallPolicyBundle(rawInput: InstallPolicyBundle): InstallPolicyBundle {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    bundle: decodePolicyBundle(rawInput.bundle),
    installedAt: isoTimestamp(rawInput.installedAt),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateClaimWorkerDispatch(rawInput: ClaimWorkerDispatch): ClaimWorkerDispatch {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    claim: decodeWorkerDispatchClaim(rawInput.claim),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateAuditIdentifiers(
  values: unknown,
  expectedLength: number,
  name: string,
): readonly AuditEventId[] {
  if (!Array.isArray(values) || values.length !== expectedLength) {
    throw new StoreInvariantError(`${name} must contain exactly ${expectedLength} audit IDs`);
  }
  const identifiers = Object.freeze(
    values.map((value) => {
      if (typeof value !== 'string') {
        throw new StoreInvariantError(`${name} contains a malformed audit ID`);
      }
      return auditEventId(value);
    }),
  );
  if (new Set(identifiers).size !== identifiers.length) {
    throw new StoreInvariantError(`${name} audit IDs must be unique`);
  }
  return identifiers;
}

function validateCommitCandidatePreparation(
  rawInput: CommitCandidatePreparation,
): CommitCandidatePreparation {
  const base = validateCommitWorkflowEventInput(rawInput);
  const candidate = decodeCandidate(rawInput.candidate);
  const generation = decodeCandidateGeneration(rawInput.generation);
  const checkSpecifications = Object.freeze(
    rawInput.checkSpecifications.map((specification) => decodeCheckSpecification(specification)),
  );
  const obligations = Object.freeze(
    rawInput.obligations.map((obligation) => decodeVerificationObligation(obligation)),
  );
  const candidateAuditEventId = auditEventId(rawInput.candidateAuditEventId);
  const generationAuditEventId = auditEventId(rawInput.generationAuditEventId);
  const checkSpecificationAuditEventIds = validateAuditIdentifiers(
    rawInput.checkSpecificationAuditEventIds,
    checkSpecifications.length,
    'Check Specification',
  );
  const obligationAuditEventIds = validateAuditIdentifiers(
    rawInput.obligationAuditEventIds,
    obligations.length,
    'Verification Obligation',
  );
  if (
    base.event.type !== 'WORKFLOW_PHASE_TRANSITIONED' ||
    base.event.toPhase !== WorkflowPhase.IMPLEMENT ||
    base.event.nextCandidateGenerationId !== generation.id ||
    candidate.id !== generation.candidateId ||
    generation.state !== CandidateGenerationState.MUTABLE ||
    generation.version !== 1
  ) {
    throw new StoreInvariantError('Candidate preparation does not bind its Workflow transition');
  }
  return Object.freeze({
    ...base,
    candidate,
    generation,
    checkSpecifications,
    obligations,
    candidateAuditEventId,
    generationAuditEventId,
    checkSpecificationAuditEventIds,
    obligationAuditEventIds,
  });
}

function validateCommitWorkflowCandidateEvent(
  rawInput: CommitWorkflowCandidateEvent,
): CommitWorkflowCandidateEvent {
  const base = validateCommitWorkflowEventInput(rawInput);
  const candidateEvent = decodeCandidateEvent(rawInput.candidateEvent);
  if (
    base.event.type !== 'WORKFLOW_PHASE_TRANSITIONED' ||
    base.event.fromPhase !== WorkflowPhase.IMPLEMENT ||
    base.event.toPhase !== WorkflowPhase.SOURCE_FREEZE ||
    base.event.commandId !== candidateEvent.commandId ||
    base.event.occurredAt !== candidateEvent.occurredAt ||
    candidateEvent.fromState !== CandidateGenerationState.MUTABLE ||
    candidateEvent.toState !== CandidateGenerationState.FREEZING
  ) {
    throw new StoreInvariantError('Candidate freeze start does not bind its Workflow transition');
  }
  return Object.freeze({
    ...base,
    candidateEvent,
    candidateAuditEventId: auditEventId(rawInput.candidateAuditEventId),
  });
}

function validateCommitCandidateIntegrityFailure(
  rawInput: CommitCandidateIntegrityFailure,
): CommitCandidateIntegrityFailure {
  const base = validateCommitWorkflowEventInput(rawInput);
  const candidateEvent = decodeCandidateEvent(rawInput.candidateEvent);
  const expectedFrozenDigest = sha256Digest(rawInput.expectedFrozenDigest);
  const observedDigest = sha256Digest(rawInput.observedDigest);
  if (
    base.event.type !== 'WORKFLOW_INTEGRITY_FAILED' ||
    base.event.commandId !== candidateEvent.commandId ||
    base.event.occurredAt !== candidateEvent.occurredAt ||
    candidateEvent.fromState !== CandidateGenerationState.FROZEN ||
    candidateEvent.toState !== CandidateGenerationState.INVALIDATED ||
    candidateEvent.reason !== 'FROZEN_CANDIDATE_DRIFT' ||
    expectedFrozenDigest === observedDigest
  ) {
    throw new StoreInvariantError('Candidate integrity failure does not bind its Workflow failure');
  }
  return Object.freeze({
    ...base,
    candidateEvent,
    expectedFrozenDigest,
    observedDigest,
    candidateAuditEventId: auditEventId(rawInput.candidateAuditEventId),
    invalidatedEvidenceAuditEventIds: Object.freeze(
      rawInput.invalidatedEvidenceAuditEventIds.map((identifier) => auditEventId(identifier)),
    ),
  });
}

function validateCommitCandidateAttemptOutcome(
  rawInput: CommitCandidateAttemptOutcome,
): CommitCandidateAttemptOutcome {
  const base = validateCommitAttemptEventInput(rawInput);
  const candidateEvent = decodeCandidateEvent(rawInput.candidateEvent);
  const evidence =
    rawInput.evidence === undefined ? undefined : decodeEvidenceRecord(rawInput.evidence);
  const initialEligibility =
    rawInput.initialEligibility === undefined
      ? undefined
      : decodeEvidenceEligibility(rawInput.initialEligibility);
  const evidenceAuditEventId =
    rawInput.evidenceAuditEventId === undefined
      ? undefined
      : auditEventId(rawInput.evidenceAuditEventId);
  if (
    base.event.type !== 'ATTEMPT_FINISHED' ||
    base.event.phase !== WorkflowPhase.SOURCE_FREEZE ||
    base.event.commandId !== candidateEvent.commandId ||
    base.event.occurredAt !== candidateEvent.occurredAt ||
    (evidence === undefined) !== (initialEligibility === undefined) ||
    (evidence === undefined) !== (evidenceAuditEventId === undefined) ||
    (evidence !== undefined && initialEligibility?.evidenceId !== evidence.id)
  ) {
    throw new StoreInvariantError('Candidate freeze outcome has inconsistent authority fields');
  }
  const isFrozenResult =
    candidateEvent.fromState === CandidateGenerationState.FREEZING &&
    candidateEvent.toState === CandidateGenerationState.FROZEN &&
    base.event.toStatus === AttemptStatus.RESULT_RECORDED &&
    evidence !== undefined;
  const isInvalidatedFailure =
    candidateEvent.toState === CandidateGenerationState.INVALIDATED &&
    base.event.toStatus === AttemptStatus.FAILED &&
    evidence === undefined;
  if (!isFrozenResult && !isInvalidatedFailure) {
    throw new StoreInvariantError('Candidate freeze outcome is not a supported lifecycle result');
  }
  return Object.freeze({
    ...base,
    candidateEvent,
    candidateAuditEventId: auditEventId(rawInput.candidateAuditEventId),
    ...(evidence === undefined ? {} : { evidence }),
    ...(initialEligibility === undefined ? {} : { initialEligibility }),
    ...(evidenceAuditEventId === undefined ? {} : { evidenceAuditEventId }),
    invalidatedEvidenceAuditEventIds: Object.freeze(
      rawInput.invalidatedEvidenceAuditEventIds.map((identifier) => auditEventId(identifier)),
    ),
  });
}

function validateCommitVerificationAttemptOutcome(
  rawInput: CommitVerificationAttemptOutcome,
): CommitVerificationAttemptOutcome {
  const base = validateCommitAttemptEventInput(rawInput);
  const obligationId = verificationObligationId(rawInput.obligationId);
  const evidence = decodeEvidenceRecord(rawInput.evidence);
  const initialEligibility = decodeEvidenceEligibility(rawInput.initialEligibility);
  if (
    base.event.type !== 'ATTEMPT_FINISHED' ||
    base.event.phase !== WorkflowPhase.EVIDENCE_BUILD ||
    base.event.toStatus !== AttemptStatus.RESULT_RECORDED ||
    evidence.attemptId !== base.event.attemptId ||
    initialEligibility.evidenceId !== evidence.id
  ) {
    throw new StoreInvariantError('Verification outcome does not bind its Attempt');
  }
  return Object.freeze({
    ...base,
    obligationId,
    evidence,
    initialEligibility,
    evidenceAuditEventId: auditEventId(rawInput.evidenceAuditEventId),
  });
}

function validateCommitEvidenceSetTransition(
  rawInput: CommitEvidenceSetTransition,
): CommitEvidenceSetTransition {
  const base = validateCommitWorkflowEventInput(rawInput);
  const evidenceSet = decodeEvidenceSet(rawInput.evidenceSet);
  if (
    base.event.type !== 'WORKFLOW_PHASE_TRANSITIONED' ||
    base.event.fromPhase !== WorkflowPhase.EVIDENCE_BUILD ||
    base.event.toPhase !== WorkflowPhase.FINAL_VERIFY
  ) {
    throw new StoreInvariantError('Evidence Set does not bind an Evidence-to-Final transition');
  }
  return Object.freeze({
    ...base,
    evidenceSet,
    evidenceSetAuditEventId: auditEventId(rawInput.evidenceSetAuditEventId),
  });
}

function validateCommitAcceptanceEvaluation(
  rawInput: CommitAcceptanceEvaluation,
): CommitAcceptanceEvaluation {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  const manifest = decodeAcceptanceInputManifest(rawInput.manifest);
  const pendingIssueSet = decodePendingIssueSet(rawInput.pendingIssueSet);
  const decision = decodeAcceptanceDecision(rawInput.decision);
  const manifestAuditEventId = auditEventId(rawInput.manifestAuditEventId);
  const decisionAuditEventId = auditEventId(rawInput.decisionAuditEventId);
  if (
    decision.inputManifestDigest !== manifest.manifestDigest ||
    decision.policyBundleDigest !== manifest.policyBundleDigest ||
    pendingIssueSet.goalId !== manifest.goalId ||
    pendingIssueSet.goalRevision !== manifest.goalRevision ||
    pendingIssueSet.digest !== manifest.pendingIssueSetDigest ||
    decision.issuedAt < manifest.createdAt ||
    manifestAuditEventId === decisionAuditEventId
  ) {
    throw new StoreInvariantError('Acceptance evaluation fields do not share one authority');
  }
  return Object.freeze({
    commandId: commandId(rawInput.commandId),
    inputDigest: sha256Digest(rawInput.inputDigest),
    target: decodeCommandTarget(rawInput.target),
    manifest,
    pendingIssueSet,
    decision,
    manifestAuditEventId,
    decisionAuditEventId,
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateCommitAcceptedCloseout(rawInput: CommitAcceptedCloseout): CommitAcceptedCloseout {
  const base = validateCommitWorkflowEventInput(rawInput);
  const candidateEvent = decodeCandidateEvent(rawInput.candidateEvent);
  const closeout = decodeCloseoutRecord(rawInput.closeout);
  if (
    base.event.type !== 'WORKFLOW_PHASE_TRANSITIONED' ||
    base.event.fromPhase !== WorkflowPhase.FINAL_VERIFY ||
    base.event.toPhase !== WorkflowPhase.CLOSEOUT ||
    base.event.commandId !== candidateEvent.commandId ||
    base.event.occurredAt !== candidateEvent.occurredAt ||
    candidateEvent.fromState !== CandidateGenerationState.FROZEN ||
    candidateEvent.toState !== CandidateGenerationState.ACCEPTED ||
    closeout.workflowId !== base.event.workflowId ||
    closeout.workflowVersion !== base.event.toVersion ||
    closeout.candidateGenerationId !== candidateEvent.candidateGenerationId ||
    closeout.closedAt !== base.event.occurredAt
  ) {
    throw new StoreInvariantError('Accepted closeout does not bind one compound transition');
  }
  return Object.freeze({
    ...base,
    candidateEvent,
    candidateAuditEventId: auditEventId(rawInput.candidateAuditEventId),
    closeout,
    closeoutAuditEventId: auditEventId(rawInput.closeoutAuditEventId),
  });
}

function validateCommitAcceptanceRepair(rawInput: CommitAcceptanceRepair): CommitAcceptanceRepair {
  const base = validateCommitWorkflowEventInput(rawInput);
  const candidate = decodeCandidate(rawInput.candidate);
  const rejectedCandidateEvent = decodeCandidateEvent(rawInput.rejectedCandidateEvent);
  const generation = decodeCandidateGeneration(rawInput.generation);
  const checkSpecifications = Object.freeze(
    rawInput.checkSpecifications.map((specification) => decodeCheckSpecification(specification)),
  );
  const obligations = Object.freeze(
    rawInput.obligations.map((obligation) => decodeVerificationObligation(obligation)),
  );
  const checkSpecificationAuditEventIds = validateAuditIdentifiers(
    rawInput.checkSpecificationAuditEventIds,
    checkSpecifications.length,
    'Repair Check Specification',
  );
  const obligationAuditEventIds = validateAuditIdentifiers(
    rawInput.obligationAuditEventIds,
    obligations.length,
    'Repair Verification Obligation',
  );
  if (
    base.event.type !== 'WORKFLOW_PHASE_TRANSITIONED' ||
    base.event.fromPhase !== WorkflowPhase.FINAL_VERIFY ||
    base.event.toPhase !== WorkflowPhase.IMPLEMENT ||
    base.event.nextCandidateGenerationId !== generation.id ||
    base.event.commandId !== rejectedCandidateEvent.commandId ||
    base.event.occurredAt !== rejectedCandidateEvent.occurredAt ||
    rejectedCandidateEvent.fromState !== CandidateGenerationState.FROZEN ||
    rejectedCandidateEvent.toState !== CandidateGenerationState.REJECTED ||
    generation.state !== CandidateGenerationState.MUTABLE ||
    generation.version !== 1 ||
    generation.parentGenerationId !== rejectedCandidateEvent.candidateGenerationId ||
    generation.candidateId !== candidate.id
  ) {
    throw new StoreInvariantError(
      'Acceptance repair does not bind one child-generation transition',
    );
  }
  return Object.freeze({
    ...base,
    acceptanceDecisionId: acceptanceDecisionId(rawInput.acceptanceDecisionId),
    acceptanceDecisionDigest: sha256Digest(rawInput.acceptanceDecisionDigest),
    inputManifestDigest: sha256Digest(rawInput.inputManifestDigest),
    candidate,
    rejectedCandidateEvent,
    generation,
    checkSpecifications,
    obligations,
    rejectedCandidateAuditEventId: auditEventId(rawInput.rejectedCandidateAuditEventId),
    generationAuditEventId: auditEventId(rawInput.generationAuditEventId),
    checkSpecificationAuditEventIds,
    obligationAuditEventIds,
  });
}

function validateAggregateLookup(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

export class SqliteControlStore implements AcceptanceControlStore {
  readonly #database: Database.Database;
  readonly #appliedMigrations: readonly AppliedMigration[];
  readonly #transactionProbe:
    | ((
        step:
          | TransactionStep
          | WorkerTransactionStep
          | CandidateEvidenceTransactionStep
          | AcceptanceTransactionStep,
      ) => void)
    | undefined;
  #closed = false;

  private constructor(
    database: Database.Database,
    appliedMigrations: readonly AppliedMigration[],
    transactionProbe:
      | ((
          step:
            | TransactionStep
            | WorkerTransactionStep
            | CandidateEvidenceTransactionStep
            | AcceptanceTransactionStep,
        ) => void)
      | undefined,
  ) {
    this.#database = database;
    this.#appliedMigrations = Object.freeze([...appliedMigrations]);
    this.#transactionProbe = transactionProbe;
  }

  public static open(options: SqliteControlStoreOptions): SqliteControlStore {
    const filename = normalizeFilename(options.filename);
    const busyTimeout = validateBusyTimeout(options.busyTimeoutMilliseconds ?? 5_000);
    const database = new Database(filename);

    try {
      database.pragma('foreign_keys = ON');
      database.pragma(`busy_timeout = ${busyTimeout}`);
      const foreignKeys = database.pragma('foreign_keys', { simple: true });
      if (foreignKeys !== 1) {
        throw new StoreInvariantError('SQLite foreign-key enforcement could not be enabled');
      }
      const journalMode = database.pragma('journal_mode = WAL', { simple: true });
      if (filename !== ':memory:' && journalMode !== 'wal') {
        throw new StoreInvariantError('SQLite WAL journal mode could not be enabled');
      }
      database.pragma('synchronous = FULL');
      const migrations = applyMigrations(
        database,
        options.migrationsDirectory ?? defaultMigrationsDirectory(),
        options.now ?? systemNow,
      );
      const store = new SqliteControlStore(database, migrations, options.transactionProbe);
      store.assertRetainedWorkerAuthorityClosure();
      store.assertRetainedCandidateEvidenceAuthorityClosure();
      store.assertRetainedAcceptanceAuthorityClosure();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  public close(): void {
    if (!this.#closed) {
      this.#database.close();
      this.#closed = true;
    }
  }

  public appliedMigrations(): readonly AppliedMigration[] {
    this.assertOpen();
    return this.#appliedMigrations;
  }

  public getGoal(rawGoalIdentifier: GoalId): Goal | undefined {
    return this.getGoalWithWorkflow(goalId(rawGoalIdentifier))?.goal;
  }

  public getGoalWithWorkflow(rawGoalIdentifier: GoalId): GoalWorkflowView | undefined {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    return this.runRead(() => {
      const row = this.#database.prepare('SELECT * FROM goals WHERE id = ?').get(goalIdentifier);
      if (row === undefined) {
        return undefined;
      }
      const criteria = this.#database
        .prepare(
          'SELECT id, description, required FROM goal_criteria WHERE goal_id = ? ORDER BY position',
        )
        .all(goalIdentifier);
      const workflowRow = this.#database
        .prepare('SELECT * FROM workflows WHERE goal_id = ?')
        .get(goalIdentifier);
      if (workflowRow === undefined) {
        throw new StoreInvariantError(`Goal ${goalIdentifier} has no Workflow`);
      }
      const goal = decodeGoal(row, criteria);
      const workflow = decodeWorkflow(workflowRow);
      if (
        workflow.goalRevision !== goal.revision ||
        goal.status !== deriveGoalStatus(workflow.runStatus)
      ) {
        throw new StoreInvariantError(
          `Goal ${goalIdentifier} does not match its Workflow lifecycle projection`,
        );
      }
      return Object.freeze({ goal, workflow });
    });
  }

  public getWorkflow(rawWorkflowIdentifier: WorkflowId): WorkflowInstance | undefined {
    this.assertOpen();
    const workflowIdentifier = workflowId(rawWorkflowIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .get(workflowIdentifier);
    return row === undefined ? undefined : decodeWorkflow(row);
  }

  public getWorkflowForGoal(rawGoalIdentifier: GoalId): WorkflowInstance | undefined {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM workflows WHERE goal_id = ?')
      .get(goalIdentifier);
    return row === undefined ? undefined : decodeWorkflow(row);
  }

  public getAttempt(rawAttemptIdentifier: AttemptId): Attempt | undefined {
    this.assertOpen();
    const attemptIdentifier = attemptId(rawAttemptIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM attempts WHERE id = ?')
      .get(attemptIdentifier);
    return row === undefined ? undefined : decodeAttempt(row);
  }

  public getContextManifest(
    rawContextManifestIdentifier: ContextManifestId,
  ): ContextManifest | undefined {
    this.assertOpen();
    const manifestIdentifier = contextManifestId(rawContextManifestIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM context_manifests WHERE id = ?')
      .get(manifestIdentifier);
    return row === undefined ? undefined : this.decodeVerifiedContextManifestRow(row);
  }

  public getCandidateForGoal(rawGoalIdentifier: GoalId): Candidate | undefined {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM candidates WHERE goal_id = ?')
      .get(goalIdentifier);
    return row === undefined ? undefined : decodeCandidateRow(row);
  }

  public getCandidateGeneration(
    rawGenerationIdentifier: CandidateGenerationId,
  ): CandidateGeneration | undefined {
    this.assertOpen();
    const generationIdentifier = candidateGenerationId(rawGenerationIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM candidate_generations WHERE id = ?')
      .get(generationIdentifier);
    return row === undefined ? undefined : decodeCandidateGenerationRow(row).generation;
  }

  public getCandidateAuthorityForWorkflow(
    rawWorkflowIdentifier: WorkflowId,
  ): CandidateAuthorityView | undefined {
    this.assertOpen();
    const workflowIdentifier = workflowId(rawWorkflowIdentifier);
    return this.runRead(() => {
      const workflow = this.getWorkflowInsideTransaction(workflowIdentifier);
      if (workflow.activeCandidateGenerationId === undefined) {
        return undefined;
      }
      const generationRow = this.#database
        .prepare('SELECT * FROM candidate_generations WHERE id = ?')
        .get(workflow.activeCandidateGenerationId);
      if (generationRow === undefined) {
        throw new StoreInvariantError(
          `Workflow ${workflow.id} has no active Candidate generation authority`,
        );
      }
      const decoded = decodeCandidateGenerationRow(generationRow);
      const candidateRow = this.#database
        .prepare('SELECT * FROM candidates WHERE id = ?')
        .get(decoded.generation.candidateId);
      if (candidateRow === undefined) {
        throw new StoreInvariantError(
          `Candidate generation ${decoded.generation.id} has no Candidate root`,
        );
      }
      const candidate = decodeCandidateRow(candidateRow);
      if (decoded.workflowId !== workflow.id || candidate.goalId !== workflow.goalId) {
        throw new StoreInvariantError(
          `Candidate generation ${decoded.generation.id} belongs to another authority`,
        );
      }
      return Object.freeze({ candidate, generation: decoded.generation, workflowId: workflow.id });
    });
  }

  public nextCandidateGenerationSequence(rawCandidateIdentifier: Candidate['id']): number {
    this.assertOpen();
    const candidateIdentifier = candidateId(rawCandidateIdentifier);
    const row = this.#database
      .prepare(
        `SELECT COALESCE(MAX(candidate_generations.sequence), 0) + 1 AS next_sequence
           FROM candidates
           LEFT JOIN candidate_generations
             ON candidate_generations.candidate_id = candidates.id
          WHERE candidates.id = ?
          GROUP BY candidates.id`,
      )
      .get(candidateIdentifier);
    if (
      typeof row !== 'object' ||
      row === null ||
      !('next_sequence' in row) ||
      typeof row.next_sequence !== 'number' ||
      !Number.isSafeInteger(row.next_sequence) ||
      row.next_sequence < 1
    ) {
      throw new StoreInvariantError(`Candidate ${candidateIdentifier} does not exist`);
    }
    return row.next_sequence;
  }

  public getCheckSpecification(
    rawCheckSpecificationIdentifier: CheckSpecificationId,
  ): CheckSpecification | undefined {
    this.assertOpen();
    const specificationIdentifier = checkSpecificationId(rawCheckSpecificationIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM check_specifications WHERE id = ?')
      .get(specificationIdentifier);
    return row === undefined ? undefined : decodeCheckSpecificationRow(row);
  }

  public listCheckSpecifications(): readonly CheckSpecification[] {
    this.assertOpen();
    return Object.freeze(
      this.#database
        .prepare('SELECT * FROM check_specifications ORDER BY id')
        .all()
        .map((row) => decodeCheckSpecificationRow(row)),
    );
  }

  public getVerificationObligation(
    rawObligationIdentifier: VerificationObligationId,
  ): VerificationObligation | undefined {
    this.assertOpen();
    const obligationIdentifier = verificationObligationId(rawObligationIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM verification_obligations WHERE id = ?')
      .get(obligationIdentifier);
    return row === undefined ? undefined : decodeVerificationObligationRow(row);
  }

  public listVerificationObligations(rawGoalIdentifier: GoalId): readonly VerificationObligation[] {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    return Object.freeze(
      this.#database
        .prepare('SELECT * FROM verification_obligations WHERE goal_id = ? ORDER BY id')
        .all(goalIdentifier)
        .map((row) => decodeVerificationObligationRow(row)),
    );
  }

  public getEvidence(rawEvidenceIdentifier: EvidenceId): EvidenceRecord | undefined {
    this.assertOpen();
    const evidenceIdentifier = evidenceId(rawEvidenceIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM evidence_records WHERE id = ?')
      .get(evidenceIdentifier);
    return row === undefined ? undefined : this.decodeVerifiedEvidenceRecordRow(row);
  }

  public getEvidenceEligibility(
    rawEvidenceIdentifier: EvidenceId,
  ): EvidenceEligibility | undefined {
    this.assertOpen();
    const evidenceIdentifier = evidenceId(rawEvidenceIdentifier);
    const row = this.#database
      .prepare(
        `SELECT * FROM evidence_eligibility
          WHERE evidence_id = ?
          ORDER BY version DESC
          LIMIT 1`,
      )
      .get(evidenceIdentifier);
    return row === undefined ? undefined : decodeEvidenceEligibilityRow(row);
  }

  public listEvidenceForGeneration(
    rawGenerationIdentifier: CandidateGenerationId,
  ): readonly { readonly record: EvidenceRecord; readonly eligibility: EvidenceEligibility }[] {
    this.assertOpen();
    const generationIdentifier = candidateGenerationId(rawGenerationIdentifier);
    const identifierRows = evidenceIdentifierRowsSchema.parse(
      this.#database
        .prepare('SELECT id FROM evidence_records WHERE candidate_generation_id = ? ORDER BY id')
        .all(generationIdentifier),
    );
    return Object.freeze(
      identifierRows.map(({ id: rawIdentifier }) => {
        const identifier = evidenceId(rawIdentifier);
        const record = this.getEvidence(identifier);
        const eligibility = this.getEvidenceEligibility(identifier);
        if (record === undefined || eligibility === undefined) {
          throw new StoreInvariantError(`Evidence ${identifier} has incomplete authority`);
        }
        return Object.freeze({ record, eligibility });
      }),
    );
  }

  public getEvidenceSet(rawDigest: Sha256Digest): EvidenceSet | undefined {
    this.assertOpen();
    const digest = sha256Digest(rawDigest);
    const row = this.#database.prepare('SELECT * FROM evidence_sets WHERE digest = ?').get(digest);
    if (row === undefined) {
      return undefined;
    }
    const set = decodeEvidenceSetRow(row);
    const expected = sha256Digest(
      canonicalAuthorityDigests.digest(evidenceSetDigestProjection(set)),
    );
    if (set.digest !== expected) {
      throw new StoreInvariantError(
        `Evidence Set ${set.digest} digest does not match its canonical projection`,
      );
    }
    this.assertRetainedEvidenceSetAuthority(set);
    return set;
  }

  public getPolicyBundle(
    rawPolicyBundleIdentifier: PolicyBundleId,
  ): InstalledPolicyBundle | undefined {
    this.assertOpen();
    const policyIdentifier = policyBundleId(rawPolicyBundleIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM policy_bundles WHERE id = ?')
      .get(policyIdentifier);
    return row === undefined ? undefined : this.decodeVerifiedPolicyBundleRow(row);
  }

  public getAcceptanceAuthorityForWorkflow(
    rawWorkflowIdentifier: WorkflowId,
    rawPolicyBundleIdentifier: PolicyBundleId,
  ): AcceptanceAuthorityView | undefined {
    this.assertOpen();
    const workflowIdentifier = workflowId(rawWorkflowIdentifier);
    const policyIdentifier = policyBundleId(rawPolicyBundleIdentifier);
    return this.runRead(() => {
      const workflow = this.getWorkflow(workflowIdentifier);
      if (workflow?.activeCandidateGenerationId === undefined) {
        return undefined;
      }
      const goal = this.getGoal(workflow.goalId);
      const candidateAuthority = this.getCandidateAuthorityForWorkflow(workflow.id);
      const installedPolicy = this.getPolicyBundle(policyIdentifier);
      if (goal === undefined || candidateAuthority === undefined || installedPolicy === undefined) {
        return undefined;
      }
      const relatedSpecifications = this.listCheckSpecifications().filter((specification) =>
        specification.inputRefs.includes(candidateAuthority.generation.id),
      );
      const freezeCheck = relatedSpecifications.find(
        (specification) => specification.kind === CheckSpecificationKind.CANDIDATE_FREEZE,
      );
      const verificationCheck = relatedSpecifications.find(
        (specification) => specification.kind === CheckSpecificationKind.FAKE_VERIFICATION,
      );
      const obligations = this.listVerificationObligations(goal.id).filter(
        (obligation) =>
          obligation.goalRevision === goal.revision &&
          obligation.candidateGenerationId === candidateAuthority.generation.id,
      );
      const setRows = this.#database
        .prepare(
          `SELECT * FROM evidence_sets
            WHERE goal_id = ?
              AND goal_revision = ?
              AND candidate_generation_id = ?
              AND candidate_digest = ?
            ORDER BY digest`,
        )
        .all(
          goal.id,
          goal.revision,
          candidateAuthority.generation.id,
          candidateAuthority.generation.frozenDigest ?? '',
        );
      if (
        relatedSpecifications.length !== 2 ||
        freezeCheck === undefined ||
        verificationCheck === undefined ||
        setRows.length !== 1
      ) {
        return undefined;
      }
      const decodedSet = decodeEvidenceSetRow(setRows[0]);
      const evidenceSet = this.getEvidenceSet(decodedSet.digest);
      if (evidenceSet === undefined) {
        throw new StoreInvariantError(`Evidence Set ${decodedSet.digest} disappeared`);
      }
      const currentEvidence = Object.freeze(
        evidenceSet.evidenceRefs.map((reference) => {
          const record = this.getEvidence(reference.evidenceId);
          const eligibility = this.getEvidenceEligibility(reference.evidenceId);
          if (record === undefined || eligibility === undefined) {
            throw new StoreInvariantError(
              `Acceptance Evidence ${reference.evidenceId} has incomplete current authority`,
            );
          }
          return Object.freeze({ record, eligibility });
        }),
      );
      const pendingIssues = Object.freeze(
        this.#database
          .prepare(
            `SELECT * FROM pending_issues
              WHERE goal_id = ? AND goal_revision = ?
              ORDER BY id`,
          )
          .all(goal.id, goal.revision)
          .map((row) => decodePendingIssueRow(row)),
      );
      const retainedFactCount = this.readCount(
        'SELECT COUNT(*) AS count FROM facts WHERE goal_id = ?',
        goal.id,
      );
      const retainedDecisionCount = this.readCount(
        'SELECT COUNT(*) AS count FROM human_decisions WHERE goal_id = ?',
        goal.id,
      );
      return Object.freeze({
        goal,
        workflow,
        candidate: candidateAuthority.candidate,
        generation: candidateAuthority.generation,
        freezeCheck,
        verificationCheck,
        obligations: Object.freeze(obligations),
        evidenceSet,
        currentEvidence,
        pendingIssues,
        retainedFactCount,
        retainedDecisionCount,
        policyBundle: installedPolicy.bundle,
      });
    });
  }

  public getAcceptanceInputManifest(
    rawManifestDigest: Sha256Digest,
  ): AcceptanceInputManifest | undefined {
    this.assertOpen();
    const manifestDigest = sha256Digest(rawManifestDigest);
    const row = this.#database
      .prepare('SELECT * FROM acceptance_input_manifests WHERE manifest_digest = ?')
      .get(manifestDigest);
    if (row === undefined) {
      return undefined;
    }
    const manifest = decodeAcceptanceInputManifestRow(row);
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(acceptanceInputManifestProjection(manifest)),
    );
    if (manifest.manifestDigest !== expectedDigest) {
      throw new StoreInvariantError(
        `Acceptance Input Manifest ${manifest.manifestDigest} has a false digest`,
      );
    }
    return manifest;
  }

  public getAcceptanceDecision(
    rawDecisionIdentifier: AcceptanceDecisionId,
  ): AcceptanceDecision | undefined {
    this.assertOpen();
    const decisionIdentifier = acceptanceDecisionId(rawDecisionIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM acceptance_decisions WHERE id = ?')
      .get(decisionIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const decision = decodeAcceptanceDecisionRow(row);
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(acceptanceDecisionProjection(decision)),
    );
    if (decision.decisionDigest !== expectedDigest) {
      throw new StoreInvariantError(`Acceptance Decision ${decision.id} has a false digest`);
    }
    return decision;
  }

  public getCloseoutForWorkflow(rawWorkflowIdentifier: WorkflowId): CloseoutRecord | undefined {
    this.assertOpen();
    const workflowIdentifier = workflowId(rawWorkflowIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM workflow_closeouts WHERE workflow_id = ?')
      .get(workflowIdentifier);
    return row === undefined ? undefined : decodeCloseoutRow(row);
  }

  public getWorkerDispatchClaim(rawAttemptIdentifier: AttemptId): WorkerDispatchClaim | undefined {
    this.assertOpen();
    const attemptIdentifier = attemptId(rawAttemptIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM worker_dispatch_claims WHERE attempt_id = ?')
      .get(attemptIdentifier);
    return row === undefined ? undefined : decodeWorkerDispatchClaimRow(row);
  }

  public getWorkerEventReceipt(
    rawWorkerEventIdentifier: WorkerEventId,
  ): WorkerEventReceipt | undefined {
    this.assertOpen();
    const eventIdentifier = workerEventId(rawWorkerEventIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM worker_event_receipts WHERE event_id = ?')
      .get(eventIdentifier);
    return row === undefined ? undefined : decodeWorkerEventReceiptRow(row);
  }

  public nextAttemptSequence(rawWorkflowIdentifier: WorkflowId): number {
    this.assertOpen();
    return this.nextAttemptSequenceInsideTransaction(workflowId(rawWorkflowIdentifier));
  }

  public getProcessedCommand(rawCommandIdentifier: CommandId): ProcessedCommandRecord | undefined {
    this.assertOpen();
    const commandIdentifier = commandId(rawCommandIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM processed_commands WHERE command_id = ?')
      .get(commandIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const record = decodeProcessedCommand(row);
    this.validateProcessedCommandRecord(record);
    return record;
  }

  public listAuditEvents(
    rawAggregateType: string,
    rawAggregateId: string,
  ): readonly AuditEventRecord[] {
    this.assertOpen();
    const aggregateType = validateAggregateLookup(rawAggregateType, 'aggregateType');
    const aggregateId = validateAggregateLookup(rawAggregateId, 'aggregateId');
    return Object.freeze(
      this.#database
        .prepare(
          `SELECT id, sequence, aggregate_type, aggregate_id, event_type, actor_type,
                  command_id, before_version, after_version, correlation_id, causation_id,
                  payload_digest, occurred_at
             FROM audit_events
            WHERE aggregate_type = ? AND aggregate_id = ?
            ORDER BY sequence`,
        )
        .all(aggregateType, aggregateId)
        .map((row) => decodeAuditEvent(row)),
    );
  }

  public installPolicyBundle(rawInput: InstallPolicyBundle): PolicyInstallResult {
    this.assertOpen();
    const input = validateInstallPolicyBundle(rawInput);
    const expectedDigest = this.policyDigest(input.bundle);
    if (input.bundle.digest !== expectedDigest || input.payloadDigest !== expectedDigest) {
      throw new StoreInvariantError('Policy Bundle digest does not match its canonical projection');
    }
    const canonicalContent = canonicalizeJson(policyBundleProjection(input.bundle));
    const checkerIdentities = canonicalizeJson(input.bundle.checkerVersions);

    return this.runImmediate(() => {
      const existingRow = this.#database
        .prepare('SELECT * FROM policy_bundles WHERE id = ? OR bundle_digest = ?')
        .get(input.bundle.id, input.bundle.digest);
      if (existingRow !== undefined) {
        const existing = this.decodeVerifiedPolicyBundleRow(existingRow);
        const same =
          existing.bundle.id === input.bundle.id &&
          existing.bundle.digest === input.bundle.digest &&
          canonicalizeJson(policyBundleProjection(existing.bundle)) === canonicalContent;
        return same
          ? { status: 'EXISTING', value: existing }
          : {
              status: 'POLICY_CONFLICT',
              message: `Policy ${input.bundle.id} conflicts with installed authority`,
            };
      }

      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'POLICY',
        aggregateId: input.bundle.id,
        eventType: 'POLICY_BUNDLE_INSTALLED',
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: expectedDigest,
        occurredAt: input.installedAt,
      });
      this.probe(WorkerTransactionStep.AFTER_POLICY_AUDIT_WRITE);
      this.#database
        .prepare(
          `INSERT INTO policy_bundles(
             id, schema_version, policy_version, checker_identities_json,
             canonical_content_json, bundle_digest, installed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.bundle.id,
          input.bundle.schemaVersion,
          input.bundle.version,
          checkerIdentities,
          canonicalContent,
          input.bundle.digest,
          input.installedAt,
        );
      this.probe(WorkerTransactionStep.AFTER_POLICY_WRITE);
      const installed = this.getPolicyBundle(input.bundle.id);
      if (installed === undefined) {
        throw new StoreInvariantError(`Policy ${input.bundle.id} was not persisted readably`);
      }
      this.assertAuditEventsReadable([input.auditEventId]);
      return { status: 'INSTALLED', value: installed };
    });
  }

  public claimWorkerDispatch(rawInput: ClaimWorkerDispatch): WorkerDispatchClaimResult {
    this.assertOpen();
    const input = validateClaimWorkerDispatch(rawInput);
    const { claim } = input;
    return this.runImmediate(() => {
      const existingRow = this.#database
        .prepare(
          'SELECT * FROM worker_dispatch_claims WHERE attempt_id = ? OR context_manifest_id = ?',
        )
        .get(claim.attemptId, claim.contextManifestId);
      if (existingRow !== undefined) {
        const existing = decodeWorkerDispatchClaimRow(existingRow);
        const same =
          existing.attemptId === claim.attemptId &&
          existing.workflowId === claim.workflowId &&
          existing.workflowVersion === claim.workflowVersion &&
          existing.workerSessionId === claim.workerSessionId &&
          existing.contextManifestId === claim.contextManifestId &&
          existing.contextManifestDigest === claim.contextManifestDigest &&
          existing.packageDigest === claim.packageDigest;
        return same
          ? { status: 'EXISTING', value: existing }
          : {
              status: 'DISPATCH_CONFLICT',
              message: `Attempt ${claim.attemptId} already has another dispatch claim`,
            };
      }

      const workflow = this.getWorkflowInsideTransaction(claim.workflowId);
      if (workflow.version !== claim.workflowVersion) {
        return {
          status: 'VERSION_CONFLICT',
          message: `Workflow ${claim.workflowId} changed before Worker dispatch`,
        };
      }
      const attempt = this.getAttemptInsideTransaction(claim.attemptId);
      const manifest = this.getContextManifest(claim.contextManifestId);
      if (
        workflow.runStatus !== RunStatus.RUNNING ||
        workflow.activeAttemptId !== attempt.id ||
        attempt.status !== AttemptStatus.RUNNING ||
        attempt.workflowId !== workflow.id ||
        attempt.contextManifestId !== claim.contextManifestId ||
        attempt.workerSessionRef !== claim.workerSessionId ||
        manifest?.workflowId !== workflow.id ||
        manifest.workflowVersion !== workflow.version ||
        manifest.attemptId !== attempt.id ||
        manifest.manifestDigest !== claim.contextManifestDigest ||
        manifest.packageDigest !== claim.packageDigest ||
        claim.claimedAt < workflow.updatedAt
      ) {
        return {
          status: 'NOT_ELIGIBLE',
          message: `Attempt ${claim.attemptId} is not eligible for Worker dispatch`,
        };
      }

      this.#database
        .prepare(
          `INSERT INTO worker_dispatch_claims(
             attempt_id, schema_version, workflow_id, workflow_version, worker_session_id,
             context_manifest_id, context_manifest_digest, package_digest, claimed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          claim.attemptId,
          claim.schemaVersion,
          claim.workflowId,
          claim.workflowVersion,
          claim.workerSessionId,
          claim.contextManifestId,
          claim.contextManifestDigest,
          claim.packageDigest,
          claim.claimedAt,
        );
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'ATTEMPT',
        aggregateId: claim.attemptId,
        eventType: 'WORKER_DISPATCH_CLAIMED',
        beforeVersion: claim.workflowVersion,
        afterVersion: claim.workflowVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: claim.claimedAt,
      });
      this.probe(WorkerTransactionStep.AFTER_DISPATCH_CLAIM_WRITE);
      const persisted = this.getWorkerDispatchClaim(claim.attemptId);
      if (persisted === undefined) {
        throw new StoreInvariantError(`Dispatch claim for ${claim.attemptId} was not readable`);
      }
      this.assertAuditEventsReadable([input.auditEventId]);
      return { status: 'CLAIMED', value: persisted };
    });
  }

  public createGoalWithWorkflow(
    rawInput: CreateGoalWithWorkflowInput,
  ): StoreCommandResult<CreatedGoalAndWorkflow> {
    this.assertOpen();
    const input = validateCreateGoalWithWorkflowInput(rawInput);
    this.validateInitialGoalAndWorkflow(input.goal, input.workflow);
    const target = Object.freeze({ aggregateType: 'GOAL' as const, aggregateId: input.goal.id });
    const allowedPaths = serializeJson(input.goal.scope.allowedPaths);
    const nonGoals = serializeJson(input.goal.nonGoals);

    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(input.commandId, input.inputDigest, 'GOAL', input.goal.id);
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      this.#database
        .prepare(
          `INSERT INTO goals(
             id, revision, objective, project_path, allowed_paths_json, non_goals_json,
             status, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.goal.id,
          input.goal.revision,
          input.goal.objective,
          input.goal.scope.projectPath,
          allowedPaths,
          nonGoals,
          input.goal.status,
          input.goal.createdAt,
          input.goal.updatedAt,
        );
      const insertCriterion = this.#database.prepare(
        `INSERT INTO goal_criteria(goal_id, position, id, description, required)
         VALUES (?, ?, ?, ?, ?)`,
      );
      input.goal.successCriteria.forEach((criterion, position) => {
        insertCriterion.run(
          input.goal.id,
          position,
          criterion.id,
          criterion.description,
          criterion.required ? 1 : 0,
        );
      });
      this.#database
        .prepare(
          `INSERT INTO workflows(
             id, goal_id, goal_revision, phase, run_status, version, active_attempt_id,
             active_candidate_generation_id, suspended_reason, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.workflow.id,
          input.workflow.goalId,
          input.workflow.goalRevision,
          input.workflow.phase,
          input.workflow.runStatus,
          input.workflow.version,
          input.workflow.activeAttemptId ?? null,
          input.workflow.activeCandidateGenerationId ?? null,
          input.workflow.suspendedReason ?? null,
          input.workflow.createdAt,
          input.workflow.updatedAt,
        );
      this.probe(TransactionStep.AFTER_STATE_WRITE);

      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'GOAL',
        aggregateId: input.goal.id,
        eventType: 'GOAL_CREATED',
        commandId: input.commandId,
        afterVersion: input.goal.revision,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.goal.createdAt,
      });
      this.insertAuditEvent({
        id: input.workflowAuditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: input.workflow.id,
        eventType: 'WORKFLOW_CREATED',
        commandId: input.commandId,
        afterVersion: input.workflow.version,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.workflow.createdAt,
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(target, input.workflow, input.commandId),
      );
      this.insertProcessedCommand(
        input.commandId,
        input.inputDigest,
        'GOAL',
        input.goal.id,
        serializeJson(outcome),
        input.goal.createdAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persisted = this.getGoalWithWorkflow(input.goal.id);
      if (persisted === undefined) {
        throw new StoreInvariantError('New Goal and Workflow could not be read before commit');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.commandId,
        input.inputDigest,
        target,
        input.goal.id,
        input.workflow.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([input.auditEventId, input.workflowAuditEventId]);

      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: persisted,
      };
    });
  }

  public commitAttemptEvent(
    rawInput: CommitAttemptEventInput,
  ): StoreCommandResult<AppliedAttemptEvent> {
    this.assertOpen();
    const input = validateCommitAttemptEventInput(rawInput);
    if (
      input.event.type === 'ATTEMPT_FINISHED' &&
      input.event.toStatus !== AttemptStatus.INTERRUPTED &&
      (input.event.phase === WorkflowPhase.SOURCE_FREEZE ||
        (input.event.phase === WorkflowPhase.EVIDENCE_BUILD &&
          (input.event.toStatus !== AttemptStatus.FAILED ||
            input.event.failureClass !== AttemptFailureClass.PROTOCOL_ERROR)))
    ) {
      throw new StoreInvariantError(
        'Candidate freeze and successful verification Attempts require their compound authority commit',
      );
    }
    return this.runCommandImmediate(() => this.commitAttemptEventInsideTransaction(input));
  }

  public commitContextBoundAttemptStart(
    rawInput: CommitContextBoundAttemptStart,
  ): StoreCommandResult<CommittedContextAttempt> {
    this.assertOpen();
    const input = validateCommitContextBoundAttemptStart(rawInput);
    return this.runCommandImmediate(() => {
      const result = this.commitAttemptEventInsideTransaction(input);
      if (result.status === 'REPLAYED') {
        const existing = this.getContextManifest(input.contextManifest.id);
        if (existing?.attemptId !== input.contextManifest.attemptId) {
          throw new StoreInvariantError(
            `Replayed Attempt ${input.contextManifest.attemptId} has no bound Context Manifest`,
          );
        }
        return result;
      }
      if (result.status !== 'APPLIED') {
        return result;
      }

      this.insertContextManifest(input.contextManifest);
      this.probe(WorkerTransactionStep.AFTER_CONTEXT_MANIFEST_WRITE);
      const persistedManifest = this.getContextManifest(input.contextManifest.id);
      if (
        persistedManifest?.attemptId !== result.value.attempt.id ||
        persistedManifest.workflowId !== result.value.workflow.id ||
        persistedManifest.workflowVersion !== result.value.workflow.version
      ) {
        throw new StoreInvariantError('Context Manifest did not round-trip with its Attempt');
      }
      return {
        status: 'APPLIED',
        outcome: result.outcome,
        value: Object.freeze({
          ...result.value,
          contextManifest: persistedManifest,
        }),
      };
    });
  }

  public commitWorkerAttemptEvent(
    rawInput: CommitWorkerAttemptEvent,
  ): WorkerEventStoreResult<AppliedAttemptEvent> {
    this.assertOpen();
    const input = validateCommitWorkerAttemptEvent(rawInput);
    return this.runWorkerEventImmediate(() => {
      const existing = this.checkWorkerEvent(input.receipt);
      if (existing !== undefined) {
        return existing.status === 'MATCH'
          ? { status: 'REPLAYED', receipt: existing.receipt }
          : {
              status: 'WORKER_EVENT_CONFLICT',
              message: `Worker Event ${input.receipt.eventId} was reused with different payload`,
            };
      }

      this.assertAdmittedWorkerEventHasDispatchClaim(input.receipt);
      const result = this.commitAttemptEventInsideTransaction(input);
      if (result.status === 'REPLAYED' || result.status === 'COMMAND_CONFLICT') {
        return {
          status: 'WORKER_EVENT_CONFLICT',
          message: `Internal command ${input.receipt.internalCommandId} is already in use`,
        };
      }
      if (result.status === 'VERSION_CONFLICT') {
        return result;
      }

      this.insertWorkerEventReceipt(input.receipt);
      this.probe(WorkerTransactionStep.AFTER_WORKER_RECEIPT_WRITE);
      const persisted = this.getWorkerEventReceipt(input.receipt.eventId);
      if (persisted?.disposition !== 'ADMITTED') {
        throw new StoreInvariantError(
          `Admitted Worker Event ${input.receipt.eventId} was not persisted readably`,
        );
      }
      return { status: 'APPLIED', receipt: persisted, value: result.value };
    });
  }

  public recordIgnoredWorkerEvent(
    rawInput: RecordIgnoredWorkerEvent,
  ): WorkerEventStoreResult<undefined> {
    this.assertOpen();
    const input = validateIgnoredWorkerEvent(rawInput);
    return this.runWorkerEventImmediate(() => {
      const existing = this.checkWorkerEvent(input.receipt);
      if (existing !== undefined) {
        return existing.status === 'MATCH'
          ? { status: 'REPLAYED', receipt: existing.receipt }
          : {
              status: 'WORKER_EVENT_CONFLICT',
              message: `Worker Event ${input.receipt.eventId} was reused with different payload`,
            };
      }
      this.assertWorkerEventHasDispatchCausality(input.receipt);
      const workflow = this.getWorkflowInsideTransaction(input.receipt.workflowId);
      if (workflow.version !== input.receipt.observedWorkflowVersion) {
        return {
          status: 'VERSION_CONFLICT',
          message: `Workflow ${workflow.id} changed before ignored Worker Event was recorded`,
        };
      }
      if (input.receipt.receivedAt < workflow.updatedAt) {
        throw new StoreInvariantError('Ignored Worker Event receipt predates Workflow authority');
      }
      this.insertWorkerEventReceipt(input.receipt);
      this.probe(WorkerTransactionStep.AFTER_WORKER_RECEIPT_WRITE);
      const persisted = this.getWorkerEventReceipt(input.receipt.eventId);
      if (persisted?.disposition !== 'IGNORED') {
        throw new StoreInvariantError(
          `Ignored Worker Event ${input.receipt.eventId} was not persisted readably`,
        );
      }
      return { status: 'APPLIED', receipt: persisted, value: undefined };
    });
  }

  private commitAttemptEventInsideTransaction(
    input: CommitAttemptEventInput,
  ): StoreCommandResult<AppliedAttemptEvent> {
    const attemptIdentifier =
      input.event.type === 'ATTEMPT_STARTED' ? input.event.attempt.id : input.event.attemptId;

    const replay = this.checkCommand(
      input.event.commandId,
      input.inputDigest,
      input.target.aggregateType,
      input.target.aggregateId,
    );
    if (replay !== undefined) {
      return { status: 'REPLAYED', outcome: replay.outcome };
    }
    this.probe(TransactionStep.AFTER_COMMAND_CHECK);

    const currentWorkflow = this.getWorkflowInsideTransaction(input.event.workflowId);
    this.validateCommandTarget(input.target, currentWorkflow);
    if (
      input.target.aggregateType === 'GOAL' &&
      (input.event.type !== 'ATTEMPT_STARTED' || input.event.attempt.sequence !== 1)
    ) {
      throw new StoreInvariantError(
        'A Goal-targeted Attempt command may only start the first Attempt',
      );
    }
    if (currentWorkflow.version !== input.event.fromWorkflowVersion) {
      throw new OptimisticConcurrencyError('Workflow', input.event.workflowId);
    }
    const currentAttempt =
      input.event.type === 'ATTEMPT_STARTED'
        ? currentWorkflow.activeAttemptId === undefined
          ? undefined
          : this.getAttemptInsideTransaction(currentWorkflow.activeAttemptId)
        : this.getAttemptInsideTransaction(input.event.attemptId);
    if (input.event.type !== 'ATTEMPT_STARTED') {
      this.assertAttemptControlEventAfterDispatchClaim(
        currentAttempt,
        input.event.workflowId,
        input.event.fromWorkflowVersion,
        input.event.occurredAt,
      );
    }
    const applied = applyAttemptEvent(currentWorkflow, currentAttempt, input.event);

    if (input.event.type === 'ATTEMPT_STARTED') {
      const expectedSequence = this.nextAttemptSequenceInsideTransaction(input.event.workflowId);
      if (input.event.attempt.sequence !== expectedSequence) {
        throw new StoreInvariantError(
          `Attempt sequence must be ${expectedSequence} for ${input.event.workflowId}`,
        );
      }
      this.#database
        .prepare(
          `INSERT INTO attempts(
               id, workflow_id, phase, sequence, context_manifest_id,
               capability_grant_json, worker_session_ref, status, failure_class,
               termination_reason, started_at, ended_at
             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          applied.attempt.id,
          applied.attempt.workflowId,
          applied.attempt.phase,
          applied.attempt.sequence,
          applied.attempt.contextManifestId ?? null,
          serializeAttemptCapabilityGrant(applied.attempt),
          applied.attempt.workerSessionRef ?? null,
          applied.attempt.status,
          null,
          null,
          applied.attempt.startedAt,
          null,
        );
    } else {
      const updateAttempt = this.#database
        .prepare(
          `UPDATE attempts
                SET status = ?, failure_class = ?, termination_reason = ?, ended_at = ?
              WHERE id = ? AND workflow_id = ? AND status = ?`,
        )
        .run(
          applied.attempt.status,
          applied.attempt.failureClass ?? null,
          applied.attempt.terminationReason ?? null,
          applied.attempt.endedAt ?? null,
          applied.attempt.id,
          applied.attempt.workflowId,
          AttemptStatus.RUNNING,
        );
      if (updateAttempt.changes !== 1) {
        throw new OptimisticConcurrencyError('Attempt', applied.attempt.id);
      }
    }

    this.probe(TransactionStep.AFTER_ATTEMPT_STATE_WRITE);
    this.updateWorkflow(currentWorkflow, applied.workflow);
    this.probe(TransactionStep.AFTER_STATE_WRITE);

    this.insertAuditEvent({
      id: input.auditEventId,
      aggregateType: 'ATTEMPT',
      aggregateId: attemptIdentifier,
      eventType: input.event.type,
      commandId: input.event.commandId,
      beforeVersion: input.event.fromWorkflowVersion,
      afterVersion: input.event.toWorkflowVersion,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      payloadDigest: input.payloadDigest,
      occurredAt: input.event.occurredAt,
    });
    this.insertAuditEvent({
      id: input.workflowAuditEventId,
      aggregateType: 'WORKFLOW',
      aggregateId: input.event.workflowId,
      eventType:
        input.event.type === 'ATTEMPT_STARTED'
          ? 'WORKFLOW_ATTEMPT_STARTED'
          : 'WORKFLOW_ATTEMPT_FINISHED',
      commandId: input.event.commandId,
      beforeVersion: input.event.fromWorkflowVersion,
      afterVersion: input.event.toWorkflowVersion,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      payloadDigest: input.payloadDigest,
      occurredAt: input.event.occurredAt,
    });
    this.probe(TransactionStep.AFTER_AUDIT_APPEND);

    const outcome = storedCommandOutcomeToJson(
      createAppliedStoredCommandOutcome(input.target, applied.workflow, input.event.commandId),
    );
    this.insertProcessedCommand(
      input.event.commandId,
      input.inputDigest,
      input.target.aggregateType,
      input.target.aggregateId,
      serializeJson(outcome),
      input.event.occurredAt,
    );
    this.probe(TransactionStep.AFTER_COMMAND_RECORD);
    this.probe(TransactionStep.BEFORE_COMMIT);

    const persistedWorkflow = this.getWorkflowInsideTransaction(applied.workflow.id);
    const persistedAttempt = this.getAttemptInsideTransaction(applied.attempt.id);
    const persistedCommand = this.assertProcessedCommandReadable(
      input.event.commandId,
      input.inputDigest,
      input.target,
      applied.workflow.goalId,
      applied.workflow.id,
      StoredCommandDisposition.APPLIED,
    );
    this.assertAuditEventsReadable([input.auditEventId, input.workflowAuditEventId]);

    return {
      status: 'APPLIED',
      outcome: persistedCommand.outcome,
      value: Object.freeze({ workflow: persistedWorkflow, attempt: persistedAttempt }),
    };
  }

  public commitWorkflowEvent(
    rawInput: CommitWorkflowEventInput,
  ): StoreCommandResult<WorkflowInstance> {
    this.assertOpen();
    const input = validateCommitWorkflowEventInput(rawInput);
    if (
      input.event.type === 'WORKFLOW_INTEGRITY_FAILED' ||
      (input.event.type === 'WORKFLOW_PHASE_TRANSITIONED' &&
        ((input.event.fromPhase === WorkflowPhase.PLAN &&
          input.event.toPhase === WorkflowPhase.IMPLEMENT) ||
          (input.event.fromPhase === WorkflowPhase.IMPLEMENT &&
            input.event.toPhase === WorkflowPhase.SOURCE_FREEZE) ||
          (input.event.fromPhase === WorkflowPhase.EVIDENCE_BUILD &&
            input.event.toPhase === WorkflowPhase.FINAL_VERIFY) ||
          (input.event.fromPhase === WorkflowPhase.FINAL_VERIFY &&
            (input.event.toPhase === WorkflowPhase.IMPLEMENT ||
              input.event.toPhase === WorkflowPhase.CLOSEOUT))))
    ) {
      throw new StoreInvariantError(
        'Authority-bearing Workflow events require their owning compound commit',
      );
    }

    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, current);
      if (input.target.aggregateType === 'GOAL' && input.event.type !== 'WORKFLOW_CANCELLED') {
        throw new StoreInvariantError(
          'A Goal-targeted Workflow command may only cancel its Workflow',
        );
      }
      if (current.version !== input.event.fromVersion) {
        throw new OptimisticConcurrencyError('Workflow', input.event.workflowId);
      }
      if (
        input.event.type === 'WORKFLOW_PHASE_TRANSITIONED' &&
        input.event.fromPhase === WorkflowPhase.SOURCE_FREEZE &&
        input.event.toPhase === WorkflowPhase.EVIDENCE_BUILD
      ) {
        this.assertFrozenCandidateTransitionAuthority(current, input.event);
      }
      let next: WorkflowInstance;
      let interruptedAttempt: Attempt | undefined;
      if (input.event.type === 'WORKFLOW_CANCELLED') {
        if (input.event.interruptedAttemptId === undefined) {
          if (input.attemptAuditEventId !== undefined) {
            throw new StoreInvariantError(
              'Cancellation without an active Attempt cannot write an Attempt audit event',
            );
          }
          next = applyWorkflowCancellationToAttempt(current, undefined, input.event).workflow;
        } else {
          if (input.attemptAuditEventId === undefined) {
            throw new StoreInvariantError(
              'Cancellation with an active Attempt requires an Attempt audit event ID',
            );
          }
          const currentAttempt = this.getAttemptInsideTransaction(input.event.interruptedAttemptId);
          this.assertAttemptControlEventAfterDispatchClaim(
            currentAttempt,
            input.event.workflowId,
            input.event.fromVersion,
            input.event.occurredAt,
          );
          const applied = applyWorkflowCancellationToAttempt(current, currentAttempt, input.event);
          if (applied.attempt === undefined) {
            throw new StoreInvariantError('Cancellation failed to interrupt its active Attempt');
          }
          interruptedAttempt = applied.attempt;
          next = applied.workflow;
          const updateAttempt = this.#database
            .prepare(
              `UPDATE attempts
                  SET status = ?, failure_class = NULL, termination_reason = ?, ended_at = ?
                WHERE id = ? AND workflow_id = ? AND status = ?`,
            )
            .run(
              interruptedAttempt.status,
              interruptedAttempt.terminationReason ?? null,
              interruptedAttempt.endedAt ?? null,
              interruptedAttempt.id,
              interruptedAttempt.workflowId,
              AttemptStatus.RUNNING,
            );
          if (updateAttempt.changes !== 1) {
            throw new OptimisticConcurrencyError('Attempt', interruptedAttempt.id);
          }
          this.probe(TransactionStep.AFTER_ATTEMPT_STATE_WRITE);
        }
      } else {
        if (input.attemptAuditEventId !== undefined) {
          throw new StoreInvariantError(
            'Only Workflow cancellation may include an Attempt audit event ID',
          );
        }
        next = applyWorkflowEvent(current, input.event);
      }
      this.updateWorkflow(current, next);
      this.probe(TransactionStep.AFTER_STATE_WRITE);

      if (interruptedAttempt !== undefined && input.attemptAuditEventId !== undefined) {
        this.insertAuditEvent({
          id: input.attemptAuditEventId,
          aggregateType: 'ATTEMPT',
          aggregateId: interruptedAttempt.id,
          eventType: 'ATTEMPT_INTERRUPTED_BY_WORKFLOW_CANCELLATION',
          commandId: input.event.commandId,
          beforeVersion: input.event.fromVersion,
          afterVersion: input.event.toVersion,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          payloadDigest: input.payloadDigest,
          occurredAt: input.event.occurredAt,
        });
      }
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: input.event.workflowId,
        eventType: input.event.type,
        commandId: input.event.commandId,
        beforeVersion: input.event.fromVersion,
        afterVersion: input.event.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, next, input.event.commandId),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedWorkflow = this.getWorkflowInsideTransaction(next.id);
      if (interruptedAttempt !== undefined) {
        this.getAttemptInsideTransaction(interruptedAttempt.id);
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        next.goalId,
        next.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.auditEventId,
        ...(input.attemptAuditEventId === undefined ? [] : [input.attemptAuditEventId]),
      ]);

      return { status: 'APPLIED', outcome: persistedCommand.outcome, value: persistedWorkflow };
    });
  }

  public commitCandidatePreparation(
    rawInput: CommitCandidatePreparation,
  ): StoreCommandResult<CommittedCandidatePreparation> {
    this.assertOpen();
    const input = validateCommitCandidatePreparation(rawInput);
    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, current);
      if (current.version !== input.event.fromVersion) {
        throw new OptimisticConcurrencyError('Workflow', current.id);
      }
      const next = applyWorkflowEvent(current, input.event);
      if (
        input.candidate.goalId !== current.goalId ||
        next.activeCandidateGenerationId !== input.generation.id ||
        input.generation.createdAt !== input.event.occurredAt ||
        input.generation.updatedAt !== input.event.occurredAt
      ) {
        throw new StoreInvariantError('Prepared Candidate does not bind the resulting Workflow');
      }
      if (input.checkSpecifications.length !== 2) {
        throw new StoreInvariantError('Candidate preparation requires exactly two M1 Checks');
      }
      const goal = this.getGoal(current.goalId);
      const freeze = input.checkSpecifications[0];
      const verification = input.checkSpecifications[1];
      if (goal === undefined || freeze === undefined || verification === undefined) {
        throw new StoreInvariantError('Candidate preparation lacks its M1 policy authority');
      }
      if (
        input.candidate.baseProjectIdentity !==
          deriveM1BaseProjectIdentity(goal.scope.projectPath, canonicalAuthorityDigests) ||
        input.generation.workspaceIdentity !== deriveM1WorkspaceIdentity(input.generation.id)
      ) {
        throw new StoreInvariantError('Candidate preparation contains non-canonical M1 identities');
      }
      validateM1CandidateEvidencePolicy(
        goal,
        input.generation,
        { freeze, verification, obligations: input.obligations },
        input.event.occurredAt,
      );
      const expectedPayloadDigest = sha256Digest(
        canonicalAuthorityDigests.digest({
          event: input.event,
          candidate: input.candidate,
          generation: input.generation,
          checkSpecifications: input.checkSpecifications,
          obligations: input.obligations,
        }),
      );
      if (input.payloadDigest !== expectedPayloadDigest) {
        throw new StoreInvariantError(
          'Candidate preparation audit digest does not bind its compound authority',
        );
      }

      const expectedSequence = this.nextCandidateSequenceForPreparation(input.candidate.id);
      if (input.generation.sequence !== expectedSequence) {
        throw new StoreInvariantError(`Candidate generation sequence must be ${expectedSequence}`);
      }
      const existingCandidate = this.getCandidateForGoal(current.goalId);
      if (
        existingCandidate !== undefined &&
        (existingCandidate.id !== input.candidate.id ||
          existingCandidate.baseProjectIdentity !== input.candidate.baseProjectIdentity)
      ) {
        throw new StoreInvariantError('Goal already has another Candidate root authority');
      }

      this.insertAuditEvent({
        id: input.candidateAuditEventId,
        aggregateType: 'CANDIDATE',
        aggregateId: input.candidate.id,
        eventType:
          existingCandidate === undefined ? 'CANDIDATE_CREATED' : 'CANDIDATE_REUSED_FOR_GENERATION',
        commandId: input.event.commandId,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      if (existingCandidate === undefined) {
        this.#database
          .prepare('INSERT INTO candidates(id, goal_id, base_project_identity) VALUES (?, ?, ?)')
          .run(input.candidate.id, input.candidate.goalId, input.candidate.baseProjectIdentity);
      }

      this.insertAuditEvent({
        id: input.generationAuditEventId,
        aggregateType: 'CANDIDATE_GENERATION',
        aggregateId: input.generation.id,
        eventType: 'CANDIDATE_GENERATION_CREATED',
        commandId: input.event.commandId,
        afterVersion: input.generation.version,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.insertCandidateGeneration(input.generation, current.id);

      const specificationRefs = new Set<string>();
      input.checkSpecifications.forEach((specification, index) => {
        const specificationRef = `${specification.id}@${specification.version}`;
        if (specificationRefs.has(specificationRef)) {
          throw new StoreInvariantError('Prepared Check Specifications must be unique');
        }
        specificationRefs.add(specificationRef);
        const auditIdentifier = input.checkSpecificationAuditEventIds[index];
        if (auditIdentifier === undefined) {
          throw new StoreInvariantError('Check Specification audit identity is missing');
        }
        this.insertAuditEvent({
          id: auditIdentifier,
          aggregateType: 'CHECK_SPECIFICATION',
          aggregateId: specification.id,
          eventType: 'CHECK_SPECIFICATION_RECORDED',
          commandId: input.event.commandId,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          payloadDigest: input.payloadDigest,
          occurredAt: input.event.occurredAt,
        });
        this.#database
          .prepare(
            `INSERT INTO check_specifications(id, version, canonical_json)
             VALUES (?, ?, ?)`,
          )
          .run(
            specification.id,
            specification.version,
            serializeJson(decodeJsonValue(specification)),
          );
      });

      input.obligations.forEach((obligation, index) => {
        if (
          obligation.goalId !== current.goalId ||
          obligation.goalRevision !== current.goalRevision ||
          obligation.candidateGenerationId !== input.generation.id ||
          obligation.createdAt !== input.event.occurredAt ||
          !specificationRefs.has(obligation.checkSpecRef)
        ) {
          throw new StoreInvariantError(
            `Verification Obligation ${obligation.id} has stale preparation authority`,
          );
        }
        const auditIdentifier = input.obligationAuditEventIds[index];
        if (auditIdentifier === undefined) {
          throw new StoreInvariantError('Verification Obligation audit identity is missing');
        }
        this.insertAuditEvent({
          id: auditIdentifier,
          aggregateType: 'VERIFICATION_OBLIGATION',
          aggregateId: obligation.id,
          eventType: 'VERIFICATION_OBLIGATION_RECORDED',
          commandId: input.event.commandId,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          payloadDigest: input.payloadDigest,
          occurredAt: input.event.occurredAt,
        });
        this.insertVerificationObligation(obligation);
      });
      this.probe(CandidateEvidenceTransactionStep.AFTER_CANDIDATE_WRITE);

      this.updateWorkflow(current, next);
      this.probe(TransactionStep.AFTER_STATE_WRITE);
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: input.event.workflowId,
        eventType: input.event.type,
        commandId: input.event.commandId,
        beforeVersion: input.event.fromVersion,
        afterVersion: input.event.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, next, input.event.commandId),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedWorkflow = this.getWorkflowInsideTransaction(next.id);
      const authority = this.getCandidateAuthorityForWorkflow(next.id);
      if (authority?.generation.id !== input.generation.id) {
        throw new StoreInvariantError('Prepared Candidate authority did not round-trip');
      }
      const specifications = Object.freeze(
        input.checkSpecifications.map((specification) => {
          const persisted = this.getCheckSpecification(specification.id);
          if (persisted === undefined) {
            throw new StoreInvariantError(
              `Check Specification ${specification.id} did not round-trip`,
            );
          }
          return persisted;
        }),
      );
      const obligations = Object.freeze(
        input.obligations.map((obligation) => {
          const persisted = this.getVerificationObligation(obligation.id);
          if (persisted === undefined) {
            throw new StoreInvariantError(
              `Verification Obligation ${obligation.id} did not round-trip`,
            );
          }
          return persisted;
        }),
      );
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        next.goalId,
        next.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.auditEventId,
        input.candidateAuditEventId,
        input.generationAuditEventId,
        ...input.checkSpecificationAuditEventIds,
        ...input.obligationAuditEventIds,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          workflow: persistedWorkflow,
          authority,
          checkSpecifications: specifications,
          obligations,
        }),
      };
    });
  }

  public commitWorkflowCandidateEvent(
    rawInput: CommitWorkflowCandidateEvent,
  ): StoreCommandResult<CommittedWorkflowCandidateEvent> {
    this.assertOpen();
    const input = validateCommitWorkflowCandidateEvent(rawInput);
    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, current);
      if (current.version !== input.event.fromVersion) {
        throw new OptimisticConcurrencyError('Workflow', current.id);
      }
      const authority = this.getCandidateAuthorityForWorkflow(current.id);
      if (
        authority?.generation.id !== input.candidateEvent.candidateGenerationId ||
        authority.generation.version !== input.candidateEvent.fromVersion
      ) {
        throw new StoreInvariantError('Candidate transition does not target current authority');
      }
      if (
        input.payloadDigest !==
        sha256Digest(
          canonicalAuthorityDigests.digest({
            event: input.event,
            candidateEvent: input.candidateEvent,
          }),
        )
      ) {
        throw new StoreInvariantError('Candidate transition audit digest is incomplete');
      }
      const nextWorkflow = applyWorkflowEvent(current, input.event);
      const nextGeneration = applyCandidateEvent(authority.generation, input.candidateEvent);

      this.insertAuditEvent({
        id: input.candidateAuditEventId,
        aggregateType: 'CANDIDATE_GENERATION',
        aggregateId: nextGeneration.id,
        eventType: input.candidateEvent.type,
        commandId: input.event.commandId,
        beforeVersion: input.candidateEvent.fromVersion,
        afterVersion: input.candidateEvent.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.updateCandidateGeneration(authority.generation, nextGeneration);
      this.probe(CandidateEvidenceTransactionStep.AFTER_CANDIDATE_TRANSITION);
      this.updateWorkflow(current, nextWorkflow);
      this.probe(TransactionStep.AFTER_STATE_WRITE);

      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: input.event.workflowId,
        eventType: input.event.type,
        commandId: input.event.commandId,
        beforeVersion: input.event.fromVersion,
        afterVersion: input.event.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, nextWorkflow, input.event.commandId),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedWorkflow = this.getWorkflowInsideTransaction(nextWorkflow.id);
      const persistedAuthority = this.getCandidateAuthorityForWorkflow(nextWorkflow.id);
      if (persistedAuthority?.generation.state !== CandidateGenerationState.FREEZING) {
        throw new StoreInvariantError('Candidate freeze start did not round-trip');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        nextWorkflow.goalId,
        nextWorkflow.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([input.auditEventId, input.candidateAuditEventId]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({ workflow: persistedWorkflow, authority: persistedAuthority }),
      };
    });
  }

  public commitCandidateIntegrityFailure(
    rawInput: CommitCandidateIntegrityFailure,
  ): StoreCommandResult<CommittedCandidateIntegrityFailure> {
    this.assertOpen();
    const input = validateCommitCandidateIntegrityFailure(rawInput);
    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, current);
      if (current.version !== input.event.fromVersion) {
        throw new OptimisticConcurrencyError('Workflow', current.id);
      }
      const authority = this.getCandidateAuthorityForWorkflow(current.id);
      if (
        authority?.generation.id !== input.candidateEvent.candidateGenerationId ||
        authority.generation.version !== input.candidateEvent.fromVersion ||
        authority.generation.frozenDigest !== input.expectedFrozenDigest
      ) {
        throw new StoreInvariantError('Integrity failure targets stale Candidate authority');
      }
      const expectedPayloadDigest = sha256Digest(
        canonicalAuthorityDigests.digest({
          event: input.event,
          candidateEvent: input.candidateEvent,
          expectedFrozenDigest: input.expectedFrozenDigest,
          observedDigest: input.observedDigest,
        }),
      );
      if (input.payloadDigest !== expectedPayloadDigest) {
        throw new StoreInvariantError(
          'Candidate integrity audit digest does not bind its source observation',
        );
      }
      const nextWorkflow = applyWorkflowEvent(current, input.event);
      const nextGeneration = applyCandidateEvent(authority.generation, input.candidateEvent);
      const eligibleEvidence = this.listEvidenceForGeneration(authority.generation.id).filter(
        ({ eligibility }) => eligibility.state === EvidenceEligibilityState.ELIGIBLE,
      );
      if (input.invalidatedEvidenceAuditEventIds.length !== eligibleEvidence.length) {
        throw new StoreInvariantError(
          'Integrity failure requires one audit identity per eligible Evidence record',
        );
      }

      this.insertAuditEvent({
        id: input.candidateAuditEventId,
        aggregateType: 'CANDIDATE_GENERATION',
        aggregateId: nextGeneration.id,
        eventType: input.candidateEvent.type,
        commandId: input.event.commandId,
        beforeVersion: input.candidateEvent.fromVersion,
        afterVersion: input.candidateEvent.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.updateCandidateGeneration(authority.generation, nextGeneration);
      this.probe(CandidateEvidenceTransactionStep.AFTER_CANDIDATE_TRANSITION);

      const invalidatedEvidence = eligibleEvidence.map(({ eligibility }, index) => {
        const auditIdentifier = input.invalidatedEvidenceAuditEventIds[index];
        if (auditIdentifier === undefined) {
          throw new StoreInvariantError('Evidence invalidation audit identity is missing');
        }
        const event = decideEvidenceInvalidation(eligibility, {
          commandId: input.event.commandId,
          expectedVersion: eligibility.version,
          reasonCode: 'FROZEN_CANDIDATE_DRIFT',
          sourceRef: nextGeneration.id,
          occurredAt: input.event.occurredAt,
        });
        const next = applyEvidenceEligibilityEvent(eligibility, event);
        this.insertAuditEvent({
          id: auditIdentifier,
          aggregateType: 'EVIDENCE',
          aggregateId: eligibility.evidenceId,
          eventType: event.type,
          commandId: input.event.commandId,
          beforeVersion: event.fromVersion,
          afterVersion: event.toVersion,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          payloadDigest: input.payloadDigest,
          occurredAt: event.occurredAt,
        });
        this.insertEvidenceEligibility(next);
        return next;
      });
      this.probe(CandidateEvidenceTransactionStep.AFTER_ELIGIBILITY_WRITE);

      this.updateWorkflow(current, nextWorkflow);
      this.probe(TransactionStep.AFTER_STATE_WRITE);
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: input.event.workflowId,
        eventType: input.event.type,
        commandId: input.event.commandId,
        beforeVersion: input.event.fromVersion,
        afterVersion: input.event.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, nextWorkflow, input.event.commandId),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedWorkflow = this.getWorkflowInsideTransaction(nextWorkflow.id);
      const persistedAuthority = this.getCandidateAuthorityForWorkflow(nextWorkflow.id);
      if (persistedAuthority?.generation.state !== CandidateGenerationState.INVALIDATED) {
        throw new StoreInvariantError('Candidate integrity failure did not round-trip');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        nextWorkflow.goalId,
        nextWorkflow.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.auditEventId,
        input.candidateAuditEventId,
        ...input.invalidatedEvidenceAuditEventIds,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          workflow: persistedWorkflow,
          authority: persistedAuthority,
          invalidatedEvidence: Object.freeze(invalidatedEvidence),
        }),
      };
    });
  }

  public commitCandidateAttemptOutcome(
    rawInput: CommitCandidateAttemptOutcome,
  ): StoreCommandResult<CommittedCandidateAttemptOutcome> {
    this.assertOpen();
    const input = validateCommitCandidateAttemptOutcome(rawInput);
    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const currentWorkflow = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, currentWorkflow);
      if (currentWorkflow.version !== input.event.fromWorkflowVersion) {
        throw new OptimisticConcurrencyError('Workflow', currentWorkflow.id);
      }
      if (input.event.type !== 'ATTEMPT_FINISHED') {
        throw new StoreInvariantError('Candidate outcome requires an Attempt finish event');
      }
      const currentAttempt = this.getAttemptInsideTransaction(input.event.attemptId);
      const authority = this.getCandidateAuthorityForWorkflow(currentWorkflow.id);
      if (
        authority?.generation.id !== input.candidateEvent.candidateGenerationId ||
        authority.generation.version !== input.candidateEvent.fromVersion
      ) {
        throw new StoreInvariantError('Freeze outcome does not target current Candidate authority');
      }
      const appliedAttempt = applyAttemptEvent(currentWorkflow, currentAttempt, input.event);
      const nextGeneration = applyCandidateEvent(authority.generation, input.candidateEvent);
      const expectedPayloadDigest = sha256Digest(
        canonicalAuthorityDigests.digest({
          event: input.event,
          candidateEvent: input.candidateEvent,
          ...(input.evidence === undefined
            ? {}
            : { evidenceRecordDigest: input.evidence.recordDigest }),
        }),
      );
      if (input.payloadDigest !== expectedPayloadDigest) {
        throw new StoreInvariantError('Candidate outcome audit digest is incomplete');
      }

      const eligibleEvidence = this.listEvidenceForGeneration(authority.generation.id).filter(
        ({ eligibility }) => eligibility.state === EvidenceEligibilityState.ELIGIBLE,
      );
      if (
        nextGeneration.state === CandidateGenerationState.INVALIDATED &&
        input.invalidatedEvidenceAuditEventIds.length !== eligibleEvidence.length
      ) {
        throw new StoreInvariantError(
          'Candidate invalidation requires one audit identity per eligible Evidence record',
        );
      }
      if (
        nextGeneration.state !== CandidateGenerationState.INVALIDATED &&
        input.invalidatedEvidenceAuditEventIds.length !== 0
      ) {
        throw new StoreInvariantError('Stable Candidate freeze cannot invalidate Evidence');
      }

      this.insertAuditEvent({
        id: input.candidateAuditEventId,
        aggregateType: 'CANDIDATE_GENERATION',
        aggregateId: nextGeneration.id,
        eventType: input.candidateEvent.type,
        commandId: input.event.commandId,
        beforeVersion: input.candidateEvent.fromVersion,
        afterVersion: input.candidateEvent.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.updateCandidateGeneration(authority.generation, nextGeneration);
      this.probe(CandidateEvidenceTransactionStep.AFTER_CANDIDATE_TRANSITION);

      let persistedEvidence: EvidenceRecord | undefined;
      let persistedEligibility: EvidenceEligibility | undefined;
      if (
        input.evidence !== undefined &&
        input.initialEligibility !== undefined &&
        input.evidenceAuditEventId !== undefined
      ) {
        const evidence = verifyEvidenceRecordDigests(input.evidence, canonicalAuthorityDigests);
        this.assertEvidenceAdmissionAuthority(
          evidence,
          input.initialEligibility,
          appliedAttempt.attempt,
          appliedAttempt.workflow,
          nextGeneration,
        );
        this.insertAuditEvent({
          id: input.evidenceAuditEventId,
          aggregateType: 'EVIDENCE',
          aggregateId: evidence.id,
          eventType: 'EVIDENCE_RECORDED_ELIGIBLE',
          commandId: input.event.commandId,
          afterVersion: input.initialEligibility.version,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          payloadDigest: evidence.recordDigest,
          occurredAt: evidence.recordedAt,
        });
        this.insertEvidenceRecord(evidence);
        this.probe(CandidateEvidenceTransactionStep.AFTER_EVIDENCE_WRITE);
        this.insertEvidenceEligibility(input.initialEligibility);
        this.probe(CandidateEvidenceTransactionStep.AFTER_ELIGIBILITY_WRITE);
      }

      const invalidatedEvidence: EvidenceEligibility[] = [];
      eligibleEvidence.forEach(({ eligibility }, index) => {
        const auditIdentifier = input.invalidatedEvidenceAuditEventIds[index];
        if (auditIdentifier === undefined) {
          throw new StoreInvariantError('Evidence invalidation audit identity is missing');
        }
        const event = decideEvidenceInvalidation(eligibility, {
          commandId: input.event.commandId,
          expectedVersion: eligibility.version,
          reasonCode: 'CANDIDATE_INVALIDATED',
          sourceRef: nextGeneration.id,
          occurredAt: input.event.occurredAt,
        });
        const nextEligibility = applyEvidenceEligibilityEvent(eligibility, event);
        this.insertAuditEvent({
          id: auditIdentifier,
          aggregateType: 'EVIDENCE',
          aggregateId: eligibility.evidenceId,
          eventType: event.type,
          commandId: input.event.commandId,
          beforeVersion: event.fromVersion,
          afterVersion: event.toVersion,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          payloadDigest: input.payloadDigest,
          occurredAt: event.occurredAt,
        });
        this.insertEvidenceEligibility(nextEligibility);
        invalidatedEvidence.push(nextEligibility);
      });
      if (invalidatedEvidence.length > 0) {
        this.probe(CandidateEvidenceTransactionStep.AFTER_ELIGIBILITY_WRITE);
      }

      this.updateTerminalAttempt(currentAttempt, appliedAttempt.attempt);
      this.probe(TransactionStep.AFTER_ATTEMPT_STATE_WRITE);
      this.updateWorkflow(currentWorkflow, appliedAttempt.workflow);
      this.probe(TransactionStep.AFTER_STATE_WRITE);
      this.insertAttemptAndWorkflowAudits(input, appliedAttempt);
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      if (input.evidence !== undefined) {
        persistedEvidence = this.getEvidence(input.evidence.id);
        persistedEligibility = this.getEvidenceEligibility(input.evidence.id);
        if (persistedEvidence === undefined || persistedEligibility === undefined) {
          throw new StoreInvariantError(`Freeze Evidence ${input.evidence.id} did not round-trip`);
        }
      }

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(
          input.target,
          appliedAttempt.workflow,
          input.event.commandId,
        ),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedWorkflow = this.getWorkflowInsideTransaction(appliedAttempt.workflow.id);
      const persistedAttempt = this.getAttemptInsideTransaction(appliedAttempt.attempt.id);
      const persistedAuthority = this.getCandidateAuthorityForWorkflow(persistedWorkflow.id);
      if (persistedAuthority?.generation.id !== nextGeneration.id) {
        throw new StoreInvariantError('Candidate freeze outcome did not round-trip');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        appliedAttempt.workflow.goalId,
        appliedAttempt.workflow.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.auditEventId,
        input.workflowAuditEventId,
        input.candidateAuditEventId,
        ...(input.evidenceAuditEventId === undefined ? [] : [input.evidenceAuditEventId]),
        ...input.invalidatedEvidenceAuditEventIds,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          workflow: persistedWorkflow,
          attempt: persistedAttempt,
          authority: persistedAuthority,
          ...(persistedEvidence === undefined ? {} : { evidence: persistedEvidence }),
          ...(persistedEligibility === undefined ? {} : { eligibility: persistedEligibility }),
          invalidatedEvidence: Object.freeze(invalidatedEvidence),
        }),
      };
    });
  }

  public commitVerificationAttemptOutcome(
    rawInput: CommitVerificationAttemptOutcome,
  ): StoreCommandResult<CommittedVerificationAttemptOutcome> {
    this.assertOpen();
    const input = validateCommitVerificationAttemptOutcome(rawInput);
    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const currentWorkflow = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, currentWorkflow);
      if (currentWorkflow.version !== input.event.fromWorkflowVersion) {
        throw new OptimisticConcurrencyError('Workflow', currentWorkflow.id);
      }
      if (input.event.type !== 'ATTEMPT_FINISHED') {
        throw new StoreInvariantError('Verification outcome requires an Attempt finish event');
      }
      const currentAttempt = this.getAttemptInsideTransaction(input.event.attemptId);
      const applied = applyAttemptEvent(currentWorkflow, currentAttempt, input.event);
      const authority = this.getCandidateAuthorityForWorkflow(currentWorkflow.id);
      if (authority?.generation.state !== CandidateGenerationState.FROZEN) {
        throw new StoreInvariantError('Verification has no current frozen Candidate authority');
      }
      const obligation = this.getVerificationObligation(input.obligationId);
      if (
        obligation?.goalId !== currentWorkflow.goalId ||
        obligation.goalRevision !== currentWorkflow.goalRevision ||
        obligation.candidateGenerationId !== authority.generation.id
      ) {
        throw new StoreInvariantError('Verification Obligation is stale or belongs elsewhere');
      }
      const evidence = verifyEvidenceRecordDigests(input.evidence, canonicalAuthorityDigests);
      this.assertEvidenceAdmissionAuthority(
        evidence,
        input.initialEligibility,
        applied.attempt,
        applied.workflow,
        authority.generation,
      );
      if (
        evidence.verificationObligationId !== obligation.id ||
        evidence.kind !== obligation.requiredEvidenceKind ||
        `${evidence.checkSpec.id}@${evidence.checkSpec.version}` !== obligation.checkSpecRef
      ) {
        throw new StoreInvariantError('Verification Evidence does not satisfy its Obligation');
      }
      const expectedPayloadDigest = sha256Digest(
        canonicalAuthorityDigests.digest({
          event: input.event,
          evidenceRecordDigest: evidence.recordDigest,
          obligationId: obligation.id,
        }),
      );
      if (input.payloadDigest !== expectedPayloadDigest) {
        throw new StoreInvariantError('Verification outcome audit digest is incomplete');
      }

      this.insertAuditEvent({
        id: input.evidenceAuditEventId,
        aggregateType: 'EVIDENCE',
        aggregateId: evidence.id,
        eventType: 'EVIDENCE_RECORDED_ELIGIBLE',
        commandId: input.event.commandId,
        afterVersion: input.initialEligibility.version,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: evidence.recordDigest,
        occurredAt: evidence.recordedAt,
      });
      this.insertEvidenceRecord(evidence);
      this.probe(CandidateEvidenceTransactionStep.AFTER_EVIDENCE_WRITE);
      this.insertEvidenceEligibility(input.initialEligibility);
      this.probe(CandidateEvidenceTransactionStep.AFTER_ELIGIBILITY_WRITE);

      this.updateTerminalAttempt(currentAttempt, applied.attempt);
      this.probe(TransactionStep.AFTER_ATTEMPT_STATE_WRITE);
      this.updateWorkflow(currentWorkflow, applied.workflow);
      this.probe(TransactionStep.AFTER_STATE_WRITE);
      this.insertAttemptAndWorkflowAudits(input, applied);
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, applied.workflow, input.event.commandId),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedEvidence = this.getEvidence(evidence.id);
      const persistedEligibility = this.getEvidenceEligibility(evidence.id);
      if (persistedEvidence === undefined || persistedEligibility === undefined) {
        throw new StoreInvariantError(`Verification Evidence ${evidence.id} did not round-trip`);
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        applied.workflow.goalId,
        applied.workflow.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.auditEventId,
        input.workflowAuditEventId,
        input.evidenceAuditEventId,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          workflow: this.getWorkflowInsideTransaction(applied.workflow.id),
          attempt: this.getAttemptInsideTransaction(applied.attempt.id),
          evidence: persistedEvidence,
          eligibility: persistedEligibility,
        }),
      };
    });
  }

  public commitEvidenceSetTransition(
    rawInput: CommitEvidenceSetTransition,
  ): StoreCommandResult<WorkflowInstance> {
    this.assertOpen();
    const input = validateCommitEvidenceSetTransition(rawInput);
    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, current);
      if (current.version !== input.event.fromVersion) {
        throw new OptimisticConcurrencyError('Workflow', current.id);
      }
      const authority = this.getCandidateAuthorityForWorkflow(current.id);
      if (
        authority?.generation.state !== CandidateGenerationState.FROZEN ||
        authority.generation.frozenDigest !== input.evidenceSet.candidateDigest ||
        authority.generation.id !== input.evidenceSet.candidateGenerationId ||
        input.evidenceSet.goalId !== current.goalId ||
        input.evidenceSet.goalRevision !== current.goalRevision ||
        input.evidenceSet.obligationMappings.length === 0 ||
        input.evidenceSet.evidenceRefs.length === 0 ||
        input.evidenceSet.unresolvedEvidenceRequirements.length !== 0
      ) {
        throw new StoreInvariantError(
          'Evidence Set is incomplete or has stale Candidate authority',
        );
      }
      const expectedSetDigest = sha256Digest(
        canonicalAuthorityDigests.digest(evidenceSetDigestProjection(input.evidenceSet)),
      );
      if (input.evidenceSet.digest !== expectedSetDigest) {
        throw new StoreInvariantError('Evidence Set digest does not match its projection');
      }
      const expectedPayloadDigest = sha256Digest(
        canonicalAuthorityDigests.digest({
          event: input.event,
          evidenceSetDigest: input.evidenceSet.digest,
        }),
      );
      if (input.payloadDigest !== expectedPayloadDigest) {
        throw new StoreInvariantError('Evidence Set transition audit digest is incomplete');
      }
      this.assertEvidenceSetBindingsCurrent(input.evidenceSet);
      this.assertEvidenceSetTransitionGuardAuthority(current, input.event, input.evidenceSet);
      const next = applyWorkflowEvent(current, input.event);

      this.insertAuditEvent({
        id: input.evidenceSetAuditEventId,
        aggregateType: 'EVIDENCE_SET',
        aggregateId: input.evidenceSet.digest,
        eventType: 'EVIDENCE_SET_RECORDED',
        commandId: input.event.commandId,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.evidenceSet.digest,
        occurredAt: input.event.occurredAt,
      });
      this.insertEvidenceSet(input.evidenceSet);
      this.probe(CandidateEvidenceTransactionStep.AFTER_EVIDENCE_SET_WRITE);
      this.updateWorkflow(current, next);
      this.probe(TransactionStep.AFTER_STATE_WRITE);
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: input.event.workflowId,
        eventType: input.event.type,
        commandId: input.event.commandId,
        beforeVersion: input.event.fromVersion,
        afterVersion: input.event.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, next, input.event.commandId),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedSet = this.getEvidenceSet(input.evidenceSet.digest);
      if (persistedSet === undefined) {
        throw new StoreInvariantError(
          `Evidence Set ${input.evidenceSet.digest} did not round-trip`,
        );
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        next.goalId,
        next.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([input.auditEventId, input.evidenceSetAuditEventId]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: this.getWorkflowInsideTransaction(next.id),
      };
    });
  }

  public commitAcceptanceEvaluation(
    rawInput: CommitAcceptanceEvaluation,
  ): StoreCommandResult<CommittedAcceptanceEvaluation> {
    this.assertOpen();
    const input = validateCommitAcceptanceEvaluation(rawInput);
    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.manifest.workflowId);
      this.validateCommandTarget(input.target, current);
      if (current.version !== input.manifest.workflowVersion) {
        throw new OptimisticConcurrencyError('Workflow', current.id);
      }
      const compiled = this.compileCurrentAcceptance(input.manifest);
      if (canonicalizeJson(compiled.pendingIssueSet) !== canonicalizeJson(input.pendingIssueSet)) {
        throw new StoreInvariantError('Pending Issue Set does not match current authority');
      }
      const decision = verifyM1AcceptanceDecision(
        compiled,
        input.decision,
        canonicalAuthorityDigests,
      );

      const existingManifest = this.getAcceptanceInputManifest(input.manifest.manifestDigest);
      if (existingManifest === undefined) {
        this.insertAuditEvent({
          id: input.manifestAuditEventId,
          aggregateType: 'ACCEPTANCE_INPUT_MANIFEST',
          aggregateId: input.manifest.manifestDigest,
          eventType: 'ACCEPTANCE_INPUT_MANIFEST_RECORDED',
          commandId: input.commandId,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          payloadDigest: input.manifest.manifestDigest,
          occurredAt: input.manifest.createdAt,
        });
        this.insertAcceptanceInputManifest(input.manifest);
      } else if (
        canonicalizeJson(acceptanceInputManifestProjection(existingManifest)) !==
        canonicalizeJson(acceptanceInputManifestProjection(input.manifest))
      ) {
        throw new StoreInvariantError('Acceptance Manifest digest collides with other content');
      }
      this.probe(AcceptanceTransactionStep.AFTER_ACCEPTANCE_MANIFEST_WRITE);

      const contradictory = this.#database
        .prepare(
          `SELECT decision_digest FROM acceptance_decisions
            WHERE input_manifest_digest = ?
              AND policy_bundle_digest = ?
              AND engine_version = ?
              AND decision_digest <> ?
            LIMIT 1`,
        )
        .get(
          decision.inputManifestDigest,
          decision.policyBundleDigest,
          decision.engineVersion,
          decision.decisionDigest,
        );
      if (contradictory !== undefined) {
        throw new StoreInvariantError(
          'Acceptance Engine produced contradictory semantics for the same current input',
        );
      }
      this.insertAuditEvent({
        id: input.decisionAuditEventId,
        aggregateType: 'ACCEPTANCE_DECISION',
        aggregateId: decision.id,
        eventType: 'ACCEPTANCE_DECISION_ISSUED',
        commandId: input.commandId,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: decision.decisionDigest,
        occurredAt: decision.issuedAt,
      });
      this.insertAcceptanceDecision(decision);
      this.probe(AcceptanceTransactionStep.AFTER_ACCEPTANCE_DECISION_WRITE);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, current, input.commandId),
      );
      this.insertProcessedCommand(
        input.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        decision.issuedAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedManifest = this.getAcceptanceInputManifest(input.manifest.manifestDigest);
      const persistedDecision = this.getAcceptanceDecision(decision.id);
      if (persistedManifest === undefined || persistedDecision === undefined) {
        throw new StoreInvariantError('Acceptance evaluation did not round-trip');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.commandId,
        input.inputDigest,
        input.target,
        current.goalId,
        current.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        ...(existingManifest === undefined ? [input.manifestAuditEventId] : []),
        input.decisionAuditEventId,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({ manifest: persistedManifest, decision: persistedDecision }),
      };
    });
  }

  public commitAcceptedCloseout(
    rawInput: CommitAcceptedCloseout,
  ): StoreCommandResult<CommittedAcceptedCloseout> {
    this.assertOpen();
    const input = validateCommitAcceptedCloseout(rawInput);
    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, current);
      if (current.version !== input.event.fromVersion) {
        throw new OptimisticConcurrencyError('Workflow', current.id);
      }
      const manifest = this.requireAcceptanceManifest(input.closeout.inputManifestDigest);
      const decision = this.requireAcceptanceDecision(input.closeout.acceptanceDecisionId);
      const compiled = this.assertCurrentAcceptanceDecision(manifest, decision);
      const authority = compiled.authority;
      if (input.event.type !== 'WORKFLOW_PHASE_TRANSITIONED') {
        throw new StoreInvariantError('Closeout requires a phase transition event');
      }
      if (
        decision.outcome !== AcceptanceOutcome.ACCEPT ||
        input.event.occurredAt < decision.issuedAt ||
        decision.decisionDigest !== input.closeout.acceptanceDecisionDigest ||
        authority.generation.id !== input.candidateEvent.candidateGenerationId ||
        authority.generation.frozenDigest !== input.closeout.candidateDigest ||
        canonicalizeJson(input.event.guardResults) !==
          canonicalizeJson([
            {
              guard: WorkflowGuard.CURRENT_ACCEPTANCE,
              outcome: GuardOutcome.PASS,
              reasonCode: 'CURRENT_ACCEPTANCE_DECISION',
              supportingRefs: [decision.id, decision.decisionDigest, manifest.manifestDigest],
            },
          ])
      ) {
        throw new StoreInvariantError(
          'Closeout does not consume the exact current ACCEPT decision',
        );
      }
      const nextWorkflow = applyWorkflowEvent(current, input.event);
      const nextGeneration = applyCandidateEvent(authority.generation, input.candidateEvent);
      const expectedCloseout = decodeCloseoutRecord({
        schemaVersion: 1,
        goalId: current.goalId,
        goalRevision: current.goalRevision,
        workflowId: current.id,
        workflowVersion: nextWorkflow.version,
        acceptanceDecisionId: decision.id,
        acceptanceDecisionDigest: decision.decisionDigest,
        inputManifestDigest: manifest.manifestDigest,
        candidateGenerationId: authority.generation.id,
        candidateDigest: authority.generation.frozenDigest,
        evidenceSetDigest: manifest.evidenceSetDigest,
        policyBundleId: manifest.policyBundleId,
        policyBundleDigest: manifest.policyBundleDigest,
        closedAt: input.event.occurredAt,
      });
      if (canonicalizeJson(expectedCloseout) !== canonicalizeJson(input.closeout)) {
        throw new StoreInvariantError('Closeout record does not match the accepted authority');
      }
      const expectedPayloadDigest = sha256Digest(
        canonicalAuthorityDigests.digest({
          event: input.event,
          candidateEvent: input.candidateEvent,
          closeout: input.closeout,
        }),
      );
      if (input.payloadDigest !== expectedPayloadDigest) {
        throw new StoreInvariantError('Closeout audit digest does not bind the compound authority');
      }
      const auditTrace = {
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      };

      this.insertAuditEvent({
        id: input.candidateAuditEventId,
        aggregateType: 'CANDIDATE_GENERATION',
        aggregateId: nextGeneration.id,
        eventType: input.candidateEvent.type,
        commandId: input.event.commandId,
        beforeVersion: input.candidateEvent.fromVersion,
        afterVersion: input.candidateEvent.toVersion,
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
        ...auditTrace,
      });
      this.updateCandidateGeneration(authority.generation, nextGeneration);
      this.probe(CandidateEvidenceTransactionStep.AFTER_CANDIDATE_TRANSITION);
      this.updateWorkflow(current, nextWorkflow);
      this.probe(TransactionStep.AFTER_STATE_WRITE);
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: current.id,
        eventType: input.event.type,
        commandId: input.event.commandId,
        beforeVersion: input.event.fromVersion,
        afterVersion: input.event.toVersion,
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
        ...auditTrace,
      });
      this.insertAuditEvent({
        id: input.closeoutAuditEventId,
        aggregateType: 'WORKFLOW_CLOSEOUT',
        aggregateId: current.id,
        eventType: 'WORKFLOW_CLOSEOUT_RECORDED',
        commandId: input.event.commandId,
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
        ...auditTrace,
      });
      this.insertCloseout(input.closeout);
      this.probe(AcceptanceTransactionStep.AFTER_CLOSEOUT_WRITE);
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, nextWorkflow, input.event.commandId),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const closeout = this.getCloseoutForWorkflow(current.id);
      const persistedAuthority = this.getCandidateAuthorityForWorkflow(current.id);
      if (closeout === undefined || persistedAuthority === undefined) {
        throw new StoreInvariantError('Accepted closeout did not round-trip');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        current.goalId,
        current.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.candidateAuditEventId,
        input.auditEventId,
        input.closeoutAuditEventId,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          workflow: this.getWorkflowInsideTransaction(current.id),
          authority: persistedAuthority,
          closeout,
        }),
      };
    });
  }

  public commitAcceptanceRepair(
    rawInput: CommitAcceptanceRepair,
  ): StoreCommandResult<CommittedAcceptanceRepair> {
    this.assertOpen();
    const input = validateCommitAcceptanceRepair(rawInput);
    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const current = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, current);
      if (current.version !== input.event.fromVersion) {
        throw new OptimisticConcurrencyError('Workflow', current.id);
      }
      const manifest = this.requireAcceptanceManifest(input.inputManifestDigest);
      const decision = this.requireAcceptanceDecision(input.acceptanceDecisionId);
      const compiled = this.assertCurrentAcceptanceDecision(manifest, decision);
      const oldGeneration = compiled.authority.generation;
      const currentCandidate = this.getCandidateForGoal(compiled.authority.goal.id);
      if (input.event.type !== 'WORKFLOW_PHASE_TRANSITIONED') {
        throw new StoreInvariantError('Repair requires a phase transition event');
      }
      if (
        decision.outcome !== AcceptanceOutcome.REJECT_REPAIRABLE ||
        input.event.occurredAt < decision.issuedAt ||
        decision.decisionDigest !== input.acceptanceDecisionDigest ||
        currentCandidate === undefined ||
        canonicalizeJson(currentCandidate) !== canonicalizeJson(input.candidate) ||
        oldGeneration.id !== input.rejectedCandidateEvent.candidateGenerationId ||
        oldGeneration.frozenDigest === undefined ||
        input.generation.createdAt !== input.event.occurredAt ||
        input.generation.parentGenerationId !== oldGeneration.id ||
        input.generation.baseDigest !== oldGeneration.frozenDigest ||
        canonicalizeJson(input.event.guardResults) !==
          canonicalizeJson([
            {
              guard: WorkflowGuard.REJECT_REPAIRABLE_RECORDED,
              outcome: GuardOutcome.PASS,
              reasonCode: 'CURRENT_REPAIRABLE_ACCEPTANCE_REJECTION',
              supportingRefs: [decision.id, decision.decisionDigest, manifest.manifestDigest],
            },
            {
              guard: WorkflowGuard.CANDIDATE_GENERATION_PREPARED,
              outcome: GuardOutcome.PASS,
              reasonCode: 'REPAIR_CANDIDATE_AUTHORITY_PREPARED',
              supportingRefs: [input.generation.id, input.generation.baseDigest, oldGeneration.id],
            },
          ])
      ) {
        throw new StoreInvariantError('Repair does not consume the exact current rejection');
      }
      const expectedSequence = this.nextCandidateGenerationSequence(input.candidate.id);
      if (input.generation.sequence !== expectedSequence) {
        throw new StoreInvariantError(
          `Repair Candidate generation sequence must be ${expectedSequence}`,
        );
      }
      if (input.checkSpecifications.length !== 2) {
        throw new StoreInvariantError('Acceptance repair requires exactly two fresh M1 Checks');
      }
      const freeze = input.checkSpecifications[0];
      const verification = input.checkSpecifications[1];
      if (freeze === undefined || verification === undefined) {
        throw new StoreInvariantError('Acceptance repair lacks its fresh Check authority');
      }
      validateM1CandidateEvidencePolicy(
        compiled.authority.goal,
        input.generation,
        { freeze, verification, obligations: input.obligations },
        input.generation.createdAt,
      );
      const nextWorkflow = applyWorkflowEvent(current, input.event);
      const rejectedGeneration = applyCandidateEvent(oldGeneration, input.rejectedCandidateEvent);
      const expectedPayloadDigest = sha256Digest(
        canonicalAuthorityDigests.digest({
          event: input.event,
          acceptanceDecisionId: decision.id,
          acceptanceDecisionDigest: decision.decisionDigest,
          inputManifestDigest: manifest.manifestDigest,
          rejectedCandidateEvent: input.rejectedCandidateEvent,
          generation: input.generation,
          checkSpecifications: input.checkSpecifications,
          obligations: input.obligations,
        }),
      );
      if (input.payloadDigest !== expectedPayloadDigest) {
        throw new StoreInvariantError('Repair audit digest does not bind the compound authority');
      }
      const auditTrace = {
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      };

      this.insertAuditEvent({
        id: input.rejectedCandidateAuditEventId,
        aggregateType: 'CANDIDATE_GENERATION',
        aggregateId: oldGeneration.id,
        eventType: input.rejectedCandidateEvent.type,
        commandId: input.event.commandId,
        beforeVersion: input.rejectedCandidateEvent.fromVersion,
        afterVersion: input.rejectedCandidateEvent.toVersion,
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
        ...auditTrace,
      });
      this.updateCandidateGeneration(oldGeneration, rejectedGeneration);
      this.probe(CandidateEvidenceTransactionStep.AFTER_CANDIDATE_TRANSITION);
      this.insertAuditEvent({
        id: input.generationAuditEventId,
        aggregateType: 'CANDIDATE_GENERATION',
        aggregateId: input.generation.id,
        eventType: 'CANDIDATE_GENERATION_CREATED',
        commandId: input.event.commandId,
        afterVersion: input.generation.version,
        payloadDigest: input.payloadDigest,
        occurredAt: input.generation.createdAt,
        ...auditTrace,
      });
      this.insertCandidateGeneration(input.generation, current.id);
      this.probe(AcceptanceTransactionStep.AFTER_REPAIR_GENERATION_WRITE);

      input.checkSpecifications.forEach((specification, index) => {
        const auditIdentifier = input.checkSpecificationAuditEventIds[index];
        if (auditIdentifier === undefined) {
          throw new StoreInvariantError('Repair Check audit identity is missing');
        }
        this.insertAuditEvent({
          id: auditIdentifier,
          aggregateType: 'CHECK_SPECIFICATION',
          aggregateId: specification.id,
          eventType: 'CHECK_SPECIFICATION_RECORDED',
          commandId: input.event.commandId,
          payloadDigest: input.payloadDigest,
          occurredAt: input.event.occurredAt,
          ...auditTrace,
        });
        this.#database
          .prepare(
            `INSERT INTO check_specifications(id, version, canonical_json)
             VALUES (?, ?, ?)`,
          )
          .run(
            specification.id,
            specification.version,
            serializeJson(decodeJsonValue(specification)),
          );
        this.probe(AcceptanceTransactionStep.AFTER_REPAIR_CHECK_SPECIFICATION_WRITE);
      });
      input.obligations.forEach((obligation, index) => {
        const auditIdentifier = input.obligationAuditEventIds[index];
        if (auditIdentifier === undefined) {
          throw new StoreInvariantError('Repair Obligation audit identity is missing');
        }
        this.insertAuditEvent({
          id: auditIdentifier,
          aggregateType: 'VERIFICATION_OBLIGATION',
          aggregateId: obligation.id,
          eventType: 'VERIFICATION_OBLIGATION_RECORDED',
          commandId: input.event.commandId,
          payloadDigest: input.payloadDigest,
          occurredAt: input.event.occurredAt,
          ...auditTrace,
        });
        this.insertVerificationObligation(obligation);
        this.probe(AcceptanceTransactionStep.AFTER_REPAIR_OBLIGATION_WRITE);
      });
      this.updateWorkflow(current, nextWorkflow);
      this.probe(TransactionStep.AFTER_STATE_WRITE);
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: current.id,
        eventType: input.event.type,
        commandId: input.event.commandId,
        beforeVersion: input.event.fromVersion,
        afterVersion: input.event.toVersion,
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
        ...auditTrace,
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, nextWorkflow, input.event.commandId),
      );
      this.insertProcessedCommand(
        input.event.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const authority = this.getCandidateAuthorityForWorkflow(current.id);
      if (authority?.generation.id !== input.generation.id) {
        throw new StoreInvariantError('Repair Candidate authority did not round-trip');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        current.goalId,
        current.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.rejectedCandidateAuditEventId,
        input.generationAuditEventId,
        ...input.checkSpecificationAuditEventIds,
        ...input.obligationAuditEventIds,
        input.auditEventId,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          workflow: this.getWorkflowInsideTransaction(current.id),
          authority,
          rejectedGeneration,
          checkSpecifications: input.checkSpecifications,
          obligations: input.obligations,
        }),
      };
    });
  }

  public recordCommandRejection(rawInput: RecordCommandRejection): StoreCommandResult<undefined> {
    this.assertOpen();
    const input = validateRecordCommandRejection(rawInput);

    return this.runCommandImmediate(() => {
      const replay = this.checkCommand(
        input.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
      );
      if (replay !== undefined) {
        return { status: 'REPLAYED', outcome: replay.outcome };
      }
      this.probe(TransactionStep.AFTER_COMMAND_CHECK);

      const workflow = this.getWorkflowInsideTransaction(input.workflowId);
      this.validateCommandTarget(input.target, workflow);
      if (workflow.version !== input.observedWorkflowVersion) {
        throw new OptimisticConcurrencyError('Workflow', input.workflowId);
      }
      const completedAt = isoTimestamp(input.completedAt);
      if (completedAt < workflow.updatedAt) {
        throw new StoreInvariantError(
          'Command rejection completion time cannot precede observed Workflow state',
        );
      }

      const outcome = storedCommandOutcomeToJson(
        createRejectedStoredCommandOutcome(input.target, workflow, input.commandId, input.error),
      );
      this.insertProcessedCommand(
        input.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        completedAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedCommand = this.assertProcessedCommandReadable(
        input.commandId,
        input.inputDigest,
        input.target,
        workflow.goalId,
        workflow.id,
        StoredCommandDisposition.REJECTED,
      );

      return { status: 'APPLIED', outcome: persistedCommand.outcome, value: undefined };
    });
  }

  private validateInitialGoalAndWorkflow(goal: Goal, workflow: WorkflowInstance): void {
    assertWorkflowInvariant(workflow);
    if (goal.status !== GoalStatus.ACTIVE) {
      throw new StoreInvariantError('A newly stored Goal must be ACTIVE');
    }
    if (goal.revision !== goalRevision(1) || goal.updatedAt !== goal.createdAt) {
      throw new StoreInvariantError('A newly stored Goal must begin at revision 1');
    }
    if (workflow.goalId !== goal.id || workflow.goalRevision !== goal.revision) {
      throw new StoreInvariantError('Initial Workflow must bind the exact Goal revision');
    }
    if (
      workflow.phase !== WorkflowPhase.DISCOVERY ||
      workflow.runStatus !== RunStatus.READY ||
      workflow.version !== workflowVersion(1)
    ) {
      throw new StoreInvariantError('Initial Workflow must be DISCOVERY/READY at version 1');
    }
    if (
      workflow.activeAttemptId !== undefined ||
      workflow.activeCandidateGenerationId !== undefined ||
      workflow.suspendedReason !== undefined
    ) {
      throw new StoreInvariantError(
        'Initial Workflow cannot already select an Attempt or Candidate',
      );
    }
    if (workflow.createdAt !== goal.createdAt || workflow.updatedAt !== goal.createdAt) {
      throw new StoreInvariantError('Initial Goal and Workflow timestamps must agree');
    }
  }

  private getWorkflowInsideTransaction(workflowIdentifier: WorkflowId): WorkflowInstance {
    const row = this.#database
      .prepare('SELECT * FROM workflows WHERE id = ?')
      .get(workflowIdentifier);
    if (row === undefined) {
      throw new StoreInvariantError(`Workflow ${workflowIdentifier} does not exist`);
    }
    return decodeWorkflow(row);
  }

  private getAttemptInsideTransaction(attemptIdentifier: AttemptId): Attempt {
    const row = this.#database
      .prepare('SELECT * FROM attempts WHERE id = ?')
      .get(attemptIdentifier);
    if (row === undefined) {
      throw new StoreInvariantError(`Attempt ${attemptIdentifier} does not exist`);
    }
    return decodeAttempt(row);
  }

  private nextAttemptSequenceInsideTransaction(workflowIdentifier: WorkflowId): number {
    const row = this.#database
      .prepare(
        `SELECT COALESCE(MAX(attempts.sequence), 0) + 1 AS next_sequence
           FROM workflows
           LEFT JOIN attempts ON attempts.workflow_id = workflows.id
          WHERE workflows.id = ?
          GROUP BY workflows.id`,
      )
      .get(workflowIdentifier);
    if (
      typeof row !== 'object' ||
      row === null ||
      !('next_sequence' in row) ||
      typeof row.next_sequence !== 'number' ||
      !Number.isSafeInteger(row.next_sequence) ||
      row.next_sequence < 1
    ) {
      throw new StoreInvariantError(`Workflow ${workflowIdentifier} does not exist`);
    }
    return row.next_sequence;
  }

  private validateCommandTarget(target: CommandTarget, workflow: WorkflowInstance): void {
    const matches =
      target.aggregateType === 'GOAL'
        ? target.aggregateId === workflow.goalId
        : target.aggregateId === workflow.id;
    if (!matches) {
      throw new StoreInvariantError(
        `${target.aggregateType} command target does not own Workflow ${workflow.id}`,
      );
    }
  }

  private requireAcceptanceManifest(manifestDigest: Sha256Digest): AcceptanceInputManifest {
    const manifest = this.getAcceptanceInputManifest(manifestDigest);
    if (manifest === undefined) {
      throw new StoreInvariantError(`Acceptance Input Manifest ${manifestDigest} does not exist`);
    }
    return manifest;
  }

  private requireAcceptanceDecision(decisionIdentifier: AcceptanceDecisionId): AcceptanceDecision {
    const decision = this.getAcceptanceDecision(decisionIdentifier);
    if (decision === undefined) {
      throw new StoreInvariantError(`Acceptance Decision ${decisionIdentifier} does not exist`);
    }
    return decision;
  }

  private compileCurrentAcceptance(manifest: AcceptanceInputManifest) {
    const installedPolicy = this.getPolicyBundle(manifest.policyBundleId);
    if (installedPolicy === undefined || installedPolicy.installedAt > manifest.createdAt) {
      throw new StoreInvariantError(
        'Acceptance Input Manifest predates its installed Policy authority',
      );
    }
    const authority = this.getAcceptanceAuthorityForWorkflow(
      manifest.workflowId,
      manifest.policyBundleId,
    );
    if (authority === undefined) {
      throw new StoreInvariantError('Current Acceptance authority is incomplete');
    }
    const compiled = compileM1AcceptanceInput(
      authority,
      manifest.createdAt,
      canonicalAuthorityDigests,
    );
    if (canonicalizeJson(compiled.manifest) !== canonicalizeJson(manifest)) {
      throw new StoreInvariantError('Acceptance Input Manifest is stale or forged');
    }
    return compiled;
  }

  private assertCurrentAcceptanceDecision(
    manifest: AcceptanceInputManifest,
    decision: AcceptanceDecision,
  ) {
    if (
      decision.inputManifestDigest !== manifest.manifestDigest ||
      decision.policyBundleDigest !== manifest.policyBundleDigest
    ) {
      throw new StoreInvariantError('Acceptance Decision and Manifest bindings disagree');
    }
    const compiled = this.compileCurrentAcceptance(manifest);
    verifyM1AcceptanceDecision(compiled, decision, canonicalAuthorityDigests);
    return compiled;
  }

  private nextCandidateSequenceForPreparation(candidateIdentifier: Candidate['id']): number {
    const existing = this.#database
      .prepare('SELECT id FROM candidates WHERE id = ?')
      .get(candidateIdentifier);
    if (existing === undefined) {
      return 1;
    }
    return this.nextCandidateGenerationSequence(candidateIdentifier);
  }

  private insertCandidateGeneration(
    generation: CandidateGeneration,
    workflowIdentifier: WorkflowId,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO candidate_generations(
           id, candidate_id, workflow_id, sequence, parent_generation_id,
           workspace_identity, state, base_digest, frozen_digest,
           invalidation_reason, version, created_at, updated_at, frozen_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        generation.id,
        generation.candidateId,
        workflowIdentifier,
        generation.sequence,
        generation.parentGenerationId ?? null,
        generation.workspaceIdentity,
        generation.state,
        generation.baseDigest,
        generation.frozenDigest ?? null,
        generation.invalidationReason ?? null,
        generation.version,
        generation.createdAt,
        generation.updatedAt,
        generation.frozenAt ?? null,
      );
  }

  private updateCandidateGeneration(current: CandidateGeneration, next: CandidateGeneration): void {
    const update = this.#database
      .prepare(
        `UPDATE candidate_generations
            SET state = ?, frozen_digest = ?, invalidation_reason = ?, version = ?,
                updated_at = ?, frozen_at = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        next.state,
        next.frozenDigest ?? null,
        next.invalidationReason ?? null,
        next.version,
        next.updatedAt,
        next.frozenAt ?? null,
        current.id,
        current.version,
      );
    if (update.changes !== 1) {
      throw new OptimisticConcurrencyError('CandidateGeneration', current.id);
    }
  }

  private insertVerificationObligation(obligation: VerificationObligation): void {
    this.#database
      .prepare(
        `INSERT INTO verification_obligations(
           id, goal_id, source_criterion_refs_json, scenario_refs_json,
           check_spec_ref, required_evidence_kind, strength, created_at, goal_revision,
           candidate_generation_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        obligation.id,
        obligation.goalId,
        serializeJson(decodeJsonValue(obligation.sourceCriterionRefs)),
        serializeJson(decodeJsonValue(obligation.scenarioRefs)),
        obligation.checkSpecRef,
        obligation.requiredEvidenceKind,
        obligation.strength,
        obligation.createdAt,
        obligation.goalRevision,
        obligation.candidateGenerationId,
      );
  }

  private insertEvidenceRecord(record: EvidenceRecord): void {
    this.#database
      .prepare(
        `INSERT INTO evidence_records(
           id, schema_version, kind, producer_type, producer_identity, goal_id,
           goal_revision, workflow_id, attempt_id, verification_obligation_id,
           candidate_generation_id,
           candidate_digest, fact_snapshot_digest, policy_bundle_digest,
           check_spec_json, environment_identity_json, started_at, ended_at,
           observation_json, payload_refs_json, observation_digest, result_status,
           recorded_at, record_digest, policy_bundle_id
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.kind,
        record.producerType,
        record.producerIdentity,
        record.goalId,
        record.goalRevision,
        record.workflowId,
        record.attemptId,
        record.verificationObligationId ?? null,
        record.candidateGenerationId,
        record.candidateDigest,
        null,
        record.policyBundleDigest,
        serializeJson(decodeJsonValue(record.checkSpec)),
        record.environmentIdentity === undefined
          ? null
          : serializeJson(decodeJsonValue(record.environmentIdentity)),
        record.startedAt,
        record.endedAt,
        serializeJson(decodeJsonValue(record.observation)),
        serializeJson(decodeJsonValue(record.payloadRefs)),
        record.observationDigest,
        record.resultStatus,
        record.recordedAt,
        record.recordDigest,
        record.policyBundleId,
      );
  }

  private insertEvidenceEligibility(eligibility: EvidenceEligibility): void {
    this.#database
      .prepare(
        `INSERT INTO evidence_eligibility(
           evidence_id, version, state, reason_code, source_ref, changed_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        eligibility.evidenceId,
        eligibility.version,
        eligibility.state,
        eligibility.state === EvidenceEligibilityState.INELIGIBLE ? eligibility.reasonCode : null,
        eligibility.state === EvidenceEligibilityState.INELIGIBLE ? eligibility.sourceRef : null,
        eligibility.changedAt,
      );
  }

  private insertEvidenceSet(set: EvidenceSet): void {
    this.#database
      .prepare(
        `INSERT INTO evidence_sets(
           digest, schema_version, goal_id, goal_revision, candidate_generation_id,
           candidate_digest, obligation_mappings_json, evidence_refs_json,
           unresolved_requirements_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        set.digest,
        set.schemaVersion,
        set.goalId,
        set.goalRevision,
        set.candidateGenerationId,
        set.candidateDigest,
        serializeJson(decodeJsonValue(set.obligationMappings)),
        serializeJson(decodeJsonValue(set.evidenceRefs)),
        serializeJson(decodeJsonValue(set.unresolvedEvidenceRequirements)),
      );
  }

  private insertAcceptanceInputManifest(manifest: AcceptanceInputManifest): void {
    this.#database
      .prepare(
        `INSERT INTO acceptance_input_manifests(
           manifest_digest, schema_version, goal_id, goal_revision, workflow_id,
           workflow_version, phase, fact_snapshot_digest, decision_set_digest,
           scenario_set_digest, candidate_generation_id, candidate_digest,
           evidence_set_digest, pending_issue_set_digest, policy_bundle_id,
           policy_bundle_digest, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        manifest.manifestDigest,
        manifest.schemaVersion,
        manifest.goalId,
        manifest.goalRevision,
        manifest.workflowId,
        manifest.workflowVersion,
        manifest.phase,
        manifest.factSnapshotDigest,
        manifest.decisionSetDigest,
        manifest.scenarioSetDigest,
        manifest.candidateGenerationId,
        manifest.candidateDigest,
        manifest.evidenceSetDigest,
        manifest.pendingIssueSetDigest,
        manifest.policyBundleId,
        manifest.policyBundleDigest,
        manifest.createdAt,
      );
  }

  private insertAcceptanceDecision(decision: AcceptanceDecision): void {
    this.#database
      .prepare(
        `INSERT INTO acceptance_decisions(
           id, schema_version, input_manifest_digest, policy_bundle_digest,
           outcome, dominant_reason_code, rule_results_json, engine_version,
           issued_at, decision_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        decision.id,
        decision.schemaVersion,
        decision.inputManifestDigest,
        decision.policyBundleDigest,
        decision.outcome,
        decision.dominantReasonCode,
        serializeJson(decodeJsonValue(decision.ruleResults)),
        decision.engineVersion,
        decision.issuedAt,
        decision.decisionDigest,
      );
  }

  private insertCloseout(closeout: CloseoutRecord): void {
    this.#database
      .prepare(
        `INSERT INTO workflow_closeouts(
           workflow_id, schema_version, goal_id, goal_revision, workflow_version,
           acceptance_decision_id, acceptance_decision_digest, input_manifest_digest,
           candidate_generation_id, candidate_digest, evidence_set_digest,
           policy_bundle_id, policy_bundle_digest, closed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        closeout.workflowId,
        closeout.schemaVersion,
        closeout.goalId,
        closeout.goalRevision,
        closeout.workflowVersion,
        closeout.acceptanceDecisionId,
        closeout.acceptanceDecisionDigest,
        closeout.inputManifestDigest,
        closeout.candidateGenerationId,
        closeout.candidateDigest,
        closeout.evidenceSetDigest,
        closeout.policyBundleId,
        closeout.policyBundleDigest,
        closeout.closedAt,
      );
  }

  private updateTerminalAttempt(current: Attempt, next: Attempt): void {
    if (current.status !== AttemptStatus.RUNNING || next.status === AttemptStatus.RUNNING) {
      throw new StoreInvariantError('Compound Attempt outcome requires RUNNING to terminal');
    }
    const update = this.#database
      .prepare(
        `UPDATE attempts
            SET status = ?, failure_class = ?, termination_reason = ?, ended_at = ?
          WHERE id = ? AND workflow_id = ? AND status = ?`,
      )
      .run(
        next.status,
        next.failureClass ?? null,
        next.terminationReason,
        next.endedAt,
        next.id,
        next.workflowId,
        AttemptStatus.RUNNING,
      );
    if (update.changes !== 1) {
      throw new OptimisticConcurrencyError('Attempt', current.id);
    }
  }

  private insertAttemptAndWorkflowAudits(
    input: CommitAttemptEventInput,
    applied: AppliedAttemptEvent,
  ): void {
    this.insertAuditEvent({
      id: input.auditEventId,
      aggregateType: 'ATTEMPT',
      aggregateId: applied.attempt.id,
      eventType: input.event.type,
      commandId: input.event.commandId,
      beforeVersion: input.event.fromWorkflowVersion,
      afterVersion: input.event.toWorkflowVersion,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      payloadDigest: input.payloadDigest,
      occurredAt: input.event.occurredAt,
    });
    this.insertAuditEvent({
      id: input.workflowAuditEventId,
      aggregateType: 'WORKFLOW',
      aggregateId: applied.workflow.id,
      eventType: 'WORKFLOW_ATTEMPT_FINISHED',
      commandId: input.event.commandId,
      beforeVersion: input.event.fromWorkflowVersion,
      afterVersion: input.event.toWorkflowVersion,
      ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
      ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
      payloadDigest: input.payloadDigest,
      occurredAt: input.event.occurredAt,
    });
  }

  private assertEvidenceAdmissionAuthority(
    record: EvidenceRecord,
    eligibility: EvidenceEligibility,
    attempt: Attempt,
    workflow: WorkflowInstance,
    generation: CandidateGeneration,
  ): void {
    if (
      eligibility.state !== EvidenceEligibilityState.ELIGIBLE ||
      eligibility.evidenceId !== record.id ||
      eligibility.changedAt !== record.recordedAt ||
      attempt.status === AttemptStatus.RUNNING ||
      record.attemptId !== attempt.id ||
      record.workflowId !== workflow.id ||
      record.goalId !== workflow.goalId ||
      record.goalRevision !== workflow.goalRevision ||
      record.candidateGenerationId !== generation.id ||
      generation.state !== CandidateGenerationState.FROZEN ||
      record.candidateDigest !== generation.frozenDigest ||
      record.checkSpec.inputRefs.length !== 1 ||
      record.checkSpec.inputRefs[0] !== generation.id ||
      !(
        (attempt.phase === WorkflowPhase.SOURCE_FREEZE &&
          record.kind === EvidenceKind.CANDIDATE_FREEZE) ||
        (attempt.phase === WorkflowPhase.EVIDENCE_BUILD && record.kind === EvidenceKind.TEST_RESULT)
      ) ||
      record.startedAt < attempt.startedAt ||
      record.endedAt > attempt.endedAt ||
      record.recordedAt !== attempt.endedAt
    ) {
      throw new StoreInvariantError('Evidence does not bind its exact terminal Attempt authority');
    }
    const policy = this.getPolicyBundle(record.policyBundleId);
    const checkSpecification = this.getCheckSpecification(record.checkSpec.id);
    if (
      policy?.bundle.digest !== record.policyBundleDigest ||
      checkSpecification === undefined ||
      canonicalizeJson(checkSpecification) !== canonicalizeJson(record.checkSpec)
    ) {
      throw new StoreInvariantError('Evidence Policy or Check Specification authority is stale');
    }
  }

  private assertFrozenCandidateTransitionAuthority(
    workflow: WorkflowInstance,
    event: Extract<WorkflowEvent, { readonly type: 'WORKFLOW_PHASE_TRANSITIONED' }>,
  ): void {
    const authority = this.getCandidateAuthorityForWorkflow(workflow.id);
    if (authority?.generation.state !== CandidateGenerationState.FROZEN) {
      throw new StoreInvariantError('Evidence phase requires a current frozen Candidate');
    }
    const freezeEntry = this.listEvidenceForGeneration(authority.generation.id).find(
      ({ record, eligibility }) =>
        record.kind === EvidenceKind.CANDIDATE_FREEZE &&
        record.candidateDigest === authority.generation.frozenDigest &&
        eligibility.state === EvidenceEligibilityState.ELIGIBLE,
    );
    if (freezeEntry?.record.observation.kind !== EvidenceKind.CANDIDATE_FREEZE) {
      throw new StoreInvariantError('Evidence phase requires current Candidate freeze Evidence');
    }
    const record = freezeEntry.record;
    const observation = record.observation;
    if (observation.kind !== EvidenceKind.CANDIDATE_FREEZE) {
      throw new StoreInvariantError('Candidate freeze Evidence observation kind is invalid');
    }
    const policy = this.getPolicyBundle(record.policyBundleId);
    if (policy?.bundle.digest !== record.policyBundleDigest) {
      throw new StoreInvariantError('Candidate freeze Evidence Policy is not current');
    }
    const expectedGuards = [
      {
        guard: WorkflowGuard.NO_WRITE_CAPABLE_WORKER,
        outcome: GuardOutcome.PASS,
        reasonCode: 'NO_ACTIVE_ATTEMPT',
        supportingRefs: [workflow.id, `workflow-version:${String(workflow.version)}`],
      },
      {
        guard: WorkflowGuard.FREEZE_IDENTITY_STABLE,
        outcome: GuardOutcome.PASS,
        reasonCode: 'TWO_SOURCE_DIGESTS_MATCH',
        supportingRefs: [observation.firstSourceDigest, observation.secondSourceDigest, record.id],
      },
      {
        guard: WorkflowGuard.CHANGE_IDENTITY_RECORDED,
        outcome: GuardOutcome.PASS,
        reasonCode: 'CHANGE_SET_DIGEST_RECORDED',
        supportingRefs: [observation.changeSetDigest, record.recordDigest],
      },
      {
        guard: WorkflowGuard.FROZEN_DIGEST_PERSISTED,
        outcome: GuardOutcome.PASS,
        reasonCode: 'CANDIDATE_FROZEN',
        supportingRefs: [authority.generation.id, authority.generation.frozenDigest],
      },
      {
        guard: WorkflowGuard.INTEGRITY_POLICY_PASSED,
        outcome: GuardOutcome.PASS,
        reasonCode: 'FREEZE_EVIDENCE_POLICY_CURRENT',
        supportingRefs: [record.policyBundleId, record.policyBundleDigest, record.checkSpec.id],
      },
    ];
    if (canonicalizeJson(event.guardResults) !== canonicalizeJson(expectedGuards)) {
      throw new StoreInvariantError(
        'Source-freeze transition guard proof does not match persisted authority',
      );
    }
  }

  private decodeVerifiedEvidenceRecordRow(row: unknown): EvidenceRecord {
    const record = verifyEvidenceRecordDigests(
      decodeEvidenceRecordRow(row),
      canonicalAuthorityDigests,
    );
    const generationRow = this.#database
      .prepare('SELECT * FROM candidate_generations WHERE id = ?')
      .get(record.candidateGenerationId);
    const attempt = this.getAttempt(record.attemptId);
    const workflow = this.getWorkflow(record.workflowId);
    const policy = this.getPolicyBundle(record.policyBundleId);
    const specification = this.getCheckSpecification(record.checkSpec.id);
    if (generationRow === undefined) {
      throw new StoreInvariantError(`Evidence ${record.id} has no Candidate generation`);
    }
    const decodedGeneration = decodeCandidateGenerationRow(generationRow);
    const candidateRow = this.#database
      .prepare('SELECT * FROM candidates WHERE id = ?')
      .get(decodedGeneration.generation.candidateId);
    const candidate = candidateRow === undefined ? undefined : decodeCandidateRow(candidateRow);
    const matchingObligation = this.listVerificationObligations(record.goalId).some(
      (obligation) =>
        obligation.id === record.verificationObligationId &&
        obligation.goalRevision === record.goalRevision &&
        obligation.requiredEvidenceKind === record.kind &&
        obligation.checkSpecRef === `${record.checkSpec.id}@${record.checkSpec.version}`,
    );
    if (
      attempt === undefined ||
      workflow === undefined ||
      policy === undefined ||
      specification === undefined ||
      candidate === undefined ||
      decodedGeneration.workflowId !== workflow.id ||
      candidate.goalId !== record.goalId ||
      workflow.goalId !== record.goalId ||
      workflow.goalRevision !== record.goalRevision ||
      attempt.workflowId !== workflow.id ||
      attempt.id !== record.attemptId ||
      attempt.status !== AttemptStatus.RESULT_RECORDED ||
      (record.kind === EvidenceKind.CANDIDATE_FREEZE
        ? attempt.phase !== WorkflowPhase.SOURCE_FREEZE
        : attempt.phase !== WorkflowPhase.EVIDENCE_BUILD) ||
      record.startedAt < attempt.startedAt ||
      record.endedAt > attempt.endedAt ||
      record.recordedAt !== attempt.endedAt ||
      decodedGeneration.generation.frozenDigest !== record.candidateDigest ||
      !record.checkSpec.inputRefs.includes(decodedGeneration.generation.id) ||
      policy.bundle.digest !== record.policyBundleDigest ||
      policy.installedAt > record.startedAt ||
      (record.kind === EvidenceKind.TEST_RESULT && !matchingObligation) ||
      canonicalizeJson(specification) !== canonicalizeJson(record.checkSpec)
    ) {
      throw new StoreInvariantError(`Evidence ${record.id} has stale authority bindings`);
    }
    return record;
  }

  private assertEvidenceSetBindingsCurrent(set: EvidenceSet): void {
    const obligations = this.listVerificationObligations(set.goalId).filter(
      (obligation) =>
        obligation.goalRevision === set.goalRevision &&
        obligation.candidateGenerationId === set.candidateGenerationId,
    );
    const mappingById = new Map(
      set.obligationMappings.map((mapping) => [mapping.obligationId, mapping]),
    );
    if (
      obligations.length === 0 ||
      set.evidenceRefs.length === 0 ||
      mappingById.size !== obligations.length ||
      obligations.some((obligation) => !mappingById.has(obligation.id))
    ) {
      throw new StoreInvariantError('Evidence Set does not map the complete obligation authority');
    }
    const referenced = new Map(
      set.evidenceRefs.map((reference) => [reference.evidenceId, reference]),
    );
    for (const reference of set.evidenceRefs) {
      const record = this.getEvidence(reference.evidenceId);
      const eligibility = this.getEvidenceEligibility(reference.evidenceId);
      if (
        record === undefined ||
        eligibility === undefined ||
        record.recordDigest !== reference.evidenceRecordDigest ||
        eligibility.version !== reference.eligibilityVersion ||
        eligibility.state !== EvidenceEligibilityState.ELIGIBLE ||
        reference.eligibilityState !== EvidenceEligibilityState.ELIGIBLE ||
        record.goalId !== set.goalId ||
        record.goalRevision !== set.goalRevision ||
        record.candidateGenerationId !== set.candidateGenerationId ||
        record.candidateDigest !== set.candidateDigest
      ) {
        throw new StoreInvariantError(`Evidence Set reference ${reference.evidenceId} is stale`);
      }
    }
    for (const obligation of obligations) {
      const mapping = mappingById.get(obligation.id);
      if (mapping === undefined || mapping.evidenceIds.length === 0) {
        throw new StoreInvariantError(`Obligation ${obligation.id} has no current Evidence`);
      }
      for (const identifier of mapping.evidenceIds) {
        if (!referenced.has(identifier)) {
          throw new StoreInvariantError(`Mapped Evidence ${identifier} is not in the Evidence Set`);
        }
        const record = this.getEvidence(identifier);
        if (
          record?.verificationObligationId !== obligation.id ||
          record.kind !== obligation.requiredEvidenceKind ||
          `${record.checkSpec.id}@${record.checkSpec.version}` !== obligation.checkSpecRef
        ) {
          throw new StoreInvariantError(
            `Mapped Evidence ${identifier} does not meet its Obligation`,
          );
        }
      }
    }
    try {
      verifyEvidenceSetAuthority(
        set,
        obligations,
        this.listEvidenceForGeneration(set.candidateGenerationId),
        canonicalAuthorityDigests,
      );
    } catch (error) {
      throw new StoreInvariantError(
        'Evidence Set does not equal the canonical selection from current authority',
        { cause: error },
      );
    }
  }

  private assertEvidenceSetTransitionGuardAuthority(
    workflow: WorkflowInstance,
    event: WorkflowEvent,
    set: EvidenceSet,
  ): void {
    if (
      event.type !== 'WORKFLOW_PHASE_TRANSITIONED' ||
      event.fromPhase !== WorkflowPhase.EVIDENCE_BUILD ||
      event.toPhase !== WorkflowPhase.FINAL_VERIFY
    ) {
      throw new StoreInvariantError('Evidence Set transition event has the wrong phase authority');
    }
    const authority = this.getCandidateAuthorityForWorkflow(workflow.id);
    if (authority?.generation.state !== CandidateGenerationState.FROZEN) {
      throw new StoreInvariantError('Evidence Set transition has no frozen Candidate authority');
    }
    const cleanupProven =
      set.evidenceRefs.length > 0 &&
      set.evidenceRefs.every(
        (reference) =>
          this.getEvidence(reference.evidenceId)?.checkSpec.cleanupPolicy ===
          'M1_LOGICAL_NO_EXTERNAL_RESOURCES',
      );
    if (!cleanupProven) {
      throw new StoreInvariantError('Evidence Set transition lacks M1 cleanup authority');
    }
    const expectedGuards = [
      {
        guard: WorkflowGuard.REQUIRED_EVIDENCE_ACCOUNTED,
        outcome: GuardOutcome.PASS,
        reasonCode: 'ALL_OBLIGATIONS_MAPPED',
        supportingRefs: [set.digest],
      },
      {
        guard: WorkflowGuard.EVIDENCE_BINDINGS_CURRENT,
        outcome: GuardOutcome.PASS,
        reasonCode: 'EVIDENCE_SET_CURRENT',
        supportingRefs: [
          set.digest,
          ...set.evidenceRefs.map((reference) => reference.evidenceRecordDigest),
        ],
      },
      {
        guard: WorkflowGuard.CLEANUP_PROVEN,
        outcome: GuardOutcome.PASS,
        reasonCode: 'M1_LOGICAL_CLEANUP_PROVEN',
        supportingRefs: set.evidenceRefs.map((reference) => reference.evidenceId),
      },
      {
        guard: WorkflowGuard.SOURCE_DIGEST_CURRENT,
        outcome: GuardOutcome.PASS,
        reasonCode: 'FROZEN_SOURCE_REOBSERVED',
        supportingRefs: [authority.generation.frozenDigest, authority.generation.id],
      },
    ];
    if (canonicalizeJson(event.guardResults) !== canonicalizeJson(expectedGuards)) {
      throw new StoreInvariantError(
        'Evidence Set transition guard proof does not match persisted authority',
      );
    }
  }

  private assertRetainedEvidenceSetAuthority(set: EvidenceSet): void {
    const generationRow = this.#database
      .prepare('SELECT * FROM candidate_generations WHERE id = ?')
      .get(set.candidateGenerationId);
    if (generationRow === undefined) {
      throw new StoreInvariantError(`Evidence Set ${set.digest} has no Candidate authority`);
    }
    const decodedGeneration = decodeCandidateGenerationRow(generationRow);
    const candidateRow = this.#database
      .prepare('SELECT * FROM candidates WHERE id = ?')
      .get(decodedGeneration.generation.candidateId);
    const candidate = candidateRow === undefined ? undefined : decodeCandidateRow(candidateRow);
    const workflow = this.getWorkflow(decodedGeneration.workflowId);
    const obligations = this.listVerificationObligations(set.goalId).filter(
      (obligation) =>
        obligation.goalRevision === set.goalRevision &&
        obligation.candidateGenerationId === set.candidateGenerationId,
    );
    const setAudits = this.listAuditEvents('EVIDENCE_SET', set.digest);
    const setAudit = setAudits[0];
    if (setAudit === undefined) {
      throw new StoreInvariantError(`Evidence Set ${set.digest} has no retained audit authority`);
    }
    if (
      candidate?.goalId !== set.goalId ||
      workflow?.goalId !== set.goalId ||
      workflow.goalRevision !== set.goalRevision ||
      decodedGeneration.generation.frozenDigest !== set.candidateDigest ||
      set.evidenceRefs.length === 0 ||
      set.unresolvedEvidenceRequirements.length !== 0 ||
      setAudits.length !== 1 ||
      setAudit.eventType !== 'EVIDENCE_SET_RECORDED' ||
      setAudit.actorType !== 'RUNTIME' ||
      setAudit.commandId === undefined ||
      setAudit.beforeVersion !== undefined ||
      setAudit.afterVersion !== undefined ||
      setAudit.payloadDigest !== set.digest
    ) {
      throw new StoreInvariantError(`Evidence Set ${set.digest} has invalid retained authority`);
    }

    const matchingWorkflowAudits = this.listAuditEvents(
      'WORKFLOW',
      decodedGeneration.workflowId,
    ).filter(
      (audit) =>
        audit.eventType === 'WORKFLOW_PHASE_TRANSITIONED' &&
        audit.actorType === 'RUNTIME' &&
        audit.commandId === setAudit.commandId &&
        audit.occurredAt === setAudit.occurredAt &&
        audit.sequence > setAudit.sequence &&
        audit.beforeVersion !== undefined &&
        audit.afterVersion === audit.beforeVersion + 1,
    );
    const processed = this.getProcessedCommand(setAudit.commandId);
    if (
      matchingWorkflowAudits.length !== 1 ||
      processed?.aggregateType !== 'WORKFLOW' ||
      processed.aggregateId !== decodedGeneration.workflowId ||
      processed.completedAt !== setAudit.occurredAt
    ) {
      throw new StoreInvariantError(
        `Evidence Set ${set.digest} is not closed by its Workflow command authority`,
      );
    }

    try {
      verifyEvidenceSetAuthority(
        set,
        obligations,
        this.evidenceAuthorityAtAuditSequence(set.candidateGenerationId, setAudit.sequence),
        canonicalAuthorityDigests,
      );
    } catch (error) {
      throw new StoreInvariantError(
        `Evidence Set ${set.digest} does not match authority at its recording sequence`,
        { cause: error },
      );
    }
  }

  private evidenceAuthorityAtAuditSequence(
    generationIdentifier: CandidateGenerationId,
    auditSequence: number,
  ): readonly { readonly record: EvidenceRecord; readonly eligibility: EvidenceEligibility }[] {
    const rows = this.#database
      .prepare('SELECT * FROM evidence_records WHERE candidate_generation_id = ? ORDER BY id')
      .all(generationIdentifier);
    const authority: { record: EvidenceRecord; eligibility: EvidenceEligibility }[] = [];
    for (const row of rows) {
      const record = this.decodeVerifiedEvidenceRecordRow(row);
      const history = this.#database
        .prepare('SELECT * FROM evidence_eligibility WHERE evidence_id = ? ORDER BY version')
        .all(record.id)
        .map((eligibilityRow) => decodeEvidenceEligibilityRow(eligibilityRow));
      const audits = this.listAuditEvents('EVIDENCE', record.id);
      this.assertRetainedEvidenceHistory(record, history, audits);
      const recordedAudit = audits.find(
        (audit) => audit.eventType === 'EVIDENCE_RECORDED_ELIGIBLE',
      );
      if (recordedAudit === undefined || recordedAudit.sequence >= auditSequence) {
        continue;
      }
      const invalidationAudit = audits.find(
        (audit) => audit.eventType === 'EVIDENCE_ELIGIBILITY_CHANGED',
      );
      const eligibilityVersion =
        invalidationAudit !== undefined && invalidationAudit.sequence < auditSequence ? 2 : 1;
      const eligibility = history.find((entry) => entry.version === eligibilityVersion);
      if (eligibility === undefined) {
        throw new StoreInvariantError(
          `Evidence ${record.id} has no eligibility at audit sequence ${String(auditSequence)}`,
        );
      }
      authority.push(Object.freeze({ record, eligibility }));
    }
    return Object.freeze(authority);
  }

  private assertRetainedEvidenceHistory(
    record: EvidenceRecord,
    history: readonly EvidenceEligibility[],
    audits: readonly AuditEventRecord[],
  ): void {
    const reject = (): never => {
      throw new StoreInvariantError(
        `Evidence ${record.id} has invalid retained eligibility authority`,
      );
    };
    if (history.length < 1 || history.length > 2) {
      reject();
    }
    const initial = history[0];
    if (initial === undefined) {
      throw new StoreInvariantError(
        `Evidence ${record.id} has invalid retained eligibility authority`,
      );
    }
    const recordedAudits = audits.filter(
      (audit) => audit.eventType === 'EVIDENCE_RECORDED_ELIGIBLE',
    );
    const invalidationAudits = audits.filter(
      (audit) => audit.eventType === 'EVIDENCE_ELIGIBILITY_CHANGED',
    );
    const recordedAudit = recordedAudits[0];
    if (recordedAudit === undefined) {
      throw new StoreInvariantError(
        `Evidence ${record.id} has invalid retained eligibility authority`,
      );
    }
    if (
      initial.evidenceId !== record.id ||
      initial.state !== EvidenceEligibilityState.ELIGIBLE ||
      initial.version !== 1 ||
      initial.changedAt !== record.recordedAt ||
      recordedAudits.length !== 1 ||
      recordedAudit.actorType !== 'RUNTIME' ||
      recordedAudit.commandId === undefined ||
      recordedAudit.beforeVersion !== undefined ||
      recordedAudit.afterVersion !== 1 ||
      recordedAudit.payloadDigest !== record.recordDigest ||
      recordedAudit.occurredAt !== record.recordedAt ||
      invalidationAudits.length !== history.length - 1 ||
      audits.length !== history.length
    ) {
      reject();
    }

    const invalidated = history[1];
    if (invalidated === undefined) {
      return;
    }
    const invalidationAudit = invalidationAudits[0];
    if (invalidationAudit === undefined) {
      throw new StoreInvariantError(
        `Evidence ${record.id} has invalid retained eligibility authority`,
      );
    }
    if (
      invalidated.evidenceId !== record.id ||
      invalidated.state !== EvidenceEligibilityState.INELIGIBLE ||
      invalidated.version !== 2 ||
      invalidationAudit.actorType !== 'RUNTIME' ||
      invalidationAudit.commandId === undefined ||
      invalidationAudit.beforeVersion !== 1 ||
      invalidationAudit.afterVersion !== 2 ||
      invalidationAudit.occurredAt !== invalidated.changedAt ||
      invalidationAudit.sequence <= recordedAudit.sequence
    ) {
      reject();
    }
  }

  private updateWorkflow(current: WorkflowInstance, next: WorkflowInstance): void {
    const update = this.#database
      .prepare(
        `UPDATE workflows
            SET phase = ?, run_status = ?, version = ?, active_attempt_id = ?,
                active_candidate_generation_id = ?, suspended_reason = ?, updated_at = ?
          WHERE id = ? AND version = ?`,
      )
      .run(
        next.phase,
        next.runStatus,
        next.version,
        next.activeAttemptId ?? null,
        next.activeCandidateGenerationId ?? null,
        next.suspendedReason ?? null,
        next.updatedAt,
        next.id,
        current.version,
      );
    if (update.changes !== 1) {
      throw new OptimisticConcurrencyError('Workflow', current.id);
    }
  }

  private checkCommand(
    commandIdentifier: CommandId,
    inputDigest: Sha256Digest,
    aggregateType: string,
    aggregateId: string,
  ): ProcessedCommandRecord | undefined {
    const row = this.#database
      .prepare('SELECT * FROM processed_commands WHERE command_id = ?')
      .get(commandIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const existing = decodeProcessedCommand(row);
    this.validateProcessedCommandRecord(existing);
    if (
      existing.inputDigest !== inputDigest ||
      existing.aggregateType !== aggregateType ||
      existing.aggregateId !== aggregateId
    ) {
      throw new CommandIdConflictError(commandIdentifier);
    }
    return existing;
  }

  private validateProcessedCommandRecord(record: ProcessedCommandRecord): void {
    const target = decodeCommandTarget({
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
    });
    const envelope = decodeStoredCommandOutcome(record.outcome);
    assertStoredCommandOutcomeBinding(
      envelope,
      record.commandId,
      target,
      envelope.goalId,
      envelope.workflow.id,
    );
  }

  private assertProcessedCommandReadable(
    commandIdentifier: CommandId,
    inputDigest: Sha256Digest,
    target: CommandTarget,
    expectedGoalId: GoalId,
    expectedWorkflowId: WorkflowId,
    disposition: StoredCommandDisposition,
  ): ProcessedCommandRecord {
    const record = this.getProcessedCommand(commandIdentifier);
    if (record === undefined) {
      throw new StoreInvariantError(`Processed command ${commandIdentifier} was not persisted`);
    }
    if (
      record.inputDigest !== inputDigest ||
      record.aggregateType !== target.aggregateType ||
      record.aggregateId !== target.aggregateId
    ) {
      throw new StoreInvariantError(
        `Processed command ${commandIdentifier} does not match its committed command`,
      );
    }
    const envelope = decodeStoredCommandOutcome(record.outcome);
    assertStoredCommandOutcomeBinding(
      envelope,
      commandIdentifier,
      target,
      expectedGoalId,
      expectedWorkflowId,
      disposition,
    );
    return record;
  }

  private assertAuditEventsReadable(eventIdentifiers: readonly AuditEventId[]): void {
    const select = this.#database.prepare(
      `SELECT id, sequence, aggregate_type, aggregate_id, event_type, actor_type,
              command_id, before_version, after_version, correlation_id, causation_id,
              payload_digest, occurred_at
         FROM audit_events
        WHERE id = ?`,
    );
    for (const eventIdentifier of eventIdentifiers) {
      const row = select.get(eventIdentifier);
      if (row === undefined || decodeAuditEvent(row).id !== eventIdentifier) {
        throw new StoreInvariantError(`Audit event ${eventIdentifier} was not persisted readably`);
      }
    }
  }

  private insertAuditEvent(input: InsertAuditInput): void {
    this.#database
      .prepare(
        `INSERT INTO audit_events(
           id, aggregate_type, aggregate_id, event_type, actor_type, command_id,
           before_version, after_version, correlation_id, causation_id, payload_digest,
           occurred_at
         ) VALUES (?, ?, ?, ?, 'RUNTIME', ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.id,
        input.aggregateType,
        input.aggregateId,
        input.eventType,
        input.commandId ?? null,
        input.beforeVersion ?? null,
        input.afterVersion ?? null,
        input.correlationId ?? null,
        input.causationId ?? null,
        input.payloadDigest,
        input.occurredAt,
      );
  }

  private insertContextManifest(manifest: ContextManifest): void {
    this.#database
      .prepare(
        `INSERT INTO context_manifests(
           id, schema_version, compiler_version, created_at, goal_id, goal_revision,
           workflow_id, workflow_version, phase, attempt_id, candidate_generation_id,
           candidate_digest, policy_bundle_id, policy_bundle_digest,
           capability_grant_digest, response_contract_digest, entries_json,
           omission_decisions_json, package_digest, manifest_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        manifest.id,
        manifest.schemaVersion,
        manifest.compilerVersion,
        manifest.createdAt,
        manifest.goalId,
        manifest.goalRevision,
        manifest.workflowId,
        manifest.workflowVersion,
        manifest.phase,
        manifest.attemptId,
        manifest.candidateGenerationId ?? null,
        manifest.candidateDigest ?? null,
        manifest.policyBundleId,
        manifest.policyBundleDigest,
        manifest.capabilityGrantDigest,
        manifest.responseContractDigest,
        serializeJson(decodeJsonValue(manifest.entries)),
        serializeJson(decodeJsonValue(manifest.omissionDecisions)),
        manifest.packageDigest,
        manifest.manifestDigest,
      );
  }

  private policyDigest(bundle: PolicyBundle): Sha256Digest {
    return sha256Digest(canonicalAuthorityDigests.digest(policyBundleProjection(bundle)));
  }

  private decodeVerifiedContextManifestRow(row: unknown): ContextManifest {
    const manifest = decodeContextManifestRow(row);
    if (
      manifest.omissionDecisions.length !== 0 ||
      manifest.entries.some(
        (entry) =>
          entry.kind !== ContextEntryKind.GOAL &&
          entry.kind !== ContextEntryKind.SUCCESS_CRITERION &&
          entry.kind !== ContextEntryKind.CANDIDATE,
      )
    ) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} contains authority without an M1 owner`,
      );
    }

    const expectedManifestDigest = sha256Digest(
      canonicalAuthorityDigests.digest(contextManifestDigestProjection(manifest)),
    );
    if (manifest.manifestDigest !== expectedManifestDigest) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} digest does not match its canonical projection`,
      );
    }

    const goalView = this.getGoalWithWorkflow(manifest.goalId);
    const attempt = this.getAttempt(manifest.attemptId);
    const installedPolicy = this.getPolicyBundle(manifest.policyBundleId);
    if (goalView === undefined || attempt === undefined || installedPolicy === undefined) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} cannot resolve its authoritative M1 sources`,
      );
    }
    const { goal, workflow } = goalView;
    let candidateBinding:
      { readonly generationId: CandidateGenerationId; readonly digest: Sha256Digest } | undefined;
    if (manifest.phase === WorkflowPhase.IMPLEMENT) {
      if (manifest.candidateGenerationId === undefined || manifest.candidateDigest === undefined) {
        throw new StoreInvariantError(
          `IMPLEMENT Context Manifest ${manifest.id} has no Candidate binding`,
        );
      }
      const generationRow = this.#database
        .prepare('SELECT * FROM candidate_generations WHERE id = ?')
        .get(manifest.candidateGenerationId);
      if (generationRow === undefined) {
        throw new StoreInvariantError(
          `Context Manifest ${manifest.id} cannot resolve its Candidate generation`,
        );
      }
      const decodedGeneration = decodeCandidateGenerationRow(generationRow);
      const candidateRow = this.#database
        .prepare('SELECT * FROM candidates WHERE id = ?')
        .get(decodedGeneration.generation.candidateId);
      const candidate = candidateRow === undefined ? undefined : decodeCandidateRow(candidateRow);
      if (
        candidate === undefined ||
        decodedGeneration.workflowId !== workflow.id ||
        candidate.goalId !== goal.id ||
        decodedGeneration.generation.baseDigest !== manifest.candidateDigest ||
        decodedGeneration.generation.createdAt > manifest.createdAt
      ) {
        throw new StoreInvariantError(
          `Context Manifest ${manifest.id} has stale Candidate source authority`,
        );
      }
      candidateBinding = Object.freeze({
        generationId: decodedGeneration.generation.id,
        digest: decodedGeneration.generation.baseDigest,
      });
    } else if (
      manifest.candidateGenerationId !== undefined ||
      manifest.candidateDigest !== undefined ||
      manifest.entries.some((entry) => entry.kind === ContextEntryKind.CANDIDATE)
    ) {
      throw new StoreInvariantError(
        `Non-IMPLEMENT Context Manifest ${manifest.id} contains Candidate authority`,
      );
    }
    if (
      manifest.goalRevision !== goal.revision ||
      manifest.workflowId !== workflow.id ||
      manifest.workflowVersion > workflow.version ||
      manifest.phase !== attempt.phase ||
      attempt.workflowId !== workflow.id ||
      attempt.contextManifestId !== manifest.id ||
      attempt.workerSessionRef === undefined ||
      manifest.createdAt !== attempt.startedAt ||
      manifest.createdAt < workflow.createdAt ||
      manifest.policyBundleDigest !== installedPolicy.bundle.digest ||
      installedPolicy.installedAt > manifest.createdAt
    ) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} does not bind its authoritative M1 sources`,
      );
    }

    const expectedPackage = decodeContextPackage({
      schemaVersion: 1,
      goalId: goal.id,
      goalRevision: goal.revision,
      workflowId: workflow.id,
      workflowVersion: manifest.workflowVersion,
      phase: manifest.phase,
      attemptId: attempt.id,
      phaseObjective: m1PhaseObjective(manifest.phase),
      capabilityGrant: attempt.capabilityGrant,
      goal: {
        objective: goal.objective,
        successCriteria: goal.successCriteria,
        scope: goal.scope,
        nonGoals: goal.nonGoals,
      },
      selectedEntries: [],
      ...(candidateBinding === undefined
        ? {}
        : {
            candidateGenerationId: candidateBinding.generationId,
            candidateDigest: candidateBinding.digest,
          }),
      policyBundleId: installedPolicy.bundle.id,
      policyBundleDigest: installedPolicy.bundle.digest,
      responseContract: m1WorkerResponseContract(manifest.phase),
    });
    const expectedEntries = deriveContextManifestEntries(
      expectedPackage,
      canonicalAuthorityDigests,
    );
    const expectedPackageDigest = sha256Digest(canonicalAuthorityDigests.digest(expectedPackage));
    const expectedCapabilityGrantDigest = sha256Digest(
      canonicalAuthorityDigests.digest({
        schemaVersion: 1,
        capabilityGrant: expectedPackage.capabilityGrant,
      }),
    );
    const expectedResponseContractDigest = sha256Digest(
      canonicalAuthorityDigests.digest({
        schemaVersion: 1,
        responseContract: expectedPackage.responseContract,
      }),
    );
    if (
      manifest.packageDigest !== expectedPackageDigest ||
      manifest.capabilityGrantDigest !== expectedCapabilityGrantDigest ||
      manifest.responseContractDigest !== expectedResponseContractDigest ||
      canonicalizeJson(manifest.entries) !== canonicalizeJson(expectedEntries)
    ) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} does not match its authoritative M1 sources`,
      );
    }
    return manifest;
  }

  private decodeVerifiedPolicyBundleRow(row: unknown): InstalledPolicyBundle {
    const installed = decodePolicyBundleRow(row);
    if (installed.bundle.digest !== this.policyDigest(installed.bundle)) {
      throw new StoreInvariantError(
        `Policy ${installed.bundle.id} digest does not match its canonical projection`,
      );
    }
    return installed;
  }

  private assertAttemptControlEventAfterDispatchClaim(
    attempt: Attempt | undefined,
    expectedWorkflowId: WorkflowId,
    expectedWorkflowVersion: WorkflowVersion,
    occurredAt: IsoTimestamp,
  ): void {
    if (attempt === undefined) {
      throw new StoreInvariantError('Attempt control event has no current Attempt authority');
    }
    const claim = this.getWorkerDispatchClaim(attempt.id);
    if (claim === undefined) {
      return;
    }
    const manifest = this.getContextManifest(claim.contextManifestId);
    if (
      manifest === undefined ||
      attempt.workflowId !== expectedWorkflowId ||
      attempt.contextManifestId !== claim.contextManifestId ||
      attempt.workerSessionRef !== claim.workerSessionId ||
      claim.workflowId !== expectedWorkflowId ||
      claim.workflowVersion !== expectedWorkflowVersion ||
      claim.attemptId !== attempt.id ||
      manifest.workflowId !== expectedWorkflowId ||
      manifest.workflowVersion !== claim.workflowVersion ||
      manifest.attemptId !== attempt.id ||
      manifest.manifestDigest !== claim.contextManifestDigest ||
      manifest.packageDigest !== claim.packageDigest
    ) {
      throw new StoreInvariantError(
        `Attempt ${attempt.id} control event does not bind its dispatch authority`,
      );
    }
    if (occurredAt < claim.claimedAt) {
      throw new StoreInvariantError(
        `Attempt ${attempt.id} control event predates its dispatch claim`,
      );
    }
  }

  private assertRetainedDispatchClaimClosure(claim: WorkerDispatchClaim): void {
    const workflow = this.getWorkflow(claim.workflowId);
    const attempt = this.getAttempt(claim.attemptId);
    const manifest = this.getContextManifest(claim.contextManifestId);
    if (
      workflow === undefined ||
      attempt === undefined ||
      manifest === undefined ||
      workflow.version < claim.workflowVersion ||
      attempt.workflowId !== claim.workflowId ||
      attempt.contextManifestId !== claim.contextManifestId ||
      attempt.workerSessionRef !== claim.workerSessionId ||
      manifest.workflowId !== claim.workflowId ||
      manifest.workflowVersion !== claim.workflowVersion ||
      manifest.attemptId !== claim.attemptId ||
      manifest.manifestDigest !== claim.contextManifestDigest ||
      manifest.packageDigest !== claim.packageDigest ||
      claim.claimedAt < attempt.startedAt
    ) {
      throw new StoreInvariantError(
        `Dispatch claim for ${claim.attemptId} does not bind retained authority`,
      );
    }
    if (attempt.status === AttemptStatus.RUNNING) {
      if (
        workflow.version !== claim.workflowVersion ||
        workflow.runStatus !== RunStatus.RUNNING ||
        workflow.activeAttemptId !== attempt.id ||
        claim.claimedAt < workflow.updatedAt
      ) {
        throw new StoreInvariantError(
          `Running Attempt ${attempt.id} does not retain its dispatch-time Workflow authority`,
        );
      }
      return;
    }
    if (attempt.endedAt < claim.claimedAt) {
      throw new StoreInvariantError(
        `Attempt ${attempt.id} ended before its retained dispatch claim`,
      );
    }
    if (
      workflow.version <= claim.workflowVersion ||
      workflow.updatedAt < attempt.endedAt ||
      workflow.activeAttemptId === attempt.id
    ) {
      throw new StoreInvariantError(
        `Terminal Attempt ${attempt.id} does not retain its post-dispatch Workflow authority`,
      );
    }
  }

  private assertRetainedWorkerAuthorityClosure(): void {
    if (this.hasTable('attempts')) {
      const attemptRows = this.#database.prepare('SELECT * FROM attempts ORDER BY id').all();
      for (const row of attemptRows) {
        const attempt = decodeAttempt(row);
        assertKnownWorkerFailureClassificationFields(
          attempt.terminationReason,
          attempt.status,
          attempt.failureClass,
        );
      }
    }

    if (this.hasTable('policy_bundles')) {
      const rows = this.#database.prepare('SELECT * FROM policy_bundles ORDER BY id').all();
      for (const row of rows) {
        const installed = this.decodeVerifiedPolicyBundleRow(row);
        const matchingAudit = this.listAuditEvents('POLICY', installed.bundle.id).some(
          (audit) =>
            audit.eventType === 'POLICY_BUNDLE_INSTALLED' &&
            audit.actorType === 'RUNTIME' &&
            audit.commandId === undefined &&
            audit.beforeVersion === undefined &&
            audit.afterVersion === undefined &&
            audit.payloadDigest === installed.bundle.digest &&
            audit.occurredAt === installed.installedAt,
        );
        if (!matchingAudit) {
          throw new StoreInvariantError(
            `Policy ${installed.bundle.id} has no matching installation audit authority`,
          );
        }
      }
    }

    if (this.hasTable('context_manifests')) {
      const rows = this.#database.prepare('SELECT * FROM context_manifests ORDER BY id').all();
      for (const row of rows) {
        this.decodeVerifiedContextManifestRow(row);
      }
    }

    if (this.hasTable('worker_dispatch_claims')) {
      const rows = this.#database
        .prepare('SELECT * FROM worker_dispatch_claims ORDER BY attempt_id')
        .all();
      for (const row of rows) {
        this.assertRetainedDispatchClaimClosure(decodeWorkerDispatchClaimRow(row));
      }
    }

    if (this.hasTable('worker_event_receipts')) {
      const rows = this.#database
        .prepare('SELECT * FROM worker_event_receipts ORDER BY event_id')
        .all();
      for (const row of rows) {
        const receipt = decodeWorkerEventReceiptRow(row);
        if (receipt.disposition === 'ADMITTED') {
          this.assertAdmittedWorkerEventHasDispatchClaim(receipt);
        } else {
          this.assertWorkerEventHasDispatchCausality(receipt);
        }
      }
    }
  }

  private assertRetainedCandidateEvidenceAuthorityClosure(): void {
    if (!this.hasTable('candidates')) {
      return;
    }
    const candidateRows = this.#database.prepare('SELECT * FROM candidates ORDER BY id').all();
    for (const row of candidateRows) {
      const candidate = decodeCandidateRow(row);
      const goal = this.getGoal(candidate.goalId);
      const matchingAudit = this.listAuditEvents('CANDIDATE', candidate.id).some(
        (audit) =>
          audit.eventType === 'CANDIDATE_CREATED' &&
          audit.actorType === 'RUNTIME' &&
          audit.commandId !== undefined,
      );
      if (
        goal === undefined ||
        candidate.baseProjectIdentity !==
          deriveM1BaseProjectIdentity(goal.scope.projectPath, canonicalAuthorityDigests) ||
        !matchingAudit
      ) {
        throw new StoreInvariantError(
          `Candidate ${candidate.id} has no Goal or creation audit authority`,
        );
      }
    }

    const generationRows = this.#database
      .prepare('SELECT * FROM candidate_generations ORDER BY id')
      .all();
    for (const row of generationRows) {
      const decoded = decodeCandidateGenerationRow(row);
      const candidateRow = this.#database
        .prepare('SELECT * FROM candidates WHERE id = ?')
        .get(decoded.generation.candidateId);
      const candidate = candidateRow === undefined ? undefined : decodeCandidateRow(candidateRow);
      const workflow = this.getWorkflow(decoded.workflowId);
      const audits = this.listAuditEvents('CANDIDATE_GENERATION', decoded.generation.id);
      const creation = audits.filter(
        (audit) => audit.eventType === 'CANDIDATE_GENERATION_CREATED' && audit.afterVersion === 1,
      );
      const transitions = audits.filter((audit) => audit.eventType === 'CANDIDATE_STATE_CHANGED');
      if (
        candidate?.goalId === undefined ||
        candidate.goalId !== workflow?.goalId ||
        decoded.generation.workspaceIdentity !== deriveM1WorkspaceIdentity(decoded.generation.id) ||
        creation.length !== 1 ||
        transitions.length !== decoded.generation.version - 1 ||
        transitions.some(
          (audit, index) => audit.beforeVersion !== index + 1 || audit.afterVersion !== index + 2,
        )
      ) {
        throw new StoreInvariantError(
          `Candidate generation ${decoded.generation.id} has incomplete retained authority`,
        );
      }
    }

    if (this.hasTable('check_specifications')) {
      const rows = this.#database.prepare('SELECT * FROM check_specifications ORDER BY id').all();
      for (const row of rows) {
        const specification = decodeCheckSpecificationRow(row);
        if (
          !this.listAuditEvents('CHECK_SPECIFICATION', specification.id).some(
            (audit) => audit.eventType === 'CHECK_SPECIFICATION_RECORDED',
          )
        ) {
          throw new StoreInvariantError(
            `Check Specification ${specification.id} has no recording audit`,
          );
        }
      }
    }

    const obligationRows = this.#database
      .prepare('SELECT * FROM verification_obligations ORDER BY id')
      .all();
    for (const row of obligationRows) {
      const obligation = decodeVerificationObligationRow(row);
      const goal = this.getGoal(obligation.goalId);
      const checkIdentifier = obligation.checkSpecRef.split('@', 1)[0];
      const check =
        checkIdentifier === undefined
          ? undefined
          : this.getCheckSpecification(checkSpecificationId(checkIdentifier));
      if (
        goal?.revision !== obligation.goalRevision ||
        check === undefined ||
        `${check.id}@${check.version}` !== obligation.checkSpecRef ||
        !this.listAuditEvents('VERIFICATION_OBLIGATION', obligation.id).some(
          (audit) => audit.eventType === 'VERIFICATION_OBLIGATION_RECORDED',
        )
      ) {
        throw new StoreInvariantError(
          `Verification Obligation ${obligation.id} has stale retained authority`,
        );
      }
    }

    for (const row of generationRows) {
      const generation = decodeCandidateGenerationRow(row).generation;
      const candidateRow = this.#database
        .prepare('SELECT * FROM candidates WHERE id = ?')
        .get(generation.candidateId);
      const candidate = candidateRow === undefined ? undefined : decodeCandidateRow(candidateRow);
      const goal = candidate === undefined ? undefined : this.getGoal(candidate.goalId);
      const relatedSpecifications = this.listCheckSpecifications().filter(
        (specification) =>
          specification.inputRefs.length === 1 && specification.inputRefs[0] === generation.id,
      );
      const freeze = relatedSpecifications.find(
        (specification) => specification.kind === CheckSpecificationKind.CANDIDATE_FREEZE,
      );
      const verification = relatedSpecifications.find(
        (specification) => specification.kind === CheckSpecificationKind.FAKE_VERIFICATION,
      );
      if (
        goal === undefined ||
        relatedSpecifications.length !== 2 ||
        freeze === undefined ||
        verification === undefined
      ) {
        throw new StoreInvariantError(
          `Candidate generation ${generation.id} has incomplete M1 Check authority`,
        );
      }
      const obligations = this.listVerificationObligations(goal.id).filter(
        (obligation) => obligation.candidateGenerationId === generation.id,
      );
      validateM1CandidateEvidencePolicy(
        goal,
        generation,
        { freeze, verification, obligations },
        generation.createdAt,
      );
    }

    const evidenceRows = this.#database.prepare('SELECT * FROM evidence_records ORDER BY id').all();
    for (const row of evidenceRows) {
      const record = this.decodeVerifiedEvidenceRecordRow(row);
      const history = this.#database
        .prepare('SELECT * FROM evidence_eligibility WHERE evidence_id = ? ORDER BY version')
        .all(record.id)
        .map((eligibilityRow) => decodeEvidenceEligibilityRow(eligibilityRow));
      this.assertRetainedEvidenceHistory(
        record,
        history,
        this.listAuditEvents('EVIDENCE', record.id),
      );
    }

    for (const row of generationRows) {
      const generation = decodeCandidateGenerationRow(row).generation;
      if (
        generation.state === CandidateGenerationState.INVALIDATED &&
        this.listEvidenceForGeneration(generation.id).some(
          ({ eligibility }) => eligibility.state === EvidenceEligibilityState.ELIGIBLE,
        )
      ) {
        throw new StoreInvariantError(
          `Invalidated Candidate generation ${generation.id} retains eligible Evidence`,
        );
      }
    }

    if (this.hasTable('evidence_sets')) {
      const rows = this.#database.prepare('SELECT * FROM evidence_sets ORDER BY digest').all();
      for (const row of rows) {
        const set = decodeEvidenceSetRow(row);
        if (this.getEvidenceSet(set.digest) === undefined) {
          throw new StoreInvariantError(`Evidence Set ${set.digest} disappeared on reopen`);
        }
      }
    }
  }

  private historicalAcceptanceForManifest(manifest: AcceptanceInputManifest) {
    const goal = this.getGoal(manifest.goalId);
    const currentWorkflow = this.getWorkflow(manifest.workflowId);
    const candidate = this.getCandidateForGoal(manifest.goalId);
    const currentGeneration = this.getCandidateGeneration(manifest.candidateGenerationId);
    const installedPolicy = this.getPolicyBundle(manifest.policyBundleId);
    const evidenceSet = this.getEvidenceSet(manifest.evidenceSetDigest);
    if (
      goal === undefined ||
      currentWorkflow === undefined ||
      candidate === undefined ||
      currentGeneration === undefined ||
      installedPolicy === undefined ||
      evidenceSet === undefined ||
      goal.revision !== manifest.goalRevision ||
      currentWorkflow.goalId !== goal.id ||
      currentGeneration.candidateId !== candidate.id ||
      currentGeneration.frozenDigest !== manifest.candidateDigest ||
      installedPolicy.bundle.digest !== manifest.policyBundleDigest ||
      installedPolicy.installedAt > manifest.createdAt
    ) {
      throw new StoreInvariantError(
        `Acceptance Input Manifest ${manifest.manifestDigest} has missing historical authority`,
      );
    }
    const historicalGenerationVersion =
      currentGeneration.state === CandidateGenerationState.FROZEN
        ? currentGeneration.version
        : currentGeneration.version - 1;
    const historicalGeneration = decodeCandidateGeneration({
      id: currentGeneration.id,
      candidateId: currentGeneration.candidateId,
      sequence: currentGeneration.sequence,
      ...(currentGeneration.parentGenerationId === undefined
        ? {}
        : { parentGenerationId: currentGeneration.parentGenerationId }),
      workspaceIdentity: currentGeneration.workspaceIdentity,
      state: CandidateGenerationState.FROZEN,
      baseDigest: currentGeneration.baseDigest,
      frozenDigest: currentGeneration.frozenDigest,
      version: historicalGenerationVersion,
      createdAt: currentGeneration.createdAt,
      updatedAt: currentGeneration.frozenAt,
      frozenAt: currentGeneration.frozenAt,
    });
    const historicalWorkflow = decodeWorkflowSnapshot({
      id: currentWorkflow.id,
      goalId: currentWorkflow.goalId,
      goalRevision: currentWorkflow.goalRevision,
      phase: WorkflowPhase.FINAL_VERIFY,
      runStatus: RunStatus.READY,
      version: manifest.workflowVersion,
      activeCandidateGenerationId: manifest.candidateGenerationId,
      createdAt: currentWorkflow.createdAt,
      updatedAt: manifest.createdAt,
    });
    const relatedSpecifications = this.listCheckSpecifications().filter((specification) =>
      specification.inputRefs.includes(historicalGeneration.id),
    );
    const freezeCheck = relatedSpecifications.find(
      (specification) => specification.kind === CheckSpecificationKind.CANDIDATE_FREEZE,
    );
    const verificationCheck = relatedSpecifications.find(
      (specification) => specification.kind === CheckSpecificationKind.FAKE_VERIFICATION,
    );
    if (
      relatedSpecifications.length !== 2 ||
      freezeCheck === undefined ||
      verificationCheck === undefined
    ) {
      throw new StoreInvariantError(
        `Acceptance Input Manifest ${manifest.manifestDigest} has incomplete Check authority`,
      );
    }
    const obligations = Object.freeze(
      this.listVerificationObligations(goal.id).filter(
        (obligation) =>
          obligation.goalRevision === goal.revision &&
          obligation.candidateGenerationId === historicalGeneration.id,
      ),
    );
    const historicalEvidence = Object.freeze(
      evidenceSet.evidenceRefs.map((reference) => {
        const record = this.getEvidence(reference.evidenceId);
        const eligibilityRow = this.#database
          .prepare(
            `SELECT * FROM evidence_eligibility
              WHERE evidence_id = ? AND version = ?`,
          )
          .get(reference.evidenceId, reference.eligibilityVersion);
        if (record === undefined || eligibilityRow === undefined) {
          throw new StoreInvariantError(
            `Acceptance Evidence ${reference.evidenceId} lacks historical eligibility`,
          );
        }
        return Object.freeze({
          record,
          eligibility: decodeEvidenceEligibilityRow(eligibilityRow),
        });
      }),
    );
    const pendingIssues = Object.freeze(
      this.#database
        .prepare(
          `SELECT * FROM pending_issues
            WHERE goal_id = ? AND goal_revision = ?
            ORDER BY id`,
        )
        .all(goal.id, goal.revision)
        .map((row) => decodePendingIssueRow(row)),
    );
    const compiled = compileM1AcceptanceInput(
      Object.freeze({
        goal,
        workflow: historicalWorkflow,
        candidate,
        generation: historicalGeneration,
        freezeCheck,
        verificationCheck,
        obligations,
        evidenceSet,
        currentEvidence: historicalEvidence,
        pendingIssues,
        retainedFactCount: this.readCount(
          'SELECT COUNT(*) AS count FROM facts WHERE goal_id = ?',
          goal.id,
        ),
        retainedDecisionCount: this.readCount(
          'SELECT COUNT(*) AS count FROM human_decisions WHERE goal_id = ?',
          goal.id,
        ),
        policyBundle: installedPolicy.bundle,
      }),
      manifest.createdAt,
      canonicalAuthorityDigests,
    );
    if (canonicalizeJson(compiled.manifest) !== canonicalizeJson(manifest)) {
      throw new StoreInvariantError(
        `Acceptance Input Manifest ${manifest.manifestDigest} cannot be reconstructed`,
      );
    }
    return compiled;
  }

  private assertRetainedAcceptanceAuthorityClosure(): void {
    if (!this.hasTable('workflow_closeouts')) {
      return;
    }
    const issueRows = this.#database.prepare('SELECT * FROM pending_issues ORDER BY id').all();
    for (const row of issueRows) {
      const issue = decodePendingIssueRow(row);
      const audits = this.listAuditEvents('PENDING_ISSUE', issue.id);
      const recordedAudits = audits.filter(
        (audit) =>
          audit.eventType === 'PENDING_ISSUE_RECORDED' &&
          audit.actorType === 'RUNTIME' &&
          audit.occurredAt === issue.createdAt,
      );
      const resolvedAudits = audits.filter(
        (audit) =>
          audit.eventType === 'PENDING_ISSUE_RESOLVED' &&
          audit.actorType === 'RUNTIME' &&
          audit.occurredAt === issue.resolvedAt,
      );
      if (
        recordedAudits.length !== 1 ||
        resolvedAudits.length !== (issue.resolvedAt === undefined ? 0 : 1)
      ) {
        throw new StoreInvariantError(`Pending Issue ${issue.id} lacks retained audit authority`);
      }
    }

    const manifestRows = this.#database
      .prepare('SELECT * FROM acceptance_input_manifests ORDER BY manifest_digest')
      .all();
    const compiledByDigest = new Map<
      string,
      ReturnType<SqliteControlStore['historicalAcceptanceForManifest']>
    >();
    for (const row of manifestRows) {
      const decoded = decodeAcceptanceInputManifestRow(row);
      const manifest = this.getAcceptanceInputManifest(decoded.manifestDigest);
      const audit = this.listAuditEvents(
        'ACCEPTANCE_INPUT_MANIFEST',
        decoded.manifestDigest,
      ).filter((candidate) => candidate.eventType === 'ACCEPTANCE_INPUT_MANIFEST_RECORDED');
      if (
        manifest === undefined ||
        audit.length !== 1 ||
        audit[0]?.actorType !== 'RUNTIME' ||
        audit[0].commandId === undefined ||
        audit[0].payloadDigest !== manifest.manifestDigest ||
        audit[0].occurredAt !== manifest.createdAt
      ) {
        throw new StoreInvariantError(
          `Acceptance Input Manifest ${decoded.manifestDigest} lacks retained audit authority`,
        );
      }
      compiledByDigest.set(manifest.manifestDigest, this.historicalAcceptanceForManifest(manifest));
    }

    const semanticDigests = new Map<string, Sha256Digest>();
    const decisionRows = this.#database
      .prepare('SELECT * FROM acceptance_decisions ORDER BY id')
      .all();
    for (const row of decisionRows) {
      const decoded = decodeAcceptanceDecisionRow(row);
      const decision = this.getAcceptanceDecision(decoded.id);
      const compiled = compiledByDigest.get(decoded.inputManifestDigest);
      const audit = this.listAuditEvents('ACCEPTANCE_DECISION', decoded.id).filter(
        (candidate) => candidate.eventType === 'ACCEPTANCE_DECISION_ISSUED',
      );
      if (
        decision === undefined ||
        compiled === undefined ||
        audit.length !== 1 ||
        audit[0]?.actorType !== 'RUNTIME' ||
        audit[0].commandId === undefined ||
        audit[0].payloadDigest !== decision.decisionDigest ||
        audit[0].occurredAt !== decision.issuedAt
      ) {
        throw new StoreInvariantError(
          `Acceptance Decision ${decoded.id} lacks retained input or audit authority`,
        );
      }
      verifyM1AcceptanceDecision(compiled, decision, canonicalAuthorityDigests);
      const semanticKey = `${decision.inputManifestDigest}\u0000${decision.policyBundleDigest}\u0000${decision.engineVersion}`;
      const priorDigest = semanticDigests.get(semanticKey);
      if (priorDigest !== undefined && priorDigest !== decision.decisionDigest) {
        throw new StoreInvariantError(
          'Retained Acceptance Decisions contradict one semantic input',
        );
      }
      semanticDigests.set(semanticKey, decision.decisionDigest);
    }

    const closeoutRows = this.#database
      .prepare('SELECT * FROM workflow_closeouts ORDER BY workflow_id')
      .all();
    for (const row of closeoutRows) {
      const closeout = decodeCloseoutRow(row);
      const workflow = this.getWorkflow(closeout.workflowId);
      const goal = workflow === undefined ? undefined : this.getGoal(workflow.goalId);
      const generation = this.getCandidateGeneration(closeout.candidateGenerationId);
      const decision = this.getAcceptanceDecision(closeout.acceptanceDecisionId);
      const manifest = this.getAcceptanceInputManifest(closeout.inputManifestDigest);
      const audit = this.listAuditEvents('WORKFLOW_CLOSEOUT', closeout.workflowId).filter(
        (candidate) => candidate.eventType === 'WORKFLOW_CLOSEOUT_RECORDED',
      );
      const candidateAudit =
        generation === undefined
          ? []
          : this.listAuditEvents('CANDIDATE_GENERATION', generation.id).filter(
              (candidate) =>
                candidate.eventType === 'CANDIDATE_STATE_CHANGED' &&
                candidate.beforeVersion === generation.version - 1 &&
                candidate.afterVersion === generation.version &&
                candidate.occurredAt === closeout.closedAt,
            );
      const workflowAudit =
        workflow === undefined
          ? []
          : this.listAuditEvents('WORKFLOW', workflow.id).filter(
              (candidate) =>
                candidate.eventType === 'WORKFLOW_PHASE_TRANSITIONED' &&
                candidate.beforeVersion === workflow.version - 1 &&
                candidate.afterVersion === workflow.version &&
                candidate.occurredAt === closeout.closedAt,
            );
      const compoundAudit = audit[0];
      const compoundAuditMatches =
        audit.length === 1 &&
        candidateAudit.length === 1 &&
        workflowAudit.length === 1 &&
        compoundAudit?.actorType === 'RUNTIME' &&
        compoundAudit.commandId !== undefined &&
        [candidateAudit[0], workflowAudit[0]].every(
          (candidate) =>
            candidate?.actorType === 'RUNTIME' &&
            candidate.commandId === compoundAudit.commandId &&
            candidate.payloadDigest === compoundAudit.payloadDigest &&
            candidate.correlationId === compoundAudit.correlationId &&
            candidate.causationId === compoundAudit.causationId,
        );
      if (
        workflow?.phase !== WorkflowPhase.CLOSEOUT ||
        workflow.runStatus !== RunStatus.CLOSED ||
        workflow.goalId !== closeout.goalId ||
        workflow.goalRevision !== closeout.goalRevision ||
        workflow.version !== closeout.workflowVersion ||
        workflow.updatedAt !== closeout.closedAt ||
        goal?.status !== GoalStatus.CLOSED ||
        goal.updatedAt !== closeout.closedAt ||
        generation?.state !== CandidateGenerationState.ACCEPTED ||
        generation.updatedAt !== closeout.closedAt ||
        generation.frozenDigest !== closeout.candidateDigest ||
        decision?.outcome !== AcceptanceOutcome.ACCEPT ||
        decision.issuedAt > closeout.closedAt ||
        decision.decisionDigest !== closeout.acceptanceDecisionDigest ||
        decision.policyBundleDigest !== closeout.policyBundleDigest ||
        decision.inputManifestDigest !== manifest?.manifestDigest ||
        manifest.goalId !== closeout.goalId ||
        manifest.goalRevision !== closeout.goalRevision ||
        manifest.workflowId !== closeout.workflowId ||
        manifest.workflowVersion + 1 !== closeout.workflowVersion ||
        manifest.candidateGenerationId !== closeout.candidateGenerationId ||
        manifest.candidateDigest !== closeout.candidateDigest ||
        manifest.evidenceSetDigest !== closeout.evidenceSetDigest ||
        manifest.policyBundleId !== closeout.policyBundleId ||
        manifest.policyBundleDigest !== closeout.policyBundleDigest ||
        !compoundAuditMatches ||
        compoundAudit.occurredAt !== closeout.closedAt
      ) {
        throw new StoreInvariantError(
          `Workflow closeout ${closeout.workflowId} lacks exact retained authority`,
        );
      }
    }
    const closedWithoutCloseout = this.readCount(
      `SELECT COUNT(*) AS count
         FROM workflows AS workflow
        WHERE workflow.run_status = 'CLOSED'
          AND NOT EXISTS (
            SELECT 1 FROM workflow_closeouts AS closeout
            WHERE closeout.workflow_id = workflow.id
          )`,
    );
    if (closedWithoutCloseout !== 0) {
      throw new StoreInvariantError('A closed Workflow has no immutable closeout authority');
    }
    const acceptedWithoutCloseout = this.readCount(
      `SELECT COUNT(*) AS count
         FROM candidate_generations AS generation
        WHERE generation.state = 'ACCEPTED'
          AND NOT EXISTS (
            SELECT 1 FROM workflow_closeouts AS closeout
            WHERE closeout.candidate_generation_id = generation.id
          )`,
    );
    if (acceptedWithoutCloseout !== 0) {
      throw new StoreInvariantError(
        'An accepted Candidate generation has no immutable closeout authority',
      );
    }
    const rejectedWithoutExactRepairChild = this.readCount(
      `SELECT COUNT(*) AS count
         FROM candidate_generations AS rejected
        WHERE rejected.state = 'REJECTED'
          AND (
            (
              SELECT COUNT(*)
                FROM candidate_generations AS child
               WHERE child.parent_generation_id = rejected.id
            ) <> 1
            OR NOT EXISTS (
              SELECT 1
                FROM candidate_generations AS child
               WHERE child.parent_generation_id = rejected.id
                 AND child.candidate_id = rejected.candidate_id
                 AND child.workflow_id = rejected.workflow_id
                 AND child.sequence = rejected.sequence + 1
                 AND child.base_digest = rejected.frozen_digest
                 AND child.created_at = rejected.updated_at
            )
            OR NOT EXISTS (
              SELECT 1
                FROM acceptance_decisions AS decision
                JOIN acceptance_input_manifests AS manifest
                  ON manifest.manifest_digest = decision.input_manifest_digest
               WHERE decision.outcome = 'REJECT_REPAIRABLE'
                 AND decision.issued_at <= rejected.updated_at
                 AND manifest.workflow_id = rejected.workflow_id
                 AND manifest.candidate_generation_id = rejected.id
                 AND manifest.candidate_digest = rejected.frozen_digest
            )
          )`,
    );
    if (rejectedWithoutExactRepairChild !== 0) {
      throw new StoreInvariantError(
        'A rejected Candidate generation has no exact repair child authority',
      );
    }
  }

  private hasTable(name: string): boolean {
    return (
      this.#database
        .prepare("SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = ?")
        .get(name) !== undefined
    );
  }

  private readCount(sql: string, ...parameters: readonly unknown[]): number {
    const row = this.#database.prepare(sql).get(...parameters);
    if (
      typeof row !== 'object' ||
      row === null ||
      !('count' in row) ||
      typeof row.count !== 'number' ||
      !Number.isSafeInteger(row.count) ||
      row.count < 0
    ) {
      throw new StoreInvariantError('SQLite count query returned malformed authority');
    }
    return row.count;
  }

  private checkWorkerEvent(
    receipt: WorkerEventReceipt,
  ):
    | { readonly status: 'MATCH'; readonly receipt: WorkerEventReceipt }
    | { readonly status: 'CONFLICT'; readonly receipt: WorkerEventReceipt }
    | undefined {
    const row = this.#database
      .prepare('SELECT * FROM worker_event_receipts WHERE event_id = ?')
      .get(receipt.eventId);
    if (row === undefined) {
      return undefined;
    }
    const existing = decodeWorkerEventReceiptRow(row);
    const matches =
      existing.payloadDigest === receipt.payloadDigest &&
      existing.workerSessionId === receipt.workerSessionId &&
      existing.workflowId === receipt.workflowId &&
      existing.attemptId === receipt.attemptId &&
      existing.contextManifestId === receipt.contextManifestId &&
      existing.contextManifestDigest === receipt.contextManifestDigest &&
      existing.packageDigest === receipt.packageDigest;
    return { status: matches ? 'MATCH' : 'CONFLICT', receipt: existing };
  }

  private assertAdmittedWorkerEventHasDispatchClaim(receipt: AdmittedWorkerEventReceipt): void {
    const claim = this.assertWorkerEventHasDispatchCausality(receipt);
    if (
      claim.workflowVersion !== receipt.observedWorkflowVersion ||
      claim.workerSessionId !== receipt.workerSessionId ||
      claim.contextManifestDigest !== receipt.contextManifestDigest ||
      claim.packageDigest !== receipt.packageDigest
    ) {
      throw new StoreInvariantError(
        `Admitted Worker Event ${receipt.eventId} has no exact dispatch authority`,
      );
    }
  }

  private assertWorkerEventHasDispatchCausality(receipt: WorkerEventReceipt): WorkerDispatchClaim {
    const claim = this.getWorkerDispatchClaim(receipt.attemptId);
    if (claim === undefined) {
      throw new StoreInvariantError(
        `Worker Event ${receipt.eventId} has no durable dispatch causality`,
      );
    }
    if (
      claim.workflowId !== receipt.workflowId ||
      claim.contextManifestId !== receipt.contextManifestId ||
      receipt.receivedAt < claim.claimedAt
    ) {
      throw new StoreInvariantError(
        `Worker Event ${receipt.eventId} has no durable dispatch causality`,
      );
    }
    return claim;
  }

  private insertWorkerEventReceipt(receipt: WorkerEventReceipt): void {
    this.#database
      .prepare(
        `INSERT INTO worker_event_receipts(
           event_id, schema_version, payload_digest, worker_session_id, workflow_id,
           observed_workflow_version, attempt_id, context_manifest_id,
           context_manifest_digest, package_digest, disposition, internal_command_id,
           reason_code, received_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        receipt.eventId,
        receipt.schemaVersion,
        receipt.payloadDigest,
        receipt.workerSessionId,
        receipt.workflowId,
        receipt.observedWorkflowVersion,
        receipt.attemptId,
        receipt.contextManifestId,
        receipt.contextManifestDigest,
        receipt.packageDigest,
        receipt.disposition,
        receipt.disposition === 'ADMITTED' ? receipt.internalCommandId : null,
        receipt.disposition === 'IGNORED' ? receipt.reasonCode : null,
        receipt.receivedAt,
      );
  }

  private insertProcessedCommand(
    commandIdentifier: CommandId,
    inputDigest: Sha256Digest,
    aggregateType: string,
    aggregateId: string,
    serializedOutcome: string,
    completedAt: IsoTimestamp,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO processed_commands(
           command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        commandIdentifier,
        inputDigest,
        aggregateType,
        aggregateId,
        serializedOutcome,
        completedAt,
      );
  }

  private runImmediate<Value>(operation: () => Value): Value {
    if (this.#database.inTransaction) {
      throw new StoreInvariantError('Nested SQLite control-store transactions are prohibited');
    }
    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.rollbackIfNeeded();
      throw error;
    }
  }

  private runCommandImmediate<Value>(
    operation: () => StoreCommandResult<Value>,
  ): StoreCommandResult<Value> {
    try {
      return this.runImmediate(operation);
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError) {
        return { status: 'VERSION_CONFLICT', message: error.message };
      }
      if (error instanceof CommandIdConflictError) {
        return { status: 'COMMAND_CONFLICT', message: error.message };
      }
      throw error;
    }
  }

  private runWorkerEventImmediate<Value>(
    operation: () => WorkerEventStoreResult<Value>,
  ): WorkerEventStoreResult<Value> {
    try {
      return this.runImmediate(operation);
    } catch (error) {
      if (error instanceof OptimisticConcurrencyError) {
        return { status: 'VERSION_CONFLICT', message: error.message };
      }
      if (error instanceof CommandIdConflictError) {
        return { status: 'WORKER_EVENT_CONFLICT', message: error.message };
      }
      throw error;
    }
  }

  private runRead<Value>(operation: () => Value): Value {
    if (this.#database.inTransaction) {
      return operation();
    }
    this.#database.exec('BEGIN');
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      this.rollbackIfNeeded();
      throw error;
    }
  }

  private rollbackIfNeeded(): void {
    if (this.#database.inTransaction) {
      this.#database.exec('ROLLBACK');
    }
  }

  private probe(
    step:
      | TransactionStep
      | WorkerTransactionStep
      | CandidateEvidenceTransactionStep
      | AcceptanceTransactionStep,
  ): void {
    this.#transactionProbe?.(step);
  }

  private assertOpen(): void {
    if (this.#closed) {
      throw new StoreInvariantError('SQLite control store is closed');
    }
  }
}

export function openSqliteControlStore(options: SqliteControlStoreOptions): SqliteControlStore {
  return SqliteControlStore.open(options);
}
