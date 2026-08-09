import assert from 'node:assert/strict';
import { execFileSync, fork } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  ProjectReadLifecyclePolicy,
  ProjectReadModelUsableNetworkPolicy,
  ProjectReadRetentionPolicy,
  ProjectReadSnapshotAccessMode,
  ProjectReadSnapshotCleanupEligibilityKind,
  ProjectReadSnapshotCleanupLifecyclePolicy,
  ProjectReadSourceCheckoutAccess,
  WorkflowPhase,
  auditEventId,
  attemptId,
  decodeProjectReadSnapshotCleanupGrant,
  decodeProjectSourceReadAuthorityRecord,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  projectReadSnapshotCleanupGrantId,
  projectReadSnapshotCleanupGrantProjection,
  projectReadSnapshotId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectSourceReadAuthorityId,
  projectSourceReadAuthorityProjection,
  sha256Digest,
  workflowId,
  workflowVersion,
  type ProjectReadSnapshotCleanupGrant,
  type ProjectSourceReadAuthorityRecord,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  ProjectReadSnapshotCleanupCoordinatorStatus,
  ProjectReadSnapshotCleanupResolutionKind,
  ProjectReadWorkspaceClassification,
  createProjectReadOwnershipMarker,
} from '@codeclosure/runtime';
import { createProjectReadSnapshotCleanupCoordinator } from '@codeclosure/runtime/composition';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';
import { DeterministicClock, DeterministicIds } from '@codeclosure/testing';
import type { LocalProjectReadWorkspaceOptions } from '@codeclosure/workspace-local';
import {
  captureProjectReadSourceSnapshotForTesting,
  createLocalProjectReadWorkspaceForTesting,
} from '@codeclosure/workspace-local/testing';

const digests = new CanonicalJsonSha256DigestProvider();
const concurrentCoordinatorChildEntry = fileURLToPath(
  new URL('./fixtures/project-read-cleanup-coordinator-child.mjs', import.meta.url),
);
const concurrentCoordinatorTimeoutMilliseconds = 10_000;

interface IntegrationFixture {
  readonly authorityRoot: string;
  readonly databaseFile: string;
  readonly options: LocalProjectReadWorkspaceOptions;
  readonly processBarrierRoot: string;
  readonly sourceRoot: string;
}

function git(root: string, arguments_: readonly string[]): void {
  execFileSync('git', arguments_, {
    cwd: root,
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    },
    stdio: 'ignore',
  });
}

function fixture(t: TestContext): IntegrationFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-cleanup-runtime-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sourceRoot = join(root, 'source');
  const authorityRoot = join(root, 'authority');
  const processBarrierRoot = join(root, 'process-barrier');
  const workspaceRoot = join(root, 'project-read-workspace');
  mkdirSync(join(sourceRoot, 'src'), { recursive: true });
  mkdirSync(authorityRoot);
  mkdirSync(processBarrierRoot, { mode: 0o700 });
  writeFileSync(join(sourceRoot, 'README.md'), '# cleanup coordinator fixture\n');
  writeFileSync(join(sourceRoot, 'src', 'value.ts'), 'export const value = 1;\n');
  git(sourceRoot, ['init', '--quiet']);
  git(sourceRoot, ['config', 'user.name', 'CodeClosure Test']);
  git(sourceRoot, ['config', 'user.email', 'codeclosure@example.invalid']);
  git(sourceRoot, ['add', '.']);
  git(sourceRoot, ['commit', '--quiet', '-m', 'fixture']);
  return {
    authorityRoot: realpathSync(authorityRoot),
    databaseFile: join(authorityRoot, 'state.sqlite'),
    options: Object.freeze({
      authorityRoots: Object.freeze([realpathSync(authorityRoot)]),
      ownerId: 'project-read-owner_cleanup-runtime',
      workspaceRoot,
    }),
    processBarrierRoot: realpathSync(processBarrierRoot),
    sourceRoot: realpathSync(sourceRoot),
  };
}

