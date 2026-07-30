import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AcceptanceOutcome,
  CandidateGenerationState,
  EvidenceResultStatus,
  PendingIssueClassification,
  PendingIssueRepairability,
  PendingIssueSeverity,
  PendingIssueStatus,
  RuleOutcome,
  RunStatus,
  WorkflowPhase,
  acceptanceDecisionId,
  attemptId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  createGoal,
  createInitialEvidenceEligibility,
  decodeCandidateGeneration,
  decodeEvidenceObservation,
  decodePolicyBundle,
  decodeWorkflowSnapshot,
  evidenceId,
  goalId,
  goalRevision,
  isoTimestamp,
  pendingIssueId,
  policyBundleId,
  policyBundleProjection,
  successCriterionId,
  verificationObligationId,
  workflowId,
  workflowVersion,
  type EvidenceResultStatus as EvidenceResultStatusType,
  type PendingIssue,
  type PolicyBundle,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M1_ACCEPTANCE_RULES,
  buildEvidenceSet,
  compileM1AcceptanceInput,
  createM1AcceptanceCheckerIdentity,
  createM1AcceptanceEngine,
  createM1CandidateEvidencePolicy,
  createTestResultEvidenceRecord,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const createdAt = isoTimestamp('2026-07-28T01:00:00.000Z');
const frozenAt = isoTimestamp('2026-07-28T01:00:00.001Z');
const evidenceAt = isoTimestamp('2026-07-28T01:00:00.002Z');
const manifestAt = isoTimestamp('2026-07-28T01:00:00.003Z');

function policy(): PolicyBundle {
  const checker = createM1AcceptanceCheckerIdentity(digests);
  const definition = {
    id: policyBundleId('policy_m1-acceptance'),
    schemaVersion: 1 as const,
    version: 'm1-acceptance-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['source-bound-candidate-context']),
    checkSpecifications: Object.freeze(['runtime-owned-check-specifications']),
    applicabilityRules: Object.freeze(['m1-required-criteria']),
    acceptanceRules: M1_ACCEPTANCE_RULES,
    checkerVersions: Object.freeze([checker]),
  };
  return decodePolicyBundle({
    ...definition,
    digest: digests.digest(policyBundleProjection(definition)),
  });
}

function fakeObservation(
  status: Exclude<EvidenceResultStatusType, typeof EvidenceResultStatus.OBSERVED>,
  checkSpecRef: string,
) {
  return decodeEvidenceObservation({
    schemaVersion: 1,
    kind: 'FAKE_VERIFICATION',
    checkSpecRef,
    observedResult: status,
    detailCode:
      status === EvidenceResultStatus.PASS
        ? 'M1_FAKE_PASS'
        : status === EvidenceResultStatus.FAIL
          ? 'M1_FAKE_FAIL'
          : status === EvidenceResultStatus.RUNNER_ERROR
            ? 'M1_FAKE_RUNNER_ERROR'
            : 'M1_FAKE_TIMEOUT',
  });
}

