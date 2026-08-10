import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  GuardOutcome,
  IntakeInteractionAction,
  IntentProjectionField,
  ProtectedAssetProtectionMode,
  ProtectedAssetReadLeasePolicy,
  RunStatus,
  WorkflowPhase,
  auditEventId,
  commandId,
  createGoal,
  createWorkflow,
  executionProfileId,
  externalBackendCapabilityRecordProjection,
  goalId,
  goalRevision,
  isoTimestamp,
  protectedAssetManifestProjection,
  rawRequestRevision,
  requiredGuardsForTransition,
  successCriterionId,
  workflowId,
  type DeclaredProjectRef,
  type ExternalBackendCapabilityRecord,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakeCoordinator,
  M25IntakePackageCompiler,
  M25IntentAdmissionEngine,
  M25IntentProjectionCompiler,
  M251_REAL_CODEX_EXECUTION_PROFILE_ID,
  MinimalContextCompiler,
  ProjectReadSnapshotCleanupCoordinatorStatus,
  Rfc8785Canonicalizer,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  goalAndWorkflowCreationPayloadProjection,
  type IntakeAssistantPort,
  type IntakeStartCompositionPort,
  type IntentAnalysisAssistantResponseV1,
} from '@codeclosure/runtime';
import { createProjectReadSnapshotCleanupCoordinator } from '@codeclosure/runtime/composition';
import { WorkerTransactionStep, openSqliteControlStore } from '@codeclosure/store-sqlite';
import {
  DeterministicClock,
  DeterministicIds,
  FakeCandidateSource,
  FakeVerificationRunner,
  FakeWorker,
  FakeWorkerFixture,
} from '@codeclosure/testing';
import { createLocalProjectReadWorkspace } from '@codeclosure/workspace-local';
import {
  WorkflowRuntimeKernel,
  isRuntimeOwnedPhaseGuard,
  type AttemptContextCompilationRequest,
  type PhaseGuardEvaluationRequest,
} from '@codeclosure/runtime/testing/workflow-runtime';

import {
  M251_DRIVER_VERSION,
  createM251RuntimeProfileRegistry,
  installM251ExecutionAuthority,
  type InstallM251ExecutionAuthorityInput,
  type M251RuntimeProfileCapabilities,
} from '../dist/composition/m251-execution-authority.js';

const digests = new CanonicalJsonSha256DigestProvider();
const canonicalizer = new Rfc8785Canonicalizer();
const fixedTime = isoTimestamp('2026-08-10T08:00:00.000Z');

const clearIntentResponse: IntentAnalysisAssistantResponseV1 = Object.freeze({
  proposedObjective: 'Ship slice 4',
  proposedCriteria: Object.freeze(['Ship slice 4']),
  proposedNonGoals: Object.freeze([]),
  proposedAssumptions: Object.freeze([]),
  proposedQuestions: Object.freeze([]),
  candidateSourceSpanSuggestions: Object.freeze([
    Object.freeze({
      projectionFieldRef: IntentProjectionField.OBJECTIVE,
      rawRequestRevision: rawRequestRevision(1),
      startByte: 0,
      endByte: 12,
    }),
    Object.freeze({
      projectionFieldRef: IntentProjectionField.REQUIRED_CRITERION,
      itemIndex: 0,
      rawRequestRevision: rawRequestRevision(1),
      startByte: 0,
      endByte: 12,
    }),
  ]),
});

const materializationAssistant: IntakeAssistantPort = Object.freeze({
  analyze: () =>
    Promise.resolve({
      kind: 'COMPLETED' as const,
      response: clearIntentResponse,
      observation: Object.freeze({
        schemaVersion: 1 as const,
        operation: 'INTENT_ANALYSIS' as const,
        state: 'COMPLETED' as const,
        processLaunchCount: 1,
        threadStartCount: 1,
        turnStartCount: 1,
        turnInterruptCount: 0,
        compactionCount: 0,
      }),
    }),
  answer: () => Promise.reject(new Error('B1 formal materialization must not request an answer')),
});

function temporaryDatabase(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-m251-b1-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'authority.sqlite');
}

function initializeProjectReadSource(sourceRoot: string): void {
  mkdirSync(join(sourceRoot, 'src'), { recursive: true });
  writeFileSync(join(sourceRoot, 'README.md'), '# B2 project-read fixture\n');
  writeFileSync(join(sourceRoot, 'src', 'payment.ts'), 'export const idempotent = true;\n');
  const runGit = (arguments_: readonly string[]): void => {
    execFileSync('git', arguments_, {
      cwd: sourceRoot,
      env: {
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      },
      stdio: 'ignore',
    });
  };
  runGit(['init', '--quiet']);
  runGit(['config', 'user.name', 'CodeClosure Test']);
  runGit(['config', 'user.email', 'codeclosure@example.invalid']);
  runGit(['add', '.']);
  runGit(['commit', '--quiet', '-m', 'fixture']);
}

function removeProjectReadFixtureRoot(root: string): void {
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
      pending.push(...readdirSync(current).map((name) => join(current, name)));
    } else if (stat.isFile()) {
      chmodSync(current, 0o600);
    }
  }
  rmSync(root, { recursive: true, force: true });
}

function project(path: string): DeclaredProjectRef {
  return Object.freeze({
    schemaVersion: 1,
    normalizedPath: path,
    identityDigest: digests.digest({ normalizedPath: path }),
  });
}

