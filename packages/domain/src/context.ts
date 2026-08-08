import {
  acceptanceDecisionId,
  acceptanceCriticalVerificationPlanId,
  aggregateVersion,
  candidateGenerationId,
  checkSpecificationId,
  contextManifestId,
  evidenceId,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  projectSourceReadAuthorityId,
  sha256Digest,
  attemptId,
  verificationObligationId,
  workflowId,
  workflowVersion,
  type AttemptId,
  type AcceptanceDecisionId,
  type AcceptanceCriticalVerificationPlanId,
  type AggregateVersion,
  type CandidateGenerationId,
  type CheckSpecificationId,
  type ContextManifestId,
  type ExecutionProfileId,
  type EvidenceId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type PolicyBundleId,
  type ProjectSourceReadAuthorityId,
  type Sha256Digest,
  type VerificationObligationId,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import {
  WorkflowPhase,
  type SuccessCriterion,
  type WorkflowPhase as WorkflowPhaseType,
} from './model.js';
import { isCanonicalCapabilityGrant, type CapabilityGrant } from './capabilities.js';

export const ContextAuthorityClass = {
  GOAL_AUTHORITY: 'GOAL_AUTHORITY',
  CONFIRMED_FACT: 'CONFIRMED_FACT',
  HUMAN_DECISION: 'HUMAN_DECISION',
  PROJECT_OBSERVATION: 'PROJECT_OBSERVATION',
  NON_AUTHORITATIVE_WORKING: 'NON_AUTHORITATIVE_WORKING',
  RUNTIME_DECISION: 'RUNTIME_DECISION',
  EVIDENCE_AUTHORITY: 'EVIDENCE_AUTHORITY',
} as const;
export type ContextAuthorityClass =
  (typeof ContextAuthorityClass)[keyof typeof ContextAuthorityClass];

export const ContextEntryKind = {
  GOAL: 'GOAL',
  SUCCESS_CRITERION: 'SUCCESS_CRITERION',
  FACT: 'FACT',
  DECISION: 'DECISION',
  PROJECT_RULE: 'PROJECT_RULE',
  PROJECT_OBSERVATION: 'PROJECT_OBSERVATION',
  WORKING_CONTEXT: 'WORKING_CONTEXT',
  CANDIDATE: 'CANDIDATE',
  ACCEPTANCE_REPAIR: 'ACCEPTANCE_REPAIR',
  ACCEPTANCE_DECISION: 'ACCEPTANCE_DECISION',
  ACCEPTANCE_INPUT_MANIFEST: 'ACCEPTANCE_INPUT_MANIFEST',
  EVIDENCE_SET: 'EVIDENCE_SET',
  EVIDENCE: 'EVIDENCE',
  EVIDENCE_ELIGIBILITY: 'EVIDENCE_ELIGIBILITY',
  CANDIDATE_RELATIONSHIP: 'CANDIDATE_RELATIONSHIP',
  PRESERVATION_CONSTRAINT: 'PRESERVATION_CONSTRAINT',
  PRIOR_ATTEMPT_FEEDBACK: 'PRIOR_ATTEMPT_FEEDBACK',
} as const;
export type ContextEntryKind = (typeof ContextEntryKind)[keyof typeof ContextEntryKind];

export const WorkerResultKind = {
  PROPOSALS: 'PROPOSALS',
  COMPLETION_REQUEST: 'COMPLETION_REQUEST',
} as const;
export type WorkerResultKind = (typeof WorkerResultKind)[keyof typeof WorkerResultKind];

export interface WorkerResponseContract {
  readonly schemaVersion: 1;
  readonly workerEventSchemaVersion: 1;
  readonly allowedResultKinds: readonly WorkerResultKind[];
  readonly unknownFields: 'REJECT';
  readonly maxEventBytes: number;
}

export interface ContextPackageEntry {
  readonly kind: ContextEntryKind;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly sourceDigest?: Sha256Digest;
  readonly authorityClass: ContextAuthorityClass;
  readonly renderedContent: string;
}

export interface ContextPackageGoal {
  readonly objective: string;
  readonly successCriteria: readonly SuccessCriterion[];
  readonly scope: {
    readonly projectPath: string;
    readonly allowedPaths: readonly string[];
  };
  readonly nonGoals: readonly string[];
}

export interface RepairContextFailedEvidence {
  readonly evidenceId: EvidenceId;
  readonly evidenceRecordDigest: Sha256Digest;
  readonly evidenceEligibilityVersion: AggregateVersion;
  readonly evidenceEligibilityState: 'ELIGIBLE';
  readonly resultStatus: 'FAIL';
  readonly verificationObligationId: VerificationObligationId;
  readonly checkSpecificationId: CheckSpecificationId;
  readonly checkSpecificationDigest: Sha256Digest;
}

export const RepairPreservationConstraintKind = {
  ALLOWED_PATH: 'ALLOWED_PATH',
  NON_GOAL: 'NON_GOAL',
} as const;
export type RepairPreservationConstraintKind =
  (typeof RepairPreservationConstraintKind)[keyof typeof RepairPreservationConstraintKind];

export interface RepairPreservationConstraint {
  readonly kind: RepairPreservationConstraintKind;
  readonly content: string;
  readonly sourceRef: string;
  readonly sourceDigest: Sha256Digest;
}

export interface RepairContext {
  readonly schemaVersion: 1;
  readonly acceptanceRepairDigest: Sha256Digest;
  readonly acceptanceDecisionId: AcceptanceDecisionId;
  readonly acceptanceDecisionDigest: Sha256Digest;
  readonly inputManifestDigest: Sha256Digest;
  readonly evidenceSetDigest: Sha256Digest;
  readonly rejectedCandidateGenerationId: CandidateGenerationId;
  readonly rejectedCandidateVersion: AggregateVersion;
  readonly rejectedCandidateDigest: Sha256Digest;
  readonly repairCandidateGenerationId: CandidateGenerationId;
  readonly repairCandidateSequence: number;
  readonly repairCandidateBaseDigest: Sha256Digest;
  readonly parentChangeSetDigest: Sha256Digest;
  readonly failedEvidence: readonly RepairContextFailedEvidence[];
  readonly constraintsToPreserve: readonly RepairPreservationConstraint[];
}

export interface PriorAttemptFeedbackItem {
  readonly kind: 'FAILED_CHECK' | 'PARENT_CHANGE_SET' | 'PRESERVATION_CONSTRAINT';
  readonly content: string;
  readonly sourceRefs: readonly string[];
  readonly sourceDigests: readonly Sha256Digest[];
}

export interface PriorAttemptFeedback {
  readonly schemaVersion: 1;
  readonly items: readonly PriorAttemptFeedbackItem[];
  readonly feedbackDigest: Sha256Digest;
}

export interface ContextPackage {
  readonly schemaVersion: 2 | 3 | 4 | 5;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly phase: WorkflowPhaseType;
  readonly attemptId: AttemptId;
  readonly candidateGenerationId?: CandidateGenerationId;
  readonly candidateDigest?: Sha256Digest;
  readonly phaseObjective: string;
  readonly capabilityGrant: CapabilityGrant;
  readonly goal: ContextPackageGoal;
  readonly selectedEntries: readonly ContextPackageEntry[];
  readonly repairContext?: RepairContext;
  readonly priorAttemptFeedback?: PriorAttemptFeedback;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly acceptanceCriticalVerificationPlanId?: AcceptanceCriticalVerificationPlanId;
  readonly acceptanceCriticalVerificationPlanDigest?: Sha256Digest;
  readonly projectReadAuthorityId?: ProjectSourceReadAuthorityId;
  readonly projectReadAuthorityRecordDigest?: Sha256Digest;
  readonly projectReadSourceTreeProjectionDigest?: Sha256Digest;
  readonly projectReadGitStateProjectionDigest?: Sha256Digest;
  readonly responseContract: WorkerResponseContract;
}

export interface ContextManifestEntry {
  readonly kind: ContextEntryKind;
  readonly sourceRef: string;
  readonly sourceRevision: string;
  readonly sourceDigest?: Sha256Digest;
  readonly authorityClass: ContextAuthorityClass;
  readonly renderedDigest: Sha256Digest;
}

export interface ContextOmissionDecision {
  readonly sourceRef: string;
  readonly selectionRule: string;
  readonly reason: string;
}

export interface ContextManifest {
  readonly id: ContextManifestId;
  readonly schemaVersion: 2 | 3 | 4 | 5;
  readonly compilerVersion: string;
  readonly createdAt: IsoTimestamp;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly phase: WorkflowPhaseType;
  readonly attemptId: AttemptId;
  readonly candidateGenerationId?: CandidateGenerationId;
  readonly candidateDigest?: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly acceptanceCriticalVerificationPlanId?: AcceptanceCriticalVerificationPlanId;
  readonly acceptanceCriticalVerificationPlanDigest?: Sha256Digest;
  readonly projectReadAuthorityId?: ProjectSourceReadAuthorityId;
  readonly projectReadAuthorityRecordDigest?: Sha256Digest;
  readonly projectReadSourceTreeProjectionDigest?: Sha256Digest;
  readonly projectReadGitStateProjectionDigest?: Sha256Digest;
  readonly capabilityGrantDigest: Sha256Digest;
  readonly responseContractDigest: Sha256Digest;
  readonly repairContextDigest?: Sha256Digest;
  readonly priorAttemptFeedbackDigest?: Sha256Digest;
  readonly entries: readonly ContextManifestEntry[];
  readonly omissionDecisions: readonly ContextOmissionDecision[];
  readonly packageDigest: Sha256Digest;
  readonly manifestDigest: Sha256Digest;
}

export interface ContextCompilation {
  readonly package: ContextPackage;
  readonly manifest: ContextManifest;
}

function isKnown<Value extends string>(
  values: Readonly<Record<string, Value>>,
  value: unknown,
): value is Value {
  return Object.values(values).some((candidate) => candidate === value);
}

function field(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be blank`);
  }
}

function contextEntryKey(
  entry: Pick<ContextManifestEntry, 'kind' | 'sourceRef' | 'sourceRevision'>,
): string {
  return `${entry.kind}\u0000${entry.sourceRef}\u0000${entry.sourceRevision}`;
}

function omissionKey(decision: ContextOmissionDecision): string {
  return `${decision.sourceRef}\u0000${decision.selectionRule}\u0000${decision.reason}`;
}

export function assertContextEntryAuthorityInvariant(
  entry: Pick<ContextPackageEntry, 'kind' | 'authorityClass'>,
): void {
  switch (entry.kind) {
    case ContextEntryKind.GOAL:
    case ContextEntryKind.SUCCESS_CRITERION:
      if (entry.authorityClass !== ContextAuthorityClass.GOAL_AUTHORITY) {
        throw new TypeError(`${entry.kind} Context entry must retain Goal authority`);
      }
      return;
    case ContextEntryKind.FACT:
      if (
        entry.authorityClass !== ContextAuthorityClass.CONFIRMED_FACT &&
        entry.authorityClass !== ContextAuthorityClass.PROJECT_OBSERVATION &&
        entry.authorityClass !== ContextAuthorityClass.NON_AUTHORITATIVE_WORKING
      ) {
        throw new TypeError('Fact Context entry has an invalid authority class');
      }
      return;
    case ContextEntryKind.DECISION:
      if (entry.authorityClass !== ContextAuthorityClass.HUMAN_DECISION) {
        throw new TypeError('Decision Context entry must retain Human Decision authority');
      }
      return;
    case ContextEntryKind.PROJECT_RULE:
    case ContextEntryKind.PROJECT_OBSERVATION:
    case ContextEntryKind.CANDIDATE:
      if (entry.authorityClass !== ContextAuthorityClass.PROJECT_OBSERVATION) {
        throw new TypeError(`${entry.kind} Context entry must remain a project observation`);
      }
      return;
    case ContextEntryKind.WORKING_CONTEXT:
      if (entry.authorityClass !== ContextAuthorityClass.NON_AUTHORITATIVE_WORKING) {
        throw new TypeError('Working Context entry must remain explicitly non-authoritative');
      }
      return;
    case ContextEntryKind.ACCEPTANCE_REPAIR:
    case ContextEntryKind.ACCEPTANCE_DECISION:
    case ContextEntryKind.ACCEPTANCE_INPUT_MANIFEST:
    case ContextEntryKind.CANDIDATE_RELATIONSHIP:
    case ContextEntryKind.PRESERVATION_CONSTRAINT:
      if (entry.authorityClass !== ContextAuthorityClass.RUNTIME_DECISION) {
        throw new TypeError(`${entry.kind} Context entry must retain Runtime decision authority`);
      }
      return;
    case ContextEntryKind.EVIDENCE_SET:
    case ContextEntryKind.EVIDENCE:
    case ContextEntryKind.EVIDENCE_ELIGIBILITY:
      if (entry.authorityClass !== ContextAuthorityClass.EVIDENCE_AUTHORITY) {
        throw new TypeError(`${entry.kind} Context entry must retain Evidence authority`);
      }
      return;
    case ContextEntryKind.PRIOR_ATTEMPT_FEEDBACK:
      if (entry.authorityClass !== ContextAuthorityClass.NON_AUTHORITATIVE_WORKING) {
        throw new TypeError('Prior-Attempt feedback must remain explicitly non-authoritative');
      }
      return;
  }
}

function assertCanonicalOrder<Value>(
  values: readonly Value[],
  keyOf: (value: Value) => string,
  name: string,
): void {
  let previous: string | undefined;
  for (const value of values) {
    const current = keyOf(value);
    if (previous !== undefined && current <= previous) {
      throw new TypeError(`${name} must be uniquely sorted in canonical order`);
    }
    previous = current;
  }
}

function assertCandidateBinding(
  candidateGeneration: CandidateGenerationId | undefined,
  candidateIdentity: Sha256Digest | undefined,
): void {
  if ((candidateGeneration === undefined) !== (candidateIdentity === undefined)) {
    throw new TypeError('Context candidate generation and digest must be present together');
  }
  if (candidateGeneration !== undefined && candidateIdentity !== undefined) {
    candidateGenerationId(candidateGeneration);
    sha256Digest(candidateIdentity);
  }
}

function assertProjectReadContextBinding(
  value: Pick<
    ContextPackage | ContextManifest,
    | 'schemaVersion'
    | 'phase'
    | 'candidateGenerationId'
    | 'candidateDigest'
    | 'projectReadAuthorityId'
    | 'projectReadAuthorityRecordDigest'
    | 'projectReadSourceTreeProjectionDigest'
    | 'projectReadGitStateProjectionDigest'
  >,
): void {
  const binding = [
    value.projectReadAuthorityId,
    value.projectReadAuthorityRecordDigest,
    value.projectReadSourceTreeProjectionDigest,
    value.projectReadGitStateProjectionDigest,
  ];
  const presentCount = binding.filter((entry) => entry !== undefined).length;
  if (value.schemaVersion !== 5) {
    if (presentCount !== 0) {
      throw new TypeError('Historical Context schema cannot contain project-read authority');
    }
    return;
  }
  const authorityId = value.projectReadAuthorityId;
  const authorityRecordDigest = value.projectReadAuthorityRecordDigest;
  const sourceTreeProjectionDigest = value.projectReadSourceTreeProjectionDigest;
  const gitStateProjectionDigest = value.projectReadGitStateProjectionDigest;
  if (
    presentCount !== binding.length ||
    authorityId === undefined ||
    authorityRecordDigest === undefined ||
    sourceTreeProjectionDigest === undefined ||
    gitStateProjectionDigest === undefined ||
    (value.phase !== WorkflowPhase.DISCOVERY && value.phase !== WorkflowPhase.PLAN) ||
    value.candidateGenerationId !== undefined ||
    value.candidateDigest !== undefined
  ) {
    throw new TypeError(
      'Project-read Context v5 requires one complete candidate-free phase binding',
    );
  }
  projectSourceReadAuthorityId(authorityId);
  sha256Digest(authorityRecordDigest);
  sha256Digest(sourceTreeProjectionDigest);
  sha256Digest(gitStateProjectionDigest);
}

function assertRepairContextInvariant(repair: RepairContext): void {
  if (field(repair, 'schemaVersion') !== 1) {
    throw new TypeError('Repair Context schema is unsupported');
  }
  for (const digest of [
    repair.acceptanceRepairDigest,
    repair.acceptanceDecisionDigest,
    repair.inputManifestDigest,
    repair.evidenceSetDigest,
    repair.rejectedCandidateDigest,
    repair.repairCandidateBaseDigest,
    repair.parentChangeSetDigest,
  ]) {
    sha256Digest(digest);
  }
  acceptanceDecisionId(repair.acceptanceDecisionId);
  candidateGenerationId(repair.rejectedCandidateGenerationId);
  aggregateVersion(repair.rejectedCandidateVersion);
  candidateGenerationId(repair.repairCandidateGenerationId);
  if (!Number.isSafeInteger(repair.repairCandidateSequence) || repair.repairCandidateSequence < 2) {
    throw new TypeError('Repair child sequence must be a safe integer of at least 2');
  }
  if (repair.failedEvidence.length === 0) {
    throw new TypeError('Repair Context requires selected failing Evidence');
  }
  assertCanonicalOrder(repair.failedEvidence, (entry) => entry.evidenceId, 'Repair Evidence');
  for (const entry of repair.failedEvidence) {
    evidenceId(entry.evidenceId);
    sha256Digest(entry.evidenceRecordDigest);
    aggregateVersion(entry.evidenceEligibilityVersion);
    if (
      field(entry, 'evidenceEligibilityState') !== 'ELIGIBLE' ||
      field(entry, 'resultStatus') !== 'FAIL'
    ) {
      throw new TypeError('Repair Context may select only eligible failing Evidence');
    }
    verificationObligationId(entry.verificationObligationId);
    checkSpecificationId(entry.checkSpecificationId);
    sha256Digest(entry.checkSpecificationDigest);
  }
  assertCanonicalOrder(
    repair.constraintsToPreserve,
    (constraint) => `${constraint.kind}\u0000${constraint.content}`,
    'Repair preservation constraints',
  );
  for (const constraint of repair.constraintsToPreserve) {
    if (!isKnown(RepairPreservationConstraintKind, constraint.kind)) {
      throw new TypeError('Repair preservation constraint kind is unknown');
    }
    assertNonBlank(constraint.content, 'Repair preservation constraint');
    assertNonBlank(constraint.sourceRef, 'Repair preservation source');
    sha256Digest(constraint.sourceDigest);
  }
}

function assertPriorAttemptFeedbackInvariant(feedback: PriorAttemptFeedback): void {
  if (
    field(feedback, 'schemaVersion') !== 1 ||
    feedback.items.length === 0 ||
    feedback.items.length > 128
  ) {
    throw new TypeError('Prior-Attempt feedback schema or item count is invalid');
  }
  assertCanonicalOrder(
    feedback.items,
    (item) => `${item.kind}\u0000${item.content}`,
    'Prior-Attempt feedback',
  );
  for (const item of feedback.items) {
    if (
      field(item, 'kind') !== 'FAILED_CHECK' &&
      field(item, 'kind') !== 'PARENT_CHANGE_SET' &&
      field(item, 'kind') !== 'PRESERVATION_CONSTRAINT'
    ) {
      throw new TypeError('Prior-Attempt feedback kind is unknown');
    }
    assertNonBlank(item.content, 'Prior-Attempt feedback content');
    if (Buffer.byteLength(item.content, 'utf8') > 4_096) {
      throw new TypeError('Prior-Attempt feedback item exceeds its byte budget');
    }
    if (item.sourceRefs.length === 0 || item.sourceRefs.length !== item.sourceDigests.length) {
      throw new TypeError('Prior-Attempt feedback requires aligned source references and digests');
    }
    assertCanonicalOrder(item.sourceRefs, (source) => source, 'Feedback source references');
    for (const source of item.sourceRefs) {
      assertNonBlank(source, 'Feedback source reference');
    }
    for (const digest of item.sourceDigests) {
      sha256Digest(digest);
    }
  }
  sha256Digest(feedback.feedbackDigest);
}

export function assertWorkerResponseContractInvariant(contract: WorkerResponseContract): void {
  if (
    field(contract, 'schemaVersion') !== 1 ||
    field(contract, 'workerEventSchemaVersion') !== 1 ||
    field(contract, 'unknownFields') !== 'REJECT'
  ) {
    throw new TypeError('Worker response contract version or unknown-field policy is invalid');
  }
  if (contract.allowedResultKinds.length === 0) {
    throw new TypeError('Worker response contract must allow at least one result kind');
  }
  if (!Number.isSafeInteger(contract.maxEventBytes) || contract.maxEventBytes < 1) {
    throw new TypeError('Worker response contract event limit must be a positive safe integer');
  }
  const seen = new Set<WorkerResultKind>();
  for (const kind of contract.allowedResultKinds) {
    if (!isKnown(WorkerResultKind, kind) || seen.has(kind)) {
      throw new TypeError('Worker response result kinds must be known and unique');
    }
    seen.add(kind);
  }
}

export function assertContextPackageInvariant(contextPackage: ContextPackage): void {
  if (
    field(contextPackage, 'schemaVersion') !== 2 &&
    field(contextPackage, 'schemaVersion') !== 3 &&
    field(contextPackage, 'schemaVersion') !== 4 &&
    field(contextPackage, 'schemaVersion') !== 5
  ) {
    throw new TypeError('Context Package schema version is unsupported');
  }
  goalId(contextPackage.goalId);
  goalRevision(contextPackage.goalRevision);
  workflowId(contextPackage.workflowId);
  workflowVersion(contextPackage.workflowVersion);
  attemptId(contextPackage.attemptId);
  executionProfileId(contextPackage.executionProfileId);
  sha256Digest(contextPackage.executionProfileDigest);
  policyBundleId(contextPackage.policyBundleId);
  sha256Digest(contextPackage.policyBundleDigest);
  const protectedPlanId = contextPackage.acceptanceCriticalVerificationPlanId;
  const protectedPlanDigest = contextPackage.acceptanceCriticalVerificationPlanDigest;
  if ((protectedPlanId === undefined) !== (protectedPlanDigest === undefined)) {
    throw new TypeError('Context protected Plan ID and digest must be present together');
  }
  if (
    !isKnown(WorkflowPhase, contextPackage.phase) ||
    contextPackage.phase === WorkflowPhase.CLOSEOUT
  ) {
    throw new TypeError('Context Package phase is not dispatchable');
  }
  assertCandidateBinding(contextPackage.candidateGenerationId, contextPackage.candidateDigest);
  assertProjectReadContextBinding(contextPackage);
  assertNonBlank(contextPackage.phaseObjective, 'Context phase objective');
  if (
    contextPackage.capabilityGrant.phase !== contextPackage.phase ||
    !isCanonicalCapabilityGrant(contextPackage.capabilityGrant)
  ) {
    throw new TypeError('Context Package capability grant is not canonical for its phase');
  }
  assertNonBlank(contextPackage.goal.objective, 'Context Goal objective');
  assertNonBlank(contextPackage.goal.scope.projectPath, 'Context Goal project path');
  if (contextPackage.goal.successCriteria.length === 0) {
    throw new TypeError('Context Package must contain Goal success criteria');
  }
  const criterionIds = new Set<string>();
  for (const criterion of contextPackage.goal.successCriteria) {
    assertNonBlank(criterion.description, 'Context success criterion');
    if (criterionIds.has(criterion.id)) {
      throw new TypeError('Context Package success criterion IDs must be unique');
    }
    criterionIds.add(criterion.id);
  }
  for (const entry of contextPackage.selectedEntries) {
    assertNonBlank(entry.sourceRef, 'Context entry sourceRef');
    assertNonBlank(entry.sourceRevision, 'Context entry sourceRevision');
    assertNonBlank(entry.renderedContent, 'Context entry renderedContent');
    if (
      !isKnown(ContextEntryKind, entry.kind) ||
      !isKnown(ContextAuthorityClass, entry.authorityClass)
    ) {
      throw new TypeError('Context Package entry kind or authority class is unknown');
    }
    if (entry.sourceDigest !== undefined) {
      sha256Digest(entry.sourceDigest);
    }
    if (
      entry.kind === ContextEntryKind.GOAL ||
      entry.kind === ContextEntryKind.SUCCESS_CRITERION ||
      entry.kind === ContextEntryKind.CANDIDATE
    ) {
      throw new TypeError(`${entry.kind} Context entries are compiler-owned`);
    }
    assertContextEntryAuthorityInvariant(entry);
  }
  assertCanonicalOrder(contextPackage.selectedEntries, contextEntryKey, 'Context Package entries');
  if (contextPackage.schemaVersion === 2) {
    if (
      contextPackage.repairContext !== undefined ||
      contextPackage.priorAttemptFeedback !== undefined ||
      protectedPlanId !== undefined
    ) {
      throw new TypeError('Context Package v2 cannot contain repair authority');
    }
  } else if (contextPackage.schemaVersion === 3) {
    if (
      contextPackage.phase !== WorkflowPhase.IMPLEMENT ||
      contextPackage.candidateGenerationId === undefined ||
      contextPackage.repairContext === undefined ||
      contextPackage.priorAttemptFeedback === undefined
    ) {
      throw new TypeError('Repair Context Package v3 requires exact IMPLEMENT authority');
    }
    assertRepairContextInvariant(contextPackage.repairContext);
    assertPriorAttemptFeedbackInvariant(contextPackage.priorAttemptFeedback);
    if (
      contextPackage.repairContext.repairCandidateGenerationId !==
        contextPackage.candidateGenerationId ||
      contextPackage.repairContext.repairCandidateBaseDigest !== contextPackage.candidateDigest
    ) {
      throw new TypeError('Repair Context does not bind the Package Candidate child');
    }
    if (protectedPlanId !== undefined) {
      throw new TypeError('Repair Context Package v3 cannot contain protected Plan authority');
    }
  } else if (contextPackage.schemaVersion === 4) {
    if (protectedPlanId === undefined || protectedPlanDigest === undefined) {
      throw new TypeError('Protected Context Package v4 requires exact Plan authority');
    }
    acceptanceCriticalVerificationPlanId(protectedPlanId);
    sha256Digest(protectedPlanDigest);
    if (
      (contextPackage.repairContext === undefined) !==
      (contextPackage.priorAttemptFeedback === undefined)
    ) {
      throw new TypeError('Protected repair Context requires both repair values');
    }
    if (
      contextPackage.repairContext !== undefined &&
      contextPackage.priorAttemptFeedback !== undefined
    ) {
      if (
        contextPackage.phase !== WorkflowPhase.IMPLEMENT ||
        contextPackage.candidateGenerationId === undefined
      ) {
        throw new TypeError('Protected repair Context requires IMPLEMENT Candidate authority');
      }
      assertRepairContextInvariant(contextPackage.repairContext);
      assertPriorAttemptFeedbackInvariant(contextPackage.priorAttemptFeedback);
      if (
        contextPackage.repairContext.repairCandidateGenerationId !==
          contextPackage.candidateGenerationId ||
        contextPackage.repairContext.repairCandidateBaseDigest !== contextPackage.candidateDigest
      ) {
        throw new TypeError('Protected repair Context does not bind its Candidate child');
      }
    }
  } else {
    if (protectedPlanId === undefined || protectedPlanDigest === undefined) {
      throw new TypeError(
        'Project-read Context Package v5 requires exact protected Plan authority',
      );
    }
    acceptanceCriticalVerificationPlanId(protectedPlanId);
    sha256Digest(protectedPlanDigest);
    if (
      contextPackage.repairContext !== undefined ||
      contextPackage.priorAttemptFeedback !== undefined ||
      contextPackage.selectedEntries.length !== 0
    ) {
      throw new TypeError(
        'Project-read Context Package v5 cannot contain selected or repair authority',
      );
    }
  }
  assertWorkerResponseContractInvariant(contextPackage.responseContract);
}

export function assertContextManifestInvariant(manifest: ContextManifest): void {
  if (
    field(manifest, 'schemaVersion') !== 2 &&
    field(manifest, 'schemaVersion') !== 3 &&
    field(manifest, 'schemaVersion') !== 4 &&
    field(manifest, 'schemaVersion') !== 5
  ) {
    throw new TypeError('Context Manifest schema version is unsupported');
  }
  contextManifestId(manifest.id);
  goalId(manifest.goalId);
  goalRevision(manifest.goalRevision);
  workflowId(manifest.workflowId);
  workflowVersion(manifest.workflowVersion);
  attemptId(manifest.attemptId);
  executionProfileId(manifest.executionProfileId);
  sha256Digest(manifest.executionProfileDigest);
  policyBundleId(manifest.policyBundleId);
  isoTimestamp(manifest.createdAt);
  assertNonBlank(manifest.compilerVersion, 'Context compilerVersion');
  if (!isKnown(WorkflowPhase, manifest.phase) || manifest.phase === WorkflowPhase.CLOSEOUT) {
    throw new TypeError('Context Manifest phase is not dispatchable');
  }
  assertCandidateBinding(manifest.candidateGenerationId, manifest.candidateDigest);
  assertProjectReadContextBinding(manifest);
  sha256Digest(manifest.policyBundleDigest);
  const protectedPlanId = manifest.acceptanceCriticalVerificationPlanId;
  const protectedPlanDigest = manifest.acceptanceCriticalVerificationPlanDigest;
  if ((protectedPlanId === undefined) !== (protectedPlanDigest === undefined)) {
    throw new TypeError('Context Manifest protected Plan pair is incomplete');
  }
  sha256Digest(manifest.capabilityGrantDigest);
  sha256Digest(manifest.responseContractDigest);
  if (manifest.schemaVersion === 2) {
    if (
      manifest.repairContextDigest !== undefined ||
      manifest.priorAttemptFeedbackDigest !== undefined ||
      protectedPlanId !== undefined
    ) {
      throw new TypeError('Context Manifest v2 cannot contain repair digests');
    }
  } else if (manifest.schemaVersion === 3) {
    if (
      manifest.phase !== WorkflowPhase.IMPLEMENT ||
      manifest.candidateGenerationId === undefined ||
      manifest.candidateDigest === undefined ||
      manifest.repairContextDigest === undefined ||
      manifest.priorAttemptFeedbackDigest === undefined
    ) {
      throw new TypeError('Repair Context Manifest v3 requires both repair digests');
    }
    sha256Digest(manifest.repairContextDigest);
    sha256Digest(manifest.priorAttemptFeedbackDigest);
    if (protectedPlanId !== undefined) {
      throw new TypeError('Context Manifest v3 cannot contain protected Plan authority');
    }
  } else if (manifest.schemaVersion === 4) {
    if (protectedPlanId === undefined || protectedPlanDigest === undefined) {
      throw new TypeError('Protected Context Manifest v4 requires exact Plan authority');
    }
    acceptanceCriticalVerificationPlanId(protectedPlanId);
    sha256Digest(protectedPlanDigest);
    if (
      (manifest.repairContextDigest === undefined) !==
      (manifest.priorAttemptFeedbackDigest === undefined)
    ) {
      throw new TypeError('Protected repair Manifest requires both repair digests');
    }
    if (
      manifest.repairContextDigest !== undefined &&
      manifest.priorAttemptFeedbackDigest !== undefined
    ) {
      if (
        manifest.phase !== WorkflowPhase.IMPLEMENT ||
        manifest.candidateGenerationId === undefined ||
        manifest.candidateDigest === undefined
      ) {
        throw new TypeError('Protected repair Manifest requires IMPLEMENT Candidate authority');
      }
      sha256Digest(manifest.repairContextDigest);
      sha256Digest(manifest.priorAttemptFeedbackDigest);
    }
  } else {
    if (protectedPlanId === undefined || protectedPlanDigest === undefined) {
      throw new TypeError(
        'Project-read Context Manifest v5 requires exact protected Plan authority',
      );
    }
    acceptanceCriticalVerificationPlanId(protectedPlanId);
    sha256Digest(protectedPlanDigest);
    if (
      manifest.repairContextDigest !== undefined ||
      manifest.priorAttemptFeedbackDigest !== undefined
    ) {
      throw new TypeError('Project-read Context Manifest v5 cannot contain repair authority');
    }
  }
  sha256Digest(manifest.packageDigest);
  sha256Digest(manifest.manifestDigest);
  const goalEntries: ContextManifestEntry[] = [];
  const candidateEntries: ContextManifestEntry[] = [];
  const manifestedSourceRefs = new Set<string>();
  for (const entry of manifest.entries) {
    assertNonBlank(entry.sourceRef, 'Context Manifest entry sourceRef');
    assertNonBlank(entry.sourceRevision, 'Context Manifest entry sourceRevision');
    if (
      !isKnown(ContextEntryKind, entry.kind) ||
      !isKnown(ContextAuthorityClass, entry.authorityClass)
    ) {
      throw new TypeError('Context Manifest entry kind or authority class is unknown');
    }
    if (entry.sourceDigest !== undefined) {
      sha256Digest(entry.sourceDigest);
    }
    sha256Digest(entry.renderedDigest);
    assertContextEntryAuthorityInvariant(entry);
    manifestedSourceRefs.add(entry.sourceRef);
    if (entry.kind === ContextEntryKind.GOAL) {
      goalEntries.push(entry);
    }
    if (entry.kind === ContextEntryKind.CANDIDATE) {
      candidateEntries.push(entry);
    }
  }
  assertCanonicalOrder(manifest.entries, contextEntryKey, 'Context Manifest entries');
  if (
    manifest.schemaVersion === 5 &&
    (manifest.omissionDecisions.length !== 0 ||
      manifest.entries.some(
        (entry) =>
          entry.kind !== ContextEntryKind.GOAL && entry.kind !== ContextEntryKind.SUCCESS_CRITERION,
      ))
  ) {
    throw new TypeError(
      'Project-read Context Manifest v5 cannot contain selected or omitted sources',
    );
  }
  if (
    goalEntries.length !== 1 ||
    goalEntries[0]?.sourceRef !== manifest.goalId ||
    goalEntries[0].sourceRevision !== String(manifest.goalRevision)
  ) {
    throw new TypeError('Context Manifest must contain its exact authoritative Goal entry');
  }
  for (const criterion of manifest.entries.filter(
    (entry) => entry.kind === ContextEntryKind.SUCCESS_CRITERION,
  )) {
    if (criterion.sourceRevision !== String(manifest.goalRevision)) {
      throw new TypeError('Context criterion entry must bind the Manifest Goal revision');
    }
  }
  if (manifest.candidateGenerationId === undefined || manifest.candidateDigest === undefined) {
    if (candidateEntries.length !== 0) {
      throw new TypeError('Context Manifest without a Candidate binding cannot contain one');
    }
  } else if (
    candidateEntries.length !== 1 ||
    candidateEntries[0]?.sourceRef !== manifest.candidateGenerationId ||
    candidateEntries[0].sourceRevision !== String(manifest.workflowVersion) ||
    candidateEntries[0].sourceDigest !== manifest.candidateDigest
  ) {
    throw new TypeError('Context Manifest Candidate entry does not match its binding');
  }
  const omittedSourceRefs = new Set<string>();
  for (const decision of manifest.omissionDecisions) {
    assertNonBlank(decision.sourceRef, 'Context omission sourceRef');
    assertNonBlank(decision.selectionRule, 'Context omission selectionRule');
    assertNonBlank(decision.reason, 'Context omission reason');
    if (omittedSourceRefs.has(decision.sourceRef)) {
      throw new TypeError('Context omission decisions must identify unique sources');
    }
    if (manifestedSourceRefs.has(decision.sourceRef)) {
      throw new TypeError(`Context source ${decision.sourceRef} cannot be selected and omitted`);
    }
    omittedSourceRefs.add(decision.sourceRef);
  }
  assertCanonicalOrder(manifest.omissionDecisions, omissionKey, 'Context omission decisions');
}
