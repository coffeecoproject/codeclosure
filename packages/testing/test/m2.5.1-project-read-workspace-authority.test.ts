import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  PROJECT_READ_GIT_STATE_PROFILE,
  PROJECT_READ_SOURCE_TREE_PROFILE,
  ProjectReadFileMode,
  attemptId,
  externalExecutionId,
  isoTimestamp,
  projectReadGitStateProjection,
  projectReadSnapshotId,
  projectReadSourceTreeProjection,
  projectReadWorkspaceAuthoritySnapshotId,
  projectReadWorkspaceObservationId,
  projectSourceReadAuthorityId,
  sha256Digest,
  type ExternalExecutionId,
} from '@codeclosure/domain';
import {
  ProjectReadWorkspaceClassification,
  ProjectReadWorkspaceRetention,
  assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot,
  createProjectReadSourceObservation,
  decodeProjectReadSourceObservation,
  decodeProjectReadWorkspaceAuthoritySnapshot,
  decodeProjectReadWorkspaceObservation,
  digestProjectReadWorkspaceValue,
  projectReadWorkspaceAuthoritySnapshotProjection,
  projectReadWorkspaceObservationProjection,
  type ProjectReadWorkspaceAuthoritySnapshot,
  type ProjectReadWorkspaceExpectedSnapshotV1,
  type ProjectReadWorkspaceObservation,
} from '@codeclosure/runtime';

const authorityId = projectSourceReadAuthorityId('project-read_workspace-contract');
const authorityRecordDigest = sha256Digest(`sha256:${'1'.repeat(64)}`);
const markerDigest = sha256Digest(`sha256:${'2'.repeat(64)}`);
const attempt = attemptId('attempt_project-read-workspace-contract');
const snapshotId = projectReadSnapshotId('project-read-snapshot_workspace-contract');
const externalId = externalExecutionId('external_project-read-workspace-contract');
const authoritySnapshotId = projectReadWorkspaceAuthoritySnapshotId(
  'project-read-authority-snapshot_workspace-contract',
);
const workspaceRootIdentity = '/fixture/project-read-workspaces';
const snapshotLeafRealpath = '/fixture/project-read-workspaces/workspace-contract';
const secondaryAuthorityId = projectSourceReadAuthorityId(
  'project-read_secondary-workspace-contract',
);
const secondaryAuthorityRecordDigest = sha256Digest(`sha256:${'3'.repeat(64)}`);
const secondaryMarkerDigest = sha256Digest(`sha256:${'4'.repeat(64)}`);
const secondaryAttempt = attemptId('attempt_secondary-project-read-workspace-contract');
const secondarySnapshotId = projectReadSnapshotId(
  'project-read-snapshot_secondary-workspace-contract',
);
const orphanAuthorityId = projectSourceReadAuthorityId('project-read_orphan-workspace-contract');
const orphanMarkerDigest = sha256Digest(`sha256:${'5'.repeat(64)}`);
const orphanSnapshotId = projectReadSnapshotId('project-read-snapshot_orphan-workspace-contract');

function createSecondaryExpectedSnapshot(
  options: {
    readonly attemptId?: ProjectReadWorkspaceExpectedSnapshotV1['attemptId'];
    readonly snapshotLeafRealpath?: string;
  } = {},
): ProjectReadWorkspaceExpectedSnapshotV1 {
  return {
    attemptId: options.attemptId ?? secondaryAttempt,
    authorityRecordDigest: secondaryAuthorityRecordDigest,
    ownershipMarkerDigest: secondaryMarkerDigest,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    projectReadAuthorityId: secondaryAuthorityId,
    retention: ProjectReadWorkspaceRetention.CURRENT,
    snapshotId: secondarySnapshotId,
    snapshotLeafRealpath:
      options.snapshotLeafRealpath ??
      '/fixture/project-read-workspaces/secondary-workspace-contract',
    workspaceRootIdentity,
  };
}

