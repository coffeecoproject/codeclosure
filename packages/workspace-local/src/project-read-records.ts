import { readFileSync } from 'node:fs';

import {
  decodeProjectReadOwnershipMarker,
  digestProjectReadWorkspaceValue,
  type ProjectReadOwnershipMarker,
  type ProjectReadSnapshotCleanupRequest,
} from '@codeclosure/runtime';

import {
  LocalProjectReadWorkspaceError,
  LocalProjectReadWorkspaceFailureCode,
} from './contracts.js';
import { writeRecordAtomically } from './records.js';

export const LOCAL_PROJECT_READ_ROOT_PROFILE = 'codeclosure-local-project-read-root-v1';
export const LOCAL_PROJECT_READ_CLEANUP_OPERATION_PROFILE =
  'codeclosure-local-project-read-cleanup-operation-v1';

export interface LocalProjectReadRootRecordV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof LOCAL_PROJECT_READ_ROOT_PROFILE;
  readonly ownerId: string;
  readonly workspaceRootIdentity: string;
  readonly recordDigest: string;
}

export interface LocalProjectReadCleanupOperationRecordV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof LOCAL_PROJECT_READ_CLEANUP_OPERATION_PROFILE;
  readonly grantId: string;
  readonly grantDigest: string;
  readonly ownershipMarkerDigest: string;
  readonly workspaceRootIdentity: string;
  readonly snapshotLeafRealpath: string;
  readonly preEffectFingerprintDigest: string;
  readonly targetNodeDeviceId: string;
  readonly targetNodeFileId: string;
  readonly targetManifestDigest: string;
  readonly operationDigest: string;
}

function fail(code: LocalProjectReadWorkspaceFailureCode, message: string): never {
  throw new LocalProjectReadWorkspaceError(code, message);
}

function object(value: unknown, field: string): Readonly<Record<string, unknown>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(LocalProjectReadWorkspaceFailureCode.INVALID_MARKER, `${field} is not an object`);
  }
  return value as Readonly<Record<string, unknown>>;
}

function exactKeys(
  value: Readonly<Record<string, unknown>>,
  expected: readonly string[],
  field: string,
): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...expected].sort())) {
    fail(
      LocalProjectReadWorkspaceFailureCode.INVALID_MARKER,
      `${field} has missing or unknown fields`,
    );
  }
}

function nonBlank(value: unknown, field: string): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    value.includes('\u0000') ||
    value !== value.normalize('NFC')
  ) {
    fail(LocalProjectReadWorkspaceFailureCode.INVALID_MARKER, `${field} is invalid`);
  }
  return value;
}

function readJson(path: string, field: string): unknown {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    fail(LocalProjectReadWorkspaceFailureCode.INVALID_MARKER, `${field} is unreadable`);
  }
}

function rootProjection(record: Omit<LocalProjectReadRootRecordV1, 'recordDigest'>): unknown {
  return record;
}

export function createLocalProjectReadRootRecord(
  ownerId: string,
  workspaceRootIdentity: string,
): LocalProjectReadRootRecordV1 {
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    profile: LOCAL_PROJECT_READ_ROOT_PROFILE,
    ownerId,
    workspaceRootIdentity,
  });
  return Object.freeze({
    ...withoutDigest,
    recordDigest: digestProjectReadWorkspaceValue(rootProjection(withoutDigest)),
  });
}

export function decodeLocalProjectReadRootRecord(value: unknown): LocalProjectReadRootRecordV1 {
  const input = object(value, 'Project-read root ownership record');
  exactKeys(
    input,
    ['schemaVersion', 'profile', 'ownerId', 'workspaceRootIdentity', 'recordDigest'],
    'Project-read root ownership record',
  );
  if (input['schemaVersion'] !== 1 || input['profile'] !== LOCAL_PROJECT_READ_ROOT_PROFILE) {
    fail(
      LocalProjectReadWorkspaceFailureCode.INVALID_MARKER,
      'Project-read root ownership identity is unsupported',
    );
  }
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    profile: LOCAL_PROJECT_READ_ROOT_PROFILE,
    ownerId: nonBlank(input['ownerId'], 'Project-read owner ID'),
    workspaceRootIdentity: nonBlank(
      input['workspaceRootIdentity'],
      'Project-read workspace-root identity',
    ),
  });
  const recordDigest = nonBlank(input['recordDigest'], 'Project-read root ownership digest');
  if (recordDigest !== digestProjectReadWorkspaceValue(rootProjection(withoutDigest))) {
    fail(
      LocalProjectReadWorkspaceFailureCode.INVALID_MARKER,
      'Project-read root ownership digest is inconsistent',
    );
  }
  return Object.freeze({ ...withoutDigest, recordDigest });
}

export function readLocalProjectReadRootRecord(path: string): LocalProjectReadRootRecordV1 {
  return decodeLocalProjectReadRootRecord(readJson(path, 'Project-read root ownership record'));
}

export function writeLocalProjectReadRootRecord(
  path: string,
  record: LocalProjectReadRootRecordV1,
): void {
  writeRecordAtomically(path, decodeLocalProjectReadRootRecord(record));
}

