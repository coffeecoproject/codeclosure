import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  AttemptStatus,
  RunStatus,
  commandId,
  createGoal,
  createWorkflow,
  decodeContextManifest,
  decodeGoalSnapshot,
  decodePolicyBundle,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  successCriterionId,
  workerEventId,
  workflowId,
  workflowVersion,
  type Goal,
  type PolicyBundle,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  RuntimeErrorCode,
  contextManifestDigestProjection,
  createWorkerExecutionApplication,
  type Clock,
  type WorkerExecutionDependencies,
  type WorkerPort,
  type WorkerRequest,
} from '@codeclosure/runtime';
import {
  WorkerTransactionStep,
  defaultMigrationsDirectory,
  openSqliteControlStore,
  type SqliteControlStore,
} from '@codeclosure/store-sqlite';
import { DeterministicIds, FakeWorker, FakeWorkerFixture } from '@codeclosure/testing';
import {
  WorkflowRuntimeKernel,
  type AttemptContextCompilationRequest,
} from '../../runtime/dist/workflow-runtime.js';

const createdAt = isoTimestamp('2026-07-27T00:00:00.000Z');
const digests = new CanonicalJsonSha256DigestProvider();

interface SeededAuthority {
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly policy: PolicyBundle;
}

type ContextFactoryOverride = (
  input: AttemptContextCompilationRequest,
  compiler: MinimalContextCompiler,
  authority: SeededAuthority,
) => unknown;

function temporaryDatabase(t: TestContext, name = 'worker-control.sqlite'): string {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-worker-control-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, name);
}

function policyBundle(): PolicyBundle {
  const definition: Omit<PolicyBundle, 'digest'> = Object.freeze({
    id: policyBundleId('policy_m1-worker'),
    schemaVersion: 1,
    version: 'm1-worker-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['minimal-version-bound-context']),
    checkSpecifications: Object.freeze([]),
    applicabilityRules: Object.freeze([]),
    acceptanceRules: Object.freeze(['worker-result-never-accepts']),
    checkerVersions: Object.freeze([]),
  });
  return decodePolicyBundle({
    ...definition,
    digest: digests.digest(policyBundleProjection(definition)),
  });
}

