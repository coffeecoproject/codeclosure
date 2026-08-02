import type {
  CandidateWorkspaceAuthoritySnapshot,
  CandidateWorkspaceCleanupGrant,
  CandidateWorkspaceLeaseAuthorityPort,
  CandidateWorkspaceLeasePort,
  CandidateSourcePort,
} from '@codeclosure/runtime';

export interface CandidateWorkspaceBounds {
  readonly maximumFileBytes: number;
  readonly maximumFileCount: number;
  readonly maximumPathBytes: number;
  readonly maximumTotalBytes: number;
}

export const DEFAULT_CANDIDATE_WORKSPACE_BOUNDS: CandidateWorkspaceBounds = Object.freeze({
  maximumFileBytes: 4 * 1024 * 1024,
  maximumFileCount: 4_096,
  maximumPathBytes: 4_096,
  maximumTotalBytes: 64 * 1024 * 1024,
});

export interface LocalCandidateWorkspaceOptions {
  /** Trusted roots that a Candidate must never overlap, such as authority or credential homes. */
  readonly authorityRoots: readonly string[];
  readonly bounds?: CandidateWorkspaceBounds;
  /** Stable trusted composition identity recorded in the external ownership marker. */
  readonly ownerId: string;
  /** A dedicated CodeClosure-owned root. It must not be inside a source or authority root. */
  readonly workspaceRoot: string;
}

export interface LocalCandidateSourceIdentity {
  readonly schemaVersion: 1;
  readonly sourceGitMetadataDigest: string;
  readonly sourceTreeDigest: string;
}

export const WorkspaceReconciliationClassification = {
  OWNED_CURRENT: 'OWNED_CURRENT',
  OWNED_ORPHANED: 'OWNED_ORPHANED',
  OWNED_RETAINED: 'OWNED_RETAINED',
  UNSAFE: 'UNSAFE',
} as const;
export type WorkspaceReconciliationClassification =
  (typeof WorkspaceReconciliationClassification)[keyof typeof WorkspaceReconciliationClassification];

export interface CandidateWorkspaceReconciliationEntry {
  readonly candidateRoot: string;
  readonly classification: WorkspaceReconciliationClassification;
  readonly cleanupGrant: CandidateWorkspaceCleanupGrant | null;
  readonly generationId: string | null;
  readonly ownershipDigest: string | null;
  readonly reason: string;
}

export interface CandidateWorkspaceCleanupResult {
  readonly candidateRoot: string;
  readonly generationId: string;
  readonly status: 'REMOVED';
}

export interface LocalCandidateWorkspace
  extends CandidateSourcePort, CandidateWorkspaceLeasePort, CandidateWorkspaceLeaseAuthorityPort {
  cleanupOrphanedGeneration(grant: CandidateWorkspaceCleanupGrant): CandidateWorkspaceCleanupResult;
  reconcile(
    authority: CandidateWorkspaceAuthoritySnapshot,
  ): readonly CandidateWorkspaceReconciliationEntry[];
  readonly workspaceRootIdentity: string;
}

export const LocalCandidateWorkspaceFailureCode = {
  AUTHORITY_SNAPSHOT_CONFLICT: 'AUTHORITY_SNAPSHOT_CONFLICT',
  BOUNDS_EXCEEDED: 'BOUNDS_EXCEEDED',
  CANDIDATE_DRIFT: 'CANDIDATE_DRIFT',
  CLEANUP_NOT_AUTHORIZED: 'CLEANUP_NOT_AUTHORIZED',
  CONTAINMENT_VIOLATION: 'CONTAINMENT_VIOLATION',
  GIT_INVOCATION_FAILED: 'GIT_INVOCATION_FAILED',
  INVALID_CONFIGURATION: 'INVALID_CONFIGURATION',
  INVALID_LEASE: 'INVALID_LEASE',
  INVALID_RECORD: 'INVALID_RECORD',
  PATH_POLICY_VIOLATION: 'PATH_POLICY_VIOLATION',
  SOURCE_DRIFT: 'SOURCE_DRIFT',
  SOURCE_UNSUPPORTED: 'SOURCE_UNSUPPORTED',
  STALE_AUTHORITY_SNAPSHOT: 'STALE_AUTHORITY_SNAPSHOT',
  WORKSPACE_CONFLICT: 'WORKSPACE_CONFLICT',
} as const;
export type LocalCandidateWorkspaceFailureCode =
  (typeof LocalCandidateWorkspaceFailureCode)[keyof typeof LocalCandidateWorkspaceFailureCode];

export class LocalCandidateWorkspaceError extends Error {
  public readonly code: LocalCandidateWorkspaceFailureCode;

  public constructor(code: LocalCandidateWorkspaceFailureCode, message: string) {
    super(message);
    this.name = 'LocalCandidateWorkspaceError';
    this.code = code;
  }
}