function projectReadRecord(
  value: IntegrationFixture,
  workspace: ReturnType<typeof createLocalProjectReadWorkspaceForTesting>,
): ProjectSourceReadAuthorityRecord {
  const source = captureProjectReadSourceSnapshotForTesting(value.sourceRoot);
  const id = projectSourceReadAuthorityId('project-read_cleanup-runtime-integration');
  const snapshotId = projectReadSnapshotId('project-read-snapshot_cleanup-runtime-integration');
  const snapshotLeafRealpath = workspace.snapshotLeafFor(snapshotId);
  const marker = createProjectReadOwnershipMarker({
    schemaVersion: 1,
    profile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    projectReadAuthorityId: id,
    snapshotId,
    workspaceRootIdentity: value.options.workspaceRoot,
    snapshotLeafRealpath,
    snapshotTreeDigest: source.sourceTree.projectionDigest,
  });
  const withoutDigest = {
    schemaVersion: 1 as const,
    id,
    goalId: goalId('goal_cleanup-runtime-integration'),
    goalRevision: goalRevision(1),
    workflowId: workflowId('workflow_cleanup-runtime-integration'),
    workflowVersion: workflowVersion(1),
    phase: WorkflowPhase.DISCOVERY,
    attemptId: attemptId('attempt_cleanup-runtime-integration'),
    normalizedProjectRoot: value.sourceRoot,
    resolvedProjectRoot: value.sourceRoot,
    repositoryControlRootIdentity: source.gitState.repositoryControlRootIdentity,
    sourceTree: source.sourceTree,
    gitState: source.gitState,
    workspaceRootIdentity: value.options.workspaceRoot,
    snapshotId,
    snapshotLeafRealpath,
    snapshotTreeDigest: source.sourceTree.projectionDigest,
    ownershipMarkerProfile: marker.profile,
    ownershipMarkerDigest: marker.markerDigest,
    policyBundleId: policyBundleId('policy_cleanup-runtime-integration'),
    policyBundleVersion: 'm2.5.1-v1',
    policyBundleDigest: sha256Digest(`sha256:${'1'.repeat(64)}`),
    executionProfileId: executionProfileId('profile_cleanup-runtime-integration'),
    executionProfileVersion: 'm2.5.1-v3',
    executionProfileDigest: sha256Digest(`sha256:${'2'.repeat(64)}`),
    phaseDispatchEntryDigest: sha256Digest(`sha256:${'3'.repeat(64)}`),
    capabilityGrantDigest: sha256Digest(`sha256:${'4'.repeat(64)}`),
    responseContractDigest: sha256Digest(`sha256:${'5'.repeat(64)}`),
    accessMode: ProjectReadSnapshotAccessMode.READ_ONLY,
    sourceCheckoutAccess: ProjectReadSourceCheckoutAccess.NONE,
    modelUsableNetworkPolicy: ProjectReadModelUsableNetworkPolicy.DENIED,
    forbiddenRoots: Object.freeze([value.authorityRoot, value.sourceRoot].toSorted()),
    isolationProfileId: 'codex-project-read-isolation-v1',
    isolationProfileDigest: sha256Digest(`sha256:${'6'.repeat(64)}`),
    issuedAt: isoTimestamp('2026-08-09T10:00:00.000Z'),
    lifecyclePolicy: ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT,
    retentionPolicy: ProjectReadRetentionPolicy.RUNTIME_OWNED,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
  } satisfies Omit<ProjectSourceReadAuthorityRecord, 'recordDigest'>;
  return decodeProjectSourceReadAuthorityRecord({
    ...withoutDigest,
    recordDigest: digests.digest(projectSourceReadAuthorityProjection(withoutDigest)),
  });
}

