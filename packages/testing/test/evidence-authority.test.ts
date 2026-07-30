import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CheckSpecificationKind,
  EvidenceEligibilityState,
  EvidenceKind,
  EvidenceProducerType,
  EvidenceResultStatus,
  applyEvidenceEligibilityEvent,
  attemptId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  checkSpecificationRef,
  commandId,
  createCandidateGeneration,
  createGoal,
  createInitialEvidenceEligibility,
  decodeCheckSpecification,
  decodeEvidenceEligibility,
  decodeEvidenceRecord,
  decodeEvidenceSet,
  decodeVerificationObligation,
  decideEvidenceInvalidation,
  evidenceId,
  evidenceSetDigestProjection,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  successCriterionId,
  verificationObligationId,
  workflowId,
  workflowVersion,
  type TestResultEvidenceRecord,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  admitVerificationResult,
  buildEvidenceSet,
  createTestResultEvidenceRecord,
  createM1CandidateEvidencePolicy,
  decodeCandidatePreparation,
  decodeVerificationRequest,
  deriveM1EvidenceEnvironmentIdentity,
  verifyEvidenceSetAuthority,
  validateM1CandidateEvidencePolicy,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const generationId = candidateGenerationId('generation_evidence-authority');
const candidateDigest = sha256Digest(`sha256:${'a'.repeat(64)}`);
const policyDigest = sha256Digest(`sha256:${'b'.repeat(64)}`);
const payloadDigest = sha256Digest(`sha256:${'c'.repeat(64)}`);
const goalIdentifier = goalId('goal_evidence-authority');
const revision = goalRevision(1);
const workflowIdentifier = workflowId('workflow_evidence-authority');
const policyIdentifier = policyBundleId('policy_evidence-authority');
const startedAt = isoTimestamp('2026-07-27T00:00:00.001Z');
const endedAt = isoTimestamp('2026-07-27T00:00:00.002Z');
const recordedAt = isoTimestamp('2026-07-27T00:00:00.003Z');

void test('[I-005][I-018] Candidate Source output cannot supply authoritative identities', () => {
  const preparation = {
    schemaVersion: 1 as const,
    goalId: goalIdentifier,
    workflowId: workflowIdentifier,
    candidateId: candidateId('candidate_source-boundary'),
    generationId: candidateGenerationId('generation_source-boundary'),
    baseDigest: candidateDigest,
  };
  assert.deepEqual(decodeCandidatePreparation(preparation), preparation);
  assert.throws(() =>
    decodeCandidatePreparation({
      ...preparation,
      baseProjectIdentity: 'untrusted-project-identity',
    }),
  );
  assert.throws(() =>
    decodeCandidatePreparation({
      ...preparation,
      workspaceIdentity: 'untrusted-workspace-identity',
    }),
  );
});

