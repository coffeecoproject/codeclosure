import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  AttemptStatus,
  ExternalExecutionState,
  ProjectReadSnapshotCleanupDisposition,
  ProjectReadSnapshotCleanupEligibilityKind,
  ProjectReadSnapshotCleanupLifecyclePolicy,
  attemptId,
  decodeProjectReadSnapshotCleanupGrant,
  decodeProjectReadSnapshotCleanupOutcome,
  externalExecutionId,
  isoTimestamp,
  projectReadSnapshotCleanupGrantId,
  projectReadSnapshotCleanupGrantProjection,
  projectReadSnapshotCleanupObservationId,
  projectReadSnapshotCleanupOutcomeId,
  projectReadSnapshotCleanupOutcomeProjection,
  projectReadSnapshotId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectSourceReadAuthorityId,
  sha256Digest,
  type ProjectReadSnapshotCleanupGrant,
  type ProjectReadSnapshotCleanupOutcome,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
  ProjectReadSnapshotCleanupCoordinatorStatus,
  ProjectReadSnapshotCleanupRejectionReasonCode,
  ProjectReadSnapshotCleanupResolutionKind,
  ProjectReadSnapshotCleanupTargetAliasDisposition,
  ProjectReadSnapshotCleanupTargetEntryKind,
  ProjectReadSnapshotCleanupTargetManifestDisposition,
  ProjectReadSnapshotCleanupTargetMarkerDisposition,
  ProjectReadSnapshotCleanupTargetState,
  ProjectReadSnapshotCleanupUnresolvedReasonCode,
  ProjectReadSnapshotCleanupCoordinationDisposition,
  createProjectReadSnapshotCleanupTargetObservation,
  decodeProjectReadSnapshotCleanupObservation,
  digestProjectReadSnapshotCleanupValue,
  projectReadSnapshotCleanupObservationProjection,
  type ProjectReadCleanupControlStore,
  type ProjectReadSnapshotCleanupObservation,
  type ResolveProjectReadSnapshotCleanupGrant,
} from '@codeclosure/runtime';
import { createProjectReadSnapshotCleanupCoordinator } from '@codeclosure/runtime/composition';

import { DeterministicClock, DeterministicIds } from '../src/deterministic-fixtures.ts';

const digests = new CanonicalJsonSha256DigestProvider();
const workspaceRootIdentity = '/fixture/project-read-cleanup-runtime';
const snapshotLeafRealpath = `${workspaceRootIdentity}/snapshot`;
const markerDigest = sha256Digest(`sha256:${'2'.repeat(64)}`);

type TerminalGrantInput = Omit<
  Extract<ProjectReadSnapshotCleanupGrant, { eligibilityKind: 'TERMINAL' }>,
  'grantDigest'
>;

function createGrant(issuedAt = '2026-08-09T10:00:04.000Z'): ProjectReadSnapshotCleanupGrant {
  const value: TerminalGrantInput = {
    schemaVersion: 1,
    id: projectReadSnapshotCleanupGrantId('project-read-cleanup-grant_runtime-coordinator'),
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.TERMINAL,
    authoritySnapshotId: projectReadWorkspaceAuthoritySnapshotId(
      'project-read-authority-snapshot_runtime-coordinator',
    ),
    authoritySnapshotDigest: sha256Digest(`sha256:${'1'.repeat(64)}`),
    authoritySequence: 9,
    projectReadAuthorityId: projectSourceReadAuthorityId('project-read_runtime-coordinator'),
    snapshotId: projectReadSnapshotId('project-read-snapshot_runtime-coordinator'),
    workspaceRootIdentity,
    snapshotLeafRealpath,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    ownershipMarkerDigest: markerDigest,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt: isoTimestamp(issuedAt),
    projectReadAuthorityRecordDigest: sha256Digest(`sha256:${'3'.repeat(64)}`),
    attemptId: attemptId('attempt_runtime-cleanup-coordinator'),
    terminalAttemptStatus: AttemptStatus.RESULT_RECORDED,
    terminalAttemptEndedAt: isoTimestamp('2026-08-09T10:00:02.000Z'),
    externalExecutionId: externalExecutionId('external_runtime-cleanup-coordinator'),
    terminalExternalExecutionState: ExternalExecutionState.COMPLETED,
    terminalExternalExecutionAt: isoTimestamp('2026-08-09T10:00:03.000Z'),
    terminalExternalExecutionRecordDigest: sha256Digest(`sha256:${'4'.repeat(64)}`),
  };
  return decodeProjectReadSnapshotCleanupGrant(
    {
      ...value,
      grantDigest: digests.digest(projectReadSnapshotCleanupGrantProjection(value)),
    },
    digests,
  );
}

