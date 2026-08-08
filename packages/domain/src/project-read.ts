import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  attemptId,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  projectReadSnapshotId,
  projectSourceReadAuthorityId,
  sha256Digest,
  workflowId,
  workflowVersion,
  type AttemptId,
  type ExecutionProfileId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type PolicyBundleId,
  type ProjectReadSnapshotId,
  type ProjectSourceReadAuthorityId,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowVersion,
} from './identifiers.js';
import { WorkflowPhase } from './model.js';

export const PROJECT_READ_SOURCE_TREE_PROFILE = 'codeclosure-project-read-source-tree-v1';
export const PROJECT_READ_GIT_STATE_PROFILE = 'codeclosure-project-read-git-state-v1';
export const PROJECT_READ_OWNERSHIP_MARKER_PROFILE = 'codeclosure-project-read-marker-v1';
export const PROJECT_READ_CLEANUP_POLICY = 'codeclosure-project-read-cleanup-v1';
export const PROJECT_READ_SOURCE_TREE_V1_BOUNDS = Object.freeze({
  maximumFileBytes: 4 * 1024 * 1024,
  maximumFileCount: 4_096,
  maximumPathBytes: 4_096,
  maximumTotalBytes: 64 * 1024 * 1024,
});

export const ProjectReadFileMode = {
  EXECUTABLE: 'EXECUTABLE',
  REGULAR: 'REGULAR',
} as const;
export type ProjectReadFileMode = (typeof ProjectReadFileMode)[keyof typeof ProjectReadFileMode];

export const ProjectReadSnapshotAccessMode = {
  READ_ONLY: 'READ_ONLY',
} as const;
export type ProjectReadSnapshotAccessMode =
  (typeof ProjectReadSnapshotAccessMode)[keyof typeof ProjectReadSnapshotAccessMode];

export const ProjectReadSourceCheckoutAccess = {
  NONE: 'NONE',
} as const;
export type ProjectReadSourceCheckoutAccess =
  (typeof ProjectReadSourceCheckoutAccess)[keyof typeof ProjectReadSourceCheckoutAccess];

export const ProjectReadModelUsableNetworkPolicy = {
  DENIED: 'DENIED',
} as const;
export type ProjectReadModelUsableNetworkPolicy =
  (typeof ProjectReadModelUsableNetworkPolicy)[keyof typeof ProjectReadModelUsableNetworkPolicy];

export const ProjectReadLifecyclePolicy = {
  SINGLE_WORKER_ATTEMPT: 'SINGLE_WORKER_ATTEMPT',
} as const;
export type ProjectReadLifecyclePolicy =
  (typeof ProjectReadLifecyclePolicy)[keyof typeof ProjectReadLifecyclePolicy];

export const ProjectReadRetentionPolicy = {
  RUNTIME_OWNED: 'RUNTIME_OWNED',
} as const;
export type ProjectReadRetentionPolicy =
  (typeof ProjectReadRetentionPolicy)[keyof typeof ProjectReadRetentionPolicy];

export interface ProjectReadSourceTreeEntry {
  readonly schemaVersion: 1;
  readonly path: string;
  readonly mode: ProjectReadFileMode;
  readonly size: number;
  readonly contentDigest: Sha256Digest;
}

export interface ProjectReadSourceTreeProjection {
  readonly schemaVersion: 1;
  readonly profile: typeof PROJECT_READ_SOURCE_TREE_PROFILE;
  readonly entries: readonly ProjectReadSourceTreeEntry[];
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly projectionDigest: Sha256Digest;
}

export interface ProjectReadGitStateProjection {
  readonly schemaVersion: 1;
  readonly profile: typeof PROJECT_READ_GIT_STATE_PROFILE;
  readonly sourceProjectRoot: string;
  readonly repositoryControlRootIdentity: string;
  readonly headCommit: string;
  readonly selectedPathSetDigest: Sha256Digest;
  readonly stagedIndexManifestDigest: Sha256Digest;
  readonly porcelainV2Digest: Sha256Digest;
  readonly projectionDigest: Sha256Digest;
}

