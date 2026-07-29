import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import Database from 'better-sqlite3';

import {
  AcceptanceOutcome,
  AttemptFailureClass,
  AttemptStatus,
  CandidateGenerationState,
  EvidenceEligibilityState,
  EvidenceKind,
  GuardOutcome,
  RunStatus,
  RecoveryReasonCode,
  RecoveryReconciliationDisposition,
  WorkflowGuard,
  WorkflowPhase,
  candidateGenerationId,
  acceptanceDecisionProjection,
  acceptanceDecisionId,
  checkSpecificationId,
  commandId,
  createCandidate,
  createCandidateGeneration,
  createInitialEvidenceEligibility,
  createGoal,
  createWorkflow,
  decodeAcceptanceDecision,
  decodeEvidenceSet,
  decodeCheckSpecification,
  decodePolicyBundle,
  decideCandidate,
  decideAttempt,
  decideWorkflow,
  goalId,
  goalRevision,
  evidenceSetDigestProjection,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  requiredGuardsForTransition,
  successCriterionId,
  sha256Digest,
  verificationObligationId,
  workflowId,
  type AttemptId,
  type CandidateGenerationId,
  type PolicyBundleDefinition,
  type VerificationObligationId,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  CandidateSourceFailureCode,
  GoalNextSafeAction,
  M1_ACCEPTANCE_RULES,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  VerificationResultAdmissionFailureCode,
  buildEvidenceSet,
  compileM1AcceptanceInput,
  createTestResultEvidenceRecord,
  createM1CandidateEvidencePolicy,
  createM1AcceptanceCheckerIdentity,
  createExecutionProfileInstaller,
  createCodeClosureApplication,
  createPolicyInstaller,
  deriveM1BaseProjectIdentity,
  deriveM1WorkspaceIdentity,
  verifyEvidenceSetAuthority,
  type Clock,
} from '@codeclosure/runtime';
import { createRecoveryCoordinator } from '@codeclosure/runtime/composition';
import {
  AcceptanceTransactionStep,
  CandidateEvidenceTransactionStep,
  TransactionStep,
  defaultMigrationsDirectory,
  openSqliteControlStore,
  type SqliteControlStore,
} from '@codeclosure/store-sqlite';
import {
  DeterministicIds,
  FakeCandidateSource,
  FakeCandidateSourceFixture,
  FakeRecoveryInspectionMode,
  FakeRecoveryInspector,
  FakeVerificationFixture,
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

const reservedGuards = new Set<WorkflowGuard>([
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
  evaluate: ({
    workflow,
    requestedPhase,
  }: {
    readonly workflow: WorkflowInstance;
    readonly requestedPhase: WorkflowInstance['phase'];
  }) =>
    Object.freeze(
      (requiredGuardsForTransition(workflow.phase, requestedPhase) ?? [])
        .filter((guard) => !reservedGuards.has(guard))
        .map((guard) =>
          Object.freeze({
            guard,
            outcome: GuardOutcome.PASS,
            reasonCode: 'ADVERSARIAL_FIXTURE_GENERIC_GUARD',
            supportingRefs: Object.freeze([`fixture:${guard}`]),
          }),
        ),
    ),
});

interface Harness {
  readonly filename: string;
  readonly store: SqliteControlStore;
  readonly runtime: WorkflowRuntimeKernel;
  readonly candidateSource: FakeCandidateSource;
  readonly ids: DeterministicIds;
  readonly goalId: ReturnType<typeof goalId>;
  readonly workflowId: ReturnType<typeof workflowId>;
  readonly name: string;
}

function monotonicClock(): Clock {
  let milliseconds = 1;
  return Object.freeze({
    now: () => {
      const timestamp = isoTimestamp(
        `2026-07-27T00:00:00.${String(milliseconds).padStart(3, '0')}Z`,
      );
      milliseconds += 1;
      return timestamp;
    },
  });
}

function policyDefinition(name: string): PolicyBundleDefinition {
  return Object.freeze({
    id: policyBundleId(`policy_${name}`),
    schemaVersion: 1,
    version: 'm1-candidate-evidence-v1',
    transitionRules: Object.freeze(['workflow-runtime-only']),
    capabilityRules: Object.freeze(['phase-derived-capabilities']),
    contextRules: Object.freeze(['source-bound-candidate-context']),
    checkSpecifications: Object.freeze(['runtime-owned-check-specifications']),
    applicabilityRules: Object.freeze(['exact-candidate-and-policy']),
    acceptanceRules: M1_ACCEPTANCE_RULES,
    checkerVersions: Object.freeze([createM1AcceptanceCheckerIdentity(digests)]),
  });
}

function createHarness(
  t: TestContext,
  options: {
    readonly name: string;
    readonly sourceFixture?: FakeCandidateSourceFixture;
    readonly verificationFixture?: FakeVerificationFixture;
    readonly transactionProbe?: (step: string) => void;
    readonly migrationsDirectory?: string;
  },
): Harness {
  const namespace = options.name.replaceAll('_', '-');
  const directory = mkdtempSync(join(tmpdir(), `codeclosure-${options.name}-`));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const filename = join(directory, 'control.sqlite');
  const store = openSqliteControlStore({
    filename,
    now: () => createdAt,
    ...(options.migrationsDirectory === undefined
      ? {}
      : { migrationsDirectory: options.migrationsDirectory }),
    ...(options.transactionProbe === undefined
      ? {}
      : { transactionProbe: options.transactionProbe }),
  });
  t.after(() => store.close());
  const ids = new DeterministicIds(namespace);
  const goalIdentifier = goalId(`goal_${namespace}`);
  const workflowIdentifier = workflowId(`workflow_${namespace}`);
  const goal = createGoal({
    id: goalIdentifier,
    revision: goalRevision(1),
    objective: `Exercise ${options.name} Candidate and Evidence authority`,
    successCriteria: [
      {
        id: successCriterionId(`criterion_${namespace}`),
        description: 'The exact frozen Candidate has current verification Evidence',
        required: true,
      },
    ],
    scope: {
      projectPath: `/fixture/${options.name}`,
      allowedPaths: Object.freeze(['src/**']),
    },
    nonGoals: Object.freeze(['No real source checkout', 'No Acceptance decision']),
    createdAt,
  });
  const initialWorkflow = createWorkflow({
    id: workflowIdentifier,
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
  const profileInstall = createExecutionProfileInstaller({
    store,
    clock: Object.freeze({ now: () => createdAt }),
    ids,
    digests,
  }).installExecutionProfile(testExecutionProfileDefinition(namespace));
  if (profileInstall.status === 'PROFILE_CONFLICT') {
    assert.fail(profileInstall.message);
  }
  const profile = profileInstall.value.profile;
  const creation = store.createGoalWithWorkflow({
    commandId: commandId(`command_${namespace}-create`),
    inputDigest: digests.digest({ type: 'CREATE_ADVERSARIAL_HARNESS', name: options.name }),
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
  const candidateSource = new FakeCandidateSource(
    options.sourceFixture ?? FakeCandidateSourceFixture.STABLE,
  );
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
      candidateSource,
      verification: new FakeVerificationRunner({
        fixture: options.verificationFixture ?? FakeVerificationFixture.PASS,
      }),
      policyBundleId: policy.id,
      policyBundleDigest: policy.digest,
    }),
    acceptance: Object.freeze({
      identities: ids,
      policyBundleId: policy.id,
      policyBundleDigest: policy.digest,
    }),
  });
  return Object.freeze({
    filename,
    store,
    runtime,
    candidateSource,
    ids,
    goalId: goalIdentifier,
    workflowId: workflowIdentifier,
    name: namespace,
  });
}

function harnessCommand(harness: Harness, label: string): ReturnType<typeof commandId> {
  return commandId(`command_${harness.name}-${label.replaceAll('_', '-')}`);
}

function currentWorkflow(harness: Harness): WorkflowInstance {
  const workflow = harness.store.getWorkflow(harness.workflowId);
  assert.ok(workflow);
  return workflow;
}

function appendOfflineFrozenTerminalTransition(
  filename: string,
  generationIdentifier: CandidateGenerationId,
  toState: typeof CandidateGenerationState.ACCEPTED | typeof CandidateGenerationState.REJECTED,
  namespace: string,
): void {
  const raw = new Database(filename);
  try {
    const row = raw
      .prepare('SELECT version FROM candidate_generations WHERE id = ?')
      .get(generationIdentifier);
    const rawVersion: unknown = Reflect.get(row ?? {}, 'version');
    if (typeof rawVersion !== 'number') {
      assert.fail('Candidate generation version must be retained as a number');
    }
    const fromVersion = rawVersion;
    const toVersion = fromVersion + 1;
    const occurredAt = isoTimestamp('2026-07-27T00:10:00.000Z');
    raw.transaction(() => {
      raw
        .prepare(
          `INSERT INTO audit_events(
             id, aggregate_type, aggregate_id, event_type, actor_type, command_id,
             before_version, after_version, payload_digest, occurred_at
           ) VALUES (?, 'CANDIDATE_GENERATION', ?, 'CANDIDATE_STATE_CHANGED',
                     'RUNTIME', ?, ?, ?, ?, ?)`,
        )
        .run(
          `audit_${namespace}`,
          generationIdentifier,
          `command_${namespace}`,
          fromVersion,
          toVersion,
          digests.digest({ namespace, toState }),
          occurredAt,
        );
      raw
        .prepare(
          `UPDATE candidate_generations
              SET state = ?, version = ?, updated_at = ?
            WHERE id = ?`,
        )
        .run(toState, toVersion, occurredAt, generationIdentifier);
    })();
  } finally {
    raw.close();
  }
}

function insertLegacyTerminalCandidate(
  filename: string,
  toState: typeof CandidateGenerationState.ACCEPTED | typeof CandidateGenerationState.REJECTED,
  namespace: string,
): CandidateGenerationId {
  const generationIdentifier = candidateGenerationId(`generation_${namespace}`);
  const candidateIdentifier = `candidate_${namespace}`;
  const raw = new Database(filename);
  try {
    raw.pragma('foreign_keys = OFF');
    raw.exec('DROP TRIGGER candidate_generations_authority_insert_guard');
    raw.exec('DROP TRIGGER candidate_generations_slice5_insert_guard');
    const frozenDigest = digests.digest({ namespace, type: 'LEGACY_FROZEN_CANDIDATE' });
    raw
      .prepare(
        `INSERT INTO candidate_generations(
           id, candidate_id, workflow_id, sequence, parent_generation_id,
           workspace_identity, state, base_digest, frozen_digest,
           invalidation_reason, version, created_at, updated_at, frozen_at
         ) VALUES (?, ?, ?, 1, NULL, ?, ?, ?, ?, NULL, 4, ?, ?, ?)`,
      )
      .run(
        generationIdentifier,
        candidateIdentifier,
        `workflow_${namespace}`,
        `m1-workspace:${generationIdentifier}`,
        toState,
        frozenDigest,
        frozenDigest,
        createdAt,
        createdAt,
        createdAt,
      );
  } finally {
    raw.close();
  }
  return generationIdentifier;
}

function assertSensitiveMarkerNotPersisted(harness: Harness): void {
  const inspected = new Database(harness.filename, { readonly: true, fileMustExist: true });
  try {
    const authorityText = JSON.stringify(
      inspected
        .prepare(
          `SELECT termination_reason AS value FROM attempts
           UNION ALL SELECT invalidation_reason FROM candidate_generations
           UNION ALL SELECT suspended_reason FROM workflows
           UNION ALL SELECT observation_json FROM evidence_records
           UNION ALL SELECT payload_refs_json FROM evidence_records
           UNION ALL SELECT outcome_json FROM processed_commands`,
        )
        .all(),
    );
    assert.equal(authorityText.includes('token=demo-sensitive-value'), false);
  } finally {
    inspected.close();
  }
}

function assertApplied(result: { readonly status: string }): void {
  assert.equal(result.status, 'APPLIED', JSON.stringify(result));
}

function finishActiveAttempt(harness: Harness, label: string): void {
  const workflow = currentWorkflow(harness);
  assert.ok(workflow.activeAttemptId);
  assertApplied(
    harness.runtime.recordAttemptResult({
      commandId: harnessCommand(harness, label),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: workflow.activeAttemptId,
      reason: `${label} fixture complete`,
    }),
  );
}

function advanceToReadyPlan(harness: Harness): WorkflowInstance {
  let workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.startGoal({
      commandId: harnessCommand(harness, 'start'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: workflow.version,
    }),
  );
  finishActiveAttempt(harness, 'discovery_result');

  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, 'to-plan'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.PLAN,
      reason: 'discovery guards passed',
    }),
  );
  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.beginAttempt({
      commandId: harnessCommand(harness, 'plan-start'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }),
  );
  finishActiveAttempt(harness, 'plan_result');

  return currentWorkflow(harness);
}

function advanceToFreezeAttempt(harness: Harness): {
  readonly generationId: CandidateGenerationId;
  readonly attemptId: AttemptId;
} {
  let workflow = advanceToReadyPlan(harness);

  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, 'to-implement'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.IMPLEMENT,
      reason: 'plan guards and Candidate preparation passed',
    }),
  );
  workflow = currentWorkflow(harness);
  assert.ok(workflow.activeCandidateGenerationId);
  const generationId = workflow.activeCandidateGenerationId;
  assertApplied(
    harness.runtime.beginAttempt({
      commandId: harnessCommand(harness, 'implement-start'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }),
  );
  finishActiveAttempt(harness, 'implement_result');

  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, 'to-freeze'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.SOURCE_FREEZE,
      reason: 'implementation is quiescent',
    }),
  );
  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.beginAttempt({
      commandId: harnessCommand(harness, 'freeze-start'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }),
  );
  workflow = currentWorkflow(harness);
  assert.ok(workflow.activeAttemptId);
  return Object.freeze({ generationId, attemptId: workflow.activeAttemptId });
}

function completeStableFreezeAndEnterEvidence(harness: Harness): CandidateGenerationId {
  const freeze = advanceToFreezeAttempt(harness);
  let workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.completeSourceFreeze({
      commandId: harnessCommand(harness, 'freeze-complete'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: freeze.attemptId,
      reason: 'two source observations completed',
    }),
  );
  assert.equal(
    harness.store.getCandidateGeneration(freeze.generationId)?.state,
    CandidateGenerationState.FROZEN,
  );
  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, 'to-evidence'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.EVIDENCE_BUILD,
      reason: 'freeze authority is complete',
    }),
  );
  return freeze.generationId;
}

function runVerification(harness: Harness, suffix = ''): AttemptId {
  const started = beginVerification(harness, suffix);
  assertApplied(
    harness.runtime.runVerification({
      commandId: started.completionCommandId,
      workflowId: started.workflow.id,
      expectedWorkflowVersion: started.workflow.version,
      attemptId: started.attemptId,
      obligationId: started.obligationId,
      reason: 'fake verification observation handled',
    }),
  );
  return started.attemptId;
}

function beginVerification(
  harness: Harness,
  suffix = '',
): {
  readonly workflow: WorkflowInstance;
  readonly attemptId: AttemptId;
  readonly obligationId: VerificationObligationId;
  readonly completionCommandId: ReturnType<typeof commandId>;
} {
  const label = (base: string): string => (suffix.length === 0 ? base : `${base}-${suffix}`);
  let workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.beginAttempt({
      commandId: harnessCommand(harness, label('verification-start')),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }),
  );
  workflow = currentWorkflow(harness);
  assert.ok(workflow.activeAttemptId);
  const attemptIdentifier = workflow.activeAttemptId;
  const obligation = harness.store.listVerificationObligations(harness.goalId)[0];
  assert.ok(obligation);
  return Object.freeze({
    workflow,
    attemptId: attemptIdentifier,
    obligationId: obligation.id,
    completionCommandId: harnessCommand(harness, label('verification-complete')),
  });
}

