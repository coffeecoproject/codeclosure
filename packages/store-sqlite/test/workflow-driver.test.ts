import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AcceptanceOutcome,
  AttemptFailureClass,
  AttemptStatus,
  GoalStatus,
  GuardOutcome,
  RunStatus,
  WorkflowPhase,
  candidateGenerationId,
  commandId,
  createGoal,
  createWorkflow,
  decodeContextPackage,
  deriveCapabilityGrant,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  requiredGuardsForTransition,
  successCriterionId,
  workflowId,
  workflowVersion,
  type ExecutionProfile,
  type Goal,
  type PolicyBundle,
  type PolicyBundleDefinition,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  GoalDominantBlockerCode,
  GoalNextSafeAction,
  M1_ACCEPTANCE_RULES,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  RuntimeErrorCode,
  WorkflowDriveStopReason,
  contextManifestDigestProjection,
  createCodeClosureApplication,
  createExecutionProfileInstaller,
  createM1AcceptanceCheckerIdentity,
  createPolicyInstaller,
  decodeStatusAuthority,
  deriveContextManifestEntries,
  type Clock,
  type ResumeGoalRequest,
  type WorkerPort,
} from '@codeclosure/runtime';
import {
  createRecoveryCoordinator,
  createWorkflowDriver,
  type RuntimeExecutionProfile,
} from '@codeclosure/runtime/composition';
import {
  WorkflowRuntimeKernel,
  isRuntimeOwnedPhaseGuard,
  type AttemptContextCompilationRequest,
  type PhaseGuardEvaluator,
  type StartGoalRequest,
} from '@codeclosure/runtime/testing/workflow-runtime';
import { openSqliteControlStore, type SqliteControlStore } from '@codeclosure/store-sqlite';
import {
  DeterministicIds,
  FakeCandidateSource,
  FakeRecoveryInspectionMode,
  FakeRecoveryInspector,
  FakeVerificationFixture,
  FakeVerificationRunner,
  FakeWorker,
  FakeWorkerFixture,
  testExecutionProfileDefinition,
} from '@codeclosure/testing';

const createdAt = isoTimestamp('2026-07-29T00:00:00.000Z');
const digests = new CanonicalJsonSha256DigestProvider();

const genericGuards: PhaseGuardEvaluator = Object.freeze({
  evaluate: (input: Parameters<PhaseGuardEvaluator['evaluate']>[0]) =>
    Object.freeze(
      (requiredGuardsForTransition(input.workflow.phase, input.requestedPhase) ?? [])
        .filter((guard) => !isRuntimeOwnedPhaseGuard(guard))
        .map((guard) =>
          Object.freeze({
            guard,
            outcome: GuardOutcome.PASS,
            reasonCode: 'DRIVER_FIXTURE_GENERIC_GUARD',
            supportingRefs: Object.freeze([`fixture:${guard}`]),
          }),
        ),
    ),
});

interface DriverHarness {
  readonly store: SqliteControlStore;
  readonly ids: DeterministicIds;
  readonly clock: Clock;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly policy: PolicyBundle;
  readonly profile: ExecutionProfile;
  readonly contextFactory: {
    compile(input: AttemptContextCompilationRequest): ReturnType<MinimalContextCompiler['compile']>;
  };
}

class CountingWorker implements WorkerPort {
  readonly #delegate: FakeWorker;
  #runCount = 0;

  public constructor() {
    this.#delegate = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  }

  public get runCount(): number {
    return this.#runCount;
  }

  public run(
    request: Parameters<WorkerPort['run']>[0],
    signal: AbortSignal,
  ): AsyncIterable<unknown> {
    this.#runCount += 1;
    return this.#delegate.run(request, signal);
  }
}

class CrossDispatchReplayWorker implements WorkerPort {
  readonly #delegate = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  #firstDelivery: unknown;
  #runCount = 0;

  public get runCount(): number {
    return this.#runCount;
  }

  public async *run(
    request: Parameters<WorkerPort['run']>[0],
    signal: AbortSignal,
  ): AsyncIterable<unknown> {
    this.#runCount += 1;
    if (this.#firstDelivery !== undefined) {
      yield this.#firstDelivery;
      return;
    }
    for await (const event of this.#delegate.run(request, signal)) {
      this.#firstDelivery = event;
      yield event;
    }
  }
}

function monotonicClock(): Clock {
  let offset = 1;
  const epoch = Date.parse(createdAt);
  return Object.freeze({
    now: () => {
      const timestamp = isoTimestamp(new Date(epoch + offset).toISOString());
      offset += 1;
      return timestamp;
    },
  });
}

function policyDefinition(namespace: string): PolicyBundleDefinition {
  return Object.freeze({
    id: policyBundleId(`policy_${namespace}`),
    schemaVersion: 1,
    version: 'm1-driver-policy-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['execution-profile-bound-context']),
    checkSpecifications: Object.freeze(['runtime-owned-check-specifications']),
    applicabilityRules: Object.freeze(['exact-candidate-and-policy']),
    acceptanceRules: M1_ACCEPTANCE_RULES,
    checkerVersions: Object.freeze([createM1AcceptanceCheckerIdentity(digests)]),
  });
}

function createHarness(t: TestContext, namespace: string): DriverHarness {
  const directory = mkdtempSync(join(tmpdir(), `codeclosure-driver-${namespace}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const store = openSqliteControlStore({
    filename: join(directory, 'state.sqlite'),
    now: () => createdAt,
  });
  t.after(() => store.close());
  const ids = new DeterministicIds(namespace);
  const clock = monotonicClock();
  const goal = createGoal({
    id: goalId(`goal_${namespace}`),
    revision: goalRevision(1),
    objective: `Prove the ${namespace} deterministic driver path`,
    successCriteria: Object.freeze([
      Object.freeze({
        id: successCriterionId(`criterion_${namespace}`),
        description: 'The exact frozen Candidate has current passing Evidence',
        required: true,
      }),
    ]),
    scope: Object.freeze({ projectPath: `/fixture/${namespace}`, allowedPaths: Object.freeze([]) }),
    nonGoals: Object.freeze(['No real source edit', 'No model completion authority']),
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId(`workflow_${namespace}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });

  const policyInstall = createPolicyInstaller({ store, clock, ids, digests }).installPolicyBundle(
    policyDefinition(namespace),
  );
  if (policyInstall.status === 'POLICY_CONFLICT') {
    assert.fail(policyInstall.message);
  }
  const profileInstall = createExecutionProfileInstaller({
    store,
    clock,
    ids,
    digests,
  }).installExecutionProfile(testExecutionProfileDefinition(namespace));
  if (profileInstall.status === 'PROFILE_CONFLICT') {
    assert.fail(profileInstall.message);
  }
  const creation = store.createGoalWithWorkflow({
    commandId: commandId(`command_${namespace}-create`),
    inputDigest: digests.digest({ schemaVersion: 1, type: 'DRIVER_TEST_CREATE', goal, workflow }),
    goal,
    workflow,
    auditEventId: ids.nextAuditEventId(),
    workflowAuditEventId: ids.nextAuditEventId(),
    payloadDigest: digests.digest({ goal, workflow }),
  });
  assert.equal(creation.status, 'APPLIED');

  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm1-context-compiler-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  });
  return Object.freeze({
    store,
    ids,
    clock,
    goal,
    workflow,
    policy: policyInstall.value.bundle,
    profile: profileInstall.value.profile,
    contextFactory: Object.freeze({
      compile: (input: AttemptContextCompilationRequest) => compiler.compile(input),
    }),
  });
}

