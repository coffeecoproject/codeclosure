import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  AnswerOnlyResponseKind,
  IntakeFailureReasonCode,
  IntakeInteractionAction,
  IntakeRunStatus,
  auditEventId,
  commandId,
  isoTimestamp,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakeCoordinator,
  M25IntakePackageCompiler,
  M251IntakePackageCompiler,
  M25IntentAdmissionEngine,
  M25IntentProjectionCompiler,
  Rfc8785Canonicalizer,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  type AnswerOnlyAssistantResponseV1,
  type IntakeAssistantOperationResult,
  type IntakeAssistantPort,
  type IntakePackageCompilerPort,
  type IntentAnalysisAssistantResponseV1,
} from '@codeclosure/runtime';
import { DeterministicIds } from '@codeclosure/testing';
import { SqliteControlStore } from '@codeclosure/store-sqlite';

const digests = new CanonicalJsonSha256DigestProvider();
const canonicalizer = new Rfc8785Canonicalizer();

class IncrementingClock {
  #second = 0;

  public now() {
    this.#second += 1;
    return isoTimestamp(`2026-08-07T09:00:${String(this.#second).padStart(2, '0')}.000Z`);
  }
}

type AnswerStep = IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1> | 'THROW';

class AnswerScriptAssistant implements IntakeAssistantPort {
  readonly #answers: AnswerStep[];
  public analyzeCalls = 0;
  public answerCalls = 0;

  public constructor(answers: readonly AnswerStep[]) {
    this.#answers = [...answers];
  }

  public analyze(): Promise<IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>> {
    this.analyzeCalls += 1;
    return Promise.reject(new Error('Unexpected Intent-analysis call'));
  }

  public answer(): Promise<IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1>> {
    const step = this.#answers[this.answerCalls];
    this.answerCalls += 1;
    return step === undefined || step === 'THROW'
      ? Promise.reject(new Error('Injected pre-result Intake interruption'))
      : Promise.resolve(step);
  }
}

function completedAnswer(answerContent: string): AnswerStep {
  return {
    kind: 'COMPLETED',
    response: { answerContent },
    observation: {
      schemaVersion: 1,
      operation: 'ANSWER_ONLY',
      state: 'COMPLETED',
      processLaunchCount: 1,
      threadStartCount: 1,
      turnStartCount: 1,
      turnInterruptCount: 0,
      compactionCount: 0,
    },
  };
}

function failedAnswer(): AnswerStep {
  return {
    kind: 'FAILED',
    failureReasonCode: 'ASSISTANT_PROTOCOL_ERROR',
    observation: {
      schemaVersion: 1,
      operation: 'ANSWER_ONLY',
      state: 'FAILED',
      processLaunchCount: 1,
      threadStartCount: 1,
      turnStartCount: 1,
      turnInterruptCount: 1,
      compactionCount: 0,
      failureReasonCode: 'ASSISTANT_PROTOCOL_ERROR',
    },
  };
}

function databasePath(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-m251-intake-compatibility-'));
  t.after(() => rmSync(directory, { force: true, recursive: true }));
  return join(directory, 'authority.sqlite');
}

function installPolicy(store: SqliteControlStore) {
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  const installed = store.installIntentAdmissionPolicy({
    policy,
    installedAt: isoTimestamp('2026-08-07T09:00:00.000Z'),
    auditEventId: auditEventId('audit_m251-intake-policy'),
    payloadDigest: policy.digest,
  });
  assert.equal(installed.status, 'INSTALLED');
  return policy;
}

function coordinator(
  store: SqliteControlStore,
  assistant: IntakeAssistantPort,
  compiler: IntakePackageCompilerPort,
  namespace: string,
  policyId: string,
): M25IntakeCoordinator {
  return new M25IntakeCoordinator({
    store,
    assistant,
    packageCompiler: compiler,
    projectionCompiler: new M25IntentProjectionCompiler({ canonicalizer, digests }),
    admissionEngine: new M25IntentAdmissionEngine(digests),
    admissionPolicyId: policyId,
    clock: new IncrementingClock(),
    digests,
    ids: new DeterministicIds(namespace),
  });
}

function v1Compiler(): IntakePackageCompilerPort {
  return new M25IntakePackageCompiler({ canonicalizer, digests });
}

function currentCompiler(): IntakePackageCompilerPort {
  return new M251IntakePackageCompiler({ canonicalizer, digests });
}

const successCommand = commandId('command_m251-v1-success');
const failureCommand = commandId('command_m251-v1-failure');
const successRequest = {
  commandId: successCommand,
  interactionAction: IntakeInteractionAction.ANSWER_ONLY,
  admittedUserContent: 'Explain the retained successful topic.',
} as const;
const failureRequest = {
  commandId: failureCommand,
  interactionAction: IntakeInteractionAction.ANSWER_ONLY,
  admittedUserContent: 'Explain the retained failed topic.',
} as const;

