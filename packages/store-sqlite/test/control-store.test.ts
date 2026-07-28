import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';
import { z } from 'zod';

import {
  AttemptInterruptionReason,
  AttemptFailureClass,
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
  deriveCapabilityGrant,
  goalId,
  goalRevision,
  isoTimestamp,
  requiredGuardsForTransition,
  sha256Digest,
  successCriterionId,
  workflowId,
  workflowVersion,
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
  MigrationIntegrityError,
  PersistenceDecodeError,
  TransactionStep,
  defaultMigrationsDirectory,
  openSqliteControlStore,
  type CommitAttemptEventInput,
  type CommitWorkflowEventInput,
  type CreateGoalWithWorkflowInput,
  type SqliteControlStore,
} from '@codeclosure/store-sqlite';
import {
  RuntimeErrorCode,
  createRejectedStoredCommandOutcome,
  createGoalApplication,
  decodeStoredCommandOutcome,
  StoredCommandDisposition,
  storedCommandOutcomeToJson,
  type Clock,
  type CommandTarget,
  type DigestProvider,
  type GoalApplication,
  type IdGenerator,
} from '@codeclosure/runtime';
import { assertWorkflowControlStoreContract } from '@codeclosure/testing';

const createdAt = isoTimestamp('2026-07-27T00:00:00.000Z');
const transitionedAt = isoTimestamp('2026-07-27T00:00:00.001Z');
const attemptStartedAt = isoTimestamp('2026-07-27T00:00:00.002Z');
const attemptFinishedAt = isoTimestamp('2026-07-27T00:00:00.003Z');
const afterCancellationAt = isoTimestamp('2026-07-27T00:00:00.004Z');

function digest(character: string): Sha256Digest {
  return sha256Digest(`sha256:${character.repeat(64)}`);
}

function expectedAppliedOutcome(
  target: CommandTarget,
  commandIdentifier: ReturnType<typeof commandId>,
  workflow: WorkflowInstance,
) {
  return {
    schemaVersion: 3,
    disposition: StoredCommandDisposition.APPLIED,
    target,
    goalId: workflow.goalId,
    workflow: {
      id: workflow.id,
      version: workflow.version,
      phase: workflow.phase,
      runStatus: workflow.runStatus,
    },
    output: {
      schemaVersion: 1,
      commandId: commandIdentifier,
      ok: true,
      goalId: workflow.goalId,
      workflowVersion: workflow.version,
      phase: workflow.phase,
      runStatus: workflow.runStatus,
    },
  } as const;
}

function legacyV2AppliedOutcome(
  target: CommandTarget,
  commandIdentifier: ReturnType<typeof commandId>,
  workflow: WorkflowInstance,
) {
  return {
    schemaVersion: 2,
    target,
    goalId: workflow.goalId,
    output: {
      schemaVersion: 1,
      commandId: commandIdentifier,
      ok: true,
      goalId: workflow.goalId,
      workflowVersion: workflow.version,
      phase: workflow.phase,
      runStatus: workflow.runStatus,
    },
  } as const;
}

function runtimeFor(
  store: SqliteControlStore,
  namespace: string,
  clockOverride?: Clock,
): GoalApplication {
  let idSequence = 0;
  let timeSequence = 10;
  const nextSuffix = (): string => {
    idSequence += 1;
    return `${namespace}-${String(idSequence).padStart(4, '0')}`;
  };
  const clock: Clock =
    clockOverride ??
    Object.freeze({
      now: () => {
        const timestamp = isoTimestamp(
          `2026-07-27T00:00:00.${String(timeSequence).padStart(3, '0')}Z`,
        );
        timeSequence += 1;
        return timestamp;
      },
    });
  const ids: IdGenerator = {
    nextAttemptId: () => attemptId(`attempt_${nextSuffix()}`),
    nextAuditEventId: () => auditEventId(`audit_${nextSuffix()}`),
  };
  const digests: DigestProvider = {
    digest: (value) =>
      sha256Digest(
        `sha256:${createHash('sha256').update(JSON.stringify({ value })).digest('hex')}`,
      ),
  };
  return createGoalApplication({ store, clock, ids, digests });
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

function insertRawGoalAndWorkflow(
  database: Database.Database,
  goal: Goal,
  workflow: WorkflowInstance,
): void {
  database
    .prepare(
      `INSERT INTO goals(
         id, revision, objective, project_path, allowed_paths_json, non_goals_json,
         status, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      goal.id,
      goal.revision,
      goal.objective,
      goal.scope.projectPath,
      JSON.stringify(goal.scope.allowedPaths),
      JSON.stringify(goal.nonGoals),
      goal.status,
      goal.createdAt,
      goal.updatedAt,
    );
  const insertCriterion = database.prepare(
    `INSERT INTO goal_criteria(goal_id, position, id, description, required)
     VALUES (?, ?, ?, ?, ?)`,
  );
  goal.successCriteria.forEach((criterion, position) => {
    insertCriterion.run(
      goal.id,
      position,
      criterion.id,
      criterion.description,
      criterion.required ? 1 : 0,
    );
  });
  database
    .prepare(
      `INSERT INTO workflows(
         id, goal_id, goal_revision, phase, run_status, version, active_attempt_id,
         active_candidate_generation_id, suspended_reason, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      workflow.id,
      workflow.goalId,
      workflow.goalRevision,
      workflow.phase,
      workflow.runStatus,
      workflow.version,
      workflow.createdAt,
      workflow.updatedAt,
    );
}

function creationInput(namespace: string): CreateGoalWithWorkflowInput {
  const { goal, workflow } = goalAndWorkflow(namespace);
  const commandIdentifier = commandId(`command_create-${namespace}`);
  return {
    commandId: commandIdentifier,
    inputDigest: digest('a'),
    goal,
    workflow,
    auditEventId: auditEventId(`audit_goal-${namespace}`),
    workflowAuditEventId: auditEventId(`audit_workflow-${namespace}`),
    payloadDigest: digest('b'),
    correlationId: `correlation-${namespace}`,
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
  const event = planEvent(workflow, namespace);
  const target = Object.freeze({ aggregateType: 'WORKFLOW' as const, aggregateId: workflow.id });
  return {
    inputDigest: digest('c'),
    target,
    event,
    auditEventId: auditEventId(`audit_plan-${namespace}`),
    payloadDigest: digest('d'),
    causationId: `cause-${namespace}`,
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
  const target = Object.freeze({ aggregateType: 'WORKFLOW' as const, aggregateId: workflow.id });
  return {
    inputDigest: digest('f'),
    target,
    event,
    auditEventId: auditEventId(`audit_attempt-begin-${namespace}`),
    workflowAuditEventId: auditEventId(`audit_workflow-begin-${namespace}`),
    payloadDigest: digest('1'),
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
  const target = Object.freeze({ aggregateType: 'WORKFLOW' as const, aggregateId: workflow.id });
  return {
    inputDigest: digest('2'),
    target,
    event,
    auditEventId: auditEventId(`audit_attempt-result-${namespace}`),
    workflowAuditEventId: auditEventId(`audit_workflow-result-${namespace}`),
    payloadDigest: digest('3'),
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
  const target = Object.freeze({ aggregateType: 'WORKFLOW' as const, aggregateId: workflow.id });
  return {
    inputDigest: digest('6'),
    target,
    event,
    auditEventId: auditEventId(`audit_attempt-recover-${namespace}`),
    workflowAuditEventId: auditEventId(`audit_workflow-recover-${namespace}`),
    payloadDigest: digest('7'),
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
  const target = Object.freeze({ aggregateType: 'GOAL' as const, aggregateId: workflow.goalId });
  return {
    inputDigest: digest('4'),
    target,
    event,
    auditEventId: auditEventId(`audit_workflow-cancel-${namespace}`),
    ...(event.type === 'WORKFLOW_CANCELLED' && event.interruptedAttemptId !== undefined
      ? { attemptAuditEventId: auditEventId(`audit_attempt-cancel-${namespace}`) }
      : {}),
    payloadDigest: digest('5'),
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
    [
      '0001_initial_control_store.sql',
      '0002_workflow_owned_attempt_lifecycle.sql',
      '0003_goal_projection_and_attempt_immutability.sql',
      '0004_attempt_lifecycle_shape_guard.sql',
      '0005_processed_command_outcome_binding.sql',
      '0006_store_authored_command_outcomes.sql',
      '0007_causal_control_time.sql',
      '0008_authority_boundary_validation.sql',
      '0009_context_worker_dispatch.sql',
      '0010_worker_authority_closure.sql',
      '0011_candidate_evidence_authority.sql',
      '0012_worker_failure_classification_closure.sql',
    ],
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
    'worker_dispatch_claims',
    'worker_event_receipts',
  ]) {
    assert.equal(tableNames.has(requiredTable), true, `${requiredTable} must exist`);
  }
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0);
  database.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.equal(reopened.appliedMigrations()[0]?.appliedAt, createdAt);
});

void test('[I-006][I-009] reopen refuses retained authority with a missing owner', (t) => {
  const filename = temporaryDatabase(t, 'orphaned-authority.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  store.close();

  const raw = new Database(filename);
  raw.pragma('foreign_keys = OFF');
  raw
    .prepare(
      `INSERT INTO attempts(
         id, workflow_id, phase, sequence, context_manifest_id,
         capability_grant_json, worker_session_ref, status, failure_class,
         termination_reason, started_at, ended_at
       ) VALUES (?, ?, 'DISCOVERY', 1, NULL, ?, NULL, 'RUNNING', NULL, NULL, ?, NULL)`,
    )
    .run(
      'attempt_orphaned-authority',
      'workflow_missing-owner',
      JSON.stringify(deriveCapabilityGrant(WorkflowPhase.DISCOVERY)),
      createdAt,
    );
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => transitionedAt }),
    /foreign-key integrity check/,
  );
});

void test('[I-006][I-027] migration timestamps are validated before schema authority commits', (t) => {
  const filename = temporaryDatabase(t, 'invalid-migration-clock.sqlite');
  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        now: () => '2026-07-27T00:00:00Z' as never,
      }),
    /IsoTimestamp/,
  );

  const database = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => database.close());
  assert.equal(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_migrations'")
      .get(),
    undefined,
  );
});

