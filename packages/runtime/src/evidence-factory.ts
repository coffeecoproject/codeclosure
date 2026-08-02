import {
  EvidenceEligibilityState,
  EvidenceKind,
  EvidencePayloadStream,
  EvidenceProducerType,
  EvidenceResultStatus,
  assertEvidenceRecordInvariant,
  assertEvidenceSetInvariant,
  checkSpecificationRef,
  decodeCheckSpecification,
  decodeEvidenceEligibility,
  decodeEvidenceObservation,
  decodeEvidenceRecord,
  decodeEvidenceSet,
  decodeVerificationObligation,
  evidenceObservationDigestProjection,
  evidenceRecordDigestProjection,
  evidenceSetDigestProjection,
  localCommandEvidenceStatusForObservation,
  sha256Digest,
  type AttemptId,
  type CandidateGenerationId,
  type CandidateFreezeObservation,
  type CheckSpecification,
  type EvidenceEligibility,
  type EvidenceId,
  type EvidenceRecord,
  type EvidenceSet,
  type FakeVerificationObservation,
  type GoalId,
  type GoalRevision,
  type IsoTimestamp,
  type LocalCommandCheckSpecification,
  type LocalCommandEnvironmentIdentity,
  type LocalCommandObservation,
  type EvidencePayloadReference,
  type PolicyBundleId,
  type Sha256Digest,
  type VerificationObligation,
  type VerificationObligationId,
  type WorkflowId,
} from '@codeclosure/domain';

import type { DigestProvider } from './ports.js';

interface CreateEvidenceRecordBaseInput {
  readonly id: EvidenceId;
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly workflowId: WorkflowId;
  readonly attemptId: AttemptId;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly candidateDigest: Sha256Digest;
  readonly policyBundleId: PolicyBundleId;
  readonly policyBundleDigest: Sha256Digest;
  readonly checkSpec: CheckSpecification;
  readonly startedAt: IsoTimestamp;
  readonly endedAt: IsoTimestamp;
  readonly recordedAt: IsoTimestamp;
}

export interface CreateCandidateFreezeEvidenceRecordInput extends CreateEvidenceRecordBaseInput {
  readonly observation: CandidateFreezeObservation;
}

export interface CreateTestResultEvidenceRecordInput extends CreateEvidenceRecordBaseInput {
  readonly verificationObligationId: VerificationObligationId;
  readonly observation: FakeVerificationObservation;
}

export interface CreateLocalCommandTestResultEvidenceRecordInput extends CreateEvidenceRecordBaseInput {
  readonly verificationObligationId: VerificationObligationId;
  readonly checkSpec: LocalCommandCheckSpecification;
  readonly workspaceLeaseId: string;
  readonly workspaceLeaseDigest: Sha256Digest;
  readonly observation: LocalCommandObservation;
  readonly stdoutPayload: EvidencePayloadReference;
  readonly stderrPayload: EvidencePayloadReference;
}

export interface BuildEvidenceSetInput {
  readonly goalId: GoalId;
  readonly goalRevision: GoalRevision;
  readonly candidateGenerationId: CandidateGenerationId;
  readonly candidateDigest: Sha256Digest;
  readonly obligations: readonly VerificationObligation[];
  readonly evidence: readonly {
    readonly record: EvidenceRecord;
    readonly eligibility: EvidenceEligibility;
  }[];
}

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function deriveM1EvidenceEnvironmentIdentity(
  rawCheckSpec: CheckSpecification,
  digests: DigestProvider,
): Extract<
  EvidenceRecord,
  { readonly kind: typeof EvidenceKind.TEST_RESULT }
>['environmentIdentity'] {
  const checkSpec = decodeCheckSpecification(rawCheckSpec);
  return Object.freeze({
    schemaVersion: 1 as const,
    kind: 'M1_LOGICAL' as const,
    identity: `m1-logical:${checkSpec.cwdIdentity}`,
    digest: sha256Digest(
      digests.digest({
        schemaVersion: 1,
        kind: 'M1_LOGICAL',
        cwdIdentity: checkSpec.cwdIdentity,
        environmentPolicy: checkSpec.environmentPolicy,
      }),
    ),
  });
}

