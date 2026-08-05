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

void test('intake submit requires an explicit action and preserves bounded repeated constraints', () => {
  const invocation = parseCliInvocation([
    'intake',
    'submit',
    '--action',
    'governed-execution',
    '--request',
    '  implement the bounded change  ',
    '--project',
    './fixture',
    '--constraint',
    ' first boundary ',
    '--constraint=second boundary',
    '--json',
  ]);

  assert.equal(invocation.operation, CliOperation.INTAKE_SUBMIT);
  assert.equal(invocation.action, 'governed-execution');
  assert.equal(invocation.request, '  implement the bounded change  ');
  assert.equal(invocation.projectOperand, './fixture');
  assert.deepEqual(invocation.constraints, [' first boundary ', 'second boundary']);
  assert.equal(invocation.json, true);

  assert.throws(
    () => parseCliInvocation(['intake', 'submit', '--request', 'missing action']),
    CliUsageError,
  );
  assert.throws(
    () =>
      parseCliInvocation(['intake', 'submit', '--action', 'materialize-only', '--request', '   ']),
    CliUsageError,
  );
});

void test('intake continuation accepts only exact IDs, one positive version, and optional project input', () => {
  const clarified = parseCliInvocation([
    'intake',
    'clarify',
    'intake_cli-run',
    '--question-id',
    'clarification-question_cli-current',
    '--expected-version',
    '2',
    '--answer',
    '  bounded answer  ',
    '--project',
    './project',
  ]);
  assert.equal(clarified.operation, CliOperation.INTAKE_CLARIFY);
  assert.equal(clarified.intakeRunId, 'intake_cli-run');
  assert.equal(clarified.questionId, 'clarification-question_cli-current');
  assert.equal(clarified.expectedVersion, 2);
  assert.equal(clarified.answer, '  bounded answer  ');
  assert.equal(clarified.projectOperand, './project');

  assert.throws(
    () =>
      parseCliInvocation([
        'intake',
        'clarify',
        ' intake_cli-run ',
        '--question-id',
        'clarification-question_cli-current',
        '--expected-version',
        '2',
        '--answer',
        'bounded answer',
      ]),
    CliUsageError,
  );

  const abandoned = parseCliInvocation([
    'intake',
    'abandon',
    'intake_cli-run',
    '--expected-version=3',
    '--json',
  ]);
  assert.equal(abandoned.operation, CliOperation.INTAKE_ABANDON);
  assert.equal(abandoned.expectedVersion, 3);
  assert.equal(abandoned.json, true);

  for (const operation of [CliOperation.INTAKE_STATUS, CliOperation.INTAKE_AUDIT] as const) {
    const [, action] = operation.split(' ');
    const read = parseCliInvocation(['intake', action ?? '', 'intake_cli-run']);
    assert.equal(read.operation, operation);
    assert.equal(read.intakeRunId, 'intake_cli-run');
  }
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

void test('demo parsing accepts the closed M1 and bounded M2 Slice 7 proof scenarios', () => {
  const invocation = parseCliInvocation(['demo', 'run', 'restart-resume', '--json']);
  assert.equal(invocation.operation, CliOperation.DEMO_RUN);
  assert.equal(invocation.scenario, 'restart-resume');
  assert.equal(invocation.json, true);

  for (const scenario of [
    'm2-protected-repair',
    'm2-protected-failed-repair',
    'm2-adapter-failure',
    'm2-live',
    'm2-live-repair-handoff',
  ] as const) {
    const parsed = parseCliInvocation(['demo', 'run', scenario]);
    assert.equal(parsed.operation, CliOperation.DEMO_RUN);
    assert.equal(parsed.scenario, scenario);
  }

  assert.throws(() => parseCliInvocation(['demo', 'run', 'unknown-scenario']), CliUsageError);
  assert.throws(
    () => parseCliInvocation(['demo', 'run', 'happy-path', 'candidate-drift']),
    CliUsageError,
  );
});

void test('[I-025] M1 exposes no merge, release, deploy, promotion, or effect command', () => {
  assert.deepEqual(Object.values(CliOperation), [
    'intake submit',
    'intake clarify',
    'intake abandon',
    'intake status',
    'intake audit',
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
    ['intake', 'submit', '--action', 'implicit-is-forbidden', '--request', 'request'],
    ['intake', 'clarify', 'intake_cli', '--question-id', 'clarification-question_cli'],
    [
      'intake',
      'clarify',
      'intake_cli',
      '--question-id',
      'not-a-question',
      '--expected-version',
      '1',
      '--answer',
      'answer',
    ],
    ['intake', 'abandon', 'intake_cli', '--expected-version', '0'],
    ['intake', 'abandon', 'intake_cli', '--expected-version', '1', '--expected-version', '2'],
    ['intake', 'status', 'not-an-intake-id'],
    ['intake', 'audit', 'intake_first', 'intake_second'],
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
