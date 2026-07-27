import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';
import { z } from 'zod';

import {
  AttemptInterruptionReason,
  AttemptStatus,
  GuardOutcome,
  RunStatus,
  WorkflowPhase,
  applyAttemptEvent,
  applyWorkflowEvent,
  attemptId,
  auditEventId,
  commandId,
  createGoal,
  createWorkflow,
  decideAttempt,
  decideWorkflow,
  goalId,
  goalRevision,
  isoTimestamp,
  requiredGuardsForTransition,
  sha256Digest,
  successCriterionId,
  workflowId,
  type Attempt,
  type AttemptDecision,
  type AttemptEvent,
  type Goal,
  type GuardResult,
  type Sha256Digest,
  type WorkflowDecision,
  type WorkflowEvent,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CommandIdConflictError,
  MigrationIntegrityError,
  OptimisticConcurrencyError,
  PersistenceDecodeError,
  TransactionStep,
  openSqliteControlStore,
  type CommitAttemptEventInput,
  type CommitWorkflowEventInput,
  type CreateGoalWithWorkflowInput,
  type SqliteControlStore,
} from '@codeclosure/store-sqlite';

const createdAt = isoTimestamp('2026-07-27T00:00:00.000Z');
const transitionedAt = isoTimestamp('2026-07-27T00:00:00.001Z');
const attemptStartedAt = isoTimestamp('2026-07-27T00:00:00.002Z');
const attemptFinishedAt = isoTimestamp('2026-07-27T00:00:00.003Z');

function digest(character: string): Sha256Digest {
  return sha256Digest(`sha256:${character.repeat(64)}`);
}

function temporaryDatabase(t: TestContext, name = 'state.sqlite'): string {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-store-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, name);
}

