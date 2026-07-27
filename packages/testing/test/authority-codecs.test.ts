import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CandidateGenerationState,
  WorkflowPhase,
  aggregateVersion,
  assertGoalInvariant,
  attemptId,
  candidateGenerationId,
  candidateId,
  commandId,
  createGoal,
  createWorkflow,
  decodeAttemptSnapshot,
  decodeCandidateGeneration,
  decodeGoalSnapshot,
  decodeWorkflowSnapshot,
  decideAttempt,
  goalId,
  goalRevision,
  isoTimestamp,
  sha256Digest,
  successCriterionId,
  workerSessionId,
  workflowId,
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

void test('[I-006] authority codecs materialize immutable canonical snapshots', () => {
  const decodedGoal = decodeGoalSnapshot(goal);
  const decodedWorkflow = decodeWorkflowSnapshot(workflow);
  const decodedAttempt = decodeAttemptSnapshot(attempt);
  const decodedCandidate = decodeCandidateGeneration(candidate);

  assert.equal(Object.isFrozen(decodedGoal), true);
  assert.equal(Object.isFrozen(decodedGoal.successCriteria), true);
  assert.equal(Object.isFrozen(decodedGoal.successCriteria[0]), true);
  assert.equal(Object.isFrozen(goal.successCriteria[0]), true);
  assert.equal(Object.isFrozen(decodedGoal.scope.allowedPaths), true);
  assert.equal(Object.isFrozen(decodedWorkflow), true);
  assert.equal(Object.isFrozen(decodedAttempt), true);
  assert.equal(Object.isFrozen(decodedAttempt.capabilityGrant.allowedActions), true);
  assert.equal(Object.isFrozen(decodedCandidate), true);
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