function orphanGrant(
  record: ProjectSourceReadAuthorityRecord,
  authority: ReturnType<
    ReturnType<typeof openSqliteControlStore>['getProjectReadWorkspaceAuthoritySnapshot']
  >,
  observation: ReturnType<
    ReturnType<typeof openSqliteControlStore>['getProjectReadWorkspaceObservation']
  >,
): ProjectReadSnapshotCleanupGrant {
  assert.ok(authority !== undefined);
  assert.ok(observation !== undefined);
  const withoutDigest = {
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupGrantId('project-read-cleanup-grant_cleanup-runtime-integration'),
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.ORPHANED,
    authoritySnapshotId: authority.id,
    authoritySnapshotDigest: authority.authorityDigest,
    authoritySequence: authority.authoritySequence,
    projectReadAuthorityId: record.id,
    snapshotId: record.snapshotId,
    workspaceRootIdentity: record.workspaceRootIdentity,
    snapshotLeafRealpath: record.snapshotLeafRealpath,
    ownershipMarkerProfile: record.ownershipMarkerProfile,
    ownershipMarkerDigest: record.ownershipMarkerDigest,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt: isoTimestamp('2026-08-09T10:00:04.000Z'),
    workspaceObservationId: observation.id,
    workspaceObservationDigest: observation.observationDigest,
  } satisfies Omit<
    Extract<ProjectReadSnapshotCleanupGrant, { eligibilityKind: 'ORPHANED' }>,
    'grantDigest'
  >;
  return decodeProjectReadSnapshotCleanupGrant(
    {
      ...withoutDigest,
      grantDigest: digests.digest(projectReadSnapshotCleanupGrantProjection(withoutDigest)),
    },
    digests,
  );
}

interface PreparedCleanup {
  readonly grant: ProjectReadSnapshotCleanupGrant;
  readonly record: ProjectSourceReadAuthorityRecord;
  readonly store: ReturnType<typeof openSqliteControlStore>;
  readonly value: IntegrationFixture;
  readonly workspace: ReturnType<typeof createLocalProjectReadWorkspaceForTesting>;
}

function prepareCleanup(t: TestContext): PreparedCleanup {
  const value = fixture(t);
  const workspace = createLocalProjectReadWorkspaceForTesting(value.options, {
    now: () => '2026-08-09T10:00:02.000Z',
  });
  const record = projectReadRecord(value, workspace);
  workspace.materializeSnapshot(record);
  assert.equal(existsSync(record.snapshotLeafRealpath), true);
  const store = openSqliteControlStore({ filename: value.databaseFile });
  t.after(() => store.close());
  const captured = store.captureProjectReadWorkspaceAuthoritySnapshot({
    id: projectReadWorkspaceAuthoritySnapshotId(
      'project-read-authority-snapshot_cleanup-runtime-integration',
    ),
    issuedAt: isoTimestamp('2026-08-09T10:00:01.000Z'),
    auditEventId: auditEventId('audit_cleanup-runtime-authority'),
  });
  assert.equal(captured.status, 'ISSUED');
  const observations = workspace.reconcile(captured.value);
  assert.equal(observations.length, 1);
  assert.equal(observations[0]?.classification, ProjectReadWorkspaceClassification.OWNED_ORPHANED);
  const observation = observations[0];
  const recorded = store.recordProjectReadWorkspaceObservation({
    observation,
    auditEventId: auditEventId('audit_cleanup-runtime-workspace-observation'),
  });
  assert.equal(recorded.status, 'RECORDED');
  const grant = orphanGrant(record, captured.value, recorded.value);
  const issued = store.issueProjectReadSnapshotCleanupGrant({
    grant,
    auditEventId: auditEventId('audit_cleanup-runtime-grant'),
  });
  assert.equal(issued.status, 'ISSUED');
  return Object.freeze({ grant, record, store, value, workspace });
}

interface ConcurrentCoordinatorResult {
  readonly pid: number;
  readonly status: string;
  readonly resolutionKind: string | null;
  readonly reasonCode: string | null;
  readonly outcomeDigest: string | null;
  readonly portInvoked: boolean;
}

interface ConcurrentCoordinatorProcess {
  readonly ready: Promise<number>;
  readonly result: Promise<ConcurrentCoordinatorResult>;
  start(): void;
  stop(): void;
}

function messageField(message: object, key: string): unknown {
  return Reflect.get(message, key) as unknown;
}

