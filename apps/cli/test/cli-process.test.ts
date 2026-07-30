import assert from 'node:assert/strict';
import { spawnSync, type SpawnSyncReturns } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { parseGoalIdentifier } from '@codeclosure/runtime';
import { CryptographicIdentityGenerator } from '@codeclosure/runtime/composition';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';

import { ProtectedPathKind } from '../dist/composition/data-home.js';
import { createCliComposition } from '../dist/composition/index.js';
import {
  spawnM1ProofChildProcess,
  stopM1ProofChildProcess,
  waitForM1ProofChildProcessClose,
  type RunningM1ProofChildProcess,
} from '../dist/composition/m1-proof-child-process.js';

const entryPoint = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const RESTART_DISPATCH_TIMEOUT_MILLISECONDS = 10_000;
const PROCESS_CLOSE_TIMEOUT_MILLISECONDS = 5_000;
const PROCESS_CLEANUP_TIMEOUT_MILLISECONDS = 1_000;
const MAX_CLI_OUTPUT_BYTES = 1024 * 1024;

function temporaryRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-cli-process-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

function runCli(
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly dataHomePath: string;
  },
): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [entryPoint, ...args], {
    cwd: options.cwd,
    encoding: 'utf8',
    env: { ...process.env, CODECLOSURE_HOME: options.dataHomePath },
    maxBuffer: 1024 * 1024,
  });
}

function field(value: unknown, name: string): unknown {
  assert.ok(value !== null && typeof value === 'object', `${name} owner must be an object`);
  return Reflect.get(value, name);
}

function parseSingleJsonDocument(output: string): unknown {
  const trimmed = output.trim();
  assert.notEqual(trimmed, '');
  assert.equal(trimmed.split('\n').length, 1, output);
  const parsed: unknown = JSON.parse(trimmed);
  return parsed;
}

function createGoalThroughCli(root: string, dataHomePath: string, objective: string): string {
  const created = runCli(
    [
      'goal',
      'create',
      '--objective',
      objective,
      '--project',
      'project',
      '--criterion',
      'The exact CLI outcome is retained',
      '--json',
    ],
    { cwd: root, dataHomePath },
  );
  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.stderr, '');
  const output = field(field(parseSingleJsonDocument(created.stdout), 'result'), 'output');
  const goalId = field(output, 'goalId');
  assert.equal(typeof goalId, 'string');
  if (typeof goalId !== 'string') {
    assert.fail('Goal creation did not return a GoalId');
  }
  return goalId;
}

void test('goal create and status form one JSON-safe cross-process SQLite loop', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  mkdirSync(project, { mode: 0o700 });

  const created = runCli(
    [
      'goal',
      'create',
      '--objective',
      'Prove the real CLI entry point',
      '--project',
      'project',
      '--criterion',
      'A new process can read the same authoritative Goal',
      '--json',
    ],
    { cwd: root, dataHomePath },
  );
  assert.equal(created.error, undefined);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(created.stderr, '');
  const createEnvelope = parseSingleJsonDocument(created.stdout);
  assert.equal(field(createEnvelope, 'schemaVersion'), 1);
  assert.equal(field(createEnvelope, 'kind'), 'COMMAND_RESULT');
  assert.equal(field(createEnvelope, 'operation'), 'goal create');
  const createResult = field(createEnvelope, 'result');
  assert.equal(field(createResult, 'status'), 'APPLIED');
  const createOutput = field(createResult, 'output');
  assert.equal(field(createOutput, 'ok'), true);
  const rawGoalId = field(createOutput, 'goalId');
  assert.equal(typeof rawGoalId, 'string');
  if (typeof rawGoalId !== 'string') {
    assert.fail('Create output did not contain a GoalId');
  }

  const retained = openSqliteControlStore({ filename: join(dataHomePath, 'state.sqlite') });
  try {
    assert.equal(
      retained.getGoal(parseGoalIdentifier(rawGoalId))?.scope.projectPath,
      realpathSync.native(project),
    );
  } finally {
    retained.close();
  }

  const status = runCli(['goal', 'status', rawGoalId, '--json'], {
    cwd: root,
    dataHomePath,
  });
  assert.equal(status.error, undefined);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(status.stderr, '');
  const statusEnvelope = parseSingleJsonDocument(status.stdout);
  assert.equal(field(statusEnvelope, 'schemaVersion'), 1);
  assert.equal(field(statusEnvelope, 'kind'), 'GOAL_STATUS');
  const statusResult = field(statusEnvelope, 'result');
  assert.equal(field(statusResult, 'status'), 'FOUND');
  const statusView = field(statusResult, 'view');
  assert.equal(field(statusView, 'goalId'), rawGoalId);
  assert.equal(field(statusView, 'phase'), 'DISCOVERY');
  assert.equal(field(statusView, 'runStatus'), 'READY');
  assert.equal(field(statusView, 'nextSafeAction'), 'START_GOAL');
  assert.equal(field(statusView, 'technicalCloseout'), false);

  const human = runCli(['goal', 'status', rawGoalId], { cwd: root, dataHomePath });
  assert.equal(human.status, 0, human.stderr);
  assert.equal(human.stderr, '');
  assert.match(human.stdout, new RegExp(`Goal: ${rawGoalId}`));
  assert.match(human.stdout, /Phase: DISCOVERY/);
  assert.match(human.stdout, /Technical closeout: no/);
  assert.equal(human.stdout.includes('\u001B['), false);
});

