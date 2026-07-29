import assert from 'node:assert/strict';
import test from 'node:test';

import {
  GuardOutcome,
  RunStatus,
  WorkflowPhase,
  candidateGenerationId,
  decodePolicyBundle,
  goalId,
  goalRevision,
  isoTimestamp,
  policyBundleProjection,
  requiredGuardsForTransition,
  sha256Digest,
  workflowId,
  workflowVersion,
  type WorkflowInstance,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M1_ACCEPTANCE_RULES,
  M1_POLICY_BUNDLE_ID,
  M1_POLICY_BUNDLE_VERSION,
  createM1AcceptanceCheckerIdentity,
  createM1PolicyBundleDefinition,
  validateM1AcceptancePolicyBundle,
} from '@codeclosure/runtime';
import { createM1DeterministicPhaseGuardEvaluator } from '@codeclosure/runtime/composition';
import { isRuntimeOwnedPhaseGuard } from '@codeclosure/runtime/testing/workflow-runtime';

import { FakeCandidateSource, FakeCandidateSourceFixture } from '../src/fake-candidate-source.ts';
import { FakeVerificationFixture } from '../src/fake-verification-runner.ts';
import { FakeWorkerFixture } from '../src/fake-worker.ts';
import {
  M1FakeExecutionProfileName,
  m1FakeExecutionProfileRecipe,
  m1FakeExecutionProfileRecipes,
} from '../dist/m1-execution-profile-registry.js';

const workflowFixture: WorkflowInstance = Object.freeze({
  id: workflowId('workflow_m1-composition-foundations'),
  goalId: goalId('goal_m1-composition-foundations'),
  goalRevision: goalRevision(1),
  phase: WorkflowPhase.DISCOVERY,
  runStatus: RunStatus.READY,
  version: workflowVersion(1),
  createdAt: isoTimestamp('2026-07-29T00:00:00.000Z'),
  updatedAt: isoTimestamp('2026-07-29T00:00:00.000Z'),
});

void test('[I-003][I-012] built-in M1 Policy binds the exact Acceptance authority', () => {
  const digests = new CanonicalJsonSha256DigestProvider();
  const definition = createM1PolicyBundleDefinition(digests);
  const bundle = decodePolicyBundle({
    ...definition,
    digest: sha256Digest(digests.digest(policyBundleProjection(definition))),
  });

  assert.equal(Object.isFrozen(definition), true);
  assert.equal(definition.id, M1_POLICY_BUNDLE_ID);
  assert.equal(definition.version, M1_POLICY_BUNDLE_VERSION);
  assert.deepEqual(definition.acceptanceRules, M1_ACCEPTANCE_RULES);
  assert.deepEqual(definition.checkerVersions, [createM1AcceptanceCheckerIdentity(digests)]);
  assert.deepEqual(
    validateM1AcceptancePolicyBundle(bundle, digests),
    definition.checkerVersions[0],
  );
});

void test('[I-002][I-003] deterministic M1 guards never impersonate Runtime authority', () => {
  const evaluator = createM1DeterministicPhaseGuardEvaluator();
  const transitions = [
    [WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN],
    [WorkflowPhase.PLAN, WorkflowPhase.IMPLEMENT],
    [WorkflowPhase.IMPLEMENT, WorkflowPhase.SOURCE_FREEZE],
    [WorkflowPhase.SOURCE_FREEZE, WorkflowPhase.EVIDENCE_BUILD],
    [WorkflowPhase.EVIDENCE_BUILD, WorkflowPhase.FINAL_VERIFY],
    [WorkflowPhase.FINAL_VERIFY, WorkflowPhase.CLOSEOUT],
    [WorkflowPhase.FINAL_VERIFY, WorkflowPhase.IMPLEMENT],
  ] as const;

  for (const [from, to] of transitions) {
    const required = requiredGuardsForTransition(from, to);
    assert.notEqual(required, undefined);
    const expected = required?.filter((guard) => !isRuntimeOwnedPhaseGuard(guard));
    const results = evaluator.evaluate({
      workflow: Object.freeze({ ...workflowFixture, phase: from }),
      requestedPhase: to,
    });
    assert.equal(Array.isArray(results), true);
    assert.deepEqual(
      results,
      expected?.map((guard) => ({
        guard,
        outcome: GuardOutcome.PASS,
        reasonCode: 'M1_DETERMINISTIC_SKELETON_GUARD',
        supportingRefs: [`m1:deterministic-guard:${guard}`],
      })),
    );
  }
});

