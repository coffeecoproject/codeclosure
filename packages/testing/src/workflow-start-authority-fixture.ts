import {
  AttemptStatus,
  RunStatus,
  WorkflowPhase,
  policyBundleId,
  type Attempt,
  type ExecutionProfile,
  type ExecutionProfileDefinition,
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
  createExecutionProfileInstaller,
  createM1AcceptanceCheckerIdentity,
  createPolicyInstaller,
  type Clock,
  type WorkerControlStore,
} from '@codeclosure/runtime';
import {
  WorkflowRuntimeKernel,
  type AttemptContextCompilationRequest,
} from '@codeclosure/runtime/testing/workflow-runtime';

import { DeterministicIds } from './deterministic-fixtures.js';
import { testExecutionProfileDefinition } from './execution-profile-fixture.js';

export interface StartWorkflowAuthorityFixtureInput {
  readonly store: WorkerControlStore;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly namespace: string;
}

export interface CreateWorkflowStartAuthorityRuntimeInput {
  readonly store: WorkerControlStore;
  readonly namespace: string;
  readonly clock: Clock;
  readonly policyDefinition?: PolicyBundleDefinition;
  readonly executionProfileDefinition?: ExecutionProfileDefinition;
}

export interface WorkflowStartAuthorityRuntimeFixture {
  readonly kernel: WorkflowRuntimeKernel;
  readonly policy: PolicyBundle;
  readonly profile: ExecutionProfile;
}

export interface RunningWorkflowAuthorityFixture {
  readonly kernel: WorkflowRuntimeKernel;
  readonly goal: Goal;
  readonly workflow: WorkflowInstance;
  readonly attempt: Attempt;
  readonly policy: PolicyBundle;
  readonly profile: ExecutionProfile;
}

export interface ReadyWorkflowAuthorityFixture extends Omit<
  RunningWorkflowAuthorityFixture,
  'workflow' | 'attempt'
> {
  readonly workflow: WorkflowInstance;
  readonly attempt: Attempt;
}

function policyDefinition(
  namespace: string,
  digests: CanonicalJsonSha256DigestProvider,
): PolicyBundleDefinition {
  return Object.freeze({
    id: policyBundleId(`policy_${namespace}`),
    schemaVersion: 1,
    version: 'm1-start-authority-fixture-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['execution-profile-bound-context']),
    checkSpecifications: Object.freeze(['runtime-owned-check-specifications']),
    applicabilityRules: Object.freeze(['exact-candidate-and-policy']),
    acceptanceRules: M1_ACCEPTANCE_RULES,
    checkerVersions: Object.freeze([createM1AcceptanceCheckerIdentity(digests)]),
  });
}

function requireWorkflow(store: WorkerControlStore, workflow: WorkflowInstance): WorkflowInstance {
  const retained = store.getWorkflow(workflow.id);
  if (retained === undefined) {
    throw new TypeError(`Workflow ${workflow.id} disappeared from the fixture Store`);
  }
  return retained;
}

function requireAttempt(store: WorkerControlStore, attempt: Attempt): Attempt {
  const retained = store.getAttempt(attempt.id);
  if (retained === undefined) {
    throw new TypeError(`Attempt ${attempt.id} disappeared from the fixture Store`);
  }
  return retained;
}

/**
 * Establishes the same immutable Policy/Profile/Context authority that the
 * production StartGoal path requires. Store tests must not manufacture an
 * executable first Attempt through lower-level persistence ports.
 */
