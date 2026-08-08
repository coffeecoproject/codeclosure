import { isAbsolute, relative, resolve, sep } from 'node:path';

import {
  PROJECT_READ_SOURCE_TREE_PROFILE,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  ProjectReadSnapshotCleanupDisposition,
  ProjectReadSnapshotCleanupEligibilityKind,
  isoTimestamp,
  projectReadSnapshotCleanupGrantId,
  projectReadSnapshotCleanupObservationId,
  sha256Digest,
  type AttemptId,
  type AttemptStatus as AttemptStatusType,
  type ExternalExecutionId,
  type ExternalExecutionState as ExternalExecutionStateType,
  type IsoTimestamp,
  type ProjectReadSnapshotCleanupGrant,
  type ProjectReadSnapshotCleanupGrantId,
  type ProjectReadSnapshotCleanupObservationId,
  type ProjectReadSnapshotCleanupOutcome,
  type ProjectReadSnapshotId,
  type ProjectSourceReadAuthorityId,
  type Sha256Digest,
} from '@codeclosure/domain';
import { z } from 'zod';

import { CanonicalJsonSha256DigestProvider } from './canonical-json.js';
import {
  ProjectReadWorkspaceClassification,
  ProjectReadWorkspaceRetention,
  assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot,
  type ProjectReadWorkspaceAuthoritySnapshot,
  type ProjectReadWorkspaceObservation,
} from './project-read-workspace-contracts.js';

const digests = new CanonicalJsonSha256DigestProvider();

export const ProjectReadSnapshotCleanupTargetState = {
  ABSENT: 'ABSENT',
  PRESENT_RETAINED: 'PRESENT_RETAINED',
} as const;
export type ProjectReadSnapshotCleanupTargetState =
  (typeof ProjectReadSnapshotCleanupTargetState)[keyof typeof ProjectReadSnapshotCleanupTargetState];

export const ProjectReadSnapshotCleanupTargetClassification = {
  ABSENT: 'ABSENT',
  EXACT_OWNED: 'EXACT_OWNED',
  PRESENT_UNSAFE: 'PRESENT_UNSAFE',
} as const;
export type ProjectReadSnapshotCleanupTargetClassification =
  (typeof ProjectReadSnapshotCleanupTargetClassification)[keyof typeof ProjectReadSnapshotCleanupTargetClassification];

export const PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE =
  'codeclosure-project-read-cleanup-target-fingerprint-v1';

export const ProjectReadSnapshotCleanupTargetEntryKind = {
  ABSENT: 'ABSENT',
  DIRECTORY: 'DIRECTORY',
  REGULAR_FILE: 'REGULAR_FILE',
  SYMBOLIC_LINK: 'SYMBOLIC_LINK',
  OTHER: 'OTHER',
} as const;
export type ProjectReadSnapshotCleanupTargetEntryKind =
  (typeof ProjectReadSnapshotCleanupTargetEntryKind)[keyof typeof ProjectReadSnapshotCleanupTargetEntryKind];

export const ProjectReadSnapshotCleanupTargetAliasDisposition = {
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  EXACT: 'EXACT',
  SYMBOLIC_LINK: 'SYMBOLIC_LINK',
  RESOLVED_DIFFERENT: 'RESOLVED_DIFFERENT',
  UNRESOLVED: 'UNRESOLVED',
} as const;
export type ProjectReadSnapshotCleanupTargetAliasDisposition =
  (typeof ProjectReadSnapshotCleanupTargetAliasDisposition)[keyof typeof ProjectReadSnapshotCleanupTargetAliasDisposition];

export const ProjectReadSnapshotCleanupTargetMarkerDisposition = {
  MATCHED: 'MATCHED',
  ABSENT: 'ABSENT',
  MISMATCHED: 'MISMATCHED',
  MALFORMED: 'MALFORMED',
  UNREADABLE: 'UNREADABLE',
} as const;
export type ProjectReadSnapshotCleanupTargetMarkerDisposition =
  (typeof ProjectReadSnapshotCleanupTargetMarkerDisposition)[keyof typeof ProjectReadSnapshotCleanupTargetMarkerDisposition];

export const ProjectReadSnapshotCleanupTargetManifestDisposition = {
  RECORDED: 'RECORDED',
  NOT_APPLICABLE: 'NOT_APPLICABLE',
  UNAVAILABLE: 'UNAVAILABLE',
} as const;
export type ProjectReadSnapshotCleanupTargetManifestDisposition =
  (typeof ProjectReadSnapshotCleanupTargetManifestDisposition)[keyof typeof ProjectReadSnapshotCleanupTargetManifestDisposition];

