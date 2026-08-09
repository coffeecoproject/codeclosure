import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { Worker } from 'node:worker_threads';

import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  AttemptStatus,
  ExternalExecutionState,
  ProjectReadLifecyclePolicy,
  ProjectReadModelUsableNetworkPolicy,
  ProjectReadRetentionPolicy,
  ProjectReadSnapshotAccessMode,
  ProjectReadSnapshotCleanupEligibilityKind,
  ProjectReadSnapshotCleanupLifecyclePolicy,
  ProjectReadSourceCheckoutAccess,
  WorkflowPhase,
  attemptId,
  decodeProjectReadSnapshotCleanupGrant,
  decodeProjectSourceReadAuthorityRecord,
  executionProfileId,
  externalExecutionId,
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
  ProjectReadWorkspaceClassification,
  ProjectReadWorkspaceRetention,
  createProjectReadOwnershipMarker,
  decodeProjectReadWorkspaceAuthoritySnapshot,
  digestProjectReadWorkspaceValue,
  projectReadWorkspaceAuthoritySnapshotProjection,
  type ProjectReadWorkspaceAuthoritySnapshot,
} from '@codeclosure/runtime';
import {
  LocalProjectReadWorkspaceError,
  LocalProjectReadWorkspaceFailureCode,
  createLocalProjectReadWorkspace,
  type LocalProjectReadWorkspace,
} from '@codeclosure/workspace-local';
import {
  captureProjectReadSourceSnapshotForTesting,
  createLocalProjectReadWorkspaceForTesting,
  type ProjectReadWorkspaceFaultHooks,
} from '@codeclosure/workspace-local/testing';

const digests = new CanonicalJsonSha256DigestProvider();
const issuedAt = isoTimestamp('2026-08-08T12:00:00.000Z');
const observedAt = '2026-08-08T12:00:10.000Z';

interface Fixture {
  readonly authorityRoot: string;
  readonly root: string;
  readonly sourceRoot: string;
  readonly workspace: LocalProjectReadWorkspace;
  readonly workspaceRoot: string;
}

function git(root: string, arguments_: readonly string[]): string {
  return execFileSync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initializeSource(sourceRoot: string): void {
  mkdirSync(join(sourceRoot, 'src'), { recursive: true });
  mkdirSync(join(sourceRoot, 'scripts'));
  writeFileSync(join(sourceRoot, '.gitignore'), 'ignored.log\n');
  writeFileSync(join(sourceRoot, 'README.md'), '# project read fixture\n');
  writeFileSync(join(sourceRoot, 'src', 'order.ts'), 'export const charge = "once";\n');
  writeFileSync(join(sourceRoot, 'scripts', 'tool.sh'), '#!/bin/sh\necho fixture\n');
  chmodSync(join(sourceRoot, 'scripts', 'tool.sh'), 0o755);
  git(sourceRoot, ['init', '--quiet']);
  git(sourceRoot, ['config', 'user.name', 'CodeClosure Test']);
  git(sourceRoot, ['config', 'user.email', 'codeclosure@example.invalid']);
  git(sourceRoot, ['add', '.']);
  git(sourceRoot, ['commit', '--quiet', '-m', 'fixture']);
  writeFileSync(join(sourceRoot, 'src', 'order.ts'), 'export const charge = "dirty-once";\n');
  writeFileSync(join(sourceRoot, 'src', 'note.txt'), 'untracked note\n');
  writeFileSync(join(sourceRoot, 'ignored.log'), 'must not copy\n');
}

function removeFixtureRoot(root: string): void {
  if (!existsSync(root)) {
    return;
  }
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || !existsSync(current)) {
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      chmodSync(current, 0o700);
      for (const name of readdirSync(current)) {
        pending.push(join(current, name));
      }
    } else if (stat.isFile()) {
      chmodSync(current, 0o600);
    }
  }
  rmSync(root, { recursive: true, force: true });
}

