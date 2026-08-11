import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
  ProjectReadSnapshotCleanupCoordinationDisposition,
  ProjectReadSnapshotCleanupTargetAliasDisposition,
  ProjectReadSnapshotCleanupTargetClassification,
  ProjectReadSnapshotCleanupTargetEntryKind,
  ProjectReadSnapshotCleanupTargetManifestDisposition,
  ProjectReadSnapshotCleanupTargetMarkerDisposition,
  ProjectReadSnapshotCleanupTargetState,
  ProjectReadWorkspaceClassification,
  ProjectReadWorkspaceRetention,
  ProjectReadSnapshotCurrencyState,
  createProjectReadOwnershipMarkerForRecord,
  createProjectReadSnapshotCurrencyObservation,
  createProjectReadSourceObservation,
  createProjectReadSnapshotCleanupTargetObservation,
  createProjectReadSnapshotMaterializationReceipt,
  decodeProjectReadSnapshotCleanupObservation,
  decodeProjectReadSnapshotCleanupRequest,
  decodeProjectReadSnapshotMaterializationRequest,
  decodeProjectReadSourceObservationRequest,
  decodeProjectReadWorkspaceAuthoritySnapshot,
  decodeProjectReadWorkspaceObservation,
  digestProjectReadSnapshotCleanupValue,
  digestProjectReadWorkspaceValue,
  type ProjectReadOwnershipMarker,
  type ProjectReadSnapshotCleanupObservation,
  type ProjectReadSnapshotCleanupRequest,
  type ProjectReadSnapshotCleanupTargetObservation,
  type ProjectReadSnapshotCurrencyObservation,
  type ProjectReadSnapshotMaterializationReceipt,
  type ProjectReadSnapshotMaterializationRequest,
  type ProjectReadSourceObservation,
  type ProjectReadSourceObservationRequest,
  type ProjectReadWorkspaceAuthoritySnapshot,
  type ProjectReadWorkspaceObservation,
} from '@codeclosure/runtime';

import {
  DEFAULT_CANDIDATE_WORKSPACE_BOUNDS,
  LocalCandidateWorkspaceError,
  LocalCandidateWorkspaceFailureCode,
  LocalProjectReadWorkspaceError,
  LocalProjectReadWorkspaceFailureCode,
  type CandidateWorkspaceBounds,
  type LocalProjectReadWorkspace,
  type LocalProjectReadWorkspaceOptions,
} from './contracts.js';
import {
  assertProjectReadSourceSnapshotMatchesRequest,
  captureProjectReadSourceSnapshot,
  captureProjectReadSourceSnapshotFromRoot,
} from './git-source.js';
import {
  assertRealDirectory,
  isSameOrWithin,
  pathsOverlap,
  readManifestEntryBytes,
  scanProjectReadTree,
} from './manifests.js';
import {
  createLocalProjectReadCleanupOperationRecord,
  createLocalProjectReadRootRecord,
  readLocalProjectReadCleanupOperationRecord,
  readLocalProjectReadOwnershipMarker,
  readLocalProjectReadRootRecord,
  writeLocalProjectReadCleanupOperationRecord,
  writeLocalProjectReadOwnershipMarker,
  writeLocalProjectReadRootRecord,
  type LocalProjectReadCleanupOperationRecordV1,
} from './project-read-records.js';
import { fsyncDirectory } from './records.js';

export interface ProjectReadWorkspaceFaultHooks {
  readonly beforeSourceRecheck?: (input: { readonly sourceRoot: string }) => void;
  readonly beforeCleanupTargetEffect?: (input: {
    readonly grantId: string;
    readonly snapshotLeafRealpath: string;
  }) => void;
  readonly afterCleanupOperationStaged?: (input: {
    readonly grantId: string;
    readonly stagingOperationRoot: string;
  }) => void;
  readonly afterCleanupTargetRename?: (input: {
    readonly grantId: string;
    readonly tombstonePath: string;
  }) => void;
  readonly afterCleanupTombstoneRemoved?: (input: {
    readonly grantId: string;
    readonly tombstonePath: string;
  }) => void;
  readonly now?: () => string;
}

const snapshotDirectoryName = 'snapshots';
const metadataDirectoryName = '.codeclosure-project-read';
const markerDirectoryName = 'markers';
const stagingDirectoryName = 'staging';
const cleanupDirectoryName = 'cleanup';
const rootRecordName = 'owner.json';
const cleanupRecordName = 'operation.json';
const cleanupTombstonePrefix = '.cleanup-';

function fail(code: LocalProjectReadWorkspaceFailureCode, message: string): never {
  throw new LocalProjectReadWorkspaceError(code, message);
}

function mapCandidateFailure(error: unknown): never {
  if (!(error instanceof LocalCandidateWorkspaceError)) {
    throw error;
  }
  const code = (() => {
    switch (error.code) {
      case LocalCandidateWorkspaceFailureCode.BOUNDS_EXCEEDED:
        return LocalProjectReadWorkspaceFailureCode.BOUNDS_EXCEEDED;
      case LocalCandidateWorkspaceFailureCode.GIT_INVOCATION_FAILED:
        return LocalProjectReadWorkspaceFailureCode.GIT_INVOCATION_FAILED;
      case LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION:
      case LocalCandidateWorkspaceFailureCode.PATH_POLICY_VIOLATION:
        return LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION;
      case LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT:
      case LocalCandidateWorkspaceFailureCode.CANDIDATE_DRIFT:
        return LocalProjectReadWorkspaceFailureCode.SOURCE_DRIFT;
      case LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED:
        return LocalProjectReadWorkspaceFailureCode.SOURCE_UNSUPPORTED;
      default:
        return LocalProjectReadWorkspaceFailureCode.FILESYSTEM_FAILURE;
    }
  })();
  fail(code, error.message);
}

function withMappedCandidateFailures<T>(operation: () => T): T {
  try {
    return operation();
  } catch (error) {
    mapCandidateFailure(error);
  }
}

function nonBlank(value: string, field: string): string {
  if (
    value.trim().length === 0 ||
    value.includes('\u0000') ||
    value !== value.normalize('NFC') ||
    Buffer.byteLength(value, 'utf8') > 4_096
  ) {
    fail(LocalProjectReadWorkspaceFailureCode.INVALID_CONFIGURATION, `${field} is invalid`);
  }
  return value;
}

function validateBounds(bounds: CandidateWorkspaceBounds): CandidateWorkspaceBounds {
  for (const [field, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      fail(
        LocalProjectReadWorkspaceFailureCode.INVALID_CONFIGURATION,
        `${field} must be a positive safe integer`,
      );
    }
  }
  if (bounds.maximumFileBytes > bounds.maximumTotalBytes) {
    fail(
      LocalProjectReadWorkspaceFailureCode.INVALID_CONFIGURATION,
      'The per-file bound cannot exceed the total-byte bound',
    );
  }
  return Object.freeze({ ...bounds });
}

