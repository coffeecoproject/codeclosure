import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  AttemptStatus,
  GuardOutcome,
  RunStatus,
  WorkflowGuard,
  WorkflowPhase,
  applyAttemptEvent,
  applyWorkflowCancellationToAttempt,
  applyWorkflowEvent,
  attemptId,
  auditEventId,
  candidateGenerationId,
  commandId,
  createGoal,
  createWorkflow,
  decodeExecutionProfile,
  decodeExecutionProfileBinding,
  decodePolicyBundle,
  decodeWorkflowPolicyBinding,
  decodeAttemptEvent,
  decodeWorkflowEvent,
  decideWorkflow,
  deriveGoalStatus,
  goalId,
  goalRevision,
  isoTimestamp,
  executionProfileProjection,
  executionProfileBindingProjection,
  policyBundleId,
  policyBundleProjection,
  workflowPolicyBindingProjection,
  requiredGuardsForTransition,
  sha256Digest,
  successCriterionId,
  workflowId,
  workflowVersion,
  type AppliedAttemptEvent,
  type Attempt,
  type AttemptId,
  type CommandId,
  type ContextManifest,
  type ContextManifestId,
  type ExecutionProfileBinding,
  type Goal,
  type GoalId,
  type GuardResult,
  type IsoTimestamp,
  type Sha256Digest,
  type WorkflowId,
  type WorkflowInstance,
  type WorkflowPolicyBinding,
} from '@codeclosure/domain';
import {
  M1_ACCEPTANCE_RULES,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  RuntimeErrorCode,
  StoredCommandDisposition,
  createAppliedStoredCommandOutcome,
  createRejectedStoredCommandOutcome,
  createM1AcceptanceCheckerIdentity,
  decodeCommandTarget,
  decodeDeterministicCommandError,
  decodeJsonValue,
  storedCommandOutcomeToJson,
  type CommitAttemptEvent,
  type CommitWorkflowEvent,
  type CommandTarget,
  type Clock,
  type DigestProvider,
  type GoalWorkflowView,
  type IdGenerator,
  type InstalledExecutionProfile,
  type InstalledPolicyBundle,
  type JsonValue,
  type ProcessedCommandView,
  type RecordCommandRejection,
  type StoreCommandResult,
  type WorkerControlStore,
} from '@codeclosure/runtime';
import * as publicRuntimeApi from '@codeclosure/runtime';
import {
  createGoalApplication,
  WorkflowRuntimeKernel,
  type GoalApplication,
  type PhaseGuardEvaluator,
} from '@codeclosure/runtime/testing/workflow-runtime';

import { DeterministicClock, DeterministicIds } from '../src/deterministic-fixtures.ts';
import { assertWorkflowControlStoreContract } from '../src/control-store-contract.ts';
import { testExecutionProfileDefinition } from '../src/execution-profile-fixture.ts';

void test('[I-006] JSON authority decoding preserves exact keys and rejects non-JSON shapes', () => {
  const source: unknown = JSON.parse(
    '{"__proto__":{"polluted":true},"safe":[1,null],"constructor":{"name":"data"}}',
  );
  const decoded = decodeJsonValue(source);
  assert.equal(
    JSON.stringify(decoded),
    '{"__proto__":{"polluted":true},"safe":[1,null],"constructor":{"name":"data"}}',
  );
  if (typeof decoded !== 'object' || decoded === null || Array.isArray(decoded)) {
    assert.fail('Decoded JSON fixture must remain an object');
  }
  assert.equal(Object.hasOwn(decoded, '__proto__'), true);
  assert.equal(Object.getPrototypeOf(decoded), Object.prototype);
  assert.equal(Object.isFrozen(decoded), true);

  const cyclic: { self?: unknown } = {};
  cyclic.self = cyclic;
  assert.throws(() => decodeJsonValue(cyclic), /cycles/);

  const sparse: unknown[] = [];
  sparse.length = 1;
  assert.throws(() => decodeJsonValue(sparse), /dense data arrays/);

  const accessor: Record<string, unknown> = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
  assert.throws(() => decodeJsonValue(accessor), /data properties/);
});

class FixtureDigestProvider implements DigestProvider {
  public digest(value: unknown): Sha256Digest {
    const serialized = JSON.stringify({ value });
    return sha256Digest(`sha256:${createHash('sha256').update(serialized).digest('hex')}`);
  }
}

class InMemoryWorkflowStore implements WorkerControlStore {
  #goal: Goal;
  #workflow: WorkflowInstance;
  readonly #attempts = new Map<string, Attempt>();
  readonly #processed = new Map<string, ProcessedCommandView>();
  readonly #contextManifests = new Map<ContextManifestId, ContextManifest>();
  #installedPolicy: InstalledPolicyBundle | undefined;
  #installedProfile: InstalledExecutionProfile | undefined;
  #policyBinding: WorkflowPolicyBinding | undefined;
  #profileBinding: ExecutionProfileBinding | undefined;
  #advanceVersionOnNextWrite = false;
  #authorityOverride: GoalWorkflowView | undefined;
  #nextSequenceOverride: number | undefined;
  public attemptCommits = 0;
  public workflowCommits = 0;
  public lastRejectionCompletedAt: IsoTimestamp | undefined;

  public constructor(goal: Goal, workflow: WorkflowInstance) {
    this.#goal = goal;
    this.#workflow = workflow;
  }

  public getGoal(identifier: GoalId): Goal | undefined {
    return identifier === this.#goal.id ? this.#goal : undefined;
  }

