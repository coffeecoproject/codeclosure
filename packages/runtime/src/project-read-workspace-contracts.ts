import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  decodeProjectReadGitStateProjection,
  decodeProjectReadSourceTreeProjection,
  decodeProjectSourceReadAuthorityRecord,
  attemptId,
  externalExecutionId,
  isoTimestamp,
  projectReadSnapshotId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectReadWorkspaceObservationId,
  projectReadGitStateProjection,
  projectReadSourceTreeProjection,
  projectSourceReadAuthorityId,
  sha256Digest,
  type AttemptId,
  type ExternalExecutionId,
  type IsoTimestamp,
  type ProjectReadSnapshotId,
  type ProjectReadGitStateProjection,
  type ProjectReadSourceTreeProjection,
  type ProjectReadWorkspaceAuthoritySnapshotId,
  type ProjectReadWorkspaceObservationId,
  type ProjectSourceReadAuthorityRecord,
  type ProjectSourceReadAuthorityId,
  type Sha256Digest,
} from '@codeclosure/domain';
import { z } from 'zod';

import { CanonicalJsonSha256DigestProvider } from './canonical-json.js';

const digests = new CanonicalJsonSha256DigestProvider();

export const ProjectReadWorkspaceRetention = {
  CURRENT: 'CURRENT',
  RETAINED: 'RETAINED',
} as const;
export type ProjectReadWorkspaceRetention =
  (typeof ProjectReadWorkspaceRetention)[keyof typeof ProjectReadWorkspaceRetention];

export const ProjectReadWorkspaceClassification = {
  OWNED_CURRENT: 'OWNED_CURRENT',
  OWNED_ORPHANED: 'OWNED_ORPHANED',
  OWNED_RETAINED: 'OWNED_RETAINED',
  UNSAFE: 'UNSAFE',
} as const;
export type ProjectReadWorkspaceClassification =
  (typeof ProjectReadWorkspaceClassification)[keyof typeof ProjectReadWorkspaceClassification];

export interface ProjectReadSourceObservationRequestV1 {
  readonly schemaVersion: 1;
  readonly normalizedProjectRoot: string;
}

export type ProjectReadSourceObservationRequest = ProjectReadSourceObservationRequestV1;

export interface ProjectReadSourceObservationV1 {
  readonly schemaVersion: 1;
  readonly normalizedProjectRoot: string;
  readonly resolvedProjectRoot: string;
  readonly repositoryControlRootIdentity: string;
  readonly sourceTree: ProjectReadSourceTreeProjection;
  readonly gitState: ProjectReadGitStateProjection;
  readonly observedAt: IsoTimestamp;
  readonly observationDigest: Sha256Digest;
}

export type ProjectReadSourceObservation = ProjectReadSourceObservationV1;

export interface ProjectReadOwnershipMarkerV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof PROJECT_READ_OWNERSHIP_MARKER_PROFILE;
  readonly projectReadAuthorityId: ProjectSourceReadAuthorityId;
  readonly snapshotId: ProjectReadSnapshotId;
  readonly workspaceRootIdentity: string;
  readonly snapshotLeafRealpath: string;
  readonly snapshotTreeDigest: Sha256Digest;
  readonly markerDigest: Sha256Digest;
}

export type ProjectReadOwnershipMarker = ProjectReadOwnershipMarkerV1;

export interface ProjectReadSnapshotMaterializationReceiptV1 {
  readonly schemaVersion: 1;
  readonly projectReadAuthorityId: ProjectSourceReadAuthorityId;
  readonly authorityRecordDigest: Sha256Digest;
  readonly snapshotId: ProjectReadSnapshotId;
  readonly workspaceRootIdentity: string;
  readonly snapshotLeafRealpath: string;
  readonly snapshotTreeDigest: Sha256Digest;
  readonly ownershipMarkerProfile: typeof PROJECT_READ_OWNERSHIP_MARKER_PROFILE;
  readonly ownershipMarkerDigest: Sha256Digest;
  readonly observedAt: IsoTimestamp;
  readonly receiptDigest: Sha256Digest;
}

export type ProjectReadSnapshotMaterializationReceipt = ProjectReadSnapshotMaterializationReceiptV1;

export const ProjectReadSnapshotCurrencyState = {
  CURRENT: 'CURRENT',
  AUTHORITY_MISSING: 'AUTHORITY_MISSING',
  AUTHORITY_ALIASED: 'AUTHORITY_ALIASED',
  AUTHORITY_UNVERIFIABLE: 'AUTHORITY_UNVERIFIABLE',
  SNAPSHOT_IDENTITY_MISMATCH: 'SNAPSHOT_IDENTITY_MISMATCH',
  SNAPSHOT_CONTENT_MISMATCH: 'SNAPSHOT_CONTENT_MISMATCH',
} as const;
export type ProjectReadSnapshotCurrencyState =
  (typeof ProjectReadSnapshotCurrencyState)[keyof typeof ProjectReadSnapshotCurrencyState];

/**
 * Point-in-time filesystem observation for one retained ProjectRead record.
 * It is not persisted authority and cannot authorize dispatch or cleanup.
 */