export interface ProjectSourceReadAuthorityRecordV1 {
  readonly schemaVersion: 1;
  readonly id: ProjectSourceReadAuthorityId;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
  readonly phase: typeof WorkflowPhase.DISCOVERY | typeof WorkflowPhase.PLAN;
  readonly attemptId: AttemptId;
  readonly normalizedProjectRoot: string;
  readonly resolvedProjectRoot: string;
  readonly repositoryControlRootIdentity: string;
  readonly sourceTree: ProjectReadSourceTreeProjection;
  readonly gitState: ProjectReadGitStateProjection;
  readonly workspaceRootIdentity: string;
  readonly snapshotId: ProjectReadSnapshotId;
  readonly snapshotLeafRealpath: string;
  readonly snapshotTreeDigest: Sha256Digest;
  readonly ownershipMarkerProfile: typeof PROJECT_READ_OWNERSHIP_MARKER_PROFILE;
  readonly ownershipMarkerDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleVersion: string;
  readonly policyBundleDigest: Sha256Digest;
  readonly executionProfileId: ExecutionProfileId;
  readonly executionProfileVersion: string;
  readonly executionProfileDigest: Sha256Digest;
  readonly phaseDispatchEntryDigest: Sha256Digest;
  readonly capabilityGrantDigest: Sha256Digest;
  readonly responseContractDigest: Sha256Digest;
  readonly accessMode: typeof ProjectReadSnapshotAccessMode.READ_ONLY;
  readonly sourceCheckoutAccess: typeof ProjectReadSourceCheckoutAccess.NONE;
  readonly modelUsableNetworkPolicy: typeof ProjectReadModelUsableNetworkPolicy.DENIED;
  readonly forbiddenRoots: readonly string[];
  readonly isolationProfileId: string;
  readonly isolationProfileDigest: Sha256Digest;
  readonly issuedAt: IsoTimestamp;
  readonly lifecyclePolicy: typeof ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT;
  readonly retentionPolicy: typeof ProjectReadRetentionPolicy.RUNTIME_OWNED;
  readonly cleanupPolicy: typeof PROJECT_READ_CLEANUP_POLICY;
  readonly recordDigest: Sha256Digest;
}

export type ProjectSourceReadAuthorityRecord = ProjectSourceReadAuthorityRecordV1;

function field(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

function nonBlank(value: string, name: string, maximumBytes = 16_384): void {
  if (
    value.trim().length === 0 ||
    value.includes('\u0000') ||
    value !== value.normalize('NFC') ||
    Buffer.byteLength(value, 'utf8') > maximumBytes
  ) {
    throw new TypeError(`${name} must be a bounded normalized non-blank string`);
  }
}

function nonNegative(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${name} must be a non-negative safe integer`);
  }
}

function sortedUnique(values: readonly string[], name: string): void {
  let previous: string | undefined;
  for (const value of values) {
    nonBlank(value, name);
    if (previous !== undefined && value <= previous) {
      throw new TypeError(`${name} values must be uniquely string-sorted`);
    }
    previous = value;
  }
}

const portablePathComponentPattern = /^(?![. ]+$)(?!.*[. ]$)[^<>:"\\|?*]+$/u;
const windowsReservedNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) < 32) {
      return true;
    }
  }
  return false;
}

function portableRepositoryRelativePath(value: string, name: string): void {
  nonBlank(value, name, PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumPathBytes);
  if (isAbsolute(value) || value.includes('\\')) {
    throw new TypeError(`${name} must be a portable repository-relative path`);
  }
  for (const component of value.split('/')) {
    if (
      component.length === 0 ||
      component === '.' ||
      component === '..' ||
      containsControlCharacter(component) ||
      !portablePathComponentPattern.test(component) ||
      windowsReservedNamePattern.test(component) ||
      component.toLocaleLowerCase('en-US') === '.git' ||
      component.toLocaleLowerCase('en-US') === '.codeclosure'
    ) {
      throw new TypeError(`${name} contains a reserved or non-portable component`);
    }
  }
}

function portableRepositoryPathSet(values: readonly string[], name: string): void {
  const aliases = new Map<string, string>();
  const filePaths = new Set(values);
  for (const value of values) {
    portableRepositoryRelativePath(value, name);
    const components = value.split('/');
    for (let length = 1; length <= components.length; length += 1) {
      const prefix = components.slice(0, length).join('/');
      if (length < components.length && filePaths.has(prefix)) {
        throw new TypeError(`${name} values cannot contain a file as another file's ancestor`);
      }
      const alias = prefix.normalize('NFC').toLocaleLowerCase('en-US');
      const previous = aliases.get(alias);
      if (previous !== undefined && previous !== prefix) {
        throw new TypeError(`${name} values contain a case or Unicode alias collision`);
      }
      aliases.set(alias, prefix);
    }
  }
}