function advanceToFinalVerify(harness: Harness): {
  readonly workflow: WorkflowInstance;
  readonly generationId: CandidateGenerationId;
} {
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness);
  const beforeFinal = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, 'to-final-verify'),
      workflowId: beforeFinal.id,
      expectedWorkflowVersion: beforeFinal.version,
      requestedPhase: WorkflowPhase.FINAL_VERIFY,
      reason: 'canonical Evidence Set is complete',
    }),
  );
  const workflow = currentWorkflow(harness);
  assert.equal(workflow.phase, WorkflowPhase.FINAL_VERIFY);
  return Object.freeze({ workflow, generationId });
}

function advanceRepairChildToFinalVerify(
  harness: Harness,
  label: string,
): {
  readonly workflow: WorkflowInstance;
  readonly generationId: CandidateGenerationId;
} {
  const commandLabel = (stage: string): string => `repair-${label}-${stage}`;
  let workflow = currentWorkflow(harness);
  assert.equal(workflow.phase, WorkflowPhase.IMPLEMENT);
  assert.ok(workflow.activeCandidateGenerationId);
  const generationId = workflow.activeCandidateGenerationId;

  assertApplied(
    harness.runtime.beginAttempt({
      commandId: harnessCommand(harness, commandLabel('implement-start')),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }),
  );
  finishActiveAttempt(harness, commandLabel('implement-result'));

  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, commandLabel('to-freeze')),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.SOURCE_FREEZE,
      reason: 'repaired implementation is quiescent',
    }),
  );
  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.beginAttempt({
      commandId: harnessCommand(harness, commandLabel('freeze-start')),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }),
  );
  workflow = currentWorkflow(harness);
  assert.ok(workflow.activeAttemptId);
  assertApplied(
    harness.runtime.completeSourceFreeze({
      commandId: harnessCommand(harness, commandLabel('freeze-complete')),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: workflow.activeAttemptId,
      reason: 'repaired Candidate source observations completed',
    }),
  );

  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, commandLabel('to-evidence')),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.EVIDENCE_BUILD,
      reason: 'repaired Candidate freeze authority is complete',
    }),
  );
  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.beginAttempt({
      commandId: harnessCommand(harness, commandLabel('verification-start')),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }),
  );
  workflow = currentWorkflow(harness);
  assert.ok(workflow.activeAttemptId);
  const obligation = harness.store
    .listVerificationObligations(harness.goalId)
    .find((candidate) => candidate.candidateGenerationId === generationId);
  assert.ok(obligation);
  assertApplied(
    harness.runtime.runVerification({
      commandId: harnessCommand(harness, commandLabel('verification-complete')),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: workflow.activeAttemptId,
      obligationId: obligation.id,
      reason: 'repaired Candidate fake verification observation handled',
    }),
  );

  workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, commandLabel('to-final-verify')),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.FINAL_VERIFY,
      reason: 'repaired Candidate canonical Evidence Set is complete',
    }),
  );
  workflow = currentWorkflow(harness);
  assert.equal(workflow.phase, WorkflowPhase.FINAL_VERIFY);
  return Object.freeze({ workflow, generationId });
}

void test('[I-006][I-008][I-009] IMPLEMENT recovery binds the exact current Candidate digest', (t) => {
  const harness = createHarness(t, { name: 'implement_recovery_candidate' });
  let workflow = advanceToReadyPlan(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, 'recovery-to-implement'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.IMPLEMENT,
      reason: 'prepare a recoverable IMPLEMENT boundary',
    }),
  );
  workflow = currentWorkflow(harness);
  assert.ok(workflow.activeCandidateGenerationId);
  assertApplied(
    harness.runtime.beginAttempt({
      commandId: harnessCommand(harness, 'recovery-implement-start'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
    }),
  );
  const running = currentWorkflow(harness);
  assert.equal(running.runStatus, RunStatus.RUNNING);
  assert.ok(running.activeAttemptId);
  const nextSequence = harness.store.nextAttemptSequence(harness.workflowId);

  const inspector = new FakeRecoveryInspector([
    FakeRecoveryInspectionMode.CANDIDATE_MISMATCH,
    FakeRecoveryInspectionMode.EXACT,
  ]);
  const recovery = createRecoveryCoordinator({
    store: harness.store,
    clock: Object.freeze({
      now: (() => {
        const finalTimestamp = isoTimestamp('2026-07-27T00:00:00.901Z');
        const timestamps = [isoTimestamp('2026-07-27T00:00:00.900Z'), finalTimestamp];
        let index = 0;
        return () => timestamps[index++] ?? finalTimestamp;
      })(),
    }),
    ids: new DeterministicIds('implement-recovery-control'),
    digests,
    inspector,
    inspectorVersion: 'fake-recovery-inspector-v1',
    recoveryPolicyVersion: 'm1-exact-same-phase-v1',
  });
  const startup = recovery.recoverOnStartup();
  assert.equal(startup.reconciledCount, 1);
  const recoveryIdentifier = startup.recoveryIds[0];
  assert.ok(recoveryIdentifier);
  const blockedRecord = harness.store.getRecoveryReconciliation(recoveryIdentifier);
  assert.ok(blockedRecord);
  assert.equal(blockedRecord.disposition, RecoveryReconciliationDisposition.BLOCKED);
  assert.equal(blockedRecord.reasonCode, RecoveryReasonCode.CANDIDATE_DIGEST_MISMATCH);
  assert.equal(blockedRecord.candidateGenerationId, running.activeCandidateGenerationId);
  assert.notEqual(blockedRecord.observedCandidateDigest, blockedRecord.expectedCandidateDigest);
  const blocked = currentWorkflow(harness);
  assert.equal(blocked.runStatus, RunStatus.BLOCKED);

  const resumed = recovery.resumeGoal({
    commandId: commandId('command_implement-recovery-resume'),
    goalId: harness.goalId,
    expectedGoalRevision: goalRevision(1),
    expectedWorkflowVersion: blocked.version,
  });
  assert.equal(resumed.status, 'APPLIED');
  const ready = currentWorkflow(harness);
  assert.equal(ready.runStatus, RunStatus.READY);
  assert.equal(ready.phase, WorkflowPhase.IMPLEMENT);
  assert.equal(ready.activeAttemptId, undefined);
  assert.equal(harness.store.nextAttemptSequence(harness.workflowId), nextSequence);
  assert.equal(inspector.requests().length, 2);
});

void test('[I-008] Candidate preparation rolls back every authority record after its dedicated write probe', (t) => {
  let armed = false;
  const harness = createHarness(t, {
    name: 'candidate-preparation-rollback',
    transactionProbe: (step) => {
      if (armed && step === CandidateEvidenceTransactionStep.AFTER_CANDIDATE_WRITE) {
        throw new Error('injected Candidate preparation failure');
      }
    },
  });
  const before = advanceToReadyPlan(harness);
  const transitionCommandId = commandId('command_candidate-preparation-rollback-to-implement');
  armed = true;
  const result = harness.runtime.requestPhaseTransition({
    commandId: transitionCommandId,
    workflowId: before.id,
    expectedWorkflowVersion: before.version,
    requestedPhase: WorkflowPhase.IMPLEMENT,
    reason: 'inject failure after Candidate authority writes',
  });
  armed = false;
  assert.equal(result.status, 'REJECTED');
  assert.deepEqual(currentWorkflow(harness), before);
  assert.equal(harness.store.getCandidateForGoal(harness.goalId), undefined);
  assert.equal(harness.store.listCheckSpecifications().length, 0);
  assert.equal(harness.store.listVerificationObligations(harness.goalId).length, 0);
  assert.equal(harness.store.getProcessedCommand(transitionCommandId), undefined);
  assert.equal(
    harness.store
      .listAuditEvents('WORKFLOW', harness.workflowId)
      .some((event) => event.commandId === transitionCommandId),
    false,
  );
});

void test('[I-005][I-008] Store rejects Candidate preparation with an incomplete M1 obligation policy', (t) => {
  const harness = createHarness(t, { name: 'incomplete-candidate-policy' });
  const workflow = advanceToReadyPlan(harness);
  const goal = harness.store.getGoal(harness.goalId);
  assert.ok(goal);
  const occurredAt = isoTimestamp('2026-07-27T00:01:00.000Z');
  const candidateIdentifier = harness.ids.nextCandidateId();
  const candidate = createCandidate({
    id: candidateIdentifier,
    goalId: goal.id,
    baseProjectIdentity: deriveM1BaseProjectIdentity(goal.scope.projectPath, digests),
  });
  const generationIdentifier = harness.ids.nextCandidateGenerationId();
  const generation = createCandidateGeneration({
    id: generationIdentifier,
    candidateId: candidate.id,
    sequence: 1,
    workspaceIdentity: deriveM1WorkspaceIdentity(generationIdentifier),
    baseDigest: digests.digest({ source: 'incomplete-candidate-policy' }),
    createdAt: occurredAt,
  });
  const decision = decideWorkflow(workflow, {
    type: 'REQUEST_PHASE_TRANSITION',
    commandId: harnessCommand(harness, 'forged-incomplete-preparation'),
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt,
    reason: 'attempt to omit a required verification obligation',
    requestedPhase: WorkflowPhase.IMPLEMENT,
    nextCandidateGenerationId: generation.id,
    guardResults: (
      requiredGuardsForTransition(WorkflowPhase.PLAN, WorkflowPhase.IMPLEMENT) ?? []
    ).map((guard) => ({
      guard,
      outcome: GuardOutcome.PASS,
      reasonCode: 'FORGED_CANDIDATE_PREPARATION',
      supportingRefs: ['forged:candidate-preparation'],
    })),
  });
  assert.equal(decision.accepted, true);
  const policy = createM1CandidateEvidencePolicy(
    goal,
    generation,
    {
      freeze: harness.ids.nextCheckSpecificationId(),
      verification: harness.ids.nextCheckSpecificationId(),
    },
    harness.ids,
    occurredAt,
  );
  const checkSpecifications = [policy.freeze, policy.verification];
  const event = decision.events[0];
  const payloadDigest = digests.digest({
    event,
    candidate,
    generation,
    checkSpecifications,
    obligations: [],
  });
  assert.throws(
    () =>
      harness.store.commitCandidatePreparation({
        inputDigest: digests.digest({ type: 'INCOMPLETE_CANDIDATE_PREPARATION' }),
        target: { aggregateType: 'WORKFLOW', aggregateId: workflow.id },
        event,
        auditEventId: harness.ids.nextAuditEventId(),
        payloadDigest,
        candidate,
        generation,
        checkSpecifications,
        obligations: [],
        candidateAuditEventId: harness.ids.nextAuditEventId(),
        generationAuditEventId: harness.ids.nextAuditEventId(),
        checkSpecificationAuditEventIds: [
          harness.ids.nextAuditEventId(),
          harness.ids.nextAuditEventId(),
        ],
        obligationAuditEventIds: [],
      }),
    /exactly one Verification Obligation per required criterion/,
  );
  assert.equal(harness.store.getCandidateForGoal(goal.id), undefined);
  assert.equal(currentWorkflow(harness).phase, WorkflowPhase.PLAN);
});

void test('[I-008] source freeze rolls back Candidate and Evidence writes at each dedicated probe', async (t) => {
  for (const step of [
    CandidateEvidenceTransactionStep.AFTER_CANDIDATE_TRANSITION,
    CandidateEvidenceTransactionStep.AFTER_EVIDENCE_WRITE,
  ]) {
    await t.test(step, (subtest) => {
      let armed = false;
      const harness = createHarness(subtest, {
        name: `freeze-rollback-${step.toLowerCase().replaceAll('_', '-')}`,
        transactionProbe: (observed) => {
          if (armed && observed === step) {
            throw new Error(`injected source freeze failure at ${step}`);
          }
        },
      });
      const freeze = advanceToFreezeAttempt(harness);
      const before = currentWorkflow(harness);
      const completionCommandId = harnessCommand(harness, 'freeze-complete');
      armed = true;
      const result = harness.runtime.completeSourceFreeze({
        commandId: completionCommandId,
        workflowId: before.id,
        expectedWorkflowVersion: before.version,
        attemptId: freeze.attemptId,
        reason: `inject rollback at ${step}`,
      });
      armed = false;
      assert.equal(result.status, 'REJECTED');
      assert.deepEqual(currentWorkflow(harness), before);
      assert.equal(harness.store.getAttempt(freeze.attemptId)?.status, AttemptStatus.RUNNING);
      assert.equal(
        harness.store.getCandidateGeneration(freeze.generationId)?.state,
        CandidateGenerationState.FREEZING,
      );
      assert.equal(harness.store.listEvidenceForGeneration(freeze.generationId).length, 0);
      assert.equal(harness.store.getProcessedCommand(completionCommandId), undefined);
    });
  }
});

void test('[I-008][I-009] Verification Evidence admission rolls back at every transaction probe', async (t) => {
  const steps = [
    TransactionStep.AFTER_COMMAND_CHECK,
    CandidateEvidenceTransactionStep.AFTER_EVIDENCE_WRITE,
    CandidateEvidenceTransactionStep.AFTER_ELIGIBILITY_WRITE,
    TransactionStep.AFTER_ATTEMPT_STATE_WRITE,
    TransactionStep.AFTER_STATE_WRITE,
    TransactionStep.AFTER_AUDIT_APPEND,
    TransactionStep.AFTER_COMMAND_RECORD,
    TransactionStep.BEFORE_COMMIT,
  ] as const;
  for (const step of steps) {
    await t.test(step, (subtest) => {
      let armed = false;
      const harness = createHarness(subtest, {
        name: `verification-rollback-${step.toLowerCase().replaceAll('_', '-')}`,
        transactionProbe: (observed) => {
          if (armed && observed === step) {
            throw new Error(`injected Verification failure at ${step}`);
          }
        },
      });
      const generationId = completeStableFreezeAndEnterEvidence(harness);
      const started = beginVerification(harness);
      const before = currentWorkflow(harness);
      const beforeEvidence = harness.store.listEvidenceForGeneration(generationId);
      armed = true;
      const result = harness.runtime.runVerification({
        commandId: started.completionCommandId,
        workflowId: started.workflow.id,
        expectedWorkflowVersion: started.workflow.version,
        attemptId: started.attemptId,
        obligationId: started.obligationId,
        reason: `inject rollback at ${step}`,
      });
      armed = false;
      assert.equal(result.status, 'REJECTED');
      assert.deepEqual(currentWorkflow(harness), before);
      assert.equal(harness.store.getAttempt(started.attemptId)?.status, AttemptStatus.RUNNING);
      assert.deepEqual(harness.store.listEvidenceForGeneration(generationId), beforeEvidence);
      assert.equal(harness.store.getProcessedCommand(started.completionCommandId), undefined);
      assert.equal(
        harness.store
          .listAuditEvents('ATTEMPT', started.attemptId)
          .some((event) => event.commandId === started.completionCommandId),
        false,
      );
    });
  }
});

