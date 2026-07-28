import {
  CandidateGenerationState,
  EvidenceEligibilityState,
  EvidenceKind,
  EvidenceResultStatus,
  PendingIssueRepairability,
  PendingIssueSeverity,
  PendingIssueStatus,
  RuleApplicability,
  RuleOutcome,
  WorkflowPhase,
  acceptanceInputManifestProjection,
  decodeAcceptanceInputManifest,
  decodePendingIssue,
  decodePendingIssueSet,
  m1EmptyDecisionSetProjection,
  m1EmptyFactSnapshotProjection,
  m1ScenarioSetProjection,
  pendingIssueSetProjection,
  sha256Digest,
  type AcceptanceInputManifest,
  type CandidateGeneration,
  type CheckSpecification,
  type EvidenceEligibility,
  type EvidenceRecord,
  type EvidenceSet,
  type Goal,
  type IsoTimestamp,
  type PendingIssue,
  type PendingIssueSet,
  type PolicyBundle,
  type PolicyCheckerIdentity,
  type RuleResult,
  type VerificationObligation,
  type WorkflowInstance,
} from '@codeclosure/domain';

import { validateM1CandidateEvidencePolicy } from './candidate-evidence-policy.js';
import { verifyEvidenceSetAuthority } from './evidence-factory.js';
import type { DigestProvider } from './ports.js';

export const M1AcceptanceRuleId = {
  WORKFLOW_FINAL_VERIFY: 'm1.workflow-final-verify.v1',
  GOAL_REVISION_CURRENT: 'm1.goal-revision-current.v1',
  CANDIDATE_CURRENT_FROZEN: 'm1.candidate-current-frozen.v1',
  CANDIDATE_DIGEST_CURRENT: 'm1.candidate-digest-current.v1',
  REQUIRED_OBLIGATIONS_PRESENT: 'm1.required-obligations-present.v1',
  REQUIRED_EVIDENCE_PASSING: 'm1.required-evidence-passing.v1',
  PENDING_ISSUES_CLEAR: 'm1.pending-issues-clear.v1',
  MANIFEST_POLICY_CURRENT: 'm1.manifest-policy-current.v1',
} as const;
export type M1AcceptanceRuleId = (typeof M1AcceptanceRuleId)[keyof typeof M1AcceptanceRuleId];

export const M1_ACCEPTANCE_RULES: readonly M1AcceptanceRuleId[] = Object.freeze([
  M1AcceptanceRuleId.WORKFLOW_FINAL_VERIFY,
  M1AcceptanceRuleId.GOAL_REVISION_CURRENT,
  M1AcceptanceRuleId.CANDIDATE_CURRENT_FROZEN,
  M1AcceptanceRuleId.CANDIDATE_DIGEST_CURRENT,
  M1AcceptanceRuleId.REQUIRED_OBLIGATIONS_PRESENT,
  M1AcceptanceRuleId.REQUIRED_EVIDENCE_PASSING,
  M1AcceptanceRuleId.PENDING_ISSUES_CLEAR,
  M1AcceptanceRuleId.MANIFEST_POLICY_CURRENT,
]);

export const M1_ACCEPTANCE_CHECKER_ID = 'codeclosure.m1.acceptance';
export const M1_ACCEPTANCE_CHECKER_VERSION = 'm1.1';
export const M1_ACCEPTANCE_ENGINE_VERSION = 'm1.1';

export interface M1AcceptanceEvidenceAuthority {
  readonly record: EvidenceRecord;
  readonly eligibility: EvidenceEligibility;
}

export interface M1AcceptanceAuthority {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly generation: CandidateGeneration;
  readonly freezeCheck: CheckSpecification;
  readonly verificationCheck: CheckSpecification;
  readonly obligations: readonly VerificationObligation[];
  readonly evidenceSet: EvidenceSet;
  readonly currentEvidence: readonly M1AcceptanceEvidenceAuthority[];
  readonly pendingIssues: readonly PendingIssue[];
  readonly retainedFactCount: number;
  readonly retainedDecisionCount: number;
  readonly policyBundle: PolicyBundle;
}

