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
import { TransactionStep, openSqliteControlStore } from '@codeclosure/store-sqlite';
import {
  M1FakeExecutionProfileName,
  createWorkflowStartAuthorityRuntime,
  m1FakeExecutionProfileRecipe,
} from '@codeclosure/testing';

import { ProtectedPathKind } from '../dist/composition/data-home.js';
import {
  createCliComposition,
  runM1DemoProof,
  runM1StaleCloseoutProof,
} from '../dist/composition/index.js';
import { createM1ProofReadFacade } from '../dist/composition/m1-proof-read-facade.js';
import { observeClaimedActiveAttempt } from '../dist/composition/m1-restart-proof-observer.js';
import { assertFreshReplacementDispatch } from '../dist/composition/m1-restart-proof-assertions.js';

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
  reopened.close();

  const proofRead = createM1ProofReadFacade(options(root, project), created.output.goalId);
  assert.equal(Object.isFrozen(proofRead), true);
  assert.deepEqual(Reflect.ownKeys(proofRead).toSorted(), ['audit', 'close', 'status']);
  assert.equal(proofRead.status.technicalCloseout, true);
  assert.equal(proofRead.audit.goalId, created.output.goalId);
  proofRead.close();
  proofRead.close();
});

void test('[I-001][I-009] proof-read facade fails closed and closes after recovery', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const seeded = seedActiveAttempt(root, project, 'BUILT_IN');

  assert.throws(
    () =>
      createM1ProofReadFacade(
        {
          dataHomePath: seeded.dataHomePath,
          protectedPaths: [],
          allowedProjectPaths: [],
        },
        seeded.goalId,
      ),
    /proof read cannot perform or conceal startup recovery/i,
  );

  const reopened = openSqliteControlStore({ filename: seeded.databasePath });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(seeded.workflowId)?.runStatus, 'BLOCKED');
});

void test('[I-004][I-009] duplicate-result proof binds two deliveries to one effect', async () => {
  const proof = await runM1DemoProof('duplicate-result');

  assert.equal(proof.passed, true);
  assert.equal(proof.proofCode, 'DUPLICATE_RESULT_DEDUPLICATED');
  assert.equal(proof.finalStatus.technicalCloseout, true);
  assert.deepEqual(proof.finalStatus.executionProfileRef, {
    id: 'profile_m1-duplicate-result',
    version: 'codeclosure-m1-fake-profile-v1',
    digest: 'sha256:cdac9cf23125a66074093b5f139a73caa954e01e3105f6bf1a7d7b03405a158d',
  });
});

void test('[I-004][I-009] restart proof requires Worker-caused paired finish authority', async () => {
  const proof = await runM1DemoProof('restart-resume');
  const recoveredStatus = proof.intermediateStatus;
  assert.ok(recoveredStatus);

  const recoveryAudits = proof.audit.events.filter(
    (event) => event.eventType === 'RECOVERY_RECONCILIATION_RECORDED',
  );
  assert.equal(recoveryAudits.length, 2);
  const startupRecovery = recoveryAudits[0];
  const resumeRecovery = recoveryAudits[1];
  assert.ok(startupRecovery);
  assert.ok(resumeRecovery);

  const abandonedClaim = proof.audit.events.find(
    (event) =>
      event.eventType === 'WORKER_DISPATCH_CLAIMED' && event.sequence < startupRecovery.sequence,
  );
  assert.ok(abandonedClaim);
  if (abandonedClaim.beforeVersion === undefined) {
    assert.fail('Restart fixture abandoned claim has no Workflow version');
  }
  const abandoned = Object.freeze({
    attemptId: abandonedClaim.aggregateId,
    phase: recoveredStatus.phase,
    workflowVersion: abandonedClaim.beforeVersion,
  });
  assert.doesNotThrow(() =>
    assertFreshReplacementDispatch(proof.audit, abandoned, recoveredStatus),
  );

  const freshStart = proof.audit.events.find(
    (event) => event.eventType === 'ATTEMPT_STARTED' && event.sequence > resumeRecovery.sequence,
  );
  assert.ok(freshStart);
  const freshFinish = proof.audit.events.find(
    (event) =>
      event.eventType === 'ATTEMPT_FINISHED' && event.aggregateId === freshStart.aggregateId,
  );
  assert.ok(freshFinish);
  assert.ok(freshFinish.commandId);
  const pairedWorkflowFinish = proof.audit.events.find(
    (event) =>
      event.eventType === 'WORKFLOW_ATTEMPT_FINISHED' &&
      event.aggregateId === recoveredStatus.workflowId &&
      event.commandId === freshFinish.commandId,
  );
  assert.ok(pairedWorkflowFinish);
  if (pairedWorkflowFinish.afterVersion === undefined) {
    assert.fail('Restart fixture paired Workflow finish has no after version');
  }
  const pairedWorkflowAfterVersion = pairedWorkflowFinish.afterVersion;

  const invalidWorkerCauseAudit = Object.freeze({
    ...proof.audit,
    events: Object.freeze(
      proof.audit.events.map((event) =>
        event === freshFinish || event === pairedWorkflowFinish
          ? Object.freeze({ ...event, causationId: 'command_non-worker-cause' })
          : event,
      ),
    ),
  });
  assert.throws(
    () => assertFreshReplacementDispatch(invalidWorkerCauseAudit, abandoned, recoveredStatus),
    /valid WorkerEventId/,
  );

  const mismatchedPairAudit = Object.freeze({
    ...proof.audit,
    events: Object.freeze(
      proof.audit.events.map((event) =>
        event === pairedWorkflowFinish
          ? Object.freeze({ ...event, afterVersion: pairedWorkflowAfterVersion + 1 })
          : event,
      ),
    ),
  });
  assert.throws(
    () => assertFreshReplacementDispatch(mismatchedPairAudit, abandoned, recoveredStatus),
    /finish authority does not match/,
  );
});