function createAuthoritySnapshot(
  retention: ProjectReadWorkspaceRetention | null = ProjectReadWorkspaceRetention.CURRENT,
  identitySuffix = 'workspace-contract',
  additionalExpectedSnapshots: readonly ProjectReadWorkspaceExpectedSnapshotV1[] = [],
): ProjectReadWorkspaceAuthoritySnapshot {
  const hasActiveConsumer = retention === ProjectReadWorkspaceRetention.CURRENT;
  const primaryExpectedSnapshots: readonly ProjectReadWorkspaceExpectedSnapshotV1[] =
    retention === null
      ? []
      : [
          {
            attemptId: attempt,
            authorityRecordDigest,
            ownershipMarkerDigest: markerDigest,
            ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
            projectReadAuthorityId: authorityId,
            retention,
            snapshotId,
            snapshotLeafRealpath,
            workspaceRootIdentity,
          },
        ];
  const expectedSnapshots = [...primaryExpectedSnapshots, ...additionalExpectedSnapshots].sort(
    (left, right) => left.snapshotId.localeCompare(right.snapshotId),
  );
  const snapshot = {
    activeConsumers: hasActiveConsumer
      ? [
          {
            attemptId: attempt,
            externalExecutionId: externalId,
            projectReadAuthorityId: authorityId,
            snapshotId,
          },
        ]
      : [],
    authoritySequence: 41,
    expectedSnapshots,
    id:
      identitySuffix === 'workspace-contract'
        ? authoritySnapshotId
        : projectReadWorkspaceAuthoritySnapshotId(
            `project-read-authority-snapshot_${identitySuffix}`,
          ),
    issuedAt: isoTimestamp('2026-08-08T09:00:00.000Z'),
    schemaVersion: 1 as const,
  } satisfies Omit<ProjectReadWorkspaceAuthoritySnapshot, 'authorityDigest'>;
  return decodeProjectReadWorkspaceAuthoritySnapshot({
    ...snapshot,
    authorityDigest: digestProjectReadWorkspaceValue(
      projectReadWorkspaceAuthoritySnapshotProjection(snapshot),
    ),
  });
}

interface ObservationOverrides {
  readonly activeExternalExecutionIds?: readonly ExternalExecutionId[];
  readonly ownershipMarkerDigest?: NonNullable<
    ProjectReadWorkspaceObservation['ownershipMarkerDigest']
  >;
  readonly projectReadAuthorityId?: NonNullable<
    ProjectReadWorkspaceObservation['projectReadAuthorityId']
  >;
  readonly snapshotId?: NonNullable<ProjectReadWorkspaceObservation['snapshotId']>;
  readonly snapshotLeafRealpath?: string;
}

function createObservation(
  classification: ProjectReadWorkspaceClassification,
  snapshot: ProjectReadWorkspaceAuthoritySnapshot,
  overrides: ObservationOverrides = {},
): ProjectReadWorkspaceObservation {
  const isOrphan = classification === ProjectReadWorkspaceClassification.OWNED_ORPHANED;
  const hasActiveConsumer = classification === ProjectReadWorkspaceClassification.OWNED_CURRENT;
  const suffix = classification.toLowerCase().replaceAll('_', '-');
  const observation = {
    activeExternalExecutionIds:
      overrides.activeExternalExecutionIds ?? (hasActiveConsumer ? [externalId] : []),
    authorityRecordDigest: isOrphan ? null : authorityRecordDigest,
    authoritySequence: snapshot.authoritySequence,
    authoritySnapshotDigest: snapshot.authorityDigest,
    authoritySnapshotId: snapshot.id,
    classification,
    id: projectReadWorkspaceObservationId(`project-read-observation_${suffix}`),
    observedAt: isoTimestamp('2026-08-08T09:00:01.000Z'),
    ownershipMarkerDigest: overrides.ownershipMarkerDigest ?? markerDigest,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    projectReadAuthorityId: overrides.projectReadAuthorityId ?? authorityId,
    schemaVersion: 1 as const,
    snapshotId: overrides.snapshotId ?? snapshotId,
    snapshotLeafRealpath: overrides.snapshotLeafRealpath ?? snapshotLeafRealpath,
    workspaceRootIdentity,
  } satisfies Omit<ProjectReadWorkspaceObservation, 'observationDigest'>;
  return decodeProjectReadWorkspaceObservation({
    ...observation,
    observationDigest: digestProjectReadWorkspaceValue(
      projectReadWorkspaceObservationProjection(observation),
    ),
  });
}