function fixture(t: TestContext, hooks: ProjectReadWorkspaceFaultHooks = {}): Fixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-project-read-local-')));
  t.after(() => removeFixtureRoot(root));
  const sourceRoot = join(root, 'source');
  const authorityRoot = join(root, 'authority');
  const workspaceRoot = join(root, 'project-read-workspace');
  mkdirSync(sourceRoot);
  mkdirSync(authorityRoot);
  initializeSource(sourceRoot);
  const options = {
    authorityRoots: Object.freeze([realpathSync(authorityRoot)]),
    ownerId: 'project-read-owner_test',
    workspaceRoot,
  } as const;
  return {
    authorityRoot,
    root,
    sourceRoot,
    workspace:
      Object.keys(hooks).length === 0
        ? createLocalProjectReadWorkspace(options)
        : createLocalProjectReadWorkspaceForTesting(options, hooks),
    workspaceRoot,
  };
}

function authorityRecord(value: Fixture, suffix: string): ProjectSourceReadAuthorityRecord {
  const snapshot = captureProjectReadSourceSnapshotForTesting(value.sourceRoot);
  const id = projectSourceReadAuthorityId(`project-read_${suffix}`);
  const snapshotId = projectReadSnapshotId(`project-read-snapshot_${suffix}`);
  const snapshotLeafRealpath = value.workspace.snapshotLeafFor(snapshotId);
  const marker = createProjectReadOwnershipMarker({
    schemaVersion: 1,
    profile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    projectReadAuthorityId: id,
    snapshotId,
    workspaceRootIdentity: value.workspaceRoot,
    snapshotLeafRealpath,
    snapshotTreeDigest: snapshot.sourceTree.projectionDigest,
  });
  const withoutDigest = {
    schemaVersion: 1 as const,
    id,
    goalId: goalId(`goal_${suffix}`),
    goalRevision: goalRevision(1),
    workflowId: workflowId(`workflow_${suffix}`),
    workflowVersion: workflowVersion(1),
    phase: WorkflowPhase.DISCOVERY,
    attemptId: attemptId(`attempt_${suffix}`),
    normalizedProjectRoot: value.sourceRoot,
    resolvedProjectRoot: value.sourceRoot,
    repositoryControlRootIdentity: snapshot.gitState.repositoryControlRootIdentity,
    sourceTree: snapshot.sourceTree,
    gitState: snapshot.gitState,
    workspaceRootIdentity: value.workspaceRoot,
    snapshotId,
    snapshotLeafRealpath,
    snapshotTreeDigest: snapshot.sourceTree.projectionDigest,
    ownershipMarkerProfile: marker.profile,
    ownershipMarkerDigest: marker.markerDigest,
    policyBundleId: policyBundleId(`policy_${suffix}`),
    policyBundleVersion: 'm2.5.1-v1',
    policyBundleDigest: sha256Digest(`sha256:${'1'.repeat(64)}`),
    executionProfileId: executionProfileId(`profile_${suffix}`),
    executionProfileVersion: 'm2.5.1-v3',
    executionProfileDigest: sha256Digest(`sha256:${'2'.repeat(64)}`),
    phaseDispatchEntryDigest: sha256Digest(`sha256:${'3'.repeat(64)}`),
    capabilityGrantDigest: sha256Digest(`sha256:${'4'.repeat(64)}`),
    responseContractDigest: sha256Digest(`sha256:${'5'.repeat(64)}`),
    accessMode: ProjectReadSnapshotAccessMode.READ_ONLY,
    sourceCheckoutAccess: ProjectReadSourceCheckoutAccess.NONE,
    modelUsableNetworkPolicy: ProjectReadModelUsableNetworkPolicy.DENIED,
    forbiddenRoots: Object.freeze([value.authorityRoot, value.sourceRoot].sort()),
    isolationProfileId: 'codex-project-read-isolation-v1',
    isolationProfileDigest: sha256Digest(`sha256:${'6'.repeat(64)}`),
    issuedAt,
    lifecyclePolicy: ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT,
    retentionPolicy: ProjectReadRetentionPolicy.RUNTIME_OWNED,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
  } satisfies Omit<ProjectSourceReadAuthorityRecord, 'recordDigest'>;
  return decodeProjectSourceReadAuthorityRecord({
    ...withoutDigest,
    recordDigest: digests.digest(projectSourceReadAuthorityProjection(withoutDigest)),
  });
}