function runtimeProfile(
  harness: DriverHarness,
  worker: WorkerPort,
  verificationFixture: FakeVerificationFixture = FakeVerificationFixture.PASS,
): RuntimeExecutionProfile {
  return Object.freeze({
    schemaVersion: 1,
    profileId: harness.profile.id,
    profileDigest: harness.profile.digest,
    driverVersion: harness.profile.driverVersion,
    worker,
    candidateSource: new FakeCandidateSource(),
    verification: new FakeVerificationRunner({ fixture: verificationFixture }),
  });
}

function startRequest(harness: DriverHarness): StartGoalRequest {
  return Object.freeze({
    commandId: commandId(`command_${harness.goal.id.slice('goal_'.length)}-start`),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: harness.workflow.version,
  });
}

function kernel(harness: DriverHarness, profile: RuntimeExecutionProfile): WorkflowRuntimeKernel {
  return new WorkflowRuntimeKernel({
    store: harness.store,
    clock: harness.clock,
    ids: harness.ids,
    digests,
    phaseGuards: genericGuards,
    workerContext: Object.freeze({
      identities: harness.ids,
      factory: harness.contextFactory,
      executionProfileId: profile.profileId,
      executionProfileDigest: profile.profileDigest,
      policyBundleId: harness.policy.id,
      policyBundleDigest: harness.policy.digest,
    }),
    candidateEvidence: Object.freeze({
      identities: harness.ids,
      candidateSource: profile.candidateSource,
      verification: profile.verification,
      policyBundleId: harness.policy.id,
      policyBundleDigest: harness.policy.digest,
    }),
    acceptance: Object.freeze({
      identities: harness.ids,
      policyBundleId: harness.policy.id,
      policyBundleDigest: harness.policy.digest,
    }),
  });
}

function driver(
  harness: DriverHarness,
  profile: RuntimeExecutionProfile,
  recovery: Parameters<typeof createWorkflowDriver>[0]['recovery'],
  onResolve?: () => void,
  maxOperations?: number,
) {
  return createWorkflowDriver({
    store: harness.store,
    clock: harness.clock,
    ids: harness.ids,
    digests,
    contextFactory: harness.contextFactory,
    policyBundleId: harness.policy.id,
    policyBundleDigest: harness.policy.digest,
    phaseGuards: genericGuards,
    recovery,
    startProfile: profile,
    ...(maxOperations === undefined ? {} : { maxOperations }),
    profiles: Object.freeze({
      resolve: (installed: ExecutionProfile) => {
        onResolve?.();
        assert.equal(installed.id, harness.profile.id);
        assert.equal(installed.digest, harness.profile.digest);
        return profile;
      },
    }),
  });
}

void test('[I-001][I-003][I-008] public StartGoal drives one deterministic path to exact closeout', async (t) => {
  const harness = createHarness(t, 'driver-happy');
  const freshAuthority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(freshAuthority);
  assert.equal(freshAuthority.latestPhaseAttempt, null);
  assert.equal(freshAuthority.latestPhaseContextManifest, null);
  const profile = runtimeProfile(
    harness,
    new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
  );
  const execution = driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('ResumeGoal is not exercised by the happy-path fixture');
      },
    }),
  );
  const application = createCodeClosureApplication({
    store: harness.store,
    clock: harness.clock,
    creationIds: harness.ids,
    digests,
    projectPaths: Object.freeze({ parseNormalizedAbsolute: (path: string) => path }),
    execution,
  });

  const result = await application.startGoal(startRequest(harness));
  assert.equal(result.command.status, 'APPLIED');
  assert.equal(result.command.output.ok, true);
  assert.ok(result.drive);
  assert.equal(
    result.drive.stopReason,
    WorkflowDriveStopReason.CLOSED,
    JSON.stringify(result.drive),
  );
  assert.ok(result.drive.finalState);
  assert.equal(result.drive.finalState.phase, WorkflowPhase.CLOSEOUT);
  assert.equal(result.drive.finalState.runStatus, RunStatus.CLOSED);
  assert.equal(result.drive.operationCount, 16);

  const status = application.getGoalStatus(harness.goal.id);
  assert.equal(status.status, 'FOUND');
  assert.ok(status.view.policyRef);
  assert.equal(status.view.policyRef.id, harness.policy.id);
  assert.equal(status.view.policyRef.version, harness.policy.version);
  assert.equal(status.view.policyRef.digest, harness.policy.digest);
  assert.equal(status.view.technicalCloseout, true);
  assert.equal(status.view.acceptanceSummary?.outcome, AcceptanceOutcome.ACCEPT);
  const auditBeforeReplay = application.getGoalAudit(harness.goal.id);
  assert.equal(auditBeforeReplay.status, 'FOUND');

  const replay = await application.startGoal(startRequest(harness));
  assert.equal(replay.command.status, 'REPLAYED');
  assert.ok(replay.drive);
  assert.equal(replay.drive.stopReason, WorkflowDriveStopReason.CLOSED);
  assert.equal(replay.drive.operationCount, 0);
  const auditAfterReplay = application.getGoalAudit(harness.goal.id);
  assert.equal(auditAfterReplay.status, 'FOUND');
  assert.equal(auditAfterReplay.view.throughSequence, auditBeforeReplay.view.throughSequence);
});

void test('[I-008] process summaries reload the last committed boundary before stopping', async (t) => {
  const harness = createHarness(t, 'driver-operation-limit');
  const countingWorker = new CountingWorker();
  const profile = runtimeProfile(harness, countingWorker);
  const execution = driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('ResumeGoal is not exercised by the operation-limit fixture');
      },
    }),
    undefined,
    1,
  );

  const result = await execution.startGoal(startRequest(harness));
  assert.equal(result.command.status, 'APPLIED');
  assert.ok(result.drive);
  assert.equal(result.drive.stopReason, WorkflowDriveStopReason.OPERATION_LIMIT);
  assert.ok(result.drive.finalState);
  assert.equal(result.drive.finalState.phase, WorkflowPhase.DISCOVERY);
  assert.equal(result.drive.finalState.runStatus, RunStatus.READY);
  assert.equal(countingWorker.runCount, 1);
  assert.equal(harness.store.getWorkflow(harness.workflow.id)?.activeAttemptId, undefined);
});