void test('[I-005][I-009][I-022] M1 scenario obligations are criterion-derived and order-independent', () => {
  const goal = createGoal({
    id: goalId('goal_obligation-order'),
    revision: goalRevision(1),
    objective: 'Keep Verification Obligation authority independent of storage order',
    successCriteria: [
      {
        id: successCriterionId('criterion_obligation-order-first'),
        description: 'First required criterion remains bound',
        required: true,
      },
      {
        id: successCriterionId('criterion_obligation-order-second'),
        description: 'Second required criterion remains bound',
        required: true,
      },
    ],
    scope: { projectPath: '/fixture/obligation-order', allowedPaths: ['src/**'] },
    createdAt: startedAt,
  });
  const generation = createCandidateGeneration({
    id: candidateGenerationId('generation_obligation-order'),
    candidateId: candidateId('candidate_obligation-order'),
    sequence: 1,
    workspaceIdentity: 'm1-workspace:obligation-order',
    baseDigest: candidateDigest,
    createdAt: startedAt,
  });
  const obligationIds = [
    verificationObligationId('obligation_z-storage-order'),
    verificationObligationId('obligation_a-storage-order'),
  ];
  let obligationIndex = 0;
  const policy = createM1CandidateEvidencePolicy(
    goal,
    generation,
    {
      freeze: checkSpecificationId('check_obligation-order-freeze'),
      verification: checkSpecificationId('check_obligation-order-verification'),
    },
    {
      nextVerificationObligationId: () => {
        const identifier = obligationIds[obligationIndex];
        obligationIndex += 1;
        if (identifier === undefined) {
          throw new Error('Obligation identity fixture was exhausted');
        }
        return identifier;
      },
    },
    startedAt,
  );
  const validated = validateM1CandidateEvidencePolicy(
    goal,
    generation,
    {
      freeze: policy.freeze,
      verification: policy.verification,
      obligations: [...policy.obligations].reverse(),
    },
    startedAt,
  );

  assert.deepEqual(
    validated.obligations.map((candidate) => candidate.sourceCriterionRefs[0]),
    goal.successCriteria.map((criterion) => criterion.id),
  );
  assert.deepEqual(
    validated.obligations.map((candidate) => candidate.scenarioRefs),
    goal.successCriteria.map((criterion) => [`criterion:${criterion.id}`]),
  );
  assert.throws(
    () =>
      validateM1CandidateEvidencePolicy(
        goal,
        generation,
        {
          freeze: policy.freeze,
          verification: { ...policy.verification, producerIdentity: 'untrusted-runner:m1' },
          obligations: policy.obligations,
        },
        startedAt,
      ),
    /exact M1 policy/,
  );
  assert.throws(
    () =>
      validateM1CandidateEvidencePolicy(
        {
          ...goal,
          successCriteria: goal.successCriteria.map((criterion) => ({
            ...criterion,
            required: false,
          })),
        },
        generation,
        { freeze: policy.freeze, verification: policy.verification, obligations: [] },
        startedAt,
      ),
    /at least one required success criterion/,
  );
});

void test('[I-005][I-009][I-027] Evidence Set construction rejects an empty obligation authority', () => {
  assert.throws(
    () =>
      buildEvidenceSet(
        {
          goalId: goalIdentifier,
          goalRevision: revision,
          candidateGenerationId: generationId,
          candidateDigest,
          obligations: [],
          evidence: [],
        },
        digests,
      ),
    /at least one Verification Obligation/,
  );
  assert.throws(
    () =>
      decodeEvidenceSet({
        schemaVersion: 1,
        goalId: goalIdentifier,
        goalRevision: revision,
        candidateGenerationId: generationId,
        candidateDigest,
        obligationMappings: [],
        evidenceRefs: [],
        unresolvedEvidenceRequirements: [],
        digest: sha256Digest(`sha256:${'e'.repeat(64)}`),
      }),
    /at least one required obligation/,
  );
});

const checkSpec = decodeCheckSpecification({
  schemaVersion: 1,
  id: 'check_evidence-authority',
  version: 'm1.2',
  kind: CheckSpecificationKind.FAKE_VERIFICATION,
  producerType: EvidenceProducerType.VERIFICATION_RUNNER,
  producerIdentity: 'fake-verification-runner:m1',
  operation: 'm1.logical.fake-verification',
  cwdIdentity: 'm1-workspace:evidence-authority',
  inputRefs: [generationId],
  environmentPolicy: 'M1_LOGICAL_DETERMINISTIC',
  timeoutMilliseconds: 1_000,
  outputLimitBytes: 65_536,
  expectedObservationSchema: 'codeclosure.fake-verification-observation.v1',
  cleanupPolicy: 'M1_LOGICAL_NO_EXTERNAL_RESOURCES',
});

const obligation = decodeVerificationObligation({
  id: verificationObligationId('obligation_evidence-authority'),
  goalId: goalIdentifier,
  goalRevision: revision,
  candidateGenerationId: generationId,
  sourceCriterionRefs: ['criterion_evidence-authority'],
  scenarioRefs: ['criterion:criterion_evidence-authority'],
  checkSpecRef: checkSpecificationRef(checkSpec),
  requiredEvidenceKind: EvidenceKind.TEST_RESULT,
  strength: 'M1_DETERMINISTIC',
  createdAt: startedAt,
});

