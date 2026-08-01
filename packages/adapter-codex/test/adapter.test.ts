import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import test, { type TestContext } from 'node:test';

import {
  CODEX_WORKER_PROMPT_PROFILE,
  CODEX_WORKER_PROMPT_TEMPLATE_DIGEST,
  CodexWorkerAdapter,
  candidateWorkspaceLeaseProjection,
  codexExternalExecutionIntentProjection,
  decodeCodexWorkerDirective,
  digestCanonical,
  type CandidateWorkspaceLease,
  type CodexExecutionProfileDirective,
  type CodexWorkerDirective,
  type CodexWorkerRequestBinding,
} from '@codeclosure/adapter-codex';
import { createFixtureAppServerLaunch } from '@codeclosure/codex-app-server-client/testing';
import { deriveCapabilityGrant, WorkflowPhase } from '@codeclosure/domain';
import {
  decodeWorkerEvent,
  decodeWorkerRequest,
  type WorkerEvent,
  type WorkerRequest,
} from '@codeclosure/runtime';

const fixtureScript = resolve(import.meta.dirname, 'fixtures', 'fake-app-server.mjs');
const fixedObservedAt = '2026-07-31T08:00:00.000Z';

function hash(character: string): string {
  return `sha256:${character.repeat(64)}`;
}

function lifecycleKinds(events: readonly unknown[]): readonly unknown[] {
  return events.map((event) => {
    if (typeof event !== 'object' || event === null) {
      return undefined;
    }
    const kind: unknown = Reflect.get(event, 'kind');
    return kind;
  });
}

interface Harness {
  readonly adapter: CodexWorkerAdapter;
  readonly directive: CodexWorkerDirective;
  readonly launch: ReturnType<typeof createFixtureAppServerLaunch>;
  readonly lifecycleEvents: readonly unknown[];
  readonly request: WorkerRequest;
  readonly root: string;
}

function fixtureDirectories(t: TestContext): {
  readonly candidate: string;
  readonly codexHome: string;
  readonly processHome: string;
  readonly root: string;
  readonly source: string;
  readonly temporaryDirectory: string;
  readonly workspaceRoot: string;
} {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-codex-adapter-test-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const workspaceRoot = join(root, 'workspaces');
  const candidate = join(workspaceRoot, 'candidate');
  const codexHome = join(root, 'codex-home');
  const processHome = join(root, 'process-home');
  const source = join(root, 'source');
  const temporaryDirectory = join(root, 'process-tmp');
  for (const path of [
    workspaceRoot,
    candidate,
    codexHome,
    processHome,
    source,
    temporaryDirectory,
  ]) {
    mkdirSync(path);
  }
  mkdirSync(join(candidate, 'src'));
  return {
    candidate,
    codexHome,
    processHome,
    root,
    source,
    temporaryDirectory,
    workspaceRoot,
  };
}

function workerRequest(source: string): WorkerRequest {
  const contextPackage = {
    schemaVersion: 2,
    goalId: 'goal_adapter',
    goalRevision: 1,
    workflowId: 'workflow_adapter',
    workflowVersion: 3,
    phase: WorkflowPhase.IMPLEMENT,
    attemptId: 'attempt_adapter',
    candidateGenerationId: 'generation_adapter',
    candidateDigest: hash('a'),
    phaseObjective: 'Implement the exact bounded change.',
    capabilityGrant: deriveCapabilityGrant(WorkflowPhase.IMPLEMENT),
    goal: {
      objective: 'Implement one bounded fixture change.',
      successCriteria: [
        {
          id: 'criterion_adapter',
          description: 'The bounded fixture change is present.',
          required: true,
        },
      ],
      scope: { projectPath: source, allowedPaths: ['src'] },
      nonGoals: ['Do not release or deploy.'],
    },
    selectedEntries: [],
    executionProfileId: 'profile_adapter',
    executionProfileDigest: hash('b'),
    policyBundleId: 'policy_adapter',
    policyBundleDigest: hash('c'),
    responseContract: {
      schemaVersion: 1,
      workerEventSchemaVersion: 1,
      allowedResultKinds: ['COMPLETION_REQUEST'],
      unknownFields: 'REJECT',
      maxEventBytes: 64 * 1024,
    },
  };
  return decodeWorkerRequest({
    schemaVersion: 2,
    workerSessionId: 'worker_adapter',
    attemptId: contextPackage.attemptId,
    contextManifestId: 'context_adapter',
    contextManifestDigest: hash('d'),
    packageDigest: hash('e'),
    executionProfileId: contextPackage.executionProfileId,
    executionProfileDigest: contextPackage.executionProfileDigest,
    contextPackage,
  });
}

