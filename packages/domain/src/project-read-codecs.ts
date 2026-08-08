import { z } from 'zod';

import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_GIT_STATE_PROFILE,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  PROJECT_READ_SOURCE_TREE_PROFILE,
  PROJECT_READ_SOURCE_TREE_V1_BOUNDS,
  ProjectReadFileMode,
  ProjectReadLifecyclePolicy,
  ProjectReadModelUsableNetworkPolicy,
  ProjectReadRetentionPolicy,
  ProjectReadSnapshotAccessMode,
  ProjectReadSourceCheckoutAccess,
  assertProjectReadGitStateInvariant,
  assertProjectReadSourceTreeInvariant,
  assertProjectSourceReadAuthorityInvariant,
  type ProjectReadGitStateProjection,
  type ProjectReadSourceTreeProjection,
  type ProjectSourceReadAuthorityRecord,
} from './project-read.js';
import {
  attemptId,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  projectReadSnapshotId,
  projectSourceReadAuthorityId,
  sha256Digest,
  workflowId,
  workflowVersion,
} from './identifiers.js';
import { WorkflowPhase } from './model.js';

const boundedStringSchema = z
  .string()
  .max(16_384)
  .refine(
    (value) =>
      value.trim().length > 0 && !value.includes('\u0000') && value === value.normalize('NFC'),
  );
const pathSchema = boundedStringSchema.refine(
  (value) =>
    Buffer.byteLength(value, 'utf8') <= PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumPathBytes,
);
const digestSchema = z.string();
const nonNegativeSafeIntegerSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const sourceTreeEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    path: pathSchema,
    mode: z.enum(Object.values(ProjectReadFileMode)),
    size: nonNegativeSafeIntegerSchema.max(PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumFileBytes),
    contentDigest: digestSchema,
  })
  .strict();

const sourceTreeSchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.literal(PROJECT_READ_SOURCE_TREE_PROFILE),
    entries: z
      .array(sourceTreeEntrySchema)
      .max(PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumFileCount),
    fileCount: nonNegativeSafeIntegerSchema,
    totalBytes: nonNegativeSafeIntegerSchema.max(
      PROJECT_READ_SOURCE_TREE_V1_BOUNDS.maximumTotalBytes,
    ),
    projectionDigest: digestSchema,
  })
  .strict();

const gitStateSchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.literal(PROJECT_READ_GIT_STATE_PROFILE),
    sourceProjectRoot: boundedStringSchema,
    repositoryControlRootIdentity: boundedStringSchema,
    headCommit: boundedStringSchema,
    selectedPathSetDigest: digestSchema,
    stagedIndexManifestDigest: digestSchema,
    porcelainV2Digest: digestSchema,
    projectionDigest: digestSchema,
  })
  .strict();

const projectSourceReadAuthoritySchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    goalId: z.string(),
    goalRevision: positiveSafeIntegerSchema,
    workflowId: z.string(),
    workflowVersion: positiveSafeIntegerSchema,
    phase: z.enum([WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN]),
    attemptId: z.string(),
    normalizedProjectRoot: boundedStringSchema,
    resolvedProjectRoot: boundedStringSchema,
    repositoryControlRootIdentity: boundedStringSchema,
    sourceTree: sourceTreeSchema,
    gitState: gitStateSchema,
    workspaceRootIdentity: boundedStringSchema,
    snapshotId: z.string(),
    snapshotLeafRealpath: boundedStringSchema,
    snapshotTreeDigest: digestSchema,
    ownershipMarkerProfile: z.literal(PROJECT_READ_OWNERSHIP_MARKER_PROFILE),
    ownershipMarkerDigest: digestSchema,
    policyBundleId: z.string(),
    policyBundleVersion: boundedStringSchema,
    policyBundleDigest: digestSchema,
    executionProfileId: z.string(),
    executionProfileVersion: boundedStringSchema,
    executionProfileDigest: digestSchema,
    phaseDispatchEntryDigest: digestSchema,
    capabilityGrantDigest: digestSchema,
    responseContractDigest: digestSchema,
    accessMode: z.literal(ProjectReadSnapshotAccessMode.READ_ONLY),
    sourceCheckoutAccess: z.literal(ProjectReadSourceCheckoutAccess.NONE),
    modelUsableNetworkPolicy: z.literal(ProjectReadModelUsableNetworkPolicy.DENIED),
    forbiddenRoots: z.array(boundedStringSchema).min(1).max(4_096),
    isolationProfileId: boundedStringSchema,
    isolationProfileDigest: digestSchema,
    issuedAt: z.string(),
    lifecyclePolicy: z.literal(ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT),
    retentionPolicy: z.literal(ProjectReadRetentionPolicy.RUNTIME_OWNED),
    cleanupPolicy: z.literal(PROJECT_READ_CLEANUP_POLICY),
    recordDigest: digestSchema,
  })
  .strict();