const verificationRequest = Object.freeze({
  schemaVersion: 1 as const,
  goalId: goalIdentifier,
  goalRevision: revision,
  workflowId: workflowIdentifier,
  workflowVersion: workflowVersion(1),
  attemptId: attemptId('attempt_verification-contract'),
  candidateGenerationId: generationId,
  candidateDigest,
  policyBundleId: policyIdentifier,
  policyBundleDigest: policyDigest,
  obligation,
  checkSpec,
  environmentIdentity: deriveM1EvidenceEnvironmentIdentity(checkSpec, digests),
});

function evidence(
  identifier: string,
  attemptIdentifier: string,
  recorded = recordedAt,
): TestResultEvidenceRecord {
  return createTestResultEvidenceRecord(
    {
      id: evidenceId(identifier),
      goalId: goalIdentifier,
      goalRevision: revision,
      workflowId: workflowIdentifier,
      attemptId: attemptId(attemptIdentifier),
      verificationObligationId: obligation.id,
      candidateGenerationId: generationId,
      candidateDigest,
      policyBundleId: policyIdentifier,
      policyBundleDigest: policyDigest,
      checkSpec,
      startedAt,
      endedAt,
      observation: {
        schemaVersion: 1,
        kind: 'FAKE_VERIFICATION',
        checkSpecRef: checkSpecificationRef(checkSpec),
        observedResult: EvidenceResultStatus.PASS,
        detailCode: 'M1_FAKE_PASS',
      },
      recordedAt: recorded,
    },
    digests,
  );
}

void test('[I-006][I-018] Evidence digest projections exclude envelope identity and bind authority content', () => {
  const first = evidence('evidence_projection-first', 'attempt_projection-shared');
  const second = evidence(
    'evidence_projection-second',
    'attempt_projection-shared',
    isoTimestamp('2026-07-27T00:00:00.004Z'),
  );
  assert.equal(first.observationDigest, second.observationDigest);
  assert.equal(first.recordDigest, second.recordDigest);

  const changedCandidate = createTestResultEvidenceRecord(
    {
      ...first,
      id: evidenceId('evidence_projection-changed-candidate'),
      candidateDigest: sha256Digest(`sha256:${'e'.repeat(64)}`),
      recordedAt,
    },
    digests,
  );
  assert.notEqual(changedCandidate.recordDigest, first.recordDigest);

  const changedObligation = createTestResultEvidenceRecord(
    {
      ...first,
      id: evidenceId('evidence_projection-changed-obligation'),
      verificationObligationId: verificationObligationId('obligation_evidence-authority-other'),
      recordedAt,
    },
    digests,
  );
  assert.notEqual(changedObligation.recordDigest, first.recordDigest);
});

void test('[I-006][I-009] Evidence Set ordering is canonical and prior currency fails after invalidation', () => {
  const laterId = evidence('evidence_set-z', 'attempt_evidence-set-z');
  const earlierId = evidence('evidence_set-a', 'attempt_evidence-set-a');
  const laterEligibility = createInitialEvidenceEligibility(laterId.id, laterId.recordedAt);
  const earlierEligibility = createInitialEvidenceEligibility(earlierId.id, earlierId.recordedAt);
  const set = buildEvidenceSet(
    {
      goalId: goalIdentifier,
      goalRevision: revision,
      candidateGenerationId: generationId,
      candidateDigest,
      obligations: [obligation],
      evidence: [
        { record: laterId, eligibility: laterEligibility },
        { record: earlierId, eligibility: earlierEligibility },
      ],
    },
    digests,
  );
  assert.deepEqual(
    set.evidenceRefs.map((reference) => reference.evidenceId),
    [earlierId.id, laterId.id],
  );
  verifyEvidenceSetAuthority(
    set,
    [obligation],
    [
      { record: earlierId, eligibility: earlierEligibility },
      { record: laterId, eligibility: laterEligibility },
    ],
    digests,
  );
  assert.throws(() =>
    verifyEvidenceSetAuthority(
      set,
      [obligation],
      [
        {
          record: {
            ...earlierId,
            candidateDigest: sha256Digest(`sha256:${'e'.repeat(64)}`),
          },
          eligibility: earlierEligibility,
        },
        { record: laterId, eligibility: laterEligibility },
      ],
      digests,
    ),
  );

  const invalidation = decideEvidenceInvalidation(earlierEligibility, {
    commandId: commandId('command_evidence-set-invalidate'),
    expectedVersion: earlierEligibility.version,
    reasonCode: 'CANDIDATE_INVALIDATED',
    sourceRef: generationId,
    occurredAt: isoTimestamp('2026-07-27T00:00:00.005Z'),
  });
  const ineligible = applyEvidenceEligibilityEvent(earlierEligibility, invalidation);
  assert.throws(() =>
    verifyEvidenceSetAuthority(
      set,
      [obligation],
      [
        { record: earlierId, eligibility: ineligible },
        { record: laterId, eligibility: laterEligibility },
      ],
      digests,
    ),
  );
  const rebuilt = buildEvidenceSet(
    {
      goalId: goalIdentifier,
      goalRevision: revision,
      candidateGenerationId: generationId,
      candidateDigest,
      obligations: [obligation],
      evidence: [
        { record: earlierId, eligibility: ineligible },
        { record: laterId, eligibility: laterEligibility },
      ],
    },
    digests,
  );
  assert.notEqual(rebuilt.digest, set.digest);
  assert.deepEqual(
    rebuilt.evidenceRefs.map((reference) => reference.evidenceId),
    [laterId.id],
  );
});

