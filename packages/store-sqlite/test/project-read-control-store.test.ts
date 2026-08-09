import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  AttemptFailureClass,
  AttemptStatus,
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  ExternalApprovalPolicy,
  ExternalCommandNetworkPolicy,
  ExternalCompactionPolicy,
  ExternalContinuityPolicy,
  ExternalExecutionState,
  ExternalFallbackPolicy,
  ExternalInterruptionPolicy,
  ExternalPhaseCwdKind,
  ExternalPhaseResponseSchemaPolicy,
  ExternalPhaseSourceAuthorityKind,
  ExternalProjectConfigurationPolicy,
  ExternalRetentionPolicy,
  ExternalThreadPolicy,
  ExternalWorkerDispatchPolicy,
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_GIT_STATE_PROFILE,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  PROJECT_READ_SOURCE_TREE_PROFILE,
  ProtectedAssetProtectionMode,
  ProtectedAssetReadLeasePolicy,
  ProjectReadFileMode,
  ProjectReadLifecyclePolicy,
  ProjectReadModelUsableNetworkPolicy,
  ProjectReadRetentionPolicy,
  ProjectReadSnapshotCleanupEligibilityKind,
  ProjectReadSnapshotCleanupLifecyclePolicy,
  ProjectReadSnapshotAccessMode,
  ProjectReadSourceCheckoutAccess,
  WorkflowPhase,
  acceptanceCriticalVerificationPlanId,
  applyAttemptEvent,
  auditEventId,
  commandId,
  contextManifestId,
  createGoal,
  createWorkflow,
  decideAttempt,
  deriveCapabilityGrant,
  decodeExternalExecutionIntent,
  decodeExternalExecutionRecord,
  decodeExternalExecutionObservation,
  decodeExecutionProfileBinding,
  decodeProjectReadSnapshotCleanupGrant,
  decodeProjectSourceReadAuthorityRecord,
  decodeWorkflowPolicyBinding,
  externalBackendCapabilityRecordProjection,
  externalExecutionIntentProjection,
  externalExecutionPhaseDispatchEntryProjection,
  externalExecutionObservationId,
  externalExecutionObservationProjection,
  externalExecutionRecordProjection,
  executionProfileBindingProjection,
  executionProfileId,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  projectReadGitStateProjection,
  projectReadSnapshotCleanupGrantId,
  projectReadSnapshotCleanupGrantProjection,
  projectReadSnapshotId,
  projectReadWorkspaceAuthoritySnapshotId,
  projectReadSourceTreeProjection,
  projectSourceReadAuthorityId,
  projectSourceReadAuthorityProjection,
  protectedAssetManifestProjection,
  successCriterionId,
  workerSessionId,
  workflowId,
  workflowPolicyBindingProjection,
  type ExecutionProfileDefinition,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionProfileDefinitionV1,
  type ExternalExecutionProfileDefinitionV3,
  type ExternalExecutionPhaseDispatchEntry,
  type PolicyBundleDefinition,
  type ProjectSourceReadAuthorityRecord,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  ExternalWorkerFailureCode,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  ProjectReadWorkspaceRetention,
  WorkerFailureReasonCode,
  createAcceptanceCriticalVerificationPlan,
  createExecutionProfileInstaller,
  createPolicyInstaller,
  decodeWorkerDispatchClaim,
  digestProjectReadSnapshotCleanupValue,
  goalAndWorkflowCreationPayloadProjection,
  m1WorkerResponseContract,
  workerDispatchClaimProjection,
} from '@codeclosure/runtime';
import {
  WorkerTransactionStep,
  defaultMigrationsDirectory,
  openSqliteControlStore,
} from '@codeclosure/store-sqlite';
import { DeterministicIds, testExecutionProfileDefinition } from '@codeclosure/testing';

const digests = new CanonicalJsonSha256DigestProvider();
const createdAt = isoTimestamp('2026-08-08T00:00:00.000Z');
const startedAt = isoTimestamp('2026-08-08T00:00:01.000Z');

