import { createHash } from 'node:crypto';
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
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
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';

import {
  CandidateWorkspaceAccessMode,
  CandidateWorkspaceLeaseLifecyclePolicy,
  CandidateWorkspaceRetention,
  candidateWorkspaceAllowedPathProjection,
  candidateWorkspaceCleanupGrantProjection,
  candidateWorkspaceLeaseProjection,
  decodeCandidateFreezeObservation,
  decodeCandidatePreparation,
  decodeCandidateRepairPreparation,
  decodeCandidateWorkspaceAuthoritySnapshot,
  decodeCandidateWorkspaceCleanupGrant,
  decodeCandidateWorkspaceDigest,
  decodeCandidateWorkspaceLease,
  decodeFrozenCandidateIntegrityObservation,
  digestCandidateWorkspaceValue,
  validateCandidateFreezeRequest,
  validateCandidatePreparationRequest,
  validateCandidateRepairPreparationRequest,
  validateCandidateWorkspaceLeaseRequest,
  validateFrozenCandidateIntegrityRequest,
  type CandidateWorkspaceLease,
  type CandidateWorkspaceLeaseRequest,
  type CandidateWorkspaceAuthoritySnapshot,
  type CandidateWorkspaceCleanupGrant,
  type CandidateWorkspaceExpectedGeneration,
  type CandidateFreezeRequest,
  type CandidatePreparationRequest,
  type CandidateRepairPreparationRequest,
  type FrozenCandidateIntegrityRequest,
} from '@codeclosure/runtime';

import {
  DEFAULT_CANDIDATE_WORKSPACE_BOUNDS,
  LocalCandidateWorkspaceError,
  LocalCandidateWorkspaceFailureCode,
  WorkspaceReconciliationClassification,
  type CandidateWorkspaceBounds,
  type CandidateWorkspaceCleanupResult,
  type CandidateWorkspaceReconciliationEntry,
  type LocalCandidateWorkspace,
  type LocalCandidateWorkspaceOptions,
} from './contracts.js';
import { captureSourceSnapshot, resolveSourceRoot } from './git-source.js';
import {
  assertPortableRelativePath,
  assertRealDirectory,
  isSameOrWithin,
  pathsOverlap,
  readManifestEntryBytes,
  scanCandidateTree,
  type CandidateSourceSnapshot,
  type CandidateTreeManifest,
} from './manifests.js';
import {
  createCandidateOwnershipRecord,
  createWorkspaceOwnershipRecord,
  decodeCandidateOwnershipRecord,
  fsyncDirectory,
  MAXIMUM_ACTIVE_CANDIDATE_WORKSPACE_LEASES,
  readCandidateOwnershipRecord,
  readWorkspaceOwnershipRecord,
  writeRecordAtomically,
  type CandidateOwnershipRecord,
} from './records.js';

export interface CandidateWorkspaceFaultHooks {
  readonly afterCopiedFile?: (input: {
    readonly candidateRoot: string;
    readonly copiedFileCount: number;
    readonly relativePath: string;
  }) => void;
  readonly afterFirstFreezeScan?: (input: {
    readonly candidateRoot: string;
    readonly firstDigest: string;
  }) => void;
  readonly beforeRepairParentRecheck?: (input: { readonly parentRoot: string }) => void;
  readonly beforeSourceRecheck?: (input: { readonly sourceRoot: string }) => void;
}

const candidateDirectoryName = 'candidates';
const metadataDirectoryName = '.codeclosure-workspace';
const recordDirectoryName = 'generations';
const stagingDirectoryName = 'staging';
const rootRecordName = 'owner.json';

function fail(code: LocalCandidateWorkspaceFailureCode, message: string): never {
  throw new LocalCandidateWorkspaceError(code, message);
}

function nonBlank(value: string, field: string): string {
  if (value.trim().length === 0 || value.includes('\u0000') || Buffer.byteLength(value) > 4_096) {
    fail(LocalCandidateWorkspaceFailureCode.INVALID_CONFIGURATION, `${field} is invalid`);
  }
  return value;
}

function validateBounds(bounds: CandidateWorkspaceBounds): CandidateWorkspaceBounds {
  for (const [field, value] of Object.entries(bounds)) {
    if (!Number.isSafeInteger(value) || value < 1) {
      fail(
        LocalCandidateWorkspaceFailureCode.INVALID_CONFIGURATION,
        `${field} must be a positive safe integer`,
      );
    }
  }
  if (bounds.maximumFileBytes > bounds.maximumTotalBytes) {
    fail(
      LocalCandidateWorkspaceFailureCode.INVALID_CONFIGURATION,
      'The per-file bound cannot exceed the total-byte bound',
    );
  }
  return Object.freeze({ ...bounds });
}

function generationHash(generationId: string): string {
  return createHash('sha256').update(generationId, 'utf8').digest('hex');
}

function candidateLeaf(generationId: string): string {
  return `generation-${generationHash(generationId)}`;
}

function markerFileName(generationId: string): string {
  return `${generationHash(generationId)}.json`;
}

function absoluteConfiguredPath(path: string, field: string): string {
  if (!isAbsolute(path) || path !== path.normalize('NFC') || resolve(path) !== path) {
    fail(
      LocalCandidateWorkspaceFailureCode.INVALID_CONFIGURATION,
      `${field} must be an absolute normalized path without aliases`,
    );
  }
  return path;
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

function assertFutureRealPathIdentity(path: string, field: string): string {
  let ancestor = path;
  while (!pathEntryExists(ancestor)) {
    const parent = dirname(ancestor);
    if (parent === ancestor) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        `${field} has no existing real ancestor`,
      );
    }
    ancestor = parent;
  }
  const realAncestor = assertRealDirectory(ancestor, `${field} ancestor`);
  if (resolve(realAncestor, relative(ancestor, path)) !== path) {
    fail(
      LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
      `${field} must not traverse an aliased ancestor`,
    );
  }
  return path;
}

function ensurePrivateDirectory(path: string): string {
  if (!existsSync(path)) {
    mkdirSync(path, { mode: 0o700 });
  }
  chmodSync(path, 0o700);
  const real = assertRealDirectory(path, 'Workspace-owned directory');
  if (real !== path) {
    fail(
      LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
      'Workspace-owned directories must not use aliases',
    );
  }
  return real;
}

function recordWithoutDigest(
  record: CandidateOwnershipRecord,
): Omit<CandidateOwnershipRecord, 'recordDigest'> {
  const { recordDigest, ...withoutDigest } = record;
  void recordDigest;
  return withoutDigest;
}