export function deriveLocalCommandEnvironmentIdentity(
  rawCheckSpec: LocalCommandCheckSpecification,
  digests: DigestProvider,
): LocalCommandEnvironmentIdentity {
  const decoded = decodeCheckSpecification(rawCheckSpec);
  if (decoded.kind !== 'LOCAL_COMMAND') {
    throw new TypeError('Local command environment requires a LOCAL_COMMAND Check');
  }
  const projection = {
    schemaVersion: 1,
    kind: 'LOCAL_COMMAND_ENVIRONMENT_V1',
    runnerIdentity: decoded.runnerIdentity,
    runnerVersion: decoded.runnerVersion,
    executableDigest: decoded.executableDigest,
    environmentDigest: decoded.environmentDigest,
    isolationProfileId: decoded.isolationProfileId,
    isolationProfileDigest: decoded.isolationProfileDigest,
  } as const;
  const digest = sha256Digest(digests.digest(projection));
  return Object.freeze({
    ...projection,
    identity: `local-command:${digest}`,
    digest,
  });
}

function finalizeEvidenceRecord(
  id: EvidenceId,
  recordedAt: IsoTimestamp,
  withoutEnvelope: Omit<EvidenceRecord, 'id' | 'recordedAt' | 'recordDigest'>,
  digests: DigestProvider,
): EvidenceRecord {
  const record = decodeEvidenceRecord({
    id,
    ...withoutEnvelope,
    recordedAt,
    recordDigest: sha256Digest(digests.digest(evidenceRecordDigestProjection(withoutEnvelope))),
  });
  assertEvidenceRecordInvariant(record);
  return record;
}

export function createCandidateFreezeEvidenceRecord(
  rawInput: CreateCandidateFreezeEvidenceRecordInput,
  digests: DigestProvider,
): Extract<EvidenceRecord, { readonly kind: typeof EvidenceKind.CANDIDATE_FREEZE }> {
  const observation = decodeEvidenceObservation(rawInput.observation);
  if (observation.kind !== EvidenceKind.CANDIDATE_FREEZE) {
    throw new TypeError('Candidate freeze Evidence requires a freeze observation');
  }
  const checkSpec = decodeCheckSpecification(rawInput.checkSpec);
  const observationDigest = sha256Digest(
    digests.digest(evidenceObservationDigestProjection(observation)),
  );
  const withoutEnvelope = {
    schemaVersion: 1 as const,
    kind: EvidenceKind.CANDIDATE_FREEZE,
    producerType: EvidenceProducerType.CANDIDATE_MANAGER,
    producerIdentity: checkSpec.producerIdentity,
    goalId: rawInput.goalId,
    goalRevision: rawInput.goalRevision,
    workflowId: rawInput.workflowId,
    attemptId: rawInput.attemptId,
    candidateGenerationId: rawInput.candidateGenerationId,
    candidateDigest: rawInput.candidateDigest,
    policyBundleId: rawInput.policyBundleId,
    policyBundleDigest: rawInput.policyBundleDigest,
    checkSpec,
    startedAt: rawInput.startedAt,
    endedAt: rawInput.endedAt,
    observation,
    payloadRefs: Object.freeze([observation.changeSetDigest] as const),
    observationDigest,
    resultStatus: EvidenceResultStatus.OBSERVED,
  };
  const record = finalizeEvidenceRecord(rawInput.id, rawInput.recordedAt, withoutEnvelope, digests);
  if (record.kind !== EvidenceKind.CANDIDATE_FREEZE) {
    throw new TypeError('Candidate freeze Evidence changed kind during construction');
  }
  return record;
}

