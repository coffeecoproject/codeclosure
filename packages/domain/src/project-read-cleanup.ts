import { isAbsolute, relative, resolve, sep } from 'node:path';

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
  type AttemptId,
  type ExternalExecutionId,
  type IsoTimestamp,
  type ProjectReadSnapshotCleanupGrantId,
  type ProjectReadSnapshotCleanupObservationId,
  type ProjectReadSnapshotCleanupOutcomeId,
  type ProjectReadSnapshotId,
  type ProjectReadWorkspaceAuthoritySnapshotId,
  type ProjectReadWorkspaceObservationId,
  type ProjectSourceReadAuthorityId,
  type Sha256Digest,
} from './identifiers.js';
import { AttemptStatus, type AttemptStatus as AttemptStatusType } from './model.js';
import {
  ExternalExecutionState,
  type ExternalExecutionState as ExternalExecutionStateType,
} from './external-execution.js';
import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
} from './project-read.js';

export const ProjectReadSnapshotCleanupEligibilityKind = {
  TERMINAL: 'TERMINAL',
  ORPHANED: 'ORPHANED',
} as const;
export type ProjectReadSnapshotCleanupEligibilityKind =
  (typeof ProjectReadSnapshotCleanupEligibilityKind)[keyof typeof ProjectReadSnapshotCleanupEligibilityKind];

export const ProjectReadSnapshotCleanupLifecyclePolicy = {
  CONSUME_ONCE: 'CONSUME_ONCE',
} as const;
export type ProjectReadSnapshotCleanupLifecyclePolicy =
  (typeof ProjectReadSnapshotCleanupLifecyclePolicy)[keyof typeof ProjectReadSnapshotCleanupLifecyclePolicy];

export const ProjectReadSnapshotCleanupDisposition = {
  DELETED: 'DELETED',
  ALREADY_ABSENT: 'ALREADY_ABSENT',
  RETAINED_UNSAFE: 'RETAINED_UNSAFE',
  FAILED: 'FAILED',
} as const;
export type ProjectReadSnapshotCleanupDisposition =
  (typeof ProjectReadSnapshotCleanupDisposition)[keyof typeof ProjectReadSnapshotCleanupDisposition];

interface ProjectReadSnapshotCleanupGrantBaseV1 {
  readonly schemaVersion: 1;
  readonly id: ProjectReadSnapshotCleanupGrantId;
  readonly authoritySnapshotId: ProjectReadWorkspaceAuthoritySnapshotId;
  readonly authoritySnapshotDigest: Sha256Digest;
  readonly authoritySequence: number;
  readonly projectReadAuthorityId: ProjectSourceReadAuthorityId;
  readonly snapshotId: ProjectReadSnapshotId;
  readonly workspaceRootIdentity: string;
  readonly snapshotLeafRealpath: string;
  readonly ownershipMarkerProfile: typeof PROJECT_READ_OWNERSHIP_MARKER_PROFILE;
  readonly ownershipMarkerDigest: Sha256Digest;
  readonly cleanupPolicy: typeof PROJECT_READ_CLEANUP_POLICY;
  readonly lifecyclePolicy: typeof ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE;
  readonly issuedAt: IsoTimestamp;
  readonly grantDigest: Sha256Digest;
}

export interface TerminalProjectReadSnapshotCleanupGrantV1 extends ProjectReadSnapshotCleanupGrantBaseV1 {
  readonly eligibilityKind: typeof ProjectReadSnapshotCleanupEligibilityKind.TERMINAL;
  readonly projectReadAuthorityRecordDigest: Sha256Digest;
  readonly attemptId: AttemptId;
  readonly terminalAttemptStatus:
    | typeof AttemptStatus.RESULT_RECORDED
    | typeof AttemptStatus.FAILED
    | typeof AttemptStatus.INTERRUPTED;
  readonly terminalAttemptEndedAt: IsoTimestamp;
  readonly externalExecutionId: ExternalExecutionId;
  readonly terminalExternalExecutionState:
    | typeof ExternalExecutionState.COMPLETED
    | typeof ExternalExecutionState.INTERRUPTED
    | typeof ExternalExecutionState.FAILED
    | typeof ExternalExecutionState.ABANDONED;
  readonly terminalExternalExecutionAt: IsoTimestamp;
  readonly terminalExternalExecutionRecordDigest: Sha256Digest;
}

export interface OrphanedProjectReadSnapshotCleanupGrantV1 extends ProjectReadSnapshotCleanupGrantBaseV1 {
  readonly eligibilityKind: typeof ProjectReadSnapshotCleanupEligibilityKind.ORPHANED;
  readonly workspaceObservationId: ProjectReadWorkspaceObservationId;
  readonly workspaceObservationDigest: Sha256Digest;
}

