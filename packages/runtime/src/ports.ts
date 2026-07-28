import type {
  AppliedAttemptEvent,
  Attempt,
  AttemptEvent,
  AttemptId,
  AuditEventId,
  Candidate,
  CandidateGeneration,
  CandidateStateChanged,
  CheckSpecification,
  CommandId,
  ContextManifest,
  ContextManifestId,
  EvidenceEligibility,
  EvidenceId,
  EvidenceRecord,
  EvidenceSet,
  Goal,
  GoalId,
  IsoTimestamp,
  PolicyBundle,
  PolicyBundleId,
  Sha256Digest,
  VerificationObligation,
  VerificationObligationId,
  WorkflowEvent,
  WorkflowId,
  WorkflowInstance,
  WorkerEventId,
  WorkerSessionId,
} from '@codeclosure/domain';

import type { CommandTarget, DeterministicCommandError, JsonValue } from './contracts.js';
import type {
  AdmittedWorkerEventReceipt,
  IgnoredWorkerEventReceipt,
  WorkerDispatchClaim,
  WorkerEventReceipt,
  WorkerRequest,
} from './worker-contracts.js';

export type { CommandTarget } from './contracts.js';

export interface Clock {
  now(): IsoTimestamp;
}

export interface IdGenerator {
  nextAttemptId(): AttemptId;
  nextAuditEventId(): AuditEventId;
}

export interface WorkerIdentityGenerator {
  nextCommandId(): CommandId;
  nextContextManifestId(): ContextManifestId;
  nextWorkerSessionId(): WorkerSessionId;
}

export interface DigestProvider {
  digest(value: unknown): Sha256Digest;
}

export interface Canonicalizer {
  canonicalize(value: unknown): string;
}

export interface WorkerPort {
  run(request: WorkerRequest, signal: AbortSignal): AsyncIterable<unknown>;
}

interface ProcessedCommandBase {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly outcome: JsonValue;
  readonly completedAt: IsoTimestamp;
}

export type ProcessedCommandView = ProcessedCommandBase & CommandTarget;

export interface GoalWorkflowView {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
}

interface AuditWriteIdentity {
  readonly auditEventId: AuditEventId;
  readonly payloadDigest: Sha256Digest;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface CommitAttemptEvent extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: AttemptEvent;
  readonly workflowAuditEventId: AuditEventId;
}

export interface CommitContextBoundAttemptStart extends CommitAttemptEvent {
  readonly contextManifest: ContextManifest;
}

export interface CommittedContextAttempt {
  readonly workflow: WorkflowInstance;
  readonly attempt: Attempt;
  readonly contextManifest: ContextManifest;
}

export interface CandidateAuthorityView {
  readonly candidate: Candidate;
  readonly generation: CandidateGeneration;
  readonly workflowId: WorkflowId;
}

export interface CommitCandidatePreparation extends CommitWorkflowEvent {
  readonly candidate: Candidate;
  readonly generation: CandidateGeneration;
  readonly checkSpecifications: readonly CheckSpecification[];
  readonly obligations: readonly VerificationObligation[];
  readonly candidateAuditEventId: AuditEventId;
  readonly generationAuditEventId: AuditEventId;
  readonly checkSpecificationAuditEventIds: readonly AuditEventId[];
  readonly obligationAuditEventIds: readonly AuditEventId[];
}

export interface CommittedCandidatePreparation {
  readonly workflow: WorkflowInstance;
  readonly authority: CandidateAuthorityView;
  readonly checkSpecifications: readonly CheckSpecification[];
  readonly obligations: readonly VerificationObligation[];
}

export interface CommitWorkflowCandidateEvent extends CommitWorkflowEvent {
  readonly candidateEvent: CandidateStateChanged;
  readonly candidateAuditEventId: AuditEventId;
}

export interface CommittedWorkflowCandidateEvent {
  readonly workflow: WorkflowInstance;
  readonly authority: CandidateAuthorityView;
}

export interface CommitCandidateIntegrityFailure extends CommitWorkflowEvent {
  readonly candidateEvent: CandidateStateChanged;
  readonly expectedFrozenDigest: Sha256Digest;
  readonly observedDigest: Sha256Digest;
  readonly candidateAuditEventId: AuditEventId;
  readonly invalidatedEvidenceAuditEventIds: readonly AuditEventId[];
}