  public getGoalWithWorkflow(
    identifier: GoalId,
  ): { readonly goal: Goal; readonly workflow: WorkflowInstance } | undefined {
    return identifier === this.#goal.id
      ? (this.#authorityOverride ?? Object.freeze({ goal: this.#goal, workflow: this.#workflow }))
      : undefined;
  }

  public getWorkflow(identifier: WorkflowId): WorkflowInstance | undefined {
    return identifier === this.#workflow.id ? this.#workflow : undefined;
  }

  public getWorkflowForGoal(identifier: GoalId): WorkflowInstance | undefined {
    return identifier === this.#goal.id ? this.#workflow : undefined;
  }

  public getAttempt(identifier: AttemptId): Attempt | undefined {
    return this.#attempts.get(identifier);
  }

  public getProcessedCommand(identifier: CommandId): ProcessedCommandView | undefined {
    return this.#processed.get(identifier);
  }

  public nextAttemptSequence(identifier: WorkflowId): number {
    if (identifier !== this.#workflow.id) {
      throw new TypeError('Unknown Workflow');
    }
    return this.#nextSequenceOverride ?? this.#attempts.size + 1;
  }

  public injectConcurrentVersionAdvance(): void {
    this.#advanceVersionOnNextWrite = true;
  }

  public injectProcessedCommand(record: ProcessedCommandView): void {
    this.#processed.set(record.commandId, record);
  }

  public injectAuthorityView(view: GoalWorkflowView): void {
    this.#authorityOverride = view;
  }

  public injectNextAttemptSequence(sequence: number): void {
    this.#nextSequenceOverride = sequence;
  }

  public seedWorkerAuthority(
    installedPolicy: InstalledPolicyBundle,
    installedProfile: InstalledExecutionProfile,
  ): void {
    this.#installedPolicy = installedPolicy;
    this.#installedProfile = installedProfile;
  }

  public seedWorkflowBindings(
    policyBinding: WorkflowPolicyBinding,
    profileBinding: ExecutionProfileBinding,
  ): void {
    this.#policyBinding = policyBinding;
    this.#profileBinding = profileBinding;
  }

  public removeInstalledPolicy(): void {
    this.#installedPolicy = undefined;
  }

  public removeInstalledExecutionProfile(): void {
    this.#installedProfile = undefined;
  }

  public getContextManifest(identifier: ContextManifestId): ContextManifest | undefined {
    return this.#contextManifests.get(identifier);
  }

  public getWorkerDispatchClaim(): ReturnType<WorkerControlStore['getWorkerDispatchClaim']> {
    return undefined;
  }

  public getWorkerEventReceipt(): ReturnType<WorkerControlStore['getWorkerEventReceipt']> {
    return undefined;
  }

  public getPolicyBundle(
    identifier: Parameters<WorkerControlStore['getPolicyBundle']>[0],
  ): InstalledPolicyBundle | undefined {
    return this.#installedPolicy?.bundle.id === identifier ? this.#installedPolicy : undefined;
  }

  public getExecutionProfile(
    identifier: Parameters<WorkerControlStore['getExecutionProfile']>[0],
  ): InstalledExecutionProfile | undefined {
    return this.#installedProfile?.profile.id === identifier ? this.#installedProfile : undefined;
  }

  public getExecutionProfileBinding(identifier: WorkflowId): ExecutionProfileBinding | undefined {
    return this.#profileBinding?.workflowId === identifier ? this.#profileBinding : undefined;
  }

  public getWorkflowPolicyBinding(identifier: WorkflowId): WorkflowPolicyBinding | undefined {
    return this.#policyBinding?.workflowId === identifier ? this.#policyBinding : undefined;
  }

  public installPolicyBundle(
    input: Parameters<WorkerControlStore['installPolicyBundle']>[0],
  ): ReturnType<WorkerControlStore['installPolicyBundle']> {
    if (this.#installedPolicy === undefined) {
      this.#installedPolicy = Object.freeze({
        bundle: input.bundle,
        installedAt: input.installedAt,
      });
      return { status: 'INSTALLED', value: this.#installedPolicy };
    }
    return JSON.stringify(this.#installedPolicy.bundle) === JSON.stringify(input.bundle)
      ? { status: 'EXISTING', value: this.#installedPolicy }
      : { status: 'POLICY_CONFLICT', message: 'Policy fixture conflict' };
  }

  public installExecutionProfile(
    input: Parameters<WorkerControlStore['installExecutionProfile']>[0],
  ): ReturnType<WorkerControlStore['installExecutionProfile']> {
    if (this.#installedProfile === undefined) {
      this.#installedProfile = Object.freeze({
        profile: input.profile,
        installedAt: input.installedAt,
      });
      return { status: 'INSTALLED', value: this.#installedProfile };
    }
    return JSON.stringify(this.#installedProfile.profile) === JSON.stringify(input.profile)
      ? { status: 'EXISTING', value: this.#installedProfile }
      : { status: 'PROFILE_CONFLICT', message: 'Execution Profile fixture conflict' };
  }

  public claimWorkerDispatch(): ReturnType<WorkerControlStore['claimWorkerDispatch']> {
    throw new TypeError('Worker dispatch is outside the Runtime command fixture');
  }

  public commitContextBoundAttemptStart(
    input: Parameters<WorkerControlStore['commitContextBoundAttemptStart']>[0],
  ): ReturnType<WorkerControlStore['commitContextBoundAttemptStart']> {
    const result = this.commitAttemptEvent(input);
    if (result.status !== 'APPLIED') {
      return result;
    }
    this.#contextManifests.set(input.contextManifest.id, input.contextManifest);
    this.#policyBinding = input.policyBinding;
    this.#profileBinding = input.executionProfileBinding;
    return {
      status: 'APPLIED',
      outcome: result.outcome,
      value: Object.freeze({
        ...result.value,
        contextManifest: input.contextManifest,
        policyBinding: input.policyBinding,
        executionProfileBinding: input.executionProfileBinding,
      }),
    };
  }

  public commitWorkerAttemptEvent(): ReturnType<WorkerControlStore['commitWorkerAttemptEvent']> {
    throw new TypeError('Worker event admission is outside the Runtime command fixture');
  }

  public recordIgnoredWorkerEvent(): ReturnType<WorkerControlStore['recordIgnoredWorkerEvent']> {
    throw new TypeError('Worker event admission is outside the Runtime command fixture');
  }

  public commitAttemptEvent(input: CommitAttemptEvent): StoreCommandResult<AppliedAttemptEvent> {
    sha256Digest(input.inputDigest);
    sha256Digest(input.payloadDigest);
    auditEventId(input.auditEventId);
    auditEventId(input.workflowAuditEventId);
    decodeCommandTarget(input.target);
    decodeAttemptEvent(input.event);
    const replay = this.replay(input.event.commandId, input.inputDigest, input.target);
    if (replay !== undefined) {
      return replay;
    }
    const injectedConflict = this.takeInjectedVersionConflict();
    if (injectedConflict !== undefined) {
      return injectedConflict;
    }
    const versionConflict = this.versionConflict(input.event.fromWorkflowVersion);
    if (versionConflict !== undefined) {
      return versionConflict;
    }
    const currentAttempt =
      input.event.type === 'ATTEMPT_STARTED'
        ? this.#workflow.activeAttemptId === undefined
          ? undefined
          : this.#attempts.get(this.#workflow.activeAttemptId)
        : this.#attempts.get(input.event.attemptId);
    const applied = applyAttemptEvent(this.#workflow, currentAttempt, input.event);
    const outcome = storedCommandOutcomeToJson(
      createAppliedStoredCommandOutcome(input.target, applied.workflow, input.event.commandId),
    );
    const previousRunStatus = this.#workflow.runStatus;
    this.#workflow = applied.workflow;
    this.syncGoalProjection(previousRunStatus);
    this.#attempts.set(applied.attempt.id, applied.attempt);
    this.#processed.set(
      input.event.commandId,
      this.processed(
        input.event.commandId,
        input.inputDigest,
        input.target,
        outcome,
        input.event.occurredAt,
      ),
    );
    this.attemptCommits += 1;
    return { status: 'APPLIED', outcome, value: applied };
  }

  public commitWorkflowEvent(input: CommitWorkflowEvent): StoreCommandResult<WorkflowInstance> {
    sha256Digest(input.inputDigest);
    sha256Digest(input.payloadDigest);
    auditEventId(input.auditEventId);
    if (input.attemptAuditEventId !== undefined) {
      auditEventId(input.attemptAuditEventId);
    }
    decodeCommandTarget(input.target);
    decodeWorkflowEvent(input.event);
    const replay = this.replay(input.event.commandId, input.inputDigest, input.target);
    if (replay !== undefined) {
      return replay;
    }
    const injectedConflict = this.takeInjectedVersionConflict();
    if (injectedConflict !== undefined) {
      return injectedConflict;
    }
    const versionConflict = this.versionConflict(input.event.fromVersion);
    if (versionConflict !== undefined) {
      return versionConflict;
    }
    const previousRunStatus = this.#workflow.runStatus;
    if (input.event.type === 'WORKFLOW_CANCELLED') {
      const currentAttempt =
        input.event.interruptedAttemptId === undefined
          ? undefined
          : this.#attempts.get(input.event.interruptedAttemptId);
      const applied = applyWorkflowCancellationToAttempt(
        this.#workflow,
        currentAttempt,
        input.event,
      );
      this.#workflow = applied.workflow;
      if (applied.attempt !== undefined) {
        this.#attempts.set(applied.attempt.id, applied.attempt);
      }
    } else {
      this.#workflow = applyWorkflowEvent(this.#workflow, input.event);
    }
    const outcome = storedCommandOutcomeToJson(
      createAppliedStoredCommandOutcome(input.target, this.#workflow, input.event.commandId),
    );
    this.syncGoalProjection(previousRunStatus);
    this.#processed.set(
      input.event.commandId,
      this.processed(
        input.event.commandId,
        input.inputDigest,
        input.target,
        outcome,
        input.event.occurredAt,
      ),
    );
    this.workflowCommits += 1;
    return { status: 'APPLIED', outcome, value: this.#workflow };
  }

  public recordCommandRejection(input: RecordCommandRejection): StoreCommandResult<undefined> {
    commandId(input.commandId);
    sha256Digest(input.inputDigest);
    decodeCommandTarget(input.target);
    workflowId(input.workflowId);
    workflowVersion(input.observedWorkflowVersion);
    decodeDeterministicCommandError(input.error);
    isoTimestamp(input.completedAt);
    const replay = this.replay(input.commandId, input.inputDigest, input.target);
    if (replay !== undefined) {
      return replay;
    }
    const injectedConflict = this.takeInjectedVersionConflict();
    if (injectedConflict !== undefined) {
      return injectedConflict;
    }
    const versionConflict = this.versionConflict(input.observedWorkflowVersion);
    if (versionConflict !== undefined) {
      return versionConflict;
    }
    if (input.completedAt < this.#workflow.updatedAt) {
      throw new TypeError('Rejection completion time predates current Workflow state');
    }
    this.lastRejectionCompletedAt = input.completedAt;
    const outcome = storedCommandOutcomeToJson(
      createRejectedStoredCommandOutcome(
        input.target,
        this.#workflow,
        input.commandId,
        input.error,
      ),
    );
    this.#processed.set(
      input.commandId,
      this.processed(input.commandId, input.inputDigest, input.target, outcome, input.completedAt),
    );
    return { status: 'APPLIED', outcome, value: undefined };
  }

  private replay(
    identifier: CommandId,
    inputDigest: Sha256Digest,
    target: CommandTarget,
  ):
    | { readonly status: 'REPLAYED'; readonly outcome: JsonValue }
    | { readonly status: 'COMMAND_CONFLICT'; readonly message: string }
    | undefined {
    const existing = this.#processed.get(identifier);
    if (existing === undefined) {
      return undefined;
    }
    if (
      existing.inputDigest !== inputDigest ||
      existing.aggregateType !== target.aggregateType ||
      existing.aggregateId !== target.aggregateId
    ) {
      return { status: 'COMMAND_CONFLICT', message: 'Command ID conflict' };
    }
    return { status: 'REPLAYED', outcome: existing.outcome };
  }

  private processed(
    identifier: CommandId,
    inputDigest: Sha256Digest,
    target: CommandTarget,
    outcome: JsonValue,
    completedAt: IsoTimestamp,
  ): ProcessedCommandView {
    const common = {
      commandId: identifier,
      inputDigest,
      outcome,
      completedAt,
    };
    if (target.aggregateType === 'GOAL') {
      return Object.freeze({
        ...common,
        aggregateType: target.aggregateType,
        aggregateId: target.aggregateId,
      });
    }
    return Object.freeze({
      ...common,
      aggregateType: target.aggregateType,
      aggregateId: target.aggregateId,
    });
  }

  private syncGoalProjection(previousRunStatus: WorkflowInstance['runStatus']): void {
    if (previousRunStatus === this.#workflow.runStatus) {
      return;
    }
    this.#goal = Object.freeze({
      ...this.#goal,
      status: deriveGoalStatus(this.#workflow.runStatus),
      updatedAt: this.#workflow.updatedAt,
    });
  }

  private takeInjectedVersionConflict():
    { readonly status: 'VERSION_CONFLICT'; readonly message: string } | undefined {
    if (!this.#advanceVersionOnNextWrite) {
      return undefined;
    }
    this.#advanceVersionOnNextWrite = false;
    this.#workflow = Object.freeze({
      ...this.#workflow,
      version: workflowVersion(this.#workflow.version + 1),
    });
    return { status: 'VERSION_CONFLICT', message: 'Injected concurrent Workflow mutation' };
  }

  private versionConflict(
    expected: number,
  ): { readonly status: 'VERSION_CONFLICT'; readonly message: string } | undefined {
    return this.#workflow.version === expected
      ? undefined
      : { status: 'VERSION_CONFLICT', message: 'Stale Workflow mutation' };
  }
}

function fixtureWorkerAuthority(installedAt: IsoTimestamp): {
  readonly policy: InstalledPolicyBundle;
  readonly profile: InstalledExecutionProfile;
} {
  const digests = new FixtureDigestProvider();
  const policyDefinition = Object.freeze({
    id: policyBundleId('policy_runtime-commands'),
    schemaVersion: 1 as const,
    version: 'm1-runtime-command-policy-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['execution-profile-bound-context']),
    checkSpecifications: Object.freeze(['runtime-owned-check-specifications']),
    applicabilityRules: Object.freeze(['exact-candidate-and-policy']),
    acceptanceRules: M1_ACCEPTANCE_RULES,
    checkerVersions: Object.freeze([createM1AcceptanceCheckerIdentity(digests)]),
  });
  const policy = decodePolicyBundle({
    ...policyDefinition,
    digest: digests.digest(policyBundleProjection(policyDefinition)),
  });
  const profileDefinition = testExecutionProfileDefinition('runtime-commands');
  const profile = decodeExecutionProfile({
    ...profileDefinition,
    digest: digests.digest(executionProfileProjection(profileDefinition)),
  });
  return Object.freeze({
    policy: Object.freeze({ bundle: policy, installedAt }),
    profile: Object.freeze({ profile, installedAt }),
  });
}

interface FixtureOptions {
  readonly workflow?: (created: WorkflowInstance) => WorkflowInstance;
  readonly phaseGuards?: PhaseGuardEvaluator;
  readonly digests?: DigestProvider;
  readonly clock?: Clock;
  readonly ids?: IdGenerator;
}

function fixture(options: FixtureOptions = {}): {
  readonly runtime: WorkflowRuntimeKernel;
  readonly application: GoalApplication;
  readonly store: InMemoryWorkflowStore;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
} {
  const createdAt = '2026-07-27T02:00:00.000Z';
  const clock =
    options.clock ??
    new DeterministicClock([
      ...Array.from(
        { length: 32 },
        (_, index) => `2026-07-27T02:00:00.${String(index + 1).padStart(3, '0')}Z`,
      ),
    ]);
  const goal = createGoal({
    id: goalId('goal_runtime-commands'),
    revision: goalRevision(1),
    objective: 'Prove runtime command ownership',
    successCriteria: [
      {
        id: successCriterionId('criterion_runtime-commands'),
        description: 'Runtime commands preserve authority',
        required: true,
      },
    ],
    scope: { projectPath: '/fixture/runtime', allowedPaths: ['src/**'] },
    createdAt: clockTimestamp(createdAt),
  });
  const createdWorkflow = createWorkflow({
    id: workflowId('workflow_runtime-commands'),
    goalId: goal.id,
    goalRevision: goalRevision(1),
    createdAt: clockTimestamp(createdAt),
  });
  const workflow = options.workflow?.(createdWorkflow) ?? createdWorkflow;
  const store = new InMemoryWorkflowStore(goal, workflow);
  const runtimeIds = options.ids ?? new DeterministicIds('runtime');
  const workerIds = new DeterministicIds('runtime-worker');
  const runtimeDigests = options.digests ?? new FixtureDigestProvider();
  const authority = fixtureWorkerAuthority(createdWorkflow.createdAt);
  store.seedWorkerAuthority(authority.policy, authority.profile);
  if (workflow.version > 1) {
    const bindingDigests = new FixtureDigestProvider();
    const startCommandId = commandId('command_runtime-fixture-start');
    const policyFields = Object.freeze({
      schemaVersion: 1 as const,
      goalId: goal.id,
      workflowId: workflow.id,
      policyBundleId: authority.policy.bundle.id,
      policyBundleVersion: authority.policy.bundle.version,
      policyBundleDigest: authority.policy.bundle.digest,
      startCommandId,
      boundAt: workflow.createdAt,
    });
    const profileFields = Object.freeze({
      schemaVersion: 1 as const,
      goalId: goal.id,
      workflowId: workflow.id,
      profileId: authority.profile.profile.id,
      profileVersion: authority.profile.profile.version,
      profileDigest: authority.profile.profile.digest,
      startCommandId,
      boundAt: workflow.createdAt,
    });
    store.seedWorkflowBindings(
      decodeWorkflowPolicyBinding({
        ...policyFields,
        bindingDigest: bindingDigests.digest(workflowPolicyBindingProjection(policyFields)),
      }),
      decodeExecutionProfileBinding({
        ...profileFields,
        bindingDigest: bindingDigests.digest(executionProfileBindingProjection(profileFields)),
      }),
    );
  }
  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm1-context-compiler-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests: runtimeDigests,
  });
  const dependencies = {
    store,
    clock,
    ids: runtimeIds,
    digests: runtimeDigests,
  };
  const runtime = new WorkflowRuntimeKernel({
    ...dependencies,
    phaseGuards: options.phaseGuards ?? passingPhaseGuardEvaluator,
    workerContext: Object.freeze({
      identities: Object.freeze({
        nextCommandId: () => workerIds.nextCommandId(),
        nextAttemptId: () => runtimeIds.nextAttemptId(),
        nextAuditEventId: () => runtimeIds.nextAuditEventId(),
        nextContextManifestId: () => workerIds.nextContextManifestId(),
        nextWorkerSessionId: () => workerIds.nextWorkerSessionId(),
      }),
      factory: Object.freeze({
        compile: (input: Parameters<MinimalContextCompiler['compile']>[0]) =>
          compiler.compile(input),
      }),
      executionProfileId: authority.profile.profile.id,
      executionProfileDigest: authority.profile.profile.digest,
      policyBundleId: authority.policy.bundle.id,
      policyBundleDigest: authority.policy.bundle.digest,
    }),
  });
  return {
    goal,
    workflow,
    store,
    application: Object.freeze({
      startGoal: (input: Parameters<GoalApplication['startGoal']>[0]) => runtime.startGoal(input),
      cancelGoal: (input: Parameters<GoalApplication['cancelGoal']>[0]) =>
        runtime.cancelGoal(input),
    }),
    runtime,
  };
}