void test('human status renders exact accepted authority without inventing completion', async (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  mkdirSync(project, { mode: 0o700 });
  const composition = createCliComposition({
    dataHomePath,
    protectedPaths: [{ kind: ProtectedPathKind.PROJECT, path: project }],
    allowedProjectPaths: [project],
  });
  const ids = new CryptographicIdentityGenerator();
  let goalIdentifier: string;
  try {
    const created = composition.application.createGoal({
      commandId: ids.nextCommandId(),
      objective: 'Render only exact closeout authority',
      projectPath: project,
      criteria: ['The current accepted binding survives the CLI read process'],
    });
    if (!created.output.ok) {
      assert.fail('Closed status fixture could not create its Goal');
    }
    goalIdentifier = created.output.goalId;
    const createdStatus = composition.application.getGoalStatus(created.output.goalId);
    if (createdStatus.status !== 'FOUND') {
      assert.fail('Closed status fixture could not read its Goal');
    }
    const started = await composition.application.startGoal({
      commandId: ids.nextCommandId(),
      goalId: created.output.goalId,
      expectedGoalRevision: createdStatus.view.goalRevision,
      expectedWorkflowVersion: createdStatus.view.workflowVersion,
    });
    assert.equal(started.drive?.stopReason, 'CLOSED');
  } finally {
    composition.close();
  }

  const result = runCli(['goal', 'status', goalIdentifier], { cwd: root, dataHomePath });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, '');
  assert.match(result.stdout, /Policy: policy_codeclosure-m1@codeclosure-m1-policy-v1/);
  assert.match(result.stdout, /Execution profile: profile_m1-happy-path@/);
  assert.match(result.stdout, /Active candidate: generation_/);
  assert.match(result.stdout, /Candidate boundary: #1 \(ACCEPTED\)/);
  assert.match(result.stdout, /Acceptance: ACCEPT/);
  assert.match(result.stdout, /Closeout decision: acceptance_/);
  assert.match(result.stdout, /Technical closeout: yes/);
});