function seedAuthority(
  store: SqliteControlStore,
  namespace: string,
  policyInstalledAt: ReturnType<typeof isoTimestamp> = createdAt,
): SeededAuthority {
  const goal = createGoal({
    id: goalId(`goal_${namespace}`),
    revision: goalRevision(1),
    objective: `Prove the bounded Worker control path for ${namespace}`,
    successCriteria: [
      {
        id: successCriterionId(`criterion_${namespace}`),
        description: 'Worker output cannot bypass runtime authority',
        required: true,
      },
    ],
    scope: {
      projectPath: `/fixture/${namespace}`,
      allowedPaths: ['src/**'],
    },
    nonGoals: ['No real model integration'],
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId(`workflow_${namespace}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  const policy = policyBundle();
  assert.equal(
    store.installPolicyBundle({ bundle: policy, installedAt: policyInstalledAt }).status,
    'INSTALLED',
  );
  const creation = store.createGoalWithWorkflow({
    commandId: commandId(`command_create-${namespace}`),
    inputDigest: digests.digest({ schemaVersion: 1, type: 'CREATE_FIXTURE', namespace }),
    goal,
    workflow,
    auditEventId: new DeterministicIds(`goal-${namespace}`).nextAuditEventId(),
    workflowAuditEventId: new DeterministicIds(`workflow-${namespace}`).nextAuditEventId(),
    payloadDigest: digests.digest({ schemaVersion: 1, goal, workflow }),
  });
  assert.equal(creation.status, 'APPLIED');
  return Object.freeze({ goal, workflow, policy });
}

function monotonicClock(): Clock {
  let milliseconds = 10;
  return Object.freeze({
    now: () => {
      const value = isoTimestamp(`2026-07-27T00:00:00.${String(milliseconds).padStart(3, '0')}Z`);
      milliseconds += 1;
      return value;
    },
  });
}

function runtimeDependencies(
  store: SqliteControlStore,
  worker: WorkerPort,
  authority: SeededAuthority,
  namespace: string,
  contextFactoryOverride?: ContextFactoryOverride,
  clock: Clock = monotonicClock(),
): WorkerExecutionDependencies {
  const identities = new DeterministicIds(`runtime-${namespace}`);
  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm1-context-compiler-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  });
  return Object.freeze({
    store,
    worker,
    clock,
    ids: identities,
    digests,
    workerContext: Object.freeze({
      identities,
      policyBundleId: authority.policy.id,
      factory: Object.freeze({
        compile: (input: AttemptContextCompilationRequest) =>
          contextFactoryOverride === undefined
            ? compiler.compile(input)
            : contextFactoryOverride(input, compiler, authority),
      }),
    }),
  });
}

function startRequest(authority: SeededAuthority, namespace: string) {
  return Object.freeze({
    commandId: commandId(`command_start-${namespace}`),
    goalId: authority.goal.id,
    expectedGoalRevision: authority.goal.revision,
    expectedWorkflowVersion: authority.workflow.version,
  });
}

function rowCount(filename: string, table: string): number {
  const database = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    if (typeof row !== 'object' || row === null || typeof Reflect.get(row, 'count') !== 'number') {
      assert.fail(`Could not count ${table}`);
    }
    return Reflect.get(row, 'count') as number;
  } finally {
    database.close();
  }
}

class CountingWorker implements WorkerPort {
  public calls = 0;

  public run(request: WorkerRequest, signal: AbortSignal): AsyncIterable<unknown> {
    void request;
    void signal;
    this.calls += 1;
    return Object.freeze({
      [Symbol.asyncIterator]: () =>
        Object.freeze({
          next: () => Promise.resolve({ done: true as const, value: undefined }),
        }),
    });
  }
}

void test('[I-004][I-006][I-008][I-009][I-019] Context-bound dispatch and admitted result survive reopen', async (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const authority = seedAuthority(store, 'happy');
  const worker = new FakeWorker({
    fixture: FakeWorkerFixture.VALID_RESULT,
    observedAt: '2026-07-27T00:00:00.020Z',
  });
  const application = createWorkerExecutionApplication(
    runtimeDependencies(store, worker, authority, 'happy'),
  );

  const execution = await application.startGoal(startRequest(authority, 'happy'));

  assert.equal(execution.command.status, 'APPLIED');
  assert.equal(execution.dispatch?.status, 'CLAIMED');
  assert.equal(execution.admissions.length, 1);
  assert.equal(execution.admissions[0]?.status, 'ADMITTED');
  const claim = execution.dispatch.claim;
  const attempt = store.getAttempt(claim.attemptId);
  const manifest = store.getContextManifest(claim.contextManifestId);
  const workflow = store.getWorkflow(authority.workflow.id);
  assert.equal(attempt?.status, AttemptStatus.RESULT_RECORDED);
  assert.equal(workflow?.runStatus, RunStatus.READY);
  assert.equal(workflow.version, workflowVersion(3));
  assert.equal(manifest?.workflowVersion, workflowVersion(2));
  assert.equal(manifest.manifestDigest, claim.contextManifestDigest);
  assert.equal(manifest.packageDigest, claim.packageDigest);
  const admission = execution.admissions[0];
  const receipt = store.getWorkerEventReceipt(admission.eventId);
  assert.equal(receipt?.disposition, 'ADMITTED');
  assert.equal(store.getProcessedCommand(admission.internalCommandId)?.aggregateType, 'WORKFLOW');

  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getAttempt(claim.attemptId)?.status, AttemptStatus.RESULT_RECORDED);
  assert.equal(
    reopened.getContextManifest(claim.contextManifestId)?.manifestDigest,
    claim.contextManifestDigest,
  );
  assert.equal(
    reopened.getWorkerDispatchClaim(claim.attemptId)?.packageDigest,
    claim.packageDigest,
  );
  assert.equal(reopened.getWorkerEventReceipt(admission.eventId)?.disposition, 'ADMITTED');
  assert.equal(
    reopened.getPolicyBundle(authority.policy.id)?.bundle.digest,
    authority.policy.digest,
  );
  assert.equal(rowCount(filename, 'acceptance_decisions'), 0);
});

void test('[I-006][I-008] Worker Attempt time includes the active Policy causal floor', async (t) => {
  const filename = temporaryDatabase(t, 'policy-causal-floor.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const policyInstalledAt = isoTimestamp('2026-07-27T00:00:00.100Z');
  const authority = seedAuthority(store, 'policycausalfloor', policyInstalledAt);
  const rollbackClock: Clock = Object.freeze({
    now: () => isoTimestamp('2026-07-27T00:00:00.050Z'),
  });
  const application = createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'policycausalfloor',
      undefined,
      rollbackClock,
    ),
  );

  const execution = await application.startGoal(startRequest(authority, 'policycausalfloor'));

  assert.equal(execution.command.status, 'APPLIED');
  assert.equal(execution.dispatch?.status, 'CLAIMED');
  const manifest = store.getContextManifest(execution.dispatch.claim.contextManifestId);
  assert.equal(manifest?.createdAt, policyInstalledAt);
});

void test('[I-002][I-004][I-009] duplicate WorkerEventId delivery mutates authority exactly once', async (t) => {
  const filename = temporaryDatabase(t, 'duplicate.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'duplicate');
  const application = createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.DUPLICATE_RESULT }),
      authority,
      'duplicate',
    ),
  );

  const execution = await application.startGoal(startRequest(authority, 'duplicate'));

  assert.deepEqual(
    execution.admissions.map((admission) => admission.status),
    ['ADMITTED', 'DUPLICATE'],
  );
  assert.equal(store.getWorkflow(authority.workflow.id)?.version, workflowVersion(3));
  assert.equal(
    store.getWorkerEventReceipt(workerEventId('worker-event_duplicate-result-001'))?.disposition,
    'ADMITTED',
  );
  assert.equal(rowCount(filename, 'worker_event_receipts'), 1);
  assert.equal(rowCount(filename, 'processed_commands'), 3);
});

void test('[I-008][I-009][I-019] stale Context is durably ignored without command outcome or state mutation', async (t) => {
  const filename = temporaryDatabase(t, 'stale.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'stale');
  const application = createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.STALE_CONTEXT }),
      authority,
      'stale',
    ),
  );

  const execution = await application.startGoal(startRequest(authority, 'stale'));

  assert.equal(execution.admissions[0]?.status, 'IGNORED');
  assert.equal(execution.admissions[0].receiptRecorded, true);
  assert.equal(execution.admissions[0].reasonCode, 'WORKER_REQUEST_BINDING_MISMATCH');
  assert.equal(store.getWorkflow(authority.workflow.id)?.version, workflowVersion(2));
  assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.RUNNING);
  if (execution.dispatch?.status !== 'CLAIMED') {
    assert.fail('Stale result test requires a claimed dispatch');
  }
  assert.equal(store.getAttempt(execution.dispatch.claim.attemptId)?.status, AttemptStatus.RUNNING);
  assert.equal(
    store.getWorkerEventReceipt(workerEventId('worker-event_stale-context-001'))?.disposition,
    'IGNORED',
  );
  assert.equal(rowCount(filename, 'processed_commands'), 2);
  assert.equal(rowCount(filename, 'acceptance_decisions'), 0);
});

void test('[I-001][I-002][I-004] Worker shape tricks cannot mutate control or acceptance authority', async (t) => {
  for (const fixture of [
    FakeWorkerFixture.FABRICATED_ACCEPT,
    FakeWorkerFixture.CONTROL_MUTATION,
    FakeWorkerFixture.MALFORMED_EVENT,
  ]) {
    await t.test(fixture, async (fixtureTest) => {
      const namespace = fixture.replaceAll('-', '');
      const filename = temporaryDatabase(fixtureTest, `${namespace}.sqlite`);
      const store = openSqliteControlStore({ filename, now: () => createdAt });
      fixtureTest.after(() => store.close());
      const authority = seedAuthority(store, namespace);
      const application = createWorkerExecutionApplication(
        runtimeDependencies(store, new FakeWorker({ fixture }), authority, namespace),
      );

      const execution = await application.startGoal(startRequest(authority, namespace));

      assert.equal(execution.admissions[0]?.status, 'REJECTED');
      assert.equal(store.getWorkflow(authority.workflow.id)?.version, workflowVersion(2));
      assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.RUNNING);
      assert.equal(rowCount(filename, 'worker_event_receipts'), 0);
      assert.equal(rowCount(filename, 'acceptance_decisions'), 0);
      assert.equal(rowCount(filename, 'processed_commands'), 2);
    });
  }
});

void test('[I-005][I-006][I-019] Runtime rejects a self-consistent Context that disagrees with source authority', async (t) => {
  const cases: Readonly<Record<string, ContextFactoryOverride>> = Object.freeze({
    'altered-goal': (input, compiler, authority) =>
      compiler.compile({
        ...input,
        goal: decodeGoalSnapshot({
          ...input.goal,
          objective: 'A forged objective with the same Goal identity and revision',
        }),
        policyBundleId: authority.policy.id,
        policyBundleDigest: authority.policy.digest,
      }),
    'incomplete-manifest': (input, compiler, authority) => {
      const valid = compiler.compile({
        ...input,
        policyBundleId: authority.policy.id,
        policyBundleDigest: authority.policy.digest,
      });
      const incomplete = {
        ...valid.manifest,
        entries: valid.manifest.entries.slice(1),
      };
      return Object.freeze({
        package: valid.package,
        manifest: decodeContextManifest({
          ...incomplete,
          manifestDigest: digests.digest(contextManifestDigestProjection(incomplete)),
        }),
      });
    },
    'policy-substitution': (input, compiler) =>
      compiler.compile({
        ...input,
        policyBundleId: policyBundleId('policy_unselected-worker'),
        policyBundleDigest: digests.digest({ schemaVersion: 1, policy: 'unselected' }),
      }),
  });

  for (const [name, contextFactoryOverride] of Object.entries(cases)) {
    await t.test(name, async (caseTest) => {
      const namespace = name.replaceAll('-', '');
      const filename = temporaryDatabase(caseTest, `${namespace}.sqlite`);
      const store = openSqliteControlStore({ filename, now: () => createdAt });
      caseTest.after(() => store.close());
      const authority = seedAuthority(store, namespace);
      const application = createWorkerExecutionApplication(
        runtimeDependencies(
          store,
          new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
          authority,
          namespace,
          contextFactoryOverride,
        ),
      );

      const execution = await application.startGoal(startRequest(authority, namespace));

      assert.equal(execution.command.status, 'REJECTED');
      assert.equal(execution.command.output.error.code, RuntimeErrorCode.INTERNAL_FAILURE);
      assert.equal(execution.dispatch, undefined);
      assert.equal(execution.admissions.length, 0);
      assert.equal(store.getWorkflow(authority.workflow.id)?.version, workflowVersion(1));
      assert.equal(rowCount(filename, 'attempts'), 0);
      assert.equal(rowCount(filename, 'context_manifests'), 0);
      assert.equal(rowCount(filename, 'processed_commands'), 1);
    });
  }
});

void test('[I-008][I-010] a claimed delayed dispatch is aborted only after cancellation commits', async (t) => {
  const filename = temporaryDatabase(t, 'cancel-after-claim.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'cancelafter');
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.DELAYED_RESULT });
  const application = createWorkerExecutionApplication(
    runtimeDependencies(store, worker, authority, 'cancelafter'),
  );

  const running = application.startGoal(startRequest(authority, 'cancelafter'));
  await worker.waitUntilStarted();
  const beforeCancellation = store.getWorkflow(authority.workflow.id);
  assert.equal(beforeCancellation?.version, workflowVersion(2));
  if (beforeCancellation.activeAttemptId === undefined) {
    assert.fail('Delayed dispatch must own an active Attempt');
  }
  assert.notEqual(store.getWorkerDispatchClaim(beforeCancellation.activeAttemptId), undefined);

  const cancellation = application.cancelGoal({
    commandId: commandId('command_cancel-cancelafter'),
    goalId: authority.goal.id,
    expectedGoalRevision: authority.goal.revision,
    expectedWorkflowVersion: beforeCancellation.version,
    reason: 'user cancellation wins while the Worker is delayed',
  });
  const execution = await running;

  assert.equal(cancellation.status, 'APPLIED');
  assert.equal(execution.admissions.length, 0);
  assert.equal(execution.workerFailure, undefined);
  assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.CANCELLED);
  assert.equal(
    store.getAttempt(beforeCancellation.activeAttemptId)?.status,
    AttemptStatus.INTERRUPTED,
  );
  assert.equal(rowCount(filename, 'worker_event_receipts'), 0);
});

void test('[I-008][I-010] cancellation that wins first makes the prepared dispatch ineligible', (t) => {
  const filename = temporaryDatabase(t, 'cancel-before-claim.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'cancelbefore');
  const dependencies = runtimeDependencies(
    store,
    new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
    authority,
    'cancelbefore',
  );
  const kernel = new WorkflowRuntimeKernel(dependencies);

  assert.equal(kernel.startGoal(startRequest(authority, 'cancelbefore')).status, 'APPLIED');
  const running = store.getWorkflow(authority.workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('StartGoal must prepare an active Worker Attempt');
  }
  const request = kernel.takePreparedWorkerRequest(running.activeAttemptId);
  if (request === undefined) {
    assert.fail('StartGoal must prepare a Worker Request');
  }
  assert.equal(
    kernel.cancelGoal({
      commandId: commandId('command_cancel-cancelbefore'),
      goalId: authority.goal.id,
      expectedGoalRevision: authority.goal.revision,
      expectedWorkflowVersion: running.version,
      reason: 'cancellation commits before dispatch claim',
    }).status,
    'APPLIED',
  );

  const dispatch = kernel.claimWorkerDispatch(request);

  assert.equal(dispatch.status, 'NOT_ELIGIBLE');
  assert.equal(store.getWorkerDispatchClaim(request.attemptId), undefined);
  assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.CANCELLED);
});

void test('[I-006][I-008] failure after Context Manifest write rolls back the entire Attempt start', (t) => {
  const filename = temporaryDatabase(t, 'context-rollback.sqlite');
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: (step) => {
      if (step === WorkerTransactionStep.AFTER_CONTEXT_MANIFEST_WRITE) {
        throw new Error('injected Context Manifest failure');
      }
    },
  });
  const authority = seedAuthority(store, 'contextrollback');
  const kernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'contextrollback',
    ),
  );

  const result = kernel.startGoal(startRequest(authority, 'contextrollback'));

  assert.equal(result.status, 'REJECTED');
  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(authority.workflow.id)?.version, workflowVersion(1));
  assert.equal(rowCount(filename, 'attempts'), 0);
  assert.equal(rowCount(filename, 'context_manifests'), 0);
  assert.equal(rowCount(filename, 'processed_commands'), 1);
  assert.equal(rowCount(filename, 'audit_events'), 2);
});

void test('[I-006][I-008] failure after Policy write leaves no installed authority', (t) => {
  const filename = temporaryDatabase(t, 'policy-rollback.sqlite');
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: (step) => {
      if (step === WorkerTransactionStep.AFTER_POLICY_WRITE) {
        throw new Error('injected Policy write failure');
      }
    },
  });
  const policy = policyBundle();

  assert.throws(
    () => store.installPolicyBundle({ bundle: policy, installedAt: createdAt }),
    /injected Policy write failure/,
  );
  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getPolicyBundle(policy.id), undefined);
  assert.equal(rowCount(filename, 'policy_bundles'), 0);
});

void test('[I-008][I-010] failure after dispatch-claim write rolls back the claim and never calls WorkerPort', async (t) => {
  const filename = temporaryDatabase(t, 'dispatch-rollback.sqlite');
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: (step) => {
      if (step === WorkerTransactionStep.AFTER_DISPATCH_CLAIM_WRITE) {
        throw new Error('injected dispatch claim failure');
      }
    },
  });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'dispatchrollback');
  const worker = new CountingWorker();
  const application = createWorkerExecutionApplication(
    runtimeDependencies(store, worker, authority, 'dispatchrollback'),
  );

  const execution = await application.startGoal(startRequest(authority, 'dispatchrollback'));

  assert.equal(execution.dispatch?.status, 'FAILED');
  assert.equal(worker.calls, 0);
  const workflow = store.getWorkflow(authority.workflow.id);
  if (workflow?.activeAttemptId === undefined) {
    assert.fail('Context-bound Attempt must remain recoverable after dispatch failure');
  }
  assert.equal(store.getWorkerDispatchClaim(workflow.activeAttemptId), undefined);
  assert.equal(rowCount(filename, 'worker_dispatch_claims'), 0);
});

void test('[I-006][I-008][I-009] failure after Worker receipt write rolls back result, audit, outcome, and receipt', async (t) => {
  const filename = temporaryDatabase(t, 'receipt-rollback.sqlite');
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    transactionProbe: (step) => {
      if (step === WorkerTransactionStep.AFTER_WORKER_RECEIPT_WRITE) {
        throw new Error('injected Worker receipt failure');
      }
    },
  });
  const authority = seedAuthority(store, 'receiptrollback');
  const application = createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'receiptrollback',
    ),
  );

  const execution = await application.startGoal(startRequest(authority, 'receiptrollback'));

  assert.equal(execution.admissions[0]?.status, 'REJECTED');
  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => reopened.close());
  const workflow = reopened.getWorkflow(authority.workflow.id);
  assert.equal(workflow?.version, workflowVersion(2));
  assert.equal(workflow.runStatus, RunStatus.RUNNING);
  if (workflow.activeAttemptId === undefined) {
    assert.fail('Rolled-back Worker result must leave the active Attempt intact');
  }
  assert.equal(reopened.getAttempt(workflow.activeAttemptId)?.status, AttemptStatus.RUNNING);
  assert.equal(rowCount(filename, 'worker_event_receipts'), 0);
  assert.equal(rowCount(filename, 'processed_commands'), 2);
  assert.equal(rowCount(filename, 'acceptance_decisions'), 0);
});

void test('[I-006][I-008][I-009] SQLite backstops reject forged dispatch and immutable authority rewrites', async (t) => {
  const filename = temporaryDatabase(t, 'sqlite-worker-backstop.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'sqlbackstop');
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  const dependencies = runtimeDependencies(store, worker, authority, 'sqlbackstop');
  const kernel = new WorkflowRuntimeKernel(dependencies);
  assert.equal(kernel.startGoal(startRequest(authority, 'sqlbackstop')).status, 'APPLIED');
  const workflow = store.getWorkflow(authority.workflow.id);
  if (workflow?.activeAttemptId === undefined) {
    assert.fail('Backstop fixture must own an active Attempt');
  }
  const request = kernel.takePreparedWorkerRequest(workflow.activeAttemptId);
  if (request === undefined) {
    assert.fail('Backstop fixture must prepare a Worker Request');
  }
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  t.after(() => database.close());

  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO worker_dispatch_claims(
             attempt_id, schema_version, workflow_id, workflow_version, worker_session_id,
             context_manifest_id, context_manifest_digest, package_digest, claimed_at
           ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          request.attemptId,
          request.contextPackage.workflowId,
          request.contextPackage.workflowVersion,
          'worker_forged-0001',
          request.contextManifestId,
          request.contextManifestDigest,
          request.packageDigest,
          '2026-07-27T00:00:00.020Z',
        ),
    /Worker dispatch is not eligible/,
  );
  assert.throws(
    () =>
      database
        .prepare('UPDATE context_manifests SET package_digest = ? WHERE id = ?')
        .run(digests.digest({ forged: true }), request.contextManifestId),
    /context manifests are immutable/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          'UPDATE attempts SET context_manifest_id = NULL, worker_session_ref = NULL WHERE id = ?',
        )
        .run(request.attemptId),
    /Attempt Context and Worker bindings are immutable/,
  );

  assert.equal(kernel.claimWorkerDispatch(request).status, 'CLAIMED');
  const events: unknown[] = [];
  for await (const event of worker.run(request, new AbortController().signal)) {
    events.push(event);
  }
  const admission = kernel.admitWorkerEvent(events[0], request);
  assert.equal(admission.status, 'ADMITTED');

  assert.throws(
    () =>
      database
        .prepare('UPDATE worker_dispatch_claims SET claimed_at = ? WHERE attempt_id = ?')
        .run('2026-07-27T00:00:00.030Z', request.attemptId),
    /Worker dispatch claims are immutable/,
  );
  assert.throws(
    () =>
      database
        .prepare('DELETE FROM worker_event_receipts WHERE event_id = ?')
        .run(admission.eventId),
    /Worker Event receipts are immutable/,
  );
});

void test('[I-006][I-008] migration 0009 refuses poisoned retained Context authority atomically', (t) => {
  const filename = temporaryDatabase(t, 'poisoned-context-migration.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-context-migrations-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  const migrationNames = readdirSync(sourceDirectory).filter(
    (name) => name.endsWith('.sql') && name < '0009_context_worker_dispatch.sql',
  );
  for (const name of migrationNames) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }

  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  oldStore.close();
  const raw = new Database(filename);
  raw
    .prepare(
      `INSERT INTO policy_bundles(
         id, schema_version, policy_version, checker_identities_json,
         canonical_content_json, bundle_digest, installed_at
       ) VALUES (?, 2, ?, '[]', '{}', ?, ?)`,
    )
    .run(
      'policy_poisoned-retained',
      'unsupported-schema',
      digests.digest({ poisoned: true }),
      createdAt,
    );
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0009_context_worker_dispatch.sql'),
    join(migrationsDirectory, '0009_context_worker_dispatch.sql'),
  );

  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => createdAt,
      }),
    /CHECK constraint failed/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 9')
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('worker_dispatch_claims', 'worker_event_receipts')",
      )
      .pluck()
      .get(),
    0,
  );
});

void test('[I-004][I-006][I-008] migration 0009 refuses a retained Worker Session without Context', (t) => {
  const filename = temporaryDatabase(t, 'poisoned-worker-binding-migration.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-worker-migrations-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  const migrationNames = readdirSync(sourceDirectory).filter(
    (name) => name.endsWith('.sql') && name < '0009_context_worker_dispatch.sql',
  );
  for (const name of migrationNames) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }

  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const authority = seedAuthority(oldStore, 'poisonedworkerbinding');
  const ids = new DeterministicIds('poisoned-worker-binding');
  const runtime = new WorkflowRuntimeKernel({
    store: oldStore,
    clock: monotonicClock(),
    ids,
    digests,
  });
  assert.equal(
    runtime.startGoal(startRequest(authority, 'poisonedworkerbinding')).status,
    'APPLIED',
  );
  const running = oldStore.getWorkflow(authority.workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Pre-migration fixture must contain a running Attempt');
  }
  const poisonedAttemptId = running.activeAttemptId;
  oldStore.close();

  const raw = new Database(filename);
  raw
    .prepare('UPDATE attempts SET worker_session_ref = ? WHERE id = ?')
    .run('worker_poisoned-retained', poisonedAttemptId);
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0009_context_worker_dispatch.sql'),
    join(migrationsDirectory, '0009_context_worker_dispatch.sql'),
  );

  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => createdAt,
      }),
    /CHECK constraint failed/,
  );

  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  t.after(() => inspected.close());
  assert.equal(
    inspected
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 9')
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name IN ('worker_dispatch_claims', 'worker_event_receipts')",
      )
      .pluck()
      .get(),
    0,
  );
});