export interface CommittedCandidateIntegrityFailure {
  readonly workflow: WorkflowInstance;
  readonly authority: CandidateAuthorityView;
  readonly invalidatedEvidence: readonly EvidenceEligibility[];
}

export interface CommitCandidateAttemptOutcome extends CommitAttemptEvent {
  readonly candidateEvent: CandidateStateChanged;
  readonly candidateAuditEventId: AuditEventId;
  readonly evidence?: EvidenceRecord;
  readonly initialEligibility?: EvidenceEligibility;
  readonly evidenceAuditEventId?: AuditEventId;
  readonly invalidatedEvidenceAuditEventIds: readonly AuditEventId[];
}

export interface CommittedCandidateAttemptOutcome extends AppliedAttemptEvent {
  readonly authority: CandidateAuthorityView;
  readonly evidence?: EvidenceRecord;
  readonly eligibility?: EvidenceEligibility;
  readonly invalidatedEvidence: readonly EvidenceEligibility[];
}

export interface CommitVerificationAttemptOutcome extends CommitAttemptEvent {
  readonly obligationId: VerificationObligationId;
  readonly evidence: EvidenceRecord;
  readonly initialEligibility: EvidenceEligibility;
  readonly evidenceAuditEventId: AuditEventId;
}

export interface CommittedVerificationAttemptOutcome extends AppliedAttemptEvent {
  readonly evidence: EvidenceRecord;
  readonly eligibility: EvidenceEligibility;
}

export interface CommitEvidenceSetTransition extends CommitWorkflowEvent {
  readonly evidenceSet: EvidenceSet;
  readonly evidenceSetAuditEventId: AuditEventId;
}

export interface CommitWorkerAttemptEvent extends CommitAttemptEvent {
  readonly receipt: AdmittedWorkerEventReceipt;
}

export interface RecordIgnoredWorkerEvent {
  readonly receipt: IgnoredWorkerEventReceipt;
}

export interface ClaimWorkerDispatch extends AuditWriteIdentity {
  readonly claim: WorkerDispatchClaim;
}

export interface InstallPolicyBundle extends AuditWriteIdentity {
  readonly bundle: PolicyBundle;
  readonly installedAt: IsoTimestamp;
}

export interface InstalledPolicyBundle {
  readonly bundle: PolicyBundle;
  readonly installedAt: IsoTimestamp;
}

export interface CommitWorkflowEvent extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: WorkflowEvent;
  readonly attemptAuditEventId?: AuditEventId;
}

export interface RecordCommandRejection {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly workflowId: WorkflowId;
  readonly observedWorkflowVersion: WorkflowInstance['version'];
  readonly error: DeterministicCommandError;
  readonly completedAt: IsoTimestamp;
}

export type StoreCommandResult<Value> =
  | { readonly status: 'APPLIED'; readonly outcome: JsonValue; readonly value: Value }
  | { readonly status: 'REPLAYED'; readonly outcome: JsonValue }
  | { readonly status: 'VERSION_CONFLICT'; readonly message: string }
  | { readonly status: 'COMMAND_CONFLICT'; readonly message: string };

export type WorkerEventStoreResult<Value> =
  | {
      readonly status: 'APPLIED';
      readonly receipt: WorkerEventReceipt;
      readonly value: Value;
    }
  | { readonly status: 'REPLAYED'; readonly receipt: WorkerEventReceipt }
  | { readonly status: 'VERSION_CONFLICT'; readonly message: string }
  | { readonly status: 'WORKER_EVENT_CONFLICT'; readonly message: string };

export type PolicyInstallResult =
  | { readonly status: 'INSTALLED'; readonly value: InstalledPolicyBundle }
  | { readonly status: 'EXISTING'; readonly value: InstalledPolicyBundle }
  | { readonly status: 'POLICY_CONFLICT'; readonly message: string };

export type WorkerDispatchClaimResult =
  | { readonly status: 'CLAIMED'; readonly value: WorkerDispatchClaim }
  | { readonly status: 'EXISTING'; readonly value: WorkerDispatchClaim }
  | { readonly status: 'VERSION_CONFLICT'; readonly message: string }
  | { readonly status: 'NOT_ELIGIBLE'; readonly message: string }
  | { readonly status: 'DISPATCH_CONFLICT'; readonly message: string };

