import {
  closeSync,
  constants,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

import { canonicalizeJson, digestCandidateWorkspaceValue } from '@codeclosure/runtime';

import { LocalCandidateWorkspaceError, LocalCandidateWorkspaceFailureCode } from './contracts.js';
import {
  assertDigest,
  assertGitMetadata,
  assertManifest,
  type CandidateSourceGitMetadata,
  type CandidateTreeManifest,
} from './manifests.js';

export interface ActiveLeaseRecord {
  readonly accessMode: 'MUTABLE' | 'READ_ONLY';
  readonly digest: string;
  readonly id: string;
}

export interface CandidateOwnershipRecord {
  readonly activeLeases: readonly ActiveLeaseRecord[];
  readonly baseDigest: string;
  readonly baseManifest: CandidateTreeManifest;
  readonly candidateId: string;
  readonly candidateLeaf: string;
  readonly candidateRootIdentity: string;
  readonly frozenManifest: CandidateTreeManifest | null;
  readonly generationId: string;
  readonly goalId: string;
  readonly goalRevision: number;
  readonly ownerId: string;
  readonly parentGenerationId: string | null;
  readonly phase: 'FROZEN' | 'MUTABLE' | 'UNSAFE';
  readonly recordDigest: string;
  readonly recordKind: 'CANDIDATE_WORKSPACE_GENERATION';
  readonly recordVersion: number;
  readonly retentionPolicy: 'RUNTIME_OWNED';
  readonly schemaVersion: 1;
  readonly sourceGitMetadata: CandidateSourceGitMetadata;
  readonly sourceProjectRoot: string;
  readonly sourceTreeDigest: string;
  readonly workflowId: string;
  readonly workspaceRootIdentity: string;
}

export interface WorkspaceOwnershipRecord {
  readonly ownerId: string;
  readonly recordDigest: string;
  readonly recordKind: 'CANDIDATE_WORKSPACE_ROOT';
  readonly schemaVersion: 1;
  readonly workspaceRootIdentity: string;
}

export const MAXIMUM_ACTIVE_CANDIDATE_WORKSPACE_LEASES = 16;

function exactKeys(
  input: Record<string, unknown>,
  expected: readonly string[],
  field: string,
): void {
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify([...expected].sort())) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      `${field} has unknown or missing fields`,
    );
  }
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      `${field} is not an object`,
    );
  }
  return value as Record<string, unknown>;
}

function nonBlank(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.includes('\u0000')) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      `${field} must be a non-blank string`,
    );
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      `${field} must be a positive safe integer`,
    );
  }
  return value;
}

function nullableString(value: unknown, field: string): string | null {
  return value === null ? null : nonBlank(value, field);
}

function recordProjection(record: Omit<CandidateOwnershipRecord, 'recordDigest'>): unknown {
  return record;
}

export function createCandidateOwnershipRecord(
  input: Omit<CandidateOwnershipRecord, 'recordDigest'>,
): CandidateOwnershipRecord {
  return decodeCandidateOwnershipRecord({
    ...input,
    recordDigest: digestCandidateWorkspaceValue(recordProjection(input)),
  });
}

function activeLeases(value: unknown): readonly ActiveLeaseRecord[] {
  if (!Array.isArray(value) || value.length > MAXIMUM_ACTIVE_CANDIDATE_WORKSPACE_LEASES) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      'Active lease records are invalid',
    );
  }
  const leases = value.map((entry) => {
    const input = object(entry, 'Active lease record');
    exactKeys(input, ['accessMode', 'digest', 'id'], 'Active lease record');
    if (input['accessMode'] !== 'MUTABLE' && input['accessMode'] !== 'READ_ONLY') {
      throw new LocalCandidateWorkspaceError(
        LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
        'Active lease access mode is invalid',
      );
    }
    return Object.freeze({
      accessMode: input['accessMode'],
      digest: assertDigest(input['digest'], 'Active lease digest'),
      id: nonBlank(input['id'], 'Active lease ID'),
    });
  });
  const ids = leases.map((lease) => lease.id);
  if (new Set(ids).size !== ids.length || JSON.stringify(ids) !== JSON.stringify([...ids].sort())) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      'Active leases must be uniquely sorted',
    );
  }
  return Object.freeze(leases);
}

