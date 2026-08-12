import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import test, { type TestContext } from 'node:test';

import { createFixtureAppServerLaunch } from '@codeclosure/codex-app-server-client/testing';
import type { AppServerNotification, JsonObject } from '@codeclosure/codex-app-server-client';
import {
  intakeManifestId,
  intakeManifestProjection,
  intakeRunId,
  intakeRunVersion,
  intentAdmissionDecisionId,
  intentAdmissionDecisionProjection,
  isoTimestamp,
  principalId,
  rawRequestId,
  rawRequestRevision as parseRawRequestRevision,
  rawRequestRevisionProjection,
  sha256Digest,
  type IntakeRunId,
  type IntentAdmissionDecision,
  type IntentAdmissionDecisionProjectionInput,
  type RawRequestRevisionProjectionInput,
  type RawRequestRevisionRecord,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
  M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_VERSION,
  M251_INTENT_ANALYSIS_RESPONSE_CONTRACT_VERSION,
  M251IntakePackageCompiler,
  M25IntakePackageCompiler,
  Rfc8785Canonicalizer,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  m25IntentAnalysisResponseSchema,
  m251LiveIntakeAssistantProfile,
  m251IntakeAssistantAdapter,
  m251IntakeAssistantProfile,
  m251IntentAnalysisResponseSchema,
  type AnswerOnlyAssistantInput,
  type IntentAnalysisAssistantInput,
} from '@codeclosure/runtime';
import {
  IntakeProtocolProjection,
  M251_LIVE_INTAKE_DISABLED_FEATURES,
  createCodexIntakeAssistantAdapter,
  decodeIntentAnalysisResponse,
  m251LiveIntakeClosedConfig,
  m251LiveIntakeEffectiveConfigProjection,
  type IntakeObservedEvent,
} from '@codeclosure/adapter-codex-intake';

const fixtureScript = resolve(import.meta.dirname, 'fixtures', 'fake-app-server.mjs');
const digests = new CanonicalJsonSha256DigestProvider();
const compiler = new M251IntakePackageCompiler({
  canonicalizer: new Rfc8785Canonicalizer(),
  digests,
});
const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
const fixedDigest = sha256Digest(`sha256:${'8'.repeat(64)}`);
const launchNonce = `sha256:${'9'.repeat(64)}`;
const now = isoTimestamp('2026-08-07T05:30:00.000Z');

function rawRequest(
  action: 'ANSWER_ONLY' | 'MATERIALIZE_ONLY',
  runId: IntakeRunId,
  content: string,
): RawRequestRevisionRecord {
  const base = {
    schemaVersion: 1 as const,
    rawRequestId: rawRequestId(
      `raw-request_adapter-v2-${action === 'ANSWER_ONLY' ? 'answer' : 'intent'}`,
    ),
    intakeRunId: runId,
    revision: parseRawRequestRevision(1),
    principalRef: principalId('principal_local-user'),
    interactionAction: action,
    admittedUserContent: content,
    admittedContentDigest: digests.digestUtf8(content),
    declaredConstraints: [],
    retentionProfile: { id: 'retention_local', version: 'v1', digest: fixedDigest },
    submittedAt: now,
  } satisfies RawRequestRevisionProjectionInput;
  return { ...base, rawRequestDigest: digests.digest(rawRequestRevisionProjection(base)) };
}

