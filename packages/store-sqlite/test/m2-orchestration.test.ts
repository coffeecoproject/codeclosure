import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AcceptanceOutcome,
  CandidateGenerationState,
  EvidenceKind,
  EvidenceResultStatus,
  GoalStatus,
  GuardOutcome,
  WorkflowPhase,
  acceptanceDecisionId,
  commandId,
  createGoal,
  createWorkflow,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  requiredGuardsForTransition,
  sha256Digest,
  successCriterionId,
  workflowId,
  type ExecutionProfile,
  type ExecutionProfileDefinition,
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
  createExecutionProfileInstaller,
  createM1AcceptanceCheckerIdentity,
  createPolicyInstaller,
  type Clock,
  type VerificationPort,
  type WorkerPort,
} from '@codeclosure/runtime';
import {
  createCandidateLeasedWorker,
  createM2WorkflowDriver,
  type CandidateLeasedWorkerFactory,
  type RuntimeExecutionProfile,
} from '@codeclosure/runtime/composition';
import {
  isRuntimeOwnedPhaseGuard,
  type AttemptContextCompilationRequest,
  type PhaseGuardEvaluator,
} from '@codeclosure/runtime/testing/workflow-runtime';
import { openSqliteControlStore, type SqliteControlStore } from '@codeclosure/store-sqlite';
import { DeterministicIds, FakeWorker, FakeWorkerFixture } from '@codeclosure/testing';
import {
  DARWIN_SEATBELT_PROFILE_ID,
  LOCAL_COMMAND_RUNNER_IDENTITY,
  LOCAL_COMMAND_RUNNER_VERSION,
  createDarwinSeatbeltIsolation,
  createLocalCommandVerificationRunner,
  darwinSeatbeltProfileDigest,
} from '@codeclosure/verification-local';
import { createLocalCandidateWorkspace } from '@codeclosure/workspace-local';

const createdAt = isoTimestamp('2026-07-31T12:00:00.000Z');
const digests = new CanonicalJsonSha256DigestProvider();

const genericGuards: PhaseGuardEvaluator = Object.freeze({
  evaluate: ({
    workflow,
    requestedPhase,
  }: {
    readonly workflow: WorkflowInstance;
    readonly requestedPhase: WorkflowInstance['phase'];
  }) =>
    Object.freeze(
      (requiredGuardsForTransition(workflow.phase, requestedPhase) ?? [])
        .filter((guard) => !isRuntimeOwnedPhaseGuard(guard))
        .map((guard) =>
          Object.freeze({
            guard,
            outcome: GuardOutcome.PASS,
            reasonCode: 'M2_ORCHESTRATION_FIXTURE_GUARD',
            supportingRefs: Object.freeze([`fixture:${guard}`]),
          }),
        ),
    ),
});