function createAbsentObservation(
  grant: ProjectReadSnapshotCleanupGrant,
  disposition:
    | typeof ProjectReadSnapshotCleanupDisposition.DELETED
    | typeof ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT,
  suffix: string,
  observedAt = '2026-08-09T10:00:05.000Z',
): ProjectReadSnapshotCleanupObservation {
  const target = createProjectReadSnapshotCleanupTargetObservation(
    {
      schemaVersion: 1,
      profile: PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
      state: ProjectReadSnapshotCleanupTargetState.ABSENT,
      workspaceRootIdentity: grant.workspaceRootIdentity,
      workspaceRootDeviceId: '100',
      workspaceRootFileId: '200',
      snapshotLeafRealpath: grant.snapshotLeafRealpath,
      entryKind: ProjectReadSnapshotCleanupTargetEntryKind.ABSENT,
      aliasDisposition: ProjectReadSnapshotCleanupTargetAliasDisposition.NOT_APPLICABLE,
      resolvedLeafRealpath: null,
      nodeDeviceId: null,
      nodeFileId: null,
      expectedOwnershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
      expectedOwnershipMarkerDigest: grant.ownershipMarkerDigest,
      markerDisposition: ProjectReadSnapshotCleanupTargetMarkerDisposition.ABSENT,
      observedOwnershipMarkerDigest: null,
      manifestDisposition: ProjectReadSnapshotCleanupTargetManifestDisposition.NOT_APPLICABLE,
      targetManifestProfile: null,
      targetManifestDigest: null,
    },
    observedAt,
  );
  const value = {
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupObservationId(`project-read-cleanup-observation_${suffix}`),
    grantId: grant.id,
    grantDigest: grant.grantDigest,
    disposition,
    workspaceRootIdentity: grant.workspaceRootIdentity,
    snapshotLeafRealpath: grant.snapshotLeafRealpath,
    expectedOwnershipMarkerProfile: grant.ownershipMarkerProfile,
    expectedOwnershipMarkerDigest: grant.ownershipMarkerDigest,
    terminalTargetObservation: target,
    failurePreEffectTargetObservation: null,
    coordinationDisposition: ProjectReadSnapshotCleanupCoordinationDisposition.CLEARED,
    observedAt: isoTimestamp(observedAt),
  };
  return decodeProjectReadSnapshotCleanupObservation({
    ...value,
    observationDigest: digestProjectReadSnapshotCleanupValue(
      projectReadSnapshotCleanupObservationProjection(value),
    ),
  });
}

function createOutcome(
  grant: ProjectReadSnapshotCleanupGrant,
  observation: ProjectReadSnapshotCleanupObservation,
  suffix: string,
): ProjectReadSnapshotCleanupOutcome {
  const value = {
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupOutcomeId(`project-read-cleanup-outcome_${suffix}`),
    grantId: grant.id,
    grantDigest: grant.grantDigest,
    cleanupObservationId: observation.id,
    cleanupObservationDigest: observation.observationDigest,
    disposition: observation.disposition,
    resolvedAt: isoTimestamp('2026-08-09T10:00:06.000Z'),
  };
  return decodeProjectReadSnapshotCleanupOutcome(
    {
      ...value,
      outcomeDigest: digests.digest(projectReadSnapshotCleanupOutcomeProjection(value)),
    },
    digests,
  );
}

