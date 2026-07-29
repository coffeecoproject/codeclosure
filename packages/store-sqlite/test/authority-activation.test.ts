import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  auditEventId,
  commandId,
  createGoal,
  createWorkflow,
  goalId,
  goalRevision,
  isoTimestamp,
  sha256Digest,
  successCriterionId,
  workflowId,
  type Sha256Digest,
} from '@codeclosure/domain';
import {
  AuthorityActivationError,
  SqliteAuthorityDatabaseState,
  TransactionStep,
  defaultMigrationsDirectory,
  openSqliteControlStore,
  openVerifiedSqliteControlStore,
  type CreateGoalWithWorkflowInput,
  type SqliteAuthorityIsolationLease,
  type SqliteAuthorityIsolationSnapshot,
} from '@codeclosure/store-sqlite';

const createdAt = isoTimestamp('2026-07-29T00:00:00.000Z');

function digest(character: string): Sha256Digest {
  return sha256Digest(`sha256:${character.repeat(64)}`);
}

function temporaryDatabase(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-activation-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'state.sqlite');
}

function creationInput(namespace: string, projectPath: string): CreateGoalWithWorkflowInput {
  const goal = createGoal({
    id: goalId(`goal_${namespace}`),
    revision: goalRevision(1),
    objective: `Verify authority activation for ${namespace}`,
    successCriteria: Object.freeze([
      Object.freeze({
        id: successCriterionId(`criterion_${namespace}`),
        description: 'Activation remains isolated',
        required: true,
      }),
    ]),
    scope: Object.freeze({ projectPath, allowedPaths: Object.freeze([]) }),
    nonGoals: Object.freeze([]),
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId(`workflow_${namespace}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  return Object.freeze({
    commandId: commandId(`command_${namespace}`),
    inputDigest: digest('a'),
    goal,
    workflow,
    auditEventId: auditEventId(`audit_goal-${namespace}`),
    workflowAuditEventId: auditEventId(`audit_workflow-${namespace}`),
    payloadDigest: digest('b'),
  });
}

function isolationLease(
  allowedProjectPaths: readonly string[],
  onAssertCurrent: () => void = () => undefined,
): SqliteAuthorityIsolationLease {
  const allowed = new Set(allowedProjectPaths);
  return Object.freeze({
    assertCurrent: onAssertCurrent,
    assertProjectPathAllowed: (projectPath: string) => {
      if (!allowed.has(projectPath)) {
        throw new AuthorityActivationError(
          `Project path was not part of verified activation: ${projectPath}`,
        );
      }
    },
  });
}

function seedRetainedGoal(filename: string, namespace: string, projectPath: string): void {
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  try {
    assert.equal(
      store.createGoalWithWorkflow(creationInput(namespace, projectPath)).status,
      'APPLIED',
    );
  } finally {
    store.close();
  }
}

void test('[I-006][I-007][I-008] verified activation gates new Goal project admission', (t) => {
  const filename = temporaryDatabase(t);
  writeFileSync(filename, '');
  const snapshots: SqliteAuthorityIsolationSnapshot[] = [];
  let currentAssertions = 0;
  const allowedProject = '/fixture/verified-activation';
  const store = openVerifiedSqliteControlStore({
    filename,
    now: () => createdAt,
    isolationVerifier: Object.freeze({
      verify: (snapshot: SqliteAuthorityIsolationSnapshot) => {
        snapshots.push(snapshot);
        return isolationLease([allowedProject], () => {
          currentAssertions += 1;
        });
      },
    }),
  });
  t.after(() => store.close());

  assert.equal(snapshots.length, 1);
  const snapshot = snapshots[0];
  assert.ok(snapshot);
  assert.equal(snapshot.databaseState, SqliteAuthorityDatabaseState.EMPTY);
  assert.deepEqual(snapshot.projectReferences, []);
  assert.equal(store.appliedMigrations().length, 17);
  assert.ok(currentAssertions >= 3);

  assert.equal(
    store.createGoalWithWorkflow(creationInput('verified-allowed', allowedProject)).status,
    'APPLIED',
  );
  assert.throws(
    () =>
      store.createGoalWithWorkflow(
        creationInput('verified-denied', '/fixture/not-part-of-activation'),
      ),
    /was not part of verified activation/,
  );
  assert.equal(store.getGoal(goalId('goal_verified-denied')), undefined);
});

void test('[I-007][I-008][I-027] failed isolation leaves a new database unmodified', (t) => {
  const filename = temporaryDatabase(t);
  writeFileSync(filename, '');

  assert.throws(
    () =>
      openVerifiedSqliteControlStore({
        filename,
        now: () => createdAt,
        isolationVerifier: Object.freeze({
          verify: () => {
            throw new AuthorityActivationError('fixture isolation rejected');
          },
        }),
      }),
    /fixture isolation rejected/,
  );
  assert.equal(statSync(filename).size, 0);

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(
      inspected
        .prepare("SELECT name FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%' ORDER BY name")
        .all(),
      [],
    );
  } finally {
    inspected.close();
  }
});

void test('[I-006][I-007][I-027] unknown bootstrap schema fails before verifier or migration', (t) => {
  const filename = temporaryDatabase(t);
  const fixture = new Database(filename);
  fixture.exec('CREATE TABLE unrelated(id INTEGER PRIMARY KEY) STRICT');
  fixture.close();
  let verifierCalls = 0;

  assert.throws(
    () =>
      openVerifiedSqliteControlStore({
        filename,
        now: () => createdAt,
        isolationVerifier: Object.freeze({
          verify: () => {
            verifierCalls += 1;
            return isolationLease([]);
          },
        }),
      }),
    /unsupported non-empty schema/,
  );
  assert.equal(verifierCalls, 0);

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    assert.deepEqual(
      inspected.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all(),
      [{ name: 'unrelated' }],
    );
  } finally {
    inspected.close();
  }
});

void test('[I-006][I-007][I-027] malformed recognizable bootstrap rows fail without mutation', (t) => {
  const filename = temporaryDatabase(t);
  const fixture = new Database(filename);
  fixture.exec(`
    CREATE TABLE schema_migrations(version INTEGER);
    CREATE TABLE goals(id TEXT, project_path INTEGER);
    INSERT INTO goals(id, project_path) VALUES ('goal_malformed-bootstrap', 42);
  `);
  fixture.close();
  let verifierCalls = 0;

  assert.throws(
    () =>
      openVerifiedSqliteControlStore({
        filename,
        now: () => createdAt,
        isolationVerifier: Object.freeze({
          verify: () => {
            verifierCalls += 1;
            return isolationLease([]);
          },
        }),
      }),
    /bootstrap state failed strict inspection/,
  );
  assert.equal(verifierCalls, 0);

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    assert.equal(inspected.prepare('SELECT project_path FROM goals').pluck().get(), 42);
    assert.equal(
      inspected
        .prepare("SELECT COUNT(*) FROM sqlite_schema WHERE name = 'audit_events'")
        .pluck()
        .get(),
      0,
    );
  } finally {
    inspected.close();
  }
});

void test('[I-007][I-008] activation writer reservation closes the snapshot/use race', (t) => {
  const filename = temporaryDatabase(t);
  const projectPath = '/fixture/activation-lock';
  seedRetainedGoal(filename, 'activation-lock', projectPath);
  let concurrentWriteWasBlocked = false;

  const store = openVerifiedSqliteControlStore({
    filename,
    busyTimeoutMilliseconds: 0,
    now: () => createdAt,
    isolationVerifier: Object.freeze({
      verify: (snapshot: SqliteAuthorityIsolationSnapshot) => {
        assert.deepEqual(snapshot.projectReferences, [
          { goalId: goalId('goal_activation-lock'), projectPath },
        ]);
        const competing = new Database(filename, { fileMustExist: true, timeout: 0 });
        try {
          assert.throws(
            () =>
              competing
                .prepare('UPDATE goals SET project_path = ? WHERE id = ?')
                .run('/fixture/changed-concurrently', goalId('goal_activation-lock')),
            (error: unknown) => {
              concurrentWriteWasBlocked =
                error instanceof Error && Reflect.get(error, 'code') === 'SQLITE_BUSY';
              return concurrentWriteWasBlocked;
            },
          );
        } finally {
          competing.close();
        }
        return isolationLease([projectPath]);
      },
    }),
  });
  t.after(() => store.close());

  assert.equal(concurrentWriteWasBlocked, true);
  assert.equal(store.getGoal(goalId('goal_activation-lock'))?.scope.projectPath, projectPath);
});

void test('[I-007][I-008] a lease change before commit rolls back the authority write', (t) => {
  const filename = temporaryDatabase(t);
  writeFileSync(filename, '');
  const projectPath = '/fixture/lease-before-commit';
  let activationComplete = false;
  let identityChanged = false;
  const store = openVerifiedSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: (step) => {
      if (activationComplete && step === TransactionStep.BEFORE_COMMIT) {
        identityChanged = true;
      }
    },
    isolationVerifier: Object.freeze({
      verify: () =>
        isolationLease([projectPath], () => {
          if (identityChanged) {
            throw new AuthorityActivationError('fixture project identity changed');
          }
        }),
    }),
  });
  t.after(() => store.close());
  activationComplete = true;

  assert.throws(
    () => store.createGoalWithWorkflow(creationInput('lease-before-commit', projectPath)),
    /fixture project identity changed/,
  );
  identityChanged = false;
  assert.equal(store.getGoal(goalId('goal_lease-before-commit')), undefined);
});

void test('[I-006][I-008] migration cannot rewrite an inspected project binding', (t) => {
  const filename = temporaryDatabase(t);
  const projectPath = '/fixture/migration-binding';
  seedRetainedGoal(filename, 'migration-binding', projectPath);
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-activation-migrations-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  for (const name of readdirSync(defaultMigrationsDirectory()).filter((name) =>
    name.endsWith('.sql'),
  )) {
    copyFileSync(join(defaultMigrationsDirectory(), name), join(migrationsDirectory, name));
  }
  writeFileSync(
    join(migrationsDirectory, '0018_rewrite_project_binding.sql'),
    "UPDATE goals SET project_path = '/fixture/rewritten-by-migration';\n",
  );

  assert.throws(
    () =>
      openVerifiedSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => createdAt,
        isolationVerifier: Object.freeze({
          verify: () => isolationLease([projectPath]),
        }),
      }),
    /project bindings changed during SQLite authority activation/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    assert.equal(
      inspected
        .prepare('SELECT project_path FROM goals WHERE id = ?')
        .pluck()
        .get(goalId('goal_migration-binding')),
      projectPath,
    );
    assert.equal(
      inspected.prepare('SELECT COUNT(*) FROM schema_migrations WHERE version = 18').pluck().get(),
      0,
    );
  } finally {
    inspected.close();
  }
});
