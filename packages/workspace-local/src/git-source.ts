import { execFileSync } from 'node:child_process';
import { lstatSync, realpathSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  digestCandidateWorkspaceValue,
  decodeProjectReadSnapshotGitState,
  digestProjectReadWorkspaceValue,
  decodeProjectReadSnapshotSourceTree,
  type ProjectReadSnapshotMaterializationRequest,
} from '@codeclosure/runtime';

import {
  DEFAULT_CANDIDATE_WORKSPACE_BOUNDS,
  LocalCandidateWorkspaceError,
  LocalCandidateWorkspaceFailureCode,
  type CandidateWorkspaceBounds,
  type LocalCandidateSourceIdentity,
} from './contracts.js';
import {
  assertPortablePathSet,
  assertRealDirectory,
  createTreeManifestFromPaths,
  decodeNulPaths,
  digestBytes,
  isSameOrWithin,
  validateGitCommit,
  type CandidateSourceGitMetadata,
  type CandidateSourceSnapshot,
} from './manifests.js';

const gitEnvironment = Object.freeze({
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_OPTIONAL_LOCKS: '0',
  GIT_TERMINAL_PROMPT: '0',
  LANG: 'C',
  LC_ALL: 'C',
  PATH: process.env['PATH'] ?? '/usr/bin:/bin',
});

function git(root: string, arguments_: readonly string[], maximumBytes: number): Buffer {
  try {
    return execFileSync('git', arguments_, {
      cwd: root,
      encoding: 'buffer',
      env: gitEnvironment,
      maxBuffer: maximumBytes,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.GIT_INVOCATION_FAILED,
      'The bounded Git source query failed',
    );
  }
}

function text(bytes: Buffer, field: string): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes).trim();
  } catch {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
      `${field} was not valid UTF-8`,
    );
  }
}

function trackedModes(root: string, maximumBytes: number): ReadonlyMap<string, string> {
  const records = decodeNulPaths(
    git(root, ['ls-files', '--stage', '-z', '--'], maximumBytes),
    'Git staged index',
  );
  const result = new Map<string, string>();
  for (const record of records) {
    const match = /^(\d{6}) [0-9a-f]{40,64} ([0-3])\t([\s\S]+)$/u.exec(record);
    const mode = match?.[1];
    const stage = match?.[2];
    const path = match?.[3];
    if (mode === undefined || stage === undefined || path === undefined) {
      throw new LocalCandidateWorkspaceError(
        LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
        'Git staged index contains an unsupported record',
      );
    }
    if (stage !== '0') {
      throw new LocalCandidateWorkspaceError(
        LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
        'Unmerged Git index stages are outside the bounded M2 source profile',
      );
    }
    if (mode === '160000' || mode === '120000') {
      throw new LocalCandidateWorkspaceError(
        LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
        'Gitlinks and symbolic links are not supported by the M2 source profile',
      );
    }
    if (mode !== '100644' && mode !== '100755') {
      throw new LocalCandidateWorkspaceError(
        LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
        'The Git index contains an unsupported entry mode',
      );
    }
    result.set(path, mode);
  }
  return result;
}

function selectedExistingPaths(root: string, bounds: CandidateWorkspaceBounds): readonly string[] {
  const maximumGitBytes = Math.max(bounds.maximumTotalBytes, 1024 * 1024);
  const modes = trackedModes(root, maximumGitBytes);
  const rawPaths = decodeNulPaths(
    git(
      root,
      ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--'],
      maximumGitBytes,
    ),
    'Git selected paths',
  );
  const paths = [...new Set(rawPaths)].sort();
  assertPortablePathSet(paths, bounds.maximumPathBytes);
  const existing = paths.filter((path) => {
    try {
      const stat = lstatSync(resolve(root, path));
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new LocalCandidateWorkspaceError(
          LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
          'Selected Git entries must be regular files',
        );
      }
      return true;
    } catch (error) {
      if (
        error instanceof LocalCandidateWorkspaceError ||
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'ENOENT'
      ) {
        throw error;
      }
      return false;
    }
  });
  for (const path of existing) {
    const indexedMode = modes.get(path);
    if (indexedMode === '120000' || indexedMode === '160000') {
      throw new LocalCandidateWorkspaceError(
        LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
        'Selected Git entries include an unsupported link or submodule',
      );
    }
  }
  return Object.freeze(existing);
}

