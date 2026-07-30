import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';

import { CliOperation } from '../dist/cli/contracts.js';
import { CliUsageError, parseCliInvocation, wantsJsonOutput } from '../dist/cli/parser.js';
import { resolveCliProjectPath } from '../dist/cli/project-path.js';

void test('goal create parsing preserves repeated criterion order and explicit JSON mode', () => {
  const invocation = parseCliInvocation([
    'goal',
    'create',
    '--objective',
    '  controlled objective  ',
    '--project',
    './fixture',
    '--criterion',
    ' first proof ',
    '--criterion=second proof',
    '--json',
  ]);

  assert.equal(invocation.operation, CliOperation.GOAL_CREATE);
  assert.equal(invocation.objective, 'controlled objective');
  assert.equal(invocation.projectOperand, './fixture');
  assert.deepEqual(invocation.criteria, ['first proof', 'second proof']);
  assert.equal(invocation.json, true);
});

void test('goal status parsing validates one branded GoalId', () => {
  const invocation = parseCliInvocation(['goal', 'status', 'goal_cli-status', '--json']);

  assert.equal(invocation.operation, CliOperation.GOAL_STATUS);
  assert.equal(invocation.goalId, 'goal_cli-status');
  assert.equal(invocation.json, true);
});

void test('lifecycle and audit parsing keep fixture selection limited to goal start', () => {
  const started = parseCliInvocation([
    'goal',
    'start',
    'goal_cli-start',
    '--fixture',
    'failing-evidence',
    '--json',
  ]);
  assert.equal(started.operation, CliOperation.GOAL_START);
  assert.equal(started.goalId, 'goal_cli-start');
  assert.equal(started.fixtureName, 'failing-evidence');
  assert.equal(started.json, true);

  const lifecycle = [
    { args: ['goal', 'resume', 'goal_cli-resume'], operation: CliOperation.GOAL_RESUME },
    { args: ['goal', 'cancel', 'goal_cli-cancel'], operation: CliOperation.GOAL_CANCEL },
    { args: ['audit', 'show', 'goal_cli-audit'], operation: CliOperation.AUDIT_SHOW },
  ] as const;
  for (const expected of lifecycle) {
    const invocation = parseCliInvocation(expected.args);
    assert.equal(invocation.operation, expected.operation);
    assert.equal(invocation.goalId, expected.args[2]);
    assert.equal(invocation.json, false);
  }
});

void test('demo parsing accepts only the eight closed M1 proof scenarios', () => {
  const invocation = parseCliInvocation(['demo', 'run', 'restart-resume', '--json']);
  assert.equal(invocation.operation, CliOperation.DEMO_RUN);
  assert.equal(invocation.scenario, 'restart-resume');
  assert.equal(invocation.json, true);

  assert.throws(() => parseCliInvocation(['demo', 'run', 'unknown-scenario']), CliUsageError);
  assert.throws(
    () => parseCliInvocation(['demo', 'run', 'happy-path', 'candidate-drift']),
    CliUsageError,
  );
});

void test('[I-025] M1 exposes no merge, release, deploy, promotion, or effect command', () => {
  assert.deepEqual(Object.values(CliOperation), [
    'goal create',
    'goal start',
    'goal status',
    'goal resume',
    'goal cancel',
    'audit show',
    'demo run',
  ]);
  for (const args of [
    ['goal', 'merge', 'goal_effect'],
    ['release', 'run', 'goal_effect'],
    ['deploy', 'run', 'goal_effect'],
    ['promotion', 'approve', 'goal_effect'],
    ['effect', 'apply', 'goal_effect'],
  ]) {
    assert.throws(() => parseCliInvocation(args), CliUsageError, args.join(' '));
  }
});

void test('CLI parsing rejects incomplete, ambiguous, and unknown command input', () => {
  const invalid = [
    ['goal', 'create', '--objective', 'objective', '--project', 'fixture'],
    [
      'goal',
      'create',
      '--objective',
      'first',
      '--objective',
      'second',
      '--project',
      'fixture',
      '--criterion',
      'proof',
    ],
    ['goal', 'status', 'not-a-goal-id'],
    ['goal', 'status', 'goal_first', 'goal_second'],
    ['goal', 'start', 'goal_start', '--fixture', ''],
    ['goal', 'start', 'goal_start', '--fixture', 'happy-path', '--fixture', 'failing-evidence'],
    ['goal', 'resume', 'goal_resume', '--fixture', 'happy-path'],
    ['audit', 'show', 'goal_audit', 'goal_extra'],
    ['goal', 'unknown'],
    [],
  ];

  for (const args of invalid) {
    assert.throws(() => parseCliInvocation(args), CliUsageError, args.join(' '));
  }
});

void test('project resolution converts one relative operand into a normalized absolute identity', () => {
  assert.equal(
    resolveCliProjectPath('./project/../project', '/tmp/codeclosure-cli'),
    join('/tmp/codeclosure-cli', 'project'),
  );
  assert.throws(() => resolveCliProjectPath('/', '/tmp/codeclosure-cli'), /filesystem root/);
});

void test('JSON intent remains detectable when later argument validation fails', () => {
  assert.equal(wantsJsonOutput(['goal', 'create', '--json']), true);
  assert.equal(wantsJsonOutput(['goal', 'create']), false);
});
