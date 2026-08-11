import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  AttemptFailureClass,
  AttemptStatus,
  CandidateGenerationState,
  CheckSpecificationKind,
  EvidenceKind,
  GoalStatus,
  GuardOutcome,
  PROJECT_READ_CLEANUP_POLICY,
  PROJECT_READ_GIT_STATE_PROFILE,
  PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
  PROJECT_READ_SOURCE_TREE_PROFILE,
  ProjectReadFileMode,
  ProjectReadLifecyclePolicy,
  ProjectReadModelUsableNetworkPolicy,
  ProjectReadRetentionPolicy,
  ProjectReadSnapshotAccessMode,
  ProjectReadSourceCheckoutAccess,
  ProtectedAssetProtectionMode,
  ProtectedAssetReadLeasePolicy,
  RunStatus,
  WorkflowGuard,
  WorkflowIntegrityFailureReasonCode,
  WorkflowPhase,
  acceptanceCriticalVerificationPlanId,
  applyAttemptEvent,
  commandId,
  contextManifestId,
  createGoal,
  createWorkflow,
  decideAttempt,
  decodeExecutionProfileBinding,
  decodePolicyBundle,
  decodeProjectSourceReadAuthorityRecord,
  decodeWorkflowPolicyBinding,
  executionProfileProjection,
  externalExecutionPhaseDispatchEntryProjection,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  projectReadGitStateProjection,
  projectReadSnapshotId,
  projectReadSourceTreeProjection,
  projectSourceReadAuthorityId,
  projectSourceReadAuthorityProjection,
  protectedAssetManifestProjection,
  requiredGuardsForTransition,
  sha256Digest,
  successCriterionId,
  workerSessionId,
  workflowId,
  workflowPolicyBindingProjection,
  type PolicyBundleDefinition,
  type AttemptId,
  type CandidateGenerationId,
  type ExecutionProfile,
  type Goal,
  type PolicyBundle,
  type ProjectSourceReadAuthorityRecord,
  type Sha256Digest,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CandidatePreparationDisposition,
  CandidateChangeFileMode,
  CandidateChangeKind,
  CandidateSourceFailureCode,
  CanonicalJsonSha256DigestProvider,
  GoalDominantBlockerCode,
  GoalNextSafeAction,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  StoredCommandDisposition,
  createAcceptanceCriticalVerificationPlan,
  createCandidateChangeSetV2,
  createCodeClosureApplication,
  decodeStoredCommandOutcome,
  createExecutionProfileInstaller,
  createPolicyInstaller,
  decodeCandidatePreparationV2,
  goalAndWorkflowCreationPayloadProjection,
  m1WorkerResponseContract,
  validateCandidateFreezeRequestV2,
  validateCandidatePreparationRequestV2,
  validateFrozenCandidateIntegrityRequest,
  type CandidateSourcePort,
  type Clock,
} from '@codeclosure/runtime';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';
import {
  DeterministicIds,
  FakeCandidateSource,
  FakeVerificationRunner,
  m251CandidateFreezeV2ProfileFixture,
} from '@codeclosure/testing';
import {
  WorkflowRuntimeKernel,
  type AttemptContextCompilationRequest,
  type PhaseGuardEvaluator,
} from '@codeclosure/runtime/testing/workflow-runtime';

const createdAt = isoTimestamp('2026-08-10T00:00:00.000Z');
const digests = new CanonicalJsonSha256DigestProvider();

type FreezeFixture =
  | 'IN_SCOPE'
  | 'PLAN_SOURCE_NOT_CURRENT'
  | 'OUT_OF_SCOPE'
  | 'BASE_NOT_CURRENT'
  | 'UNSTABLE'
  | 'EMPTY'
  | 'DIGEST_SUBSTITUTION'
  | 'BINDING_MISMATCH';

function digest(label: string): Sha256Digest {
  return sha256Digest(`sha256:${createHash('sha256').update(label, 'utf8').digest('hex')}`);
}

class M251CandidateFreezeSource implements CandidateSourcePort {
  readonly #historical = new FakeCandidateSource();
  readonly #fixture: FreezeFixture;

  public constructor(fixture: FreezeFixture) {
    this.#fixture = fixture;
  }

