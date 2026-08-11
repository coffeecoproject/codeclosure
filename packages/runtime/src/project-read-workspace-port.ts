import {
  decodeProjectReadSnapshotCleanupGrant,
  decodeProjectReadGitStateProjection,
  decodeProjectReadSourceTreeProjection,
  decodeProjectSourceReadAuthorityRecord,
  type ProjectReadSnapshotCleanupGrant,
  type ProjectSourceReadAuthorityRecord,
} from '@codeclosure/domain';

import {
  digestProjectReadSnapshotCleanupValue,
  type ProjectReadSnapshotCleanupObservation,
} from './project-read-snapshot-cleanup-contracts.js';
import type {
  ProjectReadSnapshotCurrencyObservation,
  ProjectReadSnapshotMaterializationReceipt,
  ProjectReadSourceObservation,
  ProjectReadSourceObservationRequest,
  ProjectReadWorkspaceAuthoritySnapshot,
  ProjectReadWorkspaceObservation,
} from './project-read-workspace-contracts.js';

/** A canonical record candidate that has not yet acquired persisted authority. */
export type ProjectReadSnapshotMaterializationRequest = ProjectSourceReadAuthorityRecord;
export type ProjectReadSnapshotCleanupRequest = ProjectReadSnapshotCleanupGrant;

export function decodeProjectReadSnapshotMaterializationRequest(
  value: unknown,
): ProjectReadSnapshotMaterializationRequest {
  return decodeProjectSourceReadAuthorityRecord(value);
}

export function decodeProjectReadSnapshotSourceTree(
  value: unknown,
): ProjectReadSnapshotMaterializationRequest['sourceTree'] {
  return decodeProjectReadSourceTreeProjection(value);
}

export function decodeProjectReadSnapshotGitState(
  value: unknown,
): ProjectReadSnapshotMaterializationRequest['gitState'] {
  return decodeProjectReadGitStateProjection(value);
}

export function decodeProjectReadSnapshotCleanupRequest(
  value: unknown,
): ProjectReadSnapshotCleanupRequest {
  return decodeProjectReadSnapshotCleanupGrant(value, {
    digest: digestProjectReadSnapshotCleanupValue,
  });
}

/**
 * Narrow trusted filesystem effect boundary for candidate-free project reads.
 * Returned values are observations only; the port cannot persist authority,
 * start a Worker, mutate Workflow state, or issue a Cleanup Grant.
 */
export interface ProjectReadWorkspacePort {
  observeSource(request: ProjectReadSourceObservationRequest): ProjectReadSourceObservation;
  observeSnapshot(record: ProjectSourceReadAuthorityRecord): ProjectReadSnapshotCurrencyObservation;
  snapshotLeafFor(snapshotId: string): string;
  readonly workspaceRootIdentity: string;
  materializeSnapshot(
    proposedRecord: ProjectReadSnapshotMaterializationRequest,
  ): ProjectReadSnapshotMaterializationReceipt;
  reconcile(
    authority: ProjectReadWorkspaceAuthoritySnapshot,
  ): readonly ProjectReadWorkspaceObservation[];
  cleanupSnapshot(
    grant: ProjectReadSnapshotCleanupRequest,
  ): ProjectReadSnapshotCleanupObservation | null;
}