void test('[I-008][I-009] restart proof observation distinguishes a temporary SQLite writer from invalid input', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });
  const seeded = seedActiveAttempt(root, project, 'BUILT_IN');
  const observationOptions = Object.freeze({
    dataHomePath: seeded.dataHomePath,
    protectedPaths: Object.freeze([
      Object.freeze({ kind: ProtectedPathKind.PROJECT, path: project }),
    ]),
    allowedProjectPaths: Object.freeze([project]),
    busyTimeoutMilliseconds: 0,
  });

  assert.deepEqual(observeClaimedActiveAttempt(observationOptions, seeded.goalId), {
    status: 'NOT_YET_RETAINED',
  });

  let lockedObservation: ReturnType<typeof observeClaimedActiveAttempt> | undefined;
  const store = openSqliteControlStore({
    filename: seeded.databasePath,
    transactionProbe: (step) => {
      if (step === TransactionStep.AFTER_COMMAND_CHECK && lockedObservation === undefined) {
        lockedObservation = observeClaimedActiveAttempt(observationOptions, seeded.goalId);
      }
    },
  });
  try {
    const ids = new CryptographicIdentityGenerator();
    const application = createCodeClosureApplication({
      store,
      clock: new SystemUtcClock(),
      creationIds: ids,
      digests: new CanonicalJsonSha256DigestProvider(),
      projectPaths: Object.freeze({ parseNormalizedAbsolute: (path: string) => path }),
      execution: unavailableExecution,
    });
    const created = application.createGoal({
      commandId: ids.nextCommandId(),
      objective: 'Hold one deterministic SQLite writer during proof observation',
      projectPath: project,
      criteria: ['Temporary writer contention does not become recovery authority'],
    });
    assert.equal(created.status, 'APPLIED');
  } finally {
    store.close();
  }

  assert.deepEqual(lockedObservation, { status: 'TEMPORARILY_BUSY' });
  assert.throws(
    () =>
      observeClaimedActiveAttempt(
        { ...observationOptions, busyTimeoutMilliseconds: -1 },
        seeded.goalId,
      ),
    /busyTimeoutMilliseconds must be an integer/u,
  );
});