export interface ProjectReadSnapshotCleanupTargetFingerprintProjectionV1 {
  readonly schemaVersion: 1;
  readonly profile: typeof PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE;
  readonly state: ProjectReadSnapshotCleanupTargetState;
  readonly workspaceRootIdentity: string;
  readonly workspaceRootDeviceId: string;
  readonly workspaceRootFileId: string;
  readonly snapshotLeafRealpath: string;
  readonly entryKind: ProjectReadSnapshotCleanupTargetEntryKind;
  readonly aliasDisposition: ProjectReadSnapshotCleanupTargetAliasDisposition;
  readonly resolvedLeafRealpath: string | null;
  readonly nodeDeviceId: string | null;
  readonly nodeFileId: string | null;
  readonly expectedOwnershipMarkerProfile: typeof PROJECT_READ_OWNERSHIP_MARKER_PROFILE;
  readonly expectedOwnershipMarkerDigest: Sha256Digest;
  readonly markerDisposition: ProjectReadSnapshotCleanupTargetMarkerDisposition;
  readonly observedOwnershipMarkerDigest: Sha256Digest | null;
  readonly manifestDisposition: ProjectReadSnapshotCleanupTargetManifestDisposition;
  readonly targetManifestProfile: typeof PROJECT_READ_SOURCE_TREE_PROFILE | null;
  readonly targetManifestDigest: Sha256Digest | null;
}

export type ProjectReadSnapshotCleanupTargetFingerprintProjection =
  ProjectReadSnapshotCleanupTargetFingerprintProjectionV1;

// Workspace-local owns physical observation and supplies this closed projection.
// Runtime owns only its strict shape, canonical digest, and equality semantics;
// it never infers filesystem state from model output.
export interface ProjectReadSnapshotCleanupTargetObservationV1 {
  readonly schemaVersion: 1;
  readonly classification: ProjectReadSnapshotCleanupTargetClassification;
  readonly fingerprint: ProjectReadSnapshotCleanupTargetFingerprintProjection;
  readonly fingerprintDigest: Sha256Digest;
  readonly observedAt: IsoTimestamp;
}

export type ProjectReadSnapshotCleanupTargetObservation =
  ProjectReadSnapshotCleanupTargetObservationV1;

export const ProjectReadSnapshotCleanupCoordinationDisposition = {
  CLEARED: 'CLEARED',
  INERT_RETAINED: 'INERT_RETAINED',
} as const;
export type ProjectReadSnapshotCleanupCoordinationDisposition =
  (typeof ProjectReadSnapshotCleanupCoordinationDisposition)[keyof typeof ProjectReadSnapshotCleanupCoordinationDisposition];

export interface ProjectReadSnapshotCleanupObservationV1 {
  readonly schemaVersion: 1;
  readonly id: ProjectReadSnapshotCleanupObservationId;
  readonly grantId: ProjectReadSnapshotCleanupGrantId;
  readonly grantDigest: Sha256Digest;
  readonly disposition: ProjectReadSnapshotCleanupDisposition;
  readonly workspaceRootIdentity: string;
  readonly snapshotLeafRealpath: string;
  readonly expectedOwnershipMarkerProfile: typeof PROJECT_READ_OWNERSHIP_MARKER_PROFILE;
  readonly expectedOwnershipMarkerDigest: Sha256Digest;
  readonly terminalTargetObservation: ProjectReadSnapshotCleanupTargetObservation;
  readonly failurePreEffectTargetObservation: ProjectReadSnapshotCleanupTargetObservation | null;
  readonly coordinationDisposition: ProjectReadSnapshotCleanupCoordinationDisposition;
  readonly observedAt: IsoTimestamp;
  readonly observationDigest: Sha256Digest;
}

export type ProjectReadSnapshotCleanupObservation = ProjectReadSnapshotCleanupObservationV1;

export interface ProjectReadCleanupAuthorityRecordView {
  readonly id: ProjectSourceReadAuthorityId;
  readonly recordDigest: Sha256Digest;
  readonly snapshotId: ProjectReadSnapshotId;
  readonly workspaceRootIdentity: string;
  readonly snapshotLeafRealpath: string;
  readonly ownershipMarkerProfile: typeof PROJECT_READ_OWNERSHIP_MARKER_PROFILE;
  readonly ownershipMarkerDigest: Sha256Digest;
  readonly attemptId: AttemptId;
}

export interface ProjectReadCleanupTerminalAttemptView {
  readonly id: AttemptId;
  readonly status: Exclude<AttemptStatusType, 'RUNNING'>;
  readonly endedAt: IsoTimestamp;
}

export interface ProjectReadCleanupTerminalExternalExecutionView {
  readonly id: ExternalExecutionId;
  readonly attemptId: AttemptId;
  readonly state: Extract<
    ExternalExecutionStateType,
    'COMPLETED' | 'INTERRUPTED' | 'FAILED' | 'ABANDONED'
  >;
  readonly terminalAt: IsoTimestamp;
  readonly recordDigest: Sha256Digest;
}

export const ProjectReadSnapshotCleanupRequestDisposition = {
  REJECTED_MISSING_GRANT: 'REJECTED_MISSING_GRANT',
  REJECTED_IDENTITY_CONFLICT: 'REJECTED_IDENTITY_CONFLICT',
  RETURN_RETAINED_OUTCOME: 'RETURN_RETAINED_OUTCOME',
  INVOKE_UNRESOLVED: 'INVOKE_UNRESOLVED',
} as const;
export type ProjectReadSnapshotCleanupRequestDisposition =
  (typeof ProjectReadSnapshotCleanupRequestDisposition)[keyof typeof ProjectReadSnapshotCleanupRequestDisposition];