function pathEntryExists(path: string): boolean {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

function absoluteConfiguredPath(path: string, field: string): string {
  if (!isAbsolute(path) || path !== path.normalize('NFC') || resolve(path) !== path) {
    fail(
      LocalProjectReadWorkspaceFailureCode.INVALID_CONFIGURATION,
      `${field} must be an exact normalized absolute path`,
    );
  }
  return path;
}

function exactRealDirectory(path: string, field: string): string {
  const real = withMappedCandidateFailures(() => assertRealDirectory(path, field));
  if (real !== path) {
    fail(
      LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION,
      `${field} must not be an alias`,
    );
  }
  return real;
}

function assertFutureRealPathIdentity(path: string, field: string): string {
  let ancestor = path;
  while (!pathEntryExists(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      fail(
        LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        `${field} has no existing real ancestor`,
      );
    }
    ancestor = parent;
  }
  const realAncestor = exactRealDirectory(ancestor, `${field} ancestor`);
  if (resolve(realAncestor, relative(ancestor, path)) !== path) {
    fail(
      LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION,
      `${field} must not traverse an aliased ancestor`,
    );
  }
  return path;
}

function ensurePrivateDirectory(path: string): string {
  if (!pathEntryExists(path)) {
    mkdirSync(path, { mode: 0o700 });
  }
  chmodSync(path, 0o700);
  return exactRealDirectory(path, 'Project-read owned directory');
}

function hash(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function errorCode(error: unknown): string | undefined {
  return error instanceof Error && 'code' in error && typeof error.code === 'string'
    ? error.code
    : undefined;
}

function nowAtOrAfter(hooks: ProjectReadWorkspaceFaultHooks, floor?: string): string {
  const current = hooks.now?.() ?? new Date().toISOString();
  if (floor === undefined || current >= floor) {
    return current;
  }
  return floor;
}

function statsIdentity(stat: Stats): { readonly deviceId: string; readonly fileId: string } {
  return Object.freeze({ deviceId: String(stat.dev), fileId: String(stat.ino) });
}

function makeTreeReadOnly(
  root: string,
  sourceTree: ProjectReadSnapshotMaterializationRequest['sourceTree'],
): void {
  const modes = new Map(sourceTree.entries.map((entry) => [entry.path, entry.mode]));
  const directories: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    directories.push(current);
    for (const name of readdirSync(current)) {
      const path = resolve(current, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        fail(
          LocalProjectReadWorkspaceFailureCode.SOURCE_UNSUPPORTED,
          'Project-read snapshot contains a symbolic link',
        );
      }
      if (stat.isDirectory()) {
        pending.push(path);
      } else if (stat.isFile()) {
        const relativePath = relative(root, path).split(sep).join('/');
        const mode = modes.get(relativePath);
        if (mode === undefined) {
          fail(
            LocalProjectReadWorkspaceFailureCode.SOURCE_DRIFT,
            'Project-read snapshot contains an unrecorded file',
          );
        }
        chmodSync(path, mode === 'EXECUTABLE' ? 0o555 : 0o444);
      } else {
        fail(
          LocalProjectReadWorkspaceFailureCode.SOURCE_UNSUPPORTED,
          'Project-read snapshot contains a special filesystem entry',
        );
      }
    }
  }
  for (const directory of directories.sort((left, right) => right.length - left.length)) {
    chmodSync(directory, 0o555);
  }
}

function assertTreeReadOnly(root: string): void {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
      fail(
        LocalProjectReadWorkspaceFailureCode.SOURCE_DRIFT,
        'Project-read snapshot contains an aliased or special entry',
      );
    }
    if ((stat.mode & 0o222) !== 0) {
      fail(
        LocalProjectReadWorkspaceFailureCode.SOURCE_DRIFT,
        'Project-read snapshot is not read-only',
      );
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(current)) {
        pending.push(resolve(current, name));
      }
    }
  }
}

function observeSnapshotTreePreflight(root: string): ProjectReadSnapshotCurrencyState | undefined {
  const pending = [root];
  try {
    while (pending.length > 0) {
      const current = pending.pop();
      if (current === undefined) {
        break;
      }
      const stat = lstatSync(current);
      if (stat.isSymbolicLink()) {
        return ProjectReadSnapshotCurrencyState.AUTHORITY_ALIASED;
      }
      if (!stat.isDirectory() && !stat.isFile()) {
        return ProjectReadSnapshotCurrencyState.SNAPSHOT_IDENTITY_MISMATCH;
      }
      if ((stat.mode & 0o222) !== 0) {
        return ProjectReadSnapshotCurrencyState.SNAPSHOT_CONTENT_MISMATCH;
      }
      if (stat.isDirectory()) {
        for (const name of readdirSync(current)) {
          pending.push(resolve(current, name));
        }
      }
    }
  } catch {
    return ProjectReadSnapshotCurrencyState.AUTHORITY_UNVERIFIABLE;
  }
  return undefined;
}

function snapshotScanFailureState(error: unknown): ProjectReadSnapshotCurrencyState {
  if (error instanceof LocalProjectReadWorkspaceError) {
    switch (error.code) {
      case LocalProjectReadWorkspaceFailureCode.BOUNDS_EXCEEDED:
      case LocalProjectReadWorkspaceFailureCode.SOURCE_UNSUPPORTED:
        return ProjectReadSnapshotCurrencyState.SNAPSHOT_CONTENT_MISMATCH;
      case LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION:
        return ProjectReadSnapshotCurrencyState.AUTHORITY_ALIASED;
      default:
        return ProjectReadSnapshotCurrencyState.AUTHORITY_UNVERIFIABLE;
    }
  }
  return ProjectReadSnapshotCurrencyState.AUTHORITY_UNVERIFIABLE;
}

function makeTreeRemovable(root: string): void {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || !pathEntryExists(current)) {
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      continue;
    }
    if (stat.isDirectory()) {
      chmodSync(current, 0o700);
      for (const name of readdirSync(current)) {
        pending.push(resolve(current, name));
      }
    } else if (stat.isFile()) {
      chmodSync(current, 0o600);
    }
  }
}

function fsyncTreeDirectories(root: string): void {
  const directories = [root];
  for (const directory of directories) {
    for (const name of readdirSync(directory)) {
      const path = resolve(directory, name);
      const stat = lstatSync(path);
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        directories.push(path);
      }
    }
  }
  for (const directory of directories.sort((left, right) => right.length - left.length)) {
    fsyncDirectory(directory);
  }
}

function copyProjectReadTree(
  sourceRoot: string,
  targetRoot: string,
  request: ProjectReadSnapshotMaterializationRequest,
  bounds: CandidateWorkspaceBounds,
): void {
  for (const entry of request.sourceTree.entries) {
    const target = resolve(targetRoot, entry.path);
    if (!isSameOrWithin(target, targetRoot)) {
      fail(
        LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Project-read manifest escaped its exact staging root',
      );
    }
    mkdirSync(dirname(target), { mode: 0o755, recursive: true });
    const bytes = withMappedCandidateFailures(() =>
      readManifestEntryBytes(
        sourceRoot,
        {
          contentDigest: entry.contentDigest,
          mode: entry.mode,
          path: entry.path,
          size: entry.size,
        },
        bounds,
      ),
    );
    let descriptor: number | undefined;
    try {
      descriptor = openSync(
        target,
        constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
        entry.mode === 'EXECUTABLE' ? 0o755 : 0o644,
      );
      writeFileSync(descriptor, bytes);
      fsyncSync(descriptor);
      closeSync(descriptor);
      descriptor = undefined;
    } finally {
      if (descriptor !== undefined) {
        closeSync(descriptor);
      }
    }
  }
}

