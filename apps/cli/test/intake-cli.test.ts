import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import { rawRequestRevision } from '@codeclosure/domain';
import type {
  AnswerOnlyAssistantResponseV1,
  IntakeAssistantOperationResult,
  IntakeAssistantPort,
  IntentAnalysisAssistantResponseV1,
} from '@codeclosure/runtime';
import { CryptographicIdentityGenerator } from '@codeclosure/runtime/composition';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';

import { CliExitCode, CliOperation } from '../dist/cli/contracts.js';
import { parseCliInvocation } from '../dist/cli/parser.js';
import {
  exitCodeForCliEnvelope,
  renderCliEnvelopeHuman,
  renderCliEnvelopeJson,
} from '../dist/cli/presentation.js';
import {
  executeIntakeAudit,
  executeIntakeStatus,
  executeIntakeSubmit,
} from '../dist/commands/intake.js';
import { createIntakeCliComposition } from '../dist/composition/index.js';

function temporaryRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-intake-cli-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

class AnswerAssistant implements IntakeAssistantPort {
  public answerCalls = 0;

  public analyze(): Promise<IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>> {
    return Promise.reject(new Error('Answer-only CLI path must not invoke Intent analysis'));
  }

  public answer(): Promise<IntakeAssistantOperationResult<AnswerOnlyAssistantResponseV1>> {
    this.answerCalls += 1;
    return Promise.resolve(
      Object.freeze({
        kind: 'COMPLETED',
        response: Object.freeze({ answerContent: 'A bounded non-authoritative answer.' }),
        observation: Object.freeze({
          schemaVersion: 1,
          operation: 'ANSWER_ONLY',
          state: 'COMPLETED',
          processLaunchCount: 1,
          threadStartCount: 1,
          turnStartCount: 1,
          turnInterruptCount: 0,
          compactionCount: 0,
        }),
      }),
    );
  }
}

class NoCallAssistant implements IntakeAssistantPort {
  public analyze(): Promise<never> {
    return Promise.reject(new Error('Strict reopen must not invoke Intent analysis'));
  }

  public answer(): Promise<never> {
    return Promise.reject(new Error('Strict reopen must not invoke Answer-only delivery'));
  }
}

class InterruptedAssistant implements IntakeAssistantPort {
  public analyzeCalls = 0;
  public answerCalls = 0;

  public analyze(): Promise<never> {
    this.analyzeCalls += 1;
    return Promise.reject(new Error('Injected interrupted Intake analysis'));
  }

  public answer(): Promise<never> {
    this.answerCalls += 1;
    return Promise.reject(new Error('Injected interrupted Answer-only delivery'));
  }
}

class RecoveryNoCallAssistant implements IntakeAssistantPort {
  public analyzeCalls = 0;
  public answerCalls = 0;

  public analyze(): Promise<never> {
    this.analyzeCalls += 1;
    return Promise.reject(new Error('Startup reconciliation must not recall Intent analysis'));
  }

  public answer(): Promise<never> {
    this.answerCalls += 1;
    return Promise.reject(new Error('Startup reconciliation must not recall Answer-only delivery'));
  }
}

class ExactMaterializationAssistant implements IntakeAssistantPort {
  public analyzeCalls = 0;

  public analyze(): Promise<IntakeAssistantOperationResult<IntentAnalysisAssistantResponseV1>> {
    this.analyzeCalls += 1;
    return Promise.resolve(
      Object.freeze({
        kind: 'COMPLETED',
        response: Object.freeze({
          proposedObjective: 'Ship slice 7',
          proposedCriteria: Object.freeze(['Ship slice 7']),
          proposedNonGoals: Object.freeze([]),
          proposedAssumptions: Object.freeze([]),
          proposedQuestions: Object.freeze([]),
          candidateSourceSpanSuggestions: Object.freeze([
            Object.freeze({
              projectionFieldRef: 'OBJECTIVE',
              rawRequestRevision: rawRequestRevision(1),
              startByte: 0,
              endByte: 12,
            }),
            Object.freeze({
              projectionFieldRef: 'REQUIRED_CRITERION',
              itemIndex: 0,
              rawRequestRevision: rawRequestRevision(1),
              startByte: 0,
              endByte: 12,
            }),
          ]),
        }),
        observation: Object.freeze({
          schemaVersion: 1,
          operation: 'INTENT_ANALYSIS',
          state: 'COMPLETED',
          processLaunchCount: 1,
          threadStartCount: 1,
          turnStartCount: 1,
          turnInterruptCount: 0,
          compactionCount: 0,
        }),
      }),
    );
  }