export interface ProjectReadSnapshotCurrencyObservationV1 {
  readonly schemaVersion: 1;
  readonly projectReadAuthorityId: ProjectSourceReadAuthorityId;
  readonly authorityRecordDigest: Sha256Digest;
  readonly snapshotId: ProjectReadSnapshotId;
  readonly workspaceRootIdentity: string;
  readonly snapshotLeafRealpath: string;
  readonly state: ProjectReadSnapshotCurrencyState;
  readonly observedAt: IsoTimestamp;
  readonly observationDigest: Sha256Digest;
}

export type ProjectReadSnapshotCurrencyObservation = ProjectReadSnapshotCurrencyObservationV1;

export interface ProjectReadWorkspaceExpectedSnapshotV1 {
  readonly attemptId: AttemptId;
  readonly authorityRecordDigest: Sha256Digest;
  readonly ownershipMarkerDigest: Sha256Digest;
  readonly ownershipMarkerProfile: typeof PROJECT_READ_OWNERSHIP_MARKER_PROFILE;
  readonly projectReadAuthorityId: ProjectSourceReadAuthorityId;
  readonly retention: ProjectReadWorkspaceRetention;
  readonly snapshotId: ProjectReadSnapshotId;
  readonly snapshotLeafRealpath: string;
  readonly workspaceRootIdentity: string;
}

export interface ProjectReadWorkspaceActiveConsumerV1 {
  readonly attemptId: AttemptId;
  readonly externalExecutionId: ExternalExecutionId;
  readonly projectReadAuthorityId: ProjectSourceReadAuthorityId;
  readonly snapshotId: ProjectReadSnapshotId;
}

export interface ProjectReadWorkspaceAuthoritySnapshotV1 {
  readonly activeConsumers: readonly ProjectReadWorkspaceActiveConsumerV1[];
  readonly authorityDigest: Sha256Digest;
  readonly authoritySequence: number;
  readonly expectedSnapshots: readonly ProjectReadWorkspaceExpectedSnapshotV1[];
  readonly id: ProjectReadWorkspaceAuthoritySnapshotId;
  readonly issuedAt: IsoTimestamp;
  readonly schemaVersion: 1;
}

export type ProjectReadWorkspaceAuthoritySnapshot = ProjectReadWorkspaceAuthoritySnapshotV1;

export interface ProjectReadWorkspaceObservationV1 {
  readonly activeExternalExecutionIds: readonly ExternalExecutionId[];
  readonly authorityRecordDigest: Sha256Digest | null;
  readonly authoritySequence: number;
  readonly authoritySnapshotDigest: Sha256Digest;
  readonly authoritySnapshotId: ProjectReadWorkspaceAuthoritySnapshotId;
  readonly classification: ProjectReadWorkspaceClassification;
  readonly id: ProjectReadWorkspaceObservationId;
  readonly observedAt: IsoTimestamp;
  readonly observationDigest: Sha256Digest;
  readonly ownershipMarkerDigest: Sha256Digest | null;
  readonly ownershipMarkerProfile: typeof PROJECT_READ_OWNERSHIP_MARKER_PROFILE | null;
  readonly projectReadAuthorityId: ProjectSourceReadAuthorityId | null;
  readonly schemaVersion: 1;
  readonly snapshotId: ProjectReadSnapshotId | null;
  readonly snapshotLeafRealpath: string;
  readonly workspaceRootIdentity: string;
}

export type ProjectReadWorkspaceObservation = ProjectReadWorkspaceObservationV1;

const boundedStringSchema = z
  .string()
  .max(16_384)
  .refine(
    (value) =>
      value.trim().length > 0 && !value.includes('\u0000') && value === value.normalize('NFC'),
  );
const digestSchema = z.string();
const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const sourceObservationRequestSchema = z
  .object({
    schemaVersion: z.literal(1),
    normalizedProjectRoot: boundedStringSchema,
  })
  .strict();

const sourceObservationSchema = sourceObservationRequestSchema
  .extend({
    resolvedProjectRoot: boundedStringSchema,
    repositoryControlRootIdentity: boundedStringSchema,
    sourceTree: z.unknown(),
    gitState: z.unknown(),
    observedAt: z.string(),
    observationDigest: digestSchema,
  })
  .strict();

const ownershipMarkerSchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.literal(PROJECT_READ_OWNERSHIP_MARKER_PROFILE),
    projectReadAuthorityId: z.string(),
    snapshotId: z.string(),
    workspaceRootIdentity: boundedStringSchema,
    snapshotLeafRealpath: boundedStringSchema,
    snapshotTreeDigest: digestSchema,
    markerDigest: digestSchema,
  })
  .strict();

const materializationReceiptSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectReadAuthorityId: z.string(),
    authorityRecordDigest: digestSchema,
    snapshotId: z.string(),
    workspaceRootIdentity: boundedStringSchema,
    snapshotLeafRealpath: boundedStringSchema,
    snapshotTreeDigest: digestSchema,
    ownershipMarkerProfile: z.literal(PROJECT_READ_OWNERSHIP_MARKER_PROFILE),
    ownershipMarkerDigest: digestSchema,
    observedAt: z.string(),
    receiptDigest: digestSchema,
  })
  .strict();

const snapshotCurrencyObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    projectReadAuthorityId: z.string(),
    authorityRecordDigest: digestSchema,
    snapshotId: z.string(),
    workspaceRootIdentity: boundedStringSchema,
    snapshotLeafRealpath: boundedStringSchema,
    state: z.enum(Object.values(ProjectReadSnapshotCurrencyState)),
    observedAt: z.string(),
    observationDigest: digestSchema,
  })
  .strict();

const expectedSnapshotSchema = z
  .object({
    attemptId: z.string(),
    authorityRecordDigest: digestSchema,
    ownershipMarkerDigest: digestSchema,
    ownershipMarkerProfile: z.literal(PROJECT_READ_OWNERSHIP_MARKER_PROFILE),
    projectReadAuthorityId: z.string(),
    retention: z.enum(Object.values(ProjectReadWorkspaceRetention)),
    snapshotId: z.string(),
    snapshotLeafRealpath: boundedStringSchema,
    workspaceRootIdentity: boundedStringSchema,
  })
  .strict();

const activeConsumerSchema = z
  .object({
    attemptId: z.string(),
    externalExecutionId: z.string(),
    projectReadAuthorityId: z.string(),
    snapshotId: z.string(),
  })
  .strict();

const authoritySnapshotSchema = z
  .object({
    activeConsumers: z.array(activeConsumerSchema).max(4_096),
    authorityDigest: digestSchema,
    authoritySequence: positiveSafeIntegerSchema,
    expectedSnapshots: z.array(expectedSnapshotSchema).max(4_096),
    id: z.string(),
    issuedAt: z.string(),
    schemaVersion: z.literal(1),
  })
  .strict();

const observationSchema = z
  .object({
    activeExternalExecutionIds: z.array(z.string()).max(1),
    authorityRecordDigest: digestSchema.nullable(),
    authoritySequence: positiveSafeIntegerSchema,
    authoritySnapshotDigest: digestSchema,
    authoritySnapshotId: z.string(),
    classification: z.enum(Object.values(ProjectReadWorkspaceClassification)),
    id: z.string(),
    observedAt: z.string(),
    observationDigest: digestSchema,
    ownershipMarkerDigest: digestSchema.nullable(),
    ownershipMarkerProfile: z.literal(PROJECT_READ_OWNERSHIP_MARKER_PROFILE).nullable(),
    projectReadAuthorityId: z.string().nullable(),
    schemaVersion: z.literal(1),
    snapshotId: z.string().nullable(),
    snapshotLeafRealpath: boundedStringSchema,
    workspaceRootIdentity: boundedStringSchema,
  })
  .strict();

function exactAbsolutePath(value: string, name: string): string {
  if (!isAbsolute(value) || resolve(value) !== value) {
    throw new TypeError(`${name} must be an exact normalized absolute path`);
  }
  return value;
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

function assertOwnedLeaf(workspaceRootIdentity: string, snapshotLeafRealpath: string): void {
  if (
    workspaceRootIdentity === snapshotLeafRealpath ||
    !isSameOrWithin(snapshotLeafRealpath, workspaceRootIdentity)
  ) {
    throw new TypeError('Project-read workspace target is outside its exact owned root');
  }
}

function assertStringSortedUnique(values: readonly string[], name: string): void {
  let previous: string | undefined;
  for (const value of values) {
    if (previous !== undefined && value <= previous) {
      throw new TypeError(`${name} values must be uniquely string-sorted`);
    }
    previous = value;
  }
}

function assertPathsDoNotOverlap(values: readonly string[], name: string): void {
  const orderedPrefixes = values
    .map((value) => (value.endsWith(sep) ? value : `${value}${sep}`))
    .sort();
  let previous: string | undefined;
  for (const prefix of orderedPrefixes) {
    if (previous !== undefined && prefix.startsWith(previous)) {
      throw new TypeError(`${name} must not overlap`);
    }
    previous = prefix;
  }
}

function sameOrderedStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function digestProjectReadWorkspaceValue(value: unknown): Sha256Digest {
  return digests.digest(value);
}

export function decodeProjectReadSourceObservationRequest(
  value: unknown,
): ProjectReadSourceObservationRequest {
  const parsed = sourceObservationRequestSchema.parse(value);
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    normalizedProjectRoot: exactAbsolutePath(
      parsed.normalizedProjectRoot,
      'Project-read source observation root',
    ),
  });
}

export function projectReadSourceObservationProjection(
  observation: Omit<ProjectReadSourceObservation, 'observationDigest'>,
): unknown {
  return {
    schemaVersion: observation.schemaVersion,
    normalizedProjectRoot: observation.normalizedProjectRoot,
    resolvedProjectRoot: observation.resolvedProjectRoot,
    repositoryControlRootIdentity: observation.repositoryControlRootIdentity,
    sourceTree: observation.sourceTree,
    gitState: observation.gitState,
    observedAt: observation.observedAt,
  };
}