function goalAndWorkflow(namespace: string): {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
} {
  const goal = createGoal({
    id: goalId(`goal_${namespace}`),
    revision: goalRevision(1),
    objective: `Prove transactional control for ${namespace}`,
    successCriteria: [
      {
        id: successCriterionId(`criterion_${namespace}`),
        description: 'State and audit commit together',
        required: true,
      },
    ],
    scope: {
      projectPath: `/fixture/${namespace}`,
      allowedPaths: ['src/**'],
    },
    nonGoals: ['real worker execution'],
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId(`workflow_${namespace}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  return { goal, workflow };
}

function creationInput(namespace: string): CreateGoalWithWorkflowInput {
  const { goal, workflow } = goalAndWorkflow(namespace);
  return {
    commandId: commandId(`command_create-${namespace}`),
    inputDigest: digest('a'),
    goal,
    workflow,
    auditEventId: auditEventId(`audit_goal-${namespace}`),
    workflowAuditEventId: auditEventId(`audit_workflow-${namespace}`),
    payloadDigest: digest('b'),
    correlationId: `correlation-${namespace}`,
    outcome: {
      schemaVersion: 1,
      ok: true,
      goalId: goal.id,
      workflowVersion: workflow.version,
    },
  };
}

function acceptedEvent(decision: WorkflowDecision): WorkflowEvent {
  if (!decision.accepted) {
    assert.fail(`Expected accepted workflow event, received ${decision.rejection.code}`);
  }
  return decision.events[0];
}

function acceptedAttemptEvent(decision: AttemptDecision): AttemptEvent {
  if (!decision.accepted) {
    assert.fail(`Expected accepted Attempt event, received ${decision.rejection.code}`);
  }
  return decision.events[0];
}

function planGuardResults(): readonly GuardResult[] {
  const guards = requiredGuardsForTransition(WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN);
  if (guards === undefined) {
    assert.fail('DISCOVERY -> PLAN must be a legal transition');
  }
  return guards.map((guard) => ({
    guard,
    outcome: GuardOutcome.PASS,
    reasonCode: 'STORE_TEST_PROOF',
    supportingRefs: [`test:${guard.toLowerCase()}`],
  }));
}

function planEvent(workflow: WorkflowInstance, namespace: string): WorkflowEvent {
  return acceptedEvent(
    decideWorkflow(workflow, {
      type: 'REQUEST_PHASE_TRANSITION',
      commandId: commandId(`command_plan-${namespace}`),
      workflowId: workflow.id,
      expectedVersion: workflow.version,
      occurredAt: transitionedAt,
      reason: 'discovery proof is complete',
      requestedPhase: WorkflowPhase.PLAN,
      guardResults: planGuardResults(),
    }),
  );
}

function transitionInput(workflow: WorkflowInstance, namespace: string): CommitWorkflowEventInput {
  return {
    inputDigest: digest('c'),
    event: planEvent(workflow, namespace),
    auditEventId: auditEventId(`audit_plan-${namespace}`),
    payloadDigest: digest('d'),
    causationId: `cause-${namespace}`,
    outcome: {
      schemaVersion: 1,
      ok: true,
      phase: WorkflowPhase.PLAN,
      workflowVersion: 2,
    },
  };
}

function beginAttemptInput(workflow: WorkflowInstance, namespace: string): CommitAttemptEventInput {
  const event = acceptedAttemptEvent(
    decideAttempt(workflow, undefined, {
      type: 'BEGIN_ATTEMPT',
      commandId: commandId(`command_begin-${namespace}`),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: attemptId(`attempt_${namespace}`),
      sequence: 1,
      occurredAt: attemptStartedAt,
    }),
  );
  return {
    inputDigest: digest('f'),
    event,
    auditEventId: auditEventId(`audit_attempt-begin-${namespace}`),
    workflowAuditEventId: auditEventId(`audit_workflow-begin-${namespace}`),
    payloadDigest: digest('1'),
    outcome: {
      schemaVersion: 1,
      ok: true,
      workflowVersion: event.toWorkflowVersion,
      runStatus: RunStatus.RUNNING,
    },
  };
}

function resultAttemptInput(
  workflow: WorkflowInstance,
  attempt: Attempt,
  namespace: string,
): CommitAttemptEventInput {
  const event = acceptedAttemptEvent(
    decideAttempt(workflow, attempt, {
      type: 'RECORD_ATTEMPT_RESULT',
      commandId: commandId(`command_result-${namespace}`),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: attempt.id,
      occurredAt: attemptFinishedAt,
      reason: 'worker result validated and routed',
    }),
  );
  return {
    inputDigest: digest('2'),
    event,
    auditEventId: auditEventId(`audit_attempt-result-${namespace}`),
    workflowAuditEventId: auditEventId(`audit_workflow-result-${namespace}`),
    payloadDigest: digest('3'),
    outcome: {
      schemaVersion: 1,
      ok: true,
      workflowVersion: event.toWorkflowVersion,
      runStatus: RunStatus.READY,
    },
  };
}

function recoveryInterruptionInput(
  workflow: WorkflowInstance,
  attempt: Attempt,
  namespace: string,
): CommitAttemptEventInput {
  const event = acceptedAttemptEvent(
    decideAttempt(workflow, attempt, {
      type: 'INTERRUPT_ATTEMPT',
      commandId: commandId(`command_recover-${namespace}`),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: attempt.id,
      interruptionReason: AttemptInterruptionReason.RECOVERY_RECONCILIATION,
      resultingRunStatus: RunStatus.BLOCKED,
      occurredAt: attemptFinishedAt,
      reason: 'restart cannot prove the previous worker is still controlled',
    }),
  );
  return {
    inputDigest: digest('6'),
    event,
    auditEventId: auditEventId(`audit_attempt-recover-${namespace}`),
    workflowAuditEventId: auditEventId(`audit_workflow-recover-${namespace}`),
    payloadDigest: digest('7'),
    outcome: {
      schemaVersion: 1,
      ok: true,
      workflowVersion: event.toWorkflowVersion,
      runStatus: RunStatus.BLOCKED,
    },
  };
}

function cancellationInput(
  workflow: WorkflowInstance,
  namespace: string,
): CommitWorkflowEventInput {
  const event = acceptedEvent(
    decideWorkflow(workflow, {
      type: 'CANCEL_WORKFLOW',
      commandId: commandId(`command_cancel-${namespace}`),
      workflowId: workflow.id,
      expectedVersion: workflow.version,
      occurredAt: attemptFinishedAt,
      reason: 'user cancelled the workflow',
    }),
  );
  return {
    inputDigest: digest('4'),
    event,
    auditEventId: auditEventId(`audit_workflow-cancel-${namespace}`),
    ...(event.type === 'WORKFLOW_CANCELLED' && event.interruptedAttemptId !== undefined
      ? { attemptAuditEventId: auditEventId(`audit_attempt-cancel-${namespace}`) }
      : {}),
    payloadDigest: digest('5'),
    outcome: {
      schemaVersion: 1,
      ok: true,
      workflowVersion: event.toVersion,
      runStatus: RunStatus.CANCELLED,
    },
  };
}

function seed(store: SqliteControlStore, namespace: string): CreateGoalWithWorkflowInput {
  const input = creationInput(namespace);
  const result = store.createGoalWithWorkflow(input);
  assert.equal(result.status, 'APPLIED');
  return input;
}

void test('[I-006][I-009] ordered migration creates the complete control schema and reopens', (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());

  assert.deepEqual(
    store.appliedMigrations().map((migration) => migration.name),
    ['0001_initial_control_store.sql', '0002_workflow_owned_attempt_lifecycle.sql'],
  );
  store.close();

  const database = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => {
    if (database.open) {
      database.close();
    }
  });
  const tableRowSchema = z.object({ name: z.string() });
  const tableNames = new Set(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
      .all()
      .map((row) => tableRowSchema.parse(row).name),
  );
  for (const requiredTable of [
    'schema_migrations',
    'goals',
    'goal_criteria',
    'workflows',
    'attempts',
    'candidate_generations',
    'context_manifests',
    'facts',
    'human_decisions',
    'policy_bundles',
    'verification_obligations',
    'evidence_records',
    'evidence_eligibility',
    'pending_issues',
    'acceptance_input_manifests',
    'acceptance_decisions',
    'processed_commands',
    'audit_events',
  ]) {
    assert.equal(tableNames.has(requiredTable), true, `${requiredTable} must exist`);
  }
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0);
  database.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.equal(reopened.appliedMigrations()[0]?.appliedAt, createdAt);
});

void test('[I-006][I-008][I-009] Goal, Workflow, command outcome, and audit survive reopen', (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'reopen');
  const transition = transitionInput(creation.workflow, 'reopen');
  const result = store.commitWorkflowEvent(transition);

  assert.equal(result.status, 'APPLIED');
  assert.equal(result.value.phase, WorkflowPhase.PLAN);
  assert.equal(result.value.version, 2);
  store.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getGoal(creation.goal.id), creation.goal);
  assert.equal(reopened.getWorkflow(creation.workflow.id)?.phase, WorkflowPhase.PLAN);
  assert.equal(reopened.getWorkflow(creation.workflow.id)?.version, 2);
  assert.deepEqual(
    reopened.getProcessedCommand(transition.event.commandId)?.outcome,
    transition.outcome,
  );
  assert.equal(reopened.listAuditEvents('GOAL', creation.goal.id).length, 1);
  assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 2);
});

void test('[I-008] duplicate command delivery replays one outcome without replaying effects', (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'duplicate');
  const transition = transitionInput(creation.workflow, 'duplicate');

  const first = store.commitWorkflowEvent(transition);
  const duplicate = store.commitWorkflowEvent(transition);

  assert.equal(first.status, 'APPLIED');
  assert.equal(duplicate.status, 'REPLAYED');
  assert.deepEqual(duplicate.outcome, transition.outcome);
  assert.equal(store.getWorkflow(creation.workflow.id)?.version, 2);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 2);

  assert.throws(
    () => store.commitWorkflowEvent({ ...transition, inputDigest: digest('e') }),
    CommandIdConflictError,
  );
});

void test('[I-008] a stale workflow event writes no state, audit, or command outcome', (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'stale');
  const first = transitionInput(creation.workflow, 'stale-first');
  store.commitWorkflowEvent(first);

  const stale = transitionInput(creation.workflow, 'stale-second');
  assert.throws(() => store.commitWorkflowEvent(stale), OptimisticConcurrencyError);

  assert.equal(store.getWorkflow(creation.workflow.id)?.version, 2);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 2);
  assert.equal(store.getProcessedCommand(stale.event.commandId), undefined);
});

void test('[I-008] injected failure after every transaction step rolls back all writes', async (t) => {
  const steps = Object.values(TransactionStep).filter(
    (step) => step !== TransactionStep.AFTER_ATTEMPT_STATE_WRITE,
  );

  for (const step of steps) {
    await t.test(step, (subtest) => {
      const filename = temporaryDatabase(subtest, `${step.toLowerCase()}.sqlite`);
      const baseline = openSqliteControlStore({ filename, now: () => createdAt });
      const creation = seed(baseline, `atomic-${step.toLowerCase().replaceAll('_', '-')}`);
      const transition = transitionInput(
        creation.workflow,
        `atomic-${step.toLowerCase().replaceAll('_', '-')}`,
      );
      baseline.close();

      const failing = openSqliteControlStore({
        filename,
        now: () => createdAt,
        transactionProbe: (observedStep) => {
          if (observedStep === step) {
            throw new Error(`injected failure at ${step}`);
          }
        },
      });
      assert.throws(() => failing.commitWorkflowEvent(transition), /injected failure/);
      failing.close();

      const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
      subtest.after(() => reopened.close());
      assert.equal(reopened.getWorkflow(creation.workflow.id)?.phase, WorkflowPhase.DISCOVERY);
      assert.equal(reopened.getWorkflow(creation.workflow.id)?.version, 1);
      assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 1);
      assert.equal(reopened.getProcessedCommand(transition.event.commandId), undefined);
    });
  }
});

void test('[I-006] an applied migration cannot be silently edited', (t) => {
  const filename = temporaryDatabase(t, 'migration.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-migrations-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const migrationPath = join(migrationsDirectory, '0001_fixture.sql');
  writeFileSync(migrationPath, 'CREATE TABLE fixture(id TEXT PRIMARY KEY) STRICT;\n', 'utf8');

  const store = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  store.close();
  writeFileSync(
    migrationPath,
    `${readFileSync(migrationPath, 'utf8')}-- modified after application\n`,
    'utf8',
  );

  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => transitionedAt,
      }),
    MigrationIntegrityError,
  );
});

void test('[I-008] a failing migration leaves no partial schema or success record', (t) => {
  const filename = temporaryDatabase(t, 'failed-migration.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-bad-migrations-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  writeFileSync(
    join(migrationsDirectory, '0001_broken.sql'),
    'CREATE TABLE should_rollback(id TEXT PRIMARY KEY) STRICT;\nTHIS IS NOT SQL;\n',
    'utf8',
  );

  assert.throws(() =>
    openSqliteControlStore({
      filename,
      migrationsDirectory,
      now: () => createdAt,
    }),
  );

  const database = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => database.close());
  const tableCountSchema = z.object({ count: z.number().int().nonnegative() });
  const row = tableCountSchema.parse(
    database
      .prepare(
        "SELECT count(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN (?, ?)",
      )
      .get('should_rollback', 'schema_migrations'),
  );
  assert.equal(row.count, 0);
});

void test('[I-006] persistence decoding rejects corrupt authoritative rows', (t) => {
  const filename = temporaryDatabase(t, 'corrupt.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'corrupt');
  store.close();

  const database = new Database(filename);
  database.pragma('ignore_check_constraints = ON');
  database
    .prepare('UPDATE workflows SET phase = ? WHERE id = ?')
    .run('IMPOSSIBLE', creation.workflow.id);
  database.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.throws(() => reopened.getWorkflow(creation.workflow.id), PersistenceDecodeError);
});

void test('[I-006] database triggers keep audit history immutable', (t) => {
  const filename = temporaryDatabase(t, 'immutable.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'immutable');
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  assert.throws(
    () =>
      database
        .prepare('UPDATE audit_events SET event_type = ? WHERE aggregate_id = ?')
        .run('REWRITTEN', creation.workflow.id),
    /immutable/,
  );
  assert.throws(
    () =>
      database.prepare('DELETE FROM audit_events WHERE aggregate_id = ?').run(creation.workflow.id),
    /immutable/,
  );
});

void test('[I-008] stored transition state equals the pure domain event result', (t) => {
  const filename = temporaryDatabase(t, 'reducer.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'reducer-store');
  const transition = transitionInput(creation.workflow, 'reducer-store');
  const expected = applyWorkflowEvent(creation.workflow, transition.event);

  store.commitWorkflowEvent(transition);

  assert.deepEqual(store.getWorkflow(creation.workflow.id), expected);
});

void test('[I-006][I-008][I-009] Attempt start and result survive restart as one Workflow history', (t) => {
  const filename = temporaryDatabase(t, 'attempt-reopen.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'attempt-reopen');
  const beginInput = beginAttemptInput(creation.workflow, 'attempt-reopen');
  const began = store.commitAttemptEvent(beginInput);
  assert.equal(began.status, 'APPLIED');
  assert.equal(began.value.workflow.runStatus, RunStatus.RUNNING);
  assert.equal(began.value.workflow.version, 2);
  assert.equal(began.value.attempt.status, AttemptStatus.RUNNING);

  const resultInput = resultAttemptInput(
    began.value.workflow,
    began.value.attempt,
    'attempt-reopen',
  );
  const expected = applyAttemptEvent(began.value.workflow, began.value.attempt, resultInput.event);
  const finished = store.commitAttemptEvent(resultInput);
  assert.equal(finished.status, 'APPLIED');
  assert.deepEqual(finished.value, expected);
  store.close();

  const reopened = openSqliteControlStore({ filename, now: () => attemptFinishedAt });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getWorkflow(creation.workflow.id), expected.workflow);
  assert.deepEqual(reopened.getAttempt(expected.attempt.id), expected.attempt);
  assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
  assert.equal(reopened.listAuditEvents('ATTEMPT', expected.attempt.id).length, 2);
  assert.deepEqual(
    reopened.getProcessedCommand(resultInput.event.commandId)?.outcome,
    resultInput.outcome,
  );
});

void test('[I-009][I-027] restart reconciles a persisted RUNNING Attempt before replacement work', (t) => {
  const filename = temporaryDatabase(t, 'attempt-recovery.sqlite');
  const initial = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(initial, 'attempt-recovery');
  const began = initial.commitAttemptEvent(
    beginAttemptInput(creation.workflow, 'attempt-recovery'),
  );
  assert.equal(began.status, 'APPLIED');
  initial.close();

  const recovered = openSqliteControlStore({ filename, now: () => attemptFinishedAt });
  t.after(() => recovered.close());
  const runningWorkflow = recovered.getWorkflow(creation.workflow.id);
  const runningAttempt = recovered.getAttempt(began.value.attempt.id);
  if (runningWorkflow === undefined || runningAttempt === undefined) {
    assert.fail('Restart must recover the persisted Workflow and Attempt');
  }
  assert.equal(runningWorkflow.runStatus, RunStatus.RUNNING);
  assert.equal(runningAttempt.status, AttemptStatus.RUNNING);

  const interruption = recoveryInterruptionInput(
    runningWorkflow,
    runningAttempt,
    'attempt-recovery',
  );
  const reconciled = recovered.commitAttemptEvent(interruption);

  assert.equal(reconciled.status, 'APPLIED');
  assert.equal(reconciled.value.workflow.runStatus, RunStatus.BLOCKED);
  assert.equal(reconciled.value.workflow.activeAttemptId, undefined);
  assert.equal(reconciled.value.attempt.status, AttemptStatus.INTERRUPTED);
  assert.equal(reconciled.value.workflow.version, 3);
});

void test('[I-008][I-010] cancellation atomically interrupts the active Attempt without closing', (t) => {
  const filename = temporaryDatabase(t, 'attempt-cancel.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'attempt-cancel');
  const began = store.commitAttemptEvent(beginAttemptInput(creation.workflow, 'attempt-cancel'));
  assert.equal(began.status, 'APPLIED');
  const cancellation = cancellationInput(began.value.workflow, 'attempt-cancel');

  const cancelled = store.commitWorkflowEvent(cancellation);

  assert.equal(cancelled.status, 'APPLIED');
  assert.equal(cancelled.value.runStatus, RunStatus.CANCELLED);
  assert.notEqual(cancelled.value.runStatus, RunStatus.CLOSED);
  assert.equal(cancelled.value.activeAttemptId, undefined);
  const attempt = store.getAttempt(began.value.attempt.id);
  assert.equal(attempt?.status, AttemptStatus.INTERRUPTED);
  assert.match(attempt.terminationReason ?? '', /^WORKFLOW_CANCELLED:/);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
  assert.equal(store.listAuditEvents('ATTEMPT', began.value.attempt.id).length, 2);
});

void test('[I-008] active cancellation requires both Workflow and Attempt audit identities', (t) => {
  const filename = temporaryDatabase(t, 'cancel-audit-required.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'cancel-audit-required');
  const began = store.commitAttemptEvent(
    beginAttemptInput(creation.workflow, 'cancel-audit-required'),
  );
  assert.equal(began.status, 'APPLIED');
  const cancellation = cancellationInput(began.value.workflow, 'cancel-audit-required');
  const missingAttemptAudit: CommitWorkflowEventInput = {
    inputDigest: cancellation.inputDigest,
    event: cancellation.event,
    auditEventId: cancellation.auditEventId,
    payloadDigest: cancellation.payloadDigest,
    outcome: cancellation.outcome,
  };

  assert.throws(
    () => store.commitWorkflowEvent(missingAttemptAudit),
    /requires an Attempt audit event ID/,
  );
  assert.equal(store.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.RUNNING);
  assert.equal(store.getAttempt(began.value.attempt.id)?.status, AttemptStatus.RUNNING);
  assert.equal(store.getProcessedCommand(cancellation.event.commandId), undefined);
});

void test('[I-008] result/cancellation races persist exactly one winner at a shared version', async (t) => {
  await t.test('result wins', (subtest) => {
    const filename = temporaryDatabase(subtest, 'result-wins.sqlite');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    subtest.after(() => store.close());
    const creation = seed(store, 'result-wins');
    const began = store.commitAttemptEvent(beginAttemptInput(creation.workflow, 'result-wins'));
    assert.equal(began.status, 'APPLIED');
    const result = resultAttemptInput(began.value.workflow, began.value.attempt, 'result-wins');
    const cancellation = cancellationInput(began.value.workflow, 'result-wins');

    store.commitAttemptEvent(result);
    assert.throws(() => store.commitWorkflowEvent(cancellation), OptimisticConcurrencyError);

    assert.equal(store.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.READY);
    assert.equal(store.getAttempt(began.value.attempt.id)?.status, AttemptStatus.RESULT_RECORDED);
    assert.equal(store.getProcessedCommand(cancellation.event.commandId), undefined);
    assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
    assert.equal(store.listAuditEvents('ATTEMPT', began.value.attempt.id).length, 2);
  });

  await t.test('cancellation wins', (subtest) => {
    const filename = temporaryDatabase(subtest, 'cancellation-wins.sqlite');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    subtest.after(() => store.close());
    const creation = seed(store, 'cancellation-wins');
    const began = store.commitAttemptEvent(
      beginAttemptInput(creation.workflow, 'cancellation-wins'),
    );
    assert.equal(began.status, 'APPLIED');
    const result = resultAttemptInput(
      began.value.workflow,
      began.value.attempt,
      'cancellation-wins',
    );
    const cancellation = cancellationInput(began.value.workflow, 'cancellation-wins');

    store.commitWorkflowEvent(cancellation);
    assert.throws(() => store.commitAttemptEvent(result), OptimisticConcurrencyError);

    assert.equal(store.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.CANCELLED);
    assert.equal(store.getAttempt(began.value.attempt.id)?.status, AttemptStatus.INTERRUPTED);
    assert.equal(store.getProcessedCommand(result.event.commandId), undefined);
    assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
    assert.equal(store.listAuditEvents('ATTEMPT', began.value.attempt.id).length, 2);
  });
});

void test('[I-008] injected failure rolls back Attempt, Workflow, audit, and command outcome', async (t) => {
  const steps: readonly TransactionStep[] = Object.values(TransactionStep);

  for (const step of steps) {
    await t.test(step, (subtest) => {
      const suffix = `attempt-atomic-${step.toLowerCase().replaceAll('_', '-')}`;
      const filename = temporaryDatabase(subtest, `${suffix}.sqlite`);
      const baseline = openSqliteControlStore({ filename, now: () => createdAt });
      const creation = seed(baseline, suffix);
      const began = baseline.commitAttemptEvent(beginAttemptInput(creation.workflow, suffix));
      assert.equal(began.status, 'APPLIED');
      const result = resultAttemptInput(began.value.workflow, began.value.attempt, suffix);
      baseline.close();

      const failing = openSqliteControlStore({
        filename,
        now: () => createdAt,
        transactionProbe: (observedStep) => {
          if (observedStep === step) {
            throw new Error(`injected Attempt failure at ${step}`);
          }
        },
      });
      assert.throws(() => failing.commitAttemptEvent(result), /injected Attempt failure/);
      failing.close();

      const reopened = openSqliteControlStore({ filename, now: () => attemptFinishedAt });
      subtest.after(() => reopened.close());
      assert.equal(reopened.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.RUNNING);
      assert.equal(reopened.getWorkflow(creation.workflow.id)?.version, 2);
      assert.equal(reopened.getAttempt(began.value.attempt.id)?.status, AttemptStatus.RUNNING);
      assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 2);
      assert.equal(reopened.listAuditEvents('ATTEMPT', began.value.attempt.id).length, 1);
      assert.equal(reopened.getProcessedCommand(result.event.commandId), undefined);
    });
  }
});

void test('[I-006][I-008] database rejects a second running Attempt and terminal rewrites', (t) => {
  const filename = temporaryDatabase(t, 'attempt-db-guards.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'attempt-db-guards');
  const began = store.commitAttemptEvent(beginAttemptInput(creation.workflow, 'attempt-db-guards'));
  assert.equal(began.status, 'APPLIED');
  const result = resultAttemptInput(began.value.workflow, began.value.attempt, 'attempt-db-guards');
  store.commitAttemptEvent(result);
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  assert.throws(
    () =>
      database
        .prepare('UPDATE attempts SET termination_reason = ? WHERE id = ?')
        .run('rewritten history', began.value.attempt.id),
    /terminal Attempt is immutable/,
  );

  const insertRunning = database.prepare(
    `INSERT INTO attempts(
       id, workflow_id, phase, sequence, context_manifest_id, capability_grant_json,
       worker_session_ref, status, failure_class, termination_reason, started_at, ended_at
     )
     SELECT ?, workflow_id, phase, ?, NULL, capability_grant_json,
            NULL, 'RUNNING', NULL, NULL, ?, NULL
       FROM attempts
      WHERE id = ?`,
  );
  insertRunning.run(
    attemptId('attempt_db-guard-running-1'),
    2,
    attemptFinishedAt,
    began.value.attempt.id,
  );
  assert.throws(
    () =>
      insertRunning.run(
        attemptId('attempt_db-guard-running-2'),
        3,
        attemptFinishedAt,
        began.value.attempt.id,
      ),
    /UNIQUE constraint failed: attempts.workflow_id/,
  );
});
