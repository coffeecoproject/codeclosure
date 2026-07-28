import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  AttemptFailureClass,
  AttemptStatus,
  ContextAuthorityClass,
  ContextEntryKind,
  RunStatus,
  candidateGenerationId,
  commandId,
  createGoal,
  createWorkflow,
  decideAttempt,
  decodeContextManifest,
  decodeContextPackage,
  decodeGoalSnapshot,
  decodePolicyBundle,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  successCriterionId,
  workflowId,
  workflowVersion,
  type Goal,
  type PolicyBundle,
  type PolicyBundleDefinition,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  RuntimeErrorCode,
  WorkerEventNonAdmissionClass,
  contextManifestDigestProjection,
  createPolicyInstaller,
  createWorkerExecutionApplication,
  decodeWorkerEvent,
  decodeWorkerEventReceipt,
  deriveContextManifestEntries,
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
} from '@codeclosure/runtime/testing/workflow-runtime';

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

function policyBundleDefinition(): PolicyBundleDefinition {
  return Object.freeze({
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
}

function policyBundle(): PolicyBundle {
  const definition = policyBundleDefinition();
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
  const policyInstall = createPolicyInstaller({
    store,
    clock: Object.freeze({ now: () => policyInstalledAt }),
    ids: new DeterministicIds(`policy-${namespace}`),
    digests,
  }).installPolicyBundle(policyBundleDefinition());
  if (policyInstall.status === 'POLICY_CONFLICT') {
    assert.fail(policyInstall.message);
  }
  const policy = policyInstall.value.bundle;
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

function sequenceClock(...timestamps: readonly ReturnType<typeof isoTimestamp>[]): Clock {
  if (timestamps.length === 0) {
    throw new TypeError('Sequence clock requires at least one timestamp');
  }
  const finalTimestamp = timestamps.at(-1);
  if (finalTimestamp === undefined) {
    throw new TypeError('Sequence clock could not resolve its final timestamp');
  }
  let index = 0;
  return Object.freeze({
    now: () => timestamps[Math.min(index++, timestamps.length - 1)] ?? finalTimestamp,
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
  const policyAudits = reopened.listAuditEvents('POLICY', authority.policy.id);
  assert.equal(policyAudits.length, 1);
  const policyAudit = policyAudits[0];
  if (policyAudit === undefined) {
    assert.fail('Installed Policy must have one audit record');
  }
  assert.equal(policyAudit.eventType, 'POLICY_BUNDLE_INSTALLED');
  assert.equal(policyAudit.payloadDigest, authority.policy.digest);
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
  const admitted = execution.admissions[0];
  if (admitted?.status !== 'ADMITTED') {
    assert.fail('Duplicate fixture must admit its first delivery');
  }
  assert.equal(store.getWorkflow(authority.workflow.id)?.version, workflowVersion(3));
  assert.equal(store.getWorkerEventReceipt(admitted.eventId)?.disposition, 'ADMITTED');
  assert.equal(rowCount(filename, 'worker_event_receipts'), 1);
  assert.equal(rowCount(filename, 'processed_commands'), 3);
});

void test('[I-002][I-009] FakeWorker event identity is deterministic per dispatched request', async (t) => {
  const filename = temporaryDatabase(t, 'independent-worker-events.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const firstAuthority = seedAuthority(store, 'firstevent');
  const secondAuthority = seedAuthority(store, 'secondevent');
  const firstApplication = createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      firstAuthority,
      'firstevent',
    ),
  );
  const secondApplication = createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      secondAuthority,
      'secondevent',
    ),
  );

  const first = await firstApplication.startGoal(startRequest(firstAuthority, 'firstevent'));
  const second = await secondApplication.startGoal(startRequest(secondAuthority, 'secondevent'));

  assert.equal(first.admissions[0]?.status, 'ADMITTED');
  assert.equal(second.admissions[0]?.status, 'ADMITTED');
  assert.notEqual(first.admissions[0].eventId, second.admissions[0].eventId);
  assert.equal(rowCount(filename, 'worker_event_receipts'), 2);
  assert.equal(store.getWorkflow(firstAuthority.workflow.id)?.runStatus, RunStatus.READY);
  assert.equal(store.getWorkflow(secondAuthority.workflow.id)?.runStatus, RunStatus.READY);
});

void test('[I-008][I-009][I-019] stale Context is durably ignored before stream protocol failure', async (t) => {
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
  assert.equal(execution.workerFailure?.status, 'APPLIED');
  assert.equal(store.getWorkflow(authority.workflow.id)?.version, workflowVersion(3));
  assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.FAILED);
  if (execution.dispatch?.status !== 'CLAIMED') {
    assert.fail('Stale result test requires a claimed dispatch');
  }
  const attempt = store.getAttempt(execution.dispatch.claim.attemptId);
  assert.equal(attempt?.status, AttemptStatus.FAILED);
  assert.equal(attempt.failureClass, AttemptFailureClass.PROTOCOL_ERROR);
  assert.equal(
    store.getWorkerEventReceipt(execution.admissions[0].eventId)?.disposition,
    'IGNORED',
  );
  assert.equal(rowCount(filename, 'processed_commands'), 3);
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
      assert.equal(execution.workerFailure?.status, 'APPLIED');
      const workflow = store.getWorkflow(authority.workflow.id);
      assert.equal(workflow?.version, workflowVersion(3));
      assert.equal(workflow.runStatus, RunStatus.FAILED);
      if (execution.dispatch?.status !== 'CLAIMED') {
        assert.fail('Protocol failure fixture must have a claimed dispatch');
      }
      const attempt = store.getAttempt(execution.dispatch.claim.attemptId);
      assert.equal(attempt?.status, AttemptStatus.FAILED);
      assert.equal(attempt.failureClass, AttemptFailureClass.PROTOCOL_ERROR);
      assert.equal(rowCount(filename, 'worker_event_receipts'), 0);
      assert.equal(rowCount(filename, 'acceptance_decisions'), 0);
      assert.equal(rowCount(filename, 'processed_commands'), 3);
    });
  }
});

