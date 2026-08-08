import { createHash } from 'node:crypto';
import {
  constants,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  readdirSync,
  closeSync,
} from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { TextDecoder } from 'node:util';

import {
  digestCandidateWorkspaceValue,
  digestProjectReadWorkspaceValue,
  decodeProjectReadSnapshotSourceTree,
  type ProjectReadSnapshotMaterializationRequest,
} from '@codeclosure/runtime';

import {
  LocalCandidateWorkspaceError,
  LocalCandidateWorkspaceFailureCode,
  type CandidateWorkspaceBounds,
} from './contracts.js';

export type CandidateFileMode = 'EXECUTABLE' | 'REGULAR';
export type CandidateTreeManifestProfile =
  'candidate-source-tree-v1' | 'candidate-tree-manifest-v1';

export interface CandidateTreeManifestEntry {
  readonly contentDigest: string;
  readonly mode: CandidateFileMode;
  readonly path: string;
  readonly size: number;
}

export interface CandidateTreeManifest {
  readonly digest: string;
  readonly entries: readonly CandidateTreeManifestEntry[];
  readonly fileCount: number;
  readonly profile: CandidateTreeManifestProfile;
  readonly schemaVersion: 1;
  readonly totalBytes: number;
}

export interface CandidateSourceGitMetadata {
  readonly digest: string;
  readonly gitCommonDirectory: string;
  readonly headCommit: string;
  readonly porcelainV2Digest: string;
  readonly profile: 'candidate-source-git-v1';
  readonly schemaVersion: 1;
  readonly selectedPathSetDigest: string;
  readonly sourceProjectRoot: string;
  readonly stagedIndexManifestDigest: string;
}

export interface CandidateSourceSnapshot {
  readonly git: CandidateSourceGitMetadata;
  readonly tree: CandidateTreeManifest;
}

const portablePathComponentPattern = /^(?![. ]+$)(?!.*[. ]$)[^<>:"\\|?*]+$/u;
const windowsReservedNamePattern = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/iu;
const sha256Pattern = /^sha256:[0-9a-f]{64}$/u;
const gitCommitPattern = /^[0-9a-f]{40,64}$/u;

function fail(code: LocalCandidateWorkspaceFailureCode, message: string): never {
  throw new LocalCandidateWorkspaceError(code, message);
}

export function digestBytes(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    if ((character.codePointAt(0) ?? 0) < 32) {
      return true;
    }
  }
  return false;
}

export function assertPortableRelativePath(path: string, maximumBytes: number): void {
  if (
    path.length === 0 ||
    Buffer.byteLength(path, 'utf8') > maximumBytes ||
    path !== path.normalize('NFC') ||
    isAbsolute(path) ||
    path.includes('\\')
  ) {
    fail(
      LocalCandidateWorkspaceFailureCode.PATH_POLICY_VIOLATION,
      'Candidate path is not a bounded normalized relative path',
    );
  }
  for (const component of path.split('/')) {
    if (
      component.length === 0 ||
      component === '.' ||
      component === '..' ||
      containsControlCharacter(component) ||
      !portablePathComponentPattern.test(component) ||
      windowsReservedNamePattern.test(component) ||
      component.toLowerCase() === '.git' ||
      component.toLowerCase() === '.codeclosure'
    ) {
      fail(
        LocalCandidateWorkspaceFailureCode.PATH_POLICY_VIOLATION,
        'Candidate path contains a reserved or non-portable component',
      );
    }
  }
}

export function assertPortablePathSet(paths: readonly string[], maximumBytes: number): void {
  const aliases = new Map<string, string>();
  for (const path of paths) {
    assertPortableRelativePath(path, maximumBytes);
    const components = path.split('/');
    for (let length = 1; length <= components.length; length += 1) {
      const prefix = components.slice(0, length).join('/');
      const alias = prefix.normalize('NFC').toLowerCase();
      const previous = aliases.get(alias);
      if (previous !== undefined && previous !== prefix) {
        fail(
          LocalCandidateWorkspaceFailureCode.PATH_POLICY_VIOLATION,
          'Candidate paths contain a case or Unicode alias collision',
        );
      }
      aliases.set(alias, prefix);
    }
  }
}