function requestBinding(request: WorkerRequest): CodexWorkerRequestBinding {
  const context = request.contextPackage;
  if (context.candidateGenerationId === undefined || context.candidateDigest === undefined) {
    throw new TypeError('fixture request requires Candidate binding');
  }
  return Object.freeze({
    attemptId: request.attemptId,
    candidateDigest: context.candidateDigest,
    candidateGenerationId: context.candidateGenerationId,
    contextManifestDigest: request.contextManifestDigest,
    contextManifestId: request.contextManifestId,
    executionProfileDigest: request.executionProfileDigest,
    executionProfileId: request.executionProfileId,
    goalId: context.goalId,
    goalRevision: context.goalRevision,
    packageDigest: request.packageDigest,
    phase: 'IMPLEMENT',
    policyBundleDigest: context.policyBundleDigest,
    policyBundleId: context.policyBundleId,
    workerSessionId: request.workerSessionId,
    workflowId: context.workflowId,
    workflowVersion: context.workflowVersion,
  });
}

function workspaceLease(
  request: WorkerRequest,
  candidate: string,
  codexHome: string,
  source: string,
  workspaceRoot: string,
): CandidateWorkspaceLease {
  const binding = requestBinding(request);
  const allowedPaths = Object.freeze(['src']);
  const reservedPathPolicy = 'M2_CONTROLLED_COPY_V1' as const;
  const base: Omit<CandidateWorkspaceLease, 'leaseDigest'> = Object.freeze({
    accessMode: 'MUTABLE',
    allowedPathPolicyDigest: digestCanonical({ allowedPaths, reservedPathPolicy }),
    allowedPaths,
    candidateId: 'candidate_adapter',
    candidateDigest: binding.candidateDigest,
    candidateGenerationId: binding.candidateGenerationId,
    candidateGenerationVersion: 1,
    forbiddenRoots: Object.freeze([realpathSync(codexHome), realpathSync(source)].sort()),
    generationSequence: 1,
    goalId: binding.goalId,
    goalRevision: binding.goalRevision,
    id: 'candidate-workspace-lease_adapter',
    issuedAt: fixedObservedAt,
    lifecyclePolicy: 'REVOKE_ON_FREEZE',
    parentGenerationId: null,
    reservedPathPolicy,
    retentionPolicy: 'RUNTIME_OWNED',
    root: realpathSync(candidate),
    schemaVersion: 1,
    sourceGitMetadataDigest: hash('7'),
    sourceProjectRoot: realpathSync(source),
    sourceTreeDigest: hash('8'),
    state: 'ACTIVE',
    version: 1,
    workspaceRootIdentity: realpathSync(workspaceRoot),
    workflowId: binding.workflowId,
    workflowVersion: binding.workflowVersion,
  });
  return Object.freeze({
    ...base,
    leaseDigest: digestCanonical(candidateWorkspaceLeaseProjection(base)),
  });
}

const managedRequirements = Object.freeze({
  requirements: Object.freeze({ managed: true, profile: 'fixture' }),
});
const effectiveConfig = Object.freeze({
  config: Object.freeze({
    approval_policy: 'never',
    default_permissions: 'codeclosure-m2',
    model: 'gpt-fixture',
    model_provider: 'openai',
    model_reasoning_effort: 'low',
    web_search: 'disabled',
  }),
  layers: Object.freeze([]),
});
const permissionProfile = Object.freeze({
  allowed: true,
  id: 'codeclosure-m2',
  name: 'CodeClosure M2',
});

