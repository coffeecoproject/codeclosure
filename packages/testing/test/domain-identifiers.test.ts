import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AttemptStatus,
  aggregateVersion,
  goalId,
  isoTimestamp,
  sha256Digest,
  workflowVersion,
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

void test('[I-018] timestamps and digests use one exact identity representation', () => {
  const digest = `sha256:${'a'.repeat(64)}`;

  assert.equal(isoTimestamp('2026-07-27T12:34:56.789Z'), '2026-07-27T12:34:56.789Z');
  assert.throws(() => isoTimestamp('2026-07-27T12:34:56Z'), /millisecond precision/);
  assert.throws(() => isoTimestamp('2026-02-30T00:00:00.000Z'));

  assert.equal(sha256Digest(digest), digest);
  assert.throws(() => sha256Digest(`sha256:${'A'.repeat(64)}`), /lowercase hex/);
  assert.throws(() => sha256Digest('a'.repeat(64)), /sha256/);
});
