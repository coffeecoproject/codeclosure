import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IntakeInteractionAction,
  IntentAdmissionDecisionKind,
  IntentAdmissionOutcome,
  IntentAdmissionReasonCode,
  IntentAdmissionRuleTraceOutcome,
  IntentExecutionDisposition,
  decodeIntentAdmissionDecision,
  decodeRawRequestRevision,
  intakeManifestId,
  intakeRunId,
  intakeRunVersion,
  intentAdmissionDecisionId,
  intentAdmissionDecisionProjection,
  intakeManifestProjection,
  isoTimestamp,
  principalId,
  rawRequestId,
  rawRequestRevision,
  rawRequestRevisionProjection,
  sha256Digest,
  type IntentAdmissionDecision,
  type RawRequestRevisionRecord,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakePackageCompiler,
  M25_ANSWER_ONLY_RESPONSE_CONTRACT_ID,
  M25_INTAKE_ASSISTANT_ADAPTER_ID,
  M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_ID,
  Rfc8785Canonicalizer,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  m25IntakeBudgetDefinition,
} from '@codeclosure/runtime';

const digests = new CanonicalJsonSha256DigestProvider();
const compiler = new M25IntakePackageCompiler({
  canonicalizer: new Rfc8785Canonicalizer(),
  digests,
});
const NOW = isoTimestamp('2026-08-03T05:00:00.000Z');
const RETENTION_DIGEST = sha256Digest(`sha256:${'7'.repeat(64)}`);
const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);

function raw(
  action:
    typeof IntakeInteractionAction.ANSWER_ONLY | typeof IntakeInteractionAction.MATERIALIZE_ONLY,
  content = 'Explain the bounded result.',
): RawRequestRevisionRecord {
  const suffix = action === IntakeInteractionAction.ANSWER_ONLY ? 'answer' : 'materialize';
  const base: RawRequestRevisionRecord = {
    schemaVersion: 1,
    rawRequestId: rawRequestId(`raw-request_package-${suffix}`),
    intakeRunId: intakeRunId(`intake_package-${suffix}`),
    revision: rawRequestRevision(1),
    principalRef: principalId('principal_local-user'),
    interactionAction: action,
    admittedUserContent: content,
    admittedContentDigest: digests.digestUtf8(content),
    ...(action === IntakeInteractionAction.MATERIALIZE_ONLY
      ? {
          declaredProjectRef: {
            schemaVersion: 1 as const,
            normalizedPath: '/fixture/project',
            identityDigest: digests.digest({ path: '/fixture/project' }),
          },
        }
      : {}),
    declaredConstraints: ['Preserve the Intake authority boundary'],
    retentionProfile: {
      id: 'intake-retention_codeclosure-m2-5-local',
      version: 'codeclosure-m2-5-local-retention-v1',
      digest: RETENTION_DIGEST,
    },
    submittedAt: NOW,
    rawRequestDigest: RETENTION_DIGEST,
  };
  return decodeRawRequestRevision(
    { ...base, rawRequestDigest: digests.digest(rawRequestRevisionProjection(base)) },
    digests,
  );
}

function answerDecision(record: RawRequestRevisionRecord): IntentAdmissionDecision {
  const base: IntentAdmissionDecision = {
    id: intentAdmissionDecisionId('intent-admission_answer-package'),
    schemaVersion: 1,
    intakeRunId: record.intakeRunId,
    intakeRunVersion: intakeRunVersion(1),
    principalRef: record.principalRef,
    interactionAction: IntakeInteractionAction.ANSWER_ONLY,
    rawRequestRevision: record.revision,
    rawRequestDigest: record.rawRequestDigest,
    admissionPolicyId: policy.id,
    admissionPolicyVersion: policy.version,
    admissionPolicyDigest: policy.digest,
    orderedReasonTrace: [
      {
        ruleId: 'answer-only_action_codeclosure-m2-5-v1',
        outcome: IntentAdmissionRuleTraceOutcome.MATCHED,
        reasonCode: IntentAdmissionReasonCode.ANSWER_ONLY,
        inputRefs: [record.rawRequestDigest],
      },
    ],
    decidedAt: NOW,
    decisionDigest: RETENTION_DIGEST,
    kind: IntentAdmissionDecisionKind.PRE_ANALYSIS_NO_EXECUTION,
    outcome: IntentAdmissionOutcome.NO_EXECUTION,
    reasonCode: IntentAdmissionReasonCode.ANSWER_ONLY,
    executionDisposition: IntentExecutionDisposition.NONE,
  };
  return decodeIntentAdmissionDecision(
    { ...base, decisionDigest: digests.digest(intentAdmissionDecisionProjection(base)) },
    digests,
  );
}