export function decodeProjectReadSourceObservation(value: unknown): ProjectReadSourceObservation {
  const parsed = sourceObservationSchema.parse(value);
  const normalizedProjectRoot = exactAbsolutePath(
    parsed.normalizedProjectRoot,
    'Project-read source observation normalized root',
  );
  const resolvedProjectRoot = exactAbsolutePath(
    parsed.resolvedProjectRoot,
    'Project-read source observation resolved root',
  );
  const repositoryControlRootIdentity = exactAbsolutePath(
    parsed.repositoryControlRootIdentity,
    'Project-read source observation repository control root',
  );
  const sourceTree = decodeProjectReadSourceTreeProjection(parsed.sourceTree);
  const gitState = decodeProjectReadGitStateProjection(parsed.gitState);
  if (
    sourceTree.projectionDigest !==
      digestProjectReadWorkspaceValue(projectReadSourceTreeProjection(sourceTree)) ||
    gitState.projectionDigest !==
      digestProjectReadWorkspaceValue(projectReadGitStateProjection(gitState)) ||
    gitState.sourceProjectRoot !== resolvedProjectRoot ||
    gitState.repositoryControlRootIdentity !== repositoryControlRootIdentity
  ) {
    throw new TypeError('Project-read source observation projections are inconsistent');
  }
  const withoutDigest = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    normalizedProjectRoot,
    resolvedProjectRoot,
    repositoryControlRootIdentity,
    sourceTree,
    gitState,
    observedAt: isoTimestamp(parsed.observedAt),
  });
  const observationDigest = sha256Digest(parsed.observationDigest);
  if (
    observationDigest !==
    digestProjectReadWorkspaceValue(projectReadSourceObservationProjection(withoutDigest))
  ) {
    throw new TypeError('Project-read source observation digest is inconsistent');
  }
  return Object.freeze({ ...withoutDigest, observationDigest });
}

export function createProjectReadSourceObservation(
  observation: Omit<ProjectReadSourceObservation, 'observationDigest' | 'observedAt'> & {
    readonly observedAt: string;
  },
): ProjectReadSourceObservation {
  const withoutDigest = Object.freeze({
    ...observation,
    observedAt: isoTimestamp(observation.observedAt),
  });
  return decodeProjectReadSourceObservation({
    ...withoutDigest,
    observationDigest: digestProjectReadWorkspaceValue(
      projectReadSourceObservationProjection(withoutDigest),
    ),
  });
}

export function projectReadOwnershipMarkerProjection(
  marker: Omit<ProjectReadOwnershipMarker, 'markerDigest'>,
): unknown {
  return {
    schemaVersion: marker.schemaVersion,
    profile: marker.profile,
    projectReadAuthorityId: marker.projectReadAuthorityId,
    snapshotId: marker.snapshotId,
    workspaceRootIdentity: marker.workspaceRootIdentity,
    snapshotLeafRealpath: marker.snapshotLeafRealpath,
    snapshotTreeDigest: marker.snapshotTreeDigest,
  };
}

export function decodeProjectReadOwnershipMarker(value: unknown): ProjectReadOwnershipMarker {
  const parsed = ownershipMarkerSchema.parse(value);
  const workspaceRootIdentity = exactAbsolutePath(
    parsed.workspaceRootIdentity,
    'Project-read ownership-marker root',
  );
  const snapshotLeafRealpath = exactAbsolutePath(
    parsed.snapshotLeafRealpath,
    'Project-read ownership-marker leaf',
  );
  assertOwnedLeaf(workspaceRootIdentity, snapshotLeafRealpath);
  const withoutDigest = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    profile: parsed.profile,
    projectReadAuthorityId: projectSourceReadAuthorityId(parsed.projectReadAuthorityId),
    snapshotId: projectReadSnapshotId(parsed.snapshotId),
    workspaceRootIdentity,
    snapshotLeafRealpath,
    snapshotTreeDigest: sha256Digest(parsed.snapshotTreeDigest),
  });
  const markerDigest = sha256Digest(parsed.markerDigest);
  if (
    markerDigest !==
    digestProjectReadWorkspaceValue(projectReadOwnershipMarkerProjection(withoutDigest))
  ) {
    throw new TypeError('Project-read ownership-marker digest is inconsistent');
  }
  return Object.freeze({ ...withoutDigest, markerDigest });
}

export function createProjectReadOwnershipMarker(
  marker: Omit<ProjectReadOwnershipMarker, 'markerDigest'>,
): ProjectReadOwnershipMarker {
  return decodeProjectReadOwnershipMarker({
    ...marker,
    markerDigest: digestProjectReadWorkspaceValue(projectReadOwnershipMarkerProjection(marker)),
  });
}

export function createProjectReadOwnershipMarkerForRecord(
  value: ProjectSourceReadAuthorityRecord,
): ProjectReadOwnershipMarker {
  const record = decodeProjectSourceReadAuthorityRecord(value);
  const marker = createProjectReadOwnershipMarker({
    schemaVersion: 1,
    profile: record.ownershipMarkerProfile,
    projectReadAuthorityId: record.id,
    snapshotId: record.snapshotId,
    workspaceRootIdentity: record.workspaceRootIdentity,
    snapshotLeafRealpath: record.snapshotLeafRealpath,
    snapshotTreeDigest: record.snapshotTreeDigest,
  });
  if (marker.markerDigest !== record.ownershipMarkerDigest) {
    throw new TypeError('Project-read authority record does not bind its canonical marker');
  }
  return marker;
}

