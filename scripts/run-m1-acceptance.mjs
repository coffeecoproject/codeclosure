import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import process from 'node:process';

const repositoryRoot = resolve(import.meta.dirname, '..');
const entryPoint = resolve(repositoryRoot, 'apps/cli/dist/index.js');
const sha256Pattern = /^sha256:[0-9a-f]{64}$/;

function object(value, name) {
  assert.ok(value !== null && typeof value === 'object' && !Array.isArray(value), name);
  return value;
}

function parseSingleJsonDocument(output, name) {
  const trimmed = output.trim();
  assert.notEqual(trimmed, '', `${name}: stdout must contain JSON`);
  assert.equal(trimmed.split('\n').length, 1, `${name}: stdout must contain one JSON document`);
  return object(JSON.parse(trimmed), `${name}: envelope must be an object`);
}

function runCli({ args, cwd, dataHomePath, expectedStatus, name }) {
  const result = spawnSync(process.execPath, [entryPoint, ...args], {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, CODECLOSURE_HOME: dataHomePath },
    maxBuffer: 16 * 1024 * 1024,
    timeout: 30_000,
  });
  assert.equal(result.error, undefined, `${name}: ${result.error?.message ?? ''}`);
  assert.equal(result.signal, null, `${name}: terminated by ${String(result.signal)}`);
  assert.equal(result.status, expectedStatus, `${name}: ${result.stderr}`);
  assert.equal(result.stderr, '', `${name}: stderr must remain empty`);
  return parseSingleJsonDocument(result.stdout, name);
}

function commandOutput(envelope, operation) {
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.kind, 'COMMAND_RESULT');
  assert.equal(envelope.operation, operation);
  const result = object(envelope.result, `${operation}: result`);
  assert.equal(result.status, 'APPLIED');
  const output = object(result.output, `${operation}: output`);
  assert.equal(output.ok, true);
  return output;
}

function foundStatus(envelope, goalId) {
  assert.equal(envelope.schemaVersion, 1);
  assert.equal(envelope.kind, 'GOAL_STATUS');
  assert.equal(envelope.operation, 'goal status');
  const result = object(envelope.result, 'goal status: result');
  assert.equal(result.status, 'FOUND');
  const view = object(result.view, 'goal status: view');
  assert.equal(view.goalId, goalId);
  return view;
}

function createGoal(runRoot, dataHomePath, objective) {
  const envelope = runCli({
    args: [
      'goal',
      'create',
      '--objective',
      objective,
      '--project',
      'project',
      '--criterion',
      'The exact M1 acceptance outcome is retained',
      '--json',
    ],
    cwd: runRoot,
    dataHomePath,
    expectedStatus: 0,
    name: `create ${objective}`,
  });
  const output = commandOutput(envelope, 'goal create');
  assert.equal(typeof output.goalId, 'string');
  assert.match(output.goalId, /^goal_/);
  return output.goalId;
}

function readStatus(runRoot, dataHomePath, goalId, name) {
  return foundStatus(
    runCli({
      args: ['goal', 'status', goalId, '--json'],
      cwd: runRoot,
      dataHomePath,
      expectedStatus: 0,
      name,
    }),
    goalId,
  );
}

function reportPass(id, description) {
  process.stdout.write(`PASS ${id}: ${description}\n`);
}

const runRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m1-acceptance-'));
const projectPath = join(runRoot, 'project');
const dataHomePath = join(runRoot, 'authority');
const effectAuthorityPath = join(runRoot, 'effect-authority-must-remain-absent');
mkdirSync(projectPath, { mode: 0o700 });