function disabledStartComposition(
  store: ReturnType<typeof openSqliteControlStore>,
): IntakeStartCompositionPort {
  return Object.freeze({
    startGoal: () => {
      throw new Error('B1 intentionally leaves Driver Profile v3 dispatch disabled');
    },
    getProcessedCommand: (
      identifier: Parameters<IntakeStartCompositionPort['getProcessedCommand']>[0],
    ) => store.getProcessedCommand(identifier),
    getWorkflow: (identifier: Parameters<IntakeStartCompositionPort['getWorkflow']>[0]) =>
      store.getWorkflow(identifier),
    getExecutionProfileBinding: (
      identifier: Parameters<IntakeStartCompositionPort['getExecutionProfileBinding']>[0],
    ) => store.getExecutionProfileBinding(identifier),
    getWorkflowPolicyBinding: (
      identifier: Parameters<IntakeStartCompositionPort['getWorkflowPolicyBinding']>[0],
    ) => store.getWorkflowPolicyBinding(identifier),
  });
}

function capability(namespace: string): ExternalBackendCapabilityRecord {
  const selected = Object.freeze(
    [
      ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
      ExternalBackendCapability.FRESH_SESSION,
      ExternalBackendCapability.OPERATION_INTERRUPT,
      ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
    ].toSorted(),
  );
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    backendKind: 'CODEX_APP_SERVER',
    binaryIdentityDigest: digests.digest({ namespace, kind: 'binary' }),
    protocolSchemaDigest: digests.digest({ namespace, kind: 'protocol' }),
    configurationProfileDigest: digests.digest({ namespace, kind: 'configuration' }),
    capabilityEntries: Object.freeze(
      selected.map((entry) =>
        Object.freeze({
          capability: entry,
          classification: ExternalBackendCapabilityClassification.SUPPORTED,
          proofKind: 'DETERMINISTIC_M251_B1_TRUSTED_COMPOSITION',
        }),
      ),
    ),
    observedAt: fixedTime,
  });
  return Object.freeze({
    ...withoutDigest,
    recordDigest: digests.digest(externalBackendCapabilityRecordProjection(withoutDigest)),
  });
}

function authorityInput(
  store: ReturnType<typeof openSqliteControlStore>,
  namespace: string,
  roots?: Readonly<{
    readonly sourceRoot: string;
    readonly projectReadRoot: string;
    readonly authorityRoot: string;
  }>,
): InstallM251ExecutionAuthorityInput {
  const controlledStateRootIdentity =
    roots === undefined
      ? `/authority/${namespace}/codex-state`
      : join(roots.authorityRoot, 'codex-state');
  return Object.freeze({
    store,
    clock: Object.freeze({ now: () => fixedTime }),
    ids: new DeterministicIds(namespace),
    digests,
    capabilityRecord: capability(namespace),
    managedRequirementsDigest: digests.digest({ namespace, kind: 'managed-requirements' }),
    controlledStateRootIdentity,
    environmentProjectionDigest: digests.digest({ namespace, kind: 'environment' }),
    model: 'gpt-fixture',
    modelProvider: 'openai',
    serviceTier: null,
    reasoningEffort: 'low',
    phaseAuthorities: Object.freeze(
      [WorkflowPhase.DISCOVERY, WorkflowPhase.IMPLEMENT, WorkflowPhase.PLAN].map((phase) =>
        Object.freeze({
          phase,
          permissionProfileId: `permission-${phase.toLowerCase()}-v1`,
          permissionProfileDigest: digests.digest({ namespace, phase, kind: 'permission' }),
          executionConfigDigest: digests.digest({ namespace, phase, kind: 'execution-config' }),
          instructionSourceManifestId: `instructions-${phase.toLowerCase()}-v1`,
          instructionSources: Object.freeze([]),
          allowedRoots: Object.freeze([
            roots !== undefined && phase !== WorkflowPhase.IMPLEMENT
              ? roots.projectReadRoot
              : `/authority/${namespace}/workspaces/${phase.toLowerCase()}`,
          ]),
          forbiddenRoots: Object.freeze(
            [
              controlledStateRootIdentity,
              ...(roots === undefined
                ? [`/authority/${namespace}/runtime`]
                : [roots.authorityRoot]),
              roots?.sourceRoot ?? `/source/${namespace}`,
            ].toSorted(),
          ),
        }),
      ),
    ),
  });
}

