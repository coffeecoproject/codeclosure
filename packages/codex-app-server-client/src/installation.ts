import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute } from 'node:path';
import process from 'node:process';

import { AppServerClientErrorCode, clientError } from './errors.js';
import { isJsonObject, parseBoundedJson, type JsonObject, type JsonValue } from './strict-json.js';

const verifiedInstallationBrand = Symbol('VerifiedCodexInstallation');
const digestPattern = /^sha256:[0-9a-f]{64}$/u;

export interface BundledCodexProfile {
  readonly architecture: string;
  readonly delegatedExecutableDigest: string;
  readonly delegatedExecutablePath: string;
  readonly launcherDigest: string;
  readonly launcherPath: string;
  readonly launcherRealPath: string;
  readonly platform: string;
  readonly snapshotDigest: string;
  readonly snapshotProfile: 'codex-schema-snapshot-v1';
  readonly targetTriple: string;
  readonly version: string;
}

export interface VerifiedCodexInstallation {
  readonly [verifiedInstallationBrand]: true;
  readonly delegatedExecutablePath: string;
  readonly launcherPath: string;
  readonly profile: BundledCodexProfile;
}

function requiredObject(value: JsonValue | undefined, field: string): JsonObject {
  if (value === undefined || !isJsonObject(value)) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      `Bundled protocol manifest has an invalid ${field}`,
    );
  }
  return value;
}

function requiredString(object: JsonObject, field: string): string {
  const value = object[field];
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      `Bundled protocol manifest has an invalid ${field}`,
    );
  }
  return value;
}

function requiredDigest(object: JsonObject, field: string): string {
  const value = requiredString(object, field);
  if (!digestPattern.test(value)) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      `Bundled protocol manifest has an invalid ${field}`,
    );
  }
  return value;
}

function assertAbsolutePath(path: string, field: string): string {
  if (!isAbsolute(path)) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      `Bundled protocol manifest ${field} is not absolute`,
    );
  }
  return path;
}

function bundledManifestPath(): URL {
  return new URL('../protocol/codex-schema-snapshot-v1.json', import.meta.url);
}

export function loadBundledCodexProfile(): BundledCodexProfile {
  let value: JsonValue;
  try {
    value = parseBoundedJson(readFileSync(bundledManifestPath()), {
      maximumCollectionEntries: 2_000,
      maximumDepth: 16,
      maximumNodes: 10_000,
    });
  } catch {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Bundled protocol manifest cannot be read or validated',
    );
  }
  const manifest = requiredObject(value, 'root');
  if (manifest['schemaVersion'] !== 1) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Bundled protocol manifest schema version is unsupported',
    );
  }
  const snapshotProfile = requiredString(manifest, 'snapshotProfile');
  if (snapshotProfile !== 'codex-schema-snapshot-v1') {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Bundled protocol snapshot profile is unsupported',
    );
  }
  const codex = requiredObject(manifest['codex'], 'codex identity');
  return Object.freeze({
    architecture: requiredString(codex, 'architecture'),
    delegatedExecutableDigest: requiredDigest(codex, 'delegatedExecutableDigest'),
    delegatedExecutablePath: assertAbsolutePath(
      requiredString(codex, 'delegatedExecutablePath'),
      'delegatedExecutablePath',
    ),
    launcherDigest: requiredDigest(codex, 'launcherDigest'),
    launcherPath: assertAbsolutePath(requiredString(codex, 'launcherPath'), 'launcherPath'),
    launcherRealPath: assertAbsolutePath(
      requiredString(codex, 'launcherRealPath'),
      'launcherRealPath',
    ),
    platform: requiredString(codex, 'platform'),
    snapshotDigest: requiredDigest(manifest, 'snapshotDigest'),
    snapshotProfile,
    targetTriple: requiredString(codex, 'targetTriple'),
    version: requiredString(codex, 'version'),
  });
}

