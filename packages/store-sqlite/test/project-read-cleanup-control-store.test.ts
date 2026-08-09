import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

import Database from 'better-sqlite3';
import { z } from 'zod';

import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  ProjectReadSnapshotCleanupDisposition,
  ProjectReadSnapshotCleanupEligibilityKind,
  ProjectReadSnapshotCleanupLifecyclePolicy,
  auditEventId,
  decodeProjectReadSnapshotCleanupGrant,
  decodeProjectReadSnapshotCleanupOutcome,
  isoTimestamp,
  projectReadSnapshotCleanupGrantId,
  projectReadSnapshotCleanupGrantProjection,
  projectReadSnapshotCleanupObservationId,
  projectReadSnapshotCleanupOutcomeId,
  projectReadSnapshotCleanupOutcomeProjection,
  projectReadSnapshotId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectReadWorkspaceObservationId,
  projectSourceReadAuthorityId,
  sha256Digest,
  type ProjectReadSnapshotCleanupGrant,
} from '@codeclosure/domain';
import {
  PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
  ProjectReadSnapshotCleanupCoordinationDisposition,
  ProjectReadSnapshotCleanupTargetAliasDisposition,
  ProjectReadSnapshotCleanupTargetEntryKind,
  ProjectReadSnapshotCleanupTargetManifestDisposition,
  ProjectReadSnapshotCleanupTargetMarkerDisposition,
  ProjectReadSnapshotCleanupTargetState,
  ProjectReadWorkspaceClassification,
  createProjectReadSnapshotCleanupTargetObservation,
  decodeProjectReadSnapshotCleanupObservation,
  decodeProjectReadSnapshotCleanupTargetFingerprintProjection,
  decodeProjectReadWorkspaceObservation,
  digestProjectReadSnapshotCleanupValue,
  digestProjectReadWorkspaceValue,
  projectReadSnapshotCleanupObservationProjection,
  projectReadWorkspaceObservationProjection,
  type ProjectReadSnapshotCleanupObservation,
  type ProjectReadWorkspaceAuthoritySnapshot,
  type ProjectReadWorkspaceObservation,
} from '@codeclosure/runtime';

import {
  ProjectReadCleanupTransactionStep,
  openSqliteControlStore,
} from '@codeclosure/store-sqlite';

const root = '/fixture/project-read-workspaces';
const leaf = `${root}/orphan-store-fixture`;
const authorityId = projectSourceReadAuthorityId('project-read_cleanup-store-orphan');
const snapshotId = projectReadSnapshotId('project-read-snapshot_cleanup-store-orphan');
const markerDigest = sha256Digest(`sha256:${'2'.repeat(64)}`);

function workspaceObservation(
  snapshot: ProjectReadWorkspaceAuthoritySnapshot,
  suffix = 'primary',
): ProjectReadWorkspaceObservation {
  const value = Object.freeze({
    activeExternalExecutionIds: [],
    authorityRecordDigest: null,
    authoritySequence: snapshot.authoritySequence,
    authoritySnapshotDigest: snapshot.authorityDigest,
    authoritySnapshotId: snapshot.id,
    classification: ProjectReadWorkspaceClassification.OWNED_ORPHANED,
    id: projectReadWorkspaceObservationId(`project-read-observation_cleanup-store-${suffix}`),
    observedAt: isoTimestamp('2026-08-08T10:00:01.000Z'),
    ownershipMarkerDigest: markerDigest,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    projectReadAuthorityId: authorityId,
    schemaVersion: 1 as const,
    snapshotId,
    snapshotLeafRealpath: leaf,
    workspaceRootIdentity: root,
  });
  return decodeProjectReadWorkspaceObservation({
    ...value,
    observationDigest: digestProjectReadWorkspaceValue(
      projectReadWorkspaceObservationProjection(value),
    ),
  });
}

