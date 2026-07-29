import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CandidateGenerationState,
  WorkflowPhase,
  acceptanceDecisionId,
  aggregateVersion,
  assertGoalInvariant,
  attemptId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  commandId,
  createGoal,
  createWorkflow,
  decodeAttemptSnapshot,
  decodeAcceptanceRepairRecord,
  decodeCandidateGeneration,
  decodeExecutionProfile,
  decodeExecutionProfileBinding,
  decodeExecutionProfileDefinition,
  decodeGoalSnapshot,
  decodePolicyBundleDefinition,
  decodeWorkflowPolicyBinding,
  decodeWorkflowSnapshot,
  decideAttempt,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  successCriterionId,
  verificationObligationId,
  workerSessionId,
  workflowId,
  workflowVersion,
} from '@codeclosure/domain';

const createdAt = isoTimestamp('2026-07-27T03:00:00.000Z');
const goal = createGoal({
  id: goalId('goal_codec-contract'),
  revision: goalRevision(1),
  objective: 'Prove authority codecs are closed',
  successCriteria: [
    {
      id: successCriterionId('criterion_codec-contract'),
      description: 'Malformed authority is rejected',
      required: true,
    },
  ],
  scope: { projectPath: '/fixture/codec', allowedPaths: ['src/**'] },
  nonGoals: ['Do not trust erased types'],
  createdAt,
});
const workflow = createWorkflow({
  id: workflowId('workflow_codec-contract'),
  goalId: goal.id,
  goalRevision: goal.revision,
  createdAt,
});
const beginDecision = decideAttempt(workflow, undefined, {
  type: 'BEGIN_ATTEMPT',
  commandId: commandId('command_codec-attempt'),
  workflowId: workflow.id,
  expectedWorkflowVersion: workflow.version,
  attemptId: attemptId('attempt_codec-contract'),
  sequence: 1,
  occurredAt: createdAt,
});
if (!beginDecision.accepted || beginDecision.events[0].type !== 'ATTEMPT_STARTED') {
  throw new Error('Codec fixture could not create a running Attempt');
}
const attempt = beginDecision.events[0].attempt;
const candidate = {
  id: candidateGenerationId('generation_codec-contract'),
  candidateId: candidateId('candidate_codec-contract'),
  sequence: 1,
  workspaceIdentity: 'fixture://codec/candidate',
  state: CandidateGenerationState.MUTABLE,
  baseDigest: sha256Digest(`sha256:${'a'.repeat(64)}`),
  version: aggregateVersion(1),
  createdAt,
  updatedAt: createdAt,
};
const policyDefinition = {
  id: policyBundleId('policy_codec-contract'),
  schemaVersion: 1,
  version: 'codec-v1',
  transitionRules: ['workflow-runtime-only'],
  capabilityRules: ['phase-derived-capabilities'],
  contextRules: ['durable-source-authority-only'],
  checkSpecifications: [],
  applicabilityRules: [],
  acceptanceRules: ['acceptance-engine-only'],
  checkerVersions: [],
} as const;
const executionProfileDefinition = {
  id: executionProfileId('profile_codec-contract'),
  schemaVersion: 1,
  version: 'codec-profile-v1',
  workerAdapter: 'fake-worker',
  workerAdapterVersion: 'v1',
  candidateSource: 'fake-candidate-source',
  candidateSourceVersion: 'v1',
  verificationRunner: 'fake-verification-runner',
  verificationRunnerVersion: 'v1',
  driverVersion: 'codec-driver-v1',
} as const;

void test('[I-006][I-027] a Goal requires at least one required success criterion', () => {
  assert.throws(
    () =>
      createGoal({
        id: goalId('goal_optional-only'),
        revision: goalRevision(1),
        objective: 'Reject a Goal with no completion boundary',
        successCriteria: [
          {
            id: successCriterionId('criterion_optional-only'),
            description: 'This criterion does not block completion',
            required: false,
          },
        ],
        scope: { projectPath: '/fixture/optional-only', allowedPaths: ['src/**'] },
        createdAt,
      }),
    /at least one required success criterion/,
  );
  assert.throws(
    () =>
      decodeGoalSnapshot({
        ...goal,
        successCriteria: goal.successCriteria.map((criterion) => ({
          ...criterion,
          required: false,
        })),
      }),
    /at least one required success criterion/,
  );
});

