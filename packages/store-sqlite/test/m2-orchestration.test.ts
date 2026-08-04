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
  AttemptStatus,
  CandidateGenerationState,
  EvidenceKind,
  EvidenceResultStatus,
  GoalStatus,
  GuardOutcome,
  RecoveryReasonCode,
  RecoveryReconciliationDisposition,
  RecoveryReconciliationPurpose,
  RunStatus,
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
  RecoveryContinuityBarrier,
  WorkflowDriveStopReason,
  createExecutionProfileInstaller,
  createM1AcceptanceCheckerIdentity,
  createPolicyInstaller,
  goalAndWorkflowCreationPayloadProjection,
  type Clock,
  type LocalCommandVerificationPort,
  type RecoveryCommandCapability,
  type VerificationPort,
  type WorkerPort,
} from '@codeclosure/runtime';
import {
  createCandidateLeasedWorker,
  createM2WorkflowDriver,
  createProtectedM2WorkflowDriver,
  createRecoveryCoordinator,
  type CandidateLeasedWorkerFactory,
  type RuntimeExecutionProfile,
} from '@codeclosure/runtime/composition';
import {
  isRuntimeOwnedPhaseGuard,
  type AttemptContextCompilationRequest,
  type PhaseGuardEvaluator,
} from '@codeclosure/runtime/testing/workflow-runtime';
import {
  CandidateEvidenceTransactionStep,
  WorkerTransactionStep,
  openSqliteControlStore,
  type SqliteControlStore,
} from '@codeclosure/store-sqlite';
import {
  DeterministicIds,
  FakeRecoveryInspectionMode,
  FakeRecoveryInspector,
  FakeWorker,
  FakeWorkerFixture,
} from '@codeclosure/testing';
import {
  DARWIN_SEATBELT_PROFILE_ID,
  LOCAL_COMMAND_RUNNER_IDENTITY,
  LOCAL_COMMAND_RUNNER_VERSION,
  createProtectedAssetReadLeaseAuthority,
  createDarwinSeatbeltIsolation,
  createLocalCommandVerificationRunner,
  darwinSeatbeltProfileDigest,
  darwinSeatbeltProtectedProfileDigest,
  inspectProtectedVerificationAsset,
  protectedVerificationAssetManifestDigest,
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

function localCommandObservation(exitCode: number): unknown {
  return Object.freeze({
    schemaVersion: 1 as const,
    kind: 'LOCAL_COMMAND_OBSERVATION_V1' as const,
    terminationKind: 'EXITED' as const,
    exitCode,
    stdoutBytes: new Uint8Array(),
    stdoutObservedByteCount: 0,
    stdoutTruncated: false,
    stderrBytes: new Uint8Array(),
    stderrObservedByteCount: 0,
    stderrTruncated: false,
    diagnosticCode: 'NONE' as const,
  });
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
  readonly getDispatchedRequests: () => readonly Parameters<WorkerPort['run']>[0][];
  readonly getBootstrapVerificationCalls: () => number;
  readonly getLocalVerificationCalls: () => number;
  readonly goal: ReturnType<typeof createGoal>;
  readonly ids: DeterministicIds;
  readonly policy: PolicyBundle;
  readonly profile: ExecutionProfile;
  readonly runtimeProfile: RuntimeExecutionProfile;
  readonly sourceRoot: string;
  readonly protectedRoot?: string;
  readonly store: SqliteControlStore;
  readonly workflow: ReturnType<typeof createWorkflow>;
}

function createFixture(
  t: TestContext,
  options: {
    readonly requireOperationalIsolation?: boolean;
    readonly protectedVerification?: boolean;
    readonly localCommandRunner?: LocalCommandVerificationPort;
    readonly transactionProbe?: NonNullable<
      Parameters<typeof openSqliteControlStore>[0]['transactionProbe']
    >;
    readonly workerBehavior?: 'REPAIR' | 'CORRECT' | 'FAILED_REPAIR';
  } = {},
): OrchestrationFixture {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m2-orchestration-')));
  t.after(() => removeFixtureRoot(root));
  const sourceRoot = join(root, 'source');
  const workspaceRoot = join(root, 'workspaces');
  const authorityRoot = join(root, 'authority');
  const credentialRoot = join(root, 'credentials');
  const protectedRoot = join(root, 'protected-verification');
  const runRoot = join(root, 'verification-runs');
  for (const path of [sourceRoot, authorityRoot, credentialRoot, protectedRoot, runRoot]) {
    mkdirSync(path, { mode: 0o700 });
  }
  initializeSource(sourceRoot);
  writeFileSync(join(credentialRoot, 'token'), 'fixture-only-secret\n', { mode: 0o600 });
  const protectedExpectedPath = join(protectedRoot, 'expected-result.txt');
  writeFileSync(protectedExpectedPath, 'complete\n', { mode: 0o400 });

  const filename = join(authorityRoot, 'state.sqlite');
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    ...(options.transactionProbe === undefined
      ? {}
      : { transactionProbe: options.transactionProbe }),
  });
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
    payloadDigest: digests.digest(goalAndWorkflowCreationPayloadProjection(goal, workflow)),
  });
  assert.equal(creation.status, 'APPLIED');

  const forbiddenRoots = Object.freeze(
    [
      realpathSync(authorityRoot),
      realpathSync(credentialRoot),
      realpathSync(sourceRoot),
      ...(options.protectedVerification === true ? [realpathSync(protectedRoot)] : []),
    ].sort(),
  );
  const workspace = createLocalCandidateWorkspace({
    authorityRoots: Object.freeze(
      [
        realpathSync(authorityRoot),
        realpathSync(credentialRoot),
        ...(options.protectedVerification === true ? [realpathSync(protectedRoot)] : []),
      ].sort(),
    ),
    ownerId: 'm2-orchestration-owner',
    workspaceRoot,
  });
  const generationRoots = new Map<number, string>();
  const dispatchedRequests: Parameters<WorkerPort['run']>[0][] = [];
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
          dispatchedRequests.push(request);
          writeFileSync(
            join(lease.root, 'src', 'result.txt'),
            options.workerBehavior === 'CORRECT'
              ? 'complete\n'
              : options.workerBehavior === 'FAILED_REPAIR' || lease.generationSequence === 1
                ? 'incomplete\n'
                : 'complete\n',
          );
          if (options.protectedVerification === true) {
            writeFileSync(
              join(lease.root, 'src', 'worker-test.mjs'),
              'process.exit(0); // Worker-writable supplementary test intentionally weakened\n',
            );
          }
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
  const executablePath = realpathSync(
    options.protectedVerification === true ? '/usr/bin/cmp' : '/usr/bin/grep',
  );
  const protectedAsset = inspectProtectedVerificationAsset({
    logicalAssetId: 'm2.expected-result',
    registeredProtectedRootIdentity: realpathSync(protectedRoot),
    executionPath: realpathSync(protectedExpectedPath),
  });
  const semanticCheck = Object.freeze({
    version: 'm2.local-command.1',
    producerIdentity: LOCAL_COMMAND_RUNNER_IDENTITY,
    operation: 'local-command.execute',
    runnerIdentity: LOCAL_COMMAND_RUNNER_IDENTITY,
    runnerVersion: LOCAL_COMMAND_RUNNER_VERSION,
    executablePath,
    executableDigest: executableDigest(executablePath),
    declaredToolVersion: options.protectedVerification === true ? 'darwin-cmp' : 'darwin-grep',
    argv: Object.freeze(
      options.protectedVerification === true
        ? ['-s', protectedAsset.executionPath, 'src/result.txt']
        : ['^complete$', 'src/result.txt'],
    ),
    cwd: '.',
    environmentVariables: Object.freeze([]),
    isolationProfileId: DARWIN_SEATBELT_PROFILE_ID,
    isolationProfileDigest:
      options.protectedVerification === true
        ? darwinSeatbeltProtectedProfileDigest()
        : darwinSeatbeltProfileDigest(),
    timeoutMilliseconds: 2_000,
    terminationGraceMilliseconds: 100,
    stdoutLimitBytes: 4_096,
    stderrLimitBytes: 4_096,
    totalOutputLimitBytes: 8_192,
    payloadRetentionLimitBytes: 8_192,
    acceptedExitCodes: Object.freeze([0]),
  });
  const protectedAssetAuthority = createProtectedAssetReadLeaseAuthority({
    protectedRoots: Object.freeze([realpathSync(protectedRoot)]),
  });
  const configuredLocalCommandRunner =
    options.localCommandRunner ??
    (options.requireOperationalIsolation === false
      ? Object.freeze({
          run: () => Promise.reject(new Error('Profile-only fixture runner must not execute')),
        })
      : createLocalCommandVerificationRunner({
          workspaceLeases: workspace,
          ...(options.protectedVerification === true
            ? { protectedAssets: protectedAssetAuthority }
            : {}),
          isolation: createDarwinSeatbeltIsolation({
            runRootBase: runRoot,
            credentialRoots: [credentialRoot],
          }),
        }));
  let localVerificationCalls = 0;
  const localCommandVerification = Object.freeze({
    workspace,
    runner: Object.freeze({
      run: (request: Parameters<LocalCommandVerificationPort['run']>[0]) => {
        localVerificationCalls += 1;
        return configuredLocalCommandRunner.run(request);
      },
    }),
    profile: Object.freeze({
      forbiddenRoots,
      check: semanticCheck,
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
    ...(options.protectedVerification === true
      ? {
          protectedVerification: Object.freeze({
            identities: ids,
            proposal: Object.freeze({
              acceptanceCriticalCriterionIds: Object.freeze(
                goal.successCriteria
                  .filter(({ required }) => required)
                  .map(({ id }) => id)
                  .sort(),
              ),
              acceptanceRuleIds: Object.freeze(
                [...policyInstall.value.bundle.acceptanceRules].sort(),
              ),
              semanticCheckTemplate: Object.freeze({
                schemaVersion: 1 as const,
                checkVersion: semanticCheck.version,
                producerIdentity: semanticCheck.producerIdentity,
                operation: semanticCheck.operation,
                runnerIdentity: semanticCheck.runnerIdentity,
                runnerVersion: semanticCheck.runnerVersion,
                executablePath: semanticCheck.executablePath,
                executableDigest: semanticCheck.executableDigest,
                declaredToolVersion: semanticCheck.declaredToolVersion,
                argv: semanticCheck.argv,
                cwd: semanticCheck.cwd,
                environmentVariables: semanticCheck.environmentVariables,
                isolationProfileId: semanticCheck.isolationProfileId,
                isolationProfileDigest: semanticCheck.isolationProfileDigest,
                timeoutMilliseconds: semanticCheck.timeoutMilliseconds,
                terminationGraceMilliseconds: semanticCheck.terminationGraceMilliseconds,
                stdoutLimitBytes: semanticCheck.stdoutLimitBytes,
                stderrLimitBytes: semanticCheck.stderrLimitBytes,
                totalOutputLimitBytes: semanticCheck.totalOutputLimitBytes,
                payloadRetentionLimitBytes: semanticCheck.payloadRetentionLimitBytes,
                acceptedExitCodes: semanticCheck.acceptedExitCodes,
              }),
              protectedAssets: Object.freeze([protectedAsset]),
              protectedAssetManifestDigest: protectedVerificationAssetManifestDigest([
                protectedAsset,
              ]),
              protectedAssetReadLeasePolicy: 'EXACT_READ_ONLY_SINGLE_INVOCATION' as const,
              derivationRule: 'BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1' as const,
              authoritySource: 'TRUSTED_RUNTIME_COMPOSITION' as const,
            }),
            assets: protectedAssetAuthority,
          }),
        }
      : {}),
  });
  return Object.freeze({
    authorityRoot,
    clock,
    filename,
    generationRoots,
    getDispatchedRequests: () => Object.freeze([...dispatchedRequests]),
    getBootstrapVerificationCalls: () => bootstrapVerificationCalls,
    getLocalVerificationCalls: () => localVerificationCalls,
    goal,
    ids,
    policy: policyInstall.value.bundle,
    profile: profileInstall.value.profile,
    runtimeProfile,
    sourceRoot,
    ...(options.protectedVerification === true ? { protectedRoot } : {}),
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
    readonly recovery?: RecoveryCommandCapability;
    readonly resolvedProfile?: RuntimeExecutionProfile;
  } = {},
) {
  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm2-orchestration-context-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  });
  const dependencies = {
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
    recovery:
      options.recovery ??
      Object.freeze({
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
  };
  return startProfile.protectedVerification === undefined
    ? createM2WorkflowDriver(dependencies)
    : createProtectedM2WorkflowDriver(dependencies);
}

function withoutLocalCommandVerification(
  profile: RuntimeExecutionProfile,
): RuntimeExecutionProfile {
  const common = {
    profileId: profile.profileId,
    profileDigest: profile.profileDigest,
    driverVersion: profile.driverVersion,
    worker: profile.worker,
    candidateSource: profile.candidateSource,
    verification: profile.verification,
  };
  return profile.schemaVersion === 1
    ? Object.freeze({ schemaVersion: profile.schemaVersion, ...common })
    : Object.freeze({
        schemaVersion: profile.schemaVersion,
        ...common,
        externalWorker: profile.externalWorker,
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
  assert.equal(first.command.status, 'APPLIED', JSON.stringify(first));
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
  assert.equal(
    repaired.drive?.stopReason,
    WorkflowDriveStopReason.CLOSED,
    JSON.stringify(repaired),
  );

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

void test('[I-004][I-008][M2-E10][M2-E11][M2-E12][M2-E13][M2-E15][M2-F09] protected Oracle defeats Worker self-certification and the same Plan accepts the repair', async (t) => {
  const fixture = createFixture(t, { protectedVerification: true });
  const driver = orchestrationDriver(fixture);
  const startCommandId = commandId('command_m2-protected-self-certification-start');
  assert.equal(fixture.store.getAcceptanceCriticalVerificationPlan(fixture.workflow.id), undefined);

  const first = await driver.startGoal({
    commandId: startCommandId,
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: fixture.workflow.version,
  });
  assert.equal(first.command.status, 'APPLIED', JSON.stringify(first));
  assert.equal(
    first.drive?.stopReason,
    WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED,
    JSON.stringify(first),
  );
  assert.equal(fixture.getLocalVerificationCalls(), 1);

  const rejected = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(rejected?.acceptanceAuthority);
  assert.ok(rejected.candidateAuthority);
  assert.equal(rejected.acceptanceAuthority.decision.outcome, AcceptanceOutcome.REJECT_REPAIRABLE);
  assert.equal(rejected.closeout, undefined);
  const plan = fixture.store.getAcceptanceCriticalVerificationPlan(fixture.workflow.id);
  assert.ok(plan);
  assert.equal(rejected.acceptanceCriticalVerificationPlan?.planDigest, plan.planDigest);
  const planAudits = fixture.store.listAuditEvents(
    'ACCEPTANCE_CRITICAL_VERIFICATION_PLAN',
    plan.id,
  );
  assert.equal(planAudits.length, 1);
  const planAudit = planAudits[0];
  assert.ok(planAudit);
  assert.equal(planAudit.eventType, 'ACCEPTANCE_CRITICAL_VERIFICATION_PLAN_CREATED');
  assert.equal(planAudit.commandId, startCommandId);

  const generationOneRoot = fixture.generationRoots.get(1);
  assert.ok(generationOneRoot);
  execFileSync(process.execPath, [join(generationOneRoot, 'src', 'worker-test.mjs')], {
    cwd: generationOneRoot,
    stdio: 'ignore',
  });
  const firstEvidence = fixture.store
    .listEvidenceForGeneration(rejected.candidateAuthority.generation.id)
    .find(({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT);
  assert.ok(firstEvidence);
  assert.equal(firstEvidence.record.schemaVersion, 3);
  assert.equal(firstEvidence.record.resultStatus, EvidenceResultStatus.FAIL);
  assert.equal(firstEvidence.record.acceptanceCriticalVerificationPlanId, plan.id);
  assert.equal(firstEvidence.record.acceptanceCriticalVerificationPlanDigest, plan.planDigest);
  assert.equal(rejected.acceptanceAuthority.manifest.schemaVersion, 2);
  assert.equal(
    rejected.acceptanceAuthority.manifest.acceptanceCriticalVerificationPlanDigest,
    plan.planDigest,
  );

  for (const request of fixture.getDispatchedRequests()) {
    const manifest = fixture.store.getContextManifest(request.contextManifestId);
    assert.ok(manifest);
    assert.equal(request.contextPackage.schemaVersion, 4);
    assert.equal(manifest.schemaVersion, 4);
    assert.equal(request.contextPackage.acceptanceCriticalVerificationPlanId, plan.id);
    assert.equal(request.contextPackage.acceptanceCriticalVerificationPlanDigest, plan.planDigest);
    assert.equal(manifest.acceptanceCriticalVerificationPlanId, plan.id);
    assert.equal(manifest.acceptanceCriticalVerificationPlanDigest, plan.planDigest);
    const claim = fixture.store.getWorkerDispatchClaim(request.attemptId);
    assert.ok(claim);
    assert.equal(claim.contextManifestId, request.contextManifestId);
    assert.equal(claim.contextManifestDigest, request.contextManifestDigest);
  }

  const rejection = rejected.acceptanceAuthority;
  const repairRequest = Object.freeze({
    commandId: commandId('command_m2-protected-self-certification-repair'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: rejected.workflow.version,
    acceptanceDecisionId: rejection.decision.id,
    acceptanceDecisionDigest: rejection.decision.decisionDigest,
    inputManifestDigest: rejection.manifest.manifestDigest,
    candidateDigest: rejection.manifest.candidateDigest,
    reason: 'repair the implementation without replacing the protected Oracle',
  });
  const repaired = await driver.repairGoal(repairRequest);
  assert.equal(repaired.command.status, 'APPLIED');
  assert.equal(
    repaired.drive?.stopReason,
    WorkflowDriveStopReason.CLOSED,
    JSON.stringify(repaired),
  );
  assert.equal(fixture.getLocalVerificationCalls(), 2);

  const accepted = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(accepted?.acceptanceAuthority);
  assert.ok(accepted.candidateAuthority);
  assert.ok(accepted.closeout);
  assert.equal(accepted.acceptanceAuthority.decision.outcome, AcceptanceOutcome.ACCEPT);
  assert.deepEqual(fixture.store.getAcceptanceCriticalVerificationPlan(fixture.workflow.id), plan);
  const secondEvidence = fixture.store
    .listEvidenceForGeneration(accepted.candidateAuthority.generation.id)
    .find(({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT);
  assert.ok(secondEvidence);
  assert.equal(secondEvidence.record.schemaVersion, 3);
  assert.equal(secondEvidence.record.resultStatus, EvidenceResultStatus.PASS);
  assert.equal(secondEvidence.record.acceptanceCriticalVerificationPlanId, plan.id);
  assert.equal(secondEvidence.record.acceptanceCriticalVerificationPlanDigest, plan.planDigest);
  assert.notEqual(secondEvidence.record.checkSpec.id, firstEvidence.record.checkSpec.id);

  const replayedRepair = await driver.repairGoal(repairRequest);
  assert.equal(replayedRepair.command.status, 'REPLAYED');
  assert.ok(replayedRepair.drive);
  assert.equal(replayedRepair.drive.operationCount, 0);
  assert.equal(replayedRepair.drive.stopReason, WorkflowDriveStopReason.CLOSED);
  assert.equal(fixture.getLocalVerificationCalls(), 2);
  assert.deepEqual(fixture.store.getWorkflowDriverAuthority(fixture.goal.id), accepted);

  fixture.store.close();
  const reopened = openSqliteControlStore({ filename: fixture.filename });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getWorkflowDriverAuthority(fixture.goal.id), accepted);
  assert.deepEqual(reopened.getAcceptanceCriticalVerificationPlan(fixture.workflow.id), plan);
});

void test('[I-008][M2-E11] protected verification session admits one Runner invocation across concurrent and exact command replay', async (t) => {
  let releaseRunner: (() => void) | undefined;
  const runnerReleased = new Promise<void>((resolve) => {
    releaseRunner = resolve;
  });
  let markRunnerStarted: (() => void) | undefined;
  const runnerStarted = new Promise<void>((resolve) => {
    markRunnerStarted = resolve;
  });
  const fixture = createFixture(t, {
    protectedVerification: true,
    localCommandRunner: Object.freeze({
      run: async () => {
        markRunnerStarted?.();
        await runnerReleased;
        return localCommandObservation(1);
      },
    }),
  });
  const driver = orchestrationDriver(fixture);
  const startRequest = Object.freeze({
    commandId: commandId('command_m2-protected-single-consumer-start'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: fixture.workflow.version,
  });

  const firstRun = driver.startGoal(startRequest);
  await runnerStarted;
  assert.equal(fixture.getLocalVerificationCalls(), 1);

  const concurrentReplay = await driver.startGoal(startRequest);
  const current = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(current);
  const distinctStart = await driver.startGoal({
    ...startRequest,
    commandId: commandId('command_m2-protected-single-consumer-distinct-start'),
    expectedWorkflowVersion: current.workflow.version,
  });
  releaseRunner?.();

  const completed = await firstRun;
  assert.equal(completed.command.status, 'APPLIED');
  assert.equal(completed.drive?.stopReason, WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED);
  assert.equal(concurrentReplay.command.status, 'REPLAYED');
  assert.equal(concurrentReplay.drive?.stopReason, WorkflowDriveStopReason.ACTIVE_ATTEMPT);
  assert.equal(distinctStart.command.status, 'REJECTED');
  assert.equal(distinctStart.drive, undefined);
  assert.equal(fixture.getLocalVerificationCalls(), 1);

  const completedReplay = await driver.startGoal(startRequest);
  assert.equal(completedReplay.command.status, 'REPLAYED');
  assert.ok(completedReplay.drive);
  assert.equal(completedReplay.drive.operationCount, 0);
  assert.equal(
    completedReplay.drive.stopReason,
    WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED,
  );
  assert.equal(fixture.getLocalVerificationCalls(), 1);
  const authority = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(authority?.candidateAuthority);
  assert.equal(
    fixture.store
      .listEvidenceForGeneration(authority.candidateAuthority.generation.id)
      .filter(({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT).length,
    1,
  );
});

void test('[I-007][I-008][M2-E11] protected verification session remains consumed when Evidence admission rolls back', async (t) => {
  let failEvidenceCommit = false;
  const fixture = createFixture(t, {
    protectedVerification: true,
    localCommandRunner: Object.freeze({
      run: () => {
        failEvidenceCommit = true;
        return Promise.resolve(localCommandObservation(1));
      },
    }),
    transactionProbe: (step) => {
      if (failEvidenceCommit && step === CandidateEvidenceTransactionStep.AFTER_EVIDENCE_WRITE) {
        throw new Error('fault:protected-session-evidence-admission');
      }
    },
  });
  const driver = orchestrationDriver(fixture);
  const startRequest = Object.freeze({
    commandId: commandId('command_m2-protected-consumed-after-rollback-start'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: fixture.workflow.version,
  });

  const first = await driver.startGoal(startRequest);
  assert.equal(first.command.status, 'APPLIED');
  assert.equal(first.drive?.stopReason, WorkflowDriveStopReason.INTERNAL_COMMAND_REJECTED);
  assert.equal(first.drive.detailCode, 'COMMAND_COMMIT_FAILURE');
  assert.equal(fixture.getLocalVerificationCalls(), 1);
  const authorityAfterFailure = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(authorityAfterFailure?.candidateAuthority);
  assert.ok(authorityAfterFailure.latestPhaseAttempt);
  assert.equal(authorityAfterFailure.latestPhaseAttempt.status, 'RUNNING');
  assert.equal(
    fixture.store
      .listEvidenceForGeneration(authorityAfterFailure.candidateAuthority.generation.id)
      .filter(({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT).length,
    0,
  );

  failEvidenceCommit = false;
  const replay = await driver.startGoal(startRequest);
  assert.equal(replay.command.status, 'REPLAYED');
  assert.ok(replay.drive);
  assert.equal(replay.drive.operationCount, 0);
  assert.equal(replay.drive.stopReason, WorkflowDriveStopReason.ACTIVE_ATTEMPT);
  assert.equal(fixture.getLocalVerificationCalls(), 1);
  assert.deepEqual(
    fixture.store.getWorkflowDriverAuthority(fixture.goal.id),
    authorityAfterFailure,
  );

  fixture.store.close();
  const reopened = openSqliteControlStore({ filename: fixture.filename });
  t.after(() => reopened.close());
  const startupCatalog = reopened.getRecoveryCatalogForGoal(fixture.goal.id);
  assert.ok(startupCatalog);
  assert.equal(
    startupCatalog.continuityBarrier,
    RecoveryContinuityBarrier.LOCAL_COMMAND_VERIFICATION_SESSION_UNAVAILABLE,
  );

  const recoveryIds = new DeterministicIds('m2-protected-consumed-recovery');
  const inspector = new FakeRecoveryInspector([
    FakeRecoveryInspectionMode.EXACT,
    FakeRecoveryInspectionMode.EXACT,
  ]);
  const recovery = createRecoveryCoordinator({
    store: reopened,
    clock: fixture.clock,
    ids: recoveryIds,
    digests,
    policyBundleId: fixture.policy.id,
    policyBundleDigest: fixture.policy.digest,
    inspector,
    inspectorVersion: 'm2-protected-consumed-recovery-inspector-v1',
    recoveryPolicyVersion: 'm2-local-verification-fail-closed-v1',
  });
  const startup = recovery.recoverOnStartup();
  assert.equal(startup.scannedCount, 1);
  assert.equal(startup.reconciledCount, 1);
  const startupRecoveryId = startup.recoveryIds[0];
  assert.ok(startupRecoveryId);
  const startupRecord = reopened.getRecoveryReconciliation(startupRecoveryId);
  assert.ok(startupRecord);
  assert.equal(startupRecord.purpose, RecoveryReconciliationPurpose.STARTUP);
  assert.equal(startupRecord.disposition, RecoveryReconciliationDisposition.BLOCKED);
  assert.equal(
    startupRecord.reasonCode,
    RecoveryReasonCode.LOCAL_COMMAND_VERIFICATION_SESSION_UNAVAILABLE,
  );
  assert.equal(
    reopened.getAttempt(authorityAfterFailure.latestPhaseAttempt.id)?.status,
    AttemptStatus.INTERRUPTED,
  );
  const startupBlocked = reopened.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(startupBlocked);
  assert.equal(startupBlocked.workflow.runStatus, RunStatus.BLOCKED);
  assert.equal(startupBlocked.activeAttempt, undefined);
  assert.equal(fixture.getLocalVerificationCalls(), 1);

  const restartedFixture: OrchestrationFixture = Object.freeze({
    ...fixture,
    ids: new DeterministicIds('m2-protected-consumed-restarted-driver'),
    store: reopened,
  });
  const restartedDriver = orchestrationDriver(restartedFixture, fixture.runtimeProfile, {
    recovery,
  });
  const resumed = await restartedDriver.resumeGoal({
    commandId: commandId('command_m2-protected-consumed-resume'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: startupBlocked.workflow.version,
  });
  assert.equal(resumed.command.status, 'APPLIED');
  assert.equal(resumed.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);
  const resumeRecord = reopened.getLatestRecoveryReconciliation(fixture.workflow.id);
  assert.ok(resumeRecord);
  assert.equal(resumeRecord.purpose, RecoveryReconciliationPurpose.RESUME);
  assert.equal(resumeRecord.disposition, RecoveryReconciliationDisposition.BLOCKED);
  assert.equal(
    resumeRecord.reasonCode,
    RecoveryReasonCode.LOCAL_COMMAND_VERIFICATION_SESSION_UNAVAILABLE,
  );
  assert.equal(fixture.getLocalVerificationCalls(), 1);
  assert.equal(
    reopened
      .listEvidenceForGeneration(authorityAfterFailure.candidateAuthority.generation.id)
      .filter(({ record }) => record.kind === EvidenceKind.LOCAL_COMMAND_TEST_RESULT).length,
    0,
  );

  const resumedBlocked = reopened.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(resumedBlocked);
  assert.equal(resumedBlocked.workflow.runStatus, RunStatus.BLOCKED);
  const cancelled = restartedDriver.cancelGoal({
    commandId: commandId('command_m2-protected-consumed-cancel'),
    goalId: fixture.goal.id,
    expectedGoalRevision: fixture.goal.revision,
    expectedWorkflowVersion: resumedBlocked.workflow.version,
    reason: 'cancel the non-replayable local verification boundary',
  });
  assert.equal(cancelled.status, 'APPLIED');
  assert.equal(cancelled.output.runStatus, RunStatus.CANCELLED);
  assert.equal(fixture.getLocalVerificationCalls(), 1);
  const cancelledAuthority = reopened.getWorkflowDriverAuthority(fixture.goal.id);
  assert.ok(cancelledAuthority);
  assert.equal(cancelledAuthority.workflow.runStatus, RunStatus.CANCELLED);

  reopened.close();
  const finalReopen = openSqliteControlStore({ filename: fixture.filename });
  t.after(() => finalReopen.close());
  assert.deepEqual(finalReopen.getWorkflowDriverAuthority(fixture.goal.id), cancelledAuthority);
  assert.deepEqual(finalReopen.getLatestRecoveryReconciliation(fixture.workflow.id), resumeRecord);
});

for (const failureStep of [
  WorkerTransactionStep.AFTER_PROTECTED_VERIFICATION_PLAN_AUDIT_WRITE,
  WorkerTransactionStep.AFTER_PROTECTED_VERIFICATION_PLAN_WRITE,
] as const) {
  void test(`[I-007][M2-E10] protected first Start rolls back atomically at ${failureStep}`, async (t) => {
    const fixture = createFixture(t, {
      protectedVerification: true,
      requireOperationalIsolation: false,
      transactionProbe: (step) => {
        if (step === failureStep) {
          throw new Error(`fault:${failureStep}`);
        }
      },
    });
    const before = fixture.store.getWorkflowDriverAuthority(fixture.goal.id);
    const result = await orchestrationDriver(fixture).startGoal({
      commandId: commandId(
        `command_m2-protected-${failureStep.toLowerCase().replaceAll('_', '-')}`,
      ),
      goalId: fixture.goal.id,
      expectedGoalRevision: fixture.goal.revision,
      expectedWorkflowVersion: fixture.workflow.version,
    });

    assert.equal(result.command.status, 'REJECTED');
    assert.equal(result.command.output.ok, false);
    assert.equal(result.command.output.error.detailCode, 'COMMAND_COMMIT_FAILURE');
    assert.deepEqual(fixture.store.getWorkflowDriverAuthority(fixture.goal.id), before);
    assert.equal(
      fixture.store.getAcceptanceCriticalVerificationPlan(fixture.workflow.id),
      undefined,
    );
  });
}

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
