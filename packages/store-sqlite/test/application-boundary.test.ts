import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { isAbsolute, join, normalize } from 'node:path';
import { tmpdir } from 'node:os';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  RuntimeErrorCode,
  CanonicalJsonSha256DigestProvider,
  GoalNextSafeAction,
  createCodeClosureApplication,
  createExecutionProfileInstaller,
  goalAndWorkflowCreationPayloadProjection,
  type CodeClosureApplication,
  type NormalizedProjectPathPort,
} from '@codeclosure/runtime';
import {
  auditEventId,
  commandId,
  createGoal,
  createWorkflow,
  goalId,
  goalRevision,
  isoTimestamp,
  successCriterionId,
  workflowId,
} from '@codeclosure/domain';
import { openSqliteControlStore, type SqliteControlStore } from '@codeclosure/store-sqlite';
import {
  DeterministicClock,
  DeterministicIds,
  testExecutionProfileDefinition,
} from '@codeclosure/testing';

const createdAt = '2026-07-28T00:00:00.000Z';
const profileInstalledAt = '2026-07-28T00:00:00.001Z';
const digests = new CanonicalJsonSha256DigestProvider();

const projectPaths: NormalizedProjectPathPort = Object.freeze({
  parseNormalizedAbsolute: (projectPath: string) => {
    if (!isAbsolute(projectPath) || normalize(projectPath) !== projectPath) {
      throw new TypeError('Project path is not one normalized absolute identity');
    }
    return projectPath;
  },
});

function temporaryDatabase(t: TestContext, name: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-application-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, name);
}

function application(
  store: SqliteControlStore,
  namespace: string,
  timestamps: readonly string[] = [createdAt],
): CodeClosureApplication {
  const ids = new DeterministicIds(namespace);
  return createCodeClosureApplication({
    store,
    clock: new DeterministicClock(timestamps),
    creationIds: ids,
    digests,
    projectPaths,
    execution: Object.freeze({
      startGoal: () =>
        Promise.reject(
          new Error('Execution is not exercised by this application-boundary fixture'),
        ),
      resumeGoal: () =>
        Promise.reject(
          new Error('Execution is not exercised by this application-boundary fixture'),
        ),
      cancelGoal: () => {
        throw new Error('Execution is not exercised by this application-boundary fixture');
      },
    }),
  });
}

const createRequest = Object.freeze({
  commandId: commandId('command_application-create'),
  objective: '  Prove the public application boundary  ',
  projectPath: '/fixture/application',
  criteria: Object.freeze(['  Creation is atomic  ', 'Queries remain read-only']),
});