  public prepare(request: Parameters<CandidateSourcePort['prepare']>[0]): unknown {
    if (this.#fixture === 'PLAN_SOURCE_NOT_CURRENT' && request.schemaVersion === 2) {
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
          kind: 'plan-source-not-current',
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
    return this.#historical.prepare(request);
  }

  public prepareRepair(request: Parameters<CandidateSourcePort['prepareRepair']>[0]): unknown {
    return this.#historical.prepareRepair(request);
  }

  public observeFreeze(request: Parameters<CandidateSourcePort['observeFreeze']>[0]): unknown {
    if (request.schemaVersion === 1) {
      return this.#historical.observeFreeze(request);
    }
    const validated = validateCandidateFreezeRequestV2(request);
    const frozenSourceDigest = digest(`m251-frozen\u0000${validated.generation.id}`);
    const baseSourceDigest =
      this.#fixture === 'BASE_NOT_CURRENT'
        ? digest(`m251-stale-base\u0000${validated.generation.id}`)
        : validated.generation.baseDigest;
    const changes =
      this.#fixture === 'EMPTY'
        ? Object.freeze([])
        : Object.freeze([
            Object.freeze({
              path: this.#fixture === 'OUT_OF_SCOPE' ? 'tests/payment.test.ts' : 'src/payment.ts',
              kind: CandidateChangeKind.MODIFIED,
              before: Object.freeze({
                byteLength: 20,
                contentDigest: digest(`m251-before\u0000${validated.generation.id}`),
                mode: CandidateChangeFileMode.REGULAR,
              }),
              after: Object.freeze({
                byteLength: 21,
                contentDigest: digest(`m251-after\u0000${validated.generation.id}`),
                mode: CandidateChangeFileMode.REGULAR,
              }),
            }),
          ]);
    const changeSet = createCandidateChangeSetV2({
      baseSourceDigest,
      frozenSourceDigest,
      changes,
    });
    return Object.freeze({
      schemaVersion: 2 as const,
      generationId: validated.generation.id,
      allowedPathPolicyDigest:
        this.#fixture === 'BINDING_MISMATCH'
          ? digest(`m251-wrong-allowed-paths\u0000${validated.generation.id}`)
          : validated.allowedPathPolicyDigest,
      baseSourceDigest: changeSet.baseSourceDigest,
      changeSetDigest:
        this.#fixture === 'DIGEST_SUBSTITUTION'
          ? digest(`m251-wrong-change-set\u0000${validated.generation.id}`)
          : changeSet.changeSetDigest,
      changeSetProfile: changeSet.profile,
      changes: changeSet.changes,
      firstSourceDigest:
        this.#fixture === 'UNSTABLE'
          ? digest(`m251-first-freeze\u0000${validated.generation.id}`)
          : changeSet.frozenSourceDigest,
      secondSourceDigest: changeSet.frozenSourceDigest,
    });
  }

  public observeFrozen(request: Parameters<CandidateSourcePort['observeFrozen']>[0]): unknown {
    const validated = validateFrozenCandidateIntegrityRequest(request);
    if (validated.generation.frozenDigest === undefined) {
      throw new TypeError('M2.5.1 frozen integrity observation requires a frozen digest');
    }
    return Object.freeze({
      schemaVersion: 1 as const,
      generationId: validated.generation.id,
      observedDigest: validated.generation.frozenDigest,
    });
  }
}

function temporaryDatabase(t: TestContext, namespace: string): string {
  const directory = mkdtempSync(join(tmpdir(), `codeclosure-${namespace}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'control.sqlite');
}

function monotonicClock(): Clock {
  let milliseconds = 1;
  return Object.freeze({
    now: () => {
      const value = isoTimestamp(`2026-08-10T00:00:00.${String(milliseconds).padStart(3, '0')}Z`);
      milliseconds += 1;
      return value;
    },
  });
}

function policyDefinition(namespace: string): PolicyBundleDefinition {
  return Object.freeze({
    id: policyBundleId(`policy_${namespace}`),
    schemaVersion: 1,
    version: 'm2.5.1-candidate-freeze-v2-policy-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['source-bound-candidate-context']),
    checkSpecifications: Object.freeze(['runtime-owned-check-specifications']),
    applicabilityRules: Object.freeze(['exact-candidate-and-policy']),
    acceptanceRules: Object.freeze(['not-exercised-by-c11']),
    checkerVersions: Object.freeze([]),
  });
}

const reserved = new Set<WorkflowGuard>([
  WorkflowGuard.CANDIDATE_GENERATION_PREPARED,
  WorkflowGuard.MUTABLE_CANDIDATE_CURRENT,
  WorkflowGuard.WORKER_QUIESCENT,
  WorkflowGuard.NO_WRITE_CAPABLE_WORKER,
  WorkflowGuard.FREEZE_IDENTITY_STABLE,
  WorkflowGuard.CHANGE_IDENTITY_RECORDED,
  WorkflowGuard.FROZEN_DIGEST_PERSISTED,
]);

const genericGuards: PhaseGuardEvaluator = Object.freeze({
  evaluate: (input: Parameters<PhaseGuardEvaluator['evaluate']>[0]) =>
    Object.freeze(
      (requiredGuardsForTransition(input.workflow.phase, input.requestedPhase) ?? [])
        .filter((guard) => !reserved.has(guard))
        .map((guard) =>
          Object.freeze({
            guard,
            outcome: GuardOutcome.PASS,
            reasonCode: 'FIXTURE_GENERIC_GUARD',
            supportingRefs: Object.freeze([`fixture:${guard}`]),
          }),
        ),
    ),
});

function commitProjectReadAttempt(
  namespace: string,
  store: ReturnType<typeof openSqliteControlStore>,
  ids: DeterministicIds,
  goal: Goal,
  workflow: WorkflowInstance,
  policy: PolicyBundle,
  profile: ExecutionProfile,
  phase: typeof WorkflowPhase.DISCOVERY | typeof WorkflowPhase.PLAN,
  sequence: number,
): Readonly<{ attemptId: AttemptId; authority: ProjectSourceReadAuthorityRecord }> {
  assert.equal(workflow.phase, phase);
  const startCommandId = commandId(`command_${namespace}-${phase.toLowerCase()}-start`);
  const manifestId = contextManifestId(`context_${namespace}-${phase.toLowerCase()}`);
  const decision = decideAttempt(workflow, undefined, {
    type: 'BEGIN_ATTEMPT',
    commandId: startCommandId,
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    attemptId: ids.nextAttemptId(),
    sequence,
    contextManifestId: manifestId,
    workerSessionRef: workerSessionId(`worker_${namespace}-${phase.toLowerCase()}`),
    occurredAt: workflow.updatedAt,
  });
  if (!decision.accepted || decision.events[0].type !== 'ATTEMPT_STARTED') {
    assert.fail(`Project-read ${phase} fixture could not start its Attempt`);
  }
  const event = decision.events[0];
  const resultingWorkflow = applyAttemptEvent(workflow, undefined, event).workflow;
  const existingPolicyBinding = store.getWorkflowPolicyBinding(workflow.id);
  const existingProfileBinding = store.getExecutionProfileBinding(workflow.id);
  const policyBinding =
    existingPolicyBinding ??
    decodeWorkflowPolicyBinding({
      schemaVersion: 1,
      goalId: goal.id,
      workflowId: workflow.id,
      policyBundleId: policy.id,
      policyBundleVersion: policy.version,
      policyBundleDigest: policy.digest,
      startCommandId,
      boundAt: event.occurredAt,
      bindingDigest: digests.digest(
        workflowPolicyBindingProjection({
          schemaVersion: 1,
          goalId: goal.id,
          workflowId: workflow.id,
          policyBundleId: policy.id,
          policyBundleVersion: policy.version,
          policyBundleDigest: policy.digest,
          startCommandId,
          boundAt: event.occurredAt,
        }),
      ),
    });
  const executionProfileBinding =
    existingProfileBinding ??
    decodeExecutionProfileBinding({
      schemaVersion: 1,
      goalId: goal.id,
      workflowId: workflow.id,
      profileId: profile.id,
      profileVersion: profile.version,
      profileDigest: profile.digest,
      startCommandId,
      boundAt: event.occurredAt,
      bindingDigest: digests.digest({
        schemaVersion: 1,
        goalId: goal.id,
        workflowId: workflow.id,
        profileId: profile.id,
        profileVersion: profile.version,
        profileDigest: profile.digest,
        startCommandId,
        boundAt: event.occurredAt,
      }),
    });
  const existingProtectedPlan = store.getAcceptanceCriticalVerificationPlan(workflow.id);
  const requiredCriterion = goal.successCriteria.find(({ required }) => required);
  assert.ok(requiredCriterion);
  const protectedAsset = Object.freeze({
    logicalAssetId: `m251-plan-source.${namespace}`,
    registeredProtectedRootIdentity: `/protected/${namespace}`,
    exactRealpath: `/protected/${namespace}/expected.txt`,
    executionPath: `/protected/${namespace}/expected.txt`,
    fileMode: 0o400,
    byteLength: 1,
    contentDigest: digests.digest({ namespace, kind: 'protected-asset' }),
    protectionMode: ProtectedAssetProtectionMode.OUTSIDE_WORKER_WRITABLE_CANDIDATE,
  });
  const protectedAssets = Object.freeze([protectedAsset]);
  const protectedPlan =
    existingProtectedPlan ??
    createAcceptanceCriticalVerificationPlan(
      {
        id: acceptanceCriticalVerificationPlanId(`verification-plan_${namespace}`),
        goal,
        resultingWorkflow,
        policyBundle: policy,
        executionProfile: profile,
        proposal: Object.freeze({
          acceptanceCriticalCriterionIds: Object.freeze([requiredCriterion.id]),
          acceptanceRuleIds: Object.freeze([...policy.acceptanceRules]),
          semanticCheckTemplate: Object.freeze({
            schemaVersion: 1 as const,
            checkVersion: 'm251-plan-source-check-v1',
            producerIdentity: 'm251-plan-source-test-runtime',
            operation: 'local-command.execute',
            runnerIdentity: 'm251-plan-source-test-runner',
            runnerVersion: '1',
            executablePath: '/usr/bin/true',
            executableDigest: digests.digest({ executable: '/usr/bin/true' }),
            declaredToolVersion: 'fixture',
            argv: Object.freeze(['--fixture']),
            cwd: '.',
            environmentVariables: Object.freeze([]),
            isolationProfileId: 'm251-freeze-v2-test-isolation-v1',
            isolationProfileDigest: digests.digest({ namespace, kind: 'protected-isolation' }),
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
        createdAt: event.occurredAt,
      },
      digests,
    );
  if (profile.schemaVersion !== 2 || profile.externalExecution.schemaVersion !== 3) {
    assert.fail('Project-read fixture requires Profile v3');
  }
  const phaseEntry = profile.externalExecution.phaseDispatch.find((entry) => entry.phase === phase);
  assert.ok(phaseEntry);
  const allowedRoot = phaseEntry.allowedRoots[0];
  assert.ok(allowedRoot);
  const sourceTreeFields = Object.freeze({
    schemaVersion: 1 as const,
    profile: PROJECT_READ_SOURCE_TREE_PROFILE,
    entries: Object.freeze([
      Object.freeze({
        schemaVersion: 1 as const,
        path: 'src/payment.ts',
        mode: ProjectReadFileMode.REGULAR,
        size: 1,
        contentDigest: digests.digest({ namespace, kind: 'plan-source' }),
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
    selectedPathSetDigest: digests.digest({ namespace, paths: ['src/payment.ts'] }),
    stagedIndexManifestDigest: digests.digest({ namespace, staged: [] }),
    porcelainV2Digest: digests.digest({ namespace, porcelain: [] }),
  });
  const gitState = Object.freeze({
    ...gitStateFields,
    projectionDigest: digests.digest(projectReadGitStateProjection(gitStateFields)),
  });
  const workspaceRootIdentity = `${allowedRoot}/project-read-${phase.toLowerCase()}`;
  const authorityFields = Object.freeze({
    schemaVersion: 1 as const,
    id: projectSourceReadAuthorityId(`project-read_${namespace}-${phase.toLowerCase()}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    workflowId: workflow.id,
    workflowVersion: resultingWorkflow.version,
    phase,
    attemptId: event.attempt.id,
    normalizedProjectRoot: goal.scope.projectPath,
    resolvedProjectRoot: goal.scope.projectPath,
    repositoryControlRootIdentity: goal.scope.projectPath,
    sourceTree,
    gitState,
    workspaceRootIdentity,
    snapshotId: projectReadSnapshotId(`project-read-snapshot_${namespace}-${phase.toLowerCase()}`),
    snapshotLeafRealpath: `${workspaceRootIdentity}/snapshot`,
    snapshotTreeDigest: sourceTree.projectionDigest,
    ownershipMarkerProfile: PROJECT_READ_OWNERSHIP_MARKER_PROFILE,
    ownershipMarkerDigest: digests.digest({ namespace, phase, kind: 'ownership-marker' }),
    policyBundleId: policy.id,
    policyBundleVersion: policy.version,
    policyBundleDigest: policy.digest,
    executionProfileId: profile.id,
    executionProfileVersion: profile.version,
    executionProfileDigest: profile.digest,
    phaseDispatchEntryDigest: digests.digest(
      externalExecutionPhaseDispatchEntryProjection(phaseEntry),
    ),
    capabilityGrantDigest: digests.digest({
      schemaVersion: 1,
      capabilityGrant: event.attempt.capabilityGrant,
    }),
    responseContractDigest: digests.digest({
      schemaVersion: 1,
      responseContract: m1WorkerResponseContract(phase),
    }),
    accessMode: ProjectReadSnapshotAccessMode.READ_ONLY,
    sourceCheckoutAccess: ProjectReadSourceCheckoutAccess.NONE,
    modelUsableNetworkPolicy: ProjectReadModelUsableNetworkPolicy.DENIED,
    forbiddenRoots: Object.freeze(
      [...new Set([...phaseEntry.forbiddenRoots, goal.scope.projectPath])].toSorted(),
    ),
    isolationProfileId: phaseEntry.isolationProfileId,
    isolationProfileDigest: phaseEntry.isolationProfileDigest,
    issuedAt: event.occurredAt,
    lifecyclePolicy: ProjectReadLifecyclePolicy.SINGLE_WORKER_ATTEMPT,
    retentionPolicy: ProjectReadRetentionPolicy.RUNTIME_OWNED,
    cleanupPolicy: PROJECT_READ_CLEANUP_POLICY,
  });
  const authority = decodeProjectSourceReadAuthorityRecord({
    ...authorityFields,
    recordDigest: digests.digest(projectSourceReadAuthorityProjection(authorityFields)),
  });
  const compilation = new MinimalContextCompiler({
    compilerVersion: 'm2.5.1-plan-source-context-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  }).compile({
    manifestId,
    createdAt: event.occurredAt,
    goal,
    workflow: resultingWorkflow,
    attempt: event.attempt,
    executionProfileId: profile.id,
    executionProfileDigest: profile.digest,
    policyBundleId: policy.id,
    policyBundleDigest: policy.digest,
    protectedPlan: Object.freeze({ id: protectedPlan.id, digest: protectedPlan.planDigest }),
    projectReadAuthority: authority,
  });
  const committed = store.commitContextBoundAttemptStart({
    inputDigest: digests.digest({
      schemaVersion: 1,
      operation: 'PROJECT_READ_START',
      namespace,
      phase,
    }),
    target:
      sequence === 1
        ? Object.freeze({ aggregateType: 'GOAL' as const, aggregateId: goal.id })
        : Object.freeze({ aggregateType: 'WORKFLOW' as const, aggregateId: workflow.id }),
    event,
    auditEventId: ids.nextAuditEventId(),
    workflowAuditEventId: ids.nextAuditEventId(),
    payloadDigest: digests.digest(event),
    contextManifest: compilation.manifest,
    policyBinding,
    ...(existingPolicyBinding === undefined
      ? { policyBindingAuditEventId: ids.nextAuditEventId() }
      : {}),
    executionProfileBinding,
    ...(existingProfileBinding === undefined
      ? { executionProfileBindingAuditEventId: ids.nextAuditEventId() }
      : {}),
    ...(existingProtectedPlan === undefined
      ? {
          acceptanceCriticalVerificationPlan: protectedPlan,
          acceptanceCriticalVerificationPlanAuditEventId: ids.nextAuditEventId(),
        }
      : {}),
    projectReadAuthority: authority,
    projectReadAuthorityAuditEventId: ids.nextAuditEventId(),
  });
  assert.equal(committed.status, 'APPLIED');
  return Object.freeze({ attemptId: event.attempt.id, authority });
}

type FrozenHarness = Readonly<{
  kind: 'FROZEN';
  filename: string;
  store: ReturnType<typeof openSqliteControlStore>;
  goalIdentifier: ReturnType<typeof goalId>;
  workflowIdentifier: ReturnType<typeof workflowId>;
  generationId: CandidateGenerationId;
  freezeAttemptId: AttemptId;
}>;

type PlanSourceMismatchHarness = Readonly<{
  kind: 'PLAN_SOURCE_MISMATCH';
  filename: string;
  store: ReturnType<typeof openSqliteControlStore>;
  goalIdentifier: ReturnType<typeof goalId>;
  workflowIdentifier: ReturnType<typeof workflowId>;
  planAttemptId: AttemptId;
  transitionCommandId: ReturnType<typeof commandId>;
  expectedPlanWorkflowVersion: WorkflowInstance['version'];
  runtime: WorkflowRuntimeKernel;
}>;

function runToFreeze(
  t: TestContext,
  namespace: string,
  fixture: FreezeFixture,
): FrozenHarness | PlanSourceMismatchHarness {
  const filename = temporaryDatabase(t, namespace);
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const ids = new DeterministicIds(namespace);
  const goal = createGoal({
    id: goalId(`goal_${namespace}`),
    revision: goalRevision(1),
    objective: 'Prove stable contained Candidate changes without Fake Worker evidence authority',
    successCriteria: [
      {
        id: successCriterionId(`criterion_${namespace}`),
        description: 'The exact Candidate change set remains inside Runtime-owned allowed paths',
        required: true,
      },
    ],
    scope: { projectPath: `/fixture/${namespace}`, allowedPaths: ['src'] },
    nonGoals: ['No live Codex dispatch', 'No Acceptance decision'],
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId(`workflow_${namespace}`),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  const definition = policyDefinition(namespace);
  const policyInstall = createPolicyInstaller({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids,
    digests,
  }).installPolicyBundle(definition);
  if (policyInstall.status === 'POLICY_CONFLICT') {
    assert.fail(policyInstall.message);
  }
  const policy = decodePolicyBundle({
    ...definition,
    digest: digests.digest(policyBundleProjection(definition)),
  });
  const authority = m251CandidateFreezeV2ProfileFixture(namespace, digests, createdAt);
  assert.equal(
    store.installExternalBackendCapabilityRecord({
      record: authority.capability,
      auditEventId: ids.nextAuditEventId(),
      payloadDigest: authority.capability.recordDigest,
    }).status,
    'INSTALLED',
  );
  const profileInstall = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids,
    digests,
  }).installExecutionProfile(authority.profile);
  assert.equal(profileInstall.status, 'INSTALLED');
  assert.equal(
    store.createGoalWithWorkflow({
      commandId: commandId(`command_${namespace}-create`),
      inputDigest: digests.digest({ type: 'CREATE_M251_FREEZE_V2', namespace }),
      goal,
      workflow,
      auditEventId: ids.nextAuditEventId(),
      workflowAuditEventId: ids.nextAuditEventId(),
      payloadDigest: digests.digest(goalAndWorkflowCreationPayloadProjection(goal, workflow)),
    }).status,
    'APPLIED',
  );

  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm2.5.1-freeze-v2-context-v1',
    maxPackageBytes: 64 * 1024,
    canonicalizer: new Rfc8785Canonicalizer(),
    digests,
  });
  const runtime = new WorkflowRuntimeKernel({
    store,
    clock: monotonicClock(),
    ids,
    digests,
    phaseGuards: genericGuards,
    workerContext: Object.freeze({
      identities: ids,
      executionProfileId: profileInstall.value.profile.id,
      executionProfileDigest: profileInstall.value.profile.digest,
      policyBundleId: policy.id,
      policyBundleDigest: policy.digest,
      factory: Object.freeze({
        compile: (input: AttemptContextCompilationRequest) => compiler.compile(input),
      }),
    }),
    candidateEvidence: Object.freeze({
      identities: ids,
      candidateSource: new M251CandidateFreezeSource(fixture),
      verification: new FakeVerificationRunner(),
      policyBundleId: policy.id,
      policyBundleDigest: policy.digest,
    }),
  });

  let current = store.getWorkflow(workflow.id);
  assert.ok(current);
  commitProjectReadAttempt(
    namespace,
    store,
    ids,
    goal,
    current,
    policy,
    profileInstall.value.profile,
    WorkflowPhase.DISCOVERY,
    1,
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current?.activeAttemptId);
  assert.equal(
    runtime.recordAttemptResult({
      commandId: commandId(`command_${namespace}-discovery-result`),
      workflowId: workflow.id,
      expectedWorkflowVersion: current.version,
      attemptId: current.activeAttemptId,
      reason: 'WORKER_RESULT:PROPOSALS',
    }).status,
    'APPLIED',
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current);
  assert.equal(
    runtime.requestPhaseTransition({
      commandId: commandId(`command_${namespace}-to-plan`),
      workflowId: workflow.id,
      expectedWorkflowVersion: current.version,
      requestedPhase: WorkflowPhase.PLAN,
      reason: 'discovery completed',
    }).status,
    'APPLIED',
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current);
  commitProjectReadAttempt(
    namespace,
    store,
    ids,
    goal,
    current,
    policy,
    profileInstall.value.profile,
    WorkflowPhase.PLAN,
    2,
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current?.activeAttemptId);
  const planAttemptId = current.activeAttemptId;
  assert.equal(
    runtime.recordAttemptResult({
      commandId: commandId(`command_${namespace}-plan-result`),
      workflowId: workflow.id,
      expectedWorkflowVersion: current.version,
      attemptId: current.activeAttemptId,
      reason: 'WORKER_RESULT:PROPOSALS',
    }).status,
    'APPLIED',
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current);
  const expectedPlanWorkflowVersion = current.version;
  const transitionCommandId = commandId(`command_${namespace}-to-implement`);
  const preparation = runtime.requestPhaseTransition({
    commandId: transitionCommandId,
    workflowId: workflow.id,
    expectedWorkflowVersion: current.version,
    requestedPhase: WorkflowPhase.IMPLEMENT,
    reason: 'plan completed',
  });
  assert.equal(preparation.status, 'APPLIED', JSON.stringify(preparation));
  current = store.getWorkflow(workflow.id);
  assert.ok(current);
  if (fixture === 'PLAN_SOURCE_NOT_CURRENT') {
    return Object.freeze({
      kind: 'PLAN_SOURCE_MISMATCH',
      filename,
      store,
      goalIdentifier: goal.id,
      workflowIdentifier: workflow.id,
      planAttemptId,
      transitionCommandId,
      expectedPlanWorkflowVersion,
      runtime,
    });
  }
  const generationId = current.activeCandidateGenerationId;
  assert.ok(generationId);
  const relatedChecks = store
    .listCheckSpecifications()
    .filter((specification) => specification.inputRefs.includes(generationId));
  assert.equal(relatedChecks.length, 1);
  const [freezeCheck] = relatedChecks;
  assert.ok(freezeCheck);
  assert.equal(freezeCheck.kind, CheckSpecificationKind.CANDIDATE_FREEZE);
  assert.equal(
    freezeCheck.expectedObservationSchema,
    'codeclosure.candidate-freeze-observation.v2',
  );
  assert.equal(store.listVerificationObligations(goal.id).length, 0);

  assert.equal(
    runtime.beginAttempt({
      commandId: commandId(`command_${namespace}-implement-start`),
      workflowId: workflow.id,
      expectedWorkflowVersion: current.version,
    }).status,
    'APPLIED',
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current?.activeAttemptId);
  assert.equal(
    runtime.recordAttemptResult({
      commandId: commandId(`command_${namespace}-implement-result`),
      workflowId: workflow.id,
      expectedWorkflowVersion: current.version,
      attemptId: current.activeAttemptId,
      reason: 'WORKER_RESULT:COMPLETION_REQUEST',
    }).status,
    'APPLIED',
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current);
  assert.equal(
    runtime.requestPhaseTransition({
      commandId: commandId(`command_${namespace}-to-freeze`),
      workflowId: workflow.id,
      expectedWorkflowVersion: current.version,
      requestedPhase: WorkflowPhase.SOURCE_FREEZE,
      reason: 'implementation is quiescent',
    }).status,
    'APPLIED',
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current);
  assert.equal(
    runtime.beginAttempt({
      commandId: commandId(`command_${namespace}-freeze-start`),
      workflowId: workflow.id,
      expectedWorkflowVersion: current.version,
    }).status,
    'APPLIED',
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current);
  const freezeAttemptId = current.activeAttemptId;
  assert.ok(freezeAttemptId);
  const completion = runtime.completeSourceFreeze({
    commandId: commandId(`command_${namespace}-freeze-complete`),
    workflowId: workflow.id,
    expectedWorkflowVersion: current.version,
    attemptId: freezeAttemptId,
    reason: 'stable contained Candidate change set observed',
  });
  assert.equal(completion.status, 'APPLIED', JSON.stringify(completion));
  return Object.freeze({
    kind: 'FROZEN',
    filename,
    store,
    goalIdentifier: goal.id,
    workflowIdentifier: workflow.id,
    generationId,
    freezeAttemptId,
  });
}