void test('the Intent compiler emits one deterministic immutable package and durable Manifest', () => {
  const record = raw(IntakeInteractionAction.MATERIALIZE_ONLY);
  const input = {
    manifestId: intakeManifestId('intake-manifest_intent-package'),
    createdAt: NOW,
    intakeRunId: record.intakeRunId,
    rawRequestRevisions: [record],
    admissionPolicy: policy,
  };
  const first = compiler.compileIntentAnalysis(input);
  const second = compiler.compileIntentAnalysis(input);

  assert.deepEqual(first, second);
  assert.equal(first.package.kind, 'INTENT_ANALYSIS');
  assert.equal(first.package.responseContract.id, M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_ID);
  assert.equal(first.package.assistantAdapter.id, M25_INTAKE_ASSISTANT_ADAPTER_ID);
  assert.equal(first.manifest.packageDigest, digests.digest(first.package));
  assert.equal(first.manifest.entries.length, 3);
  assert.equal(first.manifest.rawRequestRevisions[0]?.digest, record.rawRequestDigest);
  assert.equal(Object.isFrozen(first.package), true);
  assert.equal(Object.isFrozen(first.manifest), true);
  for (const forbidden of [
    'goalId',
    'workflowId',
    'attemptId',
    'candidateId',
    'evidenceId',
    'acceptanceDecisionId',
  ]) {
    assert.equal(forbidden in first.package, false);
  }
});

void test('the Answer-only compiler binds exactly one Raw Request and prepared Decision', () => {
  const record = raw(IntakeInteractionAction.ANSWER_ONLY);
  const compiled = compiler.compileAnswerOnly({
    manifestId: intakeManifestId('intake-manifest_answer-package'),
    createdAt: NOW,
    intakeRunId: record.intakeRunId,
    rawRequestRevision: record,
    preparedDecision: answerDecision(record),
    admissionPolicy: policy,
  });

  assert.equal(compiled.package.kind, 'ANSWER_ONLY');
  assert.equal(compiled.package.responseContract.id, M25_ANSWER_ONLY_RESPONSE_CONTRACT_ID);
  assert.equal(compiled.package.rawRequestRevision.rawRequestDigest, record.rawRequestDigest);
  assert.equal(compiled.package.preparedDecisionBinding.rawRequestDigest, record.rawRequestDigest);
  assert.equal(compiled.manifest.packageDigest, digests.digest(compiled.package));
  assert.equal(compiled.manifest.entries.length, 2);
  assert.deepEqual(compiled.manifest.questionRefs, []);
});

void test('compiled packages and Manifests validate as one exact canonical closure', () => {
  const intentRecord = raw(IntakeInteractionAction.MATERIALIZE_ONLY);
  const intent = compiler.compileIntentAnalysis({
    manifestId: intakeManifestId('intake-manifest_validated-intent'),
    createdAt: NOW,
    intakeRunId: intentRecord.intakeRunId,
    rawRequestRevisions: [intentRecord],
    admissionPolicy: policy,
  });
  assert.doesNotThrow(() => compiler.validateIntentAnalysisCompilation(intent));

  const answerRecord = raw(IntakeInteractionAction.ANSWER_ONLY);
  const answer = compiler.compileAnswerOnly({
    manifestId: intakeManifestId('intake-manifest_validated-answer'),
    createdAt: NOW,
    intakeRunId: answerRecord.intakeRunId,
    rawRequestRevision: answerRecord,
    preparedDecision: answerDecision(answerRecord),
    admissionPolicy: policy,
  });
  assert.doesNotThrow(() => compiler.validateAnswerOnlyCompilation(answer));
});

