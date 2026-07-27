import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';
import { z } from 'zod';

import {
  GuardOutcome,
  WorkflowPhase,
  applyWorkflowEvent,
  auditEventId,
  commandId,
  createGoal,
  createWorkflow,
  decideWorkflow,
  goalId,
  goalRevision,
  isoTimestamp,
  requiredGuardsForTransition,
  sha256Digest,
  successCriterionId,
  workflowId,
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
  type CommitWorkflowEventInput,
  type CreateGoalWithWorkflowInput,
  type SqliteControlStore,
} from '@codeclosure/store-sqlite';

const createdAt = isoTimestamp('2026-07-27T00:00:00.000Z');
const transitionedAt = isoTimestamp('2026-07-27T00:00:00.001Z');

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
    ['0001_initial_control_store.sql'],
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
  const steps: readonly TransactionStep[] = Object.values(TransactionStep);

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