export function createTestResultEvidenceRecord(
  rawInput: CreateTestResultEvidenceRecordInput,
  digests: DigestProvider,
): Extract<EvidenceRecord, { readonly kind: typeof EvidenceKind.TEST_RESULT }> {
  const observation = decodeEvidenceObservation(rawInput.observation);
  if (observation.kind !== 'FAKE_VERIFICATION') {
    throw new TypeError('Test Evidence requires a verification observation');
  }
  const checkSpec = decodeCheckSpecification(rawInput.checkSpec);
  const observationDigest = sha256Digest(
    digests.digest(evidenceObservationDigestProjection(observation)),
  );
  const withoutEnvelope = {
    schemaVersion: 1 as const,
    kind: EvidenceKind.TEST_RESULT,
    producerType: EvidenceProducerType.VERIFICATION_RUNNER,
    producerIdentity: checkSpec.producerIdentity,
    goalId: rawInput.goalId,
    goalRevision: rawInput.goalRevision,
    workflowId: rawInput.workflowId,
    attemptId: rawInput.attemptId,
    verificationObligationId: rawInput.verificationObligationId,
    candidateGenerationId: rawInput.candidateGenerationId,
    candidateDigest: rawInput.candidateDigest,
    policyBundleId: rawInput.policyBundleId,
    policyBundleDigest: rawInput.policyBundleDigest,
    checkSpec,
    environmentIdentity: deriveM1EvidenceEnvironmentIdentity(checkSpec, digests),
    startedAt: rawInput.startedAt,
    endedAt: rawInput.endedAt,
    observation,
    payloadRefs: Object.freeze([observationDigest] as const),
    observationDigest,
    resultStatus: observation.observedResult,
  };
  const record = finalizeEvidenceRecord(rawInput.id, rawInput.recordedAt, withoutEnvelope, digests);
  if (record.kind !== EvidenceKind.TEST_RESULT) {
    throw new TypeError('Test Evidence changed kind during construction');
  }
  return record;
}

export function createLocalCommandTestResultEvidenceRecord(
  rawInput: CreateLocalCommandTestResultEvidenceRecordInput,
  digests: DigestProvider,
): Extract<EvidenceRecord, { readonly kind: typeof EvidenceKind.LOCAL_COMMAND_TEST_RESULT }> {
  const observation = decodeEvidenceObservation(rawInput.observation);
  if (observation.kind !== 'LOCAL_COMMAND_OBSERVATION_V1') {
    throw new TypeError('Local command Evidence requires a local-command observation');
  }
  const checkSpec = decodeCheckSpecification(rawInput.checkSpec);
  if (checkSpec.kind !== 'LOCAL_COMMAND') {
    throw new TypeError('Local command Evidence requires a LOCAL_COMMAND Check');
  }
  if (
    rawInput.stdoutPayload.stream !== EvidencePayloadStream.STDOUT ||
    rawInput.stderrPayload.stream !== EvidencePayloadStream.STDERR
  ) {
    throw new TypeError('Local command Evidence payloads are not stream ordered');
  }
  const observationDigest = sha256Digest(
    digests.digest(evidenceObservationDigestProjection(observation)),
  );
  const commonEnvelope = {
    kind: EvidenceKind.LOCAL_COMMAND_TEST_RESULT,
    producerType: EvidenceProducerType.VERIFICATION_RUNNER,
    producerIdentity: checkSpec.producerIdentity,
    goalId: rawInput.goalId,
    goalRevision: rawInput.goalRevision,
    workflowId: rawInput.workflowId,
    attemptId: rawInput.attemptId,
    verificationObligationId: rawInput.verificationObligationId,
    candidateGenerationId: rawInput.candidateGenerationId,
    candidateDigest: rawInput.candidateDigest,
    policyBundleId: rawInput.policyBundleId,
    policyBundleDigest: rawInput.policyBundleDigest,
    checkSpec,
    environmentIdentity: deriveLocalCommandEnvironmentIdentity(checkSpec, digests),
    workspaceLeaseId: rawInput.workspaceLeaseId,
    workspaceLeaseDigest: rawInput.workspaceLeaseDigest,
    startedAt: rawInput.startedAt,
    endedAt: rawInput.endedAt,
    observation,
    payloadRefs: Object.freeze([
      Object.freeze({ ...rawInput.stdoutPayload }),
      Object.freeze({ ...rawInput.stderrPayload }),
    ] as const),
    observationDigest,
    resultStatus: localCommandEvidenceStatusForObservation(checkSpec, observation),
  };
  const withoutEnvelope =
    checkSpec.schemaVersion === 3
      ? {
          ...commonEnvelope,
          schemaVersion: 3 as const,
          checkSpec,
          acceptanceCriticalVerificationPlanId: checkSpec.acceptanceCriticalVerificationPlanId,
          acceptanceCriticalVerificationPlanDigest:
            checkSpec.acceptanceCriticalVerificationPlanDigest,
          protectedAssetManifestDigest: checkSpec.protectedAssetManifestDigest,
          protectedAssetReadLeaseDigest: checkSpec.protectedAssetReadLeaseDigest,
        }
      : { ...commonEnvelope, schemaVersion: 2 as const, checkSpec };
  const record = finalizeEvidenceRecord(rawInput.id, rawInput.recordedAt, withoutEnvelope, digests);
  if (record.kind !== EvidenceKind.LOCAL_COMMAND_TEST_RESULT) {
    throw new TypeError('Local command Evidence changed kind during construction');
  }
  return record;
}

