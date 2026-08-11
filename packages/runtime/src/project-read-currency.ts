import {
  decodeProjectSourceReadAuthorityRecord,
  projectReadGitStateProjection,
  projectReadSourceTreeProjection,
  projectSourceReadAuthorityProjection,
  type ProjectSourceReadAuthorityRecord,
} from '@codeclosure/domain';

import { canonicalizeJson } from './canonical-json.js';
import type { DigestProvider } from './ports.js';
import {
  ProjectReadCurrencyFailureReasonCode,
  type ProjectReadCurrencyFailureReasonCode as ProjectReadCurrencyFailureReason,
} from './project-read-currency-contracts.js';
import {
  ProjectReadSnapshotCurrencyState,
  assertProjectReadSnapshotCurrencyObservationMatchesRecord,
  decodeProjectReadSnapshotCurrencyObservation,
  decodeProjectReadSourceObservation,
} from './project-read-workspace-contracts.js';
import type { ProjectReadWorkspacePort } from './project-read-workspace-port.js';

export { ProjectReadCurrencyFailureReasonCode } from './project-read-currency-contracts.js';

export type ProjectReadCurrencyEvaluation =
  | Readonly<{
      readonly status: 'CURRENT';
      readonly record: ProjectSourceReadAuthorityRecord;
    }>
  | Readonly<{
      readonly status: 'FAILED';
      readonly reasonCode: ProjectReadCurrencyFailureReason;
    }>;

function authorityInvalid(): ProjectReadCurrencyEvaluation {
  return Object.freeze({
    status: 'FAILED',
    reasonCode: ProjectReadCurrencyFailureReasonCode.PROJECT_READ_AUTHORITY_INVALID,
  });
}

/**
 * Evaluates one retained ProjectRead capability at an ADR-defined checkpoint.
 * The workspace owns filesystem observation; Runtime owns the closed reason.
 */
export function evaluateProjectReadCurrency(
  rawRecord: ProjectSourceReadAuthorityRecord,
  workspace: ProjectReadWorkspacePort,
  digests: DigestProvider,
): ProjectReadCurrencyEvaluation {
  let record: ProjectSourceReadAuthorityRecord;
  try {
    record = decodeProjectSourceReadAuthorityRecord(rawRecord);
    const { projectionDigest: sourceTreeDigest, ...sourceTree } = record.sourceTree;
    const { projectionDigest: gitStateDigest, ...gitState } = record.gitState;
    const { recordDigest, ...recordWithoutDigest } = record;
    if (
      sourceTreeDigest !== digests.digest(projectReadSourceTreeProjection(sourceTree)) ||
      gitStateDigest !== digests.digest(projectReadGitStateProjection(gitState)) ||
      recordDigest !== digests.digest(projectSourceReadAuthorityProjection(recordWithoutDigest))
    ) {
      return authorityInvalid();
    }
  } catch {
    return authorityInvalid();
  }

  let sourceDrift = false;
  let authorityFailure = false;
  try {
    const source = decodeProjectReadSourceObservation(
      workspace.observeSource({
        schemaVersion: 1,
        normalizedProjectRoot: record.normalizedProjectRoot,
      }),
    );
    if (
      source.normalizedProjectRoot !== record.normalizedProjectRoot ||
      source.resolvedProjectRoot !== record.resolvedProjectRoot ||
      source.repositoryControlRootIdentity !== record.repositoryControlRootIdentity
    ) {
      authorityFailure = true;
    } else {
      sourceDrift =
        canonicalizeJson(source.sourceTree) !== canonicalizeJson(record.sourceTree) ||
        canonicalizeJson(source.gitState) !== canonicalizeJson(record.gitState);
    }
  } catch {
    authorityFailure = true;
  }

  let snapshotState: ProjectReadSnapshotCurrencyState | undefined;
  try {
    const snapshot = decodeProjectReadSnapshotCurrencyObservation(
      workspace.observeSnapshot(record),
    );
    assertProjectReadSnapshotCurrencyObservationMatchesRecord(snapshot, record);
    snapshotState = snapshot.state;
  } catch {
    authorityFailure = true;
  }

  if (
    authorityFailure ||
    snapshotState === undefined ||
    snapshotState === ProjectReadSnapshotCurrencyState.AUTHORITY_MISSING ||
    snapshotState === ProjectReadSnapshotCurrencyState.AUTHORITY_ALIASED ||
    snapshotState === ProjectReadSnapshotCurrencyState.AUTHORITY_UNVERIFIABLE
  ) {
    return authorityInvalid();
  }
  if (sourceDrift) {
    return Object.freeze({
      status: 'FAILED',
      reasonCode: ProjectReadCurrencyFailureReasonCode.PROJECT_SOURCE_DRIFT,
    });
  }
  if (snapshotState !== ProjectReadSnapshotCurrencyState.CURRENT) {
    return Object.freeze({
      status: 'FAILED',
      reasonCode: ProjectReadCurrencyFailureReasonCode.PROJECT_READ_SNAPSHOT_DRIFT,
    });
  }
  return Object.freeze({ status: 'CURRENT', record });
}
