import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  IntakeInteractionAction,
  IntentProjectionField,
  RunStatus,
  auditEventId,
  commandId,
  isoTimestamp,
  rawRequestRevision,
  type DeclaredProjectRef,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakeCoordinator,
  M25IntakePackageCompiler,
  M25IntentAdmissionEngine,
  M25IntentProjectionCompiler,
  Rfc8785Canonicalizer,
  createExecutionProfileInstaller,
  createM1PolicyBundleDefinition,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  createM251PolicyBundleDefinition,
  createPolicyInstaller,
  type GovernedExecutionPreflight,
  type IntakeAssistantPort,
  type IntakeStartCompositionPort,
  type IntentAnalysisAssistantResponseV1,
} from '@codeclosure/runtime';
import {
  DeterministicClock,
  DeterministicIds,
  M1FakeExecutionProfileName,
  createWorkflowStartAuthorityRuntime,
  m1FakeExecutionProfileRecipe,
  m251CandidateFreezeV2ProfileFixture,
} from '@codeclosure/testing';

import { SqliteControlStore } from '@codeclosure/store-sqlite';

const digests = new CanonicalJsonSha256DigestProvider();
const canonicalizer = new Rfc8785Canonicalizer();

const clearIntentResponse: IntentAnalysisAssistantResponseV1 = Object.freeze({
  proposedObjective: 'Ship slice 4',
  proposedCriteria: Object.freeze(['Ship slice 4']),
  proposedNonGoals: Object.freeze([]),
  proposedAssumptions: Object.freeze([]),
  proposedQuestions: Object.freeze([]),
  candidateSourceSpanSuggestions: Object.freeze([
    Object.freeze({
      projectionFieldRef: IntentProjectionField.OBJECTIVE,
      rawRequestRevision: rawRequestRevision(1),
      startByte: 0,
      endByte: 12,
    }),
    Object.freeze({
      projectionFieldRef: IntentProjectionField.REQUIRED_CRITERION,
      itemIndex: 0,
      rawRequestRevision: rawRequestRevision(1),
      startByte: 0,
      endByte: 12,
    }),
  ]),
});

const assistant: IntakeAssistantPort = Object.freeze({
  analyze: () =>
    Promise.resolve({
      kind: 'COMPLETED' as const,
      response: clearIntentResponse,
      observation: Object.freeze({
        schemaVersion: 1 as const,
        operation: 'INTENT_ANALYSIS' as const,
        state: 'COMPLETED' as const,
        processLaunchCount: 1,
        threadStartCount: 1,
        turnStartCount: 1,
        turnInterruptCount: 0,
        compactionCount: 0,
      }),
    }),
  answer: () => Promise.reject(new Error('B1 materialization proof must not request an answer')),
});

function temporaryDatabase(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-m251-materialization-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return join(root, 'authority.sqlite');
}

function project(path: string): DeclaredProjectRef {
  return Object.freeze({
    schemaVersion: 1,
    normalizedPath: path,
    identityDigest: digests.digest({ normalizedPath: path }),
  });
}

function startComposition(
  store: SqliteControlStore,
  startGoal: IntakeStartCompositionPort['startGoal'],
): IntakeStartCompositionPort {
  return Object.freeze({
    startGoal,
    getProcessedCommand: (
      identifier: Parameters<IntakeStartCompositionPort['getProcessedCommand']>[0],
    ) => store.getProcessedCommand(identifier),
    getWorkflow: (identifier: Parameters<IntakeStartCompositionPort['getWorkflow']>[0]) =>
      store.getWorkflow(identifier),
    getExecutionProfileBinding: (
      identifier: Parameters<IntakeStartCompositionPort['getExecutionProfileBinding']>[0],
    ) => store.getExecutionProfileBinding(identifier),
    getWorkflowPolicyBinding: (
      identifier: Parameters<IntakeStartCompositionPort['getWorkflowPolicyBinding']>[0],
    ) => store.getWorkflowPolicyBinding(identifier),
  });
}

