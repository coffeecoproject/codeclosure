import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CandidateFreezeChangeKind,
  CandidateFreezeFileMode,
  EvidenceKind,
  attemptId,
  candidateGenerationId,
  candidateId,
  checkSpecificationId,
  decodeExecutionProfile,
  decodeEvidenceRecord,
  evidenceId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  sha256Digest,
  workflowId,
  createCandidateGeneration,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  candidateWorkspaceAllowedPathProjection,
  createCandidateChangeSetV2,
  createCandidateFreezeEvidenceRecord,
  createM251CandidateFreezeEvidencePolicy,
  digestCandidateWorkspaceValue,
  M251CandidateFreezeProfileClassification,
  classifyM251CandidateFreezeProfile,
  validateM251CandidateFreezeEvidencePolicy,
} from '@codeclosure/runtime';
import { m251CandidateFreezeV2ProfileFixture } from '@codeclosure/testing';

const digest = (character: string) => sha256Digest(`sha256:${character.repeat(64)}`);
const occurredAt = isoTimestamp('2026-08-10T00:00:00.000Z');
const generation = createCandidateGeneration({
  id: candidateGenerationId('generation_m251-freeze-v2'),
  candidateId: candidateId('candidate_m251-freeze-v2'),
  sequence: 1,
  workspaceIdentity: 'm1-workspace:generation_m251-freeze-v2',
  baseDigest: digest('a'),
  createdAt: occurredAt,
});
const policy = createM251CandidateFreezeEvidencePolicy(
  generation,
  checkSpecificationId('check_m251-freeze-v2'),
);
const changes = Object.freeze([
  Object.freeze({
    after: Object.freeze({
      byteLength: 11,
      contentDigest: digest('b'),
      mode: CandidateFreezeFileMode.REGULAR,
    }),
    before: Object.freeze({
      byteLength: 7,
      contentDigest: digest('c'),
      mode: CandidateFreezeFileMode.REGULAR,
    }),
    kind: CandidateFreezeChangeKind.MODIFIED,
    path: 'src/payment.ts',
  }),
]);
const changeSet = createCandidateChangeSetV2({
  baseSourceDigest: generation.baseDigest,
  changes,
  frozenSourceDigest: digest('d'),
});
const allowedPathPolicyDigest = digestCandidateWorkspaceValue(
  candidateWorkspaceAllowedPathProjection(['src']),
);

void test('[I-006][I-023][M251-C11] freeze-v2 Check and Evidence round-trip without Fake authority', () => {
  assert.deepEqual(validateM251CandidateFreezeEvidencePolicy(generation, policy), policy);
  const record = createCandidateFreezeEvidenceRecord(
    {
      id: evidenceId('evidence_m251-freeze-v2'),
      goalId: goalId('goal_m251-freeze-v2'),
      goalRevision: goalRevision(1),
      workflowId: workflowId('workflow_m251-freeze-v2'),
      attemptId: attemptId('attempt_m251-freeze-v2'),
      candidateGenerationId: generation.id,
      candidateDigest: changeSet.frozenSourceDigest,
      policyBundleId: policyBundleId('policy_m251-freeze-v2'),
      policyBundleDigest: digest('e'),
      checkSpec: policy.freeze,
      startedAt: occurredAt,
      endedAt: occurredAt,
      observation: {
        schemaVersion: 2,
        kind: EvidenceKind.CANDIDATE_FREEZE,
        allowedPathPolicyDigest,
        baseSourceDigest: changeSet.baseSourceDigest,
        changeSetDigest: changeSet.changeSetDigest,
        changeSetProfile: changeSet.profile,
        changes: changeSet.changes,
        firstSourceDigest: changeSet.frozenSourceDigest,
        secondSourceDigest: changeSet.frozenSourceDigest,
      },
      recordedAt: occurredAt,
    },
    new CanonicalJsonSha256DigestProvider(),
  );
  assert.equal(record.schemaVersion, 2);
  assert.equal(record.checkSpec.kind, EvidenceKind.CANDIDATE_FREEZE);
  assert.equal(record.payloadRefs[0], changeSet.changeSetDigest);
  assert.deepEqual(decodeEvidenceRecord(record), record);
  assert.equal(JSON.stringify(record).includes('FAKE_VERIFICATION'), false);
});