export type ProjectReadSnapshotCleanupRequestDecision =
  | Readonly<{
      disposition:
        | typeof ProjectReadSnapshotCleanupRequestDisposition.REJECTED_MISSING_GRANT
        | typeof ProjectReadSnapshotCleanupRequestDisposition.REJECTED_IDENTITY_CONFLICT;
    }>
  | Readonly<{
      disposition: typeof ProjectReadSnapshotCleanupRequestDisposition.RETURN_RETAINED_OUTCOME;
      outcome: ProjectReadSnapshotCleanupOutcome;
    }>
  | Readonly<{
      disposition: typeof ProjectReadSnapshotCleanupRequestDisposition.INVOKE_UNRESOLVED;
      grant: ProjectReadSnapshotCleanupGrant;
    }>;

const boundedStringSchema = z
  .string()
  .max(16_384)
  .refine(
    (value) =>
      value.trim().length > 0 && !value.includes('\u0000') && value === value.normalize('NFC'),
  );
const digestSchema = z.string();
const canonicalNonNegativeDecimalSchema = z
  .string()
  .max(32)
  .regex(/^(?:0|[1-9]\d*)$/u);
const targetFingerprintProjectionSchema = z
  .object({
    schemaVersion: z.literal(1),
    profile: z.literal(PROJECT_READ_SNAPSHOT_CLEANUP_TARGET_FINGERPRINT_PROFILE),
    state: z.enum(Object.values(ProjectReadSnapshotCleanupTargetState)),
    workspaceRootIdentity: boundedStringSchema,
    workspaceRootDeviceId: canonicalNonNegativeDecimalSchema,
    workspaceRootFileId: canonicalNonNegativeDecimalSchema,
    snapshotLeafRealpath: boundedStringSchema,
    entryKind: z.enum(Object.values(ProjectReadSnapshotCleanupTargetEntryKind)),
    aliasDisposition: z.enum(Object.values(ProjectReadSnapshotCleanupTargetAliasDisposition)),
    resolvedLeafRealpath: boundedStringSchema.nullable(),
    nodeDeviceId: canonicalNonNegativeDecimalSchema.nullable(),
    nodeFileId: canonicalNonNegativeDecimalSchema.nullable(),
    expectedOwnershipMarkerProfile: z.literal(PROJECT_READ_OWNERSHIP_MARKER_PROFILE),
    expectedOwnershipMarkerDigest: digestSchema,
    markerDisposition: z.enum(Object.values(ProjectReadSnapshotCleanupTargetMarkerDisposition)),
    observedOwnershipMarkerDigest: digestSchema.nullable(),
    manifestDisposition: z.enum(Object.values(ProjectReadSnapshotCleanupTargetManifestDisposition)),
    targetManifestProfile: z.literal(PROJECT_READ_SOURCE_TREE_PROFILE).nullable(),
    targetManifestDigest: digestSchema.nullable(),
  })
  .strict();
const targetObservationSchema = z
  .object({
    schemaVersion: z.literal(1),
    classification: z.enum(Object.values(ProjectReadSnapshotCleanupTargetClassification)),
    fingerprint: targetFingerprintProjectionSchema,
    fingerprintDigest: digestSchema,
    observedAt: z.string(),
  })
  .strict();
const observationSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string(),
    grantId: z.string(),
    grantDigest: digestSchema,
    disposition: z.enum(Object.values(ProjectReadSnapshotCleanupDisposition)),
    workspaceRootIdentity: boundedStringSchema,
    snapshotLeafRealpath: boundedStringSchema,
    expectedOwnershipMarkerProfile: z.literal(PROJECT_READ_OWNERSHIP_MARKER_PROFILE),
    expectedOwnershipMarkerDigest: digestSchema,
    terminalTargetObservation: targetObservationSchema,
    failurePreEffectTargetObservation: targetObservationSchema.nullable(),
    coordinationDisposition: z.enum(
      Object.values(ProjectReadSnapshotCleanupCoordinationDisposition),
    ),
    observedAt: z.string(),
    observationDigest: digestSchema,
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

export function projectReadSnapshotCleanupTargetFingerprintProjection(
  fingerprint: ProjectReadSnapshotCleanupTargetFingerprintProjection,
): unknown {
  return {
    schemaVersion: fingerprint.schemaVersion,
    profile: fingerprint.profile,
    state: fingerprint.state,
    workspaceRootIdentity: fingerprint.workspaceRootIdentity,
    workspaceRootDeviceId: fingerprint.workspaceRootDeviceId,
    workspaceRootFileId: fingerprint.workspaceRootFileId,
    snapshotLeafRealpath: fingerprint.snapshotLeafRealpath,
    entryKind: fingerprint.entryKind,
    aliasDisposition: fingerprint.aliasDisposition,
    resolvedLeafRealpath: fingerprint.resolvedLeafRealpath,
    nodeDeviceId: fingerprint.nodeDeviceId,
    nodeFileId: fingerprint.nodeFileId,
    expectedOwnershipMarkerProfile: fingerprint.expectedOwnershipMarkerProfile,
    expectedOwnershipMarkerDigest: fingerprint.expectedOwnershipMarkerDigest,
    markerDisposition: fingerprint.markerDisposition,
    observedOwnershipMarkerDigest: fingerprint.observedOwnershipMarkerDigest,
    manifestDisposition: fingerprint.manifestDisposition,
    targetManifestProfile: fingerprint.targetManifestProfile,
    targetManifestDigest: fingerprint.targetManifestDigest,
  };
}

