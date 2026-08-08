import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
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
  ProjectReadSnapshotAccessMode,
  ProjectReadSourceCheckoutAccess,
  WorkflowPhase,
  acceptanceCriticalVerificationPlanId,
  applyAttemptEvent,
  commandId,
  contextManifestId,
  createGoal,
  createWorkflow,
  decideAttempt,
  decodeExecutionProfileBinding,
  decodeProjectSourceReadAuthorityRecord,
  decodeWorkflowPolicyBinding,
  executionProfileBindingProjection,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  projectReadGitStateProjection,
  projectReadSnapshotId,
  projectReadSourceTreeProjection,
  projectSourceReadAuthorityId,
  projectSourceReadAuthorityProjection,
  protectedAssetManifestProjection,
  successCriterionId,
  workerSessionId,
  workflowId,
  workflowPolicyBindingProjection,
  type PolicyBundleDefinition,
  type ProjectSourceReadAuthorityRecord,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  createAcceptanceCriticalVerificationPlan,
  createExecutionProfileInstaller,
  createPolicyInstaller,
  goalAndWorkflowCreationPayloadProjection,
  m1WorkerResponseContract,
} from '@codeclosure/runtime';
import { WorkerTransactionStep, openSqliteControlStore } from '@codeclosure/store-sqlite';
import { DeterministicIds, testExecutionProfileDefinition } from '@codeclosure/testing';

const digests = new CanonicalJsonSha256DigestProvider();
const createdAt = isoTimestamp('2026-08-08T00:00:00.000Z');
const startedAt = isoTimestamp('2026-08-08T00:00:01.000Z');

function temporaryDatabase(t: TestContext, namespace: string): string {
  const root = mkdtempSync(join(tmpdir(), `codeclosure-project-read-store-${namespace}-`));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'state.sqlite');
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
) {
  const filename = temporaryDatabase(t, namespace);
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    ...(transactionProbe === undefined ? {} : { transactionProbe }),
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
  const profileInstall = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids,
    digests,
  }).installExecutionProfile(testExecutionProfileDefinition(`project-read-${namespace}`));
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
    phaseDispatchEntryDigest: digests.digest({ phase: WorkflowPhase.DISCOVERY }),
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
  return Object.freeze({ filename, goal, workflow, store, input, projectReadAuthority });
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

  fixture.store.close();
  const reopened = openSqliteControlStore({ filename: fixture.filename, now: () => createdAt });
  assert.deepEqual(
    reopened.getProjectSourceReadAuthority(fixture.projectReadAuthority.id),
    fixture.projectReadAuthority,
  );
  assert.equal(reopened.getContextManifest(fixture.input.contextManifest.id)?.schemaVersion, 5);
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