void test('retained completed v1 success and failure reopen without reinterpretation', async (t) => {
  const filename = databasePath(t);
  const initial = SqliteControlStore.open({ filename });
  const policy = installPolicy(initial);
  const assistant = new AnswerScriptAssistant([
    completedAnswer('A retained non-authoritative answer.'),
    failedAnswer(),
  ]);
  const runtime = coordinator(initial, assistant, v1Compiler(), 'm251-v1-initial', policy.id);
  const success = await runtime.submit(successRequest);
  const failure = await runtime.submit(failureRequest);
  assert.equal(success.kind, 'OUTCOME');
  assert.equal(failure.kind, 'OUTCOME');
  const successAuthority = initial.getIntakeAuthority(success.outcome.intakeRunId);
  const failureAuthority = initial.getIntakeAuthority(failure.outcome.intakeRunId);
  assert.ok(successAuthority);
  assert.ok(failureAuthority);
  assert.equal(
    successAuthority.manifests[0]?.assistantAdapter.version,
    'codeclosure-m2-5-intake-adapter-v1',
  );
  assert.equal(
    failureAuthority.manifests[0]?.assistantAdapter.version,
    'codeclosure-m2-5-intake-adapter-v1',
  );
  initial.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getIntakeAuthority(success.outcome.intakeRunId), successAuthority);
    assert.deepEqual(reopened.getIntakeAuthority(failure.outcome.intakeRunId), failureAuthority);
  } finally {
    reopened.close();
  }
});

void test('completed v1 failure replays without another assistant effect', async (t) => {
  const filename = databasePath(t);
  const initial = SqliteControlStore.open({ filename });
  const policy = installPolicy(initial);
  const firstAssistant = new AnswerScriptAssistant([failedAnswer()]);
  const firstRuntime = coordinator(
    initial,
    firstAssistant,
    v1Compiler(),
    'm251-v1-fail-first',
    policy.id,
  );
  const first = await firstRuntime.submit(failureRequest);
  initial.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    const noCall = new AnswerScriptAssistant([]);
    const replayRuntime = coordinator(
      reopened,
      noCall,
      currentCompiler(),
      'm251-v1-fail-replay',
      policy.id,
    );
    const replay = await replayRuntime.submit(failureRequest);
    assert.equal(first.kind, 'OUTCOME');
    assert.equal(replay.kind, 'OUTCOME');
    assert.deepEqual(replay.outcome, first.outcome);
    assert.equal(first.replayed, false);
    assert.equal(replay.replayed, true);
    assert.equal(noCall.answerCalls, 0);
    assert.equal(noCall.analyzeCalls, 0);
  } finally {
    reopened.close();
  }
});

void test('incomplete v1 operations reconcile closed and never resume through the current version', async (t) => {
  const filename = databasePath(t);
  const initial = SqliteControlStore.open({ filename });
  const policy = installPolicy(initial);
  const crashing = new AnswerScriptAssistant(['THROW']);
  const initialRuntime = coordinator(initial, crashing, v1Compiler(), 'm251-v1-orphan', policy.id);
  const orphanCommand = commandId('command_m251-v1-orphan');
  await assert.rejects(
    initialRuntime.submit({
      commandId: orphanCommand,
      interactionAction: IntakeInteractionAction.ANSWER_ONLY,
      admittedUserContent: 'Leave this v1 operation incomplete.',
    }),
    /Injected pre-result Intake interruption/u,
  );
  const reservation = initial.getIntakeCommandReservation(orphanCommand);
  assert.ok(reservation);
  const before = initial.getIntakeAuthority(reservation.intakeRunId);
  assert.ok(before);
  assert.equal(before.manifests[0]?.assistantAdapter.version, 'codeclosure-m2-5-intake-adapter-v1');
  const analysisCommand = commandId('command_m251-v1-analysis-orphan');
  await assert.rejects(
    initialRuntime.submit({
      commandId: analysisCommand,
      interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
      admittedUserContent: 'Leave this v1 analysis incomplete.',
    }),
    /Unexpected Intent-analysis call/u,
  );
  const analysisReservation = initial.getIntakeCommandReservation(analysisCommand);
  assert.ok(analysisReservation);
  const analysisBefore = initial.getIntakeAuthority(analysisReservation.intakeRunId);
  assert.ok(analysisBefore);
  assert.equal(
    analysisBefore.manifests[0]?.assistantAdapter.version,
    'codeclosure-m2-5-intake-adapter-v1',
  );
  initial.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    const noCall = new AnswerScriptAssistant([]);
    const recovery = coordinator(
      reopened,
      noCall,
      currentCompiler(),
      'm251-v3-recovery',
      policy.id,
    );
    assert.deepEqual(recovery.reconcileStartup(), {
      scanned: 2,
      reconciledAnalysisFailures: 1,
      reconciledAnswerFailures: 1,
    });
    assert.equal(noCall.answerCalls, 0);
    assert.equal(noCall.analyzeCalls, 0);
    const after = reopened.getIntakeAuthority(reservation.intakeRunId);
    assert.ok(after);
    assert.equal(
      after.manifests[0]?.assistantAdapter.version,
      'codeclosure-m2-5-intake-adapter-v1',
    );
    const response = after.answerOnlyResponses[0];
    assert.equal(response?.kind, AnswerOnlyResponseKind.ANSWER_FAILED);
    assert.equal(response.failureReasonCode, 'INTERRUPTED_ANSWER_DELIVERY');
    const analysisAfter = reopened.getIntakeAuthority(analysisReservation.intakeRunId);
    assert.ok(analysisAfter);
    assert.equal(analysisAfter.intakeRun.status, IntakeRunStatus.FAILED);
    assert.equal(
      analysisAfter.manifests[0]?.assistantAdapter.version,
      'codeclosure-m2-5-intake-adapter-v1',
    );
    assert.equal(
      analysisAfter.failures[0]?.reasonCode,
      IntakeFailureReasonCode.INTERRUPTED_ANALYSIS,
    );
  } finally {
    reopened.close();
  }
});

