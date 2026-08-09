import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
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
  decodeGoalSnapshot,
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
  decodeStoredCommandOutcome,
  goalAndWorkflowCreationPayloadProjection,
  StoredCommandDisposition,
  CanonicalJsonSha256DigestProvider,
  storedCommandOutcomeToJson,
  type Clock,
  type CommandTarget,
} from '@codeclosure/runtime';
import {
  createGoalApplication,
  type GoalApplication,
} from '@codeclosure/runtime/testing/workflow-runtime';
import {
  DeterministicIds,
  assertWorkflowControlStoreContract,
  createWorkflowStartAuthorityRuntime,
  finishWorkflowAuthorityFixture,
  startWorkflowAuthorityFixture,
} from '@codeclosure/testing';

const createdAt = isoTimestamp('2026-07-27T00:00:00.000Z');
const transitionedAt = isoTimestamp('2026-07-27T00:00:00.001Z');
const attemptStartedAt = isoTimestamp('2026-07-27T00:00:00.002Z');
const attemptFinishedAt = isoTimestamp('2026-07-27T00:00:00.003Z');
const afterCancellationAt = isoTimestamp('2026-07-27T00:00:00.004Z');
const legacyRetryFinishedAt = isoTimestamp('2026-07-27T00:00:00.005Z');
const canonicalDigests = new CanonicalJsonSha256DigestProvider();

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
  let timeSequence = 10;
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
  return createWorkflowStartAuthorityRuntime({ store, namespace, clock }).kernel;
}

function cancellationRuntimeFor(store: SqliteControlStore, namespace: string): GoalApplication {
  return createGoalApplication({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids: new DeterministicIds(namespace),
    digests: new CanonicalJsonSha256DigestProvider(),
  });
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
    payloadDigest: canonicalDigests.digest(
      goalAndWorkflowCreationPayloadProjection(goal, workflow),
    ),
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

function planEvent(
  workflow: WorkflowInstance,
  namespace: string,
  occurredAt = transitionedAt,
): WorkflowEvent {
  return acceptedEvent(
    decideWorkflow(workflow, {
      type: 'REQUEST_PHASE_TRANSITION',
      commandId: commandId(`command_plan-${namespace}`),
      workflowId: workflow.id,
      expectedVersion: workflow.version,
      occurredAt,
      reason: 'discovery proof is complete',
      requestedPhase: WorkflowPhase.PLAN,
      guardResults: planGuardResults(),
    }),
  );
}

function transitionInput(
  workflow: WorkflowInstance,
  namespace: string,
  occurredAt = transitionedAt,
): CommitWorkflowEventInput {
  const event = planEvent(workflow, namespace, occurredAt);
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

function beginAttemptInput(
  workflow: WorkflowInstance,
  namespace: string,
  sequence = 1,
): CommitAttemptEventInput {
  const event = acceptedAttemptEvent(
    decideAttempt(workflow, undefined, {
      type: 'BEGIN_ATTEMPT',
      commandId: commandId(`command_begin-${namespace}`),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: attemptId(`attempt_${namespace}`),
      sequence,
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
      reason: 'WORKER_RESULT:PROPOSALS',
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

function seedRunning(store: SqliteControlStore, namespace: string) {
  const creation = seed(store, namespace);
  const authority = startWorkflowAuthorityFixture({
    store,
    goal: creation.goal,
    workflow: creation.workflow,
    namespace,
  });
  return Object.freeze({ creation, authority });
}

function seedReady(store: SqliteControlStore, namespace: string) {
  const running = seedRunning(store, namespace);
  const authority = finishWorkflowAuthorityFixture(running.authority, store);
  return Object.freeze({ creation: running.creation, authority });
}

function migrationsBefore(t: TestContext, boundary: string, directoryPrefix: string): string {
  const migrationsDirectory = mkdtempSync(join(tmpdir(), directoryPrefix));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < boundary,
  )) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }
  return migrationsDirectory;
}

function addMigration(migrationsDirectory: string, migrationName: string): void {
  writeFileSync(
    join(migrationsDirectory, migrationName),
    readFileSync(join(defaultMigrationsDirectory(), migrationName), 'utf8'),
    'utf8',
  );
}

function recordTransientFailure(
  store: SqliteControlStore,
  authority: ReturnType<typeof startWorkflowAuthorityFixture>,
  namespace: string,
): void {
  const failure = authority.kernel.recordAttemptFailure({
    commandId: commandId(`command_transient-failure-${namespace}`),
    workflowId: authority.workflow.id,
    expectedWorkflowVersion: authority.workflow.version,
    attemptId: authority.attempt.id,
    failureClass: AttemptFailureClass.TRANSIENT_BACKEND,
    reason: 'WORKER_BACKEND_FAILURE',
  });
  assert.equal(failure.status, 'APPLIED');
  assert.equal(store.getAttempt(authority.attempt.id)?.status, AttemptStatus.FAILED);
  assert.equal(
    store.getAttempt(authority.attempt.id)?.failureClass,
    AttemptFailureClass.TRANSIENT_BACKEND,
  );
  assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.BLOCKED);
}

function recordProtocolFailure(
  store: SqliteControlStore,
  authority: ReturnType<typeof startWorkflowAuthorityFixture>,
  namespace: string,
): WorkflowInstance {
  const failure = authority.kernel.recordAttemptFailure({
    commandId: commandId(`command_protocol-failure-${namespace}`),
    workflowId: authority.workflow.id,
    expectedWorkflowVersion: authority.workflow.version,
    attemptId: authority.attempt.id,
    failureClass: AttemptFailureClass.PROTOCOL_ERROR,
    reason: 'WORKER_STREAM_NO_TERMINAL_EVENT',
  });
  assert.equal(failure.status, 'APPLIED');
  assert.equal(store.getAttempt(authority.attempt.id)?.status, AttemptStatus.FAILED);
  const workflow = store.getWorkflow(authority.workflow.id);
  if (workflow === undefined) {
    assert.fail('Protocol failure fixture must retain its Workflow');
  }
  assert.equal(workflow.runStatus, RunStatus.FAILED);
  return workflow;
}

function rewriteBlockedTransientWorkflowReady(
  filename: string,
  workflowIdentifier: ReturnType<typeof workflowId>,
  phase: WorkflowPhase = WorkflowPhase.DISCOVERY,
): void {
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    const update = database
      .prepare(
        `UPDATE workflows
            SET phase = ?, run_status = 'READY', active_attempt_id = NULL, suspended_reason = NULL
          WHERE id = ? AND run_status = 'BLOCKED'`,
      )
      .run(phase, workflowIdentifier);
    assert.equal(update.changes, 1);
  } finally {
    database.close();
  }
}

function appendRawLegacySuccessfulRetry(
  filename: string,
  workflowIdentifier: ReturnType<typeof workflowId>,
  namespace: string,
): ReturnType<typeof attemptId> {
  const retryAttemptId = attemptId(`attempt_legacy-retry-${namespace}`);
  const database = new Database(filename);
  try {
    database.pragma('foreign_keys = ON');
    database.transaction(() => {
      database
        .prepare(
          `INSERT INTO attempts(
             id, workflow_id, phase, sequence, context_manifest_id,
             capability_grant_json, worker_session_ref, status, failure_class,
             termination_reason, started_at, ended_at
           ) VALUES (?, ?, 'DISCOVERY', 2, NULL, ?, NULL, 'RUNNING', NULL, NULL, ?, NULL)`,
        )
        .run(
          retryAttemptId,
          workflowIdentifier,
          JSON.stringify(deriveCapabilityGrant(WorkflowPhase.DISCOVERY)),
          afterCancellationAt,
        );
      database
        .prepare(
          `UPDATE workflows
              SET run_status = 'RUNNING', version = version + 1,
                  active_attempt_id = ?, suspended_reason = NULL, updated_at = ?
            WHERE id = ? AND run_status = 'READY'`,
        )
        .run(retryAttemptId, afterCancellationAt, workflowIdentifier);
      database
        .prepare(
          `UPDATE attempts
              SET status = 'RESULT_RECORDED', termination_reason = ?, ended_at = ?
            WHERE id = ? AND status = 'RUNNING'`,
        )
        .run(
          'legacy retry completed without M1 retry authority',
          legacyRetryFinishedAt,
          retryAttemptId,
        );
      database
        .prepare(
          `UPDATE workflows
              SET run_status = 'READY', version = version + 1,
                  active_attempt_id = NULL, suspended_reason = NULL, updated_at = ?
            WHERE id = ? AND run_status = 'RUNNING'`,
        )
        .run(legacyRetryFinishedAt, workflowIdentifier);
    })();
  } finally {
    database.close();
  }
  return retryAttemptId;
}

function rewriteRecordedAttemptAsEarlierTransientFailure(
  filename: string,
  attemptIdentifier: ReturnType<typeof attemptId>,
): void {
  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER attempts_terminal_immutable');
    database.exec('DROP TRIGGER attempts_lifecycle_guard');
    database.exec('DROP TRIGGER attempts_m1_retry_boundary_history_update_guard');
    database.exec('DROP TRIGGER attempts_m1_retry_boundary_update_guard');
    const update = database
      .prepare(
        `UPDATE attempts
            SET status = 'FAILED', failure_class = 'TRANSIENT_BACKEND',
                termination_reason = 'WORKER_BACKEND_FAILURE', ended_at = ?
          WHERE id = ? AND status = 'RESULT_RECORDED'`,
      )
      .run(legacyRetryFinishedAt, attemptIdentifier);
    assert.equal(update.changes, 1);
  } finally {
    database.close();
  }
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
      '0013_acceptance_closeout_authority.sql',
      '0014_exact_acceptance_repair_authority.sql',
      '0015_execution_profile_authority.sql',
      '0016_recovery_reconciliation_authority.sql',
      '0017_workflow_policy_binding_authority.sql',
      '0018_m1_retry_boundary_closure.sql',
      '0019_m1_attempt_authority_closure.sql',
      '0020_local_command_verification_evidence.sql',
      '0021_evidence_set_check_family_authority.sql',
      '0022_evidence_obligation_causal_time.sql',
      '0023_external_execution_and_repair_context.sql',
      '0024_protected_verification_authority.sql',
      '0025_local_verification_recovery_barrier.sql',
      '0026_intake_authority.sql',
      '0027_intake_project_correction.sql',
      '0028_rejected_clarification_reservation.sql',
      '0029_intent_projection_schema_v2.sql',
      '0030_project_read_authority.sql',
      '0031_project_read_cleanup_authority.sql',
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
    'execution_profiles',
    'workflow_policy_bindings',
    'workflow_execution_profile_bindings',
    'recovery_reconciliations',
    'verification_obligations',
    'evidence_records',
    'evidence_eligibility',
    'pending_issues',
    'acceptance_input_manifests',
    'acceptance_decisions',
    'workflow_closeouts',
    'acceptance_repairs',
    'processed_commands',
    'audit_events',
    'worker_dispatch_claims',
    'worker_event_receipts',
    'project_read_workspace_authority_snapshots',
    'project_read_workspace_observations',
    'project_read_snapshot_cleanup_grants',
    'project_read_snapshot_cleanup_observations',
    'project_read_snapshot_cleanup_outcomes',
    'project_read_snapshot_cleanup_consumptions',
  ]) {
    assert.equal(tableNames.has(requiredTable), true, `${requiredTable} must exist`);
  }
  assert.equal(database.prepare('PRAGMA foreign_key_check').all().length, 0);
  database.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.equal(reopened.appliedMigrations()[0]?.appliedAt, createdAt);
});

