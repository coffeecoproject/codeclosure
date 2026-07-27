import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AttemptStatus,
  GoalStatus,
  RunStatus,
  aggregateVersion,
  commandId,
  goalId,
  deriveGoalStatus,
  isoTimestamp,
  latestIsoTimestamp,
  sha256Digest,
  workflowVersion,
  workerEventId,
} from '@codeclosure/domain';

void test('[I-003][I-010] Attempt completion vocabulary grants no success authority', () => {
  assert.deepEqual(Object.values(AttemptStatus), [
    'RUNNING',
    'RESULT_RECORDED',
    'FAILED',
    'INTERRUPTED',
  ]);
  assert.equal('SUCCEEDED' in AttemptStatus, false);
  assert.equal('CANCELLED' in AttemptStatus, false);
});

void test('[I-006] authority identifiers reject ambiguous or malformed values', () => {
  assert.equal(goalId('goal_valid-id'), 'goal_valid-id');
  assert.throws(() => goalId('workflow_wrong-kind'), /GoalId/);
  assert.throws(() => goalId('goal_UPPERCASE'), /GoalId/);
  assert.throws(() => goalId('goal_trailing-'), /GoalId/);

  assert.equal(workflowVersion(1), 1);
  assert.equal(aggregateVersion(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  assert.throws(() => workflowVersion(0), /positive safe integer/);
  assert.throws(() => aggregateVersion(1.5), /positive safe integer/);
});

void test('[I-002][I-008] application commands and worker deliveries use distinct identities', () => {
  assert.equal(commandId('command_submit-result'), 'command_submit-result');
  assert.equal(workerEventId('worker-event_submit-result'), 'worker-event_submit-result');
  assert.throws(() => commandId('worker-event_submit-result'), /CommandId/);
  assert.throws(() => workerEventId('command_submit-result'), /WorkerEventId/);
});

void test('[I-003][I-010] Goal lifecycle is a total projection of Workflow run status', () => {
  assert.deepEqual(
    Object.values(RunStatus).map((status) => [status, deriveGoalStatus(status)]),
    [
      [RunStatus.READY, GoalStatus.ACTIVE],
      [RunStatus.RUNNING, GoalStatus.ACTIVE],
      [RunStatus.WAITING_FOR_INPUT, GoalStatus.WAITING_FOR_INPUT],
      [RunStatus.BLOCKED, GoalStatus.BLOCKED],
      [RunStatus.FAILED, GoalStatus.BLOCKED],
      [RunStatus.CANCELLED, GoalStatus.CANCELLED],
      [RunStatus.CLOSED, GoalStatus.CLOSED],
    ],
  );
});

void test('[I-018] timestamps and digests use one exact identity representation', () => {
  const digest = `sha256:${'a'.repeat(64)}`;

  assert.equal(isoTimestamp('2026-07-27T12:34:56.789Z'), '2026-07-27T12:34:56.789Z');
  assert.throws(() => isoTimestamp('2026-07-27T12:34:56Z'), /millisecond precision/);
  assert.throws(() => isoTimestamp('2026-02-30T00:00:00.000Z'));
  assert.equal(
    latestIsoTimestamp(
      isoTimestamp('2026-07-27T12:34:56.789Z'),
      isoTimestamp('2026-07-27T12:34:56.788Z'),
      isoTimestamp('2026-07-27T12:34:56.790Z'),
    ),
    '2026-07-27T12:34:56.790Z',
  );

  assert.equal(sha256Digest(digest), digest);
  assert.throws(() => sha256Digest(`sha256:${'A'.repeat(64)}`), /lowercase hex/);
  assert.throws(() => sha256Digest('a'.repeat(64)), /sha256/);
});
