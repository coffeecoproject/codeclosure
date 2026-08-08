import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_GIT_STATE_PROFILE,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  PROJECT_READ_SOURCE_TREE_PROFILE,
  PROJECT_READ_SOURCE_TREE_V1_BOUNDS,
  ProjectReadFileMode,
  ProjectReadLifecyclePolicy,
  ProjectReadModelUsableNetworkPolicy,
  ProjectReadRetentionPolicy,
  ProjectReadSnapshotAccessMode,
  ProjectReadSourceCheckoutAccess,
  WorkflowPhase,
  assertProjectReadSourceTreeInvariant,
  attemptId,
  decodeProjectReadGitStateProjection,
  decodeProjectReadSourceTreeProjection,
  decodeProjectSourceReadAuthorityRecord,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  projectReadGitStateProjection,
  projectReadSnapshotId,
  projectReadSelectedPathSetProjection,
  projectReadSourceTreeProjection,
  projectSourceReadAuthorityId,
  projectSourceReadAuthorityProjection,
  sha256Digest,
  workflowId,
  workflowVersion,
  type ProjectReadGitStateProjection,
  type ProjectReadSourceTreeProjection,
  type ProjectSourceReadAuthorityRecord,
} from '@codeclosure/domain';
import { CanonicalJsonSha256DigestProvider } from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const sourceRoot = '/fixture/source';
const repositoryControlRootIdentity = '/fixture/source/.git';
// Domain treats these as opaque raw-byte digests; Workspace integration owns Git-output validity.
const stagedIndexFixtureBytes = 'domain-fixture:staged-index\u0000';
const porcelainV2FixtureBytes = 'domain-fixture:porcelain-v2\u0000';

function createSourceTree(): ProjectReadSourceTreeProjection {
  const projection = {
    schemaVersion: 1 as const,
    profile: PROJECT_READ_SOURCE_TREE_PROFILE,
    entries: [
      {
        schemaVersion: 1 as const,
        path: 'package.json',
        mode: ProjectReadFileMode.REGULAR,
        size: 27,
        contentDigest: digests.digestUtf8('{"scripts":{"test":"node"}}'),
      },
      {
        schemaVersion: 1 as const,
        path: 'src/index.ts',
        mode: ProjectReadFileMode.REGULAR,
        size: 20,
        contentDigest: digests.digestUtf8('export const ok = 1;'),
      },
    ],
    fileCount: 2,
    totalBytes: 47,
  } satisfies Omit<ProjectReadSourceTreeProjection, 'projectionDigest'>;
  return decodeProjectReadSourceTreeProjection({
    ...projection,
    projectionDigest: digests.digest(projectReadSourceTreeProjection(projection)),
  });
}

function createGitState(): ProjectReadGitStateProjection {
  const projection = {
    schemaVersion: 1 as const,
    profile: PROJECT_READ_GIT_STATE_PROFILE,
    sourceProjectRoot: sourceRoot,
    repositoryControlRootIdentity,
    headCommit: '1ad4bbb383d8ef38e29400b2625810ffa9dfb953',
    selectedPathSetDigest: digests.digest(
      projectReadSelectedPathSetProjection(['package.json', 'src/index.ts']),
    ),
    stagedIndexManifestDigest: digests.digestUtf8(stagedIndexFixtureBytes),
    porcelainV2Digest: digests.digestUtf8(porcelainV2FixtureBytes),
  } satisfies Omit<ProjectReadGitStateProjection, 'projectionDigest'>;
  return decodeProjectReadGitStateProjection({
    ...projection,
    projectionDigest: digests.digest(projectReadGitStateProjection(projection)),
  });
}

function createEmptySourceTree(): ProjectReadSourceTreeProjection {
  const projection = {
    schemaVersion: 1 as const,
    profile: PROJECT_READ_SOURCE_TREE_PROFILE,
    entries: [],
    fileCount: 0,
    totalBytes: 0,
  } satisfies Omit<ProjectReadSourceTreeProjection, 'projectionDigest'>;
  return decodeProjectReadSourceTreeProjection({
    ...projection,
    projectionDigest: digests.digest(projectReadSourceTreeProjection(projection)),
  });
}

