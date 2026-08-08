import { z } from 'zod';

import {
  attemptId,
  externalExecutionId,
  isoTimestamp,
  projectReadSnapshotCleanupGrantId,
  projectReadSnapshotCleanupObservationId,
  projectReadSnapshotCleanupOutcomeId,
  projectReadSnapshotId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectReadWorkspaceObservationId,
  projectSourceReadAuthorityId,
  sha256Digest,
  type Sha256Digest,
} from './identifiers.js';
import { AttemptStatus } from './model.js';
import { ExternalExecutionState } from './external-execution.js';
import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
} from './project-read.js';
import {
  ProjectReadSnapshotCleanupDisposition,
  ProjectReadSnapshotCleanupEligibilityKind,
  ProjectReadSnapshotCleanupLifecyclePolicy,
  assertProjectReadSnapshotCleanupGrantInvariant,
  assertProjectReadSnapshotCleanupOutcomeInvariant,
  projectReadSnapshotCleanupGrantProjection,
  projectReadSnapshotCleanupOutcomeProjection,
  type ProjectReadSnapshotCleanupGrant,
  type ProjectReadSnapshotCleanupOutcome,
} from './project-read-cleanup.js';

export interface ProjectReadCleanupDigestVerifier {
  digest(value: unknown): Sha256Digest;
}

const boundedStringSchema = z
  .string()
  .max(16_384)
  .refine(
    (value) =>
      value.trim().length > 0 && !value.includes('\u0000') && value === value.normalize('NFC'),
  );
const digestSchema = z.string();
const positiveSafeIntegerSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

const commonGrantFields = {
  schemaVersion: z.literal(1),
  id: z.string(),
  authoritySnapshotId: z.string(),
  authoritySnapshotDigest: digestSchema,
  authoritySequence: positiveSafeIntegerSchema,
  projectReadAuthorityId: z.string(),
  snapshotId: z.string(),
  workspaceRootIdentity: boundedStringSchema,
  snapshotLeafRealpath: boundedStringSchema,
  ownershipMarkerProfile: z.literal(PROJECT_READ_OWNERSHIP_MARKER_PROFILE),
  ownershipMarkerDigest: digestSchema,
  cleanupPolicy: z.literal(PROJECT_READ_CLEANUP_POLICY),
  lifecyclePolicy: z.literal(ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE),
  issuedAt: z.string(),
  grantDigest: digestSchema,
};

const grantSchema = z.discriminatedUnion('eligibilityKind', [
  z
    .object({
      ...commonGrantFields,
      eligibilityKind: z.literal(ProjectReadSnapshotCleanupEligibilityKind.TERMINAL),
      projectReadAuthorityRecordDigest: digestSchema,
      attemptId: z.string(),
      terminalAttemptStatus: z.enum([
        AttemptStatus.RESULT_RECORDED,
        AttemptStatus.FAILED,
        AttemptStatus.INTERRUPTED,
      ]),
      terminalAttemptEndedAt: z.string(),
      externalExecutionId: z.string(),
      terminalExternalExecutionState: z.enum([
        ExternalExecutionState.COMPLETED,
        ExternalExecutionState.INTERRUPTED,
        ExternalExecutionState.FAILED,
        ExternalExecutionState.ABANDONED,
      ]),
      terminalExternalExecutionAt: z.string(),
      terminalExternalExecutionRecordDigest: digestSchema,
    })
    .strict(),
  z
    .object({
      ...commonGrantFields,
      eligibilityKind: z.literal(ProjectReadSnapshotCleanupEligibilityKind.ORPHANED),
      workspaceObservationId: z.string(),
      workspaceObservationDigest: digestSchema,
    })
    .strict(),
]);

const outcomeSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    grantId: z.string(),
    grantDigest: digestSchema,
    cleanupObservationId: z.string(),
    cleanupObservationDigest: digestSchema,
    disposition: z.enum(Object.values(ProjectReadSnapshotCleanupDisposition)),
    resolvedAt: z.string(),
    outcomeDigest: digestSchema,
  })
  .strict();

function verifyDigest(
  actual: Sha256Digest,
  projection: unknown,
  verifier: ProjectReadCleanupDigestVerifier,
  name: string,
): void {
  if (actual !== sha256Digest(verifier.digest(projection))) {
    throw new TypeError(`${name} does not match its canonical projection`);
  }
}