export function isSameOrWithin(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

export function pathsOverlap(left: string, right: string): boolean {
  return isSameOrWithin(left, right) || isSameOrWithin(right, left);
}

export function assertRealDirectory(path: string, field: string): string {
  if (!isAbsolute(path) || path !== path.normalize('NFC')) {
    fail(LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION, `${field} must be absolute`);
  }
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    fail(LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION, `${field} is unavailable`);
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    fail(
      LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
      `${field} must be a real directory`,
    );
  }
  return realpathSync(path);
}

function assertSafeAncestors(root: string, relativePath: string): void {
  let cursor = root;
  for (const component of relativePath.split('/')) {
    cursor = resolve(cursor, component);
    let stat;
    try {
      stat = lstatSync(cursor);
    } catch {
      fail(
        LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT,
        'A selected source path became unavailable',
      );
    }
    if (stat.isSymbolicLink()) {
      fail(
        LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
        'Selected source paths must not contain symbolic links',
      );
    }
  }
}

function boundedFileBytes(
  root: string,
  path: string,
  bounds: CandidateWorkspaceBounds,
): { readonly bytes: Buffer; readonly mode: CandidateFileMode } {
  assertSafeAncestors(root, path);
  const absolutePath = resolve(root, path);
  const realPath = realpathSync(absolutePath);
  if (!isSameOrWithin(realPath, root)) {
    fail(
      LocalCandidateWorkspaceFailureCode.CONTAINMENT_VIOLATION,
      'Selected source path resolves outside its root',
    );
  }
  const stat = lstatSync(absolutePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    fail(
      LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
      'Selected source entries must be regular files',
    );
  }
  if (stat.size > bounds.maximumFileBytes) {
    fail(LocalCandidateWorkspaceFailureCode.BOUNDS_EXCEEDED, 'A selected file exceeds its bound');
  }
  let descriptor: number | undefined;
  try {
    descriptor = openSync(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
    const bytes = Buffer.alloc(stat.size);
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(descriptor, bytes, offset, bytes.length - offset, null);
      if (count === 0) {
        fail(LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT, 'A selected file shrank while read');
      }
      offset += count;
    }
    const extra = Buffer.alloc(1);
    if (readSync(descriptor, extra, 0, 1, null) !== 0) {
      fail(LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT, 'A selected file grew while read');
    }
    const after = lstatSync(absolutePath);
    if (!after.isFile() || after.size !== bytes.byteLength || after.size !== stat.size) {
      fail(LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT, 'A selected file changed while read');
    }
    return Object.freeze({
      bytes,
      mode: (stat.mode & 0o111) === 0 ? 'REGULAR' : 'EXECUTABLE',
    });
  } finally {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
  }
}

function manifestProjection(
  profile: CandidateTreeManifestProfile,
  entries: readonly CandidateTreeManifestEntry[],
  totalBytes: number,
): unknown {
  return {
    entries,
    fileCount: entries.length,
    profile,
    schemaVersion: 1,
    totalBytes,
  };
}

export function createTreeManifestFromPaths(
  root: string,
  paths: readonly string[],
  profile: CandidateTreeManifestProfile,
  bounds: CandidateWorkspaceBounds,
): CandidateTreeManifest {
  const sorted = [...paths].sort();
  if (new Set(sorted).size !== sorted.length || sorted.length > bounds.maximumFileCount) {
    fail(
      LocalCandidateWorkspaceFailureCode.BOUNDS_EXCEEDED,
      'Candidate path count is duplicate or exceeds its bound',
    );
  }
  assertPortablePathSet(sorted, bounds.maximumPathBytes);
  let totalBytes = 0;
  const entries = sorted.map((path) => {
    const file = boundedFileBytes(root, path, bounds);
    totalBytes += file.bytes.byteLength;
    if (totalBytes > bounds.maximumTotalBytes) {
      fail(
        LocalCandidateWorkspaceFailureCode.BOUNDS_EXCEEDED,
        'Candidate bytes exceed the total bound',
      );
    }
    return Object.freeze({
      contentDigest: digestBytes(file.bytes),
      mode: file.mode,
      path,
      size: file.bytes.byteLength,
    });
  });
  const projection = manifestProjection(profile, entries, totalBytes);
  return Object.freeze({
    ...(projection as Omit<CandidateTreeManifest, 'digest'>),
    digest: digestCandidateWorkspaceValue(projection),
  });
}