export function registerM251CandidateFreezeSuccessProof(
  marker: 'freeze-v2-runtime-store-evidence-closure',
): void {
  void test(`[I-005][I-006][I-008][I-009][M251-C11] ${marker} strictly reopens without Fake evidence`, (t) => {
    const harness = runToFreeze(t, 'm251-freeze-v2-success', 'IN_SCOPE');
    if (harness.kind !== 'FROZEN') {
      assert.fail('Freeze-v2 success fixture stopped at PLAN source mismatch');
    }
    const generation = harness.store.getCandidateGeneration(harness.generationId);
    assert.equal(generation?.state, CandidateGenerationState.FROZEN);
    const evidence = harness.store.listEvidenceForGeneration(harness.generationId);
    assert.equal(evidence.length, 1);
    const freeze = evidence[0]?.record;
    assert.equal(freeze?.kind, EvidenceKind.CANDIDATE_FREEZE);
    assert.equal(freeze.schemaVersion, 2);
    assert.equal(freeze.observation.schemaVersion, 2);
    assert.deepEqual(
      freeze.observation.changes.map((change) => change.path),
      ['src/payment.ts'],
    );
    assert.equal(freeze.observation.baseSourceDigest, generation.baseDigest);
    assert.equal(freeze.observation.firstSourceDigest, generation.frozenDigest);
    assert.equal(freeze.observation.secondSourceDigest, generation.frozenDigest);
    assert.equal(harness.store.listVerificationObligations(harness.goalIdentifier).length, 0);

    harness.store.close();
    const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
    t.after(() => reopened.close());
    assert.equal(
      reopened.getCandidateGeneration(harness.generationId)?.state,
      CandidateGenerationState.FROZEN,
    );
    const reopenedEvidence = reopened.listEvidenceForGeneration(harness.generationId);
    assert.equal(reopenedEvidence.length, 1);
    const [reopenedFreeze] = reopenedEvidence;
    assert.ok(reopenedFreeze);
    assert.deepEqual(reopenedFreeze.record, freeze);
  });
}