function authoritySnapshot(
  record: ProjectSourceReadAuthorityRecord,
  retention: ProjectReadWorkspaceRetention | null,
  authoritySequence: number,
  active = false,
): ProjectReadWorkspaceAuthoritySnapshot {
  const withoutDigest = {
    activeConsumers:
      retention === ProjectReadWorkspaceRetention.CURRENT && active
        ? [
            {
              attemptId: record.attemptId,
              externalExecutionId: externalExecutionId(
                `external_${record.snapshotId.split('_').at(-1) ?? 'project-read'}`,
              ),
              projectReadAuthorityId: record.id,
              snapshotId: record.snapshotId,
            },
          ]
        : [],
    authoritySequence,
    expectedSnapshots:
      retention === null
        ? []
        : [
            {
              attemptId: record.attemptId,
              authorityRecordDigest: record.recordDigest,
              ownershipMarkerDigest: record.ownershipMarkerDigest,
              ownershipMarkerProfile: record.ownershipMarkerProfile,
              projectReadAuthorityId: record.id,
              retention,
              snapshotId: record.snapshotId,
              snapshotLeafRealpath: record.snapshotLeafRealpath,
              workspaceRootIdentity: record.workspaceRootIdentity,
            },
          ],
    id: projectReadWorkspaceAuthoritySnapshotId(
      `project-read-authority-snapshot_local-${String(authoritySequence)}`,
    ),
    issuedAt,
    schemaVersion: 1 as const,
  } satisfies Omit<ProjectReadWorkspaceAuthoritySnapshot, 'authorityDigest'>;
  return decodeProjectReadWorkspaceAuthoritySnapshot({
    ...withoutDigest,
    authorityDigest: digestProjectReadWorkspaceValue(
      projectReadWorkspaceAuthoritySnapshotProjection(withoutDigest),
    ),
  });
}

type TerminalGrantInput = Omit<
  Extract<ProjectReadSnapshotCleanupGrant, { eligibilityKind: 'TERMINAL' }>,
  'grantDigest'
>;

function cleanupGrant(
  record: ProjectSourceReadAuthorityRecord,
  snapshot: ProjectReadWorkspaceAuthoritySnapshot,
  suffix: string,
): ProjectReadSnapshotCleanupGrant {
  const withoutDigest: TerminalGrantInput = {
    schemaVersion: 1,
    id: projectReadSnapshotCleanupGrantId(`project-read-cleanup-grant_${suffix}`),
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.TERMINAL,
    authoritySnapshotId: snapshot.id,
    authoritySnapshotDigest: snapshot.authorityDigest,
    authoritySequence: snapshot.authoritySequence,
    projectReadAuthorityId: record.id,
    snapshotId: record.snapshotId,
    workspaceRootIdentity: record.workspaceRootIdentity,
    snapshotLeafRealpath: record.snapshotLeafRealpath,
    ownershipMarkerProfile: record.ownershipMarkerProfile,
    ownershipMarkerDigest: record.ownershipMarkerDigest,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt: isoTimestamp('2026-08-08T12:00:04.000Z'),
    projectReadAuthorityRecordDigest: record.recordDigest,
    attemptId: record.attemptId,
    terminalAttemptStatus: AttemptStatus.RESULT_RECORDED,
    terminalAttemptEndedAt: isoTimestamp('2026-08-08T12:00:02.000Z'),
    externalExecutionId: externalExecutionId(`external_${suffix}`),
    terminalExternalExecutionState: ExternalExecutionState.COMPLETED,
    terminalExternalExecutionAt: isoTimestamp('2026-08-08T12:00:03.000Z'),
    terminalExternalExecutionRecordDigest: sha256Digest(`sha256:${'7'.repeat(64)}`),
  };
  return decodeProjectReadSnapshotCleanupGrant(
    {
      ...withoutDigest,
      grantDigest: digests.digest(projectReadSnapshotCleanupGrantProjection(withoutDigest)),
    },
    digests,
  );
}