export function projectReadSnapshotMaterializationReceiptProjection(
  receipt: Omit<ProjectReadSnapshotMaterializationReceipt, 'receiptDigest'>,
): unknown {
  return {
    schemaVersion: receipt.schemaVersion,
    projectReadAuthorityId: receipt.projectReadAuthorityId,
    authorityRecordDigest: receipt.authorityRecordDigest,
    snapshotId: receipt.snapshotId,
    workspaceRootIdentity: receipt.workspaceRootIdentity,
    snapshotLeafRealpath: receipt.snapshotLeafRealpath,
    snapshotTreeDigest: receipt.snapshotTreeDigest,
    ownershipMarkerProfile: receipt.ownershipMarkerProfile,
    ownershipMarkerDigest: receipt.ownershipMarkerDigest,
    observedAt: receipt.observedAt,
  };
}

export function decodeProjectReadSnapshotMaterializationReceipt(
  value: unknown,
): ProjectReadSnapshotMaterializationReceipt {
  const parsed = materializationReceiptSchema.parse(value);
  const workspaceRootIdentity = exactAbsolutePath(
    parsed.workspaceRootIdentity,
    'Project-read materialization receipt root',
  );
  const snapshotLeafRealpath = exactAbsolutePath(
    parsed.snapshotLeafRealpath,
    'Project-read materialization receipt leaf',
  );
  assertOwnedLeaf(workspaceRootIdentity, snapshotLeafRealpath);
  const withoutDigest = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    projectReadAuthorityId: projectSourceReadAuthorityId(parsed.projectReadAuthorityId),
    authorityRecordDigest: sha256Digest(parsed.authorityRecordDigest),
    snapshotId: projectReadSnapshotId(parsed.snapshotId),
    workspaceRootIdentity,
    snapshotLeafRealpath,
    snapshotTreeDigest: sha256Digest(parsed.snapshotTreeDigest),
    ownershipMarkerProfile: parsed.ownershipMarkerProfile,
    ownershipMarkerDigest: sha256Digest(parsed.ownershipMarkerDigest),
    observedAt: isoTimestamp(parsed.observedAt),
  });
  const receiptDigest = sha256Digest(parsed.receiptDigest);
  if (
    receiptDigest !==
    digestProjectReadWorkspaceValue(
      projectReadSnapshotMaterializationReceiptProjection(withoutDigest),
    )
  ) {
    throw new TypeError('Project-read materialization receipt digest is inconsistent');
  }
  return Object.freeze({ ...withoutDigest, receiptDigest });
}

export function createProjectReadSnapshotMaterializationReceipt(
  value: ProjectSourceReadAuthorityRecord,
  observedAtValue: string,
): ProjectReadSnapshotMaterializationReceipt {
  const record = decodeProjectSourceReadAuthorityRecord(value);
  createProjectReadOwnershipMarkerForRecord(record);
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    projectReadAuthorityId: record.id,
    authorityRecordDigest: record.recordDigest,
    snapshotId: record.snapshotId,
    workspaceRootIdentity: record.workspaceRootIdentity,
    snapshotLeafRealpath: record.snapshotLeafRealpath,
    snapshotTreeDigest: record.snapshotTreeDigest,
    ownershipMarkerProfile: record.ownershipMarkerProfile,
    ownershipMarkerDigest: record.ownershipMarkerDigest,
    observedAt: isoTimestamp(observedAtValue),
  });
  return decodeProjectReadSnapshotMaterializationReceipt({
    ...withoutDigest,
    receiptDigest: digestProjectReadWorkspaceValue(
      projectReadSnapshotMaterializationReceiptProjection(withoutDigest),
    ),
  });
}

export function assertProjectReadSnapshotMaterializationReceiptMatchesRecord(
  rawReceipt: ProjectReadSnapshotMaterializationReceipt,
  rawRecord: ProjectSourceReadAuthorityRecord,
): void {
  const receipt = decodeProjectReadSnapshotMaterializationReceipt(rawReceipt);
  const record = decodeProjectSourceReadAuthorityRecord(rawRecord);
  if (
    receipt.projectReadAuthorityId !== record.id ||
    receipt.authorityRecordDigest !== record.recordDigest ||
    receipt.snapshotId !== record.snapshotId ||
    receipt.workspaceRootIdentity !== record.workspaceRootIdentity ||
    receipt.snapshotLeafRealpath !== record.snapshotLeafRealpath ||
    receipt.snapshotTreeDigest !== record.snapshotTreeDigest ||
    receipt.ownershipMarkerDigest !== record.ownershipMarkerDigest ||
    receipt.observedAt < record.issuedAt
  ) {
    throw new TypeError('Project-read materialization receipt does not bind the exact record');
  }
}

export function projectReadSnapshotCurrencyObservationProjection(
  observation: Omit<ProjectReadSnapshotCurrencyObservation, 'observationDigest'>,
): unknown {
  return {
    schemaVersion: observation.schemaVersion,
    projectReadAuthorityId: observation.projectReadAuthorityId,
    authorityRecordDigest: observation.authorityRecordDigest,
    snapshotId: observation.snapshotId,
    workspaceRootIdentity: observation.workspaceRootIdentity,
    snapshotLeafRealpath: observation.snapshotLeafRealpath,
    state: observation.state,
    observedAt: observation.observedAt,
  };
}

