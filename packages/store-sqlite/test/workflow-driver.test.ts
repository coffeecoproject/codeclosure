import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AcceptanceOutcome,
  AttemptStatus,
  GuardOutcome,
  RunStatus,
  WorkflowGuard,
  WorkflowPhase,
  commandId,
  createGoal,
  createWorkflow,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  requiredGuardsForTransition,
  successCriterionId,
  workflowId,
  type ExecutionProfile,
  type Goal,
  type PolicyBundle,
  type PolicyBundleDefinition,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M1_ACCEPTANCE_RULES,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  WorkflowDriveStopReason,
  createCodeClosureApplication,
  createExecutionProfileInstaller,
  createM1AcceptanceCheckerIdentity,
  createPolicyInstaller,
  type Clock,
  type WorkerPort,
} from '@codeclosure/runtime';
import {
  createRecoveryCoordinator,
  createWorkflowDriver,
  type RuntimeExecutionProfile,
} from '@codeclosure/runtime/composition';
import {
  WorkflowRuntimeKernel,
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

const runtimeOwnedGuards = new Set<WorkflowGuard>([
  WorkflowGuard.CANDIDATE_GENERATION_PREPARED,
  WorkflowGuard.MUTABLE_CANDIDATE_CURRENT,
  WorkflowGuard.WORKER_QUIESCENT,
  WorkflowGuard.NO_WRITE_CAPABLE_WORKER,
  WorkflowGuard.FREEZE_IDENTITY_STABLE,
  WorkflowGuard.CHANGE_IDENTITY_RECORDED,
  WorkflowGuard.FROZEN_DIGEST_PERSISTED,
  WorkflowGuard.INTEGRITY_POLICY_PASSED,
  WorkflowGuard.REQUIRED_EVIDENCE_ACCOUNTED,
  WorkflowGuard.EVIDENCE_BINDINGS_CURRENT,
  WorkflowGuard.CLEANUP_PROVEN,
  WorkflowGuard.SOURCE_DIGEST_CURRENT,
  WorkflowGuard.CURRENT_ACCEPTANCE,
  WorkflowGuard.REJECT_REPAIRABLE_RECORDED,
]);

const genericGuards: PhaseGuardEvaluator = Object.freeze({
  evaluate: (input: Parameters<PhaseGuardEvaluator['evaluate']>[0]) =>
    Object.freeze(
      (requiredGuardsForTransition(input.workflow.phase, input.requestedPhase) ?? [])
        .filter((guard) => !runtimeOwnedGuards.has(guard))
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
