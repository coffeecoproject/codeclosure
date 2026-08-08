import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  PROJECT_READ_SOURCE_TREE_PROFILE,
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
  projectReadSnapshotCleanupObservationId,
  projectReadSnapshotCleanupOutcomeId,
  projectReadSnapshotCleanupGrantProjection,
  projectReadSnapshotCleanupOutcomeProjection,
  projectReadSnapshotId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectReadWorkspaceObservationId,
  projectSourceReadAuthorityId,
  sha256Digest,
  type ProjectReadSnapshotCleanupGrant,
  type ProjectReadSnapshotCleanupOutcome,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
  ProjectReadSnapshotCleanupTargetAliasDisposition,
  ProjectReadSnapshotCleanupTargetClassification,
  ProjectReadSnapshotCleanupCoordinationDisposition,
  ProjectReadSnapshotCleanupTargetEntryKind,
  ProjectReadSnapshotCleanupTargetManifestDisposition,
  ProjectReadSnapshotCleanupTargetMarkerDisposition,
  ProjectReadSnapshotCleanupRequestDisposition,
  ProjectReadSnapshotCleanupTargetState,
  ProjectReadWorkspaceClassification,
  ProjectReadWorkspaceRetention,
  assertOrphanedProjectReadSnapshotCleanupGrantEligibility,
  assertProjectReadSnapshotCleanupObservationMatchesGrant,
  assertProjectReadSnapshotCleanupOutcomeClosure,
  assertTerminalProjectReadSnapshotCleanupGrantEligibility,
  createProjectReadSnapshotCleanupTargetObservation,
  decideProjectReadSnapshotCleanupRequest,
  decodeProjectReadSnapshotCleanupTargetFingerprintProjection,
  decodeProjectReadSnapshotCleanupObservation,
  decodeProjectReadWorkspaceAuthoritySnapshot,
  decodeProjectReadWorkspaceObservation,
  digestProjectReadSnapshotCleanupValue,
  digestProjectReadWorkspaceValue,
  projectReadSnapshotCleanupObservationProjection,
  projectReadSnapshotCleanupTargetFingerprintProjection,
  projectReadWorkspaceAuthoritySnapshotProjection,
  projectReadWorkspaceObservationProjection,
  type ProjectReadCleanupAuthorityRecordView,
  type ProjectReadCleanupTerminalAttemptView,
  type ProjectReadCleanupTerminalExternalExecutionView,
  type ProjectReadSnapshotCleanupObservation,
  type ProjectReadSnapshotCleanupTargetFingerprintProjection,
  type ProjectReadSnapshotCleanupTargetObservation,
  type ProjectReadWorkspaceAuthoritySnapshot,
  type ProjectReadWorkspaceObservation,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const authorityId = projectSourceReadAuthorityId('project-read_cleanup-contract');
const snapshotId = projectReadSnapshotId('project-read-snapshot_cleanup-contract');
const attempt = attemptId('attempt_project-read-cleanup-contract');
const externalId = externalExecutionId('external_project-read-cleanup-contract');
const authoritySnapshotId = projectReadWorkspaceAuthoritySnapshotId(
  'project-read-authority-snapshot_cleanup-contract',
);
const workspaceObservationId = projectReadWorkspaceObservationId(
  'project-read-observation_cleanup-contract',
);
const grantId = projectReadSnapshotCleanupGrantId('project-read-cleanup-grant_cleanup-contract');
const cleanupObservationId = projectReadSnapshotCleanupObservationId(
  'project-read-cleanup-observation_cleanup-contract',
);
const outcomeId = projectReadSnapshotCleanupOutcomeId(
  'project-read-cleanup-outcome_cleanup-contract',
);
const workspaceRootIdentity = '/fixture/project-read-workspaces';
const snapshotLeafRealpath = '/fixture/project-read-workspaces/cleanup-contract';
const recordDigest = sha256Digest(`sha256:${'1'.repeat(64)}`);
const markerDigest = sha256Digest(`sha256:${'2'.repeat(64)}`);
const externalRecordDigest = sha256Digest(`sha256:${'3'.repeat(64)}`);
const targetManifestDigest = sha256Digest(`sha256:${'4'.repeat(64)}`);
const mismatchedMarkerDigest = sha256Digest(`sha256:${'5'.repeat(64)}`);

