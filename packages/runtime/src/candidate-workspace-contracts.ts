import { createHash } from 'node:crypto';
import { isAbsolute, relative, sep } from 'node:path';

import {
  CandidateGenerationState,
  candidateGenerationId,
  candidateId,
  decodeCandidateGeneration,
  goalId,
  goalRevision,
  isoTimestamp,
  sha256Digest,
  workflowId,
  workflowVersion,
  type CandidateGeneration,
  type CandidateGenerationId,
  type CandidateId,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowVersion,
} from '@codeclosure/domain';
import { z } from 'zod';

import { canonicalizeJson } from './canonical-json.js';

export const CandidateWorkspaceAccessMode = {
  MUTABLE: 'MUTABLE',
  READ_ONLY: 'READ_ONLY',
} as const;
export type CandidateWorkspaceAccessMode =
  (typeof CandidateWorkspaceAccessMode)[keyof typeof CandidateWorkspaceAccessMode];

export const CandidateWorkspaceLeaseLifecyclePolicy = {
  RELEASE_EXPLICITLY: 'RELEASE_EXPLICITLY',
  REVOKE_ON_FREEZE: 'REVOKE_ON_FREEZE',
} as const;
export type CandidateWorkspaceLeaseLifecyclePolicy =
  (typeof CandidateWorkspaceLeaseLifecyclePolicy)[keyof typeof CandidateWorkspaceLeaseLifecyclePolicy];

export interface CandidateWorkspaceLease {
  readonly accessMode: CandidateWorkspaceAccessMode;
  readonly allowedPathPolicyDigest: Sha256Digest;
  readonly allowedPaths: readonly string[];
  readonly candidateId: CandidateId;
  readonly candidateDigest: Sha256Digest;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly candidateGenerationVersion: number;
  readonly forbiddenRoots: readonly string[];
  readonly generationSequence: number;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly id: string;
  readonly issuedAt: IsoTimestamp;
  readonly leaseDigest: Sha256Digest;
  readonly lifecyclePolicy: CandidateWorkspaceLeaseLifecyclePolicy;
  readonly parentGenerationId: CandidateGenerationId | null;
  readonly reservedPathPolicy: 'M2_CONTROLLED_COPY_V1';
  readonly retentionPolicy: 'RUNTIME_OWNED';
  readonly root: string;
  readonly schemaVersion: 1;
  readonly sourceGitMetadataDigest: Sha256Digest;
  readonly sourceProjectRoot: string;
  readonly sourceTreeDigest: Sha256Digest;
  readonly state: 'ACTIVE';
  readonly version: number;
  readonly workspaceRootIdentity: string;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
}

export interface CandidateWorkspaceLeaseRequest {
  readonly accessMode: CandidateWorkspaceAccessMode;
  readonly allowedPaths: readonly string[];
  readonly forbiddenRoots: readonly string[];
  readonly generation: CandidateGeneration;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly id: string;
  readonly issuedAt: IsoTimestamp;
  readonly schemaVersion: 1;
  readonly version: number;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
}

export interface CandidateWorkspaceLeasePort {
  issueLease(request: CandidateWorkspaceLeaseRequest): unknown;
  releaseLease(lease: CandidateWorkspaceLease): void;
}

export interface CandidateWorkspaceLeaseAuthorityPort {
  assertLeaseCurrent(lease: CandidateWorkspaceLease): CandidateWorkspaceLease;
}

export const CandidateWorkspaceRetention = {
  CURRENT: 'CURRENT',
  RETAINED: 'RETAINED',
} as const;
export type CandidateWorkspaceRetention =
  (typeof CandidateWorkspaceRetention)[keyof typeof CandidateWorkspaceRetention];

export interface CandidateWorkspaceExpectedGeneration {
  readonly generation: CandidateGeneration;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly retention: CandidateWorkspaceRetention;
  readonly workflowId: WorkflowId;
  readonly workflowVersion: WorkflowVersion;
}