void test('project-read workspace authority snapshot binds exact persisted and active identities', () => {
  const snapshot = createAuthoritySnapshot();
  assert.equal(
    snapshot.authorityDigest,
    digestProjectReadWorkspaceValue(projectReadWorkspaceAuthoritySnapshotProjection(snapshot)),
  );
  assert.equal(snapshot.expectedSnapshots[0]?.retention, ProjectReadWorkspaceRetention.CURRENT);
  assert.equal(snapshot.activeConsumers[0]?.externalExecutionId, externalId);
  assert(Object.isFrozen(snapshot));
  assert(Object.isFrozen(snapshot.expectedSnapshots));
  assert(Object.isFrozen(snapshot.activeConsumers));

  assert.throws(
    () =>
      decodeProjectReadWorkspaceAuthoritySnapshot({
        ...snapshot,
        activeConsumers: [
          {
            ...snapshot.activeConsumers[0],
            attemptId: attemptId('attempt_substituted-workspace-consumer'),
          },
        ],
      }),
    /active consumer lacks exact current authority/u,
  );
  assert.throws(
    () =>
      decodeProjectReadWorkspaceAuthoritySnapshot({
        ...snapshot,
        expectedSnapshots: [snapshot.expectedSnapshots[0], snapshot.expectedSnapshots[0]],
      }),
    /snapshot IDs.*uniquely string-sorted/u,
  );
  assert.throws(
    () =>
      decodeProjectReadWorkspaceAuthoritySnapshot({
        ...snapshot,
        authorityDigest: sha256Digest(`sha256:${'f'.repeat(64)}`),
      }),
    /authority snapshot digest is inconsistent/u,
  );
  assert.throws(
    () =>
      createAuthoritySnapshot(ProjectReadWorkspaceRetention.CURRENT, 'duplicate-attempt', [
        createSecondaryExpectedSnapshot({ attemptId: attempt }),
      ]),
    /unique attempt, authority, and leaf identities/u,
  );
  assert.throws(
    () =>
      createAuthoritySnapshot(ProjectReadWorkspaceRetention.CURRENT, 'overlapping-leaves', [
        createSecondaryExpectedSnapshot({
          snapshotLeafRealpath: `${snapshotLeafRealpath}/nested`,
        }),
      ]),
    /snapshot leaves must not overlap/u,
  );
});