function answerDecision(raw: RawRequestRevisionRecord): IntentAdmissionDecision {
  const base = {
    id: intentAdmissionDecisionId('intent-admission_adapter-v2-answer'),
    schemaVersion: 1 as const,
    intakeRunId: raw.intakeRunId,
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
  return { ...base, decisionDigest: digests.digest(intentAdmissionDecisionProjection(base)) };
}

function answerInput(): AnswerOnlyAssistantInput {
  const runId = intakeRunId('intake_adapter-v2-answer');
  const raw = rawRequest('ANSWER_ONLY', runId, 'Explain this bounded topic.');
  return compiler.compileAnswerOnly({
    manifestId: intakeManifestId('intake-manifest_adapter-v2-answer'),
    createdAt: now,
    intakeRunId: runId,
    rawRequestRevision: raw,
    preparedDecision: answerDecision(raw),
    admissionPolicy: policy,
  });
}

function intentInput(): IntentAnalysisAssistantInput {
  const runId = intakeRunId('intake_adapter-v2-intent');
  const raw = rawRequest('MATERIALIZE_ONLY', runId, 'Ship slice 7');
  return compiler.compileIntentAnalysis({
    manifestId: intakeManifestId('intake-manifest_adapter-v2-intent'),
    createdAt: now,
    intakeRunId: runId,
    rawRequestRevisions: [raw],
    admissionPolicy: policy,
  });
}

function retainedV2AnswerInput(): AnswerOnlyAssistantInput {
  const current = answerInput();
  const packageValue = Object.freeze({
    ...current.package,
    assistantProfile: m251IntakeAssistantProfile,
    assistantAdapter: m251IntakeAssistantAdapter,
  });
  const { manifestDigest: currentDigest, ...currentManifest } = current.manifest;
  void currentDigest;
  const manifestBase = Object.freeze({
    ...currentManifest,
    assistantAdapter: m251IntakeAssistantAdapter,
    packageDigest: digests.digest(packageValue),
  });
  const manifest = Object.freeze({
    ...manifestBase,
    manifestDigest: digests.digest(
      intakeManifestProjection({
        ...manifestBase,
        manifestDigest: current.manifest.manifestDigest,
      }),
    ),
  });
  return Object.freeze({ package: packageValue, manifest });
}

function fixtureAdapter(t: TestContext, scenario: string) {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-intake-adapter-v2-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const codexHome = join(root, 'codex-home');
  const cwd = join(root, 'operation-cwd');
  const processHome = join(root, 'process-home');
  const temporaryDirectory = join(root, 'process-tmp');
  const authorityRoot = join(root, 'authority');
  for (const path of [codexHome, cwd, processHome, temporaryDirectory, authorityRoot]) {
    mkdirSync(path);
  }
  const launch = createFixtureAppServerLaunch({
    codexHome,
    cwd,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome,
    protocolIdentity: {
      version: `codex-cli ${m251LiveIntakeAssistantProfile.codexVersion}`,
      snapshotDigest: m251LiveIntakeAssistantProfile.protocolSnapshotDigest,
    },
    scenario,
    scriptPath: fixtureScript,
    temporaryDirectory,
  });
  assert.equal(
    launch.summary.codexVersion,
    `codex-cli ${m251LiveIntakeAssistantProfile.codexVersion}`,
  );
  assert.equal(
    launch.summary.protocolSnapshotDigest,
    m251LiveIntakeAssistantProfile.protocolSnapshotDigest,
  );
  const diagnostics: string[] = [];
  const assistant = createCodexIntakeAssistantAdapter({
    launch,
    launchNonce,
    forbiddenRoots: [authorityRoot],
    onSafeDiagnostic: (category, location, token) =>
      diagnostics.push(`${category}/${location}/${token}`),
    clientLimits: {
      initializationTimeoutMilliseconds: 5_000,
      requestTimeoutMilliseconds: scenario === 'v2-request-timeout' ? 100 : 5_000,
      shutdownGraceMilliseconds: 2_000,
      shutdownKillMilliseconds: 2_000,
    },
  });
  return {
    assistant,
    diagnostics,
    roots: { authorityRoot, codexHome, cwd, processHome, temporaryDirectory },
  };
}

function projectionHarness(): {
  readonly events: IntakeObservedEvent[];
  readonly projection: IntakeProtocolProjection;
} {
  const events: IntakeObservedEvent[] = [];
  return {
    events,
    projection: new IntakeProtocolProjection((event) => events.push(event)),
  };
}

const refs = Object.freeze({ threadId: 'thread-v2', turnId: 'turn-v2' });

function itemNotification(
  sequence: number,
  item: JsonObject,
  method: 'item/completed' | 'item/started' = 'item/completed',
): AppServerNotification {
  return {
    method,
    params: {
      item,
      ...refs,
      ...(method === 'item/started' ? { startedAtMs: 1 } : { completedAtMs: 1 }),
    },
    sequence,
  };
}

function rawResponseItemNotification(sequence: number, item: JsonObject): AppServerNotification {
  return {
    method: 'rawResponseItem/completed',
    params: { item, ...refs },
    sequence,
  };
}

void test('closed-configuration-v2 removes deprecated Web Search keys and disables 0.146.1 features', () => {
  assert.equal(m251LiveIntakeClosedConfig.web_search, 'disabled');
  assert.equal(M251_LIVE_INTAKE_DISABLED_FEATURES.includes('web_search_cached'), false);
  assert.equal(M251_LIVE_INTAKE_DISABLED_FEATURES.includes('web_search_request'), false);
  assert.equal('web_search_cached' in m251LiveIntakeClosedConfig.features, false);
  assert.equal('web_search_request' in m251LiveIntakeClosedConfig.features, false);
  assert.equal(m251LiveIntakeClosedConfig.features['shell_tool'], false);
  assert.equal(m251LiveIntakeClosedConfig.features['enable_request_compression'], false);
  assert.equal(m251LiveIntakeClosedConfig.features['fast_mode'], false);
  assert.equal(m251LiveIntakeClosedConfig.features['guardian_approval'], false);
  assert.equal(m251LiveIntakeClosedConfig.features['mentions_v2'], false);
  assert.equal('remote_control' in m251LiveIntakeClosedConfig.features, false);
  assert.equal(m251LiveIntakeEffectiveConfigProjection.features.remote_control, false);
  assert.equal('search_tool' in m251LiveIntakeClosedConfig.features, false);
  assert.equal('use_legacy_landlock' in m251LiveIntakeClosedConfig.features, false);
});

void test('M2.5.1 versions only the Intent response contract into the strict supported subset', () => {
  const input = intentInput();
  const schema = input.package.responseContract.schema;
  assert.equal(
    input.package.responseContract.version,
    M251_INTENT_ANALYSIS_RESPONSE_CONTRACT_VERSION,
  );
  assert.deepEqual(schema, m251IntentAnalysisResponseSchema);
  assert.equal(JSON.stringify(schema).includes('uniqueItems'), false);
  assert.equal(
    m251IntentAnalysisResponseSchema.properties.candidateSourceSpanSuggestions.maxItems,
    0,
  );
  assert.deepEqual(
    [...m251IntentAnalysisResponseSchema.required].sort(),
    Object.keys(m251IntentAnalysisResponseSchema.properties).sort(),
  );

  const v1Compiler = new M25IntakePackageCompiler({
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  });
  const v1 = v1Compiler.compileIntentAnalysis({
    manifestId: intakeManifestId('intake-manifest_adapter-v1-contract'),
    createdAt: now,
    intakeRunId: input.package.intakeRunId,
    rawRequestRevisions: input.package.rawRequestRevisions,
    admissionPolicy: policy,
  });
  assert.equal(v1.package.responseContract.version, M25_INTENT_ANALYSIS_RESPONSE_CONTRACT_VERSION);
  assert.deepEqual(v1.package.responseContract.schema, m25IntentAnalysisResponseSchema);
});

void test('the v2 decoder normalizes nullable wire fields and retains local uniqueness checks', () => {
  const input = intentInput();
  const validWireResponse = {
    proposedObjective: null,
    proposedCriteria: [],
    proposedScope: null,
    proposedNonGoals: [],
    proposedAssumptions: [],
    proposedQuestions: [],
    candidateSourceSpanSuggestions: [],
    proposedClassification: null,
  };
  assert.deepEqual(decodeIntentAnalysisResponse(JSON.stringify(validWireResponse), input.package), {
    proposedCriteria: [],
    proposedNonGoals: [],
    proposedAssumptions: [],
    proposedQuestions: [],
    candidateSourceSpanSuggestions: [],
  });
  const { proposedScope: omitted, ...missingNullableField } = validWireResponse;
  void omitted;
  assert.throws(
    () => decodeIntentAnalysisResponse(JSON.stringify(missingNullableField), input.package),
    /unknown or missing fields/,
  );
  assert.throws(
    () =>
      decodeIntentAnalysisResponse(
        JSON.stringify({
          ...validWireResponse,
          proposedCriteria: ['same', 'same'],
        }),
        input.package,
      ),
    /duplicate byte-identical items/,
  );
  assert.throws(
    () =>
      decodeIntentAnalysisResponse(
        JSON.stringify({
          ...validWireResponse,
          candidateSourceSpanSuggestions: [
            {
              projectionFieldRef: 'OBJECTIVE',
              itemIndex: null,
              rawRequestRevision: 1,
              startByte: 0,
              endByte: 1,
            },
          ],
        }),
        input.package,
      ),
    /must be empty/,
  );
});

void test('configuration mismatch diagnostics expose only the first safe field path', async (t) => {
  const fixture = fixtureAdapter(t, 'v2-config-mismatch');
  const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
  assert.equal(result.kind, 'FAILED');
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.deepEqual(fixture.diagnostics, [
    'PROCESS_UNAVAILABLE/CONFIGURATION/CONFIG/config/features/apps',
  ]);
  assert.equal(JSON.stringify(fixture.diagnostics).includes('true'), false);
});

void test('configuration diagnostics identify only a normalized feature key without its value', async (t) => {
  const fixture = fixtureAdapter(t, 'v2-config-extra-feature');
  const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
  assert.equal(result.kind, 'FAILED');
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.deepEqual(fixture.diagnostics, [
    'PROCESS_UNAVAILABLE/CONFIGURATION/CONFIG/config/features/future_feature',
  ]);
  assert.equal(JSON.stringify(fixture.diagnostics).includes('false'), false);
});

void test('configuration diagnostics reject instruction overrides without exposing content', async (t) => {
  const fixture = fixtureAdapter(t, 'v2-config-instruction-override');
  const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
  assert.equal(result.kind, 'FAILED');
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.deepEqual(fixture.diagnostics, [
    'PROCESS_UNAVAILABLE/CONFIGURATION/CONFIG/config/developer_instructions',
  ]);
  assert.equal(JSON.stringify(fixture.diagnostics).includes('sensitive-instruction'), false);
});

void test('configuration projection rejects a selected nested capability mismatch', async (t) => {
  const fixture = fixtureAdapter(t, 'v2-config-agents-enabled');
  const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
  assert.equal(result.kind, 'FAILED');
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.deepEqual(fixture.diagnostics, [
    'PROCESS_UNAVAILABLE/CONFIGURATION/CONFIG/config/agents/enabled',
  ]);
});

for (const [scenario, expectedDiagnostic] of [
  [
    'v2-managed-requirements-mismatch',
    'PROCESS_UNAVAILABLE/CONFIGURATION/MANAGED_REQUIREMENTS/requirements',
  ],
  [
    'v2-permission-profile-mismatch',
    'PROCESS_UNAVAILABLE/CONFIGURATION/PERMISSION_PROFILE/selected/allowed',
  ],
] as const) {
  void test(`${scenario} exposes only its safe closed-profile path`, async (t) => {
    const fixture = fixtureAdapter(t, scenario);
    const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
    assert.equal(result.kind, 'FAILED');
    assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
    assert.deepEqual(fixture.diagnostics, [expectedDiagnostic]);
    assert.equal(JSON.stringify(fixture.diagnostics).includes('fixture-mismatch'), false);
  });
}

void test('retained Slice 1 v2 input closes before process launch instead of receiving v3 semantics', async (t) => {
  const fixture = fixtureAdapter(t, 'v2-observed-sequence');
  const result = await fixture.assistant.answer(
    retainedV2AnswerInput(),
    new AbortController().signal,
  );
  assert.equal(result.kind, 'FAILED');
  assert.equal(result.failureReasonCode, 'ASSISTANT_UNAVAILABLE');
  assert.equal(result.observation.processLaunchCount, 0);
  assert.equal(result.observation.threadStartCount, 0);
  assert.equal(result.observation.turnStartCount, 0);
  assert.deepEqual(fixture.diagnostics, [
    'PROCESS_UNAVAILABLE/INPUT_VALIDATION/ASSISTANT_UNAVAILABLE',
  ]);
});

void test('observed-sequence-fixture and original-sequence-regression complete through the current v3 Adapter', async (t) => {
  const fixture = fixtureAdapter(t, 'v2-observed-sequence');
  const input = answerInput();
  assert.equal(input.package.assistantProfile.codexVersion, '0.146.1');
  assert.equal(
    input.package.assistantProfile.protocolSnapshotDigest,
    m251LiveIntakeAssistantProfile.protocolSnapshotDigest,
  );
  const result = await fixture.assistant.answer(input, new AbortController().signal);
  assert.equal(
    result.kind,
    'COMPLETED',
    JSON.stringify({ result, diagnostics: fixture.diagnostics }),
  );
  assert.equal(result.response.answerContent, 'This is a bounded non-authoritative answer.');
  assert.deepEqual(result.observation, {
    schemaVersion: 1,
    operation: 'ANSWER_ONLY',
    state: 'COMPLETED',
    processLaunchCount: 1,
    threadStartCount: 1,
    turnStartCount: 1,
    turnInterruptCount: 0,
    compactionCount: 0,
    backendSessionRef: 'thread-intake-fixture',
    backendOperationRef: 'turn-intake-fixture',
  });
  assert.deepEqual(fixture.diagnostics, []);
});

void test('the Adapter-local Thread projection rejects non-legacy history mode', async (t) => {
  const fixture = fixtureAdapter(t, 'v2-thread-history-paginated');
  const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
  assert.equal(result.kind, 'FAILED');
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.deepEqual(fixture.diagnostics, [
    'PROJECTED_MALFORMED_PARAMS/OBSERVATION/thread/started/thread/historyMode',
  ]);
});

void test('the v2 Thread projection accepts only the null-normalized default service tier', async (t) => {
  const fixture = fixtureAdapter(t, 'v2-thread-service-tier-drift');
  const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
  assert.equal(result.kind, 'FAILED');
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.deepEqual(fixture.diagnostics, ['PROCESS_UNAVAILABLE/THREAD_START/THREAD/serviceTier']);
});

void test('the current governed assumption scenario uses the version-3 Intake Adapter', async (t) => {
  const fixture = fixtureAdapter(t, 'v2-cli-unsupported-assumption');
  const input = intentInput();
  const result = await fixture.assistant.analyze(input, new AbortController().signal);
  assert.equal(result.kind, 'COMPLETED', JSON.stringify(result));
  assert.deepEqual(result.response.proposedAssumptions, ['Confirm bounded risk']);
  assert.equal('decisionId' in result.response, false);
  assert.equal('goalId' in result.response, false);
  assert.deepEqual(fixture.diagnostics, []);

  const evidencePath = process.env['CODECLOSURE_M25_ASSISTANT_SCENARIO_EVIDENCE_PATH'];
  if (evidencePath !== undefined) {
    writeFileSync(
      evidencePath,
      `${JSON.stringify({
        schemaVersion: 1,
        kind: 'M25_SCENARIO_EVIDENCE',
        scenarioId: 'M25-D02-ASSISTANT-ASSUMPTION',
        isolatedRoots: [
          { kind: 'AUTHORITY_ROOT', path: fixture.roots.authorityRoot },
          { kind: 'ADAPTER_STATE_ROOT', path: fixture.roots.codexHome },
          { kind: 'OPERATION_ROOT', path: fixture.roots.cwd },
          { kind: 'PROCESS_STATE_ROOT', path: fixture.roots.processHome },
          { kind: 'PROCESS_TEMPORARY_ROOT', path: fixture.roots.temporaryDirectory },
        ],
        inputIdentity: {
          operation: 'INTENT_ANALYSIS',
          primaryId: input.package.intakeRunId,
          digest: input.manifest.manifestDigest,
        },
        expectedDisposition: 'COMPLETED/ONE_UNSUPPORTED_ASSUMPTION/NO_AUTHORITY_FIELDS',
        observedDisposition: 'COMPLETED/ONE_UNSUPPORTED_ASSUMPTION/NO_AUTHORITY_FIELDS',
        finalSafeAuthorityProjection: {
          responseDigest: digests.digest(result.response),
          proposedAssumptionCount: result.response.proposedAssumptions.length,
          decisionAuthorityPresent: 'decisionId' in result.response,
          goalAuthorityPresent: 'goalId' in result.response,
          operationState: result.observation.state,
          processLaunchCount: result.observation.processLaunchCount,
          threadStartCount: result.observation.threadStartCount,
          turnStartCount: result.observation.turnStartCount,
        },
        strictReopen: 'NOT_APPLICABLE',
      })}\n`,
      { mode: 0o600 },
    );
  }
});

void test('remote-control-matrix admits only the exact disabled state', () => {
  for (const [sequence, status] of ['disabled', 'connecting', 'connected', 'errored'].entries()) {
    const harness = projectionHarness();
    harness.projection.record({
      method: 'remoteControl/status/changed',
      params: { status, serverName: '', installationId: '', environmentId: null },
      sequence: sequence + 1,
    });
    assert.equal(
      harness.events[0]?.kind,
      status === 'disabled' ? 'BENIGN_PROCESS_PROJECTION' : 'PROTOCOL_VIOLATION',
    );
  }
  const malformed = projectionHarness();
  malformed.projection.record({
    method: 'remoteControl/status/changed',
    params: { status: 'disabled', serverName: '', installationId: '' },
    sequence: 1,
  });
  assert.deepEqual(malformed.events[0], {
    diagnostic: 'PROJECTED_MALFORMED_PARAMS',
    kind: 'PROTOCOL_VIOLATION',
    sequence: 1,
    token: 'remoteControl/status/changed',
  });
});

void test('rate-limit-content-minimization validates then discards all account values', () => {
  const harness = projectionHarness();
  harness.projection.record({
    method: 'account/rateLimits/updated',
    params: {
      rateLimits: {
        limitId: 'secret-limit',
        limitName: 'secret-account-value',
        primary: null,
        secondary: null,
        credits: null,
        individualLimit: null,
        spendControlReached: null,
        planType: null,
        rateLimitReachedType: null,
      },
    },
    sequence: 1,
  });
  assert.deepEqual(harness.events[0], {
    kind: 'BENIGN_PROCESS_PROJECTION',
    projection: 'RATE_LIMITS_UPDATED',
    sequence: 1,
  });
  assert.equal(JSON.stringify(harness.events).includes('secret'), false);
});

void test('Turn error projection retains only the fixed error class and retry disposition', () => {
  const harness = projectionHarness();
  harness.projection.record({
    method: 'error',
    params: {
      error: {
        additionalDetails: 'sensitive-additional-details',
        codexErrorInfo: 'badRequest',
        message: 'sensitive-error-message',
      },
      threadId: refs.threadId,
      turnId: refs.turnId,
      willRetry: false,
    },
    sequence: 1,
  });
  assert.deepEqual(harness.events[0], {
    diagnostic: 'PROJECTED_UNMAPPED_LIFECYCLE',
    kind: 'PROTOCOL_VIOLATION',
    sequence: 1,
    token: 'error/badRequest/NO_RETRY',
  });
  assert.equal(JSON.stringify(harness.events).includes('sensitive'), false);
});

void test('notification-and-item-disposition-matrix gives raw Response Items one exhaustive content-free effect disposition', () => {
  const cases: readonly Readonly<{
    item: JsonObject;
    kind:
      'FORBIDDEN_EFFECT_OBSERVED' | 'PROTOCOL_VIOLATION' | 'REASONING_OBSERVED' | 'STREAM_PROGRESS';
    token?: string;
  }>[] = [
    {
      item: {
        type: 'message',
        role: 'assistant',
        content: [{ type: 'output_text', text: 'sensitive-message-content' }],
      },
      kind: 'STREAM_PROGRESS',
    },
    {
      item: {
        type: 'agent_message',
        author: 'sensitive-author',
        recipient: 'sensitive-recipient',
        content: [],
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'agent_message',
    },
    {
      item: {
        type: 'reasoning',
        summary: [{ type: 'summary_text', text: 'sensitive-reasoning' }],
        encrypted_content: null,
      },
      kind: 'REASONING_OBSERVED',
    },
    {
      item: {
        type: 'local_shell_call',
        call_id: null,
        status: 'completed',
        action: {
          type: 'exec',
          command: ['sensitive-command'],
          timeout_ms: null,
          working_directory: null,
          env: null,
          user: null,
        },
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'local_shell_call',
    },
    {
      item: {
        type: 'function_call',
        name: 'sensitive-function',
        arguments: 'sensitive-arguments',
        call_id: 'call-function',
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'function_call',
    },
    {
      item: {
        type: 'tool_search_call',
        call_id: null,
        execution: 'sensitive-execution',
        arguments: { query: 'sensitive-query' },
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'tool_search_call',
    },
    {
      item: {
        type: 'function_call_output',
        call_id: 'call-function-output',
        output: 'sensitive-output',
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'function_call_output',
    },
    {
      item: {
        type: 'custom_tool_call',
        call_id: 'call-custom',
        name: 'sensitive-custom-tool',
        input: 'sensitive-input',
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'custom_tool_call',
    },
    {
      item: {
        type: 'custom_tool_call_output',
        call_id: 'call-custom-output',
        output: 'sensitive-output',
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'custom_tool_call_output',
    },
    {
      item: {
        type: 'tool_search_output',
        call_id: null,
        status: 'completed',
        execution: 'sensitive-execution',
        tools: [{ name: 'sensitive-tool' }],
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'tool_search_output',
    },
    {
      item: {
        type: 'web_search_call',
        action: { type: 'search', query: 'sensitive-query' },
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'web_search_call',
    },
    {
      item: {
        type: 'image_generation_call',
        status: 'completed',
        result: 'sensitive-image-result',
      },
      kind: 'FORBIDDEN_EFFECT_OBSERVED',
      token: 'image_generation_call',
    },
    {
      item: { type: 'compaction', encrypted_content: 'sensitive-compaction' },
      kind: 'PROTOCOL_VIOLATION',
      token: 'compaction',
    },
    {
      item: { type: 'compaction_trigger' },
      kind: 'PROTOCOL_VIOLATION',
      token: 'compaction_trigger',
    },
    {
      item: { type: 'context_compaction', encrypted_content: 'sensitive-compaction' },
      kind: 'PROTOCOL_VIOLATION',
      token: 'context_compaction',
    },
    {
      item: { type: 'other' },
      kind: 'PROTOCOL_VIOLATION',
      token: 'other',
    },
  ];

  cases.forEach(({ item, kind, token }, index) => {
    const harness = projectionHarness();
    harness.projection.record(rawResponseItemNotification(index + 1, item));
    const event = harness.events[0];
    assert.ok(event);
    assert.equal(event.kind, kind);
    if (token !== undefined) {
      assert.equal('token' in event ? event.token : undefined, token);
    }
    assert.equal(JSON.stringify(harness.events).includes('sensitive'), false);
  });
});

void test('raw Response messages admit only the closed assistant role and phase', () => {
  const unsupportedRole = projectionHarness();
  unsupportedRole.projection.record(
    rawResponseItemNotification(1, { type: 'message', role: 'user', content: [] }),
  );
  assert.deepEqual(unsupportedRole.events[0], {
    diagnostic: 'PROJECTED_UNMAPPED_LIFECYCLE',
    kind: 'PROTOCOL_VIOLATION',
    sequence: 1,
    token: 'message',
  });

  const unsupportedPhase = projectionHarness();
  unsupportedPhase.projection.record(
    rawResponseItemNotification(1, {
      type: 'message',
      role: 'assistant',
      content: [],
      phase: 'unsupported',
    }),
  );
  assert.deepEqual(unsupportedPhase.events[0], {
    diagnostic: 'PROJECTED_MALFORMED_PARAMS',
    kind: 'PROTOCOL_VIOLATION',
    sequence: 1,
    token: 'rawResponseItem/completed',
  });

  const malformed = projectionHarness();
  malformed.projection.record(rawResponseItemNotification(1, { type: 'message', content: [] }));
  assert.deepEqual(malformed.events[0], {
    diagnostic: 'PROJECTED_MALFORMED_PARAMS',
    kind: 'PROTOCOL_VIOLATION',
    sequence: 1,
    token: 'rawResponseItem/completed',
  });
});

void test('message-stage-matrix is lifecycle-stage aware and keeps content terminal-bound', () => {
  const started = projectionHarness();
  started.projection.record(
    itemNotification(
      1,
      {
        type: 'agentMessage',
        id: 'message-1',
        text: '',
        phase: 'final_answer',
        memoryCitation: null,
      },
      'item/started',
    ),
  );
  assert.equal(started.events[0]?.kind, 'MESSAGE_STARTED');

  for (const item of [
    {
      type: 'agentMessage',
      id: 'message-1',
      text: '',
      phase: 'final_answer',
      memoryCitation: null,
    },
    {
      type: 'agentMessage',
      id: 'message-1',
      text: 'answer',
      phase: 'invalid',
      memoryCitation: null,
    },
    {
      type: 'agentMessage',
      id: 'message-1',
      text: 'answer',
      phase: 'final_answer',
      memoryCitation: {},
    },
    {
      type: 'agentMessage',
      id: 'message-1',
      text: 'answer',
      phase: 'final_answer',
      memoryCitation: null,
      extra: true,
    },
  ]) {
    const harness = projectionHarness();
    harness.projection.record(itemNotification(1, item));
    assert.equal(harness.events[0]?.kind, 'PROTOCOL_VIOLATION');
  }
});

void test('every pinned forbidden and protocol-only Thread Item classifies without raw payload retention', () => {
  const forbiddenItems = [
    {
      type: 'collabAgentToolCall',
      id: 'i',
      tool: 'spawnAgent',
      status: 'completed',
      senderThreadId: 's',
      receiverThreadIds: [],
      prompt: null,
      model: null,
      reasoningEffort: null,
      agentsStates: {},
    },
    {
      type: 'commandExecution',
      id: 'i',
      pluginId: null,
      scriptPath: null,
      command: 'sensitive-command',
      cwd: '/tmp',
      processId: null,
      source: 'unifiedExecStartup',
      status: 'completed',
      commandActions: [],
      aggregatedOutput: null,
      exitCode: 0,
      durationMs: 1,
    },
    {
      type: 'dynamicToolCall',
      id: 'i',
      namespace: null,
      tool: 'sensitive-tool',
      arguments: null,
      status: 'completed',
      contentItems: null,
      success: true,
      durationMs: 1,
    },
    { type: 'fileChange', id: 'i', changes: [], status: 'completed' },
    {
      type: 'imageGeneration',
      id: 'i',
      status: 'completed',
      revisedPrompt: null,
      result: 'sensitive-result',
    },
    { type: 'imageView', id: 'i', path: '/sensitive/path' },
    {
      type: 'mcpToolCall',
      id: 'i',
      server: 'sensitive-server',
      tool: 'tool',
      status: 'completed',
      arguments: null,
      appContext: null,
      pluginId: null,
      result: null,
      error: null,
      durationMs: 1,
    },
    { type: 'sleep', id: 'i', durationMs: 1 },
    {
      type: 'subAgentActivity',
      id: 'i',
      kind: 'spawn',
      agentThreadId: 'a',
      agentPath: 'sensitive-path',
    },
    { type: 'webSearch', id: 'i', query: 'sensitive-query', action: null, results: null },
  ];
  forbiddenItems.forEach((item, index) => {
    const harness = projectionHarness();
    harness.projection.record(itemNotification(index + 1, item));
    assert.equal(harness.events[0]?.kind, 'FORBIDDEN_EFFECT_OBSERVED');
    assert.equal(JSON.stringify(harness.events).includes('sensitive'), false);
  });

  for (const item of [
    { type: 'contextCompaction', id: 'i' },
    { type: 'enteredReviewMode', id: 'i', review: 'content' },
    { type: 'exitedReviewMode', id: 'i', review: 'content' },
    { type: 'hookPrompt', id: 'i', fragments: [] },
    { type: 'plan', id: 'i', text: 'content' },
  ]) {
    const harness = projectionHarness();
    harness.projection.record(itemNotification(1, item));
    assert.equal(harness.events[0]?.kind, 'PROTOCOL_VIOLATION');
  }
});

const closedScenarioDiagnostics = Object.freeze({
  'v2-forbidden-command': 'PROJECTED_FORBIDDEN_EFFECT/OBSERVATION/commandExecution',
  'v2-raw-function-call': 'PROJECTED_FORBIDDEN_EFFECT/OBSERVATION/function_call',
  'v2-raw-compaction': 'PROJECTED_UNMAPPED_LIFECYCLE/OBSERVATION/compaction_trigger',
  'v2-context-compaction-item': 'LOWER_CLIENT_CORRELATION/OBSERVATION/PROTOCOL_CORRELATION',
  'v2-remote-connected': 'PROJECTED_UNMAPPED_LIFECYCLE/THREAD_START/remoteControl/status/changed',
  'v2-remote-malformed': 'PROJECTED_MALFORMED_PARAMS/THREAD_START/remoteControl/status/changed',
  'v2-unsupported-notification':
    'LOWER_CLIENT_UNSUPPORTED_OR_MALFORMED/OBSERVATION/PROTOCOL_MALFORMED',
  'v2-malformed-envelope': 'LOWER_CLIENT_UNSUPPORTED_OR_MALFORMED/OBSERVATION/PROTOCOL_MALFORMED',
});

for (const [scenario, expectedDiagnostic] of Object.entries(closedScenarioDiagnostics)) {
  void test(`${scenario} interrupts or closes the v2 operation without output`, async (t) => {
    const fixture = fixtureAdapter(t, scenario);
    const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
    assert.equal(result.kind, 'FAILED');
    assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
    assert.deepEqual(fixture.diagnostics, [expectedDiagnostic]);
    assert.equal('response' in result, false);
    if (scenario === 'v2-raw-function-call' || scenario === 'v2-raw-compaction') {
      assert.equal(result.observation.turnInterruptCount, 1);
    }
    if (scenario === 'v2-raw-compaction') {
      assert.equal(result.observation.compactionCount, 1);
    }
  });
}

const terminalScenarioDiagnostics = Object.freeze({
  'v2-empty-completed': 'PROJECTED_MALFORMED_PARAMS/OBSERVATION/item/completed',
  'v2-terminal-mismatch': 'OBSERVER_TERMINAL_BINDING/OBSERVATION/MESSAGE_BINDING',
  'v2-multiple-messages': 'OBSERVER_TERMINAL_BINDING/OBSERVATION/MESSAGE_BINDING',
});

for (const [scenario, expectedDiagnostic] of Object.entries(terminalScenarioDiagnostics)) {
  void test(`terminal-response-matrix ${scenario} rejects the v2 terminal response and discards output`, async (t) => {
    const fixture = fixtureAdapter(t, scenario);
    const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
    assert.equal(result.kind, 'FAILED');
    assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
    assert.deepEqual(fixture.diagnostics, [expectedDiagnostic]);
    assert.equal('response' in result, false);
  });
}

const postTerminalScenarioDiagnostics = Object.freeze({
  'v2-post-terminal-forbidden': 'PROJECTED_FORBIDDEN_EFFECT/OBSERVATION/commandExecution',
  'v2-post-terminal-raw-function-call': 'PROJECTED_FORBIDDEN_EFFECT/OBSERVATION/function_call',
  'v2-post-terminal-raw-compaction': 'PROJECTED_UNMAPPED_LIFECYCLE/OBSERVATION/compaction_trigger',
  'v2-post-terminal-protocol-violation': 'PROJECTED_UNMAPPED_LIFECYCLE/OBSERVATION/model/rerouted',
  'v2-post-terminal-unsupported-notification':
    'LOWER_CLIENT_UNSUPPORTED_OR_MALFORMED/SHUTDOWN/PROTOCOL_MALFORMED',
});

for (const [scenario, expectedDiagnostic] of Object.entries(postTerminalScenarioDiagnostics)) {
  void test(`${scenario} cannot be hidden by an earlier terminal candidate`, async (t) => {
    const fixture = fixtureAdapter(t, scenario);
    const result = await fixture.assistant.answer(answerInput(), new AbortController().signal);
    assert.equal(result.kind, 'FAILED');
    assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
    assert.deepEqual(fixture.diagnostics, [expectedDiagnostic]);
    assert.equal('response' in result, false);
    if (scenario === 'v2-post-terminal-raw-compaction') {
      assert.equal(result.observation.compactionCount, 1);
    }
  });
}

void test('mixed v1 Adapter identity is rejected before process launch', async (t) => {
  const input = answerInput();
  const mixed: AnswerOnlyAssistantInput = {
    ...input,
    package: {
      ...input.package,
      assistantAdapter: {
        ...input.package.assistantAdapter,
        version: M25_INTAKE_ASSISTANT_ADAPTER_VERSION,
      },
    },
  };
  const fixture = fixtureAdapter(t, 'v2-observed-sequence');
  const result = await fixture.assistant.answer(mixed, new AbortController().signal);
  assert.equal(result.kind, 'FAILED');
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(result.observation.processLaunchCount, 0);
});

void test('process-timeout-interruption-closure returns typed v3 failures without output or recall', async (t) => {
  const timedOut = await fixtureAdapter(t, 'v2-request-timeout').assistant.analyze(
    intentInput(),
    new AbortController().signal,
  );
  assert.equal(timedOut.kind, 'FAILED');
  assert.equal(timedOut.failureReasonCode, 'ASSISTANT_TIMEOUT');
  assert.equal('response' in timedOut, false);

  const exited = await fixtureAdapter(t, 'v2-process-failure').assistant.analyze(
    intentInput(),
    new AbortController().signal,
  );
  assert.equal(exited.kind, 'FAILED');
  assert.equal(exited.failureReasonCode, 'ASSISTANT_UNAVAILABLE');
  assert.equal('response' in exited, false);

  const controller = new AbortController();
  const running = fixtureAdapter(t, 'v2-running-turn').assistant.analyze(
    intentInput(),
    controller.signal,
  );
  const abortTimer = setTimeout(() => controller.abort(), 100);
  const interrupted = await running;
  clearTimeout(abortTimer);
  assert.equal(interrupted.kind, 'FAILED');
  assert.equal(interrupted.failureReasonCode, 'ASSISTANT_UNAVAILABLE');
  assert.equal(interrupted.observation.turnStartCount, 1);
  assert.equal(interrupted.observation.turnInterruptCount, 1);
  assert.equal('response' in interrupted, false);
});
