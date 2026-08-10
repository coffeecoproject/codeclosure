import {
  ExternalApprovalPolicy,
  ExternalBackendCapability,
  ExternalBackendCapabilityClassification,
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
  deriveCapabilityGrant,
  executionProfileId,
  externalBackendCapabilityRecordProjection,
  type ExecutionProfileDefinition,
  type ExternalBackendCapabilityRecord,
  type ExternalExecutionPhaseDispatchEntry,
  type ExternalExecutionProfileDefinitionV3,
  type IsoTimestamp,
} from '@codeclosure/domain';
import {
  M251_CANDIDATE_SOURCE_ID,
  M251_CANDIDATE_SOURCE_VERSION,
  M251_REAL_CODEX_EXECUTION_PROFILE_ID,
  M251_REAL_CODEX_EXECUTION_PROFILE_VERSION,
  M251_VERIFICATION_RUNNER_ID,
  M251_VERIFICATION_RUNNER_VERSION,
  m1WorkerResponseContract,
  type DigestProvider,
} from '@codeclosure/runtime';

export function testExecutionProfileDefinition(namespace: string): ExecutionProfileDefinition {
  const profileNamespace = namespace.toLowerCase().replaceAll('_', '-');
  return Object.freeze({
    id: executionProfileId(`profile_${profileNamespace}`),
    schemaVersion: 1,
    version: 'test-profile-v1',
    workerAdapter: 'fake-worker',
    workerAdapterVersion: 'v1',
    candidateSource: 'fake-candidate-source',
    candidateSourceVersion: 'v1',
    verificationRunner: 'fake-verification-runner',
    verificationRunnerVersion: 'v1',
    driverVersion: 'test-driver-v1',
  });
}

/** C11-only freeze-v2 fixture; Driver and phase-composition fields remain test values. */
export function m251CandidateFreezeV2ProfileFixture(
  namespace: string,
  digests: DigestProvider,
  observedAt: IsoTimestamp,
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
            proofKind: 'DETERMINISTIC_M251_FREEZE_V2_FIXTURE',
          }),
        ),
      ),
      observedAt,
    });
  const capability: ExternalBackendCapabilityRecord = Object.freeze({
    ...capabilityWithoutDigest,
    recordDigest: digests.digest(
      externalBackendCapabilityRecordProjection(capabilityWithoutDigest),
    ),
  });
  const workerPhases = Object.freeze([
    WorkflowPhase.DISCOVERY,
    WorkflowPhase.IMPLEMENT,
    WorkflowPhase.PLAN,
  ]);
  const phaseDispatch = Object.freeze(
    workerPhases.map((phase): ExternalExecutionPhaseDispatchEntry => {
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
        isolationProfileId: 'm251-freeze-v2-test-isolation-v1',
        isolationProfileDigest: digests.digest({ namespace, phase, kind: 'isolation' }),
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
        workerActivityPolicyDigest: digests.digest({ namespace, kind: 'activity-policy' }),
        commandNetworkPolicy: ExternalCommandNetworkPolicy.DENIED,
        approvalPolicy: ExternalApprovalPolicy.NEVER,
        continuityPolicy: ExternalContinuityPolicy.SAME_SESSION_BOUNDED_OPERATION,
        compactionPolicy: ExternalCompactionPolicy.FAIL_ON_OBSERVATION,
        fallbackPolicy: ExternalFallbackPolicy.FAIL_CLOSED,
        allowedRoots: Object.freeze([`/candidate-workspaces/${namespace}/${phase.toLowerCase()}`]),
        forbiddenRoots: Object.freeze(
          [
            `/authority/${namespace}`,
            `/controlled-state/${namespace}`,
            `/source/${namespace}`,
          ].toSorted(),
        ),
      });
    }),
  );
  const externalExecution: ExternalExecutionProfileDefinitionV3 = Object.freeze({
    schemaVersion: 3,
    backendKind: capability.backendKind,
    capabilityRecordDigest: capability.recordDigest,
    selectedCapabilities,
    workerPhases,
    binaryIdentityDigest,
    protocolSchemaDigest,
    managedRequirementsDigest: digests.digest({ namespace, kind: 'managed-requirements' }),
    controlledStateRootIdentity: `/controlled-state/${namespace}`,
    environmentProjectionDigest: digests.digest({ namespace, kind: 'environment' }),
    model: 'gpt-fixture',
    modelProvider: 'openai',
    serviceTier: null,
    reasoningEffort: 'low',
    defaultThreadPolicy: ExternalThreadPolicy.FRESH,
    retentionPolicy: ExternalRetentionPolicy.CONTROLLED,
    interruptionPolicy: ExternalInterruptionPolicy.INTERRUPT_OPERATION,
    workerDispatchPolicy: ExternalWorkerDispatchPolicy.ALL_SELECTED_ATTEMPTS,
    phaseDispatch,
  });
  return Object.freeze({
    capability,
    profile: Object.freeze({
      id: executionProfileId(M251_REAL_CODEX_EXECUTION_PROFILE_ID),
      schemaVersion: 2,
      version: M251_REAL_CODEX_EXECUTION_PROFILE_VERSION,
      workerAdapter: 'codex-app-server-worker',
      workerAdapterVersion: 'codeclosure-m2-5-1-worker-v1',
      candidateSource: M251_CANDIDATE_SOURCE_ID,
      candidateSourceVersion: M251_CANDIDATE_SOURCE_VERSION,
      verificationRunner: M251_VERIFICATION_RUNNER_ID,
      verificationRunnerVersion: M251_VERIFICATION_RUNNER_VERSION,
      driverVersion: 'm251-test-driver-v1',
      externalExecution,
    }),
  });
}
