import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';

import {
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
  IntakeInteractionAction,
  IntentProjectionField,
  ProtectedAssetProtectionMode,
  ProtectedAssetReadLeasePolicy,
  RunStatus,
  WorkflowPhase,
  auditEventId,
  commandId,
  executionProfileId,
  externalBackendCapabilityRecordProjection,
  isoTimestamp,
  protectedAssetManifestProjection,
  rawRequestRevision,
  successCriterionId,
  type DeclaredProjectRef,
  type ExternalBackendCapabilityRecord,
} from '@codeclosure/domain';
import {
  CanonicalJsonSha256DigestProvider,
  M25IntakeCoordinator,
  M25IntakePackageCompiler,
  M25IntentAdmissionEngine,
  M25IntentProjectionCompiler,
  M251_REAL_CODEX_EXECUTION_PROFILE_ID,
  Rfc8785Canonicalizer,
  createM25AdmissionPolicy,
  createM25LocalAdmissionPolicyDefinition,
  type IntakeAssistantPort,
  type IntakeStartCompositionPort,
  type IntentAnalysisAssistantResponseV1,
} from '@codeclosure/runtime';
import { openSqliteControlStore } from '@codeclosure/store-sqlite';
import {
  DeterministicClock,
  DeterministicIds,
  FakeCandidateSource,
  FakeVerificationRunner,
  FakeWorker,
  FakeWorkerFixture,
} from '@codeclosure/testing';

import {
  M251_DRIVER_VERSION,
  createM251RuntimeProfileRegistry,
  installM251ExecutionAuthority,
  type InstallM251ExecutionAuthorityInput,
  type M251RuntimeProfileCapabilities,
} from '../dist/composition/m251-execution-authority.js';

const digests = new CanonicalJsonSha256DigestProvider();
const canonicalizer = new Rfc8785Canonicalizer();
const fixedTime = isoTimestamp('2026-08-10T08:00:00.000Z');

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

const materializationAssistant: IntakeAssistantPort = Object.freeze({
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
  answer: () => Promise.reject(new Error('B1 formal materialization must not request an answer')),
});

function temporaryDatabase(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), 'codeclosure-m251-b1-'));
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