void test('[I-006] authority codecs materialize immutable canonical snapshots', () => {
  const decodedGoal = decodeGoalSnapshot(goal);
  const decodedWorkflow = decodeWorkflowSnapshot(workflow);
  const decodedAttempt = decodeAttemptSnapshot(attempt);
  const decodedCandidate = decodeCandidateGeneration(candidate);
  const decodedPolicyDefinition = decodePolicyBundleDefinition(policyDefinition);
  const decodedProfileDefinition = decodeExecutionProfileDefinition(executionProfileDefinition);
  const decodedProfile = decodeExecutionProfile({
    ...executionProfileDefinition,
    digest: sha256Digest(`sha256:${'7'.repeat(64)}`),
  });
  const decodedProfileBinding = decodeExecutionProfileBinding({
    schemaVersion: 1,
    goalId: goal.id,
    workflowId: workflow.id,
    profileId: decodedProfile.id,
    profileVersion: decodedProfile.version,
    profileDigest: decodedProfile.digest,
    startCommandId: commandId('command_codec-profile-binding'),
    boundAt: createdAt,
    bindingDigest: sha256Digest(`sha256:${'8'.repeat(64)}`),
  });
  const decodedPolicyBinding = decodeWorkflowPolicyBinding({
    schemaVersion: 1,
    goalId: goal.id,
    workflowId: workflow.id,
    policyBundleId: policyDefinition.id,
    policyBundleVersion: policyDefinition.version,
    policyBundleDigest: sha256Digest(`sha256:${'6'.repeat(64)}`),
    startCommandId: commandId('command_codec-policy-binding'),
    boundAt: createdAt,
    bindingDigest: sha256Digest(`sha256:${'5'.repeat(64)}`),
  });

  assert.equal(Object.isFrozen(decodedGoal), true);
  assert.equal(Object.isFrozen(decodedGoal.successCriteria), true);
  assert.equal(Object.isFrozen(decodedGoal.successCriteria[0]), true);
  assert.equal(Object.isFrozen(goal.successCriteria[0]), true);
  assert.equal(Object.isFrozen(decodedGoal.scope.allowedPaths), true);
  assert.equal(Object.isFrozen(decodedWorkflow), true);
  assert.equal(Object.isFrozen(decodedAttempt), true);
  assert.equal(Object.isFrozen(decodedAttempt.capabilityGrant.allowedActions), true);
  assert.equal(Object.isFrozen(decodedCandidate), true);
  assert.equal(Object.isFrozen(decodedPolicyDefinition), true);
  assert.equal(Object.isFrozen(decodedPolicyDefinition.transitionRules), true);
  assert.equal(Object.isFrozen(decodedProfileDefinition), true);
  assert.equal(Object.isFrozen(decodedProfile), true);
  assert.equal(Object.isFrozen(decodedProfileBinding), true);
  assert.equal(Object.isFrozen(decodedPolicyBinding), true);
});

void test('[I-006][I-013] Acceptance repair authority has one strict immutable shape', () => {
  const repair = decodeAcceptanceRepairRecord({
    schemaVersion: 1,
    goalId: goal.id,
    goalRevision: goal.revision,
    workflowId: workflow.id,
    workflowVersion: workflowVersion(2),
    acceptanceDecisionId: acceptanceDecisionId('acceptance_codec-repair'),
    acceptanceDecisionDigest: sha256Digest(`sha256:${'b'.repeat(64)}`),
    inputManifestDigest: sha256Digest(`sha256:${'c'.repeat(64)}`),
    rejectedCandidateGenerationId: candidateGenerationId('generation_codec-rejected'),
    rejectedCandidateVersion: aggregateVersion(4),
    rejectedCandidateDigest: sha256Digest(`sha256:${'d'.repeat(64)}`),
    repairCandidateGenerationId: candidateGenerationId('generation_codec-repair'),
    repairCandidateSequence: 2,
    repairCandidateBaseDigest: sha256Digest(`sha256:${'d'.repeat(64)}`),
    freezeCheckId: checkSpecificationId('check_codec-repair-freeze'),
    freezeCheckVersion: 'm1.2',
    verificationCheckId: checkSpecificationId('check_codec-repair-verification'),
    verificationCheckVersion: 'm1.2',
    verificationObligationIds: [verificationObligationId('obligation_codec-repair')],
    evidenceSetDigest: sha256Digest(`sha256:${'e'.repeat(64)}`),
    policyBundleId: policyBundleId('policy_codec-repair'),
    policyBundleDigest: sha256Digest(`sha256:${'f'.repeat(64)}`),
    repairedAt: createdAt,
    repairDigest: sha256Digest(`sha256:${'1'.repeat(64)}`),
  });
  assert.equal(Object.isFrozen(repair), true);
  assert.equal(Object.isFrozen(repair.verificationObligationIds), true);
  assert.throws(
    () => decodeAcceptanceRepairRecord({ ...repair, unownedAuthority: true }),
    /unrecognized key/i,
  );
  assert.throws(
    () =>
      decodeAcceptanceRepairRecord({
        ...repair,
        repairCandidateBaseDigest: sha256Digest(`sha256:${'2'.repeat(64)}`),
      }),
    /base must equal the rejected Candidate digest/,
  );
});

