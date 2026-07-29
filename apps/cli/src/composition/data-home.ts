import {
  chmodSync,
  closeSync,
  lstatSync,
  mkdirSync,
  openSync,
  realpathSync,
  statSync,
  type Stats,
} from 'node:fs';
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  parse,
  relative,
  resolve,
  sep,
  posix,
  win32,
} from 'node:path';

export const ProtectedPathKind = {
  CANDIDATE: 'CANDIDATE',
  PROJECT: 'PROJECT',
} as const;
export type ProtectedPathKind = (typeof ProtectedPathKind)[keyof typeof ProtectedPathKind];

export interface ProtectedPathInput {
  readonly kind: ProtectedPathKind;
  readonly path: string;
}

export const ProtectedPathIdentityState = {
  EXISTING: 'EXISTING',
  PLANNED: 'PLANNED',
} as const;
export type ProtectedPathIdentityState =
  (typeof ProtectedPathIdentityState)[keyof typeof ProtectedPathIdentityState];

export interface PreparedProtectedPath {
  readonly kind: ProtectedPathKind;
  readonly path: string;
  readonly realPath: string;
  /** Existing target for EXISTING, nearest existing ancestor for PLANNED. */
  readonly identityPath: string;
  readonly identityState: ProtectedPathIdentityState;
  readonly missingSegments: readonly string[];
  readonly device: number;
  readonly inode: number;
}

export interface PreparedCodeClosureDataHome {
  readonly path: string;
  readonly realPath: string;
  readonly databasePath: string;
  readonly device: number;
  readonly inode: number;
  readonly protectedPaths: readonly PreparedProtectedPath[];
}

export interface PreparedCodeClosureStateDatabase {
  readonly path: string;
  readonly device: number;
  readonly inode: number;
}

export interface CodeClosureDataHomePathOptions {
  readonly platform: NodeJS.Platform;
  readonly environment: Readonly<Record<string, string | undefined>>;
}

export interface PrepareCodeClosureDataHomeOptions {
  readonly path: string;
  readonly protectedPaths: readonly ProtectedPathInput[];
  readonly expectedUserId?: number;
}

export interface PrepareCodeClosureAuthorityIsolationLeaseOptions {
  readonly preparedHome: PreparedCodeClosureDataHome;
  readonly preparedDatabase: PreparedCodeClosureStateDatabase;
  /** Paths discovered from retained authority after SQLite denial-only inspection. */
  readonly discoveredProtectedPaths: readonly ProtectedPathInput[];
  /** Exact invocation-supplied project paths that may be admitted by CreateGoal. */
  readonly allowedProjectPaths: readonly string[];
  readonly expectedUserId?: number;
}

export interface CodeClosureAuthorityIsolationLease {
  assertCurrent(): void;
  assertProjectPathAllowed(projectPath: string): void;
}

function platformPath(platform: NodeJS.Platform): typeof posix {
  if (platform === 'win32') {
    return win32;
  }
  if (platform === 'darwin' || platform === 'linux') {
    return posix;
  }
  throw new TypeError(`Unsupported CodeClosure data-home platform: ${platform}`);
}

