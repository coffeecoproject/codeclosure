import assert from 'node:assert/strict';
import test from 'node:test';

import { registerM251PhaseDispatchV3Proof } from './m2.5.1-phase-dispatch-v3.proof.ts';

registerM251PhaseDispatchV3Proof('phase-dispatch-v3');

import {
  intakeManifestId,
  intakeRunId,
  intakeRunVersion,
  intentAdmissionDecisionId,
  intentAdmissionDecisionProjection,
  isoTimestamp,
  principalId,
  rawRequestId,
  rawRequestRevision,
  rawRequestRevisionProjection,
  sha256Digest,
  type IntentAdmissionDecisionProjectionInput,
  type RawRequestRevisionProjectionInput,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakePackageCompiler,
  M251IntakePackageCompiler,
  Rfc8785Canonicalizer,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  m25IntakeAssistantProfile,
  m251IntakeAssistantProfile,
  m251LiveIntakeAssistantProfile,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const canonicalizer = new Rfc8785Canonicalizer();
const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
const now = isoTimestamp('2026-08-07T08:00:00.000Z');

function compilerInput() {
  const runId = intakeRunId('intake_m251-contract');
  const rawBase = {
    schemaVersion: 1 as const,
    rawRequestId: rawRequestId('raw-request_m251-contract'),
    intakeRunId: runId,
    revision: rawRequestRevision(1),
    principalRef: principalId('principal_local-user'),
    interactionAction: 'ANSWER_ONLY' as const,
    admittedUserContent: 'Explain the bounded topic.',
    admittedContentDigest: digests.digestUtf8('Explain the bounded topic.'),
    declaredConstraints: [],
    retentionProfile: {
      id: 'retention_local',
      version: 'v1',
      digest: sha256Digest(`sha256:${'7'.repeat(64)}`),
    },
    submittedAt: now,
  } satisfies RawRequestRevisionProjectionInput;
  const raw = {
    ...rawBase,
    rawRequestDigest: digests.digest(rawRequestRevisionProjection(rawBase)),
  };
  const decisionBase = {
    id: intentAdmissionDecisionId('intent-admission_m251-contract'),
    schemaVersion: 1 as const,
    intakeRunId: runId,
    intakeRunVersion: intakeRunVersion(1),
    principalRef: raw.principalRef,
    interactionAction: 'ANSWER_ONLY' as const,
    rawRequestRevision: raw.revision,
    rawRequestDigest: raw.rawRequestDigest,
    admissionPolicyId: policy.id,
    admissionPolicyVersion: policy.version,
    admissionPolicyDigest: policy.digest,
    orderedReasonTrace: [
      {
        ruleId: 'answer-only_action_codeclosure-m2-5-v1',
        outcome: 'MATCHED' as const,
        reasonCode: 'ANSWER_ONLY' as const,
        inputRefs: [raw.rawRequestDigest],
      },
    ],
    decidedAt: now,
    kind: 'PRE_ANALYSIS_NO_EXECUTION' as const,
    outcome: 'NO_EXECUTION' as const,
    reasonCode: 'ANSWER_ONLY' as const,
    executionDisposition: 'NONE' as const,
  } satisfies IntentAdmissionDecisionProjectionInput;
  return {
    manifestId: intakeManifestId('intake-manifest_m251-contract'),
    createdAt: now,
    intakeRunId: runId,
    rawRequestRevision: raw,
    preparedDecision: {
      ...decisionBase,
      decisionDigest: digests.digest(intentAdmissionDecisionProjection(decisionBase)),
    },
    admissionPolicy: policy,
  };
}

void test('new M2.5.1 packages use only the additive v3 Intake identity set', () => {
  const compilation = new M251IntakePackageCompiler({ canonicalizer, digests }).compileAnswerOnly(
    compilerInput(),
  );
  assert.deepEqual(compilation.package.assistantProfile, m251LiveIntakeAssistantProfile);
  assert.equal(compilation.package.assistantProfile.schemaVersion, 3);
  assert.equal(
    compilation.package.assistantAdapter.version,
    'codeclosure-m2-5-1-intake-adapter-v3',
  );
  assert.deepEqual(compilation.manifest.assistantAdapter, compilation.package.assistantAdapter);
  assert.equal(
    compilation.package.assistantProfile.closedConfiguration.version,
    'codeclosure-m2-5-1-local-config-v2',
  );
  assert.equal(
    compilation.package.assistantProfile.protocolProjectionPolicy.version,
    'codeclosure-m2-5-1-projection-v2',
  );
  assert.equal(
    compilation.package.assistantProfile.instructionPolicy.version,
    'codeclosure-m2-5-1-exact-source-instructions-v1',
  );
  assert.equal(m251IntakeAssistantProfile.schemaVersion, 2);
  assert.equal('instructionPolicy' in m251IntakeAssistantProfile, false);
});

void test('historical v1 package compilation retains its exact original identity', () => {
  const compilation = new M25IntakePackageCompiler({ canonicalizer, digests }).compileAnswerOnly(
    compilerInput(),
  );
  assert.deepEqual(compilation.package.assistantProfile, m25IntakeAssistantProfile);
  assert.equal(compilation.package.assistantProfile.schemaVersion, 1);
  assert.equal(compilation.package.assistantAdapter.version, 'codeclosure-m2-5-intake-adapter-v1');
  assert.equal('closedConfiguration' in compilation.package.assistantProfile, false);
});
