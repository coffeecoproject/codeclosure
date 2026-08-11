import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import process from 'node:process';
import test, { type TestContext } from 'node:test';

import type { JsonObject } from '@codeclosure/codex-app-server-client';
import {
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_GIT_STATE_PROFILE,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  PROJECT_READ_SOURCE_TREE_PROFILE,
  ProjectReadLifecyclePolicy,
  ProjectReadModelUsableNetworkPolicy,
  ProjectReadRetentionPolicy,
  ProjectReadSnapshotAccessMode,
  ProjectReadSourceCheckoutAccess,
  WorkflowPhase,
  decodeProjectReadGitStateProjection,
  decodeProjectReadSourceTreeProjection,
  decodeProjectSourceReadAuthorityRecord,
  deriveCapabilityGrant,
  executionProfileId,
  isoTimestamp,
  policyBundleId,
  projectReadSnapshotId,
  projectReadGitStateProjection,
  projectReadSelectedPathSetProjection,
  projectReadSourceTreeProjection,
  projectSourceReadAuthorityId,
  projectSourceReadAuthorityProjection,
  sha256Digest,
  type ProjectSourceReadAuthorityRecord,
} from '@codeclosure/domain';
import {
  decodeWorkerEvent,
  decodeWorkerRequest,
  m1WorkerResponseContract,
  type WorkerEvent,
  type WorkerRequest,
} from '@codeclosure/runtime';

import {
  CODEX_M251_WORKER_ACTIVITY_DISPOSITIONS,
  CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
  CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
  CODEX_M251_WORKER_ACTIVITY_POLICY_PROJECTION,
  CODEX_M251_WORKER_ACTIVITY_POLICY_VERSION,
  CODEX_M251_WORKER_ADAPTER_ID,
  CODEX_M251_WORKER_ADAPTER_VERSION,
  CODEX_M251_WORKER_DISABLED_FEATURES,
  CODEX_M251_WORKER_DISABLED_INTEGRATIONS_DIGEST,
  CODEX_M251_WORKER_EFFECTIVE_FEATURES,
  CODEX_M251_WORKER_ISOLATION_PROFILE_ID,
  CodexWorkerAdapter,
  assertM251EffectiveConfiguration,
  assertDirectiveV3BindsWorkerRequest,
  candidateWorkspaceLeaseProjection,
  codexFinalPayloadBindingV3,
  codexWorkerActivityPolicyV1,
  codexWorkerDirectiveV3Projection,
  codexM251WorkerIsolationProfileDigest,
  codexWorkerSourceAuthorityReceiptV1,
  createCodexWorkerDirectiveV3,
  decodeCodexCandidateWorkspaceLease,
  decodeCodexWorkerDirectiveV3,
  digestCanonical,
  evaluateCodexWorkerActivityV1,
  type CandidateWorkspaceLease,
  type CodexWorkerDirectiveV3,
  type CodexWorkerPhaseDirectiveV1,
  type CodexWorkerPhaseIsolationInputV1,
  type CodexWorkerRequestBindingV3,
  type CodexWorkerSharedProfileDirectiveV1,
} from '@codeclosure/adapter-codex';
import { createFixtureAppServerLaunch } from '@codeclosure/codex-app-server-client/testing';

const fixtureScript = resolve(import.meta.dirname, 'fixtures', 'fake-app-server.mjs');
const slice0ContractPath = resolve(
  import.meta.dirname,
  '..',
  '..',
  '..',
  'scripts',
  'fixtures',
  'm2.5.1',
  'slice0-contract.json',
);
const fixedObservedAt = '2026-08-09T14:00:00.000Z';
const fixtureClientLimits = Object.freeze({
  requestTimeoutMilliseconds: 500,
  shutdownGraceMilliseconds: 1_000,
  shutdownKillMilliseconds: 1_000,
});

const hash = (value: string): string => `sha256:${value.padEnd(64, value.slice(-1)).slice(0, 64)}`;

function phaseWithIsolation(phase: CodexWorkerPhaseIsolationInputV1): CodexWorkerPhaseDirectiveV1 {
  return Object.freeze({
    ...phase,
    isolationProfileId: CODEX_M251_WORKER_ISOLATION_PROFILE_ID,
    isolationProfileDigest: codexM251WorkerIsolationProfileDigest(phase),
  });
}

function request(
  phase: 'DISCOVERY' | 'PLAN',
  projectPath = '/source/project',
  authority?: Readonly<{
    id: string;
    recordDigest: string;
    sourceTreeDigest: string;
    gitStateDigest: string;
  }>,
): WorkerRequest {
  const capabilityGrant = deriveCapabilityGrant(phase);
  const responseContract = m1WorkerResponseContract(phase);
  const contextPackage = {
    schemaVersion: 5,
    goalId: 'goal_m251-adapter',
    goalRevision: 1,
    workflowId: 'workflow_m251-adapter',
    workflowVersion: 3,
    phase,
    attemptId: `attempt_m251-${phase.toLowerCase()}`,
    phaseObjective: `Perform bounded ${phase}.`,
    capabilityGrant,
    goal: {
      objective: 'Inspect and plan one bounded fixture change.',
      successCriteria: [
        {
          id: 'criterion_m251-adapter',
          description: 'The bounded fixture behavior is understood.',
          required: true,
        },
      ],
      scope: { projectPath, allowedPaths: ['src/payment.js'] },
      nonGoals: ['Do not release or deploy.'],
    },
    selectedEntries: [],
    executionProfileId: 'profile_m2-5-1-real-codex',
    executionProfileDigest: hash('1'),
    policyBundleId: 'policy_codeclosure-m2-5-1-real-intake',
    policyBundleDigest: hash('2'),
    acceptanceCriticalVerificationPlanId: 'verification-plan_m251-adapter',
    acceptanceCriticalVerificationPlanDigest: hash('a'),
    projectReadAuthorityId: authority?.id ?? `project-read_m251-${phase.toLowerCase()}`,
    projectReadAuthorityRecordDigest: authority?.recordDigest ?? hash('3'),
    projectReadSourceTreeProjectionDigest: authority?.sourceTreeDigest ?? hash('4'),
    projectReadGitStateProjectionDigest: authority?.gitStateDigest ?? hash('5'),
    responseContract,
  };
  return decodeWorkerRequest({
    schemaVersion: 2,
    workerSessionId: `worker_m251-${phase.toLowerCase()}`,
    attemptId: contextPackage.attemptId,
    contextManifestId: `context_m251-${phase.toLowerCase()}`,
    contextManifestDigest: hash('6'),
    packageDigest: hash('7'),
    executionProfileId: contextPackage.executionProfileId,
    executionProfileDigest: contextPackage.executionProfileDigest,
    contextPackage,
  });
}