function runtimeCapabilities(
  namespace: string,
  criterionId = successCriterionId('criterion_m251-b1'),
): M251RuntimeProfileCapabilities {
  const checkDigest = digests.digest({ namespace, kind: 'check' });
  const isolationDigest = digests.digest({ namespace, kind: 'verification-isolation' });
  const semanticCheck = Object.freeze({
    schemaVersion: 1 as const,
    checkVersion: 'm251-b1-check-v1',
    producerIdentity: 'protected-local-verification',
    operation: 'local-command.execute',
    runnerIdentity: 'protected-local-verification',
    runnerVersion: 'v1',
    executablePath: '/protected/m251/check',
    executableDigest: checkDigest,
    declaredToolVersion: 'fixture-v1',
    argv: Object.freeze(['--check']),
    cwd: '.',
    environmentVariables: Object.freeze([]),
    isolationProfileId: 'm251-b1-verification-isolation',
    isolationProfileDigest: isolationDigest,
    timeoutMilliseconds: 1_000,
    terminationGraceMilliseconds: 100,
    stdoutLimitBytes: 1_024,
    stderrLimitBytes: 1_024,
    totalOutputLimitBytes: 2_048,
    payloadRetentionLimitBytes: 2_048,
    acceptedExitCodes: Object.freeze([0]),
  });
  const asset = Object.freeze({
    logicalAssetId: 'm251-b1-check',
    registeredProtectedRootIdentity: '/protected/m251',
    exactRealpath: '/protected/m251/check',
    executionPath: '/protected/m251/check',
    fileMode: 0o500,
    byteLength: 1,
    contentDigest: checkDigest,
    protectionMode: ProtectedAssetProtectionMode.OUTSIDE_WORKER_WRITABLE_CANDIDATE,
  });
  const workspace = Object.freeze({
    issueLease: () => {
      throw new Error('B1 must not issue a Candidate workspace lease');
    },
    releaseLease: () => undefined,
    assertLeaseCurrent: <Value>(lease: Value): Value => lease,
  });
  return Object.freeze({
    worker: new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
    candidateSource: new FakeCandidateSource(),
    verification: new FakeVerificationRunner(),
    externalWorker: Object.freeze({
      prepare: () => Promise.reject(new Error('B1 must not invoke Codex')),
    }),
    localCommandVerification: Object.freeze({
      workspace,
      runner: Object.freeze({
        run: () => Promise.reject(new Error('B1 must not run verification')),
      }),
      profile: Object.freeze({
        forbiddenRoots: Object.freeze(['/authority/m251-b1']),
        check: Object.freeze({
          version: semanticCheck.checkVersion,
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
      }),
    }),
    protectedVerification: Object.freeze({
      identities: new DeterministicIds(`${namespace}-protected`),
      proposal: Object.freeze({
        acceptanceCriticalCriterionIds: Object.freeze([criterionId]),
        acceptanceRuleIds: Object.freeze(['required-criteria-evidence']),
        semanticCheckTemplate: semanticCheck,
        protectedAssets: Object.freeze([asset]),
        protectedAssetManifestDigest: digests.digest(protectedAssetManifestProjection([asset])),
        protectedAssetReadLeasePolicy:
          ProtectedAssetReadLeasePolicy.EXACT_READ_ONLY_SINGLE_INVOCATION,
        derivationRule: 'BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1',
        authoritySource: 'TRUSTED_RUNTIME_COMPOSITION',
      }),
      assets: Object.freeze({
        assertLeaseCurrent: <Value>(lease: Value): Value => lease,
      }),
    }),
  });
}

void test('[M251-B1] trusted-real-profile-installation installs and strictly reopens the exact formal authority', (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename });
  const installed = installM251ExecutionAuthority(authorityInput(store, 'm251-b1-install'));
  assert.equal(installed.profile.profile.schemaVersion, 2);
  assert.equal(installed.profile.profile.id, M251_REAL_CODEX_EXECUTION_PROFILE_ID);
  assert.equal(installed.profile.profile.externalExecution.schemaVersion, 3);
  assert.deepEqual(installed.profile.profile.externalExecution.workerPhases, [
    WorkflowPhase.DISCOVERY,
    WorkflowPhase.IMPLEMENT,
    WorkflowPhase.PLAN,
  ]);
  assert.equal(
    installed.governedExecutionPreflight.executionProfileDigest,
    installed.profile.profile.digest,
  );
  store.close();

  const reopened = openSqliteControlStore({ filename });
  t.after(() => reopened.close());
  const replayed = installM251ExecutionAuthority(authorityInput(reopened, 'm251-b1-install'));
  assert.equal(replayed.policy.bundle.digest, installed.policy.bundle.digest);
  assert.equal(replayed.capability.recordDigest, installed.capability.recordDigest);
  assert.equal(replayed.profile.profile.digest, installed.profile.profile.digest);
});