export function decodeProjectReadSnapshotCurrencyObservation(
  value: unknown,
): ProjectReadSnapshotCurrencyObservation {
  const parsed = snapshotCurrencyObservationSchema.parse(value);
  const workspaceRootIdentity = exactAbsolutePath(
    parsed.workspaceRootIdentity,
    'Project-read snapshot-currency root',
  );
  const snapshotLeafRealpath = exactAbsolutePath(
    parsed.snapshotLeafRealpath,
    'Project-read snapshot-currency leaf',
  );
  assertOwnedLeaf(workspaceRootIdentity, snapshotLeafRealpath);
  const withoutDigest = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    projectReadAuthorityId: projectSourceReadAuthorityId(parsed.projectReadAuthorityId),
    authorityRecordDigest: sha256Digest(parsed.authorityRecordDigest),
    snapshotId: projectReadSnapshotId(parsed.snapshotId),
    workspaceRootIdentity,
    snapshotLeafRealpath,
    state: parsed.state,
    observedAt: isoTimestamp(parsed.observedAt),
  });
  const observationDigest = sha256Digest(parsed.observationDigest);
  if (
    observationDigest !==
    digestProjectReadWorkspaceValue(projectReadSnapshotCurrencyObservationProjection(withoutDigest))
  ) {
    throw new TypeError('Project-read snapshot-currency observation digest is inconsistent');
  }
  return Object.freeze({ ...withoutDigest, observationDigest });
}

export function createProjectReadSnapshotCurrencyObservation(
  rawRecord: ProjectSourceReadAuthorityRecord,
  state: ProjectReadSnapshotCurrencyState,
  observedAtValue: string,
): ProjectReadSnapshotCurrencyObservation {
  const record = decodeProjectSourceReadAuthorityRecord(rawRecord);
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    projectReadAuthorityId: record.id,
    authorityRecordDigest: record.recordDigest,
    snapshotId: record.snapshotId,
    workspaceRootIdentity: record.workspaceRootIdentity,
    snapshotLeafRealpath: record.snapshotLeafRealpath,
    state,
    observedAt: isoTimestamp(observedAtValue),
  });
  return decodeProjectReadSnapshotCurrencyObservation({
    ...withoutDigest,
    observationDigest: digestProjectReadWorkspaceValue(
      projectReadSnapshotCurrencyObservationProjection(withoutDigest),
    ),
  });
}

export function assertProjectReadSnapshotCurrencyObservationMatchesRecord(
  rawObservation: ProjectReadSnapshotCurrencyObservation,
  rawRecord: ProjectSourceReadAuthorityRecord,
): void {
  const observation = decodeProjectReadSnapshotCurrencyObservation(rawObservation);
  const record = decodeProjectSourceReadAuthorityRecord(rawRecord);
  if (
    observation.projectReadAuthorityId !== record.id ||
    observation.authorityRecordDigest !== record.recordDigest ||
    observation.snapshotId !== record.snapshotId ||
    observation.workspaceRootIdentity !== record.workspaceRootIdentity ||
    observation.snapshotLeafRealpath !== record.snapshotLeafRealpath ||
    observation.observedAt < record.issuedAt
  ) {
    throw new TypeError('Project-read snapshot-currency observation substituted its record');
  }
}

export function projectReadWorkspaceAuthoritySnapshotProjection(
  snapshot: Omit<ProjectReadWorkspaceAuthoritySnapshotV1, 'authorityDigest'>,
): unknown {
  return {
    activeConsumers: snapshot.activeConsumers,
    authoritySequence: snapshot.authoritySequence,
    expectedSnapshots: snapshot.expectedSnapshots,
    id: snapshot.id,
    issuedAt: snapshot.issuedAt,
    schemaVersion: snapshot.schemaVersion,
  };
}

export function projectReadWorkspaceObservationProjection(
  observation: Omit<ProjectReadWorkspaceObservationV1, 'observationDigest'>,
): unknown {
  return {
    activeExternalExecutionIds: observation.activeExternalExecutionIds,
    authorityRecordDigest: observation.authorityRecordDigest,
    authoritySequence: observation.authoritySequence,
    authoritySnapshotDigest: observation.authoritySnapshotDigest,
    authoritySnapshotId: observation.authoritySnapshotId,
    classification: observation.classification,
    id: observation.id,
    observedAt: observation.observedAt,
    ownershipMarkerDigest: observation.ownershipMarkerDigest,
    ownershipMarkerProfile: observation.ownershipMarkerProfile,
    projectReadAuthorityId: observation.projectReadAuthorityId,
    schemaVersion: observation.schemaVersion,
    snapshotId: observation.snapshotId,
    snapshotLeafRealpath: observation.snapshotLeafRealpath,
    workspaceRootIdentity: observation.workspaceRootIdentity,
  };
}