function startConcurrentCoordinatorProcess(
  value: IntegrationFixture,
  grant: ProjectReadSnapshotCleanupGrant,
): ConcurrentCoordinatorProcess {
  const child = fork(concurrentCoordinatorChildEntry, [], {
    serialization: 'json',
    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
  });
  let readySettled = false;
  let resultSettled = false;
  let observedResult: ConcurrentCoordinatorResult | undefined;
  let resolveReady!: (pid: number) => void;
  let rejectReady!: (error: Error) => void;
  let resolveResult!: (result: ConcurrentCoordinatorResult) => void;
  let rejectResult!: (error: Error) => void;
  const ready = new Promise<number>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise<ConcurrentCoordinatorResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const clearProcessTimeout = (): void => {
    if (timeout !== undefined) {
      clearTimeout(timeout);
      timeout = undefined;
    }
  };
  const fail = (error: Error): void => {
    clearProcessTimeout();
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    if (!resultSettled) {
      resultSettled = true;
      rejectResult(error);
    }
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  };
  timeout = setTimeout(() => {
    fail(new Error('Cleanup coordinator child process timed out'));
  }, concurrentCoordinatorTimeoutMilliseconds);
  const stop = (): void => {
    clearProcessTimeout();
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
    }
  };
  child.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null) {
      fail(new Error('Cleanup coordinator child returned a malformed message'));
      return;
    }
    const kind = messageField(message, 'kind');
    if (kind === 'READY') {
      const pid = messageField(message, 'pid');
      if (typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid <= 0) {
        fail(new Error('Cleanup coordinator child returned an invalid process identity'));
        return;
      }
      if (!readySettled) {
        readySettled = true;
        resolveReady(pid);
      }
      return;
    }
    if (kind === 'ERROR') {
      const rawMessage = messageField(message, 'message');
      fail(new Error(typeof rawMessage === 'string' ? rawMessage : 'Cleanup worker failed'));
      return;
    }
    if (kind === 'RESULT') {
      const pid = messageField(message, 'pid');
      const status = messageField(message, 'status');
      const resolutionKind = messageField(message, 'resolutionKind');
      const reasonCode = messageField(message, 'reasonCode');
      const outcomeDigest = messageField(message, 'outcomeDigest');
      const portInvoked = messageField(message, 'portInvoked');
      if (
        typeof pid !== 'number' ||
        !Number.isSafeInteger(pid) ||
        pid <= 0 ||
        typeof status !== 'string' ||
        (typeof resolutionKind !== 'string' && resolutionKind !== null) ||
        (typeof reasonCode !== 'string' && reasonCode !== null) ||
        (typeof outcomeDigest !== 'string' && outcomeDigest !== null) ||
        typeof portInvoked !== 'boolean'
      ) {
        fail(new Error('Cleanup coordinator child returned an invalid result'));
        return;
      }
      if (observedResult !== undefined) {
        fail(new Error('Cleanup coordinator child returned more than one result'));
        return;
      }
      observedResult = Object.freeze({
        pid,
        status,
        resolutionKind,
        reasonCode,
        outcomeDigest,
        portInvoked,
      });
      return;
    }
    fail(new Error('Cleanup coordinator child returned an unknown message'));
  });
  child.on('error', fail);
  child.on('close', (code, signal) => {
    if (code !== 0) {
      fail(new Error(`Cleanup coordinator child exited with ${String(code)} / ${String(signal)}`));
    } else if (observedResult === undefined) {
      fail(new Error('Cleanup coordinator child exited without a result'));
    } else if (!resultSettled) {
      clearProcessTimeout();
      resultSettled = true;
      resolveResult(observedResult);
    }
  });
  child.send(
    {
      kind: 'PREPARE',
      databaseFile: value.databaseFile,
      options: value.options,
      processBarrierRoot: value.processBarrierRoot,
    },
    (error) => {
      if (error !== null) {
        fail(error);
      }
    },
  );
  return Object.freeze({
    ready,
    result,
    start(): void {
      child.send({ kind: 'START', grant }, (error) => {
        if (error !== null) {
          fail(error);
        }
      });
    },
    stop,
  });
}