export function startWorkflowAuthorityFixture(
  input: StartWorkflowAuthorityFixtureInput,
): RunningWorkflowAuthorityFixture {
  const runtime = createWorkflowStartAuthorityRuntime({
    store: input.store,
    namespace: input.namespace,
    clock: Object.freeze({ now: () => input.workflow.updatedAt }),
  });
  const ids = new DeterministicIds(`${input.namespace.toLowerCase().replaceAll('_', '-')}-start`);
  const result = runtime.kernel.startGoal({
    commandId: ids.nextCommandId(),
    goalId: input.goal.id,
    expectedGoalRevision: input.goal.revision,
    expectedWorkflowVersion: input.workflow.version,
  });
  if (result.status !== 'APPLIED') {
    throw new TypeError(`Start authority fixture failed: ${JSON.stringify(result)}`);
  }

  const workflow = requireWorkflow(input.store, input.workflow);
  if (
    workflow.phase !== WorkflowPhase.DISCOVERY ||
    workflow.runStatus !== RunStatus.RUNNING ||
    workflow.activeAttemptId === undefined
  ) {
    throw new TypeError('Start authority fixture did not retain the first active Attempt');
  }
  const attempt = input.store.getAttempt(workflow.activeAttemptId);
  if (attempt?.status !== AttemptStatus.RUNNING || attempt.sequence !== 1) {
    throw new TypeError('Start authority fixture retained an invalid first Attempt');
  }

  return Object.freeze({
    ...runtime,
    goal: input.goal,
    workflow,
    attempt,
  });
}

export function createWorkflowStartAuthorityRuntime(
  input: CreateWorkflowStartAuthorityRuntimeInput,
): WorkflowStartAuthorityRuntimeFixture {
  const namespace = input.namespace.toLowerCase().replaceAll('_', '-');
  const ids = new DeterministicIds(namespace);
  const digests = new CanonicalJsonSha256DigestProvider();

  const policyInstall = createPolicyInstaller({
    store: input.store,
    clock: input.clock,
    ids,
    digests,
  }).installPolicyBundle(input.policyDefinition ?? policyDefinition(namespace, digests));
  if (policyInstall.status === 'POLICY_CONFLICT') {
    throw new TypeError(policyInstall.message);
  }
  const profileInstall = createExecutionProfileInstaller({
    store: input.store,
    clock: input.clock,
    ids,
    digests,
  }).installExecutionProfile(
    input.executionProfileDefinition ?? testExecutionProfileDefinition(namespace),
  );
  if (profileInstall.status === 'PROFILE_CONFLICT') {
    throw new TypeError(profileInstall.message);
  }

  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm1-context-compiler-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  });
  const kernel = new WorkflowRuntimeKernel({
    store: input.store,
    clock: input.clock,
    ids,
    digests,
    workerContext: Object.freeze({
      identities: ids,
      factory: Object.freeze({
        compile: (request: AttemptContextCompilationRequest) => compiler.compile(request),
      }),
      executionProfileId: profileInstall.value.profile.id,
      executionProfileDigest: profileInstall.value.profile.digest,
      policyBundleId: policyInstall.value.bundle.id,
      policyBundleDigest: policyInstall.value.bundle.digest,
    }),
  });
  return Object.freeze({
    kernel,
    policy: policyInstall.value.bundle,
    profile: profileInstall.value.profile,
  });
}

export function finishWorkflowAuthorityFixture(
  input: RunningWorkflowAuthorityFixture,
  store: WorkerControlStore,
): ReadyWorkflowAuthorityFixture {
  const result = input.kernel.recordAttemptResult({
    commandId: new DeterministicIds(
      `${input.workflow.id.slice('workflow_'.length)}-finish`,
    ).nextCommandId(),
    workflowId: input.workflow.id,
    expectedWorkflowVersion: input.workflow.version,
    attemptId: input.attempt.id,
    reason: 'Fixture completed the first bounded DISCOVERY Attempt',
  });
  if (result.status !== 'APPLIED') {
    throw new TypeError(`Start authority fixture completion failed: ${JSON.stringify(result)}`);
  }
  const workflow = requireWorkflow(store, input.workflow);
  const attempt = requireAttempt(store, input.attempt);
  if (
    workflow.phase !== WorkflowPhase.DISCOVERY ||
    workflow.runStatus !== RunStatus.READY ||
    workflow.activeAttemptId !== undefined ||
    attempt.status !== AttemptStatus.RESULT_RECORDED
  ) {
    throw new TypeError('Start authority fixture did not retain a completed first Attempt');
  }
  return Object.freeze({ ...input, workflow, attempt });
}