void test('project-read initial source observation rejects substituted roots and projection digests', () => {
  const sourceTreeFields = Object.freeze({
    schemaVersion: 1 as const,
    profile: PROJECT_READ_SOURCE_TREE_PROFILE,
    entries: Object.freeze([
      Object.freeze({
        schemaVersion: 1 as const,
        path: 'src/payment.ts',
        mode: ProjectReadFileMode.REGULAR,
        size: 4,
        contentDigest: sha256Digest(`sha256:${'6'.repeat(64)}`),
      }),
    ]),
    fileCount: 1,
    totalBytes: 4,
  });
  const sourceTree = Object.freeze({
    ...sourceTreeFields,
    projectionDigest: digestProjectReadWorkspaceValue(
      projectReadSourceTreeProjection(sourceTreeFields),
    ),
  });
  const gitStateFields = Object.freeze({
    schemaVersion: 1 as const,
    profile: PROJECT_READ_GIT_STATE_PROFILE,
    sourceProjectRoot: '/fixture/source',
    repositoryControlRootIdentity: '/fixture/source/.git',
    headCommit: 'a'.repeat(40),
    selectedPathSetDigest: sha256Digest(`sha256:${'7'.repeat(64)}`),
    stagedIndexManifestDigest: sha256Digest(`sha256:${'8'.repeat(64)}`),
    porcelainV2Digest: sha256Digest(`sha256:${'9'.repeat(64)}`),
  });
  const gitState = Object.freeze({
    ...gitStateFields,
    projectionDigest: digestProjectReadWorkspaceValue(
      projectReadGitStateProjection(gitStateFields),
    ),
  });
  const observation = createProjectReadSourceObservation({
    schemaVersion: 1,
    normalizedProjectRoot: '/fixture/source',
    resolvedProjectRoot: '/fixture/source',
    repositoryControlRootIdentity: '/fixture/source/.git',
    sourceTree,
    gitState,
    observedAt: '2026-08-08T09:00:00.000Z',
  });
  assert.deepEqual(decodeProjectReadSourceObservation(observation), observation);
  assert.throws(
    () =>
      decodeProjectReadSourceObservation({
        ...observation,
        resolvedProjectRoot: '/fixture/substituted',
      }),
    /projections are inconsistent|digest is inconsistent/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSourceObservation({
        ...observation,
        sourceTree: {
          ...sourceTree,
          projectionDigest: sha256Digest(`sha256:${'f'.repeat(64)}`),
        },
      }),
    /projections are inconsistent/u,
  );
});

void test('project-read workspace observations close current, retained, and orphan shapes', () => {
  const currentAuthority = createAuthoritySnapshot(ProjectReadWorkspaceRetention.CURRENT);
  const retainedAuthority = createAuthoritySnapshot(
    ProjectReadWorkspaceRetention.RETAINED,
    'retained-workspace-contract',
  );
  const orphanAuthority = createAuthoritySnapshot(null, 'orphan-workspace-contract');
  const current = createObservation(
    ProjectReadWorkspaceClassification.OWNED_CURRENT,
    currentAuthority,
  );
  const retained = createObservation(
    ProjectReadWorkspaceClassification.OWNED_RETAINED,
    retainedAuthority,
  );
  const orphan = createObservation(
    ProjectReadWorkspaceClassification.OWNED_ORPHANED,
    orphanAuthority,
  );
  assert.deepEqual(current.activeExternalExecutionIds, [externalId]);
  assert.deepEqual(retained.activeExternalExecutionIds, []);
  assert.equal(orphan.authorityRecordDigest, null);
  for (const [observation, authority] of [
    [current, currentAuthority],
    [retained, retainedAuthority],
    [orphan, orphanAuthority],
  ] as const) {
    assert.doesNotThrow(() =>
      assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(observation, authority),
    );
    assert.equal(
      observation.observationDigest,
      digestProjectReadWorkspaceValue(projectReadWorkspaceObservationProjection(observation)),
    );
    assert(Object.isFrozen(observation));
  }

  const siblingOrphan = createObservation(
    ProjectReadWorkspaceClassification.OWNED_ORPHANED,
    currentAuthority,
    {
      ownershipMarkerDigest: orphanMarkerDigest,
      projectReadAuthorityId: orphanAuthorityId,
      snapshotId: orphanSnapshotId,
      snapshotLeafRealpath: '/fixture/project-read-workspaces/orphan-workspace-contract',
    },
  );
  assert.doesNotThrow(() =>
    assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(siblingOrphan, currentAuthority),
  );
});