interface ConcurrentCleanupWorkerResult {
  readonly disposition: string | null;
  readonly observationDigest: string | null;
}

interface ConcurrentCleanupWorkerHandle {
  readonly ready: Promise<void>;
  readonly result: Promise<ConcurrentCleanupWorkerResult>;
}

function concurrentWorkerMessageField(message: object, key: string): unknown {
  return Reflect.get(message, key) as unknown;
}

function startConcurrentCleanupWorker(
  options: Readonly<{
    authorityRoots: readonly string[];
    ownerId: string;
    workspaceRoot: string;
  }>,
  grant: ProjectReadSnapshotCleanupGrant,
  gate: SharedArrayBuffer,
): ConcurrentCleanupWorkerHandle {
  const worker = new Worker(
    `
      const { parentPort, workerData } = require('node:worker_threads');
      void (async () => {
        try {
          const { createLocalProjectReadWorkspace } = await import('@codeclosure/workspace-local');
          const workspace = createLocalProjectReadWorkspace(workerData.options);
          const gate = new Int32Array(workerData.gate);
          parentPort.postMessage({ kind: 'READY' });
          Atomics.wait(gate, 0, 0);
          const observation = workspace.cleanupSnapshot(workerData.grant);
          parentPort.postMessage({
            kind: 'RESULT',
            disposition: observation?.disposition ?? null,
            observationDigest: observation?.observationDigest ?? null,
          });
        } catch (error) {
          parentPort.postMessage({
            kind: 'ERROR',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    `,
    { eval: true, workerData: { options, grant, gate } },
  );
  let readySettled = false;
  let resultSettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveResult!: (result: ConcurrentCleanupWorkerResult) => void;
  let rejectResult!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise<ConcurrentCleanupWorkerResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  const fail = (error: Error): void => {
    if (!readySettled) {
      readySettled = true;
      rejectReady(error);
    }
    if (!resultSettled) {
      resultSettled = true;
      rejectResult(error);
    }
  };
  worker.on('message', (message: unknown) => {
    if (typeof message !== 'object' || message === null) {
      fail(new Error('Concurrent cleanup worker returned a malformed message'));
      return;
    }
    const kind = concurrentWorkerMessageField(message, 'kind');
    if (kind === 'READY') {
      if (!readySettled) {
        readySettled = true;
        resolveReady();
      }
      return;
    }
    if (kind === 'ERROR') {
      const rawMessage = concurrentWorkerMessageField(message, 'message');
      fail(new Error(typeof rawMessage === 'string' ? rawMessage : 'Cleanup worker failed'));
      return;
    }
    if (kind === 'RESULT') {
      const disposition = concurrentWorkerMessageField(message, 'disposition');
      const observationDigest = concurrentWorkerMessageField(message, 'observationDigest');
      if (
        (typeof disposition !== 'string' && disposition !== null) ||
        (typeof observationDigest !== 'string' && observationDigest !== null)
      ) {
        fail(new Error('Concurrent cleanup worker returned an invalid result'));
        return;
      }
      if (!resultSettled) {
        resultSettled = true;
        resolveResult(Object.freeze({ disposition, observationDigest }));
      }
      return;
    }
    fail(new Error('Concurrent cleanup worker returned an unknown message'));
  });
  worker.on('error', fail);
  worker.on('exit', (code) => {
    if (code !== 0) {
      fail(new Error(`Concurrent cleanup worker exited with ${String(code)}`));
    } else if (!resultSettled) {
      fail(new Error('Concurrent cleanup worker exited without a result'));
    }
  });
  return Object.freeze({ ready, result });
}

