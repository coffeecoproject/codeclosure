import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  CanonicalJsonSha256DigestProvider,
  WorkflowDriveStopReason,
  createCodeClosureApplication,
  createExecutionProfileInstaller,
  createM1PolicyBundleDefinition,
  createPolicyInstaller,
  type GoalExecutionCapability,
} from '@codeclosure/runtime';
import { CryptographicIdentityGenerator, SystemUtcClock } from '@codeclosure/runtime/composition';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';
import {
  M1FakeExecutionProfileName,
  createWorkflowStartAuthorityRuntime,
  m1FakeExecutionProfileRecipe,
} from '@codeclosure/testing';

import { ProtectedPathKind } from '../dist/composition/data-home.js';
import { createCliComposition } from '../dist/composition/index.js';

function temporaryRoot(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-cli-composition-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  return root;
}

function options(root: string, project: string) {
  return Object.freeze({
    dataHomePath: join(root, 'authority'),
    protectedPaths: Object.freeze([
      Object.freeze({ kind: ProtectedPathKind.PROJECT, path: project }),
    ]),
    allowedProjectPaths: Object.freeze([project]),
  });
}

const unavailableExecution: GoalExecutionCapability = Object.freeze({
  startGoal: () => Promise.reject(new Error('seed fixture does not drive a Goal')),
  resumeGoal: () => Promise.reject(new Error('seed fixture does not resume a Goal')),
  cancelGoal: () => {
    throw new Error('seed fixture does not cancel a Goal');
  },
});

function seedActiveAttempt(root: string, project: string, policyMode: 'BUILT_IN' | 'FOREIGN') {
  const dataHomePath = join(root, 'authority');
  const databasePath = join(dataHomePath, 'state.sqlite');
  mkdirSync(dataHomePath, { mode: 0o700, recursive: true });
  const store = openSqliteControlStore({ filename: databasePath });
  const ids = new CryptographicIdentityGenerator();
  const clock = new SystemUtcClock();
  const digests = new CanonicalJsonSha256DigestProvider();
  const application = createCodeClosureApplication({
    store,
    clock,
    creationIds: ids,
    digests,
    projectPaths: Object.freeze({ parseNormalizedAbsolute: (path: string) => path }),
    execution: unavailableExecution,
  });
  const created = application.createGoal({
    commandId: ids.nextCommandId(),
    objective: 'Retain an active Attempt across a simulated restart',
    projectPath: project,
    criteria: ['Startup reconciliation blocks replacement work before commands are exposed'],
  });
  assert.equal(created.status, 'APPLIED');
  assert.equal(created.output.ok, true);
  const owner = store.getGoalWithWorkflow(created.output.goalId);
  assert.ok(owner);
  const runtime = createWorkflowStartAuthorityRuntime({
    store,
    namespace: `cli-startup-recovery-${policyMode.toLowerCase()}`,
    clock,
    ...(policyMode === 'FOREIGN'
      ? {}
      : {
          policyDefinition: createM1PolicyBundleDefinition(digests),
          executionProfileDefinition: m1FakeExecutionProfileRecipe(
            M1FakeExecutionProfileName.HAPPY_PATH,
          ).definition,
        }),
  });
  const started = runtime.kernel.startGoal({
    commandId: ids.nextCommandId(),
    goalId: owner.goal.id,
    expectedGoalRevision: owner.goal.revision,
    expectedWorkflowVersion: owner.workflow.version,
  });
  assert.equal(started.status, 'APPLIED', JSON.stringify(started));
  const running = store.getWorkflow(owner.workflow.id);
  assert.ok(running?.activeAttemptId);
  store.close();
  if (process.platform !== 'win32') {
    chmodSync(databasePath, 0o600);
  }
  return Object.freeze({
    dataHomePath,
    databasePath,
    goalId: owner.goal.id,
    workflowId: owner.workflow.id,
    attemptId: running.activeAttemptId,
  });
}

