import { spawnSync } from 'node:child_process';

import {
  M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
  M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS,
  M251AcceptanceStage,
  classifyM251AssessmentCommandFailure,
} from './m2.5.1-acceptance-lib.mjs';

function fail(message) {
  throw new TypeError(message);
}

function positiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 1) fail(`${name} must be a positive integer`);
  return value;
}

function stringArray(value, name) {
  if (
    !Array.isArray(value) ||
    value.some((entry) => typeof entry !== 'string' || entry.length === 0)
  ) {
    fail(`${name} must be a string array`);
  }
  return value;
}

function commandFailure(result) {
  return classifyM251AssessmentCommandFailure({
    errorCode:
      result.error === undefined
        ? undefined
        : typeof result.error.code === 'string'
          ? result.error.code
          : 'UNCLASSIFIED',
    signal: result.signal,
    status: result.status,
  });
}

export function executeM251BoundedCommand(input, spawn = spawnSync) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('M2.5.1 bounded command input must be an object');
  }
  if (typeof input.executable !== 'string' || input.executable.length === 0) {
    fail('M2.5.1 bounded command executable is invalid');
  }
  stringArray(input.arguments, 'M2.5.1 bounded command arguments');
  const timeoutMilliseconds = positiveInteger(
    input.timeoutMilliseconds,
    'M2.5.1 bounded command timeout',
  );
  const result = spawn(input.executable, input.arguments, {
    cwd: input.cwd,
    encoding: 'utf8',
    env: input.environment,
    maxBuffer: positiveInteger(input.maximumOutputBytes, 'M2.5.1 bounded command output limit'),
    timeout: timeoutMilliseconds,
  });
  const output = Object.freeze({
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  });
  if (result.error === undefined && result.signal === null && result.status === 0) {
    return Object.freeze({ succeeded: true, output });
  }
  return Object.freeze({
    succeeded: false,
    output,
    failure: commandFailure(result),
  });
}

export function executeM251AssessmentStageCommands(input, spawn = spawnSync) {
  if (input === null || typeof input !== 'object' || Array.isArray(input)) {
    fail('M2.5.1 assessment stage command input must be an object');
  }
  if (
    !Object.values(M251AcceptanceStage).includes(input.stageId) ||
    input.stageId === M251AcceptanceStage.PREFLIGHT
  ) {
    fail('M2.5.1 assessment stage command has no executable-stage identity');
  }
  if (!Array.isArray(input.executions) || input.executions.length === 0) {
    fail('M2.5.1 assessment stage command requires at least one execution');
  }
  const commandTimeoutMilliseconds = positiveInteger(
    M251_STAGE_COMMAND_TIMEOUT_MILLISECONDS[input.stageId],
    'M2.5.1 assessment stage command timeout',
  );
  const outputs = [];
  for (const [commandIndex, execution] of input.executions.entries()) {
    if (execution === null || typeof execution !== 'object' || Array.isArray(execution)) {
      fail('M2.5.1 assessment execution must be an object');
    }
    const result = executeM251BoundedCommand(
      {
        executable: execution.executable,
        arguments: execution.arguments,
        cwd: execution.cwd ?? input.cwd,
        environment: execution.environment,
        maximumOutputBytes: M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
        timeoutMilliseconds: commandTimeoutMilliseconds,
      },
      spawn,
    );
    outputs.push(result.output);
    if (!result.succeeded) {
      return Object.freeze({
        succeeded: false,
        outputs: Object.freeze(outputs),
        failure: Object.freeze({
          ...result.failure,
          evidence: Object.freeze({
            commandIndex,
            failureKind: result.failure.kind,
            commandTimeoutMilliseconds,
            maximumOutputBytes: M251_ASSESSMENT_COMMAND_MAXIMUM_OUTPUT_BYTES,
          }),
        }),
      });
    }
  }
  return Object.freeze({ succeeded: true, outputs: Object.freeze(outputs) });
}