void test('[I-013] M1 Fake profile registry is closed, unique, and behavior-bound', () => {
  const recipes = m1FakeExecutionProfileRecipes();
  assert.equal(Object.isFrozen(recipes), true);
  assert.deepEqual(
    recipes.map(({ name }) => name),
    [
      M1FakeExecutionProfileName.HAPPY_PATH,
      M1FakeExecutionProfileName.LYING_WORKER,
      M1FakeExecutionProfileName.MISSING_EVIDENCE,
      M1FakeExecutionProfileName.FAILING_EVIDENCE,
      M1FakeExecutionProfileName.STALE_CLOSEOUT,
      M1FakeExecutionProfileName.RESTART_RESUME,
      M1FakeExecutionProfileName.DUPLICATE_RESULT,
      M1FakeExecutionProfileName.CANDIDATE_DRIFT,
    ],
  );
  assert.equal(new Set(recipes.map(({ definition }) => definition.id)).size, recipes.length);
  assert.equal(
    recipes.every(({ definition }) => Object.isFrozen(definition)),
    true,
  );

  assertRecipe(
    M1FakeExecutionProfileName.LYING_WORKER,
    FakeWorkerFixture.FABRICATED_ACCEPT,
    FakeCandidateSourceFixture.STABLE,
    FakeVerificationFixture.PASS,
  );
  assertRecipe(
    M1FakeExecutionProfileName.MISSING_EVIDENCE,
    FakeWorkerFixture.VALID_RESULT,
    FakeCandidateSourceFixture.STABLE,
    FakeVerificationFixture.MALFORMED,
  );
  assertRecipe(
    M1FakeExecutionProfileName.STALE_CLOSEOUT,
    FakeWorkerFixture.VALID_RESULT,
    FakeCandidateSourceFixture.CONTROLLED_FROZEN_DRIFT,
    FakeVerificationFixture.PASS,
  );
  const staleCloseout = m1FakeExecutionProfileRecipe(
    M1FakeExecutionProfileName.STALE_CLOSEOUT,
  ).definition;
  assert.equal(staleCloseout.id, 'profile_m1-stale-closeout-v2');
  assert.equal(staleCloseout.version, 'codeclosure-m1-fake-profile-v2');
  assert.equal(staleCloseout.candidateSourceVersion, 'controlled-frozen-drift-v1');
  assertRecipe(
    M1FakeExecutionProfileName.RESTART_RESUME,
    FakeWorkerFixture.INITIAL_DISPATCH_DELAY,
    FakeCandidateSourceFixture.STABLE,
    FakeVerificationFixture.PASS,
  );
  const restartResume = m1FakeExecutionProfileRecipe(
    M1FakeExecutionProfileName.RESTART_RESUME,
  ).definition;
  assert.equal(restartResume.id, 'profile_m1-restart-resume-v2');
  assert.equal(restartResume.version, 'codeclosure-m1-fake-profile-v2');
  assertRecipe(
    M1FakeExecutionProfileName.CANDIDATE_DRIFT,
    FakeWorkerFixture.VALID_RESULT,
    FakeCandidateSourceFixture.FREEZE_DRIFT,
    FakeVerificationFixture.PASS,
  );
  assert.throws(() => m1FakeExecutionProfileRecipe('unknown'), /Unknown M1 Fake execution profile/);
});

void test('[I-005][I-013] only the controlled Candidate Source accepts a drift trigger', () => {
  const generationIdentifier = candidateGenerationId('generation_m1-controlled-drift');
  assert.throws(
    () =>
      new FakeCandidateSource(FakeCandidateSourceFixture.STABLE).simulateFrozenDrift(
        generationIdentifier,
      ),
    /does not permit controlled frozen drift/,
  );
  assert.doesNotThrow(() =>
    new FakeCandidateSource(FakeCandidateSourceFixture.CONTROLLED_FROZEN_DRIFT).simulateFrozenDrift(
      generationIdentifier,
    ),
  );
});

function assertRecipe(
  name: M1FakeExecutionProfileName,
  workerFixture: FakeWorkerFixture,
  candidateSourceFixture: FakeCandidateSourceFixture,
  verificationFixture: FakeVerificationFixture,
): void {
  const actual = m1FakeExecutionProfileRecipe(name);
  assert.equal(actual.workerFixture, workerFixture);
  assert.equal(actual.candidateSourceFixture, candidateSourceFixture);
  assert.equal(actual.verificationFixture, verificationFixture);
}