void test('[M251-B1] formal-profile-materialization-binding carries the production installer tuple into Start Authorization', async (t) => {
  const store = openSqliteControlStore({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const namespace = 'm251-b1-formal-materialization';
  const authority = installM251ExecutionAuthority(authorityInput(store, namespace));
  assert.equal(authority.profile.profile.driverVersion, M251_DRIVER_VERSION);
  const admissionPolicy = createM25AdmissionPolicy(
    createM25LocalAdmissionPolicyDefinition(),
    digests,
  );
  const installedAdmission = store.installIntentAdmissionPolicy({
    policy: admissionPolicy,
    installedAt: fixedTime,
    auditEventId: auditEventId(`audit_${namespace}-admission-policy`),
    payloadDigest: admissionPolicy.digest,
  });
  assert.equal(installedAdmission.status, 'INSTALLED');
  const startComposition = disabledStartComposition(store);
  const intake = new M25IntakeCoordinator({
    store,
    assistant: materializationAssistant,
    packageCompiler: new M25IntakePackageCompiler({ canonicalizer, digests }),
    projectionCompiler: new M25IntentProjectionCompiler({ canonicalizer, digests }),
    admissionEngine: new M25IntentAdmissionEngine(digests, {
      governedExecutionPreflight: authority.governedExecutionPreflight,
    }),
    admissionPolicyId: admissionPolicy.id,
    governedExecutionPreflight: authority.governedExecutionPreflight,
    startComposition,
    clock: new DeterministicClock([
      '2026-08-10T08:00:01.000Z',
      '2026-08-10T08:00:02.000Z',
      '2026-08-10T08:00:03.000Z',
    ]),
    digests,
    ids: new DeterministicIds(`${namespace}-intake`),
  });
  const result = await intake.submit({
    commandId: commandId(`command_${namespace}`),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project(`/fixture/${namespace}`),
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.result.kind, 'MATERIALIZED');
  assert.equal(result.startDisposition, 'START_INFRASTRUCTURE_FAILURE');
  const retained = store.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(retained?.materialization);
  assert.ok(retained.startAuthorization);
  assert.deepEqual(
    {
      workflowPolicyId: retained.startAuthorization.policyBundleId,
      workflowPolicyDigest: retained.startAuthorization.policyBundleDigest,
      executionProfileId: retained.startAuthorization.executionProfileId,
      executionProfileDigest: retained.startAuthorization.executionProfileDigest,
    },
    {
      workflowPolicyId: authority.governedExecutionPreflight.workflowPolicyId,
      workflowPolicyDigest: authority.governedExecutionPreflight.workflowPolicyDigest,
      executionProfileId: authority.governedExecutionPreflight.executionProfileId,
      executionProfileDigest: authority.governedExecutionPreflight.executionProfileDigest,
    },
  );
  assert.equal(store.getWorkflow(retained.materialization.workflowId)?.runStatus, RunStatus.READY);
  assert.equal(store.nextAttemptSequence(retained.materialization.workflowId), 1);
  assert.equal(store.getWorkflowPolicyBinding(retained.materialization.workflowId), undefined);
  assert.equal(store.getExecutionProfileBinding(retained.materialization.workflowId), undefined);
});

void test('[M251-B1] governed-preflight rejects fake, stale, and substituted authority selection', (t) => {
  const store = openSqliteControlStore({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const authority = installM251ExecutionAuthority(authorityInput(store, 'm251-b1-preflight'));
  assert.doesNotThrow(
    () =>
      new M25IntentAdmissionEngine(digests, {
        governedExecutionPreflight: authority.governedExecutionPreflight,
      }),
  );
  for (const governedExecutionPreflight of [
    {
      ...authority.governedExecutionPreflight,
      executionProfileId: executionProfileId('profile_m1-happy-path'),
    },
    {
      ...authority.governedExecutionPreflight,
      executionProfileVersion: 'stale-profile-v0',
    },
    {
      ...authority.governedExecutionPreflight,
      workflowPolicyVersion: 'caller-selected-policy-v0',
    },
    {
      ...authority.governedExecutionPreflight,
      executionProfileId: executionProfileId('profile_model-proposed-v0'),
    },
  ]) {
    assert.throws(
      () => new M25IntentAdmissionEngine(digests, { governedExecutionPreflight }),
      /unsupported authority tuple/,
    );
  }
});

void test('[M251-B1] ordinary-start-profile-resolution foundation resolves only the installed exact Runtime Profile', (t) => {
  const store = openSqliteControlStore({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const authority = installM251ExecutionAuthority(authorityInput(store, 'm251-b1-resolution'));
  const registry = createM251RuntimeProfileRegistry(
    authority.profile,
    runtimeCapabilities('m251-b1-resolution'),
    digests,
  );
  assert.equal(registry.resolver.resolve(authority.profile.profile), registry.startProfile);
});

void test('[M251-C05] profile-substitution-and-absence fail before an in-process capability can be resolved', (t) => {
  const store = openSqliteControlStore({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const authority = installM251ExecutionAuthority(authorityInput(store, 'm251-b1-substitution'));
  const registry = createM251RuntimeProfileRegistry(
    authority.profile,
    runtimeCapabilities('m251-b1-substitution'),
    digests,
  );
  assert.throws(
    () =>
      registry.resolver.resolve({
        ...authority.profile.profile,
        driverVersion: 'substituted-driver-v0',
      }),
    /no exact trusted M2\.5\.1 capability binding/,
  );
  assert.throws(
    () =>
      registry.resolver.resolve({
        ...authority.profile.profile,
        digest: digests.digest({ kind: 'substituted-profile-digest' }),
      }),
    /no exact trusted M2\.5\.1 capability binding/,
  );
  assert.throws(
    () =>
      registry.resolver.resolve({
        ...authority.profile.profile,
        id: executionProfileId('profile_missing-m251'),
      }),
    /no exact trusted M2\.5\.1 capability binding/,
  );
  assert.throws(
    () =>
      createM251RuntimeProfileRegistry(
        {
          ...authority.profile,
          profile: {
            ...authority.profile.profile,
            id: executionProfileId('profile_missing-m251'),
          },
        },
        runtimeCapabilities('m251-b1-missing'),
        digests,
      ),
    /do not bind formal authority/,
  );
});

void test('[M251-C08][B2] Runtime atomically binds exact ProjectRead and Context v5 for DISCOVERY and PLAN', (t) => {
  const namespace = 'm251-b2-runtime-project-read';
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m251-b2-')));
  t.after(() => removeProjectReadFixtureRoot(root));
  const authorityRoot = join(root, 'authority');
  const sourceRoot = join(root, 'source');
  const projectReadRoot = join(root, 'project-read');
  mkdirSync(authorityRoot);
  mkdirSync(join(authorityRoot, 'codex-state'));
  mkdirSync(sourceRoot);
  initializeProjectReadSource(sourceRoot);
  const filename = join(authorityRoot, 'state.sqlite');
  let failContextCommit = false;
  const store = openSqliteControlStore({
    filename,
    now: () => fixedTime,
    transactionProbe: (step) => {
      if (failContextCommit && step === WorkerTransactionStep.AFTER_CONTEXT_MANIFEST_WRITE) {
        throw new Error('M251_B2_INJECTED_CONTEXT_COMMIT_FAILURE');
      }
    },
  });
  const ids = new DeterministicIds(`${namespace}-runtime`);
  const authority = installM251ExecutionAuthority(
    authorityInput(store, namespace, { sourceRoot, projectReadRoot, authorityRoot }),
  );
  const criterionId = successCriterionId(`criterion_${namespace}`);
  const goal = createGoal({
    id: goalId(`goal_${namespace}`),
    revision: goalRevision(1),
    objective: 'Inspect and plan an idempotent payment change',
    successCriteria: Object.freeze([
      Object.freeze({
        id: criterionId,
        description: 'Produce a source-bound plan',
        required: true,
      }),
    ]),
    scope: Object.freeze({
      projectPath: sourceRoot,
      allowedPaths: Object.freeze(['src/payment.ts']),
    }),
    nonGoals: Object.freeze(['Do not create a Candidate before IMPLEMENT']),
    createdAt: fixedTime,
  });
  const workflow = createWorkflow({
    id: workflowId(`workflow_${namespace}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt: fixedTime,
  });
  assert.equal(
    store.createGoalWithWorkflow({
      commandId: ids.nextCommandId(),
      inputDigest: digests.digest({ schemaVersion: 1, operation: 'CREATE', namespace }),
      goal,
      workflow,
      auditEventId: ids.nextAuditEventId(),
      workflowAuditEventId: ids.nextAuditEventId(),
      payloadDigest: digests.digest(goalAndWorkflowCreationPayloadProjection(goal, workflow)),
    }).status,
    'APPLIED',
  );
  const capabilities = runtimeCapabilities(namespace, criterionId);
  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm2.5.1-b2-context-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer,
    digests,
  });
  let failContextCompilation = true;
  const workspace = createLocalProjectReadWorkspace({
    authorityRoots: Object.freeze([authorityRoot]),
    ownerId: `project-read-owner_${namespace}`,
    workspaceRoot: projectReadRoot,
  });
  let corruptMaterializationReceipt = true;
  let leaveNextCleanupUnresolved = false;
  const projectReadWorkspace = Object.freeze({
    workspaceRootIdentity: workspace.workspaceRootIdentity,
    snapshotLeafFor: (snapshotId: string) => workspace.snapshotLeafFor(snapshotId),
    observeSource: (request: Parameters<typeof workspace.observeSource>[0]) =>
      workspace.observeSource(request),
    materializeSnapshot: (record: Parameters<typeof workspace.materializeSnapshot>[0]) => {
      const receipt = workspace.materializeSnapshot(record);
      return corruptMaterializationReceipt
        ? Object.freeze({
            ...receipt,
            receiptDigest: digests.digest({ kind: 'M251_B2_SUBSTITUTED_RECEIPT' }),
          })
        : receipt;
    },
    reconcile: (snapshot: Parameters<typeof workspace.reconcile>[0]) =>
      workspace.reconcile(snapshot),
    cleanupSnapshot: (grant: Parameters<typeof workspace.cleanupSnapshot>[0]) => {
      if (leaveNextCleanupUnresolved) {
        leaveNextCleanupUnresolved = false;
        return null;
      }
      return workspace.cleanupSnapshot(grant);
    },
  });
  const projectReadAuthorityIds: ReturnType<typeof ids.nextProjectSourceReadAuthorityId>[] = [];
  const projectReadSnapshotIds: ReturnType<typeof ids.nextProjectReadSnapshotId>[] = [];
  const projectReadCleanupGrantIds: ReturnType<typeof ids.nextProjectReadSnapshotCleanupGrantId>[] =
    [];
  const projectReadIdentities = Object.freeze({
    nextProjectSourceReadAuthorityId: () => {
      const id = ids.nextProjectSourceReadAuthorityId();
      projectReadAuthorityIds.push(id);
      return id;
    },
    nextProjectReadSnapshotId: () => {
      const id = ids.nextProjectReadSnapshotId();
      projectReadSnapshotIds.push(id);
      return id;
    },
    nextProjectReadWorkspaceAuthoritySnapshotId: () =>
      ids.nextProjectReadWorkspaceAuthoritySnapshotId(),
    nextProjectReadSnapshotCleanupGrantId: () => {
      const id = ids.nextProjectReadSnapshotCleanupGrantId();
      projectReadCleanupGrantIds.push(id);
      return id;
    },
    nextProjectReadSnapshotCleanupOutcomeId: () => ids.nextProjectReadSnapshotCleanupOutcomeId(),
    nextAuditEventId: () => ids.nextAuditEventId(),
  });
  let rejectNextContextCommitWithVersionConflict = false;
  let rejectNextCleanupGrantResolution = false;
  let hideNextCleanupGrantRead = false;
  let cleanupGrantReadCount = 0;
  const runtimeStore = new Proxy(store, {
    get: (target, property) => {
      if (property === 'commitContextBoundAttemptStart') {
        return (
          input: Parameters<typeof store.commitContextBoundAttemptStart>[0],
        ): ReturnType<typeof store.commitContextBoundAttemptStart> => {
          if (rejectNextContextCommitWithVersionConflict) {
            rejectNextContextCommitWithVersionConflict = false;
            return Object.freeze({
              status: 'VERSION_CONFLICT' as const,
              message: 'M251_B2_INJECTED_CONTEXT_COMMIT_VERSION_CONFLICT',
            });
          }
          return target.commitContextBoundAttemptStart(input);
        };
      }
      if (property === 'issueProjectReadSnapshotCleanupGrant') {
        return (
          input: Parameters<typeof store.issueProjectReadSnapshotCleanupGrant>[0],
        ): ReturnType<typeof store.issueProjectReadSnapshotCleanupGrant> => {
          const result = target.issueProjectReadSnapshotCleanupGrant(input);
          if (rejectNextCleanupGrantResolution) {
            rejectNextCleanupGrantResolution = false;
            hideNextCleanupGrantRead = true;
          }
          return result;
        };
      }
      if (property === 'getProjectReadSnapshotCleanupGrant') {
        return (
          grantId: Parameters<typeof store.getProjectReadSnapshotCleanupGrant>[0],
        ): ReturnType<typeof store.getProjectReadSnapshotCleanupGrant> => {
          cleanupGrantReadCount += 1;
          if (hideNextCleanupGrantRead) {
            hideNextCleanupGrantRead = false;
            return undefined;
          }
          return target.getProjectReadSnapshotCleanupGrant(grantId);
        };
      }
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== 'function') {
        return value;
      }
      return (...arguments_: readonly unknown[]): unknown => {
        const result: unknown = Reflect.apply(value, target, arguments_);
        return result;
      };
    },
  });
  const kernel = new WorkflowRuntimeKernel({
    store: runtimeStore,
    clock: Object.freeze({ now: () => fixedTime }),
    ids,
    digests,
    phaseGuards: Object.freeze({
      evaluate: ({ workflow: current, requestedPhase }: PhaseGuardEvaluationRequest) =>
        Object.freeze(
          (requiredGuardsForTransition(current.phase, requestedPhase) ?? [])
            .filter((guard) => !isRuntimeOwnedPhaseGuard(guard))
            .map((guard) =>
              Object.freeze({
                guard,
                outcome: GuardOutcome.PASS,
                reasonCode: 'M251_B2_FIXTURE_GUARD',
                supportingRefs: Object.freeze([`fixture:${guard}`]),
              }),
            ),
        ),
    }),
    workerContext: Object.freeze({
      identities: ids,
      factory: Object.freeze({
        compile: (request: AttemptContextCompilationRequest) => {
          if (failContextCompilation) {
            throw new Error('M251_B2_INJECTED_CONTEXT_COMPILATION_FAILURE');
          }
          return compiler.compile(request);
        },
      }),
      executionProfileId: authority.profile.profile.id,
      executionProfileDigest: authority.profile.profile.digest,
      policyBundleId: authority.policy.bundle.id,
      policyBundleDigest: authority.policy.bundle.digest,
    }),
    candidateEvidence: Object.freeze({
      identities: ids,
      candidateSource: capabilities.candidateSource,
      verification: capabilities.verification,
      policyBundleId: authority.policy.bundle.id,
      policyBundleDigest: authority.policy.bundle.digest,
    }),
    localCommandVerification: capabilities.localCommandVerification,
    acceptance: Object.freeze({
      identities: ids,
      policyBundleId: authority.policy.bundle.id,
      policyBundleDigest: authority.policy.bundle.digest,
    }),
    protectedVerification: Object.freeze({
      ...capabilities.protectedVerification,
      proposal: Object.freeze({
        ...capabilities.protectedVerification.proposal,
        acceptanceRuleIds: authority.policy.bundle.acceptanceRules,
      }),
    }),
    projectRead: Object.freeze({
      workspace: projectReadWorkspace,
      identities: projectReadIdentities,
    }),
  });

  const compilationFailureStart = kernel.startGoal({
    commandId: ids.nextCommandId(),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(compilationFailureStart.status, 'REJECTED');
  const compilationFailureAuthorityId = projectReadAuthorityIds.at(-1);
  const compilationFailureSnapshotId = projectReadSnapshotIds.at(-1);
  const compilationFailureGrantId = projectReadCleanupGrantIds.at(-1);
  assert.ok(compilationFailureAuthorityId);
  assert.ok(compilationFailureSnapshotId);
  assert.ok(compilationFailureGrantId);
  assert.equal(store.getProjectSourceReadAuthority(compilationFailureAuthorityId), undefined);
  assert.equal(store.getProjectReadSnapshotCleanupGrant(compilationFailureGrantId), undefined);
  assert.equal(existsSync(workspace.snapshotLeafFor(compilationFailureSnapshotId)), false);
  assert.deepEqual(store.getWorkflow(workflow.id), workflow);
  failContextCompilation = false;

  leaveNextCleanupUnresolved = true;
  const invalidReceiptStart = kernel.startGoal({
    commandId: ids.nextCommandId(),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(invalidReceiptStart.status, 'REJECTED');
  assert.equal(invalidReceiptStart.output.error.detailCode, 'COMMAND_PLANNING_FAILURE');
  const invalidReceiptAuthorityId = projectReadAuthorityIds.at(-1);
  const invalidReceiptSnapshotId = projectReadSnapshotIds.at(-1);
  const invalidReceiptGrantId = projectReadCleanupGrantIds.at(-1);
  assert.ok(invalidReceiptAuthorityId);
  assert.ok(invalidReceiptSnapshotId);
  assert.ok(invalidReceiptGrantId);
  assert.equal(store.getProjectSourceReadAuthority(invalidReceiptAuthorityId), undefined);
  const unresolvedGrant = store.getProjectReadSnapshotCleanupGrant(invalidReceiptGrantId);
  assert.ok(unresolvedGrant);
  assert.equal(store.getProjectReadSnapshotCleanupOutcome(invalidReceiptGrantId), undefined);
  assert.equal(existsSync(workspace.snapshotLeafFor(invalidReceiptSnapshotId)), true);
  assert.deepEqual(store.getWorkflow(workflow.id), workflow);
  const resolvedUnresolvedCleanup = createProjectReadSnapshotCleanupCoordinator({
    store,
    workspace,
    clock: Object.freeze({ now: () => fixedTime }),
    ids: projectReadIdentities,
    digests,
  }).resolve({ grant: unresolvedGrant });
  assert.equal(
    resolvedUnresolvedCleanup.status,
    ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED,
  );
  assert.equal(
    store.getProjectReadSnapshotCleanupGrant(invalidReceiptGrantId)?.id,
    invalidReceiptGrantId,
  );
  assert.ok(store.getProjectReadSnapshotCleanupOutcome(invalidReceiptGrantId));
  assert.equal(existsSync(workspace.snapshotLeafFor(invalidReceiptSnapshotId)), false);

  rejectNextCleanupGrantResolution = true;
  const rejectedCleanupStart = kernel.startGoal({
    commandId: ids.nextCommandId(),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(rejectedCleanupStart.status, 'REJECTED');
  assert.equal(
    rejectedCleanupStart.output.error.detailCode,
    'PROJECT_READ_ORPHAN_RECONCILIATION_FAILURE',
  );
  const rejectedCleanupAuthorityId = projectReadAuthorityIds.at(-1);
  const rejectedCleanupSnapshotId = projectReadSnapshotIds.at(-1);
  const rejectedCleanupGrantId = projectReadCleanupGrantIds.at(-1);
  assert.ok(rejectedCleanupAuthorityId);
  assert.ok(rejectedCleanupSnapshotId);
  assert.ok(rejectedCleanupGrantId);
  assert.equal(store.getProjectSourceReadAuthority(rejectedCleanupAuthorityId), undefined);
  const retainedRejectedGrant = store.getProjectReadSnapshotCleanupGrant(rejectedCleanupGrantId);
  assert.ok(retainedRejectedGrant);
  assert.equal(store.getProjectReadSnapshotCleanupOutcome(rejectedCleanupGrantId), undefined);
  assert.equal(existsSync(workspace.snapshotLeafFor(rejectedCleanupSnapshotId)), true);
  const recoveredCleanup = createProjectReadSnapshotCleanupCoordinator({
    store,
    workspace,
    clock: Object.freeze({ now: () => fixedTime }),
    ids: projectReadIdentities,
    digests,
  }).resolve({ grant: retainedRejectedGrant });
  assert.equal(recoveredCleanup.status, ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED);
  assert.equal(
    store.getProjectReadSnapshotCleanupGrant(rejectedCleanupGrantId)?.id,
    rejectedCleanupGrantId,
  );
  assert.ok(store.getProjectReadSnapshotCleanupOutcome(rejectedCleanupGrantId));
  assert.equal(existsSync(workspace.snapshotLeafFor(rejectedCleanupSnapshotId)), false);
  corruptMaterializationReceipt = false;

  const rejectedCommitCleanupIndex = projectReadAuthorityIds.length;
  cleanupGrantReadCount = 0;
  rejectNextContextCommitWithVersionConflict = true;
  rejectNextCleanupGrantResolution = true;
  const rejectedCommitCleanupStart = kernel.startGoal({
    commandId: ids.nextCommandId(),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(rejectedCommitCleanupStart.status, 'REJECTED');
  assert.equal(
    rejectedCommitCleanupStart.output.error.detailCode,
    'PROJECT_READ_ORPHAN_RECONCILIATION_FAILURE',
  );
  assert.equal(
    cleanupGrantReadCount,
    2,
    'one reconciliation performs one pre-grant read and one Coordinator admission read',
  );
  const rejectedCommitAuthorityId = projectReadAuthorityIds[rejectedCommitCleanupIndex];
  const rejectedCommitSnapshotId = projectReadSnapshotIds[rejectedCommitCleanupIndex];
  const rejectedCommitGrantId = projectReadCleanupGrantIds[rejectedCommitCleanupIndex];
  assert.ok(rejectedCommitAuthorityId);
  assert.ok(rejectedCommitSnapshotId);
  assert.ok(rejectedCommitGrantId);
  assert.equal(store.getProjectSourceReadAuthority(rejectedCommitAuthorityId), undefined);
  const retainedRejectedCommitGrant =
    store.getProjectReadSnapshotCleanupGrant(rejectedCommitGrantId);
  assert.ok(retainedRejectedCommitGrant);
  assert.equal(store.getProjectReadSnapshotCleanupOutcome(rejectedCommitGrantId), undefined);
  assert.equal(existsSync(workspace.snapshotLeafFor(rejectedCommitSnapshotId)), true);
  const recoveredRejectedCommitCleanup = createProjectReadSnapshotCleanupCoordinator({
    store,
    workspace,
    clock: Object.freeze({ now: () => fixedTime }),
    ids: projectReadIdentities,
    digests,
  }).resolve({ grant: retainedRejectedCommitGrant });
  assert.equal(
    recoveredRejectedCommitCleanup.status,
    ProjectReadSnapshotCleanupCoordinatorStatus.RESOLVED,
  );
  assert.ok(store.getProjectReadSnapshotCleanupOutcome(rejectedCommitGrantId));
  assert.equal(existsSync(workspace.snapshotLeafFor(rejectedCommitSnapshotId)), false);
  assert.deepEqual(store.getWorkflow(workflow.id), workflow);

  const conflictedAuthorityIndex = projectReadAuthorityIds.length;
  rejectNextContextCommitWithVersionConflict = true;
  const conflictedStart = kernel.startGoal({
    commandId: ids.nextCommandId(),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(conflictedStart.status, 'REJECTED', JSON.stringify(conflictedStart));
  assert.equal(
    conflictedStart.output.error.detailCode,
    'CONCURRENT_MODIFICATION_RETRY_SUPPRESSED_AFTER_EXTERNAL_EFFECT',
  );
  const conflictedAuthorityId = projectReadAuthorityIds[conflictedAuthorityIndex];
  const conflictedSnapshotId = projectReadSnapshotIds[conflictedAuthorityIndex];
  const conflictedGrantId = projectReadCleanupGrantIds[conflictedAuthorityIndex];
  assert.ok(conflictedAuthorityId);
  assert.ok(conflictedSnapshotId);
  assert.ok(conflictedGrantId);
  assert.equal(store.getProjectSourceReadAuthority(conflictedAuthorityId), undefined);
  assert.ok(store.getProjectReadSnapshotCleanupOutcome(conflictedGrantId));
  assert.equal(existsSync(workspace.snapshotLeafFor(conflictedSnapshotId)), false);
  assert.deepEqual(store.getWorkflow(workflow.id), workflow);

  const started = kernel.startGoal({
    commandId: ids.nextCommandId(),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(started.status, 'APPLIED', JSON.stringify(started));
  const discoveryWorkflow = store.getWorkflow(workflow.id);
  assert.ok(discoveryWorkflow?.activeAttemptId);
  const discoveryAttempt = store.getAttempt(discoveryWorkflow.activeAttemptId);
  assert.ok(discoveryAttempt?.contextManifestId);
  const discoveryManifest = store.getContextManifest(discoveryAttempt.contextManifestId);
  if (discoveryManifest === undefined) {
    assert.fail('DISCOVERY Context Manifest was not persisted');
  }
  assert.equal(discoveryManifest.schemaVersion, 5);
  assert.ok(discoveryManifest.projectReadAuthorityId);
  const discoveryRead = store.getProjectSourceReadAuthority(
    discoveryManifest.projectReadAuthorityId,
  );
  assert.ok(discoveryRead);
  assert.equal(discoveryRead.phase, WorkflowPhase.DISCOVERY);
  assert.equal(
    discoveryRead.snapshotLeafRealpath,
    workspace.snapshotLeafFor(discoveryRead.snapshotId),
  );
  assert.equal(store.getCandidateForGoal(goal.id), undefined);

  assert.equal(
    kernel.recordAttemptResult({
      commandId: ids.nextCommandId(),
      workflowId: workflow.id,
      expectedWorkflowVersion: discoveryWorkflow.version,
      attemptId: discoveryAttempt.id,
      reason: 'WORKER_RESULT:PROPOSALS',
    }).status,
    'APPLIED',
  );
  const discoveryCompletedAttempt = store.getAttempt(discoveryAttempt.id);
  assert.ok(discoveryCompletedAttempt);
  const discoveryReady = store.getWorkflow(workflow.id);
  assert.ok(discoveryReady);
  const transitioned = kernel.requestPhaseTransition({
    commandId: ids.nextCommandId(),
    workflowId: workflow.id,
    expectedWorkflowVersion: discoveryReady.version,
    requestedPhase: WorkflowPhase.PLAN,
    reason: 'DISCOVERY_COMPLETE',
  });
  assert.equal(transitioned.status, 'APPLIED', JSON.stringify(transitioned));
  const planReady = store.getWorkflow(workflow.id);
  assert.ok(planReady);
  failContextCommit = true;
  const failedPlanStart = kernel.beginAttempt({
    commandId: ids.nextCommandId(),
    workflowId: workflow.id,
    expectedWorkflowVersion: planReady.version,
  });
  failContextCommit = false;
  assert.equal(failedPlanStart.status, 'REJECTED');
  const failedProjectReadAuthorityId = projectReadAuthorityIds.at(-1);
  const failedProjectReadSnapshotId = projectReadSnapshotIds.at(-1);
  const orphanGrantId = projectReadCleanupGrantIds.at(-1);
  assert.ok(failedProjectReadAuthorityId);
  assert.ok(failedProjectReadSnapshotId);
  assert.ok(orphanGrantId);
  assert.equal(store.getProjectSourceReadAuthority(failedProjectReadAuthorityId), undefined);
  assert.ok(store.getProjectReadSnapshotCleanupGrant(orphanGrantId));
  assert.ok(store.getProjectReadSnapshotCleanupOutcome(orphanGrantId));
  assert.equal(existsSync(workspace.snapshotLeafFor(failedProjectReadSnapshotId)), false);
  assert.deepEqual(store.getWorkflow(workflow.id), planReady);
  assert.equal(
    kernel.beginAttempt({
      commandId: ids.nextCommandId(),
      workflowId: workflow.id,
      expectedWorkflowVersion: planReady.version,
    }).status,
    'APPLIED',
  );
  const planWorkflow = store.getWorkflow(workflow.id);
  assert.ok(planWorkflow?.activeAttemptId);
  const planAttempt = store.getAttempt(planWorkflow.activeAttemptId);
  assert.ok(planAttempt?.contextManifestId);
  const planManifest = store.getContextManifest(planAttempt.contextManifestId);
  if (planManifest === undefined) {
    assert.fail('PLAN Context Manifest was not persisted');
  }
  assert.equal(planManifest.schemaVersion, 5);
  assert.ok(planManifest.projectReadAuthorityId);
  const planRead = store.getProjectSourceReadAuthority(planManifest.projectReadAuthorityId);
  assert.ok(planRead);
  assert.equal(planRead.phase, WorkflowPhase.PLAN);
  assert.notEqual(planRead.id, discoveryRead.id);
  assert.notEqual(planRead.snapshotId, discoveryRead.snapshotId);
  assert.equal(store.getCandidateForGoal(goal.id), undefined);
  store.close();

  const reopened = openSqliteControlStore({ filename, now: () => fixedTime });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getWorkflow(workflow.id), planWorkflow);
  assert.deepEqual(reopened.getAttempt(discoveryAttempt.id), discoveryCompletedAttempt);
  assert.deepEqual(reopened.getAttempt(planAttempt.id), planAttempt);
  assert.deepEqual(reopened.getContextManifest(discoveryManifest.id), discoveryManifest);
  assert.deepEqual(reopened.getContextManifest(planManifest.id), planManifest);
  assert.deepEqual(reopened.getProjectSourceReadAuthority(discoveryRead.id), discoveryRead);
  assert.deepEqual(reopened.getProjectSourceReadAuthority(planRead.id), planRead);
  assert.equal(discoveryAttempt.contextManifestId, discoveryManifest.id);
  assert.equal(discoveryManifest.projectReadAuthorityId, discoveryRead.id);
  assert.equal(discoveryManifest.projectReadAuthorityRecordDigest, discoveryRead.recordDigest);
  assert.equal(
    discoveryManifest.projectReadSourceTreeProjectionDigest,
    discoveryRead.sourceTree.projectionDigest,
  );
  assert.equal(
    discoveryManifest.projectReadGitStateProjectionDigest,
    discoveryRead.gitState.projectionDigest,
  );
  assert.equal(planWorkflow.activeAttemptId, planAttempt.id);
  assert.equal(planAttempt.contextManifestId, planManifest.id);
  assert.equal(planManifest.projectReadAuthorityId, planRead.id);
  assert.equal(planManifest.projectReadAuthorityRecordDigest, planRead.recordDigest);
  assert.equal(
    planManifest.projectReadSourceTreeProjectionDigest,
    planRead.sourceTree.projectionDigest,
  );
  assert.equal(
    planManifest.projectReadGitStateProjectionDigest,
    planRead.gitState.projectionDigest,
  );
  assert.equal(reopened.getCandidateForGoal(goal.id), undefined);
});