void test('new v3 operation persists one exact Manifest, reservation, and response binding', async (t) => {
  const filename = databasePath(t);
  const initial = SqliteControlStore.open({ filename });
  const policy = installPolicy(initial);
  const operation = coordinator(
    initial,
    new AnswerScriptAssistant([completedAnswer('A new v3 non-authoritative answer.')]),
    currentCompiler(),
    'm251-v3-new-operation',
    policy.id,
  );
  const result = await operation.submit({
    commandId: commandId('command_m251-v3-new-operation'),
    interactionAction: IntakeInteractionAction.ANSWER_ONLY,
    admittedUserContent: 'Explain the new versioned topic.',
  });
  assert.equal(result.kind, 'OUTCOME');
  const authority = initial.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(authority);
  const manifest = authority.manifests[0];
  const reservation = authority.reservations[0];
  const response = authority.answerOnlyResponses[0];
  assert.equal(manifest?.assistantAdapter.version, 'codeclosure-m2-5-1-intake-adapter-v3');
  assert.ok(reservation !== undefined && 'externalOperationBinding' in reservation);
  assert.deepEqual(
    {
      id: reservation.externalOperationBinding.assistantAdapterId,
      version: reservation.externalOperationBinding.assistantAdapterVersion,
    },
    manifest.assistantAdapter,
  );
  assert.equal(response?.kind, AnswerOnlyResponseKind.ANSWER_RETURNED);
  assert.equal(response.assistantAdapterId, manifest.assistantAdapter.id);
  assert.equal(response.assistantAdapterVersion, manifest.assistantAdapter.version);
  initial.close();

  const reopened = SqliteControlStore.open({ filename });
  try {
    assert.deepEqual(reopened.getIntakeAuthority(result.outcome.intakeRunId), authority);
  } finally {
    reopened.close();
  }
});

void test('stored v1/current Adapter substitution fails strict reopen', async (t) => {
  const filename = databasePath(t);
  const initial = SqliteControlStore.open({ filename });
  const policy = installPolicy(initial);
  const runtime = coordinator(
    initial,
    new AnswerScriptAssistant([failedAnswer()]),
    v1Compiler(),
    'm251-v1-tamper',
    policy.id,
  );
  await runtime.submit(failureRequest);
  initial.close();

  const raw = new Database(filename);
  try {
    const row = raw.prepare('SELECT id, record_json FROM intake_manifests LIMIT 1').get() as {
      id: string;
      record_json: string;
    };
    const manifest = JSON.parse(row.record_json) as {
      assistantAdapter: { version: string };
    };
    manifest.assistantAdapter.version = 'codeclosure-m2-5-1-intake-adapter-v3';
    raw.exec('DROP TRIGGER intake_manifests_no_update');
    raw
      .prepare('UPDATE intake_manifests SET record_json = ? WHERE id = ?')
      .run(JSON.stringify(manifest), row.id);
  } finally {
    raw.close();
  }

  assert.throws(
    () => SqliteControlStore.open({ filename }),
    /Intake Manifest|digest|strict reopen/u,
  );
});