function exactAbsolutePath(value: string, name: string): void {
  nonBlank(value, name);
  if (!isAbsolute(value) || resolve(value) !== value) {
    throw new TypeError(`${name} must be an exact normalized absolute path`);
  }
}

function isSameOrWithin(path: string, parent: string): boolean {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrWithin(left, right) || isSameOrWithin(right, left);
}

export function projectReadSourceTreeProjection(
  projection: Omit<ProjectReadSourceTreeProjection, 'projectionDigest'>,
): unknown {
  return {
    schemaVersion: projection.schemaVersion,
    profile: projection.profile,
    entries: projection.entries,
    fileCount: projection.fileCount,
    totalBytes: projection.totalBytes,
  };
}

export function projectReadSelectedPathSetProjection(paths: readonly string[]): unknown {
  return { paths };
}

export function projectReadGitStateProjection(
  projection: Omit<ProjectReadGitStateProjection, 'projectionDigest'>,
): unknown {
  return {
    schemaVersion: projection.schemaVersion,
    profile: projection.profile,
    sourceProjectRoot: projection.sourceProjectRoot,
    repositoryControlRootIdentity: projection.repositoryControlRootIdentity,
    headCommit: projection.headCommit,
    selectedPathSetDigest: projection.selectedPathSetDigest,
    stagedIndexManifestDigest: projection.stagedIndexManifestDigest,
    porcelainV2Digest: projection.porcelainV2Digest,
  };
}

export function projectSourceReadAuthorityProjection(
  record: Omit<ProjectSourceReadAuthorityRecordV1, 'recordDigest'>,
): unknown {
  return {
    schemaVersion: record.schemaVersion,
    id: record.id,
    goalId: record.goalId,
    goalRevision: record.goalRevision,
    workflowId: record.workflowId,
    workflowVersion: record.workflowVersion,
    phase: record.phase,
    attemptId: record.attemptId,
    normalizedProjectRoot: record.normalizedProjectRoot,
    resolvedProjectRoot: record.resolvedProjectRoot,
    repositoryControlRootIdentity: record.repositoryControlRootIdentity,
    sourceTree: record.sourceTree,
    gitState: record.gitState,
    workspaceRootIdentity: record.workspaceRootIdentity,
    snapshotId: record.snapshotId,
    snapshotLeafRealpath: record.snapshotLeafRealpath,
    snapshotTreeDigest: record.snapshotTreeDigest,
    ownershipMarkerProfile: record.ownershipMarkerProfile,
    ownershipMarkerDigest: record.ownershipMarkerDigest,
    policyBundleId: record.policyBundleId,
    policyBundleVersion: record.policyBundleVersion,
    policyBundleDigest: record.policyBundleDigest,
    executionProfileId: record.executionProfileId,
    executionProfileVersion: record.executionProfileVersion,
    executionProfileDigest: record.executionProfileDigest,
    phaseDispatchEntryDigest: record.phaseDispatchEntryDigest,
    capabilityGrantDigest: record.capabilityGrantDigest,
    responseContractDigest: record.responseContractDigest,
    accessMode: record.accessMode,
    sourceCheckoutAccess: record.sourceCheckoutAccess,
    modelUsableNetworkPolicy: record.modelUsableNetworkPolicy,
    forbiddenRoots: record.forbiddenRoots,
    isolationProfileId: record.isolationProfileId,
    isolationProfileDigest: record.isolationProfileDigest,
    issuedAt: record.issuedAt,
    lifecyclePolicy: record.lifecyclePolicy,
    retentionPolicy: record.retentionPolicy,
    cleanupPolicy: record.cleanupPolicy,
  };
}