function createAuthority(
  phase: typeof WorkflowPhase.DISCOVERY | typeof WorkflowPhase.PLAN = WorkflowPhase.DISCOVERY,
): ProjectSourceReadAuthorityRecord {
  const sourceTree = createSourceTree();
  const record = {
    schemaVersion: 1 as const,
    id: projectSourceReadAuthorityId('project-read_contract'),
    goalId: goalId('goal_project-read-contract'),
    goalRevision: goalRevision(1),
    workflowId: workflowId('workflow_project-read-contract'),
    workflowVersion: workflowVersion(2),
    phase,
    attemptId: attemptId('attempt_project-read-contract'),
    normalizedProjectRoot: sourceRoot,
    resolvedProjectRoot: sourceRoot,
    repositoryControlRootIdentity,
    sourceTree,
    gitState: createGitState(),
    workspaceRootIdentity: '/fixture/project-read-workspaces',
    snapshotId: projectReadSnapshotId('project-read-snapshot_contract'),
    snapshotLeafRealpath: '/fixture/project-read-workspaces/read_contract',
    snapshotTreeDigest: sourceTree.projectionDigest,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    ownershipMarkerDigest: sha256Digest(`sha256:${'2'.repeat(64)}`),
    policyBundleId: policyBundleId('policy_project-read-contract'),
    policyBundleVersion: 'm2.5.1-v1',
    policyBundleDigest: sha256Digest(`sha256:${'3'.repeat(64)}`),
    executionProfileId: executionProfileId('profile_project-read-contract'),
    executionProfileVersion: 'm2.5.1-v3',
    executionProfileDigest: sha256Digest(`sha256:${'4'.repeat(64)}`),
    phaseDispatchEntryDigest: sha256Digest(`sha256:${'5'.repeat(64)}`),
    capabilityGrantDigest: sha256Digest(`sha256:${'6'.repeat(64)}`),
    responseContractDigest: sha256Digest(`sha256:${'7'.repeat(64)}`),
    accessMode: ProjectReadSnapshotAccessMode.READ_ONLY,
    sourceCheckoutAccess: ProjectReadSourceCheckoutAccess.NONE,
    modelUsableNetworkPolicy: ProjectReadModelUsableNetworkPolicy.DENIED,
    forbiddenRoots: ['/fixture/authority', '/fixture/candidates', '/fixture/source'],
    isolationProfileId: 'codex-project-read-isolation-v1',
    isolationProfileDigest: sha256Digest(`sha256:${'8'.repeat(64)}`),
    issuedAt: isoTimestamp('2026-08-08T08:00:00.000Z'),
    lifecyclePolicy: ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT,
    retentionPolicy: ProjectReadRetentionPolicy.RUNTIME_OWNED,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
  } satisfies Omit<ProjectSourceReadAuthorityRecord, 'recordDigest'>;
  return decodeProjectSourceReadAuthorityRecord({
    ...record,
    recordDigest: digests.digest(projectSourceReadAuthorityProjection(record)),
  });
}

void test('candidate-free project-read authority decodes only the closed v1 contract', () => {
  for (const phase of [WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN] as const) {
    const decoded = createAuthority(phase);
    assert.equal(decoded.phase, phase);
    assert.equal(
      decoded.recordDigest,
      digests.digest(projectSourceReadAuthorityProjection(decoded)),
    );
    assert.equal(
      decoded.sourceTree.projectionDigest,
      digests.digest(projectReadSourceTreeProjection(decoded.sourceTree)),
    );
    assert.equal(
      decoded.gitState.projectionDigest,
      digests.digest(projectReadGitStateProjection(decoded.gitState)),
    );
    assert(Object.isFrozen(decoded));
    assert(Object.isFrozen(decoded.sourceTree.entries));
  }

  const authority = createAuthority();
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        networkPolicy: ProjectReadModelUsableNetworkPolicy.DENIED,
      }),
    /unrecognized_keys|Unrecognized key/u,
  );
  assert.throws(
    () => decodeProjectSourceReadAuthorityRecord({ ...authority, unknownAuthority: true }),
    /unrecognized_keys|Unrecognized key/u,
  );
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        phase: WorkflowPhase.IMPLEMENT,
      }),
    /Invalid option|invalid_value/u,
  );
  assert.throws(
    () => decodeProjectSourceReadAuthorityRecord({ ...authority, goalRevision: 0 }),
    /too_small|Too small/u,
  );
});