  public answer(): Promise<never> {
    return Promise.reject(new Error('Materialization CLI path must not invoke Answer-only'));
  }
}

void test('Intake CLI facade returns shared typed views and strict reopen makes no assistant call', async (t) => {
  const root = temporaryRoot(t);
  const dataHomePath = join(root, 'authority');
  const assistant = new AnswerAssistant();
  const composition = createIntakeCliComposition({
    dataHomePath,
    protectedPaths: [],
    allowedProjectPaths: [],
    assistant,
  });
  const ids = new CryptographicIdentityGenerator();
  const parsed = parseCliInvocation([
    'intake',
    'submit',
    '--action',
    'answer-only',
    '--request',
    'Explain the bounded contract.',
    '--json',
  ]);
  assert.equal(parsed.operation, CliOperation.INTAKE_SUBMIT);

  try {
    assert.deepEqual(Reflect.ownKeys(composition).toSorted(), [
      'application',
      'close',
      'intakeRecovery',
      'startupRecovery',
    ]);
    assert.deepEqual(Reflect.ownKeys(composition.application).toSorted(), [
      'abandon',
      'clarify',
      'getAudit',
      'getStatus',
      'submit',
    ]);
    assert.deepEqual(composition.intakeRecovery, {
      scanned: 0,
      reconciledAnalysisFailures: 0,
      reconciledAnswerFailures: 0,
    });

    const submitted = await executeIntakeSubmit({
      application: composition.application,
      commandId: ids.nextCommandId(),
      invocation: parsed,
    });
    assert.equal(exitCodeForCliEnvelope(submitted), 0);
    assert.equal(submitted.result.kind, 'OUTCOME');
    assert.equal(submitted.result.outcome.result.kind, 'NO_EXECUTION');
    assert.equal(submitted.result.outcome.result.answerDisposition, 'ANSWER_RETURNED');
    assert.equal(submitted.result.startDisposition, 'NOT_AUTHORIZED');
    assert.equal(submitted.result.answerOnlyContent, 'A bounded non-authoritative answer.');
    assert.equal(assistant.answerCalls, 1);

    const intakeRunId = submitted.result.outcome.intakeRunId;
    const status = executeIntakeStatus(composition.application, intakeRunId);
    const audit = executeIntakeAudit(composition.application, intakeRunId);
    assert.equal(exitCodeForCliEnvelope(status), 0);
    assert.equal(exitCodeForCliEnvelope(audit), 0);
    assert.equal(status.result.status, 'FOUND');
    assert.equal(audit.result.status, 'FOUND');
    assert.match(renderCliEnvelopeHuman(status), /Status: NO_EXECUTION/);
    assert.match(renderCliEnvelopeHuman(audit), /Payload digest: sha256:/);
    assert.equal(renderCliEnvelopeJson(submitted).trim().split('\n').length, 1);
    assert.equal(
      exitCodeForCliEnvelope(executeIntakeStatus(composition.application, 'intake_missing')),
      CliExitCode.REJECTED,
    );
    assert.equal(
      exitCodeForCliEnvelope(executeIntakeAudit(composition.application, 'intake_missing')),
      CliExitCode.REJECTED,
    );

    const statusBeforeClose = status.result;
    const auditBeforeClose = audit.result;
    composition.close();
    const reopened = createIntakeCliComposition({
      dataHomePath,
      protectedPaths: [],
      allowedProjectPaths: [],
      assistant: new NoCallAssistant(),
    });
    try {
      assert.deepEqual(
        executeIntakeStatus(reopened.application, intakeRunId).result,
        statusBeforeClose,
      );
      assert.deepEqual(
        executeIntakeAudit(reopened.application, intakeRunId).result,
        auditBeforeClose,
      );
      assert.deepEqual(reopened.intakeRecovery, {
        scanned: 0,
        reconciledAnalysisFailures: 0,
        reconciledAnswerFailures: 0,
      });
    } finally {
      reopened.close();
    }
  } finally {
    composition.close();
  }
});