function git(root: string, arguments_: readonly string[]): string {
  return execFileSync('git', arguments_, {
    cwd: root,
    encoding: 'utf8',
    env: {
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_OPTIONAL_LOCKS: '0',
      LC_ALL: 'C',
      PATH: process.env['PATH'] ?? '/usr/bin:/bin',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function initializeSource(sourceRoot: string): void {
  mkdirSync(join(sourceRoot, 'src'), { recursive: true });
  writeFileSync(join(sourceRoot, 'README.md'), '# M2 orchestration fixture\n');
  writeFileSync(join(sourceRoot, 'src', 'result.txt'), 'source-pending\n');
  git(sourceRoot, ['init', '--quiet']);
  git(sourceRoot, ['config', 'user.name', 'CodeClosure Test']);
  git(sourceRoot, ['config', 'user.email', 'codeclosure@example.invalid']);
  git(sourceRoot, ['add', '.']);
  git(sourceRoot, ['commit', '--quiet', '-m', 'fixture']);
}

function removeFixtureRoot(root: string): void {
  if (!existsSync(root)) {
    return;
  }
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined || !existsSync(current)) {
      continue;
    }
    const stat = lstatSync(current);
    if (stat.isDirectory() && !stat.isSymbolicLink()) {
      chmodSync(current, 0o700);
      for (const name of readdirSync(current)) {
        pending.push(join(current, name));
      }
    } else if (stat.isFile()) {
      chmodSync(current, 0o600);
    }
  }
  rmSync(root, { force: true, recursive: true });
}

function monotonicClock(): Clock {
  const epoch = Date.parse(createdAt);
  let offset = 1;
  return Object.freeze({
    now: () => isoTimestamp(new Date(epoch + offset++).toISOString()),
  });
}

function executableDigest(path: string): ReturnType<typeof sha256Digest> {
  return sha256Digest(`sha256:${createHash('sha256').update(readFileSync(path)).digest('hex')}`);
}

function policyDefinition(namespace: string): PolicyBundleDefinition {
  return Object.freeze({
    id: policyBundleId(`policy_${namespace}`),
    schemaVersion: 1,
    version: 'm2-controlled-local-verification-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['candidate-lease-only']),
    contextRules: Object.freeze(['current-authority-only']),
    checkSpecifications: Object.freeze(['m1-candidate-freeze', 'm2-local-command-verification']),
    applicabilityRules: Object.freeze(['exact-generation-check-and-policy']),
    acceptanceRules: M1_ACCEPTANCE_RULES,
    checkerVersions: Object.freeze([createM1AcceptanceCheckerIdentity(digests)]),
  });
}

function profileDefinition(namespace: string): ExecutionProfileDefinition {
  return Object.freeze({
    id: executionProfileId(`profile_${namespace}`),
    schemaVersion: 1,
    version: 'm2-controlled-orchestration-v1',
    workerAdapter: 'controlled-candidate-worker',
    workerAdapterVersion: '1',
    candidateSource: 'controlled-copy-candidate-workspace',
    candidateSourceVersion: '1',
    verificationRunner: LOCAL_COMMAND_RUNNER_IDENTITY,
    verificationRunnerVersion: LOCAL_COMMAND_RUNNER_VERSION,
    driverVersion: 'm2-workflow-driver-v1',
  });
}

interface OrchestrationFixture {
  readonly authorityRoot: string;
  readonly clock: Clock;
  readonly filename: string;
  readonly generationRoots: ReadonlyMap<number, string>;
  readonly getBootstrapVerificationCalls: () => number;
  readonly goal: ReturnType<typeof createGoal>;
  readonly ids: DeterministicIds;
  readonly policy: PolicyBundle;
  readonly profile: ExecutionProfile;
  readonly runtimeProfile: RuntimeExecutionProfile;
  readonly sourceRoot: string;
  readonly store: SqliteControlStore;
  readonly workflow: ReturnType<typeof createWorkflow>;
}

function createFixture(
  t: TestContext,
  options: { readonly requireOperationalIsolation?: boolean } = {},
): OrchestrationFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m2-orchestration-')));
  t.after(() => removeFixtureRoot(root));
  const sourceRoot = join(root, 'source');
  const workspaceRoot = join(root, 'workspaces');
  const authorityRoot = join(root, 'authority');
  const credentialRoot = join(root, 'credentials');
  const runRoot = join(root, 'verification-runs');
  for (const path of [sourceRoot, authorityRoot, credentialRoot, runRoot]) {
    mkdirSync(path, { mode: 0o700 });
  }
  initializeSource(sourceRoot);
  writeFileSync(join(credentialRoot, 'token'), 'fixture-only-secret\n', { mode: 0o600 });

  const filename = join(authorityRoot, 'state.sqlite');
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => store.close());
  const ids = new DeterministicIds('m2-orchestration');
  const clock = monotonicClock();
  const goal = createGoal({
    id: goalId('goal_m2-orchestration'),
    revision: goalRevision(1),
    objective: 'Produce the exact complete marker in the isolated Candidate',
    successCriteria: Object.freeze([
      Object.freeze({
        id: successCriterionId('criterion_m2-orchestration-complete'),
        description: 'src/result.txt contains the exact complete marker',
        required: true,
      }),
    ]),
    scope: Object.freeze({ projectPath: realpathSync(sourceRoot), allowedPaths: ['src'] }),
    nonGoals: Object.freeze(['Do not edit the source checkout', 'Do not bypass verification']),
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId('workflow_m2-orchestration'),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  const policyInstall = createPolicyInstaller({ store, clock, ids, digests }).installPolicyBundle(
    policyDefinition('m2-orchestration'),
  );
  if (policyInstall.status === 'POLICY_CONFLICT') {
    assert.fail(policyInstall.message);
  }
  const profileInstall = createExecutionProfileInstaller({
    store,
    clock,
    ids,
    digests,
  }).installExecutionProfile(profileDefinition('m2-orchestration'));
  if (profileInstall.status === 'PROFILE_CONFLICT') {
    assert.fail(profileInstall.message);
  }
  const creation = store.createGoalWithWorkflow({
    commandId: ids.nextCommandId(),
    inputDigest: digests.digest({ schemaVersion: 1, type: 'M2_ORCHESTRATION_CREATE', goal }),
    goal,
    workflow,
    auditEventId: ids.nextAuditEventId(),
    workflowAuditEventId: ids.nextAuditEventId(),
    payloadDigest: digests.digest({ goal, workflow }),
  });
  assert.equal(creation.status, 'APPLIED');

  const forbiddenRoots = Object.freeze(
    [realpathSync(authorityRoot), realpathSync(credentialRoot), realpathSync(sourceRoot)].sort(),
  );
  const workspace = createLocalCandidateWorkspace({
    authorityRoots: Object.freeze(
      [realpathSync(authorityRoot), realpathSync(credentialRoot)].sort(),
    ),
    ownerId: 'm2-orchestration-owner',
    workspaceRoot,
  });
  const generationRoots = new Map<number, string>();
  const nonCandidateWorker = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  const implementationWorker: CandidateLeasedWorkerFactory = Object.freeze({
    create: ({ lease }: Parameters<CandidateLeasedWorkerFactory['create']>[0]) => {
      generationRoots.set(lease.generationSequence, lease.root);
      const delegate = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
      const controlledWorker: WorkerPort = Object.freeze({
        async *run(
          request: Parameters<WorkerPort['run']>[0],
          signal: AbortSignal,
        ): AsyncIterable<unknown> {
          writeFileSync(
            join(lease.root, 'src', 'result.txt'),
            lease.generationSequence === 1 ? 'incomplete\n' : 'complete\n',
          );
          yield* delegate.run(request, signal);
        },
      });
      return controlledWorker;
    },
  });
  const worker = createCandidateLeasedWorker({
    authority: store,
    workspace,
    clock,
    forbiddenRoots,
    nonCandidateWorker,
    implementationWorker,
  });
  let bootstrapVerificationCalls = 0;
  const bootstrapVerification: VerificationPort = Object.freeze({
    run: () => {
      bootstrapVerificationCalls += 1;
      throw new Error('M1 fake verification must not run in the M2 profile');
    },
  });
  const executablePath = realpathSync('/usr/bin/grep');
  const localCommandVerification = Object.freeze({
    workspace,
    runner:
      options.requireOperationalIsolation === false
        ? Object.freeze({
            run: () => Promise.reject(new Error('Profile-only fixture runner must not execute')),
          })
        : createLocalCommandVerificationRunner({
            workspaceLeases: workspace,
            isolation: createDarwinSeatbeltIsolation({
              runRootBase: runRoot,
              credentialRoots: [credentialRoot],
            }),
          }),
    profile: Object.freeze({
      forbiddenRoots,
      check: Object.freeze({
        version: 'm2.local-command.1',
        producerIdentity: LOCAL_COMMAND_RUNNER_IDENTITY,
        operation: 'local-command.execute',
        runnerIdentity: LOCAL_COMMAND_RUNNER_IDENTITY,
        runnerVersion: LOCAL_COMMAND_RUNNER_VERSION,
        executablePath,
        executableDigest: executableDigest(executablePath),
        declaredToolVersion: 'darwin-grep',
        argv: Object.freeze(['^complete$', 'src/result.txt']),
        cwd: '.',
        environmentVariables: Object.freeze([]),
        isolationProfileId: DARWIN_SEATBELT_PROFILE_ID,
        isolationProfileDigest: darwinSeatbeltProfileDigest(),
        timeoutMilliseconds: 2_000,
        terminationGraceMilliseconds: 100,
        stdoutLimitBytes: 4_096,
        stderrLimitBytes: 4_096,
        totalOutputLimitBytes: 8_192,
        payloadRetentionLimitBytes: 8_192,
        acceptedExitCodes: Object.freeze([0]),
      }),
    }),
  });
  const runtimeProfile: RuntimeExecutionProfile = Object.freeze({
    schemaVersion: 1,
    profileId: profileInstall.value.profile.id,
    profileDigest: profileInstall.value.profile.digest,
    driverVersion: profileInstall.value.profile.driverVersion,
    worker,
    candidateSource: workspace,
    verification: bootstrapVerification,
    localCommandVerification,
  });
  return Object.freeze({
    authorityRoot,
    clock,
    filename,
    generationRoots,
    getBootstrapVerificationCalls: () => bootstrapVerificationCalls,
    goal,
    ids,
    policy: policyInstall.value.bundle,
    profile: profileInstall.value.profile,
    runtimeProfile,
    sourceRoot,
    store,
    workflow,
  });
}

function orchestrationDriver(
  fixture: OrchestrationFixture,
  startProfile: RuntimeExecutionProfile = fixture.runtimeProfile,
  options: {
    readonly maxOperations?: number;
    readonly onRecoveryResume?: () => void;
    readonly resolvedProfile?: RuntimeExecutionProfile;
  } = {},
) {
  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm2-orchestration-context-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  });
  return createM2WorkflowDriver({
    store: fixture.store,
    clock: fixture.clock,
    ids: fixture.ids,
    digests,
    contextFactory: Object.freeze({
      compile: (input: AttemptContextCompilationRequest) => compiler.compile(input),
    }),
    policyBundleId: fixture.policy.id,
    policyBundleDigest: fixture.policy.digest,
    phaseGuards: genericGuards,
    recovery: Object.freeze({
      resumeGoal: () => {
        options.onRecoveryResume?.();
        throw new Error('The in-process Slice 5 fixture does not use restart recovery');
      },
    }),
    startProfile,
    ...(options.maxOperations === undefined ? {} : { maxOperations: options.maxOperations }),
    profiles: Object.freeze({
      resolve: (installed: ExecutionProfile) => {
        assert.equal(installed.id, fixture.profile.id);
        assert.equal(installed.digest, fixture.profile.digest);
        return options.resolvedProfile ?? startProfile;
      },
    }),
  });
}