function orphanGrant(
  snapshot: ProjectReadWorkspaceAuthoritySnapshot,
  observation: ProjectReadWorkspaceObservation,
  suffix = 'primary',
): ProjectReadSnapshotCleanupGrant {
  const value = Object.freeze({
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupGrantId(`project-read-cleanup-grant_cleanup-store-${suffix}`),
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.ORPHANED,
    authoritySnapshotId: snapshot.id,
    authoritySnapshotDigest: snapshot.authorityDigest,
    authoritySequence: snapshot.authoritySequence,
    projectReadAuthorityId: authorityId,
    snapshotId,
    workspaceRootIdentity: root,
    snapshotLeafRealpath: leaf,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    ownershipMarkerDigest: markerDigest,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt: isoTimestamp('2026-08-08T10:00:02.000Z'),
    workspaceObservationId: observation.id,
    workspaceObservationDigest: observation.observationDigest,
  });
  return decodeProjectReadSnapshotCleanupGrant(
    {
      ...value,
      grantDigest: digestProjectReadSnapshotCleanupValue(
        projectReadSnapshotCleanupGrantProjection(value),
      ),
    },
    { digest: digestProjectReadSnapshotCleanupValue },
  );
}

function cleanupObservation(
  grant: ProjectReadSnapshotCleanupGrant,
  disposition:
    | typeof ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT
    | typeof ProjectReadSnapshotCleanupDisposition.DELETED,
  suffix = 'primary',
): ProjectReadSnapshotCleanupObservation {
  const fingerprint = decodeProjectReadSnapshotCleanupTargetFingerprintProjection({
    schemaVersion: 1,
    profile: PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
    state: ProjectReadSnapshotCleanupTargetState.ABSENT,
    workspaceRootIdentity: root,
    workspaceRootDeviceId: '1024',
    workspaceRootFileId: '2048',
    snapshotLeafRealpath: leaf,
    entryKind: ProjectReadSnapshotCleanupTargetEntryKind.ABSENT,
    aliasDisposition: ProjectReadSnapshotCleanupTargetAliasDisposition.NOT_APPLICABLE,
    resolvedLeafRealpath: null,
    nodeDeviceId: null,
    nodeFileId: null,
    expectedOwnershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    expectedOwnershipMarkerDigest: markerDigest,
    markerDisposition: ProjectReadSnapshotCleanupTargetMarkerDisposition.ABSENT,
    observedOwnershipMarkerDigest: null,
    manifestDisposition: ProjectReadSnapshotCleanupTargetManifestDisposition.NOT_APPLICABLE,
    targetManifestProfile: null,
    targetManifestDigest: null,
  });
  const target = createProjectReadSnapshotCleanupTargetObservation(
    fingerprint,
    '2026-08-08T10:00:03.000Z',
  );
  const value = Object.freeze({
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupObservationId(
      `project-read-cleanup-observation_cleanup-store-${suffix}`,
    ),
    grantId: grant.id,
    grantDigest: grant.grantDigest,
    disposition,
    workspaceRootIdentity: root,
    snapshotLeafRealpath: leaf,
    expectedOwnershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    expectedOwnershipMarkerDigest: markerDigest,
    terminalTargetObservation: target,
    failurePreEffectTargetObservation: null,
    coordinationDisposition: ProjectReadSnapshotCleanupCoordinationDisposition.CLEARED,
    observedAt: isoTimestamp('2026-08-08T10:00:03.000Z'),
  });
  return decodeProjectReadSnapshotCleanupObservation({
    ...value,
    observationDigest: digestProjectReadSnapshotCleanupValue(
      projectReadSnapshotCleanupObservationProjection(value),
    ),
  });
}

function cleanupOutcome(
  grant: ProjectReadSnapshotCleanupGrant,
  observation: ProjectReadSnapshotCleanupObservation,
  suffix = 'primary',
) {
  const value = Object.freeze({
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupOutcomeId(`project-read-cleanup-outcome_cleanup-store-${suffix}`),
    grantId: grant.id,
    grantDigest: grant.grantDigest,
    cleanupObservationId: observation.id,
    cleanupObservationDigest: observation.observationDigest,
    disposition: observation.disposition,
    resolvedAt: isoTimestamp('2026-08-08T10:00:04.000Z'),
  });
  return decodeProjectReadSnapshotCleanupOutcome(
    {
      ...value,
      outcomeDigest: digestProjectReadSnapshotCleanupValue(
        projectReadSnapshotCleanupOutcomeProjection(value),
      ),
    },
    { digest: digestProjectReadSnapshotCleanupValue },
  );
}