function implementRequest(projectPath: string): WorkerRequest {
  const contextPackage = {
    schemaVersion: 2,
    goalId: 'goal_m251-adapter-implement',
    goalRevision: 1,
    workflowId: 'workflow_m251-adapter-implement',
    workflowVersion: 4,
    phase: WorkflowPhase.IMPLEMENT,
    attemptId: 'attempt_m251-implement',
    candidateGenerationId: 'generation_m251-implement',
    candidateDigest: hash('a'),
    phaseObjective: 'Implement one bounded fixture change.',
    capabilityGrant: deriveCapabilityGrant(WorkflowPhase.IMPLEMENT),
    goal: {
      objective: 'Implement one bounded fixture change.',
      successCriteria: [
        {
          id: 'criterion_m251-adapter-implement',
          description: 'The bounded fixture change is present.',
          required: true,
        },
      ],
      scope: { projectPath, allowedPaths: ['src'] },
      nonGoals: ['Do not release or deploy.'],
    },
    selectedEntries: [],
    executionProfileId: 'profile_m2-5-1-real-codex',
    executionProfileDigest: hash('b'),
    policyBundleId: 'policy_codeclosure-m2-5-1-real-intake',
    policyBundleDigest: hash('c'),
    responseContract: m1WorkerResponseContract(WorkflowPhase.IMPLEMENT),
  };
  return decodeWorkerRequest({
    schemaVersion: 2,
    workerSessionId: 'worker_m251-implement',
    attemptId: contextPackage.attemptId,
    contextManifestId: 'context_m251-implement',
    contextManifestDigest: hash('d'),
    packageDigest: hash('e'),
    executionProfileId: contextPackage.executionProfileId,
    executionProfileDigest: contextPackage.executionProfileDigest,
    contextPackage,
  });
}

function requestBinding(value: WorkerRequest): CodexWorkerRequestBindingV3 {
  const context = value.contextPackage;
  if (context.phase !== 'DISCOVERY' && context.phase !== 'PLAN') {
    throw new TypeError('candidate-free fixture requires DISCOVERY or PLAN');
  }
  return Object.freeze({
    attemptId: value.attemptId,
    contextManifestDigest: value.contextManifestDigest,
    contextManifestId: value.contextManifestId,
    executionProfileDigest: value.executionProfileDigest,
    executionProfileId: value.executionProfileId,
    goalId: context.goalId,
    goalRevision: context.goalRevision,
    packageDigest: value.packageDigest,
    phase: context.phase,
    policyBundleDigest: context.policyBundleDigest,
    policyBundleId: context.policyBundleId,
    workerSessionId: value.workerSessionId,
    workflowId: context.workflowId,
    workflowVersion: context.workflowVersion,
  });
}

function sharedProfile(): CodexWorkerSharedProfileDirectiveV1 {
  return Object.freeze({
    codexVersion: 'codex-cli 0.146.1',
    controlledStateRootIdentity: '/authority/codex-state',
    delegatedExecutableDigest: hash('8'),
    environmentNames: Object.freeze(['CODEX_HOME', 'HOME', 'TMPDIR']),
    launcherDigest: hash('9'),
    managedRequirementsDigest: hash('a'),
    maximumPromptBytes: 1_048_576,
    model: 'gpt-fixture',
    modelProvider: 'openai',
    nonSecretEnvironmentDigest: hash('b'),
    protocolSnapshotDigest: hash('c'),
    reasoningEffort: 'low',
    retentionPolicy: 'CONTROLLED',
    serviceTier: null,
    secretEnvironmentNames: Object.freeze([]),
    terminalTimeoutMilliseconds: 300_000,
    thread: Object.freeze({ kind: 'FRESH' }),
  });
}

function phaseProfile(value: WorkerRequest, snapshot: string): CodexWorkerPhaseDirectiveV1 {
  const instructionSources = Object.freeze([]);
  return phaseWithIsolation(
    Object.freeze({
      phase: value.contextPackage.phase as 'DISCOVERY' | 'PLAN',
      workerAdapter: CODEX_M251_WORKER_ADAPTER_ID,
      workerAdapterVersion: CODEX_M251_WORKER_ADAPTER_VERSION,
      cwdKind: 'PROJECT_READ_SNAPSHOT',
      sourceAuthorityKind: 'PROJECT_READ',
      permissionProfileId: `permission-${value.contextPackage.phase.toLowerCase()}-v1`,
      permissionProfileDigest: hash('d'),
      projectConfigurationPolicy: 'DISABLED',
      configurationProfileDigest: hash('f'),
      executionConfigDigest: hash('0'),
      disabledIntegrationsDigest: CODEX_M251_WORKER_DISABLED_INTEGRATIONS_DIGEST,
      instructionSourceManifestId: `instructions-${value.contextPackage.phase.toLowerCase()}-v1`,
      instructionSourceManifestDigest: digestCanonical({ instructionSources }),
      instructionSources,
      capabilityGrantDigest: digestCanonical({
        schemaVersion: 1,
        capabilityGrant: value.contextPackage.capabilityGrant,
      }),
      responseContractDigest: digestCanonical({
        schemaVersion: 1,
        responseContract: value.contextPackage.responseContract,
      }),
      responseSchemaPolicy: 'PROPOSALS_V1',
      workerActivityPolicyId: CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
      workerActivityPolicyDigest: CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
      commandNetworkPolicy: 'DENIED',
      approvalPolicy: 'NEVER',
      continuityPolicy: 'SAME_SESSION_BOUNDED_OPERATION',
      compactionPolicy: 'FAIL_ON_OBSERVATION',
      fallbackPolicy: 'FAIL_CLOSED',
      allowedRoots: Object.freeze([dirname(snapshot)]),
      forbiddenRoots: Object.freeze(
        ['/authority/codex-state', '/credentials', '/source/project'].toSorted(),
      ),
    }),
  );
}