void test('[I-002][I-006][I-008] CreateGoal owns exact atomic creation and read views', (t) => {
  const filename = temporaryDatabase(t, 'create-and-query.sqlite');
  const store = openSqliteControlStore({
    filename,
    now: () => isoTimestamp(createdAt),
  });
  t.after(() => store.close());
  const app = application(store, 'application-create');
  assert.deepEqual(Object.keys(app).sort(), [
    'cancelGoal',
    'createGoal',
    'getGoalAudit',
    'getGoalStatus',
    'resumeGoal',
    'startGoal',
  ]);
  for (const forbiddenCapability of [
    'store',
    'beginAttempt',
    'requestPhaseTransition',
    'evaluateAcceptance',
    'closeAcceptedGoal',
  ]) {
    assert.equal(forbiddenCapability in app, false);
  }

  const created = app.createGoal(createRequest);
  assert.equal(created.status, 'APPLIED');

  const goal = store.getGoal(created.output.goalId);
  const workflow = store.getWorkflowForGoal(created.output.goalId);
  assert.ok(goal);
  assert.ok(workflow);
  assert.equal(goal.objective, 'Prove the public application boundary');
  assert.deepEqual(
    goal.successCriteria.map((criterion) => [criterion.description, criterion.required]),
    [
      ['Creation is atomic', true],
      ['Queries remain read-only', true],
    ],
  );
  assert.deepEqual(goal.scope.allowedPaths, []);
  assert.deepEqual(goal.nonGoals, []);
  assert.equal(goal.createdAt, workflow.createdAt);
  const expectedCreationPayloadDigest = digests.digest(
    goalAndWorkflowCreationPayloadProjection(goal, workflow),
  );

  const status = app.getGoalStatus(goal.id);
  assert.equal(status.status, 'FOUND');
  assert.equal(status.view.nextSafeAction, GoalNextSafeAction.START_GOAL);
  assert.equal(status.view.technicalCloseout, false);
  assert.equal(status.view.acceptanceSummary, undefined);
  assert.equal(status.view.executionProfileRef, undefined);

  const profileIds = new DeterministicIds('application-profile');
  const installed = createExecutionProfileInstaller({
    store,
    clock: new DeterministicClock([profileInstalledAt]),
    ids: profileIds,
    digests,
  }).installExecutionProfile(testExecutionProfileDefinition('application-global-profile'));
  assert.equal(installed.status, 'INSTALLED');

  const audit = app.getGoalAudit(goal.id);
  assert.equal(audit.status, 'FOUND');
  assert.deepEqual(
    audit.view.events.map((event) => event.eventType),
    ['GOAL_CREATED', 'WORKFLOW_CREATED'],
  );
  assert.deepEqual(
    audit.view.events.map((event) => event.payloadDigest),
    [expectedCreationPayloadDigest, expectedCreationPayloadDigest],
  );
  const lastAuditEvent = audit.view.events.at(-1);
  assert.ok(lastAuditEvent);
  assert.ok(audit.view.throughSequence > lastAuditEvent.sequence);
  assert.equal(
    audit.view.events.some((event) => event.eventType === 'EXECUTION_PROFILE_INSTALLED'),
    false,
  );
  assert.equal(app.getGoalStatus(goalId('goal_application-missing')).status, 'NOT_FOUND');
  assert.equal(app.getGoalAudit(goalId('goal_application-missing')).status, 'NOT_FOUND');

  const database = new Database(filename, { readonly: true });
  t.after(() => database.close());
  for (const table of [
    'raw_requests',
    'intake_runs',
    'intent_analysis_proposals',
    'intent_projection_revisions',
    'intent_admission_decisions',
    'goal_materializations',
    'goal_start_authorizations',
  ]) {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get() as {
      count: number;
    };
    assert.equal(row.count, 0, `Direct CreateGoal must not synthesize ${table}`);
  }
});

void test('[I-006][I-008] CreateGoal replay is stable across fresh process identities', (t) => {
  const store = openSqliteControlStore({
    filename: temporaryDatabase(t, 'create-replay.sqlite'),
    now: () => isoTimestamp(createdAt),
  });
  t.after(() => store.close());
  const firstApp = application(store, 'application-first');
  const first = firstApp.createGoal(createRequest);
  assert.equal(first.status, 'APPLIED');

  assert.equal(firstApp.createGoal(createRequest).status, 'REPLAYED');
  const freshApp = application(store, 'application-fresh-process');
  const replayed = freshApp.createGoal(createRequest);
  assert.equal(replayed.status, 'REPLAYED');
  assert.deepEqual(replayed.output, first.output);

  const conflict = freshApp.createGoal({
    ...createRequest,
    objective: 'Reuse the command for another Goal',
  });
  assert.equal(conflict.status, 'REJECTED');
  assert.equal(conflict.output.error.code, RuntimeErrorCode.COMMAND_ID_CONFLICT);

  const processed = store.getProcessedCommand(createRequest.commandId);
  assert.ok(processed);
  const alternateGoal = createGoal({
    id: goalId('goal_concurrent-create-proposal'),
    revision: goalRevision(1),
    objective: 'A concurrently allocated authority identity',
    successCriteria: [
      {
        id: successCriterionId('criterion_concurrent-create-proposal'),
        description: 'The existing semantic creation wins',
        required: true,
      },
    ],
    scope: { projectPath: '/fixture/concurrent-create', allowedPaths: [] },
    createdAt: isoTimestamp('2026-07-28T00:00:00.010Z'),
  });
  const alternateWorkflow = createWorkflow({
    id: workflowId('workflow_concurrent-create-proposal'),
    goalId: alternateGoal.id,
    goalRevision: alternateGoal.revision,
    createdAt: alternateGoal.createdAt,
  });
  const raced = store.createGoalWithWorkflow({
    commandId: createRequest.commandId,
    inputDigest: processed.inputDigest,
    goal: alternateGoal,
    workflow: alternateWorkflow,
    auditEventId: auditEventId('audit_concurrent-create-goal'),
    workflowAuditEventId: auditEventId('audit_concurrent-create-workflow'),
    payloadDigest: digests.digest(
      goalAndWorkflowCreationPayloadProjection(alternateGoal, alternateWorkflow),
    ),
  });
  assert.equal(raced.status, 'REPLAYED');
  assert.equal(store.getGoal(alternateGoal.id), undefined);
});

