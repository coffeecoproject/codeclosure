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
import { dirname, join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  AttemptFailureClass,
  AttemptStatus,
  CandidateGenerationState,
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  ExternalExecutionState,
  ExternalPhaseSourceAuthorityKind,
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
  clarificationQuestionId,
  executionProfileId,
  externalBackendCapabilityRecordProjection,
  externalExecutionPhaseDispatchEntryProjection,
  externalProcessIdentityProjection,
  goalId,
  goalRevision,
  isoTimestamp,
  intakeRunId,
  projectReadGitStateProjection,
  protectedAssetManifestProjection,
  rawRequestRevision,
  requiredGuardsForTransition,
  sha256Digest,
  successCriterionId,
  workflowId,
  type DeclaredProjectRef,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionIntent,
  type ExternalExecutionProfileDefinitionV3,
  type ProjectSourceReadAuthorityRecord,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakeCoordinator,
  M25IntakePackageCompiler,
  M25IntentAdmissionEngine,
  M25IntentProjectionCompiler,
  M251_REAL_CODEX_EXECUTION_PROFILE_ID,
  MinimalContextCompiler,
  CandidatePreparationDisposition,
  ProjectReadSnapshotCleanupCoordinatorStatus,
  Rfc8785Canonicalizer,
  WorkflowDriveStopReason,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  decodeCandidatePreparationV2,
  decodeWorkerEvent,
  goalAndWorkflowCreationPayloadProjection,
  validateCandidatePreparationRequestV2,
  type CandidateSourcePort,
  type DrivenGoalCommandResult,
  type IntakeAssistantPort,
  type IntakeStartCompositionPort,
  type IntentAnalysisAssistantResponseV1,
  type ExternalObservedWorkerPort,
  type ExternalWorkerInvocationPort,
  type PreparedExternalWorkerInvocation,
  type WorkerRequest,
} from '@codeclosure/runtime';
import {
  createM2WorkflowDriver,
  createProjectReadSnapshotCleanupCoordinator,
} from '@codeclosure/runtime/composition';
import {
  assertDirectiveV3BindsWorkerRequest,
  candidateWorkspaceLeaseProjection,
  createCodexWorkerDirectiveV3,
  decodeCodexCandidateWorkspaceLease,
  digestCanonical,
  type CandidateWorkspaceLease,
  type CodexAdapterObservationV2,
  type CodexWorkerDirectiveV3,
  type CodexWorkerPhaseDirectiveV1,
  type CodexWorkerRequestBindingV3,
  type CodexWorkerSharedProfileDirectiveV1,
} from '@codeclosure/adapter-codex';
import { WorkerTransactionStep, openSqliteControlStore } from '@codeclosure/store-sqlite';
import {
  DeterministicClock,
  DeterministicIds,
  FakeCandidateSource,
  FakeVerificationRunner,
  FakeWorker,
  FakeWorkerFixture,
} from '@codeclosure/testing';
import {
  createLocalProjectReadWorkspace,
  observeLocalCandidateSourceIdentity,
} from '@codeclosure/workspace-local';
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
import {
  prepareM251TrustedCodexProfile,
  type M251TrustedCodexRoots,
} from '../dist/composition/m251-codex-worker-invocation.js';
import {
  M251_PAYMENT_DEMO_EXPECTED_RESULT,
  createM251TrustedProductionComposition,
  type CreateM251TrustedProductionCompositionOptions,
  type M251ProductionProjectContract,
} from '../dist/composition/m251-trusted-production-composition.js';
import {
  createProductionIntakeAssistant,
  type PreparedIntakeExecutionRootDescriptor,
  type ProductionIntakeAssistantResource,
} from '../dist/composition/intake-assistant-invocation.js';
import { createM251ProductionProtocolFixtureActivation } from './fixtures/m251-production-protocol-fixture.ts';

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
    readonly candidateRoot?: string;
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
              : (roots?.candidateRoot ??
                `/authority/${namespace}/workspaces/${phase.toLowerCase()}`),
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
  const unavailableProjectRead = (): never => {
    throw new Error('B1 must not invoke ProjectRead');
  };
  return Object.freeze({
    worker: new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
    candidateSource: new FakeCandidateSource(),
    verification: new FakeVerificationRunner(),
    externalWorker: Object.freeze({
      prepare: () => Promise.reject(new Error('B1 must not invoke Codex')),
    }),
    projectRead: Object.freeze({
      workspace: Object.freeze({
        workspaceRootIdentity: '/project-read/m251-b1',
        observeSource: unavailableProjectRead,
        observeSnapshot: unavailableProjectRead,
        snapshotLeafFor: unavailableProjectRead,
        materializeSnapshot: unavailableProjectRead,
        reconcile: unavailableProjectRead,
        cleanupSnapshot: unavailableProjectRead,
      }),
      identities: new DeterministicIds(`${namespace}-project-read`),
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

type M251B3WorkerPhase =
  typeof WorkflowPhase.DISCOVERY | typeof WorkflowPhase.IMPLEMENT | typeof WorkflowPhase.PLAN;

type M251B3FixtureHookInput = Readonly<{
  phase: M251B3WorkerPhase;
  phaseEntry: CodexWorkerPhaseDirectiveV1;
  projectReadAuthority?: ProjectSourceReadAuthorityRecord;
  request: WorkerRequest;
}>;

type M251B3FixtureHooks = Readonly<{
  afterPrepare?: (input: M251B3FixtureHookInput) => void;
  afterTurn?: (input: M251B3FixtureHookInput) => void;
}>;

class M251B3ExternalWorkerFixture implements ExternalWorkerInvocationPort {
  readonly #hooks: M251B3FixtureHooks;
  public readonly adapterObservations: CodexAdapterObservationV2[] = [];
  public readonly directives: CodexWorkerDirectiveV3[] = [];
  public readonly intents: ExternalExecutionIntent[] = [];
  public readonly resultEventIds: ReturnType<typeof decodeWorkerEvent>['id'][] = [];
  public lastPreparationError: string | undefined;
  public prepareCount = 0;
  public releaseCount = 0;
  public runCount = 0;

  public constructor(hooks: M251B3FixtureHooks = {}) {
    this.#hooks = hooks;
  }

  public prepare(
    input: Parameters<ExternalWorkerInvocationPort['prepare']>[0],
  ): ReturnType<ExternalWorkerInvocationPort['prepare']> {
    this.prepareCount += 1;
    if (input.profile.schemaVersion !== 3) {
      throw new TypeError('B3 fixture requires External Profile v3');
    }
    const profile: ExternalExecutionProfileDefinitionV3 = input.profile;
    const phase = input.request.contextPackage.phase;
    if (
      input.thread.kind !== 'FRESH' ||
      (phase !== WorkflowPhase.DISCOVERY &&
        phase !== WorkflowPhase.PLAN &&
        phase !== WorkflowPhase.IMPLEMENT)
    ) {
      throw new TypeError('B3 fixture requires one fresh phase operation');
    }
    const phaseEntry = profile.phaseDispatch.find((entry) => entry.phase === phase);
    if (phaseEntry === undefined) {
      throw new TypeError('B3 fixture has no selected phase entry');
    }
    const adapterPhase: CodexWorkerPhaseDirectiveV1 = Object.freeze({
      ...phaseEntry,
      phase,
    });
    const context = input.request.contextPackage;
    const candidateContext =
      phase === WorkflowPhase.IMPLEMENT
        ? (() => {
            if (
              context.candidateGenerationId === undefined ||
              context.candidateDigest === undefined
            ) {
              throw new TypeError('B3 IMPLEMENT fixture has no Candidate Context authority');
            }
            return Object.freeze({
              candidateGenerationId: context.candidateGenerationId,
              candidateDigest: context.candidateDigest,
            });
          })()
        : undefined;
    let candidateLease: CandidateWorkspaceLease | undefined;
    if (phase === WorkflowPhase.IMPLEMENT) {
      if (candidateContext === undefined) {
        throw new TypeError('B3 IMPLEMENT fixture has no Candidate Context authority');
      }
      const workspaceRootIdentity = phaseEntry.allowedRoots[0];
      if (workspaceRootIdentity === undefined) {
        throw new TypeError('B3 IMPLEMENT fixture has no Candidate workspace root');
      }
      const allowedPaths = context.goal.scope.allowedPaths;
      mkdirSync(workspaceRootIdentity, { recursive: true });
      const candidateWorkspaceRoot = join(
        workspaceRootIdentity,
        `candidate-${input.request.attemptId}`,
      );
      mkdirSync(candidateWorkspaceRoot);
      const withoutDigest: Omit<CandidateWorkspaceLease, 'leaseDigest'> = Object.freeze({
        accessMode: 'MUTABLE',
        allowedPathPolicyDigest: digestCanonical({
          allowedPaths,
          reservedPathPolicy: 'M2_CONTROLLED_COPY_V1',
        }),
        allowedPaths,
        candidateId: 'candidate_m251-b3-fixture',
        candidateDigest: candidateContext.candidateDigest,
        candidateGenerationId: candidateContext.candidateGenerationId,
        candidateGenerationVersion: 1,
        forbiddenRoots: phaseEntry.forbiddenRoots,
        generationSequence: 1,
        goalId: context.goalId,
        goalRevision: context.goalRevision,
        id: `candidate-workspace-lease_${input.request.attemptId}`,
        issuedAt: fixedTime,
        lifecyclePolicy: 'REVOKE_ON_FREEZE',
        parentGenerationId: null,
        reservedPathPolicy: 'M2_CONTROLLED_COPY_V1',
        retentionPolicy: 'RUNTIME_OWNED',
        root: realpathSync(candidateWorkspaceRoot),
        schemaVersion: 1,
        sourceGitMetadataDigest: digests.digest({
          kind: 'M251_B3_CANDIDATE_SOURCE_GIT',
          attemptId: input.request.attemptId,
        }),
        sourceProjectRoot: context.goal.scope.projectPath,
        sourceTreeDigest: candidateContext.candidateDigest,
        state: 'ACTIVE',
        version: 1,
        workspaceRootIdentity,
        workflowId: context.workflowId,
        workflowVersion: context.workflowVersion,
      });
      try {
        candidateLease = decodeCodexCandidateWorkspaceLease({
          ...withoutDigest,
          leaseDigest: digestCanonical(candidateWorkspaceLeaseProjection(withoutDigest)),
        });
      } catch (error) {
        this.lastPreparationError = error instanceof Error ? error.message : String(error);
        throw error;
      }
    }
    const adapterObservations = this.adapterObservations;
    const directives = this.directives;
    const hooks = this.#hooks;
    const intents = this.intents;
    const resultEventIds = this.resultEventIds;
    const recordRun = (): void => {
      this.runCount += 1;
    };
    const recordRelease = (): void => {
      this.releaseCount += 1;
    };
    const hookInput = (
      projectReadAuthority?: ProjectSourceReadAuthorityRecord,
    ): M251B3FixtureHookInput =>
      Object.freeze({
        phase,
        phaseEntry: adapterPhase,
        ...(projectReadAuthority === undefined ? {} : { projectReadAuthority }),
        request: input.request,
      });
    this.#hooks.afterPrepare?.(hookInput());
    return Object.freeze({
      ...(candidateLease === undefined
        ? {}
        : {
            candidateWorkspaceLeaseId: candidateLease.id,
            candidateWorkspaceLeaseDigest: sha256Digest(candidateLease.leaseDigest),
            candidateWorkspaceCwdIdentity: candidateLease.root,
          }),
      createWorker({
        intent,
        projectReadAuthority,
        onLifecycleEvent,
      }: Parameters<
        PreparedExternalWorkerInvocation['createWorker']
      >[0]): ExternalObservedWorkerPort {
        if (intent.schemaVersion !== 2) {
          throw new TypeError('B3 fixture requires External Execution Intent v2');
        }
        const sourceBinding =
          candidateLease === undefined
            ? (() => {
                if (projectReadAuthority === undefined) {
                  throw new TypeError('B3 candidate-free fixture omitted ProjectRead authority');
                }
                return Object.freeze({
                  kind: ExternalPhaseSourceAuthorityKind.PROJECT_READ,
                  record: projectReadAuthority,
                });
              })()
            : Object.freeze({
                kind: ExternalPhaseSourceAuthorityKind.CANDIDATE,
                lease: candidateLease,
              });
        if (sourceBinding.kind === ExternalPhaseSourceAuthorityKind.PROJECT_READ) {
          if (
            intent.sourceAuthority.kind !== ExternalPhaseSourceAuthorityKind.PROJECT_READ ||
            intent.sourceAuthority.projectReadAuthorityId !== sourceBinding.record.id ||
            intent.sourceAuthority.projectReadAuthorityRecordDigest !==
              sourceBinding.record.recordDigest ||
            intent.sourceAuthority.snapshotCwdIdentity !== sourceBinding.record.snapshotLeafRealpath
          ) {
            throw new TypeError('B3 fixture received substituted ProjectRead dispatch authority');
          }
        } else if (
          intent.sourceAuthority.kind !== ExternalPhaseSourceAuthorityKind.CANDIDATE ||
          projectReadAuthority !== undefined ||
          intent.sourceAuthority.candidateWorkspaceLeaseId !== sourceBinding.lease.id ||
          intent.sourceAuthority.candidateWorkspaceLeaseDigest !==
            sourceBinding.lease.leaseDigest ||
          intent.sourceAuthority.candidateWorkspaceCwdIdentity !== sourceBinding.lease.root
        ) {
          throw new TypeError('B3 fixture received substituted Candidate dispatch authority');
        }
        const requestBase = Object.freeze({
          attemptId: input.request.attemptId,
          contextManifestDigest: input.request.contextManifestDigest,
          contextManifestId: input.request.contextManifestId,
          executionProfileDigest: input.request.executionProfileDigest,
          executionProfileId: input.request.executionProfileId,
          goalId: context.goalId,
          goalRevision: context.goalRevision,
          packageDigest: input.request.packageDigest,
          policyBundleDigest: context.policyBundleDigest,
          policyBundleId: context.policyBundleId,
          workerSessionId: input.request.workerSessionId,
          workflowId: context.workflowId,
          workflowVersion: context.workflowVersion,
        });
        let requestBinding: CodexWorkerRequestBindingV3;
        if (phase === WorkflowPhase.IMPLEMENT) {
          if (candidateContext === undefined) {
            throw new TypeError('B3 IMPLEMENT fixture has no Candidate Context authority');
          }
          requestBinding = Object.freeze({
            ...requestBase,
            phase,
            candidateGenerationId: candidateContext.candidateGenerationId,
            candidateDigest: candidateContext.candidateDigest,
          });
        } else {
          requestBinding = Object.freeze({ ...requestBase, phase });
        }
        const shared: CodexWorkerSharedProfileDirectiveV1 = Object.freeze({
          codexVersion: '0.146.1',
          controlledStateRootIdentity: profile.controlledStateRootIdentity,
          delegatedExecutableDigest: profile.binaryIdentityDigest,
          environmentNames: Object.freeze([]),
          launcherDigest: digests.digest({ kind: 'M251_B3_FIXTURE_LAUNCHER' }),
          managedRequirementsDigest: profile.managedRequirementsDigest,
          maximumPromptBytes: 256 * 1024,
          model: profile.model,
          modelProvider: profile.modelProvider,
          nonSecretEnvironmentDigest: profile.environmentProjectionDigest,
          protocolSnapshotDigest: profile.protocolSchemaDigest,
          reasoningEffort: profile.reasoningEffort,
          retentionPolicy: profile.retentionPolicy,
          serviceTier: profile.serviceTier,
          secretEnvironmentNames: Object.freeze([]),
          terminalTimeoutMilliseconds: 1_000,
          thread: Object.freeze({ kind: 'FRESH' }),
        });
        const directive = createCodexWorkerDirectiveV3({
          externalExecutionIntentDigest: intent.intentDigest,
          phaseDispatchEntryDigest: intent.phaseDispatchEntryDigest,
          processLaunchNonce: intent.processLaunchNonce,
          profile: Object.freeze({ phase: adapterPhase, shared }),
          request: requestBinding,
          schemaVersion: 3,
          sourceAuthority:
            sourceBinding.kind === ExternalPhaseSourceAuthorityKind.PROJECT_READ
              ? Object.freeze({
                  kind: ExternalPhaseSourceAuthorityKind.PROJECT_READ,
                  authorityRecord: sourceBinding.record,
                })
              : Object.freeze({
                  kind: ExternalPhaseSourceAuthorityKind.CANDIDATE,
                  workspaceLease: sourceBinding.lease,
                }),
        });
        assertDirectiveV3BindsWorkerRequest(directive, input.request);
        directives.push(directive);
        intents.push(intent);
        const worker = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
        let runtimeObservation: unknown;
        return Object.freeze({
          async *run(request: WorkerRequest, signal: AbortSignal): AsyncIterable<unknown> {
            recordRun();
            const processIdentityWithoutDigest = Object.freeze({
              schemaVersion: 1 as const,
              launchNonce: intent.processLaunchNonce,
              processId: 25_100,
              processGroupId: 25_100,
              processGroupKind: 'POSIX_PROCESS_GROUP' as const,
              processStartIdentity: `m251-b3:${intent.id}`,
              executableIdentityDigest: intent.binaryIdentityDigest,
              controlledStateRootIdentity: intent.controlledStateRootIdentity,
            });
            const processIdentity = Object.freeze({
              ...processIdentityWithoutDigest,
              identityDigest: digests.digest(
                externalProcessIdentityProjection(processIdentityWithoutDigest),
              ),
            });
            onLifecycleEvent({
              schemaVersion: 1,
              kind: 'PROCESS_STARTED',
              externalExecutionIntentDigest: intent.intentDigest,
              requestAttemptId: intent.attemptId,
              requestWorkerSessionId: intent.workerSessionId,
              processIdentity,
            });
            const backendSessionRef = `session:${intent.id}`;
            const backendOperationRef = `operation:${intent.id}`;
            onLifecycleEvent({
              schemaVersion: 1,
              kind: 'SESSION_STARTED',
              externalExecutionIntentDigest: intent.intentDigest,
              requestAttemptId: intent.attemptId,
              requestWorkerSessionId: intent.workerSessionId,
              backendSessionRef,
            });
            onLifecycleEvent({
              schemaVersion: 1,
              kind: 'OPERATION_STARTED',
              externalExecutionIntentDigest: intent.intentDigest,
              requestAttemptId: intent.attemptId,
              requestWorkerSessionId: intent.workerSessionId,
              backendSessionRef,
              backendOperationRef,
              compactionCount: 0,
            });
            let resultEventId: ReturnType<typeof decodeWorkerEvent>['id'] | undefined;
            for await (const rawEvent of worker.run(request, signal)) {
              resultEventId = decodeWorkerEvent(rawEvent).id;
              yield rawEvent;
            }
            if (resultEventId === undefined) {
              throw new TypeError('B3 fixture Worker omitted its terminal result');
            }
            resultEventIds.push(resultEventId);
            hooks.afterTurn?.(
              hookInput(
                sourceBinding.kind === ExternalPhaseSourceAuthorityKind.PROJECT_READ
                  ? sourceBinding.record
                  : undefined,
              ),
            );
            onLifecycleEvent({
              schemaVersion: 1,
              kind: 'TERMINAL',
              externalExecutionIntentDigest: intent.intentDigest,
              requestAttemptId: intent.attemptId,
              requestWorkerSessionId: intent.workerSessionId,
              state: 'COMPLETED',
              processLaunchCount: 1,
              backendSessionRef,
              backendOperationRef,
              compactionCount: 0,
              turnInterruptCount: 0,
              resultEventId,
            });
            const adapterObservation: CodexAdapterObservationV2 = Object.freeze({
              activityDisposition: 'ADMITTED',
              approvalRequestCount: 0,
              backendOperationRef,
              backendSessionRef,
              compactionCount: 0,
              directiveDigest: directive.directiveDigest,
              externalExecutionIntentDigest: intent.intentDigest,
              notificationCount: 1,
              phase,
              phaseDispatchEntryDigest: intent.phaseDispatchEntryDigest,
              processLaunchCount: 1,
              requestAttemptId: intent.attemptId,
              requestWorkerSessionId: intent.workerSessionId,
              resultEventId,
              schemaVersion: 2,
              sourceAuthority:
                sourceBinding.kind === ExternalPhaseSourceAuthorityKind.PROJECT_READ
                  ? Object.freeze({
                      kind: ExternalPhaseSourceAuthorityKind.PROJECT_READ,
                      projectReadAuthorityId: sourceBinding.record.id,
                      projectReadAuthorityRecordDigest: sourceBinding.record.recordDigest,
                      snapshotCwdIdentity: sourceBinding.record.snapshotLeafRealpath,
                    })
                  : Object.freeze({
                      kind: ExternalPhaseSourceAuthorityKind.CANDIDATE,
                      candidateWorkspaceLeaseId: sourceBinding.lease.id,
                      candidateWorkspaceLeaseDigest: sourceBinding.lease.leaseDigest,
                      candidateWorkspaceCwdIdentity: sourceBinding.lease.root,
                    }),
              state: 'COMPLETED',
              threadRequestCount: 1,
              turnInterruptCount: 0,
              turnRequestCount: 1,
              workerActivityPolicyDigest: phaseEntry.workerActivityPolicyDigest,
              workerActivityPolicyId: phaseEntry.workerActivityPolicyId,
            });
            adapterObservations.push(adapterObservation);
            runtimeObservation = Object.freeze({
              schemaVersion: 1,
              externalExecutionIntentDigest: intent.intentDigest,
              requestAttemptId: intent.attemptId,
              requestWorkerSessionId: intent.workerSessionId,
              state: adapterObservation.state,
              processLaunchCount: adapterObservation.processLaunchCount,
              backendSessionRef,
              backendOperationRef,
              compactionCount: adapterObservation.compactionCount,
              turnInterruptCount: adapterObservation.turnInterruptCount,
              resultEventId,
            });
          },
          observation: () => runtimeObservation,
        });
      },
      release: () => {
        recordRelease();
      },
    });
  }
}

class M251B3PlanSourceNotCurrentFixture implements CandidateSourcePort {
  readonly #historical = new FakeCandidateSource();

  public prepare(request: Parameters<CandidateSourcePort['prepare']>[0]): unknown {
    if (request.schemaVersion !== 2) {
      return this.#historical.prepare(request);
    }
    const validated = validateCandidatePreparationRequestV2(request);
    const changedGitStateFields = Object.freeze({
      schemaVersion: validated.expectedGitState.schemaVersion,
      profile: validated.expectedGitState.profile,
      sourceProjectRoot: validated.expectedGitState.sourceProjectRoot,
      repositoryControlRootIdentity: validated.expectedGitState.repositoryControlRootIdentity,
      headCommit: validated.expectedGitState.headCommit,
      selectedPathSetDigest: validated.expectedGitState.selectedPathSetDigest,
      stagedIndexManifestDigest: validated.expectedGitState.stagedIndexManifestDigest,
      porcelainV2Digest: digests.digest({
        kind: 'M251_B3_PLAN_SOURCE_NOT_CURRENT',
        generationId: validated.generationId,
      }),
    });
    const observedGitState = Object.freeze({
      ...changedGitStateFields,
      projectionDigest: digests.digest(projectReadGitStateProjection(changedGitStateFields)),
    });
    return decodeCandidatePreparationV2({
      schemaVersion: 2,
      disposition: CandidatePreparationDisposition.SOURCE_NOT_CURRENT,
      goalId: validated.goalId,
      workflowId: validated.workflowId,
      candidateId: validated.candidateId,
      generationId: validated.generationId,
      planProjectReadAuthorityId: validated.planProjectReadAuthorityId,
      planProjectReadAuthorityRecordDigest: validated.planProjectReadAuthorityRecordDigest,
      observedSourceTree: validated.expectedSourceTree,
      observedGitState,
    });
  }

  public prepareRepair(request: Parameters<CandidateSourcePort['prepareRepair']>[0]): unknown {
    return this.#historical.prepareRepair(request);
  }

  public observeFreeze(request: Parameters<CandidateSourcePort['observeFreeze']>[0]): unknown {
    return this.#historical.observeFreeze(request);
  }

  public observeFrozen(request: Parameters<CandidateSourcePort['observeFrozen']>[0]): unknown {
    return this.#historical.observeFrozen(request);
  }
}

function createM251B3DriverScenario(
  t: TestContext,
  namespace: string,
  options: Readonly<{
    candidateSource?: CandidateSourcePort;
    hooks?: M251B3FixtureHooks;
    maxOperations?: number;
  }> = {},
) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m251-b3-')));
  t.after(() => removeProjectReadFixtureRoot(root));
  const authorityRoot = join(root, 'authority');
  const sourceRoot = join(root, 'source');
  const projectReadRoot = join(root, 'project-read');
  const candidateRoot = join(root, 'candidates');
  const filename = join(authorityRoot, 'state.sqlite');
  mkdirSync(authorityRoot);
  mkdirSync(join(authorityRoot, 'codex-state'));
  mkdirSync(sourceRoot);
  initializeProjectReadSource(sourceRoot);
  const store = openSqliteControlStore({
    filename,
    now: () => fixedTime,
  });
  t.after(() => store.close());
  const ids = new DeterministicIds(`${namespace}-runtime`);
  const authority = installM251ExecutionAuthority(
    authorityInput(store, namespace, {
      sourceRoot,
      projectReadRoot,
      authorityRoot,
      candidateRoot,
    }),
  );
  const criterionId = successCriterionId(`criterion_${namespace}`);
  const goal = createGoal({
    id: goalId(`goal_${namespace}`),
    revision: goalRevision(1),
    objective: 'Inspect the exact retained source snapshot',
    successCriteria: Object.freeze([
      Object.freeze({
        id: criterionId,
        description: 'Produce source-bound discovery proposals',
        required: true,
      }),
    ]),
    scope: Object.freeze({
      projectPath: sourceRoot,
      allowedPaths: Object.freeze(['src/payment.ts']),
    }),
    nonGoals: Object.freeze(['No Candidate during DISCOVERY']),
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
  const workspace = createLocalProjectReadWorkspace({
    authorityRoots: Object.freeze([authorityRoot]),
    ownerId: `project-read-owner_${namespace}`,
    workspaceRoot: projectReadRoot,
  });
  const externalWorker = new M251B3ExternalWorkerFixture(options.hooks);
  const baseCapabilities = runtimeCapabilities(namespace, criterionId);
  let localWorkerRunCount = 0;
  const localFixture = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  const registry = createM251RuntimeProfileRegistry(
    authority.profile,
    Object.freeze({
      ...baseCapabilities,
      candidateSource: options.candidateSource ?? baseCapabilities.candidateSource,
      worker: Object.freeze({
        run: (request: WorkerRequest, signal: AbortSignal) => {
          localWorkerRunCount += 1;
          return localFixture.run(request, signal);
        },
      }),
      externalWorker,
      projectRead: Object.freeze({ workspace, identities: ids }),
      protectedVerification: Object.freeze({
        ...baseCapabilities.protectedVerification,
        proposal: Object.freeze({
          ...baseCapabilities.protectedVerification.proposal,
          acceptanceRuleIds: Object.freeze([...authority.policy.bundle.acceptanceRules].toSorted()),
        }),
      }),
    }),
    digests,
  );
  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm2.5.1-b3-context-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer,
    digests,
  });
  const phaseGuards = Object.freeze({
    evaluate: ({ workflow: current, requestedPhase }: PhaseGuardEvaluationRequest) =>
      Object.freeze(
        (requiredGuardsForTransition(current.phase, requestedPhase) ?? [])
          .filter((guard) => !isRuntimeOwnedPhaseGuard(guard))
          .map((guard) =>
            Object.freeze({
              guard,
              outcome: GuardOutcome.PASS,
              reasonCode: 'M251_B3_FIXTURE_GUARD',
              supportingRefs: Object.freeze([`fixture:${guard}`]),
            }),
          ),
      ),
  });
  const execution = createM2WorkflowDriver({
    store,
    clock: Object.freeze({ now: () => fixedTime }),
    ids,
    digests,
    contextFactory: Object.freeze({
      compile: (request: AttemptContextCompilationRequest) => compiler.compile(request),
    }),
    policyBundleId: authority.policy.bundle.id,
    policyBundleDigest: authority.policy.bundle.digest,
    phaseGuards,
    recovery: Object.freeze({
      resumeGoal: () => {
        throw new Error('B3 deterministic Start must not enter recovery');
      },
    }),
    startProfile: registry.startProfile,
    profiles: registry.resolver,
    maxOperations: options.maxOperations ?? 7,
  });
  return Object.freeze({
    authority,
    candidateRoot,
    execution,
    externalWorker,
    filename,
    goal,
    ids,
    localWorkerRunCount: () => localWorkerRunCount,
    projectReadRoot,
    sourceRoot,
    store,
    workflow,
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
    observeSnapshot: (record: Parameters<typeof workspace.observeSnapshot>[0]) =>
      workspace.observeSnapshot(record),
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

void test('[M251-B3] Driver dispatches all Profile v3 Worker phases through Intent v2 and the v3 Adapter boundary', async (t) => {
  const { authority, execution, externalWorker, goal, ids, localWorkerRunCount, store, workflow } =
    createM251B3DriverScenario(t, 'm251-b3-driver-discovery');

  const result = await execution.startGoal({
    commandId: ids.nextCommandId(),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(result.command.status, 'APPLIED', JSON.stringify(result));
  assert.equal(
    result.drive?.stopReason,
    WorkflowDriveStopReason.OPERATION_LIMIT,
    JSON.stringify({ result, lastPreparationError: externalWorker.lastPreparationError }),
  );
  assert.equal(result.drive.operationCount, 7);
  assert.equal(localWorkerRunCount(), 0);
  assert.equal(externalWorker.prepareCount, 3);
  assert.equal(externalWorker.runCount, 3);
  assert.equal(externalWorker.releaseCount, 3);
  assert.equal(externalWorker.intents.length, 3);
  assert.deepEqual(
    externalWorker.intents.map((value) => value.phase),
    [WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN, WorkflowPhase.IMPLEMENT],
  );
  const intent = externalWorker.intents[0];
  assert.ok(intent);
  assert.equal(intent.schemaVersion, 2);
  assert.equal(intent.phase, WorkflowPhase.DISCOVERY);
  assert.equal(intent.sourceAuthority.kind, ExternalPhaseSourceAuthorityKind.PROJECT_READ);
  const installedProfile = authority.profile.profile;
  if (
    installedProfile.schemaVersion !== 2 ||
    installedProfile.externalExecution.schemaVersion !== 3
  ) {
    assert.fail('B3 installed authority did not retain External Profile v3');
  }
  const phaseEntry = installedProfile.externalExecution.phaseDispatch.find(
    (entry) => entry.phase === WorkflowPhase.DISCOVERY,
  );
  assert.ok(phaseEntry);
  assert.equal(
    intent.phaseDispatchEntryDigest,
    digests.digest(externalExecutionPhaseDispatchEntryProjection(phaseEntry)),
  );
  const retained = store.getExternalExecutionForAttempt(intent.attemptId);
  assert.ok(retained);
  assert.equal(retained.schemaVersion, 2);
  assert.equal(retained.state, ExternalExecutionState.COMPLETED);
  assert.deepEqual(
    externalWorker.intents.map((value) => value.schemaVersion),
    [2, 2, 2],
  );
  assert.deepEqual(
    externalWorker.directives.map((value) => value.schemaVersion),
    [3, 3, 3],
  );
  assert.deepEqual(
    externalWorker.adapterObservations.map((value) => value.schemaVersion),
    [2, 2, 2],
  );
  assert.equal(
    externalWorker.adapterObservations[0]?.sourceAuthority.kind,
    ExternalPhaseSourceAuthorityKind.PROJECT_READ,
  );
  assert.ok(store.getCandidateForGoal(goal.id));
  assert.equal(store.getWorkflow(workflow.id)?.phase, WorkflowPhase.IMPLEMENT);
  assert.equal(store.getWorkflow(workflow.id)?.runStatus, RunStatus.READY);
});

void test('[M251-B3] pre-dispatch source drift terminalizes the Attempt without dispatch or fallback', async (t) => {
  let sourceRoot = '';
  const scenario = createM251B3DriverScenario(t, 'm251-b3-pre-source-drift', {
    hooks: Object.freeze({
      afterPrepare: ({ phase }) => {
        if (phase === WorkflowPhase.DISCOVERY) {
          writeFileSync(join(sourceRoot, 'src', 'payment.ts'), 'export const drifted = true;\n');
        }
      },
    }),
  });
  sourceRoot = scenario.sourceRoot;

  const result = await scenario.execution.startGoal({
    commandId: scenario.ids.nextCommandId(),
    goalId: scenario.goal.id,
    expectedGoalRevision: scenario.goal.revision,
    expectedWorkflowVersion: scenario.workflow.version,
  });
  assert.equal(result.command.status, 'APPLIED', JSON.stringify(result));
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.FAILED, JSON.stringify(result));
  assert.equal(result.drive.detailCode, 'PROJECT_SOURCE_DRIFT');
  assert.equal(scenario.localWorkerRunCount(), 0);
  assert.equal(scenario.externalWorker.prepareCount, 1);
  assert.equal(scenario.externalWorker.runCount, 0);
  assert.equal(scenario.externalWorker.intents.length, 0);
  const authority = scenario.store.getWorkflowDriverAuthority(scenario.goal.id);
  assert.ok(authority?.latestPhaseAttempt);
  assert.equal(authority.latestPhaseAttempt.status, AttemptStatus.FAILED);
  assert.equal(authority.latestPhaseAttempt.failureClass, AttemptFailureClass.INTEGRITY_VIOLATION);
  assert.equal(authority.latestPhaseAttempt.terminationReason, 'PROJECT_SOURCE_DRIFT');

  const reopened = openSqliteControlStore({ filename: scenario.filename, now: () => fixedTime });
  t.after(() => reopened.close());
  const reopenedAttempt = reopened.getWorkflowDriverAuthority(scenario.goal.id)?.latestPhaseAttempt;
  assert.ok(reopenedAttempt);
  assert.equal(reopenedAttempt.status, AttemptStatus.FAILED);
  assert.equal(reopenedAttempt.terminationReason, 'PROJECT_SOURCE_DRIFT');
});

void test('[M251-B3] missing pre-dispatch snapshot authority closes under its exact reason', async (t) => {
  let projectReadRoot = '';
  const scenario = createM251B3DriverScenario(t, 'm251-b3-pre-snapshot-missing', {
    hooks: Object.freeze({
      afterPrepare: ({ phase }) => {
        if (phase !== WorkflowPhase.DISCOVERY) {
          return;
        }
        const snapshotsRoot = join(projectReadRoot, 'snapshots');
        const snapshots = readdirSync(snapshotsRoot);
        assert.equal(snapshots.length, 1);
        const snapshot = snapshots[0];
        assert.ok(snapshot);
        removeProjectReadFixtureRoot(join(snapshotsRoot, snapshot));
      },
    }),
  });
  projectReadRoot = scenario.projectReadRoot;

  const result = await scenario.execution.startGoal({
    commandId: scenario.ids.nextCommandId(),
    goalId: scenario.goal.id,
    expectedGoalRevision: scenario.goal.revision,
    expectedWorkflowVersion: scenario.workflow.version,
  });
  assert.equal(result.command.status, 'APPLIED', JSON.stringify(result));
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.FAILED, JSON.stringify(result));
  assert.equal(result.drive.detailCode, 'PROJECT_READ_AUTHORITY_INVALID');
  assert.equal(scenario.localWorkerRunCount(), 0);
  assert.equal(scenario.externalWorker.prepareCount, 1);
  assert.equal(scenario.externalWorker.runCount, 0);
  assert.equal(scenario.externalWorker.intents.length, 0);
  const authority = scenario.store.getWorkflowDriverAuthority(scenario.goal.id);
  assert.ok(authority?.latestPhaseAttempt);
  assert.equal(authority.latestPhaseAttempt.status, AttemptStatus.FAILED);
  assert.equal(authority.latestPhaseAttempt.failureClass, AttemptFailureClass.INTEGRITY_VIOLATION);
  assert.equal(authority.latestPhaseAttempt.terminationReason, 'PROJECT_READ_AUTHORITY_INVALID');
});

void test('[M251-B3] post-Turn snapshot drift discards the stale Worker result', async (t) => {
  const scenario = createM251B3DriverScenario(t, 'm251-b3-post-snapshot-drift', {
    hooks: Object.freeze({
      afterTurn: ({ phase, projectReadAuthority }) => {
        if (phase !== WorkflowPhase.DISCOVERY || projectReadAuthority === undefined) {
          return;
        }
        const snapshotFile = join(projectReadAuthority.snapshotLeafRealpath, 'src', 'payment.ts');
        chmodSync(snapshotFile, 0o644);
        writeFileSync(snapshotFile, 'export const staleSnapshot = true;\n');
      },
    }),
  });

  const result = await scenario.execution.startGoal({
    commandId: scenario.ids.nextCommandId(),
    goalId: scenario.goal.id,
    expectedGoalRevision: scenario.goal.revision,
    expectedWorkflowVersion: scenario.workflow.version,
  });
  assert.equal(result.command.status, 'APPLIED', JSON.stringify(result));
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.FAILED, JSON.stringify(result));
  assert.equal(result.drive.detailCode, 'PROJECT_READ_SNAPSHOT_DRIFT');
  assert.equal(scenario.localWorkerRunCount(), 0);
  assert.equal(scenario.externalWorker.prepareCount, 1);
  assert.equal(scenario.externalWorker.runCount, 1);
  assert.equal(scenario.externalWorker.intents.length, 1);
  const resultEventId = scenario.externalWorker.resultEventIds[0];
  assert.ok(resultEventId);
  assert.equal(scenario.store.getWorkerEventReceipt(resultEventId), undefined);
  const authority = scenario.store.getWorkflowDriverAuthority(scenario.goal.id);
  assert.ok(authority?.latestPhaseAttempt);
  assert.equal(authority.latestPhaseAttempt.status, AttemptStatus.FAILED);
  assert.equal(authority.latestPhaseAttempt.failureClass, AttemptFailureClass.INTEGRITY_VIOLATION);
  assert.equal(authority.latestPhaseAttempt.terminationReason, 'PROJECT_READ_SNAPSHOT_DRIFT');
  const retained = scenario.store.getExternalExecutionForAttempt(authority.latestPhaseAttempt.id);
  assert.ok(retained);
  assert.equal(retained.state, ExternalExecutionState.COMPLETED);
});

void test('[M251-B3] retained PLAN_SOURCE_NOT_CURRENT stops Driver without Candidate or fallback', async (t) => {
  const scenario = createM251B3DriverScenario(t, 'm251-b3-plan-source-not-current', {
    candidateSource: new M251B3PlanSourceNotCurrentFixture(),
  });

  const result = await scenario.execution.startGoal({
    commandId: scenario.ids.nextCommandId(),
    goalId: scenario.goal.id,
    expectedGoalRevision: scenario.goal.revision,
    expectedWorkflowVersion: scenario.workflow.version,
  });
  assert.equal(result.command.status, 'APPLIED', JSON.stringify(result));
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.FAILED, JSON.stringify(result));
  assert.equal(result.drive.detailCode, 'PLAN_SOURCE_NOT_CURRENT');
  assert.equal(result.drive.operationCount, 5);
  assert.equal(scenario.localWorkerRunCount(), 0);
  assert.equal(scenario.externalWorker.prepareCount, 2);
  assert.equal(scenario.externalWorker.runCount, 2);
  assert.equal(scenario.externalWorker.intents.length, 2);
  assert.equal(scenario.store.getCandidateForGoal(scenario.goal.id), undefined);
  const retained = scenario.store.getWorkflowDriverAuthority(scenario.goal.id);
  assert.ok(retained);
  assert.equal(retained.workflow.phase, WorkflowPhase.PLAN);
  assert.equal(retained.workflow.runStatus, RunStatus.FAILED);
  assert.equal(retained.workflow.suspendedReason, 'PLAN_SOURCE_NOT_CURRENT');
  assert.equal(retained.latestPhaseAttempt?.status, AttemptStatus.RESULT_RECORDED);
});

function createM251B4Project(sourceRoot: string): M251ProductionProjectContract {
  mkdirSync(join(sourceRoot, 'src'), { recursive: true });
  writeFileSync(
    join(sourceRoot, 'package.json'),
    `${JSON.stringify({ name: 'm251-b4-payment-demo', private: true, type: 'module' }, null, 2)}\n`,
  );
  writeFileSync(
    join(sourceRoot, 'src', 'payment.js'),
    `export class PaymentProcessor {
  #charges = [];

  processCallback({ orderId, amount }) {
    this.#charges.push({ orderId, amount });
    return { status: 'charged' };
  }

  getCharges() {
    return [...this.#charges];
  }
}
`,
  );
  const git = (arguments_: readonly string[]): string =>
    execFileSync('git', arguments_, {
      cwd: sourceRoot,
      encoding: 'utf8',
      env: {
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      },
    }).trim();
  git(['init', '--quiet']);
  git(['config', 'user.name', 'CodeClosure Test']);
  git(['config', 'user.email', 'codeclosure@example.invalid']);
  git(['add', '.']);
  git(['commit', '--quiet', '-m', 'test: add duplicate payment callback reproduction']);
  const observed = observeLocalCandidateSourceIdentity(sourceRoot);
  return Object.freeze({
    projectFamily: 'CodeClosureM251B4Test',
    gitCommit: git(['rev-parse', 'HEAD']),
    gitTree: git(['rev-parse', 'HEAD^{tree}']),
    sourceTreeDigest: observed.sourceTreeDigest,
    sourceGitMetadataDigest: observed.sourceGitMetadataDigest,
    allowedPaths: Object.freeze(['src/payment.js']),
    expectedResult: M251_PAYMENT_DEMO_EXPECTED_RESULT,
  });
}

function m251B4Clock(
  start = '2026-08-11T01:00:00.000Z',
): Readonly<{ now(): ReturnType<typeof isoTimestamp> }> {
  let tick = 0;
  return Object.freeze({
    now: () => {
      const value = new Date(Date.parse(start) + tick * 1_000).toISOString();
      tick += 1;
      return isoTimestamp(value);
    },
  });
}

function createPreparedIntakeAssistantFixture(
  declaredRoot: string,
  assistant: IntakeAssistantPort,
): Readonly<{
  descriptor: PreparedIntakeExecutionRootDescriptor;
  observation(): Readonly<{ closeCount: number; prepareCount: number }>;
  resource: ProductionIntakeAssistantResource;
}> {
  mkdirSync(declaredRoot, { mode: 0o700, recursive: true });
  const root = realpathSync(declaredRoot);
  const declaredMembers = Object.freeze({
    codexHome: join(root, 'codex-home'),
    operationCwd: join(root, 'operation'),
    processHome: join(root, 'process-home'),
    processTemporaryDirectory: join(root, 'process-tmp'),
  });
  for (const path of Object.values(declaredMembers)) {
    mkdirSync(path, { mode: 0o700 });
  }
  const descriptor: PreparedIntakeExecutionRootDescriptor = Object.freeze({
    root,
    codexHome: realpathSync(declaredMembers.codexHome),
    operationCwd: realpathSync(declaredMembers.operationCwd),
    processHome: realpathSync(declaredMembers.processHome),
    processTemporaryDirectory: realpathSync(declaredMembers.processTemporaryDirectory),
  });
  let closeCount = 0;
  let prepareCount = 0;
  let closed = false;
  const resource: ProductionIntakeAssistantResource = Object.freeze({
    assistant,
    prepare: () => {
      if (closed) {
        throw new TypeError('Fixture Intake assistant resource is closed');
      }
      prepareCount += 1;
      return descriptor;
    },
    close: () => {
      if (!closed) {
        closed = true;
        closeCount += 1;
        rmSync(root, { force: true, recursive: true });
      }
    },
  });
  return Object.freeze({
    descriptor,
    observation: () => Object.freeze({ closeCount, prepareCount }),
    resource,
  });
}

void test('[M251-S4-B1] production Intake resource prepares one content-free execution-root descriptor without an Assistant call', (t) => {
  const fixtureRoot = realpathSync(
    mkdtempSync(join(tmpdir(), 'codeclosure-m251-s4-intake-resource-')),
  );
  t.after(() => removeProjectReadFixtureRoot(fixtureRoot));
  const authSource = join(fixtureRoot, 'auth.json');
  writeFileSync(authSource, '{}\n', { mode: 0o600 });
  const resource = createProductionIntakeAssistant({
    environment: Object.freeze({
      CODECLOSURE_M2_AUTH_SOURCE: authSource,
      PATH: process.env['PATH'],
    }),
    forbiddenRoots: Object.freeze([fixtureRoot]),
  });
  t.after(() => resource.close());

  const descriptor = resource.prepare();
  assert.equal(Object.isFrozen(descriptor), true);
  assert.deepEqual(Reflect.ownKeys(descriptor).toSorted(), [
    'codexHome',
    'operationCwd',
    'processHome',
    'processTemporaryDirectory',
    'root',
  ]);
  assert.equal(resource.prepare(), descriptor);
  for (const path of [
    descriptor.root,
    descriptor.codexHome,
    descriptor.operationCwd,
    descriptor.processHome,
    descriptor.processTemporaryDirectory,
  ]) {
    assert.equal(realpathSync(path), path);
    assert.equal(lstatSync(path).isDirectory(), true);
    assert.equal(lstatSync(path).isSymbolicLink(), false);
  }
  assert.equal(dirname(descriptor.codexHome), descriptor.root);
  assert.equal(dirname(descriptor.operationCwd), descriptor.root);
  assert.equal(dirname(descriptor.processHome), descriptor.root);
  assert.equal(dirname(descriptor.processTemporaryDirectory), descriptor.root);

  resource.close();
  assert.equal(existsSync(descriptor.root), false);
  resource.close();
  assert.throws(() => resource.prepare(), /resource is closed/);
});

function createM251B4CompositionScenario(
  t: TestContext,
  namespace: string,
  implementationResult: 'CONTAINMENT_FAILURE' | 'CORRECT' | 'VERIFICATION_REJECTED' = 'CORRECT',
): Readonly<{
  admittedUserContent: string;
  compositionOptions: CreateM251TrustedProductionCompositionOptions;
  createIntakeAssistantResource(suffix: string): ProductionIntakeAssistantResource;
  fixture: ReturnType<typeof createM251ProductionProtocolFixtureActivation>;
  intakeAssistantFixture: ReturnType<typeof createPreparedIntakeAssistantFixture>;
  initialSource: ReturnType<typeof observeLocalCandidateSourceIdentity>;
  sourceRoot: string;
}> {
  const testRoot = realpathSync(
    mkdtempSync(join(tmpdir(), `codeclosure-${namespace}-production-`)),
  );
  t.after(() => removeProjectReadFixtureRoot(testRoot));
  const sourceRoot = join(testRoot, 'source');
  mkdirSync(sourceRoot, { recursive: true });
  const projectContract = createM251B4Project(sourceRoot);
  const initialSource = observeLocalCandidateSourceIdentity(sourceRoot);
  const protectedCheckPath = realpathSync(
    fileURLToPath(
      new URL('../../../scripts/fixtures/m2.5.1/payment-idempotency-check.mjs', import.meta.url),
    ),
  );
  const roots = Object.freeze({
    authorityHome: join(testRoot, 'authority'),
    candidateWorkspace: join(testRoot, 'candidate'),
    credentialRoot: join(testRoot, 'credentials'),
    projectReadWorkspace: join(testRoot, 'project-read'),
    protectedAssetRoot: realpathSync(dirname(protectedCheckPath)),
    verificationRunRoot: join(testRoot, 'verification'),
  });
  const operationRoots = Object.freeze([
    join(testRoot, 'operation-a'),
    join(testRoot, 'operation-b'),
  ]);
  const workerForbiddenRoots = Object.freeze(
    [
      roots.authorityHome,
      roots.credentialRoot,
      roots.protectedAssetRoot,
      roots.verificationRunRoot,
      sourceRoot,
      ...operationRoots,
    ].toSorted(),
  );
  const fixture = createM251ProductionProtocolFixtureActivation({
    candidateWorkspaceRoot: roots.candidateWorkspace,
    implementationResult,
    operationRoots,
    phaseForbiddenRoots: Object.freeze({
      [WorkflowPhase.DISCOVERY]: Object.freeze(
        [...workerForbiddenRoots, roots.candidateWorkspace].toSorted(),
      ),
      [WorkflowPhase.PLAN]: Object.freeze(
        [...workerForbiddenRoots, roots.candidateWorkspace].toSorted(),
      ),
      [WorkflowPhase.IMPLEMENT]: Object.freeze(
        [...workerForbiddenRoots, roots.projectReadWorkspace].toSorted(),
      ),
    }),
    projectReadWorkspaceRoot: roots.projectReadWorkspace,
  });
  const objective = 'Fix duplicate payment callback handling';
  const admittedUserContent = `${objective}\n${M251_PAYMENT_DEMO_EXPECTED_RESULT}`;
  const assistant: IntakeAssistantPort = Object.freeze({
    analyze: () =>
      Promise.resolve({
        kind: 'COMPLETED' as const,
        response: Object.freeze({
          proposedObjective: objective,
          proposedCriteria: Object.freeze([M251_PAYMENT_DEMO_EXPECTED_RESULT]),
          proposedNonGoals: Object.freeze([]),
          proposedAssumptions: Object.freeze([]),
          proposedQuestions: Object.freeze([]),
          candidateSourceSpanSuggestions: Object.freeze([]),
        }),
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
    answer: () => Promise.reject(new Error('B4 full-chain fixture must not answer-only')),
  });
  const createIntakeAssistantResource = (suffix: string): ProductionIntakeAssistantResource =>
    createPreparedIntakeAssistantFixture(join(testRoot, `intake-${suffix}`), assistant).resource;
  const intakeAssistantFixture = createPreparedIntakeAssistantFixture(
    join(testRoot, 'intake-primary'),
    assistant,
  );
  return Object.freeze({
    admittedUserContent,
    compositionOptions: Object.freeze({
      activation: fixture.activation,
      intakeAssistant: intakeAssistantFixture.resource,
      clock: m251B4Clock(),
      ids: new DeterministicIds(namespace),
      projectContract,
      projectPath: sourceRoot,
      protectedCheckPath,
      roots,
    }),
    createIntakeAssistantResource,
    fixture,
    intakeAssistantFixture,
    initialSource,
    sourceRoot,
  });
}

void test('[M251-B4] trusted production composition closes the deterministic Intake-to-Acceptance chain without a Fake fallback', async (t) => {
  const scenario = createM251B4CompositionScenario(t, 'm251-b4-production');
  const { admittedUserContent, fixture, initialSource, sourceRoot } = scenario;
  const adapterObservations: CodexAdapterObservationV2[] = [];
  const ordinaryStartResults: DrivenGoalCommandResult[] = [];
  const composition = createM251TrustedProductionComposition({
    ...scenario.compositionOptions,
    observationSink: Object.freeze({
      onAdapterObservation: (observation: CodexAdapterObservationV2) => {
        adapterObservations.push(observation);
        throw new Error('non-authoritative Adapter observation sink failure');
      },
      onOrdinaryStartResult: (result: DrivenGoalCommandResult) => {
        ordinaryStartResults.push(result);
        throw new Error('non-authoritative Start observation sink failure');
      },
    }),
  });
  t.after(() => composition.close());
  assert.deepEqual(scenario.intakeAssistantFixture.observation(), {
    closeCount: 0,
    prepareCount: 1,
  });
  assert.equal(existsSync(scenario.intakeAssistantFixture.descriptor.root), true);
  const submitCommandId = commandId('command_m251-b4-production-submit');
  const result = await composition.intakeApplication.submit({
    commandId: submitCommandId,
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent,
    declaredProjectPath: sourceRoot,
  });
  assert.equal(result.kind, 'OUTCOME', JSON.stringify(result));
  assert.equal(result.outcome.result.kind, 'MATERIALIZED', JSON.stringify(result));
  const goalIdentifier = result.outcome.result.materializedGoalRef.goalId;
  const startCommandIdentifier = commandId('command_m251-b4-production-start');
  const started = await composition.application.startGoal({
    commandId: startCommandIdentifier,
    goalId: goalIdentifier,
    expectedGoalRevision: result.outcome.result.materializedGoalRef.goalRevision,
    expectedWorkflowVersion: result.outcome.result.materializedGoalRef.workflowVersion,
  });
  const status = composition.application.getGoalStatus(goalIdentifier);
  assert.equal(started.command.status, 'APPLIED', JSON.stringify(started));
  assert.equal(started.drive?.stopReason, 'CLOSED', JSON.stringify(started));
  assert.equal(status.status, 'FOUND');
  assert.equal(
    status.view.technicalCloseout,
    true,
    JSON.stringify({
      status,
      audit: composition.application.getGoalAudit(goalIdentifier),
      fixture: fixture.observation(),
    }),
  );
  assert.equal(status.view.acceptanceSummary?.outcome, 'ACCEPT');
  assert.ok(status.view.executionProfileRef);
  assert.equal(status.view.executionProfileRef.id, composition.profile.id);
  assert.equal(status.view.executionProfileRef.digest, composition.profile.digest);
  assert.equal(ordinaryStartResults.length, 1);
  assert.deepEqual(
    adapterObservations.map(({ phase }) => phase),
    [WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN, WorkflowPhase.IMPLEMENT],
  );
  for (const observation of adapterObservations) {
    const phaseAuthority = composition.inspection.readPhaseAuthority(observation);
    assert.equal(phaseAuthority.attempt.id, observation.requestAttemptId);
    assert.equal(phaseAuthority.workerEventReceipt.eventId, observation.resultEventId);
    assert.equal(phaseAuthority.externalRecord.schemaVersion, 2);
    assert.equal(
      phaseAuthority.projectReadAuthority === undefined,
      observation.phase === WorkflowPhase.IMPLEMENT,
    );
  }
  const inspectedIntake = composition.inspection.getIntakeAuthority(result.outcome.intakeRunId);
  const inspectedGoal = composition.inspection.getGoalAuthority(goalIdentifier);
  assert.ok(inspectedIntake?.materialization);
  assert.ok(inspectedGoal?.closeout);
  assert.ok(inspectedGoal.policyBinding);
  assert.ok(composition.inspection.getProcessedCommand(startCommandIdentifier));
  assert.ok(
    composition.inspection.getAcceptanceAuthority(
      inspectedGoal.workflow.id,
      inspectedGoal.policyBinding.policyBundleId,
    ),
  );

  const observed = fixture.observation();
  assert.deepEqual(observed.phaseRuns, [
    WorkflowPhase.DISCOVERY,
    WorkflowPhase.PLAN,
    WorkflowPhase.IMPLEMENT,
  ]);
  assert.equal(observed.prepareCount, 3);
  assert.equal(observed.releaseCount, 3);
  assert.deepEqual(
    observed.directives.map(({ sourceAuthority }) => sourceAuthority.kind),
    [
      ExternalPhaseSourceAuthorityKind.PROJECT_READ,
      ExternalPhaseSourceAuthorityKind.PROJECT_READ,
      ExternalPhaseSourceAuthorityKind.CANDIDATE,
    ],
  );
  assert.deepEqual(observeLocalCandidateSourceIdentity(sourceRoot), initialSource);
  assert.equal(
    execFileSync('git', ['status', '--porcelain=v2'], {
      cwd: sourceRoot,
      encoding: 'utf8',
      env: {
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_OPTIONAL_LOCKS: '0',
        LC_ALL: 'C',
        PATH: process.env['PATH'] ?? '/usr/bin:/bin',
      },
    }).trim(),
    '',
  );

  const replay = await composition.intakeApplication.submit({
    commandId: submitCommandId,
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent,
    declaredProjectPath: sourceRoot,
  });
  assert.equal(replay.kind, 'OUTCOME');
  assert.equal(replay.replayed, true);
  assert.equal(fixture.observation().prepareCount, 3);

  const replayedStart = await composition.application.startGoal({
    commandId: commandId('command_m251-b4-production-start'),
    goalId: goalIdentifier,
    expectedGoalRevision: result.outcome.result.materializedGoalRef.goalRevision,
    expectedWorkflowVersion: result.outcome.result.materializedGoalRef.workflowVersion,
  });
  assert.equal(replayedStart.command.status, 'REPLAYED');
  assert.equal(replayedStart.drive?.stopReason, WorkflowDriveStopReason.CLOSED);
  assert.equal(fixture.observation().prepareCount, 3);
  const projectReadRoot = scenario.compositionOptions.roots.projectReadWorkspace;
  assert.deepEqual(readdirSync(join(projectReadRoot, 'snapshots')), []);
  assert.deepEqual(readdirSync(join(projectReadRoot, '.codeclosure-project-read', 'markers')), []);

  composition.close();
  assert.deepEqual(scenario.intakeAssistantFixture.observation(), {
    closeCount: 1,
    prepareCount: 1,
  });
  assert.equal(existsSync(scenario.intakeAssistantFixture.descriptor.root), false);
  composition.close();
  assert.equal(scenario.intakeAssistantFixture.observation().closeCount, 1);
  const reopened = createM251TrustedProductionComposition({
    ...scenario.compositionOptions,
    clock: m251B4Clock('2026-08-12T01:00:00.000Z'),
    ids: new DeterministicIds('m251-b4-production-reopen'),
    intakeAssistant: scenario.createIntakeAssistantResource('reopen'),
  });
  t.after(() => reopened.close());
  const reopenedStatus = reopened.application.getGoalStatus(goalIdentifier);
  assert.equal(reopenedStatus.status, 'FOUND');
  assert.equal(reopenedStatus.view.technicalCloseout, true);
  const reopenedReplay = await reopened.intakeApplication.submit({
    commandId: submitCommandId,
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent,
    declaredProjectPath: sourceRoot,
  });
  assert.equal(reopenedReplay.kind, 'OUTCOME');
  assert.equal(reopenedReplay.replayed, true);
  assert.equal(fixture.observation().prepareCount, 3);
});

void test('[M251-B4][M251-F05] protected-verification-rejection remains repair-required without fallback', async (t) => {
  const scenario = createM251B4CompositionScenario(
    t,
    'm251-b4-verification-rejected',
    'VERIFICATION_REJECTED',
  );
  const composition = createM251TrustedProductionComposition(scenario.compositionOptions);
  t.after(() => composition.close());
  const result = await composition.intakeApplication.submit({
    commandId: commandId('command_m251-b4-verification-rejected-submit'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: scenario.admittedUserContent,
    declaredProjectPath: scenario.sourceRoot,
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.result.kind, 'MATERIALIZED');
  const started = await composition.application.startGoal({
    commandId: commandId('command_m251-b4-verification-rejected-start'),
    goalId: result.outcome.result.materializedGoalRef.goalId,
    expectedGoalRevision: result.outcome.result.materializedGoalRef.goalRevision,
    expectedWorkflowVersion: result.outcome.result.materializedGoalRef.workflowVersion,
  });
  assert.equal(started.command.status, 'APPLIED');
  assert.ok(started.drive);
  assert.equal(started.drive.stopReason, WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED);
  assert.equal(started.drive.detailCode, 'REQUIRED_EVIDENCE_FAILED_REPAIRABLE');
  const status = composition.application.getGoalStatus(
    result.outcome.result.materializedGoalRef.goalId,
  );
  assert.equal(status.status, 'FOUND');
  assert.equal(status.view.technicalCloseout, false);
  assert.equal(status.view.acceptanceSummary?.outcome, 'REJECT_REPAIRABLE');
  assert.equal(scenario.fixture.observation().prepareCount, 3);
  assert.equal(scenario.fixture.observation().releaseCount, 3);
  assert.deepEqual(
    observeLocalCandidateSourceIdentity(scenario.sourceRoot),
    scenario.initialSource,
  );
});

void test('[M251-B5][M251-F04] real-worker-containment-failure invalidates the Candidate without fallback or Acceptance', async (t) => {
  const scenario = createM251B4CompositionScenario(
    t,
    'm251-b5-containment-failure',
    'CONTAINMENT_FAILURE',
  );
  const composition = createM251TrustedProductionComposition(scenario.compositionOptions);
  t.after(() => composition.close());
  const result = await composition.intakeApplication.submit({
    commandId: commandId('command_m251-b5-containment-failure-submit'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: scenario.admittedUserContent,
    declaredProjectPath: scenario.sourceRoot,
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.result.kind, 'MATERIALIZED');
  const started = await composition.application.startGoal({
    commandId: commandId('command_m251-b5-containment-failure-start'),
    goalId: result.outcome.result.materializedGoalRef.goalId,
    expectedGoalRevision: result.outcome.result.materializedGoalRef.goalRevision,
    expectedWorkflowVersion: result.outcome.result.materializedGoalRef.workflowVersion,
  });
  assert.equal(started.command.status, 'APPLIED');
  assert.equal(started.drive?.stopReason, WorkflowDriveStopReason.FAILED);
  assert.equal(started.drive.detailCode, 'CANDIDATE_CHANGE_OUTSIDE_ALLOWED_PATHS');
  const status = composition.application.getGoalStatus(
    result.outcome.result.materializedGoalRef.goalId,
  );
  assert.equal(status.status, 'FOUND');
  assert.ok(status.view.activeCandidateRef);
  assert.equal(status.view.activeCandidateRef.state, CandidateGenerationState.INVALIDATED);
  assert.equal(status.view.technicalCloseout, false);
  assert.equal(status.view.acceptanceSummary, undefined);
  assert.equal(status.view.closeoutRef, undefined);
  assert.equal(scenario.fixture.observation().prepareCount, 3);
  assert.equal(scenario.fixture.observation().releaseCount, 3);
  assert.deepEqual(
    observeLocalCandidateSourceIdentity(scenario.sourceRoot),
    scenario.initialSource,
  );
  const invalidatedGenerationId = status.view.activeCandidateRef.generationId;
  composition.close();
  const reopened = openSqliteControlStore({
    filename: join(scenario.compositionOptions.roots.authorityHome, 'state.sqlite'),
    now: () => fixedTime,
  });
  t.after(() => reopened.close());
  assert.equal(
    reopened.getCandidateGeneration(invalidatedGenerationId)?.state,
    CandidateGenerationState.INVALIDATED,
  );
  assert.equal(reopened.listEvidenceForGeneration(invalidatedGenerationId).length, 0);
});

void test('[M251-B4] formal composition preserves PLAN_SOURCE_NOT_CURRENT without Candidate or fallback', async (t) => {
  const scenario = createM251B4CompositionScenario(t, 'm251-b4-plan-source-not-current');
  const composition = createM251TrustedProductionComposition({
    ...scenario.compositionOptions,
    candidateSourceFixture: new M251B3PlanSourceNotCurrentFixture(),
  });
  t.after(() => composition.close());
  const result = await composition.intakeApplication.submit({
    commandId: commandId('command_m251-b4-plan-source-not-current-submit'),
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: scenario.admittedUserContent,
    declaredProjectPath: scenario.sourceRoot,
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.result.kind, 'MATERIALIZED');
  const started = await composition.application.startGoal({
    commandId: commandId('command_m251-b4-plan-source-not-current-start'),
    goalId: result.outcome.result.materializedGoalRef.goalId,
    expectedGoalRevision: result.outcome.result.materializedGoalRef.goalRevision,
    expectedWorkflowVersion: result.outcome.result.materializedGoalRef.workflowVersion,
  });
  assert.equal(started.command.status, 'APPLIED');
  assert.ok(started.drive);
  assert.equal(started.drive.stopReason, WorkflowDriveStopReason.FAILED);
  assert.equal(started.drive.detailCode, 'PLAN_SOURCE_NOT_CURRENT');
  assert.equal(scenario.fixture.observation().prepareCount, 2);
  assert.equal(scenario.fixture.observation().releaseCount, 2);
  const status = composition.application.getGoalStatus(
    result.outcome.result.materializedGoalRef.goalId,
  );
  assert.equal(status.status, 'FOUND');
  assert.equal(status.view.activeCandidateRef, undefined);
  assert.equal(status.view.nextSafeAction, 'INSPECT_BLOCKER');
});

void test('[M251-B4] substituted activation, phase roots, and protected asset fail before publication', (t) => {
  const intakeScenario = createM251B4CompositionScenario(t, 'm251-b4-intake-root-substitution');
  const overlappingIntake = createPreparedIntakeAssistantFixture(
    join(intakeScenario.sourceRoot, 'overlapping-intake-root'),
    intakeScenario.compositionOptions.intakeAssistant.assistant,
  );
  assert.throws(
    () =>
      createM251TrustedProductionComposition({
        ...intakeScenario.compositionOptions,
        intakeAssistant: overlappingIntake.resource,
      }),
    /Intake, source, authority, and operation roots must be separated/,
  );
  assert.deepEqual(overlappingIntake.observation(), { closeCount: 1, prepareCount: 1 });
  assert.equal(existsSync(overlappingIntake.descriptor.root), false);
  assert.equal(intakeScenario.fixture.observation().prepareCount, 0);
  assert.deepEqual(
    observeLocalCandidateSourceIdentity(intakeScenario.sourceRoot),
    intakeScenario.initialSource,
  );
  intakeScenario.compositionOptions.intakeAssistant.close();

  const memberScenario = createM251B4CompositionScenario(t, 'm251-b4-intake-member-substitution');
  const memberDelegate = memberScenario.intakeAssistantFixture.resource;
  assert.throws(
    () =>
      createM251TrustedProductionComposition({
        ...memberScenario.compositionOptions,
        intakeAssistant: Object.freeze({
          assistant: memberDelegate.assistant,
          prepare: () =>
            Object.freeze({
              ...memberDelegate.prepare(),
              operationCwd: memberScenario.compositionOptions.roots.candidateWorkspace,
            }),
          close: () => memberDelegate.close(),
        }),
      }),
    /execution-root members must be exact descendants/,
  );
  assert.deepEqual(memberScenario.intakeAssistantFixture.observation(), {
    closeCount: 1,
    prepareCount: 1,
  });
  assert.equal(existsSync(memberScenario.intakeAssistantFixture.descriptor.root), false);
  assert.equal(memberScenario.fixture.observation().prepareCount, 0);

  const rootScenario = createM251B4CompositionScenario(t, 'm251-b4-root-substitution');
  const sourceNestedRoot = join(rootScenario.sourceRoot, 'forbidden-authority-root');
  assert.throws(
    () =>
      createM251TrustedProductionComposition({
        ...rootScenario.compositionOptions,
        roots: Object.freeze({
          ...rootScenario.compositionOptions.roots,
          authorityHome: sourceNestedRoot,
        }),
      }),
    /roots must be pairwise separated/,
  );
  assert.equal(existsSync(sourceNestedRoot), false);
  assert.deepEqual(
    observeLocalCandidateSourceIdentity(rootScenario.sourceRoot),
    rootScenario.initialSource,
  );
  assert.equal(rootScenario.fixture.observation().prepareCount, 0);
  assert.deepEqual(rootScenario.intakeAssistantFixture.observation(), {
    closeCount: 1,
    prepareCount: 0,
  });

  const capabilityScenario = createM251B4CompositionScenario(t, 'm251-b4-capability-substitution');
  assert.throws(
    () =>
      createM251TrustedProductionComposition({
        ...capabilityScenario.compositionOptions,
        activation: Object.freeze({
          ...capabilityScenario.fixture.activation,
          capabilityRecord: Object.freeze({
            ...capabilityScenario.fixture.activation.capabilityRecord,
            binaryIdentityDigest: digests.digest({ substituted: 'binary' }),
          }),
        }),
      }),
    /pinned shared toolchain identity/,
  );
  assert.equal(capabilityScenario.fixture.observation().prepareCount, 0);

  const phaseScenario = createM251B4CompositionScenario(t, 'm251-b4-phase-substitution');
  const substitutedPhase = phaseScenario.fixture.activation.phaseAuthorities.map((phase) =>
    phase.phase === WorkflowPhase.PLAN
      ? Object.freeze({ ...phase, allowedRoots: Object.freeze([phaseScenario.sourceRoot]) })
      : phase,
  );
  assert.throws(
    () =>
      createM251TrustedProductionComposition({
        ...phaseScenario.compositionOptions,
        activation: Object.freeze({
          ...phaseScenario.fixture.activation,
          phaseAuthorities: Object.freeze(substitutedPhase),
        }),
      }),
    /activation roots do not bind trusted production roots/,
  );
  assert.equal(phaseScenario.fixture.observation().prepareCount, 0);

  const assetScenario = createM251B4CompositionScenario(t, 'm251-b4-asset-substitution');
  assert.throws(
    () =>
      createM251TrustedProductionComposition({
        ...assetScenario.compositionOptions,
        protectedCheckPath: join(assetScenario.sourceRoot, 'src', 'payment.js'),
      }),
    /protected checker does not match the frozen asset/,
  );
  assert.equal(assetScenario.fixture.observation().prepareCount, 0);
});

void test('[M251-B4] Profile preparation rejects an overlapping root before filesystem effects', async (t) => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'codeclosure-m251-b4-profile-roots-')));
  t.after(() => removeProjectReadFixtureRoot(root));
  const sourceRoot = join(root, 'source');
  const candidateRoot = join(root, 'candidate');
  const projectReadRoot = join(root, 'project-read');
  const credentialRoot = join(root, 'credentials');
  for (const path of [sourceRoot, candidateRoot, projectReadRoot, credentialRoot]) {
    mkdirSync(path);
  }
  const authSource = join(credentialRoot, 'auth.json');
  writeFileSync(authSource, '{}\n', { mode: 0o600 });
  const overlappingCodexHome = join(sourceRoot, 'forbidden-codex-home');
  const roots: M251TrustedCodexRoots = Object.freeze({
    codexHome: overlappingCodexHome,
    probeWorkspace: join(root, 'probe'),
    processHome: join(root, 'process-home'),
    stateRoot: join(root, 'state'),
    temporaryDirectory: join(root, 'temporary'),
  });
  await assert.rejects(
    prepareM251TrustedCodexProfile({
      authSource,
      candidateWorkspaceRoot: candidateRoot,
      forbiddenRoots: Object.freeze([sourceRoot, credentialRoot]),
      model: 'gpt-fixture',
      projectReadWorkspaceRoot: projectReadRoot,
      roots,
    }),
    /Profile roots must be pairwise separated/,
  );
  assert.equal(existsSync(overlappingCodexHome), false);
  assert.deepEqual(readdirSync(sourceRoot), []);
});

void test('[M251-B4] Intake clarification rejects another declared project without dispatch', (t) => {
  const scenario = createM251B4CompositionScenario(t, 'm251-b4-clarify-project-substitution');
  const composition = createM251TrustedProductionComposition(scenario.compositionOptions);
  t.after(() => composition.close());
  const otherProject = join(dirname(scenario.sourceRoot), 'other-project');
  mkdirSync(otherProject);
  assert.throws(
    () =>
      composition.intakeApplication.clarify({
        commandId: commandId('command_m251-b4-clarify-project-substitution'),
        intakeRunId: intakeRunId('intake_m251-b4-clarify-project-substitution'),
        expectedIntakeRunVersion: 1,
        clarificationQuestionId: clarificationQuestionId(
          'clarification-question_m251-b4-project-substitution',
        ),
        answer: 'Use the other project.',
        declaredProjectPath: otherProject,
      }),
    /declared another project/,
  );
  assert.equal(scenario.fixture.observation().prepareCount, 0);
});

void test('[M251-B4] production Intake preserves declared constraints and binds them to replay', async (t) => {
  const scenario = createM251B4CompositionScenario(t, 'm251-b4-declared-constraints');
  const delegateResource = scenario.compositionOptions.intakeAssistant;
  const delegate = delegateResource.assistant;
  let analyzeCount = 0;
  let observedConstraints: readonly string[] | undefined;
  const assistant: IntakeAssistantPort = Object.freeze({
    analyze: (
      input: Parameters<IntakeAssistantPort['analyze']>[0],
      signal: Parameters<IntakeAssistantPort['analyze']>[1],
    ) => {
      analyzeCount += 1;
      observedConstraints = input.package.rawRequestRevisions.at(-1)?.declaredConstraints;
      return delegate.analyze(input, signal);
    },
    answer: (
      input: Parameters<IntakeAssistantPort['answer']>[0],
      signal: Parameters<IntakeAssistantPort['answer']>[1],
    ) => delegate.answer(input, signal),
  });
  const composition = createM251TrustedProductionComposition({
    ...scenario.compositionOptions,
    intakeAssistant: Object.freeze({
      assistant,
      prepare: () => delegateResource.prepare(),
      close: () => delegateResource.close(),
    }),
  });
  t.after(() => composition.close());
  const submitCommandId = commandId('command_m251-b4-declared-constraints');
  const declaredConstraints = Object.freeze(['Preserve the public payment API.']);
  const first = await composition.intakeApplication.submit({
    commandId: submitCommandId,
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: scenario.admittedUserContent,
    declaredProjectPath: scenario.sourceRoot,
    declaredConstraints,
  });
  assert.equal(first.kind, 'OUTCOME');
  assert.deepEqual(observedConstraints, declaredConstraints);
  assert.equal(analyzeCount, 1);

  const replay = await composition.intakeApplication.submit({
    commandId: submitCommandId,
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: scenario.admittedUserContent,
    declaredProjectPath: scenario.sourceRoot,
    declaredConstraints,
  });
  assert.equal(replay.kind, 'OUTCOME');
  assert.equal(replay.replayed, true);
  assert.equal(analyzeCount, 1);

  const conflict = await composition.intakeApplication.submit({
    commandId: submitCommandId,
    interactionAction: IntakeInteractionAction.MATERIALIZE_ONLY,
    admittedUserContent: scenario.admittedUserContent,
    declaredProjectPath: scenario.sourceRoot,
    declaredConstraints: Object.freeze(['Change the public payment API.']),
  });
  assert.equal(conflict.kind, 'COMMAND_CONFLICT');
  assert.equal(analyzeCount, 1);
});