export function registerM251PlanSourceGuardProof(
  markers: Readonly<{
    sourceCurrencyMarker: 'source-currency-and-plan-candidate-guard';
    planMismatchMarker: 'plan-source-not-current';
  }>,
): void {
  void test(`[I-005][I-006][I-008][I-009][M251-F08][M251-X09] ${markers.sourceCurrencyMarker} retains ${markers.planMismatchMarker} atomically`, (t) => {
    const harness = runToFreeze(t, 'm251-plan-source-not-current', 'PLAN_SOURCE_NOT_CURRENT');
    if (harness.kind !== 'PLAN_SOURCE_MISMATCH') {
      assert.fail('PLAN source mismatch fixture created Candidate authority');
    }

    const assertClosed = (store: typeof harness.store): void => {
      const owner = store.getGoalWithWorkflow(harness.goalIdentifier);
      assert.ok(owner);
      assert.equal(owner.goal.status, GoalStatus.BLOCKED);
      assert.equal(owner.workflow.phase, WorkflowPhase.PLAN);
      assert.equal(owner.workflow.runStatus, RunStatus.FAILED);
      assert.equal(
        owner.workflow.suspendedReason,
        WorkflowIntegrityFailureReasonCode.PLAN_SOURCE_NOT_CURRENT,
      );
      assert.equal(owner.workflow.activeAttemptId, undefined);
      assert.equal(owner.workflow.activeCandidateGenerationId, undefined);
      const planAttempt = store.getAttempt(harness.planAttemptId);
      assert.equal(planAttempt?.phase, WorkflowPhase.PLAN);
      assert.equal(planAttempt.status, AttemptStatus.RESULT_RECORDED);
      assert.equal(planAttempt.terminationReason, 'WORKER_RESULT:PROPOSALS');
      assert.equal(store.getCandidateForGoal(harness.goalIdentifier), undefined);
      assert.equal(store.listCheckSpecifications().length, 0);
      assert.equal(store.listVerificationObligations(harness.goalIdentifier).length, 0);
      assert.equal(
        store.getGoalStatusAuthority(harness.goalIdentifier)?.latestRecoveryReconciliation,
        undefined,
      );
      const processed = store.getProcessedCommand(harness.transitionCommandId);
      assert.ok(processed);
      const outcome = decodeStoredCommandOutcome(processed.outcome);
      assert.equal(outcome.disposition, StoredCommandDisposition.APPLIED);
      assert.equal(outcome.output.ok, true);
      assert.deepEqual(outcome.workflow, {
        id: owner.workflow.id,
        version: owner.workflow.version,
        phase: WorkflowPhase.PLAN,
        runStatus: RunStatus.FAILED,
      });

      const publicApplication = createCodeClosureApplication({
        store,
        clock: Object.freeze({ now: () => createdAt }),
        creationIds: new DeterministicIds('m251-plan-source-status'),
        digests,
        projectPaths: Object.freeze({ parseNormalizedAbsolute: (path: string) => path }),
        execution: Object.freeze({
          startGoal: () => Promise.reject(new Error('Status-only fixture cannot Start')),
          resumeGoal: () => Promise.reject(new Error('Status-only fixture cannot Resume')),
          cancelGoal: () => {
            throw new Error('Status-only fixture cannot Cancel');
          },
        }),
      });
      const status = publicApplication.getGoalStatus(harness.goalIdentifier);
      assert.equal(status.status, 'FOUND');
      assert.equal(status.view.runStatus, RunStatus.FAILED);
      const blocker = status.view.dominantBlocker;
      assert.ok(blocker);
      assert.equal(blocker.code, GoalDominantBlockerCode.WORKFLOW_FAILED);
      assert.equal(blocker.detailCode, WorkflowIntegrityFailureReasonCode.PLAN_SOURCE_NOT_CURRENT);
      assert.equal(status.view.nextSafeAction, GoalNextSafeAction.INSPECT_BLOCKER);
    };

    assertClosed(harness.store);
    const replay = harness.runtime.requestPhaseTransition({
      commandId: harness.transitionCommandId,
      workflowId: harness.workflowIdentifier,
      expectedWorkflowVersion: harness.expectedPlanWorkflowVersion,
      requestedPhase: WorkflowPhase.IMPLEMENT,
      reason: 'plan completed',
    });
    assert.equal(replay.status, 'REPLAYED');
    assertClosed(harness.store);

    harness.store.close();
    const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
    t.after(() => reopened.close());
    assertClosed(reopened);
  });
}