export function decodeCandidateOwnershipRecord(value: unknown): CandidateOwnershipRecord {
  const input = object(value, 'Candidate ownership record');
  exactKeys(
    input,
    [
      'activeLeases',
      'baseDigest',
      'baseManifest',
      'candidateId',
      'candidateLeaf',
      'candidateRootIdentity',
      'frozenManifest',
      'generationId',
      'goalId',
      'goalRevision',
      'ownerId',
      'parentGenerationId',
      'phase',
      'recordDigest',
      'recordKind',
      'recordVersion',
      'retentionPolicy',
      'schemaVersion',
      'sourceGitMetadata',
      'sourceProjectRoot',
      'sourceTreeDigest',
      'workflowId',
      'workspaceRootIdentity',
    ],
    'Candidate ownership record',
  );
  if (
    input['schemaVersion'] !== 1 ||
    input['recordKind'] !== 'CANDIDATE_WORKSPACE_GENERATION' ||
    input['retentionPolicy'] !== 'RUNTIME_OWNED' ||
    (input['phase'] !== 'MUTABLE' && input['phase'] !== 'FROZEN' && input['phase'] !== 'UNSAFE')
  ) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      'Candidate ownership record literals are invalid',
    );
  }
  const frozenManifest =
    input['frozenManifest'] === null
      ? null
      : assertManifest(input['frozenManifest'], 'Frozen Candidate manifest');
  if ((input['phase'] === 'FROZEN') !== (frozenManifest !== null)) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      'Candidate ownership record has inconsistent frozen identity',
    );
  }
  const withoutDigest = Object.freeze({
    activeLeases: activeLeases(input['activeLeases']),
    baseDigest: assertDigest(input['baseDigest'], 'Base digest'),
    baseManifest: assertManifest(input['baseManifest'], 'Base manifest'),
    candidateId: nonBlank(input['candidateId'], 'Candidate ID'),
    candidateLeaf: nonBlank(input['candidateLeaf'], 'Candidate leaf'),
    candidateRootIdentity: nonBlank(input['candidateRootIdentity'], 'Candidate root identity'),
    frozenManifest,
    generationId: nonBlank(input['generationId'], 'Generation ID'),
    goalId: nonBlank(input['goalId'], 'Goal ID'),
    goalRevision: positiveInteger(input['goalRevision'], 'Goal revision'),
    ownerId: nonBlank(input['ownerId'], 'Owner ID'),
    parentGenerationId: nullableString(input['parentGenerationId'], 'Parent generation ID'),
    phase: input['phase'],
    recordKind: input['recordKind'],
    recordVersion: positiveInteger(input['recordVersion'], 'Record version'),
    retentionPolicy: input['retentionPolicy'],
    schemaVersion: input['schemaVersion'],
    sourceGitMetadata: assertGitMetadata(input['sourceGitMetadata']),
    sourceProjectRoot: nonBlank(input['sourceProjectRoot'], 'Source project root'),
    sourceTreeDigest: assertDigest(input['sourceTreeDigest'], 'Source tree digest'),
    workflowId: nonBlank(input['workflowId'], 'Workflow ID'),
    workspaceRootIdentity: nonBlank(input['workspaceRootIdentity'], 'Workspace root identity'),
  });
  const recordDigest = assertDigest(input['recordDigest'], 'Ownership record digest');
  if (recordDigest !== digestCandidateWorkspaceValue(recordProjection(withoutDigest))) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      'Candidate ownership record digest is inconsistent',
    );
  }
  return Object.freeze({ ...withoutDigest, recordDigest });
}

export function createWorkspaceOwnershipRecord(
  ownerId: string,
  workspaceRootIdentity: string,
): WorkspaceOwnershipRecord {
  const projection = {
    ownerId,
    recordKind: 'CANDIDATE_WORKSPACE_ROOT',
    schemaVersion: 1,
    workspaceRootIdentity,
  } as const;
  return Object.freeze({ ...projection, recordDigest: digestCandidateWorkspaceValue(projection) });
}

export function decodeWorkspaceOwnershipRecord(value: unknown): WorkspaceOwnershipRecord {
  const input = object(value, 'Workspace ownership record');
  exactKeys(
    input,
    ['ownerId', 'recordDigest', 'recordKind', 'schemaVersion', 'workspaceRootIdentity'],
    'Workspace ownership record',
  );
  if (input['schemaVersion'] !== 1 || input['recordKind'] !== 'CANDIDATE_WORKSPACE_ROOT') {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      'Workspace ownership record literals are invalid',
    );
  }
  const projection = {
    ownerId: nonBlank(input['ownerId'], 'Workspace owner ID'),
    recordKind: input['recordKind'],
    schemaVersion: input['schemaVersion'],
    workspaceRootIdentity: nonBlank(input['workspaceRootIdentity'], 'Workspace root identity'),
  } as const;
  const recordDigest = assertDigest(input['recordDigest'], 'Workspace ownership digest');
  if (recordDigest !== digestCandidateWorkspaceValue(projection)) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      'Workspace ownership record digest is inconsistent',
    );
  }
  return Object.freeze({ ...projection, recordDigest });
}

function parseRecord(path: string): unknown {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 16 * 1024 * 1024) {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      'Ownership record is not a bounded regular file',
    );
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    throw new LocalCandidateWorkspaceError(
      LocalCandidateWorkspaceFailureCode.INVALID_RECORD,
      'Ownership record is not valid JSON',
    );
  }
}

export function readCandidateOwnershipRecord(path: string): CandidateOwnershipRecord {
  return decodeCandidateOwnershipRecord(parseRecord(path));
}

export function readWorkspaceOwnershipRecord(path: string): WorkspaceOwnershipRecord {
  return decodeWorkspaceOwnershipRecord(parseRecord(path));
}

export function writeRecordAtomically(path: string, value: unknown): void {
  const directory = dirname(path);
  const temporary = resolve(directory, `.${basename(path)}.${process.pid.toString(10)}.tmp`);
  let descriptor: number | undefined;
  try {
    descriptor = openSync(
      temporary,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
    const bytes = Buffer.from(`${canonicalizeJson(value)}\n`, 'utf8');
    writeSync(descriptor, bytes);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    renameSync(temporary, path);
    fsyncDirectory(directory);
  } catch (error) {
    if (descriptor !== undefined) {
      closeSync(descriptor);
    }
    try {
      unlinkSync(temporary);
    } catch {
      // The temporary file may already have been renamed or never created.
    }
    throw error;
  }
}

export function fsyncDirectory(path: string): void {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}