void test('[I-006][I-023] closed codecs reject poisoned scalar, enum, field, and capability data', () => {
  assert.throws(
    () =>
      assertGoalInvariant({
        ...goal,
        successCriteria: [{ ...goal.successCriteria[0], required: 'truthy-but-not-boolean' }],
      } as never),
    /required flag must be boolean/,
  );
  const poisoned: readonly {
    readonly decode: (value: unknown) => unknown;
    readonly value: unknown;
  }[] = [
    { decode: decodeGoalSnapshot, value: { ...goal, id: 'wrong_goal' } },
    { decode: decodeGoalSnapshot, value: { ...goal, unownedField: true } },
    { decode: decodeWorkflowSnapshot, value: { ...workflow, phase: 'UNKNOWN_PHASE' } },
    { decode: decodeWorkflowSnapshot, value: { ...workflow, suspendedReason: undefined } },
    {
      decode: decodeAttemptSnapshot,
      value: {
        ...attempt,
        capabilityGrant: { ...attempt.capabilityGrant, projectRead: false },
      },
    },
    { decode: decodeAttemptSnapshot, value: { ...attempt, endedAt: createdAt } },
    {
      decode: decodeAttemptSnapshot,
      value: {
        ...attempt,
        workerSessionRef: workerSessionId('worker_codec-without-context'),
      },
    },
    {
      decode: decodeCandidateGeneration,
      value: { ...candidate, state: CandidateGenerationState.FROZEN },
    },
    {
      decode: decodeCandidateGeneration,
      value: {
        ...candidate,
        state: CandidateGenerationState.INVALIDATED,
        invalidationReason: '',
      },
    },
    {
      decode: decodePolicyBundleDefinition,
      value: { ...policyDefinition, digest: sha256Digest(`sha256:${'b'.repeat(64)}`) },
    },
    {
      decode: decodePolicyBundleDefinition,
      value: {
        ...policyDefinition,
        transitionRules: ['workflow-runtime-only', 'workflow-runtime-only'],
      },
    },
    {
      decode: decodeExecutionProfileDefinition,
      value: {
        ...executionProfileDefinition,
        digest: sha256Digest(`sha256:${'9'.repeat(64)}`),
      },
    },
    {
      decode: decodeExecutionProfileDefinition,
      value: { ...executionProfileDefinition, workerAdapterVersion: ' ' },
    },
    {
      decode: decodeExecutionProfileBinding,
      value: {
        schemaVersion: 1,
        goalId: goal.id,
        workflowId: workflow.id,
        profileId: executionProfileDefinition.id,
        profileVersion: executionProfileDefinition.version,
        profileDigest: sha256Digest(`sha256:${'7'.repeat(64)}`),
        startCommandId: commandId('command_codec-profile-poison'),
        boundAt: createdAt,
        bindingDigest: sha256Digest(`sha256:${'8'.repeat(64)}`),
        unownedField: true,
      },
    },
    {
      decode: decodeWorkflowPolicyBinding,
      value: {
        schemaVersion: 1,
        goalId: goal.id,
        workflowId: workflow.id,
        policyBundleId: policyDefinition.id,
        policyBundleVersion: policyDefinition.version,
        policyBundleDigest: sha256Digest(`sha256:${'6'.repeat(64)}`),
        startCommandId: commandId('command_codec-policy-poison'),
        boundAt: createdAt,
        bindingDigest: sha256Digest(`sha256:${'5'.repeat(64)}`),
        unownedField: true,
      },
    },
  ];

  for (const item of poisoned) {
    assert.throws(() => item.decode(item.value));
  }
});

void test('[I-006] closed request values cannot smuggle phase-only authority', () => {
  assert.throws(() =>
    decodeWorkflowSnapshot({
      ...workflow,
      phase: WorkflowPhase.IMPLEMENT,
      activeCandidateGenerationId: undefined,
    }),
  );
});
