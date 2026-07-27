import assert from 'node:assert/strict';
import test from 'node:test';

import { DeterministicClock, DeterministicIds } from '../src/deterministic-fixtures.ts';

void test('[I-006] deterministic fixtures emit explicit reproducible values', () => {
  const clock = new DeterministicClock(['2026-07-27T00:00:00.000Z', '2026-07-27T00:00:00.001Z']);
  const ids = new DeterministicIds('reducer');

  assert.equal(clock.now(), '2026-07-27T00:00:00.000Z');
  assert.equal(clock.now(), '2026-07-27T00:00:00.001Z');
  assert.throws(() => clock.now(), /exhausted/);

  assert.equal(ids.nextGoalId(), 'goal_reducer-0001');
  assert.equal(ids.nextWorkflowId(), 'workflow_reducer-0002');
  assert.equal(ids.nextCommandId(), 'command_reducer-0003');
});