void test('[I-006][I-008] migration 0015 upgrades only unstarted Workflow authority', (t) => {
  const filename = temporaryDatabase(t, 'execution-profile-unstarted-upgrade.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-profile-upgrade-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0015_',
  )) {
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
  const creation = seed(oldStore, 'profile-unstarted-upgrade');
  oldStore.close();

  const migrationName = '0015_execution_profile_authority.sql';
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

  assert.equal(upgraded.appliedMigrations().at(-1)?.name, migrationName);
  assert.deepEqual(upgraded.getGoal(creation.goal.id), creation.goal);
  assert.deepEqual(upgraded.getWorkflow(creation.workflow.id), creation.workflow);
  assert.equal(upgraded.getExecutionProfileBinding(creation.workflow.id), undefined);
});

void test('[I-006][I-008] migration 0015 atomically refuses legacy started authority', (t) => {
  const filename = temporaryDatabase(t, 'execution-profile-started-refusal.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-profile-refusal-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0015_',
  )) {
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
  const creation = seed(oldStore, 'profile-started-refusal');
  const began = oldStore.commitAttemptEvent(
    beginAttemptInput(creation.workflow, 'profile-started-refusal'),
  );
  assert.equal(began.status, 'APPLIED');
  oldStore.close();

  const migrationName = '0015_execution_profile_authority.sql';
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
    /legacy-unbound-execution-authority/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
      .pluck()
      .get(migrationName),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'execution_profiles'",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(inspected.prepare('SELECT COUNT(*) FROM attempts').pluck().get(), 1);
});

void test('[I-006][I-008] migration 0017 upgrades only unstarted Workflow authority', (t) => {
  const filename = temporaryDatabase(t, 'workflow-policy-unstarted-upgrade.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-policy-binding-upgrade-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0017_',
  )) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }

  const oldStore = openSqliteControlStore({ filename, migrationsDirectory, now: () => createdAt });
  const creation = seed(oldStore, 'policy-binding-unstarted-upgrade');
  oldStore.close();

  const migrationName = '0017_workflow_policy_binding_authority.sql';
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

  assert.equal(upgraded.appliedMigrations().at(-1)?.name, migrationName);
  assert.deepEqual(upgraded.getGoal(creation.goal.id), creation.goal);
  assert.deepEqual(upgraded.getWorkflow(creation.workflow.id), creation.workflow);
  assert.equal(upgraded.getWorkflowPolicyBinding(creation.workflow.id), undefined);
});

void test('[I-006][I-008][I-010] migration 0017 retains exact pre-start cancellation authority', (t) => {
  const filename = temporaryDatabase(t, 'workflow-policy-cancelled-upgrade.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-policy-cancelled-upgrade-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0017_',
  )) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }

  const oldStore = openSqliteControlStore({ filename, migrationsDirectory, now: () => createdAt });
  const creation = seed(oldStore, 'policy-binding-cancelled-upgrade');
  const cancelled = oldStore.commitWorkflowEvent(
    cancellationInput(creation.workflow, 'policy-binding-cancelled-upgrade'),
  );
  assert.equal(cancelled.status, 'APPLIED');
  oldStore.close();

  const migrationName = '0017_workflow_policy_binding_authority.sql';
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

  assert.equal(upgraded.appliedMigrations().at(-1)?.name, migrationName);
  assert.equal(upgraded.getGoal(creation.goal.id)?.status, 'CANCELLED');
  assert.equal(upgraded.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.CANCELLED);
  assert.equal(upgraded.getWorkflowPolicyBinding(creation.workflow.id), undefined);
  assert.equal(upgraded.getExecutionProfileBinding(creation.workflow.id), undefined);
});

void test('[I-006][I-008] migration 0017 atomically refuses legacy unbound execution', (t) => {
  const filename = temporaryDatabase(t, 'workflow-policy-started-refusal.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-policy-binding-refusal-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0017_',
  )) {
    writeFileSync(
      join(migrationsDirectory, name),
      readFileSync(join(sourceDirectory, name), 'utf8'),
      'utf8',
    );
  }

  const oldStore = openSqliteControlStore({ filename, migrationsDirectory, now: () => createdAt });
  const creation = seed(oldStore, 'policy-binding-started-refusal');
  const began = oldStore.commitAttemptEvent(
    beginAttemptInput(creation.workflow, 'policy-binding-started-refusal'),
  );
  assert.equal(began.status, 'APPLIED');
  oldStore.close();

  const migrationName = '0017_workflow_policy_binding_authority.sql';
  writeFileSync(
    join(migrationsDirectory, migrationName),
    readFileSync(join(sourceDirectory, migrationName), 'utf8'),
    'utf8',
  );
  assert.throws(
    () => openSqliteControlStore({ filename, migrationsDirectory, now: () => transitionedAt }),
    /legacy-unbound-policy-authority/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
      .pluck()
      .get(migrationName),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workflow_policy_bindings'",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(inspected.prepare('SELECT COUNT(*) FROM attempts').pluck().get(), 1);
});

void test('[I-006][I-008][I-028] migration 0018 atomically refuses a legacy retry-ready transient failure', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-refusal.sqlite');
  const migrationsDirectory = migrationsBefore(t, '0018_', 'codeclosure-retry-boundary-refusal-');
  const oldStore = openSqliteControlStore({ filename, migrationsDirectory, now: () => createdAt });
  const { authority } = seedRunning(oldStore, 'retry-boundary-refusal');
  recordTransientFailure(oldStore, authority, 'retry-boundary-refusal');
  oldStore.close();

  rewriteBlockedTransientWorkflowReady(filename, authority.workflow.id);
  const migrationName = '0018_m1_retry_boundary_closure.sql';
  addMigration(migrationsDirectory, migrationName);

  assert.throws(
    () => openSqliteControlStore({ filename, migrationsDirectory, now: () => transitionedAt }),
    /legacy-unbounded-retry-state/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
      .pluck()
      .get(migrationName),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('workflows_m1_retry_boundary_update_guard', 'attempts_m1_retry_boundary_insert_guard', 'attempts_m1_retry_boundary_history_update_guard', 'attempts_m1_retry_boundary_update_guard')",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE (type = 'table' AND name = 'm1_retry_boundary_migration_guard') OR (type = 'trigger' AND name = 'm1_retry_boundary_migration_guard_reject')",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare('SELECT run_status FROM workflows WHERE id = ?')
      .pluck()
      .get(authority.workflow.id),
    RunStatus.READY,
  );
  assert.equal(
    inspected
      .prepare('SELECT failure_class FROM attempts WHERE id = ?')
      .pluck()
      .get(authority.attempt.id),
    AttemptFailureClass.TRANSIENT_BACKEND,
  );
});

void test('[I-006][I-008][I-028] migration 0018 atomically refuses a cross-phase continuation', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-cross-phase-refusal.sqlite');
  const migrationsDirectory = migrationsBefore(
    t,
    '0018_',
    'codeclosure-retry-boundary-cross-phase-refusal-',
  );
  const oldStore = openSqliteControlStore({ filename, migrationsDirectory, now: () => createdAt });
  const { authority } = seedRunning(oldStore, 'retry-boundary-cross-phase-refusal');
  recordTransientFailure(oldStore, authority, 'retry-boundary-cross-phase-refusal');
  oldStore.close();

  rewriteBlockedTransientWorkflowReady(filename, authority.workflow.id, WorkflowPhase.PLAN);
  const migrationName = '0018_m1_retry_boundary_closure.sql';
  addMigration(migrationsDirectory, migrationName);

  assert.throws(
    () => openSqliteControlStore({ filename, migrationsDirectory, now: () => transitionedAt }),
    /legacy-unbounded-retry-state/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
      .pluck()
      .get(migrationName),
    0,
  );
  assert.deepEqual(
    inspected
      .prepare('SELECT phase, run_status FROM workflows WHERE id = ?')
      .get(authority.workflow.id),
    { phase: WorkflowPhase.PLAN, run_status: RunStatus.READY },
  );
});