function installM251Authority(
  store: SqliteControlStore,
  namespace: string,
): GovernedExecutionPreflight {
  const clock = Object.freeze({ now: () => isoTimestamp('2026-08-10T08:10:00.000Z') });
  const ids = new DeterministicIds(namespace);
  const policy = createPolicyInstaller({ store, clock, ids, digests }).installPolicyBundle(
    createM251PolicyBundleDefinition(digests),
  );
  assert.notEqual(policy.status, 'POLICY_CONFLICT');
  if (policy.status === 'POLICY_CONFLICT') {
    throw new Error(policy.message);
  }
  const fixture = m251CandidateFreezeV2ProfileFixture(
    namespace,
    digests,
    isoTimestamp('2026-08-10T08:09:59.000Z'),
  );
  const capability = store.installExternalBackendCapabilityRecord({
    record: fixture.capability,
    auditEventId: auditEventId(ids.nextAuditEventId()),
    payloadDigest: fixture.capability.recordDigest,
  });
  assert.notEqual(capability.status, 'CAPABILITY_CONFLICT');
  if (capability.status === 'CAPABILITY_CONFLICT') {
    throw new Error(capability.message);
  }
  const profile = createExecutionProfileInstaller({
    store,
    clock,
    ids,
    digests,
  }).installExecutionProfile(fixture.profile);
  assert.notEqual(profile.status, 'PROFILE_CONFLICT');
  if (profile.status === 'PROFILE_CONFLICT') {
    throw new Error(profile.message);
  }
  return Object.freeze({
    schemaVersion: 1,
    workflowPolicyId: policy.value.bundle.id,
    workflowPolicyVersion: policy.value.bundle.version,
    workflowPolicyDigest: policy.value.bundle.digest,
    executionProfileId: profile.value.profile.id,
    executionProfileVersion: profile.value.profile.version,
    executionProfileDigest: profile.value.profile.digest,
  });
}

function installAdmissionPolicy(store: SqliteControlStore, namespace: string): string {
  const policy = createM25AdmissionPolicy(createM25LocalAdmissionPolicyDefinition(), digests);
  const installed = store.installIntentAdmissionPolicy({
    policy,
    installedAt: isoTimestamp('2026-08-10T08:10:00.000Z'),
    auditEventId: auditEventId(`audit_${namespace}-admission-policy`),
    payloadDigest: policy.digest,
  });
  assert.equal(installed.status, 'INSTALLED');
  return policy.id;
}

function coordinator(
  store: SqliteControlStore,
  namespace: string,
  preflight: GovernedExecutionPreflight,
  start: IntakeStartCompositionPort,
): M25IntakeCoordinator {
  return new M25IntakeCoordinator({
    store,
    assistant,
    packageCompiler: new M25IntakePackageCompiler({ canonicalizer, digests }),
    projectionCompiler: new M25IntentProjectionCompiler({ canonicalizer, digests }),
    admissionEngine: new M25IntentAdmissionEngine(digests, {
      governedExecutionPreflight: preflight,
    }),
    admissionPolicyId: installAdmissionPolicy(store, namespace),
    governedExecutionPreflight: preflight,
    startComposition: start,
    clock: new DeterministicClock([
      '2026-08-10T08:10:01.000Z',
      '2026-08-10T08:10:02.000Z',
      '2026-08-10T08:10:03.000Z',
    ]),
    digests,
    ids: new DeterministicIds(namespace),
  });
}