void test('[I-006][I-008][I-019] Driver cannot advance from incomplete Worker-phase completion authority', async (t) => {
  for (const poisonCase of [
    'missing-context-and-session',
    'missing-worker-session',
    'response-contract',
    'result-kind',
  ] as const) {
    await t.test(poisonCase, async (subtest) => {
      const namespace = `driver-completion-${poisonCase}`;
      const harness = createHarness(subtest, namespace);
      const worker = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
      const profile = runtimeProfile(harness, worker);
      const initialExecution = driver(
        harness,
        profile,
        Object.freeze({
          resumeGoal: () => {
            throw new Error('Completion-authority fixture does not enter recovery');
          },
        }),
        undefined,
        1,
      );
      const start = startRequest(harness);
      const initial = await initialExecution.startGoal(start);
      assert.equal(initial.command.status, 'APPLIED');
      assert.equal(initial.drive?.stopReason, WorkflowDriveStopReason.OPERATION_LIMIT);

      const retained = harness.store.getWorkflowDriverAuthority(harness.goal.id);
      assert.ok(retained);
      assert.ok(retained.latestPhaseAttempt);
      assert.equal(retained.latestPhaseAttempt.status, AttemptStatus.RESULT_RECORDED);
      const manifest = retained.latestPhaseContextManifest;
      if (manifest === null) {
        assert.fail('Completion-authority fixture requires its retained Context Manifest');
      }
      const persistedBefore = harness.store.getWorkflow(harness.workflow.id);
      assert.ok(persistedBefore);

      const poisonedAuthority = (() => {
        switch (poisonCase) {
          case 'missing-context-and-session':
            return Object.freeze({
              ...retained,
              latestPhaseAttempt: Object.freeze({
                ...retained.latestPhaseAttempt,
                contextManifestId: undefined,
                workerSessionRef: undefined,
              }),
              latestPhaseContextManifest: null,
            });
          case 'missing-worker-session':
            return Object.freeze({
              ...retained,
              latestPhaseAttempt: Object.freeze({
                ...retained.latestPhaseAttempt,
                workerSessionRef: undefined,
              }),
            });
          case 'response-contract': {
            const manifestWithoutRecomputedDigest = Object.freeze({
              ...manifest,
              responseContractDigest: digests.digest({ schemaVersion: 1, poisonCase }),
            });
            return Object.freeze({
              ...retained,
              latestPhaseContextManifest: Object.freeze({
                ...manifestWithoutRecomputedDigest,
                manifestDigest: digests.digest(
                  contextManifestDigestProjection(manifestWithoutRecomputedDigest),
                ),
              }),
            });
          }
          case 'result-kind':
            return Object.freeze({
              ...retained,
              latestPhaseAttempt: Object.freeze({
                ...retained.latestPhaseAttempt,
                terminationReason: 'WORKER_RESULT:COMPLETION_REQUEST',
              }),
            });
        }
      })();
      const unsafeAuthorityStore = new Proxy(harness.store, {
        get: (target, property) => {
          if (property === 'getWorkflowDriverAuthority') {
            return () => poisonedAuthority;
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? (value.bind(target) as unknown) : value;
        },
      });
      const rejectingDriver = createWorkflowDriver({
        store: unsafeAuthorityStore,
        clock: harness.clock,
        ids: harness.ids,
        digests,
        contextFactory: harness.contextFactory,
        policyBundleId: harness.policy.id,
        policyBundleDigest: harness.policy.digest,
        phaseGuards: genericGuards,
        recovery: Object.freeze({
          resumeGoal: () => {
            throw new Error('Poisoned completion authority must fail before recovery');
          },
        }),
        startProfile: profile,
        maxOperations: 1,
        profiles: Object.freeze({ resolve: () => profile }),
      });

      const replay = await rejectingDriver.startGoal(start);

      assert.equal(replay.command.status, 'REPLAYED');
      assert.equal(replay.drive?.stopReason, WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE);
      assert.equal(replay.drive.detailCode, 'DRIVER_AUTHORITY_INVALID');
      assert.equal(worker.readObservation().requestCount, 1);
      const persistedAfter = harness.store.getWorkflow(harness.workflow.id);
      assert.deepEqual(persistedAfter, persistedBefore);
    });
  }
});

void test('[I-008][I-009] cross-dispatch duplicate cannot terminate the current Driver stream', async (t) => {
  const harness = createHarness(t, 'driver-cross-dispatch-replay');
  const worker = new CrossDispatchReplayWorker();
  const profile = runtimeProfile(harness, worker);
  const execution = driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('Cross-dispatch replay fixture does not enter recovery');
      },
    }),
  );

  const result = await execution.startGoal(startRequest(harness));

  assert.equal(result.command.status, 'APPLIED');
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.FAILED);
  assert.equal(result.drive.detailCode, 'WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT');
  assert.equal(result.drive.finalState?.phase, WorkflowPhase.PLAN);
  assert.equal(result.drive.finalState.runStatus, RunStatus.FAILED);
  assert.equal(worker.runCount, 2);
  const authority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(authority?.latestPhaseAttempt);
  assert.equal(authority.latestPhaseAttempt.status, AttemptStatus.FAILED);
  assert.equal(authority.latestPhaseAttempt.failureClass, AttemptFailureClass.PROTOCOL_ERROR);
  assert.equal(
    authority.latestPhaseAttempt.terminationReason,
    'WORKER_STREAM_NO_ADMITTED_TERMINAL_EVENT',
  );
});