void test('[I-006][I-008][I-028] migration 0018 atomically refuses unprovable successful retry history', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-success-history.sqlite');
  const migrationsDirectory = migrationsBefore(
    t,
    '0018_',
    'codeclosure-retry-boundary-success-history-',
  );
  const oldStore = openSqliteControlStore({ filename, migrationsDirectory, now: () => createdAt });
  const { authority } = seedRunning(oldStore, 'retry-boundary-success-history');
  recordTransientFailure(oldStore, authority, 'retry-boundary-success-history');
  oldStore.close();

  rewriteBlockedTransientWorkflowReady(filename, authority.workflow.id);
  const retryAttemptId = appendRawLegacySuccessfulRetry(
    filename,
    authority.workflow.id,
    'retry-boundary-success-history',
  );

  const migrationName = '0018_m1_retry_boundary_closure.sql';
  addMigration(migrationsDirectory, migrationName);

  assert.throws(
    () => openSqliteControlStore({ filename, migrationsDirectory, now: () => transitionedAt }),
    /legacy-unbounded-retry-state/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
      .pluck()
      .get(migrationName),
    0,
  );
  assert.equal(
    inspected
      .prepare('SELECT failure_class FROM attempts WHERE id = ?')
      .pluck()
      .get(authority.attempt.id),
    AttemptFailureClass.TRANSIENT_BACKEND,
  );
  assert.equal(
    inspected.prepare('SELECT status FROM attempts WHERE id = ?').pluck().get(retryAttemptId),
    AttemptStatus.RESULT_RECORDED,
  );
  assert.equal(
    inspected
      .prepare('SELECT run_status FROM workflows WHERE id = ?')
      .pluck()
      .get(authority.workflow.id),
    RunStatus.READY,
  );
});

void test('[I-006][I-008][I-009][I-028] migration 0018 preserves valid blocked and cancelled transient history', async (t) => {
  for (const finalStatus of [RunStatus.BLOCKED, RunStatus.CANCELLED] as const) {
    await t.test(finalStatus, (subtest) => {
      const namespace = `retry-boundary-valid-${finalStatus.toLowerCase()}`;
      const filename = temporaryDatabase(subtest, `${namespace}.sqlite`);
      const migrationsDirectory = migrationsBefore(subtest, '0018_', `codeclosure-${namespace}-`);
      const oldStore = openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => createdAt,
      });
      const { authority } = seedRunning(oldStore, namespace);
      recordTransientFailure(oldStore, authority, namespace);
      if (finalStatus === RunStatus.CANCELLED) {
        const blocked = oldStore.getWorkflow(authority.workflow.id);
        assert.ok(blocked);
        const cancelled = authority.kernel.cancelGoal({
          commandId: commandId(`command_${namespace}-cancel`),
          goalId: authority.goal.id,
          expectedGoalRevision: authority.goal.revision,
          expectedWorkflowVersion: blocked.version,
          reason: 'operator cancelled retained transient blocker',
        });
        assert.equal(cancelled.status, 'APPLIED');
      }
      oldStore.close();

      const migrationName = '0018_m1_retry_boundary_closure.sql';
      addMigration(migrationsDirectory, migrationName);
      const migrated = openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => transitionedAt,
      });
      assert.equal(migrated.getWorkflow(authority.workflow.id)?.phase, WorkflowPhase.DISCOVERY);
      assert.equal(migrated.getWorkflow(authority.workflow.id)?.runStatus, finalStatus);
      assert.equal(
        migrated.getAttempt(authority.attempt.id)?.failureClass,
        AttemptFailureClass.TRANSIENT_BACKEND,
      );
      migrated.close();

      const inspected = new Database(filename, { readonly: true, fileMustExist: true });
      assert.equal(
        inspected
          .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
          .pluck()
          .get(migrationName),
        1,
      );
      assert.equal(
        inspected
          .prepare(
            "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('workflows_m1_retry_boundary_update_guard', 'attempts_m1_retry_boundary_insert_guard', 'attempts_m1_retry_boundary_history_update_guard', 'attempts_m1_retry_boundary_update_guard')",
          )
          .pluck()
          .get(),
        4,
      );
      inspected.close();

      const reopened = openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => afterCancellationAt,
      });
      subtest.after(() => reopened.close());
      assert.equal(reopened.getWorkflow(authority.workflow.id)?.runStatus, finalStatus);
      assert.equal(reopened.nextAttemptSequence(authority.workflow.id), 2);
    });
  }
});

void test('[I-006][I-008][I-009] migration 0019 atomically refuses a legacy Workflow-first half-state', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-migration-half-state.sqlite');
  const migrationsDirectory = migrationsBefore(
    t,
    '0019_',
    'codeclosure-attempt-authority-refusal-',
  );
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const { authority } = seedRunning(oldStore, 'attempt-authority-migration-half-state');
  oldStore.close();

  const legacy = new Database(filename);
  legacy
    .prepare(
      `UPDATE workflows
            SET run_status = 'BLOCKED', active_attempt_id = NULL,
                suspended_reason = 'WORKER_BACKEND_FAILURE',
                version = version + 1, updated_at = ?
          WHERE id = ?`,
    )
    .run(attemptFinishedAt, authority.workflow.id);
  legacy.close();

  const migrationName = '0019_m1_attempt_authority_closure.sql';
  addMigration(migrationsDirectory, migrationName);
  assert.throws(
    () => openSqliteControlStore({ filename, migrationsDirectory, now: () => transitionedAt }),
    /legacy-m1-attempt-authority-state/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
      .pluck()
      .get(migrationName),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('workflows_running_attempt_release_guard', 'workflows_m1_active_attempt_phase_insert_guard', 'workflows_m1_active_attempt_phase_update_guard', 'attempts_m1_worker_result_kind_guard', 'attempts_m1_worker_failure_mapping_guard')",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE (type = 'table' AND name = 'm1_attempt_authority_migration_guard') OR (type = 'trigger' AND name = 'm1_attempt_authority_migration_guard_reject')",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare('SELECT run_status FROM workflows WHERE id = ?')
      .pluck()
      .get(authority.workflow.id),
    RunStatus.BLOCKED,
  );
  assert.equal(
    inspected.prepare('SELECT status FROM attempts WHERE id = ?').pluck().get(authority.attempt.id),
    AttemptStatus.RUNNING,
  );
});

void test('[I-006][I-008][I-009] migration 0019 atomically refuses a legacy Attempt-first half-state', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-migration-attempt-first.sqlite');
  const migrationsDirectory = migrationsBefore(
    t,
    '0019_',
    'codeclosure-attempt-authority-attempt-first-refusal-',
  );
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const { authority } = seedRunning(oldStore, 'attempt-authority-migration-attempt-first');
  oldStore.close();

  const legacy = new Database(filename);
  legacy
    .prepare(
      `UPDATE attempts
          SET status = 'RESULT_RECORDED', termination_reason = ?, ended_at = ?
        WHERE id = ?`,
    )
    .run('WORKER_RESULT:PROPOSALS', attemptFinishedAt, authority.attempt.id);
  legacy.close();

  const migrationName = '0019_m1_attempt_authority_closure.sql';
  addMigration(migrationsDirectory, migrationName);
  assert.throws(
    () => openSqliteControlStore({ filename, migrationsDirectory, now: () => transitionedAt }),
    /legacy-m1-attempt-authority-state/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
      .pluck()
      .get(migrationName),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('workflows_running_attempt_release_guard', 'workflows_m1_active_attempt_phase_insert_guard', 'workflows_m1_active_attempt_phase_update_guard', 'attempts_m1_worker_result_kind_guard', 'attempts_m1_worker_failure_mapping_guard')",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE (type = 'table' AND name = 'm1_attempt_authority_migration_guard') OR (type = 'trigger' AND name = 'm1_attempt_authority_migration_guard_reject')",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare('SELECT run_status FROM workflows WHERE id = ?')
      .pluck()
      .get(authority.workflow.id),
    RunStatus.RUNNING,
  );
  assert.equal(
    inspected.prepare('SELECT status FROM attempts WHERE id = ?').pluck().get(authority.attempt.id),
    AttemptStatus.RESULT_RECORDED,
  );
});

void test('[I-006][I-008][I-009] migration 0019 atomically refuses an active Attempt from another phase', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-migration-phase-mismatch.sqlite');
  const migrationsDirectory = migrationsBefore(
    t,
    '0019_',
    'codeclosure-attempt-authority-phase-refusal-',
  );
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const { authority } = seedRunning(oldStore, 'attempt-authority-migration-phase-mismatch');
  oldStore.close();

  const legacy = new Database(filename);
  legacy
    .prepare('UPDATE workflows SET phase = ? WHERE id = ?')
    .run(WorkflowPhase.PLAN, authority.workflow.id);
  legacy.close();

  const migrationName = '0019_m1_attempt_authority_closure.sql';
  addMigration(migrationsDirectory, migrationName);
  assert.throws(
    () => openSqliteControlStore({ filename, migrationsDirectory, now: () => transitionedAt }),
    /legacy-m1-attempt-authority-state/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
      .pluck()
      .get(migrationName),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('workflows_running_attempt_release_guard', 'workflows_m1_active_attempt_phase_insert_guard', 'workflows_m1_active_attempt_phase_update_guard', 'attempts_m1_worker_result_kind_guard', 'attempts_m1_worker_failure_mapping_guard')",
      )
      .pluck()
      .get(),
    0,
  );
  assert.deepEqual(
    inspected
      .prepare(
        `SELECT workflow.phase AS workflow_phase, attempt.phase AS attempt_phase
           FROM workflows AS workflow
           JOIN attempts AS attempt ON attempt.id = workflow.active_attempt_id
          WHERE workflow.id = ?`,
      )
      .get(authority.workflow.id),
    { workflow_phase: WorkflowPhase.PLAN, attempt_phase: WorkflowPhase.DISCOVERY },
  );
});