void test('[M251-C03] authorization-profile-binding retains the exact formal Start Authorization before disabled Driver v3 dispatch', async (t) => {
  const filename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename });
  const preflight = installM251Authority(store, 'm251-c03-authority');
  const runtime = coordinator(
    store,
    'm251-c03-intake',
    preflight,
    startComposition(store, () => {
      throw new Error('B1 intentionally leaves Driver Profile v3 dispatch disabled');
    }),
  );
  const result = await runtime.submit({
    commandId: commandId('command_m251-c03-materialize'),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/m251-c03-materialize'),
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.result.kind, 'MATERIALIZED');
  assert.equal(result.startDisposition, 'START_INFRASTRUCTURE_FAILURE');
  const authority = store.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(authority?.materialization);
  assert.ok(authority.startAuthorization);
  assert.deepEqual(
    {
      workflowPolicyId: authority.startAuthorization.policyBundleId,
      workflowPolicyDigest: authority.startAuthorization.policyBundleDigest,
      executionProfileId: authority.startAuthorization.executionProfileId,
      executionProfileDigest: authority.startAuthorization.executionProfileDigest,
    },
    {
      workflowPolicyId: preflight.workflowPolicyId,
      workflowPolicyDigest: preflight.workflowPolicyDigest,
      executionProfileId: preflight.executionProfileId,
      executionProfileDigest: preflight.executionProfileDigest,
    },
  );
  assert.equal(store.getWorkflow(authority.materialization.workflowId)?.runStatus, RunStatus.READY);
  assert.equal(store.nextAttemptSequence(authority.materialization.workflowId), 1);
  assert.equal(store.getWorkflowPolicyBinding(authority.materialization.workflowId), undefined);
  assert.equal(store.getExecutionProfileBinding(authority.materialization.workflowId), undefined);
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  t.after(() => reopened.close());
  assert.equal(
    reopened.getIntakeAuthority(result.outcome.intakeRunId)?.startAuthorization
      ?.authorizationDigest,
    authority.startAuthorization.authorizationDigest,
  );
  assert.equal(reopened.nextAttemptSequence(authority.materialization.workflowId), 1);
});

void test('[M251-C06] historical-goal-non-rebinding preserves the original immutable Profile after formal authority installation', async (t) => {
  const filename = temporaryDatabase(t);
  const store = SqliteControlStore.open({ filename });
  const historical = createWorkflowStartAuthorityRuntime({
    store,
    namespace: 'm251-c06-historical-authority',
    clock: Object.freeze({ now: () => isoTimestamp('2026-08-10T08:11:00.000Z') }),
    policyDefinition: createM1PolicyBundleDefinition(digests),
    executionProfileDefinition: m1FakeExecutionProfileRecipe(M1FakeExecutionProfileName.HAPPY_PATH)
      .definition,
  });
  const historicalPreflight: GovernedExecutionPreflight = Object.freeze({
    schemaVersion: 1,
    workflowPolicyId: historical.policy.id,
    workflowPolicyVersion: historical.policy.version,
    workflowPolicyDigest: historical.policy.digest,
    executionProfileId: historical.profile.id,
    executionProfileVersion: historical.profile.version,
    executionProfileDigest: historical.profile.digest,
  });
  const runtime = coordinator(
    store,
    'm251-c06-historical-intake',
    historicalPreflight,
    startComposition(store, (input) =>
      Promise.resolve({ command: historical.kernel.startGoal(input) }),
    ),
  );
  const result = await runtime.submit({
    commandId: commandId('command_m251-c06-historical'),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project('/fixture/m251-c06-historical'),
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.startDisposition, 'START_COMMAND_APPLIED');
  const authority = store.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(authority?.materialization);
  const before = store.getExecutionProfileBinding(authority.materialization.workflowId);
  assert.ok(before);
  assert.equal(before.profileId, historicalPreflight.executionProfileId);

  const formalPreflight = installM251Authority(store, 'm251-c06-formal-authority');
  assert.notEqual(formalPreflight.executionProfileId, before.profileId);
  assert.deepEqual(store.getExecutionProfileBinding(authority.materialization.workflowId), before);
  store.close();

  const reopened = SqliteControlStore.open({ filename });
  t.after(() => reopened.close());
  assert.deepEqual(
    reopened.getExecutionProfileBinding(authority.materialization.workflowId),
    before,
  );
});