export interface CandidateWorkspaceAuthoritySnapshot {
  readonly authorityDigest: Sha256Digest;
  /** Persisted Runtime/Store audit sequence. Filesystem adapters MUST NOT allocate it. */
  readonly authoritySequence: number;
  readonly expectedGenerations: readonly CandidateWorkspaceExpectedGeneration[];
  readonly id: string;
  readonly issuedAt: IsoTimestamp;
  readonly schemaVersion: 1;
}

export interface CandidateWorkspaceCleanupGrant {
  readonly authorityDigest: Sha256Digest;
  readonly authoritySequence: number;
  readonly authoritySnapshotId: string;
  readonly candidateRoot: string;
  readonly generationId: CandidateGenerationId;
  readonly grantDigest: Sha256Digest;
  readonly id: string;
  readonly issuedAt: IsoTimestamp;
  readonly lifecyclePolicy: 'ONE_TIME';
  readonly ownershipDigest: Sha256Digest;
  readonly schemaVersion: 1;
  readonly state: 'ACTIVE';
  readonly version: number;
  readonly workspaceRootIdentity: string;
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

function nonBlankString(value: unknown, field: string, maximumBytes = 16_384): string {
  if (
    typeof value !== 'string' ||
    value.trim().length === 0 ||
    Buffer.byteLength(value, 'utf8') > maximumBytes ||
    value.includes('\u0000')
  ) {
    throw new TypeError(`${field} must be a bounded non-blank string`);
  }
  return value;
}

function positiveInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${field} must be a positive safe integer`);
  }
  return value;
}

function portableRelativePath(value: unknown, field: string): string {
  const path = nonBlankString(value, field, 4_096);
  if (path !== path.normalize('NFC') || isAbsolute(path) || path.includes('\\')) {
    throw new TypeError(`${field} must be a normalized portable relative path`);
  }
  const components = path.split('/');
  if (
    components.some(
      (component) =>
        component.length === 0 ||
        component === '.' ||
        component === '..' ||
        containsControlCharacter(component) ||
        !portablePathComponentPattern.test(component) ||
        windowsReservedNamePattern.test(component) ||
        component.toLocaleLowerCase('en-US') === '.git' ||
        component.toLocaleLowerCase('en-US') === '.codeclosure',
    )
  ) {
    throw new TypeError(`${field} contains an unsafe path component`);
  }
  return path;
}

function absoluteNormalizedPath(value: unknown, field: string): string {
  const path = nonBlankString(value, field);
  if (!isAbsolute(path) || path !== path.normalize('NFC')) {
    throw new TypeError(`${field} must be an absolute normalized path`);
  }
  return path;
}

function sortedUnique<Value extends string>(
  values: readonly Value[],
  field: string,
  decode: (value: unknown, field: string) => Value,
): readonly Value[] {
  if (!Array.isArray(values) || values.length > 4_096) {
    throw new TypeError(`${field} must be a bounded array`);
  }
  const decoded = values.map((value, index) => decode(value, `${field}[${String(index)}]`));
  const sorted = [...decoded].sort();
  if (
    new Set(sorted).size !== sorted.length ||
    JSON.stringify(decoded) !== JSON.stringify(sorted)
  ) {
    throw new TypeError(`${field} must be sorted and unique`);
  }
  return Object.freeze(sorted);
}

function isSameOrWithin(candidate: string, parent: string): boolean {
  const path = relative(parent, candidate);
  return path === '' || (!path.startsWith(`..${sep}`) && path !== '..' && !isAbsolute(path));
}

function pathsOverlap(left: string, right: string): boolean {
  return isSameOrWithin(left, right) || isSameOrWithin(right, left);
}

export function digestCandidateWorkspaceValue(value: unknown): Sha256Digest {
  return sha256Digest(
    `sha256:${createHash('sha256').update(canonicalizeJson(value), 'utf8').digest('hex')}`,
  );
}

export function decodeCandidateWorkspaceDigest(value: unknown): Sha256Digest {
  if (typeof value !== 'string') {
    throw new TypeError('Candidate workspace digest must be a string');
  }
  return sha256Digest(value);
}

export function candidateWorkspaceAllowedPathProjection(allowedPaths: readonly string[]): unknown {
  return {
    allowedPaths,
    reservedPathPolicy: 'M2_CONTROLLED_COPY_V1',
  };
}

export function candidateWorkspaceAuthorityProjection(
  snapshot: Omit<CandidateWorkspaceAuthoritySnapshot, 'authorityDigest'>,
): unknown {
  return {
    authoritySequence: snapshot.authoritySequence,
    expectedGenerations: snapshot.expectedGenerations,
    id: snapshot.id,
    issuedAt: snapshot.issuedAt,
    schemaVersion: snapshot.schemaVersion,
  };
}

export function candidateWorkspaceCleanupGrantProjection(
  grant: CandidateWorkspaceCleanupGrantProjectionInput,
): unknown {
  return {
    authorityDigest: grant.authorityDigest,
    authoritySequence: grant.authoritySequence,
    authoritySnapshotId: grant.authoritySnapshotId,
    candidateRoot: grant.candidateRoot,
    generationId: grant.generationId,
    id: grant.id,
    issuedAt: grant.issuedAt,
    lifecyclePolicy: grant.lifecyclePolicy,
    ownershipDigest: grant.ownershipDigest,
    schemaVersion: grant.schemaVersion,
    state: grant.state,
    version: grant.version,
    workspaceRootIdentity: grant.workspaceRootIdentity,
  };
}

type WidenCandidateWorkspaceScalar<Value> = Value extends string
  ? string
  : Value extends number
    ? number
    : Value extends readonly (infer Entry)[]
      ? readonly WidenCandidateWorkspaceScalar<Entry>[]
      : Value;

export type CandidateWorkspaceCleanupGrantProjectionInput = {
  readonly [
    Key in keyof Omit<CandidateWorkspaceCleanupGrant, 'grantDigest'>
  ]: WidenCandidateWorkspaceScalar<Omit<CandidateWorkspaceCleanupGrant, 'grantDigest'>[Key]>;
};

export type CandidateWorkspaceLeaseProjectionInput = {
  readonly [
    Key in keyof Omit<CandidateWorkspaceLease, 'leaseDigest'>
  ]: WidenCandidateWorkspaceScalar<Omit<CandidateWorkspaceLease, 'leaseDigest'>[Key]>;
};

export function candidateWorkspaceLeaseProjection(
  lease: CandidateWorkspaceLeaseProjectionInput,
): unknown {
  return {
    accessMode: lease.accessMode,
    allowedPathPolicyDigest: lease.allowedPathPolicyDigest,
    allowedPaths: lease.allowedPaths,
    candidateId: lease.candidateId,
    candidateDigest: lease.candidateDigest,
    candidateGenerationId: lease.candidateGenerationId,
    candidateGenerationVersion: lease.candidateGenerationVersion,
    forbiddenRoots: lease.forbiddenRoots,
    generationSequence: lease.generationSequence,
    goalId: lease.goalId,
    goalRevision: lease.goalRevision,
    id: lease.id,
    issuedAt: lease.issuedAt,
    lifecyclePolicy: lease.lifecyclePolicy,
    parentGenerationId: lease.parentGenerationId,
    reservedPathPolicy: lease.reservedPathPolicy,
    retentionPolicy: lease.retentionPolicy,
    root: lease.root,
    schemaVersion: lease.schemaVersion,
    sourceGitMetadataDigest: lease.sourceGitMetadataDigest,
    sourceProjectRoot: lease.sourceProjectRoot,
    sourceTreeDigest: lease.sourceTreeDigest,
    state: lease.state,
    version: lease.version,
    workspaceRootIdentity: lease.workspaceRootIdentity,
    workflowId: lease.workflowId,
    workflowVersion: lease.workflowVersion,
  };
}

const expectedGenerationSchema = z
  .object({
    generation: z.unknown(),
    goalId: z.string(),
    goalRevision: z.number(),
    retention: z.enum([CandidateWorkspaceRetention.CURRENT, CandidateWorkspaceRetention.RETAINED]),
    workflowId: z.string(),
    workflowVersion: z.number(),
  })
  .strict();

const authoritySnapshotSchema = z
  .object({
    authorityDigest: z.string(),
    authoritySequence: z.number(),
    expectedGenerations: z.array(expectedGenerationSchema).max(4_096),
    id: z.string(),
    issuedAt: z.string(),
    schemaVersion: z.literal(1),
  })
  .strict();

const cleanupGrantSchema = z
  .object({
    authorityDigest: z.string(),
    authoritySequence: z.number(),
    authoritySnapshotId: z.string(),
    candidateRoot: z.string(),
    generationId: z.string(),
    grantDigest: z.string(),
    id: z.string(),
    issuedAt: z.string(),
    lifecyclePolicy: z.literal('ONE_TIME'),
    ownershipDigest: z.string(),
    schemaVersion: z.literal(1),
    state: z.literal('ACTIVE'),
    version: z.number(),
    workspaceRootIdentity: z.string(),
  })
  .strict();

const leaseSchema = z
  .object({
    accessMode: z.enum([
      CandidateWorkspaceAccessMode.MUTABLE,
      CandidateWorkspaceAccessMode.READ_ONLY,
    ]),
    allowedPathPolicyDigest: z.string(),
    allowedPaths: z.array(z.string()).max(4_096),
    candidateId: z.string(),
    candidateDigest: z.string(),
    candidateGenerationId: z.string(),
    candidateGenerationVersion: z.number(),
    forbiddenRoots: z.array(z.string()).max(4_096),
    generationSequence: z.number(),
    goalId: z.string(),
    goalRevision: z.number(),
    id: z.string(),
    issuedAt: z.string(),
    leaseDigest: z.string(),
    lifecyclePolicy: z.enum([
      CandidateWorkspaceLeaseLifecyclePolicy.RELEASE_EXPLICITLY,
      CandidateWorkspaceLeaseLifecyclePolicy.REVOKE_ON_FREEZE,
    ]),
    parentGenerationId: z.string().nullable(),
    reservedPathPolicy: z.literal('M2_CONTROLLED_COPY_V1'),
    retentionPolicy: z.literal('RUNTIME_OWNED'),
    root: z.string(),
    schemaVersion: z.literal(1),
    sourceGitMetadataDigest: z.string(),
    sourceProjectRoot: z.string(),
    sourceTreeDigest: z.string(),
    state: z.literal('ACTIVE'),
    version: z.number(),
    workspaceRootIdentity: z.string(),
    workflowId: z.string(),
    workflowVersion: z.number(),
  })
  .strict();

export function decodeCandidateWorkspaceLease(value: unknown): CandidateWorkspaceLease {
  const parsed = leaseSchema.parse(value);
  const allowedPaths = sortedUnique(
    parsed.allowedPaths,
    'lease.allowedPaths',
    portableRelativePath,
  );
  if (allowedPaths.length === 0) {
    throw new TypeError('lease.allowedPaths must not be empty');
  }
  const forbiddenRoots = sortedUnique(
    parsed.forbiddenRoots,
    'lease.forbiddenRoots',
    absoluteNormalizedPath,
  );
  const root = absoluteNormalizedPath(parsed.root, 'lease.root');
  const sourceProjectRoot = absoluteNormalizedPath(
    parsed.sourceProjectRoot,
    'lease.sourceProjectRoot',
  );
  const workspaceRootIdentity = absoluteNormalizedPath(
    parsed.workspaceRootIdentity,
    'lease.workspaceRootIdentity',
  );
  if (
    !forbiddenRoots.includes(sourceProjectRoot) ||
    root === workspaceRootIdentity ||
    !isSameOrWithin(root, workspaceRootIdentity) ||
    forbiddenRoots.some(
      (forbidden) =>
        pathsOverlap(root, forbidden) || pathsOverlap(workspaceRootIdentity, forbidden),
    )
  ) {
    throw new TypeError('Candidate workspace lease containment is invalid');
  }
  const parentGenerationId =
    parsed.parentGenerationId === null ? null : candidateGenerationId(parsed.parentGenerationId);
  const lease = Object.freeze({
    accessMode: parsed.accessMode,
    allowedPathPolicyDigest: sha256Digest(parsed.allowedPathPolicyDigest),
    allowedPaths,
    candidateId: candidateId(parsed.candidateId),
    candidateDigest: sha256Digest(parsed.candidateDigest),
    candidateGenerationId: candidateGenerationId(parsed.candidateGenerationId),
    candidateGenerationVersion: positiveInteger(
      parsed.candidateGenerationVersion,
      'lease.candidateGenerationVersion',
    ),
    forbiddenRoots,
    generationSequence: positiveInteger(parsed.generationSequence, 'lease.generationSequence'),
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    id: nonBlankString(parsed.id, 'lease.id', 1_024),
    issuedAt: isoTimestamp(parsed.issuedAt),
    leaseDigest: sha256Digest(parsed.leaseDigest),
    lifecyclePolicy: parsed.lifecyclePolicy,
    parentGenerationId,
    reservedPathPolicy: parsed.reservedPathPolicy,
    retentionPolicy: parsed.retentionPolicy,
    root,
    schemaVersion: parsed.schemaVersion,
    sourceGitMetadataDigest: sha256Digest(parsed.sourceGitMetadataDigest),
    sourceProjectRoot,
    sourceTreeDigest: sha256Digest(parsed.sourceTreeDigest),
    state: parsed.state,
    version: positiveInteger(parsed.version, 'lease.version'),
    workspaceRootIdentity,
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
  });
  const expectedLifecycle =
    lease.accessMode === CandidateWorkspaceAccessMode.MUTABLE
      ? CandidateWorkspaceLeaseLifecyclePolicy.REVOKE_ON_FREEZE
      : CandidateWorkspaceLeaseLifecyclePolicy.RELEASE_EXPLICITLY;
  if (lease.lifecyclePolicy !== expectedLifecycle) {
    throw new TypeError('Candidate workspace lease lifecycle does not match its access mode');
  }
  if (
    lease.allowedPathPolicyDigest !==
      digestCandidateWorkspaceValue(candidateWorkspaceAllowedPathProjection(lease.allowedPaths)) ||
    lease.leaseDigest !== digestCandidateWorkspaceValue(candidateWorkspaceLeaseProjection(lease))
  ) {
    throw new TypeError('Candidate workspace lease digest is inconsistent');
  }
  return lease;
}

export function decodeCandidateWorkspaceAuthoritySnapshot(
  value: unknown,
): CandidateWorkspaceAuthoritySnapshot {
  const parsed = authoritySnapshotSchema.parse(value);
  const expectedGenerations = parsed.expectedGenerations.map((entry) =>
    Object.freeze({
      generation: decodeCandidateGeneration(entry.generation),
      goalId: goalId(entry.goalId),
      goalRevision: goalRevision(entry.goalRevision),
      retention: entry.retention,
      workflowId: workflowId(entry.workflowId),
      workflowVersion: workflowVersion(entry.workflowVersion),
    }),
  );
  const generationIds = expectedGenerations.map((entry) => entry.generation.id);
  if (
    new Set(generationIds).size !== generationIds.length ||
    JSON.stringify(generationIds) !== JSON.stringify([...generationIds].sort())
  ) {
    throw new TypeError('Candidate workspace authority generations must be uniquely sorted');
  }
  const currentCandidates = new Set<string>();
  for (const entry of expectedGenerations) {
    if (entry.retention === CandidateWorkspaceRetention.CURRENT) {
      if (currentCandidates.has(entry.generation.candidateId)) {
        throw new TypeError('Candidate workspace authority has multiple current generations');
      }
      currentCandidates.add(entry.generation.candidateId);
    }
  }
  const withoutDigest = Object.freeze({
    authoritySequence: positiveInteger(
      parsed.authoritySequence,
      'workspace authority.authoritySequence',
    ),
    expectedGenerations: Object.freeze(expectedGenerations),
    id: nonBlankString(parsed.id, 'workspace authority.id', 1_024),
    issuedAt: isoTimestamp(parsed.issuedAt),
    schemaVersion: parsed.schemaVersion,
  });
  const authorityDigest = sha256Digest(parsed.authorityDigest);
  if (
    authorityDigest !==
    digestCandidateWorkspaceValue(candidateWorkspaceAuthorityProjection(withoutDigest))
  ) {
    throw new TypeError('Candidate workspace authority digest is inconsistent');
  }
  return Object.freeze({ ...withoutDigest, authorityDigest });
}

export function decodeCandidateWorkspaceCleanupGrant(
  value: unknown,
): CandidateWorkspaceCleanupGrant {
  const parsed = cleanupGrantSchema.parse(value);
  const candidateRoot = absoluteNormalizedPath(parsed.candidateRoot, 'cleanup grant.candidateRoot');
  const workspaceRootIdentity = absoluteNormalizedPath(
    parsed.workspaceRootIdentity,
    'cleanup grant.workspaceRootIdentity',
  );
  if (
    candidateRoot === workspaceRootIdentity ||
    !isSameOrWithin(candidateRoot, workspaceRootIdentity)
  ) {
    throw new TypeError('Candidate workspace cleanup target is outside its owned root');
  }
  const withoutDigest = Object.freeze({
    authorityDigest: sha256Digest(parsed.authorityDigest),
    authoritySequence: positiveInteger(parsed.authoritySequence, 'cleanup grant.authoritySequence'),
    authoritySnapshotId: nonBlankString(
      parsed.authoritySnapshotId,
      'cleanup grant.authoritySnapshotId',
      1_024,
    ),
    candidateRoot,
    generationId: candidateGenerationId(parsed.generationId),
    id: nonBlankString(parsed.id, 'cleanup grant.id', 1_024),
    issuedAt: isoTimestamp(parsed.issuedAt),
    lifecyclePolicy: parsed.lifecyclePolicy,
    ownershipDigest: sha256Digest(parsed.ownershipDigest),
    schemaVersion: parsed.schemaVersion,
    state: parsed.state,
    version: positiveInteger(parsed.version, 'cleanup grant.version'),
    workspaceRootIdentity,
  });
  const grantDigest = sha256Digest(parsed.grantDigest);
  if (
    grantDigest !==
    digestCandidateWorkspaceValue(candidateWorkspaceCleanupGrantProjection(withoutDigest))
  ) {
    throw new TypeError('Candidate workspace cleanup grant digest is inconsistent');
  }
  return Object.freeze({ ...withoutDigest, grantDigest });
}

export function validateCandidateWorkspaceLeaseRequest(
  rawRequest: CandidateWorkspaceLeaseRequest,
): CandidateWorkspaceLeaseRequest {
  const generation = decodeCandidateGeneration(rawRequest.generation);
  const accessMode = z
    .enum([CandidateWorkspaceAccessMode.MUTABLE, CandidateWorkspaceAccessMode.READ_ONLY])
    .parse(rawRequest.accessMode);
  const allowedPaths = sortedUnique(
    rawRequest.allowedPaths,
    'lease request.allowedPaths',
    portableRelativePath,
  );
  if (allowedPaths.length === 0) {
    throw new TypeError('lease request.allowedPaths must not be empty');
  }
  const forbiddenRoots = sortedUnique(
    rawRequest.forbiddenRoots,
    'lease request.forbiddenRoots',
    absoluteNormalizedPath,
  );
  if (
    (accessMode === CandidateWorkspaceAccessMode.MUTABLE &&
      generation.state !== CandidateGenerationState.MUTABLE) ||
    (accessMode === CandidateWorkspaceAccessMode.READ_ONLY &&
      generation.state !== CandidateGenerationState.FROZEN &&
      generation.state !== CandidateGenerationState.REJECTED &&
      generation.state !== CandidateGenerationState.ACCEPTED)
  ) {
    throw new TypeError('lease request access mode does not match Candidate state');
  }
  return Object.freeze({
    accessMode,
    allowedPaths,
    forbiddenRoots,
    generation,
    goalId: goalId(rawRequest.goalId),
    goalRevision: goalRevision(rawRequest.goalRevision),
    id: nonBlankString(rawRequest.id, 'lease request.id', 1_024),
    issuedAt: isoTimestamp(rawRequest.issuedAt),
    schemaVersion: z.literal(1).parse(rawRequest.schemaVersion),
    version: positiveInteger(rawRequest.version, 'lease request.version'),
    workflowId: workflowId(rawRequest.workflowId),
    workflowVersion: workflowVersion(rawRequest.workflowVersion),
  });
}