class CleanupStoreFixture implements ProjectReadCleanupControlStore {
  public grant: ProjectReadSnapshotCleanupGrant | undefined;
  public outcome: ProjectReadSnapshotCleanupOutcome | undefined;
  public resolutionCalls: ResolveProjectReadSnapshotCleanupGrant[] = [];
  public resolutionOverride:
    ((input: ResolveProjectReadSnapshotCleanupGrant) => unknown) | undefined;

  public captureProjectReadWorkspaceAuthoritySnapshot(): never {
    throw new Error('not used');
  }

  public getProjectReadWorkspaceAuthoritySnapshot(): undefined {
    return undefined;
  }

  public recordProjectReadWorkspaceObservation(): never {
    throw new Error('not used');
  }

  public getProjectReadWorkspaceObservation(): undefined {
    return undefined;
  }

  public issueProjectReadSnapshotCleanupGrant(): never {
    throw new Error('not used');
  }

  public getProjectReadSnapshotCleanupGrant(): ProjectReadSnapshotCleanupGrant | undefined {
    return this.grant;
  }

  public getProjectReadSnapshotCleanupOutcome(): ProjectReadSnapshotCleanupOutcome | undefined {
    return this.outcome;
  }

  public resolveProjectReadSnapshotCleanupGrant(
    input: ResolveProjectReadSnapshotCleanupGrant,
  ): ReturnType<ProjectReadCleanupControlStore['resolveProjectReadSnapshotCleanupGrant']> {
    this.resolutionCalls.push(input);
    if (this.resolutionOverride !== undefined) {
      return this.resolutionOverride(input) as ReturnType<
        ProjectReadCleanupControlStore['resolveProjectReadSnapshotCleanupGrant']
      >;
    }
    this.outcome = input.outcome;
    return { status: 'APPLIED', value: input.outcome };
  }
}

function dependencies(
  store: CleanupStoreFixture,
  cleanupSnapshot: (grant: ProjectReadSnapshotCleanupGrant) => unknown,
) {
  return {
    store,
    workspace: {
      cleanupSnapshot: cleanupSnapshot as ProjectReadSnapshotCleanupCoordinatorWorkspace,
    },
    clock: new DeterministicClock(['2026-08-09T10:00:06.000Z']),
    ids: new DeterministicIds('cleanup-runtime'),
    digests,
  };
}

type ProjectReadSnapshotCleanupCoordinatorWorkspace = (
  grant: ProjectReadSnapshotCleanupGrant,
) => ProjectReadSnapshotCleanupObservation | null;

void test('Cleanup Runtime rejects invalid, missing, and conflicting Grants before the port', () => {
  const retained = createGrant();
  const conflicting = createGrant('2026-08-09T10:00:05.000Z');
  const store = new CleanupStoreFixture();
  let portCalls = 0;
  const coordinator = createProjectReadSnapshotCleanupCoordinator(
    dependencies(store, () => {
      portCalls += 1;
      return null;
    }),
  );

  const invalid = coordinator.resolve({ grant: { id: retained.id } });
  assert.deepEqual(invalid, {
    status: ProjectReadSnapshotCleanupCoordinatorStatus.REJECTED,
    reasonCode: ProjectReadSnapshotCleanupRejectionReasonCode.INVALID_GRANT,
    portInvoked: false,
  });

  const missing = coordinator.resolve({ grant: retained });
  assert.deepEqual(missing, {
    status: ProjectReadSnapshotCleanupCoordinatorStatus.REJECTED,
    reasonCode: ProjectReadSnapshotCleanupRejectionReasonCode.MISSING_GRANT,
    portInvoked: false,
  });

  store.grant = retained;
  const conflict = coordinator.resolve({ grant: conflicting });
  assert.deepEqual(conflict, {
    status: ProjectReadSnapshotCleanupCoordinatorStatus.REJECTED,
    reasonCode: ProjectReadSnapshotCleanupRejectionReasonCode.GRANT_IDENTITY_CONFLICT,
    portInvoked: false,
  });
  assert.equal(portCalls, 0);
  assert.equal(store.resolutionCalls.length, 0);
});