function projectReadAuthority(
  value: WorkerRequest,
  phase: CodexWorkerPhaseDirectiveV1,
  workspaceRoot: string,
  snapshot: string,
  source: string,
  additionalForbiddenRoots: readonly string[] = Object.freeze([]),
): ProjectSourceReadAuthorityRecord {
  const context = value.contextPackage;
  if (context.phase !== 'DISCOVERY' && context.phase !== 'PLAN') {
    throw new TypeError('project-read fixture requires a candidate-free request');
  }
  if (context.projectReadAuthorityId === undefined) {
    throw new TypeError('project-read fixture requires an authority ID');
  }
  const sourceTreeWithoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    profile: PROJECT_READ_SOURCE_TREE_PROFILE,
    entries: Object.freeze([]),
    fileCount: 0,
    totalBytes: 0,
  });
  const sourceTree = decodeProjectReadSourceTreeProjection({
    ...sourceTreeWithoutDigest,
    projectionDigest: digestCanonical(projectReadSourceTreeProjection(sourceTreeWithoutDigest)),
  });
  const repositoryControlRootIdentity = join(source, '.git');
  const gitStateWithoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    profile: PROJECT_READ_GIT_STATE_PROFILE,
    sourceProjectRoot: source,
    repositoryControlRootIdentity,
    headCommit: '1ad4bbb383d8ef38e29400b2625810ffa9dfb953',
    selectedPathSetDigest: sha256Digest(digestCanonical(projectReadSelectedPathSetProjection([]))),
    stagedIndexManifestDigest: sha256Digest(hash('8')),
    porcelainV2Digest: sha256Digest(hash('9')),
  });
  const gitState = decodeProjectReadGitStateProjection({
    ...gitStateWithoutDigest,
    projectionDigest: sha256Digest(
      digestCanonical(projectReadGitStateProjection(gitStateWithoutDigest)),
    ),
  });
  const authorityWithoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    id: projectSourceReadAuthorityId(context.projectReadAuthorityId),
    goalId: context.goalId,
    goalRevision: context.goalRevision,
    workflowId: context.workflowId,
    workflowVersion: context.workflowVersion,
    phase: context.phase,
    attemptId: context.attemptId,
    normalizedProjectRoot: source,
    resolvedProjectRoot: source,
    repositoryControlRootIdentity,
    sourceTree,
    gitState,
    workspaceRootIdentity: workspaceRoot,
    snapshotId: projectReadSnapshotId(`project-read-snapshot_m251-${context.phase.toLowerCase()}`),
    snapshotLeafRealpath: snapshot,
    snapshotTreeDigest: sourceTree.projectionDigest,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    ownershipMarkerDigest: sha256Digest(hash('a')),
    policyBundleId: policyBundleId(context.policyBundleId),
    policyBundleVersion: 'codeclosure-m2-5-1-real-intake-policy-v1',
    policyBundleDigest: sha256Digest(context.policyBundleDigest),
    executionProfileId: executionProfileId(value.executionProfileId),
    executionProfileVersion: 'codeclosure-m2-5-1-real-codex-profile-v1',
    executionProfileDigest: sha256Digest(value.executionProfileDigest),
    phaseDispatchEntryDigest: sha256Digest(digestCanonical(phase)),
    capabilityGrantDigest: sha256Digest(phase.capabilityGrantDigest),
    responseContractDigest: sha256Digest(phase.responseContractDigest),
    accessMode: ProjectReadSnapshotAccessMode.READ_ONLY,
    sourceCheckoutAccess: ProjectReadSourceCheckoutAccess.NONE,
    modelUsableNetworkPolicy: ProjectReadModelUsableNetworkPolicy.DENIED,
    forbiddenRoots: Object.freeze(
      [...phase.forbiddenRoots, ...additionalForbiddenRoots, source]
        .filter((root, index, roots) => roots.indexOf(root) === index)
        .toSorted(),
    ),
    isolationProfileId: phase.isolationProfileId,
    isolationProfileDigest: sha256Digest(phase.isolationProfileDigest),
    issuedAt: isoTimestamp(fixedObservedAt),
    lifecyclePolicy: ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT,
    retentionPolicy: ProjectReadRetentionPolicy.RUNTIME_OWNED,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
  });
  return decodeProjectSourceReadAuthorityRecord({
    ...authorityWithoutDigest,
    recordDigest: sha256Digest(
      digestCanonical(projectSourceReadAuthorityProjection(authorityWithoutDigest)),
    ),
  });
}

function directive(phase: 'DISCOVERY' | 'PLAN' = 'DISCOVERY'): Readonly<{
  directive: CodexWorkerDirectiveV3;
  request: WorkerRequest;
}> {
  const provisionalRequest = request(phase);
  const snapshot = `/authority/project-read/${phase.toLowerCase()}`;
  const selectedPhase = phaseProfile(provisionalRequest, snapshot);
  const authorityRecord = projectReadAuthority(
    provisionalRequest,
    selectedPhase,
    dirname(snapshot),
    snapshot,
    '/source/project',
    ['/authority/project-read-forbidden'],
  );
  const selectedRequest = request(phase, '/source/project', {
    id: authorityRecord.id,
    recordDigest: authorityRecord.recordDigest,
    sourceTreeDigest: authorityRecord.sourceTree.projectionDigest,
    gitStateDigest: authorityRecord.gitState.projectionDigest,
  });
  const withoutDigest = Object.freeze({
    externalExecutionIntentDigest: hash('2'),
    phaseDispatchEntryDigest: digestCanonical(selectedPhase),
    processLaunchNonce: hash('3'),
    profile: Object.freeze({ phase: selectedPhase, shared: sharedProfile() }),
    request: requestBinding(selectedRequest),
    schemaVersion: 3 as const,
    sourceAuthority: Object.freeze({
      kind: 'PROJECT_READ' as const,
      authorityRecord,
    }),
  });
  return Object.freeze({
    directive: createCodexWorkerDirectiveV3(withoutDigest),
    request: selectedRequest,
  });
}