function fixture(
  status: Exclude<EvidenceResultStatusType, typeof EvidenceResultStatus.OBSERVED>,
  pendingIssues: readonly PendingIssue[] = [],
  options: {
    readonly multipleCriteria?: boolean;
    readonly reverseObligations?: boolean;
  } = {},
) {
  const goal = createGoal({
    id: goalId('goal_acceptance-engine'),
    revision: goalRevision(1),
    objective: 'Prove deterministic Acceptance authority',
    successCriteria: [
      {
        id: successCriterionId('criterion_acceptance-engine'),
        description: 'Required fake verification passes',
        required: true,
      },
      ...(options.multipleCriteria === true
        ? [
            {
              id: successCriterionId('criterion_acceptance-engine-second'),
              description: 'A second required fake verification passes',
              required: true,
            },
          ]
        : []),
    ],
    scope: { projectPath: '/fixture/acceptance', allowedPaths: ['src/**'] },
    createdAt,
  });
  const generation = decodeCandidateGeneration({
    id: candidateGenerationId('generation_acceptance-engine'),
    candidateId: candidateId('candidate_acceptance-engine'),
    sequence: 1,
    workspaceIdentity: 'm1-workspace:generation_acceptance-engine',
    state: CandidateGenerationState.FROZEN,
    baseDigest: digests.digest({ base: 'acceptance-engine' }),
    frozenDigest: digests.digest({ frozen: 'acceptance-engine' }),
    version: 3,
    createdAt,
    updatedAt: frozenAt,
    frozenAt,
  });
  if (generation.state !== CandidateGenerationState.FROZEN) {
    assert.fail('Acceptance fixture must create a frozen Candidate');
  }
  const candidateDigest = generation.frozenDigest;
  const workflow = decodeWorkflowSnapshot({
    id: workflowId('workflow_acceptance-engine'),
    goalId: goal.id,
    goalRevision: goal.revision,
    phase: WorkflowPhase.FINAL_VERIFY,
    runStatus: RunStatus.READY,
    version: workflowVersion(8),
    activeCandidateGenerationId: generation.id,
    createdAt,
    updatedAt: evidenceAt,
  });
  let obligationSequence = 0;
  const candidatePolicy = createM1CandidateEvidencePolicy(
    goal,
    generation,
    {
      freeze: checkSpecificationId('check_acceptance-engine-freeze'),
      verification: checkSpecificationId('check_acceptance-engine-verification'),
    },
    {
      nextVerificationObligationId: () => {
        obligationSequence += 1;
        return verificationObligationId(`obligation_acceptance-engine-${obligationSequence}`);
      },
    },
    createdAt,
  );
  const observation = fakeObservation(
    status,
    `${candidatePolicy.verification.id}@${candidatePolicy.verification.version}`,
  );
  if (observation.kind !== 'FAKE_VERIFICATION') {
    assert.fail('Acceptance fixture must create fake verification Evidence');
  }
  const activePolicy = policy();
  const evidence = Object.freeze(
    candidatePolicy.obligations.map((obligation, index) => {
      const suffix = index === 0 ? '' : `-${index + 1}`;
      const record = createTestResultEvidenceRecord(
        {
          id: evidenceId(`evidence_acceptance-engine${suffix}`),
          goalId: goal.id,
          goalRevision: goal.revision,
          workflowId: workflow.id,
          attemptId: attemptId(`attempt_acceptance-engine${suffix}`),
          verificationObligationId: obligation.id,
          candidateGenerationId: generation.id,
          candidateDigest,
          policyBundleId: activePolicy.id,
          policyBundleDigest: activePolicy.digest,
          checkSpec: candidatePolicy.verification,
          startedAt: frozenAt,
          endedAt: evidenceAt,
          recordedAt: evidenceAt,
          observation,
        },
        digests,
      );
      return Object.freeze({
        record,
        eligibility: createInitialEvidenceEligibility(record.id, evidenceAt),
      });
    }),
  );
  const evidenceSet = buildEvidenceSet(
    {
      goalId: goal.id,
      goalRevision: goal.revision,
      candidateGenerationId: generation.id,
      candidateDigest,
      obligations: candidatePolicy.obligations,
      evidence,
    },
    digests,
  );
  const acceptanceObligations =
    options.reverseObligations === true
      ? Object.freeze([...candidatePolicy.obligations].reverse())
      : candidatePolicy.obligations;
  const input = compileM1AcceptanceInput(
    {
      goal,
      workflow,
      generation,
      freezeCheck: candidatePolicy.freeze,
      verificationCheck: candidatePolicy.verification,
      obligations: acceptanceObligations,
      evidenceSet,
      currentEvidence: evidence,
      pendingIssues,
      retainedFactCount: 0,
      retainedDecisionCount: 0,
      policyBundle: activePolicy,
    },
    manifestAt,
    digests,
  );
  return { goal, generation, workflow, input };
}

void test('[I-002][I-003] exact passing M1 authority produces ACCEPT', () => {
  const { input } = fixture(EvidenceResultStatus.PASS);
  const decision = createM1AcceptanceEngine(digests).issueDecision({
    id: acceptanceDecisionId('acceptance_engine-pass'),
    issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
    input,
  });
  assert.equal(decision.outcome, AcceptanceOutcome.ACCEPT);
  assert.deepEqual(
    decision.ruleResults.map((result) => result.ruleId),
    M1_ACCEPTANCE_RULES,
  );
  assert.equal(decision.dominantReasonCode, 'ALL_APPLICABLE_RULES_PASSED');
  assert.deepEqual(
    {
      manifestDigest: input.manifest.manifestDigest,
      decisionDigest: decision.decisionDigest,
    },
    {
      manifestDigest: 'sha256:2773729b58689f0dbbbb1a6decc133824ea5427e02eb07815efb1f759c26de54',
      decisionDigest: 'sha256:3952e68dde6eb5e062c4e12e4d5c0285a9004b731297205f9174452b800d104b',
    },
  );
});

