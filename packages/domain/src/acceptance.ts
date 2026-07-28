import {
  aggregateVersion,
  acceptanceDecisionId,
  candidateGenerationId,
  checkSpecificationId,
  goalId,
  goalRevision,
  isoTimestamp,
  pendingIssueId,
  policyBundleId,
  sha256Digest,
  verificationObligationId,
  workflowId,
  workflowVersion,
  type AggregateVersion,
  type AcceptanceDecisionId,
  type CandidateGenerationId,
  type CheckSpecificationId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type PendingIssueId,
  type PolicyBundleId,
  type Sha256Digest,
  type VerificationObligationId,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import { WorkflowPhase } from './model.js';
import { DomainInvariantError } from './workflow.js';

export const RuleApplicability = {
  APPLICABLE: 'APPLICABLE',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
} as const;
export type RuleApplicability = (typeof RuleApplicability)[keyof typeof RuleApplicability];

export const RuleOutcome = {
  PASS: 'PASS',
  FAIL_REPAIRABLE: 'FAIL_REPAIRABLE',
  FAIL_BLOCKED: 'FAIL_BLOCKED',
  NEEDS_DECISION: 'NEEDS_DECISION',
  NOT_APPLICABLE_WITH_REASON: 'NOT_APPLICABLE_WITH_REASON',
  ENGINE_ERROR: 'ENGINE_ERROR',
} as const;
export type RuleOutcome = (typeof RuleOutcome)[keyof typeof RuleOutcome];

export const AcceptanceOutcome = {
  ACCEPT: 'ACCEPT',
  REJECT_REPAIRABLE: 'REJECT_REPAIRABLE',
  REJECT_BLOCKED: 'REJECT_BLOCKED',
  NEEDS_DECISION: 'NEEDS_DECISION',
  ENGINE_ERROR: 'ENGINE_ERROR',
} as const;
export type AcceptanceOutcome = (typeof AcceptanceOutcome)[keyof typeof AcceptanceOutcome];

export const PendingIssueClassification = {
  TECHNICAL_FINDING: 'TECHNICAL_FINDING',
  SCOPE_CONFLICT: 'SCOPE_CONFLICT',
  EXTERNAL_DEPENDENCY: 'EXTERNAL_DEPENDENCY',
  DECISION_REQUIRED: 'DECISION_REQUIRED',
} as const;
export type PendingIssueClassification =
  (typeof PendingIssueClassification)[keyof typeof PendingIssueClassification];

export const PendingIssueSeverity = {
  BLOCKING: 'BLOCKING',
  NON_BLOCKING: 'NON_BLOCKING',
} as const;
export type PendingIssueSeverity = (typeof PendingIssueSeverity)[keyof typeof PendingIssueSeverity];

export const PendingIssueRepairability = {
  REPAIRABLE: 'REPAIRABLE',
  BLOCKED: 'BLOCKED',
  NEEDS_DECISION: 'NEEDS_DECISION',
} as const;
export type PendingIssueRepairability =
  (typeof PendingIssueRepairability)[keyof typeof PendingIssueRepairability];

export const PendingIssueStatus = {
  OPEN: 'OPEN',
  RESOLVED: 'RESOLVED',
} as const;
export type PendingIssueStatus = (typeof PendingIssueStatus)[keyof typeof PendingIssueStatus];

export interface PendingIssue {
  readonly id: PendingIssueId;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly candidateGenerationId?: CandidateGenerationId;
  readonly classification: PendingIssueClassification;
  readonly severity: PendingIssueSeverity;
  readonly description: string;
  readonly sourceRefs: readonly string[];
  readonly repairability: PendingIssueRepairability;
  readonly status: PendingIssueStatus;
  readonly createdAt: IsoTimestamp;
  readonly resolvedAt?: IsoTimestamp;
}

export interface PendingIssueSet {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly issues: readonly PendingIssue[];
  readonly digest: Sha256Digest;
}

export interface AcceptanceInputManifest {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly phase: typeof WorkflowPhase.FINAL_VERIFY;
  readonly factSnapshotDigest: Sha256Digest;
  readonly decisionSetDigest: Sha256Digest;
  readonly scenarioSetDigest: Sha256Digest;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly candidateDigest: Sha256Digest;
  readonly evidenceSetDigest: Sha256Digest;
  readonly pendingIssueSetDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly createdAt: IsoTimestamp;
  readonly manifestDigest: Sha256Digest;
}

export interface RuleResult {
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly applicability: RuleApplicability;
  readonly outcome: RuleOutcome;
  readonly reasonCode: string;
  readonly message: string;
  readonly inputRefs: readonly string[];
  readonly evidenceRefs: readonly string[];
  readonly checkerDigest: Sha256Digest;
}

export interface AcceptanceDecision {
  readonly id: AcceptanceDecisionId;
  readonly schemaVersion: 1;
  readonly inputManifestDigest: Sha256Digest;
  readonly policyBundleDigest: Sha256Digest;
  readonly outcome: AcceptanceOutcome;
  readonly dominantReasonCode: string;
  readonly ruleResults: readonly RuleResult[];
  readonly engineVersion: string;
  readonly issuedAt: IsoTimestamp;
  readonly decisionDigest: Sha256Digest;
}

export interface CloseoutRecord {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly acceptanceDecisionId: AcceptanceDecisionId;
  readonly acceptanceDecisionDigest: Sha256Digest;
  readonly inputManifestDigest: Sha256Digest;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly candidateDigest: Sha256Digest;
  readonly evidenceSetDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly closedAt: IsoTimestamp;
}

export interface AcceptanceRepairRecord {
  readonly schemaVersion: 1;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly acceptanceDecisionId: AcceptanceDecisionId;
  readonly acceptanceDecisionDigest: Sha256Digest;
  readonly inputManifestDigest: Sha256Digest;
  readonly rejectedCandidateGenerationId: CandidateGenerationId;
  readonly rejectedCandidateVersion: AggregateVersion;
  readonly rejectedCandidateDigest: Sha256Digest;
  readonly repairCandidateGenerationId: CandidateGenerationId;
  readonly repairCandidateSequence: number;
  readonly repairCandidateBaseDigest: Sha256Digest;
  readonly freezeCheckId: CheckSpecificationId;
  readonly freezeCheckVersion: string;
  readonly verificationCheckId: CheckSpecificationId;
  readonly verificationCheckVersion: string;
  readonly verificationObligationIds: readonly VerificationObligationId[];
  readonly evidenceSetDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly repairedAt: IsoTimestamp;
  readonly repairDigest: Sha256Digest;
}

function assertKnown<Value extends string>(
  values: Readonly<Record<string, Value>>,
  value: unknown,
  name: string,
): asserts value is Value {
  if (!Object.values(values).some((candidate) => candidate === value)) {
    throw new DomainInvariantError(`${name} is unknown`);
  }
}

function hasExactValue(value: unknown, expected: unknown): boolean {
  return value === expected;
}

function assertNonBlank(value: string, name: string): void {
  if (value.trim().length === 0) {
    throw new DomainInvariantError(`${name} must not be blank`);
  }
}

function assertUniqueNonBlank(values: readonly string[], name: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    assertNonBlank(value, name);
    if (seen.has(value)) {
      throw new DomainInvariantError(`${name} must not contain duplicates`);
    }
    seen.add(value);
  }
}