type TerminalCleanupGrantInput = Omit<
  Extract<ProjectReadSnapshotCleanupGrant, { eligibilityKind: 'TERMINAL' }>,
  'grantDigest'
>;
type OrphanedCleanupGrantInput = Omit<
  Extract<ProjectReadSnapshotCleanupGrant, { eligibilityKind: 'ORPHANED' }>,
  'grantDigest'
>;

function createTargetFingerprint(
  state: ProjectReadSnapshotCleanupTargetState,
  unsafeMarker = false,
): ProjectReadSnapshotCleanupTargetFingerprintProjection {
  return decodeProjectReadSnapshotCleanupTargetFingerprintProjection(
    state === ProjectReadSnapshotCleanupTargetState.ABSENT
      ? {
          schemaVersion: 1,
          profile: PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
          state,
          workspaceRootIdentity,
          workspaceRootDeviceId: '1024',
          workspaceRootFileId: '2048',
          snapshotLeafRealpath,
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
        }
      : {
          schemaVersion: 1,
          profile: PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
          state,
          workspaceRootIdentity,
          workspaceRootDeviceId: '1024',
          workspaceRootFileId: '2048',
          snapshotLeafRealpath,
          entryKind: ProjectReadSnapshotCleanupTargetEntryKind.DIRECTORY,
          aliasDisposition: ProjectReadSnapshotCleanupTargetAliasDisposition.EXACT,
          resolvedLeafRealpath: snapshotLeafRealpath,
          nodeDeviceId: '2049',
          nodeFileId: '4096',
          expectedOwnershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
          expectedOwnershipMarkerDigest: markerDigest,
          markerDisposition: unsafeMarker
            ? ProjectReadSnapshotCleanupTargetMarkerDisposition.MISMATCHED
            : ProjectReadSnapshotCleanupTargetMarkerDisposition.MATCHED,
          observedOwnershipMarkerDigest: unsafeMarker ? mismatchedMarkerDigest : markerDigest,
          manifestDisposition: ProjectReadSnapshotCleanupTargetManifestDisposition.RECORDED,
          targetManifestProfile: PROJECT_READ_SOURCE_TREE_PROFILE,
          targetManifestDigest,
        },
  );
}

function createTargetObservation(
  fingerprint: ProjectReadSnapshotCleanupTargetFingerprintProjection,
  observedAt: string,
): ProjectReadSnapshotCleanupTargetObservation {
  return createProjectReadSnapshotCleanupTargetObservation(fingerprint, observedAt);
}

function createAuthoritySnapshot(
  retention: ProjectReadWorkspaceRetention | null,
): ProjectReadWorkspaceAuthoritySnapshot {
  const value: Omit<ProjectReadWorkspaceAuthoritySnapshot, 'authorityDigest'> = {
    activeConsumers: [],
    authoritySequence: 51,
    expectedSnapshots:
      retention === null
        ? []
        : [
            {
              attemptId: attempt,
              authorityRecordDigest: recordDigest,
              ownershipMarkerDigest: markerDigest,
              ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
              projectReadAuthorityId: authorityId,
              retention,
              snapshotId,
              snapshotLeafRealpath,
              workspaceRootIdentity,
            },
          ],
    id: authoritySnapshotId,
    issuedAt: isoTimestamp('2026-08-08T10:00:00.000Z'),
    schemaVersion: 1 as const,
  };
  return decodeProjectReadWorkspaceAuthoritySnapshot({
    ...value,
    authorityDigest: digestProjectReadWorkspaceValue(
      projectReadWorkspaceAuthoritySnapshotProjection(value),
    ),
  });
}