void test('[I-006][I-008] migration 0003 repairs an older divergent Goal lifecycle projection', (t) => {
  const filename = temporaryDatabase(t, 'projection-upgrade.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-upgrade-migrations-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of [
    '0001_initial_control_store.sql',
    '0002_workflow_owned_attempt_lifecycle.sql',
  ]) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }

  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const creation = seed(oldStore, 'projection-upgrade');
  const cancellation = cancellationInput(creation.workflow, 'projection-upgrade');
  oldStore.commitWorkflowEvent(cancellation);
  oldStore.close();

  const raw = new Database(filename, { readonly: true, fileMustExist: true });
  const statusSchema = z.object({ status: z.string() });
  assert.equal(
    statusSchema.parse(raw.prepare('SELECT status FROM goals WHERE id = ?').get(creation.goal.id))
      .status,
    'ACTIVE',
  );
  raw.close();

  const migrationName = '0003_goal_projection_and_attempt_immutability.sql';
  writeFileSync(
    join(migrationsDirectory, migrationName),
    readFileSync(join(sourceDirectory, migrationName), 'utf8'),
    'utf8',
  );
  const upgraded = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => transitionedAt,
  });
  t.after(() => upgraded.close());

  assert.equal(upgraded.getGoal(creation.goal.id)?.status, 'CANCELLED');
  assert.equal(upgraded.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.CANCELLED);
  assert.equal(upgraded.appliedMigrations().at(-1)?.name, migrationName);
});

void test('[I-006][I-008] migration 0004 refuses to bless an older poisoned Attempt', (t) => {
  const filename = temporaryDatabase(t, 'attempt-shape-upgrade.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-attempt-upgrade-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of [
    '0001_initial_control_store.sql',
    '0002_workflow_owned_attempt_lifecycle.sql',
    '0003_goal_projection_and_attempt_immutability.sql',
  ]) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }

  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const creation = seed(oldStore, 'attempt-shape-upgrade');
  const began = oldStore.commitAttemptEvent(
    beginAttemptInput(creation.workflow, 'attempt-shape-upgrade'),
  );
  assert.equal(began.status, 'APPLIED');
  oldStore.close();

  const raw = new Database(filename);
  raw
    .prepare('UPDATE attempts SET failure_class = ? WHERE id = ?')
    .run(AttemptFailureClass.UNKNOWN, began.value.attempt.id);
  raw.close();

  const migrationName = '0004_attempt_lifecycle_shape_guard.sql';
  writeFileSync(
    join(migrationsDirectory, migrationName),
    readFileSync(join(sourceDirectory, migrationName), 'utf8'),
    'utf8',
  );
  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => transitionedAt,
      }),
    /CHECK constraint failed/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  const appliedNames = inspected
    .prepare('SELECT name FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => z.object({ name: z.string() }).parse(row).name);
  assert.equal(appliedNames.includes(migrationName), false);
});

