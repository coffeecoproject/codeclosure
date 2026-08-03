import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import test, { type TestContext } from 'node:test';

import {
  createFixtureAppServerLaunch,
  createSpawnFailureAppServerLaunch,
} from '@codeclosure/codex-app-server-client/testing';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakePackageCompiler,
  Rfc8785Canonicalizer,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  m25IntakeAssistantProfile,
  type AnswerOnlyAssistantInput,
  type IntentAnalysisAssistantInput,
} from '@codeclosure/runtime';

import {
  M25_INTAKE_DISABLED_FEATURES,
  createCodexIntakeAssistantAdapter,
  decodeIntentAnalysisResponse,
  m25IntakeClosedConfig,
} from '@codeclosure/adapter-codex-intake';

const fixtureScript = resolve(import.meta.dirname, 'fixtures', 'fake-app-server.mjs');
const digests = new CanonicalJsonSha256DigestProvider();
const compiler = new M25IntakePackageCompiler({
  canonicalizer: new Rfc8785Canonicalizer(),
  digests,
});
const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
const launchNonce = `sha256:${'9'.repeat(64)}`;
const fixedDigest = `sha256:${'8'.repeat(64)}`;
const NOW = '2026-08-03T05:30:00.000Z';

function rawRequestRevision(
  action: 'MATERIALIZE_ONLY' | 'ANSWER_ONLY',
  intakeRunId: string,
  content: string,
  declaredProjectPath?: string,
) {
  const base = {
    schemaVersion: 1 as const,
    rawRequestId: `raw-request_adapter-${action === 'ANSWER_ONLY' ? 'answer' : 'intent'}`,
    intakeRunId,
    revision: 1,
    principalRef: 'principal_local-user',
    interactionAction: action,
    admittedUserContent: content,
    admittedContentDigest: digests.digestUtf8(content),
    ...(declaredProjectPath === undefined
      ? {}
      : {
          declaredProjectRef: {
            schemaVersion: 1 as const,
            normalizedPath: declaredProjectPath,
            identityDigest: digests.digest({ path: declaredProjectPath }),
          },
        }),
    declaredConstraints: [],
    retentionProfile: { id: 'retention_local', version: 'v1', digest: fixedDigest },
    submittedAt: NOW,
  };
  const projection = {
    schemaVersion: base.schemaVersion,
    rawRequestId: base.rawRequestId,
    intakeRunId: base.intakeRunId,
    revision: base.revision,
    principalRef: base.principalRef,
    interactionAction: base.interactionAction,
    admittedContentDigest: base.admittedContentDigest,
    ...('declaredProjectRef' in base ? { declaredProjectRef: base.declaredProjectRef } : {}),
    declaredConstraints: base.declaredConstraints,
    retentionProfile: base.retentionProfile,
  };
  return { ...base, rawRequestDigest: digests.digest(projection) };
}

function answerDecision(rawRequest: ReturnType<typeof rawRequestRevision>) {
  const base = {
    id: 'intent-admission_adapter-answer',
    schemaVersion: 1 as const,
    intakeRunId: rawRequest.intakeRunId,
    intakeRunVersion: 1,
    principalRef: rawRequest.principalRef,
    interactionAction: 'ANSWER_ONLY' as const,
    rawRequestRevision: rawRequest.revision,
    rawRequestDigest: rawRequest.rawRequestDigest,
    admissionPolicyId: policy.id,
    admissionPolicyVersion: policy.version,
    admissionPolicyDigest: policy.digest,
    orderedReasonTrace: [
      {
        ruleId: 'answer-only_action_codeclosure-m2-5-v1',
        outcome: 'MATCHED' as const,
        reasonCode: 'ANSWER_ONLY' as const,
        inputRefs: [rawRequest.rawRequestDigest],
      },
    ],
    decidedAt: NOW,
    kind: 'PRE_ANALYSIS_NO_EXECUTION' as const,
    outcome: 'NO_EXECUTION' as const,
    reasonCode: 'ANSWER_ONLY' as const,
    executionDisposition: 'NONE' as const,
  };
  const projection = {
    schemaVersion: base.schemaVersion,
    intakeRunId: base.intakeRunId,
    intakeRunVersion: base.intakeRunVersion,
    principalRef: base.principalRef,
    interactionAction: base.interactionAction,
    rawRequestRevision: base.rawRequestRevision,
    rawRequestDigest: base.rawRequestDigest,
    admissionPolicyId: base.admissionPolicyId,
    admissionPolicyVersion: base.admissionPolicyVersion,
    admissionPolicyDigest: base.admissionPolicyDigest,
    orderedReasonTrace: base.orderedReasonTrace,
    kind: base.kind,
    outcome: base.outcome,
    reasonCode: base.reasonCode,
    executionDisposition: base.executionDisposition,
  };
  return { ...base, decisionDigest: digests.digest(projection) };
}