function walkCandidate(root: string, bounds: CandidateWorkspaceBounds): readonly string[] {
  const paths: string[] = [];
  const pending = [''];
  const logicalEntries: string[] = [];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    const directory = current.length === 0 ? root : resolve(root, current);
    const directoryEntries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    if (current.length > 0 && directoryEntries.length === 0) {
      fail(
        LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
        'Frozen Candidate trees must not retain unrepresented empty directories',
      );
    }
    for (const entry of directoryEntries) {
      const path = current.length === 0 ? entry.name : `${current}/${entry.name}`;
      assertPortableRelativePath(path, bounds.maximumPathBytes);
      logicalEntries.push(path);
      const absolutePath = resolve(root, path);
      const stat = lstatSync(absolutePath);
      if (stat.isSymbolicLink()) {
        fail(
          LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
          'Candidate trees must not contain symbolic links',
        );
      }
      if (stat.isDirectory()) {
        pending.push(path);
      } else if (stat.isFile()) {
        paths.push(path);
      } else {
        fail(
          LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED,
          'Candidate trees must contain only directories and regular files',
        );
      }
    }
  }
  assertPortablePathSet(logicalEntries, bounds.maximumPathBytes);
  return Object.freeze(paths.sort());
}

export function scanCandidateTree(
  root: string,
  bounds: CandidateWorkspaceBounds,
): CandidateTreeManifest {
  const realRoot = assertRealDirectory(root, 'Candidate root');
  return createTreeManifestFromPaths(
    realRoot,
    walkCandidate(realRoot, bounds),
    'candidate-tree-manifest-v1',
    bounds,
  );
}

export function scanProjectReadTree(
  root: string,
  bounds: CandidateWorkspaceBounds,
): ProjectReadSnapshotMaterializationRequest['sourceTree'] {
  const realRoot = assertRealDirectory(root, 'Project-read snapshot root');
  const manifest = createTreeManifestFromPaths(
    realRoot,
    walkCandidate(realRoot, bounds),
    'candidate-tree-manifest-v1',
    bounds,
  );
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    profile: 'codeclosure-project-read-source-tree-v1' as const,
    entries: Object.freeze(
      manifest.entries.map((entry) =>
        Object.freeze({
          schemaVersion: 1 as const,
          path: entry.path,
          mode: entry.mode,
          size: entry.size,
          contentDigest: entry.contentDigest,
        }),
      ),
    ),
    fileCount: manifest.fileCount,
    totalBytes: manifest.totalBytes,
  });
  return decodeProjectReadSnapshotSourceTree({
    ...withoutDigest,
    projectionDigest: digestProjectReadWorkspaceValue(withoutDigest),
  });
}

export function readManifestEntryBytes(
  root: string,
  entry: CandidateTreeManifestEntry,
  bounds: CandidateWorkspaceBounds,
): Buffer {
  const file = boundedFileBytes(root, entry.path, bounds);
  if (
    file.bytes.byteLength !== entry.size ||
    file.mode !== entry.mode ||
    digestBytes(file.bytes) !== entry.contentDigest
  ) {
    fail(LocalCandidateWorkspaceFailureCode.SOURCE_DRIFT, 'Manifest-bound bytes changed');
  }
  return file.bytes;
}

export function decodeNulPaths(bytes: Buffer, field: string): readonly string[] {
  if (bytes.length === 0) {
    return Object.freeze([]);
  }
  if (bytes.at(-1) !== 0) {
    fail(
      LocalCandidateWorkspaceFailureCode.GIT_INVOCATION_FAILED,
      `${field} was not NUL-delimited`,
    );
  }
  const decoder = new TextDecoder('utf-8', { fatal: true });
  const paths: string[] = [];
  let start = 0;
  try {
    for (let index = 0; index < bytes.length; index += 1) {
      if (bytes[index] === 0) {
        const path = decoder.decode(bytes.subarray(start, index));
        if (path.length > 0) {
          paths.push(path);
        }
        start = index + 1;
      }
    }
  } catch {
    fail(
      LocalCandidateWorkspaceFailureCode.PATH_POLICY_VIOLATION,
      `${field} contained a non-UTF-8 path`,
    );
  }
  return Object.freeze(paths);
}

export function validateGitCommit(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (!gitCommitPattern.test(normalized)) {
    fail(LocalCandidateWorkspaceFailureCode.SOURCE_UNSUPPORTED, 'Git HEAD is invalid');
  }
  return normalized;
}

export function assertDigest(value: unknown, field: string): string {
  if (typeof value !== 'string' || !sha256Pattern.test(value)) {
    fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, `${field} is not a SHA-256 digest`);
  }
  return value;
}