void test('Cleanup Runtime leaves null, thrown, and malformed port results unresolved', () => {
  const grant = createGrant();
  const cases = [
    {
      expected: ProjectReadSnapshotCleanupUnresolvedReasonCode.NO_TERMINAL_OBSERVATION,
      invoke: () => null,
    },
    {
      expected: ProjectReadSnapshotCleanupUnresolvedReasonCode.PORT_INVOCATION_FAILED,
      invoke: () => {
        throw new Error('untrusted adapter detail');
      },
    },
    {
      expected: ProjectReadSnapshotCleanupUnresolvedReasonCode.PORT_OBSERVATION_INVALID,
      invoke: () => ({ disposition: 'DELETED', secret: 'must not persist' }),
    },
  ] as const;

  for (const scenario of cases) {
    const store = new CleanupStoreFixture();
    store.grant = grant;
    const coordinator = createProjectReadSnapshotCleanupCoordinator(
      dependencies(store, scenario.invoke),
    );
    const result = coordinator.resolve({ grant });
    assert.deepEqual(result, {
      status: ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED,
      reasonCode: scenario.expected,
      portInvoked: true,
    });
    assert.equal(store.resolutionCalls.length, 0);
  }
});

void test('Cleanup Runtime keeps Store conflicts unresolved after the port effect', () => {
  const grant = createGrant();
  const observation = createAbsentObservation(
    grant,
    ProjectReadSnapshotCleanupDisposition.DELETED,
    'runtime-store-conflict',
  );
  const cases = [
    {
      expected: ProjectReadSnapshotCleanupUnresolvedReasonCode.STORE_GRANT_CONFLICT,
      status: 'GRANT_CONFLICT',
    },
    {
      expected: ProjectReadSnapshotCleanupUnresolvedReasonCode.STORE_RESOLUTION_CONFLICT,
      status: 'RESOLUTION_CONFLICT',
    },
  ] as const;

  for (const scenario of cases) {
    const store = new CleanupStoreFixture();
    store.grant = grant;
    store.resolutionOverride = () => ({
      status: scenario.status,
      message: 'closed Store conflict',
    });
    let portCalls = 0;
    const coordinator = createProjectReadSnapshotCleanupCoordinator(
      dependencies(store, () => {
        portCalls += 1;
        return observation;
      }),
    );

    assert.deepEqual(coordinator.resolve({ grant }), {
      status: ProjectReadSnapshotCleanupCoordinatorStatus.UNRESOLVED,
      reasonCode: scenario.expected,
      portInvoked: true,
    });
    assert.equal(portCalls, 1);
    assert.equal(store.resolutionCalls.length, 1);
    assert.equal(store.outcome, undefined);
  }
});