void test('[I-006][I-008][I-009] migration 0019 atomically refuses a rewritten current terminal status', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-migration-terminal-status.sqlite');
  const migrationsDirectory = migrationsBefore(
    t,
    '0019_',
    'codeclosure-attempt-authority-terminal-status-refusal-',
  );
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const { authority } = seedRunning(oldStore, 'attempt-authority-migration-terminal-status');
  recordProtocolFailure(oldStore, authority, 'attempt-authority-migration-terminal-status');
  oldStore.close();

  const legacy = new Database(filename);
  const rewrite = legacy
    .prepare("UPDATE workflows SET run_status = 'BLOCKED' WHERE id = ? AND run_status = 'FAILED'")
    .run(authority.workflow.id);
  assert.equal(rewrite.changes, 1);
  legacy.close();

  const migrationName = '0019_m1_attempt_authority_closure.sql';
  addMigration(migrationsDirectory, migrationName);
  assert.throws(
    () => openSqliteControlStore({ filename, migrationsDirectory, now: () => transitionedAt }),
    /legacy-m1-attempt-authority-state/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) FROM schema_migrations WHERE name = ?')
      .pluck()
      .get(migrationName),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name IN ('workflows_running_attempt_release_guard', 'workflows_m1_active_attempt_phase_insert_guard', 'workflows_m1_active_attempt_phase_update_guard', 'attempts_m1_worker_result_kind_guard', 'attempts_m1_worker_failure_mapping_guard')",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare('SELECT run_status FROM workflows WHERE id = ?')
      .pluck()
      .get(authority.workflow.id),
    RunStatus.BLOCKED,
  );
});

void test('[I-008][I-009][I-028] Store attempt-first completion persists and reopens a transient blocker', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-blocked-reopen.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'retry-boundary-blocked-reopen');

  recordTransientFailure(store, authority, 'retry-boundary-blocked-reopen');
  assert.equal(store.getWorkflow(authority.workflow.id)?.suspendedReason, 'WORKER_BACKEND_FAILURE');
  store.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.BLOCKED);
  assert.equal(reopened.getWorkflow(authority.workflow.id)?.activeAttemptId, undefined);
  assert.equal(reopened.getAttempt(authority.attempt.id)?.status, AttemptStatus.FAILED);
  assert.equal(
    reopened.getAttempt(authority.attempt.id)?.failureClass,
    AttemptFailureClass.TRANSIENT_BACKEND,
  );
});

void test('[I-006][I-008][I-028] Store transaction never exposes attempt-first transient half-state', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-reader-isolation.sqlite');
  const readerState: {
    observer?: Database.Database;
    authorityId?: Attempt['id'];
    workflowIdentifier?: WorkflowInstance['id'];
  } = {};
  let observedAttemptFirstWrite = false;
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: (step) => {
      const { observer, authorityId, workflowIdentifier } = readerState;
      if (
        observer === undefined ||
        authorityId === undefined ||
        workflowIdentifier === undefined ||
        observedAttemptFirstWrite ||
        step !== TransactionStep.AFTER_ATTEMPT_STATE_WRITE
      ) {
        return;
      }
      observedAttemptFirstWrite = true;
      assert.equal(
        observer.prepare('SELECT status FROM attempts WHERE id = ?').pluck().get(authorityId),
        AttemptStatus.RUNNING,
      );
      assert.equal(
        observer
          .prepare('SELECT run_status FROM workflows WHERE id = ?')
          .pluck()
          .get(workflowIdentifier),
        RunStatus.RUNNING,
      );
    },
  });
  t.after(() => store.close());
  const { authority } = seedRunning(store, 'retry-boundary-reader-isolation');
  const authorityId = authority.attempt.id;
  const workflowIdentifier = authority.workflow.id;
  const observer = new Database(filename, { readonly: true, fileMustExist: true });
  Object.assign(readerState, { observer, authorityId, workflowIdentifier });
  t.after(() => observer.close());

  recordTransientFailure(store, authority, 'retry-boundary-reader-isolation');

  assert.equal(observedAttemptFirstWrite, true);
  assert.equal(
    observer.prepare('SELECT status FROM attempts WHERE id = ?').pluck().get(authorityId),
    AttemptStatus.FAILED,
  );
  assert.equal(
    observer
      .prepare('SELECT run_status FROM workflows WHERE id = ?')
      .pluck()
      .get(workflowIdentifier),
    RunStatus.BLOCKED,
  );
});

void test('[I-006][I-008][I-009][I-028] reopen rejects a committed raw transient half-state', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-raw-half-state.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'retry-boundary-raw-half-state');
  store.close();

  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  const rawWrite = database
    .prepare(
      `UPDATE attempts
          SET status = 'FAILED', failure_class = 'TRANSIENT_BACKEND',
              termination_reason = 'WORKER_BACKEND_FAILURE', ended_at = ?
        WHERE id = ?`,
    )
    .run(attemptFinishedAt, authority.attempt.id);
  assert.equal(rawWrite.changes, 1);
  assert.equal(
    database
      .prepare('SELECT run_status FROM workflows WHERE id = ?')
      .pluck()
      .get(authority.workflow.id),
    RunStatus.RUNNING,
  );
  database.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => transitionedAt }),
    /exact bidirectional RUNNING Attempt authority/,
  );
});

void test('[I-006][I-008] SQLite rejects Workflow-first completion before it can strand a RUNNING Attempt', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-workflow-first.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'attempt-authority-workflow-first');
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  database.pragma('foreign_keys = ON');
  const finish = database.transaction(() => {
    database
      .prepare(
        `UPDATE workflows
              SET run_status = 'BLOCKED', version = version + 1,
                  active_attempt_id = NULL, suspended_reason = 'WORKER_BACKEND_FAILURE',
                  updated_at = ?
            WHERE id = ?`,
      )
      .run(attemptFinishedAt, authority.workflow.id);
    database
      .prepare(
        `UPDATE attempts
              SET status = 'FAILED', failure_class = 'TRANSIENT_BACKEND',
                  termination_reason = 'WORKER_BACKEND_FAILURE', ended_at = ?
            WHERE id = ?`,
      )
      .run(attemptFinishedAt, authority.attempt.id);
  });

  assert.throws(finish, /Workflow cannot release a RUNNING Attempt/);
  assert.deepEqual(
    database
      .prepare('SELECT run_status, active_attempt_id FROM workflows WHERE id = ?')
      .get(authority.workflow.id),
    { run_status: RunStatus.RUNNING, active_attempt_id: authority.attempt.id },
  );
  assert.deepEqual(
    database
      .prepare('SELECT status, failure_class FROM attempts WHERE id = ?')
      .get(authority.attempt.id),
    { status: AttemptStatus.RUNNING, failure_class: null },
  );
});

void test('[I-006][I-008] SQLite rejects a non-retryable failure projected as BLOCKED', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-terminal-projection.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'attempt-authority-terminal-projection');
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  database.pragma('foreign_keys = ON');
  const finish = database.transaction(() => {
    database
      .prepare(
        `UPDATE attempts
            SET status = 'FAILED', failure_class = 'PROTOCOL_ERROR',
                termination_reason = 'WORKER_STREAM_NO_TERMINAL_EVENT', ended_at = ?
          WHERE id = ?`,
      )
      .run(attemptFinishedAt, authority.attempt.id);
    database
      .prepare(
        `UPDATE workflows
            SET run_status = 'BLOCKED', version = version + 1,
                active_attempt_id = NULL,
                suspended_reason = 'WORKER_STREAM_NO_TERMINAL_EVENT', updated_at = ?
          WHERE id = ?`,
      )
      .run(attemptFinishedAt, authority.workflow.id);
  });

  assert.throws(finish, /exact terminal projection/);
  assert.deepEqual(
    database
      .prepare('SELECT run_status, version, active_attempt_id FROM workflows WHERE id = ?')
      .get(authority.workflow.id),
    {
      run_status: RunStatus.RUNNING,
      version: authority.workflow.version,
      active_attempt_id: authority.attempt.id,
    },
  );
  assert.deepEqual(
    database
      .prepare('SELECT status, failure_class FROM attempts WHERE id = ?')
      .get(authority.attempt.id),
    { status: AttemptStatus.RUNNING, failure_class: null },
  );
});

void test('[I-006][I-008] SQLite rejects changing a RUNNING Workflow away from its active Attempt phase', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-phase-trigger.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'attempt-authority-phase-trigger');
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  assert.throws(
    () =>
      database
        .prepare('UPDATE workflows SET phase = ? WHERE id = ?')
        .run(WorkflowPhase.PLAN, authority.workflow.id),
    /active Attempt does not belong to its current phase/,
  );
  assert.equal(
    database.prepare('SELECT phase FROM workflows WHERE id = ?').pluck().get(authority.workflow.id),
    WorkflowPhase.DISCOVERY,
  );
});

void test('[I-006][I-008][I-009][I-010] active phase mismatch fails closed on reads, commands, and reopen', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-phase-poison.sqlite');
  let probeCalls = 0;
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: () => {
      probeCalls += 1;
    },
  });
  t.after(() => store.close());
  const { authority } = seedRunning(store, 'attempt-authority-phase-poison');

  const database = new Database(filename);
  database.exec('DROP TRIGGER workflows_m1_active_attempt_phase_update_guard');
  database
    .prepare('UPDATE workflows SET phase = ? WHERE id = ?')
    .run(WorkflowPhase.PLAN, authority.workflow.id);
  database.close();

  assert.throws(
    () => store.getGoalStatusAuthority(authority.goal.id),
    /no exact active Attempt authority/,
  );

  probeCalls = 0;
  const cancellation = authority.kernel.cancelGoal({
    commandId: commandId('command_attempt-authority-phase-poison-cancel'),
    goalId: authority.goal.id,
    expectedGoalRevision: authority.goal.revision,
    expectedWorkflowVersion: authority.workflow.version,
    reason: 'operator requested cancellation after retained corruption',
  });
  assert.equal(cancellation.status, 'REJECTED');
  assert.equal(cancellation.output.ok, false);
  assert.equal(cancellation.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  assert.match(cancellation.output.error.message, /bidirectional RUNNING Attempt authority/);
  assert.equal(probeCalls, 0);

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => transitionedAt }),
    /bidirectional RUNNING Attempt authority/,
  );
});