void test('trusted Intake composition strictly reopens, reconciles both orphan kinds, and publishes only terminal views', async (t) => {
  const root = temporaryRoot(t);
  const dataHomePath = join(root, 'authority');
  const databasePath = join(dataHomePath, 'state.sqlite');
  const interruptedAssistant = new InterruptedAssistant();
  const initial = createIntakeCliComposition({
    dataHomePath,
    protectedPaths: [],
    allowedProjectPaths: [],
    assistant: interruptedAssistant,
  });
  const ids = new CryptographicIdentityGenerator();
  const answerCommandId = ids.nextCommandId();
  const analysisCommandId = ids.nextCommandId();
  try {
    await assert.rejects(
      initial.application.submit({
        commandId: answerCommandId,
        interactionAction: 'ANSWER_ONLY',
        admittedUserContent: 'Return one bounded answer.',
      }),
      /Injected interrupted Answer-only delivery/u,
    );
    await assert.rejects(
      initial.application.submit({
        commandId: analysisCommandId,
        interactionAction: 'MATERIALIZE_ONLY',
        admittedUserContent: 'Create one bounded Goal.',
      }),
      /Injected interrupted Intake analysis/u,
    );
    assert.equal(interruptedAssistant.answerCalls, 1);
    assert.equal(interruptedAssistant.analyzeCalls, 1);
  } finally {
    initial.close();
  }

  const beforeRecovery = openSqliteControlStore({ filename: databasePath });
  const answerReservation = beforeRecovery.getIntakeCommandReservation(answerCommandId);
  const analysisReservation = beforeRecovery.getIntakeCommandReservation(analysisCommandId);
  assert.ok(answerReservation);
  assert.ok(analysisReservation);
  assert.equal(beforeRecovery.getIntakeCommandOutcome(answerCommandId), undefined);
  assert.equal(beforeRecovery.getIntakeCommandOutcome(analysisCommandId), undefined);
  beforeRecovery.close();

  const recoveryAssistant = new RecoveryNoCallAssistant();
  const reopened = createIntakeCliComposition({
    dataHomePath,
    protectedPaths: [],
    allowedProjectPaths: [],
    assistant: recoveryAssistant,
  });
  try {
    assert.deepEqual(reopened.intakeRecovery, {
      scanned: 2,
      reconciledAnalysisFailures: 1,
      reconciledAnswerFailures: 1,
    });
    assert.equal(recoveryAssistant.answerCalls, 0);
    assert.equal(recoveryAssistant.analyzeCalls, 0);

    const answerStatus = reopened.application.getStatus(answerReservation.intakeRunId);
    assert.equal(answerStatus?.status, 'NO_EXECUTION');
    assert.equal(answerStatus.answerOnlyResponse?.failureReasonCode, 'INTERRUPTED_ANSWER_DELIVERY');
    const analysisStatus = reopened.application.getStatus(analysisReservation.intakeRunId);
    assert.equal(analysisStatus?.status, 'FAILED');
    assert.equal(analysisStatus.failure.reasonCode, 'INTERRUPTED_ANALYSIS');
  } finally {
    reopened.close();
  }

  const retained = openSqliteControlStore({ filename: databasePath });
  try {
    assert.equal(retained.listOrphanedIntakeRunIds().length, 0);
    assert.equal(retained.getIntakeCommandOutcome(answerCommandId)?.disposition, 'APPLIED');
    assert.equal(retained.getIntakeCommandOutcome(analysisCommandId)?.disposition, 'FAILED');
  } finally {
    retained.close();
  }
});

