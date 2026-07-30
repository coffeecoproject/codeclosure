import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  CandidateGenerationState,
  ContextEntryKind,
  EvidenceEligibilityState,
  EvidenceKind,
  GuardOutcome,
  WorkflowGuard,
  WorkflowPhase,
  commandId,
  createGoal,
  createWorkflow,
  decodePolicyBundle,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  requiredGuardsForTransition,
  successCriterionId,
  workflowId,
  type PolicyBundleDefinition,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  createExecutionProfileInstaller,
  createPolicyInstaller,
  type Clock,
} from '@codeclosure/runtime';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';
import {
  DeterministicIds,
  FakeCandidateSource,
  FakeVerificationRunner,
  testExecutionProfileDefinition,
} from '@codeclosure/testing';
import {
  WorkflowRuntimeKernel,
  type AttemptContextCompilationRequest,
  type PhaseGuardEvaluator,
} from '@codeclosure/runtime/testing/workflow-runtime';

const createdAt = isoTimestamp('2026-07-27T00:00:00.000Z');
const digests = new CanonicalJsonSha256DigestProvider();

function temporaryDatabase(t: TestContext): string {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-candidate-evidence-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return join(directory, 'control.sqlite');
}

function monotonicClock(): Clock {
  let milliseconds = 1;
  return Object.freeze({
    now: () => {
      const value = isoTimestamp(`2026-07-27T00:00:00.${String(milliseconds).padStart(3, '0')}Z`);
      milliseconds += 1;
      return value;
    },
  });
}