export function decodeProjectReadSnapshotCleanupTargetFingerprintProjection(
  value: unknown,
): ProjectReadSnapshotCleanupTargetFingerprintProjection {
  const parsed = targetFingerprintProjectionSchema.parse(value);
  const workspaceRootIdentity = exactAbsolutePath(
    parsed.workspaceRootIdentity,
    'Project-read cleanup fingerprint root',
  );
  const snapshotLeafRealpath = exactAbsolutePath(
    parsed.snapshotLeafRealpath,
    'Project-read cleanup fingerprint leaf',
  );
  if (
    workspaceRootIdentity === snapshotLeafRealpath ||
    !isSameOrWithin(snapshotLeafRealpath, workspaceRootIdentity)
  ) {
    throw new TypeError('Project-read cleanup fingerprint target is outside its exact owned root');
  }
  const resolvedLeafRealpath =
    parsed.resolvedLeafRealpath === null
      ? null
      : exactAbsolutePath(
          parsed.resolvedLeafRealpath,
          'Project-read cleanup fingerprint resolved leaf',
        );
  const expectedOwnershipMarkerDigest = sha256Digest(parsed.expectedOwnershipMarkerDigest);
  const observedOwnershipMarkerDigest =
    parsed.observedOwnershipMarkerDigest === null
      ? null
      : sha256Digest(parsed.observedOwnershipMarkerDigest);
  const targetManifestDigest =
    parsed.targetManifestDigest === null ? null : sha256Digest(parsed.targetManifestDigest);

  if (parsed.state === ProjectReadSnapshotCleanupTargetState.ABSENT) {
    if (
      parsed.entryKind !== ProjectReadSnapshotCleanupTargetEntryKind.ABSENT ||
      parsed.aliasDisposition !== ProjectReadSnapshotCleanupTargetAliasDisposition.NOT_APPLICABLE ||
      resolvedLeafRealpath !== null ||
      parsed.nodeDeviceId !== null ||
      parsed.nodeFileId !== null ||
      parsed.markerDisposition !== ProjectReadSnapshotCleanupTargetMarkerDisposition.ABSENT ||
      observedOwnershipMarkerDigest !== null ||
      parsed.manifestDisposition !==
        ProjectReadSnapshotCleanupTargetManifestDisposition.NOT_APPLICABLE ||
      parsed.targetManifestProfile !== null ||
      targetManifestDigest !== null
    ) {
      throw new TypeError('Absent project-read cleanup fingerprint retains present target facts');
    }
  } else {
    if (
      parsed.entryKind === ProjectReadSnapshotCleanupTargetEntryKind.ABSENT ||
      parsed.aliasDisposition === ProjectReadSnapshotCleanupTargetAliasDisposition.NOT_APPLICABLE ||
      parsed.nodeDeviceId === null ||
      parsed.nodeFileId === null
    ) {
      throw new TypeError('Present project-read cleanup fingerprint lacks exact node facts');
    }
    switch (parsed.aliasDisposition) {
      case ProjectReadSnapshotCleanupTargetAliasDisposition.EXACT:
        if (
          parsed.entryKind === ProjectReadSnapshotCleanupTargetEntryKind.SYMBOLIC_LINK ||
          resolvedLeafRealpath !== snapshotLeafRealpath
        ) {
          throw new TypeError('Exact project-read cleanup fingerprint has alias drift');
        }
        break;
      case ProjectReadSnapshotCleanupTargetAliasDisposition.SYMBOLIC_LINK:
        if (parsed.entryKind !== ProjectReadSnapshotCleanupTargetEntryKind.SYMBOLIC_LINK) {
          throw new TypeError('Project-read cleanup symbolic-link fingerprint lacks a link');
        }
        break;
      case ProjectReadSnapshotCleanupTargetAliasDisposition.RESOLVED_DIFFERENT:
        if (
          parsed.entryKind === ProjectReadSnapshotCleanupTargetEntryKind.SYMBOLIC_LINK ||
          resolvedLeafRealpath === null ||
          resolvedLeafRealpath === snapshotLeafRealpath
        ) {
          throw new TypeError('Project-read cleanup resolved-different fingerprint is not drifted');
        }
        break;
      case ProjectReadSnapshotCleanupTargetAliasDisposition.UNRESOLVED:
        if (
          parsed.entryKind === ProjectReadSnapshotCleanupTargetEntryKind.SYMBOLIC_LINK ||
          resolvedLeafRealpath !== null
        ) {
          throw new TypeError('Project-read cleanup unresolved fingerprint has a resolved target');
        }
        break;
    }
  }

  switch (parsed.markerDisposition) {
    case ProjectReadSnapshotCleanupTargetMarkerDisposition.MATCHED:
      if (observedOwnershipMarkerDigest !== expectedOwnershipMarkerDigest) {
        throw new TypeError('Matched project-read cleanup marker digest is inconsistent');
      }
      break;
    case ProjectReadSnapshotCleanupTargetMarkerDisposition.MISMATCHED:
      if (
        observedOwnershipMarkerDigest === null ||
        observedOwnershipMarkerDigest === expectedOwnershipMarkerDigest
      ) {
        throw new TypeError('Mismatched project-read cleanup marker digest is inconsistent');
      }
      break;
    case ProjectReadSnapshotCleanupTargetMarkerDisposition.ABSENT:
    case ProjectReadSnapshotCleanupTargetMarkerDisposition.MALFORMED:
    case ProjectReadSnapshotCleanupTargetMarkerDisposition.UNREADABLE:
      if (observedOwnershipMarkerDigest !== null) {
        throw new TypeError('Unavailable project-read cleanup marker retains a decoded digest');
      }
      break;
  }

  switch (parsed.manifestDisposition) {
    case ProjectReadSnapshotCleanupTargetManifestDisposition.RECORDED:
      if (
        parsed.entryKind !== ProjectReadSnapshotCleanupTargetEntryKind.DIRECTORY ||
        parsed.targetManifestProfile !== PROJECT_READ_SOURCE_TREE_PROFILE ||
        targetManifestDigest === null
      ) {
        throw new TypeError('Recorded project-read cleanup manifest is incomplete');
      }
      break;
    case ProjectReadSnapshotCleanupTargetManifestDisposition.NOT_APPLICABLE:
      if (
        parsed.entryKind === ProjectReadSnapshotCleanupTargetEntryKind.DIRECTORY ||
        parsed.targetManifestProfile !== null ||
        targetManifestDigest !== null
      ) {
        throw new TypeError('Inapplicable project-read cleanup manifest retains directory facts');
      }
      break;
    case ProjectReadSnapshotCleanupTargetManifestDisposition.UNAVAILABLE:
      if (
        parsed.entryKind !== ProjectReadSnapshotCleanupTargetEntryKind.DIRECTORY ||
        parsed.targetManifestProfile !== null ||
        targetManifestDigest !== null
      ) {
        throw new TypeError('Unavailable project-read cleanup manifest is inconsistent');
      }
      break;
  }

  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    profile: parsed.profile,
    state: parsed.state,
    workspaceRootIdentity,
    workspaceRootDeviceId: parsed.workspaceRootDeviceId,
    workspaceRootFileId: parsed.workspaceRootFileId,
    snapshotLeafRealpath,
    entryKind: parsed.entryKind,
    aliasDisposition: parsed.aliasDisposition,
    resolvedLeafRealpath,
    nodeDeviceId: parsed.nodeDeviceId,
    nodeFileId: parsed.nodeFileId,
    expectedOwnershipMarkerProfile: parsed.expectedOwnershipMarkerProfile,
    expectedOwnershipMarkerDigest,
    markerDisposition: parsed.markerDisposition,
    observedOwnershipMarkerDigest,
    manifestDisposition: parsed.manifestDisposition,
    targetManifestProfile: parsed.targetManifestProfile,
    targetManifestDigest,
  });
}