function startFixtureExecution(
  fixtureValue: {
    readonly runtime: WorkflowRuntimeKernel;
    readonly store: InMemoryWorkflowStore;
    readonly goal: Goal;
    readonly workflow: WorkflowInstance;
  },
  namespace: string,
): { readonly workflow: WorkflowInstance; readonly attempt: Attempt } {
  const result = fixtureValue.runtime.startGoal({
    commandId: commandId(`command_${namespace}-start`),
    goalId: fixtureValue.goal.id,
    expectedGoalRevision: fixtureValue.goal.revision,
    expectedWorkflowVersion: fixtureValue.workflow.version,
  });
  assert.equal(result.status, 'APPLIED', JSON.stringify(result));
  const workflow = fixtureValue.store.getWorkflow(fixtureValue.workflow.id);
  if (workflow?.activeAttemptId === undefined) {
    assert.fail('Fixture StartGoal must retain an active Attempt');
  }
  const attempt = fixtureValue.store.getAttempt(workflow.activeAttemptId);
  if (attempt === undefined) {
    assert.fail('Fixture StartGoal must retain its child Attempt');
  }
  return Object.freeze({ workflow, attempt });
}

function readyFixtureExecution(
  fixtureValue: {
    readonly runtime: WorkflowRuntimeKernel;
    readonly store: InMemoryWorkflowStore;
    readonly goal: Goal;
    readonly workflow: WorkflowInstance;
  },
  namespace: string,
): WorkflowInstance {
  const running = startFixtureExecution(fixtureValue, namespace);
  const result = fixtureValue.runtime.recordAttemptResult({
    commandId: commandId(`command_${namespace}-first-result`),
    workflowId: running.workflow.id,
    expectedWorkflowVersion: running.workflow.version,
    attemptId: running.attempt.id,
    reason: 'Fixture completed the first Context-bound Attempt',
  });
  assert.equal(result.status, 'APPLIED', JSON.stringify(result));
  const workflow = fixtureValue.store.getWorkflow(running.workflow.id);
  if (workflow === undefined) {
    assert.fail('Fixture completion must retain its Workflow');
  }
  return workflow;
}