void test('Cleanup Runtime composes exact orphan authority, local effect, Store Outcome, and reopen replay', (t) => {
  const { grant, record, store, value, workspace } = prepareCleanup(t);

  let portCalls = 0;
  const coordinator = createProjectReadSnapshotCleanupCoordinator({
    store,
    workspace: {
      cleanupSnapshot: (request) => {
        portCalls += 1;
        return workspace.cleanupSnapshot(request);
      },
    },
    clock: new DeterministicClock(['2026-08-09T10:00:06.000Z']),
    ids: new DeterministicIds('cleanup-runtime-integration'),
    digests,
  });
  const applied = coordinator.resolve({ grant });
  assert.equal(applied.status, ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED);
  assert.equal(applied.resolutionKind, ProjectReadSnapshotCleanupResolutionKind.APPLIED);
  assert.equal(applied.portInvoked, true);
  assert.equal(existsSync(record.snapshotLeafRealpath), false);
  assert.equal(
    store.getProjectReadSnapshotCleanupOutcome(grant.id)?.outcomeDigest,
    applied.outcome.outcomeDigest,
  );

  const replay = coordinator.resolve({ grant });
  assert.equal(replay.status, ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED);
  assert.equal(replay.resolutionKind, ProjectReadSnapshotCleanupResolutionKind.RETAINED_REPLAY);
  assert.equal(replay.portInvoked, false);
  assert.equal(portCalls, 1);

  store.close();
  const reopened = openSqliteControlStore({ filename: value.databaseFile });
  t.after(() => reopened.close());
  let reopenedPortCalls = 0;
  const reopenedCoordinator = createProjectReadSnapshotCleanupCoordinator({
    store: reopened,
    workspace: {
      cleanupSnapshot: () => {
        reopenedPortCalls += 1;
        throw new Error('resolved cleanup must not call the Workspace port');
      },
    },
    clock: new DeterministicClock(['2026-08-09T10:00:07.000Z']),
    ids: new DeterministicIds('cleanup-runtime-reopen'),
    digests,
  });
  const reopenedReplay = reopenedCoordinator.resolve({ grant });
  assert.equal(reopenedReplay.status, ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED);
  assert.equal(
    reopenedReplay.resolutionKind,
    ProjectReadSnapshotCleanupResolutionKind.RETAINED_REPLAY,
  );
  assert.equal(reopenedReplay.outcome.outcomeDigest, applied.outcome.outcomeDigest);
  assert.equal(reopenedPortCalls, 0);
});

void test('separate Cleanup Runtime processes share one Grant, filesystem effect, and Store winner', async (t) => {
  const { grant, record, store, value } = prepareCleanup(t);
  const first = startConcurrentCoordinatorProcess(value, grant);
  const second = startConcurrentCoordinatorProcess(value, grant);
  t.after(() => {
    first.stop();
    second.stop();
  });
  const processIds = await Promise.all([first.ready, second.ready]);
  first.start();
  second.start();
  const results = await Promise.all([first.result, second.result]);
  assert.notEqual(processIds[0], process.pid);
  assert.notEqual(processIds[1], process.pid);
  assert.notEqual(processIds[0], processIds[1]);
  assert.deepEqual(
    results.map(({ pid }) => pid).toSorted((left, right) => left - right),
    processIds.toSorted((left, right) => left - right),
  );

  const retainedOutcome = store.getProjectReadSnapshotCleanupOutcome(grant.id);
  assert.ok(retainedOutcome !== undefined);
  assert.equal(existsSync(record.snapshotLeafRealpath), false);
  assert.equal(
    results.filter(
      (result) =>
        result.status === ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED &&
        result.resolutionKind === ProjectReadSnapshotCleanupResolutionKind.APPLIED,
    ).length,
    1,
  );
  for (const result of results) {
    assert.equal(result.portInvoked, true);
    if (result.status === ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED) {
      assert.equal(result.outcomeDigest, retainedOutcome.outcomeDigest);
      assert.equal(result.reasonCode, null);
      continue;
    }
    assert.equal(result.status, ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED);
    assert.equal(result.reasonCode, 'NO_TERMINAL_OBSERVATION');
    assert.equal(result.outcomeDigest, null);
  }

  let replayPortCalls = 0;
  const replayCoordinator = createProjectReadSnapshotCleanupCoordinator({
    store,
    workspace: {
      cleanupSnapshot: () => {
        replayPortCalls += 1;
        throw new Error('retained concurrent winner must suppress the port');
      },
    },
    clock: new DeterministicClock(['2026-08-09T10:00:08.000Z']),
    ids: new DeterministicIds('cleanup-runtime-concurrent-replay'),
    digests,
  });
  const replay = replayCoordinator.resolve({ grant });
  assert.equal(replay.status, ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED);
  assert.equal(replay.resolutionKind, ProjectReadSnapshotCleanupResolutionKind.RETAINED_REPLAY);
  assert.equal(replay.outcome.outcomeDigest, retainedOutcome.outcomeDigest);
  assert.equal(replayPortCalls, 0);
});