export function decodeProjectReadWorkspaceAuthoritySnapshot(
  value: unknown,
): ProjectReadWorkspaceAuthoritySnapshot {
  const parsed = authoritySnapshotSchema.parse(value);
  const expectedSnapshots = Object.freeze(
    parsed.expectedSnapshots.map((entry) => {
      const workspaceRootIdentity = exactAbsolutePath(
        entry.workspaceRootIdentity,
        'Project-read workspace authority root',
      );
      const snapshotLeafRealpath = exactAbsolutePath(
        entry.snapshotLeafRealpath,
        'Project-read workspace authority leaf',
      );
      assertOwnedLeaf(workspaceRootIdentity, snapshotLeafRealpath);
      return Object.freeze({
        attemptId: attemptId(entry.attemptId),
        authorityRecordDigest: sha256Digest(entry.authorityRecordDigest),
        ownershipMarkerDigest: sha256Digest(entry.ownershipMarkerDigest),
        ownershipMarkerProfile: entry.ownershipMarkerProfile,
        projectReadAuthorityId: projectSourceReadAuthorityId(entry.projectReadAuthorityId),
        retention: entry.retention,
        snapshotId: projectReadSnapshotId(entry.snapshotId),
        snapshotLeafRealpath,
        workspaceRootIdentity,
      });
    }),
  );
  assertStringSortedUnique(
    expectedSnapshots.map((entry) => entry.snapshotId),
    'Project-read workspace authority snapshot IDs',
  );
  if (
    new Set(expectedSnapshots.map((entry) => entry.attemptId)).size !== expectedSnapshots.length ||
    new Set(expectedSnapshots.map((entry) => entry.projectReadAuthorityId)).size !==
      expectedSnapshots.length ||
    new Set(expectedSnapshots.map((entry) => entry.snapshotLeafRealpath)).size !==
      expectedSnapshots.length
  ) {
    throw new TypeError(
      'Project-read workspace authority entries must bind unique attempt, authority, and leaf identities',
    );
  }
  assertPathsDoNotOverlap(
    expectedSnapshots.map((entry) => entry.snapshotLeafRealpath),
    'Project-read workspace authority snapshot leaves',
  );

  const activeConsumers = Object.freeze(
    parsed.activeConsumers.map((entry) =>
      Object.freeze({
        attemptId: attemptId(entry.attemptId),
        externalExecutionId: externalExecutionId(entry.externalExecutionId),
        projectReadAuthorityId: projectSourceReadAuthorityId(entry.projectReadAuthorityId),
        snapshotId: projectReadSnapshotId(entry.snapshotId),
      }),
    ),
  );
  assertStringSortedUnique(
    activeConsumers.map((entry) => entry.externalExecutionId),
    'Project-read workspace active-consumer IDs',
  );
  const expectedBySnapshot = new Map(expectedSnapshots.map((entry) => [entry.snapshotId, entry]));
  const consumedSnapshots = new Set<string>();
  for (const consumer of activeConsumers) {
    const expected = expectedBySnapshot.get(consumer.snapshotId);
    if (
      expected?.retention !== ProjectReadWorkspaceRetention.CURRENT ||
      expected.attemptId !== consumer.attemptId ||
      expected.projectReadAuthorityId !== consumer.projectReadAuthorityId ||
      consumedSnapshots.has(consumer.snapshotId)
    ) {
      throw new TypeError('Project-read workspace active consumer lacks exact current authority');
    }
    consumedSnapshots.add(consumer.snapshotId);
  }

  const withoutDigest = Object.freeze({
    activeConsumers,
    authoritySequence: parsed.authoritySequence,
    expectedSnapshots,
    id: projectReadWorkspaceAuthoritySnapshotId(parsed.id),
    issuedAt: isoTimestamp(parsed.issuedAt),
    schemaVersion: parsed.schemaVersion,
  });
  const authorityDigest = sha256Digest(parsed.authorityDigest);
  if (
    authorityDigest !==
    digestProjectReadWorkspaceValue(projectReadWorkspaceAuthoritySnapshotProjection(withoutDigest))
  ) {
    throw new TypeError('Project-read workspace authority snapshot digest is inconsistent');
  }
  return Object.freeze({ ...withoutDigest, authorityDigest });
}