function assertSupportedWorkingTreeEntries(root: string, bounds: CandidateWorkspaceBounds): void {
  const pending = [''];
  let observedEntries = 0;
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    const directory = current.length === 0 ? root : resolve(root, current);
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (current.length === 0 && entry.name === '.git') {
        continue;
      }
      const path = current.length === 0 ? entry.name : `${current}/${entry.name}`;
      observedEntries += 1;
      if (observedEntries > bounds.maximumFileCount * 4) {
        throw new LocalCandidateWorkspaceError(
          LocalCandidateWorkspaceFailureCode.BOUNDS_EXCEEDED,
          'The source working tree exceeds the bounded entry profile',
        );
      }
      if (entry.name.toLowerCase() === '.git') {
        throw new LocalCandidateWorkspaceError(
          LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
          'Nested Git control paths are outside the bounded M2 profile',
        );
      }
      const stat = lstatSync(resolve(root, path));
      if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
        throw new LocalCandidateWorkspaceError(
          LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
          'The source working tree contains a link or special entry',
        );
      }
      if (stat.isDirectory()) {
        pending.push(path);
      }
    }
  }
}

function gitMetadata(
  root: string,
  paths: readonly string[],
  maximumGitBytes: number,
): CandidateSourceGitMetadata {
  const topLevel = assertRealDirectory(
    text(git(root, ['rev-parse', '--show-toplevel'], maximumGitBytes), 'Git top-level'),
    'Git top-level',
  );
  if (topLevel !== root) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
      'The M2 source path must be the exact Git checkout root',
    );
  }
  const commonDirectory = assertRealDirectory(
    text(
      git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'], maximumGitBytes),
      'Git common directory',
    ),
    'Git common directory',
  );
  if (!isSameOrWithin(commonDirectory, root)) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
      'Linked worktrees with external Git control data are outside the bounded M2 profile',
    );
  }
  const headCommit = validateGitCommit(
    text(git(root, ['rev-parse', '--verify', 'HEAD'], maximumGitBytes), 'Git HEAD'),
  );
  const stagedIndexBytes = git(root, ['ls-files', '--stage', '-z', '--'], maximumGitBytes);
  const porcelainBytes = git(
    root,
    ['status', '--porcelain=v2', '-z', '--untracked-files=all', '--no-renames'],
    maximumGitBytes,
  );
  const projection = {
    gitCommonDirectory: commonDirectory,
    headCommit,
    porcelainV2Digest: digestBytes(porcelainBytes),
    profile: 'candidate-source-git-v1',
    schemaVersion: 1,
    selectedPathSetDigest: digestCandidateWorkspaceValue({ paths }),
    sourceProjectRoot: root,
    stagedIndexManifestDigest: digestBytes(stagedIndexBytes),
  } as const;
  return Object.freeze({ ...projection, digest: digestCandidateWorkspaceValue(projection) });
}

export function resolveSourceRoot(projectPath: string): string {
  const root = assertRealDirectory(projectPath, 'Source project root');
  const dotGit = resolve(root, '.git');
  let stat;
  try {
    stat = lstatSync(dotGit);
  } catch {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
      'The source project must have local Git control data and one HEAD',
    );
  }
  if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
      'The source Git control entry is unsupported',
    );
  }
  return realpathSync(root);
}

export function captureSourceSnapshot(
  sourceRoot: string,
  bounds: CandidateWorkspaceBounds,
): CandidateSourceSnapshot {
  assertSupportedWorkingTreeEntries(sourceRoot, bounds);
  const paths = selectedExistingPaths(sourceRoot, bounds);
  const tree = createTreeManifestFromPaths(sourceRoot, paths, 'candidate-source-tree-v1', bounds);
  const maximumGitBytes = Math.max(bounds.maximumTotalBytes, 1024 * 1024);
  return Object.freeze({
    tree,
    git: gitMetadata(sourceRoot, paths, maximumGitBytes),
  });
}

type ProjectReadSourceTree = ProjectReadSnapshotMaterializationRequest['sourceTree'];
type ProjectReadGitState = ProjectReadSnapshotMaterializationRequest['gitState'];