void test('[I-002][I-006] invalid creation is unadmitted and transaction failure rolls back', (t) => {
  const filename = temporaryDatabase(t, 'create-validation-rollback.sqlite');
  let injectFailure = false;
  const store = openSqliteControlStore({
    filename,
    now: () => isoTimestamp(createdAt),
    transactionProbe: (step) => {
      if (injectFailure && step === 'AFTER_STATE_WRITE') {
        throw new Error('injected application creation rollback');
      }
    },
  });
  t.after(() => store.close());
  const app = application(store, 'application-validation');

  assert.throws(
    () => app.createGoal({ ...createRequest, criteria: Object.freeze([]) }),
    /at least one non-blank criterion/,
  );
  assert.throws(
    () => app.createGoal({ ...createRequest, projectPath: './relative-project' }),
    /normalized absolute identity/,
  );

  injectFailure = true;
  const failed = app.createGoal({
    ...createRequest,
    commandId: commandId('command_application-rollback'),
  });
  assert.equal(failed.status, 'REJECTED');
  assert.equal(failed.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  assert.equal(store.getProcessedCommand(commandId('command_application-rollback')), undefined);

  const raw = new Database(filename, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    const count = raw.prepare('SELECT COUNT(*) AS count FROM goals').get() as { count: number };
    assert.equal(count.count, 0);
  } finally {
    raw.close();
  }
});

void test('[I-003][I-006] Runtime read views reject malformed Store projections', (t) => {
  const store = openSqliteControlStore({
    filename: temporaryDatabase(t, 'strict-read-projections.sqlite'),
    now: () => isoTimestamp(createdAt),
  });
  t.after(() => store.close());
  const seedApp = application(store, 'application-read-seed');
  const created = seedApp.createGoal({
    ...createRequest,
    commandId: commandId('command_application-read-seed'),
  });
  if (!created.output.ok) {
    assert.fail('Strict read fixture must create one Goal');
  }
  const createdGoalId = created.output.goalId;
  const statusAuthority = store.getGoalStatusAuthority(createdGoalId);
  const auditAuthority = store.getGoalAuditAuthority(createdGoalId);
  assert.ok(statusAuthority);
  assert.ok(auditAuthority);

  const malformedStatusStore = new Proxy(store, {
    get: (target, property) => {
      if (property === 'getGoalStatusAuthority') {
        return () => Object.freeze({ ...statusAuthority, unexpectedAuthority: true });
      }
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') {
        return value;
      }
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        return result;
      };
    },
  });
  const malformedStatusApp = application(malformedStatusStore, 'application-malformed-status');
  assert.throws(() => malformedStatusApp.getGoalStatus(createdGoalId), /unrecognized|Unrecognized/);

  const malformedAuditStore = new Proxy(store, {
    get: (target, property) => {
      if (property === 'getGoalAuditAuthority') {
        return () =>
          Object.freeze({
            ...auditAuthority,
            events: Object.freeze([auditAuthority.events[0], auditAuthority.events[0]]),
          });
      }
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') {
        return value;
      }
      return (...args: unknown[]) => {
        const result: unknown = Reflect.apply(value, target, args);
        return result;
      };
    },
  });
  const malformedAuditApp = application(malformedAuditStore, 'application-malformed-audit');
  assert.throws(() => malformedAuditApp.getGoalAudit(createdGoalId), /unique ordered sequence/);
});