void test('Cleanup Runtime applies one exact Outcome and later replays without a port call', () => {
  const grant = createGrant();
  const observation = createAbsentObservation(
    grant,
    ProjectReadSnapshotCleanupDisposition.DELETED,
    'runtime-applied',
  );
  const store = new CleanupStoreFixture();
  store.grant = grant;
  let portCalls = 0;
  const coordinator = createProjectReadSnapshotCleanupCoordinator(
    dependencies(store, (received) => {
      portCalls += 1;
      assert.deepEqual(received, grant);
      return observation;
    }),
  );

  const applied = coordinator.resolve({
    grant,
    correlationId: 'correlation-cleanup-runtime',
    causationId: 'causation-cleanup-runtime',
  });
  assert.equal(applied.status, ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED);
  assert.equal(applied.resolutionKind, ProjectReadSnapshotCleanupResolutionKind.APPLIED);
  assert.equal(applied.portInvoked, true);
  assert.equal(applied.outcome.cleanupObservationId, observation.id);
  assert.equal(applied.outcome.resolvedAt, '2026-08-09T10:00:06.000Z');
  assert.equal(store.resolutionCalls.length, 1);
  const resolutionCall = store.resolutionCalls[0];
  assert.ok(resolutionCall !== undefined);
  assert.equal(resolutionCall.correlationId, 'correlation-cleanup-runtime');
  assert.equal(resolutionCall.causationId, 'causation-cleanup-runtime');

  const replayed = coordinator.resolve({ grant });
  assert.equal(replayed.status, ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED);
  assert.equal(replayed.resolutionKind, ProjectReadSnapshotCleanupResolutionKind.RETAINED_REPLAY);
  assert.equal(replayed.portInvoked, false);
  assert.equal(replayed.outcome.outcomeDigest, applied.outcome.outcomeDigest);
  assert.equal(portCalls, 1);
  assert.equal(store.resolutionCalls.length, 1);
});

void test('Cleanup Runtime discards a concurrent local observation and returns the Store winner', () => {
  const grant = createGrant();
  const localObservation = createAbsentObservation(
    grant,
    ProjectReadSnapshotCleanupDisposition.DELETED,
    'runtime-local-loser',
  );
  const winningObservation = createAbsentObservation(
    grant,
    ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT,
    'runtime-store-winner',
  );
  const winningOutcome = createOutcome(grant, winningObservation, 'runtime-store-winner');
  const store = new CleanupStoreFixture();
  store.grant = grant;
  store.resolutionOverride = () => ({ status: 'REPLAYED', value: winningOutcome });
  const coordinator = createProjectReadSnapshotCleanupCoordinator(
    dependencies(store, () => localObservation),
  );

  const result = coordinator.resolve({ grant });
  assert.equal(result.status, ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED);
  assert.equal(result.resolutionKind, ProjectReadSnapshotCleanupResolutionKind.CONCURRENT_REPLAY);
  assert.equal(result.portInvoked, true);
  assert.equal(result.outcome.outcomeDigest, winningOutcome.outcomeDigest);
  assert.notEqual(result.outcome.cleanupObservationDigest, localObservation.observationDigest);
});

void test('Cleanup Runtime retries only the same Grant after an Outcome persistence failure', () => {
  const grant = createGrant();
  const observations = [
    createAbsentObservation(
      grant,
      ProjectReadSnapshotCleanupDisposition.DELETED,
      'runtime-before-outcome-crash',
    ),
    createAbsentObservation(
      grant,
      ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT,
      'runtime-after-outcome-crash',
    ),
  ];
  const store = new CleanupStoreFixture();
  store.grant = grant;
  let failResolution = true;
  store.resolutionOverride = (input) => {
    if (failResolution) {
      failResolution = false;
      throw new Error('injected transaction failure');
    }
    store.outcome = input.outcome;
    return { status: 'APPLIED', value: input.outcome };
  };
  let portCalls = 0;
  const coordinator = createProjectReadSnapshotCleanupCoordinator({
    ...dependencies(store, () => {
      const observation = observations[portCalls];
      portCalls += 1;
      assert.ok(observation !== undefined);
      return observation;
    }),
    clock: new DeterministicClock(['2026-08-09T10:00:06.000Z', '2026-08-09T10:00:07.000Z']),
  });

  assert.throws(() => coordinator.resolve({ grant }), /injected transaction failure/u);
  assert.equal(store.outcome, undefined);
  const recovered = coordinator.resolve({ grant });
  assert.equal(recovered.status, ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED);
  assert.equal(recovered.resolutionKind, ProjectReadSnapshotCleanupResolutionKind.APPLIED);
  assert.equal(recovered.outcome.disposition, ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT);
  assert.equal(portCalls, 2);
});