export type ProjectReadSnapshotCleanupGrantV1 =
  TerminalProjectReadSnapshotCleanupGrantV1 | OrphanedProjectReadSnapshotCleanupGrantV1;

export type ProjectReadSnapshotCleanupGrant = ProjectReadSnapshotCleanupGrantV1;

export type ProjectReadSnapshotCleanupGrantProjectionInput =
  | Omit<TerminalProjectReadSnapshotCleanupGrantV1, 'grantDigest'>
  | Omit<OrphanedProjectReadSnapshotCleanupGrantV1, 'grantDigest'>;

export interface ProjectReadSnapshotCleanupOutcomeV1 {
  readonly schemaVersion: 1;
  readonly id: ProjectReadSnapshotCleanupOutcomeId;
  readonly grantId: ProjectReadSnapshotCleanupGrantId;
  readonly grantDigest: Sha256Digest;
  readonly cleanupObservationId: ProjectReadSnapshotCleanupObservationId;
  readonly cleanupObservationDigest: Sha256Digest;
  readonly disposition: ProjectReadSnapshotCleanupDisposition;
  readonly resolvedAt: IsoTimestamp;
  readonly outcomeDigest: Sha256Digest;
}

export type ProjectReadSnapshotCleanupOutcome = ProjectReadSnapshotCleanupOutcomeV1;

function field(value: object, key: PropertyKey): unknown {
  return Reflect.get(value, key) as unknown;
}