export function decodeProjectReadSnapshotCleanupGrant(
  value: unknown,
  verifier: ProjectReadCleanupDigestVerifier,
): ProjectReadSnapshotCleanupGrant {
  const parsed = grantSchema.parse(value);
  const common = {
    schemaVersion: parsed.schemaVersion,
    id: projectReadSnapshotCleanupGrantId(parsed.id),
    authoritySnapshotId: projectReadWorkspaceAuthoritySnapshotId(parsed.authoritySnapshotId),
    authoritySnapshotDigest: sha256Digest(parsed.authoritySnapshotDigest),
    authoritySequence: parsed.authoritySequence,
    projectReadAuthorityId: projectSourceReadAuthorityId(parsed.projectReadAuthorityId),
    snapshotId: projectReadSnapshotId(parsed.snapshotId),
    workspaceRootIdentity: parsed.workspaceRootIdentity,
    snapshotLeafRealpath: parsed.snapshotLeafRealpath,
    ownershipMarkerProfile: parsed.ownershipMarkerProfile,
    ownershipMarkerDigest: sha256Digest(parsed.ownershipMarkerDigest),
    cleanupPolicy: parsed.cleanupPolicy,
    lifecyclePolicy: parsed.lifecyclePolicy,
    issuedAt: isoTimestamp(parsed.issuedAt),
  } as const;
  const withoutDigest =
    parsed.eligibilityKind === ProjectReadSnapshotCleanupEligibilityKind.TERMINAL
      ? Object.freeze({
          ...common,
          eligibilityKind: parsed.eligibilityKind,
          projectReadAuthorityRecordDigest: sha256Digest(parsed.projectReadAuthorityRecordDigest),
          attemptId: attemptId(parsed.attemptId),
          terminalAttemptStatus: parsed.terminalAttemptStatus,
          terminalAttemptEndedAt: isoTimestamp(parsed.terminalAttemptEndedAt),
          externalExecutionId: externalExecutionId(parsed.externalExecutionId),
          terminalExternalExecutionState: parsed.terminalExternalExecutionState,
          terminalExternalExecutionAt: isoTimestamp(parsed.terminalExternalExecutionAt),
          terminalExternalExecutionRecordDigest: sha256Digest(
            parsed.terminalExternalExecutionRecordDigest,
          ),
        })
      : Object.freeze({
          ...common,
          eligibilityKind: parsed.eligibilityKind,
          workspaceObservationId: projectReadWorkspaceObservationId(parsed.workspaceObservationId),
          workspaceObservationDigest: sha256Digest(parsed.workspaceObservationDigest),
        });
  const grantDigest = sha256Digest(parsed.grantDigest);
  const grant = Object.freeze({ ...withoutDigest, grantDigest });
  assertProjectReadSnapshotCleanupGrantInvariant(grant);
  verifyDigest(
    grantDigest,
    projectReadSnapshotCleanupGrantProjection(withoutDigest),
    verifier,
    'Project-read cleanup grant digest',
  );
  return grant;
}

export function decodeProjectReadSnapshotCleanupOutcome(
  value: unknown,
  verifier: ProjectReadCleanupDigestVerifier,
): ProjectReadSnapshotCleanupOutcome {
  const parsed = outcomeSchema.parse(value);
  const withoutDigest = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    id: projectReadSnapshotCleanupOutcomeId(parsed.id),
    grantId: projectReadSnapshotCleanupGrantId(parsed.grantId),
    grantDigest: sha256Digest(parsed.grantDigest),
    cleanupObservationId: projectReadSnapshotCleanupObservationId(parsed.cleanupObservationId),
    cleanupObservationDigest: sha256Digest(parsed.cleanupObservationDigest),
    disposition: parsed.disposition,
    resolvedAt: isoTimestamp(parsed.resolvedAt),
  });
  const outcomeDigest = sha256Digest(parsed.outcomeDigest);
  const outcome = Object.freeze({ ...withoutDigest, outcomeDigest });
  assertProjectReadSnapshotCleanupOutcomeInvariant(outcome);
  verifyDigest(
    outcomeDigest,
    projectReadSnapshotCleanupOutcomeProjection(withoutDigest),
    verifier,
    'Project-read cleanup Outcome digest',
  );
  return outcome;
}