void test('[I-006][I-008][I-027] migration 0005 refuses ambiguous legacy command outcomes', (t) => {
  const filename = temporaryDatabase(t, 'command-outcome-upgrade.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-outcome-upgrade-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of [
    '0001_initial_control_store.sql',
    '0002_workflow_owned_attempt_lifecycle.sql',
    '0003_goal_projection_and_attempt_immutability.sql',
    '0004_attempt_lifecycle_shape_guard.sql',
  ]) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }

  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  oldStore.close();

  const creation = goalAndWorkflow('command-outcome-upgrade');
  const creationCommandId = commandId('command_create-command-outcome-upgrade');
  const legacyCommandId = commandId('command_legacy-outcome');
  const raw = new Database(filename);
  insertRawGoalAndWorkflow(raw, creation.goal, creation.workflow);
  const insertProcessedCommand = raw.prepare(
    `INSERT INTO processed_commands(
       command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
     ) VALUES (?, ?, 'GOAL', ?, ?, ?)`,
  );
  insertProcessedCommand.run(
    creationCommandId,
    digest('a'),
    creation.goal.id,
    JSON.stringify(
      legacyV2AppliedOutcome(
        { aggregateType: 'GOAL', aggregateId: creation.goal.id },
        creationCommandId,
        creation.workflow,
      ),
    ),
    createdAt,
  );
  insertProcessedCommand.run(
    legacyCommandId,
    digest('9'),
    creation.goal.id,
    JSON.stringify({
      schemaVersion: 1,
      commandId: legacyCommandId,
      ok: false,
      error: {
        code: RuntimeErrorCode.DOMAIN_REJECTED,
        message: 'legacy result has no aggregate binding',
        retryable: false,
        detailCode: 'LEGACY_RESULT',
      },
    }),
    transitionedAt,
  );
  raw.close();

  const migrationName = '0005_processed_command_outcome_binding.sql';
  writeFileSync(
    join(migrationsDirectory, migrationName),
    readFileSync(join(sourceDirectory, migrationName), 'utf8'),
    'utf8',
  );
  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => transitionedAt,
      }),
    /CHECK constraint failed/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  const appliedNames = inspected
    .prepare('SELECT name FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => z.object({ name: z.string() }).parse(row).name);
  assert.equal(appliedNames.includes(migrationName), false);
});

void test('[I-006][I-008][I-027] migration 0006 refuses identity-only version 2 outcomes', (t) => {
  const filename = temporaryDatabase(t, 'semantic-outcome-upgrade.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-semantic-upgrade-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of [
    '0001_initial_control_store.sql',
    '0002_workflow_owned_attempt_lifecycle.sql',
    '0003_goal_projection_and_attempt_immutability.sql',
    '0004_attempt_lifecycle_shape_guard.sql',
  ]) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }

  const preBindingStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  preBindingStore.close();

  const creation = goalAndWorkflow('semantic-outcome-upgrade');
  const creationCommandId = commandId('command_create-semantic-outcome-upgrade');
  const raw = new Database(filename);
  insertRawGoalAndWorkflow(raw, creation.goal, creation.workflow);
  raw
    .prepare(
      `INSERT INTO processed_commands(
         command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
       ) VALUES (?, ?, 'GOAL', ?, ?, ?)`,
    )
    .run(
      creationCommandId,
      digest('a'),
      creation.goal.id,
      JSON.stringify(
        legacyV2AppliedOutcome(
          { aggregateType: 'GOAL', aggregateId: creation.goal.id },
          creationCommandId,
          creation.workflow,
        ),
      ),
      createdAt,
    );
  raw.close();

  const identityMigration = '0005_processed_command_outcome_binding.sql';
  writeFileSync(
    join(migrationsDirectory, identityMigration),
    readFileSync(join(sourceDirectory, identityMigration), 'utf8'),
    'utf8',
  );
  const identityBound = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => transitionedAt,
  });
  assert.equal(identityBound.appliedMigrations().at(-1)?.name, identityMigration);
  identityBound.close();

  const semanticMigration = '0006_store_authored_command_outcomes.sql';
  writeFileSync(
    join(migrationsDirectory, semanticMigration),
    readFileSync(join(sourceDirectory, semanticMigration), 'utf8'),
    'utf8',
  );
  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => attemptStartedAt,
      }),
    /CHECK constraint failed/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  const appliedNames = inspected
    .prepare('SELECT name FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => z.object({ name: z.string() }).parse(row).name);
  assert.equal(appliedNames.includes(identityMigration), true);
  assert.equal(appliedNames.includes(semanticMigration), false);
});

void test('[I-006][I-008][I-027] migration 0007 refuses regressed current-state time', (t) => {
  const filename = temporaryDatabase(t, 'causal-time-upgrade.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-time-upgrade-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of [
    '0001_initial_control_store.sql',
    '0002_workflow_owned_attempt_lifecycle.sql',
    '0003_goal_projection_and_attempt_immutability.sql',
    '0004_attempt_lifecycle_shape_guard.sql',
    '0005_processed_command_outcome_binding.sql',
    '0006_store_authored_command_outcomes.sql',
  ]) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }

  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const creation = seed(oldStore, 'causal-time-upgrade');
  oldStore.close();

  const regressedAt = isoTimestamp('2026-07-26T23:59:59.999Z');
  const raw = new Database(filename);
  raw
    .prepare('UPDATE workflows SET updated_at = ? WHERE id = ?')
    .run(regressedAt, creation.workflow.id);
  raw.close();

  const migrationName = '0007_causal_control_time.sql';
  writeFileSync(
    join(migrationsDirectory, migrationName),
    readFileSync(join(sourceDirectory, migrationName), 'utf8'),
    'utf8',
  );
  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => transitionedAt,
      }),
    /CHECK constraint failed/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  const appliedNames = inspected
    .prepare('SELECT name FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => z.object({ name: z.string() }).parse(row).name);
  assert.equal(appliedNames.includes(migrationName), false);
});

void test('[I-006][I-008] migration 0008 refuses malformed retained authority atomically', (t) => {
  const filename = temporaryDatabase(t, 'authority-boundary-upgrade.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-authority-upgrade-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of [
    '0001_initial_control_store.sql',
    '0002_workflow_owned_attempt_lifecycle.sql',
    '0003_goal_projection_and_attempt_immutability.sql',
    '0004_attempt_lifecycle_shape_guard.sql',
    '0005_processed_command_outcome_binding.sql',
    '0006_store_authored_command_outcomes.sql',
    '0007_causal_control_time.sql',
  ]) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }

  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const creation = seed(oldStore, 'authority-boundary-upgrade');
  oldStore.close();

  const poisonedCommandId = commandId('command_authority-boundary-poison');
  const target = { aggregateType: 'WORKFLOW' as const, aggregateId: creation.workflow.id };
  const raw = new Database(filename);
  raw
    .prepare(
      `INSERT INTO processed_commands(
         command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
       ) VALUES (?, ?, 'WORKFLOW', ?, ?, ?)`,
    )
    .run(
      poisonedCommandId,
      `sha256:${'A'.repeat(64)}`,
      creation.workflow.id,
      JSON.stringify(expectedAppliedOutcome(target, poisonedCommandId, creation.workflow)),
      createdAt,
    );
  raw.close();

  const migrationName = '0008_authority_boundary_validation.sql';
  writeFileSync(
    join(migrationsDirectory, migrationName),
    readFileSync(join(sourceDirectory, migrationName), 'utf8'),
    'utf8',
  );
  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => transitionedAt,
      }),
    /CHECK constraint failed/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  const appliedNames = inspected
    .prepare('SELECT name FROM schema_migrations ORDER BY version')
    .all()
    .map((row) => z.object({ name: z.string() }).parse(row).name);
  assert.equal(appliedNames.includes(migrationName), false);
  assert.equal(
    inspected
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name = 'candidate_generations_one_current_per_workflow'",
      )
      .get(),
    undefined,
  );
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
    expectedAppliedOutcome(transition.target, transition.event.commandId, result.value),
  );
  assert.equal(reopened.listAuditEvents('GOAL', creation.goal.id).length, 1);
  assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 2);
});