export function assertProjectReadSourceTreeInvariant(
  projection: ProjectReadSourceTreeProjection,
): void {
  if (
    field(projection, 'schemaVersion') !== 1 ||
    field(projection, 'profile') !== PROJECT_READ_SOURCE_TREE_PROFILE
  ) {
    throw new TypeError('Project-read source-tree projection identity is unsupported');
  }
  if (
    projection.entries.length > PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumFileCount ||
    projection.entries.length !== projection.fileCount
  ) {
    throw new TypeError('Project-read source-tree file count is invalid');
  }
  if (projection.totalBytes > PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumTotalBytes) {
    throw new TypeError('Project-read source-tree total bytes exceed the profile bound');
  }
  let totalBytes = 0;
  let previousPath: string | undefined;
  for (const entry of projection.entries) {
    if (
      field(entry, 'schemaVersion') !== 1 ||
      (field(entry, 'mode') !== ProjectReadFileMode.EXECUTABLE &&
        field(entry, 'mode') !== ProjectReadFileMode.REGULAR)
    ) {
      throw new TypeError('Project-read source-tree entry identity is invalid');
    }
    if (previousPath !== undefined && entry.path <= previousPath) {
      throw new TypeError('Project-read source-tree entries must be uniquely string-sorted');
    }
    previousPath = entry.path;
    nonNegative(entry.size, 'Project-read source-tree entry size');
    if (entry.size > PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumFileBytes) {
      throw new TypeError('Project-read source-tree entry exceeds the per-file byte bound');
    }
    totalBytes += entry.size;
    if (!Number.isSafeInteger(totalBytes)) {
      throw new TypeError('Project-read source-tree total bytes exceed the safe integer range');
    }
    sha256Digest(entry.contentDigest);
  }
  portableRepositoryPathSet(
    projection.entries.map((entry) => entry.path),
    'Project-read source-tree path',
  );
  nonNegative(projection.fileCount, 'Project-read source-tree file count');
  nonNegative(projection.totalBytes, 'Project-read source-tree total bytes');
  if (projection.totalBytes !== totalBytes) {
    throw new TypeError('Project-read source-tree total bytes do not match its entries');
  }
  sha256Digest(projection.projectionDigest);
}

export function assertProjectReadGitStateInvariant(
  projection: ProjectReadGitStateProjection,
): void {
  if (
    field(projection, 'schemaVersion') !== 1 ||
    field(projection, 'profile') !== PROJECT_READ_GIT_STATE_PROFILE
  ) {
    throw new TypeError('Project-read Git-state projection identity is unsupported');
  }
  exactAbsolutePath(projection.sourceProjectRoot, 'Project-read Git source root');
  exactAbsolutePath(
    projection.repositoryControlRootIdentity,
    'Project-read Git repository control-root identity',
  );
  if (!isSameOrWithin(projection.repositoryControlRootIdentity, projection.sourceProjectRoot)) {
    throw new TypeError('Project-read Git control root must remain within the source root');
  }
  if (!/^[0-9a-f]{40,64}$/u.test(projection.headCommit)) {
    throw new TypeError('Project-read Git HEAD identity is invalid');
  }
  sha256Digest(projection.selectedPathSetDigest);
  sha256Digest(projection.stagedIndexManifestDigest);
  sha256Digest(projection.porcelainV2Digest);
  sha256Digest(projection.projectionDigest);
}