void test('[I-008][I-009] Evidence Set insertion rolls back with Workflow, audit, and command', (t) => {
  let armed = false;
  const harness = createHarness(t, {
    name: 'evidence-set-rollback',
    transactionProbe: (step) => {
      if (armed && step === CandidateEvidenceTransactionStep.AFTER_EVIDENCE_SET_WRITE) {
        throw new Error('injected Evidence Set failure');
      }
    },
  });
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness);
  const before = currentWorkflow(harness);
  const finalCommandId = commandId('command_evidence-set-rollback-to-final');
  armed = true;
  const result = harness.runtime.requestPhaseTransition({
    commandId: finalCommandId,
    workflowId: before.id,
    expectedWorkflowVersion: before.version,
    requestedPhase: WorkflowPhase.FINAL_VERIFY,
    reason: 'inject failure after Evidence Set write',
  });
  armed = false;
  assert.equal(result.status, 'REJECTED');
  assert.deepEqual(currentWorkflow(harness), before);
  assert.equal(
    harness.store.getCandidateGeneration(generationId)?.state,
    CandidateGenerationState.FROZEN,
  );
  assert.ok(
    harness.store
      .listEvidenceForGeneration(generationId)
      .every(({ eligibility }) => eligibility.state === EvidenceEligibilityState.ELIGIBLE),
  );
  assert.equal(harness.store.getProcessedCommand(finalCommandId), undefined);
  const inspected = new Database(harness.filename, { readonly: true, fileMustExist: true });
  assert.equal(inspected.prepare('SELECT COUNT(*) FROM evidence_sets').pluck().get(), 0);
  inspected.close();
});

void test('[I-005][I-008] source drift during freeze atomically invalidates the Candidate', (t) => {
  const harness = createHarness(t, {
    name: 'freeze_drift',
    sourceFixture: FakeCandidateSourceFixture.FREEZE_DRIFT,
  });
  const freeze = advanceToFreezeAttempt(harness);
  const workflow = currentWorkflow(harness);
  const genericCompletion = harness.runtime.recordAttemptResult({
    commandId: commandId('command_freeze-drift-generic-result'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    attemptId: freeze.attemptId,
    reason: 'attempt to bypass Candidate Manager completion',
  });
  assert.equal(genericCompletion.status, 'REJECTED');
  assert.equal(harness.store.getAttempt(freeze.attemptId)?.status, AttemptStatus.RUNNING);
  assert.equal(
    harness.store.getCandidateGeneration(freeze.generationId)?.state,
    CandidateGenerationState.FREEZING,
  );
  assertApplied(
    harness.runtime.completeSourceFreeze({
      commandId: commandId('command_freeze-drift-complete'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: freeze.attemptId,
      reason: 'detect source drift during freeze',
    }),
  );

  const failedWorkflow = currentWorkflow(harness);
  assert.equal(failedWorkflow.runStatus, RunStatus.FAILED);
  assert.equal(failedWorkflow.activeAttemptId, undefined);
  const failedAttempt = harness.store.getAttempt(freeze.attemptId);
  assert.ok(failedAttempt);
  assert.equal(failedAttempt.status, AttemptStatus.FAILED);
  assert.equal(failedAttempt.failureClass, AttemptFailureClass.INTEGRITY_VIOLATION);
  const invalidated = harness.store.getCandidateGeneration(freeze.generationId);
  assert.ok(invalidated);
  assert.equal(invalidated.state, CandidateGenerationState.INVALIDATED);
  assert.equal(invalidated.invalidationReason, 'SOURCE_CHANGED_DURING_FREEZE');
  assert.equal(harness.store.listEvidenceForGeneration(freeze.generationId).length, 0);
});

void test('[I-005][I-008] direct Store transition cannot forge Candidate freeze guard proof', (t) => {
  const harness = createHarness(t, { name: 'forged-freeze-transition' });
  const freeze = advanceToFreezeAttempt(harness);
  let workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.completeSourceFreeze({
      commandId: harnessCommand(harness, 'freeze-complete'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: freeze.attemptId,
      reason: 'record stable Candidate freeze authority',
    }),
  );
  workflow = currentWorkflow(harness);
  const decision = decideWorkflow(workflow, {
    type: 'REQUEST_PHASE_TRANSITION',
    commandId: harnessCommand(harness, 'forged-to-evidence'),
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt: isoTimestamp('2026-07-27T00:01:00.000Z'),
    reason: 'attempt to forge Candidate freeze guard labels',
    requestedPhase: WorkflowPhase.EVIDENCE_BUILD,
    guardResults: (
      requiredGuardsForTransition(WorkflowPhase.SOURCE_FREEZE, WorkflowPhase.EVIDENCE_BUILD) ?? []
    ).map((guard) => ({
      guard,
      outcome: GuardOutcome.PASS,
      reasonCode: 'FORGED_FREEZE_PROOF',
      supportingRefs: ['forged:freeze-proof'],
    })),
  });
  assert.equal(decision.accepted, true);
  assert.throws(
    () =>
      harness.store.commitWorkflowEvent({
        inputDigest: digests.digest({ type: 'FORGED_FREEZE_TRANSITION' }),
        target: { aggregateType: 'WORKFLOW', aggregateId: workflow.id },
        event: decision.events[0],
        auditEventId: harness.ids.nextAuditEventId(),
        payloadDigest: digests.digest(decision.events[0]),
      }),
    /does not match persisted authority/,
  );
  assert.equal(currentWorkflow(harness).phase, WorkflowPhase.SOURCE_FREEZE);
});

void test('[I-005][I-008][I-009] post-freeze drift fails Workflow and invalidates every Evidence record in one transaction', (t) => {
  const harness = createHarness(t, {
    name: 'frozen_drift',
    sourceFixture: FakeCandidateSourceFixture.FROZEN_DRIFT,
  });
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness);
  const before = harness.store.listEvidenceForGeneration(generationId);
  assert.equal(before.length, 2);
  assert.ok(
    before.every(({ eligibility }) => eligibility.state === EvidenceEligibilityState.ELIGIBLE),
  );

  const workflow = currentWorkflow(harness);
  const frozen = harness.store.getCandidateGeneration(generationId);
  assert.ok(frozen?.state === CandidateGenerationState.FROZEN);
  const obligations = harness.store.listVerificationObligations(harness.goalId);
  const priorSet = buildEvidenceSet(
    {
      goalId: harness.goalId,
      goalRevision: goalRevision(1),
      candidateGenerationId: generationId,
      candidateDigest: frozen.frozenDigest,
      obligations,
      evidence: before,
    },
    digests,
  );
  const forbiddenIntegrityDecision = decideWorkflow(workflow, {
    type: 'FAIL_WORKFLOW_INTEGRITY',
    commandId: commandId('command_frozen-drift-generic-integrity'),
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt: isoTimestamp('2026-07-27T00:01:00.000Z'),
    reason: 'attempt to bypass compound Candidate invalidation',
  });
  assert.equal(forbiddenIntegrityDecision.accepted, true);
  assert.throws(
    () =>
      harness.store.commitWorkflowEvent({
        inputDigest: digests.digest({ type: 'FORBIDDEN_GENERIC_INTEGRITY' }),
        target: { aggregateType: 'WORKFLOW', aggregateId: workflow.id },
        event: forbiddenIntegrityDecision.events[0],
        auditEventId: harness.ids.nextAuditEventId(),
        payloadDigest: digests.digest(forbiddenIntegrityDecision.events[0]),
      }),
    /owning compound commit/,
  );
  const result = harness.runtime.requestPhaseTransition({
    commandId: commandId('command_frozen-drift-to-final'),
    workflowId: workflow.id,
    expectedWorkflowVersion: workflow.version,
    requestedPhase: WorkflowPhase.FINAL_VERIFY,
    reason: 'revalidate frozen source before final verification',
  });
  assertApplied(result);

  const failedWorkflow = currentWorkflow(harness);
  assert.equal(failedWorkflow.phase, WorkflowPhase.EVIDENCE_BUILD);
  assert.equal(failedWorkflow.runStatus, RunStatus.FAILED);
  const invalidated = harness.store.getCandidateGeneration(generationId);
  assert.ok(invalidated);
  assert.equal(invalidated.state, CandidateGenerationState.INVALIDATED);
  assert.equal(invalidated.invalidationReason, 'FROZEN_CANDIDATE_DRIFT');
  const after = harness.store.listEvidenceForGeneration(generationId);
  assert.ok(
    after.every(
      ({ eligibility }) =>
        eligibility.state === EvidenceEligibilityState.INELIGIBLE &&
        eligibility.reasonCode === 'FROZEN_CANDIDATE_DRIFT' &&
        eligibility.sourceRef === generationId,
    ),
  );
  assert.throws(() => verifyEvidenceSetAuthority(priorSet, obligations, after, digests));

  harness.store.close();
  const inspected = new Database(harness.filename, { readonly: true, fileMustExist: true });
  assert.equal(inspected.prepare('SELECT COUNT(*) FROM evidence_sets').pluck().get(), 0);
  inspected.close();
  const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(harness.workflowId)?.runStatus, RunStatus.FAILED);
  assert.equal(
    reopened.getCandidateGeneration(generationId)?.state,
    CandidateGenerationState.INVALIDATED,
  );
  assert.ok(
    reopened
      .listEvidenceForGeneration(generationId)
      .every(({ eligibility }) => eligibility.state === EvidenceEligibilityState.INELIGIBLE),
  );
});

void test('[I-009][I-012] malformed verifier output fails its Attempt without admitting Evidence', (t) => {
  const harness = createHarness(t, {
    name: 'malformed_verifier',
    verificationFixture: FakeVerificationFixture.MALFORMED,
  });
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  const attemptIdentifier = runVerification(harness);

  const failedAttempt = harness.store.getAttempt(attemptIdentifier);
  assert.ok(failedAttempt);
  assert.equal(failedAttempt.status, AttemptStatus.FAILED);
  assert.equal(failedAttempt.failureClass, AttemptFailureClass.PROTOCOL_ERROR);
  assert.equal(
    failedAttempt.terminationReason,
    VerificationResultAdmissionFailureCode.OUTPUT_MALFORMED,
  );
  assert.equal(currentWorkflow(harness).runStatus, RunStatus.FAILED);
  const evidence = harness.store.listEvidenceForGeneration(generationId);
  assert.equal(evidence.length, 1);
  const freezeEvidence = evidence[0];
  assert.ok(freezeEvidence);
  assert.equal(freezeEvidence.record.kind, EvidenceKind.CANDIDATE_FREEZE);
  assert.equal(freezeEvidence.eligibility.state, EvidenceEligibilityState.ELIGIBLE);
});

void test('[I-004][I-009][I-012][I-027] forged verifier bindings and sensitive failures persist only closed reason codes', async (t) => {
  const cases = [
    {
      fixture: FakeVerificationFixture.CROSS_PRODUCER,
      reasonCode: VerificationResultAdmissionFailureCode.OUTPUT_MALFORMED,
    },
    {
      fixture: FakeVerificationFixture.CROSS_CHECK,
      reasonCode: VerificationResultAdmissionFailureCode.OUTPUT_MALFORMED,
    },
    {
      fixture: FakeVerificationFixture.SENSITIVE_OUTPUT,
      reasonCode: VerificationResultAdmissionFailureCode.OUTPUT_MALFORMED,
    },
    {
      fixture: FakeVerificationFixture.THROW_SENSITIVE,
      reasonCode: VerificationResultAdmissionFailureCode.RUNNER_INVOCATION_FAILED,
    },
  ] as const;

  for (const variant of cases) {
    await t.test(variant.fixture, (fixtureTest) => {
      const harness = createHarness(fixtureTest, {
        name: `verifier_${variant.fixture.toLowerCase()}`,
        verificationFixture: variant.fixture,
      });
      const generationId = completeStableFreezeAndEnterEvidence(harness);
      const attemptIdentifier = runVerification(harness);

      const failedAttempt = harness.store.getAttempt(attemptIdentifier);
      assert.ok(failedAttempt);
      assert.equal(failedAttempt.status, AttemptStatus.FAILED);
      assert.equal(failedAttempt.failureClass, AttemptFailureClass.PROTOCOL_ERROR);
      assert.equal(failedAttempt.terminationReason, variant.reasonCode);
      assert.equal(currentWorkflow(harness).runStatus, RunStatus.FAILED);
      assert.deepEqual(
        harness.store.listEvidenceForGeneration(generationId).map(({ record }) => record.kind),
        [EvidenceKind.CANDIDATE_FREEZE],
      );
      assertSensitiveMarkerNotPersisted(harness);
    });
  }
});

void test('[I-005][I-008][I-027] Candidate Source protocol failures persist only closed reason codes', async (t) => {
  const cases = [
    {
      fixture: FakeCandidateSourceFixture.FREEZE_SENSITIVE_OUTPUT,
      reasonCode: CandidateSourceFailureCode.FREEZE_OUTPUT_MALFORMED,
    },
    {
      fixture: FakeCandidateSourceFixture.FREEZE_THROW_SENSITIVE,
      reasonCode: CandidateSourceFailureCode.FREEZE_INVOCATION_FAILED,
    },
  ] as const;

  for (const variant of cases) {
    await t.test(variant.fixture, (fixtureTest) => {
      const harness = createHarness(fixtureTest, {
        name: `source_${variant.fixture.toLowerCase()}`,
        sourceFixture: variant.fixture,
      });
      const freeze = advanceToFreezeAttempt(harness);
      const workflow = currentWorkflow(harness);
      assertApplied(
        harness.runtime.completeSourceFreeze({
          commandId: harnessCommand(harness, 'freeze-protocol-failure'),
          workflowId: workflow.id,
          expectedWorkflowVersion: workflow.version,
          attemptId: freeze.attemptId,
          reason: 'exercise Candidate Source protocol failure',
        }),
      );

      const failedAttempt = harness.store.getAttempt(freeze.attemptId);
      assert.ok(failedAttempt);
      assert.equal(failedAttempt.status, AttemptStatus.FAILED);
      assert.equal(failedAttempt.failureClass, AttemptFailureClass.PROTOCOL_ERROR);
      assert.equal(failedAttempt.terminationReason, variant.reasonCode);
      assert.equal(currentWorkflow(harness).runStatus, RunStatus.FAILED);
      const generation = harness.store.getCandidateGeneration(freeze.generationId);
      assert.equal(generation?.state, CandidateGenerationState.INVALIDATED);
      assert.equal(generation.invalidationReason, variant.reasonCode);
      assertSensitiveMarkerNotPersisted(harness);
    });
  }
});

