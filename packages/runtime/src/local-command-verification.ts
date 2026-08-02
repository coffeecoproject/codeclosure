import { createHash } from 'node:crypto';

import {
  EvidencePayloadStream,
  LocalCommandDiagnosticCode,
  decodeEvidenceObservation,
  evidenceId,
  sha256Digest,
  type EvidenceId,
  type Sha256Digest,
} from '@codeclosure/domain';

import {
  decodeFrozenCandidateIntegrityObservation,
  type CandidateSourcePort,
} from './candidate-evidence-contracts.js';
import { createLocalCommandTestResultEvidenceRecord } from './evidence-factory.js';
import {
  decodeLocalCommandVerificationRequest,
  decodeLocalCommandVerificationResult,
  type LocalCommandVerificationPort,
  type LocalCommandVerificationRequest,
} from './local-command-verification-contracts.js';
import type { Clock, DigestProvider, EvidencePayload } from './ports.js';
import type { ProtectedAssetReadLeaseAuthorityPort } from './protected-verification.js';

export const LocalCommandVerificationFailureCode = {
  PRE_RUN_SOURCE_OBSERVATION_FAILED: 'PRE_RUN_SOURCE_OBSERVATION_FAILED',
  POST_RUN_SOURCE_OBSERVATION_FAILED: 'POST_RUN_SOURCE_OBSERVATION_FAILED',
  CANDIDATE_SOURCE_DRIFT: 'CANDIDATE_SOURCE_DRIFT',
  RUNNER_INVOCATION_FAILED: 'RUNNER_INVOCATION_FAILED',
  RUNNER_OUTPUT_MALFORMED: 'RUNNER_OUTPUT_MALFORMED',
  PROTECTED_ASSET_AUTHORITY_UNAVAILABLE: 'PROTECTED_ASSET_AUTHORITY_UNAVAILABLE',
  PROTECTED_ASSET_DRIFT: 'PROTECTED_ASSET_DRIFT',
} as const;
export type LocalCommandVerificationFailureCode =
  (typeof LocalCommandVerificationFailureCode)[keyof typeof LocalCommandVerificationFailureCode];

export interface LocalCommandVerificationRuntimeDependencies {
  readonly candidateSource: Pick<CandidateSourcePort, 'observeFrozen'>;
  readonly runner: LocalCommandVerificationPort;
  readonly clock: Clock;
  readonly digests: DigestProvider;
  readonly protectedAssets?: ProtectedAssetReadLeaseAuthorityPort;
}

export type LocalCommandVerificationExecution =
  | {
      readonly status: 'EVIDENCE_READY';
      readonly evidence: ReturnType<typeof createLocalCommandTestResultEvidenceRecord>;
      readonly payloads: readonly [EvidencePayload, EvidencePayload];
    }
  | {
      readonly status: 'FAILED';
      readonly failureCode: LocalCommandVerificationFailureCode;
      readonly expectedCandidateDigest: Sha256Digest;
      readonly observedCandidateDigest?: Sha256Digest;
    };

function payload(bytes: Uint8Array): EvidencePayload {
  const copy = new Uint8Array(bytes);
  return Object.freeze({
    digest: sha256Digest(`sha256:${createHash('sha256').update(copy).digest('hex')}`),
    byteLength: copy.byteLength,
    bytes: copy,
  });
}

function failure(
  failureCode: LocalCommandVerificationFailureCode,
  expectedCandidateDigest: Sha256Digest,
  observedCandidateDigest?: Sha256Digest,
): LocalCommandVerificationExecution {
  return Object.freeze({
    status: 'FAILED',
    failureCode,
    expectedCandidateDigest,
    ...(observedCandidateDigest === undefined ? {} : { observedCandidateDigest }),
  });
}

function observeCandidate(
  request: LocalCommandVerificationRequest,
  candidateSource: Pick<CandidateSourcePort, 'observeFrozen'>,
): Sha256Digest {
  const observation = decodeFrozenCandidateIntegrityObservation(
    candidateSource.observeFrozen({
      schemaVersion: 1,
      goalId: request.goalId,
      workflowId: request.workflowId,
      generation: request.generation,
    }),
  );
  if (observation.generationId !== request.generation.id) {
    throw new TypeError('Candidate integrity observation belongs to another generation');
  }
  return observation.observedDigest;
}