function positiveInteger(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${name} must be a positive safe integer`);
  }
}

function exactAbsolutePath(value: string, name: string): void {
  if (
    value.trim().length === 0 ||
    value.includes('\u0000') ||
    value !== value.normalize('NFC') ||
    !isAbsolute(value) ||
    resolve(value) !== value
  ) {
    throw new TypeError(`${name} must be an exact normalized absolute path`);
  }
}

function isSameOrWithin(path: string, parent: string): boolean {
  const relation = relative(parent, path);
  return (
    relation === '' ||
    (!relation.startsWith(`..${sep}`) && relation !== '..' && !isAbsolute(relation))
  );
}

function terminalAttemptStatus(value: AttemptStatusType): boolean {
  return (
    value === AttemptStatus.RESULT_RECORDED ||
    value === AttemptStatus.FAILED ||
    value === AttemptStatus.INTERRUPTED
  );
}

function terminalExternalExecutionState(value: ExternalExecutionStateType): boolean {
  return (
    value === ExternalExecutionState.COMPLETED ||
    value === ExternalExecutionState.INTERRUPTED ||
    value === ExternalExecutionState.FAILED ||
    value === ExternalExecutionState.ABANDONED
  );
}

export function projectReadSnapshotCleanupGrantProjection(
  grant: ProjectReadSnapshotCleanupGrantProjectionInput,
): unknown {
  const common = {
    schemaVersion: grant.schemaVersion,
    id: grant.id,
    eligibilityKind: grant.eligibilityKind,
    authoritySnapshotId: grant.authoritySnapshotId,
    authoritySnapshotDigest: grant.authoritySnapshotDigest,
    authoritySequence: grant.authoritySequence,
    projectReadAuthorityId: grant.projectReadAuthorityId,
    snapshotId: grant.snapshotId,
    workspaceRootIdentity: grant.workspaceRootIdentity,
    snapshotLeafRealpath: grant.snapshotLeafRealpath,
    ownershipMarkerProfile: grant.ownershipMarkerProfile,
    ownershipMarkerDigest: grant.ownershipMarkerDigest,
    cleanupPolicy: grant.cleanupPolicy,
    lifecyclePolicy: grant.lifecyclePolicy,
    issuedAt: grant.issuedAt,
  };
  if (grant.eligibilityKind === ProjectReadSnapshotCleanupEligibilityKind.TERMINAL) {
    return {
      ...common,
      projectReadAuthorityRecordDigest: grant.projectReadAuthorityRecordDigest,
      attemptId: grant.attemptId,
      terminalAttemptStatus: grant.terminalAttemptStatus,
      terminalAttemptEndedAt: grant.terminalAttemptEndedAt,
      externalExecutionId: grant.externalExecutionId,
      terminalExternalExecutionState: grant.terminalExternalExecutionState,
      terminalExternalExecutionAt: grant.terminalExternalExecutionAt,
      terminalExternalExecutionRecordDigest: grant.terminalExternalExecutionRecordDigest,
    };
  }
  return {
    ...common,
    workspaceObservationId: grant.workspaceObservationId,
    workspaceObservationDigest: grant.workspaceObservationDigest,
  };
}

export function projectReadSnapshotCleanupOutcomeProjection(
  outcome: Omit<ProjectReadSnapshotCleanupOutcome, 'outcomeDigest'>,
): unknown {
  return {
    schemaVersion: outcome.schemaVersion,
    id: outcome.id,
    grantId: outcome.grantId,
    grantDigest: outcome.grantDigest,
    cleanupObservationId: outcome.cleanupObservationId,
    cleanupObservationDigest: outcome.cleanupObservationDigest,
    disposition: outcome.disposition,
    resolvedAt: outcome.resolvedAt,
  };
}

export function assertProjectReadSnapshotCleanupGrantInvariant(
  grant: ProjectReadSnapshotCleanupGrant,
): void {
  if (field(grant, 'schemaVersion') !== 1) {
    throw new TypeError('Project-read cleanup grant schema is unsupported');
  }
  projectReadSnapshotCleanupGrantId(grant.id);
  projectReadWorkspaceAuthoritySnapshotId(grant.authoritySnapshotId);
  sha256Digest(grant.authoritySnapshotDigest);
  positiveInteger(grant.authoritySequence, 'Project-read cleanup authority sequence');
  projectSourceReadAuthorityId(grant.projectReadAuthorityId);
  projectReadSnapshotId(grant.snapshotId);
  exactAbsolutePath(grant.workspaceRootIdentity, 'Project-read cleanup workspace root');
  exactAbsolutePath(grant.snapshotLeafRealpath, 'Project-read cleanup snapshot leaf');
  if (
    grant.workspaceRootIdentity === grant.snapshotLeafRealpath ||
    !isSameOrWithin(grant.snapshotLeafRealpath, grant.workspaceRootIdentity)
  ) {
    throw new TypeError('Project-read cleanup target is outside its exact owned root');
  }
  if (
    field(grant, 'ownershipMarkerProfile') !== PROJECT_READ_OWNERSHIP_MARKER_PROFILE ||
    field(grant, 'cleanupPolicy') !== PROJECT_READ_CLEANUP_POLICY ||
    field(grant, 'lifecyclePolicy') !== ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE
  ) {
    throw new TypeError('Project-read cleanup grant policy identity is unsupported');
  }
  sha256Digest(grant.ownershipMarkerDigest);
  isoTimestamp(grant.issuedAt);
  if (grant.eligibilityKind === ProjectReadSnapshotCleanupEligibilityKind.TERMINAL) {
    sha256Digest(grant.projectReadAuthorityRecordDigest);
    attemptId(grant.attemptId);
    if (!terminalAttemptStatus(grant.terminalAttemptStatus)) {
      throw new TypeError('Project-read cleanup Attempt is not terminal');
    }
    isoTimestamp(grant.terminalAttemptEndedAt);
    externalExecutionId(grant.externalExecutionId);
    if (!terminalExternalExecutionState(grant.terminalExternalExecutionState)) {
      throw new TypeError('Project-read cleanup external execution is not terminal');
    }
    isoTimestamp(grant.terminalExternalExecutionAt);
    sha256Digest(grant.terminalExternalExecutionRecordDigest);
    if (
      grant.issuedAt < grant.terminalAttemptEndedAt ||
      grant.issuedAt < grant.terminalExternalExecutionAt
    ) {
      throw new TypeError('Project-read terminal cleanup grant predates terminal authority');
    }
  } else {
    projectReadWorkspaceObservationId(grant.workspaceObservationId);
    sha256Digest(grant.workspaceObservationDigest);
  }
  sha256Digest(grant.grantDigest);
}

export function assertProjectReadSnapshotCleanupOutcomeInvariant(
  outcome: ProjectReadSnapshotCleanupOutcome,
): void {
  if (
    field(outcome, 'schemaVersion') !== 1 ||
    !Object.values(ProjectReadSnapshotCleanupDisposition).some(
      (value) => value === field(outcome, 'disposition'),
    )
  ) {
    throw new TypeError('Project-read cleanup Outcome identity is unsupported');
  }
  projectReadSnapshotCleanupOutcomeId(outcome.id);
  projectReadSnapshotCleanupGrantId(outcome.grantId);
  sha256Digest(outcome.grantDigest);
  projectReadSnapshotCleanupObservationId(outcome.cleanupObservationId);
  sha256Digest(outcome.cleanupObservationDigest);
  isoTimestamp(outcome.resolvedAt);
  sha256Digest(outcome.outcomeDigest);
}