function createOrphanObservation(
  authoritySnapshot: ProjectReadWorkspaceAuthoritySnapshot,
): ProjectReadWorkspaceObservation {
  const value: Omit<ProjectReadWorkspaceObservation, 'observationDigest'> = {
    activeExternalExecutionIds: [],
    authorityRecordDigest: null,
    authoritySequence: authoritySnapshot.authoritySequence,
    authoritySnapshotDigest: authoritySnapshot.authorityDigest,
    authoritySnapshotId: authoritySnapshot.id,
    classification: ProjectReadWorkspaceClassification.OWNED_ORPHANED,
    id: workspaceObservationId,
    observedAt: isoTimestamp('2026-08-08T10:00:01.000Z'),
    ownershipMarkerDigest: markerDigest,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    projectReadAuthorityId: authorityId,
    schemaVersion: 1 as const,
    snapshotId,
    snapshotLeafRealpath,
    workspaceRootIdentity,
  };
  return decodeProjectReadWorkspaceObservation({
    ...value,
    observationDigest: digestProjectReadWorkspaceValue(
      projectReadWorkspaceObservationProjection(value),
    ),
  });
}

function createTerminalGrant(
  authoritySnapshot: ProjectReadWorkspaceAuthoritySnapshot,
  overrides: Partial<TerminalCleanupGrantInput> = {},
): ProjectReadSnapshotCleanupGrant {
  const value: TerminalCleanupGrantInput = {
    schemaVersion: 1 as const,
    id: grantId,
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.TERMINAL,
    authoritySnapshotId: authoritySnapshot.id,
    authoritySnapshotDigest: authoritySnapshot.authorityDigest,
    authoritySequence: authoritySnapshot.authoritySequence,
    projectReadAuthorityId: authorityId,
    snapshotId,
    workspaceRootIdentity,
    snapshotLeafRealpath,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    ownershipMarkerDigest: markerDigest,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt: isoTimestamp('2026-08-08T10:00:04.000Z'),
    projectReadAuthorityRecordDigest: recordDigest,
    attemptId: attempt,
    terminalAttemptStatus: AttemptStatus.RESULT_RECORDED,
    terminalAttemptEndedAt: isoTimestamp('2026-08-08T10:00:02.000Z'),
    externalExecutionId: externalId,
    terminalExternalExecutionState: ExternalExecutionState.COMPLETED,
    terminalExternalExecutionAt: isoTimestamp('2026-08-08T10:00:03.000Z'),
    terminalExternalExecutionRecordDigest: externalRecordDigest,
    ...overrides,
  };
  return decodeProjectReadSnapshotCleanupGrant(
    {
      ...value,
      grantDigest: digests.digest(projectReadSnapshotCleanupGrantProjection(value)),
    },
    digests,
  );
}

function createOrphanGrant(
  authoritySnapshot: ProjectReadWorkspaceAuthoritySnapshot,
  observation: ProjectReadWorkspaceObservation,
  overrides: Partial<OrphanedCleanupGrantInput> = {},
): ProjectReadSnapshotCleanupGrant {
  const value: OrphanedCleanupGrantInput = {
    schemaVersion: 1 as const,
    id: grantId,
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.ORPHANED,
    authoritySnapshotId: authoritySnapshot.id,
    authoritySnapshotDigest: authoritySnapshot.authorityDigest,
    authoritySequence: authoritySnapshot.authoritySequence,
    projectReadAuthorityId: authorityId,
    snapshotId,
    workspaceRootIdentity,
    snapshotLeafRealpath,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    ownershipMarkerDigest: markerDigest,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt: isoTimestamp('2026-08-08T10:00:02.000Z'),
    workspaceObservationId: observation.id,
    workspaceObservationDigest: observation.observationDigest,
    ...overrides,
  };
  return decodeProjectReadSnapshotCleanupGrant(
    {
      ...value,
      grantDigest: digests.digest(projectReadSnapshotCleanupGrantProjection(value)),
    },
    digests,
  );
}