function profileDirective(
  launch: ReturnType<typeof createFixtureAppServerLaunch>,
  thread: CodexExecutionProfileDirective['thread'] = Object.freeze({ kind: 'FRESH' }),
  compactionPolicy: CodexExecutionProfileDirective['compactionPolicy'] = 'FAIL_ON_OBSERVATION',
): CodexExecutionProfileDirective {
  const instructionSources = Object.freeze([]);
  return Object.freeze({
    approvalPolicy: 'never',
    approvalsReviewer: 'user',
    codexVersion: launch.summary.codexVersion,
    compactionPolicy,
    configReadDigest: digestCanonical(effectiveConfig),
    controlledStateRootIdentity: launch.summary.codexHome,
    delegatedExecutableDigest: launch.summary.delegatedExecutableDigest,
    disabledIntegrations: Object.freeze([
      'APPS',
      'DYNAMIC_TOOLS',
      'HOOKS',
      'MCP',
      'PLUGINS',
      'SKILLS',
      'SUBAGENTS',
      'WEB_SEARCH',
    ]),
    environmentNames: launch.summary.environmentNames,
    fallbackPolicy: 'FAIL_CLOSED',
    instructionSourceManifestDigest: digestCanonical({ instructionSources }),
    instructionSources,
    launcherDigest: launch.summary.launcherDigest,
    managedRequirementsDigest: digestCanonical(managedRequirements),
    maximumPromptBytes: 256 * 1024,
    model: 'gpt-fixture',
    modelProvider: 'openai',
    networkAccess: false,
    nonSecretEnvironmentDigest: digestCanonical(launch.summary.nonSecretEnvironment),
    permissionProfileDigest: digestCanonical(permissionProfile),
    permissionProfileId: 'codeclosure-m2',
    promptProfile: CODEX_WORKER_PROMPT_PROFILE,
    promptTemplateDigest: CODEX_WORKER_PROMPT_TEMPLATE_DIGEST,
    protocolSnapshotDigest: launch.summary.protocolSnapshotDigest,
    reasoningEffort: 'low',
    retentionPolicy: 'CONTROLLED',
    secretEnvironmentNames: launch.summary.secretEnvironmentNames,
    serviceTier: null,
    terminalTimeoutMilliseconds: 150,
    thread,
  });
}

function directive(
  request: WorkerRequest,
  lease: CandidateWorkspaceLease,
  profile: CodexExecutionProfileDirective,
): CodexWorkerDirective {
  const base: Omit<CodexWorkerDirective, 'externalExecutionIntentDigest'> = Object.freeze({
    processLaunchNonce: hash('9'),
    profile,
    request: requestBinding(request),
    schemaVersion: 1,
    workspaceLease: lease,
  });
  return decodeCodexWorkerDirective({
    ...base,
    externalExecutionIntentDigest: digestCanonical(codexExternalExecutionIntentProjection(base)),
  });
}

function createHarness(
  t: TestContext,
  scenario: string,
  thread?: CodexExecutionProfileDirective['thread'],
  compactionPolicy?: CodexExecutionProfileDirective['compactionPolicy'],
): Harness {
  const directories = fixtureDirectories(t);
  const launch = createFixtureAppServerLaunch({
    codexHome: directories.codexHome,
    cwd: directories.candidate,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome: directories.processHome,
    scenario,
    scriptPath: fixtureScript,
    temporaryDirectory: directories.temporaryDirectory,
  });
  const request = workerRequest(directories.source);
  const lease = workspaceLease(
    request,
    directories.candidate,
    directories.codexHome,
    directories.source,
    directories.workspaceRoot,
  );
  const selectedDirective = directive(
    request,
    lease,
    profileDirective(launch, thread, compactionPolicy),
  );
  const lifecycleEvents: unknown[] = [];
  return Object.freeze({
    adapter: new CodexWorkerAdapter({
      clientLimits: {
        requestTimeoutMilliseconds: 500,
        shutdownGraceMilliseconds: 100,
        shutdownKillMilliseconds: 100,
      },
      directive: selectedDirective,
      launch,
      onLifecycleEvent: (event) => lifecycleEvents.push(event),
      observedAt: () => fixedObservedAt,
    }),
    directive: selectedDirective,
    launch,
    lifecycleEvents,
    request,
    root: directories.root,
  });
}