void test('[I-006][I-008][I-009] Store reopen rejects a committed Workflow-first half-state even without its trigger', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-reopen-half-state.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'attempt-authority-reopen-half-state');
  store.close();

  const database = new Database(filename);
  database.exec('DROP TRIGGER workflows_running_attempt_release_guard');
  database
    .prepare(
      `UPDATE workflows
            SET run_status = 'BLOCKED', active_attempt_id = NULL,
                suspended_reason = 'WORKER_BACKEND_FAILURE'
          WHERE id = ?`,
    )
    .run(authority.workflow.id);
  database.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => transitionedAt }),
    /exact bidirectional RUNNING Attempt authority/,
  );
});

void test('[I-006][I-008][I-009][I-010] a rewritten current terminal status fails closed on reads, commands, and reopen', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-current-terminal-poison.sqlite');
  let probeCalls = 0;
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: () => {
      probeCalls += 1;
    },
  });
  t.after(() => store.close());
  const { creation, authority } = seedRunning(store, 'attempt-authority-current-terminal-poison');
  const failedWorkflow = recordProtocolFailure(
    store,
    authority,
    'attempt-authority-current-terminal-poison',
  );

  const database = new Database(filename);
  const rewrite = database
    .prepare("UPDATE workflows SET run_status = 'BLOCKED' WHERE id = ? AND run_status = 'FAILED'")
    .run(authority.workflow.id);
  assert.equal(rewrite.changes, 1);
  database.close();

  assert.throws(
    () => store.getGoalStatusAuthority(creation.goal.id),
    /current state has no exact command and audit authority/,
  );

  probeCalls = 0;
  const cancellation = authority.kernel.cancelGoal({
    commandId: commandId('command_attempt-authority-current-terminal-poison-cancel'),
    goalId: creation.goal.id,
    expectedGoalRevision: creation.goal.revision,
    expectedWorkflowVersion: failedWorkflow.version,
    reason: 'operator requested cancellation after retained corruption',
  });
  assert.equal(cancellation.status, 'REJECTED');
  assert.equal(cancellation.output.ok, false);
  assert.equal(cancellation.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  assert.match(
    cancellation.output.error.message,
    /current state has no exact command and audit authority/,
  );
  assert.equal(probeCalls, 0);

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => transitionedAt }),
    /current state has no exact command and audit authority/,
  );
});

void test('[I-006][I-008][I-009] reopen rejects rewritten historical terminal outcome authority', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-historical-outcome-poison.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'attempt-authority-historical-outcome-poison');
  const resultInput = resultAttemptInput(
    authority.workflow,
    authority.attempt,
    'attempt-authority-historical-outcome-poison',
  );
  const finished = store.commitAttemptEvent(resultInput);
  assert.equal(finished.status, 'APPLIED');
  const transition = transitionInput(
    finished.value.workflow,
    'attempt-authority-historical-outcome-poison',
    afterCancellationAt,
  );
  assert.equal(store.commitWorkflowEvent(transition).status, 'APPLIED');
  store.close();

  const database = new Database(filename);
  database.exec('DROP TRIGGER processed_commands_no_update');
  const rewrite = database
    .prepare(
      `UPDATE processed_commands
          SET outcome_json = json_set(
            outcome_json,
            '$.workflow.runStatus', 'FAILED',
            '$.output.runStatus', 'FAILED'
          )
        WHERE command_id = ?`,
    )
    .run(resultInput.event.commandId);
  assert.equal(rewrite.changes, 1);
  database.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => afterCancellationAt }),
    /Terminal Attempt .* has no exact command, audit, and Workflow outcome authority/,
  );
});

void test('[I-006][I-008][I-010] Store refuses cancellation before mutating a retained Workflow-first half-state', (t) => {
  const filename = temporaryDatabase(t, 'attempt-authority-pre-operation.sqlite');
  let probeCalls = 0;
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: () => {
      probeCalls += 1;
    },
  });
  t.after(() => store.close());
  const { authority } = seedRunning(store, 'attempt-authority-pre-operation');

  const database = new Database(filename);
  database.exec('DROP TRIGGER workflows_running_attempt_release_guard');
  database
    .prepare(
      `UPDATE workflows
            SET run_status = 'BLOCKED', active_attempt_id = NULL,
                suspended_reason = 'WORKER_BACKEND_FAILURE'
          WHERE id = ?`,
    )
    .run(authority.workflow.id);
  database.close();

  const corrupted = store.getWorkflow(authority.workflow.id);
  assert.ok(corrupted);
  assert.equal(corrupted.runStatus, RunStatus.BLOCKED);
  probeCalls = 0;
  const cancellation = authority.kernel.cancelGoal({
    commandId: commandId('command_attempt-authority-pre-operation-cancel'),
    goalId: authority.goal.id,
    expectedGoalRevision: authority.goal.revision,
    expectedWorkflowVersion: corrupted.version,
    reason: 'operator requested cancellation after retained corruption',
  });

  assert.equal(cancellation.status, 'REJECTED');
  assert.equal(cancellation.output.ok, false);
  assert.equal(cancellation.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  assert.match(cancellation.output.error.message, /exact bidirectional RUNNING Attempt authority/);
  assert.equal(probeCalls, 0);
  assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.BLOCKED);
  assert.equal(store.getAttempt(authority.attempt.id)?.status, AttemptStatus.RUNNING);
});

void test('[I-006][I-008][I-028] SQLite rejects both write orders that leave a transient failure READY', async (t) => {
  for (const order of ['attempt-first', 'workflow-first'] as const) {
    await t.test(order, (subtest) => {
      const filename = temporaryDatabase(subtest, `retry-boundary-${order}.sqlite`);
      const store = openSqliteControlStore({ filename, now: () => createdAt });
      const { authority } = seedRunning(store, `retry-boundary-${order}`);
      store.close();

      const database = new Database(filename);
      subtest.after(() => database.close());
      database.pragma('foreign_keys = ON');
      const finishAttempt = (): void => {
        database
          .prepare(
            `UPDATE attempts
                SET status = 'FAILED', failure_class = 'TRANSIENT_BACKEND',
                    termination_reason = 'WORKER_BACKEND_FAILURE', ended_at = ?
              WHERE id = ?`,
          )
          .run(attemptFinishedAt, authority.attempt.id);
      };
      const leaveWorkflowReady = (): void => {
        database
          .prepare(
            `UPDATE workflows
                SET run_status = 'READY', version = version + 1,
                    active_attempt_id = NULL, suspended_reason = NULL, updated_at = ?
              WHERE id = ?`,
          )
          .run(attemptFinishedAt, authority.workflow.id);
      };
      const unsafeWrite = database.transaction(() => {
        if (order === 'attempt-first') {
          finishAttempt();
          leaveWorkflowReady();
        } else {
          leaveWorkflowReady();
          finishAttempt();
        }
      });

      assert.throws(
        unsafeWrite,
        /M1 transient failure cannot (authorize Workflow continuation|bind invalid Workflow state)|Workflow cannot release a RUNNING Attempt/,
      );
      assert.equal(
        database
          .prepare('SELECT run_status FROM workflows WHERE id = ?')
          .pluck()
          .get(authority.workflow.id),
        RunStatus.RUNNING,
      );
      assert.equal(
        database
          .prepare('SELECT active_attempt_id FROM workflows WHERE id = ?')
          .pluck()
          .get(authority.workflow.id),
        authority.attempt.id,
      );
      assert.equal(
        database
          .prepare('SELECT status FROM attempts WHERE id = ?')
          .pluck()
          .get(authority.attempt.id),
        AttemptStatus.RUNNING,
      );
      assert.equal(
        database
          .prepare('SELECT failure_class FROM attempts WHERE id = ?')
          .pluck()
          .get(authority.attempt.id),
        null,
      );
    });
  }
});

void test('[I-006][I-008][I-028] SQLite rejects phase advancement after a transient failure', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-phase-advance.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'retry-boundary-phase-advance');
  recordTransientFailure(store, authority, 'retry-boundary-phase-advance');
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE workflows
              SET phase = 'PLAN', run_status = 'READY', version = version + 1,
                  active_attempt_id = NULL, suspended_reason = NULL, updated_at = ?
            WHERE id = ?`,
        )
        .run(afterCancellationAt, authority.workflow.id),
    /M1 transient failure cannot authorize Workflow continuation/,
  );
  assert.deepEqual(
    database
      .prepare('SELECT phase, run_status FROM workflows WHERE id = ?')
      .get(authority.workflow.id),
    { phase: WorkflowPhase.DISCOVERY, run_status: RunStatus.BLOCKED },
  );
});

void test('[I-006][I-008][I-028] SQLite rejects a later cross-phase Attempt after a transient failure', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-later-attempt.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'retry-boundary-later-attempt');
  recordTransientFailure(store, authority, 'retry-boundary-later-attempt');
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  database.pragma('foreign_keys = ON');
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO attempts(
             id, workflow_id, phase, sequence, context_manifest_id,
             capability_grant_json, worker_session_ref, status, failure_class,
             termination_reason, started_at, ended_at
           ) VALUES (?, ?, 'PLAN', 2, NULL, ?, NULL, 'RUNNING', NULL, NULL, ?, NULL)`,
        )
        .run(
          'attempt_retry-boundary-later-attempt-2',
          authority.workflow.id,
          JSON.stringify(deriveCapabilityGrant(WorkflowPhase.PLAN)),
          afterCancellationAt,
        ),
    /M1 transient failure cannot authorize another Attempt/,
  );
  assert.equal(
    database
      .prepare('SELECT COUNT(*) FROM attempts WHERE workflow_id = ?')
      .pluck()
      .get(authority.workflow.id),
    1,
  );
});

