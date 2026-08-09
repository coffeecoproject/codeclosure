import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  AcceptanceOutcome,
  AttemptFailureClass,
  AttemptStatus,
  EvidenceEligibilityState,
  ExternalApprovalPolicy,
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  ExternalCommandNetworkPolicy,
  ExternalCompactionPolicy,
  ExternalContinuityPolicy,
  ExternalExecutionState,
  ExternalFallbackPolicy,
  ExternalInterruptionPolicy,
  ExternalMaintenanceState,
  ExternalPhaseCwdKind,
  ExternalPhaseResponseSchemaPolicy,
  ExternalPhaseSourceAuthorityKind,
  ExternalProjectConfigurationPolicy,
  ExternalRetentionPolicy,
  ExternalThreadPolicy,
  ExternalWorkerDispatchPolicy,
  GoalStatus,
  GuardOutcome,
  RecoveryReasonCode,
  RecoveryReconciliationDisposition,
  RecoveryReconciliationPurpose,
  RunStatus,
  WorkflowPhase,
  aggregateVersion,
  candidateGenerationId,
  commandId,
  createGoal,
  createWorkflow,
  decodeContextPackage,
  decodeExternalExecutionObservation,
  externalBackendCapabilityRecordProjection,
  externalProcessIdentityProjection,
  executionProfileId,
  deriveCapabilityGrant,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  requiredGuardsForTransition,
  successCriterionId,
  workerEventId,
  workflowId,
  workflowVersion,
  type ExecutionProfile,
  type ExecutionProfileDefinition,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionPhaseDispatchEntry,
  type ExternalExecutionProfileDefinition,
  type ExternalExecutionIntent,
  type Goal,
  type PolicyBundle,
  type PolicyBundleDefinition,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  CandidateWorkspaceAccessMode,
  ExternalExecutionAbandonReasonCode,
  ExternalMaintenanceFailureReasonCode,
  ExternalProcessReconciliationDisposition,
  ExternalWorkerFailureCode,
  GoalDominantBlockerCode,
  GoalNextSafeAction,
  M1_ACCEPTANCE_RULES,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  RuntimeErrorCode,
  WorkflowDriveStopReason,
  contextManifestDigestProjection,
  compileBoundedM2RepairContext,
  createCodeClosureApplication,
  createExecutionProfileInstaller,
  createM1AcceptanceCheckerIdentity,
  createPolicyInstaller,
  decodeCandidateWorkspaceLease,
  decodeWorkerEvent,
  decodeStatusAuthority,
  digestCandidateWorkspaceValue,
  candidateWorkspaceAllowedPathProjection,
  candidateWorkspaceLeaseProjection,
  deriveContextManifestEntries,
  goalAndWorkflowCreationPayloadProjection,
  m1WorkerResponseContract,
  validateCandidateWorkspaceLeaseRequest,
  type CandidateWorkspaceLease,
  type CandidateWorkspaceLeaseAuthorityPort,
  type CandidateWorkspaceLeasePort,
  type CandidateWorkspaceLeaseRequest,
  type Clock,
  type ExternalObservedWorkerPort,
  type ExternalWorkerInvocationPort,
  type LocalCommandVerificationPort,
  type ResumeGoalRequest,
  type WorkerRequest,
  type WorkerPort,
} from '@codeclosure/runtime';
import {
  createRecoveryCoordinator,
  createM2WorkflowDriver,
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
import {
  WorkerTransactionStep,
  openSqliteControlStore,
  type SqliteControlStore,
} from '@codeclosure/store-sqlite';
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
  readonly filename: string;
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

type ExternalFixtureMode =
  'NONE' | 'FAIL_ON_OBSERVATION' | 'MANUAL_BEFORE_OPERATION' | 'REPAIR_ONLY' | 'V3_UNAVAILABLE';

class CountingWorker implements WorkerPort {
  readonly #delegate: FakeWorker;
  readonly #requests: WorkerRequest[] = [];
  #runCount = 0;

  public constructor() {
    this.#delegate = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
  }

  public get runCount(): number {
    return this.#runCount;
  }

  public get requests(): readonly WorkerRequest[] {
    return Object.freeze([...this.#requests]);
  }

  public run(
    request: Parameters<WorkerPort['run']>[0],
    signal: AbortSignal,
  ): AsyncIterable<unknown> {
    this.#runCount += 1;
    this.#requests.push(request);
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

class SequencedLocalCommandRunner implements LocalCommandVerificationPort {
  readonly #exitCodes: readonly number[];
  #runCount = 0;

  public constructor(exitCodes: readonly number[]) {
    if (exitCodes.length === 0) {
      throw new TypeError('Local command sequence is empty');
    }
    this.#exitCodes = Object.freeze([...exitCodes]);
  }

  public get runCount(): number {
    return this.#runCount;
  }

  public run(): Promise<unknown> {
    const exitCode = this.#exitCodes[this.#runCount] ?? this.#exitCodes.at(-1);
    this.#runCount += 1;
    if (exitCode === undefined) {
      throw new Error('Local command sequence is empty');
    }
    return Promise.resolve({
      schemaVersion: 1,
      kind: 'LOCAL_COMMAND_OBSERVATION_V1',
      terminationKind: 'EXITED',
      exitCode,
      stdoutBytes: new Uint8Array(),
      stdoutObservedByteCount: 0,
      stdoutTruncated: false,
      stderrBytes: new Uint8Array(),
      stderrObservedByteCount: 0,
      stderrTruncated: false,
      diagnosticCode: 'NONE',
    });
  }
}

class LogicalCandidateWorkspace
  implements CandidateWorkspaceLeasePort, CandidateWorkspaceLeaseAuthorityPort
{
  readonly #active = new Map<string, CandidateWorkspaceLease>();
  readonly #namespace: string;

  public constructor(namespace: string) {
    this.#namespace = namespace;
  }

  public issueLease(rawRequest: CandidateWorkspaceLeaseRequest): unknown {
    const request = validateCandidateWorkspaceLeaseRequest(rawRequest);
    const workspaceRootIdentity = `/fixture/${this.#namespace}-workspace`;
    const sourceProjectRoot = `/fixture/${this.#namespace}-source`;
    const forbiddenRoots = Object.freeze(
      [...new Set([...request.forbiddenRoots, sourceProjectRoot])].sort(),
    );
    const withoutDigest = Object.freeze({
      accessMode: request.accessMode,
      allowedPathPolicyDigest: digestCandidateWorkspaceValue(
        candidateWorkspaceAllowedPathProjection(request.allowedPaths),
      ),
      allowedPaths: request.allowedPaths,
      candidateId: request.generation.candidateId,
      candidateDigest: request.generation.frozenDigest ?? request.generation.baseDigest,
      candidateGenerationId: request.generation.id,
      candidateGenerationVersion: request.generation.version,
      forbiddenRoots,
      generationSequence: request.generation.sequence,
      goalId: request.goalId,
      goalRevision: request.goalRevision,
      id: request.id,
      issuedAt: request.issuedAt,
      lifecyclePolicy:
        request.accessMode === CandidateWorkspaceAccessMode.READ_ONLY
          ? ('RELEASE_EXPLICITLY' as const)
          : ('REVOKE_ON_FREEZE' as const),
      parentGenerationId: request.generation.parentGenerationId ?? null,
      reservedPathPolicy: 'M2_CONTROLLED_COPY_V1' as const,
      retentionPolicy: 'RUNTIME_OWNED' as const,
      root: `${workspaceRootIdentity}/candidates/${request.generation.id}`,
      schemaVersion: 1 as const,
      sourceGitMetadataDigest: digests.digest({
        schemaVersion: 1,
        type: 'SLICE6_LOGICAL_SOURCE_GIT_METADATA',
        generationId: request.generation.id,
      }),
      sourceProjectRoot,
      sourceTreeDigest: request.generation.baseDigest,
      state: 'ACTIVE' as const,
      version: request.version,
      workspaceRootIdentity,
      workflowId: request.workflowId,
      workflowVersion: request.workflowVersion,
    });
    const lease = decodeCandidateWorkspaceLease({
      ...withoutDigest,
      leaseDigest: digestCandidateWorkspaceValue(candidateWorkspaceLeaseProjection(withoutDigest)),
    });
    this.#active.set(lease.id, lease);
    return lease;
  }

  public assertLeaseCurrent(rawLease: CandidateWorkspaceLease): CandidateWorkspaceLease {
    const lease = decodeCandidateWorkspaceLease(rawLease);
    const current = this.#active.get(lease.id);
    if (current?.leaseDigest !== lease.leaseDigest) {
      throw new TypeError('Candidate workspace lease is not current');
    }
    return current;
  }

  public releaseLease(rawLease: CandidateWorkspaceLease): void {
    const lease = this.assertLeaseCurrent(rawLease);
    this.#active.delete(lease.id);
  }
}

class ExternalWorkerFixture implements ExternalWorkerInvocationPort {
  readonly #blocking: boolean;
  readonly #backendFailureCode: unknown;
  readonly #mode: Exclude<ExternalFixtureMode, 'NONE'>;
  readonly #resultBinding: 'MATCH' | 'MISMATCH';
  readonly #store: SqliteControlStore;
  #createCount = 0;
  readonly #intents: ExternalExecutionIntent[] = [];
  readonly #events: ReturnType<typeof decodeWorkerEvent>[] = [];
  #prepareCount = 0;
  readonly #requests: WorkerRequest[] = [];
  #releaseCount = 0;
  #releaseBlockedRun!: () => void;
  readonly #blockedRunReleased: Promise<void>;
  #resolveRunStarted!: () => void;
  readonly #runStarted: Promise<void>;
  #runCount = 0;

  public constructor(
    store: SqliteControlStore,
    mode: Exclude<ExternalFixtureMode, 'NONE'>,
    blocking = false,
    backendFailureCode?: unknown,
    resultBinding: 'MATCH' | 'MISMATCH' = 'MATCH',
  ) {
    this.#store = store;
    this.#mode = mode;
    this.#blocking = blocking;
    this.#backendFailureCode = backendFailureCode;
    this.#resultBinding = resultBinding;
    this.#runStarted = new Promise((resolve) => {
      this.#resolveRunStarted = resolve;
    });
    this.#blockedRunReleased = new Promise((resolve) => {
      this.#releaseBlockedRun = resolve;
    });
  }

  public get createCount(): number {
    return this.#createCount;
  }

  public get intents(): readonly ExternalExecutionIntent[] {
    return Object.freeze([...this.#intents]);
  }

  public get events(): readonly ReturnType<typeof decodeWorkerEvent>[] {
    return Object.freeze([...this.#events]);
  }

  public get prepareCount(): number {
    return this.#prepareCount;
  }

  public get releaseCount(): number {
    return this.#releaseCount;
  }

  public get requests(): readonly WorkerRequest[] {
    return Object.freeze([...this.#requests]);
  }

  public get runCount(): number {
    return this.#runCount;
  }

  public get runStarted(): Promise<void> {
    return this.#runStarted;
  }

  public releaseBlockedRun(): void {
    this.#releaseBlockedRun();
  }

  public prepare(
    input: Parameters<ExternalWorkerInvocationPort['prepare']>[0],
  ): ReturnType<ExternalWorkerInvocationPort['prepare']> {
    this.#prepareCount += 1;
    assert.equal(input.thread.kind, ExternalThreadPolicy.FRESH);
    assert.equal(input.request.contextPackage.phase, WorkflowPhase.IMPLEMENT);
    assert.equal(this.#store.getWorkerDispatchClaim(input.request.attemptId), undefined);
    assert.equal(this.#store.getExternalExecutionForAttempt(input.request.attemptId), undefined);
    const request = input.request;
    const leaseDigest = digests.digest({
      attemptId: request.attemptId,
      kind: 'slice6-external-candidate-lease',
    });
    return Object.freeze({
      candidateWorkspaceLeaseId: `lease_${request.attemptId}`,
      candidateWorkspaceLeaseDigest: leaseDigest,
      candidateWorkspaceCwdIdentity: `/fixture/external/${request.attemptId}`,
      createWorker: ({
        intent,
        onLifecycleEvent,
      }: {
        readonly intent: ExternalExecutionIntent;
        readonly onLifecycleEvent: (event: unknown) => void;
      }) => {
        this.#createCount += 1;
        const retained = this.#store.getExternalExecution(intent.id);
        assert.ok(retained);
        assert.equal(retained.state, ExternalExecutionState.AUTHORIZED);
        assert.equal(retained.intentDigest, intent.intentDigest);
        if (this.#mode === 'MANUAL_BEFORE_OPERATION') {
          assert.equal(
            this.#store.getExternalMaintenanceIntentForExecution(intent.id, 1)?.state,
            ExternalMaintenanceState.AUTHORIZED,
          );
        }
        this.#intents.push(intent);
        let backendOperationRef: string | undefined;
        let backendSessionRef: string | undefined;
        let failureCode: unknown;
        let resultEventId: ReturnType<typeof decodeWorkerEvent>['id'] | undefined;
        let state: 'READY' | 'RUNNING' | 'COMPLETED' | 'FAILED' | 'INTERRUPTED' = 'READY';
        let turnInterruptCount = 0;
        const recordRun = (rawRequest: WorkerRequest): void => {
          this.#runCount += 1;
          this.#resolveRunStarted();
          this.#requests.push(rawRequest);
        };
        const backendFailureCode = this.#backendFailureCode;
        const blocking = this.#blocking;
        const blockedRunReleased = this.#blockedRunReleased;
        const recordEvent = (event: ReturnType<typeof decodeWorkerEvent>): void => {
          this.#events.push(event);
        };
        const compactionCount = this.#mode === 'MANUAL_BEFORE_OPERATION' ? 1 : 0;
        const resultBinding = this.#resultBinding;
        const worker: ExternalObservedWorkerPort = Object.freeze({
          async *run(rawRequest: WorkerRequest, signal: AbortSignal): AsyncIterable<unknown> {
            recordRun(rawRequest);
            const processIdentityWithoutDigest = Object.freeze({
              schemaVersion: 1 as const,
              launchNonce: intent.processLaunchNonce,
              processId: 10_000 + intent.id.length,
              processGroupId: 10_000 + intent.id.length,
              processGroupKind: 'POSIX_PROCESS_GROUP' as const,
              processStartIdentity: `fixture-start:${intent.id}`,
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
              requestAttemptId: request.attemptId,
              requestWorkerSessionId: request.workerSessionId,
              processIdentity,
            });
            backendSessionRef = `thread-${intent.id}`;
            onLifecycleEvent({
              schemaVersion: 1,
              kind: 'SESSION_STARTED',
              externalExecutionIntentDigest: intent.intentDigest,
              requestAttemptId: request.attemptId,
              requestWorkerSessionId: request.workerSessionId,
              backendSessionRef,
            });
            backendOperationRef = `turn-${intent.id}`;
            state = 'RUNNING';
            onLifecycleEvent({
              schemaVersion: 1,
              kind: 'OPERATION_STARTED',
              externalExecutionIntentDigest: intent.intentDigest,
              requestAttemptId: request.attemptId,
              requestWorkerSessionId: request.workerSessionId,
              backendSessionRef,
              backendOperationRef,
              compactionCount,
            });
            try {
              if (backendFailureCode !== undefined) {
                failureCode = backendFailureCode;
                state = 'FAILED';
                return;
              }
              if (blocking) {
                await Promise.race([
                  blockedRunReleased,
                  new Promise<void>((resolve) => {
                    if (signal.aborted) {
                      resolve();
                      return;
                    }
                    signal.addEventListener('abort', () => resolve(), { once: true });
                  }),
                ]);
                if (signal.aborted) {
                  turnInterruptCount = 1;
                  failureCode = 'HOST_CANCELLED';
                  state = 'INTERRUPTED';
                  return;
                }
              }
              const delegate = new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT });
              for await (const rawEvent of delegate.run(rawRequest, signal)) {
                const event = decodeWorkerEvent(rawEvent);
                recordEvent(event);
                resultEventId = event.id;
                yield rawEvent;
              }
              state = 'COMPLETED';
            } finally {
              const observedResultEventId =
                resultEventId === undefined
                  ? undefined
                  : resultBinding === 'MATCH'
                    ? resultEventId
                    : workerEventId('worker-event_slice6-mismatched-observation');
              onLifecycleEvent({
                schemaVersion: 1,
                kind: 'TERMINAL',
                externalExecutionIntentDigest: intent.intentDigest,
                requestAttemptId: request.attemptId,
                requestWorkerSessionId: request.workerSessionId,
                state,
                processLaunchCount: 1,
                backendSessionRef,
                backendOperationRef,
                compactionCount,
                turnInterruptCount,
                ...(failureCode === undefined ? {} : { failureCode }),
                ...(observedResultEventId === undefined
                  ? {}
                  : { resultEventId: observedResultEventId }),
              });
            }
          },
          observation: () =>
            Object.freeze({
              schemaVersion: 1,
              externalExecutionIntentDigest: intent.intentDigest,
              requestAttemptId: request.attemptId,
              requestWorkerSessionId: request.workerSessionId,
              state,
              processLaunchCount: state === 'READY' ? 0 : 1,
              ...(backendSessionRef === undefined ? {} : { backendSessionRef }),
              ...(backendOperationRef === undefined ? {} : { backendOperationRef }),
              compactionCount,
              turnInterruptCount,
              ...(failureCode === undefined ? {} : { failureCode }),
              ...(resultEventId === undefined
                ? {}
                : {
                    resultEventId:
                      resultBinding === 'MATCH'
                        ? resultEventId
                        : workerEventId('worker-event_slice6-mismatched-observation'),
                  }),
            }),
        });
        return worker;
      },
      release: () => {
        this.#releaseCount += 1;
      },
    });
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

function externalProfileAuthority(
  namespace: string,
  mode: Exclude<ExternalFixtureMode, 'NONE'>,
): Readonly<{
  capability: ExternalBackendCapabilityRecord;
  profile: ExecutionProfileDefinition;
}> {
  const binaryIdentityDigest = digests.digest({ namespace, kind: 'binary' });
  const protocolSchemaDigest = digests.digest({ namespace, kind: 'protocol-schema' });
  const configurationProfileDigest = digests.digest({ namespace, kind: 'configuration' });
  const selectedCapabilities = [
    ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
    ExternalBackendCapability.FRESH_SESSION,
    ExternalBackendCapability.OPERATION_INTERRUPT,
    ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
    ...(mode === 'MANUAL_BEFORE_OPERATION'
      ? [
          ExternalBackendCapability.MANUAL_COMPACTION,
          ExternalBackendCapability.POST_COMPACTION_CONTINUATION,
        ]
      : []),
  ].toSorted();
  const capabilityWithoutDigest: Omit<ExternalBackendCapabilityRecord, 'recordDigest'> =
    Object.freeze({
      schemaVersion: 1,
      backendKind: 'CODEX_APP_SERVER',
      binaryIdentityDigest,
      protocolSchemaDigest,
      configurationProfileDigest,
      capabilityEntries: Object.freeze(
        selectedCapabilities.map((capability) =>
          Object.freeze({
            capability,
            classification: ExternalBackendCapabilityClassification.SUPPORTED,
            proofKind: 'DETERMINISTIC_SLICE6_FIXTURE',
          }),
        ),
      ),
      observedAt: createdAt,
    });
  const capability: ExternalBackendCapabilityRecord = Object.freeze({
    ...capabilityWithoutDigest,
    recordDigest: digests.digest(
      externalBackendCapabilityRecordProjection(capabilityWithoutDigest),
    ),
  });
  const externalExecutionBase = {
    backendKind: capability.backendKind,
    capabilityRecordDigest: capability.recordDigest,
    selectedCapabilities: Object.freeze(selectedCapabilities),
    workerPhases: Object.freeze([WorkflowPhase.IMPLEMENT]),
    binaryIdentityDigest,
    protocolSchemaDigest,
    configurationProfileDigest,
    executionConfigDigest: digests.digest({ namespace, kind: 'execution-config' }),
    managedRequirementsDigest: digests.digest({ namespace, kind: 'managed-requirements' }),
    instructionSourceManifestDigest: digests.digest({ namespace, kind: 'instructions' }),
    controlledStateRootIdentity: `/fixture/${namespace}/controlled-state`,
    environmentProjectionDigest: digests.digest({ namespace, kind: 'environment' }),
    permissionProfileId: 'codeclosure-m2-fixture',
    permissionProfileDigest: digests.digest({ namespace, kind: 'permission-profile' }),
    model: 'gpt-fixture',
    modelProvider: 'openai',
    serviceTier: null,
    reasoningEffort: 'low',
    responseSchemaPolicy: 'M2_CLOSED_WORKER_RESULT_V1',
    disabledIntegrationsDigest: digests.digest({ namespace, kind: 'disabled-integrations' }),
    defaultThreadPolicy: ExternalThreadPolicy.FRESH,
    continuityPolicy: ExternalContinuityPolicy.SAME_SESSION_BOUNDED_OPERATION,
    compactionPolicy:
      mode === 'MANUAL_BEFORE_OPERATION'
        ? ExternalCompactionPolicy.MANUAL_BEFORE_OPERATION
        : ExternalCompactionPolicy.FAIL_ON_OBSERVATION,
    retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
    fallbackPolicy: ExternalFallbackPolicy.FAIL_CLOSED,
    interruptionPolicy: ExternalInterruptionPolicy.INTERRUPT_OPERATION,
  };
  const externalExecution: ExternalExecutionProfileDefinition =
    mode === 'V3_UNAVAILABLE'
      ? (() => {
          const phases = Object.freeze([
            WorkflowPhase.DISCOVERY,
            WorkflowPhase.IMPLEMENT,
            WorkflowPhase.PLAN,
          ]);
          const activityPolicyDigest = digests.digest({
            namespace,
            kind: 'worker-activity-policy',
          });
          const phaseDispatch = Object.freeze(
            phases.map((phase): ExternalExecutionPhaseDispatchEntry => {
              const candidateFree = phase !== WorkflowPhase.IMPLEMENT;
              const instructionSources = Object.freeze([]);
              return Object.freeze({
                phase,
                workerAdapter: 'slice6-external-worker',
                workerAdapterVersion: 'm2-5-1-v1',
                cwdKind: candidateFree
                  ? ExternalPhaseCwdKind.PROJECT_READ_SNAPSHOT
                  : ExternalPhaseCwdKind.CANDIDATE_WORKSPACE,
                sourceAuthorityKind: candidateFree
                  ? ExternalPhaseSourceAuthorityKind.PROJECT_READ
                  : ExternalPhaseSourceAuthorityKind.CANDIDATE,
                permissionProfileId: `permission-${phase.toLowerCase()}-v1`,
                permissionProfileDigest: digests.digest({ namespace, phase, kind: 'permission' }),
                isolationProfileId: `isolation-${phase.toLowerCase()}-v1`,
                isolationProfileDigest: digests.digest({ namespace, phase, kind: 'isolation' }),
                projectConfigurationPolicy: ExternalProjectConfigurationPolicy.DISABLED,
                configurationProfileDigest,
                executionConfigDigest: digests.digest({
                  namespace,
                  phase,
                  kind: 'execution-config-v3',
                }),
                disabledIntegrationsDigest: digests.digest({
                  namespace,
                  phase,
                  kind: 'disabled-integrations-v3',
                }),
                instructionSourceManifestId: `instructions-${phase.toLowerCase()}-v1`,
                instructionSourceManifestDigest: digests.digest({ instructionSources }),
                instructionSources,
                capabilityGrantDigest: digests.digest({
                  schemaVersion: 1,
                  capabilityGrant: deriveCapabilityGrant(phase),
                }),
                responseContractDigest: digests.digest({
                  schemaVersion: 1,
                  responseContract: m1WorkerResponseContract(phase),
                }),
                responseSchemaPolicy: candidateFree
                  ? ExternalPhaseResponseSchemaPolicy.PROPOSALS_V1
                  : ExternalPhaseResponseSchemaPolicy.COMPLETION_REQUEST_V1,
                workerActivityPolicyId: 'codex-worker-activity-policy_codeclosure-m2-5-1-real',
                workerActivityPolicyDigest: activityPolicyDigest,
                commandNetworkPolicy: ExternalCommandNetworkPolicy.DENIED,
                approvalPolicy: ExternalApprovalPolicy.NEVER,
                continuityPolicy: ExternalContinuityPolicy.SAME_SESSION_BOUNDED_OPERATION,
                compactionPolicy: ExternalCompactionPolicy.FAIL_ON_OBSERVATION,
                fallbackPolicy: ExternalFallbackPolicy.FAIL_CLOSED,
                allowedRoots: Object.freeze([`/fixture/${namespace}/${phase.toLowerCase()}`]),
                forbiddenRoots: Object.freeze(['/fixture/authority', '/source/project']),
              });
            }),
          );
          return Object.freeze({
            schemaVersion: 3,
            backendKind: capability.backendKind,
            capabilityRecordDigest: capability.recordDigest,
            selectedCapabilities: Object.freeze(selectedCapabilities),
            workerPhases: phases,
            binaryIdentityDigest,
            protocolSchemaDigest,
            managedRequirementsDigest: externalExecutionBase.managedRequirementsDigest,
            controlledStateRootIdentity: externalExecutionBase.controlledStateRootIdentity,
            environmentProjectionDigest: externalExecutionBase.environmentProjectionDigest,
            model: externalExecutionBase.model,
            modelProvider: externalExecutionBase.modelProvider,
            serviceTier: externalExecutionBase.serviceTier,
            reasoningEffort: externalExecutionBase.reasoningEffort,
            defaultThreadPolicy: ExternalThreadPolicy.FRESH,
            retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
            interruptionPolicy: ExternalInterruptionPolicy.INTERRUPT_OPERATION,
            workerDispatchPolicy: ExternalWorkerDispatchPolicy.ALL_SELECTED_ATTEMPTS,
            phaseDispatch,
          });
        })()
      : mode === 'REPAIR_ONLY'
        ? Object.freeze({
            schemaVersion: 2,
            ...externalExecutionBase,
            workerDispatchPolicy: ExternalWorkerDispatchPolicy.ACCEPTANCE_REPAIR_ONLY,
          })
        : Object.freeze({ schemaVersion: 1, ...externalExecutionBase });
  const base = testExecutionProfileDefinition(namespace);
  return Object.freeze({
    capability,
    profile: Object.freeze({
      ...base,
      schemaVersion: 2,
      id: executionProfileId(`profile_${namespace}-external-v2`),
      version: 'm2-external-driver-profile-v2',
      workerAdapter: 'slice6-external-worker',
      workerAdapterVersion: '1.0.0',
      driverVersion: 'm2-workflow-driver-v2',
      externalExecution,
    }),
  });
}

function createHarness(
  t: TestContext,
  namespace: string,
  externalMode: ExternalFixtureMode = 'NONE',
  transactionProbe?: NonNullable<Parameters<typeof openSqliteControlStore>[0]['transactionProbe']>,
): DriverHarness {
  const directory = mkdtempSync(join(tmpdir(), `codeclosure-driver-${namespace}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'state.sqlite');
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    ...(transactionProbe === undefined ? {} : { transactionProbe }),
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
    scope: Object.freeze({
      projectPath: `/fixture/${namespace}`,
      allowedPaths: Object.freeze(externalMode === 'NONE' ? [] : ['src']),
    }),
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
  const external =
    externalMode === 'NONE' ? undefined : externalProfileAuthority(namespace, externalMode);
  if (external !== undefined) {
    const capabilityInstall = store.installExternalBackendCapabilityRecord({
      record: external.capability,
      auditEventId: ids.nextAuditEventId(),
      payloadDigest: external.capability.recordDigest,
    });
    assert.equal(capabilityInstall.status, 'INSTALLED');
  }
  const profileInstall = createExecutionProfileInstaller({
    store,
    clock,
    ids,
    digests,
  }).installExecutionProfile(external?.profile ?? testExecutionProfileDefinition(namespace));
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
    payloadDigest: digests.digest(goalAndWorkflowCreationPayloadProjection(goal, workflow)),
  });
  assert.equal(creation.status, 'APPLIED');

  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm1-context-compiler-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  });
  return Object.freeze({
    filename,
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

function externalRuntimeProfile(
  harness: DriverHarness,
  externalWorker: ExternalWorkerInvocationPort,
  localRunner: LocalCommandVerificationPort = new SequencedLocalCommandRunner([0]),
): RuntimeExecutionProfile {
  assert.equal(harness.profile.schemaVersion, 2);
  return Object.freeze({
    schemaVersion: 2,
    profileId: harness.profile.id,
    profileDigest: harness.profile.digest,
    driverVersion: harness.profile.driverVersion,
    worker: new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
    externalWorker,
    candidateSource: new FakeCandidateSource(),
    verification: new FakeVerificationRunner(),
    localCommandVerification: Object.freeze({
      workspace: new LogicalCandidateWorkspace(harness.goal.id),
      runner: localRunner,
      profile: Object.freeze({
        forbiddenRoots: Object.freeze(['/fixture/authority']),
        check: Object.freeze({
          version: 'slice6.local-command.1',
          producerIdentity: harness.profile.verificationRunner,
          operation: 'local-command.execute',
          runnerIdentity: harness.profile.verificationRunner,
          runnerVersion: harness.profile.verificationRunnerVersion,
          executablePath: '/fixture/bin/slice6-check',
          executableDigest: digests.digest({ kind: 'slice6-check' }),
          declaredToolVersion: 'slice6-fixture',
          argv: Object.freeze(['--check']),
          cwd: '.',
          environmentVariables: Object.freeze([]),
          isolationProfileId: 'slice6-logical-isolation',
          isolationProfileDigest: digests.digest({ kind: 'slice6-isolation' }),
          timeoutMilliseconds: 1_000,
          terminationGraceMilliseconds: 100,
          stdoutLimitBytes: 1_024,
          stderrLimitBytes: 1_024,
          totalOutputLimitBytes: 2_048,
          payloadRetentionLimitBytes: 2_048,
          acceptedExitCodes: Object.freeze([0]),
        }),
      }),
    }),
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

function m2Driver(
  harness: DriverHarness,
  profile: RuntimeExecutionProfile,
  recovery: Parameters<typeof createM2WorkflowDriver>[0]['recovery'],
  maxOperations?: number,
) {
  return createM2WorkflowDriver({
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

void test('[I-004][I-023][I-027] legacy Driver rejects external Profile v3 without fake or Adapter fallback', async (t) => {
  const harness = createHarness(t, 'driver-external-v3-unavailable', 'V3_UNAVAILABLE');
  const localWorker = new CountingWorker();
  const externalWorker = new ExternalWorkerFixture(harness.store, 'V3_UNAVAILABLE');
  const profile = Object.freeze({
    ...externalRuntimeProfile(harness, externalWorker),
    worker: localWorker,
  });
  const execution = m2Driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('Unavailable v3 composition must not enter recovery');
      },
    }),
  );

  const result = await execution.startGoal(startRequest(harness));
  assert.equal(result.command.status, 'REJECTED');
  assert.equal(result.command.output.ok, false);
  assert.equal(
    result.command.output.error.detailCode,
    'DRIVER_EXTERNAL_PROFILE_V3_COMPOSITION_UNAVAILABLE',
  );
  assert.equal(result.drive, undefined);
  assert.equal(harness.store.getWorkflow(harness.workflow.id)?.runStatus, RunStatus.READY);
  assert.equal(harness.store.getWorkflow(harness.workflow.id)?.activeAttemptId, undefined);
  assert.equal(localWorker.runCount, 0);
  assert.equal(externalWorker.prepareCount, 0);
  assert.equal(externalWorker.createCount, 0);
  assert.equal(externalWorker.runCount, 0);
  assert.equal(externalWorker.intents.length, 0);
  assert.equal(
    harness.store
      .getGoalAuditAuthority(harness.goal.id)
      ?.events.some(({ eventType }) => eventType.startsWith('EXTERNAL_')),
    false,
  );
});

void test('[I-006][I-008][M2-G12] external dispatch claim and authorization roll back before adapter creation at every new write boundary', async (t) => {
  for (const faultStep of [
    WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_AUDIT_WRITE,
    WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_WRITE,
  ]) {
    await t.test(faultStep, async (subtest) => {
      let injected = false;
      const harness = createHarness(
        subtest,
        `driver-external-atomic-${faultStep.toLowerCase().replaceAll('_', '-')}`,
        'FAIL_ON_OBSERVATION',
        (step) => {
          if (!injected && step === faultStep) {
            injected = true;
            throw new Error(`injected:${faultStep}`);
          }
        },
      );
      const externalWorker = new ExternalWorkerFixture(harness.store, 'FAIL_ON_OBSERVATION');
      const profile = externalRuntimeProfile(harness, externalWorker);
      const execution = m2Driver(
        harness,
        profile,
        Object.freeze({
          resumeGoal: () => {
            throw new Error('Atomic-dispatch fixture does not enter recovery');
          },
        }),
      );

      const result = await execution.startGoal(startRequest(harness));
      assert.equal(injected, true);
      assert.ok(result.drive);
      assert.equal(result.drive.stopReason, WorkflowDriveStopReason.INFRASTRUCTURE_FAILURE);
      assert.equal(result.drive.detailCode, 'DRIVER_EXTERNAL_DISPATCH_AUTHORIZATION_FAILED');
      assert.equal(externalWorker.prepareCount, 1);
      assert.equal(externalWorker.createCount, 0);
      assert.equal(externalWorker.runCount, 0);
      assert.equal(externalWorker.releaseCount, 1);
      const authority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
      assert.ok(authority?.latestPhaseAttempt);
      assert.equal(authority.latestPhaseAttempt.phase, WorkflowPhase.IMPLEMENT);
      assert.equal(authority.latestPhaseAttempt.status, AttemptStatus.FAILED);
      assert.equal(
        harness.store.getWorkerDispatchClaim(authority.latestPhaseAttempt.id),
        undefined,
      );
      assert.equal(
        harness.store.getExternalExecutionForAttempt(authority.latestPhaseAttempt.id),
        undefined,
      );
    });
  }
});

void test('[I-006][I-008][M2-G01][M2-G12] maintenance authorization rolls back before adapter creation at every write boundary', async (t) => {
  for (const faultStep of [
    WorkerTransactionStep.AFTER_EXTERNAL_MAINTENANCE_AUDIT_WRITE,
    WorkerTransactionStep.AFTER_EXTERNAL_MAINTENANCE_WRITE,
  ]) {
    await t.test(faultStep, async (subtest) => {
      let injected = false;
      const harness = createHarness(
        subtest,
        `driver-external-maintenance-atomic-${faultStep.toLowerCase().replaceAll('_', '-')}`,
        'MANUAL_BEFORE_OPERATION',
        (step) => {
          if (!injected && step === faultStep) {
            injected = true;
            throw new Error(`injected:${faultStep}`);
          }
        },
      );
      const externalWorker = new ExternalWorkerFixture(harness.store, 'MANUAL_BEFORE_OPERATION');
      const execution = m2Driver(
        harness,
        externalRuntimeProfile(harness, externalWorker),
        Object.freeze({
          resumeGoal: () => {
            throw new Error('Maintenance-authorization fixture does not enter recovery');
          },
        }),
      );

      const result = await execution.startGoal(startRequest(harness));
      assert.equal(injected, true);
      assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);
      assert.equal(externalWorker.createCount, 0);
      assert.equal(externalWorker.runCount, 0);
      assert.equal(externalWorker.releaseCount, 1);
      const authority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
      assert.ok(authority?.latestPhaseAttempt);
      assert.equal(authority.latestPhaseAttempt.status, AttemptStatus.FAILED);
      const retained = harness.store.getExternalExecutionForAttempt(
        authority.latestPhaseAttempt.id,
      );
      assert.ok(retained);
      assert.equal(retained.state, ExternalExecutionState.ABANDONED);
      assert.equal(
        retained.failureCode,
        ExternalExecutionAbandonReasonCode.MAINTENANCE_AUTHORIZATION_FAILED,
      );
      assert.equal(
        harness.store.getExternalMaintenanceIntentForExecution(retained.id, 1),
        undefined,
      );
      const reopened = openSqliteControlStore({
        filename: harness.filename,
        now: () => createdAt,
      });
      subtest.after(() => reopened.close());
      assert.deepEqual(
        reopened.getExternalExecutionForAttempt(authority.latestPhaseAttempt.id),
        retained,
      );
    });
  }
});

void test('[I-006][I-008][M2-G01] external observation and maintenance completion failures roll back without partial lifecycle authority', async (t) => {
  const cases = [
    {
      mode: 'FAIL_ON_OBSERVATION' as const,
      step: WorkerTransactionStep.AFTER_EXTERNAL_OBSERVATION_AUDIT_WRITE,
      occurrence: 1,
    },
    {
      mode: 'FAIL_ON_OBSERVATION' as const,
      step: WorkerTransactionStep.AFTER_EXTERNAL_OBSERVATION_WRITE,
      occurrence: 1,
    },
    {
      mode: 'FAIL_ON_OBSERVATION' as const,
      step: WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_AUDIT_WRITE,
      occurrence: 2,
    },
    {
      mode: 'FAIL_ON_OBSERVATION' as const,
      step: WorkerTransactionStep.AFTER_EXTERNAL_EXECUTION_WRITE,
      occurrence: 2,
    },
    {
      mode: 'MANUAL_BEFORE_OPERATION' as const,
      step: WorkerTransactionStep.AFTER_EXTERNAL_MAINTENANCE_AUDIT_WRITE,
      occurrence: 2,
    },
    {
      mode: 'MANUAL_BEFORE_OPERATION' as const,
      step: WorkerTransactionStep.AFTER_EXTERNAL_MAINTENANCE_WRITE,
      occurrence: 2,
    },
  ] as const;
  for (const faultCase of cases) {
    await t.test(
      `${faultCase.mode}:${faultCase.step}:${String(faultCase.occurrence)}`,
      async (subtest) => {
        let observedOccurrence = 0;
        let injected = false;
        const harness = createHarness(
          subtest,
          `driver-external-observation-atomic-${faultCase.mode.toLowerCase().replaceAll('_', '-')}-${faultCase.step.toLowerCase().replaceAll('_', '-')}-${String(faultCase.occurrence)}`,
          faultCase.mode,
          (step) => {
            if (step !== faultCase.step) {
              return;
            }
            observedOccurrence += 1;
            if (!injected && observedOccurrence === faultCase.occurrence) {
              injected = true;
              throw new Error(`injected:${faultCase.step}`);
            }
          },
        );
        const externalWorker = new ExternalWorkerFixture(harness.store, faultCase.mode);
        const execution = m2Driver(
          harness,
          externalRuntimeProfile(harness, externalWorker),
          Object.freeze({
            resumeGoal: () => {
              throw new Error('Observation-failure fixture does not enter recovery');
            },
          }),
        );

        const result = await execution.startGoal(startRequest(harness));
        assert.equal(injected, true);
        assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);
        assert.equal(externalWorker.createCount, 1);
        assert.equal(externalWorker.runCount, 1);
        assert.equal(externalWorker.releaseCount, 1);
        const authority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
        assert.ok(authority?.latestPhaseAttempt);
        assert.equal(authority.latestPhaseAttempt.status, AttemptStatus.FAILED);
        const retained = harness.store.getExternalExecutionForAttempt(
          authority.latestPhaseAttempt.id,
        );
        assert.ok(retained);
        assert.equal(retained.state, ExternalExecutionState.ABANDONED);
        assert.equal(
          retained.failureCode,
          ExternalExecutionAbandonReasonCode.OBSERVATION_ADMISSION_FAILED,
        );
        if (faultCase.mode === 'MANUAL_BEFORE_OPERATION') {
          assert.ok(retained.lastObservationId);
        } else {
          assert.equal(retained.lastObservationId, undefined);
        }
        const maintenance = harness.store.getExternalMaintenanceIntentForExecution(retained.id, 1);
        if (faultCase.mode === 'MANUAL_BEFORE_OPERATION') {
          assert.ok(maintenance);
          assert.equal(maintenance.state, ExternalMaintenanceState.FAILED);
          assert.equal(
            maintenance.failureCode,
            ExternalMaintenanceFailureReasonCode.OBSERVATION_ADMISSION_FAILED,
          );
        } else {
          assert.equal(maintenance, undefined);
        }
        const reopened = openSqliteControlStore({
          filename: harness.filename,
          now: () => createdAt,
        });
        subtest.after(() => reopened.close());
        assert.deepEqual(
          reopened.getExternalExecutionForAttempt(authority.latestPhaseAttempt.id),
          retained,
        );
        assert.deepEqual(
          reopened.getExternalMaintenanceIntentForExecution(retained.id, 1),
          maintenance,
        );
      },
    );
  }
});

void test('[I-004][I-008][I-027][M2-G13] external IMPLEMENT is authorized before one manual-compaction Turn and reopens as bounded authority', async (t) => {
  const harness = createHarness(t, 'driver-external-manual', 'MANUAL_BEFORE_OPERATION');
  const externalWorker = new ExternalWorkerFixture(harness.store, 'MANUAL_BEFORE_OPERATION');
  const profile = externalRuntimeProfile(harness, externalWorker);
  const execution = m2Driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('ResumeGoal is not exercised by the external happy fixture');
      },
    }),
  );

  const result = await execution.startGoal(startRequest(harness));
  assert.equal(result.command.status, 'APPLIED');
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.CLOSED);
  assert.equal(externalWorker.prepareCount, 1);
  assert.equal(externalWorker.createCount, 1);
  assert.equal(externalWorker.runCount, 1);
  assert.equal(externalWorker.releaseCount, 1);
  assert.equal(externalWorker.intents.length, 1);
  const intent = externalWorker.intents[0];
  assert.ok(intent);
  assert.equal(intent.thread.kind, ExternalThreadPolicy.FRESH);
  const retained = harness.store.getExternalExecution(intent.id);
  assert.ok(retained);
  assert.equal(retained.state, ExternalExecutionState.COMPLETED);
  assert.equal(retained.compactionCount, 1);
  assert.equal(retained.resultEventId === undefined, false);
  assert.equal(
    harness.store.getExternalMaintenanceIntentForExecution(intent.id, 1)?.state,
    ExternalMaintenanceState.OBSERVED,
  );
  assert.equal(externalWorker.requests[0]?.contextPackage.schemaVersion, 2);
  assert.ok(retained.lastObservationId);
  const terminalObservation = harness.store.getExternalExecutionObservation(
    retained.lastObservationId,
  );
  assert.ok(terminalObservation);
  assert.throws(
    () =>
      decodeExternalExecutionObservation({
        ...terminalObservation,
        state: ExternalExecutionState.FAILED,
        failureCode: ExternalWorkerFailureCode.CLIENT_FAILURE,
      }),
    /result Event does not match terminal state/,
  );

  const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getExternalExecution(intent.id), retained);
  assert.deepEqual(
    reopened.getExternalMaintenanceIntentForExecution(intent.id, 1),
    harness.store.getExternalMaintenanceIntentForExecution(intent.id, 1),
  );
});

void test('[I-004][I-008][M2-F10][M2-G14][M2-G15] repair uses a fresh external Session and exact Context v3 without old Thread history', async (t) => {
  const harness = createHarness(t, 'driver-external-repair', 'FAIL_ON_OBSERVATION');
  const externalWorker = new ExternalWorkerFixture(harness.store, 'FAIL_ON_OBSERVATION');
  const verification = new SequencedLocalCommandRunner([1, 0]);
  const profile = externalRuntimeProfile(harness, externalWorker, verification);
  const execution = m2Driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('ResumeGoal is not exercised by the external repair fixture');
      },
    }),
  );

  const first = await execution.startGoal(startRequest(harness));
  assert.equal(first.drive?.stopReason, WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED);
  const rejected = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(rejected?.acceptanceAuthority);
  const rejection = rejected.acceptanceAuthority;
  const repaired = await execution.repairGoal({
    commandId: commandId('command_driver-external-repair-authorize'),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: rejected.workflow.version,
    acceptanceDecisionId: rejection.decision.id,
    acceptanceDecisionDigest: rejection.decision.decisionDigest,
    inputManifestDigest: rejection.manifest.manifestDigest,
    candidateDigest: rejection.manifest.candidateDigest,
    reason: 'bounded Slice 6 repair authorization',
  });
  assert.equal(repaired.command.status, 'APPLIED');
  assert.equal(
    repaired.drive?.stopReason,
    WorkflowDriveStopReason.CLOSED,
    JSON.stringify(repaired),
  );
  assert.equal(verification.runCount, 2);
  assert.equal(externalWorker.intents.length, 2);
  assert.equal(externalWorker.requests.length, 2);
  const [firstIntent, repairIntent] = externalWorker.intents;
  assert.ok(firstIntent);
  assert.ok(repairIntent);
  assert.notEqual(firstIntent.attemptId, repairIntent.attemptId);
  assert.notEqual(firstIntent.workerSessionId, repairIntent.workerSessionId);
  assert.equal(firstIntent.thread.kind, ExternalThreadPolicy.FRESH);
  assert.equal(repairIntent.thread.kind, ExternalThreadPolicy.FRESH);
  const repairRequest = externalWorker.requests[1];
  assert.ok(repairRequest);
  assert.equal(repairRequest.contextPackage.schemaVersion, 3);
  const repairContext = repairRequest.contextPackage.repairContext;
  const priorAttemptFeedback = repairRequest.contextPackage.priorAttemptFeedback;
  assert.ok(repairContext);
  assert.ok(priorAttemptFeedback);
  assert.equal(repairContext.acceptanceDecisionId, rejection.decision.id);
  assert.equal(
    priorAttemptFeedback.items.some((item) => item.sourceRefs.includes(rejection.decision.id)),
    true,
  );
  const serializedRepairContext = JSON.stringify(repairRequest.contextPackage);
  assert.equal(serializedRepairContext.includes('thread-'), false);
  assert.equal(serializedRepairContext.includes('transcript'), false);
  assert.equal(serializedRepairContext.includes('reasoning'), false);

  const repairRecord = harness.store.getAcceptanceRepairForRepairGeneration(
    repairContext.repairCandidateGenerationId,
  );
  assert.ok(repairRecord);
  const decision = harness.store.getAcceptanceDecision(repairRecord.acceptanceDecisionId);
  const manifest = harness.store.getAcceptanceInputManifest(repairRecord.inputManifestDigest);
  const evidenceSet = harness.store.getEvidenceSet(repairRecord.evidenceSetDigest);
  const parent = harness.store.getCandidateGeneration(repairRecord.rejectedCandidateGenerationId);
  const child = harness.store.getCandidateGeneration(repairRecord.repairCandidateGenerationId);
  assert.ok(decision);
  assert.ok(manifest);
  assert.ok(evidenceSet);
  assert.ok(parent);
  assert.ok(child);
  const evidence = evidenceSet.evidenceRefs.map((reference) => {
    const record = harness.store.getEvidence(reference.evidenceId);
    const eligibility = harness.store.getEvidenceEligibilityVersion(
      reference.evidenceId,
      reference.eligibilityVersion,
    );
    assert.ok(record);
    assert.ok(eligibility);
    return Object.freeze({ record, eligibility });
  });
  const freezeRecords = harness.store
    .listEvidenceForGeneration(parent.id)
    .filter(({ record }) => record.kind === 'CANDIDATE_FREEZE');
  assert.equal(freezeRecords.length, 1);
  const freezeRecord = freezeRecords[0]?.record;
  assert.ok(freezeRecord);
  const freezeEligibility = harness.store.getEvidenceEligibilityVersion(
    freezeRecord.id,
    aggregateVersion(1),
  );
  assert.ok(freezeEligibility);
  const sources = Object.freeze({
    goal: harness.goal,
    workflowId: harness.workflow.id,
    contextWorkflowVersion: repairRequest.contextPackage.workflowVersion,
    policyBundleId: repairRecord.policyBundleId,
    policyBundleDigest: repairRecord.policyBundleDigest,
    repair: repairRecord,
    decision,
    manifest,
    evidenceSet,
    parent,
    child,
    freezeEvidence: Object.freeze({ record: freezeRecord, eligibility: freezeEligibility }),
    evidence: Object.freeze(evidence),
  });
  const recompiled = compileBoundedM2RepairContext(sources, digests);
  assert.deepEqual(recompiled.repairContext, repairContext);
  assert.deepEqual(recompiled.priorAttemptFeedback, priorAttemptFeedback);
  const firstEvidence = evidence[0];
  assert.ok(firstEvidence);
  const adversarialSources = [
    Object.freeze({
      ...sources,
      goal: Object.freeze({ ...harness.goal, id: goalId('goal_wrong-repair-context') }),
    }),
    Object.freeze({
      ...sources,
      decision: Object.freeze({ ...decision, outcome: AcceptanceOutcome.ACCEPT }),
    }),
    Object.freeze({
      ...sources,
      child: Object.freeze({
        ...child,
        parentGenerationId: candidateGenerationId('generation_wrong-repair-parent'),
      }),
    }),
    Object.freeze({ ...sources, evidence: Object.freeze([]) }),
    Object.freeze({
      ...sources,
      evidence: Object.freeze([
        Object.freeze({
          ...firstEvidence,
          eligibility: Object.freeze({
            ...firstEvidence.eligibility,
            state: EvidenceEligibilityState.INELIGIBLE,
          }),
        }),
      ]),
    }),
    Object.freeze({
      ...sources,
      freezeEvidence: Object.freeze({
        record: freezeRecord,
        eligibility: Object.freeze({
          ...freezeEligibility,
          evidenceId: firstEvidence.record.id,
        }),
      }),
    }),
  ];
  for (const adversarial of adversarialSources) {
    assert.throws(() => compileBoundedM2RepairContext(adversarial, digests), /Repair Context/);
  }
  assert.equal(
    priorAttemptFeedback.items.every(
      (item) => item.sourceRefs.length > 0 && item.sourceRefs.length === item.sourceDigests.length,
    ),
    true,
  );
});

void test('[I-004][I-008][M2-G14][M2-G15] repair-only dispatch keeps the initial Attempt local and admits exactly one externally audited repair', async (t) => {
  const harness = createHarness(t, 'driver-external-repair-only', 'REPAIR_ONLY');
  const localWorker = new CountingWorker();
  const externalWorker = new ExternalWorkerFixture(harness.store, 'REPAIR_ONLY');
  const verification = new SequencedLocalCommandRunner([1, 0]);
  const profile = Object.freeze({
    ...externalRuntimeProfile(harness, externalWorker, verification),
    worker: localWorker,
  });
  const execution = m2Driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('ResumeGoal is not exercised by the repair-only fixture');
      },
    }),
  );

  const first = await execution.startGoal(startRequest(harness));
  assert.equal(first.drive?.stopReason, WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED);
  assert.deepEqual(
    localWorker.requests.map(({ contextPackage }) => contextPackage.phase),
    [WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN, WorkflowPhase.IMPLEMENT],
  );
  assert.equal(externalWorker.prepareCount, 0);
  assert.equal(externalWorker.createCount, 0);
  assert.equal(externalWorker.runCount, 0);
  assert.equal(externalWorker.intents.length, 0);
  assert.equal(
    harness.store
      .getGoalAuditAuthority(harness.goal.id)
      ?.events.some(({ eventType }) => eventType.startsWith('EXTERNAL_')),
    false,
  );

  const rejected = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(rejected?.acceptanceAuthority);
  const rejection = rejected.acceptanceAuthority;
  const repaired = await execution.repairGoal({
    commandId: commandId('command_driver-external-repair-only-authorize'),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: rejected.workflow.version,
    acceptanceDecisionId: rejection.decision.id,
    acceptanceDecisionDigest: rejection.decision.decisionDigest,
    inputManifestDigest: rejection.manifest.manifestDigest,
    candidateDigest: rejection.manifest.candidateDigest,
    reason: 'one profile-bound external repair handoff',
  });
  assert.equal(repaired.command.status, 'APPLIED');
  assert.equal(
    repaired.drive?.stopReason,
    WorkflowDriveStopReason.CLOSED,
    JSON.stringify(repaired),
  );
  assert.equal(localWorker.runCount, 3);
  assert.equal(externalWorker.prepareCount, 1);
  assert.equal(externalWorker.createCount, 1);
  assert.equal(externalWorker.runCount, 1);
  assert.equal(externalWorker.releaseCount, 1);
  assert.equal(externalWorker.intents.length, 1);
  assert.equal(externalWorker.requests.length, 1);
  const repairRequest = externalWorker.requests[0];
  assert.ok(repairRequest?.contextPackage.repairContext);
  assert.equal(repairRequest.contextPackage.schemaVersion, 3);
  assert.equal(externalWorker.intents[0]?.thread.kind, ExternalThreadPolicy.FRESH);

  const application = createCodeClosureApplication({
    store: harness.store,
    clock: harness.clock,
    creationIds: harness.ids,
    digests,
    projectPaths: Object.freeze({ parseNormalizedAbsolute: (path: string) => path }),
    execution,
  });
  const audit = application.getGoalAudit(harness.goal.id);
  assert.equal(audit.status, 'FOUND');
  const externalEventTypes = audit.view.events
    .map(({ eventType }) => eventType)
    .filter((eventType) => eventType.startsWith('EXTERNAL_'));
  assert.deepEqual(externalEventTypes, [
    'EXTERNAL_EXECUTION_AUTHORIZED',
    'EXTERNAL_EXECUTION_OBSERVED',
    'EXTERNAL_EXECUTION_STATE_CHANGED',
    'EXTERNAL_EXECUTION_OBSERVED',
    'EXTERNAL_EXECUTION_STATE_CHANGED',
    'EXTERNAL_EXECUTION_OBSERVED',
    'EXTERNAL_EXECUTION_STATE_CHANGED',
    'EXTERNAL_EXECUTION_OBSERVED',
    'EXTERNAL_EXECUTION_STATE_CHANGED',
  ]);

  const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.deepEqual(
    reopened.getGoalAuditAuthority(harness.goal.id),
    harness.store.getGoalAuditAuthority(harness.goal.id),
  );
});

void test('[I-008][I-009][M2-F11][M2-G16][M2-G17] a failed repair remains stopped through reopen, replay, Resume, stale authority, and late events', async (t) => {
  const harness = createHarness(t, 'driver-external-repair-stop', 'FAIL_ON_OBSERVATION');
  const externalWorker = new ExternalWorkerFixture(harness.store, 'FAIL_ON_OBSERVATION');
  const verification = new SequencedLocalCommandRunner([1, 1]);
  const profile = externalRuntimeProfile(harness, externalWorker, verification);
  const execution = m2Driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('ResumeGoal is not exercised by the failed-repair fixture');
      },
    }),
  );
  const first = await execution.startGoal(startRequest(harness));
  assert.equal(first.drive?.stopReason, WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED);
  const rejected = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(rejected?.acceptanceAuthority);
  assert.ok(rejected.candidateAuthority);
  const rejection = rejected.acceptanceAuthority;
  const generationOneId = rejected.candidateAuthority.generation.id;
  const generationOneEvidence = harness.store.listEvidenceForGeneration(generationOneId);
  assert.equal(generationOneEvidence.length > 0, true);
  const repairRequest = Object.freeze({
    commandId: commandId('command_driver-external-failed-repair'),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: rejected.workflow.version,
    acceptanceDecisionId: rejection.decision.id,
    acceptanceDecisionDigest: rejection.decision.decisionDigest,
    inputManifestDigest: rejection.manifest.manifestDigest,
    candidateDigest: rejection.manifest.candidateDigest,
    reason: 'one bounded failed repair',
  });
  const repaired = await execution.repairGoal(repairRequest);
  assert.equal(repaired.command.status, 'APPLIED');
  assert.equal(
    repaired.drive?.stopReason,
    WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED,
    JSON.stringify(repaired),
  );
  assert.equal(externalWorker.intents.length, 2);
  assert.equal(externalWorker.runCount, 2);
  const stopped = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(stopped);
  assert.ok(stopped.candidateAuthority);
  assert.ok(stopped.acceptanceAuthority);
  assert.equal(stopped.candidateAuthority.generation.sequence, 2);
  const generationTwoId = stopped.candidateAuthority.generation.id;
  assert.notEqual(generationTwoId, generationOneId);
  assert.equal(stopped.acceptanceAuthority.manifest.candidateGenerationId, generationTwoId);
  const generationTwoEvidenceSet = harness.store.getEvidenceSet(
    stopped.acceptanceAuthority.manifest.evidenceSetDigest,
  );
  assert.ok(generationTwoEvidenceSet);
  assert.equal(
    generationTwoEvidenceSet.evidenceRefs.every(
      (reference) =>
        harness.store.getEvidence(reference.evidenceId)?.candidateGenerationId === generationTwoId,
    ),
    true,
  );
  assert.deepEqual(harness.store.listEvidenceForGeneration(generationOneId), generationOneEvidence);

  const replay = await execution.repairGoal(repairRequest);
  assert.equal(replay.command.status, 'REPLAYED');
  assert.ok(replay.drive);
  assert.equal(replay.drive.stopReason, WorkflowDriveStopReason.ACCEPTANCE_REPAIR_REQUIRED);
  assert.equal(replay.drive.operationCount, 0);
  assert.equal(externalWorker.intents.length, 2);
  assert.equal(externalWorker.runCount, 2);
  assert.equal(
    harness.store.getWorkflowDriverAuthority(harness.goal.id)?.candidateAuthority?.generation
      .sequence,
    2,
  );

  const reopenedStore = openSqliteControlStore({
    filename: harness.filename,
    now: () => createdAt,
  });
  t.after(() => reopenedStore.close());
  const reopenedHarness: DriverHarness = Object.freeze({
    ...harness,
    store: reopenedStore,
  });
  const reopenedRecovery = createRecoveryCoordinator({
    store: reopenedStore,
    clock: harness.clock,
    ids: harness.ids,
    digests,
    policyBundleId: harness.policy.id,
    policyBundleDigest: harness.policy.digest,
    inspector: new FakeRecoveryInspector([FakeRecoveryInspectionMode.EXACT]),
    inspectorVersion: 'slice6-failed-repair-inspector-v1',
    recoveryPolicyVersion: 'm2-failed-repair-stop-v1',
  });
  const reopenedExecution = m2Driver(reopenedHarness, profile, reopenedRecovery);
  const reopenedAuthority = reopenedStore.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(reopenedAuthority);
  const resume = await reopenedExecution.resumeGoal({
    commandId: commandId('command_driver-external-failed-repair-resume'),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: reopenedAuthority.workflow.version,
  });
  assert.equal(resume.command.output.ok, false);

  const staleRepair = await reopenedExecution.repairGoal({
    ...repairRequest,
    commandId: commandId('command_driver-external-stale-repair-authority'),
    expectedWorkflowVersion: reopenedAuthority.workflow.version,
  });
  assert.equal(staleRepair.command.output.ok, false);

  const oldEvent = externalWorker.events[0];
  const oldRequest = externalWorker.requests[0];
  assert.ok(oldEvent);
  assert.ok(oldRequest);
  const lateEvent = decodeWorkerEvent({
    ...oldEvent,
    id: workerEventId('worker-event_slice6-late-generation-one'),
  });
  const lateAdmission = kernel(reopenedHarness, profile).admitWorkerEvent(lateEvent, oldRequest);
  assert.notEqual(lateAdmission.status, 'ADMITTED');
  assert.equal(externalWorker.intents.length, 2);
  assert.equal(externalWorker.runCount, 2);
  const finalAuthority = reopenedStore.getWorkflowDriverAuthority(harness.goal.id);
  assert.equal(finalAuthority?.candidateAuthority?.generation.sequence, 2);
  assert.deepEqual(reopenedStore.listEvidenceForGeneration(generationOneId), generationOneEvidence);
});

void test('[I-008][I-010][M2-G04] governed cancellation aborts the exact external operation and admits no late Worker result', async (t) => {
  const harness = createHarness(t, 'driver-external-cancel', 'FAIL_ON_OBSERVATION');
  const externalWorker = new ExternalWorkerFixture(harness.store, 'FAIL_ON_OBSERVATION', true);
  const profile = externalRuntimeProfile(harness, externalWorker);
  const execution = m2Driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('ResumeGoal is not exercised by the cancellation fixture');
      },
    }),
  );
  const running = execution.startGoal(startRequest(harness));
  await externalWorker.runStarted;
  const current = harness.store.getWorkflow(harness.workflow.id);
  assert.ok(current);
  const cancelled = execution.cancelGoal({
    commandId: commandId('command_driver-external-cancel-current'),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: current.version,
    reason: 'governed user cancellation',
  });
  assert.equal(cancelled.status, 'APPLIED');
  const result = await running;
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.CANCELLED);
  assert.equal(externalWorker.runCount, 1);
  const intent = externalWorker.intents[0];
  assert.ok(intent);
  const retained = harness.store.getExternalExecution(intent.id);
  assert.ok(retained);
  assert.equal(retained.state, ExternalExecutionState.INTERRUPTED);
  assert.equal(retained.turnInterruptCount, 1);
  assert.equal(retained.resultEventId, undefined);
});

void test('[I-008][I-028][M2-G05] one observed backend failure blocks visibly without hidden launch or dispatch retry', async (t) => {
  const harness = createHarness(t, 'driver-external-backend-failure', 'FAIL_ON_OBSERVATION');
  const externalWorker = new ExternalWorkerFixture(
    harness.store,
    'FAIL_ON_OBSERVATION',
    false,
    ExternalWorkerFailureCode.CLIENT_FAILURE,
  );
  const profile = externalRuntimeProfile(harness, externalWorker);
  const execution = m2Driver(
    harness,
    profile,
    Object.freeze({
      resumeGoal: () => {
        throw new Error('Backend-failure fixture does not enter recovery');
      },
    }),
  );

  const result = await execution.startGoal(startRequest(harness));
  assert.equal(result.command.status, 'APPLIED');
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.FAILED);
  assert.equal(externalWorker.prepareCount, 1);
  assert.equal(externalWorker.createCount, 1);
  assert.equal(externalWorker.runCount, 1);
  assert.equal(externalWorker.intents.length, 1);
  const intent = externalWorker.intents[0];
  assert.ok(intent);
  const retained = harness.store.getExternalExecution(intent.id);
  assert.ok(retained);
  assert.equal(retained.state, ExternalExecutionState.FAILED);
  assert.equal(retained.failureCode, ExternalWorkerFailureCode.CLIENT_FAILURE);
  assert.equal(retained.resultEventId, undefined);

  const replay = await execution.startGoal(startRequest(harness));
  assert.equal(replay.command.status, 'REPLAYED');
  assert.ok(replay.drive);
  assert.equal(replay.drive.stopReason, WorkflowDriveStopReason.FAILED);
  assert.equal(replay.drive.operationCount, 0);
  assert.equal(externalWorker.prepareCount, 1);
  assert.equal(externalWorker.runCount, 1);
  assert.deepEqual(harness.store.getExternalExecution(intent.id), retained);
});

void test('[I-006][I-018][I-027][M2-C09] external completion cannot bind a different Worker event identity', async (t) => {
  const harness = createHarness(t, 'driver-external-result-binding', 'FAIL_ON_OBSERVATION');
  const externalWorker = new ExternalWorkerFixture(
    harness.store,
    'FAIL_ON_OBSERVATION',
    false,
    undefined,
    'MISMATCH',
  );
  const execution = m2Driver(
    harness,
    externalRuntimeProfile(harness, externalWorker),
    Object.freeze({
      resumeGoal: () => {
        throw new Error('Result-binding fixture does not enter recovery');
      },
    }),
  );

  const result = await execution.startGoal(startRequest(harness));
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);
  const authority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(authority?.latestPhaseAttempt);
  const retained = harness.store.getExternalExecutionForAttempt(authority.latestPhaseAttempt.id);
  assert.ok(retained);
  assert.equal(retained.state, ExternalExecutionState.ABANDONED);
  assert.equal(retained.failureCode, ExternalExecutionAbandonReasonCode.INVALID_WORKER_OBSERVATION);
  assert.equal(retained.resultEventId, undefined);
  assert.equal(
    harness.store.getWorkerEventReceipt(
      workerEventId('worker-event_slice6-mismatched-observation'),
    ),
    undefined,
  );
});

void test('[I-006][I-018][I-027][M2-G09] unrecognized adapter failure detail is rejected and never enters retained authority', async (t) => {
  const harness = createHarness(t, 'driver-external-unrecognized-failure', 'FAIL_ON_OBSERVATION');
  const unsafeDetail = 'raw adapter exception token=do-not-retain';
  const externalWorker = new ExternalWorkerFixture(
    harness.store,
    'FAIL_ON_OBSERVATION',
    false,
    unsafeDetail,
  );
  const execution = m2Driver(
    harness,
    externalRuntimeProfile(harness, externalWorker),
    Object.freeze({
      resumeGoal: () => {
        throw new Error('Unrecognized-failure fixture does not enter recovery');
      },
    }),
  );

  const result = await execution.startGoal(startRequest(harness));
  assert.equal(result.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);
  assert.equal(externalWorker.createCount, 1);
  assert.equal(externalWorker.runCount, 1);
  const authority = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(authority?.latestPhaseAttempt);
  const retained = harness.store.getExternalExecutionForAttempt(authority.latestPhaseAttempt.id);
  assert.ok(retained);
  assert.equal(retained.state, ExternalExecutionState.ABANDONED);
  assert.equal(retained.failureCode, ExternalExecutionAbandonReasonCode.INVALID_WORKER_OBSERVATION);
  assert.equal(JSON.stringify(retained).includes(unsafeDetail), false);
  assert.ok(retained.lastObservationId);
});

void test('[I-008][I-009][I-010][M2-G06][M2-G07][M2-G08] restart abandons the old external dispatch before a fresh governed resume', async (t) => {
  const harness = createHarness(t, 'driver-external-recovery', 'MANUAL_BEFORE_OPERATION');
  const externalWorker = new ExternalWorkerFixture(harness.store, 'MANUAL_BEFORE_OPERATION', true);
  const profile = externalRuntimeProfile(harness, externalWorker);
  const inspector = new FakeRecoveryInspector([
    FakeRecoveryInspectionMode.EXACT,
    FakeRecoveryInspectionMode.EXACT,
  ]);
  let processReconciliationCount = 0;
  const recovery = createRecoveryCoordinator({
    store: harness.store,
    // Recovery must floor a rolled-back wall clock against retained external
    // execution and maintenance authority rather than failing or backdating it.
    clock: Object.freeze({ now: () => createdAt }),
    ids: harness.ids,
    digests,
    policyBundleId: harness.policy.id,
    policyBundleDigest: harness.policy.digest,
    inspector,
    externalProcessReconciler: Object.freeze({
      reconcile: (identity: { readonly identityDigest: string }) => {
        processReconciliationCount += 1;
        if (processReconciliationCount === 1) {
          externalWorker.releaseBlockedRun();
        }
        return Object.freeze({
          schemaVersion: 1,
          processIdentityDigest: identity.identityDigest,
          disposition:
            processReconciliationCount === 1
              ? ExternalProcessReconciliationDisposition.TERMINATED
              : ExternalProcessReconciliationDisposition.ABSENT,
          observationRef: `fixture-process-reconciliation:${String(processReconciliationCount)}`,
        });
      },
    }),
    inspectorVersion: 'slice6-external-recovery-inspector-v1',
    recoveryPolicyVersion: 'm2-external-exact-same-phase-v1',
  });
  const execution = m2Driver(harness, profile, recovery);

  const running = execution.startGoal(startRequest(harness));
  await externalWorker.runStarted;
  const active = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(active?.activeAttempt);
  assert.ok(active.candidateAuthority);
  const oldAttemptId = active.activeAttempt.id;
  const generationId = active.candidateAuthority.generation.id;
  const oldClaim = harness.store.getWorkerDispatchClaim(oldAttemptId);
  const oldExecution = harness.store.getExternalExecutionForAttempt(oldAttemptId);
  assert.ok(oldClaim);
  assert.ok(oldExecution);
  assert.equal(oldExecution.state, ExternalExecutionState.OPERATION_RUNNING);
  assert.ok(oldExecution.processIdentity);
  assert.equal(
    harness.store.getExternalMaintenanceIntentForExecution(oldExecution.id, 1)?.state,
    ExternalMaintenanceState.OBSERVED,
  );

  const startup = recovery.recoverOnStartup();
  assert.equal(startup.reconciledCount, 1);
  assert.equal(processReconciliationCount, 1);
  assert.equal(harness.store.getAttempt(oldAttemptId)?.status, AttemptStatus.INTERRUPTED);
  const abandoned = harness.store.getExternalExecutionForAttempt(oldAttemptId);
  assert.ok(abandoned);
  assert.equal(abandoned.state, ExternalExecutionState.ABANDONED);
  assert.equal(
    abandoned.failureCode,
    ExternalExecutionAbandonReasonCode.RECOVERY_ABANDONED_ACTIVE_DISPATCH,
  );
  assert.equal(abandoned.resultEventId, undefined);
  const abandonedMaintenance = harness.store.getExternalMaintenanceIntentForExecution(
    abandoned.id,
    1,
  );
  assert.ok(abandonedMaintenance);
  assert.equal(abandonedMaintenance.state, ExternalMaintenanceState.OBSERVED);
  assert.equal(abandonedMaintenance.failureCode, undefined);
  const blocked = harness.store.getWorkflow(harness.workflow.id);
  assert.equal(blocked?.runStatus, RunStatus.BLOCKED);

  const stopped = await running;
  assert.equal(stopped.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);
  assert.deepEqual(harness.store.getWorkerDispatchClaim(oldAttemptId), oldClaim);
  assert.deepEqual(harness.store.getExternalExecutionForAttempt(oldAttemptId), abandoned);

  assert.ok(blocked);
  const resumed = await execution.resumeGoal({
    commandId: commandId('command_driver-external-recovery-resume'),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: blocked.version,
  });
  assert.equal(resumed.command.status, 'APPLIED');
  assert.equal(processReconciliationCount, 2);
  assert.equal(resumed.drive?.stopReason, WorkflowDriveStopReason.CLOSED);
  assert.equal(externalWorker.intents.length, 2);
  const [oldIntent, resumedIntent] = externalWorker.intents;
  assert.ok(oldIntent);
  assert.ok(resumedIntent);
  assert.notEqual(oldIntent.attemptId, resumedIntent.attemptId);
  assert.notEqual(oldIntent.workerSessionId, resumedIntent.workerSessionId);
  assert.equal(resumedIntent.thread.kind, ExternalThreadPolicy.FRESH);
  assert.equal(
    harness.store.getWorkflowDriverAuthority(harness.goal.id)?.candidateAuthority?.generation.id,
    generationId,
  );
  assert.deepEqual(harness.store.getExternalExecutionForAttempt(oldAttemptId), abandoned);

  const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.deepEqual(reopened.getExternalExecutionForAttempt(oldAttemptId), abandoned);
  assert.equal(reopened.getWorkflow(harness.workflow.id)?.runStatus, RunStatus.CLOSED);
});

void test('[I-008][I-009][M2-G06][M2-G08] ambiguous external process identity blocks startup and resume without redispatch', async (t) => {
  const harness = createHarness(
    t,
    'driver-external-recovery-identity-mismatch',
    'MANUAL_BEFORE_OPERATION',
  );
  const externalWorker = new ExternalWorkerFixture(harness.store, 'MANUAL_BEFORE_OPERATION', true);
  const inspector = new FakeRecoveryInspector([
    FakeRecoveryInspectionMode.EXACT,
    FakeRecoveryInspectionMode.EXACT,
  ]);
  let processReconciliationCount = 0;
  const recovery = createRecoveryCoordinator({
    store: harness.store,
    clock: Object.freeze({ now: () => createdAt }),
    ids: harness.ids,
    digests,
    policyBundleId: harness.policy.id,
    policyBundleDigest: harness.policy.digest,
    inspector,
    externalProcessReconciler: Object.freeze({
      reconcile: (identity: { readonly identityDigest: string }) => {
        processReconciliationCount += 1;
        return Object.freeze({
          schemaVersion: 1,
          processIdentityDigest: identity.identityDigest,
          disposition: ExternalProcessReconciliationDisposition.IDENTITY_MISMATCH,
          observationRef: `fixture-process-identity-mismatch:${String(processReconciliationCount)}`,
        });
      },
    }),
    inspectorVersion: 'slice6-external-recovery-inspector-v1',
    recoveryPolicyVersion: 'm2-external-exact-same-phase-v1',
  });
  const execution = m2Driver(harness, externalRuntimeProfile(harness, externalWorker), recovery);

  const running = execution.startGoal(startRequest(harness));
  await externalWorker.runStarted;
  const active = harness.store.getWorkflowDriverAuthority(harness.goal.id);
  assert.ok(active?.activeAttempt);
  const oldAttemptId = active.activeAttempt.id;
  assert.equal(
    harness.store.getExternalExecutionForAttempt(oldAttemptId)?.state,
    ExternalExecutionState.OPERATION_RUNNING,
  );

  const startup = recovery.recoverOnStartup();
  assert.equal(startup.reconciledCount, 1);
  assert.equal(processReconciliationCount, 1);
  const startupRecord = harness.store.getLatestRecoveryReconciliation(harness.workflow.id);
  assert.ok(startupRecord);
  assert.equal(startupRecord.purpose, RecoveryReconciliationPurpose.STARTUP);
  assert.equal(startupRecord.disposition, RecoveryReconciliationDisposition.BLOCKED);
  assert.equal(startupRecord.reasonCode, RecoveryReasonCode.INSPECTOR_FAILURE);
  assert.equal(externalWorker.intents.length, 1);

  externalWorker.releaseBlockedRun();
  const stopped = await running;
  assert.equal(stopped.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);
  const blocked = harness.store.getWorkflow(harness.workflow.id);
  assert.ok(blocked);
  assert.equal(blocked.runStatus, RunStatus.BLOCKED);

  const resumed = await execution.resumeGoal({
    commandId: commandId('command_driver-external-recovery-identity-mismatch-resume'),
    goalId: harness.goal.id,
    expectedGoalRevision: harness.goal.revision,
    expectedWorkflowVersion: blocked.version,
  });
  assert.equal(resumed.command.status, 'APPLIED');
  assert.equal(resumed.drive?.stopReason, WorkflowDriveStopReason.BLOCKED);
  assert.equal(processReconciliationCount, 2);
  assert.equal(externalWorker.intents.length, 1);
  const resumeRecord = harness.store.getLatestRecoveryReconciliation(harness.workflow.id);
  assert.ok(resumeRecord);
  assert.equal(resumeRecord.purpose, RecoveryReconciliationPurpose.RESUME);
  assert.equal(resumeRecord.disposition, RecoveryReconciliationDisposition.BLOCKED);
  assert.equal(resumeRecord.reasonCode, RecoveryReasonCode.INSPECTOR_FAILURE);
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
