import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IntakeInteractionAction,
  IntentProjectionCanonicalProfileVersion,
  IntentProjectionField,
  SourceAuthorityClass,
  intakeRunId,
  intentAnalysisProposalId,
  intentProjectionId,
  isoTimestamp,
  materialAmbiguityId,
  principalId,
  rawRequestId,
  rawRequestRevision,
  rawRequestRevisionProjection,
  sha256Digest,
  type RawRequestRevisionProjectionInput,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M251IntentProjectionCompiler,
  M251TrustedIntentProjectionCompiler,
  M25IntentProjectionCompiler,
  Rfc8785Canonicalizer,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  createM251ProductionAdmissionPolicyDefinition,
  type IntentAnalysisAssistantResponseV1,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const canonicalizer = new Rfc8785Canonicalizer();
const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
const runId = intakeRunId('intake_m251-exact-value-projection');
const content = ['Ship slice 2', 'Required criterion: exact result'].join('\n');
const rawBase = {
  schemaVersion: 1 as const,
  rawRequestId: rawRequestId('raw-request_m251-exact-value-projection'),
  intakeRunId: runId,
  revision: rawRequestRevision(1),
  principalRef: principalId('principal_local-user'),
  interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
  admittedUserContent: content,
  admittedContentDigest: digests.digestUtf8(content),
  declaredConstraints: [],
  retentionProfile: {
    id: 'retention_local',
    version: 'v1',
    digest: sha256Digest(`sha256:${'7'.repeat(64)}`),
  },
  submittedAt: isoTimestamp('2026-08-08T08:00:00.000Z'),
} satisfies RawRequestRevisionProjectionInput;
const raw = {
  ...rawBase,
  rawRequestDigest: digests.digest(rawRequestRevisionProjection(rawBase)),
};
const response: IntentAnalysisAssistantResponseV1 = Object.freeze({
  proposedObjective: 'Ship slice 2',
  proposedCriteria: Object.freeze(['exact result']),
  proposedNonGoals: Object.freeze([]),
  proposedAssumptions: Object.freeze([]),
  proposedQuestions: Object.freeze([]),
  candidateSourceSpanSuggestions: Object.freeze([]),
});

function input(adapterVersion: string) {
  let ambiguity = 0;
  const versionTag = adapterVersion.includes('m2-5-1') ? 'v2' : 'v1';
  return {
    intakeRunId: runId,
    rawRequestRevisions: [raw],
    admissionPolicy: policy,
    intentAnalysisIdentity: {
      assistantAdapterId: 'intake-assistant-adapter_codex-app-server',
      assistantAdapterVersion: adapterVersion,
      responseContractDigest: sha256Digest(`sha256:${'8'.repeat(64)}`),
    },
    response,
    observedAt: isoTimestamp('2026-08-08T08:00:01.000Z'),
    ids: {
      nextIntentAnalysisProposalId: () =>
        intentAnalysisProposalId(`intent-proposal_m251-${versionTag}`),
      nextIntentProjectionId: () => intentProjectionId(`intent-projection_m251-${versionTag}`),
      nextMaterialAmbiguityId: () => {
        ambiguity += 1;
        return materialAmbiguityId(`ambiguity_m251-${versionTag}-${String(ambiguity)}`);
      },
    },
  };
}

void test('M2.5.1 derives USER_STATED spans by exact retained-value matching only', () => {
  const projected = new M251IntentProjectionCompiler({ canonicalizer, digests }).project(
    input('codeclosure-m2-5-1-intake-adapter-v3'),
  );
  assert.equal(
    projected.projection.canonicalProfileVersion,
    IntentProjectionCanonicalProfileVersion.M251_EXACT_VALUE_MATCH_V3,
  );
  assert.deepEqual(
    projected.projection.sourceBindings.flatMap((binding) =>
      binding.authorityClass === SourceAuthorityClass.USER_STATED
        ? [{ projectionFieldRef: binding.projectionFieldRef, sourceSpan: binding.sourceSpan }]
        : [],
    ),
    [
      {
        projectionFieldRef: IntentProjectionField.OBJECTIVE,
        sourceSpan: { startByte: 0, endByte: 12 },
      },
      {
        projectionFieldRef: IntentProjectionField.REQUIRED_CRITERION,
        sourceSpan: { startByte: 33, endByte: 45 },
      },
    ],
  );
  assert.deepEqual(projected.proposal.candidateSourceSpanSuggestions, []);
});