void test('[I-002][I-006] obligation identifier order cannot change Acceptance semantics', () => {
  const ordered = fixture(EvidenceResultStatus.PASS, [], { multipleCriteria: true });
  const reversed = fixture(EvidenceResultStatus.PASS, [], {
    multipleCriteria: true,
    reverseObligations: true,
  });
  assert.deepEqual(
    reversed.input.authority.obligations.map((obligation) => obligation.sourceCriterionRefs[0]),
    ordered.input.authority.obligations.map((obligation) => obligation.sourceCriterionRefs[0]),
  );
  assert.equal(reversed.input.manifest.scenarioSetDigest, ordered.input.manifest.scenarioSetDigest);
  assert.equal(reversed.input.manifest.manifestDigest, ordered.input.manifest.manifestDigest);
  const reversedDecision = createM1AcceptanceEngine(digests).issueDecision({
    id: acceptanceDecisionId('acceptance_engine-reversed-obligations'),
    issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
    input: reversed.input,
  });
  assert.equal(reversedDecision.outcome, AcceptanceOutcome.ACCEPT);
});

void test('[I-003][I-009] multiple Evidence records use strict result aggregation, not row count', () => {
  for (const current of [
    { status: EvidenceResultStatus.PASS, expected: AcceptanceOutcome.ACCEPT },
    { status: EvidenceResultStatus.FAIL, expected: AcceptanceOutcome.REJECT_REPAIRABLE },
  ] as const) {
    const { input } = fixture(EvidenceResultStatus.PASS);
    const obligation = input.authority.obligations[0];
    assert.ok(obligation);
    const suffix = current.status.toLowerCase();
    const observation = fakeObservation(
      current.status,
      `${input.authority.verificationCheck.id}@${input.authority.verificationCheck.version}`,
    );
    if (observation.kind !== 'FAKE_VERIFICATION') {
      assert.fail('Additional Acceptance Evidence must use fake verification');
    }
    const record = createTestResultEvidenceRecord(
      {
        id: evidenceId(`evidence_acceptance-engine-additional-${suffix}`),
        goalId: input.authority.goal.id,
        goalRevision: input.authority.goal.revision,
        workflowId: input.authority.workflow.id,
        attemptId: attemptId(`attempt_acceptance-engine-additional-${suffix}`),
        verificationObligationId: obligation.id,
        candidateGenerationId: input.authority.generation.id,
        candidateDigest: input.manifest.candidateDigest,
        policyBundleId: input.authority.policyBundle.id,
        policyBundleDigest: input.authority.policyBundle.digest,
        checkSpec: input.authority.verificationCheck,
        startedAt: frozenAt,
        endedAt: evidenceAt,
        recordedAt: evidenceAt,
        observation,
      },
      digests,
    );
    const currentEvidence = Object.freeze([
      ...input.authority.currentEvidence,
      Object.freeze({
        record,
        eligibility: createInitialEvidenceEligibility(record.id, evidenceAt),
      }),
    ]);
    const evidenceSet = buildEvidenceSet(
      {
        goalId: input.authority.goal.id,
        goalRevision: input.authority.goal.revision,
        candidateGenerationId: input.authority.generation.id,
        candidateDigest: input.manifest.candidateDigest,
        obligations: input.authority.obligations,
        evidence: currentEvidence,
      },
      digests,
    );
    const compiled = compileM1AcceptanceInput(
      { ...input.authority, evidenceSet, currentEvidence },
      manifestAt,
      digests,
    );
    const decision = createM1AcceptanceEngine(digests).issueDecision({
      id: acceptanceDecisionId(`acceptance_engine-additional-${suffix}`),
      issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
      input: compiled,
    });
    assert.equal(decision.outcome, current.expected);
  }
});