function candidateDirective(
  t: TestContext,
  scenario = 'happy',
): Readonly<{
  directive: CodexWorkerDirectiveV3;
  launch: ReturnType<typeof createFixtureAppServerLaunch>;
  request: WorkerRequest;
}> {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-m251-candidate-directive-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const workspaceRoot = join(root, 'workspaces');
  const candidate = join(workspaceRoot, 'candidate');
  const source = join(root, 'source');
  const codexState = join(root, 'codex-state');
  const processHome = join(root, 'process-home');
  const temporaryDirectory = join(root, 'process-tmp');
  for (const path of [
    workspaceRoot,
    candidate,
    source,
    codexState,
    processHome,
    temporaryDirectory,
  ]) {
    mkdirSync(path);
  }
  mkdirSync(join(candidate, 'src'));
  const launch = createFixtureAppServerLaunch({
    codexHome: codexState,
    cwd: candidate,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome,
    scenario: `m251:${scenario}`,
    scriptPath: fixtureScript,
    temporaryDirectory,
  });
  const selectedRequest = implementRequest(realpathSync(source));
  const context = selectedRequest.contextPackage;
  if (context.candidateGenerationId === undefined || context.candidateDigest === undefined) {
    throw new TypeError('IMPLEMENT fixture requires Candidate authority');
  }
  const allowedPaths = Object.freeze(['src']);
  const forbiddenRoots = Object.freeze(
    [codexState, processHome, source, temporaryDirectory]
      .map((path) => realpathSync(path))
      .toSorted(),
  );
  const leaseWithoutDigest: Omit<CandidateWorkspaceLease, 'leaseDigest'> = Object.freeze({
    accessMode: 'MUTABLE',
    allowedPathPolicyDigest: digestCanonical({
      allowedPaths,
      reservedPathPolicy: 'M2_CONTROLLED_COPY_V1',
    }),
    allowedPaths,
    candidateId: 'candidate_m251-implement',
    candidateDigest: context.candidateDigest,
    candidateGenerationId: context.candidateGenerationId,
    candidateGenerationVersion: 1,
    forbiddenRoots,
    generationSequence: 1,
    goalId: context.goalId,
    goalRevision: context.goalRevision,
    id: 'candidate-workspace-lease_m251-implement',
    issuedAt: fixedObservedAt,
    lifecyclePolicy: 'REVOKE_ON_FREEZE',
    parentGenerationId: null,
    reservedPathPolicy: 'M2_CONTROLLED_COPY_V1',
    retentionPolicy: 'RUNTIME_OWNED',
    root: realpathSync(candidate),
    schemaVersion: 1,
    sourceGitMetadataDigest: hash('f'),
    sourceProjectRoot: realpathSync(source),
    sourceTreeDigest: hash('0'),
    state: 'ACTIVE',
    version: 1,
    workspaceRootIdentity: realpathSync(workspaceRoot),
    workflowId: context.workflowId,
    workflowVersion: context.workflowVersion,
  });
  const lease = decodeCodexCandidateWorkspaceLease({
    ...leaseWithoutDigest,
    leaseDigest: digestCanonical(candidateWorkspaceLeaseProjection(leaseWithoutDigest)),
  });
  const instructionSources = Object.freeze([]);
  const selectedPhase = phaseWithIsolation(
    Object.freeze({
      phase: 'IMPLEMENT',
      workerAdapter: CODEX_M251_WORKER_ADAPTER_ID,
      workerAdapterVersion: CODEX_M251_WORKER_ADAPTER_VERSION,
      cwdKind: 'CANDIDATE_WORKSPACE',
      sourceAuthorityKind: 'CANDIDATE',
      permissionProfileId: 'codeclosure-m2',
      permissionProfileDigest: digestCanonical(permissionProfile),
      projectConfigurationPolicy: 'DISABLED',
      configurationProfileDigest: hash('3'),
      executionConfigDigest: digestCanonical(effectiveConfig),
      disabledIntegrationsDigest: CODEX_M251_WORKER_DISABLED_INTEGRATIONS_DIGEST,
      instructionSourceManifestId: 'instructions-implement-v1',
      instructionSourceManifestDigest: digestCanonical({ instructionSources }),
      instructionSources,
      capabilityGrantDigest: digestCanonical({
        schemaVersion: 1,
        capabilityGrant: context.capabilityGrant,
      }),
      responseContractDigest: digestCanonical({
        schemaVersion: 1,
        responseContract: context.responseContract,
      }),
      responseSchemaPolicy: 'COMPLETION_REQUEST_V1',
      workerActivityPolicyId: CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
      workerActivityPolicyDigest: CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
      commandNetworkPolicy: 'DENIED',
      approvalPolicy: 'NEVER',
      continuityPolicy: 'SAME_SESSION_BOUNDED_OPERATION',
      compactionPolicy: 'FAIL_ON_OBSERVATION',
      fallbackPolicy: 'FAIL_CLOSED',
      allowedRoots: Object.freeze([lease.workspaceRootIdentity]),
      forbiddenRoots,
    }),
  );
  const requestBinding: CodexWorkerRequestBindingV3 = Object.freeze({
    attemptId: selectedRequest.attemptId,
    candidateDigest: context.candidateDigest,
    candidateGenerationId: context.candidateGenerationId,
    contextManifestDigest: selectedRequest.contextManifestDigest,
    contextManifestId: selectedRequest.contextManifestId,
    executionProfileDigest: selectedRequest.executionProfileDigest,
    executionProfileId: selectedRequest.executionProfileId,
    goalId: context.goalId,
    goalRevision: context.goalRevision,
    packageDigest: selectedRequest.packageDigest,
    phase: 'IMPLEMENT',
    policyBundleDigest: context.policyBundleDigest,
    policyBundleId: context.policyBundleId,
    workerSessionId: selectedRequest.workerSessionId,
    workflowId: context.workflowId,
    workflowVersion: context.workflowVersion,
  });
  const directive = createCodexWorkerDirectiveV3({
    externalExecutionIntentDigest: hash('6'),
    phaseDispatchEntryDigest: digestCanonical(selectedPhase),
    processLaunchNonce: hash('7'),
    profile: Object.freeze({
      phase: selectedPhase,
      shared: Object.freeze({
        codexVersion: launch.summary.codexVersion,
        controlledStateRootIdentity: launch.summary.codexHome,
        delegatedExecutableDigest: launch.summary.delegatedExecutableDigest,
        environmentNames: launch.summary.environmentNames,
        launcherDigest: launch.summary.launcherDigest,
        managedRequirementsDigest: digestCanonical(managedRequirements),
        maximumPromptBytes: 256 * 1024,
        model: 'gpt-fixture',
        modelProvider: 'openai',
        nonSecretEnvironmentDigest: digestCanonical(launch.summary.nonSecretEnvironment),
        protocolSnapshotDigest: launch.summary.protocolSnapshotDigest,
        reasoningEffort: 'low',
        retentionPolicy: 'CONTROLLED' as const,
        serviceTier: 'default',
        secretEnvironmentNames: launch.summary.secretEnvironmentNames,
        terminalTimeoutMilliseconds: 150,
        thread: Object.freeze({ kind: 'FRESH' as const }),
      }),
    }),
    request: requestBinding,
    schemaVersion: 3,
    sourceAuthority: Object.freeze({ kind: 'CANDIDATE', workspaceLease: lease }),
  });
  return Object.freeze({ directive, launch, request: selectedRequest });
}

function commandItem(cwd: string, path: string, actionType = 'read'): JsonObject {
  return {
    aggregatedOutput: 'fixture',
    command: 'sed -n 1,20p src/payment.js',
    commandActions: [
      actionType === 'read'
        ? { command: 'sed', name: 'src/payment.js', path, type: 'read' }
        : { command: 'fixture', type: actionType },
    ],
    cwd,
    durationMs: 1,
    exitCode: 0,
    id: 'command-fixture',
    pluginId: null,
    processId: null,
    scriptPath: null,
    source: 'agent',
    status: 'completed',
    type: 'commandExecution',
  };
}

const managedRequirements = Object.freeze({
  requirements: Object.freeze({ managed: true, profile: 'fixture' }),
});
const disabledFeatureConfiguration = Object.freeze(CODEX_M251_WORKER_EFFECTIVE_FEATURES);
const effectiveConfig = Object.freeze({
  config: Object.freeze({
    approval_policy: 'never',
    default_permissions: 'codeclosure-m2',
    features: disabledFeatureConfiguration,
    include_apps_instructions: false,
    include_collaboration_mode_instructions: false,
    mcp_servers: Object.freeze({}),
    model: 'gpt-fixture',
    model_provider: 'openai',
    model_reasoning_effort: 'low',
    compact_prompt: null,
    developer_instructions: null,
    instructions: null,
    orchestrator: Object.freeze({
      mcp: Object.freeze({ enabled: false }),
      skills: Object.freeze({ enabled: false }),
    }),
    skills: Object.freeze({
      bundled: Object.freeze({ enabled: false }),
      include_instructions: false,
    }),
    tools: null,
    web_search: 'disabled',
  }),
  layers: Object.freeze([]),
});
const unsafeEffectiveConfig = Object.freeze({
  ...effectiveConfig,
  config: Object.freeze({
    ...effectiveConfig.config,
    features: Object.freeze({
      ...effectiveConfig.config.features,
      remote_control: true,
    }),
  }),
});