void test('[I-006][I-028] Runtime rejects a Store APPLIED result that disagrees with its Worker event', async (t) => {
  for (const poisonedAuthority of ['result', 'receipt'] as const) {
    await t.test(poisonedAuthority, async (subtest) => {
      const harness = createHarness(subtest, `driver-poisoned-${poisonedAuthority}`);
      const worker = new FakeWorker({ fixture: FakeWorkerFixture.FAILURE });
      const profile = runtimeProfile(harness, worker);
      const poisonedStore = new Proxy(harness.store, {
        get: (target, property) => {
          if (property === 'commitWorkerAttemptEvent') {
            return (
              input: Parameters<SqliteControlStore['commitWorkerAttemptEvent']>[0],
            ): ReturnType<SqliteControlStore['commitWorkerAttemptEvent']> => {
              const committed = target.commitWorkerAttemptEvent(input);
              if (committed.status !== 'APPLIED') {
                return committed;
              }
              if (poisonedAuthority === 'receipt') {
                return Object.freeze({
                  ...committed,
                  receipt: Object.freeze({
                    ...input.receipt,
                    internalCommandId: commandId(
                      `command_driver-poisoned-${poisonedAuthority}-wrong-receipt`,
                    ),
                  }),
                });
              }
              const workflow = committed.value.workflow;
              return Object.freeze({
                ...committed,
                value: Object.freeze({
                  workflow: Object.freeze({
                    id: workflow.id,
                    goalId: workflow.goalId,
                    goalRevision: workflow.goalRevision,
                    phase: workflow.phase,
                    runStatus: RunStatus.READY,
                    version: workflow.version,
                    createdAt: workflow.createdAt,
                    updatedAt: workflow.updatedAt,
                  }),
                  attempt: committed.value.attempt,
                }),
              });
            };
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? (value.bind(target) as unknown) : value;
        },
      });
      const execution = createWorkflowDriver({
        store: poisonedStore,
        clock: harness.clock,
        ids: harness.ids,
        digests,
        contextFactory: harness.contextFactory,
        policyBundleId: harness.policy.id,
        policyBundleDigest: harness.policy.digest,
        phaseGuards: genericGuards,
        recovery: Object.freeze({
          resumeGoal: () => {
            throw new Error('Poisoned Worker Event authority cannot enter recovery');
          },
        }),
        startProfile: profile,
        profiles: Object.freeze({ resolve: () => profile }),
      });
      const application = createCodeClosureApplication({
        store: harness.store,
        clock: harness.clock,
        creationIds: harness.ids,
        digests,
        projectPaths: Object.freeze({ parseNormalizedAbsolute: (path: string) => path }),
        execution,
      });

      const result = await application.startGoal(startRequest(harness));

      assert.equal(result.command.status, 'APPLIED');
      assert.ok(result.drive);
      assert.equal(result.drive.stopReason, WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE);
      assert.equal(result.drive.detailCode, 'DRIVER_WORKER_EVENT_CONTROL_PLANE_FAILURE');
      assert.equal(worker.readObservation().requestCount, 1);
      assert.equal(harness.store.nextAttemptSequence(harness.workflow.id), 2);
      assert.equal(harness.store.getWorkflow(harness.workflow.id)?.runStatus, RunStatus.BLOCKED);
    });
  }
});

void test('[I-028] one transient Worker failure blocks M1 without automatic redispatch', async (t) => {
  const harness = createHarness(t, 'driver-transient-stop');
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.FAILURE });
  const profile = runtimeProfile(harness, worker);
  const execution = driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('A transient Worker failure cannot enter recovery implicitly');
      },
    }),
  );
  const application = createCodeClosureApplication({
    store: harness.store,
    clock: harness.clock,
    creationIds: harness.ids,
    digests,
    projectPaths: Object.freeze({ parseNormalizedAbsolute: (path: string) => path }),
    execution,
  });

  const result = await application.startGoal(startRequest(harness));

  assert.equal(result.command.status, 'APPLIED');
  assert.ok(result.drive);
  assert.equal(result.drive.stopReason, WorkflowDriveStopReason.BLOCKED);
  assert.equal(result.drive.detailCode, 'WORKER_BACKEND_FAILURE');
  assert.equal(result.drive.operationCount, 1);
  assert.deepEqual(result.drive.finalState, {
    workflowVersion: 3,
    phase: WorkflowPhase.DISCOVERY,
    runStatus: RunStatus.BLOCKED,
  });

  const observation = worker.readObservation();
  assert.equal(observation.requestCount, 1);
  assert.equal(observation.eventDeliveryCount, 1);
  assert.equal(harness.store.nextAttemptSequence(harness.workflow.id), 2);

  const authority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(authority?.latestPhaseAttempt);
  assert.equal(authority.latestPhaseAttempt.sequence, 1);
  assert.equal(authority.latestPhaseAttempt.status, AttemptStatus.FAILED);
  assert.equal(authority.latestPhaseAttempt.failureClass, AttemptFailureClass.TRANSIENT_BACKEND);
  assert.equal(authority.latestPhaseAttempt.terminationReason, 'WORKER_BACKEND_FAILURE');
  assert.equal(authority.workflow.activeAttemptId, undefined);
  assert.equal(authority.workflow.suspendedReason, 'WORKER_BACKEND_FAILURE');

  const status = application.getGoalStatus(harness.goal.id);
  assert.equal(status.status, 'FOUND');
  assert.equal(status.view.runStatus, RunStatus.BLOCKED);
  assert.ok(status.view.dominantBlocker);
  assert.equal(status.view.dominantBlocker.code, GoalDominantBlockerCode.WORKFLOW_BLOCKED);
  assert.equal(status.view.dominantBlocker.detailCode, 'WORKER_BACKEND_FAILURE');
  assert.equal(status.view.nextSafeAction, GoalNextSafeAction.INSPECT_BLOCKER);
  assert.equal(status.view.technicalCloseout, false);
});

