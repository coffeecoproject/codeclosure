import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as wait } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import {
  WorkflowDriveStopReason,
  parseGoalIdentifier,
  type GoalStatusView,
  type WorkflowDriveSummary,
} from '@codeclosure/runtime';

import { CliDemoProofCode, type CliDemoProofResult } from '../cli/contracts.js';
import { ProtectedPathKind } from './data-home.js';
import { assertM1ProofReopen } from './m1-demo-proof-helpers.js';
import { createM1ProofReadFacade, type M1ProofReadFacade } from './m1-proof-read-facade.js';
import { assertFreshReplacementDispatch } from './m1-restart-proof-assertions.js';
import {
  completeM1ProofChildProcess,
  spawnM1ProofChildProcess,
  stopM1ProofChildProcess,
  waitForM1ProofChildProcessClose,
  type CompletedM1ProofChildProcess,
  type RunningM1ProofChildProcess,
} from './m1-proof-child-process.js';
import {
  observeClaimedActiveAttempt,
  type ClaimedActiveAttemptObservation,
  type M1RestartProofObservationOptions,
} from './m1-restart-proof-observer.js';
import type { CreateCliCompositionOptions } from './trusted-composition.js';

const CLI_ENTRY_POINT = fileURLToPath(new URL('../index.js', import.meta.url));
const RETAINED_DISPATCH_TIMEOUT_MILLISECONDS = 10_000;
const CLI_COMMAND_TIMEOUT_MILLISECONDS = 15_000;
const PROCESS_EXIT_TIMEOUT_MILLISECONDS = 5_000;
const MAX_CLI_OUTPUT_BYTES = 1024 * 1024;

function field(value: unknown, name: string): unknown {
  if (value === null || typeof value !== 'object') {
    throw new TypeError(`CLI proof ${name} owner must be an object`);
  }
  return Reflect.get(value, name);
}

function parseSingleJsonDocument(output: string, operation: string): unknown {
  const document = output.trim();
  if (document.length === 0 || document.split('\n').length !== 1) {
    throw new TypeError(`${operation} did not emit exactly one JSON document`);
  }
  try {
    const parsed: unknown = JSON.parse(document);
    return parsed;
  } catch (error) {
    throw new TypeError(`${operation} emitted invalid JSON`, { cause: error });
  }
}

function spawnPublicCliProcess(
  runRoot: string,
  dataHomePath: string,
  args: readonly string[],
): RunningM1ProofChildProcess {
  return spawnM1ProofChildProcess({
    executable: process.execPath,
    args: [CLI_ENTRY_POINT, ...args],
    cwd: runRoot,
    environment: { ...process.env, CODECLOSURE_HOME: dataHomePath },
    maxOutputBytes: MAX_CLI_OUTPUT_BYTES,
  });
}

function ensureProcessStopped(running: RunningM1ProofChildProcess | undefined): Promise<void> {
  return stopM1ProofChildProcess(running, 1_000, 'CLI proof process did not stop during cleanup');
}

async function runCliProcess(
  runRoot: string,
  dataHomePath: string,
  args: readonly string[],
): Promise<CompletedM1ProofChildProcess> {
  const running = spawnPublicCliProcess(runRoot, dataHomePath, args);
  return completeM1ProofChildProcess(running, {
    operation: `CodeClosure CLI command: ${args.join(' ')}`,
    timeoutMilliseconds: CLI_COMMAND_TIMEOUT_MILLISECONDS,
    cleanupTimeoutMilliseconds: 1_000,
  });
}

function requireSuccessfulCliJson(
  result: CompletedM1ProofChildProcess,
  operation: string,
): unknown {
  if (result.status !== 0 || result.signal !== null || result.stderr !== '') {
    throw new TypeError(
      `${operation} did not complete through the public CLI contract (status ${String(result.status)}, signal ${String(result.signal)})`,
    );
  }
  return parseSingleJsonDocument(result.stdout, operation);
}

async function createGoalThroughPublicCli(
  runRoot: string,
  dataHomePath: string,
): Promise<GoalStatusView['goalId']> {
  const envelope = requireSuccessfulCliJson(
    await runCliProcess(runRoot, dataHomePath, [
      'goal',
      'create',
      '--objective',
      'Prove restart recovery never redispatches retained work',
      '--project',
      'project',
      '--criterion',
      'Explicit resume creates fresh work after startup reconciliation',
      '--json',
    ]),
    'goal create',
  );
  if (field(envelope, 'kind') !== 'COMMAND_RESULT') {
    throw new TypeError('Restart proof goal create returned the wrong envelope kind');
  }
  const output = field(field(envelope, 'result'), 'output');
  if (field(output, 'ok') !== true) {
    throw new TypeError('Restart proof goal create was not applied');
  }
  const rawGoalId = field(output, 'goalId');
  if (typeof rawGoalId !== 'string') {
    throw new TypeError('Restart proof goal create returned no GoalId');
  }
  return parseGoalIdentifier(rawGoalId);
}