void test('[I-003][I-005][I-009] stale-closeout proof drifts only after current ACCEPT', async (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  mkdirSync(project, { mode: 0o700 });

  const proof = await runM1StaleCloseoutProof({ projectPath: project });

  assert.equal(proof.schemaVersion, 1);
  assert.equal(proof.scenario, M1FakeExecutionProfileName.STALE_CLOSEOUT);
  assert.equal(proof.beforeDrift.phase, 'FINAL_VERIFY');
  assert.equal(proof.beforeDrift.runStatus, 'READY');
  assert.equal(proof.beforeDrift.acceptanceSummary?.outcome, 'ACCEPT');
  assert.equal(proof.beforeDrift.activeCandidateRef?.state, 'FROZEN');
  assert.equal(proof.beforeDrift.technicalCloseout, false);
  assert.equal(proof.beforeDrift.closeoutRef, undefined);
  assert.equal(proof.finalDrive.stopReason, WorkflowDriveStopReason.FAILED);
  assert.equal(proof.finalStatus.phase, 'FINAL_VERIFY');
  assert.equal(proof.finalStatus.runStatus, 'FAILED');
  assert.equal(proof.finalStatus.activeCandidateRef?.state, 'INVALIDATED');
  assert.equal(proof.finalStatus.technicalCloseout, false);
  assert.equal(proof.finalStatus.closeoutRef, undefined);
  assert.equal(proof.reopenedStatus.phase, 'FINAL_VERIFY');
  assert.equal(proof.reopenedStatus.runStatus, 'FAILED');
  assert.equal(proof.reopenedStatus.activeCandidateRef?.state, 'INVALIDATED');
  assert.equal(proof.reopenedStatus.technicalCloseout, false);
  assert.equal(proof.reopenedStatus.closeoutRef, undefined);
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

void test('[I-003][I-006] corrected stale-closeout profile preserves the immutable v1 row', async (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  const databasePath = join(dataHomePath, 'state.sqlite');
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(dataHomePath, { mode: 0o700 });
  const store = openSqliteControlStore({ filename: databasePath });
  const corrected = m1FakeExecutionProfileRecipe(
    M1FakeExecutionProfileName.STALE_CLOSEOUT,
  ).definition;
  const legacy = createExecutionProfileInstaller({
    store,
    clock: new SystemUtcClock(),
    ids: new CryptographicIdentityGenerator(),
    digests: new CanonicalJsonSha256DigestProvider(),
  }).installExecutionProfile(
    Object.freeze({
      ...corrected,
      id: 'profile_m1-stale-closeout',
      version: 'codeclosure-m1-fake-profile-v1',
      candidateSource: 'fake-candidate-source:FROZEN_DRIFT',
      candidateSourceVersion: 'v1',
    }),
  );
  if (legacy.status !== 'INSTALLED') {
    assert.fail('Legacy stale-closeout v1 fixture was not installed');
  }
  const legacyInstallation = legacy.value;
  store.close();
  if (process.platform !== 'win32') {
    chmodSync(databasePath, 0o600);
  }

  const composition = createCliComposition({
    ...options(root, project),
    startProfileName: M1FakeExecutionProfileName.STALE_CLOSEOUT,
  });
  t.after(() => composition.close());
  const ids = new CryptographicIdentityGenerator();
  const created = composition.application.createGoal({
    commandId: ids.nextCommandId(),
    objective: 'Bind the corrected immutable stale-closeout profile',
    projectPath: project,
    criteria: ['New starts bind v2 without rewriting retained v1 authority'],
  });
  assert.equal(created.status, 'APPLIED');
  const createdStatus = composition.application.getGoalStatus(created.output.goalId);
  assert.equal(createdStatus.status, 'FOUND');
  const started = await composition.application.startGoal({
    commandId: ids.nextCommandId(),
    goalId: created.output.goalId,
    expectedGoalRevision: createdStatus.view.goalRevision,
    expectedWorkflowVersion: created.output.workflowVersion,
  });
  assert.equal(started.drive?.stopReason, WorkflowDriveStopReason.CLOSED);
  const status = composition.application.getGoalStatus(created.output.goalId);
  assert.equal(status.status, 'FOUND');
  assert.equal(status.view.executionProfileRef?.id, 'profile_m1-stale-closeout-v2');
  composition.close();

  const retained = openSqliteControlStore({ filename: databasePath });
  t.after(() => retained.close());
  assert.deepEqual(retained.getExecutionProfile(legacyInstallation.profile.id), legacyInstallation);
  assert.ok(retained.getExecutionProfile(corrected.id));
});

void test('[I-003][I-006] restart-resume v2 preserves the immutable v1 row', (t) => {
  const root = temporaryRoot(t);
  const project = join(root, 'project');
  const dataHomePath = join(root, 'authority');
  const databasePath = join(dataHomePath, 'state.sqlite');
  mkdirSync(project, { mode: 0o700 });
  mkdirSync(dataHomePath, { mode: 0o700 });
  const store = openSqliteControlStore({ filename: databasePath });
  const restartResumeV2 = m1FakeExecutionProfileRecipe(
    M1FakeExecutionProfileName.RESTART_RESUME,
  ).definition;
  const legacy = createExecutionProfileInstaller({
    store,
    clock: new SystemUtcClock(),
    ids: new CryptographicIdentityGenerator(),
    digests: new CanonicalJsonSha256DigestProvider(),
  }).installExecutionProfile(
    Object.freeze({
      id: 'profile_m1-restart-resume',
      schemaVersion: 1,
      version: 'codeclosure-m1-fake-profile-v1',
      workerAdapter: 'fake-worker:valid-result',
      workerAdapterVersion: 'v1',
      candidateSource: 'fake-candidate-source:STABLE',
      candidateSourceVersion: 'v1',
      verificationRunner: 'fake-verification-runner:PASS',
      verificationRunnerVersion: 'v1',
      driverVersion: 'm1-deterministic-driver-v1',
    }),
  );
  if (legacy.status !== 'INSTALLED') {
    assert.fail('Legacy restart-resume v1 fixture was not installed');
  }
  assert.equal(
    legacy.value.profile.digest,
    'sha256:90df76d5f6cccc77e0b0bbff052655ec354a03a201d3dbc2965fabd101edfeb6',
  );
  const legacyInstallation = legacy.value;
  store.close();
  if (process.platform !== 'win32') {
    chmodSync(databasePath, 0o600);
  }

  const composition = createCliComposition({
    ...options(root, project),
    startProfileName: M1FakeExecutionProfileName.RESTART_RESUME,
  });
  composition.close();

  const retained = openSqliteControlStore({ filename: databasePath });
  t.after(() => retained.close());
  assert.deepEqual(retained.getExecutionProfile(legacyInstallation.profile.id), legacyInstallation);
  assert.ok(retained.getExecutionProfile(restartResumeV2.id));
});