function createCleanupObservation(
  grant: ProjectReadSnapshotCleanupGrant,
  disposition: ProjectReadSnapshotCleanupDisposition,
  overrides: Readonly<Record<string, unknown>> = {},
): ProjectReadSnapshotCleanupObservation {
  const isAbsent =
    disposition === ProjectReadSnapshotCleanupDisposition.DELETED ||
    disposition === ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT;
  const isFailed = disposition === ProjectReadSnapshotCleanupDisposition.FAILED;
  const targetState = isAbsent
    ? ProjectReadSnapshotCleanupTargetState.ABSENT
    : ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED;
  const terminalTargetObservation = createTargetObservation(
    createTargetFingerprint(
      targetState,
      disposition === ProjectReadSnapshotCleanupDisposition.RETAINED_UNSAFE,
    ),
    '2026-08-08T10:00:05.000Z',
  );
  const value = {
    schemaVersion: 1 as const,
    id: cleanupObservationId,
    grantId: grant.id,
    grantDigest: grant.grantDigest,
    disposition,
    workspaceRootIdentity: grant.workspaceRootIdentity,
    snapshotLeafRealpath: grant.snapshotLeafRealpath,
    expectedOwnershipMarkerProfile: grant.ownershipMarkerProfile,
    expectedOwnershipMarkerDigest: grant.ownershipMarkerDigest,
    terminalTargetObservation,
    failurePreEffectTargetObservation: isFailed
      ? createTargetObservation(
          createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED),
          '2026-08-08T10:00:04.500Z',
        )
      : null,
    coordinationDisposition: isAbsent
      ? ProjectReadSnapshotCleanupCoordinationDisposition.CLEARED
      : ProjectReadSnapshotCleanupCoordinationDisposition.INERT_RETAINED,
    observedAt: isoTimestamp('2026-08-08T10:00:05.000Z'),
    ...overrides,
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
  overrides: Readonly<Record<string, unknown>> = {},
): ProjectReadSnapshotCleanupOutcome {
  const value = {
    schemaVersion: 1 as const,
    id: outcomeId,
    grantId: grant.id,
    grantDigest: grant.grantDigest,
    cleanupObservationId: observation.id,
    cleanupObservationDigest: observation.observationDigest,
    disposition: observation.disposition,
    resolvedAt: isoTimestamp('2026-08-08T10:00:06.000Z'),
    ...overrides,
  };
  return decodeProjectReadSnapshotCleanupOutcome(
    {
      ...value,
      outcomeDigest: digests.digest(projectReadSnapshotCleanupOutcomeProjection(value)),
    },
    digests,
  );
}

const recordView: ProjectReadCleanupAuthorityRecordView = {
  id: authorityId,
  recordDigest,
  snapshotId,
  workspaceRootIdentity,
  snapshotLeafRealpath,
  ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  ownershipMarkerDigest: markerDigest,
  attemptId: attempt,
};
const attemptView: ProjectReadCleanupTerminalAttemptView = {
  id: attempt,
  status: AttemptStatus.RESULT_RECORDED,
  endedAt: isoTimestamp('2026-08-08T10:00:02.000Z'),
};
const externalView: ProjectReadCleanupTerminalExternalExecutionView = {
  id: externalId,
  attemptId: attempt,
  state: ExternalExecutionState.COMPLETED,
  terminalAt: isoTimestamp('2026-08-08T10:00:03.000Z'),
  recordDigest: externalRecordDigest,
};