async function collect(
  adapter: CodexWorkerAdapter,
  request: WorkerRequest,
  signal: AbortSignal = new AbortController().signal,
): Promise<readonly WorkerEvent[]> {
  const events: WorkerEvent[] = [];
  for await (const value of adapter.run(request, signal)) {
    events.push(decodeWorkerEvent(value));
  }
  return Object.freeze(events);
}

async function waitForBoundTurn(adapter: CodexWorkerAdapter): Promise<void> {
  for (let count = 0; count < 200; count += 1) {
    if (adapter.observation().backendOperationRef !== undefined) {
      return;
    }
    await new Promise<void>((resolveWait) => setTimeout(resolveWait, 5));
  }
  throw new Error('fixture Turn did not start');
}

void test('[I-004][I-019] one exact structured IMPLEMENT payload becomes one bounded Worker result', async (t) => {
  const harness = createHarness(t, 'happy');
  const events = await collect(harness.adapter, harness.request);
  assert.equal(events.length, 1, JSON.stringify(harness.adapter.observation()));
  const event = events[0];
  if (event?.type !== 'WORKER_RESULT') {
    assert.fail('fixture did not emit a Worker result');
  }
  assert.equal(event.workerSessionId, harness.request.workerSessionId);
  assert.equal(event.attemptId, harness.request.attemptId);
  assert.deepEqual(event.result, {
    kind: 'COMPLETION_REQUEST',
    claimedScope: 'src',
    summary: 'Implemented the bounded Candidate change.',
    proposedEvidenceRefs: ['worker-observation:edited-src'],
  });
  const observation = harness.adapter.observation();
  assert.equal(observation.state, 'COMPLETED');
  assert.equal(observation.processLaunchCount, 1);
  assert.equal(observation.threadRequestCount, 1);
  assert.equal(observation.turnRequestCount, 1);
  assert.equal(observation.backendSessionRef, 'thread-fixture');
  assert.equal(observation.backendOperationRef, 'turn-fixture');
  assert.equal(JSON.stringify(event).includes('thread-fixture'), false);
  assert.equal(JSON.stringify(event).includes('ACCEPT'), false);
});

void test('[I-027][M2-G13] authorized manual compaction continues on the same Thread before one Worker Turn', async (t) => {
  const harness = createHarness(t, 'happy', undefined, 'MANUAL_BEFORE_OPERATION');
  const events = await collect(harness.adapter, harness.request);
  assert.equal(events.length, 1, JSON.stringify(harness.adapter.observation()));
  const observation = harness.adapter.observation();
  assert.equal(observation.state, 'COMPLETED');
  assert.equal(observation.compactionCount, 1);
  assert.equal(observation.backendSessionRef, 'thread-fixture');
  assert.equal(observation.backendOperationRef, 'turn-fixture');
  assert.equal(observation.threadRequestCount, 1);
  assert.equal(observation.turnRequestCount, 1);
  assert.deepEqual(lifecycleKinds(harness.lifecycleEvents), [
    'PROCESS_STARTED',
    'SESSION_STARTED',
    'OPERATION_STARTED',
    'TERMINAL',
  ]);
  const processEvent = harness.lifecycleEvents[0];
  assert.equal(
    Reflect.get(Reflect.get(processEvent as object, 'processIdentity') as object, 'launchNonce'),
    harness.directive.processLaunchNonce,
  );
});

void test('[I-027][M2-G13] an extra Turn during manual compaction is not admitted as maintenance', async (t) => {
  const harness = createHarness(
    t,
    'manual-compaction-extra-turn',
    undefined,
    'MANUAL_BEFORE_OPERATION',
  );
  assert.deepEqual(await collect(harness.adapter, harness.request), []);
  const observation = harness.adapter.observation();
  assert.equal(observation.failureCode, 'COMPACTION_POLICY_VIOLATION');
  assert.equal(observation.turnRequestCount, 0);
  assert.equal(observation.backendOperationRef, undefined);
  assert.deepEqual(lifecycleKinds(harness.lifecycleEvents), [
    'PROCESS_STARTED',
    'SESSION_STARTED',
    'TERMINAL',
  ]);
});

