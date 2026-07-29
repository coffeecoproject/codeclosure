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
  RecoveryReasonCode,
  RecoveryReconciliationDisposition,
  RecoveryReconciliationPurpose,
  candidateGenerationId,
  commandId,
  contextManifestId,
  createGoal,
  createWorkflow,
  decideAttempt,
  decodeContextManifest,
  decodeContextPackage,
  decodeExecutionProfile,
  decodeGoalSnapshot,
  decodePolicyBundle,
  deriveCapabilityGrant,
  executionProfileProjection,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  successCriterionId,
  workerSessionId,
  workflowId,
  workflowVersion,
  type AttemptId,
  type Goal,
  type ExecutionProfile,
  type PolicyBundle,
  type PolicyBundleDefinition,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  MinimalContextCompiler,
  GoalNextSafeAction,
  RecoverableBlockerKind,
  Rfc8785Canonicalizer,
  RuntimeErrorCode,
  WorkerFailureReasonCode,
  WorkerEventNonAdmissionClass,
  WorkerPortFailureReasonCode,
  contextManifestDigestProjection,
  createCodeClosureApplication,
  createExecutionProfileInstaller,
  createPolicyInstaller,
  decodeWorkerEvent,
  decodeWorkerEventReceipt,
  deriveContextManifestEntries,
  type Clock,
  type ResumeGoalRequest,
  type WorkerPort,
  type WorkerRequest,
} from '@codeclosure/runtime';
import { createRecoveryCoordinator } from '@codeclosure/runtime/composition';
import {
  createWorkerExecutionApplication,
  type WorkerExecutionDependencies,
} from '@codeclosure/runtime/testing/worker-execution';
import {
  WorkerTransactionStep,
  RecoveryTransactionStep,
  defaultMigrationsDirectory,
  openSqliteControlStore,
  type SqliteControlStore,
} from '@codeclosure/store-sqlite';
import {
  DeterministicIds,
  FakeRecoveryInspectionMode,
  FakeRecoveryInspector,
  FakeWorker,
  FakeWorkerFixture,
  testExecutionProfileDefinition,
} from '@codeclosure/testing';
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
  readonly profile: ExecutionProfile;
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
  installProfile = true,
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
  const profileDefinition = testExecutionProfileDefinition(namespace);
  const profile = installProfile
    ? (() => {
        const profileInstall = createExecutionProfileInstaller({
          store,
          clock: Object.freeze({ now: () => policyInstalledAt }),
          ids: new DeterministicIds(`profile-${namespace}`),
          digests,
        }).installExecutionProfile(profileDefinition);
        if (profileInstall.status === 'PROFILE_CONFLICT') {
          assert.fail(profileInstall.message);
        }
        return profileInstall.value.profile;
      })()
    : decodeExecutionProfile({
        ...profileDefinition,
        digest: digests.digest(executionProfileProjection(profileDefinition)),
      });
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
  return Object.freeze({ goal, workflow, policy, profile });
}

interface LegacyWorkerAuthority {
  readonly authority: SeededAuthority;
  readonly attemptId: AttemptId;
  readonly contextManifestId: ReturnType<typeof contextManifestId>;
  readonly workerSessionId: ReturnType<typeof workerSessionId>;
  readonly contextManifestDigest: ReturnType<typeof digests.digest>;
  readonly packageDigest: ReturnType<typeof digests.digest>;
  readonly claimedAt?: ReturnType<typeof isoTimestamp>;
}