function intentInput(declaredProjectPath?: string): IntentAnalysisAssistantInput {
  const intakeRunId = 'intake_adapter-intent';
  const rawRequest = rawRequestRevision(
    'MATERIALIZE_ONLY',
    intakeRunId,
    'Prepare the bounded requested change.',
    declaredProjectPath,
  );
  return compiler.compileIntentAnalysis({
    manifestId: 'intake-manifest_adapter-intent',
    createdAt: NOW,
    intakeRunId,
    rawRequestRevisions: [rawRequest],
    admissionPolicy: policy,
  } as unknown as Parameters<M25IntakePackageCompiler['compileIntentAnalysis']>[0]);
}

function answerInput(): AnswerOnlyAssistantInput {
  const intakeRunId = 'intake_adapter-answer';
  const rawRequest = rawRequestRevision('ANSWER_ONLY', intakeRunId, 'Explain this bounded topic.');
  return compiler.compileAnswerOnly({
    manifestId: 'intake-manifest_adapter-answer',
    createdAt: NOW,
    intakeRunId,
    rawRequestRevision: rawRequest,
    preparedDecision: answerDecision(rawRequest),
    admissionPolicy: policy,
  } as unknown as Parameters<M25IntakePackageCompiler['compileAnswerOnly']>[0]);
}

function fixtureRoots(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-intake-adapter-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const codexHome = join(root, 'codex-home');
  const cwd = join(root, 'operation-cwd');
  const processHome = join(root, 'process-home');
  const temporaryDirectory = join(root, 'process-tmp');
  const authorityRoot = join(root, 'authority');
  for (const path of [codexHome, cwd, processHome, temporaryDirectory, authorityRoot]) {
    mkdirSync(path);
  }
  return { root, codexHome, cwd, processHome, temporaryDirectory, authorityRoot };
}

function adapter(t: TestContext, scenario: string) {
  const roots = fixtureRoots(t);
  const launch = createFixtureAppServerLaunch({
    codexHome: roots.codexHome,
    cwd: roots.cwd,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome: roots.processHome,
    scenario,
    scriptPath: fixtureScript,
    temporaryDirectory: roots.temporaryDirectory,
  });
  return createCodexIntakeAssistantAdapter({
    launch,
    launchNonce,
    forbiddenRoots: [roots.authorityRoot],
    clientLimits: {
      initializationTimeoutMilliseconds: 1_000,
      requestTimeoutMilliseconds:
        scenario === 'request-timeout' ? 100 : scenario === 'running-turn' ? 3_000 : 1_000,
      shutdownGraceMilliseconds: 1_000,
      shutdownKillMilliseconds: 1_000,
    },
  });
}

void test('Intent analysis uses one fresh process, Thread, and Turn and returns only wire values', async (t) => {
  const result = await adapter(t, 'intent-success').analyze(
    intentInput(),
    new AbortController().signal,
  );
  if (result.kind !== 'COMPLETED') {
    assert.fail(`Expected completed Intent analysis, received ${result.failureReasonCode}`);
  }
  assert.equal(result.response.proposedObjective, 'Prepare the bounded requested change.');
  assert.deepEqual(result.response.proposedNonGoals, []);
  assert.deepEqual(result.observation, {
    schemaVersion: 1,
    operation: 'INTENT_ANALYSIS',
    state: 'COMPLETED',
    processLaunchCount: 1,
    threadStartCount: 1,
    turnStartCount: 1,
    turnInterruptCount: 0,
    compactionCount: 0,
    backendSessionRef: 'thread-intake-fixture',
    backendOperationRef: 'turn-intake-fixture',
  });
  assert.equal('decisionId' in result.response, false);
  assert.equal('goalId' in result.response, false);
});

