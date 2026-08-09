import { createHash } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import Database from 'better-sqlite3';
import { z } from 'zod';

import {
  AcceptanceOutcome,
  AnswerOnlyResponseKind,
  AttemptInterruptionReason,
  AttemptFailureClass,
  AttemptStatus,
  CandidateGenerationState,
  CheckSpecificationKind,
  ContextEntryKind,
  EvidenceEligibilityState,
  EvidenceKind,
  ExternalBackendCapabilityClassification,
  ExternalExecutionState,
  ExternalMaintenanceState,
  GoalStatus,
  GuardOutcome,
  ClarificationAnswerSchemaKind,
  IntakeCommandDisposition,
  IntakeFailedOperation,
  IntakeCommandOperationKind,
  IntakeInteractionAction,
  IntakeManifestOperation,
  IntakeRunStatus,
  IntentAdmissionDecisionKind,
  IntentAdmissionOutcome,
  IntentAdmissionReasonCode,
  IntentExecutionDisposition,
  IntentProjectionField,
  RecoveryReconciliationDisposition,
  RecoveryReconciliationPurpose,
  RunStatus,
  WorkflowGuard,
  WorkflowPhase,
  applyAttemptEvent,
  applyRecoveryWorkflowEvent,
  applyCandidateEvent,
  applyEvidenceEligibilityEvent,
  applyWorkflowCancellationToAttempt,
  applyWorkflowEvent,
  assertIntentProjectionAmbiguityClosure,
  acceptanceDecisionProjection,
  acceptanceInputManifestProjection,
  acceptanceCriticalVerificationPlanProjection,
  acceptanceRepairRecordProjection,
  acceptanceDecisionId,
  aggregateVersion,
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
  decodeAcceptanceRepairRecord,
  decodeAcceptanceCriticalVerificationPlan,
  decodeCandidate,
  decodeCandidateEvent,
  decodeCandidateGeneration,
  decodeCheckSpecification,
  decodeEvidenceEligibility,
  decodeEvidenceRecord,
  decodeEvidenceSet,
  decodeExecutionProfile,
  decodeExecutionProfileBinding,
  decodeExternalBackendCapabilityRecord,
  decodeExternalExecutionIntent,
  decodeExternalExecutionObservation,
  decodeExternalExecutionRecord,
  decodeExternalMaintenanceIntent,
  decodeRecoveryReconciliationRecord,
  decodeRecoveryWorkflowEvent,
  decodeCloseoutRecord,
  decodePendingIssueSet,
  decodeProjectReadSnapshotCleanupGrant,
  decodeProjectReadSnapshotCleanupOutcome,
  decodeProjectSourceReadAuthorityRecord,
  decodeContextManifest,
  decodeAttemptEvent,
  decodeGoalSnapshot,
  decodeAnswerOnlyResponse,
  decodeClarificationAnswerBinding,
  decodeClarificationQuestion,
  decodeClarificationQuestionSpec,
  decodeGoalMaterializationRecord,
  decodeGoalStartAuthorization,
  decodeIntakeCommandClosure,
  decodeIntakeCommandResult,
  decodeIntakeCommandOutcome,
  decodeIntakeCommandReservation,
  decodeIntakeFailureRecord,
  decodeIntakeManifest,
  decodeIntakeRun,
  decodeIntentAdmissionDecision,
  decodeIntentAdmissionPolicy,
  decodeIntentAdmissionPolicyInstallInput,
  decodeIntentAnalysisProposal,
  decodeIntentProjectionRevision,
  decodeMaterialAmbiguity,
  decodeMaterialAmbiguitySet,
  decodeRawRequest,
  decodeRawRequestRevision,
  decodeSourceBinding,
  decodeWorkflowEvent,
  decodeWorkflowSnapshot,
  decodePolicyBundle,
  decodeWorkflowPolicyBinding,
  decodeVerificationObligation,
  decideEvidenceInvalidation,
  assertWorkflowInvariant,
  deriveGoalStatus,
  deriveCapabilityGrant,
  deriveExternalPhaseResponseSchemaPolicy,
  goalId,
  goalRevision,
  intakeCommandOutcomeProjection,
  intakeCommandResultProjection,
  intakeRunId,
  intentAdmissionPolicyId,
  hasExactWorkflowActiveAttemptAuthority,
  evidenceId,
  evidenceSetDigestProjection,
  executionProfileBindingProjection,
  executionProfileId,
  executionProfileProjection,
  externalBackendCapabilityRecordProjection,
  externalExecutionId,
  externalExecutionIntentProjection,
  externalExecutionObservationId,
  externalExecutionObservationProjection,
  externalExecutionRecordProjection,
  externalMaintenanceAuthorizationProjection,
  externalMaintenanceIntentId,
  externalMaintenanceRecordProjection,
  externalProcessIdentityProjection,
  isoTimestamp,
  isTerminalAttemptWorkflowRunStatusAuthorized,
  policyBundleId,
  policyBundleProjection,
  projectReadGitStateProjection,
  projectReadSnapshotCleanupGrantId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectReadWorkspaceObservationId,
  projectReadSourceTreeProjection,
  projectSourceReadAuthorityId,
  projectSourceReadAuthorityProjection,
  protectedAssetManifestProjection,
  workflowPolicyBindingProjection,
  recoveryReconciliationId,
  recoveryReconciliationProjection,
  sha256Digest,
  workflowId,
  workflowVersion,
  verificationObligationId,
  workerEventId,
  type AppliedAttemptEvent,
  type AcceptanceDecision,
  type AcceptanceDecisionId,
  type AcceptanceInputManifest,
  type AcceptanceRepairRecord,
  type AcceptanceCriticalVerificationPlan,
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
  type ExecutionProfile,
  type ExecutionProfileBinding,
  type ExecutionProfileId,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionId,
  type ExternalExecutionObservation,
  type ExternalExecutionObservationId,
  type ExternalExecutionRecord,
  type ExternalMaintenanceIntent,
  type ExternalMaintenanceIntentId,
  type ExternalProcessIdentity,
  type RecoveryReconciliationId,
  type RecoveryReconciliationRecord,
  type CloseoutRecord,
  type Goal,
  type GoalId,
  type AnswerOnlyResponse,
  type ClarificationAnswerBinding,
  type ClarificationQuestion,
  type ClarificationQuestionSpec,
  type DeclaredProjectRef,
  type GoalMaterializationRecord,
  type GoalStartAuthorization,
  type IntakeCommandOutcome,
  type IntakeCommandReservation,
  type IntakeCommandResult,
  type IntakeFailureRecord,
  type IntakeManifest,
  type IntakeRun,
  type IntakeRunId,
  type IntentAdmissionDecision,
  type IntentAdmissionPolicy,
  type IntentAdmissionPolicyInstallInput,
  type IntentAnalysisProposal,
  type IntentProjectionRevisionRecord,
  type MaterialAmbiguity,
  type MaterialAmbiguitySet,
  type RawRequest,
  type RawRequestRevisionRecord,
  type IsoTimestamp,
  type PolicyBundle,
  type PolicyBundleId,
  type ProjectSourceReadAuthorityId,
  type ProjectSourceReadAuthorityRecord,
  type ProjectReadSnapshotCleanupGrant,
  type ProjectReadSnapshotCleanupGrantId,
  type ProjectReadSnapshotCleanupOutcome,
  type ProjectReadWorkspaceAuthoritySnapshotId,
  type ProjectReadWorkspaceObservationId,
  type Sha256Digest,
  type WorkflowEvent,
  type WorkflowId,
  type WorkflowInstance,
  type WorkflowVersion,
  type WorkflowPolicyBinding,
  type VerificationObligation,
  type VerificationObligationId,
  type WorkerEventId,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  ExternalExecutionAbandonReasonCode,
  ExternalMaintenanceFailureReasonCode,
  compileBoundedM2RepairContext,
  contextManifestDigestProjection,
  compileM1AcceptanceInput,
  createProtectedAssetReadLease,
  assertProtectedLocalCommandCheckMatchesPlan,
  createAppliedStoredCommandOutcome,
  createRejectedStoredCommandOutcome,
  canonicalizeJson,
  decodeCommandTarget,
  decodeDeterministicCommandError,
  decodeJsonValue,
  decodeStoredCommandOutcome,
  decodeWorkerDispatchClaim,
  decodeWorkerEventReceipt,
  decodeProjectReadSnapshotCleanupObservation,
  decodeProjectReadWorkspaceAuthoritySnapshot,
  decodeProjectReadWorkspaceObservation,
  digestProjectReadSnapshotCleanupValue,
  digestProjectReadWorkspaceValue,
  projectReadWorkspaceAuthoritySnapshotProjection,
  assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot,
  assertTerminalProjectReadSnapshotCleanupGrantEligibility,
  assertOrphanedProjectReadSnapshotCleanupGrantEligibility,
  assertProjectReadSnapshotCleanupOutcomeClosure,
  ProjectReadWorkspaceRetention,
  deriveContextManifestEntries,
  deriveM1BaseProjectIdentity,
  deriveM1WorkspaceIdentity,
  externalExecutionAbandonReasonCode,
  externalMaintenanceFailureCode,
  externalWorkerFailureCode,
  LocalCommandVerificationFailureCode,
  workerDispatchClaimProjection,
  attemptFailureClassForKnownWorkerReasonCode,
  m1PhaseObjective,
  m1WorkerResponseContract,
  validateM1CandidateEvidencePolicy,
  validateLocalCommandVerificationPolicy,
  verifyM1AcceptanceDecision,
  verifyEvidenceSetAuthority,
  assertM1WorkerPhaseAttemptAuthority,
  assertStoredCommandOutcomeBinding,
  StoredCommandDisposition,
  WorkerEventDisposition,
  storedCommandOutcomeToJson,
  type CommandTarget,
  type AdmittedWorkerEventReceipt,
  type AcceptanceAuthorityView,
  type AcceptanceControlStore,
  type AbandonExternalExecution,
  type AdmitExternalExecutionObservation,
  type AuthorizeExternalMaintenance,
  type ClaimExternalWorkerDispatch,
  type ClaimWorkerDispatch,
  type CompleteExternalMaintenance,
  type ExternalMaintenanceFailureCode,
  type CandidateAuthorityView,
  type CommitAcceptanceEvaluation,
  type CommitAcceptanceRepair,
  type CommitAcceptedCloseout,
  type CommitCandidateAttemptOutcome,
  type CommitCandidateIntegrityFailure,
  type CommitVerificationIntegrityFailure,
  type CommitCandidatePreparation,
  type CommitEvidenceSetTransition,
  type CommittedCandidateAttemptOutcome,
  type CommittedAcceptanceEvaluation,
  type CommittedAcceptanceRepair,
  type CommittedAcceptedCloseout,
  type CommittedCandidateIntegrityFailure,
  type CommittedVerificationIntegrityFailure,
  type CommittedCandidatePreparation,
  type CommittedVerificationAttemptOutcome,
  type CommittedWorkflowCandidateEvent,
  type CommitVerificationAttemptOutcome,
  type CommitLocalCommandVerificationAuthority,
  type CommittedLocalCommandVerificationAuthority,
  type EvidencePayload,
  type CommitWorkflowCandidateEvent,
  type CommitContextBoundAttemptStart,
  type CommitGoalCreation,
  type CommitResumeRecovery,
  type CommitStartupRecovery,
  type CommittedContextAttempt,
  type CommittedResumeRecovery,
  type CommittedStartupRecovery,
  type CommitWorkerAttemptEvent,
  type GoalWorkflowView,
  type GoalAuditAuthoritySnapshot,
  type GoalStatusAuthoritySnapshot,
  type WorkflowDriverAuthoritySnapshot,
  type WorkflowDriverControlStore,
  type InstallPolicyBundle,
  type InstallExecutionProfile,
  type InstallExternalBackendCapabilityRecord,
  IntakeAuditAggregateType,
  IntakeAuditEventType,
  classifyM25IntakeRetainedText,
  goalAndWorkflowCreationPayloadProjection,
  type IntakeAuditWrite,
  type IntakeAuthorityView,
  type IntakeCommitStoreResult,
  type IntakeControlStore,
  type IntakeReservationStoreResult,
  type IntentAdmissionPolicyInstallResult,
  type CommitAnalyzedIntake,
  type CommitIntakeCommandRejection,
  type CommitIntakeFailure,
  type CommitIntakeMaterialization,
  type CommitIntakeNoExecution,
  type ReserveClarificationIntakeOperation,
  type ReserveInitialIntakeOperation,
  type InstalledExecutionProfile,
  type InstalledPolicyBundle,
  type ExecutionProfileInstallResult,
  type ExternalBackendCapabilityInstallResult,
  type ExternalExecutionObservationStoreResult,
  type ExternalMaintenanceStoreResult,
  type ExternalWorkerDispatchClaimResult,
  type PolicyInstallResult,
  type CaptureProjectReadWorkspaceAuthoritySnapshot,
  type IssueProjectReadSnapshotCleanupGrant,
  type ProjectReadCleanupControlStore,
  type ProjectReadSnapshotCleanupGrantStoreResult,
  type ProjectReadSnapshotCleanupObservation,
  type ProjectReadSnapshotCleanupResolutionStoreResult,
  type ProjectReadWorkspaceAuthoritySnapshot,
  type ProjectReadWorkspaceAuthoritySnapshotStoreResult,
  type ProjectReadWorkspaceObservation,
  type ProjectReadWorkspaceObservationStoreResult,
  type RecordProjectReadWorkspaceObservation,
  type ResolveProjectReadSnapshotCleanupGrant,
  type RecordIgnoredWorkerEvent,
  RecoverableBlockerKind,
  RecoveryContinuityBarrier,
  type RecoveryCatalogEntry,
  type RecordCommandRejection,
  type StoreCommandResult,
  type CodeClosureApplicationStore,
  type WorkerDispatchClaim,
  type WorkerDispatchClaimResult,
  type WorkerEventReceipt,
  type WorkerEventReplayAuthoritySnapshot,
  type WorkerEventStoreResult,
  verifyEvidenceRecordDigests,
} from '@codeclosure/runtime';

import {
  AuthorityActivationError,
  CommandIdConflictError,
  OptimisticConcurrencyError,
  StoreInvariantError,
} from './errors.js';
import { parseJson, serializeJson } from './json.js';
import {
  applyMigrations,
  applyMigrationsWithinCurrentTransaction,
  defaultMigrationsDirectory,
  type AppliedMigration,
} from './migrations.js';
import {
  decodeAttempt,
  decodeAcceptanceDecisionRow,
  decodeAcceptanceInputManifestRow,
  decodeAcceptanceRepairRow,
  decodeAcceptanceCriticalVerificationPlanRow,
  decodeAuditEvent,
  decodeCandidateGenerationRow,
  decodeCandidateRow,
  decodeCloseoutRow,
  decodeCheckSpecificationRow,
  decodeGoal,
  decodeContextManifestRow,
  decodeExecutionProfileBindingRow,
  decodeExecutionProfileRow,
  decodeExternalBackendCapabilityRow,
  decodeExternalExecutionObservationRow,
  decodeExternalExecutionRow,
  decodeExternalMaintenanceIntentRow,
  decodeWorkflowPolicyBindingRow,
  decodeRecoveryReconciliationRow,
  decodePolicyBundleRow,
  decodeEvidenceEligibilityRow,
  decodeEvidenceRecordRow,
  decodeEvidenceSetRow,
  decodePendingIssueRow,
  decodeProcessedCommand,
  decodeProjectSourceReadAuthorityRow,
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
  AFTER_EXTERNAL_CAPABILITY_AUDIT_WRITE: 'AFTER_EXTERNAL_CAPABILITY_AUDIT_WRITE',
  AFTER_EXTERNAL_CAPABILITY_WRITE: 'AFTER_EXTERNAL_CAPABILITY_WRITE',
  AFTER_EXTERNAL_EXECUTION_AUDIT_WRITE: 'AFTER_EXTERNAL_EXECUTION_AUDIT_WRITE',
  AFTER_EXTERNAL_EXECUTION_WRITE: 'AFTER_EXTERNAL_EXECUTION_WRITE',
  AFTER_EXTERNAL_OBSERVATION_AUDIT_WRITE: 'AFTER_EXTERNAL_OBSERVATION_AUDIT_WRITE',
  AFTER_EXTERNAL_OBSERVATION_WRITE: 'AFTER_EXTERNAL_OBSERVATION_WRITE',
  AFTER_EXTERNAL_MAINTENANCE_AUDIT_WRITE: 'AFTER_EXTERNAL_MAINTENANCE_AUDIT_WRITE',
  AFTER_EXTERNAL_MAINTENANCE_WRITE: 'AFTER_EXTERNAL_MAINTENANCE_WRITE',
  AFTER_WORKER_RECEIPT_WRITE: 'AFTER_WORKER_RECEIPT_WRITE',
  AFTER_POLICY_AUDIT_WRITE: 'AFTER_POLICY_AUDIT_WRITE',
  AFTER_POLICY_WRITE: 'AFTER_POLICY_WRITE',
  AFTER_EXECUTION_PROFILE_AUDIT_WRITE: 'AFTER_EXECUTION_PROFILE_AUDIT_WRITE',
  AFTER_EXECUTION_PROFILE_WRITE: 'AFTER_EXECUTION_PROFILE_WRITE',
  AFTER_EXECUTION_PROFILE_BINDING_AUDIT_WRITE: 'AFTER_EXECUTION_PROFILE_BINDING_AUDIT_WRITE',
  AFTER_EXECUTION_PROFILE_BINDING_WRITE: 'AFTER_EXECUTION_PROFILE_BINDING_WRITE',
  AFTER_WORKFLOW_POLICY_BINDING_AUDIT_WRITE: 'AFTER_WORKFLOW_POLICY_BINDING_AUDIT_WRITE',
  AFTER_WORKFLOW_POLICY_BINDING_WRITE: 'AFTER_WORKFLOW_POLICY_BINDING_WRITE',
  AFTER_PROTECTED_VERIFICATION_PLAN_AUDIT_WRITE: 'AFTER_PROTECTED_VERIFICATION_PLAN_AUDIT_WRITE',
  AFTER_PROTECTED_VERIFICATION_PLAN_WRITE: 'AFTER_PROTECTED_VERIFICATION_PLAN_WRITE',
  AFTER_PROJECT_READ_AUTHORITY_AUDIT_WRITE: 'AFTER_PROJECT_READ_AUTHORITY_AUDIT_WRITE',
  AFTER_PROJECT_READ_AUTHORITY_WRITE: 'AFTER_PROJECT_READ_AUTHORITY_WRITE',
} as const;
export type WorkerTransactionStep =
  (typeof WorkerTransactionStep)[keyof typeof WorkerTransactionStep];

export const CandidateEvidenceTransactionStep = {
  AFTER_CANDIDATE_WRITE: 'AFTER_CANDIDATE_WRITE',
  AFTER_CANDIDATE_TRANSITION: 'AFTER_CANDIDATE_TRANSITION',
  AFTER_EVIDENCE_WRITE: 'AFTER_EVIDENCE_WRITE',
  AFTER_EVIDENCE_PAYLOAD_WRITE: 'AFTER_EVIDENCE_PAYLOAD_WRITE',
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
  AFTER_REPAIR_RECORD_WRITE: 'AFTER_REPAIR_RECORD_WRITE',
} as const;
export type AcceptanceTransactionStep =
  (typeof AcceptanceTransactionStep)[keyof typeof AcceptanceTransactionStep];

export const RecoveryTransactionStep = {
  AFTER_RECOVERY_RECORD_WRITE: 'AFTER_RECOVERY_RECORD_WRITE',
  AFTER_RECOVERY_STATE_WRITE: 'AFTER_RECOVERY_STATE_WRITE',
  AFTER_RECOVERY_AUDIT_WRITE: 'AFTER_RECOVERY_AUDIT_WRITE',
} as const;
export type RecoveryTransactionStep =
  (typeof RecoveryTransactionStep)[keyof typeof RecoveryTransactionStep];

export const IntakeTransactionStep = {
  AFTER_POLICY_AUDIT_WRITE: 'AFTER_INTAKE_POLICY_AUDIT_WRITE',
  AFTER_POLICY_WRITE: 'AFTER_INTAKE_POLICY_WRITE',
  AFTER_RAW_REQUEST_WRITE: 'AFTER_INTAKE_RAW_REQUEST_WRITE',
  AFTER_RAW_REQUEST_REVISION_WRITE: 'AFTER_INTAKE_RAW_REQUEST_REVISION_WRITE',
  AFTER_RUN_WRITE: 'AFTER_INTAKE_RUN_WRITE',
  AFTER_MANIFEST_WRITE: 'AFTER_INTAKE_MANIFEST_WRITE',
  AFTER_ANSWER_BINDING_WRITE: 'AFTER_INTAKE_ANSWER_BINDING_WRITE',
  AFTER_RESERVATION_WRITE: 'AFTER_INTAKE_RESERVATION_WRITE',
  AFTER_PROPOSAL_WRITE: 'AFTER_INTAKE_PROPOSAL_WRITE',
  AFTER_SOURCE_BINDING_WRITE: 'AFTER_INTAKE_SOURCE_BINDING_WRITE',
  AFTER_PROJECTION_WRITE: 'AFTER_INTAKE_PROJECTION_WRITE',
  AFTER_AMBIGUITY_WRITE: 'AFTER_INTAKE_AMBIGUITY_WRITE',
  AFTER_DECISION_WRITE: 'AFTER_INTAKE_DECISION_WRITE',
  AFTER_QUESTION_WRITE: 'AFTER_INTAKE_QUESTION_WRITE',
  AFTER_ANSWER_RESPONSE_WRITE: 'AFTER_INTAKE_ANSWER_RESPONSE_WRITE',
  AFTER_FAILURE_WRITE: 'AFTER_INTAKE_FAILURE_WRITE',
  AFTER_GOAL_WRITE: 'AFTER_INTAKE_GOAL_WRITE',
  AFTER_WORKFLOW_WRITE: 'AFTER_INTAKE_WORKFLOW_WRITE',
  AFTER_MATERIALIZATION_WRITE: 'AFTER_INTAKE_MATERIALIZATION_WRITE',
  AFTER_START_AUTHORIZATION_WRITE: 'AFTER_INTAKE_START_AUTHORIZATION_WRITE',
  AFTER_AUDIT_WRITE: 'AFTER_INTAKE_AUDIT_WRITE',
  AFTER_OUTCOME_WRITE: 'AFTER_INTAKE_OUTCOME_WRITE',
  BEFORE_COMMIT: 'BEFORE_INTAKE_COMMIT',
} as const;
export type IntakeTransactionStep =
  (typeof IntakeTransactionStep)[keyof typeof IntakeTransactionStep];

export const ProjectReadCleanupTransactionStep = {
  AFTER_AUTHORITY_SNAPSHOT_AUDIT_WRITE: 'AFTER_PROJECT_READ_AUTHORITY_SNAPSHOT_AUDIT_WRITE',
  AFTER_AUTHORITY_SNAPSHOT_WRITE: 'AFTER_PROJECT_READ_AUTHORITY_SNAPSHOT_WRITE',
  AFTER_WORKSPACE_OBSERVATION_AUDIT_WRITE: 'AFTER_PROJECT_READ_WORKSPACE_OBSERVATION_AUDIT_WRITE',
  AFTER_WORKSPACE_OBSERVATION_WRITE: 'AFTER_PROJECT_READ_WORKSPACE_OBSERVATION_WRITE',
  AFTER_CLEANUP_GRANT_AUDIT_WRITE: 'AFTER_PROJECT_READ_CLEANUP_GRANT_AUDIT_WRITE',
  AFTER_CLEANUP_GRANT_WRITE: 'AFTER_PROJECT_READ_CLEANUP_GRANT_WRITE',
  AFTER_CLEANUP_OBSERVATION_AUDIT_WRITE: 'AFTER_PROJECT_READ_CLEANUP_OBSERVATION_AUDIT_WRITE',
  AFTER_CLEANUP_OBSERVATION_WRITE: 'AFTER_PROJECT_READ_CLEANUP_OBSERVATION_WRITE',
  AFTER_CLEANUP_OUTCOME_AUDIT_WRITE: 'AFTER_PROJECT_READ_CLEANUP_OUTCOME_AUDIT_WRITE',
  AFTER_CLEANUP_OUTCOME_WRITE: 'AFTER_PROJECT_READ_CLEANUP_OUTCOME_WRITE',
  AFTER_CLEANUP_CONSUMPTION_WRITE: 'AFTER_PROJECT_READ_CLEANUP_CONSUMPTION_WRITE',
  BEFORE_COMMIT: 'BEFORE_PROJECT_READ_CLEANUP_COMMIT',
} as const;
export type ProjectReadCleanupTransactionStep =
  (typeof ProjectReadCleanupTransactionStep)[keyof typeof ProjectReadCleanupTransactionStep];

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
      | AcceptanceTransactionStep
      | RecoveryTransactionStep
      | IntakeTransactionStep
      | ProjectReadCleanupTransactionStep,
  ) => void;
}

export const SqliteAuthorityDatabaseState = {
  EMPTY: 'EMPTY',
  RETAINED_M1: 'RETAINED_M1',
} as const;
export type SqliteAuthorityDatabaseState =
  (typeof SqliteAuthorityDatabaseState)[keyof typeof SqliteAuthorityDatabaseState];

export const SqliteRetainedProjectReferenceKind = {
  GOAL: 'GOAL',
  RAW_REQUEST_REVISION: 'RAW_REQUEST_REVISION',
  INTAKE_RUN: 'INTAKE_RUN',
  INTENT_ADMISSION_DECISION: 'INTENT_ADMISSION_DECISION',
  GOAL_MATERIALIZATION: 'GOAL_MATERIALIZATION',
} as const;
export type SqliteRetainedProjectReferenceKind =
  (typeof SqliteRetainedProjectReferenceKind)[keyof typeof SqliteRetainedProjectReferenceKind];

export interface SqliteRetainedProjectReference {
  readonly kind: SqliteRetainedProjectReferenceKind;
  readonly authorityId: string;
  readonly projectPath: string;
}

/**
 * Denial-only bootstrap input. Runtime authority is established only after
 * migrations and owning Store codecs validate the retained records.
 */
export interface SqliteAuthorityIsolationSnapshot {
  readonly schemaVersion: 1;
  readonly databasePath: string;
  readonly databaseState: SqliteAuthorityDatabaseState;
  readonly projectReferences: readonly SqliteRetainedProjectReference[];
}

export interface SqliteAuthorityIsolationLease {
  /** Revalidates every filesystem identity bound during bootstrap. */
  assertCurrent(): void;

  /** Refuses a CreateGoal path that was not part of the verified invocation. */
  assertProjectPathAllowed(projectPath: string): void;
}

export interface SqliteAuthorityIsolationVerifier {
  verify(snapshot: SqliteAuthorityIsolationSnapshot): unknown;
}

export interface VerifiedSqliteControlStoreOptions extends SqliteControlStoreOptions {
  readonly isolationVerifier: SqliteAuthorityIsolationVerifier;
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

const evidencePayloadIdentityRowsSchema = z.array(
  z
    .object({
      digest: z.string(),
      byte_length: z.number(),
    })
    .strict(),
);

const evidencePayloadRowSchema = z
  .object({
    digest: z.string(),
    byte_length: z.number(),
    payload_bytes: z.instanceof(Uint8Array),
  })
  .strict();

const evidencePayloadBytesRowSchema = z
  .object({
    payload_bytes: z.instanceof(Uint8Array),
  })
  .strict();

const authorityIdentifierRowSchema = z
  .object({
    id: z.string(),
  })
  .strict();

const projectReadContextAuthorityRowSchema = z
  .object({
    id: z.string(),
    project_read_authority_id: z.string(),
  })
  .strict();

const projectReadAuditSequenceRowSchema = z.looseObject({
  audit_sequence: z.number().int().positive(),
});

const sqliteSchemaObjectRowsSchema = z.array(
  z
    .object({
      type: z.enum(['index', 'table', 'trigger', 'view']),
      name: z.string().min(1),
    })
    .strict(),
);

const retainedProjectReferenceRowsSchema = z.array(
  z
    .object({
      kind: z.enum(Object.values(SqliteRetainedProjectReferenceKind)),
      authority_id: z.string().min(1),
      project_path: z.string().min(1),
    })
    .strict(),
);

const retainedIntakeProjectMismatchRowSchema = z
  .object({
    kind: z.enum([
      'RAW_REQUEST_REVISION',
      'INTAKE_RUN',
      'INTENT_ADMISSION_DECISION',
      'GOAL_MATERIALIZATION',
    ]),
    authority_id: z.string().min(1),
  })
  .strict();

const storedIntakeRecordRowsSchema = z.array(z.object({ record_json: z.string().min(2) }).strict());

const projectionSourceBindingRowsSchema = z.array(
  z
    .object({
      projection_id: z.string().min(1),
      projection_revision: z.number().int().positive(),
      position: z.number().int().nonnegative(),
      binding_digest: z.string().min(1),
    })
    .strict(),
);

const ambiguityMembershipRowsSchema = z.array(
  z
    .object({
      ambiguity_set_digest: z.string().min(1),
      record_json: z.string().min(2),
    })
    .strict(),
);

const retainedIntakeAuditRowsSchema = z.array(
  z
    .object({
      intake_run_id: z.string().min(1),
      relationship_command_id: z.string().min(1),
      position: z.number().int().nonnegative(),
      id: z.string().min(1),
      sequence: z.number().int().positive(),
      aggregate_type: z.string().min(1),
      aggregate_id: z.string().min(1),
      event_type: z.string().min(1),
      actor_type: z.string().min(1),
      command_id: z.string().nullable(),
      before_version: z.number().int().positive().nullable(),
      after_version: z.number().int().positive().nullable(),
      correlation_id: z.string().min(1).nullable(),
      causation_id: z.string().min(1).nullable(),
      payload_digest: z.string().min(1),
      occurred_at: z.string().min(1),
    })
    .strict(),
);

function intakeRevisionKey(identifier: string, revision: number): string {
  return `${identifier}\u0000${String(revision)}`;
}

function sameCanonicalAuthority(left: unknown, right: unknown): boolean {
  return canonicalizeJson(decodeJsonValue(left)) === canonicalizeJson(decodeJsonValue(right));
}

function sameOptionalProjectRef(
  left: DeclaredProjectRef | undefined,
  right: DeclaredProjectRef | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined && sameCanonicalAuthority(left, right);
}

function assertExactIntakeProjectChain(
  run: IntakeRun,
  revision: RawRequestRevisionRecord,
  projection?: IntentProjectionRevisionRecord,
  decision?: IntentAdmissionDecision,
): void {
  const declaredProject = revision.declaredProjectRef;
  if (
    revision.intakeRunId !== run.id ||
    revision.rawRequestId !== run.activeRawRequestRevision.rawRequestId ||
    revision.revision !== run.activeRawRequestRevision.revision ||
    revision.rawRequestDigest !== run.activeRawRequestRevision.digest ||
    !sameOptionalProjectRef(run.projectRef, declaredProject) ||
    (projection !== undefined &&
      (projection.intakeRunId !== run.id ||
        projection.rawRequestRevision !== revision.revision ||
        projection.scope.projectPath !== declaredProject?.normalizedPath)) ||
    (decision?.projectOrScopeRef !== undefined &&
      (declaredProject === undefined ||
        !sameCanonicalAuthority(decision.projectOrScopeRef, declaredProject)))
  ) {
    throw new StoreInvariantError(`Intake Run ${run.id} has a substituted project/scope chain`);
  }
}

function assertExactIntakeManifestRevisionChain(
  manifest: IntakeManifest,
  revision: RawRequestRevisionRecord,
): void {
  const currentReference = manifest.rawRequestRevisions.at(-1);
  if (
    manifest.intakeRunId !== revision.intakeRunId ||
    manifest.rawRequestRevisions.length !== revision.revision ||
    manifest.rawRequestRevisions.some(
      (reference, index) =>
        reference.rawRequestId !== revision.rawRequestId || reference.revision !== index + 1,
    ) ||
    currentReference?.revision !== revision.revision ||
    currentReference.digest !== revision.rawRequestDigest ||
    !sameOptionalProjectRef(manifest.declaredProjectRef, revision.declaredProjectRef)
  ) {
    throw new StoreInvariantError(
      `Intake Manifest ${manifest.id} has no exact current Raw Request revision`,
    );
  }
}

function assertExactProposalAnalysisAuthority(
  proposal: IntentAnalysisProposal,
  decision: IntentAdmissionDecision,
  reservation: IntakeCommandReservation,
): void {
  if (!('externalOperationBinding' in reservation)) {
    throw new StoreInvariantError(
      `Intent Analysis Proposal ${proposal.id} has no exact reservation/Manifest authority`,
    );
  }
  const external = reservation.externalOperationBinding;
  if (
    proposal.assistantAdapterId !== external.assistantAdapterId ||
    proposal.assistantAdapterVersion !== external.assistantAdapterVersion ||
    proposal.responseContractDigest !== external.responseContractDigest ||
    decision.admissionPolicyId !== external.admissionPolicyId ||
    decision.admissionPolicyVersion !== external.admissionPolicyVersion ||
    decision.admissionPolicyDigest !== external.admissionPolicyDigest
  ) {
    throw new StoreInvariantError(
      `Intent Analysis Proposal ${proposal.id} has no exact reservation/Manifest authority`,
    );
  }
}

function isExactProjectIdentityQuestion(question: ClarificationQuestion | undefined): boolean {
  return (
    question?.answerSchema.kind === ClarificationAnswerSchemaKind.PROJECT_PATH &&
    sameCanonicalAuthority(question.affectedFields, [IntentProjectionField.PROJECT_IDENTITY])
  );
}

const intakeAuthorityTableNames = Object.freeze([
  'intent_admission_policies',
  'raw_requests',
  'raw_request_revisions',
  'intake_runs',
  'intake_manifests',
  'intent_analysis_proposals',
  'source_bindings',
  'intent_projection_revisions',
  'projection_source_bindings',
  'material_ambiguity_sets',
  'material_ambiguities',
  'clarification_question_specs',
  'intent_admission_decisions',
  'clarification_questions',
  'clarification_answer_bindings',
  'answer_only_responses',
  'intake_failure_records',
  'intake_command_reservations',
  'intake_command_outcomes',
  'goal_materializations',
  'goal_start_authorizations',
  'intake_audit_events',
]);

function retainedIntakeProjectColumnMismatch(
  database: Database.Database,
): z.infer<typeof retainedIntakeProjectMismatchRowSchema> | undefined {
  const row = database
    .prepare(
      `SELECT kind, authority_id
         FROM (
           SELECT 'RAW_REQUEST_REVISION' AS kind,
                  raw_request_id || '@' || revision AS authority_id
             FROM raw_request_revisions
            WHERE declared_project_path IS NOT
                    json_extract(record_json, '$.declaredProjectRef.normalizedPath')
               OR declared_project_identity_digest IS NOT
                    json_extract(record_json, '$.declaredProjectRef.identityDigest')
           UNION ALL
           SELECT 'INTAKE_RUN', id
             FROM intake_runs
            WHERE project_path IS NOT json_extract(record_json, '$.projectRef.normalizedPath')
               OR project_identity_digest IS NOT
                    json_extract(record_json, '$.projectRef.identityDigest')
           UNION ALL
           SELECT 'INTENT_ADMISSION_DECISION', id
             FROM intent_admission_decisions
            WHERE project_path IS NOT
                    json_extract(record_json, '$.projectOrScopeRef.normalizedPath')
               OR project_identity_digest IS NOT
                    json_extract(record_json, '$.projectOrScopeRef.identityDigest')
           UNION ALL
           SELECT 'GOAL_MATERIALIZATION', id
             FROM goal_materializations
            WHERE project_path IS NOT
                    json_extract(record_json, '$.projectOrScopeRef.normalizedPath')
               OR project_identity_digest IS NOT
                    json_extract(record_json, '$.projectOrScopeRef.identityDigest')
         )
        LIMIT 1`,
    )
    .get();
  return row === undefined ? undefined : retainedIntakeProjectMismatchRowSchema.parse(row);
}

function inspectRetainedProjectReferences(
  database: Database.Database,
  tableNames: ReadonlySet<string>,
): readonly SqliteRetainedProjectReference[] {
  const presentIntakeTables = intakeAuthorityTableNames.filter((name) => tableNames.has(name));
  if (
    presentIntakeTables.length !== 0 &&
    presentIntakeTables.length !== intakeAuthorityTableNames.length
  ) {
    throw new AuthorityActivationError(
      'SQLite authority bootstrap found partial M2.5 Intake schema',
    );
  }
  if (presentIntakeTables.length !== 0) {
    const mismatch = retainedIntakeProjectColumnMismatch(database);
    if (mismatch !== undefined) {
      throw new AuthorityActivationError(
        `SQLite authority bootstrap found substituted ${mismatch.kind} project binding ${mismatch.authority_id}`,
      );
    }
  }

  const intakeUnion =
    presentIntakeTables.length === 0
      ? ''
      : `
        UNION ALL
        SELECT 'RAW_REQUEST_REVISION', raw_request_id || '@' || revision, declared_project_path
          FROM raw_request_revisions WHERE declared_project_path IS NOT NULL
        UNION ALL
        SELECT 'INTAKE_RUN', id, project_path
          FROM intake_runs WHERE project_path IS NOT NULL
        UNION ALL
        SELECT 'INTENT_ADMISSION_DECISION', id, project_path
          FROM intent_admission_decisions WHERE project_path IS NOT NULL
        UNION ALL
        SELECT 'GOAL_MATERIALIZATION', id, project_path
          FROM goal_materializations`;
  const rows = retainedProjectReferenceRowsSchema.parse(
    database
      .prepare(
        `SELECT kind, authority_id, project_path
           FROM (
             SELECT 'GOAL' AS kind, id AS authority_id, project_path FROM goals
             ${intakeUnion}
           )
          ORDER BY kind, authority_id`,
      )
      .all(),
  );
  const seen = new Set<string>();
  return Object.freeze(
    rows.map((row) => {
      const identity = `${row.kind}\u0000${row.authority_id}`;
      if (seen.has(identity)) {
        throw new AuthorityActivationError(
          `SQLite authority bootstrap contains duplicate ${row.kind} project owner ${row.authority_id}`,
        );
      }
      seen.add(identity);
      return Object.freeze({
        kind: row.kind,
        authorityId: row.authority_id,
        projectPath: row.project_path,
      });
    }),
  );
}

const auditSequenceWatermarkRowSchema = z
  .object({
    through_sequence: z.number().int().nonnegative(),
  })
  .strict();

export type CreateGoalWithWorkflowInput = CommitGoalCreation;

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

function storeAuthoredIntakeOutcome(
  reservation: IntakeCommandReservation,
  rawResult: IntakeCommandResult,
  completedAt: IsoTimestamp,
): IntakeCommandOutcome {
  const result = decodeIntakeCommandResult(rawResult);
  const disposition =
    result.kind === 'REJECTED'
      ? IntakeCommandDisposition.REJECTED
      : result.kind === 'FAILED'
        ? IntakeCommandDisposition.FAILED
        : IntakeCommandDisposition.APPLIED;
  const resultDigest = canonicalAuthorityDigests.digest(intakeCommandResultProjection(result));
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    disposition,
    commandId: reservation.commandId,
    intakeRunId: reservation.intakeRunId,
    canonicalCommandInputDigest: reservation.canonicalCommandInputDigest,
    reservationDigest: reservation.reservationDigest,
    observedIntakeRunVersion: reservation.observedIntakeRunVersion,
    result,
    resultDigest,
    completedAt: isoTimestamp(completedAt),
  });
  return decodeIntakeCommandOutcome(
    {
      ...withoutDigest,
      outcomeDigest: canonicalAuthorityDigests.digest(
        intakeCommandOutcomeProjection(withoutDigest),
      ),
    },
    canonicalAuthorityDigests,
  );
}

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

function normalizePreparedFilename(filename: string): string {
  if (filename === ':memory:') {
    throw new AuthorityActivationError(
      'Verified SQLite authority activation requires a filesystem database',
    );
  }
  if (filename.trim().length === 0) {
    throw new AuthorityActivationError('Prepared SQLite filename must not be empty');
  }
  const absolute = resolve(filename);
  if (filename !== absolute) {
    throw new AuthorityActivationError(
      'Prepared SQLite filename must already be one normalized absolute path',
    );
  }
  return absolute;
}

function inspectAuthorityIsolationSnapshot(
  database: Database.Database,
  databasePath: string,
): SqliteAuthorityIsolationSnapshot {
  try {
    const objects = sqliteSchemaObjectRowsSchema.parse(
      database
        .prepare(
          `SELECT type, name
             FROM sqlite_schema
            WHERE name NOT LIKE 'sqlite_%'
            ORDER BY type, name`,
        )
        .all(),
    );
    if (objects.length === 0) {
      return Object.freeze({
        schemaVersion: 1,
        databasePath,
        databaseState: SqliteAuthorityDatabaseState.EMPTY,
        projectReferences: Object.freeze([]),
      });
    }

    const tableNames = new Set(
      objects.filter((object) => object.type === 'table').map((object) => object.name),
    );
    if (!tableNames.has('schema_migrations') || !tableNames.has('goals')) {
      throw new AuthorityActivationError(
        'SQLite authority bootstrap found an unsupported non-empty schema',
      );
    }

    const projectReferences = inspectRetainedProjectReferences(database, tableNames);
    return Object.freeze({
      schemaVersion: 1,
      databasePath,
      databaseState: SqliteAuthorityDatabaseState.RETAINED_M1,
      projectReferences,
    });
  } catch (error) {
    if (error instanceof AuthorityActivationError) {
      throw error;
    }
    throw new AuthorityActivationError(
      'SQLite authority bootstrap state failed strict inspection',
      { cause: error },
    );
  }
}

function decodeAuthorityIsolationLease(value: unknown): SqliteAuthorityIsolationLease {
  if (typeof value !== 'object' || value === null) {
    throw new AuthorityActivationError('Authority isolation verifier returned no lease');
  }
  const assertCurrent: unknown = Reflect.get(value, 'assertCurrent');
  const assertProjectPathAllowed: unknown = Reflect.get(value, 'assertProjectPathAllowed');
  if (typeof assertCurrent !== 'function' || typeof assertProjectPathAllowed !== 'function') {
    throw new AuthorityActivationError('Authority isolation verifier returned a malformed lease');
  }
  return Object.freeze({
    assertCurrent: () => {
      Reflect.apply(assertCurrent, value, []);
    },
    assertProjectPathAllowed: (projectPath: string) => {
      Reflect.apply(assertProjectPathAllowed, value, [projectPath]);
    },
  });
}

function rawField(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
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

const intakeAuditWriteInputSchema = z
  .object({
    id: z.string(),
    aggregateType: z.enum(Object.values(IntakeAuditAggregateType)),
    aggregateId: z.string(),
    eventType: z.enum(Object.values(IntakeAuditEventType)),
    payloadDigest: z.string(),
    occurredAt: z.string(),
    beforeVersion: z.number().optional(),
    afterVersion: z.number().optional(),
    correlationId: z.string().optional(),
    causationId: z.string().optional(),
  })
  .strict();

function validateIntakeAuditWrites(rawWrites: unknown): readonly IntakeAuditWrite[] {
  const writes = z.array(intakeAuditWriteInputSchema).min(1).parse(rawWrites);
  const seen = new Set<AuditEventId>();
  return Object.freeze(
    writes.map((rawWrite) => {
      const id = auditEventId(rawWrite.id);
      if (seen.has(id)) {
        throw new TypeError(`Intake audit event ${id} is duplicated`);
      }
      seen.add(id);
      if (typeof rawWrite.aggregateId !== 'string' || rawWrite.aggregateId.trim().length === 0) {
        throw new TypeError('Intake audit aggregate identity must not be blank');
      }
      const beforeVersion = rawWrite.beforeVersion;
      const afterVersion = rawWrite.afterVersion;
      for (const [name, version] of [
        ['beforeVersion', beforeVersion],
        ['afterVersion', afterVersion],
      ] as const) {
        if (version !== undefined && (!Number.isSafeInteger(version) || version < 1)) {
          throw new TypeError(`${name} must be a positive safe integer when present`);
        }
      }
      const correlationId = validateOptionalMetadata(rawWrite.correlationId, 'correlationId');
      const causationId = validateOptionalMetadata(rawWrite.causationId, 'causationId');
      return Object.freeze({
        id,
        aggregateType: rawWrite.aggregateType,
        aggregateId: rawWrite.aggregateId,
        eventType: rawWrite.eventType,
        payloadDigest: sha256Digest(rawWrite.payloadDigest),
        occurredAt: isoTimestamp(rawWrite.occurredAt),
        ...(beforeVersion === undefined ? {} : { beforeVersion }),
        ...(afterVersion === undefined ? {} : { afterVersion }),
        ...(correlationId === undefined ? {} : { correlationId }),
        ...(causationId === undefined ? {} : { causationId }),
      });
    }),
  );
}

type IntakeAuditEventName = IntakeAuditWrite['eventType'];

const initialIntakeReservationAuditEvents = Object.freeze([
  IntakeAuditEventType.RAW_REQUEST_ADMITTED,
  IntakeAuditEventType.INTAKE_RUN_CREATED,
  IntakeAuditEventType.INTAKE_COMMAND_RESERVED,
] satisfies readonly IntakeAuditEventName[]);

const clarificationIntakeReservationAuditEvents = Object.freeze([
  IntakeAuditEventType.RAW_REQUEST_ADMITTED,
  IntakeAuditEventType.CLARIFICATION_ANSWER_BOUND,
  IntakeAuditEventType.INTAKE_COMMAND_RESERVED,
] satisfies readonly IntakeAuditEventName[]);

const clarifyIntakeCommitAuditEvents = Object.freeze([
  IntakeAuditEventType.INTENT_ANALYSIS_RECORDED,
  IntakeAuditEventType.INTENT_PROJECTION_RECORDED,
  IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
  IntakeAuditEventType.CLARIFICATION_QUESTION_ACTIVATED,
  IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
] satisfies readonly IntakeAuditEventName[]);

const analyzedNoExecutionAuditEvents = Object.freeze([
  IntakeAuditEventType.INTENT_ANALYSIS_RECORDED,
  IntakeAuditEventType.INTENT_PROJECTION_RECORDED,
  IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
  IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
] satisfies readonly IntakeAuditEventName[]);

const immediateNoExecutionAuditEvents = Object.freeze([
  IntakeAuditEventType.RAW_REQUEST_ADMITTED,
  IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
  IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
] satisfies readonly IntakeAuditEventName[]);

const abandonmentAuditEvents = Object.freeze([
  IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
  IntakeAuditEventType.INTAKE_RUN_UPDATED,
  IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
] satisfies readonly IntakeAuditEventName[]);

const answerOnlyAuditEvents = Object.freeze([
  IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
  IntakeAuditEventType.ANSWER_ONLY_RESPONSE_RECORDED,
  IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
] satisfies readonly IntakeAuditEventName[]);

const intakeFailureAuditEvents = Object.freeze([
  IntakeAuditEventType.INTAKE_FAILURE_RECORDED,
  IntakeAuditEventType.INTAKE_RUN_UPDATED,
  IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
] satisfies readonly IntakeAuditEventName[]);

const intakeCommandRejectionAuditEvents = Object.freeze([
  IntakeAuditEventType.INTAKE_COMMAND_REJECTED,
] satisfies readonly IntakeAuditEventName[]);

const materializationAuditEvents = Object.freeze([
  IntakeAuditEventType.INTENT_ANALYSIS_RECORDED,
  IntakeAuditEventType.INTENT_PROJECTION_RECORDED,
  IntakeAuditEventType.INTENT_ADMISSION_DECIDED,
  IntakeAuditEventType.GOAL_MATERIALIZED,
  IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
] satisfies readonly IntakeAuditEventName[]);

function materializationAuditEventsFor(
  hasStartAuthorization: boolean,
): readonly IntakeAuditEventName[] {
  return hasStartAuthorization
    ? Object.freeze([
        ...materializationAuditEvents.slice(0, -1),
        IntakeAuditEventType.GOAL_START_AUTHORIZED,
        IntakeAuditEventType.INTAKE_COMMAND_COMPLETED,
      ])
    : materializationAuditEvents;
}

function assertExactIntakeAuditPlan(
  writes: readonly IntakeAuditWrite[],
  runIdentifier: string,
  expectedEventTypes: readonly IntakeAuditEventName[],
  causalFloors: readonly IsoTimestamp[],
  terminalAt: IsoTimestamp,
): void {
  if (
    writes.length !== expectedEventTypes.length ||
    causalFloors.length !== expectedEventTypes.length ||
    writes.some(
      (write, index) =>
        write.aggregateType !== IntakeAuditAggregateType.INTAKE_RUN ||
        write.aggregateId !== runIdentifier ||
        write.eventType !== expectedEventTypes[index] ||
        write.occurredAt < (causalFloors[index] ?? terminalAt) ||
        (index > 0 && write.occurredAt < (writes[index - 1]?.occurredAt ?? write.occurredAt)),
    ) ||
    writes.at(-1)?.occurredAt !== terminalAt
  ) {
    throw new StoreInvariantError(`Intake Run ${runIdentifier} has a substituted audit plan`);
  }
}

function expectedRetainedIntakeAuditEvents(
  reservation: IntakeCommandReservation,
  outcome: IntakeCommandOutcome | undefined,
): readonly IntakeAuditEventName[] {
  if (outcome?.disposition === IntakeCommandDisposition.REJECTED) {
    return intakeCommandRejectionAuditEvents;
  }
  if (reservation.operationKind === IntakeCommandOperationKind.IMMEDIATE_NO_EXECUTION) {
    return immediateNoExecutionAuditEvents;
  }
  if (reservation.operationKind === IntakeCommandOperationKind.ABANDON_CLARIFICATION) {
    return abandonmentAuditEvents;
  }

  const reservationEvents =
    reservation.operationKind === IntakeCommandOperationKind.CLARIFICATION_ANALYSIS
      ? clarificationIntakeReservationAuditEvents
      : initialIntakeReservationAuditEvents;
  if (outcome === undefined) {
    return reservationEvents;
  }
  switch (outcome.result.kind) {
    case 'CLARIFICATION_REQUIRED':
      return Object.freeze([...reservationEvents, ...clarifyIntakeCommitAuditEvents]);
    case 'NO_EXECUTION':
      return Object.freeze([
        ...reservationEvents,
        ...(reservation.operationKind === IntakeCommandOperationKind.ANSWER_ONLY
          ? answerOnlyAuditEvents
          : analyzedNoExecutionAuditEvents),
      ]);
    case 'FAILED':
      return Object.freeze([...reservationEvents, ...intakeFailureAuditEvents]);
    case 'MATERIALIZED':
      return Object.freeze([
        ...reservationEvents,
        ...materializationAuditEventsFor('goalStartAuthorizationRef' in outcome.result),
      ]);
  }
}

function validateCreateGoalWithWorkflowInput(
  rawInput: CreateGoalWithWorkflowInput,
): CreateGoalWithWorkflowInput {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  const goal = decodeGoalSnapshot(rawInput.goal);
  const workflow = decodeWorkflowSnapshot(rawInput.workflow);
  const payloadDigest = sha256Digest(rawInput.payloadDigest);
  if (
    payloadDigest !==
    canonicalAuthorityDigests.digest(goalAndWorkflowCreationPayloadProjection(goal, workflow))
  ) {
    throw new StoreInvariantError('Goal creation has an inconsistent payload digest');
  }
  return Object.freeze({
    commandId: commandId(rawInput.commandId),
    inputDigest: sha256Digest(rawInput.inputDigest),
    goal,
    workflow,
    workflowAuditEventId: auditEventId(rawInput.workflowAuditEventId),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest,
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

function validateRecoveryDigest(record: RecoveryReconciliationRecord): void {
  const expected = sha256Digest(
    canonicalAuthorityDigests.digest(recoveryReconciliationProjection(record)),
  );
  if (record.reconciliationDigest !== expected) {
    throw new StoreInvariantError(
      `Recovery reconciliation ${record.id} has a false canonical digest`,
    );
  }
}

type ValidatedCommitStartupRecovery = Omit<CommitStartupRecovery, 'event' | 'recovery'> & {
  readonly event: Extract<AttemptEvent, { readonly type: 'ATTEMPT_FINISHED' }>;
  readonly recovery: RecoveryReconciliationRecord;
};

function validateCommitStartupRecovery(
  rawInput: CommitStartupRecovery,
): ValidatedCommitStartupRecovery {
  const base = validateCommitAttemptEventInput(rawInput);
  const event = base.event;
  const recovery = decodeRecoveryReconciliationRecord(rawInput.recovery);
  const recoveryAuditEventId = auditEventId(rawInput.recoveryAuditEventId);
  const externalExecutionAuditEventId =
    rawInput.externalExecutionAuditEventId === undefined
      ? undefined
      : auditEventId(rawInput.externalExecutionAuditEventId);
  const externalMaintenanceAuditEventId =
    rawInput.externalMaintenanceAuditEventId === undefined
      ? undefined
      : auditEventId(rawInput.externalMaintenanceAuditEventId);
  const auditIdentifiers = [
    base.auditEventId,
    base.workflowAuditEventId,
    recoveryAuditEventId,
    ...(externalExecutionAuditEventId === undefined ? [] : [externalExecutionAuditEventId]),
    ...(externalMaintenanceAuditEventId === undefined ? [] : [externalMaintenanceAuditEventId]),
  ];
  validateRecoveryDigest(recovery);
  if (
    event.type !== 'ATTEMPT_FINISHED' ||
    event.toStatus !== AttemptStatus.INTERRUPTED ||
    event.resultingRunStatus !== RunStatus.BLOCKED ||
    !event.terminationReason.startsWith(`${AttemptInterruptionReason.RECOVERY_RECONCILIATION}:`) ||
    recovery.purpose !== RecoveryReconciliationPurpose.STARTUP ||
    recovery.workflowId !== event.workflowId ||
    recovery.phase !== event.phase ||
    recovery.sourceAttemptId !== event.attemptId ||
    recovery.inspectedWorkflowVersion !== event.fromWorkflowVersion ||
    recovery.resultingWorkflowVersion !== event.toWorkflowVersion ||
    recovery.inspectedAt !== event.occurredAt ||
    new Set(auditIdentifiers).size !== auditIdentifiers.length
  ) {
    throw new StoreInvariantError(
      'Startup recovery does not bind one exact interrupted Attempt transition',
    );
  }
  return Object.freeze({
    ...base,
    event,
    recovery,
    recoveryAuditEventId,
    ...(externalExecutionAuditEventId === undefined ? {} : { externalExecutionAuditEventId }),
    ...(externalMaintenanceAuditEventId === undefined ? {} : { externalMaintenanceAuditEventId }),
  });
}

function validateCommitResumeRecovery(rawInput: CommitResumeRecovery): CommitResumeRecovery {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  const input = Object.freeze({
    commandId: commandId(rawInput.commandId),
    inputDigest: sha256Digest(rawInput.inputDigest),
    target: decodeCommandTarget(rawInput.target),
    event: decodeRecoveryWorkflowEvent(rawInput.event),
    recovery: decodeRecoveryReconciliationRecord(rawInput.recovery),
    recoveryAuditEventId: auditEventId(rawInput.recoveryAuditEventId),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
  validateRecoveryDigest(input.recovery);
  if (
    input.commandId !== input.event.commandId ||
    input.recovery.purpose !== RecoveryReconciliationPurpose.RESUME ||
    input.recovery.disposition === RecoveryReconciliationDisposition.SAFE_EARLIER_PHASE ||
    input.recovery.workflowId !== input.event.workflowId ||
    input.recovery.phase !== input.event.fromPhase ||
    input.recovery.inspectedWorkflowVersion !== input.event.fromVersion ||
    input.recovery.resultingWorkflowVersion !== input.event.toVersion ||
    input.recovery.id !== input.event.reconciliationId ||
    input.recovery.reconciliationDigest !== input.event.reconciliationDigest ||
    input.recovery.inspectedAt !== input.event.occurredAt ||
    input.recoveryAuditEventId === input.auditEventId
  ) {
    throw new StoreInvariantError(
      'Resume recovery does not bind one exact M1 Workflow reconciliation transition',
    );
  }
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

function isProtectedContextManifest(manifest: ContextManifest): boolean {
  return manifest.schemaVersion === 4 || manifest.schemaVersion === 5;
}

function validateCommitContextBoundAttemptStart(
  rawInput: CommitContextBoundAttemptStart,
): CommitContextBoundAttemptStart {
  const input = validateCommitAttemptEventInput(rawInput);
  const contextManifest = decodeContextManifest(rawInput.contextManifest);
  const policyBinding = decodeWorkflowPolicyBinding(rawInput.policyBinding);
  const policyBindingAuditEventId =
    rawInput.policyBindingAuditEventId === undefined
      ? undefined
      : auditEventId(rawInput.policyBindingAuditEventId);
  const executionProfileBinding = decodeExecutionProfileBinding(rawInput.executionProfileBinding);
  const executionProfileBindingAuditEventId =
    rawInput.executionProfileBindingAuditEventId === undefined
      ? undefined
      : auditEventId(rawInput.executionProfileBindingAuditEventId);
  const protectedPlan =
    rawInput.acceptanceCriticalVerificationPlan === undefined
      ? undefined
      : decodeAcceptanceCriticalVerificationPlan(rawInput.acceptanceCriticalVerificationPlan);
  const protectedPlanAuditEventId =
    rawInput.acceptanceCriticalVerificationPlanAuditEventId === undefined
      ? undefined
      : auditEventId(rawInput.acceptanceCriticalVerificationPlanAuditEventId);
  const projectReadAuthority =
    rawInput.projectReadAuthority === undefined
      ? undefined
      : decodeProjectSourceReadAuthorityRecord(rawInput.projectReadAuthority);
  const projectReadAuthorityAuditEventId =
    rawInput.projectReadAuthorityAuditEventId === undefined
      ? undefined
      : auditEventId(rawInput.projectReadAuthorityAuditEventId);
  if (
    input.event.type !== 'ATTEMPT_STARTED' ||
    input.event.attempt.contextManifestId !== contextManifest.id ||
    input.event.attempt.workerSessionRef === undefined ||
    contextManifest.attemptId !== input.event.attempt.id ||
    contextManifest.workflowId !== input.event.workflowId ||
    contextManifest.workflowVersion !== input.event.toWorkflowVersion ||
    contextManifest.phase !== input.event.attempt.phase ||
    policyBinding.goalId !== contextManifest.goalId ||
    policyBinding.workflowId !== contextManifest.workflowId ||
    policyBinding.policyBundleId !== contextManifest.policyBundleId ||
    policyBinding.policyBundleDigest !== contextManifest.policyBundleDigest ||
    policyBinding.boundAt > contextManifest.createdAt ||
    executionProfileBinding.goalId !== contextManifest.goalId ||
    executionProfileBinding.workflowId !== contextManifest.workflowId ||
    executionProfileBinding.profileId !== contextManifest.executionProfileId ||
    executionProfileBinding.profileDigest !== contextManifest.executionProfileDigest ||
    executionProfileBinding.boundAt > contextManifest.createdAt ||
    (input.event.attempt.sequence === 1) !== (policyBindingAuditEventId !== undefined) ||
    (input.event.attempt.sequence === 1) !== (executionProfileBindingAuditEventId !== undefined) ||
    (protectedPlan === undefined) !== (protectedPlanAuditEventId === undefined) ||
    isProtectedContextManifest(contextManifest) !==
      (contextManifest.acceptanceCriticalVerificationPlanId !== undefined) ||
    (input.event.attempt.sequence === 1 && isProtectedContextManifest(contextManifest)) !==
      (protectedPlan !== undefined) ||
    (input.event.attempt.sequence !== 1 && protectedPlan !== undefined) ||
    (projectReadAuthority === undefined) !== (projectReadAuthorityAuditEventId === undefined) ||
    (contextManifest.schemaVersion === 5) !== (projectReadAuthority !== undefined) ||
    (projectReadAuthority !== undefined &&
      (projectReadAuthority.id !== contextManifest.projectReadAuthorityId ||
        projectReadAuthority.recordDigest !== contextManifest.projectReadAuthorityRecordDigest ||
        projectReadAuthority.sourceTree.projectionDigest !==
          contextManifest.projectReadSourceTreeProjectionDigest ||
        projectReadAuthority.gitState.projectionDigest !==
          contextManifest.projectReadGitStateProjectionDigest ||
        projectReadAuthority.goalId !== contextManifest.goalId ||
        projectReadAuthority.goalRevision !== contextManifest.goalRevision ||
        projectReadAuthority.workflowId !== contextManifest.workflowId ||
        projectReadAuthority.workflowVersion !== contextManifest.workflowVersion ||
        projectReadAuthority.phase !== contextManifest.phase ||
        projectReadAuthority.attemptId !== contextManifest.attemptId ||
        projectReadAuthority.policyBundleId !== contextManifest.policyBundleId ||
        projectReadAuthority.policyBundleDigest !== contextManifest.policyBundleDigest ||
        projectReadAuthority.executionProfileId !== contextManifest.executionProfileId ||
        projectReadAuthority.executionProfileDigest !== contextManifest.executionProfileDigest ||
        projectReadAuthority.capabilityGrantDigest !== contextManifest.capabilityGrantDigest ||
        projectReadAuthority.responseContractDigest !== contextManifest.responseContractDigest ||
        projectReadAuthority.issuedAt > contextManifest.createdAt)) ||
    (protectedPlan !== undefined &&
      (protectedPlan.id !== contextManifest.acceptanceCriticalVerificationPlanId ||
        protectedPlan.planDigest !== contextManifest.acceptanceCriticalVerificationPlanDigest ||
        protectedPlan.goalId !== contextManifest.goalId ||
        protectedPlan.goalRevision !== contextManifest.goalRevision ||
        protectedPlan.workflowId !== contextManifest.workflowId ||
        protectedPlan.workflowVersionAtLock !== contextManifest.workflowVersion ||
        protectedPlan.policyBundleId !== contextManifest.policyBundleId ||
        protectedPlan.policyBundleDigest !== contextManifest.policyBundleDigest ||
        protectedPlan.executionProfileId !== contextManifest.executionProfileId ||
        protectedPlan.executionProfileDigest !== contextManifest.executionProfileDigest ||
        protectedPlan.createdAt !== contextManifest.createdAt)) ||
    (input.event.attempt.sequence === 1 &&
      (policyBinding.startCommandId !== input.event.commandId ||
        policyBinding.boundAt !== input.event.occurredAt ||
        executionProfileBinding.startCommandId !== input.event.commandId ||
        executionProfileBinding.boundAt !== input.event.occurredAt))
  ) {
    throw new StoreInvariantError(
      'Context Manifest, Workflow Policy, or Execution Profile does not bind the started Worker Attempt',
    );
  }
  return Object.freeze({
    ...input,
    contextManifest,
    policyBinding,
    ...(policyBindingAuditEventId === undefined ? {} : { policyBindingAuditEventId }),
    executionProfileBinding,
    ...(executionProfileBindingAuditEventId === undefined
      ? {}
      : { executionProfileBindingAuditEventId }),
    ...(protectedPlan === undefined ? {} : { acceptanceCriticalVerificationPlan: protectedPlan }),
    ...(protectedPlanAuditEventId === undefined
      ? {}
      : { acceptanceCriticalVerificationPlanAuditEventId: protectedPlanAuditEventId }),
    ...(projectReadAuthority === undefined ? {} : { projectReadAuthority }),
    ...(projectReadAuthorityAuditEventId === undefined ? {} : { projectReadAuthorityAuditEventId }),
  });
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

function validateInstallExecutionProfile(
  rawInput: InstallExecutionProfile,
): InstallExecutionProfile {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    profile: decodeExecutionProfile(rawInput.profile),
    installedAt: isoTimestamp(rawInput.installedAt),
    auditEventId: auditEventId(rawInput.auditEventId),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(correlationId === undefined ? {} : { correlationId }),
    ...(causationId === undefined ? {} : { causationId }),
  });
}

function validateInstallExternalBackendCapabilityRecord(
  rawInput: InstallExternalBackendCapabilityRecord,
): InstallExternalBackendCapabilityRecord {
  const correlationId = validateOptionalMetadata(rawInput.correlationId, 'correlationId');
  const causationId = validateOptionalMetadata(rawInput.causationId, 'causationId');
  return Object.freeze({
    record: decodeExternalBackendCapabilityRecord(rawInput.record),
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

function validateClaimExternalWorkerDispatch(
  rawInput: ClaimExternalWorkerDispatch,
): ClaimExternalWorkerDispatch {
  const base = validateClaimWorkerDispatch(rawInput);
  const externalAuditEventId = auditEventId(rawInput.externalAuditEventId);
  if (externalAuditEventId === base.auditEventId) {
    throw new StoreInvariantError('External execution and dispatch claim require distinct audits');
  }
  return Object.freeze({
    ...base,
    intent: decodeExternalExecutionIntent(rawInput.intent),
    externalAuditEventId,
  });
}

function validateAdmitExternalExecutionObservation(
  rawInput: AdmitExternalExecutionObservation,
): AdmitExternalExecutionObservation {
  const observation = decodeExternalExecutionObservation(rawInput.observation);
  if (
    observation.processIdentity !== undefined &&
    observation.processIdentity.identityDigest !==
      sha256Digest(
        canonicalAuthorityDigests.digest(
          externalProcessIdentityProjection(observation.processIdentity),
        ),
      )
  ) {
    throw new StoreInvariantError('External process observation has a false identity digest');
  }
  if (observation.failureCode !== undefined) {
    externalWorkerFailureCode(observation.failureCode);
  }
  const observationAuditEventId = auditEventId(rawInput.observationAuditEventId);
  const recordAuditEventId = auditEventId(rawInput.recordAuditEventId);
  if (observationAuditEventId === recordAuditEventId) {
    throw new StoreInvariantError('External observation and record update require distinct audits');
  }
  return Object.freeze({
    observation,
    observationAuditEventId,
    recordAuditEventId,
  });
}

function validateAbandonExternalExecution(
  rawInput: AbandonExternalExecution,
): AbandonExternalExecution {
  if (!Number.isSafeInteger(rawInput.expectedRecordVersion) || rawInput.expectedRecordVersion < 1) {
    throw new TypeError('External execution expected version must be a positive integer');
  }
  const reasonCode = externalExecutionAbandonReasonCode(rawInput.reasonCode);
  return Object.freeze({
    externalExecutionId: externalExecutionId(rawInput.externalExecutionId),
    expectedRecordVersion: rawInput.expectedRecordVersion,
    reasonCode,
    abandonedAt: isoTimestamp(rawInput.abandonedAt),
    auditEventId: auditEventId(rawInput.auditEventId),
  });
}

function validateAuthorizeExternalMaintenance(
  rawInput: AuthorizeExternalMaintenance,
): AuthorizeExternalMaintenance {
  const intent = decodeExternalMaintenanceIntent(rawInput.intent);
  if (intent.state !== ExternalMaintenanceState.AUTHORIZED) {
    throw new TypeError('External maintenance authorization must be in AUTHORIZED state');
  }
  return Object.freeze({
    intent,
    auditEventId: auditEventId(rawInput.auditEventId),
  });
}

function validateCompleteExternalMaintenance(
  rawInput: CompleteExternalMaintenance,
): CompleteExternalMaintenance {
  const state = rawInput.state;
  const allowedStates: readonly unknown[] = [
    ExternalMaintenanceState.OBSERVED,
    ExternalMaintenanceState.FAILED,
    ExternalMaintenanceState.ABANDONED,
  ];
  if (
    rawField(rawInput, 'expectedState') !== ExternalMaintenanceState.AUTHORIZED ||
    !allowedStates.includes(rawField(rawInput, 'state'))
  ) {
    throw new TypeError('External maintenance transition is unsupported');
  }
  const failureCode =
    rawInput.failureCode === undefined
      ? undefined
      : externalMaintenanceFailureCode(rawInput.failureCode);
  if ((state === ExternalMaintenanceState.OBSERVED) === (failureCode !== undefined)) {
    throw new TypeError('External maintenance transition has invalid failure details');
  }
  return Object.freeze({
    maintenanceIntentId: externalMaintenanceIntentId(rawInput.maintenanceIntentId),
    expectedState: rawInput.expectedState,
    state,
    observedAt: isoTimestamp(rawInput.observedAt),
    ...(failureCode === undefined ? {} : { failureCode }),
    auditEventId: auditEventId(rawInput.auditEventId),
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

function validateCommitVerificationIntegrityFailure(
  rawInput: CommitVerificationIntegrityFailure,
): CommitVerificationIntegrityFailure {
  const base = validateCommitAttemptEventInput(rawInput);
  const candidateEvent = decodeCandidateEvent(rawInput.candidateEvent);
  const expectedFrozenDigest = sha256Digest(rawInput.expectedFrozenDigest);
  const observedDigest = sha256Digest(rawInput.observedDigest);
  if (
    base.event.type !== 'ATTEMPT_FINISHED' ||
    base.event.phase !== WorkflowPhase.EVIDENCE_BUILD ||
    base.event.toStatus !== AttemptStatus.FAILED ||
    base.event.failureClass !== AttemptFailureClass.INTEGRITY_VIOLATION ||
    base.event.terminationReason !== LocalCommandVerificationFailureCode.CANDIDATE_SOURCE_DRIFT ||
    base.event.commandId !== candidateEvent.commandId ||
    base.event.occurredAt !== candidateEvent.occurredAt ||
    candidateEvent.fromState !== CandidateGenerationState.FROZEN ||
    candidateEvent.toState !== CandidateGenerationState.INVALIDATED ||
    candidateEvent.reason !== 'FROZEN_CANDIDATE_DRIFT' ||
    expectedFrozenDigest === observedDigest
  ) {
    throw new StoreInvariantError(
      'Verification integrity failure does not bind its Attempt and Candidate failure',
    );
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
  const payloads = validateEvidencePayloads(evidence, rawInput.payloads);
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
    ...(payloads === undefined ? {} : { payloads }),
    initialEligibility,
    evidenceAuditEventId: auditEventId(rawInput.evidenceAuditEventId),
  });
}

function validateEvidencePayloads(
  evidence: EvidenceRecord,
  rawPayloads: readonly EvidencePayload[] | undefined,
): readonly EvidencePayload[] | undefined {
  if (evidence.kind !== EvidenceKind.LOCAL_COMMAND_TEST_RESULT) {
    if (rawPayloads !== undefined) {
      throw new StoreInvariantError('M1 Evidence cannot carry stored payload bytes');
    }
    return undefined;
  }
  if (rawPayloads?.length !== 2) {
    throw new StoreInvariantError('Local command Evidence requires stdout and stderr payloads');
  }
  const payloads = Object.freeze(
    rawPayloads.map((rawPayload, index) => {
      if (!(rawPayload.bytes instanceof Uint8Array)) {
        throw new StoreInvariantError('Evidence payload bytes are malformed');
      }
      const bytes = new Uint8Array(rawPayload.bytes);
      const digest = sha256Digest(rawPayload.digest);
      if (
        !Number.isSafeInteger(rawPayload.byteLength) ||
        rawPayload.byteLength < 0 ||
        rawPayload.byteLength !== bytes.byteLength ||
        digest !== sha256Digest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
      ) {
        throw new StoreInvariantError('Evidence payload identity does not match its bytes');
      }
      const reference = evidence.payloadRefs[index];
      if (reference?.digest !== digest || reference.byteLength !== bytes.byteLength) {
        throw new StoreInvariantError('Evidence payload does not match its record reference');
      }
      return Object.freeze({ digest, byteLength: bytes.byteLength, bytes });
    }),
  );
  return payloads;
}

function validateCommitLocalCommandVerificationAuthority(
  rawInput: CommitLocalCommandVerificationAuthority,
): CommitLocalCommandVerificationAuthority {
  const checkSpecification = decodeCheckSpecification(rawInput.checkSpecification);
  if (checkSpecification.kind !== CheckSpecificationKind.LOCAL_COMMAND) {
    throw new StoreInvariantError('Local verification authority requires a LOCAL_COMMAND Check');
  }
  const obligations = Object.freeze(
    rawInput.obligations.map((obligation) => decodeVerificationObligation(obligation)),
  );
  return Object.freeze({
    commandId: commandId(rawInput.commandId),
    inputDigest: sha256Digest(rawInput.inputDigest),
    target: decodeCommandTarget(rawInput.target),
    workflowId: workflowId(rawInput.workflowId),
    expectedWorkflowVersion: workflowVersion(rawInput.expectedWorkflowVersion),
    checkSpecification,
    obligations,
    auditEventId: auditEventId(rawInput.auditEventId),
    checkSpecificationAuditEventId: auditEventId(rawInput.checkSpecificationAuditEventId),
    obligationAuditEventIds: validateAuditIdentifiers(
      rawInput.obligationAuditEventIds,
      obligations.length,
      'Local Verification Obligation',
    ),
    payloadDigest: sha256Digest(rawInput.payloadDigest),
    ...(rawInput.correlationId === undefined ? {} : { correlationId: rawInput.correlationId }),
    ...(rawInput.causationId === undefined ? {} : { causationId: rawInput.causationId }),
    occurredAt: isoTimestamp(rawInput.occurredAt),
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
  const repair = decodeAcceptanceRepairRecord(rawInput.repair);
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
  const rejectedCandidateAuditEventId = auditEventId(rawInput.rejectedCandidateAuditEventId);
  const generationAuditEventId = auditEventId(rawInput.generationAuditEventId);
  const repairAuditEventId = auditEventId(rawInput.repairAuditEventId);
  const allAuditEventIds = [
    base.auditEventId,
    rejectedCandidateAuditEventId,
    generationAuditEventId,
    ...checkSpecificationAuditEventIds,
    ...obligationAuditEventIds,
    repairAuditEventId,
  ];
  if (new Set(allAuditEventIds).size !== allAuditEventIds.length) {
    throw new StoreInvariantError('Acceptance repair Audit identities must be distinct');
  }
  const freeze = checkSpecifications[0];
  const verification = checkSpecifications[1];
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
    generation.candidateId !== candidate.id ||
    repair.workflowId !== base.event.workflowId ||
    repair.workflowVersion !== base.event.toVersion ||
    repair.rejectedCandidateGenerationId !== rejectedCandidateEvent.candidateGenerationId ||
    repair.rejectedCandidateVersion !== rejectedCandidateEvent.toVersion ||
    repair.repairCandidateGenerationId !== generation.id ||
    repair.repairCandidateSequence !== generation.sequence ||
    repair.repairCandidateBaseDigest !== generation.baseDigest ||
    repair.repairedAt !== base.event.occurredAt ||
    checkSpecifications.length !== 2 ||
    freeze === undefined ||
    verification === undefined ||
    repair.freezeCheckId !== freeze.id ||
    repair.freezeCheckVersion !== freeze.version ||
    repair.verificationCheckId !== verification.id ||
    repair.verificationCheckVersion !== verification.version ||
    canonicalizeJson(repair.verificationObligationIds) !==
      canonicalizeJson(obligations.map((obligation) => obligation.id))
  ) {
    throw new StoreInvariantError(
      'Acceptance repair does not bind one child-generation transition',
    );
  }
  return Object.freeze({
    ...base,
    repair,
    candidate,
    rejectedCandidateEvent,
    generation,
    checkSpecifications,
    obligations,
    rejectedCandidateAuditEventId,
    generationAuditEventId,
    checkSpecificationAuditEventIds,
    obligationAuditEventIds,
    repairAuditEventId,
  });
}

function validateAggregateLookup(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value;
}

type WorkflowStartAuthorityClosure =
  | {
      readonly state: 'UNSTARTED';
      readonly workflow: WorkflowInstance;
    }
  | {
      readonly state: 'CANCELLED_BEFORE_START';
      readonly workflow: WorkflowInstance;
      readonly cancellationAudit: AuditEventRecord;
    }
  | {
      readonly state: 'STARTED';
      readonly workflow: WorkflowInstance;
      readonly firstAttempt: Attempt;
      readonly contextManifest: ContextManifest;
      readonly policyBinding: WorkflowPolicyBinding;
      readonly executionProfileBinding: ExecutionProfileBinding;
    };

function isM1CodingWorkerPhase(phase: WorkflowPhase): boolean {
  return (
    phase === WorkflowPhase.DISCOVERY ||
    phase === WorkflowPhase.PLAN ||
    phase === WorkflowPhase.IMPLEMENT
  );
}

export class SqliteControlStore
  implements
    AcceptanceControlStore,
    CodeClosureApplicationStore,
    WorkflowDriverControlStore,
    IntakeControlStore,
    ProjectReadCleanupControlStore
{
  readonly #database: Database.Database;
  readonly #appliedMigrations: readonly AppliedMigration[];
  readonly #authorityIsolationLease: SqliteAuthorityIsolationLease | undefined;
  readonly #transactionProbe:
    | ((
        step:
          | TransactionStep
          | WorkerTransactionStep
          | CandidateEvidenceTransactionStep
          | AcceptanceTransactionStep
          | RecoveryTransactionStep
          | IntakeTransactionStep
          | ProjectReadCleanupTransactionStep,
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
            | AcceptanceTransactionStep
            | RecoveryTransactionStep
            | IntakeTransactionStep
            | ProjectReadCleanupTransactionStep,
        ) => void)
      | undefined,
    authorityIsolationLease?: SqliteAuthorityIsolationLease,
  ) {
    this.#database = database;
    this.#appliedMigrations = Object.freeze([...appliedMigrations]);
    this.#transactionProbe = transactionProbe;
    this.#authorityIsolationLease = authorityIsolationLease;
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
      if (database.pragma('foreign_keys', { simple: true }) !== 1) {
        throw new StoreInvariantError('SQLite migrations did not restore foreign-key enforcement');
      }
      const store = new SqliteControlStore(database, migrations, options.transactionProbe);
      store.assertRetainedWorkflowAttemptLifecycleClosure();
      store.assertRetainedWorkflowStartAuthorityClosure();
      store.assertRetainedM1RetryBoundaryClosure();
      store.assertRetainedWorkerAuthorityClosure();
      store.assertRetainedTerminalAttemptAuthorityClosure();
      store.assertRetainedCurrentWorkflowCommandClosure();
      store.assertRetainedCandidateEvidenceAuthorityClosure();
      store.assertRetainedRecoveryAuthorityClosure();
      store.assertRetainedAcceptanceAuthorityClosure();
      store.assertRetainedProtectedVerificationAuthorityClosure();
      store.assertRetainedProjectReadAuthorityClosure();
      store.assertRetainedProjectReadCleanupAuthorityClosure();
      store.assertRetainedIntakeAuthorityClosure();
      return store;
    } catch (error) {
      database.close();
      throw error;
    }
  }

  public static openVerified(options: VerifiedSqliteControlStoreOptions): SqliteControlStore {
    const filename = normalizePreparedFilename(options.filename);
    const busyTimeout = validateBusyTimeout(options.busyTimeoutMilliseconds ?? 5_000);
    const database = new Database(filename, { fileMustExist: true, timeout: busyTimeout });

    try {
      database.pragma('foreign_keys = ON');
      database.pragma(`busy_timeout = ${busyTimeout}`);
      database.pragma('synchronous = FULL');
      const foreignKeys = database.pragma('foreign_keys', { simple: true });
      if (foreignKeys !== 1) {
        throw new StoreInvariantError('SQLite foreign-key enforcement could not be enabled');
      }

      database.pragma('foreign_keys = OFF');
      if (database.pragma('foreign_keys', { simple: true }) !== 0) {
        throw new StoreInvariantError(
          'SQLite foreign-key enforcement could not be suspended for migration',
        );
      }

      database.exec('BEGIN IMMEDIATE');
      database.pragma('query_only = ON');
      const isolationSnapshot = inspectAuthorityIsolationSnapshot(database, filename);
      const isolationLease = decodeAuthorityIsolationLease(
        options.isolationVerifier.verify(isolationSnapshot),
      );
      isolationLease.assertCurrent();

      database.pragma('query_only = OFF');
      const migrations = applyMigrationsWithinCurrentTransaction(
        database,
        options.migrationsDirectory ?? defaultMigrationsDirectory(),
        options.now ?? systemNow,
      );
      const store = new SqliteControlStore(
        database,
        migrations,
        options.transactionProbe,
        isolationLease,
      );
      store.assertRetainedWorkflowAttemptLifecycleClosure();
      store.assertRetainedWorkflowStartAuthorityClosure();
      store.assertRetainedM1RetryBoundaryClosure();
      store.assertRetainedWorkerAuthorityClosure();
      store.assertRetainedTerminalAttemptAuthorityClosure();
      store.assertRetainedCurrentWorkflowCommandClosure();
      store.assertRetainedCandidateEvidenceAuthorityClosure();
      store.assertRetainedRecoveryAuthorityClosure();
      store.assertRetainedAcceptanceAuthorityClosure();
      store.assertRetainedProtectedVerificationAuthorityClosure();
      store.assertRetainedProjectReadAuthorityClosure();
      store.assertRetainedProjectReadCleanupAuthorityClosure();
      store.assertRetainedIntakeAuthorityClosure();
      store.assertRetainedProjectReferencesUnchanged(isolationSnapshot);
      isolationLease.assertCurrent();
      database.exec('COMMIT');

      database.pragma('foreign_keys = ON');
      if (database.pragma('foreign_keys', { simple: true }) !== 1) {
        throw new StoreInvariantError('SQLite foreign-key enforcement could not be restored');
      }

      const journalMode = database.pragma('journal_mode = WAL', { simple: true });
      if (journalMode !== 'wal') {
        throw new StoreInvariantError('SQLite WAL journal mode could not be enabled');
      }
      isolationLease.assertCurrent();
      store.assertRetainedProjectReferencesUnchanged(isolationSnapshot);
      return store;
    } catch (error) {
      if (database.inTransaction) {
        database.exec('ROLLBACK');
      }
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

  public installIntentAdmissionPolicy(
    rawInput: IntentAdmissionPolicyInstallInput,
  ): IntentAdmissionPolicyInstallResult {
    this.assertOpen();
    const input = decodeIntentAdmissionPolicyInstallInput(rawInput, canonicalAuthorityDigests);
    return this.runImmediate(() => {
      const existing = this.getIntentAdmissionPolicyInsideTransaction(input.policy.id);
      if (existing !== undefined) {
        return existing.version === input.policy.version &&
          existing.digest === input.policy.digest &&
          sameCanonicalAuthority(existing, input.policy)
          ? { status: 'EXISTING', policy: existing }
          : {
              status: 'POLICY_CONFLICT',
              message: `Intent Admission Policy ${input.policy.id} already has different authority`,
            };
      }
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'INTENT_ADMISSION_POLICY',
        aggregateId: input.policy.id,
        eventType: 'INTENT_ADMISSION_POLICY_INSTALLED',
        payloadDigest: input.payloadDigest,
        occurredAt: input.installedAt,
      });
      this.probe(IntakeTransactionStep.AFTER_POLICY_AUDIT_WRITE);
      this.#database
        .prepare(
          `INSERT INTO intent_admission_policies(
             id, schema_version, policy_version, record_json, policy_digest,
             installed_at, install_audit_event_id, payload_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.policy.id,
          input.policy.schemaVersion,
          input.policy.version,
          serializeJson(decodeJsonValue(input.policy)),
          input.policy.digest,
          input.installedAt,
          input.auditEventId,
          input.payloadDigest,
        );
      this.probe(IntakeTransactionStep.AFTER_POLICY_WRITE);
      const persisted = this.getIntentAdmissionPolicyInsideTransaction(input.policy.id);
      if (persisted === undefined || !sameCanonicalAuthority(persisted, input.policy)) {
        throw new StoreInvariantError(
          `Intent Admission Policy ${input.policy.id} was not immediately readable`,
        );
      }
      this.assertAuditEventsReadable([input.auditEventId]);
      this.probe(IntakeTransactionStep.BEFORE_COMMIT);
      return { status: 'INSTALLED', policy: persisted };
    });
  }

  public getIntentAdmissionPolicy(rawPolicyId: string): IntentAdmissionPolicy | undefined {
    this.assertOpen();
    const policyIdentifier = intentAdmissionPolicyId(rawPolicyId);
    return this.runRead(() => this.getIntentAdmissionPolicyInsideTransaction(policyIdentifier));
  }

  private getIntentAdmissionPolicyInsideTransaction(
    policyIdentifier: ReturnType<typeof intentAdmissionPolicyId>,
  ): IntentAdmissionPolicy | undefined {
    const row = this.#database
      .prepare('SELECT record_json FROM intent_admission_policies WHERE id = ?')
      .get(policyIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z.object({ record_json: z.string() }).strict().parse(row);
    return decodeIntentAdmissionPolicy(
      parseJson(parsed.record_json, 'Intent Admission Policy'),
      canonicalAuthorityDigests,
    );
  }

  public getIntakeCommandOutcome(rawCommandId: CommandId): IntakeCommandOutcome | undefined {
    this.assertOpen();
    const commandIdentifier = commandId(rawCommandId);
    return this.runRead(() => this.getIntakeCommandOutcomeInsideTransaction(commandIdentifier));
  }

  private getIntakeCommandOutcomeInsideTransaction(
    commandIdentifier: CommandId,
  ): IntakeCommandOutcome | undefined {
    const row = this.#database
      .prepare('SELECT record_json FROM intake_command_outcomes WHERE command_id = ?')
      .get(commandIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z.object({ record_json: z.string() }).strict().parse(row);
    return decodeIntakeCommandOutcome(
      parseJson(parsed.record_json, 'Intake command outcome'),
      canonicalAuthorityDigests,
    );
  }

  private getIntakeCommandReservationInsideTransaction(
    commandIdentifier: CommandId,
  ): IntakeCommandReservation | undefined {
    const row = this.#database
      .prepare('SELECT record_json FROM intake_command_reservations WHERE command_id = ?')
      .get(commandIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z.object({ record_json: z.string() }).strict().parse(row);
    return decodeIntakeCommandReservation(
      parseJson(parsed.record_json, 'Intake command reservation'),
      canonicalAuthorityDigests,
    );
  }

  public getIntakeCommandReservation(
    rawCommandId: CommandId,
  ): IntakeCommandReservation | undefined {
    this.assertOpen();
    const commandIdentifier = commandId(rawCommandId);
    return this.runRead(() => this.getIntakeCommandReservationInsideTransaction(commandIdentifier));
  }

  private getIntakeRunInsideTransaction(
    runIdentifier: ReturnType<typeof intakeRunId>,
  ): IntakeRun | undefined {
    const row = this.#database
      .prepare('SELECT record_json FROM intake_runs WHERE id = ?')
      .get(runIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z.object({ record_json: z.string() }).strict().parse(row);
    return decodeIntakeRun(parseJson(parsed.record_json, 'Intake Run'));
  }

  private getRawRequestRevisionInsideTransaction(
    rawRequestIdentifier: string,
    revision: number,
  ): RawRequestRevisionRecord | undefined {
    const row = this.#database
      .prepare(
        'SELECT record_json FROM raw_request_revisions WHERE raw_request_id = ? AND revision = ?',
      )
      .get(rawRequestIdentifier, revision);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z.object({ record_json: z.string() }).strict().parse(row);
    return decodeRawRequestRevision(
      parseJson(parsed.record_json, 'Raw Request revision'),
      canonicalAuthorityDigests,
    );
  }

  private getClarificationQuestionInsideTransaction(
    questionIdentifier: string,
  ): ClarificationQuestion | undefined {
    const row = this.#database
      .prepare('SELECT record_json FROM clarification_questions WHERE id = ?')
      .get(questionIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z.object({ record_json: z.string() }).strict().parse(row);
    return decodeClarificationQuestion(
      parseJson(parsed.record_json, 'Clarification Question'),
      canonicalAuthorityDigests,
    );
  }

  public getIntakeAuthority(rawIntakeRunId: string): IntakeAuthorityView | undefined {
    this.assertOpen();
    const runIdentifier = intakeRunId(rawIntakeRunId);
    return this.runRead(() => {
      this.assertRetainedIntakeAuthorityClosure();
      const intakeRun = this.getIntakeRunInsideTransaction(runIdentifier);
      if (intakeRun === undefined) {
        return undefined;
      }
      const rawRequest = this.decodeStoredIntakeRecords('raw_requests', 'Raw Request', (value) =>
        decodeRawRequest(value),
      ).find((record) => record.intakeRunId === runIdentifier);
      if (rawRequest === undefined) {
        throw new StoreInvariantError(`Intake Run ${runIdentifier} has no Raw Request`);
      }
      const rawRequestRevisions = this.decodeStoredIntakeRecords(
        'raw_request_revisions',
        'Raw Request revision',
        (value) => decodeRawRequestRevision(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const manifests = this.decodeStoredIntakeRecords(
        'intake_manifests',
        'Intake Manifest',
        (value) => decodeIntakeManifest(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const proposals = this.decodeStoredIntakeRecords(
        'intent_analysis_proposals',
        'Intent Analysis Proposal',
        (value) => decodeIntentAnalysisProposal(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const projections = this.decodeStoredIntakeRecords(
        'intent_projection_revisions',
        'Intent Projection revision',
        (value) => decodeIntentProjectionRevision(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const ambiguitySets = this.decodeStoredIntakeRecords(
        'material_ambiguity_sets',
        'Material Ambiguity set',
        (value) => decodeMaterialAmbiguitySet(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const decisions = this.decodeStoredIntakeRecords(
        'intent_admission_decisions',
        'Intent Admission Decision',
        (value) => decodeIntentAdmissionDecision(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const questions = this.decodeStoredIntakeRecords(
        'clarification_questions',
        'Clarification Question',
        (value) => decodeClarificationQuestion(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const answerBindings = this.decodeStoredIntakeRecords(
        'clarification_answer_bindings',
        'Clarification Answer Binding',
        (value) => decodeClarificationAnswerBinding(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const answerOnlyResponses = this.decodeStoredIntakeRecords(
        'answer_only_responses',
        'Answer-only Response',
        (value) => decodeAnswerOnlyResponse(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const failures = this.decodeStoredIntakeRecords(
        'intake_failure_records',
        'Intake Failure Record',
        (value) => decodeIntakeFailureRecord(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const reservations = this.decodeStoredIntakeRecords(
        'intake_command_reservations',
        'Intake command reservation',
        (value) => decodeIntakeCommandReservation(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const outcomes = this.decodeStoredIntakeRecords(
        'intake_command_outcomes',
        'Intake command outcome',
        (value) => decodeIntakeCommandOutcome(value, canonicalAuthorityDigests),
      ).filter((record) => record.intakeRunId === runIdentifier);
      const materialization = this.decodeStoredIntakeRecords(
        'goal_materializations',
        'Goal Materialization',
        (value) => decodeGoalMaterializationRecord(value, canonicalAuthorityDigests),
      ).find((record) => record.intakeRunId === runIdentifier);
      const startAuthorization =
        materialization === undefined
          ? undefined
          : this.decodeStoredIntakeRecords(
              'goal_start_authorizations',
              'Goal Start Authorization',
              (value) => decodeGoalStartAuthorization(value, canonicalAuthorityDigests),
            ).find((record) => record.goalMaterializationId === materialization.id);
      const compareText = (left: string, right: string): number =>
        left < right ? -1 : left > right ? 1 : 0;
      return Object.freeze({
        intakeRun,
        rawRequest,
        rawRequestRevisions: Object.freeze(
          [...rawRequestRevisions].sort((left, right) => left.revision - right.revision),
        ),
        manifests: Object.freeze(
          [...manifests].sort(
            (left, right) =>
              compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id),
          ),
        ),
        proposals: Object.freeze(
          [...proposals].sort(
            (left, right) =>
              compareText(left.observedAt, right.observedAt) || compareText(left.id, right.id),
          ),
        ),
        projections: Object.freeze(
          [...projections].sort(
            (left, right) => left.revision - right.revision || compareText(left.id, right.id),
          ),
        ),
        ambiguitySets: Object.freeze(
          [...ambiguitySets].sort(
            (left, right) =>
              left.intentProjectionRevision - right.intentProjectionRevision ||
              compareText(left.ambiguitySetDigest, right.ambiguitySetDigest),
          ),
        ),
        decisions: Object.freeze(
          [...decisions].sort(
            (left, right) =>
              left.intakeRunVersion - right.intakeRunVersion ||
              compareText(left.decidedAt, right.decidedAt) ||
              compareText(left.id, right.id),
          ),
        ),
        questions: Object.freeze(
          [...questions].sort(
            (left, right) =>
              compareText(left.createdAt, right.createdAt) || compareText(left.id, right.id),
          ),
        ),
        answerBindings: Object.freeze(
          [...answerBindings].sort(
            (left, right) =>
              compareText(left.answeredAt, right.answeredAt) || compareText(left.id, right.id),
          ),
        ),
        answerOnlyResponses: Object.freeze(
          [...answerOnlyResponses].sort(
            (left, right) =>
              compareText(left.observedAt, right.observedAt) || compareText(left.id, right.id),
          ),
        ),
        failures: Object.freeze(
          [...failures].sort(
            (left, right) =>
              compareText(left.failedAt, right.failedAt) || compareText(left.id, right.id),
          ),
        ),
        reservations: Object.freeze(
          [...reservations].sort(
            (left, right) =>
              compareText(left.reservedAt, right.reservedAt) ||
              compareText(left.commandId, right.commandId),
          ),
        ),
        outcomes: Object.freeze(
          [...outcomes].sort(
            (left, right) =>
              compareText(left.completedAt, right.completedAt) ||
              compareText(left.commandId, right.commandId),
          ),
        ),
        ...(materialization === undefined ? {} : { materialization }),
        ...(startAuthorization === undefined ? {} : { startAuthorization }),
      });
    });
  }

  public listOrphanedIntakeRunIds(): readonly IntakeRunId[] {
    this.assertOpen();
    return this.runRead(() => {
      this.assertRetainedIntakeAuthorityClosure();
      const rows = z.array(z.object({ intake_run_id: z.string() }).strict()).parse(
        this.#database
          .prepare(
            `SELECT DISTINCT reservation.intake_run_id
                 FROM intake_command_reservations AS reservation
                 JOIN intake_runs AS run ON run.id = reservation.intake_run_id
                 LEFT JOIN intake_command_outcomes AS outcome
                   ON outcome.command_id = reservation.command_id
                WHERE run.status = 'ANALYZING'
                  AND outcome.command_id IS NULL
                ORDER BY reservation.intake_run_id`,
          )
          .all(),
      );
      return Object.freeze(rows.map((row) => intakeRunId(row.intake_run_id)));
    });
  }

  public getIntakeAudit(rawIntakeRunId: string): readonly AuditEventRecord[] {
    this.assertOpen();
    const runIdentifier = intakeRunId(rawIntakeRunId);
    return this.runRead(() => {
      this.assertRetainedIntakeAuthorityClosure();
      return Object.freeze(
        this.#database
          .prepare(
            `SELECT audit.id, audit.sequence, audit.aggregate_type, audit.aggregate_id,
                    audit.event_type, audit.actor_type, audit.command_id,
                    audit.before_version, audit.after_version, audit.correlation_id,
                    audit.causation_id, audit.payload_digest, audit.occurred_at
               FROM intake_audit_events AS relationship
               JOIN audit_events AS audit ON audit.id = relationship.audit_event_id
              WHERE relationship.intake_run_id = ?
              ORDER BY relationship.position`,
          )
          .all(runIdentifier)
          .map((row) => decodeAuditEvent(row)),
      );
    });
  }

  private insertRawRequest(record: RawRequest): void {
    this.#database
      .prepare(
        `INSERT INTO raw_requests(id, schema_version, intake_run_id, created_at, record_json)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.intakeRunId,
        record.createdAt,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_RAW_REQUEST_WRITE);
  }

  private insertRawRequestRevision(record: RawRequestRevisionRecord): void {
    this.#database
      .prepare(
        `INSERT INTO raw_request_revisions(
           raw_request_id, revision, intake_run_id, parent_revision, principal_ref,
           interaction_action, declared_project_path, declared_project_identity_digest,
           admitted_content_digest, raw_request_digest, submitted_at, answered_question_id,
           record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.rawRequestId,
        record.revision,
        record.intakeRunId,
        record.parentRevision ?? null,
        record.principalRef,
        record.interactionAction,
        record.declaredProjectRef?.normalizedPath ?? null,
        record.declaredProjectRef?.identityDigest ?? null,
        record.admittedContentDigest,
        record.rawRequestDigest,
        record.submittedAt,
        record.answeredQuestionBinding?.clarificationQuestionId ?? null,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_RAW_REQUEST_REVISION_WRITE);
  }

  private intakeRunColumns(record: IntakeRun): readonly unknown[] {
    const terminalDecisionId =
      'terminalDecisionRef' in record ? record.terminalDecisionRef.id : null;
    const answerOnlyResponseId =
      'answerOnlyResponseRef' in record ? record.answerOnlyResponseRef.id : null;
    const terminalFailureId = 'terminalFailureRef' in record ? record.terminalFailureRef.id : null;
    const goalMaterializationId =
      'materializedGoalRef' in record ? record.materializedGoalRef.goalMaterializationId : null;
    return Object.freeze([
      record.version,
      record.principalRef,
      record.status,
      record.projectRef?.normalizedPath ?? null,
      record.projectRef?.identityDigest ?? null,
      record.activeRawRequestRevision.rawRequestId,
      record.activeRawRequestRevision.revision,
      record.activeRawRequestRevision.digest,
      record.activeIntentProjectionRevision?.id ?? null,
      record.activeIntentProjectionRevision?.revision ?? null,
      record.activeIntentProjectionRevision?.digest ?? null,
      'activeQuestionRef' in record ? record.activeQuestionRef.clarificationQuestionId : null,
      terminalDecisionId,
      answerOnlyResponseId,
      terminalFailureId,
      goalMaterializationId,
      record.createdAt,
      record.updatedAt,
      serializeJson(decodeJsonValue(record)),
    ]);
  }

  private insertIntakeRun(record: IntakeRun): void {
    this.#database
      .prepare(
        `INSERT INTO intake_runs(
           id, schema_version, version, principal_ref, status, project_path,
           project_identity_digest, active_raw_request_id, active_raw_request_revision,
           active_raw_request_digest, active_projection_id, active_projection_revision,
           active_projection_digest, active_question_id, terminal_decision_id,
           answer_only_response_id, terminal_failure_id, goal_materialization_id,
           created_at, updated_at, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(record.id, record.schemaVersion, ...this.intakeRunColumns(record));
    this.probe(IntakeTransactionStep.AFTER_RUN_WRITE);
  }

  private updateIntakeRun(current: IntakeRun, next: IntakeRun): void {
    if (current.id !== next.id || next.version !== current.version + 1) {
      throw new OptimisticConcurrencyError('INTAKE_RUN', current.id);
    }
    const result = this.#database
      .prepare(
        `UPDATE intake_runs
            SET version = ?, principal_ref = ?, status = ?, project_path = ?,
                project_identity_digest = ?, active_raw_request_id = ?,
                active_raw_request_revision = ?, active_raw_request_digest = ?,
                active_projection_id = ?, active_projection_revision = ?,
                active_projection_digest = ?, active_question_id = ?,
                terminal_decision_id = ?, answer_only_response_id = ?,
                terminal_failure_id = ?, goal_materialization_id = ?, created_at = ?,
                updated_at = ?, record_json = ?
          WHERE id = ? AND version = ?`,
      )
      .run(...this.intakeRunColumns(next), current.id, current.version);
    if (result.changes !== 1) {
      throw new OptimisticConcurrencyError('INTAKE_RUN', current.id);
    }
    this.probe(IntakeTransactionStep.AFTER_RUN_WRITE);
  }

  private insertIntakeManifest(record: IntakeManifest): void {
    this.#database
      .prepare(
        `INSERT INTO intake_manifests(
           id, schema_version, operation, intake_run_id, package_digest,
           manifest_digest, created_at, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.operation,
        record.intakeRunId,
        record.packageDigest,
        record.manifestDigest,
        record.createdAt,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_MANIFEST_WRITE);
  }

  private insertClarificationAnswerBinding(record: ClarificationAnswerBinding): void {
    this.#database
      .prepare(
        `INSERT INTO clarification_answer_bindings(
           id, schema_version, intake_run_id, question_id, question_spec_digest,
           question_digest, decision_id, decision_digest, raw_request_id,
           raw_request_revision, raw_request_digest, command_id,
           canonical_command_input_digest, answered_at, answer_binding_digest, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.intakeRunId,
        record.clarificationQuestionId,
        record.questionSpecDigest,
        record.questionDigest,
        record.intentAdmissionDecisionId,
        record.intentAdmissionDecisionDigest,
        record.rawRequestId,
        record.rawRequestRevision,
        record.rawRequestDigest,
        record.commandId,
        record.canonicalCommandInputDigest,
        record.answeredAt,
        record.answerBindingDigest,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_ANSWER_BINDING_WRITE);
  }

  private insertIntakeCommandReservation(record: IntakeCommandReservation): void {
    const external =
      'externalOperationBinding' in record ? record.externalOperationBinding : undefined;
    this.#database
      .prepare(
        `INSERT INTO intake_command_reservations(
           command_id, schema_version, operation_kind, principal_ref, raw_request_id,
           intake_run_id, canonical_command_input_digest, expected_intake_run_version,
           observed_intake_run_version, operation_id, manifest_id, manifest_digest,
           reservation_digest, reserved_at, has_abandonment_binding, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.commandId,
        record.schemaVersion,
        record.operationKind,
        record.principalRef,
        record.rawRequestId,
        record.intakeRunId,
        record.canonicalCommandInputDigest,
        'expectedIntakeRunVersion' in record ? record.expectedIntakeRunVersion : null,
        record.observedIntakeRunVersion,
        record.operationId,
        external?.manifestId ?? null,
        external?.manifestDigest ?? null,
        record.reservationDigest,
        record.reservedAt,
        'abandonClarificationBinding' in record ? 1 : 0,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_RESERVATION_WRITE);
  }

  private insertIntentAnalysisAuthority(
    proposal: IntentAnalysisProposal,
    projection: IntentProjectionRevisionRecord,
    ambiguitySet: MaterialAmbiguitySet,
  ): void {
    this.#database
      .prepare(
        `INSERT INTO intent_analysis_proposals(
           id, schema_version, intake_run_id, raw_request_revision, raw_request_digest,
           proposal_digest, observed_at, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        proposal.id,
        proposal.schemaVersion,
        proposal.intakeRunId,
        proposal.rawRequestRevision,
        proposal.rawRequestDigest,
        proposal.proposalDigest,
        proposal.observedAt,
        serializeJson(decodeJsonValue(proposal)),
      );
    this.probe(IntakeTransactionStep.AFTER_PROPOSAL_WRITE);

    const insertSource = this.#database.prepare(
      `INSERT INTO source_bindings(
         binding_digest, schema_version, authority_class, source_record_ref,
         source_revision, source_digest, record_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    for (const source of projection.sourceBindings) {
      const existing = this.#database
        .prepare('SELECT record_json FROM source_bindings WHERE binding_digest = ?')
        .get(source.bindingDigest);
      if (existing === undefined) {
        insertSource.run(
          source.bindingDigest,
          source.schemaVersion,
          source.authorityClass,
          source.sourceRecordRef,
          source.sourceRevision,
          source.sourceDigest,
          serializeJson(decodeJsonValue(source)),
        );
        this.probe(IntakeTransactionStep.AFTER_SOURCE_BINDING_WRITE);
      } else {
        const parsed = z.object({ record_json: z.string() }).strict().parse(existing);
        const retained = decodeSourceBinding(
          parseJson(parsed.record_json, 'Source Binding'),
          canonicalAuthorityDigests,
        );
        if (!sameCanonicalAuthority(retained, source)) {
          throw new StoreInvariantError(`Source Binding ${source.bindingDigest} conflicts`);
        }
      }
    }

    this.#database
      .prepare(
        `INSERT INTO intent_projection_revisions(
           id, revision, schema_version, intake_run_id, parent_revision, proposal_id,
           proposal_digest, projection_digest, created_at, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        projection.id,
        projection.revision,
        projection.schemaVersion,
        projection.intakeRunId,
        projection.parentRevision ?? null,
        projection.intentAnalysisProposalRef.id,
        projection.intentAnalysisProposalRef.digest,
        projection.projectionDigest,
        projection.createdAt,
        serializeJson(decodeJsonValue(projection)),
      );
    const insertMembership = this.#database.prepare(
      `INSERT INTO projection_source_bindings(
         projection_id, projection_revision, position, binding_digest
       ) VALUES (?, ?, ?, ?)`,
    );
    projection.sourceBindings.forEach((source, position) => {
      insertMembership.run(projection.id, projection.revision, position, source.bindingDigest);
      this.probe(IntakeTransactionStep.AFTER_SOURCE_BINDING_WRITE);
    });
    this.probe(IntakeTransactionStep.AFTER_PROJECTION_WRITE);

    this.#database
      .prepare(
        `INSERT INTO material_ambiguity_sets(
           ambiguity_set_digest, schema_version, intake_run_id, projection_id,
           projection_revision, projection_digest, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        ambiguitySet.ambiguitySetDigest,
        ambiguitySet.schemaVersion,
        ambiguitySet.intakeRunId,
        ambiguitySet.intentProjectionId,
        ambiguitySet.intentProjectionRevision,
        ambiguitySet.intentProjectionDigest,
        serializeJson(decodeJsonValue(ambiguitySet)),
      );
    this.probe(IntakeTransactionStep.AFTER_AMBIGUITY_WRITE);
    const insertAmbiguity = this.#database.prepare(
      `INSERT INTO material_ambiguities(
         id, ambiguity_set_digest, position, intake_run_id, status,
         resolved_by_raw_request_revision, record_json
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    ambiguitySet.ambiguities.forEach((ambiguity, position) => {
      insertAmbiguity.run(
        ambiguity.id,
        ambiguitySet.ambiguitySetDigest,
        position,
        ambiguity.intakeRunId,
        ambiguity.status,
        ambiguity.resolvedByRawRequestRevision ?? null,
        serializeJson(decodeJsonValue(ambiguity)),
      );
      this.probe(IntakeTransactionStep.AFTER_AMBIGUITY_WRITE);
    });
  }

  private insertClarificationQuestionSpec(record: ClarificationQuestionSpec): void {
    this.#database
      .prepare(
        `INSERT INTO clarification_question_specs(
           question_spec_digest, schema_version, intake_run_id, ambiguity_ref, record_json
         ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        record.questionSpecDigest,
        record.schemaVersion,
        record.intakeRunId,
        record.ambiguityRef,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_QUESTION_WRITE);
  }

  private insertIntentAdmissionDecision(record: IntentAdmissionDecision): void {
    const projection = 'projectionBinding' in record ? record.projectionBinding : undefined;
    const questionSpecDigest =
      record.kind === IntentAdmissionDecisionKind.CLARIFY
        ? record.questionPlanBinding.questionSpecDigest
        : null;
    const abandonment =
      record.kind === IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION
        ? record.abandonmentBinding
        : undefined;
    this.#database
      .prepare(
        `INSERT INTO intent_admission_decisions(
           id, schema_version, intake_run_id, intake_run_version, principal_ref,
           interaction_action, decision_kind, outcome, reason_code, execution_disposition,
           admission_policy_id, admission_policy_digest, projection_id,
           projection_revision, projection_digest, question_spec_digest,
           abandonment_question_id, abandonment_command_id, project_path,
           project_identity_digest, decision_digest, decided_at, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.intakeRunId,
        record.intakeRunVersion,
        record.principalRef,
        record.interactionAction,
        record.kind,
        record.outcome,
        record.reasonCode,
        record.executionDisposition,
        record.admissionPolicyId,
        record.admissionPolicyDigest,
        projection?.intentProjectionId ?? null,
        projection?.intentProjectionRevision ?? null,
        projection?.intentProjectionDigest ?? null,
        questionSpecDigest,
        abandonment?.clarificationQuestionId ?? null,
        abandonment?.commandId ?? null,
        record.projectOrScopeRef?.normalizedPath ?? null,
        record.projectOrScopeRef?.identityDigest ?? null,
        record.decisionDigest,
        record.decidedAt,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_DECISION_WRITE);
  }

  private insertClarificationQuestion(record: ClarificationQuestion): void {
    this.#database
      .prepare(
        `INSERT INTO clarification_questions(
           id, schema_version, intake_run_id, decision_id, decision_digest,
           ambiguity_ref, question_spec_digest, question_digest, created_at, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.intakeRunId,
        record.intentAdmissionDecisionId,
        record.intentAdmissionDecisionDigest,
        record.ambiguityRef,
        record.questionSpecDigest,
        record.questionDigest,
        record.createdAt,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_QUESTION_WRITE);
  }

  private insertAnswerOnlyResponse(record: AnswerOnlyResponse): void {
    this.#database
      .prepare(
        `INSERT INTO answer_only_responses(
           id, schema_version, intake_run_id, response_kind, decision_id,
           decision_digest, response_digest, observed_at, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.intakeRunId,
        record.kind,
        record.intentAdmissionDecisionId,
        record.intentAdmissionDecisionDigest,
        record.responseDigest,
        record.observedAt,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_ANSWER_RESPONSE_WRITE);
  }

  private insertIntakeFailure(record: IntakeFailureRecord): void {
    this.#database
      .prepare(
        `INSERT INTO intake_failure_records(
           id, schema_version, command_id, intake_run_id, intake_run_version,
           failed_operation, reason_code, failure_digest, failed_at, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.commandId,
        record.intakeRunId,
        record.intakeRunVersion,
        record.failedOperation,
        record.reasonCode,
        record.failureDigest,
        record.failedAt,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_FAILURE_WRITE);
  }

  private insertIntakeOutcome(record: IntakeCommandOutcome): void {
    this.#database
      .prepare(
        `INSERT INTO intake_command_outcomes(
           command_id, schema_version, intake_run_id, disposition,
           canonical_command_input_digest, reservation_digest,
           observed_intake_run_version, result_kind, result_digest, completed_at,
           outcome_digest, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.commandId,
        record.schemaVersion,
        record.intakeRunId,
        record.disposition,
        record.canonicalCommandInputDigest,
        record.reservationDigest,
        record.observedIntakeRunVersion,
        record.result.kind,
        record.resultDigest,
        record.completedAt,
        record.outcomeDigest,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_OUTCOME_WRITE);
  }

  private insertIntakeAudits(
    runIdentifier: ReturnType<typeof intakeRunId>,
    commandIdentifier: CommandId,
    rawWrites: readonly IntakeAuditWrite[],
  ): void {
    const writes = validateIntakeAuditWrites(rawWrites);
    const row = z
      .object({ position: z.number().int() })
      .strict()
      .parse(
        this.#database
          .prepare(
            'SELECT COALESCE(MAX(position), -1) AS position FROM intake_audit_events WHERE intake_run_id = ?',
          )
          .get(runIdentifier),
      );
    const insertRelationship = this.#database.prepare(
      `INSERT INTO intake_audit_events(intake_run_id, audit_event_id, command_id, position)
       VALUES (?, ?, ?, ?)`,
    );
    writes.forEach((write, offset) => {
      this.insertAuditEvent({
        id: write.id,
        aggregateType: write.aggregateType,
        aggregateId: write.aggregateId,
        eventType: write.eventType,
        commandId: commandIdentifier,
        ...(write.beforeVersion === undefined ? {} : { beforeVersion: write.beforeVersion }),
        ...(write.afterVersion === undefined ? {} : { afterVersion: write.afterVersion }),
        ...(write.correlationId === undefined ? {} : { correlationId: write.correlationId }),
        ...(write.causationId === undefined ? {} : { causationId: write.causationId }),
        payloadDigest: write.payloadDigest,
        occurredAt: write.occurredAt,
      });
      insertRelationship.run(runIdentifier, write.id, commandIdentifier, row.position + offset + 1);
      this.probe(IntakeTransactionStep.AFTER_AUDIT_WRITE);
    });
    this.assertAuditEventsReadable(writes.map((write) => write.id));
  }

  private insertInitialGoalAndWorkflowForIntake(goal: Goal, workflow: WorkflowInstance): void {
    this.validateInitialGoalAndWorkflow(goal, workflow);
    this.#authorityIsolationLease?.assertProjectPathAllowed(goal.scope.projectPath);
    this.#database
      .prepare(
        `INSERT INTO goals(
           id, revision, objective, project_path, allowed_paths_json, non_goals_json,
           status, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        goal.id,
        goal.revision,
        goal.objective,
        goal.scope.projectPath,
        serializeJson(decodeJsonValue(goal.scope.allowedPaths)),
        serializeJson(decodeJsonValue(goal.nonGoals)),
        goal.status,
        goal.createdAt,
        goal.updatedAt,
      );
    const insertCriterion = this.#database.prepare(
      `INSERT INTO goal_criteria(goal_id, position, id, description, required)
       VALUES (?, ?, ?, ?, ?)`,
    );
    goal.successCriteria.forEach((criterion, position) => {
      insertCriterion.run(
        goal.id,
        position,
        criterion.id,
        criterion.description,
        criterion.required ? 1 : 0,
      );
    });
    this.probe(IntakeTransactionStep.AFTER_GOAL_WRITE);
    this.#database
      .prepare(
        `INSERT INTO workflows(
           id, goal_id, goal_revision, phase, run_status, version, active_attempt_id,
           active_candidate_generation_id, suspended_reason, created_at, updated_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        workflow.id,
        workflow.goalId,
        workflow.goalRevision,
        workflow.phase,
        workflow.runStatus,
        workflow.version,
        workflow.activeAttemptId ?? null,
        workflow.activeCandidateGenerationId ?? null,
        workflow.suspendedReason ?? null,
        workflow.createdAt,
        workflow.updatedAt,
      );
    this.probe(IntakeTransactionStep.AFTER_WORKFLOW_WRITE);
  }

  private insertGoalMaterialization(record: GoalMaterializationRecord): void {
    this.#database
      .prepare(
        `INSERT INTO goal_materializations(
           id, schema_version, intake_run_id, decision_id, decision_digest,
           projection_id, projection_revision, projection_digest, project_path,
           project_identity_digest, goal_id, goal_revision, workflow_id,
           workflow_version, materialized_at, materialization_digest, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.intakeRunId,
        record.intentAdmissionDecisionId,
        record.intentAdmissionDecisionDigest,
        record.intentProjectionId,
        record.intentProjectionRevision,
        record.intentProjectionDigest,
        record.projectOrScopeRef.normalizedPath,
        record.projectOrScopeRef.identityDigest,
        record.goalId,
        record.goalRevision,
        record.workflowId,
        record.workflowVersion,
        record.materializedAt,
        record.materializationDigest,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_MATERIALIZATION_WRITE);
  }

  private insertGoalStartAuthorization(record: GoalStartAuthorization): void {
    this.#database
      .prepare(
        `INSERT INTO goal_start_authorizations(
           id, schema_version, materialization_id, materialization_digest,
           decision_id, decision_digest, goal_id, goal_revision, workflow_id,
           workflow_version, start_command_id, policy_bundle_id, policy_bundle_digest,
           execution_profile_id, execution_profile_digest, authorized_at,
           authorization_digest, record_json
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.goalMaterializationId,
        record.goalMaterializationDigest,
        record.intentAdmissionDecisionId,
        record.intentAdmissionDecisionDigest,
        record.goalId,
        record.goalRevision,
        record.workflowId,
        record.workflowVersion,
        record.startCommandId,
        record.policyBundleId,
        record.policyBundleDigest,
        record.executionProfileId,
        record.executionProfileDigest,
        record.authorizedAt,
        record.authorizationDigest,
        serializeJson(decodeJsonValue(record)),
      );
    this.probe(IntakeTransactionStep.AFTER_START_AUTHORIZATION_WRITE);
  }

  public reserveInitialIntake(
    rawInput: ReserveInitialIntakeOperation,
  ): IntakeReservationStoreResult {
    this.assertOpen();
    const rawRequest = decodeRawRequest(rawInput.rawRequest);
    const revision = decodeRawRequestRevision(
      rawInput.rawRequestRevision,
      canonicalAuthorityDigests,
    );
    const run = decodeIntakeRun(rawInput.intakeRun);
    const manifest = decodeIntakeManifest(rawInput.manifest, canonicalAuthorityDigests);
    const reservation = decodeIntakeCommandReservation(
      rawInput.reservation,
      canonicalAuthorityDigests,
    );
    const auditEvents = validateIntakeAuditWrites(rawInput.auditEvents);
    assertExactIntakeAuditPlan(
      auditEvents,
      run.id,
      initialIntakeReservationAuditEvents,
      [revision.submittedAt, run.createdAt, reservation.reservedAt],
      reservation.reservedAt,
    );
    if (
      (reservation.operationKind !== IntakeCommandOperationKind.INTENT_ANALYSIS &&
        reservation.operationKind !== IntakeCommandOperationKind.ANSWER_ONLY) ||
      run.status !== IntakeRunStatus.ANALYZING ||
      run.version !== 1 ||
      revision.revision !== 1 ||
      rawRequest.id !== revision.rawRequestId ||
      rawRequest.intakeRunId !== run.id ||
      revision.intakeRunId !== run.id ||
      run.activeRawRequestRevision.rawRequestId !== rawRequest.id ||
      run.activeRawRequestRevision.revision !== revision.revision ||
      run.activeRawRequestRevision.digest !== revision.rawRequestDigest ||
      manifest.intakeRunId !== run.id ||
      reservation.rawRequestId !== rawRequest.id ||
      reservation.intakeRunId !== run.id ||
      reservation.principalRef !== revision.principalRef ||
      reservation.observedIntakeRunVersion !== run.version ||
      reservation.externalOperationBinding.manifestId !== manifest.id ||
      reservation.externalOperationBinding.manifestDigest !== manifest.manifestDigest ||
      manifest.operation !==
        (reservation.operationKind === IntakeCommandOperationKind.ANSWER_ONLY
          ? IntakeManifestOperation.ANSWER_ONLY
          : IntakeManifestOperation.INTENT_ANALYSIS) ||
      rawRequest.createdAt > revision.submittedAt ||
      revision.submittedAt > run.updatedAt ||
      manifest.createdAt > reservation.reservedAt
    ) {
      throw new StoreInvariantError('Initial Intake reservation has inconsistent authority');
    }
    assertExactIntakeManifestRevisionChain(manifest, revision);
    assertExactIntakeProjectChain(run, revision);
    if (revision.declaredProjectRef !== undefined) {
      this.#authorityIsolationLease?.assertProjectPathAllowed(
        revision.declaredProjectRef.normalizedPath,
      );
    }

    return this.runIntakeReservationImmediate(() => {
      const existing = this.getIntakeCommandReservationInsideTransaction(reservation.commandId);
      if (existing !== undefined) {
        if (
          existing.canonicalCommandInputDigest !== reservation.canonicalCommandInputDigest ||
          existing.reservationDigest !== reservation.reservationDigest ||
          !sameCanonicalAuthority(existing, reservation)
        ) {
          throw new CommandIdConflictError(reservation.commandId);
        }
        const outcome = this.getIntakeCommandOutcomeInsideTransaction(reservation.commandId);
        if (outcome !== undefined) {
          decodeIntakeCommandClosure(existing, outcome, canonicalAuthorityDigests);
          return { status: 'REPLAYED', outcome };
        }
        const retainedRun = this.getIntakeRunInsideTransaction(reservation.intakeRunId);
        if (retainedRun === undefined) {
          throw new StoreInvariantError('Active Intake reservation has no Intake Run');
        }
        return { status: 'ACTIVE', reservation: existing, intakeRun: retainedRun };
      }

      this.insertRawRequest(rawRequest);
      this.insertRawRequestRevision(revision);
      this.insertIntakeRun(run);
      this.insertIntakeManifest(manifest);
      this.insertIntakeCommandReservation(reservation);
      this.insertIntakeAudits(run.id, reservation.commandId, auditEvents);
      this.assertRetainedIntakeAuthorityClosure();
      this.probe(IntakeTransactionStep.BEFORE_COMMIT);
      return { status: 'RESERVED', reservation, intakeRun: run };
    });
  }

  public reserveClarificationIntake(
    rawInput: ReserveClarificationIntakeOperation,
  ): IntakeReservationStoreResult {
    this.assertOpen();
    const revision = decodeRawRequestRevision(
      rawInput.rawRequestRevision,
      canonicalAuthorityDigests,
    );
    const answerBinding = decodeClarificationAnswerBinding(
      rawInput.answerBinding,
      canonicalAuthorityDigests,
    );
    const nextRun = decodeIntakeRun(rawInput.intakeRun);
    const manifest = decodeIntakeManifest(rawInput.manifest, canonicalAuthorityDigests);
    const reservation = decodeIntakeCommandReservation(
      rawInput.reservation,
      canonicalAuthorityDigests,
    );
    const auditEvents = validateIntakeAuditWrites(rawInput.auditEvents);
    assertExactIntakeAuditPlan(
      auditEvents,
      nextRun.id,
      clarificationIntakeReservationAuditEvents,
      [revision.submittedAt, answerBinding.answeredAt, reservation.reservedAt],
      reservation.reservedAt,
    );
    if (
      reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS ||
      reservation.externalOperationBinding === undefined ||
      nextRun.status !== IntakeRunStatus.ANALYZING ||
      revision.intakeRunId !== reservation.intakeRunId ||
      revision.rawRequestId !== reservation.rawRequestId ||
      answerBinding.intakeRunId !== reservation.intakeRunId ||
      answerBinding.rawRequestId !== reservation.rawRequestId ||
      answerBinding.rawRequestRevision !== revision.revision ||
      answerBinding.rawRequestDigest !== revision.rawRequestDigest ||
      answerBinding.commandId !== reservation.commandId ||
      answerBinding.canonicalCommandInputDigest !== reservation.canonicalCommandInputDigest ||
      answerBinding.clarificationQuestionId !==
        reservation.clarificationBinding.clarificationQuestionId ||
      answerBinding.questionSpecDigest !== reservation.clarificationBinding.questionSpecDigest ||
      answerBinding.questionDigest !== reservation.clarificationBinding.questionDigest ||
      answerBinding.intentAdmissionDecisionId !==
        reservation.clarificationBinding.issuingClarifyDecisionId ||
      answerBinding.intentAdmissionDecisionDigest !==
        reservation.clarificationBinding.issuingClarifyDecisionDigest ||
      manifest.intakeRunId !== reservation.intakeRunId ||
      reservation.externalOperationBinding.manifestId !== manifest.id ||
      reservation.externalOperationBinding.manifestDigest !== manifest.manifestDigest ||
      manifest.operation !== IntakeManifestOperation.INTENT_ANALYSIS ||
      answerBinding.answeredAt < reservation.reservedAt
    ) {
      throw new StoreInvariantError('Clarification reservation has inconsistent authority');
    }
    assertExactIntakeManifestRevisionChain(manifest, revision);
    assertExactIntakeProjectChain(nextRun, revision);
    if (revision.declaredProjectRef !== undefined) {
      this.#authorityIsolationLease?.assertProjectPathAllowed(
        revision.declaredProjectRef.normalizedPath,
      );
    }

    return this.runIntakeReservationImmediate(() => {
      const existing = this.getIntakeCommandReservationInsideTransaction(reservation.commandId);
      if (existing !== undefined) {
        if (
          existing.canonicalCommandInputDigest !== reservation.canonicalCommandInputDigest ||
          existing.reservationDigest !== reservation.reservationDigest ||
          !sameCanonicalAuthority(existing, reservation)
        ) {
          throw new CommandIdConflictError(reservation.commandId);
        }
        const outcome = this.getIntakeCommandOutcomeInsideTransaction(reservation.commandId);
        if (outcome !== undefined) {
          decodeIntakeCommandClosure(existing, outcome, canonicalAuthorityDigests);
          return { status: 'REPLAYED', outcome };
        }
        const retainedRun = this.getIntakeRunInsideTransaction(reservation.intakeRunId);
        if (retainedRun === undefined) {
          throw new StoreInvariantError('Active Intake reservation has no Intake Run');
        }
        return { status: 'ACTIVE', reservation: existing, intakeRun: retainedRun };
      }

      const current = this.getIntakeRunInsideTransaction(reservation.intakeRunId);
      if (
        current?.status !== IntakeRunStatus.NEEDS_CLARIFICATION ||
        current.version !== reservation.expectedIntakeRunVersion ||
        reservation.observedIntakeRunVersion !== nextRun.version ||
        nextRun.id !== current.id ||
        nextRun.version !== current.version + 1 ||
        revision.parentRevision !== current.activeRawRequestRevision.revision ||
        revision.revision !== current.activeRawRequestRevision.revision + 1 ||
        current.activeQuestionRef.clarificationQuestionId !==
          reservation.clarificationBinding.clarificationQuestionId ||
        current.activeQuestionRef.questionSpecDigest !==
          reservation.clarificationBinding.questionSpecDigest ||
        current.activeQuestionRef.questionDigest !==
          reservation.clarificationBinding.questionDigest ||
        current.activeQuestionRef.issuingDecisionId !==
          reservation.clarificationBinding.issuingClarifyDecisionId ||
        current.activeQuestionRef.issuingDecisionDigest !==
          reservation.clarificationBinding.issuingClarifyDecisionDigest ||
        nextRun.activeRawRequestRevision.rawRequestId !== revision.rawRequestId ||
        nextRun.activeRawRequestRevision.revision !== revision.revision ||
        nextRun.activeRawRequestRevision.digest !== revision.rawRequestDigest
      ) {
        throw new OptimisticConcurrencyError('INTAKE_RUN', reservation.intakeRunId);
      }
      const activeQuestion = this.getClarificationQuestionInsideTransaction(
        current.activeQuestionRef.clarificationQuestionId,
      );
      if (
        !sameOptionalProjectRef(current.projectRef, revision.declaredProjectRef) &&
        !isExactProjectIdentityQuestion(activeQuestion)
      ) {
        throw new StoreInvariantError(
          `Clarification reservation ${reservation.commandId} cannot replace project identity`,
        );
      }
      this.insertRawRequestRevision(revision);
      this.insertClarificationAnswerBinding(answerBinding);
      this.updateIntakeRun(current, nextRun);
      this.insertIntakeManifest(manifest);
      this.insertIntakeCommandReservation(reservation);
      this.insertIntakeAudits(nextRun.id, reservation.commandId, auditEvents);
      this.assertRetainedIntakeAuthorityClosure();
      this.probe(IntakeTransactionStep.BEFORE_COMMIT);
      return { status: 'RESERVED', reservation, intakeRun: nextRun };
    });
  }

  public commitAnalyzedIntake(rawInput: CommitAnalyzedIntake): IntakeCommitStoreResult {
    this.assertOpen();
    const commandIdentifier = commandId(rawInput.commandId);
    const proposal = decodeIntentAnalysisProposal(rawInput.proposal, canonicalAuthorityDigests);
    const projection = decodeIntentProjectionRevision(
      rawInput.projection,
      canonicalAuthorityDigests,
    );
    const ambiguitySet = decodeMaterialAmbiguitySet(
      rawInput.ambiguitySet,
      canonicalAuthorityDigests,
    );
    const decision = decodeIntentAdmissionDecision(rawInput.decision, canonicalAuthorityDigests);
    const nextRun = decodeIntakeRun(rawInput.intakeRun);
    const completedAt = isoTimestamp(rawInput.completedAt);
    const auditEvents = validateIntakeAuditWrites(rawInput.auditEvents);
    const questionSpec =
      rawInput.kind === 'CLARIFY'
        ? decodeClarificationQuestionSpec(rawInput.questionSpec, canonicalAuthorityDigests)
        : undefined;
    const question =
      rawInput.kind === 'CLARIFY'
        ? decodeClarificationQuestion(rawInput.question, canonicalAuthorityDigests)
        : undefined;
    assertExactIntakeAuditPlan(
      auditEvents,
      nextRun.id,
      rawInput.kind === 'CLARIFY' ? clarifyIntakeCommitAuditEvents : analyzedNoExecutionAuditEvents,
      rawInput.kind === 'CLARIFY' && question !== undefined
        ? [
            proposal.observedAt,
            projection.createdAt,
            decision.decidedAt,
            question.createdAt,
            completedAt,
          ]
        : [proposal.observedAt, projection.createdAt, decision.decidedAt, completedAt],
      completedAt,
    );
    if (
      proposal.intakeRunId !== nextRun.id ||
      projection.intakeRunId !== nextRun.id ||
      ambiguitySet.intakeRunId !== nextRun.id ||
      decision.intakeRunId !== nextRun.id ||
      projection.intentAnalysisProposalRef.id !== proposal.id ||
      projection.intentAnalysisProposalRef.digest !== proposal.proposalDigest ||
      ambiguitySet.intentProjectionId !== projection.id ||
      ambiguitySet.intentProjectionRevision !== projection.revision ||
      ambiguitySet.intentProjectionDigest !== projection.projectionDigest ||
      !('projectionBinding' in decision) ||
      decision.projectionBinding.intentAnalysisProposalId !== proposal.id ||
      decision.projectionBinding.intentAnalysisProposalDigest !== proposal.proposalDigest ||
      decision.projectionBinding.intentProjectionId !== projection.id ||
      decision.projectionBinding.intentProjectionRevision !== projection.revision ||
      decision.projectionBinding.intentProjectionDigest !== projection.projectionDigest ||
      completedAt < decision.decidedAt ||
      (rawInput.kind === 'CLARIFY' &&
        (decision.kind !== IntentAdmissionDecisionKind.CLARIFY ||
          nextRun.status !== IntakeRunStatus.NEEDS_CLARIFICATION ||
          questionSpec === undefined ||
          question === undefined)) ||
      (rawInput.kind === 'NO_EXECUTION' &&
        (decision.kind !== IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION ||
          nextRun.status !== IntakeRunStatus.NO_EXECUTION))
    ) {
      throw new StoreInvariantError('Analyzed Intake commit has inconsistent authority');
    }
    assertIntentProjectionAmbiguityClosure(proposal, projection, ambiguitySet);

    const result = decodeIntakeCommandResult(
      rawInput.kind === 'CLARIFY' && question !== undefined
        ? {
            schemaVersion: 1,
            kind: 'CLARIFICATION_REQUIRED',
            intakeRunId: nextRun.id,
            intakeRunVersion: nextRun.version,
            decisionRef: {
              id: decision.id,
              digest: decision.decisionDigest,
              outcome: decision.outcome,
              reasonCode: decision.reasonCode,
            },
            activeQuestionRef: {
              clarificationQuestionId: question.id,
              questionSpecDigest: question.questionSpecDigest,
              questionDigest: question.questionDigest,
              issuingDecisionId: question.intentAdmissionDecisionId,
              issuingDecisionDigest: question.intentAdmissionDecisionDigest,
            },
            answerDisposition: 'NOT_REQUESTED',
            materializationDisposition: 'NO_GOAL',
            startDisposition: 'NOT_AUTHORIZED',
          }
        : {
            schemaVersion: 1,
            kind: 'NO_EXECUTION',
            intakeRunId: nextRun.id,
            intakeRunVersion: nextRun.version,
            decisionRef: {
              id: decision.id,
              digest: decision.decisionDigest,
              outcome: decision.outcome,
              reasonCode: decision.reasonCode,
            },
            answerDisposition: 'NOT_REQUESTED',
            materializationDisposition: 'NO_GOAL',
            startDisposition: 'NOT_AUTHORIZED',
          },
    );

    return this.runIntakeCommitImmediate(() => {
      const reservation = this.getIntakeCommandReservationInsideTransaction(commandIdentifier);
      if (reservation === undefined) {
        throw new StoreInvariantError(`Intake command ${commandIdentifier} has no reservation`);
      }
      assertExactProposalAnalysisAuthority(proposal, decision, reservation);
      const existingOutcome = this.getIntakeCommandOutcomeInsideTransaction(commandIdentifier);
      if (existingOutcome !== undefined) {
        if (!sameCanonicalAuthority(existingOutcome.result, result)) {
          throw new CommandIdConflictError(commandIdentifier);
        }
        const retainedRun = this.getIntakeRunInsideTransaction(reservation.intakeRunId);
        if (retainedRun === undefined) {
          throw new StoreInvariantError('Replayed Intake outcome has no Intake Run');
        }
        return { status: 'REPLAYED', outcome: existingOutcome, intakeRun: retainedRun };
      }
      if (
        (reservation.operationKind !== IntakeCommandOperationKind.INTENT_ANALYSIS &&
          reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS) ||
        reservation.intakeRunId !== nextRun.id
      ) {
        throw new CommandIdConflictError(commandIdentifier);
      }
      const current = this.getIntakeRunInsideTransaction(nextRun.id);
      if (
        current?.status !== IntakeRunStatus.ANALYZING ||
        current.version !== reservation.observedIntakeRunVersion ||
        nextRun.version !== current.version + 1 ||
        decision.intakeRunVersion !== current.version ||
        proposal.rawRequestRevision !== current.activeRawRequestRevision.revision ||
        proposal.rawRequestDigest !== current.activeRawRequestRevision.digest ||
        projection.rawRequestRevision !== current.activeRawRequestRevision.revision
      ) {
        throw new OptimisticConcurrencyError('INTAKE_RUN', nextRun.id);
      }
      const revision = this.getRawRequestRevisionInsideTransaction(
        current.activeRawRequestRevision.rawRequestId,
        current.activeRawRequestRevision.revision,
      );
      if (revision === undefined) {
        throw new StoreInvariantError(
          `Intake Run ${current.id} has no active Raw Request revision`,
        );
      }
      assertExactIntakeProjectChain(current, revision, projection, decision);
      if (rawInput.kind === 'CLARIFY' && questionSpec !== undefined && question !== undefined) {
        if (
          decision.kind !== IntentAdmissionDecisionKind.CLARIFY ||
          decision.questionPlanBinding.questionId !== question.id ||
          decision.questionPlanBinding.questionSpecDigest !== questionSpec.questionSpecDigest ||
          question.questionSpecDigest !== questionSpec.questionSpecDigest ||
          nextRun.status !== IntakeRunStatus.NEEDS_CLARIFICATION ||
          nextRun.activeQuestionRef.clarificationQuestionId !== question.id ||
          nextRun.activeQuestionRef.questionDigest !== question.questionDigest
        ) {
          throw new StoreInvariantError('CLARIFY commit substituted its Question authority');
        }
      }

      this.insertIntentAnalysisAuthority(proposal, projection, ambiguitySet);
      if (questionSpec !== undefined) {
        this.insertClarificationQuestionSpec(questionSpec);
      }
      this.insertIntentAdmissionDecision(decision);
      if (question !== undefined) {
        this.insertClarificationQuestion(question);
      }
      this.updateIntakeRun(current, nextRun);
      const outcome = storeAuthoredIntakeOutcome(reservation, result, completedAt);
      this.insertIntakeAudits(nextRun.id, reservation.commandId, auditEvents);
      this.insertIntakeOutcome(outcome);
      this.assertRetainedIntakeAuthorityClosure();
      this.probe(IntakeTransactionStep.BEFORE_COMMIT);
      return { status: 'APPLIED', outcome, intakeRun: nextRun };
    });
  }

  public commitIntakeNoExecution(rawInput: CommitIntakeNoExecution): IntakeCommitStoreResult {
    this.assertOpen();
    const decision = decodeIntentAdmissionDecision(rawInput.decision, canonicalAuthorityDigests);
    const nextRun = decodeIntakeRun(rawInput.intakeRun);
    const completedAt = isoTimestamp(rawInput.completedAt);
    const auditEvents = validateIntakeAuditWrites(rawInput.auditEvents);
    const response =
      rawInput.kind === 'ANSWER_ONLY'
        ? decodeAnswerOnlyResponse(rawInput.response, canonicalAuthorityDigests)
        : undefined;
    const suppliedReservation =
      rawInput.kind === 'ANSWER_ONLY'
        ? undefined
        : decodeIntakeCommandReservation(rawInput.reservation, canonicalAuthorityDigests);
    const immediateRawRequest =
      rawInput.kind === 'IMMEDIATE' ? decodeRawRequest(rawInput.rawRequest) : undefined;
    const immediateRevision =
      rawInput.kind === 'IMMEDIATE'
        ? decodeRawRequestRevision(rawInput.rawRequestRevision, canonicalAuthorityDigests)
        : undefined;
    const commandIdentifier =
      rawInput.kind === 'ANSWER_ONLY'
        ? commandId(rawInput.commandId)
        : suppliedReservation?.commandId;
    const expectedTerminalDecisionRef = {
      id: decision.id,
      digest: decision.decisionDigest,
      outcome: decision.outcome,
      reasonCode: decision.reasonCode,
    };
    const expectedAnswerOnlyResponseRef =
      response === undefined
        ? undefined
        : { id: response.id, digest: response.responseDigest, kind: response.kind };
    assertExactIntakeAuditPlan(
      auditEvents,
      nextRun.id,
      rawInput.kind === 'IMMEDIATE'
        ? immediateNoExecutionAuditEvents
        : rawInput.kind === 'ABANDONMENT'
          ? abandonmentAuditEvents
          : answerOnlyAuditEvents,
      rawInput.kind === 'IMMEDIATE' && immediateRevision !== undefined
        ? [immediateRevision.submittedAt, decision.decidedAt, completedAt]
        : rawInput.kind === 'ABANDONMENT'
          ? [decision.decidedAt, nextRun.updatedAt, completedAt]
          : response === undefined
            ? []
            : [decision.decidedAt, response.observedAt, completedAt],
      completedAt,
    );
    if (
      commandIdentifier === undefined ||
      nextRun.status !== IntakeRunStatus.NO_EXECUTION ||
      decision.outcome !== IntentAdmissionOutcome.NO_EXECUTION ||
      decision.intakeRunId !== nextRun.id ||
      !sameCanonicalAuthority(nextRun.terminalDecisionRef, expectedTerminalDecisionRef) ||
      (expectedAnswerOnlyResponseRef === undefined
        ? 'answerOnlyResponseRef' in nextRun
        : !('answerOnlyResponseRef' in nextRun) ||
          !sameCanonicalAuthority(nextRun.answerOnlyResponseRef, expectedAnswerOnlyResponseRef)) ||
      completedAt < decision.decidedAt ||
      (rawInput.kind === 'ANSWER_ONLY' &&
        (response === undefined ||
          decision.kind !== IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION ||
          response.intakeRunId !== nextRun.id ||
          response.intentAdmissionDecisionId !== decision.id ||
          response.intentAdmissionDecisionDigest !== decision.decisionDigest)) ||
      (rawInput.kind === 'IMMEDIATE' &&
        (suppliedReservation?.operationKind !== IntakeCommandOperationKind.IMMEDIATE_NO_EXECUTION ||
          decision.kind !== IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION)) ||
      (rawInput.kind === 'ABANDONMENT' &&
        (suppliedReservation?.operationKind !== IntakeCommandOperationKind.ABANDON_CLARIFICATION ||
          !('abandonClarificationBinding' in suppliedReservation) ||
          decision.kind !== IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION ||
          decision.abandonmentBinding?.commandId !== suppliedReservation.commandId ||
          decision.abandonmentBinding.canonicalCommandInputDigest !==
            suppliedReservation.canonicalCommandInputDigest))
    ) {
      throw new StoreInvariantError('NO_EXECUTION commit has inconsistent authority');
    }

    const result = decodeIntakeCommandResult(
      response === undefined
        ? {
            schemaVersion: 1,
            kind: 'NO_EXECUTION',
            intakeRunId: nextRun.id,
            intakeRunVersion: nextRun.version,
            decisionRef: {
              id: decision.id,
              digest: decision.decisionDigest,
              outcome: decision.outcome,
              reasonCode: decision.reasonCode,
            },
            answerDisposition: 'NOT_REQUESTED',
            materializationDisposition: 'NO_GOAL',
            startDisposition: 'NOT_AUTHORIZED',
          }
        : {
            schemaVersion: 1,
            kind: 'NO_EXECUTION',
            intakeRunId: nextRun.id,
            intakeRunVersion: nextRun.version,
            decisionRef: {
              id: decision.id,
              digest: decision.decisionDigest,
              outcome: decision.outcome,
              reasonCode: decision.reasonCode,
            },
            answerDisposition:
              response.kind === 'ANSWER_RETURNED' ? 'ANSWER_RETURNED' : 'ANSWER_FAILED',
            answerOnlyResponseRef: {
              id: response.id,
              digest: response.responseDigest,
              kind: response.kind,
            },
            materializationDisposition: 'NO_GOAL',
            startDisposition: 'NOT_AUTHORIZED',
          },
    );

    return this.runIntakeCommitImmediate(() => {
      const existingReservation =
        this.getIntakeCommandReservationInsideTransaction(commandIdentifier);
      if (existingReservation !== undefined) {
        if (
          suppliedReservation !== undefined &&
          (existingReservation.reservationDigest !== suppliedReservation.reservationDigest ||
            !sameCanonicalAuthority(existingReservation, suppliedReservation))
        ) {
          throw new CommandIdConflictError(commandIdentifier);
        }
        const existingOutcome = this.getIntakeCommandOutcomeInsideTransaction(commandIdentifier);
        if (existingOutcome !== undefined) {
          if (!sameCanonicalAuthority(existingOutcome.result, result)) {
            throw new CommandIdConflictError(commandIdentifier);
          }
          const retainedRun = this.getIntakeRunInsideTransaction(existingReservation.intakeRunId);
          if (retainedRun === undefined) {
            throw new StoreInvariantError('Replayed NO_EXECUTION has no Intake Run');
          }
          return { status: 'REPLAYED', outcome: existingOutcome, intakeRun: retainedRun };
        }
      }

      if (rawInput.kind === 'IMMEDIATE') {
        if (
          existingReservation !== undefined ||
          suppliedReservation === undefined ||
          immediateRawRequest === undefined ||
          immediateRevision === undefined
        ) {
          throw new CommandIdConflictError(commandIdentifier);
        }
        if (
          nextRun.version !== 1 ||
          decision.intakeRunVersion !== nextRun.version ||
          suppliedReservation.observedIntakeRunVersion !== nextRun.version ||
          immediateRawRequest.id !== immediateRevision.rawRequestId ||
          immediateRawRequest.intakeRunId !== nextRun.id ||
          immediateRevision.intakeRunId !== nextRun.id ||
          nextRun.activeRawRequestRevision.digest !== immediateRevision.rawRequestDigest
        ) {
          throw new StoreInvariantError('Immediate NO_EXECUTION source chain is inconsistent');
        }
        assertExactIntakeProjectChain(nextRun, immediateRevision, undefined, decision);
        this.insertRawRequest(immediateRawRequest);
        this.insertRawRequestRevision(immediateRevision);
        this.insertIntakeRun(nextRun);
        this.insertIntakeCommandReservation(suppliedReservation);
      } else {
        if (existingReservation === undefined) {
          if (suppliedReservation === undefined) {
            throw new StoreInvariantError(`Intake command ${commandIdentifier} has no reservation`);
          }
          this.insertIntakeCommandReservation(suppliedReservation);
        }
        const reservation = existingReservation ?? suppliedReservation;
        if (reservation === undefined) {
          throw new StoreInvariantError('NO_EXECUTION reservation could not be resolved');
        }
        if (
          rawInput.kind === 'ANSWER_ONLY' &&
          (response === undefined ||
            reservation.operationKind !== IntakeCommandOperationKind.ANSWER_ONLY ||
            reservation.externalOperationBinding.assistantAdapterId !==
              response.assistantAdapterId ||
            reservation.externalOperationBinding.assistantAdapterVersion !==
              response.assistantAdapterVersion ||
            reservation.externalOperationBinding.responseContractDigest !==
              response.responseContractDigest)
        ) {
          throw new StoreInvariantError('Answer-only commit has false reservation authority');
        }
        const current = this.getIntakeRunInsideTransaction(nextRun.id);
        const expectedStatus =
          rawInput.kind === 'ABANDONMENT'
            ? IntakeRunStatus.NEEDS_CLARIFICATION
            : IntakeRunStatus.ANALYZING;
        if (
          current?.status !== expectedStatus ||
          current.version !== reservation.observedIntakeRunVersion ||
          nextRun.version !== current.version + 1 ||
          decision.intakeRunVersion !== current.version
        ) {
          throw new OptimisticConcurrencyError('INTAKE_RUN', nextRun.id);
        }
        const revision = this.getRawRequestRevisionInsideTransaction(
          current.activeRawRequestRevision.rawRequestId,
          decision.rawRequestRevision,
        );
        if (revision === undefined) {
          throw new StoreInvariantError(
            `Admission Decision ${decision.id} has no Raw Request revision`,
          );
        }
        assertExactIntakeProjectChain(current, revision, undefined, decision);
        if (rawInput.kind === 'ABANDONMENT') {
          if (
            reservation.operationKind !== IntakeCommandOperationKind.ABANDON_CLARIFICATION ||
            reservation.abandonClarificationBinding === undefined ||
            current.status !== IntakeRunStatus.NEEDS_CLARIFICATION ||
            current.activeQuestionRef.clarificationQuestionId !==
              reservation.abandonClarificationBinding.clarificationQuestionId ||
            current.activeQuestionRef.questionDigest !==
              reservation.abandonClarificationBinding.questionDigest
          ) {
            throw new OptimisticConcurrencyError('INTAKE_RUN', nextRun.id);
          }
        }
        this.updateIntakeRun(current, nextRun);
      }

      this.insertIntentAdmissionDecision(decision);
      if (response !== undefined) {
        this.insertAnswerOnlyResponse(response);
      }
      const reservation = this.getIntakeCommandReservationInsideTransaction(commandIdentifier);
      if (reservation === undefined) {
        throw new StoreInvariantError('NO_EXECUTION reservation did not persist');
      }
      const outcome = storeAuthoredIntakeOutcome(reservation, result, completedAt);
      this.insertIntakeAudits(nextRun.id, commandIdentifier, auditEvents);
      this.insertIntakeOutcome(outcome);
      this.assertRetainedIntakeAuthorityClosure();
      this.probe(IntakeTransactionStep.BEFORE_COMMIT);
      return { status: 'APPLIED', outcome, intakeRun: nextRun };
    });
  }

  public commitIntakeFailure(rawInput: CommitIntakeFailure): IntakeCommitStoreResult {
    this.assertOpen();
    const commandIdentifier = commandId(rawInput.commandId);
    const failure = decodeIntakeFailureRecord(rawInput.failure, canonicalAuthorityDigests);
    const nextRun = decodeIntakeRun(rawInput.intakeRun);
    const completedAt = isoTimestamp(rawInput.completedAt);
    const auditEvents = validateIntakeAuditWrites(rawInput.auditEvents);
    assertExactIntakeAuditPlan(
      auditEvents,
      nextRun.id,
      intakeFailureAuditEvents,
      [failure.failedAt, nextRun.updatedAt, completedAt],
      completedAt,
    );
    if (
      nextRun.status !== IntakeRunStatus.FAILED ||
      failure.commandId !== commandIdentifier ||
      failure.intakeRunId !== nextRun.id ||
      nextRun.terminalFailureRef.id !== failure.id ||
      nextRun.terminalFailureRef.digest !== failure.failureDigest ||
      completedAt < failure.failedAt
    ) {
      throw new StoreInvariantError('FAILED Intake commit has inconsistent authority');
    }
    const result = decodeIntakeCommandResult({
      schemaVersion: 1,
      kind: 'FAILED',
      intakeRunId: nextRun.id,
      intakeRunVersion: nextRun.version,
      failureRef: { id: failure.id, digest: failure.failureDigest },
    });
    return this.runIntakeCommitImmediate(() => {
      const reservation = this.getIntakeCommandReservationInsideTransaction(commandIdentifier);
      if (reservation === undefined) {
        throw new StoreInvariantError(`Intake command ${commandIdentifier} has no reservation`);
      }
      if (
        !('externalOperationBinding' in reservation) ||
        (reservation.operationKind !== IntakeCommandOperationKind.INTENT_ANALYSIS &&
          reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS)
      ) {
        throw new StoreInvariantError(
          'Only a reserved external Intake analysis may commit an Intake failure',
        );
      }
      if (
        failure.failedOperation === IntakeFailedOperation.INTENT_ANALYSIS &&
        (reservation.externalOperationBinding.assistantAdapterId !== failure.assistantAdapterId ||
          reservation.externalOperationBinding.assistantAdapterVersion !==
            failure.assistantAdapterVersion ||
          reservation.externalOperationBinding.responseContractDigest !==
            failure.responseContractDigest)
      ) {
        throw new StoreInvariantError('Intake analysis failure has false assistant authority');
      }
      const existingOutcome = this.getIntakeCommandOutcomeInsideTransaction(commandIdentifier);
      if (existingOutcome !== undefined) {
        if (!sameCanonicalAuthority(existingOutcome.result, result)) {
          throw new CommandIdConflictError(commandIdentifier);
        }
        const retainedRun = this.getIntakeRunInsideTransaction(nextRun.id);
        if (retainedRun === undefined) {
          throw new StoreInvariantError('Replayed Intake failure has no Intake Run');
        }
        return { status: 'REPLAYED', outcome: existingOutcome, intakeRun: retainedRun };
      }
      const current = this.getIntakeRunInsideTransaction(nextRun.id);
      if (
        current?.status !== IntakeRunStatus.ANALYZING ||
        current.version !== reservation.observedIntakeRunVersion ||
        nextRun.version !== current.version + 1 ||
        failure.intakeRunVersion !== current.version
      ) {
        throw new OptimisticConcurrencyError('INTAKE_RUN', nextRun.id);
      }
      this.insertIntakeFailure(failure);
      this.updateIntakeRun(current, nextRun);
      const outcome = storeAuthoredIntakeOutcome(reservation, result, completedAt);
      this.insertIntakeAudits(nextRun.id, commandIdentifier, auditEvents);
      this.insertIntakeOutcome(outcome);
      this.assertRetainedIntakeAuthorityClosure();
      this.probe(IntakeTransactionStep.BEFORE_COMMIT);
      return { status: 'APPLIED', outcome, intakeRun: nextRun };
    });
  }

  public commitIntakeCommandRejection(
    rawInput: CommitIntakeCommandRejection,
  ): IntakeCommitStoreResult {
    this.assertOpen();
    const reservation = decodeIntakeCommandReservation(
      rawInput.reservation,
      canonicalAuthorityDigests,
    );
    const observedRun = decodeIntakeRun(rawInput.observedIntakeRun);
    const completedAt = isoTimestamp(rawInput.completedAt);
    const auditEvents = validateIntakeAuditWrites(rawInput.auditEvents);
    assertExactIntakeAuditPlan(
      auditEvents,
      observedRun.id,
      intakeCommandRejectionAuditEvents,
      [completedAt],
      completedAt,
    );
    if (typeof rawInput.detailCode !== 'string' || rawInput.detailCode.trim().length === 0) {
      throw new TypeError('Intake rejection detailCode must not be blank');
    }
    if (
      reservation.intakeRunId !== observedRun.id ||
      reservation.observedIntakeRunVersion !== observedRun.version ||
      completedAt < reservation.reservedAt ||
      (reservation.operationKind === IntakeCommandOperationKind.ABANDON_CLARIFICATION &&
        'abandonClarificationBinding' in reservation)
    ) {
      throw new StoreInvariantError('Rejected Intake command has inconsistent reservation shape');
    }
    const result = decodeIntakeCommandResult({
      schemaVersion: 1,
      kind: 'REJECTED',
      intakeRunId: observedRun.id,
      observedIntakeRunVersion: observedRun.version,
      detailCode: rawInput.detailCode,
    });
    return this.runIntakeCommitImmediate(() => {
      const existingReservation = this.getIntakeCommandReservationInsideTransaction(
        reservation.commandId,
      );
      if (existingReservation !== undefined) {
        if (
          existingReservation.reservationDigest !== reservation.reservationDigest ||
          !sameCanonicalAuthority(existingReservation, reservation)
        ) {
          throw new CommandIdConflictError(reservation.commandId);
        }
        const existingOutcome = this.getIntakeCommandOutcomeInsideTransaction(
          reservation.commandId,
        );
        if (existingOutcome === undefined) {
          throw new StoreInvariantError(
            'An active external Intake operation cannot become a rejection',
          );
        }
        if (!sameCanonicalAuthority(existingOutcome.result, result)) {
          throw new CommandIdConflictError(reservation.commandId);
        }
        const retainedRun = this.getIntakeRunInsideTransaction(observedRun.id);
        if (retainedRun === undefined) {
          throw new StoreInvariantError('Replayed Intake rejection has no Intake Run');
        }
        return { status: 'REPLAYED', outcome: existingOutcome, intakeRun: retainedRun };
      }
      const retainedRun = this.getIntakeRunInsideTransaction(observedRun.id);
      if (
        retainedRun?.version !== observedRun.version ||
        !sameCanonicalAuthority(retainedRun, observedRun)
      ) {
        throw new OptimisticConcurrencyError('INTAKE_RUN', observedRun.id);
      }
      this.insertIntakeCommandReservation(reservation);
      const outcome = storeAuthoredIntakeOutcome(reservation, result, completedAt);
      this.insertIntakeAudits(observedRun.id, reservation.commandId, auditEvents);
      this.insertIntakeOutcome(outcome);
      this.assertRetainedIntakeAuthorityClosure();
      this.probe(IntakeTransactionStep.BEFORE_COMMIT);
      return { status: 'APPLIED', outcome, intakeRun: observedRun };
    });
  }

  public commitIntakeMaterialization(
    rawInput: CommitIntakeMaterialization,
  ): IntakeCommitStoreResult {
    this.assertOpen();
    const commandIdentifier = commandId(rawInput.commandId);
    const proposal = decodeIntentAnalysisProposal(rawInput.proposal, canonicalAuthorityDigests);
    const projection = decodeIntentProjectionRevision(
      rawInput.projection,
      canonicalAuthorityDigests,
    );
    const ambiguitySet = decodeMaterialAmbiguitySet(
      rawInput.ambiguitySet,
      canonicalAuthorityDigests,
    );
    const decision = decodeIntentAdmissionDecision(rawInput.decision, canonicalAuthorityDigests);
    const goal = decodeGoalSnapshot(rawInput.goal);
    const workflow = decodeWorkflowSnapshot(rawInput.workflow);
    const materialization = decodeGoalMaterializationRecord(
      rawInput.materialization,
      canonicalAuthorityDigests,
    );
    const startAuthorization =
      rawInput.startAuthorization === undefined
        ? undefined
        : decodeGoalStartAuthorization(rawInput.startAuthorization, canonicalAuthorityDigests);
    const nextRun = decodeIntakeRun(rawInput.intakeRun);
    const goalAuditEventId = auditEventId(rawInput.goalAuditEventId);
    const workflowAuditEventId = auditEventId(rawInput.workflowAuditEventId);
    const goalCreationPayloadDigest = sha256Digest(rawInput.goalCreationPayloadDigest);
    const completedAt = isoTimestamp(rawInput.completedAt);
    const auditEvents = validateIntakeAuditWrites(rawInput.auditEvents);
    assertExactIntakeAuditPlan(
      auditEvents,
      nextRun.id,
      materializationAuditEventsFor(startAuthorization !== undefined),
      [
        proposal.observedAt,
        projection.createdAt,
        decision.decidedAt,
        materialization.materializedAt,
        ...(startAuthorization === undefined ? [] : [startAuthorization.authorizedAt]),
        completedAt,
      ],
      completedAt,
    );
    if (
      goalAuditEventId === workflowAuditEventId ||
      auditEvents.some(
        (event) => event.id === goalAuditEventId || event.id === workflowAuditEventId,
      ) ||
      decision.kind !== IntentAdmissionDecisionKind.MATERIALIZE ||
      nextRun.status !== IntakeRunStatus.MATERIALIZED ||
      proposal.intakeRunId !== nextRun.id ||
      projection.intakeRunId !== nextRun.id ||
      ambiguitySet.intakeRunId !== nextRun.id ||
      decision.intakeRunId !== nextRun.id ||
      materialization.intakeRunId !== nextRun.id ||
      projection.intentAnalysisProposalRef.id !== proposal.id ||
      projection.intentAnalysisProposalRef.digest !== proposal.proposalDigest ||
      ambiguitySet.intentProjectionId !== projection.id ||
      ambiguitySet.intentProjectionRevision !== projection.revision ||
      ambiguitySet.intentProjectionDigest !== projection.projectionDigest ||
      decision.projectionBinding.intentAnalysisProposalId !== proposal.id ||
      decision.projectionBinding.intentAnalysisProposalDigest !== proposal.proposalDigest ||
      decision.projectionBinding.intentProjectionId !== projection.id ||
      decision.projectionBinding.intentProjectionRevision !== projection.revision ||
      decision.projectionBinding.intentProjectionDigest !== projection.projectionDigest ||
      materialization.intentAdmissionDecisionId !== decision.id ||
      materialization.intentAdmissionDecisionDigest !== decision.decisionDigest ||
      materialization.intentProjectionId !== projection.id ||
      materialization.intentProjectionRevision !== projection.revision ||
      materialization.intentProjectionDigest !== projection.projectionDigest ||
      materialization.goalId !== goal.id ||
      materialization.goalRevision !== goal.revision ||
      materialization.workflowId !== workflow.id ||
      materialization.workflowVersion !== workflow.version ||
      materialization.projectOrScopeRef.normalizedPath !== goal.scope.projectPath ||
      goalCreationPayloadDigest !==
        canonicalAuthorityDigests.digest(
          goalAndWorkflowCreationPayloadProjection(goal, workflow),
        ) ||
      nextRun.materializedGoalRef.goalMaterializationId !== materialization.id ||
      nextRun.materializedGoalRef.materializationDigest !== materialization.materializationDigest ||
      completedAt < materialization.materializedAt ||
      (decision.executionDisposition === IntentExecutionDisposition.AUTHORIZE_START) !==
        (startAuthorization !== undefined)
    ) {
      throw new StoreInvariantError('Materialization commit has inconsistent authority');
    }
    assertIntentProjectionAmbiguityClosure(proposal, projection, ambiguitySet);
    if (
      startAuthorization !== undefined &&
      (startAuthorization.goalMaterializationId !== materialization.id ||
        startAuthorization.goalMaterializationDigest !== materialization.materializationDigest ||
        startAuthorization.intentAdmissionDecisionId !== decision.id ||
        startAuthorization.intentAdmissionDecisionDigest !== decision.decisionDigest ||
        startAuthorization.goalId !== goal.id ||
        startAuthorization.goalRevision !== goal.revision ||
        startAuthorization.workflowId !== workflow.id ||
        startAuthorization.workflowVersion !== workflow.version ||
        startAuthorization.authorizedAt < materialization.materializedAt)
    ) {
      throw new StoreInvariantError('Start Authorization substituted Materialization authority');
    }
    this.validateInitialGoalAndWorkflow(goal, workflow);

    const result = decodeIntakeCommandResult({
      schemaVersion: 1,
      kind: 'MATERIALIZED',
      intakeRunId: nextRun.id,
      intakeRunVersion: nextRun.version,
      decisionRef: {
        id: decision.id,
        digest: decision.decisionDigest,
        outcome: decision.outcome,
        reasonCode: decision.reasonCode,
      },
      materializedGoalRef: {
        goalMaterializationId: materialization.id,
        materializationDigest: materialization.materializationDigest,
        goalId: goal.id,
        goalRevision: goal.revision,
        workflowId: workflow.id,
        workflowVersion: workflow.version,
      },
      ...(startAuthorization === undefined
        ? {}
        : {
            goalStartAuthorizationRef: {
              id: startAuthorization.id,
              digest: startAuthorization.authorizationDigest,
              startCommandId: startAuthorization.startCommandId,
            },
          }),
      answerDisposition: 'NOT_REQUESTED',
      materializationDisposition: 'MATERIALIZED_READY',
      startDisposition: startAuthorization === undefined ? 'NOT_AUTHORIZED' : 'READY_PENDING_START',
    });

    return this.runIntakeCommitImmediate(() => {
      const reservation = this.getIntakeCommandReservationInsideTransaction(commandIdentifier);
      if (reservation === undefined) {
        throw new StoreInvariantError(`Intake command ${commandIdentifier} has no reservation`);
      }
      assertExactProposalAnalysisAuthority(proposal, decision, reservation);
      const existingOutcome = this.getIntakeCommandOutcomeInsideTransaction(commandIdentifier);
      if (existingOutcome !== undefined) {
        if (!sameCanonicalAuthority(existingOutcome.result, result)) {
          throw new CommandIdConflictError(commandIdentifier);
        }
        const retainedRun = this.getIntakeRunInsideTransaction(nextRun.id);
        if (retainedRun === undefined) {
          throw new StoreInvariantError('Replayed Materialization has no Intake Run');
        }
        return { status: 'REPLAYED', outcome: existingOutcome, intakeRun: retainedRun };
      }
      if (
        reservation.operationKind !== IntakeCommandOperationKind.INTENT_ANALYSIS &&
        reservation.operationKind !== IntakeCommandOperationKind.CLARIFICATION_ANALYSIS
      ) {
        throw new CommandIdConflictError(commandIdentifier);
      }
      const current = this.getIntakeRunInsideTransaction(nextRun.id);
      if (
        current?.status !== IntakeRunStatus.ANALYZING ||
        current.version !== reservation.observedIntakeRunVersion ||
        nextRun.version !== current.version + 1 ||
        decision.intakeRunVersion !== current.version ||
        materialization.rawRequestRevision !== current.activeRawRequestRevision.revision ||
        materialization.rawRequestDigest !== current.activeRawRequestRevision.digest
      ) {
        throw new OptimisticConcurrencyError('INTAKE_RUN', nextRun.id);
      }
      const revision = this.getRawRequestRevisionInsideTransaction(
        current.activeRawRequestRevision.rawRequestId,
        current.activeRawRequestRevision.revision,
      );
      if (revision === undefined) {
        throw new StoreInvariantError(
          `Intake Run ${current.id} has no active Raw Request revision`,
        );
      }
      assertExactIntakeProjectChain(current, revision, projection, decision);
      this.insertIntentAnalysisAuthority(proposal, projection, ambiguitySet);
      this.insertIntentAdmissionDecision(decision);
      this.insertInitialGoalAndWorkflowForIntake(goal, workflow);
      this.insertGoalMaterialization(materialization);
      if (startAuthorization !== undefined) {
        this.insertGoalStartAuthorization(startAuthorization);
      }
      this.updateIntakeRun(current, nextRun);
      this.insertAuditEvent({
        id: goalAuditEventId,
        aggregateType: 'GOAL',
        aggregateId: goal.id,
        eventType: 'GOAL_CREATED',
        commandId: reservation.commandId,
        afterVersion: goal.revision,
        payloadDigest: goalCreationPayloadDigest,
        occurredAt: goal.createdAt,
      });
      this.insertAuditEvent({
        id: workflowAuditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: workflow.id,
        eventType: 'WORKFLOW_CREATED',
        commandId: reservation.commandId,
        afterVersion: workflow.version,
        payloadDigest: goalCreationPayloadDigest,
        occurredAt: workflow.createdAt,
      });
      this.probe(IntakeTransactionStep.AFTER_AUDIT_WRITE);
      const outcome = storeAuthoredIntakeOutcome(reservation, result, completedAt);
      this.insertIntakeAudits(nextRun.id, reservation.commandId, auditEvents);
      this.insertIntakeOutcome(outcome);
      this.assertAuditEventsReadable([goalAuditEventId, workflowAuditEventId]);
      this.assertRetainedIntakeAuthorityClosure();
      this.probe(IntakeTransactionStep.BEFORE_COMMIT);
      return { status: 'APPLIED', outcome, intakeRun: nextRun };
    });
  }

  private assertRetainedProjectReferencesUnchanged(
    isolationSnapshot: SqliteAuthorityIsolationSnapshot,
  ): void {
    const tableNames = new Set(
      sqliteSchemaObjectRowsSchema
        .parse(
          this.#database
            .prepare(
              `SELECT type, name
                 FROM sqlite_schema
                WHERE name NOT LIKE 'sqlite_%'
                ORDER BY type, name`,
            )
            .all(),
        )
        .filter((object) => object.type === 'table')
        .map((object) => object.name),
    );
    const decodedReferences = inspectRetainedProjectReferences(this.#database, tableNames);
    if (decodedReferences.length !== isolationSnapshot.projectReferences.length) {
      throw new AuthorityActivationError(
        'Retained project bindings changed during SQLite authority activation',
      );
    }
    for (const [index, reference] of decodedReferences.entries()) {
      const inspected = isolationSnapshot.projectReferences[index];
      if (
        inspected?.kind !== reference.kind ||
        inspected.authorityId !== reference.authorityId ||
        inspected.projectPath !== reference.projectPath
      ) {
        throw new AuthorityActivationError(
          'Retained project bindings changed during SQLite authority activation',
        );
      }
    }
  }

  private decodeStoredIntakeRecords<Value>(
    tableName: string,
    recordType: string,
    decode: (value: unknown) => Value,
  ): readonly Value[] {
    try {
      return Object.freeze(
        storedIntakeRecordRowsSchema
          .parse(this.#database.prepare(`SELECT record_json FROM ${tableName}`).all())
          .map((row) => decode(parseJson(row.record_json, recordType))),
      );
    } catch (error) {
      throw new StoreInvariantError(`Retained ${recordType} authority failed strict reopen`, {
        cause: error,
      });
    }
  }

  private assertRetainedIntakeAuthorityClosure(): void {
    if (!this.hasTable('intake_runs')) {
      return;
    }

    try {
      const mismatch = retainedIntakeProjectColumnMismatch(this.#database);
      if (mismatch !== undefined) {
        throw new StoreInvariantError(
          `Retained ${mismatch.kind} project binding ${mismatch.authority_id} differs from its authority JSON`,
        );
      }
    } catch (error) {
      if (error instanceof StoreInvariantError) {
        throw error;
      }
      throw new StoreInvariantError('Retained Intake project binding failed strict reopen', {
        cause: error,
      });
    }

    const policies = this.decodeStoredIntakeRecords(
      'intent_admission_policies',
      'Intent Admission Policy',
      (value) => decodeIntentAdmissionPolicy(value, canonicalAuthorityDigests),
    );
    const rawRequests = this.decodeStoredIntakeRecords('raw_requests', 'Raw Request', (value) =>
      decodeRawRequest(value),
    );
    const revisions = this.decodeStoredIntakeRecords(
      'raw_request_revisions',
      'Raw Request revision',
      (value) => decodeRawRequestRevision(value, canonicalAuthorityDigests),
    );
    const manifests = this.decodeStoredIntakeRecords(
      'intake_manifests',
      'Intake Manifest',
      (value) => decodeIntakeManifest(value, canonicalAuthorityDigests),
    );
    const proposals = this.decodeStoredIntakeRecords(
      'intent_analysis_proposals',
      'Intent Analysis Proposal',
      (value) => decodeIntentAnalysisProposal(value, canonicalAuthorityDigests),
    );
    const sourceBindings = this.decodeStoredIntakeRecords(
      'source_bindings',
      'Source Binding',
      (value) => decodeSourceBinding(value, canonicalAuthorityDigests),
    );
    const projections = this.decodeStoredIntakeRecords(
      'intent_projection_revisions',
      'Intent Projection revision',
      (value) => decodeIntentProjectionRevision(value, canonicalAuthorityDigests),
    );
    const ambiguitySets = this.decodeStoredIntakeRecords(
      'material_ambiguity_sets',
      'Material Ambiguity set',
      (value) => decodeMaterialAmbiguitySet(value, canonicalAuthorityDigests),
    );
    const questionSpecs = this.decodeStoredIntakeRecords(
      'clarification_question_specs',
      'Clarification Question specification',
      (value) => decodeClarificationQuestionSpec(value, canonicalAuthorityDigests),
    );
    const decisions = this.decodeStoredIntakeRecords(
      'intent_admission_decisions',
      'Intent Admission Decision',
      (value) => decodeIntentAdmissionDecision(value, canonicalAuthorityDigests),
    );
    const questions = this.decodeStoredIntakeRecords(
      'clarification_questions',
      'Clarification Question',
      (value) => decodeClarificationQuestion(value, canonicalAuthorityDigests),
    );
    const answerBindings = this.decodeStoredIntakeRecords(
      'clarification_answer_bindings',
      'Clarification Answer Binding',
      (value) => decodeClarificationAnswerBinding(value, canonicalAuthorityDigests),
    );
    const answerResponses = this.decodeStoredIntakeRecords(
      'answer_only_responses',
      'Answer-only Response',
      (value) => decodeAnswerOnlyResponse(value, canonicalAuthorityDigests),
    );
    const failures = this.decodeStoredIntakeRecords(
      'intake_failure_records',
      'Intake Failure Record',
      (value) => decodeIntakeFailureRecord(value, canonicalAuthorityDigests),
    );
    const reservations = this.decodeStoredIntakeRecords(
      'intake_command_reservations',
      'Intake command reservation',
      (value) => decodeIntakeCommandReservation(value, canonicalAuthorityDigests),
    );
    const outcomes = this.decodeStoredIntakeRecords(
      'intake_command_outcomes',
      'Intake command outcome',
      (value) => decodeIntakeCommandOutcome(value, canonicalAuthorityDigests),
    );
    const materializations = this.decodeStoredIntakeRecords(
      'goal_materializations',
      'Goal Materialization',
      (value) => decodeGoalMaterializationRecord(value, canonicalAuthorityDigests),
    );
    const startAuthorizations = this.decodeStoredIntakeRecords(
      'goal_start_authorizations',
      'Goal Start Authorization',
      (value) => decodeGoalStartAuthorization(value, canonicalAuthorityDigests),
    );
    const runs = this.decodeStoredIntakeRecords('intake_runs', 'Intake Run', (value) =>
      decodeIntakeRun(value),
    );

    const uniqueMap = <Value>(
      values: readonly Value[],
      identity: (value: Value) => string,
      recordType: string,
    ): ReadonlyMap<string, Value> => {
      const map = new Map<string, Value>();
      for (const value of values) {
        const key = identity(value);
        if (map.has(key)) {
          throw new StoreInvariantError(`Retained ${recordType} identity ${key} is duplicated`);
        }
        map.set(key, value);
      }
      return map;
    };

    const policyById = uniqueMap(policies, (record) => record.id, 'Admission Policy');
    const rawRequestById = uniqueMap(rawRequests, (record) => record.id, 'Raw Request');
    const revisionByKey = uniqueMap(
      revisions,
      (record) => intakeRevisionKey(record.rawRequestId, record.revision),
      'Raw Request revision',
    );
    const manifestById = uniqueMap(manifests, (record) => record.id, 'Intake Manifest');
    const proposalById = uniqueMap(proposals, (record) => record.id, 'Intent Analysis Proposal');
    const sourceBindingByDigest = uniqueMap(
      sourceBindings,
      (record) => record.bindingDigest,
      'Source Binding',
    );
    const projectionByKey = uniqueMap(
      projections,
      (record) => intakeRevisionKey(record.id, record.revision),
      'Intent Projection revision',
    );
    const ambiguitySetByDigest = uniqueMap(
      ambiguitySets,
      (record) => record.ambiguitySetDigest,
      'Material Ambiguity set',
    );
    const ambiguitySetByProjection = uniqueMap(
      ambiguitySets,
      (record) => intakeRevisionKey(record.intentProjectionId, record.intentProjectionRevision),
      'Material Ambiguity set Projection',
    );
    const questionSpecByDigest = uniqueMap(
      questionSpecs,
      (record) => record.questionSpecDigest,
      'Clarification Question specification',
    );
    const decisionById = uniqueMap(decisions, (record) => record.id, 'Admission Decision');
    const questionById = uniqueMap(questions, (record) => record.id, 'Clarification Question');
    const answerBindingByQuestionId = uniqueMap(
      answerBindings,
      (record) => record.clarificationQuestionId,
      'Clarification Answer Binding question',
    );
    const answerBindingByDigest = uniqueMap(
      answerBindings,
      (record) => record.answerBindingDigest,
      'Clarification Answer Binding digest',
    );
    const answerBindingByCommandId = uniqueMap(
      answerBindings,
      (record) => record.commandId,
      'Clarification Answer Binding command',
    );
    const answerResponseById = uniqueMap(
      answerResponses,
      (record) => record.id,
      'Answer-only Response',
    );
    const answerResponseColumnRows = z
      .array(
        z
          .object({
            id: z.string(),
            intake_run_id: z.string(),
            response_kind: z.string(),
            decision_id: z.string(),
            decision_digest: z.string(),
            response_digest: z.string(),
            observed_at: z.string(),
          })
          .strict(),
      )
      .parse(
        this.#database
          .prepare(
            `SELECT id, intake_run_id, response_kind, decision_id, decision_digest,
                    response_digest, observed_at
               FROM answer_only_responses`,
          )
          .all(),
      );
    for (const row of answerResponseColumnRows) {
      const response = answerResponseById.get(row.id);
      if (
        response?.intakeRunId !== row.intake_run_id ||
        response.kind !== row.response_kind ||
        response.intentAdmissionDecisionId !== row.decision_id ||
        response.intentAdmissionDecisionDigest !== row.decision_digest ||
        response.responseDigest !== row.response_digest ||
        response.observedAt !== row.observed_at
      ) {
        throw new StoreInvariantError(`Answer-only Response ${row.id} has substituted columns`);
      }
    }
    const failureById = uniqueMap(failures, (record) => record.id, 'Intake Failure Record');
    const failureColumnRows = z
      .array(
        z
          .object({
            id: z.string(),
            command_id: z.string(),
            intake_run_id: z.string(),
            intake_run_version: z.number().int(),
            failed_operation: z.string(),
            reason_code: z.string(),
            failure_digest: z.string(),
            failed_at: z.string(),
          })
          .strict(),
      )
      .parse(
        this.#database
          .prepare(
            `SELECT id, command_id, intake_run_id, intake_run_version,
                    failed_operation, reason_code, failure_digest, failed_at
               FROM intake_failure_records`,
          )
          .all(),
      );
    for (const row of failureColumnRows) {
      const failure = failureById.get(row.id);
      if (
        failure?.commandId !== row.command_id ||
        failure.intakeRunId !== row.intake_run_id ||
        failure.intakeRunVersion !== row.intake_run_version ||
        failure.failedOperation !== row.failed_operation ||
        failure.reasonCode !== row.reason_code ||
        failure.failureDigest !== row.failure_digest ||
        failure.failedAt !== row.failed_at
      ) {
        throw new StoreInvariantError(`Intake Failure ${row.id} has substituted columns`);
      }
    }
    const reservationByCommandId = uniqueMap(
      reservations,
      (record) => record.commandId,
      'Intake command reservation',
    );
    const outcomeByCommandId = uniqueMap(
      outcomes,
      (record) => record.commandId,
      'Intake command outcome',
    );
    const materializationById = uniqueMap(
      materializations,
      (record) => record.id,
      'Goal Materialization',
    );
    const startAuthorizationByMaterializationId = uniqueMap(
      startAuthorizations,
      (record) => record.goalMaterializationId,
      'Goal Start Authorization Materialization',
    );
    const runById = uniqueMap(runs, (record) => record.id, 'Intake Run');

    const reservationByManifestId = new Map<string, IntakeCommandReservation>();
    for (const reservation of reservations) {
      if (!('externalOperationBinding' in reservation)) {
        continue;
      }
      const manifestIdentifier = reservation.externalOperationBinding.manifestId;
      if (reservationByManifestId.has(manifestIdentifier)) {
        throw new StoreInvariantError(
          `Intake Manifest ${manifestIdentifier} has multiple command reservations`,
        );
      }
      reservationByManifestId.set(manifestIdentifier, reservation);
    }

    const exactReservationRawRequestRevision = (
      reservation: IntakeCommandReservation,
    ): RawRequestRevisionRecord | undefined => {
      if (reservation.operationKind === IntakeCommandOperationKind.CLARIFICATION_ANALYSIS) {
        const binding = answerBindingByCommandId.get(reservation.commandId);
        return binding === undefined
          ? undefined
          : revisionByKey.get(intakeRevisionKey(binding.rawRequestId, binding.rawRequestRevision));
      }
      if (
        reservation.operationKind === IntakeCommandOperationKind.INTENT_ANALYSIS ||
        reservation.operationKind === IntakeCommandOperationKind.ANSWER_ONLY
      ) {
        return revisionByKey.get(intakeRevisionKey(reservation.rawRequestId, 1));
      }
      const outcome = outcomeByCommandId.get(reservation.commandId);
      const result = outcome?.result;
      const decision =
        result !== undefined &&
        (result.kind === 'CLARIFICATION_REQUIRED' ||
          result.kind === 'NO_EXECUTION' ||
          result.kind === 'MATERIALIZED')
          ? decisionById.get(result.decisionRef.id)
          : undefined;
      return decision === undefined
        ? undefined
        : revisionByKey.get(
            intakeRevisionKey(reservation.rawRequestId, decision.rawRequestRevision),
          );
    };

    const auditEventsByCommand = new Map<CommandId, AuditEventRecord[]>();
    const nextAuditPositionByRun = new Map<string, number>();
    const lastAuditSequenceByRun = new Map<string, number>();
    try {
      for (const row of retainedIntakeAuditRowsSchema.parse(
        this.#database
          .prepare(
            `SELECT relationship.intake_run_id,
                    relationship.command_id AS relationship_command_id,
                    relationship.position,
                    audit.id, audit.sequence, audit.aggregate_type, audit.aggregate_id,
                    audit.event_type, audit.actor_type, audit.command_id,
                    audit.before_version, audit.after_version, audit.correlation_id,
                    audit.causation_id, audit.payload_digest, audit.occurred_at
               FROM intake_audit_events AS relationship
               JOIN audit_events AS audit ON audit.id = relationship.audit_event_id
              ORDER BY relationship.intake_run_id, relationship.position`,
          )
          .all(),
      )) {
        const event = decodeAuditEvent(row);
        const relationshipCommandId = commandId(row.relationship_command_id);
        const reservation = reservationByCommandId.get(relationshipCommandId);
        const nextPosition = nextAuditPositionByRun.get(row.intake_run_id) ?? 0;
        const lastSequence = lastAuditSequenceByRun.get(row.intake_run_id);
        if (
          !runById.has(row.intake_run_id) ||
          reservation?.intakeRunId !== row.intake_run_id ||
          row.position !== nextPosition ||
          (lastSequence !== undefined && event.sequence <= lastSequence) ||
          event.actorType !== 'RUNTIME' ||
          event.aggregateType !== IntakeAuditAggregateType.INTAKE_RUN ||
          event.aggregateId !== row.intake_run_id ||
          event.commandId !== relationshipCommandId ||
          !Object.values(IntakeAuditEventType).some((value) => value === event.eventType)
        ) {
          throw new StoreInvariantError('Retained Intake audit relationship is substituted');
        }
        nextAuditPositionByRun.set(row.intake_run_id, nextPosition + 1);
        lastAuditSequenceByRun.set(row.intake_run_id, event.sequence);
        const commandEvents = auditEventsByCommand.get(relationshipCommandId) ?? [];
        if (
          commandEvents.length > 0 &&
          event.occurredAt <
            (commandEvents[commandEvents.length - 1]?.occurredAt ?? event.occurredAt)
        ) {
          throw new StoreInvariantError(
            `Retained Intake command ${relationshipCommandId} audit time moved backwards`,
          );
        }
        commandEvents.push(event);
        auditEventsByCommand.set(relationshipCommandId, commandEvents);
      }
    } catch (error) {
      if (error instanceof StoreInvariantError) {
        throw error;
      }
      throw new StoreInvariantError('Retained Intake audit authority failed strict reopen', {
        cause: error,
      });
    }

    const retainedIntakeAuditCausalFloor = (
      reservation: IntakeCommandReservation,
      outcome: IntakeCommandOutcome | undefined,
      eventType: IntakeAuditEventName,
    ): IsoTimestamp => {
      const run = runById.get(reservation.intakeRunId);
      const result = outcome?.result;
      const decision =
        result !== undefined &&
        (result.kind === 'CLARIFICATION_REQUIRED' ||
          result.kind === 'NO_EXECUTION' ||
          result.kind === 'MATERIALIZED')
          ? decisionById.get(result.decisionRef.id)
          : undefined;
      const projection =
        decision !== undefined && 'projectionBinding' in decision
          ? projectionByKey.get(
              intakeRevisionKey(
                decision.projectionBinding.intentProjectionId,
                decision.projectionBinding.intentProjectionRevision,
              ),
            )
          : undefined;
      const proposal =
        decision !== undefined && 'projectionBinding' in decision
          ? proposalById.get(decision.projectionBinding.intentAnalysisProposalId)
          : undefined;
      const revision = exactReservationRawRequestRevision(reservation);
      const answerBinding = answerBindingByCommandId.get(reservation.commandId);
      const question =
        result?.kind === 'CLARIFICATION_REQUIRED'
          ? questionById.get(result.activeQuestionRef.clarificationQuestionId)
          : undefined;
      const response =
        result?.kind === 'NO_EXECUTION' && 'answerOnlyResponseRef' in result
          ? answerResponseById.get(result.answerOnlyResponseRef.id)
          : undefined;
      const failure = result?.kind === 'FAILED' ? failureById.get(result.failureRef.id) : undefined;
      const materialization =
        result?.kind === 'MATERIALIZED'
          ? materializationById.get(result.materializedGoalRef.goalMaterializationId)
          : undefined;
      const startAuthorization =
        result?.kind === 'MATERIALIZED' && 'goalStartAuthorizationRef' in result
          ? startAuthorizations.find(
              (authorization) => authorization.id === result.goalStartAuthorizationRef.id,
            )
          : undefined;

      const requireTime = (value: IsoTimestamp | undefined, source: string): IsoTimestamp => {
        if (value === undefined) {
          throw new StoreInvariantError(
            `Intake command ${reservation.commandId} audit has no ${source} time authority`,
          );
        }
        return value;
      };

      switch (eventType) {
        case IntakeAuditEventType.RAW_REQUEST_ADMITTED:
          return requireTime(revision?.submittedAt, 'Raw Request');
        case IntakeAuditEventType.INTAKE_RUN_CREATED:
          return requireTime(run?.createdAt, 'Intake Run creation');
        case IntakeAuditEventType.INTAKE_COMMAND_RESERVED:
          return reservation.reservedAt;
        case IntakeAuditEventType.CLARIFICATION_ANSWER_BOUND:
          return requireTime(answerBinding?.answeredAt, 'Clarification Answer Binding');
        case IntakeAuditEventType.INTENT_ANALYSIS_RECORDED:
          return requireTime(proposal?.observedAt, 'Intent Analysis Proposal');
        case IntakeAuditEventType.INTENT_PROJECTION_RECORDED:
          return requireTime(projection?.createdAt, 'Intent Projection');
        case IntakeAuditEventType.INTENT_ADMISSION_DECIDED:
          return requireTime(decision?.decidedAt, 'Admission Decision');
        case IntakeAuditEventType.CLARIFICATION_QUESTION_ACTIVATED:
          return requireTime(question?.createdAt, 'Clarification Question');
        case IntakeAuditEventType.ANSWER_ONLY_RESPONSE_RECORDED:
          return requireTime(response?.observedAt, 'Answer-only Response');
        case IntakeAuditEventType.INTAKE_FAILURE_RECORDED:
          return requireTime(failure?.failedAt, 'Intake Failure');
        case IntakeAuditEventType.INTAKE_RUN_UPDATED:
          return requireTime(run?.updatedAt, 'Intake Run update');
        case IntakeAuditEventType.GOAL_MATERIALIZED:
          return requireTime(materialization?.materializedAt, 'Goal Materialization');
        case IntakeAuditEventType.GOAL_START_AUTHORIZED:
          return requireTime(startAuthorization?.authorizedAt, 'Goal Start Authorization');
        case IntakeAuditEventType.INTAKE_COMMAND_COMPLETED:
        case IntakeAuditEventType.INTAKE_COMMAND_REJECTED:
          return requireTime(outcome?.completedAt, 'Intake command outcome');
      }
      throw new StoreInvariantError(
        `Intake command ${reservation.commandId} has an unknown audit event ${eventType}`,
      );
    };

    for (const reservation of reservations) {
      const outcome = outcomeByCommandId.get(reservation.commandId);
      const events = auditEventsByCommand.get(reservation.commandId);
      const expected = expectedRetainedIntakeAuditEvents(reservation, outcome);
      const terminalAt = outcome?.completedAt ?? reservation.reservedAt;
      if (
        events?.length !== expected.length ||
        events.some(
          (event, index) =>
            event.eventType !== expected[index] ||
            event.occurredAt <
              retainedIntakeAuditCausalFloor(reservation, outcome, event.eventType),
        ) ||
        events.at(-1)?.occurredAt !== terminalAt
      ) {
        throw new StoreInvariantError(
          `Intake command ${reservation.commandId} has no exact audit closure`,
        );
      }
    }
    for (const commandIdentifier of auditEventsByCommand.keys()) {
      if (!reservationByCommandId.has(commandIdentifier)) {
        throw new StoreInvariantError(
          `Retained Intake audit command ${commandIdentifier} has no reservation`,
        );
      }
    }

    for (const root of rawRequests) {
      if (runById.get(root.intakeRunId)?.id !== root.intakeRunId) {
        throw new StoreInvariantError(`Raw Request ${root.id} has no exact Intake Run`);
      }
    }
    for (const revision of revisions) {
      const root = rawRequestById.get(revision.rawRequestId);
      if (root?.intakeRunId !== revision.intakeRunId) {
        throw new StoreInvariantError(
          `Raw Request revision ${revision.rawRequestId}@${String(revision.revision)} has no exact root`,
        );
      }
      if (
        !classifyM25IntakeRetainedText(revision.admittedUserContent).accepted ||
        revision.declaredConstraints.some(
          (constraint) => !classifyM25IntakeRetainedText(constraint).accepted,
        )
      ) {
        throw new StoreInvariantError(
          `Raw Request revision ${revision.rawRequestId}@${String(revision.revision)} violates its retention profile`,
        );
      }
      if (revision.revision > 1) {
        const parent = revisionByKey.get(
          intakeRevisionKey(revision.rawRequestId, revision.revision - 1),
        );
        if (parent === undefined || revision.parentRevision !== parent.revision) {
          throw new StoreInvariantError(
            `Raw Request revision ${revision.rawRequestId}@${String(revision.revision)} has no exact parent`,
          );
        }
      }
    }

    for (const proposal of proposals) {
      const assistantStrings = [
        ...(proposal.proposedObjective === undefined ? [] : [proposal.proposedObjective]),
        ...proposal.proposedCriteria,
        ...(proposal.proposedScope === undefined ? [] : [proposal.proposedScope]),
        ...proposal.proposedNonGoals,
        ...proposal.proposedAssumptions,
        ...proposal.proposedQuestions,
        ...(proposal.proposedClassification === undefined ? [] : [proposal.proposedClassification]),
      ];
      if (assistantStrings.some((value) => !classifyM25IntakeRetainedText(value).accepted)) {
        throw new StoreInvariantError(
          `Intent Analysis Proposal ${proposal.id} violates its retention profile`,
        );
      }
    }

    const projectionMembership = new Map<string, string[]>();
    for (const row of projectionSourceBindingRowsSchema.parse(
      this.#database
        .prepare(
          `SELECT projection_id, projection_revision, position, binding_digest
             FROM projection_source_bindings
            ORDER BY projection_id, projection_revision, position`,
        )
        .all(),
    )) {
      const key = intakeRevisionKey(row.projection_id, row.projection_revision);
      if (!projectionByKey.has(key) || !sourceBindingByDigest.has(row.binding_digest)) {
        throw new StoreInvariantError('Projection Source Binding membership is orphaned');
      }
      const entries = projectionMembership.get(key) ?? [];
      if (row.position !== entries.length) {
        throw new StoreInvariantError('Projection Source Binding positions are not contiguous');
      }
      entries.push(row.binding_digest);
      projectionMembership.set(key, entries);
    }
    for (const projection of projections) {
      const key = intakeRevisionKey(projection.id, projection.revision);
      const proposal = proposalById.get(projection.intentAnalysisProposalRef.id);
      const run = runById.get(projection.intakeRunId);
      const revision =
        run === undefined
          ? undefined
          : revisionByKey.get(
              intakeRevisionKey(
                run.activeRawRequestRevision.rawRequestId,
                projection.rawRequestRevision,
              ),
            );
      if (
        proposal?.proposalDigest !== projection.intentAnalysisProposalRef.digest ||
        proposal.intakeRunId !== projection.intakeRunId ||
        proposal.rawRequestRevision !== projection.rawRequestRevision ||
        revision?.intakeRunId !== projection.intakeRunId ||
        projection.scope.projectPath !== revision.declaredProjectRef?.normalizedPath
      ) {
        throw new StoreInvariantError(
          `Intent Projection ${key} has no exact Proposal/project authority`,
        );
      }
      const membership = projectionMembership.get(key) ?? [];
      if (
        !sameCanonicalAuthority(
          membership,
          projection.sourceBindings.map((binding) => binding.bindingDigest),
        )
      ) {
        throw new StoreInvariantError(`Intent Projection ${key} has substituted Source Bindings`);
      }
      for (const binding of projection.sourceBindings) {
        const retained = sourceBindingByDigest.get(binding.bindingDigest);
        if (retained === undefined || !sameCanonicalAuthority(retained, binding)) {
          throw new StoreInvariantError(`Intent Projection ${key} embeds a false Source Binding`);
        }
      }
    }

    const ambiguityMembership = new Map<string, MaterialAmbiguity[]>();
    for (const row of ambiguityMembershipRowsSchema.parse(
      this.#database
        .prepare(
          `SELECT ambiguity_set_digest, record_json
             FROM material_ambiguities
            ORDER BY ambiguity_set_digest, position`,
        )
        .all(),
    )) {
      const ambiguity = decodeMaterialAmbiguity(parseJson(row.record_json, 'Material Ambiguity'));
      if (!ambiguitySetByDigest.has(row.ambiguity_set_digest)) {
        throw new StoreInvariantError(`Material Ambiguity ${ambiguity.id} has no owning set`);
      }
      const entries = ambiguityMembership.get(row.ambiguity_set_digest) ?? [];
      entries.push(ambiguity);
      ambiguityMembership.set(row.ambiguity_set_digest, entries);
    }
    for (const set of ambiguitySets) {
      const projection = projectionByKey.get(
        intakeRevisionKey(set.intentProjectionId, set.intentProjectionRevision),
      );
      if (
        projection?.projectionDigest !== set.intentProjectionDigest ||
        projection.intakeRunId !== set.intakeRunId
      ) {
        throw new StoreInvariantError(
          `Material Ambiguity set ${set.ambiguitySetDigest} has no exact Projection`,
        );
      }
      const retained = ambiguityMembership.get(set.ambiguitySetDigest) ?? [];
      if (!sameCanonicalAuthority(retained, set.ambiguities)) {
        throw new StoreInvariantError(
          `Material Ambiguity set ${set.ambiguitySetDigest} has substituted members`,
        );
      }
      const proposal = proposalById.get(projection.intentAnalysisProposalRef.id);
      if (proposal === undefined) {
        throw new StoreInvariantError(
          `Intent Projection ${projection.id}@${String(projection.revision)} has no Proposal`,
        );
      }
      try {
        assertIntentProjectionAmbiguityClosure(proposal, projection, set);
      } catch (error) {
        throw new StoreInvariantError(
          `Intent Projection ${projection.id}@${String(projection.revision)} has false ambiguity closure`,
          { cause: error },
        );
      }
    }

    for (const manifest of manifests) {
      const run = runById.get(manifest.intakeRunId);
      const reservation = reservationByManifestId.get(manifest.id);
      const revision =
        reservation === undefined ? undefined : exactReservationRawRequestRevision(reservation);
      const expectedOperation =
        reservation?.operationKind === IntakeCommandOperationKind.ANSWER_ONLY
          ? IntakeManifestOperation.ANSWER_ONLY
          : IntakeManifestOperation.INTENT_ANALYSIS;
      if (
        run === undefined ||
        reservation === undefined ||
        revision === undefined ||
        manifest.operation !== expectedOperation
      ) {
        throw new StoreInvariantError(
          `Intake Manifest ${manifest.id} has no exact Intake operation owner`,
        );
      }
      assertExactIntakeManifestRevisionChain(manifest, revision);
      const policy = policyById.get(manifest.admissionPolicy.id);
      if (
        policy?.version !== manifest.admissionPolicy.version ||
        policy.digest !== manifest.admissionPolicy.digest
      ) {
        throw new StoreInvariantError(`Intake Manifest ${manifest.id} has no exact Policy`);
      }
      for (const reference of manifest.rawRequestRevisions) {
        const revision = revisionByKey.get(
          intakeRevisionKey(reference.rawRequestId, reference.revision),
        );
        if (
          revision?.rawRequestDigest !== reference.digest ||
          revision.intakeRunId !== manifest.intakeRunId
        ) {
          throw new StoreInvariantError(`Intake Manifest ${manifest.id} has a false Raw Request`);
        }
      }
      if (manifest.currentProjectionRef !== undefined) {
        const projection = projectionByKey.get(
          intakeRevisionKey(
            manifest.currentProjectionRef.id,
            manifest.currentProjectionRef.revision,
          ),
        );
        if (
          projection?.projectionDigest !== manifest.currentProjectionRef.digest ||
          projection.intakeRunId !== manifest.intakeRunId
        ) {
          throw new StoreInvariantError(
            `Intake Manifest ${manifest.id} has a false current Projection`,
          );
        }
      }
      for (const questionRef of manifest.questionRefs) {
        const question = questionById.get(questionRef.clarificationQuestionId);
        if (
          question?.intakeRunId !== manifest.intakeRunId ||
          question.questionSpecDigest !== questionRef.questionSpecDigest ||
          question.questionDigest !== questionRef.questionDigest ||
          question.intentAdmissionDecisionId !== questionRef.issuingDecisionId ||
          question.intentAdmissionDecisionDigest !== questionRef.issuingDecisionDigest
        ) {
          throw new StoreInvariantError(`Intake Manifest ${manifest.id} has a false Question`);
        }
      }
      for (const answerBindingDigest of manifest.answerBindingDigests) {
        if (answerBindingByDigest.get(answerBindingDigest)?.intakeRunId !== manifest.intakeRunId) {
          throw new StoreInvariantError(
            `Intake Manifest ${manifest.id} has a false Answer Binding`,
          );
        }
      }
    }

    for (const decision of decisions) {
      const run = runById.get(decision.intakeRunId);
      const policy = policyById.get(decision.admissionPolicyId);
      const raw = rawRequestById.get(run?.activeRawRequestRevision.rawRequestId ?? '');
      const revision =
        raw === undefined
          ? undefined
          : revisionByKey.get(intakeRevisionKey(raw.id, decision.rawRequestRevision));
      if (
        revision?.rawRequestDigest !== decision.rawRequestDigest ||
        revision.principalRef !== decision.principalRef ||
        revision.interactionAction !== decision.interactionAction ||
        policy?.version !== decision.admissionPolicyVersion ||
        policy.digest !== decision.admissionPolicyDigest ||
        decision.intakeRunVersion > (run?.version ?? 0) ||
        decision.decidedAt < revision.submittedAt ||
        (decision.projectOrScopeRef !== undefined &&
          (revision.declaredProjectRef === undefined ||
            !sameCanonicalAuthority(decision.projectOrScopeRef, revision.declaredProjectRef)))
      ) {
        throw new StoreInvariantError(
          `Admission Decision ${decision.id} has false source authority`,
        );
      }
      if ('projectionBinding' in decision) {
        const binding = decision.projectionBinding;
        const projection = projectionByKey.get(
          intakeRevisionKey(binding.intentProjectionId, binding.intentProjectionRevision),
        );
        const proposal = proposalById.get(binding.intentAnalysisProposalId);
        if (
          projection?.projectionDigest !== binding.intentProjectionDigest ||
          projection.intakeRunId !== decision.intakeRunId ||
          proposal?.proposalDigest !== binding.intentAnalysisProposalDigest ||
          proposal.id !== projection.intentAnalysisProposalRef.id ||
          !sameCanonicalAuthority(
            binding.sourceBindingDigests,
            projection.sourceBindings.map((source) => source.bindingDigest),
          ) ||
          !sameCanonicalAuthority(binding.materialAmbiguityRefs, projection.materialAmbiguityRefs)
        ) {
          throw new StoreInvariantError(
            `Admission Decision ${decision.id} has a substituted Projection binding`,
          );
        }
      }
    }

    for (const question of questions) {
      const decision = decisionById.get(question.intentAdmissionDecisionId);
      const spec = questionSpecByDigest.get(question.questionSpecDigest);
      if (
        decision?.kind !== IntentAdmissionDecisionKind.CLARIFY ||
        decision.decisionDigest !== question.intentAdmissionDecisionDigest ||
        decision.intakeRunId !== question.intakeRunId ||
        decision.questionPlanBinding.questionId !== question.id ||
        decision.questionPlanBinding.questionSpecDigest !== question.questionSpecDigest ||
        spec?.intakeRunId !== question.intakeRunId ||
        spec.basedOnProjectionRevision !== question.basedOnProjectionRevision ||
        spec.ambiguityRef !== question.ambiguityRef ||
        spec.prompt !== question.prompt ||
        !sameCanonicalAuthority(spec.affectedFields, question.affectedFields) ||
        !sameCanonicalAuthority(spec.answerSchema, question.answerSchema) ||
        question.createdAt < decision.decidedAt
      ) {
        throw new StoreInvariantError(`Clarification Question ${question.id} is falsely bound`);
      }
    }

    for (const binding of answerBindings) {
      const question = questionById.get(binding.clarificationQuestionId);
      const revision = revisionByKey.get(
        intakeRevisionKey(binding.rawRequestId, binding.rawRequestRevision),
      );
      if (
        question?.intakeRunId !== binding.intakeRunId ||
        revision?.intakeRunId !== binding.intakeRunId ||
        question.questionSpecDigest !== binding.questionSpecDigest ||
        question.questionDigest !== binding.questionDigest ||
        question.intentAdmissionDecisionId !== binding.intentAdmissionDecisionId ||
        question.intentAdmissionDecisionDigest !== binding.intentAdmissionDecisionDigest ||
        revision.rawRequestDigest !== binding.rawRequestDigest ||
        revision.answeredQuestionBinding?.clarificationQuestionId !== question.id ||
        revision.answeredQuestionBinding.questionSpecDigest !== question.questionSpecDigest ||
        revision.answeredQuestionBinding.questionDigest !== question.questionDigest ||
        revision.answeredQuestionBinding.intentAdmissionDecisionId !==
          question.intentAdmissionDecisionId ||
        revision.answeredQuestionBinding.intentAdmissionDecisionDigest !==
          question.intentAdmissionDecisionDigest ||
        binding.answeredAt < question.createdAt ||
        binding.answeredAt < revision.submittedAt
      ) {
        throw new StoreInvariantError(
          `Clarification Answer Binding ${binding.id} has false Question authority`,
        );
      }
    }
    for (const revision of revisions) {
      const answered = revision.answeredQuestionBinding;
      if (
        answered !== undefined &&
        answerBindingByQuestionId.get(answered.clarificationQuestionId)?.rawRequestDigest !==
          revision.rawRequestDigest
      ) {
        throw new StoreInvariantError(
          `Answered Raw Request revision ${revision.rawRequestId}@${String(revision.revision)} has no exact Answer Binding`,
        );
      }
    }

    for (const response of answerResponses) {
      const decision = decisionById.get(response.intentAdmissionDecisionId);
      const run = runById.get(response.intakeRunId);
      const responseOutcomes = outcomes.filter(
        (candidate) =>
          candidate.result.kind === 'NO_EXECUTION' &&
          'answerOnlyResponseRef' in candidate.result &&
          candidate.result.answerOnlyResponseRef.id === response.id,
      );
      const outcome = responseOutcomes[0];
      const reservation =
        outcome === undefined ? undefined : reservationByCommandId.get(outcome.commandId);
      const outcomeResponseRef =
        outcome?.result.kind === 'NO_EXECUTION' && 'answerOnlyResponseRef' in outcome.result
          ? outcome.result.answerOnlyResponseRef
          : undefined;
      const outcomeDecisionRef =
        outcome?.result.kind === 'NO_EXECUTION' ? outcome.result.decisionRef : undefined;
      const revision =
        run === undefined
          ? undefined
          : revisionByKey.get(
              intakeRevisionKey(
                run.activeRawRequestRevision.rawRequestId,
                response.rawRequestRevision,
              ),
            );
      if (
        responseOutcomes.length !== 1 ||
        run?.status !== IntakeRunStatus.NO_EXECUTION ||
        run.activeRawRequestRevision.revision !== response.rawRequestRevision ||
        run.activeRawRequestRevision.digest !== response.rawRequestDigest ||
        outcome?.intakeRunId !== response.intakeRunId ||
        outcomeDecisionRef?.id !== response.intentAdmissionDecisionId ||
        outcomeDecisionRef.digest !== response.intentAdmissionDecisionDigest ||
        decision?.decisionDigest !== response.intentAdmissionDecisionDigest ||
        decision.intakeRunId !== response.intakeRunId ||
        decision.rawRequestRevision !== response.rawRequestRevision ||
        decision.rawRequestDigest !== response.rawRequestDigest ||
        decision.outcome !== IntentAdmissionOutcome.NO_EXECUTION ||
        decision.interactionAction !== IntakeInteractionAction.ANSWER_ONLY ||
        revision?.rawRequestDigest !== response.rawRequestDigest ||
        outcomeResponseRef?.digest !== response.responseDigest ||
        outcomeResponseRef.kind !== response.kind ||
        reservation?.intakeRunId !== response.intakeRunId ||
        reservation.operationKind !== IntakeCommandOperationKind.ANSWER_ONLY ||
        reservation.externalOperationBinding.assistantAdapterId !== response.assistantAdapterId ||
        reservation.externalOperationBinding.assistantAdapterVersion !==
          response.assistantAdapterVersion ||
        reservation.externalOperationBinding.responseContractDigest !==
          response.responseContractDigest ||
        response.observedAt < decision.decidedAt
      ) {
        throw new StoreInvariantError(`Answer-only Response ${response.id} is falsely bound`);
      }
      if (
        response.kind === AnswerOnlyResponseKind.ANSWER_RETURNED &&
        !classifyM25IntakeRetainedText(response.answerContent).accepted
      ) {
        throw new StoreInvariantError(
          `Answer-only Response ${response.id} violates its retention profile`,
        );
      }
    }
    for (const failure of failures) {
      const run = runById.get(failure.intakeRunId);
      const outcome = outcomeByCommandId.get(failure.commandId);
      const failureOutcomes = outcomes.filter(
        (candidate) =>
          candidate.result.kind === 'FAILED' && candidate.result.failureRef.id === failure.id,
      );
      const reservation = reservationByCommandId.get(failure.commandId);
      const externalOperationBinding =
        reservation !== undefined && 'externalOperationBinding' in reservation
          ? reservation.externalOperationBinding
          : undefined;
      const failureReservationKind =
        reservation?.operationKind === IntakeCommandOperationKind.INTENT_ANALYSIS ||
        reservation?.operationKind === IntakeCommandOperationKind.CLARIFICATION_ANALYSIS;
      const revision =
        run === undefined
          ? undefined
          : revisionByKey.get(
              intakeRevisionKey(
                run.activeRawRequestRevision.rawRequestId,
                failure.rawRequestRevision,
              ),
            );
      if (
        failureOutcomes.length !== 1 ||
        failureOutcomes[0]?.commandId !== failure.commandId ||
        run?.status !== IntakeRunStatus.FAILED ||
        run.terminalFailureRef.id !== failure.id ||
        run.terminalFailureRef.digest !== failure.failureDigest ||
        revision?.rawRequestDigest !== failure.rawRequestDigest ||
        failure.failedAt < revision.submittedAt ||
        outcome?.disposition !== IntakeCommandDisposition.FAILED ||
        outcome.intakeRunId !== failure.intakeRunId ||
        outcome.result.failureRef.id !== failure.id ||
        outcome.result.failureRef.digest !== failure.failureDigest ||
        outcome.result.intakeRunVersion !== failure.intakeRunVersion + 1 ||
        outcome.completedAt < failure.failedAt ||
        reservation?.intakeRunId !== failure.intakeRunId ||
        !failureReservationKind ||
        externalOperationBinding === undefined ||
        failure.failedAt < reservation.reservedAt ||
        (failure.failedOperation === IntakeFailedOperation.INTENT_ANALYSIS &&
          (externalOperationBinding.assistantAdapterId !== failure.assistantAdapterId ||
            externalOperationBinding.assistantAdapterVersion !== failure.assistantAdapterVersion ||
            externalOperationBinding.responseContractDigest !== failure.responseContractDigest))
      ) {
        throw new StoreInvariantError(`Intake Failure ${failure.id} is falsely bound`);
      }
    }

    for (const reservation of reservations) {
      const root = rawRequestById.get(reservation.rawRequestId);
      const run = runById.get(reservation.intakeRunId);
      const outcome = outcomeByCommandId.get(reservation.commandId);
      if (
        root?.intakeRunId !== reservation.intakeRunId ||
        reservation.observedIntakeRunVersion > (run?.version ?? 0)
      ) {
        throw new StoreInvariantError(
          `Intake command reservation ${reservation.commandId} has false target authority`,
        );
      }
      if ('externalOperationBinding' in reservation) {
        const external = reservation.externalOperationBinding;
        const manifest = manifestById.get(external.manifestId);
        const policy = policyById.get(external.admissionPolicyId);
        if (
          manifest?.manifestDigest !== external.manifestDigest ||
          manifest.intakeRunId !== reservation.intakeRunId ||
          manifest.assistantAdapter.id !== external.assistantAdapterId ||
          manifest.assistantAdapter.version !== external.assistantAdapterVersion ||
          manifest.responseContract.digest !== external.responseContractDigest ||
          policy?.version !== external.admissionPolicyVersion ||
          policy.digest !== external.admissionPolicyDigest
        ) {
          throw new StoreInvariantError(
            `Intake command reservation ${reservation.commandId} has false external binding`,
          );
        }
      }
      if (
        reservation.operationKind === IntakeCommandOperationKind.CLARIFICATION_ANALYSIS &&
        reservation.externalOperationBinding === undefined
      ) {
        const question = questionById.get(reservation.clarificationBinding.clarificationQuestionId);
        const answerBinding = answerBindingByCommandId.get(reservation.commandId);
        if (
          question?.intakeRunId !== reservation.intakeRunId ||
          question.questionSpecDigest !== reservation.clarificationBinding.questionSpecDigest ||
          question.questionDigest !== reservation.clarificationBinding.questionDigest ||
          question.intentAdmissionDecisionId !==
            reservation.clarificationBinding.issuingClarifyDecisionId ||
          question.intentAdmissionDecisionDigest !==
            reservation.clarificationBinding.issuingClarifyDecisionDigest ||
          !sameCanonicalAuthority(
            question.answerSchema,
            reservation.clarificationBinding.answerSchema,
          ) ||
          answerBinding !== undefined ||
          outcome?.disposition !== IntakeCommandDisposition.REJECTED
        ) {
          throw new StoreInvariantError(
            `Rejected clarification ${reservation.commandId} has false Question authority`,
          );
        }
      } else if (reservation.operationKind === IntakeCommandOperationKind.CLARIFICATION_ANALYSIS) {
        const question = questionById.get(reservation.clarificationBinding.clarificationQuestionId);
        const answerBinding = answerBindingByQuestionId.get(
          reservation.clarificationBinding.clarificationQuestionId,
        );
        const answeredRevision =
          answerBinding === undefined
            ? undefined
            : revisionByKey.get(
                intakeRevisionKey(answerBinding.rawRequestId, answerBinding.rawRequestRevision),
              );
        const parentRevision =
          answeredRevision?.parentRevision === undefined
            ? undefined
            : revisionByKey.get(
                intakeRevisionKey(answeredRevision.rawRequestId, answeredRevision.parentRevision),
              );
        const changesProject =
          answeredRevision !== undefined &&
          parentRevision !== undefined &&
          !sameOptionalProjectRef(
            answeredRevision.declaredProjectRef,
            parentRevision.declaredProjectRef,
          );
        const exactProjectIdentityQuestion = isExactProjectIdentityQuestion(question);
        if (
          question?.intakeRunId !== reservation.intakeRunId ||
          question.questionSpecDigest !== reservation.clarificationBinding.questionSpecDigest ||
          question.questionDigest !== reservation.clarificationBinding.questionDigest ||
          question.intentAdmissionDecisionId !==
            reservation.clarificationBinding.issuingClarifyDecisionId ||
          question.intentAdmissionDecisionDigest !==
            reservation.clarificationBinding.issuingClarifyDecisionDigest ||
          !sameCanonicalAuthority(
            question.answerSchema,
            reservation.clarificationBinding.answerSchema,
          ) ||
          answerBinding?.commandId !== reservation.commandId ||
          answerBinding.canonicalCommandInputDigest !== reservation.canonicalCommandInputDigest ||
          answerBinding.answeredAt < reservation.reservedAt ||
          (changesProject && !exactProjectIdentityQuestion)
        ) {
          throw new StoreInvariantError(
            `Clarification reservation ${reservation.commandId} has false Question/Answer authority`,
          );
        }
      }
      if (reservation.operationKind === IntakeCommandOperationKind.ABANDON_CLARIFICATION) {
        if ('abandonClarificationBinding' in reservation) {
          const binding = reservation.abandonClarificationBinding;
          const question = questionById.get(binding.clarificationQuestionId);
          const result = outcome?.result;
          const decision =
            result?.kind === 'NO_EXECUTION' ? decisionById.get(result.decisionRef.id) : undefined;
          if (
            question?.intakeRunId !== reservation.intakeRunId ||
            question.questionSpecDigest !== binding.questionSpecDigest ||
            question.questionDigest !== binding.questionDigest ||
            question.intentAdmissionDecisionId !== binding.issuingClarifyDecisionId ||
            question.intentAdmissionDecisionDigest !== binding.issuingClarifyDecisionDigest ||
            outcome?.disposition !== IntakeCommandDisposition.APPLIED ||
            decision?.kind !== IntentAdmissionDecisionKind.PROJECTED_NO_EXECUTION ||
            decision.reasonCode !== IntentAdmissionReasonCode.ABANDONED ||
            decision.abandonmentBinding?.clarificationQuestionId !==
              binding.clarificationQuestionId ||
            decision.abandonmentBinding.questionSpecDigest !== binding.questionSpecDigest ||
            decision.abandonmentBinding.questionDigest !== binding.questionDigest ||
            decision.abandonmentBinding.issuingClarifyDecisionId !==
              binding.issuingClarifyDecisionId ||
            decision.abandonmentBinding.issuingClarifyDecisionDigest !==
              binding.issuingClarifyDecisionDigest ||
            decision.abandonmentBinding.commandId !== reservation.commandId ||
            decision.abandonmentBinding.canonicalCommandInputDigest !==
              reservation.canonicalCommandInputDigest
          ) {
            throw new StoreInvariantError(
              `Applied abandonment ${reservation.commandId} has false bound authority`,
            );
          }
        } else if (outcome?.disposition !== IntakeCommandDisposition.REJECTED) {
          throw new StoreInvariantError(
            `Rejected abandonment ${reservation.commandId} has a false outcome`,
          );
        }
      }
      if (outcome === undefined) {
        if (
          !(
            reservation.operationKind === IntakeCommandOperationKind.INTENT_ANALYSIS ||
            reservation.operationKind === IntakeCommandOperationKind.ANSWER_ONLY ||
            reservation.operationKind === IntakeCommandOperationKind.CLARIFICATION_ANALYSIS
          ) ||
          run?.status !== IntakeRunStatus.ANALYZING
        ) {
          throw new StoreInvariantError(
            `Intake command reservation ${reservation.commandId} is an invalid orphan`,
          );
        }
      } else {
        decodeIntakeCommandClosure(reservation, outcome, canonicalAuthorityDigests);
        if (outcome.completedAt < reservation.reservedAt) {
          throw new StoreInvariantError(
            `Intake command outcome ${outcome.commandId} predates its reservation`,
          );
        }
      }
    }
    for (const outcome of outcomes) {
      const reservation = reservationByCommandId.get(outcome.commandId);
      if (reservation === undefined) {
        throw new StoreInvariantError(`Intake command outcome ${outcome.commandId} is orphaned`);
      }
      const result = outcome.result;
      if ('decisionRef' in result && 'externalOperationBinding' in reservation) {
        const decision = decisionById.get(result.decisionRef.id);
        if (decision !== undefined && 'projectionBinding' in decision) {
          const proposal = proposalById.get(decision.projectionBinding.intentAnalysisProposalId);
          if (proposal === undefined) {
            throw new StoreInvariantError(
              `Intake outcome ${outcome.commandId} has no exact Proposal authority`,
            );
          }
          assertExactProposalAnalysisAuthority(proposal, decision, reservation);
        }
      }
      if (result.kind === 'CLARIFICATION_REQUIRED') {
        const decision = decisionById.get(result.decisionRef.id);
        const question = questionById.get(result.activeQuestionRef.clarificationQuestionId);
        if (
          decision?.decisionDigest !== result.decisionRef.digest ||
          decision.outcome !== IntentAdmissionOutcome.CLARIFY ||
          question?.questionDigest !== result.activeQuestionRef.questionDigest ||
          question.questionSpecDigest !== result.activeQuestionRef.questionSpecDigest
        ) {
          throw new StoreInvariantError(
            `Intake outcome ${outcome.commandId} has false CLARIFY result`,
          );
        }
      } else if (result.kind === 'NO_EXECUTION') {
        const decision = decisionById.get(result.decisionRef.id);
        if (
          decision?.decisionDigest !== result.decisionRef.digest ||
          decision.intakeRunId !== outcome.intakeRunId ||
          decision.outcome !== IntentAdmissionOutcome.NO_EXECUTION
        ) {
          throw new StoreInvariantError(
            `Intake outcome ${outcome.commandId} has false NO_EXECUTION result`,
          );
        }
        if ('answerOnlyResponseRef' in result) {
          const response = answerResponseById.get(result.answerOnlyResponseRef.id);
          if (
            response?.responseDigest !== result.answerOnlyResponseRef.digest ||
            response.kind !== result.answerOnlyResponseRef.kind ||
            response.intakeRunId !== outcome.intakeRunId ||
            response.intentAdmissionDecisionId !== result.decisionRef.id ||
            response.intentAdmissionDecisionDigest !== result.decisionRef.digest
          ) {
            throw new StoreInvariantError(
              `Intake outcome ${outcome.commandId} has a false Answer-only result`,
            );
          }
        }
      } else if (result.kind === 'MATERIALIZED') {
        const decision = decisionById.get(result.decisionRef.id);
        const materialization = materializationById.get(
          result.materializedGoalRef.goalMaterializationId,
        );
        const authorization =
          materialization === undefined
            ? undefined
            : startAuthorizationByMaterializationId.get(materialization.id);
        if (
          decision?.decisionDigest !== result.decisionRef.digest ||
          decision.outcome !== IntentAdmissionOutcome.MATERIALIZE ||
          materialization?.materializationDigest !==
            result.materializedGoalRef.materializationDigest ||
          materialization.goalId !== result.materializedGoalRef.goalId ||
          materialization.goalRevision !== result.materializedGoalRef.goalRevision ||
          materialization.workflowId !== result.materializedGoalRef.workflowId ||
          materialization.workflowVersion !== result.materializedGoalRef.workflowVersion ||
          ('goalStartAuthorizationRef' in result
            ? authorization?.id !== result.goalStartAuthorizationRef.id ||
              authorization.authorizationDigest !== result.goalStartAuthorizationRef.digest ||
              authorization.startCommandId !== result.goalStartAuthorizationRef.startCommandId
            : authorization !== undefined)
        ) {
          throw new StoreInvariantError(
            `Intake outcome ${outcome.commandId} has false Materialization result`,
          );
        }
      } else if (result.kind === 'FAILED') {
        const failure = failureById.get(result.failureRef.id);
        if (
          failure?.failureDigest !== result.failureRef.digest ||
          failure.intakeRunId !== outcome.intakeRunId ||
          failure.commandId !== outcome.commandId
        ) {
          throw new StoreInvariantError(
            `Intake outcome ${outcome.commandId} has false Failure result`,
          );
        }
      }
    }

    for (const materialization of materializations) {
      const run = runById.get(materialization.intakeRunId);
      const decision = decisionById.get(materialization.intentAdmissionDecisionId);
      const projection = projectionByKey.get(
        intakeRevisionKey(
          materialization.intentProjectionId,
          materialization.intentProjectionRevision,
        ),
      );
      const ambiguitySet = ambiguitySetByProjection.get(
        intakeRevisionKey(
          materialization.intentProjectionId,
          materialization.intentProjectionRevision,
        ),
      );
      const owner = this.getGoalWithWorkflow(materialization.goalId);
      const authorization = startAuthorizationByMaterializationId.get(materialization.id);
      if (
        run === undefined ||
        decision?.kind !== IntentAdmissionDecisionKind.MATERIALIZE ||
        projection === undefined ||
        ambiguitySet === undefined ||
        owner === undefined
      ) {
        throw new StoreInvariantError(
          `Goal Materialization ${materialization.id} is falsely bound`,
        );
      }
      if (
        decision.decisionDigest !== materialization.intentAdmissionDecisionDigest ||
        projection.projectionDigest !== materialization.intentProjectionDigest ||
        projection.rawRequestRevision !== materialization.rawRequestRevision ||
        projection.objective !== owner.goal.objective ||
        !sameCanonicalAuthority(
          projection.requiredCriteria,
          owner.goal.successCriteria.map((criterion) => criterion.description),
        ) ||
        owner.goal.successCriteria.some((criterion) => !criterion.required) ||
        projection.optionalCriteria.length !== 0 ||
        projection.assumptions.length !== 0 ||
        projection.scope.projectPath !== materialization.projectOrScopeRef.normalizedPath ||
        !sameCanonicalAuthority(projection.scope.allowedPaths, owner.goal.scope.allowedPaths) ||
        !sameCanonicalAuthority(projection.nonGoals, owner.goal.nonGoals) ||
        projection.requestedExecutionDisposition !== decision.executionDisposition ||
        ambiguitySet.ambiguities.length !== 0 ||
        owner.goal.revision !== materialization.goalRevision ||
        owner.goal.scope.projectPath !== materialization.projectOrScopeRef.normalizedPath ||
        decision.projectOrScopeRef.normalizedPath !==
          materialization.projectOrScopeRef.normalizedPath ||
        decision.projectOrScopeRef.identityDigest !==
          materialization.projectOrScopeRef.identityDigest ||
        run.activeRawRequestRevision.revision !== materialization.rawRequestRevision ||
        run.activeRawRequestRevision.digest !== materialization.rawRequestDigest ||
        owner.workflow.id !== materialization.workflowId ||
        materialization.workflowVersion !== 1 ||
        owner.workflow.version < materialization.workflowVersion ||
        owner.goal.createdAt !== materialization.materializedAt ||
        owner.workflow.createdAt !== materialization.materializedAt ||
        materialization.materializedAt < decision.decidedAt ||
        (decision.executionDisposition === IntentExecutionDisposition.AUTHORIZE_START) !==
          (authorization !== undefined)
      ) {
        throw new StoreInvariantError(
          `Goal Materialization ${materialization.id} is falsely bound`,
        );
      }
    }
    for (const authorization of startAuthorizations) {
      const materialization = materializationById.get(authorization.goalMaterializationId);
      const decision = decisionById.get(authorization.intentAdmissionDecisionId);
      const policy = this.getPolicyBundle(authorization.policyBundleId);
      const profile = this.getExecutionProfile(authorization.executionProfileId);
      const processedStart = this.getProcessedCommand(authorization.startCommandId);
      const processedStartOutcome =
        processedStart === undefined
          ? undefined
          : decodeStoredCommandOutcome(processedStart.outcome);
      const appliedAsAuthorizedFirstStart =
        processedStart?.aggregateType === 'GOAL' &&
        processedStart.aggregateId === authorization.goalId &&
        processedStartOutcome?.disposition === StoredCommandDisposition.APPLIED &&
        processedStartOutcome.goalId === authorization.goalId &&
        processedStartOutcome.workflow.id === authorization.workflowId &&
        processedStartOutcome.workflow.version === authorization.workflowVersion + 1 &&
        processedStartOutcome.workflow.phase === WorkflowPhase.DISCOVERY &&
        processedStartOutcome.workflow.runStatus === RunStatus.RUNNING;
      const policyBinding = appliedAsAuthorizedFirstStart
        ? this.getWorkflowPolicyBinding(authorization.workflowId)
        : undefined;
      const profileBinding = appliedAsAuthorizedFirstStart
        ? this.getExecutionProfileBinding(authorization.workflowId)
        : undefined;
      const materializationOutcome =
        materialization === undefined
          ? undefined
          : outcomes.find(
              (outcome) =>
                outcome.intakeRunId === materialization.intakeRunId &&
                outcome.result.kind === 'MATERIALIZED' &&
                outcome.result.materializedGoalRef.goalMaterializationId === materialization.id,
            );
      if (
        materialization === undefined ||
        decision === undefined ||
        materializationOutcome === undefined
      ) {
        throw new StoreInvariantError(
          `Goal Start Authorization ${authorization.id} is falsely bound`,
        );
      }
      if (
        materialization.materializationDigest !== authorization.goalMaterializationDigest ||
        materialization.goalId !== authorization.goalId ||
        materialization.goalRevision !== authorization.goalRevision ||
        materialization.workflowId !== authorization.workflowId ||
        materialization.workflowVersion !== authorization.workflowVersion ||
        decision.decisionDigest !== authorization.intentAdmissionDecisionDigest ||
        decision.executionDisposition !== IntentExecutionDisposition.AUTHORIZE_START ||
        authorization.principalRef !== decision.principalRef ||
        authorization.rawRequestRevision !== materialization.rawRequestRevision ||
        authorization.rawRequestDigest !== materialization.rawRequestDigest ||
        authorization.startCommandId === materializationOutcome.commandId ||
        policy?.bundle.digest !== authorization.policyBundleDigest ||
        profile?.profile.digest !== authorization.executionProfileDigest ||
        (appliedAsAuthorizedFirstStart &&
          (policyBinding?.goalId !== authorization.goalId ||
            policyBinding.workflowId !== authorization.workflowId ||
            policyBinding.startCommandId !== authorization.startCommandId ||
            policyBinding.policyBundleId !== authorization.policyBundleId ||
            policyBinding.policyBundleDigest !== authorization.policyBundleDigest ||
            profileBinding?.goalId !== authorization.goalId ||
            profileBinding.workflowId !== authorization.workflowId ||
            profileBinding.startCommandId !== authorization.startCommandId ||
            profileBinding.profileId !== authorization.executionProfileId ||
            profileBinding.profileDigest !== authorization.executionProfileDigest)) ||
        authorization.authorizedAt < materialization.materializedAt
      ) {
        throw new StoreInvariantError(
          `Goal Start Authorization ${authorization.id} is falsely bound`,
        );
      }
    }

    for (const run of runs) {
      const root = rawRequestById.get(run.activeRawRequestRevision.rawRequestId);
      const revision = revisionByKey.get(
        intakeRevisionKey(
          run.activeRawRequestRevision.rawRequestId,
          run.activeRawRequestRevision.revision,
        ),
      );
      if (
        root?.intakeRunId !== run.id ||
        revision?.rawRequestDigest !== run.activeRawRequestRevision.digest ||
        revision.intakeRunId !== run.id ||
        run.updatedAt < revision.submittedAt ||
        !sameOptionalProjectRef(run.projectRef, revision.declaredProjectRef)
      ) {
        throw new StoreInvariantError(
          `Intake Run ${run.id} has false active Raw Request authority`,
        );
      }
      if (run.activeIntentProjectionRevision !== undefined) {
        const activeProjection = projectionByKey.get(
          intakeRevisionKey(
            run.activeIntentProjectionRevision.id,
            run.activeIntentProjectionRevision.revision,
          ),
        );
        if (
          activeProjection?.projectionDigest !== run.activeIntentProjectionRevision.digest ||
          activeProjection.intakeRunId !== run.id
        ) {
          throw new StoreInvariantError(`Intake Run ${run.id} has a false current Projection`);
        }
      }
      const terminalOutcomes = outcomes.filter(
        (outcome) =>
          outcome.intakeRunId === run.id &&
          'intakeRunVersion' in outcome.result &&
          outcome.result.intakeRunVersion === run.version &&
          (outcome.result.kind === 'MATERIALIZED' ||
            outcome.result.kind === 'NO_EXECUTION' ||
            outcome.result.kind === 'FAILED'),
      );
      if (run.status === IntakeRunStatus.ANALYZING) {
        const activeReservations = reservations.filter(
          (reservation) =>
            reservation.intakeRunId === run.id &&
            reservation.observedIntakeRunVersion === run.version &&
            !outcomeByCommandId.has(reservation.commandId),
        );
        if (
          activeReservations.length !== 1 ||
          !('externalOperationBinding' in (activeReservations[0] ?? {}))
        ) {
          throw new StoreInvariantError(
            `Intake Run ${run.id} has no unique active external operation`,
          );
        }
      } else if (run.status === IntakeRunStatus.NEEDS_CLARIFICATION) {
        const question = questionById.get(run.activeQuestionRef.clarificationQuestionId);
        if (
          question?.intakeRunId !== run.id ||
          question.questionSpecDigest !== run.activeQuestionRef.questionSpecDigest ||
          question.questionDigest !== run.activeQuestionRef.questionDigest ||
          question.intentAdmissionDecisionId !== run.activeQuestionRef.issuingDecisionId ||
          question.intentAdmissionDecisionDigest !== run.activeQuestionRef.issuingDecisionDigest ||
          answerBindingByQuestionId.has(question.id)
        ) {
          throw new StoreInvariantError(`Intake Run ${run.id} has a false active Question`);
        }
      } else if (run.status === IntakeRunStatus.MATERIALIZED) {
        const decision = decisionById.get(run.terminalDecisionRef.id);
        const materialization = materializationById.get(
          run.materializedGoalRef.goalMaterializationId,
        );
        if (
          terminalOutcomes.length !== 1 ||
          terminalOutcomes[0]?.result.kind !== 'MATERIALIZED' ||
          decision?.decisionDigest !== run.terminalDecisionRef.digest ||
          decision.outcome !== IntentAdmissionOutcome.MATERIALIZE ||
          materialization?.materializationDigest !==
            run.materializedGoalRef.materializationDigest ||
          materialization.intakeRunId !== run.id
        ) {
          throw new StoreInvariantError(`Intake Run ${run.id} has false terminal Materialization`);
        }
      } else if (run.status === IntakeRunStatus.NO_EXECUTION) {
        const decision = decisionById.get(run.terminalDecisionRef.id);
        const terminalOutcome = terminalOutcomes[0];
        const terminalResult =
          terminalOutcome?.result.kind === 'NO_EXECUTION' ? terminalOutcome.result : undefined;
        if (
          terminalOutcomes.length !== 1 ||
          terminalResult?.intakeRunVersion !== run.version ||
          !sameCanonicalAuthority(terminalResult.decisionRef, run.terminalDecisionRef) ||
          decision?.decisionDigest !== run.terminalDecisionRef.digest ||
          decision.intakeRunId !== run.id ||
          decision.outcome !== IntentAdmissionOutcome.NO_EXECUTION
        ) {
          throw new StoreInvariantError(`Intake Run ${run.id} has a false terminal Decision`);
        }
        if ('answerOnlyResponseRef' in run) {
          const response = answerResponseById.get(run.answerOnlyResponseRef.id);
          if (
            !('answerOnlyResponseRef' in terminalResult) ||
            !sameCanonicalAuthority(
              terminalResult.answerOnlyResponseRef,
              run.answerOnlyResponseRef,
            ) ||
            response?.responseDigest !== run.answerOnlyResponseRef.digest ||
            response.kind !== run.answerOnlyResponseRef.kind ||
            response.intakeRunId !== run.id ||
            response.intentAdmissionDecisionId !== run.terminalDecisionRef.id ||
            response.intentAdmissionDecisionDigest !== run.terminalDecisionRef.digest
          ) {
            throw new StoreInvariantError(`Intake Run ${run.id} has a false Answer-only Response`);
          }
        } else if ('answerOnlyResponseRef' in terminalResult) {
          throw new StoreInvariantError(`Intake Run ${run.id} has a mixed Answer-only Response`);
        }
      } else {
        const terminalOutcome = terminalOutcomes[0];
        const terminalResult =
          terminalOutcome?.result.kind === 'FAILED' ? terminalOutcome.result : undefined;
        const failure = failureById.get(run.terminalFailureRef.id);
        if (
          terminalOutcomes.length !== 1 ||
          terminalResult?.intakeRunVersion !== run.version ||
          !sameCanonicalAuthority(terminalResult.failureRef, run.terminalFailureRef) ||
          failure?.failureDigest !== run.terminalFailureRef.digest ||
          failure.intakeRunId !== run.id ||
          failure.commandId !== terminalOutcome?.commandId ||
          failure.intakeRunVersion + 1 !== run.version
        ) {
          throw new StoreInvariantError(`Intake Run ${run.id} has a false terminal Failure`);
        }
      }
    }
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

  public getGoalStatusAuthority(
    rawGoalIdentifier: GoalId,
  ): GoalStatusAuthoritySnapshot | undefined {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    return this.runRead(() => {
      const owner = this.getGoalWithWorkflow(goalIdentifier);
      if (owner === undefined) {
        return undefined;
      }
      const { goal, workflow } = owner;
      const startAuthority = this.resolveWorkflowStartAuthorityClosure(workflow);
      const policyBinding =
        startAuthority.state === 'STARTED' ? startAuthority.policyBinding : undefined;
      const executionProfileBinding =
        startAuthority.state === 'STARTED' ? startAuthority.executionProfileBinding : undefined;
      const activeAttempt =
        workflow.activeAttemptId === undefined
          ? undefined
          : this.getAttempt(workflow.activeAttemptId);
      if (workflow.activeAttemptId !== undefined && activeAttempt === undefined) {
        throw new StoreInvariantError(
          `Workflow ${workflow.id} has no readable active Attempt authority`,
        );
      }
      if (!hasExactWorkflowActiveAttemptAuthority(workflow, activeAttempt)) {
        throw new StoreInvariantError(
          `Workflow ${workflow.id} has no exact active Attempt authority`,
        );
      }
      this.assertCurrentWorkflowCommandClosure(workflow);
      const candidateAuthority = this.getCandidateAuthorityForWorkflow(workflow.id);
      const closeout = this.getCloseoutForWorkflow(workflow.id);
      const latestRecoveryReconciliation = this.getLatestRecoveryReconciliation(workflow.id);
      const acceptanceCriticalVerificationPlan = this.getAcceptanceCriticalVerificationPlan(
        workflow.id,
      );

      let decisionIdentifier: AcceptanceDecisionId | undefined;
      if (closeout !== undefined) {
        decisionIdentifier = closeout.acceptanceDecisionId;
      } else if (workflow.activeCandidateGenerationId !== undefined) {
        const row = this.#database
          .prepare(
            `SELECT decision.id
               FROM acceptance_decisions AS decision
               JOIN acceptance_input_manifests AS manifest
                 ON manifest.manifest_digest = decision.input_manifest_digest
               JOIN audit_events AS audit
                 ON audit.aggregate_type = 'ACCEPTANCE_DECISION'
                AND audit.aggregate_id = decision.id
                AND audit.event_type = 'ACCEPTANCE_DECISION_ISSUED'
              WHERE manifest.goal_id = ?
                AND manifest.goal_revision = ?
                AND manifest.workflow_id = ?
                AND manifest.workflow_version = ?
                AND manifest.candidate_generation_id = ?
              ORDER BY audit.sequence DESC
              LIMIT 1`,
          )
          .get(
            goal.id,
            goal.revision,
            workflow.id,
            workflow.version,
            workflow.activeCandidateGenerationId,
          );
        if (row !== undefined) {
          decisionIdentifier = acceptanceDecisionId(authorityIdentifierRowSchema.parse(row).id);
        }
      }

      const decision =
        decisionIdentifier === undefined
          ? undefined
          : this.getAcceptanceDecision(decisionIdentifier);
      const manifest =
        decision === undefined
          ? undefined
          : this.getAcceptanceInputManifest(decision.inputManifestDigest);
      if ((decision === undefined) !== (manifest === undefined)) {
        throw new StoreInvariantError(
          `Workflow ${workflow.id} has incomplete Acceptance query authority`,
        );
      }

      return Object.freeze({
        goal,
        workflow,
        ...(policyBinding === undefined ? {} : { policyBinding }),
        ...(executionProfileBinding === undefined ? {} : { executionProfileBinding }),
        ...(activeAttempt === undefined ? {} : { activeAttempt }),
        ...(candidateAuthority === undefined ? {} : { candidateAuthority }),
        ...(decision === undefined || manifest === undefined
          ? {}
          : {
              acceptanceAuthority: Object.freeze({ manifest, decision }),
            }),
        ...(closeout === undefined ? {} : { closeout }),
        ...(latestRecoveryReconciliation === undefined ? {} : { latestRecoveryReconciliation }),
        ...(acceptanceCriticalVerificationPlan === undefined
          ? {}
          : { acceptanceCriticalVerificationPlan }),
      });
    });
  }

  public getWorkflowDriverAuthority(
    rawGoalIdentifier: GoalId,
  ): WorkflowDriverAuthoritySnapshot | undefined {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    return this.runRead(() => {
      const status = this.getGoalStatusAuthority(goalIdentifier);
      if (status === undefined) {
        return undefined;
      }
      const policyBinding = status.policyBinding;
      const installedPolicyBundle =
        policyBinding === undefined
          ? undefined
          : this.getPolicyBundle(policyBinding.policyBundleId);
      const installedPolicy = installedPolicyBundle?.bundle;
      if (
        policyBinding !== undefined &&
        (installedPolicy?.id !== policyBinding.policyBundleId ||
          installedPolicy.version !== policyBinding.policyBundleVersion ||
          installedPolicy.digest !== policyBinding.policyBundleDigest)
      ) {
        throw new StoreInvariantError(
          `Workflow ${status.workflow.id} has no exact installed Policy Bundle`,
        );
      }
      const binding = status.executionProfileBinding;
      const installedExecutionProfile =
        binding === undefined ? undefined : this.getExecutionProfile(binding.profileId);
      const installedProfile = installedExecutionProfile?.profile;
      if (
        binding !== undefined &&
        (installedProfile?.id !== binding.profileId ||
          installedProfile.version !== binding.profileVersion ||
          installedProfile.digest !== binding.profileDigest)
      ) {
        throw new StoreInvariantError(
          `Workflow ${status.workflow.id} has no exact installed Execution Profile`,
        );
      }

      const latestAttemptRow = this.#database
        .prepare(
          `SELECT *
             FROM attempts
            WHERE workflow_id = ?
              AND phase = ?
            ORDER BY sequence DESC
            LIMIT 1`,
        )
        .get(status.workflow.id, status.workflow.phase);
      const latestPhaseAttempt =
        latestAttemptRow === undefined ? undefined : decodeAttempt(latestAttemptRow);
      if (
        status.activeAttempt !== undefined &&
        latestPhaseAttempt?.id !== status.activeAttempt.id
      ) {
        throw new StoreInvariantError(
          `Workflow ${status.workflow.id} active Attempt is not its latest phase Attempt`,
        );
      }
      const latestPhaseContextManifest =
        latestPhaseAttempt?.contextManifestId === undefined
          ? undefined
          : this.getContextManifest(latestPhaseAttempt.contextManifestId);
      if (
        latestPhaseAttempt?.contextManifestId !== undefined &&
        latestPhaseContextManifest === undefined
      ) {
        throw new StoreInvariantError(
          `Driver Attempt ${latestPhaseAttempt.id} has no retained Context Manifest`,
        );
      }

      const generationId = status.workflow.activeCandidateGenerationId;
      const verificationObligations = Object.freeze(
        generationId === undefined
          ? []
          : this.listVerificationObligations(status.goal.id).filter(
              (obligation) => obligation.candidateGenerationId === generationId,
            ),
      );
      const evidence = Object.freeze(
        generationId === undefined ? [] : this.listEvidenceForGeneration(generationId),
      );

      return Object.freeze({
        ...status,
        ...(installedPolicyBundle === undefined ? {} : { installedPolicyBundle }),
        ...(installedExecutionProfile === undefined ? {} : { installedExecutionProfile }),
        latestPhaseAttempt: latestPhaseAttempt ?? null,
        latestPhaseContextManifest: latestPhaseContextManifest ?? null,
        verificationObligations,
        evidence,
      });
    });
  }

  public getGoalAuditAuthority(rawGoalIdentifier: GoalId): GoalAuditAuthoritySnapshot | undefined {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    return this.runRead(() => {
      const owner = this.getGoalWithWorkflow(goalIdentifier);
      if (owner === undefined) {
        return undefined;
      }
      const watermark = auditSequenceWatermarkRowSchema.parse(
        this.#database
          .prepare('SELECT COALESCE(MAX(sequence), 0) AS through_sequence FROM audit_events')
          .get(),
      ).through_sequence;
      const events = Object.freeze(
        this.#database
          .prepare(
            `SELECT audit.id, audit.sequence, audit.aggregate_type, audit.aggregate_id,
                    audit.event_type, audit.actor_type, audit.command_id,
                    audit.before_version, audit.after_version, audit.correlation_id,
                    audit.causation_id, audit.payload_digest, audit.occurred_at
               FROM audit_events AS audit
              WHERE (
                      audit.aggregate_type = 'GOAL'
                  AND audit.aggregate_id = ?
                    )
                 OR (
                      audit.aggregate_type IN (
                        'WORKFLOW',
                        'WORKFLOW_CLOSEOUT',
                        'WORKFLOW_POLICY_BINDING',
                        'EXECUTION_PROFILE_BINDING'
                      )
                  AND audit.aggregate_id = ?
                    )
                 OR (
                      audit.aggregate_type = 'ATTEMPT'
                  AND EXISTS (
                        SELECT 1
                          FROM attempts AS attempt
                         WHERE attempt.id = audit.aggregate_id
                           AND attempt.workflow_id = ?
                      )
                    )
                 OR (
                      audit.aggregate_type = 'EXTERNAL_EXECUTION'
                  AND EXISTS (
                        SELECT 1
                          FROM external_execution_records AS execution
                         WHERE execution.id = audit.aggregate_id
                           AND execution.goal_id = ?
                      )
                    )
                 OR (
                      audit.aggregate_type = 'EXTERNAL_EXECUTION_OBSERVATION'
                  AND EXISTS (
                        SELECT 1
                          FROM external_execution_observations AS observation
                          JOIN external_execution_records AS execution
                            ON execution.id = observation.external_execution_id
                         WHERE observation.id = audit.aggregate_id
                           AND execution.goal_id = ?
                      )
                    )
                 OR (
                      audit.aggregate_type = 'EXTERNAL_MAINTENANCE'
                  AND EXISTS (
                        SELECT 1
                          FROM external_maintenance_intents AS maintenance
                          JOIN external_execution_records AS execution
                            ON execution.id = maintenance.external_execution_id
                         WHERE maintenance.id = audit.aggregate_id
                           AND execution.goal_id = ?
                      )
                    )
                 OR EXISTS (
                      SELECT 1
                        FROM processed_commands AS processed
                        LEFT JOIN workflows AS owned_workflow
                          ON processed.aggregate_type = 'WORKFLOW'
                         AND owned_workflow.id = processed.aggregate_id
                       WHERE processed.command_id = audit.command_id
                         AND (
                              (
                                processed.aggregate_type = 'GOAL'
                                AND processed.aggregate_id = ?
                              )
                              OR (
                                processed.aggregate_type = 'WORKFLOW'
                                AND owned_workflow.goal_id = ?
                              )
                         )
                    )
              ORDER BY audit.sequence`,
          )
          .all(
            goalIdentifier,
            owner.workflow.id,
            owner.workflow.id,
            goalIdentifier,
            goalIdentifier,
            goalIdentifier,
            goalIdentifier,
            goalIdentifier,
          )
          .map((row) => decodeAuditEvent(row)),
      );
      return Object.freeze({
        goalId: goalIdentifier,
        throughSequence: watermark,
        events,
      });
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
    const hasRepair = this.hasTable('repair_context_manifest_extensions');
    const hasProtected = this.hasTable('protected_context_manifest_extensions');
    const hasProjectRead = this.hasTable('project_read_context_manifest_extensions');
    const row =
      hasRepair || hasProtected || hasProjectRead
        ? this.#database
            .prepare(
              `SELECT context.*,
                    repair.logical_schema_version,
                    repair.repair_context_digest,
                    repair.prior_attempt_feedback_digest,
                    protected.logical_schema_version AS protected_logical_schema_version,
                    protected.verification_plan_id,
                    protected.verification_plan_digest,
                    project_read.logical_schema_version AS project_read_logical_schema_version,
                    project_read.project_read_authority_id,
                    project_read.project_read_authority_record_digest,
                    project_read.source_tree_projection_digest AS project_read_source_tree_projection_digest,
                    project_read.git_state_projection_digest AS project_read_git_state_projection_digest,
                    project_read.verification_plan_id AS project_read_verification_plan_id,
                    project_read.verification_plan_digest AS project_read_verification_plan_digest
               FROM context_manifests AS context
               ${hasRepair ? 'LEFT JOIN repair_context_manifest_extensions AS repair ON repair.context_manifest_id = context.id' : 'LEFT JOIN (SELECT NULL AS context_manifest_id, NULL AS logical_schema_version, NULL AS repair_context_digest, NULL AS prior_attempt_feedback_digest) AS repair ON 0'}
               ${hasProtected ? 'LEFT JOIN protected_context_manifest_extensions AS protected ON protected.context_manifest_id = context.id' : 'LEFT JOIN (SELECT NULL AS context_manifest_id, NULL AS logical_schema_version, NULL AS verification_plan_id, NULL AS verification_plan_digest) AS protected ON 0'}
               ${hasProjectRead ? 'LEFT JOIN project_read_context_manifest_extensions AS project_read ON project_read.context_manifest_id = context.id' : 'LEFT JOIN (SELECT NULL AS context_manifest_id, NULL AS logical_schema_version, NULL AS project_read_authority_id, NULL AS project_read_authority_record_digest, NULL AS source_tree_projection_digest, NULL AS git_state_projection_digest, NULL AS verification_plan_id, NULL AS verification_plan_digest) AS project_read ON 0'}
              WHERE context.id = ?`,
            )
            .get(manifestIdentifier)
        : this.#database
            .prepare('SELECT * FROM context_manifests WHERE id = ?')
            .get(manifestIdentifier);
    return row === undefined ? undefined : this.decodeVerifiedContextManifestRow(row);
  }

  public getProjectSourceReadAuthority(
    rawProjectReadAuthorityIdentifier: ProjectSourceReadAuthorityId,
  ): ProjectSourceReadAuthorityRecord | undefined {
    this.assertOpen();
    const identifier = projectSourceReadAuthorityId(rawProjectReadAuthorityIdentifier);
    if (!this.hasTable('project_source_read_authorities')) {
      return undefined;
    }
    const row = this.#database
      .prepare('SELECT * FROM project_source_read_authorities WHERE id = ?')
      .get(identifier);
    if (row === undefined) {
      return undefined;
    }
    const retainedAuditSequence = projectReadAuditSequenceRowSchema.parse(row).audit_sequence;
    const record = decodeProjectSourceReadAuthorityRow(row);
    const { projectionDigest: sourceTreeDigest, ...sourceTree } = record.sourceTree;
    const { projectionDigest: gitStateDigest, ...gitState } = record.gitState;
    const { recordDigest, ...semanticRecord } = record;
    if (
      sourceTreeDigest !==
        sha256Digest(
          canonicalAuthorityDigests.digest(projectReadSourceTreeProjection(sourceTree)),
        ) ||
      gitStateDigest !==
        sha256Digest(canonicalAuthorityDigests.digest(projectReadGitStateProjection(gitState))) ||
      recordDigest !==
        sha256Digest(
          canonicalAuthorityDigests.digest(
            projectSourceReadAuthorityProjection(Object.freeze(semanticRecord)),
          ),
        )
    ) {
      throw new StoreInvariantError(
        `Project-source read authority ${record.id} has a false canonical digest`,
      );
    }
    const goal = this.getGoal(record.goalId);
    const workflow = this.getWorkflow(record.workflowId);
    const attempt = this.getAttempt(record.attemptId);
    const policy = this.getPolicyBundle(record.policyBundleId)?.bundle;
    const profile = this.getExecutionProfile(record.executionProfileId)?.profile;
    const startAudit =
      attempt === undefined
        ? undefined
        : this.listAuditEvents('ATTEMPT', attempt.id).find(
            (audit) => audit.eventType === 'ATTEMPT_STARTED',
          );
    const authorityAudits = this.listAuditEvents('PROJECT_SOURCE_READ_AUTHORITY', record.id).filter(
      (audit) => audit.eventType === 'PROJECT_SOURCE_READ_AUTHORITY_RECORDED',
    );
    const authorityAudit = authorityAudits[0];
    if (
      goal?.revision !== record.goalRevision ||
      goal.scope.projectPath !== record.normalizedProjectRoot ||
      workflow?.goalId !== record.goalId ||
      workflow.goalRevision !== record.goalRevision ||
      workflow.version < record.workflowVersion ||
      attempt?.workflowId !== record.workflowId ||
      attempt.phase !== record.phase ||
      attempt.contextManifestId === undefined ||
      attempt.startedAt < record.issuedAt ||
      policy?.version !== record.policyBundleVersion ||
      policy.digest !== record.policyBundleDigest ||
      profile?.version !== record.executionProfileVersion ||
      profile.digest !== record.executionProfileDigest ||
      authorityAudits.length !== 1 ||
      authorityAudit?.sequence !== retainedAuditSequence ||
      authorityAudit.actorType !== 'RUNTIME' ||
      authorityAudit.commandId === undefined ||
      authorityAudit.commandId !== startAudit?.commandId ||
      authorityAudit.payloadDigest !== record.recordDigest ||
      authorityAudit.occurredAt !== attempt.startedAt
    ) {
      throw new StoreInvariantError(
        `Project-source read authority ${record.id} has incomplete retained authority`,
      );
    }
    return record;
  }

  public captureProjectReadWorkspaceAuthoritySnapshot(
    rawInput: CaptureProjectReadWorkspaceAuthoritySnapshot,
  ): ProjectReadWorkspaceAuthoritySnapshotStoreResult {
    this.assertOpen();
    const input = Object.freeze({
      ...rawInput,
      id: projectReadWorkspaceAuthoritySnapshotId(rawInput.id),
      issuedAt: isoTimestamp(rawInput.issuedAt),
      auditEventId: auditEventId(rawInput.auditEventId),
    });
    return this.runImmediate(() => {
      const existing = this.getProjectReadWorkspaceAuthoritySnapshot(input.id);
      if (existing !== undefined) {
        return existing.issuedAt === input.issuedAt
          ? { status: 'EXISTING', value: existing }
          : {
              status: 'SNAPSHOT_CONFLICT',
              message: `Project-read authority snapshot ${input.id} already has different authority`,
            };
      }

      const latestSnapshotRow = this.#database
        .prepare(
          `SELECT issued_at FROM project_read_workspace_authority_snapshots
            ORDER BY authority_sequence DESC LIMIT 1`,
        )
        .get();
      const latestIssuedAt = z
        .object({ issued_at: z.string() })
        .optional()
        .parse(latestSnapshotRow)?.issued_at;
      if (latestIssuedAt !== undefined && input.issuedAt < latestIssuedAt) {
        throw new StoreInvariantError(
          'Project-read authority snapshot time cannot move behind retained authority',
        );
      }

      const authoritySequence = auditSequenceWatermarkRowSchema.parse(
        this.#database
          .prepare('SELECT coalesce(max(sequence), 0) + 1 AS through_sequence FROM audit_events')
          .get(),
      ).through_sequence;
      const records = this.#database
        .prepare('SELECT id FROM project_source_read_authorities ORDER BY snapshot_id')
        .all()
        .map((row) => projectSourceReadAuthorityId(z.object({ id: z.string() }).parse(row).id))
        .map((id) => {
          const record = this.getProjectSourceReadAuthority(id);
          if (record === undefined) {
            throw new StoreInvariantError('Project-read authority changed while taking a snapshot');
          }
          return record;
        });
      const expectedSnapshots = records.map((record) => {
        const attempt = this.getAttempt(record.attemptId);
        if (attempt === undefined || input.issuedAt < record.issuedAt) {
          throw new StoreInvariantError(
            `Project-read authority ${record.id} has no current Attempt/time basis`,
          );
        }
        return Object.freeze({
          attemptId: record.attemptId,
          authorityRecordDigest: record.recordDigest,
          ownershipMarkerDigest: record.ownershipMarkerDigest,
          ownershipMarkerProfile: record.ownershipMarkerProfile,
          projectReadAuthorityId: record.id,
          retention:
            attempt.status === AttemptStatus.RUNNING
              ? ProjectReadWorkspaceRetention.CURRENT
              : ProjectReadWorkspaceRetention.RETAINED,
          snapshotId: record.snapshotId,
          snapshotLeafRealpath: record.snapshotLeafRealpath,
          workspaceRootIdentity: record.workspaceRootIdentity,
        });
      });
      const activeConsumers = records.flatMap((record) => {
        const execution = this.getExternalExecutionForAttempt(record.attemptId);
        if (
          execution === undefined ||
          execution.state === ExternalExecutionState.COMPLETED ||
          execution.state === ExternalExecutionState.INTERRUPTED ||
          execution.state === ExternalExecutionState.FAILED ||
          execution.state === ExternalExecutionState.ABANDONED
        ) {
          return [];
        }
        if (input.issuedAt < execution.updatedAt) {
          throw new StoreInvariantError(
            `Project-read consumer ${execution.id} is newer than the requested snapshot`,
          );
        }
        return [
          Object.freeze({
            attemptId: record.attemptId,
            externalExecutionId: execution.id,
            projectReadAuthorityId: record.id,
            snapshotId: record.snapshotId,
          }),
        ];
      });
      const withoutDigest = Object.freeze({
        activeConsumers: Object.freeze(
          activeConsumers.sort((left, right) =>
            left.externalExecutionId.localeCompare(right.externalExecutionId),
          ),
        ),
        authoritySequence,
        expectedSnapshots: Object.freeze(expectedSnapshots),
        id: input.id,
        issuedAt: input.issuedAt,
        schemaVersion: 1 as const,
      });
      const snapshot = decodeProjectReadWorkspaceAuthoritySnapshot({
        ...withoutDigest,
        authorityDigest: digestProjectReadWorkspaceValue(
          projectReadWorkspaceAuthoritySnapshotProjection(withoutDigest),
        ),
      });
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'PROJECT_READ_WORKSPACE_AUTHORITY_SNAPSHOT',
        aggregateId: snapshot.id,
        eventType: 'PROJECT_READ_WORKSPACE_AUTHORITY_SNAPSHOT_ISSUED',
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: snapshot.authorityDigest,
        occurredAt: snapshot.issuedAt,
      });
      if (this.auditSequence(input.auditEventId) !== authoritySequence) {
        throw new StoreInvariantError('Project-read authority snapshot sequence changed');
      }
      this.probe(ProjectReadCleanupTransactionStep.AFTER_AUTHORITY_SNAPSHOT_AUDIT_WRITE);
      this.#database
        .prepare(
          `INSERT INTO project_read_workspace_authority_snapshots(
             id, schema_version, authority_sequence, issued_at, canonical_json,
             authority_digest, audit_sequence
           ) VALUES (?, 1, ?, ?, ?, ?, ?)`,
        )
        .run(
          snapshot.id,
          snapshot.authoritySequence,
          snapshot.issuedAt,
          serializeJson(decodeJsonValue(snapshot)),
          snapshot.authorityDigest,
          authoritySequence,
        );
      this.probe(ProjectReadCleanupTransactionStep.AFTER_AUTHORITY_SNAPSHOT_WRITE);
      const persisted = this.getProjectReadWorkspaceAuthoritySnapshot(snapshot.id);
      if (persisted === undefined || !sameCanonicalAuthority(persisted, snapshot)) {
        throw new StoreInvariantError('Project-read authority snapshot was not retained exactly');
      }
      this.probe(ProjectReadCleanupTransactionStep.BEFORE_COMMIT);
      return { status: 'ISSUED', value: persisted };
    });
  }

  public getProjectReadWorkspaceAuthoritySnapshot(
    rawId: ProjectReadWorkspaceAuthoritySnapshotId,
  ): ProjectReadWorkspaceAuthoritySnapshot | undefined {
    this.assertOpen();
    const id = projectReadWorkspaceAuthoritySnapshotId(rawId);
    if (!this.hasTable('project_read_workspace_authority_snapshots')) {
      return undefined;
    }
    const row = this.#database
      .prepare('SELECT * FROM project_read_workspace_authority_snapshots WHERE id = ?')
      .get(id);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z
      .object({
        schema_version: z.literal(1),
        authority_sequence: z.number().int().positive(),
        issued_at: z.string(),
        authority_digest: z.string(),
        audit_sequence: z.number().int().positive(),
        canonical_json: z.string(),
      })
      .parse(row);
    const snapshot = decodeProjectReadWorkspaceAuthoritySnapshot(
      parseJson(parsed.canonical_json, 'project-read workspace authority snapshot'),
    );
    if (
      snapshot.id !== id ||
      snapshot.authoritySequence !== parsed.authority_sequence ||
      snapshot.issuedAt !== parsed.issued_at ||
      snapshot.authorityDigest !== parsed.authority_digest ||
      parsed.audit_sequence !== parsed.authority_sequence
    ) {
      throw new StoreInvariantError(`Project-read authority snapshot ${id} changed columns`);
    }
    this.assertProjectReadCleanupAudit(
      parsed.audit_sequence,
      'PROJECT_READ_WORKSPACE_AUTHORITY_SNAPSHOT',
      snapshot.id,
      'PROJECT_READ_WORKSPACE_AUTHORITY_SNAPSHOT_ISSUED',
      snapshot.authorityDigest,
      snapshot.issuedAt,
    );
    const retainedAuthorityIds = z
      .array(z.object({ id: z.string() }))
      .parse(
        this.#database
          .prepare(
            `SELECT id FROM project_source_read_authorities
              WHERE audit_sequence < ? ORDER BY snapshot_id`,
          )
          .all(snapshot.authoritySequence),
      )
      .map((row) => projectSourceReadAuthorityId(row.id));
    if (
      !sameCanonicalAuthority(
        retainedAuthorityIds,
        snapshot.expectedSnapshots.map((entry) => entry.projectReadAuthorityId),
      )
    ) {
      throw new StoreInvariantError(
        `Project-read authority snapshot ${id} omitted or added retained authority`,
      );
    }
    const expectedActiveConsumers: ProjectReadWorkspaceAuthoritySnapshot['activeConsumers'][number][] =
      [];
    for (const expected of snapshot.expectedSnapshots) {
      const record = this.getProjectSourceReadAuthority(expected.projectReadAuthorityId);
      const attempt = this.getAttempt(expected.attemptId);
      const terminalAttemptAudit = this.listAuditEvents('ATTEMPT', expected.attemptId).find(
        (audit) =>
          audit.eventType === 'ATTEMPT_FINISHED' ||
          audit.eventType === 'ATTEMPT_INTERRUPTED_BY_WORKFLOW_CANCELLATION',
      );
      const historicalRetention =
        terminalAttemptAudit !== undefined &&
        terminalAttemptAudit.sequence < snapshot.authoritySequence
          ? ProjectReadWorkspaceRetention.RETAINED
          : ProjectReadWorkspaceRetention.CURRENT;
      if (
        record?.attemptId !== expected.attemptId ||
        record.recordDigest !== expected.authorityRecordDigest ||
        record.snapshotId !== expected.snapshotId ||
        record.workspaceRootIdentity !== expected.workspaceRootIdentity ||
        record.snapshotLeafRealpath !== expected.snapshotLeafRealpath ||
        record.ownershipMarkerDigest !== expected.ownershipMarkerDigest ||
        attempt === undefined ||
        expected.retention !== historicalRetention
      ) {
        throw new StoreInvariantError(
          `Project-read authority snapshot ${id} substituted retained source authority`,
        );
      }
      const execution = this.getExternalExecutionForAttempt(expected.attemptId);
      if (execution !== undefined) {
        const authorizedAudit = this.listAuditEvents('EXTERNAL_EXECUTION', execution.id).find(
          (audit) => audit.eventType === 'EXTERNAL_EXECUTION_AUTHORIZED',
        );
        const terminal =
          execution.state === ExternalExecutionState.COMPLETED ||
          execution.state === ExternalExecutionState.INTERRUPTED ||
          execution.state === ExternalExecutionState.FAILED ||
          execution.state === ExternalExecutionState.ABANDONED;
        if (
          authorizedAudit !== undefined &&
          authorizedAudit.sequence < snapshot.authoritySequence &&
          (!terminal || execution.auditSequence > snapshot.authoritySequence)
        ) {
          expectedActiveConsumers.push(
            Object.freeze({
              attemptId: expected.attemptId,
              externalExecutionId: execution.id,
              projectReadAuthorityId: expected.projectReadAuthorityId,
              snapshotId: expected.snapshotId,
            }),
          );
        }
      }
    }
    expectedActiveConsumers.sort((left, right) =>
      left.externalExecutionId.localeCompare(right.externalExecutionId),
    );
    if (!sameCanonicalAuthority(expectedActiveConsumers, snapshot.activeConsumers)) {
      throw new StoreInvariantError(
        `Project-read authority snapshot ${id} substituted active external consumers`,
      );
    }
    return snapshot;
  }

  public recordProjectReadWorkspaceObservation(
    rawInput: RecordProjectReadWorkspaceObservation,
  ): ProjectReadWorkspaceObservationStoreResult {
    this.assertOpen();
    const observation = decodeProjectReadWorkspaceObservation(rawInput.observation);
    const auditIdentifier = auditEventId(rawInput.auditEventId);
    return this.runImmediate(() => {
      const duplicateRow = this.#database
        .prepare(
          `SELECT id FROM project_read_workspace_observations
            WHERE id = ? OR observation_digest = ?`,
        )
        .get(observation.id, observation.observationDigest);
      if (duplicateRow !== undefined) {
        const duplicateId = projectReadWorkspaceObservationId(
          z.object({ id: z.string() }).parse(duplicateRow).id,
        );
        const existing = this.getProjectReadWorkspaceObservation(duplicateId);
        return existing !== undefined && sameCanonicalAuthority(existing, observation)
          ? { status: 'EXISTING', value: existing }
          : {
              status: 'OBSERVATION_CONFLICT',
              message: `Project-read workspace observation ${observation.id} conflicts with retained authority`,
            };
      }
      const snapshot = this.getProjectReadWorkspaceAuthoritySnapshot(
        observation.authoritySnapshotId,
      );
      if (snapshot === undefined) {
        return {
          status: 'OBSERVATION_CONFLICT',
          message: `Project-read workspace observation ${observation.id} has no authority snapshot`,
        };
      }
      try {
        assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(observation, snapshot);
        if (observation.observedAt < snapshot.issuedAt) {
          throw new TypeError('Project-read workspace observation predates its authority snapshot');
        }
      } catch (error) {
        return {
          status: 'OBSERVATION_CONFLICT',
          message: error instanceof Error ? error.message : 'Workspace observation is not eligible',
        };
      }
      this.insertAuditEvent({
        id: auditIdentifier,
        aggregateType: 'PROJECT_READ_WORKSPACE_OBSERVATION',
        aggregateId: observation.id,
        eventType: 'PROJECT_READ_WORKSPACE_OBSERVATION_RECORDED',
        ...(rawInput.correlationId === undefined ? {} : { correlationId: rawInput.correlationId }),
        ...(rawInput.causationId === undefined ? {} : { causationId: rawInput.causationId }),
        payloadDigest: observation.observationDigest,
        occurredAt: observation.observedAt,
      });
      this.probe(ProjectReadCleanupTransactionStep.AFTER_WORKSPACE_OBSERVATION_AUDIT_WRITE);
      const auditSequence = this.auditSequence(auditIdentifier);
      this.#database
        .prepare(
          `INSERT INTO project_read_workspace_observations(
             id, schema_version, authority_snapshot_id, authority_snapshot_digest,
             authority_sequence, classification, project_read_authority_id, snapshot_id,
             workspace_root_identity, snapshot_leaf_realpath, observed_at, canonical_json,
             observation_digest, audit_sequence
           ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          observation.id,
          observation.authoritySnapshotId,
          observation.authoritySnapshotDigest,
          observation.authoritySequence,
          observation.classification,
          observation.projectReadAuthorityId,
          observation.snapshotId,
          observation.workspaceRootIdentity,
          observation.snapshotLeafRealpath,
          observation.observedAt,
          serializeJson(decodeJsonValue(observation)),
          observation.observationDigest,
          auditSequence,
        );
      this.probe(ProjectReadCleanupTransactionStep.AFTER_WORKSPACE_OBSERVATION_WRITE);
      const persisted = this.getProjectReadWorkspaceObservation(observation.id);
      if (persisted === undefined || !sameCanonicalAuthority(persisted, observation)) {
        throw new StoreInvariantError(
          'Project-read workspace observation was not retained exactly',
        );
      }
      this.probe(ProjectReadCleanupTransactionStep.BEFORE_COMMIT);
      return { status: 'RECORDED', value: persisted };
    });
  }

  public getProjectReadWorkspaceObservation(
    rawId: ProjectReadWorkspaceObservationId,
  ): ProjectReadWorkspaceObservation | undefined {
    this.assertOpen();
    const id = projectReadWorkspaceObservationId(rawId);
    if (!this.hasTable('project_read_workspace_observations')) {
      return undefined;
    }
    const row = this.#database
      .prepare('SELECT * FROM project_read_workspace_observations WHERE id = ?')
      .get(id);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z
      .object({
        schema_version: z.literal(1),
        authority_snapshot_id: z.string(),
        authority_snapshot_digest: z.string(),
        authority_sequence: z.number().int().positive(),
        classification: z.string(),
        project_read_authority_id: z.string().nullable(),
        snapshot_id: z.string().nullable(),
        workspace_root_identity: z.string(),
        snapshot_leaf_realpath: z.string(),
        observed_at: z.string(),
        canonical_json: z.string(),
        observation_digest: z.string(),
        audit_sequence: z.number().int().positive(),
      })
      .parse(row);
    const observation = decodeProjectReadWorkspaceObservation(
      parseJson(parsed.canonical_json, 'project-read workspace observation'),
    );
    if (
      observation.id !== id ||
      observation.authoritySnapshotId !== parsed.authority_snapshot_id ||
      observation.authoritySnapshotDigest !== parsed.authority_snapshot_digest ||
      observation.authoritySequence !== parsed.authority_sequence ||
      observation.classification !== parsed.classification ||
      observation.projectReadAuthorityId !== parsed.project_read_authority_id ||
      observation.snapshotId !== parsed.snapshot_id ||
      observation.workspaceRootIdentity !== parsed.workspace_root_identity ||
      observation.snapshotLeafRealpath !== parsed.snapshot_leaf_realpath ||
      observation.observedAt !== parsed.observed_at ||
      observation.observationDigest !== parsed.observation_digest
    ) {
      throw new StoreInvariantError(`Project-read workspace observation ${id} changed columns`);
    }
    const snapshot = this.getProjectReadWorkspaceAuthoritySnapshot(observation.authoritySnapshotId);
    if (snapshot === undefined) {
      throw new StoreInvariantError(`Project-read workspace observation ${id} lost its snapshot`);
    }
    assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(observation, snapshot);
    if (observation.observedAt < snapshot.issuedAt) {
      throw new StoreInvariantError(
        `Project-read workspace observation ${id} predates its authority snapshot`,
      );
    }
    this.assertProjectReadCleanupAudit(
      parsed.audit_sequence,
      'PROJECT_READ_WORKSPACE_OBSERVATION',
      observation.id,
      'PROJECT_READ_WORKSPACE_OBSERVATION_RECORDED',
      observation.observationDigest,
      observation.observedAt,
    );
    return observation;
  }

  public issueProjectReadSnapshotCleanupGrant(
    rawInput: IssueProjectReadSnapshotCleanupGrant,
  ): ProjectReadSnapshotCleanupGrantStoreResult {
    this.assertOpen();
    const grant = decodeProjectReadSnapshotCleanupGrant(rawInput.grant, {
      digest: digestProjectReadSnapshotCleanupValue,
    });
    const auditIdentifier = auditEventId(rawInput.auditEventId);
    return this.runImmediate(() => {
      const duplicateRow = this.#database
        .prepare(
          `SELECT id FROM project_read_snapshot_cleanup_grants
            WHERE id = ? OR grant_digest = ? OR project_read_authority_id = ?
               OR snapshot_id = ? OR snapshot_leaf_realpath = ?`,
        )
        .get(
          grant.id,
          grant.grantDigest,
          grant.projectReadAuthorityId,
          grant.snapshotId,
          grant.snapshotLeafRealpath,
        );
      if (duplicateRow !== undefined) {
        const duplicateId = projectReadSnapshotCleanupGrantId(
          z.object({ id: z.string() }).parse(duplicateRow).id,
        );
        const existing = this.getProjectReadSnapshotCleanupGrant(duplicateId);
        return existing !== undefined && sameCanonicalAuthority(existing, grant)
          ? { status: 'EXISTING', value: existing }
          : {
              status: 'GRANT_CONFLICT',
              message: `Project-read cleanup Grant ${grant.id} conflicts with retained authority`,
            };
      }
      const snapshot = this.getProjectReadWorkspaceAuthoritySnapshot(grant.authoritySnapshotId);
      if (snapshot === undefined) {
        return {
          status: 'NOT_ELIGIBLE',
          message: `Project-read cleanup Grant ${grant.id} has no authority snapshot`,
        };
      }
      try {
        this.assertProjectReadCleanupGrantEligibility(grant, snapshot);
      } catch (error) {
        return {
          status: 'NOT_ELIGIBLE',
          message: error instanceof Error ? error.message : 'Cleanup Grant is not eligible',
        };
      }
      this.insertAuditEvent({
        id: auditIdentifier,
        aggregateType: 'PROJECT_READ_SNAPSHOT_CLEANUP_GRANT',
        aggregateId: grant.id,
        eventType: 'PROJECT_READ_SNAPSHOT_CLEANUP_GRANT_ISSUED',
        ...(rawInput.correlationId === undefined ? {} : { correlationId: rawInput.correlationId }),
        ...(rawInput.causationId === undefined ? {} : { causationId: rawInput.causationId }),
        payloadDigest: grant.grantDigest,
        occurredAt: grant.issuedAt,
      });
      this.probe(ProjectReadCleanupTransactionStep.AFTER_CLEANUP_GRANT_AUDIT_WRITE);
      const auditSequence = this.auditSequence(auditIdentifier);
      this.#database
        .prepare(
          `INSERT INTO project_read_snapshot_cleanup_grants(
             id, schema_version, eligibility_kind, authority_snapshot_id,
             authority_snapshot_digest, authority_sequence, project_read_authority_id,
             snapshot_id, workspace_root_identity, snapshot_leaf_realpath, issued_at,
             workspace_observation_id, workspace_observation_digest, attempt_id,
             external_execution_id, canonical_json, grant_digest, audit_sequence
           ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          grant.id,
          grant.eligibilityKind,
          grant.authoritySnapshotId,
          grant.authoritySnapshotDigest,
          grant.authoritySequence,
          grant.projectReadAuthorityId,
          grant.snapshotId,
          grant.workspaceRootIdentity,
          grant.snapshotLeafRealpath,
          grant.issuedAt,
          grant.eligibilityKind === 'ORPHANED' ? grant.workspaceObservationId : null,
          grant.eligibilityKind === 'ORPHANED' ? grant.workspaceObservationDigest : null,
          grant.eligibilityKind === 'TERMINAL' ? grant.attemptId : null,
          grant.eligibilityKind === 'TERMINAL' ? grant.externalExecutionId : null,
          serializeJson(decodeJsonValue(grant)),
          grant.grantDigest,
          auditSequence,
        );
      this.probe(ProjectReadCleanupTransactionStep.AFTER_CLEANUP_GRANT_WRITE);
      const persisted = this.getProjectReadSnapshotCleanupGrant(grant.id);
      if (persisted === undefined || !sameCanonicalAuthority(persisted, grant)) {
        throw new StoreInvariantError('Project-read cleanup Grant was not retained exactly');
      }
      this.probe(ProjectReadCleanupTransactionStep.BEFORE_COMMIT);
      return { status: 'ISSUED', value: persisted };
    });
  }

  public getProjectReadSnapshotCleanupGrant(
    rawId: ProjectReadSnapshotCleanupGrantId,
  ): ProjectReadSnapshotCleanupGrant | undefined {
    this.assertOpen();
    const id = projectReadSnapshotCleanupGrantId(rawId);
    if (!this.hasTable('project_read_snapshot_cleanup_grants')) {
      return undefined;
    }
    const row = this.#database
      .prepare('SELECT * FROM project_read_snapshot_cleanup_grants WHERE id = ?')
      .get(id);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z
      .object({
        schema_version: z.literal(1),
        eligibility_kind: z.enum(['TERMINAL', 'ORPHANED']),
        authority_snapshot_id: z.string(),
        authority_snapshot_digest: z.string(),
        authority_sequence: z.number().int().positive(),
        project_read_authority_id: z.string(),
        snapshot_id: z.string(),
        workspace_root_identity: z.string(),
        snapshot_leaf_realpath: z.string(),
        issued_at: z.string(),
        workspace_observation_id: z.string().nullable(),
        workspace_observation_digest: z.string().nullable(),
        attempt_id: z.string().nullable(),
        external_execution_id: z.string().nullable(),
        grant_digest: z.string(),
        audit_sequence: z.number().int().positive(),
        canonical_json: z.string(),
      })
      .parse(row);
    const grant = decodeProjectReadSnapshotCleanupGrant(
      parseJson(parsed.canonical_json, 'project-read cleanup Grant'),
      { digest: digestProjectReadSnapshotCleanupValue },
    );
    if (
      grant.id !== id ||
      grant.eligibilityKind !== parsed.eligibility_kind ||
      grant.authoritySnapshotId !== parsed.authority_snapshot_id ||
      grant.authoritySnapshotDigest !== parsed.authority_snapshot_digest ||
      grant.authoritySequence !== parsed.authority_sequence ||
      grant.projectReadAuthorityId !== parsed.project_read_authority_id ||
      grant.snapshotId !== parsed.snapshot_id ||
      grant.workspaceRootIdentity !== parsed.workspace_root_identity ||
      grant.snapshotLeafRealpath !== parsed.snapshot_leaf_realpath ||
      grant.issuedAt !== parsed.issued_at ||
      (grant.eligibilityKind === 'ORPHANED'
        ? grant.workspaceObservationId !== parsed.workspace_observation_id ||
          grant.workspaceObservationDigest !== parsed.workspace_observation_digest ||
          parsed.attempt_id !== null ||
          parsed.external_execution_id !== null
        : grant.attemptId !== parsed.attempt_id ||
          grant.externalExecutionId !== parsed.external_execution_id ||
          parsed.workspace_observation_id !== null ||
          parsed.workspace_observation_digest !== null) ||
      grant.grantDigest !== parsed.grant_digest
    ) {
      throw new StoreInvariantError(`Project-read cleanup Grant ${id} changed columns`);
    }
    const snapshot = this.getProjectReadWorkspaceAuthoritySnapshot(grant.authoritySnapshotId);
    if (snapshot === undefined) {
      throw new StoreInvariantError(`Project-read cleanup Grant ${id} lost its snapshot`);
    }
    this.assertProjectReadCleanupGrantEligibility(grant, snapshot);
    this.assertProjectReadCleanupAudit(
      parsed.audit_sequence,
      'PROJECT_READ_SNAPSHOT_CLEANUP_GRANT',
      grant.id,
      'PROJECT_READ_SNAPSHOT_CLEANUP_GRANT_ISSUED',
      grant.grantDigest,
      grant.issuedAt,
    );
    return grant;
  }

  public getProjectReadSnapshotCleanupOutcome(
    rawGrantId: ProjectReadSnapshotCleanupGrantId,
  ): ProjectReadSnapshotCleanupOutcome | undefined {
    this.assertOpen();
    const grantId = projectReadSnapshotCleanupGrantId(rawGrantId);
    if (!this.hasTable('project_read_snapshot_cleanup_outcomes')) {
      return undefined;
    }
    const row = this.#database
      .prepare('SELECT * FROM project_read_snapshot_cleanup_outcomes WHERE grant_id = ?')
      .get(grantId);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z
      .object({
        schema_version: z.literal(1),
        grant_id: z.string(),
        grant_digest: z.string(),
        cleanup_observation_id: z.string(),
        cleanup_observation_digest: z.string(),
        disposition: z.string(),
        resolved_at: z.string(),
        outcome_digest: z.string(),
        audit_sequence: z.number().int().positive(),
        canonical_json: z.string(),
      })
      .parse(row);
    const outcome = decodeProjectReadSnapshotCleanupOutcome(
      parseJson(parsed.canonical_json, 'project-read cleanup Outcome'),
      { digest: digestProjectReadSnapshotCleanupValue },
    );
    const grant = this.getProjectReadSnapshotCleanupGrant(grantId);
    const observation = this.getProjectReadSnapshotCleanupObservationInsideTransaction(
      parsed.cleanup_observation_id,
    );
    const consumption = this.#database
      .prepare(
        `SELECT grant_digest, outcome_id, outcome_digest, consumed_at, outcome_audit_sequence
           FROM project_read_snapshot_cleanup_consumptions WHERE grant_id = ?`,
      )
      .get(grantId);
    const retainedConsumption = z
      .object({
        grant_digest: z.string(),
        outcome_id: z.string(),
        outcome_digest: z.string(),
        consumed_at: z.string(),
        outcome_audit_sequence: z.number().int().positive(),
      })
      .parse(consumption);
    if (
      grant === undefined ||
      observation === undefined ||
      outcome.grantId !== grantId ||
      outcome.grantId !== parsed.grant_id ||
      outcome.grantDigest !== parsed.grant_digest ||
      outcome.cleanupObservationId !== parsed.cleanup_observation_id ||
      outcome.cleanupObservationDigest !== parsed.cleanup_observation_digest ||
      outcome.disposition !== parsed.disposition ||
      outcome.resolvedAt !== parsed.resolved_at ||
      outcome.outcomeDigest !== parsed.outcome_digest ||
      retainedConsumption.grant_digest !== grant.grantDigest ||
      retainedConsumption.outcome_id !== outcome.id ||
      retainedConsumption.outcome_digest !== outcome.outcomeDigest ||
      retainedConsumption.consumed_at !== outcome.resolvedAt ||
      retainedConsumption.outcome_audit_sequence !== parsed.audit_sequence
    ) {
      throw new StoreInvariantError(`Project-read cleanup Outcome for ${grantId} is incomplete`);
    }
    assertProjectReadSnapshotCleanupOutcomeClosure(outcome, observation, grant);
    this.assertProjectReadCleanupAudit(
      parsed.audit_sequence,
      'PROJECT_READ_SNAPSHOT_CLEANUP_OUTCOME',
      outcome.id,
      'PROJECT_READ_SNAPSHOT_CLEANUP_RESOLVED',
      outcome.outcomeDigest,
      outcome.resolvedAt,
    );
    return outcome;
  }

  public resolveProjectReadSnapshotCleanupGrant(
    rawInput: ResolveProjectReadSnapshotCleanupGrant,
  ): ProjectReadSnapshotCleanupResolutionStoreResult {
    this.assertOpen();
    const grantId = projectReadSnapshotCleanupGrantId(rawInput.grantId);
    const grantDigest = sha256Digest(rawInput.grantDigest);
    const observationAuditEventId = auditEventId(rawInput.observationAuditEventId);
    const outcomeAuditEventId = auditEventId(rawInput.outcomeAuditEventId);
    return this.runImmediate(() => {
      const grant = this.getProjectReadSnapshotCleanupGrant(grantId);
      if (grant?.grantDigest !== grantDigest) {
        return {
          status: 'GRANT_CONFLICT',
          message: `Project-read cleanup Grant ${grantId} is missing or has different authority`,
        };
      }
      const retained = this.getProjectReadSnapshotCleanupOutcome(grantId);
      if (retained !== undefined) {
        return { status: 'REPLAYED', value: retained };
      }
      const observation = decodeProjectReadSnapshotCleanupObservation(rawInput.observation);
      const outcome = decodeProjectReadSnapshotCleanupOutcome(rawInput.outcome, {
        digest: digestProjectReadSnapshotCleanupValue,
      });
      try {
        assertProjectReadSnapshotCleanupOutcomeClosure(outcome, observation, grant);
      } catch (error) {
        return {
          status: 'RESOLUTION_CONFLICT',
          message: error instanceof Error ? error.message : 'Cleanup Outcome is not exact',
        };
      }
      const collision = this.#database
        .prepare(
          `SELECT 1 FROM project_read_snapshot_cleanup_observations
            WHERE id = ? OR observation_digest = ?
           UNION ALL
           SELECT 1 FROM project_read_snapshot_cleanup_outcomes
            WHERE id = ? OR outcome_digest = ?
           LIMIT 1`,
        )
        .get(observation.id, observation.observationDigest, outcome.id, outcome.outcomeDigest);
      if (collision !== undefined) {
        return {
          status: 'RESOLUTION_CONFLICT',
          message: `Project-read cleanup resolution for ${grantId} conflicts with retained identity`,
        };
      }
      this.insertAuditEvent({
        id: observationAuditEventId,
        aggregateType: 'PROJECT_READ_SNAPSHOT_CLEANUP_OBSERVATION',
        aggregateId: observation.id,
        eventType: 'PROJECT_READ_SNAPSHOT_CLEANUP_OBSERVED',
        ...(rawInput.correlationId === undefined ? {} : { correlationId: rawInput.correlationId }),
        ...(rawInput.causationId === undefined ? {} : { causationId: rawInput.causationId }),
        payloadDigest: observation.observationDigest,
        occurredAt: observation.observedAt,
      });
      this.probe(ProjectReadCleanupTransactionStep.AFTER_CLEANUP_OBSERVATION_AUDIT_WRITE);
      const observationAuditSequence = this.auditSequence(observationAuditEventId);
      this.#database
        .prepare(
          `INSERT INTO project_read_snapshot_cleanup_observations(
             id, schema_version, grant_id, grant_digest, disposition, observed_at,
             canonical_json, observation_digest, audit_sequence
           ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          observation.id,
          grant.id,
          grant.grantDigest,
          observation.disposition,
          observation.observedAt,
          serializeJson(decodeJsonValue(observation)),
          observation.observationDigest,
          observationAuditSequence,
        );
      this.probe(ProjectReadCleanupTransactionStep.AFTER_CLEANUP_OBSERVATION_WRITE);
      this.insertAuditEvent({
        id: outcomeAuditEventId,
        aggregateType: 'PROJECT_READ_SNAPSHOT_CLEANUP_OUTCOME',
        aggregateId: outcome.id,
        eventType: 'PROJECT_READ_SNAPSHOT_CLEANUP_RESOLVED',
        ...(rawInput.correlationId === undefined ? {} : { correlationId: rawInput.correlationId }),
        ...(rawInput.causationId === undefined ? {} : { causationId: rawInput.causationId }),
        payloadDigest: outcome.outcomeDigest,
        occurredAt: outcome.resolvedAt,
      });
      this.probe(ProjectReadCleanupTransactionStep.AFTER_CLEANUP_OUTCOME_AUDIT_WRITE);
      const outcomeAuditSequence = this.auditSequence(outcomeAuditEventId);
      this.#database
        .prepare(
          `INSERT INTO project_read_snapshot_cleanup_outcomes(
             id, schema_version, grant_id, grant_digest, cleanup_observation_id,
             cleanup_observation_digest, disposition, resolved_at, canonical_json,
             outcome_digest, audit_sequence
           ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          outcome.id,
          grant.id,
          grant.grantDigest,
          observation.id,
          observation.observationDigest,
          outcome.disposition,
          outcome.resolvedAt,
          serializeJson(decodeJsonValue(outcome)),
          outcome.outcomeDigest,
          outcomeAuditSequence,
        );
      this.probe(ProjectReadCleanupTransactionStep.AFTER_CLEANUP_OUTCOME_WRITE);
      this.#database
        .prepare(
          `INSERT INTO project_read_snapshot_cleanup_consumptions(
             grant_id, grant_digest, outcome_id, outcome_digest, consumed_at,
             outcome_audit_sequence
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          grant.id,
          grant.grantDigest,
          outcome.id,
          outcome.outcomeDigest,
          outcome.resolvedAt,
          outcomeAuditSequence,
        );
      this.probe(ProjectReadCleanupTransactionStep.AFTER_CLEANUP_CONSUMPTION_WRITE);
      const persisted = this.getProjectReadSnapshotCleanupOutcome(grant.id);
      if (persisted === undefined || !sameCanonicalAuthority(persisted, outcome)) {
        throw new StoreInvariantError('Project-read cleanup Outcome was not retained exactly');
      }
      this.probe(ProjectReadCleanupTransactionStep.BEFORE_COMMIT);
      return { status: 'APPLIED', value: persisted };
    });
  }

  public getAcceptanceCriticalVerificationPlan(
    rawWorkflowIdentifier: WorkflowId,
  ): AcceptanceCriticalVerificationPlan | undefined {
    this.assertOpen();
    const workflowIdentifier = workflowId(rawWorkflowIdentifier);
    if (!this.hasTable('acceptance_critical_verification_plans')) {
      return undefined;
    }
    const row = this.#database
      .prepare('SELECT * FROM acceptance_critical_verification_plans WHERE workflow_id = ?')
      .get(workflowIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const plan = decodeAcceptanceCriticalVerificationPlanRow(row);
    const { planDigest: retainedPlanDigest, ...semanticPlan } = plan;
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(
        acceptanceCriticalVerificationPlanProjection(Object.freeze(semanticPlan)),
      ),
    );
    if (retainedPlanDigest !== expectedDigest) {
      throw new StoreInvariantError(`Protected Verification Plan ${plan.id} has a false digest`);
    }
    return plan;
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

  public getEvidencePayload(
    rawDigest: Sha256Digest,
    rawByteLength: number,
  ): EvidencePayload | undefined {
    this.assertOpen();
    const digest = sha256Digest(rawDigest);
    if (!Number.isSafeInteger(rawByteLength) || rawByteLength < 0) {
      throw new StoreInvariantError('Evidence payload length is invalid');
    }
    const rawRow: unknown = this.#database
      .prepare(
        'SELECT digest, byte_length, payload_bytes FROM evidence_payloads WHERE digest = ? AND byte_length = ?',
      )
      .get(digest, rawByteLength);
    if (rawRow === undefined) {
      return undefined;
    }
    const {
      digest: storedDigest,
      byte_length: byteLength,
      payload_bytes: rawBytes,
    } = evidencePayloadRowSchema.parse(rawRow);
    const bytes = new Uint8Array(rawBytes);
    if (
      sha256Digest(storedDigest) !== digest ||
      byteLength !== rawByteLength ||
      bytes.byteLength !== byteLength ||
      digest !== sha256Digest(`sha256:${createHash('sha256').update(bytes).digest('hex')}`)
    ) {
      throw new StoreInvariantError('Stored Evidence payload has an invalid content identity');
    }
    return Object.freeze({ digest, byteLength, bytes });
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

  public getEvidenceEligibilityVersion(
    rawEvidenceIdentifier: EvidenceId,
    rawVersion: EvidenceEligibility['version'],
  ): EvidenceEligibility | undefined {
    this.assertOpen();
    const evidenceIdentifier = evidenceId(rawEvidenceIdentifier);
    if (!Number.isSafeInteger(rawVersion) || rawVersion < 1) {
      throw new StoreInvariantError('Evidence eligibility version is invalid');
    }
    const row = this.#database
      .prepare(
        `SELECT * FROM evidence_eligibility
          WHERE evidence_id = ? AND version = ?`,
      )
      .get(evidenceIdentifier, rawVersion);
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

  public getExecutionProfile(
    rawProfileIdentifier: ExecutionProfileId,
  ): InstalledExecutionProfile | undefined {
    this.assertOpen();
    const profileIdentifier = executionProfileId(rawProfileIdentifier);
    const row = this.hasTable('external_execution_profile_extensions')
      ? this.#database
          .prepare(
            `SELECT profile.*,
                    extension.logical_schema_version,
                    extension.capability_record_digest,
                    extension.external_execution_json
               FROM execution_profiles AS profile
               LEFT JOIN external_execution_profile_extensions AS extension
                 ON extension.profile_id = profile.id
              WHERE profile.id = ?`,
          )
          .get(profileIdentifier)
      : this.#database
          .prepare('SELECT * FROM execution_profiles WHERE id = ?')
          .get(profileIdentifier);
    return row === undefined ? undefined : this.decodeVerifiedExecutionProfileRow(row);
  }

  public getExternalBackendCapabilityRecord(
    rawDigest: Sha256Digest,
  ): ExternalBackendCapabilityRecord | undefined {
    this.assertOpen();
    const digest = sha256Digest(rawDigest);
    const row = this.#database
      .prepare('SELECT * FROM external_backend_capability_records WHERE record_digest = ?')
      .get(digest);
    return row === undefined ? undefined : this.decodeVerifiedExternalBackendCapabilityRow(row);
  }

  public getExternalExecution(
    rawExternalExecutionId: ExternalExecutionId,
  ): ExternalExecutionRecord | undefined {
    this.assertOpen();
    const identifier = externalExecutionId(rawExternalExecutionId);
    const row = this.#database
      .prepare('SELECT * FROM external_execution_records WHERE id = ?')
      .get(identifier);
    return row === undefined ? undefined : this.decodeVerifiedExternalExecutionRow(row);
  }

  public getExternalExecutionForAttempt(
    rawAttemptId: AttemptId,
  ): ExternalExecutionRecord | undefined {
    this.assertOpen();
    const identifier = attemptId(rawAttemptId);
    const row = this.#database
      .prepare('SELECT * FROM external_execution_records WHERE attempt_id = ?')
      .get(identifier);
    return row === undefined ? undefined : this.decodeVerifiedExternalExecutionRow(row);
  }

  public getExternalExecutionObservation(
    rawObservationId: ExternalExecutionObservationId,
  ): ExternalExecutionObservation | undefined {
    this.assertOpen();
    const identifier = externalExecutionObservationId(rawObservationId);
    const row = this.#database
      .prepare('SELECT * FROM external_execution_observations WHERE id = ?')
      .get(identifier);
    return row === undefined ? undefined : this.decodeVerifiedExternalExecutionObservationRow(row);
  }

  public getExternalMaintenanceIntent(
    rawMaintenanceIntentId: ExternalMaintenanceIntentId,
  ): ExternalMaintenanceIntent | undefined {
    this.assertOpen();
    const identifier = externalMaintenanceIntentId(rawMaintenanceIntentId);
    const row = this.#database
      .prepare('SELECT * FROM external_maintenance_intents WHERE id = ?')
      .get(identifier);
    return row === undefined ? undefined : this.decodeVerifiedExternalMaintenanceIntentRow(row);
  }

  public getExternalMaintenanceIntentForExecution(
    rawExternalExecutionId: ExternalExecutionId,
    sequence: number,
  ): ExternalMaintenanceIntent | undefined {
    this.assertOpen();
    const identifier = externalExecutionId(rawExternalExecutionId);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new TypeError('External maintenance sequence must be a positive integer');
    }
    const row = this.#database
      .prepare(
        `SELECT * FROM external_maintenance_intents
          WHERE external_execution_id = ? AND sequence = ?`,
      )
      .get(identifier, sequence);
    return row === undefined ? undefined : this.decodeVerifiedExternalMaintenanceIntentRow(row);
  }

  public getExecutionProfileBinding(
    rawWorkflowIdentifier: WorkflowId,
  ): ExecutionProfileBinding | undefined {
    this.assertOpen();
    const workflowIdentifier = workflowId(rawWorkflowIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM workflow_execution_profile_bindings WHERE workflow_id = ?')
      .get(workflowIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const binding = decodeExecutionProfileBindingRow(row);
    this.assertExecutionProfileBindingClosure(binding);
    return binding;
  }

  public getWorkflowPolicyBinding(
    rawWorkflowIdentifier: WorkflowId,
  ): WorkflowPolicyBinding | undefined {
    this.assertOpen();
    const workflowIdentifier = workflowId(rawWorkflowIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM workflow_policy_bindings WHERE workflow_id = ?')
      .get(workflowIdentifier);
    if (row === undefined) {
      return undefined;
    }
    const binding = decodeWorkflowPolicyBindingRow(row);
    this.assertWorkflowPolicyBindingClosure(binding);
    return binding;
  }

  public getRecoveryReconciliation(
    rawRecoveryIdentifier: RecoveryReconciliationId,
  ): RecoveryReconciliationRecord | undefined {
    this.assertOpen();
    const recoveryIdentifier = recoveryReconciliationId(rawRecoveryIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM recovery_reconciliations WHERE id = ?')
      .get(recoveryIdentifier);
    return row === undefined ? undefined : this.decodeVerifiedRecoveryReconciliationRow(row);
  }

  public getLatestRecoveryReconciliation(
    rawWorkflowIdentifier: WorkflowId,
  ): RecoveryReconciliationRecord | undefined {
    this.assertOpen();
    const workflowIdentifier = workflowId(rawWorkflowIdentifier);
    const row = this.#database
      .prepare(
        `SELECT *
           FROM recovery_reconciliations
          WHERE workflow_id = ?
          ORDER BY resulting_workflow_version DESC, id DESC
          LIMIT 1`,
      )
      .get(workflowIdentifier);
    return row === undefined ? undefined : this.decodeVerifiedRecoveryReconciliationRow(row);
  }

  public listStartupRecoveryCatalog(): readonly RecoveryCatalogEntry[] {
    this.assertOpen();
    return this.runRead(() => {
      const rows = this.#database
        .prepare(
          `SELECT workflow.goal_id AS id
             FROM workflows AS workflow
             JOIN attempts AS attempt ON attempt.id = workflow.active_attempt_id
            WHERE workflow.run_status = 'RUNNING'
              AND attempt.status = 'RUNNING'
            ORDER BY workflow.id`,
        )
        .all();
      return Object.freeze(
        rows.map((row) => {
          const identifier = goalId(authorityIdentifierRowSchema.parse(row).id);
          const entry = this.getRecoveryCatalogForGoal(identifier);
          if (entry?.blockerKind !== RecoverableBlockerKind.ACTIVE_ATTEMPT) {
            throw new StoreInvariantError(
              `Running Goal ${identifier} has no exact startup recovery catalog entry`,
            );
          }
          return entry;
        }),
      );
    });
  }

  public getRecoveryCatalogForGoal(rawGoalIdentifier: GoalId): RecoveryCatalogEntry | undefined {
    this.assertOpen();
    const goalIdentifier = goalId(rawGoalIdentifier);
    return this.runRead(() => {
      const owner = this.getGoalWithWorkflow(goalIdentifier);
      if (owner === undefined) {
        return undefined;
      }
      const { goal, workflow } = owner;
      const startAuthority = this.resolveWorkflowStartAuthorityClosure(workflow);
      const latestReconciliation = this.getLatestRecoveryReconciliation(workflow.id);
      let blockerKind: RecoveryCatalogEntry['blockerKind'];
      let sourceAttempt: Attempt | undefined;

      if (workflow.runStatus === RunStatus.RUNNING && workflow.activeAttemptId !== undefined) {
        blockerKind = RecoverableBlockerKind.ACTIVE_ATTEMPT;
        sourceAttempt = this.getAttempt(workflow.activeAttemptId);
        if (sourceAttempt?.status !== AttemptStatus.RUNNING) {
          throw new StoreInvariantError(
            `Running Workflow ${workflow.id} has no exact active RUNNING Attempt`,
          );
        }
      } else if (
        workflow.runStatus === RunStatus.BLOCKED &&
        workflow.activeAttemptId === undefined &&
        latestReconciliation?.resultingWorkflowVersion === workflow.version
      ) {
        blockerKind = RecoverableBlockerKind.RECONCILED_BLOCKER;
        sourceAttempt =
          latestReconciliation.sourceAttemptId === undefined
            ? undefined
            : this.getAttempt(latestReconciliation.sourceAttemptId);
        if (sourceAttempt === undefined || sourceAttempt.status === AttemptStatus.RUNNING) {
          throw new StoreInvariantError(
            `Recovery ${latestReconciliation.id} has no terminal source Attempt`,
          );
        }
      } else if (
        workflow.runStatus === RunStatus.BLOCKED &&
        workflow.activeAttemptId === undefined
      ) {
        const row = this.#database
          .prepare(
            `SELECT *
               FROM attempts
              WHERE workflow_id = ?
                AND status = 'FAILED'
                AND failure_class IN ('TIMEOUT', 'ABRUPT_TERMINATION')
              ORDER BY sequence DESC
              LIMIT 1`,
          )
          .get(workflow.id);
        sourceAttempt = row === undefined ? undefined : decodeAttempt(row);
        if (sourceAttempt?.endedAt !== workflow.updatedAt) {
          return undefined;
        }
        blockerKind = RecoverableBlockerKind.RECOVERABLE_FAILURE;
      } else {
        return undefined;
      }

      if (startAuthority.state !== 'STARTED') {
        throw new StoreInvariantError(
          `Recoverable Workflow ${workflow.id} has no exact Policy/Profile binding`,
        );
      }
      const { policyBinding, executionProfileBinding } = startAuthority;
      const contextManifest =
        sourceAttempt.contextManifestId === undefined
          ? undefined
          : this.getContextManifest(sourceAttempt.contextManifestId);
      if (sourceAttempt.contextManifestId !== undefined && contextManifest === undefined) {
        throw new StoreInvariantError(
          `Recovery source Attempt ${sourceAttempt.id} has no Context Manifest`,
        );
      }
      if (
        contextManifest !== undefined &&
        (contextManifest.goalId !== goal.id ||
          contextManifest.goalRevision !== goal.revision ||
          contextManifest.workflowId !== workflow.id ||
          contextManifest.attemptId !== sourceAttempt.id ||
          contextManifest.policyBundleId !== policyBinding.policyBundleId ||
          contextManifest.policyBundleDigest !== policyBinding.policyBundleDigest ||
          contextManifest.executionProfileId !== executionProfileBinding.profileId ||
          contextManifest.executionProfileDigest !== executionProfileBinding.profileDigest)
      ) {
        throw new StoreInvariantError(
          `Recovery source Attempt ${sourceAttempt.id} has mismatched Context authority`,
        );
      }
      const dispatchClaim = this.getWorkerDispatchClaim(sourceAttempt.id);
      const externalExecution = this.hasTable('external_execution_records')
        ? this.getExternalExecutionForAttempt(sourceAttempt.id)
        : undefined;
      const externalMaintenance =
        externalExecution === undefined
          ? undefined
          : this.getExternalMaintenanceIntentForExecution(externalExecution.id, 1);
      const candidateAuthority = this.getCandidateAuthorityForWorkflow(workflow.id);
      const currentLocalVerificationObligations =
        candidateAuthority === undefined
          ? []
          : this.listVerificationObligations(goal.id).filter(
              (obligation) =>
                obligation.goalRevision === goal.revision &&
                obligation.candidateGenerationId === candidateAuthority.generation.id &&
                obligation.requiredEvidenceKind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT,
            );
      const coveredLocalVerificationObligationIds = new Set(
        candidateAuthority === undefined
          ? []
          : this.listEvidenceForGeneration(candidateAuthority.generation.id)
              .filter(
                ({ record, eligibility }) =>
                  record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT &&
                  eligibility.state === EvidenceEligibilityState.ELIGIBLE,
              )
              .map(({ record }) => record.verificationObligationId),
      );
      const continuityBarrier =
        workflow.phase === WorkflowPhase.EVIDENCE_BUILD &&
        currentLocalVerificationObligations.some(
          (obligation) => !coveredLocalVerificationObligationIds.has(obligation.id),
        )
          ? RecoveryContinuityBarrier.LOCAL_COMMAND_VERIFICATION_SESSION_UNAVAILABLE
          : undefined;
      const watermark = auditSequenceWatermarkRowSchema.parse(
        this.#database
          .prepare('SELECT COALESCE(MAX(sequence), 0) AS through_sequence FROM audit_events')
          .get(),
      ).through_sequence;
      if (watermark < 1) {
        throw new StoreInvariantError(
          `Recovery catalog for Workflow ${workflow.id} has no Audit authority`,
        );
      }
      return Object.freeze({
        goal,
        workflow,
        blockerKind,
        ...(continuityBarrier === undefined ? {} : { continuityBarrier }),
        sourceAttempt,
        ...(contextManifest === undefined ? {} : { contextManifest }),
        policyBinding,
        executionProfileBinding,
        ...(dispatchClaim === undefined ? {} : { dispatchClaim }),
        ...(externalExecution === undefined ? {} : { externalExecution }),
        ...(externalMaintenance === undefined ? {} : { externalMaintenance }),
        ...(candidateAuthority === undefined ? {} : { candidateAuthority }),
        lastAuditSequence: watermark,
        ...(latestReconciliation === undefined ? {} : { latestReconciliation }),
      });
    });
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
      if (workflow === undefined) {
        return undefined;
      }
      const startAuthority = this.resolveWorkflowStartAuthorityClosure(workflow);
      if (workflow.activeCandidateGenerationId === undefined) {
        return undefined;
      }
      if (startAuthority.state !== 'STARTED') {
        throw new StoreInvariantError(
          `Acceptance Workflow ${workflow.id} has no exact start authority`,
        );
      }
      if (startAuthority.policyBinding.policyBundleId !== policyIdentifier) {
        throw new StoreInvariantError(
          `Acceptance Workflow ${workflow.id} requested a Policy other than its binding`,
        );
      }
      const goal = this.getGoal(workflow.goalId);
      const candidateAuthority = this.getCandidateAuthorityForWorkflow(workflow.id);
      const installedPolicy = this.getPolicyBundle(policyIdentifier);
      if (
        goal === undefined ||
        candidateAuthority === undefined ||
        installedPolicy?.bundle.version !== startAuthority.policyBinding.policyBundleVersion ||
        installedPolicy.bundle.digest !== startAuthority.policyBinding.policyBundleDigest
      ) {
        return undefined;
      }
      const relatedSpecifications = this.listCheckSpecifications().filter((specification) =>
        specification.inputRefs.includes(candidateAuthority.generation.id),
      );
      const freezeChecks = relatedSpecifications.filter(
        (specification) => specification.kind === CheckSpecificationKind.CANDIDATE_FREEZE,
      );
      const fakeVerificationChecks = relatedSpecifications.filter(
        (specification) => specification.kind === CheckSpecificationKind.FAKE_VERIFICATION,
      );
      const localVerificationChecks = relatedSpecifications.filter(
        (specification) => specification.kind === CheckSpecificationKind.LOCAL_COMMAND,
      );
      const freezeCheck = freezeChecks[0];
      const verificationCheck = localVerificationChecks[0] ?? fakeVerificationChecks[0];
      const protectedPlan = this.getAcceptanceCriticalVerificationPlan(workflow.id);
      const verificationRef =
        verificationCheck === undefined
          ? undefined
          : `${verificationCheck.id}@${verificationCheck.version}`;
      const obligations = this.listVerificationObligations(goal.id).filter(
        (obligation) =>
          obligation.goalRevision === goal.revision &&
          obligation.candidateGenerationId === candidateAuthority.generation.id &&
          obligation.checkSpecRef === verificationRef,
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
        freezeChecks.length !== 1 ||
        fakeVerificationChecks.length !== 1 ||
        localVerificationChecks.length > 1 ||
        relatedSpecifications.length !== 2 + localVerificationChecks.length ||
        freezeCheck === undefined ||
        verificationCheck === undefined ||
        (protectedPlan === undefined) !==
          !(
            verificationCheck.kind === CheckSpecificationKind.LOCAL_COMMAND &&
            verificationCheck.schemaVersion === 3
          ) ||
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
        ...(protectedPlan === undefined
          ? {}
          : { acceptanceCriticalVerificationPlan: protectedPlan }),
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

  public getAcceptanceRepairForRejectedGeneration(
    rawCandidateGenerationIdentifier: CandidateGenerationId,
  ): AcceptanceRepairRecord | undefined {
    this.assertOpen();
    const generationIdentifier = candidateGenerationId(rawCandidateGenerationIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM acceptance_repairs WHERE rejected_candidate_generation_id = ?')
      .get(generationIdentifier);
    return row === undefined ? undefined : decodeAcceptanceRepairRow(row);
  }

  public getAcceptanceRepairForRepairGeneration(
    rawCandidateGenerationIdentifier: CandidateGenerationId,
  ): AcceptanceRepairRecord | undefined {
    this.assertOpen();
    const generationIdentifier = candidateGenerationId(rawCandidateGenerationIdentifier);
    const row = this.#database
      .prepare('SELECT * FROM acceptance_repairs WHERE repair_candidate_generation_id = ?')
      .get(generationIdentifier);
    return row === undefined ? undefined : decodeAcceptanceRepairRow(row);
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

  public getWorkerEventReplayAuthority(
    rawWorkerEventIdentifier: WorkerEventId,
  ): WorkerEventReplayAuthoritySnapshot | undefined {
    this.assertOpen();
    const eventIdentifier = workerEventId(rawWorkerEventIdentifier);
    return this.runRead(() => {
      const receiptRow = this.#database
        .prepare('SELECT * FROM worker_event_receipts WHERE event_id = ?')
        .get(eventIdentifier);
      if (receiptRow === undefined) {
        return undefined;
      }
      const receipt = decodeWorkerEventReceiptRow(receiptRow);
      const claimRow = this.#database
        .prepare('SELECT * FROM worker_dispatch_claims WHERE attempt_id = ?')
        .get(receipt.attemptId);
      const dispatchClaim =
        claimRow === undefined ? undefined : decodeWorkerDispatchClaimRow(claimRow);
      if (dispatchClaim === undefined) {
        throw new StoreInvariantError(
          `Worker Event ${receipt.eventId} has no replay dispatch authority`,
        );
      }
      const contextManifest = this.getContextManifest(receipt.contextManifestId);
      if (contextManifest === undefined) {
        throw new StoreInvariantError(
          `Worker Event ${receipt.eventId} has no replay Context Manifest`,
        );
      }
      if (receipt.disposition === WorkerEventDisposition.IGNORED) {
        return Object.freeze({ receipt, dispatchClaim, contextManifest });
      }
      const attemptRow = this.#database
        .prepare('SELECT * FROM attempts WHERE id = ?')
        .get(receipt.attemptId);
      const terminalAttempt = attemptRow === undefined ? undefined : decodeAttempt(attemptRow);
      const processedRow = this.#database
        .prepare('SELECT * FROM processed_commands WHERE command_id = ?')
        .get(receipt.internalCommandId);
      const processedCommand =
        processedRow === undefined ? undefined : decodeProcessedCommand(processedRow);
      if (processedCommand !== undefined) {
        this.validateProcessedCommandRecord(processedCommand);
      }
      if (
        terminalAttempt === undefined ||
        terminalAttempt.status === AttemptStatus.RUNNING ||
        processedCommand === undefined
      ) {
        throw new StoreInvariantError(
          `Admitted Worker Event ${receipt.eventId} has incomplete replay authority`,
        );
      }
      return Object.freeze({
        receipt,
        dispatchClaim,
        contextManifest,
        terminalAttempt,
        processedCommand,
      });
    });
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

  public installExternalBackendCapabilityRecord(
    rawInput: InstallExternalBackendCapabilityRecord,
  ): ExternalBackendCapabilityInstallResult {
    this.assertOpen();
    const input = validateInstallExternalBackendCapabilityRecord(rawInput);
    const expectedDigest = this.externalBackendCapabilityDigest(input.record);
    if (input.record.recordDigest !== expectedDigest || input.payloadDigest !== expectedDigest) {
      throw new StoreInvariantError(
        'External backend capability digest does not match its canonical projection',
      );
    }
    const capabilityEntriesJson = canonicalizeJson(input.record.capabilityEntries);

    return this.runImmediate(() => {
      const existingRow = this.#database
        .prepare(
          `SELECT *
             FROM external_backend_capability_records
            WHERE record_digest = ? OR (
              backend_kind = ? AND binary_identity_digest = ? AND
              protocol_schema_digest = ? AND configuration_profile_digest = ?
            )`,
        )
        .get(
          input.record.recordDigest,
          input.record.backendKind,
          input.record.binaryIdentityDigest,
          input.record.protocolSchemaDigest,
          input.record.configurationProfileDigest,
        );
      if (existingRow !== undefined) {
        const existing = this.decodeVerifiedExternalBackendCapabilityRow(existingRow);
        return existing.recordDigest === input.record.recordDigest
          ? { status: 'EXISTING', value: existing }
          : {
              status: 'CAPABILITY_CONFLICT',
              message: `External backend capability identity ${input.record.backendKind} conflicts with installed authority`,
            };
      }

      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'EXTERNAL_BACKEND_CAPABILITY',
        aggregateId: input.record.recordDigest,
        eventType: 'EXTERNAL_BACKEND_CAPABILITY_INSTALLED',
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.record.recordDigest,
        occurredAt: input.record.observedAt,
      });
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_CAPABILITY_AUDIT_WRITE);
      this.#database
        .prepare(
          `INSERT INTO external_backend_capability_records(
             record_digest, schema_version, backend_kind, binary_identity_digest,
             protocol_schema_digest, configuration_profile_digest,
             capability_entries_json, observed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.record.recordDigest,
          input.record.schemaVersion,
          input.record.backendKind,
          input.record.binaryIdentityDigest,
          input.record.protocolSchemaDigest,
          input.record.configurationProfileDigest,
          capabilityEntriesJson,
          input.record.observedAt,
        );
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_CAPABILITY_WRITE);
      const installed = this.getExternalBackendCapabilityRecord(input.record.recordDigest);
      if (installed === undefined) {
        throw new StoreInvariantError('External backend capability was not persisted readably');
      }
      this.assertAuditEventsReadable([input.auditEventId]);
      return { status: 'INSTALLED', value: installed };
    });
  }

  public installExecutionProfile(rawInput: InstallExecutionProfile): ExecutionProfileInstallResult {
    this.assertOpen();
    const input = validateInstallExecutionProfile(rawInput);
    const expectedDigest = this.executionProfileDigest(input.profile);
    if (input.profile.digest !== expectedDigest || input.payloadDigest !== expectedDigest) {
      throw new StoreInvariantError(
        'Execution Profile digest does not match its canonical projection',
      );
    }
    const canonicalContent = canonicalizeJson(executionProfileProjection(input.profile));
    const baseCanonicalContent = canonicalizeJson({
      id: input.profile.id,
      schemaVersion: 1,
      version: input.profile.version,
      workerAdapter: input.profile.workerAdapter,
      workerAdapterVersion: input.profile.workerAdapterVersion,
      candidateSource: input.profile.candidateSource,
      candidateSourceVersion: input.profile.candidateSourceVersion,
      verificationRunner: input.profile.verificationRunner,
      verificationRunnerVersion: input.profile.verificationRunnerVersion,
      driverVersion: input.profile.driverVersion,
    });

    return this.runImmediate(() => {
      const existingRow = this.hasTable('external_execution_profile_extensions')
        ? this.#database
            .prepare(
              `SELECT profile.*,
                      extension.logical_schema_version,
                      extension.capability_record_digest,
                      extension.external_execution_json
                 FROM execution_profiles AS profile
                 LEFT JOIN external_execution_profile_extensions AS extension
                   ON extension.profile_id = profile.id
                WHERE profile.id = ? OR profile.profile_digest = ?`,
            )
            .get(input.profile.id, input.profile.digest)
        : this.#database
            .prepare('SELECT * FROM execution_profiles WHERE id = ? OR profile_digest = ?')
            .get(input.profile.id, input.profile.digest);
      if (existingRow !== undefined) {
        const existing = this.decodeVerifiedExecutionProfileRow(existingRow);
        const same =
          existing.profile.id === input.profile.id &&
          existing.profile.digest === input.profile.digest &&
          canonicalizeJson(executionProfileProjection(existing.profile)) === canonicalContent;
        return same
          ? { status: 'EXISTING', value: existing }
          : {
              status: 'PROFILE_CONFLICT',
              message: `Execution Profile ${input.profile.id} conflicts with installed authority`,
            };
      }

      if (input.profile.schemaVersion === 2) {
        if (!this.hasTable('external_execution_profile_extensions')) {
          return {
            status: 'PROFILE_CONFLICT',
            message: `Execution Profile ${input.profile.id} requires the Slice 6 authority schema`,
          };
        }
        if (!this.hasExactExternalProfileCapabilityAuthority(input.profile)) {
          return {
            status: 'PROFILE_CONFLICT',
            message: `Execution Profile ${input.profile.id} lacks exact supported backend capability authority`,
          };
        }
      }

      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'EXECUTION_PROFILE',
        aggregateId: input.profile.id,
        eventType: 'EXECUTION_PROFILE_INSTALLED',
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: expectedDigest,
        occurredAt: input.installedAt,
      });
      this.probe(WorkerTransactionStep.AFTER_EXECUTION_PROFILE_AUDIT_WRITE);
      this.#database
        .prepare(
          `INSERT INTO execution_profiles(
             id, schema_version, profile_version, canonical_content_json,
             profile_digest, installed_at
           ) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.profile.id,
          1,
          input.profile.version,
          baseCanonicalContent,
          input.profile.digest,
          input.installedAt,
        );
      if (input.profile.schemaVersion === 2) {
        this.#database
          .prepare(
            `INSERT INTO external_execution_profile_extensions(
               profile_id, logical_schema_version, capability_record_digest,
               external_execution_json
             ) VALUES (?, 2, ?, ?)`,
          )
          .run(
            input.profile.id,
            input.profile.externalExecution.capabilityRecordDigest,
            canonicalizeJson(input.profile.externalExecution),
          );
      }
      this.probe(WorkerTransactionStep.AFTER_EXECUTION_PROFILE_WRITE);
      const installed = this.getExecutionProfile(input.profile.id);
      if (installed === undefined) {
        throw new StoreInvariantError(
          `Execution Profile ${input.profile.id} was not persisted readably`,
        );
      }
      this.assertAuditEventsReadable([input.auditEventId]);
      return { status: 'INSTALLED', value: installed };
    });
  }

  public claimWorkerDispatch(rawInput: ClaimWorkerDispatch): WorkerDispatchClaimResult {
    this.assertOpen();
    const input = validateClaimWorkerDispatch(rawInput);
    return this.runImmediate(() => this.claimWorkerDispatchInsideTransaction(input));
  }

  private claimWorkerDispatchInsideTransaction(
    input: ClaimWorkerDispatch,
  ): WorkerDispatchClaimResult {
    const { claim } = input;
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
        existing.packageDigest === claim.packageDigest &&
        existing.executionProfileId === claim.executionProfileId &&
        existing.executionProfileDigest === claim.executionProfileDigest;
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
    const profileBinding = this.getExecutionProfileBinding(claim.workflowId);
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
      manifest.executionProfileId !== claim.executionProfileId ||
      manifest.executionProfileDigest !== claim.executionProfileDigest ||
      profileBinding?.profileId !== claim.executionProfileId ||
      profileBinding.profileDigest !== claim.executionProfileDigest ||
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
           context_manifest_id, context_manifest_digest, package_digest,
           execution_profile_id, execution_profile_digest, claimed_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        claim.executionProfileId,
        claim.executionProfileDigest,
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
  }

  public claimExternalWorkerDispatch(
    rawInput: ClaimExternalWorkerDispatch,
  ): ExternalWorkerDispatchClaimResult {
    this.assertOpen();
    const input = validateClaimExternalWorkerDispatch(rawInput);
    const { claim, intent } = input;
    const claimDigest = sha256Digest(
      canonicalAuthorityDigests.digest(workerDispatchClaimProjection(claim)),
    );
    const expectedIntentDigest = sha256Digest(
      canonicalAuthorityDigests.digest(externalExecutionIntentProjection(intent)),
    );
    if (
      input.payloadDigest !== claimDigest ||
      intent.dispatchClaimDigest !== claimDigest ||
      intent.intentDigest !== expectedIntentDigest
    ) {
      throw new StoreInvariantError('External dispatch authority has false canonical digests');
    }

    return this.runImmediate(() => {
      const existingExecution = this.getExternalExecutionForAttempt(intent.attemptId);
      const existingClaim = this.getWorkerDispatchClaim(intent.attemptId);
      if (existingExecution !== undefined || existingClaim !== undefined) {
        if (
          existingExecution !== undefined &&
          existingClaim !== undefined &&
          existingExecution.intentDigest === intent.intentDigest &&
          existingExecution.dispatchClaimDigest === claimDigest &&
          existingClaim.contextManifestDigest === claim.contextManifestDigest &&
          existingClaim.packageDigest === claim.packageDigest
        ) {
          return { status: 'EXISTING', claim: existingClaim, execution: existingExecution };
        }
        return {
          status: 'DISPATCH_CONFLICT',
          message: `Attempt ${intent.attemptId} has incomplete or conflicting external dispatch authority`,
        };
      }

      const manifest = this.getContextManifest(claim.contextManifestId);
      const installedProfile = this.getExecutionProfile(claim.executionProfileId);
      const policyBinding = this.getWorkflowPolicyBinding(claim.workflowId);
      const installedPolicy =
        policyBinding === undefined
          ? undefined
          : this.getPolicyBundle(policyBinding.policyBundleId);
      const profile = installedProfile?.profile;
      const external =
        profile?.schemaVersion === 2 && profile.externalExecution.schemaVersion !== 3
          ? profile.externalExecution
          : undefined;
      if (
        manifest === undefined ||
        profile === undefined ||
        external === undefined ||
        installedPolicy === undefined ||
        intent.id !== externalExecutionId(intent.id) ||
        intent.goalId !== manifest.goalId ||
        intent.goalRevision !== manifest.goalRevision ||
        intent.workflowId !== claim.workflowId ||
        intent.workflowVersionAtAuthorization !== claim.workflowVersion ||
        intent.phaseVersion !== claim.workflowVersion ||
        intent.phase !== manifest.phase ||
        intent.attemptId !== claim.attemptId ||
        intent.workerSessionId !== claim.workerSessionId ||
        intent.contextManifestId !== claim.contextManifestId ||
        intent.contextManifestDigest !== claim.contextManifestDigest ||
        intent.contextPackageDigest !== claim.packageDigest ||
        intent.executionProfileId !== profile.id ||
        intent.executionProfileDigest !== profile.digest ||
        intent.policyBundleId !== installedPolicy.bundle.id ||
        intent.policyBundleDigest !== installedPolicy.bundle.digest ||
        intent.policyBundleId !== manifest.policyBundleId ||
        intent.policyBundleDigest !== manifest.policyBundleDigest ||
        intent.backendKind !== external.backendKind ||
        intent.binaryIdentityDigest !== external.binaryIdentityDigest ||
        intent.binaryProtocolSchemaDigest !== external.protocolSchemaDigest ||
        intent.executionConfigDigest !== external.executionConfigDigest ||
        intent.managedRequirementsDigest !== external.managedRequirementsDigest ||
        intent.instructionSourceManifestDigest !== external.instructionSourceManifestDigest ||
        intent.controlledStateRootIdentity !== external.controlledStateRootIdentity ||
        intent.thread.kind !== external.defaultThreadPolicy ||
        rawField(intent, 'continuityPolicy') !== rawField(external, 'continuityPolicy') ||
        intent.compactionPolicy !== external.compactionPolicy ||
        rawField(intent, 'retentionPolicy') !== rawField(external, 'retentionPolicy') ||
        rawField(intent, 'fallbackPolicy') !== rawField(external, 'fallbackPolicy') ||
        rawField(intent, 'interruptionPolicy') !== rawField(external, 'interruptionPolicy') ||
        intent.authorizedAt !== claim.claimedAt
      ) {
        return {
          status: 'NOT_ELIGIBLE',
          message: `Attempt ${intent.attemptId} lacks exact Profile, Context, Policy, or Intent authority`,
        };
      }

      const dispatch = this.claimWorkerDispatchInsideTransaction(input);
      if (dispatch.status !== 'CLAIMED') {
        if (dispatch.status === 'EXISTING') {
          return {
            status: 'DISPATCH_CONFLICT',
            message: `Attempt ${intent.attemptId} was claimed without external authorization`,
          };
        }
        return dispatch;
      }

      const nextAuditSequenceRow = z
        .object({ next_sequence: z.number().int().positive() })
        .parse(
          this.#database
            .prepare('SELECT coalesce(max(sequence), 0) + 1 AS next_sequence FROM audit_events')
            .get(),
        );
      const recordWithoutDigest = Object.freeze({
        ...intent,
        version: 1,
        state: ExternalExecutionState.AUTHORIZED,
        compactionCount: 0,
        turnInterruptCount: 0,
        updatedAt: intent.authorizedAt,
        auditSequence: nextAuditSequenceRow.next_sequence,
      });
      const record = decodeExternalExecutionRecord({
        ...recordWithoutDigest,
        recordDigest: sha256Digest(
          canonicalAuthorityDigests.digest(externalExecutionRecordProjection(recordWithoutDigest)),
        ),
      });
      this.insertAuditEvent({
        id: input.externalAuditEventId,
        aggregateType: 'EXTERNAL_EXECUTION',
        aggregateId: record.id,
        eventType: 'EXTERNAL_EXECUTION_AUTHORIZED',
        afterVersion: record.version,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: record.recordDigest,
        occurredAt: record.authorizedAt,
      });
      if (this.auditSequence(input.externalAuditEventId) !== record.auditSequence) {
        throw new StoreInvariantError('External execution audit sequence changed before insert');
      }
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_AUDIT_WRITE);
      this.insertExternalExecutionRecord(record);
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_WRITE);
      const persisted = this.getExternalExecution(record.id);
      if (persisted === undefined) {
        throw new StoreInvariantError(`External execution ${record.id} was not readable`);
      }
      this.assertAuditEventsReadable([input.auditEventId, input.externalAuditEventId]);
      return { status: 'CLAIMED', claim: dispatch.value, execution: persisted };
    });
  }

  public admitExternalExecutionObservation(
    rawInput: AdmitExternalExecutionObservation,
  ): ExternalExecutionObservationStoreResult {
    this.assertOpen();
    const input = validateAdmitExternalExecutionObservation(rawInput);
    const { observation } = input;
    const expectedObservationDigest = this.externalExecutionObservationDigest(observation);
    if (observation.observationDigest !== expectedObservationDigest) {
      throw new StoreInvariantError('External execution observation has a false digest');
    }

    return this.runImmediate(() => {
      const duplicateRow = this.#database
        .prepare(
          `SELECT * FROM external_execution_observations
            WHERE id = ? OR observation_digest = ?`,
        )
        .get(observation.id, observation.observationDigest);
      if (duplicateRow !== undefined) {
        const duplicate = this.decodeVerifiedExternalExecutionObservationRow(duplicateRow);
        const current = this.getExternalExecution(duplicate.externalExecutionId);
        if (
          duplicate.id === observation.id &&
          duplicate.observationDigest === observation.observationDigest &&
          current !== undefined &&
          current.version >= duplicate.expectedRecordVersion + 1
        ) {
          return { status: 'REPLAYED', value: current };
        }
        return {
          status: 'OBSERVATION_CONFLICT',
          message: `External observation ${observation.id} conflicts with retained authority`,
        };
      }

      const current = this.getExternalExecution(observation.externalExecutionId);
      if (current?.intentDigest !== observation.intentDigest) {
        return {
          status: 'OBSERVATION_CONFLICT',
          message: `External observation ${observation.id} has no exact execution intent`,
        };
      }
      if (
        current.state === ExternalExecutionState.COMPLETED ||
        current.state === ExternalExecutionState.INTERRUPTED ||
        current.state === ExternalExecutionState.FAILED ||
        current.state === ExternalExecutionState.ABANDONED
      ) {
        return {
          status: 'TERMINAL',
          message: `External execution ${current.id} is already terminal`,
        };
      }
      if (current.version !== observation.expectedRecordVersion) {
        return {
          status: 'VERSION_CONFLICT',
          message: `External execution ${current.id} changed before observation`,
        };
      }
      const allowedNextStates: ReadonlySet<string> = new Set(
        current.state === ExternalExecutionState.AUTHORIZED
          ? [
              ExternalExecutionState.PROCESS_OBSERVED,
              ExternalExecutionState.FAILED,
              ExternalExecutionState.INTERRUPTED,
            ]
          : current.state === ExternalExecutionState.PROCESS_OBSERVED
            ? [
                ExternalExecutionState.SESSION_OBSERVED,
                ExternalExecutionState.FAILED,
                ExternalExecutionState.INTERRUPTED,
              ]
            : current.state === ExternalExecutionState.SESSION_OBSERVED
              ? [
                  ExternalExecutionState.OPERATION_RUNNING,
                  ExternalExecutionState.FAILED,
                  ExternalExecutionState.INTERRUPTED,
                ]
              : [
                  ExternalExecutionState.COMPLETED,
                  ExternalExecutionState.FAILED,
                  ExternalExecutionState.INTERRUPTED,
                ],
      );
      const terminalObservation =
        observation.state === ExternalExecutionState.COMPLETED ||
        observation.state === ExternalExecutionState.FAILED ||
        observation.state === ExternalExecutionState.INTERRUPTED;
      const maintenance =
        current.compactionPolicy === 'MANUAL_BEFORE_OPERATION'
          ? this.getExternalMaintenanceIntentForExecution(current.id, 1)
          : undefined;
      if (
        !allowedNextStates.has(observation.state) ||
        (observation.state === ExternalExecutionState.PROCESS_OBSERVED &&
          (observation.processIdentity?.launchNonce !== current.processLaunchNonce ||
            observation.processIdentity.executableIdentityDigest !== current.binaryIdentityDigest ||
            observation.processIdentity.controlledStateRootIdentity !==
              current.controlledStateRootIdentity)) ||
        observation.observedAt < current.updatedAt ||
        observation.compactionCount < current.compactionCount ||
        observation.turnInterruptCount < current.turnInterruptCount ||
        (current.compactionPolicy === 'FAIL_ON_OBSERVATION' && observation.compactionCount !== 0) ||
        (current.compactionPolicy === 'MANUAL_BEFORE_OPERATION' &&
          (observation.compactionCount > 1 ||
            (observation.compactionCount === 1 &&
              maintenance?.state !== ExternalMaintenanceState.OBSERVED) ||
            (terminalObservation && maintenance?.state === ExternalMaintenanceState.AUTHORIZED))) ||
        (current.backendSessionRef !== undefined &&
          observation.backendSessionRef !== undefined &&
          observation.backendSessionRef !== current.backendSessionRef) ||
        (current.backendOperationRef !== undefined &&
          observation.backendOperationRef !== undefined &&
          observation.backendOperationRef !== current.backendOperationRef) ||
        (observation.state === ExternalExecutionState.COMPLETED &&
          observation.resultEventId === undefined) ||
        (observation.state === ExternalExecutionState.FAILED &&
          (observation.failureCode === 'BACKEND_TURN_FAILED') !==
            (observation.resultEventId !== undefined)) ||
        (!terminalObservation && observation.resultEventId !== undefined) ||
        (observation.state === ExternalExecutionState.INTERRUPTED &&
          observation.resultEventId !== undefined) ||
        (!terminalObservation && observation.failureCode !== undefined)
      ) {
        return {
          status: 'OBSERVATION_CONFLICT',
          message: `External observation ${observation.id} violates lifecycle continuity`,
        };
      }

      this.insertAuditEvent({
        id: input.observationAuditEventId,
        aggregateType: 'EXTERNAL_EXECUTION_OBSERVATION',
        aggregateId: observation.id,
        eventType: 'EXTERNAL_EXECUTION_OBSERVED',
        beforeVersion: current.version,
        afterVersion: current.version + 1,
        payloadDigest: observation.observationDigest,
        occurredAt: observation.observedAt,
      });
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_OBSERVATION_AUDIT_WRITE);
      this.#database
        .prepare(
          `INSERT INTO external_execution_observations(
             id, schema_version, external_execution_id, intent_digest,
             expected_record_version, state, process_identity_json, backend_session_ref,
             backend_operation_ref,
             compaction_count, turn_interrupt_count, failure_code, result_event_id,
             observed_at, observation_digest
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          observation.id,
          observation.schemaVersion,
          observation.externalExecutionId,
          observation.intentDigest,
          observation.expectedRecordVersion,
          observation.state,
          observation.processIdentity === undefined
            ? null
            : serializeJson(decodeJsonValue(observation.processIdentity)),
          observation.backendSessionRef ?? null,
          observation.backendOperationRef ?? null,
          observation.compactionCount,
          observation.turnInterruptCount,
          observation.failureCode ?? null,
          observation.resultEventId ?? null,
          observation.observedAt,
          observation.observationDigest,
        );
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_OBSERVATION_WRITE);

      const nextAuditSequence = z
        .object({ next_sequence: z.number().int().positive() })
        .parse(
          this.#database
            .prepare('SELECT coalesce(max(sequence), 0) + 1 AS next_sequence FROM audit_events')
            .get(),
        ).next_sequence;
      const nextWithoutDigest = Object.freeze({
        ...current,
        version: current.version + 1,
        state: observation.state,
        ...(observation.processIdentity === undefined
          ? {}
          : { processIdentity: observation.processIdentity }),
        ...(observation.backendSessionRef === undefined
          ? {}
          : { backendSessionRef: observation.backendSessionRef }),
        ...(observation.backendOperationRef === undefined
          ? {}
          : { backendOperationRef: observation.backendOperationRef }),
        compactionCount: observation.compactionCount,
        turnInterruptCount: observation.turnInterruptCount,
        ...(observation.failureCode === undefined ? {} : { failureCode: observation.failureCode }),
        ...(observation.resultEventId === undefined
          ? {}
          : { resultEventId: observation.resultEventId }),
        updatedAt: observation.observedAt,
        ...(terminalObservation ? { terminalAt: observation.observedAt } : {}),
        lastObservationId: observation.id,
        auditSequence: nextAuditSequence,
      });
      const next = decodeExternalExecutionRecord({
        ...nextWithoutDigest,
        recordDigest: sha256Digest(
          canonicalAuthorityDigests.digest(externalExecutionRecordProjection(nextWithoutDigest)),
        ),
      });
      this.insertAuditEvent({
        id: input.recordAuditEventId,
        aggregateType: 'EXTERNAL_EXECUTION',
        aggregateId: next.id,
        eventType: 'EXTERNAL_EXECUTION_STATE_CHANGED',
        beforeVersion: current.version,
        afterVersion: next.version,
        payloadDigest: next.recordDigest,
        occurredAt: next.updatedAt,
      });
      if (this.auditSequence(input.recordAuditEventId) !== next.auditSequence) {
        throw new StoreInvariantError('External execution update audit sequence changed');
      }
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_AUDIT_WRITE);
      this.updateExternalExecutionRecord(next);
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_WRITE);
      const persisted = this.getExternalExecution(next.id);
      if (persisted === undefined) {
        throw new StoreInvariantError(`External execution ${next.id} update was not readable`);
      }
      this.assertAuditEventsReadable([input.observationAuditEventId, input.recordAuditEventId]);
      return { status: 'APPLIED', value: persisted };
    });
  }

  public abandonExternalExecution(
    rawInput: AbandonExternalExecution,
  ): ExternalExecutionObservationStoreResult {
    this.assertOpen();
    const input = validateAbandonExternalExecution(rawInput);
    return this.runImmediate(() => {
      const current = this.getExternalExecution(input.externalExecutionId);
      if (current === undefined) {
        return {
          status: 'OBSERVATION_CONFLICT',
          message: `External execution ${input.externalExecutionId} does not exist`,
        };
      }
      if (
        current.state === ExternalExecutionState.COMPLETED ||
        current.state === ExternalExecutionState.INTERRUPTED ||
        current.state === ExternalExecutionState.FAILED ||
        current.state === ExternalExecutionState.ABANDONED
      ) {
        return current.state === ExternalExecutionState.ABANDONED &&
          current.failureCode === input.reasonCode
          ? { status: 'REPLAYED', value: current }
          : {
              status: 'TERMINAL',
              message: `External execution ${current.id} is already terminal`,
            };
      }
      if (current.version !== input.expectedRecordVersion) {
        return {
          status: 'VERSION_CONFLICT',
          message: `External execution ${current.id} changed before abandonment`,
        };
      }
      if (input.abandonedAt < current.updatedAt) {
        return {
          status: 'OBSERVATION_CONFLICT',
          message: `External execution ${current.id} abandonment predates current authority`,
        };
      }
      const maintenance = this.getExternalMaintenanceIntentForExecution(current.id, 1);
      if (maintenance?.state === ExternalMaintenanceState.AUTHORIZED) {
        return {
          status: 'OBSERVATION_CONFLICT',
          message: `External execution ${current.id} has active maintenance`,
        };
      }
      return {
        status: 'APPLIED',
        value: this.abandonExternalExecutionInsideTransaction(
          current,
          input.reasonCode,
          input.abandonedAt,
          input.auditEventId,
        ),
      };
    });
  }

  public authorizeExternalMaintenance(
    rawInput: AuthorizeExternalMaintenance,
  ): ExternalMaintenanceStoreResult {
    this.assertOpen();
    const input = validateAuthorizeExternalMaintenance(rawInput);
    const { intent } = input;
    if (
      intent.intentDigest !== this.externalMaintenanceIntentDigest(intent) ||
      intent.recordDigest !== this.externalMaintenanceRecordDigest(intent)
    ) {
      throw new StoreInvariantError('External maintenance authorization has false digests');
    }
    return this.runImmediate(() => {
      const byId = this.getExternalMaintenanceIntent(intent.id);
      const bySequence = this.getExternalMaintenanceIntentForExecution(
        intent.externalExecutionId,
        intent.sequence,
      );
      const existing = byId ?? bySequence;
      if (existing !== undefined) {
        return existing.id === intent.id && existing.intentDigest === intent.intentDigest
          ? { status: 'REPLAYED', value: existing }
          : {
              status: 'MAINTENANCE_CONFLICT',
              message: `External maintenance ${intent.id} conflicts with retained authority`,
            };
      }
      const execution = this.getExternalExecution(intent.externalExecutionId);
      if (
        execution?.compactionPolicy !== 'MANUAL_BEFORE_OPERATION' ||
        execution.state === ExternalExecutionState.COMPLETED ||
        execution.state === ExternalExecutionState.INTERRUPTED ||
        execution.state === ExternalExecutionState.FAILED ||
        execution.state === ExternalExecutionState.ABANDONED ||
        intent.sequence !== 1 ||
        intent.authorizedAt < execution.updatedAt
      ) {
        return {
          status: 'STATE_CONFLICT',
          message: `External execution ${intent.externalExecutionId} cannot authorize maintenance`,
        };
      }
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'EXTERNAL_MAINTENANCE',
        aggregateId: intent.id,
        eventType: 'EXTERNAL_MAINTENANCE_AUTHORIZED',
        afterVersion: 1,
        payloadDigest: intent.recordDigest,
        occurredAt: intent.authorizedAt,
      });
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_MAINTENANCE_AUDIT_WRITE);
      const auditSequence = this.auditSequence(input.auditEventId);
      this.#database
        .prepare(
          `INSERT INTO external_maintenance_intents(
             id, schema_version, external_execution_id, sequence, kind, state,
             authorized_at, observed_at, failure_code, intent_digest, record_digest,
             audit_sequence
           ) VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?)`,
        )
        .run(
          intent.id,
          intent.schemaVersion,
          intent.externalExecutionId,
          intent.sequence,
          intent.kind,
          intent.state,
          intent.authorizedAt,
          intent.intentDigest,
          intent.recordDigest,
          auditSequence,
        );
      this.probe(WorkerTransactionStep.AFTER_EXTERNAL_MAINTENANCE_WRITE);
      const persisted = this.getExternalMaintenanceIntent(intent.id);
      if (persisted === undefined) {
        throw new StoreInvariantError(`External maintenance ${intent.id} was not readable`);
      }
      this.assertAuditEventsReadable([input.auditEventId]);
      return { status: 'APPLIED', value: persisted };
    });
  }

  public completeExternalMaintenance(
    rawInput: CompleteExternalMaintenance,
  ): ExternalMaintenanceStoreResult {
    this.assertOpen();
    const input = validateCompleteExternalMaintenance(rawInput);
    return this.runImmediate(() => {
      const current = this.getExternalMaintenanceIntent(input.maintenanceIntentId);
      if (current === undefined) {
        return {
          status: 'MAINTENANCE_CONFLICT',
          message: `External maintenance ${input.maintenanceIntentId} does not exist`,
        };
      }
      if (current.state !== ExternalMaintenanceState.AUTHORIZED) {
        return current.state === input.state &&
          current.observedAt === input.observedAt &&
          current.failureCode === input.failureCode
          ? { status: 'REPLAYED', value: current }
          : {
              status: 'STATE_CONFLICT',
              message: `External maintenance ${current.id} is already terminal`,
            };
      }
      if (input.observedAt < current.authorizedAt) {
        return {
          status: 'STATE_CONFLICT',
          message: `External maintenance ${current.id} observation predates authorization`,
        };
      }
      return {
        status: 'APPLIED',
        value: this.completeExternalMaintenanceInsideTransaction(
          current,
          input.state,
          input.observedAt,
          input.failureCode,
          input.auditEventId,
        ),
      };
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
      this.#authorityIsolationLease?.assertProjectPathAllowed(input.goal.scope.projectPath);
      const existingRow = this.#database
        .prepare('SELECT * FROM processed_commands WHERE command_id = ?')
        .get(input.commandId);
      if (existingRow !== undefined) {
        const existing = decodeProcessedCommand(existingRow);
        this.validateProcessedCommandRecord(existing);
        if (existing.inputDigest !== input.inputDigest || existing.aggregateType !== 'GOAL') {
          throw new CommandIdConflictError(input.commandId);
        }
        return { status: 'REPLAYED', outcome: existing.outcome };
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
    if (input.event.type !== 'ATTEMPT_STARTED') {
      throw new StoreInvariantError('Context-bound commit requires an Attempt start event');
    }
    const startEvent = input.event;
    return this.runCommandImmediate(() => {
      const result = this.commitAttemptEventInsideTransaction(input);
      if (result.status === 'REPLAYED') {
        const existing = this.getContextManifest(input.contextManifest.id);
        const existingPolicyBinding = this.getWorkflowPolicyBinding(input.policyBinding.workflowId);
        const existingBinding = this.getExecutionProfileBinding(
          input.executionProfileBinding.workflowId,
        );
        const existingPlan = this.getAcceptanceCriticalVerificationPlan(
          input.executionProfileBinding.workflowId,
        );
        const existingProjectReadAuthority =
          input.projectReadAuthority === undefined
            ? undefined
            : this.getProjectSourceReadAuthority(input.projectReadAuthority.id);
        if (
          existing?.attemptId !== input.contextManifest.attemptId ||
          existingPolicyBinding === undefined ||
          canonicalizeJson(existingPolicyBinding) !== canonicalizeJson(input.policyBinding) ||
          existingBinding === undefined ||
          canonicalizeJson(existingBinding) !== canonicalizeJson(input.executionProfileBinding) ||
          canonicalizeJson(existingPlan) !==
            canonicalizeJson(input.acceptanceCriticalVerificationPlan) ||
          canonicalizeJson(existingProjectReadAuthority) !==
            canonicalizeJson(input.projectReadAuthority)
        ) {
          throw new StoreInvariantError(
            `Replayed Attempt ${input.contextManifest.attemptId} has no exact Context/Policy/Profile binding`,
          );
        }
        return result;
      }
      if (result.status !== 'APPLIED') {
        return result;
      }

      let persistedPolicyBinding: WorkflowPolicyBinding;
      let persistedBinding: ExecutionProfileBinding;
      let persistedPlan: AcceptanceCriticalVerificationPlan | undefined;
      let persistedProjectReadAuthority: ProjectSourceReadAuthorityRecord | undefined;
      if (startEvent.attempt.sequence === 1) {
        if (input.policyBindingAuditEventId === undefined) {
          throw new StoreInvariantError('First Worker Attempt has no Policy binding audit');
        }
        if (input.executionProfileBindingAuditEventId === undefined) {
          throw new StoreInvariantError('First Worker Attempt has no Profile binding audit');
        }
        this.insertWorkflowPolicyBinding(
          input.policyBinding,
          input.policyBindingAuditEventId,
          input.correlationId,
          input.causationId,
        );
        const insertedPolicy = this.getWorkflowPolicyBinding(input.policyBinding.workflowId);
        if (insertedPolicy === undefined) {
          throw new StoreInvariantError('Workflow Policy binding was not persisted readably');
        }
        persistedPolicyBinding = insertedPolicy;
        this.insertExecutionProfileBinding(
          input.executionProfileBinding,
          input.executionProfileBindingAuditEventId,
          input.correlationId,
          input.causationId,
        );
        const inserted = this.getExecutionProfileBinding(input.executionProfileBinding.workflowId);
        if (inserted === undefined) {
          throw new StoreInvariantError('Execution Profile binding was not persisted readably');
        }
        persistedBinding = inserted;
        if (input.acceptanceCriticalVerificationPlan !== undefined) {
          if (input.acceptanceCriticalVerificationPlanAuditEventId === undefined) {
            throw new StoreInvariantError('Protected Start has no Plan creation audit');
          }
          this.insertAcceptanceCriticalVerificationPlan(
            input.acceptanceCriticalVerificationPlan,
            input.acceptanceCriticalVerificationPlanAuditEventId,
            input.event.commandId,
            input.correlationId,
            input.causationId,
          );
          persistedPlan = this.getAcceptanceCriticalVerificationPlan(
            input.acceptanceCriticalVerificationPlan.workflowId,
          );
          if (
            persistedPlan === undefined ||
            canonicalizeJson(persistedPlan) !==
              canonicalizeJson(input.acceptanceCriticalVerificationPlan)
          ) {
            throw new StoreInvariantError('Protected Verification Plan was not retained exactly');
          }
        } else if (isProtectedContextManifest(input.contextManifest)) {
          throw new StoreInvariantError('First protected Context has no atomically created Plan');
        }
      } else {
        const existingPolicy = this.getWorkflowPolicyBinding(input.policyBinding.workflowId);
        if (
          existingPolicy === undefined ||
          canonicalizeJson(existingPolicy) !== canonicalizeJson(input.policyBinding)
        ) {
          throw new StoreInvariantError('Later Worker Attempt changed its Workflow Policy');
        }
        persistedPolicyBinding = existingPolicy;
        const existing = this.getExecutionProfileBinding(input.executionProfileBinding.workflowId);
        if (
          existing === undefined ||
          canonicalizeJson(existing) !== canonicalizeJson(input.executionProfileBinding)
        ) {
          throw new StoreInvariantError('Later Worker Attempt changed its Execution Profile');
        }
        persistedBinding = existing;
        persistedPlan = this.getAcceptanceCriticalVerificationPlan(
          input.executionProfileBinding.workflowId,
        );
        if (
          isProtectedContextManifest(input.contextManifest) !== (persistedPlan !== undefined) ||
          (persistedPlan !== undefined &&
            (input.contextManifest.acceptanceCriticalVerificationPlanId !== persistedPlan.id ||
              input.contextManifest.acceptanceCriticalVerificationPlanDigest !==
                persistedPlan.planDigest))
        ) {
          throw new StoreInvariantError('Later Worker Context changed protected Plan authority');
        }
      }

      if (input.projectReadAuthority !== undefined) {
        if (input.projectReadAuthorityAuditEventId === undefined) {
          throw new StoreInvariantError('Project-read Context has no authority audit');
        }
        this.insertProjectSourceReadAuthority(
          input.projectReadAuthority,
          input.projectReadAuthorityAuditEventId,
          input.event.commandId,
          input.contextManifest.createdAt,
          input.correlationId,
          input.causationId,
        );
        persistedProjectReadAuthority = this.getProjectSourceReadAuthority(
          input.projectReadAuthority.id,
        );
        if (
          persistedProjectReadAuthority === undefined ||
          canonicalizeJson(persistedProjectReadAuthority) !==
            canonicalizeJson(input.projectReadAuthority)
        ) {
          throw new StoreInvariantError('Project-source read authority was not retained exactly');
        }
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
          policyBinding: persistedPolicyBinding,
          executionProfileBinding: persistedBinding,
          ...(persistedPlan === undefined
            ? {}
            : { acceptanceCriticalVerificationPlan: persistedPlan }),
          ...(persistedProjectReadAuthority === undefined
            ? {}
            : { projectReadAuthority: persistedProjectReadAuthority }),
        }),
      };
    });
  }

  public commitStartupRecovery(
    rawInput: CommitStartupRecovery,
  ): StoreCommandResult<CommittedStartupRecovery> {
    this.assertOpen();
    const input = validateCommitStartupRecovery(rawInput);
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
      const currentAttempt = this.getAttemptInsideTransaction(input.event.attemptId);
      this.assertAttemptControlEventAfterDispatchClaim(
        currentAttempt,
        currentWorkflow.id,
        currentWorkflow.version,
        input.event.occurredAt,
      );
      const applied = applyAttemptEvent(currentWorkflow, currentAttempt, input.event);
      this.assertRecoveryMatchesCurrentAuthority(input.recovery, currentWorkflow, currentAttempt);
      this.insertRecoveryReconciliation(input.recovery);
      this.probe(RecoveryTransactionStep.AFTER_RECOVERY_RECORD_WRITE);

      const externalRecoveryAuditIds: AuditEventId[] = [];
      const externalExecution = this.hasTable('external_execution_records')
        ? this.getExternalExecutionForAttempt(currentAttempt.id)
        : undefined;
      if (
        externalExecution !== undefined &&
        externalExecution.state !== ExternalExecutionState.COMPLETED &&
        externalExecution.state !== ExternalExecutionState.INTERRUPTED &&
        externalExecution.state !== ExternalExecutionState.FAILED &&
        externalExecution.state !== ExternalExecutionState.ABANDONED
      ) {
        if (input.externalExecutionAuditEventId === undefined) {
          throw new StoreInvariantError(
            'Startup recovery lacks external-execution abandonment audit authority',
          );
        }
        const maintenance = this.getExternalMaintenanceIntentForExecution(externalExecution.id, 1);
        if (maintenance?.state === ExternalMaintenanceState.AUTHORIZED) {
          if (input.externalMaintenanceAuditEventId === undefined) {
            throw new StoreInvariantError(
              'Startup recovery lacks external-maintenance abandonment audit authority',
            );
          }
          this.completeExternalMaintenanceInsideTransaction(
            maintenance,
            ExternalMaintenanceState.ABANDONED,
            input.event.occurredAt,
            ExternalMaintenanceFailureReasonCode.RECOVERY_ABANDONED_ACTIVE_DISPATCH,
            input.externalMaintenanceAuditEventId,
          );
          externalRecoveryAuditIds.push(input.externalMaintenanceAuditEventId);
        }
        this.abandonExternalExecutionInsideTransaction(
          externalExecution,
          ExternalExecutionAbandonReasonCode.RECOVERY_ABANDONED_ACTIVE_DISPATCH,
          input.event.occurredAt,
          input.externalExecutionAuditEventId,
        );
        externalRecoveryAuditIds.push(input.externalExecutionAuditEventId);
      }

      this.updateTerminalAttempt(currentAttempt, applied.attempt);
      this.updateWorkflow(currentWorkflow, applied.workflow);
      this.probe(RecoveryTransactionStep.AFTER_RECOVERY_STATE_WRITE);

      this.insertAttemptAndWorkflowAudits(input, applied);
      this.insertRecoveryAudit(
        input.recovery,
        input.recoveryAuditEventId,
        input.event.commandId,
        input.correlationId,
        input.causationId,
      );
      this.probe(RecoveryTransactionStep.AFTER_RECOVERY_AUDIT_WRITE);
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

      const persistedOwner = this.getGoalWithWorkflow(applied.workflow.goalId);
      const persistedAttempt = this.getAttempt(applied.attempt.id);
      const persistedRecovery = this.getRecoveryReconciliation(input.recovery.id);
      if (
        persistedOwner === undefined ||
        persistedAttempt === undefined ||
        persistedRecovery === undefined
      ) {
        throw new StoreInvariantError('Startup recovery did not round-trip exact authority');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.event.commandId,
        input.inputDigest,
        input.target,
        persistedOwner.goal.id,
        persistedOwner.workflow.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.auditEventId,
        input.workflowAuditEventId,
        input.recoveryAuditEventId,
        ...externalRecoveryAuditIds,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          goal: persistedOwner.goal,
          workflow: persistedOwner.workflow,
          attempt: persistedAttempt,
          recovery: persistedRecovery,
        }),
      };
    });
  }

  public commitResumeRecovery(
    rawInput: CommitResumeRecovery,
  ): StoreCommandResult<CommittedResumeRecovery> {
    this.assertOpen();
    const input = validateCommitResumeRecovery(rawInput);
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

      const currentWorkflow = this.getWorkflowInsideTransaction(input.event.workflowId);
      this.validateCommandTarget(input.target, currentWorkflow);
      if (currentWorkflow.version !== input.event.fromVersion) {
        throw new OptimisticConcurrencyError('Workflow', currentWorkflow.id);
      }
      const sourceAttempt =
        input.recovery.sourceAttemptId === undefined
          ? undefined
          : this.getAttemptInsideTransaction(input.recovery.sourceAttemptId);
      if (sourceAttempt === undefined) {
        throw new StoreInvariantError('Resume recovery requires one exact source Attempt');
      }
      const nextWorkflow = applyRecoveryWorkflowEvent(currentWorkflow, input.event);
      this.assertRecoveryMatchesCurrentAuthority(input.recovery, currentWorkflow, sourceAttempt);
      this.insertRecoveryReconciliation(input.recovery);
      this.probe(RecoveryTransactionStep.AFTER_RECOVERY_RECORD_WRITE);

      this.updateWorkflow(currentWorkflow, nextWorkflow);
      this.probe(RecoveryTransactionStep.AFTER_RECOVERY_STATE_WRITE);

      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: currentWorkflow.id,
        eventType: input.event.type,
        commandId: input.commandId,
        beforeVersion: input.event.fromVersion,
        afterVersion: input.event.toVersion,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.event.occurredAt,
      });
      this.insertRecoveryAudit(
        input.recovery,
        input.recoveryAuditEventId,
        input.commandId,
        input.correlationId,
        input.causationId,
      );
      this.probe(RecoveryTransactionStep.AFTER_RECOVERY_AUDIT_WRITE);
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, nextWorkflow, input.commandId),
      );
      this.insertProcessedCommand(
        input.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.event.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedOwner = this.getGoalWithWorkflow(nextWorkflow.goalId);
      const persistedRecovery = this.getRecoveryReconciliation(input.recovery.id);
      if (persistedOwner === undefined || persistedRecovery === undefined) {
        throw new StoreInvariantError('Resume recovery did not round-trip exact authority');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.commandId,
        input.inputDigest,
        input.target,
        persistedOwner.goal.id,
        persistedOwner.workflow.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([input.auditEventId, input.recoveryAuditEventId]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          goal: persistedOwner.goal,
          workflow: persistedOwner.workflow,
          recovery: persistedRecovery,
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
          status: 'COMMAND_CONFLICT',
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

  public commitVerificationIntegrityFailure(
    rawInput: CommitVerificationIntegrityFailure,
  ): StoreCommandResult<CommittedVerificationIntegrityFailure> {
    this.assertOpen();
    const input = validateCommitVerificationIntegrityFailure(rawInput);
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
        throw new StoreInvariantError(
          'Verification integrity failure requires an Attempt finish event',
        );
      }
      const currentAttempt = this.getAttemptInsideTransaction(input.event.attemptId);
      const applied = applyAttemptEvent(currentWorkflow, currentAttempt, input.event);
      const authority = this.getCandidateAuthorityForWorkflow(currentWorkflow.id);
      if (
        authority?.generation.id !== input.candidateEvent.candidateGenerationId ||
        authority.generation.version !== input.candidateEvent.fromVersion ||
        authority.generation.frozenDigest !== input.expectedFrozenDigest
      ) {
        throw new StoreInvariantError(
          'Verification integrity failure targets stale Candidate authority',
        );
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
          'Verification integrity audit digest does not bind its source observation',
        );
      }
      const nextGeneration = applyCandidateEvent(authority.generation, input.candidateEvent);
      const eligibleEvidence = this.listEvidenceForGeneration(authority.generation.id).filter(
        ({ eligibility }) => eligibility.state === EvidenceEligibilityState.ELIGIBLE,
      );
      if (input.invalidatedEvidenceAuditEventIds.length !== eligibleEvidence.length) {
        throw new StoreInvariantError(
          'Verification integrity failure requires one audit identity per eligible Evidence record',
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

      const persistedWorkflow = this.getWorkflowInsideTransaction(applied.workflow.id);
      const persistedAttempt = this.getAttemptInsideTransaction(applied.attempt.id);
      const persistedAuthority = this.getCandidateAuthorityForWorkflow(applied.workflow.id);
      if (
        persistedAttempt.status !== AttemptStatus.FAILED ||
        persistedWorkflow.runStatus !== RunStatus.FAILED ||
        persistedAuthority?.generation.state !== CandidateGenerationState.INVALIDATED
      ) {
        throw new StoreInvariantError('Verification integrity failure did not round-trip');
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
        input.candidateAuditEventId,
        ...input.invalidatedEvidenceAuditEventIds,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          workflow: persistedWorkflow,
          attempt: persistedAttempt,
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

  public commitLocalCommandVerificationAuthority(
    rawInput: CommitLocalCommandVerificationAuthority,
  ): StoreCommandResult<CommittedLocalCommandVerificationAuthority> {
    this.assertOpen();
    const input = validateCommitLocalCommandVerificationAuthority(rawInput);
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
      if (workflow.version !== input.expectedWorkflowVersion) {
        throw new OptimisticConcurrencyError('Workflow', workflow.id);
      }
      if (
        workflow.phase !== WorkflowPhase.EVIDENCE_BUILD ||
        workflow.activeAttemptId !== undefined
      ) {
        throw new StoreInvariantError(
          'Local verification authority requires idle EVIDENCE_BUILD state',
        );
      }
      const authority = this.getCandidateAuthorityForWorkflow(workflow.id);
      const goal = this.getGoal(workflow.goalId);
      if (authority?.generation.state !== CandidateGenerationState.FROZEN || goal === undefined) {
        throw new StoreInvariantError(
          'Local verification authority requires the current frozen Candidate',
        );
      }
      const verification = input.checkSpecification;
      if (verification.kind !== CheckSpecificationKind.LOCAL_COMMAND) {
        throw new StoreInvariantError('Local verification authority changed Check kind');
      }
      const policy = validateLocalCommandVerificationPolicy(
        goal,
        authority.generation,
        {
          verification,
          obligations: input.obligations,
        },
        input.occurredAt,
      );
      if (
        this.getCheckSpecification(policy.verification.id) !== undefined ||
        this.listVerificationObligations(goal.id).some(
          (obligation) =>
            obligation.candidateGenerationId === authority.generation.id &&
            obligation.requiredEvidenceKind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT,
        )
      ) {
        throw new StoreInvariantError(
          'Local verification authority already exists for this Candidate generation',
        );
      }
      const expectedPayloadDigest = sha256Digest(
        canonicalAuthorityDigests.digest({
          workflowId: workflow.id,
          workflowVersion: workflow.version,
          checkSpecification: policy.verification,
          obligations: policy.obligations,
          occurredAt: input.occurredAt,
        }),
      );
      if (input.payloadDigest !== expectedPayloadDigest) {
        throw new StoreInvariantError('Local verification authority audit digest is incomplete');
      }
      this.insertAuditEvent({
        id: input.auditEventId,
        aggregateType: 'WORKFLOW',
        aggregateId: workflow.id,
        eventType: 'LOCAL_COMMAND_VERIFICATION_AUTHORITY_RECORDED',
        commandId: input.commandId,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.occurredAt,
      });
      this.insertAuditEvent({
        id: input.checkSpecificationAuditEventId,
        aggregateType: 'CHECK_SPECIFICATION',
        aggregateId: policy.verification.id,
        eventType: 'CHECK_SPECIFICATION_RECORDED',
        commandId: input.commandId,
        ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
        ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
        payloadDigest: input.payloadDigest,
        occurredAt: input.occurredAt,
      });
      this.#database
        .prepare('INSERT INTO check_specifications(id, version, canonical_json) VALUES (?, ?, ?)')
        .run(
          policy.verification.id,
          policy.verification.version,
          serializeJson(decodeJsonValue(policy.verification)),
        );
      policy.obligations.forEach((obligation, index) => {
        const auditIdentifier = input.obligationAuditEventIds[index];
        if (auditIdentifier === undefined) {
          throw new StoreInvariantError('Local Verification Obligation audit ID is missing');
        }
        this.insertAuditEvent({
          id: auditIdentifier,
          aggregateType: 'VERIFICATION_OBLIGATION',
          aggregateId: obligation.id,
          eventType: 'VERIFICATION_OBLIGATION_RECORDED',
          commandId: input.commandId,
          ...(input.correlationId === undefined ? {} : { correlationId: input.correlationId }),
          ...(input.causationId === undefined ? {} : { causationId: input.causationId }),
          payloadDigest: input.payloadDigest,
          occurredAt: input.occurredAt,
        });
        this.insertVerificationObligation(obligation);
      });
      this.probe(TransactionStep.AFTER_AUDIT_APPEND);

      const outcome = storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(input.target, workflow, input.commandId),
      );
      this.insertProcessedCommand(
        input.commandId,
        input.inputDigest,
        input.target.aggregateType,
        input.target.aggregateId,
        serializeJson(outcome),
        input.occurredAt,
      );
      this.probe(TransactionStep.AFTER_COMMAND_RECORD);
      this.probe(TransactionStep.BEFORE_COMMIT);

      const persistedCheck = this.getCheckSpecification(policy.verification.id);
      const persistedObligations = policy.obligations.map((obligation) =>
        this.getVerificationObligation(obligation.id),
      );
      if (
        persistedCheck === undefined ||
        canonicalizeJson(persistedCheck) !== canonicalizeJson(policy.verification) ||
        persistedObligations.some((obligation) => obligation === undefined)
      ) {
        throw new StoreInvariantError('Local verification authority did not round-trip');
      }
      const persistedCommand = this.assertProcessedCommandReadable(
        input.commandId,
        input.inputDigest,
        input.target,
        workflow.goalId,
        workflow.id,
        StoredCommandDisposition.APPLIED,
      );
      this.assertAuditEventsReadable([
        input.auditEventId,
        input.checkSpecificationAuditEventId,
        ...input.obligationAuditEventIds,
      ]);
      return {
        status: 'APPLIED',
        outcome: persistedCommand.outcome,
        value: Object.freeze({
          workflow,
          checkSpecification: persistedCheck,
          obligations: Object.freeze(
            persistedObligations.filter(
              (obligation): obligation is VerificationObligation => obligation !== undefined,
            ),
          ),
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
        `${evidence.checkSpec.id}@${evidence.checkSpec.version}` !== obligation.checkSpecRef ||
        evidence.startedAt < obligation.createdAt
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
      for (const payload of input.payloads ?? []) {
        this.insertEvidencePayload(payload);
      }
      if (input.payloads !== undefined) {
        this.probe(CandidateEvidenceTransactionStep.AFTER_EVIDENCE_PAYLOAD_WRITE);
      }
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
      if (
        persistedEvidence.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT &&
        persistedEvidence.payloadRefs.some(
          (reference) =>
            this.getEvidencePayload(reference.digest, reference.byteLength) === undefined,
        )
      ) {
        throw new StoreInvariantError(
          `Verification Evidence ${evidence.id} payloads did not round-trip`,
        );
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
      const manifest = this.requireAcceptanceManifest(input.repair.inputManifestDigest);
      const decision = this.requireAcceptanceDecision(input.repair.acceptanceDecisionId);
      const compiled = this.assertCurrentAcceptanceDecision(manifest, decision);
      const oldGeneration = compiled.authority.generation;
      const currentCandidate = this.getCandidateForGoal(compiled.authority.goal.id);
      if (input.event.type !== 'WORKFLOW_PHASE_TRANSITIONED') {
        throw new StoreInvariantError('Repair requires a phase transition event');
      }
      if (
        decision.outcome !== AcceptanceOutcome.REJECT_REPAIRABLE ||
        input.event.occurredAt < decision.issuedAt ||
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
      const candidatePolicy = validateM1CandidateEvidencePolicy(
        compiled.authority.goal,
        input.generation,
        { freeze, verification, obligations: input.obligations },
        input.generation.createdAt,
      );
      const nextWorkflow = applyWorkflowEvent(current, input.event);
      const rejectedGeneration = applyCandidateEvent(oldGeneration, input.rejectedCandidateEvent);
      const expectedRepairFields = Object.freeze({
        schemaVersion: 1 as const,
        goalId: compiled.authority.goal.id,
        goalRevision: compiled.authority.goal.revision,
        workflowId: current.id,
        workflowVersion: nextWorkflow.version,
        acceptanceDecisionId: decision.id,
        acceptanceDecisionDigest: decision.decisionDigest,
        inputManifestDigest: manifest.manifestDigest,
        rejectedCandidateGenerationId: oldGeneration.id,
        rejectedCandidateVersion: rejectedGeneration.version,
        rejectedCandidateDigest: oldGeneration.frozenDigest,
        repairCandidateGenerationId: input.generation.id,
        repairCandidateSequence: input.generation.sequence,
        repairCandidateBaseDigest: input.generation.baseDigest,
        freezeCheckId: candidatePolicy.freeze.id,
        freezeCheckVersion: candidatePolicy.freeze.version,
        verificationCheckId: candidatePolicy.verification.id,
        verificationCheckVersion: candidatePolicy.verification.version,
        verificationObligationIds: Object.freeze(
          candidatePolicy.obligations.map((obligation) => obligation.id),
        ),
        evidenceSetDigest: manifest.evidenceSetDigest,
        policyBundleId: manifest.policyBundleId,
        policyBundleDigest: manifest.policyBundleDigest,
        repairedAt: input.event.occurredAt,
      });
      const expectedRepair = decodeAcceptanceRepairRecord({
        ...expectedRepairFields,
        repairDigest: sha256Digest(
          canonicalAuthorityDigests.digest(acceptanceRepairRecordProjection(expectedRepairFields)),
        ),
      });
      if (
        canonicalizeJson(input.repair) !== canonicalizeJson(expectedRepair) ||
        input.payloadDigest !== expectedRepair.repairDigest
      ) {
        throw new StoreInvariantError('Repair record does not bind the exact current authority');
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
      this.insertAuditEvent({
        id: input.repairAuditEventId,
        aggregateType: 'ACCEPTANCE_REPAIR',
        aggregateId: input.repair.rejectedCandidateGenerationId,
        eventType: 'ACCEPTANCE_REPAIR_RECORDED',
        commandId: input.event.commandId,
        payloadDigest: input.repair.repairDigest,
        occurredAt: input.repair.repairedAt,
        ...auditTrace,
      });
      this.insertAcceptanceRepair(input.repair);
      this.probe(AcceptanceTransactionStep.AFTER_REPAIR_RECORD_WRITE);
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
      const repair = this.getAcceptanceRepairForRejectedGeneration(oldGeneration.id);
      if (authority?.generation.id !== input.generation.id || repair === undefined) {
        throw new StoreInvariantError('Acceptance repair authority did not round-trip');
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
        input.repairAuditEventId,
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
          repair,
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
           candidate_digest, fact_snapshot_digest, workspace_lease_id,
           workspace_lease_digest, policy_bundle_digest,
           check_spec_json, environment_identity_json, started_at, ended_at,
           observation_json, payload_refs_json, observation_digest, result_status,
           recorded_at, record_digest, policy_bundle_id,
           acceptance_critical_verification_plan_id,
           acceptance_critical_verification_plan_digest,
           protected_asset_manifest_digest, protected_asset_read_lease_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT ? record.workspaceLeaseId : null,
        record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT ? record.workspaceLeaseDigest : null,
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
        record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT && record.schemaVersion === 3
          ? record.acceptanceCriticalVerificationPlanId
          : null,
        record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT && record.schemaVersion === 3
          ? record.acceptanceCriticalVerificationPlanDigest
          : null,
        record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT && record.schemaVersion === 3
          ? record.protectedAssetManifestDigest
          : null,
        record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT && record.schemaVersion === 3
          ? record.protectedAssetReadLeaseDigest
          : null,
      );
  }

  private insertEvidencePayload(payload: EvidencePayload): void {
    const rawExisting: unknown = this.#database
      .prepare('SELECT payload_bytes FROM evidence_payloads WHERE digest = ? AND byte_length = ?')
      .get(payload.digest, payload.byteLength);
    if (rawExisting !== undefined) {
      const { payload_bytes: rawBytes } = evidencePayloadBytesRowSchema.parse(rawExisting);
      if (!Buffer.from(rawBytes).equals(Buffer.from(payload.bytes))) {
        throw new StoreInvariantError('Evidence payload digest collision detected');
      }
      return;
    }
    this.#database
      .prepare('INSERT INTO evidence_payloads(digest, byte_length, payload_bytes) VALUES (?, ?, ?)')
      .run(payload.digest, payload.byteLength, Buffer.from(payload.bytes));
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
           policy_bundle_digest, created_at,
           acceptance_critical_verification_plan_id,
           acceptance_critical_verification_plan_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        manifest.manifestDigest,
        1,
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
        manifest.schemaVersion === 2 ? manifest.acceptanceCriticalVerificationPlanId : null,
        manifest.schemaVersion === 2 ? manifest.acceptanceCriticalVerificationPlanDigest : null,
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

  private insertAcceptanceRepair(repair: AcceptanceRepairRecord): void {
    this.#database
      .prepare(
        `INSERT INTO acceptance_repairs(
           rejected_candidate_generation_id, schema_version, goal_id, goal_revision,
           workflow_id, workflow_version, acceptance_decision_id,
           acceptance_decision_digest, input_manifest_digest, rejected_candidate_version,
           rejected_candidate_digest, repair_candidate_generation_id,
           repair_candidate_sequence, repair_candidate_base_digest, freeze_check_id,
           freeze_check_version, verification_check_id, verification_check_version,
           verification_obligation_ids_json, evidence_set_digest, policy_bundle_id,
           policy_bundle_digest, repaired_at, repair_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        repair.rejectedCandidateGenerationId,
        repair.schemaVersion,
        repair.goalId,
        repair.goalRevision,
        repair.workflowId,
        repair.workflowVersion,
        repair.acceptanceDecisionId,
        repair.acceptanceDecisionDigest,
        repair.inputManifestDigest,
        repair.rejectedCandidateVersion,
        repair.rejectedCandidateDigest,
        repair.repairCandidateGenerationId,
        repair.repairCandidateSequence,
        repair.repairCandidateBaseDigest,
        repair.freezeCheckId,
        repair.freezeCheckVersion,
        repair.verificationCheckId,
        repair.verificationCheckVersion,
        serializeJson(decodeJsonValue(repair.verificationObligationIds)),
        repair.evidenceSetDigest,
        repair.policyBundleId,
        repair.policyBundleDigest,
        repair.repairedAt,
        repair.repairDigest,
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
        (attempt.phase === WorkflowPhase.EVIDENCE_BUILD &&
          (record.kind === EvidenceKind.TEST_RESULT ||
            record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT))
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
    const policyBinding = this.getWorkflowPolicyBinding(record.workflowId);
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
    const matchingObligation = this.listVerificationObligations(record.goalId).find(
      (obligation) =>
        obligation.id === record.verificationObligationId &&
        obligation.goalRevision === record.goalRevision &&
        obligation.requiredEvidenceKind === record.kind &&
        obligation.checkSpecRef === `${record.checkSpec.id}@${record.checkSpec.version}`,
    );
    const hasLocalPayloads =
      record.kind !== EvidenceKind.LOCAL_COMMAND_TEST_RESULT ||
      record.payloadRefs.every(
        (reference) =>
          this.getEvidencePayload(reference.digest, reference.byteLength) !== undefined,
      );
    if (
      attempt === undefined ||
      workflow === undefined ||
      policyBinding === undefined ||
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
      policyBinding.goalId !== record.goalId ||
      policyBinding.policyBundleId !== record.policyBundleId ||
      policyBinding.policyBundleDigest !== record.policyBundleDigest ||
      policyBinding.boundAt > record.recordedAt ||
      policy.bundle.digest !== record.policyBundleDigest ||
      policy.installedAt > record.startedAt ||
      !hasLocalPayloads ||
      (record.kind !== EvidenceKind.CANDIDATE_FREEZE && !matchingObligation) ||
      (record.kind !== EvidenceKind.CANDIDATE_FREEZE &&
        matchingObligation !== undefined &&
        record.startedAt < matchingObligation.createdAt) ||
      canonicalizeJson(specification) !== canonicalizeJson(record.checkSpec)
    ) {
      throw new StoreInvariantError(`Evidence ${record.id} has stale authority bindings`);
    }
    return record;
  }

  private assertEvidenceSetBindingsCurrent(set: EvidenceSet): void {
    const allObligations = this.listVerificationObligations(set.goalId).filter(
      (obligation) =>
        obligation.goalRevision === set.goalRevision &&
        obligation.candidateGenerationId === set.candidateGenerationId,
    );
    const mappingById = new Map(
      set.obligationMappings.map((mapping) => [mapping.obligationId, mapping]),
    );
    const mappedObligations = allObligations.filter((obligation) => mappingById.has(obligation.id));
    const mappedCheckRefs = new Set(mappedObligations.map((obligation) => obligation.checkSpecRef));
    const selectedCheckRef =
      mappedCheckRefs.size === 1 ? mappedObligations[0]?.checkSpecRef : undefined;
    const obligations =
      selectedCheckRef === undefined
        ? Object.freeze([])
        : allObligations.filter((obligation) => obligation.checkSpecRef === selectedCheckRef);
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
      set.evidenceRefs.every((reference) => {
        const policy = this.getEvidence(reference.evidenceId)?.checkSpec.cleanupPolicy;
        return (
          policy === 'M1_LOGICAL_NO_EXTERNAL_RESOURCES' || policy === 'LOCAL_COMMAND_RUN_ROOT_V1'
        );
      });
    if (!cleanupProven) {
      throw new StoreInvariantError('Evidence Set transition lacks cleanup authority');
    }
    const cleanupPolicies = new Set(
      set.evidenceRefs.map(
        (reference) => this.getEvidence(reference.evidenceId)?.checkSpec.cleanupPolicy,
      ),
    );
    if (cleanupPolicies.size !== 1) {
      throw new StoreInvariantError('Evidence Set transition mixes cleanup authority families');
    }
    const cleanupReasonCode = cleanupPolicies.has('LOCAL_COMMAND_RUN_ROOT_V1')
      ? 'LOCAL_COMMAND_CLEANUP_PROVEN'
      : 'M1_LOGICAL_CLEANUP_PROVEN';
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
        reasonCode: cleanupReasonCode,
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
    const allObligations = this.listVerificationObligations(set.goalId).filter(
      (obligation) =>
        obligation.goalRevision === set.goalRevision &&
        obligation.candidateGenerationId === set.candidateGenerationId,
    );
    const mappedIds = new Set(set.obligationMappings.map((mapping) => mapping.obligationId));
    const mappedObligations = allObligations.filter((obligation) => mappedIds.has(obligation.id));
    const mappedCheckRefs = new Set(mappedObligations.map((obligation) => obligation.checkSpecRef));
    const selectedCheckRef =
      mappedCheckRefs.size === 1 ? mappedObligations[0]?.checkSpecRef : undefined;
    const obligations =
      selectedCheckRef === undefined
        ? Object.freeze([])
        : allObligations.filter((obligation) => obligation.checkSpecRef === selectedCheckRef);
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
      return reject();
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

  private assertProjectReadCleanupGrantEligibility(
    grant: ProjectReadSnapshotCleanupGrant,
    snapshot: ProjectReadWorkspaceAuthoritySnapshot,
  ): void {
    if (grant.eligibilityKind === 'ORPHANED') {
      const observation = this.getProjectReadWorkspaceObservation(grant.workspaceObservationId);
      const collision = this.#database
        .prepare(
          `SELECT 1 FROM project_source_read_authorities
            WHERE id = ? OR snapshot_id = ? OR snapshot_leaf_realpath = ?
            LIMIT 1`,
        )
        .get(grant.projectReadAuthorityId, grant.snapshotId, grant.snapshotLeafRealpath);
      if (observation === undefined || collision !== undefined) {
        throw new TypeError(
          'Project-read orphan cleanup Grant lacks a current absent authority identity',
        );
      }
      assertOrphanedProjectReadSnapshotCleanupGrantEligibility(grant, snapshot, observation);
      return;
    }
    const record = this.getProjectSourceReadAuthority(grant.projectReadAuthorityId);
    const attempt = this.getAttempt(grant.attemptId);
    const execution = this.getExternalExecution(grant.externalExecutionId);
    if (
      record === undefined ||
      attempt === undefined ||
      attempt.status === AttemptStatus.RUNNING ||
      execution?.terminalAt === undefined ||
      (execution.state !== ExternalExecutionState.COMPLETED &&
        execution.state !== ExternalExecutionState.INTERRUPTED &&
        execution.state !== ExternalExecutionState.FAILED &&
        execution.state !== ExternalExecutionState.ABANDONED)
    ) {
      throw new TypeError('Project-read terminal cleanup Grant lacks retained terminal authority');
    }
    assertTerminalProjectReadSnapshotCleanupGrantEligibility(
      grant,
      snapshot,
      record,
      Object.freeze({ id: attempt.id, status: attempt.status, endedAt: attempt.endedAt }),
      Object.freeze({
        id: execution.id,
        attemptId: execution.attemptId,
        state: execution.state,
        terminalAt: execution.terminalAt,
        recordDigest: execution.recordDigest,
      }),
    );
  }

  private getProjectReadSnapshotCleanupObservationInsideTransaction(
    rawId: string,
  ): ProjectReadSnapshotCleanupObservation | undefined {
    const row = this.#database
      .prepare('SELECT * FROM project_read_snapshot_cleanup_observations WHERE id = ?')
      .get(rawId);
    if (row === undefined) {
      return undefined;
    }
    const parsed = z
      .object({
        schema_version: z.literal(1),
        grant_id: z.string(),
        grant_digest: z.string(),
        disposition: z.string(),
        observed_at: z.string(),
        canonical_json: z.string(),
        observation_digest: z.string(),
        audit_sequence: z.number().int().positive(),
      })
      .parse(row);
    const observation = decodeProjectReadSnapshotCleanupObservation(
      parseJson(parsed.canonical_json, 'project-read cleanup observation'),
    );
    if (
      observation.id !== rawId ||
      observation.grantId !== parsed.grant_id ||
      observation.grantDigest !== parsed.grant_digest ||
      observation.disposition !== parsed.disposition ||
      observation.observedAt !== parsed.observed_at ||
      observation.observationDigest !== parsed.observation_digest
    ) {
      throw new StoreInvariantError(`Project-read cleanup observation ${rawId} changed columns`);
    }
    this.assertProjectReadCleanupAudit(
      parsed.audit_sequence,
      'PROJECT_READ_SNAPSHOT_CLEANUP_OBSERVATION',
      observation.id,
      'PROJECT_READ_SNAPSHOT_CLEANUP_OBSERVED',
      observation.observationDigest,
      observation.observedAt,
    );
    return observation;
  }

  private assertProjectReadCleanupAudit(
    sequence: number,
    aggregateType: string,
    aggregateId: string,
    eventType: string,
    payloadDigest: Sha256Digest,
    occurredAt: IsoTimestamp,
  ): void {
    const row = this.#database
      .prepare(
        `SELECT id, sequence, aggregate_type, aggregate_id, event_type, actor_type,
                command_id, before_version, after_version, correlation_id, causation_id,
                payload_digest, occurred_at
           FROM audit_events WHERE sequence = ?`,
      )
      .get(sequence);
    const audit = row === undefined ? undefined : decodeAuditEvent(row);
    if (
      audit?.aggregateType !== aggregateType ||
      audit.aggregateId !== aggregateId ||
      audit.eventType !== eventType ||
      audit.actorType !== 'RUNTIME' ||
      audit.payloadDigest !== payloadDigest ||
      audit.occurredAt !== occurredAt
    ) {
      throw new StoreInvariantError(
        `Project-read cleanup authority ${aggregateType}/${aggregateId} lost its exact audit`,
      );
    }
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

  private insertExternalExecutionRecord(record: ExternalExecutionRecord): void {
    this.#database
      .prepare(
        `INSERT INTO external_execution_records(
           id, schema_version, version, state, goal_id, goal_revision, workflow_id,
           workflow_version_at_authorization, phase, phase_version, attempt_id,
           worker_session_id, dispatch_claim_digest, context_manifest_id,
           context_manifest_digest, context_package_digest, execution_profile_id,
           execution_profile_digest, policy_bundle_id, policy_bundle_digest, backend_kind,
           binary_identity_digest, binary_protocol_schema_digest, execution_config_digest,
           managed_requirements_digest,
           instruction_source_manifest_digest, controlled_state_root_identity, thread_json,
           continuity_policy, compaction_policy, retention_policy, fallback_policy,
           interruption_policy, candidate_workspace_lease_id, candidate_workspace_lease_digest,
           candidate_workspace_cwd_identity, authorized_at, intent_digest, process_launch_nonce,
           process_identity_json, backend_session_ref, backend_operation_ref, compaction_count,
           turn_interrupt_count, failure_code,
           result_event_id, updated_at, terminal_at, last_observation_id, audit_sequence,
           record_digest
         ) VALUES (
           @id, @schemaVersion, @version, @state, @goalId, @goalRevision, @workflowId,
           @workflowVersionAtAuthorization, @phase, @phaseVersion, @attemptId,
           @workerSessionId, @dispatchClaimDigest, @contextManifestId,
           @contextManifestDigest, @contextPackageDigest, @executionProfileId,
           @executionProfileDigest, @policyBundleId, @policyBundleDigest, @backendKind,
           @binaryIdentityDigest, @binaryProtocolSchemaDigest, @executionConfigDigest,
           @managedRequirementsDigest,
           @instructionSourceManifestDigest, @controlledStateRootIdentity, @threadJson,
           @continuityPolicy, @compactionPolicy, @retentionPolicy, @fallbackPolicy,
           @interruptionPolicy, @candidateWorkspaceLeaseId, @candidateWorkspaceLeaseDigest,
           @candidateWorkspaceCwdIdentity, @authorizedAt, @intentDigest, @processLaunchNonce,
           @processIdentityJson, @backendSessionRef, @backendOperationRef, @compactionCount,
           @turnInterruptCount, @failureCode,
           @resultEventId, @updatedAt, @terminalAt, @lastObservationId, @auditSequence,
           @recordDigest
         )`,
      )
      .run({
        id: record.id,
        schemaVersion: record.schemaVersion,
        version: record.version,
        state: record.state,
        goalId: record.goalId,
        goalRevision: record.goalRevision,
        workflowId: record.workflowId,
        workflowVersionAtAuthorization: record.workflowVersionAtAuthorization,
        phase: record.phase,
        phaseVersion: record.phaseVersion,
        attemptId: record.attemptId,
        workerSessionId: record.workerSessionId,
        dispatchClaimDigest: record.dispatchClaimDigest,
        contextManifestId: record.contextManifestId,
        contextManifestDigest: record.contextManifestDigest,
        contextPackageDigest: record.contextPackageDigest,
        executionProfileId: record.executionProfileId,
        executionProfileDigest: record.executionProfileDigest,
        policyBundleId: record.policyBundleId,
        policyBundleDigest: record.policyBundleDigest,
        backendKind: record.backendKind,
        binaryIdentityDigest: record.binaryIdentityDigest,
        binaryProtocolSchemaDigest: record.binaryProtocolSchemaDigest,
        executionConfigDigest: record.executionConfigDigest,
        managedRequirementsDigest: record.managedRequirementsDigest,
        instructionSourceManifestDigest: record.instructionSourceManifestDigest,
        controlledStateRootIdentity: record.controlledStateRootIdentity,
        processLaunchNonce: record.processLaunchNonce,
        threadJson: serializeJson(record.thread),
        continuityPolicy: record.continuityPolicy,
        compactionPolicy: record.compactionPolicy,
        retentionPolicy: record.retentionPolicy,
        fallbackPolicy: record.fallbackPolicy,
        interruptionPolicy: record.interruptionPolicy,
        candidateWorkspaceLeaseId: record.candidateWorkspaceLeaseId ?? null,
        candidateWorkspaceLeaseDigest: record.candidateWorkspaceLeaseDigest ?? null,
        candidateWorkspaceCwdIdentity: record.candidateWorkspaceCwdIdentity ?? null,
        authorizedAt: record.authorizedAt,
        intentDigest: record.intentDigest,
        processIdentityJson:
          record.processIdentity === undefined
            ? null
            : serializeJson(decodeJsonValue(record.processIdentity)),
        backendSessionRef: record.backendSessionRef ?? null,
        backendOperationRef: record.backendOperationRef ?? null,
        compactionCount: record.compactionCount,
        turnInterruptCount: record.turnInterruptCount,
        failureCode: record.failureCode ?? null,
        resultEventId: record.resultEventId ?? null,
        updatedAt: record.updatedAt,
        terminalAt: record.terminalAt ?? null,
        lastObservationId: record.lastObservationId ?? null,
        auditSequence: record.auditSequence,
        recordDigest: record.recordDigest,
      });
  }

  private updateExternalExecutionRecord(record: ExternalExecutionRecord): void {
    const result = this.#database
      .prepare(
        `UPDATE external_execution_records
            SET version = @version,
                state = @state,
                process_identity_json = @processIdentityJson,
                backend_session_ref = @backendSessionRef,
                backend_operation_ref = @backendOperationRef,
                compaction_count = @compactionCount,
                turn_interrupt_count = @turnInterruptCount,
                failure_code = @failureCode,
                result_event_id = @resultEventId,
                updated_at = @updatedAt,
                terminal_at = @terminalAt,
                last_observation_id = @lastObservationId,
                audit_sequence = @auditSequence,
                record_digest = @recordDigest
          WHERE id = @id AND version = @expectedVersion`,
      )
      .run({
        id: record.id,
        expectedVersion: record.version - 1,
        version: record.version,
        state: record.state,
        processIdentityJson:
          record.processIdentity === undefined
            ? null
            : serializeJson(decodeJsonValue(record.processIdentity)),
        backendSessionRef: record.backendSessionRef ?? null,
        backendOperationRef: record.backendOperationRef ?? null,
        compactionCount: record.compactionCount,
        turnInterruptCount: record.turnInterruptCount,
        failureCode: record.failureCode ?? null,
        resultEventId: record.resultEventId ?? null,
        updatedAt: record.updatedAt,
        terminalAt: record.terminalAt ?? null,
        lastObservationId: record.lastObservationId ?? null,
        auditSequence: record.auditSequence,
        recordDigest: record.recordDigest,
      });
    if (result.changes !== 1) {
      throw new OptimisticConcurrencyError('External execution', record.id);
    }
  }

  private abandonExternalExecutionInsideTransaction(
    current: ExternalExecutionRecord,
    reasonCode: ExternalExecutionAbandonReasonCode,
    abandonedAt: IsoTimestamp,
    auditIdentifier: AuditEventId,
  ): ExternalExecutionRecord {
    const nextAuditSequence = z
      .object({ next_sequence: z.number().int().positive() })
      .parse(
        this.#database
          .prepare('SELECT coalesce(max(sequence), 0) + 1 AS next_sequence FROM audit_events')
          .get(),
      ).next_sequence;
    const nextWithoutDigest = Object.freeze({
      ...current,
      version: current.version + 1,
      state: ExternalExecutionState.ABANDONED,
      failureCode: reasonCode,
      updatedAt: abandonedAt,
      terminalAt: abandonedAt,
      auditSequence: nextAuditSequence,
    });
    const next = decodeExternalExecutionRecord({
      ...nextWithoutDigest,
      recordDigest: sha256Digest(
        canonicalAuthorityDigests.digest(externalExecutionRecordProjection(nextWithoutDigest)),
      ),
    });
    this.insertAuditEvent({
      id: auditIdentifier,
      aggregateType: 'EXTERNAL_EXECUTION',
      aggregateId: next.id,
      eventType: 'EXTERNAL_EXECUTION_ABANDONED',
      beforeVersion: current.version,
      afterVersion: next.version,
      payloadDigest: next.recordDigest,
      occurredAt: next.updatedAt,
    });
    if (this.auditSequence(auditIdentifier) !== next.auditSequence) {
      throw new StoreInvariantError('External execution abandonment audit sequence changed');
    }
    this.probe(WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_AUDIT_WRITE);
    this.updateExternalExecutionRecord(next);
    this.probe(WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_WRITE);
    const persisted = this.getExternalExecution(next.id);
    if (persisted === undefined) {
      throw new StoreInvariantError(`Abandoned external execution ${next.id} was not readable`);
    }
    this.assertAuditEventsReadable([auditIdentifier]);
    return persisted;
  }

  private completeExternalMaintenanceInsideTransaction(
    current: ExternalMaintenanceIntent,
    state:
      | typeof ExternalMaintenanceState.OBSERVED
      | typeof ExternalMaintenanceState.FAILED
      | typeof ExternalMaintenanceState.ABANDONED,
    observedAt: IsoTimestamp,
    failureCode: ExternalMaintenanceFailureCode | undefined,
    auditIdentifier: AuditEventId,
  ): ExternalMaintenanceIntent {
    const withoutRecordDigest: Omit<ExternalMaintenanceIntent, 'recordDigest'> = Object.freeze({
      ...current,
      state,
      observedAt,
      ...(failureCode === undefined ? {} : { failureCode }),
    });
    const next = decodeExternalMaintenanceIntent({
      ...withoutRecordDigest,
      recordDigest: sha256Digest(
        canonicalAuthorityDigests.digest(externalMaintenanceRecordProjection(withoutRecordDigest)),
      ),
    });
    this.insertAuditEvent({
      id: auditIdentifier,
      aggregateType: 'EXTERNAL_MAINTENANCE',
      aggregateId: next.id,
      eventType: 'EXTERNAL_MAINTENANCE_COMPLETED',
      beforeVersion: 1,
      afterVersion: 2,
      payloadDigest: next.recordDigest,
      occurredAt: observedAt,
    });
    this.probe(WorkerTransactionStep.AFTER_EXTERNAL_MAINTENANCE_AUDIT_WRITE);
    const auditSequence = this.auditSequence(auditIdentifier);
    const result = this.#database
      .prepare(
        `UPDATE external_maintenance_intents
            SET state = ?, observed_at = ?, failure_code = ?, record_digest = ?,
                audit_sequence = ?
          WHERE id = ? AND state = 'AUTHORIZED'`,
      )
      .run(
        next.state,
        next.observedAt ?? null,
        next.failureCode ?? null,
        next.recordDigest,
        auditSequence,
        next.id,
      );
    if (result.changes !== 1) {
      throw new OptimisticConcurrencyError('External maintenance', next.id);
    }
    this.probe(WorkerTransactionStep.AFTER_EXTERNAL_MAINTENANCE_WRITE);
    const persisted = this.getExternalMaintenanceIntent(next.id);
    if (persisted === undefined) {
      throw new StoreInvariantError(`External maintenance ${next.id} was not readable`);
    }
    this.assertAuditEventsReadable([auditIdentifier]);
    return persisted;
  }

  private insertContextManifest(manifest: ContextManifest): void {
    this.#database
      .prepare(
        `INSERT INTO context_manifests(
           id, schema_version, compiler_version, created_at, goal_id, goal_revision,
           workflow_id, workflow_version, phase, attempt_id, candidate_generation_id,
           candidate_digest, execution_profile_id, execution_profile_digest,
           policy_bundle_id, policy_bundle_digest,
           capability_grant_digest, response_contract_digest, entries_json,
           omission_decisions_json, package_digest, manifest_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        manifest.id,
        2,
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
        manifest.executionProfileId,
        manifest.executionProfileDigest,
        manifest.policyBundleId,
        manifest.policyBundleDigest,
        manifest.capabilityGrantDigest,
        manifest.responseContractDigest,
        serializeJson(decodeJsonValue(manifest.entries)),
        serializeJson(decodeJsonValue(manifest.omissionDecisions)),
        manifest.packageDigest,
        manifest.manifestDigest,
      );
    if (
      manifest.schemaVersion === 3 ||
      (manifest.schemaVersion === 4 && manifest.repairContextDigest !== undefined)
    ) {
      if (
        manifest.repairContextDigest === undefined ||
        manifest.priorAttemptFeedbackDigest === undefined ||
        !this.hasTable('repair_context_manifest_extensions')
      ) {
        throw new StoreInvariantError(
          `Repair Context Manifest ${manifest.id} lacks its compatibility authority`,
        );
      }
      this.#database
        .prepare(
          `INSERT INTO repair_context_manifest_extensions(
             context_manifest_id, logical_schema_version, repair_context_digest,
             prior_attempt_feedback_digest
           ) VALUES (?, 3, ?, ?)`,
        )
        .run(manifest.id, manifest.repairContextDigest, manifest.priorAttemptFeedbackDigest);
    }
    if (manifest.schemaVersion === 4) {
      if (
        manifest.acceptanceCriticalVerificationPlanId === undefined ||
        manifest.acceptanceCriticalVerificationPlanDigest === undefined ||
        !this.hasTable('protected_context_manifest_extensions')
      ) {
        throw new StoreInvariantError(
          `Protected Context Manifest ${manifest.id} lacks its Plan authority`,
        );
      }
      this.#database
        .prepare(
          `INSERT INTO protected_context_manifest_extensions(
             context_manifest_id, logical_schema_version, verification_plan_id,
             verification_plan_digest
           ) VALUES (?, 4, ?, ?)`,
        )
        .run(
          manifest.id,
          manifest.acceptanceCriticalVerificationPlanId,
          manifest.acceptanceCriticalVerificationPlanDigest,
        );
    }
    if (manifest.schemaVersion === 5) {
      if (
        manifest.projectReadAuthorityId === undefined ||
        manifest.projectReadAuthorityRecordDigest === undefined ||
        manifest.projectReadSourceTreeProjectionDigest === undefined ||
        manifest.projectReadGitStateProjectionDigest === undefined ||
        manifest.acceptanceCriticalVerificationPlanId === undefined ||
        manifest.acceptanceCriticalVerificationPlanDigest === undefined ||
        !this.hasTable('project_read_context_manifest_extensions')
      ) {
        throw new StoreInvariantError(
          `Project-read Context Manifest ${manifest.id} lacks its exact authority`,
        );
      }
      this.#database
        .prepare(
          `INSERT INTO project_read_context_manifest_extensions(
             context_manifest_id, logical_schema_version, project_read_authority_id,
             project_read_authority_record_digest, source_tree_projection_digest,
             git_state_projection_digest, verification_plan_id, verification_plan_digest
           ) VALUES (?, 5, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          manifest.id,
          manifest.projectReadAuthorityId,
          manifest.projectReadAuthorityRecordDigest,
          manifest.projectReadSourceTreeProjectionDigest,
          manifest.projectReadGitStateProjectionDigest,
          manifest.acceptanceCriticalVerificationPlanId,
          manifest.acceptanceCriticalVerificationPlanDigest,
        );
    }
  }

  private insertAcceptanceCriticalVerificationPlan(
    plan: AcceptanceCriticalVerificationPlan,
    auditIdentifier: AuditEventId,
    startCommandId: CommandId,
    correlationId?: string,
    causationId?: string,
  ): void {
    const { planDigest, ...semanticPlan } = plan;
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(
        acceptanceCriticalVerificationPlanProjection(Object.freeze(semanticPlan)),
      ),
    );
    if (planDigest !== expectedDigest) {
      throw new StoreInvariantError(`Protected Verification Plan ${plan.id} has a false digest`);
    }
    this.insertAuditEvent({
      id: auditIdentifier,
      aggregateType: 'ACCEPTANCE_CRITICAL_VERIFICATION_PLAN',
      aggregateId: plan.id,
      eventType: 'ACCEPTANCE_CRITICAL_VERIFICATION_PLAN_CREATED',
      commandId: startCommandId,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(causationId === undefined ? {} : { causationId }),
      payloadDigest: plan.planDigest,
      occurredAt: plan.createdAt,
    });
    this.probe(WorkerTransactionStep.AFTER_PROTECTED_VERIFICATION_PLAN_AUDIT_WRITE);
    const auditSequence = this.auditSequence(auditIdentifier);
    this.#database
      .prepare(
        `INSERT INTO acceptance_critical_verification_plans(
           id, schema_version, goal_id, goal_revision, workflow_id,
           workflow_version_at_lock, policy_bundle_id, policy_bundle_digest,
           execution_profile_id, execution_profile_digest,
           protected_asset_manifest_digest, canonical_json, plan_digest, audit_sequence
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        plan.id,
        plan.schemaVersion,
        plan.goalId,
        plan.goalRevision,
        plan.workflowId,
        plan.workflowVersionAtLock,
        plan.policyBundleId,
        plan.policyBundleDigest,
        plan.executionProfileId,
        plan.executionProfileDigest,
        plan.protectedAssetManifestDigest,
        serializeJson(decodeJsonValue(plan)),
        plan.planDigest,
        auditSequence,
      );
    this.probe(WorkerTransactionStep.AFTER_PROTECTED_VERIFICATION_PLAN_WRITE);
  }

  private insertProjectSourceReadAuthority(
    record: ProjectSourceReadAuthorityRecord,
    auditIdentifier: AuditEventId,
    startCommandId: CommandId,
    occurredAt: IsoTimestamp,
    correlationId?: string,
    causationId?: string,
  ): void {
    const { projectionDigest: sourceTreeDigest, ...sourceTree } = record.sourceTree;
    const { projectionDigest: gitStateDigest, ...gitState } = record.gitState;
    const { recordDigest, ...semanticRecord } = record;
    if (
      sourceTreeDigest !==
        sha256Digest(
          canonicalAuthorityDigests.digest(projectReadSourceTreeProjection(sourceTree)),
        ) ||
      gitStateDigest !==
        sha256Digest(canonicalAuthorityDigests.digest(projectReadGitStateProjection(gitState))) ||
      recordDigest !==
        sha256Digest(
          canonicalAuthorityDigests.digest(
            projectSourceReadAuthorityProjection(Object.freeze(semanticRecord)),
          ),
        )
    ) {
      throw new StoreInvariantError(
        `Project-source read authority ${record.id} has a false canonical digest`,
      );
    }
    const goal = this.getGoal(record.goalId);
    const workflow = this.getWorkflow(record.workflowId);
    const attempt = this.getAttempt(record.attemptId);
    const policy = this.getPolicyBundle(record.policyBundleId)?.bundle;
    const profile = this.getExecutionProfile(record.executionProfileId)?.profile;
    if (
      goal?.revision !== record.goalRevision ||
      goal.scope.projectPath !== record.normalizedProjectRoot ||
      workflow?.goalId !== record.goalId ||
      workflow.goalRevision !== record.goalRevision ||
      workflow.version !== record.workflowVersion ||
      workflow.phase !== record.phase ||
      workflow.runStatus !== RunStatus.RUNNING ||
      workflow.activeAttemptId !== record.attemptId ||
      attempt?.workflowId !== record.workflowId ||
      attempt.phase !== record.phase ||
      attempt.status !== AttemptStatus.RUNNING ||
      attempt.contextManifestId === undefined ||
      attempt.startedAt !== occurredAt ||
      record.issuedAt > occurredAt ||
      policy?.version !== record.policyBundleVersion ||
      policy.digest !== record.policyBundleDigest ||
      profile?.version !== record.executionProfileVersion ||
      profile.digest !== record.executionProfileDigest
    ) {
      throw new StoreInvariantError(
        `Project-source read authority ${record.id} does not bind the active Attempt`,
      );
    }
    this.insertAuditEvent({
      id: auditIdentifier,
      aggregateType: 'PROJECT_SOURCE_READ_AUTHORITY',
      aggregateId: record.id,
      eventType: 'PROJECT_SOURCE_READ_AUTHORITY_RECORDED',
      commandId: startCommandId,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(causationId === undefined ? {} : { causationId }),
      payloadDigest: record.recordDigest,
      occurredAt,
    });
    this.probe(WorkerTransactionStep.AFTER_PROJECT_READ_AUTHORITY_AUDIT_WRITE);
    const auditSequence = this.auditSequence(auditIdentifier);
    this.#database
      .prepare(
        `INSERT INTO project_source_read_authorities(
           id, schema_version, goal_id, goal_revision, workflow_id, workflow_version,
           phase, attempt_id, normalized_project_root, source_tree_projection_digest,
           git_state_projection_digest, snapshot_id, workspace_root_identity,
           snapshot_leaf_realpath, ownership_marker_digest, policy_bundle_id,
           policy_bundle_digest, execution_profile_id, execution_profile_digest,
           capability_grant_digest, response_contract_digest, issued_at, canonical_json,
           record_digest, audit_sequence
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.schemaVersion,
        record.goalId,
        record.goalRevision,
        record.workflowId,
        record.workflowVersion,
        record.phase,
        record.attemptId,
        record.normalizedProjectRoot,
        record.sourceTree.projectionDigest,
        record.gitState.projectionDigest,
        record.snapshotId,
        record.workspaceRootIdentity,
        record.snapshotLeafRealpath,
        record.ownershipMarkerDigest,
        record.policyBundleId,
        record.policyBundleDigest,
        record.executionProfileId,
        record.executionProfileDigest,
        record.capabilityGrantDigest,
        record.responseContractDigest,
        record.issuedAt,
        serializeJson(decodeJsonValue(record)),
        record.recordDigest,
        auditSequence,
      );
    this.probe(WorkerTransactionStep.AFTER_PROJECT_READ_AUTHORITY_WRITE);
  }

  private assertRecoveryMatchesCurrentAuthority(
    recovery: RecoveryReconciliationRecord,
    workflow: WorkflowInstance,
    sourceAttempt: Attempt,
  ): void {
    const owner = this.getGoalWithWorkflow(workflow.goalId);
    const binding = this.getExecutionProfileBinding(workflow.id);
    const claim = this.getWorkerDispatchClaim(sourceAttempt.id);
    const externalExecution = this.hasTable('external_execution_records')
      ? this.getExternalExecutionForAttempt(sourceAttempt.id)
      : undefined;
    const externalMaintenance =
      externalExecution === undefined
        ? undefined
        : this.getExternalMaintenanceIntentForExecution(externalExecution.id, 1);
    const candidateAuthority = this.getCandidateAuthorityForWorkflow(workflow.id);
    const watermark = auditSequenceWatermarkRowSchema.parse(
      this.#database
        .prepare('SELECT COALESCE(MAX(sequence), 0) AS through_sequence FROM audit_events')
        .get(),
    ).through_sequence;
    const expectedProjectIdentity =
      owner === undefined
        ? undefined
        : deriveM1BaseProjectIdentity(owner.goal.scope.projectPath, canonicalAuthorityDigests);
    const expectedClaimDigest =
      claim === undefined
        ? undefined
        : sha256Digest(canonicalAuthorityDigests.digest(workerDispatchClaimProjection(claim)));
    const expectedCandidateDigest =
      candidateAuthority?.generation.frozenDigest ?? candidateAuthority?.generation.baseDigest;

    if (
      owner === undefined ||
      binding === undefined ||
      owner.workflow.id !== workflow.id ||
      owner.workflow.version !== workflow.version ||
      recovery.goalId !== owner.goal.id ||
      recovery.goalRevision !== owner.goal.revision ||
      recovery.workflowId !== workflow.id ||
      recovery.phase !== workflow.phase ||
      recovery.inspectedWorkflowVersion !== workflow.version ||
      recovery.sourceAttemptId !== sourceAttempt.id ||
      sourceAttempt.workflowId !== workflow.id ||
      sourceAttempt.phase !== workflow.phase ||
      recovery.lastAuditSequence !== watermark ||
      recovery.expectedProjectIdentity !== expectedProjectIdentity ||
      recovery.executionProfileId !== binding.profileId ||
      recovery.executionProfileDigest !== binding.profileDigest ||
      recovery.dispatchClaimDigest !== expectedClaimDigest ||
      recovery.inspectedAt < workflow.updatedAt ||
      recovery.inspectedAt < sourceAttempt.startedAt ||
      (externalExecution !== undefined && recovery.inspectedAt < externalExecution.updatedAt) ||
      (externalMaintenance !== undefined &&
        (recovery.inspectedAt < externalMaintenance.authorizedAt ||
          (externalMaintenance.observedAt !== undefined &&
            recovery.inspectedAt < externalMaintenance.observedAt)))
    ) {
      throw new StoreInvariantError(
        `Recovery reconciliation ${recovery.id} does not match current control authority`,
      );
    }

    if (candidateAuthority === undefined) {
      if (
        recovery.candidateGenerationId !== undefined ||
        recovery.candidateBaseIdentity !== undefined ||
        recovery.expectedCandidateDigest !== undefined ||
        recovery.observedCandidateDigest !== undefined
      ) {
        throw new StoreInvariantError(
          `Recovery reconciliation ${recovery.id} invents Candidate authority`,
        );
      }
    } else if (
      expectedCandidateDigest === undefined ||
      recovery.candidateGenerationId !== candidateAuthority.generation.id ||
      recovery.candidateBaseIdentity !== candidateAuthority.candidate.baseProjectIdentity ||
      recovery.expectedCandidateDigest !== expectedCandidateDigest
    ) {
      throw new StoreInvariantError(
        `Recovery reconciliation ${recovery.id} does not bind the current Candidate`,
      );
    }

    if (recovery.purpose === RecoveryReconciliationPurpose.STARTUP) {
      if (
        workflow.runStatus !== RunStatus.RUNNING ||
        workflow.activeAttemptId !== sourceAttempt.id ||
        sourceAttempt.status !== AttemptStatus.RUNNING
      ) {
        throw new StoreInvariantError('Startup recovery source is not the active RUNNING Attempt');
      }
      return;
    }

    const latest = this.getLatestRecoveryReconciliation(workflow.id);
    const followsCurrentReconciliation =
      latest?.resultingWorkflowVersion === workflow.version &&
      latest.sourceAttemptId === sourceAttempt.id;
    const followsRecoverableFailure =
      sourceAttempt.status === AttemptStatus.FAILED &&
      (sourceAttempt.failureClass === AttemptFailureClass.TIMEOUT ||
        sourceAttempt.failureClass === AttemptFailureClass.ABRUPT_TERMINATION) &&
      sourceAttempt.endedAt === workflow.updatedAt;
    if (
      workflow.runStatus !== RunStatus.BLOCKED ||
      workflow.activeAttemptId !== undefined ||
      (!followsCurrentReconciliation && !followsRecoverableFailure)
    ) {
      throw new StoreInvariantError(
        'Resume recovery source is not the current recoverable blocker',
      );
    }
  }

  private insertRecoveryReconciliation(recovery: RecoveryReconciliationRecord): void {
    this.#database
      .prepare(
        `INSERT INTO recovery_reconciliations(
           id, schema_version, goal_id, goal_revision, workflow_id, phase,
           inspected_workflow_version, resulting_workflow_version, source_attempt_id,
           dispatch_claim_digest, last_audit_sequence, expected_project_identity,
           observed_project_identity, candidate_generation_id, candidate_base_identity,
           expected_candidate_digest, observed_candidate_digest, execution_profile_id,
           execution_profile_digest, purpose, disposition, safe_resume_phase, reason_code,
           observation_refs_json, inspector_version, recovery_policy_version, inspected_at,
           reconciliation_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        recovery.id,
        recovery.schemaVersion,
        recovery.goalId,
        recovery.goalRevision,
        recovery.workflowId,
        recovery.phase,
        recovery.inspectedWorkflowVersion,
        recovery.resultingWorkflowVersion,
        recovery.sourceAttemptId ?? null,
        recovery.dispatchClaimDigest ?? null,
        recovery.lastAuditSequence,
        recovery.expectedProjectIdentity,
        recovery.observedProjectIdentity ?? null,
        recovery.candidateGenerationId ?? null,
        recovery.candidateBaseIdentity ?? null,
        recovery.expectedCandidateDigest ?? null,
        recovery.observedCandidateDigest ?? null,
        recovery.executionProfileId,
        recovery.executionProfileDigest,
        recovery.purpose,
        recovery.disposition,
        recovery.safeResumePhase ?? null,
        recovery.reasonCode,
        serializeJson(decodeJsonValue(recovery.observationRefs)),
        recovery.inspectorVersion,
        recovery.recoveryPolicyVersion,
        recovery.inspectedAt,
        recovery.reconciliationDigest,
      );
  }

  private insertRecoveryAudit(
    recovery: RecoveryReconciliationRecord,
    auditIdentifier: AuditEventId,
    commandIdentifier: CommandId,
    correlationId?: string,
    causationId?: string,
  ): void {
    this.insertAuditEvent({
      id: auditIdentifier,
      aggregateType: 'RECOVERY_RECONCILIATION',
      aggregateId: recovery.id,
      eventType: 'RECOVERY_RECONCILIATION_RECORDED',
      commandId: commandIdentifier,
      beforeVersion: recovery.inspectedWorkflowVersion,
      afterVersion: recovery.resultingWorkflowVersion,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(causationId === undefined ? {} : { causationId }),
      payloadDigest: recovery.reconciliationDigest,
      occurredAt: recovery.inspectedAt,
    });
  }

  private policyDigest(bundle: PolicyBundle): Sha256Digest {
    return sha256Digest(canonicalAuthorityDigests.digest(policyBundleProjection(bundle)));
  }

  private executionProfileDigest(profile: ExecutionProfile): Sha256Digest {
    return sha256Digest(canonicalAuthorityDigests.digest(executionProfileProjection(profile)));
  }

  private externalBackendCapabilityDigest(record: ExternalBackendCapabilityRecord): Sha256Digest {
    return sha256Digest(
      canonicalAuthorityDigests.digest(externalBackendCapabilityRecordProjection(record)),
    );
  }

  private externalExecutionIntentDigest(record: ExternalExecutionRecord): Sha256Digest {
    return sha256Digest(
      canonicalAuthorityDigests.digest(externalExecutionIntentProjection(record)),
    );
  }

  private externalExecutionRecordDigest(record: ExternalExecutionRecord): Sha256Digest {
    return sha256Digest(
      canonicalAuthorityDigests.digest(externalExecutionRecordProjection(record)),
    );
  }

  private externalExecutionObservationDigest(
    observation: ExternalExecutionObservation,
  ): Sha256Digest {
    return sha256Digest(
      canonicalAuthorityDigests.digest(externalExecutionObservationProjection(observation)),
    );
  }

  private externalProcessIdentityDigest(identity: ExternalProcessIdentity): Sha256Digest {
    return sha256Digest(
      canonicalAuthorityDigests.digest(externalProcessIdentityProjection(identity)),
    );
  }

  private externalMaintenanceIntentDigest(intent: ExternalMaintenanceIntent): Sha256Digest {
    return sha256Digest(
      canonicalAuthorityDigests.digest(
        externalMaintenanceAuthorizationProjection({
          schemaVersion: intent.schemaVersion,
          id: intent.id,
          externalExecutionId: intent.externalExecutionId,
          sequence: intent.sequence,
          kind: intent.kind,
          authorizedAt: intent.authorizedAt,
        }),
      ),
    );
  }

  private externalMaintenanceRecordDigest(intent: ExternalMaintenanceIntent): Sha256Digest {
    return sha256Digest(
      canonicalAuthorityDigests.digest(externalMaintenanceRecordProjection(intent)),
    );
  }

  private decodeVerifiedExternalBackendCapabilityRow(
    row: unknown,
  ): ExternalBackendCapabilityRecord {
    const record = decodeExternalBackendCapabilityRow(row);
    if (record.recordDigest !== this.externalBackendCapabilityDigest(record)) {
      throw new StoreInvariantError(
        `External backend capability ${record.recordDigest} has a false digest`,
      );
    }
    return record;
  }

  private decodeVerifiedExternalExecutionRow(row: unknown): ExternalExecutionRecord {
    const record = decodeExternalExecutionRow(row);
    if (record.failureCode !== undefined) {
      if (record.state === ExternalExecutionState.ABANDONED) {
        externalExecutionAbandonReasonCode(record.failureCode);
      } else if (
        record.state === ExternalExecutionState.FAILED ||
        record.state === ExternalExecutionState.INTERRUPTED
      ) {
        externalWorkerFailureCode(record.failureCode);
      } else {
        throw new StoreInvariantError(
          `External execution ${record.id} has failure details before failure`,
        );
      }
    }
    if (
      record.intentDigest !== this.externalExecutionIntentDigest(record) ||
      record.recordDigest !== this.externalExecutionRecordDigest(record) ||
      (record.processIdentity !== undefined &&
        record.processIdentity.identityDigest !==
          this.externalProcessIdentityDigest(record.processIdentity))
    ) {
      throw new StoreInvariantError(`External execution ${record.id} has false authority digests`);
    }
    return record;
  }

  private decodeVerifiedExternalExecutionObservationRow(
    row: unknown,
  ): ExternalExecutionObservation {
    const observation = decodeExternalExecutionObservationRow(row);
    if (observation.failureCode !== undefined) {
      externalWorkerFailureCode(observation.failureCode);
    }
    if (
      observation.observationDigest !== this.externalExecutionObservationDigest(observation) ||
      (observation.processIdentity !== undefined &&
        observation.processIdentity.identityDigest !==
          this.externalProcessIdentityDigest(observation.processIdentity))
    ) {
      throw new StoreInvariantError(
        `External execution observation ${observation.id} has a false digest`,
      );
    }
    return observation;
  }

  private decodeVerifiedExternalMaintenanceIntentRow(row: unknown): ExternalMaintenanceIntent {
    const intent = decodeExternalMaintenanceIntentRow(row);
    if (intent.failureCode !== undefined) {
      externalMaintenanceFailureCode(intent.failureCode);
    }
    if (
      intent.intentDigest !== this.externalMaintenanceIntentDigest(intent) ||
      intent.recordDigest !== this.externalMaintenanceRecordDigest(intent)
    ) {
      throw new StoreInvariantError(
        `External maintenance ${intent.id} has false authority digests`,
      );
    }
    return intent;
  }

  private auditSequence(rawAuditEventId: AuditEventId): number {
    const identifier = auditEventId(rawAuditEventId);
    const row = this.#database
      .prepare(
        `SELECT id, sequence, aggregate_type, aggregate_id, event_type, actor_type,
                command_id, before_version, after_version, correlation_id, causation_id,
                payload_digest, occurred_at
           FROM audit_events
          WHERE id = ?`,
      )
      .get(identifier);
    if (row === undefined) {
      throw new StoreInvariantError(`Audit event ${identifier} is not readable`);
    }
    return decodeAuditEvent(row).sequence;
  }

  private decodeVerifiedExecutionProfileRow(row: unknown): InstalledExecutionProfile {
    const installed = decodeExecutionProfileRow(row);
    if (installed.profile.digest !== this.executionProfileDigest(installed.profile)) {
      throw new StoreInvariantError(
        `Execution Profile ${installed.profile.id} digest does not match its canonical projection`,
      );
    }
    return installed;
  }

  private hasExactExternalProfileCapabilityAuthority(profile: ExecutionProfile): boolean {
    if (profile.schemaVersion === 1) {
      return true;
    }
    if (!this.hasTable('external_backend_capability_records')) {
      return false;
    }
    const external = profile.externalExecution;
    const capability = this.getExternalBackendCapabilityRecord(external.capabilityRecordDigest);
    const configurationMatches =
      external.schemaVersion === 3
        ? external.phaseDispatch.every(
            (entry) => entry.configurationProfileDigest === capability?.configurationProfileDigest,
          )
        : external.configurationProfileDigest === capability?.configurationProfileDigest;
    const phaseContractsMatch =
      external.schemaVersion !== 3 ||
      external.phaseDispatch.every(
        (entry) =>
          entry.capabilityGrantDigest ===
            sha256Digest(
              canonicalAuthorityDigests.digest({
                schemaVersion: 1,
                capabilityGrant: deriveCapabilityGrant(entry.phase),
              }),
            ) &&
          entry.responseContractDigest ===
            sha256Digest(
              canonicalAuthorityDigests.digest({
                schemaVersion: 1,
                responseContract: m1WorkerResponseContract(entry.phase),
              }),
            ) &&
          entry.responseSchemaPolicy === deriveExternalPhaseResponseSchemaPolicy(entry.phase) &&
          entry.instructionSourceManifestDigest ===
            sha256Digest(
              canonicalAuthorityDigests.digest({ instructionSources: entry.instructionSources }),
            ),
      );
    if (
      capability?.backendKind !== external.backendKind ||
      capability.binaryIdentityDigest !== external.binaryIdentityDigest ||
      capability.protocolSchemaDigest !== external.protocolSchemaDigest ||
      !configurationMatches ||
      !phaseContractsMatch
    ) {
      return false;
    }
    const supported = new Set(
      capability.capabilityEntries
        .filter(
          (entry) => entry.classification === ExternalBackendCapabilityClassification.SUPPORTED,
        )
        .map((entry) => entry.capability),
    );
    return external.selectedCapabilities.every((capabilityName) => supported.has(capabilityName));
  }

  private decodeVerifiedRecoveryReconciliationRow(row: unknown): RecoveryReconciliationRecord {
    const recovery = decodeRecoveryReconciliationRow(row);
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(recoveryReconciliationProjection(recovery)),
    );
    if (recovery.reconciliationDigest !== expectedDigest) {
      throw new StoreInvariantError(
        `Recovery reconciliation ${recovery.id} digest does not match its canonical projection`,
      );
    }
    return recovery;
  }

  private insertWorkflowPolicyBinding(
    binding: WorkflowPolicyBinding,
    auditIdentifier: AuditEventId,
    correlationId?: string,
    causationId?: string,
  ): void {
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(workflowPolicyBindingProjection(binding)),
    );
    if (binding.bindingDigest !== expectedDigest) {
      throw new StoreInvariantError(
        `Workflow Policy binding for ${binding.workflowId} has a false digest`,
      );
    }
    this.insertAuditEvent({
      id: auditIdentifier,
      aggregateType: 'WORKFLOW_POLICY_BINDING',
      aggregateId: binding.workflowId,
      eventType: 'WORKFLOW_POLICY_BOUND',
      commandId: binding.startCommandId,
      beforeVersion: 1,
      afterVersion: 2,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(causationId === undefined ? {} : { causationId }),
      payloadDigest: binding.bindingDigest,
      occurredAt: binding.boundAt,
    });
    this.probe(WorkerTransactionStep.AFTER_WORKFLOW_POLICY_BINDING_AUDIT_WRITE);
    this.#database
      .prepare(
        `INSERT INTO workflow_policy_bindings(
           workflow_id, schema_version, goal_id, policy_bundle_id,
           policy_bundle_version, policy_bundle_digest, start_command_id,
           bound_at, binding_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        binding.workflowId,
        binding.schemaVersion,
        binding.goalId,
        binding.policyBundleId,
        binding.policyBundleVersion,
        binding.policyBundleDigest,
        binding.startCommandId,
        binding.boundAt,
        binding.bindingDigest,
      );
    this.probe(WorkerTransactionStep.AFTER_WORKFLOW_POLICY_BINDING_WRITE);
  }

  private assertWorkflowPolicyBindingClosure(binding: WorkflowPolicyBinding): void {
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(workflowPolicyBindingProjection(binding)),
    );
    const workflow = this.getWorkflow(binding.workflowId);
    const policy = this.getPolicyBundle(binding.policyBundleId);
    const command = this.getProcessedCommand(binding.startCommandId);
    const audits = this.listAuditEvents('WORKFLOW_POLICY_BINDING', binding.workflowId).filter(
      (audit) => audit.eventType === 'WORKFLOW_POLICY_BOUND',
    );
    const audit = audits[0];
    if (
      binding.bindingDigest !== expectedDigest ||
      workflow?.goalId !== binding.goalId ||
      workflow.version < 2 ||
      workflow.updatedAt < binding.boundAt ||
      policy?.bundle.version !== binding.policyBundleVersion ||
      policy.bundle.digest !== binding.policyBundleDigest ||
      policy.installedAt > binding.boundAt ||
      command?.aggregateType !== 'GOAL' ||
      command.aggregateId !== binding.goalId ||
      command.completedAt !== binding.boundAt ||
      audits.length !== 1 ||
      audit?.actorType !== 'RUNTIME' ||
      audit.commandId !== binding.startCommandId ||
      audit.beforeVersion !== 1 ||
      audit.afterVersion !== 2 ||
      audit.payloadDigest !== binding.bindingDigest ||
      audit.occurredAt !== binding.boundAt
    ) {
      throw new StoreInvariantError(
        `Workflow ${binding.workflowId} has incomplete Policy binding authority`,
      );
    }
  }

  private insertExecutionProfileBinding(
    binding: ExecutionProfileBinding,
    auditIdentifier: AuditEventId,
    correlationId?: string,
    causationId?: string,
  ): void {
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(executionProfileBindingProjection(binding)),
    );
    if (binding.bindingDigest !== expectedDigest) {
      throw new StoreInvariantError(
        `Execution Profile binding for ${binding.workflowId} has a false digest`,
      );
    }
    this.insertAuditEvent({
      id: auditIdentifier,
      aggregateType: 'EXECUTION_PROFILE_BINDING',
      aggregateId: binding.workflowId,
      eventType: 'EXECUTION_PROFILE_BOUND',
      commandId: binding.startCommandId,
      beforeVersion: 1,
      afterVersion: 2,
      ...(correlationId === undefined ? {} : { correlationId }),
      ...(causationId === undefined ? {} : { causationId }),
      payloadDigest: binding.bindingDigest,
      occurredAt: binding.boundAt,
    });
    this.probe(WorkerTransactionStep.AFTER_EXECUTION_PROFILE_BINDING_AUDIT_WRITE);
    this.#database
      .prepare(
        `INSERT INTO workflow_execution_profile_bindings(
           workflow_id, schema_version, goal_id, profile_id, profile_version,
           profile_digest, start_command_id, bound_at, binding_digest
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        binding.workflowId,
        binding.schemaVersion,
        binding.goalId,
        binding.profileId,
        binding.profileVersion,
        binding.profileDigest,
        binding.startCommandId,
        binding.boundAt,
        binding.bindingDigest,
      );
    this.probe(WorkerTransactionStep.AFTER_EXECUTION_PROFILE_BINDING_WRITE);
  }

  private assertExecutionProfileBindingClosure(binding: ExecutionProfileBinding): void {
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(executionProfileBindingProjection(binding)),
    );
    const workflow = this.getWorkflow(binding.workflowId);
    const profile = this.getExecutionProfile(binding.profileId);
    const command = this.getProcessedCommand(binding.startCommandId);
    const audits = this.listAuditEvents('EXECUTION_PROFILE_BINDING', binding.workflowId).filter(
      (audit) => audit.eventType === 'EXECUTION_PROFILE_BOUND',
    );
    const audit = audits[0];
    if (
      binding.bindingDigest !== expectedDigest ||
      workflow?.goalId !== binding.goalId ||
      workflow.version < 2 ||
      workflow.updatedAt < binding.boundAt ||
      profile?.profile.version !== binding.profileVersion ||
      profile.profile.digest !== binding.profileDigest ||
      profile.installedAt > binding.boundAt ||
      command?.aggregateType !== 'GOAL' ||
      command.aggregateId !== binding.goalId ||
      command.completedAt !== binding.boundAt ||
      audits.length !== 1 ||
      audit?.actorType !== 'RUNTIME' ||
      audit.commandId !== binding.startCommandId ||
      audit.beforeVersion !== 1 ||
      audit.afterVersion !== 2 ||
      audit.payloadDigest !== binding.bindingDigest ||
      audit.occurredAt !== binding.boundAt
    ) {
      throw new StoreInvariantError(
        `Workflow ${binding.workflowId} has incomplete Execution Profile binding authority`,
      );
    }
  }

  private resolveWorkflowStartAuthorityClosure(
    workflow: WorkflowInstance,
  ): WorkflowStartAuthorityClosure {
    const policyRow = this.#database
      .prepare('SELECT * FROM workflow_policy_bindings WHERE workflow_id = ?')
      .get(workflow.id);
    const profileRow = this.#database
      .prepare('SELECT * FROM workflow_execution_profile_bindings WHERE workflow_id = ?')
      .get(workflow.id);
    const attempts = this.#database
      .prepare('SELECT * FROM attempts WHERE workflow_id = ? ORDER BY sequence')
      .all(workflow.id)
      .map((row) => decodeAttempt(row));

    if (policyRow === undefined && profileRow === undefined) {
      if (attempts.length !== 0) {
        throw new StoreInvariantError(
          `Workflow ${workflow.id} has Attempt history without start authority`,
        );
      }
      if (
        workflow.phase === WorkflowPhase.DISCOVERY &&
        workflow.runStatus === RunStatus.READY &&
        workflow.version === 1 &&
        workflow.activeAttemptId === undefined &&
        workflow.activeCandidateGenerationId === undefined &&
        workflow.suspendedReason === undefined &&
        workflow.updatedAt === workflow.createdAt
      ) {
        return Object.freeze({ state: 'UNSTARTED', workflow });
      }
      if (
        workflow.phase === WorkflowPhase.DISCOVERY &&
        workflow.runStatus === RunStatus.CANCELLED &&
        workflow.version === 2 &&
        workflow.activeAttemptId === undefined &&
        workflow.activeCandidateGenerationId === undefined &&
        workflow.suspendedReason !== undefined
      ) {
        return Object.freeze({
          state: 'CANCELLED_BEFORE_START',
          workflow,
          cancellationAudit: this.assertPreStartCancellationClosure(workflow),
        });
      }
      throw new StoreInvariantError(
        `Workflow ${workflow.id} changed execution state without start authority`,
      );
    }

    if (policyRow === undefined || profileRow === undefined) {
      throw new StoreInvariantError(
        `Workflow ${workflow.id} has only one half of its Policy/Profile start authority`,
      );
    }

    const policyBinding = decodeWorkflowPolicyBindingRow(policyRow);
    const executionProfileBinding = decodeExecutionProfileBindingRow(profileRow);
    this.assertWorkflowPolicyBindingClosure(policyBinding);
    this.assertExecutionProfileBindingClosure(executionProfileBinding);
    for (const attempt of attempts) {
      this.assertWorkerAttemptStartAuthorityClosure(
        workflow,
        attempt,
        policyBinding,
        executionProfileBinding,
      );
    }
    const firstAttempt = attempts[0];
    const contextManifest =
      firstAttempt?.contextManifestId === undefined
        ? undefined
        : this.getContextManifest(firstAttempt.contextManifestId);
    const command = this.getProcessedCommand(policyBinding.startCommandId);
    const outcome = command === undefined ? undefined : decodeStoredCommandOutcome(command.outcome);
    const attemptStartAudits =
      firstAttempt === undefined
        ? []
        : this.listAuditEvents('ATTEMPT', firstAttempt.id).filter(
            (audit) => audit.eventType === 'ATTEMPT_STARTED',
          );
    const workflowStartAudits = this.listAuditEvents('WORKFLOW', workflow.id).filter(
      (audit) =>
        audit.eventType === 'WORKFLOW_ATTEMPT_STARTED' &&
        audit.beforeVersion === 1 &&
        audit.afterVersion === 2,
    );
    const attemptStartAudit = attemptStartAudits[0];
    const workflowStartAudit = workflowStartAudits[0];

    if (firstAttempt === undefined || contextManifest === undefined) {
      throw new StoreInvariantError(
        `Workflow ${workflow.id} has no first Context-bound Attempt authority`,
      );
    }
    if (
      firstAttempt.sequence !== 1 ||
      firstAttempt.phase !== WorkflowPhase.DISCOVERY ||
      firstAttempt.startedAt !== policyBinding.boundAt ||
      firstAttempt.contextManifestId === undefined ||
      firstAttempt.workerSessionRef === undefined
    ) {
      throw new StoreInvariantError(
        `Workflow ${workflow.id} has invalid first Attempt start authority`,
      );
    }
    if (
      policyBinding.goalId !== workflow.goalId ||
      executionProfileBinding.goalId !== workflow.goalId ||
      policyBinding.workflowId !== workflow.id ||
      executionProfileBinding.workflowId !== workflow.id ||
      policyBinding.startCommandId !== executionProfileBinding.startCommandId ||
      policyBinding.boundAt !== executionProfileBinding.boundAt
    ) {
      throw new StoreInvariantError(
        `Workflow ${workflow.id} has inconsistent Policy/Profile start authority`,
      );
    }
    if (
      contextManifest.goalId !== workflow.goalId ||
      contextManifest.workflowId !== workflow.id ||
      contextManifest.workflowVersion !== 2 ||
      contextManifest.phase !== WorkflowPhase.DISCOVERY ||
      contextManifest.attemptId !== firstAttempt.id ||
      contextManifest.executionProfileId !== executionProfileBinding.profileId ||
      contextManifest.executionProfileDigest !== executionProfileBinding.profileDigest ||
      contextManifest.policyBundleId !== policyBinding.policyBundleId ||
      contextManifest.policyBundleDigest !== policyBinding.policyBundleDigest
    ) {
      throw new StoreInvariantError(
        `Workflow ${workflow.id} has inconsistent first Context Manifest authority`,
      );
    }
    if (
      command?.aggregateType !== 'GOAL' ||
      command.aggregateId !== workflow.goalId ||
      command.completedAt !== policyBinding.boundAt ||
      outcome?.disposition !== StoredCommandDisposition.APPLIED ||
      outcome.target.aggregateType !== 'GOAL' ||
      outcome.target.aggregateId !== workflow.goalId ||
      outcome.goalId !== workflow.goalId ||
      outcome.workflow.id !== workflow.id ||
      outcome.workflow.version !== 2 ||
      outcome.workflow.phase !== WorkflowPhase.DISCOVERY ||
      outcome.workflow.runStatus !== RunStatus.RUNNING
    ) {
      throw new StoreInvariantError(
        `Workflow ${workflow.id} has inconsistent first StartGoal command authority`,
      );
    }
    if (
      attemptStartAudits.length !== 1 ||
      attemptStartAudit?.actorType !== 'RUNTIME' ||
      attemptStartAudit.commandId !== policyBinding.startCommandId ||
      attemptStartAudit.beforeVersion !== 1 ||
      attemptStartAudit.afterVersion !== 2 ||
      attemptStartAudit.occurredAt !== policyBinding.boundAt ||
      workflowStartAudits.length !== 1 ||
      workflowStartAudit?.actorType !== 'RUNTIME' ||
      workflowStartAudit.commandId !== policyBinding.startCommandId ||
      workflowStartAudit.beforeVersion !== 1 ||
      workflowStartAudit.afterVersion !== 2 ||
      workflowStartAudit.occurredAt !== policyBinding.boundAt
    ) {
      throw new StoreInvariantError(
        `Workflow ${workflow.id} has inconsistent first StartGoal audit authority`,
      );
    }

    return Object.freeze({
      state: 'STARTED',
      workflow,
      firstAttempt,
      contextManifest,
      policyBinding,
      executionProfileBinding,
    });
  }

  private assertWorkerAttemptStartAuthorityClosure(
    workflow: WorkflowInstance,
    attempt: Attempt,
    policyBinding: WorkflowPolicyBinding,
    executionProfileBinding: ExecutionProfileBinding,
  ): void {
    if (!isM1CodingWorkerPhase(attempt.phase)) {
      if (attempt.contextManifestId !== undefined || attempt.workerSessionRef !== undefined) {
        throw new StoreInvariantError(
          `Runtime-owned phase Attempt ${attempt.id} contains coding-Worker authority`,
        );
      }
      return;
    }
    if (attempt.contextManifestId === undefined || attempt.workerSessionRef === undefined) {
      throw new StoreInvariantError(
        `Worker phase Attempt ${attempt.id} has no Context-bound authority`,
      );
    }
    const manifest = this.getContextManifest(attempt.contextManifestId);
    const attemptStartAudits = this.listAuditEvents('ATTEMPT', attempt.id).filter(
      (audit) => audit.eventType === 'ATTEMPT_STARTED',
    );
    const attemptStartAudit = attemptStartAudits[0];
    const workflowStartAudits = this.listAuditEvents('WORKFLOW', workflow.id).filter(
      (audit) =>
        audit.eventType === 'WORKFLOW_ATTEMPT_STARTED' &&
        audit.commandId !== undefined &&
        audit.commandId === attemptStartAudit?.commandId,
    );
    const workflowStartAudit = workflowStartAudits[0];
    const command =
      attemptStartAudit?.commandId === undefined
        ? undefined
        : this.getProcessedCommand(attemptStartAudit.commandId);
    const outcome = command === undefined ? undefined : decodeStoredCommandOutcome(command.outcome);
    const expectedAggregateType = attempt.sequence === 1 ? 'GOAL' : 'WORKFLOW';
    const expectedAggregateId = attempt.sequence === 1 ? workflow.goalId : workflow.id;
    if (
      manifest?.goalId !== workflow.goalId ||
      manifest.workflowId !== workflow.id ||
      manifest.attemptId !== attempt.id ||
      manifest.phase !== attempt.phase ||
      manifest.createdAt !== attempt.startedAt ||
      manifest.executionProfileId !== executionProfileBinding.profileId ||
      manifest.executionProfileDigest !== executionProfileBinding.profileDigest ||
      manifest.policyBundleId !== policyBinding.policyBundleId ||
      manifest.policyBundleDigest !== policyBinding.policyBundleDigest ||
      attemptStartAudits.length !== 1 ||
      attemptStartAudit?.actorType !== 'RUNTIME' ||
      attemptStartAudit.commandId === undefined ||
      attemptStartAudit.beforeVersion === undefined ||
      attemptStartAudit.afterVersion === undefined ||
      attemptStartAudit.afterVersion !== attemptStartAudit.beforeVersion + 1 ||
      attemptStartAudit.occurredAt !== attempt.startedAt ||
      manifest.workflowVersion !== attemptStartAudit.afterVersion ||
      workflowStartAudits.length !== 1 ||
      workflowStartAudit?.actorType !== 'RUNTIME' ||
      workflowStartAudit.beforeVersion !== attemptStartAudit.beforeVersion ||
      workflowStartAudit.afterVersion !== attemptStartAudit.afterVersion ||
      workflowStartAudit.occurredAt !== attempt.startedAt ||
      command?.aggregateType !== expectedAggregateType ||
      command.aggregateId !== expectedAggregateId ||
      command.completedAt !== attempt.startedAt ||
      outcome?.disposition !== StoredCommandDisposition.APPLIED ||
      outcome.target.aggregateType !== expectedAggregateType ||
      outcome.target.aggregateId !== expectedAggregateId ||
      outcome.goalId !== workflow.goalId ||
      outcome.workflow.id !== workflow.id ||
      outcome.workflow.version !== manifest.workflowVersion ||
      outcome.workflow.phase !== attempt.phase ||
      outcome.workflow.runStatus !== RunStatus.RUNNING
    ) {
      throw new StoreInvariantError(
        `Worker phase Attempt ${attempt.id} has incomplete start authority`,
      );
    }
  }

  private assertPreStartCancellationClosure(workflow: WorkflowInstance): AuditEventRecord {
    const cancellationAudits = this.listAuditEvents('WORKFLOW', workflow.id).filter(
      (audit) => audit.eventType === 'WORKFLOW_CANCELLED',
    );
    const cancellationAudit = cancellationAudits[0];
    const command =
      cancellationAudit?.commandId === undefined
        ? undefined
        : this.getProcessedCommand(cancellationAudit.commandId);
    const outcome = command === undefined ? undefined : decodeStoredCommandOutcome(command.outcome);
    if (
      cancellationAudits.length !== 1 ||
      cancellationAudit?.actorType !== 'RUNTIME' ||
      cancellationAudit.commandId === undefined ||
      cancellationAudit.beforeVersion !== 1 ||
      cancellationAudit.afterVersion !== 2 ||
      cancellationAudit.occurredAt !== workflow.updatedAt ||
      command?.aggregateType !== 'GOAL' ||
      command.aggregateId !== workflow.goalId ||
      command.completedAt !== workflow.updatedAt ||
      outcome?.disposition !== StoredCommandDisposition.APPLIED ||
      outcome.target.aggregateType !== 'GOAL' ||
      outcome.target.aggregateId !== workflow.goalId ||
      outcome.goalId !== workflow.goalId ||
      outcome.workflow.id !== workflow.id ||
      outcome.workflow.version !== workflow.version ||
      outcome.workflow.phase !== workflow.phase ||
      outcome.workflow.runStatus !== workflow.runStatus
    ) {
      throw new StoreInvariantError(
        `Workflow ${workflow.id} has incomplete pre-start cancellation authority`,
      );
    }
    return cancellationAudit;
  }

  private assertRetainedWorkflowStartAuthorityClosure(): void {
    if (
      !this.hasTable('workflows') ||
      !this.hasTable('workflow_policy_bindings') ||
      !this.hasTable('workflow_execution_profile_bindings')
    ) {
      return;
    }
    const rows = this.#database.prepare('SELECT * FROM workflows ORDER BY id').all();
    for (const row of rows) {
      const workflow = decodeWorkflow(row);
      const owner = this.getGoalWithWorkflow(workflow.goalId);
      if (owner?.workflow.id !== workflow.id) {
        throw new StoreInvariantError(
          `Workflow ${workflow.id} has no exact Goal ownership authority`,
        );
      }
      this.resolveWorkflowStartAuthorityClosure(workflow);
    }
  }

  private assertRetainedWorkflowAttemptLifecycleClosure(): void {
    if (!this.hasTable('workflows') || !this.hasTable('attempts')) {
      return;
    }
    const row = this.#database
      .prepare(
        `SELECT owner_id AS id
           FROM (
             SELECT workflow.id AS owner_id
               FROM workflows AS workflow
              WHERE (
                    workflow.run_status = 'RUNNING'
                    AND NOT EXISTS (
                      SELECT 1
                        FROM attempts AS attempt
                       WHERE attempt.id = workflow.active_attempt_id
                         AND attempt.workflow_id = workflow.id
                         AND attempt.phase = workflow.phase
                         AND attempt.status = 'RUNNING'
                    )
                  )
                 OR (
                    workflow.run_status <> 'RUNNING'
                    AND workflow.active_attempt_id IS NOT NULL
                  )
             UNION ALL
             SELECT attempt.workflow_id AS owner_id
               FROM attempts AS attempt
               LEFT JOIN workflows AS workflow ON workflow.id = attempt.workflow_id
              WHERE attempt.status = 'RUNNING'
                AND (
                  workflow.id IS NULL
                  OR workflow.run_status <> 'RUNNING'
                  OR workflow.active_attempt_id IS NOT attempt.id
                  OR workflow.phase IS NOT attempt.phase
                )
           )
          ORDER BY owner_id
          LIMIT 1`,
      )
      .get();
    if (row === undefined) {
      return;
    }
    const identifier = workflowId(authorityIdentifierRowSchema.parse(row).id);
    throw new StoreInvariantError(
      `Workflow ${identifier} has no exact bidirectional RUNNING Attempt authority`,
    );
  }

  private assertRetainedM1RetryBoundaryClosure(): void {
    if (!this.hasTable('workflows') || !this.hasTable('attempts')) {
      return;
    }
    const row = this.#database
      .prepare(
        `SELECT workflow.id
           FROM workflows AS workflow
          WHERE EXISTS (
              SELECT 1
                FROM attempts AS failed
               WHERE failed.workflow_id = workflow.id
                 AND failed.status = 'FAILED'
                 AND failed.failure_class = 'TRANSIENT_BACKEND'
                 AND EXISTS (
                   SELECT 1
                     FROM attempts AS later
                    WHERE later.workflow_id = failed.workflow_id
                      AND later.sequence > failed.sequence
                 )
            )
             OR (
              EXISTS (
              SELECT 1
                FROM attempts AS attempt
               WHERE attempt.workflow_id = workflow.id
                 AND attempt.status = 'FAILED'
                 AND attempt.failure_class = 'TRANSIENT_BACKEND'
                 AND NOT EXISTS (
                   SELECT 1
                     FROM attempts AS later
                    WHERE later.workflow_id = attempt.workflow_id
                      AND later.sequence > attempt.sequence
                 )
                 AND (
                   workflow.phase <> attempt.phase
                   OR workflow.run_status NOT IN ('BLOCKED', 'CANCELLED')
                 )
              )
            )
          ORDER BY workflow.id
          LIMIT 1`,
      )
      .get();
    if (row === undefined) {
      return;
    }
    const identifier = workflowId(authorityIdentifierRowSchema.parse(row).id);
    throw new StoreInvariantError(
      `Workflow ${identifier} retains unprovable M1 transient retry authority`,
    );
  }

  private hasExactInitialGoalAndWorkflowCreationClosure(workflow: WorkflowInstance): boolean {
    const owner = this.getGoalWithWorkflow(workflow.goalId);
    if (owner === undefined || !sameCanonicalAuthority(owner.workflow, workflow)) {
      return false;
    }
    let initialGoal: Goal;
    let initialWorkflow: WorkflowInstance;
    try {
      initialGoal = decodeGoalSnapshot({
        ...owner.goal,
        status: GoalStatus.ACTIVE,
        updatedAt: owner.goal.createdAt,
      });
      initialWorkflow = decodeWorkflowSnapshot({
        id: workflow.id,
        goalId: workflow.goalId,
        goalRevision: workflow.goalRevision,
        phase: WorkflowPhase.DISCOVERY,
        runStatus: RunStatus.READY,
        version: workflowVersion(1),
        createdAt: workflow.createdAt,
        updatedAt: workflow.createdAt,
      });
      this.validateInitialGoalAndWorkflow(initialGoal, initialWorkflow);
    } catch {
      return false;
    }
    if (
      workflow.version === workflowVersion(1) &&
      (!sameCanonicalAuthority(owner.goal, initialGoal) ||
        !sameCanonicalAuthority(workflow, initialWorkflow))
    ) {
      return false;
    }
    const workflowAudits = this.listAuditEvents('WORKFLOW', workflow.id).filter(
      (audit) => audit.afterVersion === initialWorkflow.version,
    );
    const workflowAudit = workflowAudits[0];
    const goalAudits = this.listAuditEvents('GOAL', owner.goal.id).filter(
      (audit) => audit.afterVersion === initialGoal.revision,
    );
    const goalAudit = goalAudits[0];
    const expectedPayloadDigest = canonicalAuthorityDigests.digest(
      goalAndWorkflowCreationPayloadProjection(initialGoal, initialWorkflow),
    );
    return (
      workflowAudits.length === 1 &&
      goalAudits.length === 1 &&
      workflowAudit?.aggregateType === 'WORKFLOW' &&
      workflowAudit.aggregateId === workflow.id &&
      workflowAudit.eventType === 'WORKFLOW_CREATED' &&
      workflowAudit.actorType === 'RUNTIME' &&
      workflowAudit.commandId !== undefined &&
      workflowAudit.beforeVersion === undefined &&
      workflowAudit.afterVersion === initialWorkflow.version &&
      workflowAudit.occurredAt === initialWorkflow.createdAt &&
      goalAudit?.aggregateType === 'GOAL' &&
      goalAudit.aggregateId === owner.goal.id &&
      goalAudit.eventType === 'GOAL_CREATED' &&
      goalAudit.actorType === 'RUNTIME' &&
      goalAudit.commandId === workflowAudit.commandId &&
      goalAudit.beforeVersion === undefined &&
      goalAudit.afterVersion === initialGoal.revision &&
      goalAudit.occurredAt === initialGoal.createdAt &&
      goalAudit.payloadDigest === expectedPayloadDigest &&
      workflowAudit.payloadDigest === expectedPayloadDigest &&
      goalAudit.correlationId === workflowAudit.correlationId &&
      goalAudit.causationId === workflowAudit.causationId
    );
  }

  private hasExactIntakeMaterializationWorkflowClosure(
    workflow: WorkflowInstance,
    workflowAudit: AuditEventRecord | undefined,
  ): boolean {
    if (
      workflow.version !== workflowVersion(1) ||
      workflowAudit?.commandId === undefined ||
      !this.hasTable('goal_materializations') ||
      !this.hasTable('intake_command_outcomes')
    ) {
      return false;
    }
    const rows = storedIntakeRecordRowsSchema.parse(
      this.#database
        .prepare(
          `SELECT record_json
             FROM goal_materializations
            WHERE workflow_id = ? AND workflow_version = ?`,
        )
        .all(workflow.id, workflow.version),
    );
    if (rows.length !== 1) {
      return false;
    }
    const materialization = decodeGoalMaterializationRecord(
      parseJson(rows[0]?.record_json ?? '', 'Goal Materialization'),
      canonicalAuthorityDigests,
    );
    const outcome = this.getIntakeCommandOutcomeInsideTransaction(workflowAudit.commandId);
    const owner = this.getGoalWithWorkflow(workflow.goalId);
    return (
      owner !== undefined &&
      materialization.goalId === workflow.goalId &&
      materialization.goalRevision === workflow.goalRevision &&
      materialization.workflowId === workflow.id &&
      materialization.workflowVersion === workflow.version &&
      materialization.materializedAt === workflow.updatedAt &&
      workflowAudit.payloadDigest ===
        canonicalAuthorityDigests.digest(
          goalAndWorkflowCreationPayloadProjection(owner.goal, workflow),
        ) &&
      outcome?.disposition === IntakeCommandDisposition.APPLIED &&
      outcome.completedAt === workflow.updatedAt &&
      outcome.result.kind === 'MATERIALIZED' &&
      outcome.result.materializedGoalRef.goalMaterializationId === materialization.id &&
      outcome.result.materializedGoalRef.materializationDigest ===
        materialization.materializationDigest &&
      outcome.result.materializedGoalRef.goalId === workflow.goalId &&
      outcome.result.materializedGoalRef.goalRevision === workflow.goalRevision &&
      outcome.result.materializedGoalRef.workflowId === workflow.id &&
      outcome.result.materializedGoalRef.workflowVersion === workflow.version
    );
  }

  private assertCurrentWorkflowCommandClosure(workflow: WorkflowInstance): void {
    if (!this.hasM1AttemptAuthorityClosureMigration()) {
      return;
    }
    const currentAudits = this.listAuditEvents('WORKFLOW', workflow.id).filter(
      (audit) => audit.afterVersion === workflow.version,
    );
    const audit = currentAudits[0];
    const command =
      audit?.commandId === undefined ? undefined : this.getProcessedCommand(audit.commandId);
    const outcome = command === undefined ? undefined : decodeStoredCommandOutcome(command.outcome);
    const hasInitialCreationClosure = this.hasExactInitialGoalAndWorkflowCreationClosure(workflow);
    const hasIntakeMaterializationClosure =
      command === undefined && this.hasExactIntakeMaterializationWorkflowClosure(workflow, audit);
    if (
      currentAudits.length !== 1 ||
      !hasInitialCreationClosure ||
      audit?.actorType !== 'RUNTIME' ||
      audit.commandId === undefined ||
      audit.occurredAt !== workflow.updatedAt ||
      (workflow.version === 1
        ? audit.beforeVersion !== undefined
        : audit.beforeVersion !== workflow.version - 1) ||
      (!hasIntakeMaterializationClosure &&
        (command?.completedAt !== workflow.updatedAt ||
          outcome?.disposition !== StoredCommandDisposition.APPLIED ||
          outcome.goalId !== workflow.goalId ||
          outcome.workflow.id !== workflow.id ||
          outcome.workflow.version !== workflow.version ||
          outcome.workflow.phase !== workflow.phase ||
          outcome.workflow.runStatus !== workflow.runStatus))
    ) {
      throw new StoreInvariantError(
        `Workflow ${workflow.id} current state has no exact command and audit authority`,
      );
    }
  }

  private assertRetainedCurrentWorkflowCommandClosure(): void {
    if (
      !this.hasM1AttemptAuthorityClosureMigration() ||
      !this.hasTable('workflows') ||
      !this.hasTable('audit_events') ||
      !this.hasTable('processed_commands')
    ) {
      return;
    }
    const rows = this.#database.prepare('SELECT * FROM workflows ORDER BY id').all();
    for (const row of rows) {
      this.assertCurrentWorkflowCommandClosure(decodeWorkflow(row));
    }
  }

  private assertRetainedTerminalAttemptAuthorityClosure(): void {
    if (
      !this.hasM1AttemptAuthorityClosureMigration() ||
      !this.hasTable('attempts') ||
      !this.hasTable('workflows') ||
      !this.hasTable('audit_events') ||
      !this.hasTable('processed_commands')
    ) {
      return;
    }
    const rows = this.#database
      .prepare("SELECT * FROM attempts WHERE status <> 'RUNNING' ORDER BY id")
      .all();
    for (const row of rows) {
      const attempt = decodeAttempt(row);
      if (attempt.status === AttemptStatus.RUNNING) {
        throw new StoreInvariantError(`Terminal Attempt query returned ${attempt.id} as RUNNING`);
      }
      const workflow = this.getWorkflow(attempt.workflowId);
      const cancelledByWorkflow =
        attempt.status === AttemptStatus.INTERRUPTED &&
        attempt.terminationReason.startsWith(`${AttemptInterruptionReason.WORKFLOW_CANCELLED}:`);
      const expectedAttemptEventType = cancelledByWorkflow
        ? 'ATTEMPT_INTERRUPTED_BY_WORKFLOW_CANCELLATION'
        : 'ATTEMPT_FINISHED';
      const expectedWorkflowEventType = cancelledByWorkflow
        ? 'WORKFLOW_CANCELLED'
        : 'WORKFLOW_ATTEMPT_FINISHED';
      const terminalAudits = this.listAuditEvents('ATTEMPT', attempt.id).filter((audit) =>
        ['ATTEMPT_FINISHED', 'ATTEMPT_INTERRUPTED_BY_WORKFLOW_CANCELLATION'].includes(
          audit.eventType,
        ),
      );
      const attemptAudit = terminalAudits[0];
      const workflowAudits =
        workflow === undefined || attemptAudit?.commandId === undefined
          ? []
          : this.listAuditEvents('WORKFLOW', workflow.id).filter(
              (audit) =>
                ['WORKFLOW_ATTEMPT_FINISHED', 'WORKFLOW_CANCELLED'].includes(audit.eventType) &&
                audit.commandId === attemptAudit.commandId &&
                audit.beforeVersion === attemptAudit.beforeVersion &&
                audit.afterVersion === attemptAudit.afterVersion,
            );
      const workflowAudit = workflowAudits[0];
      const command =
        attemptAudit?.commandId === undefined
          ? undefined
          : this.getProcessedCommand(attemptAudit.commandId);
      const outcome =
        command === undefined ? undefined : decodeStoredCommandOutcome(command.outcome);
      const expectedAggregateType = cancelledByWorkflow ? 'GOAL' : 'WORKFLOW';
      const expectedAggregateId = cancelledByWorkflow ? workflow?.goalId : workflow?.id;
      const workerBound =
        attempt.contextManifestId !== undefined ||
        attempt.workerSessionRef !== undefined ||
        this.#database
          .prepare('SELECT 1 FROM context_manifests WHERE attempt_id = ?')
          .get(attempt.id) !== undefined;
      const expectedWorkerFailureClass =
        workerBound && attempt.status === AttemptStatus.FAILED
          ? attemptFailureClassForKnownWorkerReasonCode(attempt.terminationReason)
          : undefined;
      if (
        workflow === undefined ||
        terminalAudits.length !== 1 ||
        attemptAudit?.eventType !== expectedAttemptEventType ||
        attemptAudit.actorType !== 'RUNTIME' ||
        attemptAudit.commandId === undefined ||
        attemptAudit.beforeVersion === undefined ||
        attemptAudit.afterVersion !== attemptAudit.beforeVersion + 1 ||
        attemptAudit.occurredAt !== attempt.endedAt ||
        workflowAudits.length !== 1 ||
        workflowAudit?.eventType !== expectedWorkflowEventType ||
        workflowAudit.actorType !== 'RUNTIME' ||
        workflowAudit.payloadDigest !== attemptAudit.payloadDigest ||
        workflowAudit.occurredAt !== attempt.endedAt ||
        command?.aggregateType !== expectedAggregateType ||
        command.aggregateId !== expectedAggregateId ||
        command.completedAt !== attempt.endedAt ||
        outcome?.disposition !== StoredCommandDisposition.APPLIED ||
        outcome.target.aggregateType !== expectedAggregateType ||
        outcome.target.aggregateId !== expectedAggregateId ||
        outcome.goalId !== workflow.goalId ||
        outcome.workflow.id !== workflow.id ||
        outcome.workflow.version !== attemptAudit.afterVersion ||
        outcome.workflow.phase !== attempt.phase ||
        !isTerminalAttemptWorkflowRunStatusAuthorized(attempt, outcome.workflow.runStatus) ||
        workflow.version < attemptAudit.afterVersion ||
        workflow.updatedAt < attempt.endedAt ||
        (workerBound &&
          attempt.status === AttemptStatus.FAILED &&
          expectedWorkerFailureClass !== attempt.failureClass)
      ) {
        throw new StoreInvariantError(
          `Terminal Attempt ${attempt.id} has no exact command, audit, and Workflow outcome authority`,
        );
      }
    }
  }

  private decodeVerifiedContextManifestRow(row: unknown): ContextManifest {
    const manifest = decodeContextManifestRow(row);
    if (
      manifest.omissionDecisions.length !== 0 ||
      (manifest.schemaVersion === 2 &&
        manifest.entries.some(
          (entry) =>
            entry.kind !== ContextEntryKind.GOAL &&
            entry.kind !== ContextEntryKind.SUCCESS_CRITERION &&
            entry.kind !== ContextEntryKind.CANDIDATE,
        ))
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
    const installedProfile = this.getExecutionProfile(manifest.executionProfileId);
    const profileBinding = this.getExecutionProfileBinding(manifest.workflowId);
    const policyBinding = this.getWorkflowPolicyBinding(manifest.workflowId);
    const installedPolicy = this.getPolicyBundle(manifest.policyBundleId);
    if (
      goalView === undefined ||
      attempt === undefined ||
      installedProfile === undefined ||
      profileBinding === undefined ||
      policyBinding === undefined ||
      installedPolicy === undefined
    ) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} cannot resolve its authoritative M1 sources`,
      );
    }
    const { goal, workflow } = goalView;
    const projectReadAuthority =
      manifest.schemaVersion === 5 && manifest.projectReadAuthorityId !== undefined
        ? this.getProjectSourceReadAuthority(manifest.projectReadAuthorityId)
        : undefined;
    if (
      (manifest.schemaVersion === 5) !== (projectReadAuthority !== undefined) ||
      (projectReadAuthority !== undefined &&
        (projectReadAuthority.recordDigest !== manifest.projectReadAuthorityRecordDigest ||
          projectReadAuthority.sourceTree.projectionDigest !==
            manifest.projectReadSourceTreeProjectionDigest ||
          projectReadAuthority.gitState.projectionDigest !==
            manifest.projectReadGitStateProjectionDigest ||
          projectReadAuthority.goalId !== goal.id ||
          projectReadAuthority.goalRevision !== goal.revision ||
          projectReadAuthority.workflowId !== workflow.id ||
          projectReadAuthority.workflowVersion !== manifest.workflowVersion ||
          projectReadAuthority.phase !== manifest.phase ||
          projectReadAuthority.attemptId !== attempt.id ||
          projectReadAuthority.normalizedProjectRoot !== goal.scope.projectPath ||
          projectReadAuthority.policyBundleId !== manifest.policyBundleId ||
          projectReadAuthority.policyBundleDigest !== manifest.policyBundleDigest ||
          projectReadAuthority.executionProfileId !== manifest.executionProfileId ||
          projectReadAuthority.executionProfileDigest !== manifest.executionProfileDigest ||
          projectReadAuthority.capabilityGrantDigest !== manifest.capabilityGrantDigest ||
          projectReadAuthority.responseContractDigest !== manifest.responseContractDigest ||
          projectReadAuthority.issuedAt > manifest.createdAt))
    ) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} has no exact project-read authority`,
      );
    }
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
      manifest.executionProfileDigest !== installedProfile.profile.digest ||
      profileBinding.goalId !== goal.id ||
      profileBinding.profileId !== manifest.executionProfileId ||
      profileBinding.profileDigest !== manifest.executionProfileDigest ||
      profileBinding.boundAt > manifest.createdAt ||
      policyBinding.goalId !== goal.id ||
      policyBinding.policyBundleId !== manifest.policyBundleId ||
      policyBinding.policyBundleDigest !== manifest.policyBundleDigest ||
      policyBinding.boundAt > manifest.createdAt ||
      manifest.policyBundleDigest !== installedPolicy.bundle.digest ||
      installedPolicy.installedAt > manifest.createdAt
    ) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} does not bind its authoritative M1 sources`,
      );
    }

    let repairCompilation: ReturnType<typeof compileBoundedM2RepairContext> | undefined;
    if (
      manifest.schemaVersion === 3 ||
      (manifest.schemaVersion === 4 && manifest.repairContextDigest !== undefined)
    ) {
      if (candidateBinding === undefined) {
        throw new StoreInvariantError(
          `Repair Context Manifest ${manifest.id} has no child Candidate binding`,
        );
      }
      const repair = this.getAcceptanceRepairForRepairGeneration(candidateBinding.generationId);
      const decision =
        repair === undefined ? undefined : this.getAcceptanceDecision(repair.acceptanceDecisionId);
      const acceptanceManifest =
        repair === undefined
          ? undefined
          : this.getAcceptanceInputManifest(repair.inputManifestDigest);
      const evidenceSet =
        repair === undefined ? undefined : this.getEvidenceSet(repair.evidenceSetDigest);
      const parent =
        repair === undefined
          ? undefined
          : this.getCandidateGeneration(repair.rejectedCandidateGenerationId);
      const child = this.getCandidateGeneration(candidateBinding.generationId);
      if (
        repair === undefined ||
        decision === undefined ||
        acceptanceManifest === undefined ||
        evidenceSet === undefined ||
        parent === undefined ||
        child === undefined
      ) {
        throw new StoreInvariantError(
          `Repair Context Manifest ${manifest.id} cannot resolve its closed repair sources`,
        );
      }
      const evidence = evidenceSet.evidenceRefs.map((reference) => {
        const record = this.getEvidence(reference.evidenceId);
        const eligibility = this.getEvidenceEligibilityVersion(
          reference.evidenceId,
          reference.eligibilityVersion,
        );
        if (record === undefined || eligibility === undefined) {
          throw new StoreInvariantError(
            `Repair Context Manifest ${manifest.id} cannot resolve Evidence ${reference.evidenceId}`,
          );
        }
        return Object.freeze({ record, eligibility });
      });
      const freezeEvidenceRecords = this.listEvidenceForGeneration(parent.id).filter(
        ({ record }) => record.kind === EvidenceKind.CANDIDATE_FREEZE,
      );
      const freezeRecord = freezeEvidenceRecords[0]?.record;
      const freezeEligibility =
        freezeRecord === undefined
          ? undefined
          : this.getEvidenceEligibilityVersion(freezeRecord.id, aggregateVersion(1));
      const freezeEvidence =
        freezeRecord === undefined || freezeEligibility === undefined
          ? undefined
          : Object.freeze({ record: freezeRecord, eligibility: freezeEligibility });
      if (freezeEvidenceRecords.length !== 1 || freezeEvidence === undefined) {
        throw new StoreInvariantError(
          `Repair Context Manifest ${manifest.id} cannot resolve one parent freeze Evidence`,
        );
      }
      try {
        repairCompilation = compileBoundedM2RepairContext(
          {
            goal,
            workflowId: workflow.id,
            contextWorkflowVersion: manifest.workflowVersion,
            policyBundleId: installedPolicy.bundle.id,
            policyBundleDigest: installedPolicy.bundle.digest,
            repair,
            decision,
            manifest: acceptanceManifest,
            evidenceSet,
            parent,
            child,
            freezeEvidence,
            evidence,
          },
          canonicalAuthorityDigests,
        );
      } catch (error) {
        if (error instanceof TypeError) {
          throw new StoreInvariantError(
            `Repair Context Manifest ${manifest.id} has stale or mismatched source authority: ${error.message}`,
            { cause: error },
          );
        }
        throw error;
      }
      const expectedRepairDigest = sha256Digest(
        canonicalAuthorityDigests.digest(repairCompilation.repairContext),
      );
      if (
        manifest.repairContextDigest !== expectedRepairDigest ||
        manifest.priorAttemptFeedbackDigest !==
          repairCompilation.priorAttemptFeedback.feedbackDigest
      ) {
        throw new StoreInvariantError(
          `Repair Context Manifest ${manifest.id} has false repair projection digests`,
        );
      }
    }

    const expectedPackage = decodeContextPackage({
      schemaVersion: manifest.schemaVersion,
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
      ...(repairCompilation === undefined
        ? {}
        : {
            repairContext: repairCompilation.repairContext,
            priorAttemptFeedback: repairCompilation.priorAttemptFeedback,
          }),
      ...(candidateBinding === undefined
        ? {}
        : {
            candidateGenerationId: candidateBinding.generationId,
            candidateDigest: candidateBinding.digest,
          }),
      executionProfileId: installedProfile.profile.id,
      executionProfileDigest: installedProfile.profile.digest,
      policyBundleId: installedPolicy.bundle.id,
      policyBundleDigest: installedPolicy.bundle.digest,
      ...(isProtectedContextManifest(manifest)
        ? {
            acceptanceCriticalVerificationPlanId: manifest.acceptanceCriticalVerificationPlanId,
            acceptanceCriticalVerificationPlanDigest:
              manifest.acceptanceCriticalVerificationPlanDigest,
          }
        : {}),
      ...(projectReadAuthority === undefined
        ? {}
        : {
            projectReadAuthorityId: projectReadAuthority.id,
            projectReadAuthorityRecordDigest: projectReadAuthority.recordDigest,
            projectReadSourceTreeProjectionDigest: projectReadAuthority.sourceTree.projectionDigest,
            projectReadGitStateProjectionDigest: projectReadAuthority.gitState.projectionDigest,
          }),
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
    try {
      assertM1WorkerPhaseAttemptAuthority(
        manifest,
        attempt,
        expectedCapabilityGrantDigest,
        expectedResponseContractDigest,
      );
    } catch (error) {
      if (error instanceof TypeError) {
        throw new StoreInvariantError(
          `Context Manifest ${manifest.id} has invalid Worker-phase Attempt authority`,
        );
      }
      throw error;
    }
    if (manifest.packageDigest !== expectedPackageDigest) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} package digest does not match its authoritative sources`,
      );
    }
    if (manifest.capabilityGrantDigest !== expectedCapabilityGrantDigest) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} capability digest does not match its Attempt`,
      );
    }
    if (manifest.responseContractDigest !== expectedResponseContractDigest) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} response digest does not match its phase`,
      );
    }
    if (canonicalizeJson(manifest.entries) !== canonicalizeJson(expectedEntries)) {
      throw new StoreInvariantError(
        `Context Manifest ${manifest.id} entries do not match its authoritative sources`,
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
    const profileBinding = this.getExecutionProfileBinding(expectedWorkflowId);
    if (
      manifest === undefined ||
      profileBinding === undefined ||
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
      manifest.packageDigest !== claim.packageDigest ||
      manifest.executionProfileId !== claim.executionProfileId ||
      manifest.executionProfileDigest !== claim.executionProfileDigest ||
      profileBinding.profileId !== claim.executionProfileId ||
      profileBinding.profileDigest !== claim.executionProfileDigest
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
    const profileBinding = this.getExecutionProfileBinding(claim.workflowId);
    if (
      workflow === undefined ||
      attempt === undefined ||
      manifest === undefined ||
      profileBinding === undefined ||
      workflow.version < claim.workflowVersion ||
      attempt.workflowId !== claim.workflowId ||
      attempt.contextManifestId !== claim.contextManifestId ||
      attempt.workerSessionRef !== claim.workerSessionId ||
      manifest.workflowId !== claim.workflowId ||
      manifest.workflowVersion !== claim.workflowVersion ||
      manifest.attemptId !== claim.attemptId ||
      manifest.manifestDigest !== claim.contextManifestDigest ||
      manifest.packageDigest !== claim.packageDigest ||
      manifest.executionProfileId !== claim.executionProfileId ||
      manifest.executionProfileDigest !== claim.executionProfileDigest ||
      profileBinding.profileId !== claim.executionProfileId ||
      profileBinding.profileDigest !== claim.executionProfileDigest ||
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

  private assertRetainedExternalExecutionClosure(record: ExternalExecutionRecord): void {
    const claim = this.getWorkerDispatchClaim(record.attemptId);
    const manifest = this.getContextManifest(record.contextManifestId);
    const profile = this.getExecutionProfile(record.executionProfileId)?.profile;
    const policy = this.getPolicyBundle(record.policyBundleId)?.bundle;
    const expectedClaimDigest =
      claim === undefined
        ? undefined
        : sha256Digest(canonicalAuthorityDigests.digest(workerDispatchClaimProjection(claim)));
    const external =
      profile?.schemaVersion === 2 && profile.externalExecution.schemaVersion !== 3
        ? profile.externalExecution
        : undefined;
    const latestAudit = this.listAuditEvents('EXTERNAL_EXECUTION', record.id).find(
      (audit) => audit.sequence === record.auditSequence,
    );
    if (
      claim === undefined ||
      manifest === undefined ||
      profile === undefined ||
      external === undefined ||
      policy === undefined ||
      record.dispatchClaimDigest !== expectedClaimDigest ||
      record.workflowId !== claim.workflowId ||
      record.workflowVersionAtAuthorization !== claim.workflowVersion ||
      record.phaseVersion !== claim.workflowVersion ||
      record.attemptId !== claim.attemptId ||
      record.workerSessionId !== claim.workerSessionId ||
      record.contextManifestId !== claim.contextManifestId ||
      record.contextManifestDigest !== claim.contextManifestDigest ||
      record.contextPackageDigest !== claim.packageDigest ||
      record.executionProfileId !== claim.executionProfileId ||
      record.executionProfileDigest !== claim.executionProfileDigest ||
      record.goalId !== manifest.goalId ||
      record.goalRevision !== manifest.goalRevision ||
      record.phase !== manifest.phase ||
      record.executionProfileDigest !== profile.digest ||
      record.policyBundleId !== manifest.policyBundleId ||
      record.policyBundleDigest !== manifest.policyBundleDigest ||
      record.policyBundleDigest !== policy.digest ||
      record.backendKind !== external.backendKind ||
      record.binaryProtocolSchemaDigest !== external.protocolSchemaDigest ||
      record.executionConfigDigest !== external.executionConfigDigest ||
      record.managedRequirementsDigest !== external.managedRequirementsDigest ||
      record.instructionSourceManifestDigest !== external.instructionSourceManifestDigest ||
      record.controlledStateRootIdentity !== external.controlledStateRootIdentity ||
      record.thread.kind !== external.defaultThreadPolicy ||
      rawField(record, 'continuityPolicy') !== rawField(external, 'continuityPolicy') ||
      record.compactionPolicy !== external.compactionPolicy ||
      rawField(record, 'retentionPolicy') !== rawField(external, 'retentionPolicy') ||
      rawField(record, 'fallbackPolicy') !== rawField(external, 'fallbackPolicy') ||
      rawField(record, 'interruptionPolicy') !== rawField(external, 'interruptionPolicy') ||
      record.authorizedAt !== claim.claimedAt ||
      latestAudit?.actorType !== 'RUNTIME' ||
      latestAudit.commandId !== undefined ||
      latestAudit.afterVersion !== record.version ||
      latestAudit.payloadDigest !== record.recordDigest ||
      latestAudit.occurredAt !== record.updatedAt ||
      (record.version === 1
        ? latestAudit.eventType !== 'EXTERNAL_EXECUTION_AUTHORIZED' ||
          latestAudit.beforeVersion !== undefined ||
          record.state !== ExternalExecutionState.AUTHORIZED ||
          record.lastObservationId !== undefined
        : latestAudit.beforeVersion !== record.version - 1)
    ) {
      throw new StoreInvariantError(
        `External execution ${record.id} has incomplete durable authority`,
      );
    }

    if (record.lastObservationId !== undefined) {
      const observation = this.getExternalExecutionObservation(record.lastObservationId);
      if (
        observation?.externalExecutionId !== record.id ||
        observation.intentDigest !== record.intentDigest ||
        observation.expectedRecordVersion >= record.version ||
        (record.state !== ExternalExecutionState.ABANDONED &&
          (observation.expectedRecordVersion !== record.version - 1 ||
            observation.state !== record.state ||
            observation.compactionCount !== record.compactionCount ||
            observation.turnInterruptCount !== record.turnInterruptCount ||
            observation.failureCode !== record.failureCode ||
            observation.resultEventId !== record.resultEventId ||
            observation.observedAt !== record.updatedAt))
      ) {
        throw new StoreInvariantError(
          `External execution ${record.id} has a stale last observation`,
        );
      }
    } else if (record.version > 1 && record.state !== ExternalExecutionState.ABANDONED) {
      throw new StoreInvariantError(
        `External execution ${record.id} lost its lifecycle observation`,
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

    if (this.hasTable('external_backend_capability_records')) {
      const rows = this.#database
        .prepare('SELECT * FROM external_backend_capability_records ORDER BY record_digest')
        .all();
      for (const row of rows) {
        const record = this.decodeVerifiedExternalBackendCapabilityRow(row);
        const matchingAudit = this.listAuditEvents(
          'EXTERNAL_BACKEND_CAPABILITY',
          record.recordDigest,
        ).some(
          (audit) =>
            audit.eventType === 'EXTERNAL_BACKEND_CAPABILITY_INSTALLED' &&
            audit.actorType === 'RUNTIME' &&
            audit.commandId === undefined &&
            audit.beforeVersion === undefined &&
            audit.afterVersion === undefined &&
            audit.payloadDigest === record.recordDigest &&
            audit.occurredAt === record.observedAt,
        );
        if (!matchingAudit) {
          throw new StoreInvariantError(
            `External backend capability ${record.recordDigest} has no installation audit`,
          );
        }
      }
    }

    if (this.hasTable('execution_profiles')) {
      const identifiers = z
        .array(z.object({ id: z.string() }))
        .parse(this.#database.prepare('SELECT id FROM execution_profiles ORDER BY id').all());
      for (const { id: rawIdentifier } of identifiers) {
        const installed = this.getExecutionProfile(executionProfileId(rawIdentifier));
        if (installed === undefined) {
          throw new StoreInvariantError('Execution Profile disappeared during retained scan');
        }
        const matchingAudit = this.listAuditEvents('EXECUTION_PROFILE', installed.profile.id).some(
          (audit) =>
            audit.eventType === 'EXECUTION_PROFILE_INSTALLED' &&
            audit.actorType === 'RUNTIME' &&
            audit.commandId === undefined &&
            audit.beforeVersion === undefined &&
            audit.afterVersion === undefined &&
            audit.payloadDigest === installed.profile.digest &&
            audit.occurredAt === installed.installedAt,
        );
        if (!matchingAudit) {
          throw new StoreInvariantError(
            `Execution Profile ${installed.profile.id} has no matching installation audit authority`,
          );
        }
        if (!this.hasExactExternalProfileCapabilityAuthority(installed.profile)) {
          throw new StoreInvariantError(
            `Execution Profile ${installed.profile.id} has no exact supported backend capability authority`,
          );
        }
      }
    }

    if (this.hasTable('workflow_policy_bindings')) {
      const rows = this.#database
        .prepare('SELECT * FROM workflow_policy_bindings ORDER BY workflow_id')
        .all();
      for (const row of rows) {
        this.assertWorkflowPolicyBindingClosure(decodeWorkflowPolicyBindingRow(row));
      }
    }

    if (this.hasTable('workflow_execution_profile_bindings')) {
      const rows = this.#database
        .prepare('SELECT * FROM workflow_execution_profile_bindings ORDER BY workflow_id')
        .all();
      for (const row of rows) {
        this.assertExecutionProfileBindingClosure(decodeExecutionProfileBindingRow(row));
      }
    }

    if (this.hasTable('context_manifests')) {
      const identifiers = z
        .array(z.object({ id: z.string() }))
        .parse(this.#database.prepare('SELECT id FROM context_manifests ORDER BY id').all());
      for (const { id: rawIdentifier } of identifiers) {
        if (this.getContextManifest(contextManifestId(rawIdentifier)) === undefined) {
          throw new StoreInvariantError('Context Manifest disappeared during retained scan');
        }
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

    if (this.hasTable('external_execution_records')) {
      const rows = this.#database
        .prepare('SELECT * FROM external_execution_records ORDER BY id')
        .all();
      for (const row of rows) {
        this.assertRetainedExternalExecutionClosure(this.decodeVerifiedExternalExecutionRow(row));
      }
    }

    if (this.hasTable('external_execution_observations')) {
      const rows = this.#database
        .prepare('SELECT * FROM external_execution_observations ORDER BY id')
        .all();
      for (const row of rows) {
        const observation = this.decodeVerifiedExternalExecutionObservationRow(row);
        const execution = this.getExternalExecution(observation.externalExecutionId);
        const audit = this.listAuditEvents('EXTERNAL_EXECUTION_OBSERVATION', observation.id);
        const auditEntry = audit.length === 1 ? audit[0] : undefined;
        if (
          execution?.intentDigest !== observation.intentDigest ||
          execution.version <= observation.expectedRecordVersion ||
          auditEntry?.eventType !== 'EXTERNAL_EXECUTION_OBSERVED' ||
          auditEntry.actorType !== 'RUNTIME' ||
          auditEntry.beforeVersion !== observation.expectedRecordVersion ||
          auditEntry.afterVersion !== observation.expectedRecordVersion + 1 ||
          auditEntry.payloadDigest !== observation.observationDigest ||
          auditEntry.occurredAt !== observation.observedAt
        ) {
          throw new StoreInvariantError(
            `External execution observation ${observation.id} has incomplete authority`,
          );
        }
      }
    }

    if (this.hasTable('external_maintenance_intents')) {
      const rows = this.#database
        .prepare('SELECT * FROM external_maintenance_intents ORDER BY id')
        .all();
      for (const row of rows) {
        const maintenance = this.decodeVerifiedExternalMaintenanceIntentRow(row);
        const execution = this.getExternalExecution(maintenance.externalExecutionId);
        const audits = this.listAuditEvents('EXTERNAL_MAINTENANCE', maintenance.id);
        const matchingAudit = audits.some(
          (audit) =>
            audit.actorType === 'RUNTIME' &&
            audit.commandId === undefined &&
            (maintenance.state === ExternalMaintenanceState.AUTHORIZED
              ? audit.eventType === 'EXTERNAL_MAINTENANCE_AUTHORIZED' &&
                audit.beforeVersion === undefined &&
                audit.afterVersion === 1 &&
                audit.occurredAt === maintenance.authorizedAt &&
                audit.payloadDigest === maintenance.recordDigest
              : audit.eventType === 'EXTERNAL_MAINTENANCE_COMPLETED' &&
                audit.beforeVersion === 1 &&
                audit.afterVersion === 2 &&
                audit.occurredAt === maintenance.observedAt &&
                audit.payloadDigest === maintenance.recordDigest),
        );
        if (
          execution?.compactionPolicy !== 'MANUAL_BEFORE_OPERATION' ||
          maintenance.sequence !== 1 ||
          (maintenance.state === ExternalMaintenanceState.AUTHORIZED &&
            (execution.state === ExternalExecutionState.COMPLETED ||
              execution.state === ExternalExecutionState.INTERRUPTED ||
              execution.state === ExternalExecutionState.FAILED ||
              execution.state === ExternalExecutionState.ABANDONED)) ||
          !matchingAudit
        ) {
          throw new StoreInvariantError(
            `External maintenance ${maintenance.id} has incomplete durable authority`,
          );
        }
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
    if (this.hasTable('evidence_payloads')) {
      const payloadRows = evidencePayloadIdentityRowsSchema.parse(
        this.#database
          .prepare('SELECT digest, byte_length FROM evidence_payloads ORDER BY digest, byte_length')
          .all(),
      );
      for (const row of payloadRows) {
        if (this.getEvidencePayload(sha256Digest(row.digest), row.byte_length) === undefined) {
          throw new StoreInvariantError('Retained Evidence payload authority is malformed');
        }
      }
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
      const localVerification = relatedSpecifications.find(
        (specification) => specification.kind === CheckSpecificationKind.LOCAL_COMMAND,
      );
      if (
        goal === undefined ||
        relatedSpecifications.length !== (localVerification === undefined ? 2 : 3) ||
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
        {
          freeze,
          verification,
          obligations: obligations.filter(
            (obligation) => obligation.requiredEvidenceKind === EvidenceKind.TEST_RESULT,
          ),
        },
        generation.createdAt,
      );
      if (localVerification !== undefined) {
        const localObligations = obligations.filter(
          (obligation) =>
            obligation.requiredEvidenceKind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT,
        );
        const localCreatedAt = localObligations[0]?.createdAt;
        if (localCreatedAt === undefined) {
          throw new StoreInvariantError(
            `Candidate generation ${generation.id} lacks local Verification Obligations`,
          );
        }
        validateLocalCommandVerificationPolicy(
          goal,
          generation,
          { verification: localVerification, obligations: localObligations },
          localCreatedAt,
        );
      }
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

  private assertRetainedProjectReadAuthorityClosure(): void {
    if (!this.hasTable('project_source_read_authorities')) {
      return;
    }
    const rows = this.#database
      .prepare('SELECT * FROM project_source_read_authorities ORDER BY id')
      .all();
    const authorityIds = new Set<ProjectSourceReadAuthorityId>();
    for (const row of rows) {
      const decoded = decodeProjectSourceReadAuthorityRow(row);
      const record = this.getProjectSourceReadAuthority(decoded.id);
      const attempt = this.getAttempt(decoded.attemptId);
      const manifest =
        attempt?.contextManifestId === undefined
          ? undefined
          : this.getContextManifest(attempt.contextManifestId);
      if (
        record === undefined ||
        canonicalizeJson(record) !== canonicalizeJson(decoded) ||
        authorityIds.has(decoded.id) ||
        manifest?.schemaVersion !== 5 ||
        manifest.projectReadAuthorityId !== decoded.id ||
        manifest.projectReadAuthorityRecordDigest !== decoded.recordDigest ||
        manifest.projectReadSourceTreeProjectionDigest !== decoded.sourceTree.projectionDigest ||
        manifest.projectReadGitStateProjectionDigest !== decoded.gitState.projectionDigest
      ) {
        throw new StoreInvariantError(
          `Project-source read authority ${decoded.id} has incomplete retained Context authority`,
        );
      }
      authorityIds.add(decoded.id);
    }

    const extensionRows = z.array(projectReadContextAuthorityRowSchema).parse(
      this.#database
        .prepare(
          `SELECT context_manifest_id AS id, project_read_authority_id
             FROM project_read_context_manifest_extensions
            ORDER BY context_manifest_id`,
        )
        .all(),
    );
    for (const row of extensionRows) {
      const manifest = this.getContextManifest(contextManifestId(row.id));
      const authorityIdentifier = projectSourceReadAuthorityId(row.project_read_authority_id);
      if (
        manifest?.schemaVersion !== 5 ||
        manifest.projectReadAuthorityId !== authorityIdentifier ||
        !authorityIds.has(authorityIdentifier)
      ) {
        throw new StoreInvariantError(
          `Project-read Context ${row.id} has no retained source authority`,
        );
      }
    }
  }

  private assertRetainedProjectReadCleanupAuthorityClosure(): void {
    if (!this.hasTable('project_read_workspace_authority_snapshots')) {
      return;
    }
    const snapshotIds = z.array(z.object({ id: z.string(), issued_at: z.string() })).parse(
      this.#database
        .prepare(
          `SELECT id, issued_at FROM project_read_workspace_authority_snapshots
              ORDER BY authority_sequence`,
        )
        .all(),
    );
    let previousSnapshotTime: string | undefined;
    for (const row of snapshotIds) {
      if (previousSnapshotTime !== undefined && row.issued_at < previousSnapshotTime) {
        throw new StoreInvariantError('Project-read authority snapshot time moved backward');
      }
      if (
        this.getProjectReadWorkspaceAuthoritySnapshot(
          projectReadWorkspaceAuthoritySnapshotId(row.id),
        ) === undefined
      ) {
        throw new StoreInvariantError(`Project-read authority snapshot ${row.id} disappeared`);
      }
      previousSnapshotTime = row.issued_at;
    }
    const observationIds = z
      .array(z.object({ id: z.string() }))
      .parse(
        this.#database
          .prepare('SELECT id FROM project_read_workspace_observations ORDER BY id')
          .all(),
      );
    for (const row of observationIds) {
      if (
        this.getProjectReadWorkspaceObservation(projectReadWorkspaceObservationId(row.id)) ===
        undefined
      ) {
        throw new StoreInvariantError(`Project-read workspace observation ${row.id} disappeared`);
      }
    }
    const grantIds = z
      .array(z.object({ id: z.string() }))
      .parse(
        this.#database
          .prepare('SELECT id FROM project_read_snapshot_cleanup_grants ORDER BY id')
          .all(),
      );
    for (const row of grantIds) {
      if (
        this.getProjectReadSnapshotCleanupGrant(projectReadSnapshotCleanupGrantId(row.id)) ===
        undefined
      ) {
        throw new StoreInvariantError(`Project-read cleanup Grant ${row.id} disappeared`);
      }
    }
    const outcomeGrantIds = z
      .array(z.object({ grant_id: z.string() }))
      .parse(
        this.#database
          .prepare('SELECT grant_id FROM project_read_snapshot_cleanup_outcomes ORDER BY grant_id')
          .all(),
      );
    for (const row of outcomeGrantIds) {
      if (
        this.getProjectReadSnapshotCleanupOutcome(
          projectReadSnapshotCleanupGrantId(row.grant_id),
        ) === undefined
      ) {
        throw new StoreInvariantError(
          `Project-read cleanup Outcome for ${row.grant_id} disappeared`,
        );
      }
    }
    const incomplete = this.#database
      .prepare(
        `SELECT observation.id
           FROM project_read_snapshot_cleanup_observations AS observation
           LEFT JOIN project_read_snapshot_cleanup_outcomes AS outcome
             ON outcome.cleanup_observation_id = observation.id
           LEFT JOIN project_read_snapshot_cleanup_consumptions AS consumption
             ON consumption.grant_id = observation.grant_id
          WHERE outcome.id IS NULL OR consumption.grant_id IS NULL
          LIMIT 1`,
      )
      .get();
    if (incomplete !== undefined) {
      throw new StoreInvariantError('Project-read cleanup retained a partial resolution');
    }
  }

  private assertRetainedProtectedVerificationAuthorityClosure(): void {
    if (!this.hasTable('acceptance_critical_verification_plans')) {
      return;
    }

    const planRows = this.#database
      .prepare('SELECT * FROM acceptance_critical_verification_plans ORDER BY workflow_id')
      .all();
    const plansByWorkflow = new Map<WorkflowId, AcceptanceCriticalVerificationPlan>();
    for (const row of planRows) {
      const decoded = decodeAcceptanceCriticalVerificationPlanRow(row);
      const plan = this.getAcceptanceCriticalVerificationPlan(decoded.workflowId);
      const goal = this.getGoal(decoded.goalId);
      const workflow = this.getWorkflow(decoded.workflowId);
      const policy = this.getPolicyBundle(decoded.policyBundleId)?.bundle;
      const profile = this.getExecutionProfile(decoded.executionProfileId)?.profile;
      const policyBinding = this.getWorkflowPolicyBinding(decoded.workflowId);
      const profileBinding = this.getExecutionProfileBinding(decoded.workflowId);
      const planAudits = this.listAuditEvents(
        'ACCEPTANCE_CRITICAL_VERIFICATION_PLAN',
        decoded.id,
      ).filter((audit) => audit.eventType === 'ACCEPTANCE_CRITICAL_VERIFICATION_PLAN_CREATED');
      const firstAttemptRow = this.#database
        .prepare('SELECT * FROM attempts WHERE workflow_id = ? AND sequence = 1')
        .get(decoded.workflowId);
      const firstAttempt =
        firstAttemptRow === undefined ? undefined : decodeAttempt(firstAttemptRow);
      const firstAttemptAudit =
        firstAttempt === undefined
          ? undefined
          : this.listAuditEvents('ATTEMPT', firstAttempt.id).find(
              (audit) => audit.eventType === 'ATTEMPT_STARTED',
            );
      const firstManifest =
        firstAttempt?.contextManifestId === undefined
          ? undefined
          : this.getContextManifest(firstAttempt.contextManifestId);
      const requiredCriteria =
        goal?.successCriteria
          .filter(({ required }) => required)
          .map(({ id }) => id)
          .sort() ?? [];
      const requiredRules = policy === undefined ? [] : [...policy.acceptanceRules].sort();
      if (
        plan === undefined ||
        canonicalizeJson(plan) !== canonicalizeJson(decoded) ||
        plansByWorkflow.has(decoded.workflowId) ||
        goal?.revision !== decoded.goalRevision ||
        workflow?.goalId !== decoded.goalId ||
        workflow.goalRevision !== decoded.goalRevision ||
        workflow.version < decoded.workflowVersionAtLock ||
        policy?.digest !== decoded.policyBundleDigest ||
        profile?.digest !== decoded.executionProfileDigest ||
        policyBinding?.policyBundleId !== decoded.policyBundleId ||
        policyBinding.policyBundleDigest !== decoded.policyBundleDigest ||
        profileBinding?.profileId !== decoded.executionProfileId ||
        profileBinding.profileDigest !== decoded.executionProfileDigest ||
        canonicalizeJson(decoded.acceptanceCriticalCriterionIds) !==
          canonicalizeJson(requiredCriteria) ||
        canonicalizeJson(decoded.acceptanceRuleIds) !== canonicalizeJson(requiredRules) ||
        decoded.protectedAssetManifestDigest !==
          sha256Digest(
            canonicalAuthorityDigests.digest(
              protectedAssetManifestProjection(decoded.protectedAssets),
            ),
          ) ||
        planAudits.length !== 1 ||
        planAudits[0]?.actorType !== 'RUNTIME' ||
        planAudits[0].commandId === undefined ||
        planAudits[0].commandId !== firstAttemptAudit?.commandId ||
        planAudits[0].payloadDigest !== decoded.planDigest ||
        planAudits[0].occurredAt !== decoded.createdAt ||
        firstAttempt?.startedAt !== decoded.createdAt ||
        firstManifest === undefined ||
        !isProtectedContextManifest(firstManifest) ||
        firstManifest.workflowVersion !== decoded.workflowVersionAtLock ||
        firstManifest.acceptanceCriticalVerificationPlanId !== decoded.id ||
        firstManifest.acceptanceCriticalVerificationPlanDigest !== decoded.planDigest
      ) {
        throw new StoreInvariantError(
          `Protected Verification Plan ${decoded.id} has incomplete retained Start authority`,
        );
      }
      const contextIdentifiers = this.#database
        .prepare('SELECT id FROM context_manifests WHERE workflow_id = ? ORDER BY id')
        .all(decoded.workflowId);
      for (const identifierRow of contextIdentifiers) {
        const identifier = contextManifestId(authorityIdentifierRowSchema.parse(identifierRow).id);
        const manifest = this.getContextManifest(identifier);
        if (
          manifest === undefined ||
          !isProtectedContextManifest(manifest) ||
          manifest.acceptanceCriticalVerificationPlanId !== decoded.id ||
          manifest.acceptanceCriticalVerificationPlanDigest !== decoded.planDigest
        ) {
          throw new StoreInvariantError(
            `Protected Workflow ${decoded.workflowId} has a Context outside its immutable Plan`,
          );
        }
      }
      plansByWorkflow.set(decoded.workflowId, decoded);
    }

    const protectedContextRows = this.#database
      .prepare('SELECT context_manifest_id AS id FROM protected_context_manifest_extensions')
      .all();
    for (const row of protectedContextRows) {
      const identifier = contextManifestId(authorityIdentifierRowSchema.parse(row).id);
      const manifest = this.getContextManifest(identifier);
      if (manifest === undefined || !plansByWorkflow.has(manifest.workflowId)) {
        throw new StoreInvariantError(
          `Protected Context ${identifier} has no immutable Verification Plan`,
        );
      }
    }

    const specifications = this.listCheckSpecifications();
    for (const specification of specifications) {
      if (
        specification.kind !== CheckSpecificationKind.LOCAL_COMMAND ||
        specification.schemaVersion !== 3
      ) {
        continue;
      }
      const generationRow = this.#database
        .prepare('SELECT * FROM candidate_generations WHERE id = ?')
        .get(specification.candidateGenerationId);
      const decodedGeneration =
        generationRow === undefined ? undefined : decodeCandidateGenerationRow(generationRow);
      const workflow =
        decodedGeneration === undefined
          ? undefined
          : this.getWorkflow(decodedGeneration.workflowId);
      const goal = workflow === undefined ? undefined : this.getGoal(workflow.goalId);
      const plan =
        decodedGeneration === undefined
          ? undefined
          : plansByWorkflow.get(decodedGeneration.workflowId);
      if (
        decodedGeneration === undefined ||
        goal === undefined ||
        workflow === undefined ||
        plan === undefined
      ) {
        throw new StoreInvariantError(
          `Protected Check ${specification.id} has no retained owner or Plan`,
        );
      }
      const lease = createProtectedAssetReadLease(
        {
          plan,
          goal,
          workflow,
          generation: decodedGeneration.generation,
          checkSpecificationId: specification.id,
          checkSpecificationVersion: specification.version,
        },
        canonicalAuthorityDigests,
      );
      assertProtectedLocalCommandCheckMatchesPlan(
        specification,
        plan,
        lease,
        canonicalAuthorityDigests,
      );
    }

    const evidenceRows = this.#database
      .prepare('SELECT * FROM evidence_records WHERE schema_version = 3 ORDER BY id')
      .all();
    for (const row of evidenceRows) {
      const record = this.decodeVerifiedEvidenceRecordRow(row);
      if (record.kind !== EvidenceKind.LOCAL_COMMAND_TEST_RESULT || record.schemaVersion !== 3) {
        throw new StoreInvariantError(`Protected Evidence ${record.id} has an invalid family`);
      }
      const persistedCheck = this.getCheckSpecification(record.checkSpec.id);
      const plan = plansByWorkflow.get(record.workflowId);
      const workflow = this.getWorkflow(record.workflowId);
      const goal = workflow === undefined ? undefined : this.getGoal(workflow.goalId);
      const generation = this.getCandidateGeneration(record.candidateGenerationId);
      const obligation = this.getVerificationObligation(record.verificationObligationId);
      const attempt = this.getAttempt(record.attemptId);
      if (
        persistedCheck === undefined ||
        canonicalizeJson(persistedCheck) !== canonicalizeJson(record.checkSpec) ||
        plan === undefined ||
        workflow === undefined ||
        goal === undefined ||
        generation === undefined ||
        obligation === undefined ||
        attempt?.workflowId !== record.workflowId ||
        attempt.phase !== WorkflowPhase.EVIDENCE_BUILD ||
        obligation.candidateGenerationId !== record.candidateGenerationId ||
        obligation.checkSpecRef !== `${record.checkSpec.id}@${record.checkSpec.version}`
      ) {
        throw new StoreInvariantError(
          `Protected Evidence ${record.id} has incomplete invocation causality`,
        );
      }
      const lease = createProtectedAssetReadLease(
        {
          plan,
          goal,
          workflow,
          generation,
          checkSpecificationId: record.checkSpec.id,
          checkSpecificationVersion: record.checkSpec.version,
        },
        canonicalAuthorityDigests,
      );
      assertProtectedLocalCommandCheckMatchesPlan(
        record.checkSpec,
        plan,
        lease,
        canonicalAuthorityDigests,
      );
      if (record.protectedAssetReadLeaseDigest !== lease.leaseDigest) {
        throw new StoreInvariantError(
          `Protected Evidence ${record.id} changed its static asset lease`,
        );
      }
    }

    if (this.hasTable('evidence_sets')) {
      const setRows = this.#database.prepare('SELECT * FROM evidence_sets ORDER BY digest').all();
      for (const row of setRows) {
        const set = decodeEvidenceSetRow(row);
        const generationRow = this.#database
          .prepare('SELECT * FROM candidate_generations WHERE id = ?')
          .get(set.candidateGenerationId);
        const decodedGeneration =
          generationRow === undefined ? undefined : decodeCandidateGenerationRow(generationRow);
        const plan =
          decodedGeneration === undefined
            ? undefined
            : plansByWorkflow.get(decodedGeneration.workflowId);
        if (plan === undefined) {
          continue;
        }
        for (const reference of set.evidenceRefs) {
          const record = this.getEvidence(reference.evidenceId);
          if (
            record?.kind !== EvidenceKind.LOCAL_COMMAND_TEST_RESULT ||
            record.schemaVersion !== 3 ||
            record.acceptanceCriticalVerificationPlanId !== plan.id ||
            record.acceptanceCriticalVerificationPlanDigest !== plan.planDigest
          ) {
            throw new StoreInvariantError(
              `Protected Evidence Set ${set.digest} contains a supplementary Check family`,
            );
          }
        }
      }
    }

    if (this.hasTable('acceptance_input_manifests')) {
      const manifestRows = this.#database
        .prepare('SELECT * FROM acceptance_input_manifests ORDER BY manifest_digest')
        .all();
      for (const row of manifestRows) {
        const manifest = decodeAcceptanceInputManifestRow(row);
        const plan = plansByWorkflow.get(manifest.workflowId);
        if (
          (plan === undefined) !== (manifest.schemaVersion === 1) ||
          (plan !== undefined &&
            manifest.schemaVersion === 2 &&
            (manifest.acceptanceCriticalVerificationPlanId !== plan.id ||
              manifest.acceptanceCriticalVerificationPlanDigest !== plan.planDigest))
        ) {
          throw new StoreInvariantError(
            `Acceptance Manifest ${manifest.manifestDigest} changed protected Plan authority`,
          );
        }
      }
    }
  }

  private assertRetainedRecoveryAuthorityClosure(): void {
    if (!this.hasTable('recovery_reconciliations')) {
      return;
    }
    const rows = this.#database
      .prepare(
        'SELECT * FROM recovery_reconciliations ORDER BY workflow_id, resulting_workflow_version',
      )
      .all();
    for (const row of rows) {
      const recovery = this.decodeVerifiedRecoveryReconciliationRow(row);
      const goal = this.getGoal(recovery.goalId);
      const workflow = this.getWorkflow(recovery.workflowId);
      const sourceAttempt =
        recovery.sourceAttemptId === undefined
          ? undefined
          : this.getAttempt(recovery.sourceAttemptId);
      const binding = this.getExecutionProfileBinding(recovery.workflowId);
      const policyBinding = this.getWorkflowPolicyBinding(recovery.workflowId);
      const claim =
        sourceAttempt === undefined ? undefined : this.getWorkerDispatchClaim(sourceAttempt.id);
      const expectedClaimDigest =
        claim === undefined
          ? undefined
          : sha256Digest(canonicalAuthorityDigests.digest(workerDispatchClaimProjection(claim)));
      const recoveryAudits = this.listAuditEvents('RECOVERY_RECONCILIATION', recovery.id).filter(
        (audit) => audit.eventType === 'RECOVERY_RECONCILIATION_RECORDED',
      );
      const recoveryAudit = recoveryAudits[0];
      if (
        goal === undefined ||
        workflow === undefined ||
        sourceAttempt === undefined ||
        binding === undefined ||
        policyBinding === undefined ||
        goal.revision !== recovery.goalRevision ||
        workflow.goalId !== recovery.goalId ||
        workflow.version < recovery.resultingWorkflowVersion ||
        sourceAttempt.workflowId !== recovery.workflowId ||
        sourceAttempt.phase !== recovery.phase ||
        binding.profileId !== recovery.executionProfileId ||
        binding.profileDigest !== recovery.executionProfileDigest ||
        binding.boundAt > recovery.inspectedAt ||
        policyBinding.goalId !== recovery.goalId ||
        policyBinding.boundAt > recovery.inspectedAt ||
        recovery.expectedProjectIdentity !==
          deriveM1BaseProjectIdentity(goal.scope.projectPath, canonicalAuthorityDigests) ||
        recovery.dispatchClaimDigest !== expectedClaimDigest ||
        recoveryAudits.length !== 1 ||
        recoveryAudit?.actorType !== 'RUNTIME' ||
        recoveryAudit.commandId === undefined ||
        recoveryAudit.beforeVersion !== recovery.inspectedWorkflowVersion ||
        recoveryAudit.afterVersion !== recovery.resultingWorkflowVersion ||
        recoveryAudit.payloadDigest !== recovery.reconciliationDigest ||
        recoveryAudit.occurredAt !== recovery.inspectedAt ||
        recoveryAudit.sequence <= recovery.lastAuditSequence
      ) {
        throw new StoreInvariantError(
          `Recovery reconciliation ${recovery.id} lacks retained control authority`,
        );
      }

      if (recovery.candidateGenerationId === undefined) {
        if (
          recovery.candidateBaseIdentity !== undefined ||
          recovery.expectedCandidateDigest !== undefined ||
          recovery.observedCandidateDigest !== undefined
        ) {
          throw new StoreInvariantError(
            `Recovery reconciliation ${recovery.id} has partial Candidate history`,
          );
        }
      } else {
        const generation = this.getCandidateGeneration(recovery.candidateGenerationId);
        const candidate = this.getCandidateForGoal(recovery.goalId);
        if (
          generation === undefined ||
          generation.candidateId !== candidate?.id ||
          recovery.candidateBaseIdentity !== candidate.baseProjectIdentity ||
          (recovery.expectedCandidateDigest !== generation.baseDigest &&
            recovery.expectedCandidateDigest !== generation.frozenDigest)
        ) {
          throw new StoreInvariantError(
            `Recovery reconciliation ${recovery.id} lacks retained Candidate authority`,
          );
        }
      }

      const commandIdentifier = recoveryAudit.commandId;
      const processed = this.getProcessedCommand(commandIdentifier);
      const outcome =
        processed === undefined ? undefined : decodeStoredCommandOutcome(processed.outcome);
      const expectedRunStatus =
        recovery.purpose === RecoveryReconciliationPurpose.STARTUP ||
        recovery.disposition === RecoveryReconciliationDisposition.BLOCKED
          ? RunStatus.BLOCKED
          : RunStatus.READY;
      const expectedPhase =
        expectedRunStatus === RunStatus.READY ? recovery.safeResumePhase : recovery.phase;
      const expectedTargetType =
        recovery.purpose === RecoveryReconciliationPurpose.STARTUP ? 'WORKFLOW' : 'GOAL';
      const expectedTargetId =
        expectedTargetType === 'WORKFLOW' ? recovery.workflowId : recovery.goalId;
      if (
        expectedPhase === undefined ||
        recovery.disposition === RecoveryReconciliationDisposition.SAFE_EARLIER_PHASE ||
        processed?.aggregateType !== expectedTargetType ||
        processed.aggregateId !== expectedTargetId ||
        processed.completedAt !== recovery.inspectedAt ||
        outcome?.disposition !== StoredCommandDisposition.APPLIED ||
        outcome.goalId !== recovery.goalId ||
        outcome.workflow.id !== recovery.workflowId ||
        outcome.workflow.version !== recovery.resultingWorkflowVersion ||
        outcome.workflow.phase !== expectedPhase ||
        outcome.workflow.runStatus !== expectedRunStatus
      ) {
        throw new StoreInvariantError(
          `Recovery reconciliation ${recovery.id} lacks its applied command outcome`,
        );
      }

      const workflowAudits = this.listAuditEvents('WORKFLOW', recovery.workflowId).filter(
        (audit) =>
          audit.commandId === commandIdentifier &&
          audit.beforeVersion === recovery.inspectedWorkflowVersion &&
          audit.afterVersion === recovery.resultingWorkflowVersion &&
          audit.occurredAt === recovery.inspectedAt,
      );
      const workflowAudit = workflowAudits[0];
      if (workflowAudits.length !== 1 || workflowAudit === undefined) {
        throw new StoreInvariantError(
          `Recovery reconciliation ${recovery.id} lacks its Workflow audit`,
        );
      }

      if (recovery.purpose === RecoveryReconciliationPurpose.STARTUP) {
        if (
          sourceAttempt.status !== AttemptStatus.INTERRUPTED ||
          sourceAttempt.endedAt !== recovery.inspectedAt ||
          !sourceAttempt.terminationReason.startsWith(
            `${AttemptInterruptionReason.RECOVERY_RECONCILIATION}:`,
          )
        ) {
          throw new StoreInvariantError(
            `Startup recovery ${recovery.id} did not retain its interrupted Attempt`,
          );
        }
        const event = decodeAttemptEvent({
          type: 'ATTEMPT_FINISHED',
          commandId: commandIdentifier,
          workflowId: recovery.workflowId,
          attemptId: sourceAttempt.id,
          phase: recovery.phase,
          fromWorkflowVersion: recovery.inspectedWorkflowVersion,
          toWorkflowVersion: recovery.resultingWorkflowVersion,
          fromStatus: AttemptStatus.RUNNING,
          toStatus: AttemptStatus.INTERRUPTED,
          resultingRunStatus: RunStatus.BLOCKED,
          terminationReason: sourceAttempt.terminationReason,
          occurredAt: recovery.inspectedAt,
        });
        const payloadDigest = sha256Digest(canonicalAuthorityDigests.digest(event));
        const attemptAudits = this.listAuditEvents('ATTEMPT', sourceAttempt.id).filter(
          (audit) =>
            audit.commandId === commandIdentifier &&
            audit.eventType === 'ATTEMPT_FINISHED' &&
            audit.beforeVersion === recovery.inspectedWorkflowVersion &&
            audit.afterVersion === recovery.resultingWorkflowVersion,
        );
        if (
          attemptAudits.length !== 1 ||
          attemptAudits[0]?.payloadDigest !== payloadDigest ||
          attemptAudits[0].occurredAt !== recovery.inspectedAt ||
          attemptAudits[0].sequence <= recovery.lastAuditSequence ||
          workflowAudit.eventType !== 'WORKFLOW_ATTEMPT_FINISHED' ||
          workflowAudit.payloadDigest !== payloadDigest ||
          workflowAudit.sequence <= recovery.lastAuditSequence
        ) {
          throw new StoreInvariantError(
            `Startup recovery ${recovery.id} lacks exact Attempt/Workflow audits`,
          );
        }
      } else {
        const event = decodeRecoveryWorkflowEvent({
          type: 'WORKFLOW_RECOVERY_RECONCILED',
          commandId: commandIdentifier,
          workflowId: recovery.workflowId,
          fromPhase: recovery.phase,
          toPhase: expectedPhase,
          fromVersion: recovery.inspectedWorkflowVersion,
          toVersion: recovery.resultingWorkflowVersion,
          resultingRunStatus: expectedRunStatus,
          reconciliationId: recovery.id,
          reconciliationDigest: recovery.reconciliationDigest,
          reason: `RECOVERY:${recovery.reasonCode}`,
          occurredAt: recovery.inspectedAt,
        });
        if (
          workflowAudit.eventType !== 'WORKFLOW_RECOVERY_RECONCILED' ||
          workflowAudit.payloadDigest !== sha256Digest(canonicalAuthorityDigests.digest(event)) ||
          workflowAudit.sequence <= recovery.lastAuditSequence ||
          sourceAttempt.status === AttemptStatus.RUNNING ||
          sourceAttempt.endedAt > recovery.inspectedAt
        ) {
          throw new StoreInvariantError(
            `Resume recovery ${recovery.id} lacks exact Workflow/source authority`,
          );
        }
      }
    }
  }

  private historicalAcceptanceForManifest(manifest: AcceptanceInputManifest) {
    const goal = this.getGoal(manifest.goalId);
    const currentWorkflow = this.getWorkflow(manifest.workflowId);
    const candidate = this.getCandidateForGoal(manifest.goalId);
    const currentGeneration = this.getCandidateGeneration(manifest.candidateGenerationId);
    const policyBinding = this.getWorkflowPolicyBinding(manifest.workflowId);
    const installedPolicy = this.getPolicyBundle(manifest.policyBundleId);
    const evidenceSet = this.getEvidenceSet(manifest.evidenceSetDigest);
    if (
      goal === undefined ||
      currentWorkflow === undefined ||
      candidate === undefined ||
      currentGeneration === undefined ||
      policyBinding === undefined ||
      installedPolicy === undefined ||
      evidenceSet === undefined ||
      goal.revision !== manifest.goalRevision ||
      currentWorkflow.goalId !== goal.id ||
      currentGeneration.candidateId !== candidate.id ||
      currentGeneration.frozenDigest !== manifest.candidateDigest ||
      policyBinding.goalId !== manifest.goalId ||
      policyBinding.policyBundleId !== manifest.policyBundleId ||
      policyBinding.policyBundleDigest !== manifest.policyBundleDigest ||
      policyBinding.boundAt > manifest.createdAt ||
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
    const freezeChecks = relatedSpecifications.filter(
      (specification) => specification.kind === CheckSpecificationKind.CANDIDATE_FREEZE,
    );
    const fakeVerificationChecks = relatedSpecifications.filter(
      (specification) => specification.kind === CheckSpecificationKind.FAKE_VERIFICATION,
    );
    const localVerificationChecks = relatedSpecifications.filter(
      (specification) => specification.kind === CheckSpecificationKind.LOCAL_COMMAND,
    );
    const freezeCheck = freezeChecks[0];
    const verificationCheck = localVerificationChecks[0] ?? fakeVerificationChecks[0];
    if (
      freezeChecks.length !== 1 ||
      fakeVerificationChecks.length !== 1 ||
      localVerificationChecks.length > 1 ||
      relatedSpecifications.length !== 2 + localVerificationChecks.length ||
      freezeCheck === undefined ||
      verificationCheck === undefined
    ) {
      throw new StoreInvariantError(
        `Acceptance Input Manifest ${manifest.manifestDigest} has incomplete Check authority`,
      );
    }
    const verificationRef = `${verificationCheck.id}@${verificationCheck.version}`;
    const obligations = Object.freeze(
      this.listVerificationObligations(goal.id).filter(
        (obligation) =>
          obligation.goalRevision === goal.revision &&
          obligation.candidateGenerationId === historicalGeneration.id &&
          obligation.checkSpecRef === verificationRef,
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
    const protectedPlan = this.getAcceptanceCriticalVerificationPlan(manifest.workflowId);
    if (
      (protectedPlan === undefined) !== (manifest.schemaVersion === 1) ||
      (protectedPlan !== undefined &&
        manifest.schemaVersion === 2 &&
        (manifest.acceptanceCriticalVerificationPlanId !== protectedPlan.id ||
          manifest.acceptanceCriticalVerificationPlanDigest !== protectedPlan.planDigest))
    ) {
      throw new StoreInvariantError(
        `Acceptance Input Manifest ${manifest.manifestDigest} changed protected Plan authority`,
      );
    }
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
        ...(protectedPlan === undefined
          ? {}
          : { acceptanceCriticalVerificationPlan: protectedPlan }),
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

  private assertRetainedAcceptanceRepairAuthority(repair: AcceptanceRepairRecord): void {
    const reject = (): never => {
      throw new StoreInvariantError(
        `Acceptance repair ${repair.rejectedCandidateGenerationId} lacks exact retained authority`,
      );
    };
    const workflow = this.getWorkflow(repair.workflowId);
    const goal = this.getGoal(repair.goalId);
    const rejected = this.getCandidateGeneration(repair.rejectedCandidateGenerationId);
    const child = this.getCandidateGeneration(repair.repairCandidateGenerationId);
    const manifest = this.getAcceptanceInputManifest(repair.inputManifestDigest);
    const decision = this.getAcceptanceDecision(repair.acceptanceDecisionId);
    const freezeCheck = this.getCheckSpecification(repair.freezeCheckId);
    const verificationCheck = this.getCheckSpecification(repair.verificationCheckId);
    const policyBinding = this.getWorkflowPolicyBinding(repair.workflowId);
    const candidateRow =
      rejected === undefined
        ? undefined
        : this.#database.prepare('SELECT * FROM candidates WHERE id = ?').get(rejected.candidateId);
    const candidate = candidateRow === undefined ? undefined : decodeCandidateRow(candidateRow);
    const retainedObligations: VerificationObligation[] = [];
    for (const identifier of repair.verificationObligationIds) {
      const obligation = this.getVerificationObligation(identifier);
      if (obligation === undefined) {
        return reject();
      }
      retainedObligations.push(obligation);
    }
    const obligations = Object.freeze(retainedObligations);
    const allChildObligations =
      goal === undefined
        ? []
        : this.listVerificationObligations(goal.id).filter(
            (obligation) => obligation.candidateGenerationId === child?.id,
          );
    const repairVerificationRef =
      verificationCheck === undefined
        ? undefined
        : `${verificationCheck.id}@${verificationCheck.version}`;
    const childObligations = allChildObligations.filter(
      (obligation) => obligation.checkSpecRef === repairVerificationRef,
    );
    const additionalChildObligations = allChildObligations.filter(
      (obligation) => obligation.checkSpecRef !== repairVerificationRef,
    );
    const childSpecifications =
      child === undefined
        ? []
        : this.listCheckSpecifications().filter((specification) =>
            specification.inputRefs.includes(child.id),
          );
    const childLocalChecks = childSpecifications.filter(
      (specification) => specification.kind === CheckSpecificationKind.LOCAL_COMMAND,
    );
    if (
      workflow === undefined ||
      goal === undefined ||
      rejected === undefined ||
      child === undefined ||
      manifest === undefined ||
      decision === undefined ||
      freezeCheck === undefined ||
      verificationCheck === undefined ||
      policyBinding === undefined ||
      candidate === undefined
    ) {
      return reject();
    }
    const expectedDigest = sha256Digest(
      canonicalAuthorityDigests.digest(acceptanceRepairRecordProjection(repair)),
    );
    if (
      workflow.goalId !== repair.goalId ||
      workflow.goalRevision !== repair.goalRevision ||
      workflow.version < repair.workflowVersion ||
      goal.revision !== repair.goalRevision ||
      candidate.goalId !== repair.goalId ||
      rejected.candidateId !== candidate.id ||
      rejected.state !== CandidateGenerationState.REJECTED ||
      rejected.version !== repair.rejectedCandidateVersion ||
      rejected.frozenDigest !== repair.rejectedCandidateDigest ||
      rejected.updatedAt !== repair.repairedAt ||
      child.candidateId !== rejected.candidateId ||
      child.parentGenerationId !== rejected.id ||
      child.sequence !== rejected.sequence + 1 ||
      child.sequence !== repair.repairCandidateSequence ||
      child.baseDigest !== repair.repairCandidateBaseDigest ||
      child.createdAt !== repair.repairedAt ||
      manifest.goalId !== repair.goalId ||
      manifest.goalRevision !== repair.goalRevision ||
      manifest.workflowId !== repair.workflowId ||
      manifest.workflowVersion + 1 !== repair.workflowVersion ||
      manifest.candidateGenerationId !== repair.rejectedCandidateGenerationId ||
      manifest.candidateDigest !== repair.rejectedCandidateDigest ||
      manifest.evidenceSetDigest !== repair.evidenceSetDigest ||
      manifest.policyBundleId !== repair.policyBundleId ||
      manifest.policyBundleDigest !== repair.policyBundleDigest ||
      policyBinding.goalId !== repair.goalId ||
      policyBinding.policyBundleId !== repair.policyBundleId ||
      policyBinding.policyBundleDigest !== repair.policyBundleDigest ||
      policyBinding.boundAt > repair.repairedAt ||
      decision.outcome !== AcceptanceOutcome.REJECT_REPAIRABLE ||
      decision.inputManifestDigest !== repair.inputManifestDigest ||
      decision.decisionDigest !== repair.acceptanceDecisionDigest ||
      decision.policyBundleDigest !== repair.policyBundleDigest ||
      decision.issuedAt > repair.repairedAt ||
      freezeCheck.version !== repair.freezeCheckVersion ||
      verificationCheck.version !== repair.verificationCheckVersion ||
      childObligations.length !== obligations.length ||
      canonicalizeJson(childObligations.map((obligation) => obligation.id).sort()) !==
        canonicalizeJson([...repair.verificationObligationIds].sort()) ||
      repair.repairDigest !== expectedDigest
    ) {
      reject();
    }

    try {
      validateM1CandidateEvidencePolicy(
        goal,
        child,
        {
          freeze: freezeCheck,
          verification: verificationCheck,
          obligations,
        },
        repair.repairedAt,
      );
    } catch {
      reject();
    }

    if (additionalChildObligations.length === 0) {
      if (childLocalChecks.length !== 0) {
        reject();
      }
    } else {
      const localCheck = childLocalChecks[0];
      const localCreatedAt = additionalChildObligations[0]?.createdAt;
      if (
        localCheck === undefined ||
        localCreatedAt === undefined ||
        childLocalChecks.length !== 1 ||
        additionalChildObligations.some(
          (obligation) => obligation.checkSpecRef !== `${localCheck.id}@${localCheck.version}`,
        )
      ) {
        return reject();
      }
      try {
        validateLocalCommandVerificationPolicy(
          goal,
          child,
          { verification: localCheck, obligations: additionalChildObligations },
          localCreatedAt,
        );
      } catch {
        reject();
      }
    }

    const repairAudits = this.listAuditEvents(
      'ACCEPTANCE_REPAIR',
      repair.rejectedCandidateGenerationId,
    ).filter((audit) => audit.eventType === 'ACCEPTANCE_REPAIR_RECORDED');
    const repairAudit = repairAudits[0];
    if (repairAudit === undefined) {
      return reject();
    }
    if (
      repairAudits.length !== 1 ||
      repairAudit.actorType !== 'RUNTIME' ||
      repairAudit.beforeVersion !== undefined ||
      repairAudit.afterVersion !== undefined ||
      repairAudit.payloadDigest !== repair.repairDigest ||
      repairAudit.occurredAt !== repair.repairedAt
    ) {
      return reject();
    }
    if (repairAudit.commandId === undefined) {
      return reject();
    }
    const repairCommandId = repairAudit.commandId;

    const rejectedAudits = this.listAuditEvents(
      'CANDIDATE_GENERATION',
      repair.rejectedCandidateGenerationId,
    ).filter(
      (audit) =>
        audit.eventType === 'CANDIDATE_STATE_CHANGED' &&
        audit.beforeVersion === repair.rejectedCandidateVersion - 1 &&
        audit.afterVersion === repair.rejectedCandidateVersion,
    );
    const childAudits = this.listAuditEvents(
      'CANDIDATE_GENERATION',
      repair.repairCandidateGenerationId,
    ).filter((audit) => audit.eventType === 'CANDIDATE_GENERATION_CREATED');
    const workflowAudits = this.listAuditEvents('WORKFLOW', repair.workflowId).filter(
      (audit) =>
        audit.eventType === 'WORKFLOW_PHASE_TRANSITIONED' &&
        audit.beforeVersion === repair.workflowVersion - 1 &&
        audit.afterVersion === repair.workflowVersion,
    );
    const checkAudits = [repair.freezeCheckId, repair.verificationCheckId].map((identifier) =>
      this.listAuditEvents('CHECK_SPECIFICATION', identifier).filter(
        (audit) => audit.eventType === 'CHECK_SPECIFICATION_RECORDED',
      ),
    );
    const obligationAudits = repair.verificationObligationIds.map((identifier) =>
      this.listAuditEvents('VERIFICATION_OBLIGATION', identifier).filter(
        (audit) => audit.eventType === 'VERIFICATION_OBLIGATION_RECORDED',
      ),
    );
    if (
      rejectedAudits.length !== 1 ||
      childAudits.length !== 1 ||
      workflowAudits.length !== 1 ||
      checkAudits.some((audits) => audits.length !== 1) ||
      obligationAudits.some((audits) => audits.length !== 1)
    ) {
      reject();
    }
    const authorityAudits = [
      rejectedAudits[0],
      childAudits[0],
      workflowAudits[0],
      ...checkAudits.map((audits) => audits[0]),
      ...obligationAudits.map((audits) => audits[0]),
    ];
    if (
      authorityAudits.some(
        (audit) =>
          audit?.actorType !== 'RUNTIME' ||
          audit.commandId !== repairCommandId ||
          audit.payloadDigest !== repair.repairDigest ||
          audit.occurredAt !== repair.repairedAt ||
          audit.correlationId !== repairAudit.correlationId ||
          audit.causationId !== repairAudit.causationId,
      ) ||
      childAudits[0]?.beforeVersion !== undefined ||
      childAudits[0]?.afterVersion !== 1 ||
      checkAudits.some(
        (audits) => audits[0]?.beforeVersion !== undefined || audits[0]?.afterVersion !== undefined,
      ) ||
      obligationAudits.some(
        (audits) => audits[0]?.beforeVersion !== undefined || audits[0]?.afterVersion !== undefined,
      )
    ) {
      reject();
    }

    const processed = this.getProcessedCommand(repairCommandId);
    const outcome =
      processed === undefined ? undefined : decodeStoredCommandOutcome(processed.outcome);
    if (
      processed?.aggregateType !== 'GOAL' ||
      processed.aggregateId !== repair.goalId ||
      processed.completedAt !== repair.repairedAt ||
      outcome?.disposition !== StoredCommandDisposition.APPLIED ||
      outcome.goalId !== repair.goalId ||
      outcome.workflow.id !== repair.workflowId ||
      outcome.workflow.version !== repair.workflowVersion ||
      outcome.workflow.phase !== WorkflowPhase.IMPLEMENT ||
      outcome.workflow.runStatus !== RunStatus.READY
    ) {
      reject();
    }
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
      const policyBinding = this.getWorkflowPolicyBinding(closeout.workflowId);
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
        policyBinding?.goalId !== closeout.goalId ||
        policyBinding.policyBundleId !== closeout.policyBundleId ||
        policyBinding.policyBundleDigest !== closeout.policyBundleDigest ||
        policyBinding.boundAt > closeout.closedAt ||
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
    if (!this.hasTable('acceptance_repairs')) {
      if (
        this.readCount(
          `SELECT COUNT(*) AS count
             FROM candidate_generations
            WHERE state = 'REJECTED'`,
        ) !== 0
      ) {
        throw new StoreInvariantError(
          'A rejected Candidate generation predates exact Acceptance repair authority',
        );
      }
      return;
    }
    const repairRows = this.#database
      .prepare('SELECT * FROM acceptance_repairs ORDER BY rejected_candidate_generation_id')
      .all();
    for (const row of repairRows) {
      this.assertRetainedAcceptanceRepairAuthority(decodeAcceptanceRepairRow(row));
    }
    const rejectedWithoutRepairRecord = this.readCount(
      `SELECT COUNT(*) AS count
         FROM candidate_generations AS rejected
        WHERE rejected.state = 'REJECTED'
          AND NOT EXISTS (
            SELECT 1 FROM acceptance_repairs AS repair
            WHERE repair.rejected_candidate_generation_id = rejected.id
          )`,
    );
    if (rejectedWithoutRepairRecord !== 0) {
      throw new StoreInvariantError(
        'A rejected Candidate generation has no immutable Acceptance repair authority',
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

  private hasM1AttemptAuthorityClosureMigration(): boolean {
    return this.#appliedMigrations.some((migration) => migration.version === 19);
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
    const externalExecution = this.hasTable('external_execution_records')
      ? this.getExternalExecutionForAttempt(receipt.attemptId)
      : undefined;
    if (
      claim.workflowVersion !== receipt.observedWorkflowVersion ||
      claim.workerSessionId !== receipt.workerSessionId ||
      claim.contextManifestDigest !== receipt.contextManifestDigest ||
      claim.packageDigest !== receipt.packageDigest ||
      (externalExecution !== undefined &&
        (externalExecution.resultEventId !== receipt.eventId ||
          (externalExecution.state !== ExternalExecutionState.COMPLETED &&
            externalExecution.state !== ExternalExecutionState.FAILED &&
            externalExecution.state !== ExternalExecutionState.INTERRUPTED)))
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
      this.#authorityIsolationLease?.assertCurrent();
      this.assertRetainedWorkflowAttemptLifecycleClosure();
      this.assertRetainedM1RetryBoundaryClosure();
      this.assertRetainedTerminalAttemptAuthorityClosure();
      this.assertRetainedCurrentWorkflowCommandClosure();
      this.assertRetainedProjectReadCleanupAuthorityClosure();
      this.assertRetainedIntakeAuthorityClosure();
      const result = operation();
      this.assertRetainedWorkflowAttemptLifecycleClosure();
      this.assertRetainedWorkflowStartAuthorityClosure();
      this.assertRetainedM1RetryBoundaryClosure();
      this.assertRetainedTerminalAttemptAuthorityClosure();
      this.assertRetainedCurrentWorkflowCommandClosure();
      this.assertRetainedProjectReadCleanupAuthorityClosure();
      this.assertRetainedIntakeAuthorityClosure();
      this.#authorityIsolationLease?.assertCurrent();
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

  private runIntakeReservationImmediate(
    operation: () => IntakeReservationStoreResult,
  ): IntakeReservationStoreResult {
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

  private runIntakeCommitImmediate(
    operation: () => IntakeCommitStoreResult,
  ): IntakeCommitStoreResult {
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
        return { status: 'COMMAND_CONFLICT', message: error.message };
      }
      throw error;
    }
  }

  private runRead<Value>(operation: () => Value): Value {
    if (this.#database.inTransaction) {
      this.#authorityIsolationLease?.assertCurrent();
      return operation();
    }
    this.#database.exec('BEGIN');
    try {
      this.#authorityIsolationLease?.assertCurrent();
      const result = operation();
      this.#authorityIsolationLease?.assertCurrent();
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
      | AcceptanceTransactionStep
      | RecoveryTransactionStep
      | IntakeTransactionStep
      | ProjectReadCleanupTransactionStep,
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

export function openVerifiedSqliteControlStore(
  options: VerifiedSqliteControlStoreOptions,
): SqliteControlStore {
  return SqliteControlStore.openVerified(options);
}