export function assertPendingIssueInvariant(issue: PendingIssue): void {
  pendingIssueId(issue.id);
  goalId(issue.goalId);
  goalRevision(issue.goalRevision);
  if (issue.candidateGenerationId !== undefined) {
    candidateGenerationId(issue.candidateGenerationId);
  }
  assertKnown(PendingIssueClassification, issue.classification, 'Pending Issue classification');
  assertKnown(PendingIssueSeverity, issue.severity, 'Pending Issue severity');
  assertKnown(PendingIssueRepairability, issue.repairability, 'Pending Issue repairability');
  assertKnown(PendingIssueStatus, issue.status, 'Pending Issue status');
  assertNonBlank(issue.description, 'Pending Issue description');
  assertUniqueNonBlank(issue.sourceRefs, 'Pending Issue source reference');
  isoTimestamp(issue.createdAt);
  if (issue.resolvedAt !== undefined) {
    isoTimestamp(issue.resolvedAt);
  }
  if (
    (issue.status === PendingIssueStatus.OPEN && issue.resolvedAt !== undefined) ||
    (issue.status === PendingIssueStatus.RESOLVED && issue.resolvedAt === undefined)
  ) {
    throw new DomainInvariantError('Pending Issue resolution time must match its status');
  }
  if (issue.resolvedAt !== undefined && issue.resolvedAt < issue.createdAt) {
    throw new DomainInvariantError('Pending Issue resolution cannot precede creation');
  }
  if (
    (issue.classification === PendingIssueClassification.DECISION_REQUIRED) !==
    (issue.repairability === PendingIssueRepairability.NEEDS_DECISION)
  ) {
    throw new DomainInvariantError(
      'Decision-required Pending Issues must use NEEDS_DECISION repairability',
    );
  }
}