function clockTimestamp(value: string): ReturnType<DeterministicClock['now']> {
  return new DeterministicClock([value]).now();
}

function passingGuards(from: WorkflowPhase, to: WorkflowPhase): readonly GuardResult[] {
  const required = requiredGuardsForTransition(from, to);
  if (required === undefined) {
    return Object.freeze([]);
  }
  return required.map((guard) => ({
    guard,
    outcome: GuardOutcome.PASS,
    reasonCode: 'RUNTIME_TEST_PROOF',
    supportingRefs: [`test:${guard.toLowerCase()}`],
  }));
}

const passingPhaseGuardEvaluator: PhaseGuardEvaluator = {
  evaluate: ({ workflow, requestedPhase }) => passingGuards(workflow.phase, requestedPhase),
};

void test('[I-006][I-008] in-memory Store passes the shared control-store contract', () => {
  const fixtureValue = fixture();
  const { store, goal, workflow } = fixtureValue;
  const ready = readyFixtureExecution(fixtureValue, 'in-memory-store-contract-authority');
  const commandIdentifier = commandId('command_in-memory-store-contract');
  const invalidCommandIdentifier = commandId('command_in-memory-store-contract-invalid');
  const decision = decideWorkflow(ready, {
    type: 'REQUEST_PHASE_TRANSITION',
    commandId: commandIdentifier,
    workflowId: workflow.id,
    expectedVersion: ready.version,
    occurredAt: ready.updatedAt,
    reason: 'The shared Store contract advances established authority',
    requestedPhase: WorkflowPhase.PLAN,
    guardResults: passingGuards(ready.phase, WorkflowPhase.PLAN),
  });
  if (!decision.accepted) {
    assert.fail('Store contract fixture must advance a started Workflow');
  }
  const event = decision.events[0];
  const target = { aggregateType: 'WORKFLOW' as const, aggregateId: workflow.id };
  const inputDigest = new FixtureDigestProvider().digest({ contract: 'in-memory' });
  const input: CommitWorkflowEvent = {
    inputDigest,
    target,
    event,
    auditEventId: auditEventId('audit_in-memory-store-contract-workflow'),
    payloadDigest: new FixtureDigestProvider().digest(event),
  };

  assertWorkflowControlStoreContract({
    store,
    goalId: goal.id,
    workflowId: workflow.id,
    commandId: commandIdentifier,
    invalidCommandId: invalidCommandIdentifier,
    inputDigest,
    target,
    apply: () => store.commitWorkflowEvent(input),
    conflict: () =>
      store.commitWorkflowEvent({
        ...input,
        inputDigest: new FixtureDigestProvider().digest({ contract: 'conflict' }),
      }),
    invalid: () => {
      const current = store.getWorkflow(workflow.id);
      if (current === undefined) {
        throw new Error('Store contract lost its Workflow');
      }
      return store.recordCommandRejection({
        commandId: invalidCommandIdentifier,
        inputDigest: 'not-a-digest' as never,
        target,
        workflowId: workflow.id,
        observedWorkflowVersion: current.version,
        error: {
          code: RuntimeErrorCode.DOMAIN_REJECTED,
          message: 'invalid Store boundary fixture',
          retryable: false,
          detailCode: 'INVALID_STORE_BOUNDARY_FIXTURE',
        },
        completedAt: current.updatedAt,
      });
    },
  });
});

void test('[I-008] Runtime clamps a valid clock rollback to the Workflow causal floor', () => {
  const { application, store, goal, workflow } = fixture({
    clock: new DeterministicClock(['2026-07-27T01:59:59.999Z']),
  });

  const result = application.startGoal({
    commandId: commandId('command_runtime-clock-rollback'),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });

  assert.equal(result.status, 'APPLIED');
  const running = store.getWorkflow(workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Clock rollback test must persist one active Attempt');
  }
  assert.equal(running.updatedAt, workflow.updatedAt);
  assert.equal(store.getAttempt(running.activeAttemptId)?.startedAt, workflow.updatedAt);
});

void test('[I-008] deterministic rejection completion also uses the Workflow causal floor', () => {
  const { application, store, goal, workflow } = fixture({
    clock: new DeterministicClock(['2026-07-27T01:59:59.999Z']),
  });

  const result = application.startGoal({
    commandId: commandId('command_runtime-rejection-clock-rollback'),
    goalId: goal.id,
    expectedGoalRevision: goalRevision(2),
    expectedWorkflowVersion: workflow.version,
  });

  assert.equal(result.status, 'REJECTED');
  assert.equal(store.lastRejectionCompletedAt, workflow.updatedAt);
});

void test('[I-003][I-019][I-031] StartGoal refuses incomplete Runtime composition before mutation', async (t) => {
  await t.test('missing complete composition', () => {
    const { store, goal, workflow } = fixture();
    const application = createGoalApplication({
      store,
      clock: new DeterministicClock(['2026-07-27T02:00:00.001Z']),
      ids: new DeterministicIds('unconfigured-start'),
      digests: new FixtureDigestProvider(),
    });
    const commandIdentifier = commandId('command_unconfigured-start');

    const result = application.startGoal({
      commandId: commandIdentifier,
      goalId: goal.id,
      expectedGoalRevision: goal.revision,
      expectedWorkflowVersion: workflow.version,
    });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.output.error.code, RuntimeErrorCode.INTERNAL_FAILURE);
    assert.equal(result.output.error.detailCode, 'START_GOAL_RUNTIME_COMPOSITION_UNAVAILABLE');
    assert.equal(store.attemptCommits, 0);
    assert.equal(store.getProcessedCommand(commandIdentifier), undefined);
  });

  await t.test('missing installed Policy', () => {
    const fixtureValue = fixture();
    fixtureValue.store.removeInstalledPolicy();
    const commandIdentifier = commandId('command_missing-start-policy');

    const result = fixtureValue.application.startGoal({
      commandId: commandIdentifier,
      goalId: fixtureValue.goal.id,
      expectedGoalRevision: fixtureValue.goal.revision,
      expectedWorkflowVersion: fixtureValue.workflow.version,
    });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.output.error.detailCode, 'START_GOAL_POLICY_UNAVAILABLE');
    assert.equal(fixtureValue.store.attemptCommits, 0);
    assert.equal(fixtureValue.store.getProcessedCommand(commandIdentifier), undefined);
  });

  await t.test('missing installed Execution Profile', () => {
    const fixtureValue = fixture();
    fixtureValue.store.removeInstalledExecutionProfile();
    const commandIdentifier = commandId('command_missing-start-profile');

    const result = fixtureValue.application.startGoal({
      commandId: commandIdentifier,
      goalId: fixtureValue.goal.id,
      expectedGoalRevision: fixtureValue.goal.revision,
      expectedWorkflowVersion: fixtureValue.workflow.version,
    });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.output.error.detailCode, 'START_GOAL_EXECUTION_PROFILE_UNAVAILABLE');
    assert.equal(fixtureValue.store.attemptCommits, 0);
    assert.equal(fixtureValue.store.getProcessedCommand(commandIdentifier), undefined);
  });
});