void test('[I-002][I-008] an empty Worker stream becomes a durable protocol failure', async (t) => {
  const filename = temporaryDatabase(t, 'empty-worker-stream.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'emptystream');
  const worker = new CountingWorker();
  const rollbackClock = sequenceClock(
    isoTimestamp('2026-07-27T00:00:00.010Z'),
    isoTimestamp('2026-07-27T00:00:00.100Z'),
    isoTimestamp('2026-07-27T00:00:00.020Z'),
  );
  const application = createWorkerExecutionApplication(
    runtimeDependencies(store, worker, authority, 'emptystream', undefined, rollbackClock),
  );

  const execution = await application.startGoal(startRequest(authority, 'emptystream'));

  assert.equal(worker.calls, 1);
  assert.equal(execution.dispatch?.status, 'CLAIMED');
  assert.equal(execution.admissions.length, 0);
  assert.equal(execution.workerFailure?.status, 'APPLIED');
  const workflow = store.getWorkflow(authority.workflow.id);
  assert.equal(workflow?.runStatus, RunStatus.FAILED);
  const attempt = store.getAttempt(execution.dispatch.claim.attemptId);
  assert.equal(attempt?.status, AttemptStatus.FAILED);
  assert.equal(attempt.failureClass, AttemptFailureClass.PROTOCOL_ERROR);
  assert.equal(attempt.endedAt, execution.dispatch.claim.claimedAt);
  assert.equal(workflow.updatedAt, execution.dispatch.claim.claimedAt);
  assert.equal(rowCount(filename, 'worker_event_receipts'), 0);
});

void test('[I-002][I-008] abrupt Worker termination remains distinguishable from protocol failure', async (t) => {
  const filename = temporaryDatabase(t, 'abrupt-worker-stream.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'abruptstream');
  const rollbackClock = sequenceClock(
    isoTimestamp('2026-07-27T00:00:00.010Z'),
    isoTimestamp('2026-07-27T00:00:00.100Z'),
    isoTimestamp('2026-07-27T00:00:00.020Z'),
  );
  const application = createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.ABRUPT_TERMINATION }),
      authority,
      'abruptstream',
      undefined,
      rollbackClock,
    ),
  );

  const execution = await application.startGoal(startRequest(authority, 'abruptstream'));

  assert.equal(execution.admissions.length, 0);
  assert.equal(execution.workerFailure?.status, 'APPLIED');
  const workflow = store.getWorkflow(authority.workflow.id);
  assert.equal(workflow?.runStatus, RunStatus.BLOCKED);
  if (execution.dispatch?.status !== 'CLAIMED') {
    assert.fail('Abrupt termination fixture must have a claimed dispatch');
  }
  const attempt = store.getAttempt(execution.dispatch.claim.attemptId);
  assert.equal(attempt?.status, AttemptStatus.FAILED);
  assert.equal(attempt.failureClass, AttemptFailureClass.ABRUPT_TERMINATION);
  assert.equal(attempt.endedAt, execution.dispatch.claim.claimedAt);
  assert.equal(workflow.updatedAt, execution.dispatch.claim.claimedAt);
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
    'forged-human-decision': (input, compiler, authority) =>
      compiler.compile({
        ...input,
        policyBundleId: authority.policy.id,
        policyBundleDigest: authority.policy.digest,
        selectedEntries: Object.freeze([
          Object.freeze({
            kind: ContextEntryKind.DECISION,
            sourceRef: 'decision_not-persisted',
            sourceRevision: '1',
            authorityClass: ContextAuthorityClass.HUMAN_DECISION,
            renderedContent: 'A Worker-facing factory claimed this was a confirmed human choice.',
          }),
        ]),
      }),
    'forged-candidate': (input, compiler, authority) => {
      const valid = compiler.compile({
        ...input,
        policyBundleId: authority.policy.id,
        policyBundleDigest: authority.policy.digest,
      });
      const generationId = candidateGenerationId('generation_not-owned-by-slice4');
      const candidateDigest = digests.digest({ generationId, content: 'factory-forged' });
      const contextPackage = decodeContextPackage({
        ...valid.package,
        candidateGenerationId: generationId,
        candidateDigest,
      });
      const entries = deriveContextManifestEntries(contextPackage, digests);
      const manifestBase = Object.freeze({
        ...valid.manifest,
        candidateGenerationId: generationId,
        candidateDigest,
        entries,
        packageDigest: digests.digest(contextPackage),
      });
      return Object.freeze({
        package: contextPackage,
        manifest: decodeContextManifest({
          ...manifestBase,
          manifestDigest: digests.digest(contextManifestDigestProjection(manifestBase)),
        }),
      });
    },
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
  const rollbackClock = sequenceClock(
    isoTimestamp('2026-07-27T00:00:00.010Z'),
    isoTimestamp('2026-07-27T00:00:00.100Z'),
    isoTimestamp('2026-07-27T00:00:00.020Z'),
  );
  const application = createWorkerExecutionApplication(
    runtimeDependencies(store, worker, authority, 'cancelafter', undefined, rollbackClock),
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
  const cancelledWorkflow = store.getWorkflow(authority.workflow.id);
  const interruptedAttempt = store.getAttempt(beforeCancellation.activeAttemptId);
  const dispatchClaim = store.getWorkerDispatchClaim(beforeCancellation.activeAttemptId);
  assert.equal(cancelledWorkflow?.runStatus, RunStatus.CANCELLED);
  assert.equal(interruptedAttempt?.status, AttemptStatus.INTERRUPTED);
  if (dispatchClaim === undefined) {
    assert.fail('Cancellation time floor fixture must retain its dispatch claim');
  }
  assert.equal(interruptedAttempt.endedAt, dispatchClaim.claimedAt);
  assert.equal(cancelledWorkflow.updatedAt, dispatchClaim.claimedAt);
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

void test('[I-006][I-008][I-009] restart reconciliation cannot predate a retained dispatch claim', (t) => {
  const filename = temporaryDatabase(t, 'restart-dispatch-time-floor.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const authority = seedAuthority(store, 'restartdispatchtime');
  const initialClock = sequenceClock(
    isoTimestamp('2026-07-27T00:00:00.010Z'),
    isoTimestamp('2026-07-27T00:00:00.100Z'),
  );
  const initialKernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      store,
      new CountingWorker(),
      authority,
      'restartdispatchtime-initial',
      undefined,
      initialClock,
    ),
  );
  assert.equal(
    initialKernel.startGoal(startRequest(authority, 'restartdispatchtime')).status,
    'APPLIED',
  );
  const running = store.getWorkflow(authority.workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Restart reconciliation fixture must have an active Attempt');
  }
  const request = initialKernel.takePreparedWorkerRequest(running.activeAttemptId);
  if (request === undefined) {
    assert.fail('Restart reconciliation fixture must have a prepared Worker Request');
  }
  const dispatch = initialKernel.claimWorkerDispatch(request);
  if (dispatch.status !== 'CLAIMED') {
    assert.fail('Restart reconciliation fixture must retain a dispatch claim');
  }
  store.close();

  const reopened = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => reopened.close());
  const rollbackClock: Clock = Object.freeze({
    now: () => isoTimestamp('2026-07-27T00:00:00.020Z'),
  });
  const recoveryKernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      reopened,
      new CountingWorker(),
      authority,
      'restartdispatchtime-recovery',
      undefined,
      rollbackClock,
    ),
  );
  const reconciled = recoveryKernel.reconcileAttemptAfterRestart({
    commandId: commandId('command_reconcile-restartdispatchtime'),
    workflowId: authority.workflow.id,
    expectedWorkflowVersion: running.version,
    attemptId: running.activeAttemptId,
    reason: 'restart cannot prove the in-flight external effect',
  });

  assert.equal(reconciled.status, 'APPLIED');
  const attempt = reopened.getAttempt(running.activeAttemptId);
  const workflow = reopened.getWorkflow(authority.workflow.id);
  assert.equal(attempt?.status, AttemptStatus.INTERRUPTED);
  assert.equal(workflow?.runStatus, RunStatus.BLOCKED);
  assert.equal(attempt.endedAt, dispatch.claim.claimedAt);
  assert.equal(workflow.updatedAt, dispatch.claim.claimedAt);
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
  assert.equal(rowCount(filename, 'audit_events'), 3);
});