void test('validation rejects recomputed outer digests over substituted nested authority', () => {
  const record = raw(IntakeInteractionAction.MATERIALIZE_ONLY);
  const compiled = compiler.compileIntentAnalysis({
    manifestId: intakeManifestId('intake-manifest_nested-substitution'),
    createdAt: NOW,
    intakeRunId: record.intakeRunId,
    rawRequestRevisions: [record],
    admissionPolicy: policy,
  });
  const packageValue = {
    ...compiled.package,
    rawRequestRevisions: [
      { ...record, admittedUserContent: 'Substituted after canonical compilation.' },
    ],
  };
  const manifestBase = {
    ...compiled.manifest,
    packageDigest: digests.digest(packageValue),
  };
  const manifest = {
    ...manifestBase,
    manifestDigest: digests.digest(intakeManifestProjection(manifestBase)),
  };
  assert.throws(
    () =>
      compiler.validateIntentAnalysisCompilation({
        package: packageValue,
        manifest,
      }),
    /content digest/u,
  );
});

void test('validation rejects a digest-valid Manifest entry substitution', () => {
  const record = raw(IntakeInteractionAction.MATERIALIZE_ONLY);
  const compiled = compiler.compileIntentAnalysis({
    manifestId: intakeManifestId('intake-manifest_entry-substitution'),
    createdAt: NOW,
    intakeRunId: record.intakeRunId,
    rawRequestRevisions: [record],
    admissionPolicy: policy,
  });
  const firstEntry = compiled.manifest.entries[0];
  if (firstEntry === undefined) {
    assert.fail('Expected the canonical Manifest to contain one entry');
  }
  const manifestBase = {
    ...compiled.manifest,
    entries: [
      { ...firstEntry, sourceDigest: RETENTION_DIGEST },
      ...compiled.manifest.entries.slice(1),
    ],
  };
  const manifest = {
    ...manifestBase,
    manifestDigest: digests.digest(intakeManifestProjection(manifestBase)),
  };
  assert.throws(
    () => compiler.validateIntentAnalysisCompilation({ ...compiled, manifest }),
    /canonical compilation/u,
  );
});

void test('package compilation fails closed on digest substitution and hard-budget overflow', () => {
  const record = raw(IntakeInteractionAction.MATERIALIZE_ONLY);
  assert.throws(
    () =>
      compiler.compileIntentAnalysis({
        manifestId: intakeManifestId('intake-manifest_forged-package'),
        createdAt: NOW,
        intakeRunId: record.intakeRunId,
        rawRequestRevisions: [{ ...record, rawRequestDigest: RETENTION_DIGEST }],
        admissionPolicy: policy,
      }),
    /digest/u,
  );

  const oversized = raw(
    IntakeInteractionAction.MATERIALIZE_ONLY,
    'x'.repeat(m25IntakeBudgetDefinition.exactRawRequestContentBytesPerRevision + 1),
  );
  assert.throws(
    () =>
      compiler.compileIntentAnalysis({
        manifestId: intakeManifestId('intake-manifest_oversized-package'),
        createdAt: NOW,
        intakeRunId: oversized.intakeRunId,
        rawRequestRevisions: [oversized],
        admissionPolicy: policy,
      }),
    /budget/u,
  );
});

void test('Answer-only compilation rejects a Decision from another Raw Request', () => {
  const record = raw(IntakeInteractionAction.ANSWER_ONLY);
  const other = raw(IntakeInteractionAction.ANSWER_ONLY, 'A different answer request.');
  assert.throws(
    () =>
      compiler.compileAnswerOnly({
        manifestId: intakeManifestId('intake-manifest_substituted-answer'),
        createdAt: NOW,
        intakeRunId: record.intakeRunId,
        rawRequestRevision: record,
        preparedDecision: answerDecision(other),
        admissionPolicy: policy,
      }),
    /exact operation input/u,
  );
});