void test('[I-004] plan, command, diff, reasoning, and passing-looking diagnostics remain non-authoritative', async (t) => {
  const harness = createHarness(t, 'diagnostics');
  const events = await collect(harness.adapter, harness.request);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, 'WORKER_RESULT');
  assert.equal(harness.adapter.observation().notificationCount, 15);
});

for (const scenario of [
  'free-form-done',
  'fabricated-accept',
  'plan-only',
  'wrong-binding',
  'wrong-phase',
  'multiple-final',
] as const) {
  void test(`[I-004][I-027] ${scenario} cannot manufacture a terminal Worker result`, async (t) => {
    const harness = createHarness(t, scenario);
    assert.deepEqual(await collect(harness.adapter, harness.request), []);
    assert.equal(harness.adapter.observation().failureCode, 'INVALID_TERMINAL_PAYLOAD');
  });
}

for (const scenario of ['config-drift', 'requirements-drift', 'profile-drift'] as const) {
  void test(`[I-019][I-027] ${scenario} blocks before a Codex Turn`, async (t) => {
    const harness = createHarness(t, scenario);
    assert.deepEqual(await collect(harness.adapter, harness.request), []);
    const observation = harness.adapter.observation();
    assert.equal(observation.failureCode, 'EFFECTIVE_INPUT_MISMATCH');
    assert.equal(observation.turnRequestCount, 0);
  });
}

void test('[I-019][I-027] an unexpected instruction source blocks before a Codex Turn', async (t) => {
  const harness = createHarness(t, 'instruction-extra');
  assert.deepEqual(await collect(harness.adapter, harness.request), []);
  const observation = harness.adapter.observation();
  assert.equal(observation.failureCode, 'EFFECTIVE_INPUT_MISMATCH');
  assert.equal(observation.threadRequestCount, 1);
  assert.equal(observation.turnRequestCount, 0);
});

for (const [scenario, code] of [
  ['wrong-thread', 'THREAD_BINDING_MISMATCH'],
  ['wrong-turn', 'TURN_BINDING_MISMATCH'],
  ['duplicate-terminal', 'TURN_BINDING_MISMATCH'],
  ['settings-drift', 'UNSUPPORTED_BACKEND_ACTIVITY'],
  ['unsupported-item', 'UNSUPPORTED_BACKEND_ACTIVITY'],
  ['unknown-item', 'UNSUPPORTED_BACKEND_ACTIVITY'],
  ['terminal-only-unknown-item', 'UNSUPPORTED_BACKEND_ACTIVITY'],
  ['plugin-command', 'UNSUPPORTED_BACKEND_ACTIVITY'],
  ['skill-user-message', 'UNSUPPORTED_BACKEND_ACTIVITY'],
  ['mismatched-user-message', 'UNSUPPORTED_BACKEND_ACTIVITY'],
  ['malformed-agent-message', 'UNSUPPORTED_BACKEND_ACTIVITY'],
  ['terminal-only-in-progress-item', 'UNSUPPORTED_BACKEND_ACTIVITY'],
  ['compaction', 'COMPACTION_POLICY_VIOLATION'],
  ['approval', 'DECLINED_APPROVAL_REQUEST'],
] as const) {
  void test(`[I-021][I-027] ${scenario} fails closed without a Worker result`, async (t) => {
    const harness = createHarness(t, scenario);
    assert.deepEqual(await collect(harness.adapter, harness.request), []);
    assert.equal(harness.adapter.observation().failureCode, code);
  });
}

void test('[I-027] a terminal Turn without an explicit full Item view cannot emit a result', async (t) => {
  const harness = createHarness(t, 'missing-items-view');
  assert.deepEqual(await collect(harness.adapter, harness.request), []);
  assert.equal(harness.adapter.observation().failureCode, 'INVALID_TERMINAL_PAYLOAD');
});