void test('project-read materialization copies exact selected bytes into a marker-external read-only snapshot', (t) => {
  const value = fixture(t, { now: () => observedAt });
  const record = authorityRecord(value, 'materialize');
  const sourceBefore = readFileSync(join(value.sourceRoot, 'src', 'order.ts'), 'utf8');
  const receipt = value.workspace.materializeSnapshot(record);

  assert.equal(receipt.authorityRecordDigest, record.recordDigest);
  assert.equal(receipt.snapshotTreeDigest, record.sourceTree.projectionDigest);
  assert.equal(
    readFileSync(join(record.snapshotLeafRealpath, 'src', 'order.ts'), 'utf8'),
    sourceBefore,
  );
  assert.equal(existsSync(join(record.snapshotLeafRealpath, 'src', 'note.txt')), true);
  assert.equal(existsSync(join(record.snapshotLeafRealpath, 'ignored.log')), false);
  assert.equal(existsSync(join(record.snapshotLeafRealpath, '.git')), false);
  assert.equal(existsSync(join(record.snapshotLeafRealpath, '.codeclosure-project-read')), false);
  assert.equal(lstatSync(record.snapshotLeafRealpath).mode & 0o222, 0);
  assert.equal(lstatSync(join(record.snapshotLeafRealpath, 'src', 'order.ts')).mode & 0o222, 0);
  assert.notEqual(
    lstatSync(join(record.snapshotLeafRealpath, 'scripts', 'tool.sh')).mode & 0o111,
    0,
  );
  assert.equal(readFileSync(join(value.sourceRoot, 'src', 'order.ts'), 'utf8'), sourceBefore);
  assert.equal(
    existsSync(
      join(
        value.workspaceRoot,
        '.codeclosure-project-read',
        'markers',
        `${record.snapshotId}.json`,
      ),
    ),
    true,
  );
});

void test('source drift during materialization removes only the exact unpersisted effect', (t) => {
  let sourceRoot = '';
  const value = fixture(t, {
    now: () => observedAt,
    beforeSourceRecheck: () => {
      writeFileSync(join(sourceRoot, 'src', 'order.ts'), 'export const charge = "drift";\n');
    },
  });
  sourceRoot = value.sourceRoot;
  const record = authorityRecord(value, 'source-drift');
  assert.throws(
    () => value.workspace.materializeSnapshot(record),
    (error) =>
      error instanceof LocalProjectReadWorkspaceError &&
      error.code === LocalProjectReadWorkspaceFailureCode.SOURCE_DRIFT,
  );
  assert.equal(existsSync(record.snapshotLeafRealpath), false);
  assert.equal(
    existsSync(
      join(
        value.workspaceRoot,
        '.codeclosure-project-read',
        'markers',
        `${record.snapshotId}.json`,
      ),
    ),
    false,
  );
});

void test('reconciliation distinguishes exact current, retained, orphaned, and drifted snapshots', (t) => {
  const value = fixture(t, { now: () => observedAt });
  const record = authorityRecord(value, 'reconcile');
  value.workspace.materializeSnapshot(record);

  const current = value.workspace.reconcile(authoritySnapshot(record, 'CURRENT', 1, true));
  assert.equal(current[0]?.classification, ProjectReadWorkspaceClassification.OWNED_CURRENT);
  assert.equal(current[0].activeExternalExecutionIds.length, 1);

  const retained = value.workspace.reconcile(authoritySnapshot(record, 'RETAINED', 2));
  assert.equal(retained[0]?.classification, ProjectReadWorkspaceClassification.OWNED_RETAINED);

  const orphaned = value.workspace.reconcile(authoritySnapshot(record, null, 3));
  assert.equal(orphaned[0]?.classification, ProjectReadWorkspaceClassification.OWNED_ORPHANED);

  chmodSync(join(record.snapshotLeafRealpath, 'src', 'order.ts'), 0o644);
  const unsafe = value.workspace.reconcile(authoritySnapshot(record, null, 4));
  assert.equal(unsafe[0]?.classification, ProjectReadWorkspaceClassification.UNSAFE);
  assert.throws(
    () => value.workspace.reconcile(authoritySnapshot(record, null, 3)),
    (error) =>
      error instanceof LocalProjectReadWorkspaceError &&
      error.code === LocalProjectReadWorkspaceFailureCode.STALE_AUTHORITY_SNAPSHOT,
  );
  assert.throws(
    () => value.workspace.reconcile(authoritySnapshot(record, 'RETAINED', 4)),
    (error) =>
      error instanceof LocalProjectReadWorkspaceError &&
      error.code === LocalProjectReadWorkspaceFailureCode.AUTHORITY_SNAPSHOT_CONFLICT,
  );
});