void test('[I-005][I-006][I-009] Store rejects cross-generation, stale-Policy, and stale-check Evidence', (t) => {
  const harness = createHarness(t, { name: 'forged-evidence-bindings' });
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  const started = beginVerification(harness);
  const workflow = started.workflow;
  const attempt = harness.store.getAttempt(started.attemptId);
  assert.ok(attempt?.status === AttemptStatus.RUNNING);
  const obligation = harness.store.getVerificationObligation(started.obligationId);
  assert.ok(obligation);
  const checkId = obligation.checkSpecRef.split('@', 1)[0];
  assert.ok(checkId);
  const checkSpec = harness.store.getCheckSpecification(checkSpecificationId(checkId));
  assert.ok(checkSpec);
  const frozen = harness.store.getCandidateGeneration(generationId);
  assert.ok(frozen?.state === CandidateGenerationState.FROZEN);
  const freezeEvidence = harness.store
    .listEvidenceForGeneration(generationId)
    .find(({ record }) => record.kind === EvidenceKind.CANDIDATE_FREEZE);
  assert.ok(freezeEvidence);

  const variants = [
    {
      name: 'cross-generation',
      candidateGenerationId: candidateGenerationId('generation_forged-cross-generation'),
      verificationObligationId: obligation.id,
      policyDigest: freezeEvidence.record.policyBundleDigest,
      checkSpec,
      expected: /exact terminal Attempt authority/,
    },
    {
      name: 'stale-policy',
      candidateGenerationId: generationId,
      verificationObligationId: obligation.id,
      policyDigest: sha256Digest(`sha256:${'f'.repeat(64)}`),
      checkSpec,
      expected: /Policy or Check Specification authority is stale/,
    },
    {
      name: 'stale-check',
      candidateGenerationId: generationId,
      verificationObligationId: obligation.id,
      policyDigest: freezeEvidence.record.policyBundleDigest,
      checkSpec: decodeCheckSpecification({ ...checkSpec, version: 'm1.3' }),
      expected: /Policy or Check Specification authority is stale/,
    },
    {
      name: 'cross-obligation',
      candidateGenerationId: generationId,
      verificationObligationId: verificationObligationId('obligation_forged-cross-obligation'),
      policyDigest: freezeEvidence.record.policyBundleDigest,
      checkSpec,
      expected: /does not satisfy its Obligation/,
    },
  ] as const;

  variants.forEach((variant, index) => {
    const operationId = commandId(`command_forged-evidence-${variant.name}`);
    const occurredAt = isoTimestamp(`2026-07-27T00:00:${String(30 + index).padStart(2, '0')}.000Z`);
    const decision = decideAttempt(workflow, attempt, {
      type: 'RECORD_ATTEMPT_RESULT',
      commandId: operationId,
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: attempt.id,
      occurredAt,
      reason: `attempt ${variant.name} Evidence admission`,
    });
    assert.equal(decision.accepted, true);
    const event = decision.events[0];
    const record = createTestResultEvidenceRecord(
      {
        id: harness.ids.nextEvidenceId(),
        goalId: harness.goalId,
        goalRevision: goalRevision(1),
        workflowId: workflow.id,
        attemptId: attempt.id,
        verificationObligationId: variant.verificationObligationId,
        candidateGenerationId: variant.candidateGenerationId,
        candidateDigest: frozen.frozenDigest,
        policyBundleId: freezeEvidence.record.policyBundleId,
        policyBundleDigest: variant.policyDigest,
        checkSpec: variant.checkSpec,
        startedAt: attempt.startedAt,
        endedAt: occurredAt,
        observation: {
          schemaVersion: 1,
          kind: 'FAKE_VERIFICATION',
          checkSpecRef: `${variant.checkSpec.id}@${variant.checkSpec.version}`,
          observedResult: 'PASS',
          detailCode: 'M1_FAKE_PASS',
        },
        recordedAt: occurredAt,
      },
      digests,
    );
    const eligibility = createInitialEvidenceEligibility(record.id, record.recordedAt);
    assert.throws(
      () =>
        harness.store.commitVerificationAttemptOutcome({
          inputDigest: digests.digest({ variant: variant.name, type: 'FORGED_EVIDENCE' }),
          target: { aggregateType: 'WORKFLOW', aggregateId: workflow.id },
          event,
          auditEventId: harness.ids.nextAuditEventId(),
          workflowAuditEventId: harness.ids.nextAuditEventId(),
          payloadDigest: digests.digest({
            event,
            evidenceRecordDigest: record.recordDigest,
            obligationId: obligation.id,
          }),
          obligationId: obligation.id,
          evidence: record,
          initialEligibility: eligibility,
          evidenceAuditEventId: harness.ids.nextAuditEventId(),
        }),
      variant.expected,
    );
    assert.equal(harness.store.getEvidence(record.id), undefined);
    assert.equal(harness.store.getProcessedCommand(operationId), undefined);
  });

  assert.equal(harness.store.getAttempt(started.attemptId)?.status, AttemptStatus.RUNNING);
  assertApplied(
    harness.runtime.runVerification({
      commandId: started.completionCommandId,
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      attemptId: started.attemptId,
      obligationId: started.obligationId,
      reason: 'admit the current exact verification result',
    }),
  );
  assert.equal(harness.store.listEvidenceForGeneration(generationId).length, 2);
});

void test('[I-008] injected failure after Evidence invalidation rolls back Candidate, Evidence, Workflow, audit, and command', (t) => {
  let armed = false;
  const harness = createHarness(t, {
    name: 'drift_rollback',
    sourceFixture: FakeCandidateSourceFixture.FROZEN_DRIFT,
    transactionProbe: (step) => {
      if (armed && step === CandidateEvidenceTransactionStep.AFTER_ELIGIBILITY_WRITE) {
        throw new Error('injected integrity rollback failure');
      }
    },
  });
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness);
  const beforeWorkflow = currentWorkflow(harness);
  const beforeGeneration = harness.store.getCandidateGeneration(generationId);
  const beforeEvidence = harness.store.listEvidenceForGeneration(generationId);
  const driftCommandId = commandId('command_drift-rollback-to-final');

  armed = true;
  const result = harness.runtime.requestPhaseTransition({
    commandId: driftCommandId,
    workflowId: beforeWorkflow.id,
    expectedWorkflowVersion: beforeWorkflow.version,
    requestedPhase: WorkflowPhase.FINAL_VERIFY,
    reason: 'force rollback after Evidence invalidation writes',
  });
  armed = false;
  assert.equal(result.status, 'REJECTED');
  assert.equal(result.output.ok, false);

  assert.deepEqual(currentWorkflow(harness), beforeWorkflow);
  assert.deepEqual(harness.store.getCandidateGeneration(generationId), beforeGeneration);
  assert.deepEqual(harness.store.listEvidenceForGeneration(generationId), beforeEvidence);
  assert.equal(harness.store.getProcessedCommand(driftCommandId), undefined);
  assert.equal(
    harness.store
      .listAuditEvents('WORKFLOW', harness.workflowId)
      .some((event) => event.commandId === driftCommandId),
    false,
  );
});

void test('[I-006][I-008] migration 0011 refuses legacy placeholder Candidate authority atomically', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-migration-0011-'));
  const migrationsDirectory = join(directory, 'migrations');
  const filename = join(directory, 'control.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  mkdirSync(migrationsDirectory);
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0011_',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }

  const legacy = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const ids = new DeterministicIds('migration-0011');
  const goal = createGoal({
    id: goalId('goal_migration-0011'),
    revision: goalRevision(1),
    objective: 'Reject legacy placeholder Candidate authority',
    successCriteria: [
      {
        id: successCriterionId('criterion_migration-0011'),
        description: 'Migration fails closed',
        required: true,
      },
    ],
    scope: { projectPath: '/fixture/migration-0011', allowedPaths: ['src/**'] },
    nonGoals: ['No authority reconstruction'],
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId('workflow_migration-0011'),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  assert.equal(
    legacy.createGoalWithWorkflow({
      commandId: commandId('command_migration-0011-create'),
      inputDigest: digests.digest({ type: 'CREATE_MIGRATION_0011_FIXTURE' }),
      goal,
      workflow,
      auditEventId: ids.nextAuditEventId(),
      workflowAuditEventId: ids.nextAuditEventId(),
      payloadDigest: digests.digest({ goal, workflow }),
    }).status,
    'APPLIED',
  );
  legacy.close();

  const raw = new Database(filename);
  raw
    .prepare(
      `INSERT INTO candidate_generations(
         id, candidate_id, workflow_id, sequence, parent_generation_id,
         workspace_identity, state, base_digest, frozen_digest, invalidation_reason,
         version, created_at, updated_at, frozen_at
       ) VALUES (?, ?, ?, 1, NULL, ?, 'MUTABLE', ?, NULL, NULL, 1, ?, ?, NULL)`,
    )
    .run(
      'generation_migration-0011',
      'candidate_migration-0011',
      workflow.id,
      'fixture://legacy-candidate',
      `sha256:${'a'.repeat(64)}`,
      createdAt,
      createdAt,
    );
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0011_candidate_evidence_authority.sql'),
    join(migrationsDirectory, '0011_candidate_evidence_authority.sql'),
  );

  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => createdAt,
      }),
    /candidate_evidence_migration_guard|CHECK constraint failed/,
  );
  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM schema_migrations WHERE name = '0011_candidate_evidence_authority.sql'",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'candidates'")
      .pluck()
      .get(),
    0,
  );
  inspected.close();
});

void test('[I-006][I-008] migration 0013 refuses placeholder Acceptance authority atomically', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-migration-0013-'));
  const migrationsDirectory = join(directory, 'migrations');
  const filename = join(directory, 'control.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  mkdirSync(migrationsDirectory);
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0013_',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }

  const legacy = openSqliteControlStore({ filename, migrationsDirectory, now: () => createdAt });
  const ids = new DeterministicIds('migration-0013');
  const goal = createGoal({
    id: goalId('goal_migration-0013'),
    revision: goalRevision(1),
    objective: 'Reject placeholder Acceptance authority',
    successCriteria: [
      {
        id: successCriterionId('criterion_migration-0013'),
        description: 'Migration fails closed',
        required: true,
      },
    ],
    scope: { projectPath: '/fixture/migration-0013', allowedPaths: ['src/**'] },
    nonGoals: ['No placeholder authority reconstruction'],
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId('workflow_migration-0013'),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  assert.equal(
    legacy.createGoalWithWorkflow({
      commandId: commandId('command_migration-0013-create'),
      inputDigest: digests.digest({ type: 'CREATE_MIGRATION_0013_FIXTURE' }),
      goal,
      workflow,
      auditEventId: ids.nextAuditEventId(),
      workflowAuditEventId: ids.nextAuditEventId(),
      payloadDigest: digests.digest({ goal, workflow }),
    }).status,
    'APPLIED',
  );
  legacy.close();

  const raw = new Database(filename);
  raw
    .prepare(
      `INSERT INTO pending_issues(
         id, goal_id, candidate_generation_id, classification, severity,
         description, source_refs_json, repairability, status, created_at, resolved_at
       ) VALUES (?, ?, NULL, 'legacy', 'legacy', ?, '[]', 'legacy', 'legacy', ?, NULL)`,
    )
    .run('issue_migration-0013', goal.id, 'placeholder row has no owning Runtime', createdAt);
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0013_acceptance_closeout_authority.sql'),
    join(migrationsDirectory, '0013_acceptance_closeout_authority.sql'),
  );

  assert.throws(
    () => openSqliteControlStore({ filename, migrationsDirectory, now: () => createdAt }),
    /acceptance_migration_guard|CHECK constraint failed/,
  );
  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM schema_migrations WHERE name = '0013_acceptance_closeout_authority.sql'",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(inspected.prepare('SELECT COUNT(*) FROM pending_issues').pluck().get(), 1);
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workflow_closeouts'",
      )
      .pluck()
      .get(),
    0,
  );
  inspected.close();
});

void test('[I-006][I-008] migration 0013 refuses pre-authority terminal state atomically', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-migration-0013-terminal-'));
  const migrationsDirectory = join(directory, 'migrations');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  mkdirSync(migrationsDirectory);
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0013_',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }
  const filename = join(directory, 'control.sqlite');
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  oldStore.close();
  insertLegacyTerminalCandidate(
    filename,
    CandidateGenerationState.ACCEPTED,
    'migration-0013-terminal-poison',
  );
  copyFileSync(
    join(sourceDirectory, '0013_acceptance_closeout_authority.sql'),
    join(migrationsDirectory, '0013_acceptance_closeout_authority.sql'),
  );

  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => createdAt,
      }),
    /acceptance_migration_guard|CHECK constraint failed/,
  );
  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM schema_migrations WHERE name = '0013_acceptance_closeout_authority.sql'",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare("SELECT COUNT(*) FROM candidate_generations WHERE state = 'ACCEPTED'")
      .pluck()
      .get(),
    1,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'workflow_closeouts'",
      )
      .pluck()
      .get(),
    0,
  );
  inspected.close();
});

void test('[I-006][I-008] migration 0014 refuses pre-record repair history atomically', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-migration-0014-repair-'));
  const migrationsDirectory = join(directory, 'migrations');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  mkdirSync(migrationsDirectory);
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0014_',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }
  const filename = join(directory, 'control.sqlite');
  const oldStore = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  oldStore.close();
  insertLegacyTerminalCandidate(
    filename,
    CandidateGenerationState.REJECTED,
    'migration-0014-repair-history',
  );
  copyFileSync(
    join(sourceDirectory, '0014_exact_acceptance_repair_authority.sql'),
    join(migrationsDirectory, '0014_exact_acceptance_repair_authority.sql'),
  );

  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => createdAt,
      }),
    /acceptance_repair_migration_guard|CHECK constraint failed/,
  );
  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM schema_migrations WHERE name = '0014_exact_acceptance_repair_authority.sql'",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare("SELECT COUNT(*) FROM candidate_generations WHERE state = 'REJECTED'")
      .pluck()
      .get(),
    1,
  );
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'acceptance_repairs'",
      )
      .pluck()
      .get(),
    0,
  );
  inspected.close();
});

void test('[I-006][I-008][I-027] migration 0011 refuses a retained Goal with no required criterion atomically', (t) => {
  const directory = mkdtempSync(join(tmpdir(), 'codeclosure-migration-0011-required-goal-'));
  const migrationsDirectory = join(directory, 'migrations');
  const filename = join(directory, 'control.sqlite');
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const sourceDirectory = defaultMigrationsDirectory();
  mkdirSync(migrationsDirectory);
  for (const name of readdirSync(sourceDirectory).filter(
    (candidate) => candidate.endsWith('.sql') && candidate < '0011_',
  )) {
    copyFileSync(join(sourceDirectory, name), join(migrationsDirectory, name));
  }

  const legacy = openSqliteControlStore({
    filename,
    migrationsDirectory,
    now: () => createdAt,
  });
  const ids = new DeterministicIds('migration-0011-required-goal');
  const goal = createGoal({
    id: goalId('goal_migration-0011-required-goal'),
    revision: goalRevision(1),
    objective: 'Reject a retained Goal with no required completion boundary',
    successCriteria: [
      {
        id: successCriterionId('criterion_migration-0011-required-goal'),
        description: 'Migration preserves a required criterion',
        required: true,
      },
    ],
    scope: { projectPath: '/fixture/migration-0011-required-goal', allowedPaths: ['src/**'] },
    createdAt,
  });
  const workflow = createWorkflow({
    id: workflowId('workflow_migration-0011-required-goal'),
    goalId: goal.id,
    goalRevision: goal.revision,
    createdAt,
  });
  assert.equal(
    legacy.createGoalWithWorkflow({
      commandId: commandId('command_migration-0011-required-goal-create'),
      inputDigest: digests.digest({ type: 'CREATE_REQUIRED_GOAL_MIGRATION_FIXTURE' }),
      goal,
      workflow,
      auditEventId: ids.nextAuditEventId(),
      workflowAuditEventId: ids.nextAuditEventId(),
      payloadDigest: digests.digest({ goal, workflow }),
    }).status,
    'APPLIED',
  );
  legacy.close();

  const raw = new Database(filename);
  raw.prepare('UPDATE goal_criteria SET required = 0 WHERE goal_id = ?').run(goal.id);
  raw.close();
  copyFileSync(
    join(sourceDirectory, '0011_candidate_evidence_authority.sql'),
    join(migrationsDirectory, '0011_candidate_evidence_authority.sql'),
  );

  assert.throws(
    () =>
      openSqliteControlStore({
        filename,
        migrationsDirectory,
        now: () => createdAt,
      }),
    /candidate_evidence_migration_guard|CHECK constraint failed/,
  );
  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  assert.equal(
    inspected
      .prepare(
        "SELECT COUNT(*) FROM schema_migrations WHERE name = '0011_candidate_evidence_authority.sql'",
      )
      .pluck()
      .get(),
    0,
  );
  assert.equal(
    inspected
      .prepare("SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'candidates'")
      .pluck()
      .get(),
    0,
  );
  inspected.close();
});