void test('terminal cleanup Grant binds exact retained record, Attempt, and external execution authority', () => {
  const authoritySnapshot = createAuthoritySnapshot(ProjectReadWorkspaceRetention.RETAINED);
  const grant = createTerminalGrant(authoritySnapshot);
  assertTerminalProjectReadSnapshotCleanupGrantEligibility(
    grant,
    authoritySnapshot,
    recordView,
    attemptView,
    externalView,
  );

  assert.throws(
    () =>
      assertTerminalProjectReadSnapshotCleanupGrantEligibility(
        grant,
        authoritySnapshot,
        { ...recordView, recordDigest: sha256Digest(`sha256:${'9'.repeat(64)}`) },
        attemptView,
        externalView,
      ),
    /substituted project-read authority/u,
  );
  assert.throws(
    () =>
      assertTerminalProjectReadSnapshotCleanupGrantEligibility(
        grant,
        authoritySnapshot,
        recordView,
        { ...attemptView, endedAt: isoTimestamp('2026-08-08T10:00:01.000Z') },
        externalView,
      ),
    /substituted terminal Attempt/u,
  );
  assert.throws(
    () =>
      assertTerminalProjectReadSnapshotCleanupGrantEligibility(
        grant,
        authoritySnapshot,
        recordView,
        attemptView,
        { ...externalView, recordDigest: sha256Digest(`sha256:${'8'.repeat(64)}`) },
      ),
    /substituted terminal external execution/u,
  );
  assert.throws(
    () =>
      assertTerminalProjectReadSnapshotCleanupGrantEligibility(
        grant,
        createAuthoritySnapshot(ProjectReadWorkspaceRetention.CURRENT),
        recordView,
        attemptView,
        externalView,
      ),
    /exact authority snapshot|inactive retained authority/u,
  );
});

void test('orphan cleanup Grant requires the exact absent identity and OWNED_ORPHANED observation', () => {
  const authoritySnapshot = createAuthoritySnapshot(null);
  const observation = createOrphanObservation(authoritySnapshot);
  const grant = createOrphanGrant(authoritySnapshot, observation);
  assertOrphanedProjectReadSnapshotCleanupGrantEligibility(grant, authoritySnapshot, observation);

  const substitutedObservation = decodeProjectReadWorkspaceObservation({
    ...observation,
    id: projectReadWorkspaceObservationId('project-read-observation_substituted-cleanup'),
    observationDigest: digestProjectReadWorkspaceValue(
      projectReadWorkspaceObservationProjection({
        ...observation,
        id: projectReadWorkspaceObservationId('project-read-observation_substituted-cleanup'),
      }),
    ),
  });
  assert.throws(
    () =>
      assertOrphanedProjectReadSnapshotCleanupGrantEligibility(
        grant,
        authoritySnapshot,
        substitutedObservation,
      ),
    /exact owned-orphan observation/u,
  );
});

void test('target fingerprint v1 freezes physical facts before Observation digesting', () => {
  const present = createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED);
  const observation = createTargetObservation(present, '2026-08-08T10:00:05.000Z');
  assert.equal(
    observation.classification,
    ProjectReadSnapshotCleanupTargetClassification.EXACT_OWNED,
  );
  assert.deepEqual(observation.fingerprint, present);
  assert.equal(
    observation.fingerprintDigest,
    digestProjectReadSnapshotCleanupValue(
      projectReadSnapshotCleanupTargetFingerprintProjection(present),
    ),
  );

  assert.throws(
    () =>
      decodeProjectReadSnapshotCleanupTargetFingerprintProjection({
        ...present,
        unknownPhysicalClaim: true,
      }),
    /unrecognized_keys|Unrecognized key/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSnapshotCleanupTargetFingerprintProjection({
        ...createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.ABSENT),
        nodeFileId: '4096',
      }),
    /retains present target facts/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSnapshotCleanupTargetFingerprintProjection({
        ...present,
        observedOwnershipMarkerDigest: mismatchedMarkerDigest,
      }),
    /marker digest is inconsistent/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSnapshotCleanupTargetFingerprintProjection({
        ...present,
        resolvedLeafRealpath: `${snapshotLeafRealpath}-replacement`,
      }),
    /alias drift/u,
  );
});