void test('[I-003][I-008] internal Runtime commands cannot manufacture first-start authority', async (t) => {
  for (const operation of ['ATTEMPT', 'PHASE'] as const) {
    await t.test(operation, () => {
      const { runtime, store, workflow } = fixture();
      const commandIdentifier = commandId(`command_unstarted-${operation.toLowerCase()}`);
      const result =
        operation === 'ATTEMPT'
          ? runtime.beginAttempt({
              commandId: commandIdentifier,
              workflowId: workflow.id,
              expectedWorkflowVersion: workflow.version,
            })
          : runtime.requestPhaseTransition({
              commandId: commandIdentifier,
              workflowId: workflow.id,
              expectedWorkflowVersion: workflow.version,
              requestedPhase: WorkflowPhase.PLAN,
              reason: 'An internal command must not replace StartGoal',
            });

      assert.equal(result.status, 'REJECTED');
      assert.equal(result.output.error.code, RuntimeErrorCode.DOMAIN_REJECTED);
      assert.equal(result.output.error.detailCode, 'WORKFLOW_START_AUTHORITY_MISSING');
      assert.deepEqual(store.getWorkflow(workflow.id), workflow);
      assert.equal(store.getProcessedCommand(commandIdentifier), undefined);
      assert.equal(store.attemptCommits, 0);
      assert.equal(store.workflowCommits, 0);
    });
  }
});

void test('[I-027] malformed Runtime clock output is internal failure and is not persisted', () => {
  const malformedClock: Clock = {
    now: () => 'not-a-canonical-timestamp' as never,
  };
  const { application, store, goal, workflow } = fixture({ clock: malformedClock });
  const request = {
    commandId: commandId('command_runtime-malformed-clock'),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  };

  const result = application.startGoal(request);

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.INTERNAL_FAILURE);
  assert.equal(result.output.error.detailCode, 'COMMAND_CLOCK_FAILURE');
  assert.equal(store.getProcessedCommand(request.commandId), undefined);
  assert.equal(store.attemptCommits, 0);
});

void test('[I-008][I-027] Runtime treats malformed Store authority as persistence failure', () => {
  const { application, store, goal, workflow } = fixture({
    workflow: (created) =>
      Object.freeze({
        ...created,
        updatedAt: clockTimestamp('2026-07-27T01:59:59.999Z'),
      }),
  });
  const request = {
    commandId: commandId('command_runtime-invalid-context-before-stale'),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflowVersion(workflow.version + 1),
  };

  const result = application.startGoal(request);

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  assert.equal(result.output.error.detailCode, 'COMMAND_AUTHORITY_INVALID');
  assert.equal(store.getProcessedCommand(request.commandId), undefined);
  assert.equal(store.attemptCommits, 0);
});

void test('[I-008] runtime handlers start, replay, route a result, and advance by guards', () => {
  const { runtime, store, goal, workflow } = fixture();
  const beginRequest = {
    commandId: commandId('command_runtime-begin'),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  };

  const began = runtime.startGoal(beginRequest);
  const replayed = runtime.startGoal(beginRequest);
  assert.equal(began.status, 'APPLIED');
  assert.equal(began.output.runStatus, RunStatus.RUNNING);
  assert.equal(replayed.status, 'REPLAYED');
  assert.deepEqual(replayed.output, began.output);
  assert.equal(store.attemptCommits, 1);

  const running = store.getWorkflow(workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Runtime must persist a Workflow with an active Attempt');
  }
  assert.equal(running.runStatus, RunStatus.RUNNING);
  const activeAttempt = store.getAttempt(running.activeAttemptId);
  if (activeAttempt === undefined) {
    assert.fail('Runtime must persist the active Attempt');
  }
  assert.equal(activeAttempt.status, AttemptStatus.RUNNING);

  const result = runtime.recordAttemptResult({
    commandId: commandId('command_runtime-result'),
    workflowId: workflow.id,
    expectedWorkflowVersion: running.version,
    attemptId: activeAttempt.id,
    reason: 'validated result routed',
  });
  assert.equal(result.status, 'APPLIED');
  assert.equal(result.output.phase, WorkflowPhase.DISCOVERY);
  assert.equal(result.output.runStatus, RunStatus.READY);
  assert.equal(store.getAttempt(activeAttempt.id)?.status, AttemptStatus.RESULT_RECORDED);

  const ready = store.getWorkflow(workflow.id);
  if (ready === undefined) {
    assert.fail('Workflow must remain persisted');
  }
  const transitioned = runtime.requestPhaseTransition({
    commandId: commandId('command_runtime-plan'),
    workflowId: workflow.id,
    expectedWorkflowVersion: ready.version,
    requestedPhase: WorkflowPhase.PLAN,
    reason: 'discovery obligations passed',
  });
  assert.equal(transitioned.status, 'APPLIED');
  assert.equal(transitioned.output.phase, WorkflowPhase.PLAN);
  assert.equal(store.workflowCommits, 1);
});

void test('[I-008][I-010] runtime cancellation interrupts the active Attempt', () => {
  const fixtureValue = fixture();
  const { application, store, goal, workflow } = fixtureValue;
  startFixtureExecution(fixtureValue, 'runtime-cancel');
  const running = store.getWorkflow(workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Workflow must have an active Attempt');
  }

  const cancelled = application.cancelGoal({
    commandId: commandId('command_runtime-cancel'),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: running.version,
    reason: 'user cancelled',
  });

  assert.equal(cancelled.status, 'APPLIED');
  assert.equal(cancelled.output.runStatus, RunStatus.CANCELLED);
  assert.equal(store.getAttempt(running.activeAttemptId)?.status, AttemptStatus.INTERRUPTED);
  assert.equal(store.getGoal(goal.id)?.status, 'CANCELLED');
});

void test('[I-008] reconciliation primitive blocks replacement work until explicit resume', () => {
  const fixtureValue = fixture();
  const { runtime, store, workflow } = fixtureValue;
  startFixtureExecution(fixtureValue, 'runtime-recovery');
  const running = store.getWorkflow(workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Workflow must have an active Attempt');
  }

  const reconciled = runtime.reconcileAttemptAfterRestart({
    commandId: commandId('command_runtime-recovery'),
    workflowId: workflow.id,
    expectedWorkflowVersion: running.version,
    attemptId: running.activeAttemptId,
    reason: 'previous worker control cannot be proven after restart',
  });

  assert.equal(reconciled.status, 'APPLIED');
  assert.equal(reconciled.output.runStatus, RunStatus.BLOCKED);
  assert.equal(store.getAttempt(running.activeAttemptId)?.status, AttemptStatus.INTERRUPTED);
  const replacement = runtime.beginAttempt({
    commandId: commandId('command_runtime-replacement-before-resume'),
    workflowId: workflow.id,
    expectedWorkflowVersion: reconciled.output.workflowVersion,
  });
  assert.equal(replacement.status, 'REJECTED');
  assert.equal(replacement.output.error.detailCode, 'WORKFLOW_NOT_READY');
});