void test('[I-006][I-009] reopen recomputes Evidence digests instead of trusting retained text', (t) => {
  const harness = createHarness(t, { name: 'evidence-digest-corruption' });
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness);
  const testEvidence = harness.store
    .listEvidenceForGeneration(generationId)
    .find(({ record }) => record.kind === EvidenceKind.TEST_RESULT);
  assert.ok(testEvidence);
  harness.store.close();

  const raw = new Database(harness.filename);
  raw.exec('DROP TRIGGER evidence_records_no_update');
  raw
    .prepare('UPDATE evidence_records SET record_digest = ? WHERE id = ?')
    .run(`sha256:${'f'.repeat(64)}`, testEvidence.record.id);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /digest does not match|audit authority is incomplete/,
  );
});

void test('[I-005][I-008] reopen rejects a Candidate generation with an incomplete obligation set', (t) => {
  const harness = createHarness(t, { name: 'missing-obligation-corruption' });
  const workflow = advanceToReadyPlan(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, 'to-implement'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.IMPLEMENT,
      reason: 'prepare complete Candidate policy before retained corruption',
    }),
  );
  const obligation = harness.store.listVerificationObligations(harness.goalId)[0];
  assert.ok(obligation);
  harness.store.close();

  const raw = new Database(harness.filename);
  raw.exec('DROP TRIGGER verification_obligations_no_delete');
  raw.prepare('DELETE FROM verification_obligations WHERE id = ?').run(obligation.id);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /exactly one Verification Obligation per required criterion/,
  );
});

void test('[I-006][I-008][I-027] SQLite preserves at least one required Goal criterion', (t) => {
  const harness = createHarness(t, { name: 'required-goal-criterion' });
  const raw = new Database(harness.filename);
  raw.pragma('foreign_keys = ON');
  assert.throws(
    () =>
      raw.prepare('UPDATE goal_criteria SET required = 0 WHERE goal_id = ?').run(harness.goalId),
    /must retain at least one required success criterion/,
  );
  assert.throws(
    () => raw.prepare('DELETE FROM goal_criteria WHERE goal_id = ?').run(harness.goalId),
    /must retain at least one required success criterion/,
  );
  raw.close();
  assert.equal(harness.store.getGoal(harness.goalId)?.successCriteria[0]?.required, true);
});