function startPublicCliProcess(
  runRoot: string,
  dataHomePath: string,
  goalId: GoalStatusView['goalId'],
): RunningM1ProofChildProcess {
  return spawnPublicCliProcess(runRoot, dataHomePath, [
    'goal',
    'start',
    goalId,
    '--fixture',
    'restart-resume',
    '--json',
  ]);
}

async function waitForClaimedActiveAttempt(
  options: M1RestartProofObservationOptions,
  goalId: GoalStatusView['goalId'],
  running: RunningM1ProofChildProcess,
): Promise<ClaimedActiveAttemptObservation> {
  const deadline = Date.now() + RETAINED_DISPATCH_TIMEOUT_MILLISECONDS;
  while (Date.now() < deadline) {
    if (running.child.exitCode !== null || running.child.signalCode !== null) {
      const exited = await waitForM1ProofChildProcessClose(
        running,
        PROCESS_EXIT_TIMEOUT_MILLISECONDS,
        'Public goal start streams did not close after early exit',
      );
      throw new TypeError(
        `Public goal start exited before retaining a dispatch (status ${String(exited.code)}, signal ${String(exited.signal)}, stdout bytes ${String(Buffer.byteLength(running.stdout()))}, stderr bytes ${String(Buffer.byteLength(running.stderr()))})`,
      );
    }
    const result = observeClaimedActiveAttempt(options, goalId);
    switch (result.status) {
      case 'OBSERVED':
        return result.observation;
      case 'NOT_YET_RETAINED':
      case 'TEMPORARILY_BUSY':
        break;
    }
    await wait(20);
  }
  throw new TypeError('Public goal start did not retain a dispatch before the proof timeout');
}

async function interruptPublicStart(running: RunningM1ProofChildProcess): Promise<void> {
  if (!running.child.kill()) {
    throw new TypeError('Could not terminate the public goal start process');
  }
  const exited = await waitForM1ProofChildProcessClose(
    running,
    PROCESS_EXIT_TIMEOUT_MILLISECONDS,
    'Public goal start did not terminate after interruption',
  );
  const spawnError = running.spawnError();
  if (spawnError !== undefined) {
    throw new TypeError('Public goal start could not be spawned', { cause: spawnError });
  }
  const outputError = running.outputError();
  if (outputError !== undefined) {
    throw outputError;
  }
  if (exited.code === 0 && exited.signal === null) {
    throw new TypeError('Public goal start completed instead of being interrupted');
  }
  if (running.stdout() !== '' || running.stderr() !== '') {
    throw new TypeError(
      'Interrupted public goal start emitted a partial CLI document or diagnostic',
    );
  }
}

function requireBlockedPublicStatus(envelope: unknown, goalId: GoalStatusView['goalId']): void {
  if (field(envelope, 'kind') !== 'GOAL_STATUS') {
    throw new TypeError('Recovery status returned the wrong public CLI envelope');
  }
  const result = field(envelope, 'result');
  if (field(result, 'status') !== 'FOUND') {
    throw new TypeError('Recovery status could not find its Goal');
  }
  const view = field(result, 'view');
  if (
    field(view, 'goalId') !== goalId ||
    field(view, 'phase') !== 'DISCOVERY' ||
    field(view, 'runStatus') !== 'BLOCKED' ||
    field(view, 'nextSafeAction') !== 'RESUME_GOAL' ||
    field(view, 'technicalCloseout') !== false
  ) {
    throw new TypeError('Recovery status did not expose the exact blocked resume boundary');
  }
}

function requireAppliedResumeDrive(envelope: unknown): unknown {
  if (
    field(envelope, 'kind') !== 'DRIVEN_COMMAND_RESULT' ||
    field(envelope, 'operation') !== 'goal resume'
  ) {
    throw new TypeError('Public goal resume returned the wrong CLI envelope');
  }
  const result = field(envelope, 'result');
  if (field(field(result, 'command'), 'status') !== 'APPLIED') {
    throw new TypeError('Public goal resume was not applied');
  }
  const output = field(field(result, 'command'), 'output');
  if (field(output, 'ok') !== true) {
    throw new TypeError('Public goal resume returned a failed command outcome');
  }
  return field(result, 'drive');
}

function requireClosedDrive(rawDrive: unknown, finalStatus: GoalStatusView): WorkflowDriveSummary {
  const rawFinalState = field(rawDrive, 'finalState');
  const operationCount = field(rawDrive, 'operationCount');
  const detailCode = field(rawDrive, 'detailCode');
  if (
    field(rawDrive, 'schemaVersion') !== 1 ||
    field(rawDrive, 'goalId') !== finalStatus.goalId ||
    field(rawDrive, 'stopReason') !== WorkflowDriveStopReason.CLOSED ||
    typeof operationCount !== 'number' ||
    !Number.isSafeInteger(operationCount) ||
    operationCount < 1 ||
    typeof detailCode !== 'string' ||
    detailCode.length === 0 ||
    field(rawFinalState, 'workflowVersion') !== finalStatus.workflowVersion ||
    field(rawFinalState, 'phase') !== finalStatus.phase ||
    field(rawFinalState, 'runStatus') !== finalStatus.runStatus
  ) {
    throw new TypeError('Public goal resume did not return the exact closed driver summary');
  }
  return Object.freeze({
    schemaVersion: 1,
    goalId: finalStatus.goalId,
    operationCount,
    stopReason: WorkflowDriveStopReason.CLOSED,
    detailCode,
    finalState: Object.freeze({
      workflowVersion: finalStatus.workflowVersion,
      phase: finalStatus.phase,
      runStatus: finalStatus.runStatus,
    }),
  });
}