void test('goal start reaches exact closeout and audit show reads the same retained authority', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  mkdirSync(project, { mode: 0o700 });
  const goalId = createGoalThroughCli(root, dataHomePath, 'Drive the happy path');

  const started = runCli(['goal', 'start', goalId, '--json'], { cwd: root, dataHomePath });
  assert.equal(started.status, 0, started.stderr);
  assert.equal(started.stderr, '');
  const startEnvelope = parseSingleJsonDocument(started.stdout);
  assert.equal(field(startEnvelope, 'kind'), 'DRIVEN_COMMAND_RESULT');
  const driven = field(startEnvelope, 'result');
  assert.equal(field(field(driven, 'command'), 'status'), 'APPLIED');
  assert.equal(field(field(field(driven, 'command'), 'output'), 'ok'), true);
  const drive = field(driven, 'drive');
  assert.equal(field(drive, 'stopReason'), 'CLOSED');
  assert.equal(field(field(drive, 'finalState'), 'runStatus'), 'CLOSED');

  const audit = runCli(['audit', 'show', goalId, '--json'], { cwd: root, dataHomePath });
  assert.equal(audit.status, 0, audit.stderr);
  assert.equal(audit.stderr, '');
  const auditEnvelope = parseSingleJsonDocument(audit.stdout);
  assert.equal(field(auditEnvelope, 'kind'), 'GOAL_AUDIT');
  const auditResult = field(auditEnvelope, 'result');
  assert.equal(field(auditResult, 'status'), 'FOUND');
  const auditView = field(auditResult, 'view');
  const events = field(auditView, 'events');
  assert.ok(Array.isArray(events));
  assert.ok(events.length > 2);
  assert.equal(
    events.every((event) => field(event, 'actorType') === 'RUNTIME'),
    true,
  );

  const human = runCli(['audit', 'show', goalId], { cwd: root, dataHomePath });
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, new RegExp(`Goal audit: ${goalId}`));
  assert.match(human.stdout, /Payload digest: sha256:/);
  assert.equal(human.stdout.includes('\u001B['), false);
});

void test('governed Acceptance stop exits 4 and resume refuses to invent repair authority', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  mkdirSync(project, { mode: 0o700 });
  const goalId = createGoalThroughCli(root, dataHomePath, 'Stop at repairable evidence');

  const started = runCli(['goal', 'start', goalId, '--fixture', 'failing-evidence', '--json'], {
    cwd: root,
    dataHomePath,
  });
  assert.equal(started.status, 4, started.stderr);
  assert.equal(started.stderr, '');
  const startResult = field(parseSingleJsonDocument(started.stdout), 'result');
  assert.equal(field(field(startResult, 'drive'), 'stopReason'), 'ACCEPTANCE_REPAIR_REQUIRED');
  assert.equal(field(field(field(startResult, 'command'), 'output'), 'ok'), true);

  const resumed = runCli(['goal', 'resume', goalId, '--json'], { cwd: root, dataHomePath });
  assert.equal(resumed.status, 3, resumed.stderr);
  assert.equal(resumed.stderr, '');
  const resumeResult = field(parseSingleJsonDocument(resumed.stdout), 'result');
  assert.equal(field(field(resumeResult, 'command'), 'status'), 'REJECTED');
  assert.equal(field(resumeResult, 'drive'), undefined);
});