export function createProjectReadSnapshotCleanupTargetObservation(
  fingerprintValue: unknown,
  observedAtValue: string,
): ProjectReadSnapshotCleanupTargetObservation {
  const fingerprint = decodeProjectReadSnapshotCleanupTargetFingerprintProjection(fingerprintValue);
  const classification = classifyProjectReadSnapshotCleanupTargetFingerprint(fingerprint);
  return Object.freeze({
    schemaVersion: 1,
    classification,
    fingerprint,
    fingerprintDigest: digests.digest(
      projectReadSnapshotCleanupTargetFingerprintProjection(fingerprint),
    ),
    observedAt: isoTimestamp(observedAtValue),
  });
}

function classifyProjectReadSnapshotCleanupTargetFingerprint(
  fingerprint: ProjectReadSnapshotCleanupTargetFingerprintProjection,
): ProjectReadSnapshotCleanupTargetClassification {
  if (fingerprint.state === ProjectReadSnapshotCleanupTargetState.ABSENT) {
    return ProjectReadSnapshotCleanupTargetClassification.ABSENT;
  }
  if (
    fingerprint.entryKind === ProjectReadSnapshotCleanupTargetEntryKind.DIRECTORY &&
    fingerprint.aliasDisposition === ProjectReadSnapshotCleanupTargetAliasDisposition.EXACT &&
    fingerprint.markerDisposition === ProjectReadSnapshotCleanupTargetMarkerDisposition.MATCHED &&
    fingerprint.manifestDisposition === ProjectReadSnapshotCleanupTargetManifestDisposition.RECORDED
  ) {
    return ProjectReadSnapshotCleanupTargetClassification.EXACT_OWNED;
  }
  return ProjectReadSnapshotCleanupTargetClassification.PRESENT_UNSAFE;
}