export interface CompiledM1AcceptanceInput {
  readonly manifest: AcceptanceInputManifest;
  readonly pendingIssueSet: PendingIssueSet;
  readonly authority: M1AcceptanceAuthority;
}

function exactValues(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function checkerProjection(): unknown {
  return {
    schemaVersion: 1,
    checkerId: M1_ACCEPTANCE_CHECKER_ID,
    checkerVersion: M1_ACCEPTANCE_CHECKER_VERSION,
    engineVersion: M1_ACCEPTANCE_ENGINE_VERSION,
    orderedRules: M1_ACCEPTANCE_RULES,
    aggregation: [
      RuleOutcome.ENGINE_ERROR,
      RuleOutcome.FAIL_BLOCKED,
      RuleOutcome.NEEDS_DECISION,
      RuleOutcome.FAIL_REPAIRABLE,
      RuleOutcome.PASS,
    ],
  };
}

export function createM1AcceptanceCheckerIdentity(digests: DigestProvider): PolicyCheckerIdentity {
  return Object.freeze({
    checkerId: M1_ACCEPTANCE_CHECKER_ID,
    checkerVersion: M1_ACCEPTANCE_CHECKER_VERSION,
    checkerDigest: sha256Digest(digests.digest(checkerProjection())),
  });
}

export function validateM1AcceptancePolicyBundle(
  bundle: PolicyBundle,
  digests: DigestProvider,
): PolicyCheckerIdentity {
  if (!exactValues(bundle.acceptanceRules, M1_ACCEPTANCE_RULES)) {
    throw new TypeError('Policy Bundle does not contain the exact ordered M1 Acceptance rules');
  }
  const expected = createM1AcceptanceCheckerIdentity(digests);
  if (
    bundle.checkerVersions.length !== 1 ||
    bundle.checkerVersions[0]?.checkerId !== expected.checkerId ||
    bundle.checkerVersions[0].checkerVersion !== expected.checkerVersion ||
    bundle.checkerVersions[0].checkerDigest !== expected.checkerDigest
  ) {
    throw new TypeError('Policy Bundle does not bind the exact M1 Acceptance checker');
  }
  return expected;
}

function assertSafeCount(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

export function buildPendingIssueSet(
  goal: Goal,
  rawIssues: readonly PendingIssue[],
  digests: DigestProvider,
): PendingIssueSet {
  const issues = Object.freeze(
    rawIssues
      .map((issue) => decodePendingIssue(issue))
      .sort((left, right) => (left.id < right.id ? -1 : left.id > right.id ? 1 : 0)),
  );
  if (issues.some((issue) => issue.goalId !== goal.id || issue.goalRevision !== goal.revision)) {
    throw new TypeError('Pending Issue Set contains another Goal revision');
  }
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    goalId: goal.id,
    goalRevision: goal.revision,
    issues,
  });
  return decodePendingIssueSet({
    ...withoutDigest,
    digest: digests.digest(pendingIssueSetProjection(withoutDigest)),
  });
}

function orderedScenarioRefs(obligations: readonly VerificationObligation[]): readonly string[] {
  const seen = new Set<string>();
  const refs: string[] = [];
  for (const obligation of obligations) {
    for (const reference of obligation.scenarioRefs) {
      if (!seen.has(reference)) {
        seen.add(reference);
        refs.push(reference);
      }
    }
  }
  return Object.freeze(refs);
}