void test('[I-006][I-008] Acceptance manifest time cannot predate retained authority', () => {
  const { input } = fixture(EvidenceResultStatus.PASS);
  assert.throws(
    () => compileM1AcceptanceInput(input.authority, createdAt, digests),
    /cannot predate its retained authority/,
  );
});

void test('[I-026] retained or generic Human approval cannot bypass M1 Acceptance evidence', () => {
  const { input } = fixture(EvidenceResultStatus.PASS);
  assert.throws(
    () =>
      compileM1AcceptanceInput(
        { ...input.authority, retainedDecisionCount: 1 },
        manifestAt,
        digests,
      ),
    /cannot interpret retained Fact or Human Decision rows/u,
  );
});

void test('[I-013][I-016] failing fake Evidence produces a repairable rejection', () => {
  const { input } = fixture(EvidenceResultStatus.FAIL);
  const decision = createM1AcceptanceEngine(digests).issueDecision({
    id: acceptanceDecisionId('acceptance_engine-fail'),
    issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
    input,
  });
  assert.equal(decision.outcome, AcceptanceOutcome.REJECT_REPAIRABLE);
  assert.equal(decision.dominantReasonCode, 'REQUIRED_EVIDENCE_FAILED_REPAIRABLE');
});

void test('[I-027] runner error and timeout fail as ENGINE_ERROR', () => {
  for (const status of [EvidenceResultStatus.RUNNER_ERROR, EvidenceResultStatus.TIMEOUT] as const) {
    const { input } = fixture(status);
    const decision = createM1AcceptanceEngine(digests).issueDecision({
      id: acceptanceDecisionId(`acceptance_engine-${status.toLowerCase().replaceAll('_', '-')}`),
      issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
      input,
    });
    assert.equal(decision.outcome, AcceptanceOutcome.ENGINE_ERROR);
  }
});

void test('[I-017] a current blocking issue prevents ACCEPT', () => {
  const issue: PendingIssue = Object.freeze({
    id: pendingIssueId('issue_acceptance-engine'),
    goalId: goalId('goal_acceptance-engine'),
    goalRevision: goalRevision(1),
    candidateGenerationId: candidateGenerationId('generation_acceptance-engine'),
    classification: PendingIssueClassification.TECHNICAL_FINDING,
    severity: PendingIssueSeverity.BLOCKING,
    description: 'A blocking technical finding remains',
    sourceRefs: Object.freeze(['test:pending-issue']),
    repairability: PendingIssueRepairability.BLOCKED,
    status: PendingIssueStatus.OPEN,
    createdAt,
  });
  const { input } = fixture(EvidenceResultStatus.PASS, [issue]);
  const decision = createM1AcceptanceEngine(digests).issueDecision({
    id: acceptanceDecisionId('acceptance_engine-blocked'),
    issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
    input,
  });
  assert.equal(decision.outcome, AcceptanceOutcome.REJECT_BLOCKED);
  assert.equal(decision.dominantReasonCode, 'BLOCKING_PENDING_ISSUE');
});

void test('[I-017][I-027] blocking issue repairability maps to one closed outcome', () => {
  const cases = Object.freeze([
    {
      repairability: PendingIssueRepairability.REPAIRABLE,
      classification: PendingIssueClassification.TECHNICAL_FINDING,
      outcome: AcceptanceOutcome.REJECT_REPAIRABLE,
      reason: 'REPAIRABLE_PENDING_ISSUE',
    },
    {
      repairability: PendingIssueRepairability.BLOCKED,
      classification: PendingIssueClassification.EXTERNAL_DEPENDENCY,
      outcome: AcceptanceOutcome.REJECT_BLOCKED,
      reason: 'BLOCKING_PENDING_ISSUE',
    },
    {
      repairability: PendingIssueRepairability.NEEDS_DECISION,
      classification: PendingIssueClassification.DECISION_REQUIRED,
      outcome: AcceptanceOutcome.NEEDS_DECISION,
      reason: 'PENDING_ISSUE_NEEDS_DECISION',
    },
  ]);
  for (const current of cases) {
    const issue: PendingIssue = Object.freeze({
      id: pendingIssueId(
        `issue_acceptance-engine-${current.repairability.toLowerCase().replaceAll('_', '-')}`,
      ),
      goalId: goalId('goal_acceptance-engine'),
      goalRevision: goalRevision(1),
      candidateGenerationId: candidateGenerationId('generation_acceptance-engine'),
      classification: current.classification,
      severity: PendingIssueSeverity.BLOCKING,
      description: 'Exercise one closed Pending Issue outcome',
      sourceRefs: Object.freeze(['test:pending-issue-outcome']),
      repairability: current.repairability,
      status: PendingIssueStatus.OPEN,
      createdAt,
    });
    const { input } = fixture(EvidenceResultStatus.PASS, [issue]);
    const decision = createM1AcceptanceEngine(digests).issueDecision({
      id: acceptanceDecisionId(
        `acceptance_engine-${current.repairability.toLowerCase().replaceAll('_', '-')}`,
      ),
      issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
      input,
    });
    assert.equal(decision.outcome, current.outcome);
    assert.equal(decision.dominantReasonCode, current.reason);
  }
});