void test('[I-029] a fresh CLI process reconciles and resumes without redispatch', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-cli-process-'));
  const cleanupState: { runningStart: RunningM1ProofChildProcess | undefined } = {
    runningStart: undefined,
  };
  t.after(async () => {
    try {
      await stopM1ProofChildProcess(
        cleanupState.runningStart,
        PROCESS_CLEANUP_TIMEOUT_MILLISECONDS,
        'Restart integration start process did not stop during cleanup',
      );
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  const databasePath = join(dataHomePath, 'state.sqlite');
  mkdirSync(project, { mode: 0o700 });
  const goalId = createGoalThroughCli(root, dataHomePath, 'Resume one real interrupted process');

  const started = spawnM1ProofChildProcess({
    executable: process.execPath,
    args: [entryPoint, 'goal', 'start', goalId, '--fixture', 'restart-resume', '--json'],
    cwd: root,
    environment: { ...process.env, CODECLOSURE_HOME: dataHomePath },
    maxOutputBytes: MAX_CLI_OUTPUT_BYTES,
  });
  cleanupState.runningStart = started;

  let interruptedAttemptId: string | undefined;
  const deadline = Date.now() + RESTART_DISPATCH_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline && interruptedAttemptId === undefined) {
    if (started.child.exitCode !== null || started.child.signalCode !== null) {
      const exited = await waitForM1ProofChildProcessClose(
        started,
        PROCESS_CLOSE_TIMEOUT_MILLISECONDS,
        'Restart integration start streams did not close after early exit',
      );
      assert.equal(started.spawnError(), undefined);
      assert.equal(started.outputError(), undefined);
      assert.fail(
        `start exited early (status ${String(exited.code)}, signal ${String(exited.signal)}): ${started.stderr()}`,
      );
    }
    const store = openSqliteControlStore({ filename: databasePath });
    try {
      const owner = store.getGoalWithWorkflow(parseGoalIdentifier(goalId));
      const activeAttemptId = owner?.workflow.activeAttemptId;
      if (
        activeAttemptId !== undefined &&
        store.getWorkerDispatchClaim(activeAttemptId) !== undefined
      ) {
        interruptedAttemptId = activeAttemptId;
      }
    } finally {
      store.close();
    }
    if (interruptedAttemptId === undefined) {
      await wait(20);
    }
  }
  assert.ok(interruptedAttemptId, 'public start did not retain an in-flight dispatch');
  await stopM1ProofChildProcess(
    started,
    PROCESS_CLOSE_TIMEOUT_MILLISECONDS,
    'Restart integration start did not close after interruption',
  );
  const interrupted = await waitForM1ProofChildProcessClose(
    started,
    PROCESS_CLOSE_TIMEOUT_MILLISECONDS,
    'Restart integration start completion was unavailable after interruption',
  );
  assert.equal(started.spawnError(), undefined);
  assert.equal(started.outputError(), undefined);
  assert.notEqual(interrupted.code, 0);
  assert.equal(started.stdout(), '');
  assert.equal(started.stderr(), '');

  const blocked = runCli(['goal', 'status', goalId, '--json'], { cwd: root, dataHomePath });
  assert.equal(blocked.status, 0, blocked.stderr);
  assert.equal(blocked.stderr, '');
  const blockedView = field(field(parseSingleJsonDocument(blocked.stdout), 'result'), 'view');
  assert.equal(field(blockedView, 'runStatus'), 'BLOCKED');
  assert.equal(field(blockedView, 'nextSafeAction'), 'RESUME_GOAL');
  assert.equal(field(blockedView, 'technicalCloseout'), false);

  const resumed = runCli(['goal', 'resume', goalId, '--json'], { cwd: root, dataHomePath });
  assert.equal(resumed.status, 0, resumed.stderr);
  assert.equal(resumed.stderr, '');
  const resumeResult = field(parseSingleJsonDocument(resumed.stdout), 'result');
  assert.equal(field(field(resumeResult, 'command'), 'status'), 'APPLIED');
  assert.equal(field(field(resumeResult, 'drive'), 'stopReason'), 'CLOSED');

  const finalStatus = runCli(['goal', 'status', goalId, '--json'], { cwd: root, dataHomePath });
  assert.equal(finalStatus.status, 0, finalStatus.stderr);
  const finalView = field(field(parseSingleJsonDocument(finalStatus.stdout), 'result'), 'view');
  assert.equal(field(finalView, 'runStatus'), 'CLOSED');
  assert.equal(field(finalView, 'technicalCloseout'), true);
  assert.equal(
    field(field(finalView, 'executionProfileRef'), 'id'),
    'profile_m1-restart-resume-v2',
  );

  const auditResult = runCli(['audit', 'show', goalId, '--json'], { cwd: root, dataHomePath });
  assert.equal(auditResult.status, 0, auditResult.stderr);
  const auditView = field(field(parseSingleJsonDocument(auditResult.stdout), 'result'), 'view');
  const events = field(auditView, 'events');
  assert.ok(Array.isArray(events));
  assert.equal(
    events.filter(
      (event) =>
        field(event, 'eventType') === 'WORKER_DISPATCH_CLAIMED' &&
        field(event, 'aggregateId') === interruptedAttemptId,
    ).length,
    1,
  );
  assert.equal(
    events.filter((event) => field(event, 'eventType') === 'RECOVERY_RECONCILIATION_RECORDED')
      .length,
    2,
  );
});

void test('goal cancel applies through Runtime and remains cancellation rather than closeout', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  mkdirSync(project, { mode: 0o700 });
  const goalId = createGoalThroughCli(root, dataHomePath, 'Cancel one ready Goal');

  const cancelled = runCli(['goal', 'cancel', goalId, '--json'], { cwd: root, dataHomePath });
  assert.equal(cancelled.status, 0, cancelled.stderr);
  assert.equal(cancelled.stderr, '');
  const cancelOutput = field(field(parseSingleJsonDocument(cancelled.stdout), 'result'), 'output');
  assert.equal(field(cancelOutput, 'ok'), true);
  assert.equal(field(cancelOutput, 'runStatus'), 'CANCELLED');

  const status = runCli(['goal', 'status', goalId, '--json'], { cwd: root, dataHomePath });
  const statusView = field(field(parseSingleJsonDocument(status.stdout), 'result'), 'view');
  assert.equal(field(statusView, 'runStatus'), 'CANCELLED');
  assert.equal(field(statusView, 'technicalCloseout'), false);
});