export function readLocalProjectReadOwnershipMarker(path: string): ProjectReadOwnershipMarker {
  try {
    return decodeProjectReadOwnershipMarker(readJson(path, 'Project-read ownership marker'));
  } catch (error) {
    if (error instanceof LocalProjectReadWorkspaceError) {
      throw error;
    }
    fail(
      LocalProjectReadWorkspaceFailureCode.INVALID_MARKER,
      'Project-read ownership marker is invalid',
    );
  }
}

export function writeLocalProjectReadOwnershipMarker(
  path: string,
  marker: ProjectReadOwnershipMarker,
): void {
  writeRecordAtomically(path, decodeProjectReadOwnershipMarker(marker));
}

function cleanupOperationProjection(
  record: Omit<LocalProjectReadCleanupOperationRecordV1, 'operationDigest'>,
): unknown {
  return record;
}

export function createLocalProjectReadCleanupOperationRecord(
  grant: ProjectReadSnapshotCleanupRequest,
  input: Readonly<{
    preEffectFingerprintDigest: string;
    targetNodeDeviceId: string;
    targetNodeFileId: string;
    targetManifestDigest: string;
  }>,
): LocalProjectReadCleanupOperationRecordV1 {
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    profile: LOCAL_PROJECT_READ_CLEANUP_OPERATION_PROFILE,
    grantId: grant.id,
    grantDigest: grant.grantDigest,
    ownershipMarkerDigest: grant.ownershipMarkerDigest,
    workspaceRootIdentity: grant.workspaceRootIdentity,
    snapshotLeafRealpath: grant.snapshotLeafRealpath,
    preEffectFingerprintDigest: input.preEffectFingerprintDigest,
    targetNodeDeviceId: input.targetNodeDeviceId,
    targetNodeFileId: input.targetNodeFileId,
    targetManifestDigest: input.targetManifestDigest,
  });
  return Object.freeze({
    ...withoutDigest,
    operationDigest: digestProjectReadWorkspaceValue(cleanupOperationProjection(withoutDigest)),
  });
}

export function decodeLocalProjectReadCleanupOperationRecord(
  value: unknown,
): LocalProjectReadCleanupOperationRecordV1 {
  const input = object(value, 'Project-read cleanup operation record');
  exactKeys(
    input,
    [
      'schemaVersion',
      'profile',
      'grantId',
      'grantDigest',
      'ownershipMarkerDigest',
      'workspaceRootIdentity',
      'snapshotLeafRealpath',
      'preEffectFingerprintDigest',
      'targetNodeDeviceId',
      'targetNodeFileId',
      'targetManifestDigest',
      'operationDigest',
    ],
    'Project-read cleanup operation record',
  );
  if (
    input['schemaVersion'] !== 1 ||
    input['profile'] !== LOCAL_PROJECT_READ_CLEANUP_OPERATION_PROFILE
  ) {
    fail(
      LocalProjectReadWorkspaceFailureCode.COORDINATION_CONFLICT,
      'Project-read cleanup operation identity is unsupported',
    );
  }
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    profile: LOCAL_PROJECT_READ_CLEANUP_OPERATION_PROFILE,
    grantId: nonBlank(input['grantId'], 'Cleanup Grant ID'),
    grantDigest: nonBlank(input['grantDigest'], 'Cleanup Grant digest'),
    ownershipMarkerDigest: nonBlank(
      input['ownershipMarkerDigest'],
      'Cleanup ownership-marker digest',
    ),
    workspaceRootIdentity: nonBlank(
      input['workspaceRootIdentity'],
      'Cleanup workspace-root identity',
    ),
    snapshotLeafRealpath: nonBlank(input['snapshotLeafRealpath'], 'Cleanup snapshot-leaf identity'),
    preEffectFingerprintDigest: nonBlank(
      input['preEffectFingerprintDigest'],
      'Cleanup pre-effect fingerprint digest',
    ),
    targetNodeDeviceId: nonBlank(input['targetNodeDeviceId'], 'Cleanup target device identity'),
    targetNodeFileId: nonBlank(input['targetNodeFileId'], 'Cleanup target file identity'),
    targetManifestDigest: nonBlank(input['targetManifestDigest'], 'Cleanup target manifest digest'),
  });
  const operationDigest = nonBlank(input['operationDigest'], 'Cleanup operation digest');
  if (
    operationDigest !== digestProjectReadWorkspaceValue(cleanupOperationProjection(withoutDigest))
  ) {
    fail(
      LocalProjectReadWorkspaceFailureCode.COORDINATION_CONFLICT,
      'Project-read cleanup operation digest is inconsistent',
    );
  }
  return Object.freeze({ ...withoutDigest, operationDigest });
}

export function readLocalProjectReadCleanupOperationRecord(
  path: string,
): LocalProjectReadCleanupOperationRecordV1 {
  return decodeLocalProjectReadCleanupOperationRecord(
    readJson(path, 'Project-read cleanup operation record'),
  );
}

export function writeLocalProjectReadCleanupOperationRecord(
  path: string,
  record: LocalProjectReadCleanupOperationRecordV1,
): void {
  writeRecordAtomically(path, decodeLocalProjectReadCleanupOperationRecord(record));
}
