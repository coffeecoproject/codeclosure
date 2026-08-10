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
  GuardOutcome,
  RunStatus,
  WorkflowGuard,
  WorkflowPhase,
  commandId,
  createGoal,
  createWorkflow,
  decodePolicyBundle,
  executionProfileProjection,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleId,
  policyBundleProjection,
  requiredGuardsForTransition,
  sha256Digest,
  successCriterionId,
  workflowId,
  type PolicyBundleDefinition,
  type AttemptId,
  type CandidateGenerationId,
  type Sha256Digest,
} from '@codeclosure/domain';
import {
  CandidateChangeFileMode,
  CandidateChangeKind,
  CandidateSourceFailureCode,
  CanonicalJsonSha256DigestProvider,
  MinimalContextCompiler,
  Rfc8785Canonicalizer,
  createCandidateChangeSetV2,
  createExecutionProfileInstaller,
  createPolicyInstaller,
  goalAndWorkflowCreationPayloadProjection,
  validateCandidateFreezeRequestV2,
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

function runToFreeze(
  t: TestContext,
  namespace: string,
  fixture: FreezeFixture,
): Readonly<{
  filename: string;
  store: ReturnType<typeof openSqliteControlStore>;
  goalIdentifier: ReturnType<typeof goalId>;
  workflowIdentifier: ReturnType<typeof workflowId>;
  generationId: CandidateGenerationId;
  freezeAttemptId: AttemptId;
}> {
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
  assert.equal(
    runtime.startGoal({
      commandId: commandId(`command_${namespace}-start`),
      goalId: goal.id,
      expectedGoalRevision: goal.revision,
      expectedWorkflowVersion: current.version,
    }).status,
    'APPLIED',
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
  assert.equal(
    runtime.beginAttempt({
      commandId: commandId(`command_${namespace}-plan-start`),
      workflowId: workflow.id,
      expectedWorkflowVersion: current.version,
    }).status,
    'APPLIED',
  );
  current = store.getWorkflow(workflow.id);
  assert.ok(current?.activeAttemptId);
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
  const preparation = runtime.requestPhaseTransition({
    commandId: commandId(`command_${namespace}-to-implement`),
    workflowId: workflow.id,
    expectedWorkflowVersion: current.version,
    requestedPhase: WorkflowPhase.IMPLEMENT,
    reason: 'plan completed',
  });
  assert.equal(preparation.status, 'APPLIED', JSON.stringify(preparation));
  current = store.getWorkflow(workflow.id);
  assert.ok(current);
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
    filename,
    store,
    goalIdentifier: goal.id,
    workflowIdentifier: workflow.id,
    generationId,
    freezeAttemptId,
  });
}

void test('[I-005][I-006][I-008][I-009] C11 Profile freeze-v2 authority closes and strictly reopens without Fake evidence', (t) => {
  const harness = runToFreeze(t, 'm251-freeze-v2-success', 'IN_SCOPE');
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
    readonly fixture: Exclude<FreezeFixture, 'IN_SCOPE'>;
    readonly failureClass: AttemptFailureClass;
    readonly reason: string;
  }[];

  for (const entry of cases) {
    await t.test(entry.fixture, (fixtureTest) => {
      const namespace = `m251-freeze-v2-${entry.fixture.toLowerCase().replaceAll('_', '-')}`;
      const harness = runToFreeze(fixtureTest, namespace, entry.fixture);
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