function decodeTargetObservation(value: unknown): ProjectReadSnapshotCleanupTargetObservation {
  const parsed = targetObservationSchema.parse(value);
  const fingerprint = decodeProjectReadSnapshotCleanupTargetFingerprintProjection(
    parsed.fingerprint,
  );
  const classification = classifyProjectReadSnapshotCleanupTargetFingerprint(fingerprint);
  if (parsed.classification !== classification) {
    throw new TypeError('Project-read cleanup target classification is inconsistent');
  }
  const fingerprintDigest = sha256Digest(parsed.fingerprintDigest);
  if (
    fingerprintDigest !==
    digests.digest(projectReadSnapshotCleanupTargetFingerprintProjection(fingerprint))
  ) {
    throw new TypeError('Project-read cleanup target fingerprint digest is inconsistent');
  }
  return Object.freeze({
    schemaVersion: parsed.schemaVersion,
    classification,
    fingerprint,
    fingerprintDigest,
    observedAt: isoTimestamp(parsed.observedAt),
  });
}

export function digestProjectReadSnapshotCleanupValue(value: unknown): Sha256Digest {
  return digests.digest(value);
}

export function projectReadSnapshotCleanupObservationProjection(
  observation: Omit<ProjectReadSnapshotCleanupObservation, 'observationDigest'>,
): unknown {
  return {
    schemaVersion: observation.schemaVersion,
    id: observation.id,
    grantId: observation.grantId,
    grantDigest: observation.grantDigest,
    disposition: observation.disposition,
    workspaceRootIdentity: observation.workspaceRootIdentity,
    snapshotLeafRealpath: observation.snapshotLeafRealpath,
    expectedOwnershipMarkerProfile: observation.expectedOwnershipMarkerProfile,
    expectedOwnershipMarkerDigest: observation.expectedOwnershipMarkerDigest,
    terminalTargetObservation: observation.terminalTargetObservation,
    failurePreEffectTargetObservation: observation.failurePreEffectTargetObservation,
    coordinationDisposition: observation.coordinationDisposition,
    observedAt: observation.observedAt,
  };
}

export function decodeProjectReadSnapshotCleanupObservation(
  value: unknown,
): ProjectReadSnapshotCleanupObservation {
  const parsed = observationSchema.parse(value);
  const workspaceRootIdentity = exactAbsolutePath(
    parsed.workspaceRootIdentity,
    'Project-read cleanup observation root',
  );
  const snapshotLeafRealpath = exactAbsolutePath(
    parsed.snapshotLeafRealpath,
    'Project-read cleanup observation leaf',
  );
  if (
    workspaceRootIdentity === snapshotLeafRealpath ||
    !isSameOrWithin(snapshotLeafRealpath, workspaceRootIdentity)
  ) {
    throw new TypeError('Project-read cleanup observation target is outside its exact owned root');
  }
  const terminalTargetObservation = decodeTargetObservation(parsed.terminalTargetObservation);
  const failurePreEffectTargetObservation =
    parsed.failurePreEffectTargetObservation === null
      ? null
      : decodeTargetObservation(parsed.failurePreEffectTargetObservation);
  const targetObservations = [
    terminalTargetObservation,
    ...(failurePreEffectTargetObservation === null ? [] : [failurePreEffectTargetObservation]),
  ];
  if (
    targetObservations.some(
      ({ fingerprint }) =>
        fingerprint.workspaceRootIdentity !== workspaceRootIdentity ||
        fingerprint.snapshotLeafRealpath !== snapshotLeafRealpath ||
        fingerprint.expectedOwnershipMarkerDigest !== parsed.expectedOwnershipMarkerDigest,
    )
  ) {
    throw new TypeError(
      'Project-read cleanup target fingerprint does not bind its outer observation',
    );
  }
  const observedAt = isoTimestamp(parsed.observedAt);
  if (terminalTargetObservation.observedAt > observedAt) {
    throw new TypeError('Project-read cleanup terminal target observation is from the future');
  }
  switch (parsed.disposition) {
    case ProjectReadSnapshotCleanupDisposition.DELETED:
    case ProjectReadSnapshotCleanupDisposition.ALREADY_ABSENT:
      if (
        terminalTargetObservation.classification !==
          ProjectReadSnapshotCleanupTargetClassification.ABSENT ||
        failurePreEffectTargetObservation !== null ||
        parsed.coordinationDisposition !== ProjectReadSnapshotCleanupCoordinationDisposition.CLEARED
      ) {
        throw new TypeError(
          'Absent project-read cleanup disposition lacks cleared terminal observation',
        );
      }
      break;
    case ProjectReadSnapshotCleanupDisposition.RETAINED_UNSAFE:
      if (
        terminalTargetObservation.classification !==
          ProjectReadSnapshotCleanupTargetClassification.PRESENT_UNSAFE ||
        failurePreEffectTargetObservation !== null
      ) {
        throw new TypeError(
          'Retained-unsafe project-read cleanup disposition lacks a current unsafe target',
        );
      }
      break;
    case ProjectReadSnapshotCleanupDisposition.FAILED:
      if (
        terminalTargetObservation.classification !==
          ProjectReadSnapshotCleanupTargetClassification.EXACT_OWNED ||
        failurePreEffectTargetObservation?.classification !==
          ProjectReadSnapshotCleanupTargetClassification.EXACT_OWNED ||
        failurePreEffectTargetObservation.fingerprintDigest !==
          terminalTargetObservation.fingerprintDigest ||
        failurePreEffectTargetObservation.observedAt > terminalTargetObservation.observedAt
      ) {
        throw new TypeError(
          'Failed project-read cleanup disposition lacks exact-owned no-effect reobservation',
        );
      }
      break;
  }
  const withoutDigest = Object.freeze({
    schemaVersion: parsed.schemaVersion,
    id: projectReadSnapshotCleanupObservationId(parsed.id),
    grantId: projectReadSnapshotCleanupGrantId(parsed.grantId),
    grantDigest: sha256Digest(parsed.grantDigest),
    disposition: parsed.disposition,
    workspaceRootIdentity,
    snapshotLeafRealpath,
    expectedOwnershipMarkerProfile: parsed.expectedOwnershipMarkerProfile,
    expectedOwnershipMarkerDigest: sha256Digest(parsed.expectedOwnershipMarkerDigest),
    terminalTargetObservation,
    failurePreEffectTargetObservation,
    coordinationDisposition: parsed.coordinationDisposition,
    observedAt,
  });
  const observationDigest = sha256Digest(parsed.observationDigest);
  if (
    observationDigest !==
    digestProjectReadSnapshotCleanupValue(
      projectReadSnapshotCleanupObservationProjection(withoutDigest),
    )
  ) {
    throw new TypeError('Project-read cleanup observation digest is inconsistent');
  }
  return Object.freeze({ ...withoutDigest, observationDigest });
}