function sameProjectReadTree(
  left: ProjectReadSnapshotMaterializationRequest['sourceTree'],
  right: ProjectReadSnapshotMaterializationRequest['sourceTree'],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

class LocalProjectReadWorkspaceAdapter implements LocalProjectReadWorkspace {
  readonly #authorityRoots: readonly string[];
  readonly #bounds: CandidateWorkspaceBounds;
  readonly #cleanupRoot: string;
  readonly #hooks: ProjectReadWorkspaceFaultHooks;
  readonly #markerRoot: string;
  readonly #metadataRoot: string;
  readonly #ownerId: string;
  readonly #snapshotRoot: string;
  readonly #stagingRoot: string;
  #initialized = false;
  #reconciliationAuthority: ProjectReadWorkspaceAuthoritySnapshot | undefined;
  public readonly workspaceRootIdentity: string;

  public constructor(
    options: LocalProjectReadWorkspaceOptions,
    hooks: ProjectReadWorkspaceFaultHooks,
  ) {
    this.#ownerId = nonBlank(options.ownerId, 'Project-read workspace owner ID');
    this.#bounds = validateBounds(options.bounds ?? DEFAULT_CANDIDATE_WORKSPACE_BOUNDS);
    this.#hooks = hooks;
    const configuredRoot = absoluteConfiguredPath(
      options.workspaceRoot,
      'Project-read workspace root',
    );
    this.workspaceRootIdentity = assertFutureRealPathIdentity(
      configuredRoot,
      'Project-read workspace root',
    );
    const rootExisted = pathEntryExists(configuredRoot);
    if (rootExisted) {
      exactRealDirectory(configuredRoot, 'Project-read workspace root');
    }
    this.#authorityRoots = Object.freeze(
      [
        ...new Set(
          options.authorityRoots.map((root, index) =>
            exactRealDirectory(
              absoluteConfiguredPath(root, `Authority root ${String(index)}`),
              `Authority root ${String(index)}`,
            ),
          ),
        ),
      ].sort(),
    );
    if (this.#authorityRoots.some((root) => pathsOverlap(root, this.workspaceRootIdentity))) {
      fail(
        LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Project-read workspace root must not overlap an authority root',
      );
    }
    this.#snapshotRoot = resolve(this.workspaceRootIdentity, snapshotDirectoryName);
    this.#metadataRoot = resolve(this.workspaceRootIdentity, metadataDirectoryName);
    this.#markerRoot = resolve(this.#metadataRoot, markerDirectoryName);
    this.#stagingRoot = resolve(this.#metadataRoot, stagingDirectoryName);
    this.#cleanupRoot = resolve(this.#metadataRoot, cleanupDirectoryName);
    if (rootExisted && readdirSync(this.workspaceRootIdentity).length > 0) {
      if (!pathEntryExists(resolve(this.#metadataRoot, rootRecordName))) {
        fail(
          LocalProjectReadWorkspaceFailureCode.WORKSPACE_CONFLICT,
          'A non-empty unowned project-read workspace cannot be claimed',
        );
      }
      this.#openOwnedRoot();
    }
  }

  public snapshotLeafFor(snapshotId: string): string {
    if (!/^project-read-snapshot_[a-z0-9](?:[a-z0-9-]{0,126}[a-z0-9])?$/u.test(snapshotId)) {
      fail(
        LocalProjectReadWorkspaceFailureCode.INVALID_CONFIGURATION,
        'Project-read snapshot ID is invalid',
      );
    }
    return resolve(this.#snapshotRoot, snapshotId);
  }

  public observeSource(
    rawRequest: ProjectReadSourceObservationRequest,
  ): ProjectReadSourceObservation {
    const request = decodeProjectReadSourceObservationRequest(rawRequest);
    const snapshot = withMappedCandidateFailures(() =>
      captureProjectReadSourceSnapshotFromRoot(request.normalizedProjectRoot, this.#bounds),
    );
    return createProjectReadSourceObservation({
      schemaVersion: 1,
      normalizedProjectRoot: request.normalizedProjectRoot,
      resolvedProjectRoot: snapshot.gitState.sourceProjectRoot,
      repositoryControlRootIdentity: snapshot.gitState.repositoryControlRootIdentity,
      sourceTree: snapshot.sourceTree,
      gitState: snapshot.gitState,
      observedAt: nowAtOrAfter(this.#hooks),
    });
  }

  public observeSnapshot(
    rawRecord: ProjectReadSnapshotMaterializationRequest,
  ): ProjectReadSnapshotCurrencyObservation {
    const record = decodeProjectReadSnapshotMaterializationRequest(rawRecord);
    if (
      record.workspaceRootIdentity !== this.workspaceRootIdentity ||
      record.snapshotLeafRealpath !== this.snapshotLeafFor(record.snapshotId)
    ) {
      fail(
        LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Project-read snapshot observation is outside the configured workspace',
      );
    }
    const observedAt = (): string => nowAtOrAfter(this.#hooks, record.issuedAt);
    const observation = (
      state: ProjectReadSnapshotCurrencyState,
    ): ProjectReadSnapshotCurrencyObservation =>
      createProjectReadSnapshotCurrencyObservation(record, state, observedAt());

    if (!pathEntryExists(this.workspaceRootIdentity)) {
      return observation(ProjectReadSnapshotCurrencyState.AUTHORITY_MISSING);
    }
    try {
      const root = lstatSync(this.workspaceRootIdentity);
      if (
        root.isSymbolicLink() ||
        realpathSync(this.workspaceRootIdentity) !== this.workspaceRootIdentity
      ) {
        return observation(ProjectReadSnapshotCurrencyState.AUTHORITY_ALIASED);
      }
      if (!root.isDirectory()) {
        return observation(ProjectReadSnapshotCurrencyState.AUTHORITY_UNVERIFIABLE);
      }
      this.#openOwnedRoot();
    } catch {
      return observation(ProjectReadSnapshotCurrencyState.AUTHORITY_UNVERIFIABLE);
    }

    const markerPath = this.#markerPath(record.snapshotId);
    if (!pathEntryExists(markerPath) || !pathEntryExists(record.snapshotLeafRealpath)) {
      return observation(ProjectReadSnapshotCurrencyState.AUTHORITY_MISSING);
    }
    let marker: ProjectReadOwnershipMarker;
    try {
      const markerStat = lstatSync(markerPath);
      if (markerStat.isSymbolicLink() || !markerStat.isFile()) {
        return observation(ProjectReadSnapshotCurrencyState.AUTHORITY_ALIASED);
      }
      marker = readLocalProjectReadOwnershipMarker(markerPath);
    } catch {
      return observation(ProjectReadSnapshotCurrencyState.AUTHORITY_UNVERIFIABLE);
    }
    if (
      marker.projectReadAuthorityId !== record.id ||
      marker.snapshotId !== record.snapshotId ||
      marker.workspaceRootIdentity !== record.workspaceRootIdentity ||
      marker.snapshotLeafRealpath !== record.snapshotLeafRealpath ||
      marker.snapshotTreeDigest !== record.snapshotTreeDigest ||
      marker.markerDigest !== record.ownershipMarkerDigest
    ) {
      return observation(ProjectReadSnapshotCurrencyState.SNAPSHOT_IDENTITY_MISMATCH);
    }

    try {
      const leaf = lstatSync(record.snapshotLeafRealpath);
      if (leaf.isSymbolicLink()) {
        return observation(ProjectReadSnapshotCurrencyState.AUTHORITY_ALIASED);
      }
      if (
        !leaf.isDirectory() ||
        realpathSync(record.snapshotLeafRealpath) !== record.snapshotLeafRealpath
      ) {
        return observation(ProjectReadSnapshotCurrencyState.SNAPSHOT_IDENTITY_MISMATCH);
      }
    } catch {
      return observation(ProjectReadSnapshotCurrencyState.AUTHORITY_UNVERIFIABLE);
    }
    const preflightState = observeSnapshotTreePreflight(record.snapshotLeafRealpath);
    if (preflightState !== undefined) {
      return observation(preflightState);
    }
    try {
      const tree = withMappedCandidateFailures(() =>
        scanProjectReadTree(record.snapshotLeafRealpath, this.#bounds),
      );
      if (tree.projectionDigest !== record.snapshotTreeDigest) {
        return observation(ProjectReadSnapshotCurrencyState.SNAPSHOT_CONTENT_MISMATCH);
      }
    } catch (error) {
      return observation(snapshotScanFailureState(error));
    }
    return observation(ProjectReadSnapshotCurrencyState.CURRENT);
  }

  #markerPath(snapshotId: string): string {
    return resolve(this.#markerRoot, `${snapshotId}.json`);
  }

  #cleanupOperationRoot(grant: ProjectReadSnapshotCleanupRequest): string {
    return resolve(this.#cleanupRoot, `grant-${hash(grant.grantDigest)}`);
  }

  #cleanupStagingOperationRoot(grant: ProjectReadSnapshotCleanupRequest): string {
    return resolve(this.#cleanupRoot, `.grant-${hash(grant.grantDigest)}.staging`);
  }

  #cleanupTombstonePath(grant: ProjectReadSnapshotCleanupRequest): string {
    return resolve(this.#snapshotRoot, `${cleanupTombstonePrefix}${hash(grant.grantDigest)}`);
  }

  #openOwnedRoot(): void {
    exactRealDirectory(this.workspaceRootIdentity, 'Project-read workspace root');
    exactRealDirectory(this.#metadataRoot, 'Project-read metadata root');
    const rootRecord = readLocalProjectReadRootRecord(resolve(this.#metadataRoot, rootRecordName));
    if (
      rootRecord.ownerId !== this.#ownerId ||
      rootRecord.workspaceRootIdentity !== this.workspaceRootIdentity
    ) {
      fail(
        LocalProjectReadWorkspaceFailureCode.WORKSPACE_CONFLICT,
        'Project-read workspace ownership does not match trusted configuration',
      );
    }
    for (const [path, field] of [
      [this.#snapshotRoot, 'Project-read snapshot root'],
      [this.#markerRoot, 'Project-read marker root'],
      [this.#stagingRoot, 'Project-read staging root'],
      [this.#cleanupRoot, 'Project-read cleanup root'],
    ] as const) {
      exactRealDirectory(path, field);
    }
    this.#initialized = true;
  }

  #initializeOwnedRoot(): void {
    if (this.#initialized) {
      return;
    }
    if (pathEntryExists(this.workspaceRootIdentity)) {
      const entries = readdirSync(this.workspaceRootIdentity);
      if (entries.length > 0) {
        this.#openOwnedRoot();
        return;
      }
    } else {
      mkdirSync(this.workspaceRootIdentity, { mode: 0o700, recursive: true });
    }
    exactRealDirectory(this.workspaceRootIdentity, 'Project-read workspace root');
    chmodSync(this.workspaceRootIdentity, 0o700);
    mkdirSync(this.#metadataRoot, { mode: 0o700 });
    ensurePrivateDirectory(this.#snapshotRoot);
    ensurePrivateDirectory(this.#markerRoot);
    ensurePrivateDirectory(this.#stagingRoot);
    ensurePrivateDirectory(this.#cleanupRoot);
    writeLocalProjectReadRootRecord(
      resolve(this.#metadataRoot, rootRecordName),
      createLocalProjectReadRootRecord(this.#ownerId, this.workspaceRootIdentity),
    );
    fsyncDirectory(this.#metadataRoot);
    this.#initialized = true;
  }

  #assertRequestContainment(request: ProjectReadSnapshotMaterializationRequest): void {
    const expectedLeaf = this.snapshotLeafFor(request.snapshotId);
    if (
      request.workspaceRootIdentity !== this.workspaceRootIdentity ||
      request.snapshotLeafRealpath !== expectedLeaf ||
      pathsOverlap(request.resolvedProjectRoot, this.workspaceRootIdentity) ||
      this.#authorityRoots.some((root) => pathsOverlap(root, request.resolvedProjectRoot)) ||
      !request.forbiddenRoots.includes(request.resolvedProjectRoot) ||
      this.#authorityRoots.some((root) => !request.forbiddenRoots.includes(root)) ||
      request.forbiddenRoots.some((root) => pathsOverlap(root, this.workspaceRootIdentity))
    ) {
      fail(
        LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Project-read authority does not retain exact source, workspace, and forbidden roots',
      );
    }
    exactRealDirectory(request.resolvedProjectRoot, 'Project-read source root');
    for (const [index, root] of request.forbiddenRoots.entries()) {
      exactRealDirectory(root, `Project-read forbidden root ${String(index)}`);
    }
  }

  #materializedTargetIsExact(marker: ProjectReadOwnershipMarker): boolean {
    const leaf = marker.snapshotLeafRealpath;
    try {
      if (
        leaf !== this.snapshotLeafFor(marker.snapshotId) ||
        exactRealDirectory(leaf, 'Project-read snapshot leaf') !== leaf
      ) {
        return false;
      }
      assertTreeReadOnly(leaf);
      const tree = withMappedCandidateFailures(() => scanProjectReadTree(leaf, this.#bounds));
      return tree.projectionDigest === marker.snapshotTreeDigest;
    } catch {
      return false;
    }
  }

  #materializedTargetHasExactBytes(marker: ProjectReadOwnershipMarker): boolean {
    const leaf = marker.snapshotLeafRealpath;
    try {
      if (
        leaf !== this.snapshotLeafFor(marker.snapshotId) ||
        exactRealDirectory(leaf, 'Project-read snapshot leaf') !== leaf
      ) {
        return false;
      }
      const tree = withMappedCandidateFailures(() => scanProjectReadTree(leaf, this.#bounds));
      return tree.projectionDigest === marker.snapshotTreeDigest;
    } catch {
      return false;
    }
  }

  #removeFailedMaterialization(
    marker: ProjectReadOwnershipMarker,
    stagingRoot: string,
    committedNodeIdentity: Readonly<{ readonly deviceId: string; readonly fileId: string }> | null,
  ): void {
    if (pathEntryExists(stagingRoot) && dirname(stagingRoot) === this.#stagingRoot) {
      makeTreeRemovable(stagingRoot);
      rmSync(stagingRoot, { recursive: true });
      fsyncDirectory(this.#stagingRoot);
    }
    const markerPath = this.#markerPath(marker.snapshotId);
    if (!pathEntryExists(markerPath)) {
      return;
    }
    let retained: ProjectReadOwnershipMarker;
    try {
      retained = readLocalProjectReadOwnershipMarker(markerPath);
    } catch {
      return;
    }
    if (retained.markerDigest !== marker.markerDigest) {
      return;
    }
    let sameCommittedNode = false;
    if (committedNodeIdentity !== null && pathEntryExists(marker.snapshotLeafRealpath)) {
      const observed = statsIdentity(lstatSync(marker.snapshotLeafRealpath));
      sameCommittedNode =
        observed.deviceId === committedNodeIdentity.deviceId &&
        observed.fileId === committedNodeIdentity.fileId;
    }
    if (sameCommittedNode && this.#materializedTargetHasExactBytes(marker)) {
      makeTreeRemovable(marker.snapshotLeafRealpath);
      rmSync(marker.snapshotLeafRealpath, { recursive: true });
      fsyncDirectory(this.#snapshotRoot);
    }
    if (!pathEntryExists(marker.snapshotLeafRealpath)) {
      unlinkSync(markerPath);
      fsyncDirectory(this.#markerRoot);
    }
  }

  public materializeSnapshot(
    rawRecord: ProjectReadSnapshotMaterializationRequest,
  ): ProjectReadSnapshotMaterializationReceipt {
    const request = decodeProjectReadSnapshotMaterializationRequest(rawRecord);
    const marker = createProjectReadOwnershipMarkerForRecord(request);
    this.#assertRequestContainment(request);
    this.#initializeOwnedRoot();
    const markerPath = this.#markerPath(request.snapshotId);
    const finalRoot = request.snapshotLeafRealpath;
    const stagingRoot = resolve(
      this.#stagingRoot,
      `${request.snapshotId}.${process.pid.toString(10)}.${hash(request.recordDigest).slice(0, 16)}`,
    );
    if (pathEntryExists(finalRoot) || pathEntryExists(markerPath) || pathEntryExists(stagingRoot)) {
      fail(
        LocalProjectReadWorkspaceFailureCode.WORKSPACE_CONFLICT,
        'Project-read snapshot identity is already allocated',
      );
    }
    const before = withMappedCandidateFailures(() =>
      captureProjectReadSourceSnapshot(request, this.#bounds),
    );
    withMappedCandidateFailures(() =>
      assertProjectReadSourceSnapshotMatchesRequest(before, request),
    );
    mkdirSync(stagingRoot, { mode: 0o700 });
    let committedNodeIdentity: Readonly<{
      readonly deviceId: string;
      readonly fileId: string;
    }> | null = null;
    try {
      copyProjectReadTree(request.resolvedProjectRoot, stagingRoot, request, this.#bounds);
      const stagedTree = withMappedCandidateFailures(() =>
        scanProjectReadTree(stagingRoot, this.#bounds),
      );
      if (!sameProjectReadTree(stagedTree, request.sourceTree)) {
        fail(
          LocalProjectReadWorkspaceFailureCode.SOURCE_DRIFT,
          'Materialized project-read snapshot differs from admitted source bytes',
        );
      }
      fsyncTreeDirectories(stagingRoot);
      writeLocalProjectReadOwnershipMarker(markerPath, marker);
      fsyncDirectory(this.#markerRoot);
      renameSync(stagingRoot, finalRoot);
      fsyncDirectory(this.#snapshotRoot);
      committedNodeIdentity = statsIdentity(lstatSync(finalRoot));
      if (realpathSync(finalRoot) !== finalRoot || dirname(finalRoot) !== this.#snapshotRoot) {
        fail(
          LocalProjectReadWorkspaceFailureCode.CONTAINMENT_VIOLATION,
          'Project-read snapshot was not committed to its exact owned leaf',
        );
      }
      makeTreeReadOnly(finalRoot, request.sourceTree);
      fsyncTreeDirectories(finalRoot);
      assertTreeReadOnly(finalRoot);
      const finalTree = withMappedCandidateFailures(() =>
        scanProjectReadTree(finalRoot, this.#bounds),
      );
      if (!sameProjectReadTree(finalTree, request.sourceTree)) {
        fail(
          LocalProjectReadWorkspaceFailureCode.SOURCE_DRIFT,
          'Committed project-read snapshot differs from admitted source bytes',
        );
      }
      this.#hooks.beforeSourceRecheck?.({ sourceRoot: request.resolvedProjectRoot });
      const after = withMappedCandidateFailures(() =>
        captureProjectReadSourceSnapshot(request, this.#bounds),
      );
      withMappedCandidateFailures(() =>
        assertProjectReadSourceSnapshotMatchesRequest(after, request),
      );
      return createProjectReadSnapshotMaterializationReceipt(
        request,
        nowAtOrAfter(this.#hooks, request.issuedAt),
      );
    } catch (error) {
      this.#removeFailedMaterialization(marker, stagingRoot, committedNodeIdentity);
      throw error;
    }
  }

  #readMarkerDisposition(
    markerPath: string,
    expectedDigest: string,
  ): Readonly<{
    disposition: (typeof ProjectReadSnapshotCleanupTargetMarkerDisposition)[keyof typeof ProjectReadSnapshotCleanupTargetMarkerDisposition];
    marker: ProjectReadOwnershipMarker | null;
  }> {
    if (!pathEntryExists(markerPath)) {
      return Object.freeze({
        disposition: ProjectReadSnapshotCleanupTargetMarkerDisposition.ABSENT,
        marker: null,
      });
    }
    try {
      const marker = readLocalProjectReadOwnershipMarker(markerPath);
      return Object.freeze({
        disposition:
          marker.markerDigest === expectedDigest
            ? ProjectReadSnapshotCleanupTargetMarkerDisposition.MATCHED
            : ProjectReadSnapshotCleanupTargetMarkerDisposition.MISMATCHED,
        marker,
      });
    } catch {
      return Object.freeze({
        disposition: ProjectReadSnapshotCleanupTargetMarkerDisposition.MALFORMED,
        marker: null,
      });
    }
  }

  #observeCleanupTarget(
    grant: ProjectReadSnapshotCleanupRequest,
  ): ProjectReadSnapshotCleanupTargetObservation | null {
    const rootStat = lstatSync(this.workspaceRootIdentity);
    if (
      rootStat.isSymbolicLink() ||
      !rootStat.isDirectory() ||
      realpathSync(this.workspaceRootIdentity) !== this.workspaceRootIdentity
    ) {
      return null;
    }
    const rootIdentity = statsIdentity(rootStat);
    const marker = this.#readMarkerDisposition(
      this.#markerPath(grant.snapshotId),
      grant.ownershipMarkerDigest,
    );
    let leafStat: Stats;
    try {
      leafStat = lstatSync(grant.snapshotLeafRealpath);
    } catch (error) {
      if (errorCode(error) !== 'ENOENT' || marker.disposition !== 'ABSENT') {
        return null;
      }
      return createProjectReadSnapshotCleanupTargetObservation(
        {
          schemaVersion: 1,
          profile: PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
          state: ProjectReadSnapshotCleanupTargetState.ABSENT,
          workspaceRootIdentity: this.workspaceRootIdentity,
          workspaceRootDeviceId: rootIdentity.deviceId,
          workspaceRootFileId: rootIdentity.fileId,
          snapshotLeafRealpath: grant.snapshotLeafRealpath,
          entryKind: ProjectReadSnapshotCleanupTargetEntryKind.ABSENT,
          aliasDisposition: ProjectReadSnapshotCleanupTargetAliasDisposition.NOT_APPLICABLE,
          resolvedLeafRealpath: null,
          nodeDeviceId: null,
          nodeFileId: null,
          expectedOwnershipMarkerProfile: grant.ownershipMarkerProfile,
          expectedOwnershipMarkerDigest: grant.ownershipMarkerDigest,
          markerDisposition: ProjectReadSnapshotCleanupTargetMarkerDisposition.ABSENT,
          observedOwnershipMarkerDigest: null,
          manifestDisposition: ProjectReadSnapshotCleanupTargetManifestDisposition.NOT_APPLICABLE,
          targetManifestProfile: null,
          targetManifestDigest: null,
        },
        nowAtOrAfter(this.#hooks, grant.issuedAt),
      );
    }

    const nodeIdentity = statsIdentity(leafStat);
    const entryKind = leafStat.isSymbolicLink()
      ? ProjectReadSnapshotCleanupTargetEntryKind.SYMBOLIC_LINK
      : leafStat.isDirectory()
        ? ProjectReadSnapshotCleanupTargetEntryKind.DIRECTORY
        : leafStat.isFile()
          ? ProjectReadSnapshotCleanupTargetEntryKind.REGULAR_FILE
          : ProjectReadSnapshotCleanupTargetEntryKind.OTHER;
    let resolvedLeafRealpath: string | null = null;
    let aliasDisposition: 'EXACT' | 'SYMBOLIC_LINK' | 'RESOLVED_DIFFERENT' | 'UNRESOLVED';
    if (leafStat.isSymbolicLink()) {
      aliasDisposition = ProjectReadSnapshotCleanupTargetAliasDisposition.SYMBOLIC_LINK;
      try {
        resolvedLeafRealpath = realpathSync(grant.snapshotLeafRealpath);
      } catch {
        resolvedLeafRealpath = null;
      }
    } else {
      try {
        resolvedLeafRealpath = realpathSync(grant.snapshotLeafRealpath);
        aliasDisposition =
          resolvedLeafRealpath === grant.snapshotLeafRealpath
            ? ProjectReadSnapshotCleanupTargetAliasDisposition.EXACT
            : ProjectReadSnapshotCleanupTargetAliasDisposition.RESOLVED_DIFFERENT;
      } catch {
        aliasDisposition = ProjectReadSnapshotCleanupTargetAliasDisposition.UNRESOLVED;
      }
    }

    let manifestDisposition: 'RECORDED' | 'NOT_APPLICABLE' | 'UNAVAILABLE' =
      ProjectReadSnapshotCleanupTargetManifestDisposition.NOT_APPLICABLE;
    let targetManifestProfile: 'codeclosure-project-read-source-tree-v1' | null = null;
    let targetManifestDigest: string | null = null;
    if (entryKind === ProjectReadSnapshotCleanupTargetEntryKind.DIRECTORY) {
      manifestDisposition = ProjectReadSnapshotCleanupTargetManifestDisposition.UNAVAILABLE;
      if (
        aliasDisposition === ProjectReadSnapshotCleanupTargetAliasDisposition.EXACT &&
        marker.marker !== null
      ) {
        try {
          assertTreeReadOnly(grant.snapshotLeafRealpath);
          const tree = withMappedCandidateFailures(() =>
            scanProjectReadTree(grant.snapshotLeafRealpath, this.#bounds),
          );
          if (tree.projectionDigest === marker.marker.snapshotTreeDigest) {
            manifestDisposition = ProjectReadSnapshotCleanupTargetManifestDisposition.RECORDED;
            targetManifestProfile = tree.profile;
            targetManifestDigest = tree.projectionDigest;
          }
        } catch {
          // A non-canonical tree is intentionally projected as unavailable and unsafe.
        }
      }
    }
    return createProjectReadSnapshotCleanupTargetObservation(
      {
        schemaVersion: 1,
        profile: PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE,
        state: ProjectReadSnapshotCleanupTargetState.PRESENT_RETAINED,
        workspaceRootIdentity: this.workspaceRootIdentity,
        workspaceRootDeviceId: rootIdentity.deviceId,
        workspaceRootFileId: rootIdentity.fileId,
        snapshotLeafRealpath: grant.snapshotLeafRealpath,
        entryKind,
        aliasDisposition,
        resolvedLeafRealpath,
        nodeDeviceId: nodeIdentity.deviceId,
        nodeFileId: nodeIdentity.fileId,
        expectedOwnershipMarkerProfile: grant.ownershipMarkerProfile,
        expectedOwnershipMarkerDigest: grant.ownershipMarkerDigest,
        markerDisposition: marker.disposition,
        observedOwnershipMarkerDigest: marker.marker?.markerDigest ?? null,
        manifestDisposition,
        targetManifestProfile,
        targetManifestDigest,
      },
      nowAtOrAfter(this.#hooks, grant.issuedAt),
    );
  }

  #createCleanupObservation(input: {
    readonly coordinationDisposition: 'CLEARED' | 'INERT_RETAINED';
    readonly disposition: 'DELETED' | 'ALREADY_ABSENT' | 'RETAINED_UNSAFE' | 'FAILED';
    readonly failurePreEffectTargetObservation: ProjectReadSnapshotCleanupTargetObservation | null;
    readonly grant: ProjectReadSnapshotCleanupRequest;
    readonly terminalTargetObservation: ProjectReadSnapshotCleanupTargetObservation;
  }): ProjectReadSnapshotCleanupObservation {
    const observedAt = nowAtOrAfter(this.#hooks, input.terminalTargetObservation.observedAt);
    const idSuffix = hash(
      JSON.stringify({
        grantDigest: input.grant.grantDigest,
        disposition: input.disposition,
        terminal: input.terminalTargetObservation.fingerprintDigest,
        observedAt,
      }),
    );
    const withoutDigest = Object.freeze({
      schemaVersion: 1 as const,
      id: `project-read-cleanup-observation_${idSuffix}`,
      grantId: input.grant.id,
      grantDigest: input.grant.grantDigest,
      disposition: input.disposition,
      workspaceRootIdentity: input.grant.workspaceRootIdentity,
      snapshotLeafRealpath: input.grant.snapshotLeafRealpath,
      expectedOwnershipMarkerProfile: input.grant.ownershipMarkerProfile,
      expectedOwnershipMarkerDigest: input.grant.ownershipMarkerDigest,
      terminalTargetObservation: input.terminalTargetObservation,
      failurePreEffectTargetObservation: input.failurePreEffectTargetObservation,
      coordinationDisposition: input.coordinationDisposition,
      observedAt,
    });
    return decodeProjectReadSnapshotCleanupObservation({
      ...withoutDigest,
      observationDigest: digestProjectReadSnapshotCleanupValue(withoutDigest),
    });
  }

  #removeExactMarker(grant: ProjectReadSnapshotCleanupRequest): boolean {
    const markerPath = this.#markerPath(grant.snapshotId);
    if (!pathEntryExists(markerPath)) {
      return true;
    }
    try {
      const marker = readLocalProjectReadOwnershipMarker(markerPath);
      if (
        marker.markerDigest !== grant.ownershipMarkerDigest ||
        marker.snapshotLeafRealpath !== grant.snapshotLeafRealpath ||
        marker.workspaceRootIdentity !== grant.workspaceRootIdentity
      ) {
        return false;
      }
      unlinkSync(markerPath);
      fsyncDirectory(this.#markerRoot);
      return true;
    } catch {
      return false;
    }
  }

  #readCleanupOperationAt(
    operationRoot: string,
    grant: ProjectReadSnapshotCleanupRequest,
  ): LocalProjectReadCleanupOperationRecordV1 | null {
    if (!pathEntryExists(operationRoot)) {
      return null;
    }
    try {
      const record = readLocalProjectReadCleanupOperationRecord(
        resolve(operationRoot, cleanupRecordName),
      );
      return record.grantId === grant.id &&
        record.grantDigest === grant.grantDigest &&
        record.ownershipMarkerDigest === grant.ownershipMarkerDigest &&
        record.workspaceRootIdentity === grant.workspaceRootIdentity &&
        record.snapshotLeafRealpath === grant.snapshotLeafRealpath
        ? record
        : null;
    } catch {
      return null;
    }
  }

  #readCleanupOperation(
    grant: ProjectReadSnapshotCleanupRequest,
  ): LocalProjectReadCleanupOperationRecordV1 | null {
    return this.#readCleanupOperationAt(this.#cleanupOperationRoot(grant), grant);
  }

  #admitStagedCleanupOperation(
    grant: ProjectReadSnapshotCleanupRequest,
  ): LocalProjectReadCleanupOperationRecordV1 | null {
    const operationRoot = this.#cleanupOperationRoot(grant);
    const stagingOperationRoot = this.#cleanupStagingOperationRoot(grant);
    if (pathEntryExists(operationRoot)) {
      if (pathEntryExists(stagingOperationRoot)) {
        return null;
      }
      return this.#readCleanupOperationAt(operationRoot, grant);
    }
    if (!pathEntryExists(stagingOperationRoot)) {
      return null;
    }
    const staged = this.#readCleanupOperationAt(stagingOperationRoot, grant);
    if (staged === null) {
      return null;
    }
    try {
      renameSync(stagingOperationRoot, operationRoot);
      fsyncDirectory(this.#cleanupRoot);
      return staged;
    } catch {
      const retained = this.#readCleanupOperationAt(operationRoot, grant);
      if (retained?.operationDigest !== staged.operationDigest) {
        return null;
      }
      if (pathEntryExists(stagingOperationRoot)) {
        const duplicate = this.#readCleanupOperationAt(stagingOperationRoot, grant);
        if (duplicate?.operationDigest !== retained.operationDigest) {
          return null;
        }
        rmSync(stagingOperationRoot, { recursive: true });
        fsyncDirectory(this.#cleanupRoot);
      }
      return retained;
    }
  }

  #establishCleanupOperation(
    grant: ProjectReadSnapshotCleanupRequest,
    preEffect: ProjectReadSnapshotCleanupTargetObservation,
  ): LocalProjectReadCleanupOperationRecordV1 | null {
    const fingerprint = preEffect.fingerprint;
    if (
      preEffect.classification !== 'EXACT_OWNED' ||
      fingerprint.nodeDeviceId === null ||
      fingerprint.nodeFileId === null ||
      fingerprint.targetManifestDigest === null
    ) {
      return null;
    }
    const proposed = createLocalProjectReadCleanupOperationRecord(grant, {
      preEffectFingerprintDigest: preEffect.fingerprintDigest,
      targetNodeDeviceId: fingerprint.nodeDeviceId,
      targetNodeFileId: fingerprint.nodeFileId,
      targetManifestDigest: fingerprint.targetManifestDigest,
    });
    const operationRoot = this.#cleanupOperationRoot(grant);
    const stagingOperationRoot = this.#cleanupStagingOperationRoot(grant);
    if (pathEntryExists(operationRoot) || pathEntryExists(stagingOperationRoot)) {
      const retained = this.#admitStagedCleanupOperation(grant);
      return retained?.preEffectFingerprintDigest === preEffect.fingerprintDigest ? retained : null;
    }
    try {
      mkdirSync(stagingOperationRoot, { mode: 0o700 });
      writeLocalProjectReadCleanupOperationRecord(
        resolve(stagingOperationRoot, cleanupRecordName),
        proposed,
      );
      fsyncDirectory(stagingOperationRoot);
      try {
        this.#hooks.afterCleanupOperationStaged?.({
          grantId: grant.id,
          stagingOperationRoot,
        });
      } catch {
        return null;
      }
      const retained = this.#admitStagedCleanupOperation(grant);
      return retained?.preEffectFingerprintDigest === preEffect.fingerprintDigest ? retained : null;
    } catch {
      const retained = this.#admitStagedCleanupOperation(grant);
      return retained?.preEffectFingerprintDigest === preEffect.fingerprintDigest ? retained : null;
    }
  }

  #operationFilesystemTargetStillExact(
    path: string,
    grant: ProjectReadSnapshotCleanupRequest,
    operation: LocalProjectReadCleanupOperationRecordV1,
  ): boolean {
    try {
      const stat = lstatSync(path);
      const identity = statsIdentity(stat);
      const marker = this.#readMarkerDisposition(
        this.#markerPath(grant.snapshotId),
        grant.ownershipMarkerDigest,
      );
      if (
        stat.isSymbolicLink() ||
        !stat.isDirectory() ||
        realpathSync(path) !== path ||
        identity.deviceId !== operation.targetNodeDeviceId ||
        identity.fileId !== operation.targetNodeFileId ||
        marker.disposition !== ProjectReadSnapshotCleanupTargetMarkerDisposition.MATCHED ||
        marker.marker?.snapshotTreeDigest !== operation.targetManifestDigest
      ) {
        return false;
      }
      const tree = withMappedCandidateFailures(() => scanProjectReadTree(path, this.#bounds));
      return tree.projectionDigest === operation.targetManifestDigest;
    } catch {
      return false;
    }
  }

  #operationTargetStillExact(
    grant: ProjectReadSnapshotCleanupRequest,
    operation: LocalProjectReadCleanupOperationRecordV1,
  ): boolean {
    return this.#operationFilesystemTargetStillExact(grant.snapshotLeafRealpath, grant, operation);
  }

  #clearCleanupOperation(grant: ProjectReadSnapshotCleanupRequest): boolean {
    const operationRoot = this.#cleanupOperationRoot(grant);
    if (pathEntryExists(this.#cleanupStagingOperationRoot(grant))) {
      return false;
    }
    if (!pathEntryExists(operationRoot)) {
      return true;
    }
    if (this.#readCleanupOperation(grant) === null) {
      return false;
    }
    try {
      rmSync(operationRoot, { recursive: true });
      fsyncDirectory(this.#cleanupRoot);
      return true;
    } catch {
      return false;
    }
  }

  #closeAbsentCleanupReconciliation(
    grant: ProjectReadSnapshotCleanupRequest,
    operation: LocalProjectReadCleanupOperationRecordV1 | null,
  ): ProjectReadSnapshotCleanupObservation | null {
    const marker = this.#readMarkerDisposition(
      this.#markerPath(grant.snapshotId),
      grant.ownershipMarkerDigest,
    );
    if (
      marker.disposition !== ProjectReadSnapshotCleanupTargetMarkerDisposition.ABSENT &&
      marker.disposition !== ProjectReadSnapshotCleanupTargetMarkerDisposition.MATCHED
    ) {
      return null;
    }
    if (
      marker.disposition === ProjectReadSnapshotCleanupTargetMarkerDisposition.MATCHED &&
      !this.#removeExactMarker(grant)
    ) {
      return null;
    }
    if (operation !== null && !this.#clearCleanupOperation(grant)) {
      return null;
    }
    const terminal = this.#observeCleanupTarget(grant);
    return terminal === null
      ? null
      : this.#createClearedCleanupObservation(grant, terminal, 'ALREADY_ABSENT');
  }

  #createClearedCleanupObservation(
    grant: ProjectReadSnapshotCleanupRequest,
    terminal: ProjectReadSnapshotCleanupTargetObservation,
    absentDisposition: 'DELETED' | 'ALREADY_ABSENT',
  ): ProjectReadSnapshotCleanupObservation | null {
    if (
      terminal.classification !== ProjectReadSnapshotCleanupTargetClassification.ABSENT &&
      terminal.classification !== ProjectReadSnapshotCleanupTargetClassification.PRESENT_UNSAFE
    ) {
      return null;
    }
    return this.#createCleanupObservation({
      coordinationDisposition: ProjectReadSnapshotCleanupCoordinationDisposition.CLEARED,
      disposition:
        terminal.classification === ProjectReadSnapshotCleanupTargetClassification.ABSENT
          ? absentDisposition
          : 'RETAINED_UNSAFE',
      failurePreEffectTargetObservation: null,
      grant,
      terminalTargetObservation: terminal,
    });
  }

  public cleanupSnapshot(
    rawGrant: ProjectReadSnapshotCleanupRequest,
  ): ProjectReadSnapshotCleanupObservation | null {
    const grant = decodeProjectReadSnapshotCleanupRequest(rawGrant);
    if (
      grant.workspaceRootIdentity !== this.workspaceRootIdentity ||
      grant.snapshotLeafRealpath !== this.snapshotLeafFor(grant.snapshotId)
    ) {
      fail(
        LocalProjectReadWorkspaceFailureCode.CLEANUP_NOT_AUTHORIZED,
        'Cleanup Grant does not bind this exact project-read workspace leaf',
      );
    }
    this.#initializeOwnedRoot();
    const operationRoot = this.#cleanupOperationRoot(grant);
    const stagingOperationRoot = this.#cleanupStagingOperationRoot(grant);
    const tombstone = this.#cleanupTombstonePath(grant);
    const operation = this.#admitStagedCleanupOperation(grant);
    if (
      (pathEntryExists(operationRoot) || pathEntryExists(stagingOperationRoot)) &&
      operation === null
    ) {
      return null;
    }
    const targetExists = pathEntryExists(grant.snapshotLeafRealpath);
    if (!targetExists) {
      if (operation === null && pathEntryExists(tombstone)) {
        return null;
      }
      if (operation !== null && pathEntryExists(tombstone)) {
        if (!this.#operationFilesystemTargetStillExact(tombstone, grant, operation)) {
          return null;
        }
        try {
          makeTreeRemovable(tombstone);
          rmSync(tombstone, { recursive: true });
          this.#hooks.afterCleanupTombstoneRemoved?.({
            grantId: grant.id,
            tombstonePath: tombstone,
          });
          if (!this.#removeExactMarker(grant) || !this.#clearCleanupOperation(grant)) {
            return null;
          }
          const terminal = this.#observeCleanupTarget(grant);
          return terminal === null
            ? null
            : this.#createClearedCleanupObservation(grant, terminal, 'DELETED');
        } catch {
          return null;
        }
      }
      return this.#closeAbsentCleanupReconciliation(grant, operation);
    }

    const preEffect = this.#observeCleanupTarget(grant);
    if (preEffect === null) {
      return null;
    }
    let retainedOperation = operation;
    let failurePreEffect: ProjectReadSnapshotCleanupTargetObservation | null = null;
    if (preEffect.classification === 'EXACT_OWNED') {
      failurePreEffect = preEffect;
      retainedOperation = retainedOperation ?? this.#establishCleanupOperation(grant, preEffect);
      if (retainedOperation?.preEffectFingerprintDigest !== preEffect.fingerprintDigest) {
        return null;
      }
    } else if (
      preEffect.classification === 'PRESENT_UNSAFE' &&
      retainedOperation !== null &&
      this.#operationTargetStillExact(grant, retainedOperation)
    ) {
      // Same-Grant restart after the target root was opened for its atomic rename.
    } else if (preEffect.classification === 'PRESENT_UNSAFE') {
      return this.#createCleanupObservation({
        coordinationDisposition: ProjectReadSnapshotCleanupCoordinationDisposition.INERT_RETAINED,
        disposition: 'RETAINED_UNSAFE',
        failurePreEffectTargetObservation: null,
        grant,
        terminalTargetObservation: preEffect,
      });
    } else {
      return null;
    }
    if (pathEntryExists(tombstone)) {
      return null;
    }
    try {
      this.#hooks.beforeCleanupTargetEffect?.({
        grantId: grant.id,
        snapshotLeafRealpath: grant.snapshotLeafRealpath,
      });
      chmodSync(grant.snapshotLeafRealpath, 0o700);
      renameSync(grant.snapshotLeafRealpath, tombstone);
      fsyncDirectory(this.#snapshotRoot);
    } catch (error) {
      if (
        pathEntryExists(grant.snapshotLeafRealpath) &&
        this.#operationTargetStillExact(grant, retainedOperation)
      ) {
        chmodSync(grant.snapshotLeafRealpath, 0o555);
      }
      if (errorCode(error) === 'ENOENT') {
        return null;
      }
      if (!this.#clearCleanupOperation(grant)) {
        return null;
      }
      const terminal = this.#observeCleanupTarget(grant);
      if (
        failurePreEffect === null ||
        terminal?.classification !== 'EXACT_OWNED' ||
        terminal.fingerprintDigest !== failurePreEffect.fingerprintDigest
      ) {
        return null;
      }
      return this.#createCleanupObservation({
        coordinationDisposition: ProjectReadSnapshotCleanupCoordinationDisposition.CLEARED,
        disposition: 'FAILED',
        failurePreEffectTargetObservation: failurePreEffect,
        grant,
        terminalTargetObservation: terminal,
      });
    }
    try {
      this.#hooks.afterCleanupTargetRename?.({ grantId: grant.id, tombstonePath: tombstone });
      if (pathEntryExists(grant.snapshotLeafRealpath)) {
        return null;
      }
      if (!this.#operationFilesystemTargetStillExact(tombstone, grant, retainedOperation)) {
        return null;
      }
      makeTreeRemovable(tombstone);
      rmSync(tombstone, { recursive: true });
      this.#hooks.afterCleanupTombstoneRemoved?.({
        grantId: grant.id,
        tombstonePath: tombstone,
      });
      if (!this.#removeExactMarker(grant) || !this.#clearCleanupOperation(grant)) {
        return null;
      }
      const terminal = this.#observeCleanupTarget(grant);
      return terminal === null
        ? null
        : this.#createClearedCleanupObservation(grant, terminal, 'DELETED');
    } catch {
      return null;
    }
  }

  #admitAuthoritySnapshot(
    authority: ProjectReadWorkspaceAuthoritySnapshot,
  ): ProjectReadWorkspaceAuthoritySnapshot {
    const previous = this.#reconciliationAuthority;
    if (previous !== undefined) {
      if (authority.authoritySequence < previous.authoritySequence) {
        fail(
          LocalProjectReadWorkspaceFailureCode.STALE_AUTHORITY_SNAPSHOT,
          'Project-read reconciliation authority regressed',
        );
      }
      if (
        authority.authoritySequence === previous.authoritySequence &&
        authority.authorityDigest !== previous.authorityDigest
      ) {
        fail(
          LocalProjectReadWorkspaceFailureCode.AUTHORITY_SNAPSHOT_CONFLICT,
          'Project-read reconciliation authority conflicts at one sequence',
        );
      }
    }
    this.#reconciliationAuthority = authority;
    return authority;
  }

  #createWorkspaceObservation(input: {
    readonly activeExternalExecutionIds: readonly string[];
    readonly authority: ProjectReadWorkspaceAuthoritySnapshot;
    readonly authorityRecordDigest: string | null;
    readonly classification: (typeof ProjectReadWorkspaceClassification)[keyof typeof ProjectReadWorkspaceClassification];
    readonly marker: ProjectReadOwnershipMarker | null;
    readonly snapshotLeafRealpath: string;
  }): ProjectReadWorkspaceObservation {
    const observedAt = nowAtOrAfter(this.#hooks, input.authority.issuedAt);
    const idSuffix = hash(
      JSON.stringify({
        authorityDigest: input.authority.authorityDigest,
        classification: input.classification,
        leaf: input.snapshotLeafRealpath,
        marker: input.marker?.markerDigest ?? null,
        observedAt,
      }),
    );
    const withoutDigest = Object.freeze({
      activeExternalExecutionIds: Object.freeze([...input.activeExternalExecutionIds].sort()),
      authorityRecordDigest: input.authorityRecordDigest,
      authoritySequence: input.authority.authoritySequence,
      authoritySnapshotDigest: input.authority.authorityDigest,
      authoritySnapshotId: input.authority.id,
      classification: input.classification,
      id: `project-read-observation_${idSuffix}`,
      observedAt,
      ownershipMarkerDigest: input.marker?.markerDigest ?? null,
      ownershipMarkerProfile: input.marker?.profile ?? null,
      projectReadAuthorityId: input.marker?.projectReadAuthorityId ?? null,
      schemaVersion: 1 as const,
      snapshotId: input.marker?.snapshotId ?? null,
      snapshotLeafRealpath: input.snapshotLeafRealpath,
      workspaceRootIdentity: this.workspaceRootIdentity,
    });
    return decodeProjectReadWorkspaceObservation({
      ...withoutDigest,
      observationDigest: digestProjectReadWorkspaceValue(withoutDigest),
    });
  }

  public reconcile(
    rawAuthority: ProjectReadWorkspaceAuthoritySnapshot,
  ): readonly ProjectReadWorkspaceObservation[] {
    const authority = this.#admitAuthoritySnapshot(
      decodeProjectReadWorkspaceAuthoritySnapshot(rawAuthority),
    );
    this.#initializeOwnedRoot();
    const markers = new Map<string, ProjectReadOwnershipMarker | null>();
    for (const name of readdirSync(this.#markerRoot).sort()) {
      if (!name.endsWith('.json')) {
        continue;
      }
      const snapshotId = name.slice(0, -'.json'.length);
      let leaf: string;
      try {
        leaf = this.snapshotLeafFor(snapshotId);
      } catch {
        continue;
      }
      try {
        const marker = readLocalProjectReadOwnershipMarker(resolve(this.#markerRoot, name));
        markers.set(
          leaf,
          marker.snapshotId === snapshotId &&
            marker.workspaceRootIdentity === this.workspaceRootIdentity &&
            marker.snapshotLeafRealpath === leaf
            ? marker
            : null,
        );
      } catch {
        markers.set(leaf, null);
      }
    }
    const leaves = new Set<string>(markers.keys());
    for (const name of readdirSync(this.#snapshotRoot).sort()) {
      leaves.add(resolve(this.#snapshotRoot, name));
    }
    const observations: ProjectReadWorkspaceObservation[] = [];
    for (const leaf of [...leaves].sort()) {
      const marker = markers.get(leaf) ?? null;
      const expected =
        marker === null
          ? undefined
          : authority.expectedSnapshots.find(
              (entry) => entry.projectReadAuthorityId === marker.projectReadAuthorityId,
            );
      const activeIds =
        marker === null
          ? []
          : authority.activeConsumers
              .filter((consumer) => consumer.snapshotId === marker.snapshotId)
              .map((consumer) => consumer.externalExecutionId);
      const exactPhysical = marker !== null && this.#materializedTargetIsExact(marker);
      const absentPhysical = !pathEntryExists(leaf);
      const exactExpected =
        marker !== null &&
        expected?.snapshotId === marker.snapshotId &&
        expected.workspaceRootIdentity === marker.workspaceRootIdentity &&
        expected.snapshotLeafRealpath === marker.snapshotLeafRealpath &&
        expected.ownershipMarkerDigest === marker.markerDigest;
      let classification: (typeof ProjectReadWorkspaceClassification)[keyof typeof ProjectReadWorkspaceClassification] =
        ProjectReadWorkspaceClassification.UNSAFE;
      let authorityRecordDigest: string | null = exactExpected
        ? expected.authorityRecordDigest
        : null;
      if (exactExpected && exactPhysical) {
        if (expected.retention === ProjectReadWorkspaceRetention.CURRENT) {
          classification = ProjectReadWorkspaceClassification.OWNED_CURRENT;
        } else if (activeIds.length === 0) {
          classification = ProjectReadWorkspaceClassification.OWNED_RETAINED;
        }
      } else if (
        marker !== null &&
        (exactPhysical || absentPhysical) &&
        expected === undefined &&
        activeIds.length === 0 &&
        !authority.expectedSnapshots.some(
          (entry) =>
            entry.snapshotId === marker.snapshotId ||
            entry.snapshotLeafRealpath === marker.snapshotLeafRealpath,
        )
      ) {
        classification = ProjectReadWorkspaceClassification.OWNED_ORPHANED;
        authorityRecordDigest = null;
      }
      observations.push(
        this.#createWorkspaceObservation({
          activeExternalExecutionIds: activeIds,
          authority,
          authorityRecordDigest,
          classification,
          marker,
          snapshotLeafRealpath: leaf,
        }),
      );
    }
    return Object.freeze(observations);
  }
}

export function createLocalProjectReadWorkspaceInternal(
  options: LocalProjectReadWorkspaceOptions,
  hooks: ProjectReadWorkspaceFaultHooks,
): LocalProjectReadWorkspace {
  return new LocalProjectReadWorkspaceAdapter(options, hooks);
}

export function createLocalProjectReadWorkspace(
  options: LocalProjectReadWorkspaceOptions,
): LocalProjectReadWorkspace {
  return createLocalProjectReadWorkspaceInternal(options, Object.freeze({}));
}