void test('an exact Cleanup Grant deletes once and a later same-grant invocation observes absence', (t) => {
  const value = fixture(t, { now: () => observedAt });
  const record = authorityRecord(value, 'cleanup');
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(record, authoritySnapshot(record, 'RETAINED', 1), 'cleanup');

  const deleted = value.workspace.cleanupSnapshot(grant);
  assert.equal(deleted?.disposition, 'DELETED');
  assert.equal(existsSync(record.snapshotLeafRealpath), false);
  const replay = value.workspace.cleanupSnapshot(grant);
  assert.equal(replay?.disposition, 'ALREADY_ABSENT');
});

void test('separate worker isolates join one same-Grant cleanup effect without selecting another target', async (t) => {
  const value = fixture(t, { now: () => observedAt });
  const record = authorityRecord(value, 'concurrent-cleanup');
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(
    record,
    authoritySnapshot(record, 'RETAINED', 1),
    'concurrent-cleanup',
  );
  const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  const options = Object.freeze({
    authorityRoots: Object.freeze([value.authorityRoot]),
    ownerId: 'project-read-owner_test',
    workspaceRoot: value.workspaceRoot,
  });
  const first = startConcurrentCleanupWorker(options, grant, gate);
  const second = startConcurrentCleanupWorker(options, grant, gate);
  await Promise.all([first.ready, second.ready]);
  Atomics.store(new Int32Array(gate), 0, 1);
  Atomics.notify(new Int32Array(gate), 0, 2);
  const results = await Promise.all([first.result, second.result]);

  assert.equal(existsSync(record.snapshotLeafRealpath), false);
  assert.equal(results.filter((result) => result.disposition === 'DELETED').length, 1);
  for (const result of results) {
    assert.equal(
      result.disposition === null ||
        result.disposition === 'DELETED' ||
        result.disposition === 'ALREADY_ABSENT',
      true,
    );
    assert.equal(result.disposition === null, result.observationDigest === null);
  }
  const reconciled = value.workspace.cleanupSnapshot(grant);
  assert.equal(reconciled?.disposition, 'ALREADY_ABSENT');
});

void test('cleanup retains a writable or byte-drifted target instead of deleting by path', (t) => {
  const value = fixture(t, { now: () => observedAt });
  const record = authorityRecord(value, 'unsafe-cleanup');
  value.workspace.materializeSnapshot(record);
  const target = join(record.snapshotLeafRealpath, 'src', 'order.ts');
  chmodSync(target, 0o644);
  writeFileSync(target, 'export const charge = "replacement";\n');
  const grant = cleanupGrant(record, authoritySnapshot(record, 'RETAINED', 1), 'unsafe-cleanup');

  const observation = value.workspace.cleanupSnapshot(grant);
  assert.equal(observation?.disposition, 'RETAINED_UNSAFE');
  assert.equal(existsSync(record.snapshotLeafRealpath), true);
  assert.equal(readFileSync(target, 'utf8'), 'export const charge = "replacement";\n');
});

void test('a proven pre-effect failure closes as FAILED with an unchanged exact target', (t) => {
  const value = fixture(t, {
    now: () => observedAt,
    beforeCleanupTargetEffect: () => {
      throw new Error('injected pre-effect failure');
    },
  });
  const record = authorityRecord(value, 'failed-cleanup');
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(record, authoritySnapshot(record, 'RETAINED', 1), 'failed-cleanup');

  const observation = value.workspace.cleanupSnapshot(grant);
  assert.equal(observation?.disposition, 'FAILED');
  assert.equal(
    observation.failurePreEffectTargetObservation?.fingerprintDigest,
    observation.terminalTargetObservation.fingerprintDigest,
  );
  assert.equal(existsSync(record.snapshotLeafRealpath), true);
});