void test('[I-008][I-028] a transient blocker may still be cancelled without continuation authority', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-cancellation.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'retry-boundary-cancellation');
  recordTransientFailure(store, authority, 'retry-boundary-cancellation');
  const blocked = store.getWorkflow(authority.workflow.id);
  assert.ok(blocked);

  const cancelled = authority.kernel.cancelGoal({
    commandId: commandId('command_retry-boundary-cancellation'),
    goalId: authority.goal.id,
    expectedGoalRevision: authority.goal.revision,
    expectedWorkflowVersion: blocked.version,
    reason: 'operator cancelled the blocked M1 workflow',
  });
  assert.equal(cancelled.status, 'APPLIED');
  assert.equal(cancelled.output.runStatus, RunStatus.CANCELLED);
  store.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(authority.workflow.id)?.phase, WorkflowPhase.DISCOVERY);
  assert.equal(reopened.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.CANCELLED);
  assert.equal(reopened.nextAttemptSequence(authority.workflow.id), 2);
});

void test('[I-006][I-008][I-028] Store rejects retained retry corruption before running a new transaction operation', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-pre-operation.sqlite');
  let probeCalls = 0;
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: () => {
      probeCalls += 1;
    },
  });
  t.after(() => store.close());
  const { authority } = seedRunning(store, 'retry-boundary-pre-operation');
  recordTransientFailure(store, authority, 'retry-boundary-pre-operation');

  const database = new Database(filename);
  database.exec('DROP TRIGGER workflows_m1_retry_boundary_update_guard');
  database.exec('DROP TRIGGER attempts_m1_retry_boundary_insert_guard');
  database
    .prepare(
      `UPDATE workflows
          SET phase = 'PLAN', run_status = 'READY',
              active_attempt_id = NULL, suspended_reason = NULL
        WHERE id = ?`,
    )
    .run(authority.workflow.id);
  database.close();

  const corrupted = store.getWorkflow(authority.workflow.id);
  assert.ok(corrupted);
  assert.equal(corrupted.phase, WorkflowPhase.PLAN);
  assert.equal(corrupted.runStatus, RunStatus.READY);
  probeCalls = 0;
  const retry = authority.kernel.beginAttempt({
    commandId: commandId('command_retry-boundary-pre-operation-retry'),
    workflowId: corrupted.id,
    expectedWorkflowVersion: corrupted.version,
  });

  assert.equal(retry.status, 'REJECTED');
  assert.equal(retry.output.ok, false);
  assert.equal(retry.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  assert.equal(retry.output.error.detailCode, 'COMMAND_COMMIT_FAILURE');
  assert.match(retry.output.error.message, /unprovable M1 transient retry authority/);
  assert.equal(probeCalls, 0);
  assert.equal(store.nextAttemptSequence(authority.workflow.id), 2);
});

void test('[I-006][I-009][I-028] Store startup rejects retained cross-phase continuation even without SQLite triggers', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-startup-defense.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'retry-boundary-startup-defense');
  recordTransientFailure(store, authority, 'retry-boundary-startup-defense');
  store.close();

  const database = new Database(filename);
  database.exec('DROP TRIGGER workflows_m1_retry_boundary_update_guard');
  database.exec('DROP TRIGGER attempts_m1_retry_boundary_update_guard');
  database
    .prepare(
      `UPDATE workflows
          SET phase = 'PLAN', run_status = 'READY',
              active_attempt_id = NULL, suspended_reason = NULL
        WHERE id = ?`,
    )
    .run(authority.workflow.id);
  database.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => transitionedAt }),
    /unprovable M1 transient retry authority/,
  );
});

void test('[I-006][I-009][I-028] Store startup rejects retained later-Attempt retry history', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-startup-history.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedReady(store, 'retry-boundary-startup-history');
  const secondStart = authority.kernel.beginAttempt({
    commandId: commandId('command_retry-boundary-startup-history-second-start'),
    workflowId: authority.workflow.id,
    expectedWorkflowVersion: authority.workflow.version,
  });
  assert.equal(secondStart.status, 'APPLIED');
  const running = store.getWorkflow(authority.workflow.id);
  assert.ok(running?.activeAttemptId);
  const secondFinish = authority.kernel.recordAttemptResult({
    commandId: commandId('command_retry-boundary-startup-history-second-finish'),
    workflowId: authority.workflow.id,
    expectedWorkflowVersion: running.version,
    attemptId: running.activeAttemptId,
    reason: 'WORKER_RESULT:PROPOSALS',
  });
  assert.equal(secondFinish.status, 'APPLIED');
  store.close();

  rewriteRecordedAttemptAsEarlierTransientFailure(filename, authority.attempt.id);

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => transitionedAt }),
    /unprovable M1 transient retry authority/,
  );
});