void test('the closed profile explicitly disables every selected capability source', () => {
  assert.equal(
    m25IntakeAssistantProfile.effectPolicy,
    'ISOLATED_READ_ONLY_FAIL_ON_TOOL_OBSERVATION',
  );
  assert.deepEqual(m25IntakeAssistantProfile.selectedAuthorityCapabilities, []);
  assert.equal('selectedCapabilities' in m25IntakeAssistantProfile, false);
  for (const feature of [
    'shell_tool',
    'unified_exec',
    'shell_snapshot',
    'code_mode_host',
    'hooks',
    'multi_agent',
    'apps',
    'tool_suggest',
    'plugins',
    'in_app_browser',
    'browser_use',
    'computer_use',
    'remote_plugin',
    'image_generation',
    'skill_mcp_dependency_install',
    'skill_search',
    'goals',
    'tool_call_mcp_elicitation',
    'auth_elicitation',
    'personality',
    'workspace_dependencies',
  ]) {
    assert.equal(M25_INTAKE_DISABLED_FEATURES.includes(feature), true);
    assert.equal(m25IntakeClosedConfig.features[feature], false);
  }
});

void test('an observed tool Item interrupts the Turn and discards the operation', async (t) => {
  const result = await adapter(t, 'tool-item').analyze(intentInput(), new AbortController().signal);
  if (result.kind !== 'FAILED') {
    assert.fail('Expected observed tool use to fail the complete operation');
  }
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(result.observation.turnStartCount, 1);
  assert.equal(result.observation.turnInterruptCount, 1);
  assert.equal('response' in result, false);
});

void test('capability configuration drift stops before Thread creation', async (t) => {
  const result = await adapter(t, 'shell-tool-enabled').analyze(
    intentInput(),
    new AbortController().signal,
  );
  if (result.kind !== 'FAILED') {
    assert.fail('Expected capability configuration drift to fail closed');
  }
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(result.observation.processLaunchCount, 1);
  assert.equal(result.observation.threadStartCount, 0);
  assert.equal(result.observation.turnStartCount, 0);
});

void test('operation cwd cannot overlap a trusted forbidden root before launch', async (t) => {
  const roots = fixtureRoots(t);
  const launch = createFixtureAppServerLaunch({
    codexHome: roots.codexHome,
    cwd: roots.authorityRoot,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome: roots.processHome,
    scenario: 'intent-success',
    scriptPath: fixtureScript,
    temporaryDirectory: roots.temporaryDirectory,
  });
  const result = await createCodexIntakeAssistantAdapter({
    launch,
    launchNonce,
    forbiddenRoots: [roots.authorityRoot],
  }).analyze(intentInput(), new AbortController().signal);
  if (result.kind !== 'FAILED') {
    assert.fail('Expected the authority-root overlap to fail before launch');
  }
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(result.observation.processLaunchCount, 0);
});

void test('controlled App Server state cannot overlap a trusted forbidden root', async (t) => {
  const roots = fixtureRoots(t);
  const launch = createFixtureAppServerLaunch({
    codexHome: roots.codexHome,
    cwd: roots.cwd,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome: roots.processHome,
    scenario: 'intent-success',
    scriptPath: fixtureScript,
    temporaryDirectory: roots.temporaryDirectory,
  });
  const result = await createCodexIntakeAssistantAdapter({
    launch,
    launchNonce,
    forbiddenRoots: [roots.codexHome],
  }).analyze(intentInput(), new AbortController().signal);
  if (result.kind !== 'FAILED') {
    assert.fail('Expected the state-root overlap to fail before launch');
  }
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(result.observation.processLaunchCount, 0);
});

void test('operation cwd cannot overlap the declared project before launch', async (t) => {
  const roots = fixtureRoots(t);
  const projectRoot = join(roots.root, 'project');
  mkdirSync(projectRoot);
  const launch = createFixtureAppServerLaunch({
    codexHome: roots.codexHome,
    cwd: projectRoot,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome: roots.processHome,
    scenario: 'intent-success',
    scriptPath: fixtureScript,
    temporaryDirectory: roots.temporaryDirectory,
  });
  const result = await createCodexIntakeAssistantAdapter({
    launch,
    launchNonce,
    forbiddenRoots: [roots.authorityRoot],
  }).analyze(intentInput(projectRoot), new AbortController().signal);
  if (result.kind !== 'FAILED') {
    assert.fail('Expected the declared-project overlap to fail before launch');
  }
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(result.observation.processLaunchCount, 0);
});

void test('Answer-only uses its distinct package and strict response contract', async (t) => {
  const result = await adapter(t, 'answer-success').answer(
    answerInput(),
    new AbortController().signal,
  );
  if (result.kind !== 'COMPLETED') {
    assert.fail(`Expected completed Answer-only operation, received ${result.failureReasonCode}`);
  }
  assert.equal(result.response.answerContent, 'This is a bounded non-authoritative answer.');
  assert.equal(result.observation.operation, 'ANSWER_ONLY');
});

