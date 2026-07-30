import {
  AttemptStatus,
  WorkerResultKind,
  WorkflowPhase,
  type Attempt,
  type ContextManifest,
  type Sha256Digest,
} from '@codeclosure/domain';

import { m1WorkerResponseContract } from './context-compiler.js';
import { attemptFailureClassForKnownWorkerReasonCode } from './worker-contracts.js';

/**
 * Proves the M1 Worker authority intrinsic to one retained
 * Context-Manifest/Attempt snapshot. Aggregate-current relationships remain
 * with the caller because a terminal historical Attempt can precede the
 * current Workflow version.
 */
export function assertM1WorkerPhaseAttemptAuthority(
  manifest: ContextManifest,
  attempt: Attempt,
  expectedCapabilityGrantDigest: Sha256Digest,
  expectedResponseContractDigest: Sha256Digest,
): void {
  const isWorkerPhase =
    attempt.phase === WorkflowPhase.DISCOVERY ||
    attempt.phase === WorkflowPhase.PLAN ||
    attempt.phase === WorkflowPhase.IMPLEMENT;
  const hasCandidateBinding =
    manifest.candidateGenerationId !== undefined && manifest.candidateDigest !== undefined;
  if (
    !isWorkerPhase ||
    attempt.contextManifestId === undefined ||
    attempt.workerSessionRef === undefined ||
    manifest.id !== attempt.contextManifestId ||
    manifest.attemptId !== attempt.id ||
    manifest.workflowId !== attempt.workflowId ||
    manifest.phase !== attempt.phase ||
    manifest.createdAt !== attempt.startedAt ||
    manifest.capabilityGrantDigest !== expectedCapabilityGrantDigest ||
    manifest.responseContractDigest !== expectedResponseContractDigest ||
    (manifest.phase === WorkflowPhase.IMPLEMENT) !== hasCandidateBinding
  ) {
    throw new TypeError('M1 Worker-phase Attempt authority is incomplete or inconsistent');
  }

  if (attempt.status === AttemptStatus.RESULT_RECORDED) {
    const resultKind = Object.values(WorkerResultKind).find(
      (kind) => attempt.terminationReason === `WORKER_RESULT:${kind}`,
    );
    if (
      resultKind === undefined ||
      !m1WorkerResponseContract(attempt.phase).allowedResultKinds.includes(resultKind)
    ) {
      throw new TypeError('M1 Worker result is not authorized by its phase response contract');
    }
  }

  if (attempt.status === AttemptStatus.FAILED) {
    const expectedFailureClass = attemptFailureClassForKnownWorkerReasonCode(
      attempt.terminationReason,
    );
    if (expectedFailureClass === undefined || expectedFailureClass !== attempt.failureClass) {
      throw new TypeError('M1 Worker failure has no exact closed failure classification');
    }
  }
}