void test('[I-001][I-003][I-023] trusted composition publishes only the narrow facade', async (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const composition = createCliComposition(options(root, project));
  t.after(() => composition.close());

  assert.equal(Object.isFrozen(composition), true);
  assert.deepEqual(Reflect.ownKeys(composition).toSorted(), [
    'application',
    'close',
    'startupRecovery',
  ]);
  assert.deepEqual(Reflect.ownKeys(composition.application).toSorted(), [
    'cancelGoal',
    'createGoal',
    'getGoalAudit',
    'getGoalStatus',
    'resumeGoal',
    'startGoal',
  ]);
  assert.deepEqual(composition.startupRecovery, {
    schemaVersion: 1,
    scannedCount: 0,
    reconciledCount: 0,
    recoveryIds: [],
  });

  const ids = new CryptographicIdentityGenerator();
  const created = composition.application.createGoal({
    commandId: ids.nextCommandId(),
    objective: 'Prove the trusted M1 composition path',
    projectPath: project,
    criteria: ['Only Acceptance may authorize technical closeout'],
  });
  assert.equal(created.status, 'APPLIED', JSON.stringify(created));
  assert.equal(created.output.ok, true);
  const createdStatus = composition.application.getGoalStatus(created.output.goalId);
  assert.equal(createdStatus.status, 'FOUND');
  const started = await composition.application.startGoal({
    commandId: ids.nextCommandId(),
    goalId: created.output.goalId,
    expectedGoalRevision: createdStatus.view.goalRevision,
    expectedWorkflowVersion: created.output.workflowVersion,
  });
  assert.equal(started.command.status, 'APPLIED', JSON.stringify(started));
  assert.equal(started.drive?.stopReason, WorkflowDriveStopReason.CLOSED);

  const status = composition.application.getGoalStatus(created.output.goalId);
  assert.equal(status.status, 'FOUND');
  assert.equal(status.view.technicalCloseout, true);
  assert.equal(status.view.executionProfileRef?.id, 'profile_m1-happy-path');

  composition.close();
  composition.close();
  const reopened = createCliComposition(options(root, project));
  t.after(() => reopened.close());
  const retained = reopened.application.getGoalStatus(created.output.goalId);
  assert.equal(retained.status, 'FOUND');
  assert.equal(retained.view.technicalCloseout, true);
  assert.equal(reopened.startupRecovery.scannedCount, 0);
});

void test('[I-008][I-011] startup recovery finishes before the facade is returned', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const seeded = seedActiveAttempt(root, project, 'BUILT_IN');

  const composition = createCliComposition({
    dataHomePath: seeded.dataHomePath,
    protectedPaths: [],
    allowedProjectPaths: [],
  });
  t.after(() => composition.close());

  assert.equal(composition.startupRecovery.scannedCount, 1);
  assert.equal(composition.startupRecovery.reconciledCount, 1);
  assert.equal(composition.startupRecovery.recoveryIds.length, 1);
  const status = composition.application.getGoalStatus(seeded.goalId);
  assert.equal(status.status, 'FOUND');
  assert.equal(status.view.runStatus, 'BLOCKED');
  assert.equal(status.view.activeAttemptRef, undefined);
  assert.equal(status.view.nextSafeAction, 'RESUME_GOAL');
});

void test('[I-003][I-008] incompatible Policy aborts startup before recovery mutation', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const compatible = seedActiveAttempt(root, project, 'BUILT_IN');
  const seeded = seedActiveAttempt(root, project, 'FOREIGN');

  assert.throws(
    () =>
      createCliComposition({
        dataHomePath: seeded.dataHomePath,
        protectedPaths: [],
        allowedProjectPaths: [],
      }),
    /Recovery Workflow Policy binding is incompatible with trusted Runtime composition/,
  );

  const store = openSqliteControlStore({ filename: seeded.databasePath });
  t.after(() => store.close());
  const workflow = store.getWorkflow(seeded.workflowId);
  assert.ok(workflow);
  assert.equal(workflow.runStatus, 'RUNNING');
  assert.equal(workflow.activeAttemptId, seeded.attemptId);
  assert.equal(store.getLatestRecoveryReconciliation(seeded.workflowId), undefined);
  const compatibleWorkflow = store.getWorkflow(compatible.workflowId);
  assert.ok(compatibleWorkflow);
  assert.equal(compatibleWorkflow.runStatus, 'RUNNING');
  assert.equal(compatibleWorkflow.activeAttemptId, compatible.attemptId);
  assert.equal(store.getLatestRecoveryReconciliation(compatible.workflowId), undefined);
});

