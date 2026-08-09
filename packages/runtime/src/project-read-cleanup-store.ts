import type {
  AuditEventId,
  IsoTimestamp,
  ProjectReadSnapshotCleanupGrant,
  ProjectReadSnapshotCleanupGrantId,
  ProjectReadSnapshotCleanupOutcome,
  ProjectReadWorkspaceAuthoritySnapshotId,
  ProjectReadWorkspaceObservationId,
  Sha256Digest,
} from '@codeclosure/domain';

import type { ProjectReadSnapshotCleanupObservation } from './project-read-snapshot-cleanup-contracts.js';
import type {
  ProjectReadWorkspaceAuthoritySnapshot,
  ProjectReadWorkspaceObservation,
} from './project-read-workspace-contracts.js';

interface ProjectReadCleanupAuditIdentity {
  readonly correlationId?: string;
  readonly causationId?: string;
}

export interface CaptureProjectReadWorkspaceAuthoritySnapshot extends ProjectReadCleanupAuditIdentity {
  readonly id: ProjectReadWorkspaceAuthoritySnapshotId;
  readonly issuedAt: IsoTimestamp;
  readonly auditEventId: AuditEventId;
}

export type ProjectReadWorkspaceAuthoritySnapshotStoreResult =
  | Readonly<{
      readonly status: 'ISSUED' | 'EXISTING';
      readonly value: ProjectReadWorkspaceAuthoritySnapshot;
    }>
  | Readonly<{
      readonly status: 'SNAPSHOT_CONFLICT';
      readonly message: string;
    }>;

export interface RecordProjectReadWorkspaceObservation extends ProjectReadCleanupAuditIdentity {
  readonly observation: ProjectReadWorkspaceObservation;
  readonly auditEventId: AuditEventId;
}

export type ProjectReadWorkspaceObservationStoreResult =
  | Readonly<{
      readonly status: 'RECORDED' | 'EXISTING';
      readonly value: ProjectReadWorkspaceObservation;
    }>
  | Readonly<{
      readonly status: 'OBSERVATION_CONFLICT';
      readonly message: string;
    }>;

export interface IssueProjectReadSnapshotCleanupGrant extends ProjectReadCleanupAuditIdentity {
  readonly grant: ProjectReadSnapshotCleanupGrant;
  readonly auditEventId: AuditEventId;
}

export type ProjectReadSnapshotCleanupGrantStoreResult =
  | Readonly<{
      readonly status: 'ISSUED' | 'EXISTING';
      readonly value: ProjectReadSnapshotCleanupGrant;
    }>
  | Readonly<{
      readonly status: 'GRANT_CONFLICT' | 'NOT_ELIGIBLE';
      readonly message: string;
    }>;

export interface ResolveProjectReadSnapshotCleanupGrant extends ProjectReadCleanupAuditIdentity {
  readonly grantId: ProjectReadSnapshotCleanupGrantId;
  readonly grantDigest: Sha256Digest;
  readonly observation: ProjectReadSnapshotCleanupObservation;
  readonly outcome: ProjectReadSnapshotCleanupOutcome;
  readonly observationAuditEventId: AuditEventId;
  readonly outcomeAuditEventId: AuditEventId;
}

export type ProjectReadSnapshotCleanupResolutionStoreResult =
  | Readonly<{
      readonly status: 'APPLIED' | 'REPLAYED';
      readonly value: ProjectReadSnapshotCleanupOutcome;
    }>
  | Readonly<{
      readonly status: 'GRANT_CONFLICT' | 'RESOLUTION_CONFLICT';
      readonly message: string;
    }>;

/**
 * Runtime-owned cleanup authority. The workspace effect port cannot create,
 * consume, or resolve any of these records.
 */
export interface ProjectReadCleanupControlStore {
  captureProjectReadWorkspaceAuthoritySnapshot(
    input: CaptureProjectReadWorkspaceAuthoritySnapshot,
  ): ProjectReadWorkspaceAuthoritySnapshotStoreResult;
  getProjectReadWorkspaceAuthoritySnapshot(
    id: ProjectReadWorkspaceAuthoritySnapshotId,
  ): ProjectReadWorkspaceAuthoritySnapshot | undefined;
  recordProjectReadWorkspaceObservation(
    input: RecordProjectReadWorkspaceObservation,
  ): ProjectReadWorkspaceObservationStoreResult;
  getProjectReadWorkspaceObservation(
    id: ProjectReadWorkspaceObservationId,
  ): ProjectReadWorkspaceObservation | undefined;
  issueProjectReadSnapshotCleanupGrant(
    input: IssueProjectReadSnapshotCleanupGrant,
  ): ProjectReadSnapshotCleanupGrantStoreResult;
  getProjectReadSnapshotCleanupGrant(
    id: ProjectReadSnapshotCleanupGrantId,
  ): ProjectReadSnapshotCleanupGrant | undefined;
  getProjectReadSnapshotCleanupOutcome(
    grantId: ProjectReadSnapshotCleanupGrantId,
  ): ProjectReadSnapshotCleanupOutcome | undefined;
  resolveProjectReadSnapshotCleanupGrant(
    input: ResolveProjectReadSnapshotCleanupGrant,
  ): ProjectReadSnapshotCleanupResolutionStoreResult;
}