void test('unknown fixture is usage failure before authority opens', (t) => {
  const root = temporaryRoot(t);
  const dataHomePath = join(root, 'authority');

  const result = runCli(
    ['goal', 'start', 'goal_fixture', '--fixture', 'unknown-fixture', '--json'],
    { cwd: root, dataHomePath },
  );

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  const envelope = parseSingleJsonDocument(result.stdout);
  assert.equal(field(field(envelope, 'error'), 'code'), 'CLI_USAGE');
  assert.equal(existsSync(dataHomePath), false);
});

void test('lifecycle command reports a missing Goal without fabricating a Runtime outcome', (t) => {
  const root = temporaryRoot(t);
  const dataHomePath = join(root, 'authority');

  const result = runCli(['goal', 'start', 'goal_missing', '--json'], {
    cwd: root,
    dataHomePath,
  });

  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stderr, '');
  const envelope = parseSingleJsonDocument(result.stdout);
  assert.equal(field(envelope, 'kind'), 'CLI_ERROR');
  assert.equal(field(field(envelope, 'error'), 'code'), 'CLI_GOAL_NOT_FOUND');
});

void test('all named demos prove exact isolated authority and return zero only on proof success', (t) => {
  const root = temporaryRoot(t);
  const dataHomePath = join(root, 'ordinary-authority-must-remain-absent');
  const scenarios = [
    {
      name: 'happy-path',
      proofCode: 'HAPPY_PATH_EXACT_CLOSEOUT',
      runStatus: 'CLOSED',
      technicalCloseout: true,
    },
    {
      name: 'lying-worker',
      proofCode: 'LYING_WORKER_REJECTED',
      runStatus: 'FAILED',
      technicalCloseout: false,
    },
    {
      name: 'missing-evidence',
      proofCode: 'MISSING_EVIDENCE_FAILED_CLOSED',
      runStatus: 'FAILED',
      technicalCloseout: false,
    },
    {
      name: 'failing-evidence',
      proofCode: 'FAILING_EVIDENCE_REPAIR_REQUIRED',
      runStatus: 'READY',
      technicalCloseout: false,
    },
    {
      name: 'stale-closeout',
      proofCode: 'STALE_CLOSEOUT_INVALIDATED',
      runStatus: 'FAILED',
      technicalCloseout: false,
    },
    {
      name: 'restart-resume',
      proofCode: 'RESTART_RESUME_FRESH_ATTEMPT',
      runStatus: 'CLOSED',
      technicalCloseout: true,
    },
    {
      name: 'duplicate-result',
      proofCode: 'DUPLICATE_RESULT_DEDUPLICATED',
      runStatus: 'CLOSED',
      technicalCloseout: true,
    },
    {
      name: 'candidate-drift',
      proofCode: 'CANDIDATE_DRIFT_INVALIDATED',
      runStatus: 'FAILED',
      technicalCloseout: false,
    },
  ] as const;

  for (const expected of scenarios) {
    const demo = runCli(['demo', 'run', expected.name, '--json'], {
      cwd: root,
      dataHomePath,
    });
    assert.equal(demo.error, undefined, expected.name);
    assert.equal(demo.status, 0, `${expected.name}: ${demo.stderr}`);
    assert.equal(demo.stderr, '');
    const envelope = parseSingleJsonDocument(demo.stdout);
    assert.equal(field(envelope, 'kind'), 'DEMO_RESULT');
    const proof = field(envelope, 'result');
    assert.equal(field(proof, 'scenario'), expected.name);
    assert.equal(field(proof, 'passed'), true);
    assert.equal(field(proof, 'proofCode'), expected.proofCode);
    const finalStatus = field(proof, 'finalStatus');
    const reopenedStatus = field(proof, 'reopenedStatus');
    assert.equal(field(finalStatus, 'runStatus'), expected.runStatus);
    assert.equal(field(finalStatus, 'technicalCloseout'), expected.technicalCloseout);
    assert.deepEqual(reopenedStatus, finalStatus);
    const audit = field(proof, 'audit');
    assert.equal(field(audit, 'goalId'), field(proof, 'goalId'));
    assert.ok(Number(field(audit, 'throughSequence')) > 0);
  }
  assert.equal(existsSync(dataHomePath), false);

  const human = runCli(['demo', 'run', 'candidate-drift'], { cwd: root, dataHomePath });
  assert.equal(human.status, 0, human.stderr);
  assert.equal(human.stderr, '');
  assert.match(human.stdout, /Proof code: CANDIDATE_DRIFT_INVALIDATED/);
  assert.match(human.stdout, /Technical closeout: no/);
  assert.equal(human.stdout.includes('\u001B['), false);
  assert.equal(existsSync(dataHomePath), false);
});