function authoritySnapshot(filename: string) {
  const store = openSqliteControlStore({ filename });
  const result = store.captureProjectReadWorkspaceAuthoritySnapshot({
    id: projectReadWorkspaceAuthoritySnapshotId('project-read-authority-snapshot_cleanup-store'),
    issuedAt: isoTimestamp('2026-08-08T10:00:00.000Z'),
    auditEventId: auditEventId('audit_project-read-authority-snapshot-cleanup-store'),
  });
  assert.equal(result.status, 'ISSUED');
  store.close();
  return result.value;
}

function seedGrant(filename: string) {
  const snapshot = authoritySnapshot(filename);
  const observation = workspaceObservation(snapshot);
  const grant = orphanGrant(snapshot, observation);
  const store = openSqliteControlStore({ filename });
  assert.equal(
    store.recordProjectReadWorkspaceObservation({
      observation,
      auditEventId: auditEventId('audit_project-read-workspace-observation-cleanup-store'),
    }).status,
    'RECORDED',
  );
  assert.equal(
    store.issueProjectReadSnapshotCleanupGrant({
      grant,
      auditEventId: auditEventId('audit_project-read-cleanup-grant-cleanup-store'),
    }).status,
    'ISSUED',
  );
  store.close();
  return grant;
}

interface ConcurrentCleanupResolution {
  readonly outcomeDigest: string;
  readonly status: 'APPLIED' | 'REPLAYED';
}

interface ConcurrentCleanupWorker {
  readonly ready: Promise<void>;
  readonly result: Promise<ConcurrentCleanupResolution>;
}

const concurrentCleanupWorkerMessageSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('READY') }).strict(),
  z.object({ kind: z.literal('ERROR'), message: z.string() }).strict(),
  z
    .object({
      kind: z.literal('RESULT'),
      status: z.enum(['APPLIED', 'REPLAYED']),
      outcomeDigest: z.string(),
    })
    .strict(),
]);

function startConcurrentCleanupWorker(
  filename: string,
  gate: SharedArrayBuffer,
  input: Readonly<Record<string, unknown>>,
): ConcurrentCleanupWorker {
  const worker = new Worker(
    `
      const { parentPort, workerData } = require('node:worker_threads');
      void (async () => {
        try {
          const { openSqliteControlStore } = await import('@codeclosure/store-sqlite');
          const store = openSqliteControlStore({ filename: workerData.filename });
          const gate = new Int32Array(workerData.gate);
          parentPort.postMessage({ kind: 'READY' });
          Atomics.wait(gate, 0, 0);
          const result = store.resolveProjectReadSnapshotCleanupGrant(workerData.input);
          store.close();
          parentPort.postMessage({
            kind: 'RESULT',
            status: result.status,
            outcomeDigest:
              result.status === 'APPLIED' || result.status === 'REPLAYED'
                ? result.value.outcomeDigest
                : null,
          });
        } catch (error) {
          parentPort.postMessage({
            kind: 'ERROR',
            message: error instanceof Error ? error.message : String(error),
          });
        }
      })();
    `,
    { eval: true, workerData: { filename, gate, input } },
  );
  let readySettled = false;
  let resultSettled = false;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let resolveResult!: (result: ConcurrentCleanupResolution) => void;
  let rejectResult!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const result = new Promise<ConcurrentCleanupResolution>((resolve, reject) => {
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
    const parsed = concurrentCleanupWorkerMessageSchema.safeParse(message);
    if (!parsed.success) {
      fail(new Error('Cleanup concurrency worker returned a malformed message'));
      return;
    }
    if (parsed.data.kind === 'READY') {
      if (!readySettled) {
        readySettled = true;
        resolveReady();
      }
      return;
    }
    if (parsed.data.kind === 'ERROR') {
      fail(new Error(parsed.data.message));
      return;
    }
    if (!resultSettled) {
      resultSettled = true;
      resolveResult(
        Object.freeze({
          status: parsed.data.status,
          outcomeDigest: parsed.data.outcomeDigest,
        }),
      );
    }
  });
  worker.on('error', (error) => fail(error));
  worker.on('exit', (code) => {
    if (code !== 0 || !resultSettled) {
      fail(new Error(`Cleanup concurrency worker exited before resolution (${code})`));
    }
  });
  return Object.freeze({ ready, result });
}