void test('[I-006][I-028] Driver current snapshot permits only BLOCKED or CANCELLED after a transient failure', async (t) => {
  const cases = [
    {
      runStatus: RunStatus.READY,
      goalStatus: GoalStatus.ACTIVE,
      valid: false,
    },
    {
      runStatus: RunStatus.FAILED,
      goalStatus: GoalStatus.BLOCKED,
      valid: false,
    },
    {
      runStatus: RunStatus.WAITING_FOR_INPUT,
      goalStatus: GoalStatus.WAITING_FOR_INPUT,
      valid: false,
    },
    {
      runStatus: RunStatus.BLOCKED,
      goalStatus: GoalStatus.BLOCKED,
      valid: true,
    },
    {
      runStatus: RunStatus.CANCELLED,
      goalStatus: GoalStatus.CANCELLED,
      valid: true,
    },
  ] as const;

  for (const scenario of cases) {
    await t.test(scenario.runStatus, async (subtest) => {
      const namespace = `driver-transient-snapshot-${scenario.runStatus
        .toLowerCase()
        .replaceAll('_', '-')}`;
      const harness = createHarness(subtest, namespace);
      const worker = new FakeWorker({ fixture: FakeWorkerFixture.FAILURE });
      const profile = runtimeProfile(harness, worker);
      const initialExecution = driver(
        harness,
        profile,
        Object.freeze({
          resumeGoal: () => {
            throw new Error('Initial transient failure cannot enter recovery implicitly');
          },
        }),
      );
      const started = await initialExecution.startGoal(startRequest(harness));
      assert.equal(started.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);

      const blockedAuthority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
      assert.ok(blockedAuthority);
      assert.equal(
        blockedAuthority.latestPhaseAttempt?.failureClass,
        AttemptFailureClass.TRANSIENT_BACKEND,
      );
      let retained = blockedAuthority;
      if (scenario.runStatus === RunStatus.CANCELLED) {
        const cancellation = initialExecution.cancelGoal({
          commandId: commandId(`command_${namespace}-cancel`),
          goalId: harness.goal.id,
          expectedGoalRevision: blockedAuthority.goal.revision,
          expectedWorkflowVersion: blockedAuthority.workflow.version,
          reason: 'operator cancelled the retained transient blocker',
        });
        assert.equal(cancellation.status, 'APPLIED');
        const cancelledAuthority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
        assert.ok(cancelledAuthority);
        retained = cancelledAuthority;
      }

      const visibleAuthority = scenario.valid
        ? retained
        : Object.freeze({
            ...retained,
            goal: Object.freeze({ ...retained.goal, status: scenario.goalStatus }),
            workflow: Object.freeze({
              id: retained.workflow.id,
              goalId: retained.workflow.goalId,
              goalRevision: retained.workflow.goalRevision,
              phase: retained.workflow.phase,
              runStatus: scenario.runStatus,
              version: retained.workflow.version,
              ...(scenario.runStatus === RunStatus.READY
                ? {}
                : { suspendedReason: `forged ${scenario.runStatus} transient state` }),
              createdAt: retained.workflow.createdAt,
              updatedAt: retained.workflow.updatedAt,
            }),
          });
      assert.equal(visibleAuthority.workflow.runStatus, scenario.runStatus);

      const authorityStore = new Proxy(harness.store, {
        get: (target, property) => {
          if (property === 'getWorkflowDriverAuthority') {
            return () => visibleAuthority;
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? (value.bind(target) as unknown) : value;
        },
      });
      let recoveryCalls = 0;
      const checkingDriver = createWorkflowDriver({
        store: authorityStore,
        clock: harness.clock,
        ids: harness.ids,
        digests,
        contextFactory: harness.contextFactory,
        policyBundleId: harness.policy.id,
        policyBundleDigest: harness.policy.digest,
        phaseGuards: genericGuards,
        recovery: Object.freeze({
          resumeGoal: (input: ResumeGoalRequest) => {
            recoveryCalls += 1;
            return Object.freeze({
              status: 'REJECTED',
              output: Object.freeze({
                schemaVersion: 1,
                commandId: input.commandId,
                ok: false,
                error: Object.freeze({
                  code: RuntimeErrorCode.DOMAIN_REJECTED,
                  message: 'Snapshot matrix reached the recovery boundary',
                  retryable: false,
                  detailCode: 'SNAPSHOT_MATRIX_RECOVERY_REACHED',
                }),
              }),
            });
          },
        }),
        startProfile: profile,
        profiles: Object.freeze({ resolve: () => profile }),
      });

      const result = await checkingDriver.resumeGoal({
        commandId: commandId(`command_${namespace}-resume`),
        goalId: harness.goal.id,
        expectedGoalRevision: retained.goal.revision,
        expectedWorkflowVersion: retained.workflow.version,
      });

      assert.equal(result.command.status, 'REJECTED');
      assert.equal(result.command.output.ok, false);
      assert.equal(
        result.command.output.error.detailCode,
        scenario.valid ? 'SNAPSHOT_MATRIX_RECOVERY_REACHED' : 'DRIVER_AUTHORITY_INVALID',
      );
      assert.equal(result.drive, undefined);
      assert.equal(recoveryCalls, scenario.valid ? 1 : 0);
      assert.equal(worker.readObservation().requestCount, 1);
      assert.equal(harness.store.nextAttemptSequence(harness.workflow.id), 2);
    });
  }
});

void test('[I-006][I-028] Driver rejects a Store snapshot that omits explicit latest-attempt authority', async (t) => {
  const harness = createHarness(t, 'driver-transient-missing-latest');
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.FAILURE });
  const profile = runtimeProfile(harness, worker);
  const initialExecution = driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('Initial transient failure cannot enter recovery implicitly');
      },
    }),
  );
  const started = await initialExecution.startGoal(startRequest(harness));
  assert.equal(started.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);

  const retained = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(retained);
  assert.ok(retained.latestPhaseAttempt);
  const missingLatestAuthority: Record<string, unknown> = {
    ...retained,
    goal: Object.freeze({ ...retained.goal, status: GoalStatus.ACTIVE }),
    workflow: Object.freeze({
      id: retained.workflow.id,
      goalId: retained.workflow.goalId,
      goalRevision: retained.workflow.goalRevision,
      phase: retained.workflow.phase,
      runStatus: RunStatus.READY,
      version: retained.workflow.version,
      createdAt: retained.workflow.createdAt,
      updatedAt: retained.workflow.updatedAt,
    }),
  };
  assert.equal(Reflect.deleteProperty(missingLatestAuthority, 'latestPhaseAttempt'), true);
  assert.equal(Reflect.deleteProperty(missingLatestAuthority, 'latestPhaseContextManifest'), true);
  const unsafeAuthorityStore = new Proxy(harness.store, {
    get: (target, property) => {
      if (property === 'getWorkflowDriverAuthority') {
        return () => Object.freeze(missingLatestAuthority);
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
  let recoveryCalls = 0;
  const rejectingDriver = createWorkflowDriver({
    store: unsafeAuthorityStore,
    clock: harness.clock,
    ids: harness.ids,
    digests,
    contextFactory: harness.contextFactory,
    policyBundleId: harness.policy.id,
    policyBundleDigest: harness.policy.digest,
    phaseGuards: genericGuards,
    recovery: Object.freeze({
      resumeGoal: () => {
        recoveryCalls += 1;
        throw new Error('Missing latest Attempt authority must fail before recovery');
      },
    }),
    startProfile: profile,
    profiles: Object.freeze({ resolve: () => profile }),
  });

  const result = await rejectingDriver.resumeGoal({
    commandId: commandId('command_driver-transient-missing-latest-resume'),
    goalId: harness.goal.id,
    expectedGoalRevision: retained.goal.revision,
    expectedWorkflowVersion: retained.workflow.version,
  });

  assert.equal(result.command.status, 'REJECTED');
  assert.equal(result.command.output.ok, false);
  assert.equal(result.command.output.error.detailCode, 'DRIVER_AUTHORITY_INVALID');
  assert.equal(result.drive, undefined);
  assert.equal(recoveryCalls, 0);
  assert.equal(worker.readObservation().requestCount, 1);
  assert.equal(harness.store.nextAttemptSequence(harness.workflow.id), 2);
});

void test('[I-006][I-008] Driver rejects explicit null latest authority for an active Attempt', async (t) => {
  const harness = createHarness(t, 'driver-active-false-null');
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  const profile = runtimeProfile(harness, worker);
  const started = kernel(harness, profile).startGoal(startRequest(harness));
  assert.equal(started.status, 'APPLIED');

  const retained = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(retained?.activeAttempt);
  assert.ok(retained.latestPhaseAttempt);
  assert.ok(retained.latestPhaseContextManifest);
  const falseNullAuthority = Object.freeze({
    ...retained,
    latestPhaseAttempt: null,
    latestPhaseContextManifest: null,
  });
  const unsafeAuthorityStore = new Proxy(harness.store, {
    get: (target, property) => {
      if (property === 'getWorkflowDriverAuthority') {
        return () => falseNullAuthority;
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
  let recoveryCalls = 0;
  const rejectingDriver = createWorkflowDriver({
    store: unsafeAuthorityStore,
    clock: harness.clock,
    ids: harness.ids,
    digests,
    contextFactory: harness.contextFactory,
    policyBundleId: harness.policy.id,
    policyBundleDigest: harness.policy.digest,
    phaseGuards: genericGuards,
    recovery: Object.freeze({
      resumeGoal: () => {
        recoveryCalls += 1;
        throw new Error('False null Attempt authority must fail before recovery');
      },
    }),
    startProfile: profile,
    profiles: Object.freeze({ resolve: () => profile }),
  });

  const result = await rejectingDriver.resumeGoal({
    commandId: commandId('command_driver-active-false-null-resume'),
    goalId: harness.goal.id,
    expectedGoalRevision: retained.goal.revision,
    expectedWorkflowVersion: retained.workflow.version,
  });

  assert.equal(result.command.status, 'REJECTED');
  assert.equal(result.command.output.ok, false);
  assert.equal(result.command.output.error.detailCode, 'DRIVER_AUTHORITY_INVALID');
  assert.equal(result.drive, undefined);
  assert.equal(recoveryCalls, 0);
  assert.equal(worker.readObservation().requestCount, 0);
  assert.equal(harness.store.nextAttemptSequence(harness.workflow.id), 2);
});

void test('[I-006][I-008][I-019] Driver closes visible Context Manifest and Attempt bindings', async (t) => {
  for (const poisonCase of [
    'phase',
    'created-at',
    'capability-grant',
    'workflow-version',
    'candidate-binding',
  ] as const) {
    await t.test(poisonCase, async (subtest) => {
      const namespace = `driver-context-${poisonCase}`;
      const harness = createHarness(subtest, namespace);
      const worker = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
      const profile = runtimeProfile(harness, worker);
      const runtimeKernel = kernel(harness, profile);
      assert.equal(runtimeKernel.startGoal(startRequest(harness)).status, 'APPLIED');

      const retained = harness.store.getWorkflowDriverAuthority(harness.goal.id);
      assert.ok(retained?.activeAttempt);
      assert.ok(retained.latestPhaseAttempt);
      const manifest = retained.latestPhaseContextManifest;
      if (manifest === null) {
        assert.fail('Driver Context binding fixture requires a retained Context Manifest');
      }

      let manifestWithoutRecomputedDigest = manifest;
      switch (poisonCase) {
        case 'phase':
          manifestWithoutRecomputedDigest = Object.freeze({
            ...manifest,
            phase: WorkflowPhase.PLAN,
          });
          break;
        case 'created-at':
          manifestWithoutRecomputedDigest = Object.freeze({
            ...manifest,
            createdAt: isoTimestamp('2026-07-29T00:01:00.000Z'),
          });
          break;
        case 'capability-grant':
          manifestWithoutRecomputedDigest = Object.freeze({
            ...manifest,
            capabilityGrantDigest: digests.digest({ schemaVersion: 1, poisonCase }),
          });
          break;
        case 'workflow-version':
          manifestWithoutRecomputedDigest = Object.freeze({
            ...manifest,
            workflowVersion: workflowVersion(manifest.workflowVersion + 1),
          });
          break;
        case 'candidate-binding': {
          const request = runtimeKernel.takePreparedWorkerRequest(retained.activeAttempt.id);
          if (request === undefined) {
            assert.fail('Driver Candidate binding fixture requires its prepared Worker Request');
          }
          const generationId = candidateGenerationId(`generation_${namespace}-forged`);
          const candidateDigest = digests.digest({ schemaVersion: 1, generationId });
          const contextPackage = decodeContextPackage({
            ...request.contextPackage,
            candidateGenerationId: generationId,
            candidateDigest,
          });
          manifestWithoutRecomputedDigest = Object.freeze({
            ...manifest,
            candidateGenerationId: generationId,
            candidateDigest,
            entries: deriveContextManifestEntries(contextPackage, digests),
            packageDigest: digests.digest(contextPackage),
          });
          break;
        }
      }
      const poisonedManifest = Object.freeze({
        ...manifestWithoutRecomputedDigest,
        manifestDigest: digests.digest(
          contextManifestDigestProjection(manifestWithoutRecomputedDigest),
        ),
      });
      const unsafeAuthority = Object.freeze({
        ...retained,
        latestPhaseContextManifest: poisonedManifest,
      });
      const unsafeAuthorityStore = new Proxy(harness.store, {
        get: (target, property) => {
          if (property === 'getWorkflowDriverAuthority') {
            return () => unsafeAuthority;
          }
          const value: unknown = Reflect.get(target, property, target);
          return typeof value === 'function' ? (value.bind(target) as unknown) : value;
        },
      });
      let recoveryCalls = 0;
      const rejectingDriver = createWorkflowDriver({
        store: unsafeAuthorityStore,
        clock: harness.clock,
        ids: harness.ids,
        digests,
        contextFactory: harness.contextFactory,
        policyBundleId: harness.policy.id,
        policyBundleDigest: harness.policy.digest,
        phaseGuards: genericGuards,
        recovery: Object.freeze({
          resumeGoal: () => {
            recoveryCalls += 1;
            throw new Error('Poisoned Context authority must fail before recovery');
          },
        }),
        startProfile: profile,
        profiles: Object.freeze({ resolve: () => profile }),
      });

      const result = await rejectingDriver.resumeGoal({
        commandId: commandId(`command_${namespace}-resume`),
        goalId: harness.goal.id,
        expectedGoalRevision: retained.goal.revision,
        expectedWorkflowVersion: retained.workflow.version,
      });

      assert.equal(result.command.status, 'REJECTED');
      assert.equal(result.command.output.ok, false);
      assert.equal(result.command.output.error.detailCode, 'DRIVER_AUTHORITY_INVALID');
      assert.equal(result.drive, undefined);
      assert.equal(recoveryCalls, 0);
      assert.equal(worker.readObservation().requestCount, 0);
      assert.equal(harness.store.nextAttemptSequence(harness.workflow.id), 2);
    });
  }
});

void test('[I-006][I-008] Driver rejects contradictory copies of the active Attempt', async (t) => {
  const harness = createHarness(t, 'driver-active-contradiction');
  const worker = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  const profile = runtimeProfile(harness, worker);
  const started = kernel(harness, profile).startGoal(startRequest(harness));
  assert.equal(started.status, 'APPLIED');

  const retained = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(retained?.activeAttempt);
  assert.ok(retained.latestPhaseAttempt);
  const contradictoryAuthority = Object.freeze({
    ...retained,
    latestPhaseAttempt: Object.freeze({
      ...retained.latestPhaseAttempt,
      sequence: retained.latestPhaseAttempt.sequence + 1,
    }),
  });
  const unsafeAuthorityStore = new Proxy(harness.store, {
    get: (target, property) => {
      if (property === 'getWorkflowDriverAuthority') {
        return () => contradictoryAuthority;
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
  let recoveryCalls = 0;
  const rejectingDriver = createWorkflowDriver({
    store: unsafeAuthorityStore,
    clock: harness.clock,
    ids: harness.ids,
    digests,
    contextFactory: harness.contextFactory,
    policyBundleId: harness.policy.id,
    policyBundleDigest: harness.policy.digest,
    phaseGuards: genericGuards,
    recovery: Object.freeze({
      resumeGoal: () => {
        recoveryCalls += 1;
        throw new Error('Contradictory active Attempt authority must fail before recovery');
      },
    }),
    startProfile: profile,
    profiles: Object.freeze({ resolve: () => profile }),
  });

  const result = await rejectingDriver.resumeGoal({
    commandId: commandId('command_driver-active-contradiction-resume'),
    goalId: harness.goal.id,
    expectedGoalRevision: retained.goal.revision,
    expectedWorkflowVersion: retained.workflow.version,
  });

  assert.equal(result.command.status, 'REJECTED');
  assert.equal(result.command.output.ok, false);
  assert.equal(result.command.output.error.detailCode, 'DRIVER_AUTHORITY_INVALID');
  assert.equal(result.drive, undefined);
  assert.equal(recoveryCalls, 0);
  assert.equal(worker.readObservation().requestCount, 0);
  assert.equal(harness.store.nextAttemptSequence(harness.workflow.id), 2);
});

void test('[I-006][I-008] Runtime status decoding rejects an active Attempt from another phase', (t) => {
  const harness = createHarness(t, 'status-active-phase-mismatch');
  const profile = runtimeProfile(
    harness,
    new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
  );
  const started = kernel(harness, profile).startGoal(startRequest(harness));
  assert.equal(started.status, 'APPLIED');

  const retained = harness.store.getGoalStatusAuthority(harness.goal.id);
  assert.ok(retained?.activeAttempt);
  const poisoned = Object.freeze({
    ...retained,
    activeAttempt: Object.freeze({
      ...retained.activeAttempt,
      phase: WorkflowPhase.PLAN,
      capabilityGrant: deriveCapabilityGrant(WorkflowPhase.PLAN),
    }),
  });

  assert.throws(
    () => decodeStatusAuthority(poisoned, digests),
    /active Attempt does not match current Workflow authority/,
  );
});

void test('[I-008] every operation-limit boundary reports the latest committed authority', async (t) => {
  for (let operationLimit = 1; operationLimit <= 16; operationLimit += 1) {
    await t.test(`operation-limit-${String(operationLimit)}`, async (caseTest) => {
      const harness = createHarness(caseTest, `driver-boundary-${String(operationLimit)}`);
      const profile = runtimeProfile(
        harness,
        new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
      );
      const execution = driver(
        harness,
        profile,
        Object.freeze({
          resumeGoal: () => {
            throw new Error('ResumeGoal is not exercised by the boundary fixture');
          },
        }),
        undefined,
        operationLimit,
      );

      const result = await execution.startGoal(startRequest(harness));
      assert.ok(result.drive);
      const persisted = harness.store.getWorkflow(harness.workflow.id);
      assert.ok(persisted);
      assert.deepEqual(result.drive.finalState, {
        workflowVersion: persisted.version,
        phase: persisted.phase,
        runStatus: persisted.runStatus,
      });
      assert.equal(
        result.drive.stopReason,
        operationLimit === 16
          ? WorkflowDriveStopReason.CLOSED
          : WorkflowDriveStopReason.OPERATION_LIMIT,
      );
    });
  }
});

void test('[I-008] a losing Driver reports authority committed by the concurrent winner', async (t) => {
  const harness = createHarness(t, 'driver-concurrent-summary');
  const profile = runtimeProfile(
    harness,
    new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
  );
  const winningKernel = kernel(harness, profile);
  let injectedWinner = false;
  const interleavingStore = new Proxy(harness.store, {
    get: (target, property) => {
      if (property === 'commitWorkflowEvent') {
        return (input: Parameters<SqliteControlStore['commitWorkflowEvent']>[0]) => {
          if (!injectedWinner) {
            injectedWinner = true;
            const current = target.getWorkflow(harness.workflow.id);
            assert.ok(current);
            assert.equal(current.phase, WorkflowPhase.DISCOVERY);
            assert.equal(current.runStatus, RunStatus.READY);
            const winner = winningKernel.requestPhaseTransition({
              commandId: commandId('command_driver-concurrent-winner'),
              workflowId: current.id,
              expectedWorkflowVersion: current.version,
              requestedPhase: WorkflowPhase.PLAN,
              reason: 'fixture:concurrent-winner',
            });
            assert.equal(winner.status, 'APPLIED', JSON.stringify(winner));
          }
          return target.commitWorkflowEvent(input);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      return typeof value === 'function' ? (value.bind(target) as unknown) : value;
    },
  });
  const execution = createWorkflowDriver({
    store: interleavingStore,
    clock: harness.clock,
    ids: harness.ids,
    digests,
    contextFactory: harness.contextFactory,
    policyBundleId: harness.policy.id,
    policyBundleDigest: harness.policy.digest,
    phaseGuards: genericGuards,
    recovery: Object.freeze({
      resumeGoal: () => {
        throw new Error('Concurrent summary fixture does not resume');
      },
    }),
    startProfile: profile,
    profiles: Object.freeze({ resolve: () => profile }),
  });

  const result = await execution.startGoal(startRequest(harness));
  assert.equal(injectedWinner, true);
  assert.ok(result.drive);
  assert.equal(result.drive.stopReason, WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED);
  const current = harness.store.getWorkflow(harness.workflow.id);
  assert.ok(current);
  assert.equal(current.phase, WorkflowPhase.PLAN);
  assert.deepEqual(result.drive.finalState, {
    workflowVersion: current.version,
    phase: current.phase,
    runStatus: current.runStatus,
  });
});

void test('[I-008][I-010] public cancellation aborts only after durable cancellation wins', async (t) => {
  const harness = createHarness(t, 'driver-cancel');
  const delayedWorker = new FakeWorker({ fixture: FakeWorkerFixture.DELAYED_RESULT });
  const profile = runtimeProfile(harness, delayedWorker);
  const execution = driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('ResumeGoal is not exercised by the cancellation fixture');
      },
    }),
  );

  const pending = execution.startGoal(startRequest(harness));
  await delayedWorker.waitUntilStarted();
  const running = harness.store.getWorkflow(harness.workflow.id);
  assert.ok(running);
  assert.equal(running.runStatus, RunStatus.RUNNING);
  const cancellation = execution.cancelGoal({
    commandId: commandId('command_driver-cancel-cancel'),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: running.version,
    reason: 'fixture requested cancellation',
  });
  assert.equal(cancellation.status, 'APPLIED', JSON.stringify(cancellation));

  const result = await pending;
  assert.equal(result.command.status, 'APPLIED');
  assert.ok(result.drive);
  assert.equal(result.drive.stopReason, WorkflowDriveStopReason.CANCELLED);
  assert.ok(result.drive.finalState);
  assert.equal(result.drive.finalState.runStatus, RunStatus.CANCELLED);
  assert.equal(harness.store.getWorkflow(harness.workflow.id)?.runStatus, RunStatus.CANCELLED);
});

void test('[I-006][I-008][I-019] Resume fails before recovery when Runtime Policy differs from the Workflow binding', async (t) => {
  const harness = createHarness(t, 'driver-policy-binding');
  const profile = runtimeProfile(
    harness,
    new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
  );
  const initialExecution = driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('Initial fixture does not resume');
      },
    }),
    undefined,
    1,
  );
  const started = await initialExecution.startGoal(startRequest(harness));
  assert.equal(started.command.status, 'APPLIED');
  assert.equal(started.drive?.stopReason, WorkflowDriveStopReason.OPERATION_LIMIT);

  const installedPolicyB = createPolicyInstaller({
    store: harness.store,
    clock: harness.clock,
    ids: harness.ids,
    digests,
  }).installPolicyBundle(policyDefinition('driver-policy-binding-b'));
  if (installedPolicyB.status !== 'INSTALLED') {
    assert.fail('Policy B was not installed');
  }
  assert.equal(installedPolicyB.status, 'INSTALLED');

  const before = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(before);
  let recoveryCalls = 0;
  const incompatibleExecution = createWorkflowDriver({
    store: harness.store,
    clock: harness.clock,
    ids: harness.ids,
    digests,
    contextFactory: harness.contextFactory,
    policyBundleId: installedPolicyB.value.bundle.id,
    policyBundleDigest: installedPolicyB.value.bundle.digest,
    phaseGuards: genericGuards,
    recovery: Object.freeze({
      resumeGoal: () => {
        recoveryCalls += 1;
        throw new Error('Policy preflight must stop before recovery');
      },
    }),
    startProfile: profile,
    profiles: Object.freeze({ resolve: () => profile }),
  });
  const resumeCommandId = commandId('command_driver-policy-binding-resume-b');
  const result = await incompatibleExecution.resumeGoal({
    commandId: resumeCommandId,
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: before.workflow.version,
  });

  assert.equal(result.command.status, 'REJECTED');
  assert.equal(result.command.output.ok, false);
  assert.equal(result.command.output.error.detailCode, 'DRIVER_POLICY_BINDING_INCOMPATIBLE');
  assert.equal(result.drive, undefined);
  assert.equal(recoveryCalls, 0);
  assert.equal(harness.store.getProcessedCommand(resumeCommandId), undefined);
  assert.deepEqual(harness.store.getWorkflowDriverAuthority(harness.goal.id), before);
  assert.equal(
    harness.store.getWorkflowPolicyBinding(harness.workflow.id)?.policyBundleId,
    harness.policy.id,
  );
  assert.equal(
    harness.store.getWorkflowPolicyBinding(harness.workflow.id)?.policyBundleDigest,
    harness.policy.digest,
  );
});

void test('[I-003][I-013][I-016] repairable Acceptance stops for a decision without automatic repair', async (t) => {
  const harness = createHarness(t, 'driver-repair-stop');
  const profile = runtimeProfile(
    harness,
    new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
    FakeVerificationFixture.FAIL,
  );
  const execution = driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('ResumeGoal is not exercised by the repair-stop fixture');
      },
    }),
  );

  const result = await execution.startGoal(startRequest(harness));
  assert.equal(result.command.status, 'APPLIED');
  assert.ok(result.drive);
  assert.equal(result.drive.stopReason, WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED);
  const authority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(authority);
  assert.equal(authority.workflow.phase, WorkflowPhase.FINAL_VERIFY);
  assert.equal(authority.workflow.runStatus, RunStatus.READY);
  assert.equal(
    authority.acceptanceAuthority?.decision.outcome,
    AcceptanceOutcome.REJECT_REPAIRABLE,
  );
  assert.equal(authority.closeout, undefined);
});