function policyDefinition(): PolicyBundleDefinition {
  return Object.freeze({
    id: policyBundleId('policy_m1-candidate-evidence'),
    schemaVersion: 1,
    version: 'm1-candidate-evidence-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['source-bound-candidate-context']),
    checkSpecifications: Object.freeze(['runtime-owned-check-specifications']),
    applicabilityRules: Object.freeze(['exact-candidate-and-policy']),
    acceptanceRules: Object.freeze(['slice-6-only']),
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
  WorkflowGuard.INTEGRITY_POLICY_PASSED,
  WorkflowGuard.REQUIRED_EVIDENCE_ACCOUNTED,
  WorkflowGuard.EVIDENCE_BINDINGS_CURRENT,
  WorkflowGuard.CLEANUP_PROVEN,
  WorkflowGuard.SOURCE_DIGEST_CURRENT,
  WorkflowGuard.CURRENT_ACCEPTANCE,
  WorkflowGuard.REJECT_REPAIRABLE_RECORDED,
]);

const genericGuards: PhaseGuardEvaluator = Object.freeze({
  evaluate: (input: Parameters<PhaseGuardEvaluator['evaluate']>[0]) => {
    const { workflow, requestedPhase } = input;
    return Object.freeze(
      (requiredGuardsForTransition(workflow.phase, requestedPhase) ?? [])
        .filter((guard) => !reserved.has(guard))
        .map((guard) =>
          Object.freeze({
            guard,
            outcome: GuardOutcome.PASS,
            reasonCode: 'FIXTURE_GENERIC_GUARD',
            supportingRefs: Object.freeze([`fixture:${guard}`]),
          }),
        ),
    );
  },
});

void test('[I-005][I-008][I-009][I-012][I-015] Candidate and Evidence authority closes end to end and reopens', (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename, now: () => createdAt });
  const ids = new DeterministicIds('candidate-e2e');
  const goal = createGoal({
    id: goalId('goal_candidate-e2e'),
    revision: goalRevision(1),
    objective: 'Prove Candidate and Evidence authority without model behavior',
    successCriteria: [
      {
        id: successCriterionId('criterion_candidate-e2e'),
        description: 'The exact frozen Candidate has current verification Evidence',
        required: true,
      },
    ],
    scope: { projectPath: '/fixture/candidate-e2e', allowedPaths: ['src/**'] },
    nonGoals: ['No real source checkout', 'No Acceptance decision'],
    createdAt,
  });
  const initialWorkflow = createWorkflow({
    id: workflowId('workflow_candidate-e2e'),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  const definition = policyDefinition();
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
  assert.equal(policyInstall.value.bundle.digest, policy.digest);
  const profileInstall = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids,
    digests,
  }).installExecutionProfile(testExecutionProfileDefinition('candidate-e2e'));
  if (profileInstall.status === 'PROFILE_CONFLICT') {
    assert.fail(profileInstall.message);
  }
  const profile = profileInstall.value.profile;
  const creation = store.createGoalWithWorkflow({
    commandId: commandId('command_candidate-e2e-create'),
    inputDigest: digests.digest({ type: 'CREATE_CANDIDATE_E2E' }),
    goal,
    workflow: initialWorkflow,
    auditEventId: ids.nextAuditEventId(),
    workflowAuditEventId: ids.nextAuditEventId(),
    payloadDigest: digests.digest({ goal, workflow: initialWorkflow }),
  });
  assert.equal(creation.status, 'APPLIED');

  const compiler = new MinimalContextCompiler({
    compilerVersion: 'm1-context-compiler-v1',
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
      executionProfileId: profile.id,
      executionProfileDigest: profile.digest,
      policyBundleId: policy.id,
      policyBundleDigest: policy.digest,
      factory: Object.freeze({
        compile: (input: AttemptContextCompilationRequest) => compiler.compile(input),
      }),
    }),
    candidateEvidence: Object.freeze({
      identities: ids,
      candidateSource: new FakeCandidateSource(),
      verification: new FakeVerificationRunner(),
      policyBundleId: policy.id,
      policyBundleDigest: policy.digest,
    }),
  });

  let workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow);
  const start = runtime.startGoal({
    commandId: commandId('command_candidate-e2e-start'),
    goalId: goal.id,
    expectedGoalRevision: goal.revision,
    expectedWorkflowVersion: workflow.version,
  });
  assert.equal(start.status, 'APPLIED');
  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow?.activeAttemptId);
  assert.equal(
    runtime.recordAttemptResult({
      commandId: commandId('command_candidate-e2e-discovery-result'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: workflow.activeAttemptId,
      reason: 'WORKER_RESULT:PROPOSALS',
    }).status,
    'APPLIED',
  );

  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow);
  assert.equal(
    runtime.requestPhaseTransition({
      commandId: commandId('command_candidate-e2e-to-plan'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.PLAN,
      reason: 'discovery guards passed',
    }).status,
    'APPLIED',
  );
  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow);
  assert.equal(
    runtime.beginAttempt({
      commandId: commandId('command_candidate-e2e-plan-start'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }).status,
    'APPLIED',
  );
  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow?.activeAttemptId);
  assert.equal(
    runtime.recordAttemptResult({
      commandId: commandId('command_candidate-e2e-plan-result'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: workflow.activeAttemptId,
      reason: 'WORKER_RESULT:PROPOSALS',
    }).status,
    'APPLIED',
  );

  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow);
  const preparation = runtime.requestPhaseTransition({
    commandId: commandId('command_candidate-e2e-to-implement'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    requestedPhase: WorkflowPhase.IMPLEMENT,
    reason: 'plan guards and Candidate preparation passed',
  });
  assert.equal(preparation.status, 'APPLIED');
  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow?.activeCandidateGenerationId);
  const generationId = workflow.activeCandidateGenerationId;
  assert.equal(store.getCandidateGeneration(generationId)?.state, CandidateGenerationState.MUTABLE);
  assert.equal(store.listVerificationObligations(goal.id).length, 1);

  assert.equal(
    runtime.beginAttempt({
      commandId: commandId('command_candidate-e2e-implement-start'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }).status,
    'APPLIED',
  );
  const implementRequest = runtime.takePreparedWorkerRequest(
    store.getWorkflow(initialWorkflow.id)?.activeAttemptId ?? ids.nextAttemptId(),
  );
  assert.ok(implementRequest);
  assert.equal(implementRequest.contextPackage.candidateGenerationId, generationId);
  assert.equal(
    implementRequest.contextPackage.candidateDigest,
    store.getCandidateGeneration(generationId)?.baseDigest,
  );
  const candidateEntries = implementRequest.contextPackage.candidateGenerationId
    ? store
        .getContextManifest(implementRequest.contextManifestId)
        ?.entries.filter((entry) => entry.kind === ContextEntryKind.CANDIDATE)
    : undefined;
  assert.equal(candidateEntries?.length, 1);

  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow?.activeAttemptId);
  assert.equal(
    runtime.recordAttemptResult({
      commandId: commandId('command_candidate-e2e-implement-result'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: workflow.activeAttemptId,
      reason: 'WORKER_RESULT:COMPLETION_REQUEST',
    }).status,
    'APPLIED',
  );
  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow);
  assert.equal(
    runtime.requestPhaseTransition({
      commandId: commandId('command_candidate-e2e-to-freeze'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.SOURCE_FREEZE,
      reason: 'implementation is quiescent',
    }).status,
    'APPLIED',
  );
  assert.equal(
    store.getCandidateGeneration(generationId)?.state,
    CandidateGenerationState.FREEZING,
  );

  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow);
  assert.equal(
    runtime.beginAttempt({
      commandId: commandId('command_candidate-e2e-freeze-start'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }).status,
    'APPLIED',
  );
  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow?.activeAttemptId);
  assert.equal(runtime.takePreparedWorkerRequest(workflow.activeAttemptId), undefined);
  const freezeCompletion = runtime.completeSourceFreeze({
    commandId: commandId('command_candidate-e2e-freeze-complete'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    attemptId: workflow.activeAttemptId,
    reason: 'two source observations completed',
  });
  assert.equal(freezeCompletion.status, 'APPLIED', JSON.stringify(freezeCompletion));
  const frozen = store.getCandidateGeneration(generationId);
  assert.equal(frozen?.state, CandidateGenerationState.FROZEN);
  const freezeEvidence = store
    .listEvidenceForGeneration(generationId)
    .find(({ record }) => record.kind === EvidenceKind.CANDIDATE_FREEZE);
  assert.equal(freezeEvidence?.eligibility.state, EvidenceEligibilityState.ELIGIBLE);

  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow);
  assert.equal(
    runtime.requestPhaseTransition({
      commandId: commandId('command_candidate-e2e-to-evidence'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.EVIDENCE_BUILD,
      reason: 'freeze authority is complete',
    }).status,
    'APPLIED',
  );
  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow);
  assert.equal(
    runtime.beginAttempt({
      commandId: commandId('command_candidate-e2e-verification-start'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }).status,
    'APPLIED',
  );
  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow?.activeAttemptId);
  assert.equal(runtime.takePreparedWorkerRequest(workflow.activeAttemptId), undefined);
  const obligation = store.listVerificationObligations(goal.id)[0];
  assert.ok(obligation);
  assert.equal(
    runtime.runVerification({
      commandId: commandId('command_candidate-e2e-verification-complete'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: workflow.activeAttemptId,
      obligationId: obligation.id,
      reason: 'fake verification observation recorded',
    }).status,
    'APPLIED',
  );

  workflow = store.getWorkflow(initialWorkflow.id);
  assert.ok(workflow);
  assert.equal(
    runtime.requestPhaseTransition({
      commandId: commandId('command_candidate-e2e-to-final'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.FINAL_VERIFY,
      reason: 'Evidence Set is complete and current',
    }).status,
    'APPLIED',
  );
  workflow = store.getWorkflow(initialWorkflow.id);
  assert.equal(workflow?.phase, WorkflowPhase.FINAL_VERIFY);
  const evidence = store.listEvidenceForGeneration(generationId);
  assert.equal(evidence.length, 2);
  assert.equal(evidence.filter(({ record }) => record.kind === EvidenceKind.TEST_RESULT).length, 1);

  store.close();
  const reopened = openSqliteControlStore({ filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(initialWorkflow.id)?.phase, WorkflowPhase.FINAL_VERIFY);
  assert.equal(
    reopened.getCandidateGeneration(generationId)?.state,
    CandidateGenerationState.FROZEN,
  );
  assert.equal(reopened.listEvidenceForGeneration(generationId).length, 2);
});