export function decodeProjectReadWorkspaceObservation(
  value: unknown,
): ProjectReadWorkspaceObservation {
  const parsed = observationSchema.parse(value);
  const workspaceRootIdentity = exactAbsolutePath(
    parsed.workspaceRootIdentity,
    'Project-read workspace observation root',
  );
  const snapshotLeafRealpath = exactAbsolutePath(
    parsed.snapshotLeafRealpath,
    'Project-read workspace observation leaf',
  );
  assertOwnedLeaf(workspaceRootIdentity, snapshotLeafRealpath);
  const activeExternalExecutionIds = Object.freeze(
    parsed.activeExternalExecutionIds.map((id) => externalExecutionId(id)),
  );
  assertStringSortedUnique(
    activeExternalExecutionIds,
    'Project-read workspace observation active-consumer IDs',
  );
  const authorityRecordDigest =
    parsed.authorityRecordDigest === null ? null : sha256Digest(parsed.authorityRecordDigest);
  const ownershipMarkerDigest =
    parsed.ownershipMarkerDigest === null ? null : sha256Digest(parsed.ownershipMarkerDigest);
  const projectReadAuthorityId =
    parsed.projectReadAuthorityId === null
      ? null
      : projectSourceReadAuthorityId(parsed.projectReadAuthorityId);
  const snapshotId = parsed.snapshotId === null ? null : projectReadSnapshotId(parsed.snapshotId);
  const markerPairIsComplete =
    (parsed.ownershipMarkerProfile === null) === (ownershipMarkerDigest === null);
  const ownedIdentityIsComplete =
    projectReadAuthorityId !== null &&
    snapshotId !== null &&
    parsed.ownershipMarkerProfile !== null &&
    ownershipMarkerDigest !== null;
  if (!markerPairIsComplete) {
    throw new TypeError('Project-read workspace observation ownership marker is partial');
  }
  switch (parsed.classification) {
    case ProjectReadWorkspaceClassification.OWNED_CURRENT:
      if (!ownedIdentityIsComplete || authorityRecordDigest === null) {
        throw new TypeError('Owned-current project-read observation lacks persisted authority');
      }
      break;
    case ProjectReadWorkspaceClassification.OWNED_RETAINED:
      if (
        !ownedIdentityIsComplete ||
        authorityRecordDigest === null ||
        activeExternalExecutionIds.length !== 0
      ) {
        throw new TypeError('Owned-retained project-read observation is not inactive authority');
      }
      break;
    case ProjectReadWorkspaceClassification.OWNED_ORPHANED:
      if (
        !ownedIdentityIsComplete ||
        authorityRecordDigest !== null ||
        activeExternalExecutionIds.length !== 0
      ) {
        throw new TypeError(
          'Owned-orphaned project-read observation is not exact absent authority',
        );
      }
      break;
    case ProjectReadWorkspaceClassification.UNSAFE:
      break;
  }

  const withoutDigest = Object.freeze({
    activeExternalExecutionIds,
    authorityRecordDigest,
    authoritySequence: parsed.authoritySequence,
    authoritySnapshotDigest: sha256Digest(parsed.authoritySnapshotDigest),
    authoritySnapshotId: projectReadWorkspaceAuthoritySnapshotId(parsed.authoritySnapshotId),
    classification: parsed.classification,
    id: projectReadWorkspaceObservationId(parsed.id),
    observedAt: isoTimestamp(parsed.observedAt),
    ownershipMarkerDigest,
    ownershipMarkerProfile: parsed.ownershipMarkerProfile,
    projectReadAuthorityId,
    schemaVersion: parsed.schemaVersion,
    snapshotId,
    snapshotLeafRealpath,
    workspaceRootIdentity,
  });
  const observationDigest = sha256Digest(parsed.observationDigest);
  if (
    observationDigest !==
    digestProjectReadWorkspaceValue(projectReadWorkspaceObservationProjection(withoutDigest))
  ) {
    throw new TypeError('Project-read workspace observation digest is inconsistent');
  }
  return Object.freeze({ ...withoutDigest, observationDigest });
}

export function assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(
  observation: ProjectReadWorkspaceObservation,
  authoritySnapshot: ProjectReadWorkspaceAuthoritySnapshot,
): void {
  if (
    observation.authoritySnapshotId !== authoritySnapshot.id ||
    observation.authoritySnapshotDigest !== authoritySnapshot.authorityDigest ||
    observation.authoritySequence !== authoritySnapshot.authoritySequence
  ) {
    throw new TypeError('Project-read workspace observation does not bind its authority snapshot');
  }

  if (observation.classification === ProjectReadWorkspaceClassification.UNSAFE) {
    return;
  }

  const projectReadAuthorityId = observation.projectReadAuthorityId;
  const snapshotId = observation.snapshotId;
  if (projectReadAuthorityId === null || snapshotId === null) {
    throw new TypeError('Owned project-read workspace observation lacks an exact identity');
  }

  if (observation.classification === ProjectReadWorkspaceClassification.OWNED_ORPHANED) {
    if (
      authoritySnapshot.expectedSnapshots.some(
        (entry) =>
          entry.projectReadAuthorityId === projectReadAuthorityId ||
          entry.snapshotId === snapshotId ||
          pathsOverlap(entry.snapshotLeafRealpath, observation.snapshotLeafRealpath),
      )
    ) {
      throw new TypeError(
        'Owned-orphaned project-read observation collides with retained authority',
      );
    }
    return;
  }

  const expected = authoritySnapshot.expectedSnapshots.find(
    (entry) => entry.projectReadAuthorityId === projectReadAuthorityId,
  );
  const expectedRetention =
    observation.classification === ProjectReadWorkspaceClassification.OWNED_CURRENT
      ? ProjectReadWorkspaceRetention.CURRENT
      : ProjectReadWorkspaceRetention.RETAINED;
  if (
    expected?.retention !== expectedRetention ||
    expected.snapshotId !== snapshotId ||
    expected.authorityRecordDigest !== observation.authorityRecordDigest ||
    expected.ownershipMarkerProfile !== observation.ownershipMarkerProfile ||
    expected.ownershipMarkerDigest !== observation.ownershipMarkerDigest ||
    expected.snapshotLeafRealpath !== observation.snapshotLeafRealpath ||
    expected.workspaceRootIdentity !== observation.workspaceRootIdentity
  ) {
    throw new TypeError(
      'Owned project-read workspace observation does not match retained authority',
    );
  }

  const expectedActiveExternalExecutionIds = authoritySnapshot.activeConsumers
    .filter((consumer) => consumer.snapshotId === snapshotId)
    .map((consumer) => consumer.externalExecutionId);
  if (
    !sameOrderedStrings(observation.activeExternalExecutionIds, expectedActiveExternalExecutionIds)
  ) {
    throw new TypeError(
      'Owned project-read workspace observation active consumers do not match authority',
    );
  }
}