void test('[I-008][I-009][I-010] replay never redispatches a retained claim and Resume creates fresh work', async (t) => {
  const harness = createHarness(t, 'driver-recovery');
  const countingWorker = new CountingWorker();
  const profile = runtimeProfile(harness, countingWorker);
  const initialKernel = kernel(harness, profile);
  const request = startRequest(harness);
  assert.equal(initialKernel.startGoal(request).status, 'APPLIED');
  const running = harness.store.getWorkflow(harness.workflow.id);
  assert.ok(running?.activeAttemptId);
  const interruptedAttemptId = running.activeAttemptId;
  const prepared = initialKernel.takePreparedWorkerRequest(interruptedAttemptId);
  assert.ok(prepared);
  assert.equal(initialKernel.claimWorkerDispatch(prepared).status, 'CLAIMED');
  const originalClaim = harness.store.getWorkerDispatchClaim(interruptedAttemptId);
  assert.ok(originalClaim);

  const inspector = new FakeRecoveryInspector([
    FakeRecoveryInspectionMode.EXACT,
    FakeRecoveryInspectionMode.EXACT,
  ]);
  const recovery = createRecoveryCoordinator({
    store: harness.store,
    clock: harness.clock,
    ids: harness.ids,
    digests,
    policyBundleId: harness.policy.id,
    policyBundleDigest: harness.policy.digest,
    inspector,
    inspectorVersion: 'fake-recovery-inspector-v1',
    recoveryPolicyVersion: 'm1-exact-same-phase-v1',
  });
  let resolveCount = 0;
  const execution = driver(harness, profile, recovery, () => {
    resolveCount += 1;
  });

  const replayWhileRunning = await execution.startGoal(request);
  assert.equal(replayWhileRunning.command.status, 'REPLAYED');
  assert.ok(replayWhileRunning.drive);
  assert.equal(replayWhileRunning.drive.stopReason, WorkflowDriveStopReason.ACTIVE_ATTEMPT);
  assert.equal(replayWhileRunning.drive.operationCount, 0);
  assert.equal(countingWorker.runCount, 0);
  assert.deepEqual(harness.store.getWorkerDispatchClaim(interruptedAttemptId), originalClaim);

  const startup = recovery.recoverOnStartup();
  assert.equal(startup.reconciledCount, 1);
  assert.equal(harness.store.getAttempt(interruptedAttemptId)?.status, AttemptStatus.INTERRUPTED);
  const blocked = harness.store.getWorkflow(harness.workflow.id);
  assert.ok(blocked);
  assert.equal(blocked.runStatus, RunStatus.BLOCKED);

  const resumed = await execution.resumeGoal({
    commandId: commandId('command_driver-recovery-resume'),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: blocked.version,
  });
  assert.equal(resumed.command.status, 'APPLIED');
  assert.ok(resumed.drive);
  assert.equal(resumed.drive.stopReason, WorkflowDriveStopReason.CLOSED);
  assert.ok(resumed.drive.finalState);
  assert.equal(resumed.drive.finalState.runStatus, RunStatus.CLOSED);
  assert.equal(resolveCount, 1);
  assert.equal(countingWorker.runCount, 3);
  assert.deepEqual(harness.store.getWorkerDispatchClaim(interruptedAttemptId), originalClaim);
  assert.equal(inspector.requests().length, 2);
});
