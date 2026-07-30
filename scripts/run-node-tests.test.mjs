import assert from 'node:assert/strict';
import test from 'node:test';

import { parseNodeTestSummary, testSummaryViolations } from './run-node-tests-lib.mjs';

void test('test-summary parsing accepts an all-executed passing run', () => {
  const summary = parseNodeTestSummary(`
# tests 12
# suites 0
# pass 12
# fail 0
# cancelled 0
# skipped 0
# todo 0
`);
  assert.deepEqual(summary, {
    tests: 12,
    pass: 12,
    fail: 0,
    cancelled: 0,
    skipped: 0,
    todo: 0,
  });
  assert.deepEqual(testSummaryViolations(summary), []);
});

void test('test-summary parsing makes every non-executed result visible', () => {
  const summary = parseNodeTestSummary(`
# tests 8
# pass 4
# fail 1
# cancelled 1
# skipped 1
# todo 1
`);
  assert.deepEqual(testSummaryViolations(summary), [
    '1 failed test(s)',
    '1 cancelled test(s)',
    '1 skipped test(s)',
    '1 todo test(s)',
  ]);
});

void test('test-summary parsing fails closed when the runner summary is incomplete', () => {
  assert.throws(
    () =>
      parseNodeTestSummary(`
# tests 1
# pass 1
# fail 0
`),
    /missing: cancelled, skipped, todo/u,
  );
});