function updatedRecord(
  record: CandidateOwnershipRecord,
  patch: Partial<Omit<CandidateOwnershipRecord, 'recordDigest' | 'recordVersion'>>,
): CandidateOwnershipRecord {
  return createCandidateOwnershipRecord({
    ...recordWithoutDigest(record),
    ...patch,
    recordVersion: record.recordVersion + 1,
  });
}

function manifestsHaveSameEntries(
  left: CandidateTreeManifest,
  right: CandidateTreeManifest,
): boolean {
  return (
    left.fileCount === right.fileCount &&
    left.totalBytes === right.totalBytes &&
    JSON.stringify(left.entries) === JSON.stringify(right.entries)
  );
}

function sourceSnapshotsEqual(
  left: CandidateSourceSnapshot,
  right: CandidateSourceSnapshot,
): boolean {
  return left.tree.digest === right.tree.digest && left.git.digest === right.git.digest;
}

function safeRemovePartial(path: string, stagingRoot: string): void {
  if (dirname(path) !== stagingRoot || !isSameOrWithin(path, stagingRoot)) {
    fail(
      LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
      'Partial workspace cleanup target is not an exact staging leaf',
    );
  }
  rmSync(path, { force: true, recursive: true });
}

function copyManifest(
  sourceRoot: string,
  targetRoot: string,
  manifest: CandidateTreeManifest,
  bounds: CandidateWorkspaceBounds,
  hooks: CandidateWorkspaceFaultHooks,
): void {
  let copiedFileCount = 0;
  for (const entry of manifest.entries) {
    const target = resolve(targetRoot, entry.path);
    if (!isSameOrWithin(target, targetRoot)) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Manifest target escaped the Candidate staging root',
      );
    }
    mkdirSync(dirname(target), { mode: 0o755, recursive: true });
    const bytes = readManifestEntryBytes(sourceRoot, entry, bounds);
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
    copiedFileCount += 1;
    hooks.afterCopiedFile?.({
      candidateRoot: targetRoot,
      copiedFileCount,
      relativePath: entry.path,
    });
  }
}