void test('[I-004] a backend-failed Turn maps only to the existing generic Worker failure', async (t) => {
  const harness = createHarness(t, 'backend-failed');
  const events = await collect(harness.adapter, harness.request);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0], {
    schemaVersion: 1,
    id: events[0]?.id,
    workerSessionId: harness.request.workerSessionId,
    attemptId: harness.request.attemptId,
    contextManifestId: harness.request.contextManifestId,
    contextManifestDigest: harness.request.contextManifestDigest,
    packageDigest: harness.request.packageDigest,
    observedAt: fixedObservedAt,
    type: 'WORKER_FAILURE',
    reasonCode: 'WORKER_BACKEND_FAILURE',
  });
  assert.equal(harness.adapter.observation().failureCode, 'BACKEND_TURN_FAILED');
  assert.equal(harness.adapter.observation().state, 'FAILED');
});

void test('[I-027] no terminal notification ends as a typed adapter observation and no event', async (t) => {
  const harness = createHarness(t, 'no-terminal');
  assert.deepEqual(await collect(harness.adapter, harness.request), []);
  assert.equal(harness.adapter.observation().failureCode, 'NO_TERMINAL_PAYLOAD');
});

void test('[I-027] host cancellation interrupts the known Turn once and cannot emit a late result', async (t) => {
  const harness = createHarness(t, 'interrupt');
  const controller = new AbortController();
  const pending = collect(harness.adapter, harness.request, controller.signal);
  await waitForBoundTurn(harness.adapter);
  controller.abort('fixture cancellation');
  const events = await pending;
  assert.deepEqual(events, []);
  const observation = harness.adapter.observation();
  assert.equal(observation.failureCode, 'HOST_CANCELLED');
  assert.equal(observation.state, 'INTERRUPTED');
  assert.equal(observation.turnInterruptCount, 1);
});

void test('[I-027] cancellation after the terminal payload but before event admission suppresses the result', async (t) => {
  const harness = createHarness(t, 'happy');
  const controller = new AbortController();
  const adapter = new CodexWorkerAdapter({
    clientLimits: {
      requestTimeoutMilliseconds: 500,
      shutdownGraceMilliseconds: 100,
      shutdownKillMilliseconds: 100,
    },
    directive: harness.directive,
    launch: harness.launch,
    onLifecycleEvent: () => undefined,
    observedAt: () => {
      controller.abort('post-terminal fixture cancellation');
      return fixedObservedAt;
    },
  });
  assert.deepEqual(await collect(adapter, harness.request, controller.signal), []);
  const observation = adapter.observation();
  assert.equal(observation.failureCode, 'HOST_CANCELLED');
  assert.equal(observation.state, 'INTERRUPTED');
  assert.equal(observation.resultEventId, undefined);
  assert.equal(observation.turnInterruptCount, 0);
});

void test('[I-027] process exit is a client failure without a hidden retry or replacement Thread', async (t) => {
  const harness = createHarness(t, 'process-exit');
  assert.deepEqual(await collect(harness.adapter, harness.request), []);
  const observation = harness.adapter.observation();
  assert.equal(observation.failureCode, 'CLIENT_FAILURE');
  assert.equal(observation.processLaunchCount, 1);
  assert.equal(observation.threadRequestCount, 1);
  assert.equal(observation.turnRequestCount, 1);
});

void test('[I-019][I-027] exact Runtime binding is checked before process launch', async (t) => {
  const harness = createHarness(t, 'happy');
  const mismatched = decodeWorkerRequest({
    ...harness.request,
    workerSessionId: 'worker_other',
  });
  assert.deepEqual(await collect(harness.adapter, mismatched), []);
  const observation = harness.adapter.observation();
  assert.equal(observation.failureCode, 'INVALID_REQUEST_BINDING');
  assert.equal(observation.processLaunchCount, 0);
});

void test('[I-027] phase mapping is explicit and a non-IMPLEMENT request does not spawn', async (t) => {
  const harness = createHarness(t, 'happy');
  const contextPackage = {
    ...harness.request.contextPackage,
    phase: WorkflowPhase.PLAN,
    capabilityGrant: deriveCapabilityGrant(WorkflowPhase.PLAN),
    responseContract: {
      ...harness.request.contextPackage.responseContract,
      allowedResultKinds: ['PROPOSALS'],
    },
  };
  const planRequest = decodeWorkerRequest({ ...harness.request, contextPackage });
  assert.deepEqual(await collect(harness.adapter, planRequest), []);
  assert.equal(harness.adapter.observation().failureCode, 'UNSUPPORTED_PHASE');
  assert.equal(harness.adapter.observation().processLaunchCount, 0);
});