void test('project-read authority rejects root substitution and effect widening', () => {
  const authority = createAuthority();
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        gitState: {
          ...authority.gitState,
          sourceProjectRoot: '/fixture/other',
          repositoryControlRootIdentity: '/fixture/other/.git',
        },
      }),
    /do not bind the exact selected roots/u,
  );
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        snapshotTreeDigest: sha256Digest(`sha256:${'1'.repeat(64)}`),
      }),
    /snapshot tree does not match the admitted source tree/u,
  );
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        accessMode: 'READ_WRITE',
      }),
    /Invalid input|invalid_value/u,
  );
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        forbiddenRoots: [...authority.forbiddenRoots].reverse(),
      }),
    /uniquely string-sorted/u,
  );
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        snapshotLeafRealpath: '/fixture/outside/read_contract',
      }),
    /exact workspace-root child/u,
  );
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        forbiddenRoots: ['/fixture/authority', '/fixture/candidates'],
      }),
    /must contain normalized and resolved source identities/u,
  );
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        workspaceRootIdentity: '/fixture',
        snapshotLeafRealpath: '/fixture/read_contract',
      }),
    /workspace containment overlaps a forbidden root/u,
  );
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        normalizedProjectRoot: '/fixture/source-alias',
      }),
    /must contain normalized and resolved source identities/u,
  );
  assert.throws(
    () =>
      decodeProjectSourceReadAuthorityRecord({
        ...authority,
        normalizedProjectRoot: '/fixture/project-read-workspaces/source-alias',
        forbiddenRoots: [
          '/fixture/authority',
          '/fixture/candidates',
          '/fixture/project-read-workspaces/source-alias',
          '/fixture/source',
        ],
      }),
    /workspace containment overlaps a forbidden root/u,
  );
});

void test('complete source projections reject reordered, traversing, and partial trees', () => {
  const sourceTree = createSourceTree();
  const firstEntry = sourceTree.entries[0];
  const secondEntry = sourceTree.entries[1];
  assert(firstEntry);
  assert(secondEntry);
  const emptySourceTree = createEmptySourceTree();
  assert.equal(emptySourceTree.fileCount, 0);
  assert.equal(emptySourceTree.totalBytes, 0);
  assert.deepEqual(emptySourceTree.entries, []);
  assert.throws(
    () =>
      decodeProjectReadSourceTreeProjection({
        ...sourceTree,
        entries: [...sourceTree.entries].reverse(),
      }),
    /uniquely string-sorted/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSourceTreeProjection({
        ...sourceTree,
        entries: [{ ...firstEntry, path: '../authority' }, secondEntry],
      }),
    /reserved or non-portable/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSourceTreeProjection({
        ...sourceTree,
        entries: [
          { ...firstEntry, path: 'src' },
          { ...secondEntry, path: 'src/index.ts' },
        ],
      }),
    /file as another file's ancestor/u,
  );
  assert.throws(
    () => decodeProjectReadSourceTreeProjection({ ...sourceTree, fileCount: 1 }),
    /file count is invalid/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSourceTreeProjection({
        ...sourceTree,
        entries: [
          { ...firstEntry, path: 'src/File.ts' },
          { ...secondEntry, path: 'src/file.ts' },
        ],
      }),
    /case or Unicode alias collision/u,
  );
  assert.throws(
    () =>
      decodeProjectReadSourceTreeProjection({
        ...sourceTree,
        entries: [{ ...firstEntry, path: '.git/config' }, secondEntry],
      }),
    /reserved or non-portable/u,
  );
  const gitState = createGitState();
  assert.throws(
    () =>
      decodeProjectReadGitStateProjection({
        ...gitState,
        repositoryControlRootIdentity: '/fixture/external-git',
      }),
    /control root must remain within the source root/u,
  );
  assert.throws(
    () =>
      assertProjectReadSourceTreeInvariant({
        ...sourceTree,
        entries: [
          {
            ...firstEntry,
            size: PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumFileBytes + 1,
          },
          secondEntry,
        ],
        totalBytes: PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumFileBytes + 21,
      }),
    /per-file byte bound/u,
  );
  assert.throws(
    () =>
      assertProjectReadSourceTreeInvariant({
        ...sourceTree,
        totalBytes: PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumTotalBytes + 1,
      }),
    /total bytes exceed the profile bound/u,
  );
  assert.throws(
    () =>
      assertProjectReadSourceTreeInvariant({
        ...sourceTree,
        entries: Array.from(
          { length: PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumFileCount + 1 },
          () => firstEntry,
        ),
        fileCount: PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumFileCount + 1,
        totalBytes: 0,
      }),
    /file count is invalid/u,
  );
});