void test('[I-027] a built-in rule fault emits one ordered ENGINE_ERROR result set', () => {
  const { input } = fixture(EvidenceResultStatus.PASS);
  const explosiveGoal = Object.defineProperty({ ...input.authority.goal }, 'successCriteria', {
    enumerable: true,
    get: () => {
      throw new Error('injected built-in rule fault');
    },
  });
  const faultedInput = Object.freeze({
    ...input,
    authority: Object.freeze({ ...input.authority, goal: explosiveGoal }),
  });
  const decision = createM1AcceptanceEngine(digests).issueDecision({
    id: acceptanceDecisionId('acceptance_engine-rule-fault'),
    issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
    input: faultedInput,
  });
  assert.equal(decision.outcome, AcceptanceOutcome.ENGINE_ERROR);
  assert.deepEqual(
    decision.ruleResults.map(({ ruleId, outcome, reasonCode }) => ({
      ruleId,
      outcome,
      reasonCode,
    })),
    M1_ACCEPTANCE_RULES.map((ruleId) => ({
      ruleId,
      outcome: RuleOutcome.ENGINE_ERROR,
      reasonCode: 'ACCEPTANCE_RULE_EVALUATION_ERROR',
    })),
  );
});

void test('[I-003][I-027] an incomplete Acceptance policy cannot issue a decision', () => {
  const { input } = fixture(EvidenceResultStatus.PASS);
  const incompleteDefinition = Object.freeze({
    id: input.authority.policyBundle.id,
    schemaVersion: 1 as const,
    version: input.authority.policyBundle.version,
    transitionRules: input.authority.policyBundle.transitionRules,
    capabilityRules: input.authority.policyBundle.capabilityRules,
    contextRules: input.authority.policyBundle.contextRules,
    checkSpecifications: input.authority.policyBundle.checkSpecifications,
    applicabilityRules: input.authority.policyBundle.applicabilityRules,
    acceptanceRules: Object.freeze(M1_ACCEPTANCE_RULES.slice(0, -1)),
    checkerVersions: input.authority.policyBundle.checkerVersions,
  });
  const incompletePolicy = decodePolicyBundle({
    ...incompleteDefinition,
    digest: digests.digest(policyBundleProjection(incompleteDefinition)),
  });
  const incompleteInput = Object.freeze({
    ...input,
    authority: Object.freeze({ ...input.authority, policyBundle: incompletePolicy }),
  });
  assert.throws(
    () =>
      createM1AcceptanceEngine(digests).issueDecision({
        id: acceptanceDecisionId('acceptance_engine-incomplete-policy'),
        issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
        input: incompleteInput,
      }),
    /exact ordered M1 Acceptance rules/,
  );
});

void test('[I-002][I-030] semantic replay keeps one decision digest', () => {
  const { input } = fixture(EvidenceResultStatus.PASS);
  const engine = createM1AcceptanceEngine(digests);
  const first = engine.issueDecision({
    id: acceptanceDecisionId('acceptance_engine-replay-first'),
    issuedAt: isoTimestamp('2026-07-28T01:00:00.004Z'),
    input,
  });
  const second = engine.issueDecision({
    id: acceptanceDecisionId('acceptance_engine-replay-second'),
    issuedAt: isoTimestamp('2026-07-28T01:00:00.005Z'),
    input,
  });
  assert.notEqual(first.id, second.id);
  assert.notEqual(first.issuedAt, second.issuedAt);
  assert.equal(first.decisionDigest, second.decisionDigest);
});