function disabledStartComposition(
  store: ReturnType<typeof openSqliteControlStore>,
): IntakeStartCompositionPort {
  return Object.freeze({
    startGoal: () => {
      throw new Error('B1 intentionally leaves Driver Profile v3 dispatch disabled');
    },
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

function capability(namespace: string): ExternalBackendCapabilityRecord {
  const selected = Object.freeze(
    [
      ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
      ExternalBackendCapability.FRESH_SESSION,
      ExternalBackendCapability.OPERATION_INTERRUPT,
      ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
    ].toSorted(),
  );
  const withoutDigest = Object.freeze({
    schemaVersion: 1 as const,
    backendKind: 'CODEX_APP_SERVER',
    binaryIdentityDigest: digests.digest({ namespace, kind: 'binary' }),
    protocolSchemaDigest: digests.digest({ namespace, kind: 'protocol' }),
    configurationProfileDigest: digests.digest({ namespace, kind: 'configuration' }),
    capabilityEntries: Object.freeze(
      selected.map((entry) =>
        Object.freeze({
          capability: entry,
          classification: ExternalBackendCapabilityClassification.SUPPORTED,
          proofKind: 'DETERMINISTIC_M251_B1_TRUSTED_COMPOSITION',
        }),
      ),
    ),
    observedAt: fixedTime,
  });
  return Object.freeze({
    ...withoutDigest,
    recordDigest: digests.digest(externalBackendCapabilityRecordProjection(withoutDigest)),
  });
}

function authorityInput(
  store: ReturnType<typeof openSqliteControlStore>,
  namespace: string,
): InstallM251ExecutionAuthorityInput {
  const controlledStateRootIdentity = `/authority/${namespace}/codex-state`;
  return Object.freeze({
    store,
    clock: Object.freeze({ now: () => fixedTime }),
    ids: new DeterministicIds(namespace),
    digests,
    capabilityRecord: capability(namespace),
    managedRequirementsDigest: digests.digest({ namespace, kind: 'managed-requirements' }),
    controlledStateRootIdentity,
    environmentProjectionDigest: digests.digest({ namespace, kind: 'environment' }),
    model: 'gpt-fixture',
    modelProvider: 'openai',
    serviceTier: null,
    reasoningEffort: 'low',
    phaseAuthorities: Object.freeze(
      [WorkflowPhase.DISCOVERY, WorkflowPhase.IMPLEMENT, WorkflowPhase.PLAN].map((phase) =>
        Object.freeze({
          phase,
          permissionProfileId: `permission-${phase.toLowerCase()}-v1`,
          permissionProfileDigest: digests.digest({ namespace, phase, kind: 'permission' }),
          executionConfigDigest: digests.digest({ namespace, phase, kind: 'execution-config' }),
          instructionSourceManifestId: `instructions-${phase.toLowerCase()}-v1`,
          instructionSources: Object.freeze([]),
          allowedRoots: Object.freeze([
            `/authority/${namespace}/workspaces/${phase.toLowerCase()}`,
          ]),
          forbiddenRoots: Object.freeze(
            [
              controlledStateRootIdentity,
              `/authority/${namespace}/runtime`,
              `/source/${namespace}`,
            ].toSorted(),
          ),
        }),
      ),
    ),
  });
}

function runtimeCapabilities(namespace: string): M251RuntimeProfileCapabilities {
  const checkDigest = digests.digest({ namespace, kind: 'check' });
  const isolationDigest = digests.digest({ namespace, kind: 'verification-isolation' });
  const semanticCheck = Object.freeze({
    schemaVersion: 1 as const,
    checkVersion: 'm251-b1-check-v1',
    producerIdentity: 'protected-local-verification',
    operation: 'local-command.execute',
    runnerIdentity: 'protected-local-verification',
    runnerVersion: 'v1',
    executablePath: '/protected/m251/check',
    executableDigest: checkDigest,
    declaredToolVersion: 'fixture-v1',
    argv: Object.freeze(['--check']),
    cwd: '.',
    environmentVariables: Object.freeze([]),
    isolationProfileId: 'm251-b1-verification-isolation',
    isolationProfileDigest: isolationDigest,
    timeoutMilliseconds: 1_000,
    terminationGraceMilliseconds: 100,
    stdoutLimitBytes: 1_024,
    stderrLimitBytes: 1_024,
    totalOutputLimitBytes: 2_048,
    payloadRetentionLimitBytes: 2_048,
    acceptedExitCodes: Object.freeze([0]),
  });
  const asset = Object.freeze({
    logicalAssetId: 'm251-b1-check',
    registeredProtectedRootIdentity: '/protected/m251',
    exactRealpath: '/protected/m251/check',
    executionPath: '/protected/m251/check',
    fileMode: 0o500,
    byteLength: 1,
    contentDigest: checkDigest,
    protectionMode: ProtectedAssetProtectionMode.OUTSIDE_WORKER_WRITABLE_CANDIDATE,
  });
  const workspace = Object.freeze({
    issueLease: () => {
      throw new Error('B1 must not issue a Candidate workspace lease');
    },
    releaseLease: () => undefined,
    assertLeaseCurrent: <Value>(lease: Value): Value => lease,
  });
  return Object.freeze({
    worker: new FakeWorker({ fixture: FakeWorkerFixture.VALID_RESULT }),
    candidateSource: new FakeCandidateSource(),
    verification: new FakeVerificationRunner(),
    externalWorker: Object.freeze({
      prepare: () => Promise.reject(new Error('B1 must not invoke Codex')),
    }),
    localCommandVerification: Object.freeze({
      workspace,
      runner: Object.freeze({
        run: () => Promise.reject(new Error('B1 must not run verification')),
      }),
      profile: Object.freeze({
        forbiddenRoots: Object.freeze(['/authority/m251-b1']),
        check: Object.freeze({
          version: semanticCheck.checkVersion,
          producerIdentity: semanticCheck.producerIdentity,
          operation: semanticCheck.operation,
          runnerIdentity: semanticCheck.runnerIdentity,
          runnerVersion: semanticCheck.runnerVersion,
          executablePath: semanticCheck.executablePath,
          executableDigest: semanticCheck.executableDigest,
          declaredToolVersion: semanticCheck.declaredToolVersion,
          argv: semanticCheck.argv,
          cwd: semanticCheck.cwd,
          environmentVariables: semanticCheck.environmentVariables,
          isolationProfileId: semanticCheck.isolationProfileId,
          isolationProfileDigest: semanticCheck.isolationProfileDigest,
          timeoutMilliseconds: semanticCheck.timeoutMilliseconds,
          terminationGraceMilliseconds: semanticCheck.terminationGraceMilliseconds,
          stdoutLimitBytes: semanticCheck.stdoutLimitBytes,
          stderrLimitBytes: semanticCheck.stderrLimitBytes,
          totalOutputLimitBytes: semanticCheck.totalOutputLimitBytes,
          payloadRetentionLimitBytes: semanticCheck.payloadRetentionLimitBytes,
          acceptedExitCodes: semanticCheck.acceptedExitCodes,
        }),
      }),
    }),
    protectedVerification: Object.freeze({
      identities: new DeterministicIds(`${namespace}-protected`),
      proposal: Object.freeze({
        acceptanceCriticalCriterionIds: Object.freeze([successCriterionId('criterion_m251-b1')]),
        acceptanceRuleIds: Object.freeze(['required-criteria-evidence']),
        semanticCheckTemplate: semanticCheck,
        protectedAssets: Object.freeze([asset]),
        protectedAssetManifestDigest: digests.digest(protectedAssetManifestProjection([asset])),
        protectedAssetReadLeasePolicy:
          ProtectedAssetReadLeasePolicy.EXACT_READ_ONLY_SINGLE_INVOCATION,
        derivationRule: 'BOUNDED_M2_ONE_PROTECTED_LOCAL_COMMAND_FAMILY_V1',
        authoritySource: 'TRUSTED_RUNTIME_COMPOSITION',
      }),
      assets: Object.freeze({
        assertLeaseCurrent: <Value>(lease: Value): Value => lease,
      }),
    }),
  });
}

void test('[M251-B1] trusted-real-profile-installation installs and strictly reopens the exact formal authority', (t) => {
  const filename = temporaryDatabase(t);
  const store = openSqliteControlStore({ filename });
  const installed = installM251ExecutionAuthority(authorityInput(store, 'm251-b1-install'));
  assert.equal(installed.profile.profile.schemaVersion, 2);
  assert.equal(installed.profile.profile.id, M251_REAL_CODEX_EXECUTION_PROFILE_ID);
  assert.equal(installed.profile.profile.externalExecution.schemaVersion, 3);
  assert.deepEqual(installed.profile.profile.externalExecution.workerPhases, [
    WorkflowPhase.DISCOVERY,
    WorkflowPhase.IMPLEMENT,
    WorkflowPhase.PLAN,
  ]);
  assert.equal(
    installed.governedExecutionPreflight.executionProfileDigest,
    installed.profile.profile.digest,
  );
  store.close();

  const reopened = openSqliteControlStore({ filename });
  t.after(() => reopened.close());
  const replayed = installM251ExecutionAuthority(authorityInput(reopened, 'm251-b1-install'));
  assert.equal(replayed.policy.bundle.digest, installed.policy.bundle.digest);
  assert.equal(replayed.capability.recordDigest, installed.capability.recordDigest);
  assert.equal(replayed.profile.profile.digest, installed.profile.profile.digest);
});

void test('[M251-B1] formal-profile-materialization-binding carries the production installer tuple into Start Authorization', async (t) => {
  const store = openSqliteControlStore({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const namespace = 'm251-b1-formal-materialization';
  const authority = installM251ExecutionAuthority(authorityInput(store, namespace));
  assert.equal(authority.profile.profile.driverVersion, M251_DRIVER_VERSION);
  const admissionPolicy = createM25AdmissionPolicy(
    createM25LocalAdmissionPolicyDefinition(),
    digests,
  );
  const installedAdmission = store.installIntentAdmissionPolicy({
    policy: admissionPolicy,
    installedAt: fixedTime,
    auditEventId: auditEventId(`audit_${namespace}-admission-policy`),
    payloadDigest: admissionPolicy.digest,
  });
  assert.equal(installedAdmission.status, 'INSTALLED');
  const startComposition = disabledStartComposition(store);
  const intake = new M25IntakeCoordinator({
    store,
    assistant: materializationAssistant,
    packageCompiler: new M25IntakePackageCompiler({ canonicalizer, digests }),
    projectionCompiler: new M25IntentProjectionCompiler({ canonicalizer, digests }),
    admissionEngine: new M25IntentAdmissionEngine(digests, {
      governedExecutionPreflight: authority.governedExecutionPreflight,
    }),
    admissionPolicyId: admissionPolicy.id,
    governedExecutionPreflight: authority.governedExecutionPreflight,
    startComposition,
    clock: new DeterministicClock([
      '2026-08-10T08:00:01.000Z',
      '2026-08-10T08:00:02.000Z',
      '2026-08-10T08:00:03.000Z',
    ]),
    digests,
    ids: new DeterministicIds(`${namespace}-intake`),
  });
  const result = await intake.submit({
    commandId: commandId(`command_${namespace}`),
    interactionAction: IntakeInteractionAction.GOVERNED_EXECUTION,
    admittedUserContent: 'Ship slice 4',
    declaredProjectRef: project(`/fixture/${namespace}`),
  });
  assert.equal(result.kind, 'OUTCOME');
  assert.equal(result.outcome.result.kind, 'MATERIALIZED');
  assert.equal(result.startDisposition, 'START_INFRASTRUCTURE_FAILURE');
  const retained = store.getIntakeAuthority(result.outcome.intakeRunId);
  assert.ok(retained?.materialization);
  assert.ok(retained.startAuthorization);
  assert.deepEqual(
    {
      workflowPolicyId: retained.startAuthorization.policyBundleId,
      workflowPolicyDigest: retained.startAuthorization.policyBundleDigest,
      executionProfileId: retained.startAuthorization.executionProfileId,
      executionProfileDigest: retained.startAuthorization.executionProfileDigest,
    },
    {
      workflowPolicyId: authority.governedExecutionPreflight.workflowPolicyId,
      workflowPolicyDigest: authority.governedExecutionPreflight.workflowPolicyDigest,
      executionProfileId: authority.governedExecutionPreflight.executionProfileId,
      executionProfileDigest: authority.governedExecutionPreflight.executionProfileDigest,
    },
  );
  assert.equal(store.getWorkflow(retained.materialization.workflowId)?.runStatus, RunStatus.READY);
  assert.equal(store.nextAttemptSequence(retained.materialization.workflowId), 1);
  assert.equal(store.getWorkflowPolicyBinding(retained.materialization.workflowId), undefined);
  assert.equal(store.getExecutionProfileBinding(retained.materialization.workflowId), undefined);
});

void test('[M251-B1] governed-preflight rejects fake, stale, and substituted authority selection', (t) => {
  const store = openSqliteControlStore({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const authority = installM251ExecutionAuthority(authorityInput(store, 'm251-b1-preflight'));
  assert.doesNotThrow(
    () =>
      new M25IntentAdmissionEngine(digests, {
        governedExecutionPreflight: authority.governedExecutionPreflight,
      }),
  );
  for (const governedExecutionPreflight of [
    {
      ...authority.governedExecutionPreflight,
      executionProfileId: executionProfileId('profile_m1-happy-path'),
    },
    {
      ...authority.governedExecutionPreflight,
      executionProfileVersion: 'stale-profile-v0',
    },
    {
      ...authority.governedExecutionPreflight,
      workflowPolicyVersion: 'caller-selected-policy-v0',
    },
    {
      ...authority.governedExecutionPreflight,
      executionProfileId: executionProfileId('profile_model-proposed-v0'),
    },
  ]) {
    assert.throws(
      () => new M25IntentAdmissionEngine(digests, { governedExecutionPreflight }),
      /unsupported authority tuple/,
    );
  }
});

void test('[M251-B1] ordinary-start-profile-resolution foundation resolves only the installed exact Runtime Profile', (t) => {
  const store = openSqliteControlStore({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const authority = installM251ExecutionAuthority(authorityInput(store, 'm251-b1-resolution'));
  const registry = createM251RuntimeProfileRegistry(
    authority.profile,
    runtimeCapabilities('m251-b1-resolution'),
    digests,
  );
  assert.equal(registry.resolver.resolve(authority.profile.profile), registry.startProfile);
});

void test('[M251-C05] profile-substitution-and-absence fail before an in-process capability can be resolved', (t) => {
  const store = openSqliteControlStore({ filename: temporaryDatabase(t) });
  t.after(() => store.close());
  const authority = installM251ExecutionAuthority(authorityInput(store, 'm251-b1-substitution'));
  const registry = createM251RuntimeProfileRegistry(
    authority.profile,
    runtimeCapabilities('m251-b1-substitution'),
    digests,
  );
  assert.throws(
    () =>
      registry.resolver.resolve({
        ...authority.profile.profile,
        driverVersion: 'substituted-driver-v0',
      }),
    /no exact trusted M2\.5\.1 capability binding/,
  );
  assert.throws(
    () =>
      registry.resolver.resolve({
        ...authority.profile.profile,
        digest: digests.digest({ kind: 'substituted-profile-digest' }),
      }),
    /no exact trusted M2\.5\.1 capability binding/,
  );
  assert.throws(
    () =>
      registry.resolver.resolve({
        ...authority.profile.profile,
        id: executionProfileId('profile_missing-m251'),
      }),
    /no exact trusted M2\.5\.1 capability binding/,
  );
  assert.throws(
    () =>
      createM251RuntimeProfileRegistry(
        {
          ...authority.profile,
          profile: {
            ...authority.profile.profile,
            id: executionProfileId('profile_missing-m251'),
          },
        },
        runtimeCapabilities('m251-b1-missing'),
        digests,
      ),
    /do not bind formal authority/,
  );
});