void test('M2.5.1 keeps a model paraphrase MODEL_PROPOSED and materially ambiguous', () => {
  const base = input('codeclosure-m2-5-1-intake-adapter-v3');
  const projected = new M251IntentProjectionCompiler({ canonicalizer, digests }).project({
    ...base,
    response: {
      ...base.response,
      proposedObjective: 'Deliver the second milestone slice',
    },
  });
  const objectiveBindings = projected.projection.sourceBindings.filter(
    ({ projectionFieldRef }) => projectionFieldRef === IntentProjectionField.OBJECTIVE,
  );
  assert.equal(objectiveBindings.length, 1);
  const [objectiveBinding] = objectiveBindings;
  assert.ok(objectiveBinding);
  assert.equal(objectiveBinding.authorityClass, SourceAuthorityClass.MODEL_PROPOSED);
  assert.equal('sourceSpan' in objectiveBinding, false);
  assert.equal(
    projected.ambiguitySet.ambiguities.some(
      ({ affectedFields }) =>
        affectedFields.length === 1 && affectedFields[0] === IntentProjectionField.OBJECTIVE,
    ),
    true,
  );
});

void test('M2.5.1 exact-value matching fails closed at the fixed source-binding budget', () => {
  const repeatedContent = 'x'.repeat(65);
  const repeatedBase = {
    ...rawBase,
    rawRequestId: rawRequestId('raw-request_m251-exact-value-budget'),
    admittedUserContent: repeatedContent,
    admittedContentDigest: digests.digestUtf8(repeatedContent),
  } satisfies RawRequestRevisionProjectionInput;
  const repeatedRaw = {
    ...repeatedBase,
    rawRequestDigest: digests.digest(rawRequestRevisionProjection(repeatedBase)),
  };
  const projectedInput = input('codeclosure-m2-5-1-intake-adapter-v3');
  assert.throws(
    () =>
      new M251IntentProjectionCompiler({ canonicalizer, digests }).project({
        ...projectedInput,
        rawRequestRevisions: [repeatedRaw],
        response: {
          ...response,
          proposedObjective: 'x',
          proposedCriteria: [],
        },
      }),
    /fixed source-binding budget/u,
  );
});

void test('[M251-B4] trusted Projection derives exact allowed paths only from its bound Policy', () => {
  const projectPath = '/fixture/m251-b4-trusted-project';
  const allowedPaths = Object.freeze(['src/payment.js', 'test/payment.test.js']);
  const trustedPolicy = createM25AdmissionPolicy(
    createM251ProductionAdmissionPolicyDefinition({ projectPath, allowedPaths }),
    digests,
  );
  const trustedBase = {
    ...rawBase,
    declaredProjectRef: Object.freeze({
      schemaVersion: 1 as const,
      normalizedPath: projectPath,
      identityDigest: digests.digest({ normalizedPath: projectPath }),
    }),
  } satisfies RawRequestRevisionProjectionInput;
  const trustedRaw = Object.freeze({
    ...trustedBase,
    rawRequestDigest: digests.digest(rawRequestRevisionProjection(trustedBase)),
  });
  const projected = new M251TrustedIntentProjectionCompiler({ canonicalizer, digests }).project({
    ...input('codeclosure-m2-5-1-intake-adapter-v3'),
    admissionPolicy: trustedPolicy,
    rawRequestRevisions: [trustedRaw],
  });
  assert.equal(
    projected.projection.canonicalProfileVersion,
    IntentProjectionCanonicalProfileVersion.M251_TRUSTED_SCOPE_V4,
  );
  assert.deepEqual(projected.projection.scope, { projectPath, allowedPaths });
  assert.deepEqual(
    projected.projection.sourceBindings.flatMap((binding) =>
      binding.projectionFieldRef === IntentProjectionField.SCOPE &&
      binding.authorityClass === SourceAuthorityClass.POLICY_DERIVED
        ? [binding.sourceFieldPath]
        : [],
    ),
    ['/trustedProjectScope/allowedPaths/0', '/trustedProjectScope/allowedPaths/1'],
  );
});

void test('historical M2.5 projection does not reinterpret an empty span suggestion list', () => {
  const projected = new M25IntentProjectionCompiler({ canonicalizer, digests }).project(
    input('codeclosure-m2-5-intake-adapter-v1'),
  );
  assert.equal(
    projected.projection.canonicalProfileVersion,
    IntentProjectionCanonicalProfileVersion.M25_LOCAL_V2,
  );
  assert.equal(
    projected.projection.sourceBindings.filter(
      ({ authorityClass }) => authorityClass === SourceAuthorityClass.USER_STATED,
    ).length,
    0,
  );
});