export function assertPendingIssueSetInvariant(set: PendingIssueSet): void {
  if (!hasExactValue(set.schemaVersion, 1)) {
    throw new DomainInvariantError('Pending Issue Set schema version is unsupported');
  }
  goalId(set.goalId);
  goalRevision(set.goalRevision);
  sha256Digest(set.digest);
  let previousId: string | undefined;
  for (const issue of set.issues) {
    assertPendingIssueInvariant(issue);
    if (issue.goalId !== set.goalId || issue.goalRevision !== set.goalRevision) {
      throw new DomainInvariantError('Pending Issue Set contains another Goal revision');
    }
    if (previousId !== undefined && issue.id <= previousId) {
      throw new DomainInvariantError('Pending Issue Set must be uniquely ordered by issue ID');
    }
    previousId = issue.id;
  }
}

export function assertAcceptanceInputManifestInvariant(manifest: AcceptanceInputManifest): void {
  if (!hasExactValue(manifest.schemaVersion, 1)) {
    throw new DomainInvariantError('Acceptance Input Manifest schema version is unsupported');
  }
  goalId(manifest.goalId);
  goalRevision(manifest.goalRevision);
  workflowId(manifest.workflowId);
  workflowVersion(manifest.workflowVersion);
  if (!hasExactValue(manifest.phase, WorkflowPhase.FINAL_VERIFY)) {
    throw new DomainInvariantError('Acceptance Input Manifest phase must be FINAL_VERIFY');
  }
  sha256Digest(manifest.factSnapshotDigest);
  sha256Digest(manifest.decisionSetDigest);
  sha256Digest(manifest.scenarioSetDigest);
  candidateGenerationId(manifest.candidateGenerationId);
  sha256Digest(manifest.candidateDigest);
  sha256Digest(manifest.evidenceSetDigest);
  sha256Digest(manifest.pendingIssueSetDigest);
  policyBundleId(manifest.policyBundleId);
  sha256Digest(manifest.policyBundleDigest);
  isoTimestamp(manifest.createdAt);
  sha256Digest(manifest.manifestDigest);
}

export function assertRuleResultInvariant(result: RuleResult): void {
  assertNonBlank(result.ruleId, 'Acceptance rule ID');
  assertNonBlank(result.ruleVersion, 'Acceptance rule version');
  assertKnown(RuleApplicability, result.applicability, 'Acceptance rule applicability');
  assertKnown(RuleOutcome, result.outcome, 'Acceptance rule outcome');
  assertNonBlank(result.reasonCode, 'Acceptance rule reason code');
  assertNonBlank(result.message, 'Acceptance rule message');
  assertUniqueNonBlank(result.inputRefs, 'Acceptance rule input reference');
  assertUniqueNonBlank(result.evidenceRefs, 'Acceptance rule Evidence reference');
  sha256Digest(result.checkerDigest);
  if (
    (result.applicability === RuleApplicability.NOT_APPLICABLE) !==
    (result.outcome === RuleOutcome.NOT_APPLICABLE_WITH_REASON)
  ) {
    throw new DomainInvariantError(
      'Acceptance rule applicability must agree with NOT_APPLICABLE outcome',
    );
  }
}