void test('[M251-B4] shared v3 config validator rejects a poisoned prepublication projection', () => {
  const expectation = Object.freeze({
    executionConfigDigest: digestCanonical(effectiveConfig),
    model: 'gpt-fixture',
    modelProvider: 'openai',
    permissionProfileId: 'codeclosure-m2',
    reasoningEffort: 'low',
  });
  assert.doesNotThrow(() => assertM251EffectiveConfiguration(effectiveConfig, expectation));
  assert.throws(
    () =>
      assertM251EffectiveConfiguration(unsafeEffectiveConfig, {
        ...expectation,
        executionConfigDigest: digestCanonical(unsafeEffectiveConfig),
      }),
    /outside the closed profile/,
  );
});
const permissionProfile = Object.freeze({
  allowed: true,
  id: 'codeclosure-m2',
  name: 'CodeClosure M2',
});

function integrationHarness(
  t: TestContext,
  scenario: string,
  boundEffectiveConfig: typeof effectiveConfig | typeof unsafeEffectiveConfig = effectiveConfig,
): Readonly<{
  adapter: CodexWorkerAdapter;
  directive: CodexWorkerDirectiveV3;
  request: WorkerRequest;
}> {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-m251-candidate-free-adapter-'));
  t.after(() => rmSync(root, { force: true, recursive: true }));
  const snapshot = join(root, 'project-read', 'snapshot');
  const codexHome = join(root, 'codex-home');
  const processHome = join(root, 'process-home');
  const temporaryDirectory = join(root, 'process-tmp');
  const source = join(root, 'source');
  const credentials = join(root, 'credentials');
  for (const path of [
    dirname(snapshot),
    snapshot,
    codexHome,
    processHome,
    temporaryDirectory,
    source,
    credentials,
  ]) {
    mkdirSync(path);
  }
  chmodSync(snapshot, 0o555);
  const launch = createFixtureAppServerLaunch({
    codexHome,
    cwd: snapshot,
    executableSearchPath: `${dirname(process.execPath)}:/usr/bin:/bin`,
    processHome,
    scenario: `m251:${scenario}`,
    scriptPath: fixtureScript,
    temporaryDirectory,
  });
  const provisionalRequest = request('DISCOVERY', realpathSync(source));
  const instructionSources = Object.freeze([]);
  const selectedPhase = phaseWithIsolation(
    Object.freeze({
      phase: 'DISCOVERY',
      workerAdapter: CODEX_M251_WORKER_ADAPTER_ID,
      workerAdapterVersion: CODEX_M251_WORKER_ADAPTER_VERSION,
      cwdKind: 'PROJECT_READ_SNAPSHOT',
      sourceAuthorityKind: 'PROJECT_READ',
      permissionProfileId: 'codeclosure-m2',
      permissionProfileDigest: digestCanonical(permissionProfile),
      projectConfigurationPolicy: 'DISABLED',
      configurationProfileDigest: hash('e'),
      executionConfigDigest: digestCanonical(boundEffectiveConfig),
      disabledIntegrationsDigest: CODEX_M251_WORKER_DISABLED_INTEGRATIONS_DIGEST,
      instructionSourceManifestId: 'instructions-discovery-v1',
      instructionSourceManifestDigest: digestCanonical({ instructionSources }),
      instructionSources,
      capabilityGrantDigest: digestCanonical({
        schemaVersion: 1,
        capabilityGrant: provisionalRequest.contextPackage.capabilityGrant,
      }),
      responseContractDigest: digestCanonical({
        schemaVersion: 1,
        responseContract: provisionalRequest.contextPackage.responseContract,
      }),
      responseSchemaPolicy: 'PROPOSALS_V1',
      workerActivityPolicyId: CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
      workerActivityPolicyDigest: CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
      commandNetworkPolicy: 'DENIED',
      approvalPolicy: 'NEVER',
      continuityPolicy: 'SAME_SESSION_BOUNDED_OPERATION',
      compactionPolicy: 'FAIL_ON_OBSERVATION',
      fallbackPolicy: 'FAIL_CLOSED',
      allowedRoots: Object.freeze([realpathSync(dirname(snapshot))]),
      forbiddenRoots: Object.freeze(
        [codexHome, credentials, processHome, source, temporaryDirectory]
          .map((path) => realpathSync(path))
          .toSorted(),
      ),
    }),
  );
  const shared: CodexWorkerSharedProfileDirectiveV1 = Object.freeze({
    codexVersion: launch.summary.codexVersion,
    controlledStateRootIdentity: launch.summary.codexHome,
    delegatedExecutableDigest: launch.summary.delegatedExecutableDigest,
    environmentNames: launch.summary.environmentNames,
    launcherDigest: launch.summary.launcherDigest,
    managedRequirementsDigest: digestCanonical(managedRequirements),
    maximumPromptBytes: 256 * 1024,
    model: 'gpt-fixture',
    modelProvider: 'openai',
    nonSecretEnvironmentDigest: digestCanonical(launch.summary.nonSecretEnvironment),
    protocolSnapshotDigest: launch.summary.protocolSnapshotDigest,
    reasoningEffort: 'low',
    retentionPolicy: 'CONTROLLED',
    serviceTier: 'default',
    secretEnvironmentNames: launch.summary.secretEnvironmentNames,
    terminalTimeoutMilliseconds: 150,
    thread: Object.freeze({ kind: 'FRESH' }),
  });
  const authorityRecord = projectReadAuthority(
    provisionalRequest,
    selectedPhase,
    realpathSync(dirname(snapshot)),
    realpathSync(snapshot),
    realpathSync(source),
    [realpathSync(credentials)],
  );
  const selectedRequest = request('DISCOVERY', realpathSync(source), {
    id: authorityRecord.id,
    recordDigest: authorityRecord.recordDigest,
    sourceTreeDigest: authorityRecord.sourceTree.projectionDigest,
    gitStateDigest: authorityRecord.gitState.projectionDigest,
  });
  const selectedDirective = createCodexWorkerDirectiveV3({
    externalExecutionIntentDigest: hash('8'),
    phaseDispatchEntryDigest: digestCanonical(selectedPhase),
    processLaunchNonce: hash('9'),
    profile: Object.freeze({ phase: selectedPhase, shared }),
    request: requestBinding(selectedRequest),
    schemaVersion: 3,
    sourceAuthority: Object.freeze({
      kind: 'PROJECT_READ',
      authorityRecord,
    }),
  });
  return Object.freeze({
    adapter: new CodexWorkerAdapter({
      clientLimits: fixtureClientLimits,
      directive: selectedDirective,
      launch,
      onLifecycleEvent: () => undefined,
      observedAt: () => fixedObservedAt,
    }),
    directive: selectedDirective,
    request: selectedRequest,
  });
}

async function collect(
  adapter: CodexWorkerAdapter,
  selectedRequest: WorkerRequest,
): Promise<readonly WorkerEvent[]> {
  const events: WorkerEvent[] = [];
  for await (const value of adapter.run(selectedRequest, new AbortController().signal)) {
    events.push(decodeWorkerEvent(value));
  }
  return Object.freeze(events);
}