void test('cleanup Observation strictly closes only the four proven terminal dispositions', () => {
  const grant = createTerminalGrant(
    createAuthoritySnapshot(ProjectReadWorkspaceRetention.RETAINED),
  );
  for (const disposition of Object.values(ProjectReadSnapshotCleanupDisposition)) {
    const observation = createCleanupObservation(grant, disposition);
    assert.equal(observation.disposition, disposition);
    assertProjectReadSnapshotCleanupObservationMatchesGrant(observation, grant);
  }

  const substitutedExpectedMarkerDigest = sha256Digest(`sha256:${'8'.repeat(64)}`);
  const substitutedMarkerFingerprint = decodeProjectReadSnapshotCleanupTargetFingerprintProjection({
    ...createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED, true),
    expectedOwnershipMarkerDigest: substitutedExpectedMarkerDigest,
  });
  const substitutedMarker = createCleanupObservation(
    grant,
    ProjectReadSnapshotCleanupDisposition.RETAINED_UNSAFE,
    {
      expectedOwnershipMarkerDigest: substitutedExpectedMarkerDigest,
      terminalTargetObservation: createTargetObservation(
        substitutedMarkerFingerprint,
        '2026-08-08T10:00:05.000Z',
      ),
    },
  );
  assert.throws(
    () => assertProjectReadSnapshotCleanupObservationMatchesGrant(substitutedMarker, grant),
    /does not bind its exact grant/u,
  );

  const predatingFailure = createCleanupObservation(
    grant,
    ProjectReadSnapshotCleanupDisposition.FAILED,
    {
      failurePreEffectTargetObservation: createTargetObservation(
        createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED),
        '2026-08-08T10:00:03.500Z',
      ),
    },
  );
  assert.throws(
    () => assertProjectReadSnapshotCleanupObservationMatchesGrant(predatingFailure, grant),
    /does not bind its exact grant/u,
  );

  assert.throws(
    () =>
      createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.FAILED, {
        failurePreEffectTargetObservation: createTargetObservation(
          createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED, true),
          '2026-08-08T10:00:04.500Z',
        ),
      }),
    /exact-owned no-effect reobservation/u,
  );
  assert.throws(
    () =>
      createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.FAILED, {
        terminalTargetObservation: createTargetObservation(
          createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.ABSENT),
          '2026-08-08T10:00:05.000Z',
        ),
      }),
    /exact-owned no-effect reobservation/u,
  );
  const unsafePreEffectTargetObservation = createTargetObservation(
    createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED, true),
    '2026-08-08T10:00:04.500Z',
  );
  const unsafeTerminalTargetObservation = createTargetObservation(
    createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED, true),
    '2026-08-08T10:00:05.000Z',
  );
  assert.throws(
    () =>
      createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.FAILED, {
        failurePreEffectTargetObservation: unsafePreEffectTargetObservation,
        terminalTargetObservation: unsafeTerminalTargetObservation,
      }),
    /exact-owned no-effect reobservation/u,
  );
  assert.throws(
    () =>
      createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.RETAINED_UNSAFE, {
        terminalTargetObservation: createTargetObservation(
          createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED),
          '2026-08-08T10:00:05.000Z',
        ),
      }),
    /current unsafe target/u,
  );
  assert.throws(
    () =>
      createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.RETAINED_UNSAFE, {
        terminalTargetObservation: {
          ...unsafeTerminalTargetObservation,
          classification: ProjectReadSnapshotCleanupTargetClassification.EXACT_OWNED,
        },
      }),
    /target classification is inconsistent/u,
  );
  assert.throws(
    () =>
      createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.RETAINED_UNSAFE, {
        terminalTargetObservation: {
          ...unsafeTerminalTargetObservation,
          fingerprintDigest: mismatchedMarkerDigest,
        },
      }),
    /target fingerprint digest is inconsistent/u,
  );
  const substitutedRoot = '/fixture/substituted-project-read-workspaces';
  const substitutedLeaf = `${substitutedRoot}/cleanup-contract`;
  const substitutedFingerprint = decodeProjectReadSnapshotCleanupTargetFingerprintProjection({
    ...createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED),
    workspaceRootIdentity: substitutedRoot,
    snapshotLeafRealpath: substitutedLeaf,
    resolvedLeafRealpath: substitutedLeaf,
  });
  assert.throws(
    () =>
      createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.FAILED, {
        failurePreEffectTargetObservation: createTargetObservation(
          substitutedFingerprint,
          '2026-08-08T10:00:04.500Z',
        ),
        terminalTargetObservation: createTargetObservation(
          substitutedFingerprint,
          '2026-08-08T10:00:05.000Z',
        ),
      }),
    /target fingerprint does not bind its outer observation/u,
  );
  assert.throws(
    () =>
      createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.RETAINED_UNSAFE, {
        terminalTargetObservation: {
          ...unsafeTerminalTargetObservation,
          fingerprint: {
            ...unsafeTerminalTargetObservation.fingerprint,
            profile: 'unowned-target-fingerprint-v1',
          },
        },
      }),
    /invalid_value|Invalid literal|profile/u,
  );
  assert.throws(
    () =>
      createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.DELETED, {
        coordinationDisposition: ProjectReadSnapshotCleanupCoordinationDisposition.INERT_RETAINED,
      }),
    /cleared terminal observation/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSnapshotCleanupObservation({
        ...createCleanupObservation(grant, ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT),
        unknownTerminalClaim: true,
      }),
    /unrecognized_keys|Unrecognized key/u,
  );
});