void test('[I-008] runtime returns typed stale and command-conflict errors without state mutation', () => {
  const fixtureValue = fixture();
  const { runtime, store, workflow } = fixtureValue;
  const ready = readyFixtureExecution(fixtureValue, 'runtime-conflict-authority');
  const command = commandId('command_runtime-conflict');
  const began = runtime.beginAttempt({
    commandId: command,
    workflowId: workflow.id,
    expectedWorkflowVersion: ready.version,
  });
  assert.equal(began.status, 'APPLIED');

  const conflict = runtime.beginAttempt({
    commandId: command,
    workflowId: workflow.id,
    expectedWorkflowVersion: began.output.workflowVersion,
  });
  assert.equal(conflict.status, 'REJECTED');
  assert.equal(conflict.output.error.code, RuntimeErrorCode.COMMAND_ID_CONFLICT);
  assert.equal(store.attemptCommits, 3);

  const stale = runtime.recordAttemptResult({
    commandId: commandId('command_runtime-stale'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    attemptId: store.getWorkflow(workflow.id)?.activeAttemptId ?? assert.fail('missing Attempt'),
    reason: 'stale result',
  });
  assert.equal(stale.status, 'REJECTED');
  assert.equal(stale.output.error.code, RuntimeErrorCode.STALE_WORKFLOW_VERSION);
  assert.equal(store.attemptCommits, 3);
});

void test('[I-008] deterministic rejection replays after Workflow state changes', () => {
  const fixtureValue = fixture();
  const { runtime, store, workflow } = fixtureValue;
  startFixtureExecution(fixtureValue, 'rejection-replay');
  const running = store.getWorkflow(workflow.id);
  if (running?.activeAttemptId === undefined) {
    assert.fail('Workflow must have an active Attempt');
  }

  const rejectedRequest = {
    commandId: commandId('command_rejection-replay'),
    workflowId: workflow.id,
    expectedWorkflowVersion: running.version,
  };
  const firstRejection = runtime.beginAttempt(rejectedRequest);
  assert.equal(firstRejection.status, 'REJECTED');
  assert.equal(firstRejection.output.error.detailCode, 'WORKFLOW_NOT_READY');

  const finished = runtime.recordAttemptResult({
    commandId: commandId('command_rejection-replay-finish'),
    workflowId: workflow.id,
    expectedWorkflowVersion: running.version,
    attemptId: running.activeAttemptId,
    reason: 'advance state after the stored rejection',
  });
  assert.equal(finished.status, 'APPLIED');

  const replayed = runtime.beginAttempt(rejectedRequest);
  assert.equal(replayed.status, 'REPLAYED');
  assert.deepEqual(replayed.output, firstRejection.output);
});

void test('[I-008] missing child Attempt is a stored deterministic rejection', () => {
  const fixtureValue = fixture();
  const { runtime, store, workflow } = fixtureValue;
  startFixtureExecution(fixtureValue, 'missing-attempt');

  const running = store.getWorkflow(workflow.id);
  if (running === undefined) {
    assert.fail('Workflow must remain persisted');
  }
  const request = {
    commandId: commandId('command_missing-attempt-result'),
    workflowId: workflow.id,
    expectedWorkflowVersion: running.version,
    attemptId: attemptId('attempt_missing-child'),
    reason: 'result references a missing child Attempt',
  };

  const first = runtime.recordAttemptResult(request);
  const replayed = runtime.recordAttemptResult(request);

  assert.equal(first.status, 'REJECTED');
  assert.equal(first.output.error.code, RuntimeErrorCode.NOT_FOUND);
  assert.equal(first.output.error.detailCode, 'ATTEMPT_NOT_FOUND');
  assert.equal(replayed.status, 'REPLAYED');
  assert.deepEqual(replayed.output, first.output);
  assert.equal(store.getProcessedCommand(request.commandId)?.aggregateId, workflow.id);
});

void test('[I-008] Workflow freshness is checked before a missing child Attempt', () => {
  const fixtureValue = fixture();
  const { runtime, store, workflow } = fixtureValue;
  const running = startFixtureExecution(fixtureValue, 'stale-before-missing');
  const request = {
    commandId: commandId('command_stale-before-missing-attempt'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflowVersion(running.workflow.version + 1),
    attemptId: attemptId('attempt_stale-before-missing'),
    reason: 'late result must not be diagnosed against newer state',
  };

  const first = runtime.recordAttemptResult(request);
  const replayed = runtime.recordAttemptResult(request);

  assert.equal(first.status, 'REJECTED');
  assert.equal(first.output.error.code, RuntimeErrorCode.STALE_WORKFLOW_VERSION);
  assert.equal(first.output.error.detailCode, 'STALE_WORKFLOW_VERSION');
  assert.equal(replayed.status, 'REPLAYED');
  assert.deepEqual(replayed.output, first.output);
  assert.equal(store.getProcessedCommand(request.commandId)?.aggregateId, workflow.id);
});

void test('[I-008] typed version conflict reloads, reevaluates, persists, and replays', () => {
  const fixtureValue = fixture();
  const { runtime, store, workflow } = fixtureValue;
  const ready = readyFixtureExecution(fixtureValue, 'runtime-version-retry-authority');
  const request = {
    commandId: commandId('command_runtime-version-retry'),
    workflowId: workflow.id,
    expectedWorkflowVersion: ready.version,
  };
  store.injectConcurrentVersionAdvance();

  const first = runtime.beginAttempt(request);
  const replayed = runtime.beginAttempt(request);

  assert.equal(first.status, 'REJECTED');
  assert.equal(first.output.error.code, RuntimeErrorCode.STALE_WORKFLOW_VERSION);
  assert.equal(first.output.error.detailCode, 'STALE_WORKFLOW_VERSION');
  assert.equal(replayed.status, 'REPLAYED');
  assert.deepEqual(replayed.output, first.output);
  assert.equal(store.attemptCommits, 2);
  assert.equal(store.getProcessedCommand(request.commandId)?.aggregateId, workflow.id);
});

void test('[I-002][I-003] internal phase command fails closed before Acceptance exists', () => {
  let guardEvaluations = 0;
  const phaseGuards: PhaseGuardEvaluator = {
    evaluate: () => {
      guardEvaluations += 1;
      return [
        {
          guard: WorkflowGuard.CURRENT_ACCEPTANCE,
          outcome: GuardOutcome.PASS,
          reasonCode: 'FORGED_ACCEPTANCE',
          supportingRefs: ['caller:self-attested'],
        },
      ];
    },
  };
  const { runtime, store, workflow } = fixture({
    workflow: (created) =>
      Object.freeze({
        ...created,
        phase: WorkflowPhase.FINAL_VERIFY,
        version: workflowVersion(6),
        activeCandidateGenerationId: candidateGenerationId('generation_runtime-final'),
      }),
    phaseGuards,
  });

  const result = runtime.requestPhaseTransition({
    commandId: commandId('command_runtime-forged-closeout'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    requestedPhase: WorkflowPhase.CLOSEOUT,
    reason: 'caller claims acceptance exists',
  });

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.detailCode, 'CURRENT_ACCEPTANCE_UNAVAILABLE');
  assert.equal(guardEvaluations, 0);
  assert.equal(store.getWorkflow(workflow.id)?.phase, WorkflowPhase.FINAL_VERIFY);
  assert.equal(store.getProcessedCommand(result.output.commandId)?.aggregateId, workflow.id);
});

void test('[I-008] stale phase requests run no guard or closeout-specific evaluation', () => {
  let guardEvaluations = 0;
  const { runtime, store, workflow } = fixture({
    workflow: (created) =>
      Object.freeze({
        ...created,
        phase: WorkflowPhase.FINAL_VERIFY,
        version: workflowVersion(6),
        activeCandidateGenerationId: candidateGenerationId('generation_stale-closeout'),
      }),
    phaseGuards: {
      evaluate: () => {
        guardEvaluations += 1;
        return Object.freeze([]);
      },
    },
  });
  const request = {
    commandId: commandId('command_stale-before-closeout'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflowVersion(5),
    requestedPhase: WorkflowPhase.CLOSEOUT,
    reason: 'stale closeout request',
  };

  const result = runtime.requestPhaseTransition(request);

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.STALE_WORKFLOW_VERSION);
  assert.equal(result.output.error.detailCode, 'STALE_WORKFLOW_VERSION');
  assert.equal(guardEvaluations, 0);
  assert.equal(store.getProcessedCommand(request.commandId)?.aggregateId, workflow.id);
});

void test('[I-027] guard evaluator crashes are not mislabeled or persisted as database failures', () => {
  const fixtureValue = fixture({
    phaseGuards: {
      evaluate: () => {
        throw new Error('guard evaluator crashed');
      },
    },
  });
  const { runtime, store, workflow } = fixtureValue;
  const ready = readyFixtureExecution(fixtureValue, 'guard-evaluation-crash');
  const commandIdentifier = commandId('command_guard-evaluation-crash');

  const result = runtime.requestPhaseTransition({
    commandId: commandIdentifier,
    workflowId: workflow.id,
    expectedWorkflowVersion: ready.version,
    requestedPhase: WorkflowPhase.PLAN,
    reason: 'exercise evaluator failure taxonomy',
  });

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.EVALUATION_FAILURE);
  assert.equal(result.output.error.detailCode, 'PHASE_GUARD_EVALUATION_FAILURE');
  assert.equal(store.getProcessedCommand(commandIdentifier), undefined);
  assert.equal(store.getWorkflow(workflow.id)?.version, ready.version);
});

void test('[I-027] malformed guard evaluator returns remain evaluation failures', async (t) => {
  const malformedResults: readonly { readonly name: string; readonly value: unknown }[] = [
    { name: 'null result', value: null },
    { name: 'non-array result', value: { guard: WorkflowGuard.DISCOVERY_COMPLETE } },
    { name: 'null entry', value: [null] },
    {
      name: 'invalid enum',
      value: [
        {
          guard: 'NOT_A_GUARD',
          outcome: GuardOutcome.PASS,
          reasonCode: 'INVALID_ENUM',
          supportingRefs: ['fixture:invalid-enum'],
        },
      ],
    },
    {
      name: 'invalid support reference',
      value: [
        {
          guard: WorkflowGuard.DISCOVERY_COMPLETE,
          outcome: GuardOutcome.PASS,
          reasonCode: 'INVALID_SUPPORT',
          supportingRefs: [1],
        },
      ],
    },
  ];

  for (const [index, malformed] of malformedResults.entries()) {
    await t.test(malformed.name, () => {
      const fixtureValue = fixture({
        phaseGuards: { evaluate: () => malformed.value },
      });
      const { runtime, store, workflow } = fixtureValue;
      const ready = readyFixtureExecution(fixtureValue, `malformed-guard-${index}`);
      const commandIdentifier = commandId(`command_malformed-guard-${index}`);

      const result = runtime.requestPhaseTransition({
        commandId: commandIdentifier,
        workflowId: workflow.id,
        expectedWorkflowVersion: ready.version,
        requestedPhase: WorkflowPhase.PLAN,
        reason: 'malformed evaluator output must fail at its boundary',
      });

      assert.equal(result.status, 'REJECTED');
      assert.equal(result.output.error.code, RuntimeErrorCode.EVALUATION_FAILURE);
      assert.equal(result.output.error.detailCode, 'PHASE_GUARD_EVALUATION_FAILURE');
      assert.equal(store.getProcessedCommand(commandIdentifier), undefined);
      assert.equal(store.getWorkflow(workflow.id)?.version, ready.version);
    });
  }
});

void test('[I-027] runtime computation faults remain internal and are not persisted', () => {
  const { runtime, store, workflow } = fixture({
    digests: {
      digest: () => {
        throw new Error('digest implementation crashed');
      },
    },
  });
  const commandIdentifier = commandId('command_internal-digest-crash');

  const result = runtime.beginAttempt({
    commandId: commandIdentifier,
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
  });

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.INTERNAL_FAILURE);
  assert.equal(result.output.error.detailCode, 'COMMAND_DIGEST_FAILURE');
  assert.equal(store.getProcessedCommand(commandIdentifier), undefined);
  assert.equal(store.getWorkflow(workflow.id)?.version, workflow.version);
});