void test('[I-006][I-023][M251-C10] v3 directive binds one exact candidate-free phase and policy', () => {
  const fixture = directive();
  const decoded = decodeCodexWorkerDirectiveV3(fixture.directive);
  assert.deepEqual(decoded, fixture.directive);
  assert.equal(decoded.directiveDigest, digestCanonical(codexWorkerDirectiveV3Projection(decoded)));
  assert.deepEqual(assertDirectiveV3BindsWorkerRequest(decoded, fixture.request), fixture.request);
  assert.equal(decoded.sourceAuthority.kind, 'PROJECT_READ');
  assert.notEqual(
    decoded.profile.phase.allowedRoots[0],
    decoded.sourceAuthority.authorityRecord.snapshotLeafRealpath,
  );
  assert.equal(
    decoded.sourceAuthority.authorityRecord.snapshotLeafRealpath.startsWith(
      `${decoded.profile.phase.allowedRoots[0] ?? ''}/`,
    ),
    true,
  );
  assert.equal(
    decoded.profile.phase.workerActivityPolicyDigest,
    CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
  );
  const receipt = codexWorkerSourceAuthorityReceiptV1(decoded.sourceAuthority);
  assert.deepEqual(receipt, {
    kind: 'PROJECT_READ',
    projectReadAuthorityId: decoded.sourceAuthority.authorityRecord.id,
    projectReadAuthorityRecordDigest: decoded.sourceAuthority.authorityRecord.recordDigest,
    snapshotCwdIdentity: decoded.sourceAuthority.authorityRecord.snapshotLeafRealpath,
  });
  assert.equal(Reflect.has(receipt, 'authorityRecord'), false);
  const policy = codexWorkerActivityPolicyV1(decoded);
  assert.equal(policy.forbiddenRoots.includes('/authority/project-read-forbidden'), true);
});

void test('[I-027][M251-V06] v3 directive rejects cross-version and substituted authority', () => {
  const fixture = directive();
  assert.throws(
    () =>
      decodeCodexWorkerDirectiveV3({
        ...fixture.directive,
        workspaceLease: {},
      }),
    /unknown or missing fields/u,
  );
  assert.throws(
    () =>
      createCodexWorkerDirectiveV3({
        ...fixture.directive,
        profile: {
          ...fixture.directive.profile,
          phase: {
            ...fixture.directive.profile.phase,
            workerActivityPolicyDigest: hash('f'),
          },
        },
      }),
    /unsupported Adapter or activity policy/u,
  );
  assert.throws(
    () =>
      createCodexWorkerDirectiveV3({
        ...fixture.directive,
        profile: {
          ...fixture.directive.profile,
          phase: {
            ...fixture.directive.profile.phase,
            isolationProfileDigest: hash('f'),
          },
        },
      }),
    /unsupported isolation profile/u,
  );
  assert.throws(
    () =>
      createCodexWorkerDirectiveV3({
        ...fixture.directive,
        profile: {
          ...fixture.directive.profile,
          phase: {
            ...fixture.directive.profile.phase,
            disabledIntegrationsDigest: hash('f'),
          },
        },
      }),
    /unsupported disabled integrations/u,
  );
  const sourceAuthority = fixture.directive.sourceAuthority;
  if (sourceAuthority.kind !== 'PROJECT_READ') {
    throw new TypeError('candidate-free fixture did not select project-read authority');
  }
  const authorityRecord: ProjectSourceReadAuthorityRecord = sourceAuthority.authorityRecord;
  assert.throws(
    () =>
      createCodexWorkerDirectiveV3({
        ...fixture.directive,
        sourceAuthority: {
          kind: 'PROJECT_READ',
          authorityRecord: {
            ...authorityRecord,
            id: projectSourceReadAuthorityId('project-read_m251-digest-substituted'),
          },
        },
      }),
    /record digest is inconsistent/u,
  );
  const omittedPhaseRoot = fixture.directive.profile.phase.forbiddenRoots.find(
    (root) =>
      root !== authorityRecord.normalizedProjectRoot &&
      root !== authorityRecord.resolvedProjectRoot,
  );
  assert.ok(omittedPhaseRoot !== undefined);
  const incompleteAuthorityWithoutDigest = Object.freeze({
    ...authorityRecord,
    forbiddenRoots: Object.freeze(
      authorityRecord.forbiddenRoots.filter((root) => root !== omittedPhaseRoot),
    ),
  });
  assert.throws(
    () =>
      createCodexWorkerDirectiveV3({
        ...fixture.directive,
        sourceAuthority: {
          kind: 'PROJECT_READ',
          authorityRecord: {
            ...incompleteAuthorityWithoutDigest,
            recordDigest: sha256Digest(
              digestCanonical(
                projectSourceReadAuthorityProjection(incompleteAuthorityWithoutDigest),
              ),
            ),
          },
        },
      }),
    /does not bind the v3 request/u,
  );
  const authorityWithoutDigest = Object.freeze({
    ...authorityRecord,
    id: projectSourceReadAuthorityId('project-read_m251-substituted'),
  });
  const substitutedProjectRead = createCodexWorkerDirectiveV3({
    ...fixture.directive,
    sourceAuthority: {
      kind: 'PROJECT_READ',
      authorityRecord: {
        ...authorityWithoutDigest,
        recordDigest: sha256Digest(
          digestCanonical(projectSourceReadAuthorityProjection(authorityWithoutDigest)),
        ),
      },
    },
  });
  assert.throws(
    () => assertDirectiveV3BindsWorkerRequest(substitutedProjectRead, fixture.request),
    /does not bind the Context Package/u,
  );
});

void test('[I-006][I-023][M251-C10] v3 IMPLEMENT directive binds only one exact Candidate lease', (t) => {
  const fixture = candidateDirective(t);
  const decoded = decodeCodexWorkerDirectiveV3(fixture.directive);
  assert.deepEqual(decoded, fixture.directive);
  assert.deepEqual(assertDirectiveV3BindsWorkerRequest(decoded, fixture.request), fixture.request);
  assert.equal(decoded.sourceAuthority.kind, 'CANDIDATE');
  const binding = codexFinalPayloadBindingV3(decoded) as Record<string, unknown>;
  assert.equal(binding['sourceAuthorityKind'], 'CANDIDATE');
  assert.equal(binding['candidateWorkspaceLeaseId'], decoded.sourceAuthority.workspaceLease.id);
  assert.equal(
    binding['candidateWorkspaceLeaseDigest'],
    decoded.sourceAuthority.workspaceLease.leaseDigest,
  );
  assert.equal(Reflect.has(binding, 'sourceAuthority'), false);
  assert.equal(Reflect.has(binding, 'projectReadAuthorityId'), false);
  const activityPolicy = codexWorkerActivityPolicyV1(decoded);
  assert.equal(
    decoded.sourceAuthority.workspaceLease.forbiddenRoots.every((root) =>
      activityPolicy.forbiddenRoots.includes(root),
    ),
    true,
  );
});