export function assertManifest(value: unknown, field: string): CandidateTreeManifest {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, `${field} is not a manifest`);
  }
  const input = value as Record<string, unknown>;
  if (
    JSON.stringify(Object.keys(input).sort()) !==
      JSON.stringify([
        'digest',
        'entries',
        'fileCount',
        'profile',
        'schemaVersion',
        'totalBytes',
      ]) ||
    input['schemaVersion'] !== 1 ||
    (input['profile'] !== 'candidate-source-tree-v1' &&
      input['profile'] !== 'candidate-tree-manifest-v1') ||
    !Array.isArray(input['entries']) ||
    !Number.isSafeInteger(input['fileCount']) ||
    !Number.isSafeInteger(input['totalBytes'])
  ) {
    fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, `${field} shape is invalid`);
  }
  const entries = input['entries'].map((rawEntry, index) => {
    if (typeof rawEntry !== 'object' || rawEntry === null || Array.isArray(rawEntry)) {
      fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, `${field} entry is invalid`);
    }
    const entry = rawEntry as Record<string, unknown>;
    if (
      JSON.stringify(Object.keys(entry).sort()) !==
        JSON.stringify(['contentDigest', 'mode', 'path', 'size']) ||
      typeof entry['path'] !== 'string' ||
      (entry['mode'] !== 'REGULAR' && entry['mode'] !== 'EXECUTABLE') ||
      !Number.isSafeInteger(entry['size']) ||
      Number(entry['size']) < 0
    ) {
      fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, `${field} entry shape is invalid`);
    }
    assertPortableRelativePath(entry['path'], 4_096);
    return Object.freeze({
      contentDigest: assertDigest(entry['contentDigest'], `${field}.entries[${String(index)}]`),
      mode: entry['mode'],
      path: entry['path'],
      size: Number(entry['size']),
    });
  });
  const paths = entries.map((entry) => entry.path);
  if (
    JSON.stringify(paths) !== JSON.stringify([...paths].sort()) ||
    new Set(paths).size !== paths.length ||
    input['fileCount'] !== entries.length ||
    input['totalBytes'] !== entries.reduce((total, entry) => total + entry.size, 0)
  ) {
    fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, `${field} totals or order are invalid`);
  }
  const projection = manifestProjection(input['profile'], entries, input['totalBytes']);
  const digest = assertDigest(input['digest'], `${field}.digest`);
  if (digestCandidateWorkspaceValue(projection) !== digest) {
    fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, `${field} digest is inconsistent`);
  }
  return Object.freeze({
    ...(projection as Omit<CandidateTreeManifest, 'digest'>),
    digest,
  });
}

export function assertGitMetadata(value: unknown): CandidateSourceGitMetadata {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, 'Git metadata is invalid');
  }
  const input = value as Record<string, unknown>;
  const keys = [
    'digest',
    'gitCommonDirectory',
    'headCommit',
    'porcelainV2Digest',
    'profile',
    'schemaVersion',
    'selectedPathSetDigest',
    'sourceProjectRoot',
    'stagedIndexManifestDigest',
  ].sort();
  if (
    JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(keys) ||
    input['schemaVersion'] !== 1 ||
    input['profile'] !== 'candidate-source-git-v1' ||
    typeof input['sourceProjectRoot'] !== 'string' ||
    typeof input['gitCommonDirectory'] !== 'string' ||
    typeof input['headCommit'] !== 'string'
  ) {
    fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, 'Git metadata shape is invalid');
  }
  const projection = {
    gitCommonDirectory: input['gitCommonDirectory'],
    headCommit: validateGitCommit(input['headCommit']),
    porcelainV2Digest: assertDigest(input['porcelainV2Digest'], 'porcelainV2Digest'),
    profile: input['profile'],
    schemaVersion: input['schemaVersion'],
    selectedPathSetDigest: assertDigest(input['selectedPathSetDigest'], 'selectedPathSetDigest'),
    sourceProjectRoot: input['sourceProjectRoot'],
    stagedIndexManifestDigest: assertDigest(
      input['stagedIndexManifestDigest'],
      'stagedIndexManifestDigest',
    ),
  } as const;
  const digest = assertDigest(input['digest'], 'Git metadata digest');
  if (digestCandidateWorkspaceValue(projection) !== digest) {
    fail(LocalCandidateWorkspaceFailureCode.INVALID_RECORD, 'Git metadata digest is inconsistent');
  }
  return Object.freeze({ ...projection, digest });
}
