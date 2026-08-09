import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ExternalApprovalPolicy,
  ExternalBackendCapability,
  ExternalCommandNetworkPolicy,
  ExternalCompactionPolicy,
  ExternalContinuityPolicy,
  ExternalFallbackPolicy,
  ExternalInterruptionPolicy,
  ExternalPhaseCwdKind,
  ExternalPhaseResponseSchemaPolicy,
  ExternalPhaseSourceAuthorityKind,
  ExternalProjectConfigurationPolicy,
  ExternalRetentionPolicy,
  ExternalThreadPolicy,
  ExternalWorkerDispatchPolicy,
  WorkflowPhase,
  decodeExecutionProfileDefinition,
  decodeExternalExecutionProfileDefinition,
  executionProfileId,
  externalExecutionProfileDefinitionProjection,
  sha256Digest,
  type ExternalExecutionPhaseDispatchEntry,
  type ExternalExecutionProfileDefinitionV3,
} from '@codeclosure/domain';

const digest = (value: string) => sha256Digest(`sha256:${value.repeat(64)}`);
const workerPhases = Object.freeze([
  WorkflowPhase.DISCOVERY,
  WorkflowPhase.IMPLEMENT,
  WorkflowPhase.PLAN,
]);

function phaseEntry(phase: (typeof workerPhases)[number]): ExternalExecutionPhaseDispatchEntry {
  const candidateFree = phase !== WorkflowPhase.IMPLEMENT;
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
    permissionProfileDigest: digest('1'),
    isolationProfileId: `isolation-${phase.toLowerCase()}-v1`,
    isolationProfileDigest: digest('2'),
    projectConfigurationPolicy: ExternalProjectConfigurationPolicy.DISABLED,
    configurationProfileDigest: digest('3'),
    executionConfigDigest: digest('4'),
    disabledIntegrationsDigest: digest('5'),
    instructionSourceManifestId: `instructions-${phase.toLowerCase()}-v1`,
    instructionSourceManifestDigest: digest('6'),
    instructionSources: Object.freeze([]),
    capabilityGrantDigest: digest(candidateFree ? '7' : '8'),
    responseContractDigest: digest(candidateFree ? '9' : 'a'),
    responseSchemaPolicy: candidateFree
      ? ExternalPhaseResponseSchemaPolicy.PROPOSALS_V1
      : ExternalPhaseResponseSchemaPolicy.COMPLETION_REQUEST_V1,
    workerActivityPolicyId: 'codex-worker-activity-policy_codeclosure-m2-5-1-real',
    workerActivityPolicyDigest: digest('b'),
    commandNetworkPolicy: ExternalCommandNetworkPolicy.DENIED,
    approvalPolicy: ExternalApprovalPolicy.NEVER,
    continuityPolicy: ExternalContinuityPolicy.SAME_SESSION_BOUNDED_OPERATION,
    compactionPolicy: ExternalCompactionPolicy.FAIL_ON_OBSERVATION,
    fallbackPolicy: ExternalFallbackPolicy.FAIL_CLOSED,
    allowedRoots: Object.freeze([`/authority/workspaces/${phase.toLowerCase()}`]),
    forbiddenRoots: Object.freeze(['/authority/control', '/source/project']),
  });
}

function definition(): ExternalExecutionProfileDefinitionV3 {
  return Object.freeze({
    schemaVersion: 3,
    backendKind: 'CODEX_APP_SERVER',
    capabilityRecordDigest: digest('c'),
    selectedCapabilities: Object.freeze(
      [
        ExternalBackendCapability.CONTROLLED_STATE_REOPEN,
        ExternalBackendCapability.FRESH_SESSION,
        ExternalBackendCapability.OPERATION_INTERRUPT,
        ExternalBackendCapability.SAME_SESSION_BOUNDED_OPERATION,
      ].toSorted(),
    ),
    workerPhases,
    binaryIdentityDigest: digest('d'),
    protocolSchemaDigest: digest('e'),
    managedRequirementsDigest: digest('f'),
    controlledStateRootIdentity: '/authority/codex-state',
    environmentProjectionDigest: digest('0'),
    model: 'gpt-fixture',
    modelProvider: 'openai',
    serviceTier: null,
    reasoningEffort: 'low',
    defaultThreadPolicy: ExternalThreadPolicy.FRESH,
    retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
    interruptionPolicy: ExternalInterruptionPolicy.INTERRUPT_OPERATION,
    workerDispatchPolicy: ExternalWorkerDispatchPolicy.ALL_SELECTED_ATTEMPTS,
    phaseDispatch: Object.freeze(workerPhases.map((phase) => phaseEntry(phase))),
  });
}