void test('[I-006][I-027] malformed digest and ID port outputs fail before Store mutation', async (t) => {
  await t.test('digest output', () => {
    const { runtime, store, workflow } = fixture({
      digests: { digest: () => 'not-a-digest' as never },
    });
    const commandIdentifier = commandId('command_malformed-digest-output');

    const result = runtime.beginAttempt({
      commandId: commandIdentifier,
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.output.error.code, RuntimeErrorCode.INTERNAL_FAILURE);
    assert.equal(result.output.error.detailCode, 'COMMAND_DIGEST_FAILURE');
    assert.equal(store.getProcessedCommand(commandIdentifier), undefined);
    assert.equal(store.attemptCommits, 0);
  });

  await t.test('Attempt ID output', () => {
    const validIds = new DeterministicIds('malformed-attempt-id');
    const { application, store, goal, workflow } = fixture({
      ids: {
        nextAttemptId: () => 'not-an-attempt-id' as never,
        nextAuditEventId: () => validIds.nextAuditEventId(),
      },
    });
    const commandIdentifier = commandId('command_malformed-attempt-id-output');

    const result = application.startGoal({
      commandId: commandIdentifier,
      goalId: goal.id,
      expectedGoalRevision: goal.revision,
      expectedWorkflowVersion: workflow.version,
    });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.output.error.detailCode, 'ATTEMPT_ID_GENERATION_FAILURE');
    assert.equal(store.getProcessedCommand(commandIdentifier), undefined);
    assert.equal(store.attemptCommits, 0);
  });

  await t.test('audit ID output', () => {
    const validIds = new DeterministicIds('malformed-audit-id');
    const { application, store, goal, workflow } = fixture({
      ids: {
        nextAttemptId: () => validIds.nextAttemptId(),
        nextAuditEventId: () => 'not-an-audit-id' as never,
      },
    });
    const commandIdentifier = commandId('command_malformed-audit-id-output');

    const result = application.startGoal({
      commandId: commandIdentifier,
      goalId: goal.id,
      expectedGoalRevision: goal.revision,
      expectedWorkflowVersion: workflow.version,
    });

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.output.error.detailCode, 'AUDIT_ID_GENERATION_FAILURE');
    assert.equal(store.getProcessedCommand(commandIdentifier), undefined);
    assert.equal(store.attemptCommits, 0);
  });
});

void test('[I-006] public command requests are decoded as closed authority records', () => {
  const { application, store, goal, workflow } = fixture();

  assert.throws(() =>
    application.startGoal({
      commandId: 'COMMAND_NOT_CANONICAL',
      goalId: goal.id,
      expectedGoalRevision: goal.revision,
      expectedWorkflowVersion: workflow.version,
    } as never),
  );
  assert.throws(() =>
    application.startGoal({
      commandId: commandId('command_request-extra-field'),
      goalId: goal.id,
      expectedGoalRevision: goal.revision,
      expectedWorkflowVersion: workflow.version,
      workerMayAccept: true,
    } as never),
  );
  assert.equal(store.attemptCommits, 0);
});