export function assertProjectSourceReadAuthorityInvariant(
  record: ProjectSourceReadAuthorityRecord,
): void {
  if (field(record, 'schemaVersion') !== 1) {
    throw new TypeError('Project-source read authority schema is unsupported');
  }
  projectSourceReadAuthorityId(record.id);
  goalId(record.goalId);
  goalRevision(record.goalRevision);
  workflowId(record.workflowId);
  workflowVersion(record.workflowVersion);
  attemptId(record.attemptId);
  if (
    field(record, 'phase') !== WorkflowPhase.DISCOVERY &&
    field(record, 'phase') !== WorkflowPhase.PLAN
  ) {
    throw new TypeError('Project-source read authority is limited to candidate-free phases');
  }
  exactAbsolutePath(record.normalizedProjectRoot, 'Normalized project root');
  exactAbsolutePath(record.resolvedProjectRoot, 'Resolved project root');
  exactAbsolutePath(record.repositoryControlRootIdentity, 'Repository control-root identity');
  assertProjectReadSourceTreeInvariant(record.sourceTree);
  assertProjectReadGitStateInvariant(record.gitState);
  if (
    record.gitState.sourceProjectRoot !== record.resolvedProjectRoot ||
    record.gitState.repositoryControlRootIdentity !== record.repositoryControlRootIdentity
  ) {
    throw new TypeError('Project-source read projections do not bind the exact selected roots');
  }
  exactAbsolutePath(record.workspaceRootIdentity, 'Project-read workspace-root identity');
  projectReadSnapshotId(record.snapshotId);
  exactAbsolutePath(record.snapshotLeafRealpath, 'Project-read snapshot leaf realpath');
  if (
    record.snapshotLeafRealpath === record.workspaceRootIdentity ||
    !isSameOrWithin(record.snapshotLeafRealpath, record.workspaceRootIdentity)
  ) {
    throw new TypeError('Project-read snapshot leaf must be an exact workspace-root child');
  }
  sha256Digest(record.snapshotTreeDigest);
  if (record.snapshotTreeDigest !== record.sourceTree.projectionDigest) {
    throw new TypeError('Project-read snapshot tree does not match the admitted source tree');
  }
  if (field(record, 'ownershipMarkerProfile') !== PROJECT_READ_OWNERSHIP_MARKER_PROFILE) {
    throw new TypeError('Project-read ownership-marker profile is unsupported');
  }
  sha256Digest(record.ownershipMarkerDigest);
  policyBundleId(record.policyBundleId);
  nonBlank(record.policyBundleVersion, 'Project-read Policy version');
  sha256Digest(record.policyBundleDigest);
  executionProfileId(record.executionProfileId);
  nonBlank(record.executionProfileVersion, 'Project-read Execution Profile version');
  sha256Digest(record.executionProfileDigest);
  sha256Digest(record.phaseDispatchEntryDigest);
  sha256Digest(record.capabilityGrantDigest);
  sha256Digest(record.responseContractDigest);
  if (
    field(record, 'accessMode') !== ProjectReadSnapshotAccessMode.READ_ONLY ||
    field(record, 'sourceCheckoutAccess') !== ProjectReadSourceCheckoutAccess.NONE ||
    field(record, 'modelUsableNetworkPolicy') !== ProjectReadModelUsableNetworkPolicy.DENIED
  ) {
    throw new TypeError('Project-source read authority widened its effect boundary');
  }
  sortedUnique(record.forbiddenRoots, 'Project-read forbidden root');
  if (record.forbiddenRoots.length === 0) {
    throw new TypeError('Project-read forbidden roots cannot be empty');
  }
  for (const forbiddenRoot of record.forbiddenRoots) {
    exactAbsolutePath(forbiddenRoot, 'Project-read forbidden root');
    if (
      pathsOverlap(record.snapshotLeafRealpath, forbiddenRoot) ||
      pathsOverlap(record.workspaceRootIdentity, forbiddenRoot)
    ) {
      throw new TypeError('Project-read workspace containment overlaps a forbidden root');
    }
  }
  if (
    !record.forbiddenRoots.includes(record.normalizedProjectRoot) ||
    !record.forbiddenRoots.includes(record.resolvedProjectRoot)
  ) {
    throw new TypeError(
      'Project-read forbidden roots must contain normalized and resolved source identities',
    );
  }
  nonBlank(record.isolationProfileId, 'Project-read isolation Profile ID');
  sha256Digest(record.isolationProfileDigest);
  isoTimestamp(record.issuedAt);
  if (
    field(record, 'lifecyclePolicy') !== ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT ||
    field(record, 'retentionPolicy') !== ProjectReadRetentionPolicy.RUNTIME_OWNED ||
    field(record, 'cleanupPolicy') !== PROJECT_READ_CLEANUP_POLICY
  ) {
    throw new TypeError('Project-source read authority lifecycle is unsupported');
  }
  sha256Digest(record.recordDigest);
}