void test('project-read workspace authority relation rejects semantic substitutions', () => {
  const currentAuthority = createAuthoritySnapshot(ProjectReadWorkspaceRetention.CURRENT);
  const retainedAgainstCurrent = createObservation(
    ProjectReadWorkspaceClassification.OWNED_RETAINED,
    currentAuthority,
  );
  assert.throws(
    () =>
      assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(
        retainedAgainstCurrent,
        currentAuthority,
      ),
    /does not match retained authority/u,
  );

  const orphanAgainstCurrent = createObservation(
    ProjectReadWorkspaceClassification.OWNED_ORPHANED,
    currentAuthority,
  );
  assert.throws(
    () =>
      assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(
        orphanAgainstCurrent,
        currentAuthority,
      ),
    /collides with retained authority/u,
  );

  const nestedOrphan = createObservation(
    ProjectReadWorkspaceClassification.OWNED_ORPHANED,
    currentAuthority,
    {
      ownershipMarkerDigest: orphanMarkerDigest,
      projectReadAuthorityId: orphanAuthorityId,
      snapshotId: orphanSnapshotId,
      snapshotLeafRealpath: `${snapshotLeafRealpath}/nested-orphan`,
    },
  );
  assert.throws(
    () =>
      assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(nestedOrphan, currentAuthority),
    /collides with retained authority/u,
  );

  const authorityWithNestedCurrent = createAuthoritySnapshot(
    ProjectReadWorkspaceRetention.CURRENT,
    'nested-current-workspace-contract',
    [
      createSecondaryExpectedSnapshot({
        snapshotLeafRealpath: '/fixture/project-read-workspaces/parent/current',
      }),
    ],
  );
  const parentOrphan = createObservation(
    ProjectReadWorkspaceClassification.OWNED_ORPHANED,
    authorityWithNestedCurrent,
    {
      ownershipMarkerDigest: orphanMarkerDigest,
      projectReadAuthorityId: orphanAuthorityId,
      snapshotId: orphanSnapshotId,
      snapshotLeafRealpath: '/fixture/project-read-workspaces/parent',
    },
  );
  assert.throws(
    () =>
      assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(
        parentOrphan,
        authorityWithNestedCurrent,
      ),
    /collides with retained authority/u,
  );

  const currentWithoutConsumer = createObservation(
    ProjectReadWorkspaceClassification.OWNED_CURRENT,
    currentAuthority,
    { activeExternalExecutionIds: [] },
  );
  assert.throws(
    () =>
      assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(
        currentWithoutConsumer,
        currentAuthority,
      ),
    /active consumers do not match authority/u,
  );

  const current = createObservation(
    ProjectReadWorkspaceClassification.OWNED_CURRENT,
    currentAuthority,
  );
  const substitutedAuthority = createAuthoritySnapshot(
    ProjectReadWorkspaceRetention.CURRENT,
    'substituted-workspace-contract',
  );
  assert.throws(
    () =>
      assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(current, substitutedAuthority),
    /does not bind its authority snapshot/u,
  );
});

void test('project-read workspace observations reject widened cleanup eligibility claims', () => {
  const orphan = createObservation(
    ProjectReadWorkspaceClassification.OWNED_ORPHANED,
    createAuthoritySnapshot(null),
  );
  assert.throws(
    () =>
      decodeProjectReadWorkspaceObservation({
        ...orphan,
        authorityRecordDigest,
      }),
    /not exact absent authority/u,
  );

  const retained = createObservation(
    ProjectReadWorkspaceClassification.OWNED_RETAINED,
    createAuthoritySnapshot(ProjectReadWorkspaceRetention.RETAINED),
  );
  assert.throws(
    () =>
      decodeProjectReadWorkspaceObservation({
        ...retained,
        activeExternalExecutionIds: [externalId],
      }),
    /not inactive authority/u,
  );

  const current = createObservation(
    ProjectReadWorkspaceClassification.OWNED_CURRENT,
    createAuthoritySnapshot(ProjectReadWorkspaceRetention.CURRENT),
  );
  assert.throws(
    () => decodeProjectReadWorkspaceObservation({ ...current, cleanupAuthorized: true }),
    /unrecognized_keys|Unrecognized key/u,
  );
  assert.throws(
    () =>
      decodeProjectReadWorkspaceObservation({
        ...current,
        observationDigest: sha256Digest(`sha256:${'e'.repeat(64)}`),
      }),
    /observation digest is inconsistent/u,
  );
});