export function registerM251CandidateContainmentFailureProofs(): void {
  void test('[I-006][I-009][I-027] reserved M2.5.1 Profile identity fails closed instead of selecting historical authority', (t) => {
    const filename = temporaryDatabase(t, 'm251-profile-mismatch');
    const store = openSqliteControlStore({ filename, now: () => createdAt });
    const ids = new DeterministicIds('m251-profile-mismatch');
    const authority = m251CandidateFreezeV2ProfileFixture(
      'm251-profile-mismatch',
      digests,
      createdAt,
    );
    assert.equal(
      store.installExternalBackendCapabilityRecord({
        record: authority.capability,
        auditEventId: ids.nextAuditEventId(),
        payloadDigest: authority.capability.recordDigest,
      }).status,
      'INSTALLED',
    );
    const installer = createExecutionProfileInstaller({
      store,
      clock: Object.freeze({ now: () => createdAt }),
      ids,
      digests,
    });
    const incompatibleDefinition = Object.freeze({
      ...authority.profile,
      candidateSourceVersion: 'candidate-freeze-v1',
    });
    const rejected = installer.installExecutionProfile(incompatibleDefinition);
    assert.equal(rejected.status, 'PROFILE_CONFLICT');
    assert.match(rejected.message, /reserved M2\.5\.1 identity/u);
    assert.equal(store.getExecutionProfile(authority.profile.id), undefined);

    const installed = installer.installExecutionProfile(authority.profile);
    assert.equal(installed.status, 'INSTALLED');
    store.close();

    const incompatibleDigest = digests.digest(executionProfileProjection(incompatibleDefinition));
    const database = new Database(filename, { fileMustExist: true });
    try {
      database.exec('DROP TRIGGER execution_profiles_no_update');
      database.exec('DROP TRIGGER audit_events_no_update');
      const row = database
        .prepare('SELECT canonical_content_json FROM execution_profiles WHERE id = ?')
        .get(authority.profile.id) as { canonical_content_json: string } | undefined;
      assert.ok(row !== undefined);
      const canonicalContent = JSON.parse(row.canonical_content_json) as Record<string, unknown>;
      canonicalContent['candidateSourceVersion'] = incompatibleDefinition.candidateSourceVersion;
      database
        .prepare(
          `UPDATE execution_profiles
            SET canonical_content_json = ?, profile_digest = ?
          WHERE id = ?`,
        )
        .run(JSON.stringify(canonicalContent), incompatibleDigest, authority.profile.id);
      database
        .prepare(
          `UPDATE audit_events
            SET payload_digest = ?
          WHERE aggregate_type = 'EXECUTION_PROFILE'
            AND aggregate_id = ?
            AND event_type = 'EXECUTION_PROFILE_INSTALLED'`,
        )
        .run(incompatibleDigest, authority.profile.id);
    } finally {
      database.close();
    }
    assert.throws(
      () => openSqliteControlStore({ filename, now: () => createdAt }),
      /reserved M2\.5\.1 identity/u,
    );
  });

  void test('[I-005][I-008][I-009] freeze-v2 failures close atomically and strictly reopen', async (t) => {
    const cases = [
      {
        fixture: 'OUT_OF_SCOPE',
        failureClass: AttemptFailureClass.INTEGRITY_VIOLATION,
        reason: 'CANDIDATE_CHANGE_OUTSIDE_ALLOWED_PATHS',
      },
      {
        fixture: 'BASE_NOT_CURRENT',
        failureClass: AttemptFailureClass.INTEGRITY_VIOLATION,
        reason: 'CANDIDATE_FREEZE_BASE_NOT_CURRENT',
      },
      {
        fixture: 'UNSTABLE',
        failureClass: AttemptFailureClass.INTEGRITY_VIOLATION,
        reason: 'SOURCE_CHANGED_DURING_FREEZE',
      },
      {
        fixture: 'EMPTY',
        failureClass: AttemptFailureClass.INTEGRITY_VIOLATION,
        reason: 'CANDIDATE_CHANGE_SET_EMPTY',
      },
      {
        fixture: 'DIGEST_SUBSTITUTION',
        failureClass: AttemptFailureClass.PROTOCOL_ERROR,
        reason: CandidateSourceFailureCode.FREEZE_OUTPUT_MALFORMED,
      },
      {
        fixture: 'BINDING_MISMATCH',
        failureClass: AttemptFailureClass.PROTOCOL_ERROR,
        reason: CandidateSourceFailureCode.FREEZE_BINDING_MISMATCH,
      },
    ] as const satisfies readonly {
      readonly fixture: Exclude<FreezeFixture, 'IN_SCOPE' | 'PLAN_SOURCE_NOT_CURRENT'>;
      readonly failureClass: AttemptFailureClass;
      readonly reason: string;
    }[];

    for (const entry of cases) {
      await t.test(entry.fixture, (fixtureTest) => {
        const namespace = `m251-freeze-v2-${entry.fixture.toLowerCase().replaceAll('_', '-')}`;
        const harness = runToFreeze(fixtureTest, namespace, entry.fixture);
        if (harness.kind !== 'FROZEN') {
          assert.fail('Freeze failure fixture stopped at PLAN source mismatch');
        }
        const assertClosed = (store: typeof harness.store): void => {
          const generation = store.getCandidateGeneration(harness.generationId);
          assert.equal(generation?.state, CandidateGenerationState.INVALIDATED);
          assert.equal(generation.invalidationReason, entry.reason);
          const attempt = store.getAttempt(harness.freezeAttemptId);
          assert.equal(attempt?.status, AttemptStatus.FAILED);
          assert.equal(attempt.failureClass, entry.failureClass);
          assert.equal(attempt.terminationReason, entry.reason);
          const workflow = store.getWorkflow(harness.workflowIdentifier);
          assert.equal(workflow?.phase, WorkflowPhase.SOURCE_FREEZE);
          assert.equal(workflow.runStatus, RunStatus.FAILED);
          assert.equal(workflow.activeAttemptId, undefined);
          assert.equal(store.listEvidenceForGeneration(harness.generationId).length, 0);
          assert.equal(store.listVerificationObligations(harness.goalIdentifier).length, 0);
        };

        assertClosed(harness.store);
        harness.store.close();
        const reopened = openSqliteControlStore({
          filename: harness.filename,
          now: () => createdAt,
        });
        fixtureTest.after(() => reopened.close());
        assertClosed(reopened);
      });
    }
  });
}