void test('[I-003][I-013] selected Fake profile is bound and cannot claim false closeout', async (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const composition = createCliComposition({
    ...options(root, project),
    startProfileName: M1FakeExecutionProfileName.FAILING_EVIDENCE,
  });
  t.after(() => composition.close());
  const ids = new CryptographicIdentityGenerator();
  const created = composition.application.createGoal({
    commandId: ids.nextCommandId(),
    objective: 'Prove failing Evidence cannot close a Goal',
    projectPath: project,
    criteria: ['A failed Verification result remains non-accepted'],
  });
  assert.equal(created.status, 'APPLIED');
  assert.equal(created.output.ok, true);
  const before = composition.application.getGoalStatus(created.output.goalId);
  assert.equal(before.status, 'FOUND');
  const started = await composition.application.startGoal({
    commandId: ids.nextCommandId(),
    goalId: created.output.goalId,
    expectedGoalRevision: before.view.goalRevision,
    expectedWorkflowVersion: before.view.workflowVersion,
  });
  assert.equal(started.drive?.stopReason, WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED);
  const after = composition.application.getGoalStatus(created.output.goalId);
  assert.equal(after.status, 'FOUND');
  assert.equal(after.view.executionProfileRef?.id, 'profile_m1-failing-evidence');
  assert.equal(after.view.acceptanceSummary?.outcome, 'REJECT_REPAIRABLE');
  assert.equal(after.view.technicalCloseout, false);
});

void test('[I-003][I-027] unknown profile fails before SQLite authority activation', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const baseOptions = options(root, project);

  assert.throws(
    () => createCliComposition({ ...baseOptions, startProfileName: 'not-a-profile' }),
    /Unknown M1 Fake execution profile/,
  );
  assert.equal(existsSync(baseOptions.dataHomePath), false);

  const composition = createCliComposition(baseOptions);
  composition.close();
});

void test('[I-003][I-006] retained built-in Policy conflicts stop composition', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  const databasePath = join(dataHomePath, 'state.sqlite');
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(dataHomePath, { mode: 0o700 });
  const store = openSqliteControlStore({ filename: databasePath });
  const digests = new CanonicalJsonSha256DigestProvider();
  const definition = createM1PolicyBundleDefinition(digests);
  const installed = createPolicyInstaller({
    store,
    clock: new SystemUtcClock(),
    ids: new CryptographicIdentityGenerator(),
    digests,
  }).installPolicyBundle(Object.freeze({ ...definition, version: 'conflicting-policy-v1' }));
  assert.equal(installed.status, 'INSTALLED');
  store.close();
  if (process.platform !== 'win32') {
    chmodSync(databasePath, 0o600);
  }

  assert.throws(
    () => createCliComposition(options(root, project)),
    /Built-in M1 Policy conflicts with retained authority/,
  );
});

void test('[I-003][I-006] retained built-in Profile conflicts stop composition', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  const databasePath = join(dataHomePath, 'state.sqlite');
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(dataHomePath, { mode: 0o700 });
  const store = openSqliteControlStore({ filename: databasePath });
  const installed = createExecutionProfileInstaller({
    store,
    clock: new SystemUtcClock(),
    ids: new CryptographicIdentityGenerator(),
    digests: new CanonicalJsonSha256DigestProvider(),
  }).installExecutionProfile(
    Object.freeze({
      ...m1FakeExecutionProfileRecipe(M1FakeExecutionProfileName.HAPPY_PATH).definition,
      driverVersion: 'conflicting-driver-v1',
    }),
  );
  assert.equal(installed.status, 'INSTALLED');
  store.close();
  if (process.platform !== 'win32') {
    chmodSync(databasePath, 0o600);
  }

  assert.throws(
    () => createCliComposition(options(root, project)),
    /Built-in M1 Execution Profile conflicts with retained authority: happy-path/,
  );
});