function seedLegacyWorkerAuthority(
  store: SqliteControlStore,
  filename: string,
  namespace: string,
  includeDispatchClaim = false,
): LegacyWorkerAuthority {
  const authority = seedAuthority(store, namespace, createdAt, false);
  const attemptIdentifier = new DeterministicIds(`legacy-attempt-${namespace}`).nextAttemptId();
  const contextIdentifier = contextManifestId(`context_legacy-${namespace}`);
  const workerIdentifier = workerSessionId(`worker_legacy-${namespace}`);
  const startedAt = isoTimestamp('2026-07-27T00:00:00.010Z');
  const decision = decideAttempt(authority.workflow, undefined, {
    type: 'BEGIN_ATTEMPT',
    commandId: commandId(`command_legacy-start-${namespace}`),
    workflowId: authority.workflow.id,
    expectedWorkflowVersion: authority.workflow.version,
    attemptId: attemptIdentifier,
    sequence: 1,
    occurredAt: startedAt,
  });
  if (!decision.accepted || decision.events[0].type !== 'ATTEMPT_STARTED') {
    assert.fail('Legacy Worker fixture could not start its Attempt');
  }
  const event = decision.events[0];
  const commitIds = new DeterministicIds(`legacy-commit-${namespace}`);
  const committed = store.commitAttemptEvent({
    inputDigest: digests.digest({ schemaVersion: 1, namespace, type: 'LEGACY_START' }),
    target: Object.freeze({ aggregateType: 'GOAL', aggregateId: authority.goal.id }),
    event,
    auditEventId: commitIds.nextAuditEventId(),
    workflowAuditEventId: commitIds.nextAuditEventId(),
    payloadDigest: digests.digest(event),
  });
  assert.equal(committed.status, 'APPLIED');
  const contextManifestDigest = digests.digest({ namespace, type: 'LEGACY_MANIFEST' });
  const packageDigest = digests.digest({ namespace, type: 'LEGACY_PACKAGE' });
  const database = new Database(filename);
  database.pragma('foreign_keys = ON');
  database.exec('BEGIN IMMEDIATE');
  database.exec('DROP TRIGGER attempts_worker_context_update_guard');
  database
    .prepare(
      `UPDATE attempts
          SET context_manifest_id = ?, worker_session_ref = ?
        WHERE id = ?`,
    )
    .run(contextIdentifier, workerIdentifier, attemptIdentifier);
  database
    .prepare(
      `INSERT INTO context_manifests(
         id, schema_version, compiler_version, created_at, goal_id, goal_revision,
         workflow_id, workflow_version, phase, attempt_id, candidate_generation_id,
         candidate_digest, policy_bundle_id, policy_bundle_digest,
         capability_grant_digest, response_contract_digest, entries_json,
         omission_decisions_json, package_digest, manifest_digest
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, 'DISCOVERY', ?, NULL, NULL, ?, ?, ?, ?, ?, '[]', ?, ?)`,
    )
    .run(
      contextIdentifier,
      'legacy-context-compiler-v1',
      startedAt,
      authority.goal.id,
      authority.goal.revision,
      authority.workflow.id,
      workflowVersion(2),
      attemptIdentifier,
      authority.policy.id,
      authority.policy.digest,
      digests.digest({ capabilityGrant: deriveCapabilityGrant('DISCOVERY') }),
      digests.digest({ responseContract: 'legacy-worker-v1' }),
      JSON.stringify([
        {
          kind: ContextEntryKind.GOAL,
          sourceRef: authority.goal.id,
          sourceRevision: String(authority.goal.revision),
          authorityClass: ContextAuthorityClass.GOAL_AUTHORITY,
          renderedDigest: digests.digest(authority.goal.objective),
        },
      ]),
      packageDigest,
      contextManifestDigest,
    );
  let claimedAt: ReturnType<typeof isoTimestamp> | undefined;
  if (includeDispatchClaim) {
    claimedAt = isoTimestamp('2026-07-27T00:00:00.100Z');
    database
      .prepare(
        `INSERT INTO worker_dispatch_claims(
           attempt_id, schema_version, workflow_id, workflow_version, worker_session_id,
           context_manifest_id, context_manifest_digest, package_digest, claimed_at
         ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        attemptIdentifier,
        authority.workflow.id,
        workflowVersion(2),
        workerIdentifier,
        contextIdentifier,
        contextManifestDigest,
        packageDigest,
        claimedAt,
      );
  }
  database.exec(`
    CREATE TRIGGER attempts_worker_context_update_guard
    BEFORE UPDATE OF context_manifest_id, worker_session_ref ON attempts
    WHEN NEW.context_manifest_id IS NOT OLD.context_manifest_id
      OR NEW.worker_session_ref IS NOT OLD.worker_session_ref
    BEGIN
      SELECT RAISE(ABORT, 'Attempt Context and Worker bindings are immutable');
    END;
  `);
  database.exec('COMMIT');
  database.close();
  return Object.freeze({
    authority,
    attemptId: attemptIdentifier,
    contextManifestId: contextIdentifier,
    workerSessionId: workerIdentifier,
    contextManifestDigest,
    packageDigest,
    ...(claimedAt === undefined ? {} : { claimedAt }),
  });
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
      executionProfileId: authority.profile.id,
      executionProfileDigest: authority.profile.digest,
      policyBundleId: authority.policy.id,
      policyBundleDigest: authority.policy.digest,
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
  assert.equal(
    reopened.getExecutionProfile(authority.profile.id)?.profile.digest,
    authority.profile.digest,
  );
  assert.equal(
    reopened.getWorkflowPolicyBinding(authority.workflow.id)?.policyBundleDigest,
    authority.policy.digest,
  );
  assert.equal(
    reopened.getExecutionProfileBinding(authority.workflow.id)?.profileDigest,
    authority.profile.digest,
  );
  const policyAudits = reopened.listAuditEvents('POLICY', authority.policy.id);
  assert.equal(policyAudits.length, 1);
  const policyAudit = policyAudits[0];
  if (policyAudit === undefined) {
    assert.fail('Installed Policy must have one audit record');
  }
  assert.equal(policyAudit.eventType, 'POLICY_BUNDLE_INSTALLED');
  assert.equal(policyAudit.payloadDigest, authority.policy.digest);
  const profileAudits = reopened.listAuditEvents('EXECUTION_PROFILE', authority.profile.id);
  assert.equal(profileAudits.length, 1);
  const profileAudit = profileAudits[0];
  assert.ok(profileAudit);
  assert.equal(profileAudit.eventType, 'EXECUTION_PROFILE_INSTALLED');
  assert.equal(profileAudit.payloadDigest, authority.profile.digest);
  const policyBindingAudits = reopened.listAuditEvents(
    'WORKFLOW_POLICY_BINDING',
    authority.workflow.id,
  );
  assert.equal(policyBindingAudits.length, 1);
  assert.equal(policyBindingAudits[0]?.eventType, 'WORKFLOW_POLICY_BOUND');
  const bindingAudits = reopened.listAuditEvents(
    'EXECUTION_PROFILE_BINDING',
    authority.workflow.id,
  );
  assert.equal(bindingAudits.length, 1);
  assert.equal(bindingAudits[0]?.eventType, 'EXECUTION_PROFILE_BOUND');
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

void test('[I-006][I-008][I-019] a started Workflow cannot replay or continue with another Execution Profile', (t) => {
  const filename = temporaryDatabase(t, 'execution-profile-rebinding.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'profile-rebinding');
  const originalKernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'profile-rebinding-original',
    ),
  );
  const request = startRequest(authority, 'profile-rebinding');
  assert.equal(originalKernel.startGoal(request).status, 'APPLIED');
  const originalBinding = store.getExecutionProfileBinding(authority.workflow.id);
  assert.ok(originalBinding);

  const replacementInstall = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids: new DeterministicIds('profile-rebinding-replacement-install'),
    digests,
  }).installExecutionProfile(testExecutionProfileDefinition('profile-rebinding-replacement'));
  if (replacementInstall.status === 'PROFILE_CONFLICT') {
    assert.fail(replacementInstall.message);
  }
  const replacementAuthority: SeededAuthority = Object.freeze({
    ...authority,
    profile: replacementInstall.value.profile,
  });
  const replacementKernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      replacementAuthority,
      'profile-rebinding-replacement',
    ),
  );

  assert.equal(replacementKernel.startGoal(request).status, 'REJECTED');
  assert.deepEqual(store.getExecutionProfileBinding(authority.workflow.id), originalBinding);

  const running = store.getWorkflow(authority.workflow.id);
  assert.ok(running?.activeAttemptId);
  assert.equal(
    originalKernel.recordAttemptResult({
      commandId: commandId('command_profile-rebinding-result'),
      workflowId: running.id,
      expectedWorkflowVersion: running.version,
      attemptId: running.activeAttemptId,
      reason: 'finish the original profile attempt',
    }).status,
    'APPLIED',
  );
  const ready = store.getWorkflow(authority.workflow.id);
  assert.ok(ready);
  const attemptCount = rowCount(filename, 'attempts');
  assert.equal(
    replacementKernel.beginAttempt({
      commandId: commandId('command_profile-rebinding-retry'),
      workflowId: ready.id,
      expectedWorkflowVersion: ready.version,
    }).status,
    'REJECTED',
  );
  assert.deepEqual(store.getWorkflow(authority.workflow.id), ready);
  assert.equal(rowCount(filename, 'attempts'), attemptCount);
  assert.deepEqual(store.getExecutionProfileBinding(authority.workflow.id), originalBinding);
});

void test('[I-006][I-008][I-019][I-031] Policy substitution cannot replay, claim, or admit Worker authority', async (t) => {
  const filename = temporaryDatabase(t, 'workflow-policy-substitution.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'workflow-policy-substitution');
  const originalWorker = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  const originalKernel = new WorkflowRuntimeKernel(
    runtimeDependencies(store, originalWorker, authority, 'workflow-policy-substitution-original'),
  );
  const request = startRequest(authority, 'workflow-policy-substitution');
  assert.equal(originalKernel.startGoal(request).status, 'APPLIED');
  const workerRequest = originalKernel.takePreparedWorkerRequest(
    store.getWorkflow(authority.workflow.id)?.activeAttemptId ??
      assert.fail('Policy substitution fixture has no active Attempt'),
  );
  if (workerRequest === undefined) {
    assert.fail('Policy substitution fixture has no prepared Worker Request');
  }
  const originalBinding = store.getWorkflowPolicyBinding(authority.workflow.id);
  assert.ok(originalBinding);

  const policyBDefinition = Object.freeze({
    ...policyBundleDefinition(),
    id: policyBundleId('policy_m1-worker-b'),
    version: 'm1-worker-b-v1',
    transitionRules: Object.freeze(['workflow-runtime-only', 'policy-b-marker']),
  });
  const policyBInstall = createPolicyInstaller({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids: new DeterministicIds('workflow-policy-substitution-b-install'),
    digests,
  }).installPolicyBundle(policyBDefinition);
  if (policyBInstall.status === 'POLICY_CONFLICT') {
    assert.fail(policyBInstall.message);
  }
  const policyBAuthority: SeededAuthority = Object.freeze({
    ...authority,
    policy: policyBInstall.value.bundle,
  });
  const policyBKernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      policyBAuthority,
      'workflow-policy-substitution-b',
    ),
  );

  const replayUnderPolicyB = policyBKernel.startGoal(request);
  assert.equal(replayUnderPolicyB.status, 'REJECTED');
  assert.equal(replayUnderPolicyB.output.error.code, RuntimeErrorCode.COMMAND_ID_CONFLICT);
  assert.deepEqual(store.getWorkflowPolicyBinding(authority.workflow.id), originalBinding);

  const claimUnderPolicyB = policyBKernel.claimWorkerDispatch(workerRequest);
  assert.equal(claimUnderPolicyB.status, 'FAILED');
  assert.equal(claimUnderPolicyB.reasonCode, 'WORKER_DISPATCH_INTERNAL_FAILURE');
  assert.equal(store.getWorkerDispatchClaim(workerRequest.attemptId), undefined);

  const originalClaim = originalKernel.claimWorkerDispatch(workerRequest);
  assert.equal(originalClaim.status, 'CLAIMED');
  const emitted: unknown[] = [];
  for await (const event of originalWorker.run(workerRequest, new AbortController().signal)) {
    emitted.push(event);
  }
  const event = decodeWorkerEvent(emitted[0]);
  const beforeAdmission = store.getWorkflow(authority.workflow.id);
  assert.ok(beforeAdmission);

  const admissionUnderPolicyB = policyBKernel.admitWorkerEvent(event, workerRequest);
  assert.equal(admissionUnderPolicyB.status, 'REJECTED');
  assert.equal(admissionUnderPolicyB.reasonCode, 'WORKER_EVENT_INTERNAL_FAILURE');
  assert.deepEqual(store.getWorkflow(authority.workflow.id), beforeAdmission);
  assert.equal(store.getWorkerEventReceipt(event.id), undefined);

  const originalAdmission = originalKernel.admitWorkerEvent(event, workerRequest);
  assert.equal(originalAdmission.status, 'ADMITTED');
  assert.equal(store.getWorkerEventReceipt(event.id)?.disposition, 'ADMITTED');
  assert.deepEqual(store.getWorkflowPolicyBinding(authority.workflow.id), originalBinding);
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
      new FakeWorker({ fixture: FakeWorkerFixture.SENSITIVE_ABRUPT_TERMINATION }),
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
  assert.equal(attempt.terminationReason, WorkerPortFailureReasonCode.INVOCATION_FAILED);
  assert.equal(attempt.endedAt, execution.dispatch.claim.claimedAt);
  assert.equal(workflow.updatedAt, execution.dispatch.claim.claimedAt);
  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  const persistedAuthority = JSON.stringify(
    inspected
      .prepare(
        `SELECT termination_reason AS value FROM attempts
         UNION ALL SELECT outcome_json FROM processed_commands`,
      )
      .all(),
  );
  inspected.close();
  assert.equal(persistedAuthority.includes('token=demo-sensitive-value'), false);
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

void test('[I-006][I-008] Policy/Profile bindings, Context, and Attempt start roll back together', async (t) => {
  for (const failureStep of [
    WorkerTransactionStep.AFTER_WORKFLOW_POLICY_BINDING_AUDIT_WRITE,
    WorkerTransactionStep.AFTER_WORKFLOW_POLICY_BINDING_WRITE,
    WorkerTransactionStep.AFTER_EXECUTION_PROFILE_BINDING_AUDIT_WRITE,
    WorkerTransactionStep.AFTER_EXECUTION_PROFILE_BINDING_WRITE,
    WorkerTransactionStep.AFTER_CONTEXT_MANIFEST_WRITE,
  ]) {
    await t.test(failureStep, (caseTest) => {
      const failureNamespace = failureStep.toLowerCase().replaceAll('_', '-');
      const filename = temporaryDatabase(caseTest, `${failureNamespace}.sqlite`);
      const store = openSqliteControlStore({
        filename,
        now: () => createdAt,
        transactionProbe: (step) => {
          if (step === failureStep) {
            throw new Error(`injected ${failureStep}`);
          }
        },
      });
      const authority = seedAuthority(store, `binding-${failureNamespace}`);
      const kernel = new WorkflowRuntimeKernel(
        runtimeDependencies(
          store,
          new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
          authority,
          `binding-${failureNamespace}`,
        ),
      );

      const result = kernel.startGoal(startRequest(authority, `binding-${failureNamespace}`));

      assert.equal(result.status, 'REJECTED');
      store.close();
      const reopened = openSqliteControlStore({ filename, now: () => createdAt });
      caseTest.after(() => reopened.close());
      assert.equal(reopened.getWorkflow(authority.workflow.id)?.version, workflowVersion(1));
      assert.equal(reopened.getWorkflowPolicyBinding(authority.workflow.id), undefined);
      assert.equal(reopened.getExecutionProfileBinding(authority.workflow.id), undefined);
      assert.equal(rowCount(filename, 'attempts'), 0);
      assert.equal(rowCount(filename, 'context_manifests'), 0);
      assert.equal(rowCount(filename, 'processed_commands'), 1);
      assert.equal(rowCount(filename, 'audit_events'), 4);
    });
  }
});

void test('[I-006][I-008] Execution Profile installation is exact, idempotent, and audited once', (t) => {
  const filename = temporaryDatabase(t, 'execution-profile-install.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const definition = testExecutionProfileDefinition('exact-install');
  const first = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids: new DeterministicIds('profile-first-install'),
    digests,
  }).installExecutionProfile(definition);
  assert.equal(first.status, 'INSTALLED');

  const replayed = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => isoTimestamp('2026-07-27T00:00:00.100Z') }),
    ids: new DeterministicIds('profile-replayed-install'),
    digests,
  }).installExecutionProfile(definition);
  assert.equal(replayed.status, 'EXISTING');
  assert.deepEqual(replayed.value, first.value);

  const conflict = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => isoTimestamp('2026-07-27T00:00:00.200Z') }),
    ids: new DeterministicIds('profile-conflicting-install'),
    digests,
  }).installExecutionProfile({
    ...definition,
    workerAdapterVersion: 'different-worker-v2',
  });
  assert.equal(conflict.status, 'PROFILE_CONFLICT');
  assert.equal(
    store
      .listAuditEvents('EXECUTION_PROFILE', definition.id)
      .filter((event) => event.eventType === 'EXECUTION_PROFILE_INSTALLED').length,
    1,
  );
});

void test('[I-006][I-008] Execution Profile installation and audit roll back together', async (t) => {
  for (const failureStep of [
    WorkerTransactionStep.AFTER_EXECUTION_PROFILE_AUDIT_WRITE,
    WorkerTransactionStep.AFTER_EXECUTION_PROFILE_WRITE,
  ]) {
    await t.test(failureStep, (caseTest) => {
      const failureNamespace = failureStep.toLowerCase().replaceAll('_', '-');
      const filename = temporaryDatabase(caseTest, `${failureNamespace}.sqlite`);
      const store = openSqliteControlStore({
        filename,
        now: () => createdAt,
        transactionProbe: (step) => {
          if (step === failureStep) {
            throw new Error(`injected ${failureStep}`);
          }
        },
      });
      caseTest.after(() => store.close());
      const definition = testExecutionProfileDefinition(`rollback-${failureNamespace}`);
      assert.throws(
        () =>
          createExecutionProfileInstaller({
            store,
            clock: Object.freeze({ now: () => createdAt }),
            ids: new DeterministicIds(`profile-${failureNamespace}`),
            digests,
          }).installExecutionProfile(definition),
        new RegExp(`injected ${failureStep}`),
      );
      assert.equal(store.getExecutionProfile(definition.id), undefined);
      assert.equal(store.listAuditEvents('EXECUTION_PROFILE', definition.id).length, 0);
    });
  }
});

void test('[I-005][I-006] Execution Profile installer strictly decodes Store results', async (t) => {
  for (const fixture of [
    {
      name: 'extra-result-field',
      value: { status: 'PROFILE_CONFLICT', message: 'conflict', unexpected: true },
    },
    {
      name: 'extra-installed-field',
      value: {
        status: 'INSTALLED',
        value: { profile: {}, installedAt: createdAt, unexpected: true },
      },
    },
  ]) {
    await t.test(fixture.name, () => {
      const installer = createExecutionProfileInstaller({
        store: Object.freeze({ installExecutionProfile: () => fixture.value as never }),
        clock: Object.freeze({ now: () => createdAt }),
        ids: new DeterministicIds(`strict-${fixture.name}`),
        digests,
      });
      assert.throws(
        () => installer.installExecutionProfile(testExecutionProfileDefinition('strict-result')),
        /unrecognized|Unrecognized|invalid/i,
      );
    });
  }
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
    kernel.recordWorkerPortFailure(request, WorkerPortFailureReasonCode.NO_TERMINAL_EVENT),
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
          'UPDATE workflow_policy_bindings SET policy_bundle_digest = ? WHERE workflow_id = ?',
        )
        .run(digests.digest({ forged: 'policy' }), workflow.id),
    /Workflow Policy bindings are immutable/,
  );
  assert.throws(
    () =>
      database
        .prepare('DELETE FROM workflow_policy_bindings WHERE workflow_id = ?')
        .run(workflow.id),
    /Workflow Policy bindings cannot be deleted/,
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
  const forgedClassificationCommandId = commandId('command_forged-worker-classification');
  const forgedClassificationDecision = decideAttempt(workflow, currentAttempt, {
    type: 'RECORD_ATTEMPT_FAILURE',
    commandId: forgedClassificationCommandId,
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    attemptId: currentAttempt.id,
    failureClass: AttemptFailureClass.PERMANENT_BACKEND,
    occurredAt: isoTimestamp('2026-07-27T00:00:00.100Z'),
    reason: WorkerFailureReasonCode.BACKEND_FAILURE,
  });
  if (!forgedClassificationDecision.accepted) {
    assert.fail(forgedClassificationDecision.rejection.message);
  }
  const forgedClassificationEvent = forgedClassificationDecision.events[0];
  const forgedClassificationIds = new DeterministicIds('forged-worker-classification');
  assert.throws(
    () =>
      store.commitAttemptEvent({
        inputDigest: digests.digest({ schemaVersion: 1, forgedClassificationCommandId }),
        target: Object.freeze({ aggregateType: 'WORKFLOW', aggregateId: workflow.id }),
        event: forgedClassificationEvent,
        auditEventId: forgedClassificationIds.nextAuditEventId(),
        workflowAuditEventId: forgedClassificationIds.nextAuditEventId(),
        payloadDigest: digests.digest(forgedClassificationEvent),
      }),
    /requires failure class TRANSIENT_BACKEND/,
  );
  assert.throws(
    () =>
      database
        .prepare(
          `UPDATE attempts
              SET status = 'FAILED', failure_class = 'PROTOCOL_ERROR',
                  termination_reason = 'WORKER_BACKEND_FAILURE',
                  ended_at = '2026-07-27T00:00:00.100Z'
            WHERE id = ?`,
        )
        .run(request.attemptId),
    /Worker failure reason requires its runtime-owned failure class/,
  );
  assert.equal(store.getAttempt(request.attemptId)?.status, AttemptStatus.RUNNING);
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
  const authority = seedAuthority(oldStore, 'poisonedworkerbinding', createdAt, false);
  const attemptIdentifier = new DeterministicIds('poisoned-worker-binding-attempt').nextAttemptId();
  const startedAt = isoTimestamp('2026-07-27T00:00:00.010Z');
  const decision = decideAttempt(authority.workflow, undefined, {
    type: 'BEGIN_ATTEMPT',
    commandId: commandId('command_poisoned-worker-binding-start'),
    workflowId: authority.workflow.id,
    expectedWorkflowVersion: authority.workflow.version,
    attemptId: attemptIdentifier,
    sequence: 1,
    occurredAt: startedAt,
  });
  if (!decision.accepted || decision.events[0].type !== 'ATTEMPT_STARTED') {
    assert.fail('Pre-migration fixture could not construct its legacy Attempt');
  }
  const event = decision.events[0];
  const commitIds = new DeterministicIds('poisoned-worker-binding-commit');
  const committed = oldStore.commitAttemptEvent({
    inputDigest: digests.digest({
      schemaVersion: 1,
      type: 'LEGACY_START',
      namespace: 'poisonedworkerbinding',
    }),
    target: Object.freeze({ aggregateType: 'GOAL', aggregateId: authority.goal.id }),
    event,
    auditEventId: commitIds.nextAuditEventId(),
    workflowAuditEventId: commitIds.nextAuditEventId(),
    payloadDigest: digests.digest(event),
  });
  assert.equal(committed.status, 'APPLIED');
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
  seedLegacyWorkerAuthority(oldStore, filename, 'unresolvedcontext');
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
  seedLegacyWorkerAuthority(oldStore, filename, 'candidatecontextmigration');
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

void test('[I-006][I-008][I-010] migration 0010 refuses a retained receipt without dispatch causality', (t) => {
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
  const legacy = seedLegacyWorkerAuthority(oldStore, filename, 'orphanedreceipt');
  const raw = new Database(filename);
  raw.pragma('foreign_keys = ON');
  raw
    .prepare(
      `INSERT INTO worker_event_receipts(
         event_id, schema_version, payload_digest, worker_session_id, workflow_id,
         observed_workflow_version, attempt_id, context_manifest_id,
         context_manifest_digest, package_digest, disposition, internal_command_id,
         reason_code, received_at
       ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'IGNORED', NULL, ?, ?)`,
    )
    .run(
      'worker-event_legacy-orphanedreceipt',
      digests.digest({ type: 'LEGACY_ORPHANED_RECEIPT' }),
      legacy.workerSessionId,
      legacy.authority.workflow.id,
      workflowVersion(2),
      legacy.attemptId,
      legacy.contextManifestId,
      legacy.contextManifestDigest,
      legacy.packageDigest,
      'LEGACY_MISSING_DISPATCH',
      isoTimestamp('2026-07-27T00:00:00.200Z'),
    );
  raw.close();
  oldStore.close();
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
  const legacy = seedLegacyWorkerAuthority(
    oldStore,
    filename,
    'attemptbeforedispatchmigration',
    true,
  );
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
    .run(legacy.attemptId);
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

void test('[I-006][I-008] migration 0012 refuses a retained Worker failure classification conflict atomically', (t) => {
  const filename = temporaryDatabase(t, 'worker-failure-classification-migration.sqlite');
  const migrationsDirectory = mkdtempSync(
    join(tmpdir(), 'codeclosure-worker-classification-closure-'),
  );
  t.after(() => rmSync(migrationsDirectory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) =>
      candidate.endsWith('.sql') && candidate < '0012_worker_failure_classification_closure.sql',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const legacy = seedLegacyWorkerAuthority(
    oldStore,
    filename,
    'workerclassificationmigration',
    true,
  );
  oldStore.close();

  const raw = new Database(filename);
  raw
    .prepare(
      `UPDATE attempts
          SET status = 'FAILED', failure_class = 'PROTOCOL_ERROR',
              termination_reason = 'WORKER_BACKEND_FAILURE',
              ended_at = '2026-07-27T00:00:00.100Z'
        WHERE id = ?`,
    )
    .run(legacy.attemptId);
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0012_worker_failure_classification_closure.sql'),
    join(migrationsDirectory, '0012_worker_failure_classification_closure.sql'),
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
      .prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = 12')
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'trigger' AND name = 'attempts_worker_failure_classification_update_guard'",
      )
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

void test('[I-006][I-008][I-009][I-031] reopen rejects a forged Workflow Policy binding', (t) => {
  const filename = temporaryDatabase(t, 'reopen-workflow-policy-binding.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const authority = seedAuthority(store, 'reopenworkflowpolicybinding');
  const kernel = new WorkflowRuntimeKernel(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      authority,
      'reopenworkflowpolicybinding',
    ),
  );
  assert.equal(
    kernel.startGoal(startRequest(authority, 'reopenworkflowpolicybinding')).status,
    'APPLIED',
  );
  store.close();

  const raw = new Database(filename);
  raw.exec('DROP TRIGGER workflow_policy_bindings_no_update');
  raw
    .prepare(
      `UPDATE workflow_policy_bindings
          SET binding_digest = ?
        WHERE workflow_id = ?`,
    )
    .run(digests.digest({ forgedWorkflowPolicyBinding: true }), authority.workflow.id);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => createdAt }),
    /incomplete Policy binding authority/,
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

void test('[I-006][I-008][I-009] startup recovery blocks the old dispatch and ResumeGoal only grants a fresh boundary', async (t) => {
  const filename = temporaryDatabase(t, 'startup-recovery-resume.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'startuprecovery');
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.DELAYED_RESULT });
  const workerExecution = createWorkerExecutionApplication(
    runtimeDependencies(store, worker, authority, 'startuprecovery'),
  );
  const pendingExecution = workerExecution.startGoal(startRequest(authority, 'startuprecovery'));
  await worker.waitUntilStarted();
  const running = store.getWorkflow(authority.workflow.id);
  assert.ok(running);
  assert.equal(running.runStatus, RunStatus.RUNNING);
  const originalAttemptId = running.activeAttemptId;
  assert.ok(originalAttemptId);
  const originalClaim = store.getWorkerDispatchClaim(originalAttemptId);
  assert.ok(originalClaim);

  const inspector = new FakeRecoveryInspector([
    FakeRecoveryInspectionMode.EXACT,
    FakeRecoveryInspectionMode.EXACT,
  ]);
  const recoveryIds = new DeterministicIds('startup-recovery-control');
  const recovery = createRecoveryCoordinator({
    store,
    clock: sequenceClock(
      isoTimestamp('2026-07-27T00:00:00.200Z'),
      isoTimestamp('2026-07-27T00:00:00.300Z'),
    ),
    ids: recoveryIds,
    digests,
    policyBundleId: authority.policy.id,
    policyBundleDigest: authority.policy.digest,
    inspector,
    inspectorVersion: 'fake-recovery-inspector-v1',
    recoveryPolicyVersion: 'm1-exact-same-phase-v1',
  });

  const startup = recovery.recoverOnStartup();
  assert.equal(startup.scannedCount, 1);
  assert.equal(startup.reconciledCount, 1);
  assert.equal(inspector.requests().length, 1);
  const startupRecoveryId = startup.recoveryIds[0];
  assert.ok(startupRecoveryId);
  const startupRecord = store.getRecoveryReconciliation(startupRecoveryId);
  assert.ok(startupRecord);
  assert.equal(startupRecord.purpose, RecoveryReconciliationPurpose.STARTUP);
  assert.equal(startupRecord.disposition, RecoveryReconciliationDisposition.SAFE_SAME_PHASE);
  assert.equal(startupRecord.reasonCode, RecoveryReasonCode.EXACT_AUTHORITY_MATCH);
  assert.equal(store.getAttempt(originalAttemptId)?.status, AttemptStatus.INTERRUPTED);
  const blocked = store.getWorkflow(authority.workflow.id);
  assert.ok(blocked);
  assert.equal(blocked.runStatus, RunStatus.BLOCKED);
  assert.equal(blocked.activeAttemptId, undefined);
  assert.equal(recovery.recoverOnStartup().scannedCount, 0);
  assert.equal(inspector.requests().length, 1);

  const publicIds = new DeterministicIds('startup-recovery-public');
  const publicApplication = createCodeClosureApplication({
    store,
    clock: sequenceClock(isoTimestamp('2026-07-27T00:00:00.400Z')),
    creationIds: publicIds,
    digests,
    projectPaths: Object.freeze({
      parseNormalizedAbsolute: (projectPath: string) => projectPath,
    }),
    execution: Object.freeze({
      startGoal: () =>
        Promise.reject(new Error('StartGoal is not exercised by this recovery boundary fixture')),
      resumeGoal: (input: ResumeGoalRequest) =>
        Promise.resolve(Object.freeze({ command: recovery.resumeGoal(input) })),
      cancelGoal: () => {
        throw new Error('CancelGoal is not exercised by this recovery boundary fixture');
      },
    }),
  });
  const blockedStatus = publicApplication.getGoalStatus(authority.goal.id);
  assert.equal(blockedStatus.status, 'FOUND');
  assert.equal(blockedStatus.view.nextSafeAction, GoalNextSafeAction.RESUME_GOAL);

  worker.release();
  await pendingExecution;
  const resumeCommand = commandId('command_resume-startup-recovery');
  const resumed = await publicApplication.resumeGoal({
    commandId: resumeCommand,
    goalId: authority.goal.id,
    expectedGoalRevision: authority.goal.revision,
    expectedWorkflowVersion: blocked.version,
  });
  assert.equal(resumed.command.status, 'APPLIED');
  const ready = store.getWorkflow(authority.workflow.id);
  assert.ok(ready);
  assert.equal(ready.runStatus, RunStatus.READY);
  assert.equal(ready.activeAttemptId, undefined);
  assert.equal(store.nextAttemptSequence(authority.workflow.id), 2);
  assert.equal(rowCount(filename, 'attempts'), 1);
  assert.equal(rowCount(filename, 'recovery_reconciliations'), 2);
  assert.deepEqual(store.getWorkerDispatchClaim(originalAttemptId), originalClaim);
  assert.equal(inspector.requests().length, 2);
  assert.equal(
    (
      await publicApplication.resumeGoal({
        commandId: resumeCommand,
        goalId: authority.goal.id,
        expectedGoalRevision: authority.goal.revision,
        expectedWorkflowVersion: blocked.version,
      })
    ).command.status,
    'REPLAYED',
  );
  assert.equal(inspector.requests().length, 2);

  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.READY);
  assert.equal(reopened.getRecoveryReconciliation(startupRecoveryId)?.id, startupRecord.id);
});

void test('[I-006][I-009] startup recovery refuses a malformed Store outcome after the atomic reconciliation', async (t) => {
  const filename = temporaryDatabase(t, 'startup-recovery-malformed-outcome.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'startuprecoverymalformed');
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.DELAYED_RESULT });
  const pendingExecution = createWorkerExecutionApplication(
    runtimeDependencies(store, worker, authority, 'startuprecoverymalformed'),
  ).startGoal(startRequest(authority, 'startuprecoverymalformed'));
  await worker.waitUntilStarted();

  const malformedStore = new Proxy(store, {
    get(target, property) {
      if (property === 'commitStartupRecovery') {
        return (input: Parameters<SqliteControlStore['commitStartupRecovery']>[0]) => {
          const result = target.commitStartupRecovery(input);
          assert.equal(result.status, 'APPLIED');
          return Object.freeze({ ...result, outcome: null });
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (...args: readonly unknown[]): unknown => Reflect.apply(value, target, args) as unknown
        : value;
    },
  });
  const recovery = createRecoveryCoordinator({
    store: malformedStore,
    clock: sequenceClock(isoTimestamp('2026-07-27T00:00:00.250Z')),
    ids: new DeterministicIds('startup-recovery-malformed-outcome-control'),
    digests,
    policyBundleId: authority.policy.id,
    policyBundleDigest: authority.policy.digest,
    inspector: new FakeRecoveryInspector([FakeRecoveryInspectionMode.EXACT]),
    inspectorVersion: 'fake-recovery-inspector-v1',
    recoveryPolicyVersion: 'm1-exact-same-phase-v1',
  });

  assert.throws(
    () => recovery.recoverOnStartup(),
    /Startup recovery returned an invalid stored command outcome/,
  );
  assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.BLOCKED);
  assert.equal(rowCount(filename, 'recovery_reconciliations'), 1);

  worker.release();
  await pendingExecution;
});

void test('[I-006][I-008][I-009] recoverable closed failure is freshly inspected and mismatch remains BLOCKED', async (t) => {
  const filename = temporaryDatabase(t, 'closed-failure-recovery.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const authority = seedAuthority(store, 'closedfailurerecovery');
  const execution = await createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.ABRUPT_TERMINATION }),
      authority,
      'closedfailurerecovery',
    ),
  ).startGoal(startRequest(authority, 'closedfailurerecovery'));
  assert.equal(execution.workerFailure?.status, 'APPLIED');
  const blocked = store.getWorkflow(authority.workflow.id);
  assert.ok(blocked);
  assert.equal(blocked.runStatus, RunStatus.BLOCKED);
  assert.equal(
    store.getRecoveryCatalogForGoal(authority.goal.id)?.blockerKind,
    RecoverableBlockerKind.RECOVERABLE_FAILURE,
  );

  const inspector = new FakeRecoveryInspector([FakeRecoveryInspectionMode.PROJECT_MISMATCH]);
  const ids = new DeterministicIds('closed-failure-recovery-control');
  const recovery = createRecoveryCoordinator({
    store,
    clock: sequenceClock(
      isoTimestamp('2026-07-27T00:00:00.250Z'),
      isoTimestamp('2026-07-27T00:00:00.300Z'),
    ),
    ids,
    digests,
    policyBundleId: authority.policy.id,
    policyBundleDigest: authority.policy.digest,
    inspector,
    inspectorVersion: 'fake-recovery-inspector-v1',
    recoveryPolicyVersion: 'm1-exact-same-phase-v1',
  });
  const persistenceInspector = new FakeRecoveryInspector([FakeRecoveryInspectionMode.EXACT]);
  const failingCatalogStore = new Proxy(store, {
    get(target, property) {
      if (property === 'getRecoveryCatalogForGoal') {
        return () => {
          throw new Error('injected recovery catalog read failure');
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function'
        ? (...args: readonly unknown[]): unknown => Reflect.apply(value, target, args) as unknown
        : value;
    },
  });
  const persistenceFailure = createRecoveryCoordinator({
    store: failingCatalogStore,
    clock: sequenceClock(isoTimestamp('2026-07-27T00:00:00.200Z')),
    ids: new DeterministicIds('closed-failure-persistence-control'),
    digests,
    policyBundleId: authority.policy.id,
    policyBundleDigest: authority.policy.digest,
    inspector: persistenceInspector,
    inspectorVersion: 'fake-recovery-inspector-v1',
    recoveryPolicyVersion: 'm1-exact-same-phase-v1',
  }).resumeGoal({
    commandId: commandId('command_resume-closed-failure-persistence'),
    goalId: authority.goal.id,
    expectedGoalRevision: authority.goal.revision,
    expectedWorkflowVersion: blocked.version,
  });
  assert.equal(persistenceFailure.status, 'REJECTED');
  assert.equal(persistenceFailure.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  assert.equal(
    persistenceFailure.output.error.detailCode,
    'RESUME_GOAL_RECOVERY_CATALOG_READ_FAILURE',
  );
  assert.equal(persistenceInspector.requests().length, 0);

  const stale = recovery.resumeGoal({
    commandId: commandId('command_resume-closed-failure-stale'),
    goalId: authority.goal.id,
    expectedGoalRevision: authority.goal.revision,
    expectedWorkflowVersion: workflowVersion(blocked.version - 1),
  });
  assert.equal(stale.status, 'REJECTED');
  assert.equal(stale.output.error.code, RuntimeErrorCode.STALE_WORKFLOW_VERSION);
  assert.equal(inspector.requests().length, 0);
  const request = Object.freeze({
    commandId: commandId('command_resume-closed-failure'),
    goalId: authority.goal.id,
    expectedGoalRevision: authority.goal.revision,
    expectedWorkflowVersion: blocked.version,
  });
  const result = recovery.resumeGoal(request);
  assert.equal(result.status, 'APPLIED');
  const stillBlocked = store.getWorkflow(authority.workflow.id);
  assert.ok(stillBlocked);
  assert.equal(stillBlocked.runStatus, RunStatus.BLOCKED);
  assert.equal(stillBlocked.version, blocked.version + 1);
  const record = store.getLatestRecoveryReconciliation(authority.workflow.id);
  assert.ok(record);
  assert.equal(record.purpose, RecoveryReconciliationPurpose.RESUME);
  assert.equal(record.disposition, RecoveryReconciliationDisposition.BLOCKED);
  assert.equal(record.reasonCode, RecoveryReasonCode.PROJECT_IDENTITY_MISMATCH);
  assert.equal(inspector.requests().length, 1);
  assert.equal(recovery.resumeGoal(request).status, 'REPLAYED');
  assert.equal(inspector.requests().length, 1);

  const failingInspector = new FakeRecoveryInspector([FakeRecoveryInspectionMode.THROW]);
  const failedInspectionRecovery = createRecoveryCoordinator({
    store,
    clock: sequenceClock(isoTimestamp('2026-07-27T00:00:00.350Z')),
    ids: new DeterministicIds('closed-failure-inspector-error'),
    digests,
    policyBundleId: authority.policy.id,
    policyBundleDigest: authority.policy.digest,
    inspector: failingInspector,
    inspectorVersion: 'fake-recovery-inspector-v1',
    recoveryPolicyVersion: 'm1-exact-same-phase-v1',
  });
  assert.equal(
    failedInspectionRecovery.resumeGoal({
      commandId: commandId('command_resume-inspector-error'),
      goalId: authority.goal.id,
      expectedGoalRevision: authority.goal.revision,
      expectedWorkflowVersion: stillBlocked.version,
    }).status,
    'APPLIED',
  );
  assert.equal(
    store.getLatestRecoveryReconciliation(authority.workflow.id)?.reasonCode,
    RecoveryReasonCode.INSPECTOR_FAILURE,
  );
  assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.BLOCKED);

  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.BLOCKED);
  assert.equal(
    reopened.getLatestRecoveryReconciliation(authority.workflow.id)?.reasonCode,
    RecoveryReasonCode.INSPECTOR_FAILURE,
  );
});

void test('[I-006][I-009] every recovery write boundary rolls back record, state, and audits together', async (t) => {
  for (const [index, failureStep] of Object.values(RecoveryTransactionStep).entries()) {
    await t.test(failureStep, async (child) => {
      const filename = temporaryDatabase(child, `recovery-rollback-${String(index)}.sqlite`);
      let injectFailure = false;
      const store = openSqliteControlStore({
        filename,
        now: () => createdAt,
        transactionProbe: (step) => {
          if (injectFailure && step === failureStep) {
            throw new Error(`injected recovery rollback at ${failureStep}`);
          }
        },
      });
      child.after(() => store.close());
      const namespace = `recoveryrollback${String(index)}`;
      const authority = seedAuthority(store, namespace);
      const worker = new FakeWorker({ fixture: FakeWorkerFixture.DELAYED_RESULT });
      const pendingExecution = createWorkerExecutionApplication(
        runtimeDependencies(store, worker, authority, namespace),
      ).startGoal(startRequest(authority, namespace));
      await worker.waitUntilStarted();
      const running = store.getWorkflow(authority.workflow.id);
      if (running?.activeAttemptId === undefined) {
        assert.fail('Recovery rollback fixture requires one RUNNING Attempt');
      }
      const coordinator = createRecoveryCoordinator({
        store,
        clock: sequenceClock(isoTimestamp('2026-07-27T00:00:00.300Z')),
        ids: new DeterministicIds(`recovery-rollback-${String(index)}`),
        digests,
        policyBundleId: authority.policy.id,
        policyBundleDigest: authority.policy.digest,
        inspector: new FakeRecoveryInspector([FakeRecoveryInspectionMode.EXACT]),
        inspectorVersion: 'fake-recovery-inspector-v1',
        recoveryPolicyVersion: 'm1-exact-same-phase-v1',
      });
      injectFailure = true;
      assert.throws(
        () => coordinator.recoverOnStartup(),
        new RegExp(`injected recovery rollback at ${failureStep}`),
      );
      injectFailure = false;
      assert.equal(rowCount(filename, 'recovery_reconciliations'), 0);
      assert.equal(store.getWorkflow(authority.workflow.id)?.runStatus, RunStatus.RUNNING);
      assert.equal(store.getAttempt(running.activeAttemptId)?.status, AttemptStatus.RUNNING);
      assert.equal(
        store.listAuditEvents('RECOVERY_RECONCILIATION', authority.workflow.id).length,
        0,
      );
      worker.release();
      await pendingExecution;
    });
  }
});

void test('[I-006][I-009] reopen rejects a self-consistent row whose Recovery digest was not recomputed', async (t) => {
  const filename = temporaryDatabase(t, 'recovery-reopen-tamper.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const authority = seedAuthority(store, 'recoveryreopentamper');
  await createWorkerExecutionApplication(
    runtimeDependencies(
      store,
      new FakeWorker({ fixture: FakeWorkerFixture.ABRUPT_TERMINATION }),
      authority,
      'recoveryreopentamper',
    ),
  ).startGoal(startRequest(authority, 'recoveryreopentamper'));
  const blocked = store.getWorkflow(authority.workflow.id);
  assert.ok(blocked);
  assert.equal(blocked.runStatus, RunStatus.BLOCKED);
  const recovery = createRecoveryCoordinator({
    store,
    clock: sequenceClock(isoTimestamp('2026-07-27T00:00:00.300Z')),
    ids: new DeterministicIds('recovery-reopen-tamper-control'),
    digests,
    policyBundleId: authority.policy.id,
    policyBundleDigest: authority.policy.digest,
    inspector: new FakeRecoveryInspector([FakeRecoveryInspectionMode.EXACT]),
    inspectorVersion: 'fake-recovery-inspector-v1',
    recoveryPolicyVersion: 'm1-exact-same-phase-v1',
  });
  assert.equal(
    recovery.resumeGoal({
      commandId: commandId('command_recovery-reopen-tamper-resume'),
      goalId: authority.goal.id,
      expectedGoalRevision: authority.goal.revision,
      expectedWorkflowVersion: blocked.version,
    }).status,
    'APPLIED',
  );
  store.close();

  const raw = new Database(filename);
  raw.exec('DROP TRIGGER recovery_reconciliations_no_update');
  raw.prepare("UPDATE recovery_reconciliations SET inspector_version = 'tampered-v2'").run();
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename, now: () => createdAt }),
    /Recovery reconciliation .* digest does not match its canonical projection/,
  );
});