void test('[I-008] Store authors an APPLIED outcome from the committed Workflow state', (t) => {
  const filename = temporaryDatabase(t, 'store-authored-applied.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'store-authored-applied');
  const transition = transitionInput(creation.workflow, 'store-authored-applied');

  const result = store.commitWorkflowEvent(transition);

  assert.equal(result.status, 'APPLIED');
  const decoded = decodeStoredCommandOutcome(result.outcome);
  assert.equal(decoded.disposition, StoredCommandDisposition.APPLIED);
  assert.equal(decoded.output.ok, true);
  assert.deepEqual(decoded.workflow, {
    id: result.value.id,
    version: result.value.version,
    phase: result.value.phase,
    runStatus: result.value.runStatus,
  });
  assert.deepEqual(decoded.output, {
    schemaVersion: 1,
    commandId: transition.event.commandId,
    ok: true,
    goalId: result.value.goalId,
    workflowVersion: result.value.version,
    phase: result.value.phase,
    runStatus: result.value.runStatus,
  });
});

void test('[I-008] Store authors a REJECTED outcome from the observed Workflow state', (t) => {
  const filename = temporaryDatabase(t, 'store-authored-rejected.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'store-authored-rejected');
  const rejectionCommandId = commandId('command_store-authored-rejection');
  const target = Object.freeze({
    aggregateType: 'WORKFLOW' as const,
    aggregateId: creation.workflow.id,
  });

  const result = store.recordCommandRejection({
    commandId: rejectionCommandId,
    inputDigest: digest('0'),
    target,
    workflowId: creation.workflow.id,
    observedWorkflowVersion: creation.workflow.version,
    error: {
      code: RuntimeErrorCode.DOMAIN_REJECTED,
      message: 'the deterministic command was rejected',
      retryable: false,
      detailCode: 'STORE_AUTHORED_REJECTION',
    },
    completedAt: transitionedAt,
  });

  assert.equal(result.status, 'APPLIED');
  const decoded = decodeStoredCommandOutcome(result.outcome);
  assert.equal(decoded.disposition, StoredCommandDisposition.REJECTED);
  assert.equal(decoded.output.ok, false);
  assert.deepEqual(decoded.workflow, {
    id: creation.workflow.id,
    version: creation.workflow.version,
    phase: creation.workflow.phase,
    runStatus: creation.workflow.runStatus,
  });
  assert.deepEqual(store.getProcessedCommand(rejectionCommandId)?.outcome, result.outcome);
  assert.deepEqual(store.getWorkflow(creation.workflow.id), creation.workflow);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 1);
});

void test('[I-008] Store rejects a command completion time older than observed Workflow', (t) => {
  const filename = temporaryDatabase(t, 'store-rejection-causal-time.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'store-rejection-causal-time');
  const advanced = store.commitWorkflowEvent(
    transitionInput(creation.workflow, 'store-rejection-causal-time'),
  );
  assert.equal(advanced.status, 'APPLIED');
  const rejectionCommandId = commandId('command_store-rejection-causal-time');

  assert.throws(
    () =>
      store.recordCommandRejection({
        commandId: rejectionCommandId,
        inputDigest: digest('0'),
        target: {
          aggregateType: 'WORKFLOW',
          aggregateId: creation.workflow.id,
        },
        workflowId: creation.workflow.id,
        observedWorkflowVersion: advanced.value.version,
        error: {
          code: RuntimeErrorCode.DOMAIN_REJECTED,
          message: 'older completion time must fail closed',
          retryable: false,
          detailCode: 'OLDER_COMPLETION_TIME',
        },
        completedAt: createdAt,
      }),
    /completion time cannot precede observed Workflow state/,
  );
  assert.equal(store.getProcessedCommand(rejectionCommandId), undefined);
  assert.deepEqual(store.getWorkflow(creation.workflow.id), advanced.value);
});

void test('[I-006][I-008] Runtime clock rollback stays causal through SQLite, audit, and outcome', (t) => {
  const filename = temporaryDatabase(t, 'runtime-clock-rollback.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'runtime-clock-rollback');
  const rollbackClock: Clock = {
    now: () => isoTimestamp('2026-07-26T23:59:59.999Z'),
  };
  const runtime = runtimeFor(store, 'runtime-clock-rollback', rollbackClock);
  const request = {
    commandId: commandId('command_runtime-clock-rollback-sqlite'),
    goalId: creation.goal.id,
    expectedGoalRevision: creation.goal.revision,
    expectedWorkflowVersion: creation.workflow.version,
  };

  const result = runtime.startGoal(request);

  assert.equal(result.status, 'APPLIED');
  const running = store.getWorkflow(creation.workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Clock rollback integration must persist one active Attempt');
  }
  assert.equal(running.updatedAt, createdAt);
  assert.equal(store.getAttempt(running.activeAttemptId)?.startedAt, createdAt);
  assert.equal(store.getProcessedCommand(request.commandId)?.completedAt, createdAt);
  assert.equal(store.listAuditEvents('WORKFLOW', running.id).at(-1)?.occurredAt, createdAt);
  assert.equal(
    store.listAuditEvents('ATTEMPT', running.activeAttemptId).at(-1)?.occurredAt,
    createdAt,
  );
});

void test('[I-003][I-006][I-008][I-010] public Goal commands run end to end through SQLite', (t) => {
  const filename = temporaryDatabase(t, 'runtime-goal-integration.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'runtime-goal-integration');
  const runtime = runtimeFor(store, 'runtime-goal-integration');
  const startRequest = {
    commandId: commandId('command_runtime-goal-start'),
    goalId: creation.goal.id,
    expectedGoalRevision: creation.goal.revision,
    expectedWorkflowVersion: creation.workflow.version,
  };

  const started = runtime.startGoal(startRequest);
  const startReplay = runtime.startGoal(startRequest);
  assert.equal(started.status, 'APPLIED');
  assert.equal(startReplay.status, 'REPLAYED');
  assert.deepEqual(startReplay.output, started.output);
  assert.equal(store.getProcessedCommand(startRequest.commandId)?.aggregateType, 'GOAL');
  assert.equal(store.getProcessedCommand(startRequest.commandId)?.aggregateId, creation.goal.id);

  const running = store.getWorkflow(creation.workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('StartGoal must persist one active Attempt');
  }
  const rejectedRequest = {
    commandId: commandId('command_runtime-goal-rejected-begin'),
    goalId: creation.goal.id,
    expectedGoalRevision: creation.goal.revision,
    expectedWorkflowVersion: running.version,
  };
  const firstRejection = runtime.startGoal(rejectedRequest);
  assert.equal(firstRejection.status, 'REJECTED');
  assert.equal(firstRejection.output.error.detailCode, 'GOAL_ALREADY_STARTED');

  const cancelRequest = {
    commandId: commandId('command_runtime-goal-cancel'),
    goalId: creation.goal.id,
    expectedGoalRevision: creation.goal.revision,
    expectedWorkflowVersion: running.version,
    reason: 'integration user cancellation',
  };
  const cancelled = runtime.cancelGoal(cancelRequest);
  assert.equal(cancelled.status, 'APPLIED');
  assert.equal(cancelled.output.runStatus, RunStatus.CANCELLED);
  assert.equal(store.getGoal(creation.goal.id)?.status, 'CANCELLED');
  assert.equal(store.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.CANCELLED);
  assert.equal(store.getAttempt(running.activeAttemptId)?.status, AttemptStatus.INTERRUPTED);
  assert.equal(store.getProcessedCommand(cancelRequest.commandId)?.aggregateType, 'GOAL');

  const rejectionReplay = runtime.startGoal(rejectedRequest);
  assert.equal(rejectionReplay.status, 'REPLAYED');
  assert.deepEqual(rejectionReplay.output, firstRejection.output);
  store.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  const reopenedGoal = reopened.getGoal(creation.goal.id);
  const reopenedWorkflow = reopened.getWorkflow(creation.workflow.id);
  assert.equal(reopenedGoal?.status, 'CANCELLED');
  assert.equal(reopenedWorkflow?.runStatus, RunStatus.CANCELLED);
  assert.equal(reopenedGoal.updatedAt, reopenedWorkflow.updatedAt);
});

void test('[I-006][I-008][I-010] failed cancellation rolls back Goal projection with Workflow and Attempt', (t) => {
  const filename = temporaryDatabase(t, 'runtime-cancel-rollback.sqlite');
  const baseline = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(baseline, 'runtime-cancel-rollback');
  const startRuntime = runtimeFor(baseline, 'runtime-cancel-rollback-start');
  const started = startRuntime.startGoal({
    commandId: commandId('command_runtime-cancel-rollback-start'),
    goalId: creation.goal.id,
    expectedGoalRevision: creation.goal.revision,
    expectedWorkflowVersion: creation.workflow.version,
  });
  assert.equal(started.status, 'APPLIED');
  const running = baseline.getWorkflow(creation.workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('StartGoal must persist an active Attempt');
  }
  baseline.close();

  const failing = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: (step) => {
      if (step === TransactionStep.AFTER_STATE_WRITE) {
        throw new Error('injected cancellation failure after state projection');
      }
    },
  });
  const cancelCommandId = commandId('command_runtime-cancel-rollback-cancel');
  const failed = runtimeFor(failing, 'runtime-cancel-rollback-fail').cancelGoal({
    commandId: cancelCommandId,
    goalId: creation.goal.id,
    expectedGoalRevision: creation.goal.revision,
    expectedWorkflowVersion: running.version,
    reason: 'prove atomic projection rollback',
  });
  assert.equal(failed.status, 'REJECTED');
  assert.equal(failed.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  failing.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getGoal(creation.goal.id)?.status, 'ACTIVE');
  assert.equal(reopened.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.RUNNING);
  assert.equal(reopened.getAttempt(running.activeAttemptId)?.status, AttemptStatus.RUNNING);
  assert.equal(reopened.getProcessedCommand(cancelCommandId), undefined);
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
  assert.deepEqual(duplicate.outcome, first.outcome);
  assert.equal(store.getWorkflow(creation.workflow.id)?.version, 2);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 2);

  const conflict = store.commitWorkflowEvent({ ...transition, inputDigest: digest('e') });
  assert.equal(conflict.status, 'COMMAND_CONFLICT');
});

void test('[I-008] a stale workflow event writes no state, audit, or command outcome', (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'stale');
  const first = transitionInput(creation.workflow, 'stale-first');
  store.commitWorkflowEvent(first);

  const stale = transitionInput(creation.workflow, 'stale-second');
  assert.equal(store.commitWorkflowEvent(stale).status, 'VERSION_CONFLICT');

  assert.equal(store.getWorkflow(creation.workflow.id)?.version, 2);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 2);
  assert.equal(store.getProcessedCommand(stale.event.commandId), undefined);
});