for (const scenario of [
  'compact',
  'thread-loss',
  'thread-mismatch',
  'server-request',
  'model-rerouted',
  'invalid-utf8-stream',
]) {
  void test(`${scenario} produces one closed protocol observation`, async (t) => {
    const result = await adapter(t, scenario).analyze(intentInput(), new AbortController().signal);
    if (result.kind !== 'FAILED') {
      assert.fail(`Expected ${scenario} to fail closed`);
    }
    assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
    assert.equal(result.observation.state, 'FAILED');
    assert.equal(result.observation.processLaunchCount, 1);
    assert.equal(result.observation.threadStartCount, 1);
    assert.equal(result.observation.turnStartCount, 1);
  });
}

for (const scenario of ['malformed-response', 'duplicate-key-response', 'unknown-response-field']) {
  void test(`${scenario} rejects the complete Intent response`, async (t) => {
    const result = await adapter(t, scenario).analyze(intentInput(), new AbortController().signal);
    if (result.kind !== 'FAILED') {
      assert.fail(`Expected ${scenario} to reject the response`);
    }
    assert.equal(result.failureReasonCode, 'RESPONSE_REJECTED');
    assert.equal('response' in result, false);
  });
}

void test('oversized Answer-only content rejects the complete response', async (t) => {
  const result = await adapter(t, 'oversized-answer').answer(
    answerInput(),
    new AbortController().signal,
  );
  if (result.kind !== 'FAILED') {
    assert.fail('Expected oversized Answer-only content to be rejected');
  }
  assert.equal(result.failureReasonCode, 'RESPONSE_REJECTED');
});

void test('a response above the Answer-only wire budget is rejected before retention', async (t) => {
  const result = await adapter(t, 'oversized-wire').answer(
    answerInput(),
    new AbortController().signal,
  );
  if (result.kind !== 'FAILED') {
    assert.fail('Expected the oversized Answer-only wire response to be rejected');
  }
  assert.equal(result.failureReasonCode, 'RESPONSE_REJECTED');
});

void test('the Intent wire decoder enforces optional, duplicate, integer, and item-index rules', () => {
  const packageValue = intentInput().package;
  const base = {
    proposedCriteria: ['criterion'],
    proposedNonGoals: [],
    proposedAssumptions: [],
    proposedQuestions: [],
    candidateSourceSpanSuggestions: [],
  };
  assert.throws(
    () =>
      decodeIntentAnalysisResponse(
        JSON.stringify({ ...base, proposedObjective: null }),
        packageValue,
      ),
    /non-blank/u,
  );
  assert.throws(
    () =>
      decodeIntentAnalysisResponse(
        JSON.stringify({ ...base, proposedCriteria: ['same', 'same'] }),
        packageValue,
      ),
    /duplicate/u,
  );
  assert.throws(
    () =>
      decodeIntentAnalysisResponse(
        JSON.stringify({
          ...base,
          candidateSourceSpanSuggestions: [
            {
              projectionFieldRef: 'OBJECTIVE',
              rawRequestRevision: 1.5,
              startByte: 0,
              endByte: 1,
            },
          ],
        }),
        packageValue,
      ),
    /integer/u,
  );
  assert.throws(
    () =>
      decodeIntentAnalysisResponse(
        JSON.stringify({
          ...base,
          candidateSourceSpanSuggestions: [
            {
              projectionFieldRef: 'REQUIRED_CRITERION',
              rawRequestRevision: 1,
              startByte: 0,
              endByte: 1,
            },
          ],
        }),
        packageValue,
      ),
    /missing fields/u,
  );
});