function withoutLocalCommandVerification(
  profile: RuntimeExecutionProfile,
): RuntimeExecutionProfile {
  return Object.freeze({
    schemaVersion: profile.schemaVersion,
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    driverVersion: profile.driverVersion,
    worker: profile.worker,
    candidateSource: profile.candidateSource,
    verification: profile.verification,
  });
}

void test('[I-001][I-005][I-008][M2-F01][M2-F02][M2-F03] real Candidate and verifier reject, repair, and close on generation 2', async (t) => {
  const fixture = createFixture(t);
  const driver = orchestrationDriver(fixture);

  const first = await driver.startGoal({
    commandId: commandId('command_m2-orchestration-start'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: fixture.workflow.version,
  });
  assert.equal(first.command.status, 'APPLIED');
  assert.equal(
    first.drive?.stopReason,
    WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED,
    JSON.stringify(first),
  );
  const rejectedAuthority = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(rejectedAuthority?.acceptanceAuthority);
  assert.equal(
    rejectedAuthority.acceptanceAuthority.decision.outcome,
    AcceptanceOutcome.REJECT_REPAIRABLE,
  );
  assert.equal(rejectedAuthority.workflow.phase, WorkflowPhase.FINAL_VERIFY);
  const generationOne = rejectedAuthority.candidateAuthority?.generation;
  assert.ok(generationOne?.frozenDigest);
  const generationOneRoot = fixture.generationRoots.get(1);
  assert.ok(generationOneRoot);
  const generationOneBytes = readFileSync(join(generationOneRoot, 'src', 'result.txt'));
  assert.equal(generationOneBytes.toString('utf8'), 'incomplete\n');
  const generationOneEvidence = fixture.store.listEvidenceForGeneration(generationOne.id);
  const failedVerification = generationOneEvidence.find(
    ({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT,
  );
  assert.ok(failedVerification);
  assert.equal(failedVerification.record.resultStatus, EvidenceResultStatus.FAIL);
  assert.equal(
    generationOneEvidence.some(({ record }) => record.kind === EvidenceKind.TEST_RESULT),
    false,
  );

  const rejection = rejectedAuthority.acceptanceAuthority;
  const repaired = await driver.repairGoal({
    commandId: commandId('command_m2-orchestration-repair'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: rejectedAuthority.workflow.version,
    acceptanceDecisionId: rejection.decision.id,
    acceptanceDecisionDigest: rejection.decision.decisionDigest,
    inputManifestDigest: rejection.manifest.manifestDigest,
    candidateDigest: rejection.manifest.candidateDigest,
    reason: 'repair only in a child Candidate generation',
  });
  assert.equal(repaired.command.status, 'APPLIED');
  assert.equal(repaired.drive?.stopReason, WorkflowDriveStopReason.CLOSED);

  const finalAuthority = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(finalAuthority?.candidateAuthority);
  assert.ok(finalAuthority.acceptanceAuthority);
  assert.ok(finalAuthority.closeout);
  assert.equal(finalAuthority.goal.status, GoalStatus.CLOSED);
  assert.equal(finalAuthority.acceptanceAuthority.decision.outcome, AcceptanceOutcome.ACCEPT);
  assert.equal(finalAuthority.candidateAuthority.generation.sequence, 2);
  assert.equal(
    finalAuthority.candidateAuthority.generation.state,
    CandidateGenerationState.ACCEPTED,
  );
  assert.notEqual(finalAuthority.candidateAuthority.generation.id, generationOne.id);
  assert.equal(
    fixture.store.getCandidateGeneration(generationOne.id)?.state,
    CandidateGenerationState.REJECTED,
  );
  assert.deepEqual(readFileSync(join(generationOneRoot, 'src', 'result.txt')), generationOneBytes);
  const generationTwoRoot = fixture.generationRoots.get(2);
  assert.ok(generationTwoRoot);
  assert.equal(readFileSync(join(generationTwoRoot, 'src', 'result.txt'), 'utf8'), 'complete\n');
  assert.equal(
    readFileSync(join(fixture.sourceRoot, 'src', 'result.txt'), 'utf8'),
    'source-pending\n',
  );

  const generationTwoEvidence = fixture.store.listEvidenceForGeneration(
    finalAuthority.candidateAuthority.generation.id,
  );
  const passedVerification = generationTwoEvidence.find(
    ({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT,
  );
  assert.ok(passedVerification);
  assert.equal(passedVerification.record.resultStatus, EvidenceResultStatus.PASS);
  assert.equal(
    generationTwoEvidence.some(({ record }) => record.kind === EvidenceKind.TEST_RESULT),
    false,
  );
  assert.equal(fixture.getBootstrapVerificationCalls(), 0);
  assert.notEqual(passedVerification.record.checkSpec.id, failedVerification.record.checkSpec.id);
  const repairAuthority = fixture.store.getAcceptanceRepairForRejectedGeneration(generationOne.id);
  assert.ok(repairAuthority);
  assert.equal(
    repairAuthority.repairCandidateGenerationId,
    finalAuthority.candidateAuthority.generation.id,
  );
  assert.notEqual(repairAuthority.verificationCheckId, passedVerification.record.checkSpec.id);
  assert.equal(
    finalAuthority.closeout.candidateGenerationId,
    finalAuthority.candidateAuthority.generation.id,
  );
  assert.equal(
    finalAuthority.closeout.candidateDigest,
    finalAuthority.candidateAuthority.generation.frozenDigest,
  );
  assert.equal(
    finalAuthority.closeout.acceptanceDecisionId,
    finalAuthority.acceptanceAuthority.decision.id,
  );
  assert.notEqual(finalAuthority.closeout.acceptanceDecisionId, rejection.decision.id);

  const beforeStaleRepair = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  const staleRepair = await driver.repairGoal({
    commandId: commandId('command_m2-orchestration-stale-repair'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: finalAuthority.workflow.version,
    acceptanceDecisionId: rejection.decision.id,
    acceptanceDecisionDigest: rejection.decision.decisionDigest,
    inputManifestDigest: rejection.manifest.manifestDigest,
    candidateDigest: rejection.manifest.candidateDigest,
    reason: 'stale rejection must not mutate the closed Goal',
  });
  assert.equal(staleRepair.command.status, 'REJECTED');
  assert.deepEqual(fixture.store.getWorkflowDriverAuthority(fixture.goal.id), beforeStaleRepair);

  fixture.store.close();
  const reopened = openSqliteControlStore({ filename: fixture.filename });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getWorkflowDriverAuthority(fixture.goal.id), finalAuthority);
});

void test('[I-004][I-008][M2-F01] StartGoal rejects a local runner outside the installed Execution Profile before mutation', async (t) => {
  const fixture = createFixture(t, { requireOperationalIsolation: false });
  const local = fixture.runtimeProfile.localCommandVerification;
  assert.ok(local);
  const incompatibleProfile: RuntimeExecutionProfile = Object.freeze({
    ...fixture.runtimeProfile,
    localCommandVerification: Object.freeze({
      ...local,
      profile: Object.freeze({
        ...local.profile,
        check: Object.freeze({
          ...local.profile.check,
          runnerIdentity: 'uninstalled-local-command-runner',
        }),
      }),
    }),
  });
  const driver = orchestrationDriver(fixture, incompatibleProfile);
  const before = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  const startCommandId = commandId('command_m2-orchestration-incompatible-runner');

  const result = await driver.startGoal({
    commandId: startCommandId,
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: fixture.workflow.version,
  });

  assert.equal(result.command.status, 'REJECTED');
  assert.equal(result.command.output.ok, false);
  assert.equal(
    result.command.output.error.detailCode,
    'DRIVER_START_EXECUTION_PROFILE_INCOMPATIBLE',
  );
  assert.deepEqual(fixture.store.getWorkflowDriverAuthority(fixture.goal.id), before);
  assert.equal(fixture.store.getProcessedCommand(startCommandId), undefined);
});

void test('[I-004][M2-F01] runtime profile decoding rejects unknown local verification configuration fields', (t) => {
  const fixture = createFixture(t, { requireOperationalIsolation: false });
  const local = fixture.runtimeProfile.localCommandVerification;
  assert.ok(local);
  const malformedProfile = Object.freeze({
    ...fixture.runtimeProfile,
    localCommandVerification: Object.freeze({
      ...local,
      profile: Object.freeze({
        ...local.profile,
        unexpectedAuthority: 'must-not-be-ignored',
      }),
    }),
  });

  assert.throws(() => orchestrationDriver(fixture, malformedProfile), /unrecognized key/i);
});

void test('[I-004][I-027][M2-F01] M2 driver composition requires local command verification', (t) => {
  const fixture = createFixture(t, { requireOperationalIsolation: false });
  const profileWithoutLocalVerification = withoutLocalCommandVerification(fixture.runtimeProfile);
  const before = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);

  assert.throws(
    () => orchestrationDriver(fixture, profileWithoutLocalVerification),
    /requires local command verification/,
  );
  assert.deepEqual(fixture.store.getWorkflowDriverAuthority(fixture.goal.id), before);
  assert.equal(fixture.getBootstrapVerificationCalls(), 0);
});

void test('[I-004][I-027][M2-F01] M2 resolver cannot drop local verification after Profile binding', async (t) => {
  const fixture = createFixture(t, { requireOperationalIsolation: false });
  const boundedDriver = orchestrationDriver(fixture, fixture.runtimeProfile, { maxOperations: 1 });
  const started = await boundedDriver.startGoal({
    commandId: commandId('command_m2-orchestration-resolver-start'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: fixture.workflow.version,
  });
  assert.equal(started.command.status, 'APPLIED');

  const before = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(before);
  const repairCommandId = commandId('command_m2-orchestration-resolver-missing-local');
  const incompatibleDriver = orchestrationDriver(fixture, fixture.runtimeProfile, {
    resolvedProfile: withoutLocalCommandVerification(fixture.runtimeProfile),
  });
  const result = await incompatibleDriver.repairGoal({
    commandId: repairCommandId,
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: before.workflow.version,
    acceptanceDecisionId: acceptanceDecisionId('acceptance_missing-local-resolver'),
    acceptanceDecisionDigest: digests.digest({ type: 'MISSING_LOCAL_RESOLVER_DECISION' }),
    inputManifestDigest: digests.digest({ type: 'MISSING_LOCAL_RESOLVER_MANIFEST' }),
    candidateDigest: digests.digest({ type: 'MISSING_LOCAL_RESOLVER_CANDIDATE' }),
    reason: 'a resolved M2 Profile cannot drop its real verification capability',
  });

  assert.equal(result.command.status, 'REJECTED');
  assert.equal(result.command.output.ok, false);
  assert.equal(result.command.output.error.detailCode, 'DRIVER_EXECUTION_PROFILE_INCOMPATIBLE');
  assert.deepEqual(fixture.store.getWorkflowDriverAuthority(fixture.goal.id), before);
  assert.equal(fixture.store.getProcessedCommand(repairCommandId), undefined);
  assert.equal(fixture.getBootstrapVerificationCalls(), 0);
});

void test('[I-004][I-027][M2-F01] M2 Resume validates resolved local verification before recovery mutation', async (t) => {
  const fixture = createFixture(t, { requireOperationalIsolation: false });
  const boundedDriver = orchestrationDriver(fixture, fixture.runtimeProfile, { maxOperations: 1 });
  const started = await boundedDriver.startGoal({
    commandId: commandId('command_m2-orchestration-resume-preflight-start'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: fixture.workflow.version,
  });
  assert.equal(started.command.status, 'APPLIED');

  const before = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(before);
  let recoveryCalls = 0;
  const resumeCommandId = commandId('command_m2-orchestration-resume-missing-local');
  const incompatibleDriver = orchestrationDriver(fixture, fixture.runtimeProfile, {
    onRecoveryResume: () => {
      recoveryCalls += 1;
    },
    resolvedProfile: withoutLocalCommandVerification(fixture.runtimeProfile),
  });
  const result = await incompatibleDriver.resumeGoal({
    commandId: resumeCommandId,
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: before.workflow.version,
  });

  assert.equal(result.command.status, 'REJECTED');
  assert.equal(result.command.output.ok, false);
  assert.equal(result.command.output.error.detailCode, 'DRIVER_EXECUTION_PROFILE_INCOMPATIBLE');
  assert.equal(result.drive, undefined);
  assert.equal(recoveryCalls, 0);
  assert.equal(fixture.store.getProcessedCommand(resumeCommandId), undefined);
  assert.deepEqual(fixture.store.getWorkflowDriverAuthority(fixture.goal.id), before);
  assert.equal(fixture.getBootstrapVerificationCalls(), 0);
});