void test('[I-006][I-008][I-028] SQLite history guard rejects turning an earlier Attempt into a transient failure', (t) => {
  const filename = temporaryDatabase(t, 'retry-boundary-history-update-guard.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedReady(store, 'retry-boundary-history-update-guard');
  const secondStart = authority.kernel.beginAttempt({
    commandId: commandId('command_retry-boundary-history-update-guard-second-start'),
    workflowId: authority.workflow.id,
    expectedWorkflowVersion: authority.workflow.version,
  });
  assert.equal(secondStart.status, 'APPLIED');
  const running = store.getWorkflow(authority.workflow.id);
  assert.ok(running?.activeAttemptId);
  assert.equal(
    authority.kernel.recordAttemptResult({
      commandId: commandId('command_retry-boundary-history-update-guard-second-finish'),
      workflowId: authority.workflow.id,
      expectedWorkflowVersion: running.version,
      attemptId: running.activeAttemptId,
      reason: 'WORKER_RESULT:PROPOSALS',
    }).status,
    'APPLIED',
  );
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  database.exec('DROP TRIGGER attempts_terminal_immutable');
  database.exec('DROP TRIGGER attempts_lifecycle_guard');
  assert.equal(
    database
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'trigger' AND name = 'attempts_m1_retry_boundary_history_update_guard'",
      )
      .pluck()
      .get(),
    1,
  );
  const rewrite = database.transaction(() => {
    database
      .prepare(
        `UPDATE workflows
            SET run_status = 'BLOCKED', suspended_reason = 'WORKER_BACKEND_FAILURE',
                version = version + 1, updated_at = ?
          WHERE id = ?`,
      )
      .run(afterCancellationAt, authority.workflow.id);
    database
      .prepare(
        `UPDATE attempts
            SET status = 'FAILED', failure_class = 'TRANSIENT_BACKEND',
                termination_reason = 'WORKER_BACKEND_FAILURE', ended_at = ?
          WHERE id = ?`,
      )
      .run(legacyRetryFinishedAt, authority.attempt.id);
  });

  assert.throws(rewrite, /M1 transient failure cannot authorize another Attempt/);
  assert.equal(
    database
      .prepare('SELECT run_status FROM workflows WHERE id = ?')
      .pluck()
      .get(authority.workflow.id),
    RunStatus.READY,
  );
  assert.equal(
    database.prepare('SELECT status FROM attempts WHERE id = ?').pluck().get(authority.attempt.id),
    AttemptStatus.RESULT_RECORDED,
  );
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

void test('[I-003][I-006][I-009] status query and reopen share the exact start-authority closure', (t) => {
  const filename = temporaryDatabase(t, 'query-start-authority-closure.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { creation, authority } = seedReady(store, 'query-start-authority-closure');
  const manifestIdentifier = authority.attempt.contextManifestId;
  if (manifestIdentifier === undefined) {
    assert.fail('Started query fixture must retain its first Context Manifest');
  }

  const raw = new Database(filename);
  raw.exec('DROP TRIGGER context_manifests_no_update');
  raw
    .prepare('UPDATE context_manifests SET compiler_version = ? WHERE id = ?')
    .run('tampered-query-compiler-v2', manifestIdentifier);
  raw.close();

  assert.throws(
    () => store.getGoalStatusAuthority(creation.goal.id),
    /digest does not match its canonical projection/,
  );
  assert.throws(
    () => store.getWorkflowDriverAuthority(creation.goal.id),
    /digest does not match its canonical projection/,
  );
  assert.throws(
    () => store.getRecoveryCatalogForGoal(creation.goal.id),
    /digest does not match its canonical projection/,
  );
  assert.throws(
    () => store.getAcceptanceAuthorityForWorkflow(creation.workflow.id, authority.policy.id),
    /digest does not match its canonical projection/,
  );
  store.close();
  assert.throws(
    () => openSqliteControlStore({ filename, now: () => transitionedAt }),
    /digest does not match its canonical projection/,
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
  const { creation, authority } = seedReady(store, 'reopen');
  const transition = transitionInput(authority.workflow, 'reopen');
  const result = store.commitWorkflowEvent(transition);

  assert.equal(result.status, 'APPLIED');
  assert.equal(result.value.phase, WorkflowPhase.PLAN);
  assert.equal(result.value.version, authority.workflow.version + 1);
  store.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getGoal(creation.goal.id), creation.goal);
  assert.equal(reopened.getWorkflow(creation.workflow.id)?.phase, WorkflowPhase.PLAN);
  assert.equal(reopened.getWorkflow(creation.workflow.id)?.version, result.value.version);
  assert.deepEqual(
    reopened.getProcessedCommand(transition.event.commandId)?.outcome,
    expectedAppliedOutcome(transition.target, transition.event.commandId, result.value),
  );
  assert.equal(reopened.listAuditEvents('GOAL', creation.goal.id).length, 1);
  assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 4);
});

void test('[I-008] Store authors an APPLIED outcome from the committed Workflow state', (t) => {
  const filename = temporaryDatabase(t, 'store-authored-applied.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const { authority } = seedReady(store, 'store-authored-applied');
  const transition = transitionInput(authority.workflow, 'store-authored-applied');

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

void test('[I-003][I-006][I-008] unbound execution bypasses fail closed and roll back', async (t) => {
  await t.test('a raw phase transition cannot start execution authority', (subtest) => {
    const filename = temporaryDatabase(subtest, 'unbound-phase-bypass.sqlite');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    subtest.after(() => store.close());
    const creation = seed(store, 'unbound-phase-bypass');
    const transition = transitionInput(creation.workflow, 'unbound-phase-bypass');

    assert.throws(
      () => store.commitWorkflowEvent(transition),
      /changed execution state without start authority/,
    );
    assert.deepEqual(store.getWorkflow(creation.workflow.id), creation.workflow);
    assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 1);
    assert.equal(store.getProcessedCommand(transition.event.commandId), undefined);
  });

  await t.test('a raw first Attempt cannot manufacture execution authority', (subtest) => {
    const filename = temporaryDatabase(subtest, 'unbound-attempt-bypass.sqlite');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    subtest.after(() => store.close());
    const creation = seed(store, 'unbound-attempt-bypass');
    const attempt = beginAttemptInput(creation.workflow, 'unbound-attempt-bypass');

    assert.throws(
      () => store.commitAttemptEvent(attempt),
      /Attempt history without start authority/,
    );
    assert.deepEqual(store.getWorkflow(creation.workflow.id), creation.workflow);
    if (attempt.event.type !== 'ATTEMPT_STARTED') {
      assert.fail('Unbound bypass fixture must contain ATTEMPT_STARTED');
    }
    assert.equal(store.getAttempt(attempt.event.attempt.id), undefined);
    assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 1);
    assert.equal(store.getProcessedCommand(attempt.event.commandId), undefined);
  });

  await t.test('a later Worker Attempt cannot omit its Context authority', (subtest) => {
    const filename = temporaryDatabase(subtest, 'unbound-later-attempt-bypass.sqlite');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    subtest.after(() => store.close());
    const { creation, authority } = seedReady(store, 'unbound-later-attempt-bypass');
    const attempt = beginAttemptInput(authority.workflow, 'unbound-later-attempt-bypass', 2);

    assert.throws(() => store.commitAttemptEvent(attempt), /has no Context-bound authority/);
    assert.deepEqual(store.getWorkflow(creation.workflow.id), authority.workflow);
    if (attempt.event.type !== 'ATTEMPT_STARTED') {
      assert.fail('Later bypass fixture must contain ATTEMPT_STARTED');
    }
    assert.equal(store.getAttempt(attempt.event.attempt.id), undefined);
    assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
    assert.equal(store.getProcessedCommand(attempt.event.commandId), undefined);
  });
});

void test('[I-008] Store rejects a command completion time older than observed Workflow', (t) => {
  const filename = temporaryDatabase(t, 'store-rejection-causal-time.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const { creation, authority } = seedReady(store, 'store-rejection-causal-time');
  const advanced = store.commitWorkflowEvent(
    transitionInput(authority.workflow, 'store-rejection-causal-time'),
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
  const failed = cancellationRuntimeFor(failing, 'runtime-cancel-rollback-fail').cancelGoal({
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
  const { creation, authority } = seedReady(store, 'duplicate');
  const transition = transitionInput(authority.workflow, 'duplicate');

  const first = store.commitWorkflowEvent(transition);
  const duplicate = store.commitWorkflowEvent(transition);

  assert.equal(first.status, 'APPLIED');
  assert.equal(duplicate.status, 'REPLAYED');
  assert.deepEqual(duplicate.outcome, first.outcome);
  assert.equal(store.getWorkflow(creation.workflow.id)?.version, authority.workflow.version + 1);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 4);

  const conflict = store.commitWorkflowEvent({ ...transition, inputDigest: digest('e') });
  assert.equal(conflict.status, 'COMMAND_CONFLICT');
});

void test('[I-008] a stale workflow event writes no state, audit, or command outcome', (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const { creation, authority } = seedReady(store, 'stale');
  const first = transitionInput(authority.workflow, 'stale-first');
  store.commitWorkflowEvent(first);

  const stale = transitionInput(authority.workflow, 'stale-second');
  assert.equal(store.commitWorkflowEvent(stale).status, 'VERSION_CONFLICT');

  assert.equal(store.getWorkflow(creation.workflow.id)?.version, authority.workflow.version + 1);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 4);
  assert.equal(store.getProcessedCommand(stale.event.commandId), undefined);
});

void test('[I-008] two SQLite connections expose a shared-version race as a typed conflict', (t) => {
  const filename = temporaryDatabase(t, 'two-connection-race.sqlite');
  const firstStore = openSqliteControlStore({ filename, now: () => createdAt });
  const { creation, authority } = seedReady(firstStore, 'two-connection-race');
  const secondStore = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => firstStore.close());
  t.after(() => secondStore.close());

  const first = transitionInput(authority.workflow, 'two-connection-first');
  const second = transitionInput(authority.workflow, 'two-connection-second');

  assert.equal(firstStore.commitWorkflowEvent(first).status, 'APPLIED');
  assert.equal(secondStore.commitWorkflowEvent(second).status, 'VERSION_CONFLICT');
  assert.equal(
    secondStore.getWorkflow(creation.workflow.id)?.version,
    authority.workflow.version + 1,
  );
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

void test('[I-006][I-008][I-009] direct Goal creation requires one exact canonical audit payload', (t) => {
  const filename = temporaryDatabase(t, 'direct-creation-payload-closure.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const input = creationInput('direct-creation-payload-closure');
  assert.throws(
    () => store.createGoalWithWorkflow({ ...input, payloadDigest: digest('b') }),
    /Goal creation has an inconsistent payload digest/,
  );
  assert.equal(store.getGoal(input.goal.id), undefined);
  assert.equal(store.createGoalWithWorkflow(input).status, 'APPLIED');
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER audit_events_no_update');
    const poisoned = database
      .prepare(
        `UPDATE audit_events
            SET payload_digest = ?
          WHERE (aggregate_type = 'GOAL' AND aggregate_id = ?)
             OR (aggregate_type = 'WORKFLOW' AND aggregate_id = ?)`,
      )
      .run(digest('b'), input.goal.id, input.workflow.id);
    assert.equal(poisoned.changes, 2);
  } finally {
    database.close();
  }
  assert.throws(
    () => openSqliteControlStore({ filename, now: () => createdAt }),
    /current state has no exact command and audit authority/,
  );
});

void test('[I-006][I-008][I-009] direct Goal creation audit authority survives Workflow Start', (t) => {
  const filename = temporaryDatabase(t, 'started-direct-creation-payload-closure.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { creation, authority } = seedRunning(store, 'started-direct-creation-payload-closure');
  assert.equal(authority.workflow.version, workflowVersion(2));
  store.close();

  const database = new Database(filename);
  try {
    database.exec('DROP TRIGGER audit_events_no_update');
    const poisoned = database
      .prepare(
        `UPDATE audit_events
            SET payload_digest = ?
          WHERE (aggregate_type = 'GOAL' AND aggregate_id = ? AND event_type = 'GOAL_CREATED')
             OR (aggregate_type = 'WORKFLOW' AND aggregate_id = ? AND event_type = 'WORKFLOW_CREATED')`,
      )
      .run(digest('b'), creation.goal.id, creation.workflow.id);
    assert.equal(poisoned.changes, 2);
  } finally {
    database.close();
  }
  assert.throws(
    () => openSqliteControlStore({ filename, now: () => createdAt }),
    /current state has no exact command and audit authority/,
  );
});

void test('[I-006][I-008][I-009] historical creation closure preserves codec-valid Goal text', (t) => {
  const filename = temporaryDatabase(t, 'creation-payload-codec-text.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const base = creationInput('creation-payload-codec-text');
  const goal = decodeGoalSnapshot({
    ...base.goal,
    objective: `  ${base.goal.objective}  `,
  });
  const creation = Object.freeze({
    ...base,
    goal,
    payloadDigest: canonicalDigests.digest(
      goalAndWorkflowCreationPayloadProjection(goal, base.workflow),
    ),
  });
  assert.equal(store.createGoalWithWorkflow(creation).status, 'APPLIED');
  const authority = startWorkflowAuthorityFixture({
    store,
    goal,
    workflow: creation.workflow,
    namespace: 'creation-payload-codec-text',
  });
  assert.equal(authority.workflow.version, workflowVersion(2));
  store.close();

  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  try {
    assert.equal(reopened.getGoal(goal.id)?.objective, goal.objective);
    assert.equal(reopened.getWorkflow(creation.workflow.id)?.version, workflowVersion(2));
  } finally {
    reopened.close();
  }
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
    const { creation, authority } = seedReady(store, 'malformed-attempt-input');
    const input = beginAttemptInput(authority.workflow, 'malformed-attempt-input', 2);
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
    assert.equal(store.getWorkflow(creation.workflow.id)?.version, authority.workflow.version);
    assert.equal(store.getProcessedCommand(input.event.commandId), undefined);
  });
});

void test('[I-006][I-008][I-009] SQLite Store passes the shared contract and reopens', (t) => {
  const filename = temporaryDatabase(t, 'sqlite-store-contract.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { creation, authority } = seedReady(store, 'sqlite-store-contract');
  const input = transitionInput(authority.workflow, 'sqlite-store-contract');
  const invalidCommandIdentifier = commandId('command_sqlite-store-contract-invalid');

  assertWorkflowControlStoreContract({
    store,
    goalId: creation.goal.id,
    workflowId: creation.workflow.id,
    commandId: input.event.commandId,
    invalidCommandId: invalidCommandIdentifier,
    inputDigest: input.inputDigest,
    target: input.target,
    apply: () => store.commitWorkflowEvent(input),
    conflict: () => store.commitWorkflowEvent({ ...input, inputDigest: digest('e') }),
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

  const attemptIdentifier = authority.attempt.id;
  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => transitionedAt });
  t.after(() => reopened.close());
  assert.notEqual(reopened.getAttempt(attemptIdentifier), undefined);
  assert.notEqual(reopened.getProcessedCommand(input.event.commandId), undefined);
  assert.equal(reopened.listAuditEvents('ATTEMPT', attemptIdentifier).length, 2);
  assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 4);
});

void test('[I-008] injected failure after every transaction step rolls back all writes', async (t) => {
  const steps = Object.values(TransactionStep).filter(
    (step) => step !== TransactionStep.AFTER_ATTEMPT_STATE_WRITE,
  );

  for (const step of steps) {
    await t.test(step, (subtest) => {
      const filename = temporaryDatabase(subtest, `${step.toLowerCase()}.sqlite`);
      const baseline = openSqliteControlStore({ filename, now: () => createdAt });
      const { creation, authority } = seedReady(
        baseline,
        `atomic-${step.toLowerCase().replaceAll('_', '-')}`,
      );
      const transition = transitionInput(
        authority.workflow,
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
      assert.equal(reopened.getWorkflow(creation.workflow.id)?.version, authority.workflow.version);
      assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
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

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => transitionedAt }),
    PersistenceDecodeError,
  );
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
  const second = seedRunning(store, 'authority-boundary-second');
  const began = second.authority;
  store.close();

  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  t.after(() => database.close());

  assert.throws(
    () =>
      database
        .prepare('UPDATE attempts SET worker_session_ref = ? WHERE id = ?')
        .run('WORKER_not-canonical', began.attempt.id),
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
        second.creation.workflow.id,
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
        .run(generationIdentifier, second.creation.workflow.id),
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
  const { creation, authority } = seedReady(store, 'causal-time-triggers');
  const transition = store.commitWorkflowEvent(
    transitionInput(authority.workflow, 'causal-time-triggers'),
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
  const { creation, authority } = seedRunning(store, 'attempt-causal-end');
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
        .run('WORKER_RESULT:PROPOSALS', attemptStartedAt, authority.attempt.id),
    /Attempt cannot end before current Workflow state/,
  );
  assert.equal(
    z
      .object({ status: z.string() })
      .parse(database.prepare('SELECT status FROM attempts WHERE id = ?').get(authority.attempt.id))
      .status,
    AttemptStatus.RUNNING,
  );
});

void test('[I-008] stored transition state equals the pure domain event result', (t) => {
  const filename = temporaryDatabase(t, 'reducer.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const { creation, authority } = seedReady(store, 'reducer-store');
  const transition = transitionInput(authority.workflow, 'reducer-store');
  const expected = applyWorkflowEvent(authority.workflow, transition.event);

  store.commitWorkflowEvent(transition);

  assert.deepEqual(store.getWorkflow(creation.workflow.id), expected);
});

void test('[I-006][I-008][I-009] Attempt start and result survive restart as one Workflow history', (t) => {
  const filename = temporaryDatabase(t, 'attempt-reopen.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { creation, authority } = seedRunning(store, 'attempt-reopen');
  assert.equal(authority.workflow.runStatus, RunStatus.RUNNING);
  assert.equal(authority.workflow.version, 2);
  assert.equal(authority.attempt.status, AttemptStatus.RUNNING);

  const resultInput = resultAttemptInput(authority.workflow, authority.attempt, 'attempt-reopen');
  const expected = applyAttemptEvent(authority.workflow, authority.attempt, resultInput.event);
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
  const { creation, authority } = seedRunning(initial, 'attempt-recovery');
  initial.close();

  const recovered = openSqliteControlStore({ filename, now: () => attemptFinishedAt });
  t.after(() => recovered.close());
  const runningWorkflow = recovered.getWorkflow(creation.workflow.id);
  const runningAttempt = recovered.getAttempt(authority.attempt.id);
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
  assert.equal(reconciled.value.workflow.version, authority.workflow.version + 1);
});

void test('[I-008][I-010] cancellation atomically interrupts the active Attempt without closing', (t) => {
  const filename = temporaryDatabase(t, 'attempt-cancel.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const { creation, authority } = seedRunning(store, 'attempt-cancel');
  const cancellation = cancellationInput(authority.workflow, 'attempt-cancel');

  const cancelled = store.commitWorkflowEvent(cancellation);

  assert.equal(cancelled.status, 'APPLIED');
  assert.equal(cancelled.value.runStatus, RunStatus.CANCELLED);
  assert.notEqual(cancelled.value.runStatus, RunStatus.CLOSED);
  assert.equal(cancelled.value.activeAttemptId, undefined);
  assert.equal(store.getGoal(creation.goal.id)?.status, 'CANCELLED');
  const attempt = store.getAttempt(authority.attempt.id);
  assert.equal(attempt?.status, AttemptStatus.INTERRUPTED);
  assert.match(attempt.terminationReason, /^WORKFLOW_CANCELLED:/);
  assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
  assert.equal(store.listAuditEvents('ATTEMPT', authority.attempt.id).length, 2);
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
  const { creation, authority } = seedRunning(store, 'cancel-audit-required');
  const cancellation = cancellationInput(authority.workflow, 'cancel-audit-required');
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
  assert.equal(store.getAttempt(authority.attempt.id)?.status, AttemptStatus.RUNNING);
  assert.equal(store.getProcessedCommand(cancellation.event.commandId), undefined);
});

void test('[I-008] result/cancellation races persist exactly one winner at a shared version', async (t) => {
  await t.test('result wins', (subtest) => {
    const filename = temporaryDatabase(subtest, 'result-wins.sqlite');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    subtest.after(() => store.close());
    const { creation, authority } = seedRunning(store, 'result-wins');
    const result = resultAttemptInput(authority.workflow, authority.attempt, 'result-wins');
    const cancellation = cancellationInput(authority.workflow, 'result-wins');

    store.commitAttemptEvent(result);
    assert.equal(store.commitWorkflowEvent(cancellation).status, 'VERSION_CONFLICT');

    assert.equal(store.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.READY);
    assert.equal(store.getAttempt(authority.attempt.id)?.status, AttemptStatus.RESULT_RECORDED);
    assert.equal(store.getProcessedCommand(cancellation.event.commandId), undefined);
    assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
    assert.equal(store.listAuditEvents('ATTEMPT', authority.attempt.id).length, 2);
  });

  await t.test('cancellation wins', (subtest) => {
    const filename = temporaryDatabase(subtest, 'cancellation-wins.sqlite');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    subtest.after(() => store.close());
    const { creation, authority } = seedRunning(store, 'cancellation-wins');
    const result = resultAttemptInput(authority.workflow, authority.attempt, 'cancellation-wins');
    const cancellation = cancellationInput(authority.workflow, 'cancellation-wins');

    store.commitWorkflowEvent(cancellation);
    assert.equal(store.commitAttemptEvent(result).status, 'VERSION_CONFLICT');

    assert.equal(store.getWorkflow(creation.workflow.id)?.runStatus, RunStatus.CANCELLED);
    assert.equal(store.getAttempt(authority.attempt.id)?.status, AttemptStatus.INTERRUPTED);
    assert.equal(store.getProcessedCommand(result.event.commandId), undefined);
    assert.equal(store.listAuditEvents('WORKFLOW', creation.workflow.id).length, 3);
    assert.equal(store.listAuditEvents('ATTEMPT', authority.attempt.id).length, 2);
  });
});

void test('[I-008] injected failure rolls back Attempt, Workflow, audit, and command outcome', async (t) => {
  const steps: readonly TransactionStep[] = Object.values(TransactionStep);

  for (const step of steps) {
    await t.test(step, (subtest) => {
      const suffix = `attempt-atomic-${step.toLowerCase().replaceAll('_', '-')}`;
      const filename = temporaryDatabase(subtest, `${suffix}.sqlite`);
      const baseline = openSqliteControlStore({ filename, now: () => createdAt });
      const { creation, authority } = seedRunning(baseline, suffix);
      const result = resultAttemptInput(authority.workflow, authority.attempt, suffix);
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
      assert.equal(reopened.getWorkflow(creation.workflow.id)?.version, authority.workflow.version);
      assert.equal(reopened.getAttempt(authority.attempt.id)?.status, AttemptStatus.RUNNING);
      assert.equal(reopened.listAuditEvents('WORKFLOW', creation.workflow.id).length, 2);
      assert.equal(reopened.listAuditEvents('ATTEMPT', authority.attempt.id).length, 1);
      assert.equal(reopened.getProcessedCommand(result.event.commandId), undefined);
    });
  }
});

void test('[I-006][I-008] database rejects Attempt deletion, a second running Attempt, and terminal rewrites', (t) => {
  const filename = temporaryDatabase(t, 'attempt-db-guards.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const { authority } = seedRunning(store, 'attempt-db-guards');
  const result = resultAttemptInput(authority.workflow, authority.attempt, 'attempt-db-guards');
  store.commitAttemptEvent(result);
  store.close();

  const database = new Database(filename);
  t.after(() => database.close());
  assert.throws(
    () =>
      database
        .prepare('UPDATE attempts SET termination_reason = ? WHERE id = ?')
        .run('rewritten history', authority.attempt.id),
    /terminal Attempt is immutable/,
  );
  assert.throws(
    () => database.prepare('DELETE FROM attempts WHERE id = ?').run(authority.attempt.id),
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
  insertRunning.run(runningAttemptId, 2, attemptFinishedAt, authority.attempt.id);
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
        authority.attempt.id,
      ),
    /UNIQUE constraint failed: attempts.workflow_id/,
  );
});