void test('[I-006][I-023][M251-C11] C11 Profile fixture selects the exact freeze-v2 contract', () => {
  const authority = m251CandidateFreezeV2ProfileFixture(
    'freeze-v2',
    new CanonicalJsonSha256DigestProvider(),
    occurredAt,
  );
  const profile = decodeExecutionProfile({ ...authority.profile, digest: digest('7') });
  assert.equal(profile.id, 'profile_m2-5-1-real-codex');
  assert.equal(profile.version, 'codeclosure-m2-5-1-real-codex-profile-v1');
  assert.equal(profile.schemaVersion, 2);
  assert.equal(profile.externalExecution.schemaVersion, 3);
  assert.equal(
    classifyM251CandidateFreezeProfile(profile),
    M251CandidateFreezeProfileClassification.M251_FREEZE_V2,
  );

  assert.equal(
    classifyM251CandidateFreezeProfile(
      decodeExecutionProfile({ ...profile, id: 'profile_historical-codex' }),
    ),
    M251CandidateFreezeProfileClassification.HISTORICAL,
  );

  for (const incompatible of [
    { ...profile, version: 'codeclosure-m2-5-1-real-codex-profile-v2' },
    { ...profile, candidateSource: 'fake-candidate-source' },
    { ...profile, candidateSourceVersion: 'v1' },
    { ...profile, verificationRunner: 'fake-verification-runner' },
    { ...profile, verificationRunnerVersion: 'fixture-v1' },
  ]) {
    assert.equal(
      classifyM251CandidateFreezeProfile(decodeExecutionProfile(incompatible)),
      M251CandidateFreezeProfileClassification.INCOMPATIBLE_M251,
    );
  }
});

void test('[I-006][I-023][M251-C11] freeze-v2 Evidence rejects empty, reordered, and digest-substituted authority', () => {
  const base = {
    schemaVersion: 2,
    kind: EvidenceKind.CANDIDATE_FREEZE,
    allowedPathPolicyDigest,
    baseSourceDigest: changeSet.baseSourceDigest,
    changeSetDigest: changeSet.changeSetDigest,
    changeSetProfile: changeSet.profile,
    changes: changeSet.changes,
    firstSourceDigest: changeSet.frozenSourceDigest,
    secondSourceDigest: changeSet.frozenSourceDigest,
  } as const;
  assert.throws(() =>
    decodeEvidenceRecord({
      id: 'evidence_empty',
      schemaVersion: 2,
      kind: EvidenceKind.CANDIDATE_FREEZE,
      producerType: 'CANDIDATE_MANAGER',
      producerIdentity: policy.freeze.producerIdentity,
      goalId: 'goal_empty',
      goalRevision: 1,
      workflowId: 'workflow_empty',
      attemptId: 'attempt_empty',
      candidateGenerationId: generation.id,
      candidateDigest: changeSet.frozenSourceDigest,
      policyBundleId: 'policy_empty',
      policyBundleDigest: digest('e'),
      checkSpec: policy.freeze,
      startedAt: occurredAt,
      endedAt: occurredAt,
      observation: { ...base, changes: [] },
      payloadRefs: [changeSet.changeSetDigest],
      observationDigest: digest('f'),
      resultStatus: 'OBSERVED',
      recordedAt: occurredAt,
      recordDigest: digest('1'),
    }),
  );
  const firstChange = changes[0];
  assert.ok(firstChange);
  assert.throws(() =>
    createCandidateChangeSetV2({
      baseSourceDigest: changeSet.baseSourceDigest,
      changes: [
        { ...firstChange, path: 'src/z.ts' },
        { ...firstChange, path: 'src/a.ts' },
      ],
      frozenSourceDigest: changeSet.frozenSourceDigest,
    }),
  );
  assert.throws(() =>
    decodeEvidenceRecord({
      ...createCandidateFreezeEvidenceRecord(
        {
          id: evidenceId('evidence_m251-freeze-v2-substitution'),
          goalId: goalId('goal_m251-freeze-v2-substitution'),
          goalRevision: goalRevision(1),
          workflowId: workflowId('workflow_m251-freeze-v2-substitution'),
          attemptId: attemptId('attempt_m251-freeze-v2-substitution'),
          candidateGenerationId: generation.id,
          candidateDigest: changeSet.frozenSourceDigest,
          policyBundleId: policyBundleId('policy_m251-freeze-v2-substitution'),
          policyBundleDigest: digest('e'),
          checkSpec: policy.freeze,
          startedAt: occurredAt,
          endedAt: occurredAt,
          observation: base,
          recordedAt: occurredAt,
        },
        new CanonicalJsonSha256DigestProvider(),
      ),
      candidateDigest: digest('9'),
    }),
  );
});