function assertGrantMatchesAuthoritySnapshot(
  grant: ProjectReadSnapshotCleanupGrant,
  authoritySnapshot: ProjectReadWorkspaceAuthoritySnapshot,
): void {
  if (
    grant.authoritySnapshotId !== authoritySnapshot.id ||
    grant.authoritySnapshotDigest !== authoritySnapshot.authorityDigest ||
    grant.authoritySequence !== authoritySnapshot.authoritySequence ||
    grant.issuedAt < authoritySnapshot.issuedAt
  ) {
    throw new TypeError('Project-read cleanup grant does not bind its exact authority snapshot');
  }
}

export function assertTerminalProjectReadSnapshotCleanupGrantEligibility(
  grant: ProjectReadSnapshotCleanupGrant,
  authoritySnapshot: ProjectReadWorkspaceAuthoritySnapshot,
  projectReadRecord: ProjectReadCleanupAuthorityRecordView,
  attempt: ProjectReadCleanupTerminalAttemptView,
  externalExecution: ProjectReadCleanupTerminalExternalExecutionView,
): asserts grant is Extract<
  ProjectReadSnapshotCleanupGrant,
  { readonly eligibilityKind: 'TERMINAL' }
> {
  if (grant.eligibilityKind !== ProjectReadSnapshotCleanupEligibilityKind.TERMINAL) {
    throw new TypeError('Project-read cleanup grant is not terminal-snapshot authority');
  }
  assertGrantMatchesAuthoritySnapshot(grant, authoritySnapshot);
  const expected = authoritySnapshot.expectedSnapshots.find(
    (entry) => entry.projectReadAuthorityId === grant.projectReadAuthorityId,
  );
  if (
    expected?.retention !== ProjectReadWorkspaceRetention.RETAINED ||
    expected.snapshotId !== grant.snapshotId ||
    expected.authorityRecordDigest !== grant.projectReadAuthorityRecordDigest ||
    expected.ownershipMarkerDigest !== grant.ownershipMarkerDigest ||
    expected.workspaceRootIdentity !== grant.workspaceRootIdentity ||
    expected.snapshotLeafRealpath !== grant.snapshotLeafRealpath ||
    authoritySnapshot.activeConsumers.some((consumer) => consumer.snapshotId === grant.snapshotId)
  ) {
    throw new TypeError('Project-read terminal cleanup grant lacks inactive retained authority');
  }
  if (
    projectReadRecord.id !== grant.projectReadAuthorityId ||
    projectReadRecord.recordDigest !== grant.projectReadAuthorityRecordDigest ||
    projectReadRecord.snapshotId !== grant.snapshotId ||
    projectReadRecord.workspaceRootIdentity !== grant.workspaceRootIdentity ||
    projectReadRecord.snapshotLeafRealpath !== grant.snapshotLeafRealpath ||
    projectReadRecord.ownershipMarkerDigest !== grant.ownershipMarkerDigest ||
    projectReadRecord.attemptId !== grant.attemptId
  ) {
    throw new TypeError('Project-read terminal cleanup grant substituted project-read authority');
  }
  if (
    attempt.id !== grant.attemptId ||
    attempt.status !== grant.terminalAttemptStatus ||
    attempt.endedAt !== grant.terminalAttemptEndedAt
  ) {
    throw new TypeError('Project-read terminal cleanup grant substituted terminal Attempt');
  }
  if (
    externalExecution.id !== grant.externalExecutionId ||
    externalExecution.attemptId !== grant.attemptId ||
    externalExecution.state !== grant.terminalExternalExecutionState ||
    externalExecution.terminalAt !== grant.terminalExternalExecutionAt ||
    externalExecution.recordDigest !== grant.terminalExternalExecutionRecordDigest
  ) {
    throw new TypeError(
      'Project-read terminal cleanup grant substituted terminal external execution',
    );
  }
}