function outcomePriority(outcome: RuleOutcome): number {
  switch (outcome) {
    case RuleOutcome.ENGINE_ERROR:
      return 5;
    case RuleOutcome.FAIL_BLOCKED:
      return 4;
    case RuleOutcome.NEEDS_DECISION:
      return 3;
    case RuleOutcome.FAIL_REPAIRABLE:
      return 2;
    case RuleOutcome.PASS:
    case RuleOutcome.NOT_APPLICABLE_WITH_REASON:
      return 1;
  }
}

export function aggregateAcceptanceOutcome(ruleResults: readonly RuleResult[]): AcceptanceOutcome {
  if (ruleResults.length === 0) {
    throw new DomainInvariantError('Acceptance Decision requires at least one Rule Result');
  }
  const dominant = ruleResults.reduce((current, candidate) =>
    outcomePriority(candidate.outcome) > outcomePriority(current.outcome) ? candidate : current,
  );
  switch (dominant.outcome) {
    case RuleOutcome.ENGINE_ERROR:
      return AcceptanceOutcome.ENGINE_ERROR;
    case RuleOutcome.FAIL_BLOCKED:
      return AcceptanceOutcome.REJECT_BLOCKED;
    case RuleOutcome.NEEDS_DECISION:
      return AcceptanceOutcome.NEEDS_DECISION;
    case RuleOutcome.FAIL_REPAIRABLE:
      return AcceptanceOutcome.REJECT_REPAIRABLE;
    case RuleOutcome.PASS:
    case RuleOutcome.NOT_APPLICABLE_WITH_REASON:
      if (!ruleResults.some((result) => result.outcome === RuleOutcome.PASS)) {
        throw new DomainInvariantError('Acceptance cannot pass with no applicable passing rule');
      }
      return AcceptanceOutcome.ACCEPT;
  }
}

export function dominantAcceptanceReasonCode(ruleResults: readonly RuleResult[]): string {
  const outcome = aggregateAcceptanceOutcome(ruleResults);
  if (outcome === AcceptanceOutcome.ACCEPT) {
    return 'ALL_APPLICABLE_RULES_PASSED';
  }
  const expectedPriority = Math.max(
    ...ruleResults.map((result) => outcomePriority(result.outcome)),
  );
  const dominant = ruleResults.find(
    (result) => outcomePriority(result.outcome) === expectedPriority,
  );
  if (dominant === undefined) {
    throw new DomainInvariantError('Acceptance Decision has no dominant Rule Result');
  }
  return dominant.reasonCode;
}

export function assertAcceptanceDecisionInvariant(decision: AcceptanceDecision): void {
  acceptanceDecisionId(decision.id);
  if (!hasExactValue(decision.schemaVersion, 1)) {
    throw new DomainInvariantError('Acceptance Decision schema version is unsupported');
  }
  sha256Digest(decision.inputManifestDigest);
  sha256Digest(decision.policyBundleDigest);
  assertKnown(AcceptanceOutcome, decision.outcome, 'Acceptance outcome');
  assertNonBlank(decision.dominantReasonCode, 'Acceptance dominant reason code');
  const seenRules = new Set<string>();
  for (const result of decision.ruleResults) {
    assertRuleResultInvariant(result);
    if (seenRules.has(result.ruleId)) {
      throw new DomainInvariantError('Acceptance Decision contains duplicate Rule Results');
    }
    seenRules.add(result.ruleId);
  }
  if (decision.outcome !== aggregateAcceptanceOutcome(decision.ruleResults)) {
    throw new DomainInvariantError('Acceptance Decision outcome does not match Rule Results');
  }
  if (decision.dominantReasonCode !== dominantAcceptanceReasonCode(decision.ruleResults)) {
    throw new DomainInvariantError('Acceptance dominant reason does not match Rule Results');
  }
  assertNonBlank(decision.engineVersion, 'Acceptance engine version');
  isoTimestamp(decision.issuedAt);
  sha256Digest(decision.decisionDigest);
}