void test('[I-027] stale lease state and launch/intent drift are rejected at composition', (t) => {
  const harness = createHarness(t, 'happy');
  assert.throws(
    () =>
      decodeCodexWorkerDirective({
        ...harness.directive,
        workspaceLease: { ...harness.directive.workspaceLease, state: 'REVOKED' },
      }),
    /state/u,
  );
  assert.throws(
    () =>
      decodeCodexWorkerDirective({
        ...harness.directive,
        externalExecutionIntentDigest: hash('f'),
      }),
    /intent digest/u,
  );
  for (const profile of [
    {
      ...harness.directive.profile,
      controlledStateRootIdentity: harness.directive.workspaceLease.sourceProjectRoot,
    },
    {
      ...harness.directive.profile,
      environmentNames: Object.freeze(
        [...harness.directive.profile.environmentNames, 'POISONED_AMBIENT_INPUT'].sort(),
      ),
    },
  ]) {
    const base: Omit<CodexWorkerDirective, 'externalExecutionIntentDigest'> = {
      processLaunchNonce: harness.directive.processLaunchNonce,
      profile,
      request: harness.directive.request,
      schemaVersion: 1,
      workspaceLease: harness.directive.workspaceLease,
    };
    const rebound = decodeCodexWorkerDirective({
      ...base,
      externalExecutionIntentDigest: digestCanonical(codexExternalExecutionIntentProjection(base)),
    });
    assert.throws(
      () =>
        new CodexWorkerAdapter({
          directive: rebound,
          launch: harness.launch,
          onLifecycleEvent: () => undefined,
          observedAt: () => fixedObservedAt,
        }),
      /launch does not bind/u,
    );
  }
});

void test('[I-019][I-027] every non-secret launch environment value is bound at composition', (t) => {
  const harness = createHarness(t, 'happy');
  const alternateHome = join(harness.root, 'alternate-home');
  const alternateTemporaryDirectory = join(harness.root, 'alternate-tmp');
  mkdirSync(alternateHome);
  mkdirSync(alternateTemporaryDirectory);
  const common = {
    codexHome: harness.launch.summary.codexHome,
    cwd: harness.launch.summary.cwd,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome: join(harness.root, 'process-home'),
    scenario: 'happy',
    scriptPath: fixtureScript,
    temporaryDirectory: join(harness.root, 'process-tmp'),
  };
  for (const launch of [
    createFixtureAppServerLaunch({ ...common, executableSearchPath: '/different/toolchain' }),
    createFixtureAppServerLaunch({ ...common, processHome: alternateHome }),
    createFixtureAppServerLaunch({ ...common, temporaryDirectory: alternateTemporaryDirectory }),
    createFixtureAppServerLaunch({ ...common, locale: 'en_US.UTF-8' }),
  ]) {
    assert.throws(
      () =>
        new CodexWorkerAdapter({
          directive: harness.directive,
          launch,
          onLifecycleEvent: () => undefined,
          observedAt: () => fixedObservedAt,
        }),
      /launch does not bind/u,
    );
  }
});