export function assertOrphanedProjectReadSnapshotCleanupGrantEligibility(
  grant: ProjectReadSnapshotCleanupGrant,
  authoritySnapshot: ProjectReadWorkspaceAuthoritySnapshot,
  observation: ProjectReadWorkspaceObservation,
): asserts grant is Extract<
  ProjectReadSnapshotCleanupGrant,
  { readonly eligibilityKind: 'ORPHANED' }
> {
  if (grant.eligibilityKind !== ProjectReadSnapshotCleanupEligibilityKind.ORPHANED) {
    throw new TypeError('Project-read cleanup grant is not orphan authority');
  }
  assertGrantMatchesAuthoritySnapshot(grant, authoritySnapshot);
  assertProjectReadWorkspaceObservationMatchesAuthoritySnapshot(observation, authoritySnapshot);
  if (
    observation.classification !== ProjectReadWorkspaceClassification.OWNED_ORPHANED ||
    observation.id !== grant.workspaceObservationId ||
    observation.observationDigest !== grant.workspaceObservationDigest ||
    observation.projectReadAuthorityId !== grant.projectReadAuthorityId ||
    observation.snapshotId !== grant.snapshotId ||
    observation.workspaceRootIdentity !== grant.workspaceRootIdentity ||
    observation.snapshotLeafRealpath !== grant.snapshotLeafRealpath ||
    observation.ownershipMarkerDigest !== grant.ownershipMarkerDigest ||
    observation.observedAt > grant.issuedAt
  ) {
    throw new TypeError('Project-read orphan cleanup grant lacks exact owned-orphan observation');
  }
}

export function assertProjectReadSnapshotCleanupObservationMatchesGrant(
  observation: ProjectReadSnapshotCleanupObservation,
  grant: ProjectReadSnapshotCleanupGrant,
): void {
  if (
    observation.grantId !== grant.id ||
    observation.grantDigest !== grant.grantDigest ||
    observation.workspaceRootIdentity !== grant.workspaceRootIdentity ||
    observation.snapshotLeafRealpath !== grant.snapshotLeafRealpath ||
    observation.expectedOwnershipMarkerDigest !== grant.ownershipMarkerDigest ||
    observation.terminalTargetObservation.observedAt < grant.issuedAt ||
    (observation.failurePreEffectTargetObservation !== null &&
      observation.failurePreEffectTargetObservation.observedAt < grant.issuedAt) ||
    observation.observedAt < grant.issuedAt
  ) {
    throw new TypeError('Project-read cleanup observation does not bind its exact grant');
  }
}

export function assertProjectReadSnapshotCleanupOutcomeClosure(
  outcome: ProjectReadSnapshotCleanupOutcome,
  observation: ProjectReadSnapshotCleanupObservation,
  grant: ProjectReadSnapshotCleanupGrant,
): void {
  assertProjectReadSnapshotCleanupObservationMatchesGrant(observation, grant);
  if (
    outcome.grantId !== grant.id ||
    outcome.grantDigest !== grant.grantDigest ||
    outcome.cleanupObservationId !== observation.id ||
    outcome.cleanupObservationDigest !== observation.observationDigest ||
    outcome.disposition !== observation.disposition ||
    outcome.resolvedAt < observation.observedAt
  ) {
    throw new TypeError('Project-read cleanup Outcome does not close its exact observation');
  }
}

export function decideProjectReadSnapshotCleanupRequest(
  requestedGrant: ProjectReadSnapshotCleanupGrant,
  retainedGrant: ProjectReadSnapshotCleanupGrant | null,
  retainedOutcome: ProjectReadSnapshotCleanupOutcome | null,
): ProjectReadSnapshotCleanupRequestDecision {
  if (retainedGrant?.id !== requestedGrant.id) {
    return Object.freeze({
      disposition: ProjectReadSnapshotCleanupRequestDisposition.REJECTED_MISSING_GRANT,
    });
  }
  if (retainedGrant.grantDigest !== requestedGrant.grantDigest) {
    return Object.freeze({
      disposition: ProjectReadSnapshotCleanupRequestDisposition.REJECTED_IDENTITY_CONFLICT,
    });
  }
  if (retainedOutcome !== null) {
    if (
      retainedOutcome.grantId !== retainedGrant.id ||
      retainedOutcome.grantDigest !== retainedGrant.grantDigest ||
      retainedOutcome.resolvedAt < retainedGrant.issuedAt
    ) {
      throw new TypeError('Retained project-read cleanup Outcome conflicts with its grant');
    }
    return Object.freeze({
      disposition: ProjectReadSnapshotCleanupRequestDisposition.RETURN_RETAINED_OUTCOME,
      outcome: retainedOutcome,
    });
  }
  return Object.freeze({
    disposition: ProjectReadSnapshotCleanupRequestDisposition.INVOKE_UNRESOLVED,
    grant: retainedGrant,
  });
}
