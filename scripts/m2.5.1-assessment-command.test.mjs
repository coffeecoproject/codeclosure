import assert from 'node:assert/strict';
import process from 'node:process';
import test from 'node:test';

import {
  executeM251AssessmentStageCommands,
  executeM251BoundedCommand,
} from './m2.5.1-assessment-command.mjs';
import {
  M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
  M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS,
  M251AcceptanceOutcome,
  M251AcceptanceStage,
} from './m2.5.1-acceptance-lib.mjs';

test('M2.5.1 stage execution consumes the owning stage budget', () => {
  const calls = [];
  const result = executeM251AssessmentStageCommands(
    {
      stageId: M251AcceptanceStage.M25_REGRESSION,
      executions: [
        {
          executable: 'corepack',
          arguments: ['pnpm', 'regress:m2.5'],
          environment: { CI: '1' },
        },
      ],
      cwd: '/assessment',
    },
    (executable, arguments_, options) => {
      calls.push({ executable, arguments_, options });
      return { error: undefined, signal: null, status: 0, stdout: 'passed', stderr: '' };
    },
  );

  assert.equal(result.succeeded, true);
  assert.deepEqual(result.outputs, [{ stdout: 'passed', stderr: '' }]);
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].options.timeout,
    M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[M251AcceptanceStage.M25_REGRESSION],
  );
  assert.equal(calls[0].options.maxBuffer, M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES);
  assert.equal(calls[0].options.cwd, '/assessment');
  assert.deepEqual(calls[0].options.env, { CI: '1' });
});

test('M2.5.1 stage execution closes timeout metadata and suppresses later commands', () => {
  let callCount = 0;
  const result = executeM251AssessmentStageCommands(
    {
      stageId: M251AcceptanceStage.DETERMINISTIC_COMPOSITION,
      executions: [
        { executable: 'first', arguments: [], environment: {} },
        { executable: 'second', arguments: [], environment: {} },
        { executable: 'must-not-run', arguments: [], environment: {} },
      ],
      cwd: '/assessment',
    },
    () => {
      callCount += 1;
      if (callCount === 1) {
        return { error: undefined, signal: null, status: 0, stdout: 'first', stderr: '' };
      }
      const error = new Error('timed out');
      error.code = 'ETIMEDOUT';
      return { error, signal: 'SIGTERM', status: null, stdout: '', stderr: '' };
    },
  );

  assert.equal(callCount, 2);
  assert.equal(result.succeeded, false);
  assert.equal(result.outputs.length, 2);
  assert.deepEqual(result.failure, {
    kind: 'TIMEOUT',
    outcome: M251AcceptanceOutcome.FAIL,
    exitCode: 1,
    reasonCode: 'COMMAND_TIMEOUT',
    evidence: {
      commandIndex: 1,
      failureKind: 'TIMEOUT',
      commandTimeoutMilliseconds:
        M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[M251AcceptanceStage.DETERMINISTIC_COMPOSITION],
      maximumOutputBytes: M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
    },
  });
});

test('M2.5.1 bounded execution observes the actual Node timeout shape', () => {
  const result = executeM251BoundedCommand({
    executable: process.execPath,
    arguments: ['-e', 'setTimeout(() => {}, 10_000)'],
    cwd: process.cwd(),
    environment: process.env,
    maximumOutputBytes: 1024 * 1024,
    timeoutMilliseconds: 100,
  });

  assert.equal(result.succeeded, false);
  assert.equal(result.failure.outcome, M251AcceptanceOutcome.FAIL);
  assert.equal(result.failure.reasonCode, 'COMMAND_TIMEOUT');
});

test('M2.5.1 bounded execution observes the actual Node output-limit shape', () => {
  const result = executeM251BoundedCommand({
    executable: process.execPath,
    arguments: ['-e', "process.stdout.write('x'.repeat(64 * 1024))"],
    cwd: process.cwd(),
    environment: process.env,
    maximumOutputBytes: 1024,
    timeoutMilliseconds: 5_000,
  });

  assert.equal(result.succeeded, false);
  assert.deepEqual(result.failure, {
    kind: 'OUTPUT_LIMIT',
    outcome: M251AcceptanceOutcome.FAIL,
    exitCode: 1,
    reasonCode: 'COMMAND_OUTPUT_LIMIT_EXCEEDED',
  });
});

test('M2.5.1 stage execution retains output-limit metadata and suppresses later commands', () => {
  let callCount = 0;
  const result = executeM251AssessmentStageCommands(
    {
      stageId: M251AcceptanceStage.LIVE_INTAKE,
      executions: [
        { executable: 'output-heavy', arguments: [], environment: {} },
        { executable: 'must-not-run', arguments: [], environment: {} },
      ],
      cwd: '/assessment',
    },
    () => {
      callCount += 1;
      const error = new Error('output exceeds maxBuffer');
      error.code = 'ENOBUFS';
      return { error, signal: 'SIGTERM', status: null, stdout: 'partial', stderr: '' };
    },
  );

  assert.equal(callCount, 1);
  assert.equal(result.succeeded, false);
  assert.deepEqual(result.failure, {
    kind: 'OUTPUT_LIMIT',
    outcome: M251AcceptanceOutcome.FAIL,
    exitCode: 1,
    reasonCode: 'COMMAND_OUTPUT_LIMIT_EXCEEDED',
    evidence: {
      commandIndex: 0,
      failureKind: 'OUTPUT_LIMIT',
      commandTimeoutMilliseconds:
        M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[M251AcceptanceStage.LIVE_INTAKE],
      maximumOutputBytes: M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
    },
  });
});

test('M2.5.1 stage execution rejects a non-executable stage before spawn', () => {
  let spawned = false;
  assert.throws(
    () =>
      executeM251AssessmentStageCommands(
        {
          stageId: M251AcceptanceStage.PREFLIGHT,
          executions: [{ executable: 'must-not-run', arguments: [], environment: {} }],
          cwd: '/assessment',
        },
        () => {
          spawned = true;
          return { error: undefined, signal: null, status: 0, stdout: '', stderr: '' };
        },
      ),
    /no executable-stage identity/u,
  );
  assert.equal(spawned, false);
});