void test('the adapter rejects package-shape expansion before launching a process', async (t) => {
  const input = intentInput();
  const expanded = {
    ...input,
    package: { ...input.package, goalId: 'goal_forged' },
  } as unknown as IntentAnalysisAssistantInput;
  const result = await adapter(t, 'intent-success').analyze(expanded, new AbortController().signal);
  if (result.kind !== 'FAILED') {
    assert.fail('Expected package-shape expansion to fail closed');
  }
  assert.equal(result.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(result.observation.processLaunchCount, 0);
});

void test('the adapter rejects Manifest and nested package substitution before launch', async (t) => {
  const manifestInput = intentInput();
  const substitutedManifest = {
    ...manifestInput,
    manifest: { ...manifestInput.manifest, manifestDigest: fixedDigest },
  } as unknown as IntentAnalysisAssistantInput;
  const manifestResult = await adapter(t, 'intent-success').analyze(
    substitutedManifest,
    new AbortController().signal,
  );
  if (manifestResult.kind !== 'FAILED') {
    assert.fail('Expected the substituted Manifest to fail closed');
  }
  assert.equal(manifestResult.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(manifestResult.observation.processLaunchCount, 0);

  const packageInput = intentInput();
  const [rawRequest, ...remainingRawRequests] = packageInput.package.rawRequestRevisions;
  assert.notEqual(rawRequest, undefined);
  const substitutedPackage = {
    ...packageInput,
    package: {
      ...packageInput.package,
      rawRequestRevisions: [
        { ...rawRequest, admittedUserContent: 'Substituted after compilation.' },
        ...remainingRawRequests,
      ],
    },
  } as unknown as IntentAnalysisAssistantInput;
  const packageResult = await adapter(t, 'intent-success').analyze(
    substitutedPackage,
    new AbortController().signal,
  );
  if (packageResult.kind !== 'FAILED') {
    assert.fail('Expected the nested package substitution to fail closed');
  }
  assert.equal(packageResult.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(packageResult.observation.processLaunchCount, 0);
});

void test('request timeout and process exit map to closed unavailable classes', async (t) => {
  const timedOut = await adapter(t, 'request-timeout').analyze(
    intentInput(),
    new AbortController().signal,
  );
  if (timedOut.kind !== 'FAILED') {
    assert.fail('Expected the bounded request timeout to fail closed');
  }
  assert.equal(timedOut.failureReasonCode, 'ASSISTANT_TIMEOUT');

  const exited = await adapter(t, 'process-failure').analyze(
    intentInput(),
    new AbortController().signal,
  );
  if (exited.kind !== 'FAILED') {
    assert.fail('Expected process exit to fail closed');
  }
  assert.equal(exited.failureReasonCode, 'ASSISTANT_UNAVAILABLE');
});

void test('host abort interrupts an already-started Turn and fails closed', async (t) => {
  const controller = new AbortController();
  const operation = adapter(t, 'running-turn').analyze(intentInput(), controller.signal);
  const abortTimer = setTimeout(() => controller.abort(), 1_000);
  const result = await operation;
  clearTimeout(abortTimer);
  if (result.kind !== 'FAILED') {
    assert.fail('Expected an aborted running Turn to fail closed');
  }
  assert.equal(result.failureReasonCode, 'ASSISTANT_UNAVAILABLE');
  assert.equal(result.observation.turnStartCount, 1);
  assert.equal(result.observation.turnInterruptCount, 1);
  assert.equal(result.observation.backendOperationRef, 'turn-intake-fixture');
});

void test('spawn failure returns no raw exception and no invented process observation', async (t) => {
  const roots = fixtureRoots(t);
  const launch = createSpawnFailureAppServerLaunch(
    {
      codexHome: roots.codexHome,
      cwd: roots.cwd,
      executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
      processHome: roots.processHome,
      temporaryDirectory: roots.temporaryDirectory,
    },
    join(roots.root, 'missing-codex-executable'),
  );
  const result = await createCodexIntakeAssistantAdapter({
    launch,
    launchNonce,
    forbiddenRoots: [roots.authorityRoot],
  }).analyze(intentInput(), new AbortController().signal);
  if (result.kind !== 'FAILED') {
    assert.fail('Expected spawn failure to return a closed observation');
  }
  assert.equal(result.failureReasonCode, 'ASSISTANT_UNAVAILABLE');
  assert.equal(result.observation.processLaunchCount, 0);
  assert.equal('message' in result.observation, false);
});

void test('one adapter instance cannot hide a second operation or retry', async (t) => {
  const singleUse = adapter(t, 'intent-success');
  const first = await singleUse.analyze(intentInput(), new AbortController().signal);
  const second = await singleUse.analyze(intentInput(), new AbortController().signal);
  if (first.kind !== 'COMPLETED') {
    assert.fail('Expected the first single-use adapter operation to complete');
  }
  if (second.kind !== 'FAILED') {
    assert.fail('Expected the second single-use adapter operation to fail closed');
  }
  assert.equal(second.failureReasonCode, 'ASSISTANT_PROTOCOL_ERROR');
  assert.equal(second.observation.processLaunchCount, 0);
});