void test('[I-023][I-027][M251-C10] v3 IMPLEMENT rejects a lease missing a phase forbidden root', (t) => {
  const fixture = candidateDirective(t);
  if (fixture.directive.sourceAuthority.kind !== 'CANDIDATE') {
    assert.fail('IMPLEMENT fixture did not select Candidate authority');
  }
  const lease = fixture.directive.sourceAuthority.workspaceLease;
  const omittedRoot = fixture.directive.profile.phase.forbiddenRoots[0];
  assert.ok(omittedRoot !== undefined);
  const withoutDigest = Object.freeze({
    ...lease,
    forbiddenRoots: Object.freeze(lease.forbiddenRoots.filter((root) => root !== omittedRoot)),
  });
  const substitutedLease = Object.freeze({
    ...withoutDigest,
    leaseDigest: digestCanonical(candidateWorkspaceLeaseProjection(withoutDigest)),
  });
  assert.throws(
    () =>
      createCodexWorkerDirectiveV3({
        ...fixture.directive,
        sourceAuthority: Object.freeze({
          kind: 'CANDIDATE',
          workspaceLease: substitutedLease,
        }),
      }),
    /does not bind the v3 request/u,
  );
});

void test('[I-023][M251-C10][M251-X10] configuration-instruction-containment preserves only bounded command execution', () => {
  assert.equal(CODEX_M251_WORKER_DISABLED_FEATURES.includes('shell_tool'), false);
  assert.equal(CODEX_M251_WORKER_DISABLED_FEATURES.includes('unified_exec'), false);
  assert.equal(CODEX_M251_WORKER_DISABLED_FEATURES.includes('search_tool'), false);
  assert.equal(CODEX_M251_WORKER_DISABLED_FEATURES.includes('web_search_cached'), false);
  assert.equal(CODEX_M251_WORKER_DISABLED_FEATURES.includes('web_search_request'), false);
  assert.equal(CODEX_M251_WORKER_DISABLED_FEATURES.includes('plugins'), true);
  assert.equal(CODEX_M251_WORKER_DISABLED_FEATURES.includes('network_proxy'), true);
  assert.equal(CODEX_M251_WORKER_DISABLED_FEATURES.includes('remote_control'), false);
  assert.equal(CODEX_M251_WORKER_EFFECTIVE_FEATURES.remote_control, false);
  assert.equal(
    Object.keys(CODEX_M251_WORKER_EFFECTIVE_FEATURES).length,
    CODEX_M251_WORKER_DISABLED_FEATURES.length + 1,
  );
});

void test('[I-023][M251-C10][M251-C11] activity-policy digest binds the Slice 0 unknown-action prerequisite', () => {
  const contract = JSON.parse(readFileSync(slice0ContractPath, 'utf8')) as {
    readonly execution: {
      readonly candidateFreezeChangeContainment: {
        readonly activation: string;
        readonly changeSetProfile: string;
        readonly evidenceObservationSchemaVersion: number;
        readonly observationSchemaVersion: number;
        readonly requestSchemaVersion: number;
      };
      readonly workerActivityDispositions: unknown;
    };
  };
  assert.deepEqual(
    CODEX_M251_WORKER_ACTIVITY_DISPOSITIONS,
    contract.execution.workerActivityDispositions,
  );
  assert.deepEqual(CODEX_M251_WORKER_ACTIVITY_POLICY_PROJECTION, {
    schemaVersion: 1,
    id: CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
    version: CODEX_M251_WORKER_ACTIVITY_POLICY_VERSION,
    phaseDispositions: contract.execution.workerActivityDispositions,
    implementUnknownCommandActionPrerequisite: {
      activation: contract.execution.candidateFreezeChangeContainment.activation,
      changeSetProfile: contract.execution.candidateFreezeChangeContainment.changeSetProfile,
      evidenceObservationSchemaVersion:
        contract.execution.candidateFreezeChangeContainment.evidenceObservationSchemaVersion,
      observationSchemaVersion:
        contract.execution.candidateFreezeChangeContainment.observationSchemaVersion,
      requestSchemaVersion:
        contract.execution.candidateFreezeChangeContainment.requestSchemaVersion,
    },
  });
  assert.equal(
    digestCanonical(CODEX_M251_WORKER_ACTIVITY_POLICY_PROJECTION),
    CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
  );
});

void test('[I-023][M251-C10][M251-X11] worker-activity-policy-refinement admits only snapshot-read phase activity', () => {
  const selected = directive().directive;
  const policy = codexWorkerActivityPolicyV1(selected);
  assert.deepEqual(
    evaluateCodexWorkerActivityV1(commandItem(policy.cwd, 'src/payment.js'), policy),
    { disposition: 'ADMITTED' },
  );
  assert.deepEqual(
    evaluateCodexWorkerActivityV1(
      { ...commandItem(policy.cwd, 'src/payment.js'), commandActions: [] },
      policy,
    ),
    { disposition: 'REJECTED_DISCARDED', rejectionCode: 'COMMAND_ACTIONS' },
  );
  assert.deepEqual(
    evaluateCodexWorkerActivityV1(commandItem('/source/project', 'src/payment.js'), policy),
    { disposition: 'REJECTED_DISCARDED', rejectionCode: 'COMMAND_CWD' },
  );
  assert.deepEqual(
    evaluateCodexWorkerActivityV1(commandItem(policy.cwd, '/source/project/secret'), policy),
    { disposition: 'REJECTED_DISCARDED', rejectionCode: 'COMMAND_ACTIONS' },
  );
  assert.deepEqual(
    evaluateCodexWorkerActivityV1(commandItem(policy.cwd, 'src/payment.js', 'unknown'), policy),
    { disposition: 'REJECTED_DISCARDED', rejectionCode: 'COMMAND_ACTIONS' },
  );
  assert.deepEqual(
    evaluateCodexWorkerActivityV1(
      {
        changes: [
          {
            diff: 'fixture',
            kind: { move_path: null, type: 'update' },
            path: 'src/payment.js',
          },
        ],
        id: 'change-fixture',
        status: 'completed',
        type: 'fileChange',
      },
      policy,
    ),
    { disposition: 'REJECTED_DISCARDED', rejectionCode: 'UNSELECTED_ITEM_TYPE' },
  );
});