void test('[I-006][I-009] Evidence satisfies only the exact Verification Obligation it records', () => {
  const otherObligation = decodeVerificationObligation({
    ...obligation,
    id: verificationObligationId('obligation_evidence-authority-other'),
    sourceCriterionRefs: ['criterion_evidence-authority-other'],
    scenarioRefs: ['criterion:criterion_evidence-authority-other'],
  });
  const record = evidence('evidence_exact-obligation', 'attempt_exact-obligation');
  const set = buildEvidenceSet(
    {
      goalId: goalIdentifier,
      goalRevision: revision,
      candidateGenerationId: generationId,
      candidateDigest,
      obligations: [obligation, otherObligation],
      evidence: [
        {
          record,
          eligibility: createInitialEvidenceEligibility(record.id, record.recordedAt),
        },
      ],
    },
    digests,
  );

  assert.deepEqual(set.obligationMappings, [
    { obligationId: obligation.id, evidenceIds: [record.id] },
    { obligationId: otherObligation.id, evidenceIds: [] },
  ]);
  assert.deepEqual(set.unresolvedEvidenceRequirements, [otherObligation.id]);

  assert.throws(
    () =>
      decodeEvidenceSet({
        ...set,
        obligationMappings: [
          { obligationId: obligation.id, evidenceIds: [record.id] },
          { obligationId: otherObligation.id, evidenceIds: [record.id] },
        ],
        unresolvedEvidenceRequirements: [],
      }),
    /multiple obligations/,
  );

  const swappedWithoutDigest = {
    schemaVersion: 1 as const,
    goalId: goalIdentifier,
    goalRevision: revision,
    candidateGenerationId: generationId,
    candidateDigest,
    obligationMappings: [{ obligationId: otherObligation.id, evidenceIds: [record.id] }],
    evidenceRefs: set.evidenceRefs,
    unresolvedEvidenceRequirements: [],
  };
  const swapped = decodeEvidenceSet({
    ...swappedWithoutDigest,
    digest: digests.digest(evidenceSetDigestProjection(swappedWithoutDigest)),
  });
  assert.throws(
    () =>
      verifyEvidenceSetAuthority(
        swapped,
        [otherObligation],
        [
          {
            record,
            eligibility: createInitialEvidenceEligibility(record.id, record.recordedAt),
          },
        ],
        digests,
      ),
    /canonical current authority/,
  );
});