function readProofAuthority(
  options: CreateCliCompositionOptions,
  goalId: GoalStatusView['goalId'],
): M1ProofReadFacade {
  return createM1ProofReadFacade(options, goalId);
}

export async function runM1RestartResumeProof(): Promise<CliDemoProofResult> {
  const runRoot = mkdtempSync(join(tmpdir(), 'codeclosure-m1-restart-resume-'));
  const projectPath = join(runRoot, 'project');
  const dataHomePath = join(runRoot, 'authority');
  mkdirSync(projectPath, { mode: 0o700 });
  const compositionOptions: CreateCliCompositionOptions = Object.freeze({
    dataHomePath,
    protectedPaths: Object.freeze([
      Object.freeze({ kind: ProtectedPathKind.PROJECT, path: projectPath }),
    ]),
    allowedProjectPaths: Object.freeze([projectPath]),
    startProfileName: 'happy-path',
  });
  const observationOptions: M1RestartProofObservationOptions = Object.freeze({
    dataHomePath,
    protectedPaths: compositionOptions.protectedPaths,
    allowedProjectPaths: compositionOptions.allowedProjectPaths,
    busyTimeoutMilliseconds: 1_000,
  });
  let runningStart: RunningM1ProofChildProcess | undefined;
  try {
    const goalId = await createGoalThroughPublicCli(runRoot, dataHomePath);
    runningStart = startPublicCliProcess(runRoot, dataHomePath, goalId);
    const abandonedAttempt = await waitForClaimedActiveAttempt(
      observationOptions,
      goalId,
      runningStart,
    );
    await interruptPublicStart(runningStart);
    runningStart = undefined;

    const blockedEnvelope = requireSuccessfulCliJson(
      await runCliProcess(runRoot, dataHomePath, ['goal', 'status', goalId, '--json']),
      'goal status after restart',
    );
    requireBlockedPublicStatus(blockedEnvelope, goalId);

    // The public status process above must own startup recovery. This facade
    // refuses to return views if its own composition reconciles anything.
    const recovered = readProofAuthority(compositionOptions, goalId);
    const recoveredStatus = recovered.status;
    try {
      if (
        recoveredStatus.phase !== 'DISCOVERY' ||
        recoveredStatus.runStatus !== 'BLOCKED' ||
        recoveredStatus.activeAttemptRef !== undefined ||
        recoveredStatus.executionProfileRef?.id !== 'profile_m1-restart-resume-v2' ||
        recoveredStatus.dominantBlocker?.code !== 'RECOVERY_RECONCILIATION_REQUIRED' ||
        recoveredStatus.nextSafeAction !== 'RESUME_GOAL' ||
        recoveredStatus.technicalCloseout
      ) {
        throw new TypeError('Public restart did not retain the exact recoverable authority');
      }
    } finally {
      recovered.close();
    }

    const resumedEnvelope = requireSuccessfulCliJson(
      await runCliProcess(runRoot, dataHomePath, ['goal', 'resume', goalId, '--json']),
      'goal resume',
    );
    const rawFinalDrive = requireAppliedResumeDrive(resumedEnvelope);

    const final = readProofAuthority(compositionOptions, goalId);
    const finalStatus = final.status;
    const audit = final.audit;
    let finalDrive: WorkflowDriveSummary;
    try {
      finalDrive = requireClosedDrive(rawFinalDrive, finalStatus);
      assertFreshReplacementDispatch(audit, abandonedAttempt, recoveredStatus);
      if (
        finalStatus.phase !== 'CLOSEOUT' ||
        finalStatus.runStatus !== 'CLOSED' ||
        finalStatus.acceptanceSummary?.outcome !== 'ACCEPT' ||
        !finalStatus.technicalCloseout ||
        finalStatus.closeoutRef === undefined
      ) {
        throw new TypeError(
          'Public restart-resume proof did not close through fresh replacement work',
        );
      }
    } finally {
      final.close();
    }

    const reopened = readProofAuthority(compositionOptions, goalId);
    const reopenedStatus = reopened.status;
    try {
      assertM1ProofReopen(finalStatus, reopenedStatus, audit, reopened.audit);
    } finally {
      reopened.close();
    }

    return Object.freeze({
      schemaVersion: 1,
      scenario: 'restart-resume',
      passed: true,
      proofCode: CliDemoProofCode.RESTART_RESUME_FRESH_ATTEMPT,
      goalId,
      intermediateStatus: recoveredStatus,
      finalStatus,
      reopenedStatus,
      audit,
      finalDrive,
    });
  } finally {
    try {
      await ensureProcessStopped(runningStart);
    } finally {
      rmSync(runRoot, { force: true, recursive: true });
    }
  }
}