void test('[I-006][I-008] Policy authority and its audit roll back as one transaction', async (t) => {
  for (const failureStep of [
    WorkerTransactionStep.AFTER_POLICY_AUDIT_WRITE,
    WorkerTransactionStep.AFTER_POLICY_WRITE,
  ]) {
    await t.test(failureStep, (caseTest) => {
      const filename = temporaryDatabase(caseTest, `${failureStep.toLowerCase()}.sqlite`);
      const store = openSqliteControlStore({
        filename,
        now: () => createdAt,
        transactionProbe: (step) => {
          if (step === failureStep) {
            throw new Error(`injected ${failureStep} failure`);
          }
        },
      });
      const definition = policyBundleDefinition();
      const installer = createPolicyInstaller({
        store,
        clock: Object.freeze({ now: () => createdAt }),
        ids: new DeterministicIds(`rollback-${failureStep.toLowerCase().replaceAll('_', '-')}`),
        digests,
      });

      assert.throws(
        () => installer.installPolicyBundle(definition),
        new RegExp(`injected ${failureStep} failure`),
      );
      store.close();
      const reopened = openSqliteControlStore({ filename, now: () => createdAt });
      caseTest.after(() => reopened.close());
      assert.equal(reopened.getPolicyBundle(definition.id), undefined);
      assert.equal(rowCount(filename, 'policy_bundles'), 0);
      assert.equal(
        reopened.listAuditEvents('POLICY', definition.id).length,
        0,
        'Policy audit must not survive without its Policy Bundle',
      );
    });
  }
});