void test('unknown demo scenario fails as usage before any proof authority opens', (t) => {
  const root = temporaryRoot(t);
  const dataHomePath = join(root, 'ordinary-authority-must-remain-absent');
  const result = runCli(['demo', 'run', 'unknown-scenario', '--json'], {
    cwd: root,
    dataHomePath,
  });

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  assert.equal(field(field(parseSingleJsonDocument(result.stdout), 'error'), 'code'), 'CLI_USAGE');
  assert.equal(existsSync(dataHomePath), false);
});

void test('usage failure is JSON-safe, exits 2, and opens no authority', (t) => {
  const root = temporaryRoot(t);
  const dataHomePath = join(root, 'authority');
  mkdirSync(join(root, 'project'), { mode: 0o700 });

  const result = runCli(
    ['goal', 'create', '--objective', 'Missing criterion', '--project', 'project', '--json'],
    { cwd: root, dataHomePath },
  );

  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, '');
  const envelope = parseSingleJsonDocument(result.stdout);
  assert.equal(field(envelope, 'kind'), 'CLI_ERROR');
  assert.equal(field(field(envelope, 'error'), 'code'), 'CLI_USAGE');
  assert.equal(existsSync(dataHomePath), false);
});

void test('a well-formed missing Goal is a rejected read, not success or infrastructure failure', (t) => {
  const root = temporaryRoot(t);
  const dataHomePath = join(root, 'authority');

  const result = runCli(['goal', 'status', 'goal_missing', '--json'], {
    cwd: root,
    dataHomePath,
  });

  assert.equal(result.status, 3, result.stderr);
  assert.equal(result.stderr, '');
  const envelope = parseSingleJsonDocument(result.stdout);
  assert.equal(field(envelope, 'kind'), 'GOAL_STATUS');
  assert.equal(field(field(envelope, 'result'), 'status'), 'NOT_FOUND');
});

void test('composition failure exits 5 and keeps JSON separate from diagnostics', (t) => {
  const root = temporaryRoot(t);
  const result = runCli(['goal', 'status', 'goal_missing', '--json'], {
    cwd: root,
    dataHomePath: 'relative-authority',
  });

  assert.equal(result.status, 5);
  const envelope = parseSingleJsonDocument(result.stdout);
  assert.equal(field(envelope, 'kind'), 'CLI_ERROR');
  assert.equal(field(field(envelope, 'error'), 'code'), 'CLI_INTERNAL_FAILURE');
  assert.match(result.stderr, /^CodeClosure diagnostic:/);
});