void test('[I-006][I-023] external Profile v3 decodes one exact canonical phase authority map', () => {
  const decoded = decodeExternalExecutionProfileDefinition(definition());
  assert.equal(decoded.schemaVersion, 3);
  assert.deepEqual(decoded.workerPhases, workerPhases);
  assert.deepEqual(
    decoded.phaseDispatch.map((entry) => entry.phase),
    workerPhases,
  );
  const projection = externalExecutionProfileDefinitionProjection(decoded);
  assert.equal(Reflect.has(projection as object, 'configurationProfileDigest'), false);
  assert.equal(Reflect.has(projection as object, 'permissionProfileId'), false);

  const topLevel = decodeExecutionProfileDefinition({
    id: executionProfileId('profile_m2-5-1-v3-contract'),
    schemaVersion: 2,
    version: 'codeclosure-m2-5-1-real-codex-profile-v1',
    workerAdapter: 'trusted-external-worker',
    workerAdapterVersion: 'v1',
    candidateSource: 'controlled-copy-candidate',
    candidateSourceVersion: 'v1',
    verificationRunner: 'protected-local-verification',
    verificationRunnerVersion: 'v1',
    driverVersion: 'm2-5-1-driver-v1',
    externalExecution: decoded,
  });
  assert.equal(topLevel.schemaVersion, 2);
  assert.equal(topLevel.externalExecution.schemaVersion, 3);
});

void test('[I-023][I-027] external Profile v3 rejects reordered, missing, or incompatible phases', () => {
  const valid = definition();
  for (const value of [
    {
      ...valid,
      workerPhases: [WorkflowPhase.DISCOVERY, WorkflowPhase.PLAN, WorkflowPhase.IMPLEMENT],
    },
    { ...valid, phaseDispatch: valid.phaseDispatch.slice(0, 2) },
    {
      ...valid,
      phaseDispatch: valid.phaseDispatch.map((entry) =>
        entry.phase === WorkflowPhase.PLAN
          ? { ...entry, cwdKind: ExternalPhaseCwdKind.CANDIDATE_WORKSPACE }
          : entry,
      ),
    },
  ]) {
    assert.throws(() => decodeExternalExecutionProfileDefinition(value));
  }
});

void test('[I-006][I-027] external Profile v3 rejects duplicate global authority and policy substitution', () => {
  const valid = definition();
  assert.throws(() =>
    decodeExternalExecutionProfileDefinition({
      ...valid,
      configurationProfileDigest: digest('3'),
    }),
  );
  assert.throws(() =>
    decodeExternalExecutionProfileDefinition({
      ...valid,
      workerDispatchPolicy: ExternalWorkerDispatchPolicy.ACCEPTANCE_REPAIR_ONLY,
    }),
  );
  assert.throws(() =>
    decodeExternalExecutionProfileDefinition({
      ...valid,
      phaseDispatch: valid.phaseDispatch.map((entry) =>
        entry.phase === WorkflowPhase.DISCOVERY
          ? {
              ...entry,
              responseSchemaPolicy: ExternalPhaseResponseSchemaPolicy.COMPLETION_REQUEST_V1,
            }
          : entry,
      ),
    }),
  );
  assert.throws(() =>
    decodeExternalExecutionProfileDefinition({
      ...valid,
      phaseDispatch: valid.phaseDispatch.map((entry) =>
        entry.phase === WorkflowPhase.IMPLEMENT
          ? { ...entry, workerActivityPolicyDigest: digest('c') }
          : entry,
      ),
    }),
  );
});

void test('[I-023][I-027] external Profile v3 rejects non-canonical instructions and root authority', () => {
  const valid = definition();
  const discovery = valid.phaseDispatch[0];
  assert.ok(discovery !== undefined);
  for (const entry of [
    {
      ...discovery,
      instructionSources: [
        { path: 'z/AGENTS.md', digest: digest('1') },
        { path: 'a/AGENTS.md', digest: digest('2') },
      ],
    },
    { ...discovery, allowedRoots: [] },
    {
      ...discovery,
      allowedRoots: ['/authority/control'],
      forbiddenRoots: ['/authority/control', '/source/project'],
    },
  ]) {
    assert.throws(() =>
      decodeExternalExecutionProfileDefinition({
        ...valid,
        phaseDispatch: [entry, ...valid.phaseDispatch.slice(1)],
      }),
    );
  }
});