void test('[I-008] two SQLite connections expose a shared-version race as a typed conflict', (t) => {
  const filename = temporaryDatabase(t, 'two-connection-race.sqlite');
  const firstStore = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(firstStore, 'two-connection-race');
  const secondStore = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => firstStore.close());
  t.after(() => secondStore.close());

  const first = transitionInput(creation.workflow, 'two-connection-first');
  const second = transitionInput(creation.workflow, 'two-connection-second');

  assert.equal(firstStore.commitWorkflowEvent(first).status, 'APPLIED');
  assert.equal(secondStore.commitWorkflowEvent(second).status, 'VERSION_CONFLICT');
  assert.equal(secondStore.getWorkflow(creation.workflow.id)?.version, 2);
  assert.equal(secondStore.getProcessedCommand(second.event.commandId), undefined);
});

void test('[I-006][I-009][I-027] database rejects a cross-Goal processed outcome binding', (t) => {
  const filename = temporaryDatabase(t, 'outcome-binding-guard.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'outcome-binding-guard');
  store.close();

  const raw = new Database(filename);
  t.after(() => raw.close());
  const commandIdentifier = commandId('command_cross-goal-db-outcome');
  const otherGoalId = goalId('goal_cross-goal-db-outcome');
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO processed_commands(
             command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
           ) VALUES (?, ?, 'WORKFLOW', ?, ?, ?)`,
        )
        .run(
          commandIdentifier,
          digest('8'),
          creation.workflow.id,
          JSON.stringify({
            schemaVersion: 3,
            disposition: StoredCommandDisposition.APPLIED,
            target: {
              aggregateType: 'WORKFLOW',
              aggregateId: creation.workflow.id,
            },
            goalId: otherGoalId,
            workflow: {
              id: creation.workflow.id,
              version: creation.workflow.version,
              phase: creation.workflow.phase,
              runStatus: creation.workflow.runStatus,
            },
            output: {
              schemaVersion: 1,
              commandId: commandIdentifier,
              ok: true,
              goalId: otherGoalId,
              workflowVersion: creation.workflow.version,
              phase: creation.workflow.phase,
              runStatus: creation.workflow.runStatus,
            },
          }),
          transitionedAt,
        ),
    /processed command outcome semantic binding is invalid/,
  );
});

void test('[I-006][I-008][I-009][I-027] database rejects impossible outcome semantics and dangling authority', (t) => {
  const filename = temporaryDatabase(t, 'outcome-semantic-guard.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'outcome-semantic-guard');
  store.close();

  const raw = new Database(filename);
  t.after(() => raw.close());
  const insert = raw.prepare(
    `INSERT INTO processed_commands(
       command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
     ) VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const applied = (identifier: string) =>
    expectedAppliedOutcome(
      { aggregateType: 'WORKFLOW', aggregateId: creation.workflow.id },
      commandId(identifier),
      creation.workflow,
    );
  const failedOutput = (identifier: string) => ({
    schemaVersion: 1 as const,
    commandId: commandId(identifier),
    ok: false as const,
    error: {
      code: RuntimeErrorCode.DOMAIN_REJECTED,
      message: 'rejected fixture',
      retryable: false,
      detailCode: 'REJECTED_FIXTURE',
    },
  });
  const missingGoalId = goalId('goal_missing-outcome-authority');
  const missingWorkflowId = workflowId('workflow_missing-outcome-authority');
  const cases = [
    {
      name: 'APPLIED with failed output',
      commandIdentifier: 'command_applied-with-failure',
      aggregateType: 'WORKFLOW',
      aggregateId: creation.workflow.id,
      outcome: {
        ...applied('command_applied-with-failure'),
        output: failedOutput('command_applied-with-failure'),
      },
    },
    {
      name: 'REJECTED with successful output',
      commandIdentifier: 'command_rejected-with-success',
      aggregateType: 'WORKFLOW',
      aggregateId: creation.workflow.id,
      outcome: {
        ...applied('command_rejected-with-success'),
        disposition: StoredCommandDisposition.REJECTED,
      },
    },
    {
      name: 'REJECTED with an infrastructure error',
      commandIdentifier: 'command_rejected-infrastructure-error',
      aggregateType: 'WORKFLOW',
      aggregateId: creation.workflow.id,
      outcome: {
        ...applied('command_rejected-infrastructure-error'),
        disposition: StoredCommandDisposition.REJECTED,
        output: {
          ...failedOutput('command_rejected-infrastructure-error'),
          error: {
            ...failedOutput('command_rejected-infrastructure-error').error,
            code: RuntimeErrorCode.PERSISTENCE_FAILURE,
          },
        },
      },
    },
    {
      name: 'Workflow snapshot not equal to the transaction state',
      commandIdentifier: 'command_wrong-workflow-snapshot',
      aggregateType: 'WORKFLOW',
      aggregateId: creation.workflow.id,
      outcome: {
        ...applied('command_wrong-workflow-snapshot'),
        workflow: {
          ...applied('command_wrong-workflow-snapshot').workflow,
          version: creation.workflow.version + 1,
        },
        output: {
          ...applied('command_wrong-workflow-snapshot').output,
          workflowVersion: creation.workflow.version + 1,
        },
      },
    },
    {
      name: 'Goal target does not exist',
      commandIdentifier: 'command_missing-goal-authority',
      aggregateType: 'GOAL',
      aggregateId: missingGoalId,
      outcome: {
        ...applied('command_missing-goal-authority'),
        target: { aggregateType: 'GOAL', aggregateId: missingGoalId },
        goalId: missingGoalId,
        output: {
          ...applied('command_missing-goal-authority').output,
          goalId: missingGoalId,
        },
      },
    },
    {
      name: 'Workflow target does not exist',
      commandIdentifier: 'command_missing-workflow-authority',
      aggregateType: 'WORKFLOW',
      aggregateId: missingWorkflowId,
      outcome: {
        ...applied('command_missing-workflow-authority'),
        target: { aggregateType: 'WORKFLOW', aggregateId: missingWorkflowId },
        workflow: {
          ...applied('command_missing-workflow-authority').workflow,
          id: missingWorkflowId,
        },
      },
    },
  ] as const;

  for (const fixture of cases) {
    assert.throws(
      () =>
        insert.run(
          fixture.commandIdentifier,
          digest('8'),
          fixture.aggregateType,
          fixture.aggregateId,
          JSON.stringify(fixture.outcome),
          transitionedAt,
        ),
      /processed command outcome semantic binding is invalid/,
      fixture.name,
    );
  }
});

void test('[I-006][I-008] processed command outcomes are immutable after insertion', (t) => {
  const filename = temporaryDatabase(t, 'immutable-command-outcomes.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'immutable-command-outcomes');
  store.close();

  const raw = new Database(filename);
  t.after(() => raw.close());
  assert.throws(
    () =>
      raw
        .prepare('UPDATE processed_commands SET completed_at = ? WHERE command_id = ?')
        .run(transitionedAt, creation.commandId),
    /processed commands are immutable/,
  );
  assert.throws(
    () =>
      raw.prepare('DELETE FROM processed_commands WHERE command_id = ?').run(creation.commandId),
    /processed commands are immutable/,
  );
});

void test('[I-006][I-008] Store write boundaries reject malformed branded and nested authority', async (t) => {
  await t.test('Goal creation scalars', (subtest) => {
    const filename = temporaryDatabase(subtest, 'malformed-create-input.sqlite');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    subtest.after(() => store.close());
    const input = creationInput('malformed-create-input');

    assert.throws(() =>
      store.createGoalWithWorkflow({ ...input, inputDigest: 'not-a-digest' as never }),
    );
    assert.throws(() =>
      store.createGoalWithWorkflow({
        ...input,
        auditEventId: 'not-an-audit-id' as never,
      }),
    );
    assert.throws(() =>
      store.createGoalWithWorkflow({
        ...input,
        goal: { ...input.goal, id: 'goal_UPPERCASE' as never },
      }),
    );
    assert.equal(store.getGoal(input.goal.id), undefined);
    assert.equal(store.getProcessedCommand(input.commandId), undefined);
  });

  await t.test('nested Attempt capability', (subtest) => {
    const filename = temporaryDatabase(subtest, 'malformed-attempt-input.sqlite');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    subtest.after(() => store.close());
    const creation = seed(store, 'malformed-attempt-input');
    const input = beginAttemptInput(creation.workflow, 'malformed-attempt-input');
    if (input.event.type !== 'ATTEMPT_STARTED') {
      assert.fail('Begin fixture must emit ATTEMPT_STARTED');
    }
    const poisoned = {
      ...input,
      event: {
        ...input.event,
        attempt: {
          ...input.event.attempt,
          capabilityGrant: { ...input.event.attempt.capabilityGrant, projectRead: false },
        },
      },
    } as unknown as CommitAttemptEventInput;

    assert.throws(() => store.commitAttemptEvent(poisoned));
    assert.equal(store.getAttempt(input.event.attempt.id), undefined);
    assert.equal(store.getWorkflow(creation.workflow.id)?.version, creation.workflow.version);
    assert.equal(store.getProcessedCommand(input.event.commandId), undefined);
  });
});

void test('[I-006][I-008][I-009] SQLite Store passes the shared contract and reopens', (t) => {
  const filename = temporaryDatabase(t, 'sqlite-store-contract.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'sqlite-store-contract');
  const input = beginAttemptInput(creation.workflow, 'sqlite-store-contract');
  const invalidCommandIdentifier = commandId('command_sqlite-store-contract-invalid');

  assertWorkflowControlStoreContract({
    store,
    goalId: creation.goal.id,
    workflowId: creation.workflow.id,
    commandId: input.event.commandId,
    invalidCommandId: invalidCommandIdentifier,
    inputDigest: input.inputDigest,
    target: input.target,
    apply: () => store.commitAttemptEvent(input),
    conflict: () => store.commitAttemptEvent({ ...input, inputDigest: digest('e') }),
    invalid: () => {
      const current = store.getWorkflow(creation.workflow.id);
      if (current === undefined) {
        throw new Error('Store contract lost its Workflow');
      }
      return store.recordCommandRejection({
        commandId: invalidCommandIdentifier,
        inputDigest: 'not-a-digest' as never,
        target: input.target,
        workflowId: current.id,
        observedWorkflowVersion: current.version,
        error: {
          code: RuntimeErrorCode.DOMAIN_REJECTED,
          message: 'invalid Store boundary fixture',
          retryable: false,
          detailCode: 'INVALID_STORE_BOUNDARY_FIXTURE',
        },
        completedAt: current.updatedAt,
      });
    },
  });

  const attemptIdentifier =
    input.event.type === 'ATTEMPT_STARTED' ? input.event.attempt.id : input.event.attemptId;
  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.notEqual(reopened.getAttempt(attemptIdentifier), undefined);
  assert.notEqual(reopened.getProcessedCommand(input.event.commandId), undefined);
  assert.equal(reopened.listAuditEvents('ATTEMPT', attemptIdentifier).length, 1);
  assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 2);
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

void test('[I-003][I-006] database rejects an independently forged Goal lifecycle status', (t) => {
  const filename = temporaryDatabase(t, 'goal-projection-guard.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'goal-projection-guard');
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  assert.throws(
    () =>
      database.prepare('UPDATE goals SET status = ? WHERE id = ?').run('CLOSED', creation.goal.id),
    /Goal status must match its Workflow lifecycle projection/,
  );
  assert.equal(
    z
      .object({ status: z.string() })
      .parse(database.prepare('SELECT status FROM goals WHERE id = ?').get(creation.goal.id))
      .status,
    'ACTIVE',
  );
});

void test('[I-004][I-006][I-008][I-012] SQLite rejects binding rewrites, malformed scalars, and Candidate ownership bypasses', (t) => {
  const filename = temporaryDatabase(t, 'authority-boundary-triggers.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const first = seed(store, 'authority-boundary-first');
  const second = seed(store, 'authority-boundary-second');
  const began = store.commitAttemptEvent(
    beginAttemptInput(second.workflow, 'authority-boundary-worker-session'),
  );
  assert.equal(began.status, 'APPLIED');
  store.close();

  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  t.after(() => database.close());

  assert.throws(
    () =>
      database
        .prepare('UPDATE attempts SET worker_session_ref = ? WHERE id = ?')
        .run('WORKER_not-canonical', began.value.attempt.id),
    /Attempt Context and Worker bindings are immutable/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO attempts(
             id, workflow_id, phase, sequence, context_manifest_id,
             capability_grant_json, worker_session_ref, status, failure_class,
             termination_reason, started_at, ended_at
           ) VALUES (?, ?, 'CLOSEOUT', 1, NULL, ?, NULL, 'RUNNING', NULL, NULL, ?, NULL)`,
        )
        .run(
          'attempt_illegal-closeout',
          first.workflow.id,
          JSON.stringify(deriveCapabilityGrant(WorkflowPhase.CLOSEOUT)),
          createdAt,
        ),
    /Attempt authority representation is invalid/,
  );

  const poisonedCommandId = commandId('command_sqlite-poisoned-digest');
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO processed_commands(
             command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
           ) VALUES (?, ?, 'WORKFLOW', ?, ?, ?)`,
        )
        .run(
          poisonedCommandId,
          `sha256:${'A'.repeat(64)}`,
          first.workflow.id,
          JSON.stringify(
            expectedAppliedOutcome(
              { aggregateType: 'WORKFLOW', aggregateId: first.workflow.id },
              poisonedCommandId,
              first.workflow,
            ),
          ),
          createdAt,
        ),
    /Processed command authority representation is invalid/,
  );

  const insertCandidate = database.prepare(
    `INSERT INTO candidate_generations(
       id, candidate_id, workflow_id, sequence, parent_generation_id,
       workspace_identity, state, base_digest, frozen_digest, invalidation_reason,
       version, created_at, updated_at, frozen_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  assert.throws(
    () =>
      insertCandidate.run(
        'generation_invalid-causal-time',
        'candidate_invalid-causal-time',
        first.workflow.id,
        1,
        null,
        'fixture://candidate/invalid-causal-time',
        'INVALIDATED',
        digest('a'),
        null,
        'updated before creation',
        1,
        createdAt,
        '2026-07-26T23:59:59.999Z',
        null,
      ),
    /Candidate generation authority representation is invalid|invalid or unaudited Candidate generation creation/,
  );
  assert.throws(
    () =>
      insertCandidate.run(
        'generation_missing-frozen-identity',
        'candidate_authority-boundary',
        first.workflow.id,
        1,
        null,
        'fixture://candidate/missing-frozen-identity',
        'FROZEN',
        digest('a'),
        null,
        null,
        1,
        createdAt,
        createdAt,
        null,
      ),
    /Candidate generation authority representation is invalid|invalid or unaudited Candidate generation creation/,
  );

  const candidateIdentifier = 'candidate_authority-boundary';
  const generationIdentifier = 'generation_authority-boundary-first';
  assert.throws(
    () =>
      insertCandidate.run(
        generationIdentifier,
        candidateIdentifier,
        first.workflow.id,
        1,
        null,
        'fixture://candidate/authority-boundary',
        'MUTABLE',
        digest('b'),
        null,
        null,
        1,
        createdAt,
        createdAt,
        null,
      ),
    /invalid or unaudited Candidate generation creation/,
  );

  assert.throws(
    () =>
      insertCandidate.run(
        'generation_authority-boundary-cross-owner',
        candidateIdentifier,
        second.workflow.id,
        2,
        null,
        'fixture://candidate/cross-owner',
        'INVALIDATED',
        digest('b'),
        null,
        'wrong owning Workflow',
        1,
        createdAt,
        createdAt,
        null,
      ),
    /Candidate generation authority representation is invalid|invalid or unaudited Candidate generation creation/,
  );
  assert.throws(
    () =>
      database
        .prepare('UPDATE workflows SET active_candidate_generation_id = ? WHERE id = ?')
        .run(generationIdentifier, second.workflow.id),
    /Workflow authority representation is invalid|FOREIGN KEY constraint failed/,
  );

  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO audit_events(
             id, aggregate_type, aggregate_id, event_type, actor_type, command_id,
             before_version, after_version, correlation_id, causation_id,
             payload_digest, occurred_at
           ) VALUES (?, 'WORKFLOW', ?, 'FORGED_EVENT', 'RUNTIME', NULL, ?, NULL, NULL, NULL, ?, ?)`,
        )
        .run(
          'audit_unsafe-version',
          first.workflow.id,
          9_007_199_254_740_992,
          digest('c'),
          createdAt,
        ),
    /Audit event authority representation is invalid/,
  );
});

void test('[I-006][I-008] SQLite enforces causal time and terminal Workflow backstops', (t) => {
  const filename = temporaryDatabase(t, 'causal-time-triggers.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'causal-time-triggers');
  const transition = store.commitWorkflowEvent(
    transitionInput(creation.workflow, 'causal-time-triggers'),
  );
  assert.equal(transition.status, 'APPLIED');
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  assert.throws(
    () =>
      database
        .prepare('UPDATE workflows SET updated_at = ? WHERE id = ?')
        .run(createdAt, creation.workflow.id),
    /updated_at cannot move backward/,
  );

  const rejectedCommandId = commandId('command_causal-trigger-rejection');
  const target = Object.freeze({
    aggregateType: 'WORKFLOW' as const,
    aggregateId: creation.workflow.id,
  });
  const outcome = storedCommandOutcomeToJson(
    createRejectedStoredCommandOutcome(target, transition.value, rejectedCommandId, {
      code: RuntimeErrorCode.DOMAIN_REJECTED,
      message: 'valid rejection with an invalid historical completion time',
      retryable: false,
      detailCode: 'CAUSAL_TRIGGER_TEST',
    }),
  );
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO processed_commands(
             command_id, input_digest, aggregate_type, aggregate_id, outcome_json, completed_at
           ) VALUES (?, ?, 'WORKFLOW', ?, ?, ?)`,
        )
        .run(
          rejectedCommandId,
          digest('7'),
          creation.workflow.id,
          JSON.stringify(outcome),
          createdAt,
        ),
    /processed command cannot precede observed Workflow state/,
  );

  database
    .prepare(
      `UPDATE workflows
          SET run_status = 'CANCELLED', version = version + 1, updated_at = ?
        WHERE id = ?`,
    )
    .run(afterCancellationAt, creation.workflow.id);
  assert.throws(
    () =>
      database
        .prepare('UPDATE workflows SET version = version + 1, updated_at = ? WHERE id = ?')
        .run(isoTimestamp('2026-07-27T00:00:00.005Z'), creation.workflow.id),
    /terminal Workflow is immutable/,
  );
});

void test('[I-006][I-008] SQLite rejects an Attempt end before current Workflow state', (t) => {
  const filename = temporaryDatabase(t, 'attempt-causal-end.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const creation = seed(store, 'attempt-causal-end');
  const began = store.commitAttemptEvent(
    beginAttemptInput(creation.workflow, 'attempt-causal-end'),
  );
  assert.equal(began.status, 'APPLIED');
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  database
    .prepare('UPDATE workflows SET version = version + 1, updated_at = ? WHERE id = ?')
    .run(attemptFinishedAt, creation.workflow.id);

  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE attempts
              SET status = 'RESULT_RECORDED', termination_reason = ?, ended_at = ?
            WHERE id = ?`,
        )
        .run(
          'forged completion before current Workflow state',
          attemptStartedAt,
          began.value.attempt.id,
        ),
    /Attempt cannot end before current Workflow state/,
  );
  assert.equal(
    z
      .object({ status: z.string() })
      .parse(
        database.prepare('SELECT status FROM attempts WHERE id = ?').get(began.value.attempt.id),
      ).status,
    AttemptStatus.RUNNING,
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
    expectedAppliedOutcome(resultInput.target, resultInput.event.commandId, expected.workflow),
  );
});

void test('[I-008] a reopened persisted RUNNING Attempt can be explicitly reconciled', (t) => {
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
  assert.equal(store.getGoal(creation.goal.id)?.status, 'CANCELLED');
  const attempt = store.getAttempt(began.value.attempt.id);
  assert.equal(attempt?.status, AttemptStatus.INTERRUPTED);
  assert.match(attempt.terminationReason, /^WORKFLOW_CANCELLED:/);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
  assert.equal(store.listAuditEvents('ATTEMPT', began.value.attempt.id).length, 2);
});

void test('[I-008] Store rejects a fresh-version event against a terminal Workflow', (t) => {
  const filename = temporaryDatabase(t, 'terminal-workflow-event.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const creation = seed(store, 'terminal-workflow-event');
  const firstInput = cancellationInput(creation.workflow, 'terminal-workflow-event');
  const first = store.commitWorkflowEvent(firstInput);
  assert.equal(first.status, 'APPLIED');
  if (firstInput.event.type !== 'WORKFLOW_CANCELLED') {
    assert.fail('Cancellation input must contain WORKFLOW_CANCELLED');
  }

  const forgedCommandId = commandId('command_cancel-terminal-workflow-forged');
  const forgedInput: CommitWorkflowEventInput = {
    inputDigest: digest('8'),
    target: firstInput.target,
    event: {
      ...firstInput.event,
      commandId: forgedCommandId,
      fromVersion: first.value.version,
      toVersion: workflowVersion(first.value.version + 1),
      occurredAt: afterCancellationAt,
    },
    auditEventId: auditEventId('audit_terminal-workflow-forged'),
    payloadDigest: digest('9'),
  };
  const auditCount = store.listAuditEvents('WORKFLOW', creation.workflow.id).length;

  assert.throws(
    () => store.commitWorkflowEvent(forgedInput),
    /Terminal Workflow cannot apply another event/,
  );
  assert.equal(store.getWorkflow(creation.workflow.id)?.version, first.value.version);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, auditCount);
  assert.equal(store.getProcessedCommand(forgedCommandId), undefined);
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
    target: cancellation.target,
    event: cancellation.event,
    auditEventId: cancellation.auditEventId,
    payloadDigest: cancellation.payloadDigest,
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
    assert.equal(store.commitWorkflowEvent(cancellation).status, 'VERSION_CONFLICT');

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
    assert.equal(store.commitAttemptEvent(result).status, 'VERSION_CONFLICT');

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

void test('[I-006][I-008] database rejects Attempt deletion, a second running Attempt, and terminal rewrites', (t) => {
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
  assert.throws(
    () => database.prepare('DELETE FROM attempts WHERE id = ?').run(began.value.attempt.id),
    /Attempt records cannot be deleted/,
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
  const runningAttemptId = attemptId('attempt_db-guard-running-1');
  insertRunning.run(runningAttemptId, 2, attemptFinishedAt, began.value.attempt.id);
  for (const [column, value] of [
    ['failure_class', AttemptFailureClass.UNKNOWN],
    ['termination_reason', 'fabricated terminal reason'],
    ['ended_at', attemptFinishedAt],
  ] as const) {
    assert.throws(
      () =>
        database
          .prepare(`UPDATE attempts SET ${column} = ? WHERE id = ?`)
          .run(value, runningAttemptId),
      /invalid Attempt lifecycle shape/,
    );
  }
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
