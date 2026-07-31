import type {
  AcceptanceDecision,
  AcceptanceDecisionId,
  AcceptanceInputManifest,
  AcceptanceRepairRecord,
  AppliedAttemptEvent,
  Attempt,
  AttemptEvent,
  AttemptId,
  AuditEventId,
  Candidate,
  CandidateGeneration,
  CandidateGenerationId,
  CandidateStateChanged,
  CheckSpecification,
  CommandId,
  ContextManifest,
  ContextManifestId,
  EvidenceEligibility,
  EvidenceId,
  EvidenceRecord,
  EvidenceSet,
  ExecutionProfile,
  ExecutionProfileBinding,
  ExecutionProfileId,
  Goal,
  GoalId,
  IsoTimestamp,
  PolicyBundle,
  PolicyBundleId,
  PendingIssue,
  PendingIssueSet,
  RecoveryReconciliationId,
  RecoveryReconciliationRecord,
  RecoveryWorkflowReconciled,
  Sha256Digest,
  CloseoutRecord,
  VerificationObligation,
  VerificationObligationId,
  WorkflowEvent,
  WorkflowId,
  WorkflowInstance,
  WorkerEventId,
  WorkerSessionId,
  WorkflowPolicyBinding,
  SuccessCriterionId,
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

export interface GoalCreationIdentityGenerator {
  nextGoalId(): GoalId;
  nextWorkflowId(): WorkflowId;
  nextSuccessCriterionId(): SuccessCriterionId;
  nextAuditEventId(): AuditEventId;
}

export interface WorkerIdentityGenerator {
  nextCommandId(): CommandId;
  nextContextManifestId(): ContextManifestId;
  nextWorkerSessionId(): WorkerSessionId;
}

export interface AcceptanceIdentityGenerator {
  nextAcceptanceDecisionId(): AcceptanceDecisionId;
}

export interface RecoveryIdentityGenerator {
  nextCommandId(): CommandId;
  nextRecoveryReconciliationId(): RecoveryReconciliationId;
  nextAuditEventId(): AuditEventId;
}

export interface DigestProvider {
  digest(value: unknown): Sha256Digest;
}

export interface EvidencePayload {
  readonly digest: Sha256Digest;
  readonly byteLength: number;
  readonly bytes: Uint8Array;
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

export type WorkerEventReplayAuthoritySnapshot =
  | {
      readonly receipt: IgnoredWorkerEventReceipt;
      readonly dispatchClaim: WorkerDispatchClaim;
      readonly contextManifest: ContextManifest;
    }
  | {
      readonly receipt: AdmittedWorkerEventReceipt;
      readonly dispatchClaim: WorkerDispatchClaim;
      readonly contextManifest: ContextManifest;
      readonly terminalAttempt: Exclude<Attempt, { readonly status: 'RUNNING' }>;
      readonly processedCommand: ProcessedCommandView;
    };

export interface GoalWorkflowView {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
}

export interface CommitGoalCreation extends AuditWriteIdentity {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly workflowAuditEventId: AuditEventId;
}

export interface GoalStatusAuthoritySnapshot extends GoalWorkflowView {
  readonly policyBinding?: WorkflowPolicyBinding;
  readonly executionProfileBinding?: ExecutionProfileBinding;
  readonly activeAttempt?: Attempt;
  readonly candidateAuthority?: CandidateAuthorityView;
  readonly acceptanceAuthority?: {
    readonly manifest: AcceptanceInputManifest;
    readonly decision: AcceptanceDecision;
  };
  readonly closeout?: CloseoutRecord;
  readonly latestRecoveryReconciliation?: RecoveryReconciliationRecord;
}

export interface WorkflowDriverAuthoritySnapshot extends GoalStatusAuthoritySnapshot {
  readonly installedPolicyBundle?: InstalledPolicyBundle;
  readonly installedExecutionProfile?: InstalledExecutionProfile;
  readonly latestPhaseAttempt: Attempt | null;
  readonly latestPhaseContextManifest: ContextManifest | null;
  readonly verificationObligations: readonly VerificationObligation[];
  readonly evidence: readonly {
    readonly record: EvidenceRecord;
    readonly eligibility: EvidenceEligibility;
  }[];
}

export interface GoalAuditEventAuthority {
  readonly id: AuditEventId;
  readonly sequence: number;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly eventType: string;
  readonly actorType: string;
  readonly commandId?: CommandId;
  readonly beforeVersion?: number;
  readonly afterVersion?: number;
  readonly correlationId?: string;
  readonly causationId?: string;
  readonly payloadDigest: Sha256Digest;
  readonly occurredAt: IsoTimestamp;
}

export interface GoalAuditAuthoritySnapshot {
  readonly goalId: GoalId;
  readonly throughSequence: number;
  readonly events: readonly GoalAuditEventAuthority[];
}

export const RecoverableBlockerKind = {
  ACTIVE_ATTEMPT: 'ACTIVE_ATTEMPT',
  RECOVERABLE_FAILURE: 'RECOVERABLE_FAILURE',
  RECONCILED_BLOCKER: 'RECONCILED_BLOCKER',
} as const;
export type RecoverableBlockerKind =
  (typeof RecoverableBlockerKind)[keyof typeof RecoverableBlockerKind];

export interface RecoveryCatalogEntry extends GoalWorkflowView {
  readonly blockerKind: RecoverableBlockerKind;
  readonly sourceAttempt: Attempt;
  readonly contextManifest?: ContextManifest;
  readonly policyBinding: WorkflowPolicyBinding;
  readonly executionProfileBinding: ExecutionProfileBinding;
  readonly dispatchClaim?: WorkerDispatchClaim;
  readonly candidateAuthority?: CandidateAuthorityView;
  readonly lastAuditSequence: number;
  readonly latestReconciliation?: RecoveryReconciliationRecord;
}

export interface CommitStartupRecovery extends AuditWriteIdentity {
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: AttemptEvent;
  readonly workflowAuditEventId: AuditEventId;
  readonly recovery: RecoveryReconciliationRecord;
  readonly recoveryAuditEventId: AuditEventId;
}

export interface CommitResumeRecovery extends AuditWriteIdentity {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly event: RecoveryWorkflowReconciled;
  readonly recovery: RecoveryReconciliationRecord;
  readonly recoveryAuditEventId: AuditEventId;
}

export interface CommittedStartupRecovery {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly attempt: Attempt;
  readonly recovery: RecoveryReconciliationRecord;
}

export interface CommittedResumeRecovery {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly recovery: RecoveryReconciliationRecord;
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
  readonly policyBinding: WorkflowPolicyBinding;
  readonly policyBindingAuditEventId?: AuditEventId;
  readonly executionProfileBinding: ExecutionProfileBinding;
  readonly executionProfileBindingAuditEventId?: AuditEventId;
}

export interface CommittedContextAttempt {
  readonly workflow: WorkflowInstance;
  readonly attempt: Attempt;
  readonly contextManifest: ContextManifest;
  readonly policyBinding: WorkflowPolicyBinding;
  readonly executionProfileBinding: ExecutionProfileBinding;
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

export interface AcceptanceEvidenceAuthority {
  readonly record: EvidenceRecord;
  readonly eligibility: EvidenceEligibility;
}

export interface AcceptanceAuthorityView {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly candidate: Candidate;
  readonly generation: CandidateGeneration;
  readonly freezeCheck: CheckSpecification;
  readonly verificationCheck: CheckSpecification;
  readonly obligations: readonly VerificationObligation[];
  readonly evidenceSet: EvidenceSet;
  readonly currentEvidence: readonly AcceptanceEvidenceAuthority[];
  readonly pendingIssues: readonly PendingIssue[];
  readonly retainedFactCount: number;
  readonly retainedDecisionCount: number;
  readonly policyBundle: PolicyBundle;
}

export interface CommitAcceptanceEvaluation {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly manifest: AcceptanceInputManifest;
  readonly pendingIssueSet: PendingIssueSet;
  readonly decision: AcceptanceDecision;
  readonly manifestAuditEventId: AuditEventId;
  readonly decisionAuditEventId: AuditEventId;
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface CommittedAcceptanceEvaluation {
  readonly manifest: AcceptanceInputManifest;
  readonly decision: AcceptanceDecision;
}

export interface CommitAcceptedCloseout extends CommitWorkflowCandidateEvent {
  readonly closeout: CloseoutRecord;
  readonly closeoutAuditEventId: AuditEventId;
}

export interface CommittedAcceptedCloseout extends CommittedWorkflowCandidateEvent {
  readonly closeout: CloseoutRecord;
}

export interface CommitAcceptanceRepair extends CommitWorkflowEvent {
  readonly repair: AcceptanceRepairRecord;
  readonly candidate: Candidate;
  readonly rejectedCandidateEvent: CandidateStateChanged;
  readonly generation: CandidateGeneration;
  readonly checkSpecifications: readonly CheckSpecification[];
  readonly obligations: readonly VerificationObligation[];
  readonly rejectedCandidateAuditEventId: AuditEventId;
  readonly generationAuditEventId: AuditEventId;
  readonly checkSpecificationAuditEventIds: readonly AuditEventId[];
  readonly obligationAuditEventIds: readonly AuditEventId[];
  readonly repairAuditEventId: AuditEventId;
}

export interface CommittedAcceptanceRepair {
  readonly workflow: WorkflowInstance;
  readonly authority: CandidateAuthorityView;
  readonly rejectedGeneration: CandidateGeneration;
  readonly checkSpecifications: readonly CheckSpecification[];
  readonly obligations: readonly VerificationObligation[];
  readonly repair: AcceptanceRepairRecord;
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
  readonly payloads?: readonly EvidencePayload[];
  readonly initialEligibility: EvidenceEligibility;
  readonly evidenceAuditEventId: AuditEventId;
}

export interface CommittedVerificationAttemptOutcome extends AppliedAttemptEvent {
  readonly evidence: EvidenceRecord;
  readonly eligibility: EvidenceEligibility;
}

export interface CommitLocalCommandVerificationAuthority extends AuditWriteIdentity {
  readonly commandId: CommandId;
  readonly inputDigest: Sha256Digest;
  readonly target: CommandTarget;
  readonly workflowId: WorkflowId;
  readonly expectedWorkflowVersion: WorkflowInstance['version'];
  readonly checkSpecification: CheckSpecification;
  readonly obligations: readonly VerificationObligation[];
  readonly checkSpecificationAuditEventId: AuditEventId;
  readonly obligationAuditEventIds: readonly AuditEventId[];
  readonly occurredAt: IsoTimestamp;
}

export interface CommittedLocalCommandVerificationAuthority {
  readonly workflow: WorkflowInstance;
  readonly checkSpecification: CheckSpecification;
  readonly obligations: readonly VerificationObligation[];
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

export interface InstallExecutionProfile extends AuditWriteIdentity {
  readonly profile: ExecutionProfile;
  readonly installedAt: IsoTimestamp;
}

export interface InstalledExecutionProfile {
  readonly profile: ExecutionProfile;
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
  | { readonly status: 'COMMAND_CONFLICT'; readonly message: string }
  | { readonly status: 'WORKER_EVENT_CONFLICT'; readonly message: string };

export type PolicyInstallResult =
  | { readonly status: 'INSTALLED'; readonly value: InstalledPolicyBundle }
  | { readonly status: 'EXISTING'; readonly value: InstalledPolicyBundle }
  | { readonly status: 'POLICY_CONFLICT'; readonly message: string };

export type ExecutionProfileInstallResult =
  | { readonly status: 'INSTALLED'; readonly value: InstalledExecutionProfile }
  | { readonly status: 'EXISTING'; readonly value: InstalledExecutionProfile }
  | { readonly status: 'PROFILE_CONFLICT'; readonly message: string };

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

export interface GoalCreationControlStore extends WorkflowControlStore {
  createGoalWithWorkflow(input: CommitGoalCreation): StoreCommandResult<GoalWorkflowView>;
}

export interface GoalQueryStore {
  getGoalStatusAuthority(goalId: GoalId): GoalStatusAuthoritySnapshot | undefined;
  getGoalAuditAuthority(goalId: GoalId): GoalAuditAuthoritySnapshot | undefined;
}

export interface WorkerControlStore extends WorkflowControlStore {
  getContextManifest(contextManifestId: ContextManifestId): ContextManifest | undefined;
  getWorkerDispatchClaim(attemptId: AttemptId): WorkerDispatchClaim | undefined;
  getWorkerEventReceipt(workerEventId: WorkerEventId): WorkerEventReceipt | undefined;
  getWorkerEventReplayAuthority(
    workerEventId: WorkerEventId,
  ): WorkerEventReplayAuthoritySnapshot | undefined;
  getPolicyBundle(policyBundleId: PolicyBundleId): InstalledPolicyBundle | undefined;
  getExecutionProfile(
    executionProfileId: ExecutionProfileId,
  ): InstalledExecutionProfile | undefined;
  getExecutionProfileBinding(workflowId: WorkflowId): ExecutionProfileBinding | undefined;
  getWorkflowPolicyBinding(workflowId: WorkflowId): WorkflowPolicyBinding | undefined;
  installPolicyBundle(input: InstallPolicyBundle): PolicyInstallResult;
  installExecutionProfile(input: InstallExecutionProfile): ExecutionProfileInstallResult;
  claimWorkerDispatch(input: ClaimWorkerDispatch): WorkerDispatchClaimResult;
  commitContextBoundAttemptStart(
    input: CommitContextBoundAttemptStart,
  ): StoreCommandResult<CommittedContextAttempt>;
  commitWorkerAttemptEvent(
    input: CommitWorkerAttemptEvent,
  ): WorkerEventStoreResult<AppliedAttemptEvent>;
  recordIgnoredWorkerEvent(input: RecordIgnoredWorkerEvent): WorkerEventStoreResult<undefined>;
}

export interface RecoveryControlStore extends WorkerControlStore {
  listStartupRecoveryCatalog(): readonly RecoveryCatalogEntry[];
  getRecoveryCatalogForGoal(goalId: GoalId): RecoveryCatalogEntry | undefined;
  getRecoveryReconciliation(
    recoveryId: RecoveryReconciliationId,
  ): RecoveryReconciliationRecord | undefined;
  getLatestRecoveryReconciliation(workflowId: WorkflowId): RecoveryReconciliationRecord | undefined;
  commitStartupRecovery(input: CommitStartupRecovery): StoreCommandResult<CommittedStartupRecovery>;
  commitResumeRecovery(input: CommitResumeRecovery): StoreCommandResult<CommittedResumeRecovery>;
}

export type CodeClosureApplicationStore = GoalCreationControlStore &
  GoalQueryStore &
  RecoveryControlStore;

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
  getEvidencePayload(digest: Sha256Digest, byteLength: number): EvidencePayload | undefined;
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
  commitLocalCommandVerificationAuthority(
    input: CommitLocalCommandVerificationAuthority,
  ): StoreCommandResult<CommittedLocalCommandVerificationAuthority>;
  commitEvidenceSetTransition(
    input: CommitEvidenceSetTransition,
  ): StoreCommandResult<WorkflowInstance>;
}

export interface AcceptanceControlStore extends CandidateEvidenceControlStore {
  getAcceptanceAuthorityForWorkflow(
    workflowId: WorkflowId,
    policyBundleId: PolicyBundleId,
  ): AcceptanceAuthorityView | undefined;
  getAcceptanceInputManifest(manifestDigest: Sha256Digest): AcceptanceInputManifest | undefined;
  getAcceptanceDecision(acceptanceDecisionId: AcceptanceDecisionId): AcceptanceDecision | undefined;
  getCloseoutForWorkflow(workflowId: WorkflowId): CloseoutRecord | undefined;
  getAcceptanceRepairForRejectedGeneration(
    candidateGenerationId: CandidateGenerationId,
  ): AcceptanceRepairRecord | undefined;
  commitAcceptanceEvaluation(
    input: CommitAcceptanceEvaluation,
  ): StoreCommandResult<CommittedAcceptanceEvaluation>;
  commitAcceptedCloseout(
    input: CommitAcceptedCloseout,
  ): StoreCommandResult<CommittedAcceptedCloseout>;
  commitAcceptanceRepair(
    input: CommitAcceptanceRepair,
  ): StoreCommandResult<CommittedAcceptanceRepair>;
}

export interface WorkflowDriverControlStore extends AcceptanceControlStore {
  getWorkflowDriverAuthority(goalId: GoalId): WorkflowDriverAuthoritySnapshot | undefined;
}