void test('Cleanup Outcome closes one exact Grant and terminal Observation', () => {
  const grant = createTerminalGrant(
    createAuthoritySnapshot(ProjectReadWorkspaceRetention.RETAINED),
  );
  const observation = createCleanupObservation(
    grant,
    ProjectReadSnapshotCleanupDisposition.DELETED,
  );
  const outcome = createOutcome(grant, observation);
  assertProjectReadSnapshotCleanupOutcomeClosure(outcome, observation, grant);

  const substitutedObservation = createCleanupObservation(
    grant,
    ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT,
  );
  assert.throws(
    () => assertProjectReadSnapshotCleanupOutcomeClosure(outcome, substitutedObservation, grant),
    /does not close its exact observation/u,
  );
});

void test('cleanup v1 canonical projections retain fixed golden digests', () => {
  const absentFingerprint = createTargetFingerprint(ProjectReadSnapshotCleanupTargetState.ABSENT);
  const presentFingerprint = createTargetFingerprint(
    ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED,
  );
  const unsafeFingerprint = createTargetFingerprint(
    ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED,
    true,
  );
  const retainedAuthority = createAuthoritySnapshot(ProjectReadWorkspaceRetention.RETAINED);
  const terminalGrant = createTerminalGrant(retainedAuthority);
  const orphanAuthority = createAuthoritySnapshot(null);
  const orphanObservation = createOrphanObservation(orphanAuthority);
  const orphanGrant = createOrphanGrant(orphanAuthority, orphanObservation);
  const failedObservation = createCleanupObservation(
    terminalGrant,
    ProjectReadSnapshotCleanupDisposition.FAILED,
  );
  const absentObservation = createCleanupObservation(
    terminalGrant,
    ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT,
  );
  const outcome = createOutcome(terminalGrant, absentObservation);

  assert.deepEqual(
    {
      absentObservation: absentObservation.observationDigest,
      absentTargetFingerprint: digestProjectReadSnapshotCleanupValue(
        projectReadSnapshotCleanupTargetFingerprintProjection(absentFingerprint),
      ),
      failedObservation: failedObservation.observationDigest,
      orphanGrant: orphanGrant.grantDigest,
      outcome: outcome.outcomeDigest,
      presentTargetFingerprint: digestProjectReadSnapshotCleanupValue(
        projectReadSnapshotCleanupTargetFingerprintProjection(presentFingerprint),
      ),
      terminalGrant: terminalGrant.grantDigest,
      unsafeTargetFingerprint: digestProjectReadSnapshotCleanupValue(
        projectReadSnapshotCleanupTargetFingerprintProjection(unsafeFingerprint),
      ),
    },
    {
      absentObservation: 'sha256:ef6e541e67efc668c2ad4c9285184fe83d01b74f2db281ca6acccd149aa8fa18',
      absentTargetFingerprint:
        'sha256:2bfeeefa2c60d0174d1d5069c66ce565cb95a5979415972fce3d1575f9996687',
      failedObservation: 'sha256:e0c0949d9377f7526263c55adc3aa404e523220691ad1b96af5f1f45b7a84c6e',
      orphanGrant: 'sha256:e166f739b053a58c2e8f14ae9211bc4b7e0b503304ae04d1fa4c23a84246102a',
      outcome: 'sha256:dc4ba98127d6554e6d739eaea3f6d8ef2827847ad1bacd64ab9a8c34a1b67caa',
      presentTargetFingerprint:
        'sha256:cfcb42973dcc8214fd3e64a5c356ef2b3a1357f3859c9940a7ec9fce8ae3b9aa',
      terminalGrant: 'sha256:1a98c24db8eeb6eccee67db4a035401999d8d68f13d8f9ee4c23c842659d4d02',
      unsafeTargetFingerprint:
        'sha256:b52162ec4338b966ea70da9ece910e0c611fbfcdd1041627e25f30ed4e2dfaf4',
    },
  );
});