export interface LocalProjectReadSourceSnapshot {
  readonly sourceTree: ProjectReadSourceTree;
  readonly gitState: ProjectReadGitState;
}

export function projectReadSourceSnapshotFromCandidateSnapshot(
  snapshot: CandidateSourceSnapshot,
): LocalProjectReadSourceSnapshot {
  const sourceTreeWithoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    profile: 'codeclosure-project-read-source-tree-v1' as const,
    entries: Object.freeze(
      snapshot.tree.entries.map((entry) =>
        Object.freeze({
          schemaVersion: 1 as const,
          path: entry.path,
          mode: entry.mode,
          size: entry.size,
          contentDigest: entry.contentDigest,
        }),
      ),
    ),
    fileCount: snapshot.tree.fileCount,
    totalBytes: snapshot.tree.totalBytes,
  });
  const sourceTree = decodeProjectReadSnapshotSourceTree({
    ...sourceTreeWithoutDigest,
    projectionDigest: digestProjectReadWorkspaceValue(sourceTreeWithoutDigest),
  });
  const gitStateWithoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    profile: 'codeclosure-project-read-git-state-v1' as const,
    sourceProjectRoot: snapshot.git.sourceProjectRoot,
    repositoryControlRootIdentity: snapshot.git.gitCommonDirectory,
    headCommit: snapshot.git.headCommit,
    selectedPathSetDigest: snapshot.git.selectedPathSetDigest,
    stagedIndexManifestDigest: snapshot.git.stagedIndexManifestDigest,
    porcelainV2Digest: snapshot.git.porcelainV2Digest,
  });
  const gitState = decodeProjectReadSnapshotGitState({
    ...gitStateWithoutDigest,
    projectionDigest: digestProjectReadWorkspaceValue(gitStateWithoutDigest),
  });
  return Object.freeze({ sourceTree, gitState });
}

export function captureProjectReadSourceSnapshotFromRoot(
  sourceRootValue: string,
  bounds: CandidateWorkspaceBounds,
): LocalProjectReadSourceSnapshot {
  const sourceRoot = resolveSourceRoot(sourceRootValue);
  return projectReadSourceSnapshotFromCandidateSnapshot(captureSourceSnapshot(sourceRoot, bounds));
}

export function captureProjectReadSourceSnapshot(
  request: ProjectReadSnapshotMaterializationRequest,
  bounds: CandidateWorkspaceBounds,
): LocalProjectReadSourceSnapshot {
  const sourceRoot = resolveSourceRoot(request.resolvedProjectRoot);
  if (sourceRoot !== request.resolvedProjectRoot) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
      'Project-read source root does not match its exact resolved identity',
    );
  }
  const snapshot = captureProjectReadSourceSnapshotFromRoot(sourceRoot, bounds);
  const selectedPaths = snapshot.sourceTree.entries.map((entry) => entry.path);
  const expectedPaths = request.sourceTree.entries.map((entry) => entry.path);
  if (JSON.stringify(selectedPaths) !== JSON.stringify(expectedPaths)) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT,
      'Project-read selected source paths do not match the admitted projection',
    );
  }
  return snapshot;
}

export function assertProjectReadSourceSnapshotMatchesRequest(
  snapshot: LocalProjectReadSourceSnapshot,
  request: ProjectReadSnapshotMaterializationRequest,
): void {
  if (
    JSON.stringify(snapshot.sourceTree) !== JSON.stringify(request.sourceTree) ||
    JSON.stringify(snapshot.gitState) !== JSON.stringify(request.gitState)
  ) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT,
      'Project-read source tree or Git state differs from the admitted projection',
    );
  }
}

export function observeLocalCandidateSourceIdentity(
  projectPath: string,
): LocalCandidateSourceIdentity {
  const snapshot = captureSourceSnapshot(
    resolveSourceRoot(projectPath),
    DEFAULT_CANDIDATE_WORKSPACE_BOUNDS,
  );
  return Object.freeze({
    schemaVersion: 1,
    sourceGitMetadataDigest: snapshot.git.digest,
    sourceTreeDigest: snapshot.tree.digest,
  });
}