export function verifyEvidenceRecordDigests(
  rawRecord: unknown,
  digests: DigestProvider,
): EvidenceRecord {
  const record = decodeEvidenceRecord(rawRecord);
  const expectedObservation = sha256Digest(
    digests.digest(evidenceObservationDigestProjection(record.observation)),
  );
  const expectedRecord = sha256Digest(digests.digest(evidenceRecordDigestProjection(record)));
  if (record.observationDigest !== expectedObservation || record.recordDigest !== expectedRecord) {
    throw new TypeError(`Evidence ${record.id} digest does not match its canonical projection`);
  }
  if (record.kind === EvidenceKind.TEST_RESULT) {
    const expectedEnvironment = deriveM1EvidenceEnvironmentIdentity(record.checkSpec, digests);
    if (
      record.environmentIdentity.identity !== expectedEnvironment.identity ||
      record.environmentIdentity.digest !== expectedEnvironment.digest
    ) {
      throw new TypeError(
        `Evidence ${record.id} environment does not match its Check Specification`,
      );
    }
  } else if (record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT) {
    const expectedEnvironment = deriveLocalCommandEnvironmentIdentity(record.checkSpec, digests);
    if (
      record.environmentIdentity.identity !== expectedEnvironment.identity ||
      record.environmentIdentity.digest !== expectedEnvironment.digest
    ) {
      throw new TypeError(
        `Evidence ${record.id} environment does not match its Check Specification`,
      );
    }
  }
  return record;
}