void test('request admission rejects missing/conflicting authority and reuses only the exact Grant', () => {
  const authoritySnapshot = createAuthoritySnapshot(ProjectReadWorkspaceRetention.RETAINED);
  const grant = createTerminalGrant(authoritySnapshot);
  const missing = decideProjectReadSnapshotCleanupRequest(grant, null, null);
  assert.equal(
    missing.disposition,
    ProjectReadSnapshotCleanupRequestDisposition.REJECTED_MISSING_GRANT,
  );

  const conflictingGrant = createTerminalGrant(authoritySnapshot, {
    issuedAt: isoTimestamp('2026-08-08T10:00:05.000Z'),
  });
  const conflict = decideProjectReadSnapshotCleanupRequest(conflictingGrant, grant, null);
  assert.equal(
    conflict.disposition,
    ProjectReadSnapshotCleanupRequestDisposition.REJECTED_IDENTITY_CONFLICT,
  );

  const unresolved = decideProjectReadSnapshotCleanupRequest(grant, grant, null);
  assert.equal(
    unresolved.disposition,
    ProjectReadSnapshotCleanupRequestDisposition.INVOKE_UNRESOLVED,
  );
  assert.strictEqual(unresolved.grant, grant);

  const observation = createCleanupObservation(
    grant,
    ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT,
  );
  const outcome = createOutcome(grant, observation);
  const replay = decideProjectReadSnapshotCleanupRequest(grant, grant, outcome);
  assert.equal(
    replay.disposition,
    ProjectReadSnapshotCleanupRequestDisposition.RETURN_RETAINED_OUTCOME,
  );
  assert.strictEqual(replay.outcome, outcome);
});

void test('strict codecs reject content substitution, extra fields, and invalid identifiers', () => {
  const authoritySnapshot = createAuthoritySnapshot(ProjectReadWorkspaceRetention.RETAINED);
  const grant = createTerminalGrant(authoritySnapshot);
  assert.throws(
    () =>
      decodeProjectReadSnapshotCleanupGrant(
        { ...grant, snapshotLeafRealpath: `${snapshotLeafRealpath}-substituted` },
        digests,
      ),
    /canonical projection/u,
  );
  assert.throws(
    () => decodeProjectReadSnapshotCleanupGrant({ ...grant, extraAuthority: true }, digests),
    /unrecognized_keys|Unrecognized key/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSnapshotCleanupGrant(
        { ...grant, id: 'cleanup-grant_without-frozen-prefix' },
        digests,
      ),
    /ProjectReadSnapshotCleanupGrantId/u,
  );
});