function requiredAbsolutePath(
  value: string | undefined,
  name: string,
  pathApi: typeof posix,
): string {
  if (value === undefined || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty absolute path`);
  }
  if (!pathApi.isAbsolute(value)) {
    throw new TypeError(`${name} must be an absolute path`);
  }
  const normalized = pathApi.normalize(value);
  if (normalized === pathApi.parse(normalized).root) {
    throw new TypeError(`${name} must not be a filesystem root`);
  }
  return normalized;
}

export function resolveCodeClosureDataHomePath(options: CodeClosureDataHomePathOptions): string {
  const pathApi = platformPath(options.platform);
  const override = options.environment['CODECLOSURE_HOME'];
  if (override !== undefined) {
    return requiredAbsolutePath(override, 'CODECLOSURE_HOME', pathApi);
  }

  switch (options.platform) {
    case 'darwin': {
      const home = requiredAbsolutePath(options.environment['HOME'], 'HOME', pathApi);
      return pathApi.join(home, 'Library', 'Application Support', 'CodeClosure');
    }
    case 'linux': {
      const xdgDataHome = options.environment['XDG_DATA_HOME'];
      if (xdgDataHome !== undefined && xdgDataHome.trim().length > 0) {
        return pathApi.join(
          requiredAbsolutePath(xdgDataHome, 'XDG_DATA_HOME', pathApi),
          'codeclosure',
        );
      }
      const home = requiredAbsolutePath(options.environment['HOME'], 'HOME', pathApi);
      return pathApi.join(home, '.local', 'share', 'codeclosure');
    }
    case 'win32': {
      const localAppData = requiredAbsolutePath(
        options.environment['LOCALAPPDATA'],
        'LOCALAPPDATA',
        pathApi,
      );
      return pathApi.join(localAppData, 'CodeClosure');
    }
    default:
      throw new TypeError(`Unsupported CodeClosure data-home platform: ${options.platform}`);
  }
}

function isMissingPathError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && Reflect.get(error, 'code') === 'ENOENT';
}

function optionalLstat(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isMissingPathError(error)) {
      return undefined;
    }
    throw error;
  }
}

interface PlannedFilesystemIdentity {
  readonly realPath: string;
  readonly identityPath: string;
  readonly missingSegments: readonly string[];
  readonly stats: Stats;
}

function plannedFilesystemIdentity(path: string): PlannedFilesystemIdentity {
  let existingAncestor = path;
  const missingSegments: string[] = [];
  while (optionalLstat(existingAncestor) === undefined) {
    const parent = dirname(existingAncestor);
    if (parent === existingAncestor) {
      throw new TypeError(`No existing ancestor can establish filesystem identity for ${path}`);
    }
    missingSegments.unshift(basename(existingAncestor));
    existingAncestor = parent;
  }
  const realAncestor = realpathSync.native(existingAncestor);
  const stats = statSync(realAncestor);
  if (!stats.isDirectory()) {
    throw new TypeError(`Existing ancestor cannot establish directory identity for ${path}`);
  }
  return Object.freeze({
    realPath: resolve(realAncestor, ...missingSegments),
    identityPath: realAncestor,
    missingSegments: Object.freeze(missingSegments),
    stats,
  });
}

function plannedRealPath(path: string): string {
  return plannedFilesystemIdentity(path).realPath;
}

function isWithin(candidate: string, root: string): boolean {
  const path = relative(root, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function validateProtectedPathKind(kind: string): asserts kind is ProtectedPathKind {
  if (kind !== ProtectedPathKind.PROJECT && kind !== ProtectedPathKind.CANDIDATE) {
    throw new TypeError(`Unsupported protected-path kind: ${kind}`);
  }
}

function prepareProtectedPath(input: ProtectedPathInput): PreparedProtectedPath {
  validateProtectedPathKind(input.kind);
  if (input.path.trim().length === 0 || !isAbsolute(input.path)) {
    throw new TypeError(`${input.kind} protected path must be absolute`);
  }
  const path = normalizedCurrentPlatformPath(input.path, `${input.kind} protected path`);
  const entry = optionalLstat(path);
  if (entry === undefined) {
    if (input.kind !== ProtectedPathKind.PROJECT) {
      throw new TypeError(`${input.kind} protected path must identify an existing directory`);
    }
    const planned = plannedFilesystemIdentity(path);
    return Object.freeze({
      kind: input.kind,
      path,
      realPath: planned.realPath,
      identityPath: planned.identityPath,
      identityState: ProtectedPathIdentityState.PLANNED,
      missingSegments: planned.missingSegments,
      device: planned.stats.dev,
      inode: planned.stats.ino,
    });
  }
  const realPath = realpathSync.native(path);
  const stats = statSync(realPath);
  if (!stats.isDirectory()) {
    throw new TypeError(`${input.kind} protected path must identify a directory`);
  }
  return Object.freeze({
    kind: input.kind,
    path,
    realPath,
    identityPath: realPath,
    identityState: ProtectedPathIdentityState.EXISTING,
    missingSegments: Object.freeze([]),
    device: stats.dev,
    inode: stats.ino,
  });
}

function assertPreparedProtectedPath(prepared: PreparedProtectedPath): PreparedProtectedPath {
  const current = prepareProtectedPath(prepared);
  if (
    current.realPath !== prepared.realPath ||
    current.identityPath !== prepared.identityPath ||
    current.identityState !== prepared.identityState ||
    current.device !== prepared.device ||
    current.inode !== prepared.inode ||
    current.missingSegments.length !== prepared.missingSegments.length ||
    current.missingSegments.some((segment, index) => segment !== prepared.missingSegments[index])
  ) {
    throw new TypeError(
      `${prepared.kind} protected-path identity changed before or during Store use: ${prepared.path}`,
    );
  }
  return current;
}

function assertNoProtectedOverlap(
  homeRealPath: string,
  protectedPaths: readonly PreparedProtectedPath[],
): void {
  for (const protectedPath of protectedPaths) {
    if (isWithin(homeRealPath, protectedPath.realPath)) {
      throw new TypeError(
        `CodeClosure data home must not equal or be nested inside ${protectedPath.kind.toLowerCase()} path ${protectedPath.realPath}`,
      );
    }
  }
}

function currentUserId(): number | undefined {
  return typeof process.getuid === 'function' ? process.getuid() : undefined;
}

function assertOwnerOnlyDirectory(
  path: string,
  stats: Stats,
  expectedUserId: number | undefined,
): void {
  if (!stats.isDirectory()) {
    throw new TypeError(`CodeClosure data home is not a directory: ${path}`);
  }
  if (process.platform === 'win32') {
    return;
  }
  if (expectedUserId !== undefined && stats.uid !== expectedUserId) {
    throw new TypeError(`CodeClosure data home is not owned by the current user: ${path}`);
  }
  const permissions = stats.mode & 0o777;
  if (permissions !== 0o700) {
    throw new TypeError(`CodeClosure data home must have owner-only 0700 permissions: ${path}`);
  }
}

function assertOwnerOnlyDatabaseFile(
  path: string,
  stats: Stats,
  expectedUserId: number | undefined,
): void {
  if (!stats.isFile()) {
    throw new TypeError(`CodeClosure state database is not a regular file: ${path}`);
  }
  if (stats.nlink !== 1) {
    throw new TypeError(`CodeClosure state database must not have hard-link aliases: ${path}`);
  }
  if (process.platform === 'win32') {
    return;
  }
  if (expectedUserId !== undefined && stats.uid !== expectedUserId) {
    throw new TypeError(`CodeClosure state database is not owned by the current user: ${path}`);
  }
  const permissions = stats.mode & 0o777;
  if (permissions !== 0o600) {
    throw new TypeError(
      `CodeClosure state database must have owner-only 0600 permissions: ${path}`,
    );
  }
}

function normalizedCurrentPlatformPath(path: string, name: string): string {
  if (path.trim().length === 0 || !isAbsolute(path)) {
    throw new TypeError(`${name} must be an absolute path`);
  }
  const normalized = normalize(resolve(path));
  if (normalized === parse(normalized).root) {
    throw new TypeError(`${name} must not be a filesystem root`);
  }
  return normalized;
}

export function prepareCodeClosureDataHome(
  options: PrepareCodeClosureDataHomeOptions,
): PreparedCodeClosureDataHome {
  const path = normalizedCurrentPlatformPath(options.path, 'CodeClosure data home');
  const existing = optionalLstat(path);
  if (existing?.isSymbolicLink() === true) {
    throw new TypeError(`CodeClosure data home must not itself be a symbolic link: ${path}`);
  }
  if (existing !== undefined && !existing.isDirectory()) {
    throw new TypeError(`CodeClosure data home is not a directory: ${path}`);
  }
  const protectedPaths = Object.freeze(options.protectedPaths.map(prepareProtectedPath));
  const expectedRealPath = plannedRealPath(path);
  assertNoProtectedOverlap(expectedRealPath, protectedPaths);

  if (existing === undefined) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') {
      chmodSync(path, 0o700);
    }
  }

  const finalEntry = lstatSync(path);
  if (finalEntry.isSymbolicLink()) {
    throw new TypeError(`CodeClosure data home became a symbolic link: ${path}`);
  }
  const realPath = realpathSync.native(path);
  if (realPath !== expectedRealPath) {
    throw new TypeError(`CodeClosure data-home identity changed while it was prepared: ${path}`);
  }
  assertNoProtectedOverlap(realPath, protectedPaths);
  const stats = statSync(realPath);
  assertOwnerOnlyDirectory(realPath, stats, options.expectedUserId ?? currentUserId());

  return Object.freeze({
    path,
    realPath,
    databasePath: join(realPath, 'state.sqlite'),
    device: stats.dev,
    inode: stats.ino,
    protectedPaths,
  });
}

export function assertPreparedCodeClosureDataHome(
  prepared: PreparedCodeClosureDataHome,
  expectedUserId: number | undefined = currentUserId(),
): void {
  const path = normalizedCurrentPlatformPath(prepared.path, 'Prepared CodeClosure data home');
  const entry = lstatSync(path);
  if (entry.isSymbolicLink()) {
    throw new TypeError(`Prepared CodeClosure data home became a symbolic link: ${path}`);
  }
  const realPath = realpathSync.native(path);
  const stats = statSync(realPath);
  if (
    realPath !== prepared.realPath ||
    stats.dev !== prepared.device ||
    stats.ino !== prepared.inode ||
    prepared.databasePath !== join(realPath, 'state.sqlite')
  ) {
    throw new TypeError(
      `Prepared CodeClosure data-home identity changed before or during Store use: ${path}`,
    );
  }
  assertOwnerOnlyDirectory(realPath, stats, expectedUserId);

  const protectedPaths = prepared.protectedPaths.map(assertPreparedProtectedPath);
  assertNoProtectedOverlap(realPath, protectedPaths);
}

export function prepareCodeClosureStateDatabase(
  preparedHome: PreparedCodeClosureDataHome,
  expectedUserId: number | undefined = currentUserId(),
): PreparedCodeClosureStateDatabase {
  assertPreparedCodeClosureDataHome(preparedHome, expectedUserId);
  const databasePath = preparedHome.databasePath;
  const existing = optionalLstat(databasePath);
  if (existing?.isSymbolicLink() === true) {
    throw new TypeError(`CodeClosure state database must not be a symbolic link: ${databasePath}`);
  }
  if (existing === undefined) {
    const descriptor = openSync(databasePath, 'wx', 0o600);
    try {
      if (process.platform !== 'win32') {
        chmodSync(databasePath, 0o600);
      }
    } finally {
      closeSync(descriptor);
    }
  }

  const finalEntry = lstatSync(databasePath);
  if (finalEntry.isSymbolicLink()) {
    throw new TypeError(`CodeClosure state database became a symbolic link: ${databasePath}`);
  }
  const realPath = realpathSync.native(databasePath);
  if (realPath !== databasePath || dirname(realPath) !== preparedHome.realPath) {
    throw new TypeError(
      `CodeClosure state database escaped its prepared data home: ${databasePath}`,
    );
  }
  const stats = statSync(realPath);
  assertOwnerOnlyDatabaseFile(realPath, stats, expectedUserId);
  return Object.freeze({ path: realPath, device: stats.dev, inode: stats.ino });
}

export function assertPreparedCodeClosureStateDatabase(
  preparedHome: PreparedCodeClosureDataHome,
  preparedDatabase: PreparedCodeClosureStateDatabase,
  expectedUserId: number | undefined = currentUserId(),
): void {
  assertPreparedCodeClosureDataHome(preparedHome, expectedUserId);
  if (preparedDatabase.path !== preparedHome.databasePath) {
    throw new TypeError('Prepared CodeClosure state database does not belong to the data home');
  }
  const entry = lstatSync(preparedDatabase.path);
  if (entry.isSymbolicLink()) {
    throw new TypeError(
      `Prepared CodeClosure state database became a symbolic link: ${preparedDatabase.path}`,
    );
  }
  const realPath = realpathSync.native(preparedDatabase.path);
  const stats = statSync(realPath);
  if (
    realPath !== preparedDatabase.path ||
    dirname(realPath) !== preparedHome.realPath ||
    stats.dev !== preparedDatabase.device ||
    stats.ino !== preparedDatabase.inode
  ) {
    throw new TypeError(
      `Prepared CodeClosure state-database identity changed before or during Store open: ${preparedDatabase.path}`,
    );
  }
  assertOwnerOnlyDatabaseFile(realPath, stats, expectedUserId);
}

function protectedPathKey(input: ProtectedPathInput): string {
  return `${input.kind}\u0000${normalizedCurrentPlatformPath(
    input.path,
    `${input.kind} protected path`,
  )}`;
}

/**
 * Binds the filesystem facts used by verified SQLite activation. The returned
 * object grants no Workflow authority; it can only keep denying use after an
 * identity changes.
 */
export function prepareCodeClosureAuthorityIsolationLease(
  options: PrepareCodeClosureAuthorityIsolationLeaseOptions,
): CodeClosureAuthorityIsolationLease {
  const expectedUserId = options.expectedUserId ?? currentUserId();
  assertPreparedCodeClosureStateDatabase(
    options.preparedHome,
    options.preparedDatabase,
    expectedUserId,
  );

  const protectedPathsByKey = new Map<string, PreparedProtectedPath>();
  for (const prepared of options.preparedHome.protectedPaths) {
    protectedPathsByKey.set(protectedPathKey(prepared), assertPreparedProtectedPath(prepared));
  }
  for (const input of options.discoveredProtectedPaths) {
    const key = protectedPathKey(input);
    if (!protectedPathsByKey.has(key)) {
      protectedPathsByKey.set(key, prepareProtectedPath(input));
    }
  }
  const protectedPaths = Object.freeze([...protectedPathsByKey.values()]);
  assertNoProtectedOverlap(options.preparedHome.realPath, protectedPaths);

  const verifiedProjectPaths = new Set(
    protectedPaths
      .filter((path) => path.kind === ProtectedPathKind.PROJECT)
      .map((path) => path.path),
  );
  const allowedProjectPaths = new Set<string>();
  for (const rawPath of options.allowedProjectPaths) {
    const path = normalizedCurrentPlatformPath(rawPath, 'Allowed CreateGoal project path');
    if (path !== rawPath) {
      throw new TypeError('Allowed CreateGoal project path must already be normalized');
    }
    if (!verifiedProjectPaths.has(path)) {
      throw new TypeError(
        `Allowed CreateGoal project path was not part of verified isolation: ${path}`,
      );
    }
    allowedProjectPaths.add(path);
  }

  const assertCurrent = (): void => {
    assertPreparedCodeClosureStateDatabase(
      options.preparedHome,
      options.preparedDatabase,
      expectedUserId,
    );
    const currentProtectedPaths = protectedPaths.map(assertPreparedProtectedPath);
    assertNoProtectedOverlap(options.preparedHome.realPath, currentProtectedPaths);
  };

  return Object.freeze({
    assertCurrent,
    assertProjectPathAllowed: (rawPath: string): void => {
      const path = normalizedCurrentPlatformPath(rawPath, 'CreateGoal project path');
      if (path !== rawPath || !allowedProjectPaths.has(path)) {
        throw new TypeError(
          `CreateGoal project path was not authorized by this verified invocation: ${rawPath}`,
        );
      }
      assertCurrent();
    },
  });
}