void test('[I-006][I-008][I-009] cleanup authority persists exact snapshot, observation, and consume-once resolution', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-cleanup-store-'));
  const filename = join(directory, 'authority.sqlite');
  try {
    const grant = seedGrant(filename);
    const observation = cleanupObservation(
      grant,
      ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT,
    );
    const outcome = cleanupOutcome(grant, observation);
    const first = openSqliteControlStore({ filename });
    const applied = first.resolveProjectReadSnapshotCleanupGrant({
      grantId: grant.id,
      grantDigest: grant.grantDigest,
      observation,
      outcome,
      observationAuditEventId: auditEventId('audit_project-read-cleanup-observation-cleanup-store'),
      outcomeAuditEventId: auditEventId('audit_project-read-cleanup-outcome-cleanup-store'),
    });
    assert.equal(applied.status, 'APPLIED');
    assert.deepEqual(first.getProjectReadSnapshotCleanupOutcome(grant.id), outcome);
    first.close();

    const reopened = openSqliteControlStore({ filename });
    assert.deepEqual(reopened.getProjectReadSnapshotCleanupGrant(grant.id), grant);
    assert.deepEqual(reopened.getProjectReadSnapshotCleanupOutcome(grant.id), outcome);
    assert.throws(
      () =>
        reopened.captureProjectReadWorkspaceAuthoritySnapshot({
          id: projectReadWorkspaceAuthoritySnapshotId(
            'project-read-authority-snapshot_cleanup-store-time-rewind',
          ),
          issuedAt: isoTimestamp('2026-08-08T09:59:59.000Z'),
          auditEventId: auditEventId('audit_project-read-authority-snapshot-time-rewind'),
        }),
      /snapshot time cannot move behind retained authority/u,
    );
    assert.equal(
      reopened.issueProjectReadSnapshotCleanupGrant({
        grant,
        auditEventId: auditEventId('audit_unused-exact-grant-replay'),
      }).status,
      'EXISTING',
    );
    const retainedSnapshot = reopened.getProjectReadWorkspaceAuthoritySnapshot(
      grant.authoritySnapshotId,
    );
    const retainedObservation = reopened.getProjectReadWorkspaceObservation(
      projectReadWorkspaceObservationId('project-read-observation_cleanup-store-primary'),
    );
    assert.ok(retainedSnapshot);
    assert.ok(retainedObservation);
    const replacement = orphanGrant(retainedSnapshot, retainedObservation, 'replacement');
    assert.equal(
      reopened.issueProjectReadSnapshotCleanupGrant({
        grant: replacement,
        auditEventId: auditEventId('audit_replacement-grant-conflict'),
      }).status,
      'GRANT_CONFLICT',
    );
    reopened.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('[I-008][I-009] cleanup resolution rolls back every write and concurrent connections return one retained winner', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-cleanup-rollback-'));
  const filename = join(directory, 'authority.sqlite');
  try {
    const grant = seedGrant(filename);
    const observation = cleanupObservation(
      grant,
      ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT,
    );
    const outcome = cleanupOutcome(grant, observation);
    const failing = openSqliteControlStore({
      filename,
      transactionProbe(step) {
        if (step === ProjectReadCleanupTransactionStep.AFTER_CLEANUP_CONSUMPTION_WRITE) {
          throw new Error('injected cleanup closeout failure');
        }
      },
    });
    assert.throws(
      () =>
        failing.resolveProjectReadSnapshotCleanupGrant({
          grantId: grant.id,
          grantDigest: grant.grantDigest,
          observation,
          outcome,
          observationAuditEventId: auditEventId('audit_cleanup-observation-rollback'),
          outcomeAuditEventId: auditEventId('audit_cleanup-outcome-rollback'),
        }),
      /injected cleanup closeout failure/u,
    );
    assert.equal(failing.getProjectReadSnapshotCleanupOutcome(grant.id), undefined);
    failing.close();

    const winnerInput = Object.freeze({
      grantId: grant.id,
      grantDigest: grant.grantDigest,
      observation,
      outcome,
      observationAuditEventId: auditEventId('audit_cleanup-observation-winner'),
      outcomeAuditEventId: auditEventId('audit_cleanup-outcome-winner'),
    });
    const loserObservation = cleanupObservation(
      grant,
      ProjectReadSnapshotCleanupDisposition.DELETED,
      'loser',
    );
    const loserOutcome = cleanupOutcome(grant, loserObservation, 'loser');
    const loserInput = Object.freeze({
      grantId: grant.id,
      grantDigest: grant.grantDigest,
      observation: loserObservation,
      outcome: loserOutcome,
      observationAuditEventId: auditEventId('audit_cleanup-observation-loser'),
      outcomeAuditEventId: auditEventId('audit_cleanup-outcome-loser'),
    });
    const gate = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
    const winner = startConcurrentCleanupWorker(filename, gate, winnerInput);
    const loser = startConcurrentCleanupWorker(filename, gate, loserInput);
    const gateView = new Int32Array(gate);
    try {
      await Promise.all([winner.ready, loser.ready]);
    } finally {
      Atomics.store(gateView, 0, 1);
      Atomics.notify(gateView, 0, 2);
    }
    const resolutions = await Promise.all([winner.result, loser.result]);
    assert.deepEqual(resolutions.map(({ status }) => status).toSorted(), ['APPLIED', 'REPLAYED']);

    const retained = openSqliteControlStore({ filename });
    const retainedOutcome = retained.getProjectReadSnapshotCleanupOutcome(grant.id);
    assert.ok(retainedOutcome);
    assert.deepEqual(
      resolutions.map(({ outcomeDigest }) => outcomeDigest),
      [retainedOutcome.outcomeDigest, retainedOutcome.outcomeDigest],
    );
    retained.close();
    const database = new Database(filename, { readonly: true, fileMustExist: true });
    for (const table of [
      'project_read_snapshot_cleanup_observations',
      'project_read_snapshot_cleanup_outcomes',
      'project_read_snapshot_cleanup_consumptions',
    ]) {
      assert.equal(
        database.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get(),
        1,
        `${table} must retain exactly one winner`,
      );
    }
    assert.equal(
      database
        .prepare(
          `SELECT COUNT(*) FROM audit_events
            WHERE aggregate_type IN (
              'PROJECT_READ_SNAPSHOT_CLEANUP_OBSERVATION',
              'PROJECT_READ_SNAPSHOT_CLEANUP_OUTCOME'
            )`,
        )
        .pluck()
        .get(),
      2,
    );
    database.close();

    const replay = openSqliteControlStore({ filename });
    assert.equal(
      replay.resolveProjectReadSnapshotCleanupGrant({
        grantId: grant.id,
        grantDigest: grant.grantDigest,
        observation,
        outcome,
        observationAuditEventId: auditEventId('audit_cleanup-observation-replay'),
        outcomeAuditEventId: auditEventId('audit_cleanup-outcome-replay'),
      }).status,
      'REPLAYED',
    );
    replay.close();
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

void test('[I-006][I-009] strict reopen rejects cleanup canonical corruption', () => {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-cleanup-corrupt-'));
  const filename = join(directory, 'authority.sqlite');
  try {
    const grant = seedGrant(filename);
    const database = new Database(filename);
    database.exec('DROP TRIGGER project_read_snapshot_cleanup_grants_no_update');
    database
      .prepare(
        `UPDATE project_read_snapshot_cleanup_grants
            SET canonical_json = json_set(canonical_json, '$.issuedAt', ?)
          WHERE id = ?`,
      )
      .run('2026-08-08T11:00:00.000Z', grant.id);
    database.close();
    assert.throws(
      () => openSqliteControlStore({ filename }),
      /cleanup grant digest does not match/u,
    );
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