void test('same-grant replay promotes one complete staged cleanup operation', (t) => {
  let interruptStaging = true;
  const value = fixture(t, {
    now: () => observedAt,
    afterCleanupOperationStaged: () => {
      if (interruptStaging) {
        interruptStaging = false;
        throw new Error('injected staged-operation interruption');
      }
    },
  });
  const record = authorityRecord(value, 'staged-cleanup');
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(record, authoritySnapshot(record, 'RETAINED', 1), 'staged-cleanup');

  assert.equal(value.workspace.cleanupSnapshot(grant), null);
  assert.equal(existsSync(record.snapshotLeafRealpath), true);
  const replay = value.workspace.cleanupSnapshot(grant);
  assert.equal(replay?.disposition, 'DELETED');
  assert.equal(existsSync(record.snapshotLeafRealpath), false);
});

void test('an unclassifiable staged cleanup operation never produces a terminal observation', (t) => {
  const value = fixture(t, {
    now: () => observedAt,
    afterCleanupOperationStaged: ({ stagingOperationRoot }) => {
      writeFileSync(join(stagingOperationRoot, 'operation.json'), '{');
      throw new Error('injected partial staged operation');
    },
  });
  const record = authorityRecord(value, 'partial-staged-cleanup');
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(
    record,
    authoritySnapshot(record, 'RETAINED', 1),
    'partial-staged-cleanup',
  );

  assert.equal(value.workspace.cleanupSnapshot(grant), null);
  assert.equal(value.workspace.cleanupSnapshot(grant), null);
  assert.equal(existsSync(record.snapshotLeafRealpath), true);
});

void test('same-grant replay reconciles an unknown result after the exact target rename', (t) => {
  let failAfterRename = true;
  const value = fixture(t, {
    now: () => observedAt,
    afterCleanupTargetRename: () => {
      if (failAfterRename) {
        failAfterRename = false;
        throw new Error('injected unknown result');
      }
    },
  });
  const record = authorityRecord(value, 'cleanup-replay');
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(record, authoritySnapshot(record, 'RETAINED', 1), 'cleanup-replay');

  assert.equal(value.workspace.cleanupSnapshot(grant), null);
  assert.equal(existsSync(record.snapshotLeafRealpath), false);
  const reconciled = value.workspace.cleanupSnapshot(grant);
  assert.equal(reconciled?.disposition, 'DELETED');
  assert.equal(reconciled.coordinationDisposition, 'CLEARED');
});

void test('same-grant replay observes absence when the target disappears before its effect', (t) => {
  let removeBeforeEffect = true;
  const value = fixture(t, {
    now: () => observedAt,
    beforeCleanupTargetEffect: ({ snapshotLeafRealpath }) => {
      if (removeBeforeEffect) {
        removeBeforeEffect = false;
        removeFixtureRoot(snapshotLeafRealpath);
      }
    },
  });
  const record = authorityRecord(value, 'cleanup-pre-effect-absence');
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(
    record,
    authoritySnapshot(record, 'RETAINED', 1),
    'cleanup-pre-effect-absence',
  );

  assert.equal(value.workspace.cleanupSnapshot(grant), null);
  const reconciled = value.workspace.cleanupSnapshot(grant);
  assert.equal(reconciled?.disposition, 'ALREADY_ABSENT');
  assert.equal(reconciled.coordinationDisposition, 'CLEARED');
});