export function buildEvidenceSet(
  rawInput: BuildEvidenceSetInput,
  digests: DigestProvider,
): EvidenceSet {
  const obligations = rawInput.obligations
    .map((obligation) => decodeVerificationObligation(obligation))
    .sort((left, right) => compare(left.id, right.id));
  if (obligations.length === 0) {
    throw new TypeError('Evidence Set requires at least one Verification Obligation');
  }
  const seenObligations = new Set<string>();
  for (const obligation of obligations) {
    if (seenObligations.has(obligation.id)) {
      throw new TypeError('Evidence Set obligations must be unique');
    }
    seenObligations.add(obligation.id);
    if (
      obligation.goalId !== rawInput.goalId ||
      obligation.goalRevision !== rawInput.goalRevision ||
      obligation.candidateGenerationId !== rawInput.candidateGenerationId
    ) {
      throw new TypeError('Evidence Set obligation belongs to another Goal revision');
    }
  }

  const evidence = rawInput.evidence
    .map(({ record, eligibility }) => ({
      record: verifyEvidenceRecordDigests(record, digests),
      eligibility: decodeEvidenceEligibility(eligibility),
    }))
    .sort((left, right) => compare(left.record.id, right.record.id));
  const byEvidenceId = new Map<EvidenceId, (typeof evidence)[number]>();
  for (const entry of evidence) {
    if (byEvidenceId.has(entry.record.id)) {
      throw new TypeError('Evidence Set input contains a duplicate Evidence ID');
    }
    byEvidenceId.set(entry.record.id, entry);
    if (
      entry.eligibility.evidenceId !== entry.record.id ||
      entry.record.goalId !== rawInput.goalId ||
      entry.record.goalRevision !== rawInput.goalRevision ||
      entry.record.candidateGenerationId !== rawInput.candidateGenerationId ||
      entry.record.candidateDigest !== rawInput.candidateDigest
    ) {
      throw new TypeError('Evidence Set input has mismatched authority bindings');
    }
  }

  const selected = new Set<EvidenceId>();
  const obligationMappings = obligations.map((obligation) => {
    const evidenceIds = evidence
      .filter(
        ({ record, eligibility }) =>
          eligibility.state === EvidenceEligibilityState.ELIGIBLE &&
          record.verificationObligationId === obligation.id &&
          record.kind === obligation.requiredEvidenceKind &&
          checkSpecificationRef(record.checkSpec) === obligation.checkSpecRef,
      )
      .map(({ record }) => record.id);
    for (const identifier of evidenceIds) {
      selected.add(identifier);
    }
    return Object.freeze({
      obligationId: obligation.id,
      evidenceIds: Object.freeze(evidenceIds),
    });
  });
  const unresolvedEvidenceRequirements = Object.freeze(
    obligationMappings
      .filter((mapping) => mapping.evidenceIds.length === 0)
      .map((mapping) => mapping.obligationId),
  );
  const evidenceRefs = Object.freeze(
    [...selected].sort(compare).map((identifier) => {
      const entry = byEvidenceId.get(identifier);
      if (entry === undefined) {
        throw new TypeError(`Evidence ${identifier} disappeared during set construction`);
      }
      return Object.freeze({
        evidenceId: entry.record.id,
        evidenceRecordDigest: entry.record.recordDigest,
        eligibilityVersion: entry.eligibility.version,
        eligibilityState: entry.eligibility.state,
      });
    }),
  );
  const withoutDigest = {
    schemaVersion: 1 as const,
    goalId: rawInput.goalId,
    goalRevision: rawInput.goalRevision,
    candidateGenerationId: rawInput.candidateGenerationId,
    candidateDigest: rawInput.candidateDigest,
    obligationMappings: Object.freeze(obligationMappings),
    evidenceRefs,
    unresolvedEvidenceRequirements,
  };
  const set = decodeEvidenceSet({
    ...withoutDigest,
    digest: sha256Digest(digests.digest(evidenceSetDigestProjection(withoutDigest))),
  });
  assertEvidenceSetInvariant(set);
  return set;
}

export function verifyEvidenceSetAuthority(
  rawSet: EvidenceSet,
  rawObligations: readonly VerificationObligation[],
  current: readonly {
    readonly record: EvidenceRecord;
    readonly eligibility: EvidenceEligibility;
  }[],
  digests: DigestProvider,
): EvidenceSet {
  const set = decodeEvidenceSet(rawSet);
  const expectedDigest = sha256Digest(digests.digest(evidenceSetDigestProjection(set)));
  if (set.digest !== expectedDigest) {
    throw new TypeError('Evidence Set digest does not match its canonical projection');
  }

  const expected = buildEvidenceSet(
    {
      goalId: set.goalId,
      goalRevision: set.goalRevision,
      candidateGenerationId: set.candidateGenerationId,
      candidateDigest: set.candidateDigest,
      obligations: rawObligations,
      evidence: current,
    },
    digests,
  );
  if (expected.digest !== set.digest) {
    throw new TypeError('Evidence Set does not equal canonical current authority');
  }
  return set;
}