export async function executeLocalCommandVerification(
  rawRequest: LocalCommandVerificationRequest,
  rawEvidenceId: EvidenceId,
  dependencies: LocalCommandVerificationRuntimeDependencies,
): Promise<LocalCommandVerificationExecution> {
  const request = decodeLocalCommandVerificationRequest(rawRequest, dependencies.digests);
  const expectedCandidateDigest = request.checkSpec.candidateDigest;
  let beforeDigest: Sha256Digest;
  try {
    beforeDigest = observeCandidate(request, dependencies.candidateSource);
  } catch {
    return failure(
      LocalCommandVerificationFailureCode.PRE_RUN_SOURCE_OBSERVATION_FAILED,
      expectedCandidateDigest,
    );
  }
  if (beforeDigest !== expectedCandidateDigest) {
    return failure(
      LocalCommandVerificationFailureCode.CANDIDATE_SOURCE_DRIFT,
      expectedCandidateDigest,
      beforeDigest,
    );
  }
  if (request.schemaVersion === 3) {
    if (dependencies.protectedAssets === undefined) {
      return failure(
        LocalCommandVerificationFailureCode.PROTECTED_ASSET_AUTHORITY_UNAVAILABLE,
        expectedCandidateDigest,
      );
    }
    try {
      dependencies.protectedAssets.assertLeaseCurrent(request.protectedAssetReadLease);
    } catch {
      return failure(
        LocalCommandVerificationFailureCode.PROTECTED_ASSET_DRIFT,
        expectedCandidateDigest,
      );
    }
  }

  const startedAt = dependencies.clock.now();
  let rawResult: unknown;
  let invocationFailed = false;
  try {
    rawResult = await dependencies.runner.run(request);
  } catch {
    invocationFailed = true;
  }
  const endedAt = dependencies.clock.now();

  if (request.schemaVersion === 3) {
    try {
      dependencies.protectedAssets?.assertLeaseCurrent(request.protectedAssetReadLease);
    } catch {
      return failure(
        LocalCommandVerificationFailureCode.PROTECTED_ASSET_DRIFT,
        expectedCandidateDigest,
      );
    }
  }

  let afterDigest: Sha256Digest;
  try {
    afterDigest = observeCandidate(request, dependencies.candidateSource);
  } catch {
    return failure(
      LocalCommandVerificationFailureCode.POST_RUN_SOURCE_OBSERVATION_FAILED,
      expectedCandidateDigest,
    );
  }
  if (afterDigest !== expectedCandidateDigest || afterDigest !== beforeDigest) {
    return failure(
      LocalCommandVerificationFailureCode.CANDIDATE_SOURCE_DRIFT,
      expectedCandidateDigest,
      afterDigest,
    );
  }
  if (invocationFailed) {
    return failure(
      LocalCommandVerificationFailureCode.RUNNER_INVOCATION_FAILED,
      expectedCandidateDigest,
    );
  }

  let result: ReturnType<typeof decodeLocalCommandVerificationResult>;
  try {
    result = decodeLocalCommandVerificationResult(request, rawResult, dependencies.digests);
  } catch {
    return failure(
      LocalCommandVerificationFailureCode.RUNNER_OUTPUT_MALFORMED,
      expectedCandidateDigest,
    );
  }
  const stdoutPayload = payload(result.stdoutBytes);
  const stderrPayload = payload(result.stderrBytes);
  const observation = decodeEvidenceObservation({
    schemaVersion: 1,
    kind: 'LOCAL_COMMAND_OBSERVATION_V1',
    terminationKind: result.terminationKind,
    ...(result.exitCode === undefined ? {} : { exitCode: result.exitCode }),
    ...(result.signal === undefined ? {} : { signal: result.signal }),
    stdoutObservedByteCount: result.stdoutObservedByteCount,
    stdoutRetainedByteCount: stdoutPayload.byteLength,
    stdoutTruncated: result.stdoutTruncated,
    stderrObservedByteCount: result.stderrObservedByteCount,
    stderrRetainedByteCount: stderrPayload.byteLength,
    stderrTruncated: result.stderrTruncated,
    diagnosticCode:
      result.stdoutTruncated || result.stderrTruncated
        ? LocalCommandDiagnosticCode.OUTPUT_LIMIT_EXCEEDED
        : result.diagnosticCode,
  });
  if (observation.kind !== 'LOCAL_COMMAND_OBSERVATION_V1') {
    throw new TypeError('Runtime constructed the wrong local-command observation');
  }
  const recordedAt = dependencies.clock.now();
  const evidence = createLocalCommandTestResultEvidenceRecord(
    {
      id: evidenceId(rawEvidenceId),
      goalId: request.goalId,
      goalRevision: request.goalRevision,
      workflowId: request.workflowId,
      attemptId: request.attemptId,
      verificationObligationId: request.obligation.id,
      candidateGenerationId: request.generation.id,
      candidateDigest: expectedCandidateDigest,
      policyBundleId: request.policyBundleId,
      policyBundleDigest: request.policyBundleDigest,
      checkSpec: request.checkSpec,
      workspaceLeaseId: request.workspaceLease.id,
      workspaceLeaseDigest: request.workspaceLease.leaseDigest,
      startedAt,
      endedAt,
      observation,
      stdoutPayload: Object.freeze({
        stream: EvidencePayloadStream.STDOUT,
        digest: stdoutPayload.digest,
        byteLength: stdoutPayload.byteLength,
      }),
      stderrPayload: Object.freeze({
        stream: EvidencePayloadStream.STDERR,
        digest: stderrPayload.digest,
        byteLength: stderrPayload.byteLength,
      }),
      recordedAt,
    },
    dependencies.digests,
  );
  return Object.freeze({
    status: 'EVIDENCE_READY',
    evidence,
    payloads: Object.freeze([stdoutPayload, stderrPayload] as const),
  });
}