function temporaryDatabase(t: TestContext, namespace: string): string {
  const root = mkdtempSync(join(tmpdir(), `codeclosure-project-read-store-${namespace}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'state.sqlite');
}

function migrationsThrough(t: TestContext, lastMigration: string): string {
  const source = defaultMigrationsDirectory();
  const target = mkdtempSync(join(tmpdir(), 'codeclosure-project-read-migrations-'));
  t.after(() => rmSync(target, { recursive: true, force: true }));
  for (const name of readdirSync(source)
    .filter((entry) => entry.endsWith('.sql'))
    .sort()) {
    if (name > lastMigration) {
      break;
    }
    copyFileSync(join(source, name), join(target, name));
  }
  return target;
}

function policyDefinition(namespace: string): PolicyBundleDefinition {
  return Object.freeze({
    id: policyBundleId(`policy_project-read-${namespace}`),
    schemaVersion: 1,
    version: 'project-read-policy-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['candidate-free-read-only']),
    contextRules: Object.freeze(['exact-project-read-authority']),
    checkSpecifications: Object.freeze([]),
    applicabilityRules: Object.freeze([]),
    acceptanceRules: Object.freeze(['worker-output-never-accepts']),
    checkerVersions: Object.freeze([]),
  });
}

function externalProfileAuthority(
  namespace: string,
  schemaVersion: 1 | 3,
): Readonly<{
  capability: ExternalBackendCapabilityRecord;
  profile: ExecutionProfileDefinition;
}> {
  const binaryIdentityDigest = digests.digest({ namespace, kind: 'binary' });
  const protocolSchemaDigest = digests.digest({ namespace, kind: 'protocol' });
  const configurationProfileDigest = digests.digest({ namespace, kind: 'configuration' });
  const selectedCapabilities = Object.freeze(
    [
      ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
      ExternalBackendCapability.FRESH_SESSION,
      ExternalBackendCapability.OPERATION_INTERRUPT,
      ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
    ].toSorted(),
  );
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
            proofKind: 'DETERMINISTIC_PROJECT_READ_STORE_FIXTURE',
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
  const legacyExternalExecution: ExternalExecutionProfileDefinitionV1 = Object.freeze({
    schemaVersion: 1,
    backendKind: capability.backendKind,
    capabilityRecordDigest: capability.recordDigest,
    selectedCapabilities,
    workerPhases: Object.freeze([WorkflowPhase.DISCOVERY]),
    binaryIdentityDigest,
    protocolSchemaDigest,
    configurationProfileDigest,
    executionConfigDigest: digests.digest({ namespace, kind: 'execution-config' }),
    managedRequirementsDigest: digests.digest({ namespace, kind: 'managed-requirements' }),
    instructionSourceManifestDigest: digests.digest({ namespace, kind: 'instructions' }),
    controlledStateRootIdentity: `/fixture/${namespace}/controlled-state`,
    environmentProjectionDigest: digests.digest({ namespace, kind: 'environment' }),
    permissionProfileId: 'project-read-store-external-v1',
    permissionProfileDigest: digests.digest({ namespace, kind: 'permission-profile' }),
    model: 'gpt-fixture',
    modelProvider: 'openai',
    serviceTier: null,
    reasoningEffort: 'low',
    responseSchemaPolicy: 'M2_CLOSED_WORKER_RESULT_V1',
    disabledIntegrationsDigest: digests.digest({ namespace, kind: 'disabled-integrations' }),
    defaultThreadPolicy: ExternalThreadPolicy.FRESH,
    continuityPolicy: ExternalContinuityPolicy.SAME_SESSION_BOUNDED_OPERATION,
    compactionPolicy: ExternalCompactionPolicy.FAIL_ON_OBSERVATION,
    retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
    fallbackPolicy: ExternalFallbackPolicy.FAIL_CLOSED,
    interruptionPolicy: ExternalInterruptionPolicy.INTERRUPT_OPERATION,
  });
  const activityPolicyDigest = digests.digest({ namespace, kind: 'activity-policy' });
  const phaseDispatch = Object.freeze(
    [WorkflowPhase.DISCOVERY, WorkflowPhase.IMPLEMENT, WorkflowPhase.PLAN].map(
      (phase): ExternalExecutionPhaseDispatchEntry => {
        const candidateFree = phase !== WorkflowPhase.IMPLEMENT;
        const instructionSources = Object.freeze([]);
        return Object.freeze({
          phase,
          workerAdapter: 'codex-app-server-worker',
          workerAdapterVersion: 'codeclosure-m2-5-1-worker-v1',
          cwdKind: candidateFree
            ? ExternalPhaseCwdKind.PROJECT_READ_SNAPSHOT
            : ExternalPhaseCwdKind.CANDIDATE_WORKSPACE,
          sourceAuthorityKind: candidateFree
            ? ExternalPhaseSourceAuthorityKind.PROJECT_READ
            : ExternalPhaseSourceAuthorityKind.CANDIDATE,
          permissionProfileId: `permission-${phase.toLowerCase()}-v1`,
          permissionProfileDigest: digests.digest({ namespace, phase, kind: 'permission' }),
          isolationProfileId: 'project-read-test-isolation-v1',
          isolationProfileDigest: digests.digest({ isolation: namespace }),
          projectConfigurationPolicy: ExternalProjectConfigurationPolicy.DISABLED,
          configurationProfileDigest,
          executionConfigDigest: digests.digest({ namespace, phase, kind: 'execution-config' }),
          disabledIntegrationsDigest: digests.digest({
            namespace,
            phase,
            kind: 'disabled-integrations',
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
          allowedRoots: Object.freeze([`/project-read-workspaces/${namespace}/snapshot`]),
          forbiddenRoots: Object.freeze([
            `/authority/${namespace}`,
            `/fixture/project-read-${namespace}`,
          ]),
        });
      },
    ),
  );
  const v3ExternalExecution: ExternalExecutionProfileDefinitionV3 = Object.freeze({
    schemaVersion: 3,
    backendKind: capability.backendKind,
    capabilityRecordDigest: capability.recordDigest,
    selectedCapabilities,
    workerPhases: Object.freeze([
      WorkflowPhase.DISCOVERY,
      WorkflowPhase.IMPLEMENT,
      WorkflowPhase.PLAN,
    ]),
    binaryIdentityDigest,
    protocolSchemaDigest,
    managedRequirementsDigest: legacyExternalExecution.managedRequirementsDigest,
    controlledStateRootIdentity: legacyExternalExecution.controlledStateRootIdentity,
    environmentProjectionDigest: legacyExternalExecution.environmentProjectionDigest,
    model: legacyExternalExecution.model,
    modelProvider: legacyExternalExecution.modelProvider,
    serviceTier: legacyExternalExecution.serviceTier,
    reasoningEffort: legacyExternalExecution.reasoningEffort,
    defaultThreadPolicy: ExternalThreadPolicy.FRESH,
    retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
    interruptionPolicy: ExternalInterruptionPolicy.INTERRUPT_OPERATION,
    workerDispatchPolicy: ExternalWorkerDispatchPolicy.ALL_SELECTED_ATTEMPTS,
    phaseDispatch,
  });
  const base = testExecutionProfileDefinition(namespace);
  return Object.freeze({
    capability,
    profile: Object.freeze({
      ...base,
      schemaVersion: 2,
      id: executionProfileId(`profile_project-read-${namespace}-external-v2`),
      version: 'project-read-external-v2',
      workerAdapter: 'project-read-store-external-worker',
      workerAdapterVersion: '1',
      driverVersion: 'project-read-store-driver-v2',
      externalExecution: schemaVersion === 1 ? legacyExternalExecution : v3ExternalExecution,
    }),
  });
}

function rowCount(filename: string, table: string): number {
  const database = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const row = database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get();
    const count: unknown =
      typeof row !== 'object' || row === null ? undefined : (Reflect.get(row, 'count') as unknown);
    if (typeof count !== 'number') {
      assert.fail(`Could not count ${table}`);
    }
    return count;
  } finally {
    database.close();
  }
}

function createStartFixture(
  t: TestContext,
  namespace: string,
  transactionProbe?: (step: string) => void,
  externalProfileSchemaVersion?: 1 | 3,
  migrationsDirectory?: string,
) {
  const filename = temporaryDatabase(t, namespace);
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    ...(transactionProbe === undefined ? {} : { transactionProbe }),
    ...(migrationsDirectory === undefined ? {} : { migrationsDirectory }),
  });
  const ids = new DeterministicIds(`project-read-store-${namespace}`);
  const goal = createGoal({
    id: goalId(`goal_project-read-${namespace}`),
    revision: goalRevision(1),
    objective: 'Inspect the selected project before implementation',
    successCriteria: Object.freeze([
      Object.freeze({
        id: successCriterionId(`criterion_project-read-${namespace}`),
        description: 'Produce a source-bound plan',
        required: true,
      }),
    ]),
    scope: Object.freeze({
      projectPath: `/fixture/project-read-${namespace}`,
      allowedPaths: Object.freeze(['src/**']),
    }),
    nonGoals: Object.freeze(['Do not create a Candidate during discovery']),
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId(`workflow_project-read-${namespace}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  const policyInstall = createPolicyInstaller({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids,
    digests,
  }).installPolicyBundle(policyDefinition(namespace));
  if (policyInstall.status === 'POLICY_CONFLICT') {
    assert.fail(policyInstall.message);
  }
  const external =
    externalProfileSchemaVersion === undefined
      ? undefined
      : externalProfileAuthority(namespace, externalProfileSchemaVersion);
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
    clock: Object.freeze({ now: () => createdAt }),
    ids,
    digests,
  }).installExecutionProfile(
    external?.profile ?? testExecutionProfileDefinition(`project-read-${namespace}`),
  );
  if (profileInstall.status === 'PROFILE_CONFLICT') {
    assert.fail(profileInstall.message);
  }
  const policy = policyInstall.value.bundle;
  const profile = profileInstall.value.profile;
  const creation = store.createGoalWithWorkflow({
    commandId: ids.nextCommandId(),
    inputDigest: digests.digest({ schemaVersion: 1, operation: 'CREATE', namespace }),
    goal,
    workflow,
    auditEventId: ids.nextAuditEventId(),
    workflowAuditEventId: ids.nextAuditEventId(),
    payloadDigest: digests.digest(goalAndWorkflowCreationPayloadProjection(goal, workflow)),
  });
  assert.equal(creation.status, 'APPLIED');

  const startCommandId = commandId(`command_project-read-start-${namespace}`);
  const manifestId = contextManifestId(`context_project-read-${namespace}`);
  const decision = decideAttempt(workflow, undefined, {
    type: 'BEGIN_ATTEMPT',
    commandId: startCommandId,
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    attemptId: ids.nextAttemptId(),
    sequence: 1,
    contextManifestId: manifestId,
    workerSessionRef: workerSessionId(`worker_project-read-${namespace}`),
    occurredAt: startedAt,
  });
  if (!decision.accepted || decision.events[0].type !== 'ATTEMPT_STARTED') {
    assert.fail('Project-read fixture could not start its bound Attempt');
  }
  const event = decision.events[0];
  const resultingWorkflow = applyAttemptEvent(workflow, undefined, event).workflow;
  const policyBindingFields = Object.freeze({
    schemaVersion: 1 as const,
    goalId: goal.id,
    workflowId: workflow.id,
    policyBundleId: policy.id,
    policyBundleVersion: policy.version,
    policyBundleDigest: policy.digest,
    startCommandId,
    boundAt: startedAt,
  });
  const policyBinding = decodeWorkflowPolicyBinding({
    ...policyBindingFields,
    bindingDigest: digests.digest(workflowPolicyBindingProjection(policyBindingFields)),
  });
  const profileBindingFields = Object.freeze({
    schemaVersion: 1 as const,
    goalId: goal.id,
    workflowId: workflow.id,
    profileId: profile.id,
    profileVersion: profile.version,
    profileDigest: profile.digest,
    startCommandId,
    boundAt: startedAt,
  });
  const executionProfileBinding = decodeExecutionProfileBinding({
    ...profileBindingFields,
    bindingDigest: digests.digest(executionProfileBindingProjection(profileBindingFields)),
  });

  const protectedAsset = Object.freeze({
    logicalAssetId: 'project-read.fixture',
    registeredProtectedRootIdentity: '/protected/project-read',
    exactRealpath: '/protected/project-read/expected.txt',
    executionPath: '/protected/project-read/expected.txt',
    fileMode: 0o400,
    byteLength: 1,
    contentDigest: digests.digest({ asset: namespace }),
    protectionMode: ProtectedAssetProtectionMode.OUTSIDE_WORKER_WRITABLE_CANDIDATE,
  });
  const protectedAssets = Object.freeze([protectedAsset]);
  const requiredCriterion = goal.successCriteria[0];
  assert.ok(requiredCriterion);
  const protectedPlan = createAcceptanceCriticalVerificationPlan(
    {
      id: acceptanceCriticalVerificationPlanId(`verification-plan_project-read-${namespace}`),
      goal,
      resultingWorkflow,
      policyBundle: policy,
      executionProfile: profile,
      proposal: Object.freeze({
        acceptanceCriticalCriterionIds: Object.freeze([requiredCriterion.id]),
        acceptanceRuleIds: Object.freeze([...policy.acceptanceRules]),
        semanticCheckTemplate: Object.freeze({
          schemaVersion: 1 as const,
          checkVersion: 'project-read-check-v1',
          producerIdentity: 'project-read-test-runtime',
          operation: 'local-command.execute',
          runnerIdentity: 'project-read-test-runner',
          runnerVersion: '1',
          executablePath: '/usr/bin/true',
          executableDigest: digests.digest({ executable: '/usr/bin/true' }),
          declaredToolVersion: 'fixture',
          argv: Object.freeze(['--fixture']),
          cwd: '.',
          environmentVariables: Object.freeze([]),
          isolationProfileId: 'project-read-test-isolation-v1',
          isolationProfileDigest: digests.digest({ isolation: namespace }),
          timeoutMilliseconds: 1_000,
          terminationGraceMilliseconds: 100,
          stdoutLimitBytes: 1_024,
          stderrLimitBytes: 1_024,
          totalOutputLimitBytes: 2_048,
          payloadRetentionLimitBytes: 2_048,
          acceptedExitCodes: Object.freeze([0]),
        }),
        protectedAssets,
        protectedAssetManifestDigest: digests.digest(
          protectedAssetManifestProjection(protectedAssets),
        ),
        protectedAssetReadLeasePolicy:
          ProtectedAssetReadLeasePolicy.EXACT_READ_ONLY_SINGLE_INVOCATION,
        derivationRule: 'BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1' as const,
        authoritySource: 'TRUSTED_RUNTIME_COMPOSITION' as const,
      }),
      createdAt: startedAt,
    },
    digests,
  );

  const sourceTreeFields = Object.freeze({
    schemaVersion: 1 as const,
    profile: PROJECT_READ_SOURCE_TREE_PROFILE,
    entries: Object.freeze([
      Object.freeze({
        schemaVersion: 1 as const,
        path: 'src/index.ts',
        mode: ProjectReadFileMode.REGULAR,
        size: 1,
        contentDigest: digests.digest({ source: namespace }),
      }),
    ]),
    fileCount: 1,
    totalBytes: 1,
  });
  const sourceTree = Object.freeze({
    ...sourceTreeFields,
    projectionDigest: digests.digest(projectReadSourceTreeProjection(sourceTreeFields)),
  });
  const gitStateFields = Object.freeze({
    schemaVersion: 1 as const,
    profile: PROJECT_READ_GIT_STATE_PROFILE,
    sourceProjectRoot: goal.scope.projectPath,
    repositoryControlRootIdentity: goal.scope.projectPath,
    headCommit: 'a'.repeat(40),
    selectedPathSetDigest: digests.digest({ paths: ['src/index.ts'] }),
    stagedIndexManifestDigest: digests.digest({ staged: [] }),
    porcelainV2Digest: digests.digest({ porcelain: [] }),
  });
  const gitState = Object.freeze({
    ...gitStateFields,
    projectionDigest: digests.digest(projectReadGitStateProjection(gitStateFields)),
  });
  const capabilityGrantDigest = digests.digest({
    schemaVersion: 1,
    capabilityGrant: event.attempt.capabilityGrant,
  });
  const responseContractDigest = digests.digest({
    schemaVersion: 1,
    responseContract: m1WorkerResponseContract(WorkflowPhase.DISCOVERY),
  });
  const selectedPhaseEntry =
    profile.schemaVersion === 2 && profile.externalExecution.schemaVersion === 3
      ? profile.externalExecution.phaseDispatch.find(
          (entry) => entry.phase === WorkflowPhase.DISCOVERY,
        )
      : undefined;
  const phaseDispatchEntryDigest =
    selectedPhaseEntry === undefined
      ? digests.digest({ phase: WorkflowPhase.DISCOVERY })
      : digests.digest(externalExecutionPhaseDispatchEntryProjection(selectedPhaseEntry));
  const authorityFields = Object.freeze({
    schemaVersion: 1 as const,
    id: projectSourceReadAuthorityId(`project-read_project-read-${namespace}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    workflowId: workflow.id,
    workflowVersion: resultingWorkflow.version,
    phase: WorkflowPhase.DISCOVERY,
    attemptId: event.attempt.id,
    normalizedProjectRoot: goal.scope.projectPath,
    resolvedProjectRoot: goal.scope.projectPath,
    repositoryControlRootIdentity: goal.scope.projectPath,
    sourceTree,
    gitState,
    workspaceRootIdentity: `/project-read-workspaces/${namespace}`,
    snapshotId: projectReadSnapshotId(`project-read-snapshot_project-read-${namespace}`),
    snapshotLeafRealpath: `/project-read-workspaces/${namespace}/snapshot`,
    snapshotTreeDigest: sourceTree.projectionDigest,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    ownershipMarkerDigest: digests.digest({ marker: namespace }),
    policyBundleId: policy.id,
    policyBundleVersion: policy.version,
    policyBundleDigest: policy.digest,
    executionProfileId: profile.id,
    executionProfileVersion: profile.version,
    executionProfileDigest: profile.digest,
    phaseDispatchEntryDigest,
    capabilityGrantDigest,
    responseContractDigest,
    accessMode: ProjectReadSnapshotAccessMode.READ_ONLY,
    sourceCheckoutAccess: ProjectReadSourceCheckoutAccess.NONE,
    modelUsableNetworkPolicy: ProjectReadModelUsableNetworkPolicy.DENIED,
    forbiddenRoots: Object.freeze([goal.scope.projectPath]),
    isolationProfileId: 'project-read-test-isolation-v1',
    isolationProfileDigest: digests.digest({ isolation: namespace }),
    issuedAt: startedAt,
    lifecyclePolicy: ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT,
    retentionPolicy: ProjectReadRetentionPolicy.RUNTIME_OWNED,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
  });
  const projectReadAuthority = decodeProjectSourceReadAuthorityRecord({
    ...authorityFields,
    recordDigest: digests.digest(projectSourceReadAuthorityProjection(authorityFields)),
  });
  const compilation = new MinimalContextCompiler({
    compilerVersion: 'project-read-context-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  }).compile({
    manifestId,
    createdAt: startedAt,
    goal,
    workflow: resultingWorkflow,
    attempt: event.attempt,
    executionProfileId: profile.id,
    executionProfileDigest: profile.digest,
    policyBundleId: policy.id,
    policyBundleDigest: policy.digest,
    protectedPlan: Object.freeze({ id: protectedPlan.id, digest: protectedPlan.planDigest }),
    projectReadAuthority,
  });
  const input = Object.freeze({
    inputDigest: digests.digest({ schemaVersion: 1, operation: 'START', namespace }),
    target: Object.freeze({ aggregateType: 'GOAL' as const, aggregateId: goal.id }),
    event,
    auditEventId: ids.nextAuditEventId(),
    workflowAuditEventId: ids.nextAuditEventId(),
    payloadDigest: digests.digest(event),
    contextManifest: compilation.manifest,
    policyBinding,
    policyBindingAuditEventId: ids.nextAuditEventId(),
    executionProfileBinding,
    executionProfileBindingAuditEventId: ids.nextAuditEventId(),
    acceptanceCriticalVerificationPlan: protectedPlan,
    acceptanceCriticalVerificationPlanAuditEventId: ids.nextAuditEventId(),
    projectReadAuthority,
    projectReadAuthorityAuditEventId: ids.nextAuditEventId(),
  });
  return Object.freeze({
    filename,
    goal,
    workflow,
    store,
    input,
    policy,
    profile,
    projectReadAuthority,
  });
}

void test('project-read authority, protected Plan, Context v5, and Attempt Start commit and replay atomically', (t) => {
  const fixture = createStartFixture(t, 'happy');
  const applied = fixture.store.commitContextBoundAttemptStart(fixture.input);
  assert.equal(applied.status, 'APPLIED');
  assert.equal(applied.value.contextManifest.schemaVersion, 5);
  assert.deepEqual(applied.value.projectReadAuthority, fixture.projectReadAuthority);
  assert.deepEqual(
    fixture.store.getProjectSourceReadAuthority(fixture.projectReadAuthority.id),
    fixture.projectReadAuthority,
  );
  assert.equal(fixture.store.commitContextBoundAttemptStart(fixture.input).status, 'REPLAYED');

  const captured = fixture.store.captureProjectReadWorkspaceAuthoritySnapshot({
    id: projectReadWorkspaceAuthoritySnapshotId(
      'project-read-authority-snapshot_project-read-store-happy',
    ),
    issuedAt: isoTimestamp('2026-08-08T00:00:02.000Z'),
    auditEventId: auditEventId('audit_project-read-authority-snapshot-store-happy'),
  });
  assert.equal(captured.status, 'ISSUED');
  assert.equal(captured.value.expectedSnapshots.length, 1);
  assert.equal(
    captured.value.expectedSnapshots[0]?.retention,
    ProjectReadWorkspaceRetention.CURRENT,
  );
  assert.deepEqual(captured.value.activeConsumers, []);

  fixture.store.close();
  const reopened = openSqliteControlStore({ filename: fixture.filename, now: () => createdAt });
  assert.deepEqual(
    reopened.getProjectSourceReadAuthority(fixture.projectReadAuthority.id),
    fixture.projectReadAuthority,
  );
  assert.equal(reopened.getContextManifest(fixture.input.contextManifest.id)?.schemaVersion, 5);
  assert.deepEqual(
    reopened.getProjectReadWorkspaceAuthoritySnapshot(captured.value.id),
    captured.value,
  );
  reopened.close();
});

void test('[I-006][I-008][I-009][I-023] external execution Intent/Record v2 binds, persists, and reopens exact project-read authority', (t) => {
  const fixture = createStartFixture(t, 'external-v2', undefined, 3);
  assert.equal(fixture.store.commitContextBoundAttemptStart(fixture.input).status, 'APPLIED');
  const attempt = fixture.store.getAttempt(fixture.input.event.attempt.id);
  const workflow = fixture.store.getWorkflow(fixture.workflow.id);
  const manifest = fixture.store.getContextManifest(fixture.input.contextManifest.id);
  if (
    attempt === undefined ||
    workflow === undefined ||
    manifest === undefined ||
    attempt.workerSessionRef === undefined ||
    fixture.profile.schemaVersion !== 2 ||
    fixture.profile.externalExecution.schemaVersion !== 3
  ) {
    assert.fail('Intent v2 fixture lacks exact Profile, Workflow, Attempt, or Context authority');
  }
  const external = fixture.profile.externalExecution;
  const phaseEntry = external.phaseDispatch.find(
    (entry) => entry.phase === WorkflowPhase.DISCOVERY,
  );
  assert.ok(phaseEntry !== undefined);
  const ids = new DeterministicIds('project-read-external-v2');
  const claimedAt = isoTimestamp('2026-08-08T00:00:02.000Z');
  const claim = decodeWorkerDispatchClaim({
    schemaVersion: 2,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    attemptId: attempt.id,
    workerSessionId: attempt.workerSessionRef,
    contextManifestId: manifest.id,
    contextManifestDigest: manifest.manifestDigest,
    packageDigest: manifest.packageDigest,
    executionProfileId: fixture.profile.id,
    executionProfileDigest: fixture.profile.digest,
    claimedAt,
  });
  const claimDigest = digests.digest(workerDispatchClaimProjection(claim));
  const intentFields = Object.freeze({
    schemaVersion: 2 as const,
    id: ids.nextExternalExecutionId(),
    goalId: fixture.goal.id,
    goalRevision: fixture.goal.revision,
    workflowId: workflow.id,
    workflowVersionAtAuthorization: workflow.version,
    phase: WorkflowPhase.DISCOVERY,
    phaseVersion: workflow.version,
    attemptId: attempt.id,
    workerSessionId: attempt.workerSessionRef,
    dispatchClaimDigest: claimDigest,
    contextManifestId: manifest.id,
    contextManifestDigest: manifest.manifestDigest,
    contextPackageDigest: manifest.packageDigest,
    executionProfileId: fixture.profile.id,
    executionProfileDigest: fixture.profile.digest,
    policyBundleId: fixture.policy.id,
    policyBundleDigest: fixture.policy.digest,
    backendKind: external.backendKind,
    binaryIdentityDigest: external.binaryIdentityDigest,
    binaryProtocolSchemaDigest: external.protocolSchemaDigest,
    executionConfigDigest: phaseEntry.executionConfigDigest,
    managedRequirementsDigest: external.managedRequirementsDigest,
    instructionSourceManifestDigest: phaseEntry.instructionSourceManifestDigest,
    controlledStateRootIdentity: external.controlledStateRootIdentity,
    processLaunchNonce: digests.digest({ kind: 'external-v2-launch' }),
    thread: Object.freeze({ kind: ExternalThreadPolicy.FRESH }),
    continuityPolicy: phaseEntry.continuityPolicy,
    compactionPolicy: phaseEntry.compactionPolicy,
    retentionPolicy: external.retentionPolicy,
    fallbackPolicy: phaseEntry.fallbackPolicy,
    interruptionPolicy: external.interruptionPolicy,
    phaseDispatchEntryDigest: fixture.projectReadAuthority.phaseDispatchEntryDigest,
    sourceAuthority: Object.freeze({
      kind: ExternalPhaseSourceAuthorityKind.PROJECT_READ,
      projectReadAuthorityId: fixture.projectReadAuthority.id,
      projectReadAuthorityRecordDigest: fixture.projectReadAuthority.recordDigest,
      snapshotCwdIdentity: fixture.projectReadAuthority.snapshotLeafRealpath,
    }),
    authorizedAt: claimedAt,
  });
  const intent = decodeExternalExecutionIntent({
    ...intentFields,
    intentDigest: digests.digest(externalExecutionIntentProjection(intentFields)),
  });
  if (intent.schemaVersion !== 2) {
    assert.fail('Intent v2 fixture decoded as historical authority');
  }

  const {
    phaseDispatchEntryDigest: ignoredPhaseEntryDigest,
    sourceAuthority: ignoredSourceAuthority,
    ...commonIntentFields
  } = intentFields;
  void ignoredPhaseEntryDigest;
  void ignoredSourceAuthority;
  const legacyFields = Object.freeze({ ...commonIntentFields, schemaVersion: 1 as const });
  const legacyIntent = decodeExternalExecutionIntent({
    ...legacyFields,
    intentDigest: digests.digest(externalExecutionIntentProjection(legacyFields)),
  });
  assert.equal(
    fixture.store.claimExternalWorkerDispatch({
      claim,
      intent: legacyIntent,
      auditEventId: ids.nextAuditEventId(),
      externalAuditEventId: ids.nextAuditEventId(),
      payloadDigest: claimDigest,
    }).status,
    'NOT_ELIGIBLE',
  );

  const substitutedFields = Object.freeze({
    ...intentFields,
    phaseDispatchEntryDigest: digests.digest({ kind: 'substituted-phase-entry' }),
  });
  const substituted = decodeExternalExecutionIntent({
    ...substitutedFields,
    intentDigest: digests.digest(externalExecutionIntentProjection(substitutedFields)),
  });
  assert.equal(
    fixture.store.claimExternalWorkerDispatch({
      claim,
      intent: substituted,
      auditEventId: ids.nextAuditEventId(),
      externalAuditEventId: ids.nextAuditEventId(),
      payloadDigest: claimDigest,
    }).status,
    'NOT_ELIGIBLE',
  );
  assert.equal(fixture.store.getWorkerDispatchClaim(attempt.id), undefined);

  const claimed = fixture.store.claimExternalWorkerDispatch({
    claim,
    intent,
    auditEventId: ids.nextAuditEventId(),
    externalAuditEventId: ids.nextAuditEventId(),
    payloadDigest: claimDigest,
  });
  if (claimed.status !== 'CLAIMED') {
    assert.fail(`Intent v2 dispatch was not retained: ${claimed.status}`);
  }
  if (claimed.execution.schemaVersion !== 2) {
    assert.fail('Store substituted the authorized Intent/Record version');
  }
  assert.deepEqual(claimed.execution.sourceAuthority, intent.sourceAuthority);
  const failedObservationFields = Object.freeze({
    schemaVersion: 1 as const,
    id: externalExecutionObservationId('external-observation_external-v2-failed'),
    externalExecutionId: intent.id,
    intentDigest: intent.intentDigest,
    expectedRecordVersion: claimed.execution.version,
    state: ExternalExecutionState.FAILED,
    compactionCount: 0,
    turnInterruptCount: 0,
    failureCode: ExternalWorkerFailureCode.CLIENT_FAILURE,
    observedAt: isoTimestamp('2026-08-08T00:00:03.000Z'),
  });
  const failedObservation = decodeExternalExecutionObservation({
    ...failedObservationFields,
    observationDigest: digests.digest(
      externalExecutionObservationProjection(failedObservationFields),
    ),
  });
  const failed = fixture.store.admitExternalExecutionObservation({
    observation: failedObservation,
    observationAuditEventId: ids.nextAuditEventId(),
    recordAuditEventId: ids.nextAuditEventId(),
  });
  if (failed.status !== 'APPLIED') {
    assert.fail(`Intent v2 failure was not retained: ${failed.status}`);
  }
  assert.equal(failed.value.schemaVersion, 2);
  assert.equal(failed.value.state, ExternalExecutionState.FAILED);

  const database = new Database(fixture.filename, { readonly: true, fileMustExist: true });
  try {
    const row = database
      .prepare(
        `SELECT schema_version, candidate_workspace_lease_id,
                phase_dispatch_entry_digest, source_authority_json
           FROM external_execution_records WHERE id = ?`,
      )
      .get(intent.id) as
      | {
          schema_version: number;
          candidate_workspace_lease_id: string | null;
          phase_dispatch_entry_digest: string | null;
          source_authority_json: string | null;
        }
      | undefined;
    assert.ok(row !== undefined);
    assert.equal(row.schema_version, 2);
    assert.equal(row.candidate_workspace_lease_id, null);
    assert.equal(row.phase_dispatch_entry_digest, intent.phaseDispatchEntryDigest);
    assert.deepEqual(JSON.parse(row.source_authority_json ?? 'null'), intent.sourceAuthority);
  } finally {
    database.close();
  }

  fixture.store.close();
  const reopened = openSqliteControlStore({ filename: fixture.filename, now: () => createdAt });
  assert.deepEqual(reopened.getExternalExecution(intent.id), failed.value);
  reopened.close();

  const tamper = new Database(fixture.filename, { fileMustExist: true });
  try {
    tamper.exec('DROP TRIGGER external_execution_records_update_guard');
    assert.throws(() =>
      tamper
        .prepare(
          `UPDATE external_execution_records
              SET source_authority_json = NULL
            WHERE id = ?`,
        )
        .run(intent.id),
    );
    tamper
      .prepare(
        `UPDATE external_execution_records
            SET source_authority_json = json_set(
              source_authority_json, '$.snapshotCwdIdentity', '/substituted/snapshot'
            )
          WHERE id = ?`,
      )
      .run(intent.id);
  } finally {
    tamper.close();
  }
  assert.throws(() => openSqliteControlStore({ filename: fixture.filename, now: () => createdAt }));
});

void test('[I-006][I-008][I-009] active consumer history reopens and terminal authority issues one cleanup Grant', (t) => {
  const migrationsDirectory = migrationsThrough(t, '0032_external_execution_profile_v3.sql');
  const fixture = createStartFixture(t, 'terminal-cleanup', undefined, 1, migrationsDirectory);
  assert.equal(fixture.store.commitContextBoundAttemptStart(fixture.input).status, 'APPLIED');
  const attempt = fixture.store.getAttempt(fixture.input.event.attempt.id);
  const workflow = fixture.store.getWorkflow(fixture.workflow.id);
  const manifest = fixture.store.getContextManifest(fixture.input.contextManifest.id);
  if (
    attempt === undefined ||
    workflow === undefined ||
    manifest === undefined ||
    attempt.workerSessionRef === undefined ||
    fixture.profile.schemaVersion !== 2 ||
    fixture.profile.externalExecution.schemaVersion === 3
  ) {
    assert.fail('Terminal cleanup fixture lacks exact external dispatch authority');
  }
  const externalProfile = fixture.profile.externalExecution;
  const ids = new DeterministicIds('project-read-terminal-cleanup');
  const claimedAt = isoTimestamp('2026-08-08T00:00:02.000Z');
  const claim = decodeWorkerDispatchClaim({
    schemaVersion: 2,
    workflowId: workflow.id,
    workflowVersion: workflow.version,
    attemptId: attempt.id,
    workerSessionId: attempt.workerSessionRef,
    contextManifestId: manifest.id,
    contextManifestDigest: manifest.manifestDigest,
    packageDigest: manifest.packageDigest,
    executionProfileId: fixture.profile.id,
    executionProfileDigest: fixture.profile.digest,
    claimedAt,
  });
  const claimDigest = digests.digest(workerDispatchClaimProjection(claim));
  const executionIdentifier = ids.nextExternalExecutionId();
  const intentWithoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    id: executionIdentifier,
    goalId: fixture.goal.id,
    goalRevision: fixture.goal.revision,
    workflowId: workflow.id,
    workflowVersionAtAuthorization: workflow.version,
    phase: WorkflowPhase.DISCOVERY,
    phaseVersion: workflow.version,
    attemptId: attempt.id,
    workerSessionId: attempt.workerSessionRef,
    dispatchClaimDigest: claimDigest,
    contextManifestId: manifest.id,
    contextManifestDigest: manifest.manifestDigest,
    contextPackageDigest: manifest.packageDigest,
    executionProfileId: fixture.profile.id,
    executionProfileDigest: fixture.profile.digest,
    policyBundleId: fixture.policy.id,
    policyBundleDigest: fixture.policy.digest,
    backendKind: externalProfile.backendKind,
    binaryIdentityDigest: externalProfile.binaryIdentityDigest,
    binaryProtocolSchemaDigest: externalProfile.protocolSchemaDigest,
    executionConfigDigest: externalProfile.executionConfigDigest,
    managedRequirementsDigest: externalProfile.managedRequirementsDigest,
    instructionSourceManifestDigest: externalProfile.instructionSourceManifestDigest,
    controlledStateRootIdentity: externalProfile.controlledStateRootIdentity,
    processLaunchNonce: digests.digest({ executionIdentifier, kind: 'launch-nonce' }),
    thread: Object.freeze({ kind: ExternalThreadPolicy.FRESH }),
    continuityPolicy: externalProfile.continuityPolicy,
    compactionPolicy: externalProfile.compactionPolicy,
    retentionPolicy: externalProfile.retentionPolicy,
    fallbackPolicy: externalProfile.fallbackPolicy,
    interruptionPolicy: externalProfile.interruptionPolicy,
    authorizedAt: claimedAt,
  });
  const intent = decodeExternalExecutionIntent({
    ...intentWithoutDigest,
    intentDigest: digests.digest(externalExecutionIntentProjection(intentWithoutDigest)),
  });
  const dispatch = fixture.store.claimWorkerDispatch({
    claim,
    auditEventId: ids.nextAuditEventId(),
    payloadDigest: claimDigest,
  });
  if (dispatch.status !== 'CLAIMED') {
    assert.fail('Historical Worker dispatch was not claimed');
  }
  const legacyDatabase = new Database(fixture.filename, { fileMustExist: true });
  const auditSequence = legacyDatabase
    .prepare('SELECT coalesce(max(sequence), 0) + 1 FROM audit_events')
    .pluck()
    .get() as number;
  const recordWithoutDigest = Object.freeze({
    ...intent,
    version: 1,
    state: ExternalExecutionState.AUTHORIZED,
    compactionCount: 0,
    turnInterruptCount: 0,
    updatedAt: intent.authorizedAt,
    auditSequence,
  });
  const legacyRecord = decodeExternalExecutionRecord({
    ...recordWithoutDigest,
    recordDigest: digests.digest(externalExecutionRecordProjection(recordWithoutDigest)),
  });
  legacyDatabase.exec('BEGIN IMMEDIATE');
  try {
    legacyDatabase
      .prepare(
        `INSERT INTO audit_events(
           sequence, id, aggregate_type, aggregate_id, event_type, actor_type,
           command_id, before_version, after_version, correlation_id, causation_id,
           payload_digest, occurred_at
         ) VALUES (?, ?, 'EXTERNAL_EXECUTION', ?, 'EXTERNAL_EXECUTION_AUTHORIZED',
           'RUNTIME', NULL, NULL, 1, NULL, NULL, ?, ?)`,
      )
      .run(
        auditSequence,
        ids.nextAuditEventId(),
        legacyRecord.id,
        legacyRecord.recordDigest,
        legacyRecord.authorizedAt,
      );
    legacyDatabase
      .prepare(
        `INSERT INTO external_execution_records(
           id, schema_version, version, state, goal_id, goal_revision, workflow_id,
           workflow_version_at_authorization, phase, phase_version, attempt_id,
           worker_session_id, dispatch_claim_digest, context_manifest_id,
           context_manifest_digest, context_package_digest, execution_profile_id,
           execution_profile_digest, policy_bundle_id, policy_bundle_digest, backend_kind,
           binary_identity_digest, binary_protocol_schema_digest, execution_config_digest,
           managed_requirements_digest, instruction_source_manifest_digest,
           controlled_state_root_identity, process_launch_nonce, thread_json,
           continuity_policy, compaction_policy, retention_policy, fallback_policy,
           interruption_policy, candidate_workspace_lease_id, candidate_workspace_lease_digest,
           candidate_workspace_cwd_identity, authorized_at, intent_digest, process_identity_json,
           backend_session_ref, backend_operation_ref, compaction_count, turn_interrupt_count,
           failure_code, result_event_id, updated_at, terminal_at, last_observation_id,
           audit_sequence, record_digest
         ) VALUES (
           @id, 1, 1, @state, @goalId, @goalRevision, @workflowId,
           @workflowVersionAtAuthorization, @phase, @phaseVersion, @attemptId,
           @workerSessionId, @dispatchClaimDigest, @contextManifestId,
           @contextManifestDigest, @contextPackageDigest, @executionProfileId,
           @executionProfileDigest, @policyBundleId, @policyBundleDigest, @backendKind,
           @binaryIdentityDigest, @binaryProtocolSchemaDigest, @executionConfigDigest,
           @managedRequirementsDigest, @instructionSourceManifestDigest,
           @controlledStateRootIdentity, @processLaunchNonce, @threadJson,
           @continuityPolicy, @compactionPolicy, @retentionPolicy, @fallbackPolicy,
           @interruptionPolicy, NULL, NULL, NULL, @authorizedAt, @intentDigest, NULL,
           NULL, NULL, 0, 0, NULL, NULL, @updatedAt, NULL, NULL,
           @auditSequence, @recordDigest
         )`,
      )
      .run({
        ...legacyRecord,
        threadJson: JSON.stringify(legacyRecord.thread),
      });
    legacyDatabase.exec('COMMIT');
  } catch (error) {
    if (legacyDatabase.inTransaction) {
      legacyDatabase.exec('ROLLBACK');
    }
    throw error;
  } finally {
    legacyDatabase.close();
  }

  fixture.store.close();
  copyFileSync(
    join(defaultMigrationsDirectory(), '0033_external_execution_intent_v2.sql'),
    join(migrationsDirectory, '0033_external_execution_intent_v2.sql'),
  );
  const store = openSqliteControlStore({
    filename: fixture.filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  assert.deepEqual(store.getExternalExecution(intent.id), legacyRecord);

  const activeSnapshot = store.captureProjectReadWorkspaceAuthoritySnapshot({
    id: projectReadWorkspaceAuthoritySnapshotId(
      'project-read-authority-snapshot_terminal-cleanup-active',
    ),
    issuedAt: isoTimestamp('2026-08-08T00:00:02.500Z'),
    auditEventId: ids.nextAuditEventId(),
  });
  assert.equal(activeSnapshot.status, 'ISSUED');
  assert.equal(activeSnapshot.value.expectedSnapshots[0]?.retention, 'CURRENT');
  assert.deepEqual(activeSnapshot.value.activeConsumers, [
    {
      attemptId: attempt.id,
      externalExecutionId: intent.id,
      projectReadAuthorityId: fixture.projectReadAuthority.id,
      snapshotId: fixture.projectReadAuthority.snapshotId,
    },
  ]);

  const terminalObservationFields = Object.freeze({
    schemaVersion: 1 as const,
    id: externalExecutionObservationId('external-observation_terminal-cleanup-failed'),
    externalExecutionId: intent.id,
    intentDigest: intent.intentDigest,
    expectedRecordVersion: legacyRecord.version,
    state: ExternalExecutionState.FAILED,
    compactionCount: 0,
    turnInterruptCount: 0,
    failureCode: ExternalWorkerFailureCode.CLIENT_FAILURE,
    observedAt: isoTimestamp('2026-08-08T00:00:03.000Z'),
  });
  const terminalObservation = decodeExternalExecutionObservation({
    ...terminalObservationFields,
    observationDigest: digests.digest(
      externalExecutionObservationProjection(terminalObservationFields),
    ),
  });
  const observed = store.admitExternalExecutionObservation({
    observation: terminalObservation,
    observationAuditEventId: ids.nextAuditEventId(),
    recordAuditEventId: ids.nextAuditEventId(),
  });
  if (observed.status !== 'APPLIED') {
    assert.fail('External terminal observation was not admitted');
  }

  const runningWorkflow = store.getWorkflow(workflow.id);
  const runningAttempt = store.getAttempt(attempt.id);
  if (runningWorkflow === undefined || runningAttempt === undefined) {
    assert.fail('Terminal cleanup fixture lost its running authority');
  }
  const finishCommandId = commandId('command_project-read-terminal-cleanup-finish');
  const finishDecision = decideAttempt(runningWorkflow, runningAttempt, {
    type: 'RECORD_ATTEMPT_FAILURE',
    commandId: finishCommandId,
    workflowId: runningWorkflow.id,
    expectedWorkflowVersion: runningWorkflow.version,
    attemptId: runningAttempt.id,
    failureClass: AttemptFailureClass.TRANSIENT_BACKEND,
    occurredAt: isoTimestamp('2026-08-08T00:00:04.000Z'),
    reason: WorkerFailureReasonCode.BACKEND_FAILURE,
  });
  if (!finishDecision.accepted || finishDecision.events[0].type !== 'ATTEMPT_FINISHED') {
    assert.fail('Terminal cleanup fixture could not finish its Attempt');
  }
  const finishEvent = finishDecision.events[0];
  assert.equal(
    store.commitAttemptEvent({
      inputDigest: digests.digest({ schemaVersion: 1, operation: 'TERMINAL_CLEANUP_FINISH' }),
      target: Object.freeze({ aggregateType: 'WORKFLOW', aggregateId: workflow.id }),
      event: finishEvent,
      auditEventId: ids.nextAuditEventId(),
      workflowAuditEventId: ids.nextAuditEventId(),
      payloadDigest: digests.digest(finishEvent),
    }).status,
    'APPLIED',
  );
  const terminalAttempt = store.getAttempt(attempt.id);
  const terminalExecution = store.getExternalExecution(intent.id);
  if (
    terminalAttempt === undefined ||
    terminalAttempt.status === AttemptStatus.RUNNING ||
    terminalExecution?.terminalAt === undefined ||
    (terminalExecution.state !== ExternalExecutionState.COMPLETED &&
      terminalExecution.state !== ExternalExecutionState.INTERRUPTED &&
      terminalExecution.state !== ExternalExecutionState.FAILED &&
      terminalExecution.state !== ExternalExecutionState.ABANDONED)
  ) {
    assert.fail('Terminal cleanup fixture did not retain exact terminal authority');
  }

  const terminalSnapshot = store.captureProjectReadWorkspaceAuthoritySnapshot({
    id: projectReadWorkspaceAuthoritySnapshotId(
      'project-read-authority-snapshot_terminal-cleanup-terminal',
    ),
    issuedAt: isoTimestamp('2026-08-08T00:00:05.000Z'),
    auditEventId: ids.nextAuditEventId(),
  });
  assert.equal(terminalSnapshot.status, 'ISSUED');
  assert.equal(terminalSnapshot.value.expectedSnapshots[0]?.retention, 'RETAINED');
  assert.deepEqual(terminalSnapshot.value.activeConsumers, []);
  assert.deepEqual(
    store.getProjectReadWorkspaceAuthoritySnapshot(activeSnapshot.value.id),
    activeSnapshot.value,
  );

  const grantFields = Object.freeze({
    schemaVersion: 1 as const,
    id: projectReadSnapshotCleanupGrantId('project-read-cleanup-grant_terminal-cleanup'),
    eligibilityKind: ProjectReadSnapshotCleanupEligibilityKind.TERMINAL,
    authoritySnapshotId: terminalSnapshot.value.id,
    authoritySnapshotDigest: terminalSnapshot.value.authorityDigest,
    authoritySequence: terminalSnapshot.value.authoritySequence,
    projectReadAuthorityId: fixture.projectReadAuthority.id,
    projectReadAuthorityRecordDigest: fixture.projectReadAuthority.recordDigest,
    snapshotId: fixture.projectReadAuthority.snapshotId,
    workspaceRootIdentity: fixture.projectReadAuthority.workspaceRootIdentity,
    snapshotLeafRealpath: fixture.projectReadAuthority.snapshotLeafRealpath,
    ownershipMarkerProfile: fixture.projectReadAuthority.ownershipMarkerProfile,
    ownershipMarkerDigest: fixture.projectReadAuthority.ownershipMarkerDigest,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
    lifecyclePolicy: ProjectReadSnapshotCleanupLifecyclePolicy.CONSUME_ONCE,
    issuedAt: isoTimestamp('2026-08-08T00:00:06.000Z'),
    attemptId: terminalAttempt.id,
    terminalAttemptStatus: terminalAttempt.status,
    terminalAttemptEndedAt: terminalAttempt.endedAt,
    externalExecutionId: terminalExecution.id,
    terminalExternalExecutionState: terminalExecution.state,
    terminalExternalExecutionAt: terminalExecution.terminalAt,
    terminalExternalExecutionRecordDigest: terminalExecution.recordDigest,
  });
  const grant = decodeProjectReadSnapshotCleanupGrant(
    {
      ...grantFields,
      grantDigest: digestProjectReadSnapshotCleanupValue(
        projectReadSnapshotCleanupGrantProjection(grantFields),
      ),
    },
    { digest: digestProjectReadSnapshotCleanupValue },
  );
  assert.equal(
    store.issueProjectReadSnapshotCleanupGrant({
      grant,
      auditEventId: ids.nextAuditEventId(),
    }).status,
    'ISSUED',
  );

  store.close();
  const reopened = openSqliteControlStore({ filename: fixture.filename, now: () => createdAt });
  assert.deepEqual(
    reopened.getProjectReadWorkspaceAuthoritySnapshot(activeSnapshot.value.id),
    activeSnapshot.value,
  );
  assert.deepEqual(reopened.getProjectReadSnapshotCleanupGrant(grant.id), grant);
  reopened.close();
});

void test('project-read record and Context mismatches fail before any Start authority is written', (t) => {
  const fixture = createStartFixture(t, 'mismatch');
  const { recordDigest: ignoredDigest, ...fields } = fixture.projectReadAuthority;
  void ignoredDigest;
  const changedFields = Object.freeze({
    ...fields,
    id: projectSourceReadAuthorityId('project-read_project-read-mismatch-changed'),
  });
  const changedRecord: ProjectSourceReadAuthorityRecord = decodeProjectSourceReadAuthorityRecord({
    ...changedFields,
    recordDigest: digests.digest(projectSourceReadAuthorityProjection(changedFields)),
  });
  assert.throws(() =>
    fixture.store.commitContextBoundAttemptStart({
      ...fixture.input,
      projectReadAuthority: changedRecord,
    }),
  );
  assert.equal(rowCount(fixture.filename, 'attempts'), 0);
  assert.equal(rowCount(fixture.filename, 'context_manifests'), 0);
  assert.equal(rowCount(fixture.filename, 'project_source_read_authorities'), 0);
  fixture.store.close();
});

for (const { step, namespace } of [
  {
    step: WorkerTransactionStep.AFTER_PROJECT_READ_AUTHORITY_AUDIT_WRITE,
    namespace: 'rollback-audit',
  },
  {
    step: WorkerTransactionStep.AFTER_PROJECT_READ_AUTHORITY_WRITE,
    namespace: 'rollback-record',
  },
] as const) {
  void test(`failure at ${step} rolls back project-read, Plan, bindings, Context, Attempt, and command`, (t) => {
    const fixture = createStartFixture(t, namespace, (observed) => {
      if (observed === step) {
        throw new Error(`injected ${step}`);
      }
    });
    assert.throws(() => fixture.store.commitContextBoundAttemptStart(fixture.input), {
      message: `injected ${step}`,
    });
    for (const table of [
      'attempts',
      'context_manifests',
      'project_source_read_authorities',
      'acceptance_critical_verification_plans',
      'workflow_policy_bindings',
      'workflow_execution_profile_bindings',
    ]) {
      assert.equal(rowCount(fixture.filename, table), 0, table);
    }
    assert.equal(fixture.store.getWorkflow(fixture.workflow.id)?.version, fixture.workflow.version);
    fixture.store.close();
  });
}

void test('reopen fails closed when retained project-read canonical JSON is rewritten', (t) => {
  const fixture = createStartFixture(t, 'corrupt');
  assert.equal(fixture.store.commitContextBoundAttemptStart(fixture.input).status, 'APPLIED');
  fixture.store.close();
  const database = new Database(fixture.filename);
  database.exec('DROP TRIGGER project_source_read_authorities_no_update');
  database
    .prepare(
      `UPDATE project_source_read_authorities
          SET canonical_json = json_set(canonical_json, '$.workspaceRootIdentity', '/tampered')
        WHERE id = ?`,
    )
    .run(fixture.projectReadAuthority.id);
  database.close();
  assert.throws(() => openSqliteControlStore({ filename: fixture.filename, now: () => createdAt }));
});

void test('reopen rejects a Context row with overlapping protected-v4 and project-read-v5 extensions', (t) => {
  const fixture = createStartFixture(t, 'overlap');
  assert.equal(fixture.store.commitContextBoundAttemptStart(fixture.input).status, 'APPLIED');
  fixture.store.close();
  const database = new Database(fixture.filename);
  database
    .prepare(
      `INSERT INTO protected_context_manifest_extensions(
         context_manifest_id, logical_schema_version, verification_plan_id,
         verification_plan_digest
       ) VALUES (?, 4, ?, ?)`,
    )
    .run(
      fixture.input.contextManifest.id,
      fixture.input.acceptanceCriticalVerificationPlan.id,
      fixture.input.acceptanceCriticalVerificationPlan.planDigest,
    );
  database.close();
  assert.throws(() => openSqliteControlStore({ filename: fixture.filename, now: () => createdAt }));
});