void test('[I-006][I-008][I-027] SQLite rejects empty, unaudited, and audited-malformed Candidate/Evidence authority', (t) => {
  const harness = createHarness(t, { name: 'unaudited-candidate-evidence' });
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness);
  const obligation = harness.store.listVerificationObligations(harness.goalId)[0];
  assert.ok(obligation);
  const checkId = obligation.checkSpecRef.split('@', 1)[0];
  assert.ok(checkId);
  const checkSpec = harness.store.getCheckSpecification(checkSpecificationId(checkId));
  assert.ok(checkSpec);
  const testEvidence = harness.store
    .listEvidenceForGeneration(generationId)
    .find(({ record }) => record.kind === EvidenceKind.TEST_RESULT);
  assert.ok(testEvidence);
  const generation = harness.store.getCandidateGeneration(generationId);
  assert.ok(generation?.frozenDigest);

  const raw = new Database(harness.filename);
  raw.pragma('foreign_keys = ON');
  assert.throws(
    () =>
      raw
        .prepare('INSERT INTO check_specifications(id, version, canonical_json) VALUES (?, ?, ?)')
        .run(
          'check_unaudited-candidate-evidence',
          checkSpec.version,
          JSON.stringify({ ...checkSpec, id: 'check_unaudited-candidate-evidence' }),
        ),
    /invalid Check Specification authority/,
  );
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO verification_obligations(
             id, goal_id, source_criterion_refs_json, scenario_refs_json,
             check_spec_ref, required_evidence_kind, strength, created_at, goal_revision,
             candidate_generation_id
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          'obligation_unaudited-candidate-evidence',
          obligation.goalId,
          JSON.stringify(obligation.sourceCriterionRefs),
          JSON.stringify(obligation.scenarioRefs),
          obligation.checkSpecRef,
          obligation.requiredEvidenceKind,
          obligation.strength,
          obligation.createdAt,
          obligation.goalRevision,
          obligation.candidateGenerationId,
        ),
    /invalid Verification Obligation authority/,
  );
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO evidence_eligibility(
             evidence_id, version, state, reason_code, source_ref, changed_at
           ) VALUES (?, 2, 'INELIGIBLE', 'FORGED', ?, ?)`,
        )
        .run(testEvidence.record.id, generationId, isoTimestamp('2026-07-27T00:01:00.000Z')),
    /invalid or unaudited Evidence eligibility transition/,
  );

  const malformedCheckId = 'check_audited-malformed-candidate-evidence';
  raw
    .prepare(
      `INSERT INTO audit_events(
         id, aggregate_type, aggregate_id, event_type, actor_type, command_id,
         before_version, after_version, correlation_id, causation_id,
         payload_digest, occurred_at
       ) VALUES (?, 'CHECK_SPECIFICATION', ?, 'CHECK_SPECIFICATION_RECORDED', 'RUNTIME',
         NULL, NULL, NULL, NULL, NULL, ?, ?)`,
    )
    .run(
      harness.ids.nextAuditEventId(),
      malformedCheckId,
      digests.digest({ malformedCheckId }),
      createdAt,
    );
  assert.throws(
    () =>
      raw
        .prepare('INSERT INTO check_specifications(id, version, canonical_json) VALUES (?, ?, ?)')
        .run(malformedCheckId, checkSpec.version, JSON.stringify({})),
    /invalid Check Specification authority/,
  );

  const invalidatedAt = isoTimestamp('2026-07-27T00:01:01.000Z');
  raw
    .prepare(
      `INSERT INTO audit_events(
         id, aggregate_type, aggregate_id, event_type, actor_type, command_id,
         before_version, after_version, correlation_id, causation_id,
         payload_digest, occurred_at
       ) VALUES (?, 'EVIDENCE', ?, 'EVIDENCE_ELIGIBILITY_CHANGED', 'RUNTIME',
         NULL, 1, 2, NULL, NULL, ?, ?)`,
    )
    .run(
      harness.ids.nextAuditEventId(),
      testEvidence.record.id,
      digests.digest({ evidenceId: testEvidence.record.id, invalidatedAt }),
      invalidatedAt,
    );
  assert.throws(
    () =>
      raw
        .prepare(
          `INSERT INTO evidence_eligibility(
             evidence_id, version, state, reason_code, source_ref, changed_at
           ) VALUES (?, 2, 'INELIGIBLE', NULL, NULL, ?)`,
        )
        .run(testEvidence.record.id, invalidatedAt),
    /invalid or unaudited Evidence eligibility transition/,
  );

  const emptySetDigest = digests.digest({ type: 'EMPTY_REQUIRED_EVIDENCE_SET' });
  raw.exec('BEGIN');
  try {
    raw
      .prepare(
        `INSERT INTO audit_events(
           id, aggregate_type, aggregate_id, event_type, actor_type, command_id,
           before_version, after_version, correlation_id, causation_id,
           payload_digest, occurred_at
         ) VALUES (?, 'EVIDENCE_SET', ?, 'EVIDENCE_SET_RECORDED', 'RUNTIME',
           NULL, NULL, NULL, NULL, NULL, ?, ?)`,
      )
      .run(
        harness.ids.nextAuditEventId(),
        emptySetDigest,
        emptySetDigest,
        isoTimestamp('2026-07-27T00:01:02.000Z'),
      );
    assert.throws(
      () =>
        raw
          .prepare(
            `INSERT INTO evidence_sets(
               digest, schema_version, goal_id, goal_revision,
               candidate_generation_id, candidate_digest,
               obligation_mappings_json, evidence_refs_json,
               unresolved_requirements_json
             ) VALUES (?, 1, ?, 1, ?, ?, '[]', '[]', '[]')`,
          )
          .run(emptySetDigest, harness.goalId, generationId, generation.frozenDigest),
      /invalid or unaudited Evidence Set/,
    );
  } finally {
    raw.exec('ROLLBACK');
  }
  raw.close();
});

void test('[I-005][I-006][I-008][I-027] SQLite preserves complete Context entry authority when Slice 5 extends the trigger', (t) => {
  const harness = createHarness(t, { name: 'context-trigger-composition' });
  assertApplied(
    harness.runtime.startGoal({
      commandId: harnessCommand(harness, 'start'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: currentWorkflow(harness).version,
    }),
  );
  const workflow = currentWorkflow(harness);
  assert.ok(workflow.activeAttemptId);
  const attempt = harness.store.getAttempt(workflow.activeAttemptId);
  assert.ok(attempt?.contextManifestId);

  const raw = new Database(harness.filename);
  raw.pragma('foreign_keys = OFF');
  raw
    .prepare('CREATE TEMP TABLE saved_context AS SELECT * FROM context_manifests WHERE id = ?')
    .run(attempt.contextManifestId);
  const assertRejected = (entries: readonly unknown[]): void => {
    raw.exec('BEGIN');
    try {
      raw.exec('DROP TRIGGER context_manifests_no_delete');
      raw.prepare('DELETE FROM context_manifests WHERE id = ?').run(attempt.contextManifestId);
      raw.prepare('UPDATE saved_context SET entries_json = ?').run(JSON.stringify(entries));
      assert.throws(
        () => raw.exec('INSERT INTO context_manifests SELECT * FROM saved_context'),
        /M1 Context source authority is not exact and current/,
      );
    } finally {
      if (raw.inTransaction) {
        raw.exec('ROLLBACK');
      }
    }
  };
  assertRejected([{}]);
  assertRejected([
    {
      kind: 'GOAL',
      sourceRef: harness.goalId,
      sourceRevision: '1',
      authorityClass: 'PROJECT_OBSERVATION',
      renderedDigest: digests.digest({ forgedAuthorityClass: true }),
    },
  ]);
  raw.close();
  assert.ok(harness.store.getContextManifest(attempt.contextManifestId));
});

void test('[I-006][I-009] reopen rejects an invalidated Candidate that regained eligible Evidence', (t) => {
  const harness = createHarness(t, {
    name: 'invalidated-eligible-corruption',
    sourceFixture: FakeCandidateSourceFixture.FROZEN_DRIFT,
  });
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness);
  const workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: commandId('command_invalidated-eligible-corruption-drift'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.FINAL_VERIFY,
      reason: 'invalidate Candidate and its Evidence before corruption',
    }),
  );
  assert.ok(
    harness.store
      .listEvidenceForGeneration(generationId)
      .every(({ eligibility }) => eligibility.state === EvidenceEligibilityState.INELIGIBLE),
  );
  harness.store.close();

  const raw = new Database(harness.filename);
  raw.exec('DROP TRIGGER evidence_eligibility_no_delete');
  raw.prepare('DELETE FROM evidence_eligibility WHERE version = 2').run();
  raw.close();
  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /invalid retained eligibility authority/,
  );
});

void test('[I-006][I-009] a recorded Evidence Set replays historical authority after later invalidation', (t) => {
  const harness = createHarness(t, { name: 'historical-evidence-set' });
  const generationIdentifier = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness);
  const generation = harness.store.getCandidateGeneration(generationIdentifier);
  assert.ok(generation?.state === CandidateGenerationState.FROZEN);
  const obligations = harness.store.listVerificationObligations(harness.goalId);
  const evidenceAtSelection = harness.store.listEvidenceForGeneration(generationIdentifier);
  const expectedSet = buildEvidenceSet(
    {
      goalId: harness.goalId,
      goalRevision: goalRevision(1),
      candidateGenerationId: generationIdentifier,
      candidateDigest: generation.frozenDigest,
      obligations,
      evidence: evidenceAtSelection,
    },
    digests,
  );

  let workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, 'record-evidence-set'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.FINAL_VERIFY,
      reason: 'record the complete Evidence Set before later drift',
    }),
  );
  assert.equal(harness.store.getEvidenceSet(expectedSet.digest)?.digest, expectedSet.digest);

  workflow = currentWorkflow(harness);
  const currentGeneration = harness.store.getCandidateGeneration(generationIdentifier);
  assert.ok(currentGeneration?.state === CandidateGenerationState.FROZEN);
  const commandIdentifier = harnessCommand(harness, 'invalidate-after-evidence-set');
  const occurredAt = isoTimestamp('2026-07-27T00:10:00.000Z');
  const workflowDecision = decideWorkflow(workflow, {
    type: 'FAIL_WORKFLOW_INTEGRITY',
    commandId: commandIdentifier,
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt,
    reason: 'FROZEN_CANDIDATE_DRIFT',
  });
  const candidateDecision = decideCandidate(currentGeneration, {
    type: 'INVALIDATE_CANDIDATE',
    commandId: commandIdentifier,
    candidateGenerationId: currentGeneration.id,
    expectedVersion: currentGeneration.version,
    occurredAt,
    reason: 'FROZEN_CANDIDATE_DRIFT',
  });
  if (!workflowDecision.accepted) {
    assert.fail('Historical Evidence Set fixture requires an accepted Workflow event');
  }
  if (!candidateDecision.accepted) {
    assert.fail('Historical Evidence Set fixture requires an accepted Candidate event');
  }
  const event = workflowDecision.events[0];
  const candidateEvent = candidateDecision.events[0];
  const observedDigest = digests.digest({ drift: 'after-evidence-set-recording' });
  const payloadDigest = digests.digest({
    event,
    candidateEvent,
    expectedFrozenDigest: currentGeneration.frozenDigest,
    observedDigest,
  });
  assertApplied(
    harness.store.commitCandidateIntegrityFailure({
      inputDigest: digests.digest({ type: 'INVALIDATE_AFTER_EVIDENCE_SET' }),
      target: { aggregateType: 'WORKFLOW', aggregateId: workflow.id },
      event,
      auditEventId: harness.ids.nextAuditEventId(),
      payloadDigest,
      candidateEvent,
      expectedFrozenDigest: currentGeneration.frozenDigest,
      observedDigest,
      candidateAuditEventId: harness.ids.nextAuditEventId(),
      invalidatedEvidenceAuditEventIds: evidenceAtSelection.map(() =>
        harness.ids.nextAuditEventId(),
      ),
    }),
  );

  const historical = harness.store.getEvidenceSet(expectedSet.digest);
  assert.equal(historical?.digest, expectedSet.digest);
  assert.throws(
    () =>
      verifyEvidenceSetAuthority(
        expectedSet,
        obligations,
        harness.store.listEvidenceForGeneration(generationIdentifier),
        digests,
      ),
    /canonical current authority/,
  );

  harness.store.close();
  const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getEvidenceSet(expectedSet.digest)?.digest, expectedSet.digest);
});

void test('[I-006][I-009] reopen rejects a self-consistent but incomplete retained Evidence Set', (t) => {
  const harness = createHarness(t, { name: 'incomplete-retained-evidence-set' });
  const generationIdentifier = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness);
  const generation = harness.store.getCandidateGeneration(generationIdentifier);
  assert.ok(generation?.state === CandidateGenerationState.FROZEN);
  const obligations = harness.store.listVerificationObligations(harness.goalId);
  const completeSet = buildEvidenceSet(
    {
      goalId: harness.goalId,
      goalRevision: goalRevision(1),
      candidateGenerationId: generationIdentifier,
      candidateDigest: generation.frozenDigest,
      obligations,
      evidence: harness.store.listEvidenceForGeneration(generationIdentifier),
    },
    digests,
  );
  const workflow = currentWorkflow(harness);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: harnessCommand(harness, 'record-set-before-corruption'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.FINAL_VERIFY,
      reason: 'record a valid set before simulating retained corruption',
    }),
  );
  const obligation = obligations[0];
  assert.ok(obligation);
  const incompleteProjection = {
    schemaVersion: 1 as const,
    goalId: completeSet.goalId,
    goalRevision: completeSet.goalRevision,
    candidateGenerationId: completeSet.candidateGenerationId,
    candidateDigest: completeSet.candidateDigest,
    obligationMappings: [{ obligationId: obligation.id, evidenceIds: [] }],
    evidenceRefs: [],
    unresolvedEvidenceRequirements: [obligation.id],
  };
  const incompleteSet = decodeEvidenceSet({
    ...incompleteProjection,
    digest: digests.digest(evidenceSetDigestProjection(incompleteProjection)),
  });
  harness.store.close();

  const raw = new Database(harness.filename);
  raw.exec('DROP TRIGGER evidence_sets_no_update');
  raw.exec('DROP TRIGGER audit_events_no_update');
  raw.transaction(() => {
    raw
      .prepare(
        `UPDATE evidence_sets
          SET digest = ?, obligation_mappings_json = ?, evidence_refs_json = ?,
              unresolved_requirements_json = ?
        WHERE digest = ?`,
      )
      .run(
        incompleteSet.digest,
        JSON.stringify(incompleteSet.obligationMappings),
        JSON.stringify(incompleteSet.evidenceRefs),
        JSON.stringify(incompleteSet.unresolvedEvidenceRequirements),
        completeSet.digest,
      );
    raw
      .prepare(
        `UPDATE audit_events
          SET aggregate_id = ?, payload_digest = ?
        WHERE aggregate_type = 'EVIDENCE_SET' AND aggregate_id = ?`,
      )
      .run(incompleteSet.digest, incompleteSet.digest, completeSet.digest);
  })();
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /invalid retained authority/,
  );
});

void test('[I-005][I-006][I-009] Store rejects a self-consistent but non-canonical Evidence selection', (t) => {
  const harness = createHarness(t, { name: 'noncanonical-evidence-set' });
  const generationId = completeStableFreezeAndEnterEvidence(harness);
  runVerification(harness, 'first');
  runVerification(harness, 'second');
  const workflow = currentWorkflow(harness);
  const generation = harness.store.getCandidateGeneration(generationId);
  assert.ok(generation?.state === CandidateGenerationState.FROZEN);
  const obligation = harness.store.listVerificationObligations(harness.goalId)[0];
  assert.ok(obligation);
  const currentEvidence = harness.store.listEvidenceForGeneration(generationId);
  const verificationEvidence = currentEvidence.filter(
    ({ record }) => record.kind === EvidenceKind.TEST_RESULT,
  );
  assert.equal(verificationEvidence.length, 2);
  const selected = verificationEvidence[0];
  assert.ok(selected?.eligibility.state === EvidenceEligibilityState.ELIGIBLE);
  const withoutDigest = {
    schemaVersion: 1 as const,
    goalId: harness.goalId,
    goalRevision: goalRevision(1),
    candidateGenerationId: generationId,
    candidateDigest: generation.frozenDigest,
    obligationMappings: [{ obligationId: obligation.id, evidenceIds: [selected.record.id] }],
    evidenceRefs: [
      {
        evidenceId: selected.record.id,
        evidenceRecordDigest: selected.record.recordDigest,
        eligibilityVersion: selected.eligibility.version,
        eligibilityState: selected.eligibility.state,
      },
    ],
    unresolvedEvidenceRequirements: [],
  };
  const forgedSet = decodeEvidenceSet({
    ...withoutDigest,
    digest: digests.digest(evidenceSetDigestProjection(withoutDigest)),
  });
  const eventDecision = decideWorkflow(workflow, {
    type: 'REQUEST_PHASE_TRANSITION',
    commandId: commandId('command_noncanonical-evidence-set-direct'),
    workflowId: workflow.id,
    expectedVersion: workflow.version,
    occurredAt: isoTimestamp('2026-07-27T00:01:00.000Z'),
    reason: 'attempt a coherent subset instead of canonical selection',
    requestedPhase: WorkflowPhase.FINAL_VERIFY,
    guardResults: (
      requiredGuardsForTransition(WorkflowPhase.EVIDENCE_BUILD, WorkflowPhase.FINAL_VERIFY) ?? []
    ).map((guard) => ({
      guard,
      outcome: GuardOutcome.PASS,
      reasonCode: 'FORGED_DIRECT_STORE_GUARD',
      supportingRefs: ['forged:direct-store'],
    })),
  });
  assert.equal(eventDecision.accepted, true);
  assert.throws(
    () =>
      harness.store.commitEvidenceSetTransition({
        inputDigest: digests.digest({ type: 'NONCANONICAL_EVIDENCE_SET' }),
        target: { aggregateType: 'WORKFLOW', aggregateId: workflow.id },
        event: eventDecision.events[0],
        auditEventId: harness.ids.nextAuditEventId(),
        payloadDigest: digests.digest({
          event: eventDecision.events[0],
          evidenceSetDigest: forgedSet.digest,
        }),
        evidenceSet: forgedSet,
        evidenceSetAuditEventId: harness.ids.nextAuditEventId(),
      }),
    /canonical selection/,
  );
  assert.deepEqual(currentWorkflow(harness), workflow);

  const expectedSet = buildEvidenceSet(
    {
      goalId: harness.goalId,
      goalRevision: goalRevision(1),
      candidateGenerationId: generationId,
      candidateDigest: generation.frozenDigest,
      obligations: [obligation],
      evidence: currentEvidence,
    },
    digests,
  );
  assert.throws(
    () =>
      harness.store.commitEvidenceSetTransition({
        inputDigest: digests.digest({ type: 'FORGED_EVIDENCE_SET_GUARDS' }),
        target: { aggregateType: 'WORKFLOW', aggregateId: workflow.id },
        event: eventDecision.events[0],
        auditEventId: harness.ids.nextAuditEventId(),
        payloadDigest: digests.digest({
          event: eventDecision.events[0],
          evidenceSetDigest: expectedSet.digest,
        }),
        evidenceSet: expectedSet,
        evidenceSetAuditEventId: harness.ids.nextAuditEventId(),
      }),
    /guard proof does not match persisted authority/,
  );
  assert.deepEqual(currentWorkflow(harness), workflow);
  assertApplied(
    harness.runtime.requestPhaseTransition({
      commandId: commandId('command_noncanonical-evidence-set-runtime-final'),
      workflowId: workflow.id,
      expectedWorkflowVersion: workflow.version,
      requestedPhase: WorkflowPhase.FINAL_VERIFY,
      reason: 'persist the complete canonical Evidence selection',
    }),
  );
  assert.deepEqual(harness.store.getEvidenceSet(expectedSet.digest), expectedSet);
});

interface AcceptanceReference {
  readonly id: ReturnType<typeof acceptanceDecisionId>;
  readonly decisionDigest: ReturnType<typeof sha256Digest>;
  readonly manifestDigest: ReturnType<typeof sha256Digest>;
  readonly candidateDigest: ReturnType<typeof sha256Digest>;
}

function latestAcceptanceReference(harness: Harness): AcceptanceReference {
  const inspected = new Database(harness.filename, { readonly: true, fileMustExist: true });
  try {
    const row = inspected
      .prepare(
        `SELECT decision.id, decision.decision_digest, decision.input_manifest_digest,
                manifest.candidate_digest
           FROM acceptance_decisions AS decision
           JOIN acceptance_input_manifests AS manifest
             ON manifest.manifest_digest = decision.input_manifest_digest
          ORDER BY decision.issued_at DESC, decision.id DESC
          LIMIT 1`,
      )
      .get();
    assert.ok(row && typeof row === 'object');
    assert.equal(typeof Reflect.get(row, 'id'), 'string');
    assert.equal(typeof Reflect.get(row, 'decision_digest'), 'string');
    assert.equal(typeof Reflect.get(row, 'input_manifest_digest'), 'string');
    assert.equal(typeof Reflect.get(row, 'candidate_digest'), 'string');
    return Object.freeze({
      id: acceptanceDecisionId(String(Reflect.get(row, 'id'))),
      decisionDigest: sha256Digest(String(Reflect.get(row, 'decision_digest'))),
      manifestDigest: sha256Digest(String(Reflect.get(row, 'input_manifest_digest'))),
      candidateDigest: sha256Digest(String(Reflect.get(row, 'candidate_digest'))),
    });
  } finally {
    inspected.close();
  }
}

interface AcceptanceAuthorityRowCounts {
  readonly acceptanceRepairs: number;
  readonly acceptanceDecisions: number;
  readonly acceptanceInputManifests: number;
  readonly auditEvents: number;
  readonly candidateGenerations: number;
  readonly checkSpecifications: number;
  readonly processedCommands: number;
  readonly verificationObligations: number;
  readonly workflowCloseouts: number;
}

function acceptanceAuthorityRowCounts(filename: string): AcceptanceAuthorityRowCounts {
  const inspected = new Database(filename, { readonly: true, fileMustExist: true });
  try {
    const count = (table: string): number => {
      const value = inspected.prepare(`SELECT COUNT(*) FROM ${table}`).pluck().get();
      if (typeof value !== 'number') {
        assert.fail(`Expected a numeric row count for ${table}`);
      }
      return value;
    };
    return Object.freeze({
      acceptanceRepairs: count('acceptance_repairs'),
      acceptanceDecisions: count('acceptance_decisions'),
      acceptanceInputManifests: count('acceptance_input_manifests'),
      auditEvents: count('audit_events'),
      candidateGenerations: count('candidate_generations'),
      checkSpecifications: count('check_specifications'),
      processedCommands: count('processed_commands'),
      verificationObligations: count('verification_obligations'),
      workflowCloseouts: count('workflow_closeouts'),
    });
  } finally {
    inspected.close();
  }
}

function createRetainedAcceptanceRepair(harness: Harness, label: string) {
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, `evaluate-${label}`),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  assert.equal(
    harness.store.getAcceptanceDecision(reference.id)?.outcome,
    AcceptanceOutcome.REJECT_REPAIRABLE,
  );
  assertApplied(
    harness.runtime.beginAcceptanceRepair({
      commandId: harnessCommand(harness, `repair-${label}`),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
      reason: `create retained repair authority for ${label}`,
    }),
  );
  const repair = harness.store.getAcceptanceRepairForRejectedGeneration(final.generationId);
  assert.ok(repair);
  return Object.freeze({ final, reference, repair });
}

void test('[I-001][I-006][I-008][I-009] deterministic Acceptance closes exact authority and reopens', (t) => {
  const harness = createHarness(t, { name: 'acceptance-closeout' });
  const final = advanceToFinalVerify(harness);
  const evaluationCommand = harnessCommand(harness, 'evaluate-acceptance');
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: evaluationCommand,
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const first = latestAcceptanceReference(harness);
  assert.equal(harness.store.getAcceptanceDecision(first.id)?.outcome, AcceptanceOutcome.ACCEPT);
  const readIds = new DeterministicIds('acceptance-closeout-read');
  const reads = createCodeClosureApplication({
    store: harness.store,
    clock: monotonicClock(),
    creationIds: readIds,
    digests,
    projectPaths: Object.freeze({
      parseNormalizedAbsolute: (projectPath: string) => projectPath,
    }),
    execution: Object.freeze({
      startGoal: () =>
        Promise.reject(new Error('Execution is not exercised by this closeout read fixture')),
      resumeGoal: () =>
        Promise.reject(new Error('Execution is not exercised by this closeout read fixture')),
      cancelGoal: () => {
        throw new Error('Execution is not exercised by this closeout read fixture');
      },
    }),
  });
  const acceptedStatus = reads.getGoalStatus(harness.goalId);
  assert.equal(acceptedStatus.status, 'FOUND');
  assert.equal(acceptedStatus.view.acceptanceSummary?.outcome, AcceptanceOutcome.ACCEPT);
  assert.equal(acceptedStatus.view.technicalCloseout, false);
  assert.equal(acceptedStatus.view.nextSafeAction, GoalNextSafeAction.RUNTIME_CONTINUE);
  assert.deepEqual(currentWorkflow(harness), final.workflow);
  assert.equal(harness.store.getGoal(harness.goalId)?.status, 'ACTIVE');
  assert.equal(
    harness.store.getCandidateGeneration(final.generationId)?.state,
    CandidateGenerationState.FROZEN,
  );
  assert.equal(
    harness.runtime.evaluateAcceptance({
      commandId: evaluationCommand,
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }).status,
    'REPLAYED',
  );
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-acceptance-again'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const inspected = new Database(harness.filename, { readonly: true, fileMustExist: true });
  try {
    const rows = inspected
      .prepare('SELECT id, decision_digest FROM acceptance_decisions ORDER BY id')
      .all();
    assert.equal(rows.length, 2);
    const firstRow = rows[0];
    const secondRow = rows[1];
    if (
      typeof firstRow !== 'object' ||
      firstRow === null ||
      typeof secondRow !== 'object' ||
      secondRow === null
    ) {
      assert.fail('Expected two retained Acceptance Decision rows');
    }
    assert.equal(
      Reflect.get(firstRow, 'decision_digest'),
      Reflect.get(secondRow, 'decision_digest'),
    );
    assert.notEqual(Reflect.get(firstRow, 'id'), Reflect.get(secondRow, 'id'));
  } finally {
    inspected.close();
  }
  const closeoutRequest = Object.freeze({
    commandId: harnessCommand(harness, 'close-accepted-goal'),
    goalId: harness.goalId,
    expectedGoalRevision: goalRevision(1),
    expectedWorkflowVersion: final.workflow.version,
    acceptanceDecisionId: first.id,
    acceptanceDecisionDigest: first.decisionDigest,
    inputManifestDigest: first.manifestDigest,
    candidateDigest: first.candidateDigest,
    reason: 'consume the exact current technical acceptance',
  });
  assertApplied(harness.runtime.closeAcceptedGoal(closeoutRequest));
  assert.equal(harness.runtime.closeAcceptedGoal(closeoutRequest).status, 'REPLAYED');
  const closed = currentWorkflow(harness);
  assert.equal(closed.phase, WorkflowPhase.CLOSEOUT);
  assert.equal(closed.runStatus, RunStatus.CLOSED);
  assert.equal(harness.store.getGoal(harness.goalId)?.status, 'CLOSED');
  assert.equal(
    harness.store.getCandidateGeneration(final.generationId)?.state,
    CandidateGenerationState.ACCEPTED,
  );
  assert.equal(harness.store.getCloseoutForWorkflow(closed.id)?.acceptanceDecisionId, first.id);
  const closedStatus = reads.getGoalStatus(harness.goalId);
  assert.equal(closedStatus.status, 'FOUND');
  assert.equal(closedStatus.view.technicalCloseout, true);
  assert.equal(closedStatus.view.closeoutRef?.acceptanceDecisionId, first.id);
  assert.equal(closedStatus.view.nextSafeAction, GoalNextSafeAction.NO_ACTION);
  const closedAudit = reads.getGoalAudit(harness.goalId);
  assert.equal(closedAudit.status, 'FOUND');
  assert.equal(
    closedAudit.view.events.some((event) => event.eventType === 'WORKFLOW_CLOSEOUT_RECORDED'),
    true,
  );

  harness.store.close();
  const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(closed.id)?.runStatus, RunStatus.CLOSED);
  assert.equal(
    reopened.getCloseoutForWorkflow(closed.id)?.acceptanceDecisionDigest,
    first.decisionDigest,
  );
  const reopenedReadIds = new DeterministicIds('acceptance-closeout-reopened-read');
  const reopenedReads = createCodeClosureApplication({
    store: reopened,
    clock: monotonicClock(),
    creationIds: reopenedReadIds,
    digests,
    projectPaths: Object.freeze({
      parseNormalizedAbsolute: (projectPath: string) => projectPath,
    }),
    execution: Object.freeze({
      startGoal: () =>
        Promise.reject(new Error('Execution is not exercised by this reopened read fixture')),
      resumeGoal: () =>
        Promise.reject(new Error('Execution is not exercised by this reopened read fixture')),
      cancelGoal: () => {
        throw new Error('Execution is not exercised by this reopened read fixture');
      },
    }),
  });
  const reopenedStatus = reopenedReads.getGoalStatus(harness.goalId);
  assert.equal(reopenedStatus.status, 'FOUND');
  assert.equal(reopenedStatus.view.technicalCloseout, true);
});

void test('[I-006][I-009] reopen rejects ACCEPTED Candidate authority without closeout', (t) => {
  const harness = createHarness(t, { name: 'accepted-without-closeout-reopen' });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-before-offline-accept'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  assert.equal(
    harness.store.getAcceptanceDecision(latestAcceptanceReference(harness).id)?.outcome,
    AcceptanceOutcome.ACCEPT,
  );
  harness.store.close();
  appendOfflineFrozenTerminalTransition(
    harness.filename,
    final.generationId,
    CandidateGenerationState.ACCEPTED,
    'accepted-without-closeout-poison',
  );

  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /accepted Candidate generation has no immutable closeout authority/,
  );
});

void test('[I-006][I-008][I-009] reopen rejects closeout with a divergent Goal time', (t) => {
  const harness = createHarness(t, { name: 'closeout-goal-time-reopen' });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-before-closeout-time-poison'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  assertApplied(
    harness.runtime.closeAcceptedGoal({
      commandId: harnessCommand(harness, 'close-before-goal-time-poison'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
      reason: 'close valid authority before retained time corruption',
    }),
  );
  harness.store.close();
  const raw = new Database(harness.filename);
  raw
    .prepare('UPDATE goals SET updated_at = ? WHERE id = ?')
    .run(isoTimestamp('2026-07-27T00:20:00.000Z'), harness.goalId);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /Workflow closeout .* lacks exact retained authority/,
  );
});

void test('[I-005][I-008][I-009] source drift after ACCEPT invalidates authority instead of closing', (t) => {
  const harness = createHarness(t, { name: 'acceptance-closeout-source-drift' });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-before-source-drift'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  assert.equal(
    harness.store.getAcceptanceDecision(reference.id)?.outcome,
    AcceptanceOutcome.ACCEPT,
  );
  harness.candidateSource.simulateFrozenDrift(final.generationId);

  assertApplied(
    harness.runtime.closeAcceptedGoal({
      commandId: harnessCommand(harness, 'reject-closeout-after-source-drift'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
      reason: 'source reality changed after technical evaluation',
    }),
  );

  const failed = currentWorkflow(harness);
  assert.equal(failed.phase, WorkflowPhase.FINAL_VERIFY);
  assert.equal(failed.runStatus, RunStatus.FAILED);
  assert.notEqual(harness.store.getGoal(harness.goalId)?.status, 'CLOSED');
  assert.equal(
    harness.store.getCandidateGeneration(final.generationId)?.state,
    CandidateGenerationState.INVALIDATED,
  );
  assert.equal(harness.store.getCloseoutForWorkflow(final.workflow.id), undefined);
  assert.ok(
    harness.store
      .listEvidenceForGeneration(final.generationId)
      .every(({ eligibility }) => eligibility.state === EvidenceEligibilityState.INELIGIBLE),
  );

  harness.store.close();
  const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(harness.workflowId)?.runStatus, RunStatus.FAILED);
  assert.equal(
    reopened.getCandidateGeneration(final.generationId)?.state,
    CandidateGenerationState.INVALIDATED,
  );
  assert.equal(reopened.getAcceptanceDecision(reference.id)?.outcome, AcceptanceOutcome.ACCEPT);
  assert.equal(reopened.getCloseoutForWorkflow(harness.workflowId), undefined);
});

void test('[I-003][I-008][I-009] closeout rejects every caller-supplied Acceptance binding mismatch', (t) => {
  const harness = createHarness(t, { name: 'acceptance-closeout-binding-mismatch' });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-before-binding-mismatch'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  const mismatches = Object.freeze([
    {
      label: 'decision-id',
      acceptanceDecisionId: acceptanceDecisionId('acceptance_missing-closeout-decision'),
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
    },
    {
      label: 'decision-digest',
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: digests.digest({ mismatch: 'decision' }),
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
    },
    {
      label: 'manifest-digest',
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: digests.digest({ mismatch: 'manifest' }),
      candidateDigest: reference.candidateDigest,
    },
    {
      label: 'candidate-digest',
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: digests.digest({ mismatch: 'candidate' }),
    },
  ]);
  for (const mismatch of mismatches) {
    const result = harness.runtime.closeAcceptedGoal({
      commandId: harnessCommand(harness, `closeout-mismatch-${mismatch.label}`),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
      acceptanceDecisionId: mismatch.acceptanceDecisionId,
      acceptanceDecisionDigest: mismatch.acceptanceDecisionDigest,
      inputManifestDigest: mismatch.inputManifestDigest,
      candidateDigest: mismatch.candidateDigest,
      reason: 'a mismatched binding must never close',
    });
    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(currentWorkflow(harness), final.workflow);
    assert.equal(
      harness.store.getCandidateGeneration(final.generationId)?.state,
      CandidateGenerationState.FROZEN,
    );
    assert.equal(harness.store.getCloseoutForWorkflow(final.workflow.id), undefined);
  }
});

void test('[I-001][I-005][I-008][I-009] repairable rejection creates a fresh child generation and reopens', (t) => {
  const harness = createHarness(t, {
    name: 'acceptance-repair',
    verificationFixture: FakeVerificationFixture.FAIL,
  });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-repairable'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  assert.equal(
    harness.store.getAcceptanceDecision(reference.id)?.outcome,
    AcceptanceOutcome.REJECT_REPAIRABLE,
  );
  const oldGeneration = harness.store.getCandidateGeneration(final.generationId);
  assert.ok(oldGeneration?.frozenDigest);
  const repairRequest = Object.freeze({
    commandId: harnessCommand(harness, 'begin-repair'),
    goalId: harness.goalId,
    expectedGoalRevision: goalRevision(1),
    expectedWorkflowVersion: final.workflow.version,
    acceptanceDecisionId: reference.id,
    acceptanceDecisionDigest: reference.decisionDigest,
    inputManifestDigest: reference.manifestDigest,
    candidateDigest: reference.candidateDigest,
    reason: 'repair the failed required Evidence',
  });
  assertApplied(harness.runtime.beginAcceptanceRepair(repairRequest));
  assert.equal(harness.runtime.beginAcceptanceRepair(repairRequest).status, 'REPLAYED');
  const repairedWorkflow = currentWorkflow(harness);
  assert.equal(repairedWorkflow.phase, WorkflowPhase.IMPLEMENT);
  assert.equal(
    harness.store.getCandidateGeneration(final.generationId)?.state,
    CandidateGenerationState.REJECTED,
  );
  assert.ok(repairedWorkflow.activeCandidateGenerationId);
  const child = harness.store.getCandidateGeneration(repairedWorkflow.activeCandidateGenerationId);
  assert.ok(child);
  assert.equal(child.state, CandidateGenerationState.MUTABLE);
  assert.equal(child.parentGenerationId, final.generationId);
  assert.equal(child.baseDigest, oldGeneration.frozenDigest);
  assert.equal(
    harness.store
      .listCheckSpecifications()
      .filter((specification) => specification.inputRefs.includes(child.id)).length,
    2,
  );
  assert.equal(
    harness.store
      .listVerificationObligations(harness.goalId)
      .filter((obligation) => obligation.candidateGenerationId === child.id).length,
    1,
  );
  const repair = harness.store.getAcceptanceRepairForRejectedGeneration(final.generationId);
  assert.ok(repair);
  assert.equal(repair.acceptanceDecisionId, reference.id);
  assert.equal(repair.acceptanceDecisionDigest, reference.decisionDigest);
  assert.equal(repair.inputManifestDigest, reference.manifestDigest);
  assert.equal(repair.rejectedCandidateDigest, reference.candidateDigest);
  assert.equal(repair.repairCandidateGenerationId, child.id);
  assert.equal(repair.repairCandidateBaseDigest, oldGeneration.frozenDigest);
  assert.deepEqual(
    repair.verificationObligationIds,
    harness.store
      .listVerificationObligations(harness.goalId)
      .filter((obligation) => obligation.candidateGenerationId === child.id)
      .map((obligation) => obligation.id),
  );

  harness.store.close();
  const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.equal(reopened.getWorkflow(harness.workflowId)?.phase, WorkflowPhase.IMPLEMENT);
  assert.equal(
    reopened.getCandidateGeneration(final.generationId)?.state,
    CandidateGenerationState.REJECTED,
  );
  assert.equal(reopened.getCandidateGeneration(child.id)?.parentGenerationId, final.generationId);
  assert.deepEqual(reopened.getAcceptanceRepairForRejectedGeneration(final.generationId), repair);
});

void test('[I-006][I-009][I-013] retained repair authority survives child progress and another repair', (t) => {
  const harness = createHarness(t, {
    name: 'acceptance-repair-history',
    verificationFixture: FakeVerificationFixture.FAIL,
  });
  const firstFinal = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-first-repair'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: firstFinal.workflow.version,
    }),
  );
  const firstReference = latestAcceptanceReference(harness);
  assertApplied(
    harness.runtime.beginAcceptanceRepair({
      commandId: harnessCommand(harness, 'begin-first-repair'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: firstFinal.workflow.version,
      acceptanceDecisionId: firstReference.id,
      acceptanceDecisionDigest: firstReference.decisionDigest,
      inputManifestDigest: firstReference.manifestDigest,
      candidateDigest: firstReference.candidateDigest,
      reason: 'create the first exact repair authority',
    }),
  );
  const firstRepair = harness.store.getAcceptanceRepairForRejectedGeneration(
    firstFinal.generationId,
  );
  assert.ok(firstRepair);

  const secondFinal = advanceRepairChildToFinalVerify(harness, 'second-generation');
  assert.equal(secondFinal.generationId, firstRepair.repairCandidateGenerationId);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-second-repair'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: secondFinal.workflow.version,
    }),
  );
  const secondReference = latestAcceptanceReference(harness);
  assertApplied(
    harness.runtime.beginAcceptanceRepair({
      commandId: harnessCommand(harness, 'begin-second-repair'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: secondFinal.workflow.version,
      acceptanceDecisionId: secondReference.id,
      acceptanceDecisionDigest: secondReference.decisionDigest,
      inputManifestDigest: secondReference.manifestDigest,
      candidateDigest: secondReference.candidateDigest,
      reason: 'create another exact repair without invalidating retained history',
    }),
  );
  const secondRepair = harness.store.getAcceptanceRepairForRejectedGeneration(
    secondFinal.generationId,
  );
  assert.ok(secondRepair);
  const current = currentWorkflow(harness);
  assert.equal(current.phase, WorkflowPhase.IMPLEMENT);
  assert.equal(current.activeCandidateGenerationId, secondRepair.repairCandidateGenerationId);

  harness.store.close();
  const reopened = openSqliteControlStore({ filename: harness.filename, now: () => createdAt });
  t.after(() => reopened.close());
  assert.deepEqual(
    reopened.getAcceptanceRepairForRejectedGeneration(firstFinal.generationId),
    firstRepair,
  );
  assert.deepEqual(
    reopened.getAcceptanceRepairForRejectedGeneration(secondFinal.generationId),
    secondRepair,
  );
  assert.equal(
    reopened.getCandidateGeneration(firstFinal.generationId)?.state,
    CandidateGenerationState.REJECTED,
  );
  assert.equal(
    reopened.getCandidateGeneration(secondFinal.generationId)?.state,
    CandidateGenerationState.REJECTED,
  );
  assert.equal(
    reopened.getCandidateGeneration(secondRepair.repairCandidateGenerationId)?.state,
    CandidateGenerationState.MUTABLE,
  );
});

void test('[I-003][I-008][I-009] repair rejects every caller-supplied Acceptance binding mismatch', (t) => {
  const harness = createHarness(t, {
    name: 'acceptance-repair-binding-mismatch',
    verificationFixture: FakeVerificationFixture.FAIL,
  });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-before-repair-mismatch'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  const mismatches = Object.freeze([
    {
      label: 'decision-id',
      acceptanceDecisionId: acceptanceDecisionId('acceptance_missing-repair-decision'),
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
    },
    {
      label: 'decision-digest',
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: digests.digest({ mismatch: 'repair-decision' }),
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
    },
    {
      label: 'manifest-digest',
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: digests.digest({ mismatch: 'repair-manifest' }),
      candidateDigest: reference.candidateDigest,
    },
    {
      label: 'candidate-digest',
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: digests.digest({ mismatch: 'repair-candidate' }),
    },
  ]);
  for (const mismatch of mismatches) {
    const result = harness.runtime.beginAcceptanceRepair({
      commandId: harnessCommand(harness, `repair-mismatch-${mismatch.label}`),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
      acceptanceDecisionId: mismatch.acceptanceDecisionId,
      acceptanceDecisionDigest: mismatch.acceptanceDecisionDigest,
      inputManifestDigest: mismatch.inputManifestDigest,
      candidateDigest: mismatch.candidateDigest,
      reason: 'a mismatched binding must never grant fresh implementation authority',
    });
    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(currentWorkflow(harness), final.workflow);
    assert.equal(
      harness.store.getCandidateGeneration(final.generationId)?.state,
      CandidateGenerationState.FROZEN,
    );
    assert.equal(
      harness.store.getAcceptanceRepairForRejectedGeneration(final.generationId),
      undefined,
    );
  }
  const candidate = harness.store.getCandidateForGoal(harness.goalId);
  assert.ok(candidate);
  assert.equal(harness.store.nextCandidateGenerationSequence(candidate.id), 2);
});

void test('[I-006][I-008][I-009] reopen recomputes immutable Acceptance repair identity', (t) => {
  const harness = createHarness(t, {
    name: 'acceptance-repair-record-poison',
    verificationFixture: FakeVerificationFixture.FAIL,
  });
  const { repair } = createRetainedAcceptanceRepair(harness, 'before-record-poison');
  harness.store.close();

  const raw = new Database(harness.filename);
  assert.throws(
    () =>
      raw
        .prepare(
          `UPDATE acceptance_repairs
              SET repair_digest = ?
            WHERE rejected_candidate_generation_id = ?`,
        )
        .run(
          digests.digest({ forbidden: 'immutable-repair-rewrite' }),
          repair.rejectedCandidateGenerationId,
        ),
    /Acceptance repairs are immutable/,
  );
  raw.exec('DROP TRIGGER acceptance_repairs_no_update');
  raw
    .prepare(
      `UPDATE acceptance_repairs
          SET repair_digest = ?
        WHERE rejected_candidate_generation_id = ?`,
    )
    .run(digests.digest({ poison: 'repair-record-digest' }), repair.rejectedCandidateGenerationId);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /Acceptance repair .* lacks exact retained authority/,
  );
});

void test('[I-006][I-008][I-009] reopen rejects a repair record detached from its audit command', (t) => {
  const harness = createHarness(t, {
    name: 'acceptance-repair-audit-poison',
    verificationFixture: FakeVerificationFixture.FAIL,
  });
  const { repair } = createRetainedAcceptanceRepair(harness, 'before-audit-poison');
  harness.store.close();

  const raw = new Database(harness.filename);
  assert.throws(
    () =>
      raw
        .prepare(
          `UPDATE audit_events
              SET payload_digest = ?
            WHERE aggregate_type = 'ACCEPTANCE_REPAIR' AND aggregate_id = ?`,
        )
        .run(
          digests.digest({ forbidden: 'immutable-repair-audit-rewrite' }),
          repair.rejectedCandidateGenerationId,
        ),
    /audit events are immutable/,
  );
  raw.exec('DROP TRIGGER audit_events_no_update');
  raw
    .prepare(
      `UPDATE audit_events
          SET payload_digest = ?
        WHERE aggregate_type = 'ACCEPTANCE_REPAIR' AND aggregate_id = ?`,
    )
    .run(digests.digest({ poison: 'repair-audit-digest' }), repair.rejectedCandidateGenerationId);
  raw.close();

  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /Acceptance repair .* lacks exact retained authority/,
  );
});

void test('[I-006][I-009] reopen rejects REJECTED Candidate authority without a repair child', (t) => {
  const harness = createHarness(t, {
    name: 'rejected-without-repair-child-reopen',
    verificationFixture: FakeVerificationFixture.FAIL,
  });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-before-offline-reject'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  assert.equal(
    harness.store.getAcceptanceDecision(latestAcceptanceReference(harness).id)?.outcome,
    AcceptanceOutcome.REJECT_REPAIRABLE,
  );
  harness.store.close();
  appendOfflineFrozenTerminalTransition(
    harness.filename,
    final.generationId,
    CandidateGenerationState.REJECTED,
    'rejected-without-repair-child-poison',
  );

  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /rejected Candidate generation has no immutable Acceptance repair authority/,
  );
});

void test('[I-005][I-008][I-009] source drift after repairable rejection invalidates instead of branching', (t) => {
  const harness = createHarness(t, {
    name: 'acceptance-repair-source-drift',
    verificationFixture: FakeVerificationFixture.FAIL,
  });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-before-repair-source-drift'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  assert.equal(
    harness.store.getAcceptanceDecision(reference.id)?.outcome,
    AcceptanceOutcome.REJECT_REPAIRABLE,
  );
  harness.candidateSource.simulateFrozenDrift(final.generationId);

  assertApplied(
    harness.runtime.beginAcceptanceRepair({
      commandId: harnessCommand(harness, 'reject-repair-after-source-drift'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
      reason: 'source reality changed after repairable evaluation',
    }),
  );

  const failed = currentWorkflow(harness);
  assert.equal(failed.phase, WorkflowPhase.FINAL_VERIFY);
  assert.equal(failed.runStatus, RunStatus.FAILED);
  assert.equal(
    harness.store.getCandidateGeneration(final.generationId)?.state,
    CandidateGenerationState.INVALIDATED,
  );
  const candidate = harness.store.getCandidateForGoal(harness.goalId);
  assert.ok(candidate);
  assert.equal(harness.store.nextCandidateGenerationSequence(candidate.id), 2);
  assert.equal(failed.activeCandidateGenerationId, final.generationId);
});

const acceptanceEvaluationRollbackSteps = Object.freeze([
  AcceptanceTransactionStep.AFTER_ACCEPTANCE_MANIFEST_WRITE,
  AcceptanceTransactionStep.AFTER_ACCEPTANCE_DECISION_WRITE,
  TransactionStep.AFTER_COMMAND_RECORD,
  TransactionStep.BEFORE_COMMIT,
]);

for (const [probeIndex, injectedStep] of acceptanceEvaluationRollbackSteps.entries()) {
  void test(`[I-008] Acceptance evaluation fully rolls back at ${injectedStep}`, (t) => {
    let armed = false;
    const harness = createHarness(t, {
      name: `acceptance-evaluation-rollback-${probeIndex}`,
      transactionProbe: (step) => {
        if (armed && step === injectedStep) {
          throw new Error(`injected Acceptance evaluation failure at ${injectedStep}`);
        }
      },
    });
    const final = advanceToFinalVerify(harness);
    const before = acceptanceAuthorityRowCounts(harness.filename);
    const commandIdentifier = harnessCommand(harness, `evaluate-rollback-${probeIndex}`);
    armed = true;
    const result = harness.runtime.evaluateAcceptance({
      commandId: commandIdentifier,
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    });
    armed = false;
    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(currentWorkflow(harness), final.workflow);
    assert.equal(harness.store.getProcessedCommand(commandIdentifier), undefined);
    assert.deepEqual(acceptanceAuthorityRowCounts(harness.filename), before);
  });
}

const acceptedCloseoutRollbackSteps = Object.freeze([
  CandidateEvidenceTransactionStep.AFTER_CANDIDATE_TRANSITION,
  TransactionStep.AFTER_STATE_WRITE,
  AcceptanceTransactionStep.AFTER_CLOSEOUT_WRITE,
  TransactionStep.AFTER_AUDIT_APPEND,
  TransactionStep.AFTER_COMMAND_RECORD,
  TransactionStep.BEFORE_COMMIT,
]);

for (const [probeIndex, injectedStep] of acceptedCloseoutRollbackSteps.entries()) {
  void test(`[I-008] accepted closeout fully rolls back at ${injectedStep}`, (t) => {
    let armed = false;
    const harness = createHarness(t, {
      name: `acceptance-closeout-rollback-${probeIndex}`,
      transactionProbe: (step) => {
        if (armed && step === injectedStep) {
          throw new Error(`injected closeout failure at ${injectedStep}`);
        }
      },
    });
    const final = advanceToFinalVerify(harness);
    assertApplied(
      harness.runtime.evaluateAcceptance({
        commandId: harnessCommand(harness, `evaluate-before-closeout-rollback-${probeIndex}`),
        goalId: harness.goalId,
        expectedGoalRevision: goalRevision(1),
        expectedWorkflowVersion: final.workflow.version,
      }),
    );
    const reference = latestAcceptanceReference(harness);
    const before = acceptanceAuthorityRowCounts(harness.filename);
    const commandIdentifier = harnessCommand(harness, `closeout-rollback-${probeIndex}`);
    armed = true;
    const result = harness.runtime.closeAcceptedGoal({
      commandId: commandIdentifier,
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
      reason: 'inject closeout rollback',
    });
    armed = false;
    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(currentWorkflow(harness), final.workflow);
    assert.equal(harness.store.getGoal(harness.goalId)?.status, 'ACTIVE');
    assert.equal(
      harness.store.getCandidateGeneration(final.generationId)?.state,
      CandidateGenerationState.FROZEN,
    );
    assert.equal(harness.store.getCloseoutForWorkflow(final.workflow.id), undefined);
    assert.equal(harness.store.getProcessedCommand(commandIdentifier), undefined);
    assert.deepEqual(acceptanceAuthorityRowCounts(harness.filename), before);
  });
}

const acceptanceRepairRollbackSteps = Object.freeze([
  CandidateEvidenceTransactionStep.AFTER_CANDIDATE_TRANSITION,
  AcceptanceTransactionStep.AFTER_REPAIR_GENERATION_WRITE,
  AcceptanceTransactionStep.AFTER_REPAIR_CHECK_SPECIFICATION_WRITE,
  AcceptanceTransactionStep.AFTER_REPAIR_OBLIGATION_WRITE,
  TransactionStep.AFTER_STATE_WRITE,
  AcceptanceTransactionStep.AFTER_REPAIR_RECORD_WRITE,
  TransactionStep.AFTER_AUDIT_APPEND,
  TransactionStep.AFTER_COMMAND_RECORD,
  TransactionStep.BEFORE_COMMIT,
]);

for (const [probeIndex, injectedStep] of acceptanceRepairRollbackSteps.entries()) {
  void test(`[I-008] Acceptance repair fully rolls back at ${injectedStep}`, (t) => {
    let armed = false;
    const harness = createHarness(t, {
      name: `acceptance-repair-rollback-${probeIndex}`,
      verificationFixture: FakeVerificationFixture.FAIL,
      transactionProbe: (step) => {
        if (armed && step === injectedStep) {
          throw new Error(`injected repair failure at ${injectedStep}`);
        }
      },
    });
    const final = advanceToFinalVerify(harness);
    assertApplied(
      harness.runtime.evaluateAcceptance({
        commandId: harnessCommand(harness, `evaluate-before-repair-rollback-${probeIndex}`),
        goalId: harness.goalId,
        expectedGoalRevision: goalRevision(1),
        expectedWorkflowVersion: final.workflow.version,
      }),
    );
    const reference = latestAcceptanceReference(harness);
    const before = acceptanceAuthorityRowCounts(harness.filename);
    const commandIdentifier = harnessCommand(harness, `repair-rollback-${probeIndex}`);
    armed = true;
    const result = harness.runtime.beginAcceptanceRepair({
      commandId: commandIdentifier,
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
      acceptanceDecisionId: reference.id,
      acceptanceDecisionDigest: reference.decisionDigest,
      inputManifestDigest: reference.manifestDigest,
      candidateDigest: reference.candidateDigest,
      reason: 'inject repair rollback',
    });
    armed = false;
    assert.equal(result.status, 'REJECTED');
    assert.deepEqual(currentWorkflow(harness), final.workflow);
    assert.equal(
      harness.store.getCandidateGeneration(final.generationId)?.state,
      CandidateGenerationState.FROZEN,
    );
    const candidate = harness.store.getCandidateForGoal(harness.goalId);
    assert.ok(candidate);
    assert.equal(harness.store.nextCandidateGenerationSequence(candidate.id), 2);
    assert.equal(harness.store.getProcessedCommand(commandIdentifier), undefined);
    assert.deepEqual(acceptanceAuthorityRowCounts(harness.filename), before);
  });
}

void test('[I-001][I-009] runner error produces ENGINE_ERROR and cannot be consumed as repair', (t) => {
  const harness = createHarness(t, {
    name: 'acceptance-engine-error',
    verificationFixture: FakeVerificationFixture.RUNNER_ERROR,
  });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-engine-error'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  assert.equal(
    harness.store.getAcceptanceDecision(reference.id)?.outcome,
    AcceptanceOutcome.ENGINE_ERROR,
  );
  const result = harness.runtime.beginAcceptanceRepair({
    commandId: harnessCommand(harness, 'forbidden-engine-error-repair'),
    goalId: harness.goalId,
    expectedGoalRevision: goalRevision(1),
    expectedWorkflowVersion: final.workflow.version,
    acceptanceDecisionId: reference.id,
    acceptanceDecisionDigest: reference.decisionDigest,
    inputManifestDigest: reference.manifestDigest,
    candidateDigest: reference.candidateDigest,
    reason: 'engine errors are not repair authority',
  });
  assert.equal(result.status, 'REJECTED');
  assert.deepEqual(currentWorkflow(harness), final.workflow);
  assert.equal(
    harness.store.getCandidateGeneration(final.generationId)?.state,
    CandidateGenerationState.FROZEN,
  );
});

void test('[I-001][I-006][I-008] direct Store caller cannot persist a forged Acceptance Decision', (t) => {
  const harness = createHarness(t, { name: 'acceptance-forged-decision' });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-before-forgery'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  const manifest = harness.store.getAcceptanceInputManifest(reference.manifestDigest);
  const decision = harness.store.getAcceptanceDecision(reference.id);
  assert.ok(manifest && decision);
  const authority = harness.store.getAcceptanceAuthorityForWorkflow(
    final.workflow.id,
    manifest.policyBundleId,
  );
  assert.ok(authority);
  const compiled = compileM1AcceptanceInput(authority, manifest.createdAt, digests);
  const forgedBase = Object.freeze({
    ...decision,
    id: harness.ids.nextAcceptanceDecisionId(),
    ruleResults: Object.freeze(
      decision.ruleResults.map((result, index) =>
        index === 0 ? Object.freeze({ ...result, message: 'forged passing explanation' }) : result,
      ),
    ),
  });
  const forged = decodeAcceptanceDecision({
    ...forgedBase,
    decisionDigest: digests.digest(acceptanceDecisionProjection(forgedBase)),
  });
  const commandIdentifier = harnessCommand(harness, 'direct-forged-evaluation');
  assert.throws(
    () =>
      harness.store.commitAcceptanceEvaluation({
        commandId: commandIdentifier,
        inputDigest: digests.digest({ type: 'DIRECT_FORGED_ACCEPTANCE' }),
        target: { aggregateType: 'GOAL', aggregateId: harness.goalId },
        manifest,
        pendingIssueSet: compiled.pendingIssueSet,
        decision: forged,
        manifestAuditEventId: harness.ids.nextAuditEventId(),
        decisionAuditEventId: harness.ids.nextAuditEventId(),
      }),
    /does not match the built-in M1 engine result/,
  );
  assert.equal(harness.store.getAcceptanceDecision(forged.id), undefined);
  assert.equal(harness.store.getProcessedCommand(commandIdentifier), undefined);
});

void test('[I-006][I-009] reopen rejects a retained Acceptance Decision whose semantics were rewritten', (t) => {
  const harness = createHarness(t, { name: 'acceptance-poisoned-reopen' });
  const final = advanceToFinalVerify(harness);
  assertApplied(
    harness.runtime.evaluateAcceptance({
      commandId: harnessCommand(harness, 'evaluate-before-poison'),
      goalId: harness.goalId,
      expectedGoalRevision: goalRevision(1),
      expectedWorkflowVersion: final.workflow.version,
    }),
  );
  const reference = latestAcceptanceReference(harness);
  harness.store.close();
  const raw = new Database(harness.filename);
  raw.exec('DROP TRIGGER acceptance_decisions_no_update');
  raw
    .prepare('UPDATE acceptance_decisions SET dominant_reason_code = ? WHERE id = ?')
    .run('FORGED_DOMINANT_REASON', reference.id);
  raw.close();
  assert.throws(
    () => openSqliteControlStore({ filename: harness.filename, now: () => createdAt }),
    /Acceptance dominant reason does not match Rule Results|AcceptanceDecision/,
  );
});