function makeTreeReadOnly(root: string, manifest: CandidateTreeManifest): void {
  const entriesByPath = new Map(manifest.entries.map((entry) => [entry.path, entry]));
  const directories: string[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    directories.push(current);
    for (const name of readdirSync(current)) {
      const absolute = resolve(current, name);
      const stat = lstatSync(absolute);
      if (stat.isSymbolicLink()) {
        fail(
          LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
          'Candidate changed to contain a symbolic link during freeze',
        );
      }
      if (stat.isDirectory()) {
        pending.push(absolute);
      } else if (stat.isFile()) {
        const path = relative(root, absolute).split(sep).join('/');
        const entry = entriesByPath.get(path);
        if (entry === undefined) {
          fail(
            LocalCandidateWorkspaceFailureCode.CANDIDATE_DRIFT,
            'Candidate changed after its first freeze scan',
          );
        }
        chmodSync(absolute, entry.mode === 'EXECUTABLE' ? 0o555 : 0o444);
      } else {
        fail(
          LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
          'Candidate changed to contain a special entry during freeze',
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
        LocalCandidateWorkspaceFailureCode.CANDIDATE_DRIFT,
        'Frozen Candidate contains an aliased or special entry',
      );
    }
    if ((stat.mode & 0o222) !== 0) {
      fail(
        LocalCandidateWorkspaceFailureCode.CANDIDATE_DRIFT,
        'Frozen Candidate regained filesystem write permission',
      );
    }
    if (stat.isDirectory()) {
      for (const name of readdirSync(current)) {
        pending.push(resolve(current, name));
      }
    }
  }
}

function makeTreeRemovable(root: string): void {
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    const stat = lstatSync(current);
    if (stat.isSymbolicLink()) {
      continue;
    }
    if (stat.isDirectory()) {
      chmodSync(current, 0o700);
      for (const entry of readdirSync(current)) {
        pending.push(resolve(current, entry));
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

function expectedAuthorityMap(
  authority: CandidateWorkspaceAuthoritySnapshot,
): ReadonlyMap<string, CandidateWorkspaceExpectedGeneration> {
  return new Map(
    authority.expectedGenerations.map((entry) => [entry.generation.id, entry] as const),
  );
}

class LocalCandidateWorkspaceAdapter implements LocalCandidateWorkspace {
  readonly #activeCleanupGrants = new Map<string, CandidateWorkspaceCleanupGrant>();
  readonly #authorityRoots: readonly string[];
  readonly #bounds: CandidateWorkspaceBounds;
  readonly #candidateRoot: string;
  readonly #hooks: CandidateWorkspaceFaultHooks;
  readonly #metadataRoot: string;
  readonly #ownerId: string;
  readonly #recordRoot: string;
  readonly #stagingRoot: string;
  #initialized = false;
  #reconciliationAuthority: CandidateWorkspaceAuthoritySnapshot | undefined;
  public readonly workspaceRootIdentity: string;

  public constructor(options: LocalCandidateWorkspaceOptions, hooks: CandidateWorkspaceFaultHooks) {
    this.#ownerId = nonBlank(options.ownerId, 'Workspace owner ID');
    this.#bounds = validateBounds(options.bounds ?? DEFAULT_CANDIDATE_WORKSPACE_BOUNDS);
    this.#hooks = hooks;
    const configuredRoot = absoluteConfiguredPath(options.workspaceRoot, 'Workspace root');
    this.workspaceRootIdentity = assertFutureRealPathIdentity(configuredRoot, 'Workspace root');
    const rootExisted = pathEntryExists(configuredRoot);
    if (rootExisted) {
      const real = assertRealDirectory(configuredRoot, 'Workspace root');
      if (real !== configuredRoot) {
        fail(
          LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
          'Workspace root must not be an alias',
        );
      }
    }
    const rawAuthorityRoots = options.authorityRoots.map((root, index) =>
      assertRealDirectory(
        absoluteConfiguredPath(root, `Authority root ${String(index)}`),
        `Authority root ${String(index)}`,
      ),
    );
    this.#authorityRoots = Object.freeze([...new Set(rawAuthorityRoots)].sort());
    if (
      this.#authorityRoots.some((authorityRoot) =>
        pathsOverlap(authorityRoot, this.workspaceRootIdentity),
      )
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Workspace root must not overlap an authority root',
      );
    }

    this.#metadataRoot = resolve(this.workspaceRootIdentity, metadataDirectoryName);
    this.#candidateRoot = resolve(this.workspaceRootIdentity, candidateDirectoryName);
    this.#recordRoot = resolve(this.#metadataRoot, recordDirectoryName);
    this.#stagingRoot = resolve(this.#metadataRoot, stagingDirectoryName);
    if (rootExisted && readdirSync(this.workspaceRootIdentity).length > 0) {
      if (!existsSync(resolve(this.#metadataRoot, rootRecordName))) {
        fail(
          LocalCandidateWorkspaceFailureCode.WORKSPACE_CONFLICT,
          'A non-empty unowned workspace root cannot be claimed',
        );
      }
      this.#openOwnedRoot();
    }
  }

  #openOwnedRoot(): void {
    const workspaceIdentity = assertRealDirectory(this.workspaceRootIdentity, 'Workspace root');
    if (workspaceIdentity !== this.workspaceRootIdentity) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Workspace root must resolve to its configured identity',
      );
    }
    const metadataIdentity = assertRealDirectory(this.#metadataRoot, 'Workspace metadata root');
    if (metadataIdentity !== this.#metadataRoot) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Workspace metadata root must not be aliased',
      );
    }
    const ownership = readWorkspaceOwnershipRecord(resolve(this.#metadataRoot, rootRecordName));
    if (
      ownership.ownerId !== this.#ownerId ||
      ownership.workspaceRootIdentity !== this.workspaceRootIdentity
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.WORKSPACE_CONFLICT,
        'Workspace ownership does not match trusted configuration',
      );
    }
    for (const [path, field] of [
      [this.#candidateRoot, 'Candidate root'],
      [this.#recordRoot, 'Generation-record root'],
      [this.#stagingRoot, 'Staging root'],
    ] as const) {
      if (assertRealDirectory(path, field) !== path) {
        fail(
          LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
          `${field} must not be aliased`,
        );
      }
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
    const real = assertRealDirectory(this.workspaceRootIdentity, 'Workspace root');
    if (real !== this.workspaceRootIdentity) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Workspace root must resolve to its configured identity',
      );
    }
    chmodSync(this.workspaceRootIdentity, 0o700);
    mkdirSync(this.#metadataRoot, { mode: 0o700 });
    ensurePrivateDirectory(this.#candidateRoot);
    ensurePrivateDirectory(this.#recordRoot);
    ensurePrivateDirectory(this.#stagingRoot);
    writeRecordAtomically(
      resolve(this.#metadataRoot, rootRecordName),
      createWorkspaceOwnershipRecord(this.#ownerId, this.workspaceRootIdentity),
    );
    this.#initialized = true;
  }

  #requireInitialized(): void {
    if (!this.#initialized) {
      fail(
        LocalCandidateWorkspaceFailureCode.WORKSPACE_CONFLICT,
        'Workspace ownership has not been initialized by a valid Candidate source',
      );
    }
  }

  #generationRoot(generationId: string): string {
    return resolve(this.#candidateRoot, candidateLeaf(generationId));
  }

  #recordPath(generationId: string): string {
    return resolve(this.#recordRoot, markerFileName(generationId));
  }

  #readRecord(generationId: string): CandidateOwnershipRecord {
    this.#requireInitialized();
    let record: CandidateOwnershipRecord;
    try {
      record = readCandidateOwnershipRecord(this.#recordPath(generationId));
    } catch (error) {
      if (error instanceof LocalCandidateWorkspaceError) {
        throw error;
      }
      fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, 'Candidate ownership is unavailable');
    }
    this.#assertRecordOwnership(record, generationId);
    return record;
  }

  #assertRecordOwnership(record: CandidateOwnershipRecord, generationId: string): void {
    const expectedRoot = this.#generationRoot(generationId);
    if (
      record.ownerId !== this.#ownerId ||
      record.workspaceRootIdentity !== this.workspaceRootIdentity ||
      record.generationId !== generationId ||
      record.candidateLeaf !== candidateLeaf(generationId) ||
      record.candidateRootIdentity !== expectedRoot
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
        'Candidate ownership record does not bind the selected generation root',
      );
    }
    if (
      record.baseDigest !== record.baseManifest.digest ||
      record.sourceTreeDigest !== record.baseManifest.digest ||
      record.sourceProjectRoot !== record.sourceGitMetadata.sourceProjectRoot ||
      !isAbsolute(record.sourceProjectRoot) ||
      resolve(record.sourceProjectRoot) !== record.sourceProjectRoot ||
      !isAbsolute(record.sourceGitMetadata.gitCommonDirectory) ||
      resolve(record.sourceGitMetadata.gitCommonDirectory) !==
        record.sourceGitMetadata.gitCommonDirectory ||
      !isSameOrWithin(record.sourceGitMetadata.gitCommonDirectory, record.sourceProjectRoot)
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
        'Candidate ownership record has inconsistent base or source identity',
      );
    }
    const realRoot = assertRealDirectory(expectedRoot, 'Candidate generation root');
    if (realRoot !== expectedRoot || dirname(realRoot) !== this.#candidateRoot) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Candidate generation root is aliased or outside the owned leaf location',
      );
    }
  }

  #writeRecord(record: CandidateOwnershipRecord): void {
    this.#requireInitialized();
    const validated = decodeCandidateOwnershipRecord(record);
    writeRecordAtomically(this.#recordPath(validated.generationId), validated);
  }

  #assertSourceContainment(sourceRoot: string): void {
    if (
      pathsOverlap(sourceRoot, this.workspaceRootIdentity) ||
      this.#authorityRoots.some((root) => pathsOverlap(root, sourceRoot))
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Source, workspace, and authority roots must remain disjoint',
      );
    }
  }

  #createGeneration(input: {
    readonly baseManifest: CandidateTreeManifest;
    readonly candidateId: string;
    readonly generationId: string;
    readonly goalId: string;
    readonly goalRevision: number;
    readonly hooksSourceRoot: string;
    readonly parentGenerationId: string | null;
    readonly sourceGitMetadata: CandidateOwnershipRecord['sourceGitMetadata'];
    readonly sourceProjectRoot: string;
    readonly sourceTreeDigest: string;
    readonly workflowId: string;
  }): CandidateOwnershipRecord {
    this.#requireInitialized();
    const finalRoot = this.#generationRoot(input.generationId);
    const recordPath = this.#recordPath(input.generationId);
    if (existsSync(finalRoot) || existsSync(recordPath)) {
      fail(
        LocalCandidateWorkspaceFailureCode.WORKSPACE_CONFLICT,
        'Candidate generation identity is already allocated',
      );
    }
    const stagingRoot = resolve(
      this.#stagingRoot,
      `${candidateLeaf(input.generationId)}.${process.pid.toString(10)}`,
    );
    if (existsSync(stagingRoot)) {
      fail(
        LocalCandidateWorkspaceFailureCode.WORKSPACE_CONFLICT,
        'Candidate staging identity is already allocated',
      );
    }
    mkdirSync(stagingRoot, { mode: 0o700 });
    try {
      copyManifest(
        input.hooksSourceRoot,
        stagingRoot,
        input.baseManifest,
        this.#bounds,
        this.#hooks,
      );
      const stagedManifest = scanCandidateTree(stagingRoot, this.#bounds);
      if (!manifestsHaveSameEntries(input.baseManifest, stagedManifest)) {
        fail(
          LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT,
          'Candidate copy does not match its exact base manifest',
        );
      }
      fsyncTreeDirectories(stagingRoot);
      renameSync(stagingRoot, finalRoot);
      fsyncDirectory(this.#candidateRoot);
      const finalIdentity = realpathSync(finalRoot);
      if (finalIdentity !== finalRoot || dirname(finalIdentity) !== this.#candidateRoot) {
        fail(
          LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
          'Candidate generation was not committed to the exact owned leaf',
        );
      }
      const record = createCandidateOwnershipRecord({
        activeLeases: Object.freeze([]),
        baseDigest: input.baseManifest.digest,
        baseManifest: input.baseManifest,
        candidateId: input.candidateId,
        candidateLeaf: candidateLeaf(input.generationId),
        candidateRootIdentity: finalIdentity,
        frozenManifest: null,
        generationId: input.generationId,
        goalId: input.goalId,
        goalRevision: input.goalRevision,
        ownerId: this.#ownerId,
        parentGenerationId: input.parentGenerationId,
        phase: 'MUTABLE',
        recordKind: 'CANDIDATE_WORKSPACE_GENERATION',
        recordVersion: 1,
        retentionPolicy: 'RUNTIME_OWNED',
        schemaVersion: 1,
        sourceGitMetadata: input.sourceGitMetadata,
        sourceProjectRoot: input.sourceProjectRoot,
        sourceTreeDigest: input.sourceTreeDigest,
        workflowId: input.workflowId,
        workspaceRootIdentity: this.workspaceRootIdentity,
      });
      try {
        this.#writeRecord(record);
      } catch (error) {
        makeTreeRemovable(finalRoot);
        rmSync(finalRoot, { recursive: true });
        fsyncDirectory(this.#candidateRoot);
        throw error;
      }
      return record;
    } catch (error) {
      if (existsSync(stagingRoot)) {
        safeRemovePartial(stagingRoot, this.#stagingRoot);
      }
      throw error;
    }
  }

  public prepare(rawRequest: CandidatePreparationRequest): unknown {
    const request = validateCandidatePreparationRequest(rawRequest);
    const sourceRoot = resolveSourceRoot(request.projectPath);
    this.#assertSourceContainment(sourceRoot);
    this.#initializeOwnedRoot();
    const before = captureSourceSnapshot(sourceRoot, this.#bounds);
    const record = this.#createGeneration({
      baseManifest: before.tree,
      candidateId: request.candidateId,
      generationId: request.generationId,
      goalId: request.goalId,
      goalRevision: request.goalRevision,
      hooksSourceRoot: sourceRoot,
      parentGenerationId: null,
      sourceGitMetadata: before.git,
      sourceProjectRoot: sourceRoot,
      sourceTreeDigest: before.tree.digest,
      workflowId: request.workflowId,
    });
    try {
      this.#hooks.beforeSourceRecheck?.({ sourceRoot });
      const after = captureSourceSnapshot(sourceRoot, this.#bounds);
      if (!sourceSnapshotsEqual(before, after)) {
        fail(
          LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT,
          'Source tree or Git metadata changed during Candidate creation',
        );
      }
    } catch (error) {
      const root = record.candidateRootIdentity;
      makeTreeRemovable(root);
      rmSync(root, { recursive: true });
      unlinkSync(this.#recordPath(record.generationId));
      fsyncDirectory(this.#candidateRoot);
      fsyncDirectory(this.#recordRoot);
      throw error;
    }
    return decodeCandidatePreparation({
      baseDigest: before.tree.digest,
      candidateId: request.candidateId,
      generationId: request.generationId,
      goalId: request.goalId,
      schemaVersion: 1,
      workflowId: request.workflowId,
    });
  }

  public prepareRepair(rawRequest: CandidateRepairPreparationRequest): unknown {
    const request = validateCandidateRepairPreparationRequest(rawRequest);
    const parent = this.#readRecord(request.parentGenerationId);
    const parentManifest = parent.frozenManifest;
    if (
      parent.phase !== 'FROZEN' ||
      parentManifest?.digest !== request.expectedBaseDigest ||
      parent.goalId !== request.goalId ||
      parent.goalRevision !== request.goalRevision ||
      parent.workflowId !== request.workflowId ||
      parent.candidateId !== request.candidateId ||
      parent.activeLeases.length !== 0
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.WORKSPACE_CONFLICT,
        'Repair authority does not match one exact eligible frozen parent',
      );
    }
    const requestedProject = absoluteConfiguredPath(request.projectPath, 'Repair project path');
    if (requestedProject !== parent.sourceProjectRoot) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Repair request substituted the source project identity',
      );
    }
    assertTreeReadOnly(parent.candidateRootIdentity);
    const before = scanCandidateTree(parent.candidateRootIdentity, this.#bounds);
    if (before.digest !== parentManifest.digest) {
      fail(
        LocalCandidateWorkspaceFailureCode.CANDIDATE_DRIFT,
        'Frozen repair parent no longer matches its exact identity',
      );
    }
    const child = this.#createGeneration({
      baseManifest: parentManifest,
      candidateId: request.candidateId,
      generationId: request.generationId,
      goalId: request.goalId,
      goalRevision: request.goalRevision,
      hooksSourceRoot: parent.candidateRootIdentity,
      parentGenerationId: request.parentGenerationId,
      sourceGitMetadata: parent.sourceGitMetadata,
      sourceProjectRoot: parent.sourceProjectRoot,
      sourceTreeDigest: parentManifest.digest,
      workflowId: request.workflowId,
    });
    try {
      this.#hooks.beforeRepairParentRecheck?.({ parentRoot: parent.candidateRootIdentity });
      const after = scanCandidateTree(parent.candidateRootIdentity, this.#bounds);
      if (after.digest !== before.digest) {
        fail(
          LocalCandidateWorkspaceFailureCode.CANDIDATE_DRIFT,
          'Frozen repair parent changed during child creation',
        );
      }
      assertTreeReadOnly(parent.candidateRootIdentity);
    } catch (error) {
      makeTreeRemovable(child.candidateRootIdentity);
      rmSync(child.candidateRootIdentity, { recursive: true });
      unlinkSync(this.#recordPath(child.generationId));
      fsyncDirectory(this.#candidateRoot);
      fsyncDirectory(this.#recordRoot);
      throw error;
    }
    return decodeCandidateRepairPreparation({
      baseDigest: request.expectedBaseDigest,
      candidateId: request.candidateId,
      generationId: request.generationId,
      goalId: request.goalId,
      parentGenerationId: request.parentGenerationId,
      schemaVersion: 1,
      workflowId: request.workflowId,
    });
  }

  public observeFreeze(rawRequest: CandidateFreezeRequest): unknown {
    const request = validateCandidateFreezeRequest(rawRequest);
    const record = this.#readRecord(request.generation.id);
    if (
      request.generation.state !== 'FREEZING' ||
      request.generation.candidateId !== record.candidateId ||
      request.generation.baseDigest !== record.baseDigest ||
      request.goalId !== record.goalId ||
      request.goalRevision !== record.goalRevision ||
      request.workflowId !== record.workflowId ||
      record.phase !== 'MUTABLE'
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.WORKSPACE_CONFLICT,
        'Freeze request does not bind the current mutable Candidate generation',
      );
    }
    const revoked = updatedRecord(record, { activeLeases: Object.freeze([]) });
    this.#writeRecord(revoked);
    let first: CandidateTreeManifest;
    let second: CandidateTreeManifest;
    try {
      first = scanCandidateTree(record.candidateRootIdentity, this.#bounds);
      makeTreeReadOnly(record.candidateRootIdentity, first);
      this.#hooks.afterFirstFreezeScan?.({
        candidateRoot: record.candidateRootIdentity,
        firstDigest: first.digest,
      });
      makeTreeReadOnly(record.candidateRootIdentity, first);
      second = scanCandidateTree(record.candidateRootIdentity, this.#bounds);
      assertTreeReadOnly(record.candidateRootIdentity);
    } catch (error) {
      this.#writeRecord(
        updatedRecord(revoked, { activeLeases: Object.freeze([]), phase: 'UNSAFE' }),
      );
      throw error;
    }
    const stable = first.digest === second.digest;
    this.#writeRecord(
      updatedRecord(revoked, {
        activeLeases: Object.freeze([]),
        frozenManifest: stable ? second : null,
        phase: stable ? 'FROZEN' : 'UNSAFE',
      }),
    );
    return decodeCandidateFreezeObservation({
      changeSetDigest: digestCandidateWorkspaceValue({
        baseDigest: record.baseDigest,
        frozenDigest: second.digest,
        profile: 'candidate-change-set-v1',
      }),
      firstSourceDigest: first.digest,
      generationId: request.generation.id,
      schemaVersion: 1,
      secondSourceDigest: second.digest,
    });
  }

  public observeFrozen(rawRequest: FrozenCandidateIntegrityRequest): unknown {
    const request = validateFrozenCandidateIntegrityRequest(rawRequest);
    const record = this.#readRecord(request.generation.id);
    if (
      !['FROZEN', 'REJECTED', 'ACCEPTED'].includes(request.generation.state) ||
      record.phase !== 'FROZEN' ||
      record.frozenManifest === null ||
      request.generation.frozenDigest !== record.frozenManifest.digest ||
      request.generation.candidateId !== record.candidateId ||
      request.goalId !== record.goalId ||
      request.workflowId !== record.workflowId
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.WORKSPACE_CONFLICT,
        'Frozen integrity request does not bind the recorded generation',
      );
    }
    let observed: CandidateTreeManifest;
    try {
      assertTreeReadOnly(record.candidateRootIdentity);
      observed = scanCandidateTree(record.candidateRootIdentity, this.#bounds);
    } catch (error) {
      this.#writeRecord(updatedRecord(record, { frozenManifest: null, phase: 'UNSAFE' }));
      throw error;
    }
    if (observed.digest !== record.frozenManifest.digest) {
      this.#writeRecord(updatedRecord(record, { frozenManifest: null, phase: 'UNSAFE' }));
    }
    return decodeFrozenCandidateIntegrityObservation({
      generationId: request.generation.id,
      observedDigest: observed.digest,
      schemaVersion: 1,
    });
  }

  #realForbiddenRoots(
    record: CandidateOwnershipRecord,
    requested: readonly string[],
  ): readonly string[] {
    const roots = requested.map((root, index) => {
      const configured = absoluteConfiguredPath(root, `Forbidden root ${String(index)}`);
      const real = assertRealDirectory(configured, `Forbidden root ${String(index)}`);
      if (configured !== real) {
        fail(
          LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
          'Forbidden roots must not be aliases',
        );
      }
      return real;
    });
    if (
      !roots.includes(record.sourceProjectRoot) ||
      this.#authorityRoots.some((root) => !roots.includes(root)) ||
      roots.some(
        (root) =>
          pathsOverlap(root, record.candidateRootIdentity) ||
          pathsOverlap(root, this.workspaceRootIdentity),
      ) ||
      new Set(roots).size !== roots.length ||
      JSON.stringify(roots) !== JSON.stringify([...roots].sort())
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
        'Lease forbidden roots are incomplete, aliased, overlapping, or unordered',
      );
    }
    return Object.freeze(roots);
  }

  #assertAllowedPaths(record: CandidateOwnershipRecord, paths: readonly string[]): void {
    for (const path of paths) {
      assertPortableRelativePath(path, this.#bounds.maximumPathBytes);
      const absolute = resolve(record.candidateRootIdentity, path);
      if (!isSameOrWithin(absolute, record.candidateRootIdentity)) {
        fail(
          LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
          'Allowed path escaped the Candidate generation root',
        );
      }
      let cursor = record.candidateRootIdentity;
      for (const component of path.split('/')) {
        cursor = resolve(cursor, component);
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink()) {
          fail(
            LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
            'Allowed path contains a symbolic-link alias',
          );
        }
      }
      const real = realpathSync(absolute);
      if (!isSameOrWithin(real, record.candidateRootIdentity)) {
        fail(
          LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
          'Allowed path resolves outside the Candidate generation root',
        );
      }
    }
  }

  public issueLease(rawRequest: CandidateWorkspaceLeaseRequest): unknown {
    const request = validateCandidateWorkspaceLeaseRequest(rawRequest);
    const record = this.#readRecord(request.generation.id);
    const parentGenerationId = request.generation.parentGenerationId ?? null;
    if (
      request.goalId !== record.goalId ||
      request.goalRevision !== record.goalRevision ||
      request.workflowId !== record.workflowId ||
      request.generation.candidateId !== record.candidateId ||
      parentGenerationId !== record.parentGenerationId ||
      request.generation.baseDigest !== record.baseDigest
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.INVALID_LEASE,
        'Lease request does not bind the exact Candidate ownership record',
      );
    }
    if (
      (request.accessMode === CandidateWorkspaceAccessMode.MUTABLE &&
        (record.phase !== 'MUTABLE' ||
          record.activeLeases.some((lease) => lease.accessMode === 'MUTABLE'))) ||
      (request.accessMode === CandidateWorkspaceAccessMode.READ_ONLY &&
        (record.phase !== 'FROZEN' || record.frozenManifest === null))
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.INVALID_LEASE,
        'Candidate lifecycle does not permit the requested workspace lease',
      );
    }
    const frozenManifest = record.frozenManifest;
    if (request.accessMode === CandidateWorkspaceAccessMode.READ_ONLY) {
      assertTreeReadOnly(record.candidateRootIdentity);
      if (
        frozenManifest === null ||
        request.generation.frozenDigest !== frozenManifest.digest ||
        scanCandidateTree(record.candidateRootIdentity, this.#bounds).digest !==
          frozenManifest.digest
      ) {
        fail(
          LocalCandidateWorkspaceFailureCode.CANDIDATE_DRIFT,
          'Read-only lease Candidate identity is stale',
        );
      }
    }
    const forbiddenRoots = this.#realForbiddenRoots(record, request.forbiddenRoots);
    this.#assertAllowedPaths(record, request.allowedPaths);
    if (record.activeLeases.length >= MAXIMUM_ACTIVE_CANDIDATE_WORKSPACE_LEASES) {
      fail(
        LocalCandidateWorkspaceFailureCode.INVALID_LEASE,
        'Candidate workspace active-lease limit is exhausted',
      );
    }
    const lifecyclePolicy =
      request.accessMode === CandidateWorkspaceAccessMode.MUTABLE
        ? CandidateWorkspaceLeaseLifecyclePolicy.REVOKE_ON_FREEZE
        : CandidateWorkspaceLeaseLifecyclePolicy.RELEASE_EXPLICITLY;
    const allowedPathPolicyDigest = digestCandidateWorkspaceValue(
      candidateWorkspaceAllowedPathProjection(request.allowedPaths),
    );
    const withoutDigest = Object.freeze({
      accessMode: request.accessMode,
      allowedPathPolicyDigest,
      allowedPaths: request.allowedPaths,
      candidateId: request.generation.candidateId,
      candidateDigest: request.generation.frozenDigest ?? request.generation.baseDigest,
      candidateGenerationId: request.generation.id,
      candidateGenerationVersion: request.generation.version,
      forbiddenRoots,
      generationSequence: request.generation.sequence,
      goalId: request.goalId,
      goalRevision: request.goalRevision,
      id: request.id,
      issuedAt: request.issuedAt,
      lifecyclePolicy,
      parentGenerationId,
      reservedPathPolicy: 'M2_CONTROLLED_COPY_V1',
      retentionPolicy: 'RUNTIME_OWNED',
      root: record.candidateRootIdentity,
      schemaVersion: 1,
      sourceGitMetadataDigest: decodeCandidateWorkspaceDigest(record.sourceGitMetadata.digest),
      sourceProjectRoot: record.sourceProjectRoot,
      sourceTreeDigest: decodeCandidateWorkspaceDigest(record.sourceTreeDigest),
      state: 'ACTIVE',
      version: request.version,
      workspaceRootIdentity: this.workspaceRootIdentity,
      workflowId: request.workflowId,
      workflowVersion: request.workflowVersion,
    } as const);
    const lease = decodeCandidateWorkspaceLease({
      ...withoutDigest,
      leaseDigest: digestCandidateWorkspaceValue(candidateWorkspaceLeaseProjection(withoutDigest)),
    });
    if (record.activeLeases.some((active) => active.id === lease.id)) {
      fail(LocalCandidateWorkspaceFailureCode.INVALID_LEASE, 'Lease ID is already active');
    }
    const activeLeases = Object.freeze(
      [
        ...record.activeLeases,
        Object.freeze({
          accessMode: lease.accessMode,
          digest: lease.leaseDigest,
          id: lease.id,
        }),
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
    this.#writeRecord(updatedRecord(record, { activeLeases }));
    return lease;
  }

  public releaseLease(rawLease: CandidateWorkspaceLease): void {
    const lease = decodeCandidateWorkspaceLease(rawLease);
    const record = this.#readRecord(lease.candidateGenerationId);
    const active = record.activeLeases.find((entry) => entry.id === lease.id);
    if (active?.digest !== lease.leaseDigest) {
      fail(
        LocalCandidateWorkspaceFailureCode.INVALID_LEASE,
        'Lease release does not bind one current active lease',
      );
    }
    this.#writeRecord(
      updatedRecord(record, {
        activeLeases: Object.freeze(record.activeLeases.filter((entry) => entry.id !== lease.id)),
      }),
    );
  }

  public assertLeaseCurrent(rawLease: CandidateWorkspaceLease): CandidateWorkspaceLease {
    const lease = decodeCandidateWorkspaceLease(rawLease);
    const record = this.#readRecord(lease.candidateGenerationId);
    const active = record.activeLeases.find((entry) => entry.id === lease.id);
    if (
      active?.digest !== lease.leaseDigest ||
      record.candidateRootIdentity !== lease.root ||
      record.candidateId !== lease.candidateId ||
      record.goalId !== lease.goalId ||
      record.goalRevision !== lease.goalRevision ||
      record.workflowId !== lease.workflowId ||
      record.sourceTreeDigest !== lease.sourceTreeDigest ||
      record.sourceGitMetadata.digest !== lease.sourceGitMetadataDigest
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.INVALID_LEASE,
        'Workspace lease is stale or does not bind current ownership',
      );
    }
    this.#realForbiddenRoots(record, lease.forbiddenRoots);
    this.#assertAllowedPaths(record, lease.allowedPaths);
    if (lease.accessMode === CandidateWorkspaceAccessMode.READ_ONLY) {
      assertTreeReadOnly(record.candidateRootIdentity);
    }
    if (
      (lease.accessMode === CandidateWorkspaceAccessMode.MUTABLE && record.phase !== 'MUTABLE') ||
      (lease.accessMode === CandidateWorkspaceAccessMode.READ_ONLY &&
        (record.phase !== 'FROZEN' ||
          record.frozenManifest === null ||
          scanCandidateTree(record.candidateRootIdentity, this.#bounds).digest !==
            lease.candidateDigest))
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.INVALID_LEASE,
        'Workspace lease no longer matches Candidate lifecycle or bytes',
      );
    }
    return lease;
  }

  #reconcileRecord(
    record: CandidateOwnershipRecord,
    expected: ReadonlyMap<string, CandidateWorkspaceExpectedGeneration>,
  ): CandidateWorkspaceReconciliationEntry {
    try {
      this.#assertRecordOwnership(record, record.generationId);
      if (record.phase === 'UNSAFE' || record.activeLeases.length !== 0) {
        return Object.freeze({
          candidateRoot: record.candidateRootIdentity,
          classification: WorkspaceReconciliationClassification.UNSAFE,
          cleanupGrant: null,
          generationId: record.generationId,
          ownershipDigest: record.recordDigest,
          reason:
            record.phase === 'UNSAFE'
              ? 'ownership record is marked unsafe'
              : 'restart found unresolved active leases',
        });
      }
      const authority = expected.get(record.generationId);
      if (authority !== undefined) {
        const generation = authority.generation;
        const expectedParent = generation.parentGenerationId ?? null;
        if (
          record.candidateId !== generation.candidateId ||
          record.goalId !== authority.goalId ||
          record.goalRevision !== authority.goalRevision ||
          record.workflowId !== authority.workflowId ||
          record.parentGenerationId !== expectedParent ||
          record.baseDigest !== generation.baseDigest
        ) {
          return Object.freeze({
            candidateRoot: record.candidateRootIdentity,
            classification: WorkspaceReconciliationClassification.UNSAFE,
            cleanupGrant: null,
            generationId: record.generationId,
            ownershipDigest: record.recordDigest,
            reason: 'filesystem ownership does not match persisted Candidate authority',
          });
        }
        const expectedPhase =
          generation.state === 'MUTABLE'
            ? 'MUTABLE'
            : ['FROZEN', 'REJECTED', 'ACCEPTED'].includes(generation.state)
              ? 'FROZEN'
              : null;
        if (
          expectedPhase === null ||
          record.phase !== expectedPhase ||
          (expectedPhase === 'FROZEN' &&
            (record.frozenManifest === null ||
              generation.frozenDigest !== record.frozenManifest.digest))
        ) {
          return Object.freeze({
            candidateRoot: record.candidateRootIdentity,
            classification: WorkspaceReconciliationClassification.UNSAFE,
            cleanupGrant: null,
            generationId: record.generationId,
            ownershipDigest: record.recordDigest,
            reason: 'filesystem lifecycle does not match persisted Candidate authority',
          });
        }
      }
      if (record.phase === 'FROZEN') {
        assertTreeReadOnly(record.candidateRootIdentity);
      }
      const observed = scanCandidateTree(record.candidateRootIdentity, this.#bounds);
      if (record.phase === 'FROZEN' && record.frozenManifest?.digest !== observed.digest) {
        return Object.freeze({
          candidateRoot: record.candidateRootIdentity,
          classification: WorkspaceReconciliationClassification.UNSAFE,
          cleanupGrant: null,
          generationId: record.generationId,
          ownershipDigest: record.recordDigest,
          reason: 'frozen Candidate bytes do not match ownership',
        });
      }
      const retention = authority?.retention;
      return Object.freeze({
        candidateRoot: record.candidateRootIdentity,
        classification:
          retention === CandidateWorkspaceRetention.CURRENT
            ? WorkspaceReconciliationClassification.OWNED_CURRENT
            : retention === CandidateWorkspaceRetention.RETAINED
              ? WorkspaceReconciliationClassification.OWNED_RETAINED
              : WorkspaceReconciliationClassification.OWNED_ORPHANED,
        cleanupGrant: null,
        generationId: record.generationId,
        ownershipDigest: record.recordDigest,
        reason:
          retention === CandidateWorkspaceRetention.CURRENT
            ? 'generation is current authority'
            : retention === CandidateWorkspaceRetention.RETAINED
              ? 'generation is retained authority'
              : 'owned generation is absent from authoritative retention input',
      });
    } catch {
      return Object.freeze({
        candidateRoot: this.#generationRoot(record.generationId),
        classification: WorkspaceReconciliationClassification.UNSAFE,
        cleanupGrant: null,
        generationId: record.generationId,
        ownershipDigest: record.recordDigest,
        reason: 'ownership or filesystem validation failed closed',
      });
    }
  }

  #issueCleanupGrant(
    authority: CandidateWorkspaceAuthoritySnapshot,
    entry: CandidateWorkspaceReconciliationEntry,
  ): CandidateWorkspaceCleanupGrant {
    if (entry.generationId === null || entry.ownershipDigest === null) {
      fail(
        LocalCandidateWorkspaceFailureCode.CLEANUP_NOT_AUTHORIZED,
        'Cleanup grant requires one exact owned generation',
      );
    }
    const grantIdentity = digestCandidateWorkspaceValue({
      authorityDigest: authority.authorityDigest,
      candidateRoot: entry.candidateRoot,
      generationId: entry.generationId,
      ownershipDigest: entry.ownershipDigest,
      profile: 'candidate-workspace-cleanup-grant-id-v1',
    });
    const withoutDigest = Object.freeze({
      authorityDigest: authority.authorityDigest,
      authoritySequence: authority.authoritySequence,
      authoritySnapshotId: authority.id,
      candidateRoot: entry.candidateRoot,
      generationId: entry.generationId,
      id: `cleanup_${grantIdentity.slice('sha256:'.length)}`,
      issuedAt: authority.issuedAt,
      lifecyclePolicy: 'ONE_TIME',
      ownershipDigest: decodeCandidateWorkspaceDigest(entry.ownershipDigest),
      schemaVersion: 1,
      state: 'ACTIVE',
      version: 1,
      workspaceRootIdentity: this.workspaceRootIdentity,
    } as const);
    const grant = decodeCandidateWorkspaceCleanupGrant({
      ...withoutDigest,
      grantDigest: digestCandidateWorkspaceValue(
        candidateWorkspaceCleanupGrantProjection(withoutDigest),
      ),
    });
    this.#activeCleanupGrants.set(grant.id, grant);
    return grant;
  }

  #assertAuthoritySnapshotAdmission(authority: CandidateWorkspaceAuthoritySnapshot): void {
    const current = this.#reconciliationAuthority;
    if (current === undefined) {
      return;
    }
    if (authority.authoritySequence < current.authoritySequence) {
      fail(
        LocalCandidateWorkspaceFailureCode.STALE_AUTHORITY_SNAPSHOT,
        'Candidate workspace authority sequence cannot move backwards',
      );
    }
    if (
      authority.authoritySequence === current.authoritySequence &&
      authority.authorityDigest !== current.authorityDigest
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.AUTHORITY_SNAPSHOT_CONFLICT,
        'Candidate workspace authority snapshots conflict at one sequence',
      );
    }
  }

  public reconcile(
    rawAuthority: CandidateWorkspaceAuthoritySnapshot,
  ): readonly CandidateWorkspaceReconciliationEntry[] {
    const authority = decodeCandidateWorkspaceAuthoritySnapshot(rawAuthority);
    this.#assertAuthoritySnapshotAdmission(authority);
    const expected = expectedAuthorityMap(authority);
    this.#activeCleanupGrants.clear();
    this.#reconciliationAuthority = authority;
    if (!this.#initialized) {
      return Object.freeze(
        [...expected.keys()].sort().map((generationId) =>
          Object.freeze({
            candidateRoot: this.#generationRoot(generationId),
            classification: WorkspaceReconciliationClassification.UNSAFE,
            cleanupGrant: null,
            generationId,
            ownershipDigest: null,
            reason: 'authoritative generation has no initialized workspace ownership',
          }),
        ),
      );
    }
    const entries: CandidateWorkspaceReconciliationEntry[] = [];
    const recordedGenerationIds = new Set<string>();
    const recordedLeaves = new Set<string>();
    for (const name of readdirSync(this.#recordRoot).sort()) {
      const path = resolve(this.#recordRoot, name);
      if (!name.endsWith('.json') || lstatSync(path).isSymbolicLink()) {
        entries.push(
          Object.freeze({
            candidateRoot: path,
            classification: WorkspaceReconciliationClassification.UNSAFE,
            cleanupGrant: null,
            generationId: null,
            ownershipDigest: null,
            reason: 'unrecognized or aliased ownership record path',
          }),
        );
        continue;
      }
      try {
        const record = readCandidateOwnershipRecord(path);
        if (name !== markerFileName(record.generationId)) {
          throw new TypeError('Ownership filename does not bind its generation');
        }
        recordedGenerationIds.add(record.generationId);
        recordedLeaves.add(record.candidateLeaf);
        entries.push(this.#reconcileRecord(record, expected));
      } catch {
        entries.push(
          Object.freeze({
            candidateRoot: path,
            classification: WorkspaceReconciliationClassification.UNSAFE,
            cleanupGrant: null,
            generationId: null,
            ownershipDigest: null,
            reason: 'ownership record is malformed or misnamed',
          }),
        );
      }
    }
    for (const name of readdirSync(this.#candidateRoot).sort()) {
      if (!recordedLeaves.has(name)) {
        entries.push(
          Object.freeze({
            candidateRoot: resolve(this.#candidateRoot, name),
            classification: WorkspaceReconciliationClassification.UNSAFE,
            cleanupGrant: null,
            generationId: null,
            ownershipDigest: null,
            reason: 'Candidate leaf has no valid external ownership record',
          }),
        );
      }
    }
    for (const name of readdirSync(this.#stagingRoot).sort()) {
      entries.push(
        Object.freeze({
          candidateRoot: resolve(this.#stagingRoot, name),
          classification: WorkspaceReconciliationClassification.UNSAFE,
          cleanupGrant: null,
          generationId: null,
          ownershipDigest: null,
          reason: 'partial staging path requires explicit recovery handling',
        }),
      );
    }
    for (const generationId of expected.keys()) {
      if (!recordedGenerationIds.has(generationId)) {
        entries.push(
          Object.freeze({
            candidateRoot: this.#generationRoot(generationId),
            classification: WorkspaceReconciliationClassification.UNSAFE,
            cleanupGrant: null,
            generationId,
            ownershipDigest: null,
            reason: 'authoritative generation has no valid ownership record',
          }),
        );
      }
    }
    return Object.freeze(
      entries
        .sort((left, right) => left.candidateRoot.localeCompare(right.candidateRoot))
        .map((entry) =>
          entry.classification === WorkspaceReconciliationClassification.OWNED_ORPHANED
            ? Object.freeze({
                ...entry,
                cleanupGrant: this.#issueCleanupGrant(authority, entry),
              })
            : entry,
        ),
    );
  }

  public cleanupOrphanedGeneration(
    rawGrant: CandidateWorkspaceCleanupGrant,
  ): CandidateWorkspaceCleanupResult {
    const grant = decodeCandidateWorkspaceCleanupGrant(rawGrant);
    const authority = this.#reconciliationAuthority;
    const activeGrant = this.#activeCleanupGrants.get(grant.id);
    if (
      authority === undefined ||
      activeGrant?.grantDigest !== grant.grantDigest ||
      grant.authorityDigest !== authority.authorityDigest ||
      grant.authoritySequence !== authority.authoritySequence ||
      grant.authoritySnapshotId !== authority.id ||
      grant.workspaceRootIdentity !== this.workspaceRootIdentity
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.CLEANUP_NOT_AUTHORIZED,
        'Cleanup grant is stale or was not issued by the current reconciliation',
      );
    }
    const expected = expectedAuthorityMap(authority);
    const generationId = grant.generationId;
    if (expected.has(generationId)) {
      fail(
        LocalCandidateWorkspaceFailureCode.CLEANUP_NOT_AUTHORIZED,
        'Current or retained generations cannot be cleaned up',
      );
    }
    const record = this.#readRecord(generationId);
    if (
      record.recordDigest !== grant.ownershipDigest ||
      record.candidateRootIdentity !== grant.candidateRoot ||
      record.activeLeases.length !== 0
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.CLEANUP_NOT_AUTHORIZED,
        'Cleanup request does not bind an exact unleased owned leaf',
      );
    }
    const reconciled = this.#reconcileRecord(record, expected);
    if (
      reconciled.classification !== WorkspaceReconciliationClassification.OWNED_ORPHANED ||
      reconciled.candidateRoot !== grant.candidateRoot ||
      dirname(grant.candidateRoot) !== this.#candidateRoot
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.CLEANUP_NOT_AUTHORIZED,
        'Cleanup target is not one exact safe orphaned Candidate leaf',
      );
    }
    const stat = lstatSync(grant.candidateRoot);
    if (stat.isSymbolicLink() || realpathSync(grant.candidateRoot) !== grant.candidateRoot) {
      fail(
        LocalCandidateWorkspaceFailureCode.CLEANUP_NOT_AUTHORIZED,
        'Cleanup target became aliased',
      );
    }
    makeTreeRemovable(grant.candidateRoot);
    rmSync(grant.candidateRoot, { recursive: true });
    unlinkSync(this.#recordPath(generationId));
    fsyncDirectory(this.#candidateRoot);
    fsyncDirectory(this.#recordRoot);
    this.#activeCleanupGrants.delete(grant.id);
    return Object.freeze({
      candidateRoot: grant.candidateRoot,
      generationId,
      status: 'REMOVED',
    });
  }
}

export function createLocalCandidateWorkspaceInternal(
  options: LocalCandidateWorkspaceOptions,
  hooks: CandidateWorkspaceFaultHooks,
): LocalCandidateWorkspace {
  return new LocalCandidateWorkspaceAdapter(options, hooks);
}

export function createLocalCandidateWorkspace(
  options: LocalCandidateWorkspaceOptions,
): LocalCandidateWorkspace {
  return createLocalCandidateWorkspaceInternal(options, Object.freeze({}));
}