export interface WorkflowControlStore {
  getGoal(goalId: GoalId): Goal | undefined;
  getGoalWithWorkflow(goalId: GoalId): GoalWorkflowView | undefined;
  getWorkflow(workflowId: WorkflowId): WorkflowInstance | undefined;
  getWorkflowForGoal(goalId: GoalId): WorkflowInstance | undefined;
  getAttempt(attemptId: AttemptId): Attempt | undefined;
  getProcessedCommand(commandId: CommandId): ProcessedCommandView | undefined;
  nextAttemptSequence(workflowId: WorkflowId): number;
  commitAttemptEvent(input: CommitAttemptEvent): StoreCommandResult<AppliedAttemptEvent>;
  commitWorkflowEvent(input: CommitWorkflowEvent): StoreCommandResult<WorkflowInstance>;
  recordCommandRejection(input: RecordCommandRejection): StoreCommandResult<undefined>;
}

export interface WorkerControlStore extends WorkflowControlStore {
  getContextManifest(contextManifestId: ContextManifestId): ContextManifest | undefined;
  getWorkerDispatchClaim(attemptId: AttemptId): WorkerDispatchClaim | undefined;
  getWorkerEventReceipt(workerEventId: WorkerEventId): WorkerEventReceipt | undefined;
  getPolicyBundle(policyBundleId: PolicyBundleId): InstalledPolicyBundle | undefined;
  installPolicyBundle(input: InstallPolicyBundle): PolicyInstallResult;
  claimWorkerDispatch(input: ClaimWorkerDispatch): WorkerDispatchClaimResult;
  commitContextBoundAttemptStart(
    input: CommitContextBoundAttemptStart,
  ): StoreCommandResult<CommittedContextAttempt>;
  commitWorkerAttemptEvent(
    input: CommitWorkerAttemptEvent,
  ): WorkerEventStoreResult<AppliedAttemptEvent>;
  recordIgnoredWorkerEvent(input: RecordIgnoredWorkerEvent): WorkerEventStoreResult<undefined>;
}

export interface CandidateEvidenceControlStore extends WorkerControlStore {
  getCandidateForGoal(goalId: GoalId): Candidate | undefined;
  getCandidateGeneration(
    candidateGenerationId: CandidateGeneration['id'],
  ): CandidateGeneration | undefined;
  getCandidateAuthorityForWorkflow(workflowId: WorkflowId): CandidateAuthorityView | undefined;
  nextCandidateGenerationSequence(candidateId: Candidate['id']): number;
  getCheckSpecification(
    checkSpecificationId: CheckSpecification['id'],
  ): CheckSpecification | undefined;
  listCheckSpecifications(): readonly CheckSpecification[];
  getVerificationObligation(
    verificationObligationId: VerificationObligationId,
  ): VerificationObligation | undefined;
  listVerificationObligations(goalId: GoalId): readonly VerificationObligation[];
  getEvidence(evidenceId: EvidenceId): EvidenceRecord | undefined;
  getEvidenceEligibility(evidenceId: EvidenceId): EvidenceEligibility | undefined;
  listEvidenceForGeneration(
    candidateGenerationId: CandidateGeneration['id'],
  ): readonly { readonly record: EvidenceRecord; readonly eligibility: EvidenceEligibility }[];
  getEvidenceSet(digest: Sha256Digest): EvidenceSet | undefined;
  commitCandidatePreparation(
    input: CommitCandidatePreparation,
  ): StoreCommandResult<CommittedCandidatePreparation>;
  commitWorkflowCandidateEvent(
    input: CommitWorkflowCandidateEvent,
  ): StoreCommandResult<CommittedWorkflowCandidateEvent>;
  commitCandidateIntegrityFailure(
    input: CommitCandidateIntegrityFailure,
  ): StoreCommandResult<CommittedCandidateIntegrityFailure>;
  commitCandidateAttemptOutcome(
    input: CommitCandidateAttemptOutcome,
  ): StoreCommandResult<CommittedCandidateAttemptOutcome>;
  commitVerificationAttemptOutcome(
    input: CommitVerificationAttemptOutcome,
  ): StoreCommandResult<CommittedVerificationAttemptOutcome>;
  commitEvidenceSetTransition(
    input: CommitEvidenceSetTransition,
  ): StoreCommandResult<WorkflowInstance>;
}