void test('[I-019][I-027] controlled host roots cannot overlap Candidate or source roots', async (t) => {
  const harness = createHarness(t, 'happy');
  const common = {
    codexHome: harness.launch.summary.codexHome,
    cwd: harness.launch.summary.cwd,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome: join(harness.root, 'process-home'),
    scenario: 'happy',
    scriptPath: fixtureScript,
    temporaryDirectory: join(harness.root, 'process-tmp'),
  };
  for (const overlappingLaunch of [
    createFixtureAppServerLaunch({ ...common, processHome: harness.launch.summary.cwd }),
    createFixtureAppServerLaunch({
      ...common,
      processHome: harness.directive.workspaceLease.sourceProjectRoot,
    }),
    createFixtureAppServerLaunch({
      ...common,
      temporaryDirectory: harness.directive.workspaceLease.sourceProjectRoot,
    }),
    createFixtureAppServerLaunch({
      ...common,
      codexHome: harness.directive.workspaceLease.sourceProjectRoot,
    }),
  ]) {
    const profile = Object.freeze({
      ...harness.directive.profile,
      controlledStateRootIdentity: overlappingLaunch.summary.codexHome,
      nonSecretEnvironmentDigest: digestCanonical(overlappingLaunch.summary.nonSecretEnvironment),
    });
    const base: Omit<CodexWorkerDirective, 'externalExecutionIntentDigest'> = Object.freeze({
      processLaunchNonce: harness.directive.processLaunchNonce,
      profile,
      request: harness.directive.request,
      schemaVersion: 1,
      workspaceLease: harness.directive.workspaceLease,
    });
    const rebound = decodeCodexWorkerDirective({
      ...base,
      externalExecutionIntentDigest: digestCanonical(codexExternalExecutionIntentProjection(base)),
    });
    const adapter = new CodexWorkerAdapter({
      directive: rebound,
      launch: overlappingLaunch,
      onLifecycleEvent: () => undefined,
      observedAt: () => fixedObservedAt,
    });
    assert.deepEqual(await collect(adapter, harness.request), []);
    assert.equal(adapter.observation().failureCode, 'EFFECTIVE_INPUT_MISMATCH');
    assert.equal(adapter.observation().processLaunchCount, 0);
  }
});

void test('[I-027] an exact Runtime-issued resume directive uses only its bound backend session', async (t) => {
  const harness = createHarness(
    t,
    'happy',
    Object.freeze({
      backendSessionRef: 'thread-resumed',
      kind: 'RESUME',
      resumeBindingDigest: hash('9'),
    }),
  );
  const events = await collect(harness.adapter, harness.request);
  assert.equal(events.length, 1);
  assert.equal(harness.adapter.observation().backendSessionRef, 'thread-resumed');
  assert.equal(harness.adapter.observation().threadRequestCount, 1);
});

void test('[I-004][I-027] event identity is request-bound: exact replay matches and changed payload conflicts', async (t) => {
  const first = createHarness(t, 'happy');
  const firstEvent = (await collect(first.adapter, first.request))[0];
  if (firstEvent === undefined) {
    assert.fail('first fixture emitted no event');
  }
  const exactReplay = new CodexWorkerAdapter({
    directive: first.directive,
    launch: first.launch,
    onLifecycleEvent: () => undefined,
    observedAt: () => fixedObservedAt,
  });
  const replayEvent = (await collect(exactReplay, first.request))[0];
  assert.deepEqual(replayEvent, firstEvent);

  const conflicting = new CodexWorkerAdapter({
    directive: first.directive,
    launch: createFixtureAppServerLaunch({
      codexHome: first.launch.summary.codexHome,
      cwd: first.launch.summary.cwd,
      executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
      processHome: join(first.root, 'process-home'),
      scenario: 'alternate-valid',
      scriptPath: fixtureScript,
      temporaryDirectory: join(first.root, 'process-tmp'),
    }),
    onLifecycleEvent: () => undefined,
    observedAt: () => fixedObservedAt,
  });
  const conflictingEvent = (await collect(conflicting, first.request))[0];
  assert.equal(conflictingEvent?.id, firstEvent.id);
  assert.notDeepEqual(conflictingEvent, firstEvent);
});

void test('[I-019][I-021] bounded observations retain identity and counts, not transcript or reasoning', async (t) => {
  const harness = createHarness(t, 'diagnostics');
  await collect(harness.adapter, harness.request);
  const encoded = JSON.stringify(harness.adapter.observation());
  assert.ok(encoded.includes(harness.directive.externalExecutionIntentDigest));
  assert.ok(encoded.includes(harness.directive.workspaceLease.leaseDigest));
  for (const forbidden of [
    'Implemented the bounded',
    'passing-looking output',
    'Bounded plan',
    'reasoning-1',
  ]) {
    assert.equal(encoded.includes(forbidden), false);
  }
});