void test('explicit materialize-only and governed-execution keep Goal and Start dispositions separate', async (t) => {
  const root = temporaryRoot(t);
  const projectPath = join(root, 'project');
  mkdirSync(projectPath, { mode: 0o700 });
  const ids = new CryptographicIdentityGenerator();

  for (const expected of [
    { action: 'materialize-only', startDisposition: 'NOT_AUTHORIZED' },
    { action: 'governed-execution', startDisposition: 'START_COMMAND_APPLIED' },
  ] as const) {
    const assistant = new ExactMaterializationAssistant();
    const dataHomePath = join(root, expected.action);
    const composition = createIntakeCliComposition({
      dataHomePath,
      protectedPaths: [{ kind: 'PROJECT', path: projectPath }],
      allowedProjectPaths: [projectPath],
      assistant,
    });
    try {
      const parsed = parseCliInvocation([
        'intake',
        'submit',
        '--action',
        expected.action,
        '--request',
        'Ship slice 7',
        '--project',
        projectPath,
      ]);
      assert.equal(parsed.operation, CliOperation.INTAKE_SUBMIT);
      const submitted = await executeIntakeSubmit({
        application: composition.application,
        commandId: ids.nextCommandId(),
        invocation: parsed,
        projectPath,
      });
      assert.equal(submitted.result.kind, 'OUTCOME', JSON.stringify(submitted));
      assert.equal(submitted.result.outcome.result.kind, 'MATERIALIZED');
      assert.equal(
        submitted.result.outcome.result.materializationDisposition,
        'MATERIALIZED_READY',
      );
      assert.equal(submitted.result.startDisposition, expected.startDisposition);
      assert.equal(exitCodeForCliEnvelope(submitted), 0);
      assert.equal(assistant.analyzeCalls, 1);

      if (expected.action === 'governed-execution') {
        for (const classification of [
          { startDisposition: 'START_COMMAND_APPLIED', exitCode: CliExitCode.SUCCESS },
          { startDisposition: 'START_COMMAND_REJECTED', exitCode: CliExitCode.REJECTED },
          { startDisposition: 'READY_PENDING_START', exitCode: CliExitCode.GOVERNED_STOP },
          {
            startDisposition: 'START_INFRASTRUCTURE_FAILURE',
            exitCode: CliExitCode.INTERNAL,
          },
        ] as const) {
          assert.equal(
            exitCodeForCliEnvelope({
              ...submitted,
              result: { ...submitted.result, startDisposition: classification.startDisposition },
            }),
            classification.exitCode,
          );
        }
        assert.equal(
          exitCodeForCliEnvelope({
            ...submitted,
            result: { kind: 'VERSION_CONFLICT', message: 'stale Intake version' },
          }),
          CliExitCode.REJECTED,
        );
        assert.equal(
          exitCodeForCliEnvelope({
            ...submitted,
            result: {
              kind: 'IN_PROGRESS',
              intakeRunId: submitted.result.outcome.intakeRunId,
              intakeRunVersion: submitted.result.outcome.observedIntakeRunVersion,
              operationKind: 'INTENT_ANALYSIS',
            },
          }),
          CliExitCode.GOVERNED_STOP,
        );
      }

      const status = executeIntakeStatus(
        composition.application,
        submitted.result.outcome.intakeRunId,
      );
      assert.equal(status.result.status, 'FOUND');
      assert.equal(status.result.view.status, 'MATERIALIZED');
      assert.equal(status.result.view.startDisposition, expected.startDisposition);
      assert.match(renderCliEnvelopeHuman(status), /Materialization digest: sha256:/);
    } finally {
      composition.close();
    }
  }
});

void test('governed read-only repository investigation is never classified as Answer-only', async (t) => {
  const root = temporaryRoot(t);
  const projectPath = join(root, 'project');
  mkdirSync(projectPath, { mode: 0o700 });
  const assistant = new ExactMaterializationAssistant();
  const composition = createIntakeCliComposition({
    dataHomePath: join(root, 'authority'),
    protectedPaths: [{ kind: 'PROJECT', path: projectPath }],
    allowedProjectPaths: [projectPath],
    assistant,
  });
  try {
    const invocation = parseCliInvocation([
      'intake',
      'submit',
      '--action',
      'governed-execution',
      '--request',
      'Ship slice 7 by inspecting the repository read-only',
      '--project',
      projectPath,
    ]);
    assert.equal(invocation.operation, CliOperation.INTAKE_SUBMIT);
    const submitted = await executeIntakeSubmit({
      application: composition.application,
      commandId: new CryptographicIdentityGenerator().nextCommandId(),
      invocation,
      projectPath,
    });
    assert.equal(submitted.result.kind, 'OUTCOME', JSON.stringify(submitted));
    assert.equal(submitted.result.outcome.result.kind, 'MATERIALIZED');
    assert.equal(submitted.result.startDisposition, 'START_COMMAND_APPLIED');
    assert.equal('answerOnlyContent' in submitted.result, false);
    assert.equal(assistant.analyzeCalls, 1);
  } finally {
    composition.close();
  }
});