export function assertCloseoutRecordInvariant(record: CloseoutRecord): void {
  if (!hasExactValue(record.schemaVersion, 1)) {
    throw new DomainInvariantError('Closeout Record schema version is unsupported');
  }
  goalId(record.goalId);
  goalRevision(record.goalRevision);
  workflowId(record.workflowId);
  workflowVersion(record.workflowVersion);
  acceptanceDecisionId(record.acceptanceDecisionId);
  sha256Digest(record.acceptanceDecisionDigest);
  sha256Digest(record.inputManifestDigest);
  candidateGenerationId(record.candidateGenerationId);
  sha256Digest(record.candidateDigest);
  sha256Digest(record.evidenceSetDigest);
  policyBundleId(record.policyBundleId);
  sha256Digest(record.policyBundleDigest);
  isoTimestamp(record.closedAt);
}

export function assertAcceptanceRepairRecordInvariant(record: AcceptanceRepairRecord): void {
  if (!hasExactValue(record.schemaVersion, 1)) {
    throw new DomainInvariantError('Acceptance Repair Record schema version is unsupported');
  }
  goalId(record.goalId);
  goalRevision(record.goalRevision);
  workflowId(record.workflowId);
  workflowVersion(record.workflowVersion);
  acceptanceDecisionId(record.acceptanceDecisionId);
  sha256Digest(record.acceptanceDecisionDigest);
  sha256Digest(record.inputManifestDigest);
  candidateGenerationId(record.rejectedCandidateGenerationId);
  aggregateVersion(record.rejectedCandidateVersion);
  sha256Digest(record.rejectedCandidateDigest);
  candidateGenerationId(record.repairCandidateGenerationId);
  if (record.rejectedCandidateGenerationId === record.repairCandidateGenerationId) {
    throw new DomainInvariantError('Acceptance repair must create a distinct Candidate generation');
  }
  if (!Number.isSafeInteger(record.repairCandidateSequence) || record.repairCandidateSequence < 2) {
    throw new DomainInvariantError('Acceptance repair Candidate sequence must be at least two');
  }
  sha256Digest(record.repairCandidateBaseDigest);
  if (record.repairCandidateBaseDigest !== record.rejectedCandidateDigest) {
    throw new DomainInvariantError(
      'Acceptance repair base must equal the rejected Candidate digest',
    );
  }
  checkSpecificationId(record.freezeCheckId);
  assertNonBlank(record.freezeCheckVersion, 'Acceptance repair freeze Check version');
  checkSpecificationId(record.verificationCheckId);
  assertNonBlank(record.verificationCheckVersion, 'Acceptance repair verification Check version');
  if (record.freezeCheckId === record.verificationCheckId) {
    throw new DomainInvariantError('Acceptance repair Checks must have distinct identities');
  }
  if (record.verificationObligationIds.length === 0) {
    throw new DomainInvariantError('Acceptance repair requires Verification Obligations');
  }
  const obligationIds = new Set<string>();
  for (const obligationId of record.verificationObligationIds) {
    verificationObligationId(obligationId);
    if (obligationIds.has(obligationId)) {
      throw new DomainInvariantError(
        'Acceptance repair Verification Obligation identities must be unique',
      );
    }
    obligationIds.add(obligationId);
  }
  sha256Digest(record.evidenceSetDigest);
  policyBundleId(record.policyBundleId);
  sha256Digest(record.policyBundleDigest);
  isoTimestamp(record.repairedAt);
  sha256Digest(record.repairDigest);
}

export type AcceptanceRepairRecordDigestFields = Omit<AcceptanceRepairRecord, 'repairDigest'>;