void test('[I-006][I-009] Evidence codecs reject skipped eligibility versions and incoherent set structure', () => {
  assert.throws(() =>
    decodeEvidenceEligibility({
      evidenceId: 'evidence_invalid-version',
      version: 3,
      state: EvidenceEligibilityState.INELIGIBLE,
      reasonCode: 'INVALID',
      sourceRef: generationId,
      changedAt: recordedAt,
    }),
  );

  const record = evidence('evidence_incoherent-set', 'attempt_incoherent-set');
  const eligibility = createInitialEvidenceEligibility(record.id, record.recordedAt);
  const set = buildEvidenceSet(
    {
      goalId: goalIdentifier,
      goalRevision: revision,
      candidateGenerationId: generationId,
      candidateDigest,
      obligations: [obligation],
      evidence: [{ record, eligibility }],
    },
    digests,
  );
  assert.throws(() =>
    decodeEvidenceSet({
      ...set,
      obligationMappings: [{ obligationId: obligation.id, evidenceIds: [] }],
      unresolvedEvidenceRequirements: [],
    }),
  );
  assert.throws(() =>
    decodeEvidenceSet({
      ...set,
      obligationMappings: [{ obligationId: obligation.id, evidenceIds: [record.id] }],
      evidenceRefs: [],
    }),
  );
});

void test('[I-006][I-018] Verification Request decoding is strict and enforces cross-authority bindings', () => {
  const decoded = decodeVerificationRequest(verificationRequest);
  assert.equal(decoded.obligation.id, obligation.id);
  assert.equal(decoded.checkSpec.id, checkSpec.id);

  assert.throws(() =>
    decodeVerificationRequest({
      ...verificationRequest,
      unexpectedAuthorityField: true,
    }),
  );
  assert.throws(() =>
    decodeVerificationRequest({
      ...verificationRequest,
      obligation: { ...obligation, goalId: 'goal_cross-authority' },
    }),
  );
  assert.throws(() =>
    decodeVerificationRequest({
      ...verificationRequest,
      environmentIdentity: {
        ...verificationRequest.environmentIdentity,
        untrustedExtraField: true,
      },
    }),
  );
});

void test('[I-006][I-018] Verification Result admission owns authority bindings and rejects prose', () => {
  const admitted = admitVerificationResult(
    verificationRequest,
    { schemaVersion: 1, resultStatus: EvidenceResultStatus.PASS },
    1,
  );
  assert.equal(admitted.status, 'ADMITTED');
  assert.deepEqual(admitted.result.observation, {
    schemaVersion: 1,
    kind: 'FAKE_VERIFICATION',
    checkSpecRef: checkSpecificationRef(checkSpec),
    observedResult: EvidenceResultStatus.PASS,
    detailCode: 'M1_FAKE_PASS',
  });

  for (const value of [
    { schemaVersion: 1, resultStatus: EvidenceResultStatus.PASS, payloadRefs: [payloadDigest] },
    {
      schemaVersion: 1,
      resultStatus: EvidenceResultStatus.PASS,
      checkSpecRef: 'check_forged@v1',
    },
    {
      schemaVersion: 1,
      resultStatus: EvidenceResultStatus.PASS,
      detailCode: 'token=demo-sensitive-value',
    },
  ]) {
    assert.deepEqual(admitVerificationResult(verificationRequest, value, 1), {
      status: 'REJECTED',
      failureCode: 'VERIFICATION_OUTPUT_MALFORMED',
    });
  }

  const tinyOutputCheck = decodeCheckSpecification({
    ...checkSpec,
    outputLimitBytes: 1,
  });
  assert.deepEqual(
    admitVerificationResult(
      { ...verificationRequest, checkSpec: tinyOutputCheck },
      { schemaVersion: 1, resultStatus: EvidenceResultStatus.PASS },
      1,
    ),
    {
      status: 'REJECTED',
      failureCode: 'VERIFICATION_OUTPUT_TOO_LARGE',
    },
  );
});

void test('[I-006][I-009][I-018] M1 Evidence cannot override Check-owned producer or payload authority', () => {
  const record = evidence('evidence_strict-authority', 'attempt_strict-authority');
  assert.throws(() =>
    decodeEvidenceRecord({
      ...record,
      producerIdentity: 'untrusted-runner:m1',
    }),
  );
  assert.throws(() =>
    decodeEvidenceRecord({
      ...record,
      factSnapshotDigest: payloadDigest,
    }),
  );
  assert.throws(() =>
    decodeEvidenceRecord({
      ...record,
      payloadRefs: [payloadDigest],
    }),
  );
  assert.throws(() =>
    decodeEvidenceRecord({
      ...record,
      environmentIdentity: {
        ...record.environmentIdentity,
        identity: 'm1-logical:another-workspace',
      },
    }),
  );
});