export function compileM1AcceptanceInput(
  rawAuthority: M1AcceptanceAuthority,
  createdAt: IsoTimestamp,
  digests: DigestProvider,
): CompiledM1AcceptanceInput {
  const authority = Object.freeze({
    ...rawAuthority,
    obligations: Object.freeze([...rawAuthority.obligations]),
    currentEvidence: Object.freeze([...rawAuthority.currentEvidence]),
    pendingIssues: Object.freeze([...rawAuthority.pendingIssues]),
  });
  assertSafeCount(authority.retainedFactCount, 'Retained Fact count');
  assertSafeCount(authority.retainedDecisionCount, 'Retained Decision count');
  if (authority.retainedFactCount !== 0 || authority.retainedDecisionCount !== 0) {
    throw new TypeError('M1 Acceptance cannot interpret retained Fact or Human Decision rows');
  }
  const causalFloors = [
    authority.workflow.updatedAt,
    authority.generation.updatedAt,
    ...authority.obligations.map((obligation) => obligation.createdAt),
    ...authority.currentEvidence.flatMap(({ record, eligibility }) => [
      record.recordedAt,
      eligibility.changedAt,
    ]),
    ...authority.pendingIssues.flatMap((issue) => [
      issue.createdAt,
      ...(issue.resolvedAt === undefined ? [] : [issue.resolvedAt]),
    ]),
  ];
  if (causalFloors.some((floor) => createdAt < floor)) {
    throw new TypeError('Acceptance Input Manifest cannot predate its retained authority');
  }
  if (
    authority.workflow.goalId !== authority.goal.id ||
    authority.workflow.goalRevision !== authority.goal.revision ||
    authority.workflow.phase !== WorkflowPhase.FINAL_VERIFY ||
    authority.workflow.activeCandidateGenerationId !== authority.generation.id ||
    authority.generation.state !== CandidateGenerationState.FROZEN ||
    authority.evidenceSet.goalId !== authority.goal.id ||
    authority.evidenceSet.goalRevision !== authority.goal.revision ||
    authority.evidenceSet.candidateGenerationId !== authority.generation.id ||
    authority.evidenceSet.candidateDigest !== authority.generation.frozenDigest
  ) {
    throw new TypeError('M1 Acceptance authority does not describe one FINAL_VERIFY Candidate');
  }
  const candidateDigest = authority.generation.frozenDigest;
  const candidatePolicy = validateM1CandidateEvidencePolicy(
    authority.goal,
    authority.generation,
    {
      freeze: authority.freezeCheck,
      verification: authority.verificationCheck,
      obligations: authority.obligations,
    },
    authority.generation.createdAt,
  );
  const evidenceSet = verifyEvidenceSetAuthority(
    authority.evidenceSet,
    candidatePolicy.obligations,
    authority.currentEvidence,
    digests,
  );
  const normalizedAuthority = Object.freeze({
    ...authority,
    freezeCheck: candidatePolicy.freeze,
    verificationCheck: candidatePolicy.verification,
    obligations: candidatePolicy.obligations,
    evidenceSet,
  });
  validateM1AcceptancePolicyBundle(normalizedAuthority.policyBundle, digests);
  const pendingIssueSet = buildPendingIssueSet(
    normalizedAuthority.goal,
    normalizedAuthority.pendingIssues,
    digests,
  );
  const factSnapshotDigest = sha256Digest(
    digests.digest(
      m1EmptyFactSnapshotProjection(normalizedAuthority.goal.id, normalizedAuthority.goal.revision),
    ),
  );
  const decisionSetDigest = sha256Digest(
    digests.digest(
      m1EmptyDecisionSetProjection(normalizedAuthority.goal.id, normalizedAuthority.goal.revision),
    ),
  );
  const scenarioSetDigest = sha256Digest(
    digests.digest(
      m1ScenarioSetProjection(
        normalizedAuthority.goal.id,
        normalizedAuthority.goal.revision,
        orderedScenarioRefs(normalizedAuthority.obligations),
      ),
    ),
  );
  const manifestBase = Object.freeze({
    schemaVersion: 1 as const,
    goalId: normalizedAuthority.goal.id,
    goalRevision: normalizedAuthority.goal.revision,
    workflowId: normalizedAuthority.workflow.id,
    workflowVersion: normalizedAuthority.workflow.version,
    phase: WorkflowPhase.FINAL_VERIFY,
    factSnapshotDigest,
    decisionSetDigest,
    scenarioSetDigest,
    candidateGenerationId: normalizedAuthority.generation.id,
    candidateDigest,
    evidenceSetDigest: normalizedAuthority.evidenceSet.digest,
    pendingIssueSetDigest: pendingIssueSet.digest,
    policyBundleId: normalizedAuthority.policyBundle.id,
    policyBundleDigest: normalizedAuthority.policyBundle.digest,
    createdAt,
  });
  const manifest = decodeAcceptanceInputManifest({
    ...manifestBase,
    manifestDigest: digests.digest(acceptanceInputManifestProjection(manifestBase)),
  });
  return Object.freeze({ manifest, pendingIssueSet, authority: normalizedAuthority });
}