function digestFile(path: string, field: string): string {
  try {
    return `sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
  } catch {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      `Supported Codex ${field} cannot be read for identity verification`,
    );
  }
}

function assertRegularFile(path: string, field: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      `Supported Codex ${field} is unavailable`,
    );
  }
  if ((!stat.isFile() && !stat.isSymbolicLink()) || stat.isDirectory()) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      `Supported Codex ${field} is not an executable file`,
    );
  }
}

export function assertCurrentVerifiedCodexInstallation(
  installation: unknown,
): asserts installation is VerifiedCodexInstallation {
  assertVerifiedCodexInstallation(installation);
  const profile = installation.profile;
  if (
    installation.launcherPath !== profile.launcherPath ||
    installation.delegatedExecutablePath !== profile.delegatedExecutablePath
  ) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Verified Codex paths no longer match their supported profile',
    );
  }
  assertRegularFile(installation.launcherPath, 'launcher');
  assertRegularFile(installation.delegatedExecutablePath, 'delegated executable');
  let launcherRealPath: string;
  let delegatedRealPath: string;
  try {
    launcherRealPath = realpathSync(installation.launcherPath);
    delegatedRealPath = realpathSync(installation.delegatedExecutablePath);
  } catch {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Verified Codex executable paths cannot be resolved at launch',
    );
  }
  if (
    launcherRealPath !== profile.launcherRealPath ||
    delegatedRealPath !== profile.delegatedExecutablePath ||
    digestFile(installation.launcherPath, 'launcher') !== profile.launcherDigest ||
    digestFile(installation.delegatedExecutablePath, 'delegated executable') !==
      profile.delegatedExecutableDigest
  ) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Codex executable identity changed after verification',
    );
  }
}

export function verifyBundledCodexInstallation(launcherPath?: string): VerifiedCodexInstallation {
  const profile = loadBundledCodexProfile();
  const selectedLauncher = launcherPath ?? profile.launcherPath;
  if (selectedLauncher !== profile.launcherPath) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Codex launcher path does not match the supported profile',
    );
  }
  assertRegularFile(selectedLauncher, 'launcher');
  assertRegularFile(profile.delegatedExecutablePath, 'delegated executable');
  let realLauncher: string;
  try {
    realLauncher = realpathSync(selectedLauncher);
  } catch {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Codex launcher cannot be resolved',
    );
  }
  if (
    realLauncher !== profile.launcherRealPath ||
    digestFile(selectedLauncher, 'launcher') !== profile.launcherDigest ||
    digestFile(profile.delegatedExecutablePath, 'delegated executable') !==
      profile.delegatedExecutableDigest
  ) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Codex executable identity does not match the supported profile',
    );
  }
  let version: string;
  try {
    version = execFileSync(selectedLauncher, ['--version'], {
      encoding: 'utf8',
      env: {
        NO_COLOR: '1',
        PATH: `${dirname(process.execPath)}:/usr/bin:/bin`,
      },
      maxBuffer: 64 * 1024,
      timeout: 10_000,
    }).trim();
  } catch {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Codex launcher version cannot be verified',
    );
  }
  if (version !== profile.version) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'Codex launcher version does not match the supported profile',
      { observedVersion: version.slice(0, 120) },
    );
  }
  return Object.freeze({
    [verifiedInstallationBrand]: true as const,
    delegatedExecutablePath: profile.delegatedExecutablePath,
    launcherPath: selectedLauncher,
    profile,
  });
}

export function assertVerifiedCodexInstallation(
  installation: unknown,
): asserts installation is VerifiedCodexInstallation {
  if (
    typeof installation !== 'object' ||
    installation === null ||
    Reflect.get(installation, verifiedInstallationBrand) !== true
  ) {
    throw clientError(
      AppServerClientErrorCode.VERSION_MISMATCH,
      'App Server launch requires a verified Codex installation',
    );
  }
}

export function fixtureVerifiedInstallation(
  executablePath: string,
  protocolIdentity?: Readonly<{ version: string; snapshotDigest: string }>,
): VerifiedCodexInstallation {
  const path = realpathSync(executablePath);
  const digest = digestFile(path, 'fixture executable');
  if (
    protocolIdentity !== undefined &&
    (protocolIdentity.version.length === 0 ||
      protocolIdentity.version.length > 4_096 ||
      !digestPattern.test(protocolIdentity.snapshotDigest))
  ) {
    throw new TypeError('Fixture Codex protocol identity is invalid');
  }
  const profile: BundledCodexProfile = Object.freeze({
    architecture: process.arch,
    delegatedExecutableDigest: digest,
    delegatedExecutablePath: path,
    launcherDigest: digest,
    launcherPath: path,
    launcherRealPath: path,
    platform: process.platform,
    snapshotDigest: protocolIdentity?.snapshotDigest ?? `sha256:${'0'.repeat(64)}`,
    snapshotProfile: 'codex-schema-snapshot-v1',
    targetTriple: 'test-fixture',
    version: protocolIdentity?.version ?? 'test-fixture',
  });
  return Object.freeze({
    [verifiedInstallationBrand]: true as const,
    delegatedExecutablePath: path,
    launcherPath: path,
    profile,
  });
}