export function acceptanceRepairRecordProjection(
  record: AcceptanceRepairRecordDigestFields,
): unknown {
  return {
    schemaVersion: record.schemaVersion,
    goalId: record.goalId,
    goalRevision: record.goalRevision,
    workflowId: record.workflowId,
    workflowVersion: record.workflowVersion,
    acceptanceDecisionId: record.acceptanceDecisionId,
    acceptanceDecisionDigest: record.acceptanceDecisionDigest,
    inputManifestDigest: record.inputManifestDigest,
    rejectedCandidateGenerationId: record.rejectedCandidateGenerationId,
    rejectedCandidateVersion: record.rejectedCandidateVersion,
    rejectedCandidateDigest: record.rejectedCandidateDigest,
    repairCandidateGenerationId: record.repairCandidateGenerationId,
    repairCandidateSequence: record.repairCandidateSequence,
    repairCandidateBaseDigest: record.repairCandidateBaseDigest,
    freezeCheckId: record.freezeCheckId,
    freezeCheckVersion: record.freezeCheckVersion,
    verificationCheckId: record.verificationCheckId,
    verificationCheckVersion: record.verificationCheckVersion,
    verificationObligationIds: record.verificationObligationIds,
    evidenceSetDigest: record.evidenceSetDigest,
    policyBundleId: record.policyBundleId,
    policyBundleDigest: record.policyBundleDigest,
    repairedAt: record.repairedAt,
  };
}

export type AcceptanceInputManifestSemanticFields = Omit<
  AcceptanceInputManifest,
  'createdAt' | 'manifestDigest'
>;

export function acceptanceInputManifestProjection(
  manifest: AcceptanceInputManifestSemanticFields,
): unknown {
  return {
    schemaVersion: manifest.schemaVersion,
    goalId: manifest.goalId,
    goalRevision: manifest.goalRevision,
    workflowId: manifest.workflowId,
    workflowVersion: manifest.workflowVersion,
    phase: manifest.phase,
    factSnapshotDigest: manifest.factSnapshotDigest,
    decisionSetDigest: manifest.decisionSetDigest,
    scenarioSetDigest: manifest.scenarioSetDigest,
    candidateGenerationId: manifest.candidateGenerationId,
    candidateDigest: manifest.candidateDigest,
    evidenceSetDigest: manifest.evidenceSetDigest,
    pendingIssueSetDigest: manifest.pendingIssueSetDigest,
    policyBundleId: manifest.policyBundleId,
    policyBundleDigest: manifest.policyBundleDigest,
  };
}

export type AcceptanceDecisionSemanticFields = Omit<
  AcceptanceDecision,
  'id' | 'issuedAt' | 'decisionDigest'
>;

export function acceptanceDecisionProjection(decision: AcceptanceDecisionSemanticFields): unknown {
  return {
    schemaVersion: decision.schemaVersion,
    inputManifestDigest: decision.inputManifestDigest,
    policyBundleDigest: decision.policyBundleDigest,
    outcome: decision.outcome,
    dominantReasonCode: decision.dominantReasonCode,
    ruleResults: decision.ruleResults,
    engineVersion: decision.engineVersion,
  };
}

export type PendingIssueSetSemanticFields = Omit<PendingIssueSet, 'digest'>;

export function pendingIssueSetProjection(set: PendingIssueSetSemanticFields): unknown {
  return {
    schemaVersion: set.schemaVersion,
    goalId: set.goalId,
    goalRevision: set.goalRevision,
    issues: set.issues,
  };
}

export function m1EmptyFactSnapshotProjection(
  goalIdentifier: GoalId,
  revision: GoalRevision,
): unknown {
  return { schemaVersion: 1, goalId: goalIdentifier, goalRevision: revision, facts: [] };
}

export function m1EmptyDecisionSetProjection(
  goalIdentifier: GoalId,
  revision: GoalRevision,
): unknown {
  return { schemaVersion: 1, goalId: goalIdentifier, goalRevision: revision, decisions: [] };
}

export function m1ScenarioSetProjection(
  goalIdentifier: GoalId,
  revision: GoalRevision,
  scenarioRefs: readonly string[],
): unknown {
  assertUniqueNonBlank(scenarioRefs, 'M1 scenario reference');
  return {
    schemaVersion: 1,
    goalId: goalIdentifier,
    goalRevision: revision,
    scenarioRefs,
  };
}