void test('same-grant replay closes absence after tombstone deletion interruption', (t) => {
  let interruptAfterDelete = true;
  const value = fixture(t, {
    now: () => observedAt,
    afterCleanupTombstoneRemoved: () => {
      if (interruptAfterDelete) {
        interruptAfterDelete = false;
        throw new Error('injected interruption after tombstone deletion');
      }
    },
  });
  const record = authorityRecord(value, 'cleanup-post-delete');
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(
    record,
    authoritySnapshot(record, 'RETAINED', 1),
    'cleanup-post-delete',
  );

  assert.equal(value.workspace.cleanupSnapshot(grant), null);
  assert.equal(existsSync(record.snapshotLeafRealpath), false);
  const reconciled = value.workspace.cleanupSnapshot(grant);
  assert.equal(reconciled?.disposition, 'ALREADY_ABSENT');
  assert.equal(reconciled.coordinationDisposition, 'CLEARED');
});

void test('cleanup retains a replacement installed after tombstone deletion', (t) => {
  let replacementLeaf = '';
  const value = fixture(t, {
    now: () => observedAt,
    afterCleanupTombstoneRemoved: () => {
      mkdirSync(replacementLeaf);
      writeFileSync(join(replacementLeaf, 'replacement.txt'), 'post-delete replacement\n');
    },
  });
  const record = authorityRecord(value, 'cleanup-post-delete-replacement');
  replacementLeaf = record.snapshotLeafRealpath;
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(
    record,
    authoritySnapshot(record, 'RETAINED', 1),
    'cleanup-post-delete-replacement',
  );

  const observation = value.workspace.cleanupSnapshot(grant);
  assert.equal(observation?.disposition, 'RETAINED_UNSAFE');
  assert.equal(observation.coordinationDisposition, 'CLEARED');
  assert.equal(
    readFileSync(join(replacementLeaf, 'replacement.txt'), 'utf8'),
    'post-delete replacement\n',
  );
});

void test('cleanup never deletes a replacement installed after the exact target rename', (t) => {
  let replacementLeaf = '';
  const value = fixture(t, {
    now: () => observedAt,
    afterCleanupTargetRename: () => {
      mkdirSync(replacementLeaf);
      writeFileSync(join(replacementLeaf, 'replacement.txt'), 'must remain\n');
    },
  });
  const record = authorityRecord(value, 'cleanup-replacement');
  replacementLeaf = record.snapshotLeafRealpath;
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(
    record,
    authoritySnapshot(record, 'RETAINED', 1),
    'cleanup-replacement',
  );

  assert.equal(value.workspace.cleanupSnapshot(grant), null);
  assert.equal(readFileSync(join(replacementLeaf, 'replacement.txt'), 'utf8'), 'must remain\n');
  const replay = value.workspace.cleanupSnapshot(grant);
  assert.equal(replay?.disposition, 'RETAINED_UNSAFE');
  assert.equal(readFileSync(join(replacementLeaf, 'replacement.txt'), 'utf8'), 'must remain\n');
});

void test('cleanup never treats a Grant-derived tombstone name as deletion authority', (t) => {
  let substitutedTombstone = '';
  const value = fixture(t, {
    now: () => observedAt,
    afterCleanupTargetRename: ({ tombstonePath }) => {
      substitutedTombstone = tombstonePath;
      removeFixtureRoot(tombstonePath);
      mkdirSync(tombstonePath);
      writeFileSync(join(tombstonePath, 'replacement.txt'), 'unowned tombstone replacement\n');
    },
  });
  const record = authorityRecord(value, 'tombstone-replacement');
  value.workspace.materializeSnapshot(record);
  const grant = cleanupGrant(
    record,
    authoritySnapshot(record, 'RETAINED', 1),
    'tombstone-replacement',
  );

  assert.equal(value.workspace.cleanupSnapshot(grant), null);
  assert.equal(
    readFileSync(join(substitutedTombstone, 'replacement.txt'), 'utf8'),
    'unowned tombstone replacement\n',
  );
  assert.equal(value.workspace.cleanupSnapshot(grant), null);
  assert.equal(
    readFileSync(join(substitutedTombstone, 'replacement.txt'), 'utf8'),
    'unowned tombstone replacement\n',
  );
});