void test('[I-006][I-027] malformed Store sequence is persistence failure, not domain rejection', () => {
  const { application, store, goal, workflow } = fixture();
  store.injectNextAttemptSequence(0);
  const commandIdentifier = commandId('command_malformed-store-sequence');

  const result = application.startGoal({
    commandId: commandIdentifier,
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
  assert.equal(result.output.error.detailCode, 'ATTEMPT_SEQUENCE_INVALID');
  assert.equal(store.getProcessedCommand(commandIdentifier), undefined);
  assert.equal(store.attemptCommits, 0);
});

void test('[I-006][I-009] normal Goal, normal Workflow, and replay share authority checks', () => {
  {
    const { application, store, goal, workflow } = fixture();
    store.injectAuthorityView({
      goal,
      workflow: Object.freeze({ ...workflow, goalId: goalId('goal_wrong-owner') }),
    });
    const result = application.startGoal({
      commandId: commandId('command_goal-authority-mismatch'),
      goalId: goal.id,
      expectedGoalRevision: goal.revision,
      expectedWorkflowVersion: workflow.version,
    });
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
    assert.equal(result.output.error.detailCode, 'COMMAND_AUTHORITY_INVALID');
    assert.equal(store.attemptCommits, 0);
  }

  {
    const { runtime, store, goal, workflow } = fixture();
    store.injectAuthorityView({
      goal,
      workflow: Object.freeze({ ...workflow, id: workflowId('workflow_wrong-owner') }),
    });
    const result = runtime.beginAttempt({
      commandId: commandId('command_workflow-authority-mismatch'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    });
    assert.equal(result.status, 'REJECTED');
    assert.equal(result.output.error.code, RuntimeErrorCode.PERSISTENCE_FAILURE);
    assert.equal(result.output.error.detailCode, 'COMMAND_AUTHORITY_INVALID');
    assert.equal(store.attemptCommits, 0);
  }

  {
    const { runtime, store, goal, workflow } = fixture();
    const request = {
      commandId: commandId('command_replay-authority-mismatch'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    };
    const inputDigest = new FixtureDigestProvider().digest({
      schemaVersion: 1,
      type: 'BEGIN_ATTEMPT',
      commandId: request.commandId,
      workflowId: request.workflowId,
      expectedWorkflowVersion: request.expectedWorkflowVersion,
    });
    store.injectProcessedCommand({
      commandId: request.commandId,
      inputDigest,
      aggregateType: 'WORKFLOW',
      aggregateId: workflow.id,
      completedAt: workflow.updatedAt,
      outcome: storedCommandOutcomeToJson(
        createAppliedStoredCommandOutcome(
          { aggregateType: 'WORKFLOW', aggregateId: workflow.id },
          workflow,
          request.commandId,
        ),
      ),
    });
    store.injectAuthorityView({
      goal,
      workflow: Object.freeze({ ...workflow, id: workflowId('workflow_wrong-replay-owner') }),
    });

    const result = runtime.beginAttempt(request);

    assert.equal(result.status, 'REJECTED');
    assert.equal(result.output.error.code, RuntimeErrorCode.INVALID_STORED_OUTCOME);
    assert.equal(result.output.error.detailCode, 'INVALID_STORED_COMMAND_OUTCOME');
    assert.equal(store.attemptCommits, 0);
  }
});

void test('[I-009][I-027] replay rejects a shape-valid outcome bound to another Goal', () => {
  const { runtime, store, goal, workflow } = fixture();
  const request = {
    commandId: commandId('command_cross-goal-replay'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
  };
  const inputDigest = new FixtureDigestProvider().digest({
    schemaVersion: 1,
    type: 'BEGIN_ATTEMPT',
    commandId: request.commandId,
    workflowId: request.workflowId,
    expectedWorkflowVersion: request.expectedWorkflowVersion,
  });
  const otherGoalId = goalId('goal_cross-target');
  store.injectProcessedCommand({
    commandId: request.commandId,
    inputDigest,
    aggregateType: 'WORKFLOW',
    aggregateId: workflow.id,
    completedAt: workflow.updatedAt,
    outcome: {
      schemaVersion: 3,
      disposition: StoredCommandDisposition.APPLIED,
      target: {
        aggregateType: 'WORKFLOW',
        aggregateId: workflow.id,
      },
      goalId: otherGoalId,
      workflow: {
        id: workflow.id,
        version: workflow.version,
        phase: workflow.phase,
        runStatus: workflow.runStatus,
      },
      output: {
        schemaVersion: 1,
        commandId: request.commandId,
        ok: true,
        goalId: otherGoalId,
        workflowVersion: workflow.version,
        phase: workflow.phase,
        runStatus: workflow.runStatus,
      },
    },
  });

  const result = runtime.beginAttempt(request);

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.INVALID_STORED_OUTCOME);
  assert.equal(result.output.error.detailCode, 'INVALID_STORED_COMMAND_OUTCOME');
  assert.equal(result.output.commandId, request.commandId);
  assert.notEqual(goal.id, otherGoalId);
  assert.equal(store.attemptCommits, 0);
});

void test('[I-008][I-027] replay rejects infrastructure failures as command outcomes', () => {
  const { runtime, store, goal, workflow } = fixture();
  const request = {
    commandId: commandId('command_infrastructure-outcome-replay'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
  };
  const inputDigest = new FixtureDigestProvider().digest({
    schemaVersion: 1,
    type: 'BEGIN_ATTEMPT',
    commandId: request.commandId,
    workflowId: request.workflowId,
    expectedWorkflowVersion: request.expectedWorkflowVersion,
  });
  store.injectProcessedCommand({
    commandId: request.commandId,
    inputDigest,
    aggregateType: 'WORKFLOW',
    aggregateId: workflow.id,
    completedAt: workflow.updatedAt,
    outcome: {
      schemaVersion: 3,
      disposition: StoredCommandDisposition.REJECTED,
      target: { aggregateType: 'WORKFLOW', aggregateId: workflow.id },
      goalId: goal.id,
      workflow: {
        id: workflow.id,
        version: workflow.version,
        phase: workflow.phase,
        runStatus: workflow.runStatus,
      },
      output: {
        schemaVersion: 1,
        commandId: request.commandId,
        ok: false,
        error: {
          code: RuntimeErrorCode.PERSISTENCE_FAILURE,
          message: 'infrastructure failures are not replayable domain decisions',
          retryable: false,
          detailCode: 'FORGED_PERSISTENCE_OUTCOME',
        },
      },
    },
  });

  const result = runtime.beginAttempt(request);

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.INVALID_STORED_OUTCOME);
  assert.equal(result.output.error.detailCode, 'INVALID_STORED_COMMAND_OUTCOME');
  assert.equal(store.attemptCommits, 0);
});

void test('[I-006][I-009][I-027] Goal replay reloads authority and rejects a dangling target', () => {
  const { application, store, workflow } = fixture();
  const authority = fixtureWorkerAuthority(workflow.createdAt);
  const missingGoalId = goalId('goal_missing-replay-authority');
  const missingWorkflowId = workflowId('workflow_missing-replay-authority');
  const request = {
    commandId: commandId('command_missing-goal-replay'),
    goalId: missingGoalId,
    expectedGoalRevision: goalRevision(1),
    expectedWorkflowVersion: workflowVersion(1),
  };
  const inputDigest = new FixtureDigestProvider().digest({
    schemaVersion: 1,
    type: 'START_GOAL',
    commandId: request.commandId,
    goalId: request.goalId,
    expectedGoalRevision: request.expectedGoalRevision,
    expectedWorkflowVersion: request.expectedWorkflowVersion,
    executionProfileId: authority.profile.profile.id,
    executionProfileDigest: authority.profile.profile.digest,
    policyBundleId: authority.policy.bundle.id,
    policyBundleDigest: authority.policy.bundle.digest,
  });
  store.injectProcessedCommand({
    commandId: request.commandId,
    inputDigest,
    aggregateType: 'GOAL',
    aggregateId: missingGoalId,
    completedAt: workflow.updatedAt,
    outcome: {
      schemaVersion: 3,
      disposition: StoredCommandDisposition.APPLIED,
      target: { aggregateType: 'GOAL', aggregateId: missingGoalId },
      goalId: missingGoalId,
      workflow: {
        id: missingWorkflowId,
        version: workflowVersion(1),
        phase: WorkflowPhase.DISCOVERY,
        runStatus: RunStatus.READY,
      },
      output: {
        schemaVersion: 1,
        commandId: request.commandId,
        ok: true,
        goalId: missingGoalId,
        workflowVersion: workflowVersion(1),
        phase: WorkflowPhase.DISCOVERY,
        runStatus: RunStatus.READY,
      },
    },
  });

  const result = application.startGoal(request);

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.INVALID_STORED_OUTCOME);
  assert.equal(result.output.error.detailCode, 'INVALID_STORED_COMMAND_OUTCOME');
  assert.equal(store.attemptCommits, 0);
});

void test('[I-003][I-008] public Goal commands persist and replay stale Goal revision rejection', () => {
  const { application, store, goal, workflow } = fixture();
  const request = {
    commandId: commandId('command_stale-goal-revision'),
    goalId: goal.id,
    expectedGoalRevision: goalRevision(2),
    expectedWorkflowVersion: workflow.version,
  };

  const first = application.startGoal(request);
  const replayed = application.startGoal(request);

  assert.equal(first.status, 'REJECTED');
  assert.equal(first.output.error.code, RuntimeErrorCode.STALE_GOAL_REVISION);
  assert.equal(replayed.status, 'REPLAYED');
  assert.deepEqual(replayed.output, first.output);
  assert.equal(store.getProcessedCommand(request.commandId)?.aggregateType, 'GOAL');
  assert.equal(store.getProcessedCommand(request.commandId)?.aggregateId, goal.id);
});

void test('[I-003][I-008] StartGoal checks Workflow freshness before first-Attempt semantics', () => {
  const { application, store, goal, workflow } = fixture();
  const request = {
    commandId: commandId('command_stale-start-workflow'),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflowVersion(workflow.version + 1),
  };

  const result = application.startGoal(request);

  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.error.code, RuntimeErrorCode.STALE_WORKFLOW_VERSION);
  assert.equal(store.getProcessedCommand(request.commandId)?.aggregateType, 'GOAL');
  assert.equal(store.attemptCommits, 0);
});

void test('[I-003][I-023] package root hides legacy and internal mutation coordinators', async () => {
  assert.equal('WorkflowRuntimeKernel' in publicRuntimeApi, false);
  assert.equal('WorkerExecutionCoordinator' in publicRuntimeApi, false);
  assert.equal('createGoalApplication' in publicRuntimeApi, false);
  assert.equal('createWorkerExecutionApplication' in publicRuntimeApi, false);
  assert.equal('createRecoveryCoordinator' in publicRuntimeApi, false);
  assert.equal('createWorkflowDriver' in publicRuntimeApi, false);
  assert.equal('createCodeClosureApplication' in publicRuntimeApi, true);
  const trustedCompositionApi = await import('@codeclosure/runtime/composition');
  assert.equal('createRecoveryCoordinator' in trustedCompositionApi, true);
  assert.equal('createWorkflowDriver' in trustedCompositionApi, true);
  const internalPackageSubpath = '@codeclosure/runtime/workflow-runtime';
  await assert.rejects(import(internalPackageSubpath), /Package subpath/);
});