export function currentBlockingIssues(input: CompiledM1AcceptanceInput): readonly PendingIssue[] {
  return Object.freeze(
    input.pendingIssueSet.issues.filter(
      (issue) =>
        issue.status === PendingIssueStatus.OPEN &&
        issue.severity === PendingIssueSeverity.BLOCKING &&
        (issue.candidateGenerationId === undefined ||
          issue.candidateGenerationId === input.manifest.candidateGenerationId),
    ),
  );
}

export function pendingIssueRuleOutcome(issues: readonly PendingIssue[]): RuleOutcome {
  if (issues.length === 0) {
    return RuleOutcome.PASS;
  }
  if (issues.some((issue) => issue.repairability === PendingIssueRepairability.BLOCKED)) {
    return RuleOutcome.FAIL_BLOCKED;
  }
  if (issues.some((issue) => issue.repairability === PendingIssueRepairability.NEEDS_DECISION)) {
    return RuleOutcome.NEEDS_DECISION;
  }
  return RuleOutcome.FAIL_REPAIRABLE;
}

export function evidenceRuleOutcome(input: CompiledM1AcceptanceInput): RuleOutcome {
  const authorityById = new Map(
    input.authority.currentEvidence.map((entry) => [entry.record.id, entry] as const),
  );
  const selectedRefs = input.authority.evidenceSet.evidenceRefs;
  const selected = selectedRefs.map((reference) => {
    const entry = authorityById.get(reference.evidenceId);
    if (
      entry?.record.recordDigest !== reference.evidenceRecordDigest ||
      entry.eligibility.version !== reference.eligibilityVersion ||
      entry.eligibility.state !== reference.eligibilityState
    ) {
      return undefined;
    }
    return entry;
  });
  if (
    selected.length === 0 ||
    selected.some((entry) => entry?.eligibility.state !== EvidenceEligibilityState.ELIGIBLE)
  ) {
    return RuleOutcome.FAIL_BLOCKED;
  }
  const results = input.authority.obligations.flatMap((obligation) => {
    const mapping = input.authority.evidenceSet.obligationMappings.find(
      (candidate) => candidate.obligationId === obligation.id,
    );
    if (mapping === undefined || mapping.evidenceIds.length === 0) {
      return [undefined];
    }
    return mapping.evidenceIds.map((identifier) => {
      const entry = authorityById.get(identifier);
      if (
        entry?.eligibility.state !== EvidenceEligibilityState.ELIGIBLE ||
        entry.record.kind !== EvidenceKind.TEST_RESULT ||
        entry.record.verificationObligationId !== obligation.id ||
        entry.record.candidateDigest !== input.manifest.candidateDigest
      ) {
        return undefined;
      }
      return entry.record.resultStatus;
    });
  });
  if (results.some((status) => status === undefined)) {
    return RuleOutcome.FAIL_BLOCKED;
  }
  if (
    results.some(
      (status) =>
        status === EvidenceResultStatus.RUNNER_ERROR || status === EvidenceResultStatus.TIMEOUT,
    )
  ) {
    return RuleOutcome.ENGINE_ERROR;
  }
  if (results.some((status) => status === EvidenceResultStatus.FAIL)) {
    return RuleOutcome.FAIL_REPAIRABLE;
  }
  return results.every((status) => status === EvidenceResultStatus.PASS)
    ? RuleOutcome.PASS
    : RuleOutcome.FAIL_BLOCKED;
}

export function m1RuleResult(
  ruleId: M1AcceptanceRuleId,
  outcome: RuleOutcome,
  reasonCode: string,
  message: string,
  inputRefs: readonly string[],
  evidenceRefs: readonly string[],
  checkerDigest: PolicyCheckerIdentity['checkerDigest'],
): RuleResult {
  return Object.freeze({
    ruleId,
    ruleVersion: '1',
    applicability: RuleApplicability.APPLICABLE,
    outcome,
    reasonCode,
    message,
    inputRefs: Object.freeze([...inputRefs]),
    evidenceRefs: Object.freeze([...evidenceRefs]),
    checkerDigest,
  });
}