export function decodeProjectReadSourceTreeProjection(
  value: unknown,
): ProjectReadSourceTreeProjection {
  const parsed = sourceTreeSchema.parse(value);
  const projection: ProjectReadSourceTreeProjection = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    profile: parsed.profile,
    entries: Object.freeze(
      parsed.entries.map((entry) =>
        Object.freeze({
          schemaVersion: entry.schemaVersion,
          path: entry.path,
          mode: entry.mode,
          size: entry.size,
          contentDigest: sha256Digest(entry.contentDigest),
        }),
      ),
    ),
    fileCount: parsed.fileCount,
    totalBytes: parsed.totalBytes,
    projectionDigest: sha256Digest(parsed.projectionDigest),
  });
  assertProjectReadSourceTreeInvariant(projection);
  return projection;
}

export function decodeProjectReadGitStateProjection(value: unknown): ProjectReadGitStateProjection {
  const parsed = gitStateSchema.parse(value);
  const projection: ProjectReadGitStateProjection = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    profile: parsed.profile,
    sourceProjectRoot: parsed.sourceProjectRoot,
    repositoryControlRootIdentity: parsed.repositoryControlRootIdentity,
    headCommit: parsed.headCommit,
    selectedPathSetDigest: sha256Digest(parsed.selectedPathSetDigest),
    stagedIndexManifestDigest: sha256Digest(parsed.stagedIndexManifestDigest),
    porcelainV2Digest: sha256Digest(parsed.porcelainV2Digest),
    projectionDigest: sha256Digest(parsed.projectionDigest),
  });
  assertProjectReadGitStateInvariant(projection);
  return projection;
}

export function decodeProjectSourceReadAuthorityRecord(
  value: unknown,
): ProjectSourceReadAuthorityRecord {
  const parsed = projectSourceReadAuthoritySchema.parse(value);
  const record: ProjectSourceReadAuthorityRecord = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    id: projectSourceReadAuthorityId(parsed.id),
    goalId: goalId(parsed.goalId),
    goalRevision: goalRevision(parsed.goalRevision),
    workflowId: workflowId(parsed.workflowId),
    workflowVersion: workflowVersion(parsed.workflowVersion),
    phase: parsed.phase,
    attemptId: attemptId(parsed.attemptId),
    normalizedProjectRoot: parsed.normalizedProjectRoot,
    resolvedProjectRoot: parsed.resolvedProjectRoot,
    repositoryControlRootIdentity: parsed.repositoryControlRootIdentity,
    sourceTree: decodeProjectReadSourceTreeProjection(parsed.sourceTree),
    gitState: decodeProjectReadGitStateProjection(parsed.gitState),
    workspaceRootIdentity: parsed.workspaceRootIdentity,
    snapshotId: projectReadSnapshotId(parsed.snapshotId),
    snapshotLeafRealpath: parsed.snapshotLeafRealpath,
    snapshotTreeDigest: sha256Digest(parsed.snapshotTreeDigest),
    ownershipMarkerProfile: parsed.ownershipMarkerProfile,
    ownershipMarkerDigest: sha256Digest(parsed.ownershipMarkerDigest),
    policyBundleId: policyBundleId(parsed.policyBundleId),
    policyBundleVersion: parsed.policyBundleVersion,
    policyBundleDigest: sha256Digest(parsed.policyBundleDigest),
    executionProfileId: executionProfileId(parsed.executionProfileId),
    executionProfileVersion: parsed.executionProfileVersion,
    executionProfileDigest: sha256Digest(parsed.executionProfileDigest),
    phaseDispatchEntryDigest: sha256Digest(parsed.phaseDispatchEntryDigest),
    capabilityGrantDigest: sha256Digest(parsed.capabilityGrantDigest),
    responseContractDigest: sha256Digest(parsed.responseContractDigest),
    accessMode: parsed.accessMode,
    sourceCheckoutAccess: parsed.sourceCheckoutAccess,
    modelUsableNetworkPolicy: parsed.modelUsableNetworkPolicy,
    forbiddenRoots: Object.freeze([...parsed.forbiddenRoots]),
    isolationProfileId: parsed.isolationProfileId,
    isolationProfileDigest: sha256Digest(parsed.isolationProfileDigest),
    issuedAt: isoTimestamp(parsed.issuedAt),
    lifecyclePolicy: parsed.lifecyclePolicy,
    retentionPolicy: parsed.retentionPolicy,
    cleanupPolicy: parsed.cleanupPolicy,
    recordDigest: sha256Digest(parsed.recordDigest),
  });
  assertProjectSourceReadAuthorityInvariant(record);
  return record;
}