try {
  const usage = runCli({
    args: [
      'goal',
      'create',
      '--objective',
      'Missing required criterion',
      '--project',
      'project',
      '--json',
    ],
    cwd: runRoot,
    dataHomePath,
    expectedStatus: 2,
    name: 'missing criterion usage rejection',
  });
  assert.equal(usage.kind, 'CLI_ERROR');
  assert.equal(object(usage.error, 'usage error').code, 'CLI_USAGE');
  assert.equal(existsSync(dataHomePath), false);
  reportPass('M1-F01a', 'missing required input failed before authority opened');

  const happyGoalId = createGoal(runRoot, dataHomePath, 'Black-box happy lifecycle');
  const initialStatus = readStatus(
    runRoot,
    dataHomePath,
    happyGoalId,
    'initial fresh-process status',
  );
  assert.equal(initialStatus.phase, 'DISCOVERY');
  assert.equal(initialStatus.runStatus, 'READY');
  assert.equal(initialStatus.nextSafeAction, 'START_GOAL');
  assert.equal(initialStatus.technicalCloseout, false);
  assert.equal(initialStatus.policyRef, undefined);
  assert.equal(initialStatus.executionProfileRef, undefined);
  assert.equal(initialStatus.acceptanceSummary, undefined);
  assert.equal(initialStatus.closeoutRef, undefined);
  reportPass('M1-F02', 'create and fresh-process status retained DISCOVERY / READY');

  const started = runCli({
    args: ['goal', 'start', happyGoalId, '--json'],
    cwd: runRoot,
    dataHomePath,
    expectedStatus: 0,
    name: 'happy-path start',
  });
  assert.equal(started.schemaVersion, 1);
  assert.equal(started.kind, 'DRIVEN_COMMAND_RESULT');
  assert.equal(started.operation, 'goal start');
  const startedResult = object(started.result, 'happy start: result');
  assert.equal(
    object(object(startedResult.command, 'happy start: command').output, 'output').ok,
    true,
  );
  const happyDrive = object(startedResult.drive, 'happy start: drive');
  assert.equal(happyDrive.stopReason, 'CLOSED');
  const happyFinalState = object(happyDrive.finalState, 'happy start: final state');
  assert.equal(happyFinalState.phase, 'CLOSEOUT');
  assert.equal(happyFinalState.runStatus, 'CLOSED');

  const closedStatus = readStatus(
    runRoot,
    dataHomePath,
    happyGoalId,
    'closed fresh-process status',
  );
  assert.equal(closedStatus.phase, 'CLOSEOUT');
  assert.equal(closedStatus.runStatus, 'CLOSED');
  assert.equal(closedStatus.technicalCloseout, true);
  assert.equal(object(closedStatus.acceptanceSummary, 'acceptance summary').outcome, 'ACCEPT');
  assert.equal(object(closedStatus.activeCandidateRef, 'active candidate').state, 'ACCEPTED');
  const closeoutRef = object(closedStatus.closeoutRef, 'closeout reference');
  assert.equal(closeoutRef.acceptanceDecisionId, closedStatus.acceptanceSummary.decisionId);
  assert.equal(closeoutRef.candidateGenerationId, closedStatus.activeCandidateRef.generationId);
  assert.match(object(closedStatus.policyRef, 'policy reference').digest, sha256Pattern);
  assert.match(
    object(closedStatus.executionProfileRef, 'execution profile reference').digest,
    sha256Pattern,
  );
  assert.match(closedStatus.acceptanceSummary.decisionDigest, sha256Pattern);
  assert.match(closedStatus.activeCandidateRef.digest, sha256Pattern);
  reportPass('M1-F03', 'happy start closed only with exact retained Acceptance authority');

  const auditEnvelope = runCli({
    args: ['audit', 'show', happyGoalId, '--json'],
    cwd: runRoot,
    dataHomePath,
    expectedStatus: 0,
    name: 'happy-path public audit',
  });
  assert.equal(auditEnvelope.kind, 'GOAL_AUDIT');
  assert.equal(auditEnvelope.operation, 'audit show');
  const auditResult = object(auditEnvelope.result, 'audit result');
  assert.equal(auditResult.status, 'FOUND');
  const audit = object(auditResult.view, 'audit view');
  assert.equal(audit.goalId, happyGoalId);
  assert.ok(Array.isArray(audit.events));
  assert.ok(audit.events.length > 2);
  let previousSequence = 0;
  for (const rawEvent of audit.events) {
    const event = object(rawEvent, 'audit event');
    assert.ok(event.sequence > previousSequence);
    assert.ok(event.sequence <= audit.throughSequence);
    assert.equal(event.actorType, 'RUNTIME');
    assert.match(event.payloadDigest, sha256Pattern);
    previousSequence = event.sequence;
  }
  assert.equal(previousSequence, audit.throughSequence);
  const reopenedStatus = readStatus(
    runRoot,
    dataHomePath,
    happyGoalId,
    'second closed fresh-process status',
  );
  assert.deepEqual(reopenedStatus, closedStatus);
  reportPass('M1-F06', 'public audit was Runtime-authored and strict reopen was identical');

  const failingGoalId = createGoal(runRoot, dataHomePath, 'Black-box failing Evidence');
  const failingStart = runCli({
    args: ['goal', 'start', failingGoalId, '--fixture', 'failing-evidence', '--json'],
    cwd: runRoot,
    dataHomePath,
    expectedStatus: 4,
    name: 'failing-evidence start',
  });
  assert.equal(failingStart.kind, 'DRIVEN_COMMAND_RESULT');
  const failingResult = object(failingStart.result, 'failing start: result');
  assert.equal(
    object(failingResult.drive, 'failing start: drive').stopReason,
    'ACCEPTANCE_REPAIR_REQUIRED',
  );
  const failingStatus = readStatus(
    runRoot,
    dataHomePath,
    failingGoalId,
    'failing-evidence fresh-process status',
  );
  assert.equal(failingStatus.phase, 'FINAL_VERIFY');
  assert.equal(failingStatus.runStatus, 'READY');
  assert.equal(failingStatus.technicalCloseout, false);
  assert.equal(failingStatus.closeoutRef, undefined);
  assert.equal(
    object(failingStatus.acceptanceSummary, 'failing acceptance').outcome,
    'REJECT_REPAIRABLE',
  );
  assert.equal(
    object(failingStatus.dominantBlocker, 'failing blocker').code,
    'ACCEPTANCE_REPAIR_REQUIRED',
  );
  const refusedResume = runCli({
    args: ['goal', 'resume', failingGoalId, '--json'],
    cwd: runRoot,
    dataHomePath,
    expectedStatus: 3,
    name: 'repair-authority resume refusal',
  });
  const refusedResult = object(refusedResume.result, 'refused resume: result');
  assert.equal(object(refusedResult.command, 'refused resume: command').status, 'REJECTED');
  assert.equal(refusedResult.drive, undefined);
  reportPass(
    'M1-F04',
    'failing Evidence stopped under governance and resume invented no authority',
  );

  const cancelledGoalId = createGoal(runRoot, dataHomePath, 'Black-box cancellation');
  const cancelled = runCli({
    args: ['goal', 'cancel', cancelledGoalId, '--json'],
    cwd: runRoot,
    dataHomePath,
    expectedStatus: 0,
    name: 'goal cancellation',
  });
  assert.equal(commandOutput(cancelled, 'goal cancel').runStatus, 'CANCELLED');
  const cancelledStatus = readStatus(
    runRoot,
    dataHomePath,
    cancelledGoalId,
    'cancelled fresh-process status',
  );
  assert.equal(cancelledStatus.runStatus, 'CANCELLED');
  assert.equal(cancelledStatus.technicalCloseout, false);
  assert.equal(cancelledStatus.acceptanceSummary, undefined);
  assert.equal(cancelledStatus.closeoutRef, undefined);
  reportPass('M1-F05', 'cancellation persisted without technical closeout');

  for (const operation of ['merge', 'release', 'deploy', 'promotion']) {
    const rejected = runCli({
      args: [operation, '--json'],
      cwd: runRoot,
      dataHomePath: effectAuthorityPath,
      expectedStatus: 2,
      name: `${operation} usage rejection`,
    });
    assert.equal(rejected.kind, 'CLI_ERROR');
    assert.equal(object(rejected.error, `${operation}: error`).code, 'CLI_USAGE');
    assert.equal(existsSync(effectAuthorityPath), false);
  }
  reportPass('M1-F01b', 'merge, release, deploy, and promotion are not CLI operations');

  assert.equal(existsSync(join(dataHomePath, 'state.sqlite')), true);
  assert.deepEqual(readdirSync(projectPath), []);
  reportPass('M1-F07', 'ordinary authority remained outside the untouched project fixture');

  process.stdout.write('M1 independent black-box acceptance: 8/8 passed\n');
} finally {
  rmSync(runRoot, { force: true, recursive: true });
}