void test('[I-005][I-006][I-008] Policy installation recomputes identity and requires audit authority', (t) => {
  const filename = temporaryDatabase(t, 'policy-authority-closure.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const validPolicy = policyBundle();
  const forgedDigest = digests.digest({ schemaVersion: 1, forgedPolicy: true });
  const forgedPolicy = decodePolicyBundle({ ...validPolicy, digest: forgedDigest });

  assert.throws(
    () =>
      store.installPolicyBundle({
        bundle: forgedPolicy,
        installedAt: createdAt,
        auditEventId: new DeterministicIds('forged-policy').nextAuditEventId(),
        payloadDigest: forgedDigest,
      }),
    /Policy Bundle digest does not match its canonical projection/,
  );
  assert.equal(store.getPolicyBundle(validPolicy.id), undefined);
  assert.equal(store.listAuditEvents('POLICY', validPolicy.id).length, 0);

  const database = new Database(filename);
  t.after(() => database.close());
  assert.throws(
    () =>
      database
        .prepare(
          `INSERT INTO policy_bundles(
             id, schema_version, policy_version, checker_identities_json,
             canonical_content_json, bundle_digest, installed_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          validPolicy.id,
          validPolicy.schemaVersion,
          validPolicy.version,
          JSON.stringify(validPolicy.checkerVersions),
          JSON.stringify(policyBundleProjection(validPolicy)),
          validPolicy.digest,
          createdAt,
        ),
    /Policy Bundle requires matching installation audit authority/,
  );
});

void test('[I-005][I-006] Policy installer strictly decodes Store results', async (t) => {
  const definition = policyBundleDefinition();
  const expectedBundle = policyBundle();
  const cases = Object.freeze({
    'extra-result-field': Object.freeze({
      status: 'INSTALLED' as const,
      value: Object.freeze({ bundle: expectedBundle, installedAt: createdAt }),
      unexpected: true,
    }),
    'extra-installed-field': Object.freeze({
      status: 'INSTALLED' as const,
      value: Object.freeze({
        bundle: expectedBundle,
        installedAt: createdAt,
        unexpected: true,
      }),
    }),
  });

  for (const [name, result] of Object.entries(cases)) {
    await t.test(name, () => {
      const installer = createPolicyInstaller({
        store: Object.freeze({ installPolicyBundle: () => result }),
        clock: Object.freeze({ now: () => createdAt }),
        ids: new DeterministicIds(`strict-policy-${name}`),
        digests,
      });

      assert.throws(() => installer.installPolicyBundle(definition));
    });
  }
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
  assert.equal(
    execution.admissions[0].nonAdmissionClass,
    WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE,
  );
  assert.equal(execution.workerFailure, undefined);
  if (execution.dispatch?.status !== 'CLAIMED') {
    assert.fail('Receipt rollback fixture must have a claimed dispatch');
  }
  const attemptIdentifier = execution.dispatch.claim.attemptId;
  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => reopened.close());
  const workflow = reopened.getWorkflow(authority.workflow.id);
  assert.equal(workflow?.version, workflowVersion(2));
  assert.equal(workflow.runStatus, RunStatus.RUNNING);
  const attempt = reopened.getAttempt(attemptIdentifier);
  assert.equal(attempt?.status, AttemptStatus.RUNNING);
  assert.equal(rowCount(filename, 'worker_event_receipts'), 0);
  assert.equal(rowCount(filename, 'processed_commands'), 2);
  assert.equal(rowCount(filename, 'acceptance_decisions'), 0);
});

void test('[I-008][I-010] Runtime refuses Worker delivery without a durable dispatch claim', async (t) => {
  const filename = temporaryDatabase(t, 'missing-dispatch-claim.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'missingclaim');
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  const kernel = new WorkflowRuntimeKernel(
    runtimeDependencies(store, worker, authority, 'missingclaim'),
  );
  assert.equal(kernel.startGoal(startRequest(authority, 'missingclaim')).status, 'APPLIED');
  const workflow = store.getWorkflow(authority.workflow.id);
  if (workflow?.activeAttemptId === undefined) {
    assert.fail('Missing-claim fixture must prepare an active Attempt');
  }
  const request = kernel.takePreparedWorkerRequest(workflow.activeAttemptId);
  if (request === undefined) {
    assert.fail('Missing-claim fixture must prepare a Worker Request');
  }
  const events: unknown[] = [];
  for await (const event of worker.run(request, new AbortController().signal)) {
    events.push(event);
  }
  const event = decodeWorkerEvent(events[0]);
  const ignoredReceipt = decodeWorkerEventReceipt({
    schemaVersion: 1,
    eventId: event.id,
    payloadDigest: digests.digest(event),
    workerSessionId: event.workerSessionId,
    workflowId: workflow.id,
    observedWorkflowVersion: workflow.version,
    attemptId: event.attemptId,
    contextManifestId: event.contextManifestId,
    contextManifestDigest: event.contextManifestDigest,
    packageDigest: event.packageDigest,
    receivedAt: isoTimestamp('2026-07-27T00:00:00.030Z'),
    disposition: 'IGNORED',
    reasonCode: 'MISSING_DISPATCH_CLAIM_FIXTURE',
  });
  if (ignoredReceipt.disposition !== 'IGNORED') {
    assert.fail('Missing-claim fixture must construct an ignored receipt');
  }

  assert.equal(
    kernel.recordWorkerPortFailure(
      request,
      AttemptFailureClass.PROTOCOL_ERROR,
      'must not record failure before dispatch',
    ),
    undefined,
  );
  assert.throws(
    () =>
      store.recordIgnoredWorkerEvent({
        receipt: ignoredReceipt,
      }),
    /has no durable dispatch causality/,
  );

  const admission = kernel.admitWorkerEvent(event, request);

  assert.equal(admission.status, 'REJECTED');
  assert.equal(admission.reasonCode, 'WORKER_DISPATCH_CLAIM_MISSING');
  assert.equal(admission.nonAdmissionClass, WorkerEventNonAdmissionClass.CONTROL_PLANE_FAILURE);
  assert.equal(store.getWorkerDispatchClaim(request.attemptId), undefined);
  assert.equal(store.getWorkflow(authority.workflow.id)?.version, workflowVersion(2));
  assert.equal(store.getAttempt(request.attemptId)?.status, AttemptStatus.RUNNING);
  assert.equal(rowCount(filename, 'worker_event_receipts'), 0);
  assert.equal(rowCount(filename, 'processed_commands'), 2);
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

  const dispatch = kernel.claimWorkerDispatch(request);
  assert.equal(dispatch.status, 'CLAIMED');
  const currentAttempt = store.getAttempt(request.attemptId);
  if (currentAttempt === undefined) {
    assert.fail('Dispatch time backstop fixture must retain its Attempt');
  }
  const bypassCommandId = commandId('command_bypass-dispatch-time');
  const bypassDecision = decideAttempt(workflow, currentAttempt, {
    type: 'RECORD_ATTEMPT_FAILURE',
    commandId: bypassCommandId,
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    attemptId: currentAttempt.id,
    failureClass: AttemptFailureClass.PROTOCOL_ERROR,
    occurredAt: isoTimestamp('2026-07-27T00:00:00.010Z'),
    reason: 'a direct Store caller tries to bypass dispatch causality',
  });
  if (!bypassDecision.accepted) {
    assert.fail(bypassDecision.rejection.message);
  }
  const bypassEvent = bypassDecision.events[0];
  const bypassIds = new DeterministicIds('dispatch-time-bypass');
  assert.throws(
    () =>
      store.commitAttemptEvent({
        inputDigest: digests.digest({ schemaVersion: 1, bypassCommandId }),
        target: Object.freeze({ aggregateType: 'WORKFLOW', aggregateId: workflow.id }),
        event: bypassEvent,
        auditEventId: bypassIds.nextAuditEventId(),
        workflowAuditEventId: bypassIds.nextAuditEventId(),
        payloadDigest: digests.digest(bypassEvent),
      }),
    /predates its dispatch claim/,
  );
  assert.equal(store.getAttempt(request.attemptId)?.status, AttemptStatus.RUNNING);
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE attempts
              SET status = 'FAILED', failure_class = 'PROTOCOL_ERROR',
                  termination_reason = 'forged before claim',
                  ended_at = '2026-07-27T00:00:00.010Z'
            WHERE id = ?`,
        )
        .run(request.attemptId),
    /Attempt cannot end before its Worker dispatch claim/,
  );
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

void test('[I-006][I-008] migration 0010 refuses a retained unaudited Policy atomically', (t) => {
  const filename = temporaryDatabase(t, 'unaudited-policy-migration.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-policy-closure-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0010_worker_authority_closure.sql',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  oldStore.close();
  const policy = policyBundle();
  const raw = new Database(filename);
  raw
    .prepare(
      `INSERT INTO policy_bundles(
         id, schema_version, policy_version, checker_identities_json,
         canonical_content_json, bundle_digest, installed_at
       ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      policy.id,
      policy.schemaVersion,
      policy.version,
      JSON.stringify(policy.checkerVersions),
      JSON.stringify(policyBundleProjection(policy)),
      policy.digest,
      createdAt,
    );
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0010_worker_authority_closure.sql'),
    join(migrationsDirectory, '0010_worker_authority_closure.sql'),
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
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 10')
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'policy_bundles_audited_insert_guard'",
      )
      .pluck()
      .get(),
    0,
  );
});

void test('[I-005][I-006][I-008] migration 0010 refuses unresolved retained Context authority', (t) => {
  const filename = temporaryDatabase(t, 'unresolved-context-migration.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-context-closure-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0010_worker_authority_closure.sql',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const authority = seedAuthority(oldStore, 'unresolvedcontext');
  const kernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      oldStore,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'unresolvedcontext',
    ),
  );
  assert.equal(kernel.startGoal(startRequest(authority, 'unresolvedcontext')).status, 'APPLIED');
  oldStore.close();
  const raw = new Database(filename);
  raw.exec('DROP TRIGGER context_manifests_no_update');
  raw
    .prepare(
      `UPDATE context_manifests
          SET entries_json = json_insert(entries_json, '$[#]', json(?))`,
    )
    .run(
      JSON.stringify({
        kind: ContextEntryKind.DECISION,
        sourceRef: 'decision_unresolved-retained',
        sourceRevision: '1',
        authorityClass: ContextAuthorityClass.HUMAN_DECISION,
        renderedDigest: digests.digest({ unresolved: true }),
      }),
    );
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0010_worker_authority_closure.sql'),
    join(migrationsDirectory, '0010_worker_authority_closure.sql'),
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
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 10')
      .pluck()
      .get(),
    0,
  );
});

void test('[I-004][I-006][I-008] migration 0010 refuses retained Candidate Context before Slice 5', (t) => {
  const filename = temporaryDatabase(t, 'candidate-context-migration.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-candidate-context-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0010_worker_authority_closure.sql',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const authority = seedAuthority(oldStore, 'candidatecontextmigration');
  const kernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      oldStore,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'candidatecontextmigration',
    ),
  );
  assert.equal(
    kernel.startGoal(startRequest(authority, 'candidatecontextmigration')).status,
    'APPLIED',
  );
  oldStore.close();
  const raw = new Database(filename);
  raw.pragma('foreign_keys = OFF');
  raw.exec('DROP TRIGGER context_manifests_no_update');
  raw
    .prepare(
      `UPDATE context_manifests
          SET candidate_generation_id = ?, candidate_digest = ?`,
    )
    .run('generation_unowned-retained', digests.digest({ candidate: 'unowned-retained' }));
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0010_worker_authority_closure.sql'),
    join(migrationsDirectory, '0010_worker_authority_closure.sql'),
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
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 10')
      .pluck()
      .get(),
    0,
  );
});

void test('[I-006][I-008][I-010] migration 0010 refuses a retained receipt without dispatch causality', async (t) => {
  const filename = temporaryDatabase(t, 'orphaned-worker-receipt-migration.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-dispatch-closure-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0010_worker_authority_closure.sql',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const authority = seedAuthority(oldStore, 'orphanedreceipt');
  const execution = await createWorkerExecutionApplication(
    runtimeDependencies(
      oldStore,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'orphanedreceipt',
    ),
  ).startGoal(startRequest(authority, 'orphanedreceipt'));
  assert.equal(execution.admissions[0]?.status, 'ADMITTED');
  oldStore.close();
  const raw = new Database(filename);
  raw.exec('DROP TRIGGER worker_dispatch_claims_no_delete');
  raw.prepare('DELETE FROM worker_dispatch_claims').run();
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0010_worker_authority_closure.sql'),
    join(migrationsDirectory, '0010_worker_authority_closure.sql'),
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
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 10')
      .pluck()
      .get(),
    0,
  );
});

void test('[I-006][I-008][I-010] migration 0010 refuses an Attempt ended before dispatch', (t) => {
  const filename = temporaryDatabase(t, 'attempt-before-dispatch-migration.sqlite');
  const migrationsDirectory = mkdtempSync(join(tmpdir(), 'codeclosure-attempt-dispatch-time-'));
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0010_worker_authority_closure.sql',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const authority = seedAuthority(oldStore, 'attemptbeforedispatchmigration');
  const kernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      oldStore,
      new CountingWorker(),
      authority,
      'attemptbeforedispatchmigration',
      undefined,
      sequenceClock(
        isoTimestamp('2026-07-27T00:00:00.010Z'),
        isoTimestamp('2026-07-27T00:00:00.100Z'),
      ),
    ),
  );
  assert.equal(
    kernel.startGoal(startRequest(authority, 'attemptbeforedispatchmigration')).status,
    'APPLIED',
  );
  const running = oldStore.getWorkflow(authority.workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Attempt dispatch migration fixture must have an active Attempt');
  }
  const request = kernel.takePreparedWorkerRequest(running.activeAttemptId);
  if (request === undefined || kernel.claimWorkerDispatch(request).status !== 'CLAIMED') {
    assert.fail('Attempt dispatch migration fixture must retain a claim');
  }
  oldStore.close();
  const raw = new Database(filename);
  raw
    .prepare(
      `UPDATE attempts
          SET status = 'FAILED', failure_class = 'PROTOCOL_ERROR',
              termination_reason = 'poisoned before dispatch',
              ended_at = '2026-07-27T00:00:00.050Z'
        WHERE id = ?`,
    )
    .run(request.attemptId);
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0010_worker_authority_closure.sql'),
    join(migrationsDirectory, '0010_worker_authority_closure.sql'),
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
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 10')
      .pluck()
      .get(),
    0,
  );
});

void test('[I-005][I-006][I-009] reopen revalidates retained M1 Context source authority', (t) => {
  const filename = temporaryDatabase(t, 'reopen-context-authority.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const authority = seedAuthority(store, 'reopencontextauthority');
  const kernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'reopencontextauthority',
    ),
  );
  assert.equal(
    kernel.startGoal(startRequest(authority, 'reopencontextauthority')).status,
    'APPLIED',
  );
  const running = store.getWorkflow(authority.workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Context reopen fixture must have an active Attempt');
  }
  const attempt = store.getAttempt(running.activeAttemptId);
  if (attempt?.contextManifestId === undefined) {
    assert.fail('Context reopen fixture must have a Context Manifest');
  }
  const manifest = store.getContextManifest(attempt.contextManifestId);
  if (manifest === undefined) {
    assert.fail('Context reopen fixture must read its Context Manifest');
  }
  const forgedEntry = Object.freeze({
    kind: ContextEntryKind.DECISION,
    sourceRef: 'decision_offline-corruption',
    sourceRevision: '1',
    authorityClass: ContextAuthorityClass.HUMAN_DECISION,
    renderedDigest: digests.digest({ offlineContextCorruption: true }),
  });
  const forgedBase = Object.freeze({
    ...manifest,
    entries: Object.freeze([forgedEntry, ...manifest.entries]),
  });
  const forgedManifest = decodeContextManifest({
    ...forgedBase,
    manifestDigest: digests.digest(contextManifestDigestProjection(forgedBase)),
  });
  store.close();
  const raw = new Database(filename);
  raw.exec('DROP TRIGGER context_manifests_no_update');
  raw
    .prepare(
      `UPDATE context_manifests
          SET entries_json = ?, manifest_digest = ?
        WHERE id = ?`,
    )
    .run(JSON.stringify(forgedManifest.entries), forgedManifest.manifestDigest, forgedManifest.id);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => createdAt }),
    /contains authority without an M1 owner/,
  );
});

void test('[I-005][I-006][I-009] reopen recomputes Context from authoritative M1 sources', (t) => {
  const filename = temporaryDatabase(t, 'reopen-context-source-digest.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const authority = seedAuthority(store, 'reopencontextsourcedigest');
  const kernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'reopencontextsourcedigest',
    ),
  );
  assert.equal(
    kernel.startGoal(startRequest(authority, 'reopencontextsourcedigest')).status,
    'APPLIED',
  );
  const running = store.getWorkflow(authority.workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Context source digest fixture must have an active Attempt');
  }
  const attempt = store.getAttempt(running.activeAttemptId);
  if (attempt?.contextManifestId === undefined) {
    assert.fail('Context source digest fixture must have a Context Manifest');
  }
  const manifest = store.getContextManifest(attempt.contextManifestId);
  if (manifest === undefined) {
    assert.fail('Context source digest fixture must read its Context Manifest');
  }
  const forgedEntries = manifest.entries.map((entry) =>
    entry.kind === ContextEntryKind.GOAL
      ? Object.freeze({
          ...entry,
          renderedDigest: digests.digest({ forgedGoalRendering: true }),
        })
      : entry,
  );
  const forgedBase = Object.freeze({ ...manifest, entries: Object.freeze(forgedEntries) });
  const forgedManifest = decodeContextManifest({
    ...forgedBase,
    manifestDigest: digests.digest(contextManifestDigestProjection(forgedBase)),
  });
  store.close();
  const raw = new Database(filename);
  raw.exec('DROP TRIGGER context_manifests_no_update');
  raw
    .prepare(
      `UPDATE context_manifests
          SET entries_json = ?, manifest_digest = ?
        WHERE id = ?`,
    )
    .run(JSON.stringify(forgedManifest.entries), forgedManifest.manifestDigest, forgedManifest.id);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => createdAt }),
    /does not match its authoritative M1 sources/,
  );
});

void test('[I-006][I-008][I-009] reopen revalidates retained Policy audit authority', (t) => {
  const filename = temporaryDatabase(t, 'reopen-policy-authority.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const authority = seedAuthority(store, 'reopenpolicyauthority');
  store.close();
  const raw = new Database(filename);
  raw.exec('DROP TRIGGER audit_events_no_delete');
  raw
    .prepare(
      `DELETE FROM audit_events
        WHERE aggregate_type = 'POLICY' AND aggregate_id = ?`,
    )
    .run(authority.policy.id);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => createdAt }),
    /has no matching installation audit authority/,
  );
});

void test('[I-006][I-008][I-009][I-010] reopen revalidates retained Worker receipt causality', async (t) => {
  const filename = temporaryDatabase(t, 'reopen-worker-causality.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const authority = seedAuthority(store, 'reopenworkercausality');
  const execution = await createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'reopenworkercausality',
    ),
  ).startGoal(startRequest(authority, 'reopenworkercausality'));
  assert.equal(execution.admissions[0]?.status, 'ADMITTED');
  store.close();
  const raw = new Database(filename);
  raw.exec('DROP TRIGGER worker_dispatch_claims_no_delete');
  raw.prepare('DELETE FROM worker_dispatch_claims').run();
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => createdAt }),
    /has no durable dispatch causality/,
  );
});

void test('[I-006][I-008][I-009] reopen rejects an Attempt corrupted before its dispatch time', async (t) => {
  const filename = temporaryDatabase(t, 'reopen-attempt-dispatch-time.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const authority = seedAuthority(store, 'reopenattemptdispatchtime');
  const execution = await createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new CountingWorker(),
      authority,
      'reopenattemptdispatchtime',
      undefined,
      sequenceClock(
        isoTimestamp('2026-07-27T00:00:00.010Z'),
        isoTimestamp('2026-07-27T00:00:00.100Z'),
        isoTimestamp('2026-07-27T00:00:00.020Z'),
      ),
    ),
  ).startGoal(startRequest(authority, 'reopenattemptdispatchtime'));
  if (execution.dispatch?.status !== 'CLAIMED') {
    assert.fail('Attempt reopen fixture must retain a dispatch claim');
  }
  assert.equal(execution.workerFailure?.status, 'APPLIED');
  store.close();
  const raw = new Database(filename);
  raw.exec(`
    DROP TRIGGER attempts_terminal_immutable;
    DROP TRIGGER attempts_causal_end_update_guard;
    DROP TRIGGER attempts_dispatch_causal_update_guard;
  `);
  raw
    .prepare('UPDATE attempts SET ended_at = ? WHERE id = ?')
    .run('2026-07-27T00:00:00.050Z', execution.dispatch.claim.attemptId);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => createdAt }),
    /ended before its retained dispatch claim/,
  );
});