void test('[I-023][M251-C10][M251-X11] phase-item-effect-containment confines Candidate file changes to Goal allowed paths', () => {
  const policy = Object.freeze({
    schemaVersion: 1 as const,
    id: CODEX_M251_WORKER_ACTIVITY_POLICY_ID,
    digest: CODEX_M251_WORKER_ACTIVITY_POLICY_DIGEST,
    phase: 'IMPLEMENT' as const,
    cwd: '/authority/candidates/generation',
    forbiddenRoots: Object.freeze(['/authority/codex-state', '/source/project']),
    candidateAllowedPaths: Object.freeze(['src/payment.js']),
  });
  const change = (path: string): JsonObject => ({
    changes: [
      {
        diff: 'fixture',
        kind: { move_path: null, type: 'update' },
        path,
      },
    ],
    id: 'change-fixture',
    status: 'completed',
    type: 'fileChange',
  });
  assert.deepEqual(evaluateCodexWorkerActivityV1(change('src/payment.js'), policy), {
    disposition: 'ADMITTED',
  });
  assert.deepEqual(evaluateCodexWorkerActivityV1(change('test/payment.test.js'), policy), {
    disposition: 'REJECTED_DISCARDED',
    rejectionCode: 'ITEM_SCHEMA',
  });
  assert.deepEqual(evaluateCodexWorkerActivityV1(change('/source/project/payment.js'), policy), {
    disposition: 'REJECTED_DISCARDED',
    rejectionCode: 'ITEM_SCHEMA',
  });
  assert.deepEqual(
    evaluateCodexWorkerActivityV1(commandItem(policy.cwd, 'src/payment.js', 'unknown'), policy),
    { disposition: 'ADMITTED' },
  );
});

void test('[I-004][I-023][M251-C10] candidate-free Adapter emits only bounded proposals and a v2 receipt', async (t) => {
  const harness = integrationHarness(t, 'happy');
  const events = await collect(harness.adapter, harness.request);
  assert.equal(events.length, 1, JSON.stringify(harness.adapter.observation()));
  const event = events[0];
  assert.ok(event !== undefined);
  if (event.type !== 'WORKER_RESULT') {
    assert.fail('candidate-free fixture did not emit a Worker result');
  }
  const eventIdentityDigest = digestCanonical({
    adapterIdentityProfile: 'codex-worker-event-id-v2',
    externalExecutionIntentDigest: harness.directive.externalExecutionIntentDigest,
    request: harness.directive.request,
    sourceAuthority: codexWorkerSourceAuthorityReceiptV1(harness.directive.sourceAuthority),
  });
  assert.equal(event.id, `worker-event_codex-${eventIdentityDigest.slice('sha256:'.length)}`);
  assert.deepEqual(event.result, {
    kind: 'PROPOSALS',
    proposals: [
      {
        kind: 'PROJECT_OBSERVATION',
        sourceRefs: ['src/payment.js'],
        summary: 'Observed the bounded payment callback behavior.',
      },
    ],
  });
  const observation = harness.adapter.observation();
  assert.equal(observation.schemaVersion, 2);
  assert.equal(observation.state, 'COMPLETED');
  assert.equal(observation.activityDisposition, 'ADMITTED');
  assert.equal(observation.directiveDigest, harness.directive.directiveDigest);
  assert.equal(observation.phase, 'DISCOVERY');
  assert.equal(harness.directive.sourceAuthority.kind, 'PROJECT_READ');
  const authority = harness.directive.sourceAuthority.authorityRecord;
  assert.deepEqual(observation.sourceAuthority, {
    kind: 'PROJECT_READ',
    projectReadAuthorityId: authority.id,
    projectReadAuthorityRecordDigest: authority.recordDigest,
    snapshotCwdIdentity: authority.snapshotLeafRealpath,
  });
  assert.equal(Reflect.has(observation, 'candidateWorkspaceLeaseId'), false);
});

void test('[I-023][I-027][M251-C10] bound unsafe effective configuration still fails closed', async (t) => {
  const harness = integrationHarness(t, 'unsafe-effective-feature', unsafeEffectiveConfig);
  const events = await collect(harness.adapter, harness.request);
  assert.deepEqual(events, []);
  const observation = harness.adapter.observation();
  assert.equal(observation.state, 'FAILED');
  assert.equal(observation.failureCode, 'EFFECTIVE_INPUT_MISMATCH');
  assert.equal(observation.processLaunchCount, 1);
  assert.equal(observation.threadRequestCount, 0);
});

void test('[I-004][I-023][M251-C10] v3 IMPLEMENT Adapter binds workspaceWrite and emits only a completion request', async (t) => {
  const fixture = candidateDirective(t, 'candidate-change');
  const adapter = new CodexWorkerAdapter({
    clientLimits: fixtureClientLimits,
    directive: fixture.directive,
    launch: fixture.launch,
    onLifecycleEvent: () => undefined,
    observedAt: () => fixedObservedAt,
  });
  const events = await collect(adapter, fixture.request);
  assert.equal(events.length, 1, JSON.stringify(adapter.observation()));
  const event = events[0];
  assert.ok(event !== undefined);
  if (event.type !== 'WORKER_RESULT') {
    assert.fail('IMPLEMENT fixture did not emit a Worker result');
  }
  assert.deepEqual(event.result, {
    claimedScope: 'src',
    kind: 'COMPLETION_REQUEST',
    proposedEvidenceRefs: ['worker-observation:edited-src'],
    summary: 'Implemented the bounded Candidate change.',
  });
  const observation = adapter.observation();
  assert.equal(observation.schemaVersion, 2);
  assert.equal(observation.state, 'COMPLETED');
  assert.equal(observation.phase, 'IMPLEMENT');
  assert.equal(observation.activityDisposition, 'ADMITTED');
  assert.equal(fixture.directive.sourceAuthority.kind, 'CANDIDATE');
  assert.deepEqual(
    observation.sourceAuthority,
    codexWorkerSourceAuthorityReceiptV1(fixture.directive.sourceAuthority),
  );
});

void test('[I-023][I-027][M251-X11] v3 IMPLEMENT discards an out-of-scope Candidate file change', async (t) => {
  const fixture = candidateDirective(t, 'candidate-outside-change');
  const adapter = new CodexWorkerAdapter({
    clientLimits: fixtureClientLimits,
    directive: fixture.directive,
    launch: fixture.launch,
    onLifecycleEvent: () => undefined,
    observedAt: () => fixedObservedAt,
  });
  const events = await collect(adapter, fixture.request);
  assert.deepEqual(events, []);
  const observation = adapter.observation();
  assert.equal(observation.schemaVersion, 2);
  assert.equal(observation.state, 'FAILED');
  assert.equal(observation.failureCode, 'UNSUPPORTED_BACKEND_ACTIVITY');
  assert.equal(observation.activityDisposition, 'REJECTED_DISCARDED');
  assert.equal(observation.resultEventId, undefined);
});

void test('[I-023][I-027][M251-X11] candidate-free file-change activity discards the Worker result', async (t) => {
  const harness = integrationHarness(t, 'plan-command-diff');
  const events = await collect(harness.adapter, harness.request);
  assert.deepEqual(events, []);
  const observation = harness.adapter.observation();
  assert.equal(observation.schemaVersion, 2);
  assert.equal(observation.state, 'FAILED');
  assert.equal(observation.failureCode, 'UNSUPPORTED_BACKEND_ACTIVITY');
  assert.equal(observation.activityDisposition, 'REJECTED_DISCARDED');
  assert.equal(observation.resultEventId, undefined);
});
